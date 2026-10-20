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


// 최근 방문 이력은 별도 카드에서 조작하고, 배경 클릭만 기존 완료 경로로 전달한다.
function dismissalHarness() {
  const overlayEvents={}, buttonEvents={}, nodes={};
  const calls={close:0,stop:0,prevent:0};
  const window={};
  const document={top:null,querySelector(){return this.top;},getElementById(id){return nodes[id]||null;}};
  const button={addEventListener(type,fn){buttonEvents[type]=fn;}};
  const overlay={
    addEventListener(type,fn){overlayEvents[type]=fn;},
    querySelector(selector){return selector==='[data-action="closeSymptomPopup"]'?button:null;}
  };
  const context=vm.createContext({document,window,_symComplete(){calls.close++;}});
  vm.runInContext(definition('_bindSymptomDismissal'),context);
  context._bindSymptomDismissal(overlay);
  const event=(target,key,mouseButton=0)=>({target,key,button:mouseButton,stopPropagation(){calls.stop++;},preventDefault(){calls.prevent++;}});
  const clickOutside=()=>{overlayEvents.mousedown(event(overlay));overlayEvents.click(event(overlay));};
  return {overlay,button,overlayEvents,buttonEvents,calls,event,clickOutside,document,window,nodes};
}
test('배경에서 누르고 클릭하면 기존 완료 함수를 한 번 호출한다',()=>{
  const h=dismissalHarness();h.document.top=h.overlay;h.clickOutside();
  assert.equal(h.calls.close,1);assert.equal(h.calls.stop,2);assert.equal(h.calls.prevent,0);
});
test('팝업 내부 클릭으로는 닫히지 않는다',()=>{
  const h=dismissalHarness();const inside={};
  h.overlayEvents.mousedown(h.event(inside));h.overlayEvents.click(h.event(inside));
  assert.equal(h.calls.close,0);assert.equal(h.calls.stop,2);
});
test('창 안에서 시작해 바깥에서 끝난 드래그는 닫기로 처리하지 않는다',()=>{
  const h=dismissalHarness();
  h.overlayEvents.mousedown(h.event({}));h.overlayEvents.click(h.event(h.overlay));
  assert.equal(h.calls.close,0);
});
test('마우스 누름 없이 발생한 배경 클릭으로는 닫히지 않는다',()=>{
  const h=dismissalHarness();h.overlayEvents.click(h.event(h.overlay));
  assert.equal(h.calls.close,0);
});
test('우클릭으로는 작성창을 닫지 않는다',()=>{
  const h=dismissalHarness();
  h.overlayEvents.mousedown(h.event(h.overlay,undefined,2));h.overlayEvents.click(h.event(h.overlay,undefined,2));
  assert.equal(h.calls.close,0);
});
test('창으로 복귀하는 클릭은 작성 완료로 처리하지 않는다',()=>{
  const h=dismissalHarness();h.window._symFocusJustReturned=true;h.clickOutside();
  assert.equal(h.calls.close,0);
});
test('다른 팝업이 최상위이면 증상 작성창은 닫지 않는다',()=>{
  const h=dismissalHarness();h.document.top={id:'anotherOverlay'};h.clickOutside();
  assert.equal(h.calls.close,0);
});
for(const id of ['symHistoryOverlay','bmOverlay','symMedPopup']){
  test('자식 창이 열려 있을 때 배경 클릭으로 부모를 닫지 않는다: '+id,()=>{
    const h=dismissalHarness();h.nodes[id]={};h.clickOutside();assert.equal(h.calls.close,0);
  });
}
test('열린 설정 창을 닫는 클릭이 작성 완료로 전달되지 않는다',()=>{
  const h=dismissalHarness();h.nodes.settingsModal={classList:{contains:()=>true}};h.clickOutside();
  assert.equal(h.calls.close,0);
});
test('숨겨진 설정 창은 배경 닫기를 막지 않는다',()=>{
  const h=dismissalHarness();h.nodes.settingsModal={classList:{contains:()=>false}};h.clickOutside();
  assert.equal(h.calls.close,1);
});
test('닫기 버튼은 기존 완료 함수를 한 번 호출한다',()=>{
  const h=dismissalHarness();h.buttonEvents.click(h.event(h.button));
  assert.equal(h.calls.close,1);assert.equal(h.calls.stop,1);assert.equal(h.calls.prevent,1);
});
for(const key of ['Enter',' ','Tab']){
  test('닫기 버튼의 기본 키 동작을 증상 단축키가 가로채지 않는다: '+JSON.stringify(key),()=>{
    const h=dismissalHarness();h.buttonEvents.keydown(h.event(h.button,key));
    assert.equal(h.calls.stop,1);assert.equal(h.calls.prevent,0);assert.equal(h.calls.close,0);
  });
}
test('닫기 버튼에서 Esc는 기존 팝업 닫기 경로에 전달한다',()=>{
  const h=dismissalHarness();h.buttonEvents.keydown(h.event(h.button,'Escape'));
  assert.equal(h.calls.stop,0);assert.equal(h.calls.prevent,0);
});
test('증상 팝업은 닫기 버튼과 배경 닫기를 같은 완료 경로에 연결한다',()=>{
  assert(source.includes('data-action="closeSymptomPopup"'));
  assert(source.includes('_bindSymptomDismissal(ov);'));
  assert(!source.includes('if(e.clientX>=_r.left && e.clientX<=_r.right)return;'));
});
test('전체 이력의 Esc 닫기를 증상 작성창 완료보다 먼저 처리한다',()=>{
  const keyStart=source.indexOf('const _symKeyNav=function(e)');
  const guard=source.indexOf("if(document.getElementById('symHistoryOverlay')){",keyStart);
  const close=source.indexOf("if(e.key==='Escape'){_symComplete();",keyStart);
  assert(guard>keyStart&&guard<close);
  assert(source.slice(guard,close).includes("if(e.key==='Escape'){e.preventDefault();_symCloseHistory();}"));
});
