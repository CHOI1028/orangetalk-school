'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/features/symptom/symptom-view.js'), 'utf8');
function definition(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, name + ' end');
  return source.slice(start, end + 2);
}
const emptySource = definition('_symRecordIsEmpty');
const isEmpty = vm.runInNewContext('(' + emptySource + ')');
const emptyCases = [
  ['blank record', {}],
  ['blank arrays and whitespace', {symptoms:[' '], treatment:[], treatmentMemo:' \n '}],
  ['empty structured data', {physicalAssessment:{items:[], details:{}}, vsHistory:[], counselLog:{}}],
  ['automatic metadata only', {id:1, date:'2026-09-02', timeIn:'10:00', nurseId:1, _autoCreated:true}]
];
for (const [name, record] of emptyCases) {
  test('empty: ' + name, () => assert.equal(isEmpty(record), true));
}
const contentCases = [
  ['symptom', {symptoms:['headache']}],
  ['treatment', {treatment:['rest']}],
  ['medication', {medication:'medicine'}],
  ['memo', {memo:'note'}],
  ['legacy treatment memo', {treatmentMemo:'preserve this note'}],
  ['assessment item', {physicalAssessment:{items:['observation'], details:{}}}],
  ['assessment detail', {physicalAssessment:{items:[], details:{note:'observed'}}}],
  ['assessment numeric zero', {physicalAssessment:{items:[], details:{pain:0}}}],
  ['vital-sign history', {vsHistory:[{temp:'36.5'}]}],
  ['counseling log', {counselLog:{treatmentText:'follow-up'}}],
  ['body map', {bodymapData:[{part:'left-hand'}]}],
  ['vital sign', {temp:'36.5'}],
  ['attention tag', {vipTags:['allergy']}]
];
for (const [name, record] of contentCases) {
  test('preserve: ' + name, () => assert.equal(isEmpty(record), false));
}
test('missing record is not a deletion candidate', () => assert.equal(isEmpty(null), false));
function closeHarness(record, preserve = false) {
  const calls = {save:0, dispose:0, remove:0, render:0, deleted:[]};
  const timers = [];
  let connected = true;
  const overlay = {
    dataset:{preserveEmptyRecord:String(preserve)}, style:{},
    _disposeKeyNav(){calls.dispose++;},
    remove(){connected=false;calls.remove++;}
  };
  const S = {records:[record], dailyLockedStudentId:'student', _visitHistoryLocked:true};
  const context = vm.createContext({
    S, _symPopupRecId:record.id, getDailyRecord:() => record,
    _symAutoSave:() => {calls.save++;},
    document:{getElementById:id => id==='symCatOverlay' && connected ? overlay : null},
    window:{electronAPI:{recordsDailyDelete:id => {calls.deleted.push(id);return Promise.resolve();}}},
    bus:{emit:() => {calls.render++;}}, console,
    setTimeout:callback => {timers.push(callback);}
  });
  vm.runInContext(emptySource + '\n' + definition('_symComplete'), context);
  return {calls, timers, S, overlay, close:() => context._symComplete()};
}
test('empty visit closes through save/delete/unlock exactly once', () => {
  const h = closeHarness({id:7, _dbId:17});
  h.close(); h.close();
  assert.equal(h.calls.save,1);
  assert.equal(h.calls.dispose,1);
  assert.deepEqual(h.calls.deleted,[17]);
  assert.equal(h.S.records.length,0);
  assert.equal(h.S.dailyLockedStudentId,null);
  assert.equal(h.S._visitHistoryLocked,false);
  assert.equal(h.timers.length,1);
  h.timers[0](); h.close();
  assert.equal(h.calls.remove,1);
  assert.equal(h.calls.render,1);
  assert.equal(h.calls.save,1);
});
test('memo-only visit survives close', () => {
  const h = closeHarness({id:8, treatmentMemo:'preserve this note'});
  h.close();
  assert.deepEqual(h.calls.deleted,[]);
  assert.equal(h.S.records.length,1);
});
test('history view preserve-empty flag is honored', () => {
  const h = closeHarness({id:9}, true);
  h.close();
  assert.deepEqual(h.calls.deleted,[]);
  assert.equal(h.S.records.length,1);
});
test('popup uses generic modal close hook and disposes its keyboard handler', () => {
  assert.match(source, /ov\._onModalClose\s*=\s*_symComplete/);
  assert.match(source, /ov\._disposeKeyNav\s*=\s*function\(\)\{document\.removeEventListener\('keydown',_symKeyNav\)/);
});
test('handled child Escape is ignored by parent keyboard handler', () => {
  assert.match(source, /const _symKeyNav=function\(e\)\{\s*if\(e\.key==='Escape' && e\.defaultPrevented\)return;/);
});
