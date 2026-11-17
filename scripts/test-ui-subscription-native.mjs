// Simulated native commerce UI. The billing module and every API are mocked:
// this verifies app state transitions, not real Google Play payments or SDK integration.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { FREE_DEMO_SLUGS } from '../src/lib/access.ts';

const base = (process.env.SUBSCRIPTION_UI_URL || 'http://127.0.0.1:5188').replace(/\/+$/, '');
const origin = new URL(base).origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use an isolated local Vite frontend');
await mkdir('audit.local/subscription', { recursive: true });
const browser = await chromium.launch({ headless: true });
const scenarios = [
  { name: 'monthly-success', action: 'monthly', outcome: 'success' },
  { name: 'annual-success', action: 'annual', outcome: 'success' },
  { name: 'restore-success', action: 'restore', outcome: 'success' },
  { name: 'cancelled', action: 'monthly', outcome: 'cancelled' },
  { name: 'pending', action: 'annual', outcome: 'pending' },
  { name: 'verification-failure', action: 'monthly', outcome: 'server-failure' },
  { name: 'unverified-email', verified: false },
];
const user = {
  id: '00000000-0000-4000-8000-000000000001', email: 'native-commerce@example.test',
  aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {},
  email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(),
};
const status = (active = false) => ({
  configured: true, checkedAt: new Date().toISOString(),
  entitlement: { active, expiresAt: active ? new Date(Date.now() + 86400000).toISOString() : null,
    productId: active ? 'fizlab_pro' : null, willRenew: active, store: active ? 'play_store' : null },
});

async function inspectFreeTopicsAndFaq(page) {
  const demos = page.getByRole('region', { name: 'Попробуйте бесплатно', exact: true });
  await demos.waitFor();
  const destinations = await demos.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')));
  assert.equal(destinations.length, 6, 'Native purchase screen keeps all six free demos available');
  assert.deepEqual(destinations.sort(), [...FREE_DEMO_SLUGS].map(slug => `/topic/${slug}`).sort());
  const faq = page.getByRole('region', { name: 'Вопросы о подписке', exact: true });
  const cancellation = faq.locator('details').filter({ has: page.locator('summary', { hasText: 'Как отменить подписку?' }) });
  await cancellation.locator('summary').click();
  assert.equal(await cancellation.evaluate(element => element.open), true, 'Cancellation disclosure can be expanded before purchase');
  assert.match(await cancellation.innerText(), /Google Play/, 'Cancellation instructions identify the store');
  await cancellation.locator('summary').press('Enter');
  assert.equal(await cancellation.evaluate(element => element.open), false, 'Cancellation disclosure supports keyboard interaction');
}

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);
    const errors = [];
    const calls = [];
    let pendingSync;
    let syncStarted;
    const syncRequest = new Promise(resolve => { syncStarted = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: { ...user, email_confirmed_at: scenario.verified === false ? null : user.email_confirmed_at } });
      if (pathname.endsWith('/access/v1/status')) return route.fulfill({ json: {
        role: 'member', fullAccess: false, source: null, expiresAt: null, checkedAt: new Date().toISOString(),
      } });
      if (pathname.endsWith('/billing/v1/status')) return route.fulfill({ json: status() });
      if (pathname.endsWith('/billing/v1/sync')) {
        calls.push({ method: route.request().method(), body: route.request().postDataJSON() });
        pendingSync = route;
        syncStarted();
        return;
      }
      if (pathname.includes('/rest/v1/profiles')) return route.fulfill({ json: { id: user.id, first_name: 'Тест', last_name: 'Покупок', avatar_data: null } });
      return route.fulfill({ json: [] });
    });
    await context.route('**/src/lib/billing.ts*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `
        export function billingAvailable() { return true; }
        export function getManageSubscriptionsUrl() { return 'https://play.google.com/store/account/subscriptions?sku=fizlab_pro&package=app.fizlab.course'; }
        export async function loadBillingPlans(userId) {
          window.__billingCalls.push({type:'plans', userId});
          return [
            {id:'monthly',title:'На месяц',price:'1 490 ₸',priceAmount:1490,currency:'KZT',period:'P1M'},
            {id:'annual',title:'На год',price:'11 990 ₸',priceAmount:11990,currency:'KZT',period:'P1Y'}
          ];
        }
        export async function purchasePlan(userId, planId) {
          window.__billingCalls.push({type:'purchase', userId, planId});
          if (window.__billingOutcome === 'cancelled') throw new Error('Покупка отменена. Подписка не оформлена.');
          if (window.__billingOutcome === 'pending') throw new Error('Платёж ожидает подтверждения Google Play. После оплаты обновите статус подписки.');
        }
        export async function restorePurchases(userId) { window.__billingCalls.push({type:'restore', userId}); }
      `,
    }));
    await page.addInitScript(({ user, key, outcome }) => {
      window.__billingCalls = [];
      window.__billingOutcome = outcome;
      localStorage.setItem(key, JSON.stringify({
        access_token: 'synthetic-native-token', refresh_token: 'synthetic-native-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user,
      }));
    }, { user: { ...user, email_confirmed_at: scenario.verified === false ? null : user.email_confirmed_at }, key: `sb-${new URL(base).hostname.split('.')[0]}-auth-token`, outcome: scenario.outcome });
    await page.goto(`${base}/subscription`, { waitUntil: 'domcontentloaded' });
    await inspectFreeTopicsAndFaq(page);
    if (scenario.verified === false) {
      await page.getByRole('heading', { name: 'Подтвердите email перед оплатой' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Восстановить покупки' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /^Купить/ }).count(), 0);
      assert.equal(await page.evaluate(() => window.__billingCalls.length), 0, 'Unverified email must not invoke native SDK');
    } else {
      await page.getByRole('heading', { name: 'На месяц', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'На год', exact: true }).waitFor();
      await page.getByText('Вся сумма за 1 год, одним платежом', { exact: true }).waitFor();
      const monthly = page.getByRole('button', { name: 'Купить за 1 490 ₸', exact: true });
      const annual = page.getByRole('button', { name: 'Купить за 11 990 ₸', exact: true });
      if (scenario.name === 'monthly-success') {
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
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Native plans overflow at ${width}px`);
          if (width === 320 || width === 1440) {
            await page.screenshot({ path: `audit.local/subscription/native-plans-${width}.png`, fullPage: true });
            const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            assert.deepEqual(audit.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target).join(', ')}`), [], `Native plan accessibility at ${width}px`);
          }
        }
      }
      const button = scenario.action === 'restore' ? page.getByRole('button', { name: 'Восстановить покупки', exact: true }) : scenario.action === 'annual' ? annual : monthly;
      await button.click();
      if (scenario.outcome === 'cancelled' || scenario.outcome === 'pending') {
        await page.getByRole('alert').filter({ hasText: scenario.outcome === 'cancelled' ? 'Покупка отменена' : 'Платёж ожидает подтверждения' }).waitFor();
        assert.equal(calls.length, 0, 'Cancelled/pending purchase must not trigger successful sync');
        assert.equal(await page.getByRole('heading', { name: 'ФизЛаб Плюс активен' }).count(), 0);
      } else {
        let syncTimer;
        try {
          await Promise.race([syncRequest, new Promise((_, reject) => { syncTimer = setTimeout(() => reject(new Error('SDK success never requested server sync')), 10000); })]);
        } finally { clearTimeout(syncTimer); }
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, 'POST');
        assert.equal(await page.getByRole('heading', { name: 'ФизЛаб Плюс активен' }).count(), 0, 'SDK success alone must not unlock premium access');
        if (scenario.outcome === 'server-failure') {
          await pendingSync.fulfill({ status: 503, json: { message: 'Не удалось подтвердить подписку.' } });
          await page.getByRole('heading', { name: 'Не удалось проверить подписку', exact: true }).waitFor();
          assert.equal(await page.getByRole('heading', { name: 'ФизЛаб Плюс активен' }).count(), 0);
        } else {
          await pendingSync.fulfill({ json: status(true) });
          await page.getByRole('heading', { name: 'ФизЛаб Плюс активен', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: /^Купить/ }).count(), 0, 'Active subscribers must not see a second purchase CTA');
          await page.getByRole('link', { name: /Управлять в Google Play/ }).waitFor();
        }
      }
      const sdkCalls = await page.evaluate(() => window.__billingCalls.filter(call => call.type !== 'plans'));
      assert.equal(sdkCalls.length, 1);
      assert.equal(sdkCalls[0].userId, user.id);
      assert.equal(sdkCalls[0].type, scenario.action === 'restore' ? 'restore' : 'purchase');
      if (scenario.action !== 'restore') assert.equal(sdkCalls[0].planId, scenario.action);
    }
    assert.deepEqual(errors, [], scenario.name);
    await context.close();
    console.log(`PASS simulated native commerce UI: ${scenario.name}`);
  }
} finally {
  await browser.close();
}
