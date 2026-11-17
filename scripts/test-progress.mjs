import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test as nodeTest } from 'node:test';
import ts from 'typescript';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const test = (name, run) => nodeTest(name, { timeout: 2000 }, run);

function harness() {
  const values = new Map();
  let storageFailure = null;
  const window = new EventTarget();
  const localStorage = {
    getItem: key => { if (storageFailure === 'blocked') throw new Error('Storage blocked'); return values.get(key) ?? null; },
    setItem: (key, value) => { if (storageFailure) throw new Error('Storage unavailable'); values.set(key, String(value)); },
    removeItem: key => { if (storageFailure) throw new Error('Storage unavailable'); values.delete(key); },
  };
  const loads = [];
  const writes = [];
  const supabase = { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => {
      const request = deferred(); loads.push(request); return request.promise;
    } }) }),
    upsert: payload => {
      const request = deferred(); writes.push({ payload: JSON.parse(JSON.stringify(payload)), ...request }); return request.promise;
    },
  }) };
  const modules = { '@/lib/supabaseClient': { supabase } };
  const load = name => {
    const source = ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(source, { exports, require: id => modules[id], window, localStorage, Event, console, setTimeout, clearTimeout });
    return exports;
  };
  const progress = load('progress');
  modules['@/lib/progress'] = progress;
  const sync = load('progressSync');
  return { ...progress, ...sync, values, window, loads, writes, failStorage: mode => { storageFailure = mode; } };
}

test('invalid persisted progress cannot crash counters or solving', () => {
  const h = harness();
  for (const raw of ['null', '[]', '17', '{"kinematics":7}', '{"kinematics":["p1","p1",null]}']) {
    h.values.set('fizlab:solved-problems', raw);
    assert.doesNotThrow(() => h.getTotalSolvedCount());
    assert.doesNotThrow(() => h.markSolved('kinematics', 'p2'));
    assert.equal(h.getSolvedIds('kinematics').has('p2'), true);
    assert.ok(h.getTotalSolvedCount() <= 2);
  }
});

test('account and guest local progress remain separate', () => {
  const h = harness();
  h.markSolved('kinematics', 'guest');
  h.setProgressUser('a'); h.markSolved('kinematics', 'a');
  h.setProgressUser('b'); assert.equal(h.getTotalSolvedCount(), 0);
  h.setProgressUser('a'); assert.deepEqual([...h.getSolvedIds('kinematics')], ['a']);
  h.setProgressUser(null); assert.deepEqual([...h.getSolvedIds('kinematics')], ['guest']);
});

test('an edit during the first upload is subsequently saved without another UI edit', async () => {
  const h = harness(); h.setProgressUser('a');
  const startup = h.migrateAndSyncProgress('a');
  h.loads[0].resolve({ data: null, error: null }); await tick();
  h.markSolved('kinematics', 'during-upload');
  h.writes[0].resolve({ error: null }); await tick();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[1].payload.solved_problem_ids.kinematics, ['during-upload']);
  h.writes[1].resolve({ error: null }); await startup;
  h.stopProgressSync();
});

test('stale migration from a previous session of the same user is ignored', async () => {
  const h = harness(); h.setProgressUser('a');
  const old = h.migrateAndSyncProgress('a');
  h.stopProgressSync();
  const current = h.migrateAndSyncProgress('a');
  h.loads[1].resolve({ data: { solved_problem_ids: {}, completed_topic_slugs: [] }, error: null }); await tick();
  h.writes[0].resolve({ error: null }); await current;
  h.loads[0].resolve({ data: { solved_problem_ids: { kinematics: ['stale'] }, completed_topic_slugs: [] }, error: null }); await tick();
  assert.equal(h.getTotalSolvedCount(), 0);
  assert.equal(h.writes.length, 1);
  await old;
  h.stopProgressSync();
});

test('offline completion removal survives the next remote merge', async () => {
  const h = harness(); h.setProgressUser('a');
  h.setTopicCompleted('kinematics', true);
  h.setTopicCompleted('kinematics', false);
  const startup = h.migrateAndSyncProgress('a');
  h.loads[0].resolve({ data: { solved_problem_ids: {}, completed_topic_slugs: ['kinematics'] }, error: null }); await tick();
  assert.equal(h.isTopicCompleted('kinematics'), false);
  assert.deepEqual(h.writes[0].payload.completed_topic_slugs, []);
  h.writes[0].resolve({ error: null }); await startup;
  h.stopProgressSync();
});

test('reconnection retries a failed progress load before uploading local changes', async () => {
  const h = harness(); h.setProgressUser('a'); h.markSolved('kinematics', 'local');
  const startup = h.migrateAndSyncProgress('a');
  h.loads[0].resolve({ data: null, error: new Error('offline') }); await startup;
  h.window.dispatchEvent(new Event('online')); await tick();
  assert.equal(h.loads.length, 2);
  h.loads[1].resolve({ data: { solved_problem_ids: { kinematics: ['remote'] }, completed_topic_slugs: [] }, error: null }); await tick();
  assert.deepEqual(h.writes[0].payload.solved_problem_ids.kinematics.sort(), ['local', 'remote']);
  h.writes[0].resolve({ error: null }); await tick();
  h.stopProgressSync();
});

test('an already-synced local completion cannot restore a topic removed on another device', async () => {
  const h = harness(); h.setProgressUser('a'); h.setTopicCompleted('kinematics', true);
  const first = h.migrateAndSyncProgress('a');
  h.loads[0].resolve({ data: null, error: null }); await tick();
  h.writes[0].resolve({ error: null }); await first; h.stopProgressSync();
  const next = h.migrateAndSyncProgress('a');
  h.loads[1].resolve({ data: { solved_problem_ids: {}, completed_topic_slugs: [] }, error: null }); await tick();
  assert.equal(h.isTopicCompleted('kinematics'), false);
  h.writes[1].resolve({ error: null }); await next;
  h.stopProgressSync();
});

test('completion toggled during upload retains its unsaved change until the next response', async () => {
  const h = harness(); h.setProgressUser('a'); h.setTopicCompleted('kinematics', true);
  const startup = h.migrateAndSyncProgress('a');
  h.loads[0].resolve({ data: null, error: null }); await tick();
  h.setTopicCompleted('kinematics', false);
  h.writes[0].resolve({ error: null }); await tick();
  assert.equal(h.getCompletionChanges().kinematics, false);
  assert.deepEqual(h.writes[1].payload.completed_topic_slugs, []);
  h.writes[1].resolve({ error: null }); await startup;
  assert.equal(h.getCompletionChanges().kinematics, undefined);
  h.stopProgressSync();
});

for (const mode of ['blocked', 'quota']) {
  test(`remote progress is preserved when localStorage fails (${mode})`, async () => {
    const h = harness(); h.setProgressUser('a');
    h.values.set('fizlab:solved-problems:a', '{}');
    h.values.set('fizlab:completed-topics:a', '[]');
    h.failStorage(mode);
    const startup = h.migrateAndSyncProgress('a');
    h.loads[0].resolve({ data: { solved_problem_ids: { kinematics: ['remote'] }, completed_topic_slugs: ['kinematics'] }, error: null }); await tick();
    assert.deepEqual(h.writes[0].payload.solved_problem_ids.kinematics, ['remote']);
    assert.deepEqual(h.writes[0].payload.completed_topic_slugs, ['kinematics']);
    h.writes[0].resolve({ error: null }); await startup; h.stopProgressSync();
    assert.equal(h.isTopicCompleted('kinematics'), true);
    h.setProgressUser('b'); assert.equal(h.getTotalSolvedCount(), 0);
    h.setProgressUser('a'); assert.deepEqual([...h.getSolvedIds('kinematics')], ['remote']);
  });
}

test('sync status reports a failed upload and a successful explicit retry', async () => {
  const h = harness(); h.setProgressUser('a');
  const states = [];
  const unsubscribe = h.subscribeToProgressSync(() => states.push(h.getProgressSyncSnapshot().status));
  const startup = h.migrateAndSyncProgress('a');
  assert.equal(h.getProgressSyncSnapshot().status, 'syncing');
  h.loads[0].resolve({ data: null, error: null }); await tick();
  h.writes[0].resolve({ error: new Error('offline') }); await startup;
  assert.equal(h.getProgressSyncSnapshot().status, 'error');
  assert.equal(h.getProgressSyncSnapshot().persistent, true);
  const retry = h.retryProgressSync();
  assert.equal(h.getProgressSyncSnapshot().status, 'syncing');
  h.writes[1].resolve({ error: null }); await retry;
  assert.equal(h.getProgressSyncSnapshot().status, 'synced');
  assert.deepEqual(states, ['syncing', 'error', 'syncing', 'synced']);
  unsubscribe(); h.stopProgressSync();
});

test('failed sync does not claim on-device persistence when storage is unavailable', async () => {
  const h = harness(); h.setProgressUser('a'); h.failStorage('blocked');
  const startup = h.migrateAndSyncProgress('a');
  h.loads[0].resolve({ data: { solved_problem_ids: { kinematics: ['remote'] }, completed_topic_slugs: [] }, error: null }); await tick();
  h.writes[0].resolve({ error: new Error('offline') }); await startup;
  assert.equal(h.getProgressSyncSnapshot().status, 'error');
  assert.equal(h.getProgressSyncSnapshot().persistent, false);
  h.stopProgressSync();
});
