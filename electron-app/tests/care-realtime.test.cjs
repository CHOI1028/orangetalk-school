/* Read-only production function extraction. Synthetic roster only; no app/DB. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/core/data-loader.js'), 'utf8');
const start = source.indexOf('function _peopleSig(){');
const end = source.indexOf('function _startRealtimeSync(){', start);
assert(start >= 0 && end > start, 'Production function boundaries');
const production = source.slice(start, end);
const context = vm.createContext({ S: { people: [] } });
vm.runInContext(production, context);
const base = { uid: 'synthetic-care-uid', name: '가상학생', type: 'student', grade: 2, cls: '가람', num: 3, level: '초' };
const camel = { ...base, status: 'caution', condition: '기존 질환', dustDisease: '기존 미세먼지 질환', careMemo: '기존 메모' };
const snake = { ...base, is_care: 1, care_reason: '기존 질환', dust_disease: '기존 미세먼지 질환', care_memo: '기존 메모' };
function sig(people) { context.S.people = people; return context._peopleSig(); }

for (const [key, value] of [['status', 'normal'], ['condition', '새 질환'], ['dustDisease', '새 미세먼지 질환'], ['careMemo', '새 주의사항']]) {
  test('remote camel-only care update changes signature: ' + key, () => {
    assert.notEqual(sig([camel]), sig([{ ...camel, [key]: value }]));
  });
}
for (const [key, value] of [['is_care', 0], ['care_reason', '새 질환'], ['dust_disease', '새 미세먼지 질환'], ['care_memo', '새 주의사항']]) {
  test('snake-only care update changes signature: ' + key, () => {
    assert.notEqual(sig([snake]), sig([{ ...snake, [key]: value }]));
  });
}
for (const key of ['condition', 'dustDisease', 'careMemo']) {
  test('clearing only ' + key + ' triggers remote refresh', () => {
    assert.notEqual(sig([camel]), sig([{ ...camel, [key]: '' }]));
  });
}
test('database reload aliases and save acknowledgement aliases compare equally', () => {
  assert.equal(sig([camel]), sig([snake]));
  assert.equal(sig([camel]), sig([{ ...camel, ...snake }]));
  assert.equal(sig([{ ...snake, is_care: '1' }]), sig([camel]));
  assert.equal(sig([{ ...camel, status: 'watch' }]), sig([camel]));
});
test('explicit snake empty values and zero do not revive stale camel fields', () => {
  const explicitCleared = { ...camel, is_care: 0, care_reason: '', dust_disease: '', care_memo: '' };
  const cleared = { ...base, status: 'normal', condition: '', dustDisease: '', careMemo: '' };
  assert.equal(sig([explicitCleared]), sig([cleared]));
  assert.notEqual(sig([explicitCleared]), sig([camel]));
});
test('null aliases fall back to database reload fields', () => {
  assert.equal(sig([{ ...camel, is_care: null, care_reason: null, dust_disease: null, care_memo: null }]), sig([camel]));
});
test('care-only removal and dust-only registration remain distinct', () => {
  const normal = { ...base, status: 'normal' };
  const dustOnly = { ...normal, dustDisease: '미세먼지 질환' };
  assert.notEqual(sig([normal]), sig([dustOnly]));
  assert.notEqual(sig([dustOnly]), sig([{ ...dustOnly, careMemo: '흡입기 보관' }]));
});
test('signature calculation preserves frozen records and handles empty rosters', () => {
  const frozen = Object.freeze({ ...camel });
  const original = JSON.stringify(frozen);
  assert.equal(sig(Object.freeze([frozen])), sig([camel]));
  assert.equal(JSON.stringify(frozen), original);
  assert.equal(sig([]), 0);
  assert.equal(sig(undefined), 0);
  assert.equal(sig(null), 0);
});
test('record-only changes do not refresh an unchanged roster', () => {
  const before = sig([camel]);
  context.S.records = [{ id: 'synthetic-record', text: 'changed without roster edit' }];
  assert.equal(context._peopleSig(), before);
});
test('multiline long care-only memo changes are detected', () => {
  const memo = '가상 주의사항\n'.repeat(2000);
  const before = sig([{ ...camel, careMemo: memo }]);
  assert.notEqual(sig([{ ...camel, careMemo: memo + '추가' }]), before);
  assert.equal(sig([{ ...snake, care_memo: memo }]), before);
});
