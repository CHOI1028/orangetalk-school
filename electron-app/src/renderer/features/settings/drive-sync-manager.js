/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { escHtml, closeModalGracefully, showLoading, hideLoading } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { appData } from '../../core/app-data-bridge.js';
import { S } from '../../core/app-state.js';
import { _sheetsAccountHtml, _sheetsAccountInit, _driveFolderNew } from '../dashboard/dashboard-view.js';
  function DriveSyncManager(api){
    this.api = api || null;
    this.storageKey = 'drive_sync_config';
  }

  DriveSyncManager.prototype.getConfig = function(){
    try {
      /* DB에서 먼저 로드 시도, 없으면 localStorage 폴백 */
      if(appData && appData.canUseBackend()){
        const dbData = appData.getCommonSync('drive_sync_config');
        if(dbData !== null && dbData !== undefined) return dbData;
      }
      return JSON.parse(localStorage.getItem(this.storageKey) || '{}') || {};
    } catch(e){ return {}; }
  };

  DriveSyncManager.prototype.saveConfig = function(cfg){
    localStorage.setItem(this.storageKey, JSON.stringify(cfg || {}));
    if(appData && appData.canUseBackend()){
      appData.saveCommon('drive_sync_config', cfg || {}, { legacyJsonKey:'drive_sync_config' }).catch(function(err){ console.error('[DB] drive_sync_config 저장 실패:', err); });
    }
  };

  DriveSyncManager.prototype.buildFileName = function(date){
    const now = date || new Date();
    return '보건일지_백업_' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '.json';
  };

  DriveSyncManager.prototype.browse = function(){
    const ex=document.getElementById('driveFolderPicker');if(ex)closeModalGracefully(ex);
    const pk=document.createElement('div');pk.id='driveFolderPicker';
    pk.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9700;display:flex;align-items:center;justify-content:center';
    pk.innerHTML='<div style="background:var(--card);border-radius:12px;width:400px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.3);overflow:hidden"><div style="padding:12px 16px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">📂 동기화 폴더 선택</div><div id="driveFolderList" style="padding:12px 16px;max-height:300px;overflow-y:auto;min-height:60px"><div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">불러오는 중...</div></div><div style="padding:10px 16px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;justify-content:space-between"><button data-action="drive-folder-new" style="padding:5px 12px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">+ 새 폴더</button><button data-action="drive-select-folder" style="padding:5px 14px;font-size:10px;font-weight:700;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">이 폴더 선택</button></div></div>';
    pk.addEventListener('click',function(e){if(e.target===pk)_closeDrivePicker();});
    const newFolderBtn=pk.querySelector('[data-action="drive-folder-new"]');
    if(newFolderBtn)newFolderBtn.addEventListener('click',function(){_driveFolderNew();});
    const selectFolderBtn=pk.querySelector('[data-action="drive-select-folder"]');
    if(selectFolderBtn)selectFolderBtn.addEventListener('click',function(){driveSyncManager.selectCurrentFolder();});
    document.body.appendChild(pk);
    S._driveBrowseStack=[];
    S._driveBrowseCurrent=null;
    S._driveSyncSelectMode=true;
    _driveFolderLoad(null);
  };

  DriveSyncManager.prototype.selectCurrentFolder = function(){
    const cfg = this.getConfig();
    cfg.folderId = S._driveBrowseCurrent || null;
    const stack = S._driveBrowseStack || [];
    cfg.folderName = stack.length ? stack[stack.length-1].name : '내 드라이브 (루트)';
    this.saveConfig(cfg);
    const fp=document.getElementById('driveSyncFolderPath');
    if(fp)fp.textContent=cfg.folderId?'📂 '+cfg.folderName:'내 드라이브 (루트)';
    _closeDrivePicker();
    S._driveSyncSelectMode=false;
    bus.emit('toast:show', {text: '동기화 폴더: ' + cfg.folderName});
  };

  DriveSyncManager.prototype.reset = function(){
    localStorage.removeItem(this.storageKey);
    if(appData && appData.canUseBackend()){
      appData.saveCommon('drive_sync_config', {}, { legacyJsonKey:'drive_sync_config' }).catch(function(err){ console.error('[DB] drive_sync_config 초기화 실패:', err); });
    }
    const fp=document.getElementById('driveSyncFolderPath');
    if(fp)fp.textContent='내 드라이브 (루트)';
    bus.emit('toast:show', {text: '동기화 폴더 초기화됨'});
  };

  /* 계정 확인 후 확인 팝업을 띄우는 공통 헬퍼 */
  DriveSyncManager.prototype._showConfirmPopup = function(mode, onConfirm){
    const self = this;
    const cfg = this.getConfig();
    const isUpload = mode === 'upload';
    const title = isUpload ? '☁️ Google Drive에 업로드' : '☁️ Google Drive에서 불러오기';
    const btnLabel = isUpload ? '업로드' : '불러오기';
    const btnColor = isUpload ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : 'linear-gradient(135deg,#34a853,#1e8e3e)';
    const desc = isUpload
      ? '현재 보건일지 데이터를 Google Drive에 백업합니다.'
      : 'Google Drive에서 백업 파일을 불러와 현재 데이터를 복원합니다. 기존 데이터가 덮어씌워집니다.';
    const folderName = cfg.folderName || '내 드라이브 (루트)';

    const ex = document.getElementById('driveSyncConfirmOverlay'); if(ex)closeModalGracefully(ex);
    const ov = document.createElement('div');
    ov.className = 'modal-overlay show';
    ov.id = 'driveSyncConfirmOverlay';
    ov.style.cssText = 'background:rgba(0,0,0,0.35)';

    let html = '<div class="modal-content" style="width:440px;max-width:94vw;padding:0">';
    /* 헤더 */
    html += '<div style="background:var(--popup-head);padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
    html += '<div style="font-size:14px;font-weight:800;color:var(--t1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4285f4" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12s4.48 10 10 10 10-4.48 10-10z"/><path d="M12 8v4l3 3"/></svg>'+title+'</div></div>';
    /* 본문 */
    html += '<div style="padding:18px">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
    html += '<div style="width:40px;height:40px;border-radius:8px;background:'+btnColor+';display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M3 15v4a2 2 0 002 2h14a2 2 0 002-2v-4"/>'+(isUpload?'<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'  :'<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')+'</svg></div>';
    html += '<div><div style="font-size:13px;font-weight:700;color:var(--t1)">'+escHtml(title)+'</div>';
    html += '<div style="font-size:10px;color:var(--t3)">'+escHtml(desc)+'</div></div></div>';
    /* 파일 정보 */
    html += '<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11px;color:var(--t2);margin-bottom:0">';
    html += '<div style="margin-bottom:4px"><strong>저장 폴더:</strong> 📂 '+escHtml(folderName)+'</div>';
    html += '<div><strong>파일명 형식:</strong> 보건일지_백업_YYYYMMDD.json</div>';
    html += '</div>';
    /* 계정 영역 — _sheetsAccountHtml 재사용 */
    html += _sheetsAccountHtml('driveSyncConfirmAcct');
    html += '</div>';
    /* 하단 버튼 */
    html += '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
    html += '<button data-action="drive-confirm-cancel" style="padding:7px 16px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>';
    html += '<button id="driveSyncConfirmBtn" style="padding:7px 22px;font-size:11px;font-weight:700;background:'+btnColor+';color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px">';
    html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>'+btnLabel+'</button>';
    html += '</div></div>';

    ov.innerHTML = html;
    ov.addEventListener('click', function(e){ if(e.target === ov) closeModalGracefully(ov); });
    document.body.appendChild(ov);

    const cancelBtn=ov.querySelector('[data-action="drive-confirm-cancel"]');
    if(cancelBtn)cancelBtn.addEventListener('click',function(){closeModalGracefully(ov);});

    _sheetsAccountInit('driveSyncConfirmAcct');

    document.getElementById('driveSyncConfirmBtn').addEventListener('click', function(){
      closeModalGracefully(ov);
      onConfirm();
    });
  };

  DriveSyncManager.prototype.confirmAndUpload = function(){
    const self = this;
    this._showConfirmPopup('upload', function(){ self.uploadAll(); });
  };

  DriveSyncManager.prototype.confirmAndDownload = function(){
    const self = this;
    this._showConfirmPopup('download', function(){ self.downloadAll(); });
  };

  DriveSyncManager.prototype.uploadAll = async function(){
    const status=document.getElementById('driveSyncStatus');
    if(status)status.textContent='☁️ 업로드 중...';
    const panel=document.getElementById('settingsPanel');
    if(panel && typeof showLoading==='function') showLoading(panel,'Google Drive 업로드 중…');
    try{
      const cfg=this.getConfig();
      const exportRes = await this.api.dbExportBackup();
      if(!exportRes || !exportRes.success) throw new Error((exportRes && exportRes.error) || '백업 내보내기 실패');
      const now=new Date();
      const fileName=this.buildFileName(now);
      const uploadRes=await this.api.driveSyncUpload(fileName,JSON.stringify(exportRes.backup,null,2),cfg.folderId||null);
      if(!uploadRes.success) throw new Error(uploadRes.error || '업로드 실패');
      const ts=now.toLocaleString('ko');
      cfg.lastSync=ts; cfg.lastFileId=uploadRes.fileId;
      this.saveConfig(cfg);
      if(status)status.textContent='✅ 업로드 완료: '+ts+(uploadRes.updated?' (기존 파일 업데이트)':' (새 파일 생성)');
      bus.emit('toast:show', {text: 'Google Drive에 백업 완료'});
    }catch(err){
      if(status)status.textContent='❌ 업로드 실패: '+err.message;
    } finally {
      if(panel && typeof hideLoading==='function') hideLoading(panel);
    }
  };

  DriveSyncManager.prototype.downloadAll = async function(){
    const status=document.getElementById('driveSyncStatus');
    if(status)status.textContent='☁️ 다운로드 중...';
    const panel=document.getElementById('settingsPanel');
    if(panel && typeof showLoading==='function') showLoading(panel,'Google Drive 다운로드 중…');
    try{
      const cfg=this.getConfig();
      const fileName=this.buildFileName(new Date());
      const res=await this.api.driveSyncDownload(fileName,cfg.folderId||null);
      if(!res.success) throw new Error(res.error||'다운로드 실패');
      if(!res.exists){ if(status)status.textContent='📭 Drive에 오늘 백업 파일이 없습니다.'; return; }
      if(!confirm('Drive에서 데이터를 불러오면 현재 데이터가 덮어씌워집니다.\n\n계속하시겠습니까?')) return;
      const importRes = await this.api.dbImportBackup(res.data);
      if(!importRes || !importRes.success) throw new Error((importRes && importRes.error) || 'DB 복원 실패');
      if(status)status.textContent='✅ 복원 완료: '+importRes.count+'개 항목 (수정일: '+(res.modifiedTime||'')+')';
      bus.emit('toast:show', {text: 'Drive에서 '+importRes.count+'개 항목 복원됨. 새로고침합니다.'});
      setTimeout(function(){ location.reload(); }, 1500);
    }catch(err){
      if(status)status.textContent='❌ 다운로드 실패: '+err.message;
    } finally {
      if(panel && typeof hideLoading==='function') hideLoading(panel);
    }
  };

export { DriveSyncManager };
export const driveSyncManager = new DriveSyncManager(window.electronAPI || null);

/* ═══════════════════════════════════════
   GOOGLE SHEETS MANAGER (google-sheets-manager.js에서 통합)
   ═══════════════════════════════════════ */
import { createEmptyState } from '../../core/helpers.js';

function GoogleSheetsManager(bridge){
  this.appData=bridge||null;
  this.storageKey='ec_gsheets';
  this.dbKey='gsheets';
  this.items=[];
  this._loadFromLocal();
}
GoogleSheetsManager.prototype._loadFromLocal=function(){
  try{this.items=JSON.parse(localStorage.getItem(this.storageKey)||'[]')||[];}catch(e){this.items=[];}
};
GoogleSheetsManager.prototype._persist=function(){
  localStorage.setItem(this.storageKey,JSON.stringify(this.items));
  if(this.appData&&this.appData.canUseBackend())return this.appData.saveCommon(this.dbKey,this.items,{legacyJsonKey:this.dbKey});
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)return window.electronAPI.jsonSaveCommon(this.dbKey,this.items);
  return Promise.resolve(null);
};
GoogleSheetsManager.prototype.getItems=function(){return this.items.slice();};
GoogleSheetsManager.prototype.addSheet=function(rawUrl,title){
  const url=String(rawUrl||'').trim();
  if(!url)return{success:false,error:'URL이 비어 있습니다.'};
  if(url.indexOf('docs.google.com/spreadsheets')===-1)return{success:false,error:'구글 시트 URL이 아닙니다.'};
  const match=url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const embedUrl=match?'https://docs.google.com/spreadsheets/d/'+match[1]+'/pubhtml?widget=true&headers=false':url.replace(/\/edit.*/,'/pubhtml?widget=true&headers=false');
  this.items.push({url:embedUrl,title:title||('시트 '+(this.items.length+1)),height:500});
  this._persist();
  return{success:true};
};
GoogleSheetsManager.prototype.removeSheet=function(index){this.items.splice(index,1);this._persist();};
GoogleSheetsManager.prototype.resizeSheet=function(index,value){if(!this.items[index])return;this.items[index].height=parseInt(value,10);this._persist();};
GoogleSheetsManager.prototype.render=function(listEl){
  if(!listEl)return;
  if(!this.items.length){
    listEl.innerHTML=createEmptyState({icon:'📊',title:'등록된 구글 시트가 없습니다',desc:'+ 시트 추가 버튼으로 새 시트를 연결하세요.'});
    return;
  }
  const self=this;
  listEl.innerHTML=this.items.map(function(s,i){
    return '<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:700;color:var(--t1)">📊 '+s.title+'</span><div style="display:flex;gap:6px;align-items:center"><label style="font-size:10px;color:var(--t3)">높이</label><input type="range" min="200" max="1200" value="'+s.height+'" style="width:100px" data-gsh-idx="'+i+'"><span style="font-size:10px;color:var(--t3)" id="gshH'+i+'">'+s.height+'px</span><span style="width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,0.9);color:#fff;font-size:10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" data-gsh-del="'+i+'">✕</span></div></div><div style="position:relative;width:100%;overflow:hidden;border:1px solid var(--bdr);border-radius:6px;background:#fff"><iframe src="'+s.url+'" style="width:100%;height:'+s.height+'px;border:none;display:block" allowfullscreen></iframe></div></div>';
  }).join('');
  listEl.querySelectorAll('input[data-gsh-idx]').forEach(function(inp){
    inp.addEventListener('input',function(){const idx=parseInt(this.dataset.gshIdx,10);if(window.resizeGSheet)window.resizeGSheet(idx,this.value);});
  });
  listEl.querySelectorAll('[data-gsh-del]').forEach(function(btn){
    btn.addEventListener('click',function(){const idx=parseInt(this.dataset.gshDel,10);if(confirm('삭제 하시겠습니까?')){self.removeSheet(idx);if(window.loadGoogleSheets)window.loadGoogleSheets();}});
  });
};
export { GoogleSheetsManager };
export const googleSheetsManager = new GoogleSheetsManager(appData);

/* ═══════════════════════════════════════
   GYOMU CALENDAR MANAGER (magic-calendar-manager.js에서 통합)
   ═══════════════════════════════════════ */
function MagicCalendarManager(api){
  this.api=api||null;
  this.state={connected:false,calendars:[]};
}
MagicCalendarManager.prototype.setStatus=function(text,isError){const el=document.getElementById('magicGcalStatus');if(!el)return;el.textContent=text;el.style.color=isError?'#ef4444':'var(--t3)';};
MagicCalendarManager.prototype.toggleForm=function(show){['magicGcalSelect','magicGcalTitle','magicGcalDate','magicGcalTime','magicGcalCreateBtn'].forEach(function(id){const el=document.getElementById(id);if(el)el.style.display=show?'':'none';});};
MagicCalendarManager.prototype.renderCalendarOptions=function(items){
  const sel=document.getElementById('magicGcalSelect');if(!sel)return;
  if(!items||!items.length){sel.innerHTML='';this.toggleForm(false);this.setStatus('표시 가능한 캘린더가 없습니다.',true);return;}
  sel.innerHTML=items.map(function(c){return '<option value="'+String(c.id||'').replace(/"/g,'&quot;')+'">'+String(c.summary||'내 캘린더').replace(/</g,'&lt;')+'</option>';}).join('');
  const saved=localStorage.getItem('ec_gcal_selected_calendar')||'';if(saved)sel.value=saved;
  sel.onchange=function(){localStorage.setItem('ec_gcal_selected_calendar',sel.value||'');};
  const dateInput=document.getElementById('magicGcalDate');if(dateInput&&!dateInput.value)dateInput.value=new Date().toISOString().slice(0,10);
  this.toggleForm(true);
};
MagicCalendarManager.prototype.connect=async function(){
  if(!this.api){this.setStatus('Electron API를 찾을 수 없습니다.',true);return;}
  this.setStatus('Google 로그인 중...');
  const loginResult=await this.api.googleLogin();
  if(!loginResult||!loginResult.success){this.setStatus('연결 실패: '+((loginResult&&loginResult.error)||'알 수 없는 오류'),true);return;}
  this.setStatus('캘린더 목록 불러오는 중...');
  const calResult=await this.api.calendarList();
  if(!calResult||!calResult.success){this.setStatus('연결됨, 캘린더 조회 실패: '+((calResult&&calResult.error)||'오류'),true);return;}
  this.state.connected=true;this.state.calendars=calResult.data||[];
  this.renderCalendarOptions(this.state.calendars);
  const user=loginResult.user&&loginResult.user.email?loginResult.user.email:'Google 계정';
  this.setStatus('연결됨: '+user,false);
};
MagicCalendarManager.prototype.createEvent=async function(){
  if(!this.api){this.setStatus('Electron API를 찾을 수 없습니다.',true);return;}
  const calSel=document.getElementById('magicGcalSelect'), titleEl=document.getElementById('magicGcalTitle'), dateEl=document.getElementById('magicGcalDate'), timeEl=document.getElementById('magicGcalTime');
  const calendarId=calSel?calSel.value:'', title=titleEl?titleEl.value.trim():'', date=dateEl?dateEl.value:'', time=timeEl?timeEl.value:'';
  if(!calendarId){this.setStatus('캘린더를 선택하세요.',true);return;}
  if(!title){this.setStatus('일정 제목을 입력하세요.',true);return;}
  if(!date){this.setStatus('일정 날짜를 선택하세요.',true);return;}
  const startIso=date+'T'+(time||'09:00')+':00';const end=new Date(startIso);end.setMinutes(end.getMinutes()+30);
  this.setStatus('일정 추가 중...');
  const result=await this.api.calendarCreate(calendarId,{summary:title,start:{dateTime:new Date(startIso).toISOString()},end:{dateTime:end.toISOString()}});
  if(!result||!result.success){this.setStatus('추가 실패: '+((result&&result.error)||'오류'),true);return;}
  this.setStatus('Google Calendar 일정이 추가되었습니다.',false);
  if(titleEl)titleEl.value='';
};
export { MagicCalendarManager };
export const magicCalendarManager = new MagicCalendarManager(window.electronAPI || null);

