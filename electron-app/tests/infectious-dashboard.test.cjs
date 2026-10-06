/* Production widget handlers with synthetic responses only.
 * No renderer startup, external requests, credentials, or persistent storage. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/features/dashboard/home-dashboard.js'), 'utf8');
const start = source.indexOf('let _infectCache=null;');
const end = source.indexOf('/* 시간표 검색 위젯', start);
assert(start >= 0 && end > start, 'Production infectious widget boundaries must exist');
const widgetSource = source.slice(start, end);
const helpersStart = source.indexOf('function _schoolWidgetIcon(');
const helpersEnd = source.indexOf('function _hwAddBtn(', helpersStart);
assert(helpersStart >= 0 && helpersEnd > helpersStart, 'Production widget presentation helpers must exist');
const helpersSource = source.slice(helpersStart, helpersEnd);
const TTL = 5 * 60 * 1000;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const success = (name = 'Synthetic disease', year = 2026, sidoNm = '전국') => ({ rows: [{ icdNm: name, val: 1234 }], year, sidoNm });
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const state = {
    now: Date.UTC(2026, 8, 15, 12), apiKey: 'SYNTHETIC+KEY=', sido: '00',
    requests: [], renders: 0, errors: [], throwRequest: false, cleared: 0, listeners: new Map()
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const context = vm.createContext({
    Date: FakeDate,
    INFECTIOUS_CACHE_TTL_MS: TTL,
    clearInfectiousCache() { state.cleared++; },
    bus: { on(name, handler) { state.listeners.set(name, handler); } },
    userSidoCd: () => state.sido,
    getPublicDataApiKey: () => state.apiKey,
    getInfectiousRequestKey(year, sido) {
      let key = state.apiKey;
      try { key = decodeURIComponent(key); } catch (_) {}
      return key + '\n' + year + '\n' + sido;
    },
    getRegionTop(year, sido, topN, options) {
      if(state.throwRequest) throw new Error('Synthetic transport failure');
      return new Promise((resolve, reject) => {
        state.requests.push({ year, sido, topN, force: options.force, resolve, reject });
      });
    },
    getInfectiousErrorMessage(result) {
      state.errors.push(result);
      if(result.error === 'no-key') return '설정 → API 관리에서 인증키를 등록해 주세요.';
      if(result.error === 'api') return '인증 확인 (' + result.code + ') ' + (result.safeMessage || '');
      return '접속 실패. 다시 조회해 주세요.';
    },
    escHtml: escapeHtml,
    renderHomeDashboard() { state.renders++; }
  });
  vm.runInContext(helpersSource + '\n' + widgetSource, context);
  return {
    state,
    body: () => vm.runInContext('_wInfectTrendBody()', context),
    retry: () => vm.runInContext('_retryInfectTrend()', context),
    settingsChanged: () => state.listeners.get('infectious:settings-changed')(),
    resolve: (index, result) => state.requests[index].resolve(result),
    reject: index => state.requests[index].reject(new Error('Synthetic connection failure'))
  };
}

test('initial render starts one request and repeated loading renders do not duplicate it', async () => {
  const h = harness();
  assert.match(h.body(), /data-state="loading"/);
  for(let i = 0; i < 10; i++) h.body();
  await flush();
  assert.equal(h.state.requests.length, 1);
  const request = h.state.requests[0];
  assert.deepEqual([request.year, request.sido, request.topN, request.force], [2026, '00', 5, false]);
});

test('success preserves existing detail button and never puts the request key into HTML', async () => {
  const h = harness();
  h.body(); await flush();
  h.resolve(0, success()); await flush();
  const html = h.body();
  assert.match(html, /Synthetic disease/);
  assert.match(html, /1,234/);
  assert.match(html, /open-infect-detail/);
  assert.doesNotMatch(html, /SYNTHETIC\+KEY|SYNTHETIC%2BKEY/);
  assert.equal(h.state.requests.length, 1);
});

test('API errors retain their code, use shared guidance, and escape text in HTML', async () => {
  const h = harness();
  h.body(); await flush();
  h.resolve(0, { error: 'api', code: '30', safeMessage: '<b>test</b>' }); await flush();
  const html = h.body();
  assert.match(html, /인증 확인 \(30\)/);
  assert.match(html, /&lt;b&gt;test&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>test<\/b>/);
  assert.match(html, /retry-infect-trend/);
  assert.equal(h.state.errors.at(-1).code, '30');
});

test('failed requests remain retryable without an automatic render/request loop', async () => {
  const h = harness();
  h.body(); await flush();
  h.resolve(0, { error: 'fetch' }); await flush();
  for(let i = 0; i < 30; i++) assert.match(h.body(), /다시 조회/);
  await flush();
  assert.equal(h.state.requests.length, 1);
  h.retry(); h.retry(); await flush();
  assert.equal(h.state.requests.length, 2);
  assert.equal(h.state.requests[1].force, true);
  h.resolve(1, success('Recovered')); await flush();
  assert.match(h.body(), /Recovered/);
  assert.doesNotMatch(h.body(), /접속 실패/);
});

for(const result of [success(), { error: 'fetch' }]) {
  test((result.error ? 'failure' : 'success') + ' cache expires at the bounded TTL', async () => {
    const h = harness();
    h.body(); await flush();
    h.resolve(0, result); await flush();
    h.state.now += TTL - 1;
    h.body(); await flush();
    assert.equal(h.state.requests.length, 1);
    h.state.now++;
    assert.match(h.body(), /data-state="loading"/); await flush();
    assert.equal(h.state.requests.length, 2);
    assert.equal(h.state.requests[1].force, false);
  });
}

test('missing key guidance is replaced by a fresh query after registering a key', async () => {
  const h = harness();
  h.state.apiKey = '';
  assert.match(h.body(), /data-state="api"/);
  assert.match(h.body(), /API 키를 등록/);
  assert.match(h.body(), /open-widget-api-settings/);
  await flush();
  assert.equal(h.state.requests.length, 0, 'Missing credentials must not start a request');
  h.state.apiKey = 'SYNTHETIC-NEW-KEY';
  assert.match(h.body(), /data-state="loading"/); await flush();
  assert.equal(h.state.requests.length, 1);
  h.resolve(0, success('New key data')); await flush();
  assert.match(h.body(), /New key data/);
});

test('reapplying the same key clears both caches through the settings event', async () => {
  const h = harness();
  h.body(); await flush();
  h.resolve(0, { error: 'fetch' }); await flush();
  assert.match(h.body(), /접속 실패/);
  const oldRenderCount = h.state.renders;
  h.settingsChanged();
  assert.equal(h.state.cleared, 1);
  assert.equal(h.state.renders, oldRenderCount + 1);
  assert.match(h.body(), /data-state="loading"/); await flush();
  assert.equal(h.state.requests.length, 2);
  h.resolve(1, success('Recovered after settings apply')); await flush();
  assert.match(h.body(), /Recovered after settings apply/);
});

test('reapplying the same key invalidates an earlier in-flight request', async () => {
  const h = harness();
  h.body(); await flush();
  h.settingsChanged();
  h.body(); await flush();
  assert.equal(h.state.requests.length, 2);
  h.resolve(1, success('After reapply')); await flush();
  h.resolve(0, success('Obsolete same-key response')); await flush();
  assert.match(h.body(), /After reapply/);
  assert.doesNotMatch(h.body(), /Obsolete same-key response/);
});

for(const change of ['key', 'sido', 'year']) {
  test('cached data is invalidated when ' + change + ' changes', async () => {
    const h = harness();
    h.body(); await flush();
    h.resolve(0, success('Old data')); await flush();
    if(change === 'key') h.state.apiKey = 'SYNTHETIC-OTHER-KEY';
    if(change === 'sido') h.state.sido = '01';
    if(change === 'year') h.state.now = Date.UTC(2027, 0, 1, 12);
    const html = h.body(); await flush();
    assert.match(html, /data-state="loading"/);
    assert.doesNotMatch(html, /Old data/);
    assert.equal(h.state.requests.length, 2);
    if(change === 'sido') assert.equal(h.state.requests[1].sido, '01');
    if(change === 'year') assert.equal(h.state.requests[1].year, 2027);
  });
}

test('equivalent encoded/decoded request keys do not cause duplicate cache entries', async () => {
  const h = harness();
  h.body(); await flush();
  h.resolve(0, success()); await flush();
  h.state.apiKey = encodeURIComponent(h.state.apiKey);
  assert.match(h.body(), /Synthetic disease/); await flush();
  assert.equal(h.state.requests.length, 1);
});

for(const oldResult of [success('Obsolete response'), { error: 'api', code: '30' }]) {
  test('late ' + (oldResult.error ? 'error' : 'success') + ' cannot replace the newer request result', async () => {
    const h = harness();
    h.body(); await flush();
    h.state.sido = '01';
    h.body(); await flush();
    assert.equal(h.state.requests.length, 2);
    h.resolve(1, success('Current Seoul data', 2026, '서울')); await flush();
    h.resolve(0, oldResult); await flush();
    const html = h.body();
    assert.match(html, /Current Seoul data/);
    assert.doesNotMatch(html, /Obsolete response|인증 확인/);
    assert.equal(h.state.requests.length, 2);
  });
}

test('a late old response cannot clear the loading flag of a newer in-flight request', async () => {
  const h = harness();
  h.body(); await flush();
  h.state.apiKey = 'SYNTHETIC-OTHER-KEY';
  h.body(); await flush();
  h.resolve(0, success('Obsolete response')); await flush();
  for(let i = 0; i < 10; i++) assert.match(h.body(), /data-state="loading"/);
  await flush();
  assert.equal(h.state.requests.length, 2);
  h.resolve(1, success('Current data')); await flush();
  assert.match(h.body(), /Current data/);
});

test('configuration changed without a render still prevents the old response from being cached', async () => {
  const h = harness();
  h.body(); await flush();
  h.state.sido = '02';
  h.resolve(0, success('Obsolete response')); await flush();
  assert(h.state.renders > 0, 'Completion must request a current-state render');
  assert.match(h.body(), /data-state="loading"/); await flush();
  assert.equal(h.state.requests.length, 2);
  assert.equal(h.state.requests[1].sido, '02');
});

test('empty data keeps its year and region and offers an explicit refresh', async () => {
  const h = harness();
  h.body(); await flush();
  h.resolve(0, { rows: [], year: 2026, sidoNm: '서울' }); await flush();
  const html = h.body();
  assert.match(html, /data-state="empty"/);
  assert.match(html, /2026년 서울/);
  assert.match(html, /자료가 없다는 것이 발생이 없다는 뜻은 아니에요/);
  assert.match(html, /retry-infect-trend/);
  h.retry(); await flush();
  assert.equal(h.state.requests[1].force, true);
});

for(const failure of ['rejection', 'throw', 'null']) {
  test(failure + ' response becomes a retryable transport error', async () => {
    const h = harness();
    if(failure === 'throw') h.state.throwRequest = true;
    h.body(); await flush();
    if(failure === 'rejection') h.reject(0);
    if(failure === 'null') h.resolve(0, null);
    await flush();
    assert.match(h.body(), /접속 실패/);
    assert.match(h.body(), /retry-infect-trend/);
  });
}

test('dashboard click delegation invokes the production retry handler', () => {
  const match = source.match(/    if\(act==='retry-infect-trend'\)[^\r\n]+/);
  assert(match, 'Dashboard must bind the retry data-action');
  let prevented = false, retries = 0;
  const context = vm.createContext({
    act: 'retry-infect-trend',
    e: { preventDefault() { prevented = true; } },
    _retryInfectTrend() { retries++; }
  });
  vm.runInContext('(function(){\n' + match[0] + '\n})();', context);
  assert.equal(prevented, true);
  assert.equal(retries, 1);
});
