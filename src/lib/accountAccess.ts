import { apiUrl, deviceId, supabase } from "@/lib/supabaseClient";

export interface AccountAccessStatus {
  role: "superadmin" | "member";
  fullAccess: boolean;
  source: "superadmin" | "grant" | null;
  expiresAt: string | null;
  checkedAt: string;
}

export function parseAccountAccess(value: unknown, now = Date.now()): AccountAccessStatus {
  const fail = () => { throw new Error("Не удалось подтвердить права доступа. Повторите проверку."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  if (typeof data.checkedAt !== "string" || !Number.isFinite(Date.parse(data.checkedAt))
    || Math.abs(Date.parse(data.checkedAt) - now) > 60_000) return fail();
  const owner = data.role === "superadmin" && data.fullAccess === true && data.source === "superadmin" && data.expiresAt === null;
  const grant = data.role === "member" && data.fullAccess === true && data.source === "grant"
    && typeof data.expiresAt === "string" && Number.isFinite(Date.parse(data.expiresAt)) && Date.parse(data.expiresAt) > now;
  const member = data.role === "member" && data.fullAccess === false && data.source === null && data.expiresAt === null;
  if (!owner && !grant && !member) return fail();
  return { role: data.role, fullAccess: data.fullAccess, source: data.source, expiresAt: data.expiresAt, checkedAt: data.checkedAt } as AccountAccessStatus;
}

export async function fetchAccountAccess(userId: string): Promise<AccountAccessStatus> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId) throw new Error("Войдите в аккаунт повторно.");
  const response = await fetch(`${apiUrl}/access/v1/status`, {
    headers: { Authorization: `Bearer ${data.session.access_token}`, "x-fizlab-device-id": deviceId() },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Не удалось проверить права доступа. Повторите попытку.");
  return parseAccountAccess(await response.json());
}
