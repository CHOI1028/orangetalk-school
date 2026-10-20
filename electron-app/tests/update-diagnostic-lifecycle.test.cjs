'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const updaterSource = fs.readFileSync(path.join(root, 'src/main/services/auto-updater-service.js'), 'utf8');
const overlaySource = fs.readFileSync(path.join(root, 'src/renderer/features/shell/update-overlay.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const installerSource = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
const acorn = require(path.join(root, 'node_modules/acorn'));
const wp = path.win32;
const userData = 'Z:\\orange-update-fixture\\Roaming\\my-health-diary';
const localData = 'Z:\\orange-update-fixture\\Local';
const currentCache = wp.join(localData, 'my-health-diary-updater');
const healthPath = wp.join(userData, 'update-health.json');
const dataPath = wp.join(userData, 'data', 'my_health_diary.sqlite3');

// 제품 코드는 가상 파일시스템과 가상 업데이트 이벤트만 사용한다.
function fixture(options = {}) {
  const files = options.files || new Map([[dataPath, '실제 자료가 아닌 검사 표식']]);
  const removed = [], writes = [], messages = [], timers = [], installCalls = [];
  const state = { version: options.version || '1.1.13', collab: !!options.collab };
  const fakeFs = {
    existsSync(p) { return files.has(p) || [...files.keys()].some(key => key.startsWith(p + '\\')); },
    readFileSync(p) { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p); },
    writeFileSync(p, value) {
      assert.ok(p === healthPath || p === wp.join(userData, 'update.log'), '예상 밖 가상 저장: ' + p);
      writes.push(p); files.set(p, String(value));
    },
    readdirSync(p) { return [...new Set([...files.keys()].filter(key => key.startsWith(p + '\\')).map(key => key.slice(p.length + 1).split('\\')[0]))]; },
    rmSync(p) {
      assert.ok(p.startsWith(localData + '\\') && /-updater$/.test(p), '자료 경로 삭제 금지: ' + p);
      if (options.failRemoval) throw new Error('EPERM 가상 캐시 삭제 거절');
      removed.push(p); for (const key of [...files.keys()]) if (key === p || key.startsWith(p + '\\')) files.delete(key);
    }
  };
  const updater = new EventEmitter();
  updater.quitAndInstall = (...args) => { installCalls.push(args); if (options.installError) throw new Error(options.installError); if (options.installEventError) updater.emit('error', new Error(options.installEventError)); };
  updater.checkForUpdates = async () => ({ updateInfo: { version: '1.1.14' } });
  updater.checkForUpdatesAndNotify = async () => ({});
  const globals = { _collabWebOn: state.collab, _updateReady: false, _updateVersion: '' };
  const app = { getVersion: () => state.version, getName: () => 'OrangeTalk', getPath: () => userData };
  const module = { exports: {} };
  const requireMock = name => {
    if (name === 'electron') return { app };
    if (name === 'electron-updater') return { autoUpdater: updater };
    if (name === 'fs') return fakeFs;
    if (name === 'path') return wp;
    if (name === 'os') return { platform: () => 'win32', release: () => '10.0.fixture', arch: () => 'x64', homedir: () => 'Z:\\orange-update-fixture' };
    throw new Error('외부 접근을 차단했습니다: ' + name);
  };
  vm.runInNewContext(updaterSource, { module, exports: module.exports, require: requireMock, global: globals,
    process: { env: { LOCALAPPDATA: localData } }, console: { log() {}, warn() {}, error() {} },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} });
  const Service = module.exports;
  const service = new Service({ getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (channel, payload) => messages.push({ channel, payload }) } }) });
  service._wire();
  return { files, removed, writes, messages, timers, installCalls, updater, globals, state, service,
    pending(version = '1.1.14') { files.set(wp.join(currentCache, 'pending', 'OrangeTalk Setup ' + version + ' Firenze.exe'), '가상 설치파일'); },
    health() { return JSON.parse(files.get(healthPath) || '{}'); } };
}

const classifications = [
  ['협업 상태만으로 잠금을 확정하지 않음', { collab: true }, {}, 'D', '가능성', '직접 확인한 것은 아닙니다'],
  ['보류 파일 존재만으로 손상을 확정하지 않음', {}, { pendingExists: true }, 'C', '원인 미확정', '존재만으로'],
  ['오류와 보류 파일이 없으면 미확정', {}, {}, '?', '원인 미확정', '특정할 수 없습니다'],
  ['실제 EBUSY 메시지를 상태 추정보다 우선', { collab: true }, { error: 'EBUSY: file in use' }, 'D', '관련 오류 감지', '오류 메시지'],
  ['EPERM을 무조건 잠금으로 단정하지 않음', {}, { error: 'EPERM: access is denied' }, 'D', '접근 권한', '정확한 원인은 확인되지'],
  ['서명 관련 메시지를 오류 근거로 구분', { collab: true }, { error: 'signature verification failed' }, 'A', '관련 오류 감지', '오류 메시지']
];
for (const [name, options, input, code, label, evidence] of classifications) test(name, () => {
  const f = fixture(options), cause = f.service._classifyCause(input);
  assert.equal(cause.code, code); assert.ok(cause.label.includes(label)); assert.ok(cause.evidence.includes(evidence));
  assert.doesNotMatch(cause.advice, /정상 설치됩니다|다시 시작하면.*설치됩니다|재서명·재배포가 필요/);
});

test('진단에 실제 오류를 꾸며 넣지 않고 감지 횟수의 의미를 표시', () => {
  const f = fixture({ collab: true });
  const text = f.service._buildDiagText({ count: 2, target: '1.1.14', pendingExists: true,
    cause: f.service._classifyCause({}), heal: { ok: true, cleared: 1 } });
  assert.doesNotMatch(text, /확인된 원인:|파일 잠금\/서명 검증 추정/);
  assert.match(text, /실제 오류 메시지가 수집되지 않았습니다/);
  assert.match(text, /실제 설치 시도 횟수 아님/);
  assert.match(text, /정리 전 보류 파일 존재: 예/);
  assert.match(text, /협업 웹서버\(진단 시점\): 켜짐/);
  assert.match(text, /설치 성공을 의미하지 않습니다/);
});
test('실제 오류 문구를 보존하고 오류 이벤트 횟수로 안내', () => {
  const f = fixture(), error = 'EPERM: denied fixture';
  const text = f.service._buildDiagText({ error, count: 2, cause: f.service._classifyCause({ error }) });
  assert.ok(text.includes(error)); assert.match(text, /업데이트 오류 이벤트 수/);
});
test('캐시 정리가 실패하면 완료로 표시하지 않음', () => {
  const f = fixture({ failRemoval: true }); f.pending(); f.service._triggerLoopHeal({ target: '1.1.14', count: 2 });
  const payload = f.messages.find(x => x.payload.mode === 'diagnostic').payload;
  assert.equal(payload.healed, false); assert.match(payload.text, /캐시 정리: 일부\/실패/);
  assert.equal(f.files.get(dataPath), '실제 자료가 아닌 검사 표식');
});
test('같은 실행 세션의 다운로드 완료 중복은 횟수를 올리지 않음', () => {
  const f = fixture(); f.pending();
  f.updater.emit('update-downloaded', { version: '1.1.14' }); f.updater.emit('update-downloaded', { version: '1.1.14' });
  assert.equal(f.health().dlCount, 1); assert.equal(f.removed.length, 0); assert.equal(f.globals._updateReady, true);
});
test('세션 간 두 번 감지되면 캐시만 정리하고 진단을 한 번 표시', () => {
  const a = fixture(); a.pending(); a.updater.emit('update-downloaded', { version: '1.1.14' });
  const b = fixture({ files: a.files, collab: true }); b.updater.emit('update-downloaded', { version: '1.1.14' });
  const reports = b.messages.filter(x => x.payload.mode === 'diagnostic');
  assert.equal(reports.length, 1); assert.match(reports[0].payload.text, /직접 확인한 것은 아닙니다/);
  assert.equal(b.globals._updateReady, false); assert.equal(b.updater.autoInstallOnAppQuit, false);
  assert.equal(b.updater.autoDownload, true); assert.equal(b.health().blockedVersion, undefined);
  assert.equal(b.files.get(dataPath), '실제 자료가 아닌 검사 표식');
  b.service._triggerLoopHeal({ target: '1.1.14' }); assert.equal(b.messages.filter(x => x.payload.mode === 'diagnostic').length, 1);
});
test('서명 오류의 기존 재시도 차단 정책은 유지', () => {
  const f = fixture(); f.pending(); f.service._triggerLoopHeal({ target: '1.1.14', error: 'signature invalid', count: 2 });
  assert.equal(f.health().blockedVersion, '1.1.14'); assert.equal(f.updater.autoDownload, false);
});
test('차단한 버전과 다른 새 버전이 감지되면 기존대로 차단 해제', () => {
  const f = fixture(); f.service._saveHealth({ blockedVersion: '1.1.14' }); f.updater.autoDownload = false;
  f.updater.emit('update-available', { version: '1.1.15' });
  assert.equal(f.health().blockedVersion, undefined); assert.equal(f.updater.autoDownload, true);
});
test('네트워크 오류는 설치 실패 진단에 합산하지 않음', () => {
  const f = fixture(); let probes = 0; f.service._startNetProbe = () => probes++;
  f.updater.emit('error', new Error('ENOTFOUND school114.org'));
  assert.equal(probes, 1); assert.equal(f.health().errCount, undefined); assert.equal(f.removed.length, 0);
});
test('가상 설치 요청은 조용한 설치와 설치 후 실행 옵션을 유지', () => {
  const f = fixture(); f.updater.emit('update-downloaded', { version: '1.1.14' });
  const result = f.service.quitAndInstall(); assert.equal(result.success, true);
  assert.equal(JSON.stringify(f.installCalls), '[[true,true]]'); assert.equal(f.state.version, '1.1.13');
});
test('설치 요청 예외는 서비스에서 실패로 반환', () => {
  const f = fixture({ installError: '가상 설치 실행 오류' }); f.globals._updateReady = true;
  assert.equal(f.service.quitAndInstall().success, false);
});
test('가상 새 버전 실행 이후에만 이전 상태와 묵은 보류 파일 정리', () => {
  const f = fixture({ version: '1.1.14' }); f.pending('1.1.14');
  f.service._saveHealth({ target: '1.1.14', dlCount: 1 });
  assert.equal(f.service._purgeStalePending(), true);
  f.updater.emit('update-not-available', { version: '1.1.14' });
  assert.equal(JSON.stringify(f.health()), '{}'); assert.equal(f.files.get(dataPath), '실제 자료가 아닌 검사 표식');
});
test('아직 적용하지 않은 상위 버전 보류 파일은 시작 정리에서 보존', () => {
  const f = fixture(); f.pending('1.1.14');
  assert.equal(f.service._purgeStalePending(), false); assert.equal(f.removed.length, 0);
});
test('업데이터 이벤트 연결은 중복되지 않음', () => {
  const f = fixture(); f.service._wire(); assert.equal(f.updater.listenerCount('update-downloaded'), 1);
});

function overlayFixture(options = {}) {
  const nodes = new Map(), roots = [], copied = [], timers = [], intervals = [];
  let listener, restarts = 0, now = 0, confirmations = 0;
  function element() {
    return { id: '', style: {}, innerHTML: '', textContent: '', handlers: new Map(), buttons: new Map(),
      addEventListener(type, fn) { this.handlers.set(type, fn); },
      click() { return this.handlers.get('click')?.call(this); },
      querySelector(selector) { if (!this.buttons.has(selector)) this.buttons.set(selector, element()); return this.buttons.get(selector); },
      remove() { nodes.delete(this.id); const index = roots.indexOf(this); if (index >= 0) roots.splice(index, 1); },
      appendChild(child) { nodes.set(child.id, child); roots.push(child); for (const match of child.innerHTML.matchAll(/id="([^"]+)"/g)) { const nested = element(); nested.id = match[1]; nodes.set(nested.id, nested); } }
    };
  }
  const document = { getElementById: id => nodes.get(id) || null, createElement: element, body: element(), head: element() };
  const window = { electronAPI: {
    onShowUpdateOverlay(fn) { listener = fn; }, appRelaunch() { restarts++; },
    confirmQuitAfterUpdate() { confirmations++; if(options.reject) return Promise.reject(new Error('가상 IPC 오류')); return Promise.resolve(options.result === undefined ? { success: true } : options.result); }
  } };
  const context = vm.createContext({ window, document, navigator: { clipboard: { writeText(text) { copied.push(text); return Promise.resolve(); } } },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, clearTimeout(id) { if(timers[id-1]) timers[id-1].cancelled = true; }, Date: { now: () => now } });
  vm.runInContext(overlaySource, context);
  return { nodes, roots, copied, timers, intervals, context, show: p => listener(p),
    restartCount: () => restarts, confirmationCount: () => confirmations, setNow(value) { now = value; } };
}
test('진단 화면은 다음 버전 해결을 약속하지 않고 근거와 저장 안내 표시', () => {
  const f = overlayFixture(); f.show({ mode: 'diagnostic', text: '가상 진단', advice: '가상 조치 안내' });
  const html = f.nodes.get('uoDiagRoot').innerHTML;
  assert.doesNotMatch(html, /다음 버전 업데이트에서 개선|정상 설치됩니다/);
  assert.match(html, /실제 원인을 확정하는 것은 아닙니다/); assert.match(html, /작성 중인 내용은 먼저 저장/);
  assert.match(html, /가상 조치 안내/);
});
test('진단 본문과 조치 안내에 포함된 HTML은 이스케이프', () => {
  const f = overlayFixture(); f.show({ mode: 'diagnostic', text: '<img src=x>', advice: '<script>bad</script>' });
  const html = f.nodes.get('uoDiagRoot').innerHTML;
  assert.doesNotMatch(html, /<img|<script>/); assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/);
});
test('진단 중복 열림 방지와 닫기 버튼 유지', () => {
  const f = overlayFixture(); f.show({ mode: 'diagnostic', text: '첫 진단' }); f.show({ mode: 'diagnostic', text: '두 번째' });
  assert.equal(f.roots.filter(x => x.id === 'uoDiagRoot').length, 1);
  f.nodes.get('uoDiagRoot').querySelector('[data-act="close"]').click(); assert.equal(f.nodes.has('uoDiagRoot'), false);
  f.show({ mode: 'diagnostic', text: '다시 열기' }); assert.equal(f.nodes.has('uoDiagRoot'), true);
});
test('진단 복사와 다시 시작 버튼 연결 유지', async () => {
  const f = overlayFixture(); f.show({ mode: 'diagnostic', text: '복사할 가상 진단' });
  f.nodes.get('uoDiagRoot').querySelector('[data-act="copy"]').click(); await Promise.resolve();
  assert.equal(f.copied[0], '복사할 가상 진단');
  f.nodes.get('uoDiagRoot').querySelector('[data-act="restart"]').click(); assert.equal(f.restartCount(), 1);
});

// 종료·설치 실패를 성공으로 처리하지 않는지 가상 프로세스와 IPC로 검사한다.
const ast = acorn.parse(mainSource, { ecmaVersion: 'latest', sourceType: 'script' });
const astNodes = [];
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) astNodes.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
}
visit(ast);
const functionNode = name => astNodes.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
const killNode = functionNode('_killWebServerChildSync');
const requestNode = functionNode('_requestUpdateInstall');
const startNode = functionNode('_webServerStart');
const ipcNode = name => astNodes.find(n => n.type === 'CallExpression' && n.callee?.object?.name === 'ipcMain'
  && n.callee?.property?.name === 'handle' && n.arguments[0]?.value === name);
const beforeQuitNode = astNodes.find(n => n.type === 'CallExpression' && n.callee?.object?.name === 'app'
  && n.callee?.property?.name === 'on' && n.arguments[0]?.value === 'before-quit');
assert.ok(killNode && requestNode && startNode && beforeQuitNode, '종료 및 설치 처리 함수를 찾지 못했습니다.');
function shutdownFixture(spawnResult = { status: 0 }, installResult = { success: true }, options = {}) {
  const events = [], timers = [], sent = [];
  const child = new EventEmitter();
  Object.assign(child, { pid: options.missingPid ? undefined : 43210, exitCode: null, signalCode: null,
    kill() { events.push('signal-kill'); return options.killResult !== false; } });
  if(options.exited) child.exitCode = 0;
  const ctx = vm.createContext({ global: { _collabWebOn: true, _updateReady: options.ready !== false },
    _sharedHostState: { token: '가상 토큰', ports: new Set([3000]) },
    _webServerChild: options.noChild ? null : child, _webServerStartedEmitted: true,
    _webServerLogStream: { end() { events.push('log-end'); } }, _emitWebServerStopped() { events.push('stopped'); },
    process: { platform: options.platform || 'win32', kill(pid, signal) {
      assert.equal(pid, 43210); assert.equal(signal, 0); events.push('probe');
      if(options.alive) return true;
      throw Object.assign(new Error('가상 프로세스 조회'), { code: options.probeError || 'ESRCH' });
    } }, require(name) { assert.equal(name, 'child_process'); return { spawnSync(command, args, settings) {
      assert.equal(command, 'taskkill'); assert.equal(JSON.stringify(args), '["/F","/T","/PID","43210"]');
      assert.equal(settings.windowsHide, true); assert.equal(settings.timeout, 4000); events.push('kill-request');
      if(options.spawnThrow) throw new Error('가상 종료 오류'); return spawnResult;
    } }; }, setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout(id) { timers[id-1].cancelled = true; },
    app: { quit() { events.push('app-quit'); } }, mainWindow: { webContents: { send(channel, payload) { sent.push({channel,payload}); } } },
    autoUpdaterService: options.noService ? null : { quitAndInstall() {
      events.push('install-request'); if(options.installThrow) throw new Error('가상 설치 오류'); return installResult;
    } } });
  vm.runInContext([killNode, requestNode, startNode].map(n => mainSource.slice(n.start,n.end)).join('\n'), ctx);
  const extract = n => vm.runInContext('(' + mainSource.slice(n.arguments[1].start,n.arguments[1].end) + ')',ctx);
  return { ctx, events, timers, sent, child, handler: extract(ipcNode('confirm-quit-after-update')),
    direct: extract(ipcNode('updater-quit-and-install')), beforeQuit: extract(beforeQuitNode) };
}
for(const route of ['handler','direct']) test(route + ': 협업 종료와 PID 소멸 확인 후 한 번만 설치 요청', async () => {
  const f = shutdownFixture(); assert.equal((await f[route]()).success,true);
  assert.ok(f.events.indexOf('kill-request') < f.events.indexOf('probe'));
  assert.ok(f.events.indexOf('probe') < f.events.indexOf('install-request'));
  assert.equal(f.ctx._webServerChild,null); assert.equal(f.ctx.global._collabWebOn,false);
  assert.equal(f.ctx._sharedHostState.token,''); assert.equal(f.ctx._sharedHostState.ports.size,0);
  assert.equal(f.ctx.global._updateConfirmed,true); assert.equal(f.ctx.global._updateInstalling,true);
  assert.equal(f.events.includes('app-quit'),false);
});
for(const [label,result,options] of [
  ['실패 종료코드',{status:1},{}], ['명령 시간 초과',{status:null,error:new Error('ETIMEDOUT')},{}],
  ['명령 결과 누락',null,{}], ['명령 예외',{status:0},{spawnThrow:true}],
  ['PID가 여전히 실행 중',{status:0},{alive:true}], ['PID 조회 권한 없음',{status:0},{probeError:'EPERM'}],
  ['PID 없음',{status:0},{missingPid:true}]
]) test(label + ': 설치 차단 및 실행 중 협업 상태 보존', async () => {
  const f = shutdownFixture(result,undefined,options); const response = await f.handler();
  assert.equal(response.success,false); assert.equal(response.code,'WEB_SERVER_STOP_FAILED');
  assert.equal(f.events.includes('install-request'),false); assert.equal(f.events.includes('app-quit'),false);
  assert.equal(f.ctx._webServerChild,f.child); assert.equal(f.ctx.global._collabWebOn,true);
  assert.equal(f.ctx._sharedHostState.token,'가상 토큰'); assert.equal(f.ctx._sharedHostState.ports.size,1);
  assert.equal(f.events.includes('log-end'),false); assert.equal(f.ctx.global._updateConfirmed,false);
  assert.equal(f.ctx.global._updateInstalling,false);
});
for(const options of [{noChild:true},{exited:true}]) test('이미 종료된 협업 서버는 재종료하지 않음 '+JSON.stringify(options),async()=>{
  const f=shutdownFixture(undefined,undefined,options); assert.equal((await f.handler()).success,true);
  assert.equal(f.events.includes('kill-request'),false);
});
for(const options of [{ready:false},{noService:true}]) test('준비되지 않은 업데이트는 종료 전에 거절 '+JSON.stringify(options),async()=>{
  const f=shutdownFixture(undefined,undefined,options); assert.equal((await f.handler()).success,false); assert.equal(f.events.length,0);
});
for(const options of [{},{installThrow:true}]) test('설치 실패 반환 또는 예외를 IPC 실패로 전달 '+JSON.stringify(options),async()=>{
  const f=shutdownFixture(undefined,{success:false,error:'가상 오류'},options);
  assert.equal((await f.handler()).success,false); assert.equal(f.events.includes('app-quit'),false);
  assert.equal(f.ctx.global._updateConfirmed,false); assert.equal(f.ctx.global._updateInstalling,false);
});
test('중복 설치 IPC는 실행 중인 한 요청을 유지',async()=>{
  let finish; const result=new Promise(resolve=>{finish=resolve;}); const f=shutdownFixture(undefined,result);
  const first=f.handler(); assert.equal((await f.direct()).pending,true);
  assert.equal(f.events.filter(x=>x==='install-request').length,1); finish({success:true}); await first;
});
test('설치 준비 중 새 협업 서버 시작을 막음',()=>{
  const f=shutdownFixture(); f.ctx.global._updateInstalling=true;
  assert.equal(vm.runInContext('_webServerStart()',f.ctx).success,false); assert.equal(f.events.length,0);
});
test('비 Windows에서는 종료 신호만으로 성공 처리하지 않고 exit를 기다림',async()=>{
  const f=shutdownFixture(undefined,undefined,{platform:'darwin'}); const pending=f.handler();
  assert.equal(f.events.includes('install-request'),false);
  f.child.signalCode='SIGKILL'; f.child.emit('exit',null,'SIGKILL');
  assert.equal((await pending).success,true); assert.equal(f.child.listenerCount('exit'),0);
});
test('비 Windows 종료 대기 시간 초과는 설치를 차단',async()=>{
  const f=shutdownFixture(undefined,undefined,{platform:'darwin'}); const pending=f.handler();
  f.timers[0].fn(); assert.equal((await pending).success,false);
  assert.equal(f.events.includes('install-request'),false); assert.equal(f.ctx._webServerChild,f.child);
  assert.equal(f.child.listenerCount('exit'),0);
});
test('일반 종료에서도 업데이트 직전 협업 종료 실패를 차단',()=>{
  const f=shutdownFixture({status:1}); let prevented=false; f.beforeQuit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true); assert.equal(f.sent[0].payload.mode,'install-error');
  assert.equal(f.ctx.global._updateConfirmed,false);
});
test('설치 서비스의 동기 error 이벤트도 실패로 반환하고 임시 리스너 정리',()=>{
  const f=fixture({installEventError:'가상 설치 거절'}); f.globals._updateReady=true; f.globals._updateInstalling=true;
  const count=f.updater.listenerCount('error'); assert.equal(f.service.quitAndInstall().success,false);
  assert.equal(f.updater.listenerCount('error'),count); assert.equal(f.globals._updateInstalling,false);
  assert.ok(f.messages.some(m=>m.payload.mode==='install-error'));
});
test('설치 요청 뒤 비동기 오류도 완료로 처리하지 않음',()=>{
  const f=fixture(); f.globals._updateReady=true; f.globals._updateInstalling=true; f.globals._updateConfirmed=true;
  assert.equal(f.service.quitAndInstall().success,true); f.updater.emit('error',new Error('가상 후속 설치 실패'));
  assert.equal(f.globals._updateConfirmed,false); assert.equal(f.globals._updateInstalling,false);
  assert.ok(f.messages.some(m=>m.payload.mode==='install-error'));
});
test('다운로드가 없으면 업데이터를 실행하지 않음',()=>{
  const f=fixture(); assert.equal(f.service.quitAndInstall().success,false); assert.equal(f.installCalls.length,0);
});
async function settleOverlay(){ for(let i=0;i<8;i++) await Promise.resolve(); }
for(const mode of ['quit','startup']) test(mode+': 설치 준비 화면에 가짜 진행률을 표시하지 않음',async()=>{
  const f=overlayFixture(); f.show({mode,version:'1.1.15'});
  const html=f.nodes.get('updateOverlayRoot').innerHTML;
  assert.match(html,/업데이트 설치 준비/); assert.doesNotMatch(html,/uoPercent|100 %|업데이트 설치 중/);
  assert.equal(f.confirmationCount(),0); assert.equal(f.intervals.length,0);
  f.timers.find(t=>t.ms===600).fn(); await settleOverlay(); assert.equal(f.confirmationCount(),1);
  assert.match(f.nodes.get('uoStatus').textContent,/설치 요청을 전달/);
});
for(const options of [{result:{success:false,error:'가상 종료 실패'}},{reject:true},{result:null}]) test('설치 요청 실패 안내와 계속 사용 '+JSON.stringify(options),async()=>{
  const f=overlayFixture(options); f.show({mode:'quit'}); f.timers.find(t=>t.ms===600).fn(); await settleOverlay();
  const root=f.nodes.get('updateOverlayRoot'); assert.match(root.innerHTML,/진행하지 못했습니다/);
  root.querySelector('[data-act="continue"]').click(); assert.equal(f.nodes.has('updateOverlayRoot'),false);
  assert.equal(f.restartCount(),0);
});
test('실패 후 다시 시도는 한 번만 새 설치 요청',async()=>{
  const f=overlayFixture({result:{success:false,error:'가상 실패'}}); f.show({mode:'quit'});
  f.timers[0].fn(); await settleOverlay(); f.nodes.get('updateOverlayRoot').querySelector('[data-act="retry"]').click();
  f.timers[1].fn(); await settleOverlay(); assert.equal(f.confirmationCount(),2);
});
test('비동기 실패 안내는 예약된 자동 설치 취소 및 HTML 이스케이프',()=>{
  const f=overlayFixture(); f.show({mode:'quit'}); f.show({mode:'install-error',error:'<img src=x onerror=bad>'});
  assert.equal(f.timers[0].cancelled,true); assert.equal(f.confirmationCount(),0);
  const html=f.nodes.get('updateOverlayRoot').innerHTML; assert.doesNotMatch(html,/<img/); assert.match(html,/&lt;img/);
});
test('진단 화면으로 전환하면 예약된 설치를 취소',()=>{
  const f=overlayFixture(); f.show({mode:'quit'}); f.show({mode:'diagnostic',text:'가상 진단'});
  assert.equal(f.timers[0].cancelled,true); assert.equal(f.nodes.has('updateOverlayRoot'),false);
  assert.equal(f.nodes.has('uoDiagRoot'),true);
});
test('설치 스크립트의 기존 대기 상한을 기록하며 실제 설치 성공으로 간주하지 않음',()=>{
  const macro=installerSource.slice(installerSource.indexOf('!macro WaitProcGone EXE'),installerSource.indexOf('!macroend'));
  assert.match(macro,/LoopUntil.*>= 20/); assert.match(macro,/Sleep 500/);
});
