import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const base = process.env.SIM_TEST_URL || 'http://127.0.0.1:4175';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use an isolated local test server');
const device = crypto.randomUUID();
const password = 'Orbiting copper moons and quiet rivers 74';
const email = `sim-controls-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.com`;
const storage = new Map();
const filter = process.env.SIM_TEST_FILTER ? new RegExp(process.env.SIM_TEST_FILTER) : null;
const results = { base, startedAt: new Date().toISOString(), scenarios: [], pageErrors: [], accountDeleted: false };
let accessToken;
let browser;
async function api(path, data) {
  const response = await fetch(`${base}/api/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, 'x-fizlab-device-id': device, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(data),
  });
  const body = await response.json();
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${body.message ?? 'request failed'}`);
  return body;
}
try {
  const signup = await api('signup', { email, password, password_confirmation: password, data: { first_name: 'Simulation', last_name: 'Audit' } });
  accessToken = signup.access_token;
  const client = createClient(`${base}/api`, 'fizlab-public-client', {
    auth: { autoRefreshToken: false, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
    global: { headers: { 'x-fizlab-device-id': device } },
  });
  const session = await client.auth.setSession({ access_token: signup.access_token, refresh_token: signup.refresh_token });
  assert.equal(session.error, null);
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ device, entries }) => {
    localStorage.setItem('fizlab:device-id', device);
    for (const [key, value] of entries) localStorage.setItem(key, value);
  }, { device, entries: [...storage] });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => results.pageErrors.push(error.message));
  const field = (folder, key) => page.locator(`[id=${JSON.stringify(`${folder}.${key}`)}]`);
  const readouts = () => page.locator('.font-mono.text-lg');
  async function readout(label) {
    return page.getByText(label, { exact: true }).locator('..').locator('.font-mono').innerText();
  }
  async function waitNumeric(label, predicate) {
    let value;
    for (let attempt = 0; attempt < 60; attempt++) {
      value = Number.parseFloat(await readout(label));
      if (predicate(value)) return value;
      await page.waitForTimeout(200);
    }
    assert.fail(`${label}: awaited a fresh valid simulation sample, last value ${value}`);
  }
  async function waitText(label, expected) {
    let value;
    for (let attempt = 0; attempt < 60; attempt++) {
      value = await readout(label);
      if (value === expected) return;
      await page.waitForTimeout(200);
    }
    assert.equal(value, expected, `${label}: awaited a fresh simulation sample`);
  }
  async function healthy() {
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    const values = await readouts().allInnerTexts();
    assert.ok(values.length > 0, 'No live number readouts');
    assert.ok(!values.some(value => /\b(?:NaN|Infinity)\b/.test(value)), `Invalid readout: ${values.join(', ')}`);
    assert.deepEqual(results.pageErrors, [], 'Browser pageerror during controls test');
    assert.equal(await page.getByText('3D-сцена недоступна', { exact: true }).isVisible(), false, 'The WebGL fallback must not replace the live scene');
    return values;
  }
  async function open(slug) {
    await page.goto(`${base}/topic/${slug}`);
    await page.getByRole('tab', { name: '3D-симуляция', exact: true }).click();
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    await healthy();
  }
  async function number(folder, key, value) {
    const input = field(folder, key);
    await input.fill(String(value));
    await input.press('Enter');
    await input.blur();
    await page.waitForTimeout(550);
    const actual = Number((await input.inputValue()).replace(',', '.'));
    assert.ok(Math.abs(actual - value) < 0.001, `${folder}.${key}: requested ${value}, got ${actual}`);
    return healthy();
  }
  async function choose(folder, key, value) {
    const input = field(folder, key);
    const labels = { gases: 'Смешение двух цветных газов', '1s': '1s (сферическая)', '2s': '2s (с узлом)', '2p': '2p (гантель)' };
    await input.selectOption({ label: labels[value] ?? value });
    await page.waitForTimeout(600);
    return healthy();
  }
  async function scenario(name, work) {
    if (filter && !filter.test(name)) return;
    const row = { name, status: 'running', observations: [] };
    results.scenarios.push(row);
    try { await work(row.observations); row.status = 'passed'; console.log('PASS', name); }
    catch (error) { row.status = 'failed'; row.error = error.message; throw error; }
  }
  await scenario('entropy particle count and thermodynamic controls', async observations => {
    await open('entropy-second-law');
    const folder = 'Энтропия и II начало';
    await choose(folder, 'scenario', 'gases');
    for (const n of [40, 150, 40]) {
      await number(folder, 'N', n);
      observations.push({ N: n, values: await healthy() });
    }
    for (const value of [100, 600]) await number(folder, 'T', value);
    for (const value of [3, 6]) await number(folder, 'L', value);
  });
  await scenario('transport particle count and thermal controls', async observations => {
    await open('transport-phenomena');
    const folder = 'Явления переноса (диффузия)';
    for (const n of [30, 150, 30]) {
      await number(folder, 'nPer', n);
      observations.push({ nPer: n, values: await healthy() });
    }
    for (const value of [100, 600]) await number(folder, 'T', value);
    for (const value of [3, 6]) await number(folder, 'L', value);
  });
  await scenario('ideal gas particle count, temperature, and volume', async observations => {
    await open('ideal-gas-mkt');
    const folder = 'МКТ идеального газа';
    for (const n of [30, 150, 30]) await number(folder, 'N', n);
    for (const value of [50, 500]) {
      await number(folder, 'T', value);
      await waitNumeric('v_rms частиц', speed => Math.abs(speed - 0.15 * Math.sqrt(value)) < 0.02);
      observations.push({ T: value, values: await healthy() });
    }
    for (const value of [2.5, 5]) await number(folder, 'L', value);
    const speeds = observations.map(row => Number.parseFloat(row.values[1]));
    assert.ok(speeds[1] > speeds[0] * 2, `Higher initial temperature increases particle RMS speed: ${speeds}`);
    observations.push({ rmsSpeeds: speeds });
  });
  await scenario('Maxwell gas particle count, temperature, and volume', async observations => {
    await open('maxwell-boltzmann');
    const folder = 'Распределение Максвелла';
    for (const n of [100, 400, 100]) await number(folder, 'N', n);
    for (const value of [100, 600]) {
      await number(folder, 'T', value);
      await waitNumeric('⟨v⟩ измеренная', speed => speed > 0.7 * 0.15 * Math.sqrt(value) && speed < 1.1 * 0.15 * Math.sqrt(value));
      observations.push({ T: value, values: await healthy() });
    }
    for (const value of [3, 6]) await number(folder, 'L', value);
  });
  await scenario('real gas particle count, temperature, and volume', async observations => {
    await open('real-gases-vdw');
    const folder = 'Частицы (наглядность искл. объёма)';
    for (const n of [30, 100, 30]) await number(folder, 'N', n);
    for (const value of [100, 600]) {
      await number(folder, 'Tsim', value);
      const expectedPressure = 30 * 0.15 ** 2 * value / (2 * (3.6 - 0.22) ** 2);
      await waitNumeric('P идеальное (частицы)', pressure => Math.abs(pressure - expectedPressure) < 0.1);
      observations.push({ Tsim: value, values: await healthy() });
    }
    for (const value of [2.5, 5]) await number(folder, 'L', value);
  });
  await scenario('thin lens focal singularity', async observations => {
    await open('lenses');
    const folder = 'Тонкая линза';
    await number(folder, 'fVal', 0.6);
    await number(folder, 'd0Min', 0.6);
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    // Slow motion keeps the object close to the focal plane for readable sampling.
    await page.getByRole('button', { name: '0.1×', exact: true }).click();
    await page.waitForTimeout(600);
    observations.push({ values: await healthy() });
    await number(folder, 'fVal', -1);
    await waitText('Изображение', 'мнимое');
  });
  await scenario('neutral Lorentz particle', async observations => {
    await open('lorentz-force');
    await number('Сила Лоренца', 'qMicro', 0);
    assert.match(await readout('T = 2πm/(|q|B)'), /нет вращения/);
    assert.match(await readout('r = mv⊥/(|q|B)'), /∞/);
    assert.match(await readout('ω циклотронная'), /^0\.00/);
    observations.push({ values: await healthy() });
  });
  await scenario('exact undamped forced resonance', async observations => {
    await open('damped-forced-oscillations');
    const folder = 'Затухающие/вынужденные';
    const forced = field(folder, 'forced');
    await forced.focus();
    await forced.press('Space');
    assert.equal(await forced.isChecked(), true, 'Forced mode checkbox toggles using the keyboard');
    for (const [key, value] of [['m', 1], ['k', 36], ['b', 0], ['wDrive', 6]]) await number(folder, key, value);
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await page.waitForTimeout(750);
    const first = await waitNumeric('Амплитуда', value => value > 0);
    const second = await waitNumeric('Амплитуда', value => value > first + 0.05);
    assert.ok(second > first && first > 0, `Resonance envelope must grow: ${first}, ${second}`);
    assert.ok(Math.abs(Number.parseFloat(await readout('x(t)'))) > 0.0001, 'Resonance must move');
    observations.push({ firstEnvelope: first, secondEnvelope: second, values: await healthy() });
  });
  await scenario('hydrogen orbital regeneration and accepted point count', async observations => {
    await open('hydrogen-atom-quantum');
    const folder = 'Атом водорода: орбитали';
    for (const orbital of ['1s', '2s', '2p']) {
      await choose(folder, 'orbital', orbital);
      const count = Number(await readout('Точек облака'));
      assert.ok(Number.isInteger(count) && count > 0 && count <= 140, `Accepted point count: ${count}`);
      assert.equal(await readout('Главное квант. число n'), orbital === '1s' ? '1' : '2');
      observations.push({ orbital, acceptedPoints: count });
    }
  });
  if (process.env.SIM_TEST_EMBEDDED_PANEL === '1') {
    await scenario('mobile embedded parameter panel keyboard toggle', async observations => {
      await open('hydrogen-atom-quantum');
      await page.setViewportSize({ width: 390, height: 844 });
      const toggle = page.getByRole('button', { name: 'Параметры симуляции', exact: true });
      await toggle.waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Параметры симуляции', exact: true, expanded: false }).waitFor({ state: 'visible' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.focus();
      await toggle.press('Enter');
      await page.getByRole('button', { name: 'Параметры симуляции', exact: true, expanded: true }).waitFor({ state: 'visible' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await choose('Атом водорода: орбитали', 'orbital', '2p');
      const overlap = await page.evaluate(() => {
        const canvas = document.querySelector('canvas').getBoundingClientRect();
        const select = document.getElementById('Атом водорода: орбитали.orbital').getBoundingClientRect();
        return Math.max(0, Math.min(canvas.right, select.right) - Math.max(canvas.left, select.left)) * Math.max(0, Math.min(canvas.bottom, select.bottom) - Math.max(canvas.top, select.top));
      });
      assert.equal(overlap, 0, 'Parameter panel must not cover the canvas');
      await toggle.press('Space');
      await page.getByRole('button', { name: 'Параметры симуляции', exact: true, expanded: false }).waitFor({ state: 'visible' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      observations.push({ width: 390, keyboardToggle: true, overlap });
    });
  }
  assert.deepEqual(results.pageErrors, []);
} catch (error) {
  results.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (accessToken) {
    try { await api('delete', { password }); results.accountDeleted = true; }
    catch (error) { results.cleanupError = error.message; process.exitCode = 1; console.error('Synthetic account cleanup failed:', error.message); }
  }
  await browser?.close();
  results.finishedAt = new Date().toISOString();
  mkdirSync('audit.local', { recursive: true });
  writeFileSync(process.env.SIM_TEST_RESULT_PATH || 'audit.local/sim-controls-browser.json', JSON.stringify(results, null, 2));
}
