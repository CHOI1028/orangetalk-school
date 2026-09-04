/* Load production functions without booting Electron or reading real records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const symptom = read('src/renderer/features/symptom/symptom-view.js');
const dashboard = read('src/renderer/features/dashboard/dashboard-view.js');
function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'Production boundaries: ' + startMarker);
  return source.slice(start, end).replace(/^export /gm, '');
}
const production = [
  read('src/renderer/core/counsel-print-utils.js').replace(/^export /gm, ''),
  section(read('src/renderer/core/format-utils.js'), 'export function escHtml(', 'export function escJs('),
  section(symptom, 'function _symCounselLogOf(', '/* ── 상담 이력 인별 캐시'),
  section(symptom, 'function _symCounselRound(', 'function _symRenderCounselBlock('),
  section(symptom, 'function _symCounselGradeStr(', '/* 팝업 헤더용 전체 소속'),
  section(symptom, 'export function _symBuildCounselPrintHtml(', 'function _symCounselExport('),
  section(dashboard, 'function _crkResolveKey(', '/* ◂▸ 화살표 이동'),
  section(dashboard, 'function _crkFilteredRecords(', '/* PDF/인쇄 팝업'),
  section(dashboard, 'function _crkBuildPdf(', '/* 상담실적 기간 선택 달력')
].join('\n');
const student = { id: 'fixture-id', uid: 'fixture-uid', name: '검증학생', gender: '여', grade: 2, cls: 3, num: 7 };
function record(log = {}, overrides = {}) {
  return { id: 101, studentId: student.uid, date: '2026-09-01', timeIn: '09:10', nurse: '검증상담자',
    counselLog: { topics: ['건강 상담'], ...log }, ...overrides };
}
function harness(records, options = {}) {
  const before = structuredClone(records);
  const people = options.people || [student];
  const calls = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-04T10:00:00+09:00'])); }
    static now() { return new Date('2026-09-04T10:00:00+09:00').getTime(); }
  }
  const context = vm.createContext({
    Date: FixedDate,
    S: { records, settings: { schoolName: '검증학교' }, _currentUser: { name: '검증담당자' } },
    getStu: id => people.find(p => p.id === id || p.uid === id),
    _symSelectedSymptoms: [], _symIsCounselSym: () => false, _symBaseName: value => value,
    _symCounselPool: id => records.filter(r => r.studentId === id),
    _crkPerson: options.person || null,
    _crkRange: () => ({ from: '2026-09-01', to: '2026-09-30', label: '2026년 9월' }),
    _toast: text => calls.push({ mode: 'toast', text }),
    saveA4Pdf: opts => calls.push({ mode: 'pdf', ...opts }),
    openA4PrintDialog: opts => calls.push({ mode: 'print', ...opts })
  });
  vm.runInContext('"use strict";\n' + production, context);
  return {
    context,
    single(rec = records[0]) {
      const result = context._symBuildCounselPrintHtml(rec);
      assert.deepEqual(records, before, 'Printing must not modify records');
      return result;
    },
    batch(topics = ['건강 상담'], mode = 'pdf') {
      const previous = calls.length;
      context._crkBuildPdf(topics, mode);
      assert.deepEqual(records, before, 'Printing must not modify records');
      return calls.slice(previous);
    }
  };
}
module.exports = { harness, record, student, read, section };
