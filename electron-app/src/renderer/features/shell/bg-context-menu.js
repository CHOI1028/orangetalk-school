/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * 🖱 배경 우클릭 메뉴 (bg-context-menu.js)
 *
 * 일반 일지 / 응급처치 기록 / 감염병 관리 화면(#view-daily)의 "흰 캔버스(표·리스트)가 아닌
 * 배경 영역"을 우클릭하면, 이름 클릭 미니 메뉴(ems-mini-popup)와 동일한 GUI로 빠른 작업 메뉴를 띄운다.
 * 항목: 키오스크 설정 · 동료와 협업 설정 · 전체 시간표 보기 · 학교 현황 보기 ·
 *       포스트잇 열기 · 오렌지팜으로 이동 · 버전 업데이트
 */
/* ES Module */
import { openSettings, renderSettingsPanel, openAdvancedSearch } from '../settings/settings-view.js';
import { switchView } from './view-router.js';
import { showTimetableModal } from '../../core/timetable.js';
import { openSchoolStatsModal, openMyWeekModal } from '../dashboard/home-dashboard.js';
import { toggleFloatingPostit } from '../dashboard/floating-postit.js';
import { openRecentVisitModal } from '../daily/daily-view.js';
import { selectStudent, _dailyDateGuard, _todayLocalStr } from '../daily/daily-autocomplete.js';
import { S } from '../../core/app-state.js';
import { playQuickMenuSound } from '../../core/ui-utils.js';
import { neisKey } from '../../core/school-meal.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';

/* 설정 패널은 openSettings() 직후 사이드바 렌더가 끝나야 카테고리 전환이 먹으므로 약간의 지연을 둔다
 *  (command-palette.js 의 키오스크 설정 열기와 동일한 패턴). */
function _openSettingsCat(cat){
  openSettings();
  setTimeout(function(){ try{ renderSettingsPanel(cat); }catch(_){} }, 100);
}

const _ITEMS = [
  { icon:'🔍', label:'인원 검색',          submenu:[
      { icon:'📝', label:'방문자 검색 및 일지 작성', tip:'이름 검색 후 선택하면 증상·처치 팝업이 뜨고(오늘이 아닌 날짜면 날짜 확인 팝업) 일반 일지에 기록됩니다.', run:async function(){
          /* 상세 검색 모달을 열기 "전에" 날짜 가드를 먼저 띄운다 — 오늘이 아닌 날짜면 등록 날짜를 먼저 확정한 뒤
             검색→선택 시 그 날짜로 등록(가드 재표시 안 함). (사용자 요청 2026-06-18) */
          const _choice = await _dailyDateGuard();
          if(_choice==='cancel') return;
          const _regDate = (_choice==='today') ? _todayLocalStr() : S.selectedDate;
          openAdvancedSearch(function(id){ selectStudent(id, _regDate); });
        } },
      { icon:'📋', label:'최근 보건실 방문 이력 보기', tip:'바디맵·V/S·상담 이력과 요보호·기저질환·동의 여부를 팝업으로 봅니다.', run:function(){ openRecentVisitModal(); } }
    ] },
  { icon:'🏥', label:'키오스크 설정',      run:function(){ _openSettingsCat('kiosk'); } },
  { icon:'🤝', label:'동료와 협업 설정',   run:function(){ _openSettingsCat('datasync'); } },
  { icon:'📅', label:'시간표 보기',        needNeis:true, submenu:[
      { icon:'📋', label:'전체 시간표', tip:'나이스에서 불러온 학교 전체 시간표를 봅니다.', run:function(){ showTimetableModal(); } },
      { icon:'🗓️', label:'나의 시간표', tip:'내가 선택한 수업의 월~금 주간 시간표를 봅니다.', run:function(){ openMyWeekModal(); } }
    ] },
  { icon:'🏫', label:'학교 현황 보기',     needNeis:true, run:function(){ openSchoolStatsModal(); } },
  { icon:'📌', label:'포스트잇 열기',      tip:'대시보드와 연동되는 포스트잇을 엽니다.', run:function(){ toggleFloatingPostit(); } },
  { icon:'🍊', label:'오렌지팜으로 이동',  run:function(){ switchView('orange'); } },
  { icon:'🔄', label:'버전 업데이트',      run:function(){ _openSettingsCat('version'); } }
];

function _close(){
  const p = document.getElementById('bgCtxMenu');  if(p) p.remove();
  const s = document.getElementById('bgCtxSubMenu'); if(s) s.remove();
  hideHeaderTooltip();
  document.removeEventListener('mousedown', _outside, true);
}
function _outside(e){
  const p = document.getElementById('bgCtxMenu');
  const s = document.getElementById('bgCtxSubMenu');
  const inP = p && p.contains(e.target);
  const inS = s && s.contains(e.target);
  if(!inP && !inS) _close();
}
/* 서브메뉴 (예: 시간표 보기 → 전체 시간표 / 나의 시간표). 메인 메뉴는 유지, 항목 클릭 시 모두 닫고 실행. */
function _showSubmenu(items, x, y, title){
  const old = document.getElementById('bgCtxSubMenu'); if(old) old.remove();
  const pop = document.createElement('div');
  pop.className = 'ems-mini-popup';
  pop.id = 'bgCtxSubMenu';
  let html = '<div style="padding:8px 14px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--bdr);background:linear-gradient(145deg,var(--bg2),color-mix(in srgb,var(--bg2) 85%,#6b7280 15%));border-radius:8px 8px 0 0">'+(title||'선택')+'</div>';
  items.forEach(function(it, i){ html += '<div class="ems-msg-link" data-bgs="'+i+'">'+it.icon+' '+it.label+'</div>'; });
  pop.innerHTML = html;
  pop.addEventListener('click', function(e){
    const link = e.target.closest('[data-bgs]'); if(!link) return;
    e.stopPropagation();
    const it = items[parseInt(link.dataset.bgs,10)];
    _close();
    if(it && typeof it.run==='function'){ try{ it.run(); }catch(err){ console.error('[BGCTX]', err); } }
  });
  pop.querySelectorAll('[data-bgs]').forEach(function(el){
    const it = items[parseInt(el.dataset.bgs,10)];
    if(it && it.tip){
      el.addEventListener('mouseenter', function(ev){ showHeaderTooltip(ev, it.tip, false, true); });
      el.addEventListener('mouseleave', function(){ hideHeaderTooltip(); });
    }
  });
  pop.style.left='0px'; pop.style.top='0px'; pop.style.visibility='hidden';
  document.body.appendChild(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let px = x, py = y;
  if(px + w > window.innerWidth - 6) px = Math.max(6, x - w - 6);   /* 오른쪽 공간 없으면 왼쪽으로 펼침 */
  if(py + h > window.innerHeight - 6) py = Math.max(6, window.innerHeight - h - 6);
  pop.style.left = px+'px'; pop.style.top = py+'px'; pop.style.visibility = '';
}

function _showMenu(x, y){
  _close();
  playQuickMenuSound();   /* 빠른 작업 팝업 효과음 (사용자 요청 2026-06-18) */
  const pop = document.createElement('div');
  pop.className = 'ems-mini-popup';   /* 이름 클릭 미니 메뉴와 동일 GUI 재사용 */
  pop.id = 'bgCtxMenu';
  let html = '<div style="padding:8px 14px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--bdr);background:linear-gradient(145deg,var(--bg2),color-mix(in srgb,var(--bg2) 85%,#6b7280 15%));border-radius:8px 8px 0 0">⚡ 빠른 작업</div>';
  const NEIS_TIP = '설정 - API Key 관리 - 나이스(NEIS) Open API에서 API 키를 넣어주세요.';
  const _isDisabled = function(it){ return !!(it && it.needNeis && !neisKey()); };
  _ITEMS.forEach(function(it, i){
    const dis = _isDisabled(it);
    const arrow = (it.submenu && !dis) ? '<span style="float:right;color:var(--t3);font-size:11px;margin-left:10px;line-height:1.4">▶</span>' : '';
    html += '<div class="ems-msg-link'+(dis?' bgc-disabled':'')+'" data-bgc="'+i+'"'+(dis?' data-bgc-disabled="1"':'')+(dis?' style="opacity:0.45;cursor:not-allowed"':'')+'>'+it.icon+' '+it.label+(dis?' <span style="font-size:9px">🔒</span>':'')+arrow+'</div>';
  });
  pop.innerHTML = html;
  /* 항목 클릭 위임 */
  pop.addEventListener('click', function(e){
    const link = e.target.closest('[data-bgc]');
    if(!link) return;
    e.stopPropagation();
    const it = _ITEMS[parseInt(link.dataset.bgc,10)];
    if(_isDisabled(it)) return;   /* NEIS 키 미등록 — 비활성 */
    if(it && Array.isArray(it.submenu)){
      const r = link.getBoundingClientRect();
      _showSubmenu(it.submenu, r.right - 6, r.top - 4, it.icon+' '+it.label);
      return;   /* 메인 메뉴는 유지한 채 서브메뉴 표시 */
    }
    _close();
    if(it && typeof it.run==='function'){ try{ it.run(); }catch(err){ console.error('[BGCTX]', err); } }
  });
  /* 툴팁 — 활성 항목은 it.tip, 비활성(NEIS 미등록) 항목은 안내 문구 */
  pop.querySelectorAll('[data-bgc]').forEach(function(el){
    const it = _ITEMS[parseInt(el.dataset.bgc,10)];
    const dis = _isDisabled(it);
    el.addEventListener('mouseenter', function(ev){
      if(it && Array.isArray(it.submenu) && !dis){
        /* 서브메뉴 있는 항목 — 클릭 없이 hover 만으로 바로 펼침 (사용자 요청 2026-06-18) */
        const r = el.getBoundingClientRect();
        _showSubmenu(it.submenu, r.right - 6, r.top - 4, it.icon+' '+it.label);
      } else {
        /* 서브메뉴 없는 항목으로 옮기면 열린 서브메뉴를 닫고, 툴팁 표시 */
        const s = document.getElementById('bgCtxSubMenu'); if(s) s.remove();
        const tipText = dis ? NEIS_TIP : (it && it.tip);
        if(tipText) showHeaderTooltip(ev, tipText, false, true);
      }
    });
    el.addEventListener('mouseleave', function(){ hideHeaderTooltip(); });
  });
  /* 위치 — 우클릭 지점. 화면 밖으로 나가지 않게 보정 */
  pop.style.left = '0px'; pop.style.top = '0px'; pop.style.visibility = 'hidden';
  document.body.appendChild(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let px = x, py = y;
  if(px + w > window.innerWidth - 6) px = Math.max(6, window.innerWidth - w - 6);
  if(py + h > window.innerHeight - 6) py = Math.max(6, window.innerHeight - h - 6);
  pop.style.left = px+'px'; pop.style.top = py+'px'; pop.style.visibility = '';
  setTimeout(function(){ document.addEventListener('mousedown', _outside, true); }, 0);
}

/* 캔버스(표·리스트)·인터랙티브 요소 위에서는 기본 동작 유지 — 그 바깥 "배경"에서만 메뉴 */
const _SKIP_SEL = '#dailyTableWrap, #ecListCard, #infListCard, table, input, textarea, select, button, a,'
  + ' [contenteditable], .modal-overlay, .sv-modal-overlay, .ems-mini-popup, #bgCtxMenu, .daily-ctx-popup,'
  + ' .autocomplete-list, .floating-postit, .magic-index-tab';

document.addEventListener('contextmenu', function(e){
  /* 일반/응급/감염 일지 화면이 떠 있을 때만 (셋 다 #view-daily 한 페이지를 공유).
   * 우클릭 지점이 #view-daily 박스 바깥의 바탕 여백일 수 있으므로, 자손 여부가 아니라
   * 뷰 활성 여부로 판정한다 (표 아래/옆 흰 공간은 실제로 #view-daily 가 덮지 않는 <html> 바탕). */
  /* 보건일지(일반/응급/감염이 #view-daily 공유) 외에 대시보드·방문통계·매직 스테이션·오렌지팜 에서도 빠른 작업 메뉴 노출 (사용자 요청 2026-07-03) */
  const _ctxViews=['view-daily','view-home','view-dashboard','view-magic','view-orange'];
  const _ctxActive=_ctxViews.some(function(id){ const el=document.getElementById(id); return el && el.classList.contains('active'); });
  if(!_ctxActive) return;
  /* 사이드바·헤더 등 일지 본문 밖 영역에서는 띄우지 않음 */
  if(e.target.closest && e.target.closest('#sidebar, .sidebar, header, .app-header, .top-nav, .nav-link')) return;
  /* 캔버스(표·리스트)·인터랙티브 요소 위에서는 기본 동작 유지 */
  if(e.target.closest && e.target.closest(_SKIP_SEL)) return;
  e.preventDefault();
  _showMenu(e.clientX, e.clientY);
});
