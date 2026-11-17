// Isolated admin UX checks: every account, access, and billing request is mocked.
// No real account database, mailbox, payment service, or port 4174 is contacted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer as reservePort } from 'node:net';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const output = 'audit.local/admin';
await mkdir(output, { recursive: true });
let vite;
let browser;
let base = process.env.ADMIN_UI_URL?.replace(/\/+$/, '');
const unexpectedApi = [];
const pageErrors = [];
const timestamp = new Date().toISOString();
const owner = {
  id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test',
  aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' },
  user_metadata: { full_name: 'Владелец ФизЛаб' }, email_confirmed_at: timestamp, created_at: timestamp,
};
const member = { ...owner, id: '00000000-0000-4000-8000-000000000002', email: 'learner@example.test', user_metadata: { full_name: 'Ученик ФизЛаб', role: 'superadmin' } };
const longEmail = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
assert.equal(longEmail.length, 254);
const longUser = { id: '00000000-0000-4000-8000-000000000003', email: longEmail, name: 'ОченьДлинноеИмя'.repeat(12), createdAt: timestamp, emailVerified: true, isSuperadmin: false, grantExpiresAt: null };
const toEntry = (user, isSuperadmin) => ({ id: user.id, email: user.email, name: user.user_metadata.full_name, createdAt: user.created_at, emailVerified: true, isSuperadmin, grantExpiresAt: null });
const access = (isSuperadmin, grantExpiresAt = null) => ({
  role: isSuperadmin ? 'superadmin' : 'member', fullAccess: isSuperadmin || Boolean(grantExpiresAt),
  source: isSuperadmin ? 'superadmin' : grantExpiresAt ? 'grant' : null,
  expiresAt: isSuperadmin ? null : grantExpiresAt, checkedAt: new Date().toISOString(),
});
const billing = () => ({ configured: false, checkedAt: new Date().toISOString(), entitlement: { active: false, expiresAt: null, productId: null, willRenew: false, store: null } });

async function startIsolatedFrontend() {
  const port = await new Promise((resolve, reject) => {
    const server = reservePort();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
  base = `http://127.0.0.1:${port}`;
  process.env.VITE_API_URL = `${base}/api`;
  process.env.VITE_REVENUECAT_GOOGLE_API_KEY = 'goog_isolatedtest';
  const { createServer } = await import('vite');
  vite = await createServer({
    clearScreen: false,
    cacheDir: 'node_modules/.vite-admin-ui',
    server: { host: '127.0.0.1', port, strictPort: true, open: false, proxy: { '/api': { target: 'http://127.0.0.1:1' } } },
    plugins: [{ name: 'block-unmocked-admin-test-api', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        unexpectedApi.push(`Unmocked request reached isolated Vite: ${req.method} ${req.url}`);
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ message: 'Every test API request must be mocked.' }));
      });
    } }],
  });
  await vite.listen();
}

async function scenario(name, initialUser, run) {
  if (process.env.ADMIN_UI_CASE && process.env.ADMIN_UI_CASE !== name) return;
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleErrors = [];
  const state = { user: initialUser, isSuperadmin: initialUser?.id === owner.id, grantExpiresAt: null,
    rows: [toEntry(owner, true), toEntry(member, false), { ...longUser }], calls: [], holdMutation: false, pendingMutation: null, holdUsers: false, pendingUsers: null };
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', error => pageErrors.push(`${name}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const pathname = url.pathname.slice('/api/'.length);
    const data = request.postData() ? request.postDataJSON() : undefined;
    state.calls.push({ pathname, method: request.method(), data, search: url.searchParams.get('search'), offset: url.searchParams.get('offset') });
    const respond = (json, status = 200) => route.fulfill({ status, json });
    if (pathname === 'auth/v1/user') return state.user ? respond(state.user) : respond({ message: 'No test session' }, 401);
    if (pathname === 'auth/v1/settings') return respond({ email_recovery_available: false, email_verification_available: false });
    if (pathname === 'auth/v1/logout') { state.user = null; return respond({}); }
    if (pathname === 'billing/v1/status') return respond(billing());
    if (pathname === 'access/v1/status') return respond(access(state.isSuperadmin, state.grantExpiresAt));
    if (pathname === 'rest/v1/profiles') return respond(state.user ? { id: state.user.id, first_name: 'Тест', last_name: 'Администратора', full_name: state.user.user_metadata.full_name, role: 'superadmin', avatar_data: null } : null);
    if (pathname === 'rest/v1/progress' || pathname === 'rest/v1/events') return respond([]);
    if (pathname.startsWith('admin/v1/')) {
      assert.equal(request.headers().authorization, 'Bearer synthetic-admin-token', 'Admin API receives the current session token');
      assert.match(request.headers()['x-fizlab-device-id'] || '', /^[0-9a-f-]{36}$/i, 'Admin API includes device binding');
      if (!state.isSuperadmin) return respond({ message: 'Доступ разрешён только администратору.' }, 403);
      if (pathname === 'admin/v1/overview') return respond({ totalUsers: state.rows.length, superadmins: 1, activeGrants: state.rows.filter(row => row.grantExpiresAt).length });
      if (pathname === 'admin/v1/users') {
        const search = (url.searchParams.get('search') || '').toLowerCase();
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit'));
        const rows = state.rows.filter(row => `${row.email} ${row.name}`.toLowerCase().includes(search));
        const result = { users: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
        if (state.holdUsers) { state.holdUsers = false; state.pendingUsers = () => respond(result); return; }
        return respond(result);
      }
      if (['admin/v1/grant-access', 'admin/v1/revoke-access'].includes(pathname)) {
        const finish = () => {
          const target = state.rows.find(row => row.id === data.user_id);
          assert.ok(target && !target.isSuperadmin, 'Only another member is mutated');
          target.grantExpiresAt = pathname.endsWith('/grant-access') ? new Date(Date.now() + data.days * 86400000).toISOString() : null;
          return respond({ success: true });
        };
        if (state.holdMutation) { state.holdMutation = false; state.pendingMutation = finish; return; }
        return finish();
      }
    }
    unexpectedApi.push(`${name}: ${request.method()} ${pathname}`);
    return respond({ message: 'Unexpected mock API request' }, 500);
  });
  if (initialUser) await page.addInitScript(({ user, key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: 'synthetic-admin-token', refresh_token: 'synthetic-admin-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }));
  }, { user: initialUser, key: `sb-${new URL(base).hostname.split('.')[0]}-auth-token` });
  try {
    await run({ page, state, context });
    assert.equal(state.calls.filter(call => call.pathname.startsWith('billing/') && call.method !== 'GET').length, 0, 'Admin operations never mutate store purchases');
    console.log(`PASS admin UI: ${name}`);
  } catch (error) {
    await page.screenshot({ path: `${output}/failure-${name}.png`, fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ scenario: name, pageErrors, consoleErrors, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 4000) }));
    throw error;
  } finally { await context.close(); }
}

async function inspectLayout(page, name) {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: no horizontal overflow at ${width}px`);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target).join(', ')}`), [], `${name}: accessibility at ${width}px`);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  }
}

const mutationCalls = state => state.calls.filter(call => call.pathname === 'admin/v1/grant-access' || call.pathname === 'admin/v1/revoke-access');
const learnerCard = page => page.getByRole('article').filter({ has: page.getByText(member.email, { exact: true }) });
async function openAdmin(page) {
  await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Пользователи', exact: true }).waitFor();
  await learnerCard(page).getByRole('button', { name: 'Выдать доступ', exact: true }).waitFor();
}

try {
  if (!base) await startIsolatedFrontend();
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use an isolated local frontend');
  assert.notEqual(new URL(base).port, '4174', 'Never run mocked admin tests against the real local app');
  browser = await chromium.launch({ headless: true });

  await scenario('owner-grant-revoke', owner, async ({ page, state }) => {
    await openAdmin(page);
    const ownerCard = page.getByRole('article').filter({ has: page.getByText(owner.email, { exact: true }) });
    assert.equal(await ownerCard.getByRole('button').count(), 0, 'Owner access cannot be altered by card controls');
    await inspectLayout(page, 'owner-list');
    await learnerCard(page).getByRole('button', { name: 'Выдать доступ', exact: true }).click();
    const confirmation = learnerCard(page).getByRole('group', { name: `Выдать доступ для ${member.email}?`, exact: true });
    await confirmation.waitFor();
    assert.deepEqual(mutationCalls(state), [], 'Opening confirmation does not grant access');
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.deepEqual(mutationCalls(state), [], 'Cancelling confirmation does not grant access');

    // Exercise the maximum email and name lengths inside the actual confirmation.
    const longCard = page.getByRole('article').filter({ has: page.getByText(longEmail, { exact: true }) });
    await longCard.getByRole('button', { name: 'Выдать доступ', exact: true }).click();
    await inspectLayout(page, 'owner-confirm-long-email');
    await longCard.getByRole('button', { name: 'Отмена', exact: true }).click();

    await learnerCard(page).getByRole('button', { name: 'Выдать доступ', exact: true }).click();
    state.holdMutation = true;
    const sent = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/admin/v1/grant-access'));
    await learnerCard(page).getByRole('button', { name: 'Подтвердить выдачу', exact: true }).evaluate(button => { button.click(); button.click(); });
    await sent;
    await page.getByRole('button', { name: 'Сохраняем…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Сохраняем…', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Обновить список', exact: true }).isDisabled(), true);
    assert.equal(await learnerCard(page).getByRole('combobox', { name: 'Срок доступа', exact: true }).isDisabled(), true);
    assert.equal(mutationCalls(state).length, 1, 'Double confirmation submits exactly once');
    assert.deepEqual(mutationCalls(state)[0].data, { user_id: member.id, days: 30 });
    assert.ok(state.pendingMutation);
    await state.pendingMutation();
    state.pendingMutation = null;
    await learnerCard(page).getByRole('button', { name: 'Изменить срок', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: `Доступ для ${member.email} установлен на 30 дней` }).waitFor();

    await learnerCard(page).getByRole('combobox', { name: 'Срок доступа', exact: true }).selectOption('365');
    await learnerCard(page).getByRole('button', { name: 'Изменить срок', exact: true }).click();
    await learnerCard(page).getByText(/Доступ на 365 дней с сегодняшнего дня/).waitFor();
    await learnerCard(page).getByText(/Новый срок заменит текущий/).waitFor();
    assert.equal(mutationCalls(state).length, 1, 'Selecting a duration does not submit before confirmation');
    await learnerCard(page).getByRole('button', { name: 'Подтвердить выдачу', exact: true }).click();
    await page.getByRole('status').filter({ hasText: `Доступ для ${member.email} установлен на 365 дней` }).waitFor();
    await learnerCard(page).getByRole('button', { name: 'Закрыть выданный доступ', exact: true }).waitFor();
    assert.deepEqual(mutationCalls(state)[1].data, { user_id: member.id, days: 365 });
    await learnerCard(page).getByRole('button', { name: 'Закрыть выданный доступ', exact: true }).click();
    assert.equal(mutationCalls(state).length, 2, 'Revocation also requires confirmation');
    await learnerCard(page).getByRole('button', { name: 'Да, закрыть доступ', exact: true }).click();
    await learnerCard(page).getByRole('button', { name: 'Выдать доступ', exact: true }).waitFor();
    assert.deepEqual(mutationCalls(state).map(call => ({ pathname: call.pathname, data: call.data })), [
      { pathname: 'admin/v1/grant-access', data: { user_id: member.id, days: 30 } },
      { pathname: 'admin/v1/grant-access', data: { user_id: member.id, days: 365 } },
      { pathname: 'admin/v1/revoke-access', data: { user_id: member.id } },
    ]);
    assert.equal(state.rows.find(row => row.id === member.id).grantExpiresAt, null);
  });

  await scenario('owner-subscription-without-billing', owner, async ({ page }) => {
    await page.goto(`${base}/subscription`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Доступ владельца', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^(Купить|Оформить)/ }).count(), 0, 'Owner never sees a purchase CTA');
    assert.equal(await page.getByRole('button', { name: 'Восстановить покупки', exact: true }).count(), 0);
    assert.equal(await page.getByRole('main').getByRole('link', { name: 'Панель администратора', exact: true }).getAttribute('href'), '/admin');
    await inspectLayout(page, 'owner-subscription');
    await page.goto(`${base}/topic/newton-laws`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Конспект', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Тема доступна с ФизЛаб Плюс', exact: true }).count(), 0, 'Owner opens paid content while store billing is unconfigured');
  });

  await scenario('member-cannot-open-admin', member, async ({ page, state }) => {
    await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Доступ ограничен', exact: true }).waitFor();
    assert.equal(state.calls.filter(call => call.pathname.startsWith('admin/')).length, 0, 'Forged profile metadata must not even mount the admin dashboard');
    assert.equal(await page.getByRole('article').count(), 0);
    await inspectLayout(page, 'member-denied');
    const premiumRequests = [];
    page.on('request', request => { if (new URL(request.url()).pathname.includes('/src/topics/newton-laws/')) premiumRequests.push(request.url()); });
    await page.goto(`${base}/topic/newton-laws`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Тема доступна с ФизЛаб Плюс', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.deepEqual(premiumRequests, [], 'A member with forged role metadata cannot load premium topic modules');
  });

  await scenario('guest-login', null, async ({ page, state }) => {
    await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Войдите в аккаунт администратора', exact: true }).waitFor();
    const login = page.getByRole('main').getByRole('link', { name: 'Войти', exact: true });
    assert.equal(await login.getAttribute('href'), '/login?next=%2Fadmin');
    assert.equal(state.calls.filter(call => call.pathname.startsWith('admin/') || call.pathname.startsWith('access/')).length, 0);
    await inspectLayout(page, 'guest-login');
    await login.click();
    await page.waitForURL(`${base}/login?next=%2Fadmin`);
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
  });

  await scenario('role-revocation-discards-late-list', owner, async ({ page, state }) => {
    await openAdmin(page);
    state.holdUsers = true;
    const request = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/admin/v1/users'));
    await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
    await request;
    state.isSuperadmin = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('heading', { name: 'Доступ ограничен', exact: true }).waitFor();
    assert.ok(state.pendingUsers);
    await state.pendingUsers().catch(() => {}); // Fetch may already be aborted by dashboard teardown.
    assert.equal(await page.getByText(member.email, { exact: true }).count(), 0, 'Late privileged response cannot reappear after role removal');
    assert.equal(await page.getByRole('button', { name: 'Выдать доступ', exact: true }).count(), 0);
    assert.deepEqual(mutationCalls(state), []);
  });

  await scenario('offline-removes-admin-controls', owner, async ({ page, state }) => {
    await openAdmin(page);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true }).waitFor();
    assert.equal(await page.getByRole('article').count(), 0, 'Unverified offline access hides privileged data and actions');
    assert.deepEqual(mutationCalls(state), []);
    await page.getByRole('button', { name: 'Повторить проверку', exact: true }).click();
    await learnerCard(page).getByRole('button', { name: 'Выдать доступ', exact: true }).waitFor();
  });

  assert.deepEqual(unexpectedApi, [], 'All APIs stayed in the isolated mock');
  assert.deepEqual(pageErrors, [], 'No client runtime errors');
} finally {
  await browser?.close();
  await vite?.close();
}
