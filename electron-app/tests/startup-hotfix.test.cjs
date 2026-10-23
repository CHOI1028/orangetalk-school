'use strict';
// Only synthetic temporary files and isolated renderer functions are used.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const acorn=require('acorn');
const root=process.env.HOTFIX_APP_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const parse=s=>acorn.parse(s,{ecmaVersion:'latest',sourceType:'module'});
const diary=read('src/renderer/features/settings/settings-tab-diary.js');
const symptom=read('src/renderer/features/symptom/symptom-view.js');
const preload=read('preload.js'),conn=read('src/renderer/features/shell/conn-toast.js');
const {JsonFileService}=require(path.join(root,'src/main/services/file-service.js'));
const clone=v=>JSON.parse(JSON.stringify(v));
const quiet={log(){},info(){},warn(){},error(){}};
function find(code,name){const node=parse(code).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).find(n=>n?.id?.name===name||n?.declarations?.some(d=>d.id.name===name));assert(node,'Missing declaration '+name);return code.slice(node.start,node.end);}
function walk(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const v of Object.values(node)){if(Array.isArray(v))v.forEach(n=>walk(n,fn));else if(v&&typeof v==='object')walk(v,fn);}}
const bridgeCode={};walk(parse(preload),n=>{const k=n.key?.name;if(n.type==='Property'&&['jsonLoadCommon','jsonSaveCommon'].includes(k)&&n.value.type==='ArrowFunctionExpression'&&!bridgeCode[k])bridgeCode[k]=preload.slice(n.value.start,n.value.end);});
function medicationHarness(options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orangetalk-synthetic-1117-'));
 const service=new JsonFileService(dir),initial={items:{SYNTHETIC_OLD:{itemName:'SYNTHETIC_OLD',efcyQesitm:'SYNTHETIC_ONLY'}},order:['SYNTHETIC_OLD']};
 service.saveCommon('medications_list',initial);
 const original=fs.readFileSync(service.commonPath('medications_list'),'utf8');
 const local=new Map(),timers=[],calls=[],elements=new Map();let fetches=0;
 const document={getElementById:id=>elements.get(id)||null,createElement:()=>({className:'',textContent:'',style:{}}),body:{appendChild:el=>elements.set(el.id,el)}};
 const invoke=async(channel,payload)=>{
  assert.equal(typeof payload.key,'string','IPC key must be a string');assert.equal(payload.key,'medications_list');calls.push({channel,key:payload.key,data:payload.data});
  if(channel==='json-load-common'){if(options.readFail)return {success:false,error:'SYNTHETIC_READ_FAILURE'};return {success:true,...service.loadCommon(payload.key)};}
  assert.equal(channel,'json-save-common');
  if(options.saveFail)return {success:false,error:'SYNTHETIC_WRITE_FAILURE'};
  try{return {success:true,path:service.saveCommon(payload.key,clone(payload.data))};}catch(e){return {success:false,error:e.message};}
 };
 const api={externalFetchDrugInfo:async()=>{fetches++;if(options.networkFail)return {success:false,error:'SYNTHETIC_NETWORK_FAILURE'};return {success:true,data:{itemName:'SYNTHETIC_NEW',efcyQesitm:'SYNTHETIC_ONLY',useMethodQesitm:'SYNTHETIC_ONLY'}};}};
 for(const [name,code]of Object.entries(bridgeCode))api[name]=new Function('ipcRenderer','return ('+code+')')({invoke});
 const context=vm.createContext({window:{electronAPI:api},document,console:quiet,Date,Promise,setTimeout:(fn,ms)=>{const timer={fn,ms,active:true};timers.push(timer);return timer;},clearTimeout:t=>{if(t)t.active=false;},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v))},getPublicDataApiKey:()=> 'SYNTHETIC_KEY_NOT_REAL'});
 const names=['_EYAKEY_QUEUE_KEY','_eyakeyQueueLoad','_eyakeyQueueSave','_eyakeyQueueAdd','_eyakeyQueueRemove','_fetchAndCacheDrugFromEyakey'];
 vm.runInContext(names.map(n=>find(diary,n)).join('\n'),context);
 return {dir,service,initial,original,local,timers,calls,api,context,options,fetches:()=>fetches,run:s=>vm.runInContext(s,context),disk:()=>JSON.parse(fs.readFileSync(service.commonPath('medications_list'),'utf8')),toast:()=>elements.get('globalSaveToast')?.textContent||''};
}
test('all medication JSON callers use the shipped positional preload contract',()=>{
 for(const source of [diary,symptom])walk(parse(source),n=>{if(n.type==='CallExpression'&&['jsonLoadCommon','jsonSaveCommon'].includes(n.callee.property?.name)){assert.notEqual(n.arguments[0]?.type,'ObjectExpression');if(n.callee.property.name==='jsonSaveCommon')assert(n.arguments.length>=2);}});
});
test('startup retry stores drug details and preserves earlier cache entries',async()=>{
 const h=medicationHarness();h.run('_eyakeyQueueAdd("SYNTHETIC_NEW")');
 const boot=parse(diary).body.find(n=>n.type==='ExpressionStatement'&&n.expression.callee?.id?.name==='_resumeEyakeyQueueOnBoot');assert(boot);h.run(diary.slice(boot.start,boot.end));
 const timer=h.timers.find(t=>t.ms===3000);assert(timer);timer.fn();for(let i=0;i<4;i++)await new Promise(setImmediate);
 assert(h.disk().items.SYNTHETIC_NEW);assert.deepEqual(h.disk().items.SYNTHETIC_OLD,h.initial.items.SYNTHETIC_OLD);
 assert.deepEqual(clone(h.run('_eyakeyQueueLoad()')),[]);assert(!h.toast().includes('실패'));assert.equal(h.fetches(),1);
 const load=h.service.loadCommon('medications_list');assert(load.exists);assert(load.data.items.SYNTHETIC_NEW);
});
test('already cached drug is not fetched again on restart',async()=>{const h=medicationHarness();await h.run('_fetchAndCacheDrugFromEyakey("SYNTHETIC_OLD")');assert.equal(h.fetches(),0);assert.deepEqual(h.disk(),h.initial);assert.deepEqual(clone(h.run('_eyakeyQueueLoad()')),[]);});
for(const mode of ['readFail','saveFail','networkFail'])test(mode+' retains retry work and existing data',async()=>{
 const h=medicationHarness({[mode]:true});await h.run('_fetchAndCacheDrugFromEyakey("SYNTHETIC_NEW")');assert.deepEqual(h.disk(),h.initial);assert.deepEqual(clone(h.run('_eyakeyQueueLoad()')),['SYNTHETIC_NEW']);assert(!h.toast().includes('등재 완료'));if(mode==='readFail'){assert.equal(h.fetches(),0);assert.equal(h.calls.filter(c=>c.channel==='json-save-common').length,0);}
 h.options[mode]=false;await h.run('_fetchAndCacheDrugFromEyakey("SYNTHETIC_NEW")');assert(h.disk().items.SYNTHETIC_NEW);assert.deepEqual(clone(h.run('_eyakeyQueueLoad()')),[]);
});
test('new cache creates correct file, never an object-named JSON file',async()=>{const h=medicationHarness();fs.renameSync(h.service.commonPath('medications_list'),path.join(h.dir,'synthetic-original-preserved.json'));await h.run('_fetchAndCacheDrugFromEyakey("SYNTHETIC_NEW")');assert(h.disk().items.SYNTHETIC_NEW);assert(!fs.existsSync(path.join(h.dir,'data','[object Object].json')));});
test('automatic popup cache only clears pending work after a successful write',async()=>{
 const h=medicationHarness({saveFail:true});h.run(['_persistDrugTimer','_pendingDrugUpsert','_persistDrugToUserJson'].map(n=>find(symptom,n)).join('\n'));
 h.run('_persistDrugToUserJson("SYNTHETIC_NEW",{itemName:"SYNTHETIC_NEW"})');h.timers.find(t=>t.ms===600&&t.active).fn();for(let i=0;i<4;i++)await new Promise(setImmediate);
 assert(h.run('!!_pendingDrugUpsert.SYNTHETIC_NEW'));assert.deepEqual(h.disk(),h.initial);h.options.saveFail=false;
 h.run('_persistDrugToUserJson("SYNTHETIC_NEW",{itemName:"SYNTHETIC_NEW"})');h.timers.filter(t=>t.ms===600&&t.active).at(-1).fn();for(let i=0;i<4;i++)await new Promise(setImmediate);
 assert.equal(h.run('Object.keys(_pendingDrugUpsert).length'),0);assert(h.disk().items.SYNTHETIC_OLD);assert(h.disk().items.SYNTHETIC_NEW);
});
test('bulk final/intermediate writes check success before completion',()=>{
 const source=find(diary,'_setMedBulkFetchStart'),ast=parse(source);let saves=0;
 walk(ast,n=>{if(n.type==='AwaitExpression'&&n.argument.callee?.property?.name==='jsonSaveCommon')saves++;});assert.equal(saves,2);assert.equal((source.match(/if\(!saved\|\|saved\.success!==true\)/g)||[]).length,2);
});
function toastHarness(){
 let now=0,id=0;const timers=new Map(),listeners=new Map(),elements=new Map();
 const later=(fn,ms)=>{const key=++id;timers.set(key,{at:now+ms,fn});return key;};
 const document={body:{classList:{contains:()=>true},appendChild:el=>elements.set(el.id,el)},createElement:()=>({style:{},innerHTML:'',handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}})};
 const window={location:{port:'3000'},_connState:{lastPort:3000},addEventListener:(name,fn)=>{listeners.set(name,fn);}};
 const context=vm.createContext({window,document,setTimeout:later,clearTimeout:key=>timers.delete(key),requestAnimationFrame:fn=>later(fn,16)});vm.runInContext(conn,context);
 function advance(ms){const target=now+ms;for(let i=0;i<2000;i++){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){now=target;return;}const [key,t]=next;timers.delete(key);now=t.at;t.fn();}throw Error('Timer loop');}
 return {emit:(name,detail={})=>{assert(listeners.has(name),name);listeners.get(name)({detail});},advance,element:()=>elements.get('connToast'),visible:()=>elements.get('connToast')?.style.display==='block'&&elements.get('connToast')?.style.opacity==='1'};
}
for(const failure of ['conn:exhausted','conn:all_failed'])test(failure+' is replaced by confirmed recovery and hides',()=>{
 const h=toastHarness();h.emit(failure,{reason:'electron_no_fallback',triedPorts:[3000]});h.advance(20);assert(h.visible());assert(h.element().innerHTML.includes('실패'));
 h.emit('conn:restored');h.advance(20);assert(h.visible());assert(h.element().innerHTML.includes('복구'));h.advance(3300);assert(!h.visible());
});
test('one click dismisses a critical warning',()=>{const h=toastHarness();h.emit('conn:exhausted',{reason:'electron_no_fallback'});h.advance(20);h.element().handlers.click();h.advance(250);assert(!h.visible());});
test('queue flush cannot falsely clear an unresolved connection failure',()=>{const h=toastHarness();h.emit('conn:exhausted',{reason:'electron_no_fallback'});h.advance(20);h.emit('conn:queue-flushed');h.advance(4000);assert(h.visible());assert(h.element().innerHTML.includes('실패'));});
test('repeated retries do not resurrect after recovery',()=>{const h=toastHarness();h.emit('conn:lost');h.emit('conn:retrying',{failCount:2});h.emit('conn:restored');h.advance(10000);assert(!h.visible());});
test('new loss after recovery immediately replaces success and is not hidden by its timer',()=>{const h=toastHarness();h.emit('conn:restored');h.advance(100);h.emit('conn:lost');h.advance(4000);assert(h.visible());assert(h.element().innerHTML.includes('재연결'));});
test('stop before a pending animation frame cannot resurrect a warning',()=>{const h=toastHarness();h.emit('conn:lost');h.emit('conn:stopped');h.advance(1000);assert(!h.visible());});
test('a pending hide animation cannot hide a newer failure',()=>{const h=toastHarness();h.emit('conn:restored');h.advance(3001);h.emit('conn:exhausted',{reason:'electron_no_fallback'});h.advance(500);assert(h.visible());assert(h.element().innerHTML.includes('실패'));});
test('new release metadata is consistent and retains existing Excel fixes',()=>{
 const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));assert.equal(pkg.version,'1.1.17');assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 const notes=read('src/renderer/features/shell/school-release-notes.js');const ctx=vm.createContext({});vm.runInContext(notes.replace(/^export /gm,'')+'\nglobalThis.notes=SCHOOL_RELEASE_NOTES;',ctx);assert.equal(ctx.notes[0].version,'1.1.17');assert(ctx.notes[0].changes.join(' ').includes('JSON'));assert(ctx.notes.find(n=>n.version==='1.1.16').changes.join(' ').includes('V/S'));
});
