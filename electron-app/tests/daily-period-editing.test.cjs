/* Synthetic records only: exercise the real shared rows, lookup and UPDATE path. */
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {install,section,read}=require('./helpers/daily-row-harness.cjs');
const escHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const record=(id,extra={})=>({id,_dbId:id,studentId:'student-'+id,personUid:'student-'+id,date:'2025-02-10',timeIn:'10:00',timeOut:'10:10',symptoms:['두통'],treatment:['보건교육'],treatmentBySym:{},...extra});
function harness(records=[]){
 const updates=[],inserts=[];
 const context=vm.createContext({S:{records,settings:{schoolLevel:'elementary'},_vipTags:{}},structuredClone,escHtml,
  window:{electronAPI:{recordsDailyUpdate:row=>{updates.push(structuredClone(row));return Promise.resolve({success:true});},recordsDailyInsert:row=>{inserts.push(row);throw Error('Must not insert historical visits');}}},
  bus:{emit(){}},console,Date,
  getStu:id=>({id,name:'검증 학생',type:'student',grade:6,cls:2,num:22,gender:'남'}),
 });
 install(context);
 vm.runInContext(section(read('src/renderer/core/data-loader.js'),'export function saveRecordNow(rec){','/* 전역 삭제 완료'),context);
 return {context,updates,inserts,records};
}
test('date and period rows use identical markup except the sequence/date cell',()=>{
 const h=harness();const rows=[record(1,{symptoms:['두통','어지러움'],treatmentBySym:{'두통':['안정'],'어지러움':['투약']},medsBySym:{'어지러움':['검증약']},medDosesBySym:{'어지러움':{'검증약':'1T'}}})];
 const normal=h.context.renderDailyRecordRows(rows);
 const period=h.context.renderDailyRecordRows(rows,{period:true});
 assert.equal(period.replace('>2025-02-10</td>','>1</td>'),normal);
 assert.match(period,/class="tag /);assert.match(period,/class="treat-tag"/);assert.match(period,/multi-layer/);
 assert.match(period,/검증약 \(1T\)/);assert.match(period,/data-action="openSymptom" data-rid="1"/);
 assert.match(period,/data-col-index="3"/);assert.match(period,/data-col-index="5"/);assert.match(period,/data-col-index="14"/);
});
test('opening another school year does not alter the current list, and preserves database identity',()=>{
 const current=record(10,{date:'2026-09-30'}),h=harness([current]),past=record(1);
 const editable=h.context.preparePeriodRecord(past);
 assert.notStrictEqual(editable,past);assert.strictEqual(h.context.getDailyRecord(1),editable);
 assert.deepEqual(h.records,[current]);assert.equal(editable._dbId,1);assert.equal(editable.date,'2025-02-10');
});
test('a current loaded visit uses the existing editable object instead of a duplicate',()=>{
 const current=record(3),h=harness([current]);
 assert.strictEqual(h.context.preparePeriodRecord(structuredClone(current)),current);
 assert.equal(h.context.getPeriodEditRecords().length,0);
});
test('temporary id collisions, different dates, missing ids and deleted rows cannot enter the editor',()=>{
 for(const live of [record(3,{_dbId:undefined,_inserting:true}),record(3,{date:'2024-01-01'}),record(3,{_deleted:true})]){
  assert.equal(harness([live]).context.preparePeriodRecord(record(3)),null);
 }
 const h=harness();assert.equal(h.context.preparePeriodRecord(record(1,{_dbId:undefined})),null);
 assert.equal(h.context.preparePeriodRecord(record(1,{_deleted:true})),null);
 assert.equal(h.context.preparePeriodRecord(record(1,{_dbId:2})),null);
});
test('past-year counseling uses the existing editor save and updates the original row, never inserts',async()=>{
 const h=harness([record(99,{date:'2026-09-30'})]);
 const rec=h.context.preparePeriodRecord(record(1,{treatmentMemo:'원래 메모',bodymapData:[{symptom:'두통',label:'이마'}],medsBySym:{'두통':['검증약']},medDosesBySym:{'두통':{'검증약':'1T'}},counselLog:{treatmentText:'원래 처치 문구'}}));
 const values={content:'첫 줄\n다음 줄',action:'지도 내용',plan:'',opinion:''};
 Object.assign(h.context,{document:{querySelector:()=>({querySelectorAll:()=>Object.entries(values).map(([clField,value])=>({dataset:{clField},value}))})},
  _symCounselLogOf:r=>r.counselLog,_symSelectedSymptoms:['학업'],_symIsCounselSym:()=>true,_symBaseName:s=>s});
 vm.runInContext(section(read('src/renderer/features/symptom/symptom-view.js'),'function _symCounselSaveNow(recId){','function _symCounselQueueSave('),h.context);
 h.context._symCounselSaveNow(1);await Promise.resolve();
 assert.equal(h.updates.length,1);assert.equal(h.inserts.length,0);
 const row=h.updates[0];assert.equal(row.id,1);assert.equal(row.school_year,'2024');assert.equal(row.visit_date,'2025-02-10');
 assert.equal(row.person_uid,'student-1');assert.equal(row.time_in,'10:00');
 const extra=JSON.parse(row.extra_json);assert.equal(extra.counsel_log.content,values.content);assert.equal(extra.treatment_memo,'원래 메모');
 assert.equal(extra.med_doses_by_sym['두통']['검증약'],'1T');assert.equal(JSON.parse(row.bodymap_json)[0].label,'이마');
 assert.equal(rec.counselLog.treatmentText,'원래 처치 문구');assert.equal(h.records.length,1);
 assert.equal(h.records[0].id,99);
});
test('past-year time changes use UPDATE and retain the visit date and school year',async()=>{
 const h=harness();h.context.preparePeriodRecord(record(4));
 Object.assign(h.context,{timePickerState:{recId:4,field:'timeOut',originalVal:'10:10'},document:{getElementById:()=>({value:'10:25'})},_tpClampOut:(_r,_f,v)=>v,saveData(){}});
 vm.runInContext(section(read('src/renderer/features/daily/diary-print-view.js'),'function tpAutoSave(){','function tpShiftTime('),h.context);
 h.context.tpAutoSave();await Promise.resolve();
 assert.equal(h.updates[0].time_out,'10:25');assert.equal(h.updates[0].visit_date,'2025-02-10');assert.equal(h.updates[0].id,4);assert.equal(h.inserts.length,0);
});
test('pending edits survive reopening, stale clean snapshots can refresh, and deleted records cannot save again',()=>{
 const h=harness(),first=h.context.preparePeriodRecord(record(5));first._dirty=true;first.treatmentMemo='작성 중';
 assert.strictEqual(h.context.preparePeriodRecord(record(5,{treatmentMemo:'과거 DB 값'})),first);
 first._dirty=false;first._savedAt=Date.now()-8000;
 const fresh=h.context.preparePeriodRecord(record(5,{treatmentMemo:'새 DB 값'}));assert.equal(fresh.treatmentMemo,'새 DB 값');
 fresh._deleted=true;assert.equal(h.context.getDailyRecord(5),null);h.context.saveRecordNow(fresh);assert.equal(h.updates.length,0);
});
