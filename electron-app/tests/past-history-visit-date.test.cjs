'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { PastHistoryService } = require('../src/main/services/import-service');

const helperHtml = fs.readFileSync(path.join(__dirname, '../templates/forms/migration-helper.html'), 'utf8');
const element = { addEventListener() {} };
const helper = vm.createContext({ Date, document: { getElementById: () => element, addEventListener() {} } });
vm.runInContext(helperHtml.match(/<script>([\s\S]*?)<\/script>/)[1], helper);

test('Excel migration uses the actual visit date when a scheduled visit column is also present', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-import-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const filename = path.join(temp, 'diary.xlsx');
  const actualVisit = ['방문일 (필수)', 46087]; // 2026-03-06
  const scheduledVisit = ['다음 방문 예정일', 49740]; // 2036-03-06
  const otherColumns = [['학년', 1], ['반', 1], ['이름', '가상학생'], ['증상', '두통'], ['처치', '안정']];
  const dateColumns = [
    [actualVisit, scheduledVisit],
    [scheduledVisit, actualVisit],
    [scheduledVisit, ['진료일자', 46087]],
    [['보건실 내원 기록일', 46087]],
  ];

  for (const dates of dateColumns) {
    const columns = [...dates, ...otherColumns];
    const sheet = XLSX.utils.aoa_to_sheet([columns.map(([header]) => header), columns.map(([, value]) => value)]);
    dates.forEach((_, column) => { sheet[XLSX.utils.encode_cell({ r: 1, c: column })].z = 'yyyy.mm.dd'; });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '보건일지');
    XLSX.writeFile(workbook, filename);

    const importRows = [];
    const db = {
      prepare(sql) { return { run(row) { if (sql.includes('INSERT INTO import_staging')) importRows.push(row); } }; },
      transaction(fn) { return fn; },
    };
    const result = new PastHistoryService({ db }).importFromXlsx(filename);
    assert.equal(result.recordCount, 1);
    assert.equal(importRows[0].visit_date, '2026-03-06');

    const helperBook = XLSX.readFile(filename, { cellDates: true });
    const helperGrid = XLSX.utils.sheet_to_json(helperBook.Sheets['보건일지'], { header: 1, defval: '', blankrows: false });
    assert.equal(helper.extractSheet(helperGrid, false).rows[0].visit_date, '2026.03.06.');
  }
});

test('Excel migration finds an 일시 data sheet after an instruction sheet', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-import-sheet-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const filename = path.join(temp, 'diary.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['안내']]), '설명');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['일시 (필수)', '학년', '반', '이름', '증상', '처치'],
    ['2026-03-06 11:05', 1, 1, '가상학생', '두통', '안정'],
  ]), '원본입력');
  XLSX.writeFile(workbook, filename);

  const imported = [];
  const db = {
    prepare(sql) { return { run(row) { if (sql.includes('INSERT INTO import_staging')) imported.push(row); } }; },
    transaction(fn) { return fn; },
  };
  const result = new PastHistoryService({ db }).importFromXlsx(filename);
  assert.equal(result.recordCount, 1);
  assert.equal(imported[0].visit_date, '2026-03-06');
  assert.equal(imported[0].time_in, '11:05');
});

test('2026 dates survive XLSX/XLS reading, helper export and app import', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-date-roundtrip-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  let exportedBlob;
  const browserElement = { addEventListener() {}, click() {} };
  const browser = vm.createContext({
    Date, Uint8Array, atob, JSZip,
    navigator: { userAgent: 'Windows' },
    URL: { createObjectURL(blob) { exportedBlob = blob; return 'test:download'; }, revokeObjectURL() {} },
    document: { getElementById: () => browserElement, createElement: () => browserElement, addEventListener() {} },
  });
  vm.runInContext(helperHtml.match(/<script>([\s\S]*?)<\/script>/)[1], browser);
  const headers = ['방문일', '학년', '반', '이름', '증상', '처치'];
  for (const bookType of ['xlsx', 'biff8']) {
    for (const date1904 of [false, true]) {
      const rows = [headers];
      const expected = [];
      const numericRows = [];
      for (let day = 0; day < 365; day++) {
        const date = new Date(Date.UTC(2026, 0, day + 1));
        const iso = date.toISOString().slice(0, 10);
        const month = date.getUTCMonth() + 1;
        const dayOfMonth = date.getUTCDate();
        const serial = date.getTime() / 86400000 + 25569 - (date1904 ? 1462 : 0);
        const values = [iso, `${2026}.${month}.${dayOfMonth}.`, iso.replace(/-/g, ''),
          `${2026}년 ${month}월 ${dayOfMonth}일`, iso.slice(2), serial, serial + 0.5];
        for (const value of values) {
          if (typeof value === 'number') numericRows.push(rows.length);
          rows.push([value, 1, 1, '가상학생', '두통', '안정']);
          expected.push(iso);
        }
      }
      const source = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      for (const r of numericRows) sheet[XLSX.utils.encode_cell({ r, c: 0 })].z = 'yyyy-mm-dd hh:mm';
      XLSX.utils.book_append_sheet(source, sheet, '보건일지');
      source.Workbook = { WBProps: { date1904 } };
      const bytes = XLSX.write(source, { type: 'buffer', bookType });
      const loaded = XLSX.read(bytes, { type: 'buffer', cellDates: true });
      const grid = XLSX.utils.sheet_to_json(loaded.Sheets['보건일지'], { header: 1, defval: '', blankrows: false });
      const records = browser.extractSheet(grid, false).rows;
      assert.equal(records.length, expected.length);
      assert.deepEqual(Array.from(records, r => r.visit_date.replace(/\.$/, '').replace(/\./g, '-')), expected,
        `${bookType} date1904=${date1904} helper parsing`);
      browser.PREVIEW = records;
      await browser.exportPastHealthRecords();
      const filename = path.join(temp, 'converted.xlsx');
      fs.writeFileSync(filename, Buffer.from(await exportedBlob.arrayBuffer()));
      const imported = [];
      const db = {
        prepare(sql) { return { run(row) { if (sql.includes('INSERT INTO import_staging')) imported.push(row); } }; },
        transaction(fn) { return fn; },
      };
      new PastHistoryService({ db }).importFromXlsx(filename);
      assert.equal(imported.length, expected.length, `${bookType} date1904=${date1904} exported row count`);
      assert.deepEqual(imported.map(r => r.visit_date), expected, `${bookType} date1904=${date1904} app import`);
    }
  }
});
