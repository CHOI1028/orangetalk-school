'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convert, birthValue, snapshotDatabase } = require('../src/main/services/industry-migration');
const origin = '00000000-0000-4000-8000-000000000001';
function snapshot() {
  return {
    students: [{ uid:'s1', name:'가상학생', birth_date:'', gender:'여' }],
    students_info: [{ uid:'s1', school_year:'2025', grade:1, class_num:2, student_num:3 }, { uid:'s1', school_year:'2026', grade:2, class_num:1, student_num:5 }],
    staff: [{ uid:'t1', name:'가상교직원', birth_date:'19800304', position:'직원' }],
    daily_records: [{ id:1, school_year:'2025', person_type:'student', person_uid:'s1', visit_date:'2025-04-01', symptoms:'["두통"]', treatment:'["안정"]', medication:'가상약 1정', extra_json:'{"treatment_memo":"가상 설명"}' },
      { id:2, school_year:'2026', person_type:'staff', person_uid:'t1', visit_date:'2026-04-01' }],
    counseling_records: [{ id:1, person_type:'student', person_uid:'s1', content:'가상상담' }],
    emergency_records: [{ id:1, person_type:'staff', person_uid:'t1', accident_date:'2026-04-01', accident_time:'09:00', situation:'가상상황' }],
    infection_records: [{ id:1, person_type:'student', person_uid:'s1', disease_name:'가상질병', onset_date:'2026-05-01' }]
  };
}
test('all years and cross-table identities survive with empty births, normalized dates and preserved source detail', () => {
  const input=snapshot(), before=JSON.stringify(input), result=convert(input,origin);
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.data.subjects.length,2);
  assert.equal(result.data.journals.length,2);
  assert.equal(result.data.subjects[0].birth,'');
  assert.equal(result.data.subjects[1].birth,'1980-03-04');
  assert.equal(result.migration.missingBirth,1);
  assert.equal(result.data.journals[1].subjectId,result.data.subjects[1].id);
  // No medication chip: the school visit history hides stale medication data.
  assert.equal(result.data.journals[0].treatment, '안정 / 가상 설명');
  assert.equal(JSON.parse(result.data.journals[0].schoolOriginal).medication, '가상약 1정');
  assert.deepEqual(result.data.journals[0].medications,[]);
  assert.deepEqual(JSON.parse(result.data.journals[0].schoolOriginal),input.daily_records[0]);
  assert.ok(result.data.subjects[0].etc.includes('2025'));
});
test('staff filter exports staff and linked records only', () => {
  const result=convert(snapshot(),origin,'staff');
  assert.equal(result.data.subjects.length,1);
  assert.equal(result.data.journals.length,1);
  assert.equal(result.data.counselings.length,0);
  assert.equal(result.data.emergencies.length,1);
});
test('orphan records block export with count instead of silently dropping data', () => {
  const input=snapshot(); input.daily_records[0].person_uid='missing';
  assert.throws(()=>convert(input,origin),/1건/);
});
test('unknown birth values never become a fabricated date', () => {
  for(const value of ['',null,'미상','1990-02-30','9999','2026-13-01']) assert.equal(birthValue(value),'');
  assert.equal(birthValue('1984'),'1984');
});

test('dotted birthdays normalize without changing the school original or requiring correction', () => {
  for (const value of ['2019.03.20', '2019.03.20.', ' 2019. 3. 20. ', '2019-03-20', '20190320']) {
    const input = snapshot();
    input.students[0].birth_date = value;
    const result = convert(input, origin);
    const person = result.data.subjects[0];
    assert.equal(person.birth, '2019-03-20', value);
    assert.equal(person.birthMissing, false);
    assert.equal(person.needsReview, false);
    assert.equal(person.birthSource, 'school-export');
    assert.equal(result.migration.missingBirth, 0);
    assert.equal(input.students[0].birth_date, value);
    assert.equal(JSON.parse(person.schoolOriginal).birth_date, value);
  }
  const input = snapshot();
  input.staff[0].birth_date = '1980.03.04.';
  assert.equal(convert(input, origin, 'staff').data.subjects[0].birth, '1980-03-04');
});

test('invalid dotted dates stay reviewable; leap days are validated', () => {
  assert.equal(birthValue('2020.02.29.'), '2020-02-29');
  for (const value of ['2019.02.29', '2019.02.30.', '2019.13.01', '2019.00.20', '2019.03.00', '2019.03.32', '9999.03.20', '2019.03.20..', '진료일 2019.03.20']) {
    const input = snapshot();
    input.students[0].birth_date = value;
    const person = convert(input, origin).data.subjects[0];
    assert.equal(person.birth, '', value);
    assert.equal(person.birthMissing, true);
    assert.equal(person.needsReview, true);
    assert.equal(JSON.parse(person.schoolOriginal).birth_date, value);
  }
});
test('stable provenance survives repeat export and differs across source installations', () => {
  const a=convert(snapshot(),origin), b=convert(snapshot(),origin), c=convert(snapshot(),'00000000-0000-4000-8000-000000000002');
  assert.deepEqual(a.data,b.data);
  assert.notEqual(a.data.subjects[0].migrationKey,c.data.subjects[0].migrationKey);
});
test('snapshot reads all required tables inside one transaction without updating source rows', () => {
  const input=snapshot(); let active=false;
  const db={ transaction:fn=>()=>{active=true; const result=fn(); active=false; return result;}, prepare:sql=>{
    assert.equal(active,true); assert.match(sql,/^SELECT \* FROM \w+ ORDER BY rowid$/);
    return {all:()=> input[sql.split(' ')[3]]};
  }};
  assert.deepEqual(snapshotDatabase(db),input);
});
module.exports={snapshot,origin};
