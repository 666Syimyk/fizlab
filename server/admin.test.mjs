import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import worker from './worker.mjs';

const PASSWORD = 'Quiet orange clouds cross the valley 42';
function fixture(t) {
  const instant = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, 'now', () => instant);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  t.after(() => sqlite.close());
  const hooks = {};
  const DB = {
    async exec(sql) { sqlite.exec(sql); },
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first(column) { const row = sqlite.prepare(sql).get(...args); await hooks.afterFirst?.(sql); return column ? row?.[column] ?? null : row ?? null; },
        async all() { const results = sqlite.prepare(sql).all(...args); await hooks.afterAll?.(sql); return { results }; },
        async run() { await hooks.beforeRun?.(sql); return statement.runSync(); },
        runSync() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.runSync()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const device = crypto.randomUUID();
  const env = { DB, ASSETS: { fetch: async () => new Response('asset') } };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Admin tests must not call external services'); });
  async function request(route, { token, data, method = data === undefined ? 'GET' : 'POST', deviceId = device } = {}) {
    const response = await worker.fetch(new Request(`https://fizlab.test/api/${route}`, {
      method, headers: { 'x-fizlab-device-id': deviceId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env);
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function signup(email = 'learner@example.test', extra = {}) {
    const result = await request('auth/v1/signup', { data: { email, password: PASSWORD, password_confirmation: PASSWORD, data: { first_name: 'Audit', last_name: 'Student', ...extra } } });
    assert.equal(result.status, 200);
    return result.data;
  }
  async function owner() {
    const account = await signup('owner@example.test');
    sqlite.prepare('INSERT INTO app_admins(user_id,created_at) VALUES(?,?)').run(account.user.id, Math.floor(instant / 1000));
    return account;
  }
  return { sqlite, hooks, request, signup, owner, instant, env };
}

test('admin and access endpoints require real sessions; user-controlled metadata never grants roles', async t => {
  const f = fixture(t);
  for (const route of ['admin/v1/overview', 'admin/v1/users', 'access/v1/status']) assert.equal((await f.request(route)).status, 401);
  const member = await f.signup('learner@example.test', { role: 'superadmin', is_superadmin: true });
  const options = { token: member.access_token };
  assert.equal((await f.request('admin/v1/users', options)).status, 403);
  assert.equal((await f.request('admin/v1/grant-access', { ...options, data: { user_id: member.user.id, days: 365 } })).status, 403);
  assert.equal((await f.request('rest/v1/profiles', { ...options, method: 'PATCH', data: { role: 'superadmin' } })).status, 403);
  f.sqlite.prepare('UPDATE auth_users SET metadata=? WHERE id=?').run(JSON.stringify({ full_name: 'Imposter', role: 'superadmin', is_superadmin: true }), member.user.id);
  f.sqlite.prepare("UPDATE app_records SET data=json_set(data,'$.role','superadmin') WHERE kind='profiles' AND id=?").run(member.user.id);
  const status = await f.request('access/v1/status', options);
  assert.equal(status.status, 200);
  assert.deepEqual(status.data, { role: 'member', fullAccess: false, source: null, expiresAt: null, checkedAt: new Date(f.instant).toISOString() });
  assert.equal((await f.request('admin/v1/overview', options)).status, 403);
  assert.equal((await f.request('admin/v1/overview', { token: 'forged' })).status, 401);
  assert.equal((await f.request('access/v1/status', { ...options, deviceId: crypto.randomUUID() })).status, 401);
});

test('superadmin gets full access, bounded user listing and counts without credential fields', async t => {
  const f = fixture(t);
  const owner = await f.owner();
  const member = await f.signup();
  const options = { token: owner.access_token };
  const status = await f.request('access/v1/status', options);
  assert.deepEqual(status.data, { role: 'superadmin', fullAccess: true, source: 'superadmin', expiresAt: null, checkedAt: new Date(f.instant).toISOString() });
  const overview = await f.request('admin/v1/overview', options);
  assert.deepEqual(overview.data, { totalUsers: 2, superadmins: 1, activeGrants: 0 });
  const list = await f.request('admin/v1/users?limit=1&offset=0&search=learner', options);
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.limit, 1);
  assert.equal(list.data.offset, 0);
  assert.deepEqual(list.data.users[0], { id: member.user.id, email: member.user.email, name: 'Audit Student', createdAt: member.user.created_at, emailVerified: false, isSuperadmin: false, grantExpiresAt: null });
  assert.doesNotMatch(JSON.stringify(list.data), /password|salt|token|recovery|metadata/);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.equal((await f.request('admin/v1/users?search=%25', options)).data.total, 0, 'LIKE wildcards must be literal');
  assert.equal((await f.request("admin/v1/users?search='OR%201=1--", options)).data.total, 0);
});

test('manual grants are finite, can be replaced or revoked, expire, and leave store state independent', async t => {
  const f = fixture(t);
  const owner = await f.owner();
  const member = await f.signup();
  const options = { token: owner.access_token };
  const grant = days => f.request('admin/v1/grant-access', { ...options, data: { user_id: member.user.id, days } });
  assert.equal((await grant(30)).status, 200);
  let status = await f.request('access/v1/status', { token: member.access_token });
  assert.deepEqual(status.data, { role: 'member', fullAccess: true, source: 'grant', expiresAt: new Date(f.instant + 30 * 86400000).toISOString(), checkedAt: new Date(f.instant).toISOString() });
  assert.equal((await f.request('admin/v1/overview', options)).data.activeGrants, 1);
  assert.equal((await grant(365)).status, 200);
  status = await f.request('access/v1/status', { token: member.access_token });
  assert.equal(status.data.expiresAt, new Date(f.instant + 365 * 86400000).toISOString());
  f.sqlite.prepare('UPDATE app_access_grants SET expires_at=?').run(Math.floor(f.instant / 1000));
  status = await f.request('access/v1/status', { token: member.access_token });
  assert.equal(status.data.fullAccess, false);
  assert.equal(status.data.source, null);
  assert.equal(status.data.expiresAt, null);
  assert.equal((await f.request('admin/v1/overview', options)).data.activeGrants, 0);
  assert.equal((await grant(30)).status, 200);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await f.request('admin/v1/revoke-access', { ...options, data: { user_id: member.user.id } })).status, 200);
  assert.equal((await f.request('access/v1/status', { token: member.access_token })).data.fullAccess, false);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM app_access_grants').get().n, 0);
});

test('strict input checks protect every admin owner and deny unsupported operations', async t => {
  const f = fixture(t);
  const owner = await f.owner();
  const member = await f.signup();
  const options = { token: owner.access_token };
  for (const query of ['limit=51', 'limit=0', 'limit=1.5', 'offset=-1', 'offset=100001', 'limit=1&limit=2', 'role=member', `search=${'x'.repeat(255)}`]) {
    assert.equal((await f.request(`admin/v1/users?${query}`, options)).status, 422, query);
  }
  assert.equal((await f.request('admin/v1/users', { ...options, data: {} })).status, 405);
  assert.equal((await f.request('admin/v1/unknown', options)).status, 404);
  assert.equal((await f.request('admin/v1/overview?unknown=1', options)).status, 422);
  assert.equal((await f.request('access/v1/status?user_id=other', options)).status, 422);
  for (const data of [{ user_id: member.user.id, days: 0 }, { user_id: member.user.id, days: '30' }, { user_id: member.user.id, days: 30, role: 'superadmin' }, { user_id: member.user.id, days: 30, expires_at: null }]) {
    assert.equal((await f.request('admin/v1/grant-access', { ...options, data })).status, 422);
  }
  for (const route of ['grant-access', 'revoke-access']) {
    assert.equal((await f.request(`admin/v1/${route}`, { ...options, data: { user_id: owner.user.id, ...(route === 'grant-access' ? { days: 30 } : {}) } })).status, 409);
  }
  assert.equal((await f.request('admin/v1/grant-access', { ...options, data: { user_id: crypto.randomUUID(), days: 30 } })).status, 404);
});

test('revoked sessions and roles cannot mutate grants after earlier authorization', async t => {
  for (const operation of ['grant-access', 'revoke-access']) {
    for (const revocation of ['role', 'session']) {
      await t.test(`${operation}: ${revocation}`, async t => {
        const f = fixture(t);
        const owner = await f.owner();
        const member = await f.signup();
        if (operation === 'revoke-access') f.sqlite.prepare('INSERT INTO app_access_grants(user_id,expires_at,granted_by,granted_at) VALUES(?,?,?,?)').run(member.user.id, Math.floor(f.instant / 1000) + 86400, owner.user.id, Math.floor(f.instant / 1000));
        f.hooks.beforeRun = sql => {
          if (!/^(INSERT INTO|DELETE FROM) app_access_grants/.test(sql)) return;
          delete f.hooks.beforeRun;
          f.sqlite.prepare(revocation === 'role' ? 'DELETE FROM app_admins WHERE user_id=?' : 'DELETE FROM auth_sessions WHERE user_id=?').run(owner.user.id);
        };
        const result = await f.request(`admin/v1/${operation}`, { token: owner.access_token, data: { user_id: member.user.id, ...(operation === 'grant-access' ? { days: 30 } : {}) } });
        assert.equal(result.status, revocation === 'role' ? 403 : 401);
        assert.equal(f.sqlite.prepare('SELECT count(*) n FROM app_access_grants').get().n, operation === 'revoke-access' ? 1 : 0);
      });
    }
  }
});

test('deleted or newly promoted targets cannot receive a stale grant', async t => {
  for (const change of ['delete', 'promote']) {
    await t.test(change, async t => {
      const f = fixture(t);
      const owner = await f.owner();
      const member = await f.signup();
      f.hooks.beforeRun = sql => {
        if (!sql.startsWith('INSERT INTO app_access_grants')) return;
        delete f.hooks.beforeRun;
        if (change === 'delete') f.sqlite.prepare('DELETE FROM auth_users WHERE id=?').run(member.user.id);
        else f.sqlite.prepare('INSERT INTO app_admins(user_id,created_at) VALUES(?,?)').run(member.user.id, Math.floor(f.instant / 1000));
      };
      const result = await f.request('admin/v1/grant-access', { token: owner.access_token, data: { user_id: member.user.id, days: 30 } });
      assert.equal(result.status, change === 'delete' ? 404 : 409);
      assert.equal(f.sqlite.prepare('SELECT count(*) n FROM app_access_grants').get().n, 0);
    });
  }
});

test('admin data read while its owner role is revoked is not returned', async t => {
  const f = fixture(t);
  const owner = await f.owner();
  f.hooks.afterAll = sql => {
    if (!sql.includes('FROM auth_users u')) return;
    delete f.hooks.afterAll;
    f.sqlite.prepare('DELETE FROM app_admins WHERE user_id=?').run(owner.user.id);
  };
  const result = await f.request('admin/v1/users', { token: owner.access_token });
  assert.equal(result.status, 403);
  assert.equal(result.data.users, undefined);
});

test('deleting accounts removes their grants and roles while preserving grants to other members', async t => {
  const f = fixture(t);
  const owner = await f.owner();
  const member = await f.signup();
  await f.request('admin/v1/grant-access', { token: owner.access_token, data: { user_id: member.user.id, days: 30 } });
  assert.equal((await f.request('auth/v1/delete', { token: owner.access_token, data: { password: PASSWORD } })).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM app_admins').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT granted_by FROM app_access_grants').get().granted_by, null);
  assert.equal((await f.request('access/v1/status', { token: member.access_token })).data.fullAccess, true);
  assert.equal((await f.request('auth/v1/delete', { token: member.access_token, data: { password: PASSWORD } })).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM app_access_grants').get().n, 0);
});

test('admin mutations have a separate bounded per-owner rate limit', async t => {
  const f = fixture(t);
  const owner = await f.owner();
  const member = await f.signup();
  let result;
  for (let count = 0; count <= 20; count++) result = await f.request('admin/v1/revoke-access', { token: owner.access_token, data: { user_id: member.user.id } });
  assert.equal(result.status, 429);
  assert.equal((await f.request('admin/v1/overview', { token: owner.access_token })).status, 200);
});

test('local admin CLI requires an existing account, modifies only its role and can revoke it', t => {
  const temporaryRoot = realpathSync(os.tmpdir());
  const temporary = mkdtempSync(path.join(temporaryRoot, 'fizlab-admin-cli-'));
  t.after(() => { const resolved = realpathSync(temporary); assert.equal(path.dirname(resolved), temporaryRoot); assert.ok(path.basename(resolved).startsWith('fizlab-admin-cli-')); rmSync(resolved, { recursive: true, force: true }); });
  const database = path.join(temporary, 'test.sqlite');
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE auth_users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT,email_verified_at TEXT);');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO auth_users VALUES(?,?,?,NULL)').run(id, 'existing@example.test', 'unchanged-test-hash');
  const command = (...args) => spawnSync(process.execPath, ['scripts/manage-admin.mjs', ...args, '--db', database], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(command('grant', '--email', 'missing@example.test').status, 0);
  const grant = command('grant', '--email', 'existing@example.test');
  assert.equal(grant.status, 0, grant.stderr);
  assert.equal(db.prepare('SELECT user_id FROM app_admins').get().user_id, id);
  assert.deepEqual({ ...db.prepare('SELECT password_hash,email_verified_at FROM auth_users').get() }, { password_hash: 'unchanged-test-hash', email_verified_at: null });
  assert.notEqual(command('grant', '--email', 'existing@example.test', '--password', 'forbidden').status, 0);
  assert.equal(command('revoke', '--email', 'existing@example.test').status, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM app_admins').get().n, 0);
  db.close();
});
