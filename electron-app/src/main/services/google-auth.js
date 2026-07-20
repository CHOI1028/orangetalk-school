/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * google-auth.js — Google OAuth 2.0 PKCE 인증 모듈
 *
 * 자격증명 로드 우선순위:
 *   1. bundled-credentials.js (빌드 시 암호화 번들) — 배포 빌드
 *   2. 환경변수 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — CI/테스트
 *   3. oauth-client.json — 개발 로컬
 *
 * 토큰 저장:
 *   - electron.safeStorage (macOS Keychain / Windows DPAPI / Linux libsecret)
 *   - 위치: userData/auth/token_main.enc, userData/auth/token_sheets.enc
 *   - 평문 토큰 파일(.gauth_token)이 있으면 암호화 저장소로 자동 전환
 */

const { shell, BrowserWindow } = require('electron');
const crypto = require('crypto');
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { CredentialStore } = require('./infra-config-service');
let _credStore = null;
function getCredentialStore() {
  if (!_credStore) _credStore = new CredentialStore(require('electron').app.getPath('userData'));
  return _credStore;
}

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  /* drive.file 은 드라이브 백업/폴더 기능 전용 — 검증 데모에 미포함이라 제거(나중에 데모 추가 후 재신청). 시트 내보내기는 Sheets API(spreadsheets)만 사용해 영향 없음. (2026-07-02) */
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  /* calendar 전체 — 일정 CRUD(events) + 공유 대상 조회·설정(acl). calendar.acl API 는 전체 calendar 스코프 필요. (2026-07-02) */
  'https://www.googleapis.com/auth/calendar',
];

// ---------------------------------------------------------------------------
// OAuth 자격증명 (Client ID / Client Secret)
// ---------------------------------------------------------------------------

let _cachedConfig = null;

/** bundled-credentials.js에서 AES-256-GCM 복호화 */
function _decryptBundle(b) {
  try {
    const k1  = Buffer.from(b._a, 'hex');
    const k2  = Buffer.from(b._b, 'hex');
    const k3  = Buffer.from(b._c, 'hex');
    const key = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) key[i] = k1[i] ^ k2[i] ^ k3[i];

    const iv  = Buffer.from(b._i, 'hex');
    const tag = Buffer.from(b._t, 'hex');
    const enc = Buffer.from(b._e, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (_err) {
    return null;
  }
}

/** bundled-credentials.js 로드 시도. 없거나 실패하면 null */
function _loadBundledConfig() {
  try {
    const bundledPath = path.join(__dirname, 'bundled-credentials.js');
    if (!fs.existsSync(bundledPath)) return null;
    const bundle = require(bundledPath);
    return _decryptBundle(bundle);
  } catch (_err) {
    return null;
  }
}

/** oauth-client.json 파일 읽기 (개발용 폴백) */
function _loadFileConfig() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'oauth-client.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'oauth-client.json') : null,
  ].filter(Boolean);

  for (const fp of candidates) {
    try {
      if (!fs.existsSync(fp)) continue;
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const ins = raw.installed || null;
      const web = raw.web       || null;
      const clientId = (raw.clientId || raw.client_id ||
        (ins && ins.client_id) || (web && web.client_id) || '').trim();
      const clientSecret = (raw.clientSecret || raw.client_secret ||
        (ins && ins.client_secret) || (web && web.client_secret) || '').trim();
      if (clientId && clientSecret) return { clientId, clientSecret };
    } catch (_err) { /* skip */ }
  }
  return null;
}

function resolveOAuthConfig() {
  if (_cachedConfig) return _cachedConfig;

  // 1순위: 빌드 번들
  const bundled = _loadBundledConfig();
  if (bundled && bundled.clientId && bundled.clientSecret) {
    _cachedConfig = { clientId: bundled.clientId, clientSecret: bundled.clientSecret, hasConfig: true };
    return _cachedConfig;
  }

  // 2순위: 환경변수
  const envId     = (process.env.GOOGLE_CLIENT_ID     || '').trim();
  const envSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (envId && envSecret) {
    _cachedConfig = { clientId: envId, clientSecret: envSecret, hasConfig: true };
    return _cachedConfig;
  }

  // 3순위: oauth-client.json (개발 로컬)
  const file = _loadFileConfig();
  if (file) {
    _cachedConfig = { ...file, hasConfig: true };
    return _cachedConfig;
  }

  _cachedConfig = { clientId: '', clientSecret: '', hasConfig: false };
  return _cachedConfig;
}

function getAuthConfigStatus() {
  const cfg = resolveOAuthConfig();
  let source = 'none';
  if (cfg.hasConfig) {
    if (_loadBundledConfig()) source = 'bundled';
    else if ((process.env.GOOGLE_CLIENT_ID || '').trim()) source = 'env';
    else source = 'file';
  }
  return { hasConfig: cfg.hasConfig, source };
}

function assertOAuthConfig() {
  const cfg = resolveOAuthConfig();
  if (!cfg.hasConfig) {
    throw new Error(
      'OAuth 설정이 없습니다.\n' +
      '개발: electron-app/oauth-client.json 생성\n' +
      '배포: node scripts/bundle-credentials.js 실행'
    );
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// PKCE helpers (RFC 7636)
// ---------------------------------------------------------------------------

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

function refreshAccessToken(cfg, refreshToken) {
  return new Promise((resolve, reject) => {
    const postData =
      'client_id='     + encodeURIComponent(cfg.clientId) +
      '&client_secret='+ encodeURIComponent(cfg.clientSecret) +
      '&refresh_token='+ encodeURIComponent(refreshToken) +
      '&grant_type=refresh_token';

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.access_token) resolve(data);
          else reject(new Error(data.error_description || 'Token refresh failed'));
        } catch (_err) {
          reject(new Error('Token refresh response parse failed'));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// OAuth flow: external browser + loopback 127.0.0.1 + PKCE S256
// ---------------------------------------------------------------------------

function startGoogleAuth() {
  return new Promise((resolve, reject) => {
    const cfg          = assertOAuthConfig();
    const state        = crypto.randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    let settled = false;
    let authWindow = null;  /* 앱 내부 Google 로그인 창 */
    const _closeAuthWindow = () => {
      if (authWindow && !authWindow.isDestroyed()) {
        try { authWindow.close(); } catch (e) {}
      }
      authWindow = null;
    };

    const server = http.createServer(async (req, res) => {
      if (settled) return;

      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (reqUrl.pathname !== '/oauth2callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const error         = reqUrl.searchParams.get('error');
      const returnedState = reqUrl.searchParams.get('state');
      const code          = reqUrl.searchParams.get('code');

      if (error || returnedState !== state || !code) {
        settled = true;
        res.writeHead(400, { 'Content-Type': 'text/html;charset=utf-8' });
        res.end(
          '<html><body style="font-family:sans-serif;text-align:center;padding-top:80px">' +
          '<h2>로그인 실패</h2>' +
          '<p>' + (error || '요청 검증(state)에 실패했습니다.') + '</p>' +
          '<p>이 창을 닫아도 됩니다.</p></body></html>'
        );
        server.close();
        _closeAuthWindow();
        reject(new Error(error || 'OAuth state mismatch'));
        return;
      }

      settled = true;
      const serverPort = server.address().port;
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      res.end(
        '<html><body style="font-family:sans-serif;text-align:center;padding-top:80px">' +
        '<h2>로그인 성공!</h2>' +
        '<p>이 탭을 닫고 오렌지톡으로 돌아가세요.</p></body></html>'
      );
      server.close();
      _closeAuthWindow();

      try {
        const redirectUri = 'http://127.0.0.1:' + serverPort + '/oauth2callback';
        const tokens   = await _exchangeCode(code, cfg, redirectUri, codeVerifier);
        const userInfo = await getUserInfo(tokens.access_token);
        resolve({
          client: {
            accessToken:  tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt:    Date.now() + (tokens.expires_in || 3600) * 1000,
          },
          userInfo,
        });
      } catch (err) {
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port        = server.address().port;
      const redirectUri = 'http://127.0.0.1:' + port + '/oauth2callback';

      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        'client_id='             + encodeURIComponent(cfg.clientId) +
        '&redirect_uri='         + encodeURIComponent(redirectUri) +
        '&response_type=code' +
        '&scope='                + encodeURIComponent(SCOPES.join(' ')) +
        '&access_type=offline' +
        '&state='                + encodeURIComponent(state) +
        '&code_challenge='       + encodeURIComponent(codeChallenge) +
        '&code_challenge_method=S256' +
        '&prompt=consent';

      /* 외부 브라우저 대신 앱 내부 전용 창에서 로그인 — 완료 시 이 창만 닫혀 사용자의 다른 탭에 영향 없음.
         메인 창 위에 모달로 띄워 앱에 통합된 느낌. 단 창 내부는 Google 로그인 페이지라 변경 불가(Google 소유) */
      const _parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
      authWindow = new BrowserWindow({
        width: 480,
        height: 720,
        parent: _parent || undefined,
        modal: !!_parent,
        center: true,
        frame: false,
        resizable: false,
        title: '오렌지톡 — Google 로그인',
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      /* 무프레임(frame:false) 창 — 닫기 버튼이 없으므로 ESC 키로 닫기(취소) */
      authWindow.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { _closeAuthWindow(); }
      });
      /* Google 이 임베디드 user-agent 를 차단(disallowed_useragent)하지 않도록 Electron/앱 토큰 제거 */
      const _ua = authWindow.webContents.getUserAgent()
        .replace(/ Electron\/[^\s]+/i, '')
        .replace(/ OrangeTalk\/[^\s]+/i, '')
        .replace(/ OrangePharm[^\s]*/i, '');
      authWindow.loadURL(authUrl, { userAgent: _ua });
      authWindow.on('closed', () => {
        authWindow = null;
        /* 로그인 완료 전 사용자가 창을 닫으면 취소로 처리 */
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error('Google 로그인이 취소되었습니다.'));
        }
      });
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        _closeAuthWindow();
        reject(new Error('Google 로그인 시간이 초과되었습니다. 다시 시도해주세요.'));
      }
    }, 5 * 60 * 1000);

    server.on('close', () => clearTimeout(timeout));
  });
}

// ---------------------------------------------------------------------------
// Code exchange
// ---------------------------------------------------------------------------

function _exchangeCode(code, cfg, redirectUri, codeVerifier) {
  return new Promise((resolve, reject) => {
    const postData =
      'code='            + encodeURIComponent(code) +
      '&client_id='      + encodeURIComponent(cfg.clientId) +
      '&client_secret='  + encodeURIComponent(cfg.clientSecret) +
      '&redirect_uri='   + encodeURIComponent(redirectUri) +
      '&code_verifier='  + encodeURIComponent(codeVerifier) +
      '&grant_type=authorization_code';

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.access_token) resolve(data);
          else reject(new Error(data.error_description || 'Token exchange failed'));
        } catch (_err) {
          reject(new Error('Token response parse failed'));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// User info
// ---------------------------------------------------------------------------

function getUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ name: data.name, email: data.email, picture: data.picture });
        } catch (_err) {
          reject(new Error('User info response parse failed'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 메인 계정 토큰 관리 (safeStorage → userData/auth/token_main.enc)
// ---------------------------------------------------------------------------

const TOKEN_NAME_MAIN   = 'token_main';
const TOKEN_NAME_SHEETS = 'token_sheets';

/** 평문 토큰 파일(.gauth_token)을 암호화 저장소로 자동 전환 */
function _migrateOldTokenFiles() {
  const store = getCredentialStore();
  store.migrateFromPlaintext(TOKEN_NAME_MAIN,
    path.join(__dirname, '..', '..', '..', '.gauth_token'));
  store.migrateFromPlaintext(TOKEN_NAME_SHEETS,
    path.join(__dirname, '..', '..', '..', '.gauth_token_sheets'));
}

let _authState = null;

function setAuthState(state) {
  _authState = state;
  try {
    getCredentialStore().saveToken(TOKEN_NAME_MAIN, {
      accessToken:  state.accessToken,
      refreshToken: state.refreshToken,
      expiresAt:    state.expiresAt,
    });
  } catch (err) {
    console.error('[Auth] 메인 토큰 저장 실패:', err.message);
  }
}

function getAuthState() {
  return _authState;
}

function restoreAuthState() {
  _migrateOldTokenFiles();
  try {
    const data = getCredentialStore().loadToken(TOKEN_NAME_MAIN);
    if (data && data.refreshToken) {
      _authState = data;
      return true;
    }
  } catch (err) {
    console.warn('[Auth] 메인 토큰 복원 실패:', err.message);
  }
  return false;
}

async function getValidAccessToken() {
  if (!_authState) throw new Error('Not authenticated');

  if (_authState.expiresAt && Date.now() > _authState.expiresAt - 60 * 1000) {
    if (!_authState.refreshToken) throw new Error('No refresh token available');
    const cfg      = resolveOAuthConfig();
    const refreshed = await refreshAccessToken(cfg, _authState.refreshToken);
    _authState.accessToken = refreshed.access_token;
    _authState.expiresAt   = Date.now() + (refreshed.expires_in || 3600) * 1000;
    /* 갱신된 토큰 즉시 저장 */
    setAuthState(_authState);
  }

  return _authState.accessToken;
}

// ---------------------------------------------------------------------------
// Sheets 전용 계정 (서브 계정)
// ---------------------------------------------------------------------------

let _sheetsAuthState = null;
let _sheetsUserInfo  = null;

function setSheetsAuthState(state) {
  _sheetsAuthState = state;
  try {
    getCredentialStore().saveToken(TOKEN_NAME_SHEETS, {
      ...state,
      userInfo: _sheetsUserInfo || undefined,
    });
  } catch (err) {
    console.error('[Auth] Sheets 토큰 저장 실패:', err.message);
  }
}

function getSheetsAuthState() { return _sheetsAuthState; }
function getSheetsUserInfo()  { return _sheetsUserInfo; }

function setSheetsUserInfo(info) {
  _sheetsUserInfo = info;
  if (_sheetsAuthState) {
    try {
      getCredentialStore().saveToken(TOKEN_NAME_SHEETS, {
        ..._sheetsAuthState,
        userInfo: info,
      });
    } catch (err) {
      console.error('[Auth] Sheets 유저 정보 저장 실패:', err.message);
    }
  }
}

function restoreSheetsAuthState() {
  try {
    const data = getCredentialStore().loadToken(TOKEN_NAME_SHEETS);
    if (data && data.refreshToken) {
      _sheetsAuthState = {
        accessToken:  data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt:    data.expiresAt,
      };
      _sheetsUserInfo = data.userInfo || null;
      return true;
    }
  } catch (err) {
    console.warn('[Auth] Sheets 토큰 복원 실패:', err.message);
  }
  return false;
}

function clearSheetsAuth() {
  _sheetsAuthState = null;
  _sheetsUserInfo  = null;
  try { getCredentialStore().deleteToken(TOKEN_NAME_SHEETS); } catch (_err) {}
}

async function getValidSheetsAccessToken() {
  if (!_sheetsAuthState) throw new Error('Sheets account not authenticated');

  if (_sheetsAuthState.expiresAt && Date.now() > _sheetsAuthState.expiresAt - 60 * 1000) {
    if (!_sheetsAuthState.refreshToken) throw new Error('No sheets refresh token');
    const cfg      = resolveOAuthConfig();
    const refreshed = await refreshAccessToken(cfg, _sheetsAuthState.refreshToken);
    _sheetsAuthState.accessToken = refreshed.access_token;
    _sheetsAuthState.expiresAt   = Date.now() + (refreshed.expires_in || 3600) * 1000;
    setSheetsAuthState(_sheetsAuthState);
  }

  return _sheetsAuthState.accessToken;
}

/** Sheets 작업용 토큰: Sheets 전용 계정 우선, 없으면 메인 계정 */
async function getSheetsToken() {
  if (_sheetsAuthState) return getValidSheetsAccessToken();
  return getValidAccessToken();
}

// ---------------------------------------------------------------------------

module.exports = {
  startGoogleAuth,
  getAuthConfigStatus,
  setAuthState,
  getAuthState,
  getValidAccessToken,
  restoreAuthState,
  getUserInfo,
  setSheetsAuthState,
  getSheetsAuthState,
  getSheetsUserInfo,
  setSheetsUserInfo,
  restoreSheetsAuthState,
  clearSheetsAuth,
  getValidSheetsAccessToken,
  getSheetsToken,
};
