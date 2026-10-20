/* 실제 자료나 프린터를 사용하지 않는 Chromium 출력 배치 회귀 검사. */
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const root = process.env.ORANGETALK_TEST_ROOT || path.resolve(__dirname, '..');
const out = process.env.ORANGETALK_LAYOUT_REPORT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-label-layout-'));
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-label-profile-'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');

const { harness, record } = require(path.join(root, 'tests/visit-pass-content.test.cjs'));
const css = fs.readFileSync(path.join(root, 'src/renderer/styles/health-diary.css'), 'utf8');
const report = { kind: 'Chromium layout regression', realDataUsed: false, printerUsed: false, cases: [] };
const scenarios = [
  { format: 'default', variant: 'normal' },
  { format: 'default', variant: 'long' },
  { format: 'default', variant: 'empty' },
  { format: 'rest_referral', variant: 'normal' },
  { format: 'rest_referral', variant: 'long' },
  { format: 'meal_request', variant: 'long' },
  { format: 'referral', variant: 'long' },
  ...Array.from({ length: 7 }, (_, i) => ({ format: 'custom' + (i + 1), variant: 'normal' })),
  { format: 'custom1', variant: 'long' },
  { format: 'custom1', variant: 'custom-label' }
];
const longLabel = '사용자가직접지정한매우긴입실확인시각항목명';
const longSymptom = '길고상세한가상증상설명'.repeat(18) + '증상끝표시';
const longTreatment = '가상처치내용과안내사항 '.repeat(24) + '처치끝표시';

/* DOM 문자열뿐 아니라 글자별 사각형으로 실제 줄바꿈과 칸 넘침을 측정한다. */
function measureLayout() {
  const table = document.querySelector('.vp-info-table');
  if (!table) throw new Error('출력 표를 찾지 못했습니다.');
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const glyphs = el => {
    const found = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode;
      if (n.parentElement.closest('.vp-cf-l-icons,.vp-reason-del,.vp-tpl-tools')) continue;
      for (let i = 0; i < n.textContent.length; i++) {
        if (/\s/.test(n.textContent[i])) continue;
        const range = document.createRange();
        range.setStart(n, i); range.setEnd(n, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width && r.height) found.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
    }
    return found;
  };
  const labels = [...table.querySelectorAll('td.label')].map(cell => {
    const textEl = cell.querySelector('.vp-cf-l-text') || cell;
    const clone = textEl.cloneNode(true);
    clone.querySelectorAll('.vp-cf-l-icons,.vp-reason-del').forEach(el => el.remove());
    const boxes = glyphs(textEl), tops = [];
    for (const b of boxes) if (!tops.some(y => Math.abs(y - b.top) < 2)) tops.push(b.top);
    const cellRect = rect(cell);
    return {
      text: clone.textContent.trim(), lines: tops.length, width: cellRect.width,
      overflow: boxes.some(b => b.left < cellRect.left - 1 || b.right > cellRect.right + 1),
      whiteSpace: getComputedStyle(textEl).whiteSpace
    };
  });
  const values = [...table.querySelectorAll('td:not(.label)')].map(cell => {
    const boxes = glyphs(cell), r = rect(cell);
    const tops = [];
    for (const b of boxes) if (!tops.some(y => Math.abs(y - b.top) < 2)) tops.push(b.top);
    return {
      text: cell.textContent, lines: tops.length,
      overflow: boxes.some(b => b.left < r.left - 1 || b.right > r.right + 1)
    };
  });
  const parent = table.parentElement, ps = getComputedStyle(parent);
  const available = parent.clientWidth - parseFloat(ps.paddingLeft || 0) - parseFloat(ps.paddingRight || 0);
  return { labels, values, tableWidth: rect(table).width, available, text: table.textContent };
}

let win;
async function main() {
  await app.whenReady();
  /* 검사 창은 별도 프로필을 사용하고 네트워크 요청을 차단한다. */
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:|^wss?:/i.test(details.url) });
  });
  win = new BrowserWindow({
    show: false, width: 1100, height: 1200,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  const htmlPath = path.join(out, 'isolated-fixture.html');
  for (const scenario of scenarios) for (const a4 of [false, true]) for (const surface of ['preview', 'print']) {
    const id = `${scenario.format}-${scenario.variant}-${a4 ? 'a4' : 'receipt'}-${surface}`;
    const entry = { id, passed: false };
    try {
      const saved = { ec_vp_symtreat_mode: { [scenario.format]: 'split' } };
      if (scenario.variant === 'custom-label') saved.ec_vp_custom_labels = { custom1: { '입실시간': longLabel } };
      const h = harness(saved);
      h.context.vpState.paper = a4 ? 'a4' : 'receipt';
      h.context.vpState.selectedRecord = scenario.variant === 'empty' ? null : record({
        symptoms: [scenario.variant === 'long' ? longSymptom : '가상증상'],
        treatment: [scenario.variant === 'long' ? longTreatment : '가상처치'], medication: ''
      });
      const original = JSON.stringify(h.context.vpState.selectedRecord);
      const body = h.render(scenario.format);
      assert.equal(JSON.stringify(h.context.vpState.selectedRecord), original, '양식 생성 중 원본 기록 변경');
      let html;
      if (surface === 'preview') {
        html = '<!doctype html><html><head><meta charset="utf-8"><base href="' + pathToFileURL(root + path.sep).href + '">' +
          '<style>' + css + '</style><style>body{margin:12px;background:#fff}' +
          '*{box-sizing:border-box}#vpPreview{box-sizing:border-box}</style></head><body>' +
          '<div id="vpPreview" class="vp-preview ' + (a4 ? 'vp-preview-a4' : 'vp-preview-receipt') + '">' + body + '</div></body></html>';
      } else {
        html = h.context._vpComposePrintHtml(body, a4, 0, true);
      }
      fs.writeFileSync(htmlPath, html, 'utf8');
      await win.loadFile(htmlPath);
      if (surface === 'preview') {
        await win.webContents.executeJavaScript('window.vpState={paper:' + JSON.stringify(a4 ? 'a4' : 'receipt') +
          '};(' + h.context._vpApplyReceiptMatchCss.toString() + ')(' + String(!a4) + ');');
      } else {
        /* 종이를 사용하지 않고 Chromium의 print 미디어를 적용한다. */
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
      }
      await win.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      const metrics = await win.webContents.executeJavaScript('(' + measureLayout.toString() + ')()');
      entry.metrics = metrics;
      assert(metrics.tableWidth <= metrics.available + 2, '표가 출력 영역을 벗어남');
      const hasTimes = !['meal_request', 'referral'].includes(scenario.format);
      for (const text of hasTimes ? ['방문일', '입실시간', '퇴실시간', '처치내용'] : ['방문일', '처치내용']) {
        if (scenario.variant === 'custom-label' && text === '입실시간') continue;
        const label = metrics.labels.find(x => x.text === text);
        assert(label, `기본 항목명 누락: ${text}`);
        assert.equal(label.lines, 1, `기본 항목명이 줄바꿈됨: ${text} (${label.lines}줄)`);
        assert(!label.overflow, `기본 항목명이 칸 밖으로 넘침: ${text}`);
      }
      assert(metrics.labels.every(x => !x.overflow), '항목명 텍스트가 칸을 벗어남');
      assert(metrics.values.every(x => !x.overflow), '기록 내용이 칸을 벗어남');
      if (scenario.variant === 'long') {
        assert(metrics.text.includes('증상끝표시') && metrics.text.includes('처치끝표시'), '긴 내용의 끝부분 누락');
        assert(metrics.values.some(x => x.text.includes('증상끝표시') && x.lines > 1), '긴 증상이 줄바꿈되지 않음');
        assert(metrics.values.some(x => x.text.includes('처치끝표시') && x.lines > 1), '긴 처치가 줄바꿈되지 않음');
      }
      if (scenario.variant === 'custom-label') {
        const label = metrics.labels.find(x => x.text === longLabel);
        assert(label && label.lines > 1 && !label.overflow, '긴 사용자 지정 항목명의 줄바꿈 또는 보존 실패');
      }
      if (scenario.format === 'default' && scenario.variant === 'normal' && !a4) {
        fs.writeFileSync(path.join(out, surface + '-receipt.png'), (await win.webContents.capturePage()).toPNG());
      }
      entry.passed = true;
    } catch (error) {
      entry.error = error.stack || String(error);
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      report.cases.push(entry);
      console.log((entry.passed ? 'PASS ' : 'FAIL ') + id + (entry.error ? ': ' + entry.error.split('\n')[0] : ''));
    }
  }
  report.passed = report.cases.filter(c => c.passed).length;
  report.failed = report.cases.length - report.passed;
  fs.writeFileSync(path.join(out, 'layout-results.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`LAYOUT_RESULT ${report.passed}/${report.cases.length} passed; ${report.failed} failed; ${out}`);
  win.destroy();
  app.exit(report.failed ? 1 : 0);
}
main().catch(error => {
  console.error(error.stack || String(error));
  app.exit(2);
});
