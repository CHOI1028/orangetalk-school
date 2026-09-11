/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* ═══════════════════════════════════════════════════════════════
 *  Google 기능 일시 비활성화 플래그
 *  — Google OAuth 검증 완료 시(2026년 6월 예정) true 로 변경하여 재활성화
 *  — false 인 동안 Drive·Sheets·Calendar·Google 로그인 IPC 는 차단 응답
 * ═══════════════════════════════════════════════════════════════ */
const GOOGLE_FEATURES_ENABLED = false;
/* Sheets/Drive 계열 — 엑셀 파일을 대안으로 안내 */
const GOOGLE_DOC_KEYS = [
  'googleLogin',
  'sheetsRead','sheetsWrite','sheetsCreate','sheetsExportJob','sheetsBatchUpdate','sheetsMetadata',
  'sheetsLogin','sheetsGetUser','sheetsLogout','sheetsUseMain',
  'driveListFolders','driveCreateFolder','driveMoveFile',
  'driveSyncUpload','driveSyncDownload'
];
/* Calendar 계열 — 대안 없음 */
const GOOGLE_CALENDAR_KEYS = [
  'calendarList','calendarEvents','calendarCreate','calendarUpdate','calendarDelete',
  'calendarAclList','calendarAclInsert','calendarAclUpdate','calendarAclDelete','calendarCreateCalendar',
  'plannerFetchMonthEvents','plannerCreateTodoEvent'
];
const _googleDocDisabledResponse = () => Promise.resolve({
  success: false,
  disabled: true,
  error: 'Google 연동 기능은 현재 Google 보안 검증 중입니다. (예상 활성화: 2026년 5월 내)\n\n대안으로 엑셀 파일을 이용하세요.'
});
const _googleCalendarDisabledResponse = () => Promise.resolve({
  success: false,
  disabled: true,
  error: 'Google 연동 기능은 현재 Google 보안 검증 중입니다. (예상 활성화: 2026년 5월 내)'
});

const _api = {
  /* Electron 32+ 에서 File.path 제거됨 → webUtils.getPathForFile 로 대체 */
  getPathForFile: (file) => {
    try { return webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : (file && file.path) || ''; }
    catch (e) { return ''; }
  },
  googleLogin: () => ipcRenderer.invoke('google-login'),
  authConfigStatus: () => ipcRenderer.invoke('auth-config-status'),
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),
  openMain: () => ipcRenderer.invoke('open-main'),
  logout: () => ipcRenderer.invoke('logout'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  sheetsRead: (spreadsheetId, range) =>
    ipcRenderer.invoke('sheets-read', { spreadsheetId, range }),

  sheetsWrite: (spreadsheetId, range, values) =>
    ipcRenderer.invoke('sheets-write', { spreadsheetId, range, values }),

  sheetsCreate: (title, sheetTitle) =>
    ipcRenderer.invoke('sheets-create', { title, sheetTitle }),
  sheetsExportJob: (job) => ipcRenderer.invoke('sheets-export-job', { job }),
  weatherIpLocation: () => ipcRenderer.invoke('weather-ip-location'),
  weatherReverseGeocode: (lat, lon) => ipcRenderer.invoke('weather-reverse-geocode', { lat, lon }),
  weatherOpenMeteo: (lat, lon) => ipcRenderer.invoke('weather-openmeteo', { lat, lon }),
  weatherKma: (apiKey, lat, lon) => ipcRenderer.invoke('weather-kma', { apiKey, lat, lon }),
  weatherUvKma: (kmaKey, kakaoRestKey, lat, lon) => ipcRenderer.invoke('weather-uv-kma', { kmaKey, kakaoRestKey, lat, lon }),
  externalFetchExchange: () => ipcRenderer.invoke('external-fetch-exchange'),
  externalFetchStock: (ticker) => ipcRenderer.invoke('external-fetch-stock', { ticker }),
  externalFetchAirkorea: (serviceKey, stationName) => ipcRenderer.invoke('external-fetch-airkorea', { serviceKey, stationName }),
  externalFetchAirkoreaStationInfo: (serviceKey, stationName) => ipcRenderer.invoke('external-fetch-airkorea-station-info', { serviceKey, stationName }),
  externalFetchDrugInfo: (serviceKey, drugName) => ipcRenderer.invoke('external-fetch-drug-info', { serviceKey, drugName }),
  externalSearchDrugList: (serviceKey, query) => ipcRenderer.invoke('external-search-drug-list', { serviceKey, query }),
  externalFetchMedFacilities: (serviceKey, params) => ipcRenderer.invoke('external-fetch-med-facilities', { serviceKey, params }),
  externalFetchEmergency: (serviceKey, params) => ipcRenderer.invoke('external-fetch-emergency', { serviceKey, params }),
  externalFetchEmergencyDetail: (serviceKey, hpids) => ipcRenderer.invoke('external-fetch-emergency-detail', { serviceKey, hpids }),
  /* 의료기관 반경 대량 캐싱 */
  medfacBulkFetch: (serviceKey, emergencyKey, params) => ipcRenderer.invoke('medfac-bulk-fetch', { serviceKey, emergencyKey, params }),
  medfacLoadCache: () => ipcRenderer.invoke('medfac-load-cache'),
  medfacClearCache: () => ipcRenderer.invoke('medfac-clear-cache'),
  /* 진행률 이벤트 구독 — 여러 번 호출 시 이전 리스너 자동 제거 */
  medfacOnProgress: (callback) => {
    ipcRenderer.removeAllListeners('medfac-bulk-progress');
    if (typeof callback === 'function') ipcRenderer.on('medfac-bulk-progress', (_, data) => callback(data));
  },
  externalFetchInfectious: () => ipcRenderer.invoke('external-fetch-infectious'),
  kakaoKeywordSearch: (query, x, y, radius, page, apiKey) => ipcRenderer.invoke('kakao-keyword-search', { query, x, y, radius, page, apiKey }),
  kakaoAddressSearch: (query, apiKey) => ipcRenderer.invoke('kakao-address-search', { query, apiKey }),
  kakaoCategorySearch: (category, x, y, radius, page, apiKey) => ipcRenderer.invoke('kakao-category-search', { category, x, y, radius, page, apiKey }),
  openMedFacility: (schoolName, eduOffice, hiraKey, emergencyKey, schoolAddr, mode, kakaoRestKey, kakaoJsKey, schoolLat, schoolLng) => ipcRenderer.invoke('open-med-facility', { schoolName, eduOffice, hiraKey, emergencyKey, schoolAddr, mode, kakaoRestKey, kakaoJsKey, schoolLat, schoolLng }),
  moveWindow: (dx, dy) => ipcRenderer.invoke('move-window', { dx, dy }),
  getMedCache: () => ipcRenderer.invoke('get-med-cache'),
  /* 키오스크 LAN WebSocket */
  kioskWsStart: (port) => ipcRenderer.invoke('kiosk-ws-start', { port }),
  kioskWsStop: () => ipcRenderer.invoke('kiosk-ws-stop'),
  kioskWsBroadcast: (msg) => ipcRenderer.invoke('kiosk-ws-broadcast', { msg }),
  kioskWsStatus: () => ipcRenderer.invoke('kiosk-ws-status'),
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),
  /* ── 웹 서버 제어 (동료와 협업) ── */
  webServerStart: () => ipcRenderer.invoke('web-server:start'),
  webServerStop: () => ipcRenderer.invoke('web-server:stop'),
  webServerStatus: () => ipcRenderer.invoke('web-server:status'),
  /* 웹 서버 라이프사이클 이벤트 — data-loader.js 의 폴링 시작/정지 신호.
   * main 이 자식 stdout 의 'listening on port' 감지 시 started, 자식 'exit' 시 stopped 송신. */
  onWebServerStarted: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const h = () => callback();
    ipcRenderer.on('web-server-started', h);
    return () => ipcRenderer.removeListener('web-server-started', h);
  },
  onWebServerStopped: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const h = () => callback();
    ipcRenderer.on('web-server-stopped', h);
    return () => ipcRenderer.removeListener('web-server-stopped', h);
  },
  onKioskWsMessage: (callback) => ipcRenderer.on('kiosk-ws-message', (event, msg) => callback(msg)),
  externalFetchUrlTitle: (url) => ipcRenderer.invoke('external-fetch-url-title', { url }),
  externalFetchJson: (url) => ipcRenderer.invoke('external-fetch-json', { url }),
  externalFetchNeis: (url) => ipcRenderer.invoke('external-fetch-neis', { url }),
  externalFetchPublicSheetCsv: (spreadsheetId) => ipcRenderer.invoke('external-fetch-public-sheet-csv', { spreadsheetId }),
  plannerLoadDay: (date) => ipcRenderer.invoke('planner-load-day', { date }),
  plannerSaveDay: (date, data) => ipcRenderer.invoke('planner-save-day', { date, data }),
  plannerHasDay: (date) => ipcRenderer.invoke('planner-has-day', { date }),
  plannerGetLinks: () => ipcRenderer.invoke('planner-get-links'),
  plannerSaveLinks: (items) => ipcRenderer.invoke('planner-save-links', { items }),
  plannerGetRoutines: () => ipcRenderer.invoke('planner-get-routines'),
  plannerSaveRoutines: (items) => ipcRenderer.invoke('planner-save-routines', { items }),
  plannerGetGlobalTodos: () => ipcRenderer.invoke('planner-get-global-todos'),
  plannerSaveGlobalTodos: (items) => ipcRenderer.invoke('planner-save-global-todos', { items }),
  plannerGetDateSettings: () => ipcRenderer.invoke('planner-get-date-settings'),
  plannerSaveDateSettings: (settings) => ipcRenderer.invoke('planner-save-date-settings', { settings }),
  plannerFetchMonthEvents: (date) => ipcRenderer.invoke('planner-fetch-month-events', { date }),
  plannerCreateTodoEvent: (calendarId, date, summary, colorId) => ipcRenderer.invoke('planner-create-todo-event', { calendarId, date, summary, colorId }),
  surveyGetWorkspace: () => ipcRenderer.invoke('survey-get-workspace'),
  surveySaveWorkspace: (patch) => ipcRenderer.invoke('survey-save-workspace', { patch }),
  surveySaveDraft: (draft) => ipcRenderer.invoke('survey-save-draft', { draft }),
  surveySavePath: (path) => ipcRenderer.invoke('survey-save-path', { path }),
  surveyGetDefaultDraftSync: (schoolName, year) => ipcRenderer.invoke('survey-get-default-draft-sync', { schoolName, year }),
  editorStateGet: (namespace, slot) => ipcRenderer.invoke('editor-state-get', { namespace, slot }),
  editorStateSave: (namespace, slot, data) => ipcRenderer.invoke('editor-state-save', { namespace, slot, data }),
  editorStateDelete: (namespace, slot) => ipcRenderer.invoke('editor-state-delete', { namespace, slot }),
  newsletterListGet: () => ipcRenderer.invoke('newsletter-list-get'),
  newsletterCreate: (name, data) => ipcRenderer.invoke('newsletter-create', { name, data }),
  newsletterUpdate: (id, data) => ipcRenderer.invoke('newsletter-update', { id, data }),
  newsletterRename: (id, name) => ipcRenderer.invoke('newsletter-rename', { id, name }),
  newsletterDuplicate: (id) => ipcRenderer.invoke('newsletter-duplicate', { id }),
  newsletterDelete: (id) => ipcRenderer.invoke('newsletter-delete', { id }),
  newsletterLoad: (id) => ipcRenderer.invoke('newsletter-load', { id }),
  newsletterRenderHtml: (state, options) => ipcRenderer.invoke('newsletter-render-html', { state, options }),
  newsletterRenderMergePdfHtml: (state, options) => ipcRenderer.invoke('newsletter-render-merge-pdf-html', { state, options }),
  newsletterExportPdf: (state, options, pdfOptions) => ipcRenderer.invoke('newsletter-export-pdf', { state, options, pdfOptions }),

  sheetsBatchUpdate: (spreadsheetId, requests) =>
    ipcRenderer.invoke('sheets-batch-update', { spreadsheetId, requests }),

  sheetsMetadata: (spreadsheetId) =>
    ipcRenderer.invoke('sheets-metadata', { spreadsheetId }),

  driveListFolders: (parentId) =>
    ipcRenderer.invoke('drive-list-folders', { parentId }),
  driveCreateFolder: (name, parentId) =>
    ipcRenderer.invoke('drive-create-folder', { name, parentId }),
  driveMoveFile: (fileId, newParentId) =>
    ipcRenderer.invoke('drive-move-file', { fileId, newParentId }),

  calendarList: () =>
    ipcRenderer.invoke('calendar-list'),

  calendarEvents: (calendarId, options) =>
    ipcRenderer.invoke('calendar-events', { calendarId, options }),

  calendarCreate: (calendarId, eventBody) =>
    ipcRenderer.invoke('calendar-create', { calendarId, eventBody }),

  calendarUpdate: (calendarId, eventId, eventBody) =>
    ipcRenderer.invoke('calendar-update', { calendarId, eventId, eventBody }),

  calendarDelete: (calendarId, eventId) =>
    ipcRenderer.invoke('calendar-delete', { calendarId, eventId }),

  /* 캘린더 공유(ACL) — 공유 대상 조회/추가/권한변경/삭제 (2026-07-02) */
  calendarAclList: (calendarId) =>
    ipcRenderer.invoke('calendar-acl-list', { calendarId }),
  calendarAclInsert: (calendarId, rule) =>
    ipcRenderer.invoke('calendar-acl-insert', { calendarId, rule }),
  calendarAclUpdate: (calendarId, ruleId, rule) =>
    ipcRenderer.invoke('calendar-acl-update', { calendarId, ruleId, rule }),
  calendarAclDelete: (calendarId, ruleId) =>
    ipcRenderer.invoke('calendar-acl-delete', { calendarId, ruleId }),
  calendarCreateCalendar: (summary) =>
    ipcRenderer.invoke('calendar-create-calendar', { summary }),

  // PDF
  printToPDF: (html, options) => ipcRenderer.invoke('print-to-pdf', { html, options }),
  // 2단계 PDF (2026-08-12) — 생성(토큰 반환)과 저장 다이얼로그 분리. 보건일지 출력의 진행 카운터 완주 후 저장 창용.
  printToPDFGenerate: (html, options) => ipcRenderer.invoke('print-to-pdf-generate', { html, options }),
  printToPDFSave: (token, fileName) => ipcRenderer.invoke('print-to-pdf-save', { token, fileName }),

  // 직접 인쇄 (용지 크기 강제 — 다이얼로그에 원하는 크기 기본 노출). title 은 Windows "Save as PDF" 기본 파일명에 사용됨.
  printWindowWithSize: (html, pageSize, margins, title, silent, deviceName, waitForReady, landscape) =>
    ipcRenderer.invoke('print-window-with-size', { html, pageSize, margins, title, silent, deviceName, waitForReady, landscape }),
  // 현재 창 자체를 silent 인쇄 (지정 프린터/용지)
  printCurrentWindow: (pageSize, margins, silent, deviceName, landscape) =>
    ipcRenderer.invoke('print-current-window', { pageSize, margins, silent, deviceName, landscape }),
  // 설치된 프린터 목록 (영수증 프린터 지정 UI 용)
  listPrinters: () => ipcRenderer.invoke('list-printers'),

  // 파일 시스템
  getDefaultSavePath: () => ipcRenderer.invoke('get-default-save-path'),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  saveFile: (filePath, data) => ipcRenderer.invoke('save-file', { filePath, data }),
  /* 위치 선택 다이얼로그 + 저장 — 다이얼로그 닫힌 뒤 완료 반환 (Excel 토스트 타이밍, 2026-06-11) */
  saveBytesDialog: (defaultName, bytes, filters) => ipcRenderer.invoke('save-bytes-dialog', { defaultName, bytes, filters }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
  kioskPreviewInBrowser: (wrapperHtml, innerLand, innerPort, extraInners) => ipcRenderer.invoke('kiosk-preview-in-browser', wrapperHtml, innerLand, innerPort, extraInners),
  listFiles: (dirPath, ext) => ipcRenderer.invoke('list-files', { dirPath, ext }),

  // 폴더 관리
  openPath: (folderPath) => ipcRenderer.invoke('open-path', folderPath),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  /* 파일 크기 조회 — 설정 > 데이터 백업 화면에서 각 파일의 용량 표시용 */
  getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
  ensureSurveyFolder: (surveyKey) => ipcRenderer.invoke('ensure-survey-folder', surveyKey),

  // SQLite 파일 직접 백업/복원
  dbBackupSqlite: () => ipcRenderer.invoke('db-backup-sqlite'),
  dbRestoreSqlite: () => ipcRenderer.invoke('db-restore-sqlite'),

  // 커스텀 설정 백업과 반영 (학교 이동용, 사용자 정책 2026-05-22)
  customBackupListKeys: () => ipcRenderer.invoke('custom-backup-list-keys'),
  customBackupExport: (localStorageData, selectedIds) => ipcRenderer.invoke('custom-backup-export', { localStorageData, selectedIds }),
  customBackupImport: () => ipcRenderer.invoke('custom-backup-import'),

  // JSON 파일 기반 데이터 저장/로드
  jsonSave: (key, data) => ipcRenderer.invoke('json-save', { key, data }),
  jsonLoad: (key, year) => ipcRenderer.invoke('json-load', { key, year }),
  jsonSaveCommon: (key, data) => ipcRenderer.invoke('json-save-common', { key, data }),
  jsonLoadCommon: (key) => ipcRenderer.invoke('json-load-common', { key }),
  jsonFlush: (items) => ipcRenderer.invoke('json-flush', { items }),
  /* 오늘의 메모 (today_memos, DB v4) — 날짜별 칸 내용. 백업·복원·웹 협업 동행 (2026-06-10) */
  todayMemoGetAll: () => ipcRenderer.invoke('today-memo-get-all'),
  todayMemoSet: (date, cells) => ipcRenderer.invoke('today-memo-set', { date, cells }),
  /* 양식 xlsx 의 약품-증상 매핑 (templates/forms/symptom_medicine_matching.xlsx) — 사용자 요청 2026-05-27 */
  templatesLoadMedSymMatching: () => ipcRenderer.invoke('templates-load-med-sym-matching'),
  // ── 사용자 배경 이미지 파일 (userData/data/bg/custom.{ext}) ──
  userBgSave: (buffer, ext) => ipcRenderer.invoke('user-bg-save', { buffer, ext }),
  userBgDelete: () => ipcRenderer.invoke('user-bg-delete'),
  userBgGetPath: () => ipcRenderer.invoke('user-bg-get-path'),
  userBgGetDataUrl: () => ipcRenderer.invoke('user-bg-get-data-url'),
  dbGet: (scope, key, year) => ipcRenderer.invoke('db-get', { scope, key, year }),
  dbSet: (scope, key, value, year) => ipcRenderer.invoke('db-set', { scope, key, value, year }),
  dbBatchSet: (items) => ipcRenderer.invoke('db-batch-set', { items }),
  dbInfo: () => ipcRenderer.invoke('db-info'),
  dbFactoryReset: () => ipcRenderer.invoke('db-factory-reset'),
  dbFactoryResetHealthOnly: () => ipcRenderer.invoke('db-factory-reset-health-only'),
  industryMigrationExport: audience => ipcRenderer.invoke('industry-migration-export', audience),
  dbExportBackup: () => ipcRenderer.invoke('db-export-backup'),
  dbImportBackup: (backup) => ipcRenderer.invoke('db-import-backup', { backup }),
  captureElement: (opts) => ipcRenderer.invoke('capture-element', opts),
  captureToPng: (opts) => ipcRenderer.invoke('capture-to-png', opts),
  clipboardWriteHtml: (html, text) => ipcRenderer.invoke('clipboard-write-html', { html, text }),

  // 키오스크 릴레이 채널
  kioskCreateChannel: (relayUrl, schoolName, educationOffice) =>
    ipcRenderer.invoke('kiosk-create-channel', { relayUrl, schoolName, educationOffice }),
  kioskChannelStatus: (relayUrl, channelId) =>
    ipcRenderer.invoke('kiosk-channel-status', { relayUrl, channelId }),
  kioskPushConfig: (relayUrl, channelId, authToken, config) =>
    ipcRenderer.invoke('kiosk-push-config', { relayUrl, channelId, authToken, config }),
  kioskUploadHtml: (relayUrl, channelId, authToken, html) =>
    ipcRenderer.invoke('kiosk-upload-html', { relayUrl, channelId, authToken, html }),
  kioskPushAccessKey: (relayUrl, channelId, authToken, accessKey) =>
    ipcRenderer.invoke('kiosk-push-access-key', { relayUrl, channelId, authToken, accessKey }),
  kioskTestRelay: (relayUrl, channelId, nurseToken) =>
    ipcRenderer.invoke('kiosk-test-relay', { relayUrl, channelId, nurseToken }),
  kioskGetReceptions: (relayUrl, channelId, nurseToken) =>
    ipcRenderer.invoke('kiosk-get-receptions', { relayUrl, channelId, nurseToken }),
  kioskCompleteReception: (relayUrl, channelId, nurseToken, receptionId) =>
    ipcRenderer.invoke('kiosk-complete-reception', { relayUrl, channelId, nurseToken, receptionId }),

  // Sheets 전용 계정 관리
  sheetsLogin: () => ipcRenderer.invoke('sheets-login'),
  sheetsGetUser: () => ipcRenderer.invoke('sheets-get-user'),
  sheetsLogout: () => ipcRenderer.invoke('sheets-logout'),
  sheetsUseMain: () => ipcRenderer.invoke('sheets-use-main'),

  // Drive JSON 동기화
  driveSyncUpload: (fileName, jsonContent, folderId) =>
    ipcRenderer.invoke('drive-sync-upload', { fileName, jsonContent, folderId }),
  driveSyncDownload: (fileName, folderId) =>
    ipcRenderer.invoke('drive-sync-download', { fileName, folderId }),

  // ── 사용자 관리 (UserService) ──
  userGetAll: () => ipcRenderer.invoke('user-get-all'),
  userGetActive: () => ipcRenderer.invoke('user-get-active'),
  userGetById: (id) => ipcRenderer.invoke('user-get-by-id', id),
  userCreate: (data) => ipcRenderer.invoke('user-create', data),
  userUpdate: (id, data) => ipcRenderer.invoke('user-update', id, data),
  userDelete: (id) => ipcRenderer.invoke('user-delete', id),
  userSetCurrent: (userId) => ipcRenderer.invoke('user-set-current', userId),
  userGetCurrent: () => ipcRenderer.invoke('user-get-current'),

  // ── 과거 데이터 이관 (PastHistoryService) ──
  chooseSqliteFile: () => ipcRenderer.invoke('choose-sqlite-file'),
  importExistingDb: (filePath) => ipcRenderer.invoke('import-existing-db', { filePath }),
  importPastHistoryXlsx: (filePath) => ipcRenderer.invoke('import-past-history-xlsx', { filePath }),
  importPastHistoryXlsxBuffer: (bytes, filename) => ipcRenderer.invoke('import-past-history-xlsx-buffer', { bytes, filename }),
  xlsxInjectFreeze: (bytes, ySplit) => ipcRenderer.invoke('xlsx-inject-freeze', { bytes, ySplit }),
  xlsxInjectStyle: (bytes, options) => ipcRenderer.invoke('xlsx-inject-style', { bytes, options }),
  xlsxBuildDiary: (payload) => ipcRenderer.invoke('xlsx-build-diary', payload),
  xlsxBuildTrainingStatus: (payload) => ipcRenderer.invoke('xlsx-build-training-status', payload),   /* 연수 이수 현황 Excel (2026-08-25) */
  xlsxBuildCounsel: (payload) => ipcRenderer.invoke('xlsx-build-counsel', payload),
  xlsxBuildDeptStats: (payload) => ipcRenderer.invoke('xlsx-build-dept-stats', payload),
  xlsxBuildVisitRank: (payload) => ipcRenderer.invoke('xlsx-build-visit-rank', payload),
  pastHistorySearch: (params) => ipcRenderer.invoke('past-history-search', { params }),
  pastHistoryStats: () => ipcRenderer.invoke('past-history-stats'),
  pastHistoryExists: () => ipcRenderer.invoke('past-history-exists'),
  pastHistoryAutoMatch: (currentYear, schoolLevel) => ipcRenderer.invoke('past-history-auto-match', { currentYear, schoolLevel }),
  pastHistoryResolveAmbiguous: (recordIds, studentId) => ipcRenderer.invoke('past-history-resolve-ambiguous', { recordIds, studentId }),
  pastHistoryGetAmbiguous: () => ipcRenderer.invoke('past-history-get-ambiguous'),
  pastHistoryGetUnmatched: () => ipcRenderer.invoke('past-history-get-unmatched'),
  pastHistoryResolveUnmatched: (recordIds, studentId) => ipcRenderer.invoke('past-history-resolve-unmatched', { recordIds, studentId }),
  pastHistoryApply: () => ipcRenderer.invoke('past-history-apply'),
  pastHistoryMigratePlaceholders: () => ipcRenderer.invoke('past-history-migrate-placeholders'),
  pastHistoryDeleteImported: () => ipcRenderer.invoke('past-history-delete-imported'),
  pastHistoryClearStaging: () => ipcRenderer.invoke('past-history-clear-staging'),
  pastHistoryRevertJustInserted: (ids) => ipcRenderer.invoke('past-history-revert-just-inserted', { ids }),
  pastHistoryListPlaceholders: () => ipcRenderer.invoke('past-history-list-placeholders'),
  pastHistoryMatchPlaceholder: (recordId, personUid) => ipcRenderer.invoke('past-history-match-placeholder', { recordId, personUid }),
  pastHistoryDeletePlaceholder: (recordId) => ipcRenderer.invoke('past-history-delete-placeholder', { recordId }),
  pastHistoryDeleteStagingRow: (stagingId) => ipcRenderer.invoke('past-history-delete-staging-row', { stagingId }),
  pastHistoryRevertMatched: () => ipcRenderer.invoke('past-history-revert-matched'),
  pastHistoryPlaceholderAsLeaver: (recordId) => ipcRenderer.invoke('past-history-placeholder-as-leaver', { recordId }),
  pastHistoryStagingRowAsLeaver: (stagingId) => ipcRenderer.invoke('past-history-staging-row-as-leaver', { stagingId }),
  pastHistoryImportedCount: () => ipcRenderer.invoke('past-history-imported-count'),
  pastHistoryMatchStats: () => ipcRenderer.invoke('past-history-match-stats'),
  pastHistoryGetByDate: (date) => ipcRenderer.invoke('past-history-get-by-date', { date }),

  // ── 잠복결핵 영구 누적 (TbTestService) ──
  tbTestAdd: (data) => ipcRenderer.invoke('tb-test-add', data),
  tbTestImportXlsx: (filePath) => ipcRenderer.invoke('tb-test-import-xlsx', { filePath }),
  tbTestSearch: (params) => ipcRenderer.invoke('tb-test-search', params),
  tbTestGetAll: () => ipcRenderer.invoke('tb-test-get-all'),
  tbTestStats: () => ipcRenderer.invoke('tb-test-stats'),
  tbTestDelete: (id) => ipcRenderer.invoke('tb-test-delete', id),
  tbTestUpdate: (id, data) => ipcRenderer.invoke('tb-test-update', { id, data }),

  // ── 앱 설정 (AppConfigService) ──
  appConfigIsFirstRun: () => ipcRenderer.invoke('app-config-is-first-run'),
  appConfigSetup: (opts) => ipcRenderer.invoke('app-config-setup', opts),
  appConfigGetSchool: () => ipcRenderer.invoke('app-config-get-school'),
  appConfigUpdateSchool: (school, teacher) => ipcRenderer.invoke('app-config-update-school', { school, teacher }),
  appConfigGetAll: () => ipcRenderer.invoke('app-config-get-all'),
  /* appConfigCheckSchoolType, appConfigSetDataSchoolType 제거됨 (v8: school_level 단순화) */

  // ── 폴더 경로 ──
  foldersGetPaths: () => ipcRenderer.invoke('folders-get-paths'),

  // ── 학생 (새 DB) ──
  studentsGetAll: (year) => ipcRenderer.invoke('students-get-all', { year }),
  studentsGetAllIncludeLeft: (year) => ipcRenderer.invoke('students-get-all-include-left', { year }),
  studentsGetAllHistorical: () => ipcRenderer.invoke('students-get-all-historical'),
  studentsFindNameDuplicates: (year) => ipcRenderer.invoke('students-find-name-duplicates', { year }),
  studentsResolveNameDuplicate: (currentUid, prevUid) => ipcRenderer.invoke('students-resolve-name-duplicate', { currentUid, prevUid }),
  studentsSaveAll: (students, year) => ipcRenderer.invoke('students-save-all', { students, year }),
  studentsUpsert: (student, year) => ipcRenderer.invoke('students-upsert', { student, year }),
  studentsDelete: (uid) => ipcRenderer.invoke('students-delete', { uid }),
  studentsDeleteAllYear: (year) => ipcRenderer.invoke('students-delete-all-year', { year }),
  studentsSetEnrolled: (uid, year, enrolled) => ipcRenderer.invoke('students-set-enrolled', { uid, year, enrolled }),
  studentsImportBatch: (students, year, replaceAll) => ipcRenderer.invoke('students-import-batch', { students, year, replaceAll }),
  studentsImportWithPending: (students, year) => ipcRenderer.invoke('students-import-with-pending', { students, year }),
  studentsPendingAmbiguousList: (year) => ipcRenderer.invoke('students-pending-ambiguous-list', { year }),
  studentsPendingAmbiguousCount: (year) => ipcRenderer.invoke('students-pending-ambiguous-count', { year }),
  studentsPendingAmbiguousResolve: (year, excelRow, chosenUid) => ipcRenderer.invoke('students-pending-ambiguous-resolve', { year, excelRow, chosenUid }),
  studentsGetCare: (year) => ipcRenderer.invoke('students-get-care', { year }),
  studentsGetHistory: (uid) => ipcRenderer.invoke('students-get-history', { uid }),
  studentsUpdateMemo: (uid, memoJson) => ipcRenderer.invoke('students-update-memo', { uid, memoJson }),
  studentsUpdateMedConsent: (uid, consent) => ipcRenderer.invoke('students-update-med-consent', { uid, consent }),
  studentsDedup: (year) => ipcRenderer.invoke('students-dedup', { year }),
  studentsGradeSummary: (year) => ipcRenderer.invoke('students-grade-summary', { year }),
  studentsClassGroups: (year, grades) => ipcRenderer.invoke('students-class-groups', { year, grades }),

  // ── people alias (students와 동일) ──
  peopleGetAll: (year) => ipcRenderer.invoke('students-get-all', { year }),
  peopleGetAllIncludeLeft: (year) => ipcRenderer.invoke('students-get-all-include-left', { year }),
  peopleSaveAll: (people, year) => {
    /* 학생/교직원 분리 저장 — 이전에는 모두 students 테이블로 보내져서 교직원이 student 로 잘못 저장되는 문제 발생 */
    const students = (people||[]).filter(p => p && p.type !== 'staff');
    const staffList = (people||[]).filter(p => p && p.type === 'staff');
    return Promise.all([
      ipcRenderer.invoke('students-save-all', { students, year }),
      staffList.length ? ipcRenderer.invoke('staff-save-all', { staffList, year }) : Promise.resolve({ success: true })
    ]).then(r => ({ success: r.every(x => x && x.success !== false), students: r[0], staff: r[1] }));
  },
  peopleUpsert: (person, year) => ipcRenderer.invoke('students-upsert', { student: person, year }),
  peopleDelete: (uid) => ipcRenderer.invoke('students-delete', { uid }),
  peopleSetEnrolled: (uid, year, enrolled) => ipcRenderer.invoke('students-set-enrolled', { uid, year, enrolled }),
  peopleImportBatch: (people, year, replaceAll) => ipcRenderer.invoke('students-import-batch', { students: people, year, replaceAll }),
  peopleGetCare: (year) => ipcRenderer.invoke('students-get-care', { year }),
  peopleGetHistory: (uid) => ipcRenderer.invoke('students-get-history', { uid }),
  peopleDedup: (year) => ipcRenderer.invoke('students-dedup', { year }),
  peopleGradeSummary: (year) => ipcRenderer.invoke('students-grade-summary', { year }),
  peopleClassGroups: (year, grades) => ipcRenderer.invoke('students-class-groups', { year, grades }),

  // ── 교직원 (새 DB) ──
  staffGetAll: (year) => ipcRenderer.invoke('staff-get-all', { year }),
  staffGetAllIncludeInactive: (year) => ipcRenderer.invoke('staff-get-all-include-inactive', { year }),
  staffGetAllHistorical: () => ipcRenderer.invoke('staff-get-all-historical'),
  staffFindNameDuplicates: (year) => ipcRenderer.invoke('staff-find-name-duplicates', { year }),
  staffResolveNameDuplicate: (currentUid, prevUid) => ipcRenderer.invoke('staff-resolve-name-duplicate', { currentUid, prevUid }),
  staffUpsert: (staff, year) => ipcRenderer.invoke('staff-upsert', { staff, year }),
  staffSaveAll: (staffList, year) => ipcRenderer.invoke('staff-save-all', { staffList, year }),
  staffDelete: (uid) => ipcRenderer.invoke('staff-delete', { uid }),
  staffDeleteAllYear: (year) => ipcRenderer.invoke('staff-delete-all-year', { year }),
  staffDeactivate: (uid) => ipcRenderer.invoke('staff-deactivate', { uid }),
  // ── 보존 기간 만료 정리 (완전 고아만) ──
  retentionFindOrphanStudents: (cutoffYears) => ipcRenderer.invoke('retention-find-orphan-students', { cutoffYears }),
  retentionBulkDeleteOrphanStudents: (uids) => ipcRenderer.invoke('retention-bulk-delete-orphan-students', { uids }),
  retentionFindOrphanStaff: (cutoffYears) => ipcRenderer.invoke('retention-find-orphan-staff', { cutoffYears }),
  retentionBulkDeleteOrphanStaff: (uids) => ipcRenderer.invoke('retention-bulk-delete-orphan-staff', { uids }),

  // ── 보건일지 레코드 (새 DB) ──
  recordsGetDaily: (year) => ipcRenderer.invoke('records-get-daily', { year }),
  recordsGetDailyByDate: (year, date) => ipcRenderer.invoke('records-get-daily-by-date', { year, date }),
  recordsGetDailyByPerson: (personUid) => ipcRenderer.invoke('records-get-daily-by-person', { personUid }),
  recordsDailyInsert: (record) => ipcRenderer.invoke('records-daily-insert', { record }),
  recordsDailyUpdate: (record) => ipcRenderer.invoke('records-daily-update', { record }),
  recordsDailyDelete: (id) => ipcRenderer.invoke('records-daily-delete', { id }),
  recordsDailyFixNurse: (oldName, newName) => ipcRenderer.invoke('records-daily-fix-nurse', { oldName, newName }),
  recordsDailyDeleteYear: (year) => ipcRenderer.invoke('records-daily-delete-year', { year }),
  recordsDailyYears: () => ipcRenderer.invoke('records-daily-years'),
  recordsYearSummary: () => ipcRenderer.invoke('records-year-summary'),
  recordsSaveDaily: (year, records) => ipcRenderer.invoke('records-save-daily', { year, records }),
  recordsGetEmergency: (year) => ipcRenderer.invoke('records-get-emergency', { year }),
  recordsEmergencyInsert: (record) => ipcRenderer.invoke('records-emergency-insert', { record }),
  recordsEmergencyUpdate: (record) => ipcRenderer.invoke('records-emergency-update', { record }),
  recordsEmergencyDelete: (id) => ipcRenderer.invoke('records-emergency-delete', { id }),
  recordsSaveEmergency: (year, records) => ipcRenderer.invoke('records-save-emergency', { year, records }),
  recordsGetInfection: (year) => ipcRenderer.invoke('records-get-infection', { year }),
  recordsInfectionInsert: (record) => ipcRenderer.invoke('records-infection-insert', { record }),
  recordsInfectionUpdate: (record) => ipcRenderer.invoke('records-infection-update', { record }),
  recordsInfectionDelete: (id) => ipcRenderer.invoke('records-infection-delete', { id }),
  recordsSaveInfection: (year, records) => ipcRenderer.invoke('records-save-infection', { year, records }),
  recordsDailyByDateRange: (from, to) => ipcRenderer.invoke('records-daily-by-date-range', { from, to }),
  recordsNurseStats: (from, to) => ipcRenderer.invoke('records-nurse-stats', { from, to }),
  recordsCountBeforeDate: (cutoffDate) => ipcRenderer.invoke('records-count-before-date', { cutoffDate }),
  recordsDeleteBeforeDate: (cutoffDate) => ipcRenderer.invoke('records-delete-before-date', { cutoffDate }),
  recordsCountByYear: (year) => ipcRenderer.invoke('records-count-by-year', { year }),
  recordsDeleteByYear: (year) => ipcRenderer.invoke('records-delete-by-year', { year }),
  recordsGetInfectionNotes: (year) => ipcRenderer.invoke('records-get-infection-notes', { year }),
  recordsSaveInfectionNotes: (year, notes) => ipcRenderer.invoke('records-save-infection-notes', { year, notes }),
  recordsFlushAll: (year, payload) => ipcRenderer.invoke('records-flush-all', { year, payload }),

  // ── 앱 설정 (SettingsService) ──
  settingsGet: (key, defaultValue) => ipcRenderer.invoke('settings-get', { key, defaultValue }),
  settingsSet: (key, value) => ipcRenderer.invoke('settings-set', { key, value }),
  settingsGetMultiple: (keys) => ipcRenderer.invoke('settings-get-multiple', { keys }),
  settingsSetMultiple: (entries) => ipcRenderer.invoke('settings-set-multiple', { entries }),

  // ── 의료 데이터 (MedicalDataService) ──
  medicalGetDeptMapping: () => ipcRenderer.invoke('medical-get-dept-mapping'),
  medicalSetDeptMapping: (text) => ipcRenderer.invoke('medical-set-dept-mapping', { text }),
  medicalGetDeptForSymptom: (symptom) => ipcRenderer.invoke('medical-get-dept-for-symptom', { symptom }),
  medicalGetDeptForSymptoms: (symptoms) => ipcRenderer.invoke('medical-get-dept-for-symptoms', { symptoms }),
  medicalGetTreatmentMap: () => ipcRenderer.invoke('medical-get-treatment-map'),
  medicalSetTreatmentMap: (map) => ipcRenderer.invoke('medical-set-treatment-map', { map }),
  medicalGetMedicationMap: () => ipcRenderer.invoke('medical-get-medication-map'),
  medicalSetMedicationMap: (map) => ipcRenderer.invoke('medical-set-medication-map', { map }),
  medicalGetSymMeds: () => ipcRenderer.invoke('medical-get-sym-meds'),
  medicalSetSymMeds: (data) => ipcRenderer.invoke('medical-set-sym-meds', { data }),
  medicalGetSymOintments: () => ipcRenderer.invoke('medical-get-sym-ointments'),
  medicalSetSymOintments: (data) => ipcRenderer.invoke('medical-set-sym-ointments', { data }),
  medicalGetSymPatches: () => ipcRenderer.invoke('medical-get-sym-patches'),
  medicalSetSymPatches: (data) => ipcRenderer.invoke('medical-set-sym-patches', { data }),
  medicalGetVitalThresholds: () => ipcRenderer.invoke('medical-get-vital-thresholds'),
  medicalSetVitalThresholds: (thresholds) => ipcRenderer.invoke('medical-set-vital-thresholds', { thresholds }),
  medicalComputeBmi: (entries) => ipcRenderer.invoke('medical-compute-bmi', { entries }),

  // ── 설문 시스템 ──
  surveyFormList: () => ipcRenderer.invoke('survey-form-list'),
  surveyFormGet: (formId) => ipcRenderer.invoke('survey-form-get', { formId }),
  surveyFormSave: (form, content) => ipcRenderer.invoke('survey-form-save', { form, content }),
  surveyFormCopy: (sourceFormId, newId, newTitle) => ipcRenderer.invoke('survey-form-copy', { sourceFormId, newId, newTitle }),
  surveyFormDelete: (formId) => ipcRenderer.invoke('survey-form-delete', { formId }),
  // 응답 저장/조회 (DB에 JSON 텍스트로 직접 저장)
  surveyResponseSave: (response, content) => ipcRenderer.invoke('survey-response-save', { response, content }),
  surveyResponseImportBatch: (year, formId, responses) => ipcRenderer.invoke('survey-response-import-batch', { year, formId, responses }),
  surveyResponseGetByStudent: (persistentId) => ipcRenderer.invoke('survey-response-get-by-student', { persistentId }),
  surveyResponseGetByForm: (year, formId) => ipcRenderer.invoke('survey-response-get-by-form', { year, formId }),
  surveyResponseGetAllWithData: (year, formId) => ipcRenderer.invoke('survey-response-get-all-with-data', { year, formId }),
  surveyResponseGetData: (id) => ipcRenderer.invoke('survey-response-get-data', { id }),
  surveyResponseDelete: (id) => ipcRenderer.invoke('survey-response-delete', { id }),
  surveyResponseStats: (year, formId) => ipcRenderer.invoke('survey-response-stats', { year, formId }),
  surveyResponseMissingMessage: (year, formId, grade, cls, position, name) => ipcRenderer.invoke('survey-response-missing-message', { year, formId, grade, cls, position, name }),
  surveyResponseOldCount: (currentSchoolYear) => ipcRenderer.invoke('survey-response-old-count', { currentSchoolYear }),
  surveyResponseDeleteOld: (currentSchoolYear) => ipcRenderer.invoke('survey-response-delete-old', { currentSchoolYear }),

  // ── 통계 (StatisticsService) — 집계 로직 백엔드 전용 ──
  statsGetSummary: (opts) => ipcRenderer.invoke('stats-get-summary', opts || {}),
  statsGetDept: (opts) => ipcRenderer.invoke('stats-get-dept', opts || {}),
  statsGetSymptoms: (opts) => ipcRenderer.invoke('stats-get-symptoms', opts || {}),
  statsGetHourly: (opts) => ipcRenderer.invoke('stats-get-hourly', opts || {}),
  statsGetDailyCounts: (opts) => ipcRenderer.invoke('stats-get-daily-counts', opts || {}),

  // ── 대시보드 통계 DB (StatisticsDBService) — 렌더러 집계 대체 ──
  statsDbDeptGrade: (year, from, to) => ipcRenderer.invoke('stats-db-dept-grade', { year, from, to }),
  statsDbDeptGradeYoY: (year, from, to) => ipcRenderer.invoke('stats-db-dept-grade-yoy', { year, from, to }),
  statsDbCounsel: (year, from, to) => ipcRenderer.invoke('stats-db-counsel', { year, from, to }),
  statsDbSummary: (year, from, to) => ipcRenderer.invoke('stats-db-summary', { year, from, to }),
  statsDbDeptCats: () => ipcRenderer.invoke('stats-db-dept-cats'),
  statsDbTreatment: (year, from, to) => ipcRenderer.invoke('stats-db-treatment', { year, from, to }),
  statsDbUncategorizedSymptoms: (year, from, to) => ipcRenderer.invoke('stats-db-uncategorized-symptoms', { year, from, to }),
  statsDbAssignSymCat: (payload) => ipcRenderer.invoke('stats-db-assign-sym-cat', payload),
  statsDbHourlyHeatmap: (year, from, to) => ipcRenderer.invoke('stats-db-hourly-heatmap', { year, from, to }),
  statsDbClassDistribution: (year, from, to) => ipcRenderer.invoke('stats-db-class-distribution', { year, from, to }),
  statsDbRepeatVisitors: (year, from, to, minVisits) => ipcRenderer.invoke('stats-db-repeat-visitors', { year, from, to, minVisits }),
  statsDbGenderSymptoms: (year, from, to) => ipcRenderer.invoke('stats-db-gender-symptoms', { year, from, to }),
  statsDbQuick: (year, from, to) => ipcRenderer.invoke('stats-db-quick', { year, from, to }),
  statsDbAcademicRange: (period, year, options) => ipcRenderer.invoke('stats-db-academic-range', { period, year, options }),
  statsDbSubTabs: (period, baseDate) => ipcRenderer.invoke('stats-db-sub-tabs', { period, baseDate }),
  statsDbHolidays: () => ipcRenderer.invoke('stats-db-holidays'),
  statsDbHolidaysFor: (year) => ipcRenderer.invoke('stats-db-holidays-for', year),
  statsDbHolidaysCachedYears: () => ipcRenderer.invoke('stats-db-holidays-cached-years'),
  statsDbHolidaysFetch: (serviceKey, year) => ipcRenderer.invoke('stats-db-holidays-fetch', { serviceKey, year }),
  statsDbHolidaysClear: (year) => ipcRenderer.invoke('stats-db-holidays-clear', year),
  statsDbTrend: (opts) => ipcRenderer.invoke('stats-db-trend', opts),

  /* ── 자동 업데이트 ── */
  updaterCheckNow: () => ipcRenderer.invoke('updater-check-now'),
  updaterQuitAndInstall: () => ipcRenderer.invoke('updater-quit-and-install'),
  updaterIsReady: () => ipcRenderer.invoke('updater-is-ready'),
  confirmQuitAfterUpdate: () => ipcRenderer.invoke('confirm-quit-after-update'),
  onShowUpdateOverlay: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const h = (_evt, payload) => callback(payload || {});
    ipcRenderer.on('show-update-overlay', h);
    return () => ipcRenderer.removeListener('show-update-overlay', h);
  },
  betaExpiryInfo: () => ipcRenderer.invoke('beta-expiry-info'),
  appQuit: () => ipcRenderer.invoke('app-quit'),
  appRelaunch: () => ipcRenderer.invoke('app-relaunch'),
  /* 첫 시작 로그인 화면 준비 완료 → 메인 윈도우 표시 트리거 (흰 화면 단계 건너뛰기). (2026-06-24) */
  splashReady: () => ipcRenderer.send('splash-ready'),
  updaterGetVersion: () => ipcRenderer.invoke('updater-get-version'),
  getBundledApiKeys: () => ipcRenderer.invoke('get-bundled-api-keys'),

  onUpdaterEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (channel) => (_evt, payload) => callback(channel.replace(/^updater:/, ''), payload);
    const channels = ['updater:checking','updater:available','updater:not-available','updater:progress','updater:downloaded','updater:error'];
    const registered = channels.map(ch => { const h = handler(ch); ipcRenderer.on(ch, h); return { ch, h }; });
    return () => registered.forEach(({ ch, h }) => ipcRenderer.removeListener(ch, h));
  },
};

/* Google 기능이 비활성화된 경우, 관련 IPC 호출을 모두 차단 응답으로 덮어쓴다.
 * (renderer 쪽 UI 에서 disabled 플래그를 감지해 "준비 중" 토스트 표시) */
if (!GOOGLE_FEATURES_ENABLED) {
  /* Sheets·Drive·Login — 엑셀 대안 안내 */
  GOOGLE_DOC_KEYS.forEach((k) => {
    if (typeof _api[k] === 'function') _api[k] = _googleDocDisabledResponse;
  });
  /* Calendar — 대안 없음 */
  GOOGLE_CALENDAR_KEYS.forEach((k) => {
    if (typeof _api[k] === 'function') _api[k] = _googleCalendarDisabledResponse;
  });
}
/* 렌더러가 현재 상태를 확인할 수 있도록 플래그 노출 */
_api.isGoogleFeaturesEnabled = () => GOOGLE_FEATURES_ENABLED;

contextBridge.exposeInMainWorld('electronAPI', _api);
