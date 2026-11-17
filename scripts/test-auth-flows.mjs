import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = (process.env.SMOKE_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '');
const output = process.env.AUTH_FLOWS_OUTPUT || 'audit.local/auth-flows.json';
const device = randomUUID();
const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const main = { email: `flows-${suffix}@example.com`, password: 'Quiet amber lanterns cross distant lakes 82' };
const signupFailure = { email: `flows-session-${suffix}@example.com`, password: 'Silent green rivers travel beyond mountains 47' };
const ownedAccounts = [main, signupFailure];
const report = { scenarios: [], errors: [], cleanup: [], started: new Date().toISOString() };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await context.addInitScript(id => {
  if (!localStorage.getItem('fizlab:device-id')) localStorage.setItem('fizlab:device-id', id);
}, device);
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(30000);
page.on('pageerror', error => report.errors.push(error.message));

async function api(path, { method = 'POST', data, token } = {}) {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-fizlab-device-id': device, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  return { response, body: await response.json() };
}

async function scenario(name, run) {
  await run();
  report.scenarios.push(name);
  console.log(`PASS ${name}`);
}

async function accountPage() {
  await page.goto(`${base}/account`);
  await page.getByText(main.email, { exact: true }).waitFor();
}

const isPasswordLogin = response => {
  const url = new URL(response.url());
  return url.pathname === '/api/auth/v1/token' && url.searchParams.get('grant_type') === 'password';
};

let activeToken;
let releaseLogin;
let releaseSession;
try {
  const created = await api('auth/v1/signup', { data: { email: main.email, password: main.password, password_confirmation: main.password, data: { first_name: 'Аудит', last_name: 'Сценариев' } } });
  assert.equal(created.response.status, 200, 'Synthetic account setup failed');
  main.created = true;
  main.id = created.body.user.id;

  await scenario('LoginPage rejects a wrong password and remains editable', async () => {
    await page.goto(`${base}/login`);
    await page.getByPlaceholder('Email', { exact: true }).fill(main.email);
    await page.getByPlaceholder('Пароль', { exact: true }).fill('Incorrect password for this test 61');
    const response = page.waitForResponse(isPasswordLogin);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    assert.equal((await response).status(), 401);
    await page.getByRole('alert').filter({ hasText: 'Проверьте email и пароль.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Войти', exact: true }).isEnabled(), true);
    assert.equal(new URL(page.url()).pathname, '/login');
  });

  await scenario('LoginPage succeeds with exactly one request for duplicate synchronous submits', async () => {
    const gate = new Promise(resolve => { releaseLogin = resolve; });
    let requestCount = 0;
    const loginRoute = '**/api/auth/v1/token?grant_type=password';
    await page.route(loginRoute, async route => { requestCount += 1; await gate; await route.continue(); });
    try {
      await page.getByPlaceholder('Пароль', { exact: true }).fill(main.password);
      const response = page.waitForResponse(isPasswordLogin);
      // Native submit events in one browser task reproduce the pre-render double-submit window.
      await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      await page.getByRole('button', { name: 'Входим…', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Входим…', exact: true }).isDisabled(), true);
      releaseLogin();
      const result = await response;
      assert.equal(result.status(), 200);
      activeToken = (await result.json()).access_token;
      await page.waitForURL(`${base}/`);
      await page.getByRole('link', { name: 'Личный кабинет', exact: true }).waitFor();
      assert.equal(requestCount, 1);
    } finally { releaseLogin(); await page.unroute(loginRoute); }
  });

  await scenario('invalid avatar MIME shows an error without issuing a profile write', async () => {
    await accountPage();
    let writes = 0;
    const observe = request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/rest/v1/profiles') writes += 1; };
    page.on('request', observe);
    try {
      await page.getByLabel('Выбрать фото профиля').setInputFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic invalid image') });
      await page.getByRole('alert').filter({ hasText: 'Выберите изображение.' }).waitFor();
      assert.equal(writes, 0);
      assert.equal(await page.getByRole('button', { name: 'Добавить фото', exact: true }).isEnabled(), true);
    } finally { page.off('request', observe); }
  });

  await scenario('remove photo persists an empty avatar', async () => {
    // Seed a valid avatar through the API; successful UI upload is covered by the smoke suite.
    const avatar = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#7666cc'; ctx.fillRect(0, 0, 16, 16);
      return canvas.toDataURL('image/jpeg');
    });
    const saved = await api(`rest/v1/profiles?id=eq.${main.id}`, { method: 'PATCH', data: { avatar_data: avatar }, token: activeToken });
    assert.equal(saved.response.status, 200);
    await page.reload();
    await page.getByAltText('Фото профиля', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Удалить фото', exact: true }).click();
    await page.getByAltText('Фото профиля', { exact: true }).waitFor({ state: 'hidden' });
    const profile = await api(`rest/v1/profiles?id=eq.${main.id}`, { method: 'GET', token: activeToken });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body[0].avatar_data, null);
  });

  await scenario('wrong recovery code leaves the existing account session intact', async () => {
    await page.goto(`${base}/recover`);
    await page.getByRole('button', { name: 'Использовать резервный код', exact: true }).click();
    await page.getByPlaceholder('Email', { exact: true }).fill(main.email);
    const wrongCode = created.body.recovery_code === 'FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF' ? '0000-0000-0000-0000-0000-0000-0000-0000' : 'FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF';
    await page.getByPlaceholder('Резервный код', { exact: true }).fill(wrongCode);
    await page.getByPlaceholder('Новый пароль (от 8 символов)').fill('Calm violet satellites follow rivers 64');
    await page.getByPlaceholder('Повторите пароль').fill('Calm violet satellites follow rivers 64');
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/v1/recover');
    await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
    assert.equal((await response).status(), 401);
    await page.getByRole('alert').filter({ hasText: 'Неверный email или резервный код.' }).waitFor();
    assert.equal(await page.locator('code').count(), 0);
    const current = await api('auth/v1/user', { method: 'GET', token: activeToken });
    assert.equal(current.response.status, 200);
    assert.equal(current.body.id, main.id);
  });

  await scenario('wrong deletion password preserves the account and entered field', async () => {
    await accountPage();
    const field = page.getByPlaceholder('Введите пароль для подтверждения');
    const wrong = 'An incorrect deletion password 65';
    await field.fill(wrong);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/v1/delete');
    await page.getByRole('button', { name: 'Удалить аккаунт и данные', exact: true }).click();
    assert.equal((await response).status(), 401);
    await page.getByRole('alert').filter({ hasText: 'Неверный пароль.' }).waitFor();
    assert.equal(await field.inputValue(), wrong);
    assert.equal(await page.getByRole('button', { name: 'Удалить аккаунт и данные', exact: true }).isEnabled(), true);
    await page.reload();
    await page.getByText(main.email, { exact: true }).waitFor();
  });

  await scenario('signup keeps the one-time code visible when setSession loses its network response', async () => {
    await page.goto(`${base}/register`);
    await page.getByPlaceholder('Имя', { exact: true }).fill('Аудит');
    await page.getByPlaceholder('Фамилия', { exact: true }).fill('Сессии');
    await page.getByPlaceholder('Email', { exact: true }).fill(signupFailure.email);
    await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(signupFailure.password);
    await page.getByPlaceholder('Повторите пароль').fill(signupFailure.password);
    const gate = new Promise(resolve => { releaseSession = resolve; });
    const signupRoute = '**/api/auth/v1/signup';
    const userRoute = '**/api/auth/v1/user';
    let rejectedSessionRequests = 0;
    await page.route(signupRoute, async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (response.ok()) {
        signupFailure.created = true;
        signupFailure.token = body.access_token;
        signupFailure.code = body.recovery_code;
      }
      await route.fulfill({ response });
    });
    await page.route(userRoute, async route => {
      if (route.request().headers().authorization === `Bearer ${signupFailure.token}`) {
        rejectedSessionRequests += 1;
        await gate;
        await route.abort('failed');
      } else await route.continue();
    });
    try {
      await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
      await page.locator('code').waitFor();
      const continuation = page.getByRole('button', { name: 'Я сохранил код', exact: true });
      assert.equal(await continuation.isDisabled(), true);
      const visibleCode = await page.locator('code').innerText();
      assert.equal(visibleCode, signupFailure.code);
      releaseSession();
      await page.getByRole('alert').filter({ hasText: 'Аккаунт создан, но автоматический вход не завершился.' }).waitFor();
      assert.equal(await page.locator('code').innerText(), visibleCode);
      assert.equal(await continuation.isEnabled(), true);
      assert.ok(rejectedSessionRequests >= 1);
      assert.equal(new URL(page.url()).pathname, '/register');
    } finally { releaseSession(); await page.unroute(signupRoute); await page.unroute(userRoute); }
  });

  await scenario('clipboard NotAllowedError shows a usable manual-copy message', async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Synthetic permission denial', 'NotAllowedError'); } });
    });
    await page.getByRole('button', { name: 'Скопировать код', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Не удалось скопировать автоматически.' }).waitFor();
    assert.equal(await page.locator('code').innerText(), signupFailure.code);
    await page.getByRole('button', { name: 'Я сохранил код', exact: true }).click();
    await page.waitForURL(`${base}/login`);
  });

  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  releaseLogin?.(); releaseSession?.();
  await context.close();
  for (const account of ownedAccounts.filter(value => value.created)) {
    try {
      const login = await api('auth/v1/token?grant_type=password', { data: { email: account.email, password: account.password } });
      assert.equal(login.response.status, 200, 'Synthetic cleanup login failed');
      const deleted = await api('auth/v1/delete', { data: { password: account.password }, token: login.body.access_token });
      assert.equal(deleted.response.status, 200, 'Synthetic cleanup deletion failed');
      report.cleanup.push({ account: account === main ? 'main' : 'signup-session-failure', removed: true });
    } catch (error) {
      report.cleanup.push({ account: account === main ? 'main' : 'signup-session-failure', removed: false, error: error.message });
      process.exitCode = 1;
    }
  }
  await browser.close();
  report.finished = new Date().toISOString();
  fs.mkdirSync(new URL('.', new URL(output, `file:///${process.cwd().replaceAll('\\', '/')}/`)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
}
assert.ok(report.cleanup.every(item => item.removed), 'Every created synthetic account must be removed');
console.log(`PASS ${report.scenarios.length} browser auth action scenarios; synthetic accounts removed: ${report.cleanup.length}`);
