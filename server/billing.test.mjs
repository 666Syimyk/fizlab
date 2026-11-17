import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { billingRequest, billingConfigured, readEntitlement, subscriptionStatus, initializeBilling, billingDeletionStatement, processBillingDeletions } from './billing.mjs';

const env = { REVENUECAT_SECRET_API_KEY: 'sk_testServerKey' };
const time = Date.parse('2026-09-30T12:00:00Z');
const future = '2026-10-30T12:00:00Z';
const expired = '2026-09-29T12:00:00Z';
function customer(overrides = {}, entitlementOverrides = {}) {
  return { subscriber: {
    original_app_user_id: 'account-a',
    entitlements: { fizlab_pro: { product_identifier: 'fizlab_pro:monthly', expires_date: future, ...entitlementOverrides } },
    subscriptions: { 'fizlab_pro:monthly': { expires_date: future, is_sandbox: false, store: 'play_store', ...overrides } },
  } };
}
test('only a server secret configures billing; missing configuration never grants access', async () => {
  for (const key of [undefined, '', 'goog_public', 'test_store']) assert.equal(billingConfigured({ REVENUECAT_SECRET_API_KEY: key }), false);
  const status = await subscriptionStatus({}, 'account-a');
  assert.equal(status.configured, false);
  assert.equal(status.entitlement.active, false);
});
test('active, cancelled, expired, refunded and grace-period subscription lifecycles', () => {
  assert.equal(readEntitlement(customer(), env, time).active, true);
  assert.equal(readEntitlement(customer(), env, time).willRenew, true);
  const cancelled = readEntitlement(customer({ unsubscribe_detected_at: expired }), env, time);
  assert.equal(cancelled.active, true, 'cancellation must retain the paid period');
  assert.equal(cancelled.willRenew, false);
  assert.equal(readEntitlement(customer({ expires_date: expired }), env, time).active, false);
  assert.equal(readEntitlement(customer({}, { expires_date: expired }), env, time).active, false);
  assert.equal(readEntitlement(customer({ refunded_at: expired }), env, time).active, false);
  const grace = readEntitlement(customer({ expires_date: expired, grace_period_expires_date: future, billing_issues_detected_at: expired }, { expires_date: expired, grace_period_expires_date: future }), env, time);
  assert.equal(grace.active, true);
  assert.equal(grace.willRenew, false);
});
test('sandbox, lifetime, invalid expiry, other-store and promotional grants fail closed', () => {
  for (const overrides of [{ is_sandbox: true }, { is_sandbox: null }, { store: 'promotional' }, { store: 'app_store' }, { expires_date: null }, { expires_date: 'invalid' }]) {
    assert.equal(readEntitlement(customer(overrides), env, time).active, false, JSON.stringify(overrides));
  }
  assert.equal(readEntitlement(customer({ is_sandbox: true }), { ...env, REVENUECAT_ALLOW_SANDBOX: '1' }, time).active, true);
  assert.equal(readEntitlement(customer({}, { expires_date: null }), env, time).active, false);
  assert.throws(() => readEntitlement({}, env), { status: 502 });
});
test('billing uses the authenticated identity and ignores forged entitlement/customer payloads', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer sk_testServerKey');
    return Response.json(customer());
  });
  const url = new URL('https://fizlab.test/api/billing/v1/sync?userId=victim');
  const request = new Request(url, { method: 'POST', body: JSON.stringify({ userId: 'victim', active: true, expiresAt: '2999-01-01' }) });
  const response = await billingRequest(request, env, url, { id: 'account-a', email_verified_at: '2026-01-01' });
  assert.equal(response.status, 200);
  assert.deepEqual(urls, ['https://api.revenuecat.com/v1/subscribers/account-a']);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  await assert.rejects(billingRequest(request, env, url, null), { status: 401 });
  await assert.rejects(billingRequest(request, env, url, { id: 'account-a' }), { status: 403 });
});
test('provider failure, malformed response and mismatched original customer never grant access', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('secret provider details', { status: 401 }));
  await assert.rejects(subscriptionStatus(env, 'account-a'), error => error.status === 503 && !error.message.includes('secret'));
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(subscriptionStatus(env, 'account-a'), { status: 502 });
  t.mock.method(globalThis, 'fetch', async () => Response.json(customer()));
  await assert.rejects(subscriptionStatus(env, 'different-account'), { status: 409 });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('provider network failure'); });
  await assert.rejects(subscriptionStatus(env, 'account-a'), { status: 503 });
});
test('entitlement status is checked again after provider revocation', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(customer(calls > 1 ? { refunded_at: expired } : {})); });
  t.mock.method(Date, 'now', () => time);
  assert.equal((await subscriptionStatus(env, 'account-a')).entitlement.active, true);
  assert.equal((await subscriptionStatus(env, 'account-a')).entitlement.active, false);
  assert.equal(calls, 2);
});
test('deletion outbox is credential-guarded, durable on failure, and retry-safe on 404', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const DB = { exec: async sql => sqlite.exec(sql), prepare(sql) { let values = []; const statement = { bind(...args) { values = args; return statement; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { return sqlite.prepare(sql).run(...values); } }; return statement; } };
  await initializeBilling(DB);
  sqlite.exec("CREATE TABLE auth_users (id TEXT PRIMARY KEY,password_hash TEXT); INSERT INTO auth_users VALUES('account-a','valid')");
  await billingDeletionStatement(DB, { id: 'account-a', password_hash: 'stale' }).run();
  assert.equal(sqlite.prepare('SELECT count(*) n FROM billing_deletion_queue').get().n, 0);
  await billingDeletionStatement(DB, { id: 'account-a', password_hash: 'valid' }).run();
  t.mock.method(globalThis, 'fetch', async (url, init) => { assert.equal(init.method, 'DELETE'); assert.ok(url.endsWith('/account-a')); return new Response('', { status: 503 }); });
  await processBillingDeletions({ ...env, DB });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM billing_deletion_queue').get().n, 1);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  await processBillingDeletions({ ...env, DB });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM billing_deletion_queue').get().n, 0);
});
