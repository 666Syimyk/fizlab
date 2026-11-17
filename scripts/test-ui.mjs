import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4175';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use an isolated local test server');
const engine = process.env.UI_BROWSER || 'chromium';
const quick = process.env.UI_QUICK === '1';
const [shardIndex, shardCount] = (process.env.UI_SHARD || '0/1').split('/').map(Number);
assert.ok(Number.isInteger(shardIndex) && Number.isInteger(shardCount) && shardIndex >= 0 && shardIndex < shardCount);
const widths = [320, 360, 375, 390, 412, 430, 768, 820, 1024, 1280, 1366, 1440, 1920];
const output = process.env.UI_OUTPUT || `audit.local/ui-${engine}`;
fs.mkdirSync(output, { recursive: true });
const report = { engine, shardIndex, shardCount, started: new Date().toISOString(), widths, screens: [], errors: [], failedRequests: [], violations: [], failures: [], accountCreated: false, accountDeleted: false };
const password = 'Stable violet planets rotate calmly 73';
const email = `ui-${engine}-${Date.now()}-${crypto.randomUUID().slice(0,8)}@example.com`;
let cleanupSession;
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true,
  ...(engine === 'chromium' ? { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
});
const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => report.errors.push({ type:'pageerror', url: page.url(), message: error.message }));
page.on('console', async message => {
  if (message.type() !== 'error') return;
  const entry = { type:'console', url:page.url(), message:message.text(), location:message.location() };
  report.errors.push(entry);
  entry.arguments = await Promise.all(message.args().map(argument => argument.evaluate(value => {
    if (value instanceof Error) return { name:value.name, message:value.message, stack:value.stack };
    try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
  }).catch(() => 'Console argument became unavailable')));
});
page.on('requestfailed', request => {
  if (!request.failure()?.errorText.includes('ABORTED')) report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
});

async function inspect(name, { axe = true, screenshots = false } = {}) {
  const screen = { name, layouts: [], buttons: [] };
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.evaluate(() => Promise.race([
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      new Promise(resolve => setTimeout(resolve,100)),
    ]));
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => {
        const box=canvas.getBoundingClientRect();
        return !box.width || Math.abs(box.width-canvas.parentElement.getBoundingClientRect().width)<3;
      }), null, {timeout:20000, polling:100});
    } catch (error) {
      const state = await page.evaluate(() => ({
        url: location.href, heading: document.querySelector('h1')?.textContent,
        canvases: [...document.querySelectorAll('canvas')].map(canvas => ({
          width: canvas.getBoundingClientRect().width, parentWidth: canvas.parentElement.getBoundingClientRect().width,
          visibility: getComputedStyle(canvas).visibility, html: canvas.outerHTML.slice(0,500),
        })),
      }));
      await page.screenshot({path:path.join(output,`canvas-timeout-${name.replaceAll(/[^a-z0-9-]/gi,'_')}-${width}.png`)});
      throw new Error(`${name} at ${width}px: ${error.message}; canvas state ${JSON.stringify(state)}`);
    }
    const layout = await page.evaluate(() => {
      const overflows = [];
      for (const element of document.querySelectorAll('h1,h2,h3,p,button,a,input,select,textarea,img,canvas,table')) {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height || element.closest('.katex-mathml,[aria-hidden="true"]')) continue;
        if (getComputedStyle(element).visibility === 'hidden') continue;
        if (box.left >= -1 && box.right <= innerWidth + 1) continue;
        let clipped = false;
        for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (['auto', 'scroll'].includes(style.overflowX) || ancestor.tagName === 'CANVAS') { clipped = true; break; }
        }
        if (!clipped) overflows.push({ tag: element.tagName, text: (element.textContent || element.getAttribute('aria-label') || '').slice(0,100), left: Math.round(box.left), right: Math.round(box.right) });
      }
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflows: overflows.slice(0,20) };
    });
    screen.layouts.push(layout);
    if (screenshots && [320,1440].includes(width)) await page.screenshot({ path: path.join(output, `${name.replaceAll(/[^a-z0-9-]/gi,'_')}-${width}.png`) });
    if (width === 320 && axe) {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      report.violations.push(...result.violations.map(v => ({ screen: name, id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n=>({target:n.target, summary:n.failureSummary})).slice(0,8) })));
    }
  }
  screen.buttons = await page.getByRole('button').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().width).map(e=>({name:e.getAttribute('aria-label')||e.textContent,disabled:e.disabled})));
  report.screens.push(screen);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report,null,2));
}

async function go(route) {
  await page.goto(base + route);
  await page.locator('h1').first().waitFor();
  await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,1500))]));
}

try {
  for (const route of shardIndex === 0 ? ['/', '/login', '/register', '/recover', '/privacy', '/missing-audit-route', '/account/delete'] : []) {
    await go(route);
    await inspect(route === '/' ? 'home' : route.slice(1), { screenshots: true });
  }
  await go('/login');
  const search = page.getByRole('combobox', { name:'Поиск по темам' });
  await search.fill('кинематика');
  await search.press('ArrowDown');
  await search.press('Enter');
  await page.waitForURL('**/topic/kinematics');
  await page.goBack();
  await page.waitForURL('**/login');
  await page.goForward();
  await page.waitForURL('**/topic/kinematics');
  await search.fill('неттакойтемы999');
  await page.getByText('Ничего не найдено').waitFor();
  await search.press('Escape');
  assert.equal(await search.getAttribute('aria-expanded'), 'false');
  await page.getByRole('button',{name:'Очистить поиск'}).click();
  await page.getByRole('button',{name:'Разделы курса'}).click();
  await page.getByRole('navigation').last().getByRole('link').first().waitFor();
  await page.keyboard.press('Escape');

  await go('/register');
  await page.getByPlaceholder('Имя',{exact:true}).fill('Аудит');
  await page.getByPlaceholder('Фамилия').fill('Өмүрбекова');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(password);
  await page.getByPlaceholder('Повторите пароль').fill(password);
  const [signup] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/v1/signup' && response.request().method() === 'POST'),
    page.getByRole('button',{name:'Зарегистрироваться'}).click(),
  ]);
  const signupData = await signup.json();
  assert.ok(signup.ok(), 'Synthetic account signup failed');
  assert.equal(signupData.user?.email, email);
  cleanupSession = { token: signupData.access_token, device: signup.request().headers()['x-fizlab-device-id'] };
  report.accountCreated = true;
  await page.locator('code').waitFor();
  if(shardIndex === 0) await inspect('recovery-card', { screenshots: true });
  await page.getByRole('button',{name:'Я сохранил код'}).click();
  await page.waitForURL(base + '/');
  await go('/account');
  if(shardIndex === 0) await inspect('account-empty', { screenshots: true });

  const sections = ['mechanics','thermodynamics','electromagnetism','optics','quantum-physics','nuclear-physics'];
  for (const section of shardIndex === 0 ? sections : []) {
    await go(`/section/${section}`);
    await inspect(`section-${section}`, { screenshots: true });
  }
  const catalogSlugs=fs.readdirSync('src/topics', {withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  const requestedSlugs=(process.env.UI_TOPICS || '').split(',').map(slug=>slug.trim()).filter(Boolean);
  assert.ok(requestedSlugs.every(slug=>catalogSlugs.includes(slug)),'UI_TOPICS must contain existing topic slugs');
  const slugs = requestedSlugs.length ? requestedSlugs : quick ? ['kinematics','isoprocesses','lorentz-force','lenses','photoelectric-effect','radioactivity'] : catalogSlugs;
  for (const slug of slugs.filter((_,index)=>index % shardCount === shardIndex)) {
    try {
      await go(`/topic/${slug}`);
      await page.getByRole('tab', {name:'Конспект', exact:true}).waitFor();
      for (const tab of ['Конспект','Примеры','Проверь себя','История','3D-симуляция']) {
        await page.getByRole('tab',{name:tab === 'Проверь себя' ? /^Проверь себя/ : tab,exact:tab !== 'Проверь себя'}).click();
        if (tab === '3D-симуляция') {
          await page.locator('canvas').first().waitFor({state:'visible', timeout:40000});
          const pause = page.getByRole('button',{name:'Пауза',exact:true});
          if (await pause.count()) await pause.click();
          for (const speed of await page.getByRole('button',{name:/^\d+(?:\.\d+)?×$/}).all()) {
            await speed.click();
            assert.equal(await speed.getAttribute('aria-pressed'),'true');
          }
          await page.getByRole('button',{name:'Сбросить',exact:true}).click();
          const play = page.getByRole('button',{name:'Пуск',exact:true});
          if (await play.count()) await play.click();
          if (await pause.count()) await pause.click();
        }
        await inspect(`${slug}-${tab === '3D-симуляция' ? 'sim' : ['Конспект','Примеры','Проверь себя','История'].indexOf(tab)}`, { screenshots: tab === '3D-симуляция' || tab === 'Конспект' });
      }
      console.log('AUDITED', engine, slug);
    } catch (error) { report.failures.push({slug,message:error.message}); console.log('FAILED',engine,slug,error.message.slice(0,180)); }
  }
  await go('/account');
  await page.getByPlaceholder('Введите пароль для подтверждения').fill(password);
  await page.getByRole('button',{name:'Удалить аккаунт и данные'}).click();
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button',{name:/Удалить/}).click();
  await page.waitForURL(base + '/');
  report.accountDeleted = true;
} catch(error) {
  report.failures.push({ stage:'main', message:error.stack });
} finally {
  if (cleanupSession && !report.accountDeleted) {
    try {
      const response = await fetch(`${base}/api/auth/v1/delete`, {
        method:'POST', headers:{'Content-Type':'application/json', Origin:base, Authorization:`Bearer ${cleanupSession.token}`, 'x-fizlab-device-id':cleanupSession.device},
        body:JSON.stringify({password}),
      });
      assert.ok(response.ok, `Synthetic account cleanup returned HTTP ${response.status}`);
      report.accountDeleted = true;
    } catch(error) { report.failures.push({stage:'synthetic-account-cleanup',message:error.message}); }
  }
  report.finished = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report,null,2));
  await browser.close();
}
const overflows=report.screens.flatMap(s=>s.layouts.filter(l=>l.overflows.length).map(l=>({screen:s.name,width:l.width,issues:l.overflows.length})));
console.log(JSON.stringify({engine,screens:report.screens.length,layouts:report.screens.reduce((n,s)=>n+s.layouts.length,0),violations:report.violations.length,errors:report.errors.length,failedRequests:report.failedRequests.length,overflows,failures:report.failures},null,2));
if(report.failures.length||report.errors.length||report.violations.length||overflows.length) process.exitCode=1;
