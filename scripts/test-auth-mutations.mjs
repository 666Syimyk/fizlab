import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import worker from '../server/worker.mjs';

const source = readFileSync(new URL('../src/lib/authMutations.ts', import.meta.url), 'utf8');
function loadMutations() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, AbortSignal });
  return exports;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  return {
    async exec(sql) { sqlite.exec(sql); },
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first(column) { const row = sqlite.prepare(sql).get(...args); return column ? row?.[column] ?? null : row ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return statement.runSync(); },
        runSync() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = statements.map(statement => statement.runSync()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
const PASSWORD = 'Unusual green rivers flow between mountains 92';
async function signup(env, deviceId, email) {
  const response = await worker.fetch(new Request('http://localhost/api/auth/v1/signup', {
    method: 'POST', headers: { 'x-fizlab-device-id': deviceId },
    body: JSON.stringify({ email, password: PASSWORD, password_confirmation: PASSWORD, data: { first_name: 'Demo', last_name: 'Account' } }),
  }), env);
  assert.equal(response.status, 200);
}

test('queued sign-in survives a delayed older SDK logout without browser locks', { timeout: 10000 }, async t => {
  const env = { DB: database(t) };
  const deviceId = crypto.randomUUID();
  await signup(env, deviceId, 'first@example.com');
  await signup(env, deviceId, 'second@example.com');
  const entered = deferred();
  const blocked = deferred();
  const client = createClient('http://localhost/api', 'public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const response = await worker.fetch(new Request(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-fizlab-device-id': deviceId } }), env);
      if (String(input).includes('/logout')) { entered.resolve(); await blocked.promise; }
      return response;
    } },
  });
  const { runAuthMutation } = loadMutations();
  await runAuthMutation(() => client.auth.signInWithPassword({ email: 'first@example.com', password: PASSWORD }));
  const loggingOut = runAuthMutation(() => client.auth.signOut());
  await entered.promise;
  let loginStarted = false;
  const loggingIn = runAuthMutation(() => { loginStarted = true; return client.auth.signInWithPassword({ email: 'second@example.com', password: PASSWORD }); });
  await new Promise(resolve => setImmediate(resolve));
  const ranBeforeLogout = loginStarted;
  blocked.resolve();
  await loggingOut;
  assert.equal((await loggingIn).error, null);
  assert.equal(ranBeforeLogout, false, 'the newer login must wait for SDK local-session cleanup');
  assert.equal((await client.auth.getSession()).data.session?.user.email, 'second@example.com');
});

test('an unsuccessful auth operation does not poison later operations', async () => {
  const { runAuthMutation } = loadMutations();
  await assert.rejects(runAuthMutation(async () => { throw new Error('expected failure'); }), /expected failure/);
  assert.equal(await runAuthMutation(async () => 'next operation'), 'next operation');
});

test('browser SDK is lockless by default and the app guard serializes two same-origin tabs', { timeout: 20000 }, async t => {
  const module = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sdk = readFileSync(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/authMutations.js' || req.url === '/supabase.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/authMutations.js' ? module : req.url === '/supabase.js' ? sdk : '<!doctype html><script src="/supabase.js"></script><script type="module">import {runAuthMutation} from "/authMutations.js"; window.runAuthMutation=runAuthMutation;</script>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await Promise.all([first.goto(origin), second.goto(origin)]);
  await Promise.all([first.waitForFunction(() => window.runAuthMutation), second.waitForFunction(() => window.runAuthMutation)]);
  const runtime = await first.evaluate(() => {
    const client = window.supabase.createClient(`${location.origin}/api`, 'public', { auth: { persistSession: false, autoRefreshToken: false } });
    return { locksAvailable: Boolean(navigator.locks), sdkHasNoDefaultLock: client.auth.lock === null };
  });
  assert.deepEqual(runtime, { locksAvailable: true, sdkHasNoDefaultLock: true });
  await first.evaluate(() => {
    window.firstOperation = window.runAuthMutation(async () => {
      window.firstEntered = true;
      await new Promise(resolve => { window.releaseFirst = resolve; });
    });
  });
  await first.waitForFunction(() => window.firstEntered);
  await second.evaluate(() => { window.secondOperation = window.runAuthMutation(async () => { window.secondEntered = true; }); });
  const state = await second.evaluate(async () => {
    // Query the real lock manager after it has processed the request.
    const locks = await navigator.locks.query();
    return { entered: Boolean(window.secondEntered), waiting: locks.pending.some(lock => lock.name === 'fizlab:auth-mutations') };
  });
  await first.evaluate(() => window.releaseFirst());
  await Promise.all([first.evaluate(() => window.firstOperation), second.evaluate(() => window.secondOperation)]);
  assert.deepEqual(state, { entered: false, waiting: true });
  assert.equal(await second.evaluate(() => window.secondEntered), true);
});
