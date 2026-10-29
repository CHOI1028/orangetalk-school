'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise only export functions with invented records and in-memory IPC mocks.
// Do not load Electron, start the product, open a database, or access the network.
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/features/daily/diary-print-view.js'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = source.indexOf('async function ' + name + '(');
  assert(start >= 0, 'Missing function ' + name);
  const end = source.indexOf('\n}\n', start);
  assert(end > start, 'Missing function boundary ' + name);
  return source.slice(start, end + 2);
}
const code = ['_buildDailyContinuousData', '_exportDailyExcel', '_exportDailySheets'].map(extract).join('\n');
const inventedRecord = (id, date) => ({id, date, timeIn: '09:00', treatment: 'FAKE-MED 0.5 tablet / V/S 37.4 110/70'});
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function harness(query) {
  const events = {queries: [], builds: [], delivered: [], sheets: [], shown: 0, hidden: 0, errors: [], toasts: [], reconciled: 0};
  const records = [inventedRecord('CACHE-ONLY', '2026-10-23')];
  const controls = {dpFrom: {value: '2026-09-01'}, dpTo: {value: '2027-02-28'}, dpOptCover: {checked: false}, dpOptTodayMemo: {checked: false}};
  const context = {
    Date, Promise, console,
    S: {settings: {schoolName: 'SYNTHETIC SCHOOL'}, records},
    document: {getElementById: id => controls[id] || null},
    window: {electronAPI: {
      recordsDailyByDateRange: async (from, to) => { events.queries.push([from, to]); return query(); },
      xlsxBuildDiary: async payload => { events.builds.push(payload); return {success: true, bytes: []}; }
    }, sheetsExportWithConsent: async payload => { events.sheets.push(payload); return {success: true}; }},
    bus: {emit: (name, payload) => events.toasts.push(payload.text)},
    alert: text => events.errors.push(String(text)),
    _dpReconcileWithMemory: rows => { events.reconciled++; return rows.slice(); },
    buildDeptStatsSections: async () => null,
    tmEnsureLoaded: async () => {}, tmGetMemoForExport: () => null, _dpOmitEmptyMemo: () => true,
    _dpBuildDailyDayPayload: (date, rows) => ({colCount: 3, colWidths: [80, 100, 250], headerLabels: ['ID', 'Date', 'Treatment'], dataRows: rows.map(r => [r.id, r.date, r.treatment]), top1: 2, bot1: 1}),
    _dpShowExportProgress: () => { events.shown++; },
    _dpHideExportProgress: () => { events.hidden++; },
    _dpExportFailModal: (title, message) => events.errors.push({title, message}),
    _dpExportRecCount: () => 1, _dpSaveBaseName: () => 'SYNTHETIC',
    _dpDeliverXlsx: (result, name) => events.delivered.push({result, name})
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return {context, controls, events, records};
}
const failures = [
  ['rejected IPC', async () => { throw Error('SYNTHETIC QUERY FAILURE'); }],
  ['explicit failure even with cached response data', async () => ({success: false, data: [inventedRecord('PARTIAL', '2026-10-23')]})],
  ['null response', async () => null],
  ['undefined response', async () => undefined],
  ['missing response data', async () => ({success: true})],
  ['null response data', async () => ({success: true, data: null})],
  ['object instead of records', async () => ({success: true, data: {date: '2026-10-23'}})],
  ['string instead of records', async () => ({success: true, data: 'partial'})]
];

for (const template of ['legacy', 'official', 'approval']) {
  for (const [name, query] of failures) test(template + ': abort export on ' + name, async () => {
    const {context, events, records} = harness(query), original = JSON.stringify(records);
    await context._exportDailyExcel({template}); await flush();
    assert.equal(events.builds.length, 0, 'Never create a partial workbook');
    assert.equal(events.delivered.length, 0, 'Never open the save dialog');
    assert.equal(events.reconciled, 0, 'Never reconcile an unsuccessful period result');
    assert.equal(events.shown, 1); assert.equal(events.hidden, 1, 'Clear the progress overlay');
    assert.equal(events.errors.length, 1); assert.match(events.errors[0].message, /기록.*중단.*다시 시도/);
    assert.equal(events.toasts.length, 0, 'No success or empty-period message on failure');
    assert.equal(JSON.stringify(records), original, 'Do not mutate memory records');
  });
  test(template + ': retry after failure exports all returned dates, without stale cache', async () => {
    let fail = true;
    const input = [inventedRecord('LAST', '2027-02-28'), inventedRecord('FIRST', '2026-09-01')];
    const original = JSON.stringify(input);
    const {context, events} = harness(async () => { if (fail) throw Error('SYNTHETIC FAILURE'); return {success: true, data: input}; });
    await context._exportDailyExcel({template}); await flush(); fail = false;
    await context._exportDailyExcel({template}); await flush();
    assert.equal(events.errors.length, 1); assert.equal(events.builds.length, 1); assert.equal(events.delivered.length, 1);
    const payload = events.builds[0];
    // Optional templates were removed in 1.1.16; stale choices use legacy too.
    assert.equal(payload.diaryExcelOptions, undefined);
    assert.deepEqual(Array.from(payload.continuousDays, d => d.date), ['2026-09-01', '2027-02-28']);
    assert(!JSON.stringify(payload).includes('CACHE-ONLY'));
    assert(JSON.stringify(payload).includes('0.5 tablet')); assert(JSON.stringify(payload).includes('110/70'));
    assert.equal(JSON.stringify(input), original);
    assert.deepEqual(events.queries, [['2026-09-01', '2027-02-28'], ['2026-09-01', '2027-02-28']]);
  });
  test(template + ': successful empty period remains empty instead of falling back', async () => {
    const {context, events} = harness(async () => ({success: true, data: []}));
    await context._exportDailyExcel({template}); await flush();
    assert.equal(events.builds.length, 0); assert.equal(events.delivered.length, 0); assert.equal(events.errors.length, 0);
    assert.equal(events.hidden, 1); assert.equal(events.toasts.length, 1); assert.match(events.toasts[0], /기록이 없습니다/);
  });
  test(template + ': invalid date selection does not start lookup or progress', async () => {
    const {context, events, controls} = harness(async () => { throw Error('Should not query'); }); controls.dpFrom.value = '';
    await context._exportDailyExcel({template}); await flush();
    assert.equal(events.queries.length, 0); assert.equal(events.shown, 0); assert.equal(events.builds.length, 0); assert.equal(events.errors.length, 1);
  });
  test(template + ': reconciliation exception also stops export and clears progress', async () => {
    const {context, events} = harness(async () => ({success: true, data: [inventedRecord('FIRST', '2026-09-01')]}));
    context._dpReconcileWithMemory = () => { throw Error('SYNTHETIC RECONCILE FAILURE'); };
    await context._exportDailyExcel({template}); await flush();
    assert.equal(events.builds.length, 0); assert.equal(events.delivered.length, 0); assert.equal(events.errors.length, 1); assert.equal(events.hidden, 1);
  });
}
for (const [name, query] of failures) test('shared Sheets path: no transmission on ' + name, async () => {
  const {context, events} = harness(query); await context._exportDailySheets(); await flush();
  assert.equal(events.sheets.length, 0); assert.equal(events.builds.length, 0);
  assert(events.toasts.some(message => /Sheets 내보내기 실패.*중단/.test(message)));
  assert(!events.toasts.some(message => /생성 완료/.test(message)));
});
