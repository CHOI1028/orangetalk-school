'use strict';

// Production renderer entry points, synthetic keys only. No app startup/network/disk writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '../src/renderer');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const helper = read('core/public-data-settings.js').replace(/^export /gm, '');
const common = 'SYNTHETIC%2BCOMMON%2FKEY%3D';
const legacy = 'SYNTHETIC+LEGACY/KEY=';
const pending = () => new Promise(() => {});
const flush = () => new Promise(resolve => setImmediate(resolve));

function productionFunction(file, name) {
  const source = read(file);
  const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const found = tree.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .find(node => node && node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.ok(found, 'Production function exists: ' + name);
  return source.slice(found.start, found.end);
}

function harness(values = {}, extra = {}) {
  const map = new Map(Object.entries(values));
  const storage = { getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
  const context = vm.createContext({ localStorage: storage, console: { log() {}, warn() {} }, ...extra });
  Object.assign(context, vm.runInContext('(function(){' + helper
    + '\nreturn {getPublicDataApiKey,hasPublicDataApiKeySetting};})()', context));
  return { map, context, run: code => vm.runInContext(code, context) };
}

const cases = [
  ['common overrides legacy', { ec_public_data_api_key: common }, common],
  ['legacy still works before common selection', {}, legacy],
  ['explicit common deletion disables legacy', { ec_public_data_api_key: '' }, '']
];

for (const [label, values, expected] of cases) {
  test('holiday request: ' + label, () => {
    const calls = [];
    const h = harness({ ec_holiday_api_key: legacy, ...values }, {
      S: { koreanHolidays: {} }, _holidayInflight: new Set(),
      window: { electronAPI: { statsDbHolidaysFetch(...args) { calls.push(args); return pending(); } } }
    });
    h.run(productionFunction('core/app-state.js', 'ensureHolidayYear') + '\nensureHolidayYear(2028);');
    assert.deepEqual(calls, expected ? [[expected, '2028']] : []);
  });

  test('weather/UV requests: ' + label, async () => {
    const calls = [], fallbacks = [];
    const h = harness({ ec_kma_api_key: legacy, ec_uv_api_key: legacy, ec_airkorea_api_key: legacy,
      ec_airkorea_station: 'Synthetic Station', ...values }, {
      _getLocation: async () => ({ latitude: 37, longitude: 127 }),
      _fetchWeatherOpenMeteo: () => fallbacks.push(true),
      window: { electronAPI: {
        weatherKma(key) { calls.push(['kma', key]); return pending(); },
        weatherUvKma(key) { calls.push(['uv', key]); return pending(); },
        externalFetchAirkorea(key) { calls.push(['airkorea', key]); return pending(); }
      } }
    });
    h.run(productionFunction('features/shell/header-widget.js', 'fetchWeatherKMA') + '\nfetchWeatherKMA();');
    await flush();
    assert.deepEqual(calls, expected ? [['uv', expected], ['kma', expected], ['airkorea', expected]] : []);
    assert.equal(fallbacks.length, expected ? 0 : 1);
  });

  test('drug request: ' + label, () => {
    const calls = [];
    const h = harness({ ec_drug_api_key: legacy, ...values }, {
      document: { getElementById: () => ({}) },
      window: { electronAPI: { externalFetchDrugInfo(...args) { calls.push(args); return pending(); } } }
    });
    h.run(productionFunction('features/settings/settings-tab-diary.js', '_testDrugApiKey') + '\n_testDrugApiKey();');
    assert.deepEqual(calls, expected ? [[expected, '타이레놀']] : []);
  });

  test('medical facility popup: ' + label, () => {
    const calls = [];
    const h = harness({ ec_hira_api_key: legacy, ec_emergency_api_key: legacy,
      ec_kakao_rest_api_key: 'SYNTHETIC_KAKAO_REST', ec_kakao_js_api_key: 'SYNTHETIC_KAKAO_JS', ...values }, {
      S: { settings: { schoolName: 'Synthetic School', eduOffice: '' } },
      window: { electronAPI: { openMedFacility(...args) { calls.push(args); } } }
    });
    h.run(productionFunction('features/daily/daily-view.js', 'openMedFacilityPopup') + '\nopenMedFacilityPopup();');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], expected);
    assert.equal(calls[0][3], expected);
    assert.equal(calls[0][6], 'SYNTHETIC_KAKAO_REST');
    assert.equal(calls[0][7], 'SYNTHETIC_KAKAO_JS');
  });
}

for (const value of [common, '']) {
  test('old weather settings cannot revive/override canonical ' + (value ? 'value' : 'deletion'), () => {
    const source = read('features/shell/header-widget.js');
    const start = source.indexOf('setTimeout(function(){\n  if(!S.settings||!S.settings.weather)return;');
    const end = source.indexOf('},1500);', start);
    assert.ok(start >= 0 && end > start);
    const h = harness({ ec_public_data_api_key: value }, {
      S: { settings: { weather: { kmaApiKey: legacy, airkoreaApiKey: legacy, userRegion: 'Synthetic Region' } } },
      setTimeout: fn => fn()
    });
    h.run(source.slice(start, end + '},1500);'.length));
    assert.equal(h.map.get('ec_public_data_api_key'), value);
    assert.equal(h.map.has('ec_kma_api_key'), false);
    assert.equal(h.map.has('ec_airkorea_api_key'), false);
    assert.equal(h.map.get('ec_user_region'), 'Synthetic Region');
  });

  test('bundled legacy keys cannot revive canonical ' + (value ? 'value' : 'deletion'), async () => {
    const source = read('features/shell/app-bootstrap.js');
    const start = source.indexOf('(async function _seedBundledApiKeys(){');
    const end = source.indexOf('})();', start);
    assert.ok(start >= 0 && end > start);
    const h = harness({ ec_public_data_api_key: value }, { window: { electronAPI: {
      getBundledApiKeys: async () => ({ kma_api_key: legacy, drug_api_key: legacy, kakao_js_api_key: 'SYNTHETIC_KAKAO' }),
      jsonSaveCommon: async () => ({ success: true })
    } } });
    await h.run(source.slice(start, end + '})();'.length));
    assert.equal(h.map.has('ec_kma_api_key'), false);
    assert.equal(h.map.has('ec_drug_api_key'), false);
    assert.equal(h.map.get('ec_kakao_js_api_key'), 'SYNTHETIC_KAKAO');
  });
}

test('all production consumer files use the shared getter rather than direct public-data key reads', () => {
  for (const file of ['core/app-state.js', 'core/event-bindings.js', 'core/infectious-disease.js',
    'features/daily/daily-view.js', 'features/symptom/symptom-view.js',
    'features/settings/settings-tab-diary.js', 'features/shell/header-widget.js']) {
    assert.match(read(file), /import \{[^}]*getPublicDataApiKey[^}]*\} from .*public-data-settings\.js/);
    assert.doesNotMatch(read(file), /localStorage\.getItem\('ec_(?:kma|uv|airkorea|drug|hira|emergency|kdca|holiday)_api_key'\)/);
  }
});

test('obsolete drug-specific writer is removed and factory reset keeps common credentials', () => {
  assert.doesNotMatch(read('features/settings/settings-tab-diary.js'), /drugApiKeyInput|setItem\('ec_drug_api_key'/);
  assert.match(read('features/settings/settings-tab-retention.js'), /'ec_public_data_api_key'/);
});
