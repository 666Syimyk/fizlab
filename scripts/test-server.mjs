import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import worker from '../server/worker.mjs';
import { passwordFeedback, passwordStrength } from '../server/passwordPolicy.mjs';

const sqlite = new DatabaseSync(':memory:');
const DB = {
  async exec(sql) { sqlite.exec(sql); },
  prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first(column) { const row = sqlite.prepare(sql).get(...args); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return sqlite.prepare(sql).run(...args); },
      runSync() { return sqlite.prepare(sql).run(...args); },
    };
    return statement;
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(stmt => stmt.runSync()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const env = { DB };
const api = 'http://localhost/api';
const deviceA = crypto.randomUUID();
const deviceB = crypto.randomUUID();
const PASSWORD = 'Unusual river stones at sunrise 42';
const NEXT_PASSWORD = 'Quiet planets circle the blue moon';
assert.equal(passwordFeedback('an unusual phrase with many words'), null);
assert.ok(passwordFeedback('passwordpassword'));
assert.ok(passwordFeedback('N7x!q2L'));
assert.equal(passwordFeedback('N7x!q2Lp'), null);
assert.equal(passwordStrength('N7x!q2Lp').label, 'Допустимый');
function client(deviceId) {
  return createClient(api, 'public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => worker.fetch(new Request(input, {
      ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-fizlab-device-id': deviceId },
    }), env) },
  });
}
async function post(path, deviceId, data, token) {
  const response = await worker.fetch(new Request(`${api}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'x-fizlab-device-id': deviceId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  }), env);
  return { status: response.status, data: await response.json() };
}
async function signup(authClient, deviceId, email, firstName, lastName) {
  const result = await post('signup', deviceId, {
    email, password: PASSWORD, password_confirmation: PASSWORD,
    data: { first_name: firstName, last_name: lastName, intent: 'admin' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const session = await authClient.auth.setSession({ access_token: result.data.access_token, refresh_token: result.data.refresh_token });
  assert.equal(session.error, null);
  return result.data;
}

const first = client(deviceA);
const eightCharacters = await post('signup', deviceA, {
  email: 'eight@example.com', password: 'N7x!q2Lp', password_confirmation: 'N7x!q2Lp',
  data: { first_name: 'Eight', last_name: 'Characters' },
});
assert.equal(eightCharacters.status, 200, JSON.stringify(eightCharacters.data));
const badPassword = await post('signup', deviceA, {
  email: 'bad@example.com', password: 'password123', password_confirmation: 'password123',
  data: { first_name: 'Bad', last_name: 'Password' },
});
assert.equal(badPassword.status, 422);
const mismatch = await post('signup', deviceA, {
  email: 'bad@example.com', password: PASSWORD, password_confirmation: 'different',
  data: { first_name: 'Bad', last_name: 'Password' },
});
assert.equal(mismatch.status, 422);
const missingSurname = await post('signup', deviceA, {
  email: 'bad@example.com', password: PASSWORD, password_confirmation: PASSWORD,
  data: { first_name: 'Bad' },
});
assert.equal(missingSurname.status, 422);

const registered = await signup(first, deviceA, 'user@example.com', 'Ada', 'Lovelace');
const id = registered.user.id;
assert.match(registered.recovery_code, /^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
assert.equal(sqlite.prepare('SELECT code_hash FROM auth_recovery WHERE user_id=?').get(id).code_hash.length, 64);
assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM auth_recovery WHERE user_id=?').get(id)).includes(registered.recovery_code));
const profile = await first.from('profiles').select('*').eq('id', id).maybeSingle();
assert.equal(profile.data.full_name, 'Ada Lovelace');
assert.equal(profile.data.first_name, 'Ada');
assert.equal(profile.data.last_name, 'Lovelace');
assert.equal(profile.data.role, 'student');
assert.equal(profile.data.status, 'approved');
assert.equal(profile.data.university_id, null);
assert.ok((await first.from('universities').select('*')).error);
assert.ok((await first.from('profiles').update({ role: 'admin' }).eq('id', id)).error);
assert.ok((await first.from('profiles').update({ avatar_data: 'data:text/html;base64,PHNjcmlwdD4=' }).eq('id', id)).error);
const avatar = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]).toString('base64')}`;
assert.equal((await first.from('profiles').update({ avatar_data: avatar }).eq('id', id)).error, null);
assert.equal((await first.from('profiles').select('avatar_data').eq('id', id).maybeSingle()).data.avatar_data, avatar);
assert.equal((await first.from('progress').upsert({ user_id: id, solved_problem_ids: { kinematics: ['one'] }, completed_topic_slugs: ['kinematics'] })).error, null);
assert.deepEqual((await first.from('progress').select('*').eq('user_id', id).maybeSingle()).data.completed_topic_slugs, ['kinematics']);

const second = client(deviceB);
assert.equal((await second.auth.signInWithPassword({ email: 'user@example.com', password: 'wrong-password' })).error.status, 401);
assert.equal((await second.auth.signInWithPassword({ email: 'user@example.com', password: PASSWORD })).error, null);
assert.equal((await first.auth.getUser()).error.status, 401, 'old device revoked');
assert.ok((await first.from('progress').select('*')).error);
assert.equal((await second.from('progress').select('*')).data.length, 1);
const { data: activeSession } = await second.auth.getSession();
assert.equal((await worker.fetch(new Request(`${api}/auth/v1/user`, {
  headers: { Authorization: `Bearer ${activeSession.session.access_token}`, 'x-fizlab-device-id': deviceA },
}), env)).status, 401);

const wrongCode = await post('recover', deviceA, {
  email: 'user@example.com', recovery_code: '0000-0000-0000-0000-0000-0000-0000-0000',
  password: NEXT_PASSWORD, password_confirmation: NEXT_PASSWORD,
});
assert.equal(wrongCode.status, 401);
const recovered = await post('recover', deviceA, {
  email: 'user@example.com', recovery_code: registered.recovery_code,
  password: NEXT_PASSWORD, password_confirmation: NEXT_PASSWORD,
});
assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
assert.notEqual(recovered.data.recovery_code, registered.recovery_code);
assert.equal((await second.auth.getUser()).error.status, 401, 'password reset revokes previous device');
assert.equal((await client(deviceB).auth.signInWithPassword({ email: 'user@example.com', password: PASSWORD })).error.status, 401);
assert.equal((await post('recover', deviceB, {
  email: 'user@example.com', recovery_code: registered.recovery_code,
  password: PASSWORD, password_confirmation: PASSWORD,
})).status, 401, 'old recovery code is single-use');

const renewed = client(deviceB);
assert.equal((await renewed.auth.signInWithPassword({ email: 'user@example.com', password: NEXT_PASSWORD })).error, null);
const { data: renewedSession } = await renewed.auth.getSession();
const regeneration = await post('recovery-code', deviceB, { password: NEXT_PASSWORD }, renewedSession.session.access_token);
assert.equal(regeneration.status, 200);
assert.notEqual(regeneration.data.recovery_code, recovered.data.recovery_code);
assert.equal((await post('recover', deviceA, {
  email: 'user@example.com', recovery_code: recovered.data.recovery_code,
  password: PASSWORD, password_confirmation: PASSWORD,
})).status, 401);

const otherDevice = crypto.randomUUID();
const otherClient = client(otherDevice);
assert.ok((await signup(otherClient, otherDevice, 'other@example.com', 'Other', 'Learner')).user);
assert.equal((await otherClient.from('progress').select('*')).data.length, 0);
assert.ok((await otherClient.from('progress').upsert({ user_id: id, solved_problem_ids: {} })).error);

const { data: current } = await renewed.auth.getSession();
const deletion = await post('delete', deviceB, { password: NEXT_PASSWORD }, current.session.access_token);
assert.equal(deletion.status, 200);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_users WHERE id=?').get(id).n, 0);
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM app_records WHERE kind='progress' AND id=?").get(id).n, 0);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_recovery WHERE user_id=?').get(id).n, 0);
sqlite.close();
console.log('PASS names, password policy, confirmation, recovery and single-device progress');
await import('../server/security.test.mjs');
await import('../server/http.test.mjs');
