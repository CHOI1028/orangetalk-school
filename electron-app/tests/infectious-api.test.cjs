/* Actual renderer functions, synthetic credentials/records only; no network or user data. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/renderer/core/infectious-disease.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');
const settingsSource = fs.readFileSync(path.join(root, 'src/renderer/core/public-data-settings.js'), 'utf8')
  .replace(/^export /gm, '');
const rawKey = 'SYNTHETIC+KEY/ONLY=';
const row = (overrides = {}) => ({
  icdGroupNm: '2급', icdNm: 'TEST', resultVal: '12', year: '2026년',
  sidoCd: '01', sidoNm: '서울', ...overrides
});
const ok = (rows = [row()], total = rows.length) => ({
  success: true, status: 200,
  data: JSON.stringify({ header: { resultCode: '00', resultMsg: 'OK' },
    body: { items: { item: rows }, totalCount: total } })
});
const plain = value => JSON.parse(JSON.stringify(value));
function harness(handler = () => ok(), key = rawKey) {
  const values = new Map([['ec_kdca_api_key', key]]);
  const requests = [], nodes = {};
  let time = 1000;
  class Clock extends Date { static now() { return time; } }
  const context = vm.createContext({
    Date: Clock,
    localStorage: { getItem: name => values.has(name) ? values.get(name) : null },
    document: { getElementById: id => nodes[id] || null },
    window: { electronAPI: { externalFetchJson: async url => {
      requests.push(new URL(url));
      return handler(new URL(url), requests.length);
    } } }
  });
  context.getPublicDataApiKey = vm.runInContext('(function(){' + settingsSource + '\nreturn getPublicDataApiKey;})()', context);
  vm.runInContext(source + '\nthis.api={normalizeInfectiousApiKey,getInfectiousErrorMessage,'
    + 'getInfectiousRequestKey,clearInfectiousCache,fetchRegion,fetchPeriod,fetchAge,'
    + 'getRegionTop,_runRegion,_runPeriod,_runAge,_tableHtml,INFECTIOUS_CACHE_TTL_MS};', context);
  return { api: context.api, context, requests, values, nodes,
    advance: ms => { time += ms; } };
}

test('common public-data key overrides the legacy KDCA key and is encoded only once', async () => {
  const h = harness();
  const commonKey = 'SYNTHETIC+COMMON/KEY=';
  h.values.set('ec_public_data_api_key', encodeURIComponent(commonKey));
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].searchParams.get('serviceKey'), commonKey);
  assert.equal(h.values.get('ec_kdca_api_key'), rawKey);
});

test('explicit deletion of the common key suppresses legacy KDCA fallback', async () => {
  const h = harness();
  h.values.set('ec_public_data_api_key', '');
  const result = await h.api.fetchRegion(2026, '01');
  assert.equal(result.error, 'no-key');
  assert.equal(h.requests.length, 0);
});

test('changing the common key invalidates an earlier infectious cache key', async () => {
  const h = harness();
  h.values.set('ec_public_data_api_key', 'SYNTHETIC_COMMON_ONE');
  await h.api.getRegionTop(2026, '01', 3);
  h.values.set('ec_public_data_api_key', 'SYNTHETIC_COMMON_TWO');
  await h.api.getRegionTop(2026, '01', 3);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].searchParams.get('serviceKey'), 'SYNTHETIC_COMMON_TWO');
});

for (const key of [rawKey, encodeURIComponent(rawKey), '  ' + encodeURIComponent(rawKey) + '  ']) {
  test('raw/encoded credential is transmitted once without changing storage: ' + key, async () => {
    const h = harness(() => ok(), key);
    const result = await h.api.fetchRegion(2026, '01');
    assert.equal(result.error, undefined);
    assert.equal(h.requests[0].searchParams.get('serviceKey'), rawKey);
    assert.equal(h.requests[0].searchParams.get('resType'), '2');
    assert.equal(h.values.get('ec_kdca_api_key'), key);
  });
}
test('no key returns guidance without calling transport', async () => {
  const h = harness(() => { throw Error('must not call'); }, '');
  assert.equal((await h.api.fetchRegion(2026, '01')).error, 'no-key');
  assert.equal(h.requests.length, 0);
});
test('malformed percent escape never throws during rendering', () => {
  const h = harness();
  assert.equal(h.api.normalizeInfectiousApiKey('TEST%ZZ'), 'TEST%ZZ');
});
test('single-item and nested JSON response envelopes are accepted', async () => {
  const h = harness(() => ({ success: true, data: { response: {
    header: { resultCode: 0 }, body: { items: { item: row() }, totalCount: 1 }
  } } }));
  assert.equal((await h.api.fetchRegion(2026, '01')).rows.length, 1);
});
test('raw JSON compatibility response is accepted', async () => {
  const h = harness(() => JSON.parse(ok().data));
  assert.equal((await h.api.fetchRegion(2026, '01')).rows.length, 1);
});

for (const code of ['20', '30', '31', '22', '23', '05', '102']) {
  test('XML API error ' + code + ' survives legacy transport without leaking its text', async () => {
    const h = harness(() => ({ success: true, data:
      '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>' + code
      + '</returnReasonCode><errMsg>' + rawKey + '</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>' }));
    const result = await h.api.fetchRegion(2026, '01');
    assert.equal(result.error, 'api');
    assert.equal(result.code, code);
    assert(!JSON.stringify(result).includes(rawKey));
    assert(!h.api.getInfectiousErrorMessage(result).includes(rawKey));
  });
}
test('namespaced XML resultCode authentication error is recognized', async () => {
  const h = harness(() => ({ success: true, status: 403, data:
    '<response><h:resultCode>30</h:resultCode></response>' }));
  assert.equal((await h.api.fetchRegion(2026, '01')).code, '30');
});
test('nested JSON API error is preserved without arbitrary server messages', async () => {
  const h = harness(() => ({ success: true, data: { response: {
    header: { resultCode: '30', resultMsg: '<script>' + rawKey + '</script>' }
  } } }));
  const result = await h.api.fetchRegion(2026, '01');
  assert.deepEqual(plain(result), { error: 'api', code: '30' });
  assert(!h.api.getInfectiousErrorMessage(result).includes('<script>'));
});
for (const [name, response, expected] of [
  ['HTML HTTP error', { success: true, status: 503, data: '<html>error</html>' }, 'http'],
  ['HTML without status', { success: true, data: '<html>error</html>' }, 'format'],
  ['unrecognized object', { success: true, data: { unexpected: [] } }, 'format'],
  ['null body', { success: true, data: null }, 'format'],
  ['timeout metadata', { success: false, errorKind: 'timeout', error: rawKey }, 'timeout'],
  ['legacy timeout', { success: false, error: 'TimeoutError: request timed out' }, 'timeout'],
  ['network failure', { success: false, errorKind: 'network', error: rawKey }, 'fetch']
]) {
  test(name + ' is classified safely', async () => {
    const h = harness(() => response);
    const result = await h.api.fetchRegion(2026, '01');
    assert.equal(result.error, expected);
    assert(!JSON.stringify(result).includes(rawKey));
  });
}
test('thrown timeout is classified without propagating an exception', async () => {
  const h = harness(() => { const e = Error(rawKey); e.name = 'TimeoutError'; throw e; });
  assert.equal((await h.api.fetchRegion(2026, '01')).error, 'timeout');
});
test('an absent Electron/shared-web bridge is an explicit connection error', async () => {
  const h = harness();
  h.context.window = {};
  assert.equal((await h.api.fetchRegion(2026, '01')).error, 'fetch');
});
test('empty API items are not interpreted as an invalid record', async () => {
  const h = harness(() => ({ success: true, data: { header: { resultCode: '00' },
    body: { items: '', totalCount: 0 } } }));
  assert.deepEqual(plain(await h.api.fetchRegion(2026, '01')), { rows: [] });
});

test('Seoul query excludes nationwide and other regional rows', async () => {
  const h = harness(() => ok([
    row({ sidoCd: '00', sidoNm: '전국', resultVal: '20,000' }),
    row({ resultVal: '1,234' }),
    row({ sidoCd: '02', sidoNm: '부산', resultVal: '456' })
  ]));
  const result = await h.api.getRegionTop(2026, '01', 5);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].val, 1234);
  assert.equal(result.sidoNm, '서울');
});
test('nationwide query uses the provided national total only', async () => {
  const h = harness(() => ok([
    row({ sidoCd: '00', sidoNm: '전국', resultVal: '20,000' }),
    row({ resultVal: '1,234' })
  ]));
  assert.equal((await h.api.getRegionTop(2026, '00', 5)).rows[0].val, 20000);
});
test('region matching falls back to an official full name when code is absent', async () => {
  const h = harness(() => ok([row({ sidoCd: null, sidoNm: '서울특별시' })]));
  assert.equal((await h.api.fetchRegion(2026, '1')).rows.length, 1);
});
test('unknown region labels are not silently counted as selected region', async () => {
  const h = harness(() => ok([row({ sidoCd: null, sidoNm: 'unknown' })]));
  assert.equal((await h.api.fetchRegion(2026, '01')).rows.length, 0);
});
test('counts support thousands separators but not malformed suffixes or fractions', async () => {
  const values = ['0', '9', '1,234', '12,345,678', '-', '', '12명', '1,2', '-1', '1.5'];
  const h = harness(() => ok(values.map((value, i) => row({ icdNm: 'TEST' + i, resultVal: value }))));
  assert.deepEqual(plain((await h.api.fetchRegion(2026, '01')).rows.map(r => r.val)),
    [0, 9, 1234, 12345678, 0, 0, 0, 0, 0, 0]);
});
test('prototype-like disease labels are handled as data', async () => {
  const h = harness(() => ok([row({ icdNm: '__proto__', resultVal: '10' }),
    row({ icdNm: '__proto__', resultVal: '20' })]));
  assert.equal((await h.api.getRegionTop(2026, '01', 5)).rows[0].val, 30);
});
test('period and age queries use the same credential and count normalization', async () => {
  const h = harness(() => ok([row({ resultVal: '1,234', ageRange: '10~19세' })]), encodeURIComponent(rawKey));
  assert.equal((await h.api.fetchPeriod(2025, 2026, '2')).rows[0].val, 1234);
  assert.equal((await h.api.fetchAge(2026, '10')).rows[0].val, 1234);
  assert.equal(h.requests[0].pathname.endsWith('/PeriodBasic'), true);
  assert.equal(h.requests[1].pathname.endsWith('/Age'), true);
  assert(h.requests.every(u => u.searchParams.get('serviceKey') === rawKey));
});
test('pages are fetched until totalCount, including a short first page', async () => {
  const h = harness(url => Number(url.searchParams.get('pageNo')) === 1
    ? ok([row({ icdNm: 'A' }), row({ icdNm: 'B' })], 3) : ok([row({ icdNm: 'C' })], 3));
  assert.equal((await h.api.fetchRegion(2026, '01')).rows.length, 3);
  assert.deepEqual(h.requests.map(u => u.searchParams.get('pageNo')), ['1', '2']);
});
test('a repeated page is rejected rather than counted twice', async () => {
  const h = harness(() => ok([row()], 2));
  assert.equal((await h.api.fetchRegion(2026, '01')).error, 'incomplete');
});
test('page failure never exposes or caches partial results', async () => {
  const h = harness(url => url.searchParams.get('pageNo') === '1'
    ? ok([row()], 2) : { success: false, errorKind: 'timeout' });
  assert.equal((await h.api.fetchRegion(2026, '01')).error, 'timeout');
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 4);
});

test('success cache has a TTL, supports force, and does not write keys', async () => {
  const h = harness();
  await h.api.fetchRegion(2026, '01');
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 1);
  await h.api.fetchRegion(2026, '01', { force: true });
  assert.equal(h.requests.length, 2);
  h.advance(h.api.INFECTIOUS_CACHE_TTL_MS);
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 3);
  assert.equal(h.values.get('ec_kdca_api_key'), rawKey);
});
test('failure is not cached and can be retried immediately', async () => {
  const h = harness((url, count) => count === 1 ? { success: false } : ok());
  assert.equal((await h.api.fetchRegion(2026, '01')).error, 'fetch');
  assert.equal((await h.api.fetchRegion(2026, '01')).rows.length, 1);
  assert.equal(h.requests.length, 2);
});
test('failed force refresh cannot revive an older success cache', async () => {
  const h = harness((url, count) => count === 2 ? { success: false } : ok());
  await h.api.fetchRegion(2026, '01');
  assert.equal((await h.api.fetchRegion(2026, '01', { force: true })).error, 'fetch');
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 3);
});
test('equivalent encoded key shares cache, but a changed credential does not', async () => {
  const h = harness();
  await h.api.fetchRegion(2026, '01');
  h.values.set('ec_kdca_api_key', encodeURIComponent(rawKey));
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 1);
  h.values.set('ec_kdca_api_key', 'ANOTHER-TEST-KEY');
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 2);
});
test('concurrent identical queries share one in-flight request', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  const first = h.api.fetchRegion(2026, '01'), second = h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 1);
  resolve(ok());
  await Promise.all([first, second]);
});
test('late old response cannot overwrite a forced newer cache result', async () => {
  const pending = [];
  const h = harness(() => new Promise(r => pending.push(r)));
  const first = h.api.fetchRegion(2026, '01');
  const second = h.api.fetchRegion(2026, '01', { force: true });
  pending[1](ok([row({ resultVal: '22' })])); await second;
  pending[0](ok([row({ resultVal: '11' })])); await first;
  assert.equal((await h.api.fetchRegion(2026, '01')).rows[0].val, 22);
});
test('clearing cache also invalidates an in-flight result', async () => {
  let resolve;
  const h = harness((url, count) => count === 1 ? new Promise(r => { resolve = r; }) : ok());
  const first = h.api.fetchRegion(2026, '01');
  h.api.clearInfectiousCache();
  resolve(ok()); await first;
  await h.api.fetchRegion(2026, '01');
  assert.equal(h.requests.length, 2);
});

function modal(h) {
  h.nodes.infectBody = { innerHTML: '' };
  h.nodes.ifYear = { value: '2026' };
  h.nodes.ifSido = { value: '01' };
  return h.nodes.infectBody;
}
test('modal shows authentication guidance rather than the generic fetch message', async () => {
  const h = harness(() => ({ success: true, status: 403,
    data: '<response><returnReasonCode>30</returnReasonCode></response>' }));
  const body = modal(h);
  await h.api._runRegion(true);
  assert(body.innerHTML.includes('인증을 거부'));
  assert(body.innerHTML.includes('오류 30'));
  assert(!body.innerHTML.includes(rawKey));
});
test('region modal renders only Seoul counts with thousands separators', async () => {
  const h = harness(() => ok([row({ resultVal: '1,234' }),
    row({ resultVal: '90,000', sidoCd: '00', sidoNm: '전국' })]));
  const body = modal(h);
  await h.api._runRegion();
  assert(body.innerHTML.includes('1,234'));
  assert(!body.innerHTML.includes('90,000'));
});
test('late modal response does not overwrite a newer query', async () => {
  const pending = [];
  const h = harness(() => new Promise(r => pending.push(r)));
  const body = modal(h);
  const first = h.api._runRegion(true), second = h.api._runRegion(true);
  pending[1](ok([row({ icdNm: 'NEW' })])); await second;
  pending[0](ok([row({ icdNm: 'OLD' })])); await first;
  assert(body.innerHTML.includes('NEW'));
  assert(!body.innerHTML.includes('OLD'));
});
test('response cannot write into a replaced modal with the same DOM id', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  modal(h);
  const request = h.api._runRegion();
  h.nodes.infectBody = { innerHTML: 'NEW TAB' };
  resolve(ok()); await request;
  assert.equal(h.nodes.infectBody.innerHTML, 'NEW TAB');
});
test('inverted period range is rejected before an API request', async () => {
  const h = harness(); const body = modal(h);
  h.nodes.ifPt = { value: '2' }; h.nodes.ifSy = { value: '2026' }; h.nodes.ifEy = { value: '2025' };
  await h.api._runPeriod(true);
  assert(body.textContent.includes('시작연도'));
  assert.equal(h.requests.length, 0);
});
test('table content is escaped', () => {
  const h = harness();
  const html = h.api._tableHtml(['name', 'count'], [['<img src=x onerror=alert(1)>', 1]]);
  assert(html.includes('&lt;img'));
  assert(!html.includes('<img'));
});
test('saved KDCA credential and applied flag are connected to startup restoration', () => {
  const loader = fs.readFileSync(path.join(root, 'src/renderer/core/data-loader.js'), 'utf8');
  assert(loader.includes("dbKey:'kdca_api_key',lsKey:'ec_kdca_api_key'"));
  const flags = loader.slice(loader.indexOf('/* "반영됨" 플래그'), loader.indexOf('persistenceOrchestrator.loadMappings'));
  assert(flags.includes("'kdca_api_key'"));
});
test('applying the KDCA key notifies the dashboard even when its value is unchanged', () => {
  const settings = fs.readFileSync(path.join(root, 'src/renderer/features/settings/settings-view.js'), 'utf8');
  const branch = settings.slice(settings.indexOf("} else if(lsKey==='ec_kdca_api_key')"));
  assert(branch.slice(0, branch.indexOf('} else if', 2)).includes("bus.emit('infectious:settings-changed')"));
});
