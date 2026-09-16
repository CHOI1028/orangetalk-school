'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HealthDiaryDB } = require('../../src/main/services/database');
const { StudentsDBService } = require('../../src/main/services/people-db-service');

assert.ok(process.versions.electron && process.env.ELECTRON_RUN_AS_NODE === '1');
const YEAR = '2026';
const UID = 'care-regression-student';
const originalCare = { is_care: 1, care_reason: '기존 질환', dust_disease: '기존 기저질환', care_memo: '기존 메모' };

function fixture(fn) {
  const db = new HealthDiaryDB(':memory:');
  const service = new StudentsDBService(db);
  db.now = () => '2026-01-01T00:00:00.000Z';
  assert.equal(service.upsert(YEAR, {
    uid: UID, name: '회귀검증학생', gender: '여', birth_date: '2015-01-02',
    memo_json: '{"note":"학생 고유 메모"}', grade: 5, class_num: 2, student_num: null,
    level: '초', department: '보존 학과', guardian_type: '보호자', guardian_contact: '010-0000-0000',
    homeroom_teacher: '가상 교사', med_consent: 'N', emergency_consent: 'N', vip: '보존 표시',
    extra_json: '{"custom":"보존 데이터"}', _careManaged: true, ...originalCare,
  }).success, true);
  db.now = () => '2026-09-16T00:00:00.000Z';
  const context = {
    db, service,
    save: (data, year = YEAR) => service.upsert(year, { _careOnly: true, uid: UID, ...data }),
    base: () => db.db.prepare('SELECT * FROM students WHERE uid = ?').get(UID),
    info: (year = YEAR) => db.db.prepare('SELECT * FROM students_info WHERE uid = ? AND school_year = ?').get(UID, year),
    counts: () => [db.db.prepare('SELECT COUNT(*) AS n FROM students').get().n,
      db.db.prepare('SELECT COUNT(*) AS n FROM students_info').get().n],
  };
  try { fn(context); } finally { if (db.db.open) db.close(); }
}
function expectedCare(row) {
  return Object.fromEntries(['is_care', 'care_reason', 'dust_disease', 'care_memo'].map((key) => [key, row[key]]));
}
function omitCareAndUpdated(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !['is_care', 'care_reason', 'dust_disease', 'care_memo', 'updated_at'].includes(key)));
}

test('care-only UID payload bypasses generic mandatory-name validation and returns acknowledged care', () => fixture(({ save, info }) => {
  const response = save({ care_reason: '새 질환' });
  assert.deepEqual(response, { success: true, uid: UID, care: { ...originalCare, care_reason: '새 질환' } });
  assert.deepEqual(response.care, expectedCare(info()));
}));

test('numberless student is updated by exact UID with no duplicate insert', () => fixture(({ save, counts, info }) => {
  const before = counts();
  assert.equal(save({ care_reason: '번호 없는 학생 수정' }).success, true);
  assert.deepEqual(counts(), before);
  assert.equal(info().student_num, null);
}));

test('care edit ignores unrelated incoming fields and preserves every base/metadata column', () => fixture(({ save, base, info }) => {
  const oldBase = base(), oldInfo = info();
  assert.equal(save({
    care_reason: '수정 질환', name: '잘못된 이름', gender: '잘못된 성별', birth_date: 'bad', memo_json: 'bad',
    grade: 6, class_num: 9, student_num: 50, level: '고', department: '', guardian_contact: '',
    guardian_type: '', homeroom_teacher: '', med_consent: 'Y', emergency_consent: 'Y', vip: '',
    extra_json: '{}', is_enrolled: 0, created_at: 'bad', updated_at: 'bad',
  }).success, true);
  assert.deepEqual(base(), oldBase);
  assert.deepEqual(omitCareAndUpdated(info()), omitCareAndUpdated(oldInfo));
  assert.equal(info().updated_at, '2026-09-16T00:00:00.000Z');
}));

test('long Korean and multiline text round-trips without truncation in all three care fields', () => fixture(({ save, info }) => {
  const longText = '긴 질환명·알레르기 검사\r\n다음 줄 😀\n'.repeat(1000);
  assert.ok(longText.length > 16000);
  const data = { care_reason: longText, dust_disease: longText + '먼지', care_memo: longText + '메모' };
  const response = save(data);
  assert.equal(response.success, true);
  for (const key of Object.keys(data)) assert.equal(info()[key], data[key]);
}));

test('explicit empty reason clears care status without reviving legacy condition/status fields', () => fixture(({ save }) => {
  assert.deepEqual(save({ care_reason: '', condition: '되살리면 안 되는 질환', status: 'caution', is_care: 1 }).care,
    { ...originalCare, is_care: 0, care_reason: '' });
}));

test('whitespace-only reason produces non-care status without destroying the supplied text', () => fixture(({ save }) => {
  const response = save({ care_reason: ' \n\t ' });
  assert.equal(response.care.is_care, 0);
  assert.equal(response.care.care_reason, ' \n\t ');
}));

test('dust-only partial edit preserves existing care reason, status and memo', () => fixture(({ save }) => {
  assert.deepEqual(save({ dust_disease: '새 미세먼지 질환', is_care: 0 }).care,
    { ...originalCare, dust_disease: '새 미세먼지 질환' });
}));

test('dust-only entry never adds a non-care student to the care list', () => fixture(({ db, save }) => {
  db.db.prepare("UPDATE students_info SET is_care = 0, care_reason = '' WHERE uid = ?").run(UID);
  const response = save({ dust_disease: '천식', is_care: 1 });
  assert.equal(response.care.is_care, 0);
  assert.equal(response.care.care_reason, '');
}));

test('reason-only registration recomputes status from text instead of trusting stale is_care', () => fixture(({ save }) => {
  assert.equal(save({ care_reason: '심장질환', is_care: 0 }).care.is_care, 1);
}));

test('memo-only edit preserves both conditions', () => fixture(({ save }) => {
  assert.deepEqual(save({ care_memo: '새 메모\n두 번째 줄' }).care,
    { ...originalCare, care_memo: '새 메모\n두 번째 줄' });
}));

test('empty dust and memo are intentional clears, not omission', () => fixture(({ save }) => {
  assert.deepEqual(save({ dust_disease: '', care_memo: '' }).care,
    { ...originalCare, dust_disease: '', care_memo: '' });
}));

for (const clear of [true, 'true']) {
  test('explicit clear ' + typeof clear + ' clears exactly all four care fields', () => fixture(({ save, base, info }) => {
    const oldBase = base(), oldInfo = info();
    assert.deepEqual(save({ _clearCare: clear, care_reason: '무시할 이전 값', dust_disease: '이전 값' }).care,
      { is_care: 0, care_reason: '', dust_disease: '', care_memo: '' });
    assert.deepEqual(base(), oldBase);
    assert.deepEqual(omitCareAndUpdated(info()), omitCareAndUpdated(oldInfo));
  }));
}

test('omitted fields retain the latest committed values rather than a renderer snapshot', () => fixture(({ db, save }) => {
  db.db.prepare('UPDATE students_info SET dust_disease = ?, care_memo = ? WHERE uid = ?').run('다른 PC 직전 저장', '최근 메모', UID);
  assert.deepEqual(save({ care_reason: '이 PC 수정' }).care,
    { is_care: 1, care_reason: '이 PC 수정', dust_disease: '다른 PC 직전 저장', care_memo: '최근 메모' });
}));

test('empty partial payload preserves all care values', () => fixture(({ save }) => {
  assert.deepEqual(save({}).care, originalCare);
}));

test('legacy NULL fields stay untouched in DB while acknowledged care text is normalized', () => fixture(({ db, save, info }) => {
  db.db.prepare('UPDATE students_info SET is_care = 0, care_reason = NULL, dust_disease = NULL, care_memo = NULL WHERE uid = ?').run(UID);
  assert.deepEqual(save({}).care, { is_care: 0, care_reason: '', dust_disease: '', care_memo: '' });
  assert.equal(info().care_reason, null);
  assert.equal(info().dust_disease, null);
  assert.equal(info().care_memo, null);
  assert.deepEqual(save({ care_reason: '새 질환' }).care, { is_care: 1, care_reason: '새 질환', dust_disease: '', care_memo: '' });
  assert.equal(info().dust_disease, null);
  assert.equal(info().care_memo, null);
}));

for (const uid of [undefined, null, '', '   ', 5, {}, [], 'unknown-care-student', UID + ' ']) {
  test('missing/invalid/unknown exact UID is rejected: ' + JSON.stringify(uid), () => fixture(({ save, base, info, counts }) => {
    const before = [base(), info(), counts()];
    const response = save({ uid, care_reason: '저장되면 안 됨' });
    assert.equal(response.success, false);
    assert.deepEqual([base(), info(), counts()], before);
  }));
}

test('soft-deleted or departed student is not resurrected', () => fixture(({ db, save, info }) => {
  db.db.prepare('UPDATE students_info SET is_enrolled = 0 WHERE uid = ?').run(UID);
  const before = info();
  assert.equal(save({ care_reason: '잘못된 저장' }).code, 'CARE_STUDENT_NOT_FOUND');
  assert.deepEqual(info(), before);
}));

test('missing academic-year row is never inserted', () => fixture(({ save, info, counts }) => {
  const before = [info(), counts()];
  assert.equal(save({ care_reason: '잘못된 학년도 저장' }, '2027').code, 'CARE_STUDENT_NOT_FOUND');
  assert.deepEqual([info(), counts()], before);
}));

test('removed year row is never re-created', () => fixture(({ db, save, counts }) => {
  db.db.prepare('DELETE FROM students_info WHERE uid = ? AND school_year = ?').run(UID, YEAR);
  const before = counts();
  assert.equal(save({ care_reason: '삭제 후 저장' }).code, 'CARE_STUDENT_NOT_FOUND');
  assert.deepEqual(counts(), before);
}));

test('orphaned info row with missing student identity is rejected', () => fixture(({ db, save, info }) => {
  db.db.pragma('foreign_keys = OFF');
  db.db.prepare('DELETE FROM students WHERE uid = ?').run(UID);
  const before = info();
  assert.equal(save({ care_reason: '원본 없는 학생' }).code, 'CARE_STUDENT_NOT_FOUND');
  assert.deepEqual(info(), before);
}));

test('another academic year of same UID remains unchanged', () => fixture(({ service, save, info }) => {
  assert.equal(service.upsert('2025', { uid: UID, name: '회귀검증학생', grade: 4, class_num: 1,
    _careManaged: true, care_reason: '작년 기록' }).success, true);
  const previousYear = info('2025');
  assert.equal(save({ care_reason: '올해 수정' }).success, true);
  assert.deepEqual(info('2025'), previousYear);
}));

for (const field of ['care_reason', 'dust_disease', 'care_memo']) {
  for (const value of [null, undefined, 123, true, [], {}, new String('문자열 객체')]) {
    test('non-string ' + field + ' rejects ' + Object.prototype.toString.call(value), () => fixture(({ save, base, info }) => {
      const before = [base(), info()];
      const response = save({ [field]: value, care_reason: field === 'care_reason' ? value : '쓰면 안 되는 값' });
      assert.equal(response.success, false);
      assert.equal(response.code, 'CARE_INVALID_INPUT');
      assert.deepEqual([base(), info()], before);
    }));
  }
}

test('SQL punctuation is stored as literal text and cannot affect other records', () => fixture(({ save, counts, info }) => {
  const before = counts();
  const reason = "알레르기'); DELETE FROM students; --";
  assert.equal(save({ care_reason: reason }).success, true);
  assert.equal(info().care_reason, reason);
  assert.deepEqual(counts(), before);
}));

test('care write is one atomic UPDATE and no stale SELECT/INSERT/upsert', () => fixture(({ db, save }) => {
  const prepare = db.db.prepare.bind(db.db), queries = [];
  db.db.prepare = (sql) => { queries.push(sql); return prepare(sql); };
  assert.equal(save({ care_reason: '단일 갱신' }).success, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^\s*UPDATE students_info/);
  assert.match(queries[0], /RETURNING is_care,/);
  assert.match(queries[0], /COALESCE\(care_reason, ''\) AS care_reason/);
}));

test('SQLite failure rolls back entire update and reports only a static safe error', () => fixture(({ db, save, base, info }) => {
  const before = [base(), info()];
  db.db.exec("CREATE TRIGGER care_write_failure BEFORE UPDATE ON students_info BEGIN SELECT RAISE(ABORT, 'PRIVATE SQL FAILURE'); END");
  const response = save({ care_reason: '부분 저장 금지', dust_disease: '부분 저장 금지' });
  assert.deepEqual(response, { success: false, code: 'CARE_SAVE_FAILED', error: '요보호 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  assert.deepEqual([base(), info()], before);
}));

test('closed DB errors are acknowledged as failure without throwing or exposing details', () => fixture(({ db, save }) => {
  db.close();
  assert.equal(save({ care_reason: '실패 검증' }).code, 'CARE_SAVE_FAILED');
}));

test('string care-only flag uses the same safe route', () => fixture(({ save }) => {
  assert.equal(save({ _careOnly: 'true', care_reason: '호환 플래그' }).care.care_reason, '호환 플래그');
}));

test('numeric school year matches its TEXT database year', () => fixture(({ save }) => {
  assert.equal(save({ care_reason: '연도 숫자' }, 2026).success, true);
}));

test('generic upsert continues to create students with its original response', () => fixture(({ service, counts }) => {
  const before = counts();
  const response = service.upsert(YEAR, { name: '새 가상 학생', grade: 1, class_num: 1, student_num: 1 });
  assert.equal(response.success, true);
  assert.equal(typeof response.uid, 'string');
  assert.equal(Object.hasOwn(response, 'care'), false);
  assert.deepEqual(counts(), before.map((n) => n + 1));
}));

test('updateCare rejects non-object payloads and never alters DB', () => fixture(({ service, base, info }) => {
  const before = [base(), info()];
  for (const value of [undefined, null, [], 'bad', 5]) {
    assert.equal(service.updateCare(YEAR, value).code, 'CARE_INVALID_INPUT');
  }
  assert.deepEqual([base(), info()], before);
}));
