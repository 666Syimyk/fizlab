// Store receipts are verified by RevenueCat; only this server response grants access.
// Never accept a client-supplied customer id, expiry or "premium" flag.
const API = 'https://api.revenuecat.com/v1/subscribers/';
const emptyEntitlement = () => ({ active: false, expiresAt: null, productId: null, willRenew: false, store: null });
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;

export function billingConfigured(env) {
  return typeof env.REVENUECAT_SECRET_API_KEY === 'string' && /^sk_[A-Za-z0-9_-]+$/.test(env.REVENUECAT_SECRET_API_KEY);
}

export function readEntitlement(customer, env, time = Date.now()) {
  const subscriber = customer?.subscriber;
  if (!subscriber || typeof subscriber !== 'object' || !subscriber.entitlements || !subscriber.subscriptions) {
    fail('Сервис подписок вернул некорректный ответ. Повторите проверку.', 502);
  }
  const entitlementId = env.REVENUECAT_ENTITLEMENT_ID || 'fizlab_pro';
  const entitlement = Object.hasOwn(subscriber.entitlements, entitlementId) ? subscriber.entitlements[entitlementId] : null;
  if (!entitlement || typeof entitlement.product_identifier !== 'string') return emptyEntitlement();
  const productId = entitlement.product_identifier;
  const subscription = Object.hasOwn(subscriber.subscriptions, productId) ? subscriber.subscriptions[productId] : null;
  // Promotional grants, non-renewing purchases, other stores and unknown sandbox state
  // cannot silently turn into a production Google Play subscription.
  if (!subscription || subscription.store !== 'play_store' || subscription.refunded_at
    || (subscription.is_sandbox !== false && !(env.REVENUECAT_ALLOW_SANDBOX === '1' && subscription.is_sandbox === true))) return emptyEntitlement();
  const entitlementExpiry = Math.max(timestamp(entitlement.expires_date) || 0, timestamp(entitlement.grace_period_expires_date) || 0);
  const subscriptionExpiry = Math.max(timestamp(subscription.expires_date) || 0, timestamp(subscription.grace_period_expires_date) || 0);
  // Both records must agree on a finite paid/grace period. Lifetime grants are excluded.
  const expires = Math.min(entitlementExpiry, subscriptionExpiry);
  const active = Number.isFinite(expires) && expires > time;
  return {
    active,
    expiresAt: expires > 0 && Number.isFinite(expires) ? new Date(expires).toISOString() : null,
    productId,
    willRenew: active && !subscription.unsubscribe_detected_at && !subscription.billing_issues_detected_at && !subscription.auto_resume_date,
    store: 'play_store',
  };
}

export async function subscriptionStatus(env, userId) {
  const configured = billingConfigured(env);
  if (!configured) return { configured: false, entitlement: emptyEntitlement(), checkedAt: new Date().toISOString() };
  let response;
  try {
    response = await fetch(`${API}${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch { fail('Не удалось проверить подписку. Проверьте подключение и повторите попытку.', 503); }
  // Do not pass provider diagnostics/keys/customer information into user-visible errors.
  if (!response.ok) fail('Сервис проверки подписки временно недоступен. Повторите попытку.', 503);
  const customer = await response.json().catch(() => null);
  const entitlement = readEntitlement(customer, env);
  if (customer.subscriber.original_app_user_id !== userId) {
    fail('Покупка связана с другим аккаунтом. Войдите в аккаунт, в котором оформляли подписку.', 409);
  }
  return { configured, entitlement, checkedAt: new Date().toISOString() };
}

export async function billingRequest(req, env, url, user) {
  const route = url.pathname.slice('/api/billing/v1/'.length);
  if (!['status', 'sync'].includes(route)) fail('Маршрут не найден.', 404);
  if (req.method !== (route === 'status' ? 'GET' : 'POST')) fail('Метод не поддерживается.', 405);
  if (!user) fail('Войдите в аккаунт, чтобы проверить подписку.', 401);
  if (route === 'sync' && !user.email_verified_at) fail('Сначала подтвердите email в личном кабинете.', 403);
  return Response.json(await subscriptionStatus(env, user.id), { headers: { 'Cache-Control': 'no-store' } });
}

export async function initializeBilling(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS billing_deletion_queue (user_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)');
}

export function billingDeletionStatement(db, user) {
  return db.prepare('INSERT OR IGNORE INTO billing_deletion_queue(user_id,created_at) SELECT ?,? WHERE EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)')
    .bind(user.id, new Date().toISOString(), user.id, user.password_hash);
}

export async function enqueueDeletedBillingCustomer(db, userId) {
  // Compensate for RevenueCat's get-or-create request finishing after account deletion.
  await db.prepare('INSERT OR IGNORE INTO billing_deletion_queue(user_id,created_at) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM auth_users WHERE id=?)')
    .bind(userId, new Date().toISOString(), userId).run();
}

// Durable outbox: local account deletion succeeds even during a provider outage.
// Retry hourly via the Worker's cron trigger. Do not recreate a deleted customer with GET.
export async function processBillingDeletions(env, onlyUserId = null) {
  if (!billingConfigured(env)) return;
  await initializeBilling(env.DB);
  const statement = onlyUserId
    ? env.DB.prepare('SELECT user_id FROM billing_deletion_queue WHERE user_id=?').bind(onlyUserId)
    : env.DB.prepare('SELECT user_id FROM billing_deletion_queue ORDER BY created_at LIMIT 25');
  const { results } = await statement.all();
  for (const row of results) {
    try {
      const response = await fetch(`${API}${encodeURIComponent(row.user_id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok || response.status === 404) {
        await env.DB.prepare('DELETE FROM billing_deletion_queue WHERE user_id=?').bind(row.user_id).run();
      }
    } catch { /* Retain only the opaque id for the next scheduled deletion attempt. */ }
  }
}
