/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * web-server/server.js — 오렌지톡 웹 브라우저 버전
 *
 * Electron의 IPC 핸들러를 HTTP REST API로 변환하여
 * 웹 브라우저에서 동일한 UI를 사용할 수 있게 합니다.
 *
 * 사용법:
 *   cd electron-app
 *   node web-server/server.js
 *   → http://localhost:3000 에서 앱 실행
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const https = require('https');
const multer = require('multer');
const { exec } = require('child_process');

const { createHealthDiaryDB } = require('../src/main/services/database');
const { ServiceContainer } = require('../src/main/services/service-container');
const { scopeKey: _scopePersonalKey, isPersonalKey: _isPersonalKey, migrateLegacyPersonalKeys: _migrateLegacyPersonalKeys } = require('../src/main/services/personal-keys');
const { readSheet, writeSheet, getSheetMetadata, createSpreadsheet, batchUpdateSpreadsheet,
        driveListFolders, driveCreateFolder, driveMoveFile,
        driveUploadJson, driveUpdateJson, driveSearchFile, driveDownloadFile } = require('../src/main/services/sheets-api');
const { listCalendars, listEvents, createEvent, updateEvent, deleteEvent } = require('../src/main/services/calendar-api');

/* ── 포트 정책 ──
 *   PORT (= OAuth/redirect 등에서 쓰는 "기본 포트"):
 *     - process.env.PORT 가 있으면 그것을, 아니면 3000.
 *     - Google OAuth Console 에 등록된 redirect URI (http://localhost:3000/...) 와 일치하므로
 *       OAuth 코드는 이 PORT 로만 동작한다 (host-local 통신, 학교 방화벽 무관).
 *
 *   PREFERRED_PORTS (= 동료 교사가 LAN 으로 접속할 때 listening 할 후보들):
 *     - 환경변수가 명시되면 그 포트 하나만 시도 (개발자 오버라이드 보존).
 *     - 그 외에는 표준 HTTP(80) → 흔한 대체(8080/8000/8888/9000) → 기존(3000) 순으로 모두 시도.
 *     - 점유(EADDRINUSE)·권한부족(EACCES) 포트는 스킵, 나머지는 동시 listen.
 *     - 학교 방화벽이 일부 포트를 막아도 다른 포트로 동료 접속 가능 → 클라이언트 폴백의 토대. */
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PREFERRED_PORTS = process.env.PORT
  ? [PORT]
  : [80, 8080, 8000, 8888, 9000, 3000];

/* 다중 listen 결과를 모듈 전역에서 공유 (server-info API, 향후 포트 변경 IPC 등에서 참조).
   부팅 콜백 안에서 push 되며, 부팅 시점은 module.exports 평가 직후 비동기 시작 → 라우트 핸들러 호출 시점엔 항상 채워져 있음. */
const _activeServers = [];
const _activePorts = [];

/* 외부 접근 자동 추적 — 동료 PC 가 어느 포트로 접속해서 요청을 보냈는지 추적.
 *
 * Express 미들웨어에서 req.socket.localPort 를 읽어 해당 포트의 마지막 통과 시각을 기록.
 * (req.socket.localPort = 이 요청을 받은 서버 측 포트)
 *
 * 의미:
 *   - 같은 PC(localhost) 자신의 요청도 들어옴 → 외부 접근의 증거로 부족
 *   - 그래서 "비-루프백" IP 에서 들어온 요청만 카운트하여 정확도 ↑
 *   - 5분 이내 1건 이상 외부 접근이 확인된 포트 → 학교 방화벽 통과 확인
 *
 * 활용:
 *   - GET /api/port-scan 응답 또는 server-info 응답에 lastExternalHit (timestamp) 추가
 *   - 클라이언트 표 "외부 접근" 열에서 lastExternalHit 가 최근(5분 이내) 이면 ✅, 아니면 ⏳ */
const _externalHits = {}; /* { 80: 1735723200000, 8080: ... } — 포트별 마지막 외부 접근 시각(ms) */
function _isLoopbackIp(ip){
  if (!ip) return true;
  /* express req.ip 는 ::ffff:127.0.0.1 형태로 올 수 있어 prefix 도 고려 */
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.indexOf('127.') === 0;
}

const app = express();

/* ── gzip 압축 — JS/CSS/HTML/JSON 응답을 1/3~1/4 로 줄여 웹 첫 로딩을 빠르게 한다.
 *  이미 압축된 woff2/이미지 등은 compression 이 content-type 보고 알아서 건너뜀. (2026-06-07) ── */
app.use(require('compression')());

/* ── CORS 헤더 — 클라이언트 포트 폴백 지원
 *  학교 방화벽으로 활성 포트가 끊기면 클라이언트는 같은 호스트의 다른 포트로 fetch 시도.
 *  브라우저는 다른 포트를 별도 origin 으로 보아 cross-origin 으로 처리하므로 ACAO 필요.
 *  학교 내부망 신뢰 모델이라 와일드카드(*) 허용. cookie 미사용이라 credentials 불필요. */
app.use(function(req, res, next){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ── JSON body 파싱 (50MB 제한 — 대용량 import 대비) ── */
app.use(express.json({ limit: '50mb' }));

/* ── 정적 파일 서빙 ── */
const electronRoot = path.join(__dirname, '..');
/* JS/CSS 정적 파일 캐시 정책: no-store 를 쓰면 접속·새로고침마다 앱 코드(ES 모듈 수십 개)를
 * 전부 재다운로드해서 웹 접속이 매우 느려진다. 대신 no-cache(ETag 재검증)를 쓴다 —
 * 파일이 안 바뀌었으면 서버가 304(본문 0)로 응답해 캐시 재사용, 바뀌면 새 ETag 로 새로 받는다.
 * → "소스 수정 즉시 반영"은 그대로 유지하면서 전체 재다운로드만 제거. (2026-06-07) */
function _nocache(req, res, next){
  res.setHeader('Cache-Control', 'no-cache');
  next();
}
app.use('/src', _nocache, express.static(path.join(electronRoot, 'src')));
app.use('/templates', _nocache, express.static(path.join(electronRoot, 'templates')));
app.use('/kiosk', express.static(path.join(electronRoot, 'kiosk')));
app.use('/assets', express.static(path.join(electronRoot, 'assets')));
app.use('/node_modules', express.static(path.join(electronRoot, 'node_modules')));
/* web-api-bridge.js 서빙 */
app.use('/web-server', _nocache, express.static(__dirname));

/* 메인 HTML */
app.get('/', (req, res) => {
  res.sendFile(path.join(electronRoot, 'health_diary.html'));
});
/* 파비콘 — 404 노이즈 제거 */
app.get('/favicon.ico', (req, res) => {
  const iconPath = path.join(electronRoot, 'assets', 'logo', 'logo_big.png');
  res.sendFile(iconPath, err => { if(err) res.status(204).end(); });
});
/* view fragment HTML 파일들 */
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.endsWith('.html') && req.path !== '/') {
    const filePath = path.join(electronRoot, req.path);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  next();
});

/* ── DB & 서비스 초기화 ── */
/* --db-path 또는 DB_PATH 환경변수로 Electron 앱의 DB를 직접 사용 가능 */
const userDataBase = process.env.USER_DATA_PATH || (() => {
  /* Electron 앱의 userData 폴더가 있으면 공유 모드로 사용
     (DB 파일이 아직 없어도 폴더만 있으면 공유 — Electron 먼저 설치 후 웹 서버 시작한 경우 대비) */
  const electronUserData = (process.platform === 'darwin')
    ? path.join(os.homedir(), 'Library', 'Application Support', 'my-health-diary')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'my-health-diary');
  if (fs.existsSync(electronUserData)) {
    /* .health-diary-web 경로가 있으면 경고 — 이전에 독립 모드로 생성된 레거시 */
    const legacyWebPath = path.join(os.homedir(), '.health-diary-web');
    if (fs.existsSync(path.join(legacyWebPath, 'data', 'my_health_diary.sqlite3'))) {
      console.log('  ⚠  [DB] 레거시 웹 전용 DB 감지: ' + legacyWebPath);
      console.log('  ⚠  Electron 앱 데이터 폴더를 공유 모드로 사용합니다. 레거시 파일은 필요 시 수동 삭제하세요.');
    } else {
      console.log('  [DB] Electron 앱 데이터 감지 → 공유 모드');
    }
    return electronUserData;
  }
  console.log('  [DB] Electron 앱 데이터 없음 → 웹 전용 모드');
  return path.join(os.homedir(), '.health-diary-web');
})();

const dataDir = path.join(userDataBase, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'my_health_diary.sqlite3');
const healthDB = new (require('../src/main/services/database').HealthDiaryDB)(dbPath);
/* 시작 시 import_staging 초기화 — 반영되지 않은 이전 업로드 데이터 폐기 */
try { healthDB.db.prepare('DELETE FROM import_staging').run(); } catch (_) {}

/* ServiceContainer에 필요한 deps 객체 구성 */
/* 웹 모드 Google Sheets 내보내기: 웹 서버가 관리하는 토큰(_getSheetsToken/_getMainToken)을 사용해야 함 */
const { createSpreadsheet: _createSpreadsheet, writeSheet: _writeSheet, batchUpdateSpreadsheet: _batchUpdateSpreadsheet, driveMoveFile: _driveMoveFile, driveSearchFile: _driveSearchFile, driveUploadJson: _driveUploadJson, driveUpdateJson: _driveUpdateJson, driveDownloadFile: _driveDownloadFile } = require('../src/main/services/sheets-api');
const deps = {
  healthDB,
  userDataPath: userDataBase,
  templatesPath: path.join(electronRoot, 'templates'),
  app: {
    getPath: function(name) {
      if (name === 'userData') return userDataBase;
      if (name === 'temp') return os.tmpdir();
      if (name === 'home') return os.homedir();
      if (name === 'downloads') return path.join(os.homedir(), 'Downloads');
      return os.tmpdir();
    }
  },
  /* googleApi — 웹 서버의 토큰 함수를 바인딩 (function 선언은 hoisting 되므로 이 시점에 사용 가능) */
  googleApi: {
    getValidAccessToken: function(){ return _getMainToken(); },
    getSheetsToken: function(){ return _getSheetsToken(); },
    createSpreadsheet: _createSpreadsheet,
    writeSheet: _writeSheet,
    batchUpdateSpreadsheet: _batchUpdateSpreadsheet,
    driveMoveFile: _driveMoveFile,
    driveSearchFile: _driveSearchFile,
    driveUploadJson: _driveUploadJson,
    driveUpdateJson: _driveUpdateJson,
    driveDownloadFile: _driveDownloadFile,
  },
};

/* templates 폴더 복사 (최초 실행) */
const userTemplates = path.join(deps.userDataPath, 'templates');
if (!fs.existsSync(userTemplates)) {
  fs.mkdirSync(userTemplates, { recursive: true });
}

const services = new ServiceContainer(deps);

/* ══════════════════════════════════════════════════════════
 *  파일 업로드 (multer)
 * ══════════════════════════════════════════════════════════ */
const uploadDir = path.join(deps.userDataPath, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '파일이 없습니다' });
  /* 원래 확장자를 붙여서 이름 변경 */
  const ext = path.extname(req.file.originalname);
  const newPath = req.file.path + ext;
  fs.renameSync(req.file.path, newPath);
  res.json({ success: true, filePath: newPath, originalName: req.file.originalname });
});

app.get('/api/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: '파일 없음' });
  /* 보안: userDataPath 하위만 허용 */
  if (!filePath.startsWith(deps.userDataPath)) return res.status(403).json({ error: '접근 불가' });
  res.download(filePath);
});

/* ══════════════════════════════════════════════════════════
 *  Google OAuth 2.0 (웹 리다이렉트 방식)
 * ══════════════════════════════════════════════════════════ */
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',  /* 앱이 만든 파일만 접근 — restricted → sensitive 강등 (보안 평가 면제) */
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

/* 토큰 저장소 (서버 메모리 + 파일) */
const authDir = path.join(deps.userDataPath, 'auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
const authTokenFile = path.join(authDir, 'tokens.json');
const sheetsTokenFile = path.join(authDir, 'tokens_sheets.json');

let _authState = null;  /* { accessToken, refreshToken, expiresAt } */
let _userInfo = null;
let _sheetsAuthState = null;
let _sheetsUserInfo = null;
let _pendingOAuth = {};  /* state → { codeVerifier, account } */

function _loadOAuthConfig() {
  /* 1. 환경변수 */
  const envId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const envSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };
  /* 2. oauth-client.json */
  const fp = path.join(electronRoot, 'oauth-client.json');
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const ins = raw.installed || raw.web || raw;
    return { clientId: ins.client_id || raw.clientId || '', clientSecret: ins.client_secret || raw.clientSecret || '' };
  } catch(_) {}
  return null;
}

function _saveTokenFile(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data), 'utf8'); } catch(e) { console.error('[Auth] 토큰 저장 실패:', e.message); }
}

function _loadTokenFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(_) { return null; }
}

/* 서버 시작 시 저장된 토큰 복원 */
(function _restoreTokens() {
  const main = _loadTokenFile(authTokenFile);
  if (main && main.refreshToken) { _authState = main; _userInfo = main.userInfo || null; }
  const sheets = _loadTokenFile(sheetsTokenFile);
  if (sheets && sheets.refreshToken) { _sheetsAuthState = sheets; _sheetsUserInfo = sheets.userInfo || null; }
})();

function _exchangeCode(code, cfg, redirectUri, codeVerifier) {
  return new Promise((resolve, reject) => {
    const postData = 'code=' + encodeURIComponent(code) + '&client_id=' + encodeURIComponent(cfg.clientId) +
      '&client_secret=' + encodeURIComponent(cfg.clientSecret) + '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&code_verifier=' + encodeURIComponent(codeVerifier) + '&grant_type=authorization_code';
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, (res) => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => {
        try { const data = JSON.parse(body); data.access_token ? resolve(data) : reject(new Error(data.error_description || 'Token exchange failed')); }
        catch(_) { reject(new Error('Token parse failed')); }
      });
    });
    req.on('error', reject); req.write(postData); req.end();
  });
}

function _refreshToken(cfg, refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = 'client_id=' + encodeURIComponent(cfg.clientId) + '&client_secret=' + encodeURIComponent(cfg.clientSecret) +
      '&refresh_token=' + encodeURIComponent(refreshToken) + '&grant_type=refresh_token';
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, (res) => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => {
        try { const data = JSON.parse(body); data.access_token ? resolve(data) : reject(new Error(data.error_description || 'Refresh failed')); }
        catch(_) { reject(new Error('Refresh parse failed')); }
      });
    });
    req.on('error', reject); req.write(postData); req.end();
  });
}

function _fetchUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'www.googleapis.com', path: '/oauth2/v2/userinfo',
      headers: { 'Authorization': 'Bearer ' + accessToken } }, (res) => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => {
        try { const d = JSON.parse(body); resolve({ name: d.name, email: d.email, picture: d.picture }); }
        catch(_) { reject(new Error('UserInfo parse failed')); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function _getValidToken(state, cfg) {
  if (!state || !state.refreshToken) throw new Error('Not authenticated');
  if (state.expiresAt && Date.now() > state.expiresAt - 60000) {
    const refreshed = await _refreshToken(cfg, state.refreshToken);
    state.accessToken = refreshed.access_token;
    state.expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
  }
  return state.accessToken;
}

async function _getMainToken() {
  const cfg = _loadOAuthConfig();
  if (!cfg) throw new Error('OAuth 설정 없음');
  const token = await _getValidToken(_authState, cfg);
  _saveTokenFile(authTokenFile, { ..._authState, userInfo: _userInfo });
  return token;
}

async function _getSheetsToken() {
  if (_sheetsAuthState) {
    const cfg = _loadOAuthConfig();
    const token = await _getValidToken(_sheetsAuthState, cfg);
    _saveTokenFile(sheetsTokenFile, { ..._sheetsAuthState, userInfo: _sheetsUserInfo });
    return token;
  }
  return _getMainToken();
}

/* OAuth 시작 — 브라우저를 Google 인증 페이지로 리다이렉트 */
app.get('/auth/google/start', (req, res) => {
  const cfg = _loadOAuthConfig();
  if (!cfg || !cfg.clientId) return res.status(500).send('OAuth 설정이 없습니다. oauth-client.json을 확인하세요.');

  const account = req.query.account || 'main'; /* main | sheets */
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  _pendingOAuth[state] = { codeVerifier, account };
  /* 5분 후 자동 정리 */
  setTimeout(() => { delete _pendingOAuth[state]; }, 5 * 60 * 1000);

  /* OAuth 는 PORT (Google Console 등록 redirect URI) 로만 동작.
     PORT 가 listening 중이 아니면 콜백이 실패하므로 명확히 안내. */
  if (_activePorts.indexOf(PORT) === -1) {
    return res.status(503).send(
      '<h2>Google 로그인 사용 불가</h2>'
      + '<p>OAuth 인증을 위해서는 포트 ' + PORT + '번이 활성화되어 있어야 합니다.</p>'
      + '<p>현재 활성 포트: ' + (_activePorts.length ? _activePorts.join(', ') : '없음') + '</p>'
      + '<p>다른 프로그램이 ' + PORT + '번 포트를 사용 중이거나 권한이 부족할 수 있습니다.<br>'
      + '해당 프로그램을 종료하거나 관리자에게 문의해주세요.</p>'
      + '<script>setTimeout(()=>window.close(),8000)</script>'
    );
  }
  const redirectUri = 'http://localhost:' + PORT + '/auth/google/callback';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(cfg.clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code&scope=' + encodeURIComponent(SCOPES.join(' ')) +
    '&access_type=offline&state=' + encodeURIComponent(state) +
    '&code_challenge=' + encodeURIComponent(codeChallenge) +
    '&code_challenge_method=S256&prompt=consent';

  res.redirect(authUrl);
});

/* OAuth 콜백 — Google에서 인증 후 리다이렉트 */
app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !_pendingOAuth[state]) {
    return res.status(400).send('<h2>로그인 실패</h2><p>' + (error || 'state 불일치') + '</p><script>setTimeout(()=>window.close(),3000)</script>');
  }

  const { codeVerifier, account } = _pendingOAuth[state];
  delete _pendingOAuth[state];

  try {
    const cfg = _loadOAuthConfig();
    const redirectUri = 'http://localhost:' + PORT + '/auth/google/callback';
    const tokens = await _exchangeCode(code, cfg, redirectUri, codeVerifier);
    const userInfo = await _fetchUserInfo(tokens.access_token);

    const authData = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000 };

    if (account === 'sheets') {
      _sheetsAuthState = authData;
      _sheetsUserInfo = userInfo;
      _saveTokenFile(sheetsTokenFile, { ...authData, userInfo });
    } else {
      _authState = authData;
      _userInfo = userInfo;
      _saveTokenFile(authTokenFile, { ...authData, userInfo });
    }

    res.send('<html><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>로그인 성공!</h2><p>' + userInfo.name + ' (' + userInfo.email + ')</p><p>이 창은 자동으로 닫힙니다.</p><script>setTimeout(function(){window.close();},2000);setTimeout(function(){location.href="/";},2500);</script></body></html>');
  } catch (err) {
    res.status(500).send('<h2>토큰 교환 실패</h2><p>' + err.message + '</p>');
  }
});

/* ══════════════════════════════════════════════════════════
 *  IPC → REST 매핑 테이블
 *  main.js의 ipcMain.handle을 그대로 가져옴
 * ══════════════════════════════════════════════════════════ */

/* ── 서버측 키 폴백 헬퍼 ──
 *
 *  외부 API (카카오/HIRA/응급의료/MFDS/KMA/에어코리아 등) 핸들러에서 사용.
 *  렌더러가 보낸 키가 빈 경우, 호스트가 설정 → API Key 관리에서 저장해 둔 키를
 *  서버측 blob store 에서 직접 읽어와 사용한다.
 *
 *  사용 시나리오: 동료(웹 클라이언트) 의 localStorage 에 키가 아직 동기화 되지 않은
 *  race 상황에서도 의료기관/날씨 등이 정상 동작하도록 보장.
 *
 *  blob store 의 키 이름은 data-loader.js 의 commonMappings 와 동일:
 *    kakao_rest_api_key / kakao_js_api_key
 *    hira_api_key / emergency_api_key / drug_api_key
 *    kma_api_key / airkorea_api_key / infectious_api_key
 *    school_address / school_lat / school_lng
 *
 *  값 형태: 문자열 ("…키…") 또는 객체 (settings 등). 여기선 문자열만 다루는 키 기준. */
function _getStoredCommon(key) {
  try {
    const r = services.store().get('common', key);
    if (!r || !r.exists) return null;
    if (r.data == null) return null;
    /* DB blob 은 JSON 으로 보관 — 문자열이면 그대로, 그 외엔 일관성을 위해 String() */
    return typeof r.data === 'string' ? r.data : String(r.data);
  } catch (_) {
    return null;
  }
}
/* 빈 값(undefined/null/'') 일 때만 서버 blob 으로 폴백. 0/false 같은 의미있는 값은 그대로 통과. */
function _withFallback(clientVal, storedKey) {
  if (clientVal != null && clientVal !== '') return clientVal;
  const v = _getStoredCommon(storedKey);
  return (v != null && v !== '') ? v : '';
}

/* 개인 키 격리용 — 호출 컨텍스트에서 userId 추출.
 *   - 웹 클라이언트(sessionId 보유): 세션의 userId 사용. 미로그인이면 null.
 *   - Electron 메인(sessionId 없음): appConfig 의 currentUserId 사용. */
function _resolveUserContext(ctx) {
  const isWebClient = !!(ctx && ctx.sessionId);
  let userId = null;
  if (isWebClient) {
    const s = ctx.sessions && ctx.sessions[ctx.sessionId];
    if (s && s.userId) userId = s.userId;
  } else {
    try { userId = services.appConfig().getCurrentUserId() || null; } catch (_) {}
  }
  return { isWebClient, userId };
}

const handlers = {
  /* ── 사용자 ── */
  'user-get-all': () => ({ success: true, data: services.users().getAll() }),
  'user-get-active': () => ({ success: true, data: services.users().getActive() }),
  'user-get-by-id': (p) => ({ success: true, data: services.users().getById(p.id || p) }),
  'user-create': (p) => ({ success: true, data: services.users().create(p) }),
  'user-update': (p) => ({ success: true, data: services.users().update(p.id, p.data || p) }),
  'user-delete': (p) => ({ success: true, data: services.users().remove(p.id || p) }),
  /* 옵션 B — 세션 기반 user 매핑.
     웹 클라이언트(sessionId 보유): 호스트의 현재 user 는 건드리지 않고 세션에만 userId 저장.
     Electron 메인(sessionId 없음): 종래대로 호스트 currentUser 변경. */
  'user-set-current': (p, ctx) => {
    const userId = p && (p.userId != null ? p.userId : p);
    if (ctx && ctx.sessionId) {
      const sid = ctx.sessionId;
      if (!ctx.sessions[sid]) ctx.sessions[sid] = { lastSeen: Date.now(), connectedAt: Date.now() };
      ctx.sessions[sid].userId = userId;
      try {
        const u = services.users().getById(userId);
        if (u) {
          ctx.sessions[sid].userName = u.name || '';
          ctx.sessions[sid].userPosition = u.position || '';
          ctx.sessions[sid].userSchool = u.school_name || '';
        }
      } catch (_) {}
      return { success: true };
    }
    services.appConfig().setCurrentUser(userId);
    /* 호스트 로그인 직후 — legacy 개인 데이터(vp_stamps 등) 를 이 사용자 suffixed 키로 1회성 이전.
     * idempotent: 이미 이전된 사용자는 skip. 웹 클라이언트 로그인(위 분기에서 return)에선 트리거 안 됨. */
    if (userId) {
      try {
        const r = _migrateLegacyPersonalKeys(services.store(), services.jsonFile(), userId);
        if (r && r.migrated && r.migrated.length) {
          console.log('[migrate-personal-keys] (web) user=' + userId + ' migrated=' + JSON.stringify(r.migrated));
        }
      } catch (mErr) {
        console.error('[migrate-personal-keys] (web) 실패', mErr.message);
      }
    }
    return { success: true };
  },
  'user-get-current': (p, ctx) => {
    if (ctx && ctx.sessionId) {
      const s = ctx.sessions[ctx.sessionId];
      const sUid = s && s.userId;
      if (sUid) return { success: true, data: services.users().getById(sUid) };
      return { success: true, data: null };
    }
    const userId = services.appConfig().getCurrentUserId();
    if (!userId) return { success: true, data: null };
    return { success: true, data: services.users().getById(userId) };
  },

  /* ── 앱 설정 ── */
  'app-config-is-first-run': () => ({ success: true, isFirstRun: services.appConfig().isFirstRun() }),
  'app-config-setup': (p) => services.appConfig().setupInitial(p),
  'app-config-get-school': () => ({ success: true, data: services.appConfig().getSchoolInfo() }),
  'app-config-update-school': (p) => services.appConfig().updateSchoolInfo(p.school, p.teacher),
  'app-config-get-all': () => ({ success: true, data: services.appConfig().getAll() }),

  /* ── 폴더 경로 ── */
  'folders-get-paths': () => {
    const f = services.folders();
    return { success: true, data: f.data(), templates: f.templates(), surveyForms: f.surveyForms(), surveys: f.surveys(), exports: f.exports(), backups: f.backups() };
  },

  /* ── 학생 ── */
  'students-get-all': (p) => ({ success: true, data: services.studentsDB().getAll(p.year) }),
  'students-get-all-include-left': (p) => ({ success: true, data: services.studentsDB().getAllIncludeLeft(p.year) }),
  'students-get-all-historical': () => ({ success: true, data: services.studentsDB().getAllHistorical() }),
  'students-find-name-duplicates': (p) => ({ success: true, data: services.studentsDB().findNameDuplicates((p&&p.year)) }),
  'students-resolve-name-duplicate': (p) => services.studentsDB().resolveNameDuplicate((p&&p.currentUid), (p&&p.prevUid)),
  'students-save-all': (p) => services.studentsDB().saveAll(p.year, p.students),
  'students-upsert': (p) => services.studentsDB().upsert(p.year, p.student),
  'students-delete': (p) => services.studentsDB().delete(p.uid),
  'students-delete-all-year': (p) => services.studentsDB().deleteAllForYear(p.year),
  'students-set-enrolled': (p) => services.studentsDB().setEnrolled(p.uid, p.year, p.enrolled),
  'students-grade-summary': (p) => ({ success: true, data: services.studentsDB().getGradeSummary(p.year) }),
  'students-class-groups': (p) => ({ success: true, data: services.studentsDB().getClassGroups(p.year, p.grades) }),
  'students-import-batch': (p) => services.studentsDB().saveAll(p.year, p.students),
  'students-get-care': (p) => ({ success: true, data: services.studentsDB().getCare(p.year) }),
  'students-get-history': (p) => ({ success: true, data: services.studentsDB().getHistory(p.uid) }),
  'students-update-memo': (p) => services.studentsDB().updateMemo(p.uid, p.memoJson),
  'students-update-med-consent': (p) => services.studentsDB().updateMedConsent(p.uid, p.consent),
  'students-dedup': (p) => services.studentsDB().deduplicateStudents(p.year),

  /* ── 교직원 ── */
  'staff-get-all': (p) => ({ success: true, data: services.staffDB().getAll(p.year) }),
  'staff-get-all-include-inactive': (p) => ({ success: true, data: services.staffDB().getAllIncludeInactive(p.year) }),
  'staff-get-all-historical': () => ({ success: true, data: services.staffDB().getAllHistorical() }),
  'staff-find-name-duplicates': (p) => ({ success: true, data: services.staffDB().findNameDuplicates((p&&p.year)) }),
  'staff-resolve-name-duplicate': (p) => services.staffDB().resolveNameDuplicate((p&&p.currentUid), (p&&p.prevUid)),
  'staff-upsert': (p) => services.staffDB().upsert(p.year, p.staff),
  'staff-save-all': (p) => services.staffDB().saveAll(p.year, p.staffList),
  'staff-delete': (p) => services.staffDB().delete(p.uid),
  'staff-delete-all-year': (p) => services.staffDB().deleteAllForYear(p.year),
  'staff-deactivate': (p) => services.staffDB().deactivate(p.uid),

  /* ── 보건일지 레코드 ── */
  'records-get-daily': (p) => ({ success: true, data: services.recordsDB().getDailyByYear(p.year) }),
  'records-get-daily-by-date': (p) => ({ success: true, data: services.recordsDB().getDailyByDate(p.year, p.date) }),
  'records-get-daily-by-person': (p) => ({ success: true, data: services.recordsDB().getDailyByPerson(p.personUid) }),
  'records-daily-insert': (p) => { const r = services.recordsDB().insertDaily(p.record); _bumpDataVersion(); return r; },
  'records-daily-update': (p) => { const r = services.recordsDB().updateDaily(p.record); _bumpDataVersion(); return r; },
  'records-daily-delete': (p) => { const r = services.recordsDB().deleteDaily(p.id); _bumpDataVersion(); return r; },
  'records-daily-fix-nurse': (p) => services.recordsDB().fixNurseName(p.oldName, p.newName),
  'records-daily-delete-year': (p) => services.recordsDB().deleteDailyByYear(p.year),
  'records-daily-years': () => {
    const { years, counts } = services.recordsDB().getDailyYears();
    return { success: true, years, counts };
  },
  'records-save-daily': (p) => services.records().saveDailyRecords(p.year, p.records),
  'records-get-emergency': (p) => {
    const data = services.recordsDB().getEmergencyByYear(p.year);
    const nextId = data.length ? Math.max(...data.map(r => r.id)) + 1 : 1;
    return { success: true, data, nextId };
  },
  'records-emergency-insert': (p) => { const r = services.recordsDB().insertEmergency(p.record); _bumpDataVersion(); return r; },
  'records-emergency-update': (p) => { const r = services.recordsDB().updateEmergency(p.record); _bumpDataVersion(); return r; },
  'records-emergency-delete': (p) => { const r = services.recordsDB().deleteEmergency(p.id); _bumpDataVersion(); return r; },
  'records-save-emergency': (p) => services.records().saveEmergencyRecords(p.year, p.records),
  'records-get-infection': (p) => {
    const data = services.recordsDB().getInfectionByYear(p.year);
    const nextId = data.length ? Math.max(...data.map(r => r.id)) + 1 : 1;
    return { success: true, data, nextId };
  },
  'records-infection-insert': (p) => { const r = services.recordsDB().insertInfection(p.record); _bumpDataVersion(); return r; },
  'records-infection-update': (p) => { const r = services.recordsDB().updateInfection(p.record); _bumpDataVersion(); return r; },
  'records-infection-delete': (p) => { const r = services.recordsDB().deleteInfection(p.id); _bumpDataVersion(); return r; },
  'records-save-infection': (p) => services.records().saveInfectionRecords(p.year, p.records),
  'records-count-before-date': (p) => ({ success: true, data: services.recordsDB().countBeforeDate(p.cutoffDate) }),
  'records-delete-before-date': (p) => services.recordsDB().deleteBeforeDate(p.cutoffDate),
  'records-count-by-year': (p) => ({ success: true, data: services.recordsDB().countByYear(p.year) }),
  'records-delete-by-year': (p) => services.recordsDB().deleteByYear(p.year),
  'records-daily-by-date-range': (p) => ({ success: true, data: services.recordsDB().getDailyByDateRange(p.from, p.to) }),
  'records-nurse-stats': (p) => ({ success: true, data: services.recordsDB().getNurseStatsByDateRange(p.from, p.to) }),
  'records-get-infection-notes': (p) => ({ success: true, data: services.records().getInfectionNotes(p.year) }),
  'records-save-infection-notes': (p) => services.records().saveInfectionNotes(p.year, p.notes),
  'records-flush-all': (p) => services.records().saveAllCollections(p.year, p.payload),

  /* ── 설정 ── */
  'settings-get': (p) => ({ success: true, value: services.settings().get(p.key, p.defaultValue) }),
  'settings-set': (p) => services.settings().set(p.key, p.value),
  'settings-get-multiple': (p) => ({ success: true, values: services.settings().getMultiple(p.keys) }),
  'settings-set-multiple': (p) => services.settings().setMultiple(p.entries),

  /* ── 의료 데이터 ── */
  'medical-get-dept-mapping': () => ({ success: true, text: services.medical().getDeptMappingText() }),
  'medical-set-dept-mapping': (p) => services.medical().setDeptMappingText(p.text),
  'medical-get-dept-for-symptom': (p) => ({ success: true, dept: services.medical().getDeptForSymptom(p.symptom) }),
  'medical-get-dept-for-symptoms': (p) => ({ success: true, dept: services.medical().getDeptForSymptoms(p.symptoms) }),
  'medical-get-treatment-map': () => ({ success: true, data: services.medical().getTreatmentMap() }),
  'medical-set-treatment-map': (p) => services.medical().setTreatmentMap(p.map),
  'medical-get-medication-map': () => ({ success: true, data: services.medical().getMedicationMap() }),
  'medical-set-medication-map': (p) => services.medical().setMedicationMap(p.map),
  'medical-get-sym-meds': () => ({ success: true, data: services.medical().getSymMeds() }),
  'medical-set-sym-meds': (p) => services.medical().setSymMeds(p.data),
  'medical-get-sym-ointments': () => ({ success: true, data: services.medical().getSymOintments() }),
  'medical-set-sym-ointments': (p) => services.medical().setSymOintments(p.data),
  'medical-get-sym-patches': () => ({ success: true, data: services.medical().getSymPatches() }),
  'medical-set-sym-patches': (p) => services.medical().setSymPatches(p.data),
  'medical-get-vital-thresholds': () => ({ success: true, data: services.medical().getVitalThresholds() }),
  'medical-set-vital-thresholds': (p) => services.medical().setVitalThresholds(p.thresholds),
  'medical-compute-bmi': (p) => {
    const { MedicalDataService } = require('../src/main/services/app-data-service');
    return { success: true, data: MedicalDataService.computeBmi(p.entries) };
  },

  /* ── 통계 ── */
  'stats-get-summary': (p) => ({ success: true, data: services.statsDB().getSummary(p || {}) }),
  'stats-get-dept': (p) => {
    const result = services.statsDB().getDeptGradeStats(p || {});
    const deptArray = Object.entries(result.deptCounts).map(([dept, v]) => ({ dept, count: v.total })).sort((a, b) => b.count - a.count);
    return { success: true, data: deptArray };
  },
  'stats-get-symptoms': (p) => ({ success: true, data: services.statsDB().getSummary(p || {}).topSymptoms }),
  'stats-get-hourly': (p) => ({ success: true, data: services.statsDB().getSummary(p || {}).hourly }),
  'stats-get-daily-counts': (p) => ({ success: true, data: services.statsDB().getSummary(p || {}).daily }),
  'stats-db-dept-grade': (p) => ({ success: true, data: services.statsDB().getDeptGradeStats(p) }),
  'stats-db-dept-grade-yoy': (p) => ({ success: true, data: services.statsDB().getDeptGradeStatsYoY(p) }),
  'stats-db-counsel': (p) => ({ success: true, data: services.statsDB().getCounselStats(p) }),
  'stats-db-summary': (p) => ({ success: true, data: services.statsDB().getSummary(p) }),
  'stats-db-dept-cats': () => {
    /* 유효 매핑 — 사용자 상분류 편집 반영 (main.js 핸들러와 패리티, 2026-06-12) */
    return { success: true, data: services.statsDB().getEffectiveDeptCats() };
  },
  'stats-db-treatment': (p) => ({ success: true, data: services.statsDB().getTreatmentStats(p) }),
  'stats-db-uncategorized-symptoms': (p) => ({ success: true, data: services.statsDB().getUncategorizedSymptoms(p) }),
  'stats-db-assign-sym-cat': (p) => services.statsDB().assignSymptomCategory(p || {}),
  'stats-db-hourly-heatmap': (p) => ({ success: true, data: services.statsDB().getHourlyHeatmap(p) }),
  'stats-db-class-distribution': (p) => ({ success: true, data: services.statsDB().getClassDistribution(p) }),
  'stats-db-repeat-visitors': (p) => ({ success: true, data: services.statsDB().getRepeatVisitors(p) }),
  'stats-db-gender-symptoms': (p) => ({ success: true, data: services.statsDB().getGenderSymptomComparison(p) }),
  'stats-db-quick': (p) => ({ success: true, data: services.statsDB().getQuickStats(p.year, p.from, p.to) }),
  'stats-db-academic-range': (p) => {
    const { StatisticsDBService } = require('../src/main/services/statistics-db-service');
    return { success: true, data: StatisticsDBService.getAcademicDateRange(p.period, p.year, p.options) };
  },
  'stats-db-sub-tabs': (p) => {
    const { StatisticsDBService } = require('../src/main/services/statistics-db-service');
    return { success: true, data: StatisticsDBService.getSubTabs(p.period, p.baseDate) };
  },
  'stats-db-holidays': () => ({ success: true, data: services.statsDB().getHolidays() }),
  'stats-db-holidays-for': (p) => ({ success: true, data: services.statsDB().getHolidaysFor(p) }),
  'stats-db-holidays-cached-years': () => ({ success: true, data: services.statsDB().getCachedHolidayYears() }),
  'stats-db-holidays-fetch': async (p) => {
    const o = p || {};
    const key = String(o.serviceKey || '').trim();
    const yr = String(o.year || '').trim();
    if (!key) return { success: false, error: '특일정보 API 키가 없습니다 (설정 > API 관리에서 입력)' };
    if (!/^\d{4}$/.test(yr)) return { success: false, error: '연도 형식 오류 (YYYY)' };
    const res = await services.externalApi().fetchHolidays(key, yr);
    if (!res.success) return res;
    services.statsDB().cacheHolidays(yr, res.data || {});
    return { success: true, data: res.data || {}, year: yr, total: res.total || 0, cached: true };
  },
  'stats-db-holidays-clear': (p) => ({ success: !!services.statsDB().clearHolidayCache(p || '*') }),
  'stats-db-trend': (p) => ({ success: true, data: services.statsDB().getTrendData(p) }),

  /* ── 설문 ── */
  'survey-form-list': () => ({ success: true, data: services.surveyForms().list() }),
  'survey-form-get': (p) => {
    const result = services.surveyForms().get(p.formId);
    if (!result) return { success: false, error: '양식을 찾을 수 없습니다.' };
    return { success: true, meta: result.meta, content: result.content };
  },
  'survey-form-save': (p) => {
    const existing = services.surveyForms().getAll();
    const isNew = !existing.find(f => f.id === p.form.id);
    if (isNew && existing.length >= 50) return { success: false, error: '설문 양식은 최대 50건까지 보관할 수 있습니다.' };
    return services.surveyForms().save(p.form, p.content);
  },
  'survey-form-copy': (p) => {
    const existing = services.surveyForms().getAll();
    if (existing.length >= 50) return { success: false, error: '설문 양식은 최대 50건입니다.' };
    return services.surveyForms().copy(p.sourceFormId, p.newId, p.newTitle) || { success: false, error: '원본 없음' };
  },
  'survey-form-delete': (p) => services.surveyForms().delete(p.formId),
  'survey-response-save': (p) => services.surveyResponses().save(p.response, p.content),
  'survey-response-import-batch': (p) => services.surveyResponses().importBatch(p.year, p.formId, p.responses),
  'survey-response-get-by-student': (p) => ({ success: true, data: services.surveyResponses().getByStudent(p.persistentId) }),
  'survey-response-get-by-form': (p) => ({ success: true, data: services.surveyResponses().getByForm(p.year, p.formId) }),
  'survey-response-get-all-with-data': (p) => ({ success: true, data: services.surveyResponses().getAllWithData(p.year, p.formId) }),
  'survey-response-get-data': (p) => {
    const row = services.surveyResponses().getData(p.id);
    return row ? { success: true, data: row } : { success: false, error: '응답 없음' };
  },
  'survey-response-delete': (p) => services.surveyResponses().delete(p.id),
  'survey-response-stats': (p) => ({ success: true, data: services.surveyResponses().getResponseStats(p.year, p.formId) }),
  'survey-response-missing-message': (p) => ({ success: true, data: services.surveyResponses().getMissingStudentsMessage(p.year, p.formId, p.grade, p.cls, p.position, p.name) }),
  'survey-response-old-count': (p) => {
    const count = healthDB.db.prepare('SELECT COUNT(*) as cnt FROM survey_responses WHERE school_year < ?').get(p.currentSchoolYear);
    return { success: true, count: count.cnt };
  },
  'survey-response-delete-old': (p) => {
    const result = healthDB.db.prepare('DELETE FROM survey_responses WHERE school_year < ?').run(p.currentSchoolYear);
    return { success: true, deleted: result.changes };
  },

  /* ── 플래너 ── */
  'planner-load-day': (p) => { try { return { success: true, data: services.plannerStore().loadDay(p.date) }; } catch(e) { return { success: true, data: null }; } },
  'planner-save-day': (p) => { services.plannerStore().saveDay(p.date, p.data); return { success: true }; },
  'planner-has-day': (p) => { try { return { success: true, data: services.plannerStore().hasDay(p.date) }; } catch(e) { return { success: true, data: false }; } },
  'planner-get-links': () => { try { return { success: true, data: services.plannerStore().getLinks() }; } catch(e) { return { success: true, data: [] }; } },
  'planner-save-links': (p) => { services.plannerStore().saveLinks(p.items); return { success: true }; },
  'planner-get-routines': () => { try { return { success: true, data: services.plannerStore().getRoutines() }; } catch(e) { return { success: true, data: [] }; } },
  'planner-save-routines': (p) => { services.plannerStore().saveRoutines(p.items); return { success: true }; },
  'planner-get-global-todos': () => { try { return { success: true, data: services.plannerStore().getGlobalTodos() }; } catch(e) { return { success: true, data: [] }; } },
  'planner-save-global-todos': (p) => { services.plannerStore().saveGlobalTodos(p.items); return { success: true }; },
  'planner-get-date-settings': () => { try { return { success: true, data: services.plannerStore().getDateSettings() }; } catch(e) { return { success: true, data: {} }; } },
  'planner-save-date-settings': (p) => { services.plannerStore().saveDateSettings(p.settings); return { success: true }; },

  /* ── 에디터 상태 ── */
  'editor-state-get': (p) => { try { return { success: true, data: services.editorStateStore().get(p.namespace, p.slot) }; } catch(e) { return { success: true, data: null }; } },
  'editor-state-save': (p) => { services.editorStateStore().save(p.namespace, p.slot, p.data); return { success: true }; },
  'editor-state-delete': (p) => { services.editorStateStore().delete(p.namespace, p.slot); return { success: true }; },

  /* ── 설문 워크스페이스 ── */
  'survey-get-workspace': () => { try { return { success: true, data: services.surveyStore().getWorkspace() }; } catch(e) { return { success: true, data: {} }; } },
  'survey-save-workspace': (p) => { services.surveyStore().saveWorkspace(p.patch); return { success: true }; },
  'survey-save-draft': (p) => { services.surveyStore().saveDraft(p.draft); return { success: true }; },
  'survey-save-path': (p) => { services.surveyStore().savePath(p.path); return { success: true }; },
  'survey-get-default-draft-sync': (p) => ({ success: true, data: services.surveyDefinition().getDefaultDraft(p.schoolName, p.year) }),

  /* ── 가정통신문 ── */
  'newsletter-list-get': () => { try { return { success: true, data: services.newsletterStore().list() }; } catch(e) { return { success: true, data: [] }; } },
  'newsletter-create': (p) => { try { return services.newsletterStore().create(p.name, p.data); } catch(e) { return { success: false, error: e.message }; } },
  'newsletter-update': (p) => { try { return services.newsletterStore().update(p.id, p.data); } catch(e) { return { success: false, error: e.message }; } },
  'newsletter-rename': (p) => { try { return services.newsletterStore().rename(p.id, p.name); } catch(e) { return { success: false, error: e.message }; } },
  'newsletter-duplicate': (p) => { try { return services.newsletterStore().duplicate(p.id); } catch(e) { return { success: false, error: e.message }; } },
  'newsletter-delete': (p) => { try { return services.newsletterStore().delete(p.id); } catch(e) { return { success: false, error: e.message }; } },
  'newsletter-load': (p) => { try { return services.newsletterStore().load(p.id); } catch(e) { return { success: false, error: e.message }; } },
  'newsletter-render-html': (p) => { try { return services.newsletterRender().renderHtml(p.state, p.options); } catch(e) { return { success: false, error: e.message }; } },

  /* ── JSON 파일 저장/로드 ── */
  'json-save': (p) => { try { return services.jsonFile().save(p.key, p.data); } catch(e) { return { success: false, error: e.message }; } },
  'json-load': (p) => { try { return services.jsonFile().load(p.key, p.year); } catch(e) { return { success: true, data: null }; } },
  'json-save-common': (p, ctx) => {
    try {
      /* 개인 키 격리 — JSON 파일(<dataDir>/<key>.json) 도 사용자별 분리. */
      const { isWebClient, userId } = _resolveUserContext(ctx);
      if (_isPersonalKey('common', p.key) && isWebClient && !userId) {
        return { success: false, error: 'login_required_for_personal_key' };
      }
      const realKey = _scopePersonalKey('common', p.key, userId);
      return services.jsonFile().saveCommon(realKey, p.data);
    } catch(e) { return { success: false, error: e.message }; }
  },
  'json-load-common': (p, ctx) => {
    try {
      const { isWebClient, userId } = _resolveUserContext(ctx);
      if (_isPersonalKey('common', p.key) && isWebClient && !userId) {
        return { success: true, exists: false, data: null };
      }
      const realKey = _scopePersonalKey('common', p.key, userId);
      return services.jsonFile().loadCommon(realKey);
    } catch(e) { return { success: true, data: null }; }
  },
  'json-flush': (p) => { try { return services.jsonFile().flush(p.items); } catch(e) { return { success: false, error: e.message }; } },

  /* ── 오늘의 메모 (today_memos, DB v4) — main.js 핸들러와 패리티. 일지처럼 학교 공유 데이터라 사용자 격리 없음 (2026-06-10) ── */
  'today-memo-get-all': () => { try { return { success: true, data: healthDB.getTodayMemosAll() }; } catch(e) { return { success: false, error: e.message }; } },
  'today-memo-set': (p) => { try { return { success: true, ...healthDB.setTodayMemo(p.date, p.cells) }; } catch(e) { return { success: false, error: e.message }; } },

  /* 양식 xlsx 매핑 데이터 (사용자 요청 2026-05-27) — main.js 'templates-load-med-sym-matching' 의 web bridge */
  'templates-load-med-sym-matching': () => {
    try {
      const path = require('path');
      const fs = require('fs');
      const XLSX = require('xlsx');
      const candidates = [
        path.join(__dirname, '..', 'templates', 'forms', 'symptom_medicine_matching.xlsx'),
        path.join(process.cwd(), 'templates', 'forms', 'symptom_medicine_matching.xlsx'),
      ];
      let buf = null;
      for (const p of candidates) {
        try { if (fs.existsSync(p)) { buf = fs.readFileSync(p); break; } } catch (_) {}
      }
      if (!buf) return { success: false, error: 'symptom_medicine_matching.xlsx 파일을 찾을 수 없습니다.' };
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const map = {};
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const name = String(r[0] || '').trim();
        if (!name) continue;
        const syms = [];
        for (let c = 2; c <= 5; c++) {
          const s = String(r[c] || '').trim();
          if (s) syms.push(s);
        }
        if (syms.length) map[name] = syms;
      }
      return { success: true, data: map };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /* ── DB key-value ──
     주의: ServiceContainer 의 메서드 이름은 store() / 응답 shape 는 {exists, data}.
     main.js 의 ipcMain.handle('db-get') 과 동일하게 ...spread 로 풀어 넣어야
     렌더러 측 app-data-bridge 가 dbRes.exists 로 분기 가능. */
  'db-get': (p, ctx) => {
    try {
      /* 개인 키 격리 — common scope 의 vp_stamps 등은 사용자별로 분리.
       * 웹 클라이언트가 로그인 안 한 상태로 개인 키 읽기 시도하면 빈 결과 반환 (호스트 자료 노출 방지). */
      const { isWebClient, userId } = _resolveUserContext(ctx);
      if (_isPersonalKey(p.scope, p.key) && isWebClient && !userId) {
        return { success: true, exists: false, data: null };
      }
      const realKey = _scopePersonalKey(p.scope, p.key, userId);
      return { success: true, ...services.store().get(p.scope, realKey, p.year) };
    } catch(e) { return { success: false, error: e.message, exists: false, data: null }; }
  },
  'db-set': (p, ctx) => {
    try {
      const { isWebClient, userId } = _resolveUserContext(ctx);
      /* 웹 클라이언트 미로그인 상태에서 개인 키 쓰기 시도 → 거부 (호스트 자료 덮어쓰기 방지) */
      if (_isPersonalKey(p.scope, p.key) && isWebClient && !userId) {
        return { success: false, error: 'login_required_for_personal_key' };
      }
      const realKey = _scopePersonalKey(p.scope, p.key, userId);
      return { success: true, ...services.store().set(p.scope, realKey, p.value, p.year) };
    } catch(e) { return { success: false, error: e.message }; }
  },
  'db-batch-set': (p, ctx) => {
    try {
      const { isWebClient, userId } = _resolveUserContext(ctx);
      const filtered = (p.items || []).filter(it => {
        /* 웹 클라이언트 미로그인 → 개인 키 항목 제거 (배치 중 일부만 거부) */
        if (_isPersonalKey(it.scope, it.key) && isWebClient && !userId) return false;
        return true;
      });
      const mapped = filtered.map(it => Object.assign({}, it, { key: _scopePersonalKey(it.scope, it.key, userId) }));
      return { success: true, ...services.store().batchSet(mapped) };
    } catch(e) { return { success: false, error: e.message }; }
  },
  'db-info': () => ({ success: true, dbPath: healthDB.dbPath }),
  /* 공장 초기화 — 모든 테이블 데이터 삭제 (스키마/테이블 유지, users 보존) */
  'db-factory-reset': () => {
    try { return healthDB.factoryReset(); }
    catch(e) { return { success: false, error: e.message }; }
  },
  /* 보건일지·기록만 초기화 (인원 데이터 보존) */
  'db-factory-reset-health-only': () => {
    try { return healthDB.factoryResetHealthRecordsOnly(); }
    catch(e) { return { success: false, error: e.message }; }
  },
  'db-export-backup': () => { try { return services.store().exportBackup(); } catch(e) { return { success: false, error: e.message }; } },
  'db-import-backup': (p) => { try { return services.store().importBackup(p.backup); } catch(e) { return { success: false, error: e.message }; } },

  /* ── 과거 기록 ── */
  'past-history-search': (p) => ({ success: true, data: services.pastHistory().search(p.params) }),
  'past-history-stats': () => ({ success: true, data: services.pastHistory().getStats() }),
  'past-history-exists': () => ({ success: true, data: services.pastHistory().exists() }),
  'past-history-auto-match': (p) => {
    const yr = String(p.currentYear || require('../src/main/services/database').HealthDiaryDB.academicYear()); /* 명단=학년도(3/1) */
    const sl = p.schoolLevel || 'elementary';
    const students = services.peopleDB().getAll(yr) || [];
    let staff = [];
    try { staff = services.staffDB().getAll(yr) || []; } catch (_) {}
    const people = students.concat(staff);
    return { success: true, data: services.pastHistory().autoMatch(people, yr, sl) };
  },
  'past-history-resolve-ambiguous': (p) => { services.pastHistory().resolveAmbiguous(p.recordIds, p.studentId); return { success: true }; },
  'past-history-get-ambiguous': () => ({ success: true, data: services.pastHistory().getAmbiguous() }),
  'past-history-apply': () => ({ success: true, data: services.pastHistory().applyToDaily() }),
  'past-history-migrate-placeholders': () => ({ success: true, data: services.pastHistory().migratePlaceholdersToGhosts() }),
  'past-history-delete-imported': () => ({ success: true, data: services.pastHistory().deleteImported() }),
  'past-history-clear-staging': () => ({ success: true, data: services.pastHistory().clearStaging() }),
  'past-history-revert-just-inserted': (p) => ({ success: true, data: services.pastHistory().revertJustInserted((p&&p.ids)||[]) }),
  'past-history-list-placeholders': () => ({ success: true, data: services.pastHistory().listPlaceholderImports() }),
  'past-history-match-placeholder': (p) => {
    const result = services.pastHistory().matchPlaceholderToPerson((p&&p.recordId), (p&&p.personUid));
    return { success: !!(result && result.matched), data: result };
  },
  'past-history-delete-placeholder': (p) => ({ success: true, data: services.pastHistory().deletePlaceholderImport((p&&p.recordId)) }),
  'past-history-delete-staging-row': (p) => ({ success: true, data: services.pastHistory().deleteStagingRow((p&&p.stagingId)) }),
  'past-history-revert-matched': () => ({ success: true, data: services.pastHistory().revertMatchedToUnmatched() }),
  'past-history-placeholder-as-leaver': (p) => {
    const result = services.pastHistory().placeholderAsLeaver((p&&p.recordId));
    return result && result.success ? result : { success: false, error: (result && result.error) || 'unknown' };
  },
  'past-history-staging-row-as-leaver': (p) => {
    const result = services.pastHistory().stagingRowAsLeaver((p&&p.stagingId));
    return result && result.success ? result : { success: false, error: (result && result.error) || 'unknown' };
  },
  'past-history-imported-count': () => ({ success: true, data: services.pastHistory().getImportedCountThisYear() }),
  'past-history-match-stats': () => ({ success: true, data: services.pastHistory().getMatchStats() }),
  'past-history-get-by-date': (p) => ({ success: true, data: services.pastHistory().getByDate(p.date) }),

  /* ── 잠복결핵 ── */
  'tb-test-add': (p) => ({ success: true, data: services.tbTest().addOne(p) }),
  'tb-test-search': (p) => ({ success: true, data: services.tbTest().search(p) }),
  'tb-test-get-all': () => ({ success: true, data: services.tbTest().getAll() }),
  'tb-test-stats': () => ({ success: true, data: services.tbTest().getStats() }),
  'tb-test-delete': (p) => { services.tbTest().deleteOne(p.id || p); return { success: true }; },

  /* ── 사전공개 Beta 만료 정보 (Electron IPC 미러) ──
   *  main.js 의 BETA_EXPIRES_AT / BETA_BLOCK_AT 와 동일 상수 (두 날짜 정책).
   *  Electron 단독 사용자는 IPC 로 받아오지만 웹 클라이언트(동료)는 이 핸들러를 거친다.
   *  expiresAt/daysLeft : 표시용 (배지 "남은 일수")
   *  expired            : 실제 차단 여부 (BETA_BLOCK_AT 기준, 모달+검색 락 트리거) */
  'beta-expiry-info': () => {
    const BETA_EXPIRES_AT = '2026-05-31';
    const BETA_BLOCK_AT   = '2026-06-07';
    const today = new Date();
    const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    const t0 = new Date(todayStr+'T00:00:00');
    const e0 = new Date(BETA_EXPIRES_AT+'T00:00:00');
    const b0 = new Date(BETA_BLOCK_AT+'T00:00:00');
    const daysLeft = Math.floor((e0 - t0) / 86400000);
    const blockDaysLeft = Math.floor((b0 - t0) / 86400000);
    return { expiresAt: BETA_EXPIRES_AT, daysLeft, expired: blockDaysLeft < 0 };
  },

  /* ── 외부 API (서버 사이드 프록시) ── */
  'weather-ip-location': async () => {
    /* global fetch (Node 18+) */
    const res = await fetch('https://ipwho.is/');
    return await res.json();
  },
  'external-fetch-json': async (p) => {
    /* Electron과 동일한 success/data 계약 유지. HTTP 상태는 호출부에서 판별한다. */
    try {
      if (!p.url) return { success: false, error: 'URL이 없습니다' };
      let parsed;
      try { parsed = new URL(p.url); } catch { return { success: false, error: '유효하지 않은 URL' }; }
      if (parsed.protocol !== 'https:') return { success: false, error: 'HTTPS 프로토콜만 허용됩니다' };
      const host = parsed.hostname.toLowerCase();
      if (['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(host) || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) {
        return { success: false, error: '내부 네트워크 접근이 차단되었습니다' };
      }
      const res = await fetch(p.url, { headers: { 'User-Agent': 'OrangePharmDiary/1.0' }, signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      return { success: true, data: text, status: res.status, contentType: res.headers.get('content-type') || '' };
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      /* 오류 원문에는 인증키가 포함된 URL이 있을 수 있으므로 전달하지 않는다. */
      return {
        success: false,
        error: timedOut ? '외부 데이터 요청 시간이 초과되었습니다.' : '외부 데이터 서버에 연결하지 못했습니다.',
        errorKind: timedOut ? 'timeout' : 'network'
      };
    }
  },
  /* NEIS(급식·학사일정·시간표) — 클라이언트가 자기 NEIS 키 없으면 호스트 NEIS 키로 폴백 (다른 API 와 동일 정책, 2026-07-02) */
  'external-fetch-neis': async (p) => {
    try {
      let u = String(p.url || '');
      const m = u.match(/([?&]KEY=)([^&]*)/);
      if (!m || !m[2]) {
        const hostKey = _withFallback('', 'neis_api_key');
        if (hostKey) {
          u = m ? u.replace(/([?&]KEY=)([^&]*)/, '$1' + encodeURIComponent(hostKey))
                : u + (u.indexOf('?') >= 0 ? '&' : '?') + 'KEY=' + encodeURIComponent(hostKey);
        }
      }
      return await handlers['external-fetch-json']({ url: u });
    } catch (e) { return { success: false, error: e.message || String(e) }; }
  },
  'external-fetch-url-title': async (p) => {
    /* global fetch (Node 18+) */
    const res = await fetch(p.url);
    const html = await res.text();
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return { success: true, title: m ? m[1].trim() : '' };
  },

  /* ── 파일 시스템 ── */
  'open-external': (p) => ({ success: true, url: p.url || p }),
  'get-default-save-path': () => path.join(deps.userDataPath, 'exports'),
  'choose-directory': () => ({ canceled: false, filePaths: [path.join(deps.userDataPath, 'exports')] }),
  'save-file': (p) => {
    const savePath = p.filePath || path.join(deps.userDataPath, 'exports', 'file');
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (typeof p.data === 'string') fs.writeFileSync(savePath, p.data, 'utf8');
    else if (p.data && p.data.type === 'Buffer') fs.writeFileSync(savePath, Buffer.from(p.data.data));
    else fs.writeFileSync(savePath, JSON.stringify(p.data));
    return { success: true, downloadUrl: '/api/download?path=' + encodeURIComponent(savePath) };
  },
  'read-file': (p) => {
    let filePath = p.filePath;
    if (!filePath) return { success: false, error: '파일 없음' };
    /* __app__/ 접두어 → 앱 루트 디렉토리로 변환 */
    if (filePath.startsWith('__app__/')) filePath = path.join(electronRoot, filePath.replace('__app__/', ''));
    if (!fs.existsSync(filePath)) return { success: false, error: '파일 없음: ' + filePath };
    const ext = path.extname(filePath).toLowerCase();
    if (['.png','.jpg','.jpeg','.gif','.webp','.pdf','.xlsx','.xls','.zip'].includes(ext)) {
      return { success: true, data: fs.readFileSync(filePath).toString('base64'), binary: true };
    }
    return { success: true, data: fs.readFileSync(filePath, 'utf8') };
  },
  'get-user-data-path': () => deps.userDataPath,
  'capture-element': () => ({ success: true, useClientSide: true }),
  'capture-to-png': () => ({ success: true, useClientSide: true }),
  'clipboard-write-html': () => ({ success: true }),
  'print-to-pdf': () => ({ success: true, useClientSide: true }),
  /* 2단계 PDF (2026-08-12) — 웹 변형은 web-api-bridge 가 printToPDFGenerate/Save 를 노출하지 않아
   * 렌더러가 단일 printToPDF(클라이언트측) 경로로 폴백함. 패리티 원칙상 채널만 등록해 둠. */
  'print-to-pdf-generate': () => ({ success: true, useClientSide: true }),
  'print-to-pdf-save': () => ({ success: true, useClientSide: true }),
  'print-window-with-size': () => ({ success: true, useClientSide: true }),
  'move-window': () => ({ success: true }),
  'open-main': () => ({ success: true }),
  'kiosk-preview-in-browser': () => ({ success: true, useClientSide: true }),
  'list-files': (p) => {
    try {
      const dirPath = p.dirPath;
      if (!dirPath || !fs.existsSync(dirPath)) return { success: true, data: [] };
      let files = fs.readdirSync(dirPath);
      if (p.ext) files = files.filter(f => f.endsWith(p.ext));
      return { success: true, data: files.map(f => ({ name: f, path: path.join(dirPath, f) })) };
    } catch(e) { return { success: true, data: [] }; }
  },
  'ensure-survey-folder': (p) => {
    const surveyDir = path.join(deps.userDataPath, 'surveys', p.surveyKey || p);
    if (!fs.existsSync(surveyDir)) fs.mkdirSync(surveyDir, { recursive: true });
    return { success: true, path: surveyDir };
  },
  'open-path': () => ({ success: true }),
  'get-local-ip': () => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
    return '127.0.0.1';
  },
  'get-med-cache': () => ({}),
  'kiosk-ws-start': () => ({ success: true }),
  'kiosk-ws-stop': () => ({ success: true }),
  'kiosk-ws-broadcast': () => ({ success: true }),
  'kiosk-ws-status': () => ({ running: false, clients: 0 }),

  /* ── DB 백업/복원 ── */
  'db-backup-sqlite': () => {
    try {
      healthDB.db.pragma('wal_checkpoint(TRUNCATE)');
      const backupDir = path.join(deps.userDataPath, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const fileName = '오렌지_보건일지_백업_' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '.sqlite3';
      const backupPath = path.join(backupDir, fileName);
      fs.copyFileSync(healthDB.dbPath, backupPath);
      return { success: true, downloadUrl: '/api/download?path=' + encodeURIComponent(backupPath), fileName };
    } catch(e) { return { success: false, error: e.message }; }
  },
  'db-restore-sqlite': () => ({ success: true, needsUpload: true }),

  /* 커스텀 백업과 반영 (학교 이동용) — 웹 변형은 파일시스템 다이얼로그가 없으므로 동작 안 함.
   *  웹 클라이언트에서는 호스트 PC 에서 직접 사용하도록 안내. */
  'custom-backup-list-keys': () => ({ success: true, data: services.customBackup().getKeys() }),
  'custom-backup-export': () => ({ success: false, error: '웹 변형에서는 호스트 PC 에서 사용하세요.' }),
  'custom-backup-import': () => ({ success: false, error: '웹 변형에서는 호스트 PC 에서 사용하세요.' }),

  /* ── 엑셀/DB 파일 가져오기 (파일은 /api/upload로 먼저 업로드) ── */
  'choose-sqlite-file': () => ({ success: true, needsUpload: true }),
  'import-existing-db': (p) => {
    try {
      if (!p.filePath || !fs.existsSync(p.filePath)) return { success: false, error: '파일 없음' };
      const Database = require('better-sqlite3');
      const testDb = new Database(p.filePath, { readonly: true });
      const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
      testDb.close();
      if (!tables.includes('students') && !tables.includes('daily_records')) return { success: false, error: '유효한 보건일지 DB가 아닙니다.' };
      /* DB 교체 */
      healthDB.db.pragma('wal_checkpoint(TRUNCATE)');
      const bakPath = healthDB.dbPath + '.pre-restore.' + Date.now() + '.bak';
      fs.copyFileSync(healthDB.dbPath, bakPath);
      fs.copyFileSync(p.filePath, healthDB.dbPath);
      return { success: true, data: { tables }, message: '서버를 재시작해야 반영됩니다.' };
    } catch(e) { return { success: false, error: e.message }; }
  },
  'import-past-history-xlsx': (p) => {
    try { return { success: true, data: services.pastHistory().importFromXlsx(p.filePath) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'tb-test-import-xlsx': (p) => {
    try { return { success: true, data: services.tbTest().importFromXlsx(p.filePath) }; }
    catch(e) { return { success: false, error: e.message }; }
  },

  /* ── Google 인증 ── */
  'google-login': () => {
    /* 브릿지에서 /auth/google/start로 리다이렉트하므로 여기는 상태 확인용 */
    if (_authState && _userInfo) return { success: true, user: _userInfo };
    return { success: false, error: 'redirect', redirectUrl: '/auth/google/start' };
  },
  'get-user-info': () => _userInfo,
  'auth-config-status': () => {
    const cfg = _loadOAuthConfig();
    return { hasConfig: !!(cfg && cfg.clientId), source: cfg ? 'file' : 'none' };
  },
  'logout': () => {
    _authState = null; _userInfo = null;
    try { fs.unlinkSync(authTokenFile); } catch(_) {}
    return { success: true };
  },

  /* ── Sheets 전용 계정 ── */
  'sheets-login': () => {
    if (_sheetsAuthState && _sheetsUserInfo) return { success: true, user: _sheetsUserInfo };
    return { success: false, error: 'redirect', redirectUrl: '/auth/google/start?account=sheets' };
  },
  'sheets-get-user': () => _sheetsUserInfo,
  'sheets-logout': () => { _sheetsAuthState = null; _sheetsUserInfo = null; try { fs.unlinkSync(sheetsTokenFile); } catch(_) {} return { success: true }; },
  'sheets-use-main': () => { _sheetsAuthState = null; _sheetsUserInfo = null; try { fs.unlinkSync(sheetsTokenFile); } catch(_) {} return { success: true }; },

  /* ── Google Sheets API ── */
  'sheets-read': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await readSheet(token, p.spreadsheetId, p.range) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'sheets-write': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await writeSheet(token, p.spreadsheetId, p.range, p.values) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'sheets-create': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await createSpreadsheet(token, p.title, p.sheetTitle) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'sheets-batch-update': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await batchUpdateSpreadsheet(token, p.spreadsheetId, p.requests) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'sheets-metadata': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await getSheetMetadata(token, p.spreadsheetId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'sheets-export-job': async (p) => {
    /* Electron main 과 동일한 응답 포맷: { success, spreadsheetId, spreadsheetUrl, ... } */
    try {
      const result = await services.workspaceExport().runExportJob(p.job || {});
      return { success: true, ...result };
    } catch(e) { return { success: false, error: e.message }; }
  },

  /* ── Google Drive API ── */
  'drive-list-folders': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await driveListFolders(token, p.parentId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'drive-create-folder': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await driveCreateFolder(token, p.name, p.parentId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'drive-move-file': async (p) => {
    try { const token = await _getSheetsToken(); return { success: true, data: await driveMoveFile(token, p.fileId, p.newParentId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'drive-sync-upload': async (p) => {
    try { return { success: true, data: await services.driveSync().upload(p.fileName, p.jsonContent, p.folderId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'drive-sync-download': async (p) => {
    try { return { success: true, data: await services.driveSync().download(p.fileName, p.folderId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },

  /* ── Google Calendar API ── */
  'calendar-list': async () => {
    try { const token = await _getMainToken(); return { success: true, data: await listCalendars(token) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'calendar-events': async (p) => {
    try { const token = await _getMainToken(); return { success: true, data: await listEvents(token, p.calendarId, p.options) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'calendar-create': async (p) => {
    try { const token = await _getMainToken(); return { success: true, data: await createEvent(token, p.calendarId, p.eventBody) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'calendar-update': async (p) => {
    try { const token = await _getMainToken(); return { success: true, data: await updateEvent(token, p.calendarId, p.eventId, p.eventBody) }; }
    catch(e) { return { success: false, error: e.message }; }
  },
  'calendar-delete': async (p) => {
    try { const token = await _getMainToken(); return { success: true, data: await deleteEvent(token, p.calendarId, p.eventId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },

  /* ── 가정통신문 PDF (HTML은 서버, PDF 변환은 클라이언트) ── */
  'newsletter-render-merge-pdf-html': (p) => {
    try { return services.newsletterRender().buildMergePdfHtml(p.state, p.options); }
    catch(e) { return { success: false, error: e.message }; }
  },
  'newsletter-export-pdf': (p) => {
    /* 서버에서 HTML 생성, 클라이언트에서 PDF 변환 */
    try {
      const htmlResult = services.newsletterRender().buildMergePdfHtml(p.state, p.options);
      return { success: true, html: htmlResult.html || htmlResult, useClientSide: true };
    } catch(e) { return { success: false, error: e.message }; }
  },

  /* ── 플래너 + 캘린더 ── */
  'planner-fetch-month-events': async (p) => {
    try { return { success: true, data: await services.plannerCalendar().loadMonthBundle(p.date) }; }
    catch(e) { return { success: true, data: [] }; }
  },
  'planner-create-todo-event': async (p) => {
    try { return { success: true, data: await services.plannerCalendar().createAllDayTodo(p.calendarId, p.date, p.summary, p.colorId) }; }
    catch(e) { return { success: false, error: e.message }; }
  },

  /* ── 의료기관 탐색 — 동료 협업/원격(클라이언트) 모드 ──
     클라이언트(브라우저)는 호스트의 localhost:7700 서버에 접근할 수 없고,
     카카오맵 SDK 도 *호스트가 아닌 origin* 에서는 도메인 검사로 차단되므로
     카카오 SDK 가 없는 카드 리스트 화면(/med-facility-list.html)으로 라우팅한다.
     - 카카오 키워드 검색 REST + 심평원 + 응급의료 결과를 카드 리스트로 표시
     - 카드 클릭 시 카카오맵 공식 사이트(map.kakao.com)를 새 탭으로 열어 자세히 보기
     - REST API 만 사용 (서버사이드 호출, 카카오 도메인 검사 무관) */
  'open-med-facility': (p) => {
    /* 클라이언트(웹 브라우저) 는 카카오맵 JS SDK 의 도메인 검사를 통과할 수 없으므로
     * 인터랙티브 지도가 없는 카드 리스트 페이지로 무조건 라우팅한다.
     * REST 키는 호스트 blob 폴백 — 카카오 REST API 는 origin 검사가 없어 호스트 키로 정상 동작. */
    const kakaoRest = _withFallback(p.kakaoRestKey, 'kakao_rest_api_key');
    if (!kakaoRest) {
      return { success: false, error: '카카오 REST API 키가 등록되지 않았습니다. 호스트(또는 공용) PC 의 설정 → API 키 관리에서 카카오 REST API 키를 먼저 등록하고 카카오 어플리케이션의 카카오맵 서비스를 활성화(ON) 해 주세요.' };
    }
    const hira = _withFallback(p.hiraKey, 'hira_api_key');
    const emg = _withFallback(p.emergencyKey, 'emergency_api_key');
    const schoolAddr = _withFallback(p.schoolAddr, 'school_address');
    const schoolLat = _withFallback((p.schoolLat == null || p.schoolLat === '') ? '' : String(p.schoolLat), 'school_lat');
    const schoolLng = _withFallback((p.schoolLng == null || p.schoolLng === '') ? '' : String(p.schoolLng), 'school_lng');
    const params = new URLSearchParams({
      school: p.schoolName || '',
      edu: p.eduOffice || '',
      hira: hira,
      emg: emg,
      addr: schoolAddr,
      mode: p.mode || '',
      kakaoRest: kakaoRest,
      lat: schoolLat,
      lng: schoolLng,
    });
    return { success: true, openUrl: '/med-facility-list.html?' + params.toString() };
  },

  /* ── 키오스크 릴레이 (서버→서버 HTTP) ── */
  'kiosk-create-channel': async (p) => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch((p.relayUrl || 'https://relay.school114.org') + '/api/v1/admin/channel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_name: p.schoolName || '', education_office: p.educationOffice || '' })
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },
  'kiosk-channel-status': async (p) => {
    try {
      /* global fetch (Node 18+) — 채널 생존 확인 (평일 10일+ 미사용 폐기 대응, 2026-06-15) */
      const res = await fetch((p.relayUrl || 'https://relay.school114.org') + '/api/v1/kiosk/status/' + p.channelId, {
        method: 'GET', signal: AbortSignal.timeout(5000)
      });
      const j = await res.json();
      return { ok: true, exists: !!(j && j.exists) };
    } catch (e) { return { ok: false, exists: false, error: e.message }; }
  },
  'kiosk-push-config': async (p) => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch(p.relayUrl + '/api/v1/kiosk/config/' + p.channelId, {
        method: 'PUT', headers: { 'Authorization': 'Bearer ' + p.authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(p.config)
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },
  'kiosk-push-access-key': async (p) => {
    try {
      /* global fetch (Node 18+) — 키오스크 접속 인증키 설정/해제 (2026-06-12) */
      const res = await fetch(p.relayUrl + '/api/v1/kiosk/access-key/' + p.channelId, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + p.authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: String(p.accessKey || '') }),
        signal: AbortSignal.timeout(8000)
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },
  'kiosk-upload-html': async (p) => {
    try {
      /* global fetch (Node 18+) — 키오스크 HTML 업로드 (URL 접속 방식, 2026-06-12). 10MB+ 가능 → 60s */
      const res = await fetch(p.relayUrl + '/api/v1/kiosk/html/' + p.channelId, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + p.authToken, 'Content-Type': 'text/html; charset=utf-8' },
        body: String(p.html || ''),
        signal: AbortSignal.timeout(60000)
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },
  'kiosk-test-relay': async (p) => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch(p.relayUrl + '/health', { signal: AbortSignal.timeout(5000) });
      const data = await res.json().catch(() => null);
      return { ok: !!(data && data.ok), success: true };
    } catch (e) { return { ok: false, success: false, error: e.message }; }
  },
  'kiosk-get-receptions': async (p) => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch(p.relayUrl + '/api/v1/nurse/receptions/' + p.channelId, {
        headers: { 'Authorization': 'Bearer ' + p.nurseToken }
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },
  'kiosk-complete-reception': async (p) => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch(p.relayUrl + '/api/v1/nurse/receptions/' + p.channelId + '/' + p.receptionId + '/complete', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + p.nurseToken }
      });
      return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
  },

  /* ── 외부 API 프록시 ── */
  'weather-reverse-geocode': async (p) => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${p.lat}&lon=${p.lon}&accept-language=ko`);
      return await res.json();
    } catch(e) { return { error: e.message }; }
  },
  'weather-openmeteo': async (p) => {
    try {
      const [weather, air] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Asia/Seoul&forecast_days=1`).then(r=>r.json()),
        fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=pm10,pm2_5&hourly=pm10,pm2_5&timezone=Asia/Seoul&forecast_days=1`).then(r=>r.json()).catch(()=>null)
      ]);
      return { success: true, data: { weather, airQuality: air } };
    } catch(e) { return { success: false, error: e.message }; }
  },
  'external-fetch-exchange': async () => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      return await res.json();
    } catch(e) { return { error: e.message }; }
  },
  'external-fetch-infectious': async () => {
    try {
      /* global fetch (Node 18+) */
      const res = await fetch('https://ncov.kdca.go.kr/bdBoardList_Real.do');
      const html = await res.text();
      return { success: true, html };
    } catch(e) { return { success: false, error: e.message }; }
  },
  'external-fetch-public-sheet-csv': async (p) => {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${p.spreadsheetId}/export?format=csv`;
      const res = await fetch(url);
      return { success: true, data: await res.text() };
    } catch(e) { return { success: false, error: e.message }; }
  },

  /* ── 기상청 / 에어코리아 (서버 프록시) ──
   *  키 폴백: 동료 PC 가 빈 키 보내도 호스트의 저장된 키로 호출. */
  'weather-kma': async (p) => {
    try {
      const KEY = _withFallback(p.apiKey, 'kma_api_key');
      return { success: true, data: await services.weather().getKmaWeather(KEY, p.lat, p.lon) };
    }
    catch(e) { return { success: false, error: e.message }; }
  },
  'weather-uv-kma': async (p) => {
    try {
      const KEY = _withFallback(p.kmaKey, 'uv_api_key') || _withFallback('', 'kma_api_key');
      const restKey = _withFallback(p.kakaoRestKey, 'kakao_rest_api_key');
      return { success: true, data: await services.weather().getKmaUvByCoord(KEY, restKey, p.lat, p.lon) };
    }
    catch(e) { return { success: false, error: e.message }; }
  },
  'external-fetch-airkorea': async (p) => {
    try {
      /* 키·측정소 모두 호스트 blob 폴백 — 동료가 본인 PC localStorage 에 키·측정소
       * 입력 안 하고 빈 값으로 보내도 호스트가 등록한 값으로 호출 보장. */
      const KEY = _withFallback(p.serviceKey, 'airkorea_api_key');
      const STN = _withFallback(p.stationName, 'airkorea_station');
      return await services.externalApi().fetchAirkorea(KEY, STN);
    }
    catch(e) { return { success: false, error: e.message }; }
  },
  'external-fetch-stock': async (p) => {
    try { const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(p.ticker)); return await res.json(); }
    catch(e) { return { error: e.message }; }
  },
  'external-fetch-drug-info': async (p) => {
    /* Electron 메인 서비스와 동일한 퍼지 매칭/에러 파싱 재사용 */
    try {
      const KEY = _withFallback(p.serviceKey, 'drug_api_key');
      return await services.externalApi().fetchDrugInfo(KEY, p.drugName);
    }
    catch(e) { return { success:false, error:e.message }; }
  },
  'external-search-drug-list': async (p) => {
    /* 약품 검색 팝업 자동완성 — e약은요 매칭 후보 50개. 키 폴백 동일. */
    try {
      const KEY = _withFallback(p.serviceKey, 'drug_api_key');
      return await services.externalApi().searchDrugList(KEY, p.query);
    }
    catch(e) { return { success:false, error:e.message }; }
  },
  'external-fetch-med-facilities': async (p) => {
    try {
      const KEY = _withFallback(p.serviceKey, 'hira_api_key');
      return await services.externalApi().fetchMedFacilities(KEY, p.params);
    }
    catch(e) { return { success:false, error:e.message }; }
  },
  'external-fetch-emergency': async (p) => {
    try {
      const KEY = _withFallback(p.serviceKey, 'emergency_api_key');
      return await services.externalApi().fetchEmergencyInfo(KEY, p.params);
    }
    catch(e) { return { success:false, error:e.message }; }
  },
  'external-fetch-emergency-detail': async (p) => {
    try {
      const KEY = _withFallback(p.serviceKey, 'emergency_api_key');
      const results = await Promise.all(p.hpids.map(id => services.externalApi().fetchEmergencyDetail(KEY, id)));
      return { success:true, data: results.filter(r => r) };
    }
    catch(e) { return { success:false, error:e.message }; }
  },
  /* ── Kakao REST API 프록시 ──
   *  키 우선순위: 렌더러가 보낸 p.apiKey > 서버 blob 의 kakao_rest_api_key.
   *  웹 클라이언트(동료 PC) 의 localStorage 동기화 race 상황에서도 동작 보장. */
  'kakao-keyword-search': async (p) => {
    try {
      const KEY = _withFallback(p.apiKey, 'kakao_rest_api_key');
      if (!KEY) return { success: false, error: 'Kakao REST API 키가 설정되지 않았습니다.' };
      let url = 'https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(p.query||'') + '&size=15&page=' + (p.page||1);
      if (p.x && p.y) { url += '&x=' + p.x + '&y=' + p.y + '&sort=distance'; if (p.radius) url += '&radius=' + p.radius; }
      const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + KEY } });
      const data = await res.json();
      return { success: true, data: data.documents || [], meta: data.meta || {} };
    } catch (err) { return { success: false, error: err.message }; }
  },
  'kakao-address-search': async (p) => {
    try {
      const KEY = _withFallback(p.apiKey, 'kakao_rest_api_key');
      if (!KEY) return { success: false, error: 'Kakao REST API 키가 설정되지 않았습니다.' };
      const url = 'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(p.query||'') + '&size=5';
      const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + KEY } });
      const data = await res.json();
      return { success: true, data: data.documents || [] };
    } catch (err) { return { success: false, error: err.message }; }
  },
  'kakao-category-search': async (p) => {
    try {
      const KEY = _withFallback(p.apiKey, 'kakao_rest_api_key');
      if (!KEY) return { success: false, error: 'Kakao REST API 키가 설정되지 않았습니다.' };
      let url = 'https://dapi.kakao.com/v2/local/search/category.json?category_group_code=' + encodeURIComponent(p.category||'') + '&size=15&page=' + (p.page||1);
      if (p.x && p.y) { url += '&x=' + p.x + '&y=' + p.y; if (p.radius) url += '&radius=' + p.radius; url += '&sort=distance'; }
      const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + KEY } });
      const data = await res.json();
      return { success: true, data: data.documents || [], meta: data.meta || {} };
    } catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 앱 라이프사이클 (브라우저 환경에선 의미 없음 — 안전 스텁) ──
   *  Electron 메인은 app.quit / app.relaunch 로 프로세스를 직접 종료/재시작하지만,
   *  웹 모드에서는 브라우저 탭 닫기/새로고침이 사용자 손에 있으므로 success 만 반환. */
  'app-quit': () => ({ success: true }),
  'app-relaunch': () => ({ success: true }),
  'confirm-quit-after-update': () => ({ success: true }),

  /* ── 자동 업데이트 (Electron 전용) ──
   *  electron-updater 는 브라우저에서 동작하지 않음 → 안전 스텁.
   *  updater-get-version 만 package.json 의 version 을 실제로 반환 (헤더 배지/버전 탭 표시용). */
  'updater-get-version': () => {
    try {
      const pkg = require('../package.json');
      return { version: pkg.version || '' };
    } catch (_) { return { version: '' }; }
  },
  'updater-check-now': () => ({ success: false, error: '웹 모드에서는 자동 업데이트를 사용할 수 없습니다.' }),
  'updater-is-ready': () => ({ ready: false, version: '' }),
  'updater-quit-and-install': () => ({ success: false, error: '웹 모드에서는 자동 업데이트를 사용할 수 없습니다.' }),

  /* ── 번들 API 키 — 빌드 시 임베드된 기본값 (api-keys.json → bundled-api-keys.js) ──
   *  첫 실행 시 localStorage 가 비어 있으면 이 값으로 자동 채워진다. */
  'get-bundled-api-keys': () => {
    try {
      const bundledPath = path.join(electronRoot, 'src', 'main', 'services', 'bundled-api-keys.js');
      if (!fs.existsSync(bundledPath)) return {};
      delete require.cache[require.resolve(bundledPath)];
      return require(bundledPath) || {};
    } catch (e) {
      console.warn('[bundled-api-keys] 로드 실패:', e.message);
      return {};
    }
  },

  /* ── 파일 크기 조회 — 설정 → 데이터 백업과 삭제 탭에서 DB/JSON 용량 표시용.
   *  userData 아래의 상대 경로 또는 절대 경로 모두 허용. 존재하지 않으면 size=0 반환. */
  'get-file-size': async (p) => {
    try {
      /* main.js 는 두 번째 인자가 plain string 인 패턴 (event, filePath) 이지만
       * 브릿지는 _ipc('get-file-size', filePath) 호출 → body 가 문자열로 직렬화된다.
       * Express express.json() 은 문자열도 그대로 받으므로 p 가 string 일 수 있음. */
      const filePath = (typeof p === 'string') ? p : (p && (p.filePath || p.path) ? (p.filePath || p.path) : '');
      if (!filePath) return { success: true, size: 0, exists: false };
      let resolved = filePath;
      if (!path.isAbsolute(filePath)) resolved = path.join(deps.userDataPath, filePath);
      if (!fs.existsSync(resolved)) return { success: true, size: 0, exists: false };
      const st = fs.statSync(resolved);
      return { success: true, size: st.size, exists: true, mtime: st.mtimeMs };
    } catch (err) { return { success: false, error: err.message, size: 0 }; }
  },

  /* ── 외부 API — 에어코리아 측정소 정보 ──
   *  렌더러가 측정소명 입력 시 좌표/주소 자동 채움에 사용. 서버측 키 폴백 동일. */
  'external-fetch-airkorea-station-info': async (p) => {
    try {
      const KEY = _withFallback(p.serviceKey, 'airkorea_api_key');
      return await services.externalApi().fetchAirkoreaStationInfo(KEY, p.stationName);
    } catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 의료기관 반경 캐싱 (medfac-*) ──
   *  medfac-bulk-fetch: 반경 내 의료기관/응급실을 대량 캐싱 후 userData/data/medfac_cache.json 으로 저장.
   *  진행률 콜백(event.sender.send)은 REST 환경에선 송신 불가 → progressCb 를 빈 함수로 대체.
   *  최종 결과만 응답으로 회신 (진행률 미표시는 허용되는 열화). */
  'medfac-bulk-fetch': async (p) => {
    try {
      /* 다른 외부 API 핸들러와 동일한 키 폴백 정책 — 동료(웹 클라이언트) 가
       * 빈 키 보내도 호스트의 저장된 hira/emergency 키로 호출 보장. */
      const hira = _withFallback(p.serviceKey, 'hira_api_key');
      const emg  = _withFallback(p.emergencyKey, 'emergency_api_key');
      const res = await services.externalApi().bulkFetchMedFacilitiesInRadius(
        hira, emg, p.params,
        function(_progress){ /* REST 응답엔 진행률을 흘릴 수 없어 무시 */ }
      );
      try {
        const fp = path.join(deps.userDataPath, 'data', 'medfac_cache.json');
        fs.writeFileSync(fp, JSON.stringify(res, null, 2));
        res.savedPath = fp;
      } catch(e) { res.saveError = e.message; }
      return res;
    } catch (err) { return { success: false, error: err.message }; }
  },
  'medfac-load-cache': async () => {
    try {
      const fsp = require('fs').promises;
      const fp = path.join(deps.userDataPath, 'data', 'medfac_cache.json');
      try { await fsp.access(fp); } catch(_) { return { success: true, exists: false }; }
      const [raw, st] = await Promise.all([fsp.readFile(fp, 'utf8'), fsp.stat(fp)]);
      const data = JSON.parse(raw);
      return { success: true, exists: true, data, size: st.size, mtime: st.mtimeMs };
    } catch (err) { return { success: false, error: err.message }; }
  },
  'medfac-clear-cache': async () => {
    try {
      const fp = path.join(deps.userDataPath, 'data', 'medfac_cache.json');
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 사용자 배경 이미지 ──
   *  userData/data/bg/ 아래에 custom.{webp|png|jpg|jpeg} 한 장만 유지.
   *  렌더러 settings-bg-theme.js 에서 webp 0.85 quality 로 압축 후 buffer 전달. */
  'user-bg-save': (p) => {
    try {
      const dir = path.join(deps.userDataPath, 'data', 'bg');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeExt = (p.ext || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
      const fp = path.join(dir, 'custom.' + safeExt);
      /* 다른 확장자 잔존 파일 정리 */
      ['webp', 'png', 'jpg', 'jpeg'].forEach(e => {
        const old = path.join(dir, 'custom.' + e);
        if (e !== safeExt && fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (_) {} }
      });
      /* buffer 는 JSON 으로 직렬화된 Uint8Array(객체) 또는 Buffer.toJSON() {type:'Buffer',data:[]} */
      let bin;
      if (p.buffer && p.buffer.type === 'Buffer' && Array.isArray(p.buffer.data)) bin = Buffer.from(p.buffer.data);
      else if (Array.isArray(p.buffer)) bin = Buffer.from(p.buffer);
      else if (p.buffer && typeof p.buffer === 'object') bin = Buffer.from(Object.values(p.buffer));
      else bin = Buffer.from(p.buffer || []);
      fs.writeFileSync(fp, bin);
      return { success: true, path: fp };
    } catch (err) { return { success: false, error: err.message }; }
  },
  'user-bg-delete': () => {
    try {
      const dir = path.join(deps.userDataPath, 'data', 'bg');
      if (fs.existsSync(dir)) {
        ['webp', 'png', 'jpg', 'jpeg'].forEach(e => {
          const fp = path.join(dir, 'custom.' + e);
          if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (_) {} }
        });
      }
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  },
  'user-bg-get-path': () => {
    try {
      const dir = path.join(deps.userDataPath, 'data', 'bg');
      const exts = ['webp', 'png', 'jpg', 'jpeg'];
      for (const e of exts) {
        const fp = path.join(dir, 'custom.' + e);
        if (fs.existsSync(fp)) return { success: true, path: fp, exists: true };
      }
      return { success: true, exists: false };
    } catch (err) { return { success: false, error: err.message }; }
  },
  /* 배경 이미지 dataURL — CSP/file:// 차단 우회용. 렌더러에서 CSS background-image url() 에 직접 사용. */
  'user-bg-get-data-url': () => {
    try {
      const dir = path.join(deps.userDataPath, 'data', 'bg');
      const exts = ['webp', 'png', 'jpg', 'jpeg'];
      for (const e of exts) {
        const fp = path.join(dir, 'custom.' + e);
        if (fs.existsSync(fp)) {
          const buf = fs.readFileSync(fp);
          const mime = e === 'jpg' ? 'jpeg' : e;
          const dataUrl = 'data:image/' + mime + ';base64,' + buf.toString('base64');
          return { success: true, dataUrl: dataUrl, exists: true };
        }
      }
      return { success: true, exists: false };
    } catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 보건일지 연도별 요약 — 설정 → 보존기간 정리 탭에서 표시 ── */
  'records-year-summary': () => {
    try { return { success: true, summary: services.recordsDB().getYearSummary() }; }
    catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 보존기간 만료 정리 — 참조 0건 + DB 등록 5년 이상 경과 학생/교직원 ── */
  'retention-find-orphan-students': (p) => {
    try { return { success: true, data: services.studentsDB().findOrphanStudents((p && p.cutoffYears) || 5) }; }
    catch (err) { return { success: false, error: err.message }; }
  },
  'retention-bulk-delete-orphan-students': (p) => {
    try { return services.studentsDB().bulkDeleteOrphanStudents(p.uids); }
    catch (err) { return { success: false, error: err.message }; }
  },
  'retention-find-orphan-staff': (p) => {
    try { return { success: true, data: services.staffDB().findOrphanStaff((p && p.cutoffYears) || 5) }; }
    catch (err) { return { success: false, error: err.message }; }
  },
  'retention-bulk-delete-orphan-staff': (p) => {
    try { return services.staffDB().bulkDeleteOrphanStaff(p.uids); }
    catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 과거 기록 미매칭 처리 — 자동 매칭 실패 행을 사용자가 학생을 골라 직접 연결 ── */
  'past-history-get-unmatched': () => {
    try { return { success: true, data: services.pastHistory().getUnmatched() }; }
    catch (e) { return { success: false, error: e.message }; }
  },
  'past-history-resolve-unmatched': (p) => {
    try { services.pastHistory().resolveUnmatched(p.recordIds, p.studentId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  },

  /* ── 과거 기록 xlsx 업로드 (buffer 모드) ──
   *  렌더러가 File.arrayBuffer() 결과를 bytes 로 전달하면 임시 파일로 저장 후 경로 반환.
   *  브라우저 → multer 업로드 경로(/api/upload) 대안. */
  'import-past-history-xlsx-buffer': (p) => {
    try {
      const safeName = (p.filename || 'past_health_records.xlsx').replace(/[\/\\:*?"<>|]/g, '_');
      const tmpPath = path.join(os.tmpdir(), 'mhd_' + Date.now() + '_' + safeName);
      let buf;
      if (p.bytes && p.bytes.type === 'Buffer' && Array.isArray(p.bytes.data)) buf = Buffer.from(p.bytes.data);
      else if (Array.isArray(p.bytes)) buf = Buffer.from(p.bytes);
      else if (p.bytes && typeof p.bytes === 'object') buf = Buffer.from(Object.values(p.bytes));
      else buf = Buffer.from(p.bytes || []);
      fs.writeFileSync(tmpPath, buf);
      return { success: true, filePath: tmpPath };
    } catch (e) { return { success: false, error: e.message }; }
  },

  /* ── 학생 일괄 등록 + 동명이인 보류 처리 ──
   *  업로드 시 자동 매칭 안 된 학생만 보류 → JSON 파일로 영구 저장.
   *  사용자가 모달에서 결정하면 resolve 로 등록 확정 + JSON 갱신.
   *  학년도 다른 옛 JSON 은 자동 삭제 (3/1 학년도 기준). */
  'students-import-with-pending': (p) => {
    try {
      const result = services.studentsDB().saveAllWithAmbiguousDetection(p.year, p.students);
      const yr = result.year;
      _cleanupOldPendingAmbSrv(yr);
      const filePath = _pendingAmbPathSrv(yr);
      if (result.ambiguousCount > 0) {
        const payload = { year: yr, createdAt: new Date().toISOString(), items: result.ambiguous };
        try {
          const tmp = filePath + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
          if (fs.existsSync(filePath)) { try { fs.copyFileSync(filePath, filePath + '.bak'); } catch(_){} }
          fs.renameSync(tmp, filePath);
        } catch (e) { console.error('[pending-amb] JSON 저장 실패:', e.message); }
      } else {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(_){}
      }
      return result;
    } catch (err) { return { success: false, error: err.message }; }
  },
  'students-pending-ambiguous-list': (p) => {
    try {
      const yr = (p && p.year) || require('../src/main/services/database').HealthDiaryDB.academicYear();
      _cleanupOldPendingAmbSrv(yr);
      const filePath = _pendingAmbPathSrv(yr);
      if (!fs.existsSync(filePath)) return { success: true, year: yr, items: [], count: 0 };
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { success: true, year: yr, items: data.items || [], count: (data.items || []).length };
    } catch (err) { return { success: false, error: err.message, items: [], count: 0 }; }
  },
  'students-pending-ambiguous-count': (p) => {
    try {
      const yr = (p && p.year) || require('../src/main/services/database').HealthDiaryDB.academicYear();
      _cleanupOldPendingAmbSrv(yr);
      const filePath = _pendingAmbPathSrv(yr);
      if (!fs.existsSync(filePath)) return { success: true, year: yr, count: 0 };
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { success: true, year: yr, count: (data.items || []).length };
    } catch (err) { return { success: false, error: err.message, count: 0 }; }
  },
  'students-pending-ambiguous-resolve': (p) => {
    try {
      const yr = p.year || require('../src/main/services/database').HealthDiaryDB.academicYear();
      const filePath = _pendingAmbPathSrv(yr);
      if (!fs.existsSync(filePath)) return { success: false, error: '보류 파일이 없습니다.' };
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const items = data.items || [];
      const idx = items.findIndex(it => it.excelRow === p.excelRow);
      if (idx === -1) return { success: false, error: '해당 항목을 찾을 수 없습니다.' };
      const item = items[idx];
      const upRes = services.studentsDB().resolveAmbiguousImport(yr, item, p.chosenUid);
      if (!upRes || !upRes.success) return { success: false, error: (upRes && upRes.error) || '등록 실패' };
      items.splice(idx, 1);
      if (items.length === 0) {
        try { fs.unlinkSync(filePath); } catch(_){}
        try { fs.unlinkSync(filePath + '.bak'); } catch(_){}
      } else {
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ year: yr, createdAt: data.createdAt, items: items }, null, 2), 'utf8');
        try { fs.copyFileSync(filePath, filePath + '.bak'); } catch(_){}
        fs.renameSync(tmp, filePath);
      }
      return { success: true, remaining: items.length };
    } catch (err) { return { success: false, error: err.message }; }
  },

  /* ── 엑셀 빌더 (xlsx-*) ──
   *  exceljs/fflate 기반 순수 Node 코드라서 웹 서버에서도 동일하게 동작.
   *  main.js 의 핸들러를 그대로 미러링 (시각 양식·색상바·freeze pane 모두 보존). */
  /* 방문 순위 xlsx — main.js 'xlsx-build-visit-rank' 와 동일 (웹 패리티, 2026-06-12) */
  'xlsx-build-visit-rank': async (payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
      (payload.sheets || []).forEach(function (sh) {
        const groups = sh.groups || [];
        const GAP = 1;
        let colCount = 0;
        groups.forEach(function (g, gi) { colCount += (g.header || []).length; if (gi < groups.length - 1) colCount += GAP; });
        if (colCount < 1) colCount = 1;
        const ws = wb.addWorksheet(sh.name || '순위', {
          views: [{ state: 'frozen', ySplit: 9, topLeftCell: 'A10' }],
          pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
        });
        const widths = [];
        groups.forEach(function (g, gi) {
          ((g.colWidths && g.colWidths.length) ? g.colWidths : (g.header || []).map(function () { return 90; }))
            .forEach(function (w) { widths.push(Math.max(4, w / 7)); });
          if (gi < groups.length - 1) widths.push(2.2);
        });
        ws.columns = widths.map(function (w) { return { width: w }; });
        const top1 = Math.round(colCount * 0.7);
        const r1 = ws.addRow(new Array(colCount).fill(' ')); r1.height = 8;
        for (let i = 1; i <= colCount; i++) r1.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
        const r2 = ws.addRow([sh.titleText || '방문 순위']); r2.height = 32;
        ws.mergeCells(2, 1, 2, colCount);
        const c2 = r2.getCell(1);
        c2.font = { bold: true, size: 16, name: '맑은 고딕' };
        c2.alignment = { horizontal: 'center', vertical: 'middle' };
        c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
        const r3 = ws.addRow(new Array(colCount).fill(' ')); r3.height = 8;
        for (let i = 1; i <= colCount; i++) r3.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2E8B57' : 'FFC0392B' } };
        ws.addRow([]).height = 18;
        const r5 = ws.addRow([sh.schoolText || '']); r5.height = 20; ws.mergeCells(5, 1, 5, colCount);
        r5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
        r5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        const r6 = ws.addRow([sh.periodText || '']); r6.height = 20; ws.mergeCells(6, 1, 6, colCount);
        r6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
        r6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.addRow([]).height = 18;
        const titleRowIdx = 8, headerRowIdx = 9, dataStart = 10;
        ws.getRow(titleRowIdx).height = 24;
        ws.getRow(headerRowIdx).height = 24;
        let colOff = 1;
        groups.forEach(function (g) {
          const w = (g.header || []).length;
          if (!w) return;
          ws.mergeCells(titleRowIdx, colOff, titleRowIdx, colOff + w - 1);
          const tc = ws.getCell(titleRowIdx, colOff);
          tc.value = g.title || '';
          tc.font = { bold: true, size: 12, color: { argb: 'FF0E7490' }, name: '맑은 고딕' };
          tc.alignment = { horizontal: 'left', vertical: 'middle' };
          tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FB' } };
          (g.header || []).forEach(function (hv, hi) {
            const c = ws.getCell(headerRowIdx, colOff + hi);
            c.value = hv;
            c.font = { bold: true, size: 10.5, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
            c.border = { top: headerBorder, bottom: headerBorder, left: hi === 0 ? headerBorder : thinBorder, right: hi === w - 1 ? headerBorder : thinBorder };
          });
          (g.rows || []).forEach(function (row, ri) {
            const isLast = ri === g.rows.length - 1;
            row.forEach(function (v, ci) {
              const c = ws.getCell(dataStart + ri, colOff + ci);
              c.value = v;
              c.font = { size: 10, name: '맑은 고딕' };
              c.alignment = { horizontal: (ci === 1) ? 'left' : 'center', vertical: 'middle' };
              c.border = { top: thinBorder, bottom: isLast ? headerBorder : thinBorder, left: ci === 0 ? headerBorder : thinBorder, right: ci === row.length - 1 ? headerBorder : thinBorder };
            });
            const rr = ws.getRow(dataStart + ri);
            if (!rr.height || rr.height < 20) rr.height = 20;
          });
          colOff += w + GAP;
        });
        ws.pageSetup.printTitlesRow = '1:9';
      });
      const buf = await wb.xlsx.writeBuffer();
      return { success: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      console.error('[xlsx-build-visit-rank]', e);
      return { success: false, error: e.message };
    }
  },

  'xlsx-build-dept-stats': async (payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      const ws = wb.addWorksheet('진료과별통계', {
        views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
      });
      const sections = payload.sections || [];
      const titleText = payload.titleText || '진료과별 통계';
      const schoolText = payload.schoolText || '';
      const periodText = payload.periodText || '';
      const colCount = payload.colCount || (sections[0] && sections[0].header ? sections[0].header.length : 16);
      const top1 = payload.top1 || Math.round(colCount * 0.7);
      const bot1 = payload.bot1 || (colCount - top1);
      const colWidths = payload.colWidths || new Array(colCount).fill(90);
      ws.columns = colWidths.map(function(w){ return { width: Math.max(8, w/7) }; });
      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
      const r1 = ws.addRow(new Array(colCount).fill(' ')); r1.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r1.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
      }
      const r2 = ws.addRow([titleText]); r2.height = 32;
      ws.mergeCells(2, 1, 2, colCount);
      const c2 = r2.getCell(1);
      c2.font = { bold: true, size: 16, name: '맑은 고딕' };
      c2.alignment = { horizontal: 'center', vertical: 'middle' };
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      const r3 = ws.addRow(new Array(colCount).fill(' ')); r3.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r3.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= bot1 ? 'FF2E8B57' : 'FFC0392B' } };
      }
      ws.addRow([]).height = 24;
      const r5 = ws.addRow([schoolText]); r5.height = 22;
      ws.mergeCells(5, 1, 5, colCount);
      r5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      const r6 = ws.addRow([periodText]); r6.height = 22;
      ws.mergeCells(6, 1, 6, colCount);
      r6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      ws.addRow([]).height = 24;
      let curRow = 8;
      sections.forEach(function(section, sIdx){
        if (sIdx > 0) { ws.addRow([]).height = 14; curRow++; }
        const stRow = ws.addRow([section.title || '']); stRow.height = 24;
        ws.mergeCells(curRow, 1, curRow, colCount);
        const stC = stRow.getCell(1);
        stC.font = { bold: true, size: 13, color: { argb: 'FF0E7490' }, name: '맑은 고딕' };
        stC.alignment = { horizontal: 'left', vertical: 'middle' };
        stC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FB' } };
        curRow++;
        const headerRow = ws.addRow(section.header || []); headerRow.height = 26;
        for (let i = 1; i <= colCount; i++) {
          const c = headerRow.getCell(i);
          c.font = { bold: true, size: 11, name: '맑은 고딕' };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
          c.border = { top: headerBorder, bottom: { style: 'medium', color: { argb: 'FF000000' } },
            left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
        }
        curRow++;
        const rows = section.rows || [];
        const totalsRow = section.totalsRow;
        rows.forEach(function(rowData, ri){
          const tr = ws.addRow(rowData);
          const isLastRow = !totalsRow && ri === rows.length - 1;
          for (let i = 1; i <= colCount; i++) {
            const c = tr.getCell(i);
            c.font = { size: 10, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            c.border = { top: thinBorder, bottom: isLastRow ? headerBorder : thinBorder,
              left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
          }
          curRow++;
        });
        if (totalsRow) {
          const tr = ws.addRow(totalsRow);
          for (let i = 1; i <= colCount; i++) {
            const c = tr.getCell(i);
            c.font = { bold: true, size: 10, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } };
            c.border = { top: thinBorder, bottom: headerBorder,
              left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
          }
          curRow++;
        }
      });
      ws.pageSetup.printTitlesRow = '1:7';
      const buf = await wb.xlsx.writeBuffer();
      return { success: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      console.error('[xlsx-build-dept-stats]', e);
      return { success: false, error: e.message };
    }
  },

  /* exceljs 로 보건일지 출력 xlsx 빌드 — 색상바·제목·외곽선·freeze 완전 지원.
   *  payload.coverSections / continuousDays / dailySheets 지원 (main.js 와 동일). */
  'xlsx-build-diary': async (payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      /* 1) 진료과별 통계 표지 시트 (선택) */
      if (payload.coverSections && Array.isArray(payload.coverSections) && payload.coverSections.length) {
        const cvColCount = payload.coverColCount || (payload.coverSections[0].header ? payload.coverSections[0].header.length : 6);
        const cvTop1 = Math.max(1, Math.round(cvColCount * 0.7));
        const cvBot1 = Math.max(1, cvColCount - cvTop1);
        const cws = wb.addWorksheet('진료과별 통계', {
          views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }],
          pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        const cvTitle = payload.coverTitle || '진료과별 선택기간 통계';
        const cvSchool = payload.schoolText || '';
        const cvPeriod = payload.periodText || '';
        const cvColWidths = payload.coverColWidths || new Array(cvColCount).fill(90);
        cws.columns = cvColWidths.map(function(w){ return { width: Math.max(8, w/7) }; });
        const cHeadBorder = { style: 'medium', color: { argb: 'FF000000' } };
        const cThinBorder = { style: 'thin', color: { argb: 'FF555555' } };
        const cr1 = cws.addRow(new Array(cvColCount).fill(' ')); cr1.height = 8;
        for (let i = 1; i <= cvColCount; i++) {
          cr1.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= cvTop1 ? 'FF2855A0' : 'FFD4A843' } };
        }
        const cr2 = cws.addRow([cvTitle]); cr2.height = 32;
        cws.mergeCells(2, 1, 2, cvColCount);
        cr2.getCell(1).font = { bold: true, size: 16, name: '맑은 고딕' };
        cr2.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        cr2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
        const cr3 = cws.addRow(new Array(cvColCount).fill(' ')); cr3.height = 8;
        for (let i = 1; i <= cvColCount; i++) {
          cr3.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= cvBot1 ? 'FF2E8B57' : 'FFC0392B' } };
        }
        cws.addRow([]).height = 24;
        const cr5 = cws.addRow([cvSchool]); cr5.height = 22;
        cws.mergeCells(5, 1, 5, cvColCount);
        cr5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
        cr5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        const cr6 = cws.addRow([cvPeriod]); cr6.height = 22;
        cws.mergeCells(6, 1, 6, cvColCount);
        cr6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
        cr6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        cws.addRow([]).height = 24;
        let cvRow = 8;
        payload.coverSections.forEach(function(section, sIdx){
          if (sIdx > 0) { cws.addRow([]).height = 14; cvRow++; }
          const stRow = cws.addRow([section.title || '']); stRow.height = 24;
          cws.mergeCells(cvRow, 1, cvRow, cvColCount);
          const stC = stRow.getCell(1);
          stC.font = { bold: true, size: 13, color: { argb: 'FF0E7490' }, name: '맑은 고딕' };
          stC.alignment = { horizontal: 'left', vertical: 'middle' };
          stC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FB' } };
          cvRow++;
          const hdr = cws.addRow(section.header || []); hdr.height = 26;
          for (let i = 1; i <= cvColCount; i++) {
            const c = hdr.getCell(i);
            c.font = { bold: true, size: 11, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
            c.border = { top: cHeadBorder, bottom: cHeadBorder,
              left: i === 1 ? cHeadBorder : cThinBorder, right: i === cvColCount ? cHeadBorder : cThinBorder };
          }
          cvRow++;
          const sRows = section.rows || [];
          const hasTotal = !!section.totalsRow;
          sRows.forEach(function(rowData, ri){
            const tr = cws.addRow(rowData);
            const isLast = !hasTotal && ri === sRows.length - 1;
            for (let i = 1; i <= cvColCount; i++) {
              const c = tr.getCell(i);
              c.font = { size: 10, name: '맑은 고딕' };
              c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
              c.border = { top: cThinBorder, bottom: isLast ? cHeadBorder : cThinBorder,
                left: i === 1 ? cHeadBorder : cThinBorder, right: i === cvColCount ? cHeadBorder : cThinBorder };
            }
            cvRow++;
          });
          if (hasTotal) {
            const tr = cws.addRow(section.totalsRow);
            for (let i = 1; i <= cvColCount; i++) {
              const c = tr.getCell(i);
              c.font = { bold: true, size: 10, name: '맑은 고딕' };
              c.alignment = { horizontal: 'center', vertical: 'middle' };
              c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } };
              c.border = { top: cThinBorder, bottom: cHeadBorder,
                left: i === 1 ? cHeadBorder : cThinBorder, right: i === cvColCount ? cHeadBorder : cThinBorder };
            }
            cvRow++;
          }
        });
        cws.pageSetup.printTitlesRow = '1:7';
      }

      const mainSheetTitle = payload.mainSheetTitle || '보건일지';
      function _buildDiarySheet(wsInst, p) {
        const colCount = p.colCount || 8;
        const top1 = p.top1 || Math.round(colCount * 0.7);
        const bot1 = p.bot1 || (colCount - top1);
        const colWidths = p.colWidths || [];
        const headerLabels = p.headerLabels || [];
        const dataRows = p.dataRows || [];
        const titleText = p.titleText || '보건실 방문자 현황';
        const schoolText = p.schoolText || '';
        const periodText = p.periodText || '';
        wsInst.columns = colWidths.map(function(w){ return { width: Math.max(8, w/7) }; });
        const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
        const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
        const r1 = wsInst.addRow(new Array(colCount).fill(' ')); r1.height = 8;
        for (let i = 1; i <= colCount; i++) { r1.getCell(i).fill = { type:'pattern', pattern:'solid', fgColor:{argb:i<=top1?'FF2855A0':'FFD4A843'} }; }
        const r2 = wsInst.addRow([titleText]); r2.height = 32;
        wsInst.mergeCells(2, 1, 2, colCount);
        r2.getCell(1).font = { bold:true, size:16, name:'맑은 고딕' };
        r2.getCell(1).alignment = { horizontal:'center', vertical:'middle' };
        r2.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF7F7F7'} };
        const r3 = wsInst.addRow(new Array(colCount).fill(' ')); r3.height = 8;
        for (let i = 1; i <= colCount; i++) { r3.getCell(i).fill = { type:'pattern', pattern:'solid', fgColor:{argb:i<=bot1?'FF2E8B57':'FFC0392B'} }; }
        wsInst.addRow([]).height = 24;
        const r5 = wsInst.addRow([schoolText]); r5.height = 22;
        wsInst.mergeCells(5, 1, 5, colCount);
        r5.getCell(1).font = { bold:true, size:11, name:'맑은 고딕' };
        r5.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
        const r6 = wsInst.addRow([periodText]); r6.height = 22;
        wsInst.mergeCells(6, 1, 6, colCount);
        r6.getCell(1).font = { bold:true, size:11, name:'맑은 고딕' };
        r6.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
        wsInst.addRow([]).height = 24;
        if (p.preambleSections && p.preambleSections.sections && p.preambleSections.sections.length) {
          const pbCols = p.preambleSections.colCount || colCount;
          const mergeCols = Math.min(pbCols, colCount);
          const pbThin = { style:'thin', color:{argb:'FF9CA3AF'} };
          const pbHead = { style:'medium', color:{argb:'FF000000'} };
          const pbTitleRow = wsInst.addRow(['📊 일간 방문 통계']); pbTitleRow.height = 22;
          wsInst.mergeCells(pbTitleRow.number, 1, pbTitleRow.number, colCount);
          pbTitleRow.getCell(1).font = { bold:true, size:12, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
          pbTitleRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
          p.preambleSections.sections.forEach(function(section, sIdx){
            if (sIdx > 0) wsInst.addRow([]).height = 6;
            const stRow = wsInst.addRow([section.title || '']); stRow.height = 20;
            wsInst.mergeCells(stRow.number, 1, stRow.number, colCount);
            stRow.getCell(1).font = { bold:true, size:11, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
            stRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
            stRow.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE6F7FB'} };
            const hdrRow = wsInst.addRow((section.header || []).concat(new Array(Math.max(0, colCount - (section.header||[]).length)).fill('')));
            hdrRow.height = 22;
            for (let i = 1; i <= mergeCols; i++) {
              const c = hdrRow.getCell(i);
              c.font = { bold:true, size:10, name:'맑은 고딕' };
              c.alignment = { horizontal:'center', vertical:'middle' };
              c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
              c.border = { top:pbHead, bottom:pbThin, left: i===1?pbHead:pbThin, right: i===mergeCols?pbHead:pbThin };
            }
            (section.rows || []).forEach(function(rowData, ri){
              const padded = rowData.slice();
              while (padded.length < colCount) padded.push('');
              const tr = wsInst.addRow(padded);
              const isLast = !section.totalsRow && ri === section.rows.length - 1;
              for (let i = 1; i <= mergeCols; i++) {
                const c = tr.getCell(i);
                c.font = { size:10, name:'맑은 고딕' };
                c.alignment = { horizontal:'center', vertical:'middle' };
                c.border = { top:pbThin, bottom: isLast ? pbHead : pbThin, left: i===1?pbHead:pbThin, right: i===mergeCols?pbHead:pbThin };
              }
            });
            if (section.totalsRow) {
              const tPadded = section.totalsRow.slice();
              while (tPadded.length < colCount) tPadded.push('');
              const tr = wsInst.addRow(tPadded);
              for (let i = 1; i <= mergeCols; i++) {
                const c = tr.getCell(i);
                c.font = { bold:true, size:10, name:'맑은 고딕' };
                c.alignment = { horizontal:'center', vertical:'middle' };
                c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFAFBFC'} };
                c.border = { top:pbThin, bottom:pbHead, left: i===1?pbHead:pbThin, right: i===mergeCols?pbHead:pbThin };
              }
            }
          });
          wsInst.addRow([]).height = 14;
          const visitTitle = wsInst.addRow(['📝 방문 상세']); visitTitle.height = 22;
          wsInst.mergeCells(visitTitle.number, 1, visitTitle.number, colCount);
          visitTitle.getCell(1).font = { bold:true, size:12, color:{argb:'FF4338CA'}, name:'맑은 고딕' };
          visitTitle.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
        }
        const hdrRowMain = wsInst.addRow(headerLabels); hdrRowMain.height = 26;
        for (let i = 1; i <= colCount; i++) {
          const c = hdrRowMain.getCell(i);
          c.font = { bold:true, size:11, name:'맑은 고딕' };
          c.alignment = { horizontal:'center', vertical:'middle' };
          c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
          c.border = { top:headerBorder, bottom:{style:'medium',color:{argb:'FF000000'}},
            left: i===1 ? headerBorder : thinBorder, right: i===colCount ? headerBorder : thinBorder };
        }
        dataRows.forEach(function(row, ri) {
          const tr = wsInst.addRow(row);
          const isLastRow = (ri === dataRows.length - 1);
          for (let i = 1; i <= colCount; i++) {
            const c = tr.getCell(i);
            c.font = { size:10, name:'맑은 고딕' };
            c.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
            c.border = { top:thinBorder, bottom: isLastRow ? headerBorder : thinBorder,
              left: i===1 ? headerBorder : thinBorder, right: i===colCount ? headerBorder : thinBorder };
          }
        });
        wsInst.pageSetup.printTitlesRow = '1:8';
      }

      /* "매일 한 페이지" — continuousDays */
      if (Array.isArray(payload.continuousDays) && payload.continuousDays.length > 0) {
        const colCount = payload.colCount || 8;
        const top1 = payload.top1 || Math.round(colCount * 0.7);
        const bot1 = payload.bot1 || (colCount - top1);
        const colWidths = payload.colWidths || [];
        const titleText = payload.titleText || '보건실 방문자 현황';
        const schoolText = payload.schoolText || '';
        const periodText = payload.periodText || '';
        const wsMain = wb.addWorksheet(mainSheetTitle, {
          views: [{ state:'frozen', ySplit:3, topLeftCell:'A4', activeCell:'A4' }],
          pageSetup: { orientation:'portrait',
            margins:{ left:0.4, right:0.4, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }
        });
        wsMain.columns = colWidths.map(function(w){ return { width: Math.max(8, w/7) }; });
        const headerBorder = { style:'medium', color:{argb:'FF000000'} };
        const thinBorder = { style:'thin', color:{argb:'FF555555'} };
        const r1m = wsMain.addRow(new Array(colCount).fill(' ')); r1m.height = 8;
        for (let i=1;i<=colCount;i++){ r1m.getCell(i).fill={ type:'pattern', pattern:'solid', fgColor:{argb:i<=top1?'FF2855A0':'FFD4A843'} }; }
        const r2m = wsMain.addRow([titleText]); r2m.height = 32;
        wsMain.mergeCells(2,1,2,colCount);
        r2m.getCell(1).font = { bold:true, size:16, name:'맑은 고딕' };
        r2m.getCell(1).alignment = { horizontal:'center', vertical:'middle' };
        r2m.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF7F7F7'} };
        const r3m = wsMain.addRow(new Array(colCount).fill(' ')); r3m.height = 8;
        for (let i=1;i<=colCount;i++){ r3m.getCell(i).fill={ type:'pattern', pattern:'solid', fgColor:{argb:i<=bot1?'FF2E8B57':'FFC0392B'} }; }
        wsMain.addRow([]).height = 28;
        const r5m = wsMain.addRow([schoolText]); r5m.height = 22; wsMain.mergeCells(wsMain.lastRow.number,1,wsMain.lastRow.number,colCount);
        r5m.getCell(1).font = { bold:true, size:11, name:'맑은 고딕' }; r5m.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
        const r6m = wsMain.addRow([periodText]); r6m.height = 22; wsMain.mergeCells(wsMain.lastRow.number,1,wsMain.lastRow.number,colCount);
        r6m.getCell(1).font = { bold:true, size:11, name:'맑은 고딕' }; r6m.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
        payload.continuousDays.forEach(function(day, dayIdx){
          wsMain.addRow([]).height = 8;
          if (dayIdx > 0) {
            const pbRow = wsMain.lastRow.number + 1;
            wsMain.getRow(pbRow).addPageBreak();
          }
          const d = new Date(day.date);
          const dow=['일','월','화','수','목','금','토'][d.getDay()];
          const dayTitle = d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 ('+dow+')';
          const dayTitleRow = wsMain.addRow(['📅 '+dayTitle+'  ·  방문 '+(day.dataRows||[]).length+'명']);
          dayTitleRow.height = 24;
          wsMain.mergeCells(dayTitleRow.number, 1, dayTitleRow.number, colCount);
          dayTitleRow.getCell(1).font = { bold:true, size:13, color:{argb:'FF0F172A'}, name:'맑은 고딕' };
          dayTitleRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
          dayTitleRow.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE0F2FE'} };
          dayTitleRow.getCell(1).border = { top:headerBorder, bottom:thinBorder, left:headerBorder, right:headerBorder };
          /* ── 오늘의 메모 — Excel 포함 (사용자 요청 2026-06-11). 제목층 병합분배 + 내용층 wrapText ── */
          if (day.todayMemo && Array.isArray(day.todayMemo.titles) && day.todayMemo.titles.length) {
            const tmTitle = wsMain.addRow(['📝 오늘의 메모']); tmTitle.height = 20;
            wsMain.mergeCells(tmTitle.number, 1, tmTitle.number, colCount);
            tmTitle.getCell(1).font = { bold:true, size:11, color:{argb:'FF4D7C0F'}, name:'맑은 고딕' };
            tmTitle.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
            tmTitle.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF1F8E9'} };
            const tmN = day.todayMemo.titles.length;
            const tmPer = Math.max(1, Math.floor(colCount / tmN));
            const _tmRow = function(values, head, h){
              const row = wsMain.addRow(new Array(colCount).fill('')); row.height = h;
              for (let i=0;i<tmN;i++){
                const c1 = i*tmPer+1;
                const c2 = (i===tmN-1) ? colCount : Math.min((i+1)*tmPer, colCount);
                if (c2 > c1) wsMain.mergeCells(row.number, c1, row.number, c2);
                for (let j=c1;j<=c2;j++){
                  const c = row.getCell(j);
                  if (j === c1) c.value = values[i];
                  c.font = head ? { bold:true, size:10, name:'맑은 고딕', color:{argb:'FF475569'} } : { size:10, name:'맑은 고딕' };
                  c.alignment = head ? { horizontal:'center', vertical:'middle' } : { horizontal:'left', vertical:'top', wrapText:true };
                  if (head) c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
                  c.border = { top: head?headerBorder:thinBorder, bottom: head?thinBorder:headerBorder,
                    left: j===1?headerBorder:(j===c1?thinBorder:undefined),
                    right: j===colCount?headerBorder:(j===c2?thinBorder:undefined) };
                }
              }
            };
            _tmRow(day.todayMemo.titles, true, 20);
            _tmRow(day.todayMemo.cells, false, 48);
            wsMain.addRow([]).height = 6;
          }
          if (day.preambleSections && day.preambleSections.sections && day.preambleSections.sections.length) {
            const statsTitleRow = wsMain.addRow(['📊 일간 방문 통계']); statsTitleRow.height = 20;
            wsMain.mergeCells(statsTitleRow.number, 1, statsTitleRow.number, colCount);
            statsTitleRow.getCell(1).font = { bold:true, size:11, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
            statsTitleRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
            const pbThin = { style:'thin', color:{argb:'FF9CA3AF'} };
            const pbHead = { style:'medium', color:{argb:'FF000000'} };
            day.preambleSections.sections.forEach(function(section, sIdx){
              if (sIdx > 0) wsMain.addRow([]).height = 6;
              const stR = wsMain.addRow([section.title||'']); stR.height = 20;
              wsMain.mergeCells(stR.number, 1, stR.number, colCount);
              stR.getCell(1).font = { bold:true, size:10.5, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
              stR.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
              stR.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE6F7FB'} };
              /* ── 0건 진료과 열 생략 — main.js 와 패리티 (2026-06-11). 라벨·계 열 보존. */
              (function(){
                const H = section.header || [];
                if (H.length < 3) return;
                const rows = section.rows || [];
                const tot = section.totalsRow;
                const keep = [0];
                for (let i=1;i<H.length-1;i++){
                  let any = false;
                  rows.forEach(function(r){ const v = r[i]; if (v && v !== 0 && v !== '0') any = true; });
                  if (tot){ const v = tot[i]; if (v && v !== 0 && v !== '0') any = true; }
                  if (any) keep.push(i);
                }
                keep.push(H.length - 1);
                if (keep.length === H.length) return;
                const pick = function(a){ return keep.map(function(i){ return a[i]; }); };
                section = { title: section.title, header: pick(H), rows: rows.map(pick), totalsRow: tot ? pick(tot) : tot };
              })();
              /* ── 통계 N열 → 시트 colCount 열 폭(px) 기준 병합 분배 — main.js 와 패리티 (2026-06-11).
               *  오른쪽 끝을 방문 상세와 정렬. 간격 조정·항목 ON/OFF·순서 변경 자동 반영. */
              function _addAlignedRow(values, applyStyle, topB, bottomB){
                const N = values.length;
                const row = wsMain.addRow(new Array(colCount).fill(''));
                const spans = [];
                if (colCount >= N) {
                  const W = (Array.isArray(day.colWidths) && day.colWidths.length === colCount)
                    ? day.colWidths.slice() : new Array(colCount).fill(1);
                  const total = W.reduce(function(a,b){ return a+(+b||1); }, 0);
                  const cum = [0];
                  W.forEach(function(w){ cum.push(cum[cum.length-1] + (+w||1)); });
                  const bounds = [0];
                  for (let i=1;i<N;i++){
                    const target = total * i / N;
                    let best = bounds[bounds.length-1] + 1, bestD = Infinity;
                    for (let k = bounds[bounds.length-1] + 1; k <= colCount - (N - i); k++){
                      const d = Math.abs(cum[k] - target);
                      if (d < bestD){ bestD = d; best = k; }
                    }
                    bounds.push(best);
                  }
                  bounds.push(colCount);
                  for (let i=0;i<N;i++) spans.push([bounds[i]+1, bounds[i+1]]);
                } else {
                  for (let i=0;i<N;i++) spans.push([i+1, i+1]);
                }
                const per = (colCount >= N) ? 1 : 0;
                spans.forEach(function(sp, i){
                  const c1 = sp[0], c2 = sp[1];
                  if (c2 > c1) wsMain.mergeCells(row.number, c1, row.number, c2);
                  for (let j=c1;j<=c2;j++){
                    const c = row.getCell(j);
                    if (j === c1) c.value = values[i];
                    applyStyle(c);
                    c.border = { top: topB, bottom: bottomB,
                      left:  j===1 ? pbHead : (j===c1 ? pbThin : undefined),
                      right: (j===colCount || (per<1 && j===c2 && i===N-1)) ? pbHead : (j===c2 ? pbThin : undefined) };
                  }
                });
                return row;
              }
              const hdrR = _addAlignedRow(section.header||[], function(c){
                c.font = { bold:true, size:10, name:'맑은 고딕' };
                c.alignment = { horizontal:'center', vertical:'middle' };
                c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
              }, pbHead, pbThin);
              hdrR.height = 20;
              (section.rows||[]).forEach(function(row, ri){
                const isLast = !section.totalsRow && ri === section.rows.length - 1;
                _addAlignedRow(row, function(c){
                  c.font = { size:10, name:'맑은 고딕' };
                  c.alignment = { horizontal:'center', vertical:'middle' };
                }, pbThin, isLast?pbHead:pbThin);
              });
              if (section.totalsRow) {
                _addAlignedRow(section.totalsRow, function(c){
                  c.font = { bold:true, size:10, name:'맑은 고딕' };
                  c.alignment = { horizontal:'center', vertical:'middle' };
                  c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFAFBFC'} };
                }, pbThin, pbHead);
              }
            });
            wsMain.addRow([]).height = 8;
          }
          const visitTitle = wsMain.addRow(['📝 방문 상세']); visitTitle.height = 20;
          wsMain.mergeCells(visitTitle.number, 1, visitTitle.number, colCount);
          visitTitle.getCell(1).font = { bold:true, size:11, color:{argb:'FF4338CA'}, name:'맑은 고딕' };
          visitTitle.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
          const dayHdrLabels = day.headerLabels || [];
          const dayColCount = dayHdrLabels.length || colCount;
          const hdrR = wsMain.addRow(dayHdrLabels.concat(new Array(Math.max(0, colCount - dayColCount)).fill(''))); hdrR.height = 22;
          for (let i=1;i<=dayColCount;i++){
            const c = hdrR.getCell(i);
            c.font = { bold:true, size:10.5, name:'맑은 고딕' };
            c.alignment = { horizontal:'center', vertical:'middle' };
            c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
            c.border = { top:headerBorder, bottom:thinBorder, left: i===1?headerBorder:thinBorder, right: i===dayColCount?headerBorder:thinBorder };
          }
          (day.dataRows||[]).forEach(function(row, ri){
            const padded = row.slice();
            while (padded.length < colCount) padded.push('');
            const tr = wsMain.addRow(padded);
            const isLast = ri === (day.dataRows.length - 1);
            for (let i=1;i<=dayColCount;i++){
              const c = tr.getCell(i);
              c.font = { size:10, name:'맑은 고딕' };
              c.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
              c.border = { top:thinBorder, bottom: isLast?headerBorder:thinBorder, left: i===1?headerBorder:thinBorder, right: i===dayColCount?headerBorder:thinBorder };
            }
          });
        });
        const buf2 = await wb.xlsx.writeBuffer();
        return { success:true, bytes: Array.from(new Uint8Array(buf2)) };
      }

      /* (구) dailySheets — 하위 호환 */
      if (Array.isArray(payload.dailySheets) && payload.dailySheets.length > 0) {
        const wsMain = wb.addWorksheet(mainSheetTitle, {
          views: [{ state:'frozen', ySplit:8, topLeftCell:'A9', activeCell:'A9' }],
          pageSetup: { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0,
            margins:{ left:0.4, right:0.4, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }
        });
        _buildDiarySheet(wsMain, payload);
        payload.dailySheets.forEach(function(ds){
          const wsExtra = wb.addWorksheet(ds.sheetTitle || '일자', {
            views: [{ state:'frozen', ySplit:8, topLeftCell:'A9', activeCell:'A9' }],
            pageSetup: { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0,
              margins:{ left:0.4, right:0.4, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }
          });
          _buildDiarySheet(wsExtra, ds.payload || {});
        });
        const buf2 = await wb.xlsx.writeBuffer();
        return { success:true, bytes: Array.from(new Uint8Array(buf2)) };
      }

      /* 단일 시트 (방문자당 한 행) */
      /* mainSheetTitle 로 탭 이름 지정 가능 — 연수 등록부 등 재사용 (main.js 와 패리티, 2026-08-25) */
      const ws = wb.addWorksheet(payload.mainSheetTitle || '보건일지', {
        views: [{ state: 'frozen', ySplit: 8, topLeftCell: 'A9', activeCell: 'A9' }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
      });
      const colCount = payload.colCount || 8;
      const top1 = payload.top1 || Math.round(colCount * 0.7);
      const bot1 = payload.bot1 || (colCount - top1);
      const colWidths = payload.colWidths || [];
      const headerLabels = payload.headerLabels || [];
      const dataRows = payload.dataRows || [];
      const titleText = payload.titleText || '보건실 방문자 현황';
      const schoolText = payload.schoolText || '';
      const periodText = payload.periodText || '';
      ws.columns = colWidths.map(function(w){ return { width: Math.max(8, w/7) }; });
      const r1 = ws.addRow(new Array(colCount).fill(' ')); r1.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r1.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
      }
      const r2 = ws.addRow([titleText]); r2.height = 32;
      ws.mergeCells(2, 1, 2, colCount);
      const c2 = r2.getCell(1);
      c2.font = { bold: true, size: 16, name: '맑은 고딕' };
      c2.alignment = { horizontal: 'center', vertical: 'middle' };
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      const r3 = ws.addRow(new Array(colCount).fill(' ')); r3.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r3.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= bot1 ? 'FF2E8B57' : 'FFC0392B' } };
      }
      ws.addRow([]).height = 24;
      const r5 = ws.addRow([schoolText]); r5.height = 22;
      ws.mergeCells(5, 1, 5, colCount);
      r5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      const r6 = ws.addRow([periodText]); r6.height = 22;
      ws.mergeCells(6, 1, 6, colCount);
      r6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      /* 7행 — noteText 지정 시 우측 정렬 안내 문구 (main.js 와 패리티, 2026-08-25) */
      const r7 = ws.addRow([payload.noteText || '']); r7.height = 24;
      if (payload.noteText) {
        ws.mergeCells(7, 1, 7, colCount);
        r7.getCell(1).font = { size: 9, color: { argb: 'FF555555' }, name: '맑은 고딕' };
        r7.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      const r8 = ws.addRow(headerLabels); r8.height = 26;
      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
      for (let i = 1; i <= colCount; i++) {
        const c = r8.getCell(i);
        c.font = { bold: true, size: 11, name: '맑은 고딕' };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
        c.border = { top: headerBorder, bottom: { style: 'medium', color: { argb: 'FF000000' } },
          left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
      }
      dataRows.forEach(function(row, ri) {
        const tr = ws.addRow(row);
        const isLastRow = (ri === dataRows.length - 1);
        for (let i = 1; i <= colCount; i++) {
          const c = tr.getCell(i);
          c.font = { size: 10, name: '맑은 고딕' };
          c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          c.border = { top: thinBorder, bottom: isLastRow ? headerBorder : thinBorder,
            left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
        }
      });
      /* 표 아래 안내 문구 — footerText (main.js 와 패리티, 2026-08-25) */
      if (payload.footerText) {
        const fr = ws.addRow([payload.footerText]); fr.height = 20;
        ws.mergeCells(fr.number, 1, fr.number, colCount);
        fr.getCell(1).font = { size: 9, color: { argb: 'FF555555' }, name: '맑은 고딕' };
        fr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      }
      ws.pageSetup.printTitlesRow = '1:8';
      const buf = await wb.xlsx.writeBuffer();
      return { success: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      console.error('[xlsx-build-diary]', e);
      return { success: false, error: e.message };
    }
  },

  /* 상담 기록지 Excel — main.js 'xlsx-build-counsel' 와 동일(웹 패리티, 2026-06-25). 병합 테두리는 마스터 셀에만. */
  'xlsx-build-counsel': async (payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      const records = (payload && Array.isArray(payload.records)) ? payload.records : [];
      if (!records.length) return { success: false, error: '상담 기록이 없습니다.' };
      const thin = { style: 'thin', color: { argb: 'FF888888' } };
      const FONT = '맑은 고딕';
      const used = {};
      records.forEach((d, idx) => {
        let name = String(d.wsName || ('상담' + (idx + 1))).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 28).trim() || ('상담' + (idx + 1));
        if (used[name]) name = (name + ' ' + (idx + 1)).slice(0, 31);
        used[name] = 1;
        const ws = wb.addWorksheet(name, { views: [{ style: 'pageBreakPreview' }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
        ws.columns = [{ width: 14 }, { width: 26 }, { width: 14 }, { width: 26 }];   /* A4 세로 한 장에 들어가는 폭 (사용자 요청 2026-06-25) */
        const setB = (cell) => { cell.border = { top: thin, left: thin, bottom: thin, right: thin }; };
        const label = (cell, t) => { cell.value = (t == null ? '' : String(t)); cell.font = { bold: true, size: 10, name: FONT }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }; cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }; setB(cell); };
        const value = (cell, t) => { cell.value = (t == null ? '' : String(t)); cell.font = { size: 10, name: FONT }; cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }; setB(cell); };
        let R = 0;
        R++; { const r = ws.getRow(R); r.height = 6; for (let i = 1; i <= 4; i++) r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= 3 ? 'FF2855A0' : 'FFD4A843' } }; }
        R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 30; const c = r.getCell(1); c.value = '상 담 기 록 지'; c.font = { bold: true, size: 18, name: FONT }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } }; }
        R++; { const r = ws.getRow(R); r.height = 6; for (let i = 1; i <= 4; i++) r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= 1 ? 'FF2E8B57' : 'FFC0392B' } }; }
        R++; ws.getRow(R).height = 6;
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '이름'); value(r.getCell(2), d.name); label(r.getCell(3), '성별'); value(r.getCell(4), d.gender); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '소속'); value(r.getCell(2), d.soc); label(r.getCell(3), '상담 일시'); value(r.getCell(4), d.datetime); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '상담 주제'); value(r.getCell(2), d.topics); label(r.getCell(3), '회차'); value(r.getCell(4), d.round); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '의뢰 경로'); ws.mergeCells(R, 2, R, 4); value(r.getCell(2), d.route); }
        const section = (title, body) => {
          R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 20; const c = r.getCell(1); c.value = title; c.font = { bold: true, size: 11, name: FONT }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; setB(c); }
          R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 76; const c = r.getCell(1); c.value = (body == null ? '' : String(body)); c.font = { size: 10, name: FONT }; c.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }; setB(c); }
        };
        section('상담 내용 (주호소)', d.content);
        section('조치 및 지도 내용', d.action);
        section('후속 조치 계획', d.plan);
        section('상담자 의견', d.opinion);
        R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 20; const c = r.getCell(1); c.value = '추후 계획 · 작성 정보'; c.font = { bold: true, size: 11, name: FONT }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; setB(c); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '재상담 예정일'); value(r.getCell(2), d.followUp); label(r.getCell(3), '상담자'); value(r.getCell(4), d.nurse); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '작성일'); value(r.getCell(2), d.today); label(r.getCell(3), '학교'); value(r.getCell(4), d.school); }
        try { ws.pageSetup.printArea = 'A1:D' + R; } catch (_) {}
      });
      const buf = await wb.xlsx.writeBuffer();
      return { success: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      console.error('[xlsx-build-counsel]', e);
      return { success: false, error: e.message };
    }
  },

  /* 연수 이수 현황 Excel — main.js xlsx-build-training-status 와 동일 (웹 패리티, 2026-08-25) */
  'xlsx-build-training-status': async (payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      const items = payload.items || [];
      const staffRows = payload.staffRows || [];
      const colCount = 3 + items.length * 2;
      const titleText = payload.titleText || '보건 연수 이수 현황';
      const noteText = payload.noteText || '';
      const ws = wb.addWorksheet('이수 현황', {
        views: [{ state: 'frozen', ySplit: 8, topLeftCell: 'A9', activeCell: 'A9', style: 'pageBreakPreview' }],
        /* horizontalCentered — 표를 인쇄 페이지 가로 중앙에 배치해 좌우 여백 균등 (main.js 와 패리티, 2026-08-25) */
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          horizontalCentered: true,
          margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
      });
      /* 열 너비 자동 배분 — 연수 개수에 따라 균등 분배 (main.js 와 패리티, 2026-08-25) */
      const TOTAL_CH = 150;
      const widths = [6, 12, 12];
      const perCol = Math.max(10, Math.floor((TOTAL_CH - 30) / Math.max(1, items.length * 2)));
      items.forEach(function(){ widths.push(perCol, perCol); });
      ws.columns = widths.map(function(w){ return { width: w }; });
      const top1 = Math.max(1, Math.round(colCount * 0.7));
      const bot1 = Math.max(1, colCount - top1);
      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
      /* 1~3행: 색상바 + 제목 (오렌지톡 표준) */
      const r1 = ws.addRow(new Array(colCount).fill(' ')); r1.height = 8;
      for (let i = 1; i <= colCount; i++) r1.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
      const r2 = ws.addRow([titleText]); r2.height = 32;
      ws.mergeCells(2, 1, 2, colCount);
      r2.getCell(1).font = { bold: true, size: 16, name: '맑은 고딕' };
      r2.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      const r3 = ws.addRow(new Array(colCount).fill(' ')); r3.height = 8;
      for (let i = 1; i <= colCount; i++) r3.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= bot1 ? 'FF2E8B57' : 'FFC0392B' } };
      /* 4행 여백 / 5행 안내 문구(우측) */
      ws.addRow([]).height = 20;
      const r5 = ws.addRow([noteText]); r5.height = 20;
      if (noteText) {
        ws.mergeCells(5, 1, 5, colCount);
        r5.getCell(1).font = { size: 9, color: { argb: 'FF555555' }, name: '맑은 고딕' };
        r5.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      /* 6~8행: 3중 헤더 */
      const row6 = ['순', '직위', '이름'];
      items.forEach(function(it){ row6.push(it.name + (it.isLegal ? ' (법정)' : ''), ''); });
      const r6 = ws.addRow(row6); r6.height = 24;
      const row7 = ['', '', ''];
      items.forEach(function(it){ row7.push(it.pctText || '', ''); });
      const r7 = ws.addRow(row7); r7.height = 20;
      const row8 = ['', '', ''];
      items.forEach(function(){ row8.push('연수기관', '이수번호'); });
      const r8 = ws.addRow(row8); r8.height = 22;
      ws.mergeCells(6, 1, 8, 1); ws.mergeCells(6, 2, 8, 2); ws.mergeCells(6, 3, 8, 3);
      items.forEach(function(_, i){ const c = 4 + i * 2; ws.mergeCells(6, c, 6, c + 1); ws.mergeCells(7, c, 7, c + 1); });
      [r6, r7, r8].forEach(function(row, ri){
        for (let i = 1; i <= colCount; i++) {
          const c = row.getCell(i);
          c.font = { bold: true, size: 9, name: '맑은 고딕' };
          c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri === 1 ? 'FFF0F8FF' : 'FFE8F4F8' } };
          c.border = { top: ri === 0 ? headerBorder : thinBorder, bottom: ri === 2 ? headerBorder : thinBorder,
            left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
        }
      });
      /* 이수율 색상 (100%=초록, 진행=파랑, 0%=회색) */
      items.forEach(function(it, i){
        if (it.pctColor) r7.getCell(4 + i * 2).font = { bold: true, size: 9, name: '맑은 고딕', color: { argb: it.pctColor } };
      });
      /* 데이터 행 */
      staffRows.forEach(function(rowVals, ri){
        const tr = ws.addRow(rowVals); tr.height = 18;
        const isLast = ri === staffRows.length - 1;
        for (let i = 1; i <= colCount; i++) {
          const c = tr.getCell(i);
          c.font = { size: 9, name: '맑은 고딕' };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = { top: thinBorder, bottom: isLast ? headerBorder : thinBorder,
            left: i === 1 ? headerBorder : thinBorder, right: i === colCount ? headerBorder : thinBorder };
        }
      });
      ws.pageSetup.printTitlesRow = '1:8';
      try { ws.pageSetup.printArea = 'A1:' + ws.getColumn(colCount).letter + ws.lastRow.number; } catch (_) {}
      const buf = await wb.xlsx.writeBuffer();
      return { success: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      console.error('[xlsx-build-training-status]', e);
      return { success: false, error: e.message };
    }
  },

  /* xlsx 파일에 freeze pane(시트뷰) 주입 — SheetJS Community 가 못 쓰는 부분을 보정.
   *  입력: bytes (Uint8Array 직렬화). 출력: 수정된 bytes. */
  'xlsx-inject-freeze': async (p) => {
    try {
      const fflate = require('fflate');
      const bytes = p.bytes;
      let inArr;
      if (bytes && bytes.type === 'Buffer' && Array.isArray(bytes.data)) inArr = new Uint8Array(bytes.data);
      else if (Array.isArray(bytes)) inArr = new Uint8Array(bytes);
      else if (bytes && typeof bytes === 'object') inArr = new Uint8Array(Object.values(bytes));
      else inArr = new Uint8Array(bytes || []);
      const unzipped = fflate.unzipSync(inArr);
      const sheetPath = 'xl/worksheets/sheet1.xml';
      if (!unzipped[sheetPath]) return { success: false, error: 'sheet1.xml not found' };
      let xml = new TextDecoder().decode(unzipped[sheetPath]);
      const yS = parseInt(p.ySplit, 10) || 8;
      const topLeft = 'A' + (yS + 1);
      const sheetViewsXml = '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="' + yS + '" topLeftCell="' + topLeft + '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="' + topLeft + '" sqref="' + topLeft + '"/></sheetView></sheetViews>';
      if (xml.indexOf('<sheetViews') !== -1) {
        xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, sheetViewsXml);
      } else if (xml.indexOf('<dimension') !== -1) {
        xml = xml.replace(/(<dimension[^/]*\/>)/, '$1' + sheetViewsXml);
      } else {
        xml = xml.replace(/<worksheet([^>]*)>/, '<worksheet$1>' + sheetViewsXml);
      }
      unzipped[sheetPath] = new TextEncoder().encode(xml);
      const repacked = fflate.zipSync(unzipped, { level: 6 });
      return { success: true, bytes: Array.from(repacked) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /* xlsx 파일에 freeze pane + 색상바·제목·외곽선 스타일 일괄 주입.
   *  SheetJS Community 가 작성 못 하는 시각 양식을 styles.xml/sheet1.xml 후처리로 추가. */
  'xlsx-inject-style': async (p) => {
    try {
      const fflate = require('fflate');
      const opts = p.options || {};
      const ySplit = parseInt(opts.ySplit, 10) || 8;
      const colCount = parseInt(opts.colCount, 10) || 8;
      const top1 = parseInt(opts.top1, 10) || Math.round(colCount * 0.7);
      const bot1 = parseInt(opts.bot1, 10) || (colCount - top1);
      const titleRow = 2;
      const colorBar1Row = 1;
      const colorBar2Row = 3;
      const schoolRow = 5;
      const periodRow = 6;
      const headerRow = ySplit;
      const dataStartRow = ySplit + 1;
      const bytes = p.bytes;
      let inArr;
      if (bytes && bytes.type === 'Buffer' && Array.isArray(bytes.data)) inArr = new Uint8Array(bytes.data);
      else if (Array.isArray(bytes)) inArr = new Uint8Array(bytes);
      else if (bytes && typeof bytes === 'object') inArr = new Uint8Array(Object.values(bytes));
      else inArr = new Uint8Array(bytes || []);
      const unzipped = fflate.unzipSync(inArr);
      const stylesPath = 'xl/styles.xml';
      const newStyles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="3">'
        +   '<font><sz val="11"/><color theme="1"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>'
        +   '<font><sz val="16"/><b val="1"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>'
        +   '<font><sz val="11"/><b val="1"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>'
        + '</fonts>'
        + '<fills count="9">'
        +   '<fill><patternFill patternType="none"/></fill>'
        +   '<fill><patternFill patternType="gray125"/></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FF2855A0"/><bgColor indexed="64"/></patternFill></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFD4A843"/><bgColor indexed="64"/></patternFill></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FF2E8B57"/><bgColor indexed="64"/></patternFill></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFC0392B"/><bgColor indexed="64"/></patternFill></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F7F7"/><bgColor indexed="64"/></patternFill></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFEAEAEA"/><bgColor indexed="64"/></patternFill></fill>'
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>'
        + '</fills>'
        + '<borders count="6">'
        +   '<border><left/><right/><top/><bottom/><diagonal/></border>'
        +   '<border><left style="thin"><color rgb="FF555555"/></left><right style="thin"><color rgb="FF555555"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>'
        +   '<border><left style="medium"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF555555"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>'
        +   '<border><left style="thin"><color rgb="FF555555"/></left><right style="medium"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>'
        +   '<border><left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>'
        +   '<border><left style="thin"><color rgb="FF555555"/></left><right style="thin"><color rgb="FF555555"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom></border>'
        + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="13">'
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        +   '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>'
        +   '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>'
        +   '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>'
        +   '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>'
        +   '<xf numFmtId="0" fontId="1" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
        +   '<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        +   '<xf numFmtId="0" fontId="2" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        +   '<xf numFmtId="0" fontId="2" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="0"/>'
        + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
        + '</styleSheet>';
      unzipped[stylesPath] = new TextEncoder().encode(newStyles);
      const sheetPath = 'xl/worksheets/sheet1.xml';
      if (!unzipped[sheetPath]) return { success: false, error: 'sheet1.xml not found' };
      let sheetXml = new TextDecoder().decode(unzipped[sheetPath]);
      function numToCol(n){let s='';while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}
      function setCellStyle(rowNum, colIdx0, styleId) {
        const colLetter = numToCol(colIdx0 + 1);
        const ref = colLetter + rowNum;
        const re = new RegExp('<c r="' + ref + '"([^/>]*)(/?)>', 'g');
        sheetXml = sheetXml.replace(re, function(m, attrs, slash) {
          attrs = attrs.replace(/\s*s="\d+"/g, '');
          return '<c r="' + ref + '" s="' + styleId + '"' + attrs + slash + '>';
        });
      }
      for (let i = 0; i < top1; i++) setCellStyle(colorBar1Row, i, 1);
      for (let i = top1; i < colCount; i++) setCellStyle(colorBar1Row, i, 2);
      for (let i = 0; i < bot1; i++) setCellStyle(colorBar2Row, i, 3);
      for (let i = bot1; i < colCount; i++) setCellStyle(colorBar2Row, i, 4);
      for (let i = 0; i < colCount; i++) setCellStyle(titleRow, i, 5);
      for (let i = 0; i < colCount; i++) { setCellStyle(schoolRow, i, 6); setCellStyle(periodRow, i, 6); }
      for (let i = 0; i < colCount; i++) {
        const sid = (i === 0) ? 11 : (i === colCount - 1 ? 12 : 7);
        setCellStyle(headerRow, i, sid);
      }
      const rowMatches = [...sheetXml.matchAll(/<row r="(\d+)"/g)];
      rowMatches.forEach(function(rm){
        const rNum = parseInt(rm[1], 10);
        if (rNum < dataStartRow) return;
        for (let i = 0; i < colCount; i++) {
          const sid = (i === 0) ? 9 : (i === colCount - 1 ? 10 : 8);
          setCellStyle(rNum, i, sid);
        }
      });
      const heights = { 1: 10, 2: 36, 3: 10, 4: 24, 5: 22, 6: 22, 7: 24, [headerRow]: 26 };
      Object.keys(heights).forEach(function(rNumStr){
        const rNum = parseInt(rNumStr, 10);
        const ht = heights[rNum];
        const reRow = new RegExp('<row r="' + rNum + '"([^>]*)>');
        if (reRow.test(sheetXml)) {
          sheetXml = sheetXml.replace(reRow, function(m, attrs){
            attrs = attrs.replace(/\s*ht="[^"]*"/g, '').replace(/\s*customHeight="[^"]*"/g, '');
            return '<row r="' + rNum + '" ht="' + ht + '" customHeight="1"' + attrs + '>';
          });
        }
      });
      const topLeft = 'A' + (ySplit + 1);
      const sheetViewsXml = '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="' + ySplit + '" topLeftCell="' + topLeft + '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="' + topLeft + '" sqref="' + topLeft + '"/></sheetView></sheetViews>';
      if (sheetXml.indexOf('<sheetViews') !== -1) {
        sheetXml = sheetXml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, sheetViewsXml);
      } else if (sheetXml.indexOf('<dimension') !== -1) {
        sheetXml = sheetXml.replace(/(<dimension[^/]*\/>)/, '$1' + sheetViewsXml);
      } else {
        sheetXml = sheetXml.replace(/<worksheet([^>]*)>/, '<worksheet$1>' + sheetViewsXml);
      }
      unzipped[sheetPath] = new TextEncoder().encode(sheetXml);
      const repacked = fflate.zipSync(unzipped, { level: 6 });
      return { success: true, bytes: Array.from(repacked) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};

/* ── 동명이인 보류 JSON 경로 헬퍼 (server.js 로컬) ──
 *  main.js 의 _pendingAmbPath / _cleanupOldPendingAmb 와 동일한 동작.
 *  파일: userData/data/pending_ambiguous_{yr}.json. 학년도 다른 옛 JSON 은 자동 정리. */
function _pendingAmbPathSrv(year) {
  const yr = year || require('../src/main/services/database').HealthDiaryDB.academicYear();
  const dir = services.folders().data();
  return path.join(dir, 'pending_ambiguous_' + yr + '.json');
}
function _cleanupOldPendingAmbSrv(currentYr) {
  try {
    const dir = services.folders().data();
    const files = fs.readdirSync(dir);
    files.forEach(f => {
      const m = f.match(/^pending_ambiguous_(\d{4})\.json(?:\.bak|\.tmp)?$/);
      if (m && m[1] !== String(currentYr)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch(_){}
      }
    });
  } catch(_e) { /* 디렉토리 없으면 무시 */ }
}

/* ══════════════════════════════════════════════════════════
 *  접속자 추적 (세션 기반)
 * ══════════════════════════════════════════════════════════ */
const _sessions = {}; /* sessionId → { ip, userAgent, lastSeen, userName, userSchool, userPosition } */

/* ══════════════════════════════════════════════════════════
 *  실시간 동기화용 데이터 버전 카운터
 *  저장/수정/삭제 발생 시 _dataVersion++ → 다른 클라가 감지 후 재조회
 * ══════════════════════════════════════════════════════════ */
let _dataVersion = Date.now();
/* ── 즉시 알림(SSE) 인프라 (2026-06-07) — 폴링(10초) 위에 얹는 실시간 푸시. 폴링은 안전망으로 유지. ──
 *  · 저장/삭제(웹 HTTP write)는 _bumpDataVersion 에서 즉시 푸시
 *  · 메인(Electron) 직접 write 는 WAL 파일 mtime 변화를 1초 틱으로 감지해 푸시 (양방향 대칭 보장) */
const _sseClients = new Set();
let _lastPushedVersion = 0;
function _currentDataVersion(){
  let mtime = 0;
  try { mtime = fs.statSync(dbPath).mtimeMs || 0; } catch(_){}
  try { mtime = Math.max(mtime, fs.statSync(dbPath + '-wal').mtimeMs || 0); } catch(_){}
  return Math.round(Math.max(mtime, _dataVersion));
}
function _ssePush(){
  const v = _currentDataVersion();
  if (v === _lastPushedVersion) return;
  _lastPushedVersion = v;
  const payload = 'event: data\ndata: ' + v + '\n\n';
  /* res.flush() — compression 미들웨어가 SSE 청크를 버퍼에 가두지 않도록 매 푸시 후 강제 전송 (즉시 반영 보장, 2026-06-07). */
  for (const res of _sseClients) { try { res.write(payload); if (typeof res.flush === 'function') res.flush(); } catch(_e){} }
}
function _bumpDataVersion(){ _dataVersion = Date.now(); _ssePush(); }
/* 메인(Electron) 직접 write 감지 — WAL mtime 변화를 1초마다 확인해 푸시 (구독자 있을 때만). */
setInterval(() => { if (_sseClients.size) _ssePush(); }, 1000);
/* records-* 계열 IPC 채널 호출 시 버전 자동 증가 래퍼 */
function _wrapWrite(h){ return function(p){ const r = h(p); _bumpDataVersion(); return r; }; }

/* 외부 접근 추적 미들웨어 — 모든 요청을 보고 어느 포트로 들어왔는지 기록
 *  · req.socket.localPort: 이 요청이 받은 서버 측 포트 (다중 listen 시 분기 가능)
 *  · req.ip: 클라이언트 IP (X-Forwarded-For 등 처리 후) — loopback 이면 외부 아님
 *  · 같은 LAN 의 동료 PC 가 접속하면 비-루프백 IP 로 들어옴 → 그 포트가 학교 방화벽을 통과했다는 증거 */
app.use((req, res, next) => {
  try {
    const lp = req.socket && req.socket.localPort;
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
    if (lp && !_isLoopbackIp(ip)) {
      _externalHits[lp] = Date.now();
    }
  } catch(_e){
    /* 추적 실패는 무해 — 다음 미들웨어 진행 */
  }
  next();
});

app.use((req, res, next) => {
  /* 정적 파일이나 비 API 요청은 건너뜀 */
  if (req.path.startsWith('/api/')) {
    let sid = req.headers['x-session-id'];
    if (sid && _sessions[sid]) {
      _sessions[sid].lastSeen = Date.now();
    } else if (sid) {
      _sessions[sid] = {
        ip: req.ip || req.connection.remoteAddress || '',
        userAgent: (req.headers['user-agent'] || '').substring(0, 100),
        lastSeen: Date.now(),
        userName: '',
        userSchool: '',
        userPosition: '',
        connectedAt: Date.now(),
      };
    }
  }
  next();
});

/* 30분 이상 비활동 세션 정리 (30초마다) — 휴대폰 잠시 화면 꺼짐 같은 일시 절전을 관용. */
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const sid of Object.keys(_sessions)) {
    if (_sessions[sid].lastSeen < cutoff) delete _sessions[sid];
  }
}, 30000);

/* 접속자 현황 API */
app.get('/api/sessions', (req, res) => {
  /* 호출자 자신은 제외 — X-Session-Id 헤더와 일치하는 세션은 리스트에서 뺀다 */
  const callerSid = req.headers['x-session-id'] || '';
  const list = Object.entries(_sessions)
    .filter(([id]) => id !== callerSid)
    .map(([id, s]) => ({
      id: id.substring(0, 8),
      ip: s.ip.replace('::ffff:', ''),
      userName: s.userName || '',
      userSchool: s.userSchool || '',
      userPosition: s.userPosition || '',
      type: s.type || (/Electron/i.test(s.userAgent) ? 'host' : 'client'),
      connectedAt: new Date(s.connectedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      lastSeen: Math.round((Date.now() - s.lastSeen) / 1000) + '초 전',
      browser: /Chrome/.test(s.userAgent) ? 'Chrome' : /Safari/.test(s.userAgent) ? 'Safari' : /Firefox/.test(s.userAgent) ? 'Firefox' : /Edge/.test(s.userAgent) ? 'Edge' : '기타',
    }));
  res.json({ success: true, count: list.length, sessions: list });
});

/* 세션 식별 정보 등록 — 웹 클라이언트가 로그인 후 자신의 학교/직위/이름을 등록 */
app.post('/api/session-identity', (req, res) => {
  const sid = req.headers['x-session-id'];
  if (sid) {
    if (!_sessions[sid]) {
      _sessions[sid] = {
        ip: req.ip || req.connection.remoteAddress || '',
        userAgent: (req.headers['user-agent'] || '').substring(0, 100),
        lastSeen: Date.now(),
        connectedAt: Date.now(),
      };
    }
    _sessions[sid].userName = req.body.name || '';
    _sessions[sid].userSchool = req.body.school || '';
    _sessions[sid].userPosition = req.body.position || '';
    /* type: 'host' (Electron 앱 직접) or 'client' (웹 브라우저) — 카드 라벨 분기에 사용 */
    if (req.body.type === 'host' || req.body.type === 'client') {
      _sessions[sid].type = req.body.type;
    }
  }
  res.json({ success: true });
});
/* 데이터 버전 — DB 파일 mtime + _dataVersion 카운터 중 큰 값 반환.
   두 경로(Electron 메인 직접 write / 웹 HTTP write) 모두 감지. */
app.get('/api/data-version', (req, res) => {
  let mtime = 0;
  try { mtime = fs.statSync(dbPath).mtimeMs || 0; } catch(_){}
  /* 관련 WAL 파일도 고려 — SQLite WAL 모드에서는 메인 파일이 체크포인트 전까지 안 바뀔 수 있음 */
  try { mtime = Math.max(mtime, fs.statSync(dbPath + '-wal').mtimeMs || 0); } catch(_){}
  const version = Math.max(mtime, _dataVersion);
  res.json({ success: true, version: Math.round(version) });
});

/* ── 즉시 알림 SSE 스트림 — 클라이언트가 EventSource 로 구독, 데이터 변경 시 즉시 푸시 ── */
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 3000\n\n');
  /* 접속 즉시 현재 버전 1회 전송 — 구독 시작과 마지막 폴링 사이 변경분 회수 */
  try { res.write('event: data\ndata: ' + _currentDataVersion() + '\n\n'); } catch(_e){}
  if (typeof res.flush === 'function') res.flush();
  /* SSE 연결을 세션과 묶는다 — 브라우저(탭)가 닫히면 이 연결이 즉시 끊기므로(백그라운드 전환으론
   * 안 끊김) 그 시점에 해당 세션을 정리해 호스트 전광판에서 곧바로 사라지게 한다. (2026-06-07) */
  const _sseSid = (req.query && req.query.sid) ? String(req.query.sid) : '';
  res._collabSid = _sseSid;
  _sseClients.add(res);
  /* 25초마다 keep-alive 주석 — 프록시/브라우저 타임아웃 방지 */
  const _hb = setInterval(() => { try { res.write(': hb\n\n'); if (typeof res.flush === 'function') res.flush(); } catch(_e){} }, 25000);
  req.on('close', () => {
    clearInterval(_hb);
    _sseClients.delete(res);
    /* 같은 sid 의 다른 SSE 연결이 남아있지 않으면(= 그 클라이언트가 완전히 나감) 세션 제거.
     * sessionStorage 기반 sid 는 탭마다 고유하므로 보통 연결 1개 → 닫으면 바로 정리됨.
     * 호스트는 15초 주기 /api/sessions 폴링으로 전광판에서 이름을 내린다. */
    if (_sseSid && _sessions[_sseSid]) {
      let _stillConnected = false;
      for (const c of _sseClients) { if (c._collabSid === _sseSid) { _stillConnected = true; break; } }
      if (!_stillConnected) delete _sessions[_sseSid];
    }
  });
});

/* ══════════════════════════════════════════════════════════
 *  편집 잠금(부드러운 잠금) — 같은 방문 레코드를 동시에 열 때 경고용.
 *  강제 차단 아님(클라이언트가 "그래도 열기" 가능). TTL 로 비정상 종료 시 자동 해제.
 * ══════════════════════════════════════════════════════════ */
const _editLocks = {}; /* recordId → { sid, name, ts } */
const _EDIT_LOCK_TTL = 12000; /* 12초 — 클라이언트는 ~5초마다 heartbeat */
function _pruneEditLocks(){ const now = Date.now(); for (const k of Object.keys(_editLocks)) { if (now - _editLocks[k].ts > _EDIT_LOCK_TTL) delete _editLocks[k]; } }
setInterval(_pruneEditLocks, 5000);
/* 특정 레코드가 "다른 사람"에 의해 편집 중인지 조회 (열기 전 확인용) */
app.get('/api/edit-lock', (req, res) => {
  _pruneEditLocks();
  const sid = req.headers['x-session-id'] || '';
  const rid = String(req.query.recordId || '');
  const l = _editLocks[rid];
  if (rid && l && l.sid !== sid) res.json({ success: true, locked: true, name: l.name || '' });
  else res.json({ success: true, locked: false });
});
/* 편집 잠금 획득/갱신(heartbeat) */
app.post('/api/edit-lock', (req, res) => {
  const sid = req.headers['x-session-id'] || '';
  const rid = String((req.body && req.body.recordId) || '');
  if (rid && sid) _editLocks[rid] = { sid, name: (req.body && req.body.name) || (_sessions[sid] && _sessions[sid].userName) || '', ts: Date.now() };
  res.json({ success: true });
});
/* 편집 잠금 해제(소유자만) */
app.post('/api/edit-unlock', (req, res) => {
  const sid = req.headers['x-session-id'] || '';
  const rid = String((req.body && req.body.recordId) || '');
  if (rid && _editLocks[rid] && _editLocks[rid].sid === sid) delete _editLocks[rid];
  res.json({ success: true });
});
/* 기존 호환: 이름만 등록 */
app.post('/api/session-name', (req, res) => {
  const sid = req.headers['x-session-id'];
  if (sid && _sessions[sid]) {
    _sessions[sid].userName = req.body.name || '';
  }
  res.json({ success: true });
});

/* 서버 정보 API */
app.get('/api/server-info', (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  /* 같은 공유기/학교망 동료가 쓸 "진짜 LAN IP"(192.168/10/172.16-31)를 맨 앞으로 정렬한다.
   * Tailscale 등 가상망 CGNAT(100.64/10)·링크로컬(169.254)은 뒤로 — 같은 LAN 접속엔 안 되는데
   * 어댑터 순서상 앞에 올 때가 있어 대표 주소가 엉뚱하게 표시되던 문제 해결. (2026-06-07) */
  const _ipRank = (ip) => {
    if (/^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 0; /* 일반 사설 LAN */
    if (/^169\.254\./.test(ip)) return 4;                                                              /* 링크로컬(미할당) */
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 3;                                 /* CGNAT(Tailscale 등) */
    return 2;                                                                                          /* 기타(공인 등) */
  };
  ips.sort((a, b) => _ipRank(a) - _ipRank(b));
  /* 활성 포트 배열 — 클라이언트 폴백 시 사용. 점유/권한문제로 listen 실패한 포트는 빠진다. */
  const activePorts = _activePorts.slice();
  /* 사용자에게 안내할 "권장 접속 포트" — 활성 포트들 중 표준순(80 우선)으로 첫 번째 */
  const recommendedPort = activePorts.length ? activePorts[0] : PORT;
  /* 외부 접속 주소 — recommendedPort 가 80 이면 포트 생략(브라우저 표준) */
  const _addrPort = (recommendedPort === 80 ? '' : ':' + recommendedPort);
  /* 외부 접근 자동 추적 결과 — 5분(300,000ms) 이내 외부에서 들어온 포트 = 학교 방화벽 통과 확인 */
  const _now = Date.now();
  const _EXT_FRESH_MS = 5 * 60 * 1000;
  const externalHits = {};
  for (const k of Object.keys(_externalHits)) {
    const ts = _externalHits[k];
    externalHits[k] = { lastHit: ts, fresh: (_now - ts) <= _EXT_FRESH_MS };
  }
  res.json({
    success: true,
    port: PORT,                    /* 호환용 — 기존 코드가 참조 */
    activePorts: activePorts,      /* 신규 — 다중 포트 listen 결과 */
    recommendedPort: recommendedPort,
    externalHits: externalHits,    /* 신규 — 포트별 마지막 외부 접근 (학교 방화벽 통과 증거) */
    ips: ips,
    address: ips.length ? ('http://' + ips[0] + _addrPort) : ('http://localhost' + _addrPort),
    platform: process.platform,
    dbPath: healthDB.dbPath,
  });
});

/* ════════════════════════════════════════════════════════════
 *  포트 점유 검사 API
 *  GET /api/port-scan?ports=80,8080,8000,...
 *
 *  각 포트별로:
 *   1. 우리가 이미 listening 중인 포트 → status: 'active' (현재 활성)
 *   2. net.createServer().listen() 시도:
 *      · 성공 → status: 'available'
 *      · EADDRINUSE → status: 'occupied' (다른 프로세스가 점유)
 *      · EACCES → status: 'denied' (권한 부족, 1024 미만 + 비관리자)
 *      · 기타 → status: 'error'
 *   3. occupied 면 OS 별 명령으로 점유 프로세스 식별 시도:
 *      · win32: netstat -ano + tasklist
 *      · darwin/linux: lsof -i :<port> -P -n -sTCP:LISTEN
 *
 *  주의:
 *   - net.createServer().listen() 의 success 콜백은 OS 가 실제로 bind 한 후에 호출되므로
 *     listen 직후 즉시 close() 해도 다음 사용자가 그 포트를 잡을 수 있음.
 *   - 그러나 우리 서버가 이미 listening 중인 포트를 검사하면 EADDRINUSE 가 나옴 → 별도 분기.
 * ════════════════════════════════════════════════════════════ */

function _checkPortBindable(port){
  return new Promise(function(resolve){
    let resolved = false;
    const tester = net.createServer();
    /* 안전: 빠른 close 가 되도록 backlog 1, 외부 연결은 받지 않음. */
    tester.unref(); /* 프로세스 종료 막지 않게 */
    tester.once('error', function(err){
      if (resolved) return;
      resolved = true;
      const code = err && err.code;
      if (code === 'EADDRINUSE') resolve({ status: 'occupied', errorCode: code });
      else if (code === 'EACCES') resolve({ status: 'denied', errorCode: code });
      else resolve({ status: 'error', errorCode: code || 'UNKNOWN' });
    });
    tester.once('listening', function(){
      if (resolved) return;
      resolved = true;
      try {
        tester.close(function(){
          /* close 콜백 — 정상 해제 후에 결과 반환 */
          resolve({ status: 'available' });
        });
      } catch(_e){
        resolve({ status: 'available' });
      }
    });
    /* 외부 인터페이스에서 LISTEN 가능한지가 핵심이라 0.0.0.0 으로 시도. */
    try {
      tester.listen({ port: port, host: '0.0.0.0', exclusive: true });
    } catch(e){
      if (resolved) return;
      resolved = true;
      resolve({ status: 'error', errorCode: (e && e.code) || 'EXCEPTION' });
    }
    /* 안전망: 어떤 이유로 콜백/에러가 모두 발생하지 않을 경우 3초 후 강제 timeout */
    setTimeout(function(){
      if (resolved) return;
      resolved = true;
      try { tester.close(); } catch(_){}
      resolve({ status: 'error', errorCode: 'TIMEOUT' });
    }, 3000);
  });
}

/* OS별 점유 프로세스 식별 (best-effort, 실패해도 무해 — 단순히 프로세스명 미상 처리) */
function _getPortOwner(port){
  return new Promise(function(resolve){
    const isWin = process.platform === 'win32';
    /* 안전한 명령 (사용자 입력 없음, port 는 숫자) → injection 위험 없음 */
    const cmd = isWin
      ? 'netstat -ano | findstr ":' + port + ' " | findstr LISTENING'
      : 'lsof -nP -iTCP:' + port + ' -sTCP:LISTEN 2>/dev/null';
    exec(cmd, { timeout: 2500, windowsHide: true, encoding: 'utf8' }, function(err, stdout){
      if (err || !stdout) return resolve(null);
      try {
        if (isWin) {
          /* netstat 출력 예: "  TCP    0.0.0.0:80     0.0.0.0:0     LISTENING       4"
             마지막 숫자 컬럼이 PID. /m 플래그로 multi-line 마지막 줄 매칭.
             한국어/영문 환경 무관 (구조 동일). */
          const m = stdout.match(/\s+(\d+)\s*$/m);
          const pid = m ? m[1] : null;
          if (!pid) return resolve(null);
          /* tasklist /NH /FO CSV — CSV 포맷이 한국어/영문 환경 모두에서 안정적 파싱.
             출력 예: "chrome.exe","12345","Console","1","123,456 K"
             첫 필드(이름) 만 추출. 큰따옴표 제거. */
          exec('tasklist /FI "PID eq ' + pid + '" /NH /FO CSV', { timeout: 2500, windowsHide: true, encoding: 'utf8' }, function(e2, out2){
            if (e2 || !out2) return resolve({ pid: pid, processName: null });
            /* CSV 첫 필드 추출 */
            const csvMatch = out2.match(/^"([^"]+)"/m);
            let name = csvMatch ? csvMatch[1] : null;
            /* CSV 매칭 실패 시 폴백 — 공백 분리 */
            if (!name) {
              const fallbackMatch = out2.match(/^(\S+)/m);
              name = fallbackMatch ? fallbackMatch[1] : null;
            }
            /* "Image Name", "이미지 이름" 등의 헤더 라인은 스킵 */
            if (name && (name.toLowerCase() === 'image' || name === '이미지')) name = null;
            resolve({ pid: pid, processName: name });
          });
        } else {
          /* lsof: 첫 줄은 헤더, 두 번째 줄부터 데이터. 첫 컬럼 = COMMAND */
          const lines = stdout.split('\n').filter(Boolean);
          const dataLine = lines[1] || lines[0];
          if (!dataLine) return resolve(null);
          const parts = dataLine.trim().split(/\s+/);
          const name = parts[0] || null;
          const pid = parts[1] || null;
          resolve({ pid: pid, processName: name });
        }
      } catch(_){
        resolve(null);
      }
    });
  });
}

/* ════════════════════════════════════════════════════════════
 *  포트 동적 추가 / 제거 API
 *
 *  POST /api/port-add    { port: N }   — 새 포트 추가 listen
 *  POST /api/port-remove { port: N }   — 그 포트의 listener 제거 (graceful close)
 *
 *  안전 정책:
 *   - 입력 검증: 정수 1~65535 (TCP 표준 범위)
 *   - 권한이 필요한 1024 미만 포트는 OS 가 EACCES 반환 → success:false 로 응답
 *   - 이미 활성인 포트 add → noop (already active)
 *   - 마지막 남은 활성 포트 remove → 거부 (서비스 중단 방지)
 *   - graceful close: server.close() 는 새 연결만 거부, 활성 연결은 자연 종료까지 유지
 *     → 동료 교사 화면이 갑자기 끊기지 않음
 *
 *  ※ 이 API 는 호스트 본인 PC 의 신뢰 LAN 에서만 사용. 인증 없음 — 같은 학교 내부망 신뢰 모델. */

function _addListenPort(port){
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ success: false, error: 'invalid_port' });
  }
  if (_activePorts.indexOf(port) !== -1) {
    return Promise.resolve({ success: false, error: 'already_active', port: port });
  }
  return new Promise(function(resolve){
    let resolved = false;
    const server = app.listen(port);
    function _cleanup(){
      try { server.removeAllListeners('listening'); } catch(_){}
      try { server.removeAllListeners('error'); } catch(_){}
    }
    server.once('listening', function(){
      if (resolved) return; resolved = true;
      _cleanup();
      _activeServers.push(server);
      _activePorts.push(port);
      console.log('  [WEB] ✅ port', port, 'added');
      resolve({ success: true, port: port });
    });
    server.once('error', function(err){
      if (resolved) return; resolved = true;
      _cleanup();
      const code = (err && err.code) || 'UNKNOWN';
      console.warn('  [WEB] ⚠ failed to add port', port, '—', code);
      try { server.close(); } catch(_){}
      resolve({ success: false, error: code, port: port });
    });
  });
}

function _removeListenPort(port){
  const idx = _activePorts.indexOf(port);
  if (idx === -1) {
    return Promise.resolve({ success: false, error: 'not_active', port: port });
  }
  /* 마지막 남은 활성 포트 제거는 거부 — 서비스 자체가 중단되어 사용자가 다시 켜기 어려움 */
  if (_activePorts.length === 1) {
    return Promise.resolve({ success: false, error: 'last_port', port: port });
  }
  const server = _activeServers[idx];
  return new Promise(function(resolve){
    let resolved = false;
    /* 5초 timeout — close 가 끝나지 않아도 사용자 응답 막지 않음 */
    const t = setTimeout(function(){
      if (resolved) return; resolved = true;
      console.warn('  [WEB] ⚠ port', port, 'close timeout — listeners array updated anyway');
      _activeServers.splice(idx, 1);
      _activePorts.splice(idx, 1);
      resolve({ success: true, port: port, note: 'close_timeout' });
    }, 5000);
    try {
      server.close(function(err){
        if (resolved) return; resolved = true;
        clearTimeout(t);
        /* close 콜백 시점에 idx 가 stale 일 수 있음 — 다시 찾기 */
        const curIdx = _activePorts.indexOf(port);
        if (curIdx !== -1) {
          _activeServers.splice(curIdx, 1);
          _activePorts.splice(curIdx, 1);
        }
        if (err) {
          console.warn('  [WEB] port', port, 'close error:', err.message);
          resolve({ success: false, error: err.message, port: port });
        } else {
          console.log('  [WEB] ✅ port', port, 'removed');
          resolve({ success: true, port: port });
        }
      });
    } catch(e){
      if (resolved) return; resolved = true;
      clearTimeout(t);
      resolve({ success: false, error: (e && e.message) || 'exception', port: port });
    }
  });
}

app.post('/api/port-add', async function(req, res){
  const port = req.body && req.body.port;
  if (typeof port !== 'number') return res.status(400).json({ success: false, error: 'port must be number' });
  const r = await _addListenPort(port);
  res.json(r);
});

app.post('/api/port-remove', async function(req, res){
  const port = req.body && req.body.port;
  if (typeof port !== 'number') return res.status(400).json({ success: false, error: 'port must be number' });
  const r = await _removeListenPort(port);
  res.json(r);
});

app.get('/api/port-scan', async function(req, res){
  /* 쿼리 파라미터 파싱 — 안전: 정수만 추출, 1~65535 범위, 최대 16개 */
  const raw = String(req.query.ports || '').trim();
  let portsToCheck;
  if (raw) {
    portsToCheck = raw.split(',')
      .map(function(s){ return parseInt(String(s).trim(), 10); })
      .filter(function(n){ return Number.isInteger(n) && n >= 1 && n <= 65535; })
      .slice(0, 16);
  } else {
    /* 기본: PREFERRED_PORTS 그대로 */
    portsToCheck = PREFERRED_PORTS.slice();
  }
  if (portsToCheck.length === 0) {
    return res.json({ success: false, error: 'no valid ports' });
  }
  const activeSet = new Set(_activePorts);
  const results = [];
  const _now = Date.now();
  const _EXT_FRESH_MS = 5 * 60 * 1000;
  /* 직렬 실행 — 동시에 너무 많은 net 인스턴스 만들면 일부 OS 에서 자원 경합 */
  for (const p of portsToCheck) {
    /* 외부 접근 정보 — 5분 이내 외부 접근이 있었으면 'pass', 활성 포트지만 외부 접근 없으면 'pending' */
    const hit = _externalHits[p];
    const externalFresh = hit && (_now - hit) <= _EXT_FRESH_MS;
    const externalState = externalFresh
      ? { state: 'pass', lastHit: hit, ageMs: _now - hit }
      : (hit ? { state: 'stale', lastHit: hit, ageMs: _now - hit } : { state: 'pending', lastHit: null });
    if (activeSet.has(p)) {
      results.push({ port: p, status: 'active', note: 'currently used by this server', external: externalState });
      continue;
    }
    const r = await _checkPortBindable(p);
    if (r.status === 'occupied') {
      const owner = await _getPortOwner(p);
      results.push({ port: p, status: 'occupied', errorCode: r.errorCode, owner: owner, external: externalState });
    } else {
      results.push({ port: p, status: r.status, errorCode: r.errorCode || null, external: externalState });
    }
  }
  res.json({ success: true, results: results });
});

/* ── 범용 IPC 라우트 ── */
app.post('/api/ipc/:channel', async (req, res) => {
  const channel = req.params.channel;
  const handler = handlers[channel];
  if (!handler) {
    console.warn('[WEB] Unknown IPC channel:', channel);
    return res.status(404).json({ success: false, error: 'Unknown channel: ' + channel });
  }
  try {
    const ctx = { sessionId: req.headers['x-session-id'] || null, sessions: _sessions };
    const result = await handler(req.body || {}, ctx);
    res.json(result != null ? result : { success: true });
  } catch (err) {
    console.error('[WEB] IPC error:', channel, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════
 * 서버 시작 — 다중 포트 listening
 *
 * PREFERRED_PORTS 의 각 포트에 대해 순차 시도:
 *   - 성공하면 _activeServers / _activePorts 에 기록 (이미 위쪽에서 const 로 선언됨)
 *   - EADDRINUSE / EACCES 등 실패는 콘솔 경고 후 다음 포트로 진행
 *
 * 모든 포트 listen 실패 시:
 *   - 시작 자체를 막진 않음 (프로세스는 살려둠 — 사용자가 후속 액션 가능)
 *   - 단, 명확한 에러 메시지 출력
 *
 * ※ 여러 포트로 listening 해도 같은 `app` 핸들러를 공유하므로 라우트/세션/IPC 동작 동일.
 * ════════════════════════════════════════════════════════════ */
function _tryListenPort(port){
  return new Promise(function(resolve){
    let resolved = false;
    const server = app.listen(port);
    function _cleanup(){
      try { server.removeAllListeners('listening'); } catch(_){}
      try { server.removeAllListeners('error'); } catch(_){}
    }
    server.once('listening', function(){
      if (resolved) return;
      resolved = true;
      _cleanup();
      _activeServers.push(server);
      _activePorts.push(port);
      console.log('  [WEB] ✅ listening on port', port);
      resolve(true);
    });
    server.once('error', function(err){
      if (resolved) return;
      resolved = true;
      _cleanup();
      try { server.close(); } catch(_){}
      if (err && err.code === 'EADDRINUSE') {
        console.warn('  [WEB] ⚠ port', port, 'already in use — skip');
      } else if (err && err.code === 'EACCES') {
        console.warn('  [WEB] ⚠ port', port, 'permission denied (need admin?) — skip');
      } else {
        console.warn('  [WEB] ⚠ port', port, 'error:', err && err.code || err);
      }
      resolve(false);
    });
  });
}

(async function _bootListen(){
  console.log('\n  ┌─────────────────────────────────────────┐');
  console.log('  │  오렌지톡 — 웹 브라우저 버전        │');
  console.log('  └─────────────────────────────────────────┘');
  for (const p of PREFERRED_PORTS) {
    await _tryListenPort(p);
  }
  if (_activePorts.length === 0) {
    console.error('  [WEB] ❌ FATAL: 사용 가능한 포트가 없습니다. 모든 포트(' + PREFERRED_PORTS.join(', ') + ') 가 점유 또는 권한 부족입니다.');
    console.error('  [WEB]    → 다른 프로세스를 종료하거나 관리자 권한으로 재시도해주세요.');
    return;
  }
  /* 시작 안내 — 사용자가 안내할 표준 주소 (포트 80 이 활성이면 포트 생략) */
  const _primary = _activePorts[0];
  const _addrSuffix = (_primary === 80 ? '' : ':' + _primary);
  console.log('  [WEB] active ports: ' + _activePorts.join(', '));
  console.log('  [WEB] 동료 접속 주소(예시): http://localhost' + _addrSuffix);
  console.log('  [WEB] DB: ' + dbPath + '\n');
})();

/* ════════════════════════════════════════════════════════════
   의료기관 탐색 전용 서버 (포트 7700) — 카카오맵 SDK 도메인 인증을 위해 고정 포트 사용.
   Electron 메인 프로세스와 동일한 방식: med-facility.html 과 assets 를 localhost:7700 에서 서빙.
   이 서버 없이 localhost:3000 에서 열면 Referer 불일치로 카카오맵 SDK 가 작동하지 않음.
   ════════════════════════════════════════════════════════════ */
const medApp = express();
/* iframe 로드 차단 해제 — localhost:3000 에서 localhost:7700 을 iframe 으로 embed 허용
   + CORS — 메인 서버 포트 폴백 시 7700 으로 fetch 가 cross-origin 처리되지 않도록 */
medApp.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
/* /api/ipc/* 프록시 — med-facility iframe 은 localhost:7700 컨텍스트인데
   web-api-bridge.js 가 상대 URL(/api/ipc/*) 로 fetch 하므로 7700 서버가 3000 의 핸들러를 공유해야 함.
   Express 의 handlers 객체(메인 IPC 라우트에서 쓰는) 를 동일하게 사용 */
medApp.use(express.json({ limit: '50mb' }));
medApp.post('/api/ipc/:channel', async (req, res) => {
  const channel = req.params.channel;
  const handler = handlers[channel];
  if (!handler) return res.status(404).json({ success: false, error: 'Unknown channel: ' + channel });
  try {
    const ctx = { sessionId: req.headers['x-session-id'] || null, sessions: _sessions };
    const result = await handler(req.body || {}, ctx);
    res.json(result != null ? result : { success: true });
  } catch (err) {
    console.error('[MedFac][IPC]', channel, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
medApp.use(express.static(electronRoot));
medApp.get('/', (req, res) => { res.redirect('/med-facility.html'); });
medApp.listen(7700, '127.0.0.1', () => {
  console.log('  [MedFac] http://localhost:7700/med-facility.html (카카오맵 전용)');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.warn('  [MedFac] 포트 7700 이미 사용 중 — 기존 서버 사용');
  else console.error('  [MedFac] 에러:', err.message);
});
