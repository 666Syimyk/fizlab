import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadServerEnv } from './server-env.mjs';

function fixture(t) {
  const temporaryRoot = realpathSync(os.tmpdir());
  const cwd = mkdtempSync(path.join(temporaryRoot, 'fizlab-server-env-'));
  t.after(() => {
    const resolved = realpathSync(cwd);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('fizlab-server-env-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  return {
    cwd,
    write(value, name = '.env.server.local') { const file = path.join(cwd, name); writeFileSync(file, value); return file; },
    load(processEnv = {}) { return loadServerEnv({ processEnv, cwd }); },
  };
}

test('private file uses Node dotenv quoting, comments and exports without mutating process.env', t => {
  const f = fixture(t);
  f.write('\uFEFF# private configuration\r\nexport AUTH_EMAIL_ENABLED = true\r\nAUTH_EMAIL_FROM = "ФизЛаб 3D <mail@example.test>" # sender\r\nRESEND_API_KEY = \'synthetic#secret=one\'\r\nAUTH_EMAIL_CODE_SECRET="line one\nline two"\r\nREVENUECAT_ALLOW_SANDBOX=0\r\n');
  const globalBefore = JSON.stringify(process.env);
  assert.deepEqual(f.load(), {
    AUTH_EMAIL_ENABLED: 'true', AUTH_EMAIL_FROM: 'ФизЛаб 3D <mail@example.test>',
    RESEND_API_KEY: 'synthetic#secret=one', AUTH_EMAIL_CODE_SECRET: 'line one\nline two',
    REVENUECAT_ALLOW_SANDBOX: '0',
  });
  assert.ok(JSON.stringify(process.env) === globalBefore, 'loading must not mutate the global process environment');
});

test('only server allowlist keys are returned from the file and process environment', t => {
  const f = fixture(t);
  f.write('AUTH_EMAIL_ENABLED=1\nREVENUECAT_SECRET_API_KEY=synthetic-billing\nREVENUECAT_ENTITLEMENT_ID=fizlab_pro\nNODE_OPTIONS=--inspect\nVITE_RESEND_API_KEY=synthetic-client-leak\nPORT=9999\nPATH=unexpected\nFIZLAB_DB_PATH=unexpected.sqlite\nFIZLAB_SERVER_ENV_FILE=another.env\nUNKNOWN=ignored\n');
  assert.deepEqual(f.load({ NODE_OPTIONS: '--inspect', VITE_API_URL: 'unexpected', PORT: '1234', UNKNOWN: 'ignored' }), {
    AUTH_EMAIL_ENABLED: '1', REVENUECAT_SECRET_API_KEY: 'synthetic-billing', REVENUECAT_ENTITLEMENT_ID: 'fizlab_pro',
  });
});

test('explicit process settings override private file values including intentional empty strings', t => {
  const f = fixture(t);
  f.write('AUTH_EMAIL_ENABLED=1\nRESEND_API_KEY=synthetic-from-file\nAUTH_EMAIL_FROM="File <file@example.test>"\nREVENUECAT_SECRET_API_KEY=synthetic-from-file\n');
  const processEnv = Object.freeze({ AUTH_EMAIL_ENABLED: '0', RESEND_API_KEY: '', AUTH_EMAIL_FROM: 'Process <process@example.test>', REVENUECAT_SECRET_API_KEY: '' });
  assert.deepEqual(f.load(processEnv), processEnv);
});

test('default or explicit missing private files are optional and client dotenv files are never loaded', t => {
  const f = fixture(t);
  f.write('AUTH_EMAIL_ENABLED=1\nRESEND_API_KEY=synthetic-client-value\n', '.env.local');
  f.write('AUTH_EMAIL_FROM=unexpected@example.test\n', '.env');
  assert.deepEqual(f.load(), {});
  assert.deepEqual(f.load({ FIZLAB_SERVER_ENV_FILE: 'absent.env', AUTH_EMAIL_ENABLED: '0' }), { AUTH_EMAIL_ENABLED: '0' });
});

test('an explicit private filename is resolved against cwd and an empty filename disables reading', t => {
  const f = fixture(t);
  f.write('AUTH_EMAIL_ENABLED=broken-default\n');
  const custom = f.write('AUTH_EMAIL_ENABLED=1\nRESEND_API_KEY=synthetic-alternate\n', 'custom.private');
  const expected = { AUTH_EMAIL_ENABLED: '1', RESEND_API_KEY: 'synthetic-alternate' };
  assert.deepEqual(f.load({ FIZLAB_SERVER_ENV_FILE: 'custom.private' }), expected);
  assert.deepEqual(f.load({ FIZLAB_SERVER_ENV_FILE: custom }), expected);
  // A deliberately malformed default file must not even be parsed when disabled.
  f.write('RESEND_API_KEY="unfinished-synthetic-secret');
  assert.deepEqual(f.load({ FIZLAB_SERVER_ENV_FILE: '', AUTH_EMAIL_ENABLED: '0' }), { AUTH_EMAIL_ENABLED: '0' });
});

test('malformed private files fail closed with one generic error that never exposes input', t => {
  const f = fixture(t);
  const malformed = [
    'RESEND_API_KEY="unfinished-synthetic-secret',
    'AUTH_EMAIL_ENABLED=1\nthis-is-not-an-assignment-synthetic-secret\n',
    'RESEND_API_KEY="synthetic-secret"trailing-data\n',
    '=synthetic-secret\n',
    '1INVALID=synthetic-secret\n',
    'RESEND_API_KEY=synthetic\0secret\n',
    Buffer.from([0xff, 0xfe, 0xfd]),
  ];
  for (const content of malformed) {
    f.write(content);
    assert.throws(() => f.load({ AUTH_EMAIL_ENABLED: '0' }), error => {
      assert.equal(error.message, 'Unable to load private server configuration. Check .env.server.local or FIZLAB_SERVER_ENV_FILE.');
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('read failures are fatal and do not expose file paths or native filesystem errors', t => {
  const f = fixture(t);
  const directory = path.join(f.cwd, 'synthetic-secret-directory');
  mkdirSync(directory);
  assert.throws(() => f.load({ FIZLAB_SERVER_ENV_FILE: directory }), error => {
    assert.equal(error.message, 'Unable to load private server configuration. Check .env.server.local or FIZLAB_SERVER_ENV_FILE.');
    assert.equal(error.cause, undefined);
    return true;
  });
});
