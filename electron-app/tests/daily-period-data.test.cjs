/* Synthetic records only: no app state, Electron, user database or network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/features/daily/daily-period-data.js'), 'utf8');
const helpers = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const now = 1800000000000;
const from = '2025-02-28', to = '2026-03-01';
const visit = (id, changes = {}) => ({ id, personUid: 'person-' + id, date: '2026-02-28', timeIn: '09:00', symptoms: [], treatment: [], ...changes });

test('period validation accepts inclusive single dates, leap dates and cross-school-year history', async () => {
  const { validatePeriodRange } = await helpers;
  for (const range of [[from, to], ['2024-02-29', '2024-02-29'], ['2000-02-29', '2026-09-30'], ['2025-12-31', '2026-01-01']]) {
    assert.equal(validatePeriodRange(...range), '');
  }
});

test('period validation rejects missing, malformed, impossible and reversed dates', async () => {
  const { validatePeriodRange } = await helpers;
  for (const invalid of ['', null, '2026-2-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '2026-09-30T00:00:00', ' 2026-09-30']) {
    assert(validatePeriodRange(invalid, '2026-12-31'), String(invalid));
    assert(validatePeriodRange('1800-01-01', invalid), String(invalid));
  }
  assert.match(validatePeriodRange('2026-03-02', '2026-03-01'), /종료일/);
});

test('DB search is inclusive across school years and sorted by date, time and stable id', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(10), visit(2), visit(3, { date: from }), visit(4, { date: to, timeIn: '08:00' }), visit(5, { date: to, timeIn: '15:00' }), visit(6, { date: '2025-02-27' }), visit(7, { date: '2026-03-02' })];
  const result = reconcilePeriodRecords(db, [], from, to, now);
  assert.deepEqual(result.map(r => r.id), [5, 4, 2, 10, 3]);
  assert.deepEqual(reconcilePeriodRecords(db, [], to, to, now).map(r => r.id), [5, 4]);
  assert.deepEqual(reconcilePeriodRecords(db, [], to, from, now), []);
});

test('DB is authoritative over clean stale memory, including deleted DB visits and empty results', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1, { treatment: ['DB 최신 처치'] })];
  const memory = [visit(1, { treatment: ['오래된 처치'] }), visit(2), visit(3, { _autoCreated: true }), visit(4, { _savedAt: now - 7000 }), visit(5, { _savedAt: now + 1 })];
  assert.deepEqual(reconcilePeriodRecords(db, memory, from, to, now).map(r => r.treatment), [['DB 최신 처치']]);
  assert.deepEqual(reconcilePeriodRecords([], memory, from, to, now), []);
});

test('same DB identity overlays only pending or recently saved local edits', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1), visit(2), visit(3), visit(4), visit(5)];
  const memory = [visit('1', { _dirty: true, treatmentMemo: '작성 중' }), visit(200, { _dbId: 2, _pendingUpdate: true, treatmentMemo: '후속 저장' }), visit(3, { _savedAt: now - 6999, treatmentMemo: '방금 저장' }), visit(4, { _savedAt: now - 7000, treatmentMemo: '유예 종료' }), visit(5, { _dirty: true, _deleted: true })];
  const result = reconcilePeriodRecords(db, memory, from, to, now);
  assert.equal(result.find(r => String(r.id) === '1').treatmentMemo, '작성 중');
  assert.equal(result.find(r => r._dbId === 2).treatmentMemo, '후속 저장');
  assert.equal(result.find(r => r.id === 3).treatmentMemo, '방금 저장');
  assert.equal(result.find(r => r.id === 4).treatmentMemo, undefined);
  assert.equal(result.find(r => r.id === 5)._deleted, undefined);
});

test('only explicitly pending local additions survive an empty DB result', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const memory = [visit(1, { _dirty: true }), visit(2, { _inserting: true }), visit(3, { _pendingUpdate: true }), visit(4, { _savedAt: now - 1 }), visit(5, { _dirty: true, _deleted: true }), visit(6, { _dirty: true, _isDummy: true }), visit(7)];
  assert.deepEqual(reconcilePeriodRecords([], memory, from, to, now).map(r => r.id), [1, 2, 3, 4]);
});

test('pending local edits retain prior-year DB JOIN identity absent from the local record', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1, { date: '2025-03-03', personName: '과거 명단 인원', studentGrade: 1, studentClass: 2, studentNum: 3, studentDepartment: '과거 소속', treatment: ['이전 처치'] })];
  const memory = [visit(1, { date: '2025-03-04', _dirty: true, treatment: ['수정 중 처치'], treatmentMemo: '저장 중 메모' })];
  const before = structuredClone({ db, memory });
  const [result] = reconcilePeriodRecords(db, memory, from, to, now);
  assert.equal(result.personName, '과거 명단 인원');
  assert.equal(result.studentGrade, 1);
  assert.equal(result.studentClass, 2);
  assert.equal(result.studentNum, 3);
  assert.equal(result.studentDepartment, '과거 소속');
  assert.equal(result.date, '2025-03-04');
  assert.deepEqual(result.treatment, ['수정 중 처치']);
  assert.equal(result.treatmentMemo, '저장 중 메모');
  assert.deepEqual({ db, memory }, before);
});

test('same-person dirty defaults do not erase DB JOIN identity, including DB unknown values', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1, { personName: '당시 명단', studentGrade: 1, studentClass: 2, studentNum: 3, studentDepartment: '당시 소속', studentLevel: '초', staffPosition: '', studentGender: 'F' }), visit(2, { personName: '', studentGrade: 0, studentClass: 0, studentNum: 0 })];
  const memory = [visit(1, { _dirty: true, personName: '', studentGrade: 0, studentClass: 0, studentNum: 0, studentDepartment: '', studentLevel: '', studentGender: '', treatmentMemo: '새 내용' }), visit(2, { _dirty: true, personName: '현재 명단', studentGrade: 6, studentClass: 9, studentNum: 20 })];
  const result = reconcilePeriodRecords(db, memory, from, to, now);
  const first = result.find(record => record.id === 1);
  assert.equal(first.personName, '당시 명단');
  assert.equal(first.studentGrade, 1);
  assert.equal(first.studentClass, 2);
  assert.equal(first.studentNum, 3);
  assert.equal(first.studentDepartment, '당시 소속');
  assert.equal(first.studentLevel, '초');
  assert.equal(first.studentGender, 'F');
  assert.equal(first.treatmentMemo, '새 내용');
  assert.equal(result.find(record => record.id === 2).personName, '');
  assert.equal(result.find(record => record.id === 2).studentGrade, 0);
});

test('changing the visitor does not carry the previous DB identity into local edits', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1, { personUid: 'old-person', studentId: 'old-person', personType: 'staff', personName: '이전 인원', studentGrade: 4, studentClass: 5, studentNum: 6, studentDepartment: '이전 소속', staffPosition: '이전 직위', unmatchedIdentity: { name: '이전 인원' }, isPlaceholder: true })];
  const memory = [visit(1, { personUid: 'new-person', _dirty: true, personName: '', studentGrade: 0, studentClass: 0, studentNum: 0, studentDepartment: '새 소속', treatmentMemo: '새 처치' })];
  const before = structuredClone({ db, memory });
  const [result] = reconcilePeriodRecords(db, memory, from, to, now);
  assert.equal(result.personUid, 'new-person');
  assert.equal(result.studentId, 'new-person');
  for (const key of ['personName', 'studentGrade', 'studentClass', 'studentNum', 'staffPosition', 'personType', 'unmatchedIdentity', 'isPlaceholder']) assert.equal(Object.hasOwn(result, key), false, key);
  assert.equal(result.studentDepartment, '새 소속');
  assert.equal(result.treatmentMemo, '새 처치');
  assert.deepEqual({ db, memory }, before);
});

test('insert acknowledgements do not double-count or overwrite unrelated DB ids', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1, { personUid: 'db-person' }), visit(10, { personUid: 'new-person' })];
  const memory = [visit(1, { personUid: 'new-person', _inserting: true, _autoCreated: true }), visit(1, { personUid: 'another-new-person', _inserting: true, _autoCreated: true })];
  const result = reconcilePeriodRecords(db, memory, from, to, now);
  assert.equal(result.length, 3);
  assert.deepEqual(new Set(result.map(r => r.personUid)), new Set(['db-person', 'new-person', 'another-new-person']));
});

test('pending local date changes can remove or add a visit at period boundaries', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const result = reconcilePeriodRecords([visit(1)], [visit(1, { date: '2026-03-02', _dirty: true }), visit(2, { date: from, _dirty: true })], from, to, now);
  assert.deepEqual(result.map(r => r.id), [2]);
});

test('reconciliation normalizes identity without replacing state arrays or mutating nested data', async () => {
  const { reconcilePeriodRecords } = await helpers;
  const db = [visit(1, { personUid: undefined, studentId: 8, symptoms: ['두통'], counselLog: { content: '상담' } })];
  const memory = [visit(2, { personUid: 9, studentId: undefined, _dirty: true, treatmentBySym: { 두통: ['안정'] } })];
  const S = { records: memory };
  const before = structuredClone({ db, memory });
  const result = reconcilePeriodRecords(db, S.records, from, to, now);
  assert.strictEqual(S.records, memory);
  assert.deepEqual({ db, memory }, before);
  assert.equal(result.find(r => r.id === 1).personUid, '8');
  assert.equal(result.find(r => r.id === 2).studentId, '9');
  result.find(r => r.id === 1).symptoms.push('출력만 수정');
  result.find(r => r.id === 1).counselLog.content = '출력만 수정';
  result.find(r => r.id === 2).treatmentBySym.두통.push('출력만 수정');
  assert.deepEqual({ db, memory }, before);
});

test('counts visits, distinct known people, and unknown visits without collapsing them', async () => {
  const { summarizePeriodRecords } = await helpers;
  const records = [visit(1, { personUid: 12 }), visit(2, { personUid: '12' }), visit(3, { personUid: null, studentId: '13' }), visit(4, { personUid: '' }), visit(5, { personUid: null }), visit(6, { _deleted: true })];
  assert.deepEqual(summarizePeriodRecords(records), { visits: 5, people: 4, counsel: 0, treatment: 0 });
});

test('counsel count is per visit with content/action/plan/opinion, never per topic', async () => {
  const { summarizePeriodRecords } = await helpers;
  const records = [visit(1, { counselLog: { content: '내용', action: '조치', topics: ['가', '나'] } }), visit(2, { counselLog: { plan: '계획' } }), visit(3, { counselLog: { opinion: '의견' } }), visit(4, { counselLog: { topics: ['가'], route: '자발', content: '  ' } }), visit(5, { symptoms: ['상담'], counselLog: { treatmentText: '상담 처치' } })];
  assert.deepEqual(summarizePeriodRecords(records), { visits: 5, people: 5, counsel: 3, treatment: 1 });
});

test('plain text includes nested old maps, dose, free treatment memo and counsel text', async () => {
  const { periodRecordText, summarizePeriodRecords } = await helpers;
  const record = visit(1, { symptoms: ['두통', '상담'], treatment: ['안정', '투약'], treatmentBySym: { 두통: ['안정'], 상담: '경청' }, medsBySym: { 두통: ['약품A'], 상담: '옛 약품' }, medDosesBySym: { 두통: { 약품A: '1정' } }, treatmentMemo: '<자유 기입>', counselLog: { content: '상담 내용', treatmentText: '생활 안내' } });
  const before = structuredClone(record);
  const result = periodRecordText(record);
  assert.equal(result.symptom, '두통, 상담');
  assert.match(result.treatment, /두통: 안정/);
  assert.match(result.treatment, /상담: 경청/);
  assert.match(result.treatment, /<자유 기입>/);
  assert.match(result.treatment, /생활 안내/);
  assert.match(result.medication, /두통: 약품A \(1정\)/);
  assert.match(result.medication, /상담: 옛 약품/);
  assert.match(result.counsel, /상담 내용/);
  assert.deepEqual(record, before);
  assert.deepEqual(summarizePeriodRecords([record]), { visits: 1, people: 1, counsel: 1, treatment: 1 });
});

test('unbranched treatment uses current common text instead of stale symptom maps', async () => {
  const { periodRecordText } = await helpers;
  const result = periodRecordText(visit(1, { treatmentBranched: false, symptoms: ['두통', '복통'], treatment: ['현재 처치'], treatmentBySym: { 두통: ['과거 처치'] }, medsBySym: { 두통: ['과거 약품'] }, medication: '현재 약품', treatmentMemo: '현재 메모' }));
  assert.equal(result.treatment, '현재 처치\n현재 메모');
  assert.equal(result.medication, '현재 약품');
});

test('symptom text includes unique counseling topics even without symptoms or counsel content', async () => {
  const { periodRecordText, summarizePeriodRecords } = await helpers;
  const record = visit(1, { symptoms: ['상담', '학업'], counselLog: { topics: ['학업', '진로', '진로', '  '] } });
  const before = structuredClone(record);
  assert.equal(periodRecordText(record).symptom, '상담, 학업, 진로');
  assert.equal(periodRecordText(visit(2, { counselLog: { topics: ['교우 관계'] } })).symptom, '교우 관계');
  assert.equal(periodRecordText(visit(3, { counselLog: { topics: '옛 주제' } })).symptom, '옛 주제');
  assert.equal(summarizePeriodRecords([record]).counsel, 0, 'A topic alone is not a written counseling record');
  assert.deepEqual(record, before);
});

test('medication doses use each symptom and medicine pair from the DB renderer shape', async () => {
  const { periodRecordText } = await helpers;
  const record = visit(1, { medsBySym: { 두통: ['약품A', '약품B'], 복통: ['약품A'] }, medDosesBySym: { 두통: { 약품A: '1정', 약품B: '5mL' }, 복통: { 약품A: '0.5정' } } });
  assert.equal(periodRecordText(record).medication, '두통: 약품A (1정), 약품B (5mL)\n복통: 약품A (0.5정)');
});

test('treatment count is once per visit, including medicine-only and memo-only visits', async () => {
  const { summarizePeriodRecords } = await helpers;
  const records = [visit(1, { treatment: ['소독', '밴드'], medication: '약품', treatmentMemo: '메모' }), visit(2, { medication: '약품' }), visit(3, { treatmentMemo: '메모' }), visit(4, { treatmentBySym: { 두통: ['안정'] } }), visit(5, { medsBySym: { 두통: '약품' } }), visit(6)];
  assert.deepEqual(summarizePeriodRecords(records), { visits: 6, people: 6, counsel: 0, treatment: 5 });
});
