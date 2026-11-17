const encoder = new TextEncoder();
const epoch = () => Math.floor(Date.now() / 1000);
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const normalizedCode = value => String(value || '').replace(/[\s-]/g, '');
const resendDelay = 120;
const resetLifetime = 600;
const genericRequest = { message: 'Если аккаунт с этим email существует, письмо с кодом будет отправлено. Проверьте входящие и спам.', resend_after_seconds: resendDelay };

export function emailAvailable(env) {
  return ['1', 'true'].includes(String(env.AUTH_EMAIL_ENABLED).toLowerCase()) && Boolean(env.RESEND_API_KEY?.trim() && env.AUTH_EMAIL_FROM?.trim());
}

function createCode() {
  // Rejection sampling avoids bias; the code has a five-attempt lifetime limit.
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4200000000);
  return String(value % 100000000).padStart(8, '0');
}

async function digestCode(env, userId, purpose, code) {
  // A server-only pepper prevents a stolen database from exposing short codes.
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.AUTH_EMAIL_CODE_SECRET || env.RESEND_API_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`fizlab-email-code:v1:${userId}:${purpose}:${code}`));
  return Array.from(new Uint8Array(signed), value => value.toString(16).padStart(2, '0')).join('');
}

async function issueCode(db, env, user, purpose, requestClaim = null) {
  const code = createCode();
  const codeHash = await digestCode(env, user.id, purpose, code);
  const expiresAt = epoch() + 15 * 60;
  const verification = purpose === 'verify';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.AUTH_EMAIL_FROM,
        to: [user.email],
        subject: verification ? 'Подтверждение email — ФизЛаб 3D' : 'Восстановление пароля — ФизЛаб 3D',
        text: `${verification ? 'Код подтверждения email' : 'Код восстановления пароля'}: ${code}\n\nВведите его в приложении ФизЛаб 3D. Код действует 15 минут и может быть использован один раз. Никому не сообщайте код. Если вы не запрашивали это письмо, проигнорируйте его.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    // Do not include provider responses, email addresses, or credentials in logs/errors.
    const accepted = response.ok ? await response.json().catch(() => null) : null;
    if (!accepted || typeof accepted.id !== 'string' || !accepted.id) throw new Error('Email provider rejected the request');
  } catch {
    console.error('Authentication email delivery failed');
    return false;
  }
  // Keep an earlier usable code/grant if delivery fails. Replace both together only
  // after provider acceptance, and only while the original credential still exists.
  const issued = await db.batch([
    db.prepare(`INSERT INTO auth_email_codes(user_id,purpose,code_hash,expires_at,attempts) SELECT ?,?,?,?,0 WHERE EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)${requestClaim ? ' AND EXISTS (SELECT 1 FROM auth_email_requests WHERE email_hash=? AND available_at=?)' : ''} ON CONFLICT(user_id,purpose) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0`)
      .bind(user.id, purpose, codeHash, expiresAt, user.id, user.password_hash, ...(requestClaim ? [requestClaim.emailHash, requestClaim.availableAt] : [])),
    ...(purpose === 'reset' ? [db.prepare("DELETE FROM auth_password_resets WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_email_codes WHERE user_id=? AND purpose='reset' AND code_hash=?)")
      .bind(user.id, user.id, codeHash)] : []),
  ]);
  return Boolean(Number(issued[0].meta?.changes ?? issued[0].changes ?? 0));
}

async function checkCode(db, env, user, purpose, value) {
  if (!user) return null;
  // Increment before comparison. Five guesses exhaust this code, across IPs/devices.
  const saved = await db.prepare('UPDATE auth_email_codes SET attempts=attempts+1 WHERE user_id=? AND purpose=? AND expires_at>? AND attempts<5 RETURNING code_hash,expires_at')
    .bind(user.id, purpose, epoch()).first();
  const code = normalizedCode(value);
  if (!saved || !/^\d{8}$/.test(code) || await digestCode(env, user.id, purpose, code) !== saved.code_hash) return null;
  return saved;
}

export async function emailAuth({ path, req, env, db, data, deviceHash, current, json, fail, rateLimit, passwordHash, passwordFeedback, random, newRecoveryCode, hash, normalizedRecoveryCode, session, publicUser, changes }) {
  const routes = ['request-email-reset', 'verify-email-reset', 'reset-password', 'request-email-verification', 'verify-email', 'change-password'];
  if (!routes.includes(path)) return null;
  if (path !== 'change-password' && !emailAvailable(env)) fail('Письма временно недоступны. Используйте резервный код или повторите позже.', 503);
  await db.prepare('DELETE FROM auth_email_codes WHERE expires_at<=?').bind(epoch()).run();
  await db.prepare('DELETE FROM auth_password_resets WHERE expires_at<=?').bind(epoch()).run();

  if (path === 'request-email-reset') {
    const email = normalizeEmail(data.email);
    if (!validEmail(email)) fail('Укажите корректный email.', 422);
    await rateLimit(req, db, 'email-reset-send', 3, email);
    // Claim the cooldown atomically, including for unknown email addresses. Its result
    // never reveals account existence, even across devices or concurrent requests.
    const emailHash = await hash(`email-reset-send:${email}`);
    const availableAt = epoch() + resendDelay;
    const claimed = await db.prepare('INSERT INTO auth_email_requests(email_hash,available_at) VALUES(?,?) ON CONFLICT(email_hash) DO UPDATE SET available_at=excluded.available_at WHERE auth_email_requests.available_at<=? RETURNING available_at')
      .bind(emailHash, availableAt, epoch()).first();
    if (!claimed) {
      const saved = await db.prepare('SELECT available_at FROM auth_email_requests WHERE email_hash=?').bind(emailHash).first();
      const remaining = Math.max(1, (saved?.available_at ?? availableAt) - epoch());
      const response = json({ message: 'Код уже запрошен. Подождите перед повторной отправкой.', code: 'resend_cooldown', resend_after_seconds: remaining }, 429);
      response.headers.set('Retry-After', String(remaining));
      return response;
    }
    await db.prepare('DELETE FROM auth_email_requests WHERE available_at<=?').bind(epoch() - 86400).run();
    const user = await db.prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first();
    if (user) await issueCode(db, env, user, 'reset', { emailHash, availableAt });
    // Account existence and delivery failures must not be disclosed to anonymous callers.
    return json(genericRequest);
  }

  if (path === 'verify-email-reset') {
    const email = normalizeEmail(data.email);
    if (!validEmail(email)) fail('Укажите корректный email.', 422);
    await rateLimit(req, db, 'email-reset-check', 5, email);
    const user = await db.prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first();
    const saved = await checkCode(db, env, user, 'reset', data.code);
    if (!saved) fail('Неверный или просроченный код. Проверьте код или запросите новое письмо.', 422);
    const resetToken = random();
    const tokenHash = await hash(resetToken);
    const results = await db.batch([
      db.prepare("INSERT INTO auth_password_resets(user_id,token_hash,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM auth_email_codes WHERE user_id=? AND purpose='reset' AND code_hash=? AND expires_at>?) AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at")
        .bind(user.id, tokenHash, epoch() + resetLifetime, user.id, saved.code_hash, epoch(), user.id, user.password_hash),
      db.prepare("DELETE FROM auth_email_codes WHERE user_id=? AND purpose='reset' AND code_hash=? AND EXISTS (SELECT 1 FROM auth_password_resets WHERE user_id=? AND token_hash=?)")
        .bind(user.id, saved.code_hash, user.id, tokenHash),
    ]);
    if (!changes(results[0])) fail('Код уже использован или устарел. Запросите новое письмо.', 422);
    return json({ reset_token: resetToken, expires_in: resetLifetime });
  }

  if (path === 'request-email-verification' || path === 'verify-email') {
    const user = await current(req, db);
    if (!user) fail('Сессия завершена. Войдите снова.', 401);
    if (user.email_verified_at) return json({ user: publicUser(user), verified: true });
    if (path === 'request-email-verification') {
      await rateLimit(req, db, 'email-verification-send', 3, user.id);
      if (!await issueCode(db, env, user, 'verify')) fail('Не удалось отправить письмо. Повторите позже.', 503);
      return json({ message: 'Письмо с кодом отправлено. Проверьте входящие и спам.' });
    }
    await rateLimit(req, db, 'email-verification-check', 5, user.id);
    const saved = await checkCode(db, env, user, 'verify', data.code);
    if (!saved) fail('Неверный или просроченный код. Запросите новое письмо.', 422);
    const verifiedAt = new Date().toISOString();
    const results = await db.batch([
      db.prepare("UPDATE auth_users SET email_verified_at=? WHERE id=? AND password_hash=? AND email_verified_at IS NULL AND EXISTS (SELECT 1 FROM auth_email_codes WHERE user_id=? AND purpose='verify' AND code_hash=? AND expires_at>?)")
        .bind(verifiedAt, user.id, user.password_hash, user.id, saved.code_hash, epoch()),
      db.prepare("DELETE FROM auth_email_codes WHERE user_id=? AND purpose='verify' AND code_hash=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND email_verified_at=?)")
        .bind(user.id, saved.code_hash, user.id, verifiedAt),
    ]);
    if (!changes(results[0])) fail('Код уже использован. Обновите страницу.', 422);
    return json({ user: publicUser({ ...user, email_verified_at: verifiedAt }), verified: true });
  }

  const isReset = path === 'reset-password';
  const email = normalizeEmail(data.email);
  if (isReset) {
    if (!validEmail(email)) fail('Укажите корректный email.', 422);
    await rateLimit(req, db, 'email-reset-finish', 5, email);
  }
  const user = isReset ? await db.prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first() : await current(req, db);
  if (!isReset && user) await rateLimit(req, db, 'sensitive-account', 10, user.id);
  const resetToken = String(data.reset_token || '');
  const saved = isReset && user && /^[a-f0-9]{64}$/.test(resetToken)
    ? await db.prepare('SELECT token_hash FROM auth_password_resets WHERE user_id=? AND token_hash=? AND expires_at>?').bind(user.id, await hash(resetToken), epoch()).first()
    : null;
  if (isReset && !saved) return json({ message: 'Подтверждение кода истекло или уже использовано. Запросите новое письмо.', code: 'reset_token_expired' }, 422);
  if (!isReset && (!user || await passwordHash(String(data.current_password || ''), user.salt) !== user.password_hash)) fail('Неверный текущий пароль.', 401);
  const metadata = JSON.parse(user.metadata);
  const password = String(data.password || '');
  const feedback = passwordFeedback(password, { email: user.email, firstName: metadata.first_name, lastName: metadata.last_name });
  if (feedback) fail(feedback, 422);
  if (password !== data.password_confirmation) fail('Пароли не совпадают.', 422);
  const salt = random();
  const nextHash = await passwordHash(password, salt);
  const backupCode = newRecoveryCode();
  const verifiedAt = isReset ? (user.email_verified_at || new Date().toISOString()) : user.email_verified_at;
  const guard = isReset ? ' AND EXISTS (SELECT 1 FROM auth_password_resets WHERE user_id=? AND token_hash=? AND expires_at>?)' : '';
  const update = db.prepare(`UPDATE auth_users SET salt=?,password_hash=?,email_verified_at=? WHERE id=? AND password_hash=?${guard}`)
    .bind(salt, nextHash, verifiedAt || null, user.id, user.password_hash, ...(isReset ? [user.id, saved.token_hash, epoch()] : []));
  const results = await db.batch([
    update,
    db.prepare('INSERT INTO auth_recovery(user_id,code_hash) SELECT ?,? WHERE EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').bind(user.id, await hash(normalizedRecoveryCode(backupCode)), user.id, nextHash),
    db.prepare('DELETE FROM auth_email_codes WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, nextHash),
    db.prepare('DELETE FROM auth_password_resets WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, nextHash),
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, nextHash),
  ]);
  if (!changes(results[0])) {
    if (isReset) return json({ message: 'Подтверждение кода истекло или уже использовано. Запросите новое письмо.', code: 'reset_token_expired' }, 422);
    fail('Запрос уже использован или устарел. Повторите действие.', 422);
  }
  if (isReset) return json({ success: true, recovery_code: backupCode });
  return json({ ...await session(db, { ...user, salt, password_hash: nextHash, email_verified_at: verifiedAt }, deviceHash), recovery_code: backupCode });
}
