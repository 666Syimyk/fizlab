import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function load(path, modules, globals = {}) {
  const input = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('import.meta.env', 'testEnv');
  const source = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: id => modules[id], console, setTimeout, clearTimeout, ...globals });
  return exports;
}

function providerHarness(initialError = null) {
  const states = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let listener;
  const userA = { id: 'a' };
  const profileRequests = [];
  const signOuts = [];
  const syncs = [];
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useRef: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
    useEffect: effect => { if (!(effectCursor++ in effects)) effects.push(effect); },
  };
  const supabase = {
    from: () => ({ select: () => ({ eq: (_key, userId) => ({ maybeSingle: () => {
      const request = deferred(); profileRequests.push({ userId, ...request }); return request.promise;
    } }) }) }),
    auth: {
      getUser: async () => ({ data: { user: initialError ? null : userA }, error: initialError }),
      getSession: async () => ({ data: { session: { user: userA } }, error: null }),
      signOut: async options => { signOuts.push(options); return { error: null }; },
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  const { AuthProvider } = load('src/components/AuthProvider.tsx', {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@/lib/supabaseClient': { supabase, isSupabaseConfigured: true },
    '@/lib/progressSync': { migrateAndSyncProgress: async id => { syncs.push(id); }, stopProgressSync() {} },
    '@/lib/progress': { setProgressUser() {} }, '@/lib/analytics': { setAnalyticsUser() {} },
    '@/lib/authMutations': { runAuthMutation: operation => operation() },
  }, { document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), window: new EventTarget() });
  const render = () => { cursor = 0; effectCursor = 0; return AuthProvider({ children: null }).props.value; };
  render(); effects.forEach(effect => effect());
  return { render, profileRequests, signOuts, syncs, emit: (event, user) => listener(event, { user }) };
}

test('a late profile refresh cannot replace another account profile', async () => {
  const h = providerHarness(); await tick();
  h.profileRequests[0].resolve({ data: { id: 'a' }, error: null }); await tick();
  const refresh = h.render().refreshProfile();
  h.emit('SIGNED_IN', { id: 'b' }); await tick();
  h.profileRequests[2].resolve({ data: { id: 'b' }, error: null }); await tick();
  h.profileRequests[1].resolve({ data: { id: 'a', avatar_data: 'private-a' }, error: null }); await refresh;
  assert.equal(h.render().user.id, 'b');
  assert.equal(h.render().profile.id, 'b');
});

test('temporary verification network failure preserves the cached login', async () => {
  const h = providerHarness({ status: 0, name: 'AuthRetryableFetchError' }); await tick();
  assert.equal(h.signOuts.length, 0);
  assert.equal(h.render().user?.id, 'a');
});

test('confirmed revoked session is signed out', async () => {
  const h = providerHarness({ status: 401, name: 'AuthApiError' }); await tick();
  assert.equal(h.signOuts.length, 1);
  assert.equal(h.render().user, null);
});

test('token refresh does not restart progress migration', async () => {
  const h = providerHarness(); await tick();
  h.profileRequests[0].resolve({ data: { id: 'a' }, error: null }); await tick();
  h.emit('TOKEN_REFRESHED', { id: 'a' }); await tick();
  assert.equal(h.profileRequests.length, 1);
  assert.deepEqual(h.syncs, ['a']);
});

test('a fresh login to the same account reloads progress from the other device', async () => {
  const h = providerHarness(); await tick();
  h.profileRequests[0].resolve({ data: { id: 'a' }, error: null }); await tick();
  h.emit('SIGNED_IN', { id: 'a' }); await tick();
  assert.deepEqual(h.syncs, ['a', 'a']);
  assert.equal(h.profileRequests.length, 2);
});

test('auth request has a timeout and handles an HTML service failure', async () => {
  let request;
  const { authPost } = load('src/lib/authApi.ts', {
    '@/lib/supabaseClient': { apiUrl: 'https://example.test/api', deviceId: () => 'device' },
  }, { AbortSignal, fetch: async (_url, init) => { request = init; return new Response('<h1>Unavailable</h1>', { status: 503 }); } });
  await assert.rejects(authPost('signup', {}), error => {
    assert.equal(error.status, 503);
    assert.ok(!error.message.includes('JSON'));
    return true;
  });
  assert.ok(request.signal instanceof AbortSignal);
});

test('configured API trailing slashes cannot create a double-slash auth route', async () => {
  for (const configured of ['https://example.test/api/', 'https://example.test/api///', undefined]) {
    let sdkUrl;
    const client = load('src/lib/supabaseClient.ts', {
      '@supabase/supabase-js': { createClient: url => { sdkUrl = url; return {}; } },
    }, { testEnv: { VITE_API_URL: configured }, window: { location: { origin: 'https://example.test' } } });
    let requestUrl;
    const { authPost } = load('src/lib/authApi.ts', {
      '@/lib/supabaseClient': { apiUrl: client.apiUrl, deviceId: () => 'device' },
    }, { AbortSignal, fetch: async url => { requestUrl = url; return new Response('{}'); } });
    await authPost('recover', {});
    assert.equal(sdkUrl, 'https://example.test/api');
    assert.equal(requestUrl, 'https://example.test/api/auth/v1/recover');
  }
});

test('avatar compression respects the server decoded-byte limit', async () => {
  const oversized = `data:image/jpeg;base64,${Buffer.alloc(35100).toString('base64')}`;
  const accepted = `data:image/jpeg;base64,${Buffer.alloc(34500).toString('base64')}`;
  let encodes = 0;
  const { prepareAvatar } = load('src/lib/avatar.ts', {}, {
    createImageBitmap: async () => ({ width: 300, height: 300, close() {} }),
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => encodes++ ? accepted : oversized }) },
  });
  const result = await prepareAvatar({ type: 'image/jpeg', size: 100000 });
  assert.equal(Buffer.from(result.split(',')[1], 'base64').byteLength, 34500);
});

test('auth continuation accepts internal purchase routes and rejects external redirects', () => {
  const { authNext } = load('src/lib/authRedirect.ts', {}, { URLSearchParams });
  assert.equal(authNext('?next=%2Fsubscription'), '/subscription');
  assert.equal(authNext('?next=%2Ftopic%2Fkinematics%3Ftab%3Dproblems'), '/topic/kinematics?tab=problems');
  for (const next of ['https://attacker.invalid', '//attacker.invalid', '/\\attacker.invalid', '/\n/attacker.invalid', 'javascript:alert(1)']) {
    assert.equal(authNext(`?next=${encodeURIComponent(next)}`), '/', next);
  }
});
