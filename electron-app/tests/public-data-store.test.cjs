'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveStoredPublicDataApiKey } = require('../src/main/services/public-data-key-store');

const commonKey = 'SYNTHETIC+COMMON/KEY=';
const oldKey = 'SYNTHETIC+OLD/KEY=';
const requestKey = 'SYNTHETIC+REQUEST/KEY=';
function mockStore(data) {
  return { get(scope, key) {
    assert.equal(scope, 'common');
    return Object.hasOwn(data, key) ? { exists: true, data: data[key] } : { exists: false, data: null };
  } };
}

const keyCases = [
  ['common overrides stale request and legacy key', { public_data_api_key: commonKey, kma_api_key: oldKey }, requestKey, commonKey],
  ['common is trimmed without decoding at selection', { public_data_api_key: ' SYNTHETIC%2BCOMMON%3D ' }, requestKey, 'SYNTHETIC%2BCOMMON%3D'],
  ['explicitly cleared common disables old keys', { public_data_api_key: '', kma_api_key: oldKey }, requestKey, ''],
  ['whitespace common disables old keys', { public_data_api_key: '  ', kma_api_key: oldKey }, requestKey, ''],
  ['present null common does not reactivate old keys', { public_data_api_key: null, kma_api_key: oldKey }, requestKey, ''],
  ['present malformed common is never stringified', { public_data_api_key: { key: commonKey }, kma_api_key: oldKey }, requestKey, ''],
  ['absent common retains explicit legacy request', { kma_api_key: oldKey }, requestKey, requestKey],
  ['absent common retains stored legacy key', { kma_api_key: oldKey }, '', oldKey],
  ['blank request retains stored legacy key', { kma_api_key: oldKey }, '   ', oldKey],
  ['missing keys remain empty', {}, '', '']
];
for (const [label, stored, provided, expected] of keyCases) {
  test('store policy: ' + label, () => {
    const before = JSON.stringify(stored);
    assert.equal(resolveStoredPublicDataApiKey(mockStore(stored), provided, 'kma_api_key'), expected);
    assert.equal(JSON.stringify(stored), before, 'Key selection never changes stored values');
  });
}
test('store policy: UV falls back through its own key then KMA only before common setup', () => {
  assert.equal(resolveStoredPublicDataApiKey(mockStore({ uv_api_key: '', kma_api_key: oldKey }), '', ['uv_api_key', 'kma_api_key']), oldKey);
  assert.equal(resolveStoredPublicDataApiKey(mockStore({ public_data_api_key: '', uv_api_key: oldKey, kma_api_key: oldKey }), '', ['uv_api_key', 'kma_api_key']), '');
});
test('store policy: raw-string store compatibility includes explicit empty tombstone', () => {
  for (const value of [commonKey, '']) {
    assert.equal(resolveStoredPublicDataApiKey({ get: () => value }, requestKey, 'kma_api_key'), value);
  }
});
test('store policy: failed reads never expose objects or exceptions', () => {
  assert.equal(resolveStoredPublicDataApiKey({ get: () => { throw Error('SYNTHETIC'); } }, '', 'kma_api_key'), '');
});

const root = path.resolve(__dirname, '..');
const sources = {
  main: fs.readFileSync(path.join(root, 'main.js'), 'utf8'),
  web: fs.readFileSync(path.join(root, 'web-server/server.js'), 'utf8')
};
function extractFunction(source, name) {
  const match = source.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  assert.ok(match, name);
  return match[0];
}
function routeHarness(target, channel, stored) {
  const source = sources[target];
  const calls = [], saved = [];
  const service = new Proxy({}, { get: (obj, name) => async (...args) => {
    calls.push([name, ...args]);
    if (name === 'fetchEmergencyDetail') return { hpid: args[1] };
    return { success: true, data: {} };
  } });
  const ctx = {
    resolveStoredPublicDataApiKey,
    services: { store: () => mockStore(stored), externalApi: () => service, weather: () => service,
      statsDB: () => ({ cacheHolidays: (...args) => saved.push(args) }) },
    deps: { userDataPath: 'SYNTHETIC_UNUSED' }, app: { getPath: () => 'SYNTHETIC_UNUSED' },
    path: { join: () => 'SYNTHETIC_UNUSED' }, fs: { writeFileSync() {} }
  };
  let invoke;
  if (target === 'main') {
    const match = source.match(new RegExp("  ipcMain\\.handle\\('" + channel + "', async[\\s\\S]*?\\n  \\}\\);"));
    assert.ok(match, target + ' ' + channel);
    ctx.ipcMain = { handle: (name, fn) => { invoke = fn; } };
    vm.runInNewContext(extractFunction(source, '_getStoredCommonString') + '\n' + extractFunction(source, '_getPublicDataApiKey') + '\n' + match[0], ctx);
    return { calls, run: input => invoke({ sender: { send() {} } }, input) };
  }
  const match = source.match(new RegExp("  '" + channel + "': async \\(p\\) => \\{[\\s\\S]*?\\n  \\},"));
  assert.ok(match, target + ' ' + channel);
  invoke = vm.runInNewContext(extractFunction(source, '_getStoredCommon') + '\n' + extractFunction(source, '_withFallback') + '\n'
    + extractFunction(source, '_withPublicDataKey') + '\n({' + match[0] + '})[' + JSON.stringify(channel) + ']', ctx);
  return { calls, run: input => invoke(input) };
}

const routes = [
  ['weather-kma', 'getKmaWeather', 'apiKey', 'kma_api_key', { lat: 37, lon: 127 }],
  ['weather-uv-kma', 'getKmaUvByCoord', 'kmaKey', 'uv_api_key', { kakaoRestKey: 'SYNTHETIC_KAKAO', lat: 37, lon: 127 }],
  ['external-fetch-airkorea', 'fetchAirkorea', 'serviceKey', 'airkorea_api_key', { stationName: 'SYNTHETIC_STATION' }],
  ['external-fetch-airkorea-station-info', 'fetchAirkoreaStationInfo', 'serviceKey', 'airkorea_api_key', { stationName: 'SYNTHETIC_STATION' }],
  ['external-fetch-drug-info', 'fetchDrugInfo', 'serviceKey', 'drug_api_key', { drugName: 'SYNTHETIC_DRUG' }],
  ['external-search-drug-list', 'searchDrugList', 'serviceKey', 'drug_api_key', { query: 'SYNTHETIC_DRUG' }],
  ['external-fetch-med-facilities', 'fetchMedFacilities', 'serviceKey', 'hira_api_key', { params: {} }],
  ['external-fetch-emergency', 'fetchEmergencyInfo', 'serviceKey', 'emergency_api_key', { params: {} }],
  ['external-fetch-emergency-detail', 'fetchEmergencyDetail', 'serviceKey', 'emergency_api_key', { hpids: ['SYNTHETIC_HPID'] }],
  ['stats-db-holidays-fetch', 'fetchHolidays', 'serviceKey', 'holiday_api_key', { year: '2026' }],
  ['medfac-bulk-fetch', 'bulkFetchMedFacilitiesInRadius', 'serviceKey', 'hira_api_key', { emergencyKey: requestKey, params: {} }]
];
for (const target of ['main', 'web']) {
  for (const [channel, method, inputKey, legacyKey, rest] of routes) {
    for (const [mode, common, expected] of [['common', commonKey, commonKey], ['disabled', '', ''], ['legacy', undefined, requestKey]]) {
      test(target + ' ' + channel + ': ' + mode + ' policy', async () => {
        const stored = { [legacyKey]: oldKey, emergency_api_key: oldKey };
        if (common !== undefined) stored.public_data_api_key = common;
        const h = routeHarness(target, channel, stored);
        const result = await h.run({ [inputKey]: requestKey, ...rest });
        if (channel === 'stats-db-holidays-fetch' && mode === 'disabled') {
          assert.equal(result.success, false);
          assert.equal(h.calls.length, 0);
          return;
        }
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0][0], method);
        assert.equal(h.calls[0][1], expected);
        if (channel === 'medfac-bulk-fetch') assert.equal(h.calls[0][2], expected);
        if (channel === 'weather-uv-kma') assert.equal(h.calls[0][2], 'SYNTHETIC_KAKAO');
      });
    }
  }
}

test('custom backup includes common-key tombstone and legacy KMA/UV keys', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/services/custom-backup-keys.js'), 'utf8');
  for (const key of ['ec_public_data_api_key', 'public_data_api_key', 'ec_kma_api_key', 'ec_uv_api_key']) {
    assert.ok(source.includes("'" + key + "'"));
  }
});

function backupHarness(stored) {
  const files = new Map(), writes = [];
  const directories = new Set(['/backup']);
  const mockFs = {
    existsSync: name => directories.has(name) || files.has(name),
    mkdirSync: name => directories.add(name),
    writeFileSync: (name, data) => files.set(name, data),
    readFileSync: name => files.get(name)
  };
  const sandbox = { module: { exports: {} }, console: { warn() {} }, require(name) {
    if (name === 'fs') return mockFs;
    if (name === 'path') return path.posix;
    if (name === './custom-backup-keys') return {
      collect: category => category === 'appDataCommonKeys' ? ['public_data_api_key'] : []
    };
    throw Error('Unexpected require: ' + name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/main/services/custom-backup-service.js'), 'utf8'), sandbox);
  const store = mockStore(stored);
  store.set = (scope, key, value) => writes.push([scope, key, value]);
  return { files, writes, instance: new sandbox.module.exports.CustomBackupService(store, '/unused') };
}
for (const state of ['absent', 'set', 'disabled']) {
  test('custom backup roundtrip: common key ' + state + ' is preserved without wrapper', () => {
    const stored = state === 'absent' ? {} : { public_data_api_key: state === 'set' ? commonKey : '' };
    const h = backupHarness(stored);
    const exported = h.instance.exportTo('/backup', {}, ['apikeys']);
    const payload = JSON.parse(h.files.get(exported.path + '/app-data-common.json'));
    assert.deepEqual(payload, stored);
    h.instance.importFrom(exported.path);
    assert.deepEqual(h.writes, state === 'absent' ? [] : [['common', 'public_data_api_key', stored.public_data_api_key]]);
  });
}
for (const exists of [true, false]) {
  test('custom backup import: old wrapper with exists=' + exists, () => {
    const h = backupHarness({});
    h.files.set('/backup/localStorage.json', '{}');
    h.files.set('/backup/app-data-common.json', JSON.stringify({ public_data_api_key: { exists, data: commonKey } }));
    h.instance.importFrom('/backup');
    assert.deepEqual(h.writes, exists ? [['common', 'public_data_api_key', commonKey]] : []);
  });
}
