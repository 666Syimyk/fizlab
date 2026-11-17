import { apiUrl, deviceId } from "@/lib/supabaseClient";

export type AuthSettings = { email_recovery_available: boolean; email_verification_available: boolean };
export type AuthApiError = Error & { status: number; code?: string; resendAfterSeconds?: number };

export async function getAuthSettings(): Promise<AuthSettings> {
  const response = await fetch(`${apiUrl}/auth/v1/settings`, { signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось проверить доступность писем.");
  return response.json();
}

export async function authPost<T>(path: string, payload: unknown, accessToken?: string): Promise<T> {
  const response = await fetch(`${apiUrl}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-fizlab-device-id": deviceId(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => null) as (T & { message?: string; code?: string; resend_after_seconds?: number }) | null;
  if (!response.ok) {
    const error = new Error(result?.message || "Не удалось выполнить запрос. Попробуйте позже.") as AuthApiError;
    error.status = response.status;
    error.code = result?.code;
    const retryAfter = Number(result?.resend_after_seconds ?? response.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.resendAfterSeconds = Math.ceil(retryAfter);
    throw error;
  }
  if (!result) throw new Error("Сервис вернул некорректный ответ. Попробуйте позже.");
  return result;
}
