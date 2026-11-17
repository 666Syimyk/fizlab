import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const now = Date.parse('2026-10-02T12:00:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ownerStatus = () => ({ role: 'superadmin', fullAccess: true, source: 'superadmin', expiresAt: null, checkedAt: new Date(now).toISOString() });
const memberStatus = () => ({ role: 'member', fullAccess: false, source: null, expiresAt: null, checkedAt: new Date(now).toISOString() });
const grantStatus = (expiresAt = now + 3600000) => ({ role: 'member', fullAccess: true, source: 'grant', expiresAt: new Date(expiresAt).toISOString(), checkedAt: new Date(now).toISOString() });

function load(file, modules, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: id => modules[id], console, Error, ...globals });
  return exports;
}

function deferred() {
  let resolve;
  let reject;
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
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useCallback(callback, deps) {
        const index = cursor++;
        if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, callback };
        return slots[index].callback;
      },
      useEffect(effect, deps) {
        const index = cursor++;
        if (!equal(slots[index]?.deps, deps)) {
          const previous = slots[index];
          slots[index] = { deps, cleanup: previous?.cleanup };
          effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
        }
      },
    },
    render(component) { cursor = 0; return component(); },
    flush() { const pending = effects; effects = []; pending.forEach(effect => effect()); },
  };
}

function providerHarness() {
  const h = hooks();
  let user = { id: 'a' };
  let authLoading = false;
  let clock = now;
  let nextTimer = 1;
  const requests = [];
  const timeouts = new Map();
  const intervals = new Map();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), {
    setTimeout(callback, delay) { const id = nextTimer++; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) { const id = nextTimer++; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  class FakeDate extends Date { static now() { return clock; } }
  const { AccountAccessProvider } = load('src/components/AccountAccessProvider.tsx', {
    react: h.react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@/components/AuthProvider': { useAuth: () => ({ user, loading: authLoading }) },
    '@/lib/accountAccess': { fetchAccountAccess(userId) { const pending = { userId, ...deferred() }; requests.push(pending); return pending.promise; } },
  }, { document, window, Date: FakeDate });
  const render = () => h.render(() => AccountAccessProvider({ children: null })).props.value;
  const commit = () => { const value = render(); h.flush(); return value; };
  commit();
  return { render, commit, requests, timeouts, intervals, document, window, setUser: value => { user = value; }, setAuthLoading: value => { authLoading = value; }, setClock: value => { clock = value; } };
}

test('access parser accepts only coherent roles and denies malformed or expired access', () => {
  const { parseAccountAccess } = load('src/lib/accountAccess.ts', { '@/lib/supabaseClient': {} });
  assert.equal(parseAccountAccess(ownerStatus(), now).role, 'superadmin');
  assert.equal(parseAccountAccess(grantStatus(), now).source, 'grant');
  assert.equal(parseAccountAccess(memberStatus(), now).fullAccess, false);
  for (const value of [
    null, [], {}, { ...ownerStatus(), fullAccess: 'true' }, { ...ownerStatus(), role: 'admin' },
    { ...ownerStatus(), expiresAt: new Date(now + 1000).toISOString() }, { ...ownerStatus(), source: 'grant' },
    { ...memberStatus(), fullAccess: true }, { ...memberStatus(), source: 'superadmin' },
    { ...grantStatus(), expiresAt: null }, { ...grantStatus(), expiresAt: 'invalid' },
    { ...grantStatus(), expiresAt: 12345 }, grantStatus(now), grantStatus(now - 1),
  ]) assert.throws(() => parseAccountAccess(value, now));
});

test('access parser rejects stale, future and missing server timestamps', () => {
  const { parseAccountAccess } = load('src/lib/accountAccess.ts', { '@/lib/supabaseClient': {} });
  for (const checkedAt of [null, '', 'invalid', 123, new Date(now - 60001).toISOString(), new Date(now + 60001).toISOString()]) {
    assert.throws(() => parseAccountAccess({ ...ownerStatus(), checkedAt }, now));
  }
  assert.equal(parseAccountAccess({ ...ownerStatus(), checkedAt: new Date(now - 60000).toISOString() }, now).fullAccess, true);
});

test('access API sends only the matching current session with device identity and no-store', async () => {
  const requests = [];
  let session = { user: { id: 'a' }, access_token: 'synthetic-current-session' };
  let sessionError = null;
  class FakeDate extends Date { static now() { return now; } }
  const { fetchAccountAccess } = load('src/lib/accountAccess.ts', { '@/lib/supabaseClient': {
    apiUrl: 'https://fizlab.test/api', deviceId: () => 'synthetic-device',
    supabase: { auth: { getSession: async () => ({ data: { session }, error: sessionError }) } },
  } }, { Date: FakeDate, AbortSignal, fetch: async (url, init) => { requests.push({ url, init }); return Response.json(ownerStatus()); } });
  assert.equal((await fetchAccountAccess('a')).role, 'superadmin');
  assert.equal(requests[0].url, 'https://fizlab.test/api/access/v1/status');
  assert.equal(requests[0].init.method ?? 'GET', 'GET');
  assert.equal(requests[0].init.cache, 'no-store');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer synthetic-current-session');
  assert.equal(requests[0].init.headers['x-fizlab-device-id'], 'synthetic-device');
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  session = { user: { id: 'b' }, access_token: 'synthetic-other-session' };
  await assert.rejects(fetchAccountAccess('a'));
  session = null;
  await assert.rejects(fetchAccountAccess('a'));
  session = { user: { id: 'a' }, access_token: 'synthetic-current-session' };
  sessionError = new Error('session invalid');
  await assert.rejects(fetchAccountAccess('a'));
  assert.equal(requests.length, 1, 'foreign, missing or failed sessions must never reach the API');
});

test('access API cannot grant permissions from failed HTTP responses or malformed bodies', async () => {
  class FakeDate extends Date { static now() { return now; } }
  let response = () => Response.json(ownerStatus(), { status: 403 });
  const { fetchAccountAccess } = load('src/lib/accountAccess.ts', { '@/lib/supabaseClient': {
    apiUrl: 'https://fizlab.test/api', deviceId: () => 'synthetic-device',
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'a' }, access_token: 'synthetic' } }, error: null }) } },
  } }, { Date: FakeDate, AbortSignal, fetch: async () => response() });
  await assert.rejects(fetchAccountAccess('a'));
  response = () => Response.json({ ...ownerStatus(), checkedAt: new Date(now - 60001).toISOString() });
  await assert.rejects(fetchAccountAccess('a'));
  response = () => new Response('<html>not JSON</html>');
  await assert.rejects(fetchAccountAccess('a'));
});

test('late superadmin response from account A never grants permissions to account B', async () => {
  const h = providerHarness();
  h.setUser({ id: 'b' });
  assert.equal(h.commit().fullAccess, false);
  assert.equal(h.requests[1].userId, 'b');
  h.requests[1].resolve(memberStatus()); await tick();
  h.requests[0].resolve(ownerStatus()); await tick();
  const state = h.commit();
  assert.equal(state.fullAccess, false);
  assert.equal(state.isSuperadmin, false);
  assert.equal(state.source, null);
  assert.equal(state.loading, false);
});

test('logout followed by the same account cannot reuse an old status or pending request', async () => {
  const h = providerHarness();
  h.requests[0].resolve(ownerStatus()); await tick();
  assert.equal(h.commit().isSuperadmin, true);
  const pendingRefresh = h.render().refresh();
  h.setUser(null);
  assert.equal(h.commit().fullAccess, false);
  assert.equal(h.intervals.size, 0);
  h.setUser({ id: 'a' });
  assert.equal(h.render().isSuperadmin, false, 'permissions must clear before effects after re-login');
  assert.equal(h.commit().loading, true);
  h.requests[1].resolve(ownerStatus()); await pendingRefresh;
  assert.equal(h.render().isSuperadmin, false);
  h.requests[2].resolve(memberStatus()); await tick();
  assert.equal(h.commit().fullAccess, false);
});

test('offline clears permissions and invalidates a pending success; online performs a fresh check', async () => {
  const h = providerHarness();
  h.window.dispatchEvent(new Event('offline'));
  h.requests[0].resolve(ownerStatus()); await tick();
  assert.equal(h.commit().isSuperadmin, false);
  assert.match(h.render().error, /интернет/);
  h.window.dispatchEvent(new Event('online'));
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(ownerStatus()); await tick();
  assert.equal(h.commit().isSuperadmin, true);
  h.window.dispatchEvent(new Event('offline'));
  assert.equal(h.commit().fullAccess, false);
});

test('refresh removes revoked rights, and older successful responses cannot overwrite the revocation', async () => {
  const h = providerHarness();
  h.requests[0].resolve(ownerStatus()); await tick();
  assert.equal(h.commit().isSuperadmin, true);
  const older = h.render().refresh();
  const newer = h.render().refresh();
  h.requests[2].resolve(memberStatus()); await newer;
  assert.equal(h.commit().fullAccess, false);
  h.requests[1].resolve(ownerStatus()); await older;
  assert.equal(h.commit().isSuperadmin, false);
  assert.equal(h.render().source, null);
});

test('failed background verification closes access and does not retain admin role', async () => {
  const h = providerHarness();
  h.requests[0].resolve(ownerStatus()); await tick(); h.commit();
  const refresh = h.render().refresh();
  assert.equal(h.render().fullAccess, true, 'unexpired rights survive while a refresh is pending');
  h.requests[1].reject(new Error('network unavailable'));
  await refresh;
  assert.equal(h.commit().fullAccess, false);
  assert.equal(h.render().isSuperadmin, false);
  assert.match(h.render().error, /подключение/);
});

test('grant expiry closes access immediately and starts a fresh server check', async () => {
  const h = providerHarness();
  h.requests[0].resolve(grantStatus(now + 1500)); await tick();
  assert.equal(h.commit().fullAccess, true);
  const timer = [...h.timeouts.values()][0];
  assert.equal(timer.delay, 1500);
  h.setClock(now + 1501);
  assert.equal(h.render().fullAccess, false, 'render must reject expiry even before its timer fires');
  assert.equal(h.render().source, null);
  timer.callback();
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().loading, true);
  h.requests[1].resolve(memberStatus()); await tick();
  assert.equal(h.commit().fullAccess, false);
});

test('periodic and focus checks respect visibility, and pending authentication suppresses rights', async () => {
  const h = providerHarness();
  h.requests[0].resolve(ownerStatus()); await tick(); h.commit();
  const interval = [...h.intervals.values()][0];
  assert.equal(interval.delay, 60000);
  h.document.visibilityState = 'hidden';
  interval.callback();
  h.window.dispatchEvent(new Event('focus'));
  assert.equal(h.requests.length, 1);
  h.document.visibilityState = 'visible';
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.requests.length, 2);
  h.setAuthLoading(true);
  assert.equal(h.commit().fullAccess, false);
  assert.equal(h.render().loading, true);
  assert.equal(h.intervals.size, 0);
  h.requests[1].resolve(ownerStatus()); await tick();
  assert.equal(h.commit().fullAccess, false);
});
