'use strict';

// Print preparation for the existing Excel forms only. No database, settings,
// filesystem or Electron access. Text fragments retain every original character.
const MAX_ROW_HEIGHT = 396; // Below Excel's 409pt limit, including rounding room.
const CELL_CHARACTER_LIMIT = 32000;
const clone = value => value == null ? value : structuredClone(value);
const graphemes = new Intl.Segmenter('ko', { granularity: 'grapheme' });

function columnPixels(width) {
  const w = Number.isFinite(width) ? width : 8.43;
  return w < 1 ? Math.floor(w * 12 + 0.5) : Math.floor((256 * w + Math.floor(128 / 7)) / 256 * 7);
}

function glyphWidth(glyph, size) {
  if (/^[\r\n]+$/.test(glyph)) return 0;
  if (glyph === '\t') return size * 2.8;
  if (/^\s+$/.test(glyph)) return size * 0.4;
  if (/^[MW@%&#]$/.test(glyph)) return size;
  if (/^[\x20-\x7e]$/.test(glyph)) return size * 0.68;
  if (/\p{Extended_Pictographic}/u.test(glyph)) return size * 2;
  return size * 1.08;
}

// Soft boundaries are indices into the original string, NOT replacement text.
// This also keeps CRLF, tabs, spaces, surrogate pairs and combining marks intact.
function wrapSegments(text, widthPt, fontSize) {
  if (!text) return [];
  const units = Array.from(graphemes.segment(text), s => ({ text: s.segment, start: s.index, end: s.index + s.segment.length }));
  const lines = [];
  let start = 0;
  while (start < units.length) {
    let end = start, width = 0, lastSpace = -1;
    while (end < units.length) {
      const unit = units[end];
      if (/[\r\n]/.test(unit.text)) { end++; break; }
      const next = glyphWidth(unit.text, fontSize);
      if (next > widthPt + 0.01) throw Error('엑셀 열 너비가 글자 한 칸보다 좁습니다. 표시 항목의 너비를 늘려 주세요.');
      if (width + next > widthPt && end > start) {
        if (lastSpace > start) end = lastSpace;
        break;
      }
      width += next;
      end++;
      if (/^\s+$/.test(unit.text)) lastSpace = end;
    }
    lines.push(text.slice(units[start].start, units[end - 1].end));
    start = end;
  }
  if (/[\r\n]$/.test(text)) lines.push('');
  return lines;
}

function createLegacyPrintLayout() {
  const sheets = new Map();
  function config(ws) {
    if (!sheets.has(ws)) sheets.set(ws, { rows: new Map(), coverEnd: 0 });
    return sheets.get(ws);
  }
  function mark(ws, row, flags) {
    const number = typeof row === 'number' ? row : row.number;
    const c = config(ws);
    c.rows.set(number, { ...c.rows.get(number), ...flags });
  }
  function table(ws, { start, headerEnd, end, context = [], sequenceColumn = 0 }) {
    const header = Array.from({ length: headerEnd - start + 1 }, (_, i) => start + i);
    const repeat = [...new Set([...context, ...header])];
    for (let n = start; n <= end; n++) mark(ws, n, {
      repeat, keepNext: n < headerEnd || (n === headerEnd && n < end),
      sequenceColumn: n > headerEnd ? sequenceColumn : 0
    });
  }
  return {
    mark, table, writeBuffer: writeWorkbook,
    cover(ws, end) { config(ws).coverEnd = end; },
    finish(workbook) {
      return workbook.worksheets.map(ws => paginateWorksheet(ws, config(ws)));
    }
  };
}

async function writeWorkbook(workbook) {
  const bytes = await workbook.xlsx.writeBuffer();
  // ExcelJS 4.4 emits a separate same-name definedName for each && range.
  // OOXML needs ONE local Print_Area name with a comma-separated union instead.
  // Use ExcelJS's already bundled ZIP dependency; no additional installation.
  const { createRequire } = require('node:module');
  const JSZip = createRequire(require.resolve('exceljs'))('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const part = zip.file('xl/workbook.xml');
  if (!part) throw Error('엑셀 인쇄 범위를 확인할 수 없어 저장을 중단했습니다.');
  let xml = await part.async('string');
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const names = workbook.worksheets.map((ws, index) => {
    const areas = String(ws.pageSetup.printArea || '').split('&&');
    const ranges = areas.map(area => {
      const m = /^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/.exec(area);
      if (!m) throw Error('엑셀 인쇄 범위가 올바르지 않아 저장을 중단했습니다.');
      return "'" + ws.name.replace(/'/g, "''") + "'!$" + m[1] + '$' + m[2] + ':$' + m[3] + '$' + m[4];
    });
    return '<definedName name="_xlnm.Print_Area" localSheetId="' + index + '">' + escape(ranges.join(',')) + '</definedName>';
  }).join('');
  xml = xml.replace(/<definedName\b(?=[^>]*\bname="_xlnm\.Print_Area")[^>]*>[\s\S]*?<\/definedName>/g, '');
  if (!xml.includes('</definedNames>')) throw Error('엑셀 인쇄 범위 저장 검사에 실패했습니다.');
  xml = xml.replace('</definedNames>', names + '</definedNames>');
  if ((xml.match(/name="_xlnm\.Print_Area"/g) || []).length !== workbook.worksheets.length)
    throw Error('엑셀 인쇄 범위가 중복되어 저장을 중단했습니다.');
  zip.file('xl/workbook.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function paginateWorksheet(ws, configuration = { rows: new Map(), coverEnd: 0 }) {
  const flags = configuration.rows || new Map();
  const merges = ws.model.merges.map(address => {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address);
    const col = letters => Array.from(letters).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (!m || m[2] !== m[4]) throw Error('엑셀 출력에 지원하지 않는 세로 병합이 있습니다. 파일 저장을 중단했습니다.');
    return { address, row: Number(m[2]), left: col(m[1]), right: col(m[3]) };
  });
  const byRow = new Map();
  for (const merge of merges) { if (!byRow.has(merge.row)) byRow.set(merge.row, []); byRow.get(merge.row).push(merge); }
  const colCount = Math.max(ws.columnCount, ...merges.map(m => m.right), 1);
  const widths = Array.from({ length: colCount }, (_, i) => ws.getColumn(i + 1).hidden ? 0 : columnPixels(ws.getColumn(i + 1).width) * 0.75);
  const margins = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, ...ws.pageSetup.margins };
  const landscape = ws.pageSetup.orientation === 'landscape';
  const printableWidth = (landscape ? 841.89 : 595.28) - (margins.left + margins.right) * 72;
  const printableHeight = (landscape ? 595.28 : 841.89) - (margins.top + margins.bottom) * 72;
  // Estimate vertical capacity only. Excel itself fits the width at print time;
  // a computed percentage differs across font/rendering engines (notably Web).
  const scale = Math.min(100, Math.floor((printableWidth - 6) / widths.reduce((a, b) => a + b, 0) * 100));
  if (scale < 10 || printableHeight <= 0) throw Error('엑셀 인쇄 영역이 너무 넓습니다. 표시 항목과 너비를 확인해 주세요.');
  const pageHeight = (printableHeight - 14) / (scale / 100);
  const source = [];
  for (let n = 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n), rowMerges = byRow.get(n) || [], cells = [];
    row.eachCell(cell => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const merge = rowMerges.find(m => m.left === cell.col);
      const width = widths.slice(cell.col - 1, merge ? merge.right : cell.col).reduce((a, b) => a + b, 0) - 6;
      const value = clone(cell.value), text = cell.text || '', size = cell.font?.size || 11;
      const lines = text.trim() ? wrapSegments(text, width, size) : (text ? [text] : []);
      cells.push({ col: cell.col, value, text, style: clone(cell.style), lines, size, width });
    });
    const hasText = cells.some(c => c.text.trim());
    const lineHeight = Math.ceil(Math.max(10, ...cells.filter(c => c.text.trim()).map(c => c.size)) * 1.4);
    const lineCount = Math.max(1, ...cells.map(c => c.lines.length));
    const minimum = row.height || ws.properties.defaultRowHeight || 15;
    const chunks = Math.ceil(lineCount / Math.max(1, Math.floor((MAX_ROW_HEIGHT - 6) / lineHeight)));
    const height = hasText ? Math.max(minimum, lineCount * lineHeight + 6 * chunks) : minimum;
    source.push({ number: n, cells, merges: rowMerges, hasText, lineHeight, lineCount, minimum, height, ...flags.get(n) });
  }
  // Keep the existing cover on one page by adjusting its empty spacer rows only.
  if (configuration.coverEnd) {
    const cover = source.slice(0, configuration.coverEnd);
    const textHeight = cover.filter(r => r.hasText).reduce((n, r) => n + r.height, 0);
    const emptyHeight = cover.filter(r => !r.hasText).reduce((n, r) => n + r.height, 0);
    if (textHeight >= pageHeight) throw Error('엑셀 표지 제목이 한 페이지보다 깁니다. 제목을 확인해 주세요.');
    const ratio = Math.min(1, (pageHeight - textHeight - 4) / Math.max(1, emptyHeight));
    cover.filter(r => !r.hasText).forEach(r => { r.height = Math.max(1, Math.floor(r.height * ratio)); r.minimum = r.height; });
  }

  const pages = [], output = [];
  let page = { rows: [], height: 0 };
  const repeated = (row, before = row.number) => (row.repeat || []).filter(n => n < before).map(n => source[n - 1]);
  function push(row, values, height, repeat = false, generated = []) {
    if (height > MAX_ROW_HEIGHT || page.height + height > pageHeight + 0.01) throw Error('엑셀 페이지 크기 검사에 실패하여 파일 저장을 중단했습니다.');
    if (values.some(value => typeof value === 'string' && value.length > 32767)) throw Error('엑셀 셀의 최대 글자 수를 초과하여 파일 저장을 중단했습니다.');
    const entry = { source: row.number, values, height, repeat, generated, page: pages.length + 1 };
    output.push(entry); page.rows.push(output.length); page.height += height;
  }
  function closePage(row, before) {
    if (page.rows.length) pages.push(page);
    page = { rows: [], height: 0 };
    for (const header of row ? repeated(row, before) : []) push(header, header.cells.map(c => c.value), header.height, true);
  }
  function freshCapacity(row, before) { return pageHeight - repeated(row, before).reduce((n, r) => n + r.height, 0); }
  for (let i = 0; i < source.length; i++) {
    const row = source[i];
    if (row.startPage && page.rows.length) closePage();
    // A heading, its table header, and at least the first body lines travel together.
    if (row.keepNext) {
      let needed = 0, j = i;
      while (j < source.length && source[j].keepNext) { needed += source[j].height; j++; }
      if (j < source.length) needed += needed + source[j].height <= freshCapacity(row)
        ? source[j].height : Math.min(source[j].height, source[j].lineHeight * 3 + 6);
      if (needed > pageHeight - page.height && page.rows.length) closePage(row, row.number);
      if (needed > pageHeight - page.height) throw Error('엑셀 표 제목과 첫 행이 한 페이지에 들어가지 않습니다. 항목 너비를 확인해 주세요.');
    }
    if (!row.hasText) {
      // Empty spacing never creates a new page on its own.
      if (page.height + row.height <= pageHeight) push(row, row.cells.map(c => c.value), row.height);
      continue;
    }
    // Keep a whole logical visit together whenever it fits a fresh page, even
    // when Excel's row limit requires several physical rows on that same page.
    if (!source[i - 1]?.keepNext && row.height > pageHeight - page.height && row.height <= freshCapacity(row) && page.rows.length) closePage(row);
    // Each cell advances independently. A hard newline is a record boundary
    // (e.g. one timestamped V/S measurement), whereas a soft wrap is not.
    const offsets = row.cells.map(() => 0);
    let started = false;
    const freshHeight = Math.min(MAX_ROW_HEIGHT, freshCapacity(row));
    const freshLines = Math.max(1, Math.floor((freshHeight - 6) / row.lineHeight) - 1);
    function take(cell, offset, limit) {
      if (offset >= cell.lines.length) return { end: offset };
      let end = Math.min(cell.lines.length, offset + limit);
      while (end > offset && cell.lines.slice(offset, end).join('').length > CELL_CHARACTER_LIMIT) end--;
      if (end === cell.lines.length) return { end };
      let boundary = end;
      while (boundary > offset && !/[\r\n]$/.test(cell.lines[boundary - 1])) boundary--;
      if (boundary > offset) return { end: boundary };
      let next = offset + 1;
      while (next < cell.lines.length && !/[\r\n]$/.test(cell.lines[next - 1])) next++;
      const fitsFresh = next - offset <= freshLines && cell.lines.slice(offset, next).join('').length <= CELL_CHARACTER_LIMIT;
      // Move a complete paragraph/measurement to the next page if it fits there.
      // Only paragraphs longer than Excel's row limit need soft-wrap splitting.
      if (fitsFresh) return { end: offset, wait: true };
      return { end };
    }
    while (!started || row.cells.some((c, i) => typeof c.value === 'string' && offsets[i] < c.lines.length)) {
      const available = Math.min(MAX_ROW_HEIGHT, pageHeight - page.height);
      let limit = Math.floor((available - 6) / row.lineHeight), planned;
      while (limit > 0) {
        const choices = row.cells.map((c, i) => typeof c.value === 'string' ? take(c, offsets[i], limit) : { end: c.lines.length });
        if (choices.some(c => c.wait)) break;
        const values = row.cells.map((c, i) => {
          if (typeof c.value === 'string') return c.lines.slice(offsets[i], choices[i].end).join('');
          if (started) return null;
          if (c.lines.length > limit) throw Error('엑셀의 수식 또는 서식 있는 값을 안전하게 나눌 수 없어 저장을 중단했습니다.');
          return c.value;
        });
        const generated = [];
        if (started && page.rows.every(n => output[n - 1].repeat) && row.sequenceColumn) {
          const index = row.cells.findIndex(c => c.col === row.sequenceColumn);
          if (index >= 0 && !values[index] && row.cells[index].text) {
            values[index] = row.cells[index].text + ' (계속)'; generated.push(index);
          }
        }
        const usedLines = Math.max(1, ...values.map((v, i) => v == null ? 0 : wrapSegments(String(typeof v === 'object' ? row.cells[i].text : v), row.cells[i].width, row.cells[i].size).length));
        const complete = !started && choices.every((c, i) => c.end >= row.cells[i].lines.length);
        const height = Math.max(complete ? row.minimum : 0, usedLines * row.lineHeight + 6);
        if (height <= available && choices.some((c, i) => c.end > offsets[i])) {
          planned = { values, height, choices, generated }; break;
        }
        limit--;
      }
      if (!planned) {
        if (page.rows.every(n => output[n - 1].repeat)) throw Error('엑셀 페이지에 기록을 배치할 공간이 없습니다. 항목 너비를 확인해 주세요.');
        closePage(row); continue;
      }
      push(row, planned.values, planned.height, false, planned.generated);
      planned.choices.forEach((c, i) => { offsets[i] = c.end; });
      started = true;
    }
  }
  if (page.rows.length) pages.push(page);
  if (output.length > 1048576) throw Error('엑셀의 최대 행 수를 초과했습니다. 출력 기간을 줄여 주세요.');

  // Fail closed on any loss, duplication, or reordering of original cell text.
  const fragments = new Map();
  for (const entry of output) if (!entry.repeat) {
    if (!fragments.has(entry.source)) fragments.set(entry.source, []);
    fragments.get(entry.source).push(entry);
  }
  for (const row of source) row.cells.forEach((cell, index) => {
    if (cell.value == null || (typeof cell.value === 'string' && !cell.value.trim())) return;
    const values = (fragments.get(row.number) || []).filter(r => !r.generated.includes(index)).map(r => r.values[index]);
    const matches = typeof cell.value === 'string'
      ? values.map(v => v || '').join('') === cell.value
      : JSON.stringify(values.filter(v => v != null)) === JSON.stringify([cell.value]);
    if (!matches) throw Error('엑셀 기록 보존 검사에 실패하여 파일 저장을 중단했습니다.');
  });
  for (const merge of merges) ws.unMergeCells(merge.address);
  // ExcelJS spliceRows(1, rowCount) leaves rows behind when deleting the entire
  // sheet. Reset the public worksheet model after detaching horizontal merges.
  ws.model = { ...ws.model, rows: [], merges: [] };
  ws.rowBreaks = [];
  for (const entry of output) {
    const original = source[entry.source - 1], row = ws.addRow([]);
    row.height = entry.height;
    original.cells.forEach((saved, index) => {
      const cell = row.getCell(saved.col);
      cell.value = clone(entry.values[index]); cell.style = clone(saved.style);
      if (saved.text.trim()) cell.alignment = { ...cell.alignment, wrapText: true };
    });
    // Merge AFTER restoring styles. Replacing a master's style after merging
    // breaks ExcelJS's shared style reference and leaves slave cells borderless.
    for (const merge of original.merges) ws.mergeCells(row.number, merge.left, row.number, merge.right);
  }
  if (ws.rowCount !== output.length) throw Error('엑셀 출력 행 수가 일치하지 않아 저장을 중단했습니다.');
  output.forEach((entry, index) => source[entry.source - 1].cells.forEach((saved, ci) => {
    if (typeof entry.values[ci] === 'string' && ws.getRow(index + 1).getCell(saved.col).value !== entry.values[ci])
      throw Error('엑셀 셀 내용 검증에 실패하여 저장을 중단했습니다.');
  }));
  // Pass the legal final column explicitly; ExcelJS's default is out of range.
  for (const p of pages.slice(0, -1)) ws.getRow(p.rows.at(-1)).addPageBreak(1, 16384);
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1; ws.pageSetup.fitToHeight = 0;
  delete ws.pageSetup.scale; delete ws.pageSetup.printTitlesRow;
  // Fit-to-width can ignore manual row breaks. Separate print areas preserve
  // the planned boundaries while the entire period remains on ONE worksheet.
  // writeBuffer normalizes && into one comma-separated local Print_Area name.
  ws.pageSetup.printArea = pages.map(p => 'A' + p.rows[0] + ':' + ws.getColumn(colCount).letter + p.rows.at(-1)).join('&&');
  return { sheet: ws.name, scale, pageHeight, pages, sourceRows: source.length, outputRows: output.length,
    mapping: output.map(({ source, repeat, generated, page, height }) => ({ source, repeat, generated, page, height })) };
}

module.exports = { createLegacyPrintLayout, paginateWorksheet, wrapSegments, columnPixels, MAX_ROW_HEIGHT };
