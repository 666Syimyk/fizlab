import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const billingSource = readFileSync(new URL('../src/lib/billing.ts', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../src/lib/authMutations.ts', import.meta.url), 'utf8');
const errorSource = readFileSync(new URL('../node_modules/@revenuecat/purchases-typescript-internal-esm/dist/generated/error-codes.js', import.meta.url), 'utf8');
function compile(source, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, AbortSignal, Error, ...globals });
  return exports;
}
const { PURCHASES_ERROR_CODE } = compile(errorSource);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function option(id, changes = {}) {
  const period = id === 'monthly' ? 'P1M' : 'P1Y';
  return { id, productId: 'fizlab_pro', storeProductId: `fizlab_pro:${id}`,
    isBasePlan: true, isPrepaid: false, installmentsInfo: null,
    pricingPhases: [{ billingPeriod: { iso8601: period }, recurrenceMode: 1,
      price: { formatted: id === 'monthly' ? '990 ₸' : '7 990 ₸',
        amountMicros: id === 'monthly' ? 990000000 : 7990000000, currencyCode: 'KZT' } }],
    ...changes };
}
function setup({ native = true, key = 'goog_publicTestKey', platform = 'android' } = {}) {
  const auth = compile(authSource);
  const monthly = option('monthly');
  const annual = option('annual');
  const trial = option('monthly:trial', { isBasePlan: false });
  const state = { userId: 'user-a', sdkId: null, now: 1_000_000, calls: [],
    offerings: { current: {
      monthly: { product: { subscriptionOptions: [trial, monthly], defaultOption: trial } },
      annual: { product: { subscriptionOptions: [annual] } },
    } }, failure: null, purchaseBarrier: null };
  const Purchases = {
    async isConfigured() { return { isConfigured: state.sdkId !== null }; },
    async configure(config) { state.calls.push(['configure', config]); state.sdkId = config.appUserID; },
    async getAppUserID() { return { appUserID: state.sdkId }; },
    async logIn({ appUserID }) { state.calls.push(['login', appUserID]); state.sdkId = appUserID; },
    async getOfferings() { return state.offerings; },
    async purchaseSubscriptionOption({ subscriptionOption }) {
      state.calls.push(['purchase', state.sdkId, subscriptionOption]);
      if (state.purchaseBarrier) { state.purchaseBarrier.entered.resolve(); await state.purchaseBarrier.release.promise; }
      if (state.failure) throw state.failure;
      return { customerInfo: { entitlements: { active: { fizlab_pro: {} } } } };
    },
    async restorePurchases() {
      state.calls.push(['restore', state.sdkId]);
      if (state.failure) throw state.failure;
      return { customerInfo: { entitlements: { active: { fizlab_pro: {} } } } };
    },
  };
  const dependencies = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native, getPlatform: () => platform } },
    '@revenuecat/purchases-capacitor': { Purchases, PURCHASES_ERROR_CODE, RECURRENCE_MODE: { INFINITE_RECURRING: 1 } },
    '@/lib/authMutations': auth,
    '@/lib/supabaseClient': { supabase: { auth: { async getSession() {
      return { data: { session: state.userId ? { user: { id: state.userId } } : null }, error: null };
    } } } },
  };
  const billing = compile(billingSource.replaceAll('import.meta.env.VITE_REVENUECAT_GOOGLE_API_KEY', JSON.stringify(key)), {
    Date: class extends Date { static now() { return state.now; } },
    require(name) { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
  });
  return { billing, state, auth, monthly, annual, trial };
}

test('native Android with public Google SDK key is required; web cannot simulate a purchase', async () => {
  for (const options of [{ native: false }, { platform: 'ios' }, { key: '' }, { key: 'sk_secret' }]) {
    const { billing, state } = setup(options);
    assert.equal(billing.billingAvailable(), false);
    await assert.rejects(billing.loadBillingPlans('user-a'), { code: 'unavailable' });
    assert.equal(state.calls.length, 0);
  }
});

test('price comes from the exact recurring base plan purchased even when SDK default is a trial', async () => {
  const { billing, state, monthly } = setup();
  const plans = await billing.loadBillingPlans('user-a');
  assert.equal(plans.length, 2);
  assert.equal(plans[0].price, '990 ₸');
  assert.equal(plans[0].priceAmount, 990);
  assert.equal(plans[0].period, 'P1M');
  assert.equal(plans[1].price, '7 990 ₸');
  assert.equal(plans[1].period, 'P1Y');
  assert.equal(state.calls[0][1].appUserID, 'user-a');
  assert.equal(state.calls[0][1].automaticDeviceIdentifierCollectionEnabled, false);
  assert.equal(await billing.purchasePlan('user-a', 'monthly'), undefined, 'native success must not grant access');
  const purchase = state.calls.find(call => call[0] === 'purchase');
  assert.equal(purchase[1], 'user-a');
  assert.equal(purchase[2], monthly, 'must buy displayed base plan, not trial');
});

test('unsupported discounted, finite, prepaid, installment and wrong-period plans are not sold', async () => {
  const invalid = [
    option('monthly', { isBasePlan: false }), option('monthly', { isPrepaid: true }),
    option('monthly', { installmentsInfo: { commitmentPaymentsCount: 12 } }),
    option('monthly', { productId: 'unrelated' }),
    option('monthly', { pricingPhases: [option('monthly').pricingPhases[0], option('monthly').pricingPhases[0]] }),
    option('monthly', { pricingPhases: [{ ...option('monthly').pricingPhases[0], recurrenceMode: 2 }] }),
    option('monthly', { pricingPhases: option('annual').pricingPhases }),
  ];
  for (const candidate of invalid) {
    const { billing, state } = setup();
    state.offerings.current = { monthly: { product: { subscriptionOptions: [candidate] } } };
    assert.equal((await billing.loadBillingPlans('user-a')).length, 0);
    await assert.rejects(billing.purchasePlan('user-a', 'monthly'), { code: 'unavailable' });
    assert.equal(state.calls.some(call => call[0] === 'purchase'), false);
  }
});

test('signed-out and stale-account operations are rejected before any SDK identity or purchase action', async () => {
  const { billing, state } = setup();
  await assert.rejects(billing.loadBillingPlans('user-b'), { code: 'account' });
  state.userId = null;
  await assert.rejects(billing.restorePurchases('user-a'), { code: 'account' });
  assert.equal(state.calls.length, 0);
});

test('cancelled and pending purchases reject without exposing native error detail or granting access', async () => {
  const { billing, state } = setup();
  await billing.loadBillingPlans('user-a');
  state.failure = { code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR, message: 'private native details' };
  await assert.rejects(billing.purchasePlan('user-a', 'monthly'), error => error.code === 'cancelled'
    && !error.message.includes('private'));
  state.failure = { code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR };
  await assert.rejects(billing.purchasePlan('user-a', 'annual'), { code: 'pending' });
  state.failure = null;
  assert.equal(await billing.restorePurchases('user-a'), undefined, 'restore also requires backend verification');
});

test('purchase lock prevents logout or another SDK identity from interleaving with a payment', async () => {
  const { billing, state, auth } = setup();
  await billing.loadBillingPlans('user-a');
  state.purchaseBarrier = { entered: deferred(), release: deferred() };
  const purchasing = billing.purchasePlan('user-a', 'monthly');
  await state.purchaseBarrier.entered.promise;
  const switching = auth.runAuthMutation(async () => { state.userId = 'user-b'; });
  const loadingNext = billing.loadBillingPlans('user-b');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.userId, 'user-a');
  assert.equal(state.sdkId, 'user-a');
  state.purchaseBarrier.release.resolve();
  await purchasing;
  await switching;
  await loadingNext;
  assert.equal(state.sdkId, 'user-b');
  assert.equal(state.calls.filter(call => call[0] === 'configure').length, 1);
  assert.equal(state.calls.filter(call => call[0] === 'login').length, 1);
  await assert.rejects(billing.purchasePlan('user-a', 'monthly'), { code: 'account' });
});

test('expired displayed prices require refresh before opening a purchase sheet', async () => {
  const { billing, state } = setup();
  await billing.loadBillingPlans('user-a');
  state.now += 5 * 60_000 + 1;
  await assert.rejects(billing.purchasePlan('user-a', 'monthly'), { code: 'unavailable' });
  assert.equal(state.calls.some(call => call[0] === 'purchase'), false);
});

test('restore reports original-account ownership and management link uses fixed Play destination', async () => {
  const { billing, state } = setup();
  state.failure = { code: PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR };
  await assert.rejects(billing.restorePurchases('user-a'), { code: 'account' });
  const destination = new URL(billing.getManageSubscriptionsUrl());
  assert.equal(destination.origin, 'https://play.google.com');
  assert.equal(destination.pathname, '/store/account/subscriptions');
  assert.equal(destination.searchParams.get('package'), 'app.fizlab.course');
  assert.equal(destination.searchParams.get('sku'), 'fizlab_pro');
});
