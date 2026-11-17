import { apiUrl, deviceId, supabase } from "@/lib/supabaseClient";

export type AdminGrantDays = 30 | 365;

export interface AdminOverview {
  totalUsers: number;
  superadmins: number;
  activeGrants: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  isSuperadmin: boolean;
  grantExpiresAt: string | null;
}

export interface AdminUsersPage {
  users: AdminUser[];
  total: number;
  offset: number;
  limit: number;
}

export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

function invalidResponse(): never {
  throw new AdminApiError("Сервер вернул некорректный ответ. Обновите страницу и повторите попытку.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

async function requestAdmin(userId: string, path: string, options: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const { data, error } = await supabase.auth.getSession();
    signal.throwIfAborted();
    const session = data.session;
    if (error || !userId || session?.user.id !== userId || !session.access_token) {
      throw new AdminApiError("Сессия изменилась. Войдите в аккаунт администратора снова.", 401);
    }
    const response = await fetch(`${apiUrl}/admin/v1/${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-fizlab-device-id": deviceId(),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      signal,
    });
    const result: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!response.ok) {
      const fallback = response.status === 401 ? "Сессия завершена. Войдите снова."
        : response.status === 403 ? "Для этого действия нужны права администратора."
          : "Не удалось выполнить запрос. Повторите попытку позже.";
      const message = isRecord(result) && typeof result.message === "string" && result.message.trim()
        ? result.message.slice(0, 500) : fallback;
      throw new AdminApiError(message, response.status);
    }
    return result;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof AdminApiError) throw error;
    if (timeout.aborted) throw new AdminApiError("Сервер не ответил вовремя. Проверьте подключение и повторите попытку.");
    throw new AdminApiError("Не удалось связаться с сервером. Проверьте подключение к интернету.");
  }
}

export async function getAdminOverview(userId: string, signal?: AbortSignal): Promise<AdminOverview> {
  const result = await requestAdmin(userId, "overview", { signal });
  if (!isRecord(result) || !isCount(result.totalUsers) || !isCount(result.superadmins) || !isCount(result.activeGrants)) invalidResponse();
  return { totalUsers: result.totalUsers, superadmins: result.superadmins, activeGrants: result.activeGrants };
}

export async function getAdminUsers(userId: string, query: { search: string; offset: number; limit?: number }, signal?: AbortSignal): Promise<AdminUsersPage> {
  const limit = query.limit ?? 20;
  if (!isCount(query.offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || query.search.length > 254) {
    throw new AdminApiError("Некорректные параметры страницы пользователей.");
  }
  const params = new URLSearchParams({ search: query.search.trim(), offset: String(query.offset), limit: String(limit) });
  const result = await requestAdmin(userId, `users?${params.toString()}`, { signal });
  if (!isRecord(result) || !Array.isArray(result.users) || !isCount(result.total)
    || result.offset !== query.offset || result.limit !== limit || result.users.length > limit) invalidResponse();
  const ids = new Set<string>();
  const users = result.users.map((user: unknown): AdminUser => {
    if (!isRecord(user) || typeof user.id !== "string" || !user.id.trim() || ids.has(user.id)
      || typeof user.email !== "string" || !user.email.trim() || typeof user.name !== "string"
      || !isDate(user.createdAt) || typeof user.emailVerified !== "boolean" || typeof user.isSuperadmin !== "boolean"
      || !(user.grantExpiresAt === null || isDate(user.grantExpiresAt))) invalidResponse();
    ids.add(user.id);
    return {
      id: user.id, email: user.email, name: user.name, createdAt: user.createdAt,
      emailVerified: user.emailVerified, isSuperadmin: user.isSuperadmin, grantExpiresAt: user.grantExpiresAt,
    };
  });
  if (users.length > result.total) invalidResponse();
  return { users, total: result.total, offset: query.offset, limit };
}

export async function grantAdminAccess(userId: string, targetUserId: string, days: AdminGrantDays, signal?: AbortSignal): Promise<void> {
  if (!targetUserId.trim() || ![30, 365].includes(days)) throw new AdminApiError("Выберите пользователя и срок доступа: 30 или 365 дней.");
  const result = await requestAdmin(userId, "grant-access", { body: { user_id: targetUserId, days }, signal });
  if (!isRecord(result) || result.success !== true) invalidResponse();
}

export async function revokeAdminAccess(userId: string, targetUserId: string, signal?: AbortSignal): Promise<void> {
  if (!targetUserId.trim()) throw new AdminApiError("Не выбран пользователь.");
  const result = await requestAdmin(userId, "revoke-access", { body: { user_id: targetUserId }, signal });
  if (!isRecord(result) || result.success !== true) invalidResponse();
}
