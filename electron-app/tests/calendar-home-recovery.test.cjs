'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const files={cal:'src/renderer/features/daily/diary-print-view.js',home:'src/renderer/features/dashboard/home-dashboard.js',ui:'src/renderer/core/ui-utils.js'};
function pick(file,names){const s=fs.readFileSync(path.join(root,file),'utf8');const nodes=acorn.parse(s,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n);return [...new Set(names.map(name=>{const n=nodes.find(n=>n?.id?.name===name||n?.declarations?.some(d=>d.id.name===name));assert(n,name);return s.slice(n.start,n.end);}))].join('\n');}
let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:['--disable-background-networking']});});
after(async()=>{await browser?.close();});
async function page(t,body=''){
 const context=await browser.newContext({offline:true,serviceWorkers:'block'});await context.route('**/*',r=>r.abort());
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
 await p.setContent('<!doctype html><body>'+body+'</body>');return p;
}
const install=(p,code)=>p.evaluate(s=>(0,eval)(s),code);
const esc="function escHtml(s){return String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));}";
test('mouse navigation resets keyboard focus; keyboard crosses leap month and year correctly',async t=>{
 const p=await page(t,'<div id="cal" style="width:300px"></div>');
 await install(p,`const S={koreanHolidays:{}},ensureHolidayYear=()=>{};function toDateStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
 ${pick(files.cal,['_ccKnavWrap','_ccKnavParse','_ccKnavFmt','_ccKnavHighlight','_ccKnavKey','_commonCalRender'])}
 let y=2024,m=0,chosen;const wrap=document.getElementById('cal');
 function choose(ds){chosen=ds;}function nav(delta,month,year){if(year!==undefined)y=year;if(month!==undefined)m=month;else if(year===undefined){m+=delta;if(m<0){m=11;y--;}if(m>11){m=0;y++;}}_commonCalRender(wrap,y,m,choose,nav,{});}
 nav(0);window.qa={chosen:()=>chosen,nav};`);
 await p.locator('[data-cal-nav="next"]').click();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>qa.chosen()),'2024-02-01');
 await p.locator('[data-cal-select="2024-02-28"]').click();await p.keyboard.press('ArrowRight');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>qa.chosen()),'2024-02-29');
 await p.keyboard.press('ArrowRight');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>qa.chosen()),'2024-03-01');
 await p.keyboard.press('ArrowLeft');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>qa.chosen()),'2024-02-29');
 await p.evaluate(()=>qa.nav(0,11,2024));await p.locator('[data-cal-select="2024-12-31"]').click();await p.keyboard.press('ArrowRight');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>qa.chosen()),'2025-01-01');
});
for(const failures of [[true,true],[true,false],[false,true],[false,false]])test('event edit persistence DB/cache failure = '+failures,async t=>{
 const p=await page(t);
 await install(p,`${esc}
 let dbFail=${failures[0]},cacheFail=${failures[1]},toasts=0;const original={title:'ORIGINAL',time:'09:00',memo:'MEMO',color:'#22c55e'};
 let _localEvents={'2026-10-29':[{...original}]},_localEventsLoaded=true,_localEventsReadFailed=false,_localEventsStamp=0,_localEventsSaveQueue=Promise.resolve(),_localTodoImports={},_localTodoLegacyDate='';
 let dbTitle='ORIGINAL',cacheTitle='ORIGINAL';window.electronAPI={dbSet:async(s,k,v)=>{if(dbFail)return {success:false};dbTitle=v.ev['2026-10-29'][0].title;return {success:true};}};
 Object.defineProperty(window,'localStorage',{value:{setItem(k,v){if(cacheFail)throw Error('SYNTHETIC_QUOTA');cacheTitle=JSON.parse(v).ev['2026-10-29'][0].title;}}});
 const _requireHomeCalendar=async()=>true,_gcalEnabled=()=>false,_homeDsLabel=ds=>ds,_bindTimeInput=()=>{},_homeSaveToast=()=>toasts++,renderHomeDashboard=()=>{};
 ${pick(files.home,['_saveLocalEvents','_homeEditLocalEvent'])}
 window.qa={open:()=>_homeEditLocalEvent('2026-10-29',0,null),recover:()=>{dbFail=false;cacheFail=false;},state:()=>({dbTitle,cacheTitle,toasts,title:_localEvents['2026-10-29'][0].title,open:!!document.getElementById('localEditOverlay')})};`);
 await p.evaluate(()=>qa.open());await p.locator('#lceTitle').fill('EDITED');await p.locator('#lceTitle').press('Enter');
 if(failures.every(Boolean)){
  await p.waitForSelector('[data-local-save-error]');assert.equal(await p.locator('#lceTitle').inputValue(),'EDITED');
  assert.deepEqual(await p.evaluate(()=>qa.state()),{dbTitle:'ORIGINAL',cacheTitle:'ORIGINAL',toasts:0,title:'ORIGINAL',open:true});
  await p.evaluate(()=>document.getElementById('localEditOverlay')._onModalClose());assert.equal((await p.evaluate(()=>qa.state())).open,true);
  await p.evaluate(()=>qa.recover());await p.locator('#lceTitle').press('Enter');
 }
 await p.waitForFunction(()=>!qa.state().open);const state=await p.evaluate(()=>qa.state());assert.equal(state.toasts,1);assert.equal(state.title,'EDITED');assert(state.dbTitle==='EDITED'||state.cacheTitle==='EDITED');
});
test('Escape uses home day popup save gate without closing an underlying modal',async t=>{
 const p=await page(t,'<div id="underOverlay" style="position:fixed;inset:0;z-index:1000"></div>');
 const source=fs.readFileSync(path.join(root,'src/renderer/core/event-bindings.js'),'utf8').replace(/\r\n/g,'\n');const a=source.indexOf("  document.addEventListener('keydown', function(e){\n    if(e.key !== 'Escape') return;");assert(a>=0);const handler=source.slice(a,source.indexOf('  }, false);',a)+12);
 await install(p,`${esc}
 const _localEvents={},_homeCalEvents={},S={koreanHolidays:{}},_localRanges=[];
 const _requireHomeCalendar=async()=>true,_gcalEnabled=()=>false,_hcdListHtml=()=>'<p>가상 일정</p>',_bindTimeInput=()=>{};
 let fail=true,flushes=0,underClosed=0;const _homeDayDraftSave=async()=>{flushes++;return !fail;};
 ${pick(files.home,['_homeDayPopupRequest','_homeOpenDayPopup'])}
 ${pick(files.ui,['findTopOpenModal','closeModalGracefully'])}
 const findKeyboardModal=findTopOpenModal,closeKeyboardModal=closeModalGracefully;
 ${handler}
 document.getElementById('underOverlay')._onModalClose=()=>underClosed++;
 window.qa={open:()=>_homeOpenDayPopup('2026-10-29'),recover:()=>fail=false,state:()=>({open:!!document.getElementById('homeCalDayPopup'),top:findTopOpenModal()?.id,underClosed,flushes})};`);
 await p.evaluate(()=>qa.open());await p.locator('.school-calendar-day-dialog').focus();await p.keyboard.press('Escape');let state=await p.evaluate(()=>qa.state());assert.equal(state.open,true);assert.equal(state.underClosed,0);assert.equal(state.top,'homeCalDayPopup');assert.equal(state.flushes,1);
 await p.evaluate(()=>qa.recover());await p.keyboard.press('Escape');await p.waitForFunction(()=>!qa.state().open);state=await p.evaluate(()=>qa.state());assert.equal(state.underClosed,0);assert.equal(state.flushes,2);assert.equal(state.top,'underOverlay');
});
