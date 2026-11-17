import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';

const PASSWORD = 'Quiet orange clouds cross the valley 42';
const NEXT_PASSWORD = 'Bright silver stars above the mountains 73';
const API = 'https://api.revenuecat.com/v1/subscribers/';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(t, configured = true) {
  const instant = Date.now();
  t.mock.method(Date, 'now', () => instant);
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const hooks = {};
  const DB = {
    async exec(sql) { sqlite.exec(sql); },
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first(column) {
          const row = sqlite.prepare(sql).get(...values);
          await hooks.afterFirst?.(sql, row);
          return column ? row?.[column] ?? null : row ?? null;
        },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return statement.runSync(); },
        runSync() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = statements.map(statement => statement.runSync()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, ASSETS: { fetch: async () => new Response('asset') }, ...(configured ? { REVENUECAT_SECRET_API_KEY: 'sk_isolatedIntegrationTest' } : {}) };
  const deviceId = crypto.randomUUID();
  const calls = [];
  const customers = new Set();
  let provider = async (url, init) => {
    const id = decodeURIComponent(url.slice(API.length));
    if (init.method === 'DELETE') { customers.delete(id); return Response.json({ deleted: true }); }
    customers.add(id);
    return Response.json(customer(id));
  };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    assert.ok(url.startsWith(API), 'only the stubbed RevenueCat endpoint may be called');
    assert.equal(init.headers.Authorization, 'Bearer sk_isolatedIntegrationTest');
    calls.push({ url, method: init.method || 'GET' });
    return provider(url, init);
  });
  const customer = id => ({ subscriber: {
    original_app_user_id: id,
    entitlements: { fizlab_pro: { product_identifier: 'fizlab_pro:monthly', expires_date: new Date(instant + 86400000).toISOString() } },
    subscriptions: { 'fizlab_pro:monthly': { store: 'play_store', is_sandbox: false, expires_date: new Date(instant + 86400000).toISOString() } },
  } });
  async function request(path, { data, token, device = deviceId, headers = {}, method = data === undefined ? 'GET' : 'POST', context } = {}) {
    const response = await worker.fetch(new Request(`https://fizlab.test/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(device === null ? {} : { 'x-fizlab-device-id': device }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env, context);
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function signup(email = 'learner@example.test') {
    const result = await request('auth/v1/signup', { data: { email, password: PASSWORD, password_confirmation: PASSWORD, data: { first_name: 'Audit', last_name: 'Student' } } });
    assert.equal(result.status, 200);
    return result.data;
  }
  const queueCount = () => sqlite.prepare('SELECT count(*) n FROM billing_deletion_queue').get().n;
  return { env, sqlite, hooks, request, signup, calls, customers, customer, queueCount, setProvider: value => { provider = value; } };
}

test('worker billing requires a real device-bound session and valid method before provider access', async t => {
  const f = fixture(t);
  const user = await f.signup();
  assert.equal((await f.request('billing/v1/status')).status, 401);
  assert.equal((await f.request('billing/v1/status', { token: 'forged' })).status, 401);
  assert.equal((await f.request('billing/v1/status', { token: user.access_token, device: crypto.randomUUID() })).status, 401);
  assert.equal((await f.request('billing/v1/status', { token: user.access_token, device: null })).status, 400);
  assert.equal((await f.request('billing/v1/status', { token: user.access_token, data: {} })).status, 405);
  assert.equal(f.calls.length, 0);
  const allowed = await f.request('billing/v1/status', { token: user.access_token });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.entitlement.active, true);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.equal(f.calls.length, 1);
});

test('missing billing configuration denies premium and sync requires verified email', async t => {
  const f = fixture(t, false);
  const user = await f.signup();
  const unavailable = await f.request('billing/v1/status', { token: user.access_token });
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.data.configured, false);
  assert.equal(unavailable.data.entitlement.active, false);
  assert.equal((await f.request('billing/v1/sync', { token: user.access_token, data: {} })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('verified sync derives customer identity from the session, ignoring query and body forgery', async t => {
  const f = fixture(t);
  const user = await f.signup();
  assert.equal((await f.request('billing/v1/sync', { token: user.access_token, data: {} })).status, 403);
  f.sqlite.prepare('UPDATE auth_users SET email_verified_at=? WHERE id=?').run(new Date().toISOString(), user.user.id);
  const result = await f.request('billing/v1/sync?userId=victim', {
    token: user.access_token,
    data: { userId: 'victim', app_user_id: 'victim', active: true, expiresAt: '2999-01-01', entitlement: { active: true } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.entitlement.active, true);
  assert.deepEqual(f.calls, [{ url: `${API}${user.user.id}`, method: 'GET' }]);
});

test('deletion without a RevenueCat key retains its outbox row until configured cron succeeds', async t => {
  const f = fixture(t, false);
  const user = await f.signup();
  f.customers.add(user.user.id);
  const deleted = await f.request('auth/v1/delete', { data: { password: PASSWORD }, token: user.access_token });
  assert.equal(deleted.status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_users').get().n, 0);
  assert.equal(f.queueCount(), 1);
  assert.equal(f.calls.length, 0);
  await worker.scheduled({}, f.env);
  assert.equal(f.queueCount(), 1);
  f.env.REVENUECAT_SECRET_API_KEY = 'sk_isolatedIntegrationTest';
  f.setProvider(async () => new Response('', { status: 503 }));
  await worker.scheduled({}, f.env);
  assert.equal(f.queueCount(), 1, 'provider outage must keep the deletion durable');
  f.setProvider(async (_url, init) => { assert.equal(init.method, 'DELETE'); f.customers.delete(user.user.id); return new Response('', { status: 404 }); });
  await worker.scheduled({}, f.env);
  assert.equal(f.queueCount(), 0);
  assert.equal(f.customers.has(user.user.id), false);
  assert.ok(f.calls.every(call => call.method === 'DELETE'), 'cron must never recreate a customer through GET');
});

test('a status GET finishing after account deletion triggers compensating provider deletion', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const user = await f.signup();
  const entered = deferred();
  const resume = deferred();
  t.after(() => resume.resolve());
  f.setProvider(async (_url, init) => {
    if (init.method === 'DELETE') { f.customers.delete(user.user.id); return Response.json({ deleted: true }); }
    entered.resolve();
    await resume.promise;
    // RevenueCat's GET creates the customer even though our account was deleted meanwhile.
    f.customers.add(user.user.id);
    return Response.json(f.customer(user.user.id));
  });
  const pending = f.request('billing/v1/status', { token: user.access_token });
  await entered.promise;
  assert.equal((await f.request('auth/v1/delete', { token: user.access_token, data: { password: PASSWORD } })).status, 200);
  assert.equal(f.queueCount(), 0, 'the original provider deletion already succeeded');
  resume.resolve();
  const response = await pending;
  assert.equal(response.status, 401);
  assert.equal(f.customers.has(user.user.id), false, 'late provider creation must be deleted again');
  assert.equal(f.queueCount(), 0);
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'DELETE', 'DELETE']);
});

test('ordinary logout during a status request does not delete the live RevenueCat customer', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const user = await f.signup();
  const entered = deferred();
  const resume = deferred();
  t.after(() => resume.resolve());
  f.setProvider(async () => {
    entered.resolve();
    await resume.promise;
    f.customers.add(user.user.id);
    return Response.json(f.customer(user.user.id));
  });
  const pending = f.request('billing/v1/status', { token: user.access_token });
  await entered.promise;
  assert.equal((await f.request('auth/v1/logout', { token: user.access_token, data: {} })).status, 200);
  resume.resolve();
  assert.equal((await pending).status, 401);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_users').get().n, 1);
  assert.equal(f.customers.has(user.user.id), true);
  assert.equal(f.queueCount(), 0);
  assert.deepEqual(f.calls.map(call => call.method), ['GET']);
});

test('a stale deletion credential after password recovery cannot queue provider deletion', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const user = await f.signup();
  const entered = deferred();
  const resume = deferred();
  t.after(() => resume.resolve());
  f.hooks.afterFirst = async sql => {
    if (!sql.startsWith('SELECT * FROM auth_users WHERE id=')) return;
    delete f.hooks.afterFirst;
    entered.resolve();
    await resume.promise;
  };
  const pending = f.request('auth/v1/delete', { token: user.access_token, data: { password: PASSWORD } });
  await entered.promise;
  const reset = await f.request('auth/v1/recover', { data: { email: user.user.email, recovery_code: user.recovery_code, password: NEXT_PASSWORD, password_confirmation: NEXT_PASSWORD } });
  assert.equal(reset.status, 200);
  resume.resolve();
  assert.equal((await pending).status, 401);
  assert.equal(f.queueCount(), 0);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('auth/v1/user', { token: reset.data.access_token })).status, 200);
});

test('per-account password limits stop distributed IP guessing without consuming refresh quota', async t => {
  const f = fixture(t, false);
  const user = await f.signup();
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await f.request('auth/v1/token?grant_type=password', {
      data: { email: user.user.email, password: 'wrong password' },
      headers: { 'cf-connecting-ip': `192.0.2.${attempt + 1}` },
    });
    assert.equal(response.status, attempt === 10 ? 429 : 401);
  }
  const refreshed = await f.request('auth/v1/token?grant_type=refresh_token', { data: { refresh_token: user.refresh_token } });
  assert.equal(refreshed.status, 200);
  const other = await f.signup('another@example.test');
  assert.equal((await f.request('auth/v1/token?grant_type=password', { data: { email: other.user.email, password: PASSWORD } })).status, 200);
});

test('sensitive account password checks share an account quota across distributed IPs', async t => {
  const f = fixture(t, false);
  const user = await f.signup();
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await f.request('auth/v1/delete', {
      data: { password: 'wrong password' }, token: user.access_token,
      headers: { 'cf-connecting-ip': `198.51.100.${attempt + 1}` },
    });
    assert.equal(response.status, 401);
  }
  const limited = await f.request('auth/v1/recovery-code', {
    data: { password: PASSWORD }, token: user.access_token,
    headers: { 'cf-connecting-ip': '198.51.100.100' },
  });
  assert.equal(limited.status, 429);
  assert.equal((await f.request('auth/v1/user', { token: user.access_token })).status, 200);
  assert.equal(f.queueCount(), 0);
});
