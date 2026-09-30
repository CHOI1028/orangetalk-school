/* Execute the production close handlers in isolation with synthetic DOM nodes.
 * No renderer startup, audio hardware, user records, or persistent storage. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8').replace(/\r\n/g, '\n');
}
function section(text, startMarker, endMarker, includeEnd = false) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'Production handler boundaries must exist: ' + startMarker);
  return text.slice(start, end + (includeEnd ? endMarker.length : 0));
}

const closeSource = section(source('core/ui-utils.js'),
  'export function closeModalGracefully(', 'export function createEmptyState(').replace(/^export /, '');
const commands = source('core/command-palette.js');
const shortcutSource = section(commands, 'function _gsFindTopModal(){', 'function _gsFindPrimaryBtn(')
  + section(commands, "document.addEventListener('keydown',function(e){\n  const mod=e.metaKey||e.ctrlKey;", '\n});', true);
const escapeSource = section(source('core/event-bindings.js'),
  "  document.addEventListener('keydown', function(e){\n    if(e.key !== 'Escape') return;", '  }, false);', true);
const visitPassSource = section(source('features/visit-pass/visit-pass-editor.js'),
  "document.addEventListener('keydown', function(e){\n  if(e.key==='Escape'){\n    /* 침상 관련 팝업 우선 */", '\n});', true);

function modal(id, options = {}) {
  const classes = new Set(options.classes || ['modal-overlay', 'show']);
  const events = new Map();
  return {
    id, isConnected: options.isConnected !== false, parentNode: {}, removes: 0,
    style: { display: 'flex', visibility: 'visible', zIndex: '1', ...options.style },
    classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
    querySelector() { return this.content || null; },
    contains(el) { return el && el.parentNode === this; },
    addEventListener(type, fn) { events.set(type, fn); },
    removeEventListener(type, fn) { if(events.get(type) === fn) events.delete(type); },
    emit(type, target = this) { const fn = events.get(type); if(fn) fn({ target }); },
    remove() { this.removes++; this.isConnected = false; this.parentNode = null; }
  };
}

function harness(handlerSource = '', modals = [], activeElement = null) {
  const handlers = [];
  const timers = [];
  const state = { emsCloses: 0, visitCloses: 0 };
  const context = vm.createContext({
    document: {
      activeElement,
      getElementById: id => modals.find(m => m.id === id && m.isConnected) || null,
      querySelectorAll: () => modals,
      addEventListener(type, fn) { assert.equal(type, 'keydown'); handlers.push(fn); }
    },
    getComputedStyle: el => el.style,
    setTimeout(fn, ms) { timers.push({ fn, ms }); },
    closeEmsMsg() { state.emsCloses++; },
    closeVisitPass() { state.visitCloses++; }
  });
  vm.runInContext(closeSource + '\n' + handlerSource, context);
  function key(options = {}) {
    const event = {
      key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options
    };
    handlers.forEach(fn => fn(event));
    return event;
  }
  return { context, key, timers, state };
}

function trackClose(el) {
  const calls = [];
  el._onModalClose = function() { calls.push(this); };
  return calls;
}

for(const byId of [false, true]) {
  test('closeModalGracefully delegates synchronously once using ' + (byId ? 'ID' : 'element'), () => {
    const alarm = modal('bedAlarmOverlay');
    const calls = trackClose(alarm);
    const h = harness('', [alarm]);
    h.context.closeModalGracefully(byId ? alarm.id : alarm);
    assert.deepEqual(calls, [alarm]);
    assert.equal(alarm.removes, 0);
    assert.equal(alarm.classList.contains('modal-closing'), false);
    assert.equal(h.timers.length, 0);
  });
}

test('missing and disconnected elements never invoke a close hook', () => {
  const alarm = modal('bedAlarmOverlay', { isConnected: false });
  const calls = trackClose(alarm);
  const h = harness('', [alarm]);
  h.context.closeModalGracefully(null);
  h.context.closeModalGracefully('missing');
  h.context.closeModalGracefully(alarm);
  assert.equal(calls.length, 0);
  assert.equal(h.timers.length, 0);
});

test('unhooked graceful close retains animation, duplicate guard, and timeout safety', () => {
  const el = modal('ordinaryOverlay');
  el.content = modal('content', { classes: ['modal-content'] });
  const h = harness('', [el]);
  h.context.closeModalGracefully(el);
  h.context.closeModalGracefully(el);
  assert.equal(el.classList.contains('modal-closing'), true);
  assert.equal(el.content.style.willChange, 'transform, opacity');
  assert.equal(el.removes, 0);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 500);
  el.content.emit('animationend', {});
  assert.equal(el.removes, 0);
  el.content.emit('animationend');
  h.timers[0].fn();
  assert.equal(el.removes, 1);
});

test('nonfunction close properties retain the graceful timeout fallback', () => {
  const el = modal('ordinaryOverlay');
  el._onModalClose = true;
  const h = harness('', [el]);
  h.context.closeModalGracefully(el);
  h.timers[0].fn();
  assert.equal(el.removes, 1);
});

const routes = [
  { name: 'Ctrl+W', source: shortcutSource, event: { key: 'w', ctrlKey: true } },
  { name: 'Cmd+W', source: shortcutSource, event: { key: 'W', metaKey: true } },
  { name: 'global Escape', source: escapeSource, event: { key: 'Escape' } }
];
for(const route of routes) {
  test(route.name + ' calls the top visible alarm hook exactly once', () => {
    const lower = modal('bedManagerOverlay');
    const alarm = modal('bedAlarmOverlay', { style: { zIndex: '100' } });
    const hidden = modal('hiddenOverlay', { style: { zIndex: '200', display: 'none' } });
    const invisible = modal('invisibleOverlay', { style: { zIndex: '300', visibility: 'hidden' } });
    const detached = modal('detachedOverlay', { isConnected: false, style: { zIndex: '400' } });
    const calls = trackClose(alarm);
    const otherCalls = [lower, hidden, invisible, detached].map(trackClose);
    const h = harness(route.source, [lower, alarm, hidden, invisible, detached]);
    assert.equal(h.key(route.event).defaultPrevented, true);
    assert.deepEqual(calls, [alarm]);
    assert(otherCalls.every(list => list.length === 0));
    assert.equal(alarm.removes, 0);
    assert.equal(alarm.classList.contains('show'), true);
    assert.equal(h.timers.length, 0);
  });

  for(const classes of [['modal-overlay', 'show'], ['sv-modal-overlay']]) {
    test(route.name + ' preserves unhooked ' + classes.join('.') + ' close behavior', () => {
      const lower = modal('lowerOverlay');
      const el = modal('ordinaryOverlay', { classes, style: { zIndex: '100' } });
      const h = harness(route.source, [lower, el]);
      assert.equal(h.key(route.event).defaultPrevented, true);
      assert.equal(el.classList.contains('show'), false);
      assert.equal(el.removes, classes.includes('show') ? 0 : 1);
      assert.equal(lower.classList.contains('show'), true);
      assert.equal(lower.removes, 0);
      assert.equal(h.timers.length, 0);
    });
  }
}

test('plain W, Shift+Ctrl+W, and Alt+Ctrl+W retain their existing behavior', () => {
  const alarm = modal('bedAlarmOverlay');
  const calls = trackClose(alarm);
  const h = harness(shortcutSource, [alarm]);
  for(const event of [{ key: 'w' }, { key: 'w', ctrlKey: true, shiftKey: true }, { key: 'w', ctrlKey: true, altKey: true }]) {
    assert.equal(h.key(event).defaultPrevented, false);
  }
  assert.equal(calls.length, 0);
  assert.equal(alarm.removes, 0);
});

test('global Escape keeps the existing focused-input blur behavior for unhooked modals', () => {
  const el = modal('ordinaryOverlay');
  let blurs = 0;
  const input = { tagName: 'INPUT', parentNode: el, blur() { blurs++; } };
  const h = harness(escapeSource, [el], input);
  assert.equal(h.key().defaultPrevented, false);
  assert.equal(blurs, 1);
  assert.equal(el.classList.contains('show'), true);
  assert.equal(el.removes, 0);
});

test('visit-pass Escape routes through the alarm hook before bed settings or manager', () => {
  const alarm = modal('bedAlarmOverlay');
  const config = modal('bedConfigOverlay');
  const manager = modal('bedManagerOverlay');
  const calls = trackClose(alarm);
  const h = harness(visitPassSource, [config, manager, alarm]);
  // _bedDismissAlarm deliberately does not exist in this module's VM context.
  assert.equal(typeof h.context._bedDismissAlarm, 'undefined');
  assert.doesNotThrow(() => h.key());
  assert.deepEqual(calls, [alarm]);
  assert.equal(config.classList.contains('modal-closing'), false);
  assert.equal(manager.classList.contains('modal-closing'), false);
  assert.equal(h.timers.length, 0);
  assert.deepEqual(h.state, { emsCloses: 0, visitCloses: 0 });
});

for(const id of ['bedConfigOverlay', 'bedManagerOverlay']) {
  test('visit-pass Escape preserves graceful closing for ' + id, () => {
    const el = modal(id);
    const h = harness(visitPassSource, [el]);
    h.key();
    assert.equal(el.classList.contains('modal-closing'), true);
    assert.equal(h.timers.length, 1);
    h.timers[0].fn();
    assert.equal(el.removes, 1);
  });
}

for(const [id, field] of [['emsOverlay', 'emsCloses'], ['vpOverlay', 'visitCloses']]) {
  test('visit-pass Escape preserves the existing close callback for ' + id, () => {
    const h = harness(visitPassSource, [modal(id)]);
    h.key();
    assert.equal(h.state[field], 1);
    assert.equal(h.timers.length, 0);
  });
}
