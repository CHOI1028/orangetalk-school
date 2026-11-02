'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {HealthDiaryDB}=require('../../src/main/services/database');
const {HealthRecordDBService}=require('../../src/main/services/health-record-db-service');
function fixture(t){const db=new HealthDiaryDB(':memory:');t.after(()=>db.close());return {db,svc:new HealthRecordDBService(db),count:()=>db.db.prepare('SELECT COUNT(*) n FROM emergency_records').get().n};}
function record(extra={}){return {person_uid:'SYNTHETIC_A',person_type:'student',accident_date:'2026-10-29',treatment:'가상 처치',extra_json:JSON.stringify({clientRequestId:'SYNTHETIC_TOKEN',vitalsList:[{bst:'120'}]}),...extra};}
for(const [date,year]of [['2026-02-28','2025'],['2026-03-01','2026'],['2024-02-29','2023'],['2027-01-01','2026']])test('insert derives school year from accident date '+date,t=>{
 const h=fixture(t),r=h.svc.insertEmergency(record({accident_date:date,school_year:'1900'}));assert.equal(r.success,true);assert.equal(h.svc.getEmergencyByYear(year).length,1);assert.equal(h.svc.getEmergencyByYear('1900').length,0);
});
test('updating across March moves query membership while preserving contents',t=>{
 const h=fixture(t),r=record(),{id}=h.svc.insertEmergency(r);
 for(const [date,year,other]of [['2026-02-28','2025','2026'],['2026-03-01','2026','2025']]){
  assert.equal(h.svc.updateEmergency({...r,id,accident_date:date,school_year:other}).success,true);
  const rows=h.svc.getEmergencyByYear(year);assert.equal(rows.length,1);assert.equal(rows[0].treatment,'가상 처치');assert.equal(rows[0].vitalsList[0].bst,'120');assert.equal(h.svc.getEmergencyByYear(other).length,0);
 }
});
test('committed insert with lost response retries as one row with latest content',t=>{
 const h=fixture(t),first=h.svc.insertEmergency(record());
 const retry=h.svc.insertEmergency(record({treatment:'가상 재시도 최신 내용'}));
 assert.equal(retry.id,first.id);assert.equal(h.count(),1);assert.equal(h.svc.getEmergencyById(first.id).treatment,'가상 재시도 최신 내용');
});
test('request identity survives service restart and DB round trip',t=>{
 const h=fixture(t),first=h.svc.insertEmergency(record()),read=h.svc.getEmergencyById(first.id);assert.equal(read.clientRequestId,'SYNTHETIC_TOKEN');
 const retry=new HealthRecordDBService(h.db).insertEmergency(record());assert.equal(retry.id,first.id);assert.equal(h.count(),1);
});
test('same patient can intentionally create distinct records',t=>{
 const h=fixture(t);h.svc.insertEmergency(record());h.svc.insertEmergency(record({extra_json:JSON.stringify({clientRequestId:'DIFFERENT_TOKEN'})}));assert.equal(h.count(),2);
});
test('a request token for another patient cannot overwrite a committed record',t=>{
 const h=fixture(t),first=h.svc.insertEmergency(record()),result=h.svc.insertEmergency(record({person_uid:'SYNTHETIC_B',treatment:'CONFLICT'}));
 assert.equal(result.success,false);assert.equal(h.count(),1);assert.equal(h.svc.getEmergencyById(first.id).personUid,'SYNTHETIC_A');assert.equal(h.svc.getEmergencyById(first.id).treatment,'가상 처치');
});
test('legacy inserts without request tokens still create independent rows',t=>{
 const h=fixture(t);h.svc.insertEmergency(record({extra_json:'{}'}));h.svc.insertEmergency(record({extra_json:'{}'}));assert.equal(h.count(),2);
});
test('retry transaction rolls back on actual SQLite write failure',t=>{
 const h=fixture(t),first=h.svc.insertEmergency(record());h.db.db.pragma('query_only=ON');
 assert.throws(()=>h.svc.insertEmergency(record({treatment:'UNSAVED'})),/readonly/);assert.equal(h.count(),1);assert.equal(h.svc.getEmergencyById(first.id).treatment,'가상 처치');
 h.db.db.pragma('query_only=OFF');assert.equal(h.svc.insertEmergency(record({treatment:'RETRIED'})).id,first.id);assert.equal(h.count(),1);
});
test('missing durable row returns failure rather than silently creating it',t=>{
 const h=fixture(t);const result=h.svc.updateEmergency({...record(),id:999});assert.equal(result.success,false);assert.equal(h.count(),0);
});
