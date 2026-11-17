import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.SMOKE_URL || 'http://127.0.0.1:4175';
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let passed=0;
async function scenario(name, run) {
  const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  try {await run(page,context); console.log('PASS',name);passed++;}
  finally {await context.close();}
}
try {
  await scenario('sticky navigation remains reachable after scrolling',async page=>{
    await page.goto(base+'/topic/kinematics');
    await page.getByRole('tab',{name:'Конспект',exact:true}).waitFor();
    await page.evaluate(()=>window.scrollTo({top:1200,behavior:'instant'}));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await page.getByRole('banner').boundingBox();
    assert.ok(box && box.y>=-1 && box.y<=1,`Header moved out of view: y=${box?.y}`);
  });
  await scenario('keyboard search, empty results, Escape, browser history',async page=>{
    await page.goto(base+'/login');
    const search=page.getByRole('combobox',{name:'Поиск по темам'});
    await search.fill('кинематика');
    await search.press('ArrowDown');
    await search.press('Enter');
    await page.waitForURL('**/topic/kinematics');
    await page.goBack();
    await page.waitForURL('**/login');
    await search.fill('несуществующая-тема-987');
    await page.getByText('Ничего не найдено').waitFor();
    await search.press('Escape');
    assert.equal(await search.getAttribute('aria-expanded'),'false');
  });
  await scenario('failed route chunk keeps header and recovery action',async page=>{
    await page.route('**/assets/LoginPage-*.js',route=>route.abort());
    await page.goto(base+'/login');
    await page.getByRole('button',{name:'Обновить страницу',exact:true}).waitFor();
    assert.equal(await page.getByRole('banner').count(),1);
    assert.equal(await page.getByText(/Failed to fetch dynamically imported/).count(),0);
  });
  await scenario('failed simulation chunk preserves notes and topic navigation',async page=>{
    await page.route('**/assets/sim-*.js',route=>route.abort());
    await page.goto(base+'/topic/kinematics');
    await page.getByRole('tab',{name:'3D-симуляция',exact:true}).click();
    await page.getByRole('button',{name:'Обновить страницу',exact:true}).waitFor();
    await page.getByRole('tab',{name:'Конспект',exact:true}).click();
    await page.getByRole('tabpanel').waitFor();
    assert.ok((await page.getByRole('tabpanel').innerText()).length>500);
  });
  await scenario('unsupported WebGL degrades locally and leaves course usable',async(page,context)=>{
    await context.addInitScript(()=>{
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};
    });
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/topic/kinematics');
    await page.getByRole('tab',{name:'3D-симуляция',exact:true}).click();
    await page.getByText('3D-сцена недоступна',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'Конспект',exact:true}).click();
    assert.ok((await page.getByRole('tabpanel').innerText()).length>500);
    assert.deepEqual(errors,[]);
  });
  await scenario('WebGL context loss shows local fallback',async page=>{
    await page.goto(base+'/topic/kinematics');
    await page.getByRole('tab',{name:'3D-симуляция',exact:true}).click();
    await page.locator('canvas').first().waitFor();
    await page.locator('canvas').first().evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost')));
    await page.getByText('3D-сцена недоступна',{exact:true}).waitFor();
    assert.equal(await page.getByRole('tab',{name:'Конспект',exact:true}).count(),1);
  });
  await scenario('quiz rejects numeric prefixes and accepts complete number',async page=>{
    await page.goto(base+'/topic/kinematics');
    await page.getByRole('tab',{name:/^Проверь себя/}).click();
    const answer=page.getByRole('textbox').filter({visible:true}).last();
    const input=page.locator('input[inputmode="decimal"]').first();
    assert.ok(await input.count() || await answer.count());
    for(const value of ['4garbage','4e','Infinity']) {
      await input.fill(value);
      await input.press('Enter');
      assert.equal(await page.getByText(/^Верно!/).count(),0);
    }
    await input.fill('4');
    await input.press('Enter');
    await page.getByText(/Верно/).first().waitFor();
    await page.reload();
    await page.getByRole('tab',{name:/^Проверь себя/}).click();
    await page.getByText(/Верно|Решено/).first().waitFor();
  });
  await scenario('malformed cached progress cannot crash homepage',async(page,context)=>{
    await context.addInitScript(()=>{
      localStorage.setItem('fizlab:solved-problems','null');
      localStorage.setItem('fizlab:completed-topics','{"broken":true}');
    });
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/');
    await page.getByRole('heading',{level:1}).waitFor();
    assert.deepEqual(errors,[]);
  });
} finally {await browser.close();}
console.log(`PASS ${passed} browser failure/recovery scenarios`);
