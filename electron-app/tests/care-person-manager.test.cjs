'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/renderer/features/person-manager/person-manager-view.js'),'utf8');
const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const names=['_persistCare','_careSaveNotice','_careRefreshSaved','_apCareSave','_apCareDeleteConfirmed','_careImportChanges','_careApplyToStudent','_apCmMatchToStudent','_carePendingRow','_applyCareRows','_apCareBulkProcess','_showCareCompareGUI'];
const selected=names.map(name=>{const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}).join('\n');
const helper=fs.readFileSync(path.join(root,'src/renderer/core/care-registration.js'),'utf8').replace(/^export /gm,'');
const sample=(uid,extra={})=>({uid,id:uid,type:'student',name:'가상'+uid,grade:1,cls:1,num:1,level:'초',department:'',is_enrolled:1,is_care:1,care_reason:'OLD',condition:'OLD',dust_disease:'DUST',dustDisease:'DUST',care_memo:'MEMO',careMemo:'MEMO',status:'caution',guardianContact:'SYNTHETIC_CONTACT',...extra});
function harness(options={}){
  const people=(options.people||[sample('A')]).map(s=>({...s}));
  const rows=new Map(people.map(s=>[s.uid,{...s}])),writes=[],messages=[],pending=[],removed=[],events=[],confirmed=[];
  const elements={apCareReason:{value:options.reason==null?'NEW':options.reason},apCareDust:{value:options.dust==null?'DUST':options.dust},apCareMemo:{value:options.memo==null?'':options.memo},globalSaveToast:{},apCareBody:{dataset:{careStudentId:'A'},innerHTML:'EDIT FORM'},apCareBulkMsg:{}};
  const api={studentsUpsert:async(payload,year)=>{
    writes.push({payload:JSON.parse(JSON.stringify(payload)),year});
    if(options.respond){const r=await options.respond(payload,year);if(r!==undefined)return r;}
    const row=rows.get(payload.uid);if(!row)return {success:false};
    if(payload._clearCare)Object.assign(row,{is_care:0,care_reason:'',dust_disease:'',care_memo:''});
    else{for(const key of ['care_reason','dust_disease','care_memo'])if(Object.hasOwn(payload,key))row[key]=payload[key];if(Object.hasOwn(payload,'care_reason'))row.is_care=payload.care_reason.trim()?1:0;}
    return {success:true,uid:payload.uid,care:{is_care:row.is_care,care_reason:row.care_reason,dust_disease:row.dust_disease,care_memo:row.care_memo}};
  }};
  const context=vm.createContext({S:{people},window:{electronAPI:options.unavailable?undefined:api},
    _academicYear:()=>2026,_apCareMode:'add',_apCmState:null,_careBulkSaving:false,
    getStu:id=>context.S.people.find(s=>String(s.uid)===String(id))||{_notFound:true},
    document:{getElementById:id=>elements[id]||null},
    bus:{emit:(event,value)=>{events.push(event);if(event==='toast:show')messages.push(value.text);}},
    _apCareRefreshLists:()=>events.push('refresh'),_apCareRenderUnmatched:()=>{},
    _careUnmatchedAdd:rows=>pending.push(...rows),_careUnmatchedRemove:key=>removed.push(key),
    _careUnmatchedRowKey:row=>JSON.stringify([row.name,row.careReason,row.dustDisease,row.memo]),
    _apConfirm:value=>confirmed.push(value),escHtml:value=>String(value),
    _apCmAdvanceOrClose:()=>events.push('advance'),alert:value=>messages.push(value),
    normalizeClassInput:value=>String(value==null?'':value).trim().replace(/반$/,''),
    _normHeader:value=>String(value).replace(/\s/g,''),
    parseXLSXTable:()=>options.table,
    FileReader:class{readAsArrayBuffer(){this.onload({target:{result:new ArrayBuffer(0)}});}},
    saveData:()=>{throw Error('Must not save full roster');},saveStudents:()=>{throw Error('Must not save full roster');}
  });
  vm.runInContext(helper+'\n'+selected,context);
  return {context,people,rows,writes,messages,pending,removed,events,confirmed,elements};
}
for(const action of ['_apCareSave','_apCareDeleteConfirmed']){
  for(const reject of [false,true])test(action+' retains student and form on '+(reject?'rejection':'false acknowledgement'),async()=>{
    const h=harness({respond:async()=>{if(reject)throw Error('SYNTHETIC_DETAIL');return {success:false,error:'SYNTHETIC_DETAIL'};}}),before=structuredClone(h.people);
    await h.context[action]('A');
    assert.deepEqual(h.people,before);assert.equal(h.elements.apCareBody.innerHTML,'EDIT FORM');
    assert.equal(h.confirmed.length,0);assert.equal(h.events.includes('refresh'),false);
    assert.ok(h.messages.some(m=>m.includes('저장하지 못')));assert.ok(h.messages.every(m=>!m.includes('SYNTHETIC_DETAIL')));
  });
}
test('individual save waits, sends exact UID and care-only fields, and prevents double submission',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  const h=harness({people:[sample('A',{num:0})],respond:()=>wait});
  const before=structuredClone(h.people);const p=h.context._apCareSave('A');await h.context._apCareSave('A');
  assert.deepEqual(h.people,before);assert.equal(h.writes.length,1);assert.equal(h.confirmed.length,0);
  assert.deepEqual(h.writes[0].payload,{uid:'A',_careOnly:true,care_reason:'NEW',dust_disease:'DUST',care_memo:''});
  release();await p;assert.equal(h.people[0].care_reason,'NEW');assert.equal(h.people[0].guardianContact,'SYNTHETIC_CONTACT');assert.equal(h.confirmed.length,1);
});
test('blank reason clears reason while retaining dust and explicit blank memo',async()=>{
  const h=harness({reason:'',memo:''});await h.context._apCareSave('A');
  assert.equal(h.people[0].condition,'');assert.equal(h.people[0].is_care,0);assert.equal(h.people[0].dustDisease,'DUST');assert.equal(h.people[0].careMemo,'');
});
test('save updates current roster object even when an SSE refresh replaced it while pending',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const h=harness({respond:()=>wait});
  const p=h.context._apCareSave('A');const replacement={...h.people[0],guardianContact:'NEW_CONTACT'};h.context.S.people=[replacement];
  release();await p;assert.equal(replacement.condition,'NEW');assert.equal(replacement.guardianContact,'NEW_CONTACT');
});
test('successful deletion does not clear another student editing form',async()=>{
  const h=harness();h.elements.apCareBody.dataset.careStudentId='B';await h.context._apCareDeleteConfirmed('A');
  assert.equal(h.people[0].condition,'');assert.equal(h.people[0].dustDisease,'');assert.equal(h.elements.apCareBody.innerHTML,'EDIT FORM');
});
function importRow(student,extra={}){return {name:student.name,grade:student.grade,cls:student.cls,num:student.num,level:student.level,department:student.department,careReason:'IMPORTED',dustDisease:'',memo:'',found:student,...extra};}
test('bulk import counts only acknowledged saves, keeps failures, and retry avoids resending success',async()=>{
  let fails=true;const h=harness({people:[sample('A'),sample('B')],respond:async p=>p.uid==='B'&&fails?{success:false}:undefined});
  const parsed=h.people.map(s=>importRow(s));
  let result=await h.context._applyCareRows(parsed);
  assert.equal(result.matched,1);assert.equal(result.failed,1);assert.equal(result.success,false);
  assert.equal(h.people[1].condition,'OLD');assert.equal(h.pending.length,1);assert.match(h.elements.apCareBulkMsg.textContent,/1명 저장 실패/);
  fails=false;result=await h.context._applyCareRows(parsed);
  assert.equal(result.success,true);assert.equal(result.matched,2);assert.deepEqual(h.writes.map(w=>w.payload.uid),['A','B','B']);
  assert.equal(h.people[1].dustDisease,'DUST');assert.equal(h.people[1].guardianContact,'SYNTHETIC_CONTACT');
});
test('bulk import never turns empty cells into deletion',async()=>{
  const h=harness();await h.context._applyCareRows([importRow(h.people[0])]);
  assert.deepEqual(h.writes[0].payload,{uid:'A',_careOnly:true,care_reason:'IMPORTED'});
  assert.equal(h.people[0].dustDisease,'DUST');assert.equal(h.people[0].careMemo,'MEMO');
});
test('bulk import does not apply a stale match after roster identity changed',async()=>{
  const h=harness();const row=importRow(h.people[0]);h.context.S.people=[sample('B',{name:h.people[0].name})];
  const r=await h.context._applyCareRows([row]);assert.equal(r.matched,0);assert.equal(r.unmatched,1);assert.equal(h.writes.length,0);
});
test('bulk repeated click does not launch a second write pass',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve),h=harness({respond:()=>wait});
  const rows=[importRow(h.people[0])],first=h.context._applyCareRows(rows);
  assert.equal((await h.context._applyCareRows(rows)).busy,true);assert.equal(h.writes.length,1);release();await first;
});
test('manual matching keeps pending item on save failure and removes it only after successful retry',async()=>{
  let fails=true;const h=harness({respond:async()=>fails?{success:false}:undefined});const cur=importRow(h.people[0]);let removes=0;
  const st={items:[cur],idx:0,waitForSave:true,onMatch:h.context._careApplyToStudent,onRemove:()=>removes++,refreshBanner:()=>{}};h.context._apCmState=st;
  await h.context._apCmMatchToStudent('A');assert.equal(st.items.length,1);assert.equal(removes,0);
  fails=false;await h.context._apCmMatchToStudent('A');assert.equal(removes,1);assert.equal(st.items.length,0);assert.equal(h.events.includes('advance'),true);
});
test('manual match completion cannot remove a different item after navigation or a new modal',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve),h=harness({respond:()=>wait}),cur=importRow(h.people[0]),other={name:'OTHER'};
  const removed=[];const st={items:[cur,other],idx:0,waitForSave:true,onMatch:h.context._careApplyToStudent,onRemove:x=>removed.push(x)};
  h.context._apCmState=st;const p=h.context._apCmMatchToStudent('A');st.idx=1;h.context._apCmState={items:[other],idx:0};release();await p;
  assert.deepEqual(removed,[cur]);assert.deepEqual(st.items,[other]);assert.equal(h.events.includes('advance'),false);
});
test('Excel parser trims names, uses school level/department, and refuses ambiguous or duplicate rows',()=>{
  const headers=['학교급','학과','학년','반','번호','이름','요보호 질환명','미세먼지 기저질환','메모'];
  const people=[sample('A',{name:' 가상학생 ',level:'elementary'}),sample('B',{name:'가상학생',level:'middle'})];
  const base={'학년':1,'반':'1반','번호':'01','이름':'가상학생','요보호 질환명':'LONG'.repeat(4000)};
  const h=harness({people,table:{headers,rows:[{...base,'학교급':'초'}]}});let parsed;
  h.context._showCareCompareGUI=(area,rows)=>parsed=rows;h.context._apCareBulkProcess({});
  assert.equal(parsed[0].found.uid,'A');assert.equal(parsed[0].careReason.length,16000);assert.equal(h.writes.length,0);
  h.context.parseXLSXTable=()=>({headers,rows:[base]});h.context._apCareBulkProcess({});assert.equal(parsed[0].found,null);assert.equal(parsed[0].matchReason,'ambiguous');
  h.context.parseXLSXTable=()=>({headers,rows:[{...base,'학교급':'초'},{...base,'학교급':'초'}]});h.context._apCareBulkProcess({});
  assert.ok(parsed.every(row=>row.found===null&&row.matchReason==='duplicate-row'));
});
test('legacy add-person care path delegates to acknowledged care save without full roster save',()=>{
  assert.match(source,/if\(isCare\)\{[\s\S]*?return _apCareSave\(apCareStudentId\);/);
});

test('pending storage reports quota failure instead of silently marking rows preserved',()=>{
  const storageNames=['_careUnmatchedSet','_careUnmatchedAdd'];
  const storageCode=storageNames.map(name=>{const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(n.start,n.end);}).join('\n');
  let fails=true,saved;
  const context=vm.createContext({_careUnmatchedKey:()=> 'synthetic_pending',_careUnmatchedGet:()=>[],_careUnmatchedRowKey:row=>row.name,
    localStorage:{setItem:(key,value)=>{if(fails)throw Error('QUOTA');saved=JSON.parse(value);}}});
  vm.runInContext(storageCode,context);
  assert.equal(context._careUnmatchedAdd([{name:'SYNTHETIC'}]),false);
  fails=false;assert.equal(context._careUnmatchedAdd([{name:'SYNTHETIC'}]),true);assert.equal(saved.length,1);
});

function comparisonHarness(h){
  const buttons={};
  for(const name of ['cancel','confirm','match'])buttons[name]={events:{},addEventListener(event,fn){this.events[event]=fn;}};
  const area={innerHTML:'',style:{},querySelector:selector=>buttons[selector.match(/"([^"]+)"/)[1]]};
  h.context._ambHideTip=()=>{};h.context._ambShowTip=()=>{};
  h.context._apCareUnmatchedModal=()=>h.events.push('manual-modal');
  return {buttons,area};
}

test('manual matching closes the old comparison even when automatic saves partially fail',async()=>{
  const h=harness({respond:async()=>({success:false})}),ui=comparisonHarness(h);
  const pending={...importRow(h.people[0]),name:'UNKNOWN',found:null};
  h.context._showCareCompareGUI(ui.area,[importRow(h.people[0]),pending]);
  await ui.buttons.match.events.click();
  assert.equal(h.pending.length,2);assert.equal(ui.area.innerHTML,'');assert.equal(ui.area.style.display,'none');
  assert.equal(h.events.includes('manual-modal'),true);assert.equal(ui.buttons.confirm.disabled,false);
});

for(const action of ['confirm','match'])test('pending storage failure keeps comparison open on '+action,async()=>{
  const h=harness(),ui=comparisonHarness(h);h.context._careUnmatchedAdd=()=>false;
  h.context._showCareCompareGUI(ui.area,[{...importRow(h.people[0]),name:'UNKNOWN',found:null}]);
  await ui.buttons[action].events.click();
  assert.notEqual(ui.area.innerHTML,'');assert.equal(ui.area.style.display,'block');assert.equal(h.events.includes('manual-modal'),false);
  assert.match(h.elements.apCareBulkMsg.textContent,/임시 보관하지 못/);assert.equal(ui.buttons.confirm.textContent,'실패 항목 다시 시도');
});
