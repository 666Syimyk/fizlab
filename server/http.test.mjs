import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('local HTTP adapter isolates its database and ignores forged proxy IPs by default', { timeout: 20000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'fizlab-http-test-'));
  const database = path.join(temporary, 'test.sqlite');
  const child = spawn(process.execPath, ['scripts/serve-site.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
    env: { ...process.env, PORT: '0', FIZLAB_DB_PATH: database, FIZLAB_TRUST_PROXY: '0', FIZLAB_SERVER_ENV_FILE: '', AUTH_EMAIL_ENABLED: '0', RESEND_API_KEY: '', REVENUECAT_SECRET_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('fizlab-http-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    let log = '';
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`test server exited (${code})`)));
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => { log += chunk; const match = log.match(/SITE (http:\/\/127\.0\.0\.1:\d+)/); if (match) resolve(match[1]); });
  });
  assert.notEqual(new URL(url).port, '4174', 'test server must not use the real local API');
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  const capabilities = await health.json();
  assert.equal(capabilities.email, false, 'isolated HTTP tests must never enable real email delivery');
  assert.equal(capabilities.billing, false, 'isolated HTTP tests must never enable real billing');
  const proxyHeaders = { 'x-forwarded-proto': 'https', Origin: url.replace('http:', 'https:') };
  assert.equal((await fetch(`${url}/api/health`, { headers: proxyHeaders })).status, 200, 'HTTPS reverse-proxy scheme must work without trusting its IP header');
  assert.equal((await fetch(`${url}/api/health`, { headers: { ...proxyHeaders, Origin: 'https://attacker.invalid' } })).status, 403);
  const device = crypto.randomUUID();
  const registration = await fetch(`${url}/api/auth/v1/signup`, {
    method: 'POST', headers: { ...proxyHeaders, 'Content-Type': 'application/json', 'x-fizlab-device-id': device },
    body: JSON.stringify({ email: 'proxy@example.com', password: 'Distinct green forests at sunrise 94', password_confirmation: 'Distinct green forests at sunrise 94', data: { first_name: 'Proxy', last_name: 'Learner' } }),
  });
  assert.equal(registration.status, 200, 'proxied HTTPS signup works while IP trust is disabled');
  let response;
  const statuses = [];
  for (let n = 0; n <= 40; n++) {
    response = await fetch(`${url}/api/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fizlab-device-id': device, 'cf-connecting-ip': `192.0.2.${n + 1}` },
      body: JSON.stringify({ email: 'missing@example.com', password: 'incorrect' }),
    });
    await response.arrayBuffer();
    statuses.push(response.status);
  }
  assert.ok(statuses.includes(429), 'forged IPs must not bypass the quota, even if the test crosses a minute boundary');
  assert.equal((await fetch(`${url}/api/auth/v1/signup`, { method: 'POST', body: 'x'.repeat(65537) })).status, 413);
  assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${url}/%E0%A4%A`)).status, 400);
});
