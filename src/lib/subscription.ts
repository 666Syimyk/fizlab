import { apiUrl, deviceId, supabase } from "@/lib/supabaseClient";

export interface SubscriptionEntitlement {
  active: boolean;
  expiresAt: string | null;
  productId: string | null;
  willRenew: boolean;
  store: string | null;
}

export interface SubscriptionStatus {
  configured: boolean;
  entitlement: SubscriptionEntitlement;
  checkedAt: string;
}

export const emptyEntitlement: SubscriptionEntitlement = {
  active: false, expiresAt: null, productId: null, willRenew: false, store: null,
};

/** Only a well-formed server response can grant access. Nothing is persisted locally. */
export function parseSubscriptionStatus(value: unknown, now = Date.now()): SubscriptionStatus {
  if (!value || typeof value !== "object") throw new Error("Не удалось проверить подписку. Повторите попытку.");
  const result = value as Partial<SubscriptionStatus>;
  const entitlement = result.entitlement;
  if (typeof result.configured !== "boolean" || typeof result.checkedAt !== "string"
    || !Number.isFinite(Date.parse(result.checkedAt)) || !entitlement
    || typeof entitlement.active !== "boolean" || typeof entitlement.willRenew !== "boolean"
    || !(entitlement.expiresAt === null || typeof entitlement.expiresAt === "string")
    || !(entitlement.productId === null || typeof entitlement.productId === "string")
    || !(entitlement.store === null || typeof entitlement.store === "string")) {
    throw new Error("Не удалось проверить подписку. Повторите попытку.");
  }
  const expiry = entitlement.expiresAt ? Date.parse(entitlement.expiresAt) : NaN;
  return {
    configured: result.configured,
    checkedAt: result.checkedAt,
    entitlement: {
      ...entitlement,
      active: result.configured && entitlement.active && Number.isFinite(expiry) && expiry > now,
    },
  };
}

export async function fetchSubscriptionStatus(userId: string, sync = false): Promise<SubscriptionStatus> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session || session.user.id !== userId) throw new Error("Войдите в свой аккаунт для проверки подписки.");
  const response = await fetch(`${apiUrl}/billing/v1/${sync ? "sync" : "status"}`, {
    method: sync ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "x-fizlab-device-id": deviceId(),
      ...(sync ? { "Content-Type": "application/json" } : {}),
    },
    ...(sync ? { body: "{}" } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || "Не удалось проверить подписку. Проверьте интернет и повторите попытку.");
  return parseSubscriptionStatus(result);
}
