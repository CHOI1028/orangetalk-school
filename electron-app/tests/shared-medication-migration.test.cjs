'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sharedSettingsRequest } = require('../src/main/services/shared-settings-service');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const examples = {
  user_med_syms: { MED_A: ['SYM_A'], MED_B: ['SYM_B'] },
  user_added_meds: { MED_A: true },
  user_med_syms_prefilled: { MED_A: true },
  med_hidden: { MED_A: true },
  med_renames: { MED_A: 'ALIAS_A' },
  meddb_user: { CATEGORY_A: ['MED_A'] }
};
function setup(t, options = {}) {
  const key = options.key || 'user_med_syms';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-med-migration-test-'));
  const file = path.join(dir, key + '.json');
  const entries = new Map();
  const files = new Set();
  let jsonExists = options.jsonExists !== false;
  let jsonValue = Object.hasOwn(options, 'json') ? copy(options.json) : {};
  const put = (name, value, updatedAt = '2025-01-01T00:00:00.000Z') => entries.set(name, { data: copy(value), updatedAt });
  if (options.dbExists !== false) put(key, Object.hasOwn(options, 'db') ? options.db : examples[key]);
  if (options.marked) put('__shared_settings_v1.' + key, true);
  if (Object.hasOwn(options, 'backup')) put('__shared_settings_backup.' + key, options.backup);
  if (jsonExists) {
    fs.writeFileSync(file, JSON.stringify(jsonValue)); files.add(file);
    const date = new Date(options.jsonOlder ? '2020-01-01T00:00:00.000Z' : '2030-01-01T00:00:00.000Z');
    fs.utimesSync(file, date, date);
  }
  const store = {
    get(scope, name) { const entry = entries.get(name); return entry ? { exists: true, ...copy(entry) } : { exists: false, data: null }; },
    set(scope, name, value) { put(name, value, new Date().toISOString()); return { success: true }; },
    batchSet(items) { for (const item of items) this.set(item.scope, item.key, item.value); },
    db: { transaction(work) { return { immediate() {
      const before = copy([...entries]);
      try { return work(); }
      catch (error) { entries.clear(); for (const [name, entry] of before) entries.set(name, entry); throw error; }
    } }; } }
  };
  const json = {
    loadCommon() { return { exists: jsonExists, data: copy(jsonValue), path: file }; },
    commonPath() { return file; },
    saveCommon(name, value) { jsonExists = true; jsonValue = copy(value); fs.writeFileSync(file, JSON.stringify(value)); files.add(file); return file; }
  };
  t.after(() => { for (const name of files) fs.unlinkSync(name); fs.rmdirSync(dir); });
  const services = { store: () => store, jsonFile: () => json };
  return { key, store, entries, read: () => sharedSettingsRequest(services, { action: 'read', key }), request: value => sharedSettingsRequest(services, value) };
}
for (const [key, value] of Object.entries(examples)) {
  test('first migration preserves ' + key + ' against newer empty JSON', t => {
    const h = setup(t, { key });
    assert.deepEqual(h.read().data, value);
    assert.deepEqual(h.store.get('common', key).data, value);
    assert.equal(h.store.get('common', '__shared_settings_v1.' + key).data, true);
    const backup = h.store.get('common', '__shared_settings_backup.' + key).data;
    assert.deepEqual(backup.database.data, value); assert.deepEqual(backup.json.data, {});
  });
}
for (const invalid of [null, [], 'invalid', { MED_A: null }, { MED_A: 'not-an-array' }, { MED_A: [1] }]) {
  test('invalid newer medication JSON cannot replace a valid database: ' + JSON.stringify(invalid), t => {
    const h = setup(t, { json: invalid });
    assert.equal(h.read().success, true);
    assert.deepEqual(h.store.get('common', h.key).data, examples.user_med_syms);
  });
}
test('valid nonempty newer JSON retains the existing first-migration policy', t => {
  const next = { MED_A: ['UPDATED'] }, h = setup(t, { json: next });
  assert.deepEqual(h.read().data, next);
  assert.deepEqual(h.store.get('common', '__shared_settings_backup.' + h.key).data.database.data, examples.user_med_syms);
});
test('older nonempty JSON does not resurrect an empty database', t => {
  const h = setup(t, { db: {}, json: examples.user_med_syms, jsonOlder: true });
  assert.deepEqual(h.read().data, {});
});
test('existing migration backup is never replaced for medication settings', t => {
  const first = { database: { exists: true, data: { EARLIER: ['SYM'] } }, migratedAt: 'EARLIER' };
  const h = setup(t, { backup: first });
  assert.deepEqual(h.read().data, examples.user_med_syms);
  assert.deepEqual(h.store.get('common', '__shared_settings_backup.' + h.key).data, first);
});
test('already-migrated empty medicines are not automatically restored from JSON or backup', t => {
  const first = { database: { exists: true, data: examples.user_med_syms } };
  const h = setup(t, { db: {}, json: examples.user_med_syms, backup: first, marked: true });
  assert.deepEqual(h.read().data, {});
  assert.deepEqual(h.store.get('common', '__shared_settings_backup.' + h.key).data, first);
});
test('explicit deletion remains empty after the next read and keeps recovery evidence', t => {
  const h = setup(t); const loaded = h.read();
  const backup = h.store.get('common', '__shared_settings_backup.' + h.key).data;
  const deleted = h.request({ action: 'write', key: h.key, baseExists: true, base: loaded.data, value: {} });
  assert.equal(deleted.success, true); assert.deepEqual(deleted.data, {}); assert.deepEqual(h.read().data, {});
  assert.deepEqual(h.store.get('common', '__shared_settings_backup.' + h.key).data, backup);
});
test('valid legacy JSON imports when the database has no entry', t => {
  const h = setup(t, { dbExists: false, json: examples.user_med_syms });
  assert.deepEqual(h.read().data, examples.user_med_syms);
});
test('valid database survives when the JSON file does not exist', t => {
  const h = setup(t, { jsonExists: false });
  assert.deepEqual(h.read().data, examples.user_med_syms);
});
test('invalid database can use valid legacy JSON while retaining the invalid original', t => {
  const h = setup(t, { db: [], json: examples.user_med_syms });
  assert.deepEqual(h.read().data, examples.user_med_syms);
  assert.deepEqual(h.store.get('common', '__shared_settings_backup.' + h.key).data.database.data, []);
});
test('two invalid sources fail without marking migration complete or overwriting originals', t => {
  const h = setup(t, { db: [], json: null });
  assert.equal(h.read().success, false); assert.deepEqual(h.store.get('common', h.key).data, []);
  assert.equal(h.store.get('common', '__shared_settings_v1.' + h.key).exists, false);
  assert.equal(h.store.get('common', '__shared_settings_backup.' + h.key).exists, false);
});
test('unrelated shared settings keep their existing empty-JSON migration behavior', t => {
  const h = setup(t, { key: 'user_symptoms', db: { CATEGORY: ['SYM'] }, json: {} });
  assert.deepEqual(h.read().data, {});
});
