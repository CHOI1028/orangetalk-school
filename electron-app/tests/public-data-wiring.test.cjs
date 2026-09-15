'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run production handlers in isolation: never start Electron, a server, or real network requests.
const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'web-server/server.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'web-server/web-api-bridge.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const clientKey = 'SYNTHETIC+CLIENT/ONLY=';
const hostKey = 'SYNTHETIC%2BHOST%2FONLY%3D';

function functionSource(source, name) {
  const match = source.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  assert.ok(match, 'Production function must exist: ' + name);
  return match[0];
}
const storedMainSource = functionSource(mainSource, '_getStoredCommonString');
const storedServerSource = functionSource(serverSource, '_getStoredCommon');
const fallbackSource = functionSource(serverSource, '_withFallback');

function webHarness(channel, { stored = {}, external = {}, weather = {} } = {}) {
  const match = serverSource.match(new RegExp("  '" + channel + "': async \\(p\\) => \\{[\\s\\S]*?\\n  \\},"));
  assert.ok(match, 'Production web handler must exist: ' + channel);
  const reads = [];
  const invoke = vm.runInNewContext(storedServerSource + '\n' + fallbackSource
    + '\n({' + match[0] + '})[' + JSON.stringify(channel) + ']', {
    services: {
      store: () => ({ get(scope, key) {
        reads.push({ scope, key });
        return Object.hasOwn(stored, key) ? { exists: true, data: stored[key] } : { exists: false, data: null };
      } }),
      externalApi: () => external,
      weather: () => weather
    }
  });
  return { reads, run: async input => plain(await invoke(input)) };
}

const flatRoutes = [
  { channel: 'external-fetch-airkorea', method: 'fetchAirkorea', storedKey: 'airkorea_api_key',
    input: { stationName: 'SYNTHETIC_STATION' }, argument: 'SYNTHETIC_STATION',
    result: { success: true, data: { pm10: '21', pm25: '8', o3: '0.01' } } },
  { channel: 'external-fetch-med-facilities', method: 'fetchMedFacilities', storedKey: 'hira_api_key',
    input: { params: { type: 'pharmacy', pageNo: 2, numOfRows: 3 } }, argument: { type: 'pharmacy', pageNo: 2, numOfRows: 3 },
    result: { success: true, data: [{ yadmNm: 'SYNTHETIC_FACILITY' }], totalCount: 23 } },
  { channel: 'external-fetch-emergency', method: 'fetchEmergencyInfo', storedKey: 'emergency_api_key',
    input: { params: { lat: 36.5, lng: 127, pageNo: 3 } }, argument: { lat: 36.5, lng: 127, pageNo: 3 },
    result: { success: true, data: [{ hpid: 'SYNTHETIC_HPID' }], totalCount: 37 } }
];

for (const route of flatRoutes) {
  for (const [label, provided, expected] of [
    ['client key has priority', clientKey, clientKey],
    ['empty client key uses host key', '', hostKey],
    ['missing client key uses host key', undefined, hostKey]
  ]) {
    test(route.channel + ': ' + label + ' and response stays flat', async () => {
      const calls = [];
      const h = webHarness(route.channel, {
        stored: { [route.storedKey]: hostKey },
        external: { [route.method]: async (...args) => { calls.push(plain(args)); return route.result; } }
      });
      assert.deepEqual(await h.run({ ...route.input, serviceKey: provided }), route.result);
      assert.deepEqual(calls, [[expected, route.argument]]);
      if (provided) assert.equal(h.reads.length, 0, 'Host storage must not override an explicitly provided key');
    });
  }
  test(route.channel + ': forwards service failure without false success wrapper', async () => {
    const result = { success: false, error: 'SYNTHETIC_AUTH_ERROR' };
    const h = webHarness(route.channel, { external: { [route.method]: async () => result } });
    assert.deepEqual(await h.run({ ...route.input, serviceKey: clientKey }), result);
  });
  test(route.channel + ': catches a rejected service call', async () => {
    const h = webHarness(route.channel, { external: { [route.method]: async () => { throw Error('SYNTHETIC_FAILURE'); } } });
    assert.deepEqual(await h.run({ ...route.input, serviceKey: clientKey }), { success: false, error: 'SYNTHETIC_FAILURE' });
  });
}

test('shared air: host station fallback is independent of the client key', async () => {
  const calls = [];
  const h = webHarness('external-fetch-airkorea', {
    stored: { airkorea_api_key: hostKey, airkorea_station: 'HOST_STATION' },
    external: { fetchAirkorea: async (...args) => { calls.push(args); return { success: true, data: {} }; } }
  });
  await h.run({ serviceKey: clientKey, stationName: '' });
  assert.deepEqual(calls, [[clientKey, 'HOST_STATION']]);
});

for (const provided of [clientKey, '']) {
  test('shared emergency detail: ID-wise calls, flat items, null removal, key ' + (provided ? 'client' : 'host'), async () => {
    const calls = [];
    const h = webHarness('external-fetch-emergency-detail', {
      stored: { emergency_api_key: hostKey },
      external: { fetchEmergencyDetail: async (key, id) => {
        calls.push([key, id]);
        return id === 'MISSING' ? null : { hpid: id, dutyName: 'SYNTHETIC_' + id };
      } }
    });
    assert.deepEqual(await h.run({ serviceKey: provided, hpids: ['A', 'MISSING', 'B'] }), {
      success: true, data: [{ hpid: 'A', dutyName: 'SYNTHETIC_A' }, { hpid: 'B', dutyName: 'SYNTHETIC_B' }]
    });
    assert.deepEqual(calls, ['A', 'MISSING', 'B'].map(id => [provided || hostKey, id]));
  });
}

test('shared emergency detail: empty IDs do not call the service', async () => {
  const h = webHarness('external-fetch-emergency-detail', {
    external: { fetchEmergencyDetail: async () => { throw Error('Must not call'); } }
  });
  assert.deepEqual(await h.run({ serviceKey: clientKey, hpids: [] }), { success: true, data: [] });
});

const uvCases = [
  { label: 'explicit client keys take priority', input: { kmaKey: clientKey, kakaoRestKey: 'CLIENT_KAKAO' },
    stored: { uv_api_key: hostKey, kma_api_key: 'HOST_KMA', kakao_rest_api_key: 'HOST_KAKAO' }, expected: [clientKey, 'CLIENT_KAKAO'] },
  { label: 'host UV key and unwrapped Kakao key', input: { kmaKey: '', kakaoRestKey: '' },
    stored: { uv_api_key: hostKey, kma_api_key: 'HOST_KMA', kakao_rest_api_key: 'HOST_KAKAO' }, expected: [hostKey, 'HOST_KAKAO'] },
  { label: 'missing UV key falls back to host KMA', input: {},
    stored: { kma_api_key: 'HOST_KMA', kakao_rest_api_key: 'HOST_KAKAO' }, expected: ['HOST_KMA', 'HOST_KAKAO'] },
  { label: 'empty stored UV key falls back to host KMA', input: {},
    stored: { uv_api_key: '', kma_api_key: 'HOST_KMA', kakao_rest_api_key: 'HOST_KAKAO' }, expected: ['HOST_KMA', 'HOST_KAKAO'] },
  { label: 'missing credentials remain empty strings', input: {}, stored: {}, expected: ['', ''] }
];
for (const fixture of uvCases) {
  test('shared UV: ' + fixture.label, async () => {
    const calls = [];
    const h = webHarness('weather-uv-kma', {
      stored: fixture.stored,
      weather: { getKmaUvByCoord: async (...args) => { calls.push(args); return { uv: 3 }; } }
    });
    assert.deepEqual(await h.run({ ...fixture.input, lat: 36.5, lon: 127 }), { success: true, data: { uv: 3 } });
    assert.deepEqual(calls, [[...fixture.expected, 36.5, 127]]);
  });
}

test('web UV bridge forwards the exact IPC channel, payload, and response', async () => {
  const match = bridgeSource.match(/^    weatherUvKma: function\([^\n]+$/m);
  assert.ok(match, 'The shared web bridge must expose weatherUvKma');
  const calls = [], response = { success: true, data: { uv: 4 } };
  const invoke = vm.runInNewContext('({' + match[0] + '}).weatherUvKma', {
    _ipc: async (channel, payload) => { calls.push({ channel, payload: plain(payload) }); return response; }
  });
  assert.deepEqual(await invoke(clientKey, 'SYNTHETIC_KAKAO', 36.5, 127), response);
  assert.deepEqual(calls, [{ channel: 'weather-uv-kma', payload: {
    kmaKey: clientKey, kakaoRestKey: 'SYNTHETIC_KAKAO', lat: 36.5, lon: 127
  } }]);
});

for (const [label, entry, expected] of [
  ['current stored wrapper', { exists: true, data: hostKey }, hostKey],
  ['legacy raw string', clientKey, clientKey],
  ['missing wrapper', { exists: false, data: hostKey }, ''],
  ['null entry', null, ''],
  ['undefined entry', undefined, ''],
  ['null data', { exists: true, data: null }, ''],
  ['object data', { exists: true, data: { key: hostKey } }, ''],
  ['numeric data', { exists: true, data: 123 }, ''],
  ['empty string', { exists: true, data: '' }, '']
]) {
  test('main stored string helper: ' + label, () => {
    const calls = [];
    const get = vm.runInNewContext(storedMainSource + '\n_getStoredCommonString', {
      services: { store: () => ({ get: (...args) => { calls.push(args); return entry; } }) }
    });
    assert.equal(get('emergency_api_key'), expected);
    assert.deepEqual(calls, [['common', 'emergency_api_key']]);
  });
}
test('main stored string helper: storage failure stays empty', () => {
  const get = vm.runInNewContext(storedMainSource + '\n_getStoredCommonString', {
    services: { store: () => { throw Error('SYNTHETIC_STORE_FAILURE'); } }
  });
  assert.equal(get('emergency_api_key'), '');
});

for (const provided of ['CLIENT_KAKAO', '']) {
  test('main UV IPC: ' + (provided ? 'explicit Kakao key wins' : 'host Kakao wrapper is unwrapped'), async () => {
    const match = mainSource.match(/  ipcMain\.handle\('weather-uv-kma', async[\s\S]*?\n  \}\);/);
    assert.ok(match, 'Production main UV IPC handler must exist');
    let invoke;
    const calls = [], reads = [];
    vm.runInNewContext(storedMainSource + '\n' + match[0], {
      ipcMain: { handle(channel, handler) { assert.equal(channel, 'weather-uv-kma'); invoke = handler; } },
      services: {
        store: () => ({ get(scope, key) { reads.push([scope, key]); return { exists: true, data: 'HOST_KAKAO' }; } }),
        weather: () => ({ getKmaUvByCoord: async (...args) => { calls.push(args); return { uv: 5 }; } })
      }
    });
    assert.deepEqual(plain(await invoke({}, { kmaKey: clientKey, kakaoRestKey: provided, lat: 36.5, lon: 127 })), {
      success: true, data: { uv: 5 }
    });
    assert.deepEqual(calls, [[clientKey, provided || 'HOST_KAKAO', 36.5, 127]]);
    assert.deepEqual(reads, provided ? [] : [['common', 'kakao_rest_api_key']]);
  });
}

const prefetchStart = mainSource.indexOf('        let emgDetails = [];');
const prefetchEnd = mainSource.indexOf('        global._medFacCache = {', prefetchStart);
assert.ok(prefetchStart >= 0 && prefetchEnd > prefetchStart, 'Production emergency prefetch block must exist');
const prefetchSource = mainSource.slice(prefetchStart, prefetchEnd);
function prefetchHarness(key, list, detail) {
  const lists = [], details = [];
  const invoke = vm.runInNewContext(storedMainSource + '\n(async () => {\n' + prefetchSource + '\nreturn emgDetails; })', {
    lat: '36.5', lng: '127',
    console: { log() {} },
    services: {
      store: () => ({ get: () => ({ exists: true, data: key }) }),
      externalApi: () => ({
        fetchEmergencyInfo: async (received, params) => { lists.push([received, plain(params)]); return list(params.pageNo); },
        fetchEmergencyDetail: async (received, hpid) => { details.push([received, hpid]); return detail(hpid); }
      })
    }
  });
  return { lists, details, run: async () => plain(await invoke()) };
}

test('main emergency prefetch: aggregates five pages, sorts closest ten, filters missing/rejected details', async () => {
  const h = prefetchHarness(hostKey, page => ({ success: true, data: [0, 1, 2].map(index => {
    const distance = 16 - ((page - 1) * 3 + index + 1);
    return { hpid: 'HP' + distance, wgs84Lat: 36.5 + distance / 1000, wgs84Lon: 127 };
  }) }), id => {
    if (id === 'HP2') return null;
    if (id === 'HP3') throw Error('SYNTHETIC_DETAIL_FAILURE');
    return { hpid: id };
  });
  assert.deepEqual(await h.run(), [1, 4, 5, 6, 7, 8, 9, 10].map(n => ({ hpid: 'HP' + n })));
  assert.deepEqual(h.lists, [1, 2, 3, 4, 5].map(pageNo => [hostKey, { lat: '36.5', lng: '127', pageNo }]));
  assert.deepEqual(h.details, Array.from({ length: 10 }, (_, i) => [hostKey, 'HP' + (i + 1)]));
});

test('main emergency prefetch: failed, invalid, and rejected pages do not pollute successful results', async () => {
  const h = prefetchHarness(clientKey, page => {
    if (page === 1) return { success: false, data: [{ hpid: 'BAD' }] };
    if (page === 2) return { success: true, data: { hpid: 'BAD' } };
    if (page === 3) throw Error('SYNTHETIC_LIST_FAILURE');
    if (page === 4) return { success: true, data: [] };
    return { success: true, data: [{ hpid: 'GOOD', wgs84Lat: 36.51, wgs84Lon: 127 }] };
  }, id => ({ hpid: id }));
  assert.deepEqual(await h.run(), [{ hpid: 'GOOD' }]);
  assert.equal(h.lists.length, 5);
  assert.deepEqual(h.details, [[clientKey, 'GOOD']]);
});

test('main emergency prefetch: absent key causes no API requests', async () => {
  const h = prefetchHarness('', () => { throw Error('Must not call'); }, () => { throw Error('Must not call'); });
  assert.deepEqual(await h.run(), []);
  assert.deepEqual(h.lists, []);
  assert.deepEqual(h.details, []);
});
