'use strict';

// Real modal filtering functions, synthetic roster only. No app, browser or database starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const view = fs.readFileSync(path.resolve(__dirname, '../src/renderer/features/person-manager/person-manager-view.js'), 'utf8');
const helper = fs.readFileSync(path.resolve(__dirname, '../src/renderer/core/care-registration.js'), 'utf8').replace(/^export /gm, '');
const tree = acorn.parse(view, { ecmaVersion: 'latest', sourceType: 'module' });
function sourceFunction(name) {
  const node = tree.body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n)
    .find(n => n && n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, 'Missing production function: ' + name);
  return view.slice(node.start, node.end);
}
function student(extra = {}) {
  return { uid: 'synthetic-student', id: 'synthetic-student', type: 'student', name: '가상학생',
    grade: 3, cls: 2, num: 4, level: 'elementary', department: '', is_enrolled: 1, ...extra };
}
function harness(people, leavers = []) {
  const context = vm.createContext({ S: { people, leavers }, _apCmRender() {} });
  vm.runInContext(helper + '\nlet _apCmState=null;\n' + ['_apCmOpen', '_apCmSyncFiltersToItem', '_apCmGetGrades', '_apCmGetDepartments']
    .map(sourceFunction).join('\n'), context);
  return {
    open(row, cfg = { activeOnly: true, waitForSave: true }) {
      context.testRow = row; context.testCfg = cfg;
      vm.runInContext('_apCmOpen([testRow],testCfg)', context);
      return this.state();
    },
    sync(row) { context.testRow = row; vm.runInContext('_apCmSyncFiltersToItem(testRow)', context); return this.state(); },
    state: () => vm.runInContext('_apCmState', context),
    candidates() {
      const st = this.state();
      return st.students.filter(s => (!st.selectedLevel || !s.level || s.level === st.selectedLevel)
        && (st.selectedGrade === '' || String(s.grade) === String(st.selectedGrade))
        && (!st.selectedDept || String(s.department || '').trim() === String(st.selectedDept)));
    }
  };
}

for (const [stored, incoming] of [
  ['elementary', '초'], ['elementary', '초등학교'], ['초', 'ELEMENTARY'],
  ['middle', '중학교'], ['high', '고등'], ['kindergarten', '유치원'], ['special', '특수학교']
]) {
  test('manual modal translates the incoming level to its actual roster option: ' + stored + '/' + incoming, () => {
    const s = student({ level: stored });
    const h = harness([s]);
    const st = h.open({ level: incoming, grade: 3 });
    assert.equal(st.selectedLevel, stored);
    assert.equal(st.levels.length, 1);
    assert.equal(h.candidates()[0], s);
  });
}

for (const row of [{}, { level: '학교급 오타', grade: 3 }, { level: '초등학교', grade: 99 },
  { level: '없는 학교', grade: '없는 학년', cls: '없는 반' }, { level: '초', grade: 0 }]) {
  test('invalid or missing incoming filters fall back to an available student: ' + JSON.stringify(row), () => {
    const s = student();
    const h = harness([s]);
    h.open(row);
    assert.equal(h.candidates()[0], s);
  });
}

for (const grade of ['03', '3학년', '03.0', ' 3 ']) {
  test('manual numeric grade uses the real roster value: ' + grade, () => {
    const h = harness([student()]);
    const st = h.open({ level: '초등학교', grade });
    assert.equal(st.selectedGrade, '3');
    assert.equal(h.candidates().length, 1);
  });
}

test('named kindergarten age and class are preserved; wrong incoming class never filters every student out', () => {
  const s = student({ level: 'kindergarten', grade: '만5세', cls: '나래', num: 0 });
  const h = harness([s]);
  const st = h.open({ level: '유', grade: '만5세', cls: '없는 반' });
  assert.equal(st.selectedGrade, '만5세');
  assert.equal(st.students[0].cls, '나래');
  assert.equal(h.candidates()[0], s);
});

test('navigation translates each next row school alias and resets unavailable grade', () => {
  const elementary = student();
  const middle = student({ uid: 'synthetic-middle', level: 'middle', grade: 1 });
  const h = harness([elementary, middle]);
  h.open({ level: '초등학교', grade: 3 });
  let st = h.sync({ level: '중', grade: 9 });
  assert.equal(st.selectedLevel, 'middle');
  assert.equal(st.selectedGrade, '1');
  assert.equal(h.candidates()[0], middle);
  st = h.sync({ level: 'ELEMENTARY', grade: '03' });
  assert.equal(st.selectedLevel, 'elementary');
  assert.equal(h.candidates()[0], elementary);
});

test('unknown next school level keeps an available current option without trapping the modal', () => {
  const h = harness([student(), student({ level: 'middle', grade: 1 })]);
  h.open({ level: '중학교', grade: 1 });
  const st = h.sync({ level: '잘못된 학교급', grade: 99 });
  assert.equal(st.selectedLevel, 'middle');
  assert.equal(h.candidates().length, 1);
});

test('missing school levels in legacy roster retain available grades and candidates', () => {
  const h = harness([student({ level: '' })]);
  const st = h.open({ level: '초등학교', grade: '99' });
  assert.equal(st.selectedLevel, '');
  assert.equal(st.selectedGrade, '3');
  assert.equal(h.candidates().length, 1);
});

test('department fallback uses a department populated in the selected grade', () => {
  const grade1 = student({ uid: 'grade1', grade: 1, level: 'high', department: '가학과' });
  const grade3 = student({ uid: 'grade3', grade: 3, level: 'high', department: '나학과' });
  const h = harness([grade1, grade3]);
  let st = h.open({ level: '고등학교', grade: 3, department: '가학과' });
  assert.equal(st.selectedGrade, '3');
  assert.equal(st.selectedDept, '나학과');
  assert.equal(h.candidates()[0], grade3);
  st = h.sync({ level: '고', grade: 1, department: '없는 학과' });
  assert.equal(st.selectedDept, '가학과');
  assert.equal(h.candidates()[0], grade1);
});

test('unassigned department can remain visible in an otherwise populated department school', () => {
  const unassigned = student({ grade: 3, department: '' });
  const assigned = student({ uid: 'synthetic-assigned', grade: 1, department: '가상학과' });
  const h = harness([unassigned, assigned]);
  const st = h.open({ level: '초', grade: 3, department: '가상학과' });
  assert.equal(st.selectedDept, '');
  assert.equal(h.candidates()[0], unassigned);
});

test('empty roster does not invent students or throw when incoming filters are present', () => {
  const h = harness([]);
  const st = h.open({ level: '초', grade: 3 });
  assert.equal(st.selectedLevel, '');
  assert.equal(st.selectedGrade, '');
  assert.equal(h.candidates().length, 0);
});

test('care modal still excludes leavers and preserves the non-care manual modal ability to select them', () => {
  const active = student();
  const left = student({ uid: 'synthetic-left', id: 'synthetic-left', level: 'middle', grade: 1, is_enrolled: 0 });
  const care = harness([active], [left]);
  care.open({ level: '중학교', grade: 1 });
  assert.equal(care.state().students.length, 1);
  assert.equal(care.candidates()[0], active);
  const other = harness([active], [left]);
  other.open({ level: '중학교', grade: 1 }, { activeOnly: false });
  assert.equal(other.state().students.length, 2);
  assert.equal(other.state().selectedLevel, 'middle');
  assert.equal(other.candidates()[0].uid, left.uid);
});
