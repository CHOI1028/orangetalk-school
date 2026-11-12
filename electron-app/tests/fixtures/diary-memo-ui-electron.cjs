// Actual list templates, styles and handlers; isolated profile and synthetic records.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const acorn=require('acorn');
const {source:rowSource}=require('../helpers/daily-row-harness.cjs');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'_preview/diary-memo-ui');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function pick(file,names){
  const source=read(file),nodes=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n);
  return names.map(name=>{const n=nodes.find(n=>n?.id?.name===name||n?.declarations?.some(d=>d.id.name===name));assert(n,name);return source.slice(n.start,n.end);}).join('\n');
}
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.setPath('sessionData',path.join(out,'session'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
let win,checks=0;const errors=[];
const js=code=>win.webContents.executeJavaScript(code,true);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function check(code){assert(await js(code),code);checks++;}
async function until(code){for(let i=0;i<150;i++){if(await js(code))return;await delay(20);}throw Error('Missing state: '+code);}
async function shot(name){await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(250);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
const styles=['health-diary','daily-period','sibling-ui','school-workspace','school-classic-remodel'].map(n=>'<link rel="stylesheet" href="'+pathToFileURL(path.join(root,'src/renderer/styles',n+'.css')).href+'">').join('');
const html=`<!doctype html><meta charset="utf-8">${styles}
<style>body{overflow:auto!important}#schoolMain{padding:16px;margin:0!important;width:100%!important;max-width:none!important}#view-daily{display:block!important}.magic-chart-body{background:var(--card)}#dailyLoadingOverlay{display:none!important}</style>
<body class="light school-interface school-classic is-windows"><main id="schoolMain">${read('src/renderer/views/view-daily.html')}</main><aside><div id="mainCalendar"></div></aside>
<script>
localStorage.clear();
const S={records:[],memoData:{p:[]},settings:{schoolLevel:'elementary'},_vipTags:{},_currentUser:{id:'qa'},selectedDate:'2026-11-11',currentView:'daily',_dailyLoading:false};
const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getStu=id=>({id,name:'가상 학생',type:'student',grade:6,cls:2,num:3,gender:'남'});
const findTopOpenModal=()=>document.getElementById('memoOverlay');
let fail=false,memoWrites=0,period=false,periodRefreshes=0;
window.electronAPI={studentsUpdateMemo:async()=>({success:!fail}),dbSet:async()=>{memoWrites++;return {success:!fail};}};
const isBirthdayToday=()=>false,getCareTooltipHtml=()=>'',getStudentNameHoverHtml=s=>s.name,getSymClass=()=> 'tag-blue';
const _vsExpandedRids=new Set(),_paExpandedRids=new Set(),_vsTableHtml=()=>'',_paTableHtml=()=>'';
${rowSource}
const noop=()=>{};
const isKinder=()=>false,getWeatherEmoji=()=>'',toggleWeatherPicker=noop,setWeather=noop;
const dateObj=d=>new Date(d+'T12:00:00'),getDow=d=>['일','월','화','수','목','금','토'][dateObj(d).getDay()],toDateStr=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const _applyPrivacyToRows=noop,_updateSortArrows=noop,dailyInitDrag=noop,renderCalendar=noop,renderSidebarRecent=noop,crInsertHandles=noop;
let _nameHoverEl=null,_dailyEntryOverlayShown=true,_dailyOverlayHideTimer=null,_crInsertHandlesRef=null,_lastRegisteredRecId=null,_contextCalendarDate=null,_calContextFocus=false,_calFocusActive=false;
const updateDailyDateLabel=()=>document.getElementById('dailyDateLabel').textContent=S.selectedDate;
const isDailyPeriodSearchActive=()=>period,refreshDailyPeriodSearch=()=>{periodRefreshes++;},selectDailyPeriodDate=()=>false,closeDailyPeriodSearch=()=>{period=false;};
const hasMultipleSchoolLevels=()=>false,bindDiaryPrivacy=noop,_setDateVisitorsHistoryPreview=noop;
const _closeDateVisitors=()=>document.getElementById('dateVisitorsPanel')?.remove();
const getGuardianType=()=>'',getGuardianContact=()=>'',getStudentBirth=()=>'',getCareMemoText=()=>'',_visitHealthDetailHtml=()=>'',_bindVisitHealthDetails=noop,_fitVisitHealthSummary=noop;
let fullHistoryPerson=null;
const _symShowHistory=id=>{fullHistoryPerson=id;};
const _showVisitHistory=()=>{const panel=document.getElementById('sideVisitHistory');panel.style.display='flex';panel.classList.add('vh-show');};
function bindDailyRecordActions(body){body.onclick=e=>{const b=e.target.closest('[data-action="toggleMemo"]');if(b)openPersonMemo(b.dataset.sid,b,renderDaily);};}
${pick('src/renderer/features/emergency/emergency-view.js',['DAILY_COLS','_userKey','getDailyColOrder','getDailyColVisibility','sanitizeColWidths','migrateLegacyColWidths','applyDailyColLayout','_ecVitalsHtml','syncListDeleteButtons',
'dailyColHistory','dailyColEyeIcon','pushDailyColHistory','saveDailyColOrder','saveDailyColVisibility','renderColSelectorCards','undoDailyColChange',
'EC_COLS','_EC_MANDATORY','ecColHistory','getEcColOrder','getEcColVisibility','saveEcColOrder','saveEcColVisibility','pushEcColHistory','renderEcColSelectorCards','applyEcColLayout','undoEcColChange',
'INF_COLS','_INF_MANDATORY','infColHistory','getInfColOrder','getInfColVisibility','saveInfColOrder','saveInfColVisibility','pushInfColHistory','renderInfColSelectorCards','applyInfColLayout','undoInfColChange'])}
${pick('src/renderer/features/daily/daily-view.js',['syncDailySelectedDate','selectDate','_showDateVisitors','renderDaily','showVisitHistory','_vsValueStr'])}
function fillOtherLists(){
  for(const [tableId,memoIndex] of [['ecListTable',11],['infListTable',12]]){
    const table=document.getElementById(tableId),body=table.querySelector('tbody');
    body.innerHTML='<tr>'+Array.from(table.querySelectorAll('th')).map(th=>'<td data-col-index="'+th.dataset.colIndex+'" style="'+(Number(th.dataset.colIndex)===memoIndex?'position:relative;padding-right:32px':'')+'">'+(Number(th.dataset.colIndex)===memoIndex?memoCellHtml('p',1)+'<button class="row-delete-x">×</button>':th.textContent==='이름'?'가상 학생':th.textContent==='V/S'?_ecVitalsHtml({vitals:{temp:'36.5',pulse:'72',bp:'120/80',resp:'18',spo2:'98',bst:'98'}}):th.textContent==='작성일'?'2026-11-02':'-')+'</td>').join('')+'</tr>';
    bindDailyRecordActions(body);
  }
}
function showTab(tab){document.querySelectorAll('.daily-cat-content').forEach(e=>e.classList.toggle('active',e.id==='dailyCat-'+tab));}
function edit(value){const input=document.querySelector('.person-memo-editor textarea');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
function clickSave(){document.querySelector('.person-memo-save').click();}
S.records=Array.from({length:7},(_,i)=>({id:i+1,_dbId:i+1,studentId:'p',date:'2026-06-25',timeIn:'09:0'+i,symptoms:['두통'],treatment:['안정']}));
renderDaily();fillOtherLists();window.ready=true;
</script>`;
fs.writeFileSync(path.join(out,'fixture.html'),html);
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));
  win=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadFile(path.join(out,'fixture.html'));await until('window.ready');
  await js("selectDate('2026-06-25',true)");
  await check("document.querySelectorAll('#recBody > tr').length===7 && document.querySelector('.dv-header').textContent.includes('방문 7건')");
  await check("document.querySelector('.daily-empty-msg').style.display==='none' && document.querySelector('#dailyVisitorCount .flip-stat-total').textContent==='당일 전체'");
  await shot('daily-seven-visits');
  for(const [tab,id] of [['general','recTable'],['emergency','ecListTable'],['infection','infListTable']]){
    await js('showTab('+JSON.stringify(tab)+')');
    for(const width of [1000,1500]){
      win.setSize(width,1000);
      await js('document.querySelector('+JSON.stringify('#'+id+' [data-action="toggleMemo"]')+').click()');
      await check("!!document.querySelector('#memoOverlay textarea') && document.querySelector('#memoOverlay textarea').getBoundingClientRect().width>400");
      await check("!document.querySelector('#memoOverlay').textContent.includes('다음 방문에도')");
      if(tab==='infection'&&width===1000)await shot('memo-editor');
      await js("edit('검증 메모 '+"+JSON.stringify(tab+' '+width)+");clickSave()");
      await until("!document.querySelector('.person-memo-editor')");
      await check('document.querySelector('+JSON.stringify('#'+id+' .person-memo-preview')+').textContent.includes('+JSON.stringify(tab+' '+width)+')');
      await check('(()=>{const b=document.querySelector('+JSON.stringify('#'+id+' [data-action="toggleMemo"]')+'),cell=b.closest("td"),r=b.getBoundingClientRect(),c=cell.getBoundingClientRect();return r.height<40 && r.right<=c.right-25;})()');
      await js("renderDaily();fillOtherLists()");
      await check("!document.getElementById('memoOverlay') && !hasInlineMemoEditor()");
    }
    await shot(tab+'-saved');
    if(tab==='emergency'){
      const bounds=await js("(()=>{const h=document.querySelector('#ecListTable th[data-col-index=\"8\"]').getBoundingClientRect(),c=document.querySelector('#ecListBody td[data-col-index=\"8\"]').getBoundingClientRect();return {x:Math.floor(h.left),y:Math.floor(h.top),width:Math.ceil(h.width),height:Math.ceil(c.bottom-h.top)};})()");
      fs.writeFileSync(path.join(out,'vitals-detail.png'),(await win.webContents.capturePage(bounds)).toPNG());
    }
  }
  // An inline draft in another list must not freeze date selection or empty-state removal.
  await js("showTab('emergency');const th=document.querySelector('#ecListTable th[data-col-index=\"11\"]');th.style.width='450px';th.style.minWidth='450px';document.querySelector('#ecListTable [data-action=\"toggleMemo\"]').click();edit('이동 중 작성 내용')");
  await check('hasInlineMemoEditor()');
  await js("selectDate('2026-11-11',true);selectDate('2026-06-25',true);showTab('general')");
  await check("document.querySelectorAll('#recBody > tr').length===7 && document.querySelector('#memoOverlay textarea').value==='이동 중 작성 내용'");
  await js('clickSave()');await until("!document.getElementById('memoOverlay')");
  await check("document.querySelector('#recTable .person-memo-preview').textContent==='이동 중 작성 내용'");
  // Failure must keep the draft open and retry must close only after successful storage.
  await js("document.querySelector('#recTable [data-action=\"toggleMemo\"]').click();fail=true;edit('재시도 내용');clickSave()");
  await until("document.querySelector('.person-memo-editor [role=status]').textContent.includes('저장 실패')");
  await check("S.memoData.p[0].text==='이동 중 작성 내용'");
  await js('fail=false;clickSave()');await until("!document.getElementById('memoOverlay')");
  await check("S.memoData.p[0].text==='재시도 내용'");
  // Refreshing a range must also run while retaining an inline draft.
  await js("showTab('emergency');document.querySelector('#ecListTable [data-action=\"toggleMemo\"]').click();edit('기간 전환 내용');period=true;renderDaily()");
  await check("periodRefreshes===1 && document.querySelector('#memoOverlay textarea').value==='기간 전환 내용'");
  await js('period=false;clickSave()');await until("!document.getElementById('memoOverlay')");
  // Old user widths cannot squeeze the memo button; hiding it still hides the preview.
  await js("showTab('general');localStorage.setItem(_userKey('ec_col_widths'),JSON.stringify({14:70}));applyDailyColLayout()");
  await check("document.querySelector('#recTable th[data-col-index=\"14\"]').getBoundingClientRect().width>=200");
  await js("localStorage.setItem(_userKey('dailyColVisibility'),JSON.stringify({14:false}));applyDailyColLayout()");
  await check("document.querySelector('#recTable .person-memo-cell').getClientRects().length===0 && getComputedStyle(document.querySelector('#recTable th[data-col-index=\"14\"]')).display==='none'");
  // Long notes stay bounded in all three lists; full text survives reopening and clearing.
  await js("localStorage.removeItem(_userKey('dailyColVisibility'));applyDailyColLayout();S.memoData.p=[{text:('주의사항 긴 내용 / '+ '가'.repeat(40)+'\\n').repeat(20)}];renderDaily();fillOtherLists()");
  for(const [tab,id] of [['general','recTable'],['emergency','ecListTable'],['infection','infListTable']]){
    await js('showTab('+JSON.stringify(tab)+')');
    await check('(()=>{const e=document.querySelector('+JSON.stringify('#'+id+' .person-memo-preview')+');return e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)*3+1 && e.scrollHeight>e.clientHeight;})()');
  }
  await js("showTab('general');document.querySelector('#recTable .person-memo-open').click()");
  await check("document.querySelector('textarea').value===S.memoData.p[0].text && document.querySelectorAll('.person-memo-save').length===1");
  await js("document.querySelector('.person-memo-save').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))");
  await check("document.activeElement.classList.contains('person-memo-dismiss')");
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}))");
  await check("document.activeElement.classList.contains('person-memo-save')");
  await js("edit('');clickSave()");await until("!document.getElementById('memoOverlay')");
  await check("S.memoData.p.length===0 && document.querySelector('#recTable .person-memo-open').textContent==='+ 메모'");
  await until("document.activeElement.classList.contains('person-memo-open')");
  // A pending autosave followed by reverting to the original text cannot overwrite the final value.
  await js("document.querySelector('#recTable .person-memo-open').click();const realSave=electronAPI.dbSet;window.resumeWrite=null;electronAPI.dbSet=async(...args)=>{electronAPI.dbSet=realSave;await new Promise(r=>window.resumeWrite=r);return realSave(...args);};edit('잠깐 입력')");
  await until('!!window.resumeWrite');
  await js("edit('');clickSave();resumeWrite()");await until("!document.getElementById('memoOverlay')");
  await check('S.memoData.p.length===0');
  // Keep the restored tabs while pairing each vital label closely with its value.
  await js("showTab('emergency');fillOtherLists()");
  await check("(()=>{const t=getComputedStyle(document.querySelector('#view-daily > .school-subnav'));return t.position!=='sticky'&&t.backgroundColor==='rgba(0, 0, 0, 0)';})()");
  await check("document.querySelectorAll('#ecListBody .ec-vitals-pair').length===6");
  await check("Array.from(document.querySelectorAll('#ecListBody .ec-vitals-pair')).every(p=>{const label=p.querySelector('.ec-vitals-label').getBoundingClientRect(),value=p.querySelector('.ec-vitals-reading').getBoundingClientRect();return value.left-label.right<=8&&value.left>=label.right;})");
  await check("getComputedStyle(document.querySelectorAll('#ecListBody .ec-vitals-pair')[1]).borderLeftWidth==='1px'");
  await check("(()=>{const div=document.createElement('div');div.innerHTML=_ecVitalsHtml({vitalsList:[{time:'09:00',temp:'36.5',bp:'120/80'},{time:'09:10',pulse:0,spo2:'<98'}]});return div.querySelectorAll('.ec-vitals-measure').length===2&&div.querySelectorAll('.ec-vitals-pair').length===12&&div.textContent.includes('120/80')&&div.textContent.includes('0 회/분')&&div.textContent.includes('<98')&&div.textContent.includes('—');})()");
  await check("getComputedStyle(document.querySelector('#ecListTable thead')).position!=='sticky'");
  await shot('restored-tabs-vitals');
  await js("document.body.classList.remove('light');document.querySelector('#ecListTable .person-memo-open').click()");
  await check("getComputedStyle(document.querySelector('.person-memo-save')).color!==getComputedStyle(document.querySelector('.person-memo-save')).backgroundColor");
  await shot('memo-dark');
  await js("clickSave()");await until("!document.getElementById('memoOverlay')");
  // The recent sidebar is bounded to three visits; the full-history path remains complete.
  await js("document.body.classList.add('light');const sidebar=document.createElement('aside');sidebar.id='schoolSidebar';sidebar.className='sidebar';sidebar.style.cssText='position:fixed;left:0;top:0;width:320px;height:700px;overflow:auto;background:var(--card);padding:16px;z-index:200';sidebar.innerHTML='<div id=sideVisitHistory class=\"cc vh-health-bounded\"><div id=visitHistoryTitle></div><div id=visitHistoryBody class=visit-history-card></div></div>';document.body.append(sidebar);showVisitHistory('p')");
  await check("document.querySelectorAll('#visitHistoryBody .vh-record').length===3 && document.getElementById('vhFullHistBtn').textContent==='전체 이력 (7)'");
  await check("document.querySelector('#visitHistoryBody .vh-time').textContent.includes('09:06') && getComputedStyle(document.getElementById('visitHistoryBody')).opacity==='1'");
  await check("document.getElementById('visitHistoryBody').clientHeight>100");
  await js("document.getElementById('sideVisitHistory').style.setProperty('--vh-summary-height','0px')");
  await check("document.querySelector('#visitHistoryTitle .vh-person-summary').clientHeight>30");
  await shot('recent-history');
  await js("document.getElementById('vhFullHistBtn').click()");
  await check("fullHistoryPerson==='p'");
  await js("showVisitHistory('p',{all:true})");
  await check("document.querySelectorAll('#visitHistoryBody .vh-record').length===7");
  // Exercise the actual field-setting buttons, persistence, undo and delete-button relocation.
  await js("document.getElementById('schoolSidebar').remove();S.memoData.p=[{text:'숨겨도 보존할 주의사항'}];renderDaily();fillOtherLists();window.memoBefore=JSON.stringify(S.memoData);window.columns=document.createElement('div');document.body.append(columns)");
  for(const [tab,table,index,render,apply,get,undo] of [
    ['general','recTable',14,'renderColSelectorCards','applyDailyColLayout','getDailyColVisibility','undoDailyColChange'],
    ['emergency','ecListTable',11,'renderEcColSelectorCards','applyEcColLayout','getEcColVisibility','undoEcColChange'],
    ['infection','infListTable',12,'renderInfColSelectorCards','applyInfColLayout','getInfColVisibility','undoInfColChange']
  ]){
    await js('showTab('+JSON.stringify(tab)+');'+render+'(columns)');
    const toggle='columns.querySelector(\'[data-col-index="'+index+'"] .col-toggle-btn\')';
    const header='document.querySelector(\'#'+table+' th[data-col-index="'+index+'"]\')';
    const note='document.querySelector(\'#'+table+' .person-memo-cell\')';
    await check('!'+toggle+'.disabled && getComputedStyle('+toggle+').cursor!=="not-allowed"');
    await js(toggle+'.click()');
    await check(get+'()['+index+']===false && getComputedStyle('+header+').display==="none" && '+note+'.getClientRects().length===0');
    await check('document.querySelectorAll(\'#'+table+' td.record-delete-host > .row-delete-x\').length===document.querySelectorAll(\'#'+table+' tbody > tr\').length');
    await js(apply+'();'+render+'(columns)');
    await check('getComputedStyle('+header+').display==="none" && !columns.querySelector(\'[data-col-index="'+index+'"]\').classList.contains("active")');
    await js(undo+'();'+render+'(columns)');
    await check('getComputedStyle('+header+').display!=="none" && '+note+'.textContent.includes("숨겨도 보존할 주의사항")');
    await check('document.querySelectorAll(\'#'+table+' td.record-delete-host\').length===0');
    await js(toggle+'.click();'+toggle+'.click()');
    await check('getComputedStyle('+header+').display!=="none" && JSON.stringify(S.memoData)===memoBefore');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));app.exit(0);
}).catch(error=>{console.error(error,errors);app.exit(1);});
