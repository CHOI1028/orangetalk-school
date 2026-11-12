'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, '_preview/school-ai'); fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'profile')); app.setPath('sessionData', path.join(out, 'session'));
app.disableHardwareAcceleration();
let win, checks = 0, externalRequests = 0; const errors = [];
const timer = setTimeout(() => finish(Error('UI fixture timed out')), 45000);
function finish(error) {
  clearTimeout(timer); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ checks, externalRequests, errors, error: error?.stack }, null, 2));
  if (error) console.error(error); app.exit(error ? 1 : 0);
}
const run = code => win.webContents.executeJavaScript(code, true);
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(code) { for (let n = 0; n < 100; n++) { if (await run('Boolean(' + code + ')')) return; await delay(25); } throw Error('Missing UI state: ' + code); }
async function check(code) { assert(await run(code), code); checks++; }
async function screenshot(name) { await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await delay(300); fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
async function drag(selector, dx, dy) {
  win.webContents.focus();
  const point = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+r.height/2)}})()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  await delay(30);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + dx, y: point.y + dy, modifiers: ['leftButtonDown'] });
  await delay(30);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + dx, y: point.y + dy, button: 'left', clickCount: 1 });
  await delay(50);
}
const url = file => pathToFileURL(path.join(root, file)).href;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>오렌지톡 AI 검증</title>
${['health-diary','daily-period','sibling-ui','school-workspace','school-classic-remodel','magic-responsive','sound-settings'].map(name => '<link rel="stylesheet" href="' + url('src/renderer/styles/' + name + '.css') + '">').join('')}
<style>body{margin:0;background:#f1f3f6;color:#273142;font-family:'Segoe UI',sans-serif;--card:#fff;--bg2:#f5f6f8;--bdr:#e3e7ed;--t1:#233044;--t3:#687486}header.mock{padding:22px 30px;background:white;border-bottom:1px solid #ddd}.header-row2{display:flex;align-items:center;gap:28px;font-size:13px}.header-row2 span{flex:1}main{padding:32px}h1{font-size:24px;margin-top:0}#settingsHost{width:420px;background:white;padding:20px;border-radius:15px}button{cursor:pointer}</style>
<body class="light school-interface school-classic is-windows"><header class="mock"><h1>🍊 오렌지톡 학교</h1><div class="header-row2">보건실 홈　 보건일지　 방문 통계　 매직 스테이션<span></span><button id="headerLockBtn">처음화면</button></div></header>
<main><h2>보건일지</h2><p>가상 자료로 AI 기능의 설정·대화·오류 처리를 검증합니다.</p><div id="settingsHost"></div></main>
<script>if(!sessionStorage.getItem('ai-fixture-started')){localStorage.removeItem('school-ai-position-v1');sessionStorage.setItem('ai-fixture-started','1')}window.settingsOpened=0;document.addEventListener('school-ai:open-settings',()=>window.settingsOpened++);window.requests=[];window.mode='ok';window.links=[];window.mockState={success:true,configured:false,encryptionAvailable:true,dailyLimit:1000000,used:0,actual:0,calls:0,day:'2026-11-11'};
window.electronAPI={openExternal:u=>links.push(u),schoolAiStatus:async()=>({...mockState}),schoolAiSave:async r=>{window.saved=r;mockState.configured=!!r.apiKey||mockState.configured;return {...mockState}},schoolAiRemove:async()=>{mockState.configured=false;return {...mockState}},schoolAiReset:async()=>({success:true}),schoolAiTest:async()=>{mockState.calls++;return {...mockState}},schoolAiChat:async r=>{requests.push(r);if(mode==='pending')await new Promise(resolve=>window.release=resolve);if(mode==='fail')return {success:false,code:'QUOTA',message:'사용량 한도에 도달했습니다.'};mockState.calls++;mockState.used+=850;mockState.actual+=850;return {success:true,answer:mode==='xss'?'<img src=x onerror="window.hacked=true">': '보건일지의 일반 일지에서 일지 출력 버튼을 눌러 주세요.\\n\\n출력할 기간과 내용을 선택하면 됩니다. 커스텀 양식 출력은 방문 확인증 등을 출력할 때 사용하세요.',sources:[{kind:'program',title:'보건일지와 출력'}],usage:{calls:1,tokens:850},status:{...mockState}}}};
</script><script type="module">import {openSchoolAi,schoolAiSettingsCard,bindSchoolAiSettings} from '${url('src/renderer/features/ai/school-ai.js')}';
window.openSchoolAi=openSchoolAi;document.getElementById('settingsHost').innerHTML=schoolAiSettingsCard();bindSchoolAiSettings(document.getElementById('settingsHost'));window.ready=true;</script></html>`;
fs.writeFileSync(path.join(out, 'fixture.html'), html);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { if (/^https?:/.test(details.url)) { externalRequests++; callback({ cancel: true }); } else callback({}); });
  win = new BrowserWindow({ show: false, width: 1280, height: 960, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_event, level, text) => { if (level >= 3) errors.push(text); });
  await win.loadFile(path.join(out, 'fixture.html')); await until('window.ready && document.querySelector(".school-ai-launcher")');
  await check('requests.length===0 && mockState.calls===0');
  await until('!document.querySelector("[data-ai-action=save]").disabled');
  await check('!document.querySelector(".header-row2 .school-ai-launcher") && !document.querySelector("#schoolAiPanel [data-ai-key]")');
  await check('(()=>{const r=document.querySelector(".school-ai-launcher").getBoundingClientRect();return Math.abs(innerWidth-r.right-22)<2&&Math.abs(innerHeight-r.bottom-22)<2})()');
  await drag('.school-ai-launcher', -200, -120);
  await check('document.getElementById("schoolAiPanel").hidden && JSON.parse(localStorage.getItem("school-ai-position-v1")).launcher.x < innerWidth-250');
  await run('openSchoolAi()');
  await check('document.querySelector(".school-ai-launcher").classList.contains("is-open") && getComputedStyle(document.querySelector(".school-ai-launcher")).visibility==="hidden"');
  const before = await run('document.getElementById("schoolAiPanel").getBoundingClientRect().left');
  await drag('.school-ai-header', -100, 50);
  await check(`Math.abs(document.getElementById('schoolAiPanel').getBoundingClientRect().left - (${before}-100)) < 2`);
  await check('JSON.parse(localStorage.getItem("school-ai-position-v1")).panel.x >= 8');
  await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="기본 위치").click()');
  await check('Object.keys(JSON.parse(localStorage.getItem("school-ai-position-v1"))).length===0');
  await run('document.querySelector(".school-ai-header-actions button").click()');
  await check('window.settingsOpened===1 && document.getElementById("schoolAiPanel").hidden');
  await check('document.querySelector("[data-ai-key]").type === "password"');
  await check('!document.querySelector("#settingsHost").textContent.includes("토큰")');
  await screenshot('settings');
  await run('document.querySelector("[data-ai-key]").value="SYNTHETIC_KEY";document.querySelector("[data-ai-key]").dispatchEvent(new Event("input"));document.querySelector("[data-ai-action=test]").click()');
  await check('mockState.calls === 0 && document.querySelector("[data-ai-settings-status]").textContent.includes("먼저 반영") && document.querySelector("[data-ai-key-state]").textContent === "반영 필요"');
  await run('document.querySelector("[data-ai-action=save]").click()');
  await until('mockState.configured && document.querySelector("[data-ai-key]").value === ""');
  await check('!JSON.stringify(localStorage).includes("SYNTHETIC_KEY")');
  await run('document.querySelector("[data-ai-action=test]").click()');
  await until('mockState.calls === 1 && !document.querySelector("[data-ai-action=test]").disabled');
  await check('document.querySelector("[data-ai-settings-status]").textContent === "Gemini 연결을 확인했습니다."');
  await check('Object.keys(window.saved).join() === "apiKey" && document.querySelector("[data-ai-key-state]").textContent === "✓ 반영 완료"');
  await check('!document.querySelector("[data-ai-limit], [data-ai-consent], [data-ai-usage], [data-ai-settings-usage], .school-ai-footnote")');
  await run('openSchoolAi();document.querySelector("[data-ai-input]").value="일지 출력 방법";document.querySelector("[data-ai-input]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}))');
  await screenshot('welcome');
  await run('document.querySelector(".school-ai-header-actions [aria-pressed]").click()');
  await check('document.querySelector("#schoolAiPanel").classList.contains("is-wide") && document.querySelector("#schoolAiPanel").getBoundingClientRect().width > 600');
  await run('document.querySelector(".school-ai-header-actions [aria-pressed]").click()');
  await check('requests.length===0');
  await run('document.querySelector("[data-ai-send]").click()');
  await until('document.querySelector(".school-ai-copy") && !document.querySelector("[data-ai-send]").disabled');
  await check('requests.length===1 && Object.keys(requests[0]).join() === "message"');
  await check('!document.querySelector("#schoolAiPanel").textContent.includes("토큰") && document.querySelector("[data-ai-status]").textContent === ""');
  await check('document.querySelector(".school-ai-sources").textContent.includes("보건일지와 출력")');
  await check('document.querySelector(".school-ai-references summary").textContent.includes("참고자료") && !document.querySelector(".school-ai-references").open');
  await screenshot('conversation');
  await run(`(async()=>{const m=await import(${JSON.stringify(url('src/renderer/features/ai/school-ai-rich-text.js'))});const target=document.createElement('div');m.renderAiText(target,'**강조**'+String.fromCharCode(10)+'1. 첫 단계'+String.fromCharCode(10)+'2. 둘째 단계'+String.fromCharCode(10)+'<img src=x onerror="window.hacked=true">');window.richCheck=target.querySelectorAll('strong').length===1&&target.querySelectorAll('li').length===2&&!target.querySelector('img');})()`);
  await check('window.richCheck===true');
  await run(`(async()=>{const m=await import(${JSON.stringify(url('src/renderer/features/ai/school-ai-search-view.js'))});const target=document.createElement('div');target.id='searchQa';target.style.display='none';document.body.append(target);m.appendSearchSuggestions(target,['<div><a href="https://www.google.com/search?q=test">Google 검색</a></div>'],u=>window.links.push(u));})()`);
  await until('document.querySelector("#searchQa iframe").contentDocument?.querySelector("a")');
  await check('document.querySelector("#searchQa iframe").getAttribute("sandbox")==="allow-same-origin"');
  await run('document.querySelector("#searchQa iframe").contentDocument.querySelector("a").click()');
  await check('window.links.includes("https://www.google.com/search?q=test")');
  await run('document.getElementById("searchQa").remove()');
  await run('window.mode="xss";document.querySelector("[data-ai-input]").value="보건일지 안내";document.querySelector("[data-ai-send]").click()');
  await until('requests.length===2 && !document.querySelector("[data-ai-send]").disabled');
  await check('!window.hacked && !document.querySelector(".school-ai-message img")');
  await run('window.mode="fail";document.querySelector("[data-ai-input]").value="보건교육 자료";document.querySelector("[data-ai-send]").click()');
  await until('document.querySelector("[data-ai-input]").value==="보건교육 자료" && !document.querySelector("[data-ai-send]").disabled');
  await check('document.querySelector("[data-ai-status]").classList.contains("is-error")');
  await check('document.querySelectorAll(".school-ai-message.is-user").length===3');
  await run('document.querySelector(".school-ai-retry").click()');
  await until('requests.length===4 && !document.querySelector("[data-ai-send]").disabled');
  await check('document.querySelectorAll(".school-ai-message.is-user").length===3 && document.querySelector("[data-ai-input]").value==="보건교육 자료"');
  await run('window.mode="pending";document.querySelector("[data-ai-input]").value="생각 중 표시";document.querySelector("[data-ai-send]").click()');
  await until('window.release && document.querySelectorAll(".school-ai-thinking i").length===3');
  await check('!document.querySelector(".is-pending").textContent.includes("준비") && !document.querySelector("[data-ai-stop]").hidden && document.querySelector("[data-ai-send]").hidden');
  await screenshot('thinking');
  await run('document.querySelector("[data-ai-stop]").click();window.release()');
  await until('!document.querySelector("[data-ai-send]").hidden');
  await check('!document.querySelector(".is-pending")');
  win.setSize(390, 844); await delay(100);
  await screenshot('narrow');
  await check('(()=>{const r=document.getElementById("schoolAiPanel").getBoundingClientRect();const b=document.querySelector("[data-ai-send]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&b.bottom<r.bottom})()');
  await run('document.getElementById("headerLockBtn").click()');
  await check('document.getElementById("schoolAiPanel").hidden && document.querySelectorAll(".school-ai-message").length===0');
  await run('document.querySelector("[data-ai-action=remove]").click()');
  await until('!mockState.configured');
  await check('document.querySelector("[data-ai-key]").value === "" && document.querySelector("[data-ai-key-state]").textContent.includes("등록")');
  await run('openSchoolAi();document.querySelector("[data-ai-input]").value="설문 만드는 방법";document.querySelector("[data-ai-send]").click()');
  await check('window.settingsOpened===2 && document.getElementById("schoolAiPanel").hidden');
  win.setSize(1280, 960); await delay(100);
  await drag('.school-ai-launcher', -180, -90);
  const stored = await run('JSON.parse(localStorage.getItem("school-ai-position-v1")).launcher');
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
  await until('window.ready && document.querySelector(".school-ai-launcher")'); await delay(100);
  await check(`Math.abs(document.querySelector('.school-ai-launcher').getBoundingClientRect().left-${stored.x})<2`);
  await check(`Math.abs(document.querySelector('.school-ai-launcher').getBoundingClientRect().top-${stored.y})<2`);
  await run(`(()=>{const s=document.createElement('div');s.id='splash';s.style.cssText='position:fixed;inset:0;display:flex';document.body.append(s);return true})()`);
  await until('document.querySelector(".school-ai-launcher").hidden===true && document.getElementById("schoolAiPanel").hidden');
  await check('getComputedStyle(document.querySelector(".school-ai-launcher")).display==="none"');
  await run('openSchoolAi()');
  await check('document.getElementById("schoolAiPanel").hidden');
  await run(`document.getElementById('splash').style.display='none'`);
  await until('document.querySelector(".school-ai-launcher").hidden===false');
  assert.equal(externalRequests, 0); assert.deepEqual(errors, []); finish();
}).catch(finish);
