/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { escHtml, escJs, appConfirmModal } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { getPublicDataApiKey } from '../../core/public-data-settings.js';
import { renderSettingsPanel, openAccordion } from './settings-view.js';
import { matchKorean, matchKoreanFromStart } from '../daily/daily-autocomplete.js';
import { getSymData, _symPrompt, getMedSystemSyms, refreshMedHidden, getEffectiveSymCats, getEffectiveSymCatById } from '../symptom/symptom-view.js';
import { dailyColEyeIcon } from '../emergency/emergency-view.js';
import { S, ensureHolidayYear } from '../../core/app-state.js';
import { showSchoolMealPopup, restartMealScheduler } from '../../core/school-meal.js';
import { showTimetableModal } from '../../core/timetable.js';
import { getClassPopups, removeClassPopupByKey, classPopupKey, classDowLabel, setClassPopupOn } from '../../core/class-popup.js';

/* ═══════════════════════════════════════
   SETTINGS TAB: DIARY (보건일지 설정)
   Extracted from settings-view.js
   ═══════════════════════════════════════ */
let _cachedUserDataPath='';

export function _renderPrivacyTab(){
  /* 시안 2 — 큰 그라데이션 번호 + 점선 디바이더 (잡지 보고서 톤).
     라이트/다크 모드에 따라 hero·디바이더 색상 분기. */
  const _isLight=document.body.classList.contains('light');
  const _heroBg=_isLight
    ? 'linear-gradient(135deg,rgba(6,182,212,0.07),rgba(139,92,246,0.04))'
    : 'linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))';
  const _heroBdr=_isLight?'rgba(6,182,212,0.30)':'rgba(6,182,212,0.25)';
  const _heroGlow=_isLight?'rgba(6,182,212,0.10)':'rgba(6,182,212,0.18)';
  const _heroTagBg=_isLight?'rgba(6,182,212,0.10)':'rgba(6,182,212,0.15)';
  const _emphasis=_isLight?'#dc2626':'#fca5a5';
  const _divider=_isLight?'rgba(15,23,42,0.08)':'rgba(255,255,255,0.06)';

  let html='<div class="settings-panel-title">🔒 개인정보 보호 설계 원칙</div>';
  html+='<div class="settings-panel-desc">오렌지톡이 학생·교직원 개인정보 및 민감정보를 어떻게 보호하는지에 대한 설계 원칙입니다.</div>';

  /* Hero — 핵심 원칙 강조 박스 (라디얼 글로우 포함) */
  html+='<div style="background:'+_heroBg+';border:1px solid '+_heroBdr+';border-radius:14px;padding:18px 22px;margin-bottom:20px;position:relative;overflow:hidden">';
  html+='<div style="position:absolute;top:-30%;right:-10%;width:300px;height:300px;background:radial-gradient(circle,'+_heroGlow+',transparent 70%);pointer-events:none"></div>';
  html+='<div style="position:relative">';
  html+='<div style="display:inline-block;font-size:10px;font-weight:800;color:var(--cyan);background:'+_heroTagBg+';padding:3px 10px;border-radius:99px;letter-spacing:0.5px;margin-bottom:10px;text-transform:uppercase">📌 핵심 원칙</div>';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1);line-height:1.7;margin-bottom:6px">프로그램 제공자(오렌지팜 주식회사)는 사용자가 등록한 보건일지 상의 학생·교직원 개인정보 및 민감정보를 <span style="color:'+_emphasis+'">일체 보유하지 않습니다.</span></div>';
  html+='<div style="font-size:11.5px;color:var(--t2);line-height:1.7">해당 데이터는 사용자의 학교 PC 내부에만 저장되며 외부 서버에 저장되지 않습니다.</div>';
  html+='</div></div>';

  /* 6원칙 — 큰 그라데이션 숫자 + 점선 디바이더 */
  const _principles=[
    {n:'01', ko:'데이터 로컬 저장', en:'Data Locality',
      body:'민간 클라우드 서버에 학생·교직원 개인정보 및 민감정보를 저장하지 않음.'},
    {n:'02', ko:'제공자 무접근', en:'Zero Provider Access',
      body:'앱 배포자·개발자는 사용자의 학생 의료 정보에 기술적으로 접근 불가. 원격 조회·로그 수집 기능 없음.'},
    {n:'03', ko:'외부 API 분리', en:'Data Separation',
      body:'외부 공공 API(식약처 e약은요·심평원·기상청·환율 등) 호출 시 학생 데이터를 절대 포함하지 않음. 외부 통신은 교사 도구용 공개 데이터 조회에 한정.'},
    {n:'04', ko:'데이터 최소화', en:'Data Minimization',
      body:'업무에 필요한 최소 항목만 수집·저장. 불필요한 식별정보·위치정보·행동 로그 수집 없음.'},
    {n:'05', ko:'로그 무기록', en:'PII-Free Logging',
      body:'콘솔·에러 로그에 학생명·연락처·주민번호 등 민감정보 기록하지 않음.'},
    {n:'06', ko:'보관 기간 관리 및 완전 삭제', en:'Retention & Erasure',
      body:'보관 기간이 경과한 데이터는 사용자에게 삭제 안내를 제공하며, 삭제 시 물리적으로 제거되어 잔존하지 않음.'}
  ];
  html+='<div style="padding:0 4px">';
  _principles.forEach(function(p, i){
    const isLast=i===_principles.length-1;
    const borderStyle=isLast?'':'border-bottom:1px dashed '+_divider+';';
    html+='<div style="display:flex;gap:18px;padding:14px 0;'+borderStyle+'">';
    /* 큰 숫자 — 청록 그라데이션 텍스트 */
    html+='<div style="font-size:36px;font-weight:900;line-height:1;font-family:var(--fm);background:linear-gradient(180deg,#06B6D4,#0891B2);-webkit-background-clip:text;background-clip:text;color:transparent;width:60px;text-align:center;letter-spacing:-1px;flex-shrink:0">'+p.n+'</div>';
    html+='<div style="flex:1">';
    html+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap">';
    html+='<span>'+p.ko+'</span>';
    html+='<span style="font-size:9.5px;color:var(--t3);font-weight:600;letter-spacing:0.5px;text-transform:uppercase">'+p.en+'</span>';
    html+='</div>';
    html+='<div style="font-size:11px;color:var(--t2);line-height:1.75">'+p.body+'</div>';
    html+='</div></div>';
  });
  html+='</div>';
  return html;
}

export function _renderDiaryTab(){
  let html='<div class="settings-panel-title">📋 보건일지 설정</div>';
  html+='<div class="settings-panel-desc">보건일지 항목과 입력 방식은 설정에서 사용자에 맞게 조정할 수 있습니다.</div>';
  const year=new Date().getFullYear();
  /* fallback 경로 — Electron 실제 userData 는 package.json "name" (my-health-diary) 기반.
     Mac: ~/Library/Application Support/my-health-diary
     Windows: %APPDATA%\\my-health-diary (Roaming, Local 아님) */
  const _isWinD = navigator.platform && navigator.platform.indexOf('Win')>=0;
  const basePath = _cachedUserDataPath
    || (_isWinD ? 'C:\\Users\\<사용자>\\AppData\\Roaming\\my-health-diary' : '~/Library/Application Support/my-health-diary');
  if(!_cachedUserDataPath&&window.electronAPI&&window.electronAPI.getUserDataPath){window.electronAPI.getUserDataPath().then(function(p){_cachedUserDataPath=p;window._cachedUserDataPath=p;if(S.settingsLocked==='diary')renderSettingsPanel('diary');});}

  html+='<div >';

  /* 🕶 개인정보 보호 모드 (Private) — UI 블러 */
  const _privacyOn=(localStorage.getItem('ec_privacy_mode')==='1');
  html+='<div class="set-accordion" data-action="accordion"><span>🕶 개인정보 보호 모드 (Private · 화면 블러)</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body">';
  html+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px;line-height:1.7">일반 일지 표 내용을 블러 처리해 학생/교직원 정보가 노출되지 않도록 보호합니다. 행에 마우스를 올리면 임시로 보입니다.</div>';
  html+='<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:6px 12px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);user-select:none">';
  html+='<input type="checkbox" id="setPrivacyModeToggle" data-action="toggle-privacy-mode" '+(_privacyOn?'checked':'')+' style="width:16px;height:16px;cursor:pointer">';
  html+='<span style="font-size:11.5px;font-weight:700;color:var(--t1)">Private 모드 활성화</span>';
  html+='<span style="font-size:10px;color:var(--t3)">현재: <b id="setPrivacyModeStatus" style="color:'+(_privacyOn?'#ef4444':'var(--t3)')+'">'+(_privacyOn?'켜짐':'꺼짐')+'</b></span>';
  html+='</label>';
  html+='</div></div>';

  /* 🧭 사이드바 위치 설정 → 시스템 설정 패널(cat=sidebarpos)로 이동 (2026-06-17) */

  /* ⏱ 입실·퇴실 시간 자동 입력 분 — 사용자가 학생/교직원 등록 시 자동 채워질 분 단위 커스텀 */
  const _autoBefore=parseInt(localStorage.getItem('ec_daily_auto_time_in_before')||'4',10);
  const _autoAfter=parseInt(localStorage.getItem('ec_daily_auto_time_out_after')||'4',10);
  const _bedRestMin=parseInt(localStorage.getItem('ec_daily_bedrest_minutes')||'30',10);
  html+='<div class="set-accordion" data-action="accordion"><span>⏱ 입실·퇴실 시간 자동 입력</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body">';
  html+='<div style="font-size:10px;color:var(--t3);margin-bottom:12px;line-height:1.7">보건일지에 사람을 등록하면 입실 시간과 퇴실 시간이 현재 시각을 기준으로 자동 입력됩니다.<br>입실은 현재 시각의 몇 분 <b>전</b>으로, 퇴실은 현재 시각의 몇 분 <b>후</b>로 입력할지 선택하세요. (기본 4분)</div>';
  html+='<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">';
  html+='<label style="display:inline-flex;align-items:center;gap:8px;font-size:11.5px;color:var(--t1)"><b>입실 시간</b> — 현재 시각의 <input type="number" id="setDailyTimeInBefore" data-action="set-daily-time-in-before" min="0" max="60" value="'+_autoBefore+'" style="width:64px;padding:4px 8px;font-size:11.5px;font-family:var(--fm);text-align:center;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1)"> 분 <b>전</b></label>';
  html+='<label style="display:inline-flex;align-items:center;gap:8px;font-size:11.5px;color:var(--t1)"><b>퇴실 시간</b> — 현재 시각의 <input type="number" id="setDailyTimeOutAfter" data-action="set-daily-time-out-after" min="0" max="60" value="'+_autoAfter+'" style="width:64px;padding:4px 8px;font-size:11.5px;font-family:var(--fm);text-align:center;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1)"> 분 <b>후</b></label>';
  html+='</div>';
  /* 침상안정 선택 시 퇴실 자동 +N분 — "침상 안정" 처치 선택 시 침상 관리자 띄우지 않고 "아니오" 선택 시 적용 */
  html+='<div style="font-size:10px;color:var(--t3);margin:14px 0 8px;line-height:1.7;border-top:1px dashed var(--bdr);padding-top:12px"><b style="color:var(--t2)">침상 안정</b> 처치를 선택하고 침상 관리자(시간·알람 설정)는 안 띄울 때, 퇴실 시간이 입실 시간 + 몇 분 후로 자동 설정될지 선택하세요. (기본 30분)</div>';
  html+='<label style="display:inline-flex;align-items:center;gap:8px;font-size:11.5px;color:var(--t1)"><b>침상안정 퇴실 시간</b> — 입실 시간 + <input type="number" id="setDailyBedRestMin" data-action="set-daily-bedrest-min" min="1" max="120" value="'+_bedRestMin+'" style="width:64px;padding:4px 8px;font-size:11.5px;font-family:var(--fm);text-align:center;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1)"> 분 <b>후</b></label>';
  html+='</div></div>';

  /* 📅 학기·학년도 설정 → 시스템 설정 패널(cat=schoolyear)로 이동 (2026-06-17) */

  /* 증상 목록 관리 — 사용자 요청(2026-05-11)으로 투약 리스트보다 위에 위치 */
  html+='<div class="set-accordion" data-action="accordion"><span>🩺 증상 목록 관리</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body">';
  html+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px;line-height:1.7">대분류 (가장 상위 카테고리) 아래의 <b>증상(중분류)</b>을 추가·수정·가리기·순서 변경할 수 있습니다. 변경 내용은 증상 선택 팝업·키오스크 증상처치입력·방문 통계에 함께 반영됩니다.<br><b style="color:var(--t2)">대분류 (가장 상위 카테고리)는 방문 통계 진료과 분류의 기준이라 고정</b>되어 수정·추가할 수 없습니다. 학교에서 쓰는 증상은 알맞은 대분류를 골라 그 아래에 자유롭게 추가하세요.</div>';
  /* 카테고리 탭 + 증상 목록 영역 */
  html+='<div style="display:flex;gap:8px;min-height:320px">';
  /* 좌측: 카테고리 목록 */
  html+='<div id="setSymCatList" style="width:130px;flex-shrink:0;border:1px solid var(--bdr);border-radius:8px;overflow-y:auto;max-height:360px;scrollbar-width:thin"></div>';
  /* 우측: 증상 칩 목록 */
  html+='<div style="flex:1;display:flex;flex-direction:column">';
  html+='<div id="setSymSymList" style="flex:1;border:1px solid var(--bdr);border-radius:8px;padding:6px;overflow-y:auto;max-height:360px;scrollbar-width:thin"></div>';   /* 좌측 분류 목록(360px)과 높이 통일 (사용자 요청 2026-06-13) */
  html+='</div></div>';   /* 우측 컬럼 + 카테고리/증상 flex 행 닫기 */

  /* ── 초기화 영역 — 카테고리/증상 영역 바깥 맨 아래에 전체 폭으로 배치 (가독성, 사용자 요청 2026-06-13) ── */
  const _usc=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  const _hsc=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  const _osc=JSON.parse(localStorage.getItem('ec_sym_order')||'{}');
  let _uscTotal=0;Object.keys(_usc).forEach(function(k){_uscTotal+=(_usc[k]||[]).length;});
  let _hscTotal=0;Object.keys(_hsc).forEach(function(k){_hscTotal+=(_hsc[k]||[]).length;});
  const _oscTotal=Object.keys(_osc).length;
  let _rnsTotal=0;try{_rnsTotal=Object.keys(JSON.parse(localStorage.getItem('ec_sym_renames')||'{}')).length;}catch(_){}
  const _anyChange=_uscTotal>0||_hscTotal>0||_oscTotal>0||_rnsTotal>0;
  /* 대분류 라벨(아이콘+이름) — 추가/숨김/순서변경한 증상이 어느 대분류 것인지 보여주기 위함 (사용자 요청 2026-06-14) */
  const _symCatLabel=function(cid){ try{ const c=getEffectiveSymCatById(cid); return c?((c.icon?c.icon+' ':'')+c.name):cid; }catch(_){ return cid; } };
  /* 카테고리별로 한 줄씩 세로 나열 (아코디언 본문용). 각 증상은 클릭 시 위 증상 목록의 해당 칸으로 이동(sym-jump). */
  const _symJumpSpan=function(cid,s){ return '<span data-action="sym-jump" data-jcat="'+escHtml(cid)+'" data-jsym="'+escHtml(s)+'" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;text-decoration-color:var(--t3)" title="클릭하면 위 목록의 이 증상으로 이동합니다">'+escHtml(s)+'</span>'; };
  const _grpByCat=function(obj){ return Object.keys(obj||{}).filter(function(cid){return (obj[cid]||[]).length;}).map(function(cid){ return '<div><b style="color:var(--t2)">'+escHtml(_symCatLabel(cid))+'</b> '+(obj[cid]||[]).map(function(s){return _symJumpSpan(cid,s);}).join(', ')+'</div>'; }).join(''); };
  let _symRenames={};try{_symRenames=JSON.parse(localStorage.getItem('ec_sym_renames')||'{}')||{};}catch(_){}
  html+='<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bdr)">';
  /* 증상(중분류)만 초기화 — 대분류는 고정이라 초기화 대상 없음 (2026-06-13) */
  html+='<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2)">';
  html+='<span style="flex:1;min-width:0;font-size:10.5px;color:var(--t3);line-height:1.5">증상(중분류) — 추가 <b style="color:var(--t2)">'+_uscTotal+'</b> · 숨김 <b style="color:var(--t2)">'+_hscTotal+'</b> · 순서변경 <b style="color:var(--t2)">'+_oscTotal+'</b> · 이름변경 <b style="color:var(--t2)">'+_rnsTotal+'</b></span>';
  html+='<button class="btn btn-sm" data-action="reset-user-symptoms" style="flex-shrink:0;white-space:nowrap;font-size:10.5px;background:rgba(239,68,68,0.08);color:#dc2626;border:1px solid rgba(239,68,68,0.2)"'+(!_anyChange?' disabled style="opacity:0.4"':'')+'>🔄 증상 초기화</button>';
  html+='</div>';
  /* 어느 대분류에 무엇을 추가/숨김/순서변경/이름변경 했는지 상세 (사용자 요청 2026-06-14) */
  if(_anyChange){
    /* 변경 유형별 아코디언(<details>) — 가로 나열이 길어 보기 불편하다는 피드백으로 접기/펼치기로 전환 (사용자 요청 2026-06-23) */
    const _acc=function(label,color,innerHtml,count){
      return '<details class="sym-chg-acc"><summary style="color:'+color+';font-weight:700">'+label+' <span style="color:var(--t3);font-weight:400;font-size:9px">('+count+')</span></summary>'
        +'<div style="display:flex;flex-direction:column;gap:3px;color:var(--t2)">'+innerHtml+'</div></details>';
    };
    let _det='';
    if(_uscTotal>0)_det+=_acc('➕ 추가','#16a34a',_grpByCat(_usc),_uscTotal);
    if(_hscTotal>0)_det+=_acc('🚫 숨김','#dc2626',_grpByCat(_hsc),_hscTotal);
    if(_oscTotal>0)_det+=_acc('↕ 순서','#0891b2',Object.keys(_osc).filter(function(cid){return (_osc[cid]||[]).length;}).map(function(cid){return '<div><span data-action="sym-jump" data-jcat="'+escHtml(cid)+'" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;text-decoration-color:var(--t3)" title="클릭하면 이 분류로 이동합니다"><b style="color:var(--t2)">'+escHtml(_symCatLabel(cid))+'</b></span></div>';}).join('')+'<div style="color:var(--t3);font-size:9px;margin-top:2px">— 분류 안 증상 나열 순서</div>',_oscTotal);
    if(_rnsTotal>0)_det+=_acc('✏ 이름','#d97706',Object.keys(_symRenames).map(function(o){return '<div>'+escHtml(o)+' → <b style="color:var(--t2)">'+escHtml(_symRenames[o])+'</b></div>';}).join(''),_rnsTotal);
    html+='<div style="margin-top:7px;padding:8px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--card);font-size:10px;color:var(--t3);line-height:1.7">'+_det+'</div>';
  }
  html+='</div>';   /* 초기화 영역 닫기 */
  html+='</div></div>';   /* accordion-body + accordion 묶음 닫기 */

  /* 증상에 따른 투약 리스트 관리 — 2단 grid 재구성 (사용자 요청 2026-05-27).
   *  · 좌: 약품 숨기거나 보이게 하기 (검색 + 전체 약품 + 👁 토글, 투약 선택 팝업과 동일 UX)
   *  · 우: 상용 약품 추가 및 수정 (검색 + ✏️ 인라인 이름 수정 + 결과에 없을 땐 "+ 약품 추가" 로 즉시 등록)
   *  · 아래 full-width: 등록된 약품 카드(증상 매칭 편집) + 시스템 약품 일괄 조회 */
  html+='<div class="set-accordion" data-action="accordion"><span>💊 증상에 따른 투약 리스트 관리</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body">';
  html+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px;line-height:1.7">왼쪽에서 약품을 검색·토글로 숨기거나 보이게 하고, 오른쪽에서 새 약품을 검색해 결과가 없으면 그대로 등록하거나 ✏️ 로 기존 약품 이름을 수정합니다.<br>아래 카드에서 약품별 매칭 증상을 편집하고, 시스템 약품 일괄 조회로 e약은요 API 정보를 미리 캐시할 수 있습니다.</div>';
  /* ── 2단 grid: 좌(숨기기) | 우(추가/수정) ──
   *  · 카드 자체는 grid stretch 로 동일 높이.
   *  · 내부는 flex column + list 에 flex:1 — 카드 안에서도 리스트가 늘어나 같은 비주얼. */
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">';
  /* 좌측 — 약품 숨기거나 보이게 하기 (id="setMedSubHide" — 투약 팝업 "+" > "약품 숨기거나 보이게 하기" 메뉴가 이 위치로 스크롤) */
  html+='<div id="setMedSubHide" style="padding:10px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);display:flex;flex-direction:column;min-height:380px">';
  html+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:4px;display:flex;align-items:center;gap:5px"><span style="display:inline-flex;color:var(--cyan)">'+dailyColEyeIcon(true)+'</span>약품 숨기거나 보이게 하기</div>';
  /* 우측 안내문(4~5줄)에 맞춰 검색창·리스트 시작점이 위로 떠 보이지 않도록 min-height 확보 (사용자 요청 2026-05-27).
   * id 부여 — _setMedInitInput 에서 JS 로 우측 height 측정 후 동적 sync 수행. */
  html+='<div id="setMedSubHideHint" style="font-size:10px;color:var(--t3);margin-bottom:8px;line-height:1.6;min-height:80px"><span style="color:#ea580c;font-weight:700">아래 약품은 오렌지팜에서 판매중인 약품 리스트입니다.</span><br>검색창에 글자를 입력하면서 숨기거나 숨겨진 약을 다시 보이게 할 수 있습니다.</div>';
  html+='<input class="form-input" id="setMedHideSearch" placeholder="약품명 검색 (초성 가능)" style="width:100%;font-size:11px;padding:6px 9px;margin-bottom:8px;background:var(--card);border:1px solid var(--bdr)" data-no-auto-save>';
  html+='<div id="setMedHideList" style="flex:1;min-height:0;max-height:340px;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;padding:4px;background:var(--card);scrollbar-width:thin"></div>';
  html+='</div>';
  /* 우측 — 상용 약품 추가 및 수정 (id="setMedSubAdd" — 투약 팝업 "+" > "상용 약품 추가 및 수정" 메뉴가 이 위치로 스크롤) */
  html+='<div id="setMedSubAdd" style="padding:10px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);display:flex;flex-direction:column;min-height:380px">';
  html+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:4px">📥 상용 약품 추가 및 수정</div>';
  html+='<div id="setMedSubAddHint" style="font-size:10px;color:var(--t3);margin-bottom:8px;line-height:1.6">검색해서 같은 이름의 약품이 없으면 우측 <b>+ 추가</b> 버튼으로 그대로 등록하세요. 기존 약품은 ✏️ 로 명칭 수정이 가능하며 효능을 최대 4개까지 등록하여 증상 선택 시 추천받을 수 있습니다.</div>';
  html+='<div style="display:flex;gap:6px;margin-bottom:8px">';
  html+='<input class="form-input" id="setMedAddEditSearch" placeholder="약품 검색 / 새 약품명" style="flex:1;min-width:0;font-size:11px;padding:6px 9px;background:var(--card);border:1px solid var(--bdr)" data-no-auto-save>';
  html+='<button id="setMedAddBtn" data-action="med-add-from-search" disabled style="padding:5px 8px;font-size:11px;font-weight:700;border:1px solid var(--cyan);border-radius:6px;background:rgba(6,182,212,0.08);color:var(--cyan);cursor:pointer;white-space:nowrap;font-family:var(--f);opacity:0.4;flex-shrink:0">+ 추가</button>';
  html+='</div>';
  html+='<div id="setMedAddEditList" style="flex:1;min-height:0;max-height:340px;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;padding:4px;background:var(--card);scrollbar-width:thin"></div>';
  html+='</div>';
  html+='</div>';
  /* 사용자 추가 약품 카드 — 자체 아코디언(접기 가능). 약품 많이 등록 시 스크롤 길어지는 것 방지.
   *  openAccordion 은 closeAll 이라 중첩 불가 → data-action="toggle-medcardlist" 자체 토글(_bindDiaryTabEvents). 기본 열림. */
  html+='<div class="set-accordion open" data-action="toggle-medcardlist" id="setMedCardListHeader"><span>📋 등록된 약품 (사용자 추가) — 약품별 매칭 증상 편집</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body open" id="setMedCardListBody" style="margin-bottom:14px">';
  html+='<div id="setMedCardList" style="max-height:280px;overflow-y:auto;scrollbar-width:thin"></div>';
  html+='</div>';
  /* 시스템 약품 전체 e약은요 일괄 조회 (full-width, 가장 아래) */
  html+='<div style="margin-bottom:6px;padding:10px 12px;border:1px dashed rgba(6,182,212,0.35);border-radius:8px;background:rgba(6,182,212,0.04)">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--t1);flex:1">📥 시스템 약품 전체 상세정보 일괄 조회</span>'
      +'<span id="setMedCacheBadge" style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:rgba(156,163,175,0.1);color:#94a3b8">확인 중…</span>'
    +'</div>'
    +'<div style="font-size:10px;color:var(--t2);line-height:1.7;margin-bottom:8px">번들된 시스템 약품 약 564개를 식약처 e약은요 API 로 순차 조회해서 사용자 JSON 에 미리 등재합니다.<br>완료 후에는 <b>인터넷 없이도</b> 모든 약품 상세정보(효능·용법·주의사항 등) 가 즉시 표시됩니다.<br>중간에 중단해도 다음 실행 시 큐에서 이어갑니다.</div>'
    +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      +'<button id="setMedUpdateBtn" data-action="med-bulk-update" style="padding:6px 14px;font-size:11px;font-weight:700;border:1px solid var(--cyan);border-radius:6px;background:rgba(6,182,212,0.08);color:var(--cyan);cursor:pointer;font-family:var(--f)" title="시스템 약품 전체를 e약은요 API로 (재)조회·최신화 — 수동 추가분은 보존됩니다">📥 약품정보 전체 불러오기 · 업데이트</button>'
      +'<button id="setMedBulkCancelBtn" data-action="med-bulk-cancel" style="display:none;padding:6px 14px;font-size:11px;font-weight:700;border:1px solid var(--rs);border-radius:6px;background:rgba(239,68,68,0.08);color:var(--rs);cursor:pointer;font-family:var(--f)">⏸ 일괄 조회 중단</button>'
      +'<div id="setMedBulkStatus" style="flex:1;min-width:160px;font-size:10px;color:var(--t3);font-family:var(--fm)"></div>'
    +'</div>'
    +'<div id="setMedBulkProgressWrap" style="display:none;margin-top:6px;height:4px;background:var(--bg2);border-radius:2px;overflow:hidden">'
      +'<div id="setMedBulkProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg, var(--cyan), #22c55e);transition:width .3s ease"></div>'
    +'</div>'
  +'</div>';
  html+='</div></div>';

  /* 식약처 의약품정보 API 아코디언은 API 키 관리 탭으로 이관됨 */

  html+='</div>';

  /* ── 👤 생년월일·주보호자 연락처 팝업 오픈 설정 ──
     일반 일지 표의 이름에 마우스 호버 시 뜨는 생년월일/연락처 미니 팝업의 ON/OFF.
     기본 ON. OFF 면 입력값이 있어도 표시 안 함. (ON 이지만 입력값 없으면 어차피 안 뜸) */
  {
    const _binfoOn = (localStorage.getItem('ec_daily_birthcontact_popup')||'Y') !== 'N';
    html+='<div class="set-accordion" data-action="accordion"><span>👤 생년월일·주보호자 연락처 팝업 오픈 설정</span><span class="set-acc-arrow">▼</span></div>';
    html+='<div class="set-accordion-body">';
    html+='<div style="font-size:10px;color:var(--t3);margin-bottom:12px;line-height:1.7">일반 일지에서 이름에 마우스 커서를 올렸을 때 <b>생년월일</b>·<b>주보호자 연락처</b> 정보가 함께 표시됩니다.<br>이 정보를 보고 싶지 않다면 OFF 로 변경하세요. (기본 ON · 입력값이 없으면 어차피 표시되지 않습니다)</div>';
    html+='<label style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:var(--t1)">';
    html+='<input type="checkbox" id="setDailyBirthContactPopup" data-action="toggle-birthcontact-popup" '+(_binfoOn?'checked':'')+' style="width:18px;height:18px;cursor:pointer;accent-color:var(--cyan)">';
    html+='<span><b>생년월일·연락처 팝업 표시</b> — 현재: <b id="setDailyBirthContactStatus" style="color:'+(_binfoOn?'var(--cyan)':'var(--t3)')+'">'+(_binfoOn?'켜짐':'꺼짐')+'</b></span>';
    html+='</label>';
    html+='</div></div>';
  }

  /* 🍽️ 급식 & 학사일정 자동 팝업 → 시스템 설정 패널(cat=mealacad)로 이동 (2026-06-17) */

  return html;
}

/* 급식 팝업 시각 — 시/분 드롭다운 값을 HH:MM 으로 저장 (2026-06-17, 신뢰성 위해 아날로그 시계 폐기) */
function _saveMealTimeFromSelects(){
  const hs=document.getElementById('setMealPopupHour'), ms=document.getElementById('setMealPopupMin');
  if(!hs||!ms)return;
  const v=String(parseInt(hs.value,10)||0).padStart(2,'0')+':'+String(parseInt(ms.value,10)||0).padStart(2,'0');
  localStorage.setItem('ec_meal_popup_time', v);
  try{ restartMealScheduler(); }catch(_){}
}
/* 학사일정 팝업 시각 저장 */
function _saveAcadTimeFromSelects(){
  const hs=document.getElementById('setAcadPopupHour'), ms=document.getElementById('setAcadPopupMin');
  if(!hs||!ms)return;
  const v=String(parseInt(hs.value,10)||0).padStart(2,'0')+':'+String(parseInt(ms.value,10)||0).padStart(2,'0');
  localStorage.setItem('ec_acad_popup_time', v);
  import('../../core/academic-schedule.js').then(function(m){ try{ m.restartAcademicScheduler(); }catch(_){} });
}

/* ── post-render event binding for diary tab ── */
export function _bindDiaryTabEvents(){
  /* 증상 초기화 아코디언 항목 클릭 → 위 증상 목록의 해당 중분류 칸으로 이동·하이라이트 (사용자 요청 2026-06-23) */
  if(!document.__symJumpBound){
    document.__symJumpBound=true;
    document.addEventListener('click',function(e){
      const t=e.target&&e.target.closest&&e.target.closest('[data-action="sym-jump"]');if(!t)return;
      e.stopPropagation();
      const jcat=t.dataset.jcat, jsym=t.dataset.jsym;
      if(jcat&&typeof _setSymSelectCat==='function'){try{_setSymSelectCat(jcat);}catch(_){}}
      if(jsym){
        setTimeout(function(){
          const list=document.getElementById('setSymSymList');if(!list)return;
          let el=null;
          try{ el=list.querySelector('.set-sym-chip[data-sym="'+(window.CSS&&CSS.escape?CSS.escape(jsym):String(jsym).replace(/"/g,'\\"'))+'"]'); }catch(_){}
          if(el){
            el.scrollIntoView({block:'center',behavior:'smooth'});
            el.style.transition='background .25s ease,box-shadow .25s ease';
            el.style.background='rgba(6,182,212,0.18)'; el.style.boxShadow='0 0 0 2px rgba(6,182,212,0.55)';
            setTimeout(function(){ el.style.background='transparent'; el.style.boxShadow='none'; },1500);
          }
        },120);
      }
    });
  }
  /* accordion clicks */
  document.querySelectorAll('[data-action="accordion"]').forEach(function(el){
    el.addEventListener('click',function(){openAccordion(this);});
  });
  /* 📋 등록된 약품 — 자체 토글(closeAll 안 함, 자기 body 만). 중첩 아코디언이라 openAccordion 못 씀. */
  const _mclHdr=document.getElementById('setMedCardListHeader');
  if(_mclHdr && !_mclHdr._mclBound){ _mclHdr._mclBound=true;
    _mclHdr.addEventListener('click',function(){
      this.classList.toggle('open');
      const body=document.getElementById('setMedCardListBody');
      if(body)body.classList.toggle('open');
    });
  }
  /* Private 모드 토글 */
  const privacyToggle=document.getElementById('setPrivacyModeToggle');
  if(privacyToggle)privacyToggle.addEventListener('change',function(){
    import('../daily/daily-view.js').then(function(m){
      if(m.togglePrivacyMode)m.togglePrivacyMode(privacyToggle.checked);
      const stat=document.getElementById('setPrivacyModeStatus');
      if(stat){stat.textContent=privacyToggle.checked?'켜짐':'꺼짐';stat.style.color=privacyToggle.checked?'#ef4444':'var(--t3)';}
    });
  });
  /* 🍚 급식·학사일정 자동 팝업 / 🧭 사이드바 위치 핸들러 → 시스템 설정 패널의 bindMealAcadPanel / bindSidebarPosPanel 로 이동 (2026-06-17) */
  /* 생년월일·연락처 팝업 ON/OFF 토글 — localStorage 'Y'/'N' (기본 Y) */
  const _bcToggle = document.getElementById('setDailyBirthContactPopup');
  if(_bcToggle) _bcToggle.addEventListener('change',function(){
    try{ localStorage.setItem('ec_daily_birthcontact_popup', _bcToggle.checked ? 'Y' : 'N'); }catch(e){}
    const stat = document.getElementById('setDailyBirthContactStatus');
    if(stat){ stat.textContent = _bcToggle.checked ? '켜짐' : '꺼짐'; stat.style.color = _bcToggle.checked ? 'var(--cyan)' : 'var(--t3)'; }
  });
  /* ⏱ 입실·퇴실 자동 분 — 0~60 범위로 clamp 후 localStorage 저장.
   * 침상안정은 1~120 범위 (긴 휴식 가능). */
  function _bindAutoTimeInput(id, key, minVal, maxVal){
    const _min = (typeof minVal === 'number') ? minVal : 0;
    const _max = (typeof maxVal === 'number') ? maxVal : 60;
    const el=document.getElementById(id);
    if(!el||el._bound)return;
    el._bound=true;
    el.addEventListener('change',function(){
      let v=parseInt(el.value,10);
      if(isNaN(v)||v<_min)v=_min;
      if(v>_max)v=_max;
      el.value=v;
      try{localStorage.setItem(key,String(v));}catch(e){}
    });
  }
  _bindAutoTimeInput('setDailyTimeInBefore','ec_daily_auto_time_in_before');
  _bindAutoTimeInput('setDailyTimeOutAfter','ec_daily_auto_time_out_after');
  _bindAutoTimeInput('setDailyBedRestMin','ec_daily_bedrest_minutes', 1, 120);
  /* med add — (구) setMedAddInput / data-action="med-add" 는 2026-05-27 2단 재구성으로 제거.
   *  새 바인딩은 아래 setMedAddEditSearch / setMedAddBtn 에서 처리. */
  /* 전체 일괄 조회 / 업데이트 / 중단 버튼 + 캐시 상태 배지 */
  const medBulkBtn=document.querySelector('[data-action="med-bulk-fetch"]');
  if(medBulkBtn&&!medBulkBtn._bound){medBulkBtn._bound=true;medBulkBtn.addEventListener('click',function(){_setMedBulkFetchStart(false);});}
  const medUpdateBtn=document.querySelector('[data-action="med-bulk-update"]');
  if(medUpdateBtn&&!medUpdateBtn._bound){medUpdateBtn._bound=true;medUpdateBtn.addEventListener('click',function(){_setMedBulkFetchStart(true);});}
  const medBulkCancelBtn=document.querySelector('[data-action="med-bulk-cancel"]');
  if(medBulkCancelBtn&&!medBulkCancelBtn._bound){medBulkCancelBtn._bound=true;medBulkCancelBtn.addEventListener('click',function(){_setMedBulkFetchCancel();});}
  /* 약품 캐시 상태 배지 로드 */
  _setMedCacheStatusUpdate();
  /* med 삭제 검색 입력란은 통합 후 제거됨 — 카드별 ✕ 로 일관화 */
  /* 좌측 — 약품 숨기거나 보이게 하기 검색 input */
  const medHide=document.getElementById('setMedHideSearch');
  if(medHide)medHide.addEventListener('input',function(){_setMedHideRender();});
  /* 우측 — 상용 약품 추가 및 수정 검색 input + "+ 약품 추가" 버튼.
   * 입력 시 결과 리스트 필터 + 검색어 있을 때만 추가 버튼 활성화. */
  const medAddSrch=document.getElementById('setMedAddEditSearch');
  const medAddBtn=document.getElementById('setMedAddBtn');
  function _setMedAddBtnSync(){
    if(!medAddSrch||!medAddBtn)return;
    const v=medAddSrch.value.trim();
    medAddBtn.disabled = !v;
    medAddBtn.style.opacity = v ? '1' : '0.4';
    medAddBtn.style.cursor = v ? 'pointer' : 'default';
  }
  if(medAddSrch){
    medAddSrch.addEventListener('input',function(){ _setMedAddEditRender(); _setMedAddBtnSync(); });
    /* Enter 키로도 추가 (입력란에서 빠른 등록) */
    medAddSrch.addEventListener('keydown',function(e){
      if(e.key==='Enter' && medAddSrch.value.trim()){
        e.preventDefault();
        _setMedAddDirect(medAddSrch.value.trim());
        medAddSrch.value=''; _setMedAddEditRender(); _setMedAddBtnSync();
        try{medAddSrch.focus();}catch(_){}
      }
    });
  }
  if(medAddBtn){
    medAddBtn.addEventListener('click',function(){
      if(!medAddSrch)return;
      const v=medAddSrch.value.trim(); if(!v)return;
      _setMedAddDirect(v);
      medAddSrch.value=''; _setMedAddEditRender(); _setMedAddBtnSync();
      try{medAddSrch.focus();}catch(_){}
    });
  }
  /* reset user symptoms button */
  const resetBtn=document.querySelector('[data-action="reset-user-symptoms"]');
  if(resetBtn)resetBtn.addEventListener('click',function(){_setResetUserSymptoms();});
  /* 대분류 초기화 버튼 제거 — 대분류는 고정이라 초기화 대상 없음 (2026-06-13) */
  /* drug API link */
  const drugLink=document.querySelector('[data-action="open-drug-api-link"]');
  if(drugLink)drugLink.addEventListener('click',function(e){e.preventDefault();if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal('https://www.data.go.kr/data/15075057/openapi.do');});
  /* 인증키 입력·저장은 API 관리의 공공데이터포털 공통 입력란에서만 처리한다. */
  /* test drug API button */
  const testDrugBtn=document.querySelector('[data-action="test-drug-api"]');
  if(testDrugBtn)testDrugBtn.addEventListener('click',function(){_testDrugApiKey();});
  /* timetable change */
  document.querySelectorAll('[data-action="timetable-change"]').forEach(function(inp){
    inp.addEventListener('change',function(){_saveTimetable();});
  });
  /* 📅 학기·학년도 설정 핸들러 → 시스템 설정 패널의 bindSchoolYearPanel 로 이동 (2026-06-17) */
}

/* ═══════════════════════════════════════════════════════════════
   시스템 설정으로 분리한 3개 패널 (사용자 지시 2026-06-17)
   · 사이드바 위치 설정  (cat=sidebarpos)
   · 급식 & 학사일정 팝업 설정  (cat=mealacad)
   · 학기·학년도 설정  (cat=schoolyear)
   렌더(HTML)·바인딩은 settings-view.js 의 cat 디스패치에서 호출.
   ═══════════════════════════════════════════════════════════════ */

/* 🧭 사이드바 위치 설정 패널 */
export function renderSidebarPosPanel(){
  const _sbPos = localStorage.getItem('ec_sidebar_position') || 'left';
  let html='<div class="settings-panel-title">🧭 사이드바 위치 설정</div>';
  html+='<div class="settings-panel-desc">왼쪽 사이드바(달력·이름 검색·최근 보건실 방문 이력·침상 이용 현황·당일 이용 이력)의 위치를 바꾸거나 끌 수 있습니다.</div>';
  html+='<div style="font-size:11px;color:var(--t3);margin-bottom:16px;line-height:1.7"><b style="color:var(--t2)">오른쪽</b>으로 두면 같은 내용이 오른편에, <b style="color:var(--t2)">끄기</b>를 고르면 사이드바가 사라지고 본문(탭 영역)이 전체 폭으로 넓어집니다.</div>';
  html+='<div style="display:inline-flex;gap:6px;flex-wrap:wrap" id="setSidebarPosGroup">';
  [['left','왼쪽 (Default)'],['right','오른쪽'],['off','끄기 (본문 전체폭)']].forEach(function(o){
    const on=(_sbPos===o[0]);
    html+='<button data-action="set-sidebar-pos" data-pos="'+o[0]+'" style="padding:7px 14px;border-radius:8px;border:1.5px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.10)':'var(--bg2)')+';color:'+(on?'var(--cyan)':'var(--t2)')+';font-size:11.5px;font-weight:'+(on?'800':'600')+';cursor:pointer;font-family:var(--f)">'+o[1]+'</button>';
  });
  html+='</div>';
  return html;
}
export function bindSidebarPosPanel(){
  document.querySelectorAll('[data-action="set-sidebar-pos"]').forEach(function(btn){
    btn.addEventListener('click',function(){
      const pos=btn.dataset.pos||'left';
      try{ localStorage.setItem('ec_sidebar_position',pos); }catch(_){}
      import('../shell/theme-manager.js').then(function(m){ if(m.applySidebarPosition)m.applySidebarPosition(); }).catch(function(){});
      document.querySelectorAll('[data-action="set-sidebar-pos"]').forEach(function(b){
        const on=(b.dataset.pos===pos);
        b.style.borderColor=on?'var(--cyan)':'var(--bdr)';
        b.style.background=on?'rgba(6,182,212,0.10)':'var(--bg2)';
        b.style.color=on?'var(--cyan)':'var(--t2)';
        b.style.fontWeight=on?'800':'600';
      });
    });
  });
}

/* 📅 학기·학년도 설정 패널 */
export function renderSchoolYearPanel(){
  let html='<div class="settings-panel-title">📅 학기·학년도 설정</div>';
  html+='<div class="settings-panel-desc">1·2학기 시작/종료일을 설정합니다. 학년도는 1학기 시작일 ~ 2학기 종료일로 자동 적용됩니다.</div>';
  html+='<div style="font-size:11px;color:var(--t3);margin-bottom:16px;line-height:1.7">여기서 정한 값은 <b style="color:var(--t2)">보건일지 출력·방문 통계·홈 대시보드 진행률</b>에 함께 반영됩니다.</div>';
  html+='<button data-action="open-sem-config" class="btn btn-primary btn-sm" style="font-size:12px;padding:8px 16px;border-radius:8px">📅 학기·학년도 날짜 설정 열기</button>';
  return html;
}
export function bindSchoolYearPanel(){
  const _semCfgBtn=document.querySelector('[data-action="open-sem-config"]');
  if(_semCfgBtn)_semCfgBtn.addEventListener('click',function(){ try{ if(window._homeOpenSemConfig){ window._homeOpenSemConfig(); } else { bus.emit('toast:show',{text:'대시보드를 한 번 연 뒤 다시 시도해 주세요.'}); } }catch(_){} });
}

/* 🍽️ 급식 & 학사일정 팝업 설정 패널 */
export function renderMealAcadPanel(){
  const _mealOn = localStorage.getItem('ec_meal_popup_on')==='Y';
  const _mealTime = localStorage.getItem('ec_meal_popup_time')||'09:30';
  const _selCss='font-size:12px;padding:5px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1);cursor:pointer;font-family:var(--f)';
  let html='<div class="settings-panel-title">🍽️ 급식 &amp; 수업 &amp; 학사일정 팝업 설정</div>';
  html+='<div class="settings-panel-desc">나이스 교육정보 개방 포털 API를 통해 선생님의 학교의 급식(조·중·석식) 메뉴와 학사일정 팝업을 띄울 것인지 설정합니다.</div>';
  html+='<div style="font-size:13px;color:var(--t3);margin-bottom:16px;line-height:1.7">나이스에서 우리학교 급식 메뉴를 불러옵니다.</div>';
  /* 급식 */
  html+='<label style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:var(--t1);margin-bottom:12px">';
  html+='<input type="checkbox" id="setMealPopupOn" data-action="toggle-meal-popup" '+(_mealOn?'checked':'')+' style="width:18px;height:18px;cursor:pointer;accent-color:var(--cyan)">';
  html+='<span><b>급식 자동 팝업</b> — 현재: <b id="setMealPopupStatus" style="color:'+(_mealOn?'var(--cyan)':'var(--t3)')+'">'+(_mealOn?'켜짐':'꺼짐')+'</b></span>';
  html+='</label>';
  const _mtm=_mealTime.match(/^(\d{1,2}):(\d{2})$/); let _mh=_mtm?parseInt(_mtm[1],10):9; const _mmin=_mtm?parseInt(_mtm[2],10):30;
  if(_mh<7||_mh>17)_mh=9;   /* 범위(07~17시) 밖이면 기본 9시로 보정 */
  let _hOpts=''; for(let _h=7;_h<=17;_h++){ _hOpts+='<option value="'+_h+'"'+(_h===_mh?' selected':'')+'>'+String(_h).padStart(2,'0')+'시</option>'; }
  let _mOpts=''; for(let _m=0;_m<60;_m+=5){ _mOpts+='<option value="'+_m+'"'+(_m===_mmin?' selected':'')+'>'+String(_m).padStart(2,'0')+'분</option>'; }
  html+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  html+='<label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--t1)"><b>팝업 시각</b> '
    +'<select id="setMealPopupHour" style="'+_selCss+'">'+_hOpts+'</select>'
    +'<select id="setMealPopupMin" style="'+_selCss+'">'+_mOpts+'</select></label>';
  html+='<button class="btn btn-sm" data-action="meal-popup-preview" style="font-size:11px;padding:6px 12px;border:1px solid var(--cyan);border-radius:6px;background:rgba(6,182,212,0.08);color:var(--cyan);cursor:pointer;font-family:var(--f)">🍚 지금 미리보기</button>';
  html+='</div>';
  html+='<div style="font-size:10px;color:var(--t3);margin-top:8px">매일 지정한 시각에 하루 한 번 자동으로 뜹니다 (앱 실행 중일 때).</div>';
  /* 수업 팝업 (사용자 요청 2026-06-17) — 나이스 시간표에서 내 수업을 골라 매주 그 요일·지정 시각에 알림 */
  const _classOn = localStorage.getItem('ec_class_popup_on')==='Y';
  html+='<div style="border-top:1px dashed var(--bdr);margin:18px 0 12px"></div>';
  html+='<div style="font-size:13px;color:var(--t3);margin-bottom:10px;line-height:1.7">나이스 시간표에서 <b>내 수업</b>을 골라, 매주 그 요일·지정한 시각에 자동으로 알려줍니다. (같은 나이스 키 사용)</div>';
  html+='<label style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:var(--t1);margin-bottom:12px">';
  html+='<input type="checkbox" id="setClassPopupOn" '+(_classOn?'checked':'')+' style="width:18px;height:18px;cursor:pointer;accent-color:#ec4899">';
  html+='<span><b>수업 자동 팝업</b> — 현재: <b id="setClassPopupStatus" style="color:'+(_classOn?'#ec4899':'var(--t3)')+'">'+(_classOn?'켜짐':'꺼짐')+'</b></span>';
  html+='</label>';
  html+='<div><button class="btn btn-sm" data-action="class-popup-pick" style="font-size:11px;padding:6px 12px;border:1px solid #ec4899;border-radius:6px;background:rgba(236,72,153,0.08);color:#db2777;cursor:pointer;font-family:var(--f)">🔔 팝업 대상 시간 선택하기</button></div>';
  html+='<div id="setClassPopupList" style="margin-top:10px">'+_renderClassPopupList()+'</div>';
  html+='<div style="font-size:13px;color:var(--t3);margin-top:8px">선택한 수업이 있는 요일마다, 지정한 시각에 하루 한 번 자동으로 뜹니다 (앱 실행 중일 때).</div>';
  /* 학사일정 */
  const _acadOn = localStorage.getItem('ec_acad_popup_on')==='Y';
  const _acadWhen = localStorage.getItem('ec_acad_popup_when')||'today';
  const _acadTime = localStorage.getItem('ec_acad_popup_time')||'09:00';
  const _atm=_acadTime.match(/^(\d{1,2}):(\d{2})$/); let _ah=_atm?parseInt(_atm[1],10):9; const _amin=_atm?parseInt(_atm[2],10):0;
  if(_ah<7||_ah>17)_ah=9;
  let _ahOpts=''; for(let _h=7;_h<=17;_h++){ _ahOpts+='<option value="'+_h+'"'+(_h===_ah?' selected':'')+'>'+String(_h).padStart(2,'0')+'시</option>'; }
  let _amOpts=''; for(let _m=0;_m<60;_m+=5){ _amOpts+='<option value="'+_m+'"'+(_m===_amin?' selected':'')+'>'+String(_m).padStart(2,'0')+'분</option>'; }
  html+='<div style="border-top:1px dashed var(--bdr);margin:18px 0 12px"></div>';
  html+='<div style="font-size:13px;color:var(--t3);margin-bottom:10px;line-height:1.7">방학·시험·행사 등 <b>특별한 학사일정이 있는 날</b>에 자동으로 알려줍니다. (같은 나이스 키 사용)</div>';
  html+='<label style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:var(--t1);margin-bottom:12px">';
  html+='<input type="checkbox" id="setAcadPopupOn" '+(_acadOn?'checked':'')+' style="width:18px;height:18px;cursor:pointer;accent-color:#a855f7">';
  html+='<span><b>학사일정 자동 팝업</b> — 현재: <b id="setAcadPopupStatus" style="color:'+(_acadOn?'#a855f7':'var(--t3)')+'">'+(_acadOn?'켜짐':'꺼짐')+'</b></span>';
  html+='</label>';
  html+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  html+='<label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--t1)"><b>알림 시점</b> '
    +'<select id="setAcadPopupWhen" style="'+_selCss+'"><option value="today"'+(_acadWhen==='today'?' selected':'')+'>당일 (그날 알림)</option><option value="prev"'+(_acadWhen==='prev'?' selected':'')+'>전날 (하루 전 알림)</option></select></label>';
  html+='<label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--t1)"><b>팝업 시각</b> '
    +'<select id="setAcadPopupHour" style="'+_selCss+'">'+_ahOpts+'</select>'
    +'<select id="setAcadPopupMin" style="'+_selCss+'">'+_amOpts+'</select></label>';
  html+='<button class="btn btn-sm" data-action="acad-popup-preview" style="font-size:11px;padding:6px 12px;border:1px solid #a855f7;border-radius:6px;background:rgba(168,85,247,0.08);color:#a855f7;cursor:pointer;font-family:var(--f)">📅 오늘 학사일정 미리보기</button>';
  html+='</div>';
  html+='<div style="font-size:13px;color:var(--t3);margin-top:8px">특별한 학사일정이 없는 날은 자동으로 뜨지 않습니다.</div>';
  return html;
}
export function bindMealAcadPanel(){
  const _mealToggle=document.getElementById('setMealPopupOn');
  if(_mealToggle)_mealToggle.addEventListener('change',function(){
    localStorage.setItem('ec_meal_popup_on', _mealToggle.checked?'Y':'N');
    const stat=document.getElementById('setMealPopupStatus');
    if(stat){ stat.textContent=_mealToggle.checked?'켜짐':'꺼짐'; stat.style.color=_mealToggle.checked?'var(--cyan)':'var(--t3)'; }
    try{ restartMealScheduler(); }catch(_){}
  });
  const _mealHourSel=document.getElementById('setMealPopupHour');
  if(_mealHourSel)_mealHourSel.addEventListener('change',_saveMealTimeFromSelects);
  const _mealMinSel=document.getElementById('setMealPopupMin');
  if(_mealMinSel)_mealMinSel.addEventListener('change',_saveMealTimeFromSelects);
  const _mealPrev=document.querySelector('[data-action="meal-popup-preview"]');
  if(_mealPrev)_mealPrev.addEventListener('click',function(){ try{ showSchoolMealPopup({silent:false}); }catch(_){} });
  const _acadToggle=document.getElementById('setAcadPopupOn');
  if(_acadToggle)_acadToggle.addEventListener('change',function(){
    localStorage.setItem('ec_acad_popup_on', _acadToggle.checked?'Y':'N');
    const stat=document.getElementById('setAcadPopupStatus');
    if(stat){ stat.textContent=_acadToggle.checked?'켜짐':'꺼짐'; stat.style.color=_acadToggle.checked?'#a855f7':'var(--t3)'; }
    import('../../core/academic-schedule.js').then(function(m){ try{ m.restartAcademicScheduler(); }catch(_){} });
  });
  const _acadWhenSel=document.getElementById('setAcadPopupWhen');
  if(_acadWhenSel)_acadWhenSel.addEventListener('change',function(){
    localStorage.setItem('ec_acad_popup_when', _acadWhenSel.value);
    import('../../core/academic-schedule.js').then(function(m){ try{ m.restartAcademicScheduler(); }catch(_){} });
  });
  const _acadHourSel=document.getElementById('setAcadPopupHour');
  if(_acadHourSel)_acadHourSel.addEventListener('change',_saveAcadTimeFromSelects);
  const _acadMinSel=document.getElementById('setAcadPopupMin');
  if(_acadMinSel)_acadMinSel.addEventListener('change',_saveAcadTimeFromSelects);
  const _acadPrev=document.querySelector('[data-action="acad-popup-preview"]');
  if(_acadPrev)_acadPrev.addEventListener('click',function(){
    const d=new Date(); const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    import('../../core/academic-schedule.js').then(function(m){ try{ m.showAcademicPopup(ds,{silent:false}); }catch(_){} });
  });
  /* 수업 팝업 — 토글 / 대상 선택 버튼 / 목록 삭제(위임) */
  const _classToggle=document.getElementById('setClassPopupOn');
  if(_classToggle)_classToggle.addEventListener('change',function(){
    setClassPopupOn(_classToggle.checked);
    const stat=document.getElementById('setClassPopupStatus');
    if(stat){ stat.textContent=_classToggle.checked?'켜짐':'꺼짐'; stat.style.color=_classToggle.checked?'#ec4899':'var(--t3)'; }
  });
  const _classPick=document.querySelector('[data-action="class-popup-pick"]');
  if(_classPick)_classPick.addEventListener('click',function(){ try{ showTimetableModal({pick:true}); }catch(_){} });
  const _classList=document.getElementById('setClassPopupList');
  if(_classList)_classList.addEventListener('click',function(e){
    const del=e.target.closest('[data-action="class-popup-del"]');
    if(!del)return;
    removeClassPopupByKey(del.dataset.key);
    _classList.innerHTML=_renderClassPopupList();
  });
}


/* 수업 팝업 — 선택 목록 렌더 + 변경 동기화 (시간표 선택 모달이 bus.emit('classpopup:changed')) */
function _renderClassPopupList(){
  const list=getClassPopups();
  if(!list.length) return '<div style="font-size:13px;color:var(--t3)">아직 선택한 수업이 없습니다. 위 버튼으로 시간표에서 고르세요.</div>';
  const sorted=list.slice().sort(function(a,b){ if(String(a.dow)!==String(b.dow))return (a.dow-b.dow); return (parseInt(a.perio)||0)-(parseInt(b.perio)||0); });
  return '<div style="display:flex;flex-direction:column;gap:6px">'+sorted.map(function(p){
    const info=[(p.grade?p.grade+'학년':''),(p.dept||''),(p.cls?p.cls+'반':'')].filter(Boolean).join(' ');
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(236,72,153,0.06);border:1px solid rgba(236,72,153,0.18);border-radius:7px;font-size:11px">'
      +'<span style="font-weight:700;color:#db2777;white-space:nowrap">'+classDowLabel(p.dow)+' '+escHtml(String(p.perio))+'교시</span>'
      +'<span style="color:var(--t1);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(p.content||'수업')+(info?(' <span style="color:var(--t3)">· '+escHtml(info)+'</span>'):'')+'</span>'
      +'<span style="color:#db2777;font-weight:700;white-space:nowrap">⏰'+escHtml(p.time||'')+'</span>'
      +'<button data-action="class-popup-del" data-key="'+escHtml(classPopupKey(p))+'" style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:13px;font-weight:700;padding:0 4px" title="삭제">✕</button>'
      +'</div>';
  }).join('')+'</div>';
}
bus.on('classpopup:changed',function(){ const l=document.getElementById('setClassPopupList'); if(l)l.innerHTML=_renderClassPopupList(); });

/* ═══ 설정: 약품→증상 매칭 관리 ═══ */
/* 데이터: { "약품명": ["증상1","증상2",...], ... } */
const _userMedSyms=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
function _saveMedSyms(){
  localStorage.setItem('ec_user_med_syms',JSON.stringify(_userMedSyms));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_med_syms',_userMedSyms);
}
let _setMedEditTarget=''; /* 현재 증상 추가 중인 약품명 */

/* 약품 입력 자동완성 */
export function _setMedInitInput(){
  /* 자동완성 없음 — 새 약품명 직접 입력 전용.
   * 2026-05-27 2단 재구성: 좌(숨기기) · 우(추가/수정) 두 컬럼 리스트의 초기 렌더 트리거.
   * xlsx 매핑(symptom_medicine_matching.xlsx) 도 백그라운드로 로드 (캐시 없을 때만 IPC). */
  _setMedSearchRender();
  try{ _setLoadXlsxMedSymMap(); }catch(_){}
  /* 안내문 height 동기화 — 좌측 안내문이 우측보다 짧아 검색창이 위로 떠 보이는 문제 해결.
   * 우측 height 를 측정해 좌측 min-height 로 적용 + ResizeObserver 로 viewport 변경 시 재동기화. */
  try{
    const _sync=function(){
      const l=document.getElementById('setMedSubHideHint');
      const r=document.getElementById('setMedSubAddHint');
      if(!l||!r) return;
      const rh=r.offsetHeight;
      if(rh>0) l.style.minHeight = rh + 'px';
    };
    requestAnimationFrame(_sync);
    if(window.ResizeObserver){
      const _r=document.getElementById('setMedSubAddHint');
      if(_r){ new ResizeObserver(_sync).observe(_r); }
    }
  }catch(_){}
}

/* ── 사용자가 명시적으로 "+ 약품 추가" 로 등록한 약품 set ──
 *  사용자 요청 2026-05-27: 시스템 약품의 ✏️ prefill 이 _userMedSyms 에 매핑을 저장하면서
 *  "등록된 약품" 카드 목록에 시스템 약품이 등장하는 버그 발생.
 *  → 사용자가 직접 등록한 약품만 별도 store 에 마킹해 카드 목록 표시 대상으로 사용.
 *  _userMedSyms (매핑 데이터) 와 _userAddedMeds (등록 set) 두 store 로 의미 분리. */
let _userAddedMeds=null;
function _setGetUserAddedMeds(){
  if(_userAddedMeds) return _userAddedMeds;
  let s={};
  try{ s=JSON.parse(localStorage.getItem('ec_user_added_meds')||'{}')||{}; }catch(_){}
  /* 마이그레이션 — ec_user_added_meds 가 비어 있고 _userMedSyms 에 약품이 있다면 (이전 버전 사용자),
   * prefilled 플래그가 없는 약품은 사용자가 직접 추가한 것으로 간주해 자동 마킹. */
  if(Object.keys(s).length===0 && Object.keys(_userMedSyms).length>0){
    let pf={};
    try{ pf=JSON.parse(localStorage.getItem('ec_user_med_syms_prefilled')||'{}')||{}; }catch(_){}
    Object.keys(_userMedSyms).forEach(function(m){ if(!pf[m]) s[m]=true; });
    try{
      localStorage.setItem('ec_user_added_meds',JSON.stringify(s));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_added_meds',s);
    }catch(_){}
  }
  _userAddedMeds=s;
  return s;
}
function _setMarkUserAddedMed(name){
  const s=_setGetUserAddedMeds();
  if(s[name]) return;
  s[name]=true;
  try{
    localStorage.setItem('ec_user_added_meds',JSON.stringify(s));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_added_meds',s);
  }catch(_){}
}
function _setUnmarkUserAddedMed(name){
  const s=_setGetUserAddedMeds();
  if(!s[name]) return;
  delete s[name];
  try{
    localStorage.setItem('ec_user_added_meds',JSON.stringify(s));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_added_meds',s);
  }catch(_){}
}

/* 약품 추가 (_setMedAddDirect) —
   e약은요 API 로 약품 상세 정보(성분·효능·용법·주의사항) fetch 후
   사용자 JSON(medications_list) 에 영구 저장.
   백그라운드 Promise 로 동작 — 사용자가 설정을 닫거나 다른 작업을 해도 완료까지 실행.
   시스템/사용자 JSON 은 분리 관리 (런타임에 검색 시 merge).
   (구 _setMedAdd 래퍼는 setMedAddInput 폐기와 함께 제거 — 호출자가 직접 _setMedAddDirect(name) 호출.) */
function _setMedAddDirect(name){
  if(!_userMedSyms[name])_userMedSyms[name]=[];
  _saveMedSyms();
  /* 사용자가 명시적으로 "+ 약품 추가" 한 약품으로 마킹 — 카드 목록 표시 대상 (시스템 prefill 과 분리) */
  _setMarkUserAddedMed(name);
  /* 사용자 요청 2026-05-27: 우측 추가 시 좌측에서 자동 unhide — 추가한 약품은 즉시 양쪽에 보여야 함. */
  try{
    const _h=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}')||{};
    if(_h[name]){
      delete _h[name];
      localStorage.setItem('ec_med_hidden',JSON.stringify(_h));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_hidden',_h);
      if(typeof refreshMedHidden==='function') refreshMedHidden();
    }
  }catch(_){}
  /* (구) setMedAddInput 은 2026-05-27 2단 재구성으로 제거됨 — 호출자(검색 input/button)가 input 값 정리/focus 담당. */
  const dd=document.getElementById('setMedAddDD');if(dd)dd.style.display='none';
  _setMedRenderCards();
  /* 신규 약품이 좌·우 두 컬럼 리스트에도 즉시 반영되도록 재렌더 (외부 호출자 누락 대비). */
  _setMedSearchRender();
  /* "+약품 추가" 버튼 클릭 시점에 "저장 중… → 모든 내용이 저장되었습니다." 흐름 표시.
     (타이핑 중에는 아무 토스트도 뜨지 않음 — #setMedAddInput 은 전역 input 리스너에서 제외됨) */
  bus.emit('toast:saveLater');
  setTimeout(function(){ bus.emit('toast:save'); }, 180);
  /* ── 백그라운드 API fetch + 사용자 JSON 등재 ──
     약품 이름으로 e약은요 API 호출 → 상세정보 획득 → medications_list.json 에 upsert.
     UI 블로킹 없이 Promise 큐로 수행. 실패해도 사용자 매핑(_userMedSyms) 은 유지. */
  _fetchAndCacheDrugFromEyakey(name);
}

/* ── 시스템 약품 전체 일괄 조회 ──
   medical-data.json 의 medicationDB 에서 약품명을 추출 → 미캐시 약품만 순차 fetch → medications_list.json 에 등재.
   1초 간격 rate-limit, 중단/재개 지원. */
let _bulkFetchAbort=false;
let _bulkFetchRunning=false;

function _bulkUpdateUI(done, total, currentName){
  const btn=document.getElementById('setMedBulkFetchBtn');
  const cancelBtn=document.getElementById('setMedBulkCancelBtn');
  const status=document.getElementById('setMedBulkStatus');
  const wrap=document.getElementById('setMedBulkProgressWrap');
  const bar=document.getElementById('setMedBulkProgressBar');
  /* API 키 탭에도 동일한 업데이트 버튼이 있을 수 있어 그쪽 status 도 함께 갱신 */
  const apiStatus=document.getElementById('setMedApiStatus');
  if(btn)btn.style.display=_bulkFetchRunning?'none':'inline-flex';
  if(cancelBtn)cancelBtn.style.display=_bulkFetchRunning?'inline-flex':'none';
  if(wrap)wrap.style.display=_bulkFetchRunning?'block':'none';
  if(bar)bar.style.width=(total?Math.round((done/total)*100):0)+'%';
  const msg = _bulkFetchRunning ? (done+' / '+total+' 조회 중' + (currentName?' — '+currentName:''))
            : (total && done>=total ? ('✅ 전체 '+total+'건 완료') : '');
  if(status) status.textContent = msg;
  if(apiStatus) apiStatus.textContent = msg;
}

export async function _setMedBulkFetchStart(isUpdate){
  if(_bulkFetchRunning)return;
  let apiKey='';
  try{apiKey=getPublicDataApiKey('drug');}catch(e){}
  if(!apiKey){
    alert('공공데이터포털 인증키가 등록되지 않았습니다.\n\n설정 > API 키 설정에서 공통 인증키를 등록하고, 식약처 e약은요 서비스의 활용 신청을 완료해 주세요.');
    return;
  }
  /* 시스템 약품 목록 로드 — medical-data.json 의 medicationDB 가 단일 출처 */
  let allNames=[];
  try{
    if(window.electronAPI&&window.electronAPI.readFile){
      const r2=await window.electronAPI.readFile('__app__/templates/medical-data.json');
      if(r2&&r2.success&&r2.data){
        const md=JSON.parse(r2.data);
        if(md&&md.medicationDB){
          const set=new Set();
          Object.keys(md.medicationDB).forEach(function(cat){
            (md.medicationDB[cat]||[]).forEach(function(nm){if(nm)set.add(nm);});
          });
          allNames=Array.from(set);
        }
      }
    }
  }catch(e){ console.warn('[bulk] medical-data load failed', e); }
  if(!allNames.length){
    alert('시스템 약품 JSON 을 불러올 수 없습니다.');
    return;
  }
  /* 단일 버튼(안전모드, 2026-06-08) — 기존 캐시·사용자 수동 추가분을 보존하면서
     시스템 약품 전체를 (재)조회·최신화(upsert). 빠진 건 채우고, 있는 건 최신 정보로 덮어씀.
     (옛 '전체 교체'처럼 cache 를 리셋하지 않으므로 수동 추가 약품이 보존됨.) */
  let cache={items:{}, order:[]};
  try{
    if(window.electronAPI&&window.electronAPI.jsonLoadCommon){
      const r=await window.electronAPI.jsonLoadCommon({key:'medications_list'});
      if(r&&r.success&&r.data&&typeof r.data==='object') cache=r.data;
    }
  }catch(e){}
  cache.items=cache.items||{};
  cache.order=Array.isArray(cache.order)?cache.order:[];
  const targets = allNames.slice();   /* 시스템 약품 전체 — 빠진 건 채우고 있는 건 최신화 */

  if(!targets.length){
    await appConfirmModal(
      '모든 시스템 약품이 이미 사용자 JSON 에 등재되어 있습니다. (<b>'+allNames.length+'</b>건)<br><br>[🔄 업데이트] 버튼을 사용하면 이미 등재된 약품도 최신 정보로 재조회할 수 있습니다.',
      '📥 일괄 조회',
      { okLabel:'확인', okOnly:true, okBg:'rgba(6,182,212,0.10)', okBorder:'rgba(6,182,212,0.35)', okColor:'#0e7490' }
    );
    return;
  }

  const title = '📥 약품정보 전체 불러오기 · 업데이트';
  const msgHtml = '시스템 약품 <b>'+allNames.length+'</b>건을 식약처 e약은요 API 로 전체 (재)조회·최신화합니다.'
    + '<br><span style="font-size:11.5px;color:var(--t2)">빠진 건 채우고, 이미 있는 건 최신 정보로 갱신합니다. 사용자가 <b>수동 추가한 약품은 보존</b>됩니다.</span>'
    + '<br><br>예상 소요 시간: 약 '+Math.ceil(allNames.length*1.2/60)+'분 (약 1.2초당 1건)'
    + '<br>중간에 중단해도 다음 실행 시 이어갈 수 있습니다.<br><br>진행하시겠습니까?';
  const _proceed = await appConfirmModal(msgHtml, title, {
    okLabel:'시작', cancelLabel:'취소',
    okBg:'rgba(6,182,212,0.10)', okBorder:'rgba(6,182,212,0.35)', okColor:'#0e7490'
  });
  if(!_proceed){
    return;
  }
  /* 안전모드(2026-06-08) — 디스크 캐시를 리셋하지 않음. 기존 항목·사용자 수동 추가분 보존, 조회분만 upsert. */

  _bulkFetchRunning=true;
  _bulkFetchAbort=false;
  _bulkUpdateUI(0, targets.length);

  let done=0;
  let fail=0;
  const failNoData=[], failErr=[];   /* 무엇이 실패했는지: 정보없음(API 응답O·데이터X) vs 조회오류(예외) 구분 */
  for(const name of targets){
    if(_bulkFetchAbort){
      _bulkUpdateUI(done, targets.length);
      break;
    }
    _bulkUpdateUI(done, targets.length, name);
    try{
      const res = await window.electronAPI.externalFetchDrugInfo(apiKey, name);
      if(res&&res.success&&res.data){
        /* 사용자 JSON 에 upsert — 매 건마다 save 는 부하, 50개마다 배치 save */
        cache.items[name]={
          itemSeq: res.data.itemSeq||'',
          itemName: res.data.itemName||name,
          entpName: res.data.entpName||'',
          efcyQesitm: res.data.efcyQesitm||'',
          useMethodQesitm: res.data.useMethodQesitm||'',
          atpnWarnQesitm: res.data.atpnWarnQesitm||'',
          atpnQesitm: res.data.atpnQesitm||'',
          intrcQesitm: res.data.intrcQesitm||'',
          seQesitm: res.data.seQesitm||'',
          depositMethodQesitm: res.data.depositMethodQesitm||'',
          itemImage: res.data.itemImage||'',
          source: 'bulk_import',
          cachedAt: new Date().toISOString()
        };
        if(cache.order.indexOf(name)===-1) cache.order.push(name);
      } else {
        fail++; failNoData.push(name);   /* API 응답은 왔으나 데이터 없음 = e약은요에 실제로 없음 */
      }
    }catch(e){
      fail++; failErr.push(name);        /* 네트워크 등 예외 = 재시도 가능 */
      console.warn('[bulk] fetch failed', name, e);
    }
    done++;
    /* 50건마다 중간 저장 (중단되어도 진행 결과 보존) */
    if(done%50===0 && window.electronAPI&&window.electronAPI.jsonSaveCommon){
      await window.electronAPI.jsonSaveCommon({key:'medications_list', data:cache});
    }
    /* 1.2초 간격 — 식약처 API rate limit 대응 */
    await new Promise(function(r){ setTimeout(r, 1200); });
  }

  /* 최종 저장 — 전체 완료 시 타임스탬프 기록 */
  if(!_bulkFetchAbort){
    cache.cachedAt = new Date().toISOString();
  }
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
    await window.electronAPI.jsonSaveCommon({key:'medications_list', data:cache});
  }

  _bulkFetchRunning=false;
  _bulkUpdateUI(done, targets.length);
  const status=document.getElementById('setMedBulkStatus');
  if(status){
    if(_bulkFetchAbort) status.textContent='⏸ 중단됨 — '+done+' / '+targets.length+' 완료. 다시 시작하면 이어서 조회합니다.';
    else status.textContent='✅ 완료 — '+done+'건 조회 성공'+(fail?', '+fail+'건 실패':'');
  }
  /* 배지 갱신 */
  _setMedCacheStatusUpdate();
  if(!_bulkFetchAbort){
    const _okCnt = done - fail;
    const _mkList = function(arr){
      return '<div style="max-height:150px;overflow-y:auto;border:1px solid var(--bdr);border-radius:6px;padding:6px 8px;font-size:11px;line-height:1.7;color:var(--t1);background:var(--bg2)">'
        + arr.map(function(n){return escHtml(n);}).join(', ') + '</div>';
    };
    let _m = '<div style="font-size:12.5px;margin-bottom:8px">성공 <b style="color:#16a34a">'+_okCnt+'</b>건 · 실패 <b style="color:#dc2626">'+fail+'</b>건</div>'
      + '<div style="font-size:11.5px;color:var(--t2);line-height:1.7">사용자 JSON 에 영구 저장되었습니다. 이제 <b>인터넷 없이도</b> 모든 약품 상세정보가 즉시 표시됩니다.</div>';
    if(failNoData.length){
      _m += '<div style="font-size:11.5px;font-weight:700;color:#a16207;margin:12px 0 4px">ℹ e약은요에 정보가 없는 약품 ('+failNoData.length+'건)<br><span style="font-weight:500;color:var(--t2)">식약처 e약은요 DB에 항목 자체가 없습니다 (오류 아님).</span></div>'
        + _mkList(failNoData);
    }
    if(failErr.length){
      _m += '<div style="font-size:11.5px;font-weight:700;color:#dc2626;margin:12px 0 4px">⚠ 조회 중 오류로 실패 ('+failErr.length+'건)<br><span style="font-weight:500;color:var(--t2)">네트워크 등 문제일 수 있어, 다시 실행하면 이어서 조회합니다.</span></div>'
        + _mkList(failErr);
    }
    await appConfirmModal(_m, '📥 약품 정보 일괄 조회 완료', { okLabel:'확인', okOnly:true, okBg:'rgba(6,182,212,0.10)', okBorder:'rgba(6,182,212,0.35)', okColor:'#0e7490' });
  }
}

/* ═══ 캐시 상태 배지 업데이트 — 일괄 조회 / 업데이트 버튼 노출 분기 ═══ */
async function _setMedCacheStatusUpdate(){
  const badge=document.getElementById('setMedCacheBadge');
  const bulkBtn=document.getElementById('setMedBulkFetchBtn');
  const updateBtn=document.getElementById('setMedUpdateBtn');
  if(!badge) return;
  try{
    if(!window.electronAPI||!window.electronAPI.jsonLoadCommon){ badge.textContent='미지원'; return; }
    const r=await window.electronAPI.jsonLoadCommon({key:'medications_list'});
    const cache=(r&&r.success&&r.data&&typeof r.data==='object')?r.data:null;
    const count = cache&&cache.items ? Object.keys(cache.items).length : 0;
    if(!cache || count===0){
      badge.textContent='불러오기 전';
      badge.style.background='rgba(156,163,175,0.1)';
      badge.style.color='#94a3b8';
      if(updateBtn) updateBtn.style.display='inline-flex';   /* 안전모드 단일 버튼 — 캐시 없어도 항상 노출 */
      return;
    }
    const cachedAt = cache.cachedAt ? new Date(cache.cachedAt) : null;
    const fetched = cachedAt ? cachedAt.toLocaleDateString('ko-KR') : '날짜 미상';
    const ageDays = cachedAt ? Math.floor((Date.now()-cachedAt.getTime())/86400000) : 999;
    const stale = ageDays >= 30;
    badge.textContent = (stale?'⚠ 업데이트 권장':'✅ 불러오기 완료')+' · '+count+'건 · '+fetched+(ageDays?' ('+ageDays+'일 전)':'');
    badge.style.background = stale?'rgba(234,179,8,0.1)':'rgba(34,197,94,0.1)';
    badge.style.color = stale?'#ca8a04':'#16a34a';
    /* 캐시 건수가 충분하면 업데이트 버튼 노출 */
    if(bulkBtn) bulkBtn.style.display='inline-flex';
    if(updateBtn) updateBtn.style.display='inline-flex';
  }catch(e){ badge.textContent='확인 실패'; }
}

function _setMedBulkFetchCancel(){
  if(!_bulkFetchRunning)return;
  _bulkFetchAbort=true;
}

/* ── 영구 큐: 앱 재시작해도 중단된 약품 fetch 이어가기 ──
   localStorage 에 pending 리스트 저장 → 앱 부팅 시 자동 재개.
   정상 완료·실패(4xx 명확한 경우) 시 큐에서 제거. */
const _EYAKEY_QUEUE_KEY='ec_eyakey_pending_queue';
function _eyakeyQueueLoad(){
  try{const r=JSON.parse(localStorage.getItem(_EYAKEY_QUEUE_KEY)||'null'); return Array.isArray(r)?r:[];}catch(e){return [];}
}
function _eyakeyQueueSave(arr){
  try{localStorage.setItem(_EYAKEY_QUEUE_KEY, JSON.stringify(arr));}catch(e){}
}
function _eyakeyQueueAdd(name){
  if(!name)return;
  const q=_eyakeyQueueLoad();
  if(q.indexOf(name)===-1){ q.push(name); _eyakeyQueueSave(q); }
}
function _eyakeyQueueRemove(name){
  const q=_eyakeyQueueLoad();
  const idx=q.indexOf(name);
  if(idx!==-1){ q.splice(idx,1); _eyakeyQueueSave(q); }
}
/* 부팅 시 미완료 큐 재개 — 직렬 처리로 API 부하 최소화 */
(function _resumeEyakeyQueueOnBoot(){
  setTimeout(function(){
    const q=_eyakeyQueueLoad();
    if(!q.length)return;
    console.info('[eyakey-cache] 미완료 큐', q.length, '개 재개');
    (async function(){
      for(const name of q){
        try{ await _fetchAndCacheDrugFromEyakey(name); } catch(e){ console.warn('[eyakey-cache] resume fail', name, e); }
      }
    })();
  }, 3000);
})();

/* e약은요 API → 사용자 JSON 등재 (백그라운드).
   진입점: 약품 추가 버튼, 사용자가 팝업 닫거나 다른 작업해도 끝까지 진행.
   영구 큐(_EYAKEY_QUEUE_KEY) 에 등록 후 시도, 성공·결정적 실패 시 큐에서 제거. */
async function _fetchAndCacheDrugFromEyakey(drugName){
  const t=document.getElementById('globalSaveToast');
  function _toast(msg, saving){
    let el=t;
    if(!el){ el=document.createElement('div'); el.id='globalSaveToast'; el.className='global-save-toast'; document.body.appendChild(el); }
    el.textContent=msg;
    el.className='global-save-toast show'+(saving?' saving':'');
    clearTimeout(el._t); el._t=setTimeout(function(){ el.className='global-save-toast'; }, saving?0:3500);
  }
  /* 영구 큐에 등록 — 앱이 종료돼도 다음 실행 때 이어감 */
  _eyakeyQueueAdd(drugName);
  try{
    /* 1) 사용자 JSON 현재 상태 불러오기 (없으면 빈 오브젝트) */
    let cache={items:{}, order:[]};
    try{
      if(window.electronAPI&&window.electronAPI.jsonLoadCommon){
        const r=await window.electronAPI.jsonLoadCommon({key:'medications_list'});
        if(r&&r.success&&r.data&&typeof r.data==='object') cache=r.data;
      }
    }catch(e){}
    cache.items=cache.items||{};
    cache.order=Array.isArray(cache.order)?cache.order:[];

    /* 2) 이미 캐시에 있으면 API 호출 생략 — 중복 호출 방지 */
    if(cache.items[drugName]){
      _toast('사용자 JSON 에 이미 등재된 약품입니다.', false);
      _eyakeyQueueRemove(drugName);
      return;
    }

    /* 3) 사용자가 저장해둔 API 키 확인 */
    let drugKey='';
    try{ drugKey=getPublicDataApiKey('drug'); }catch(e){}
    if(!drugKey){
      /* 키가 없어도 사용자 매핑은 유지. API 등재는 불가. 큐에서 제거하지 않음 — 나중에 키 등록되면 재개. */
      _toast('💊 '+drugName+' 추가됨 (API 키 미등록 — 식약처 키를 설정하면 상세정보가 자동 등재됩니다)', false);
      return;
    }

    _toast('💊 "'+drugName+'" e약은요 API 조회 중…', true);

    /* 4) 백그라운드 fetch — 사용자가 다른 작업해도 이 Promise 는 이어서 실행됨 */
    const res = await window.electronAPI.externalFetchDrugInfo(drugKey, drugName);
    if(!res||!res.success||!res.data){
      _toast('💊 "'+drugName+'" 약품 정보를 찾지 못했습니다. 이름을 확인해주세요.', false);
      /* 결정적 실패(이름이 API 에 없음)는 큐에서 제거. 네트워크 일시 오류였다면 큐에 남겨 다음 실행에 재시도. */
      if(res && res.success===false && res.error && /찾지|존재|empty|not found/i.test(res.error)===false){
        /* 네트워크·서버 오류로 추정 — 큐 유지 */
      } else {
        _eyakeyQueueRemove(drugName);
      }
      return;
    }
    const info=res.data;

    /* 5) 사용자 JSON 에 upsert */
    cache.items[drugName]={
      itemSeq: info.itemSeq || '',
      itemName: info.itemName || drugName,
      entpName: info.entpName || '',
      efcyQesitm: info.efcyQesitm || '',            /* 효능·효과 */
      useMethodQesitm: info.useMethodQesitm || '',  /* 용법·용량 */
      atpnWarnQesitm: info.atpnWarnQesitm || '',    /* 주의사항 경고 */
      atpnQesitm: info.atpnQesitm || '',            /* 주의사항 */
      intrcQesitm: info.intrcQesitm || '',          /* 상호작용 */
      seQesitm: info.seQesitm || '',                /* 부작용 */
      depositMethodQesitm: info.depositMethodQesitm || '', /* 저장 방법 */
      itemImage: info.itemImage || '',
      source: 'user',
      addedAt: new Date().toISOString()
    };
    if(cache.order.indexOf(drugName)===-1) cache.order.push(drugName);

    /* 6) 저장 */
    if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
      const sv=await window.electronAPI.jsonSaveCommon({key:'medications_list', data:cache});
      if(!sv||!sv.success){ _toast('💊 저장 실패: '+(sv&&sv.error||'알 수 없는 오류'), false); return; }
    }
    /* 성공 — 큐에서 제거 */
    _eyakeyQueueRemove(drugName);
    _toast('💊 "'+drugName+'" 사용자 JSON 등재 완료', false);
  }catch(err){
    /* 예외는 네트워크 일시 오류일 가능성 높음 — 큐 유지. 다음 실행 시 재시도. */
    console.error('[eyakey-cache] fetch/save failed', err);
    _toast('💊 "'+drugName+'" 등재 중 오류 (재시도 큐 유지): '+(err.message||err), false);
  }
}

/* 약품 삭제 — 사용자 JSON 캐시(medications_list) 에서도 함께 제거.
   큐에 대기중이었다면 큐에서도 제거.
   v3 (사용자 결정 2026-05-21) — 캐시 존재 여부에 따라 안내 메시지 분기. */
async function _setMedRemove(name){
  /* 캐시 존재 여부 비동기 확인 */
  let hasCache = false;
  try{
    if(window.electronAPI && window.electronAPI.jsonLoadCommon){
      const r = await window.electronAPI.jsonLoadCommon({key:'medications_list'});
      if(r && r.success && r.data && r.data.items && r.data.items[name]) hasCache = true;
    }
  }catch(_){}
  /* 사용자 정책 (2026-05-22): 한 번 클릭으로 즉시 삭제 — 확인 모달 제거.
   *  hasCache 는 아래 사용자 JSON 캐시 동기 제거 분기에서 사용. */
  delete _userMedSyms[name];
  _saveMedSyms();
  _setUnmarkUserAddedMed(name);
  _eyakeyQueueRemove(name);
  /* 사용자 JSON 캐시에서도 제거 — 비동기. 캐시 없으면 noop. */
  if(hasCache && window.electronAPI&&window.electronAPI.jsonLoadCommon&&window.electronAPI.jsonSaveCommon){
    window.electronAPI.jsonLoadCommon({key:'medications_list'}).then(function(r){
      if(!r||!r.success||!r.data)return;
      const cache=r.data;
      if(cache.items && cache.items[name]) delete cache.items[name];
      if(Array.isArray(cache.order)) cache.order=cache.order.filter(function(n){return n!==name;});
      return window.electronAPI.jsonSaveCommon({key:'medications_list', data:cache});
    }).catch(function(){});
  }
  _setMedRenderCards();
  bus.emit('toast:save');
}

/* 약품 카드 목록 렌더 — 사용자 요청 2026-05-27: 한 줄 표시.
 *  · 표시 대상: 사용자가 "+ 약품 추가" 로 명시적으로 등록한 약품만 (_setGetUserAddedMeds).
 *  · 한 줄 = 약품명 + 증상 1~4 칩(읽기 전용) + ✕ 삭제. 매칭 편집은 우측 컬럼 ✏️ 미니 팝업에서. */
export function _setMedRenderCards(){
  const el=document.getElementById('setMedCardList');if(!el)return;
  const userAdded=_setGetUserAddedMeds();
  const meds=Object.keys(_userMedSyms).filter(function(m){return userAdded[m];});
  if(!meds.length){el.innerHTML='<div style="text-align:center;padding:14px;color:var(--t3);font-size:10px">등록된 약품이 없습니다. 위에서 새 약품을 추가하세요.</div>';return;}
  /* medications_list.json 캐시 비동기 로드 — "📖 정보" 배지 표시용 */
  if(window.electronAPI&&window.electronAPI.jsonLoadCommon){
    window.electronAPI.jsonLoadCommon({key:'medications_list'}).then(function(r){
      if(r&&r.success&&r.data&&r.data.items){
        Object.keys(r.data.items).forEach(function(name){
          const badge=document.querySelector('[data-med-cache-badge="'+CSS.escape(name)+'"]');
          if(badge) badge.style.display='inline-flex';
        });
      }
    }).catch(function(){});
  }
  let h='';
  meds.forEach(function(med){
    const syms=(_userMedSyms[med]||[]).slice(0,4);
    h+='<div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 10px;margin-bottom:3px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);font-size:11px">';
    /* 약품명 — 한 줄 ellipsis */
    h+='<span style="font-weight:700;color:var(--t1);min-width:100px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(med)+'">💊 '+escHtml(med)+'</span>';
    /* e약은요 캐시 배지 (초기 hidden, 비동기 로드 후 show) */
    h+='<span data-med-cache-badge="'+escHtml(med)+'" style="display:none;align-items:center;font-size:8px;font-weight:700;color:#16a34a;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);padding:1px 6px;border-radius:4px" title="e약은요 API 정보가 사용자 JSON 에 등재됨">📖</span>';
    /* 증상 매칭 4슬롯 (2026-06-09 카드에 복원) — 채워진 건 ✕ 로 해제, 빈 슬롯 "+ 증상매칭" 클릭 → 상분류→중분류 picker */
    for(let _i=0;_i<4;_i++){
      const _sym=syms[_i];
      if(_sym){
        h+='<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid rgba(6,182,212,0.3);border-radius:10px;font-size:10px;color:var(--cyan);background:rgba(6,182,212,0.06);white-space:nowrap">'
          +escHtml(_sym)
          +'<span data-action="med-card-rm-sym" data-med="'+escHtml(med)+'" data-sym="'+escHtml(_sym)+'" style="cursor:pointer;color:var(--rs);font-size:10px;line-height:1;margin-left:1px" title="이 증상 매칭 해제">✕</span>'
        +'</span>';
      } else {
        h+='<span data-action="med-card-add-sym" data-med="'+escHtml(med)+'" style="display:inline-flex;align-items:center;padding:2px 7px;border:1.5px dashed var(--bdr);border-radius:10px;font-size:10px;color:var(--t3);cursor:pointer;white-space:nowrap" title="상분류→중분류 증상을 선택해 매칭">+ 증상매칭</span>';
      }
    }
    /* 우측 끝 ✕ 삭제 */
    h+='<span style="flex:1"></span>';
    h+='<span data-action="med-remove" data-med="'+escHtml(med)+'" style="cursor:pointer;color:var(--rs);font-size:11px;font-weight:700;padding:0 4px" title="약품 삭제">✕</span>';
    h+='</div>';
  });
  el.innerHTML=h;
  /* event delegation — 클릭 핸들러는 한 번만 부착 (재렌더 시 중복 방지) */
  if(!el._cardClickBound){
    el._cardClickBound=true;
    el.addEventListener('click',function(e){
      const t=e.target.closest('[data-action]');if(!t)return;
      const act=t.dataset.action;
      if(act==='med-remove'){e.stopPropagation();_setMedRemove(t.dataset.med);}
      else if(act==='med-card-add-sym'){e.stopPropagation();_setMedOpenSymPicker(t.dataset.med, t);} /* 빈 슬롯 → 상분류→중분류 picker */
      else if(act==='med-card-rm-sym'){e.stopPropagation();_setMedRemoveSym(t.dataset.med, t.dataset.sym);}
    });
  }
}

/* 증상에서 약품 제거 */
function _setMedRemoveSym(med,sym){
  if(!_userMedSyms[med])return;
  _userMedSyms[med]=_userMedSyms[med].filter(function(s){return s!==sym;});
  _saveMedSyms();
  _setMedRenderCards();
  bus.emit('toast:save');
}

/* ── 증상 선택 피커 (카테고리1 → 카테고리2) ── */
function _setMedOpenSymPicker(med,btnEl){
  _setMedEditTarget=med;
  /* 기존 피커 제거 */
  const old=document.getElementById('setMedSymPicker');if(old)old.remove();
  const picker=document.createElement('div');picker.id='setMedSymPicker';
  picker.style.cssText='position:fixed;z-index:11500;background:var(--card);border:1px solid var(--cyan);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.25);width:320px;max-height:350px;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity .15s ease,transform .15s ease';
  /* 위치 계산 */
  const rect=btnEl.getBoundingClientRect();
  let top=rect.bottom+4;let left=rect.left;
  if(top+350>window.innerHeight)top=rect.top-354;
  if(left+320>window.innerWidth)left=window.innerWidth-328;
  picker.style.top=top+'px';picker.style.left=left+'px';
  /* 헤더 */
  picker.innerHTML='<div style="padding:8px 12px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:11px;font-weight:700;color:var(--t1)">'+escHtml(med)+' — 증상 선택</div>'
    +'<div style="display:flex;flex:1;overflow:hidden">'
    +'<div id="setMedSymCat1" style="width:110px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--bdr);scrollbar-width:thin"></div>'
    +'<div id="setMedSymCat2" style="flex:1;overflow-y:auto;scrollbar-width:thin;padding:4px"></div>'
    +'</div>';
  document.body.appendChild(picker);
  requestAnimationFrame(function(){picker.style.opacity='1';picker.style.transform='scale(1)';});
  /* 카테고리1 렌더 */
  const cats=getSymData().symCategories||[];
  const c1=document.getElementById('setMedSymCat1');
  if(c1){
    c1.innerHTML=cats.map(function(c){
      return '<div data-action="med-sym-pick-cat" data-cat-id="'+escHtml(c.id)+'" style="padding:6px 8px;cursor:pointer;font-size:10px;font-weight:600;color:var(--t2);transition:all .1s;border-left:3px solid transparent">'
        +escHtml(c.icon||'')+' '+escHtml(c.name)+'</div>';
    }).join('');
    c1.addEventListener('click',function(e){
      const t=e.target.closest('[data-action="med-sym-pick-cat"]');if(!t)return;
      e.stopPropagation();_setMedSymPickCat(t.dataset.catId);
    });
    c1.querySelectorAll('[data-action="med-sym-pick-cat"]').forEach(function(d){
      d.addEventListener('mouseenter',function(){this.style.background='var(--hover)';this.style.borderLeftColor='var(--cyan)';});
      d.addEventListener('mouseleave',function(){this.style.background='transparent';this.style.borderLeftColor='transparent';});
    });
  }
  /* 외부 클릭으로 닫기 */
  setTimeout(function(){
    document.addEventListener('mousedown',function _closePicker(e){
      if(!picker.contains(e.target)){
        picker.style.opacity='0';picker.style.transform='scale(0.95)';
        setTimeout(function(){if(picker.parentNode)picker.remove();},150);
        document.removeEventListener('mousedown',_closePicker);
      }
    });
  },10);
}

/* 카테고리1 선택 → 카테고리2(세부 증상) 표시 */
function _setMedSymPickCat(catId){
  const cats=getSymData().symCategories||[];
  const cat=cats.find(function(c){return c.id===catId;});
  if(!cat)return;
  /* 카테고리1 하이라이트 */
  const c1=document.getElementById('setMedSymCat1');
  if(c1)c1.querySelectorAll('div').forEach(function(d,i){
    const thisCat=cats[i];
    const isAct=thisCat&&thisCat.id===catId;
    d.style.fontWeight=isAct?'700':'600';
    d.style.color=isAct?'var(--cyan)':'var(--t2)';
    d.style.borderLeftColor=isAct?'var(--cyan)':'transparent';
    d.style.background=isAct?'rgba(6,182,212,0.08)':'transparent';
  });
  /* 카테고리2 렌더 */
  const c2=document.getElementById('setMedSymCat2');if(!c2)return;
  const _hiddenSyms=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  const _userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  const syms=cat.symptoms.filter(function(s){return ((_hiddenSyms[catId]||[]).indexOf(s)===-1);}).concat(_userSyms[catId]||[]);
  const existingSyms=_userMedSyms[_setMedEditTarget]||[];
  c2.innerHTML=syms.map(function(sym){
    const already=existingSyms.indexOf(sym)!==-1;
    return '<div data-action="med-sym-pick" data-sym="'+escHtml(sym)+'" data-already="'+(already?'1':'')+'" style="padding:4px 8px;cursor:'+(already?'default':'pointer')+';font-size:10px;font-weight:'+(already?'700':'600')+';color:'+(already?'#16a34a':'var(--t1)')+';border-radius:4px;transition:all .1s;'+(already?'background:#dcfce7':'')+'">'+escHtml(sym)+(already?' ✓':'')+'</div>';
  }).join('');
  c2.addEventListener('click',function(e){
    const t=e.target.closest('[data-action="med-sym-pick"]');if(!t)return;
    e.stopPropagation();_setMedSymPick(t.dataset.sym);
  });
  c2.querySelectorAll('[data-action="med-sym-pick"]:not([data-already="1"])').forEach(function(d){
    /* 런타임 data-already 검사 — 클릭으로 매칭된(already=1) 증상은 hover 가 배경을 안 건드리게.
     *  (예전: 클릭 직후 마우스 떼면 mouseleave 가 연두색 배경을 transparent 로 리셋해 마지막 클릭만 색 빠지던 버그. 2026-06-09) */
    d.addEventListener('mouseenter',function(){if(this.dataset.already==='1')return;this.style.background='rgba(6,182,212,0.08)';this.style.color='var(--cyan)';});
    d.addEventListener('mouseleave',function(){if(this.dataset.already==='1')return;this.style.background='transparent';this.style.color='var(--t1)';});
  });
}

/* 증상 선택 → 약품에 매칭 추가 — 저장중/완료 토스트 + 증상 팝업 즉시 반영 */
function _setMedSymPick(sym){
  if(!_setMedEditTarget)return;
  if(!_userMedSyms[_setMedEditTarget])_userMedSyms[_setMedEditTarget]=[];
  if(_userMedSyms[_setMedEditTarget].indexOf(sym)!==-1)return; /* 이미 있음 */
  /* 1) "저장 중..." 토스트 즉시 */
  bus.emit('toast:saveLater');
  _userMedSyms[_setMedEditTarget].push(sym);
  _saveMedSyms();
  _setMedRenderCards();
  /* ✏️ 미니 팝업이 열려 있고 같은 약품을 편집 중이면 슬롯 즉시 갱신 */
  const _editPop=document.getElementById('setMedEditPopup');
  if(_editPop && _editPop.dataset.med===_setMedEditTarget && typeof _setMedEditPopupRenderSlots==='function'){
    _setMedEditPopupRenderSlots();
  }
  /* 2) 증상→처치 팝업이 다음 호출에서 즉시 반영되도록 사용자 약품 인덱스도 리로드 */
  try{ if(typeof window._reloadUserMedSyms==='function') window._reloadUserMedSyms(); }catch(e){}
  /* 3) 잠깐 뒤 "모든 내용이 저장되었습니다" 토스트 */
  setTimeout(function(){ bus.emit('toast:save'); }, 180);
  /* 피커 갱신 — 매칭된 '모든' 증상에 연두색 배경+✓ (data-sym 기준). 2026-06-09: 예전 단일 div(textContent===sym) 갱신은 여러 개 매칭 시 하나만 칠해지던 문제. */
  const c2=document.getElementById('setMedSymCat2');
  if(c2){
    const _matched=_userMedSyms[_setMedEditTarget]||[];
    c2.querySelectorAll('[data-action="med-sym-pick"]').forEach(function(d){
      const _s=d.dataset.sym;
      if(_matched.indexOf(_s)!==-1){
        d.dataset.already='1';
        d.style.color='#16a34a';d.style.background='#dcfce7';d.style.fontWeight='700';d.style.cursor='default';d.style.textDecoration='none';d.style.opacity='1';
        if(d.textContent.indexOf('✓')===-1) d.textContent=_s+' ✓';
        d.onmouseenter=null;d.onmouseleave=null;
      }
    });
  }
}

/* ── 설정: 약품 삭제 검색 ── */
function _setMedDelSearchRender(){
  const inp=document.getElementById('setMedDelSearchInput');
  const list=document.getElementById('setMedDelList');
  if(!inp||!list)return;
  const q=inp.value.trim();
  if(!q){list.innerHTML='<div style="text-align:center;padding:12px;color:var(--t3);font-size:10px">삭제할 약품명을 검색하세요.</div>';return;}
  const allMeds={};
  const _md=getSymData().medDb||{};
  Object.keys(_md).forEach(function(c){(_md[c]||[]).forEach(function(m){allMeds[m]=c;});});
  const _mdu=JSON.parse(localStorage.getItem('ec_meddb_user')||'{}');
  Object.keys(_mdu).forEach(function(c){(_mdu[c]||[]).forEach(function(m){allMeds[m]='user_'+c;});});
  const pool=Object.keys(allMeds);
  const qLow=q.toLowerCase();const _hasK=/[가-힣ㄱ-ㅎ]/.test(q);
  const start=[], chosung=[], contain=[];
  pool.forEach(function(m){
    const ml=m.toLowerCase();
    if(ml.startsWith(qLow))start.push(m);
    else if(_hasK&&typeof matchKoreanFromStart==='function'&&matchKoreanFromStart(m,q))chosung.push(m);
    else if(_hasK&&typeof matchKorean==='function'&&matchKorean(m,q))chosung.push(m);
    else if(ml.includes(qLow))contain.push(m);
  });
  const matched=start.concat(chosung).concat(contain).slice(0,50);
  if(!matched.length){list.innerHTML='<div style="text-align:center;padding:12px;color:var(--t3);font-size:10px">검색 결과가 없습니다.</div>';return;}
  let h='';
  matched.forEach(function(m){
    h+='<div class="set-med-del-row" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;font-size:11px;transition:background .1s">'
      +'<span style="flex:1;color:var(--t1);font-weight:600">'+escHtml(m)+'</span>'
      +'<button data-action="med-del-confirm" data-med="'+escHtml(m)+'" style="padding:2px 8px;font-size:9px;font-weight:600;border:1px solid rgba(239,68,68,0.3);border-radius:4px;background:rgba(239,68,68,0.08);color:#dc2626;cursor:pointer;font-family:var(--f)">삭제</button>'
      +'</div>';
  });
  list.innerHTML=h;
  list.querySelectorAll('.set-med-del-row').forEach(function(row){
    row.addEventListener('mouseenter',function(){this.style.background='var(--bg2)';});
    row.addEventListener('mouseleave',function(){this.style.background='transparent';});
  });
  list.addEventListener('click',function _delClick(e){
    const t=e.target.closest('[data-action="med-del-confirm"]');if(!t)return;
    _setMedDelConfirm(t.dataset.med);
  });
}

function _setMedDelConfirm(name){
  if(!confirm('"'+name+'" 약품을 삭제하시겠습니까?\n\n모든 카테고리에서 해당 약품이 제거됩니다.'))return;
  /* 기본 DB에서는 삭제 불가 → 숨기기로 처리 */
  const _md=getSymData().medDb||{};
  let inBase=false;
  Object.keys(_md).forEach(function(c){if((_md[c]||[]).indexOf(name)!==-1)inBase=true;});
  if(inBase){
    /* 기본 약품 → 숨기기 처리 */
    const hidden=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}');
    hidden[name]=true;
    localStorage.setItem('ec_med_hidden',JSON.stringify(hidden));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_hidden',hidden);
    if(typeof S._medHidden!=='undefined')S._medHidden=hidden;
  }
  /* 사용자 추가 약품에서 삭제 */
  const _mdu=JSON.parse(localStorage.getItem('ec_meddb_user')||'{}');
  let changed=false;
  Object.keys(_mdu).forEach(function(c){
    const idx=(_mdu[c]||[]).indexOf(name);
    if(idx!==-1){_mdu[c].splice(idx,1);changed=true;}
  });
  if(changed){
    localStorage.setItem('ec_meddb_user',JSON.stringify(_mdu));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','meddb_user',_mdu);
  }
  /* 사용자 매칭에서도 제거 */
  if(_userMedSyms[name]){delete _userMedSyms[name];_saveMedSyms();}
  _setMedDelSearchRender();
  bus.emit('toast:save');
}

/* ── 약품명 정렬: 한글 가나다 → 영어 ABC (사용자 요청 2026-05-27).
 * 기본 .sort() 는 ASCII 라 영어가 먼저. 한글(가-힣)을 항상 영문보다 앞으로. */
function _setMedSortKorFirst(arr, renames){
  function _disp(m){ return (renames && renames[m]) || m; }
  function _isKor(ch){ return ch >= '가' && ch <= '힣'; }
  return arr.slice().sort(function(a,b){
    const da=_disp(a), db=_disp(b);
    const aKor=da.length>0 && _isKor(da.charAt(0));
    const bKor=db.length>0 && _isKor(db.charAt(0));
    if(aKor && !bKor) return -1;
    if(!aKor && bKor) return 1;
    return da.localeCompare(db, 'ko');
  });
}

/* ── 약품 풀(시스템 + 사용자) 수집 헬퍼 — 두 컬럼이 공유 ── */
function _setMedCollectPool(){
  const allMeds={};
  const _md=getSymData().medDb||{};
  Object.keys(_md).forEach(function(c){(_md[c]||[]).forEach(function(m){allMeds[m]=1;});});
  const _mdu=JSON.parse(localStorage.getItem('ec_meddb_user')||'{}');
  Object.keys(_mdu).forEach(function(c){(_mdu[c]||[]).forEach(function(m){allMeds[m]=1;});});
  /* 사용자 추가 약품(_userMedSyms 키) 도 포함 — 카드로만 들어온 신규 약품도 검색 가능 */
  Object.keys(_userMedSyms||{}).forEach(function(m){allMeds[m]=1;});
  return Object.keys(allMeds);
}

/* ── 약품 검색 매칭 헬퍼 — 시작 일치 → 초성 → 부분 일치 순으로 정렬. 별명도 매칭. ── */
function _setMedFilterByQuery(pool, q, renames){
  if(!q) return _setMedSortKorFirst(pool, renames);
  const qLower=q.toLowerCase();
  const _hasK=/[가-힣ㄱ-ㅎ]/.test(q);
  const start=[], chosung=[], contain=[];
  pool.forEach(function(m){
    const ml=m.toLowerCase();
    const disp=renames[m]||m;
    const dispLower=disp.toLowerCase();
    if(ml.startsWith(qLower)||dispLower.startsWith(qLower))start.push(m);
    else if(_hasK&&typeof matchKoreanFromStart==='function'&&(matchKoreanFromStart(m,q)||matchKoreanFromStart(disp,q)))chosung.push(m);
    else if(_hasK&&typeof matchKorean==='function'&&(matchKorean(m,q)||matchKorean(disp,q)))chosung.push(m);
    else if(ml.includes(qLower)||dispLower.includes(qLower))contain.push(m);
  });
  return start.concat(chosung).concat(contain);
}

/* ── 좌측: 약품 숨기거나 보이게 하기 (👁 토글 전용) ──
 * 사용자 요청(2026-05-27): 투약 선택 팝업과 동일 UX — 검색창 + 그 아래 약품 리스트 쭈욱 표시,
 * 글자 입력으로 후보를 줄여나가는 식. 검색어 없으면 전체 표시(이름순). */
function _setMedHideRender(){
  const inp=document.getElementById('setMedHideSearch');
  const list=document.getElementById('setMedHideList');
  if(!inp||!list)return;
  const q=inp.value.trim();
  const hidden=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}');
  const renames=JSON.parse(localStorage.getItem('ec_med_renames')||'{}');
  const pool=_setMedFilterByQuery(_setMedCollectPool(), q, renames);
  if(!pool.length){
    list.innerHTML='<div style="text-align:center;padding:12px;color:var(--t3);font-size:10px">검색 결과가 없습니다.</div>';
    return;
  }
  let h='';
  pool.slice(0,200).forEach(function(m){
    const isHidden=!!hidden[m];
    const display=renames[m]||m;
    h+='<div class="set-med-hide-row" data-med-orig="'+escHtml(m)+'" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;font-size:11px;transition:background .1s">'
      +'<span style="flex:1;color:'+(isHidden?'var(--t3)':'var(--t1)')+';font-weight:600;'+(isHidden?'text-decoration:line-through;opacity:0.5':'')+'">'+escHtml(display)+'</span>'
      +'<span data-action="med-toggle" data-med="'+escHtml(m)+'" style="cursor:pointer;font-size:13px;color:'+(isHidden?'var(--t3)':'var(--cyan)')+'" title="'+(isHidden?'다시 표시':'숨기기')+'">'+dailyColEyeIcon(!isHidden)+'</span>'
      +'</div>';
  });
  if(pool.length>200)h+='<div style="text-align:center;padding:8px;color:var(--t3);font-size:10px">결과가 많습니다. 더 구체적으로 검색하세요.</div>';
  list.innerHTML=h;
  list.querySelectorAll('.set-med-hide-row').forEach(function(row){
    row.addEventListener('mouseenter',function(){this.style.background='var(--bg2)';});
    row.addEventListener('mouseleave',function(){this.style.background='transparent';});
  });
  if(!list._medClickBound){
    list._medClickBound=true;
    list.addEventListener('click',function(e){
      const tog=e.target.closest('[data-action="med-toggle"]');
      if(tog){ e.stopPropagation(); _setMedToggle(tog.dataset.med); return; }
    });
  }
}

/* ── 우측: 상용 약품 추가 및 수정 (✏️ 인라인 이름 수정 전용) ──
 * 사용자 요청(2026-05-27): 검색 결과가 비어 있으면 우측 "+ 약품 추가" 버튼으로 이 이름을 그대로 등록.
 * 기존 약품은 ✏️ 로 이름만 수정 (원본 데이터는 보존, ec_med_renames 매핑만 갱신). */
function _setMedAddEditRender(){
  const inp=document.getElementById('setMedAddEditSearch');
  const list=document.getElementById('setMedAddEditList');
  if(!inp||!list)return;
  const q=inp.value.trim();
  const renames=JSON.parse(localStorage.getItem('ec_med_renames')||'{}');
  /* 사용자 요청 2026-05-27: 양쪽 컬럼 동기화 — 좌측에서 숨긴 약품은 우측에서도 제외. */
  const hidden=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}');
  const pool=_setMedFilterByQuery(_setMedCollectPool(), q, renames).filter(function(m){ return !hidden[m]; });
  if(!pool.length){
    if(q){
      list.innerHTML='<div style="text-align:center;padding:12px;color:var(--t3);font-size:10.5px;line-height:1.8">"<b style="color:var(--t2)">'+escHtml(q)+'</b>" 와 일치하는 약품이 없습니다.<br>위쪽 검색창 우측의 <b style="color:var(--cyan)">+ 추가</b> 버튼으로 이 이름을 그대로 등록하세요.</div>';
    } else {
      list.innerHTML='<div style="text-align:center;padding:12px;color:var(--t3);font-size:10px">등록된 약품이 없습니다.</div>';
    }
    return;
  }
  let h='';
  pool.slice(0,200).forEach(function(m){
    const display=renames[m]||m;
    const renamed=renames[m]&&renames[m]!==m;
    h+='<div class="set-med-edit-row" data-med-orig="'+escHtml(m)+'" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;font-size:11px;transition:background .1s">'
      +'<span class="set-med-name" style="flex:1;color:var(--t1);font-weight:600">'+escHtml(display)+(renamed?' <span style="font-size:9px;font-weight:500;color:var(--t3)">(원본: '+escHtml(m)+')</span>':'')+'</span>'
      +'<span data-action="med-rename" data-med="'+escHtml(m)+'" style="cursor:pointer;font-size:13px;color:#d97706" title="이름 수정">✏️</span>'
      +'</div>';
  });
  if(pool.length>200)h+='<div style="text-align:center;padding:8px;color:var(--t3);font-size:10px">결과가 많습니다. 더 구체적으로 검색하세요.</div>';
  list.innerHTML=h;
  list.querySelectorAll('.set-med-edit-row').forEach(function(row){
    row.addEventListener('mouseenter',function(){this.style.background='var(--bg2)';});
    row.addEventListener('mouseleave',function(){this.style.background='transparent';});
  });
  if(!list._medClickBound){
    list._medClickBound=true;
    list.addEventListener('click',function(e){
      const rn=e.target.closest('[data-action="med-rename"]');
      if(rn){ e.stopPropagation(); _setMedEditPopupOpen(rn.dataset.med, rn.closest('.set-med-edit-row')); return; }
    });
  }
}

/* ── 하위 호환 wrapper — _setMedToggle / 미니 팝업 저장 후 두 컬럼 모두 재렌더. */
function _setMedSearchRender(){
  _setMedHideRender();
  _setMedAddEditRender();
}

/* ── 시스템 매칭 source: xlsx 양식 + 코드 fallback (사용자 요청 2026-05-27) ──
 *  templates/forms/symptom_medicine_matching.xlsx (약품명 | 규격 | 효능_1..4 | 제조사) 가 정답 source.
 *  앱 시작 시 IPC 로 한 번 로드 → localStorage 캐시.
 *  ✏️ 미니 팝업 첫 열림 시 xlsx 매핑(우선) 또는 코드 매핑(fallback) 을 _userMedSyms 에 일회성 복사. */
let _xlsxMedSymMap = null;
let _xlsxMedSymPromise = null;
function _setLoadXlsxMedSymMap(){
  if(_xlsxMedSymMap) return Promise.resolve(_xlsxMedSymMap);
  if(_xlsxMedSymPromise) return _xlsxMedSymPromise;
  /* localStorage 캐시 우선 사용 — 매번 IPC 호출 비용 회피 */
  try{
    const cached=localStorage.getItem('ec_xlsx_med_syms');
    if(cached){
      _xlsxMedSymMap=JSON.parse(cached)||{};
      return Promise.resolve(_xlsxMedSymMap);
    }
  }catch(_){}
  if(!(window.electronAPI && window.electronAPI.templatesLoadMedSymMatching)){
    _xlsxMedSymMap={};
    return Promise.resolve(_xlsxMedSymMap);
  }
  _xlsxMedSymPromise = window.electronAPI.templatesLoadMedSymMatching().then(function(r){
    _xlsxMedSymMap = (r && r.success && r.data) ? r.data : {};
    try{ localStorage.setItem('ec_xlsx_med_syms', JSON.stringify(_xlsxMedSymMap)); }catch(_){}
    return _xlsxMedSymMap;
  }).catch(function(){
    _xlsxMedSymMap = {};
    return _xlsxMedSymMap;
  });
  return _xlsxMedSymPromise;
}

/* 약품의 시스템 매칭 증상 — xlsx 우선, 없으면 코드 매핑 fallback */
function _setMedGetSysSyms(name){
  if(_xlsxMedSymMap && _xlsxMedSymMap[name]) return _xlsxMedSymMap[name].slice();
  return (typeof getMedSystemSyms==='function') ? (getMedSystemSyms(name)||[]) : [];
}

/* ── 시스템 매칭 prefill ──
 *  ec_user_med_syms_prefilled 키로 약품별 prefill 완료 플래그 저장 (한 번만 실행).
 *  사용자가 ✕ 한 매칭이 다음 ✏️ 열림 시 다시 복원되지 않도록 보장. */
function _setMedEnsurePrefilled(name){
  if(!name) return;
  let flag={};
  try{ flag=JSON.parse(localStorage.getItem('ec_user_med_syms_prefilled')||'{}')||{}; }catch(_){}
  if(flag[name]) return; /* 이미 한 번 prefill 됨 — 사용자 편집 결과 보존 */
  const sysSyms = _setMedGetSysSyms(name);
  if(sysSyms.length){
    if(!_userMedSyms[name]) _userMedSyms[name]=[];
    sysSyms.slice(0,4).forEach(function(s){
      if(_userMedSyms[name].indexOf(s)===-1) _userMedSyms[name].push(s);
    });
    _saveMedSyms();
  }
  flag[name]=true;
  try{
    localStorage.setItem('ec_user_med_syms_prefilled',JSON.stringify(flag));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_med_syms_prefilled',flag);
  }catch(_){}
}

/* ── ✏️ 미니 팝업: 이름 수정 + 증상 1~4 매칭 (사용자 요청 2026-05-27) ──
 *  · row 아래쪽에 fixed 로 띄움. 약품명 input + 증상 4 슬롯.
 *  · 진입 시 시스템 매칭(_medFrequent/_medSymMap) 을 _userMedSyms 에 일회성 prefill.
 *  · 슬롯 클릭 → 기존 _setMedOpenSymPicker 재활용 (카테고리 → 증상 흐름).
 *  · 슬롯의 ✕ → _setMedRemoveSym 으로 매칭 해제 (둘 다 _userMedSyms 갱신).
 *  · 저장: 이름 새 값 → ec_med_renames 갱신, 매칭은 picker / ✕ 가 이미 즉시 저장.
 *  · 외부 클릭/ESC → 저장 후 닫기 (이름 입력만 저장 필요, 매칭은 실시간 저장됨). */
function _setMedEditPopupOpen(origName, rowEl){
  /* 기존 팝업 닫기 (외부 클릭 핸들러도 제거) */
  _setMedEditPopupClose(false);
  /* 시스템 매칭 prefill — 첫 열림 시 한 번만 _userMedSyms 에 복사 */
  _setMedEnsurePrefilled(origName);
  const popup=document.createElement('div');
  popup.id='setMedEditPopup';
  popup.dataset.med=origName;
  const W=360;
  const r=rowEl ? rowEl.getBoundingClientRect() : null;
  /* row 가 없으면 화면 중앙 fallback */
  let top, left;
  if(r){
    top = r.bottom + 4;
    left = r.left;
    if(top + 240 > window.innerHeight) top = Math.max(8, r.top - 244);
    if(left + W > window.innerWidth) left = Math.max(8, window.innerWidth - W - 8);
  } else {
    top = Math.max(80, (window.innerHeight - 240)/2);
    left = Math.max(8, (window.innerWidth - W)/2);
  }
  popup.style.cssText='position:fixed;z-index:11400;top:'+top+'px;left:'+left+'px;width:'+W+'px;background:var(--card);border:1.5px solid var(--cyan);border-radius:10px;box-shadow:0 14px 36px rgba(0,0,0,0.32);padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-family:var(--f)';
  const renames=JSON.parse(localStorage.getItem('ec_med_renames')||'{}');
  const currentName=renames[origName]||origName;
  popup.innerHTML=
    '<div style="display:flex;align-items:center;gap:6px">'
      +'<span style="font-size:12px;font-weight:800;color:var(--t1);flex:1">✏️ 약품 수정 + 증상 매칭</span>'
      +'<span data-action="med-edit-close" style="cursor:pointer;font-size:14px;color:var(--t3);padding:0 4px" title="닫기">✕</span>'
    +'</div>'
    +'<div>'
      +'<label style="font-size:10px;color:var(--t3);font-weight:600;display:block;margin-bottom:3px">약품명 <span style="color:var(--t3);font-weight:500">(원본: '+escHtml(origName)+')</span></label>'
      +'<input class="form-input" id="setMedEditNameInput" value="'+escHtml(currentName)+'" style="width:100%;font-size:11.5px;padding:6px 9px;background:var(--bg2);border:1.5px solid var(--cyan);border-radius:6px" data-no-auto-save>'
    +'</div>'
    +'<div>'
      +'<label style="font-size:10px;color:var(--t3);font-weight:600;display:block;margin-bottom:4px">증상 매칭 (최대 4개) <span style="color:var(--t3);font-weight:500">— 빈 슬롯을 클릭해 추가</span></label>'
      +'<div id="setMedEditSlots" style="display:grid;grid-template-columns:1fr 1fr;gap:5px"></div>'
    +'</div>'
    +'<div style="font-size:9.5px;color:var(--t3);text-align:right;margin-top:2px">외부 클릭 또는 Enter 로 저장 · ESC 로 취소</div>';
  document.body.appendChild(popup);
  /* 슬롯 첫 렌더 */
  _setMedEditPopupRenderSlots();
  /* 이름 input focus + select all */
  setTimeout(function(){
    const ni=popup.querySelector('#setMedEditNameInput');
    if(ni){ try{ ni.focus(); ni.select(); }catch(_){} }
  },10);
  /* 이름 input Enter/Escape — 저장/취소 */
  const ni=popup.querySelector('#setMedEditNameInput');
  if(ni){
    ni.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ e.preventDefault(); _setMedEditPopupClose(true); }
      else if(e.key==='Escape'){ e.preventDefault(); _setMedEditPopupClose(false); }
    });
  }
  /* 팝업 클릭 위임 — 헤더 ✕ 닫기 / 슬롯 add·remove (취소/저장 버튼은 사용자 요청 2026-05-27 제거).
   * 헤더 ✕ 는 외부 클릭과 동일하게 저장 후 닫기. 취소는 ESC 만. */
  popup.addEventListener('click',function(e){
    const cn=e.target.closest('[data-action="med-edit-close"]');
    if(cn){ e.stopPropagation(); _setMedEditPopupClose(true); return; }
    const rm=e.target.closest('[data-action="med-edit-rm-sym"]');
    if(rm){
      e.stopPropagation();
      _setMedRemoveSym(popup.dataset.med, rm.dataset.sym);
      /* _setMedRemoveSym → _setMedRenderCards 호출. 미니 팝업 슬롯도 갱신 */
      _setMedEditPopupRenderSlots();
      return;
    }
    const ad=e.target.closest('[data-action="med-edit-add-sym"]');
    if(ad){
      e.stopPropagation();
      _setMedOpenSymPicker(popup.dataset.med, ad);
      return;
    }
  });
  /* 외부 클릭 닫기 — 단 picker 안 클릭은 제외 */
  setTimeout(function(){
    function _outside(e){
      if(popup.contains(e.target)) return;
      const pk=document.getElementById('setMedSymPicker');
      if(pk && pk.contains(e.target)) return;
      _setMedEditPopupClose(true);
      document.removeEventListener('mousedown',_outside,true);
    }
    popup._outsideHandler=_outside;
    document.addEventListener('mousedown',_outside,true);
  },10);
}

/* 슬롯 4개 렌더 — _userMedSyms 의 첫 4개 만 표시. picker / ✕ 가 _userMedSyms 갱신 후 호출. */
function _setMedEditPopupRenderSlots(){
  const popup=document.getElementById('setMedEditPopup'); if(!popup)return;
  const origName=popup.dataset.med;
  const slotsEl=popup.querySelector('#setMedEditSlots'); if(!slotsEl)return;
  const syms=(_userMedSyms[origName]||[]).slice(0,4);
  let h='';
  for(let i=0;i<4;i++){
    const sym=syms[i];
    if(sym){
      h+='<div style="display:flex;align-items:center;gap:4px;padding:6px 8px;border:1px solid rgba(6,182,212,0.30);border-radius:6px;background:rgba(6,182,212,0.07);font-size:10.5px;color:var(--cyan);font-weight:700">'
        +'<span style="font-size:9px;color:var(--t3);font-weight:700">'+(i+1)+'.</span>'
        +'<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(sym)+'</span>'
        +'<span data-action="med-edit-rm-sym" data-sym="'+escHtml(sym)+'" style="cursor:pointer;color:var(--rs);font-size:12px;line-height:1" title="이 증상 매칭 해제">✕</span>'
      +'</div>';
    } else {
      h+='<div data-action="med-edit-add-sym" style="display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 8px;border:1.5px dashed var(--bdr);border-radius:6px;font-size:10.5px;color:var(--t3);cursor:pointer;transition:all .12s" onmouseover="this.style.borderColor=\'var(--cyan)\';this.style.color=\'var(--cyan)\'" onmouseout="this.style.borderColor=\'var(--bdr)\';this.style.color=\'var(--t3)\'">'
        +'<span style="font-size:9px;font-weight:700">'+(i+1)+'.</span> + 증상'
      +'</div>';
    }
  }
  slotsEl.innerHTML=h;
}

/* 미니 팝업 닫기 (+ 이름 변경 저장) */
function _setMedEditPopupClose(save){
  const popup=document.getElementById('setMedEditPopup'); if(!popup)return;
  if(popup._outsideHandler){
    try{ document.removeEventListener('mousedown',popup._outsideHandler,true); }catch(_){}
  }
  if(save){
    const origName=popup.dataset.med;
    const ni=popup.querySelector('#setMedEditNameInput');
    const newName=ni ? ni.value.trim() : '';
    const rmap=JSON.parse(localStorage.getItem('ec_med_renames')||'{}');
    const prev=rmap[origName]||'';
    if(!newName || newName===origName){
      if(rmap[origName]){ delete rmap[origName]; }
    } else {
      rmap[origName]=newName;
    }
    /* 실제 변경이 있을 때만 저장 토스트 */
    const changed = (prev||origName) !== (rmap[origName]||origName);
    if(changed){
      localStorage.setItem('ec_med_renames',JSON.stringify(rmap));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_renames',rmap);
      bus.emit('toast:save');
    }
  }
  popup.remove();
  _setMedSearchRender();
  _setMedRenderCards();
}
/* 인라인 이름 수정 — 약품 정보는 그대로, 표시 이름만 ec_med_renames 에 저장 */
function _setResetUserSymptoms(){
  /* 증상(중분류)만 초기화 — 추가·숨김·순서·이름변경(별칭). (사용자 요청 2026-06-13) */
  appConfirmModal('사용자가 추가/숨기기/순서변경/이름변경한 <b>증상(중분류)</b>을 모두 초기 상태로 되돌립니다.<br><span style="color:var(--t3);font-size:11px">분류(상분류) 설정은 그대로 유지됩니다. 이미 기록된 일지 내용은 지워지지 않습니다.</span><br><br>계속하시겠습니까?','증상(중분류) 초기화',{okLabel:'초기화',cancelLabel:'취소'}).then(function(ok){
    if(!ok)return;
    ['ec_user_symptoms','ec_hidden_symptoms','ec_sym_order','ec_sym_renames'].forEach(function(k){localStorage.removeItem(k);});
    if(window.electronAPI&&window.electronAPI.dbSet){
      window.electronAPI.dbSet('common','user_symptoms',{});
      window.electronAPI.dbSet('common','hidden_symptoms',{});
      window.electronAPI.dbSet('common','sym_order',{});
      window.electronAPI.dbSet('common','sym_renames',{});
    }
    try{ bus.emit('symcats:changed'); }catch(_){}
    bus.emit('toast:save');
    renderSettingsPanel('diary');
  });
}
/* ═══ 설정: 증상 관리 GUI ═══ */
let _setSymActiveCat='';
/* 증상 추가 인라인 입력 모드 — null 이면 "+ 증상 추가" 버튼 표시, catId 이면 입력란 표시.
 * 사용자 요청(2026-05-11): 팝업 대신 카테고리 하단에 입력란을 띄워 연속 등록 가능하게 함. */
let _symInlineAddCat=null;

export function _setSymInit(){
  const cats=getSymData().symCategories||[];
  if(!cats.length){setTimeout(_setSymInit,300);return;}
  _setSymRenderCats();
  const eff=getEffectiveSymCats(true);
  if(eff.length)_setSymSelectCat(eff[0].id);
}

/* 대분류(상분류)는 방문 통계 진료과 분류의 기준이라 고정 — 사용자 편집(추가·이름변경·가리기·순서·삭제) 전면 차단.
 * (사용자 요청 2026-06-13~14: 기상천외한 분류 재정의로 통계가 깨지는 것을 원천 차단. 옛 편집 함수·헬퍼 일괄 제거) */

function _setSymRenderCats(){
  const el=document.getElementById('setSymCatList');if(!el)return;
  const cats=getEffectiveSymCats(true);   /* 가린 분류 포함 — 설정에서는 관리 대상 */
  /* 대분류(상분류)는 방문 통계 진료과 분류의 기준이라 고정 — 추가·수정·가리기·순서변경 불가, 선택만 가능.
   * (사용자 요청 2026-06-13: 기상천외한 분류 재정의로 통계가 깨지는 것을 원천 차단) */
  let h='';
  cats.forEach(function(c){
    const isAct=c.id===_setSymActiveCat;
    const isCounsel=(c.id==='counsel');
    h+='<div class="set-sym-cat-item" data-cat="'+escHtml(c.id)+'" data-action="sym-select-cat" style="padding:6px 8px;cursor:pointer;font-size:11px;font-weight:'+(isAct?'700':'600')+';color:'+(isAct?'var(--cyan)':'var(--t2)')+';border-left:3px solid '+(isAct?'var(--cyan)':'transparent')+';background:'+(isAct?'rgba(6,182,212,0.08)':'transparent')+';transition:all .12s;display:flex;align-items:center;gap:4px;position:relative">';
    h+='<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(c.icon||'')+' '+escHtml(c.name)+'</span>';
    if(isCounsel){
      h+='<span data-tooltip="상담 내역 축적 및 통계 에러를 차단하기 위해 잠금하였습니다." style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid var(--bdr);color:var(--t3);font-size:8px;font-style:italic;font-weight:700;cursor:help;flex-shrink:0">i</span>';
    }
    h+='</div>';
  });
  el.innerHTML=h;
  /* 위임 바인딩 — 대분류 선택만 (편집·추가·드래그 제거). el 재사용되므로 1회만. */
  if(!el.__catActionBound){
    el.__catActionBound=true;
    el.addEventListener('click',function(e){
      const t=e.target.closest('[data-action="sym-select-cat"]');if(!t)return;
      e.stopPropagation();_setSymSelectCat(t.dataset.cat);
    });
  }
  el.querySelectorAll('.set-sym-cat-item').forEach(function(item){
    item.addEventListener('mouseenter',function(){ if(this.dataset.cat!==_setSymActiveCat)this.style.background='var(--hover)'; });
    item.addEventListener('mouseleave',function(){ if(this.dataset.cat!==_setSymActiveCat)this.style.background='transparent'; });
  });
}

function _setSymSelectCat(catId){
  _setSymActiveCat=catId;
  /* 카테고리 전환 시 인라인 입력 모드 리셋 — 다른 카테고리에서 열려있던 상태가 잔류하지 않게 */
  _symInlineAddCat=null;
  _setSymRenderCats();
  _setSymRenderSyms(catId);
}

function _setSymRenderSyms(catId){
  const cat=getEffectiveSymCatById(catId);   /* 사용자 추가 분류도 조회 (2026-06-12) */
  if(!cat)return;
  const panel=document.getElementById('setSymSymList');if(!panel)return;
  const _userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  const _hiddenSyms=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  const _catHidden=_hiddenSyms[cat.id]||[];
  const _catUserSyms=_userSyms[cat.id]||[];
  /* 보이는 증상 (기본+사용자, 숨긴 것 제외) */
  const _visibleSyms=cat.symptoms.filter(function(s){return _catHidden.indexOf(s)===-1;}).concat(_catUserSyms);
  /* 전체 목록 = 보이는 + 숨긴 기본 증상 */
  const _allDefault=cat.symptoms.slice();
  /* 저장된 순서 반영 */
  const _orderMap=JSON.parse(localStorage.getItem('ec_sym_order')||'{}');
  const _savedOrder=_orderMap[cat.id];
  let allSyms;
  const _pool=_visibleSyms.concat(_catHidden);
  if(_savedOrder&&Array.isArray(_savedOrder)){
    allSyms=[];
    _savedOrder.forEach(function(s){if(_pool.indexOf(s)!==-1)allSyms.push(s);});
    _pool.forEach(function(s){if(allSyms.indexOf(s)===-1)allSyms.push(s);});
  } else {
    /* 기본 순서: 기본 증상 전체(숨긴 것 포함) + 사용자 증상 */
    allSyms=_allDefault.concat(_catUserSyms);
  }
  let h='';
  allSyms.forEach(function(sym){
    const isUser=_catUserSyms.indexOf(sym)!==-1;
    const isHidden=_catHidden.indexOf(sym)!==-1;
    const isDefault=_allDefault.indexOf(sym)!==-1;
    /* '요보호 대상자' 잠금 — 수정·숨김·드래그 차단 + ⓘ 안내 (사용자 요청 2026-06-12) */
    const isLocked=(catId==='counsel'&&sym==='요보호 대상자');
    h+='<div class="set-sym-chip" data-sym="'+escHtml(sym)+'" data-cat="'+escHtml(catId)+'" style="padding:5px 8px;margin-bottom:2px;border-radius:6px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;border:1px solid '+(isHidden?'var(--bdr)':'var(--bdr)')+';background:transparent;color:'+(isHidden?'var(--t3)':'var(--t1)')+';'+(isHidden?'opacity:0.5;text-decoration:line-through;':'')+';transition:all .12s;position:relative">';
    if(isLocked){
      h+='<span style="display:inline-flex;align-items:center;font-size:10px;color:var(--t3);flex-shrink:0;padding:0 2px">🔒</span>';
      h+='<span style="flex:1">'+escHtml(sym)+'</span>';
      h+='<span data-tooltip="요보호 대상자 상담 내역 축적 및 통계 에러를 차단하기 위해 잠금하였습니다." style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--bdr);color:var(--t3);font-size:9px;font-style:italic;font-weight:700;cursor:help;flex-shrink:0">i</span>';
      h+='</div>';
      return;
    }
    h+='<span class="set-sym-grip" data-action="sym-drag" style="display:inline-flex;align-items:center;cursor:grab;font-size:11px;color:var(--t3);flex-shrink:0;opacity:0.5;padding:0 2px" title="드래그하여 이동">⠿</span>';
    h+='<span style="flex:1">'+escHtml(sym)+'</span>';
    if(isUser)h+='<span style="font-size:8px;color:var(--cyan);border:1px solid rgba(6,182,212,0.3);border-radius:3px;padding:0 3px;flex-shrink:0">사용자</span>';
    h+='<span class="set-sym-edit" data-action="sym-edit" data-edit-cat="'+escHtml(catId)+'" data-edit-sym="'+escHtml(sym)+'" style="display:none;width:16px;height:16px;border-radius:50%;background:rgba(59,130,246,0.12);color:#3b82f6;font-size:9px;cursor:pointer;border:1px solid rgba(59,130,246,0.2);flex-shrink:0;align-items:center;justify-content:center;line-height:1" title="수정">✏️</span>';
    if(isUser){
      /* 사용자 증상: ✕ 삭제 */
      h+='<span class="set-sym-del" data-action="sym-delete" data-del-cat="'+escHtml(catId)+'" data-del-sym="'+escHtml(sym)+'" style="display:none;width:16px;height:16px;border-radius:50%;background:rgba(239,68,68,0.1);color:#ef4444;font-size:9px;cursor:pointer;border:1px solid rgba(239,68,68,0.2);flex-shrink:0;align-items:center;justify-content:center;line-height:1" title="삭제">✕</span>';
    }
    if(isDefault){
      /* 기본 증상: 눈알 토글 (숨기기/보이기) */
      h+='<span class="set-sym-eye" data-action="sym-toggle-hide" data-hide-cat="'+escHtml(catId)+'" data-hide-sym="'+escHtml(sym)+'" style="cursor:pointer;color:'+(isHidden?'var(--t3)':'var(--cyan)')+';flex-shrink:0;display:flex;align-items:center" title="'+(isHidden?'다시 표시':'숨기기')+'">'+dailyColEyeIcon(!isHidden)+'</span>';
    }
    h+='</div>';
  });
  /* 숨긴 증상 일괄 복원 버튼 — 숨긴 기본 증상이 있을 때만 표시 */
  if(_catHidden.length){
    h+='<div data-action="sym-restore-all" data-restore-cat="'+escHtml(catId)+'" class="set-sym-restore-all" style="padding:6px 10px;margin-top:6px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:4px;border:1px solid rgba(6,182,212,0.35);background:rgba(6,182,212,0.06);color:var(--cyan);transition:all .12s" title="이 카테고리의 모든 숨긴 기본 증상을 한 번에 다시 표시합니다">↻ 숨긴 증상 모두 복원 ('+_catHidden.length+'개)</div>';
  }
  /* 증상 추가 — 인라인 입력 모드(_symInlineAddCat===catId) 면 입력란 + 확인/취소, 아니면 추가 버튼 */
  if(_symInlineAddCat===catId){
    h+='<div style="margin-top:6px;display:flex;gap:4px;align-items:center">';
    h+='<input type="text" id="setSymInlineAddInput" data-no-auto-save placeholder="새 증상명 입력" style="flex:1;font-size:11px;padding:6px 8px;border:1.5px solid var(--cyan);border-radius:6px;outline:none;background:var(--bg2);color:var(--t1)">';
    h+='<span data-action="sym-add-confirm" style="cursor:pointer;color:var(--cyan);background:rgba(6,182,212,0.08);font-size:11px;font-weight:700;padding:5px 12px;border-radius:4px;border:1px solid var(--cyan)" title="저장">확인</span>';
    h+='<span data-action="sym-add-cancel" style="cursor:pointer;color:var(--t3);font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid var(--bdr)" title="닫기">취소</span>';
    h+='</div>';
  } else {
    h+='<div data-action="sym-add" data-add-cat="'+escHtml(catId)+'" class="set-sym-add-btn" style="padding:6px 10px;margin-top:6px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:4px;border:1.5px dashed var(--bdr);background:transparent;color:var(--t3);transition:all .12s">+ 증상 추가</div>';
  }
  panel.innerHTML=h;
  /* bind events for sym list */
  panel.querySelectorAll('.set-sym-chip').forEach(function(chip){
    chip.addEventListener('mouseenter',function(){_setSymShowBtns(this);});
    chip.addEventListener('mouseleave',function(){_setSymHideBtns(this);});
  });
  panel.querySelectorAll('.set-sym-grip').forEach(function(grip){
    grip.addEventListener('mousedown',function(e){e.stopPropagation();_setSymStartDrag(this.parentElement,e);});
    grip.addEventListener('mouseenter',function(){this.style.opacity='1';this.style.color='var(--cyan)';});
    grip.addEventListener('mouseleave',function(){this.style.opacity='0.5';this.style.color='var(--t3)';});
  });
  /* 중복 바인딩 방지 — _setSymRenderSyms 는 카테고리 전환마다 호출되지만
     panel 자체는 그대로 남아있어 매번 click 리스너를 추가하면 핸들러가 N번 실행된다.
     N번 실행되면 _symPrompt 가 N개 겹쳐 생기고 마지막 호출이 이전 팝업을
     closeModalGracefully 하면서 화면상 "깜빡이다 사라지는" 현상이 발생 → 플래그로 가드 */
  if(!panel.__symActionBound){
    panel.__symActionBound=true;
    panel.addEventListener('click',function(e){
      const t=e.target.closest('[data-action]');if(!t)return;
      const act=t.dataset.action;
      /* 상위(document) 아코디언 자동 닫기 리스너가 바깥 클릭으로 판정하지 않도록 보호 */
      if(act==='sym-edit'){e.stopPropagation();_setSymEdit(t.dataset.editCat,t.dataset.editSym);}
      else if(act==='sym-delete'){e.stopPropagation();_setSymDelete(t.dataset.delCat,t.dataset.delSym,true);}
      else if(act==='sym-toggle-hide'){e.stopPropagation();_setSymToggleHide(t.dataset.hideCat,t.dataset.hideSym);}
      else if(act==='sym-restore-all'){e.stopPropagation();_setSymRestoreAll(t.dataset.restoreCat);}
      else if(act==='sym-add'){e.stopPropagation();_setSymAdd(t.dataset.addCat);}
      else if(act==='sym-add-cancel'){e.stopPropagation();_symInlineAddCat=null;_setSymRenderSyms(_setSymActiveCat);}
      else if(act==='sym-add-confirm'){
        e.stopPropagation();
        const inp=document.getElementById('setSymInlineAddInput');
        if(inp){
          const v=inp.value.trim();
          if(v)_setSymAddCommit(_symInlineAddCat||_setSymActiveCat,v);
        }
      }
    });
  }
  const _restoreBtn=panel.querySelector('.set-sym-restore-all');
  if(_restoreBtn){
    _restoreBtn.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.12)';});
    _restoreBtn.addEventListener('mouseleave',function(){this.style.background='rgba(6,182,212,0.06)';});
  }
  const _addBtn=panel.querySelector('.set-sym-add-btn');
  if(_addBtn){
    _addBtn.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';this.style.color='var(--cyan)';});
    _addBtn.addEventListener('mouseleave',function(){this.style.borderColor='var(--bdr)';this.style.color='var(--t3)';});
  }
  /* 인라인 입력 모드 — Enter 즉시 저장 + 연속 입력, Esc 닫기 */
  const _addInp=panel.querySelector('#setSymInlineAddInput');
  if(_addInp){
    _addInp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){
        e.preventDefault();
        const v=this.value.trim();
        if(!v)return;
        _setSymAddCommit(catId,v);
        /* _setSymAddCommit 내부에서 _setSymRenderSyms 재호출 → 새 input 에 자동 focus */
      } else if(e.key==='Escape'){
        e.preventDefault();
        _symInlineAddCat=null;
        _setSymRenderSyms(catId);
      }
    });
    /* 자동 focus — DOM 갱신 직후 한 박자 뒤에 focus 줘서 안정성 ↑ */
    setTimeout(function(){ try{ _addInp.focus(); }catch(_){} }, 0);
  }
}
/* 현재 카테고리의 숨긴 기본 증상 전체 복원 */
function _setSymRestoreAll(catId){
  const hidden=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  const count=(hidden[catId]||[]).length;
  if(!count)return;
  if(!confirm('이 카테고리의 숨긴 기본 증상 '+count+'개를 모두 다시 표시합니다. 계속하시겠습니까?'))return;
  delete hidden[catId];
  localStorage.setItem('ec_hidden_symptoms',JSON.stringify(hidden));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','hidden_symptoms',hidden);
  _setSymRenderSyms(catId);
  bus.emit('toast:save');
}

function _setSymShowBtns(el){
  el.querySelectorAll('.set-sym-edit,.set-sym-del').forEach(function(b){b.style.display='inline-flex';});
  el.style.background='var(--hover)';
}
function _setSymHideBtns(el){
  el.querySelectorAll('.set-sym-edit,.set-sym-del').forEach(function(b){b.style.display='none';});
  el.style.background='transparent';
}

/* 증상 추가 — "+ 증상 추가" 버튼 클릭. 팝업 대신 카테고리 하단에 인라인 입력란 표시.
 * Enter 즉시 저장 + 연속 등록, Esc 닫기. 아코디언 안 닫힘. */
function _setSymAdd(catId){
  _symInlineAddCat=catId;
  _setSymRenderSyms(catId);
}

/* 인라인 입력란 Enter 시 호출 — 사용자 증상 영구 저장 + 연속 입력 유지.
 * localStorage 1차 + DB blob 2차 (재설치 시에도 hydration 매핑으로 자동 복원). */
function _setSymAddCommit(catId, name){
  if(!name)return;
  /* 괄호 차단 — 증상명의 ( )는 부위·메모(자유 기입) 표기와 충돌하므로 입력 불가 (사용자 결정 2026-06-23) */
  if(/[()（）]/.test(name)){bus.emit('toast:show', {text: '증상명에 괄호( )는 쓸 수 없습니다. / 로 대체해 주세요.'});return;}
  const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  if(!userSyms[catId])userSyms[catId]=[];
  if(userSyms[catId].indexOf(name)!==-1){bus.emit('toast:show', {text: '이미 추가된 증상입니다.'});return;}
  const toast=document.getElementById('globalSaveToast');
  if(toast){
    toast.textContent='저장 중…';
    toast.className='global-save-toast show saving';
  }
  userSyms[catId].push(name);
  localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
  _setSymRenderSyms(catId);
  setTimeout(function(){
    if(toast){
      toast.textContent='모든 내용이 저장되었습니다.';
      toast.className='global-save-toast show';
      setTimeout(function(){toast.className='global-save-toast';},3000);
    }
  },260);
}

/* 증상 수정 (인라인) */
function _setSymEdit(catId,oldName){
  const chips=document.querySelectorAll('#setSymSymList .set-sym-chip');
  let target=null;
  chips.forEach(function(c){if(c.dataset.sym===oldName&&c.dataset.cat===catId)target=c;});
  if(!target)return;
  /* 칩 내용을 input + 실시간 미리보기로 교체 */
  const wrap=document.createElement('div');wrap.style.cssText='width:100%;display:flex;flex-direction:column;gap:3px';
  const inp=document.createElement('input');
  inp.type='text';inp.value=oldName;
  inp.style.cssText='width:100%;font-size:11px;font-weight:600;border:1px solid var(--cyan);border-radius:6px;padding:5px 8px;outline:none;background:var(--bg2);color:var(--t1)';
  const preview=document.createElement('div');
  preview.style.cssText='font-size:9px;color:var(--cyan);padding:0 2px';
  preview.textContent='→ '+oldName;
  wrap.appendChild(inp);wrap.appendChild(preview);
  target.textContent='';target.appendChild(wrap);
  inp.focus();inp.select();
  /* 이벤트 전파 차단 — 아코디언 닫힘/외부 클릭 방지 */
  inp.addEventListener('mousedown',function(e){e.stopPropagation();});
  inp.addEventListener('click',function(e){e.stopPropagation();});
  /* 실시간 미리보기 */
  inp.addEventListener('input',function(){
    const v=inp.value.trim();
    preview.textContent=v&&v!==oldName?('→ '+v):'→ '+oldName;
    preview.style.color=v&&v!==oldName?'var(--cyan)':'var(--t3)';
  });
  let _committed=false;
  function _commit(){
    if(_committed)return;_committed=true;
    const newName=inp.value.trim();
    if(!newName||newName===oldName){_setSymRenderSyms(catId);return;}
    const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
    if(!userSyms[catId])userSyms[catId]=[];
    const idx=userSyms[catId].indexOf(oldName);
    if(idx!==-1){
      userSyms[catId][idx]=newName;
    } else {
      const hidden=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
      if(!hidden[catId])hidden[catId]=[];
      if(hidden[catId].indexOf(oldName)===-1)hidden[catId].push(oldName);
      localStorage.setItem('ec_hidden_symptoms',JSON.stringify(hidden));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','hidden_symptoms',hidden);
      userSyms[catId].push(newName);
    }
    localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
    const orderMap=JSON.parse(localStorage.getItem('ec_sym_order')||'{}');
    if(orderMap[catId]){
      const oi=orderMap[catId].indexOf(oldName);
      if(oi!==-1)orderMap[catId][oi]=newName;
      localStorage.setItem('ec_sym_order',JSON.stringify(orderMap));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','sym_order',orderMap);
    }
    /* ── 별칭 매핑 (옛 기록 통계 승계, 2026-06-12) — {옛이름:새이름}. 기록 원본은 보존하고
     *  통계 집계 시 옛 이름을 새 이름으로 번역해 합산한다. 재수정 체인(A→B→C)은 A→C 로 평탄화. */
    try{
      const al=JSON.parse(localStorage.getItem('ec_sym_renames')||'{}');
      Object.keys(al).forEach(function(k){ if(al[k]===oldName)al[k]=newName; });   /* 체인 평탄화 */
      al[oldName]=newName;
      Object.keys(al).forEach(function(k){ if(al[k]===k)delete al[k]; });          /* 원래 이름으로 회귀 시 제거 */
      localStorage.setItem('ec_sym_renames',JSON.stringify(al));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','sym_renames',al);
    }catch(_){}
    _setSymRenderSyms(catId);
    bus.emit('toast:save');
  }
  /* blur 시 즉시 커밋 */
  inp.addEventListener('blur',function(){_commit();});
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();_commit();}
    if(e.key==='Escape'){_committed=true;_setSymRenderSyms(catId);}
  });
  /* ★ 추가 안전망: 외부 mousedown을 capture 단계에서 선제 포착 → blur/accordion close 이전에 저장 */
  const _outsideCapture=function(e){
    if(_committed)return;
    if(!inp||!inp.parentNode){document.removeEventListener('mousedown',_outsideCapture,true);return;}
    if(inp.contains(e.target))return;
    /* 외부 클릭 감지 → 즉시 저장 */
    document.removeEventListener('mousedown',_outsideCapture,true);
    _commit();
  };
  /* 다음 tick부터 활성화 (이 함수 호출을 일으킨 클릭 제외) */
  setTimeout(function(){document.addEventListener('mousedown',_outsideCapture,true);},0);
}

/* 증상 삭제/숨기기 */
async function _setSymDelete(catId,name,isUser){
  /* 네이티브 confirm() 금지 — Electron+Windows 에서 닫힌 뒤 포커스 복귀가 깨져 일반일지 검색창 입력이 잠김.
   *  앱 표준 모달(appConfirmModal)로 교체 → GUI 통일 + 잠김 해결. (사용자 보고 2026-06-23) */
  if(isUser){
    const ok=await appConfirmModal('"'+escHtml(name)+'" 사용자 추가 증상을 삭제하시겠습니까?','증상 삭제',{okLabel:'삭제',cancelLabel:'취소'});
    if(!ok)return;
    const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
    if(userSyms[catId])userSyms[catId]=userSyms[catId].filter(function(s){return s!==name;});
    localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
  } else {
    const ok=await appConfirmModal('"'+escHtml(name)+'" 기본 증상을 숨기시겠습니까?','증상 숨김',{okLabel:'숨기기',cancelLabel:'취소'});
    if(!ok)return;
    const hidden=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
    if(!hidden[catId])hidden[catId]=[];
    if(hidden[catId].indexOf(name)===-1)hidden[catId].push(name);
    localStorage.setItem('ec_hidden_symptoms',JSON.stringify(hidden));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','hidden_symptoms',hidden);
  }
  _setSymRenderSyms(catId);
  bus.emit('toast:save');
}

/* 숨긴 증상 복원 */

/* 기본 증상 눈알 토글 (숨기기 ↔ 보이기) — confirm 없이 즉시 전환 */
function _setSymToggleHide(catId,name){
  const hidden=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  if(!hidden[catId])hidden[catId]=[];
  const idx=hidden[catId].indexOf(name);
  if(idx!==-1){hidden[catId].splice(idx,1);}
  else{hidden[catId].push(name);}
  localStorage.setItem('ec_hidden_symptoms',JSON.stringify(hidden));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','hidden_symptoms',hidden);
  _setSymRenderSyms(catId);
  bus.emit('toast:save');
}

/* 드래그 순서 변경 */
function _setSymStartDrag(chipEl,e){
  e.preventDefault();e.stopPropagation();
  const panel=document.getElementById('setSymSymList');if(!panel)return;
  const catId=chipEl.dataset.cat||chipEl.getAttribute('data-cat');
  const draggedSym=chipEl.dataset.sym||chipEl.getAttribute('data-sym');
  if(!draggedSym||!catId)return;
  const startY=e.clientY;
  const startX=e.clientX;
  let moved=false;
  const rect=chipEl.getBoundingClientRect();
  /* 드래그 클론 */
  const clone=chipEl.cloneNode(true);
  clone.style.cssText='position:fixed;z-index:12000;pointer-events:none;opacity:0.9;box-shadow:0 6px 20px rgba(0,0,0,0.35);width:'+rect.width+'px;padding:5px 8px;border-radius:6px;background:var(--bg2);border:1.5px solid var(--cyan);color:var(--t1);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden';
  clone.textContent=draggedSym;
  clone.style.left=rect.left+'px';
  clone.style.top=rect.top+'px';
  document.body.appendChild(clone);
  chipEl.style.opacity='0.3';
  /* 플레이스홀더 — cyan bar */
  const placeholder=document.createElement('div');
  placeholder.className='_sym-drag-ph';
  placeholder.style.cssText='height:3px;background:var(--cyan);border-radius:2px;margin:3px 0;box-shadow:0 0 4px rgba(6,182,212,0.5)';

  function onMove(ev){
    if(!moved&&(Math.abs(ev.clientY-startY)>3||Math.abs(ev.clientX-startX)>3))moved=true;
    clone.style.top=(ev.clientY-(startY-rect.top))+'px';
    /* 매번 최신 chip 목록 재조회 (DOM 변경 대응) */
    const liveChips=Array.from(panel.querySelectorAll('.set-sym-chip'));
    let closest=null, closestDist=Infinity;
    liveChips.forEach(function(c){
      if(c===chipEl)return;
      const r=c.getBoundingClientRect();
      const mid=r.top+r.height/2;
      const dist=Math.abs(ev.clientY-mid);
      if(dist<closestDist){closestDist=dist;closest={el:c,above:ev.clientY<mid};}
    });
    if(placeholder.parentNode)placeholder.remove();
    if(closest){
      if(closest.above)closest.el.before(placeholder);
      else closest.el.after(placeholder);
    }
  }
  function onUp(ev){
    document.removeEventListener('mousemove',onMove,true);
    document.removeEventListener('mouseup',onUp,true);
    if(clone.parentNode)clone.remove();
    chipEl.style.opacity='1';
    const phInDom=!!placeholder.parentNode;
    /* 드래그 거의 안 했으면 그냥 종료 */
    if(!moved||!phInDom){if(placeholder.parentNode)placeholder.remove();return;}
    /* 순서 계산: panel.children 순회 — placeholder 위치에 dragged sym 삽입, chipEl 원래 위치는 스킵 */
    const finalOrder=[];
    let insertedDragged=false;
    Array.from(panel.children).forEach(function(child){
      if(child===placeholder){finalOrder.push(draggedSym);insertedDragged=true;return;}
      if(child===chipEl)return; /* 원래 위치는 스킵 (placeholder가 새 위치) */
      if(child.classList&&child.classList.contains('set-sym-chip')){
        const s=child.dataset.sym||child.getAttribute('data-sym');
        if(s&&s!==draggedSym)finalOrder.push(s);
      }
    });
    if(!insertedDragged)finalOrder.push(draggedSym);
    placeholder.remove();
    /* 저장 */
    const orderMap=JSON.parse(localStorage.getItem('ec_sym_order')||'{}');
    orderMap[catId]=finalOrder;
    localStorage.setItem('ec_sym_order',JSON.stringify(orderMap));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','sym_order',orderMap);
    _setSymRenderSyms(catId);
    bus.emit('toast:save');
  }
  /* capture 단계로 바인딩 — 다른 리스너보다 먼저 처리 */
  document.addEventListener('mousemove',onMove,true);
  document.addEventListener('mouseup',onUp,true);
}

function _setMedToggle(name){
  const hidden=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}');
  if(hidden[name])delete hidden[name];
  else hidden[name]=true;
  localStorage.setItem('ec_med_hidden',JSON.stringify(hidden));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_hidden',hidden);
  /* 전역 변수도 동기화 */
  if(typeof S._medHidden!=='undefined')S._medHidden=hidden;
  /* symptom-view.js 의 module-level _medHidden 객체도 즉시 동기화 — 다음 검색 필터에서 숨김 반영.
   * 이게 없으면 첫 로드 시 const 로 캡처된 객체라 토글 후에도 _medIsHidden() 이 옛 값을 반환함. */
  try{ if(typeof refreshMedHidden==='function') refreshMedHidden(); }catch(_){}
  _setMedSearchRender();
  bus.emit('toast:save');
}

/* ── Treatment table ── */
export function loadTreatmentTable(){
  const body=document.getElementById('treatmentListBody');
  if(!body)return;
  body.innerHTML=S.treatmentMap.map(function(t,i){return '<tr><td><input value="'+escHtml(t.symptom)+'" data-action="treatment-change" data-idx="'+i+'" data-field="symptom"></td><td><input value="'+escHtml(t.treatments)+'" data-action="treatment-change" data-idx="'+i+'" data-field="treatments"></td><td><button class="btn-icon" data-action="treatment-del" data-idx="'+i+'">✕</button></td></tr>';}).join('');
  body.querySelectorAll('[data-action="treatment-change"]').forEach(function(inp){
    inp.addEventListener('change',function(){S.treatmentMap[+this.dataset.idx][this.dataset.field]=this.value;saveTreatmentMap();});
  });
  body.querySelectorAll('[data-action="treatment-del"]').forEach(function(btn){
    btn.addEventListener('click',function(){S.treatmentMap.splice(+this.dataset.idx,1);saveTreatmentMap();loadTreatmentTable();});
  });
}
function saveTreatmentMap(){if(window.electronAPI&&window.electronAPI.medicalSetTreatmentMap)window.electronAPI.medicalSetTreatmentMap(S.treatmentMap).catch(function(err){console.error('[DB] treatmentMap 저장 실패:',err);});}

/* ── Medication table ── */
export function loadMedicationTable(){
  const body=document.getElementById('medicationListBody');
  if(!body)return;
  body.innerHTML=S.medicationMap.map(function(m,i){return '<tr><td><input value="'+escHtml(m.symptom)+'" data-action="medication-change" data-idx="'+i+'" data-field="symptom"></td><td><input value="'+escHtml(m.meds)+'" data-action="medication-change" data-idx="'+i+'" data-field="meds"></td><td><button class="btn-icon" data-action="medication-del" data-idx="'+i+'">✕</button></td></tr>';}).join('');
  body.querySelectorAll('[data-action="medication-change"]').forEach(function(inp){
    inp.addEventListener('change',function(){S.medicationMap[+this.dataset.idx][this.dataset.field]=this.value;saveMedicationMap();});
  });
  body.querySelectorAll('[data-action="medication-del"]').forEach(function(btn){
    btn.addEventListener('click',function(){S.medicationMap.splice(+this.dataset.idx,1);saveMedicationMap();loadMedicationTable();});
  });
}
function saveMedicationMap(){if(window.electronAPI&&window.electronAPI.medicalSetMedicationMap)window.electronAPI.medicalSetMedicationMap(S.medicationMap).catch(function(err){console.error('[DB] medicationMap 저장 실패:',err);});}

/* ── Dept mapping ── */
let deptMap=[];
function _initDeptMap(){
  const txt=S.deptMappingText||'';
  deptMap=txt.split('\n').filter(function(l){return l.includes('→');}).map(function(l){const p=l.split('→');return {symptom:p[0].trim(),dept:p[1].trim()};});
}
_initDeptMap();
function loadDeptTable(){
  if(!deptMap.length)_initDeptMap();
  const body=document.getElementById('deptListBody');
  if(!body)return;
  body.innerHTML=deptMap.map(function(d,i){return '<tr><td><input value="'+escHtml(d.symptom)+'" data-action="dept-change" data-idx="'+i+'" data-field="symptom"></td><td><input value="'+escHtml(d.dept)+'" data-action="dept-change" data-idx="'+i+'" data-field="dept"></td><td><button class="btn-icon" data-action="dept-del" data-idx="'+i+'">✕</button></td></tr>';}).join('');
  body.querySelectorAll('[data-action="dept-change"]').forEach(function(inp){
    inp.addEventListener('change',function(){deptMap[+this.dataset.idx][this.dataset.field]=this.value;saveDeptMap();});
  });
  body.querySelectorAll('[data-action="dept-del"]').forEach(function(btn){
    btn.addEventListener('click',function(){deptMap.splice(+this.dataset.idx,1);saveDeptMap();loadDeptTable();});
  });
}
function saveDeptMap(){
  S.deptMappingText=deptMap.map(function(d){return d.symptom+' → '+d.dept;}).join('\n');
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)window.electronAPI.jsonSaveCommon('deptMapping',S.deptMappingText);
}

/* ── Expose to global scope ── */

/* ── 식약처 API 연결 테스트 ── */
export function _testDrugApiKey(){
  const key=getPublicDataApiKey('drug');
  const el=document.getElementById('drugApiTestResult');
  if(!key){if(el)el.innerHTML='<span style="color:#dc2626">❌ API 키가 입력되지 않았습니다.</span>';return;}
  if(el)el.innerHTML='<span style="color:var(--cyan)">⏳ 테스트 중...</span>';
  if(window.electronAPI&&window.electronAPI.externalFetchDrugInfo){
    window.electronAPI.externalFetchDrugInfo(key,'타이레놀').then(function(res){
      if(res&&res.success)el.innerHTML='<span style="color:#16a34a">✅ 연결 성공! "'+res.data.itemName+'" 확인됨</span>';
      else el.innerHTML='<span style="color:#dc2626">❌ 실패: '+(res&&res.error||'알 수 없는 오류')+'</span>';
    }).catch(function(e){el.innerHTML='<span style="color:#dc2626">❌ 오류: '+e.message+'</span>';});
  } else {
    if(el)el.innerHTML='<span style="color:#dc2626">❌ API 호출 기능을 사용할 수 없습니다.</span>';
  }
}
/* ── 주간 시간표 저장 ── */
function _saveTimetable(){
  const tt={};
  const days=['mon','tue','wed','thu','fri'];
  days.forEach(function(d){tt[d]=[];});
  document.querySelectorAll('input[data-tt-day]').forEach(function(inp){
    const day=inp.dataset.ttDay;
    const period=parseInt(inp.dataset.ttPeriod);
    if(!tt[day])tt[day]=[];
    tt[day][period]=inp.value.trim();
  });
  localStorage.setItem('ec_timetable',JSON.stringify(tt));
  bus.emit('toast:saveLater');
}

