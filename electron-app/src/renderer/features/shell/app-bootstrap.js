/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { switchView } from './view-router.js';
import { bus } from '../../core/event-bus.js';
import { bindViewDailyEvents, bindViewDashboardEvents, bindViewMagicEvents, bindViewStoryEvents, bindViewOrangeEvents, bindMagicSubSurveyEvents, bindMagicSubNewsletterEvents } from '../../core/event-bindings.js';
import { viewFragmentLoader } from '../../core/helpers.js';
import { S } from '../../core/app-state.js';
import { toDateStr } from '../../core/format-utils.js';
import { renderSettingsPanel } from '../settings/settings-view.js';
import { verifyCdkey, hasCdkeyLicense } from '../../core/cdkey-license.js';
import './update-overlay.js';  /* 종료 시 업데이트 적용 안내 오버레이 등록 (사이드 이펙트) */
import './auto-popup-drag.js'; /* 모든 팝업 제목 드래그 자동화 (사이드 이펙트) */
import './conn-toast.js';      /* 연결 상태 우하단 토스트 (사이드 이펙트) */
import './zoom-controller.js'; /* 화면 배율(글자크기) — Ctrl+휠 + html zoom (사이드 이펙트) */

/* ═══════════════════════════════════════════
   날짜 롤오버 감지 — 시스템/프로그램 ON 시 항상 오늘 날짜로 시작.
   사용자가 프로그램을 켜둔 채 컴퓨터를 끄면 다음 날 PC를 켜도
   S.selectedDate 가 어제 그대로 남아 있는 문제 해결.
   원칙: 사용자가 의도적으로 과거 날짜를 보고 있는 경우는 건드리지 않는다.
   판정: '직전 today' 값과 S.selectedDate 가 같으면 '오늘을 보고 있던 것' → 오늘로 갱신.
   트리거: visibilitychange / window focus / 60초 인터벌(안전망)
   ═══════════════════════════════════════════ */
let _lastSeenToday = toDateStr(new Date());
function _checkDateRollover(){
  const today = toDateStr(new Date());
  if(today === _lastSeenToday) return;
  /* 자정을 넘었음 — 사용자가 '오늘'(직전 today)을 보고 있던 경우만 자동 이동 */
  const wasShowingToday = (S.selectedDate === _lastSeenToday);
  _lastSeenToday = today;
  if(wasShowingToday){
    S.selectedDate = today;
    /* 캘린더 헤더(현재 월) 도 오늘 월로 이동 */
    const d = new Date();
    S.calYear = d.getFullYear();
    S.calMonth = d.getMonth();
    /* 보건일지·달력·대시보드 일괄 재렌더 */
    bus.emit('render:calendar');
    bus.emit('render:daily');
    bus.emit('render:dashboard');
    console.log('[date-rollover] 날짜 자동 갱신:', today);
  }
}
document.addEventListener('visibilitychange', function(){
  if(!document.hidden) _checkDateRollover();
});
window.addEventListener('focus', _checkDateRollover);
setInterval(_checkDateRollover, 60*1000);  /* 안전망: 1분마다 체크 */

/* ═══════════════════════════════════════════
   외부 API 키 번들 자동 적용
   — bundled-api-keys.js (빌드 시 임베드) 의 키를 첫 실행 시 localStorage 에 채움.
   사용자가 이미 입력한 값이 있으면 절대 덮어쓰지 않음. data.go.kr 공통 키이므로
   재설치·새 PC 설치 시에도 추가 입력 없이 바로 사용 가능. */
(async function _seedBundledApiKeys(){
  if(!window.electronAPI || !window.electronAPI.getBundledApiKeys) return;
  try{
    const bundled = await window.electronAPI.getBundledApiKeys();
    if(!bundled || typeof bundled !== 'object') return;
    const map = {
      kma_api_key:        'ec_kma_api_key',
      airkorea_api_key:   'ec_airkorea_api_key',
      drug_api_key:       'ec_drug_api_key',
      hira_api_key:       'ec_hira_api_key',
      emergency_api_key:  'ec_emergency_api_key',
      kakao_rest_api_key: 'ec_kakao_rest_api_key',
      kakao_js_api_key:   'ec_kakao_js_api_key'
    };
    Object.keys(map).forEach(function(srcKey){
      const v = (bundled[srcKey]||'').toString().trim();
      if(!v) return;
      const lsKey = map[srcKey];
      const cur = (localStorage.getItem(lsKey)||'').trim();
      if(cur) return; /* 사용자 값 보존 */
      localStorage.setItem(lsKey, v);
      /* 자동 반영 마커 — 설정 패널 "✓ 반영 완료" 배지 즉시 표시 */
      localStorage.setItem(lsKey+'_applied', v);
      /* 백엔드 JSON 파일 동기화 (data/*.json) — 사용자 입력과 동일 경로로 저장.
         재실행·재설치(userData 보존) 시에도 동일 키가 유지된다. */
      if(window.electronAPI && window.electronAPI.jsonSaveCommon){
        window.electronAPI.jsonSaveCommon(srcKey, v).catch(function(){});
        window.electronAPI.jsonSaveCommon(srcKey+'_applied', v).catch(function(){});
      }
    });
  }catch(_e){}
})();

/* ═══════════════════════════════════════════
   사전공개 Beta 만료 게이트 + 상부 배지 남은 일수
   ═══════════════════════════════════════════ */
function _fmtBetaTail(daysLeft, expiresStr){
  /* expiresStr: '2026-05-15' → '2026.5.15.' */
  const m=String(expiresStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ko = m ? (m[1]+'.'+parseInt(m[2],10)+'.'+parseInt(m[3],10)+'.') : expiresStr;
  return '(사전공개 Beta버전, ~'+ko+' 👉️ 남은 일수: '+Math.max(0,daysLeft)+'일)';
}
/* 만료 안내 모달 — 단일 버튼 "오렌지팜 홈페이지로 이동".
 * 매 실행마다 자동으로 한 번 + 락 대상(이름 검색창·상세 검색 버튼) 클릭/타이핑 시도 시 다시 표시.
 * Esc·배경 클릭으로 닫을 수 있다 (앱 자체를 차단하진 않고, 검색 기능만 락). */
function _showBetaExpiredModal(){
  if(document.getElementById('betaExpiredOverlay')) return; /* 중복 방지 */
  const ov=document.createElement('div');
  ov.id='betaExpiredOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:2147483646;display:flex;align-items:center;justify-content:center;animation:bxFadeIn .18s ease-out';
  ov.innerHTML='<div style="background:var(--card,#fff);border:1px solid var(--bdr,rgba(15,23,42,0.10));border-radius:16px;width:480px;max-width:92vw;box-shadow:0 28px 70px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.10);overflow:hidden;animation:bxPopIn .22s cubic-bezier(.2,.9,.3,1.1)">'
    + '<div style="padding:20px 24px 16px;border-bottom:1px solid var(--bdr,rgba(15,23,42,0.10));display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,rgba(239,68,68,0.07),transparent)">'
    +   '<div style="width:36px;height:36px;border-radius:10px;flex-shrink:0;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;line-height:1;box-shadow:0 4px 12px rgba(220,38,38,0.30)">!</div>'
    +   '<div style="font-size:16px;font-weight:800;color:var(--t1,#0f172a);letter-spacing:-0.2px">사용 기간 만료</div>'
    + '</div>'
    + '<div style="padding:22px 26px 8px;font-size:13.5px;color:var(--t1,#0f172a);line-height:1.85;font-weight:500">'
    +   '사용 기간이 만료되었습니다.<br>오렌지팜 홈페이지에서 새 프로그램을 다운로드 후 그대로 설치하여 <b style="font-weight:800">\'설정\'</b> 의 <b style="font-weight:800">\'오렌지톡 인증코드\'</b> 탭에서 인증코드를 넣어주세요. <span style="color:#0891b2;font-weight:800">즉시 사용 가능</span>합니다.'
    + '</div>'
    + '<div style="padding:18px 24px 22px;display:flex;justify-content:flex-end">'
    +   '<button id="betaGoSite" style="font-family:inherit;font-size:13.5px;padding:12px 26px;border-radius:11px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;border:none;font-weight:800;letter-spacing:0.2px;cursor:pointer;box-shadow:0 6px 16px rgba(249,115,22,0.32),inset 0 1px 0 rgba(255,255,255,0.20);transition:transform .12s ease,box-shadow .12s ease;display:inline-flex;align-items:center;gap:8px">오렌지팜 홈페이지로 이동 →</button>'
    + '</div></div>';
  /* 키프레임 1회 주입 */
  if(!document.getElementById('betaExpiredKeyframes')){
    const st=document.createElement('style');
    st.id='betaExpiredKeyframes';
    st.textContent='@keyframes bxFadeIn{from{opacity:0}to{opacity:1}}@keyframes bxPopIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}';
    document.head.appendChild(st);
  }
  document.body.appendChild(ov);
  /* _esc 핸들러를 모달 닫힘 경로 어디서든 함께 제거 — 누적 방지 */
  let _escHandler=null;
  const _close=function(){
    const o=document.getElementById('betaExpiredOverlay');
    if(o)o.remove();
    if(_escHandler){
      document.removeEventListener('keydown',_escHandler,true);
      _escHandler=null;
    }
  };
  const _go=function(){
    const url='https://school114.org';
    try{
      if(window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(url);
      else window.open(url,'_blank');
    }catch(_){window.open(url,'_blank');}
    _close();
  };
  document.getElementById('betaGoSite').addEventListener('click',_go);
  /* 배경 클릭으로 닫기 */
  ov.addEventListener('click',function(e){if(e.target===ov)_close();});
  /* Esc 로 닫기 */
  _escHandler=function(e){if(e.key==='Escape')_close();};
  document.addEventListener('keydown',_escHandler,true);
  setTimeout(function(){const b=document.getElementById('betaGoSite');if(b)b.focus();},10);
}

/* 만료 시 락 가드 — 이름 검색창·상세 검색 버튼에 한정.
 * 뷰는 동적 로드되므로 document capture-phase 로 위임. 시도 시 모달 재호출.
 * 베타 게이트와 cdkey 게이트가 동일 락 ID 집합 공유. 활성화된 게이트의 모달을 자동 선택. */
const _BETA_LOCK_IDS=['dailySearchInput','ecSearchInput','infSearchInput','dailyAdvSearchBtn','ecAdvSearchBtn','infAdvSearchBtn'];
function _installBetaLockGuard(){
  if(window._betaLockInstalled) return;
  window._betaLockInstalled=true;
  /* 시각적 비활성 표시 — 락 대상에 회색·금지 커서 */
  const st=document.createElement('style');
  st.id='betaLockGuardStyle';
  st.textContent='#'+_BETA_LOCK_IDS.join(',#')+'{cursor:not-allowed!important;background:#f3f4f6!important;color:#94a3b8!important;opacity:0.75}';
  document.head.appendChild(st);
  /* indexOf 빠른 lookup 용 Set */
  const _lockSet=new Set(_BETA_LOCK_IDS);
  const _intercept=function(e){
    /* 이미 인증 완료된 후라면 통과 (cdkey 게이트가 활성 중이었더라도 인증되면 해제) */
    if(window._cdkeyGated){
      try{
        const _raw=localStorage.getItem('ec_cdkey_license');
        if(_raw){
          const _lic=JSON.parse(_raw);
          if(_lic && _lic.key && _lic.verifiedAt){
            window._cdkeyGated=false;
            const _s=document.getElementById('betaLockGuardStyle');
            if(_s) _s.remove();
            return; /* 차단 해제 */
          }
        }
      }catch(_){}
    }
    const id=e.target&&e.target.id;
    if(!id || !_lockSet.has(id)) return;
    e.preventDefault();
    e.stopPropagation();
    /* focusin 은 preventDefault 로 막히지 않으므로 명시적 blur 로 포커스 해제 */
    if(e.type==='focusin' && typeof e.target.blur==='function') e.target.blur();
    /* 정식 버전 — 베타 만료 모달은 더 이상 표시 안 함 (사용자 결정 2026-05-27).
     *  정식 버전의 모든 락 시나리오는 cdkey 게이트 단일 경로로 처리. */
    _showCdkeyGate();
  };
  /* 차단 이벤트 — 클릭/마우스다운/키다운/포커스/붙여넣기/IME입력/드래그앤드롭 모두 capture */
  ['mousedown','click','keydown','focusin','paste','beforeinput','drop'].forEach(function(t){
    document.addEventListener(t,_intercept,true);
  });
}

/* ═══════════════════════════════════════════
   인증코드 (CD 키) 게이트 — 정식 버전 전용
   ═══════════════════════════════════════════
   - 정식 배포 (버전에 "beta" 미포함) + 인증코드 미확인 사용자 → 모달 + 락 가드
   - 인증 완료 후에는 같은 PC 에서 영구 통과 (localStorage + DB common 양쪽 저장)
   - 업데이트/재설치 후에도 userData 가 유지되므로 자동 통과 */
/* 전체화면 인증 게이트 — 닫을 수 없음. 코드 입력칸 내장 → 여기서 바로 인증하고,
 * 성공해야만 게이트가 사라져 프로그램을 쓸 수 있다. (ESC·바깥클릭으로 닫히지 않음) */
function _showCdkeyGate(){
  if(document.getElementById('cdkeyGateOverlay')) return; /* 중복 방지 */
  const ov=document.createElement('div');
  ov.id='cdkeyGateOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0e7490 0%,#0891b2 45%,#06b6d4 100%);animation:bxFadeIn .2s ease-out';
  ov.innerHTML='<div style="background:#fff;border-radius:18px;width:460px;max-width:92vw;box-shadow:0 30px 80px rgba(0,0,0,0.45);overflow:hidden;animation:bxPopIn .24s cubic-bezier(.2,.9,.3,1.1)">'
    + '<div style="padding:24px 28px 18px;border-bottom:1px solid rgba(15,23,42,0.08);display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,rgba(6,182,212,0.08),transparent)">'
    +   '<div style="width:42px;height:42px;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#0891b2,#0e7490);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;box-shadow:0 6px 16px rgba(6,182,212,0.32)">🔐</div>'
    +   '<div><div style="font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-0.3px">오렌지톡 인증코드</div>'
    +   '<div style="font-size:11.5px;color:#64748b;font-weight:600;margin-top:2px">이 PC 에서 단 1회만 인증하시면 됩니다</div></div>'
    + '</div>'
    + '<div style="padding:22px 28px 6px;font-size:13px;color:#334155;line-height:1.8;font-weight:500">'
    +   '오렌지팜에서 받으신 <b style="color:#0f172a">인증코드</b>를 입력해 주세요. 인증을 완료해야 프로그램을 사용할 수 있습니다. '
    +   '코드는 오렌지팜 "<a href="#" id="cdkeyGateMypage" style="color:#0891b2;font-weight:800;text-decoration:none">나의e오렌지 - 회원정보수정</a>" 메뉴에서 확인하실 수 있습니다.'
    + '</div>'
    + '<div style="padding:16px 28px 8px;display:flex;gap:10px;align-items:stretch">'
    +   '<input id="cdkeyGateInput" type="text" placeholder="____-____" maxlength="9" autocomplete="off" spellcheck="false" style="flex:1;padding:15px 18px;font-family:\'SF Mono\',Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:4px;text-align:center;border:2px solid #cbd5e1;border-radius:11px;background:#f8fafc;color:#0f172a;outline:none;text-transform:uppercase">'
    +   '<button id="cdkeyGateBtn" style="padding:15px 28px;background:linear-gradient(135deg,#0891b2,#0e7490);color:#fff;font-weight:800;font-size:13.5px;border:none;border-radius:11px;cursor:pointer;letter-spacing:0.3px;white-space:nowrap;font-family:inherit;box-shadow:0 6px 16px rgba(6,182,212,0.30)">✓ 인증하기</button>'
    + '</div>'
    + '<div id="cdkeyGateMsg" style="padding:0 28px;margin-top:10px;font-size:11.5px;font-weight:700;display:none;min-height:16px"></div>'
    + '<div style="padding:16px 28px 22px;margin-top:8px;font-size:11px;color:#94a3b8;line-height:1.6;border-top:1px solid rgba(15,23,42,0.06)">'
    +   '문의: 오렌지팜 고객센터 <b style="color:#475569;font-family:var(--fm)">1588-3711</b> (평일 09:00~18:00)'
    + '</div></div>';
  document.body.appendChild(ov);
  const inp=document.getElementById('cdkeyGateInput');
  const btn=document.getElementById('cdkeyGateBtn');
  const myp=document.getElementById('cdkeyGateMypage');
  if(btn) btn.addEventListener('click', _gateVerify);
  if(inp){
    /* 자동 하이픈 — 4자리 입력 시 '-' 부착 (ABCD1234 → ABCD-1234) */
    inp.addEventListener('input', function(){
      let v=String(this.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(v.length>4) v=v.slice(0,4)+'-'+v.slice(4,8);
      this.value=v;
      const m=document.getElementById('cdkeyGateMsg'); if(m) m.style.display='none';
    });
    inp.addEventListener('keydown', function(e){ if(e.key==='Enter') _gateVerify(); });
    setTimeout(function(){ try{ inp.focus(); }catch(_){} }, 60);
  }
  if(myp) myp.addEventListener('click', function(e){
    e.preventDefault();
    try{ if(window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal('https://www.school114.org'); }catch(_){}
  });
}

async function _gateVerify(){
  const inp=document.getElementById('cdkeyGateInput');
  const msg=document.getElementById('cdkeyGateMsg');
  const btn=document.getElementById('cdkeyGateBtn');
  if(!inp||!msg) return;
  const key=String(inp.value||'').trim().toUpperCase();
  msg.style.display='';
  if(btn){ btn.disabled=true; btn.style.opacity='0.6'; btn.style.cursor='wait'; }
  msg.style.color='#0891b2'; msg.textContent='⏳ 인증 서버에 확인 중입니다…';

  let res;
  try{ res=await verifyCdkey(key); }
  catch(_){ res={ valid:false, message:'인증 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' }; }

  if(res.valid){
    window._cdkeyGated=false;
    msg.style.color='#16a34a'; msg.textContent='✓ '+res.message;
    /* 성공 → 게이트 페이드아웃 후 제거 → 프로그램 사용 가능 */
    setTimeout(function(){
      const o=document.getElementById('cdkeyGateOverlay');
      if(o){ o.style.transition='opacity .4s ease'; o.style.opacity='0'; setTimeout(function(){ if(o) o.remove(); }, 420); }
    }, 900);
    return;
  }
  if(btn){ btn.disabled=false; btn.style.opacity=''; btn.style.cursor=''; }
  msg.style.color='#dc2626'; msg.textContent='⚠ '+res.message;
}

async function _runCdkeyGateCheck(){
  if(!window.electronAPI || !window.electronAPI.updaterGetVersion) return;
  let version='', isPackaged=true;
  try{
    const v=await window.electronAPI.updaterGetVersion();
    version=(v && v.version) || '';
    if(v && typeof v.isPackaged==='boolean') isPackaged=v.isPackaged;
  }catch(_){ return; }

  /* 개발 모드(npm start) 우회 — 단, localStorage 'ec_cdkey_gate_test'='1' 이면 dev 에서도 게이트 강제(테스트용) */
  if(!isPackaged && localStorage.getItem('ec_cdkey_gate_test')!=='1') return;
  /* 베타 빌드(버전에 "beta") 우회 — 정식(비-beta) 버전에서만 게이트 작동 */
  if(/beta/i.test(version)) return;

  /* 이미 인증됨 → 통과 */
  if(await hasCdkeyLicense()) return;

  /* 미인증 → 전체화면 게이트 (코드 입력해야만 해제) */
  window._cdkeyGated=true;
  _showCdkeyGate();
}

async function _runBetaExpiryCheck(){
  /* 사전공개 Beta 만료 게이트 비활성화 (사용자 결정 2026-05-27 — 정식 버전 전환).
   *  유효기간 표시·남은 일수 배지·만료 모달·검색창 락 모두 제거.
   *  베타 흔적은 코드에 남아 있으나 호출 진입점 차단. */
  return;
}
/* DOM 준비 즉시 실행 — 인증 게이트는 다른 부트스트랩보다 먼저 보여야 함 */
function _runLaunchGates(){ _runBetaExpiryCheck(); _runCdkeyGateCheck(); }
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', _runLaunchGates);
} else {
  _runLaunchGates();
}

/* view fragment 마운트 (app-state.js 로드 후 실행) */
if(viewFragmentLoader){
  const _mount=viewFragmentLoader.mountFragment.bind(viewFragmentLoader);
  /* 1단계: 최상위 뷰 프래그먼트 동시 마운트 */
  Promise.all([
    _mount('view-dashboard-host','src/renderer/views/view-dashboard.html'),
    _mount('view-daily-host','src/renderer/views/view-daily.html'),
    _mount('view-story-host','src/renderer/views/view-story.html'),
    _mount('view-orange-host','src/renderer/views/view-orange.html'),
    _mount('view-magic-host','src/renderer/views/view-magic.html'),
  ]).then(function(){
    /* 2단계: 매직 스테이션 내부 서브 프래그먼트 마운트
     * (view-magic.html 마운트 완료 후 해당 호스트 div들이 DOM에 존재) */
    return Promise.all([
      _mount('magicSubSurveyFragmentHost','src/renderer/views/magic-sub-survey.html'),
      _mount('magicSubNewsletterFragmentHost','src/renderer/views/magic-sub-newsletter.html'),
      /* [BACKUP] _mount('magicSubPhysicalFragmentHost','src/renderer/views/magic-sub-physical.html'), */
    ]);
  }).then(function(){
    /* 모든 뷰 DOM이 준비된 후 이벤트 바인딩 + 초기 렌더링 실행 */
    bindViewDailyEvents();
    bindViewDashboardEvents();
    bindViewMagicEvents();
    bindViewStoryEvents();
    bindViewOrangeEvents();
    bindMagicSubSurveyEvents();
    bindMagicSubNewsletterEvents();
    /* 초기 뷰 설정 — switchView가 renderDaily/renderCalendar 등을 호출함 */
    switchView('daily');
    bus.emit('render:dashboard');
    /* 미반납 물품 알림 — 로그인 완료(splash 숨김) 후 표시 */
    function _postLoginAlerts(){
      if(typeof checkUnreturnedItems==='function') setTimeout(checkUnreturnedItems, 1000);
      /* 동명이인 매칭 보류 항목 알림 — 하루 1회 */
      setTimeout(function(){
        if(!window.electronAPI || !window.electronAPI.studentsPendingAmbiguousCount) return;
        const today = toDateStr(new Date());   /* 로컬 날짜 — toISOString(UTC)은 오전 9시 전 하루 밀림 (2026-08-12) */
        const lastShown = localStorage.getItem('ec_amb_notify_date') || '';
        if(lastShown === today) return;
        window.electronAPI.studentsPendingAmbiguousCount().then(function(res){
          const cnt = (res && res.count) || 0;
          if(cnt <= 0) return;
          localStorage.setItem('ec_amb_notify_date', today);
          /* 토스트성 안내 — 클릭 시 모달 발동 */
          const ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;right:24px;top:84px;z-index:99990;max-width:340px;background:var(--card,#fff);border:1px solid rgba(239,68,68,0.45);border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,0.18);padding:14px 16px;font-family:var(--f);opacity:0;transform:translateX(20px);transition:all .25s cubic-bezier(.4,0,.2,1)';
          requestAnimationFrame(function(){ ov.style.opacity='1'; ov.style.transform='translateX(0)'; });
          ov.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:18px">⚠</span><span style="font-size:13px;font-weight:800;color:#dc2626">동명이인 매칭 보류 '+cnt+'건</span></div>'
            + '<div style="font-size:11px;color:var(--t2);line-height:1.6;margin-bottom:10px">매칭되지 않은 동명이인이 남아 있습니다. 정확한 입력을 위해 매칭 작업을 완료해 주세요.</div>'
            + '<div style="display:flex;gap:6px;justify-content:flex-end">'
            + '<button id="ambNotifyLater" style="padding:6px 12px;font-size:11px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t3);cursor:pointer;font-family:inherit">나중에</button>'
            + '<button id="ambNotifyNow" style="padding:6px 14px;font-size:11px;font-weight:700;border-radius:6px;border:none;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;cursor:pointer;font-family:inherit">지금 처리</button>'
            + '</div>';
          document.body.appendChild(ov);
          ov.querySelector('#ambNotifyLater').addEventListener('click', function(){ ov.remove(); });
          ov.querySelector('#ambNotifyNow').addEventListener('click', function(){
            ov.remove();
            import('../person-manager/person-manager-view.js').then(function(m){
              if(m && typeof m.openAmbiguousMatchModal === 'function') m.openAmbiguousMatchModal();
            }).catch(function(e){ console.error('[amb-modal] import 실패:', e); });
          });
        }).catch(function(){});
      }, 1500);
    }
    /* body.loaded 클래스가 있으면 이미 로그인 완료 */
    if(document.body.classList.contains('loaded')) _postLoginAlerts();
    else new MutationObserver(function(muts,obs){
      if(document.body.classList.contains('loaded')){obs.disconnect();_postLoginAlerts();}
    }).observe(document.body,{attributes:true,attributeFilter:['class']});
  });
}

