/* Authentication transport regression tests. All keys and responses are synthetic.
 * Production service methods run in a VM with fetch replaced; no network, user
 * credentials, application startup, or persistent storage is accessed. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizePublicDataApiKey, encodePublicDataApiKey } = require('../src/shared/public-data-api-key');

const serviceSource = fs.readFileSync(path.join(__dirname, '../src/main/services/external-api-service.js'), 'utf8');
const RAW_KEY = 'SYNTHETIC+KEY/TEST=';
const DELIMITER_KEY = 'SYNTHETIC+KEY/TEST=&injected=1#fragment?%';
const KAKAO_KEY = 'SYNTHETIC_KAKAO_REST_KEY';
const helpers = { normalizePublicDataApiKey, encodePublicDataApiKey };

test('helper accepts raw or encoded public-data keys and trims surrounding whitespace', () => {
  for(const input of [RAW_KEY, encodeURIComponent(RAW_KEY), '  ' + RAW_KEY + '\n', '\t' + encodeURIComponent(RAW_KEY) + '  ']) {
    assert.equal(normalizePublicDataApiKey(input), RAW_KEY);
    assert.equal(encodePublicDataApiKey(input), encodeURIComponent(RAW_KEY));
  }
});

test('helper preserves plus signs and encodes URL separators as credential data', () => {
  for(const input of [DELIMITER_KEY, encodeURIComponent(DELIMITER_KEY)]) {
    const url = new URL('https://example.invalid/?serviceKey=' + encodePublicDataApiKey(input) + '&pageNo=1');
    assert.equal(url.searchParams.get('serviceKey'), DELIMITER_KEY);
    assert.equal(url.searchParams.get('pageNo'), '1');
    assert.equal(url.searchParams.has('injected'), false);
    assert.equal(url.hash, '');
  }
});

test('helper decodes once, not recursively', () => {
  const encodedTwice = encodeURIComponent(encodeURIComponent(RAW_KEY));
  assert.equal(normalizePublicDataApiKey(encodedTwice), encodeURIComponent(RAW_KEY));
  assert.equal(encodePublicDataApiKey(encodedTwice), encodedTwice);
});

test('helper accepts lowercase hexadecimal escapes without changing the underlying key', () => {
  const lower = encodeURIComponent(RAW_KEY).replace(/%[0-9A-F]{2}/g, token => token.toLowerCase());
  assert.equal(normalizePublicDataApiKey(lower), RAW_KEY);
  assert.equal(encodePublicDataApiKey(lower), encodeURIComponent(RAW_KEY));
});

for(const malformed of ['SYNTHETIC%', 'SYNTHETIC%2', 'SYNTHETIC%ZZ', 'SYNTHETIC%E0%A4%A', 'SYNTHETIC%2BTAIL%ZZ']) {
  test('malformed percent escape is preserved safely: ' + malformed, () => {
    assert.equal(normalizePublicDataApiKey('  ' + malformed + '  '), malformed);
    const encoded = encodePublicDataApiKey(malformed);
    assert.equal(new URL('https://example.invalid/?serviceKey=' + encoded).searchParams.get('serviceKey'), malformed);
  });
}

test('missing or whitespace-only credentials normalize to an empty string', () => {
  for(const input of [undefined, null, '', ' \t\n ']) {
    assert.equal(normalizePublicDataApiKey(input), '');
    assert.equal(encodePublicDataApiKey(input), '');
  }
});

test('renderer infectious normalizer stays consistent with the shared CommonJS helper', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '../src/renderer/core/infectious-disease.js'), 'utf8');
  const start = rendererSource.indexOf('export function normalizeInfectiousApiKey(');
  const end = rendererSource.indexOf('\nfunction _key()', start);
  assert(start >= 0 && end > start, 'Production renderer normalizer boundaries must exist');
  const context = vm.createContext({});
  vm.runInContext(rendererSource.slice(start, end).replace(/^export /, ''), context);
  const cases = [undefined, null, '', ' \t\n ', RAW_KEY, encodeURIComponent(RAW_KEY),
    '  ' + RAW_KEY + '  ', '  ' + encodeURIComponent(RAW_KEY) + '  ',
    DELIMITER_KEY, encodeURIComponent(DELIMITER_KEY), encodeURIComponent(encodeURIComponent(RAW_KEY)),
    'SYNTHETIC%2bKEY%2fTEST%3d', 'SYNTHETIC%', 'SYNTHETIC%2', 'SYNTHETIC%ZZ',
    'SYNTHETIC%E0%A4%A', 'SYNTHETIC%2BTAIL%ZZ'];
  for(const input of cases) {
    assert.equal(context.normalizeInfectiousApiKey(input), normalizePublicDataApiKey(input));
  }
});

function serviceHarness(options = {}) {
  const requests = [];
  const fixedNow = new Date(2026, 8, 15, 12).getTime();
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  }
  function responseFor(url) {
    if(url.hostname === 'dapi.kakao.com') {
      assert.equal(url.pathname, '/v2/local/geo/coord2regioncode.json');
      return { documents: [{ region_type: 'B', code: '1111010100' }] };
    }
    assert.equal(url.hostname, 'apis.data.go.kr', 'Only known synthetic service requests are allowed');
    if(url.pathname.endsWith('/getMsrstnAcctoRltmMesureDnsty')) {
      return { response: { body: { items: [{ pm10Value: '10', pm25Value: '5' }] } } };
    }
    if(url.pathname.endsWith('/getMsrstnList')) {
      return { response: { body: { items: [{ stationName: 'Synthetic station', addr: '서울특별시 가상구' }] } } };
    }
    if(url.pathname.endsWith('/getRestDeInfo')) {
      return { response: { body: { totalCount: 1, items: { item: [{ locdate: 20260101, dateName: 'Synthetic holiday', isHoliday: 'Y' }] } } } };
    }
    if(url.pathname.endsWith('/getDrbEasyDrugList')) {
      return { body: { items: [{ itemName: 'SyntheticMedicine', entpName: 'Synthetic company', itemSeq: '000001', efcyQesitm: 'Synthetic text' }] } };
    }
    if(options.uvV4 && url.pathname.endsWith('/getUVIdxV3')) {
      return { response: { header: { resultCode: '30', resultMsg: 'Synthetic V3 unavailable' }, body: { items: { item: [] } } } };
    }
    const supported = /\/(?:getHospBasisList|getParmacyBasisList|getEgytBassInfoInqire|getEgytListInfoInqire|getUVIdxV3|getUVIdxV4|getUltraSrtFcst|getVilageFcst)$/;
    assert.match(url.pathname, supported, 'Unhandled endpoint must not silently pass');
    return { response: { header: { resultCode: '00' }, body: { totalCount: 1, items: { item: [{ hpid: 'SYNTHETIC_HPID', yadmNm: 'Synthetic facility', h0: '3', h3: '3', h6: '3', h9: '3' }] } } } };
  }
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports,
    require(name) {
      assert.equal(name, '../../shared/public-data-api-key', 'The test must not load runtime modules or user storage');
      return helpers;
    },
    Date: FakeDate,
    URL, URLSearchParams, AbortController,
    AbortSignal: { timeout() { return undefined; } },
    setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      const data = responseFor(url);
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => 'application/json' } };
    }
  });
  vm.runInContext(serviceSource, context, { filename: 'external-api-service.js' });
  return {
    requests,
    api: new module.exports.ExternalApiService(),
    weather: new module.exports.WeatherService()
  };
}

const cases = [
  { name: 'KMA weather (ultra and two daily forecasts)', count: 3, run: (h, key) => h.weather.getKmaWeather(key, 37.5, 127) },
  { name: 'KMA UV V3', count: 1, run: (h, key) => h.weather.getKmaUvByCoord(key, KAKAO_KEY, 37.5, 127) },
  { name: 'KMA UV V4 fallback', count: 2, options: { uvV4: true }, run: (h, key) => h.weather.getKmaUvByCoord(key, KAKAO_KEY, 37.5, 127) },
  { name: 'Airkorea measurements', count: 1, run: (h, key) => h.api.fetchAirkorea(key, 'Synthetic station') },
  { name: 'Airkorea station metadata', count: 1, run: (h, key) => h.api.fetchAirkoreaStationInfo(key, 'Synthetic station') },
  { name: 'KASI holidays', count: 1, run: (h, key) => h.api.fetchHolidays(key, 2026) },
  { name: 'Drug search', count: 1, run: (h, key) => h.api.searchDrugList(key, 'SyntheticMedicine') },
  { name: 'Drug detail', count: 1, run: (h, key) => h.api.fetchDrugInfo(key, 'SyntheticMedicine') },
  { name: 'Hospital facilities', count: 1, run: (h, key) => h.api.fetchMedFacilities(key, { type: 'hospital', yadmNm: 'Synthetic facility' }) },
  { name: 'Pharmacy facilities', count: 1, run: (h, key) => h.api.fetchMedFacilities(key, { type: 'pharmacy' }) },
  { name: 'Emergency facilities', count: 1, run: (h, key) => h.api.fetchMedFacilities(key, { type: 'emergency' }) },
  { name: 'Emergency live information', count: 1, run: (h, key) => h.api.fetchEmergencyInfo(key, { lat: 37.5, lng: 127 }) },
  { name: 'Emergency detail', count: 1, run: (h, key) => h.api.fetchEmergencyDetail(key, 'SYNTHETIC_HPID') }
];

function verifyRequests(h, scenario, expectedKey) {
  const apiRequests = h.requests.filter(request => request.url.hostname === 'apis.data.go.kr');
  assert.equal(apiRequests.length, scenario.count, 'Every expected service request must execute');
  for(const { url } of apiRequests) {
    const credentials = [...url.searchParams.entries()].filter(([name]) => name.toLowerCase() === 'servicekey');
    assert.equal(credentials.length, 1, 'A single complete service key must be transmitted');
    assert.equal(credentials[0][1], expectedKey, 'Server-side query decoding must recover the original key exactly');
    assert.equal(url.searchParams.has('injected'), false, 'Credential delimiters must not create extra parameters');
    assert.equal(url.hash, '', 'Credential delimiters must not become a fragment');
    assert.equal(url.searchParams.get('pageNo'), '1');
  }
  for(const { url, init } of h.requests.filter(request => request.url.hostname === 'dapi.kakao.com')) {
    assert.equal(init.headers.Authorization, 'KakaoAK ' + KAKAO_KEY, 'Kakao authentication must remain separate from public-data normalization');
    assert.equal(url.searchParams.has('serviceKey'), false);
  }
  return apiRequests.map(request => request.url.toString());
}

for(const scenario of cases) {
  test(scenario.name + ': missing or blank credentials fail before any request', async () => {
    for(const input of [undefined, null, '', ' \t\n ']) {
      const h = serviceHarness(scenario.options);
      if(scenario.name.startsWith('KMA')) {
        await assert.rejects(() => scenario.run(h, input), /기상청 인증키 없음/);
      } else {
        const result = await scenario.run(h, input);
        if(scenario.name === 'Emergency detail') assert.equal(result, null);
        else {
          assert.equal(result.success, false);
          assert.match(result.error, /API 키/);
        }
      }
      assert.equal(h.requests.length, 0, 'Missing credentials must not start public-data or Kakao requests');
    }
  });

  test(scenario.name + ': raw and encoded keys produce equivalent authenticated URLs', async () => {
    let firstUrls;
    for(const input of [RAW_KEY, encodeURIComponent(RAW_KEY), '  ' + RAW_KEY + '\n', '\t' + encodeURIComponent(RAW_KEY) + ' ']) {
      const h = serviceHarness(scenario.options);
      const result = await scenario.run(h, input);
      assert(result && result.success !== false, 'The synthetic success response must complete the production method');
      const urls = verifyRequests(h, scenario, RAW_KEY);
      if(firstUrls) assert.deepEqual(urls, firstUrls);
      else firstUrls = urls;
    }
  });

  test(scenario.name + ': reserved characters in raw and encoded keys cannot change the query', async () => {
    for(const input of [DELIMITER_KEY, encodeURIComponent(DELIMITER_KEY)]) {
      const h = serviceHarness(scenario.options);
      const result = await scenario.run(h, input);
      assert(result && result.success !== false);
      verifyRequests(h, scenario, DELIMITER_KEY);
    }
  });
}

test('KMA helper normalization does not decode or encode a Kakao REST header value', async () => {
  const h = serviceHarness();
  const kakaoLiteral = 'SYNTHETIC%2BLITERAL+VALUE';
  await h.weather.getKmaUvByCoord(encodeURIComponent(RAW_KEY), kakaoLiteral, 37.5, 127);
  const request = h.requests.find(item => item.url.hostname === 'dapi.kakao.com');
  assert.equal(request.init.headers.Authorization, 'KakaoAK ' + kakaoLiteral);
});
