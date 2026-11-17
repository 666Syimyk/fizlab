import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.SMOKE_URL || 'http://127.0.0.1:4175';
const browser=await chromium.launch({headless:true,...(process.env.UI_CHANNEL ? {channel:process.env.UI_CHANNEL} : {})});
const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
const page=await context.newPage();
page.setDefaultTimeout(20000);
const report={channel:process.env.UI_CHANNEL||'chromium',layouts:[],issues:[],errors:[],warnings:[],violations:[]};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('console',message=>{if(message.type()==='warning')report.warnings.push(message.text());});
let registered=false;
const password='Cloudy mountains shine behind violet lakes 95';
const email=`long-${Date.now()}-${'a'.repeat(35)}@${'b'.repeat(60)}.${'c'.repeat(60)}.example.com`;
const progressRoute='**/api/rest/v1/progress*';
try {
  await page.goto(base+'/register');
  await page.getByPlaceholder('Имя',{exact:true}).fill('Ө'.repeat(100));
  await page.getByPlaceholder('Фамилия').fill('Ж'.repeat(100));
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(password);
  await page.getByPlaceholder('Повторите пароль').fill(password);
  await page.getByRole('button',{name:'Зарегистрироваться'}).click();
  await page.locator('code').waitFor();
  registered=true;
  await page.getByRole('button',{name:'Я сохранил код'}).click();
  await page.waitForURL(base+'/');
  await page.goto(base+'/account');
  await page.getByText(email,{exact:true}).waitFor();
  for(const [width,height] of [[320,844],[390,844],[844,390],[1024,600]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,
      clipped:[...document.querySelectorAll('main h1,main h2,main p')].filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({text:e.textContent.slice(0,60),width:e.clientWidth,contentWidth:e.scrollWidth})),
      inputSizes:[...document.querySelectorAll('input:not([type=file])')].map(e=>parseFloat(getComputedStyle(e).fontSize)),
      headerTargets:[...document.querySelectorAll('header button,header a')].filter(e=>e.getBoundingClientRect().width).map(e=>({name:e.getAttribute('aria-label')||e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}));
    report.layouts.push(layout);
    if(layout.clipped.length||layout.documentWidth>width+1)report.issues.push({width,clipped:layout.clipped,documentWidth:layout.documentWidth});
    assert.ok(layout.inputSizes.every(n=>n>=16),'Mobile input text must avoid automatic input zoom');
    assert.ok(layout.headerTargets.every(t=>t.width>=24&&t.height>=24),'Header touch targets below WCAG 24px minimum');
    const menu=page.getByRole('button',{name:'Разделы курса'});
    await menu.click();
    await page.getByRole('navigation',{name:'Разделы курса'}).getByRole('link').last().scrollIntoViewIfNeeded();
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'),'false');
    assert.ok(await menu.evaluate(e=>e===document.activeElement));
  }
  await page.setViewportSize({width:320,height:844});
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  report.violations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
  fs.mkdirSync('audit.local/account-touch',{recursive:true});
  await page.screenshot({path:`audit.local/account-touch/${report.channel}.png`});
  if(process.env.UI_SKIP_SYNC!=='1') {
    await page.route(progressRoute,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary test outage'})}));
    await page.goto(base+'/topic/kinematics');
    await page.getByRole('button',{name:'Отметить тему изученной'}).click();
    await page.goto(base+'/account');
    await page.getByRole('button',{name:'Повторить синхронизацию'}).waitFor();
    await page.unroute(progressRoute);
    await page.getByRole('button',{name:'Повторить синхронизацию'}).click();
    await page.getByText('Сохранено в аккаунте',{exact:true}).waitFor();
    report.syncRecovery='passed';
  }
} finally {
  await page.unroute(progressRoute);
  if(registered) {
    await page.goto(base+'/account');
    await page.getByPlaceholder('Введите пароль для подтверждения').fill(password);
    await page.getByRole('button',{name:'Удалить аккаунт и данные'}).click();
    await page.waitForURL(base+'/');
  }
  fs.mkdirSync('audit.local/account-touch',{recursive:true});
  fs.writeFileSync(`audit.local/account-touch/${report.channel}.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify(report,null,2));
assert.equal(report.issues.length,0,'Profile text must remain readable with maximum accepted name and long email');
assert.equal(report.errors.length,0);
assert.equal(report.violations.length,0);
console.log('PASS maximum-length profile, touch targets, landscape, menu focus and sync recovery');
