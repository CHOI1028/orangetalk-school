'use strict';

// All credentials, stores and transports are synthetic. No app, network or user DB starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { preparePublicDataProxyRequest } = require('../src/main/services/public-data-key-store');

const KEY = 'SYNTHETIC+HOST/KEY=&?# 한글';
const OLD = 'SYNTHETIC_OLD_KEY';
const BASE = 'https://apis.data.go.kr';
const REGION = '/1790387/EIDAPIService/Region';
const requestUrl = BASE + REGION + '?serviceKey=' + OLD + '&searchYear=2026';
function store(value, exists = true) {
  const reads = [];
  return { reads, get(scope, key) {
    reads.push([scope, key]);
    assert.equal(scope, 'common'); assert.equal(key, 'public_data_api_key');
    return { exists, data: value };
  } };
}
const paths = [
  REGION, '/1790387/EIDAPIService/PeriodBasic', '/1790387/EIDAPIService/Age',
  '/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst', '/1360000/VilageFcstInfoService_2.0/getVilageFcst',
  '/1360000/LivingWthrIdxServiceV3/getUVIdxV3', '/1360000/LivingWthrIdxServiceV4/getUVIdxV4',
  '/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty', '/B552584/MsrstnInfoInqireSvc/getMsrstnList',
  '/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList', '/B551182/hospInfoServicev2/getHospBasisList',
  '/B551182/pharmacyInfoService/getParmacyBasisList', '/B552657/ErmctInfoInqireService/getEgytListInfoInqire',
  '/B552657/ErmctInfoInqireService/getEgytBassInfoInqire', '/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
];
for (const apiPath of paths) {
  test('proxy key allowlist: ' + apiPath, () => {
    const r = preparePublicDataProxyRequest(store(KEY), BASE + apiPath + '?serviceKey=' + OLD);
    assert.equal(r.success, true); assert.equal(r.usesStoredKey, true);
    const url = new URL(r.url);
    assert.equal(url.origin, BASE);
    assert.equal(url.searchParams.get(apiPath.startsWith('/B090041/') ? 'ServiceKey' : 'serviceKey'), KEY);
    assert.equal(url.href.includes(OLD), false);
  });
}
for (const value of [KEY, encodeURIComponent(KEY), '  ' + encodeURIComponent(KEY) + '  ']) {
  test('proxy key is normalized once and query special characters stay data: ' + value, () => {
    const original = requestUrl + '&name=%ED%95%9C%EA%B8%80%20%2B%26%3F&duplicate=1&duplicate=2#view';
    const r = preparePublicDataProxyRequest(store(value), original);
    const url = new URL(r.url);
    assert.equal(url.searchParams.get('serviceKey'), KEY);
    assert.equal(url.searchParams.get('name'), '한글 +&?');
    assert.deepEqual(url.searchParams.getAll('duplicate'), ['1', '2']);
    assert.equal(url.hash, '#view'); assert.equal(url.searchParams.size, 5);
  });
}
test('proxy key removes duplicate and case-variant credentials without touching other parameters', () => {
  const url = new URL(preparePublicDataProxyRequest(store(KEY), requestUrl
    + '&serviceKey=SECOND&ServiceKey=THIRD&SERVICEKEY=FOURTH&servicekey=FIFTH').url);
  assert.deepEqual([...url.searchParams].filter(([name]) => name.toLowerCase() === 'servicekey'), [['serviceKey', KEY]]);
  assert.equal(url.searchParams.get('searchYear'), '2026');
});
test('proxy key does not recursively decode a literal encoded key', () => {
  const encoded = encodeURIComponent('SYNTHETIC%2B');
  assert.equal(new URL(preparePublicDataProxyRequest(store(encoded), requestUrl).url).searchParams.get('serviceKey'), 'SYNTHETIC%2B');
  assert.equal(new URL(preparePublicDataProxyRequest(store('SYNTHETIC%ZZ'), requestUrl).url).searchParams.get('serviceKey'), 'SYNTHETIC%ZZ');
});
for (const value of ['', '   ', null, { key: KEY }, 123]) {
  test('proxy key blocks explicitly disabled or malformed canonical: ' + JSON.stringify(value), () => {
    const r = preparePublicDataProxyRequest(store(value), requestUrl);
    assert.equal(r.success, false); assert.equal(r.errorKind, 'disabled');
    assert.equal('url' in r, false); assert.equal(JSON.stringify(r).includes(OLD), false);
    assert.equal(JSON.stringify(r).includes(KEY), false);
  });
}
test('proxy key accepts raw-string store shape and empty tombstone', () => {
  assert.equal(new URL(preparePublicDataProxyRequest({ get: () => KEY }, requestUrl).url).searchParams.get('serviceKey'), KEY);
  assert.equal(preparePublicDataProxyRequest({ get: () => '' }, requestUrl).success, false);
});
test('proxy key lookup failure is fail-closed and sanitized', () => {
  const r = preparePublicDataProxyRequest({ get: () => { throw Error(requestUrl); } }, requestUrl);
  assert.equal(r.success, false); assert.equal(r.errorKind, 'settings');
  assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC|https:|serviceKey/);
});
for (const url of [requestUrl, requestUrl + '&serviceKey=SECOND&name=A%20B%2B%2f', BASE + REGION + '?ServiceKey=SYNTHETIC%252B']) {
  test('absent canonical preserves all legacy request bytes: ' + url, () => {
    assert.deepEqual(preparePublicDataProxyRequest(store(null, false), url), { success: true, url, usesStoredKey: false });
  });
}
const ineligible = [
  'https://apis.data.go.kr.attacker.invalid' + REGION + '?serviceKey=' + OLD,
  'https://attacker.invalid/apis.data.go.kr' + REGION + '?serviceKey=' + OLD,
  'https://apis.data.go.kr@attacker.invalid' + REGION + '?serviceKey=' + OLD,
  'https://user:pass@apis.data.go.kr' + REGION + '?serviceKey=' + OLD,
  'https://apis.data.go.kr:444' + REGION + '?serviceKey=' + OLD,
  'https://apis.data.go.kr.' + REGION + '?serviceKey=' + OLD,
  'http://apis.data.go.kr' + REGION + '?serviceKey=' + OLD,
  BASE + '/unregistered/service?serviceKey=' + OLD,
  BASE + REGION + '/extra?serviceKey=' + OLD,
  BASE + '/1790387/EIDAPIService/%52egion?serviceKey=' + OLD,
  BASE + REGION + '?KEY=' + OLD,
  BASE + REGION + '?searchYear=2026',
  'https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=' + OLD,
  'https://example.invalid/banner.json', '', 'not-a-url'
];
for (const url of ineligible) {
  test('proxy never injects or reads host key for unrelated or unsafe URL: ' + url, () => {
    const storage = store(KEY);
    assert.deepEqual(preparePublicDataProxyRequest(storage, url), { success: true, url, usesStoredKey: false });
    assert.equal(storage.reads.length, 0);
  });
}

const root = path.resolve(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(root, 'src/main/services/external-api-service.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const webSource = fs.readFileSync(path.join(root, 'web-server/server.js'), 'utf8');
const serviceMatch = serviceSource.match(/  async fetchJson\(url, options = \{\}\) \{[\s\S]*?\n  \}/);
const mainMatch = mainSource.match(/  ipcMain\.handle\('external-fetch-json', async[\s\S]*?\n  \}\);/);
const webMatch = webSource.match(/  'external-fetch-json': async \(p\) => \{[\s\S]*?\n  \},/);
assert.ok(serviceMatch); assert.ok(mainMatch); assert.ok(webMatch);
function response(status = 200) {
  return { status, headers: { get: () => 'application/json' }, text: async () => '{}' };
}
function routeHarness(target, storage, fetchImpl = async () => response()) {
  const calls = [];
  let invoke;
  const context = vm.createContext({ URL, AbortSignal, preparePublicDataProxyRequest,
    services: { store: () => storage },
    ipcMain: { handle: (_name, fn) => { invoke = input => fn({}, input); } },
    fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); }
  });
  if (target === 'main') {
    const external = vm.runInContext('({' + serviceMatch[0] + '})', context);
    context.services.externalApi = () => external;
    vm.runInContext(mainMatch[0], context);
  } else invoke = vm.runInContext('({' + webMatch[0] + '})["external-fetch-json"]', context);
  return { calls, run: async (url = requestUrl) => JSON.parse(JSON.stringify(await invoke({ url }))) };
}
for (const target of ['main', 'web']) {
  test(target + ': stale shared-PC request uses host canonical, including encoded credentials', async () => {
    const h = routeHarness(target, store(encodeURIComponent(KEY)));
    assert.equal((await h.run()).success, true);
    assert.equal(h.calls.length, 1);
    assert.equal(new URL(h.calls[0].url).searchParams.get('serviceKey'), KEY);
    assert.equal(h.calls[0].options.redirect, 'manual');
  });
  test(target + ': host key is re-read on every request before client SSE catches up', async () => {
    let current = KEY;
    const h = routeHarness(target, { get: () => ({ exists: true, data: current }) });
    await h.run(); current = 'SYNTHETIC_NEW'; await h.run(); current = ''; const stopped = await h.run();
    assert.deepEqual(h.calls.map(call => new URL(call.url).searchParams.get('serviceKey')), [KEY, 'SYNTHETIC_NEW']);
    assert.equal(stopped.success, false); assert.equal(stopped.errorKind, 'disabled');
  });
  test(target + ': explicitly disabled host key blocks network despite stale supplied key', async () => {
    const h = routeHarness(target, store(''));
    assert.equal((await h.run()).errorKind, 'disabled'); assert.equal(h.calls.length, 0);
  });
  test(target + ': missing canonical retains legacy request and normal redirect behavior', async () => {
    const h = routeHarness(target, store(null, false)); await h.run();
    assert.equal(h.calls[0].url, requestUrl); assert.equal(h.calls[0].options.redirect, undefined);
  });
  test(target + ': NEIS and unrelated JSON do not receive the common credential', async () => {
    const h = routeHarness(target, store(KEY));
    const urls = ['https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=SYNTHETIC_NEIS', 'https://example.invalid/banner.json',
      'https://apis.data.go.kr.attacker.invalid' + REGION + '?serviceKey=' + OLD];
    for (const url of urls) await h.run(url);
    assert.deepEqual(h.calls.map(call => call.url), urls);
    assert.ok(h.calls.every(call => !call.url.includes(encodeURIComponent(KEY)) && call.options.redirect === undefined));
  });
  test(target + ': injected key cannot follow a redirect to an unrelated endpoint', async () => {
    let followed = false;
    const h = routeHarness(target, store(KEY), async (_url, options) => {
      if (options.redirect !== 'manual') followed = true;
      return response(302);
    });
    const result = await h.run();
    assert.equal(result.status, 302); assert.equal(followed, false); assert.equal(h.calls.length, 1);
  });
  test(target + ': fetch exceptions do not expose the resolved key or URL', async () => {
    const h = routeHarness(target, store(KEY), async url => { throw Error(url); });
    const result = await h.run();
    assert.equal(result.success, false); assert.equal(result.errorKind, 'network');
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|https:|serviceKey/);
  });
  test(target + ': store exceptions do not fetch with stale client credentials', async () => {
    const h = routeHarness(target, { get: () => { throw Error(KEY); } });
    const result = await h.run();
    assert.equal(result.success, false); assert.equal(result.errorKind, 'settings');
    assert.equal(h.calls.length, 0); assert.equal(JSON.stringify(result).includes(KEY), false);
  });
}
