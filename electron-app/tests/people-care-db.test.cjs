'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('care-only database regressions execute against real in-memory SQLite under Electron Node mode', (t) => {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures', 'people-care-db-native.cjs')], {
    cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 60000,
    windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const count = result.stdout.match(/^# tests (\d+)$/m);
  assert.ok(count, 'Native SQLite tests must actually run; no ABI-error skip is allowed');
  assert.ok(Number(count[1]) >= 40, 'The complete native regression suite must run');
  t.diagnostic(count[1] + ' real SQLite cases passed; memory-only DB, no application launch or user data access');
});
