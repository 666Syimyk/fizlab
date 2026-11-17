export const ADMIN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_admins (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_access_grants (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>0 AND expires_at<=253402300799),
    granted_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
    granted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_app_access_grants_expiry ON app_access_grants(expires_at);
  CREATE INDEX IF NOT EXISTS idx_app_access_grants_author ON app_access_grants(granted_by);
`;

// D1 exec() treats every line as a separate statement, so run each multi-line statement as its own query.
export async function initializeAdmin(db) {
  const statements = ADMIN_SCHEMA.split(';').map(sql => sql.replace(/\s+/g, ' ').trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
}

const epoch = () => Math.floor(Date.now() / 1000);
const iso = seconds => new Date(seconds * 1000).toISOString();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeSession = `EXISTS (SELECT 1 FROM auth_sessions admin_session JOIN auth_users admin_user ON admin_user.id=admin_session.user_id
  WHERE admin_session.user_id=? AND admin_session.access_hash=? AND admin_session.device_hash=? AND admin_session.access_until>unixepoch())`;
const adminRole = 'EXISTS (SELECT 1 FROM app_admins admin_role WHERE admin_role.user_id=?)';

function requireQuery(params, allowed, fail) {
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail('Некорректные параметры запроса.', 422);
}

function integerParam(params, key, fallback, minimum, maximum, fail) {
  if (!params.has(key)) return fallback;
  const raw = params.get(key);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail('Некорректные параметры страницы.', 422);
  return value;
}

export async function accessRequest({ req, env, url, json, fail, body, hash, device, rateLimit, changes }) {
  const db = env.DB;
  const isAccess = url.pathname.startsWith('/api/access/v1/');
  const route = url.pathname.slice((isAccess ? '/api/access/v1/' : '/api/admin/v1/').length);
  const routeMethods = isAccess ? { status: 'GET' } : { overview: 'GET', users: 'GET', 'grant-access': 'POST', 'revoke-access': 'POST' };
  if (!Object.hasOwn(routeMethods, route)) fail('Маршрут не найден.', 404);
  if (req.method !== routeMethods[route]) fail('Метод не поддерживается.', 405);
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!token) fail('Войдите в аккаунт.', 401);
  const accessHash = await hash(token);
  const deviceHash = await device(req);
  const session = await db.prepare('SELECT user_id FROM auth_sessions WHERE access_hash=? AND device_hash=? AND access_until>unixepoch()')
    .bind(accessHash, deviceHash).first();
  if (!session) fail('Сессия завершена. Войдите снова.', 401);
  const userId = session.user_id;
  const sessionValues = [userId, accessHash, deviceHash];
  async function authorize(requireAdmin = !isAccess) {
    const current = await db.prepare(`SELECT ${activeSession} AS authenticated,${adminRole} AS is_admin`).bind(...sessionValues, userId).first();
    if (!current.authenticated) fail('Сессия завершена. Войдите снова.', 401);
    if (requireAdmin && !current.is_admin) fail('Доступ разрешён только супер-администратору.', 403);
    return Boolean(current.is_admin);
  }
  const isSuperadmin = await authorize();
  await rateLimit(req, db, isAccess ? 'access-status' : req.method === 'GET' ? 'admin-read' : 'admin-write', isAccess ? 120 : req.method === 'GET' ? 60 : 20, userId);
  requireQuery(url.searchParams, route === 'users' ? ['search', 'offset', 'limit'] : [], fail);

  if (isAccess) {
    const grant = await db.prepare('SELECT expires_at FROM app_access_grants WHERE user_id=? AND expires_at>?').bind(userId, epoch()).first();
    await authorize(isSuperadmin);
    const hasGrant = Boolean(grant && grant.expires_at > epoch());
    return json({ role: isSuperadmin ? 'superadmin' : 'member', fullAccess: isSuperadmin || hasGrant, source: isSuperadmin ? 'superadmin' : hasGrant ? 'grant' : null, expiresAt: !isSuperadmin && hasGrant ? iso(grant.expires_at) : null, checkedAt: new Date(Date.now()).toISOString() });
  }

  if (route === 'overview') {
    const row = await db.prepare(`SELECT (SELECT count(*) FROM auth_users) AS totalUsers,
      (SELECT count(*) FROM app_admins a JOIN auth_users u ON u.id=a.user_id) AS superadmins,
      (SELECT count(*) FROM app_access_grants g JOIN auth_users u ON u.id=g.user_id WHERE g.expires_at>?) AS activeGrants`).bind(epoch()).first();
    await authorize();
    return json(row);
  }

  if (route === 'users') {
    const params = url.searchParams;
    const search = (params.get('search') || '').trim();
    if (search.length > 254) fail('Поисковый запрос слишком длинный.', 422);
    const offset = integerParam(params, 'offset', 0, 0, 100000, fail);
    const limit = integerParam(params, 'limit', 20, 1, 50, fail);
    const needle = `%${search.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const where = "(u.email LIKE ? ESCAPE '\\' OR coalesce(json_extract(u.metadata,'$.full_name'),'') LIKE ? ESCAPE '\\')";
    const total = await db.prepare(`SELECT count(*) AS total FROM auth_users u WHERE ${where}`).bind(needle, needle).first('total');
    const rows = await db.prepare(`SELECT u.id,u.email,coalesce(json_extract(u.metadata,'$.full_name'),'') AS name,u.created_at,u.email_verified_at,
      a.user_id AS admin_id,g.expires_at FROM auth_users u LEFT JOIN app_admins a ON a.user_id=u.id LEFT JOIN app_access_grants g ON g.user_id=u.id
      WHERE ${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).bind(needle, needle, limit, offset).all();
    await authorize();
    return json({ users: rows.results.map(row => ({ id: row.id, email: row.email, name: typeof row.name === 'string' ? row.name.slice(0, 201) : '', createdAt: row.created_at, emailVerified: Boolean(row.email_verified_at), isSuperadmin: Boolean(row.admin_id), grantExpiresAt: row.expires_at > epoch() ? iso(row.expires_at) : null })), total, offset, limit });
  }

  const data = await body(req);
  const allowed = route === 'grant-access' ? ['user_id', 'days'] : ['user_id'];
  if (Object.keys(data).length !== allowed.length || Object.keys(data).some(key => !allowed.includes(key)) || typeof data.user_id !== 'string' || !uuid.test(data.user_id)) fail('Некорректные параметры доступа.', 422);
  if (route === 'grant-access' && ![30, 365].includes(data.days)) fail('Выберите доступ на 30 или 365 дней.', 422);
  async function targetExists() {
    const target = await db.prepare('SELECT u.id,a.user_id AS admin_id FROM auth_users u LEFT JOIN app_admins a ON a.user_id=u.id WHERE u.id=?').bind(data.user_id).first();
    if (!target) fail('Аккаунт не найден.', 404);
    if (target.admin_id) fail('Доступ супер-администратора нельзя изменить в этой панели.', 409);
  }
  await targetExists();
  // Check the still-active device-bound session and database role inside the SAME
  // SQL mutation. An earlier permission check cannot survive logout/role revocation.
  const guard = `EXISTS (SELECT 1 FROM auth_users WHERE id=?) AND NOT EXISTS (SELECT 1 FROM app_admins WHERE user_id=?) AND ${activeSession} AND ${adminRole}`;
  const guardValues = [data.user_id, data.user_id, ...sessionValues, userId];
  const result = route === 'grant-access'
    ? await db.prepare(`INSERT INTO app_access_grants(user_id,expires_at,granted_by,granted_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at,granted_by=excluded.granted_by,granted_at=excluded.granted_at`)
      .bind(data.user_id, epoch() + data.days * 86400, userId, epoch(), ...guardValues).run()
    : await db.prepare(`DELETE FROM app_access_grants WHERE user_id=? AND ${guard}`).bind(data.user_id, ...guardValues).run();
  await authorize();
  if (!changes(result)) {
    await targetExists();
    if (route === 'grant-access') fail('Доступ не изменён. Обновите страницу и повторите.', 409);
  }
  return json({ success: true });
}
