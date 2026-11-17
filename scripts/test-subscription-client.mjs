import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const emptyEntitlement = { active: false, expiresAt: null, productId: null, willRenew: false, store: null };
const now = Date.parse('2026-09-30T12:00:00Z');
const activeStatus = (expiresAt = now + 3600000) => ({
  configured: true, checkedAt: new Date(now).toISOString(),
  entitlement: { active: true, expiresAt: new Date(expiresAt).toISOString(), productId: 'fizlab_pro', willRenew: true, store: 'play_store' },
});
const inactiveStatus = () => ({ ...activeStatus(), entitlement: { ...emptyEntitlement } });

function load(path, modules, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: id => modules[id], console, Error, ...globals });
  return exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function hooks() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const equal = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  return {
    react: {
      createContext: () => ({ Provider: 'Provider' }),
      useState: initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef: initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useCallback: (callback, deps) => {
        const index = cursor++;
        if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, callback };
        return slots[index].callback;
      },
      useEffect: (effect, deps) => {
        const index = cursor++;
        if (!equal(slots[index]?.deps, deps)) {
          const previous = slots[index];
          slots[index] = { deps, cleanup: previous?.cleanup };
          effects.push(() => {
            previous?.cleanup?.();
            slots[index].cleanup = effect();
          });
        }
      },
    },
    render: component => { cursor = 0; return component(); },
    flush: () => { const pending = effects; effects = []; pending.forEach(effect => effect()); },
  };
}

const jsx = (type, props) => ({ type, props });
function providerHarness() {
  const h = hooks();
  let user = { id: 'a' };
  let clock = now;
  const requests = [];
  const timers = new Map();
  let nextTimer = 1;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), {
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  class FakeDate extends Date { static now() { return clock; } }
  const { SubscriptionProvider } = load('src/components/SubscriptionProvider.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx },
    '@/components/AuthProvider': { useAuth: () => ({ user, loading: false }) },
    '@/lib/subscription': { emptyEntitlement, fetchSubscriptionStatus: (userId, sync) => {
      const request = { userId, sync, ...deferred() };
      requests.push(request);
      return request.promise;
    } },
  }, { document, window, Date: FakeDate });
  const render = () => h.render(() => SubscriptionProvider({ children: null })).props.value;
  const commit = () => { const value = render(); h.flush(); return value; };
  commit();
  return { render, commit, requests, timers, window, document, setUser: next => { user = next; }, setClock: value => { clock = value; } };
}

test('entitlement parser fails closed for inactive, expired and malformed data', () => {
  const { parseSubscriptionStatus } = load('src/lib/subscription.ts', { '@/lib/supabaseClient': {} });
  assert.equal(parseSubscriptionStatus(activeStatus(), now).entitlement.active, true);
  assert.equal(parseSubscriptionStatus(activeStatus(now - 1), now).entitlement.active, false);
  assert.equal(parseSubscriptionStatus({ ...activeStatus(), configured: false }, now).entitlement.active, false);
  for (const expiry of [null, 'invalid']) {
    const value = activeStatus(); value.entitlement.expiresAt = expiry;
    assert.equal(parseSubscriptionStatus(value, now).entitlement.active, false);
  }
  for (const value of [null, {}, { ...activeStatus(), configured: 'yes' }, { ...activeStatus(), entitlement: { active: true } }]) {
    assert.throws(() => parseSubscriptionStatus(value, now));
  }
});

test('billing API authenticates the current owner and does not send another account token', async () => {
  const requests = [];
  let owner = 'a';
  const { fetchSubscriptionStatus } = load('src/lib/subscription.ts', { '@/lib/supabaseClient': {
    apiUrl: 'https://fizlab.test/api', deviceId: () => 'device-1',
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'secret-session' } }, error: null }) } },
  } }, { AbortSignal, fetch: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(inactiveStatus())); } });
  await fetchSubscriptionStatus('a', true);
  assert.equal(requests[0].url, 'https://fizlab.test/api/billing/v1/sync');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.cache, 'no-store');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-session');
  assert.equal(requests[0].init.headers['x-fizlab-device-id'], 'device-1');
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  owner = 'b';
  await assert.rejects(fetchSubscriptionStatus('a'));
  assert.equal(requests.length, 1);
});

test('late active subscription from account A never unlocks account B', async () => {
  const h = providerHarness();
  h.setUser({ id: 'b' });
  assert.equal(h.commit().entitlement.active, false);
  assert.equal(h.requests[1].userId, 'b');
  h.requests[1].resolve(inactiveStatus()); await tick();
  h.requests[0].resolve(activeStatus()); await tick();
  assert.equal(h.commit().entitlement.active, false);
  assert.equal(h.render().loading, false);
});

test('logout followed by same-account login cannot reuse a previous entitlement', async () => {
  const h = providerHarness();
  h.requests[0].resolve(activeStatus()); await tick();
  assert.equal(h.commit().entitlement.active, true);
  h.setUser(null); assert.equal(h.commit().entitlement.active, false);
  h.setUser({ id: 'a' });
  const beforeEffects = h.render();
  assert.equal(beforeEffects.entitlement.active, false);
  assert.equal(beforeEffects.loading, true);
});

test('an unexpired subscription survives a background request, but a failed response closes access', async () => {
  const h = providerHarness();
  h.requests[0].resolve(activeStatus()); await tick();
  const paid = h.commit(); assert.equal(paid.entitlement.active, true);
  const refresh = paid.refresh();
  assert.equal(h.render().entitlement.active, true);
  assert.equal(h.render().loading, false);
  h.requests[1].reject(new Error('network unavailable'));
  await assert.rejects(refresh);
  assert.equal(h.commit().entitlement.active, false);
  assert.match(h.render().error, /network/);
});

test('offline invalidates a pending successful response, and online retries', async () => {
  const h = providerHarness();
  h.window.dispatchEvent(new Event('offline'));
  h.requests[0].resolve(activeStatus()); await tick();
  assert.equal(h.commit().entitlement.active, false);
  assert.match(h.render().error, /интернет/);
  h.window.dispatchEvent(new Event('online'));
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(activeStatus()); await tick();
  assert.equal(h.commit().entitlement.active, true);
});

test('expiration removes access and schedules immediate server recheck', async () => {
  const h = providerHarness();
  h.requests[0].resolve(activeStatus(now + 1500)); await tick();
  assert.equal(h.commit().entitlement.active, true);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 1500);
  h.setClock(now + 1501);
  assert.equal(h.render().entitlement.active, false);
  timer.callback();
  assert.equal(h.requests.length, 2);
});

test('visibility refresh is limited to visible documents', async () => {
  const h = providerHarness();
  h.requests[0].resolve(activeStatus()); await tick(); h.commit();
  h.document.visibilityState = 'hidden'; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.requests.length, 1);
  h.document.visibilityState = 'visible'; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().entitlement.active, true);
});

test('premium topic modules are loaded only after subscription verification', async () => {
  const h = hooks();
  let access = { loading: true, hasFullAccess: false };
  let slug = 'newton-laws';
  const imports = [];
  const stub = new Proxy({}, { get: (_target, name) => name });
  const modules = new Proxy({
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { useParams: () => ({ slug }), Navigate: 'Navigate' },
    'framer-motion': { motion: stub },
    '@/topics': { loadTopic: async value => { imports.push(value); return undefined; } },
    '@/data/sections': { findSectionByTopicSlug: () => ({ id: 'mechanics', title: 'Механика', topics: [{ slug, title: 'Topic' }] }) },
    '@/hooks/useDocumentTitle': { useDocumentTitle() {} },
    '@/hooks/useProgress': { useSolvedCount: () => 0, useTopicCompleted: () => false },
    '@/components/AuthProvider': { useAuth: () => ({ user: { id: 'a' } }) },
    '@/hooks/useAccess': { useAccess: () => access },
    '@/lib/access': { isFreeDemoTopic: value => value === 'kinematics' },
  }, { get: (target, name) => target[name] ?? stub });
  const { TopicPage } = load('src/pages/TopicPage.tsx', modules);
  const commit = () => { const result = h.render(TopicPage); h.flush(); return result; };
  commit(); assert.deepEqual(imports, []);
  access = { loading: false, hasFullAccess: false };
  commit(); assert.deepEqual(imports, []);
  access = { loading: false, hasFullAccess: true };
  commit(); assert.deepEqual(imports, ['newton-laws']);
  access = { loading: false, hasFullAccess: false }; slug = 'kinematics';
  commit(); assert.deepEqual(imports, ['newton-laws', 'kinematics']);
  await tick();
});
