import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { FREE_DEMO_SLUGS } from '../src/lib/access.ts';

const base = process.env.SUBSCRIPTION_UI_URL || 'http://127.0.0.1:5188';
const origin = new URL(base).origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use an isolated local frontend');
const output = 'audit.local/subscription';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const user = {
  id: '00000000-0000-4000-8000-000000000001', email: 'subscription-test@example.test',
  aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {},
  email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(),
};
const status = (active = false, configured = true) => ({
  configured, checkedAt: new Date().toISOString(),
  entitlement: { active, expiresAt: active ? new Date(Date.now() + 86400000).toISOString() : null,
    productId: active ? 'fizlab_pro' : null, willRenew: active, store: active ? 'play_store' : null },
});
const scenarios = [
  { name: 'guest', user: null, response: status(), heading: 'Войдите, чтобы выбрать тариф' },
  { name: 'not-configured', user, response: status(false, false), heading: 'Купить подписку' },
  { name: 'browser', user, response: status(), heading: 'Подписка оформляется в Android' },
  { name: 'active', user, response: status(true), heading: 'ФизЛаб Плюс активен' },
  { name: 'failed', user, statusCode: 503, response: { message: 'Проверка временно недоступна.' }, heading: 'Не удалось проверить подписку' },
];

async function inspectFreeTopicsAndFaq(page) {
  const demos = page.getByRole('region', { name: 'Попробуйте бесплатно', exact: true });
  await demos.waitFor();
  const links = await demos.getByRole('link').evaluateAll(elements => elements.map(element => ({
    href: element.getAttribute('href'), label: element.textContent.trim(),
  })));
  assert.equal(FREE_DEMO_SLUGS.size, 6, 'Keep six demo topics in the subscription experience');
  assert.equal(links.length, 6, 'The free topic section must contain exactly six links');
  assert.deepEqual(links.map(link => link.href).sort(), [...FREE_DEMO_SLUGS].map(slug => `/topic/${slug}`).sort());
  assert.ok(links.every(link => link.label.length > 0), 'Every demo link has a meaningful accessible label');

  const faq = page.getByRole('region', { name: 'Вопросы о подписке', exact: true });
  await faq.waitFor();
  const entries = faq.locator('details');
  assert.ok(await entries.count() >= 3, 'FAQ covers free access, billing and cancellation');
  for (const entry of await entries.all()) {
    const summary = entry.locator('summary');
    assert.ok((await summary.innerText()).trim().length > 0, 'FAQ summary has a readable question');
    assert.equal(await entry.evaluate(element => element.open), false, 'FAQ starts collapsed');
    await summary.click();
    assert.equal(await entry.evaluate(element => element.open), true, 'Pointer opens FAQ');
    const answer = await entry.evaluate(element => element.textContent.replace(element.querySelector('summary').textContent, '').trim());
    assert.ok(answer.length > 0, 'An opened FAQ contains an answer');
    await summary.press('Enter');
    assert.equal(await entry.evaluate(element => element.open), false, 'Enter closes FAQ');
    await summary.press('Space');
    assert.equal(await entry.evaluate(element => element.open), true, 'Space opens FAQ');
    await summary.click();
    assert.equal(await entry.evaluate(element => element.open), false, 'Pointer closes FAQ');
  }
}

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const billingMutations = [];
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);
    page.on('pageerror', error => errors.push(`${scenario.name}: ${error.message}`));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.includes('/auth/v1/user')) return route.fulfill({ json: scenario.user });
      if (pathname.endsWith('/access/v1/status')) return route.fulfill({ json: {
        role: 'member', fullAccess: false, source: null, expiresAt: null, checkedAt: new Date().toISOString(),
      } });
      if (pathname.includes('/billing/v1/')) {
        if (route.request().method() !== 'GET') billingMutations.push({ pathname, method: route.request().method() });
        return route.fulfill({ status: scenario.statusCode || 200, json: scenario.response });
      }
      if (pathname.includes('/rest/v1/profiles')) return route.fulfill({ json: { id: user.id, first_name: 'Тест', last_name: 'Подписки', avatar_data: null } });
      return route.fulfill({ json: [] });
    });
    if (scenario.user) {
      await page.addInitScript(({ user, key }) => {
        localStorage.setItem(key, JSON.stringify({
          access_token: 'synthetic-test-token', refresh_token: 'synthetic-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user,
        }));
      }, { user, key: `sb-${new URL(base).hostname.split('.')[0]}-auth-token` });
    }
    await page.goto(`${base}/subscription`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: scenario.heading, exact: true }).waitFor().catch(async failure => {
      await page.screenshot({ path: `${output}/failure-${scenario.name}.png`, fullPage: true });
      console.error(JSON.stringify({ scenario: scenario.name, pageErrors: errors, body: (await page.locator('body').innerText()).slice(0, 4000) }, null, 2));
      throw failure;
    });
    const buyButtons = page.getByRole('button', { name: /^Купить/ });
    for (const button of await buyButtons.all()) {
      assert.equal(await button.isDisabled(), true, 'Browser must not enable native purchase buttons');
    }
    if (['guest', 'not-configured', 'browser'].includes(scenario.name)) {
      assert.equal(await buyButtons.count(), 2, 'Show both monthly and annual purchase previews');
      assert.equal(await page.getByRole('button', { name: 'Купить на месяц', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Купить на год', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('heading', { name: 'На месяц', exact: true }).count(), 1);
      assert.equal(await page.getByRole('heading', { name: 'На год', exact: true }).count(), 1);
      assert.equal(await page.getByText('Цена пока недоступна', { exact: true }).count(), 2, 'No invented price appears while checkout is unavailable');
    }
    await inspectFreeTopicsAndFaq(page);
    if (scenario.name === 'guest') {
      const main = page.getByRole('main');
      assert.equal(await main.getByRole('link', { name: 'Создать аккаунт', exact: true }).getAttribute('href'), '/register?next=%2Fsubscription');
      assert.equal(await main.getByRole('link', { name: 'Войти', exact: true }).getAttribute('href'), '/login?next=%2Fsubscription');
      assert.equal(await page.getByRole('button', { name: 'Обновить статус', exact: true }).count(), 0);
    }
    if (scenario.name === 'not-configured') {
      assert.equal(await page.getByRole('link', { name: 'Начать бесплатно', exact: true }).getAttribute('href'), '/topic/kinematics');
      assert.equal(await page.getByRole('button', { name: 'Обновить статус', exact: true }).count(), 0, 'Unavailable billing does not offer a misleading refresh action');
    }
    if (scenario.name === 'browser') {
      await page.getByRole('button', { name: 'Обновить статус', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Восстановить покупки', exact: true }).count(), 0, 'Browser cannot invoke native restoration');
    }
    if (scenario.name === 'active') {
      assert.equal(await buyButtons.count(), 0, 'Active subscribers do not see purchase previews or a second purchase CTA');
      assert.match(await page.getByRole('link', { name: /Управлять в Google Play/ }).getAttribute('href'), /package=app\.fizlab\.course/);
      assert.equal(await page.getByRole('heading', { name: 'На месяц', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Обновить статус', exact: true }).waitFor();
    }
    // Check the answer text too: a collapsed FAQ can hide mobile overflow or contrast bugs.
    for (const summary of await page.getByRole('region', { name: 'Вопросы о подписке', exact: true }).locator('details > summary').all()) {
      await summary.click();
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo({ top: 0, behavior: 'instant' });
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${scenario.name} overflows at ${width}px`);
      if (width === 320 || width === 1440) {
        await page.screenshot({ path: `${output}/${scenario.name}-${width}.png`, fullPage: true });
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(audit.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target).join(', ')}`), [], `${scenario.name} at ${width}px`);
      }
    }
    if (scenario.name === 'guest') {
      await page.getByRole('region', { name: 'Попробуйте бесплатно', exact: true }).locator('a[href="/topic/kinematics"]').click();
      await page.waitForURL(`${base}/topic/kinematics`);
      await page.getByRole('tab', { name: 'Конспект', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Тема доступна с ФизЛаб Плюс' }).count(), 0, 'Guest can open a free demo without signing up');
    }
    if (scenario.name !== 'active') {
      const premiumRequests = [];
      page.on('request', request => { if (request.url().includes('/src/topics/newton-laws/')) premiumRequests.push(request.url()); });
      await page.goto(`${base}/topic/newton-laws`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Тема доступна с ФизЛаб Плюс' }).waitFor();
      assert.equal(premiumRequests.length, 0, `${scenario.name} requested paid topic content`);
      assert.equal(await page.getByRole('tab').count(), 0);
    }
    assert.deepEqual(billingMutations, [], 'Unavailable purchase previews do not submit payment or sync requests');
    await context.close();
    console.log(`PASS subscription UI: ${scenario.name}`);
  }
  assert.deepEqual(errors, [], 'No client runtime errors');
} finally {
  await browser.close();
}
