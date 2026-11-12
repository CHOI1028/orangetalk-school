// Isolated Electron profile, synthetic records and API responses only.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'_preview/infectious-ui');
fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.setPath('sessionData',path.join(out,'session'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
let win,checks=0,externalRequests=0;
const errors=[];const timer=setTimeout(()=>finish(Error('Fixture timed out')),45000);
function finish(error){clearTimeout(timer);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,externalRequests,errors,error:error?.stack},null,2));if(error)console.error(error);app.exit(error?1:0);}
const js=code=>win.webContents.executeJavaScript(code,true);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(code){for(let i=0;i<150;i++){if(await js(code))return;await delay(20);}throw Error('Missing state: '+code);}
async function check(code){assert(await js(code),code);checks++;}
async function shot(name){
  // Hidden native windows can keep a previous compositor frame after a DOM update.
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await delay(1100);
  fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());
}
const moduleUrl=f=>pathToFileURL(path.join(root,'src/renderer/core',f)).href;
// Exercise the actual form builder, binder and field-change handler without a database.
const acorn=require('acorn');
const source=fs.readFileSync(path.join(root,'src/renderer/features/emergency/emergency-view.js'),'utf8');
const nodes=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n);
const formCode=['infDP','infBuildFormHtml','openInfForm','_attachInfFormListeners','infFieldChange'].map(name=>{
  const n=nodes.find(n=>n?.id?.name===name);assert(n,name);return source.slice(n.start,n.end);
}).join('\n');
const appStyles=['health-diary','daily-period','sibling-ui','school-workspace','school-classic-remodel','sound-settings'].map(name=>'<link rel="stylesheet" href="'+pathToFileURL(path.join(root,'src/renderer/styles',name+'.css')).href+'">').join('');
const html=`<!doctype html><meta charset="utf-8">${appStyles}
<style>body{background:var(--bg);font-family:var(--f)}#infFormBody{background:white;width:850px;padding:24px;max-height:85vh;overflow:auto}.fixture-label{padding:15px;color:#667085;font-size:12px}</style>
<body class="light school-interface school-classic is-windows"><div class="fixture-label">오렌지톡 · 감염병 기능 검증 (가상 자료)</div><button id="opener">감염병 상세</button><div id="infFormOverlay" class="ec-form-overlay"><div id="infFormBody"></div></div>
<script type="module">
import {showInfectiousModal} from '${moduleUrl('infectious-disease.js')}';
import {bindInfectiousRecordAssist} from '${moduleUrl('infectious-record-assist.js')}';
import {escHtml} from '${moduleUrl('format-utils.js')}';
localStorage.clear();
window.requests=[];window.mode='normal';window.saved=0;window.externalLinks=[];
window.electronAPI={openExternal:url=>externalLinks.push(url),externalFetchJson:async url=>{
  requests.push(url);if(mode==='pending')await new Promise(resolve=>window.release=resolve);
  const u=new URL(url),base={icdGroupNm:'2급',sidoCd:u.searchParams.get('searchSidoCd')||'01',sidoNm:'서울',year:'2026'};
  const pt=u.searchParams.get('searchPeriodType');
  const periodRows=pt==='3'?Array.from({length:125},(_,i)=>({...base,icdNm:'수두',year:String(2024+Math.floor(i/52)),period:(i%52+1)+'주',resultVal:String(125-i)})):
    pt==='1'?[2024,2025,2026].map((y,i)=>({...base,icdNm:'수두',year:String(y),period:'',resultVal:String(20+i)})):
    [...[14,22,18,35,48,26,17,21,33,46,54,31].map((n,i)=>({...base,icdNm:'수두',period:'2026년 '+String(i+1).padStart(2,'0')+'월',resultVal:String(n)})),{...base,icdNm:'홍역',period:'2026년 01월',resultVal:'0'},{...base,icdNm:'백일해',period:'2026년 01월',resultVal:'-'},{...base,icdNm:'백일해',period:'2026년 02월',resultVal:'4'}];
  const rows=u.pathname.endsWith('/PeriodBasic')?periodRows:
    u.pathname.endsWith('/Age')?[{...base,icdNm:'수두',ageRange:'계',resultVal:'999'},...[6,28,12,5,8,4,1,0].map((n,i)=>({...base,icdNm:'수두',ageRange:i===7?'70세 이상':i*10+'~'+(i*10+9)+'세',resultVal:String(n)})),{...base,icdNm:'백일해',ageRange:'0~9세',resultVal:'-'},{...base,icdNm:'백일해',ageRange:'10~19세',resultVal:'4'},{...base,icdNm:'홍역',ageRange:'0~9세',resultVal:'0'}]:
    [{...base,icdNm:'수두',resultVal:'1,234'},{...base,icdNm:'성홍열',resultVal:'480'},{...base,icdNm:'유행성이하선염',resultVal:'230'},{...base,icdNm:'홍역',resultVal:'0'},{...base,icdNm:'백일해',resultVal:'-'},{...base,icdNm:'@니파바이러스감염증',resultVal:'0'}];
  return {success:true,data:{body:{items:{item:rows},totalCount:rows.length},header:{resultCode:'00'}}};
}};
const S={infRecords:[]};let infCurrentId=null;const _clinicalOpenRecords={};
const getStu=()=>({name:'테스트 학생',grade:3,cls:2,num:1,gender:'여'}),isKinder=()=>false;
const infDebounceSave=()=>{window.saved++;},closeInfForm=()=>document.getElementById('infFormOverlay').classList.remove('show');
${formCode}
window.record={id:1,studentId:'SYNTHETIC',diseaseName:'독감',hospital:'테스트 병원',diagDate:'2026-11-09',suspended:'예',suspendStart:'2026-11-09',expectedReturn:'2026-11-15',symptoms:{main:'기존 증상',fever:'예'},additionalMemo:'기존 메모',progress:[]};
S.infRecords=[window.record];window.original=JSON.stringify(window.record);window.openRecord=()=>openInfForm(1);window.replaceRecord=()=>{S.infRecords=[{...window.record}];};
window.showDetail=showInfectiousModal;window.closeRecord=closeInfForm;
document.getElementById('opener').onclick=()=>showInfectiousModal();window.ready=true;
</script>`;
fs.writeFileSync(path.join(out,'fixture.html'),html);
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/.test(details.url)){externalRequests++;callback({cancel:true});}else callback({});});
  win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadFile(path.join(out,'fixture.html'));await until('window.ready');
  await js("document.getElementById('opener').focus();showDetail()");
  await check("!!document.getElementById('ifOfflineGuide') && requests.length===0");
  await js("document.getElementById('ifOfflineGuide').click()");
  await check("document.querySelectorAll('#ifGuideResults button').length===133 && Array.from(document.querySelectorAll('#ifGuideResults button')).every(b=>b.scrollHeight<=b.clientHeight+1 && b.querySelector('span').getBoundingClientRect().bottom<=b.getBoundingClientRect().bottom)");
  await shot('guide-list');
  await js("const list=document.getElementById('ifGuideResults');list.scrollTop=list.scrollHeight;list.lastElementChild.click()");
  await check("document.getElementById('ifGuideDetail').textContent.includes(document.querySelector('#ifGuideResults button:last-child strong').textContent)");
  await js("document.getElementById('ifGuideQuery').value='B01.9';document.getElementById('ifGuideQuery').dispatchEvent(new Event('input'))");
  await check("document.getElementById('ifGuideDetail').textContent.includes('최소 5일') && !document.getElementById('ifApplyDisease') && requests.length===0");
  await shot('disease-guide');
  await js("document.querySelector('#ifGuideDetail a').click()");
  await check("externalLinks.length===1 && externalLinks[0].includes('kdca.go.kr')");
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await check("!document.getElementById('infectOverlay') && document.activeElement.id==='opener'");
  await js('openRecord()');
  await check("document.getElementById('infFormOverlay').classList.contains('show') && document.querySelector('[data-inf-disease-search]').getBoundingClientRect().width>0");
  await shot('record-form');
  await js("document.querySelector('[data-inf-disease-search]').click()");
  await check("document.getElementById('ifApplyDisease').disabled && JSON.stringify(record)===JSON.stringify({...JSON.parse(original),_clinicalEditing:true}) && saved===0");
  await js("document.querySelector('.if-apply').scrollIntoView({block:'end'})");await shot('record-preview');
  await js("document.getElementById('ifAllowReplace').click();document.getElementById('ifApplyDisease').click()");
  await check("record.diseaseName==='인플루엔자' && saved===1 && record.expectedReturn==='2026-11-15' && record.additionalMemo==='기존 메모' && record.symptoms.main==='기존 증상'");
  await check("Object.keys(record).every(k=>k==='diseaseName'||k==='_clinicalEditing'||JSON.stringify(record[k])===JSON.stringify(JSON.parse(original)[k]))");
  await js("document.getElementById('infectClose').click();document.querySelector('[data-inf-disease-search]').click();const q=document.getElementById('ifGuideQuery');q.value='수두';q.dispatchEvent(new Event('input'));document.getElementById('ifAllowReplace').click();document.querySelector('[data-field=diseaseName]').value='새 입력';document.querySelector('[data-field=diseaseName]').dispatchEvent(new Event('input'));document.getElementById('ifApplyDisease').click()");
  await check("record.diseaseName==='새 입력' && document.getElementById('ifApplyStatus').textContent.includes('변경되었습니다')");
  await js("document.getElementById('infectClose').click();document.querySelector('[data-inf-disease-search]').click();document.getElementById('ifGuideQuery').value='수두';document.getElementById('ifGuideQuery').dispatchEvent(new Event('input'));document.getElementById('ifAllowReplace').click();replaceRecord();document.getElementById('ifApplyDisease').click()");
  await check("document.getElementById('ifApplyStatus').textContent.includes('다른 기록') && record.diseaseName==='새 입력'");
  await js("document.getElementById('infectClose').click();openRecord();document.querySelector('[data-field=diseaseName]').value='';document.querySelector('[data-field=diseaseName]').dispatchEvent(new Event('input'));document.querySelector('[data-inf-disease-search]').click();document.getElementById('ifGuideQuery').value='B01.9';document.getElementById('ifGuideQuery').dispatchEvent(new Event('input'))");
  await check("!document.getElementById('ifApplyDisease').disabled && !document.getElementById('ifAllowReplace')");
  await js("document.getElementById('ifApplyDisease').click()");
  await check("document.querySelector('[data-field=diseaseName]').value==='수두' && document.getElementById('ifApplyStatus').textContent.includes('적용했습니다')");
  await js("document.getElementById('infectClose').click();document.querySelector('[data-inf-disease-search]').click();closeRecord();document.getElementById('ifApplyDisease').click()");
  await check("document.getElementById('ifApplyStatus').textContent.includes('기록지')");
  await js("document.getElementById('infectClose').click();closeRecord();localStorage.setItem('ec_public_data_api_key','SYNTHETIC');showDetail()");
  await until("!!document.getElementById('ifStatQuery')");
  await check("document.getElementById('ifStatResults').textContent.includes('1,234') && document.getElementById('ifStatResults').textContent.includes('자료 없음') && document.getElementById('ifStatResults').textContent.includes('0')");
  await shot('regional-statistics');
  await check("document.querySelectorAll('.if-region-bars .if-bar-row').length===6 && document.querySelector('.if-region-bars .is-peak').textContent.includes('수두') && document.querySelector('.if-region-bars .if-bar-row:last-child').textContent.includes('자료 없음')");
  await js("document.getElementById('ifStatQuery').value='B01.9';document.getElementById('ifStatQuery').dispatchEvent(new Event('input'))");
  await check("document.querySelectorAll('.if-region-bars .if-bar-row').length===1 && document.querySelector('.if-region-bars').textContent.includes('수두')");
  await js("document.getElementById('ifStatQuery').value='';document.getElementById('ifStatQuery').dispatchEvent(new Event('input'))");
  await js("Array.from(document.querySelectorAll('[data-region-guide]')).find(b=>b.textContent.includes('니파')).click()");
  await check("document.getElementById('ifGuideQuery').value==='니파바이러스감염증' && document.getElementById('ifGuideDetail').textContent.includes('니파바이러스감염증')");
  await shot('nipah-guide');
  await js("document.getElementById('ifGuideQuery').value='@니파바이러스감염증';document.getElementById('ifGuideQuery').dispatchEvent(new Event('input'))");
  await check("document.getElementById('ifGuideCount').textContent.includes('1개')");
  await js("document.querySelector('[data-itab=period]').click()");await until("!!document.getElementById('ifPeriodDisease')");
  await check("document.getElementById('ifPeriodDisease').value==='수두' && document.querySelectorAll('.if-period-bars .if-bar-row').length===12 && document.querySelector('.if-metrics').textContent.includes('365') && document.querySelector('.if-period-bars .is-peak').textContent.includes('2026년 11월')");
  await check("document.querySelector('.if-period-bars').scrollHeight<=document.querySelector('.if-period-bars').clientHeight+1");
  await shot('period-trend');
  await js("document.getElementById('ifPeriodDisease').value='홍역';document.getElementById('ifPeriodDisease').dispatchEvent(new Event('change'))");
  await check("document.getElementById('ifPeriodChart').textContent.includes('조회된 모든 기간 0명') && !document.querySelector('.if-period-bars .is-peak')");
  await js("document.getElementById('ifPeriodDisease').value='백일해';document.getElementById('ifPeriodDisease').dispatchEvent(new Event('change'))");
  await check("document.getElementById('ifPeriodChart').textContent.includes('합계 일부') && document.querySelector('.if-period-bars').textContent.includes('자료 없음')");
  await js("document.getElementById('ifPeriodQuery').value='notfound';document.getElementById('ifPeriodQuery').dispatchEvent(new Event('input'))");
  await check("document.getElementById('ifPeriodDisease').disabled && document.getElementById('ifPeriodChart').textContent.includes('없습니다')");
  await js("document.getElementById('ifPeriodQuery').value='@수두';document.getElementById('ifPeriodQuery').dispatchEvent(new Event('input'));document.getElementById('ifPt').value='3';document.getElementById('ifSy').value='2024';document.getElementById('ifGo').click()");
  await until("document.querySelectorAll('.if-period-bars .if-bar-row').length===125");
  await check("document.querySelector('.if-period-bars .if-bar-row:first-child').textContent.includes('2024년 01주') && document.querySelector('.if-period-bars .if-bar-row:last-child').textContent.includes('2026년 21주')");
  await js("document.getElementById('ifPt').value='1';document.getElementById('ifGo').click()");
  await until("document.querySelectorAll('.if-period-bars .if-bar-row').length===3");
  await check("document.querySelector('.if-period-bars .if-bar-row:first-child').textContent.includes('2024년')");
  await js("document.getElementById('ifPeriodGuide').click()");
  await check("document.getElementById('ifGuideDetail').textContent.includes('수두')");
  await js("document.querySelector('[data-itab=period]').click()");await until("!!document.getElementById('ifPeriodQuery')");
  await check("document.getElementById('ifPeriodQuery').value==='@수두' && document.getElementById('ifPt').value==='1' && document.getElementById('ifSy').value==='2024'");
  win.setSize(480,850);await delay(60);
  await check("document.getElementById('infectBody').scrollWidth<=document.getElementById('infectBody').clientWidth");await shot('narrow-period');
  win.setSize(1200,1000);await delay(60);
  await js("document.querySelector('[data-itab=age]').click()");await until("!!document.getElementById('ifAgeDisease')");
  await check("document.getElementById('ifAgeDisease').value==='수두' && document.querySelectorAll('.if-bar-row').length===8 && document.querySelector('.if-metrics').textContent.includes('64') && !document.getElementById('ifAgeChart').textContent.includes('999')");
  await check("document.querySelector('[data-itab=age]').getAttribute('aria-pressed')==='true' && document.querySelector('[data-itab=guide]').getAttribute('aria-pressed')==='false'");
  await check("document.querySelector('.if-bar-row.is-peak').textContent.includes('10~19세') && document.querySelector('.if-bar-row.is-peak').textContent.includes('28명')");
  await shot('age-distribution');
  await js("document.getElementById('ifAgeDisease').value='백일해';document.getElementById('ifAgeDisease').dispatchEvent(new Event('change'))");
  await check("document.getElementById('ifAgeChart').textContent.includes('자료 없음') && !document.querySelector('.if-bars').textContent.includes('%')");
  await js("document.getElementById('ifAgeDisease').value='홍역';document.getElementById('ifAgeDisease').dispatchEvent(new Event('change'))");
  await check("document.getElementById('ifAgeChart').textContent.includes('모든 연령 구간 0명') && !document.querySelector('.if-bar-row.is-peak')");
  await js("document.getElementById('ifAgeQuery').value='notfound';document.getElementById('ifAgeQuery').dispatchEvent(new Event('input'))");
  await check("document.getElementById('ifAgeDisease').disabled && document.getElementById('ifAgeChart').textContent.includes('없습니다')");
  await js("document.getElementById('ifAgeQuery').value='@수두';document.getElementById('ifAgeQuery').dispatchEvent(new Event('input'))");
  await check("document.getElementById('ifAgeDisease').value==='수두'");
  win.setSize(480,850);await delay(60);
  await check("document.getElementById('infectBody').scrollWidth<=document.getElementById('infectBody').clientWidth");await shot('narrow-age');
  win.setSize(1200,1000);await delay(60);
  await js("document.getElementById('ifAgeGuide').click()");
  await check("document.getElementById('ifGuideDetail').textContent.includes('수두')");
  await js("document.querySelector('[data-itab=region]').click()");await until("!!document.getElementById('ifStatQuery')");
  await js("mode='pending';document.getElementById('ifGo').click();document.querySelector('[data-itab=guide]').click();release()");await delay(60);
  await check("!!document.getElementById('ifGuideQuery') && !document.getElementById('ifStatQuery')");
  win.setSize(480,850);await delay(80);
  await check("document.getElementById('infectBox').scrollWidth<=document.getElementById('infectBox').clientWidth && document.getElementById('infectBody').scrollWidth<=document.getElementById('infectBody').clientWidth");
  await shot('narrow-guide');
  await js("document.getElementById('ifGuideQuery').value='';document.getElementById('ifGuideQuery').dispatchEvent(new Event('input'))");
  await check("Array.from(document.querySelectorAll('#ifGuideResults button')).every(b=>b.scrollHeight<=b.clientHeight+1) && document.getElementById('infectBody').scrollWidth<=document.getElementById('infectBody').clientWidth");
  win.setSize(1200,1000);await delay(60);
  await js("document.body.classList.remove('light');mode='normal'");
  for(const tab of ['region','period','age','guide']){
    await js(`document.querySelector('[data-itab=${tab}]').click()`);
    await until(tab==='region'?"!!document.getElementById('ifStatResults')":tab==='period'?"!!document.getElementById('ifPeriodDisease')":tab==='age'?"!!document.getElementById('ifAgeDisease')":"!!document.getElementById('ifGuideQuery')");
    if(tab==='guide')await js("document.getElementById('ifGuideQuery').value='수두';document.getElementById('ifGuideQuery').dispatchEvent(new Event('input'))");
    await check("document.getElementById('infectBody').scrollWidth<=document.getElementById('infectBody').clientWidth");
    if(tab==='age'||tab==='period')await check("document.querySelector('.if-chart-heading').getBoundingClientRect().top-document.querySelector('.if-age-picker').getBoundingClientRect().bottom<20");
    await check(`(()=>{
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
      const lum=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
      const box=getComputedStyle(document.getElementById('infectBox'));
      const text=[...document.querySelectorAll('#infectBox .if-muted,#infectBox .if-code,#infectBox a,#infectBox .if-bar-value,#infectBox .if-guidance,#infectBox .if-checklist,#infectBox .if-metrics span,#infectBox .if-primary')];
      return text.every(el=>contrast(getComputedStyle(el).color,(()=>{let p=el;while(p&&p.id!=='infectOverlay'){const bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')return bg;p=p.parentElement}return box.backgroundColor})())>=4.5)&&[...document.querySelectorAll('.if-bar-track i')].every(el=>contrast(getComputedStyle(el).backgroundColor,getComputedStyle(el.parentElement).backgroundColor)>=3);
    })()`);
    await shot('dark-'+tab);
  }
  win.setSize(480,850);await delay(60);
  await check("document.getElementById('infectBody').scrollWidth<=document.getElementById('infectBody').clientWidth");await shot('dark-narrow-guide');
  assert.deepEqual(errors,[]);assert.equal(externalRequests,0);finish();
}).catch(finish);
