/* Optional manual QA: synthetic records -> actual A4 paginator -> headless PDF.
 * Usage: node scripts/verify-counsel-pdf.cjs [path-to-chrome-or-edge]
 * No app startup, database, printer, installed user profile, or network is used.
 * Outputs are placed in a new temporary directory under tmp/pdfs/. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { harness, record, read, section } = require('../tests/helpers/counsel-harness.cjs');

const browser = process.argv[2] || process.env.CHROME_PATH;
if(!browser || !fs.existsSync(browser)) {
  console.error('Pass a local Chrome/Edge executable path; no download is performed.');
  process.exit(1);
}
const outputRoot = path.resolve(__dirname, '../tmp/pdfs');
fs.mkdirSync(outputRoot, { recursive: true });
const outputDir = fs.mkdtempSync(path.join(outputRoot, 'counsel-qa-'));
const paginator = section(read('src/renderer/core/a4-print-dialog.js'), 'function _paginateWithHeaders(', 'function _fillA4Printer(');
const single = harness([record({
  content: '상담 내용을 한 칸에 작성한 가상 기록입니다.\n둘째 줄도 별도로 표시되어야 합니다.\n\n  들여쓴 문단과 <안내> & 인용 "표현"도 그대로 보존합니다.\nSINGLE_END',
  action: '', plan: '  ', opinion: '\n', route: '', followUp: ''
})]).single().html;
const batch = harness([
  record({ content: '첫 기록: 상담 내용만 작성합니다.\nBATCH_FIRST_END' }),
  record({ action: '둘째 기록: 조치 내용만 작성합니다.\nBATCH_SECOND_END' }, { id: 102, date: '2026-09-02' }),
  record({ route: '직접 방문', content: '셋째 기록의 상담 내용입니다.\n두 번째 줄입니다.', action: '지도 내용을 기록합니다.',
    plan: '다음 상담에서 확인합니다.', opinion: '작성한 의견만 출력합니다.', followUp: '2026-09-20' }, { id: 103, date: '2026-09-03' })
]).batch()[0].html;
const longText = Array.from({ length: 120 }, (_, i) => {
  const marker = 'LINE_' + String(i + 1).padStart(3, '0');
  return marker + ' 가상 상담 기록의 줄바꿈과 페이지 경계 보존을 확인합니다. ' + (i % 10 === 9 ? '\n' : '');
}).join('\n');
const long = harness([record({ content: longText, opinion: '긴 상담 내용 이후에도 상담자 의견이 남아야 합니다.\nLONG_END' })]).single().html;
const fixtures = [
  { name: 'single-content-only', html: single, markers: ['SINGLE_END'], minPages: 1 },
  { name: 'batch-mixed-fields', html: batch, markers: ['BATCH_FIRST_END', 'BATCH_SECOND_END'], minPages: 1 },
  { name: 'single-multiple-pages', html: long, markers: [...Array.from({ length: 120 }, (_, i) => 'LINE_' + String(i + 1).padStart(3, '0')), 'LONG_END'], minPages: 2 }
];
function page(html) {
  const script = paginator + '\n' + `
    const raw = ${JSON.stringify(html)};
    const mm={top:20,bottom:20,left:12,right:12};
    const scale=794/210;
    const width=794-Math.round(mm.left*scale)-Math.round(mm.right*scale);
    const height=Math.round(_ppHeightMm(mm)*scale)-18;
    _measureAndPaginate(raw,width,height).then(function(result){
      if(!result.pages || !result.pages.length) throw new Error('Paginator returned no pages');
      const output=_buildPaginatedDoc(result.headHtml,result.pages,mm);
      document.open();document.write(output);document.close();
      document.documentElement.dataset.qaPages=String(result.pages.length);
    }).catch(function(error){document.body.textContent='QA_FAILED: '+error.message;});
  `;
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
}
async function render(fixture) {
  const input = path.join(outputDir, fixture.name + '.html');
  const output = path.join(outputDir, fixture.name + '.pdf');
  const profile = path.join(outputDir, 'profile-' + fixture.name);
  fs.writeFileSync(input, page(fixture.html));
  await new Promise((resolve, reject) => {
    const process = spawn(browser, [
      '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--no-pdf-header-footer', '--virtual-time-budget=10000',
      '--user-data-dir=' + profile, '--print-to-pdf=' + output, pathToFileURL(input).href
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    process.stderr.on('data', chunk => { errors = (errors + chunk).slice(-3000); });
    const timer = setTimeout(() => { process.kill(); reject(new Error('Browser timed out: ' + fixture.name)); }, 45000);
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('exit', code => {
      clearTimeout(timer);
      if(code === 0 && fs.existsSync(output)) resolve();
      else reject(new Error(fixture.name + ': ' + code + '\n' + errors));
    });
  });
  return { name: fixture.name, pdf: output, markers: fixture.markers, minPages: fixture.minPages };
}
Promise.all(fixtures.map(render)).then(results => {
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ outputDir, files: results.map(result => result.pdf) }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
