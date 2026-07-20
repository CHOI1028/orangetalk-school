/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * command-palette.js — ⌘K 명령 팔레트 (macOS Spotlight / Raycast 스타일)
 *
 * 단축키: ⌘K (Mac) / Ctrl+K (Win/Linux)
 *
 * 기능:
 *  - 명령 검색 (fuzzy match)
 *  - 섹션 그룹핑 (이동 / 편집 / 설정 / 단축키)
 *  - 키보드 네비게이션 (↑↓ Enter Esc)
 *  - 최근 사용 명령 우선 정렬
 *  - 모든 명령에 키워드·단축키 표시
 */
/* ES Module */
/* shortcut-cheatsheet, global-shortcuts, keyboard-navigation 통합 */
import { switchView } from '../features/shell/view-router.js';
import { openSettings, renderSettingsPanel, openAdvancedSearch } from '../features/settings/settings-view.js';
import { goToToday, togglePrivacyMode } from '../features/daily/daily-view.js';
import { bus } from './event-bus.js';
import { toggleColSelector } from '../features/emergency/emergency-view.js';
import { selectStudent } from '../features/daily/daily-autocomplete.js';
import { openRentalLedger } from '../features/daily/rental-ledger-view.js';
import { openVisitPass } from '../features/visit-pass/visit-pass-view.js';
import { openDiaryPrint } from '../features/daily/diary-print-view.js';
import { openQuickMsg } from '../features/newsletter/newsletter-misc-view.js';
import { toggleTheme } from '../features/shell/theme-manager.js';
import { saveData } from './helpers.js';

const _isMac = /Mac/i.test(navigator.platform);
const _modKey = _isMac ? '⌘' : 'Ctrl';
/* Windows는 'Ctrl+Z' 관습, Mac은 '⌘Z' (단일 심볼이라 공백 불필요) */
const _sep = _isMac ? '' : '+';
function _kb(/*...keys*/){ return Array.prototype.slice.call(arguments).join(_sep); }
const _recentKey = 'ec_cp_recent';
const _maxRecent = 5;

/* ── 명령 정의 ── */
function _getCommands(){
  const cmds = [];

  /* 이동 */
  cmds.push({id:'nav-daily', group:'이동', title:'일반 일지로 이동', icon:'📋', shortcut:'', keywords:'daily diary 보건일지', action:function(){
    const btn = document.querySelector('[data-nav="daily"], [data-view="daily"]');
    if(btn) btn.click();
    else switchView('daily');
  }});
  cmds.push({id:'nav-dashboard', group:'이동', title:'대시보드로 이동', icon:'📊', shortcut:'', keywords:'dashboard 통계 stats', action:function(){
    const btn = document.querySelector('[data-nav="dashboard"], [data-view="dashboard"]');
    if(btn) btn.click();
    else switchView('dashboard');
  }});
  cmds.push({id:'nav-magic', group:'이동', title:'매직 스테이션으로 이동', icon:'📔', shortcut:'', keywords:'magic 교무 planner 플래너', action:function(){
    const btn = document.querySelector('[data-nav="magic"], [data-view="magic"]');
    if(btn) btn.click();
    else switchView('magic');
  }});
  /* 스토리 뷰(튜토리얼 영상) 진입 차단 — 영상 콘텐츠 비활성(getBannerTutorials=[]) 상태라 진입 경로 제거 (2026-06-14) */
  cmds.push({id:'nav-settings', group:'이동', title:'설정 열기', icon:'⚙', shortcut:_kb(_modKey,','), keywords:'settings 설정 preferences', action:function(){
    openSettings();
  }});
  cmds.push({id:'nav-today', group:'이동', title:'오늘로 이동', icon:'📅', shortcut:'T', keywords:'today 오늘 now', action:function(){
    goToToday();
  }});

  /* 편집 */
  cmds.push({id:'edit-undo', group:'편집', title:'실행 취소', icon:'↶', shortcut:_kb(_modKey,'Z'), keywords:'undo 되돌리기 실행취소', action:function(){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'z', ctrlKey:!_isMac, metaKey:_isMac, bubbles:true}));
  }});
  cmds.push({id:'edit-redo', group:'편집', title:'다시 실행', icon:'↷', shortcut:_kb(_modKey,'⇧','Z'), keywords:'redo 다시 재실행', action:function(){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Z', ctrlKey:!_isMac, metaKey:_isMac, shiftKey:true, bubbles:true}));
  }});

  /* 일반일지 도구 */
  cmds.push({id:'daily-search', group:'일반일지', title:'학생 검색 (이름·학년반)', icon:'🔍', shortcut:'', keywords:'search find 검색', action:function(){
    const inp = document.getElementById('dailySearchInput');
    if(inp){ inp.focus(); inp.select(); }
  }});
  cmds.push({id:'daily-advanced-search', group:'일반일지', title:'상세 검색 (조건 검색)', icon:'🔎', shortcut:'', keywords:'advanced 상세 고급', action:function(){
    openAdvancedSearch(function(id){ selectStudent(id); });
  }});
  cmds.push({id:'daily-rental', group:'일반일지', title:'물품 대여 대장 열기', icon:'📦', shortcut:'', keywords:'rental lend 대여 물품', action:function(){
    openRentalLedger();
  }});
  cmds.push({id:'daily-visit-pass', group:'일반일지', title:'커스텀 양식 출력', icon:'🖨', shortcut:'', keywords:'print pass 출력 방문확인증', action:function(){
    openVisitPass();
  }});
  cmds.push({id:'daily-diary-print', group:'일반일지', title:'보건일지 출력', icon:'📄', shortcut:'', keywords:'print diary 출력', action:function(){
    openDiaryPrint();
  }});
  cmds.push({id:'daily-quick-msg', group:'일반일지', title:'상용 메시지', icon:'💬', shortcut:'', keywords:'message quick 상용', action:function(){
    openQuickMsg();
  }});
  cmds.push({id:'daily-col-setup', group:'일반일지', title:'열 필드 설정', icon:'🔧', shortcut:'', keywords:'column 열 columns', action:function(){
    toggleColSelector();
  }});
  cmds.push({id:'daily-privacy', group:'일반일지', title:'프라이버시 모드 토글', icon:'🕶', shortcut:'', keywords:'privacy 프라이버시 블러', action:function(){
    togglePrivacyMode();
  }});

  /* 설정 */
  cmds.push({id:'settings-theme', group:'설정', title:'다크/라이트 모드 전환', icon:'🌓', shortcut:'', keywords:'theme dark light mode 테마', action:function(){
    toggleTheme();
  }});
  cmds.push({id:'settings-kiosk', group:'설정', title:'키오스크 설정 열기', icon:'🏥', shortcut:'', keywords:'kiosk 키오스크 태블릿', action:function(){
    openSettings();
    setTimeout(function(){ renderSettingsPanel('kiosk'); }, 100);
  }});
  cmds.push({id:'settings-data', group:'설정', title:'데이터 백업·삭제', icon:'💾', shortcut:'', keywords:'backup 백업 데이터 삭제', action:function(){
    openSettings();
    setTimeout(function(){ renderSettingsPanel('retention'); }, 100);
  }});

  /* 도움말 */
  cmds.push({id:'help-shortcuts', group:'도움말', title:'키보드 단축키 보기', icon:'⌨', shortcut:'?', keywords:'shortcuts help ? 단축키 도움말', action:function(){
    showShortcutCheatsheet();
  }});

  return cmds;
}

/* ── 퍼지 매치 ── */
function _fuzzyMatch(text, query){
  if(!query) return {score:1, highlights:[]};
  text = text.toLowerCase(); query = query.toLowerCase();
  if(text.indexOf(query)!==-1){
    return {score:100 - text.indexOf(query), highlights:[text.indexOf(query), text.indexOf(query)+query.length]};
  }
  /* character-by-character match */
  let ti=0, qi=0, score=0;
  while(ti<text.length && qi<query.length){
    if(text[ti]===query[qi]){ score++; qi++; }
    ti++;
  }
  return qi===query.length ? {score:score, highlights:[]} : null;
}

/* ── 최근 사용 추적 ── */
function _getRecent(){
  try { return JSON.parse(localStorage.getItem(_recentKey)||'[]'); } catch(e){ return []; }
}
function _pushRecent(cmdId){
  let recent = _getRecent().filter(function(id){return id!==cmdId;});
  recent.unshift(cmdId);
  recent = recent.slice(0, _maxRecent);
  try { localStorage.setItem(_recentKey, JSON.stringify(recent)); } catch(e){}
}

/* ── 팔레트 UI ── */
const _cpState = {
  open: false,
  query: '',
  selectedIdx: 0,
  filtered: [],
  overlay: null
};

function _openPalette(){
  if(_cpState.open) return;
  _cpState.open = true;
  _cpState.query = '';
  _cpState.selectedIdx = 0;

  const ov = document.createElement('div');
  ov.id = 'commandPaletteOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.18);backdrop-filter:blur(2.5px) saturate(120%);-webkit-backdrop-filter:blur(2.5px) saturate(120%);display:flex;align-items:flex-start;justify-content:center;padding-top:18vh;opacity:0;transition:opacity .18s cubic-bezier(0.4,0,0.2,1)';

  ov.innerHTML = ''
    + '<div id="cpPalette" style="width:640px;max-width:92vw;background:var(--card);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,0.28),0 0 0 1px rgba(255,255,255,0.1) inset;overflow:hidden;transform:translateY(-8px) scale(0.98);transition:transform .22s cubic-bezier(0.34,1.32,0.64,1);max-height:60vh;display:flex;flex-direction:column">'
    + '<div style="padding:16px 20px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:12px">'
    + '<span style="font-size:18px;color:var(--t3)">⌘</span>'
    + '<input id="cpInput" type="text" placeholder="명령을 입력하세요…" style="flex:1;border:none;background:transparent;font-size:16px;color:var(--t1);outline:none;font-family:var(--f);font-weight:500" autocomplete="off" autofocus>'
    + '<span style="font-size:10px;color:var(--t3);font-family:var(--fm);background:var(--bg2);padding:3px 8px;border-radius:4px">esc</span>'
    + '</div>'
    + '<div id="cpList" style="flex:1;overflow-y:auto;padding:6px 0"></div>'
    + '<div style="padding:8px 16px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--t3);font-family:var(--f)">'
    + '<span>↑↓ 탐색 · ↵ 실행</span>'
    + '<span><kbd style="background:var(--card);padding:1px 4px;border-radius:3px;font-family:var(--fm);font-size:9px">'+_kb(_modKey,'K')+'</kbd> 팔레트 토글</span>'
    + '</div>'
    + '</div>';

  document.body.appendChild(ov);
  _cpState.overlay = ov;

  /* 애니메이션 시작 */
  requestAnimationFrame(function(){
    ov.style.opacity = '1';
    const pal = document.getElementById('cpPalette');
    if(pal) pal.style.transform = 'translateY(0) scale(1)';
  });

  const inp = document.getElementById('cpInput');
  _renderList();

  inp.addEventListener('input', function(){
    _cpState.query = this.value;
    _cpState.selectedIdx = 0;
    _renderList();
  });

  inp.addEventListener('keydown', function(e){
    if(e.key==='Escape'){ e.preventDefault(); _closePalette(); return; }
    if(e.key==='ArrowDown'){
      e.preventDefault();
      _cpState.selectedIdx = Math.min(_cpState.filtered.length-1, _cpState.selectedIdx+1);
      _updateSelection();
    } else if(e.key==='ArrowUp'){
      e.preventDefault();
      _cpState.selectedIdx = Math.max(0, _cpState.selectedIdx-1);
      _updateSelection();
    } else if(e.key==='Enter'){
      e.preventDefault();
      _executeSelected();
    }
  });

  /* 바깥 클릭으로 닫기 */
  ov.addEventListener('mousedown', function(e){
    if(e.target===ov) _closePalette();
  });

  /* 포커스 */
  setTimeout(function(){ inp.focus(); }, 30);
}

function _closePalette(){
  if(!_cpState.open || !_cpState.overlay) return;
  _cpState.open = false;
  const ov = _cpState.overlay;
  ov.style.opacity = '0';
  const pal = document.getElementById('cpPalette');
  if(pal) pal.style.transform = 'translateY(-8px) scale(0.98)';
  setTimeout(function(){ if(ov.parentNode) ov.remove(); _cpState.overlay = null; }, 200);
}

function _renderList(){
  const list = document.getElementById('cpList');
  if(!list) return;
  const q = _cpState.query.trim();
  const all = _getCommands();
  const recent = _getRecent();

  /* 검색 필터링 */
  let filtered;
  if(q){
    filtered = all.map(function(cmd){
      const textMatch = _fuzzyMatch(cmd.title, q);
      const kwMatch = _fuzzyMatch(cmd.keywords||'', q);
      let bestScore = 0;
      if(textMatch) bestScore = Math.max(bestScore, textMatch.score+50);/* 제목 매치 가중치 */
      if(kwMatch) bestScore = Math.max(bestScore, kwMatch.score);
      return bestScore>0 ? Object.assign({score:bestScore}, cmd) : null;
    }).filter(Boolean).sort(function(a,b){return b.score-a.score;});
  } else {
    /* 쿼리 없을 때: 최근 사용 먼저 */
    const recentCmds = recent.map(function(id){return all.find(function(c){return c.id===id;});}).filter(Boolean).map(function(c){return Object.assign({_recent:true}, c);});
    const notRecent = all.filter(function(c){return recent.indexOf(c.id)===-1;});
    filtered = recentCmds.concat(notRecent);
  }

  _cpState.filtered = filtered;
  _cpState.selectedIdx = Math.min(_cpState.selectedIdx, filtered.length-1);
  if(_cpState.selectedIdx<0) _cpState.selectedIdx = 0;

  if(filtered.length===0){
    list.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--t3);font-size:12px">일치하는 명령이 없습니다.</div>';
    return;
  }

  /* 그룹핑 (최근 사용 먼저, 이후 원래 그룹) */
  let html = '';
  let lastGroup = null;
  filtered.forEach(function(cmd, i){
    const groupLabel = cmd._recent ? '최근 사용' : cmd.group;
    if(groupLabel !== lastGroup){
      html += '<div style="padding:8px 20px 4px;font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:0.6px">'+_escHtml(groupLabel)+'</div>';
      lastGroup = groupLabel;
    }
    const isSel = i===_cpState.selectedIdx;
    html += '<div class="cp-item" data-idx="'+i+'" style="display:flex;align-items:center;gap:12px;padding:8px 20px;cursor:pointer;transition:background .08s;background:'+(isSel?'var(--bg2)':'transparent')+'">'
      + '<span style="font-size:16px;width:22px;text-align:center">'+cmd.icon+'</span>'
      + '<span style="flex:1;font-size:13px;color:var(--t1);font-weight:500">'+_escHtml(cmd.title)+'</span>'
      + (cmd.shortcut ? '<span style="font-size:10px;color:var(--t3);font-family:var(--fm);background:var(--bg2);padding:2px 6px;border-radius:4px;border:1px solid var(--bdr)">'+_escHtml(cmd.shortcut)+'</span>' : '')
      + '</div>';
  });
  list.innerHTML = html;

  /* 클릭 핸들러 */
  list.querySelectorAll('.cp-item').forEach(function(el){
    el.addEventListener('click', function(){
      _cpState.selectedIdx = parseInt(this.dataset.idx, 10);
      _executeSelected();
    });
    el.addEventListener('mousemove', function(){
      const idx = parseInt(this.dataset.idx, 10);
      if(idx!==_cpState.selectedIdx){
        _cpState.selectedIdx = idx;
        _updateSelection();
      }
    });
  });

  /* 선택된 항목 스크롤 보이게 */
  _scrollToSelected();
}

function _updateSelection(){
  const list = document.getElementById('cpList');
  if(!list) return;
  list.querySelectorAll('.cp-item').forEach(function(el, i){
    const isSel = i===_cpState.selectedIdx;
    el.style.background = isSel ? 'var(--bg2)' : 'transparent';
  });
  _scrollToSelected();
}

function _scrollToSelected(){
  const list = document.getElementById('cpList');
  if(!list) return;
  const selEl = list.querySelector('.cp-item[data-idx="'+_cpState.selectedIdx+'"]');
  if(selEl) selEl.scrollIntoView({block:'nearest'});
}

function _executeSelected(){
  const cmd = _cpState.filtered[_cpState.selectedIdx];
  if(!cmd) return;
  _pushRecent(cmd.id);
  _closePalette();
  /* 팔레트 애니메이션 종료 후 액션 */
  setTimeout(function(){
    try { cmd.action(); } catch(e){ console.error('[CMD]',e); }
  }, 160);
}

function _escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── 전역 단축키 ── */
document.addEventListener('keydown', function(e){
  const mod = e.metaKey || e.ctrlKey;
  if(mod && e.key.toLowerCase()==='k' && !e.shiftKey && !e.altKey){
    /* 입력 필드 안에 있어도 ⌘K는 언제나 동작 */
    e.preventDefault();
    if(_cpState.open) _closePalette();
    else _openPalette();
    return;
  }
  /* ? 키로 단축키 치트시트 열기 (입력 필드 밖에서만) */
  if(e.key==='?' && !mod && !e.altKey){
    const ae = document.activeElement;
    if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.contentEditable==='true')) return;
    e.preventDefault();
    showShortcutCheatsheet();
    return;
  }
  /* ⌘1-9 — 상단 메뉴 뷰 바로 전환 (macOS Safari 탭 스타일)
   * ⌘, — 설정 열기 (macOS 표준) */
  if(mod && !e.shiftKey && !e.altKey){
    const ae2 = document.activeElement;
    const inInput = ae2 && (ae2.tagName==='INPUT'||ae2.tagName==='TEXTAREA'||ae2.contentEditable==='true');
    if(e.key===',' && !inInput){
      e.preventDefault();
      openSettings();
      return;
    }
    if(/^[1-9]$/.test(e.key) && !inInput){
      const navBtns = document.querySelectorAll('.nav-link[data-view]');
      const idx = parseInt(e.key, 10) - 1;
      if(navBtns[idx]){
        e.preventDefault();
        navBtns[idx].click();
      }
      return;
    }
  }
});

export { _openPalette as openCommandPalette, _closePalette as closeCommandPalette };

/* ═══════════════════════════════════════
   SHORTCUT CHEATSHEET (shortcut-cheatsheet.js에서 통합)
   ═══════════════════════════════════════ */
const _cheatGroups = [
  {title:'전역',items:[
    {keys:[_modKey,'K'],desc:'명령 팔레트 열기'},{keys:['?'],desc:'이 단축키 도움말 열기'},{keys:['Esc'],desc:'팝업·모달 닫기 / 선택 해제'},
    {keys:[_modKey,','],desc:'설정 열기'},{keys:[_modKey,'1'],desc:'대시보드로 이동'},{keys:[_modKey,'2'],desc:'일반 보건일지로 이동'},
    {keys:[_modKey,'4'],desc:'매직 스테이션으로 이동'}
  ]},
  {title:'편집',items:[
    {keys:[_modKey,'Z'],desc:'실행 취소 (Undo)'},{keys:[_modKey,'⇧','Z'],desc:'다시 실행 (Redo)'},{keys:[_modKey,'Y'],desc:'다시 실행 (대체)'},
    {keys:[_modKey,'C'],desc:'선택 복사 (텍스트)'},{keys:[_modKey,'V'],desc:'붙여넣기 (텍스트)'},{keys:[_modKey,'X'],desc:'잘라내기 (텍스트)'},
    {keys:[_modKey,'A'],desc:'전체 선택'},{keys:['Delete'],desc:'선택된 행 삭제'},{keys:['Backspace'],desc:'선택된 행 삭제 (대체)'},
    {keys:[_modKey,'F'],desc:'검색창으로 포커스 이동'},{keys:[_modKey,'N'],desc:'추가/신규 버튼 자동 실행'},{keys:[_modKey,'S'],desc:'저장 (저장됨 토스트 표시)'}
  ]},
  {title:'모달·팝업',items:[
    {keys:[_modKey,'W'],desc:'열린 팝업 닫기 (macOS 창 닫기)'},{keys:[_modKey,'↵'],desc:'모달 내 주요 확인 버튼 실행'},
    {keys:['Esc'],desc:'최상위 모달 닫기'},{keys:[_modKey,'/'],desc:'이 단축키 도움말 열기 (보조)'},{keys:['F1'],desc:'이 단축키 도움말 열기 (보조)'}
  ]},
  {title:'일반일지 · 응급처치 · 감염병',items:[
    {keys:['드래그'],desc:'마우스 드래그로 여러 행 선택'},{keys:['Shift','클릭'],desc:'범위 선택'},{keys:[_modKey,'클릭'],desc:'복수 선택 (토글)'},
    {keys:[_modKey,'A'],desc:'현재 탭의 모든 행 선택'},{keys:['Delete'],desc:'선택된 행 일괄 삭제 (되돌리기 가능)'},
    {keys:['Esc'],desc:'드래그 선택 해제'},{keys:['←','→','↑','↓'],desc:'달력 날짜 이동 (일/주 단위)'}
  ]},
  {title:'플로우 편집기 (키오스크)',items:[
    {keys:[_modKey,'Z'],desc:'실행 취소'},{keys:[_modKey,'⇧','Z'],desc:'다시 실행'},{keys:[_modKey,'D'],desc:'선택된 보기 복제'},
    {keys:['Delete'],desc:'선택된 보기 삭제'},{keys:[_modKey,'클릭'],desc:'보기 복수 선택'},{keys:['드래그'],desc:'보기·섹션 순서 변경'},
    {keys:['Esc'],desc:'팝업 닫기 / 선택 해제'}
  ]},
  {title:'이동 (⌘K 팔레트에서도 가능)',items:[
    {keys:['T'],desc:'오늘로 이동 (일반일지 달력)'},{keys:[_modKey,','],desc:'설정 열기'}
  ]}
];
function _cheatEsc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showShortcutCheatsheet(){
  const existing=document.getElementById('shortcutCheatsheetOverlay');
  if(existing){_cheatClose();return;}
  const ov=document.createElement('div');
  ov.id='shortcutCheatsheetOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.22);backdrop-filter:blur(3px) saturate(120%);-webkit-backdrop-filter:blur(3px) saturate(120%);display:flex;align-items:center;justify-content:center;padding:32px;opacity:0;transition:opacity .22s cubic-bezier(0.4,0,0.2,1)';
  let html='<div id="cheatPalette" style="width:720px;max-width:100%;max-height:84vh;background:var(--card);border-radius:16px;box-shadow:0 32px 80px rgba(0,0,0,0.32),0 0 0 1px rgba(255,255,255,0.08) inset;overflow:hidden;display:flex;flex-direction:column;transform:translateY(12px) scale(0.96);transition:transform .28s cubic-bezier(0.34,1.32,0.64,1)">';
  html+='<div style="padding:18px 24px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:12px"><span style="font-size:22px">⌨</span><div style="flex:1"><div style="font-size:15px;font-weight:800;color:var(--t1)">키보드 단축키</div><div style="font-size:11px;color:var(--t3);margin-top:2px">오렌지톡 단축키 모음</div></div><button id="cheatCloseBtn" style="background:none;border:none;font-size:18px;color:var(--t3);cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .12s">✕</button></div>';
  html+='<div style="flex:1;overflow-y:auto;padding:16px 24px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 28px">';
  _cheatGroups.forEach(function(g){
    html+='<div style="break-inside:avoid"><div style="font-size:11px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.6px;padding:6px 0 10px;border-bottom:1px solid var(--bdr);margin-bottom:8px">'+_cheatEsc(g.title)+'</div>';
    g.items.forEach(function(it){
      html+='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;font-size:12px"><span style="color:var(--t2)">'+_cheatEsc(it.desc)+'</span><span style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0">';
      it.keys.forEach(function(k,i){if(i>0)html+='<span style="color:var(--t3);font-size:10px">+</span>';html+='<kbd style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;background:var(--bg2);border:1px solid var(--bdr);border-radius:5px;font-size:10px;font-family:var(--fm);font-weight:600;color:var(--t1);box-shadow:0 1px 0 var(--bdr)">'+_cheatEsc(k)+'</kbd>';});
      html+='</span></div>';
    });
    html+='</div>';
  });
  html+='</div></div>';
  html+='<div style="padding:12px 24px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--t3)"><span>입력 필드에 포커스 중일 때는 일부 단축키가 비활성화됩니다.</span><span>다시 열기: <kbd style="background:var(--card);padding:1px 5px;border-radius:3px;font-family:var(--fm);border:1px solid var(--bdr);font-size:9px">?</kbd></span></div>';
  html+='</div>';
  ov.innerHTML=html;
  document.body.appendChild(ov);
  const closeBtn=document.getElementById('cheatCloseBtn');
  if(closeBtn){closeBtn.addEventListener('click',_cheatClose);closeBtn.addEventListener('mouseenter',function(){this.style.background='var(--bg2)';});closeBtn.addEventListener('mouseleave',function(){this.style.background='transparent';});}
  requestAnimationFrame(function(){ov.style.opacity='1';const p=document.getElementById('cheatPalette');if(p)p.style.transform='translateY(0) scale(1)';});
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_cheatClose();});
  document.addEventListener('keydown',_cheatEscListener,true);
}
function _cheatEscListener(e){if(e.key==='Escape'&&document.getElementById('shortcutCheatsheetOverlay')){e.preventDefault();_cheatClose();}}
function _cheatClose(){const ov=document.getElementById('shortcutCheatsheetOverlay');if(!ov)return;ov.style.opacity='0';const p=document.getElementById('cheatPalette');if(p)p.style.transform='translateY(12px) scale(0.96)';document.removeEventListener('keydown',_cheatEscListener,true);setTimeout(function(){if(ov.parentNode)ov.remove();},240);}
export { showShortcutCheatsheet };

/* ═══════════════════════════════════════
   GLOBAL SHORTCUTS (global-shortcuts.js에서 통합)
   ═══════════════════════════════════════ */
function _gsFindSearchInput(){
  const candidates=['#sideSearch','#dailySearchInput','#ecSearchInput','#infSearchInput','input[type="search"]','input[placeholder*="검색"]','input[placeholder*="찾기"]','input[placeholder*="🔍"]'];
  for(let i=0;i<candidates.length;i++){const els=document.querySelectorAll(candidates[i]);for(let j=0;j<els.length;j++){const el=els[j];const rect=el.getBoundingClientRect();if(rect.width>0&&rect.height>0&&el.offsetParent)return el;}}
  return null;
}
function _gsFindAddButton(){
  const modal=document.querySelector('.modal-overlay.show, .sv-modal-overlay');
  const scope=modal||document;
  const candidates=['button[title*="추가"]','button[title*="신규"]','button[onclick*="openAdvancedSearch"]','.btn-add','button:not([disabled])'];
  for(let i=0;i<candidates.length;i++){const els=scope.querySelectorAll(candidates[i]);for(let j=0;j<els.length;j++){const el=els[j];if(!el.offsetParent)continue;const text=(el.textContent||'').trim();if(text.indexOf('추가')!==-1||text.indexOf('+')===0||text.indexOf('신규')!==-1||text.indexOf('등록')!==-1)return el;}}
  return null;
}
function _gsFindTopModal(){
  const modals=Array.prototype.slice.call(document.querySelectorAll('.modal-overlay.show, .sv-modal-overlay, [id$="Overlay"]')).filter(function(m){if(!m||!m.isConnected)return false;const st=getComputedStyle(m);return st.display!=='none'&&st.visibility!=='hidden';});
  if(!modals.length)return null;
  return modals.reduce(function(a,b){return(parseInt(getComputedStyle(b).zIndex)||0)>(parseInt(getComputedStyle(a).zIndex)||0)?b:a;});
}
function _gsFindPrimaryBtn(modal){
  if(!modal)return null;
  let el=modal.querySelector('.btn-primary:not([disabled])');if(el&&el.offsetParent)return el;
  el=modal.querySelector('button[type="submit"]:not([disabled])');if(el&&el.offsetParent)return el;
  const btns=modal.querySelectorAll('button:not([disabled])');
  for(let j=0;j<btns.length;j++){const t=(btns[j].textContent||'').trim();if(/^(확인|저장|등록|추가|적용|OK|Save)$/.test(t))return btns[j];}
  return null;
}
function _gsTriggerSave(){
  try{saveData();}catch(e){}
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='💾 저장됨';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2000);}
  else{bus.emit('toast:show',{text:'💾 저장됨'});}
}
document.addEventListener('keydown',function(e){
  const mod=e.metaKey||e.ctrlKey;
  if(!mod&&e.key!=='F1')return;
  const ae=document.activeElement;
  const inInput=ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.isContentEditable||ae.contentEditable==='true');
  const key=e.key.toLowerCase();
  if(e.key==='F1'){e.preventDefault();showShortcutCheatsheet();return;}
  if(mod&&!e.shiftKey&&!e.altKey&&key==='f'){const inp=_gsFindSearchInput();if(inp){e.preventDefault();inp.focus();if(inp.select)try{inp.select();}catch(_){}return;}}
  if(mod&&!e.shiftKey&&!e.altKey&&key==='n'&&!inInput){const btn=_gsFindAddButton();if(btn){e.preventDefault();btn.click();return;}}
  if(mod&&!e.shiftKey&&!e.altKey&&key==='w'){const topM=_gsFindTopModal();if(topM){e.preventDefault();if(topM.classList.contains('show')&&topM.classList.contains('modal-overlay'))topM.classList.remove('show');else topM.remove();return;}}
  if(mod&&!e.shiftKey&&!e.altKey&&key==='s'){e.preventDefault();_gsTriggerSave();return;}
  if(mod&&e.key==='Enter'){const topM2=_gsFindTopModal();if(topM2){const primary=_gsFindPrimaryBtn(topM2);if(primary){e.preventDefault();primary.click();return;}}}
  if(mod&&e.key==='/'){if(inInput)return;e.preventDefault();showShortcutCheatsheet();return;}
});

/* ═══════════════════════════════════════
   KEYBOARD NAVIGATION (keyboard-navigation.js에서 통합)
   ═══════════════════════════════════════ */
let _kbSeen=false;
try{_kbSeen=localStorage.getItem('ec_kb_nav_hint_seen')==='1';}catch(e){}
document.addEventListener('keydown',function(e){
  if(e.key==='Tab'&&!document.body.classList.contains('kb-nav')){document.body.classList.add('kb-nav');_kbMaybeShowHint();}
},true);
document.addEventListener('mousedown',function(){document.body.classList.remove('kb-nav');},true);
document.addEventListener('pointerdown',function(){document.body.classList.remove('kb-nav');},true);
function _kbMaybeShowHint(){
  if(_kbSeen)return;_kbSeen=true;
  try{localStorage.setItem('ec_kb_nav_hint_seen','1');}catch(e){}
  const hint=document.createElement('div');hint.className='kb-nav-hint';
  hint.innerHTML='⌨ <span>키보드 네비게이션 활성화</span> · <kbd style="background:var(--bg2);padding:1px 6px;border-radius:3px;font-family:var(--fm);font-size:10px">Tab</kbd> 다음 · <kbd style="background:var(--bg2);padding:1px 6px;border-radius:3px;font-family:var(--fm);font-size:10px">⇧+Tab</kbd> 이전 · <kbd style="background:var(--bg2);padding:1px 6px;border-radius:3px;font-family:var(--fm);font-size:10px">Esc</kbd> 해제';
  document.body.appendChild(hint);
  requestAnimationFrame(function(){hint.classList.add('show');});
  setTimeout(function(){hint.classList.remove('show');setTimeout(function(){if(hint.parentNode)hint.remove();},300);},4500);
}
function _kbFindTopModal(){
  const modals=Array.prototype.slice.call(document.querySelectorAll('.modal-overlay.show, .sv-modal-overlay, [id$="Overlay"]')).filter(function(m){if(!m||!m.isConnected)return false;const st=getComputedStyle(m);return st.display!=='none'&&st.visibility!=='hidden';});
  if(!modals.length)return null;
  return modals.reduce(function(a,b){return(parseInt(getComputedStyle(b).zIndex)||0)>(parseInt(getComputedStyle(a).zIndex)||0)?b:a;});
}
function _kbGetFocusable(root){
  if(!root)return[];
  const sel='a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  return Array.prototype.slice.call(root.querySelectorAll(sel)).filter(function(el){if(el.offsetWidth===0&&el.offsetHeight===0)return false;const st=getComputedStyle(el);return st.visibility!=='hidden'&&st.display!=='none';});
}
document.addEventListener('keydown',function(e){
  if(e.key!=='Tab')return;
  const modal=_kbFindTopModal();if(!modal)return;
  const focusables=_kbGetFocusable(modal);if(focusables.length===0)return;
  const first=focusables[0], last=focusables[focusables.length-1];
  const ae=document.activeElement;
  if(!modal.contains(ae)){e.preventDefault();first.focus();return;}
  if(e.shiftKey&&ae===first){e.preventDefault();last.focus();return;}
  if(!e.shiftKey&&ae===last){e.preventDefault();first.focus();return;}
},true);

