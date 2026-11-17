import { useAuth } from "@/components/AuthProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useAccountAccess } from "@/components/AccountAccessProvider";
/** Registration alone does not grant premium access. */
export function useAccess() {
  const { profile } = useAuth();
  const { loading, entitlement } = useSubscription();
  const access = useAccountAccess();
  const hasFullAccess = entitlement.active || access.fullAccess;
  return { loading: !hasFullAccess && (loading || access.loading), profile, hasFullAccess };
}
