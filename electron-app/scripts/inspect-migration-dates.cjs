'use strict';

// Read-only diagnosis using the same SheetJS and date parsers as the application.
// Usage: node scripts/inspect-migration-dates.cjs source.xlsx [converted.xlsx]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx');
const { PastHistoryService } = require('../src/main/services/import-service');

const helperHtml = fs.readFileSync(path.join(__dirname, '../templates/forms/migration-helper.html'), 'utf8');
const element = { addEventListener() {} };
const helper = vm.createContext({ Date, document: { getElementById: () => element, addEventListener() {} } });
vm.runInContext(helperHtml.match(/<script>([\s\S]*?)<\/script>/)[1], helper);

function dateCounts(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value || '(empty)');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function inspect(filePath) {
  const rawBook = XLSX.readFile(filePath, { cellNF: true });
  const dateBook = XLSX.readFile(filePath, { cellDates: true });
  const report = { file: path.resolve(filePath), date1904: rawBook.Workbook?.WBProps?.date1904 || false, sheets: [] };
  for (const sheetName of rawBook.SheetNames) {
    const rawSheet = rawBook.Sheets[sheetName];
    const dateSheet = dateBook.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json(dateSheet, { header: 1, defval: '', blankrows: false });
    const nurseHeader = helper.detectNurseHeader(grid);
    const headers = helper.findAllHeaderRows(grid);
    const twoBlock = headers.some(header => Array.isArray(header.cols.name));
    const extracted = nurseHeader ? helper.extractNurseSheet(grid, nurseHeader) : helper.extractSheet(grid, twoBlock);
    const samples = [];
    let dateCellCount = 0;
    for (const [address, cell] of Object.entries(rawSheet)) {
      if (address.startsWith('!')) continue;
      const isDate = cell.z && XLSX.SSF.is_date(cell.z);
      const isDateText = typeof cell.v === 'string' && /^\s*(?:\d{2,4}[.\-/년]\s*\d{1,2}|\d{8}\s*$)/.test(cell.v);
      if (!isDate && !isDateText) continue;
      dateCellCount++;
      if (samples.length < 12) {
        const readValue = dateSheet[address]?.v;
        samples.push({ address, type: cell.t, raw: cell.v, displayed: cell.w, format: cell.z, formula: cell.f,
          readAsDate: readValue instanceof Date ? readValue.toISOString() : readValue,
          helperDate: helper.normDate(readValue) });
      }
    }
    report.sheets.push({ sheet: sheetName, range: rawSheet['!ref'], dateCellCount, samples,
      helperRecordCount: extracted.rows.length, helperDates: dateCounts(extracted.rows.map(row => row.visit_date)) });
  }
  // Capture the import service's writes in memory, without opening any user database.
  const staged = [];
  const db = {
    prepare(sql) { return { run(row) { if (sql.includes('INSERT INTO import_staging')) staged.push(row); } }; },
    transaction(fn) { return fn; },
  };
  try {
    const result = new PastHistoryService({ db }).importFromXlsx(filePath);
    report.directImport = { recordCount: result.recordCount, excludedRows: result.invalidRows.length,
      dates: dateCounts(staged.map(row => row.visit_date)) };
  } catch (error) {
    report.directImport = { error: error.message };
  }
  return report;
}

if (process.argv.length < 3) {
  console.error('Usage: node scripts/inspect-migration-dates.cjs source.xlsx [converted.xlsx]');
  process.exitCode = 1;
} else {
  for (const filename of process.argv.slice(2)) {
    try { console.log(JSON.stringify(inspect(filename), null, 2)); }
    catch (error) { console.error(`${filename}: ${error.message}`); process.exitCode = 1; }
  }
}
