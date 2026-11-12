'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express');
const {createSurveyRouter}=require('../../survey-server/router');
const {SurveyPublishingService}=require('../../src/main/services/survey-publishing-service');
const {SurveyStoreService}=require('../../src/main/services/blob-store-services');
const {SurveyDefinitionService,SurveyFormService,SurveyResponseService}=require('../../src/main/services/survey-db-service');
const {HealthDiaryDB}=require('../../src/main/services/database');
const {SQLiteAppDataStore}=require('../../src/main/services/sqlite-app-data-store');
const responsive=process.argv.includes('--responsive');
const root=path.resolve(__dirname,'../..'),out=path.join(root,responsive?'_preview/magic-responsive':'_preview/survey-ui');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+Date.now()));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-networking');
let server,editor,mobile,checks=0;const errors=[];
const timer=setTimeout(()=>finish(Error('UI fixture timed out')),responsive?240000:55000);
function finish(error){clearTimeout(timer);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,error:error&&error.stack},null,2));if(error)console.error(error);if(server)server.close();app.exit(error?1:0);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const js=(win,code)=>win.webContents.executeJavaScript(code,true);
async function until(win,code){for(let i=0;i<200;i++){if(await js(win,code)){checks++;return;}await delay(25);}console.error(await js(win,"JSON.stringify({text:document.getElementById('sv-stats')?.textContent,alerts:window.alerts,toasts:window.toasts,records:window.surveyTest?.getRecords()})"));throw Error('Missing state: '+code);}
async function check(win,code){assert(await js(win,code),code);checks++;}
async function shot(win,name){await js(win,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(1100);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  const dbPath=path.join(out,'test-'+Date.now()+'.sqlite3');
  const db=new HealthDiaryDB(dbPath),store=new SQLiteAppDataStore(dbPath),rows=new Map();
  const formService=new SurveyFormService(db,null,store),responseService=new SurveyResponseService(db);
  const workspace=new SurveyStoreService(store);
  const publishing=new SurveyPublishingService(store,{save(meta,content){const result=responseService.save(meta,content);rows.set(meta.student_persistent_id,{...meta,response_data:content});return result;}});
  // Exercise the production preload and production survey IPC handlers, with isolated services only.
  const mainSource=fs.readFileSync(path.join(root,'main.js'),'utf8'),acorn=require('acorn');
  const ast=acorn.parse(mainSource,{ecmaVersion:'latest',sourceType:'script'}),registrations=[];
  function collect(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee?.object?.name==='ipcMain'&&node.callee?.property?.name==='handle'&&String(node.arguments[0]?.value||'').startsWith('survey-'))registrations.push(mainSource.slice(node.start,node.end)+';');
    if(node.type==='ForOfStatement'&&node.right?.callee?.object?.name==='Object'&&node.right?.arguments?.[0]?.properties?.some(p=>p.key.value==='survey-publish')){registrations.push(mainSource.slice(node.start,node.end));return;}
    for(const [key,value] of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')collect(value);}
  }
  collect(ast);assert(registrations.length>=15);
  require('node:vm').runInNewContext(registrations.join('\n'),{ipcMain,services:{surveyStore:()=>workspace,surveyForms:()=>formService,surveyDefinition:()=>new SurveyDefinitionService(),surveyPublishing:()=>publishing,surveyResponses:()=>responseService}});
  ipcMain.handle('get-user-data-path',()=>app.getPath('userData'));
  ipcMain.handle('get-default-save-path',()=>out);
  const web=express();web.use(createSurveyRouter({dataDir:path.join(out,'server-'+Date.now()),authenticate:(channel,token)=>channel==='ui_school'&&token==='test-ui-token'}));
  web.use('/styles',express.static(path.join(root,'src/renderer/styles')));
  web.use('/assets',express.static(path.join(root,'assets')));
  const magicHtml=fs.readFileSync(path.join(root,'src/renderer/views/view-magic.html'),'utf8').replace('class="view"','class="view active"').replace('<div id="magicSubSurveyFragmentHost" data-fragment="src/renderer/views/magic-sub-survey.html"></div>',fs.readFileSync(path.join(root,'src/renderer/views/magic-sub-survey.html'),'utf8'));
  const appHtml=fs.readFileSync(path.join(root,'health_diary.html'),'utf8');
  const header=appHtml.slice(appHtml.indexOf('<header class="top-header">'),appHtml.indexOf('</header>')+9);
  web.get('/fixture',(_req,res)=>res.send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+['health-diary','daily-period','sibling-ui','school-workspace','school-classic-remodel','magic-responsive','sound-settings'].map(n=>'<link rel="stylesheet" href="/styles/'+n+'.css">').join('')+'<body class="light school-interface school-classic sidebar-off" data-active-view="magic">'+header+'<div class="app"><div class="main" id="schoolMain">'+magicHtml+'</div></div></body>'));
  server=web.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(base)&&!details.url.startsWith('devtools:')}));
  editor=new BrowserWindow({show:false,width:1800,height:1000,webPreferences:{preload:path.join(root,'preload.js'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  editor.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await editor.loadURL(base+'/fixture');
  const source=fs.readFileSync(path.join(root,'src/renderer/features/survey/survey-view.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const model=fs.readFileSync(path.join(root,'src/shared/survey-model.js'),'utf8');
  const training=fs.readFileSync(path.join(root,'src/renderer/features/training/training-view.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const planner=fs.readFileSync(path.join(root,'src/renderer/features/planner/planner-view.js'),'utf8');
  const switchNode=require('acorn').parse(planner,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.declaration?.id?.name==='_magicSwitchSub').declaration;
  const switchSource=planner.slice(switchNode.start,switchNode.end);
  const shellLayout=fs.readFileSync(path.join(root,'src/renderer/features/shell/sibling-layout.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const setup=`window.alerts=[];window.toasts=[];const S={people:[{id:'student-one',uid:'student-one',name:'가상학생',grade:1,cls:2,num:3,type:'student'},{id:'student-two',uid:'student-two',name:'다른학생',grade:2,cls:1,num:1,type:'student'}],settings:{schoolName:'가상학교',schoolLevel:'elementary'},kioskSettings:{relayUrl:${JSON.stringify(base)},channelId:'ui_school',authToken:'test-ui-token'},currentView:'magic'};
    const DEFAULT_RELAY_URL=${JSON.stringify(base)},FLAG_SVGS={};
    const escHtml=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
    const toDateStr=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const closeModalGracefully=el=>el.remove(),appConfirmModal=async text=>{alerts.push(text);return true;},bus={emit:(_name,p)=>toasts.push(p),on:()=>{}};
    const openClockPicker=()=>{},switchView=()=>{},_magicApplyBounce=()=>{};
    const renderTrainingHome=()=>trainingTest.home();${switchSource}
    ${model}\n${source}\nwindow.surveyTest={home:svRenderHome,open:svOpenPanel,step:svWizardStep,edit:_svEditCreatedSurvey,active:svRenderActivePast,stats:svRenderStats,sub:svSwitchSub,preview:svPreviewSurvey,getDraft:()=>svSurveyData,getRecords:()=>svWorkspaceCache.createdSurveys,select:()=>{svWizardSelectedGrades=[1];svWizardSelectedStudents={'student-one':true};},finalize:_svFinalizeSurveyCreation};
    (function(){const ensureHolidayYear=()=>{},createEmptyState=()=>'',compareClass=(a,b)=>String(a).localeCompare(String(b)),closeModalWithAnim=e=>e.remove(),_makeDraggable=()=>{},dailyColEyeIcon=()=>'',sortStaffList=l=>l.slice().sort((a,b)=>a.name.localeCompare(b.name)),openPersonSearch=()=>{};
    localStorage.setItem('trs_notice_log','{invalid');${training}
    window.trainingTest={home:renderTrainingHome,sub:trSwitchSub,state:()=>_trainingState,rows:_trBuildRegisterRows,print:_trPrintHtml};})();
    document.querySelectorAll('[data-magic-sub]').forEach(button=>button.addEventListener('click',()=>_magicSwitchSub(button.dataset.magicSub,button)));
    document.querySelectorAll('[data-tr-sub]').forEach(button=>button.addEventListener('click',()=>trainingTest.sub(button.dataset.trSub)));
    document.getElementById('magicSubTabSurvey').click();(function(){${shellLayout}})();`;
  await js(editor,setup+'\nvoid 0;');
  if(responsive){await require('./magic-responsive-runner.cjs')({editor,base,publishing,root,out,js,delay,errors});finish();return;}
  await js(editor,"surveyTest.home();surveyTest.open('wizard',{});");
  await until(editor,"document.querySelector('#sv-wizard-step-1')!==null");
  await js(editor,"surveyTest.select();surveyTest.step(4)");
  await js(editor,`const title=document.querySelector('[data-sv-input="setTitle"]');title.value='가상학교 만족도 조사';title.dispatchEvent(new Event('input',{bubbles:true}));const q=document.querySelector('[data-sv-input="setQText"]');q.value='보건실 안내가 도움이 되었나요?';q.dispatchEvent(new Event('input',{bubbles:true}));`);
  await js(editor,"surveyTest.finalize(false)");
  await until(editor,"document.querySelector('#sv-wizard-step-5').textContent.includes('이 PC에 저장')");
  const firstId=await js(editor,'surveyTest.getDraft().formId');assert(formService.get(firstId));checks++;
  assert.equal(formService.get(firstId).content.title,'가상학교 만족도 조사');checks++;
  await js(editor,"surveyTest.edit(surveyTest.getRecords()[0]);");
  await until(editor,"document.querySelector('[data-sv-input=\"setTitle\"]').value==='가상학교 만족도 조사'");
  await shot(editor,'editor');
  await js(editor,'surveyTest.finalize(true)');
  await until(editor,"document.getElementById('svResultUrl')?.value.includes('/s/')");
  const url=await js(editor,"document.getElementById('svResultUrl').value");
  mobile=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  mobile.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await mobile.loadURL(url);await until(mobile,"!document.getElementById('survey').hidden");
  await check(mobile,'document.documentElement.scrollWidth<=window.innerWidth');await shot(mobile,'mobile-identity');
  await js(mobile,"document.getElementById('name').value='가상학생';document.getElementById('grade').value=1;document.getElementById('cls').value=2;document.getElementById('num').value=3;document.getElementById('next').click();");
  await until(mobile,"document.querySelector('input[type=radio]')!==null");
  await js(mobile,"document.querySelector('input[type=radio]').click()");await shot(mobile,'mobile-question');
  await js(mobile,"document.getElementById('next').click()");await until(mobile,"document.getElementById('message').textContent.includes('제출되었습니다')");
  await js(editor,"surveyTest.open('stats',{formId:"+JSON.stringify(firstId)+",title:'가상학교 만족도 조사'});");
  await until(editor,"document.getElementById('sv-stats-summary')?.textContent.includes('100%')");
  assert.equal(rows.size,1);checks++;await shot(editor,'statistics');
  await mobile.reload();await until(mobile,"document.getElementById('restart')!==null");
  await check(mobile,"document.getElementById('survey').hidden && document.getElementById('name').value===''");
  assert.equal((await publishing.sync(firstId)).count,0);checks++;
  await js(mobile,"document.getElementById('restart').click()");await until(mobile,"!document.getElementById('survey').hidden");
  await js(mobile,"document.getElementById('name').value='다른학생';document.getElementById('grade').value=2;document.getElementById('cls').value=1;document.getElementById('num').value=1;document.getElementById('next').click();document.querySelector('input[type=radio]').click();document.getElementById('next').click();");
  await until(mobile,"document.getElementById('restart')!==null");
  const secondSync=await publishing.sync(firstId);assert.equal(secondSync.count,1);assert.equal(secondSync.unmatched,1);checks++;
  const types=require('../../src/shared/survey-model').TYPES;
  const allTypes={formId:'all_types',title:'모든 문항 형식',languages:['ko','en'],sections:[{title:'문항 테스트',questions:types.map((type,i)=>({id:100+i,type,text:type,required:true,options:type==='star'||type==='scale'?['1','2']:['A','B'],gridRows:['행'],gridCols:['A','B'],translations:{en:{text:'English '+type}},optionTranslations:{0:{en:'First option'}}}))}]};
  const allPublished=await publishing.publish({connection:{relayUrl:base,channelId:'ui_school',authToken:'test-ui-token'},draft:allTypes,recipients:[],year:2026});
  await mobile.loadURL(allPublished.url);await until(mobile,"!document.getElementById('survey').hidden");
  await js(mobile,"document.getElementById('language').value='en';document.getElementById('language').dispatchEvent(new Event('change'));document.getElementById('name').value='가상학생';document.getElementById('grade').value=1;document.getElementById('cls').value=2;document.getElementById('num').value=3;document.getElementById('next').click();");
  await until(mobile,"document.querySelectorAll('fieldset').length===13");
  await check(mobile,"document.querySelector('legend').textContent.includes('English short_text')");
  await js(mobile,"document.getElementById('next').click()");await check(mobile,"!document.getElementById('survey').hidden && document.getElementById('message').textContent.length>0");
  await js(mobile,`const seen=new Set();document.querySelectorAll('#questions input,#questions textarea,#questions select').forEach(input=>{
    if(input.type==='radio'){if(!seen.has(input.name)){input.click();seen.add(input.name);}}
    else if(input.type==='checkbox'){input.click();}
    else{input.value=input.tagName==='SELECT'?'A':input.type==='date'?'2026-11-11':input.type==='time'?'09:30':'가상 응답';input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));}
  });document.getElementById('next').click();`);
  await until(mobile,"document.getElementById('message').textContent.includes('제출되었습니다')");
  const imported=await publishing.sync('all_types');assert.equal(imported.count,1);checks++;
  await js(editor,"surveyTest.open('wizard',{});");await until(editor,'surveyTest.getDraft().formId!=='+JSON.stringify(firstId));
  await check(editor,"surveyTest.getDraft().title===''");
  await js(editor,'surveyTest.select();surveyTest.step(4);surveyTest.finalize(false)');
  await check(editor,"alerts.some(x=>x.includes('제목'))");
  await js(editor,'surveyTest.active()');await check(editor,"document.getElementById('sv-active-panel').textContent.includes('링크 복사')");
  await js(editor,"document.getElementById('magicSubTabTraining').click();trainingTest.state().selectedIds={'student-one':true,'student-two':true};trainingTest.home();const name=document.getElementById('trName');name.value='가상학교 안전교육';name.dispatchEvent(new Event('input',{bubbles:true}));");
  await check(editor,"document.getElementById('magicSubTraining').classList.contains('active') && !document.getElementById('magicSubSurvey').classList.contains('active')");
  await check(editor,"document.getElementById('trPreviewA4Wrap').textContent.includes('가상학생') && trainingTest.rows().selected.length===2 && trainingTest.print().includes('가상학교 안전교육')");
  await until(editor,"Number(document.getElementById('trPreviewA4Wrap').style.zoom)>0");
  await shot(editor,'training-register');
  await js(editor,"trainingTest.home();trainingTest.home();document.querySelector('[data-action=showMessage]').click();");
  await check(editor,"document.querySelectorAll('#trMsgBody').length===1");
  await js(editor,"const msg=document.getElementById('trMsgBody');msg.value+=' 추가 안내';msg.dispatchEvent(new Event('input',{bubbles:true}));");
  await until(editor,"document.getElementById('trsSaveIndicator')?.textContent.includes('저장되었습니다')");
  await check(editor,"localStorage.getItem('tr_msg_template').includes('추가 안내')");
  await js(editor,"document.getElementById('trMsgBody').closest('.modal-overlay')?.remove();document.getElementById('trSubTabStatus').click();");
  await check(editor,"document.getElementById('trainingStatusArea').textContent.includes('심폐소생술')");
  await shot(editor,'training-status');
  await js(editor,"document.getElementById('magicSubTabSurvey').click();document.getElementById('magicSubTabTraining').click();");
  await check(editor,"document.getElementById('trName').value==='가상학교 안전교육'");
  await js(editor,"document.getElementById('magicSubTabSurvey').click();surveyTest.active();document.querySelector('[data-survey-manage=copy]').click();");
  await until(editor,"surveyTest.getDraft().title.includes('복사본')");
  const copyId=await js(editor,'surveyTest.getDraft().formId');assert.notEqual(copyId,firstId);checks++;
  await check(editor,'!surveyTest.getRecords().find(r=>r.formId==='+JSON.stringify(copyId)+').url');
  await js(editor,'surveyTest.finalize(false)');assert(formService.get(copyId));checks++;
  // A new renderer starts with empty browser caches; persisted cards must come from SQLite.
  await js(editor,"localStorage.removeItem('ec_sv_created')");await editor.reload();await js(editor,setup+'\nvoid 0;');
  await until(editor,'surveyTest.getRecords().some(r=>r.formId==='+JSON.stringify(copyId)+')');
  await js(editor,"surveyTest.active();document.querySelector('[data-survey-manage=close][data-form-id=\""+firstId+"\"]').click();");
  await until(editor,'surveyTest.getRecords().find(r=>r.formId==='+JSON.stringify(firstId)+').closed');
  assert.equal((await fetch(base+'/api/v1/surveys/public/'+url.split('/').pop())).status,410);checks++;
  await js(editor,"surveyTest.active();document.querySelector('[data-survey-manage=copy][data-form-id=\""+copyId+"\"]').closest('tr').querySelector('.sv-act-del').click();");
  await until(editor,'!surveyTest.getRecords().some(r=>r.formId==='+JSON.stringify(copyId)+')');assert.equal(formService.get(copyId),null);checks++;
  assert.equal(errors.length,0,errors.join('\n'));finish();
}).catch(finish);
