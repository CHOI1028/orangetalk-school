'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sources = {
  './external-api-transport': fs.readFileSync(path.join(__dirname, '../../src/main/services/external-api-transport.js'), 'utf8'),
  './external-api-diagnostics': fs.readFileSync(path.join(__dirname, '../../src/main/services/external-api-diagnostics.js'), 'utf8')
};

// 실제 통신 모듈은 실행하되 네트워크, Electron 시작과 저장소 접근은 허용하지 않는다.
function createExternalApiModules(fetchImpl, hooks = {}) {
  const modules = new Map();
  for (const [name, source] of Object.entries(sources)) {
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, exports: module.exports, URL, URLSearchParams, AbortController, AbortSignal,
      process: { platform: 'win32', versions: { node: '20.18.3', electron: '33.4.11' } },
      Headers, Response, TextDecoder, Date: hooks.Date || Date,
      setTimeout: hooks.setTimeout || setTimeout, clearTimeout: hooks.clearTimeout || clearTimeout,
      fetch: fetchImpl, console: { log() {}, warn() {}, error() {} },
      require(name) {
        if (name === 'electron') return { app: { isReady: () => false },
          session: { fromPartition() { throw new Error('검사 중 실제 세션 접근 금지'); } } };
        throw new Error('검사 중 외부 모듈 접근 금지: ' + name);
      }
    }, { filename: name + '.js' });
    modules.set(name, module.exports);
  }
  return modules;
}
module.exports = { createExternalApiModules };
