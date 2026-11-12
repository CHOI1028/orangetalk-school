'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs');
test('Electron AI panel: API card, hidden usage, chat, errors, XSS, cancellation and narrow layout', { timeout: 60000 }, async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(__dirname, 'fixtures/school-ai-ui-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    const timer = setTimeout(() => { child.kill(); reject(Error('AI UI fixture timed out')); }, 55000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  assert.equal(result.code, 0, result.output);
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, '../_preview/school-ai/report.json'), 'utf8'));
  assert(report.checks >= 15); assert.equal(report.externalRequests, 0); assert.deepEqual(report.errors, []);
});
