/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* data-loader.js — 앱 부팅 데이터 로드 + 저장 + 동기화 + 종료 flush
 *
 * 이 모듈은 사이드 이펙트(모듈 평가 시 실행되는 코드)를 포함합니다:
 *  - localStorage 이중 인코딩 복구
 *  - 교육청/학교급 JSON 로드
 *  - 백엔드 DB 데이터 로드 (_doBackendLoad)
 *  - persistenceOrchestrator 매핑 등록
 *  - 2분 주기 자동 동기화
 *  - beforeunload 종료 flush
 */
import { S, refreshSharedKioskSettings } from './app-state.js';
import { bus } from './event-bus.js';
import { persistenceOrchestrator } from './persistence-orchestrator.js';
import { _reloadStudentsFromDB } from './student-utils.js';
import { _recToDbRow } from './record-utils.js';
import { _pushRosterToRelay, _checkKioskRosterStale, _scheduleDailyRosterCheck } from './kiosk-roster.js';
import { getSvWorkspaceCache } from '../features/survey/survey-view.js';
import { loadPublicDataApiKey } from './public-data-settings.js';

/* 공통 인증키는 빈 값도 유효한 '연결 중지' 설정이다. 범용 빈 값 복구/주기 쓰기를 거치지 않는다. */
let _publicDataLoad=null;
function _refreshPublicDataKey(){
  if(_publicDataLoad)return _publicDataLoad;
  const before=localStorage.getItem('ec_public_data_api_key');
  _publicDataLoad=loadPublicDataApiKey().then(function(result){
    if(result.success&&before!==localStorage.getItem('ec_public_data_api_key')){
      bus.emit('infectious:settings-changed');
      bus.emit('holidays:updated');
      if(window.fetchWeather)setTimeout(window.fetchWeather,100);
    }
  }).catch(function(){ /* 네트워크 실패 시 기존 캐시 유지. 키·오류 원문은 출력하지 않는다. */ })
    .finally(function(){_publicDataLoad=null;});
  return _publicDataLoad;
}

/* 보건일지·응급·감염 기록 및 명단의 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님).
   예) 2025-02-26 → 2024학년도. 기록은 학년도 blob 단위로 저장되므로 로드/저장 연도가 학년도여야
   1~2월 기록이 다음 연도 blob 으로 새지 않는다. (사용자 지시 2026-06-20) */
function _academicYear(d){
  const x=d?new Date(d):new Date();
  const b=isNaN(x.getTime())?new Date():x;
  return b.getMonth()>=2?b.getFullYear():b.getFullYear()-1;
}

/* ── 이중 인코딩 복구: '"value"' → 'value' ── */
const strKeys=['ec_theme','ec_bg_mode','ec_bg_selected','ec_bg_random_daily','ec_bg_random_weekly',
  'ec_recordMode','ec_fontScale','ec_weatherRegion','ec_weather_source','ec_weather_show',
  'ec_vp_sigMode','ec_kma_api_key','ec_airkorea_api_key'];
strKeys.forEach(function(k){
  const v=localStorage.getItem(k);
  if(v&&v.length>=2&&v.charAt(0)==='"'&&v.charAt(v.length-1)==='"'){
    try{const parsed=JSON.parse(v);if(typeof parsed==='string'){localStorage.setItem(k,parsed);}}catch(e){}
  }
});

/* ── 일회성 마이그레이션: 상단 회전문구 기본값 복구 (2026-05-15) ──
 *  배경: 이전 settings-view 의 _hdrMsgAutoSave 가 디바운스 250ms 안에 패널이 사라지면
 *  rows=0 → 빈 배열을 saveUserHeaderMsgs 로 보내 사용자의 기존 문구가 통째로 빈 배열로 덮어써졌을 가능성.
 *  사용자가 "기본 4개 문구로 되돌리기" 명시 요청.
 *  동작: localStorage 의 ec_header_msgs_user 제거 + DB blob 의 header_msgs_user 를 [] 로 설정.
 *  → loadUserHeaderMsgs 가 빈 배열 반환 → getCurrentCustomHeaderMsgs 가 _defaultHeaderMsgs 의 비잠금분 반환.
 *  플래그 ec_hdr_msgs_reset_2026 로 한 번만 실행. (이후 사용자가 다시 입력하면 그 값 보존) */
(function _hdrMsgsResetOnce(){
  try{
    if(localStorage.getItem('ec_hdr_msgs_reset_2026')==='1') return;
    localStorage.removeItem('ec_header_msgs_user');
    if(typeof window!=='undefined' && window.electronAPI && window.electronAPI.dbSet){
      window.electronAPI.dbSet('common','header_msgs_user',[]).catch(function(){});
    }
    localStorage.setItem('ec_hdr_msgs_reset_2026','1');
  }catch(_){}
})();

/* ══ 교육청·학교급 목록 JSON 로드 ══ */
export let _eduOfficeList=[];
export let _schoolLevelList=[];
if(typeof window.electronAPI!=='undefined'&&window.electronAPI.readFile){
  window.electronAPI.readFile('__app__/templates/edu-offices.json').then(function(res){
    if(!res||!res.success||!res.data)return;
    try{
      const d=JSON.parse(res.data);
      if(Array.isArray(d.eduOffices))_eduOfficeList=d.eduOffices;
      if(Array.isArray(d.schoolLevels))_schoolLevelList=d.schoolLevels;
    }catch(e){}
  }).catch(function(){});
}

/* ══ 백엔드 데이터 로드 ══ */
/* ── Google Sheets 내보내기 동의 팝업 — 한 번 동의하면 세션 동안 다시 묻지 않음(옵션) ── */
function _confirmSheetsExport(opts){
  opts=opts||{};
  const mainWarn=(opts.warningText!==undefined)?opts.warningText:'민감 데이터 저장을 권하지 않습니다.';
  /* 하단 보조 경고문 — 시트는 '편집 후 즉시 삭제', 캘린더 등 외부저장이 없는 연동은 footerNote:'' 로 생략 */
  const footerNote=(opts.footerNote!==undefined)?opts.footerNote:'편집 후 즉시 삭제하기 바랍니다.';
  /* 팝업 타이틀·본문 문구를 옵션으로 교체 가능 (Sheets/Docs/다른 외부 내보내기에서 공용 사용) */
  const modalTitle=opts.modalTitle||'Google Sheets로 보내기 — 동의 필요';
  const bodyText=opts.bodyText||'편집의 편의를 돕기 위해 <b>Google Sheets로 보내기</b> 기능을 만들었습니다.';
  const iconSvg=opts.iconSvg||'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
  return new Promise(function(resolve){
    const old=document.getElementById('sheetsConsentOv');if(old)old.remove();
    const ov=document.createElement('div');
    ov.id='sheetsConsentOv';
    ov.style.cssText='position:fixed;inset:0;z-index:60000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
    let h='<div style="background:var(--card);border-radius:14px;width:480px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden">';
    h+='<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:var(--popup-head);display:flex;align-items:center;gap:8px">'
      +iconSvg
      +'<span style="font-size:14px;font-weight:800;color:var(--t1)">'+modalTitle+'</span>'
      +'</div>';
    h+='<div style="padding:18px 22px;font-size:12px;color:var(--t1);line-height:1.8">'
      +'<div>'+bodyText+'</div>'
      +(mainWarn?('<div style="margin-top:8px"><b style="color:#dc2626">'+mainWarn+'</b></div>'):'')
      +(footerNote?('<div style="margin-top:8px"><b>'+footerNote+'</b></div>'):'')
      +'</div>';
    h+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--bdr);background:var(--bg2)">'
      +'<button id="sheetsConsentCancel" style="padding:7px 18px;font-size:11.5px;font-weight:600;background:var(--card);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>'
      +'<button id="sheetsConsentOk" style="padding:7px 22px;font-size:11.5px;font-weight:700;background:#1e8e3e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">동의합니다</button>'
      +'</div></div>';
    ov.innerHTML=h;
    document.body.appendChild(ov);
    function _close(ok){
      try{ov.remove();}catch(e){}
      resolve(!!ok);
    }
    ov.addEventListener('click',function(e){if(e.target===ov)_close(false);});
    document.getElementById('sheetsConsentCancel').addEventListener('click',function(){_close(false);});
    document.getElementById('sheetsConsentOk').addEventListener('click',function(){_close(true);});
  });
}

/* contextBridge 의 electronAPI 는 동결되어 있어 직접 래핑 불가 →
   window.sheetsExportWithConsent 헬퍼를 별도로 노출하고, 호출자가 사용 */
window.sheetsExportWithConsent=function(args){
  args=args||{};
  /* args.warningText 로 경고 문구 커스터마이즈 (예: 물품 대여대장에서 "개인 정보 저장을 권하지 않습니다.") */
  const consentOpts={warningText:args.warningText};
  return _confirmSheetsExport(consentOpts).then(function(ok){
    if(!ok)return {success:false,error:'사용자가 취소했습니다',cancelled:true};
    /* sheets IPC 로 warningText 는 전달하지 않음 (렌더러 전용 UI 옵션) */
    const jobArgs=Object.assign({},args);delete jobArgs.warningText;
    return window.electronAPI.sheetsExportJob(jobArgs);
  });
};

/* 범용 동의 팝업 — Sheets/Docs 등 외부 내보내기 공용 (같은 디자인)
   opts: { warningText, modalTitle, bodyText, iconSvg } */
window.confirmExportConsent=function(opts){ return _confirmSheetsExport(opts||{}); };

if(typeof window.electronAPI!=='undefined'){
  const api=window.electronAPI;
  if(api.studentsGetAll||api.peopleGetAll){
    const yr=String(_academicYear());
    _doBackendLoad(yr);
  }
  /* 웹 버전: 날씨 호출 (스플래시 없으므로 직접). _currentUser 는 사용자가 프로필을 클릭해 선택할 때 설정됨. */
  if(window.__isWebBrowser){
    /* 날씨 데이터 로드 */
    setTimeout(function(){
      if(typeof fetchWeather==='function'){fetchWeather();setInterval(fetchWeather,1800000);}
    },2000);
  }
}
/* 사용자 프로필 클릭/로그인 시 호출 — 세션에 식별정보 등록 → 호스트 전광판에 표시 */
export function registerCollabIdentity(){
  const u=S._currentUser||{};
  const up=(function(){try{return JSON.parse(localStorage.getItem('ec_user')||'{}');}catch(e){return {};}})();
  const hs=(function(){try{return JSON.parse(localStorage.getItem('ec_settings')||'{}');}catch(e){return {};}})();
  const payload={
    name:u.name||up.name||hs.nurse1||'',
    school:u.school_name||up.school||hs.schoolName||'',
    position:u.position||up.position||'',
    type: window.__isWebBrowser?'client':'host'
  };
  if(!payload.name&&!payload.school&&!payload.position)return Promise.resolve();
  /* Electron 데스크탑 모드(non-web)에선 자기 자신(host)을 자기 자신에게 등록할 필요 없음.
   * 또한 web 변형이 아닌 경우 localhost:3000 에 협업 서버가 없어 ERR_CONNECTION_REFUSED 콘솔 노이즈만 유발하므로 skip. */
  if(!window.__isWebBrowser)return Promise.resolve();
  const sid=sessionStorage.getItem('_webSessionId')||'';
  if(!sid)return Promise.resolve();
  return fetch('/api/session-identity',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Session-Id':sid},
    body:JSON.stringify(payload)
  }).catch(function(){});
}

/* ══════════════════════════════════════════
   실시간 동기화 — 다른 사용자(동료/웹 접속자)가 변경한 레코드를 10초마다 반영
   편집 중(_dirty) 레코드는 로컬 우선 (사용자 입력 유지)
   ══════════════════════════════════════════ */
let _dbSyncTimer=null;
let _visTickHandler=null; /* visibilitychange 리스너 핸들 — 폴링 정지 시 제거용 */
function _mergeRecordsFromDB(apiGet, stateKey, yearArg){
  if(!apiGet)return;
  apiGet(yearArg).then(function(res){
    if(!res||!res.success||!Array.isArray(res.data))return;
    const NOW=Date.now();
    const GRACE_MS=7000;/* 최근 로컬 변경 유예 시간 */
    const deletedMap=window._recentlyDeletedRecs||{};
    const dbList=res.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
    const current=Array.isArray(S[stateKey])?S[stateKey]:[];
    const dbById={};dbList.forEach(function(r){if(r.id!=null)dbById[r.id]=r;});
    const curById={};current.forEach(function(r){if(r.id!=null)curById[r.id]=r;});
    let changed=false;
    /* 1) 로컬에만 있고 DB에 없는 것만 keepLocal — DB 에도 있는 dirty/savedAt 레코드는
       dbList 단계에서 cur 로 push 되므로 여기서 제외해야 한다 (이중 push 방지). */
    const keepLocal=current.filter(function(r){
      if(dbById[r.id])return false;/* DB에 있는 건 dbList 단계가 처리 */
      if(r._dirty||r._isDummy)return true;
      if(r._savedAt&&(NOW-r._savedAt<GRACE_MS))return true;/* 최근 저장 → 유예 */
      changed=true;
      return false;
    });
    /* 2) DB 버전 가져오기 — 편집 중/최근 저장/최근 삭제 건은 cur 우선 */
    const merged=[];
    keepLocal.forEach(function(r){merged.push(r);});
    dbList.forEach(function(dbRec){
      /* 최근 삭제한 레코드가 DB에 아직 남아있으면 무시 (삭제 트랜잭션 완료 대기) */
      if(deletedMap[dbRec.id]&&(NOW-deletedMap[dbRec.id]<GRACE_MS))return;
      const cur=curById[dbRec.id];
      if(cur&&cur._dirty){merged.push(cur);return;}
      if(cur&&cur._savedAt&&(NOW-cur._savedAt<GRACE_MS)){merged.push(cur);return;}
      merged.push(dbRec);
      if(!cur||JSON.stringify(cur)!==JSON.stringify(dbRec))changed=true;
    });
    /* 유예 기간 지난 삭제 목록 정리 */
    Object.keys(deletedMap).forEach(function(k){if(NOW-deletedMap[k]>=GRACE_MS)delete deletedMap[k];});
    if(changed){
      S[stateKey]=merged;
      /* bodymap 동기화 */
      if(stateKey==='records'){
        S.records.forEach(function(r){
          if(r.bodymapData&&r.bodymapData.length>0){
            if(!window._bmData)window._bmData={};
            window._bmData[r.id]=r.bodymapData;
          }
        });
      }
      bus.emit('render:daily');
      bus.emit('render:calendar');
      bus.emit('render:sidebar');
    }
  }).catch(function(){});
}
/* 개선안: 버전 카운터 + 포커스 인지 폴링 + 연결 상태 추적 + 재시도
   - 10초마다 /api/data-version (경량 — 숫자 1개) 조회
   - 버전 바뀐 경우에만 전체 레코드 재조회 + 머지
   - 페이지 숨김(탭 비활성) 또는 편집 중 → 스킵
   - fetch 실패 → 끊김 상태 진입 → 같은 포트로 지수 backoff 재시도 (1→3→5→10→10초, 5회)
   - 5회 모두 실패 → 'exhausted' 이벤트 (Phase 2-2 의 포트 폴백 트리거)
   - 복구 시 'restored' 이벤트 + 큐 flush (Phase 2-3) */
let _lastKnownVersion=0;

/* 연결 상태 — UI 와 큐 모두 참조 */
const _connState={
  status:'idle',          /* 'idle' | 'connected' | 'reconnecting' | 'failed' */
  failCount:0,
  lastSuccessAt:0,
  lastFailAt:0,
  retryTimer:null,
  lastPort:null,          /* 현재 사용 중인 포트 (UI 토스트 메시지용) */
};
window._connState=_connState; /* UI 디버깅·검사용 */

/* lastPort 초기화 — 웹 환경은 자기 origin 의 포트, Electron 은 3000 */
(function _initLastPort(){
  try{
    if(window.__isWebBrowser){
      const p=parseInt(window.location.port,10);
      _connState.lastPort=isNaN(p)?(window.location.protocol==='https:'?443:80):p;
    } else {
      _connState.lastPort=3000;
    }
  }catch(_e){_connState.lastPort=3000;}
})();

/* 같은 포트 재시도 지연 (ms) — 누적 약 29초 동안 5회 시도 */
const _RETRY_DELAYS=[1000,3000,5000,10000,10000];

/* 폴백 후보 포트 — 같은 포트 재시도 5회 모두 실패 시 다른 포트로 시도. */
const _FALLBACK_PORTS=[80,8080,8000,8888,9000,3000];

/* 활성 base URL — 끊김 후 폴백 성공 시 갱신. sessionStorage 에 백업하여 새로고침에서도 보존.
 *  웹: 자기 origin 으로 시작 (예: http://10.63.1.33:8080), 폴백되면 다른 포트 origin 으로
 *  Electron: localhost:3000 으로 고정 (host-local 통신, 학교 방화벽 무관) */
let _activeBaseUrl=(function(){
  if(!window.__isWebBrowser)return 'http://localhost:3000';
  /* sessionStorage 의 보존된 base 가 같은 호스트면 그 값을 우선 사용 (폴백 후 새로고침 케이스) */
  try{
    const saved=sessionStorage.getItem('_activeBaseUrl');
    if(saved){
      const u=new URL(saved);
      if(u.hostname===window.location.hostname)return saved;
      /* 다른 호스트면 무시하고 origin 사용 */
      sessionStorage.removeItem('_activeBaseUrl');
    }
  }catch(_e){}
  return window.location.origin;
})();
window._getActiveBaseUrl=function(){return _activeBaseUrl;};
/* 활성 서버 base URL — 협업 편집잠금 모듈 등에서 정식 import 로 사용 (포트 폴백 반영됨). */
export function getActiveBaseUrl(){return _activeBaseUrl;}

/* 연결 이벤트 발행 — bus 와 CustomEvent 양방향. UI 측은 둘 중 편한 것 구독. */
function _emitConn(type,payload){
  try{ if(window.bus && typeof window.bus.emit==='function') window.bus.emit('conn:'+type,payload||{}); }catch(_e){}
  try{ window.dispatchEvent(new CustomEvent('conn:'+type,{detail:payload||{}})); }catch(_e){}
}

function _fetchDataVersion(){
  /* Electron/웹 공통: _activeBaseUrl 사용 (폴백 시 웹 환경에서 다른 포트로 갱신될 수 있음) */
  return fetch(_activeBaseUrl+'/api/data-version',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){return (d&&d.success)?d.version:null;})
    .catch(function(){return null;});
}

/* 다른 포트로 폴백 — 같은 포트 5회 재시도 실패 후 호출. 웹 환경에서만 의미 있음.
 * 후보 포트들에 순차 GET /api/data-version (각 3초 timeout). 첫 성공 → _activeBaseUrl 갱신 + 'restored'. */
async function _tryPortFallback(){
  if(!window.__isWebBrowser){
    /* Electron — localhost 고정이므로 폴백 불가. 그냥 exhausted 유지. */
    _emitConn('exhausted',{failCount:_connState.failCount,reason:'electron_no_fallback'});
    return;
  }
  const protocol=window.location.protocol;
  const host=window.location.hostname;
  const currentPort=parseInt(window.location.port,10)||(protocol==='https:'?443:80);
  _emitConn('falling_back',{currentPort:currentPort,candidates:_FALLBACK_PORTS});
  for(let i=0;i<_FALLBACK_PORTS.length;i++){
    const port=_FALLBACK_PORTS[i];
    if(port===currentPort)continue;
    const candidate=protocol+'//'+host+(port===80?'':':'+port);
    try{
      const ctrl=new AbortController();
      const t=setTimeout(function(){ctrl.abort();},3000);
      const res=await fetch(candidate+'/api/data-version',{cache:'no-store',signal:ctrl.signal});
      clearTimeout(t);
      if(res.ok){
        const d=await res.json();
        if(d&&d.success){
          /* 성공 — base 전환 */
          _activeBaseUrl=candidate;
          _connState.status='connected';
          _connState.failCount=0;
          _connState.lastPort=port;
          /* 보완 2: 폴백 후 페이지 새로고침에서도 살아남도록 sessionStorage 에 기록 */
          try{ sessionStorage.setItem('_activeBaseUrl',candidate); }catch(_e){}
          /* 새 주소로 SSE 재연결 — 폴링뿐 아니라 즉시알림도 살아있게 */
          _restartSse();
          _emitConn('restored',{fromPort:currentPort,toPort:port,newBase:candidate,viaFallback:true});
          return;
        }
      }
    }catch(_e){
      /* 다음 포트 시도 */
    }
  }
  /* 모든 포트 실패 */
  _connState.status='failed';
  _emitConn('all_failed',{triedPorts:_FALLBACK_PORTS,host:host});
}

function _onFetchSuccess(){
  _connState.lastSuccessAt=Date.now();
  /* 재시도 타이머가 떠있으면 정리 */
  if(_connState.retryTimer){clearTimeout(_connState.retryTimer);_connState.retryTimer=null;}
  if(_connState.status==='reconnecting'||_connState.status==='failed'){
    _connState.status='connected';
    _connState.failCount=0;
    _emitConn('restored',{});
  } else if(_connState.status==='idle'){
    _connState.status='connected';
    _connState.failCount=0;
    _emitConn('connected',{});
  }
}

function _onFetchFailure(){
  /* 안전선 — 폴링이 정지된 상태(_dbSyncTimer null) 에서 in-flight fetch 가 늦게 도착해
   * 실패로 처리되면 토스트가 잘못 떠 사용자가 끊김으로 오인하는 케이스 차단. */
  if(!_dbSyncTimer && _connState.status!=='reconnecting'){
    /* 폴링 자체가 꺼져 있으면 끊김 이벤트 발행 안 함 */
    return;
  }
  _connState.lastFailAt=Date.now();
  _connState.failCount++;
  /* 처음 끊김 — 'lost' 이벤트 */
  if(_connState.status==='connected'||_connState.status==='idle'){
    _connState.status='reconnecting';
    _emitConn('lost',{failCount:_connState.failCount,maxAttempts:_RETRY_DELAYS.length});
  } else {
    _emitConn('retrying',{failCount:_connState.failCount,maxAttempts:_RETRY_DELAYS.length});
  }
  /* 재시도 5회 초과 → 다른 포트로 폴백 시도 */
  if(_connState.failCount>_RETRY_DELAYS.length){
    /* exhausted 이벤트 발행 후 즉시 폴백 시도 */
    _emitConn('exhausted',{failCount:_connState.failCount});
    _tryPortFallback();
    return;
  }
  _scheduleRetry();
}

function _scheduleRetry(){
  if(_connState.retryTimer){clearTimeout(_connState.retryTimer);_connState.retryTimer=null;}
  const attemptIdx=Math.min(_connState.failCount-1,_RETRY_DELAYS.length-1);
  const delay=_RETRY_DELAYS[attemptIdx];
  _connState.retryTimer=setTimeout(function(){
    _connState.retryTimer=null;
    _doFetchAndHandle();
  },delay);
}

let _fullRefreshFn=null; /* _startRealtimeSync 안에서 정의되며 _doFetchAndHandle 가 참조 */
function _doFetchAndHandle(){
  _fetchDataVersion().then(function(v){
    if(v==null){_onFetchFailure();return;}
    _onFetchSuccess();
    if(_lastKnownVersion===0){_lastKnownVersion=v;return;}
    if(v!==_lastKnownVersion){
      _lastKnownVersion=v;
      if(typeof _fullRefreshFn==='function')_fullRefreshFn();
    }
  });
}

/* ── 즉시 알림(SSE) 구독 (2026-06-07) — 폴링(10초) 위에 얹는 실시간 푸시 ──
 *  · 서버가 데이터 변경 시 'data' 이벤트 push → 즉시 _doFetchAndHandle (버전 비교 후 변경시만 머지)
 *  · 입력 중(input/textarea/contenteditable 포커스)이면 보류 — 내 작업 보호. 입력 끝나면 다음 신호/폴링이 반영.
 *  · 연결 끊겨도 폴링이 안전망. EventSource 는 retry 로 자동 재연결. */
let _sse=null;
/* 기록 표 안의 셀을 편집 중인지 — 동기화 보류 여부 판정용. 검색창 등 표 밖 입력은 false (즉시 반영). */
function _isEditingRecordCell(){
  const ae=document.activeElement;
  if(!ae)return false;
  if(ae.tagName!=='INPUT'&&ae.tagName!=='TEXTAREA'&&!ae.isContentEditable)return false;
  return !!(ae.closest&&ae.closest('#recBody,#ecListBody,#infListBody'));
}
function _onSseData(ev){
  if(document.hidden)return;
  /* 입력 중인 "칸"만 보호 — 기록 표(#recBody/#ecListBody/#infListBody) 안의 셀을 편집 중일 때만 보류.
   * 검색창 등 표 밖 입력은 renderDaily 가 다시 그리지 않으므로 보류할 필요 없음 → 즉시 반영 (느림 해소, 2026-06-07). */
  if(_isEditingRecordCell())return;
  /* SSE 이벤트에 새 버전이 실려오므로 추가 버전 왕복 없이 즉시 비교·갱신 (체감 즉시화, 2026-06-07).
   * 폴링 경로(_doFetchAndHandle)와 _lastKnownVersion 을 공유 → 중복 머지 없음. */
  const v=ev&&ev.data!=null?parseInt(ev.data,10):NaN;
  if(isNaN(v)){_doFetchAndHandle();return;}
  _onFetchSuccess();
  if(_lastKnownVersion===0){_lastKnownVersion=v;return;}
  if(v!==_lastKnownVersion){
    _lastKnownVersion=v;
    if(typeof _fullRefreshFn==='function')_fullRefreshFn();
  }
}
function _startSse(){
  if(_sse)return;
  if(typeof EventSource==='undefined')return;
  try{
    /* sid 를 쿼리로 실어 보낸다 — EventSource 는 헤더를 못 붙이므로 URL 로 전달.
     * 서버가 이 연결 끊김(탭 닫힘)을 세션과 묶어 전광판에서 즉시 내리는 데 사용. (2026-06-07) */
    var _sseSid='';try{_sseSid=sessionStorage.getItem('_webSessionId')||'';}catch(_s){}
    _sse=new EventSource(_activeBaseUrl+'/api/events'+(_sseSid?('?sid='+encodeURIComponent(_sseSid)):''));
    _sse.addEventListener('data',_onSseData);
    _sse.onerror=function(){/* 브라우저가 retry 로 자동 재연결. 폴링이 안전망. */};
  }catch(_e){_sse=null;}
}
function _stopSse(){
  if(_sse){try{_sse.close();}catch(_e){}_sse=null;}
}
/* base URL 이 포트 폴백으로 바뀌면 SSE 도 새 주소로 재연결 */
function _restartSse(){_stopSse();_startSse();}

/* 인원(학생·교직원) 명단 변경 감지용 경량 시그니처 — 표시·집계에 쓰이는 핵심 필드만 32bit 해시.
 *  레코드만 바뀐 버전 bump 에서는 시그니처가 동일 → 불필요한 인원 재렌더를 막는다. (2026-06-14) */
function _peopleSig(){
  const ppl=(typeof S.people!=='undefined'&&Array.isArray(S.people))?S.people:[];
  let h=ppl.length|0;
  for(let i=0;i<ppl.length;i++){
    const p=ppl[i]||{};
    /* DB 재조회는 camel 필드, 저장 확인 응답은 snake 필드도 사용한다. 어느 경로든
       같은 내용은 같은 해시로 비교하고, 요보호 메모만 바뀐 경우도 화면에 반영한다. */
    const isCare=p.is_care!=null?Number(p.is_care)===1:(p.status==='caution'||p.status==='watch');
    const careReason=p.care_reason!=null?p.care_reason:(p.condition||'');
    const dustDisease=p.dust_disease!=null?p.dust_disease:(p.dustDisease||'');
    const careMemo=p.care_memo!=null?p.care_memo:(p.careMemo||'');
    const str=(p.uid||'')+'|'+(p.name||'')+'|'+(p.type||'')+'|'+(p.grade||'')+'|'+(p.cls||'')+'|'+(p.num||'')+'|'+(p.department||'')+'|'+(p.level||'')+'|'+(p.position||'')+'|'+(p.gender||'')+'|'+(isCare?'1':'0')+'|'+careReason+'|'+dustDisease+'|'+careMemo+'|'+(p.med_consent||'')+'|'+(p.emergency_consent||'');
    for(let j=0;j<str.length;j++){h=(h*31+str.charCodeAt(j))|0;}
  }
  return h;
}
function _startRealtimeSync(){
  if(_dbSyncTimer)return;
  _fullRefreshFn=function(){
    if(!window.electronAPI)return;
    _refreshPublicDataKey();
    const yr=String(_academicYear());
    _mergeRecordsFromDB(window.electronAPI.recordsGetDaily,'records',yr);
    _mergeRecordsFromDB(window.electronAPI.recordsGetEmergency,'ecRecords',yr);
    _mergeRecordsFromDB(window.electronAPI.recordsGetInfection,'infRecords',yr);
    /* 인원 원격 변경 동기화 — 동료가 웹에서 인원 등록/수정/삭제 시 1~2초 내 S.people 에 반영.
     *  인원이 실제로 바뀐 경우에만 재렌더(시그니처 비교). 인원관리 편집 폼 보호는
     *  person-manager 의 people:remote-changed 핸들러가 입력값 가드로 담당. */
    try{
      const _beforeSig=_peopleSig();
      _reloadStudentsFromDB().then(function(){
        if(_peopleSig()!==_beforeSig){
          bus.emit('people:remote-changed');
          bus.emit('render:daily');
          bus.emit('render:dashboard');
          bus.emit('render:sidebar');
        }
      }).catch(function(){});
    }catch(_e){}
  };
  const _tick=function(){
    /* 1) 탭 숨김이면 스킵. 입력은 "기록 표 셀 편집 중"일 때만 스킵 (검색창 포커스로 동기화가 멈추던 느림 해소). */
    if(document.hidden)return;
    if(_isEditingRecordCell())return;
    /* 2) 재시도 타이머가 활성이면 중복 fetch 방지 (backoff 보장) */
    if(_connState.status==='reconnecting'&&_connState.retryTimer)return;
    /* 3) failed 상태에서는 setInterval 도 시도 — 폴백 후 복구 가능성 위해 */
    _doFetchAndHandle();
  };
  _dbSyncTimer=setInterval(_tick,10000);/* 10초 주기 — 버전 조회만 (SSE 끊김 대비 안전망) */
  /* 즉시 알림(SSE) 구독 시작 — 변경 즉시 반영 */
  _startSse();
  /* 탭 복귀 시 즉시 1회 체크 — _stopRealtimeSync 에서 제거 가능하도록 named 등록 */
  if(!_visTickHandler){
    _visTickHandler=function(){if(!document.hidden)_tick();};
    document.addEventListener('visibilitychange',_visTickHandler);
  }
}

/* 폴링 정지 — Electron 에서 사용자가 웹 서버를 끄거나, 웹 서버 자식이 종료될 때 호출.
 * 타이머·리스너·재시도 정리 후 상태 idle 로 리셋. 'conn:stopped' 발행해서 진행 중 토스트도 정리. */
function _stopRealtimeSync(){
  if(_dbSyncTimer){clearInterval(_dbSyncTimer);_dbSyncTimer=null;}
  if(_connState.retryTimer){clearTimeout(_connState.retryTimer);_connState.retryTimer=null;}
  if(_visTickHandler){document.removeEventListener('visibilitychange',_visTickHandler);_visTickHandler=null;}
  _stopSse();
  _connState.status='idle';
  _connState.failCount=0;
  _emitConn('stopped',{});
}

/* ── 부트스트랩: 폴링 시작 조건 ──
 *  웹 변형(web-api-bridge.js) — window.__isWebBrowser=true 인 환경:
 *    이미 같은 호스트의 웹 서버에 접속해 있으므로 무조건 폴링 시작 (기존 동작 유지)
 *  Electron 데스크톱 — window.__isWebBrowser=undefined:
 *    웹 서버가 켜져 있을 때만 폴링 시작.
 *      (a) 부팅 자동 재시작(prefs='1') 케이스 → webServerStatus() 직접 조회 후 running 이면 시작
 *      (b) 사용자 수동 시작/종료 → main.js 가 'web-server-started' / 'web-server-stopped' 이벤트 송신
 *    한 번도 웹 서버를 켠 적 없는 PC 에선 폴링 자체가 시작되지 않음 → "호스트 응답 없음" 토스트 차단. */
if(window.__isWebBrowser){
  setTimeout(_startRealtimeSync,3000);
} else {
  /* (a) 부팅 직후 한 번 현재 상태 직접 조회 — 이벤트 listener 등록 전에 시작된 자동 재시작 race 대응 */
  setTimeout(function(){
    if(!window.electronAPI||typeof window.electronAPI.webServerStatus!=='function')return;
    window.electronAPI.webServerStatus()
      .then(function(res){
        if(res&&res.success&&res.running)_startRealtimeSync();
      })
      .catch(function(){/* 상태 조회 실패해도 무시 — 이벤트로 또 받을 수 있음 */});
  },3000);
  /* (b) 메인이 보내는 라이프사이클 이벤트 구독 */
  if(window.electronAPI){
    if(typeof window.electronAPI.onWebServerStarted==='function'){
      window.electronAPI.onWebServerStarted(function(){_startRealtimeSync();});
    }
    if(typeof window.electronAPI.onWebServerStopped==='function'){
      window.electronAPI.onWebServerStopped(function(){_stopRealtimeSync();});
    }
  }
}

function _doBackendLoad(yr){
  _refreshPublicDataKey();
  _reloadStudentsFromDB().then(function(){
    if(S.people.length>0){
      console.log('[DB] people: '+S.people.length+'명 (재학중)');
      _checkKioskRosterStale();
    }
  }).catch(function(err){console.error('[DB] people 로드 실패:',err);});

  _scheduleDailyRosterCheck();

  /* 로딩 안내 최소 표시 시간 보장 — better-sqlite3 가 너무 빠르면 view 마운트 전에 응답 도착 → 사용자가 안내를 못 봄.
   *  현재 시각 + 600ms 이전에 응답이 도착해도 그 시점까지는 _dailyLoading=true 유지. */
  const _dailyLoadStartedAt=Date.now();
  const _MIN_LOADING_MS=600;
  window.electronAPI.recordsGetDaily(yr).then(function(res){
    if(res&&res.success&&Array.isArray(res.data)&&res.data.length>0){
      S.records=res.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
      S.nextId=Math.max(1012,...S.records.map(function(r){return r.id||0;}))+1;
      /* bodymapData → window._bmData 동기화 */
      S.records.forEach(function(r){
        if(r.bodymapData&&r.bodymapData.length>0){
          if(!window._bmData)window._bmData={};
          window._bmData[r.id]=r.bodymapData;
        }
      });
      console.log('[DB] records: '+S.records.length+'건 (새 DB)');
    }
  }).catch(function(err){console.error('[DB] records 로드 실패:',err);}).then(function(){
    /* 성공·실패·빈 결과 모두 — 최소 표시 시간 이후 로딩 플래그 해제 + 재렌더 트리거 */
    const _elapsed=Date.now()-_dailyLoadStartedAt;
    const _finish=function(){
      S._dailyLoading=false;
      try{bus.emit('render:daily');}catch(_){}
    };
    if(_elapsed<_MIN_LOADING_MS) setTimeout(_finish,_MIN_LOADING_MS-_elapsed);
    else _finish();
  });

  window.electronAPI.recordsGetEmergency(yr).then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){
      S.ecRecords=res.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
      S.ecNextId=res.nextId||1;
      console.log('[DB] emergency_records: '+S.ecRecords.length+'건');
    }
  }).catch(function(err){console.error('[DB] emergency_records 로드 실패:',err);});

  window.electronAPI.recordsGetInfection(yr).then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){
      S.infRecords=res.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
      S.infNextId=res.nextId||1;
      console.log('[DB] infection_records: '+S.infRecords.length+'건');
    }
  }).catch(function(err){console.error('[DB] infection_records 로드 실패:',err);});

  window.electronAPI.recordsGetInfectionNotes(yr).then(function(res){
    if(res&&res.success&&res.data&&typeof res.data==='object')S.infNotes=res.data;
  }).catch(function(){});

  window.electronAPI.medicalGetDeptMapping().then(function(res){
    if(res&&res.success&&res.text)S.deptMappingText=res.text;
  }).catch(function(){});

  window.electronAPI.medicalGetTreatmentMap().then(function(res){
    if(res&&res.success&&Array.isArray(res.data))S.treatmentMap=res.data;
  }).catch(function(){});

  window.electronAPI.medicalGetMedicationMap().then(function(res){
    if(res&&res.success&&Array.isArray(res.data))S.medicationMap=res.data;
  }).catch(function(){});

  window.electronAPI.medicalGetSymMeds().then(function(res){
    if(res&&res.success&&res.data&&typeof res.data==='object')S._symMeds=res.data;
  }).catch(function(){});

  if(window.electronAPI.medicalGetSymOintments){
    window.electronAPI.medicalGetSymOintments().then(function(res){
      if(res&&res.success&&Array.isArray(res.data))S._symOintments=res.data;
    }).catch(function(){});
  }

  if(window.electronAPI.medicalGetSymPatches){
    window.electronAPI.medicalGetSymPatches().then(function(res){
      if(res&&res.success&&Array.isArray(res.data))S._symPatches=res.data;
    }).catch(function(){});
  }
}

/* ── 설정 및 기타 데이터 로드 ── */
if(typeof window.electronAPI!=='undefined'&&window.electronAPI.jsonLoad){
  const yr=String(_academicYear());
  const commonMappings=[];
  const yearMappings=[];

  commonMappings.push({dbKey:'settings',lsKey:'ec_settings',onLoaded:function(data){
    if(data&&typeof data==='object'){
      Object.assign(S.settings,data);
      console.log('[JSON] settings 로드됨');
    }
  }});
  commonMappings.push({dbKey:'drive_sync_config',lsKey:'drive_sync_config',onLoaded:null});
  commonMappings.push({dbKey:'memos',lsKey:'ec_memos',onLoaded:function(data){
    if(data&&typeof data==='object')S.memoData=data;
  }});
  commonMappings.push({dbKey:'vip_tags',lsKey:'ec_vip_tags',onLoaded:function(data){
    if(data&&typeof data==='object')S._vipTags=data;
  }});
  commonMappings.push({dbKey:'user_profile',lsKey:'ec_user',onLoaded:function(data){
    if(data&&typeof data==='object')S._userProfile=data;
    /* 헤더 1층 phase 0 (교육청·학교·직위·이름) 즉시 갱신 — DB 로딩 직후 사용자 정보 반영 */
    try{bus.emit('header:refresh-user');}catch(e){}
  }});
  /* A shared browser must not migrate or write back its old local channel. */
  if(window.__isWebBrowser){
    refreshSharedKioskSettings();
  } else {
  /* 키오스크 채널 정보 보존: _setLs가 localStorage를 덮어쓰기 전에 백업 */
  var _kioskChannelBackup=null;
  (function(){
    try{
      var _lsOrig=JSON.parse(localStorage.getItem('ec_kiosk')||'{}');
      if(_lsOrig.channelId||_lsOrig.authToken||_lsOrig.active){
        _kioskChannelBackup={channelId:_lsOrig.channelId,authToken:_lsOrig.authToken,nurseToken:_lsOrig.nurseToken,active:_lsOrig.active,relayUrl:_lsOrig.relayUrl};
      }
    }catch(e){}
  })();
  commonMappings.push({dbKey:'kiosk_settings',lsKey:'ec_kiosk',onLoaded:function(data){
    if(data&&typeof data==='object'){
      Object.keys(data).forEach(function(k){ if(data[k]!=null) S.kioskSettings[k]=data[k]; });
    }
    /* 백업된 채널 정보 복원 */
    if(_kioskChannelBackup){
      if(_kioskChannelBackup.channelId) S.kioskSettings.channelId=_kioskChannelBackup.channelId;
      if(_kioskChannelBackup.authToken) S.kioskSettings.authToken=_kioskChannelBackup.authToken;
      if(_kioskChannelBackup.nurseToken) S.kioskSettings.nurseToken=_kioskChannelBackup.nurseToken;
      if(_kioskChannelBackup.active!=null) S.kioskSettings.active=_kioskChannelBackup.active;
      if(_kioskChannelBackup.relayUrl) S.kioskSettings.relayUrl=_kioskChannelBackup.relayUrl;
      /* localStorage에도 복원 */
      localStorage.setItem('ec_kiosk',JSON.stringify(S.kioskSettings));
    }
    /* ★ 옛 릴레이 주소·옛 채널ID 마이그레이션 (사용자 보고 2026-06-15) — 릴레이가 myhealthdiary.duckdns.org → relay.school114.org 로 이전됨.
     *  옛 주소(relay.school114.org 아님) 이거나 채널ID가 UUID 형식이 아니면(옛 ch_ 형식) → 새 기본 주소로 교정 + 죽은 채널 정리.
     *  반드시 위 _kioskChannelBackup 복원 '직후'에 실행해야 옛값이 되살아나지 않는다. 다음 [생성] 때 새 채널이 발급된다. */
    (function(){
      try{
        var _k=S.kioskSettings; if(!_k) return;
        var _UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        var _badRelay = _k.relayUrl && String(_k.relayUrl).indexOf('relay.school114.org')===-1;
        var _badChan  = _k.channelId && !_UUID.test(String(_k.channelId));
        if(_badRelay || _badChan){
          _k.relayUrl='https://relay.school114.org';
          delete _k.channelId; delete _k.authToken; delete _k.nurseToken; _k.urlReady=false;
          localStorage.setItem('ec_kiosk',JSON.stringify(_k));
          if(window.electronAPI&&window.electronAPI.jsonSaveCommon) window.electronAPI.jsonSaveCommon('kiosk_settings',_k);
          console.log('[KIOSK] 옛 릴레이 주소/채널 마이그레이션 — relay.school114.org 로 교정, 죽은 채널 정리됨');
        }
      }catch(_){}
    })();
    /* ★ 웹 클라이언트 회귀 수정 (2026-06-14): 웹 브라우저 동료는 localStorage 가 비어 S.kioskSettings 가
     *  초기엔 {} 라, active·channelId·nurseToken 이 오직 이 비동기 DB 로드로만 채워진다. 그런데 _init(500ms)는
     *  그 전에 이미 돌아 _connect 를 건너뛰고 다시 트리거할 게 없어 키오스크 수신이 클라이언트엔 안 왔다.
     *  로드 직후 sidebar-refresh 를 발사 → 수신 패널이 active 면 릴레이에 연결(같은 채널의 모든 nurse 에 브로드캐스트).
     *  호스트는 이미 연결돼 있어 !_connected 가드로 무해, active=false 면 조용히 정리. */
    try{ bus.emit('kiosk:sidebar-refresh'); }catch(e){}
  }});
  }
  commonMappings.push({dbKey:'bed_config',lsKey:'ec_bed_config',onLoaded:function(data){
    if(data&&typeof data==='object'){S._bedConfigRaw=data;S._bedConfig=Object.assign({beds:[{id:1}],placement:'left'},data);}
  }});
  yearMappings.push({dbKey:'bed_usage',lsKey:'ec_bed_usage',onLoaded:function(data){
    if(Array.isArray(data))S._bedUsage=data;
  }});
  commonMappings.push({dbKey:'meddb_user',lsKey:'ec_meddb_user',onLoaded:function(data){
    if(data&&typeof data==='object')S._medDbUser=data;
  }});
  commonMappings.push({dbKey:'sym_meds',lsKey:'ec_sym_meds',onLoaded:function(data){
    if(data&&typeof data==='object')S._symMeds=data;
  }});
  commonMappings.push({dbKey:'sym_ointments',lsKey:'ec_sym_ointments',onLoaded:function(data){
    if(Array.isArray(data))S._symOintments=data;
  }});
  commonMappings.push({dbKey:'sym_patches',lsKey:'ec_sym_patches',onLoaded:function(data){
    if(Array.isArray(data))S._symPatches=data;
  }});
  commonMappings.push({dbKey:'tbTestData',lsKey:'ec_tbTestData',onLoaded:function(data){
    if(Array.isArray(data))S._apTbSearchData=data;
  }});
  commonMappings.push({dbKey:'weightMgmt',lsKey:'ec_weightMgmt',onLoaded:function(data){
    if(Array.isArray(data)){
      S._wtData=data;
      if(typeof S._wtData!=='undefined')S._wtData=data;
    }
  }});
  commonMappings.push({dbKey:'magic_slides',lsKey:'ec_magic_slides',onLoaded:null});
  commonMappings.push({dbKey:'magic_memolist',lsKey:'ec_magic_memolist',onLoaded:null});
  commonMappings.push({dbKey:'magic_routines',lsKey:'ec_magic_routines',onLoaded:null});
  commonMappings.push({dbKey:'magic_todos',lsKey:'ec_magic_todos',onLoaded:null});
  commonMappings.push({dbKey:'magic_links',lsKey:'ec_magic_links',onLoaded:function(data){
    if(Array.isArray(data))S.magicLinks=data;
  }});
  commonMappings.push({dbKey:'magic_links2',lsKey:'ec_magic_links2',onLoaded:null});
  commonMappings.push({dbKey:'gp2_routines',lsKey:'ec_gp2_routines',onLoaded:null});
  commonMappings.push({dbKey:'gp2_gtodos',lsKey:'ec_gp2_gtodos',onLoaded:null});
  commonMappings.push({dbKey:'magic_memos',lsKey:'ec_magic_memos',onLoaded:function(data){
    if(Array.isArray(data))S.magicMemos=data;
  }});
  commonMappings.push({dbKey:'custom_surveys',lsKey:'ec_custom_surveys',onLoaded:null});
  commonMappings.push({dbKey:'sv_custom',lsKey:'ec_sv_custom',onLoaded:function(data){
    if(Array.isArray(data)){
      S.svCustomSurveys=data;
      const wsc=getSvWorkspaceCache();if(wsc)wsc.customSurveys=data;
    }
  }});
  commonMappings.push({dbKey:'sv_history',lsKey:'ec_sv_history',onLoaded:function(data){
    const wsc=getSvWorkspaceCache();if(Array.isArray(data)&&wsc)wsc.history=data;
  }});
  commonMappings.push({dbKey:'sv_activities',lsKey:'ec_sv_activities',onLoaded:function(data){
    const wsc=getSvWorkspaceCache();if(Array.isArray(data)&&wsc)wsc.activities=data;
  }});
  commonMappings.push({dbKey:'sv_active',lsKey:'ec_sv_active',onLoaded:function(data){
    const wsc=getSvWorkspaceCache();if(Array.isArray(data)&&wsc)wsc.activeSurveys=data;
  }});
  commonMappings.push({dbKey:'vp_custom_formats',lsKey:'ec_vp_custom_formats',onLoaded:function(data){
    if(data&&typeof data==='object')S.vpCustomFormats=data;
  }});
  commonMappings.push({dbKey:'vp_stamps',lsKey:'ec_vp_stamps',onLoaded:null});
  commonMappings.push({dbKey:'vp_signs',lsKey:'ec_vp_signs',onLoaded:null});
  commonMappings.push({dbKey:'vp_custom_names',lsKey:'ec_vp_custom_names',onLoaded:null});
  commonMappings.push({dbKey:'vp_custom_slots',lsKey:'ec_vp_custom_slots',onLoaded:null});
  /* 커스텀 양식 사용자 수정 보존 보강 (2026-06-11 감사) — 라벨·확인문/푸터·추가 행·필요/이유 삭제·빌트인 문구 4종.
   * 저장은 _vpPersistCommonState(또는 dbSet)가 이미 DB 에 쓰고 있었으나 부팅 복원 매핑이 누락 → localStorage 유실 시 미복원이던 구멍. */
  commonMappings.push({dbKey:'vp_custom_labels',lsKey:'ec_vp_custom_labels',onLoaded:null});
  commonMappings.push({dbKey:'vp_custom_blocks',lsKey:'ec_vp_custom_blocks',onLoaded:null});
  commonMappings.push({dbKey:'vp_custom_rows',lsKey:'ec_vp_custom_rows',onLoaded:null});
  commonMappings.push({dbKey:'vp_reason_removed',lsKey:'ec_vp_reason_removed',onLoaded:null});
  commonMappings.push({dbKey:'vp_tpl_visitPass',lsKey:'ec_vp_tpl_visitPass',onLoaded:null});
  commonMappings.push({dbKey:'vp_tpl_restReferral',lsKey:'ec_vp_tpl_restReferral',onLoaded:null});
  commonMappings.push({dbKey:'vp_tpl_meal',lsKey:'ec_vp_tpl_meal',onLoaded:null});
  commonMappings.push({dbKey:'vp_tpl_referral',lsKey:'ec_vp_tpl_referral',onLoaded:null});
  commonMappings.push({dbKey:'ems_saved',lsKey:'ec_ems_saved',onLoaded:null});
  commonMappings.push({dbKey:'feedback_data',lsKey:'ec_feedback',onLoaded:function(data){
    if(Array.isArray(data))S._fbData=data;
  }});
  commonMappings.push({dbKey:'tab_order',lsKey:'ec_tab_order',onLoaded:null});
  commonMappings.push({dbKey:'tab_visibility',lsKey:'ec_tab_visibility',onLoaded:null});
  commonMappings.push({dbKey:'col_widths',lsKey:'ec_col_widths',onLoaded:function(data){
    /* 열너비 정화 — {열번호:px(20~1200)} 만 추출. 래퍼 키(success 등)·배열·쓰레기값 제거 (2026-06-12) */
    function _dlSanColW(o){
      if(!o||typeof o!=='object'||Array.isArray(o))return null;
      const out={};Object.keys(o).forEach(function(k){const n=Math.round(parseFloat(o[k]));if(isFinite(n)&&n>=20&&n<=1200)out[k]=n;});
      return Object.keys(out).length?out:null;
    }
    /* 과거 이중 래핑 손상 복구 — 단, "정상 px 맵 + 래퍼 키"가 합쳐진 손상(2026-06-12 발견)은
     * 최상층이 가장 최신 데이터이므로 층마다 정화를 먼저 시도하고, 실패할 때만 한 겹 더 벗긴다.
     * (옛 코드는 무조건 data.data 로 파고들어 최상층의 정상 값을 버렸음) */
    let _clean=null,_g=0,_cur=data;
    while(_g++<200){
      _clean=_dlSanColW(_cur);
      if(_clean)break;
      if(_cur&&typeof _cur==='object'&&!Array.isArray(_cur)&&('data' in _cur)&&('success' in _cur)){ _cur=_cur.data; continue; }
      break;
    }
    /* 옛 측정 배열 포맷은 폐기 (2026-06-11) — 렌더 측정 px 배열이 저장소에 박제되면
     * 일시적으로 깨진 레이아웃까지 영구 복원되는 사고(열 짜부 박제). {열번호:px} 객체만 유효. */
    if(!_clean){
      try{ const _ex=JSON.parse(localStorage.getItem('ec_col_widths')); if(Array.isArray(_ex))localStorage.removeItem('ec_col_widths'); }catch(_){}
      /* 저장소의 배열/쓰레기 값은 그대로 두면 매 부팅 fallback 을 죽이므로 즉시 빈 객체로 정리 (2026-06-12) */
      if(data!=null){ try{ if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',{}); }catch(_){} }
      return;
    }
    try{ localStorage.setItem('ec_col_widths', JSON.stringify(_clean)); }catch(_){}
    /* 손상이 있었다면 정화본으로 저장소 역수리 */
    if(JSON.stringify(_clean)!==JSON.stringify(data)){ try{ if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',_clean); }catch(_){} }
  }});
  commonMappings.push({dbKey:'magic_layout_order',lsKey:'ec_magic_layout_order',onLoaded:function(data){
    if(Array.isArray(data))S.magicLayoutItems=data;
  }});
  commonMappings.push({dbKey:'granted_users',lsKey:'ec_granted_users',onLoaded:function(data){
    if(Array.isArray(data))S._grantedUsers=data;
  }});
  commonMappings.push({dbKey:'weather_data',lsKey:'ec_weather',onLoaded:function(data){
    if(data&&typeof data==='object')S.weatherData=data;
  }});
  commonMappings.push({dbKey:'cdkey_data',lsKey:'ec_cdkey',onLoaded:null});
  commonMappings.push({dbKey:'bg_mode',lsKey:'ec_bg_mode',onLoaded:null});
  commonMappings.push({dbKey:'bg_selected',lsKey:'ec_bg_selected',onLoaded:null});
  commonMappings.push({dbKey:'bg_random_daily',lsKey:'ec_bg_random_daily',onLoaded:null});
  commonMappings.push({dbKey:'bg_random_weekly',lsKey:'ec_bg_random_weekly',onLoaded:null});
  commonMappings.push({dbKey:'record_mode',lsKey:'ec_recordMode',onLoaded:null});
  commonMappings.push({dbKey:'gsheets',lsKey:'ec_gsheets',onLoaded:null});
  commonMappings.push({dbKey:'physical_exam',lsKey:'ec_physical_exam',onLoaded:function(data){
    if(data&&typeof data==='object')S._peData=data;
  }});
  commonMappings.push({dbKey:'cdkey_activated',lsKey:'ec_cdkey_activated',onLoaded:null});
  /* cdkey_license: 인증코드 활성화 정보 JSON ({key, verifiedAt, machineId}).
   * DB → localStorage 복원되어야 같은 PC 에서 재설치/업데이트 후에도 활성화 상태 유지. */
  commonMappings.push({dbKey:'cdkey_license',lsKey:'ec_cdkey_license',onLoaded:null});
  /* ── 사용자 커스터마이징 (보건일지 설정 등에서 사용자가 추가/숨김 처리한 것들) ──
   * 이중 저장(localStorage + DB blob) 되지만, 부팅 시 hydration 매핑이 누락되어 있어서
   * localStorage 가 어떤 이유로든 비워지면 DB 에 있어도 화면에 안 나타나는 회귀가 발생했음.
   * 회전문구·증상·약품 모든 사용자 추가분이 동일 패턴 → 한 번에 매핑 추가. */
  commonMappings.push({dbKey:'header_msgs_user',lsKey:'ec_header_msgs_user',onLoaded:null});
  commonMappings.push({dbKey:'footer_msgs',lsKey:'ec_footer_msgs',onLoaded:null});
  commonMappings.push({dbKey:'user_symptoms',lsKey:'ec_user_symptoms',onLoaded:null});
  commonMappings.push({dbKey:'hidden_symptoms',lsKey:'ec_hidden_symptoms',onLoaded:null});
  commonMappings.push({dbKey:'sym_order',lsKey:'ec_sym_order',onLoaded:null});
  /* 상분류(카테고리) 사용자 편집 — 이름변경·추가 분류·가림·순서·아이콘 + 중분류 별칭(통계 승계) (2026-06-12) */
  commonMappings.push({dbKey:'renamed_sym_cats',lsKey:'ec_renamed_sym_cats',onLoaded:null});
  commonMappings.push({dbKey:'user_sym_cats',lsKey:'ec_user_sym_cats',onLoaded:null});
  commonMappings.push({dbKey:'hidden_sym_cats',lsKey:'ec_hidden_sym_cats',onLoaded:null});
  commonMappings.push({dbKey:'sym_cat_order',lsKey:'ec_sym_cat_order',onLoaded:null});
  commonMappings.push({dbKey:'sym_cat_icons',lsKey:'ec_sym_cat_icons',onLoaded:null});
  commonMappings.push({dbKey:'sym_renames',lsKey:'ec_sym_renames',onLoaded:null});
  commonMappings.push({dbKey:'user_med_syms',lsKey:'ec_user_med_syms',onLoaded:null});
  /* 사용자가 "+ 약품 추가" 로 명시 등록한 약품 set — 카드 목록 표시 대상 */
  commonMappings.push({dbKey:'user_added_meds',lsKey:'ec_user_added_meds',onLoaded:null});
  /* ✏️ 미니 팝업 시스템 매칭 prefill 완료 플래그 — 학교 이동/재설치 시에도 사용자의 ✕ 편집 결과 보존 */
  commonMappings.push({dbKey:'user_med_syms_prefilled',lsKey:'ec_user_med_syms_prefilled',onLoaded:null});
  commonMappings.push({dbKey:'med_hidden',lsKey:'ec_med_hidden',onLoaded:null});
  /* 약품 별명 — 사용자가 변경한 약품 표시 이름. 업데이트/재설치 시에도 보존되어야 함 */
  commonMappings.push({dbKey:'med_renames',lsKey:'ec_med_renames',onLoaded:null});
  commonMappings.push({dbKey:'user_fav_treatments',lsKey:'ec_user_fav_treatments',onLoaded:null});
  commonMappings.push({dbKey:'user_demoted_treatments',lsKey:'ec_user_demoted_treatments',onLoaded:null});
  /* 증상별 자주 쓰는 처치·처치 이름변경·증상별 제거 — 저장(syncAll)은 DB 공유 store 에 되는데 로드 매핑이 빠져
   * 웹 협업 시 클라이언트가 호스트의 자주 쓰는 처치 목록을 못 받던 문제 해결. localStorage 를 매번 새로 읽는 키라 onLoaded:null. (2026-06-04) */
  commonMappings.push({dbKey:'user_sym_fav',lsKey:'ec_user_sym_fav',onLoaded:null});
  commonMappings.push({dbKey:'user_sym_removed',lsKey:'ec_user_sym_removed',onLoaded:null});
  commonMappings.push({dbKey:'treat_renames',lsKey:'ec_treat_renames',onLoaded:null});
  commonMappings.push({dbKey:'quickMsgs',lsKey:'ec_quickMsgs',onLoaded:null});
  /* API 키 (재설치 시 복원) */
  commonMappings.push({dbKey:'kma_api_key',lsKey:'ec_kma_api_key',onLoaded:null});
  commonMappings.push({dbKey:'uv_api_key',lsKey:'ec_uv_api_key',onLoaded:null});
  commonMappings.push({dbKey:'airkorea_api_key',lsKey:'ec_airkorea_api_key',onLoaded:null});
  commonMappings.push({dbKey:'drug_api_key',lsKey:'ec_drug_api_key',onLoaded:null});
  commonMappings.push({dbKey:'hira_api_key',lsKey:'ec_hira_api_key',onLoaded:null});
  commonMappings.push({dbKey:'emergency_api_key',lsKey:'ec_emergency_api_key',onLoaded:null});
  /* 기준위치 주소·좌표 — 영구 저장으로 변경 (이전엔 localStorage 만 의존하여 사라짐) */
  commonMappings.push({dbKey:'school_address',lsKey:'ec_school_address',onLoaded:null});
  commonMappings.push({dbKey:'school_lat',lsKey:'ec_school_lat',onLoaded:null});
  commonMappings.push({dbKey:'school_lng',lsKey:'ec_school_lng',onLoaded:null});
  commonMappings.push({dbKey:'infectious_api_key',lsKey:'ec_infectious_api_key',onLoaded:null});
  commonMappings.push({dbKey:'kdca_api_key',lsKey:'ec_kdca_api_key',onLoaded:null});
  /* 오늘의 메모 설정 (on/칸수/제목) — 업데이트·재설치 보존 (2026-06-10) */
  commonMappings.push({dbKey:'today_memo_settings',lsKey:'ec_today_memo_settings',onLoaded:null});
  /* 일지 출력 열 너비 (표시 항목 칩 px 조절) — 업데이트·재설치 보존 (2026-06-11) */
  commonMappings.push({dbKey:'dp_col_widths',lsKey:'ec_dp_col_widths',onLoaded:null});
  /* 일반 일지 열 표시(바디맵 ON 등)·순서 — 사용자가 켠 상태는 업데이트·재설치에도 보존 (2026-06-12).
   * 실제 읽기는 사용자 키(dailyColVisibility_u<uid>) 우선이라 이 레거시 키는 사용자 키 부재 시
   * (localStorage 유실·재설치) getDailyColVisibility 가 사용자 키로 1회 이행하는 복원 통로. */
  commonMappings.push({dbKey:'daily_col_visibility',lsKey:'dailyColVisibility',onLoaded:null});
  commonMappings.push({dbKey:'daily_col_order',lsKey:'dailyColOrder',onLoaded:null});
  /* 카카오 API 키 — 사용자 개별 입력 (REST + JS) */
  commonMappings.push({dbKey:'kakao_rest_api_key',lsKey:'ec_kakao_rest_api_key',onLoaded:null});
  commonMappings.push({dbKey:'kakao_js_api_key',lsKey:'ec_kakao_js_api_key',onLoaded:null});
  /* 날씨/미세먼지 알림 설정 — 라디오·지역명·측정소명 (재시작 후에도 유지) */
  commonMappings.push({dbKey:'weather_source',lsKey:'ec_weather_source',onLoaded:null});
  commonMappings.push({dbKey:'user_region',lsKey:'ec_user_region',onLoaded:null});
  commonMappings.push({dbKey:'airkorea_station',lsKey:'ec_airkorea_station',onLoaded:null});
  /* "반영됨" 플래그 — 재시작 후에도 ✓ 완료 버튼 상태 유지 */
  ['kma_api_key','uv_api_key','airkorea_api_key','drug_api_key','kakao_rest_api_key','kakao_js_api_key',
   'hira_api_key','emergency_api_key','kdca_api_key','user_region','airkorea_station'].forEach(function(k){
    commonMappings.push({dbKey:k+'_applied',lsKey:'ec_'+k+'_applied',onLoaded:null});
  });

  persistenceOrchestrator.loadMappings({
    year:yr,
    commonMappings:commonMappings,
    yearMappings:yearMappings,
    editorSlots:['default','custom1','custom2','custom3','custom4','custom5','custom6','custom7','custom8','custom9','custom10','custom11','custom12','custom13','custom14','custom15']
  });
}

/* ── 더미 데이터 (제거됨) ── */
export function _removeDummyData(){
  alert('더미 데이터 자동 로드는 제거되었습니다. 이제는 DB를 직접 정리하거나 시드 스크립트를 사용하지 않는 방식으로 관리합니다.');
}

/* ── 로그인 직후 — 개인 키(vp_stamps 등) 재로드 ──
 *  module load 시점의 데이터 로드는 로그인 전이라 IPC 측에서 빈 값을 반환했음.
 *  로그인 후 사용자 ID 가 정해진 시점에 다시 dbGet 으로 가져와 localStorage 를 갱신.
 *  splash-login-controller 가 로그인 성공 직후 호출. */
export async function reloadPersonalKeysFromDB(){
  if(typeof window.electronAPI==='undefined'||!window.electronAPI.dbGet)return;
  const pairs=[
    ['vp_stamps','ec_vp_stamps'],
    ['vp_signs','ec_vp_signs'],
  ];
  for(const [dbKey,lsKey] of pairs){
    try{
      const r=await window.electronAPI.dbGet('common',dbKey);
      if(r&&r.success&&r.exists&&r.data!=null){
        const v=typeof r.data==='string'?r.data:JSON.stringify(r.data);
        try{localStorage.setItem(lsKey,v);}catch(_){}
      } else {
        /* DB 에 없으면 localStorage 도 비움 — 이전 사용자 잔여물 제거 */
        try{localStorage.removeItem(lsKey);}catch(_){}
      }
    }catch(e){console.error('[reloadPersonalKeysFromDB]',dbKey,e&&e.message);}
  }
}

/* ── 모든 중요 데이터를 JSON 파일로 동기화 ── */
let _jsonSyncTimer=null;
export function _syncAllToJson(){
  if(typeof window.electronAPI==='undefined'||!window.electronAPI.jsonSaveCommon)return;
  const _api=window.electronAPI;
  const commonKeys=[
    ['settings','ec_settings'],['treatmentMap','ec_treatmentMap'],['medicationMap','ec_medicationMap'],
    ['memos','ec_memos'],['vip_tags','ec_vip_tags'],
    ['user_profile','ec_user'],['bed_config','ec_bed_config'],
    ['meddb_user','ec_meddb_user'],['sym_meds','ec_sym_meds'],['sym_ointments','ec_sym_ointments'],
    ['sym_patches','ec_sym_patches'],
    ['magic_slides','ec_magic_slides'],['magic_memolist','ec_magic_memolist'],
    ['magic_routines','ec_magic_routines'],['magic_todos','ec_magic_todos'],
    ['magic_links','ec_magic_links'],['magic_links2','ec_magic_links2'],
    ['gp2_routines','ec_gp2_routines'],['gp2_gtodos','ec_gp2_gtodos'],
    ['magic_memos','ec_magic_memos'],
    ['custom_surveys','ec_custom_surveys'],
    ['vp_custom_formats','ec_vp_custom_formats'],['vp_stamps','ec_vp_stamps'],['vp_signs','ec_vp_signs'],
    ['vp_custom_names','ec_vp_custom_names'],['vp_custom_slots','ec_vp_custom_slots'],
    /* 커스텀 양식 수정 보존 보강 (2026-06-11 감사) — 로드 매핑과 짝 맞춤 (한쪽만 있으면 빈 DB값이 LS 덮어쓰는 회귀 방지) */
    ['vp_custom_labels','ec_vp_custom_labels'],['vp_custom_blocks','ec_vp_custom_blocks'],
    ['vp_custom_rows','ec_vp_custom_rows'],['vp_reason_removed','ec_vp_reason_removed'],
    ['vp_tpl_visitPass','ec_vp_tpl_visitPass'],['vp_tpl_restReferral','ec_vp_tpl_restReferral'],
    ['vp_tpl_meal','ec_vp_tpl_meal'],['vp_tpl_referral','ec_vp_tpl_referral'],
    ['ems_saved','ec_ems_saved'],['feedback_data','ec_feedback'],
    /* col_widths 는 일반 페어에서 제외 (2026-06-12) — 무검증 복사가 옛 측정 배열을 store 에
     * 박제해 부팅 fallback 을 죽이던 사고. 아래 전용 블록(사용자 키 우선 + 객체 검증)만 저장한다. */
    ['tab_order','ec_tab_order'],['tab_visibility','ec_tab_visibility'],
    /* 일지 출력 열 너비 + 오늘의 메모 설정 — 로드(commonMappings)만 있고 저장 누락 시
     * 부팅 때 빈 DB값이 LS 를 덮어 초기화되는 버그의 원인 (사용자 보고 2026-06-11 fix) */
    ['dp_col_widths','ec_dp_col_widths'],['today_memo_settings','ec_today_memo_settings'],
    ['magic_layout_order','ec_magic_layout_order'],['granted_users','ec_granted_users'],
    ['weather_data','ec_weather'],['cdkey_data','ec_cdkey'],
    ['drive_sync_config','drive_sync_config'],['physical_exam','ec_physical_exam'],
    ['bg_mode','ec_bg_mode'],['bg_selected','ec_bg_selected'],
    ['bg_random_daily','ec_bg_random_daily'],['bg_random_weekly','ec_bg_random_weekly'],
    ['record_mode','ec_recordMode'],['font_scale','ec_fontScale'],['theme','ec_theme'],
    ['gsheets','ec_gsheets'],['cdkey_activated','ec_cdkey_activated'],
    ['cdkey_license','ec_cdkey_license'],
    /* ── 약품·증상 사용자 커스텀 키 JSON 백업 안전망 (2026-05-28 추가) ──
     * 정식 버전 업데이트·재설치 시 사용자가 만든 매칭·숨김·이름변경·추가 항목 보존 보강.
     * sqlite 가 손상되어도 JSON 파일에서 복구 가능. */
    ['user_med_syms','ec_user_med_syms'],
    ['user_added_meds','ec_user_added_meds'],
    ['user_med_syms_prefilled','ec_user_med_syms_prefilled'],
    ['med_hidden','ec_med_hidden'],
    ['med_renames','ec_med_renames'],
    ['user_symptoms','ec_user_symptoms'],
    ['hidden_symptoms','ec_hidden_symptoms'],
    ['sym_order','ec_sym_order'],
    ['renamed_sym_cats','ec_renamed_sym_cats'],
    ['user_sym_cats','ec_user_sym_cats'],
    ['hidden_sym_cats','ec_hidden_sym_cats'],
    ['sym_cat_order','ec_sym_cat_order'],
    ['sym_cat_icons','ec_sym_cat_icons'],
    ['sym_renames','ec_sym_renames'],
    ['treat_renames','ec_treat_renames'],
    ['user_sym_fav','ec_user_sym_fav'],
    ['user_sym_removed','ec_user_sym_removed'],
    ['user_fav_treatments','ec_user_fav_treatments'],
    ['user_demoted_treatments','ec_user_demoted_treatments'],
    /* 홈 대시보드 로컬 일정 (구글 연동 없이 사용 시) — sqlite 손상 대비 JSON 백업 */
    ['home_local_events','ec_home_local_events'],
  ];
  if(typeof S.deptMappingText==='string'&&S.deptMappingText)
    _api.jsonSaveCommon('deptMapping', S.deptMappingText);
  if(typeof S._vipTags==='object'&&S._vipTags)
    _api.jsonSaveCommon('vip_tags', S._vipTags);
  if(typeof S._userProfile==='object'&&S._userProfile)
    _api.jsonSaveCommon('user_profile', S._userProfile);
  if(Array.isArray(S._grantedUsers))
    _api.jsonSaveCommon('granted_users', S._grantedUsers);
  /* 열 너비 — 사용자 지정 {열번호:px} 객체만 저장 (2026-06-11).
   * 옛: 렌더 측정 배열 S._colWidths 를 저장 → ①깨진 레이아웃까지 영구 박제 ②사용자가
   * 직접 설정한 객체(dbSet 경로)를 주기 동기화가 배열로 되덮는 충돌. 측정 캐시는 세션 한정. */
  try{
    let _cw=null;
    try{ _cw=JSON.parse(localStorage.getItem('ec_col_widths_u'+(S._currentUser&&S._currentUser.id?S._currentUser.id:'default'))); }catch(_){}
    if(!_cw||Array.isArray(_cw)){ try{ _cw=JSON.parse(localStorage.getItem('ec_col_widths')); }catch(_){} }
    /* 저장 전 정화 (2026-06-12) — 래퍼 키({success,exists,data})·비정상값이 섞인 객체가
     * "비어있지 않은 객체" 검사를 통과해 store 를 오염시키던 구멍을 막는다. */
    if(_cw&&typeof _cw==='object'&&!Array.isArray(_cw)){
      const _sw={};Object.keys(_cw).forEach(function(k){const n=Math.round(parseFloat(_cw[k]));if(isFinite(n)&&n>=20&&n<=1200)_sw[k]=n;});
      if(Object.keys(_sw).length)_api.jsonSaveCommon('col_widths', _sw);
    }
  }catch(_){}
  /* 일반 일지 열 표시/순서 — 사용자 키 우선 저장 (바디맵 ON 등 보존, 2026-06-12) */
  try{
    const _uidCv=(S._currentUser&&S._currentUser.id)?S._currentUser.id:'default';
    [['daily_col_visibility','dailyColVisibility'],['daily_col_order','dailyColOrder']].forEach(function(p){
      const raw=localStorage.getItem(p[1]+'_u'+_uidCv)||localStorage.getItem(p[1]);
      if(raw!=null){ try{ _api.jsonSaveCommon(p[0], JSON.parse(raw)); }catch(_){} }
    });
  }catch(_){}
  if(typeof S._apTbSearchData!=='undefined'&&Array.isArray(S._apTbSearchData))
    _api.jsonSaveCommon('tbTestData', S._apTbSearchData);
  if(typeof S._wtData!=='undefined'&&Array.isArray(S._wtData)&&S._wtData.length)
    _api.jsonSaveCommon('weightMgmt', S._wtData);
  const _wsc=getSvWorkspaceCache();
  if(typeof _wsc==='object'&&_wsc){
    if(Array.isArray(_wsc.customSurveys)) _api.jsonSaveCommon('sv_custom', _wsc.customSurveys);
    if(Array.isArray(_wsc.activeSurveys)) _api.jsonSaveCommon('sv_active', _wsc.activeSurveys);
    if(Array.isArray(_wsc.activities))    _api.jsonSaveCommon('sv_activities', _wsc.activities);
    if(Array.isArray(_wsc.history))       _api.jsonSaveCommon('sv_history', _wsc.history);
  }
  commonKeys.forEach(function(pair){
    const raw=localStorage.getItem(pair[1]);
    if(raw!=null){
      try{const parsed=JSON.parse(raw);_api.jsonSaveCommon(pair[0],parsed);}catch(e){
        _api.jsonSaveCommon(pair[0],raw);
      }
    }
  });
  const yearKeys=[
    ['emergency_records','ec_emergency_records'],['infection_records','ec_infection_records'],
    ['infection_notes','ec_infection_notes'],['bed_usage','ec_bed_usage']
  ];
  persistenceOrchestrator.syncAll({
    year:String(_academicYear()),
    commonKeys:commonKeys,
    yearKeys:yearKeys,
    records:(typeof S.records!=='undefined'&&Array.isArray(S.records))?S.records:null,
    people:(typeof S.people!=='undefined'&&Array.isArray(S.people))?S.people:null,
    editorPrefix:'ec_vp_editor_'
  });
}
_jsonSyncTimer=setInterval(_syncAllToJson,120000);

/* ── 저장 함수 ── */
let _saveDataTimer=null;
let _jsonSaveTimer=null;
let _jsonStuTimer=null;

export function saveData(opts){
  if(_jsonSaveTimer)clearTimeout(_jsonSaveTimer);
  _jsonSaveTimer=setTimeout(function(){
    if(window.electronAPI&&window.electronAPI.recordsDailyUpdate){
      const dirty=S.records.filter(function(r){return r._dirty&&!r._isDummy;});
      dirty.forEach(function(r){
        window.electronAPI.recordsDailyUpdate(_recToDbRow(r)).catch(function(err){console.error('[DB] daily update 실패:',err);});
        delete r._dirty;
      });
    }
    if(window.electronAPI&&window.electronAPI.peopleSaveAll){
      window.electronAPI.peopleSaveAll(S.people).then(function(){
        _pushRosterToRelay();
        _checkKioskRosterStale();
      }).catch(function(err){console.error('[DB] people 저장 실패:',err);});
    }
  },1000);
  if(opts&&opts.silent)return;
  /* 실제로 저장할 dirty 레코드가 없으면 토스트를 띄우지 않음 */
  const hasDirty=Array.isArray(S.records)&&S.records.some(function(r){return r._dirty&&!r._isDummy;});
  if(!hasDirty)return;
  const ecOpen=document.getElementById('ecFormOverlay');
  const infOpen=document.getElementById('infFormOverlay');
  if((ecOpen&&ecOpen.classList.contains('show'))||(infOpen&&infOpen.classList.contains('show')))return;
  const svTab=document.getElementById('dailyCat-survey');
  if(svTab&&svTab.classList.contains('active'))return;
  const svWizard=document.getElementById('sv-wizard');
  if(svWizard&&svWizard.style.display!=='none')return;
  const toast=document.getElementById('globalSaveToast');
  if(toast){
    toast.textContent='저장 중…';
    toast.className='global-save-toast show saving';
    if(_saveDataTimer)clearTimeout(_saveDataTimer);
    _saveDataTimer=setTimeout(function(){
      toast.textContent='모든 내용이 저장되었습니다.';
      toast.className='global-save-toast show';
      setTimeout(function(){toast.className='global-save-toast';},3000);
    },300);
  }
}
export function saveRecordNow(rec){
  if(!rec)return;
  /* 삭제된 레코드는 절대 재저장(재삽입)하지 않는다 — "삭제는 영구" (2026-06-07 협업 동기화).
   * 삭제 후 남아있던 closure 가 saveRecordNow 를 늦게 호출해 _dbId 없는 사본을 새로 INSERT → 재생성되던 경로 차단. */
  if(rec._deleted)return;
  rec._dirty=false;
  /* 최근 저장 타임스탬프 — 실시간 머지가 이 레코드를 7초간 덮어쓰지 않도록 */
  rec._savedAt=Date.now();
  if(!window.electronAPI)return;
  /* 실제 기록 저장 → "저장 중→모든 내용이 저장되었습니다" 토스트 (셀편집·V/S·바디맵·증상·재상담일 등 일괄).
     검색·필터·조회는 saveRecordNow 를 호출하지 않으므로 거짓 신호 없음 (사용자 지시 2026-06-15). */
  try{ bus.emit('toast:saveLater'); }catch(_){}
  /* 레코드가 DB 에 아직 삽입되지 않았거나 삽입 진행 중이면 — pending 플래그로 이어서 처리 */
  if(rec._inserting){rec._pendingUpdate=true;return;}
  if(!rec._dbId&&window.electronAPI.recordsDailyInsert){
    rec._inserting=true;
    const row=_recToDbRow(rec);
    row.school_year=String(_academicYear(rec.date)); /* 방문 날짜 기준 학년도(3/1) — 현재날짜로 덮어쓰면 과거날짜 기록이 잘못 박힘 (사용자 지시 2026-06-20) */
    window.electronAPI.recordsDailyInsert(row).then(function(res){
      rec._inserting=false;
      if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;rec._savedAt=Date.now();}
      if(rec._pendingUpdate){rec._pendingUpdate=false;saveRecordNow(rec);}
    }).catch(function(err){rec._inserting=false;console.error('[DB] daily insert 실패:',err);});
    return;
  }
  if(window.electronAPI.recordsDailyUpdate){
    window.electronAPI.recordsDailyUpdate(_recToDbRow(rec)).then(function(){rec._savedAt=Date.now();}).catch(function(err){console.error('[DB] daily update 실패:',err);});
  }
}
/* 전역 삭제 완료 레코드 ID 목록 — 머지가 다시 복원시키지 않도록 */
if(!window._recentlyDeletedRecs)window._recentlyDeletedRecs={};
export function saveStudents(opts){
  if(_jsonStuTimer)clearTimeout(_jsonStuTimer);
  const reload=opts&&opts.reload;
  _jsonStuTimer=setTimeout(function(){
    if(window.electronAPI&&window.electronAPI.peopleSaveAll){
      window.electronAPI.peopleSaveAll(S.people).then(function(){
        if(reload) return _reloadStudentsFromDB();
      }).catch(function(err){console.error('[DB] people 저장 실패:',err);});
    }
  },reload?0:500);
}

/* ── beforeunload: 앱 종료 직전 flush ── */
window.addEventListener('beforeunload',function(){
  if(_jsonSaveTimer){clearTimeout(_jsonSaveTimer);_jsonSaveTimer=null;}
  if(_jsonStuTimer){clearTimeout(_jsonStuTimer);_jsonStuTimer=null;}
  _syncAllToJson();
  if(typeof window.electronAPI!=='undefined'&&window.electronAPI.jsonFlush){
    const _flushStudents=S.people.map(function(s){
      if(s._wasDummy){const c=Object.assign({},s);delete c._wasDummy;return c;}
      return s;
    });
    const _flushRecords=S.records.filter(function(r){return !r._isDummy;});
    const flushItems=[
      {key:'records',data:_flushRecords,common:false},
      {key:'students',data:_flushStudents,common:true}
    ];
    if(typeof S.ecRecords!=='undefined'&&Array.isArray(S.ecRecords)&&S.ecRecords.length>0){
      flushItems.push({key:'emergency_records',data:S.ecRecords,common:false});
    }
    if(typeof S.infRecords!=='undefined'&&Array.isArray(S.infRecords)&&S.infRecords.length>0){
      flushItems.push({key:'infection_records',data:S.infRecords,common:false});
    }
    if(typeof S.infNotes!=='undefined'&&S.infNotes&&typeof S.infNotes==='object'){
      flushItems.push({key:'infection_notes',data:S.infNotes,common:false});
    }
    window.electronAPI.jsonFlush(flushItems);
  }
});
