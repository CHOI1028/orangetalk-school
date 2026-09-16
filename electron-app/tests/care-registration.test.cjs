'use strict';

// Synthetic renderer objects and stub IPC only. No application startup, network or user data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../src/renderer/core/care-registration.js'), 'utf8');
function helpers() {
  return vm.runInNewContext('(function(){' + source.replace(/^export /gm, '')
    + '\nreturn {matchCareStudent,persistCareRegistration,applyCareResult};})()');
}
function student(overrides = {}) {
  return { uid: 'synthetic-a', id: 'synthetic-a', type: 'student', name: '가상학생',
    grade: 3, cls: 2, num: 4, level: '초', department: '', is_enrolled: 1,
    status: 'normal', condition: '', guardianContact: 'synthetic-contact',
    homeroomTeacher: 'synthetic-teacher', medConsent: 'N', vip: 'Y', ...overrides };
}
const care = { is_care: 1, care_reason: '가상 질환', dust_disease: '가상 먼지 질환', care_memo: '가상 메모\n둘째 줄' };
function ack(uid = 'synthetic-a', values = care) { return { success: true, uid, care: { ...values } }; }
function options(result = ack()) { return { year: 2026, api: { studentsUpsert: async () => result } }; }
const plain = value => JSON.parse(JSON.stringify(value));

for (const [title, input] of [
  ['exact identity', { name: '가상학생', grade: 3, cls: 2, num: 4 }],
  ['surrounding name spaces', { name: '  가상학생\u00a0', grade: '3', cls: '2', num: '4' }],
  ['NFC name equivalence', { name: '가상학생'.normalize('NFD'), grade: 3 }],
  ['leading zero seats', { name: '가상학생', grade: '03', cls: '02', num: '004' }],
  ['numeric spreadsheet seats', { name: '가상학생', grade: '3.0', cls: '02.00', num: '004.0' }],
  ['display suffix seats', { name: '가상학생', grade: '3학년', cls: '02반', num: '4번' }],
  ['missing number', { name: '가상학생', grade: 3, cls: 2 }],
  ['zero number treated missing', { name: '가상학생', num: 0 }],
  ['zero-padded zero number treated missing', { name: '가상학생', num: '000.00' }]
]) {
  test('student match: ' + title, () => {
    const s = student();
    const result = helpers().matchCareStudent([s], input);
    assert.equal(result.reason, 'matched');
    assert.equal(result.student, s);
  });
}

for (const [title, input] of [
  ['name does not erase interior spaces', { name: '가상 학생' }],
  ['different grade', { name: '가상학생', grade: 2 }],
  ['different class', { name: '가상학생', cls: 3 }],
  ['different number', { name: '가상학생', num: 5 }],
  ['school level mismatch', { name: '가상학생', level: '중학교' }],
  ['department mismatch', { name: '가상학생', department: '가상학과' }],
  ['non-number class not coerced to zero', { name: '가상학생', cls: '해님' }]
]) {
  test('student mismatch: ' + title, () => {
    const result = helpers().matchCareStudent([student()], input);
    assert.equal(result.reason, 'not-found');
    assert.equal(result.student, null);
  });
}

test('kindergarten text grade and named class are preserved, not parseInt-truncated', () => {
  const s = student({ grade: '만5세', cls: '나래', level: '유', num: 0 });
  const h = helpers();
  assert.equal(h.matchCareStudent([s], { name: s.name, grade: '만5세', cls: '나래반', level: '유치원' }).student, s);
  assert.equal(h.matchCareStudent([s], { name: s.name, grade: '만4세', cls: '나래' }).student, null);
  assert.equal(h.matchCareStudent([s], { name: s.name, grade: '만5세', cls: '다래' }).student, null);
});

test('raw DB seat aliases are accepted when renderer aliases are absent', () => {
  const s = student({ cls: undefined, num: undefined, class_num: '02', student_num: '04' });
  assert.equal(helpers().matchCareStudent([s], { name: s.name, cls: 2, num: 4 }).student, s);
});

for (const [stored, provided] of [['초', '초등학교'], ['초등학교', '초'], ['중', '중학교'],
  ['중학교', '중'], ['고', '고등학교'], ['고등학교', '고'], ['유', '유치원'], ['유치원', '유'],
  ['elementary', '초'], ['초등', 'Elementary'], ['ELEMENTARY', '초등학교'],
  ['middle', '중학교'], ['중', 'MIDDLE'], ['high', '고등학교'], ['고등', 'HIGH'],
  ['kindergarten', '유치원'], ['유', 'KINDERGARTEN'],
  ['special', '특수학교'], ['특수', 'SPECIAL'], ['특수학교', '특수']]) {
  test('school level alias ' + stored + ' / ' + provided, () => {
    const s = student({ level: stored });
    assert.equal(helpers().matchCareStudent([s], { name: s.name, level: provided }).student, s);
  });
}

test('mixed school duplicate is ambiguous without school level and precise with it', () => {
  const elementary = student();
  const middle = student({ uid: 'synthetic-b', id: 'synthetic-b', level: '중' });
  const h = helpers();
  const ambiguous = h.matchCareStudent([elementary, middle], { name: elementary.name, grade: 3, cls: 2, num: 4 });
  assert.equal(ambiguous.student, null);
  assert.equal(ambiguous.reason, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(h.matchCareStudent([middle, elementary], { name: elementary.name, level: '초등학교' }).student, elementary);
});

test('department disambiguates same identity without removing interior whitespace', () => {
  const a = student({ department: '가상 학과' });
  const b = student({ uid: 'synthetic-b', department: '다른 학과' });
  const h = helpers();
  assert.equal(h.matchCareStudent([a, b], { name: a.name }).reason, 'ambiguous');
  assert.equal(h.matchCareStudent([a, b], { name: a.name, department: ' 가상 학과 ' }).student, a);
  assert.equal(h.matchCareStudent([a, b], { name: a.name, department: '가상학과' }).student, null);
});

for (const number of [undefined, '', 0, '0']) {
  test('missing number never selects the first same-name student: ' + String(number), () => {
    const a = student();
    const b = student({ uid: 'synthetic-b', id: 'synthetic-b', num: 5 });
    const result = helpers().matchCareStudent([a, b], { name: a.name, grade: 3, cls: 2, num: number });
    assert.equal(result.student, null);
    assert.equal(result.reason, 'ambiguous');
  });
}

for (const variant of [{ type: 'staff' }, { is_enrolled: 0 }, { is_enrolled: '0' },
  { _isLeaver: true }, { _notFound: true }, { _unenrolled: true }]) {
  test('ineligible students are neither matched nor saved: ' + JSON.stringify(variant), async () => {
    const h = helpers();
    const s = student(variant);
    assert.equal(h.matchCareStudent([s], { name: s.name }).reason, 'not-found');
    let called = false;
    const result = await h.persistCareRegistration(s, { care_reason: '가상' }, {
      year: 2026, api: { studentsUpsert() { called = true; } }
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'invalid-student');
    assert.equal(called, false);
  });
}

test('empty or malformed rows and missing people fail without selecting', () => {
  const h = helpers();
  for (const row of [null, {}, { name: ' ' }]) assert.equal(h.matchCareStudent([student()], row).reason, 'invalid-name');
  assert.equal(h.matchCareStudent(null, { name: '가상학생' }).reason, 'not-found');
});

test('save sends only stable UID, care-only marker and own requested fields, preserving all unrelated data', async () => {
  const h = helpers();
  const s = student();
  const previous = { ...s };
  let payload, year, receiver;
  const api = { async studentsUpsert(p, y) { payload = p; year = y; receiver = this; return ack(); } };
  const changes = Object.assign(Object.create({ dust_disease: 'inherited-ignored' }), {
    care_reason: care.care_reason, care_memo: care.care_memo,
    name: 'must-not-send', guardian_contact: '', is_care: 0, uid: 'must-not-send', _careOnly: false
  });
  const result = await h.persistCareRegistration(s, changes, { api, year: 2026 });
  assert.equal(result.success, true);
  assert.deepEqual(plain(payload), { uid: 'synthetic-a', _careOnly: true, care_reason: care.care_reason, care_memo: care.care_memo });
  assert.equal(year, '2026');
  assert.equal(receiver, api);
  for (const field of Object.keys(previous).filter(key => !['status', 'condition'].includes(key))) assert.equal(s[field], previous[field]);
  assert.equal(s.condition, care.care_reason);
  assert.equal(s.care_reason, care.care_reason);
  assert.equal(s.status, 'caution');
  assert.equal(s.is_care, 1);
  assert.equal(s.dustDisease, care.dust_disease);
  assert.equal(s.dust_disease, care.dust_disease);
  assert.equal(s.careMemo, care.care_memo);
  assert.equal(s.care_memo, care.care_memo);
  assert.equal(s.careYear, 2026);
});

test('id fallback identifies a numberless student without supplying name or seat to upsert', async () => {
  const s = student({ uid: undefined, num: 0 });
  let payload;
  const result = await helpers().persistCareRegistration(s, { care_reason: '가상' }, {
    year: '2026', api: { async studentsUpsert(p) { payload = p; return ack(); } }
  });
  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(payload).sort(), ['_careOnly', 'care_reason', 'uid']);
  assert.equal(payload.uid, 'synthetic-a');
});

test('pending save cannot optimistically mutate a student or be duplicated', async () => {
  const h = helpers();
  const s = student();
  const original = { ...s };
  let resolve, calls = 0;
  const api = { studentsUpsert() { calls++; return new Promise(r => { resolve = r; }); } };
  const promise = h.persistCareRegistration(s, { care_reason: '가상' }, { api, year: 2026 });
  assert.deepEqual(s, original);
  const duplicate = await h.persistCareRegistration({ ...s }, { care_reason: '다른 값' }, { api, year: 2026 });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.code, 'pending');
  assert.equal(calls, 1);
  assert.deepEqual(s, original);
  resolve(ack());
  assert.equal((await promise).success, true);
  assert.equal(s.condition, care.care_reason);
  assert.equal((await h.persistCareRegistration(s, { care_reason: '' }, options())).success, true);
});

test('pending guard is independent per student and academic year', async () => {
  const h = helpers();
  let resolve;
  const api = { studentsUpsert: () => new Promise(r => { resolve = r; }) };
  const waiting = h.persistCareRegistration(student(), { care_memo: '가상' }, { api, year: 2026 });
  assert.equal((await h.persistCareRegistration(student({ uid: 'synthetic-b' }), { care_memo: '' }, options(ack('synthetic-b')))).success, true);
  assert.equal((await h.persistCareRegistration(student(), { care_memo: '' }, { ...options(), year: 2027 })).success, true);
  resolve(ack());
  await waiting;
});

for (const [label, result] of [['false', false], ['undefined', undefined], ['null', null],
  ['failure response', { success: false, error: 'SENSITIVE-NAME-CONDITION-AND-DB-PATH' }],
  ['truthy non-boolean success', { success: 1, uid: 'synthetic-a', care }]]) {
  test('save failure is not successful and does not change memory: ' + label, async () => {
    const h = helpers();
    const s = student();
    const original = { ...s };
    const response = await h.persistCareRegistration(s, { care_reason: '가상' }, { year: 2026, api: { studentsUpsert: async () => result } });
    assert.equal(response.success, false);
    assert.equal(response.code, 'save-failed');
    assert.deepEqual(s, original);
    assert.doesNotMatch(response.error, /SENSITIVE|CONDITION|DB-PATH/);
    assert.equal((await h.persistCareRegistration(s, { care_reason: '가상' }, options())).success, true);
  });
}

for (const asynchronous of [false, true]) {
  test('IPC exception is sanitized and guard is released: ' + asynchronous, async () => {
    const h = helpers();
    const s = student();
    const original = { ...s };
    const fail = () => { throw new Error('SENSITIVE-DIAGNOSIS-PATH'); };
    const response = await h.persistCareRegistration(s, { care_reason: '가상' }, {
      year: 2026, api: { studentsUpsert: asynchronous ? async () => fail() : fail }
    });
    assert.equal(response.success, false);
    assert.equal(response.code, 'save-failed');
    assert.doesNotMatch(response.error, /SENSITIVE|DIAGNOSIS/);
    assert.deepEqual(s, original);
    assert.equal((await h.persistCareRegistration(s, { care_reason: '가상' }, options())).success, true);
  });
}

for (const [label, response] of [
  ['no UID', { success: true, care }], ['wrong UID', ack('synthetic-other')],
  ['no care', { success: true, uid: 'synthetic-a' }], ['no is_care', ack('synthetic-a', { care_reason: '', dust_disease: '', care_memo: '' })],
  ['non-numeric is_care', ack('synthetic-a', { ...care, is_care: '1' })], ['invalid is_care', ack('synthetic-a', { ...care, is_care: 2 })],
  ['missing memo', ack('synthetic-a', { is_care: 1, care_reason: '', dust_disease: '' })],
  ['null text', ack('synthetic-a', { ...care, care_reason: null })], ['non-text dust', ack('synthetic-a', { ...care, dust_disease: 7 })]
]) {
  test('malformed successful acknowledgement is rejected: ' + label, async () => {
    const s = student();
    const original = { ...s };
    const result = await helpers().persistCareRegistration(s, { care_reason: '가상' }, options(response));
    assert.equal(result.success, false);
    assert.equal(result.code, 'invalid-response');
    assert.deepEqual(s, original);
  });
}

for (const [label, changes] of [['empty changes', {}], ['missing changes', null], ['non-text change', { care_reason: null }],
  ['clear marker not boolean', { _clearCare: 'true' }], ['false clear only', { _clearCare: false }],
  ['unrelated-only changes', { name: '가상', guardian_contact: '' }]]) {
  test('invalid changes are rejected before IPC: ' + label, async () => {
    let called = false;
    const result = await helpers().persistCareRegistration(student(), changes, { year: 2026,
      api: { studentsUpsert() { called = true; } } });
    assert.equal(result.success, false);
    assert.equal(result.code, 'invalid-changes');
    assert.equal(called, false);
  });
}

test('missing UID, API and academic year are safe failures', async () => {
  const h = helpers();
  const changes = { care_reason: '가상' };
  assert.equal((await h.persistCareRegistration(student({ uid: '', id: '' }), changes, options())).code, 'invalid-student');
  assert.equal((await h.persistCareRegistration(student(), changes, {})).code, 'unavailable');
  assert.equal((await h.persistCareRegistration(student(), changes, null)).code, 'unavailable');
  for (const year of [undefined, '', '2026-invalid', NaN]) {
    assert.equal((await h.persistCareRegistration(student(), changes, { ...options(), year })).code, 'invalid-year');
  }
});

test('explicit blank care reason clears aliases without clearing the dust condition', async () => {
  const s = student({ condition: '이전 가상 질환', care_reason: '이전 가상 질환', is_care: 1, status: 'caution' });
  const next = { ...care, is_care: 0, care_reason: '' };
  let sent;
  const result = await helpers().persistCareRegistration(s, { care_reason: '' }, {
    year: 2026, api: { async studentsUpsert(p) { sent = p; return ack('synthetic-a', next); } }
  });
  assert.equal(result.success, true);
  assert.deepEqual(plain(sent), { uid: 'synthetic-a', _careOnly: true, care_reason: '' });
  assert.equal(s.condition, '');
  assert.equal(s.care_reason, '');
  assert.equal(s.status, 'normal');
  assert.equal(s.is_care, 0);
  assert.equal(s.dustDisease, care.dust_disease);
});

test('full clear updates all aliases only after confirmed save and removes careYear', async () => {
  const s = student({ careYear: 2025 });
  let sent;
  const cleared = { is_care: 0, care_reason: '', dust_disease: '', care_memo: '' };
  const result = await helpers().persistCareRegistration(s, { _clearCare: true }, {
    year: 2026, api: { async studentsUpsert(p) { sent = p; return ack('synthetic-a', cleared); } }
  });
  assert.equal(result.success, true);
  assert.deepEqual(plain(sent), { uid: 'synthetic-a', _careOnly: true, _clearCare: true });
  for (const key of ['care_reason', 'condition', 'dust_disease', 'dustDisease', 'care_memo', 'careMemo']) assert.equal(s[key], '');
  assert.equal(s.status, 'normal');
  assert.equal(s.is_care, 0);
  assert.equal(Object.hasOwn(s, 'careYear'), false);
});

test('16,000 character conditions and multiline memo are passed intact', async () => {
  const s = student();
  const long = '가상'.repeat(8000);
  const changes = { care_reason: long, dust_disease: long, care_memo: '가상 첫 줄\n둘째 줄\n' };
  let sent;
  const result = await helpers().persistCareRegistration(s, changes, {
    year: 2026, api: { async studentsUpsert(p) { sent = p; return ack('synthetic-a', { ...changes, is_care: 1 }); } }
  });
  assert.equal(result.success, true);
  for (const field of Object.keys(changes)) assert.equal(sent[field], changes[field]);
  assert.equal(s.condition.length, 16000);
  assert.equal(s.careMemo, changes.care_memo);
});

test('reload synchronization applies the same acknowledged fields without overwriting other student data', () => {
  const h = helpers();
  const s = student();
  assert.equal(h.applyCareResult(s, care, '2026'), true);
  assert.equal(s.condition, care.care_reason);
  assert.equal(s.guardianContact, 'synthetic-contact');
  const current = { ...s };
  assert.equal(h.applyCareResult(s, { care_reason: '' }, 2026), false);
  assert.deepEqual(s, current);
});
