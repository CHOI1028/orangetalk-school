/* Exercise the complete production controller and its real data helpers in an
 * isolated DOM. No renderer startup, network, database, or user data is used. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const feature = path.join(__dirname, '../src/renderer/features/daily');
const read = file => fs.readFileSync(path.join(feature, file), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/\bexport (?=(?:async )?function|const|let)/g, '');
const source = read('daily-period-data.js') + '\n' + read('daily-period-view.js');
const controls = ['dailySearchInput', 'dailyAdvSearchBtn', 'dailyColSelectorBtn',
  'dailySortAscBtn', 'dailySortDescBtn', 'dailyDiaryPrintBtn', 'dailyVisitPassBtn', 'dailyTodayMemoBtn'];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const success = data => ({ success: true, data });
const visit = (id, extra = {}) => ({ id, _dbId:id, personUid: 'person-' + id, date: '2026-09-15',
  timeIn: '09:00', timeOut: '09:10', symptoms: [], treatment: [], ...extra });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function harness(options = {}) {
  const nodes = new Map(), events = [], calls = [], writes = [], timers = new Map();
  let focused = null, clock = 0, timerId = 0, privacy = !!options.privacy;
  class Element {
    constructor(id = '') {
      this.id = id; this.value = ''; this.disabled = false; this.hidden = false;
      this.textContent = ''; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
      this.parent = null; this.markup = ''; this.children = [];
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle(value, enabled) {
          if (enabled === undefined) enabled = !classes.has(value);
          if (enabled) classes.add(value); else classes.delete(value);
          return enabled;
        } };
      if (id) nodes.set(id, this);
    }
    set innerHTML(value) {
      this.markup = String(value);
      // The form is created by the production initializer, not by this harness.
      if (this.id === 'dailyPeriodPanel' && this.markup.includes('<form')) {
        this.children = [];
        for (const match of this.markup.matchAll(/\bid="([^"]+)"/g)) {
          const child = new Element(match[1]); child.parent = this; this.children.push(child);
        }
        this.form = new Element(); this.form.parent = this;
        this.submitButton = new Element(); this.submitButton.parent = this;
      }
    }
    get innerHTML() { return this.markup; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    dispatch(type, extra = {}) {
      const event = { target: this, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const listener of this.listeners.get(type) || []) listener.call(this, event);
      return event;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelector(selector) {
      if (selector === 'form') return this.form;
      if (selector === 'button[type="submit"]') return this.submitButton;
      if (selector.startsWith('#')) return nodes.get(selector.slice(1)) || null;
      return null;
    }
    contains(child) { for (; child; child = child.parent) if (child === this) return true; return false; }
    closest(selector) { return selector === '[data-period-action]' && this.dataset.periodAction ? this : null; }
    focus() { focused = this; }
  }
  for (const id of ['dailyPeriodPanel', 'dailyPeriodSearchBtn', 'dailyCat-general', 'dailyACList', ...controls]) new Element(id);
  nodes.get('dailyPeriodPanel').hidden = true;
  nodes.get('dailyACList').innerHTML = '<div>old suggestion</div>';
  for (const id of options.disabled || []) nodes.get(id).disabled = true;
  const records = freeze(options.records || []);
  const state = freeze({ records, settings:{schoolLevel:'high'}, _vipTags:{}, selectedDate: options.selectedDate || '2026-09-30' });
  const storage = { getItem: key => key === 'ec_privacy_mode' && privacy ? '1' : null,
    setItem() { writes.push('localStorage.setItem'); throw Error('Read-only search must not save preferences'); } };
  const api = new Proxy({ recordsDailyByDateRange(from, to) {
    calls.push([from, to]); return options.request ? options.request(from, to) : success(options.rows || []);
  } }, { get(target, name) {
    if (name in target) return target[name];
    return () => { writes.push(String(name)); throw Error('Unexpected API write: ' + String(name)); };
  } });
  const window = { electronAPI: api };
  const context = vm.createContext({ document: { getElementById: id => nodes.get(id) || null },
    window, localStorage: storage, S: state, structuredClone,
    bus: { emit: (...args) => events.push(args) },
    escHtml: value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
    toDateStr: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
    getStu: uid => (options.people || {})[uid] || { name: '학생 ' + uid, grade: 2, cls: 3, num: 7 },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  require('./helpers/daily-row-harness.cjs').install(context);
  vm.runInContext('"use strict";\n' + source, context, { filename: 'daily-period-production.js' });
  const node = id => { assert.ok(nodes.has(id), 'Missing production element: ' + id); return nodes.get(id); };
  const controller = {
    init: context.initDailyPeriodSearch, open: context.openDailyPeriodSearch,
    close: context.closeDailyPeriodSearch, active: context.isDailyPeriodSearchActive,
    refresh: context.refreshDailyPeriodSearch
  };
  return { controller, node, state, records, events, calls, writes, timers, window,
    focused: () => focused,
    setPrivacy: value => { privacy = value; },
    async submit(from = '2026-09-01', to = '2026-09-30') {
      node('dailyPeriodFrom').value = from; node('dailyPeriodTo').value = to;
      const event = node('dailyPeriodPanel').querySelector('form').dispatch('submit');
      assert.equal(event.defaultPrevented, true); await settle();
    },
    action(action) {
      const target = new Element(); target.parent = node('dailyPeriodPanel'); target.dataset.periodAction = action;
      node('dailyPeriodPanel').dispatch('click', { target });
    },
    filter(value) { node('dailyPeriodKind').value = value; node('dailyPeriodKind').dispatch('change'); },
    async advance(milliseconds = 200) {
      clock += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.due <= clock && timers.has(id)) {
        timers.delete(id); timer.callback(); await settle();
      }
    }
  };
}
test('page and filter changes return the result list to its first row', async () => {
  const h = harness({ rows: Array.from({ length: 205 }, (_, i) => visit(i + 1, { treatment: ['안정'] })) });
  h.controller.open(); await h.submit();
  const results = h.node('dailyPeriodResults');
  results.scrollTop = 800; h.action('next');
  assert.equal(results.scrollTop, 0);
  results.scrollTop = 800; h.action('prev');
  assert.equal(results.scrollTop, 0);
  results.scrollTop = 800; h.filter('treatment');
  assert.equal(results.scrollTop, 0);
});

function renderedRows(h) {
  const body = h.node('dailyPeriodResults').innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return body ? (body[1].match(/<tr(?:\s[^>]*)?>/g) || []).length : 0;
}
function expectCounts(h, visits, counsel, treatment, people) {
  const html = h.node('dailyPeriodSummary').innerHTML;
  for (const [label, count, unit] of [['전체 방문', visits, '건'], ['상담 기록', counsel, '건'],
    ['처치 기록', treatment, '건'], ['이용 인원', people, '명']]) {
    assert.ok(html.includes(label + ' <strong>' + count + '</strong>' + unit), label + ': expected ' + count);
  }
}
function expectBlankResults(h) {
  for (const id of ['dailyPeriodSummary', 'dailyPeriodResults', 'dailyPeriodPages']) assert.equal(h.node(id).innerHTML, '');
}

test('initialization is idempotent and opening/closing restores editor controls and selected date', () => {
  const h = harness({ disabled: ['dailyDiaryPrintBtn'] });
  h.controller.init(); h.controller.init(); h.controller.init();
  assert.equal(h.node('dailyPeriodSearchBtn').listeners.get('click').length, 1);
  h.node('dailyPeriodSearchBtn').dispatch('click');
  assert.equal(h.controller.active(), true);
  assert.equal(h.node('dailyPeriodPanel').hidden, false);
  assert.equal(h.node('dailyPeriodSearchBtn').getAttribute('aria-expanded'), 'true');
  assert.equal(h.node('dailyPeriodFrom').value, '2026-09-01');
  assert.equal(h.node('dailyPeriodTo').value, '2026-09-30');
  assert.equal(h.focused(), h.node('dailyPeriodFrom'));
  assert.equal(h.node('dailyACList').innerHTML, '');
  assert.equal(h.node('dailyCat-general').classList.contains('daily-period-active'), true);
  controls.forEach(id => assert.equal(h.node(id).disabled, true));
  h.controller.open(); h.controller.init();
  assert.deepEqual(h.events, [['daily:period-open']]);
  assert.deepEqual(h.calls, []);
  assert.equal(h.controller.close(), true);
  assert.equal(h.controller.close(), false);
  assert.equal(h.node('dailyPeriodPanel').hidden, true);
  assert.equal(h.node('dailyPeriodSearchBtn').getAttribute('aria-expanded'), 'false');
  assert.equal(h.node('dailyCat-general').classList.contains('daily-period-active'), false);
  controls.forEach(id => assert.equal(h.node(id).disabled, id === 'dailyDiaryPrintBtn'));
  assert.equal(h.state.selectedDate, '2026-09-30');
  assert.deepEqual(h.events, [['daily:period-open'], ['render:daily']]);
  assert.equal(h.focused(), h.node('dailyPeriodSearchBtn'));
});

test('invalid or missing dates clear previous counts, show validation, and make no request', async () => {
  const h = harness({ rows: [visit(1)] }); h.controller.open();
  for (const [from, to, message] of [['', '2026-09-30', /모두 선택/],
    ['2026-09-01', '', /모두 선택/], ['2026-02-30', '2026-09-30', /시작일.*올바른/],
    ['2026-09-01', '2026-09-31', /종료일.*올바른/], ['2026-10-01', '2026-09-30', /이후 날짜/]]) {
    await h.submit(); expectCounts(h, 1, 0, 0, 1);
    const requests = h.calls.length;
    await h.submit(from, to);
    assert.equal(h.calls.length, requests);
    assert.match(h.node('dailyPeriodStatus').textContent, message);
    assert.equal(h.node('dailyPeriodStatus').classList.contains('is-error'), true);
    expectBlankResults(h);
  }
});

for (const [label, response] of [['explicit failure', { success: false, data: [] }],
  ['missing response', undefined], ['missing data', { success: true }],
  ['non-array data', { success: true, data: {} }]]) {
  test(label + ' is visibly an error, never a successful zero count', async () => {
    let fail = false;
    const h = harness({ request: () => fail ? response : success([visit(1)]) }); h.controller.open();
    await h.submit(); expectCounts(h, 1, 0, 0, 1); fail = true;
    await h.submit();
    assert.match(h.node('dailyPeriodStatus').textContent, /불러오지 못/);
    assert.equal(h.node('dailyPeriodStatus').classList.contains('is-error'), true);
    assert.equal(h.node('dailyPeriodPanel').getAttribute('aria-busy'), 'false');
    expectBlankResults(h);
  });
}

test('rejected and unavailable APIs show an error and can recover on the next query', async () => {
  const h = harness({ request: () => Promise.reject(Error('synthetic disconnected database')) }); h.controller.open();
  await h.submit(); assert.match(h.node('dailyPeriodStatus').textContent, /불러오지 못/); expectBlankResults(h);
  for (const unavailable of [undefined, {}]) {
    h.window.electronAPI = unavailable;
    await h.submit(); assert.match(h.node('dailyPeriodStatus').textContent, /불러오지 못/); expectBlankResults(h);
  }
  h.window.electronAPI = { recordsDailyByDateRange: () => success([]) };
  await h.submit();
  expectCounts(h, 0, 0, 0, 0);
  assert.equal(h.node('dailyPeriodStatus').classList.contains('is-error'), false);
  assert.match(h.node('dailyPeriodResults').innerHTML, /해당하는 기록이 없습니다/);
});

test('newest overlapping query wins when an older success or rejection arrives last', async () => {
  for (const rejectOld of [false, true]) {
    const old = deferred(), current = deferred();
    const h = harness({ request: from => from === '2026-08-01' ? old.promise : current.promise }); h.controller.open();
    await h.submit('2026-08-01', '2026-08-31');
    await h.submit();
    assert.equal(h.node('dailyPeriodPanel').getAttribute('aria-busy'), 'true'); expectBlankResults(h);
    current.resolve(success([visit(2, { treatmentMemo: 'new result' })])); await settle();
    const html = h.node('dailyPeriodResults').innerHTML;
    assert.match(html, /new result/);
    if (rejectOld) old.reject(Error('late failure'));
    else old.resolve(success([visit(1, { date: '2026-08-10', treatmentMemo: 'stale result' })]));
    await settle();
    assert.equal(h.node('dailyPeriodResults').innerHTML, html);
    assert.equal(h.node('dailyPeriodStatus').textContent, '2026-09-01 ~ 2026-09-30');
    expectCounts(h, 1, 0, 1, 1);
  }
});

test('invalid input invalidates an earlier pending query as well as its counts', async () => {
  const pending = deferred(); const h = harness({ request: () => pending.promise }); h.controller.open();
  await h.submit(); await h.submit('2026-09-30', '2026-09-01');
  pending.resolve(success([visit(1)])); await settle();
  assert.match(h.node('dailyPeriodStatus').textContent, /이후 날짜/); expectBlankResults(h);
  assert.equal(h.node('dailyPeriodPanel').getAttribute('aria-busy'), 'false');
});

test('close invalidates a late response and reopening begins without its results', async () => {
  const pending = deferred(); const h = harness({ request: () => pending.promise }); h.controller.open();
  await h.submit(); h.controller.refresh();
  assert.equal(h.controller.close(false), true);
  assert.equal(h.controller.active(), false);
  assert.deepEqual(h.events, [['daily:period-open']]);
  pending.resolve(success([visit(1)])); await settle(); await h.advance();
  assert.equal(h.calls.length, 1); assert.equal(h.node('dailyPeriodPanel').hidden, true);
  h.controller.open(); expectBlankResults(h);
  assert.match(h.node('dailyPeriodStatus').textContent, /선택한 뒤 조회/);
});

test('a response from a closed search cannot overwrite a fresh query after reopening', async () => {
  const old = deferred(); let requests = 0;
  const h = harness({ request: () => ++requests === 1 ? old.promise : success([visit(2, { treatmentMemo: '새로 연 조회' })]) });
  h.controller.open(); await h.submit(); h.controller.close(false);
  h.controller.open(); await h.submit();
  old.resolve(success([visit(1, { treatmentMemo: '닫힌 조회' })])); await settle();
  expectCounts(h, 1, 0, 1, 1);
  assert.match(h.node('dailyPeriodResults').innerHTML, /새로 연 조회/);
  assert.doesNotMatch(h.node('dailyPeriodResults').innerHTML, /닫힌 조회/);
  assert.equal(h.node('dailyPeriodPanel').hidden, false);
});

test('debounced refresh is coalesced and a new submitted range cancels the queued old refresh', async () => {
  const h = harness({ rows: [visit(1)] }); h.controller.open(); await h.submit();
  h.controller.refresh(); h.controller.refresh(); h.controller.refresh();
  assert.equal(h.timers.size, 1); await h.advance(199); assert.equal(h.calls.length, 1);
  await h.advance(1); assert.equal(h.calls.length, 2);
  h.controller.refresh();
  await h.submit('2026-08-01', '2026-08-31');
  assert.deepEqual(h.calls.at(-1), ['2026-08-01', '2026-08-31']);
  await h.advance();
  assert.equal(h.calls.length, 3); assert.equal(h.timers.size, 0);
  assert.equal(h.node('dailyPeriodStatus').textContent, '2026-08-01 ~ 2026-08-31');
  h.controller.refresh(); h.controller.close(); await h.advance();
  assert.equal(h.calls.length, 3);
});

test('refresh during a pending query queues one reload and does not overwrite a newer query', async () => {
  const old = deferred(), current = deferred();
  const h = harness({ request: from => from === '2026-08-01' ? old.promise : current.promise }); h.controller.open();
  await h.submit('2026-08-01', '2026-08-31'); h.controller.refresh(); h.controller.refresh();
  await h.submit(); current.resolve(success([visit(2)])); await settle();
  old.resolve(success([visit(1, { date: '2026-08-10' })])); await settle(); await h.advance();
  assert.equal(h.calls.length, 2); expectCounts(h, 1, 0, 0, 1);
  assert.equal(h.node('dailyPeriodStatus').textContent, '2026-09-01 ~ 2026-09-30');
  const pending = deferred(); let requests = 0;
  const reload = harness({ request: () => ++requests === 1 ? pending.promise : success([visit(1), visit(2)]) });
  reload.controller.open(); await reload.submit(); reload.controller.refresh(); reload.controller.refresh();
  pending.resolve(success([visit(1)])); await settle();
  assert.equal(reload.timers.size, 1); await reload.advance();
  assert.equal(reload.calls.length, 2); expectCounts(reload, 2, 0, 0, 2);
});

test('pagination shows at most 100 records, preserves period totals, and bounds the last page', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => visit(index + 1, { personUid: 'person-' + index % 11 }));
  const h = harness({ rows }); h.controller.open(); await h.submit();
  expectCounts(h, 205, 0, 0, 11); assert.equal(renderedRows(h), 100);
  assert.match(h.node('dailyPeriodPages').innerHTML, /205건 중 1–100건/);
  h.action('next'); expectCounts(h, 205, 0, 0, 11); assert.equal(renderedRows(h), 100);
  assert.match(h.node('dailyPeriodPages').innerHTML, /205건 중 101–200건/);
  h.action('next'); assert.equal(renderedRows(h), 5);
  assert.match(h.node('dailyPeriodPages').innerHTML, /205건 중 201–205건/);
  assert.match(h.node('dailyPeriodPages').innerHTML, /data-period-action="next" disabled/);
  h.action('next'); assert.equal(renderedRows(h), 5);
  h.action('prev'); assert.equal(renderedRows(h), 100); assert.equal(h.calls.length, 1);
});

test('counsel and treatment filters include medicine and free text but retain full-period counts', async () => {
  const rows = [visit(1, { personUid: 'shared', counselLog: { content: '상담 A', plan: '계획' }, treatment: ['안정'] }),
    visit(2, { personUid: 'shared', treatment:['투약'], medication: '약품 B' }), visit(3, { treatmentMemo: '처치 메모 C' }),
    visit(4, { counselLog: { opinion: '상담 의견 D' } }), visit(5, { symptoms: ['상담'], counselLog: { topics: ['주제만'] } })];
  const h = harness({ rows }); h.controller.open(); await h.submit();
  expectCounts(h, 5, 2, 3, 4); assert.equal(renderedRows(h), 5);
  h.filter('counsel'); assert.equal(renderedRows(h), 2); expectCounts(h, 5, 2, 3, 4);
  assert.match(h.node('dailyPeriodResults').innerHTML, /data-rec-id="1"/);
  assert.match(h.node('dailyPeriodResults').innerHTML, /data-rec-id="4"/);
  assert.doesNotMatch(h.node('dailyPeriodResults').innerHTML, /약품 B|처치 메모 C/);
  h.filter('treatment'); assert.equal(renderedRows(h), 3); expectCounts(h, 5, 2, 3, 4);
  assert.match(h.node('dailyPeriodResults').innerHTML, /약품 B/);
  assert.match(h.node('dailyPeriodResults').innerHTML, /처치 메모 C/);
  assert.doesNotMatch(h.node('dailyPeriodResults').innerHTML, /data-rec-id="4"/);
  h.filter('all'); assert.equal(renderedRows(h), 5); assert.equal(h.calls.length, 1);
});

test('privacy hides identities and clinical text while retaining dates and aggregate counts', async () => {
  const h = harness({ privacy: true, people: { secret: { name: '민감 이름', department: '민감 소속', grade: 6, cls: 4, num: 19 } },
    rows: [visit(1, { personUid: 'secret', symptoms: ['민감 증상'], treatmentMemo: '민감 처치',
      medication: '민감 약품', counselLog: { content: '민감 상담' } })] });
  h.controller.open(); await h.submit(); expectCounts(h, 1, 1, 1, 1);
  assert.match(h.node('dailyPeriodStatus').textContent, /개인정보 보호 모드/);
  assert.match(h.node('dailyPeriodResults').innerHTML, /2026-09-15/);
  assert.match(h.node('dailyPeriodResults').innerHTML, /•••/);
  assert.doesNotMatch(h.node('dailyPeriodResults').innerHTML, /민감|secret|6-4|>19</);
  h.setPrivacy(false); h.controller.refresh();
  assert.match(h.node('dailyPeriodResults').innerHTML, /민감 이름/);
  assert.match(h.node('dailyPeriodResults').innerHTML, /민감 처치/);
});

test('prior-year records display their joined identity instead of the current student roster', async () => {
  const h = harness({ people: { historical: { name: '현재 이름', grade: 6, cls: 7, num: 28, department: '현재 학과' } },
    rows: [visit(1, { date: '2025-09-15', personUid: 'historical', personName: '기록 당시 이름',
      studentGrade: 1, studentClass: 2, studentNum: 3, studentDepartment: '기록 당시 학과' })] });
  h.controller.open(); await h.submit('2025-09-01', '2025-09-30');
  const html = h.node('dailyPeriodResults').innerHTML;
  assert.match(html, /data-col-index="0"[^>]*>2025-09-15<\/td>/);
  assert.match(html, /data-col-index="17"[^>]*>기록 당시 학과<\/td>/);
  assert.match(html, /data-col-index="1"[^>]*>1-2<\/td>/);
  assert.match(html, /data-col-index="2"[^>]*>3<\/td>/);
  assert.match(html, /기록 당시 이름/);
  assert.doesNotMatch(html, /현재 이름|현재 학과|6-7|<td>28<\/td>/);
  assert.equal(h.state.selectedDate, '2026-09-30');
  expectCounts(h, 1, 0, 0, 1);
});

test('joined record names and school-year identity remain visible when the current person cache is missing', async () => {
  const h = harness({ people: { missing: { _notFound: true, name: '현재 명단 없음' } },
    rows: [visit(1, { personUid: 'missing', personName: '기록에 남은 이름', studentGrade: 1,
      studentClass: 2, studentNum: 3, studentDepartment: '기록 소속' })] });
  h.controller.open(); await h.submit();
  const html = h.node('dailyPeriodResults').innerHTML;
  assert.match(html, /data-col-index="17"[^>]*>기록 소속<\/td>/);
  assert.match(html, /data-col-index="1"[^>]*>1-2<\/td>/);
  assert.match(html, /data-col-index="2"[^>]*>3<\/td>/);
  assert.match(html, /기록에 남은 이름/);
  assert.doesNotMatch(html, /인원 정보 없음|현재 명단 없음/);
});

test('zero-valued missing year joins do not borrow the current grade, class, number, or department', async () => {
  const h = harness({ people: { noEnrollment: { name: '현재 이름', grade: 6, cls: 7, num: 28, department: '현재 학과' } },
    rows: [visit(1, { personUid: 'noEnrollment', personName: '기록 이름', studentGrade: 0,
      studentClass: 0, studentNum: 0, studentDepartment: '' })] });
  h.controller.open(); await h.submit();
  const html = h.node('dailyPeriodResults').innerHTML;
  assert.match(html, /data-col-index="1"[^>]*>-<\/td>/);
  assert.match(html, /data-col-index="2"[^>]*>-<\/td>/);
  assert.match(html, /기록 이름/);
  assert.doesNotMatch(html, /현재 이름|현재 학과|6-7|<td>28<\/td>|<td>0<\/td>/);
});

test('staff records prefer their joined position and name over the current person cache', async () => {
  const h = harness({ people: { staff: { type: 'staff', name: '현재 교직원 이름', position: '현재 직위' } },
    rows: [visit(1, { personUid: 'staff', personType: 'staff', personName: '기록 교직원 이름', staffPosition: '기록 직위' })] });
  h.controller.open(); await h.submit();
  const html = h.node('dailyPeriodResults').innerHTML;
  assert.match(html, /data-col-index="1"[^>]*>기록 직위<\/td>/);
  assert.match(html, /data-col-index="2"[^>]*>-<\/td>/);
  assert.match(html, /기록 교직원 이름/);
  assert.doesNotMatch(html, /현재 교직원 이름|현재 직위/);
});

test('rendering escapes stored identity and clinical text, including unmatched people', async () => {
  const unsafe = '<img src=x onerror="bad()">';
  const h = harness({ people: { missing: { _notFound: true } }, rows: [visit(1, { personUid: 'missing',
    unmatchedIdentity: { name: unsafe, grade: 1, cls: 2 }, symptoms: [unsafe], treatmentMemo: unsafe,
    medication: unsafe, counselLog: { content: unsafe } })] });
  h.controller.open(); await h.submit();
  assert.doesNotMatch(h.node('dailyPeriodResults').innerHTML, /<img/);
  assert.match(h.node('dailyPeriodResults').innerHTML, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.equal(renderedRows(h), 1);
});

test('search, filtering, refresh, and close never modify the editor array, selected date, or database', async () => {
  const records = [visit(1, { _dirty: true, treatmentMemo: '작성 중', symptoms: ['두통'], counselLog: { content: '입력 중' } })];
  const rows = freeze([visit(1, { treatmentMemo: 'DB 이전 값' }), visit(2)]);
  const before = structuredClone({ records, rows });
  const h = harness({ records, rows }); h.controller.open(); await h.submit();
  assert.match(h.node('dailyPeriodResults').innerHTML, /작성 중/);
  expectCounts(h, 2, 1, 1, 2);
  h.filter('counsel'); h.filter('treatment'); h.controller.refresh(); await h.advance(); h.controller.close();
  assert.strictEqual(h.state.records, records);
  assert.equal(h.state.selectedDate, '2026-09-30');
  assert.deepEqual({ records, rows }, before);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.calls, [['2026-09-01', '2026-09-30'], ['2026-09-01', '2026-09-30']]);
});
