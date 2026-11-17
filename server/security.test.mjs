import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';
import { passwordFeedback } from './passwordPolicy.mjs';

const PASSWORD = 'Quiet orange clouds cross the valley 42';
const NEXT_PASSWORD = 'Bright silver stars above the mountains 73';
function fixture(t) {
  const fixedNow = Date.now();
  t.mock.method(Date, 'now', () => fixedNow);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  t.after(() => sqlite.close());
  const hooks = {};
  let materialized = 0;
  const DB = {
    async exec(sql) { sqlite.exec(sql); },
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...values) { args = values; return stmt; },
        async first(column) {
          const row = sqlite.prepare(sql).get(...args);
          await hooks.afterFirst?.(sql, row);
          return column ? row?.[column] ?? null : row ?? null;
        },
        async all() { const results = sqlite.prepare(sql).all(...args); materialized = results.length; return { results }; },
        async run() { return stmt.runSync(); },
        runSync() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes }, results: [] }; },
      };
      return stmt;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = statements.map(stmt => stmt.runSync()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const device = crypto.randomUUID();
  const env = { DB, ASSETS: { fetch: async () => new Response('asset') } };
  async function request(route, { method = 'GET', data, token, deviceId = device, headers = {} } = {}) {
    const response = await worker.fetch(new Request(`http://localhost/api/${route}`, {
      method, headers: { 'x-fizlab-device-id': deviceId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    }), env);
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const post = (route, data, options = {}) => request(`auth/v1/${route}`, { method: 'POST', data, ...options });
  async function signup(email = 'audit@example.com') {
    const result = await post('signup', { email, password: PASSWORD, password_confirmation: PASSWORD, data: { first_name: 'Audit', last_name: 'Learner' } });
    assert.equal(result.status, 200);
    return result.data;
  }
  return { sqlite, hooks, env, device, request, post, signup, get materialized() { return materialized; } };
}
function pauseOnce(f, pattern) {
  let enter;
  let release;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  f.hooks.afterFirst = async sql => {
    if (!pattern.test(sql)) return;
    delete f.hooks.afterFirst;
    enter();
    await blocked;
  };
  return { entered, release };
}

test('one recovery code can reset the password only once under concurrency', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const results = await Promise.all([1, 2].map(n => f.post('recover', {
    email: user.user.email, recovery_code: user.recovery_code,
    password: `${NEXT_PASSWORD} ${n}`, password_confirmation: `${NEXT_PASSWORD} ${n}`,
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_sessions').get().n, 1);
});

test('a password login paused before a reset cannot restore the revoked credential', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const gate = pauseOnce(f, /^SELECT \* FROM auth_users WHERE email/);
  const login = f.post('token?grant_type=password', { email: user.user.email, password: PASSWORD });
  await gate.entered;
  const reset = await f.post('recover', { email: user.user.email, recovery_code: user.recovery_code, password: NEXT_PASSWORD, password_confirmation: NEXT_PASSWORD });
  gate.release();
  assert.equal(reset.status, 200);
  assert.equal((await login).status, 401);
  assert.equal((await f.request('auth/v1/user', { token: reset.data.access_token })).status, 200);
});

test('an in-flight refresh cannot revoke a newer device login', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const gate = pauseOnce(f, /^SELECT \* FROM auth_users WHERE id/);
  const refreshing = f.post('token?grant_type=refresh_token', { refresh_token: user.refresh_token });
  await gate.entered;
  const secondDevice = crypto.randomUUID();
  const login = await f.post('token?grant_type=password', { email: user.user.email, password: PASSWORD }, { deviceId: secondDevice });
  gate.release();
  assert.equal(login.status, 200);
  assert.equal((await refreshing).status, 401);
  assert.equal((await f.request('auth/v1/user', { token: login.data.access_token, deviceId: secondDevice })).status, 200);
});

test('a deletion authenticated before recovery cannot erase the recovered account', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const gate = pauseOnce(f, /^SELECT \* FROM auth_users WHERE id/);
  const deleting = f.post('delete', { password: PASSWORD }, { token: user.access_token });
  await gate.entered;
  const reset = await f.post('recover', { email: user.user.email, recovery_code: user.recovery_code, password: NEXT_PASSWORD, password_confirmation: NEXT_PASSWORD });
  gate.release();
  assert.equal(reset.status, 200);
  assert.equal((await deleting).status, 401);
  assert.equal((await f.request('auth/v1/user', { token: reset.data.access_token })).status, 200);
});

test('concurrent refreshes have one winner and the old refresh cannot be replayed', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const results = await Promise.all([1, 2].map(() => f.post('token?grant_type=refresh_token', { refresh_token: user.refresh_token })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  assert.equal((await f.post('token?grant_type=refresh_token', { refresh_token: user.refresh_token })).status, 401);
  const winner = results.find(result => result.status === 200);
  assert.equal((await f.request('auth/v1/user', { token: winner.data.access_token })).status, 200);
});

test('CORS rejects foreign origins and supports the native localhost origin', async t => {
  const f = fixture(t);
  const denied = await f.post('signup', {}, { headers: { Origin: 'https://attacker.invalid' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const allowed = await f.request('health', { headers: { Origin: 'https://localhost' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal((await f.request('auth/v1/settings', { method: 'POST', data: {} })).status, 405);
});

test('HTML and API responses carry browser security and appropriate cache headers', async t => {
  const f = fixture(t);
  f.env.ASSETS.fetch = async () => new Response('<!doctype html><title>test</title>', { headers: { 'Content-Type': 'text/html' } });
  const response = await worker.fetch(new Request('https://fizlab.example/topic'), f.env);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'), /wasm-unsafe-eval/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-hashes|googleapis|gstatic/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const api = await f.request('health');
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
});

test('SPA fallback preserves deep routes when the asset service canonicalizes index.html', async t => {
  const f = fixture(t);
  f.env.ASSETS.fetch = async request => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/index.html') return new Response(null, { status: 307, headers: { Location: '/' } });
    return pathname === '/' ? new Response('<!doctype html><title>app</title>', { headers: { 'Content-Type': 'text/html' } }) : new Response('missing', { status: 404 });
  };
  const response = await worker.fetch(new Request('https://fizlab.example/account/delete'), f.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

test('refreshes remain available when the password-attempt quota is exhausted', async t => {
  const f = fixture(t);
  const user = await f.signup();
  let failure;
  for (let n = 0; n < 20; n++) failure = await f.post('token?grant_type=password', { email: user.user.email, password: 'incorrect' });
  assert.equal(failure.status, 429);
  assert.ok(Number(failure.headers.get('retry-after')) > 0);
  assert.equal((await f.post('token?grant_type=refresh_token', { refresh_token: user.refresh_token })).status, 200);
});

test('invalid JSON shapes and table names return client errors', async t => {
  const f = fixture(t);
  for (const data of [null, [], 'text', 123]) assert.equal((await f.post('signup', data)).status, 400);
  const user = await f.signup();
  assert.equal((await f.request('rest/v1/__proto__', { token: user.access_token })).status, 404);
  assert.equal((await f.request('rest/v1/profiles', { method: 'PATCH', token: user.access_token, data: { avatar_data: 'data:image/jpeg;base64,A' } })).status, 422);
});

test('common eight-character passwords are rejected without raising the eight-character minimum', () => {
  for (const password of ['12345678', '123456789', 'qwerty123', 'Password1!']) assert.ok(passwordFeedback(password), password);
  assert.equal(passwordFeedback('N7x!q2Lp'), null);
});

test('progress validates topic keys and problem IDs without overwriting saved progress', async t => {
  const f = fixture(t);
  const user = await f.signup();
  for (const solved of [JSON.parse('{"__proto__":["one"]}'), { 'bad topic': ['one'] }, { kinematics: [''] }, { kinematics: ['one', 'one'] }, false, 0, null]) {
    const result = await f.request('rest/v1/progress', { method: 'POST', token: user.access_token, data: { user_id: user.user.id, solved_problem_ids: solved } });
    assert.equal(result.status, 400);
  }
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM app_records WHERE kind='progress'").get().n, 0);
});

test('a progress write overlapping account deletion cannot recreate deleted data', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const gate = pauseOnce(f, /^SELECT \* FROM auth_users WHERE id/);
  const write = f.request('rest/v1/progress', { method: 'POST', token: user.access_token, data: { user_id: user.user.id, solved_problem_ids: { kinematics: ['one'] } } });
  await gate.entered;
  assert.equal((await f.post('delete', { password: PASSWORD }, { token: user.access_token })).status, 200);
  gate.release();
  assert.equal((await write).status, 401);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM app_records').get().n, 0);
});

test('JSON request limit counts UTF-8 bytes and stops reading oversized streams', async t => {
  const f = fixture(t);
  const multibyte = await f.post('signup', { email: 'x'.repeat(10), password: 'é'.repeat(35000) });
  assert.equal(multibyte.status, 413);
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { if (++pulls > 20) controller.close(); else controller.enqueue(new Uint8Array(32768)); },
    cancel() { cancelled = true; },
  });
  const response = await worker.fetch(new Request('http://localhost/api/auth/v1/signup', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'x-fizlab-device-id': f.device },
  }), f.env);
  assert.equal(response.status, 413);
  assert.ok(cancelled && pulls <= 4, `oversized stream was fully buffered (${pulls} chunks)`);
});

test('REST scopes rows in SQLite and bounds events before materializing', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const insert = f.sqlite.prepare('INSERT INTO app_records VALUES(?,?,?)');
  for (let n = 0; n < 1200; n++) insert.run('events', String(n), JSON.stringify({ id: String(n), user_id: n < 1100 ? user.user.id : 'other', type: 'sim_started', topic_slug: 'topic.with.dots' }));
  const rows = await f.request('rest/v1/events', { token: user.access_token });
  assert.equal(rows.data.length, 1000);
  assert.equal(f.materialized, 1000);
  const filtered = await f.request('rest/v1/events?topic_slug=eq.topic.with.dots&limit=2', { token: user.access_token });
  assert.equal(filtered.data.length, 2);
  assert.equal(f.materialized, 2);
  const other = await f.request('rest/v1/events?user_id=eq.other', { token: user.access_token });
  assert.deepEqual(other.data, []);
  assert.equal(f.materialized, 0);
});

test('authenticated writes have an independent per-user rate limit', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const statuses = [];
  for (let n = 0; n <= 120; n++) statuses.push((await f.request('rest/v1/events', { method: 'POST', token: user.access_token, data: { user_id: user.user.id, type: 'sim_started' } })).status);
  assert.equal(statuses.at(-1), 429);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM app_records WHERE kind='events'").get().n, 120);
});
