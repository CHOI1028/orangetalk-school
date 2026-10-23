'use strict';

// Presentation only: callers supply the same records, summaries and memo options
// used by the existing diary export. This module does not read or save app data.
const FONT = '맑은 고딕';
const INK = 'FF26313D';
const LINE = 'FFA9AFB7';
const FILL = 'FFF0F1F3';
const BODY_SIZE = 10;
const LEADING = 15;
const MAX_LINES = 8;
const ALLOWED = new Set(['legacy', 'official', 'approval']);
const DEFAULT_ROLES = ['작성', '검토', '결재'];

function normalizeOptions(input) {
  const o = input && typeof input === 'object' ? input : {};
  return {
    template: ALLOWED.has(o.template) ? o.template : 'legacy',
    orientation: o.orientation === 'portrait' ? 'portrait' : 'landscape',
    margins: o.margins === 'normal' ? 'normal' : 'narrow',
    roles: DEFAULT_ROLES.map((fallback, i) => {
      const v = Array.isArray(o.roles) ? o.roles[i] : '';
      return typeof v === 'string' && v.trim() ? Array.from(v.trim()).slice(0, 40).join('') : fallback;
    })
  };
}

function marginValues(kind) {
  return kind === 'normal'
    ? { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
    : { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
}

function text(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (value.text != null) return String(value.text);
  }
  return String(value).replace(/\r\n?/g, '\n');
}

function cleanTitle(value) {
  return text(value).replace(/^[\s\p{Extended_Pictographic}\uFE0F]+/u, '');
}

function treatmentOutput(value, header) {
  // Remove only standalone renderer placeholders, before wrapping. Meaningful
  // arrows, zeroes, intentional blank lines and the caller's data stay intact.
  if (typeof value !== 'string' || !/처치|투약/.test(header)) return value;
  return value.replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*→(?:\s*→)*\s*$/.test(line)).join('\n');
}

function pixelsForWidth(width) {
  // Include cell padding; narrow Excel columns use a different pixel slope.
  const n = Number(width) || 8.43;
  return n < 1 ? n * 12 : Math.floor(n * 7 + 5);
}

function widthForPixels(pixels) {
  return pixels < 12 ? Math.max(1, pixels) / 12 : (pixels - 5) / 7;
}

function glyphWidth(character, size) {
  if (/^[\p{Mark}\u200D\uFE0F]+$/u.test(character)) return 0;
  if (/^[ilI.,:;'!|]$/.test(character)) return size * 0.42;
  // Malgun Gothic capitals and wide Latin letters are wider than average ASCII.
  // Reserve width for both bold headings and differences between print engines.
  if (character === ' ') return size * 0.5;
  if (/^[0-9]$/.test(character)) return size * 0.75;
  if (/^[()\[\]{}\/\-]$/.test(character)) return size * 0.55;
  if (/^[MWmw@#%]$/.test(character)) return size * 1.2;
  if (/^[A-Z]$/.test(character)) return size * 0.98;
  if (/^[\x20-\x7E]$/.test(character)) return size * 0.9;
  return size * 1.2;
}

function wrapLines(value, widthPt, size = BODY_SIZE, padding = 12) {
  // Conservative width estimate, not a claim to emulate Excel's print engine.
  // Preserve whitespace, explicit blank lines, zeroes and all source characters.
  const available = Math.max(size * 1.3, widthPt - padding);
  const result = [];
  for (const paragraph of text(value).split('\n')) {
    let line = '', width = 0;
    // Keep decimal values, ratios, units and short Latin words together when
    // they fit. Split only a token that is itself wider than the cell.
    const tokens = paragraph.match(/\d+(?:[./:-]\d+)*(?:[A-Za-z%]+|[가-힣]+)?|[A-Za-z][A-Za-z0-9_]*|[^\S\n]+|./gu) || [];
    for (const token of tokens) {
      const characters = Array.from(token);
      const tokenWidth = characters.reduce((sum, character) => sum + glyphWidth(character, size), 0);
      if (tokenWidth <= available) {
        if (line && width + tokenWidth > available) {
          result.push(line);
          line = '';
          width = 0;
        }
        line += token;
        width += tokenWidth;
      } else {
        for (const character of characters) {
          const next = glyphWidth(character, size);
          if (line && width + next > available) {
            result.push(line);
            line = '';
            width = 0;
          }
          line += character;
          width += next;
        }
      }
    }
    result.push(line);
  }
  return result.length ? result : [''];
}

function safeSheetName(workbook, value) {
  const base = (text(value).replace(/[\\/?*\[\]:]/g, '-').replace(/^'+|'+$/g, '').trim() || '보건일지').slice(0, 31);
  let name = base, index = 2;
  while (workbook.worksheets.some(sheet => sheet.name.toLowerCase() === name.toLowerCase())) {
    const suffix = ' (' + index++ + ')';
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  return name;
}

function dateLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  return m ? m[1] + '. ' + m[2] + '. ' + m[3] + '.' : text(value);
}

function columnsFor(headers, provided, options) {
  const count = Math.max(3, headers.length);
  const margins = marginValues(options.margins);
  const paperWidth = options.orientation === 'portrait' ? 595.28 : 841.89;
  // Leave a physical width reserve for font/printer differences.
  const target = (paperWidth - (margins.left + margins.right) * 72 - 22) / 0.75;
  let weights = Array.from({ length: count }, (_, i) => {
    const value = Number(provided && provided[i]);
    if (headers.length < 3) return 1;
    if (Number.isFinite(value) && value > 0) return Math.min(1600, Math.max(28, value));
    return /증상|처치|내용|메모|투약|V\/S/.test(headers[i] || '') ? 230 : 75;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const minimum = Math.min(36, target / count);
  return weights.map(value => widthForPixels(minimum + (target - minimum * count) * value / total));
}

function spans(count, groups, start = 1) {
  const result = [];
  for (let i = 0; i < groups; i++) {
    result.push([start + Math.floor(i * count / groups), start + Math.floor((i + 1) * count / groups) - 1]);
  }
  return result;
}

function spanWidth(sheet, span) {
  let width = 0;
  for (let i = span[0]; i <= span[1]; i++) width += pixelsForWidth(sheet.getColumn(i).width) * 0.75;
  return width;
}

function cellStyle(cell, options = {}) {
  cell.font = { name: FONT, size: options.size || BODY_SIZE, bold: !!options.bold, color: { argb: INK } };
  cell.alignment = { horizontal: options.align || 'left', vertical: options.top ? 'top' : 'middle', wrapText: true, shrinkToFit: false };
  if (options.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.fill } };
  if (options.border !== false) {
    const edge = { style: 'thin', color: { argb: LINE } };
    cell.border = { top: edge, bottom: edge, left: edge, right: edge };
  }
}

function writeRow(sheet, values, rowSpans, style = {}, height) {
  const row = sheet.addRow([]);
  let lines = 1, compact = true;
  rowSpans.forEach((span, i) => {
    if (span[1] > span[0]) sheet.mergeCells(row.number, span[0], row.number, span[1]);
    const cell = row.getCell(span[0]);
    const value = values[i] == null ? '' : values[i];
    const cellOptions = typeof style === 'function' ? style(i) : style;
    compact = compact && !!cellOptions.compact;
    cellStyle(cell, cellOptions);
    const wrapped = wrapLines(value, spanWidth(sheet, span), cell.font.size, cellOptions.compact ? 2 : 12);
    // Persist the same line breaks used to size the row. Do not ask Excel to
    // reflow an unbroken paragraph differently after calculating its height.
    // Keep numbers (including zero) numeric; display text preserves all characters.
    cell.value = typeof value === 'number' ? value : wrapped.join('\n');
    lines = Math.max(lines, wrapped.length);
  });
  row.height = height || (compact ? Math.max(18, lines * 14 + 4) : Math.max(23, lines * LEADING + 6));
  if (compact) {
    if (!sheet.diaryCompactRows) sheet.diaryCompactRows = new Set();
    sheet.diaryCompactRows.add(row.number);
  }
  return row;
}

function fullRow(sheet, value, style = {}, minHeight = 23) {
  const span = [1, sheet.columns.length];
  const size = style.size || BODY_SIZE;
  // Titles/metadata can also be long. Never silently clip them to Excel's row cap.
  const lines = wrapLines(value, spanWidth(sheet, span), size);
  const first = sheet.rowCount + 1;
  for (let offset = 0; offset < lines.length; offset += MAX_LINES) {
    const part = lines.slice(offset, offset + MAX_LINES);
    const shown = lines.length <= MAX_LINES ? value : part.join('\n');
    writeRow(sheet, [shown], [span], { border: false, ...style }, Math.max(minHeight, part.length * Math.max(LEADING, size * 1.6) + 6));
  }
  return first;
}

function continuationRows(sheet, values, rowSpans, style, firstColumnLabel) {
  const compact = typeof style !== 'function' && style.compact;
  const wrapped = rowSpans.map((span, i) => wrapLines(values[i], spanWidth(sheet, span), BODY_SIZE, compact ? 2 : 12));
  const chunks = Math.max(1, ...wrapped.map(lines => Math.ceil(lines.length / MAX_LINES)));
  const range = { first: sheet.rowCount + 1, last: 0, chunks };
  for (let part = 0; part < chunks; part++) {
    const shown = values.map((value, i) => {
      if (chunks === 1) return value;
      if (part > 0 && i === 0 && /^순(?:번)?$/.test(firstColumnLabel || '')) return text(value) + ' (계속)';
      return wrapped[i].slice(part * MAX_LINES, (part + 1) * MAX_LINES).join('\n');
    });
    const rows = Math.max(1, ...shown.map((value, i) => wrapLines(value, spanWidth(sheet, rowSpans[i]), BODY_SIZE, compact ? 2 : 12).length));
    writeRow(sheet, shown, rowSpans, style, compact ? Math.max(18, rows * 14 + 4) : Math.max(24, rows * LEADING + 6));
  }
  range.last = sheet.rowCount;
  return range;
}

function addApproval(sheet, roles) {
  const rightColumns = Math.min(6, sheet.columns.length);
  const roleSpans = spans(rightColumns, 3, sheet.columns.length - rightColumns + 1);
  const wrapped = roles.map((role, i) => wrapLines(role, spanWidth(sheet, roleSpans[i])));
  for (let part = 0; part < Math.max(...wrapped.map(lines => Math.ceil(lines.length / MAX_LINES))); part++) {
    const values = wrapped.map(lines => lines.slice(part * MAX_LINES, (part + 1) * MAX_LINES).join('\n'));
    writeRow(sheet, values, roleSpans, { bold: true, align: 'center', fill: FILL });
  }
  writeRow(sheet, ['', '', ''], roleSpans, { align: 'center' }, 36);
  sheet.addRow([]).height = 4;
}

function createSheet(workbook, name, headers, widths, options) {
  const sheet = workbook.addWorksheet(safeSheetName(workbook, name), {
    views: [{ state: 'normal', showGridLines: false, zoomScale: 100 }],
    pageSetup: {
      paperSize: 9, orientation: options.orientation,
      fitToPage: false, scale: 100, fitToWidth: 1, fitToHeight: 0,
      margins: marginValues(options.margins), horizontalCentered: true
    }
  });
  sheet.columns = columnsFor(headers, widths, options).map(width => ({ width }));
  sheet.properties.defaultRowHeight = 23;
  sheet.diaryTables = [];
  sheet.headerFooter.oddFooter = '&C&"맑은 고딕,Regular"&8&P / &N';
  return sheet;
}

function approvalHeading(sheet, payload, options) {
  if (sheet.columns.length < 6) return false;
  const widths = sheet.columns.map(column => pixelsForWidth(column.width));
  const total = widths.reduce((a, b) => a + b, 0);
  const edges = [0];
  widths.forEach(width => edges.push(edges[edges.length - 1] + width));
  const boundaries = [0];
  for (const fraction of [.56, .56 + .44/3, .56 + .88/3]) {
    const remaining = 4 - boundaries.length;
    let best = boundaries[boundaries.length - 1] + 1;
    for (let i = best + 1; i <= widths.length - remaining; i++) {
      if (Math.abs(edges[i] - fraction * total) < Math.abs(edges[best] - fraction * total)) best = i;
    }
    boundaries.push(best);
  }
  boundaries.push(widths.length);
  const groups = boundaries.slice(1).map((end, i) => [boundaries[i]+1, end]);
  const title = cleanTitle(payload.titleText || '보건일지');
  const values = [title, ...options.roles];
  const titleLines = wrapLines(title, spanWidth(sheet, groups[0]), 18).length;
  const schoolLines = wrapLines(payload.schoolText || '', spanWidth(sheet, groups[0])).length;
  const roleLines = Math.max(...options.roles.map((value, i) => wrapLines(value, spanWidth(sheet, groups[i+1])).length));
  // Retain the full-height form for exceptional long names rather than clip it.
  if (titleLines > 3 || schoolLines > MAX_LINES || roleLines > MAX_LINES) return false;
  writeRow(sheet, values, groups, i => i === 0
    ? {bold:true,size:18,border:false,align:'left'}
    : {bold:true,align:'center',fill:FILL}, Math.max(38, titleLines*28.8+8, roleLines*LEADING+10));
  writeRow(sheet, [payload.schoolText || '', '', '', ''], groups,
    i => i === 0 ? {bold:true,border:false} : {align:'center'}, Math.max(36,schoolLines*LEADING+10));
  fullRow(sheet, payload.periodText || '', {}, 24);
  sheet.addRow([]).height = 4;
  return true;
}

function documentHeading(sheet, payload, options) {
  if (options.template === 'approval' && approvalHeading(sheet, payload, options)) return;
  if (options.template === 'approval') addApproval(sheet, options.roles);
  fullRow(sheet, cleanTitle(payload.titleText || '보건일지'), { bold: true, size: 18, align: 'center' }, 38);
  fullRow(sheet, payload.schoolText || '', { bold: true }, 24);
  fullRow(sheet, payload.periodText || '', {}, 24);
  sheet.addRow([]).height = 4;
}

function sectionTitle(sheet, value) {
  sheet.addRow([]).height = 4;
  fullRow(sheet, cleanTitle(value), { bold: true, size: 11 }, 24);
}

function addMemo(sheet, memo) {
  if (!memo || !Array.isArray(memo.titles) || !memo.titles.length) return;
  const first = sheet.rowCount + 1;
  sectionTitle(sheet, '오늘의 메모');
  const headerLast = sheet.rowCount;
  const split = Math.max(1, Math.floor(sheet.columns.length / 4));
  const memoSpans = [[1, split], [split + 1, sheet.columns.length]];
  const units = memo.titles.map((title, i) => {
    return continuationRows(sheet, [title, memo.cells && memo.cells[i] != null ? memo.cells[i] : ''], memoSpans,
      index => ({ bold: index === 0, fill: index === 0 ? FILL : undefined, top: true }));
  });
  sheet.diaryTables.push({kind:'memo', first, last:sheet.rowCount, header:{first,last:headerLast}, units});
}

// A shared boundary grid gives each table independent column widths. It does
// not bind a 17-category summary to the 12 visit-detail columns or discard zeros.
function statsPanels(labels, widthPt) {
  const capacity = Math.max(3, Math.min(24, Math.floor(widthPt / 26)));
  if (labels.length <= capacity) return [labels.map((_, i) => i)];
  const panels = [];
  for (let offset = 1; offset < labels.length; offset += capacity - 1) {
    panels.push([0, ...labels.slice(offset, offset + capacity - 1).map((_, i) => offset + i)]);
  }
  return panels;
}

function configurePeriodGrid(sheet, documents, options) {
  const baseWidths = sheet.columns.map(column => Math.round(pixelsForWidth(column.width)));
  const baseEdges = [0];
  baseWidths.forEach(width => baseEdges.push(baseEdges[baseEdges.length - 1] + width));
  const total = baseEdges[baseEdges.length - 1];
  const boundaries = new Set(baseEdges);
  const plans = documents.map(document => {
    const headers = document.headerLabels;
    const widths = columnsFor(headers, document.colWidths, options).map(width => pixelsForWidth(width));
    const ownTotal = widths.reduce((a, b) => a + b, 0);
    const detailEdges = [0];
    for (let i = 1; i <= headers.length; i++) {
      const edge = Math.round(widths.slice(0, Math.floor(i * widths.length / headers.length)).reduce((a,b) => a+b, 0) * total / ownTotal);
      detailEdges.push(edge);
      boundaries.add(edge);
    }
    const sections = document.preambleSections && document.preambleSections.sections;
    const stats = (Array.isArray(sections) ? sections : []).filter(section => Array.isArray(section.header) && section.header.length).map(section => ({
      section,
      panels: statsPanels(section.header, total * .75).map(indices => {
        const edges = Array.from({length:indices.length+1}, (_,i) => Math.round(i*total/indices.length));
        edges.forEach(edge => boundaries.add(edge));
        return {indices,edges};
      })
    }));
    return {detailEdges,stats};
  });
  const edges = [...boundaries].sort((a,b) => a-b);
  sheet.columns = edges.slice(1).map((edge,i) => ({width:widthForPixels(edge-edges[i])}));
  const toSpans = values => values.slice(1).map((edge,i) => [edges.indexOf(values[i])+1,edges.indexOf(edge)]);
  return plans.map(plan => ({
    detailSpans:toSpans(plan.detailEdges),
    stats:plan.stats.map(item => ({section:item.section,panels:item.panels.map(panel => ({indices:panel.indices,spans:toSpans(panel.edges)}))}))
  }));
}

function addStats(sheet, sections) {
  if (!Array.isArray(sections)) return;
  const plans = sheet.diaryStatsPlans || [];
  for (const plan of plans) {
    const section = plan.section, labels = section.header;
    plan.panels.forEach((panel, panelIndex) => {
      const first = sheet.rowCount + 1;
      sheet.addRow([]).height = 2;
      const title = cleanTitle(section.title || '방문 집계') + (plan.panels.length > 1 ? ' (' + (panelIndex + 1) + '/' + plan.panels.length + ')' : '');
      writeRow(sheet, [title], [[1,sheet.columns.length]], {bold:true,border:false,compact:true});
      const indices = panel.indices, groupSpans = panel.spans;
      continuationRows(sheet, indices.map(i => labels[i]), groupSpans, {bold:true,align:'center',fill:FILL,compact:true});
      const headerLast = sheet.rowCount;
      const units = (section.rows || []).map(values => continuationRows(sheet, indices.map(i => values[i]), groupSpans, {align:'center',compact:true}));
      if (section.totalsRow) units.push({...continuationRows(sheet, indices.map(i => section.totalsRow[i]), groupSpans, {bold:true,align:'center',fill:'FFF7F8F9',compact:true}),keepWithPrevious:true});
      sheet.diaryTables.push({kind:'statistics',first,last:sheet.rowCount,header:{first,last:headerLast},units});
    });
  }
}

function finishSheet(sheet) {
  sheet.pageSetup.printArea = 'A1:' + sheet.getColumn(sheet.columns.length).letter + Math.max(1, sheet.rowCount);
}

function appendDetailSection(sheet, payload, options, detailSpans) {
  const headers = payload.headerLabels;
  const headingFirst = sheet.rowCount + 1;
  documentHeading(sheet, payload, options);
  const headingRange = {first:headingFirst,last:sheet.rowCount};
  addMemo(sheet, payload.todayMemo);
  addStats(sheet, payload.preambleSections && payload.preambleSections.sections);
  const tableFirst = sheet.rowCount + 1;
  sectionTitle(sheet, '방문 상세');
  const headerRange = continuationRows(sheet, headers, detailSpans, {bold:true,align:'center',fill:FILL});
  const rowRanges = [];
  (payload.dataRows || []).forEach(values => {
    if (values.length > headers.length) throw new Error('출력 항목과 기록의 열 수가 다릅니다. 미리보기를 다시 실행해 주세요.');
    const padded = headers.map((header,i) => treatmentOutput(values[i] == null ? '' : values[i], header));
    const style = i => ({
      align:/증상|처치|내용|메모|투약|V\/S|바디맵|이름|성명/.test(headers[i]) ? 'left' : 'center',top:true
    });
    const range = continuationRows(sheet, padded, detailSpans, style, headers[0]);
    // Scratch rows are for table construction only. The final page planner
    // places the original wrapped lines, not these arbitrary eight-line chunks.
    Object.defineProperty(range, 'flow', {value:{values:padded,spans:detailSpans,style,label:headers[0]}});
    rowRanges.push(range);
  });
  sheet.diaryTables.push({kind:'detail',first:tableFirst,last:sheet.rowCount,header:{first:tableFirst,last:headerRange.last},units:rowRanges});
  return {rowRanges,headerRange,headingRange};
}

// Use real row breaks at a fixed scale, rather than relying on Fit to Page:
// Excel may ignore manual breaks in that mode. Column widths already fit A4.
// This planner is deliberately conservative, but does not emulate Excel.
function paginateWorkbook(ExcelJS, sourceBook, layout) {
  const source = sourceBook.worksheets[0];
  const result = new ExcelJS.Workbook();
  result.creator = sourceBook.creator;
  result.views = [{activeTab:0,firstSheet:0}];
  const sheet = result.addWorksheet(source.name, {
    views: source.views,
    pageSetup: {...source.pageSetup, fitToPage:false, scale:100}
  });
  delete sheet.pageSetup.printTitlesRow;
  sheet.columns = source.columns.map(column => ({width:column.width}));
  sheet.properties.defaultRowHeight = source.properties.defaultRowHeight;
  sheet.headerFooter = {...source.headerFooter};
  sheet.diaryCompactRows = new Set();
  const margins = sheet.pageSetup.margins;
  const paperHeight = sheet.pageSetup.orientation === 'portrait' ? 841.89 : 595.28;
  const paperWidth = sheet.pageSetup.orientation === 'portrait' ? 595.28 : 841.89;
  const width = spanWidth(sheet, [1,sheet.columns.length]);
  if (width > paperWidth - (margins.left + margins.right)*72 - 10) {
    throw new Error('엑셀 열 너비가 인쇄 가능한 폭을 넘습니다. 출력 항목을 확인해 주세요.');
  }
  const available = paperHeight - (margins.top + margins.bottom)*72 - 18;
  // Account for rounding to screen/printer pixels, plus a small per-row reserve.
  const cost = height => Math.ceil(height / .75)*.75 + .75;
  const rowCost = row => cost(source.getRow(row).height || 23);
  const rangeCost = range => {
    let total = 0;
    for (let row = range.first; row <= range.last; row++) total += rowCost(row);
    return total;
  };
  const mapping = new Map(), pages = [];
  let page;
  const copyRow = (number, original) => {
    const input = source.getRow(number), output = sheet.addRow([]);
    output.height = input.height || 23;
    input.eachCell(cell => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      let end = cell.col;
      while (end < source.columnCount && source.getCell(number,end+1).isMerged && source.getCell(number,end+1).master.address === cell.address) end++;
      const target = output.getCell(cell.col);
      target.value = cell.value;
      target.style = JSON.parse(JSON.stringify(cell.style));
      if (end > cell.col) sheet.mergeCells(output.number,cell.col,output.number,end);
    });
    if (source.diaryCompactRows && source.diaryCompactRows.has(number)) sheet.diaryCompactRows.add(output.number);
    if (original) {
      if (mapping.has(number)) throw new Error('엑셀 기록이 중복 배치되어 저장을 중단했습니다.');
      mapping.set(number,[output.number]);
    }
    page.usedHeight += rowCost(number);
    return output.number;
  };
  const copyRange = (range, original) => {
    const first = sheet.rowCount + 1;
    for (let row = range.first; row <= range.last; row++) copyRow(row,original);
    return {first,last:sheet.rowCount};
  };
  const caption = item => item.date ? '기록일: ' + dateLabel(item.date) + ' (계속)' : '선택 기간 보건일지 (계속)';
  const contextCost = item => {
    const lines = wrapLines(caption(item),width,11);
    let height = 0;
    for (let offset = 0; offset < lines.length; offset += MAX_LINES) height += cost(Math.max(26,Math.min(MAX_LINES,lines.length-offset)*17.6+6));
    return height;
  };
  const startPage = (item, index, continued, table) => {
    if (page) {
      page.last = sheet.rowCount;
      sheet.getRow(sheet.rowCount).addPageBreak(1,sheet.columns.length);
    }
    page = {first:sheet.rowCount+1,last:0,documentIndex:index,date:item.date || '',continued,usedHeight:0,availableHeight:available,headers:[]};
    pages.push(page);
    if (continued) {
      const first = sheet.rowCount + 1;
      fullRow(sheet,caption(item),{bold:true,size:11},26);
      for (let row = first; row <= sheet.rowCount; row++) page.usedHeight += cost(sheet.getRow(row).height);
      page.context = {first,last:sheet.rowCount};
    }
    if (table) page.headers.push(copyRange(table.header,false));
  };
  const ensureFits = value => {
    if (value > available) throw new Error('제목·결재란 또는 표 머리글이 한 페이지보다 큽니다. 긴 제목이나 결재란 명칭을 확인해 주세요.');
  };
  const flowUnit = (unit, item, index, table) => {
    const flow = unit.flow;
    const lines = flow.spans.map((span,i) => wrapLines(flow.values[i],spanWidth(sheet,span)));
    const length = Math.max(1,...lines.map(value => value.length));
    const numbered = /^순(?:번)?$/.test(flow.label || '');
    const printedRows = [];
    let offset = 0, lastPage;
    ensureFits(contextCost(item) + rangeCost(table.header) + cost(24));
    while (offset < length) {
      let room = available - page.usedHeight;
      if (room < cost(24)) {
        startPage(item,index,true,table);
        room = available - page.usedHeight;
      }
      // Excel limits a row to 409 points. Multiple physical rows on a tall
      // page are necessary only for that limit, not for a fixed line count.
      let take = Math.min(length-offset,Math.floor((Math.min(409,room)-6)/LEADING));
      while (take > 0 && cost(Math.max(24,take*LEADING+6)) > room) take--;
      if (take < 1) throw new Error('방문 기록 한 줄을 배치할 공간이 없어 저장을 중단했습니다.');
      const shown = flow.values.map((value,i) => {
        if (offset > 0 && i === 0 && numbered && offset >= lines[i].length) {
          return page !== lastPage ? text(value) + ' (계속)' : '';
        }
        if (offset === 0 && lines[i].length <= take && typeof value === 'number') return value;
        return lines[i].slice(offset,offset+take).join('\n');
      });
      const count = Math.max(1,...shown.map((value,i) => wrapLines(value,spanWidth(sheet,flow.spans[i])).length));
      const height = Math.max(24,count*LEADING+6);
      ensureFits(contextCost(item) + rangeCost(table.header) + cost(height));
      if (cost(height) > room) throw new Error('방문 기록의 계속 표시가 페이지 높이를 넘어 저장을 중단했습니다.');
      const row = writeRow(sheet,shown,flow.spans,flow.style,height);
      page.usedHeight += cost(height);
      printedRows.push(row.number);
      lastPage = page;
      offset += take;
    }
    for (let row = unit.first; row <= unit.last; row++) {
      if (mapping.has(row)) throw new Error('엑셀 기록이 중복 배치되어 저장을 중단했습니다.');
      mapping.set(row,printedRows);
    }
  };
  const mapRange = range => {
    const unique = new Set();
    for (let row = range.first; row <= range.last; row++) {
      if (!mapping.has(row)) throw new Error('엑셀 기록 배치가 누락되어 저장을 중단했습니다.');
      for (const printed of mapping.get(row)) unique.add(printed);
    }
    const printedRows = [...unique].sort((a,b) => a-b);
    return {...range,...(range.flow ? {chunks:printedRows.length} : {}),first:printedRows[0],last:printedRows[printedRows.length-1],printedRows};
  };
  const outputLayout = [];
  layout.forEach((item,index) => {
    const firstTable = item.tables[0];
    const prefix = firstTable ? rangeCost(firstTable.header) + (firstTable.units.length ? (firstTable.kind === 'detail' ? cost(24) : rowCost(firstTable.units[0].first)) : 0) : 0;
    ensureFits(rangeCost(item.heading) + prefix);
    startPage(item,index,false);
    copyRange(item.heading,true);
    item.tables.forEach((table,tableIndex) => {
      const whole = rangeCost(table), head = rangeCost(table.header);
      const firstRow = table.units.length ? (table.kind === 'detail' ? cost(24) : rowCost(table.units[0].first)) : 0;
      const continuedBody = available - contextCost(item) - head;
      ensureFits(contextCost(item) + head + firstRow);
      // Small summary/memo tables travel as a unit when possible. The first
      // table must start with its document heading, even when its body is long.
      if (tableIndex > 0 && table.kind !== 'detail' && whole <= available-contextCost(item) && whole > available-page.usedHeight) {
        startPage(item,index,true);
      }
      if (head + firstRow > available-page.usedHeight) startPage(item,index,true);
      page.headers.push(copyRange(table.header,true));
      table.units.forEach((unit,unitIndex) => {
        if (unit.flow) {
          flowUnit(unit,item,index,table);
          return;
        }
        const next = table.units[unitIndex+1];
        const groupCost = rangeCost(unit) + (next && next.keepWithPrevious ? rangeCost(next) : 0);
        if (unitIndex > 0 && groupCost <= continuedBody && groupCost > available-page.usedHeight) startPage(item,index,true,table);
        for (let row = unit.first; row <= unit.last; row++) {
          ensureFits(contextCost(item) + head + rowCost(row));
          if (rowCost(row) > available-page.usedHeight) startPage(item,index,true,table);
          copyRow(row,true);
        }
      });
    });
    const mapped = {...item,heading:mapRange(item.heading),sectionRows:mapRange(item.sectionRows),tables:item.tables.map(table => ({
      ...table,...mapRange(table),header:mapRange(table.header),units:table.units.map(mapRange)
    }))};
    if (item.rows) mapped.rows = item.rows.map(mapRange);
    if (item.header) mapped.header = mapRange(item.header);
    outputLayout.push(mapped);
  });
  if (page) page.last = sheet.rowCount;
  if (mapping.size !== source.rowCount) throw new Error('엑셀 출력 영역에 배치되지 않은 기록이 있어 저장을 중단했습니다.');
  if (pages.some(value => value.usedHeight > available || value.last < value.first)) throw new Error('엑셀 페이지 크기 계산에 실패해 저장을 중단했습니다.');
  finishSheet(sheet);
  result.diaryLayout = outputLayout;
  result.diaryPagination = {scale:100,fitToPage:false,pages};
  return result;
}

function buildWorkbook(ExcelJS, payload) {
  const options = normalizeOptions(payload.diaryExcelOptions);
  if (options.template === 'legacy') throw new Error('기존 양식은 기존 출력 경로를 사용해야 합니다.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '오렌지톡';
  workbook.views = [{activeTab:0,firstSheet:0}];
  const days = Array.isArray(payload.continuousDays) ? payload.continuousDays : [];
  const documents = days.length ? days.map((day,index) => ({
    ...day,titleText:'일일 보건일지',schoolText:day.schoolText || payload.schoolText || '',
    periodText:'기록일: ' + dateLabel(day.date) + '  |  기간 내 기록일 ' + (index+1) + '/' + days.length
  })) : [{...payload}, ...(payload.dailySheets || []).map(extra => ({...(extra.payload || {})}))];
  for (const document of documents) {
    if (!Array.isArray(document.headerLabels) || !document.headerLabels.length) {
      throw new Error('엑셀에 표시할 항목이 없습니다. 표시 항목을 하나 이상 선택해 주세요.');
    }
  }
  const first = documents[0];
  const sheet = createSheet(workbook, payload.mainSheetTitle || '보건일지', first.headerLabels, first.colWidths, options);
  const hasCover = Array.isArray(payload.coverSections) && payload.coverSections.length > 0;
  if (hasCover) documents.unshift({
    isStatisticsCover:true,headerLabels:new Array(8).fill(''),colWidths:new Array(8).fill(100),
    titleText:payload.coverTitle || '진료과별 선택기간 통계',schoolText:payload.schoolText || '',periodText:payload.periodText || '',
    preambleSections:{sections:payload.coverSections}
  });
  const plans = configurePeriodGrid(sheet, documents, options);
  const layout = [];
  documents.forEach((document,index) => {
    const sectionFirst = sheet.rowCount + 1;
    const tableFirst = sheet.diaryTables.length;
    sheet.diaryStatsPlans = plans[index].stats;
    if (document.isStatisticsCover) {
      documentHeading(sheet,document,options);
      const heading = {first:sectionFirst,last:sheet.rowCount};
      addStats(sheet,document.preambleSections.sections);
      layout.push({sheet:sheet.name,type:'statistics',heading,tables:sheet.diaryTables.slice(tableFirst),sectionRows:{first:sectionFirst,last:sheet.rowCount}});
    } else {
      const detail = appendDetailSection(sheet,document,options,plans[index].detailSpans);
      layout.push({sheet:sheet.name,date:document.date,records:(document.dataRows || []).length,
        rows:detail.rowRanges,header:detail.headerRange,columns:plans[index].detailSpans,
        heading:detail.headingRange,tables:sheet.diaryTables.slice(tableFirst),
        sectionRows:{first:sectionFirst,last:sheet.rowCount}});
    }
  });
  // Use one visible worksheet and one continuous print area. An active-sheet
  // preview now includes the entire period, including an optional statistics
  // cover. Do not depend on grouped tabs, macro execution or Excel print scope.
  // The pagination pass keeps this single sheet, using explicit row breaks
  // with Fit to Page disabled so date headings do not drift between pages.
  sheet.diaryStatsPlans = plans.flatMap(plan => plan.stats);
  finishSheet(sheet);
  const fallbackPeriod = days.length ? '기간: ' + dateLabel(days[0].date) + ' ~ ' + dateLabel(days[days.length-1].date) : '';
  const selectedPeriod = text(payload.periodText || fallbackPeriod).replace(/&/g,'&&').replace(/\n/g,' ');
  sheet.headerFooter.oddFooter = '&C&"맑은 고딕,Regular"&8' + selectedPeriod + '\n선택 기간 전체 인쇄  |  &P / &N';
  // Diagnostics are transient; they are not saved to user records/settings.
  return paginateWorkbook(ExcelJS,workbook,layout);
}

module.exports = { normalizeOptions, buildWorkbook, wrapLines, pixelsForWidth, marginValues };
