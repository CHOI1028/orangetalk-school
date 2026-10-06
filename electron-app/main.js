/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
const { app, BrowserWindow, ipcMain, shell, screen, dialog, Menu } = require('electron');

/* Main-window preferences are separate from school and user records. */
function _createRememberedSchoolWindow(options) {
  const windowFs = require('fs');
  const windowPath = require('path');
  const statePath = windowPath.join(app.getPath('userData'), 'school-window-state.json');
  let saved = null;
  try {
    const candidate = JSON.parse(windowFs.readFileSync(statePath, 'utf8'));
    const bounds = candidate && candidate.bounds;
    if (bounds && ['x', 'y', 'width', 'height'].every(function (key) {
      return Number.isFinite(bounds[key]);
    }) && bounds.width > 0 && bounds.height > 0) saved = candidate;
  } catch (_) { /* A missing or invalid preference uses the first-launch size. */ }

  const primary = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  let display = primary;
  if (saved) {
    const previousDisplay = displays.find(function (item) { return item.id === saved.displayId; });
    if (previousDisplay) {
      display = previousDisplay;
    } else {
      let largestOverlap = 0;
      displays.forEach(function (item) {
        const area = item.workArea;
        const bounds = saved.bounds;
        const overlap = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x))
          * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
        if (overlap > largestOverlap) { display = item; largestOverlap = overlap; }
      });
    }
  }
  const area = display.workArea;
  const minWidth = Math.min(800, area.width);
  const minHeight = Math.min(600, area.height);
  // Migrate legacy default-sized windows once without overriding other saved sizes.
  const legacyDefaultSize = saved && Number(saved.defaultSizeVersion || 1) < 2
    && saved.bounds.width === Math.min(1200, area.width)
    && saved.bounds.height === Math.min(800, area.height);
  const useSavedSize = saved && !legacyDefaultSize;
  const width = Math.min(area.width, Math.max(minWidth, Math.round(useSavedSize ? saved.bounds.width : 1800)));
  const height = Math.min(area.height, Math.max(minHeight, Math.round(useSavedSize ? saved.bounds.height : 1200)));
  const overlapsDisplay = useSavedSize && saved.bounds.x < area.x + area.width
    && saved.bounds.x + saved.bounds.width > area.x && saved.bounds.y < area.y + area.height
    && saved.bounds.y + saved.bounds.height > area.y;
  let normalBounds = {
    x: overlapsDisplay ? Math.max(area.x, Math.min(Math.round(saved.bounds.x), area.x + area.width - width)) : area.x + Math.round((area.width - width) / 2),
    y: overlapsDisplay ? Math.max(area.y, Math.min(Math.round(saved.bounds.y), area.y + area.height - height)) : area.y + Math.round((area.height - height) / 2),
    width: width,
    height: height
  };
  let maximized = !!(saved && saved.maximized === true);
  const win = new BrowserWindow(Object.assign({}, options, normalBounds, { minWidth: minWidth, minHeight: minHeight }));
  let saveTimer = null;

  function captureNormalBounds() {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    maximized = win.isMaximized();
    if (!maximized) normalBounds = win.getBounds();
  }
  function saveWindowState() {
    if (win.isDestroyed()) return;
    captureNormalBounds();
    try {
      const state = {
        defaultSizeVersion: 2,
        bounds: normalBounds,
        maximized: maximized,
        displayId: screen.getDisplayMatching(normalBounds).id
      };
      windowFs.mkdirSync(windowPath.dirname(statePath), { recursive: true });
      windowFs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), 'utf8');
      windowFs.renameSync(statePath + '.tmp', statePath);
    } catch (error) {
      console.warn('[window-state] Could not save window preferences:', error.message);
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 350);
  }
  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('maximize', function () { maximized = true; scheduleSave(); });
  win.on('unmaximize', function () { maximized = false; scheduleSave(); });
  win.on('minimize', function () { clearTimeout(saveTimer); saveWindowState(); });
  win.on('close', function () { clearTimeout(saveTimer); saveWindowState(); });
  win.on('closed', function () { clearTimeout(saveTimer); });
  if (maximized) win.maximize();
  return win;
}


/* 사전공개 Beta 만료일 (표시용) — 배지/메시지에 "이 날짜까지" 로 노출되는 공식 만료일.
   배지의 "남은 일수: O일" 도 이 값을 단일 출처로 계산. */
const BETA_EXPIRES_AT = '2026-05-31';
/* 실제 차단 시작일 — 이 날짜까지는 그대로 사용 가능, 다음날 00시부터 안내 모달 + 이름 검색·상세 검색 락.
   BETA_EXPIRES_AT 이후 7일 grace 를 두는 정책. 정식 출시 후 인증코드 입력으로 해제. */
const BETA_BLOCK_AT = '2026-06-07';
/* DevTools·Reload 단축키 — 메뉴 제거로 기본 단축키가 사라졌으므로 직접 바인딩.
   DevTools: Cmd+Opt+I (Mac) / Ctrl+Shift+I (Win) / F12
   Reload:   Cmd+R / Ctrl+R
   Hard Reload (캐시 무시): Cmd+Shift+R / Ctrl+Shift+R / F5
   Close Window: Cmd+W (Mac) */
function _bindDevToolsShortcut(win) {
  if (!win || !win.webContents) return;
  win.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();
    const modMeta = input.meta;     /* Cmd (Mac) */
    const modCtrl = input.control;  /* Ctrl (Win/Linux) */
    const modMod  = process.platform === 'darwin' ? modMeta : modCtrl;

    /* DevTools */
    const isI = key === 'i';
    const macDev = process.platform === 'darwin' && modMeta && input.alt && isI;
    const winDev = process.platform !== 'darwin' && modCtrl && input.shift && isI;
    if (macDev || winDev || input.key === 'F12') {
      event.preventDefault();
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
      return;
    }

    /* Reload / Hard Reload */
    if (modMod && key === 'r') {
      event.preventDefault();
      if (input.shift) win.webContents.reloadIgnoringCache();
      else win.webContents.reload();
      return;
    }
    if (input.key === 'F5') {
      event.preventDefault();
      if (input.shift || input.control) win.webContents.reloadIgnoringCache();
      else win.webContents.reload();
      return;
    }

    /* Close Window — Mac 에서 Cmd+W */
    if (process.platform === 'darwin' && modMeta && key === 'w') {
      event.preventDefault();
      win.close();
      return;
    }
    
  });
}

/* ── Chromium 렌더링 플래그 — Windows 에서 Mac 수준 품질 유지 ─────────
   GPU 가속·backdrop-filter·서브픽셀 안티에일리어싱 보장 */
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
/* ElasticOverscroll — Windows Chromium 에서 Mac 스타일 고무줄(바운스) 스크롤 활성.
   기본은 꺼져 있어 스크롤 끝에서 딱 멈추는데, 켜면 Mac 처럼 부드럽게 튕긴다. */
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization,Vulkan,ElasticOverscroll');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('font-render-hinting', 'none');
/* Windows 에서 애니메이션 설정 OFF 인 경우에도 CSS transition 유지 */
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

const path = require('path');
const fs = require('fs');
const { startGoogleAuth, getAuthConfigStatus, setAuthState, getValidAccessToken, restoreAuthState, setSheetsAuthState, setSheetsUserInfo, getSheetsUserInfo, restoreSheetsAuthState, clearSheetsAuth, getSheetsToken, getUserInfo } = require('./src/main/services/google-auth');
const { readSheet, writeSheet, getSheetMetadata, createSpreadsheet, batchUpdateSpreadsheet, driveListFolders, driveCreateFolder, driveMoveFile, driveUploadJson, driveUpdateJson, driveSearchFile, driveDownloadFile } = require('./src/main/services/sheets-api');
const { listCalendars, listEvents, createEvent, updateEvent, deleteEvent, listAcl, insertAcl, updateAcl, deleteAcl, createCalendar } = require('./src/main/services/calendar-api');
const { createHealthDiaryDB } = require('./src/main/services/database');
const { ServiceContainer } = require('./src/main/services/service-container');
const AutoUpdaterService = require('./src/main/services/auto-updater-service');
const { resolveStoredPublicDataApiKey, preparePublicDataProxyRequest } = require('./src/main/services/public-data-key-store');

let mainWindow = null;
let autoUpdaterService = null;
let loginWindow = null;
let splashWindow = null;
let authClient = null;
let userInfo = null;
let healthDB = null;           // 정규화 DB (HealthDiaryDB)
let services = null;           // ServiceContainer (모든 서비스 중앙 관리)

/* 저장소 반환 객체를 인증키/주소 문자열로 전달하지 않도록 값만 읽는다. */
function _getStoredCommonString(key) {
  try {
    const entry = services.store().get('common', key);
    if (typeof entry === 'string') return entry;
    return entry && entry.exists && typeof entry.data === 'string' ? entry.data : '';
  } catch (_) { return ''; }
}

function _getPublicDataApiKey(clientValue, legacyKeys) {
  return resolveStoredPublicDataApiKey(services.store(), clientValue, legacyKeys);
}

function createLoginWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 520,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('login.html');
  return win;
}

function createSplashWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const w = 620, h = 395;
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((sw - w) / 2),
    y: Math.round((sh - h) / 2),
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('splash.html');
  return win;
}

function createMainWindow() {
  // Start within the display work area; the responsive renderer handles smaller windows.
  const { width: _sw, height: _sh } = screen.getPrimaryDisplay().workAreaSize;
  const win = _createRememberedSchoolWindow({
    title: '오렌지톡 | 초.중.고등학교 v' + app.getVersion(),
    minWidth: Math.min(800, _sw),
    minHeight: Math.min(600, _sh),
    resizable: true,
    show: false,
    backgroundColor: '#0a0e17',
    icon: path.join(__dirname, 'assets', 'logo', 'logo_big.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });

  // Preserve the product and app version in the native window title.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.loadFile('health_diary.html');
  _bindDevToolsShortcut(win);

  /* 업데이트가 다운로드된 상태에서 사용자가 종료를 시도하면 — 오버레이를 띄우고 잠시 대기.
     사용자가 [확인 후 종료] 클릭 시에만 실제로 닫음. autoInstallOnAppQuit=true 라 종료 시 자동 설치 */
  win.on('close', (e) => {
    if (global._updateReady && !global._updateConfirmed) {
      e.preventDefault();
      /* CASE A — 사용자가 종료 시도. mode='quit' 로 모달 표시 */
      try { win.webContents.send('show-update-overlay', { version: global._updateVersion || '', mode: 'quit' }); } catch (_) {}
    }
  });

  win.webContents.on('console-message', (e, level, msg, line) => {
    if(msg.indexOf('[GP2]')!==-1 || level >= 2){
      /* asar 는 쓰기 불가 — userData 폴더로 로그 저장 */
      try{
        const logPath = path.join(app.getPath('userData'), 'console-errors.log');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] L${level}:${line}: ${msg}\n`);
      }catch(_){}
    }
  });
  return win;
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');

  /* 기본 메뉴바(File/Edit/View/Window/Help) 제거 — whenReady 이후 호출해야 Windows 에서 안전 */
  try { Menu.setApplicationMenu(null); } catch (_) {}

  /* ── 0. Dock/작업표시줄 아이콘 ── */
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron');
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo', 'logo_big.png'));
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  /* ── 0b. 카카오맵 Referer 설정 (모든 창에 적용) ── */
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders(function(details, callback) {
    if (details.url.includes('kakao.com') || details.url.includes('daumcdn.net')) {
      details.requestHeaders['Referer'] = 'http://localhost/';
      details.requestHeaders['Origin'] = 'http://localhost';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  /* ── 1. 정규화 DB (HealthDiaryDB) ── */
  healthDB = createHealthDiaryDB(app);
  console.log('[INIT] HealthDiaryDB 준비 완료:', healthDB.getInfo().dbPath);
  /* 앱 시작 시 import_staging 초기화 — 반영 안 된 이전 업로드 데이터 폐기 */
  try { healthDB.db.prepare('DELETE FROM import_staging').run(); } catch (_) {}

  /* ── 2. ServiceContainer 초기화 (모든 서비스 중앙 관리) ── */
  const { clipboard } = require('electron');
  services = new ServiceContainer({
    app,
    healthDB,
    userDataPath,
    googleApi: { getValidAccessToken, getSheetsToken, listCalendars, listEvents, createEvent, createSpreadsheet, writeSheet, batchUpdateSpreadsheet, driveMoveFile, driveSearchFile, driveUploadJson, driveUpdateJson, driveDownloadFile },
    electronModules: { BrowserWindow, dialog, clipboard },
    getMainWindow: () => mainWindow,
  });

  /* ── 2b. 부팅 안전망 — users 테이블이 비어 있으면 자동 복구 시도.
         1순위: users_backup.json
         2순위: 같은 폴더의 가장 최근 .factory-reset.{ts}.bak / .pre-restore.{ts}.bak SQLite 백업의 users 테이블
         (공장초기화 또는 백업 복원 직후 사용자 0명 종료된 케이스 자동 복구) */
  function _bootRestoreUsersFromJson(usersBackupPath) {
    try {
      if (!fs.existsSync(usersBackupPath)) return 0;
      const parsed = JSON.parse(fs.readFileSync(usersBackupPath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) return 0;
      const ins = healthDB.db.prepare(`
        INSERT INTO users (id, name, position, school_name, school_level, edu_office, is_active, created_at, updated_at)
        VALUES (@id, @name, @position, @school_name, @school_level, @edu_office, @is_active, @created_at, @updated_at)
      `);
      const tx = healthDB.db.transaction(() => {
        for (const u of parsed.users) {
          ins.run({
            id: u.id,
            name: u.name || '',
            position: u.position || '보건교사',
            school_name: u.school_name || '',
            school_level: u.school_level || 'elementary',
            edu_office: u.edu_office || '',
            is_active: (u.is_active==null ? 1 : u.is_active),
            created_at: u.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      });
      tx();
      return parsed.users.length;
    } catch (e) { console.warn('[INIT] users_backup.json 복구 실패:', e.message); return 0; }
  }
  function _bootRestoreUsersFromBakSqlite() {
    try {
      const dataDir = path.dirname(healthDB.dbPath);
      const baseName = path.basename(healthDB.dbPath);
      const all = fs.readdirSync(dataDir);
      /* 가장 최근에 생성된 .factory-reset.{ts}.bak / .pre-restore.{ts}.bak 백업 파일 */
      const candidates = all
        .filter(f => f.startsWith(baseName) && (/\.factory-reset\.\d+\.bak$/.test(f) || /\.pre-restore\.\d+\.bak$/.test(f)))
        .map(f => ({ name: f, path: path.join(dataDir, f), mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (candidates.length === 0) return 0;
      const Database = require('better-sqlite3');
      const tmp = path.join(app.getPath('temp'), 'mhd-users-recover-' + Date.now() + '.sqlite3');
      for (const cand of candidates) {
        try {
          fs.copyFileSync(cand.path, tmp);
          const bak = new Database(tmp, { readonly: true });
          let rows = [];
          try {
            const tables = bak.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
            if (tables.includes('users')) {
              rows = bak.prepare('SELECT * FROM users').all();
            }
          } finally { try { bak.close(); } catch (_) {} try { fs.unlinkSync(tmp); } catch (_) {} }
          if (rows && rows.length > 0) {
            const ins = healthDB.db.prepare(`
              INSERT INTO users (id, name, position, school_name, school_level, edu_office, is_active, created_at, updated_at)
              VALUES (@id, @name, @position, @school_name, @school_level, @edu_office, @is_active, @created_at, @updated_at)
            `);
            const tx = healthDB.db.transaction(() => {
              for (const u of rows) {
                ins.run({
                  id: u.id,
                  name: u.name || '',
                  position: u.position || '보건교사',
                  school_name: u.school_name || '',
                  school_level: u.school_level || 'elementary',
                  edu_office: u.edu_office || '',
                  is_active: (u.is_active==null ? 1 : u.is_active),
                  created_at: u.created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
              }
            });
            tx();
            console.log('[INIT] SQLite 백업에서 사용자 자동 복구:', cand.name, rows.length, '명');
            return rows.length;
          }
        } catch (e) { console.warn('[INIT] 백업', cand.name, '복구 실패:', e.message); }
      }
      return 0;
    } catch (e) { console.warn('[INIT] SQLite 백업 사용자 복구 실패:', e.message); return 0; }
  }
  /* 부팅 시 자동 복구는 사용자 동의 없이 동작하면 의도와 어긋나 비활성화한다.
     필요 시 splash 또는 설정 화면에서 명시적으로 트리거하는 IPC 로 복구한다. */
  /* (자동 복구 비활성화 — _bootRestoreUsersFromJson / _bootRestoreUsersFromBakSqlite 는 헬퍼로만 유지) */

  /* ── 3. 폴더 구조 + 앱 설정 초기화 ── */
  console.log('[INIT] 폴더 구조 준비 완료:', services.folders().data());

  const appConfig = services.appConfig();
  if (appConfig.isFirstRun()) {
    appConfig.setupInitial({
      schoolName: '',
      schoolLevel: 'high',
      region: '',
      teacherName: '',
    });
    console.log('[INIT] 최초 실행 — 설정 마법사 필요');
  }
  console.log('[INIT] 앱 설정 로드:', appConfig.getSchoolInfo()?.school?.name || '미설정');

  /* ── 5. Google 토큰 복원 ── */
  if (restoreAuthState()) {
    authClient = { restored: true };
    console.log('[AUTH] Token restored from file');
  }
  if (restoreSheetsAuthState()) {
    console.log('[AUTH] Sheets account token restored');
  }

  /* ── 6. 투명 스플래시 창(로고만) + 메인 윈도우 ──
     첫 시작 시 frame 없는 투명 창에 splash-logo 만 표시(주변 투명 = "딱 이미지만"). 과거 '투명 창 클릭 차단'
     문제는 setIgnoreMouseEvents(클릭 통과)로 방지. 메인 창 준비되면 스플래시를 닫는다. (2026-06-24 복원) */
  try { splashWindow = createSplashWindow(); splashWindow.setIgnoreMouseEvents(true); } catch (_) { splashWindow = null; }
  mainWindow = createMainWindow();
  /* 메인 표시 — 렌더러의 '로그인 화면 준비 완료' 신호(splash-ready) 후에 보여줘서, 메인이 뜨자마자 보이던
     빈 #splash(흰 화면) 단계를 건너뛴다. 그동안은 투명 스플래시(로고)가 화면을 채운다.
     창은 createMainWindow 에서 처음부터 전체화면 크기로 생성(show:false 라 안 보임)되므로 maximize 로 깜빡이지 않는다.
     신호가 안 오는 예외 상황 대비 ready-to-show 후 2.5초 백업으로 강제 표시. 한 번만 실행. (2026-06-24) */
  let _mainShown = false;
  const _showMainWindow = () => {
    if (_mainShown || !mainWindow || mainWindow.isDestroyed()) return;
    _mainShown = true;
    mainWindow.show();
    mainWindow.focus();
    try { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close(); } catch (_) {}
    splashWindow = null;
  };
  ipcMain.once('splash-ready', _showMainWindow);
  mainWindow.once('ready-to-show', () => {
    setTimeout(_showMainWindow, 2500);

    /* ── 자동 업데이트 체크 (개발 모드 제외) ── */
    if (app.isPackaged) {
      try {
        autoUpdaterService = new AutoUpdaterService({ getMainWindow: () => mainWindow });
        autoUpdaterService.checkOnStartup();
      } catch (err) {
        console.warn('[UPDATE] 초기화 실패:', err && err.message);
      }
    }
    /* 의료기관 미리 검색 — 학교 주소 기반 */
    setTimeout(async () => {
      try {
        /* Kakao REST 키는 사용자가 설정에서 입력한 값 (SQLite common store) 에서 읽어옴 */
        const REST_KEY = _getStoredCommonString('kakao_rest_api_key');
        if (!REST_KEY) return; /* 키 없으면 미리 검색 스킵 (사용자가 의료기관 탐색 여는 시점에 안내) */
        const schoolConfig = services.appConfig().getSchoolInfo();
        const schoolName = schoolConfig && schoolConfig.school && schoolConfig.school.name || '';
        const schoolAddr = _getStoredCommonString('school_address');
        const query = schoolAddr || schoolName;
        if (!query) return;
        /* 학교 좌표 검색 */
        const geoRes = await fetch('https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(query) + '&size=1', { headers: { Authorization: 'KakaoAK ' + REST_KEY } });
        const geoData = await geoRes.json();
        if (!geoData.documents || !geoData.documents.length) return;
        const lat = geoData.documents[0].y, lng = geoData.documents[0].x;
        /* 병원(HP8) + 약국(PM9) 미리 검색 */
        const [hosRes, pharRes] = await Promise.all([
          fetch('https://dapi.kakao.com/v2/local/search/category.json?category_group_code=HP8&x=' + lng + '&y=' + lat + '&radius=20000&sort=distance&size=15', { headers: { Authorization: 'KakaoAK ' + REST_KEY } }),
          fetch('https://dapi.kakao.com/v2/local/search/category.json?category_group_code=PM9&x=' + lng + '&y=' + lat + '&radius=20000&sort=distance&size=15', { headers: { Authorization: 'KakaoAK ' + REST_KEY } })
        ]);
        const hosData = await hosRes.json(), pharData = await pharRes.json();
        /* 응급실도 미리 검색 */
        const emgRes = await fetch('https://dapi.kakao.com/v2/local/search/keyword.json?query=%EC%9D%91%EA%B8%89%EC%8B%A4&x=' + lng + '&y=' + lat + '&sort=distance&size=15', { headers: { Authorization: 'KakaoAK ' + REST_KEY } });
        const emgData = await emgRes.json();
        const emergencyList = (emgData.documents || []).filter(d => {
          const cn = (d.category_name || '').toLowerCase();
          return cn.includes('병원') || cn.includes('의료');
        });

        /* 응급실 상세 정보도 미리 조회 */
        let emgDetails = [];
        const emgApiKey = _getPublicDataApiKey('', 'emergency_api_key');
        if (emgApiKey) {
          try {
            /* 국립중앙의료원 목록 5페이지 */
            const emgPages = await Promise.all([1,2,3,4,5].map(p =>
              services.externalApi().fetchEmergencyInfo(emgApiKey, { lat, lng, pageNo: p }).catch(() => null)
            ));
            let allEmgApi = [];
            emgPages.forEach(r => { if (r && r.success && Array.isArray(r.data)) allEmgApi = allEmgApi.concat(r.data); });
            /* 거리 정렬 후 상위 10건 상세 조회 */
            allEmgApi.forEach(e => { const eLat = parseFloat(e.wgs84Lat||0), eLng = parseFloat(e.wgs84Lon||0); e._dist = (eLat && eLng) ? Math.sqrt(Math.pow(parseFloat(lat)-eLat,2)+Math.pow(parseFloat(lng)-eLng,2)) : 9999; });
            allEmgApi.sort((a,b) => a._dist - b._dist);
            const top10 = allEmgApi.slice(0, 10).filter(e => e.hpid);
            if (top10.length) {
              emgDetails = await Promise.all(top10.map(e =>
                services.externalApi().fetchEmergencyDetail(emgApiKey, e.hpid).catch(() => null)
              ));
              emgDetails = emgDetails.filter(d => d);
            }
            console.log('[MedFac] 응급실 상세:', emgDetails.length, '건');
          } catch (e) { console.log('[MedFac] 응급실 상세 실패:', e.message); }
        }

        global._medFacCache = {
          schoolLat: parseFloat(lat), schoolLng: parseFloat(lng),
          hospitals: hosData.documents || [], pharmacies: pharData.documents || [],
          emergency: emergencyList, emergencyDetails: emgDetails,
          timestamp: Date.now()
        };
        console.log('[MedFac] 미리 검색 완료: 병원', (hosData.documents||[]).length, '약국', (pharData.documents||[]).length, '응급실', emergencyList.length, '상세', emgDetails.length);
      } catch (e) { console.log('[MedFac] 미리 검색 실패:', e.message); }
    }, 3000);
  });

  /* ── 자동 업데이트 IPC ── */
  ipcMain.handle('updater-check-now', async () => {
    if (!app.isPackaged) return { success: false, error: '개발 모드에서는 업데이트를 확인할 수 없습니다.' };
    if (!autoUpdaterService) autoUpdaterService = new AutoUpdaterService({ getMainWindow: () => mainWindow });
    return autoUpdaterService.checkNow();
  });

  ipcMain.handle('updater-quit-and-install', () => {
    if (!autoUpdaterService) return { success: false, error: '업데이트가 준비되지 않았습니다.' };
    return autoUpdaterService.quitAndInstall();
  });

  /* 업데이트 준비 완료 상태에서 오버레이가 "설치+재시작" 진입 시 호출.
     자동 재시작(2026-06-10): app.quit()+autoInstallOnAppQuit 은 재시작을 안 하므로
     quitAndInstall(false, true) 로 설치 후 새 버전을 자동 실행 → 설치 중 옛 버전 켜는 레이스 제거. */
  ipcMain.handle('confirm-quit-after-update', () => {
    global._updateConfirmed = true;
    /* 설치 직전 협업 웹서버 자식을 "완전히 죽을 때까지(동기)" 강제 종료 → 파일 잠금 해제 후 설치 진행.
     *  자식이 electron 바이너리·app.asar 를 물고 있으면 NSIS 가 파일 교체 실패 → 설치 미적용·무한루프.
     *  (사용자 보고 2026-06-18, 동기 종료로 강화 2026-06-25) */
    try { _killWebServerChildSync(); } catch (_) {}
    setImmediate(() => {
      try {
        if (autoUpdaterService) autoUpdaterService.quitAndInstall();
        else app.quit();
      } catch(_){ try { app.quit(); } catch(__){} }
    });
    return { success: true };
  });

  /* 렌더러가 업데이트 다운로드 완료 여부를 직접 조회 (헤더 배지 등) */
  ipcMain.handle('updater-is-ready', () => {
    return { ready: !!global._updateReady, version: global._updateVersion || '' };
  });

  /* 사전공개 Beta 만료 정보 — 렌더러 게이트/배지에서 사용.
   * expiresAt/daysLeft : 표시용 (BETA_EXPIRES_AT 기준, 배지에 노출)
   * expired            : 실제 차단 여부 (BETA_BLOCK_AT 기준, 모달+락 트리거) */
  ipcMain.handle('beta-expiry-info', () => {
    const today = new Date();
    const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    const t0 = new Date(todayStr+'T00:00:00');
    const e0 = new Date(BETA_EXPIRES_AT+'T00:00:00');
    const b0 = new Date(BETA_BLOCK_AT+'T00:00:00');
    const daysLeft = Math.floor((e0 - t0) / 86400000);
    const blockDaysLeft = Math.floor((b0 - t0) / 86400000);
    return { expiresAt: BETA_EXPIRES_AT, daysLeft, expired: blockDaysLeft < 0 };
  });

  ipcMain.handle('app-quit', () => { app.quit(); });
  /* 백업 복원 후 진짜 재시작 — location.reload() 는 렌더러만 갱신해서 main 의 닫힌 DB 핸들이 살아남음 */
  ipcMain.handle('app-relaunch', () => {
    try { app.relaunch(); app.exit(0); } catch (e) { app.quit(); }
  });

  ipcMain.handle('updater-get-version', () => {
    return { version: app.getVersion(), isPackaged: app.isPackaged };
  });

  /* 외부 API 키 번들 — 빌드 시 임베드된 기본값 (api-keys.json → bundled-api-keys.js)
   * 첫 실행 시 localStorage 가 비어 있으면 이 값으로 자동 채워진다. */
  ipcMain.handle('get-bundled-api-keys', () => {
    try {
      const path = require('path');
      const bundledPath = path.join(__dirname, 'src', 'main', 'services', 'bundled-api-keys.js');
      const fs = require('fs');
      if (!fs.existsSync(bundledPath)) return {};
      delete require.cache[require.resolve(bundledPath)];
      return require(bundledPath) || {};
    } catch (e) {
      console.warn('[bundled-api-keys] 로드 실패:', e.message);
      return {};
    }
  });

  ipcMain.handle('google-login', async () => {
    try {
      const result = await startGoogleAuth();
      authClient = result.client;
      userInfo = result.userInfo;
      setAuthState(result.client);
      console.log('[AUTH] Login success:', userInfo?.email);
      return { success: true, user: userInfo };
    } catch (err) {
      console.error('[AUTH] Login failed:', err.message, err.stack);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-user-info', () => {
    return userInfo;
  });

  ipcMain.handle('auth-config-status', () => {
    return getAuthConfigStatus();
  });

  ipcMain.handle('open-main', () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.close();
    }
    loginWindow = null;
    mainWindow = createMainWindow();
  });

  ipcMain.handle('sheets-read', async (event, { spreadsheetId, range }) => {
    try {
      const token = await getSheetsToken();
      const data = await readSheet({ accessToken: token }, spreadsheetId, range);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sheets-write', async (event, { spreadsheetId, range, values }) => {
    try {
      const token = await getSheetsToken();
      await writeSheet({ accessToken: token }, spreadsheetId, range, values);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sheets-create', async (event, { title, sheetTitle }) => {
    try {
      const token = await getSheetsToken();
      const result = await createSpreadsheet({ accessToken: token }, title, sheetTitle);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sheets-batch-update', async (event, { spreadsheetId, requests }) => {
    try {
      const token = await getSheetsToken();
      await batchUpdateSpreadsheet({ accessToken: token }, spreadsheetId, requests);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('print-to-pdf', async (event, { html, options }) => {
    try {
      return await services.screenCapture().printToPdf(
        html, options, (options && options.fileName) || '내보내기.pdf'
      );
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── 2단계 PDF (2026-08-12) — 보건일지 출력 전용: 생성과 저장 다이얼로그 분리.
   * 렌더러가 진행 카운터(n/총건)를 완주시킨 뒤 저장 창을 띄우기 위함.
   * 웹 변형은 이 채널을 쓰지 않음(web-api-bridge 가 클라이언트측 단일 경로 유지). ── */
  ipcMain.handle('print-to-pdf-generate', async (event, { html, options }) => {
    try {
      return await services.screenCapture().printToPdfGenerate(html, options);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('print-to-pdf-save', async (event, { token, fileName }) => {
    try {
      return await services.screenCapture().printToPdfSave(token, fileName || '내보내기.pdf');
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── 직접 인쇄 (용지 크기 강제 가능) ──
   * renderer에서 html + pageSize를 전달하면 숨겨진 BrowserWindow에 로드 후
   * webContents.print({pageSize, silent:false})로 다이얼로그에 원하는 크기 기본 노출.
   * 사용자가 인쇄 완료/취소하면 윈도우 자동 파괴. */
  ipcMain.handle('print-window-with-size', async (event, { html, pageSize, margins, silent, deviceName, waitForReady, landscape }) => {
    return new Promise((resolve) => {
      let printWin = null;
      try {
        printWin = new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
        });
        const safeHtml = typeof html === 'string' ? html : String(html || '');
        printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(safeHtml));
        let _printed = false;
        const _doPrint = () => {
          if (_printed) return; _printed = true;
          const printOpts = {
            silent: silent === true,
            printBackground: true,
            pageSize: pageSize || 'A4',
            margins: margins || { marginType: 'default' }
            /* DPI 는 프린터 드라이버 기본값에 맡김 — 600 DPI 강제 시 열전사 프린터에서
               다운샘플링으로 흐림/번짐 발생할 수 있음 */
          };
          /* 가로(landscape) 인쇄 — 보건일지 출력 등 A4 가로 문서용. 미지정(기본)이면 세로 유지. (2026-06-15) */
          if (landscape === true) printOpts.landscape = true;
          /* 지정 프린터(deviceName) 가 있으면 그 프린터로 직접 출력. 없으면 OS 기본 프린터. */
          if (deviceName) printOpts.deviceName = deviceName;
          printWin.webContents.print(printOpts, (success, failureReason) => {
            try { printWin.destroy(); } catch (e) {}
            /* failureReason: 'cancelled' = 사용자 취소(폴백 불필요), 그 외 = 실제 에러 */
            const reason = failureReason || '';
            const cancelled = /cancel/i.test(reason);
            resolve({
              success: !!success,
              cancelled: cancelled,
              error: success ? null : reason
            });
          });
        };
        printWin.webContents.once('did-finish-load', () => {
          if (waitForReady === true) {
            /* 인쇄 페이지가 준비되면(예: 지도 타일 로드 완료) document.title 을 '__PRINT_READY__' 로 바꿔 신호.
               최대 6초까지 기다리고, 그 안에 신호가 없으면 그냥 인쇄(폴백). */
            const _onTitle = (e, t) => {
              if (t === '__PRINT_READY__') {
                try { printWin.webContents.removeListener('page-title-updated', _onTitle); } catch (e2) {}
                _doPrint();
              }
            };
            printWin.webContents.on('page-title-updated', _onTitle);
            setTimeout(() => {
              try { printWin.webContents.removeListener('page-title-updated', _onTitle); } catch (e) {}
              _doPrint();
            }, 6000);
          } else {
            _doPrint();
          }
        });
        printWin.webContents.once('did-fail-load', (e, code, desc) => {
          try { printWin.destroy(); } catch (e2) {}
          resolve({ success: false, error: 'load-failed: ' + desc });
        });
      } catch (err) {
        try { if (printWin) printWin.destroy(); } catch (e) {}
        resolve({ success: false, error: err.message });
      }
    });
  });

  /* 현재 창(예: 의료기관 팝업) 자체를 silent 인쇄 — @media print 로 인쇄 영역만 노출.
   * 지정 프린터(deviceName)·용지(pageSize) 적용, 다이얼로그 없음. */
  ipcMain.handle('print-current-window', async (event, { pageSize, margins, silent, deviceName }) => {
    return new Promise((resolve) => {
      try {
        const opts = {
          silent: silent === true,
          printBackground: true,
          pageSize: pageSize || 'A4',
          margins: margins || { marginType: 'default' }
        };
        if (deviceName) opts.deviceName = deviceName;
        event.sender.print(opts, (success, failureReason) => {
          const reason = failureReason || '';
          resolve({ success: !!success, cancelled: /cancel/i.test(reason), error: success ? null : reason });
        });
      } catch (err) { resolve({ success: false, error: err.message }); }
    });
  });

  /* 시스템에 설치된 프린터 목록 — 영수증(3인치) 프린터 지정 UI 용. */
  ipcMain.handle('list-printers', async (event) => {
    try {
      const printers = await event.sender.getPrintersAsync();
      return { success: true, printers: (printers || []).map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: p.status })) };
    } catch (err) {
      return { success: false, error: err.message, printers: [] };
    }
  });

  ipcMain.handle('sheets-metadata', async (event, { spreadsheetId }) => {
    try {
      const token = await getSheetsToken();
      const meta = await getSheetMetadata({ accessToken: token }, spreadsheetId);
      return { success: true, meta };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('drive-list-folders', async (event, { parentId }) => {
    try {
      const token = await getSheetsToken();
      const folders = await driveListFolders(token, parentId);
      return { success: true, folders };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('drive-create-folder', async (event, { name, parentId }) => {
    try {
      const token = await getSheetsToken();
      const folder = await driveCreateFolder(token, name, parentId);
      return { success: true, folder };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('drive-move-file', async (event, { fileId, newParentId }) => {
    try {
      const token = await getSheetsToken();
      const result = await driveMoveFile(token, fileId, newParentId);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ═══ Sheets 전용 계정 관리 ═══ */
  ipcMain.handle('sheets-login', async () => {
    try {
      const result = await startGoogleAuth();
      setSheetsAuthState(result.client);
      setSheetsUserInfo(result.userInfo);
      console.log('[AUTH] Sheets account login:', result.userInfo?.email);
      return { success: true, user: result.userInfo };
    } catch (err) {
      console.error('[AUTH] Sheets login failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sheets-get-user', () => {
    return getSheetsUserInfo();
  });

  ipcMain.handle('sheets-logout', () => {
    clearSheetsAuth();
    return { success: true };
  });

  ipcMain.handle('sheets-use-main', () => {
    /* 시트 전용 계정을 제거하고 기본 계정으로 돌아감 */
    clearSheetsAuth();
    return { success: true };
  });

  /* ═══ Drive JSON 동기화 (Sheets 계정 사용) ═══ */
  ipcMain.handle('drive-sync-upload', async (event, { fileName, jsonContent, folderId }) => {
    try {
      const result = await services.driveSync().upload(fileName, jsonContent, folderId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('drive-sync-download', async (event, { fileName, folderId }) => {
    try {
      const result = await services.driveSync().download(fileName, folderId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sheets-export-job', async (event, { job }) => {
    try {
      const result = await services.workspaceExport().runExportJob(job || {});
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('weather-ip-location', async () => {
    try { return { success: true, data: await services.weather().getIpLocation() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('weather-reverse-geocode', async (event, { lat, lon }) => {
    try { return { success: true, data: await services.weather().reverseGeocode(lat, lon) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('weather-openmeteo', async (event, { lat, lon }) => {
    try { return { success: true, data: await services.weather().getOpenMeteoWeather(lat, lon) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('weather-kma', async (event, { apiKey, lat, lon }) => {
    try { return { success: true, data: await services.weather().getKmaWeather(_getPublicDataApiKey(apiKey, 'kma_api_key'), lat, lon) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 자외선지수 — 기상청(data.go.kr) + 카카오 좌표→지역코드. open-meteo 차단 환경 대체 (사용자 요청 2026-06-17) */
  ipcMain.handle('weather-uv-kma', async (event, { kmaKey, kakaoRestKey, lat, lon }) => {
    try {
      const restKey = kakaoRestKey || _getStoredCommonString('kakao_rest_api_key');
      const publicKey = _getPublicDataApiKey(kmaKey, ['uv_api_key', 'kma_api_key']);
      return { success: true, data: await services.weather().getKmaUvByCoord(publicKey, restKey, lat, lon) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  외부 API IPC (ExternalApiService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('external-fetch-exchange', async () => {
    try { return await services.externalApi().fetchExchangeRates(); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-stock', async (event, { ticker }) => {
    try { return await services.externalApi().fetchStockPrice(ticker); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-airkorea', async (event, { serviceKey, stationName }) => {
    try { return await services.externalApi().fetchAirkorea(_getPublicDataApiKey(serviceKey, 'airkorea_api_key'), stationName); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-airkorea-station-info', async (event, { serviceKey, stationName }) => {
    try { return await services.externalApi().fetchAirkoreaStationInfo(_getPublicDataApiKey(serviceKey, 'airkorea_api_key'), stationName); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-drug-info', async (event, { serviceKey, drugName }) => {
    try { return await services.externalApi().fetchDrugInfo(_getPublicDataApiKey(serviceKey, 'drug_api_key'), drugName); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-search-drug-list', async (event, { serviceKey, query }) => {
    try { return await services.externalApi().searchDrugList(_getPublicDataApiKey(serviceKey, 'drug_api_key'), query); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-med-facilities', async (event, { serviceKey, params }) => {
    try { return await services.externalApi().fetchMedFacilities(_getPublicDataApiKey(serviceKey, 'hira_api_key'), params); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-emergency-detail', async (event, { serviceKey, hpids }) => {
    try {
      const key = _getPublicDataApiKey(serviceKey, 'emergency_api_key');
      const results = await Promise.all(hpids.map(id => services.externalApi().fetchEmergencyDetail(key, id)));
      return { success: true, data: results.filter(r => r) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-emergency', async (event, { serviceKey, params }) => {
    try { return await services.externalApi().fetchEmergencyInfo(_getPublicDataApiKey(serviceKey, 'emergency_api_key'), params); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-infectious', async () => {
    try { return await services.externalApi().fetchInfectiousDisease(); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 의료기관 반경 기반 대량 캐싱 — 진행률은 이벤트로 실시간 전송 */
  ipcMain.handle('medfac-bulk-fetch', async (event, { serviceKey, emergencyKey, params }) => {
    try {
      const res = await services.externalApi().bulkFetchMedFacilitiesInRadius(
        _getPublicDataApiKey(serviceKey, 'hira_api_key'), _getPublicDataApiKey(emergencyKey, 'emergency_api_key'), params,
        function(progress){
          try { event.sender.send('medfac-bulk-progress', progress); } catch(e){}
        }
      );
      /* userData 에 캐시 파일로 저장 */
      try {
        const userDataPath = app.getPath('userData');
        const fp = path.join(userDataPath, 'data', 'medfac_cache.json');
        fs.writeFileSync(fp, JSON.stringify(res, null, 2));
        res.savedPath = fp;
      } catch(e) { res.saveError = e.message; }
      return res;
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 의료기관 캐시 로드 — 비동기 fs.promises 사용. 동기 readFileSync 가 메인 프로세스를
     수십 MB 파싱 동안 블로킹하여 카카오 검색 IPC 까지 모두 멈추던 문제 해결. */
  ipcMain.handle('medfac-load-cache', async () => {
    try {
      const fsp = require('fs').promises;
      const userDataPath = app.getPath('userData');
      const fp = path.join(userDataPath, 'data', 'medfac_cache.json');
      try { await fsp.access(fp); } catch(_) { return { success: true, exists: false }; }
      const [raw, st] = await Promise.all([
        fsp.readFile(fp, 'utf8'),
        fsp.stat(fp)
      ]);
      const data = JSON.parse(raw);
      return { success: true, exists: true, data, size: st.size, mtime: st.mtimeMs };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 의료기관 캐시 삭제 */
  ipcMain.handle('medfac-clear-cache', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const fp = path.join(userDataPath, 'data', 'medfac_cache.json');
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 카카오 REST API — 렌더러가 localStorage 에서 읽어온 키를 IPC 파라미터로 전달 */
  ipcMain.handle('kakao-category-search', async (event, { category, x, y, radius, page, apiKey }) => {
    try {
      if (!apiKey) return { success: false, error: 'Kakao REST API 키가 설정되지 않았습니다. 설정 → API Key 관리에서 등록해 주세요.' };
      let url = 'https://dapi.kakao.com/v2/local/search/category.json?category_group_code=' + encodeURIComponent(category) + '&size=15&page=' + (page || 1);
      if (x && y) { url += '&x=' + x + '&y=' + y + '&sort=distance'; if (radius) url += '&radius=' + radius; }
      const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + apiKey } });
      const data = await res.json();
      return { success: true, data: data.documents || [], meta: data.meta || {} };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('kakao-address-search', async (event, { query, apiKey }) => {
    try {
      if (!apiKey) return { success: false, error: 'Kakao REST API 키가 설정되지 않았습니다.' };
      const url = 'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(query) + '&size=5';
      const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + apiKey } });
      const data = await res.json();
      return { success: true, data: data.documents || [] };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('kakao-keyword-search', async (event, { query, x, y, radius, page, apiKey }) => {
    try {
      if (!apiKey) return { success: false, error: 'Kakao REST API 키가 설정되지 않았습니다.' };
      let url = 'https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(query) + '&size=15&page=' + (page || 1);
      if (x && y) { url += '&x=' + x + '&y=' + y + '&sort=distance'; if (radius) url += '&radius=' + radius; }
      const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + apiKey } });
      const data = await res.json();
      return { success: true, data: data.documents || [], meta: data.meta || {} };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 의료기관 탐색 (별도 BrowserWindow — 카카오맵 SDK용 http://localhost) ── */
  /* ── 의료기관 캐시 조회 ── */
  ipcMain.handle('get-med-cache', () => {
    return global._medFacCache || null;
  });

  /* ── 창 이동 (의료기관 팝업 드래그용) ── */
  ipcMain.handle('move-window', (event, { dx, dy }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) { const [x, y] = win.getPosition(); win.setPosition(x + dx, y + dy); }
  });

  /* 의료기관 탐색 전용 로컬 서버 (포트 7700 고정 — 카카오맵 SDK 도메인 인증) */
  let _medServer = null;
  function _ensureMedServer() {
    return new Promise(function(resolve) {
      if (_medServer) { resolve(); return; }
      const http = require('http');
      const mimeTypes = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.json':'application/json','.svg':'image/svg+xml'};
      _medServer = http.createServer(function(req, res) {
        let fp = path.join(__dirname, decodeURIComponent(req.url.split('?')[0] === '/' ? '/med-facility.html' : req.url.split('?')[0]));
        const ext = path.extname(fp).toLowerCase();
        fs.readFile(fp, function(err, data) {
          if (err) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          res.end(data);
        });
      });
      _medServer.listen(7700, '127.0.0.1', function() { console.log('[MedFac] http://localhost:7700'); resolve(); });
      _medServer.on('error', function(e) { if (e.code === 'EADDRINUSE') { _medServer = { _reuse: true }; resolve(); } });
    });
  }

  ipcMain.handle('open-med-facility', async (event, { schoolName, eduOffice, hiraKey, emergencyKey, schoolAddr, mode, kakaoRestKey, kakaoJsKey, schoolLat, schoolLng }) => {
    try {
      hiraKey = _getPublicDataApiKey(hiraKey, 'hira_api_key');
      emergencyKey = _getPublicDataApiKey(emergencyKey, 'emergency_api_key');
      /* 카카오 키 검증 — 두 키 모두 필요 */
      if (!kakaoJsKey || !kakaoRestKey) {
        return { success: false, error: '카카오 개발자 API 키가 등록되지 않았습니다.\n설정 → API Key 관리에서 REST API 키와 JavaScript 키를 먼저 등록해 주세요.' };
      }
      await _ensureMedServer();
      const url = 'http://localhost:7700/med-facility.html?school=' + encodeURIComponent(schoolName||'') + '&edu=' + encodeURIComponent(eduOffice||'') + '&hira=' + encodeURIComponent(hiraKey||'') + '&emg=' + encodeURIComponent(emergencyKey||'') + '&addr=' + encodeURIComponent(schoolAddr||'') + '&mode=' + encodeURIComponent(mode||'') + '&kakaoJs=' + encodeURIComponent(kakaoJsKey) + '&kakaoRest=' + encodeURIComponent(kakaoRestKey) + '&lat=' + encodeURIComponent(schoolLat||'') + '&lng=' + encodeURIComponent(schoolLng||'');
      const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
      const w = Math.min(1200, sw - 100), h = Math.min(800, sh - 100);
      const medWin = new BrowserWindow({
        width: w, height: h,
        x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2),
        parent: mainWindow, modal: false,
        frame: false, resizable: true,
        fullscreenable: false, /* macOS 부모 창이 풀스크린 상태여도 팝업은 분리 */
        backgroundColor: '#f5f7fa',
        icon: path.join(__dirname, 'assets', 'logo', 'logo_big.png'),
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
      });
      /* 진단용(임시) — 팝업 콘솔의 [GP2]·경고/에러를 userData 로그로 캡처. */
      medWin.webContents.on('console-message', (e, level, msg, line) => {
        if(msg.indexOf('[GP2]')!==-1 || level >= 2){
          try{
            const logPath = path.join(app.getPath('userData'), 'console-errors.log');
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] [MEDWIN] L${level}:${line}: ${msg}\n`);
          }catch(_){}
        }
      });
      /* 카카오맵 Referer 강제 설정 */
      medWin.webContents.session.webRequest.onBeforeSendHeaders(function(details,callback){
        if(details.url.includes('kakao.com')||details.url.includes('daumcdn.net')){
          details.requestHeaders['Referer']='http://localhost:7700/';
          details.requestHeaders['Origin']='http://localhost:7700';
        }
        callback({requestHeaders:details.requestHeaders});
      });
      /* ORB(Opaque Resource Blocking) 우회 — 카카오 SDK 응답에 CORP 헤더 추가하여
         script 태그가 cross-origin 응답을 실행할 수 있도록 허용. 이것 없으면 SDK 본문이
         정상이어도 Chromium 이 실행을 거부한다. */
      medWin.webContents.session.webRequest.onHeadersReceived(function(details,callback){
        if(details.url.includes('kakao.com')||details.url.includes('daumcdn.net')){
          details.responseHeaders=details.responseHeaders||{};
          details.responseHeaders['Cross-Origin-Resource-Policy']=['cross-origin'];
          details.responseHeaders['Access-Control-Allow-Origin']=['*'];
        }
        callback({responseHeaders:details.responseHeaders});
      });
      /* 캐시 클리어 → 완료 후 loadURL — 캐시된 OLD HTML 이 로드되는 문제 방지 */
      medWin.webContents.session.clearCache().then(function(){
        medWin.loadURL(url + '&_cb=' + Date.now());
      }).catch(function(){
        medWin.loadURL(url + '&_cb=' + Date.now());
      });
      /* DevTools 단축키 — Cmd+Option+I / Cmd+Shift+I / F12 */
      medWin.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const isMac = process.platform === 'darwin';
        const devShortcut =
          (isMac && input.meta && input.alt && input.key.toLowerCase() === 'i') ||
          (!isMac && input.control && input.shift && input.key.toLowerCase() === 'i') ||
          input.key === 'F12';
        if (devShortcut) {
          medWin.webContents.toggleDevTools();
          event.preventDefault();
        }
        /* Cmd+R / Ctrl+R / F5 → 페이지 새로고침 */
        const reloadShortcut =
          ((isMac && input.meta) || (!isMac && input.control)) && input.key.toLowerCase() === 'r' ||
          input.key === 'F5';
        if (reloadShortcut) {
          medWin.webContents.reload();
          event.preventDefault();
        }
      });
      /* 부드럽게 닫기 — 다른 팝업과 동일한 느낌 (scale 축소 + 투명) */
      function _fadeMedClose() {
        const win = global._medFacWindow;
        if (!win || win.isDestroyed()) return;
        /* 살짝 축소 효과: 크기를 95%로 줄이면서 투명하게 */
        const [w, h] = win.getSize();
        const [x, y] = win.getPosition();
        const steps = 8;
        let step = 0;
        const iv = setInterval(function() {
          step++;
          const r = 1 - step / steps;
          try {
            win.setOpacity(r);
            const nw = Math.round(w * (0.95 + 0.05 * r));
            const nh = Math.round(h * (0.95 + 0.05 * r));
            win.setBounds({ x: x + Math.round((w - nw) / 2), y: y + Math.round((h - nh) / 2), width: nw, height: nh });
          } catch(e) { clearInterval(iv); }
          if (step >= steps) { clearInterval(iv); if (!win.isDestroyed()) win.close(); }
        }, 25);
      }
      /* 메인 창 클릭 시에만 닫기 (다른 프로그램 전환 시에는 유지) */
      mainWindow.once('focus', function _medClose() {
        _fadeMedClose();
      });
      /* 전역 참조 — 다른 팝업 열 때 닫기 위해 */
      global._medFacWindow = medWin;
      medWin.on('closed', function() { global._medFacWindow = null; });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 키오스크 LAN WebSocket 서버 ── */
  ipcMain.handle('kiosk-ws-start', (event, { port }) => {
    try {
      const kws = services.kioskWs();
      return kws.start(port || 7329, (msg) => {
        /* 키오스크 → 교사 PC: 이벤트를 렌더러로 전달 */
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('kiosk-ws-message', msg);
        }
      });
    } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('kiosk-ws-stop', () => {
    try { services.kioskWs().stop(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('kiosk-ws-broadcast', (event, { msg }) => {
    try { services.kioskWs().broadcast(msg); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('kiosk-ws-status', () => {
    try { return { success: true, ...services.kioskWs().getStatus() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('get-local-ip', () => {
    try { return { success: true, ip: services.kioskWs().getLocalIP() }; }
    catch (err) { return { success: false, ip: '127.0.0.1' }; }
  });

  ipcMain.handle('external-fetch-url-title', async (event, { url }) => {
    try { return await services.externalApi().fetchUrlTitle(url); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-json', async (event, { url }) => {
    try {
      const request = preparePublicDataProxyRequest(services.store(), url);
      if (!request.success) return request;
      return await services.externalApi().fetchJson(request.url, request.usesStoredKey ? { redirect: 'manual' } : undefined);
    } catch (_) { return { success: false, error: '외부 데이터 서버에 연결하지 못했습니다.', errorKind: 'network' }; }
  });

  /* NEIS(급식·학사일정·시간표) — 클라이언트(웹 협업)가 자기 NEIS 키를 안 넣었으면 호스트 키로 폴백. 다른 API 키와 동일 정책 (2026-07-02) */
  ipcMain.handle('external-fetch-neis', async (event, { url }) => {
    try {
      let u = String(url || '');
      const m = u.match(/([?&]KEY=)([^&]*)/);
      if (!m || !m[2]) {
        const hostKey = services.store().get('common', 'neis_api_key') || '';
        if (hostKey) {
          u = m ? u.replace(/([?&]KEY=)([^&]*)/, '$1' + encodeURIComponent(hostKey))
                : u + (u.indexOf('?') >= 0 ? '&' : '?') + 'KEY=' + encodeURIComponent(hostKey);
        }
      }
      return await services.externalApi().fetchJson(u);
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('external-fetch-public-sheet-csv', async (event, { spreadsheetId }) => {
    try { return await services.externalApi().fetchPublicSheetCsv(spreadsheetId); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('planner-load-day', (event, { date }) => {
    try {
      return { success: true, data: services.plannerStore().loadDay(date) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-save-day', (event, { date, data }) => {
    try {
      return { success: true, ...services.plannerStore().saveDay(date, data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-has-day', (event, { date }) => {
    try {
      return { success: true, exists: services.plannerStore().hasDay(date) };
    } catch (err) {
      return { success: false, error: err.message, exists: false };
    }
  });

  ipcMain.handle('planner-get-links', () => {
    try {
      return { success: true, data: services.plannerStore().getLinks() };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  });

  ipcMain.handle('planner-save-links', (event, { items }) => {
    try {
      return { success: true, ...services.plannerStore().saveLinks(items) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-get-routines', () => {
    try {
      return { success: true, data: services.plannerStore().getRoutines() };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  });

  ipcMain.handle('planner-save-routines', (event, { items }) => {
    try {
      return { success: true, ...services.plannerStore().saveRoutines(items) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-get-global-todos', () => {
    try {
      return { success: true, data: services.plannerStore().getGlobalTodos() };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  });

  ipcMain.handle('planner-save-global-todos', (event, { items }) => {
    try {
      return { success: true, ...services.plannerStore().saveGlobalTodos(items) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-get-date-settings', () => {
    try {
      return { success: true, data: services.plannerStore().getDateSettings() };
    } catch (err) {
      return { success: false, error: err.message, data: { semesterEnd: '', schoolYearEnd: '' } };
    }
  });

  ipcMain.handle('planner-save-date-settings', (event, { settings }) => {
    try {
      return { success: true, ...services.plannerStore().saveDateSettings(settings) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-fetch-month-events', async (event, { date }) => {
    try {
      return { success: true, data: await services.plannerCalendar().loadMonthBundle(date) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('planner-create-todo-event', async (event, { calendarId, date, summary, colorId }) => {
    try {
      return { success: true, data: await services.plannerCalendar().createAllDayTodo(calendarId, date, summary, colorId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('survey-get-workspace', () => {
    try {
      return { success: true, data: services.surveyStore().getWorkspace() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('survey-save-workspace', (event, { patch }) => {
    try {
      return { success: true, ...services.surveyStore().saveWorkspace(patch || {}) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('survey-save-draft', (event, { draft }) => {
    try {
      return { success: true, ...services.surveyStore().saveDraft(draft) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('survey-save-path', (event, { path }) => {
    try {
      return { success: true, ...services.surveyStore().savePath(path) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('survey-get-default-draft-sync', async (_event, { schoolName, year }) => {
    try {
      return { success: true, data: services.surveyDefinition().createDefaultDraft({ schoolName, year }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('editor-state-get', (event, { namespace, slot }) => {
    try {
      return { success: true, data: services.editorStateStore().getState(namespace, slot) };
    } catch (err) {
      return { success: false, error: err.message, data: null };
    }
  });

  ipcMain.handle('editor-state-save', (event, { namespace, slot, data }) => {
    try {
      return { success: true, ...services.editorStateStore().saveState(namespace, slot, data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('editor-state-delete', (event, { namespace, slot }) => {
    try {
      return { success: true, ...services.editorStateStore().deleteState(namespace, slot) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('newsletter-list-get', () => {
    try {
      return { success: true, data: services.newsletterStore().getList() };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  });

  ipcMain.handle('newsletter-create', (event, { name, data }) => {
    try {
      return { success: true, ...services.newsletterStore().create(name, data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('newsletter-update', (event, { id, data }) => {
    try {
      return { success: true, ...services.newsletterStore().update(id, data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('newsletter-rename', (event, { id, name }) => {
    try {
      return { success: true, ...services.newsletterStore().rename(id, name) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('newsletter-duplicate', (event, { id }) => {
    try {
      return { success: true, ...services.newsletterStore().duplicate(id) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('newsletter-delete', (event, { id }) => {
    try {
      return { success: true, ...services.newsletterStore().remove(id) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('newsletter-load', (event, { id }) => {
    try {
      return { success: true, data: services.newsletterStore().getDocument(id) };
    } catch (err) {
      return { success: false, error: err.message, data: null };
    }
  });

  ipcMain.handle('newsletter-render-html', (event, { state, options }) => {
    try {
      return { success: true, html: services.newsletterRender().buildHtml(state, options) };
    } catch (err) {
      return { success: false, error: err.message, html: '' };
    }
  });

  ipcMain.handle('newsletter-render-merge-pdf-html', (event, { state, options }) => {
    try {
      return { success: true, html: services.newsletterRender().buildMergePdfHtml(state, options) };
    } catch (err) {
      return { success: false, error: err.message, html: '' };
    }
  });

  /* ── 통합 PDF 내보내기 (render + print 한 번에) ── */
  ipcMain.handle('newsletter-export-pdf', async (event, { state, options, pdfOptions }) => {
    try {
      const html = services.newsletterRender().buildMergePdfHtml(state, options);
      return await services.screenCapture().printToPdf(
        html, pdfOptions, (pdfOptions && pdfOptions.fileName) || '가정통신문.pdf'
      );
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('calendar-list', async () => {
    try {
      const token = await getValidAccessToken();
      const calendars = await listCalendars(token);
      return { success: true, data: calendars };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('calendar-events', async (event, { calendarId, options }) => {
    try {
      const token = await getValidAccessToken();
      const events = await listEvents(token, calendarId, options);
      return { success: true, data: events };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('calendar-create', async (event, { calendarId, eventBody }) => {
    try {
      const token = await getValidAccessToken();
      const created = await createEvent(token, calendarId, eventBody);
      return { success: true, data: created };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('calendar-update', async (event, { calendarId, eventId, eventBody }) => {
    try {
      const token = await getValidAccessToken();
      const updated = await updateEvent(token, calendarId, eventId, eventBody);
      return { success: true, data: updated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('calendar-delete', async (event, { calendarId, eventId }) => {
    try {
      const token = await getValidAccessToken();
      await deleteEvent(token, calendarId, eventId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── 캘린더 공유(ACL) — 공유 대상 조회 / 공유 추가·권한변경·삭제 (2026-07-02) ── */
  ipcMain.handle('calendar-acl-list', async (event, { calendarId }) => {
    try {
      const token = await getValidAccessToken();
      const data = await listAcl(token, calendarId || 'primary');
      console.log('[ACL-LIST] 성공, 규칙 수:', (data && data.items ? data.items.length : 0));
      return { success: true, data };
    } catch (err) {
      console.error('[ACL-LIST] 공유 조회 실패:', err.message);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('calendar-create-calendar', async (event, { summary }) => {
    try {
      const token = await getValidAccessToken();
      const data = await createCalendar(token, summary);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('calendar-acl-insert', async (event, { calendarId, rule }) => {
    try {
      const token = await getValidAccessToken();
      const data = await insertAcl(token, calendarId || 'primary', rule);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('calendar-acl-update', async (event, { calendarId, ruleId, rule }) => {
    try {
      const token = await getValidAccessToken();
      const data = await updateAcl(token, calendarId || 'primary', ruleId, rule);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('calendar-acl-delete', async (event, { calendarId, ruleId }) => {
    try {
      const token = await getValidAccessToken();
      await deleteAcl(token, calendarId || 'primary', ruleId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('logout', () => {
    try {
      authClient = null;
      setAuthState(null);
      userInfo = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      mainWindow = null;
      loginWindow = createLoginWindow();
    } catch (err) {
      console.error('[Logout] 오류:', err.message);
    }
  });

  let _lastExtUrl = '', _lastExtTime = 0;
  ipcMain.handle('open-external', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
        /* 중복 방지 — 같은 URL을 2초 이내 재클릭 무시 */
        const now = Date.now();
        if (url === _lastExtUrl && now - _lastExtTime < 2000) return { success: true };
        _lastExtUrl = url; _lastExtTime = now;
        shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'HTTPS/HTTP 또는 mailto만 허용됩니다' };
    } catch (err) {
      return { success: false, error: '유효하지 않은 URL입니다' };
    }
  });

  /* ═══ 파일 시스템 저장/읽기 ═══ */
  ipcMain.handle('get-default-save-path', () => {
    return path.join(app.getPath('documents'), '마이 보건일지');
  });

  ipcMain.handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '데이터 저장 폴더 선택'
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('save-file', async (event, { filePath, data }) => {
    try { return services.folders().saveFile(filePath, data); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 바이트 저장 + 위치 선택 다이얼로그 — 다이얼로그가 닫힌 "뒤" 완료를 renderer 에 돌려줌.
   *  Excel 내보내기의 "저장되었습니다" 토스트 타이밍 fix (사용자 요청 2026-06-11).
   *  웹 변형: 이 채널 없음 → renderer 가 기존 blob 다운로드로 폴백. */
  ipcMain.handle('save-bytes-dialog', async (event, { defaultName, bytes, filters }) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName || 'export.xlsx',
        filters: (filters && filters.length) ? filters : [{ name: 'Excel', extensions: ['xlsx'] }]
      });
      if (result.canceled || !result.filePath) return { success: true, canceled: true };
      require('fs').writeFileSync(result.filePath, Buffer.from(bytes));
      return { success: true, canceled: false, path: result.filePath };
    } catch (err) {
      /* 덮어쓰려는 파일이 Excel 등에서 열려 있으면 Windows 가 파일을 잠가 EBUSY/EPERM 으로 실패 — 원인을 명확히 안내 (사용자 보고 2026-06-16) */
      const code = err && err.code;
      const msg = (code === 'EBUSY' || code === 'EPERM')
        ? '같은 이름의 파일이 Excel(또는 다른 프로그램)에서 열려 있어 덮어쓸 수 없습니다. 그 파일을 먼저 닫고 다시 저장하거나, 다른 이름으로 저장해 주세요.'
        : (err && err.message) || String(err);
      return { success: false, error: msg };
    }
  });

  /* 키오스크 미리보기: 임시 HTML 저장 → 브라우저에서 열기 */
  ipcMain.handle('kiosk-preview-in-browser', async (event, wrapperHtml, innerLand, innerPort, extraInners) => {
    try {
      const _p = require('path'), _fs = require('fs');
      const dir = app.getPath('userData');
      /* 키오스크 가로/세로 본체 2개 → kiosk_inner_land/port.html, 기기선택 래퍼 → kiosk_preview.html (같은 폴더).
         래퍼 iframe 이 방향에 맞춰 본체를 상대경로로 로드. '좌 미리보기 / 우 기기 카테고리·가로세로 토글' 한 페이지. (사용자 요청 2026-06-14) */
      _fs.writeFileSync(_p.join(dir, 'kiosk_inner_land.html'), innerLand || '', 'utf-8');
      _fs.writeFileSync(_p.join(dir, 'kiosk_inner_port.html'), innerPort || '', 'utf-8');
      /* 예시 갤러리 미리보기는 기본형·확장형 × 가로·세로 4종을 추가 기록 — 파일명은 basename + 화이트리스트만 허용(경로 조작 방지). (사용자 요청 2026-06-15) */
      if (extraInners && typeof extraInners === 'object') {
        for (const k of Object.keys(extraInners)) {
          const base = _p.basename(String(k));
          if (/^kiosk_inner_[a-z0-9_]+\.html$/i.test(base)) {
            _fs.writeFileSync(_p.join(dir, base), extraInners[k] || '', 'utf-8');
          }
        }
      }
      const wPath = _p.join(dir, 'kiosk_preview.html');
      _fs.writeFileSync(wPath, wrapperHtml, 'utf-8');
      await require('electron').shell.openExternal('file://' + wPath);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('read-file', async (event, { filePath }) => {
    try { return services.folders().readFile(filePath, __dirname); }
    catch (err) { return { success: false, error: err.message }; }
  });

  services.folders().ensureYearFolders();

  ipcMain.handle('open-path', async (event, folderPath) => {
    try {
      const resolved = services.folders().openPath(folderPath, app.getPath('home'));
      shell.openPath(resolved);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 파일 크기 조회 — 설정 > 데이터 백업과 삭제 에서 DB/JSON 용량 표시용.
     userData 아래의 상대 경로 또는 절대 경로 모두 허용. 존재 안 하면 size=0 반환. */
  ipcMain.handle('get-file-size', async (event, filePath) => {
    try {
      let resolved = filePath;
      if (!path.isAbsolute(filePath)) {
        resolved = path.join(app.getPath('userData'), filePath);
      }
      if (!fs.existsSync(resolved)) return { success: true, size: 0, exists: false };
      const st = fs.statSync(resolved);
      return { success: true, size: st.size, exists: true, mtime: st.mtimeMs };
    } catch (err) { return { success: false, error: err.message, size: 0 }; }
  });

  ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('db-info', () => {
    try {
      return { success: true, ...services.store().getInfo() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* 공장 초기화 — 모든 테이블 데이터 삭제 (스키마/테이블 유지, users 보존) */
  ipcMain.handle('db-factory-reset', () => {
    try { return services.healthDb().factoryReset(); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('db-factory-reset-health-only', () => {
    try { return services.healthDb().factoryResetHealthRecordsOnly(); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('db-get', (event, { scope, key, year }) => {
    try {
      return { success: true, ...services.store().get(scope, key, year) };
    } catch (err) {
      return { success: false, error: err.message, exists: false, data: null };
    }
  });

  ipcMain.handle('db-set', (event, { scope, key, value, year }) => {
    try {
      return { success: true, ...services.store().set(scope, key, value, year) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db-batch-set', (event, { items }) => {
    try {
      return { success: true, ...services.store().batchSet(items || []) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('industry-migration-export', async (event, audience) => {
    try {
      const { convert, snapshotDatabase } = require('./src/main/services/industry-migration');
      const store = services.store();
      let origin = store.get('common', 'industry_migration_origin').data;
      if (!origin) {
        origin = require('node:crypto').randomUUID();
        store.set('common', 'industry_migration_origin', origin);
      }
      const backup = convert(snapshotDatabase(healthDB.db), origin, audience);
      const counts = backup.data;
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '산업체·대학교용으로 데이터 이관', buttons: ['파일 저장', '취소'], defaultId: 1, cancelId: 1,
        message: `관리대상자 ${counts.subjects.length}명 · 보건일지 ${counts.journals.length}건 · 상담 ${counts.counselings.length}건 · 응급 ${counts.emergencies.length}건 · 감염병 ${counts.infections.length}건`,
        detail: `전체 연도의 선택 대상 기록입니다.\n생년월일 보완 대상: ${backup.migration.missingBirth}명\n\n${backup.migration.notice}\n\n학교용 원본은 유지됩니다. 저장한 파일을 산업체용 환경설정의 ‘데이터 이관’에서 선택하세요.`
      });
      if (choice.response !== 0) return { canceled: true };
      const content = JSON.stringify(backup, null, 2);
      if (Buffer.byteLength(content, 'utf8') > 50 * 1024 * 1024) throw new Error('이관 파일이 50MB를 넘습니다. 학생/교직원 대상을 나누어 내보내 주세요.');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '산업체·대학교 이관 파일 저장', defaultPath: '오렌지톡_학교용_이관.otbackup',
        filters: [{ name: '오렌지톡 이관 파일', extensions: ['otbackup'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      await require('node:fs/promises').writeFile(result.filePath, content, 'utf8');
      return { success: true, missingBirth: backup.migration.missingBirth };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('db-export-backup', () => {
    try {
      return { success: true, backup: services.store().exportBackup() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db-import-backup', (event, { backup }) => {
    try {
      /* ── 백업 데이터 검증 ── */
      if (!backup || typeof backup !== 'object') {
        return { success: false, error: '유효하지 않은 백업 데이터입니다' };
      }
      const jsonStr = JSON.stringify(backup);
      const MAX_BACKUP_SIZE = 100 * 1024 * 1024; // 100MB
      if (jsonStr.length > MAX_BACKUP_SIZE) {
        return { success: false, error: '백업 데이터 크기가 100MB를 초과합니다' };
      }
      return { success: true, ...services.store().importBackup(backup) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── SQLite 파일 직접 백업/복원 ── */

  ipcMain.handle('db-backup-sqlite', async () => {
    try {
      const dbPath = healthDB.dbPath;
      const now = new Date();
      const dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
      const defaultName = '오렌지톡_백업_' + dateStr + '.sqlite3';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '보건일지 데이터 백업',
        defaultPath: defaultName,
        filters: [{ name: 'SQLite Database', extensions: ['sqlite3'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      /* WAL 체크포인트 + VACUUM INTO 로 빈 페이지 제거된 최소 크기 백업 생성
       * (기존 fs.copyFileSync 는 빈 페이지·WAL 여유공간까지 복사해서 크기 부풀림) */
      try { healthDB.db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      try {
        /* VACUUM INTO: 대상 경로가 이미 존재하면 실패 → 먼저 삭제 */
        if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath);
        healthDB.db.prepare(`VACUUM INTO ?`).run(result.filePath);
      } catch (vacErr) {
        /* VACUUM INTO 실패 시 기존 방식(raw copy)으로 폴백 */
        console.warn('[DB] VACUUM INTO 실패, raw copy 로 폴백:', vacErr.message);
        fs.copyFileSync(dbPath, result.filePath);
      }
      return { success: true, filePath: result.filePath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('db-restore-sqlite', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '백업 데이터 불러오기',
        filters: [
          { name: 'SQLite 백업', extensions: ['sqlite3'] },
        ],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths || !result.filePaths.length) return { success: false, canceled: true };
      const filePath = result.filePaths[0];
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== '.sqlite3') {
        return { success: false, error: 'SQLite(.sqlite3) 백업 파일만 지원됩니다.' };
      }
      /* SQLite 백업 파일 검증 — v1 스키마 (students/staff/daily_records).
         호환을 위해 옛 'people' 테이블이 있는 백업도 통과시킨다.
         사용자가 현재 운영 DB 와 동일한 파일을 선택할 수도 있으므로,
         원본을 직접 열지 않고 OS temp 위치로 복사한 사본을 검증한다 (락 회피). */
      const Database = require('better-sqlite3');
      const tmpVerifyPath = path.join(app.getPath('temp'), 'mhd-verify-' + Date.now() + '.sqlite3');
      try {
        fs.copyFileSync(filePath, tmpVerifyPath);
      } catch (cpErr) {
        return { success: false, error: '백업 파일 검증 실패: 임시 복사 오류 ' + cpErr.message };
      }
      let testDb;
      try {
        /* readonly + WAL DB 는 -wal/-shm 동행 파일 부재 시 잠금 에러 가능.
           임시 사본은 어차피 폐기되므로 readwrite 로 열고 journal_mode=DELETE 로 락 회피. */
        testDb = new Database(tmpVerifyPath);
        try { testDb.pragma('journal_mode = DELETE'); } catch (_) {}
        try { testDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
        const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
        const hasV1Schema = tables.includes('students') && tables.includes('staff') && tables.includes('daily_records');
        const hasLegacySchema = tables.includes('people') && tables.includes('daily_records');
        if (!hasV1Schema && !hasLegacySchema) {
          return { success: false, error: '유효한 보건일지 백업 파일이 아닙니다. (필수 테이블 누락: students/staff/daily_records 또는 people/daily_records)' };
        }
        let peopleCnt = 0;
        if (hasV1Schema) {
          const stuCnt = testDb.prepare('SELECT COUNT(*) as cnt FROM students').get().cnt;
          const stfCnt = testDb.prepare('SELECT COUNT(*) as cnt FROM staff').get().cnt;
          peopleCnt = stuCnt + stfCnt;
        } else {
          peopleCnt = testDb.prepare('SELECT COUNT(*) as cnt FROM people').get().cnt;
        }
        const dailyCnt = testDb.prepare('SELECT COUNT(*) as cnt FROM daily_records').get().cnt;
        let usersCnt = 0;
        try {
          if (tables.includes('users')) {
            usersCnt = testDb.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
          }
        } catch (_) {}
        console.log('[DB] 백업 파일 검증 — users:', usersCnt, 'people:', peopleCnt, 'daily:', dailyCnt);
        testDb.close();
        testDb = null;
        try { fs.unlinkSync(tmpVerifyPath); } catch (_) {}
        /* 현재 DB 닫기 → 백업 파일로 교체 → 재시작 */
        const dbPath = healthDB.dbPath;
        const preRestoreBackup = dbPath + '.pre-restore.' + Date.now() + '.bak';
        /* ── 0) 웹 서버 자식 프로세스가 같은 DB 파일을 들고 있으면 fs.copyFileSync 시 잠금 충돌 → 메인까지 동반 종료.
               prefs 는 건드리지 않고 자식만 임시 종료 → 복원 후 자동 재시작. ── */
        const _wasWebRunning = !!(_webServerChild && !_webServerChild.killed);
        if (_wasWebRunning && _webServerChild) {
          console.log('[DB] 복원 시작 → 웹 서버 임시 중지 (exit 이벤트까지 대기)');
          const child = _webServerChild;
          _webServerChild = null;
          await new Promise(resolve => {
            let resolved = false;
            const done = () => { if (!resolved) { resolved = true; resolve(); } };
            try { child.once('exit', done); } catch (_) {}
            try { child.kill('SIGTERM'); } catch (_) {}
            setTimeout(done, 2500); /* 2.5s 안전 타임아웃 */
          });
          if (_webServerLogStream) { try { _webServerLogStream.end(); } catch (_) {} _webServerLogStream = null; }
          /* lock 해제 여유 */
          await new Promise(r => setTimeout(r, 200));
        }
        /* ── 1) 현재 사용자(보건교사) 목록 보존 — 복원으로 덮어쓰지 않는다.
               메모리 + JSON 백업(users_backup.json) 두 단계 fallback. ── */
        let savedUsers = [];
        try { savedUsers = healthDB.db.prepare('SELECT * FROM users').all(); } catch (_) {}
        if (!savedUsers || savedUsers.length === 0) {
          try {
            const usersBackupPath = path.join(app.getPath('userData'), 'data', 'users_backup.json');
            if (fs.existsSync(usersBackupPath)) {
              const raw = fs.readFileSync(usersBackupPath, 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.users)) {
                savedUsers = parsed.users;
                console.log('[DB] 메모리에 없어서 users_backup.json 에서 복구:', savedUsers.length, '명');
              }
            }
          } catch (e) { console.warn('[DB] users_backup.json 읽기 실패:', e.message); }
        }
        console.log('[DB] 복원 전 사용자 보존:', savedUsers.length, '명');
        /* ── 신 복원 전략: DB 를 닫지 않고 ATTACH + SQL 카피.
         *  · 기존 방식(close → fs.copyFileSync → reopen)은 Windows Defender 실시간 스캔이
         *    새로 쓰인 dbPath 를 잠가 SQLite 가 "database is locked" 로 10~15초간 대기.
         *  · 새 방식: healthDB 를 열어둔 채 백업 파일을 src 로 ATTACH → 테이블 단위
         *    DELETE+INSERT → DETACH. 파일 락이 발생할 여지 자체가 없고 1~2s 안에 끝남. */
        let tmpAttachSrc = null;
        try {
          console.log('[DB] step1 wal_checkpoint(TRUNCATE) — 현재 DB 정합성 확보');
          try { healthDB.db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e1) { console.warn('[DB] step1 WARN:', e1.message); }

          console.log('[DB] step2 pre-restore safety backup', dbPath, '→', preRestoreBackup);
          try { fs.copyFileSync(dbPath, preRestoreBackup); } catch (e2) { console.warn('[DB] step2 WARN:', e2.message); }

          /* step3: USB 백업을 로컬 임시로 복사 + WAL 정합성 정리. USB 분리 대비 + ATTACH 안전. */
          tmpAttachSrc = dbPath + '.attach-src.' + Date.now() + '.tmp';
          console.log('[DB] step3 source copy → ATTACH 임시 위치', filePath, '→', tmpAttachSrc);
          fs.copyFileSync(filePath, tmpAttachSrc);
          {
            const DatabaseLib = require('better-sqlite3');
            let cleanDb;
            try {
              cleanDb = new DatabaseLib(tmpAttachSrc);
              try { cleanDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
              try { cleanDb.pragma('journal_mode = DELETE'); } catch (_) {}
            } finally { if (cleanDb) try { cleanDb.close(); } catch (_) {} }
            try { fs.unlinkSync(tmpAttachSrc + '-wal'); } catch (_) {}
            try { fs.unlinkSync(tmpAttachSrc + '-shm'); } catch (_) {}
            try { fs.unlinkSync(tmpAttachSrc + '-journal'); } catch (_) {}
          }

          /* step4: 핵심 — DB 를 닫지 않고 ATTACH 로 데이터 교체.
           * schema_meta / sqlite_* 는 제외 (현재 SCHEMA_VERSION 보존, system 테이블은 자동). */
          console.log('[DB] step4 ATTACH 백업 → src');
          const _attachPathEsc = tmpAttachSrc.replace(/'/g, "''");
          healthDB.db.exec(`ATTACH DATABASE '${_attachPathEsc}' AS src`);
          let _copiedTables = 0;
          let _skippedTables = 0;
          try {
            healthDB.db.pragma('foreign_keys = OFF');
            const srcTables = healthDB.db.prepare(
              `SELECT name FROM src.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_meta'`
            ).all().map(t => t.name);
            console.log('[DB] step4 src 테이블', srcTables.length, '개 복사 시작');

            const tx = healthDB.db.transaction(() => {
              for (const table of srcTables) {
                /* main 에 같은 테이블 없으면 src 의 DDL 로 생성 (옛 백업 호환) */
                const mainExists = healthDB.db.prepare(`SELECT name FROM main.sqlite_master WHERE type='table' AND name=?`).get(table);
                if (!mainExists) {
                  const ddlRow = healthDB.db.prepare(`SELECT sql FROM src.sqlite_master WHERE type='table' AND name=?`).get(table);
                  if (ddlRow && ddlRow.sql) {
                    console.log('[DB] step4 새 테이블 생성:', table);
                    try { healthDB.db.exec(ddlRow.sql); } catch (ddlErr) { console.warn('[DB] step4 DDL 실패 skip:', table, ddlErr.message); _skippedTables++; continue; }
                  } else { _skippedTables++; continue; }
                }
                /* 공통 컬럼만 복사 — 스키마 차이가 있어도 안전 */
                const mainCols = healthDB.db.prepare(`PRAGMA main.table_info("${table}")`).all().map(c => c.name);
                const srcCols = healthDB.db.prepare(`PRAGMA src.table_info("${table}")`).all().map(c => c.name);
                const commonCols = mainCols.filter(c => srcCols.includes(c));
                if (commonCols.length === 0) { _skippedTables++; console.warn('[DB] step4 공통 컬럼 없음 skip:', table); continue; }
                const colList = commonCols.map(c => `"${c}"`).join(', ');
                try {
                  healthDB.db.prepare(`DELETE FROM main."${table}"`).run();
                  healthDB.db.prepare(`INSERT INTO main."${table}" (${colList}) SELECT ${colList} FROM src."${table}"`).run();
                  _copiedTables++;
                } catch (copyErr) {
                  console.warn('[DB] step4 테이블 카피 실패 skip:', table, copyErr.message);
                  _skippedTables++;
                }
              }
            });
            tx();
            healthDB.db.pragma('foreign_keys = ON');
            console.log('[DB] step4 복사 완료 — 성공', _copiedTables, '개 / skip', _skippedTables, '개');
          } finally {
            try { healthDB.db.exec('DETACH DATABASE src'); } catch (_) {}
          }
          try { fs.unlinkSync(tmpAttachSrc); } catch (_) {}
          tmpAttachSrc = null;

          /* step5: 마이그레이션 재실행 — 백업이 옛 스키마라면 누락 컬럼이 main 에 있을 수 있음.
           * _ensureColumn 은 idempotent 이므로 무해. SCHEMA_VERSION 도 main 의 현재 값 유지. */
          console.log('[DB] step5 마이그레이션 재확인');
          try { healthDB._migrate && healthDB._migrate(); } catch (e5) { console.warn('[DB] step5 WARN:', e5.message); }

          /* step6: service-container 의 캐시 무효화 — 데이터 자체는 같은 핸들에 있으므로
           * replaceHealthDB(healthDB) 로 services 캐시만 reset. */
          console.log('[DB] step6 services.replaceHealthDB');
          services.replaceHealthDB(healthDB);

          /* step7: 작업 후 정리 */
          try { healthDB.db.prepare('DELETE FROM import_staging').run(); } catch (_) {}
        } catch (stepErr) {
          if (tmpAttachSrc) { try { fs.unlinkSync(tmpAttachSrc); } catch (_) {} }
          try { healthDB.db.exec('DETACH DATABASE src'); } catch (_) {}
          console.error('[DB] 복원 단계 오류:', stepErr && stepErr.message);
          /* DB 핸들 복구는 시도 — 다음 IPC 호출이 정상 동작하도록.
           * 단, verify 카운트를 success 처럼 반환하는 false-success 는 절대 금지. */
          try {
            if (!healthDB || !healthDB.db || !healthDB.db.open) {
              console.warn('[DB] 회복 시도: createHealthDiaryDB 재호출');
              healthDB = createHealthDiaryDB(app);
              services.replaceHealthDB(healthDB);
            }
          } catch (recErr) { console.warn('[DB] 즉시 회복 실패 — 다음 IPC 호출 시 자가복구:', recErr.message); }
          if (_wasWebRunning) { try { _webServerStart(); } catch (_) {} }
          return {
            success: false,
            error: '복원 실패: ' + (stepErr && stepErr.message || '알 수 없는 오류'),
            hint: '앱을 완전히 종료(시스템 트레이 포함)한 뒤 다시 시도해주세요. 재시도해도 같은 에러가 나면 백업 파일이 다른 SQLite DB 와 충돌 중일 수 있어요.',
          };
        }
        /* ── 2) 사용자(보건교사) 병합 정책 ──
           · 백업의 users 는 그대로 보존 (포맷·새 PC 시나리오에서 본래 사용자 복귀 보장)
           · 복원 직전 메모리에 떠둔 savedUsers 중 백업에 동일 이름이 없는 사용자만 추가 (최대 3명 cap)
           · 같은 이름은 백업본 우선 — id/생성시각/소속도 백업본 그대로 */
        try {
          const tx = healthDB.db.transaction(() => {
            const existingNames = new Set(
              healthDB.db.prepare('SELECT name FROM users').all()
                .map(u => String(u.name||'').trim())
                .filter(n => n)
            );
            const insMerge = healthDB.db.prepare(`
              INSERT INTO users (name, position, school_name, school_level, edu_office, is_active, created_at, updated_at)
              VALUES (@name, @position, @school_name, @school_level, @edu_office, @is_active, @created_at, @updated_at)
            `);
            let mergedCnt = 0;
            for (const u of savedUsers) {
              const nm = String(u.name||'').trim();
              if (!nm || existingNames.has(nm)) continue;
              const curCnt = healthDB.db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
              if (curCnt >= 3) break;
              insMerge.run({
                name: nm,
                position: u.position || '보건교사',
                school_name: u.school_name || '',
                school_level: u.school_level || 'elementary',
                edu_office: u.edu_office || '',
                is_active: (u.is_active==null ? 1 : u.is_active),
                created_at: u.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
              existingNames.add(nm);
              mergedCnt++;
            }
            if (mergedCnt > 0) console.log('[DB] 복원 후 사용자 병합:', mergedCnt, '명 추가 (백업의 사용자는 모두 보존)');
            else console.log('[DB] 복원 후 사용자 병합: 추가 없음 — 백업의 사용자만 유지');
          });
          tx();
        } catch (uErr) {
          console.warn('[DB] 사용자 병합 중 오류 — 백업 파일의 users 그대로 유지:', uErr.message);
        }
        services.replaceHealthDB(healthDB);
        /* 재오픈 후 실제 users 카운트도 한 번 더 조회 → 복원 검증 */
        let usersCntAfter = 0;
        try { usersCntAfter = healthDB.db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt; } catch (_) {}
        /* 복원 직후 최신 사용자 목록을 다시 JSON 백업에 dump */
        try { _dumpUsersBackup(); } catch (_) {}
        console.log('[DB] 복원 후 재오픈 완료 — users:', usersCntAfter, 'path:', healthDB.getInfo().dbPath);
        /* 복원 전 웹 서버가 켜져 있었다면 자동 재시작 */
        if (_wasWebRunning) {
          console.log('[DB] 복원 완료 → 웹 서버 재시작');
          try { _webServerStart(); } catch (e) { console.warn('[WEB] 재시작 실패:', e.message); }
        }
        return { success: true, type: 'sqlite', peopleCnt, dailyCnt, usersCnt: usersCntAfter, usersPreserved: savedUsers.length };
      } catch (e) {
        if (testDb) try { testDb.close(); } catch (_) {}
        try { fs.unlinkSync(tmpVerifyPath); } catch (_) {}
        return { success: false, error: '백업 파일 검증 실패: ' + e.message };
      }
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 커스텀 백업과 반영 (학교 이동용) — 사용자 정책 2026-05-22 ──
   *  · 자주 쓰는 처치·사용자 증상·약품 매칭·API 키·열필드 설정·커스텀 양식 출력 등
   *    학교 이동 시 옮겨갈 모든 사용자 커스텀을 한 폴더에 백업/복원.
   *  · 압축 없이 폴더 그대로 (컴맹 사용자 친화). 등록부: custom-backup-keys.js. */

  /* 등록부 조회 — renderer 가 localStorage 의 어떤 키를 수집할지 알기 위함. */
  ipcMain.handle('custom-backup-list-keys', () => {
    try {
      return { success: true, data: services.customBackup().getKeys() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 백업 실행 — 폴더 선택 다이얼로그 + 그 안에 OrangePharm-커스텀-{ts}/ 생성 + 저장.
   *  localStorageData 는 renderer 가 등록부 기반으로 모은 { key: value }. */
  ipcMain.handle('custom-backup-export', async (event, { localStorageData, selectedIds } = {}) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '커스텀 설정 백업 — 저장할 폴더 선택',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || !result.filePaths.length) {
        return { success: false, canceled: true };
      }
      const folderPath = result.filePaths[0];
      return services.customBackup().exportTo(folderPath, localStorageData || {}, selectedIds);
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 복원 실행 — 폴더 선택 다이얼로그 + 안의 파일들 복원.
   *  반환: localStorageData (renderer 가 직접 window.localStorage 에 적용). */
  ipcMain.handle('custom-backup-import', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '커스텀 설정 적용 — 백업 폴더 선택 (OrangePharm-커스텀-XXX)',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths || !result.filePaths.length) {
        return { success: false, canceled: true };
      }
      const folderPath = result.filePaths[0];
      return services.customBackup().importFrom(folderPath);
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* ── JSON 파일 기반 데이터 저장/로드 (JsonFileService 위임) ── */

  ipcMain.handle('json-save', (event, { key, data }) => {
    try {
      const filePath = services.jsonFile().save(key, data);
      return { success: true, path: filePath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('json-load', (event, { key, year }) => {
    try {
      const result = services.jsonFile().loadByKey(key, year);
      return { success: true, ...result };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('json-save-common', (event, { key, data }) => {
    try {
      const filePath = services.jsonFile().saveCommon(key, data);
      return { success: true, path: filePath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 사용자 배경 이미지 파일 저장/삭제 — userData/data/bg/custom.webp ── */
  ipcMain.handle('user-bg-save', (event, { buffer, ext }) => {
    try {
      const dir = path.join(userDataPath, 'data', 'bg');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeExt = (ext || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
      const fp = path.join(dir, 'custom.' + safeExt);
      /* 다른 확장자 잔존 파일 정리 */
      ['webp', 'png', 'jpg', 'jpeg'].forEach(e => {
        const old = path.join(dir, 'custom.' + e);
        if (e !== safeExt && fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (_) {} }
      });
      fs.writeFileSync(fp, Buffer.from(buffer));
      return { success: true, path: fp };
    } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('user-bg-delete', () => {
    try {
      const dir = path.join(userDataPath, 'data', 'bg');
      if (fs.existsSync(dir)) {
        ['webp', 'png', 'jpg', 'jpeg'].forEach(e => {
          const fp = path.join(dir, 'custom.' + e);
          if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (_) {} }
        });
      }
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('user-bg-get-path', () => {
    try {
      const dir = path.join(userDataPath, 'data', 'bg');
      const exts = ['webp', 'png', 'jpg', 'jpeg'];
      for (const e of exts) {
        const fp = path.join(dir, 'custom.' + e);
        if (fs.existsSync(fp)) return { success: true, path: fp, exists: true };
      }
      return { success: true, exists: false };
    } catch (err) { return { success: false, error: err.message }; }
  });
  /* 사용자 배경 이미지 dataURL — 렌더러에서 CSS background-image url() 에 직접 사용.
   * file:// 직접 참조는 Electron webSecurity / CSP default-src 'self' 결합으로 차단되는
   * 경우가 있어 (특히 Windows 패키지 빌드) 안정성 위해 dataURL 로 전달한다.
   * CSP 의 img-src 가 data: 를 이미 허용하므로 차단 없음. */
  ipcMain.handle('user-bg-get-data-url', () => {
    try {
      const dir = path.join(userDataPath, 'data', 'bg');
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
  });

  ipcMain.handle('json-load-common', (event, { key }) => {
    try {
      const result = services.jsonFile().loadCommon(key);
      return { success: true, ...result };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 오늘의 메모 (today_memos, DB v4) — 메인 DB 저장이라 백업·복원·웹 협업에 자동 동행 (2026-06-10) ── */
  ipcMain.handle('today-memo-get-all', () => {
    try { return { success: true, data: healthDB.getTodayMemosAll() }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('today-memo-set', (event, { date, cells }) => {
    try { return { success: true, ...healthDB.setTodayMemo(date, cells) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('json-flush', (event, { items }) => {
    try {
      services.jsonFile().flush(items);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 양식 xlsx 매핑 데이터 로드 (사용자 요청 2026-05-27) ──
   *  templates/forms/symptom_medicine_matching.xlsx 를 읽어 약품 → 효능_1~4 매핑 추출.
   *  CLAUDE.md "엑셀 양식 파일은 절대 수정 금지" — 읽기만 수행.
   *  reads-from packaged path (app.asar/templates/...) or dev path (electron-app/templates/...). */
  ipcMain.handle('templates-load-med-sym-matching', () => {
    try {
      const path = require('path');
      const fs = require('fs');
      const XLSX = require('xlsx');
      const candidates = [
        path.join(app.getAppPath(), 'templates', 'forms', 'symptom_medicine_matching.xlsx'),
        path.join(__dirname, 'templates', 'forms', 'symptom_medicine_matching.xlsx'),
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
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── 요소 캡처 (ScreenCaptureService 위임) ── */
  ipcMain.handle('capture-to-png', async (event, { html, width, fileName }) => {
    return services.screenCapture().captureToPng(html, width, fileName);
  });

  ipcMain.handle('capture-element', async (event, { html, width, height }) => {
    return services.screenCapture().captureElement(html, width, height);
  });

  /* ── 클립보드에 HTML+텍스트 쓰기 (엑셀/구글시트 붙여넣기용) ── */
  ipcMain.handle('clipboard-write-html', (event, { html, text }) => {
    try {
      const { clipboard } = require('electron');  // clipboard는 main에서만 사용, 지연 로드 유지
      clipboard.write({ text: text || '', html: html || '' });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ensure-survey-folder', async (event, surveyKey) => {
    try {
      /* ── 경로 순회 방어: surveyKey에 안전한 문자만 허용 ── */
      if (!surveyKey || !/^[a-zA-Z0-9_-]+$/.test(surveyKey)) {
        return { success: false, error: '유효하지 않은 surveyKey' };
      }
      const year = new Date().getFullYear().toString();
      const folderPath = path.join(app.getPath('userData'), 'data', year, 'survey', surveyKey);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
      return { success: true, path: folderPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('list-files', async (event, { dirPath, ext }) => {
    try {
      /* ── 경로 순회 방어: userData 내부만 허용 ── */
      const resolved = path.resolve(dirPath);
      const userDataRoot = path.resolve(app.getPath('userData')) + path.sep;
      if (!resolved.startsWith(userDataRoot) && resolved !== path.resolve(app.getPath('userData'))) {
        return { success: false, error: '허용되지 않은 경로' };
      }
      if (!fs.existsSync(resolved)) return { success: true, files: [] };
      const files = fs.readdirSync(resolved).filter(f => !ext || f.endsWith(ext));
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ═══ 릴레이 요청 공통 헬퍼 — Electron net 모듈 (OS 인증서 저장소·프록시 설정 그대로 사용) ═══
   *  학교망 SSL 검사 장비가 자체서명 인증서로 HTTPS 를 가로채도, 윈도우가 신뢰하는 루트CA면 통과된다.
   *  (Node https 는 자체 CA 목록만 써서 학교 사설 루트CA 를 거부 → "self signed certificate in certificate chain" 오류 발생) (2026-06-16)
   *  반환: { status, text } | { __timeout:true } | { __netError:메시지 } */
  function _relayRequest(urlStr, opts) {
    opts = opts || {};
    const method = opts.method || 'GET';
    const headers = opts.headers || {};
    const body = (opts.body != null) ? opts.body : null;
    const timeout = opts.timeout || 8000;
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      let request;
      try {
        const { net } = require('electron');
        request = net.request({ method: method, url: urlStr });
      } catch (e) { return done({ __netError: e.message }); }
      /* Electron net 이 본문에서 자동 계산·관리하는 헤더는 수동 설정 금지 — 수동 설정 시 net::ERR_INVALID_ARGUMENT (업로드 실패, 2026-06-16 수정) */
      try { Object.keys(headers).forEach((k) => { var _lk = String(k).toLowerCase(); if (headers[k] != null && _lk !== 'content-length' && _lk !== 'host' && _lk !== 'transfer-encoding' && _lk !== 'connection') request.setHeader(k, String(headers[k])); }); } catch (_) {}
      const timer = setTimeout(() => { try { request.abort(); } catch (_) {} done({ __timeout: true }); }, timeout);
      request.on('response', (response) => {
        let data = '';
        response.on('data', (c) => { data += c; });
        response.on('end', () => { clearTimeout(timer); done({ status: response.statusCode, text: data }); });
        response.on('error', (e) => { clearTimeout(timer); done({ __netError: (e && e.message) || 'response error' }); });
      });
      request.on('error', (e) => { clearTimeout(timer); done({ __netError: (e && e.message) || 'network error' }); });
      try { if (body != null) request.write(body); request.end(); }
      catch (e) { clearTimeout(timer); done({ __netError: e.message }); }
    });
  }

  /* ═══ 키오스크 config push (릴레이 서버로 전송) ═══ */
  ipcMain.handle('kiosk-push-config', async (event, { relayUrl, channelId, authToken, config }) => {
    if (!relayUrl || !channelId) return { success: false, error: 'No relay info' };
    try {
      /* ── URL 보안 검증: HTTPS만 허용, 사설 IP 차단 (SSRF 방지) ── */
      const url = new URL(relayUrl + '/api/v1/kiosk/config/' + channelId);
      if (url.protocol !== 'https:') {
        return { success: false, error: 'HTTPS만 허용됩니다' };
      }
      const hostname = url.hostname.toLowerCase();
      const blockedPatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^192\.168\./,
        /^0\./,
        /^\[::1\]$/,
        /^\[fc/i,
        /^\[fd/i,
        /^169\.254\./,
        /\.local$/i,
      ];
      if (blockedPatterns.some(p => p.test(hostname))) {
        return { success: false, error: '허용되지 않은 호스트입니다' };
      }

      const body = JSON.stringify({ config });
      const r = await _relayRequest(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authToken || '') },
        body: body, timeout: 8000
      });
      if (r.__timeout) return { success: false, error: 'timeout' };
      if (r.__netError) return { success: false, error: r.__netError };
      return { success: r.status >= 200 && r.status < 300, status: r.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ═══ 키오스크 접속 인증키 설정/해제 (2026-06-12) ═══
   *  URL/QR 노출 대비 — 키 설정 시 /k/:channelId 접속에 키 입력 게이트가 생김. 빈 키 = 해제. */
  ipcMain.handle('kiosk-push-access-key', async (event, { relayUrl, channelId, authToken, accessKey }) => {
    if (!relayUrl || !channelId) return { success: false, error: 'No relay info' };
    try {
      const url = new URL(relayUrl + '/api/v1/kiosk/access-key/' + channelId);
      if (url.protocol !== 'https:') return { success: false, error: 'HTTPS만 허용됩니다' };
      const hostname = url.hostname.toLowerCase();
      const blockedPatterns = [
        /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
        /^0\./, /^\[::1\]$/, /^\[fc/i, /^\[fd/i, /^169\.254\./, /\.local$/i,
      ];
      if (blockedPatterns.some(p => p.test(hostname))) {
        return { success: false, error: '허용되지 않은 호스트입니다' };
      }
      const body = JSON.stringify({ accessKey: String(accessKey || '') });
      const r = await _relayRequest(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authToken || '') },
        body: body, timeout: 8000
      });
      if (r.__timeout) return { success: false, error: 'timeout' };
      if (r.__netError) return { success: false, error: r.__netError };
      let parsed = null;
      try { parsed = JSON.parse(r.text); } catch (_) {}
      if (r.status >= 200 && r.status < 300) return parsed || { success: true };
      return { success: false, status: r.status, error: (parsed && parsed.error) || ('HTTP ' + r.status) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ═══ 키오스크 HTML 업로드 (URL 접속 방식, 2026-06-12) ═══
   *  빌드된 키오스크 HTML 을 릴레이 서버에 올려 GET /k/:channelId 로 태블릿이 접속.
   *  HTML 이 배경이미지·명단 임베드로 10MB+ 일 수 있어 timeout 60s. */
  ipcMain.handle('kiosk-upload-html', async (event, { relayUrl, channelId, authToken, html }) => {
    if (!relayUrl || !channelId) return { success: false, error: 'No relay info' };
    if (!html || typeof html !== 'string') return { success: false, error: 'No html' };
    try {
      /* ── URL 보안 검증: HTTPS만 허용, 사설 IP 차단 (kiosk-push-config 와 동일) ── */
      const url = new URL(relayUrl + '/api/v1/kiosk/html/' + channelId);
      if (url.protocol !== 'https:') {
        return { success: false, error: 'HTTPS만 허용됩니다' };
      }
      const hostname = url.hostname.toLowerCase();
      const blockedPatterns = [
        /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
        /^0\./, /^\[::1\]$/, /^\[fc/i, /^\[fd/i, /^169\.254\./, /\.local$/i,
      ];
      if (blockedPatterns.some(p => p.test(hostname))) {
        return { success: false, error: '허용되지 않은 호스트입니다' };
      }

      const body = Buffer.from(html, 'utf8');
      const r = await _relayRequest(url.toString(), {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': body.length,
          'Authorization': 'Bearer ' + (authToken || '')
        },
        body: body, timeout: 60000
      });
      if (r.__timeout) return { success: false, error: '업로드 시간 초과', _netCode: 'timeout' };
      if (r.__netError) return { success: false, error: r.__netError, _netCode: r.__netError };
      let parsed = null;
      try { parsed = JSON.parse(r.text); } catch (_) {}
      if (r.status >= 200 && r.status < 300) return { success: true, size: body.length };
      return { success: false, status: r.status, error: (parsed && parsed.error) || ('HTTP ' + r.status), body: String(r.text || '').slice(0, 500) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── 채널 상태 확인 (서버에 채널이 아직 살아있는지 — "확인 및 사용" 버튼 활성/비활성 판단) ── */
  ipcMain.handle('kiosk-channel-status', async (event, { relayUrl, channelId }) => {
    if (!relayUrl || !channelId) return { ok: false, exists: false };
    try {
      const url = new URL(relayUrl + '/api/v1/kiosk/status/' + channelId);
      if (url.protocol !== 'https:') return { ok: false, exists: false, error: 'HTTPS만 허용' };
      const r = await _relayRequest(url.toString(), { method: 'GET', timeout: 5000 });
      if (r.__timeout) return { ok: false, exists: false, error: 'timeout', _netCode: 'timeout' };
      if (r.__netError) return { ok: false, exists: false, error: r.__netError, _netCode: r.__netError };
      try { const j = JSON.parse(r.text); return { ok: true, exists: !!j.exists, _httpStatus: r.status }; }
      catch (_) { return { ok: false, exists: false, _httpStatus: r.status, _rawBody: String(r.text || '').slice(0, 200) }; }
    } catch (e) { return { ok: false, exists: false, error: e.message }; }
  });

  /* ── 릴레이 채널 자동 생성 ── */
  ipcMain.handle('kiosk-create-channel', async (event, { relayUrl, schoolName, educationOffice }) => {
    if (!relayUrl) return { success: false, error: 'URL 없음' };
    try {
      const url = new URL(relayUrl + '/api/v1/admin/channel');
      const body = JSON.stringify({ school_name: schoolName || '', education_office: educationOffice || '' });
      const r = await _relayRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, timeout: 10000 });
      if (r.__timeout) return { success: false, error: '연결 시간 초과', _netCode: 'timeout' };
      if (r.__netError) return { success: false, error: r.__netError, _netCode: r.__netError };
      const _rawBody = String(r.text || '').slice(0, 500);
      let _parsed = null; try { _parsed = JSON.parse(r.text); } catch (_) {}
      if (_parsed && typeof _parsed === 'object') { _parsed._httpStatus = r.status; _parsed._rawBody = _rawBody; return _parsed; }
      return { success: false, error: '서버 응답 파싱 실패', _httpStatus: r.status, _rawBody: _rawBody };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 릴레이 서버 연결 테스트 ── */
  ipcMain.handle('kiosk-test-relay', async (event, { relayUrl, channelId, nurseToken }) => {
    if (!relayUrl) return { ok: false, error: 'URL 없음' };
    try {
      const url = new URL(relayUrl + '/health');
      if (url.protocol !== 'https:') return { ok: false, error: 'HTTPS만 허용됩니다' };
      const r = await _relayRequest(url.toString(), { method: 'GET', timeout: 5000 });
      if (r.__timeout) return { ok: false, error: '연결 시간 초과' };
      if (r.__netError) return { ok: false, error: r.__netError };
      try { const j = JSON.parse(r.text); return { ok: j.ok === true }; }
      catch { return { ok: r.status < 400 }; }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  /* ── 대기 명단 조회 ── */
  ipcMain.handle('kiosk-get-receptions', async (event, { relayUrl, channelId, nurseToken }) => {
    if (!relayUrl || !channelId || !nurseToken) return { success: false, error: '설정 정보 부족' };
    try {
      const url = new URL(relayUrl + '/api/v1/nurse/receptions/' + channelId);
      if (url.protocol !== 'https:') return { success: false, error: 'HTTPS만 허용됩니다' };
      const r = await _relayRequest(url.toString(), { method: 'GET', headers: { 'Authorization': 'Bearer ' + nurseToken }, timeout: 8000 });
      if (r.__timeout) return { success: false, error: '시간 초과' };
      if (r.__netError) return { success: false, error: r.__netError };
      try { return JSON.parse(r.text); }
      catch { return { success: false, error: '응답 파싱 실패' }; }
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 접수 처리 완료 ── */
  ipcMain.handle('kiosk-complete-reception', async (event, { relayUrl, channelId, nurseToken, receptionId }) => {
    if (!relayUrl || !channelId || !nurseToken || !receptionId) return { success: false };
    try {
      const url = new URL(relayUrl + '/api/v1/nurse/receptions/' + channelId + '/' + receptionId + '/complete');
      if (url.protocol !== 'https:') return { success: false, error: 'HTTPS만 허용됩니다' };
      const r = await _relayRequest(url.toString(), { method: 'POST', headers: { 'Authorization': 'Bearer ' + nurseToken, 'Content-Length': '0' }, timeout: 8000 });
      if (r.__timeout) return { success: false, error: '시간 초과' };
      if (r.__netError) return { success: false, error: r.__netError };
      try { return JSON.parse(r.text); }
      catch { return { success: r.status < 400 }; }
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  사용자 관리 IPC (UserService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('user-get-all', () => {
    try { return { success: true, data: services.users().getAll() }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('user-get-active', () => {
    try { return { success: true, data: services.users().getActive() }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('user-get-by-id', (_, id) => {
    try { return { success: true, data: services.users().getById(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  /* 사용자(보건교사) 정보 별도 JSON 백업 — DB 가 망가져도 보존되도록 이중화.
     userData/data/users_backup.json 에 활성/비활성 모두 dump. */
  function _dumpUsersBackup() {
    try {
      const all = services.users().getAll();
      const dst = path.join(app.getPath('userData'), 'data', 'users_backup.json');
      try { fs.mkdirSync(path.dirname(dst), { recursive: true }); } catch (_) {}
      const payload = { savedAt: new Date().toISOString(), users: all };
      const tmp = dst + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, dst);
    } catch (e) { console.warn('[USER-BACKUP] dump 실패:', e.message); }
  }

  ipcMain.handle('user-create', (_, data) => {
    try {
      const u = services.users().create(data);
      _dumpUsersBackup();
      return { success: true, data: u };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('user-update', (_, id, data) => {
    try {
      const u = services.users().update(id, data);
      _dumpUsersBackup();
      return { success: true, data: u };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('user-delete', (_, id) => {
    try {
      const r = services.users().remove(id);
      _dumpUsersBackup();
      return { success: true, data: r };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('user-set-current', (_, userId) => {
    try {
      services.appConfig().setCurrentUser(userId);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('user-get-current', () => {
    try {
      const userId = services.appConfig().getCurrentUserId();
      if (!userId) return { success: true, data: null };
      const user = services.users().getById(userId);
      return { success: true, data: user };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  과거 데이터 이관 IPC (PastHistoryService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('choose-sqlite-file', async () => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '기존 데이터베이스 파일 선택',
        filters: [{ name: 'SQLite Database', extensions: ['sqlite3', 'db'] }],
        properties: ['openFile']
      });
      if (result.canceled || !result.filePaths.length) return { success: true, data: null };
      return { success: true, data: result.filePaths[0] };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('import-existing-db', (_, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const Database = require('better-sqlite3');
      /* 유효성 검사: SQLite 파일인지 확인 */
      const testDb = new Database(filePath, { readonly: true });
      const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
      testDb.close();
      const hasStudents = tables.includes('students');
      const hasRecords = tables.includes('daily_records');
      if (!hasStudents && !hasRecords) throw new Error('유효한 보건일지 데이터베이스가 아닙니다.');
      /* 앱 데이터 경로로 복사 */
      const destPath = path.join(app.getPath('userData'), 'my_health_diary.sqlite3');
      fs.copyFileSync(filePath, destPath);
      return { success: true, data: { hasStudents, hasRecords, tables } };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('import-past-history-xlsx', (_, { filePath }) => {
    try {
      const result = services.pastHistory().importFromXlsx(filePath);
      return { success: true, data: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 브라우저에서 ArrayBuffer 로 받은 파일을 임시 경로에 저장 후 경로 반환
     (Electron 32+ 에서 File.path 제거 → 폴백 경로) */
  /* exceljs 로 진료과별 통계 xlsx 빌드 — 보건일지와 동일 스타일 (색상바/제목/외곽선/freeze) + 학생·교직원·전체 세 섹션 */
  ipcMain.handle('xlsx-build-dept-stats', async (_, payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      const ws = wb.addWorksheet('진료과별통계', {
        views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }],
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
      });
      const sections = payload.sections || []; /* [{title, header, rows, totalsRow}] */
      const titleText = payload.titleText || '진료과별 통계';
      const schoolText = payload.schoolText || '';
      const periodText = payload.periodText || '';
      const colCount = payload.colCount || (sections[0] && sections[0].header ? sections[0].header.length : 16);
      const top1 = payload.top1 || Math.round(colCount * 0.7);
      const bot1 = payload.bot1 || (colCount - top1);
      const colWidths = payload.colWidths || new Array(colCount).fill(90);

      /* 컬럼 너비 */
      ws.columns = colWidths.map(function(w){ return { width: Math.max(8, w/7) }; });

      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };

      /* 1: 상단 색상바 */
      const r1 = ws.addRow(new Array(colCount).fill(' '));
      r1.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r1.getCell(i).fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
      }
      /* 2: 제목 */
      const r2 = ws.addRow([titleText]);
      r2.height = 32;
      ws.mergeCells(2, 1, 2, colCount);
      const c2 = r2.getCell(1);
      c2.font = { bold: true, size: 16, name: '맑은 고딕' };
      c2.alignment = { horizontal: 'center', vertical: 'middle' };
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      /* 3: 하단 색상바 */
      const r3 = ws.addRow(new Array(colCount).fill(' '));
      r3.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r3.getCell(i).fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: i <= bot1 ? 'FF2E8B57' : 'FFC0392B' } };
      }
      /* 4: 여백 */
      ws.addRow([]).height = 24;
      /* 5: 학교 */
      const r5 = ws.addRow([schoolText]);
      r5.height = 22;
      ws.mergeCells(5, 1, 5, colCount);
      r5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      /* 6: 기간 */
      const r6 = ws.addRow([periodText]);
      r6.height = 22;
      ws.mergeCells(6, 1, 6, colCount);
      r6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      /* 7: 여백 */
      ws.addRow([]).height = 24;

      /* 8: 섹션1 헤더 (freeze 포함) - 첫 섹션 컬럼 헤더를 8행에 배치 */
      let curRow = 8;
      sections.forEach(function(section, sIdx){
        /* 섹션 제목 */
        if (sIdx > 0) {
          /* 두 번째 이후 섹션 — 제목 행 전에 여백 */
          ws.addRow([]).height = 14;
          curRow++;
        }
        /* 섹션 타이틀 (병합) */
        const stRow = ws.addRow([section.title || '']);
        stRow.height = 24;
        ws.mergeCells(curRow, 1, curRow, colCount);
        const stC = stRow.getCell(1);
        stC.font = { bold: true, size: 13, color: { argb: 'FF0E7490' }, name: '맑은 고딕' };
        stC.alignment = { horizontal: 'left', vertical: 'middle' };
        stC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FB' } };
        curRow++;

        /* 컬럼 헤더 */
        const headerRow = ws.addRow(section.header || []);
        headerRow.height = 26;
        for (let i = 1; i <= colCount; i++) {
          const c = headerRow.getCell(i);
          c.font = { bold: true, size: 11, name: '맑은 고딕' };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
          c.border = {
            top: headerBorder,
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            left: i === 1 ? headerBorder : thinBorder,
            right: i === colCount ? headerBorder : thinBorder
          };
        }
        curRow++;

        /* 데이터 행 */
        const rows = section.rows || [];
        const totalsRow = section.totalsRow;
        rows.forEach(function(rowData, ri){
          const tr = ws.addRow(rowData);
          const isLastRow = !totalsRow && ri === rows.length - 1;
          for (let i = 1; i <= colCount; i++) {
            const c = tr.getCell(i);
            c.font = { size: 10, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            c.border = {
              top: thinBorder,
              bottom: isLastRow ? headerBorder : thinBorder,
              left: i === 1 ? headerBorder : thinBorder,
              right: i === colCount ? headerBorder : thinBorder
            };
          }
          curRow++;
        });
        /* 합계 행 (있으면) — 굵게·강조 */
        if (totalsRow) {
          const tr = ws.addRow(totalsRow);
          for (let i = 1; i <= colCount; i++) {
            const c = tr.getCell(i);
            c.font = { bold: true, size: 10, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } };
            c.border = {
              top: thinBorder,
              bottom: headerBorder,
              left: i === 1 ? headerBorder : thinBorder,
              right: i === colCount ? headerBorder : thinBorder
            };
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
  });

  /* exceljs 로 방문 순위 xlsx 빌드 — 시트 3장(학생/교직원/학생·교직원), 색상바·제목 비주얼은 보건일지 출력과 동일.
     payload.sheets = [{ name, titleText, schoolText, periodText, groups:[{ title, header:[..], colWidths:[px..], rows:[[..]] }] }]
     groups 는 가로로 나란히 배치, 그룹 사이에 좁은 간격 열. (방문 순위, 2026-06-12) */
  ipcMain.handle('xlsx-build-visit-rank', async (_, payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
      (payload.sheets || []).forEach(function (sh) {
        const groups = sh.groups || [];
        const GAP = 1; /* 그룹 사이 간격 열 수 (열너비 좁게) */
        let colCount = 0;
        groups.forEach(function (g, gi) { colCount += (g.header || []).length; if (gi < groups.length - 1) colCount += GAP; });
        if (colCount < 1) colCount = 1;
        const ws = wb.addWorksheet(sh.name || '순위', {
          views: [{ state: 'frozen', ySplit: 9, topLeftCell: 'A10' }],
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
        });
        /* 컬럼 너비 — 그룹 순서대로, 간격 열은 좁게 */
        const widths = [];
        groups.forEach(function (g, gi) {
          ((g.colWidths && g.colWidths.length) ? g.colWidths : (g.header || []).map(function () { return 90; }))
            .forEach(function (w) { widths.push(Math.max(4, w / 7)); });
          if (gi < groups.length - 1) widths.push(2.2);
        });
        ws.columns = widths.map(function (w) { return { width: w }; });
        const top1 = Math.round(colCount * 0.7);
        /* 1: 상단 색상바 */
        const r1 = ws.addRow(new Array(colCount).fill(' ')); r1.height = 8;
        for (let i = 1; i <= colCount; i++) r1.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
        /* 2: 제목 */
        const r2 = ws.addRow([sh.titleText || '방문 순위']); r2.height = 32;
        ws.mergeCells(2, 1, 2, colCount);
        const c2 = r2.getCell(1);
        c2.font = { bold: true, size: 16, name: '맑은 고딕' };
        c2.alignment = { horizontal: 'center', vertical: 'middle' };
        c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
        /* 3: 하단 색상바 */
        const r3 = ws.addRow(new Array(colCount).fill(' ')); r3.height = 8;
        for (let i = 1; i <= colCount; i++) r3.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= top1 ? 'FF2E8B57' : 'FFC0392B' } };
        /* 4 여백 · 5 학교 · 6 기간 · 7 여백 */
        ws.addRow([]).height = 18;
        const r5 = ws.addRow([sh.schoolText || '']); r5.height = 20; ws.mergeCells(5, 1, 5, colCount);
        r5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
        r5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        const r6 = ws.addRow([sh.periodText || '']); r6.height = 20; ws.mergeCells(6, 1, 6, colCount);
        r6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
        r6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.addRow([]).height = 18;
        /* 8: 그룹 타이틀 행 · 9: 컬럼 헤더 행 · 10~: 데이터 (가로 배치 — 셀 단위 기록) */
        const titleRowIdx = 8, headerRowIdx = 9, dataStart = 10;
        ws.getRow(titleRowIdx).height = 24;
        ws.getRow(headerRowIdx).height = 24;
        let colOff = 1;
        groups.forEach(function (g) {
          const w = (g.header || []).length;
          if (!w) return;
          /* 그룹 타이틀 (병합·시안 강조) */
          ws.mergeCells(titleRowIdx, colOff, titleRowIdx, colOff + w - 1);
          const tc = ws.getCell(titleRowIdx, colOff);
          tc.value = g.title || '';
          tc.font = { bold: true, size: 12, color: { argb: 'FF0E7490' }, name: '맑은 고딕' };
          tc.alignment = { horizontal: 'left', vertical: 'middle' };
          tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FB' } };
          /* 컬럼 헤더 */
          (g.header || []).forEach(function (hv, hi) {
            const c = ws.getCell(headerRowIdx, colOff + hi);
            c.value = hv;
            c.font = { bold: true, size: 10.5, name: '맑은 고딕' };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
            c.border = { top: headerBorder, bottom: headerBorder, left: hi === 0 ? headerBorder : thinBorder, right: hi === w - 1 ? headerBorder : thinBorder };
          });
          /* 데이터 행 */
          (g.rows || []).forEach(function (row, ri) {
            const isLast = ri === g.rows.length - 1;
            row.forEach(function (v, ci) {
              const c = ws.getCell(dataStart + ri, colOff + ci);
              c.value = v;
              c.font = { size: 10, name: '맑은 고딕' };
              c.alignment = { horizontal: (ci === 1) ? 'left' : 'center', vertical: 'middle' }; /* 소속 열만 좌측 */
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
  });


  /* exceljs 로 보건일지 출력 xlsx 빌드 — 색상바·제목·외곽선·freeze 완전 지원
     payload.coverSections 가 있으면 "진료과별 통계" 워크시트를 앞에 추가 (방문 통계 팝업과 동일 구조) */
  ipcMain.handle('xlsx-build-diary', async (_, payload) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '오렌지톡';
      /* Excel 전용 좌측 정렬 열 — 증상·처치 내용(상담 형식은 상담 주제/상담 내용)만. PDF/인쇄는 무관 (사용자 지시 2026-08-27) */
      const _xlLeftCol = function(lbl){ return /^(증상|처치(\s*내용)?|상담 주제|상담 내용)$/.test(String(lbl||'').trim()); };

      /* 1) (옵션) 진료과별 통계 표지 시트 — 대시보드 xlsxBuildDeptStats 와 동일한 비주얼 */
      if (payload.coverSections && Array.isArray(payload.coverSections) && payload.coverSections.length) {
        const cvColCount = payload.coverColCount || (payload.coverSections[0].header ? payload.coverSections[0].header.length : 6);
        const cvTop1 = Math.max(1, Math.round(cvColCount * 0.7));
        const cvBot1 = Math.max(1, cvColCount - cvTop1);
        const cws = wb.addWorksheet('진료과별 통계', {
          views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }],
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        const cvTitle = payload.coverTitle || '진료과별 선택기간 통계';
        const cvSchool = payload.schoolText || '';
        const cvPeriod = payload.periodText || '';
        const cvColWidths = payload.coverColWidths || new Array(cvColCount).fill(90);
        cws.columns = cvColWidths.map(function(w){ return { width: Math.max(8, w/7) }; });
        const cHeadBorder = { style: 'medium', color: { argb: 'FF000000' } };
        const cThinBorder = { style: 'thin', color: { argb: 'FF555555' } };
        /* 1행: 상단 색상바 */
        const cr1 = cws.addRow(new Array(cvColCount).fill(' ')); cr1.height = 8;
        for (let i = 1; i <= cvColCount; i++) {
          cr1.getCell(i).fill = { type: 'pattern', pattern: 'solid',
            fgColor: { argb: i <= cvTop1 ? 'FF2855A0' : 'FFD4A843' } };
        }
        /* 2행: 제목 병합 */
        const cr2 = cws.addRow([cvTitle]); cr2.height = 32;
        cws.mergeCells(2, 1, 2, cvColCount);
        cr2.getCell(1).font = { bold: true, size: 16, name: '맑은 고딕' };
        cr2.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        cr2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
        /* 3행: 하단 색상바 */
        const cr3 = cws.addRow(new Array(cvColCount).fill(' ')); cr3.height = 8;
        for (let i = 1; i <= cvColCount; i++) {
          cr3.getCell(i).fill = { type: 'pattern', pattern: 'solid',
            fgColor: { argb: i <= cvBot1 ? 'FF2E8B57' : 'FFC0392B' } };
        }
        /* 4행 여백 / 5행 학교 / 6행 기간 / 7행 여백 */
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
        /* 섹션 렌더 — 진료과별 통계 (대시보드와 동일 패턴) */
        let cvRow = 8;
        payload.coverSections.forEach(function(section, sIdx){
          if (sIdx > 0) { cws.addRow([]).height = 14; cvRow++; }
          /* 섹션 타이틀 (병합) */
          const stRow = cws.addRow([section.title || '']);
          stRow.height = 24;
          cws.mergeCells(cvRow, 1, cvRow, cvColCount);
          const stC = stRow.getCell(1);
          stC.font = { bold: true, size: 13, color: { argb: 'FF0E7490' }, name: '맑은 고딕' };
          stC.alignment = { horizontal: 'left', vertical: 'middle' };
          stC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FB' } };
          cvRow++;
          /* 컬럼 헤더 */
          const hdr = cws.addRow(section.header || []);
          hdr.height = 26;
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

      /* "매일 한 페이지" 용: 메인 시트 이름을 MM-DD 로 덮어쓰고, dailySheets 배열을
         각각 별도 워크시트로 추가 (모두 보건일지 단일 페이로드 포맷 재사용) */
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
        /* 일간 방문 통계 섹션 (학생 학년별 / 교직원 / 전체) — 본문 앞에 삽입 */
        if (p.preambleSections && p.preambleSections.sections && p.preambleSections.sections.length) {
          const pbCols = p.preambleSections.colCount || colCount;
          /* 섹션 간 병합은 최대 pbCols 만큼만 가능하므로 colCount 이하로 제한 */
          const mergeCols = Math.min(pbCols, colCount);
          const pbThin = { style:'thin', color:{argb:'FF9CA3AF'} };
          const pbHead = { style:'medium', color:{argb:'FF000000'} };
          /* 상단 안내 */
          const pbTitleRow = wsInst.addRow(['📊 일간 방문 통계']);
          pbTitleRow.height = 22;
          wsInst.mergeCells(pbTitleRow.number, 1, pbTitleRow.number, colCount);
          pbTitleRow.getCell(1).font = { bold:true, size:12, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
          pbTitleRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
          p.preambleSections.sections.forEach(function(section, sIdx){
            if (sIdx > 0) wsInst.addRow([]).height = 6;
            /* 섹션 타이틀 */
            const stRow = wsInst.addRow([section.title || '']);
            stRow.height = 20;
            wsInst.mergeCells(stRow.number, 1, stRow.number, colCount);
            stRow.getCell(1).font = { bold:true, size:11, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
            stRow.getCell(1).alignment = { horizontal:'left', vertical:'middle' };
            stRow.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE6F7FB'} };
            /* 컬럼 헤더 */
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
          /* 방문 상세 섹션 타이틀 */
          const visitTitle = wsInst.addRow(['📝 방문 상세']);
          visitTitle.height = 22;
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
            c.alignment = { horizontal: _xlLeftCol(headerLabels[i-1]) ? 'left' : 'center', vertical:'middle', wrapText:true };
            c.border = { top:thinBorder, bottom: isLastRow ? headerBorder : thinBorder,
              left: i===1 ? headerBorder : thinBorder, right: i===colCount ? headerBorder : thinBorder };
          }
        });
        wsInst.pageSetup.printTitlesRow = '1:8';
      }
      /* 매일 한 페이지 분기 — continuousDays 가 있으면 단일 워크시트에
         상단 색상바·제목만 고정하고, 날짜별 통계·방문표를 연속으로 쌓으며 각 날짜 전에 페이지 나눔.
         (과거 dailySheets 다중 워크시트 방식 제거) */
      if (Array.isArray(payload.continuousDays) && payload.continuousDays.length > 0) {
        const colWidths = payload.colWidths || [];
        const colCount = payload.colCount || colWidths.length || 8;
        const titleText = payload.titleText || '보건실 방문자 현황';
        const schoolText = payload.schoolText || '';
        const periodText = payload.periodText || '';
        /* ── 미세격자(base grid) 정렬 알고리듬 (사용자 요청 2026-06-15) ──
         *  방문 상세 각 열을 "가장 좁은 열 = 7칸, 너비 정비례" 로 잘게 병합 표현한다.
         *  위쪽 오늘의 메모·일간 방문 통계는 같은 totalBase 칸에 '균등' 분배해서,
         *  표시 항목 개수·너비를 어떻게 바꿔도 세로줄이 들쑥날쭉하지 않고 좌우 끝이 정확히 일치한다. */
        const _wArr = (colWidths.length === colCount && colCount > 0)
          ? colWidths.map(function(w){ return (+w > 0) ? +w : 44; })
          : new Array(colCount).fill(44);
        const minW = Math.min.apply(null, _wArr) || 44;
        const unit = minW / 7;                                       /* base 한 칸 = 가장 좁은 열 / 7 (px) */
        const baseCols = _wArr.map(function(w){ return Math.max(7, Math.round(w / unit)); });
        const totalBase = baseCols.reduce(function(a, b){ return a + b; }, 0);
        /* 표 좌측 테두리 인쇄 문제의 실제 원인은 "병합 셀 슬레이브에 테두리를 줘서 마스터 테두리가
         *  지워진 것"이었다(아래 _detailRow 주석 참조). 마스터-온리 테두리로 고쳤으므로 좌측 여백 열은
         *  불필요 → 제거(C0=0). FIRST/LAST 는 1·totalBase 로, 오프셋 산식은 +0 무효 (2026-06-16). */
        const C0 = 0;
        const FIRST = 1 + C0, LAST = totalBase + C0;
        const colSpan = [];                                          /* 각 detail 열 → base 범위 [c1,c2] (스페이서 오프셋 포함) */
        (function(){ let acc = 0; baseCols.forEach(function(bc){ colSpan.push([acc + 1 + C0, acc + bc + C0]); acc += bc; }); })();
        const top1B = Math.max(1, Math.round(totalBase * 0.7));      /* 상단 색상바 파랑/노랑 경계 */
        const bot1B = Math.max(1, Math.round(totalBase * 0.3));      /* 하단 색상바 초록/빨강 경계 */
        /* total 칸을 n 개 near-equal 범위로 균등 분배(나머지는 앞 칸에 1씩). 스페이서 오프셋 포함. */
        const _evenSpans = function(total, n){
          const spans = []; const b = Math.floor(total / n), rem = total % n; let acc = 0;
          for (let i = 0; i < n; i++){ const w = b + (i < rem ? 1 : 0); spans.push([acc + 1 + C0, acc + w + C0]); acc += w; }
          return spans;
        };
        const wsMain = wb.addWorksheet(mainSheetTitle, {
          /* 표지 페이지 방식 — 상단 고정(frozen) 해제 (제목/색상바가 표지로 내려감, 2026-06-16) */
          /* 페이지 나누기 미리보기 뷰 — 인쇄영역 밖 회색 + "1페이지/2페이지" 배경 글자 + 페이지 점선 구분 (사용자 요청 2026-06-16) */
          views: [{ style: 'pageBreakPreview' }],
          /* A4 가로 + fitToWidth (사용자 결정 2026-06-15) — 미세격자 표를 한 페이지 폭에 맞춤.
           *  좌측 여백을 약간 키워(0.16→0.3) 인쇄 시 표 맨 왼쪽 테두리가 인쇄 경계에 잘리지 않게 함 (사용자 요청 2026-06-16). */
          pageSetup: { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0,
            margins:{ left:0.3, right:0.16, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }
        });
        wsMain.columns = new Array(totalBase).fill(0).map(function(){ return { width: Math.max(1, unit / 7) }; });
        const headerBorder = { style:'medium', color:{argb:'FF000000'} };
        const thinBorder = { style:'thin', color:{argb:'FF555555'} };
        /* ── 표지 페이지(1페이지) — 제목+색상바를 아래로 내리고, 학교·기간·제목 글씨를 크게.
         *  본문은 2페이지부터 시작 (사용자 요청 2026-06-16). 모든 내용은 FIRST..LAST(좌측 여백 열 다음)에 배치. ── */
        /* 위쪽 여백 — 표지 제목을 페이지 중앙쯤으로 더 내림 (사용자 요청 2026-06-16) */
        wsMain.addRow([]).height = 90;
        wsMain.addRow([]).height = 90;
        wsMain.addRow([]).height = 90;
        /* 상단 색상바 */
        const r1m = wsMain.addRow([]); r1m.height = 12;
        for (let i=1;i<=totalBase;i++){ r1m.getCell(i+C0).fill={ type:'pattern', pattern:'solid', fgColor:{argb:i<=top1B?'FF2855A0':'FFD4A843'} }; }
        /* 제목 (크게) */
        const r2m = wsMain.addRow([]); r2m.height = 64;
        wsMain.mergeCells(r2m.number, FIRST, r2m.number, LAST);
        r2m.getCell(FIRST).value = titleText;
        r2m.getCell(FIRST).font = { bold:true, size:32, name:'맑은 고딕' };
        r2m.getCell(FIRST).alignment = { horizontal:'center', vertical:'middle' };
        r2m.getCell(FIRST).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF7F7F7'} };
        /* 하단 색상바 */
        const r3m = wsMain.addRow([]); r3m.height = 12;
        for (let i=1;i<=totalBase;i++){ r3m.getCell(i+C0).fill={ type:'pattern', pattern:'solid', fgColor:{argb:i<=bot1B?'FF2E8B57':'FFC0392B'} }; }
        /* 제목 색상바 ~ 기관명 사이 간격 — 훨씬 넓게 (사용자 요청 2026-06-16) */
        wsMain.addRow([]).height = 40;
        wsMain.addRow([]).height = 40;
        wsMain.addRow([]).height = 40;
        /* 학교·기간 (크게, 가운데) */
        const r5m = wsMain.addRow([]); r5m.height = 40; wsMain.mergeCells(r5m.number,FIRST,r5m.number,LAST);
        r5m.getCell(FIRST).value = schoolText;
        r5m.getCell(FIRST).font = { bold:true, size:22, name:'맑은 고딕' }; r5m.getCell(FIRST).alignment = { horizontal:'center', vertical:'middle' };
        const r6m = wsMain.addRow([]); r6m.height = 36; wsMain.mergeCells(r6m.number,FIRST,r6m.number,LAST);
        r6m.getCell(FIRST).value = periodText;
        r6m.getCell(FIRST).font = { bold:true, size:20, name:'맑은 고딕' }; r6m.getCell(FIRST).alignment = { horizontal:'center', vertical:'middle' };
        /* 표지 다음 — 본문은 2페이지부터 */
        wsMain.getRow(r6m.number + 1).addPageBreak();
        /* 각 날짜 연속 쌓기 */
        payload.continuousDays.forEach(function(day, dayIdx){
          /* 두 번째 날짜부터는 날짜간 여백 + 페이지 나눔 (하루가 넘어가면 다음 페이지 맨 위부터).
           *  첫 날은 표지 다음 페이지(2페이지) 맨 위에서 바로 시작. */
          if (dayIdx > 0) {
            wsMain.addRow([]).height = 18;
            const pbRow = wsMain.lastRow.number + 1;
            wsMain.getRow(pbRow).addPageBreak();
          }
          /* 날짜 헤더 */
          const d = new Date(day.date);
          const dow=['일','월','화','수','목','금','토'][d.getDay()];
          const dayTitle = d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 ('+dow+')';
          const dayTitleRow = wsMain.addRow([]);
          dayTitleRow.height = 24;
          wsMain.mergeCells(dayTitleRow.number, FIRST, dayTitleRow.number, LAST);
          dayTitleRow.getCell(FIRST).value = '📅 '+dayTitle+'  ·  방문 '+(day.dataRows||[]).length+'명';
          dayTitleRow.getCell(FIRST).font = { bold:true, size:13, color:{argb:'FF0F172A'}, name:'맑은 고딕' };
          dayTitleRow.getCell(FIRST).alignment = { horizontal:'left', vertical:'middle' };
          dayTitleRow.getCell(FIRST).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE0F2FE'} };
          dayTitleRow.getCell(FIRST).border = { top:headerBorder, bottom:thinBorder, left:headerBorder, right:headerBorder };
          wsMain.addRow([]).height = 12;   /* 날짜 헤더 ~ 메모 사이 여백 */
          /* ── 오늘의 메모 — totalBase 칸에 균등 분배 (제목층/내용층 wrapText) ── */
          if (day.todayMemo && Array.isArray(day.todayMemo.titles) && day.todayMemo.titles.length) {
            const tmTitle = wsMain.addRow([]); tmTitle.height = 20;
            wsMain.mergeCells(tmTitle.number, FIRST, tmTitle.number, LAST);
            tmTitle.getCell(FIRST).value = '📝 오늘의 메모';
            tmTitle.getCell(FIRST).font = { bold:true, size:11, color:{argb:'FF4D7C0F'}, name:'맑은 고딕' };
            tmTitle.getCell(FIRST).alignment = { horizontal:'left', vertical:'middle' };
            tmTitle.getCell(FIRST).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF1F8E9'} };
            const tmN = day.todayMemo.titles.length;
            const tmSpans = _evenSpans(totalBase, tmN);
            const _tmRow = function(values, head, h){
              const row = wsMain.addRow([]); row.height = h;
              tmSpans.forEach(function(sp, i){
                const c1 = sp[0], c2 = sp[1];
                if (c2 > c1) wsMain.mergeCells(row.number, c1, row.number, c2);
                const c = row.getCell(c1);   /* ★ 병합 테두리는 마스터 셀에만 (슬레이브에 주면 좌측선 사라짐) */
                c.value = values[i];
                c.font = head ? { bold:true, size:10, name:'맑은 고딕', color:{argb:'FF475569'} } : { size:10, name:'맑은 고딕' };
                c.alignment = head ? { horizontal:'center', vertical:'middle' } : { horizontal:'left', vertical:'top', wrapText:true };
                if (head) c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
                c.border = { top: head?headerBorder:thinBorder, bottom: head?thinBorder:headerBorder,
                  left: c1===FIRST?headerBorder:thinBorder,
                  right: c2===LAST?headerBorder:thinBorder };
              });
            };
            _tmRow(day.todayMemo.titles, true, 20);
            _tmRow(day.todayMemo.cells, false, 52);
            wsMain.addRow([]).height = 16;   /* 메모 ~ 통계 사이 여백 */
          }
          /* 일간 방문 통계 3섹션 */
          if (day.preambleSections && day.preambleSections.sections && day.preambleSections.sections.length) {
            const statsTitleRow = wsMain.addRow([]);
            statsTitleRow.height = 20;
            wsMain.mergeCells(statsTitleRow.number, FIRST, statsTitleRow.number, LAST);
            statsTitleRow.getCell(FIRST).value = '📊 일간 방문 통계';
            statsTitleRow.getCell(FIRST).font = { bold:true, size:11, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
            statsTitleRow.getCell(FIRST).alignment = { horizontal:'left', vertical:'middle' };
            const pbThin = { style:'thin', color:{argb:'FF9CA3AF'} };
            const pbHead = { style:'medium', color:{argb:'FF000000'} };
            day.preambleSections.sections.forEach(function(section, sIdx){
              if (sIdx > 0) wsMain.addRow([]).height = 10;
              /* 섹션 타이틀 */
              const stR = wsMain.addRow([]);
              stR.height = 20;
              wsMain.mergeCells(stR.number, FIRST, stR.number, LAST);
              stR.getCell(FIRST).value = section.title||'';
              stR.getCell(FIRST).font = { bold:true, size:10.5, color:{argb:'FF0E7490'}, name:'맑은 고딕' };
              stR.getCell(FIRST).alignment = { horizontal:'left', vertical:'middle' };
              stR.getCell(FIRST).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE6F7FB'} };
              /* ── 0건 진료과 열 생략 (2026-06-11) — 통계 열(예: 진료과 14개=16열)이 시트 열(13)보다
               *  많으면 병합 정렬이 불가능해 폴백되던 원인. 기간 내 전부 0인 데이터 열을 빼면
               *  열 수가 줄어 병합 정렬 가능 + 인쇄 가독성도 향상. 라벨(첫)·계(끝) 열은 항상 보존. */
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
              /* ── 통계 N열을 totalBase 미세격자에 균등 분배 — 항목 수·detail 너비와 무관하게
               *  열폭 균등 + 좌우 끝이 방문 상세와 정확히 일치 (들쑥날쭉 제거, 2026-06-15). */
              function _addAlignedRow(values, applyStyle, topB, bottomB){
                const N = values.length;
                const row = wsMain.addRow([]);
                /* 미세격자 균등 분배 — 항목 수·detail 너비와 무관하게 통계 열폭 균등 + 좌우 끝 일치. (2026-06-15) */
                const spans = _evenSpans(totalBase, N);
                spans.forEach(function(sp, i){
                  const c1 = sp[0], c2 = sp[1];
                  if (c2 > c1) wsMain.mergeCells(row.number, c1, row.number, c2);
                  const c = row.getCell(c1);   /* ★ 병합 테두리는 마스터 셀에만 (슬레이브에 주면 좌측선 사라짐) */
                  c.value = values[i];
                  applyStyle(c);
                  c.border = { top: topB, bottom: bottomB,
                    left:  c1===FIRST ? pbHead : pbThin,
                    right: c2===LAST ? pbHead : pbThin };
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
            wsMain.addRow([]).height = 16;   /* 통계 ~ 방문 상세 사이 여백 */
          }
          /* 방문 상세 타이틀 */
          const visitTitle = wsMain.addRow([]);
          visitTitle.height = 20;
          wsMain.mergeCells(visitTitle.number, FIRST, visitTitle.number, LAST);
          visitTitle.getCell(FIRST).value = '📝 방문 상세';
          visitTitle.getCell(FIRST).font = { bold:true, size:11, color:{argb:'FF4338CA'}, name:'맑은 고딕' };
          visitTitle.getCell(FIRST).alignment = { horizontal:'left', vertical:'middle' };
          /* ── 방문표 — 각 열을 colSpan(7칸+ 정비례)으로 병합. 머지셀은 자동 행높이가 안되므로 줄수로 높이 지정 ── */
          const dayHdrLabels = day.headerLabels || [];
          const dayColCount = Math.min(dayHdrLabels.length || colCount, colCount, colSpan.length);
          const _detailRow = function(values, head, isLast, h){
            const row = wsMain.addRow([]);
            if (h) row.height = h;
            for (let ci=0; ci<dayColCount; ci++){
              const sp = colSpan[ci]; if (!sp) continue;
              const c1 = sp[0], c2 = sp[1];
              if (c2 > c1) wsMain.mergeCells(row.number, c1, row.number, c2);
              /* ★ 병합 셀 테두리는 반드시 마스터(좌상단=c1) 셀에만 줄 것. 슬레이브 셀에 테두리를
               *  주면 ExcelJS 가 마스터의 테두리(특히 좌측)를 지워버려 인쇄 시 좌측 선이 사라진다
               *  (라운드트립 검증 2026-06-16). 좌=첫열이면 medium·아니면 thin, 우=끝열이면 medium·아니면 thin. */
              const c = row.getCell(c1);
              c.value = (values[ci] != null) ? values[ci] : '';
              if (head){
                c.font = { bold:true, size:10.5, name:'맑은 고딕' };
                c.alignment = { horizontal:'center', vertical:'middle' };
                c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEAEAEA'} };
              } else {
                c.font = { size:10, name:'맑은 고딕' };
                c.alignment = { horizontal: _xlLeftCol(dayHdrLabels[ci]) ? 'left' : 'center', vertical:'middle', wrapText:true };
              }
              c.border = { top: head?headerBorder:thinBorder,
                bottom: head?thinBorder:(isLast?headerBorder:thinBorder),
                left: c1===FIRST?headerBorder:thinBorder,
                right: c2===LAST?headerBorder:thinBorder };
            }
            return row;
          };
          /* 페이지 끝에 걸린 직전 행을 굵은 아래선으로 닫아 표 박스를 페이지마다 완전히 닫는다(마스터 셀만 갱신). */
          const _closeRowBottom = function(row){
            for (let ci=0; ci<dayColCount; ci++){
              const sp = colSpan[ci]; if (!sp) continue;
              const c = row.getCell(sp[0]);
              const b = c.border || {};
              c.border = { top: b.top, left: b.left, right: b.right, bottom: headerBorder };
            }
          };
          _detailRow(dayHdrLabels, true, false, 22);
          const _baseColW = Math.max(1, unit / 7);   /* base 한 칸의 엑셀 폭(글자수 근사) */
          /* ── 페이지마다 표 완전히 닫기 (사용자 선택 2026-06-16) ──
           *  하루 표가 한 페이지를 넘으면 넘기 직전에 수동으로 페이지를 나누고(직전 행을 굵은 아래선으로 닫음),
           *  다음 페이지 맨 위에 열 제목을 다시 깔아 표 박스가 페이지마다 완전히 닫히게 한다.
           *  PAGE_H 는 A4 가로 가용 높이(~537pt)보다 보수적으로(500) 잡아 fitToWidth 축소 시에도 항상
           *  Excel 자동 나눔보다 먼저 나눠 빈 공간/잘림을 방지한다. pageY 는 실제 행 높이 합으로 정확히 추적. */
          const PAGE_H = 500;
          const _rowH = function(n){ const h = wsMain.getRow(n).height; return (typeof h === 'number' && h > 0) ? h : 15; };
          let pageY = 0;
          for (let n = dayTitleRow.number; n <= wsMain.lastRow.number; n++) pageY += _rowH(n);
          let prevDetailRow = null;
          const _dataRows = day.dataRows || [];
          _dataRows.forEach(function(row, ri){
            const isLast = ri === (_dataRows.length - 1);
            /* 머지셀은 엑셀이 자동 행높이를 못 잡으므로, 셀 내용을 열 폭으로 wrap 해 줄수를 추정하여 높이 지정.
             *  (줄바꿈 \n + 길이 기준 wrap. 한글/전각은 폭 2로 세어 살짝 넉넉하게 → 잘림 방지. 사용자 보고 2026-06-16) */
            let _lines = 1;
            for (let k=0;k<dayColCount;k++){
              const v = row[k]; if (v == null || v === '') continue;
              const charW = Math.max(4, (baseCols[k]||7) * _baseColW);
              const segs = String(v).split('\n');
              let ln = 0;
              for (let si=0; si<segs.length; si++){
                const s = segs[si]; let w = 0;
                for (let ci=0; ci<s.length; ci++){ w += (s.charCodeAt(ci) > 127) ? 2 : 1; }
                ln += Math.max(1, Math.ceil(w / charW));
              }
              if (ln > _lines) _lines = ln;
            }
            const _h = Math.max(20, _lines * 15);
            /* 이 행을 넣으면 페이지를 넘는다 → 직전 행 굵은 아래선으로 닫고 페이지 나눔 + 열 제목 반복 */
            if (prevDetailRow && (pageY + _h) > PAGE_H){
              _closeRowBottom(prevDetailRow);
              wsMain.getRow(wsMain.lastRow.number + 1).addPageBreak();
              _detailRow(dayHdrLabels, true, false, 22);
              pageY = 22;
            }
            prevDetailRow = _detailRow(row, false, isLast, _h);
            pageY += _h;
          });
        });
        /* 인쇄 영역 = 실제 사용 범위(A1 ~ 마지막 열/행, 좌측 여백 열 포함) → 페이지 나누기 미리보기에서 그 바깥이 회색(비인쇄)으로 표시됨 (사용자 요청 2026-06-16) */
        try { wsMain.pageSetup.printArea = 'A1:' + wsMain.getColumn(LAST).letter + wsMain.lastRow.number; } catch (_) {}
        const buf2 = await wb.xlsx.writeBuffer();
        return { success:true, bytes: Array.from(new Uint8Array(buf2)) };
      }

      /* (구) dailySheets 경로는 deprecated — 하위 호환을 위해 남겨두되, 새 continuousDays 로 대체됨 */
      if (Array.isArray(payload.dailySheets) && payload.dailySheets.length > 0) {
        const wsMain = wb.addWorksheet(mainSheetTitle, {
          views: [{ state:'frozen', ySplit:8, topLeftCell:'A9', activeCell:'A9' }],
          pageSetup: { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0,
            margins:{ left:0.4, right:0.4, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }
        });
        _buildDiarySheet(wsMain, payload);
        payload.dailySheets.forEach(function(ds){
          const wsExtra = wb.addWorksheet(ds.sheetTitle || '일자', {
            views: [{ state:'frozen', ySplit:8, topLeftCell:'A9', activeCell:'A9' }],
            pageSetup: { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0,
              margins:{ left:0.4, right:0.4, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }
          });
          _buildDiarySheet(wsExtra, ds.payload || {});
        });
        const buf2 = await wb.xlsx.writeBuffer();
        return { success:true, bytes: Array.from(new Uint8Array(buf2)) };
      }

      /* 기존 단일 시트 경로 (방문자당 한 행 / 특정 방문자 내역).
       * mainSheetTitle 로 탭 이름 지정 가능 — 연수 등록부('등록부') 등 다른 호출자 재사용 (2026-08-25) */
      const ws = wb.addWorksheet(payload.mainSheetTitle || '보건일지', {
        /* 상단 8행 고정 + 페이지 나누기 미리보기 뷰(인쇄영역 밖 회색 + "1페이지" 배경 + 페이지 점선) 공존 (사용자 요청 2026-06-16) */
        views: [{ state: 'frozen', ySplit: 8, topLeftCell: 'A9', activeCell: 'A9', style: 'pageBreakPreview' }],
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
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

      /* 컬럼 너비 (px → exceljs 단위 약 1px = 0.142 char) */
      ws.columns = colWidths.map(function(w){ return { width: Math.max(8, w/7) }; });

      /* 1행: 상단 색상바 */
      const r1 = ws.addRow(new Array(colCount).fill(' '));
      r1.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r1.getCell(i).fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: i <= top1 ? 'FF2855A0' : 'FFD4A843' } };
      }
      /* 2행: 제목 (병합 + 굵게 16) */
      const r2 = ws.addRow([titleText]);
      r2.height = 32;
      ws.mergeCells(2, 1, 2, colCount);
      const c2 = r2.getCell(1);
      c2.font = { bold: true, size: 16, name: '맑은 고딕' };
      c2.alignment = { horizontal: 'center', vertical: 'middle' };
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      /* 3행: 하단 색상바 */
      const r3 = ws.addRow(new Array(colCount).fill(' '));
      r3.height = 8;
      for (let i = 1; i <= colCount; i++) {
        r3.getCell(i).fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: i <= bot1 ? 'FF2E8B57' : 'FFC0392B' } };
      }
      /* 4행: 학교 위 여백 */
      const r4 = ws.addRow([]); r4.height = 24;
      /* 5행: 학교 (병합) */
      const r5 = ws.addRow([schoolText]);
      r5.height = 22;
      ws.mergeCells(5, 1, 5, colCount);
      r5.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r5.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      /* 6행: 기간 (병합) */
      const r6 = ws.addRow([periodText]);
      r6.height = 22;
      ws.mergeCells(6, 1, 6, colCount);
      r6.getCell(1).font = { bold: true, size: 11, name: '맑은 고딕' };
      r6.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      /* 7행: 기간 아래 여백 — noteText 지정 시 우측 정렬 안내 문구(연수 등록부 정렬 안내 등, 2026-08-25) */
      const r7 = ws.addRow([payload.noteText || '']); r7.height = 24;
      if (payload.noteText) {
        ws.mergeCells(7, 1, 7, colCount);
        r7.getCell(1).font = { size: 9, color: { argb: 'FF555555' }, name: '맑은 고딕' };
        r7.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      /* 8행: 컬럼 헤더 */
      const r8 = ws.addRow(headerLabels);
      r8.height = 26;
      const headerBorder = { style: 'medium', color: { argb: 'FF000000' } };
      const thinBorder = { style: 'thin', color: { argb: 'FF555555' } };
      for (let i = 1; i <= colCount; i++) {
        const c = r8.getCell(i);
        c.font = { bold: true, size: 11, name: '맑은 고딕' };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
        c.border = {
          top: headerBorder,
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          left: i === 1 ? headerBorder : thinBorder,
          right: i === colCount ? headerBorder : thinBorder
        };
      }
      /* 9행~: 데이터 */
      const lastDataRowNum = 8 + dataRows.length;
      dataRows.forEach(function(row, ri) {
        const tr = ws.addRow(row);
        const isLastRow = (ri === dataRows.length - 1);
        /* 긴 증상/처치 등 wrap 셀의 행높이 자동맞춤 — ExcelJS 자동높이 미지원 보정 (사용자 보고 2026-06-16).
         *  열 폭(colWidths/7)으로 내용을 wrap 해 줄수 추정. 한글/전각은 폭 2로 넉넉히 → 잘림 방지. */
        let _lines = 1;
        for (let k = 0; k < colCount; k++) {
          const v = row[k]; if (v == null || v === '') continue;
          const charW = Math.max(6, (colWidths[k] != null ? colWidths[k] / 7 : 14));
          const segs = String(v).split('\n');
          let ln = 0;
          for (let si = 0; si < segs.length; si++) {
            const s = segs[si]; let w = 0;
            for (let ci = 0; ci < s.length; ci++) { w += (s.charCodeAt(ci) > 127) ? 2 : 1; }
            ln += Math.max(1, Math.ceil(w / charW));
          }
          if (ln > _lines) _lines = ln;
        }
        tr.height = Math.max(18, _lines * 14);
        for (let i = 1; i <= colCount; i++) {
          const c = tr.getCell(i);
          c.font = { size: 10, name: '맑은 고딕' };
          c.alignment = { horizontal: _xlLeftCol(headerLabels[i-1]) ? 'left' : 'center', vertical: 'middle', wrapText: true };
          c.border = {
            top: thinBorder,
            bottom: isLastRow ? headerBorder : thinBorder,
            left: i === 1 ? headerBorder : thinBorder,
            right: i === colCount ? headerBorder : thinBorder
          };
        }
      });
      /* 표 아래 안내 문구 — footerText(연수 등록부 '자필로 직접 서명 바랍니다.' 등, 2026-08-25) */
      if (payload.footerText) {
        const fr = ws.addRow([payload.footerText]); fr.height = 20;
        ws.mergeCells(fr.number, 1, fr.number, colCount);
        fr.getCell(1).font = { size: 9, color: { argb: 'FF555555' }, name: '맑은 고딕' };
        fr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      }
      /* 인쇄 시 8행까지 매 페이지 반복 */
      ws.pageSetup.printTitlesRow = '1:8';
      /* 인쇄 영역 = 실제 사용 범위 → 페이지 나누기 미리보기에서 그 바깥이 회색(비인쇄)으로 표시 (사용자 요청 2026-06-16) */
      try { ws.pageSetup.printArea = 'A1:' + ws.getColumn(colCount).letter + ws.lastRow.number; } catch (_) {}

      const buf = await wb.xlsx.writeBuffer();
      return { success: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      console.error('[xlsx-build-diary]', e);
      return { success: false, error: e.message };
    }
  });

  /* 상담 기록지 Excel — PDF 폼(상담기록지)과 동일 레이아웃을 ExcelJS 병합셀/테두리로 재현.
   *  레코드당 워크시트 1장. 병합 셀 테두리는 마스터(좌상단) 셀에만 설정(슬레이브에 주면 마스터 좌측선 깨짐 — 과거 확인). (사용자 요청 2026-06-25) */
  ipcMain.handle('xlsx-build-counsel', async (_, payload) => {
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
        /* 상단 색상바 — 보건일지 제목 색상바와 동일 (파랑70%+금30%) */
        R++; { const r = ws.getRow(R); r.height = 6; for (let i = 1; i <= 4; i++) r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= 3 ? 'FF2855A0' : 'FFD4A843' } }; }
        /* 제목 */
        R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 30; const c = r.getCell(1); c.value = '상 담 기 록 지'; c.font = { bold: true, size: 18, name: FONT }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } }; }
        /* 하단 색상바 — 보건일지 제목 색상바와 동일 (초록30%+빨강70%) */
        R++; { const r = ws.getRow(R); r.height = 6; for (let i = 1; i <= 4; i++) r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= 1 ? 'FF2E8B57' : 'FFC0392B' } }; }
        R++; ws.getRow(R).height = 6; /* 여백 */
        /* 정보표 (비병합 4칸 — 각 칸 테두리) */
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '이름'); value(r.getCell(2), d.name); label(r.getCell(3), '성별'); value(r.getCell(4), d.gender); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '소속'); value(r.getCell(2), d.soc); label(r.getCell(3), '상담 일시'); value(r.getCell(4), d.datetime); }
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '상담 주제'); value(r.getCell(2), d.topics); label(r.getCell(3), '회차'); value(r.getCell(4), d.round); }
        /* 의뢰 경로 — A 라벨 + B:D 병합 값(테두리는 마스터 B 에만) */
        R++; { const r = ws.getRow(R); r.height = 20; label(r.getCell(1), '의뢰 경로'); ws.mergeCells(R, 2, R, 4); value(r.getCell(2), d.route); }
        /* 섹션(제목 병합 + 본문 병합) — 테두리는 각 병합의 마스터 셀에만 */
        const section = (title, body) => {
          R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 20; const c = r.getCell(1); c.value = title; c.font = { bold: true, size: 11, name: FONT }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; setB(c); }
          R++; { ws.mergeCells(R, 1, R, 4); const r = ws.getRow(R); r.height = 76; const c = r.getCell(1); c.value = (body == null ? '' : String(body)); c.font = { size: 10, name: FONT }; c.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }; setB(c); }
        };
        section('상담 내용 (주호소)', d.content);
        section('조치 및 지도 내용', d.action);
        section('후속 조치 계획', d.plan);
        section('상담자 의견', d.opinion);
        /* 추후 계획 · 작성 정보 */
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
  });

  /* ── 연수 이수 현황 Excel (2026-08-25) — A4 미리보기와 동일 구성.
   * 3중 헤더(연수명 colspan2 병합 · 이수율 · 연수기관/이수번호) 때문에 xlsx-build-diary 단일 헤더로는
   * 표현 불가 → 전용 빌더. payload: { titleText, noteText,
   *   items:[{name,isLegal,pctText,pctColor}], staffRows:[[순,직위,이름,기관1,번호1,...]] } */
  ipcMain.handle('xlsx-build-training-status', async (_, payload) => {
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
        /* horizontalCentered — 표를 인쇄 페이지 가로 중앙에 배치해 좌우 여백 균등 (사용자 요청 2026-08-25) */
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          horizontalCentered: true,
          margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
      });
      /* 열 너비 자동 배분 (사용자 요청 2026-08-25) — A4 가로 인쇄폭(≈277mm ≈ 150문자폭)을
       * 고정 3열(순·직위·이름) 제외한 나머지에 연수 개수만큼 균등 분배.
       * 연수 2개→기관/번호 각 30, 3개→20, 4개→15 … (min 10) — 표가 항상 페이지 폭을 채움. */
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
  });

  /* xlsx 파일에 freeze pane + 스타일(색상바·제목 굵게·외곽 굵은선) 일괄 주입
     SheetJS Community 가 작성 못 하는 시각 양식을 후처리로 직접 styles.xml/sheet1.xml 에 추가 */
  ipcMain.handle('xlsx-inject-style', async (_, { bytes, options }) => {
    try {
      const fflate = require('fflate');
      const opts = options || {};
      const ySplit = parseInt(opts.ySplit, 10) || 8;
      const colCount = parseInt(opts.colCount, 10) || 8;
      const top1 = parseInt(opts.top1, 10) || Math.round(colCount * 0.7);
      const bot1 = parseInt(opts.bot1, 10) || (colCount - top1);
      const titleRow = 2; /* 1-indexed */
      const colorBar1Row = 1;
      const colorBar2Row = 3;
      const schoolRow = 5;
      const periodRow = 6;
      const headerRow = ySplit; /* 컬럼 헤더 = freeze 마지막 행 */
      const dataStartRow = ySplit + 1;

      const inBuf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const unzipped = fflate.unzipSync(new Uint8Array(inBuf));

      /* ───── styles.xml: fills/fonts/borders/cellXfs 추가 ───── */
      const stylesPath = 'xl/styles.xml';
      let stylesXml = unzipped[stylesPath] ? new TextDecoder().decode(unzipped[stylesPath]) : '';
      /* 기존 XML 파싱 대신, 정의된 스타일을 추가하기 위해 마지막 cellXfs 직전에 끼워넣음
         또는 styles.xml 을 통째로 새로 생성 (안전) */
      const newStyles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="3">'
        +   '<font><sz val="11"/><color theme="1"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>' /* 0 기본 */
        +   '<font><sz val="16"/><b val="1"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>' /* 1 제목 */
        +   '<font><sz val="11"/><b val="1"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>' /* 2 헤더 굵게 */
        + '</fonts>'
        + '<fills count="9">'
        +   '<fill><patternFill patternType="none"/></fill>' /* 0 */
        +   '<fill><patternFill patternType="gray125"/></fill>' /* 1 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FF2855A0"/><bgColor indexed="64"/></patternFill></fill>' /* 2 파랑 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFD4A843"/><bgColor indexed="64"/></patternFill></fill>' /* 3 노랑 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FF2E8B57"/><bgColor indexed="64"/></patternFill></fill>' /* 4 초록 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFC0392B"/><bgColor indexed="64"/></patternFill></fill>' /* 5 빨강 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F7F7"/><bgColor indexed="64"/></patternFill></fill>' /* 6 제목 배경 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFEAEAEA"/><bgColor indexed="64"/></patternFill></fill>' /* 7 헤더 배경 */
        +   '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>' /* 8 흰색 */
        + '</fills>'
        + '<borders count="6">'
        +   '<border><left/><right/><top/><bottom/><diagonal/></border>' /* 0 없음 */
        +   '<border><left style="thin"><color rgb="FF555555"/></left><right style="thin"><color rgb="FF555555"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>' /* 1 일반 셀 (4면 thin) */
        +   '<border><left style="medium"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF555555"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>' /* 2 좌측 굵음 */
        +   '<border><left style="thin"><color rgb="FF555555"/></left><right style="medium"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>' /* 3 우측 굵음 */
        +   '<border><left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom></border>' /* 4 좌우 굵음 (단일 칼럼) */
        +   '<border><left style="thin"><color rgb="FF555555"/></left><right style="thin"><color rgb="FF555555"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom></border>' /* 5 위아래 굵음 (헤더용) */
        + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="13">'
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' /* 0 기본 */
        +   '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>' /* 1 파랑 바 */
        +   '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' /* 2 노랑 바 */
        +   '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' /* 3 초록 바 */
        +   '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>' /* 4 빨강 바 */
        +   '<xf numFmtId="0" fontId="1" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' /* 5 제목 (굵게+크게+가운데) */
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' /* 6 학교/기간 */
        +   '<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' /* 7 컬럼 헤더 */
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' /* 8 데이터 일반 */
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' /* 9 데이터 좌측 굵음 */
        +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' /* 10 데이터 우측 굵음 */
        +   '<xf numFmtId="0" fontId="2" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' /* 11 헤더 좌측 굵음 */
        +   '<xf numFmtId="0" fontId="2" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' /* 12 헤더 우측 굵음 */
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="0"/>'
        + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
        + '</styleSheet>';
      unzipped[stylesPath] = new TextEncoder().encode(newStyles);

      /* ───── sheet1.xml 수정: 셀 s 속성 + 행 높이 + sheetViews ───── */
      const sheetPath = 'xl/worksheets/sheet1.xml';
      if (!unzipped[sheetPath]) return { success: false, error: 'sheet1.xml not found' };
      let sheetXml = new TextDecoder().decode(unzipped[sheetPath]);

      /* 셀 reference (예: A1, B2) 매칭 후 s="N" 추가 */
      function setCellStyle(rowNum, colIdx0, styleId) {
        const colLetter = numToCol(colIdx0 + 1);
        const ref = colLetter + rowNum;
        const re = new RegExp('<c r="' + ref + '"([^/>]*)(/?)>', 'g');
        sheetXml = sheetXml.replace(re, function(m, attrs, slash) {
          /* 기존 s 제거 */
          attrs = attrs.replace(/\s*s="\d+"/g, '');
          return '<c r="' + ref + '" s="' + styleId + '"' + attrs + slash + '>';
        });
      }
      function numToCol(n){let s='';while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}

      /* 1행 색상바 */
      for (let i = 0; i < top1; i++) setCellStyle(colorBar1Row, i, 1);
      for (let i = top1; i < colCount; i++) setCellStyle(colorBar1Row, i, 2);
      /* 3행 색상바 */
      for (let i = 0; i < bot1; i++) setCellStyle(colorBar2Row, i, 3);
      for (let i = bot1; i < colCount; i++) setCellStyle(colorBar2Row, i, 4);
      /* 2행 제목 */
      for (let i = 0; i < colCount; i++) setCellStyle(titleRow, i, 5);
      /* 5,6행 학교/기간 */
      for (let i = 0; i < colCount; i++) { setCellStyle(schoolRow, i, 6); setCellStyle(periodRow, i, 6); }
      /* 헤더 행 */
      for (let i = 0; i < colCount; i++) {
        const sid = (i === 0) ? 11 : (i === colCount - 1 ? 12 : 7);
        setCellStyle(headerRow, i, sid);
      }
      /* 데이터 행 — 행 인덱스를 sheetXml 에서 찾아서 적용
         데이터 마지막 행을 모를 수 있으니 sheetData 내 모든 row 중 dataStartRow 이상 처리 */
      const rowMatches = [...sheetXml.matchAll(/<row r="(\d+)"/g)];
      rowMatches.forEach(function(rm){
        const rNum = parseInt(rm[1], 10);
        if (rNum < dataStartRow) return;
        for (let i = 0; i < colCount; i++) {
          const sid = (i === 0) ? 9 : (i === colCount - 1 ? 10 : 8);
          setCellStyle(rNum, i, sid);
        }
      });

      /* row heights — <row r="N" ht="X" customHeight="1"> */
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

      /* sheetViews (freeze pane) */
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
  });

  /* xlsx 파일에 freeze pane(시트뷰) 주입 — SheetJS Community 가 못 쓰는 부분을 보정
     입력: ArrayBuffer/Uint8Array. 출력: 수정된 ArrayBuffer */
  ipcMain.handle('xlsx-inject-freeze', async (_, { bytes, ySplit }) => {
    try {
      const fflate = require('fflate');
      const inBuf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const unzipped = fflate.unzipSync(new Uint8Array(inBuf));
      const sheetPath = 'xl/worksheets/sheet1.xml';
      if (!unzipped[sheetPath]) return { success: false, error: 'sheet1.xml not found' };
      let xml = new TextDecoder().decode(unzipped[sheetPath]);
      const yS = parseInt(ySplit, 10) || 8;
      const topLeft = 'A' + (yS + 1);
      const sheetViewsXml = '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="' + yS + '" topLeftCell="' + topLeft + '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="' + topLeft + '" sqref="' + topLeft + '"/></sheetView></sheetViews>';
      if (xml.indexOf('<sheetViews') !== -1) {
        xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, sheetViewsXml);
      } else {
        /* dimension 다음에 삽입 */
        if (xml.indexOf('<dimension') !== -1) {
          xml = xml.replace(/(<dimension[^/]*\/>)/, '$1' + sheetViewsXml);
        } else {
          xml = xml.replace(/<worksheet([^>]*)>/, '<worksheet$1>' + sheetViewsXml);
        }
      }
      unzipped[sheetPath] = new TextEncoder().encode(xml);
      const repacked = fflate.zipSync(unzipped, { level: 6 });
      return { success: true, bytes: Array.from(repacked) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('import-past-history-xlsx-buffer', (_, { bytes, filename }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const safeName = (filename || 'past_health_records.xlsx').replace(/[\/\\:*?"<>|]/g, '_');
      const tmpPath = path.join(os.tmpdir(), 'mhd_' + Date.now() + '_' + safeName);
      const buf = Buffer.from(bytes);
      fs.writeFileSync(tmpPath, buf);
      return { success: true, filePath: tmpPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-search', (_, { params }) => {
    try {
      const results = services.pastHistory().search(params);
      return { success: true, data: results };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-stats', () => {
    try {
      return { success: true, data: services.pastHistory().getStats() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-exists', () => {
    try {
      return { success: true, data: services.pastHistory().exists() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-auto-match', (_, { currentYear, schoolLevel } = {}) => {
    try {
      const yr = String(currentYear || require('./src/main/services/database').HealthDiaryDB.academicYear()); /* 명단=학년도(3/1) */
      const sl = schoolLevel || 'elementary';
      const students = services.peopleDB().getAll(yr) || [];
      let staff = [];
      try { staff = services.staffDB().getAll(yr) || []; } catch (_) {}
      const people = students.concat(staff);
      const result = services.pastHistory().autoMatch(people, yr, sl);
      return { success: true, data: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-resolve-ambiguous', (_, { recordIds, studentId }) => {
    try {
      const result = services.pastHistory().resolveAmbiguous(recordIds, studentId);
      return { success: true, data: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-get-ambiguous', () => {
    try {
      return { success: true, data: services.pastHistory().getAmbiguous() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 미매칭 수동 매칭 — 자동 매칭 실패 행을 사용자가 학생 선택하여 연결 */
  ipcMain.handle('past-history-get-unmatched', () => {
    try {
      return { success: true, data: services.pastHistory().getUnmatched() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-resolve-unmatched', (_, { recordIds, studentId }) => {
    try {
      services.pastHistory().resolveUnmatched(recordIds, studentId);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-apply', () => {
    try {
      const result = services.pastHistory().applyToDaily();
      return { success: true, data: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 기존 placeholder(NULL person_uid + extra_json.unmatched_identity) 일괄 ghost 등록 IPC.
   *  app 시작 시 자동 1회 호출되어 옛 데이터도 정리됨. */
  ipcMain.handle('past-history-migrate-placeholders', () => {
    try {
      const result = services.pastHistory().migratePlaceholdersToGhosts();
      return { success: true, data: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-delete-imported', () => {
    try {
      const result = services.pastHistory().deleteImported();
      return { success: true, data: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 업로드 매칭 결과(staging) 전체 비우기 — "↶ 삽입 취소" 의 staging-clear 분기에서 사용. */
  ipcMain.handle('past-history-clear-staging', () => {
    try {
      return { success: true, data: services.pastHistory().clearStaging() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 방금 applyToDaily 가 삽입한 daily_records ID 만 정확히 되돌림 — "↶ N건 삽입 되돌리기" 동작. */
  ipcMain.handle('past-history-revert-just-inserted', (_, { ids } = {}) => {
    try {
      return { success: true, data: services.pastHistory().revertJustInserted(ids || []) };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 명단 미등록(placeholder) 상태로 들어온 가져오기 행 목록 — 사후 매칭 UI 용. */
  ipcMain.handle('past-history-list-placeholders', () => {
    try {
      return { success: true, data: services.pastHistory().listPlaceholderImports() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* placeholder 행을 특정 학생/교직원 uid 에 연결 — placeholder 카드의 [🔗 매칭] 버튼. */
  ipcMain.handle('past-history-match-placeholder', (_, { recordId, personUid } = {}) => {
    try {
      return { success: true, data: services.pastHistory().matchPlaceholderToPerson(recordId, personUid) };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* placeholder 행을 영구 삭제 — placeholder 카드의 [🗑 삭제] 버튼. */
  ipcMain.handle('past-history-delete-placeholder', (_, { recordId } = {}) => {
    try {
      return { success: true, data: services.pastHistory().deletePlaceholderImport(recordId) };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* staging 행 삭제 (같은 인원의 여러 방문 기록 일괄) — 매칭 처리 내역 [🗑 삭제] 버튼. */
  ipcMain.handle('past-history-delete-staging-row', (_, { stagingId } = {}) => {
    try {
      return { success: true, data: services.pastHistory().deleteStagingRow(stagingId) };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* 매칭(matched) → 미매칭(unmatched) 일괄 되돌리기 — 삽입 취소 버튼. */
  ipcMain.handle('past-history-revert-matched', () => {
    try {
      return { success: true, data: services.pastHistory().revertMatchedToUnmatched() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* placeholder 를 "전학·자퇴·전근으로 학교에 없는 사람" 으로 신규 등록 + person_uid 연결.
   *  placeholder 카드의 [🚌 전학·자퇴·전근] 보조 버튼. */
  ipcMain.handle('past-history-placeholder-as-leaver', (_, { recordId } = {}) => {
    try {
      return services.pastHistory().placeholderAsLeaver(recordId);
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* staging 행을 "전학·자퇴·전근" 으로 신규 등록 + 같은 사람의 다른 staging 행도 일괄 matched.
   *  수동 매칭 모달(.am-modal) 의 [🚌 전학·자퇴·전근] 칩. */
  ipcMain.handle('past-history-staging-row-as-leaver', (_, { stagingId } = {}) => {
    try {
      return services.pastHistory().stagingRowAsLeaver(stagingId);
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-imported-count', () => {
    try {
      return { success: true, data: services.pastHistory().getImportedCountThisYear() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-match-stats', () => {
    try {
      return { success: true, data: services.pastHistory().getMatchStats() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('past-history-get-by-date', (_, { date }) => {
    try {
      return { success: true, data: services.pastHistory().getByDate(date) };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  잠복결핵 영구 누적 IPC (TbTestService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('tb-test-add', (_, data) => {
    try { return { success: true, data: services.tbTest().addOne(data) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('tb-test-import-xlsx', (_, { filePath }) => {
    try { return { success: true, data: services.tbTest().importFromXlsx(filePath) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('tb-test-search', (_, params) => {
    try { return { success: true, data: services.tbTest().search(params) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('tb-test-get-all', () => {
    try { return { success: true, data: services.tbTest().getAll() }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('tb-test-stats', () => {
    try { return { success: true, data: services.tbTest().getStats() }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('tb-test-delete', (_, id) => {
    try { services.tbTest().deleteOne(id); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('tb-test-update', (_, { id, data }) => {
    try { return { success: true, data: services.tbTest().updateOne(id, data) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  앱 설정 IPC (AppConfigService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('app-config-is-first-run', () => {
    return { success: true, isFirstRun: services.appConfig().isFirstRun() };
  });

  ipcMain.handle('app-config-setup', (event, opts) => {
    try { return services.appConfig().setupInitial(opts); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('app-config-get-school', () => {
    try { return { success: true, data: services.appConfig().getSchoolInfo() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('app-config-update-school', (event, { school, teacher }) => {
    try { return services.appConfig().updateSchoolInfo(school, teacher); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('app-config-get-all', () => {
    try { return { success: true, data: services.appConfig().getAll() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* app-config-check-school-type, app-config-set-data-school-type 제거됨 (v8: school_level 단순화) */

  /* ══════════════════════════════════════════════════════════
   *  폴더 경로 IPC (FolderService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('folders-get-paths', () => {
    try {
      const f = services.folders();
      return {
        success: true,
        data: f.data(),
        templates: f.templates(),
        surveyForms: f.surveyForms(),
        surveys: f.surveys(),
        exports: f.exports(),
        backups: f.backups(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ══════════════════════════════════════════════════════════
   *  학생/교직원 IPC — 새 정규화 DB (HealthDiaryDB)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('students-get-all', (event, { year } = {}) => {
    try { return { success: true, data: services.studentsDB().getAll(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-get-all-include-left', (event, { year } = {}) => {
    try { return { success: true, data: services.studentsDB().getAllIncludeLeft(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-find-name-duplicates', (event, { year } = {}) => {
    try { return { success: true, data: services.studentsDB().findNameDuplicates(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 학년도·재학 상태 무관 — S.leavers 적재용. 보건일지 person_uid 해석 시 [삭제된 인원] 표시 위해 필요. */
  ipcMain.handle('students-get-all-historical', () => {
    try { return { success: true, data: services.studentsDB().getAllHistorical() }; }
    catch (err) { return { success: false, error: err.message }; }
  });


  ipcMain.handle('students-save-all', (event, { students: stuArr, year }) => {
    try {
      return services.studentsDB().saveAll(year, stuArr);
    }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-upsert', (event, { student, year }) => {
    try { return services.studentsDB().upsert(year, student); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-delete', (event, { uid }) => {
    try { return services.studentsDB().delete(uid); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 이번 학년도 학생 전체 명단 일괄 삭제 (soft-delete) — 2026-06-12 */
  ipcMain.handle('students-delete-all-year', (event, { year }) => {
    try { return services.studentsDB().deleteAllForYear(year); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-set-enrolled', (event, { uid, year, enrolled }) => {
    try { return services.studentsDB().setEnrolled(uid, year, enrolled); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-grade-summary', (event, { year } = {}) => {
    try { return { success: true, data: services.studentsDB().getGradeSummary(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-class-groups', (event, { year, grades } = {}) => {
    try { return { success: true, data: services.studentsDB().getClassGroups(year, grades) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-import-batch', (event, { students: stuArr, year }) => {
    try { return services.studentsDB().saveAll(year, stuArr); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ─── 일괄 등록 + 동명이인 보류 + JSON 저장 ───
     일괄 업로드 시 동명이인 자동 매칭 안 되는 학생만 보류 → JSON 파일로 영구 저장.
     사용자가 모달에서 결정하면 resolve 로 등록 확정 + JSON 갱신.
     학년도 다른 옛 JSON 은 자동 삭제 (3/1 기준). */
  function _pendingAmbPath(year) {
    const yr = year || require('./src/main/services/database').HealthDiaryDB.academicYear();
    const dir = services.folders().data();
    return path.join(dir, 'pending_ambiguous_' + yr + '.json');
  }
  function _cleanupOldPendingAmb(currentYr) {
    try {
      const dir = services.folders().data();
      const files = fs.readdirSync(dir);
      files.forEach(f => {
        const m = f.match(/^pending_ambiguous_(\d{4})\.json(?:\.bak|\.tmp)?$/);
        if (m && m[1] !== String(currentYr)) {
          try { fs.unlinkSync(path.join(dir, f)); } catch(_){}
        }
      });
    } catch(e) { /* 디렉토리 없으면 무시 */ }
  }

  ipcMain.handle('students-import-with-pending', (event, { students: stuArr, year }) => {
    try {
      const result = services.studentsDB().saveAllWithAmbiguousDetection(year, stuArr);
      const yr = result.year;
      _cleanupOldPendingAmb(yr);
      const filePath = _pendingAmbPath(yr);
      if (result.ambiguousCount > 0) {
        services.folders().saveFile && false; /* placeholder */
        const payload = {
          year: yr,
          createdAt: new Date().toISOString(),
          items: result.ambiguous,
        };
        try {
          /* atomic write 인라인 — fileService 의 atomicWrite 와 동일 패턴 */
          const tmp = filePath + '.tmp';
          const json = JSON.stringify(payload, null, 2);
          fs.writeFileSync(tmp, json, 'utf8');
          if (fs.existsSync(filePath)) {
            try { fs.copyFileSync(filePath, filePath + '.bak'); } catch(_){}
          }
          fs.renameSync(tmp, filePath);
        } catch (e) {
          console.error('[pending-amb] JSON 저장 실패:', e.message);
        }
      } else {
        /* 보류 항목 0건이면 옛 JSON 도 정리 */
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(_){}
      }
      return result;
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-pending-ambiguous-list', (event, { year } = {}) => {
    try {
      const yr = year || require('./src/main/services/database').HealthDiaryDB.academicYear();
      _cleanupOldPendingAmb(yr);
      const filePath = _pendingAmbPath(yr);
      if (!fs.existsSync(filePath)) return { success: true, year: yr, items: [], count: 0 };
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      return { success: true, year: yr, items: data.items || [], count: (data.items || []).length };
    } catch (err) { return { success: false, error: err.message, items: [], count: 0 }; }
  });

  ipcMain.handle('students-pending-ambiguous-count', (event, { year } = {}) => {
    try {
      const yr = year || require('./src/main/services/database').HealthDiaryDB.academicYear();
      _cleanupOldPendingAmb(yr);
      const filePath = _pendingAmbPath(yr);
      if (!fs.existsSync(filePath)) return { success: true, year: yr, count: 0 };
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      return { success: true, year: yr, count: (data.items || []).length };
    } catch (err) { return { success: false, error: err.message, count: 0 }; }
  });

  ipcMain.handle('students-pending-ambiguous-resolve', (event, { year, excelRow, chosenUid }) => {
    try {
      const yr = year || require('./src/main/services/database').HealthDiaryDB.academicYear();
      const filePath = _pendingAmbPath(yr);
      if (!fs.existsSync(filePath)) return { success: false, error: '보류 파일이 없습니다.' };
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const items = data.items || [];
      const idx = items.findIndex(it => it.excelRow === excelRow);
      if (idx === -1) return { success: false, error: '해당 항목을 찾을 수 없습니다.' };
      const item = items[idx];
      const upRes = services.studentsDB().resolveAmbiguousImport(yr, item, chosenUid);
      if (!upRes || !upRes.success) return { success: false, error: (upRes && upRes.error) || '등록 실패' };
      items.splice(idx, 1);
      if (items.length === 0) {
        try { fs.unlinkSync(filePath); } catch(_){}
        try { fs.unlinkSync(filePath + '.bak'); } catch(_){}
      } else {
        const tmp = filePath + '.tmp';
        const json = JSON.stringify({ year: yr, createdAt: data.createdAt, items: items }, null, 2);
        fs.writeFileSync(tmp, json, 'utf8');
        try { fs.copyFileSync(filePath, filePath + '.bak'); } catch(_){}
        fs.renameSync(tmp, filePath);
      }
      return { success: true, remaining: items.length };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-get-care', (event, { year } = {}) => {
    try { return { success: true, data: services.studentsDB().getCare(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-get-history', (event, { uid }) => {
    try { return { success: true, data: services.studentsDB().getHistory(uid) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-update-memo', (event, { uid, memoJson }) => {
    try { return services.studentsDB().updateMemo(uid, memoJson); }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('students-update-med-consent', (event, { uid, consent }) => {
    try { return services.studentsDB().updateMedConsent(uid, consent); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('students-dedup', (event, { year } = {}) => {
    try { return services.studentsDB().deduplicateStudents(year); }
    catch (err) { return { success: false, error: err.message }; }
  });

  // ── 교직원 ──
  ipcMain.handle('staff-get-all', (event, { year } = {}) => {
    try { return { success: true, data: services.staffDB().getAll(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('staff-get-all-include-inactive', (event, { year } = {}) => {
    try { return { success: true, data: services.staffDB().getAllIncludeInactive(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('staff-find-name-duplicates', (event, { year } = {}) => {
    try { return { success: true, data: services.staffDB().findNameDuplicates(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 학년도·재직 상태 무관 — S.leavers 적재용. 보건일지 person_uid 해석 시 [삭제된 인원] 표시 위해 필요. */
  ipcMain.handle('staff-get-all-historical', () => {
    try { return { success: true, data: services.staffDB().getAllHistorical() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('staff-upsert', (event, { staff, year }) => {
    try { return services.staffDB().upsert(year, staff); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('staff-save-all', (event, { staffList, year }) => {
    try { return services.staffDB().saveAll(year, staffList); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('staff-delete', (event, { uid }) => {
    try { return services.staffDB().delete(uid); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 이번 학년도 교직원 전체 명단 일괄 삭제 (soft-delete) — 2026-06-12 */
  ipcMain.handle('staff-delete-all-year', (event, { year }) => {
    try { return services.staffDB().deleteAllForYear(year); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('staff-deactivate', (event, { uid }) => {
    try { return services.staffDB().deactivate(uid); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 보존 기간 만료 정리 — 참조 0건 + DB 등록 5년 이상 경과 학생/교직원 ── */
  ipcMain.handle('retention-find-orphan-students', (event, payload) => {
    try { return { success: true, data: services.studentsDB().findOrphanStudents((payload && payload.cutoffYears) || 5) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('retention-bulk-delete-orphan-students', (event, { uids }) => {
    try { return services.studentsDB().bulkDeleteOrphanStudents(uids); }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('retention-find-orphan-staff', (event, payload) => {
    try { return { success: true, data: services.staffDB().findOrphanStaff((payload && payload.cutoffYears) || 5) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('retention-bulk-delete-orphan-staff', (event, { uids }) => {
    try { return services.staffDB().bulkDeleteOrphanStaff(uids); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  보건일지 레코드 IPC (HealthRecordService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('records-get-daily', (event, { year }) => {
    try { return { success: true, data: services.recordsDB().getDailyByYear(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-get-daily-by-date', (event, { year, date }) => {
    try { return { success: true, data: services.recordsDB().getDailyByDate(year, date) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-get-daily-by-person', (event, { personUid }) => {
    try { return { success: true, data: services.recordsDB().getDailyByPerson(personUid) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-daily-insert', (event, { record }) => {
    try { return services.recordsDB().insertDaily(record); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-daily-update', (event, { record }) => {
    try { return services.recordsDB().updateDaily(record); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-daily-delete', (event, { id }) => {
    try { return services.recordsDB().deleteDaily(id); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-daily-fix-nurse', (event, { oldName, newName }) => {
    try { return services.recordsDB().fixNurseName(oldName, newName); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-daily-delete-year', (event, { year }) => {
    try { return services.recordsDB().deleteDailyByYear(year); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-daily-years', () => {
    try {
      const { years, counts } = services.recordsDB().getDailyYears();
      return { success: true, years, counts };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-year-summary', () => {
    try { return { success: true, summary: services.recordsDB().getYearSummary() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-save-daily', (event, { year, records }) => {
    try { return services.records().saveDailyRecords(year, records); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-get-emergency', (event, { year }) => {
    try {
      const data = services.recordsDB().getEmergencyByYear(year);
      const nextId = data.length ? Math.max(...data.map(r => r.id)) + 1 : 1;
      return { success: true, data, nextId };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-emergency-insert', (event, { record }) => {
    try { return services.recordsDB().insertEmergency(record); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-emergency-update', (event, { record }) => {
    try { return services.recordsDB().updateEmergency(record); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-emergency-delete', (event, { id }) => {
    try { return services.recordsDB().deleteEmergency(id); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* blob store 일괄 저장 */
  ipcMain.handle('records-save-emergency', (event, { year, records }) => {
    try { return services.records().saveEmergencyRecords(year, records); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-get-infection', (event, { year }) => {
    try {
      const data = services.recordsDB().getInfectionByYear(year);
      const nextId = data.length ? Math.max(...data.map(r => r.id)) + 1 : 1;
      return { success: true, data, nextId };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-infection-insert', (event, { record }) => {
    try { return services.recordsDB().insertInfection(record); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-infection-update', (event, { record }) => {
    try { return services.recordsDB().updateInfection(record); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-infection-delete', (event, { id }) => {
    try { return services.recordsDB().deleteInfection(id); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* blob store 일괄 저장 */
  ipcMain.handle('records-save-infection', (event, { year, records }) => {
    try { return services.records().saveInfectionRecords(year, records); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 보존기간 기반 일괄 삭제 (백엔드 트랜잭션) ── */
  ipcMain.handle('records-count-before-date', (event, { cutoffDate }) => {
    try { return { success: true, data: services.recordsDB().countBeforeDate(cutoffDate) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-delete-before-date', (event, { cutoffDate }) => {
    try { return services.recordsDB().deleteBeforeDate(cutoffDate); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-count-by-year', (event, { year }) => {
    try { return { success: true, data: services.recordsDB().countByYear(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-delete-by-year', (event, { year }) => {
    try { return services.recordsDB().deleteByYear(year); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ── 인쇄용 날짜 범위 조회 + 간호사 집계 ── */
  ipcMain.handle('records-daily-by-date-range', (event, { from, to }) => {
    try { return { success: true, data: services.recordsDB().getDailyByDateRange(from, to) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-nurse-stats', (event, { from, to }) => {
    try { return { success: true, data: services.recordsDB().getNurseStatsByDateRange(from, to) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-get-infection-notes', (event, { year }) => {
    try { return { success: true, data: services.records().getInfectionNotes(year) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('records-save-infection-notes', (event, { year, notes }) => {
    try { return services.records().saveInfectionNotes(year, notes); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 종료 시 일괄 저장 */
  ipcMain.handle('records-flush-all', (event, { year, payload }) => {
    try { return services.records().saveAllCollections(year, payload); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  설정 IPC (SettingsService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('settings-get', (event, { key, defaultValue }) => {
    try { return { success: true, value: services.settings().get(key, defaultValue) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('settings-set', (event, { key, value }) => {
    try { return services.settings().set(key, value); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('settings-get-multiple', (event, { keys }) => {
    try { return { success: true, values: services.settings().getMultiple(keys) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('settings-set-multiple', (event, { entries }) => {
    try { return services.settings().setMultiple(entries); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  의료 데이터 IPC (MedicalDataService)
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('medical-get-dept-mapping', () => {
    try { return { success: true, text: services.medical().getDeptMappingText() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-dept-mapping', (event, { text }) => {
    try { return services.medical().setDeptMappingText(text); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-dept-for-symptom', (event, { symptom }) => {
    try { return { success: true, dept: services.medical().getDeptForSymptom(symptom) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-dept-for-symptoms', (event, { symptoms }) => {
    try { return { success: true, dept: services.medical().getDeptForSymptoms(symptoms) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-treatment-map', () => {
    try { return { success: true, data: services.medical().getTreatmentMap() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-treatment-map', (event, { map }) => {
    try { return services.medical().setTreatmentMap(map); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-medication-map', () => {
    try { return { success: true, data: services.medical().getMedicationMap() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-medication-map', (event, { map }) => {
    try { return services.medical().setMedicationMap(map); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-sym-meds', () => {
    try { return { success: true, data: services.medical().getSymMeds() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-sym-meds', (event, { data }) => {
    try { return services.medical().setSymMeds(data); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-sym-ointments', () => {
    try { return { success: true, data: services.medical().getSymOintments() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-sym-ointments', (event, { data }) => {
    try { return services.medical().setSymOintments(data); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-sym-patches', () => {
    try { return { success: true, data: services.medical().getSymPatches() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-sym-patches', (event, { data }) => {
    try { return services.medical().setSymPatches(data); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-get-vital-thresholds', () => {
    try { return { success: true, data: services.medical().getVitalThresholds() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-set-vital-thresholds', (event, { thresholds }) => {
    try { return services.medical().setVitalThresholds(thresholds); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('medical-compute-bmi', (event, { entries }) => {
    try {
      const { MedicalDataService } = require('./src/main/services/app-data-service');
      return { success: true, data: MedicalDataService.computeBmi(entries) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  통계 IPC (StatisticsService) — 집계 로직 백엔드 전용
   * ══════════════════════════════════════════════════════════ */

  ipcMain.handle('stats-get-summary', (event, opts) => {
    try { return { success: true, data: services.statsDB().getSummary(opts || {}) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-get-dept', (event, opts) => {
    try {
      const result = services.statsDB().getDeptGradeStats(opts || {});
      const deptArray = Object.entries(result.deptCounts)
        .map(([dept, v]) => ({ dept, count: v.total }))
        .sort((a, b) => b.count - a.count);
      return { success: true, data: deptArray };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-get-symptoms', (event, opts) => {
    try {
      const result = services.statsDB().getSummary(opts || {});
      return { success: true, data: result.topSymptoms };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-get-hourly', (event, opts) => {
    try {
      const result = services.statsDB().getSummary(opts || {});
      return { success: true, data: result.hourly };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-get-daily-counts', (event, opts) => {
    try {
      const result = services.statsDB().getSummary(opts || {});
      return { success: true, data: result.daily };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  설문 시스템 IPC (새 DB + JSON 파일)
   * ══════════════════════════════════════════════════════════ */

  /** 설문 양식 목록 조회 */
  ipcMain.handle('survey-form-list', () => {
    try { return { success: true, data: services.surveyForms().list() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 설문 양식 조회 (메타 + JSON 파일 본문) */
  ipcMain.handle('survey-form-get', (event, { formId }) => {
    try {
      const result = services.surveyForms().get(formId);
      if (!result) return { success: false, error: '양식을 찾을 수 없습니다.' };
      return { success: true, meta: result.meta, content: result.content };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /** 설문 양식 저장 (메타 DB + JSON 파일) */
  ipcMain.handle('survey-form-save', (event, { form, content }) => {
    try {
      /* 설문 양식 50건 제한 (신규 생성 시만 체크) */
      const existing = services.surveyForms().getAll();
      const isNew = !existing.find(f => f.id === form.id);
      if (isNew && existing.length >= 50) return { success: false, error: '설문 양식은 최대 50건까지 보관할 수 있습니다. 사용하지 않는 양식을 삭제한 후 다시 시도하세요.' };
      return services.surveyForms().save(form, content);
    }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 설문 양식 복사 (새 id + 버전 1) */
  ipcMain.handle('survey-form-copy', (event, { sourceFormId, newId, newTitle }) => {
    try {
      const existing = services.surveyForms().getAll();
      if (existing.length >= 50) return { success: false, error: '설문 양식은 최대 50건까지 보관할 수 있습니다. 사용하지 않는 양식을 삭제한 후 다시 시도하세요.' };
      const result = services.surveyForms().copy(sourceFormId, newId, newTitle);
      if (!result) return { success: false, error: '원본 양식을 찾을 수 없습니다.' };
      return result;
    } catch (err) { return { success: false, error: err.message }; }
  });

  /** 설문 양식 삭제 */
  ipcMain.handle('survey-form-delete', (event, { formId }) => {
    try { return services.surveyForms().delete(formId); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 설문 응답 저장 (DB에 JSON 텍스트로 직접 저장, 중복 시 덮어쓰기) */
  ipcMain.handle('survey-response-save', (event, { response, content }) => {
    try { return services.surveyResponses().save(response, content); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** JSON 파일에서 응답 일괄 가져오기 (배열 또는 단일 응답 객체) */
  ipcMain.handle('survey-response-import-batch', (event, { year, formId, responses }) => {
    try { return services.surveyResponses().importBatch(year, formId, responses); }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 학생별 설문 응답 이력 조회 (응답 데이터 미포함) */
  ipcMain.handle('survey-response-get-by-student', (event, { persistentId }) => {
    try { return { success: true, data: services.surveyResponses().getByStudent(persistentId) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 특정 설문의 전체 응답 목록 조회 (응답 데이터 미포함 — 목록 표시용) */
  ipcMain.handle('survey-response-get-by-form', (event, { year, formId }) => {
    try { return { success: true, data: services.surveyResponses().getByForm(year, formId) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 특정 설문의 전체 응답 목록 + 응답 데이터 조회 (통계 처리용) */
  ipcMain.handle('survey-response-get-all-with-data', (event, { year, formId }) => {
    try { return { success: true, data: services.surveyResponses().getAllWithData(year, formId) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 단일 응답 데이터 조회 (id로) */
  ipcMain.handle('survey-response-get-data', (event, { id }) => {
    try {
      const row = services.surveyResponses().getData(id);
      if (!row) return { success: false, error: '응답을 찾을 수 없습니다.' };
      return { success: true, data: row };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /** 응답 삭제 */
  ipcMain.handle('survey-response-delete', (event, { id }) => {
    try { return services.surveyResponses().delete(id); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('survey-response-stats', (event, { year, formId }) => {
    try { return { success: true, data: services.surveyResponses().getResponseStats(year, formId) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('survey-response-missing-message', (event, { year, formId, grade, cls, position, name }) => {
    try { return { success: true, data: services.surveyResponses().getMissingStudentsMessage(year, formId, grade, cls, position, name) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('survey-response-old-count', (event, { currentSchoolYear }) => {
    try {
      const count = healthDB.db.prepare(
        'SELECT COUNT(*) as cnt FROM survey_responses WHERE school_year < ?'
      ).get(currentSchoolYear);
      return { success: true, count: count.cnt };
    } catch (e) { return { success: false, count: 0 }; }
  });

  ipcMain.handle('survey-response-delete-old', (event, { currentSchoolYear }) => {
    try {
      const result = healthDB.db.prepare(
        'DELETE FROM survey_responses WHERE school_year < ?'
      ).run(currentSchoolYear);
      return { success: true, deleted: result.changes };
    } catch (e) { return { success: false, error: e.message }; }
  });

  /* ══════════════════════════════════════════════════════════
   *  대시보드 통계 IPC (StatisticsDBService — 렌더러 집계 대체)
   *  렌더러는 기간(from, to)만 전달 → 백엔드에서 집계 후 반환
   * ══════════════════════════════════════════════════════════ */

  /** 진료과·학년·성별 집계 통계 (대시보드 핵심) */
  ipcMain.handle('stats-db-dept-grade', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getDeptGradeStats({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 전년 동기 진료과·학년 통계 (YoY 비교용) */
  ipcMain.handle('stats-db-dept-grade-yoy', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getDeptGradeStatsYoY({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 상담 주제(중분류)별·학년별 상담 통계 (보건일지 출력 상담 표지용, 2026-06-25) */
  ipcMain.handle('stats-db-counsel', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getCounselStats({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 기간별 요약 통계 (방문 건수, 시간대, 상위 증상, 일별) */
  ipcMain.handle('stats-db-summary', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getSummary({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /** 진료과 카테고리 매핑 조회 (렌더러 _dashDeptCats14 대체) */
  ipcMain.handle('stats-db-dept-cats', () => {
    try {
      /* 유효 매핑 — 사용자 상분류 편집(이름변경·추가·순서)·사용자 추가 증상 반영 (2026-06-12) */
      return { success: true, data: services.statsDB().getEffectiveDeptCats() };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-treatment', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getTreatmentStats({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* 미분류(기타) 증상 — 대분류 직접 지정 도구 (사용자 요청 2026-06-17) */
  ipcMain.handle('stats-db-uncategorized-symptoms', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getUncategorizedSymptoms({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('stats-db-assign-sym-cat', (event, payload) => {
    try { return services.statsDB().assignSymptomCategory(payload || {}); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-hourly-heatmap', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getHourlyHeatmap({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-class-distribution', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getClassDistribution({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-repeat-visitors', (event, { year, from, to, minVisits }) => {
    try { return { success: true, data: services.statsDB().getRepeatVisitors({ year, from, to, minVisits }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-gender-symptoms', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getGenderSymptomComparison({ year, from, to }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-quick', (event, { year, from, to }) => {
    try { return { success: true, data: services.statsDB().getQuickStats(year, from, to) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-academic-range', (event, { period, year, options }) => {
    try {
      const { StatisticsDBService } = require('./src/main/services/statistics-db-service');
      return { success: true, data: StatisticsDBService.getAcademicDateRange(period, year, options) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-sub-tabs', (event, { period, baseDate }) => {
    try {
      const { StatisticsDBService } = require('./src/main/services/statistics-db-service');
      /* 사용자 지정 학기 정보를 학기 탭 계산 시 적용 */
      const semInfo = services.statsDB()._getSemesterInfo();
      return { success: true, data: StatisticsDBService.getSubTabs(period, baseDate, { semesterInfo: semInfo }) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-holidays', () => {
    try {
      /* 인스턴스 메서드 → 하드코딩 2026 + 캐시된 모든 연도 통합 (KASI 특일정보 API 캐시 포함) */
      return { success: true, data: services.statsDB().getHolidays() };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 특정 연도의 공휴일만 반환 (캐시 우선, 2026 은 하드코딩). 렌더러가 달력 연도 이동 시 lazy fetch. */
  ipcMain.handle('stats-db-holidays-for', (event, year) => {
    try {
      return { success: true, data: services.statsDB().getHolidaysFor(year) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 캐시된 연도 목록 (디버깅·UI 표시용). */
  ipcMain.handle('stats-db-holidays-cached-years', () => {
    try {
      return { success: true, data: services.statsDB().getCachedHolidayYears() };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* KASI 특일정보 API 호출 → 캐시 저장 → 결과 반환.
     · payload: { serviceKey, year }  ※ 저장된 공통 키 우선, 이전 개별 키는 하위 호환
     · 반환: { success, data:{YYYY-MM-DD:name,...}, cached:true } 또는 { success:false, error } */
  ipcMain.handle('stats-db-holidays-fetch', async (event, opts) => {
    try {
      const o = opts || {};
      const key = _getPublicDataApiKey(o.serviceKey, 'holiday_api_key');
      const yr = String(o.year || '').trim();
      if (!key) return { success: false, error: '특일정보 API 키가 없습니다 (설정 > API 관리에서 입력)' };
      if (!/^\d{4}$/.test(yr)) return { success: false, error: '연도 형식 오류 (YYYY)' };
      const res = await services.externalApi().fetchHolidays(key, yr);
      if (!res.success) return res;
      /* 캐시 저장 (빈 객체여도 저장 → 불필요한 재호출 방지) */
      services.statsDB().cacheHolidays(yr, res.data || {});
      return { success: true, data: res.data || {}, year: yr, total: res.total || 0, cached: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  /* 캐시 비우기 — year 지정 시 그 연도만, '*' 이면 전부. */
  ipcMain.handle('stats-db-holidays-clear', (event, year) => {
    try {
      const ok = services.statsDB().clearHolidayCache(year || '*');
      return { success: !!ok };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('stats-db-trend', (event, opts) => {
    try { return { success: true, data: services.statsDB().getTrendData(opts) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /* ════════════════════════════════════════════════════════════
   *  웹 서버 — 사용자 설정에 따라 시작/종료 (IPC 로 제어)
   *  별도 자식 프로세스 (ELECTRON_RUN_AS_NODE) 로 실행 — DB 충돌 방지
   *  ════════════════════════════════════════════════════════════ */
  let _webServerChild = null;
  let _webServerLogStream = null;
  let _webServerStartedEmitted = false; /* 자식 stdout 의 'listening on port' 첫 감지 시 한 번만 이벤트 송신 */
  const _webServerPrefsPath = path.join(app.getPath('userData'), 'web-server-enabled.flag');

  /* 렌더러로 라이프사이클 이벤트 송신 — mainWindow 가 아직 준비 안 됐어도 예외만 삼킴.
   * 렌더러는 부팅 시 webServerStatus() 직접 조회로도 같은 결과 도달하므로 race-safe. */
  function _emitWebServerStarted() {
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('web-server-started');
      }
    } catch (_) {}
  }
  function _emitWebServerStopped() {
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('web-server-stopped');
      }
    } catch (_) {}
  }

  /* 협업 웹서버 자식을 "완전히 죽을 때까지(동기)" 강제 종료한다.
   *  자식(ELECTRON_RUN_AS_NODE)이 electron.exe·app.asar 를 물고 있으면 NSIS 가 파일 교체에 실패해
   *  업데이트 설치가 미적용→재시도→무한루프가 된다. 일반 kill() 은 신호만 보내고 바로 리턴하므로
   *  잠금이 풀리기 전에 설치가 시작될 수 있다. 그래서 설치 직전엔 taskkill /F /T 를 spawnSync 로
   *  "프로세스 트리가 사라질 때까지 블로킹" 한 뒤 진행한다. (자동 업데이트 루프 대응 2026-06-25) */
  function _killWebServerChildSync() {
    const child = _webServerChild;
    _webServerChild = null;
    global._collabWebOn = false;
    if (!child) return;
    const pid = child.pid;
    try {
      if (process.platform === 'win32' && pid) {
        const { spawnSync } = require('child_process');
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 4000 });
      } else {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    } catch (_) {
      try { child.kill(); } catch (__) {}
    }
    try { if (_webServerLogStream) { _webServerLogStream.end(); _webServerLogStream = null; } } catch (_) {}
  }

  function _webServerStart() {
    if (_webServerChild && !_webServerChild.killed) {
      return { success: true, status: 'already-running', pid: _webServerChild.pid };
    }
    try {
      const { fork } = require('child_process');
      const userDataPath = app.getPath('userData');
      const serverScript = path.join(__dirname, 'web-server', 'server.js');
      const logPath = path.join(userDataPath, 'web-server.log');
      _webServerLogStream = fs.createWriteStream(logPath, { flags: 'a' });
      _webServerLogStream.write(`\n===== [WEB] 시작 시각: ${new Date().toISOString()} =====\n`);
      _webServerStartedEmitted = false; /* 새 자식 시작 시 플래그 리셋 */

      _webServerChild = fork(serverScript, [], {
        env: {
          ...process.env,
          USER_DATA_PATH: userDataPath,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_ENV: 'production'
        },
        silent: true
      });
      if (_webServerChild.stdout) _webServerChild.stdout.on('data', d => {
        const s = d.toString();
        if (_webServerLogStream) _webServerLogStream.write('[out] ' + s);
        console.log('[WEB]', s.trim());
        /* 자식이 첫 포트 listen 성공한 시점에 렌더러에 알림 — 폴링 시작 신호.
         * server.js 가 여러 포트에 listen 시 같은 줄이 여러 번 나오므로 _webServerStartedEmitted 로 1회 가드. */
        if (!_webServerStartedEmitted && s.indexOf('listening on port') !== -1) {
          _webServerStartedEmitted = true;
          _emitWebServerStarted();
        }
      });
      if (_webServerChild.stderr) _webServerChild.stderr.on('data', d => {
        const s = d.toString();
        if (_webServerLogStream) _webServerLogStream.write('[err] ' + s);
        console.error('[WEB ERR]', s.trim());
      });
      _webServerChild.on('exit', (code, signal) => {
        if (_webServerLogStream) _webServerLogStream.write(`[exit] code=${code} signal=${signal}\n`);
        console.log(`[WEB] 웹 서버 종료 code=${code} signal=${signal}`);
        _webServerChild = null;
        global._collabWebOn = false;   /* 업데이트 진단용 — 협업 웹서버 상태 */
        /* 자식이 한 번이라도 listen 에 성공해 'started' 를 알린 적이 있다면 'stopped' 도 같이 알림 — 폴링 정지 신호.
         * fork 자체가 실패해 listen 도 못 한 케이스에선 폴링이 시작된 적 없으므로 stopped 도 보낼 필요 없음. */
        if (_webServerStartedEmitted) {
          _webServerStartedEmitted = false;
          _emitWebServerStopped();
        }
      });
      _webServerChild.on('error', (err) => {
        if (_webServerLogStream) _webServerLogStream.write('[fork-error] ' + err.message + '\n');
        console.error('[WEB] fork 실패:', err.message);
      });
      /* 설정 저장 — 다음 실행 시 자동 시작 */
      try { fs.writeFileSync(_webServerPrefsPath, '1'); } catch (_) {}
      console.log('[WEB] 웹 서버 시작됨 (PID=' + (_webServerChild.pid || '?') + ')');
      global._collabWebOn = true;   /* 업데이트 진단용 — 협업 웹서버 상태 */
      return { success: true, status: 'started', pid: _webServerChild.pid };
    } catch (err) {
      console.error('[WEB] 웹 서버 초기화 오류:', err.message);
      return { success: false, error: err.message };
    }
  }

  function _webServerStop() {
    if (!_webServerChild || _webServerChild.killed) {
      /* 자식은 없어도 설정은 꺼줌 */
      try { fs.writeFileSync(_webServerPrefsPath, '0'); } catch (_) {}
      return { success: true, status: 'not-running' };
    }
    try {
      _webServerChild.kill();
      _webServerChild = null;
      global._collabWebOn = false;   /* 업데이트 진단용 — 협업 웹서버 상태 */
      if (_webServerLogStream) { try { _webServerLogStream.end(); } catch (_) {} _webServerLogStream = null; }
      try { fs.writeFileSync(_webServerPrefsPath, '0'); } catch (_) {}
      console.log('[WEB] 웹 서버 중지됨');
      return { success: true, status: 'stopped' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function _webServerStatus() {
    const running = !!(_webServerChild && !_webServerChild.killed);
    return { success: true, running, pid: running ? _webServerChild.pid : null, port: 3000 };
  }

  ipcMain.handle('web-server:start', () => _webServerStart());
  ipcMain.handle('web-server:stop', () => _webServerStop());
  ipcMain.handle('web-server:status', () => _webServerStatus());

  /* 시작 시 자동 구동 — 이전 실행에서 토글을 켠 채로 종료했으면(flag='1') 다음 실행 때 자동으로 다시 켠다.
   * 끈 채로 종료했거나(flag='0') flag 가 없으면(최초 실행) 켜지 않는다. (사용자 요청 2026-05-29) */
  try {
    if (fs.existsSync(_webServerPrefsPath) && fs.readFileSync(_webServerPrefsPath, 'utf8').trim() === '1') {
      console.log('[WEB] 이전 실행에서 웹 서버가 켜져 있었음 → 자동 시작');
      _webServerStart();
    }
  } catch (e) { console.warn('[WEB] 웹 서버 자동 시작 확인 실패:', e.message); }

  app.on('before-quit', () => {
    /* 동기 강제종료 — autoInstallOnAppQuit 로 종료 시 자동 설치가 이어지는데, 그 전에 자식이
     *  파일 잠금을 확실히 놓도록 "죽을 때까지" 기다린다. (자동 업데이트 무한루프 방지 2026-06-25) */
    try { _killWebServerChildSync(); } catch (_) {}
  });

  /* 부팅 시 자동 시작 제거 (2026-05-27)
   *  · 옛 동작: 플래그 파일이 '1' 이면 부팅 시 자동으로 웹서버 자식 spawn → 0.0.0.0 listen
   *    → Windows 방화벽 prompt.
   *  · 사용자 보고: OrangeTalk 명칭 변경 후 OrangeTalk.exe 가 Windows 입장에서 새 앱이라
   *    옛 OrangePharmDiary 때 한 번 허용했던 방화벽 규칙이 안 통하고 다시 prompt.
   *    옛 베타테스터 누구든 협업 한 번이라도 켰던 사용자는 새 OrangeTalk 첫 실행 시
   *    뜬금없는 방화벽 prompt 를 보게 됨 → 컴맹 사용자에게 혼란.
   *  · 변경: 부팅 시 자동 시작 코드 제거. 사용자가 설정 → 협업 메뉴에서 명시적으로
   *    "협업 시작" 누를 때만 웹서버 시작 → 그 시점에 한해 방화벽 prompt 발생
   *    (사용자가 의식적으로 트리거하는 시점). */

}); // end app.whenReady

app.on('window-all-closed', () => {
  /* 종료 직전 pending IPC 처리 여유를 위해 약간의 딜레이 후 quit */
  if (healthDB) {
    try { healthDB.close(); } catch (err) {}
  }
  if (services) {
    try { services.close(); } catch (err) {}
  }
  setTimeout(() => { app.quit(); }, 200);
});
