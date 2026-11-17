import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fetchAccountAccess, type AccountAccessStatus } from "@/lib/accountAccess";

interface AccessContextValue {
  loading: boolean;
  isSuperadmin: boolean;
  fullAccess: boolean;
  source: "superadmin" | "grant" | null;
  expiresAt: string | null;
  error: string;
  refresh: () => Promise<void>;
}
interface AccessState {
  userId: string | null;
  version: number;
  loading: boolean;
  status: AccountAccessStatus | null;
  error: string;
}
const AccessContext = createContext<AccessContextValue | null>(null);

export function AccountAccessProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const identity = useRef(userId);
  const version = useRef(0);
  const revision = useRef(0);
  const [state, setState] = useState<AccessState>({ userId: null, version: 0, loading: false, status: null, error: "" });
  if (identity.current !== userId) {
    identity.current = userId;
    ++version.current;
    ++revision.current;
  }

  const refresh = useCallback(async () => {
    if (!userId || identity.current !== userId) return;
    const ticket = ++revision.current;
    const identityVersion = version.current;
    setState(previous => {
      const valid = previous.userId === userId && previous.version === identityVersion && previous.status
        && (previous.status.expiresAt === null || Date.parse(previous.status.expiresAt) > Date.now());
      return { userId, version: identityVersion, loading: !valid, status: valid ? previous.status : null, error: "" };
    });
    try {
      const status = await fetchAccountAccess(userId);
      if (identity.current === userId && ticket === revision.current) {
        setState({ userId, version: identityVersion, loading: false, status, error: "" });
      }
    } catch {
      if (identity.current === userId && ticket === revision.current) {
        setState({ userId, version: identityVersion, loading: false, status: null, error: "Не удалось проверить доступ. Проверьте подключение и повторите попытку." });
      }
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || authLoading) return;
    const check = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") check(); };
    const invalidateRequests = () => { ++revision.current; };
    const offline = () => {
      invalidateRequests();
      setState({ userId, version: version.current, loading: false, status: null, error: "Подключитесь к интернету для проверки доступа." });
    };
    check();
    const interval = window.setInterval(visible, 60_000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("online", check);
    window.addEventListener("offline", offline);
    return () => {
      invalidateRequests();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", offline);
    };
  }, [userId, authLoading, refresh]);

  useEffect(() => {
    if (state.userId !== userId || state.version !== version.current || !state.status?.expiresAt) return;
    const delay = Math.max(0, Math.min(Date.parse(state.status.expiresAt) - Date.now(), 2_147_483_647));
    const timer = window.setTimeout(() => { void refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [state, userId, refresh]);

  const current = Boolean(userId && state.userId === userId && state.version === version.current);
  const status = current ? state.status : null;
  const fullAccess = !authLoading && status?.fullAccess === true && (status.expiresAt === null || Date.parse(status.expiresAt) > Date.now());
  return <AccessContext.Provider value={{
    loading: authLoading || Boolean(userId && (!current || state.loading)),
    isSuperadmin: fullAccess && status?.role === "superadmin",
    fullAccess,
    source: fullAccess ? status!.source : null,
    expiresAt: fullAccess ? status!.expiresAt : null,
    error: current ? state.error : "",
    refresh,
  }}>{children}</AccessContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- Provider and hook share one context.
export function useAccountAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error("useAccountAccess must be used within AccountAccessProvider");
  return value;
}
