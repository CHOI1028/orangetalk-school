/* Synthetic in-memory persistence tests. No user storage, credentials, network,
 * application startup, or filesystem writes are used by the tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/core/public-data-settings.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace(/^export /gm, ''), context);
const { getPublicDataApiKey: getKey, hasPublicDataApiKeySetting: hasKey,
  getPublicDataMigrationCandidate: candidate, savePublicDataApiKey: save,
  loadPublicDataApiKey: load } = context;
const LS = 'ec_public_data_api_key';
const DB = 'public_data_api_key';
const RAW = 'SYNTHETIC+PUBLIC/KEY=';
const ENCODED = encodeURIComponent(RAW);
const SERVICES = ['kma', 'uv', 'airkorea', 'drug', 'hira', 'emergency', 'kdca', 'holiday'];
function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function api(overrides = {}) {
  return { dbSet: async () => ({ success: true }),
    dbGet: async () => ({ success: true, exists: false, data: null }), ...overrides };
}

for (const service of SERVICES) {
  test(service + ': canonical key wins; absence falls back; blank deliberately disables', () => {
    const s = storage({ ['ec_' + service + '_api_key']: '  LEGACY  ' });
    assert.equal(getKey(service, s), 'LEGACY');
    assert.equal(hasKey(s), false);
    s.setItem(LS, '  ' + ENCODED + '  ');
    assert.equal(hasKey(s), true);
    assert.equal(getKey(service, s), ENCODED, 'getter must not decode before transport');
    s.setItem(LS, '');
    assert.equal(getKey(service, s), '');
    assert.equal(hasKey(s), true);
    assert.equal(s.getItem('ec_' + service + '_api_key'), '  LEGACY  ');
  });
}
test('UV uses legacy KMA only when its own key and canonical are absent', () => {
  const s = storage({ ec_kma_api_key: RAW });
  assert.equal(getKey('uv', s), RAW);
  s.setItem('ec_uv_api_key', 'UV');
  assert.equal(getKey('uv', s), 'UV');
  s.setItem(LS, '');
  assert.equal(getKey('uv', s), '');
});
test('unknown APIs never receive the public-data credential', () => {
  const s = storage({ [LS]: RAW });
  for (const service of ['kakao', 'neis', '__proto__', '', undefined]) assert.equal(getKey(service, s), '');
});
test('missing storage is safe without browser globals', () => {
  assert.equal(getKey('kma'), '');
  assert.equal(hasKey(), false);
  assert.deepEqual(plain(candidate()), { key: '', conflict: false, count: 0 });
});
test('migration compares raw and encoded forms once and preserves the original representation', () => {
  const s = storage({ ec_kma_api_key: ' ' + ENCODED + ' ', ec_drug_api_key: RAW, ec_uv_api_key: '  ' });
  assert.deepEqual(plain(candidate(s)), { key: ENCODED, conflict: false, count: 2 });
  assert.equal(s.getItem(LS), null, 'a suggestion is not an automatic migration');
});
test('different legacy credentials require a choice, never the first arbitrary key', () => {
  const s = storage({ ec_kma_api_key: RAW, ec_drug_api_key: 'ANOTHER' });
  assert.deepEqual(plain(candidate(s)), { key: '', conflict: true, count: 2 });
});
test('migration normalization does not recursively decode or reinterpret plus signs', () => {
  const s = storage({ ec_kma_api_key: ENCODED, ec_drug_api_key: encodeURIComponent(ENCODED) });
  assert.equal(candidate(s).conflict, true);
  s.setItem('ec_drug_api_key', RAW.replace('+', ' '));
  assert.equal(candidate(s).conflict, true);
  s.setItem('ec_kma_api_key', 'SYNTHETIC%ZZ');
  s.setItem('ec_drug_api_key', 'SYNTHETIC%ZZ');
  assert.equal(candidate(s).key, 'SYNTHETIC%ZZ');
});
test('saving waits for DB confirmation before changing local state or backing up', async () => {
  const gate = deferred();
  const s = storage({ [LS]: 'OLD', ec_kma_api_key: 'LEGACY' });
  const calls = [];
  const backend = api({ dbSet: (...args) => { calls.push(args); return gate.promise; },
    jsonSaveCommon: async (...args) => { calls.push(args); return { success: true }; } });
  const pending = save('  ' + ENCODED + ' ', { api: backend, storage: s });
  assert.equal(s.getItem(LS), 'OLD');
  assert.equal(calls.length, 1);
  gate.resolve({ success: true });
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(result.backupSaved, true);
  assert.equal(result.cacheSaved, true);
  assert.equal(s.getItem(LS), ENCODED);
  assert.equal(s.getItem('ec_kma_api_key'), 'LEGACY');
  assert.deepEqual(calls, [['common', DB, ENCODED], [DB, ENCODED]]);
});
for (const response of [undefined, null, false, {}, { success: false, error: 'SECRET synthetic backend error' }]) {
  test('unsuccessful or malformed DB acknowledgement cannot claim a successful save: ' + JSON.stringify(response), async () => {
    const s = storage({ [LS]: 'OLD' });
    let backups = 0;
    const result = await save(RAW, { storage: s, api: api({ dbSet: async () => response,
      jsonSaveCommon: async () => { backups++; } }) });
    assert.equal(result.success, false);
    assert.equal(s.getItem(LS), 'OLD');
    assert.equal(backups, 0);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  });
}
test('thrown save errors are sanitized and preserve previous cache', async () => {
  const s = storage({ [LS]: 'OLD' });
  const result = await save(RAW, { storage: s, api: api({ dbSet: async () => { throw Error('SECRET'); } }) });
  assert.equal(result.success, false);
  assert.equal(result.error.includes('SECRET'), false);
  assert.equal(s.getItem(LS), 'OLD');
});
test('invalid values and missing persistence API are rejected', async () => {
  for (const value of [null, undefined, {}, 123]) assert.equal((await save(value, { api: api() })).success, false);
  assert.equal((await save(RAW, { api: null })).success, false);
  assert.equal((await save(RAW, { api: {} })).success, false);
});
test('empty saves persist a tombstone and leave all legacy keys intact', async () => {
  const s = storage(Object.fromEntries(SERVICES.map(service => ['ec_' + service + '_api_key', RAW])));
  const writes = [];
  const result = await save(' \t ', { storage: s, api: api({
    dbSet: async (...args) => { writes.push(args); return { success: true }; },
    jsonSaveCommon: async (...args) => { writes.push(args); return 'synthetic/backup.json'; } }) });
  assert.equal(result.success, true);
  assert.equal(result.backupSaved, true);
  assert.deepEqual(writes, [['common', DB, ''], [DB, '']]);
  assert.equal(s.getItem(LS), '');
  for (const service of SERVICES) assert.equal(s.getItem('ec_' + service + '_api_key'), RAW);
});
test('JSON backup failures are reported separately after primary DB persistence', async () => {
  for (const backup of [async () => ({ success: false, error: 'SECRET' }), async () => { throw Error('SECRET'); }, async () => undefined]) {
    const s = storage();
    const result = await save(RAW, { storage: s, api: api({ jsonSaveCommon: backup }) });
    assert.equal(result.success, true);
    assert.equal(result.backupSaved, false);
    assert.equal(s.getItem(LS), RAW);
    assert(result.warning);
    assert.equal(result.warning.includes('SECRET'), false);
  }
});
test('local cache failure is not mistaken for database failure', async () => {
  const s = { getItem: () => null, setItem: () => { throw Error('SECRET'); } };
  const result = await save(RAW, { storage: s, api: api() });
  assert.equal(result.success, true);
  assert.equal(result.cacheSaved, false);
  assert(result.warning);
});
test('DB is authoritative including empty tombstones despite old JSON and local keys', async () => {
  for (const key of ['', RAW]) {
    const s = storage({ [LS]: 'STALE', ec_kma_api_key: 'LEGACY' });
    let reads = 0;
    const result = await load({ storage: s, api: api({ dbGet: async () => ({ success: true, exists: true, data: key }),
      jsonLoadCommon: async () => { reads++; return { exists: true, data: 'STALE_JSON' }; } }) });
    assert.equal(result.success, true);
    assert.equal(result.source, 'db');
    assert.equal(s.getItem(LS), key);
    assert.equal(reads, 0);
    assert.equal(s.getItem('ec_kma_api_key'), 'LEGACY');
  }
});
test('JSON is only consulted for absent DB and supports empty as well as populated keys', async () => {
  for (const key of ['', ENCODED]) {
    const s = storage({ [LS]: 'STALE' });
    const restored = [];
    const result = await load({ storage: s, api: api({ jsonLoadCommon: async () => ({ exists: true, data: key }),
      dbSet: async (...args) => { restored.push(args); return { success: true }; } }) });
    assert.equal(result.success, true);
    assert.equal(result.source, 'json');
    assert.equal(s.getItem(LS), key);
    assert.deepEqual(restored, [['common', DB, key]], 'backend DB must agree with renderer, including tombstones');
  }
});
test('JSON canonical recovery requires confirmed DB persistence before updating cache', async () => {
  for (const set of [undefined, async () => ({ success: false, error: 'SECRET' }), async () => { throw Error('SECRET'); }]) {
    const s = storage({ [LS]: 'UNCHANGED' });
    const result = await load({ storage: s, api: api({ dbSet: set,
      jsonLoadCommon: async () => ({ exists: true, data: '' }) }) });
    assert.equal(result.success, false);
    assert.equal(s.getItem(LS), 'UNCHANGED');
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
test('explicit save waits for in-flight JSON-to-DB restore and wins without stale overwrite', async () => {
  const gate = deferred();
  const restoreStarted = deferred();
  const s = storage();
  const calls = [];
  let db = null;
  const backend = api({ jsonLoadCommon: async () => ({ exists: true, data: 'OLD_BACKUP' }),
    dbSet: async (_scope, _key, value) => {
      calls.push(value);
      if (value === 'OLD_BACKUP') { restoreStarted.resolve(); await gate.promise; }
      db = value;
      return { success: true };
    } });
  const loading = load({ storage: s, api: backend });
  await restoreStarted.promise;
  const saving = save('NEW', { storage: s, api: backend });
  gate.resolve();
  assert.equal((await loading).stale, true);
  assert.equal((await saving).success, true);
  assert.deepEqual(calls, ['OLD_BACKUP', 'NEW']);
  assert.equal(db, 'NEW');
  assert.equal(s.getItem(LS), 'NEW');
});
test('fresh host with neither DB nor JSON clears stale canonical without destroying legacy', async () => {
  const s = storage({ [LS]: 'OTHER_HOST', ec_drug_api_key: 'LEGACY' });
  const result = await load({ storage: s, api: api({ jsonLoadCommon: async () => ({ exists: false, data: null }) }) });
  assert.equal(result.success, true);
  assert.equal(result.exists, false);
  assert.equal(result.source, 'absent');
  assert.equal(s.getItem(LS), null);
  assert.equal(s.getItem('ec_drug_api_key'), 'LEGACY');
});
test('absent DB without JSON support also clears stale cache', async () => {
  const s = storage({ [LS]: 'STALE' });
  assert.equal((await load({ storage: s, api: api() })).success, true);
  assert.equal(s.getItem(LS), null);
});
test('DB errors never reactivate JSON credentials and sanitize backend errors', async () => {
  for (const get of [async () => { throw Error('SECRET'); }, async () => ({ success: false, error: 'SECRET', exists: false }),
    async () => ({ success: true }), async () => null]) {
    const s = storage({ [LS]: '' });
    let jsonReads = 0;
    const result = await load({ storage: s, api: api({ dbGet: get,
      jsonLoadCommon: async () => { jsonReads++; return { exists: true, data: RAW }; } }) });
    assert.equal(result.success, false);
    assert.equal(s.getItem(LS), '');
    assert.equal(jsonReads, 0);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
test('invalid existing DB values and failed JSON fallback leave cache intact', async () => {
  for (const backend of [api({ dbGet: async () => ({ success: true, exists: true, data: {} }) }),
    api({ jsonLoadCommon: async () => ({ success: false, exists: false, error: 'SECRET' }) }),
    api({ jsonLoadCommon: async () => { throw Error('SECRET'); } }),
    api({ jsonLoadCommon: async () => ({ data: null }) })]) {
    const s = storage({ [LS]: '' });
    const result = await load({ storage: s, api: backend });
    assert.equal(result.success, false);
    assert.equal(s.getItem(LS), '');
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
test('late boot load cannot replace an explicit save', async () => {
  const gate = deferred();
  const s = storage();
  const backend = api({ dbGet: () => gate.promise });
  const pending = load({ storage: s, api: backend });
  assert.equal((await save('NEW', { storage: s, api: backend })).success, true);
  gate.resolve({ success: true, exists: true, data: 'OLD' });
  assert.equal((await pending).stale, true);
  assert.equal(s.getItem(LS), 'NEW');
});
test('newer load supersedes older connection response', async () => {
  const gate = deferred();
  const s = storage();
  const first = load({ storage: s, api: api({ dbGet: () => gate.promise }) });
  await load({ storage: s, api: api({ dbGet: async () => ({ success: true, exists: true, data: '' }) }) });
  gate.resolve({ success: true, exists: true, data: 'OLD_HOST' });
  assert.equal((await first).stale, true);
  assert.equal(s.getItem(LS), '');
});
test('overlapping saves serialize primary and backup writes; latest value wins', async () => {
  const gate = deferred();
  const s = storage();
  const calls = [];
  const backend = api({ dbSet: async (_scope, _key, value) => {
    calls.push('db:' + value); if (value === 'FIRST') await gate.promise; return { success: true };
  }, jsonSaveCommon: async (_key, value) => { calls.push('json:' + value); return { success: true }; } });
  const first = save('FIRST', { storage: s, api: backend });
  const second = save('SECOND', { storage: s, api: backend });
  assert.deepEqual(calls, ['db:FIRST']);
  gate.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].stale, true);
  assert.equal(results[1].success, true);
  assert.deepEqual(calls, ['db:FIRST', 'json:FIRST', 'db:SECOND', 'json:SECOND']);
  assert.equal(s.getItem(LS), 'SECOND');
});
test('load begun during a save waits for saved DB value', async () => {
  const gate = deferred();
  const s = storage();
  let db = 'OLD';
  const backend = api({ dbSet: async (_scope, _key, value) => { await gate.promise; db = value; return { success: true }; },
    dbGet: async () => ({ success: true, exists: true, data: db }) });
  const saving = save('NEW', { storage: s, api: backend });
  const loading = load({ storage: s, api: backend });
  gate.resolve();
  const saved = await saving;
  assert.equal(saved.success, true);
  assert.equal(saved.stale, undefined, 'a read/SSE echo must not invalidate the save');
  assert.equal(saved.warning, undefined);
  const loaded = await loading;
  assert.equal(loaded.success, true);
  assert.equal(loaded.key, 'NEW');
  assert.equal(s.getItem(LS), 'NEW');
});
test('load waits for the latest queued save as well as the initial save', async () => {
  const firstGate = deferred(), secondGate = deferred(), secondStarted = deferred();
  const s = storage();
  let db = 'OLD', reads = 0;
  const backend = api({ dbSet: async (_scope, _key, value) => {
    if (value === 'FIRST') await firstGate.promise;
    else { secondStarted.resolve(); await secondGate.promise; }
    db = value; return { success: true };
  }, dbGet: async () => { reads++; return { success: true, exists: true, data: db }; } });
  const first = save('FIRST', { storage: s, api: backend });
  const loading = load({ storage: s, api: backend });
  const second = save('SECOND', { storage: s, api: backend });
  firstGate.resolve();
  await secondStarted.promise;
  assert.equal(reads, 0);
  secondGate.resolve();
  await first;
  const saved = await second;
  assert.equal(saved.success, true);
  assert.equal(saved.warning, undefined);
  assert.equal((await loading).key, 'SECOND');
  assert.equal(s.getItem(LS), 'SECOND');
});
test('same-connection concurrent loads share one request without false stale results', async () => {
  const gate = deferred();
  const s = storage();
  let reads = 0;
  const backend = api({ dbGet: () => { reads++; return gate.promise; } });
  const first = load({ storage: s, api: backend });
  const second = load({ storage: s, api: backend });
  assert.equal(reads, 1);
  gate.resolve({ success: true, exists: true, data: RAW });
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.success, true);
    assert.equal(result.stale, undefined);
    assert.equal(result.key, RAW);
  }
});
test('a load after an explicit save does not coalesce with a superseded earlier read', async () => {
  const gate = deferred();
  const s = storage();
  let reads = 0;
  const backend = api({ dbGet: () => ++reads === 1 ? gate.promise : Promise.resolve({ success: true, exists: true, data: 'NEW' }) });
  const old = load({ storage: s, api: backend });
  await save('NEW', { storage: s, api: backend });
  const current = await load({ storage: s, api: backend });
  assert.equal(current.success, true);
  assert.equal(reads, 2);
  gate.resolve({ success: true, exists: true, data: 'OLD' });
  assert.equal((await old).stale, true);
  assert.equal(s.getItem(LS), 'NEW');
});
