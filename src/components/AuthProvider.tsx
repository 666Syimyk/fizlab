import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { Profile } from "@/types/database";
import { migrateAndSyncProgress, stopProgressSync } from "@/lib/progressSync";
import { setProgressUser } from "@/lib/progress";
import { setAnalyticsUser } from "@/lib/analytics";
import { runAuthMutation } from "@/lib/authMutations";

interface AuthContextValue {
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

function isRevokedSession(error: { status?: number; name?: string } | null) {
  return error?.status === 401 || error?.status === 403 || error?.name === "AuthSessionMissingError";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const activeUserId = useRef<string | null | undefined>(undefined);
  const identityRevision = useRef(0);
  const profileRevision = useRef(0);

  async function refreshProfile() {
    if (!user || activeUserId.current !== user.id) return;
    const identity = identityRevision.current;
    const ticket = ++profileRevision.current;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (identity !== identityRevision.current || ticket !== profileRevision.current) return;
    if (error) throw error;
    setProfile(data ?? null);
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    let revision = 0;
    function invalidatePendingIdentity() {
      // Invalidate the latest revision, including requests started after mount.
      ++identityRevision.current;
      activeUserId.current = undefined;
    }
    function activate(next: User | null, ticket: number, freshLogin = false) {
      if (cancelled || ticket !== revision) return;
      setUser(next);
      setLoading(false);
      // Refreshing a token does not change ownership or restart progress merging.
      if (!freshLogin && activeUserId.current === (next?.id ?? null)) return;
      activeUserId.current = next?.id ?? null;
      const identity = ++identityRevision.current;
      const profileTicket = ++profileRevision.current;
      stopProgressSync();
      setProgressUser(next?.id ?? null);
      setAnalyticsUser(next?.id ?? null);
      setProfile(null);
      if (!next) return;
      void migrateAndSyncProgress(next.id);
      void supabase.from("profiles").select("*").eq("id", next.id).maybeSingle().then(({ data, error }) => {
        if (!cancelled && identity === identityRevision.current && profileTicket === profileRevision.current && !error) {
          setProfile(data ?? null);
        }
      }, () => { /* Profile can be retried later without losing the login. */ });
    }

    async function verify(initial = false) {
      const ticket = revision;
      try {
        const { data, error } = await supabase.auth.getUser();
        if (cancelled || ticket !== revision) return;
        if (isRevokedSession(error)) {
          // Recheck inside the mutation queue: a successful new login may have
          // replaced the rejected session while this verification was in flight.
          await runAuthMutation(async () => {
            if (cancelled || ticket !== revision) return;
            const latest = await supabase.auth.getUser();
            if (cancelled || ticket !== revision) return;
            if (isRevokedSession(latest.error)) {
              activate(null, ticket);
              await supabase.auth.signOut({ scope: "local" });
            } else if (!latest.error) activate(latest.data.user, ticket);
          });
        } else if (!error) {
          activate(data.user, ticket);
        } else if (initial) {
          // Temporary network failure must not delete the locally saved session.
          const cached = await supabase.auth.getSession();
          activate(cached.data.session?.user ?? null, ticket);
        }
      } catch {
        if (initial && !cancelled && ticket === revision) setLoading(false);
      }
    }
    void verify(true);
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const ticket = ++revision;
      setTimeout(() => { activate(session?.user ?? null, ticket, event === "SIGNED_IN" || event === "PASSWORD_RECOVERY"); }, 0);
    });
    const verifyWhenVisible = () => {
      if (document.visibilityState === "visible" && activeUserId.current) void verify();
    };
    const verifyWhenOnline = () => { if (activeUserId.current) void verify(); };
    document.addEventListener("visibilitychange", verifyWhenVisible);
    window.addEventListener("online", verifyWhenOnline);
    return () => {
      cancelled = true;
      invalidatePendingIdentity();
      document.removeEventListener("visibilitychange", verifyWhenVisible);
      window.removeEventListener("online", verifyWhenOnline);
      listener.subscription.unsubscribe();
      stopProgressSync();
    };
  }, []);

  async function signOut() {
    const before = await supabase.auth.getSession();
    const token = before.data.session?.access_token;
    await runAuthMutation(async () => {
      const current = await supabase.auth.getSession();
      if (!current.data.session) return;
      if (current.data.session.user.id !== user?.id || current.data.session.access_token !== token) {
        throw new Error("Аккаунт изменился. Повторите выход.");
      }
      const { error } = await supabase.auth.signOut();
      // The SDK clears local credentials even if server logout is unavailable.
      if (error) {
        const { data } = await supabase.auth.getSession();
        if (data.session) throw error;
      }
    });
  }

  return <AuthContext.Provider value={{ loading, user, profile, refreshProfile, signOut }}>{children}</AuthContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- Shared provider hook is intentional; this affects development Fast Refresh only.
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
