/* Copyright (c) 2026 오렌지팜 주식회사. Licensed under LICENSE-KO (proprietary EULA). */
'use strict';

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

/* 업데이트 반복 실패(무한 루프) 감지·자동복구 기준.
 *  같은 대상 버전이 LOOP_THRESHOLD 회(부팅 단위) 이상 "다운로드됐는데 설치가 안 됨" 또는
 *  설치 단계에서 에러가 반복되면 → 캐시 자동 정리 + 진단 모달 표시. (사용자 요청 2026-06-18) */
const LOOP_THRESHOLD = 2;
const FEED_HOST = 'school114.org';   /* 업데이트 피드 호스트 — 네트워크 복구 감지용 가벼운 DNS 확인 대상 */

class AutoUpdaterService {
  constructor({ getMainWindow }) {
    this._getMainWindow = getMainWindow;
    this._wired = false;
    this._lastEvent = null;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    /* 차등(델타) 다운로드 OFF (2026-06-10) — 게시판 첨부 호스트(B11)가 HTTP range 요청을 제대로
     *  지원하지 않아 부분 다운로드가 깨지고("에러→재시도→3번째 성공") 받은 파일이 온전치 않아 설치가
     *  반복되던 문제. 항상 전체 파일을 받게 해서 호스트 호환 문제를 통째로 우회한다. */
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (...a) => console.log('[UPDATE]', ...a),
      warn: (...a) => console.warn('[UPDATE]', ...a),
      error: (...a) => console.error('[UPDATE]', ...a),
      debug: () => {},
    };
  }

  _send(channel, payload) {
    this._lastEvent = { channel, payload, ts: Date.now() };
    const win = this._getMainWindow && this._getMainWindow();
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  }

  /* ── 업데이트 건강 기록 (userData/update-health.json) — 부팅 간 실패 횟수 추적 ── */
  _healthPath() { try { return path.join(app.getPath('userData'), 'update-health.json'); } catch (_) { return null; } }
  _loadHealth() { try { const p = this._healthPath(); if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch (_) {} return {}; }
  _saveHealth(h) { try { const p = this._healthPath(); if (p) fs.writeFileSync(p, JSON.stringify(h || {})); } catch (_) {} }
  _clearHealth() { this._saveHealth({}); }

  /* electron-updater 보류 캐시 폴더 후보(앱명-updater + 옛 명칭). %LOCALAPPDATA% 기준. */
  _updaterCacheDirs() {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const names = [];
    try { names.push(app.getName() + '-updater'); } catch (_) {}
    ['my-health-diary-updater', 'OrangeTalk-updater', 'OrangePharmDiary-updater'].forEach((n) => { if (names.indexOf(n) === -1) names.push(n); });
    return names.map((n) => path.join(base, n));
  }
  /* 멈춘 보류 파일 자동 삭제 → 다음엔 새로 받게(불량 파일 무한 재시도 차단) */
  _autoHeal() {
    let cleared = 0, failed = 0;
    this._updaterCacheDirs().forEach((dir) => {
      try { if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); if (!fs.existsSync(dir)) cleared++; else failed++; } } catch (_) { failed++; }
    });
    /* 보류(pending) 설치파일을 방금 지웠으므로 "종료 시 그 파일을 실행"하는 예약(autoInstallOnAppQuit)도 반드시 취소한다.
     *  안 그러면 electron-updater 가 종료(재시작 포함) 시 이미 삭제된 설치파일을 실행하려다
     *  "…pending\OrangeTalk Setup x.x.x.exe 을(를) 찾을 수 없습니다" 오류가 뜬다. (사용자 보고 2026-07-01)
     *  다음 부팅 때 새 프로세스가 생성자에서 다시 true 로 시작 → 새로 받아 정상 설치되므로 이 세션 한정 조치로 충분. */
    try { autoUpdater.autoInstallOnAppQuit = false; } catch (_) {}
    try { global._updateReady = false; global._updateVersion = ''; } catch (_) {}
    return { cleared, failed, ok: failed === 0 };
  }
  _kstNow() { try { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST'; } catch (_) { return ''; } }
  _curVer() { try { return app.getVersion(); } catch (_) { return ''; } }

  /* ── 업데이트 시도/에러 영속 로그 (userData/update.log) — 개인정보 0: 시각·이벤트·버전·에러만.
   *  루프가 끝난 뒤에도 "언제 무슨 에러로 몇 번 실패했는지" 가 남아, 복구 도구가 그대로 읽어 보여준다.
   *  캐시 폴더가 아니라 userData 에 두므로 캐시 삭제(.bat)로도 안 지워짐. (사용자 요청 2026-06-19) */
  _logPath() { try { return path.join(app.getPath('userData'), 'update.log'); } catch (_) { return null; } }
  _log(line) {
    try {
      const p = this._logPath(); if (!p) return;
      let prev = '';
      try { if (fs.existsSync(p)) prev = fs.readFileSync(p, 'utf8'); } catch (_) {}
      if (prev.length > 64 * 1024) prev = prev.slice(prev.length - 32 * 1024);   /* 64KB 초과 시 최근 32KB만 유지 */
      fs.writeFileSync(p, prev + '[' + this._kstNow() + '] cur=' + (this._curVer() || '?') + ' | ' + line + '\n');
    } catch (_) {}
  }
  /* 네트워크성(연결·DNS) 오류 판별 — 서명·파일잠금 오류와 구분한다.
   *  이 오류는 사용자 잘못도 설치 결함도 아니므로 '진단'이 아니라 '재시도'로만 처리한다. (2026-07-06) */
  _isNetworkError(msg) {
    return /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_PROXY|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|getaddrinfo|net::/i.test(msg || '');
  }
  /* 네트워크 오류가 나면 — 무거운 업데이트 확인을 텀마다 반복하지 않고, 가벼운 DNS 확인을 3초마다 돌려
   *  '연결이 살아나는 그 순간'을 포착해 딱 한 번 업데이트 확인을 실행한다. 사용자는 아무 조작도 하지 않는다.
   *  · 텀을 두어 복구 순간을 놓치는 문제를 없앤다(3초 이내 포착) + 서버엔 무거운 요청을 한 번만 보낸다.
   *  · 앱이 켜져 있는 동안만 감시하며, 약 10분 뒤 종료(다음 시작/정기 확인에 위임). (2026-07-06) */
  _startNetProbe() {
    if (this._probeTimer) return;   /* 이미 감시 중이면 중복 시작 안 함 */
    const dns = require('dns');
    let count = 0; const MAX = 200;   /* 200회 × 3초 ≈ 10분 */
    const tick = () => {
      count++;
      if (count > MAX) { this._log('net probe 종료(약 10분 경과) — 다음 시작/정기 확인에 위임'); this._stopNetProbe(); return; }
      dns.lookup(FEED_HOST, (err) => {
        if (this._probeStopped) return;   /* 그새 중지됨 */
        if (err) {
          this._probeTimer = setTimeout(tick, 3000);   /* 아직 연결 안 됨 → 3초 뒤 재확인 */
        } else {
          this._log('net probe 성공(연결 복구 감지, 약 ' + (count * 3) + '초 경과) → 업데이트 확인 실행');
          this._stopNetProbe();
          try { autoUpdater.checkForUpdates().catch(() => {}); } catch (_) {}
        }
      });
    };
    this._probeStopped = false;
    this._log('net probe 시작 — 3초 간격으로 연결 복구 감시 (' + FEED_HOST + ')');
    this._probeTimer = setTimeout(tick, 3000);
  }
  /* 서버 응답을 한 번이라도 정상 수신하거나(네트워크 살아남) 프로브가 성공하면 감시를 멈춘다. */
  _stopNetProbe() {
    this._probeStopped = true;
    try { if (this._probeTimer) clearTimeout(this._probeTimer); } catch (_) {}
    this._probeTimer = null;
  }
  _buildDiagText(o) {
    o = o || {};
    const heal = o.heal || {};
    const cause = o.cause || {};
    return [
      '[오렌지톡 업데이트 진단]',
      '시각: ' + this._kstNow(),
      '증상: ' + (o.symptom || '업데이트 반복 실패'),
      '확인된 원인: ' + (cause.label ? ('[' + cause.code + '] ' + cause.label) : '(분류 불가)'),
      '보류(멈춘) 파일 존재: ' + (o.pendingExists ? '예' : '아니오'),
      '현재 버전: ' + (this._curVer() || '(미상)'),
      '대상 버전: ' + (o.target || '(미상)'),
      '반복 횟수: ' + (o.count || 0) + '회',
      '마지막 오류: ' + (o.error || '설치가 적용되지 않음 (파일 잠금/서명 검증 추정)'),
      '캐시 정리: ' + (heal.ok ? ('완료 (' + (heal.cleared || 0) + '개 폴더)') : ('일부/실패 (정리 ' + (heal.cleared || 0) + ' / 실패 ' + (heal.failed || 0) + ')')),
      '협업 웹서버: ' + (global._collabWebOn ? '켜짐' : '꺼짐/미상'),
      'OS: ' + os.platform() + ' ' + os.release() + ' ' + os.arch(),
      '피드 호스트: school114.org/B11'
    ].join('\n');
  }
  /* 세 자리 버전 비교: a<b → -1, a==b → 0, a>b → 1. 숫자 외 접미(-beta 등)는 무시. */
  _cmpVer(a, b) {
    const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y ? -1 : 1; }
    return 0;
  }
  /* ── 시작 시 "쓸모없는 pending 자동 삭제" — 전국 사용자 손 안 빌리는 자가복구 (2026-07-03) ──
   *  매 부팅 시 캐시의 보류 설치파일 버전을 확인해서, 그게 "현재 버전 이하"면 즉시 삭제한다.
   *   · 현재 버전과 같음  → 이미 설치 완료됐는데 남은 잔재 (재설치 시도 → 루프 유발)
   *   · 현재 버전보다 낮음 → 다운그레이드 유발분 (실행 시 옛 버전으로 되돌아가는 원인)
   *  임계값(2회 실패)을 기다리지 않고 켜자마자 정리하므로, 무한루프·다운그레이드가 스스로 사라진다.
   *  최신(현재보다 높은) 정상 pending 은 건드리지 않는다 → 정상 업데이트는 그대로 진행. */
  _purgeStalePending() {
    const cur = this._curVer();
    if (!cur) return;
    let purged = false;
    this._updaterCacheDirs().forEach((dir) => {
      try {
        const pd = path.join(dir, 'pending');
        if (!fs.existsSync(pd)) return;
        const exes = fs.readdirSync(pd).filter((f) => /\.exe$/i.test(f));
        for (const f of exes) {
          const m = f.match(/(\d+\.\d+\.\d+)/);
          if (!m) continue;
          if (this._cmpVer(m[1], cur) <= 0) {
            /* 이 캐시 폴더 통째로 삭제 → 재설치 시도 원천 제거 */
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
            this._log('startup purge stale pending v=' + m[1] + ' (cur=' + cur + ') dir=' + path.basename(dir));
            purged = true;
            break;
          }
        }
      } catch (_) {}
    });
    if (purged) {
      /* 삭제한 pending 을 종료 시 실행하려다 "파일 못 찾음" 나는 것 방지 */
      try { autoUpdater.autoInstallOnAppQuit = false; } catch (_) {}
      try { global._updateReady = false; global._updateVersion = ''; } catch (_) {}
      /* 다음 부팅부터 정상 자동 다운로드 재개를 위해 차단 플래그도 정리 */
      try { const h = this._loadHealth(); delete h.blockedVersion; h.dlCount = 0; h.errCount = 0; this._saveHealth(h); } catch (_) {}
    }
    return purged;
  }
  /* 보류(멈춘) 설치 파일이 캐시에 실제로 있는지 — C(캐시 손상) 확인용 */
  _pendingExists() {
    try {
      return this._updaterCacheDirs().some((dir) => {
        try { const pd = path.join(dir, 'pending'); if (fs.existsSync(pd)) return fs.readdirSync(pd).some((f) => /\.(exe|nupkg|zip)$/i.test(f)); } catch (_) {}
        return false;
      });
    } catch (_) { return false; }
  }
  /* 실제 에러·상태로 원인을 "분류(verify)" — 추측이 아니라 증거로 판정. */
  _classifyCause(o) {
    const e = String((o && o.error) || '').toLowerCase();
    if (/sign|signature|publisher|not signed|signercertificate|인증서|서명/.test(e)) {
      return { code: 'A', label: '배포본 서명 검증 실패', cacheFix: false,
        advice: '홈페이지에서 최신 버전을 수동으로 다시 설치해 주세요. (서버측 재서명·재배포가 필요할 수 있으니 이 진단을 오렌지팜에 보내주세요.)' };
    }
    if (global._collabWebOn || /ebusy|eperm|locked|in use|access is denied|busy|rename|잠금/.test(e)) {
      return { code: 'D', label: '설치 중 파일 잠금 (협업 웹서버 등)', cacheFix: true,
        advice: '멈춘 파일을 정리했습니다. 다시 시작하면 정상 설치됩니다.' };
    }
    if (o && o.pendingExists) {
      return { code: 'C', label: '보류(멈춘) 업데이트 파일 손상·미적용', cacheFix: true,
        advice: '멈춘 파일을 정리했습니다. 다시 시작하면 새로 받아 설치됩니다.' };
    }
    return { code: '?', label: '원인 미확정', cacheFix: true,
      advice: '캐시를 초기화했습니다. 그래도 반복되면 홈페이지에서 재설치 후 이 진단을 오렌지팜에 보내주세요.' };
  }
  _emitDiagnostic(o) {
    this._send('show-update-overlay', {
      mode: 'diagnostic',
      text: this._buildDiagText(o),
      healed: !!(o.heal && o.heal.ok),
      cause: (o.cause && o.cause.label) || '',
      causeCode: (o.cause && o.cause.code) || '',
      advice: (o.cause && o.cause.advice) || '',
      target: o.target || '',
      current: this._curVer()
    });
  }
  /* 무한 루프 감지 시: 원인 분류(verify) → 그에 맞는 조치 → 캐시 정리 → 진단·보고 (세션 1회) */
  _triggerLoopHeal(o) {
    if (this._diagnosed) return;
    this._diagnosed = true;
    o = o || {};
    o.pendingExists = this._pendingExists();
    o.cause = this._classifyCause(o);
    const heal = this._autoHeal();   /* 캐시 정리는 어느 원인이든 안전(불량 파일 제거·재다운로드 유도) */
    const h = this._loadHealth();
    /* 차단(BLOCK) vs 재시도(RETRY) 분기 (2026-06-25)
     *  · A(서명 검증 실패)처럼 같은 버전을 다시 받아봐야 절대 성공 못 하는 원인(cacheFix=false)만 영구 차단.
     *  · [D] 일시적 파일 잠금 / [C] 보류 파일 손상 / ? 미확정(cacheFix=true)은 차단하지 말고 계속 재시도.
     *    이 잠금은 자식이 죽는 어느 종료 시점엔 풀리므로(또는 fix 버전 설치 후 자연 해소) 캐시만 비우고
     *    카운터를 리셋해 다음 부팅에 새로 받아 다시 시도하게 둔다 → 사용자 손 안 빌리고 자가 회복. */
    const permanent = o.cause.cacheFix === false;
    if (permanent) {
      try { autoUpdater.autoDownload = false; } catch (_) {}
      h.blockedVersion = o.target || h.target || '';
    } else {
      try { autoUpdater.autoDownload = true; } catch (_) {}
      delete h.blockedVersion;
      h.dlCount = 0; h.errCount = 0;   /* 새로 두 번 더 시도할 여지를 주고, 매 부팅 즉시 재트리거 방지 */
    }
    h.lastCause = o.cause.code;
    this._saveHealth(h);
    this._log('LOOP DETECTED cause=[' + o.cause.code + '] ' + o.cause.label + ' target=' + (o.target || '?') + ' count=' + (o.count || 0) + ' | mode=' + (permanent ? 'BLOCK' : 'RETRY') + ' | cache-cleared=' + heal.cleared + ' failed=' + heal.failed);
    this._emitDiagnostic(Object.assign({ heal: heal }, o));
  }

  _wire() {
    if (this._wired) return;
    this._wired = true;

    autoUpdater.on('checking-for-update', () => {
      this._log('checking-for-update');
      this._send('updater:checking', {});
    });
    autoUpdater.on('update-available', (info) => {
      const v = info && info.version;
      this._stopNetProbe();   /* 서버 응답 정상 수신 → 연결 복구 감시 중지 */
      this._log('update-available target=' + (v || '?'));
      /* 직전 차단버전과 다른(새) 버전이 나오면 차단 해제 → 정상 자동 다운로드 재개 */
      try {
        const h = this._loadHealth();
        if (h.blockedVersion && v && v !== h.blockedVersion) { delete h.blockedVersion; this._saveHealth(h); try { autoUpdater.autoDownload = true; } catch (_) {} }
      } catch (_) {}
      this._send('updater:available', { version: v, releaseNotes: info && info.releaseNotes });
    });
    autoUpdater.on('update-not-available', (info) => {
      this._stopNetProbe();   /* 서버 응답 정상 수신 → 연결 복구 감시 중지 */
      this._log('update-not-available (up to date)');
      this._clearHealth();   /* 최신 상태 = 건강 기록 초기화 */
      this._send('updater:not-available', { version: info && info.version });
    });
    autoUpdater.on('download-progress', (p) => {
      this._send('updater:progress', {
        percent: Math.round(p.percent || 0),
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      const tgt = (info && info.version) || '';
      const cur = this._curVer();
      const h = this._loadHealth();
      this._log('update-downloaded target=' + tgt + ' (current ' + cur + ')');
      if (cur && tgt && cur === tgt) {
        /* 이미 새 버전으로 설치됨 → 건강 기록 초기화하고 정상 진행 */
        this._clearHealth();
      } else if (this._downloadedThisSession === tgt) {
        /* 같은 세션에서 같은 버전에 대해 update-downloaded 가 두 번 이상 발생한 경우(부팅 시 체크 +
         *  매일 12/15시 정기 체크가 이미 받아둔 업데이트를 다시 감지)에는 카운트하지 않는다.
         *  dlCount 는 "부팅 간(설치 시도 후 미적용)" 카운터여야 하는데, 세션 내 중복으로 올라가면
         *  설치를 한 번도 안 했는데 루프로 오판 → 자동복구가 멀쩡한 pending 을 지워 다운로드를
         *  망가뜨리는 오작동이 났다. (2026-07-02) */
        this._log('update-downloaded (재발생·세션내 중복 무시) target=' + tgt);
      } else {
        this._downloadedThisSession = tgt;
        if (h.target === tgt) h.dlCount = (h.dlCount || 0) + 1; else { h.target = tgt; h.dlCount = 1; h.errCount = 0; }
        this._saveHealth(h);
        this._log('downloaded-but-not-applied count=' + h.dlCount + ' target=' + tgt);
        if ((h.dlCount || 0) >= LOOP_THRESHOLD) {
          /* 받았는데 설치가 적용 안 됨이 반복 → 정상 설치 오버레이 대신 자동복구 + 진단 모달 */
          this._triggerLoopHeal({ symptom: '다운로드는 됐으나 설치가 적용되지 않음 (반복)', target: tgt, count: h.dlCount });
          return;
        }
      }
      this._send('updater:downloaded', { version: tgt });
      /* 부팅 시 청소(_purgeStalePending)가 껐던 "종료 시 설치" 스위치를, 검증된 새(상위) 버전
       *  다운로드가 완료된 시점에 다시 켠다 — 같은 세션에서 받은 업데이트가 종료 때 설치되도록. (2026-07-06) */
      if (cur && tgt && this._cmpVer(tgt, cur) > 0) { try { autoUpdater.autoInstallOnAppQuit = true; } catch (_) {} }
      /* 종료 시 자동 설치 인터셉트용 — main.js 의 close 핸들러가 이 플래그를 봄 */
      global._updateReady = true;
      global._updateVersion = tgt;
      /* CASE B 자동 트리거 — 부팅 직후 (startup 후 12초 이내) update-downloaded 가 발생하면
       *  cache 의 보류 파일을 자동 인식한 것으로 보고 자동 설치 흐름 시작.
       *  사용자가 별도 종료 조작 없이도 다음 부팅 시 업데이트가 즉시 적용됨. */
      const sinceStart = Date.now() - (this._startTs || 0);
      if(sinceStart < 12000){
        try {
          const win = this._getMainWindow && this._getMainWindow();
          if(win && !win.isDestroyed() && win.webContents){
            /* 1초 후 모달 표시 — UI 초기화 시간 확보 */
            setTimeout(() => {
              try {
                win.webContents.send('show-update-overlay', {
                  version: global._updateVersion || '',
                  mode: 'startup'
                });
              } catch (_) {}
            }, 1000);
          }
        } catch (_) {}
      }
    });
    autoUpdater.on('error', (err) => {
      const msg = (err && err.message) || String(err);
      this._log('ERROR ' + msg.replace(/\s+/g, ' ').slice(0, 300));
      this._send('updater:error', { message: msg });
      /* 네트워크성 오류(부팅 직후 DNS/네트워크 미준비·일시 끊김·프록시 등)는 사용자 잘못도 설치 결함도 아니다.
       *  → 진단(errCount)에서 제외하고, 앱이 스스로 조용히 재시도한다. 사용자는 아무것도 하지 않는다. (2026-07-06) */
      if (this._isNetworkError(msg)) {
        this._log('network error → 진단 제외 · 연결 복구 감시 시작');
        this._startNetProbe();
        return;
      }
      /* 설치/검증 단계 에러가 부팅 간 반복되면(서명검증·파일잠금 등) 자동복구 + 진단 */
      try {
        const h = this._loadHealth();
        h.errCount = (h.errCount || 0) + 1; h.lastError = msg; this._saveHealth(h);
        if ((h.errCount || 0) >= LOOP_THRESHOLD) {
          this._triggerLoopHeal({ symptom: '업데이트 처리 중 오류 반복', target: h.target || '', count: h.errCount, error: msg });
        }
      } catch (_) {}
    });
  }

  checkOnStartup() {
    this._wire();
    /* CASE B 감지용 — 부팅 후 얼마나 지났는지 측정 */
    this._startTs = Date.now();
    /* ★ 무엇보다 먼저 — 쓸모없는(현재 버전 이하) pending 을 자동 삭제해 루프·다운그레이드를 스스로 끊는다.
     *  전국 사용자가 아무 조작 없이 켜기만 해도 회복되게 하는 핵심 자가복구. (2026-07-03) */
    try { this._purgeStalePending(); } catch (_) {}
    /* 직전에 무한루프로 차단된 버전이 있으면 — 자동 다운로드를 끈 채 확인만(같은 불량 버전 재루프 방지).
     *  새(다른) 버전이 나오면 update-available 에서 차단 해제 후 정상 재개. */
    try { const h = this._loadHealth(); this._log('=== app start === v=' + (this._curVer() || '?') + (h && h.blockedVersion ? (' (blocked=' + h.blockedVersion + ')') : '')); if (h && h.blockedVersion) { autoUpdater.autoDownload = false; } } catch (_) {}
    setTimeout(() => {
      /* 사용자 결정 2026-06-02 [[feedback_user_facing_text_korean]]:
       *  알림 toast 에 표시되는 텍스트를 한글 "오렌지톡" 으로 명시.
       *  옵션 미지정 시 electron-updater 가 package.json 의 `name` (my-health-diary) 그대로 영문 노출. */
      autoUpdater.checkForUpdatesAndNotify({
        title: '오렌지톡 업데이트 다운로드 완료',
        body: '오렌지톡이 종료될 때 자동으로 설치됩니다.'
      }).catch((err) => {
        console.warn('[UPDATE] 시작 확인 실패:', err && err.message);
      });
    }, 5000);
    /* 정기 자동 확인 — 매일 12:00 · 15:00 (사용자 결정 2026-06-04).
     *  · 사용자에게 보이는 UI 없이 silent 로 체크 → 업데이트 있으면 자동 다운로드 → 종료 시 자동 설치.
     *  · 부팅 12 초 후의 download-downloaded 오버레이 트리거 조건은 시간상 절대 안 걸리므로 무음 보장.
     *  · 그 시각 이전에 사용자가 PC 종료 시 그 회차는 자연스럽게 건너뜀 — 다음 부팅 startup 체크가 대신 잡음. */
    this._scheduleDailyChecks();
  }

  /* 매일 정해진 시간(시 단위) 마다 자동업데이트 확인 예약.
   *  · setTimeout 만 사용 (외부 라이브러리 X).
   *  · 한 번 발사된 뒤 다음 날 같은 시각으로 재예약 (재귀).
   *  · 중복 호출 가드 (_dailyScheduled). */
  _scheduleDailyChecks() {
    if (this._dailyScheduled) return;
    this._dailyScheduled = true;
    [12, 15].forEach((hour) => this._scheduleNextAt(hour));
  }

  _scheduleNextAt(hour) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      /* silent — checkForUpdates() 만 (AndNotify 미사용 → OS 토스트 없음).
       *  업데이트 있으면 autoDownload=true 라 자동 다운로드 시작 → autoInstallOnAppQuit=true 라 종료 시 적용. */
      try {
        autoUpdater.checkForUpdates().catch((err) => {
          console.warn('[UPDATE] 정기(' + hour + '시) 확인 실패:', err && err.message);
        });
      } catch (err) {
        console.warn('[UPDATE] 정기(' + hour + '시) 호출 예외:', err && err.message);
      }
      /* 다음 날 같은 시각 재예약 */
      this._scheduleNextAt(hour);
    }, ms);
  }

  async checkNow() {
    this._wire();
    try {
      const r = await autoUpdater.checkForUpdates();
      return { success: true, version: r && r.updateInfo && r.updateInfo.version };
    } catch (err) {
      return { success: false, error: (err && err.message) || String(err) };
    }
  }

  quitAndInstall() {
    try {
      /* 사용자 결정 2026-06-10: 설치가 끝나면 새 버전으로 자동 재시작 (isForceRunAfter=true).
       *  · 이전(false)에는 설치 완료 신호가 없어, 가짜 "설치중" 오버레이가 사라지면 사용자가 끝난 줄 알고
       *    옛 버전을 다시 켜 → 설치 미적용·"설치중 반복" 레이스가 났다.
       *  · 이제 설치 완료 직후 시스템이 새 버전을 띄워주는 것이 곧 "설치 완료" 신호 → 레이스 원천 제거.
       *  isSilent=true (2026-07-02): 윈도우 NSIS 설치창을 띄우지 않고 조용히 설치한다.
       *    이전 isSilent=false 는 설치창 진행바를 사용자에게 보여줬는데, 복사 도중 파일 잠금으로
       *    "진행바가 다 차기 전에 꺼지는" 그 화면이 바로 이것이었다. 조용한 설치 + installer.nsh 의
       *    프로세스 완전종료 대기(KillAllAndSettle)로 잠금 레이스를 없애 첫 시도에 설치되게 한다.
       *    우리 자체 "설치 중… 자동으로 다시 열립니다" 오버레이는 그대로 노출되므로 사용자 안내는 유지. */
      this._log('quitAndInstall requested (silent install on quit) target=' + (global._updateVersion || '?'));
      autoUpdater.quitAndInstall(true, true);
      return { success: true };
    } catch (err) {
      this._log('quitAndInstall EXCEPTION ' + ((err && err.message) || String(err)));
      return { success: false, error: (err && err.message) || String(err) };
    }
  }

  getLastEvent() {
    return this._lastEvent;
  }
}

module.exports = AutoUpdaterService;
