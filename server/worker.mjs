import { passwordFeedback } from './passwordPolicy.mjs';
import { emailAuth, emailAvailable } from './authEmail.mjs';
import { initializeAdmin, accessRequest } from './admin.mjs';
import { billingConfigured, billingRequest, initializeBilling, billingDeletionStatement, processBillingDeletions, enqueueDeletedBillingCustomer } from './billing.mjs';

const enc = new TextEncoder();
const initialized = new WeakMap();
const now = () => new Date().toISOString();
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const hash = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const changes = result => Number(result.meta?.changes ?? result.changes ?? 0);
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function dispatchBillingDeletion(env, userId, context) {
  if (!billingConfigured(env)) return;
  const deletion = processBillingDeletions(env, userId).catch(() => { console.error('Subscription profile deletion will be retried'); });
  if (context?.waitUntil) context.waitUntil(deletion);
  else await deletion;
}
function secureResponse(response, url, cors = {}) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (headers.get('content-type')?.includes('text/html')) {
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    headers.set('Cache-Control', 'no-cache');
  } else if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', response.ok && /^\/assets\/.+-[\w-]{8,}\.[\w]+$/.test(url.pathname) ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function init(db) {
  if (!initialized.has(db)) initialized.set(db, (async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (access_hash TEXT PRIMARY KEY, refresh_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, access_until INTEGER NOT NULL, refresh_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS app_records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS invite_redemptions (code_id TEXT NOT NULL, user_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_recovery (user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_email_codes (user_id TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,purpose));
      CREATE TABLE IF NOT EXISTS auth_password_resets (user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_email_requests (email_hash TEXT PRIMARY KEY, available_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(refresh_until);
      CREATE INDEX IF NOT EXISTS idx_auth_limits_bucket ON auth_limits(bucket);
      CREATE INDEX IF NOT EXISTS idx_app_records_owner ON app_records(kind,json_extract(data,'$.user_id'));
    `);
    try { await db.exec('ALTER TABLE auth_sessions ADD COLUMN device_hash TEXT'); }
    catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    try { await db.exec('ALTER TABLE auth_users ADD COLUMN email_verified_at TEXT'); }
    catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
    await initializeBilling(db);
    await initializeAdmin(db);
  })().catch(error => { initialized.delete(db); throw error; }));
  return initialized.get(db);
}
const put = (db, kind, id, value) => db.prepare('INSERT INTO app_records(kind,id,data) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM auth_users WHERE id=?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').bind(kind, id, JSON.stringify(value), value.user_id || value.id);
function newRecoveryCode() {
  return random().slice(0, 32).match(/.{4}/g).join('-').toUpperCase();
}
const normalizedRecoveryCode = value => String(value || '').replace(/[\s-]/g, '').toLowerCase();
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}
const publicUser = row => ({ id: row.id, email: row.email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: row.email_verified_at || null, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: JSON.parse(row.metadata), identities: [], created_at: row.created_at, updated_at: row.created_at });
async function device(req) {
  const id = req.headers.get('x-fizlab-device-id') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail('Не удалось определить устройство. Обновите приложение.');
  return hash(id);
}
async function session(db, user, deviceHash, refreshHash = null) {
  if (!user) fail('Сессия завершена. Войдите снова.', 401);
  await db.prepare('INSERT OR IGNORE INTO auth_settings(key,value) VALUES(?,?)').bind('jwt_key', random()).run();
  const secret = await db.prepare('SELECT value FROM auth_settings WHERE key=?').bind('jwt_key').first('value');
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const b64 = text => btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const payload = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ sub: user.id, role: 'authenticated', exp: expiry, iat: expiry - 3600, jti: random() }))}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const access = `${payload}.${b64(String.fromCharCode(...new Uint8Array(signature)))}`;
  const refresh = random();
  const accessHash = await hash(access);
  const nextRefreshHash = await hash(refresh);
  let result;
  if (refreshHash) {
    // Rotate only the still-active token. A concurrent login/logout wins over an old refresh.
    result = await db.prepare('UPDATE auth_sessions SET access_hash=?,refresh_hash=?,access_until=?,refresh_until=? WHERE refresh_hash=? AND user_id=? AND device_hash=? AND refresh_until>? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)')
      .bind(accessHash, nextRefreshHash, expiry, expiry + 30 * 86400, refreshHash, user.id, deviceHash, Math.floor(Date.now() / 1000), user.id, user.password_hash).run();
  } else {
    // Recheck the verified credential inside the transaction before revoking the previous device.
    const results = await db.batch([
      db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, user.password_hash),
      db.prepare('INSERT INTO auth_sessions(access_hash,refresh_hash,user_id,access_until,refresh_until,device_hash) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(accessHash, nextRefreshHash, user.id, expiry, expiry + 30 * 86400, deviceHash, user.id, user.password_hash),
    ]);
    result = results[1];
  }
  if (!changes(result)) fail('Сессия завершена. Войдите снова.', 401);
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: expiry, user: publicUser(user) };
}
async function current(req, db) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const row = await db.prepare('SELECT user_id FROM auth_sessions WHERE access_hash=? AND access_until>? AND device_hash=?').bind(await hash(token), Math.floor(Date.now() / 1000), await device(req)).first();
  return row ? db.prepare('SELECT * FROM auth_users WHERE id=?').bind(row.user_id).first() : null;
}
async function body(req) {
  const limit = 65536;
  if (Number(req.headers.get('content-length')) > limit) fail('Запрос слишком большой.', 413);
  const reader = req.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); fail('Запрос слишком большой.', 413); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  let data;
  try { data = JSON.parse(text || '{}'); } catch { fail('Неверный формат запроса.'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') fail('Ожидается JSON-объект.');
  return data;
}
async function rateLimit(req, db, scope = 'auth', maximum = 20, identity = null) {
  const bucket = Math.floor(Date.now() / 60000);
  const key = await hash(`${scope}:${identity || req.headers.get('cf-connecting-ip') || 'local'}`);
  const row = await db.prepare('INSERT INTO auth_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,count=CASE WHEN auth_limits.bucket=excluded.bucket THEN auth_limits.count+1 ELSE 1 END RETURNING count').bind(key, bucket).first();
  if (row.count > maximum) fail('Слишком много попыток. Подождите минуту.', 429);
  await db.prepare('DELETE FROM auth_limits WHERE bucket<?').bind(bucket - 60).run();
  if (row.count === 1) await db.prepare('DELETE FROM auth_sessions WHERE refresh_until<=?').bind(Math.floor(Date.now() / 1000)).run();
}
async function auth(req, env, url, context) {
  const db = env.DB;
  const path = url.pathname.slice('/api/auth/v1/'.length);
  if (!['settings', 'user', 'logout', 'delete', 'recovery-code', 'recover', 'token', 'signup', 'request-email-reset', 'verify-email-reset', 'reset-password', 'request-email-verification', 'verify-email', 'change-password'].includes(path)) fail('Маршрут не найден.', 404);
  if (path === 'settings' || path === 'user') {
    if (req.method !== 'GET') fail('Метод не поддерживается.', 405);
  }
  if (path === 'settings') return json({ external: { email: true }, disable_signup: false, mailer_autoconfirm: false, email_recovery_available: emailAvailable(env), email_verification_available: emailAvailable(env) });
  if (path === 'user') {
    const user = await current(req, db);
    if (!user) fail('Сессия завершена. Войдите снова.', 401);
    return json(publicUser(user));
  }
  if (req.method !== 'POST') fail('Метод не поддерживается.', 405);
  if (path === 'logout') {
    const user = await current(req, db);
    if (user) await db.prepare('DELETE FROM auth_sessions WHERE access_hash=?').bind(await hash(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '')).run();
    return json({});
  }
  const isRefresh = path === 'token' && url.searchParams.get('grant_type') === 'refresh_token';
  await rateLimit(req, db, isRefresh ? 'refresh' : 'auth', isRefresh ? 120 : 20);
  const data = await body(req);
  if (path === 'delete') {
    const user = await current(req, db);
    if (user) await rateLimit(req, db, 'sensitive-account', 10, user.id);
    if (!user || await passwordHash(String(data.password || ''), user.salt) !== user.password_hash) fail('Неверный пароль.', 401);
    const guardedDelete = sql => db.prepare(`${sql} AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)`).bind(user.id, user.id, user.password_hash);
    const results = await db.batch([
      billingDeletionStatement(db, user),
      guardedDelete('DELETE FROM invite_redemptions WHERE user_id=?'),
      guardedDelete("DELETE FROM app_records WHERE kind='invite_codes' AND json_extract(data,'$.created_by')=?"),
      guardedDelete("DELETE FROM app_records WHERE kind='events' AND json_extract(data,'$.user_id')=?"),
      guardedDelete("DELETE FROM app_records WHERE kind='progress' AND id=?"),
      guardedDelete("DELETE FROM app_records WHERE kind='profiles' AND id=?"),
      guardedDelete('DELETE FROM auth_sessions WHERE user_id=?'),
      guardedDelete('DELETE FROM auth_recovery WHERE user_id=?'),
      guardedDelete('DELETE FROM auth_email_codes WHERE user_id=?'),
      guardedDelete('DELETE FROM auth_password_resets WHERE user_id=?'),
      guardedDelete('DELETE FROM app_admins WHERE user_id=?'),
      guardedDelete('DELETE FROM app_access_grants WHERE user_id=?'),
      db.prepare('UPDATE app_access_grants SET granted_by=NULL WHERE granted_by=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, user.password_hash),
      db.prepare('DELETE FROM auth_users WHERE id=? AND password_hash=?').bind(user.id, user.password_hash),
    ]);
    if (!changes(results.at(-1))) fail('Сессия завершена. Войдите снова.', 401);
    await dispatchBillingDeletion(env, user.id, context);
    return json({});
  }
  const deviceHash = await device(req);
  const emailResult = await emailAuth({ path, req, env, db, data, deviceHash, current, json, fail, rateLimit, passwordHash, passwordFeedback, random, newRecoveryCode, hash, normalizedRecoveryCode, session, publicUser, changes });
  if (emailResult) return emailResult;
  if (path === 'recovery-code') {
    const user = await current(req, db);
    if (user) await rateLimit(req, db, 'sensitive-account', 10, user.id);
    if (!user || await passwordHash(String(data.password || ''), user.salt) !== user.password_hash) fail('Неверный пароль.', 401);
    const code = newRecoveryCode();
    const result = await db.prepare('INSERT INTO auth_recovery(user_id,code_hash) SELECT ?,? WHERE EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').bind(user.id, await hash(normalizedRecoveryCode(code)), user.id, user.password_hash).run();
    if (!changes(result)) fail('Сессия завершена. Войдите снова.', 401);
    return json({ recovery_code: code });
  }
  if (path === 'recover') {
    const email = String(data.email || '').trim().toLowerCase();
    const code = normalizedRecoveryCode(data.recovery_code);
    const user = await db.prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first();
    const saved = user ? await db.prepare('SELECT code_hash FROM auth_recovery WHERE user_id=?').bind(user.id).first() : null;
    if (!/^[0-9a-f]{32}$/.test(code) || !saved || await hash(code) !== saved.code_hash) fail('Неверный email или резервный код.', 401);
    const metadata = JSON.parse(user.metadata);
    const nextPassword = String(data.password || '');
    const feedback = passwordFeedback(nextPassword, { email, firstName: metadata.first_name, lastName: metadata.last_name });
    if (feedback) fail(feedback, 422);
    if (nextPassword !== data.password_confirmation) fail('Пароли не совпадают.', 422);
    const nextSalt = random();
    const nextCode = newRecoveryCode();
    const nextHash = await passwordHash(nextPassword, nextSalt);
    const results = await db.batch([
      db.prepare('UPDATE auth_users SET salt=?,password_hash=? WHERE id=? AND password_hash=? AND EXISTS (SELECT 1 FROM auth_recovery WHERE user_id=? AND code_hash=?)').bind(nextSalt, nextHash, user.id, user.password_hash, user.id, saved.code_hash),
      db.prepare('UPDATE auth_recovery SET code_hash=? WHERE user_id=? AND code_hash=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(await hash(normalizedRecoveryCode(nextCode)), user.id, saved.code_hash, user.id, nextHash),
      db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, nextHash),
      db.prepare('DELETE FROM auth_email_codes WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, nextHash),
      db.prepare('DELETE FROM auth_password_resets WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, nextHash),
    ]);
    if (!changes(results[0])) fail('Неверный email или резервный код.', 401);
    const updated = { ...user, salt: nextSalt, password_hash: nextHash };
    return json({ ...await session(db, updated, deviceHash), recovery_code: nextCode });
  }
  if (isRefresh) {
    const refreshHash = await hash(String(data.refresh_token || ''));
    const old = await db.prepare('SELECT user_id FROM auth_sessions WHERE refresh_hash=? AND refresh_until>? AND device_hash=?').bind(refreshHash, Math.floor(Date.now() / 1000), deviceHash).first();
    if (!old) fail('Сессия завершена. Войдите снова.', 401);
    const user = await db.prepare('SELECT * FROM auth_users WHERE id=?').bind(old.user_id).first();
    return json(await session(db, user, deviceHash, refreshHash));
  }
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 256) fail('Укажите корректные email и пароль.', 422);
  if (path === 'token') {
    await rateLimit(req, db, 'password-login', 10, email);
    const user = await db.prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first();
    const computed = await passwordHash(password, user?.salt || 'unknown-user-salt');
    if (!user || computed !== user.password_hash) fail('Неверный email или пароль.', 401);
    return json(await session(db, user, deviceHash));
  }
  if (path !== 'signup') fail('Маршрут не найден.', 404);
  const firstName = String(data.data?.first_name || '').trim();
  const lastName = String(data.data?.last_name || '').trim();
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) fail('Укажите имя и фамилию (до 100 символов каждое).', 422);
  const feedback = passwordFeedback(password, { email, firstName, lastName });
  if (feedback) fail(feedback, 422);
  if (password !== data.password_confirmation) fail('Пароли не совпадают.', 422);
  const name = `${firstName} ${lastName}`;
  const recoveryCode = newRecoveryCode();
  const user = { id: crypto.randomUUID(), email, salt: random(), password_hash: '', metadata: JSON.stringify({ first_name: firstName, last_name: lastName, full_name: name }), created_at: now() };
  user.password_hash = await passwordHash(password, user.salt);
  try {
    await db.batch([
      db.prepare('INSERT INTO auth_users(id,email,salt,password_hash,metadata,created_at) VALUES(?,?,?,?,?,?)').bind(user.id, user.email, user.salt, user.password_hash, user.metadata, user.created_at),
      put(db, 'profiles', user.id, { id: user.id, first_name: firstName, last_name: lastName, full_name: name, avatar_data: null, role: 'student', status: 'approved', university_id: null, created_at: now() }),
      db.prepare('INSERT INTO auth_recovery(user_id,code_hash) VALUES(?,?)').bind(user.id, await hash(normalizedRecoveryCode(recoveryCode))),
    ]);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) fail('Этот email уже зарегистрирован.', 422);
    throw error;
  }
  return json({ ...await session(db, user, deviceHash), recovery_code: recoveryCode });
}
const columns = {
  profiles: ['id','first_name','last_name','full_name','avatar_data','role','status','university_id','created_at'],
  progress: ['user_id','solved_problem_ids','completed_topic_slugs','updated_at'],
  events: ['id','user_id','type','topic_slug','created_at'],
};
async function rest(req, env, url) {
  const db = env.DB;
  const kind = url.pathname.slice('/api/rest/v1/'.length);
  if (!Object.hasOwn(columns, kind)) fail('Таблица не найдена.', 404);
  const user = await current(req, db);
  if (!user) fail('Сессия завершена. Войдите снова.', 401);
  const params = url.searchParams;
  const clauses = ['kind=?', kind === 'events' ? "json_extract(data,'$.user_id')=?" : 'id=?'];
  const binds = [kind, user.id];
  for (const [field, value] of params) {
    if (!columns[kind].includes(field)) continue;
    if (!value.startsWith('eq.')) fail('Фильтр не поддерживается.');
    const operand = value.slice(3);
    clauses.push(`json_extract(data,'$.${field}')=?`);
    binds.push(operand);
  }
  const limit = params.has('limit') ? Math.min(1000, Math.max(0, Number(params.get('limit')) || 0)) : 1000;
  if (!Number.isInteger(limit)) fail('Некорректный лимит.');
  let rows = [];
  if (req.method === 'GET' || (req.method === 'PATCH' && kind === 'profiles')) {
    const result = await db.prepare(`SELECT data FROM app_records WHERE ${clauses.join(' AND ')} LIMIT ?`).bind(...binds, req.method === 'GET' ? limit : 1).all();
    rows = result.results.map(row => JSON.parse(row.data));
  }
  if (req.method === 'POST' || req.method === 'PATCH') await rateLimit(req, db, 'write', 120, user.id);
  if (req.method === 'GET') {
    // Ownership and the result limit are enforced by SQLite before materialization.
  } else if (req.method === 'PATCH' && kind === 'profiles') {
    const data = await body(req);
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'avatar_data')) fail('Можно изменить только фото профиля.', 403);
    const avatar = data.avatar_data;
    if (avatar !== null) {
      if (typeof avatar !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar) || avatar.length > 48000) fail('Фото должно быть JPEG размером до 35 КБ.', 422);
      let bytes;
      try { bytes = Uint8Array.from(atob(avatar.split(',')[1]), character => character.charCodeAt(0)); }
      catch { fail('Некорректное фото.', 422); }
      if (bytes.length > 35000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail('Некорректное фото.', 422);
    }
    rows = rows.map(row => ({ ...row, avatar_data: avatar }));
    if (rows.length) {
      const results = await db.batch(rows.map(row => put(db, kind, row.id, row)));
      if (results.some(result => !changes(result))) fail('Сессия завершена. Войдите снова.', 401);
    }
  } else if (req.method === 'POST' && (kind === 'progress' || kind === 'events')) {
    const data = await body(req);
    if (!data || Array.isArray(data) || Object.keys(data).some(key => !columns[kind].includes(key)) || data.user_id !== user.id) fail('Недостаточно прав.', 403);
    if (kind === 'progress') {
      const solved = data.solved_problem_ids === undefined ? {} : data.solved_problem_ids;
      if (!solved || Array.isArray(solved) || typeof solved !== 'object' || Object.keys(solved).length > 256 || Object.keys(solved).some(slug => !/^[a-z0-9-]{1,128}$/.test(slug)) || Object.values(solved).some(ids => !Array.isArray(ids) || ids.length > 1000 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id.length || id.length > 128))) fail('Некорректный прогресс.');
      const completed = data.completed_topic_slugs === undefined ? [] : data.completed_topic_slugs;
      if (!Array.isArray(completed) || completed.length > 256 || completed.some(slug => typeof slug !== 'string' || !/^[a-z0-9-]{1,128}$/.test(slug)) || new Set(completed).size !== completed.length) fail('Некорректный список изученных тем.');
      rows = [{ user_id: user.id, solved_problem_ids: solved, completed_topic_slugs: completed, updated_at: now() }];
      if (!changes(await put(db, kind, user.id, rows[0]).run())) fail('Сессия завершена. Войдите снова.', 401);
    } else {
      if (!['topic_opened','problem_solved','sim_started'].includes(data.type)) fail('Некорректное событие.');
      const id = crypto.randomUUID();
      rows = [{ id, user_id: user.id, type: data.type, topic_slug: typeof data.topic_slug === 'string' ? data.topic_slug.slice(0, 128) : null, created_at: now() }];
      if (!changes(await put(db, kind, id, rows[0]).run())) fail('Сессия завершена. Войдите снова.', 401);
    }
  } else fail('Метод не поддерживается.', 405);
  if (req.headers.get('accept')?.includes('application/vnd.pgrst.object+json')) {
    if (rows.length !== 1) return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` }, 406);
    return json(rows[0]);
  }
  return json(rows);
}
export default {
  async scheduled(_controller, env) {
    await init(env.DB);
    await processBillingDeletions(env);
  },
  async fetch(req, env, context) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = origin && (origin === url.origin || origin === 'https://localhost' || origin === 'http://localhost') ? {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-fizlab-device-id',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Vary': 'Origin',
    } : {};
    try {
      if (url.pathname.startsWith('/api/')) {
        if (origin && !Object.keys(cors).length) fail('Недопустимый источник запроса.', 403);
        if (req.method === 'OPTIONS') return secureResponse(new Response(null, { status: 204 }), url, cors);
        if (!env.DB) fail('База данных не подключена.', 503);
        await init(env.DB);
        let response;
        if (url.pathname === '/api/health') response = json({ ok: true, backend: 'd1', billing: billingConfigured(env), email: emailAvailable(env), sandboxBilling: env.REVENUECAT_ALLOW_SANDBOX === '1' });
        else if (url.pathname.startsWith('/api/auth/v1/')) response = await auth(req, env, url, context);
        else if (url.pathname.startsWith('/api/access/v1/') || url.pathname.startsWith('/api/admin/v1/')) response = await accessRequest({ req, env, url, json, fail, body, hash, device, rateLimit, changes });
        else if (url.pathname.startsWith('/api/billing/v1/')) {
          const user = await current(req, env.DB);
          if (user) await rateLimit(req, env.DB, 'billing', 30, user.id);
          try { response = await billingRequest(req, env, url, user); }
          finally {
            if (user && !await env.DB.prepare('SELECT id FROM auth_users WHERE id=?').bind(user.id).first()) {
              await enqueueDeletedBillingCustomer(env.DB, user.id);
              await dispatchBillingDeletion(env, user.id, context);
            }
          }
          // A slow provider response must not resurrect a revoked/deleted account session.
          if (!(await current(req, env.DB))) fail('Сессия завершена. Войдите снова.', 401);
        }
        else if (url.pathname.startsWith('/api/rest/v1/')) response = await rest(req, env, url);
        else fail('Маршрут не найден.', 404);
        return secureResponse(response, url, cors);
      }
      let response = await env.ASSETS.fetch(req);
      if (response.status === 404 && !url.pathname.split('/').pop().includes('.')) response = await env.ASSETS.fetch(new Request(new URL('/', url), req));
      return secureResponse(response, url);
    } catch (error) {
      if (!error.status) console.error('API request failed:', error);
      const response = json({ message: error.status ? error.message : 'Не удалось выполнить запрос.', error_code: 'request_failed' }, error.status || 500);
      if (error.status === 429) response.headers.set('Retry-After', String(60 - Math.floor(Date.now() / 1000) % 60));
      return secureResponse(response, url, cors);
    }
  },
};
