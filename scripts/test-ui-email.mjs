// Browser coverage of email/account UX with fully mocked APIs; no mail or purchases are sent.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const base = (process.env.EMAIL_UI_URL || process.env.SMOKE_URL || 'http://127.0.0.1:5188').replace(/\/+$/, '');
const origin = new URL(base).origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'This isolated UI test accepts only a local frontend');
const PASSWORD = 'Quiet orange clouds cross the valley 42';
const NEXT_PASSWORD = 'Bright silver stars above the mountains 73';
const CODE = '24681357';
const BACKUP = '1234-5678-ABCD-EF12-3456-7890-ABCD-EF12';
const browser = await chromium.launch({ headless: true });
let completed = 0;

async function fixture({ email = 'email-ui@example.test', enabled = true, width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = randomUUID();
  const state = { password: PASSWORD, verified: false, sendFails: false, expiredReset: false, resetToken: null, resetCompleted: false, calls: [] };
  const validTokens = new Set();
  const refreshTokens = new Set();
  const user = () => ({
    id, email, aud: 'authenticated', role: 'authenticated',
    email_confirmed_at: state.verified ? '2026-09-30T12:00:00.000Z' : null,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { first_name: 'Аудит', last_name: 'Почты', full_name: 'Аудит Почты' },
    identities: [], created_at: '2026-09-30T12:00:00.000Z', updated_at: '2026-09-30T12:00:00.000Z',
  });
  function session() {
    const expires_at = Math.floor(Date.now() / 1000) + 3600;
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const access_token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: expires_at, iat: expires_at - 3600, jti: randomUUID() })}.${Buffer.from('isolated-ui-signature').toString('base64url')}`;
    const refresh_token = randomUUID();
    validTokens.clear(); refreshTokens.clear();
    validTokens.add(access_token); refreshTokens.add(refresh_token);
    return { access_token, refresh_token, user: user(), token_type: 'bearer', expires_in: 3600, expires_at };
  }
  // Block all external resources. Every API route below is fulfilled locally in Playwright.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\//, '');
    const data = request.postDataJSON() || {};
    const token = request.headers().authorization?.replace(/^Bearer\s+/i, '');
    const authenticated = validTokens.has(token);
    state.calls.push({ path, method: request.method(), data });
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === 'auth/v1/settings') return respond({ email_recovery_available: enabled, email_verification_available: enabled, mailer_autoconfirm: false });
    if (path === 'auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      return data.email === email && data.password === state.password ? respond(session()) : respond({ message: 'Неверный email или пароль.' }, 401);
    }
    if (path === 'auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return refreshTokens.has(data.refresh_token) ? respond(session()) : respond({ message: 'Сессия завершена.' }, 401);
    }
    if (path === 'auth/v1/user') {
      return authenticated ? respond(user()) : respond({ message: 'Сессия завершена.' }, 401);
    }
    if (path === 'auth/v1/logout') { validTokens.clear(); refreshTokens.clear(); return respond({}); }
    if (path === 'auth/v1/request-email-reset') return state.sendFails || !enabled
      ? respond({ message: 'Письма временно недоступны. Используйте резервный код или повторите позже.' }, 503)
      : respond({ message: 'Если аккаунт с этим email существует, письмо с кодом будет отправлено. Проверьте входящие и спам.', resend_after_seconds: 120 });
    if (path === 'auth/v1/verify-email-reset') {
      assert.deepEqual(Object.keys(data).sort(), ['code', 'email']);
      if (data.email !== email || data.code !== CODE) return respond({ message: 'Неверный или просроченный код. Запросите новое письмо.' }, 422);
      state.resetToken = randomUUID();
      return respond({ reset_token: state.resetToken, expires_in: 600 });
    }
    if (path === 'auth/v1/reset-password') {
      assert.deepEqual(Object.keys(data).sort(), ['email', 'password', 'password_confirmation', 'reset_token']);
      if (state.expiredReset || data.email !== email || data.reset_token !== state.resetToken || !state.resetToken) {
        return respond({ message: 'Подтверждение кода истекло или уже использовано. Запросите новое письмо.', code: 'reset_token_expired' }, 422);
      }
      assert.equal(data.password, data.password_confirmation);
      state.password = data.password; state.verified = true; state.resetCompleted = true;
      state.resetToken = null;
      return respond({ success: true, recovery_code: BACKUP });
    }
    if (path === 'auth/v1/request-email-verification') {
      if (!authenticated) return respond({ message: 'Сессия завершена.' }, 401);
      return state.sendFails ? respond({ message: 'Не удалось отправить письмо. Повторите позже.' }, 503) : respond({ message: 'Письмо с кодом отправлено. Проверьте входящие и спам.' });
    }
    if (path === 'auth/v1/verify-email') {
      if (!authenticated) return respond({ message: 'Сессия завершена.' }, 401);
      if (data.code !== CODE) return respond({ message: 'Неверный или просроченный код. Запросите новое письмо.' }, 422);
      state.verified = true;
      return respond({ user: user(), verified: true });
    }
    if (path === 'auth/v1/change-password') {
      if (!authenticated || data.current_password !== state.password) return respond({ message: 'Неверный текущий пароль.' }, 401);
      assert.equal(data.password, data.password_confirmation);
      state.password = data.password;
      return respond({ ...session(), recovery_code: BACKUP });
    }
    if (path === 'billing/v1/status' || path === 'billing/v1/sync') return respond({ configured: false, entitlement: { active: false, expiresAt: null, productId: null, store: null, willRenew: false }, checkedAt: new Date().toISOString() });
    if (path === 'rest/v1/profiles') return respond([{ id, first_name: 'Аудит', last_name: 'Почты', full_name: 'Аудит Почты', avatar_data: null, role: 'student', status: 'approved' }]);
    if (path === 'rest/v1/progress' || path === 'rest/v1/events') return respond([]);
    errors.push(`Unexpected mocked API request: ${path}`);
    return respond({ message: 'Unknown mock route' }, 404);
  });
  async function login() {
    await page.goto(`${base}/login?next=%2Faccount`);
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    await page.getByPlaceholder('Пароль', { exact: true }).fill(state.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL(`${base}/account`);
    await page.getByText(email, { exact: true }).waitFor();
  }
  return { context, page, state, errors, email, login };
}

async function scenario(name, run, options) {
  const f = await fixture(options);
  try { await run(f); assert.deepEqual(f.errors, []); completed++; console.log(`PASS ${name}`); }
  finally { await f.context.close(); }
}

try {
  await scenario('email remains the initial step when delivery is unavailable; backup recovery is explicitly selected', async ({ page, email }) => {
    await page.goto(`${base}/recover`);
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    assert.equal(await page.getByPlaceholder('Резервный код', { exact: true }).count(), 0);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Письма временно недоступны.' }).waitFor();
    assert.equal(await page.getByPlaceholder('8 цифр из письма').count(), 0);
    await page.getByRole('button', { name: 'Использовать резервный код', exact: true }).click();
    await page.getByPlaceholder('Резервный код', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Сменить пароль', exact: true }).isEnabled(), true);
  }, { enabled: false });

  await scenario('email recovery verifies the OTP before allowing new passwords and never signs in automatically', async ({ page, state, email }) => {
    await page.goto(`${base}/recover`);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).waitFor();
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    state.sendFails = true;
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Письма временно недоступны.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Получить код на email', exact: true }).isEnabled(), true);
    state.sendFails = false;
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Если аккаунт с этим email существует' }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.getByPlaceholder('8 цифр из письма').fill('00000000');
    await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Неверный или просроченный код.' }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(state.calls.some(call => call.path === 'auth/v1/reset-password'), false);
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
    await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(NEXT_PASSWORD);
    assert.equal(await page.getByPlaceholder('8 цифр из письма').count(), 0);
    await page.getByPlaceholder('Повторите пароль').fill(`${NEXT_PASSWORD} mismatch`);
    await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Пароли не совпадают.' }).first().waitFor();
    assert.equal(state.calls.some(call => call.path === 'auth/v1/reset-password'), false);
    await page.getByPlaceholder('Повторите пароль').fill(NEXT_PASSWORD);
    await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
    await page.getByRole('heading', { name: 'Пароль изменён', exact: true }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(state.calls.some(call => call.path === 'auth/v1/user' || call.path === 'auth/v1/token'), false);
    const stored = await page.evaluate(() => ({ ...localStorage, ...sessionStorage }));
    assert.equal(JSON.stringify(stored).includes('access_token'), false);
    assert.equal(JSON.stringify(stored).includes('reset_token'), false);
    await page.getByRole('link', { name: 'Перейти ко входу', exact: true }).click();
    await page.waitForURL(`${base}/login`);
    assert.equal(state.password, NEXT_PASSWORD);
    assert.equal(state.verified, true);
  });

  await scenario('email verification retries failures, rejects wrong codes, and refreshes user state', async ({ page, state, login }) => {
    await login();
    state.sendFails = true;
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Не удалось отправить письмо.' }).waitFor();
    state.sendFails = false;
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByPlaceholder('8 цифр из письма').fill('00000000');
    await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Неверный или просроченный код.' }).waitFor();
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await page.getByText('Email подтверждён: ', { exact: false }).waitFor();
    assert.equal(state.verified, true);
    assert.ok(state.calls.some(call => call.path === 'auth/v1/token' && call.data.refresh_token));
    assert.equal(await page.getByPlaceholder('8 цифр из письма').count(), 0);
  });

  await scenario('password change requires current password and shows the replacement backup code', async ({ page, state, login }) => {
    await login();
    await page.getByPlaceholder('Действующий пароль для смены').fill('wrong current password');
    await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(NEXT_PASSWORD);
    await page.getByPlaceholder('Повторите пароль').fill(NEXT_PASSWORD);
    await page.getByRole('button', { name: 'Сохранить новый пароль', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Неверный текущий пароль.' }).waitFor();
    assert.equal(state.password, PASSWORD);
    await page.getByPlaceholder('Действующий пароль для смены').fill(PASSWORD);
    await page.getByRole('button', { name: 'Сохранить новый пароль', exact: true }).click();
    await page.getByRole('heading', { name: 'Сохраните резервный код' }).waitFor();
    assert.equal(await page.locator('code').innerText(), BACKUP);
    assert.equal(state.password, NEXT_PASSWORD);
    assert.equal(await page.getByPlaceholder('Действующий пароль для смены').count(), 0);
    await page.getByRole('button', { name: 'Я сохранил код', exact: true }).click();
    assert.equal(await page.getByPlaceholder('Действующий пароль для смены').inputValue(), '');
  });

  await scenario('resend waits two minutes and retains its cooldown when returning to the same email', async ({ page, state, email }) => {
    await page.clock.install();
    await page.goto(`${base}/recover`);
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    const countdown = page.getByRole('button', { name: /Отправить ещё раз через/ });
    await countdown.waitFor();
    assert.equal(await countdown.isDisabled(), true);
    await page.clock.fastForward(119000);
    assert.equal(await countdown.isDisabled(), true);
    assert.equal(state.calls.filter(call => call.path === 'auth/v1/request-email-reset').length, 1);
    await page.clock.fastForward(2000);
    await page.getByRole('button', { name: 'Отправить код ещё раз', exact: true }).click();
    await countdown.waitFor();
    assert.equal(await countdown.isDisabled(), true);
    assert.equal(state.calls.filter(call => call.path === 'auth/v1/request-email-reset').length, 2);
    await page.getByRole('button', { name: 'Изменить email', exact: true }).click();
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    const send = page.getByRole('button', { name: 'Получить код на email', exact: true });
    // Returning to the existing code step must not send a third message during cooldown.
    await send.click();
    await countdown.waitFor();
    assert.equal(await countdown.isDisabled(), true);
    assert.equal(state.calls.filter(call => call.path === 'auth/v1/request-email-reset').length, 2);
  });

  await scenario('changing email discards OTP, reset grant, and both password fields', async ({ page, state, email }) => {
    await page.clock.install();
    await page.goto(`${base}/recover`);
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByPlaceholder('8 цифр из письма').fill('12345678');
    await page.getByRole('button', { name: 'Изменить email', exact: true }).click();
    assert.equal(await page.getByPlaceholder('8 цифр из письма').count(), 0);
    await page.clock.fastForward(121000);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    assert.equal(await page.getByPlaceholder('8 цифр из письма').inputValue(), '');
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
    await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(NEXT_PASSWORD);
    await page.getByPlaceholder('Повторите пароль').fill(NEXT_PASSWORD);
    const priorGrant = state.resetToken;
    await page.getByRole('button', { name: 'Изменить email', exact: true }).click();
    await page.getByPlaceholder('Email', { exact: true }).fill('another@example.test');
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(await page.getByPlaceholder('8 цифр из письма').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Сменить пароль', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Неверный или просроченный код.' }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(state.calls.some(call => call.path === 'auth/v1/reset-password'), false);
    await page.getByRole('button', { name: 'Изменить email', exact: true }).click();
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    await page.clock.fastForward(121000);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    assert.equal(await page.getByPlaceholder('8 цифр из письма').inputValue(), '');
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
    assert.notEqual(state.resetToken, priorGrant);
    assert.equal(await page.getByPlaceholder('Новый пароль (от 8 символов)').inputValue(), '');
    assert.equal(await page.getByPlaceholder('Повторите пароль').inputValue(), '');
  });

  await scenario('expired reset grant returns to the code step and removes entered passwords', async ({ page, state, email }) => {
    await page.goto(`${base}/recover`);
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
    await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(NEXT_PASSWORD);
    await page.getByPlaceholder('Повторите пароль').fill(NEXT_PASSWORD);
    state.expiredReset = true;
    await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Подтверждение кода истекло или уже использовано.' }).waitFor();
    await page.getByPlaceholder('8 цифр из письма').waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(await page.getByPlaceholder('8 цифр из письма').inputValue(), '');
    assert.equal(state.password, PASSWORD);
  });

  const longEmail = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  assert.equal(longEmail.length, 254);
  await scenario('254-character email wraps on mobile before and after verification', async ({ page, login, email }) => {
    await login();
    const assertNoHorizontalOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'long email must not widen the viewport');
    await assertNoHorizontalOverflow();
    await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
    await page.getByPlaceholder('8 цифр из письма').fill(CODE);
    await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await page.getByText(`Email подтверждён: ${email}`, { exact: true }).waitFor();
    await assertNoHorizontalOverflow();
  }, { email: longEmail });
  for (const width of [320, 390]) {
    await scenario(`staged recovery fits a ${width}px screen with a 254-character email`, async ({ page, email }) => {
      const assertNoHorizontalOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'recovery must not widen the viewport');
      await page.goto(`${base}/recover`);
      await page.getByPlaceholder('Email', { exact: true }).fill(email);
      await assertNoHorizontalOverflow();
      await page.getByRole('button', { name: 'Получить код на email', exact: true }).click();
      await page.getByPlaceholder('8 цифр из письма').fill(CODE);
      await assertNoHorizontalOverflow();
      await page.getByRole('button', { name: 'Подтвердить код', exact: true }).click();
      await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(NEXT_PASSWORD);
      await page.getByPlaceholder('Повторите пароль').fill(NEXT_PASSWORD);
      await assertNoHorizontalOverflow();
      await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
      await page.getByRole('heading', { name: 'Пароль изменён', exact: true }).waitFor();
      await assertNoHorizontalOverflow();
    }, { email: longEmail, width });
  }
  console.log(`PASS ${completed} isolated email/account browser scenarios; all API and mail requests mocked`);
} finally { await browser.close(); }
