'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const acorn=require('acorn');
const model=require('../src/shared/survey-model');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/features/survey/survey-view.js'),'utf8');
const nodes=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n);
function functions(names){return names.map(name=>{const node=nodes.find(n=>n?.id?.name===name);assert(node,name);return source.slice(node.start,node.end);}).join('\n');}
function context(names,values){const c=vm.createContext({console,JSON,Date,Promise,Math:Object.create(Math),crypto:require('node:crypto').webcrypto,...values});vm.runInContext(functions(names),c);return c;}
const clean=v=>JSON.parse(JSON.stringify(v));
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const tick=()=>new Promise(r=>setImmediate(r));
const editorModel=['_dmQuestionList','_dmGetQuestion','_dmShuffleOptions','_dmReorderOptions','_dmDeleteOption','_dmRemapSectionJumps','_dmDeleteSection','_dmSplitSection','_dmDeleteQuestion'];
const consent=()=>({title:'동의 테스트',nextId:4,sections:[{id:'consent',title:'동의',questions:[{id:1,text:'동의합니까?',type:'radio',options:['동의','거부'],sectionJump:true,jumpMap:{1:'end'},optionTranslations:{0:{en:'Agree'},1:{en:'Decline'}},translations:{vi:{text:'동의',options:['Y','N']}}}]},{id:'details',title:'내용',questions:[{id:2,text:'내용',type:'short_text',required:true}]}]});
test('shuffling choices keeps translations and consent branches attached to their original choice',()=>{
  const c=context(editorModel,{_svQIdChurnIfPublished:()=>{}});vm.runInContext('Math.random=()=>0',c);
  const d=consent();c._dmShuffleOptions(d,0,0);const q=d.sections[0].questions[0];
  assert.equal(q.options[0],'거부');assert.equal(q.jumpMap[0],'end');assert.equal(q.optionTranslations[0].en,'Decline');
  assert.equal(q.translations.vi.options[0],'N');assert.deepEqual(model.validateResponses(d,{1:'거부'}),{1:'거부'});
});
test('splitting a section retains jump destinations and deleting preceding sections remaps them',()=>{
  const c=context(editorModel,{_svQIdChurnIfPublished:()=>{}}),d=consent();
  d.sections[0].questions.push({id:3,text:'추가',type:'short_text'});d.sections[0].questions[0].jumpMap={0:'1',1:'end'};
  c._dmSplitSection(d,0,0);assert.equal(d.sections[0].questions[0].jumpMap[0],'2');
  c._dmDeleteQuestion(d,1,0);assert.equal(d.sections[0].questions[0].jumpMap[0],'1');
});
test('a late workspace read cannot overwrite an edit saved while the read was in flight',async()=>{
  const pending=defer();let refreshed=0;
  const c=context(['_svSyncWorkspaceFromBackend','_svPersistWorkspace'],{_svWorkspaceRevision:0,_wsPendingSaves:0,_wsFetch:()=>pending.promise,_wsSave:async()=>{},_wsMerge:(a,b)=>({...a,...b}),_wsPersistLocal:()=>{},S:{},bus:{emit(){}},_api:{},svWorkspaceCache:{createdSurveys:[]}});
  c._svSyncWorkspaceFromBackend(()=>refreshed++);c._svPersistWorkspace({createdSurveys:[{formId:'new',title:'방금 편집'}]});
  pending.resolve({createdSurveys:[]});await tick();
  assert.equal(c.svWorkspaceCache.createdSurveys[0]?.title,'방금 편집');assert.equal(refreshed,1);
});
function publishingHarness(){
  const saved=defer(),published=[],steps=[],alerts=[];
  const c=context(['_svFinalizeSurveyCreation','_svEnsureFormId','_svRecordCreatedSurvey'],{
    _svPublishing:false,_svWorkspaceRevision:0,_asTimer:null,clearTimeout(){},_svCurrentPanel:'wizard',svWizardMode:'custom',svWizardSelectedGrades:[1],svWizardSelectedStudents:{a:true},svWizardSelectedLangs:['ko'],
    svSurveyData:{...consent(),formId:'a',draftKind:'custom'},svWorkspaceCache:{createdSurveys:[]},_academicYear:()=>2026,
    S:{people:[{id:'a',uid:'a',name:'학생A',type:'student',grade:1,cls:1,num:1},{id:'b',uid:'b',name:'학생B',type:'student',grade:2,cls:1,num:1}],kioskSettings:{relayUrl:'https://test.invalid',channelId:'one',authToken:'tokenA'}},
    DEFAULT_RELAY_URL:'https://test.invalid',window:{OrangeSurvey:model},bus:{emit(){}},document:{getElementById:()=>null},_wsSave:async()=>{},
    _svPersistWorkspace(patch){c.svWorkspaceCache={...c.svWorkspaceCache,...patch};},_closeSvOverlay(){},svWizardStep:n=>steps.push(n),appConfirmModal:async text=>alerts.push(text),
    _api:{surveyFormSave:()=>saved.promise,surveyPublish:async p=>{published.push(clean(p));return{success:true,url:'https://test.invalid/s/abc',version:1};}}
  });return {c,saved,published,steps,alerts};
}
test('publishing retains the original students and channel while the user opens another draft',async()=>{
  const h=publishingHarness(),task=h.c._svFinalizeSurveyCreation(true);
  h.c.svSurveyData={...consent(),formId:'b',draftKind:'health'};h.c.svWizardMode='health';h.c.svWizardSelectedGrades=[2];h.c.svWizardSelectedStudents={b:true};h.c.S.kioskSettings={relayUrl:'https://other.invalid',channelId:'two',authToken:'tokenB'};
  h.saved.resolve({success:true});await task;
  assert.equal(h.published[0].recipients[0].uid,'a');assert.equal(h.published[0].connection.channelId,'one');
  assert.equal(h.c.svWorkspaceCache.createdSurveys[0].kind,'custom');assert.deepEqual(h.steps,[]);
});
test('failed local save never publishes or shows a completed screen',async()=>{
  const h=publishingHarness(),task=h.c._svFinalizeSurveyCreation(true);h.saved.resolve({success:false,error:'disk full'});await task;
  assert.equal(h.published.length,0);assert.deepEqual(h.steps,[]);assert.match(h.alerts[0],/disk full/);assert.equal(h.c._svPublishing,false);
});
test('a repeated completion click does not duplicate the publication',async()=>{
  const h=publishingHarness(),task=h.c._svFinalizeSurveyCreation(true);await h.c._svFinalizeSurveyCreation(true);h.saved.resolve({success:true});await task;assert.equal(h.published.length,1);
});
for(const invalid of [undefined,null,{},NaN])test('definition rejects invalid question ID '+String(invalid),()=>{
  const d=consent();d.sections[0].questions[0].id=invalid;assert.throws(()=>model.validateDefinition(d),/ID/);
});

test('deleting an option retains the remaining choice translations and branch',()=>{
  const c=context(editorModel,{_svQIdChurnIfPublished:()=>{}}),d=consent();c._dmDeleteOption(d,0,0,0);
  const q=d.sections[0].questions[0];assert.deepEqual(clean(q.options),['거부']);assert.equal(q.jumpMap[0],'end');assert.equal(q.optionTranslations[0].en,'Decline');
});

test('workspace writes snapshot and serialize; a failed write does not block later saves',async()=>{
  const first=defer(),seen=[];
  const c=context(['_wsSave'],{_wsSaveQueue:Promise.resolve(),_wsPendingSaves:0,_wsPersistLocal(){},_api:{surveySaveWorkspace:async d=>{seen.push(clean(d));return seen.length===1?first.promise:{success:true};}}});
  const data={createdSurveys:[{title:'first'}],draft:{title:'obsolete'}},a=c._wsSave(data);data.createdSurveys[0].title='second';const b=c._wsSave(data);
  await tick();assert.equal(seen.length,1);assert.equal(seen[0].createdSurveys[0].title,'first');assert.equal(c._wsPendingSaves,2);
  const rejected=assert.rejects(a,/disk full/);first.resolve({success:false,error:'disk full'});await rejected;await b;
  assert.equal(seen[1].createdSurveys[0].title,'second');assert.equal(c._wsPendingSaves,0);assert.equal(seen[1].draft,undefined);
});

test('workspace reads started while a save is pending cannot overwrite the saved record',async()=>{
  const pending=defer();const c=context(['_svSyncWorkspaceFromBackend'],{_svWorkspaceRevision:1,_wsPendingSaves:1,_wsFetch:()=>pending.promise,_wsMerge:(a,b)=>({...a,...b}),_wsPersistLocal(){},S:{},svWorkspaceCache:{createdSurveys:[{title:'new'}]}});
  c._svSyncWorkspaceFromBackend();c._wsPendingSaves=0;pending.resolve({createdSurveys:[]});await tick();assert.equal(c.svWorkspaceCache.createdSurveys[0]?.title,'new');
});

test('autosave survives localStorage quota failure and captures the original draft selection',async()=>{
  let timer;const saved=[];
  const c=context(['_asScheduleSave','_dbSaveDraftSnapshot'],{_asTimer:null,clearTimeout(){},setTimeout:fn=>{timer=fn;},svWizardMode:'custom',svWizardSelectedGrades:[1],svWizardSelectedStudents:{a:true},svWizardSelectedLangs:['ko'],_dbDraftKey:()=>c.svWizardMode,_svSyncCreatedRec(){},localStorage:{setItem(){throw Error('QuotaExceededError');}},_api:{surveySaveDraft:async d=>{saved.push(clean(d));return {success:true};}},bus:{emit(){}}});
  c._asScheduleSave(consent());c.svWizardMode='health';c.svWizardSelectedStudents={b:true};timer();await tick();
  assert.equal(saved.length,1);assert.equal(saved[0].draftKind,'custom');assert.deepEqual(saved[0].selectedStudents,{a:true});
});

test('training storage recovers malformed lists and reports storage failure without crashing module initialization',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../src/renderer/features/training/training-view.js'),'utf8');
  const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'}).body;
  const code=['_trsReadList','_trsWriteLocal'].map(name=>{const n=ast.find(n=>n.id?.name===name);return src.slice(n.start,n.end);}).join('\n');
  const store=new Map([['broken','{bad'],['wrong','{}']]),messages=[];
  const c=vm.createContext({Date,localStorage:{getItem:key=>store.get(key),setItem:(k,v)=>store.set(k,v)},setTimeout:fn=>fn(),_trsToast:m=>messages.push(m)});vm.runInContext(code,c);
  assert.deepEqual(clean(c._trsReadList('broken')),[]);assert.deepEqual(clean(c._trsReadList('wrong')),[]);assert([...store.keys()].some(k=>k.startsWith('broken_recovery_')));
  c.localStorage.setItem=()=>{throw Error('quota');};assert.equal(c._trsWriteLocal('key','value'),false);assert.match(messages[0],/저장되지/);
});

test('invalid branching and end-time settings are rejected before local completion',()=>{
  const d=consent();d.endTime='25:00';assert.throws(()=>model.validateDefinition(d),/마감/);delete d.endTime;
  d.sections[0].questions[0].jumpMap={'-1':'end'};assert.throws(()=>model.validateDefinition(d),/선택지/);
  assert.equal(model.nextSection(d,0,{}),1,'unanswered choices must never take an index -1 branch');
});

test('malformed legacy survey caches cannot prevent the Magic Station home from loading',()=>{
  const data=new Map([['object','{}'],['null','null'],['broken','{broken'],['mixed','[null,4,{"title":"keep"}]']]);
  const c=context(['_wsReadJson'],{localStorage:{getItem:k=>data.get(k)}});
  for(const key of ['object','null','broken'])assert.deepEqual(clean(c._wsReadJson(key,[])),[]);
  assert.deepEqual(clean(c._wsReadJson('mixed',[])),[{title:'keep'}]);
});

test('Magic Station renderer imports resolve to real named exports',()=>{
  const renderer=path.join(__dirname,'../src/renderer');
  function exportsOf(file,seen=new Set()){
    if(seen.has(file))return new Set();seen.add(file);
    const exported=new Set(),body=acorn.parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'}).body;
    for(const n of body){
      if(n.type==='ExportAllDeclaration'){for(const name of exportsOf(path.resolve(path.dirname(file),n.source.value),seen))exported.add(name);}
      if(n.type==='ExportDefaultDeclaration')exported.add('default');if(n.type!=='ExportNamedDeclaration')continue;
      for(const s of n.specifiers||[])exported.add(s.exported.name);
      if(n.declaration?.id)exported.add(n.declaration.id.name);
      for(const d of n.declaration?.declarations||[])if(d.id.type==='Identifier')exported.add(d.id.name);
    }return exported;
  }
  for(const rel of ['features/survey/survey-view.js','features/training/training-view.js','features/planner/planner-view.js','features/shell/view-router.js']){
    const file=path.join(renderer,rel),ast=acorn.parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
    for(const imp of ast.body.filter(n=>n.type==='ImportDeclaration')){
      const target=path.resolve(path.dirname(file),imp.source.value);assert(fs.existsSync(target),rel+' -> '+imp.source.value);
      const exported=exportsOf(target);
      for(const spec of imp.specifiers){if(spec.type==='ImportNamespaceSpecifier')continue;const name=spec.type==='ImportDefaultSpecifier'?'default':spec.imported.name;assert(exported.has(name),rel+' missing export '+name+' from '+target);}
    }
  }
});
