/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * web-api-bridge.js — Electron preload.js의 웹 브라우저 대체
 *
 * window.electronAPI 인터페이스를 그대로 제공하되,
 * ipcRenderer.invoke() 대신 fetch('/api/ipc/:channel') 사용.
 *
 * 렌더러 코드는 수정 없이 동일하게 동작합니다.
 */
'use strict';
(function(){
  /* 세션 ID 생성 (접속자 추적용) */
  var _sessionId = sessionStorage.getItem('_webSessionId');
  if (!_sessionId) {
    _sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('_webSessionId', _sessionId);
  }

  /* ════════════════════════════════════════════════════════════
   *  IPC 호출 + 끊김 큐 시스템 (Phase 2-3)
   *
   *  목적: 학교 방화벽 갱신 등으로 fetch 가 실패해도 사용자 입력 데이터가 분실되지 않도록.
   *  설계:
   *    1. fetch 1차 시도 → 성공이면 즉시 resolve + 큐 flush 시도
   *    2. fetch 실패 시 retry queue 에 push (resolve/reject 보관)
   *    3. localStorage 백업 — 페이지 새로고침 후에도 미전송 데이터 복원
   *    4. 5초마다 큐 flush worker 가 돌면서 재시도
   *    5. 큐 항목이 30회 (~150초) 넘게 묵으면 reject
   *
   *  참고: 데이터-loader 의 _activeBaseUrl 기반 폴백과 무관하게,
   *        bridge 는 자기 origin(상대 URL '/api/ipc/...') 으로 fetch.
   *        끊김 후 base 가 바뀌면 다음 페이지 새로고침 또는 명시적 origin 변경 후 자동 매칭. */

  var _retryQueue = [];      /* 메모리 큐 (resolve/reject 함수 보관) */
  var _flushRunning = false;
  var _LS_QUEUE_KEY = '_webIpcQueue';
  var _MAX_TRIES = 30;

  /* localStorage 백업 — resolve/reject 함수는 직렬화 못 하므로 channel/params/queuedAt 만 저장 */
  function _saveQueueLS(){
    try {
      var persistable = _retryQueue.map(function(it){
        return { channel: it.channel, params: it.params, queuedAt: it.queuedAt };
      });
      localStorage.setItem(_LS_QUEUE_KEY, JSON.stringify(persistable));
    } catch(_e){}
  }
  function _clearQueueLSIfEmpty(){
    if (_retryQueue.length === 0) {
      try { localStorage.removeItem(_LS_QUEUE_KEY); } catch(_e){}
    }
  }

  function _doFetch(channel, params){
    return fetch('/api/ipc/' + channel, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': _sessionId },
      body: JSON.stringify(params || {})
    }).then(function(r){ return r.json(); });
  }

  function _enqueue(channel, params, resolve, reject, tries){
    _retryQueue.push({
      channel: channel, params: params,
      resolve: resolve, reject: reject,
      tries: tries || 0, queuedAt: Date.now()
    });
    _saveQueueLS();
    /* 끊김 토스트가 사용자에게 표시되도록 conn:lost 이벤트 발행 — 1회만 */
    if (!_lostEmitted) {
      _lostEmitted = true;
      try { window.dispatchEvent(new CustomEvent('conn:lost', { detail: { from: 'ipc-bridge' } })); } catch(_e){}
    }
  }

  var _lostEmitted = false;

  function _flushRetryQueue(){
    if (_flushRunning) return;
    if (_retryQueue.length === 0) return;
    _flushRunning = true;
    /* 큐를 그대로 두고 항목씩 꺼내며 처리 — 직렬 처리로 순서 보존 */
    (async function(){
      while (_retryQueue.length) {
        var item = _retryQueue[0];
        item.tries++;
        try {
          var json = await _doFetch(item.channel, item.params);
          /* 성공 — 큐에서 제거 + resolve */
          _retryQueue.shift();
          _saveQueueLS();
          try { item.resolve(json); } catch(_e){}
        } catch(err) {
          /* 실패 — 다음 시도까지 대기. 너무 묵으면 reject */
          if (item.tries >= _MAX_TRIES) {
            _retryQueue.shift();
            _saveQueueLS();
            try { item.reject(err); } catch(_e){}
          } else {
            /* 큐에 남긴 채 break — 일정 시간 후 다시 시도 */
            break;
          }
        }
      }
      _flushRunning = false;
      _clearQueueLSIfEmpty();
      /* 큐가 비었으면 lost 플래그 해제 + restored 이벤트 */
      if (_retryQueue.length === 0 && _lostEmitted) {
        _lostEmitted = false;
        try { window.dispatchEvent(new CustomEvent('conn:queue-flushed', {})); } catch(_e){}
      }
    })();
  }

  /* 5초마다 큐 flush 시도 */
  setInterval(_flushRetryQueue, 5000);

  /* 페이지 로드 시 localStorage 큐 복원 — 새로고침 후에도 미전송 데이터 자동 재시도.
     resolve/reject 가 없으므로 fire-and-forget. 단, 결과는 같은 DB 에 적용되므로 사용자에게 영향 없음.
     ※ 7일 이상 묵은 항목은 폐기 (사용자가 의도하지 않은 누적 방지) */
  (function _restoreQueueFromLS(){
    try {
      var raw = localStorage.getItem(_LS_QUEUE_KEY);
      if (!raw) return;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      var nowMs = Date.now();
      var STALE_MS = 7 * 24 * 60 * 60 * 1000;
      var restored = 0, dropped = 0;
      list.forEach(function(it){
        if (it && it.channel) {
          var age = it.queuedAt ? (nowMs - it.queuedAt) : 0;
          if (age > STALE_MS) { dropped++; return; }
          _retryQueue.push({
            channel: it.channel, params: it.params,
            resolve: function(){}, reject: function(){},
            tries: 0, queuedAt: it.queuedAt || nowMs
          });
          restored++;
        }
      });
      if (dropped > 0) console.warn('[WEB-BRIDGE] 7일 이상 묵은 큐 항목 폐기:', dropped, '건');
      if (restored > 0) {
        console.log('[WEB-BRIDGE] 페이지 로드 시 미전송 큐 복원:', restored, '건 — 자동 재전송 시작');
        _saveQueueLS(); /* 폐기된 항목 반영 */
        _flushRetryQueue();
        /* 사용자에게 알림 — 화면 복귀 후 첫 fetch 가 응답하기 전에는 못 보낼 수 있어 약간 지연 */
        setTimeout(function(){
          try {
            window.dispatchEvent(new CustomEvent('conn:queue-restored', { detail: { count: restored } }));
          } catch(_){}
        }, 1500);
      }
    } catch(_e){}
  })();

  /* 범용 IPC 호출 → 1차 즉시 fetch, 실패 시 큐로 폴백 */
  function _ipc(channel, params) {
    return new Promise(function(resolve, reject){
      _doFetch(channel, params).then(function(json){
        resolve(json);
        /* 성공 시 큐에 누적된 다른 항목도 시도 */
        if (_retryQueue.length > 0) _flushRetryQueue();
      }).catch(function(err){
        console.warn('[WEB-BRIDGE] fetch 실패 — 큐 적재:', channel, err && err.message);
        _enqueue(channel, params, resolve, reject, 1);
      });
    });
  }

  /* 의료기관 탐색 인앱 모달 — BrowserWindow 대신 iframe 오버레이로 표시 */
  function _openMedFacilityModal(url) {
    var existing = document.getElementById('webMedFacilityOverlay');
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'webMedFacilityOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:11000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);opacity:0;transition:opacity .22s ease';
    var modal = document.createElement('div');
    modal.style.cssText = 'width:94vw;height:90vh;max-width:1280px;max-height:880px;background:#fff;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;transform:scale(0.96) translateY(6px);transition:transform .22s cubic-bezier(0.4,0,0.2,1)';
    var header = document.createElement('div');
    header.style.cssText = 'padding:10px 16px;background:#f5f7fa;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none';
    header.innerHTML = '<span style="font-size:13px;font-weight:800;color:#1e293b">🗺️ 의료기관 탐색</span><button id="webMedFacClose" style="background:transparent;border:none;cursor:pointer;font-size:20px;color:#64748b;padding:2px 8px">✕</button>';
    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'flex:1;width:100%;border:none;background:#fff';
    modal.appendChild(header);
    modal.appendChild(iframe);
    ov.appendChild(modal);
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.style.opacity='1'; modal.style.transform='scale(1) translateY(0)'; });
    function _close() {
      ov.style.opacity='0'; modal.style.transform='scale(0.96) translateY(6px)';
      setTimeout(function(){ if (ov.parentNode) ov.remove(); }, 220);
    }
    header.querySelector('#webMedFacClose').addEventListener('click', _close);
    ov.addEventListener('click', function(e){ if (e.target === ov) _close(); });
  }

  /* 파일 선택 다이얼로그 (브라우저 네이티브) */
  function _pickFile(accept) {
    return new Promise(function(resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        document.body.removeChild(input);
        if (!file) return resolve(null);
        resolve(file);
      });
      input.addEventListener('cancel', function() {
        document.body.removeChild(input);
        resolve(null);
      });
      input.click();
    });
  }

  /* 파일을 서버에 업로드 */
  function _uploadFile(file) {
    var fd = new FormData();
    fd.append('file', file);
    return fetch('/api/upload', { method: 'POST', body: fd })
      .then(function(r) { return r.json(); });
  }

  /* 파일 선택 → 업로드 → 서버 경로 반환 */
  function _pickAndUpload(accept) {
    return _pickFile(accept).then(function(file) {
      if (!file) return { success: true, data: null };
      return _uploadFile(file).then(function(res) {
        return { success: true, data: res.filePath, originalName: res.originalName };
      });
    });
  }

  /* 서버 응답에 다운로드 URL이 있으면 자동 트리거 */
  function _triggerDownload(url, fileName) {
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* HTML → PDF (클라이언트 사이드: html2canvas + jspdf) */
  function _htmlToPdf(html, options) {
    return new Promise(function(resolve) {
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1123px;border:none';
      document.body.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();
      setTimeout(function() {
        if (typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined') {
          html2canvas(iframe.contentDocument.body, { scale: 2, useCORS: true }).then(function(canvas) {
            var pdf = new jspdf.jsPDF('p', 'mm', 'a4');
            var imgData = canvas.toDataURL('image/jpeg', 0.95);
            var w = pdf.internal.pageSize.getWidth();
            var h = (canvas.height * w) / canvas.width;
            pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
            pdf.save((options && options.fileName) || 'document.pdf');
            document.body.removeChild(iframe);
            resolve({ success: true });
          });
        } else {
          /* fallback: 새 창에서 인쇄 */
          var win = window.open('', '_blank');
          if (win) { win.document.write(html); win.document.close(); setTimeout(function(){ win.print(); }, 500); }
          document.body.removeChild(iframe);
          resolve({ success: true });
        }
      }, 500);
    });
  }

  window.electronAPI = {
    /* ── 인증 ── */
    googleLogin: function() {
      return _ipc('google-login').then(function(res) {
        if (res && res.redirectUrl) { window.location.href = res.redirectUrl; return res; }
        return res;
      });
    },
    authConfigStatus: function() { return _ipc('auth-config-status'); },
    getUserInfo: function() { return _ipc('get-user-info'); },
    openMain: function() { return _ipc('open-main'); },
    logout: function() { return _ipc('logout'); },
    openExternal: function(url) {
      if (url && /^https?:\/\//.test(url)) window.open(url, '_blank');
      return Promise.resolve({ success: true });
    },

    /* ── Google Sheets/Drive/Calendar ── */
    sheetsRead: function(spreadsheetId, range) { return _ipc('sheets-read', { spreadsheetId, range }); },
    sheetsWrite: function(spreadsheetId, range, values) { return _ipc('sheets-write', { spreadsheetId, range, values }); },
    sheetsCreate: function(title, sheetTitle) { return _ipc('sheets-create', { title, sheetTitle }); },
    sheetsExportJob: function(job) { return _ipc('sheets-export-job', { job }); },
    sheetsBatchUpdate: function(spreadsheetId, requests) { return _ipc('sheets-batch-update', { spreadsheetId, requests }); },
    sheetsMetadata: function(spreadsheetId) { return _ipc('sheets-metadata', { spreadsheetId }); },
    driveListFolders: function(parentId) { return _ipc('drive-list-folders', { parentId }); },
    driveCreateFolder: function(name, parentId) { return _ipc('drive-create-folder', { name, parentId }); },
    driveMoveFile: function(fileId, newParentId) { return _ipc('drive-move-file', { fileId, newParentId }); },
    sheetsLogin: function() {
      return _ipc('sheets-login').then(function(res) {
        if (res && res.redirectUrl) { window.location.href = res.redirectUrl; return res; }
        return res;
      });
    },
    sheetsGetUser: function() { return _ipc('sheets-get-user'); },
    sheetsLogout: function() { return _ipc('sheets-logout'); },
    sheetsUseMain: function() { return _ipc('sheets-use-main'); },
    driveSyncUpload: function(fileName, jsonContent, folderId) { return _ipc('drive-sync-upload', { fileName, jsonContent, folderId }); },
    driveSyncDownload: function(fileName, folderId) { return _ipc('drive-sync-download', { fileName, folderId }); },
    calendarList: function() { return _ipc('calendar-list'); },
    calendarEvents: function(calendarId, options) { return _ipc('calendar-events', { calendarId, options }); },
    calendarCreate: function(calendarId, eventBody) { return _ipc('calendar-create', { calendarId, eventBody }); },
    calendarUpdate: function(calendarId, eventId, eventBody) { return _ipc('calendar-update', { calendarId, eventId, eventBody }); },
    calendarDelete: function(calendarId, eventId) { return _ipc('calendar-delete', { calendarId, eventId }); },

    /* ── 날씨/외부 API ── */
    weatherIpLocation: function() { return _ipc('weather-ip-location'); },
    weatherReverseGeocode: function(lat, lon) { return _ipc('weather-reverse-geocode', { lat, lon }); },
    weatherOpenMeteo: function(lat, lon) { return _ipc('weather-openmeteo', { lat, lon }); },
    weatherKma: function(apiKey, lat, lon) { return _ipc('weather-kma', { apiKey, lat, lon }); },
    externalFetchExchange: function() { return _ipc('external-fetch-exchange'); },
    externalFetchStock: function(ticker) { return _ipc('external-fetch-stock', { ticker }); },
    externalFetchAirkorea: function(serviceKey, stationName) { return _ipc('external-fetch-airkorea', { serviceKey, stationName }); },
    externalFetchDrugInfo: function(serviceKey, drugName) { return _ipc('external-fetch-drug-info', { serviceKey, drugName }); },
    externalSearchDrugList: function(serviceKey, query) { return _ipc('external-search-drug-list', { serviceKey, query }); },
    betaExpiryInfo: function() { return _ipc('beta-expiry-info'); },
    externalFetchMedFacilities: function(serviceKey, params) { return _ipc('external-fetch-med-facilities', { serviceKey, params }); },
    externalFetchEmergency: function(serviceKey, params) { return _ipc('external-fetch-emergency', { serviceKey, params }); },
    externalFetchEmergencyDetail: function(serviceKey, hpids) { return _ipc('external-fetch-emergency-detail', { serviceKey, hpids }); },
    externalFetchInfectious: function() { return _ipc('external-fetch-infectious'); },
    kakaoKeywordSearch: function(query, x, y, radius, page, apiKey) { return _ipc('kakao-keyword-search', { query, x, y, radius, page, apiKey }); },
    kakaoAddressSearch: function(query, apiKey) { return _ipc('kakao-address-search', { query, apiKey }); },
    kakaoCategorySearch: function(category, x, y, radius, page, apiKey) { return _ipc('kakao-category-search', { category, x, y, radius, page, apiKey }); },
    openMedFacility: function(schoolName, eduOffice, hiraKey, emergencyKey, schoolAddr, mode, kakaoRestKey, kakaoJsKey, schoolLat, schoolLng) {
      return _ipc('open-med-facility', { schoolName, eduOffice, hiraKey, emergencyKey, schoolAddr, mode, kakaoRestKey, kakaoJsKey, schoolLat, schoolLng }).then(function(res) {
        /* 인앱 모달 iframe — web-server 모드는 카카오 SDK 도메인 검사 우회를 위해
           /med-facility-list.html (지도 SDK 없는 카드 리스트 모드) 로 라우팅됨. */
        if (res && res.openUrl) _openMedFacilityModal(res.openUrl);
        /* 서버가 명시적 error 응답을 줬을 때 사용자에게 안내.
         *
         * 시나리오: 호스트가 카카오 키를 단 한 번도 입력하지 않은 환경에서 동료(웹 클라) 가 클릭한 경우.
         * 렌더러 측 가드는 웹 모드에서 우회되어 서버까지 도달하므로, 서버 에러를 그대로 삼키면
         * "버튼을 눌렀는데 아무것도 안 일어남" 이 되어 사용자가 혼란스러워한다.
         *
         * 정상 동작(키 정상 등록) 시에는 res.openUrl 만 있고 res.error 가 없으므로 alert 가 뜨지 않는다. */
        else if (res && res.success === false && res.error) {
          try { alert(res.error); } catch(_e){}
        }
        return res;
      });
    },
    moveWindow: function() { return Promise.resolve({ success: true }); },
    getMedCache: function() { return _ipc('get-med-cache'); },
    externalFetchUrlTitle: function(url) { return _ipc('external-fetch-url-title', { url }); },
    externalFetchJson: function(url) { return _ipc('external-fetch-json', { url }); },
    externalFetchNeis: function(url) { return _ipc('external-fetch-neis', { url }); },
    externalFetchPublicSheetCsv: function(spreadsheetId) { return _ipc('external-fetch-public-sheet-csv', { spreadsheetId }); },

    /* ── 키오스크 LAN WebSocket (stub) ── */
    kioskWsStart: function(port) { return _ipc('kiosk-ws-start', { port }); },
    kioskWsStop: function() { return _ipc('kiosk-ws-stop'); },
    kioskWsBroadcast: function(msg) { return _ipc('kiosk-ws-broadcast', { msg }); },
    kioskWsStatus: function() { return _ipc('kiosk-ws-status'); },
    getLocalIP: function() { return _ipc('get-local-ip'); },
    onKioskWsMessage: function(callback) { /* stub — 웹에서는 LAN WS 미지원 */ },

    /* ── 플래너 ── */
    plannerLoadDay: function(date) { return _ipc('planner-load-day', { date }); },
    plannerSaveDay: function(date, data) { return _ipc('planner-save-day', { date, data }); },
    plannerHasDay: function(date) { return _ipc('planner-has-day', { date }); },
    plannerGetLinks: function() { return _ipc('planner-get-links'); },
    plannerSaveLinks: function(items) { return _ipc('planner-save-links', { items }); },
    plannerGetRoutines: function() { return _ipc('planner-get-routines'); },
    plannerSaveRoutines: function(items) { return _ipc('planner-save-routines', { items }); },
    plannerGetGlobalTodos: function() { return _ipc('planner-get-global-todos'); },
    plannerSaveGlobalTodos: function(items) { return _ipc('planner-save-global-todos', { items }); },
    plannerGetDateSettings: function() { return _ipc('planner-get-date-settings'); },
    plannerSaveDateSettings: function(settings) { return _ipc('planner-save-date-settings', { settings }); },
    plannerFetchMonthEvents: function(date) { return _ipc('planner-fetch-month-events', { date }); },
    plannerCreateTodoEvent: function(calendarId, date, summary, colorId) { return _ipc('planner-create-todo-event', { calendarId, date, summary, colorId }); },

    /* ── 설문 워크스페이스 ── */
    surveyGetWorkspace: function() { return _ipc('survey-get-workspace'); },
    surveySaveWorkspace: function(patch) { return _ipc('survey-save-workspace', { patch }); },
    surveySaveDraft: function(draft) { return _ipc('survey-save-draft', { draft }); },
    surveySavePath: function(path) { return _ipc('survey-save-path', { path }); },
    surveyGetDefaultDraftSync: function(schoolName, year) { return _ipc('survey-get-default-draft-sync', { schoolName, year }); },

    /* ── 에디터 상태 ── */
    editorStateGet: function(namespace, slot) { return _ipc('editor-state-get', { namespace, slot }); },
    editorStateSave: function(namespace, slot, data) { return _ipc('editor-state-save', { namespace, slot, data }); },
    editorStateDelete: function(namespace, slot) { return _ipc('editor-state-delete', { namespace, slot }); },

    /* ── 가정통신문 ── */
    newsletterListGet: function() { return _ipc('newsletter-list-get'); },
    newsletterCreate: function(name, data) { return _ipc('newsletter-create', { name, data }); },
    newsletterUpdate: function(id, data) { return _ipc('newsletter-update', { id, data }); },
    newsletterRename: function(id, name) { return _ipc('newsletter-rename', { id, name }); },
    newsletterDuplicate: function(id) { return _ipc('newsletter-duplicate', { id }); },
    newsletterDelete: function(id) { return _ipc('newsletter-delete', { id }); },
    newsletterLoad: function(id) { return _ipc('newsletter-load', { id }); },
    newsletterRenderHtml: function(state, options) { return _ipc('newsletter-render-html', { state, options }); },
    newsletterRenderMergePdfHtml: function(state, options) { return _ipc('newsletter-render-merge-pdf-html', { state, options }); },
    newsletterExportPdf: function(state, options, pdfOptions) {
      return _ipc('newsletter-export-pdf', { state, options, pdfOptions }).then(function(res) {
        if (res && res.useClientSide && res.html) {
          return _htmlToPdf(res.html, pdfOptions);
        }
        return res;
      });
    },

    /* ── PDF/인쇄 ── */
    printToPDF: function(html, options) {
      return _htmlToPdf(html, options);
    },
    printWindowWithSize: function(html, pageSize, margins) {
      var win = window.open('', '_blank');
      if (win) {
        /* 인쇄 대화 닫으면 탭 자동 닫힘 — afterprint 이벤트 + 폴백 타이머 */
        var closeScript = '<script>'
          + 'var _closed=false;'
          + 'function _doClose(){if(_closed)return;_closed=true;try{window.close();}catch(e){}}'
          + 'window.addEventListener("afterprint",_doClose);'
          + 'setTimeout(function(){window.print();},400);'
          + '<\/script>';
        var injected = html.replace(/<\/body>/i, closeScript + '</body>');
        if (injected === html) injected = html + closeScript;
        win.document.write(injected);
        win.document.close();
      }
      return Promise.resolve({ success: true });
    },

    /* ── 파일 시스템 ── */
    getDefaultSavePath: function() { return _ipc('get-default-save-path'); },
    chooseDirectory: function() { return _ipc('choose-directory'); },
    saveFile: function(filePath, data) {
      return _ipc('save-file', { filePath, data }).then(function(res) {
        if (res && res.downloadUrl) { _triggerDownload(res.downloadUrl, filePath.split('/').pop()); }
        return res;
      });
    },
    readFile: function(filePath) { return _ipc('read-file', { filePath }); },
    kioskPreviewInBrowser: function(html) {
      var blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
      return Promise.resolve({ success: true });
    },
    listFiles: function(dirPath, ext) { return _ipc('list-files', { dirPath, ext }); },
    openPath: function(folderPath) { return _ipc('open-path', folderPath); },
    getUserDataPath: function() { return _ipc('get-user-data-path'); },
    ensureSurveyFolder: function(surveyKey) { return _ipc('ensure-survey-folder', surveyKey); },

    /* ── SQLite 백업/복원 ── */
    dbBackupSqlite: function() {
      return _ipc('db-backup-sqlite').then(function(res) {
        if (res && res.downloadUrl) { _triggerDownload(res.downloadUrl, res.fileName || 'backup.sqlite3'); }
        return res;
      });
    },
    dbRestoreSqlite: function() {
      return _pickAndUpload('.sqlite3,.db,.json').then(function(uploadRes) {
        if (!uploadRes || !uploadRes.data) return { success: true, data: null };
        return _ipc('import-existing-db', { filePath: uploadRes.data });
      });
    },

    /* 커스텀 설정 백업과 반영 (학교 이동용) — 웹 변형은 비활성. */
    customBackupListKeys: function() { return _ipc('custom-backup-list-keys'); },
    customBackupExport: function(localStorageData) { return _ipc('custom-backup-export', { localStorageData }); },
    customBackupImport: function() { return _ipc('custom-backup-import'); },

    /* ── JSON 파일 ── */
    jsonSave: function(key, data) { return _ipc('json-save', { key, data }); },
    jsonLoad: function(key, year) { return _ipc('json-load', { key, year }); },
    jsonSaveCommon: function(key, data) { return _ipc('json-save-common', { key, data }); },
    jsonLoadCommon: function(key) { return _ipc('json-load-common', { key }); },
    jsonFlush: function(items) { return _ipc('json-flush', { items }); },
    /* 오늘의 메모 (today_memos, DB v4) — 2026-06-10 */
    todayMemoGetAll: function() { return _ipc('today-memo-get-all', {}); },
    todayMemoSet: function(date, cells) { return _ipc('today-memo-set', { date, cells }); },
    /* 양식 xlsx 의 약품-증상 매핑 (사용자 요청 2026-05-27) */
    templatesLoadMedSymMatching: function() { return _ipc('templates-load-med-sym-matching', {}); },

    /* ── DB key-value ── */
    dbGet: function(scope, key, year) { return _ipc('db-get', { scope, key, year }); },
    dbSet: function(scope, key, value, year) { return _ipc('db-set', { scope, key, value, year }); },
    dbBatchSet: function(items) { return _ipc('db-batch-set', { items }); },
    dbInfo: function() { return _ipc('db-info'); },
    dbFactoryReset: function() { return _ipc('db-factory-reset'); },
    dbFactoryResetHealthOnly: function() { return _ipc('db-factory-reset-health-only'); },
    dbExportBackup: function() { return _ipc('db-export-backup'); },
    dbImportBackup: function(backup) { return _ipc('db-import-backup', { backup }); },

    /* ── 캡처/클립보드 ── */
    captureElement: function(opts) {
      /* 클라이언트 사이드: html2canvas */
      if (opts && opts.html && typeof html2canvas !== 'undefined') {
        return new Promise(function(resolve) {
          var iframe = document.createElement('iframe');
          iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:'+(opts.width||800)+'px;height:'+(opts.height||600)+'px;border:none';
          document.body.appendChild(iframe);
          iframe.contentDocument.open(); iframe.contentDocument.write(opts.html); iframe.contentDocument.close();
          setTimeout(function() {
            html2canvas(iframe.contentDocument.body, { scale: 2, useCORS: true }).then(function(canvas) {
              canvas.toBlob(function(blob) {
                try { navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); } catch(e) {}
                document.body.removeChild(iframe);
                resolve({ success: true });
              }, 'image/png');
            }).catch(function() { document.body.removeChild(iframe); resolve({ success: true }); });
          }, 300);
        });
      }
      return Promise.resolve({ success: true });
    },
    captureToPng: function(opts) {
      if (opts && opts.html && typeof html2canvas !== 'undefined') {
        return new Promise(function(resolve) {
          var iframe = document.createElement('iframe');
          iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:'+(opts.width||800)+'px;border:none';
          document.body.appendChild(iframe);
          iframe.contentDocument.open(); iframe.contentDocument.write(opts.html); iframe.contentDocument.close();
          setTimeout(function() {
            html2canvas(iframe.contentDocument.body, { scale: 2, useCORS: true }).then(function(canvas) {
              var link = document.createElement('a');
              link.download = opts.fileName || 'capture.png';
              link.href = canvas.toDataURL('image/png');
              link.click();
              document.body.removeChild(iframe);
              resolve({ success: true });
            }).catch(function() { document.body.removeChild(iframe); resolve({ success: true }); });
          }, 300);
        });
      }
      return Promise.resolve({ success: true });
    },
    clipboardWriteHtml: function(html, text) {
      /* 웹 Clipboard API 사용 */
      if (navigator.clipboard && navigator.clipboard.write) {
        try {
          var blob = new Blob([html], { type: 'text/html' });
          var item = new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([text||''], { type: 'text/plain' }) });
          navigator.clipboard.write([item]);
        } catch(e) { console.warn('clipboard 실패:', e); }
      }
      return Promise.resolve({ success: true });
    },

    /* ── 키오스크 릴레이 ── */
    kioskCreateChannel: function(relayUrl, schoolName, educationOffice) { return _ipc('kiosk-create-channel', { relayUrl, schoolName, educationOffice }); },
    kioskPushConfig: function(relayUrl, channelId, authToken, config) { return _ipc('kiosk-push-config', { relayUrl, channelId, authToken, config }); },
    kioskUploadHtml: function(relayUrl, channelId, authToken, html) { return _ipc('kiosk-upload-html', { relayUrl, channelId, authToken, html }); },
    kioskPushAccessKey: function(relayUrl, channelId, authToken, accessKey) { return _ipc('kiosk-push-access-key', { relayUrl, channelId, authToken, accessKey }); },
    kioskTestRelay: function(relayUrl, channelId, nurseToken) { return _ipc('kiosk-test-relay', { relayUrl, channelId, nurseToken }); },
    kioskGetReceptions: function(relayUrl, channelId, nurseToken) { return _ipc('kiosk-get-receptions', { relayUrl, channelId, nurseToken }); },
    kioskCompleteReception: function(relayUrl, channelId, nurseToken, receptionId) { return _ipc('kiosk-complete-reception', { relayUrl, channelId, nurseToken, receptionId }); },

    /* ── 사용자 관리 ── */
    userGetAll: function() { return _ipc('user-get-all'); },
    userGetActive: function() { return _ipc('user-get-active'); },
    userGetById: function(id) { return _ipc('user-get-by-id', { id }); },
    userCreate: function(data) { return _ipc('user-create', data); },
    userUpdate: function(id, data) { return _ipc('user-update', { id, data }); },
    userDelete: function(id) { return _ipc('user-delete', { id }); },
    userSetCurrent: function(userId) { return _ipc('user-set-current', { userId }); },
    userGetCurrent: function() { return _ipc('user-get-current'); },

    /* ── 과거 데이터 이관 ── */
    chooseSqliteFile: function() {
      return _pickAndUpload('.sqlite3,.db').then(function(res) {
        return { success: true, data: res ? res.data : null };
      });
    },
    importExistingDb: function(filePath) {
      if (filePath) return _ipc('import-existing-db', { filePath: filePath });
      return _pickAndUpload('.sqlite3,.db').then(function(res) {
        if (!res || !res.data) return { success: true, data: null };
        return _ipc('import-existing-db', { filePath: res.data });
      });
    },
    importPastHistoryXlsx: function(filePath) {
      if (filePath) return _ipc('import-past-history-xlsx', { filePath: filePath });
      return _pickAndUpload('.xlsx,.xls').then(function(res) {
        if (!res || !res.data) return { success: true, data: null };
        return _ipc('import-past-history-xlsx', { filePath: res.data });
      });
    },
    pastHistorySearch: function(params) { return _ipc('past-history-search', { params }); },
    pastHistoryStats: function() { return _ipc('past-history-stats'); },
    pastHistoryExists: function() { return _ipc('past-history-exists'); },
    pastHistoryAutoMatch: function(currentYear, schoolLevel) { return _ipc('past-history-auto-match', { currentYear, schoolLevel }); },
    pastHistoryResolveAmbiguous: function(recordIds, studentId) { return _ipc('past-history-resolve-ambiguous', { recordIds, studentId }); },
    pastHistoryGetAmbiguous: function() { return _ipc('past-history-get-ambiguous'); },
    pastHistoryApply: function() { return _ipc('past-history-apply'); },
    pastHistoryMigratePlaceholders: function() { return _ipc('past-history-migrate-placeholders'); },
    pastHistoryDeleteImported: function() { return _ipc('past-history-delete-imported'); },
    pastHistoryClearStaging: function() { return _ipc('past-history-clear-staging'); },
    pastHistoryRevertJustInserted: function(ids) { return _ipc('past-history-revert-just-inserted', { ids }); },
    pastHistoryListPlaceholders: function() { return _ipc('past-history-list-placeholders'); },
    pastHistoryMatchPlaceholder: function(recordId, personUid) { return _ipc('past-history-match-placeholder', { recordId, personUid }); },
    pastHistoryDeletePlaceholder: function(recordId) { return _ipc('past-history-delete-placeholder', { recordId }); },
    pastHistoryDeleteStagingRow: function(stagingId) { return _ipc('past-history-delete-staging-row', { stagingId }); },
    pastHistoryRevertMatched: function() { return _ipc('past-history-revert-matched'); },
    pastHistoryPlaceholderAsLeaver: function(recordId) { return _ipc('past-history-placeholder-as-leaver', { recordId }); },
    pastHistoryStagingRowAsLeaver: function(stagingId) { return _ipc('past-history-staging-row-as-leaver', { stagingId }); },
    pastHistoryImportedCount: function() { return _ipc('past-history-imported-count'); },
    pastHistoryMatchStats: function() { return _ipc('past-history-match-stats'); },
    pastHistoryGetByDate: function(date) { return _ipc('past-history-get-by-date', { date }); },

    /* ── 잠복결핵 ── */
    tbTestAdd: function(data) { return _ipc('tb-test-add', data); },
    tbTestImportXlsx: function(filePath) {
      if (filePath) return _ipc('tb-test-import-xlsx', { filePath: filePath });
      return _pickAndUpload('.xlsx,.xls').then(function(res) {
        if (!res || !res.data) return { success: true, data: null };
        return _ipc('tb-test-import-xlsx', { filePath: res.data });
      });
    },
    tbTestSearch: function(params) { return _ipc('tb-test-search', params); },
    tbTestGetAll: function() { return _ipc('tb-test-get-all'); },
    tbTestStats: function() { return _ipc('tb-test-stats'); },
    tbTestDelete: function(id) { return _ipc('tb-test-delete', { id }); },

    /* ── 앱 설정 ── */
    appConfigIsFirstRun: function() { return _ipc('app-config-is-first-run'); },
    appConfigSetup: function(opts) { return _ipc('app-config-setup', opts); },
    appConfigGetSchool: function() { return _ipc('app-config-get-school'); },
    appConfigUpdateSchool: function(school, teacher) { return _ipc('app-config-update-school', { school, teacher }); },
    appConfigGetAll: function() { return _ipc('app-config-get-all'); },
    foldersGetPaths: function() { return _ipc('folders-get-paths'); },

    /* ── 학생 ── */
    studentsGetAll: function(year) { return _ipc('students-get-all', { year }); },
    studentsGetAllIncludeLeft: function(year) { return _ipc('students-get-all-include-left', { year }); },
    studentsGetAllHistorical: function() { return _ipc('students-get-all-historical'); },
    studentsFindNameDuplicates: function(year) { return _ipc('students-find-name-duplicates', { year }); },
    studentsResolveNameDuplicate: function(currentUid, prevUid) { return _ipc('students-resolve-name-duplicate', { currentUid, prevUid }); },
    studentsSaveAll: function(students, year) { return _ipc('students-save-all', { students, year }); },
    studentsUpsert: function(student, year) { return _ipc('students-upsert', { student, year }); },
    studentsDelete: function(uid) { return _ipc('students-delete', { uid }); },
    studentsSetEnrolled: function(uid, year, enrolled) { return _ipc('students-set-enrolled', { uid, year, enrolled }); },
    studentsDeleteAllYear: function(year) { return _ipc('students-delete-all-year', { year }); },
    studentsImportBatch: function(students, year, replaceAll) { return _ipc('students-import-batch', { students, year, replaceAll }); },
    studentsGetCare: function(year) { return _ipc('students-get-care', { year }); },
    studentsGetHistory: function(uid) { return _ipc('students-get-history', { uid }); },
    studentsUpdateMemo: function(uid, memoJson) { return _ipc('students-update-memo', { uid, memoJson }); },
    studentsUpdateMedConsent: function(uid, consent) { return _ipc('students-update-med-consent', { uid, consent }); },
    studentsDedup: function(year) { return _ipc('students-dedup', { year }); },
    studentsGradeSummary: function(year) { return _ipc('students-grade-summary', { year }); },
    studentsClassGroups: function(year, grades) { return _ipc('students-class-groups', { year, grades }); },

    /* ── people alias ── */
    peopleGetAll: function(year) { return _ipc('students-get-all', { year }); },
    peopleGetAllIncludeLeft: function(year) { return _ipc('students-get-all-include-left', { year }); },
    peopleSaveAll: function(people, year) {
      /* 학생/교직원 분리 저장 — 예전엔 모두 students 테이블에 잘못 저장되어 교직원이 "0학년 0반" 학생으로 보이는 버그 발생 */
      var students = (people||[]).filter(function(p){return p && p.type !== 'staff';});
      var staffList = (people||[]).filter(function(p){return p && p.type === 'staff';});
      return Promise.all([
        _ipc('students-save-all', { students: students, year: year }),
        staffList.length ? _ipc('staff-save-all', { staffList: staffList, year: year }) : Promise.resolve({ success: true })
      ]).then(function(r){ return { success: r.every(function(x){return x && x.success !== false;}), students: r[0], staff: r[1] }; });
    },
    peopleUpsert: function(person, year) { return _ipc('students-upsert', { student: person, year }); },
    peopleDelete: function(uid) { return _ipc('students-delete', { uid }); },
    peopleSetEnrolled: function(uid, year, enrolled) { return _ipc('students-set-enrolled', { uid, year, enrolled }); },
    peopleImportBatch: function(people, year, replaceAll) { return _ipc('students-import-batch', { students: people, year, replaceAll }); },
    peopleGetCare: function(year) { return _ipc('students-get-care', { year }); },
    peopleGetHistory: function(uid) { return _ipc('students-get-history', { uid }); },
    peopleDedup: function(year) { return _ipc('students-dedup', { year }); },
    peopleGradeSummary: function(year) { return _ipc('students-grade-summary', { year }); },
    peopleClassGroups: function(year, grades) { return _ipc('students-class-groups', { year, grades }); },

    /* ── 교직원 ── */
    staffGetAll: function(year) { return _ipc('staff-get-all', { year }); },
    staffGetAllIncludeInactive: function(year) { return _ipc('staff-get-all-include-inactive', { year }); },
    staffGetAllHistorical: function() { return _ipc('staff-get-all-historical'); },
    staffFindNameDuplicates: function(year) { return _ipc('staff-find-name-duplicates', { year }); },
    staffResolveNameDuplicate: function(currentUid, prevUid) { return _ipc('staff-resolve-name-duplicate', { currentUid, prevUid }); },
    staffUpsert: function(staff, year) { return _ipc('staff-upsert', { staff, year }); },
    staffSaveAll: function(staffList, year) { return _ipc('staff-save-all', { staffList, year }); },
    staffDelete: function(uid) { return _ipc('staff-delete', { uid }); },
    staffDeactivate: function(uid) { return _ipc('staff-deactivate', { uid }); },
    staffDeleteAllYear: function(year) { return _ipc('staff-delete-all-year', { year }); },

    /* ── 보건일지 레코드 ── */
    recordsGetDaily: function(year) { return _ipc('records-get-daily', { year }); },
    recordsGetDailyByDate: function(year, date) { return _ipc('records-get-daily-by-date', { year, date }); },
    recordsGetDailyByPerson: function(personUid) { return _ipc('records-get-daily-by-person', { personUid }); },
    recordsDailyInsert: function(record) { return _ipc('records-daily-insert', { record }); },
    recordsDailyUpdate: function(record) { return _ipc('records-daily-update', { record }); },
    recordsDailyDelete: function(id) { return _ipc('records-daily-delete', { id }); },
    recordsDailyFixNurse: function(oldName, newName) { return _ipc('records-daily-fix-nurse', { oldName, newName }); },
    recordsDailyDeleteYear: function(year) { return _ipc('records-daily-delete-year', { year }); },
    recordsDailyYears: function() { return _ipc('records-daily-years'); },
    recordsSaveDaily: function(year, records) { return _ipc('records-save-daily', { year, records }); },
    recordsGetEmergency: function(year) { return _ipc('records-get-emergency', { year }); },
    recordsEmergencyInsert: function(record) { return _ipc('records-emergency-insert', { record }); },
    recordsEmergencyUpdate: function(record) { return _ipc('records-emergency-update', { record }); },
    recordsEmergencyDelete: function(id) { return _ipc('records-emergency-delete', { id }); },
    recordsSaveEmergency: function(year, records) { return _ipc('records-save-emergency', { year, records }); },
    recordsGetInfection: function(year) { return _ipc('records-get-infection', { year }); },
    recordsInfectionInsert: function(record) { return _ipc('records-infection-insert', { record }); },
    recordsInfectionUpdate: function(record) { return _ipc('records-infection-update', { record }); },
    recordsInfectionDelete: function(id) { return _ipc('records-infection-delete', { id }); },
    recordsSaveInfection: function(year, records) { return _ipc('records-save-infection', { year, records }); },
    recordsDailyByDateRange: function(from, to) { return _ipc('records-daily-by-date-range', { from, to }); },
    recordsNurseStats: function(from, to) { return _ipc('records-nurse-stats', { from, to }); },
    recordsCountBeforeDate: function(cutoffDate) { return _ipc('records-count-before-date', { cutoffDate }); },
    recordsDeleteBeforeDate: function(cutoffDate) { return _ipc('records-delete-before-date', { cutoffDate }); },
    recordsCountByYear: function(year) { return _ipc('records-count-by-year', { year }); },
    recordsDeleteByYear: function(year) { return _ipc('records-delete-by-year', { year }); },
    recordsGetInfectionNotes: function(year) { return _ipc('records-get-infection-notes', { year }); },
    recordsSaveInfectionNotes: function(year, notes) { return _ipc('records-save-infection-notes', { year, notes }); },
    recordsFlushAll: function(year, payload) { return _ipc('records-flush-all', { year, payload }); },

    /* ── 설정 ── */
    settingsGet: function(key, defaultValue) { return _ipc('settings-get', { key, defaultValue }); },
    settingsSet: function(key, value) { return _ipc('settings-set', { key, value }); },
    settingsGetMultiple: function(keys) { return _ipc('settings-get-multiple', { keys }); },
    settingsSetMultiple: function(entries) { return _ipc('settings-set-multiple', { entries }); },

    /* ── 의료 데이터 ── */
    medicalGetDeptMapping: function() { return _ipc('medical-get-dept-mapping'); },
    medicalSetDeptMapping: function(text) { return _ipc('medical-set-dept-mapping', { text }); },
    medicalGetDeptForSymptom: function(symptom) { return _ipc('medical-get-dept-for-symptom', { symptom }); },
    medicalGetDeptForSymptoms: function(symptoms) { return _ipc('medical-get-dept-for-symptoms', { symptoms }); },
    medicalGetTreatmentMap: function() { return _ipc('medical-get-treatment-map'); },
    medicalSetTreatmentMap: function(map) { return _ipc('medical-set-treatment-map', { map }); },
    medicalGetMedicationMap: function() { return _ipc('medical-get-medication-map'); },
    medicalSetMedicationMap: function(map) { return _ipc('medical-set-medication-map', { map }); },
    medicalGetSymMeds: function() { return _ipc('medical-get-sym-meds'); },
    medicalSetSymMeds: function(data) { return _ipc('medical-set-sym-meds', { data }); },
    medicalGetSymOintments: function() { return _ipc('medical-get-sym-ointments'); },
    medicalSetSymOintments: function(data) { return _ipc('medical-set-sym-ointments', { data }); },
    medicalGetSymPatches: function() { return _ipc('medical-get-sym-patches'); },
    medicalSetSymPatches: function(data) { return _ipc('medical-set-sym-patches', { data }); },
    medicalGetVitalThresholds: function() { return _ipc('medical-get-vital-thresholds'); },
    medicalSetVitalThresholds: function(thresholds) { return _ipc('medical-set-vital-thresholds', { thresholds }); },
    medicalComputeBmi: function(entries) { return _ipc('medical-compute-bmi', { entries }); },

    /* ── 설문 시스템 ── */
    surveyFormList: function() { return _ipc('survey-form-list'); },
    surveyFormGet: function(formId) { return _ipc('survey-form-get', { formId }); },
    surveyFormSave: function(form, content) { return _ipc('survey-form-save', { form, content }); },
    surveyFormCopy: function(sourceFormId, newId, newTitle) { return _ipc('survey-form-copy', { sourceFormId, newId, newTitle }); },
    surveyFormDelete: function(formId) { return _ipc('survey-form-delete', { formId }); },
    surveyResponseSave: function(response, content) { return _ipc('survey-response-save', { response, content }); },
    surveyResponseImportBatch: function(year, formId, responses) { return _ipc('survey-response-import-batch', { year, formId, responses }); },
    surveyResponseGetByStudent: function(persistentId) { return _ipc('survey-response-get-by-student', { persistentId }); },
    surveyResponseGetByForm: function(year, formId) { return _ipc('survey-response-get-by-form', { year, formId }); },
    surveyResponseGetAllWithData: function(year, formId) { return _ipc('survey-response-get-all-with-data', { year, formId }); },
    surveyResponseGetData: function(id) { return _ipc('survey-response-get-data', { id }); },
    surveyResponseDelete: function(id) { return _ipc('survey-response-delete', { id }); },
    surveyResponseStats: function(year, formId) { return _ipc('survey-response-stats', { year, formId }); },
    surveyResponseMissingMessage: function(year, formId, grade, cls, position, name) { return _ipc('survey-response-missing-message', { year, formId, grade, cls, position, name }); },
    surveyResponseOldCount: function(currentSchoolYear) { return _ipc('survey-response-old-count', { currentSchoolYear }); },
    surveyResponseDeleteOld: function(currentSchoolYear) { return _ipc('survey-response-delete-old', { currentSchoolYear }); },

    /* ── 통계 ── */
    statsGetSummary: function(opts) { return _ipc('stats-get-summary', opts || {}); },
    statsGetDept: function(opts) { return _ipc('stats-get-dept', opts || {}); },
    statsGetSymptoms: function(opts) { return _ipc('stats-get-symptoms', opts || {}); },
    statsGetHourly: function(opts) { return _ipc('stats-get-hourly', opts || {}); },
    statsGetDailyCounts: function(opts) { return _ipc('stats-get-daily-counts', opts || {}); },
    statsDbDeptGrade: function(year, from, to) { return _ipc('stats-db-dept-grade', { year, from, to }); },
    statsDbDeptGradeYoY: function(year, from, to) { return _ipc('stats-db-dept-grade-yoy', { year, from, to }); },
    statsDbSummary: function(year, from, to) { return _ipc('stats-db-summary', { year, from, to }); },
    statsDbDeptCats: function() { return _ipc('stats-db-dept-cats'); },
    statsDbTreatment: function(year, from, to) { return _ipc('stats-db-treatment', { year, from, to }); },
    statsDbHourlyHeatmap: function(year, from, to) { return _ipc('stats-db-hourly-heatmap', { year, from, to }); },
    statsDbClassDistribution: function(year, from, to) { return _ipc('stats-db-class-distribution', { year, from, to }); },
    statsDbRepeatVisitors: function(year, from, to, minVisits) { return _ipc('stats-db-repeat-visitors', { year, from, to, minVisits }); },
    statsDbGenderSymptoms: function(year, from, to) { return _ipc('stats-db-gender-symptoms', { year, from, to }); },
    statsDbQuick: function(year, from, to) { return _ipc('stats-db-quick', { year, from, to }); },
    statsDbAcademicRange: function(period, year, options) { return _ipc('stats-db-academic-range', { period, year, options }); },
    statsDbSubTabs: function(period, baseDate) { return _ipc('stats-db-sub-tabs', { period, baseDate }); },
    statsDbHolidays: function() { return _ipc('stats-db-holidays'); },
    statsDbTrend: function(opts) { return _ipc('stats-db-trend', opts); },

    /* ── 앱 라이프사이클 (브라우저에선 의미 없음 — 호스트 IPC 와 시그니처만 동일) ── */
    appQuit: function() { return _ipc('app-quit'); },
    appRelaunch: function() { return _ipc('app-relaunch'); },
    confirmQuitAfterUpdate: function() { return _ipc('confirm-quit-after-update'); },

    /* ── 자동 업데이트 (Electron 전용 — 웹에선 안전 스텁) ──
       updaterGetVersion 만 실제 version 을 반환 (헤더 배지·로드맵·버전 탭 표시). */
    updaterCheckNow: function() { return _ipc('updater-check-now'); },
    updaterQuitAndInstall: function() { return _ipc('updater-quit-and-install'); },
    updaterIsReady: function() { return _ipc('updater-is-ready'); },
    updaterGetVersion: function() { return _ipc('updater-get-version'); },

    /* ── 번들 API 키 — 빌드 시 임베드된 기본값 ── */
    getBundledApiKeys: function() { return _ipc('get-bundled-api-keys'); },

    /* ── 파일 시스템 추가 ── */
    getFileSize: function(filePath) { return _ipc('get-file-size', filePath); },

    /* ── 외부 API 추가 ── */
    externalFetchAirkoreaStationInfo: function(serviceKey, stationName) { return _ipc('external-fetch-airkorea-station-info', { serviceKey, stationName }); },

    /* ── 의료기관 반경 캐싱 (진행률 콜백은 REST 환경에서 미지원 — 결과만 반환) ── */
    medfacBulkFetch: function(serviceKey, emergencyKey, params) { return _ipc('medfac-bulk-fetch', { serviceKey, emergencyKey, params }); },
    medfacLoadCache: function() { return _ipc('medfac-load-cache'); },
    medfacClearCache: function() { return _ipc('medfac-clear-cache'); },
    medfacOnProgress: function(_callback) { /* stub — 웹에선 진행률 이벤트 미전송 */ },

    /* ── Electron IPC 이벤트 구독 — 웹에선 호스트→클라 push 가 없으므로 no-op ──
       호출부는 typeof === 'function' 가드로 안전하지만, 일관성 위해 빈 함수 노출. */
    onShowUpdateOverlay: function() {},
    onUpdaterEvent: function() {},
    onWebServerStarted: function() { return function(){}; },
    onWebServerStopped: function() { return function(){}; },

    /* ── 웹 서버 제어 (Electron 메인에서만 의미 있음 — 웹에선 안전 스텁) ── */
    webServerStart: function() { return Promise.resolve({ success: false, error: 'web mode' }); },
    webServerStop: function() { return Promise.resolve({ success: false, error: 'web mode' }); },
    webServerStatus: function() { return Promise.resolve({ running: true, port: location.port || 3000 }); },

    /* ── File.path 대체 — 웹 모드에선 webUtils 없음 → 빈 문자열 반환 ──
       (브라우저에서는 file.path 자체가 존재하지 않음. 호출부는 폴백 경로 별도 존재.) */
    getPathForFile: function(_file) { return ''; },

    /* ── 사용자 배경 이미지 ──
       buffer 는 Uint8Array — JSON.stringify 시 일반 객체로 직렬화되지만 서버측이 복원 처리. */
    userBgSave: function(buffer, ext) {
      var arr;
      if (buffer instanceof Uint8Array || buffer instanceof ArrayBuffer) {
        arr = Array.from(new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer));
      } else { arr = buffer; }
      return _ipc('user-bg-save', { buffer: arr, ext: ext });
    },
    userBgDelete: function() { return _ipc('user-bg-delete'); },
    userBgGetPath: function() { return _ipc('user-bg-get-path'); },
    userBgGetDataUrl: function() { return _ipc('user-bg-get-data-url'); },

    /* ── 보건일지 연도별 요약 (보존기간 정리 탭) ── */
    recordsYearSummary: function() { return _ipc('records-year-summary'); },

    /* ── 보존기간 만료 정리 ── */
    retentionFindOrphanStudents: function(cutoffYears) { return _ipc('retention-find-orphan-students', { cutoffYears }); },
    retentionBulkDeleteOrphanStudents: function(uids) { return _ipc('retention-bulk-delete-orphan-students', { uids }); },
    retentionFindOrphanStaff: function(cutoffYears) { return _ipc('retention-find-orphan-staff', { cutoffYears }); },
    retentionBulkDeleteOrphanStaff: function(uids) { return _ipc('retention-bulk-delete-orphan-staff', { uids }); },

    /* ── 과거 기록 미매칭 처리 ── */
    pastHistoryGetUnmatched: function() { return _ipc('past-history-get-unmatched'); },
    pastHistoryResolveUnmatched: function(recordIds, studentId) { return _ipc('past-history-resolve-unmatched', { recordIds, studentId }); },

    /* ── 과거 기록 xlsx buffer 업로드 ── */
    importPastHistoryXlsxBuffer: function(bytes, filename) {
      var arr;
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        arr = Array.from(new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes));
      } else { arr = bytes; }
      return _ipc('import-past-history-xlsx-buffer', { bytes: arr, filename: filename });
    },

    /* ── 학생 일괄 등록 + 동명이인 보류 ── */
    studentsImportWithPending: function(students, year) { return _ipc('students-import-with-pending', { students, year }); },
    studentsPendingAmbiguousList: function(year) { return _ipc('students-pending-ambiguous-list', { year }); },
    studentsPendingAmbiguousCount: function(year) { return _ipc('students-pending-ambiguous-count', { year }); },
    studentsPendingAmbiguousResolve: function(year, excelRow, chosenUid) { return _ipc('students-pending-ambiguous-resolve', { year, excelRow, chosenUid }); },

    /* ── 엑셀 빌더 (exceljs/fflate 기반 — 웹에서도 순수 Node 코드로 동작) ──
       반환 bytes 는 배열로 직렬화되어 옴 → 렌더러에서 new Uint8Array(arr) 로 복원해 사용. */
    xlsxBuildDiary: function(payload) { return _ipc('xlsx-build-diary', payload); },
    xlsxBuildDeptStats: function(payload) { return _ipc('xlsx-build-dept-stats', payload); },
    xlsxInjectFreeze: function(bytes, ySplit) {
      var arr;
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        arr = Array.from(new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes));
      } else { arr = bytes; }
      return _ipc('xlsx-inject-freeze', { bytes: arr, ySplit });
    },
    xlsxInjectStyle: function(bytes, options) {
      var arr;
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        arr = Array.from(new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes));
      } else { arr = bytes; }
      return _ipc('xlsx-inject-style', { bytes: arr, options });
    },
  };

  /* 웹 브라우저 환경 표시 */
  window.__isWebBrowser = true;
  console.log('[WEB] web-api-bridge 로드됨 — electronAPI 대체 완료');
})();
