'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/features/daily/person-memo.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
let browser;
before(async()=>browser=await chromium.launch({headless:true}));after(async()=>browser?.close());
async function fixture(t,raw=[],staff=false){
 const ctx=await browser.newContext({offline:true});t.after(()=>ctx.close());const p=await ctx.newPage();
 await p.setContent('<body><table style="width:500px"><tr><td id="cell" style="width:200px"></td></tr></table></body>');
 await p.evaluate(({source,raw,staff})=>{
  window.findTopOpenModal=()=>document.querySelector('#childModal')||document.querySelector('#memoOverlay');
  window.S={memoData:{p:raw,other:[{text:'다른 사람'}]}};window.calls=[];window.fail=false;
  window.getStu=()=>({name:'가상 대상자',type:staff?'staff':'student'});
  window.escHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  Object.defineProperty(window,'localStorage',{value:{setItem(){}}});
  window.electronAPI={studentsUpdateMemo:async(id,json)=>{calls.push(['person',JSON.parse(json)]);return {success:!fail};},dbSet:async(a,b,v)=>{calls.push(['db',JSON.parse(JSON.stringify(v))]);return {success:!fail};}};
  (0,eval)(source+'\nwindow.qa={memoText,memoCellHtml,openPersonMemo,hasInlineMemoEditor};');
  document.getElementById('cell').innerHTML=qa.memoCellHtml('p',1);
  document.body.addEventListener('click',e=>{const b=e.target.closest('[data-action="toggleMemo"]');if(b)qa.openPersonMemo('p',b);});
 },{source,raw,staff});return p;
}
test('legacy slots combine in order without changing stored notes on open/close',async t=>{
 const raw=[{text:'첫 줄\n다음 줄',ts:'old'},null,'두 번째',{text:'세 번째'}];const p=await fixture(t,raw);
 await p.locator('[data-action]').click();assert.equal(await p.locator('textarea').inputValue(),'첫 줄\n다음 줄\n\n두 번째\n\n세 번째');
 await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();assert.deepEqual(await p.evaluate(()=>S.memoData.p),raw);assert.equal(await p.evaluate(()=>calls.length),0);
});
test('inline editing persists full text, preserves others, and reopens after closing',async t=>{
 const p=await fixture(t);await p.locator('[data-action]').click();assert.equal(await p.evaluate(()=>document.activeElement.tagName),'TEXTAREA');
 const text=('긴 주의사항 <script> & 검사\n').repeat(100)+'마지막 내용';await p.locator('textarea').fill(text);await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();
 assert.equal(await p.evaluate(()=>S.memoData.p[0].text),text);assert.equal(await p.evaluate(()=>S.memoData.other[0].text),'다른 사람');
 assert.equal(await p.locator('.person-memo-preview').textContent(),text);assert.equal(await p.locator('.person-memo-preview').evaluate(e=>getComputedStyle(e).webkitLineClamp),'3');
 await p.locator('[data-action]').click();assert.equal(await p.locator('textarea').inputValue(),text);
});
test('failure retains input and prevents closing, retry succeeds',async t=>{
 const p=await fixture(t,[{text:'기존'}]);await p.locator('[data-action]').click();await p.evaluate(()=>fail=true);await p.locator('textarea').fill('새 입력');await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();
 await p.getByRole('status').filter({hasText:'저장 실패'}).waitFor();assert.equal(await p.locator('textarea').inputValue(),'새 입력');assert.equal(await p.evaluate(()=>S.memoData.p[0].text),'기존');
 await p.evaluate(()=>fail=false);await p.getByRole('button',{name:'재시도'}).click();await p.locator('textarea').waitFor({state:'detached'});assert.equal(await p.evaluate(()=>S.memoData.p[0].text),'새 입력');
});
test('clearing notes persists empty slots',async t=>{const p=await fixture(t,'old');await p.locator('[data-action]').click();await p.locator('textarea').fill('');await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();assert.deepEqual(await p.evaluate(()=>S.memoData.p),[]);});
test('staff notes use shared store without student-only API',async t=>{const p=await fixture(t,[],true);await p.locator('[data-action]').click();await p.locator('textarea').fill('교직원 메모');await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();assert.deepEqual(await p.evaluate(()=>calls.map(x=>x[0])),['db']);});
test('table replacement retains editor in expanded dialog',async t=>{const p=await fixture(t);await p.locator('[data-action]').click();await p.locator('textarea').fill('입력 보존');await p.evaluate(()=>document.querySelector('table').remove());await p.locator('#memoOverlay textarea').waitFor();assert.equal(await p.locator('textarea').inputValue(),'입력 보존');});
test('expanded editor and Escape save full text',async t=>{const p=await fixture(t);await p.locator('[data-action]').click();await p.getByRole('button',{name:'넓게 보기'}).click();await p.locator('textarea').fill('확장 내용');await p.locator('textarea').press('Escape');await p.waitForFunction(()=>!document.getElementById('memoOverlay'));assert.equal(await p.evaluate(()=>S.memoData.p[0].text),'확장 내용');});
test('shared store failure after mirror success is not reported as saved',async t=>{
 const p=await fixture(t,[{text:'before'}]);await p.evaluate(()=>electronAPI.dbSet=async()=>({success:false}));await p.locator('[data-action]').click();await p.locator('textarea').fill('after');await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();await p.getByRole('status').filter({hasText:'저장 실패'}).waitFor();assert.equal(await p.locator('textarea').inputValue(),'after');assert.equal(await p.evaluate(()=>S.memoData.p[0].text),'before');
});
test('autosave and subsequent edit retain the latest value',async t=>{
 const p=await fixture(t);await p.locator('[data-action]').click();await p.locator('textarea').fill('첫 저장');await p.getByRole('status').filter({hasText:'저장됨'}).waitFor();await p.locator('textarea').fill('최종 저장');await p.getByRole('button',{name:'저장 후 닫기',exact:true}).click();assert.equal(await p.evaluate(()=>S.memoData.p[0].text),'최종 저장');
});
test('Escape from another modal is not stolen',async t=>{
 const p=await fixture(t);await p.locator('[data-action]').click();await p.evaluate(()=>{const m=document.createElement('div');m.id='childModal';m.tabIndex=0;document.body.append(m);m.focus();});await p.keyboard.press('Escape');assert.equal(await p.locator('textarea').count(),1);
});
test('narrow cell clips preview to three lines while expanded input keeps full text',async t=>{
 const text=Array.from({length:20},(_,i)=>'주의사항 '+(i+1)+' — 가상 검사 내용').join('\n');const p=await fixture(t,[{text}]);await p.setViewportSize({width:800,height:650});
 const sizes=await p.locator('.person-memo-preview').evaluate(e=>({height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight),text:e.textContent}));assert(sizes.height<=sizes.line*3+1);assert.equal(sizes.text,text);
 await p.locator('[data-action]').click();await p.getByRole('button',{name:'넓게 보기'}).click();assert.equal(await p.locator('textarea').inputValue(),text);
 if(process.env.MEMO_QA_SCREENSHOT)await p.screenshot({path:process.env.MEMO_QA_SCREENSHOT,fullPage:true});
});
