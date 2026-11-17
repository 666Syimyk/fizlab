import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { emptyEntitlement, fetchSubscriptionStatus, type SubscriptionEntitlement, type SubscriptionStatus } from "@/lib/subscription";

interface SubscriptionContextValue {
  loading: boolean;
  configured: boolean;
  entitlement: SubscriptionEntitlement;
  error: string;
  refresh: (sync?: boolean) => Promise<SubscriptionStatus | null>;
}

interface SubscriptionState {
  userId: string | null;
  identityVersion: number;
  loading: boolean;
  status: SubscriptionStatus | null;
  error: string;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const identity = useRef(userId);
  const identityVersion = useRef(0);
  const revision = useRef(0);
  const [state, setState] = useState<SubscriptionState>({ userId: null, identityVersion: 0, loading: false, status: null, error: "" });
  // Invalidate on render too: an old account's request cannot win between render and effect cleanup.
  if (identity.current !== userId) {
    identity.current = userId;
    ++identityVersion.current;
    ++revision.current;
  }

  const refresh = useCallback(async (sync = false): Promise<SubscriptionStatus | null> => {
    if (!userId || identity.current !== userId) return null;
    const ticket = ++revision.current;
    const version = identityVersion.current;
    setState((previous) => {
      const valid = previous.userId === userId && previous.identityVersion === version
        && previous.status?.entitlement.active === true
        && Date.parse(previous.status.entitlement.expiresAt!) > Date.now();
      // Keep an in-memory, unexpired grant during a background check so simulations
      // keep running. A failed response, offline event or expiry removes it immediately.
      return { userId, identityVersion: version, loading: !valid, status: valid ? previous.status : null, error: "" };
    });
    try {
      const status = await fetchSubscriptionStatus(userId, sync);
      if (identity.current !== userId || ticket !== revision.current) return null;
      setState({ userId, identityVersion: version, loading: false, status, error: "" });
      return status;
    } catch (error) {
      if (identity.current !== userId || ticket !== revision.current) return null;
      const message = error instanceof Error ? error.message : "Не удалось проверить подписку. Повторите попытку.";
      setState({ userId, identityVersion: version, loading: false, status: null, error: message });
      throw error;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || authLoading) return;
    const invalidateRequests = () => { ++revision.current; };
    const check = () => { void refresh().catch(() => { /* The context exposes the retryable error. */ }); };
    const visible = () => { if (document.visibilityState === "visible") check(); };
    const offline = () => {
      ++revision.current;
      setState({ userId, identityVersion: identityVersion.current, loading: false, status: null, error: "Подключитесь к интернету, чтобы проверить подписку." });
    };
    check();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", check);
    window.addEventListener("offline", offline);
    return () => {
      invalidateRequests();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", offline);
    };
  }, [userId, authLoading, refresh]);

  useEffect(() => {
    if (!userId || state.userId !== userId || state.identityVersion !== identityVersion.current || !state.status?.entitlement.active) return;
    const expiresAt = Date.parse(state.status.entitlement.expiresAt!);
    // Revalidate at expiration and at least every five minutes while the app stays open.
    const delay = Math.max(0, Math.min(expiresAt - Date.now(), 5 * 60 * 1000));
    const timer = window.setTimeout(() => { void refresh().catch(() => {}); }, delay);
    return () => window.clearTimeout(timer);
  }, [userId, state, refresh]);

  const current = Boolean(userId && state.userId === userId && state.identityVersion === identityVersion.current);
  const entitlement = current && state.status ? state.status.entitlement : emptyEntitlement;
  const value: SubscriptionContextValue = {
    loading: authLoading || Boolean(userId && (!current || state.loading)),
    configured: current && state.status?.configured === true,
    entitlement: entitlement.active && Date.parse(entitlement.expiresAt!) <= Date.now() ? emptyEntitlement : entitlement,
    error: current ? state.error : "",
    refresh,
  };
  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- Shared provider hook is intentional.
export function useSubscription(): SubscriptionContextValue {
  const value = useContext(SubscriptionContext);
  if (!value) throw new Error("useSubscription must be used within SubscriptionProvider");
  return value;
}
