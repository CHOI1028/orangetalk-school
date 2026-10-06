/* Exercise production keyboard/save handlers with synthetic textarea events.
 * No renderer startup, user records, or persistent storage is used. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/features/symptom/symptom-view.js'), 'utf8');
function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'Production handler boundaries must exist: ' + startMarker);
  return source.slice(start, end);
}
const navigationSource = section('  const _symKeyNav=function(e){', '  document.addEventListener(\'keydown\',_symKeyNav);');
const treatmentKeySource = section(
  '  /* Enter = 저장 후 닫기 / Shift+Enter = 줄바꿈 / ESC = 저장 후 닫기 (사용자 요청 2026-06-26) */',
  '  ov.addEventListener(\'mousedown\',function(e){ if(e.target===ov)_clTreatClose(); });'
);

function keyboard() {
  const state = { clicks: 0, highlights: 0, closes: 0 };
  let treatmentKey;
  const context = vm.createContext({
    document: {
      getElementById: id => id === 'symCatOverlay' ? {} : null,
      querySelectorAll: selector => selector === '#symCatList .sym-cat-item'
        ? [{ click() { state.clicks++; } }] : [],
      removeEventListener() {}
    },
    _skFocus: 'cat', _skCatIdx: 0, _skSymIdx: -1,
    _skHighlight() { state.highlights++; },
    ta: { addEventListener(type, callback) { assert.equal(type, 'keydown'); treatmentKey = callback; } },
    _clTreatClose() { state.closes++; }
  });
  vm.runInContext(navigationSource + '\nglobalThis.handleNavigation = _symKeyNav;\n' + treatmentKeySource, context);
  function dispatch(target, options = {}, withTreatmentHandler = false) {
    const event = {
      key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13,
      ...options, target, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; }
    };
    // Match browser bubbling: the input's handler runs before document keydown.
    if(withTreatmentHandler) treatmentKey(event);
    if(!event.propagationStopped) context.handleNavigation(event);
    return event;
  }
  return { state, dispatch };
}

for(const field of ['content', 'action', 'plan', 'opinion']) {
  for(const shiftKey of [false, true]) {
    test(field + ': ' + (shiftKey ? 'Shift+Enter' : 'Enter') + ' preserves native textarea newline', () => {
      const h = keyboard();
      const event = h.dispatch({ tagName: 'TEXTAREA', dataset: { clField: field } }, { shiftKey });
      assert.equal(event.defaultPrevented, false);
      assert.deepEqual(h.state, { clicks: 0, highlights: 0, closes: 0 });
    });
  }
}

for(const composition of [{ isComposing: true }, { keyCode: 229 }]) {
  for(const target of [{ tagName: 'TEXTAREA' }, { tagName: 'INPUT' }, { tagName: 'DIV', isContentEditable: true }]) {
    test('IME confirmation does not trigger popup shortcuts: ' + JSON.stringify({ composition, target }), () => {
      const h = keyboard();
      assert.equal(h.dispatch(target, composition).defaultPrevented, false);
      assert.deepEqual(h.state, { clicks: 0, highlights: 0, closes: 0 });
    });
  }
}

for(const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab']) {
  test('textarea retains existing caret navigation: ' + key, () => {
    const h = keyboard();
    assert.equal(h.dispatch({ tagName: 'TEXTAREA' }, { key }).defaultPrevented, false);
    assert.equal(h.state.clicks, 0);
  });
}

test('non-text Enter still activates the keyboard-selected category', () => {
  const h = keyboard();
  assert.equal(h.dispatch({ tagName: 'BUTTON' }).defaultPrevented, true);
  assert.deepEqual(h.state, { clicks: 1, highlights: 1, closes: 0 });
});

test('ordinary single-line input Enter behavior remains unchanged', () => {
  const h = keyboard();
  assert.equal(h.dispatch({ tagName: 'INPUT' }).defaultPrevented, true);
  assert.equal(h.state.clicks, 1);
});

test('treatment summary Enter still completes without activating a background shortcut', () => {
  const h = keyboard();
  const event = h.dispatch({ tagName: 'TEXTAREA', id: 'clTreatTa' }, {}, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(h.state, { clicks: 0, highlights: 0, closes: 1 });
});

test('treatment summary Shift+Enter remains a newline after document bubbling', () => {
  const h = keyboard();
  const event = h.dispatch({ tagName: 'TEXTAREA', id: 'clTreatTa' }, { shiftKey: true }, true);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(h.state, { clicks: 0, highlights: 0, closes: 0 });
});

for(const composition of [{ isComposing: true }, { keyCode: 229 }]) {
  test('treatment summary IME confirmation does not prematurely complete: ' + JSON.stringify(composition), () => {
    const h = keyboard();
    const event = h.dispatch({ tagName: 'TEXTAREA', id: 'clTreatTa' }, composition, true);
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(h.state, { clicks: 0, highlights: 0, closes: 0 });
  });
}

test('counsel save preserves multiline text and blank fields verbatim', () => {
  const values = { content: '  첫 줄\n둘째 줄\n\n마지막 줄  ', action: '', plan: '\n', opinion: '의견\n다음 줄' };
  const record = { id: 1, counselLog: { treatmentText: '기존 처치 문구' } };
  let saved;
  const context = vm.createContext({
    S: { records: [record] },
    document: { querySelector: () => ({ querySelectorAll: () => Object.entries(values).map(([clField, value]) => ({ dataset: { clField }, value })) }) },
    _symCounselLogOf: r => r.counselLog,
    _symSelectedSymptoms: ['학업'], _symIsCounselSym: () => true, _symBaseName: s => s,
    saveRecordNow: r => { saved = structuredClone(r); }, bus: { emit() {} }
  });
  vm.runInContext(section('function _symCounselSaveNow(recId){', 'function _symCounselQueueSave('), context);
  context.getDailyRecord=id=>context.S.records.find(r=>r.id===id);
  context._symCounselSaveNow(1);
  for(const [field, value] of Object.entries(values)) assert.equal(saved.counselLog[field], value);
  assert.equal(saved.counselLog.treatmentText, '기존 처치 문구');
  assert.deepEqual(saved.counselLog.topics, ['학업']);
});
