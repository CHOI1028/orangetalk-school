/* Execute production integration handlers with synthetic state only.
 * No application startup, actual records, database, or user storage is used. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../src/renderer/', file), 'utf8');
const daily = read('features/daily/daily-view.js');
const autocomplete = read('features/daily/daily-autocomplete.js');
const router = read('features/shell/view-router.js');
function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'Production handler boundaries must exist: ' + startMarker);
  return source.slice(start, end);
}
function named(source, name, async = false) {
  const marker = (async ? 'async ' : '') + 'function ' + name + '(';
  return section(source, marker, '\n}') + '\n}';
}
function harness(extra = {}) {
  const events = [];
  const state = { active: true, refreshes: 0, renders: 0, registered: 0 };
  const context = vm.createContext({
    S: { selectedDate: '2026-09-20', currentView: 'daily', nextId: 1, settings: {} },
    isDailyPeriodSearchActive: () => state.active,
    closeDailyPeriodSearch(notify) { events.push(['close', notify]); const old = state.active; state.active = false; return old; },
    refreshDailyPeriodSearch() { state.refreshes++; },
    renderDaily() { state.renders++; },
    renderCalendar() {}, renderSidebarRecent() {}, updateDailyDateLabel() {},
    _dailyAnimateTransition() { state.renders++; }, _focusDailySearch() {},
    toDateStr: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
    dateObj: date => new Date(date + 'T12:00:00'),
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    ...extra
  });
  return { state, events, context };
}

test('period render refreshes results before touching the hidden editable table', () => {
  const h = harness({ document: { getElementById() { throw Error('Editable table was accessed'); } } });
  vm.runInContext(named(daily, 'renderDaily'), h.context);
  h.context.renderDaily();
  assert.equal(h.state.refreshes, 1);
});

for(const [name, expected] of [['goToPrevDay', '2026-09-19'], ['goToNextDay', '2026-09-21']]) {
  test(name + ' exits range mode and renders the adjacent daily date', () => {
    const h = harness({ toDateStr: date => date.toISOString().slice(0, 10) });
    vm.runInContext(named(daily, name), h.context);
    h.context[name]();
    assert.equal(h.state.active, false);
    assert.equal(h.context.S.selectedDate, expected);
    assert.equal(h.state.renders, 1);
    assert.deepEqual(h.events, [['close', false]]);
  });
}

test('calendar selection exits range mode and selects the requested day', () => {
  const h = harness();
  vm.runInContext(named(daily, 'selectDate'), h.context);
  h.context.selectDate('2026-09-03');
  assert.equal(h.state.active, false);
  assert.equal(h.context.S.selectedDate, '2026-09-03');
  assert.equal(h.state.renders, 1);
});

test('Today exits range mode even when its selected date was already today', () => {
  const h = harness({ toDateStr: () => '2026-09-20' });
  vm.runInContext(named(daily, 'goToToday'), h.context);
  h.context.goToToday();
  assert.equal(h.state.active, false);
  assert.equal(h.state.renders, 1);
});

test('an unavailable next day still restores the daily table after closing range mode', () => {
  const h = harness({ toDateStr: () => '2026-09-20' });
  vm.runInContext(named(daily, 'goToNextDay'), h.context);
  h.context.goToNextDay();
  assert.equal(h.state.active, false);
  assert.equal(h.state.renders, 1);
  assert.equal(h.context.S.selectedDate, '2026-09-20');
});

const keyboardSource = 'document.addEventListener(\'keydown\',function(e){' + section(
  daily,
  '  /* 공통 — 입력 필드/편집 가능 요소 포커스 시 모두 스킵 (브라우저 기본 동작에 양보) */',
  '\n});'
) + '\n});';
function keyboard(cat, active = true, currentView = 'daily') {
  let keydown;
  const calls = { undo: 0, deleted: 0, selected: 0 };
  const h = harness({
    document: {
      activeElement: {},
      addEventListener(type, callback) { assert.equal(type, 'keydown'); keydown = callback; },
      getElementById: id => ({ classList: { contains: () => id === 'dailyCat-' + cat } }),
      querySelector: () => null,
      querySelectorAll: () => [{ dataset: { recId: '7' }, classList: { add() { calls.selected++; } } }]
    },
    _undoStack: [{}], _dragSelectedRecIds: [7],
    dailyUndoDelete() { calls.undo++; }, dailyBulkDelete() { calls.deleted++; },
    dailyShowToast() {}
  });
  h.state.active = active;
  h.context.S.currentView = currentView;
  vm.runInContext(keyboardSource, h.context);
  return { calls, dispatch(options) {
    const event = { key: '', ctrlKey: false, metaKey: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...options };
    keydown(event);
    return event;
  } };
}

for(const event of [{ key: 'Delete' }, { key: 'Backspace' }, { key: 'a', ctrlKey: true }, { key: 'z', ctrlKey: true }]) {
  test('readonly range leaves hidden-table shortcut inactive: ' + event.key, () => {
    const h = keyboard('general');
    assert.equal(h.dispatch(event).prevented, false);
    assert.deepEqual(h.calls, { undo: 0, deleted: 0, selected: 0 });
  });
}

test('ordinary general table still selects its rows with Ctrl+A', () => {
  const h = keyboard('general', false);
  assert.equal(h.dispatch({ key: 'a', ctrlKey: true }).prevented, true);
  assert.equal(h.calls.selected, 1);
});

for(const [cat, view] of [['emergency', 'daily'], ['infection', 'daily'], ['general', 'dashboard']]) {
  test(cat + '/' + view + ' cannot undo background daily deletions', () => {
    const h = keyboard(cat, false, view);
    assert.equal(h.dispatch({ key: 'z', ctrlKey: true }).prevented, false);
    assert.equal(h.calls.undo, 0);
  });
}

test('range mode suppresses stale autocomplete and its registration keys', () => {
  const h = harness({ document: { getElementById() { throw Error('Autocomplete accessed'); }, querySelectorAll() { throw Error('Autocomplete keys accessed'); } } });
  vm.runInContext(named(autocomplete, 'dailyAutoComplete') + named(autocomplete, 'dailySearchKeydown'), h.context);
  h.context.dailyAutoComplete();
  h.context.dailySearchKeydown({ key: 'Enter' });
});

test('range results allow normal text selection without starting hidden-table drag selection', () => {
  const listeners = {};
  const h = harness({
    _dd: {},
    document: {
      addEventListener(type, callback) { listeners[type] = callback; },
      getElementById() { throw Error('Hidden table drag accessed'); }
    }
  });
  vm.runInContext(named(daily, 'dailyInitDrag'), h.context);
  h.context.dailyInitDrag();
  listeners.mousedown({ preventDefault() { throw Error('Native text selection prevented'); } });
  assert.equal(h.context._dd.active, undefined);
});

test('opening range mode cancels pending drag and clears stale daily selections', () => {
  let onOpen;
  const cleanup = [];
  const h = harness({
    bus: { on(name, callback) { assert.equal(name, 'daily:period-open'); onOpen = callback; } },
    dailyCloseCtxPopup() { cleanup.push('popup'); },
    dailyClearDragSelect() { cleanup.push('selection'); },
    _dd: { active: true, moved: true, lastClickIdx: 4, box: { remove() { cleanup.push('box'); } } },
    _ddAutoScrollRaf: 123, _ddLastMoveEvent: {}, _calFocusActive: true,
    cancelAnimationFrame(id) { assert.equal(id, 123); cleanup.push('scroll'); },
    _hideVisitHistory() { cleanup.push('history'); }
  });
  h.context.S.dailySelectedRecId = 7;
  h.context.S.dailyLockedStudentId = 'synthetic-1';
  h.context.S._visitHistoryLocked = true;
  vm.runInContext(section(daily, "bus.on('daily:period-open', function(){", "bus.on('render:daily', function(){"), h.context);
  onOpen();
  assert.deepEqual(cleanup, ['popup', 'selection', 'scroll', 'box', 'history']);
  assert.equal(h.context._dd.active, false);
  assert.equal(h.context._ddAutoScrollRaf, null);
  assert.equal(h.context._calFocusActive, false);
  assert.equal(h.context.S.dailySelectedRecId, null);
  assert.equal(h.context.S.dailyLockedStudentId, null);
  assert.equal(h.context.S._visitHistoryLocked, false);
});

for(const cancel of [true, false]) {
  test('direct registration ' + (cancel ? 'preserves range mode when cancelled' : 'exits range mode before adding a record'), async () => {
    const h = harness({
      _dailyDateGuard: async () => cancel ? 'cancel' : 'selected',
      getStu: () => ({ name: 'Synthetic student' }),
      localStorage: { getItem: () => null }, window: {},
      saveData() {}, isBirthdayToday: () => false, setTimeout() {},
      addRecord() { assert.equal(h.state.active, false); h.state.registered++; }
    });
    vm.runInContext(named(autocomplete, 'selectStudent', true), h.context);
    await h.context.selectStudent('synthetic-1');
    assert.equal(h.state.active, cancel);
    assert.equal(h.state.registered, cancel ? 0 : 1);
  });
}

test('privacy toggle refreshes active readonly results after saving the setting', () => {
  const saved = [];
  const h = harness({ _privacyOn: false, _applyPrivacyToRows() {}, localStorage: { setItem: (...args) => saved.push(args) } });
  vm.runInContext(named(daily, 'togglePrivacyMode'), h.context);
  h.context.togglePrivacyMode(true);
  assert.deepEqual(saved, [['ec_privacy_mode', '1']]);
  assert.equal(h.state.refreshes, 1);
});

for(const cat of ['general', 'emergency', 'infection']) {
  test('switching to ' + cat + ' closes range mode for direct router calls', () => {
    const emitted = [];
    const h = harness({ bus: { emit(name) { assert.equal(h.state.active, false); emitted.push(name); } }, _focusNameSearch() {} });
    vm.runInContext(named(router, 'switchDailyCat'), h.context);
    h.context.switchDailyCat(cat);
    assert.equal(h.state.active, false);
    assert.equal(emitted.filter(name => name === 'render:daily').length, 1);
  });
}

function mainNavigation(unlockMagic = false) {
  const emitted = [], dailyRenderModes = [];
  const h = harness({
    document: {
      getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
      documentElement: { style: {} }, body: { style: { setProperty() {} }, setAttribute() {} }
    },
    localStorage: { getItem: key => key === 'ec_magic_unlock' && unlockMagic ? '1' : null, setItem() {} },
    bus: { emit(name) { emitted.push(name); if(name === 'render:daily')dailyRenderModes.push(h.state.active); } },
    floatingPostitOnViewChange() {}, renderHomeDashboard() {}, renderStats() {},
    _closeDateVisitors() {}, _hideVisitHistory() {}, _dailyResetEntryOverlay() {},
    _focusDailyCatSearch() {}, _magicSwitchSub() {}, kioskUpdateSidebar() {}, setTimeout() {}
  });
  vm.runInContext(named(router, 'switchView'), h.context);
  return { ...h, emitted, dailyRenderModes };
}

for(const view of ['home', 'dashboard', 'story']) {
  test('leaving range search for ' + view + ' returns to the original daily date on reentry', () => {
    const h = mainNavigation();
    const selectedDate = h.context.S.selectedDate;
    h.context.switchView(view);
    assert.equal(h.state.active, false);
    assert.equal(h.context.S.currentView, view);
    assert.equal(h.context.S.selectedDate, selectedDate);
    assert.deepEqual(h.events, [['close', false]]);
    assert.deepEqual(h.dailyRenderModes, []);
    h.context.switchView('daily');
    assert.equal(h.context.S.currentView, 'daily');
    assert.equal(h.context.S.selectedDate, selectedDate);
    assert.deepEqual(h.dailyRenderModes, [false]);
  });
}

test('blocked Magic navigation preserves the active range and current daily view', () => {
  const h = mainNavigation();
  h.context.switchView('magic');
  assert.equal(h.state.active, true);
  assert.equal(h.context.S.currentView, 'daily');
  assert.equal(h.context.S.selectedDate, '2026-09-20');
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.emitted, ['toast:show']);
});

test('allowed Magic navigation closes range search after passing the entry guard', () => {
  const h = mainNavigation(true);
  h.context.switchView('magic');
  assert.equal(h.state.active, false);
  assert.equal(h.context.S.currentView, 'magic');
  assert.deepEqual(h.events, [['close', false]]);
});

test('reselecting the daily main menu preserves the current range search', () => {
  const h = mainNavigation();
  h.context.switchView('daily');
  assert.equal(h.state.active, true);
  assert.equal(h.context.S.currentView, 'daily');
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.dailyRenderModes, [true]);
});
