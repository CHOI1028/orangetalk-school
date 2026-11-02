'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),acorn=require('acorn');
const root=path.resolve(__dirname,'..');
function extract(file,names){const s=fs.readFileSync(path.join(root,file),'utf8'),nodes=acorn.parse(s,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n);return names.map(name=>{const n=nodes.find(n=>n?.id?.name===name||n?.declarations?.some(d=>d.id.name===name));assert(n,name);return s.slice(n.start,n.end);}).join('\n');}
const model=extract('src/renderer/core/emergency-record-model.js',['normalizeEmergencyRecord','mergeEmergencySnapshot','restoreEmergencyDrafts']);
const ctx=vm.createContext({});vm.runInContext(model,ctx);
const clean=x=>JSON.parse(JSON.stringify(x));
const draft=(extra={})=>({id:901,studentId:'SYNTHETIC_A',date:'2026-10-29',accidentInfo:{datetime:'2026-10-29 09:00'},clientRequestId:'SYNTHETIC_TOKEN',notes:'가상 미저장 기록',_dirty:true,...extra});
function storage(values){const m=new Map(Object.entries(values).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)]));return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k),setItem(){throw Error('Recovery must not write');},removeItem(){throw Error('Recovery must not delete');}};}
const restore=(values,db=[],live=[])=>ctx.restoreEmergencyDrafts(db,live,storage(values));

test('accident date overrides stale renderer date across school-year boundary',()=>{
 for(const date of ['2026-02-28','2026-03-01','2024-02-29','2027-01-01']){
  assert.equal(ctx.normalizeEmergencyRecord(draft({accidentInfo:{datetime:date+'T09:00'}})).date,date);
  assert.equal(ctx.normalizeEmergencyRecord({date:'2026-10-29',accidentDate:date}).date,date);
 }
});
test('normalization preserves explicit blank staff overrides and recorded V/S values',()=>{
 const r=ctx.normalizeEmergencyRecord({extra_json:JSON.stringify({displayGrade:'',displayGender:'',clientRequestId:'T',vitalsList:[{time:'09:00',bst:'120'}]})});
 assert.equal(r.displayGrade,'');assert.equal(r.displayGender,'');assert.equal(r.clientRequestId,'T');assert.equal(r.vitalsList[0].bst,'120');
});
test('failed insert draft is restored editable without writing or deleting the cache',()=>{
 const rows=restore({ec_form_draft_EC_901:draft({_saving:true,_inserting:true,_clinicalEditing:true})});
 assert.equal(rows.length,1);assert.equal(rows[0].notes,'가상 미저장 기록');assert.equal(rows[0]._dirty,true);assert.equal(rows[0]._draftRecovered,true);
 assert.equal(rows[0]._saving,undefined);assert.equal(rows[0]._inserting,undefined);assert.equal(rows[0]._clinicalEditing,undefined);
});
test('lost acknowledgement draft is matched to its durable identity, not inserted again',()=>{
 const rows=restore({ec_form_draft_EC_901:draft()},[{id:5,_dbId:5,personUid:'SYNTHETIC_A',clientRequestId:'SYNTHETIC_TOKEN',memo:'prior'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].id,5);assert.equal(rows[0]._dbId,5);assert.equal(rows[0].notes,'가상 미저장 기록');
});
test('old and assigned draft keys recover once with the latest input',()=>{
 const rows=restore({ec_form_draft_EC_901:draft({_draftSavedAt:1}),ec_form_draft_EC_5:draft({id:5,_dbId:5,_draftSavedAt:2,notes:'가상 최신 입력'})},[{id:5,studentId:'SYNTHETIC_A',clientRequestId:'SYNTHETIC_TOKEN'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].notes,'가상 최신 입력');assert.equal(rows[0]._recoveredDraftKeys.length,2);
});
test('provisional ID collision never overwrites another patient',()=>{
 const rows=restore({ec_form_draft_EC_901:draft()},[{id:901,personUid:'SYNTHETIC_B',memo:'가상 기존 기록'}]);
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.studentId==='SYNTHETIC_B').notes,'가상 기존 기록');
 const a=rows.find(r=>r.studentId==='SYNTHETIC_A');assert.notEqual(a.id,901);assert.equal(a._dbId,undefined);
});
test('conflicting cached durable identity cannot target another patient for update',()=>{
 const rows=restore({ec_form_draft_EC_5:draft({id:5,_dbId:5})},[{id:5,_dbId:5,personUid:'SYNTHETIC_B',clientRequestId:'SYNTHETIC_TOKEN',memo:'기존 다른 사람'}]);
 assert.equal(rows.length,2);const a=rows.find(r=>r.studentId==='SYNTHETIC_A'),b=rows.find(r=>r.studentId==='SYNTHETIC_B');
 assert.equal(a._dbId,undefined);assert.notEqual(a.id,b.id);assert.equal(b.notes,'기존 다른 사람');
});
test('unacknowledged live input wins a matching DB refresh even while IDs differ',()=>{
 const live=draft({_clinicalEditing:true,notes:'현재 편집값'});
 const rows=restore({ec_form_draft_EC_901:draft()},[{id:5,_dbId:5,personUid:'SYNTHETIC_A',clientRequestId:'SYNTHETIC_TOKEN',memo:'DB 이전값'}],[live]);
 assert.equal(rows.length,1);assert.equal(rows[0],live);assert.equal(rows[0].notes,'현재 편집값');
});
test('malformed and unrelated cache entries do not prevent saved rows loading',()=>{
 const rows=restore({ec_form_draft_EC_bad:'{',ec_form_draft_EC_empty:{id:2},ec_form_draft_INF_3:draft(),unrelated:draft()},[{id:6,personUid:'SYNTHETIC_A',memo:'DB'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].notes,'DB');assert.equal(rows[0]._draftRecovered,undefined);
});
test('unavailable localStorage leaves saved records available',()=>{
 const rows=ctx.restoreEmergencyDrafts([{id:5,personUid:'SYNTHETIC_A'}],[],{get length(){throw Error('SYNTHETIC_DISABLED_STORAGE');}});assert.equal(rows.length,1);
});
test('legacy failed update draft retains DB identity without a request token',()=>{
 const rows=restore({ec_form_draft_EC_5:draft({id:5,_dbId:5,clientRequestId:undefined})},[{id:5,personUid:'SYNTHETIC_A'}]);
 assert.equal(rows.length,1);assert.equal(rows[0]._dbId,5);assert.equal(rows[0]._dirty,true);
});
test('record deleted remotely is not silently reinserted from its draft',()=>{
 const rows=restore({ec_form_draft_EC_5:draft({id:5,_dbId:5})});assert.equal(rows[0]._dbId,5);
});
test('recovery does not mutate the DB input objects',()=>{
 const db=[{id:5,_dbId:5,personUid:'SYNTHETIC_A',clientRequestId:'SYNTHETIC_TOKEN',memo:'DB'}],before=clean(db);
 restore({ec_form_draft_EC_901:draft()},db);assert.deepEqual(db,before);
});
function printed(person,record){
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const c=vm.createContext({getStu:()=>person,getStuGradeCol:s=>s.position,isKinder:()=>false,hasMultipleSchoolLevels:()=>false,getLevelShort:()=>'',escHtml:escape,S:{}});
 vm.runInContext(model+'\n'+extract('src/renderer/features/emergency/emergency-view.js',['_ecHydrate','_ecPrintGradeStr','_buildPersonFileBase','_ecPrintDateShort','_ecPrintFileName','_ecBuildPrintHtml']),c);
 return c._ecBuildPrintHtml(record).split('<body>')[1];
}
test('staff print uses saved display overrides and preserves clinical values',()=>{
 const html=printed({type:'staff',position:'DIRECTORY_ROLE',gender:'DIRECTORY_GENDER',name:'가상 교직원'},draft({displayGrade:'SAVED_ROLE',displayGender:'SAVED_GENDER',treatment:'가상 처치',vitalsList:[{time:'09:00',bst:'120'}]}));
 assert(html.includes('SAVED_ROLE'));assert(html.includes('SAVED_GENDER'));assert(!html.includes('DIRECTORY_ROLE'));assert(!html.includes('DIRECTORY_GENDER'));assert(html.includes('가상 처치'));assert(html.includes('120'));
});
test('explicit blank staff print overrides do not reveal directory fallback',()=>{
 const html=printed({type:'staff',position:'DIRECTORY_ROLE',gender:'DIRECTORY_GENDER',name:'가상'},draft({displayGrade:'',displayGender:''}));assert(!html.includes('DIRECTORY_ROLE'));assert(!html.includes('DIRECTORY_GENDER'));
});
test('staff display values remain escaped in printable HTML',()=>{
 const html=printed({type:'staff',name:'가상'},draft({displayGrade:'<script>fake</script>',displayGender:'<b>fake</b>'}));assert(html.includes('&lt;script&gt;fake&lt;/script&gt;'));assert(!html.includes('<script>fake'));
});
test('student print continues to use directory identity',()=>{
 const html=printed({type:'student',grade:3,cls:2,num:7,gender:'STUDENT_GENDER',name:'가상'},draft({displayGrade:'STAFF_ONLY',displayGender:'STAFF_ONLY'}));assert(html.includes('STUDENT_GENDER'));assert(!html.includes('STAFF_ONLY'));
});
test('real SQLite exercises year changes and idempotent retry transactions',t=>{
 const {spawnSync}=require('node:child_process');const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_TEST_CONTEXT;
 const r=spawnSync(require('electron'),[path.join(__dirname,'fixtures/emergency-recovery-native.cjs')],{env,cwd:root,windowsHide:true,encoding:'utf8',timeout:60000});
 assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/# fail 0/);t.diagnostic(r.stdout.match(/# tests \d+/)?.[0]);
});
