import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';

const PASSWORD = 'Quiet orange clouds cross the valley 42';
const NEXT = 'Bright silver stars above the mountains 73';
function fixture(t, configured = true) {
  let instant = Date.now();
  t.mock.method(Date, 'now', () => instant);
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const DB = {
    async exec(sql) { sqlite.exec(sql); },
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first(column) { const row = sqlite.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return statement.runSync(); },
        runSync() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.runSync()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, ASSETS: { fetch: async () => new Response('asset') }, ...(configured ? { AUTH_EMAIL_ENABLED: 'true', AUTH_EMAIL_FROM: 'FizLab <no-reply@example.test>', RESEND_API_KEY: 'test-only-not-a-live-key' } : {}) };
  const emails = [];
  let failDelivery = false;
  let heldDelivery = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    emails.push(JSON.parse(init.body));
    const held = heldDelivery;
    heldDelivery = null;
    if (held) { held.started(); await held.promise; }
    return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: failDelivery ? 503 : 200 });
  });
  t.mock.method(console, 'error', () => {});
  const device = crypto.randomUUID();
  async function request(path, data, token) {
    const response = await worker.fetch(new Request(`https://fizlab.test/api/auth/v1/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'x-fizlab-device-id': device, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env);
    return { status: response.status, data: await response.json(), retryAfter: response.headers.get('Retry-After') };
  }
  const signup = async () => {
    const result = await request('signup', { email: 'learner@example.test', password: PASSWORD, password_confirmation: PASSWORD, data: { first_name: 'Audit', last_name: 'Student' } });
    assert.equal(result.status, 200);
    return result.data;
  };
  function holdNextDelivery() {
    let started;
    let release;
    const ready = new Promise(resolve => { started = resolve; });
    const promise = new Promise(resolve => { release = resolve; });
    heldDelivery = { started, promise };
    return { started: ready, release };
  }
  return { request, signup, sqlite, env, emails, code: () => emails.at(-1).text.match(/: (\d{8})/)[1], advance: seconds => { instant += seconds * 1000; }, failDelivery: () => { failDelivery = true; }, holdNextDelivery };
}

test('email settings reflect actual configuration and signup never fabricates verification', async t => {
  const f = fixture(t, false);
  const settings = await f.request('settings');
  assert.equal(settings.data.email_recovery_available, false);
  assert.equal(settings.data.mailer_autoconfirm, false);
  const user = await f.signup();
  assert.equal(user.user.email_confirmed_at, null);
  assert.equal((await f.request('request-email-reset', { email: user.user.email })).status, 503);
  assert.equal(f.emails.length, 0);
  const reset = await f.request('recover', { email: user.user.email, recovery_code: user.recovery_code, password: NEXT, password_confirmation: NEXT });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.user.email_confirmed_at, null);
});

test('reset requests do not disclose accounts or failed delivery and never persist plaintext codes', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const found = await f.request('request-email-reset', { email: user.user.email });
  const missing = await f.request('request-email-reset', { email: 'missing@example.test' });
  assert.deepEqual(found, missing);
  assert.equal(f.emails.length, 1);
  const saved = f.sqlite.prepare('SELECT * FROM auth_email_codes').get();
  assert.equal(saved.code_hash.length, 64);
  assert.notEqual(saved.code_hash, f.code());
  f.failDelivery();
  f.advance(120);
  const failed = await f.request('request-email-reset', { email: user.user.email });
  assert.deepEqual(failed, missing);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM auth_email_codes').get(), saved);
});

test('verification consumes the code atomically, and password reset is separate with no automatic login', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  const verificationPayload = { email: user.user.email, code: f.code() };
  const verifications = await Promise.all([f.request('verify-email-reset', verificationPayload), f.request('verify-email-reset', verificationPayload)]);
  assert.deepEqual(verifications.map(result => result.status).sort(), [200, 422]);
  const grant = verifications.find(value => value.status === 200).data;
  assert.match(grant.reset_token, /^[a-f0-9]{64}$/);
  assert.equal(grant.expires_in, 600);
  assert.equal(grant.access_token, undefined);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_email_codes').get().n, 0);
  const saved = f.sqlite.prepare('SELECT * FROM auth_password_resets').get();
  assert.equal(saved.token_hash.length, 64);
  assert.notEqual(saved.token_hash, grant.reset_token);
  assert.equal((await f.request('user', undefined, user.access_token)).status, 200);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM auth_users').get().password_hash.length, 64);
  const payload = { email: user.user.email, reset_token: grant.reset_token, password: NEXT, password_confirmation: NEXT };
  const results = await Promise.all([f.request('reset-password', payload), f.request('reset-password', payload)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 422]);
  const result = results.find(value => value.status === 200).data;
  assert.equal(result.success, true);
  assert.ok(f.sqlite.prepare('SELECT email_verified_at FROM auth_users').get().email_verified_at);
  assert.notEqual(result.recovery_code, user.recovery_code);
  assert.equal(result.access_token, undefined);
  assert.equal((await f.request('user', undefined, user.access_token)).status, 401);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_sessions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_password_resets').get().n, 0);
  assert.equal((await f.request('reset-password', payload)).status, 422);
  assert.equal((await f.request('token?grant_type=password', { email: user.user.email, password: PASSWORD })).status, 401);
  assert.equal((await f.request('token?grant_type=password', { email: user.user.email, password: NEXT })).status, 200);
  assert.equal((await f.request('recover', { email: user.user.email, recovery_code: user.recovery_code, password: PASSWORD, password_confirmation: PASSWORD })).status, 401);
});

test('expired email code and five wrong guesses cannot reset an account', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  let code = f.code();
  f.advance(901);
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code })).status, 422);
  await f.request('request-email-reset', { email: user.user.email });
  code = f.code();
  const wrong = code === '00000000' ? '11111111' : '00000000';
  for (let attempt = 0; attempt < 5; attempt++) {
    f.advance(61);
    assert.equal((await f.request('verify-email-reset', { email: user.user.email, code: wrong })).status, 422);
  }
  f.advance(61);
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code })).status, 422);
  assert.equal((await f.request('user', undefined, user.access_token)).status, 200);
});

test('verification is account-bound, distinct from reset, and password changes need the current password', async t => {
  const f = fixture(t);
  const user = await f.signup();
  assert.equal((await f.request('request-email-verification', {})).status, 401);
  assert.equal((await f.request('request-email-verification', {}, user.access_token)).status, 200);
  const code = f.code();
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code })).status, 422);
  const verified = await f.request('verify-email', { code }, user.access_token);
  assert.equal(verified.status, 200);
  assert.ok(verified.data.user.email_confirmed_at);
  assert.equal((await f.request('change-password', { current_password: 'wrong', password: NEXT, password_confirmation: NEXT }, user.access_token)).status, 401);
  const changed = await f.request('change-password', { current_password: PASSWORD, password: NEXT, password_confirmation: NEXT }, user.access_token);
  assert.equal(changed.status, 200);
  assert.ok(changed.data.user.email_confirmed_at);
  assert.equal((await f.request('user', undefined, user.access_token)).status, 401);
  assert.equal((await f.request('user', undefined, changed.data.access_token)).status, 200);
});

test('deleting an account removes outstanding email codes', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  await f.request('request-email-verification', {}, user.access_token);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_email_codes').get().n, 2);
  assert.equal((await f.request('delete', { password: PASSWORD }, user.access_token)).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_email_codes').get().n, 0);
});

test('failed verification delivery is explicit, installs no code, and does not confirm email', async t => {
  const f = fixture(t);
  const user = await f.signup();
  f.failDelivery();
  const result = await f.request('request-email-verification', {}, user.access_token);
  assert.equal(result.status, 503);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_email_codes').get().n, 0);
  assert.equal((await f.request('user', undefined, user.access_token)).data.email_confirmed_at, null);
});

test('a newer emailed code invalidates the earlier code without removing the new code', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  const first = f.code();
  f.advance(120);
  await f.request('request-email-reset', { email: user.user.email });
  const second = f.code();
  // An identical random replacement is not distinguishable from the earlier code.
  if (first === second) return;
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code: first })).status, 422);
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code: second })).status, 200);
});

test('sending enforces a shared two-minute cooldown for known and unknown accounts', async t => {
  const f = fixture(t);
  const user = await f.signup();
  for (const email of [user.user.email, 'missing@example.test']) {
    const results = await Promise.all([f.request('request-email-reset', { email }), f.request('request-email-reset', { email: `  ${email.toUpperCase()} ` })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 429]);
    const sent = results.find(result => result.status === 200);
    const limited = results.find(result => result.status === 429);
    assert.equal(sent.data.resend_after_seconds, 120);
    assert.equal(limited.data.resend_after_seconds, 120);
    assert.equal(limited.retryAfter, '120');
  }
  assert.equal(f.emails.length, 1);
  f.advance(119);
  const early = await f.request('request-email-reset', { email: user.user.email });
  assert.equal(early.status, 429);
  assert.equal(early.data.resend_after_seconds, 1);
  f.advance(1);
  assert.equal((await f.request('request-email-reset', { email: user.user.email })).status, 200);
  assert.equal(f.emails.length, 2);
  const saved = f.sqlite.prepare('SELECT * FROM auth_email_requests').all();
  assert.ok(saved.every(row => row.email_hash.length === 64 && !row.email_hash.includes('@')));
});

test('a code alone cannot reset a password, and invalid passwords do not consume a verified grant', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  const code = f.code();
  const bypass = await f.request('reset-password', { email: user.user.email, code, password: NEXT, password_confirmation: NEXT });
  assert.equal(bypass.status, 422);
  assert.equal(bypass.data.code, 'reset_token_expired');
  const grant = await f.request('verify-email-reset', { email: user.user.email, code });
  assert.equal(grant.status, 200);
  const payload = { email: user.user.email, reset_token: grant.data.reset_token, password: NEXT, password_confirmation: NEXT };
  const mismatch = await f.request('reset-password', { ...payload, password_confirmation: 'different' });
  assert.equal(mismatch.status, 422);
  assert.notEqual(mismatch.data.code, 'reset_token_expired');
  assert.equal((await f.request('reset-password', { ...payload, password: '12345678', password_confirmation: '12345678' })).status, 422);
  assert.equal((await f.request('reset-password', payload)).status, 200);
});

test('a verified grant is bound to its email and expires after ten minutes', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  const grant = await f.request('verify-email-reset', { email: user.user.email, code: f.code() });
  const payload = { email: user.user.email, reset_token: grant.data.reset_token, password: NEXT, password_confirmation: NEXT };
  const other = await f.request('reset-password', { ...payload, email: 'other@example.test' });
  assert.equal(other.status, 422);
  assert.equal(other.data.code, 'reset_token_expired');
  f.advance(600);
  const expired = await f.request('reset-password', payload);
  assert.equal(expired.status, 422);
  assert.equal(expired.data.code, 'reset_token_expired');
  assert.equal((await f.request('user', undefined, user.access_token)).status, 200);
});

test('a successfully resent code invalidates an already verified reset grant', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  const grant = await f.request('verify-email-reset', { email: user.user.email, code: f.code() });
  f.advance(120);
  await f.request('request-email-reset', { email: user.user.email });
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_password_resets').get().n, 0);
  const old = await f.request('reset-password', { email: user.user.email, reset_token: grant.data.reset_token, password: NEXT, password_confirmation: NEXT });
  assert.equal(old.status, 422);
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code: f.code() })).status, 200);
});

test('failed resend preserves an already verified grant while keeping responses enumeration-safe', async t => {
  const f = fixture(t);
  const user = await f.signup();
  await f.request('request-email-reset', { email: user.user.email });
  const grant = await f.request('verify-email-reset', { email: user.user.email, code: f.code() });
  f.advance(120);
  f.failDelivery();
  const failed = await f.request('request-email-reset', { email: user.user.email });
  const missing = await f.request('request-email-reset', { email: 'missing@example.test' });
  assert.deepEqual(failed, missing);
  assert.equal((await f.request('reset-password', { email: user.user.email, reset_token: grant.data.reset_token, password: NEXT, password_confirmation: NEXT })).status, 200);
});

test('backup recovery, authenticated password change and account deletion revoke verified grants', async t => {
  for (const action of ['recover', 'change-password', 'delete']) {
    await t.test(action, async t => {
      const f = fixture(t);
      const user = await f.signup();
      await f.request('request-email-reset', { email: user.user.email });
      const grant = await f.request('verify-email-reset', { email: user.user.email, code: f.code() });
      const actionData = action === 'recover'
        ? { email: user.user.email, recovery_code: user.recovery_code, password: NEXT, password_confirmation: NEXT }
        : action === 'change-password'
          ? { current_password: PASSWORD, password: NEXT, password_confirmation: NEXT }
          : { password: PASSWORD };
      assert.equal((await f.request(action, actionData, user.access_token)).status, 200);
      assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_password_resets').get().n, 0);
      const old = await f.request('reset-password', { email: user.user.email, reset_token: grant.data.reset_token, password: PASSWORD, password_confirmation: PASSWORD });
      assert.equal(old.status, 422);
      assert.equal(old.data.code, 'reset_token_expired');
    });
  }
});

test('a delayed earlier delivery cannot replace a newer code or revoke its verified grant', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const held = f.holdNextDelivery();
  const firstRequest = f.request('request-email-reset', { email: user.user.email });
  await held.started;
  f.advance(120);
  assert.equal((await f.request('request-email-reset', { email: user.user.email })).status, 200);
  const newerCode = f.code();
  const grant = await f.request('verify-email-reset', { email: user.user.email, code: newerCode });
  assert.equal(grant.status, 200);
  held.release();
  assert.equal((await firstRequest).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_email_codes').get().n, 0);
  assert.equal((await f.request('reset-password', { email: user.user.email, reset_token: grant.data.reset_token, password: NEXT, password_confirmation: NEXT })).status, 200);
});

test('a delayed delivery cannot install a reset code after password change', async t => {
  const f = fixture(t);
  const user = await f.signup();
  const held = f.holdNextDelivery();
  const pending = f.request('request-email-reset', { email: user.user.email });
  await held.started;
  const code = f.code();
  assert.equal((await f.request('change-password', { current_password: PASSWORD, password: NEXT, password_confirmation: NEXT }, user.access_token)).status, 200);
  held.release();
  assert.equal((await pending).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_email_codes').get().n, 0);
  assert.equal((await f.request('verify-email-reset', { email: user.user.email, code })).status, 422);
});

