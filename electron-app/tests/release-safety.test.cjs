'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Module=require('node:module');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const home=fs.readFileSync(path.join(root,'src/renderer/features/dashboard/home-dashboard.js'),'utf8');
const acorn=require('acorn');
const draftNode=acorn.parse(home,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_homeDayDraftSave');
const draftSource=home.slice(draftNode.start,draftNode.end);
function calendar(){
 let allowSave=true;
 const context=vm.createContext({
  console:{warn(){}},_localEvents:{},_requireHomeCalendar:async()=>true,
  _saveLocalEvents:async()=>allowSave,_homeSyncEventToCals:async()=>{},
  _homeSaveToast(){},renderHomeDashboard(){},_hcdListHtml(){return '';},
  document:{createElement(){return{dataset:{},setAttribute(){},remove(){}};},getElementById(){throw Error('Must not read another popup');}}
 });
 vm.runInContext(draftSource,context);
 function popup(title){
  const fields={hcdTitle:{value:title},hcdTime:{value:'09:30'},hcdMemo:{value:'test memo'}};
  const form={appendChild(){}};
  return{fields,_homeDraftId:null,querySelector(selector){
   if(selector==='.hcd-color-chip.selected')return{dataset:{color:'#22c55e'}};
   if(selector==='.school-calendar-day-form')return form;
   if(selector==='#hcdListWrap')return{innerHTML:''};
   return fields[selector.slice(1)]||null;
  }};
 }
 return{context,popup,setFailure:value=>{allowSave=!value;}};
}
test('calendar draft uses its own popup and snapshots rapid date changes',async()=>{
 const h=calendar(),a=h.popup('day A'),b=h.popup('day B');
 const first=h.context._homeDayDraftSave('2026-10-22',a);
 a.fields.hcdTitle.value='day A edited';
 const edited=h.context._homeDayDraftSave('2026-10-22',a);
 await Promise.all([first,edited,h.context._homeDayDraftSave('2026-10-23',b)]);
 assert.equal(h.context._localEvents['2026-10-22'].length,1);
 assert.equal(h.context._localEvents['2026-10-22'][0].title,'day A edited');
 assert.equal(h.context._localEvents['2026-10-23'][0].title,'day B');
});
test('failed calendar persistence keeps input, rolls back and retries once',async()=>{
 const h=calendar(),popup=h.popup('keep me');h.setFailure(true);
 assert.equal(await h.context._homeDayDraftSave('2026-10-22',popup),false);
 assert.equal(popup.fields.hcdTitle.value,'keep me');
 assert.equal(h.context._localEvents['2026-10-22'],undefined);
 h.setFailure(false);
 assert.equal(await h.context._homeDayDraftSave('2026-10-22',popup),true);
 assert.equal(h.context._localEvents['2026-10-22'].length,1);
});
test('unchanged calendar draft does not overwrite later list edits on close',async()=>{
 const h=calendar(),popup=h.popup('original');
 await h.context._homeDayDraftSave('2026-10-22',popup);
 h.context._localEvents['2026-10-22'][0].title='edited in list';
 await h.context._homeDayDraftSave('2026-10-22',popup);
 assert.equal(h.context._localEvents['2026-10-22'][0].title,'edited in list');
});
test('clearing the draft title removes only its own event',async()=>{
 const h=calendar(),popup=h.popup('draft');
 h.context._localEvents['2026-10-22']=[{id:'other',title:'keep other'}];
 await h.context._homeDayDraftSave('2026-10-22',popup);
 popup.fields.hcdTitle.value='';
 await h.context._homeDayDraftSave('2026-10-22',popup);
 assert.equal(h.context._localEvents['2026-10-22'].length,1);
 assert.equal(h.context._localEvents['2026-10-22'][0].id,'other');
});
test('installer preserves legacy install and data folders',()=>{
 const source=fs.readFileSync(path.join(root,'build/installer.nsh'),'utf8');
 const code=source.split(/\r?\n/).filter(s=>!s.trim().startsWith(';')).join('\n');
 assert.doesNotMatch(code,/SafeCleanInstallLocation|ReadRegStr|ExecWait|DeleteRegKey|UninstallString/);
 assert.doesNotMatch(code,/RMDir\s+\/r\s+"\$SMPROGRAMS/);
 for(const line of code.split('\n').filter(x=>/RMDir\s+\/r/i.test(x))){
  assert.match(line,/^\s*RMDir \/r "\$LOCALAPPDATA\\(?:OrangeTalk|OrangePharmDiary|OrangefarmDiary|MyHealthDiary)-updater"\s*$/);
 }
});
test('actual SQLite preserves composite treatment and rejects missing updates',()=>{
 const code=[
  "const assert=require('node:assert/strict');",
  "const {HealthDiaryDB}=require("+JSON.stringify(path.join(root,'src/main/services/database.js'))+");",
  "const {HealthRecordDBService}=require("+JSON.stringify(path.join(root,'src/main/services/health-record-db-service.js'))+");",
  "const db=new HealthDiaryDB(':memory:'),svc=new HealthRecordDBService(db);",
  "try{",
  "const row={school_year:'2026',date:'2026-10-06',timeIn:'09:00',personUid:'synthetic',symptoms:['test'],treatment:['composite (A, B)','rest']};",
  "const first=svc.insertDaily(row);assert.equal(first.success,true);assert.equal(svc.updateDaily({...row,id:first.id,memo:'changed'}).success,true);",
  "assert.deepEqual(svc.getDailyByPerson('synthetic')[0].treatment,row.treatment);",
  "assert.equal(svc.updateEmergency({id:999999}).success,false);assert.equal(svc.updateInfection({id:999999}).success,false);",
  "for(const receptionId of ['simple','test_%_quote\"\\\\id']){const payload={...row,extra_json:JSON.stringify({fromKiosk:true,receptionId})};const a=svc.insertDaily(payload),b=svc.insertDaily(payload);assert.equal(a.success,true);assert.equal(b.reason,'already_handled');assert.equal(a.id,b.id);}",
  "}finally{db.close();}"
 ].join('\n');
 const result=spawnSync(require('electron'),['-e',code],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
for(const [name,exportName,windowName] of [
 ['kiosk-reception-runtime','kioskReceptionRuntimeSource','sendReception'],
 ['kiosk-call-audio','kioskCallRuntimeSource','fdOpenCallSettings']
]){
 test('release transformation keeps standalone '+name+' self-contained',()=>{
  const script=[
   "const fs=require('node:fs'),vm=require('node:vm'),Module=require('node:module'),path=require('node:path');",
   "const root="+JSON.stringify(root)+";",
   "const filename="+JSON.stringify(path.join(os.tmpdir(),'school-obfuscation-test-'+process.pid,'scripts','obfuscate.js'))+";",
   "const build=new Module(filename,module);build.filename=filename;build.paths=Module._nodeModulePaths(root);build._compile(fs.readFileSync(path.join(root,'scripts/obfuscate.js'),'utf8'),filename);",
   "const relative="+JSON.stringify('src/renderer/features/kiosk/'+name+'.js')+";",
   "if(build.exports.obfuscationOptions(relative.replaceAll('/', '\\\\')).stringArray!==false)throw Error('Windows filename policy missing');",
   "(async()=>{",
   "const code=build.exports.obfuscateJs(fs.readFileSync(path.join(root,relative),'utf8'),relative);",
   "const mod=new vm.SourceTextModule(code);await mod.link(()=>new vm.SyntheticModule(['KIOSK_CHIME_RECORDINGS'],function(){this.setExport('KIOSK_CHIME_RECORDINGS',{});}));await mod.evaluate();",
   "const document={addEventListener(){},removeEventListener(){},getElementById(){return null;},querySelector(){return null;}};",
   "const window={document,addEventListener(){},removeEventListener(){}};",
   "vm.runInNewContext(mod.namespace["+JSON.stringify(exportName)+"]({preview:true,channelId:'synthetic',callAudio:{chime:'classic'}}),{window,document,console,setTimeout,clearTimeout,setInterval,clearInterval},{timeout:2000});",
   "if(typeof window["+JSON.stringify(windowName)+"]!=='function')throw Error('Standalone runtime missing');",
   "})().catch(error=>{console.error(error);process.exitCode=1;});"
  ].join('\n');
  const result=spawnSync(process.execPath,['--experimental-vm-modules','-e',script],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 });
}


test('release packaging excludes design tools and transforms each source only once',()=>{
 const code=fs.readFileSync(path.join(root,'scripts/obfuscate.js'),'utf8');
 const tree=acorn.parse(code,{ecmaVersion:'latest',sourceType:'script'});
 const declaration=tree.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).find(n=>n.id.name==='MAIN_JS_FILES');
 assert.ok(declaration);assert.deepEqual(declaration.init.elements.map(n=>n.value),['main.js','preload.js']);
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.ok(pkg.build.files.includes('!templates/search-ui-mockup.html'));
 assert.ok(pkg.build.files.includes('!web-server/build-dist.js'));
});
