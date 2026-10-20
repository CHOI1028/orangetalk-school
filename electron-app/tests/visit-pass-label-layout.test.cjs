/* 일반 회귀 검사에서도 실제 Chromium의 출력 배치 검사를 실행한다. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('영수증·A4 미리보기와 인쇄에서 항목명 한 줄 및 긴 내용 보존', { timeout: 420000 }, () => {
  const root = process.env.ORANGETALK_TEST_ROOT || path.resolve(__dirname, '..');
  const electron = require(path.join(root, 'node_modules/electron'));
  const out = process.env.ORANGETALK_LAYOUT_REPORT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orangetalk-label-results-'));
  const env = { ...process.env, ORANGETALK_TEST_ROOT: root, ORANGETALK_LAYOUT_REPORT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [path.join(__dirname, 'visit-pass-label-layout.electron.cjs')], {
    env, windowsHide: true, timeout: 400000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, (result.stdout || '') + '\n' + (result.stderr || ''));
  const report = JSON.parse(fs.readFileSync(path.join(out, 'layout-results.json'), 'utf8'));
  assert.equal(report.cases.length, 64);
  assert.equal(report.failed, 0);
  console.log(`Chromium 배치 ${report.passed}/${report.cases.length} 통과: ${out}`);
});
