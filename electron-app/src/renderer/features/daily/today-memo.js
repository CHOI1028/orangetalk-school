/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   오늘의 메모 — 일반 일지 상단 토글 + 가로 아코디언 (2행 N칸 표)
   ───────────────────────────────────────
   · 토글(📝 오늘의 메모, 약품 검색 오른편): OFF 회색 / ON 연두. ON 시 아코디언 표시.
   · 아코디언(가로 전체 폭): 기본 접힘. 펼치면 2층=제목(회색)·1층=입력란(흰색) 표.
   · 톱니(⚙): 칸 수 3~5 + 제목 수정 — 팝오버는 열림/닫힘 애니메이션 (사용자 요청 2026-06-10).
   · 저장: 칸 내용 = 메인 DB today_memos 테이블 (v4, 2026-06-10) — 백업·복원·웹 협업 자동 동행.
          { 'YYYY-MM-DD': [c0..c4] } 캐시 + dirty 날짜 단위 todayMemoSet (디바운스+blur+beforeunload).
          레거시 common JSON(today_memo.json) 은 첫 로드 때 1회 DB 이전.
          설정(on/cols/titles) = localStorage 'ec_today_memo_settings'
          + data-loader commonMappings + custom-backup-keys 등록 (업데이트·학교이동 보존).
   · 일지 출력 "매일 한 페이지" 선택 시 그 날짜 메모가 함께 인쇄됨 — tmGetPrintBlock() 제공.
   ═══════════════════════════════════════ */
'use strict';
import { S } from '../../core/app-state.js';
import { bus } from '../../core/event-bus.js';

const LS_KEY = 'ec_today_memo_settings';
const DATA_KEY = 'today_memo';
const MAX_COLS = 5;
const DEFAULT_TITLES = ['오늘의 업무', '오늘의 수업', '오늘의 행사', '병원 이송', '메모'];

let _set = null;          /* {on, cols, titles[]} */
let _data = null;         /* { 'YYYY-MM-DD': ['','','','',''] } */
let _loadPromise = null;
let _open = false;        /* 아코디언 펼침 상태 (세션 한정 — 기본 접힘) */
let _renderedDate = '';
let _saveTimer = null;

function _esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

/* 아코디언이 열리고 닫힐 때 표 높이 재계산 — adjustPanelHeights(emergency-view)가
 * dailyTableWrap.maxHeight 를 footer 기준 px 로 박아두므로, 메모로 표 시작점(top)이
 * 내려가면 마지막 행이 footer 아래로 잘림. window resize 디스패치로 기존 리스너를
 * 재사용해 재계산 (직접 import 시 순환 의존 위험 회피). 사용자 보고 2026-06-10. */
let _adjTimer = null;
function _adjustHeightsSoon(){
  clearTimeout(_adjTimer);
  _adjTimer = setTimeout(function(){ try{ window.dispatchEvent(new Event('resize')); }catch(_){} }, 120);
}

/* ── 설정 ── */
function _settings(){
  if(_set) return _set;
  try{ _set = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }catch(_){ _set = null; }
  if(!_set || typeof _set !== 'object') _set = { on:false, cols:4, titles: DEFAULT_TITLES.slice(0,4) };
  if(!Array.isArray(_set.titles)) _set.titles = DEFAULT_TITLES.slice(0,4);
  _set.cols = (_set.cols >= 3 && _set.cols <= MAX_COLS) ? _set.cols : 4;
  _set.on = !!_set.on;
  return _set;
}
function _saveSettings(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(_set)); }catch(_){}
  /* DB blob write-through — 부팅 로드(app-data-bridge)가 dbGet(blob) 우선이라 함께 갱신해야 재시작 후 유지 (2026-06-11 fix) */
  try{ if(window.electronAPI&&window.electronAPI.dbSet) window.electronAPI.dbSet('common','today_memo_settings',_set); }catch(_){}
}

/* ── 칸 내용 (날짜별) ──
 *  저장소: 메인 DB today_memos 테이블 (v4, 2026-06-10) — 백업·복원·웹 협업 자동 동행.
 *  레거시: 2026-06-10 이전 빌드가 쓰던 common JSON(today_memo.json)에 내용이 남아 있으면
 *  첫 로드 때 1회 DB 로 이전(DB 우선·중복 안 덮음)하고 JSON 은 빈 객체로 비워 재이전을 막는다. */
const _dirtyDates = new Set();   /* 입력이 발생해 DB 반영이 필요한 날짜들 */
function _api(){ return (typeof window !== 'undefined' && window.electronAPI) || null; }
function _loadData(){
  if(_data) return Promise.resolve(_data);
  if(_loadPromise) return _loadPromise;
  const api = _api();
  const dbLoad = (api && api.todayMemoGetAll) ? api.todayMemoGetAll() : Promise.resolve(null);
  _loadPromise = Promise.resolve(dbLoad)
    .then(function(r){
      _data = (r && r.success && r.data && typeof r.data === 'object' && !Array.isArray(r.data)) ? r.data : {};
      /* 레거시 JSON → DB 1회 이전 */
      if(api && api.jsonLoadCommon){
        return api.jsonLoadCommon(DATA_KEY).then(function(lr){
          const legacy = (lr && lr.success && lr.data && typeof lr.data === 'object' && !Array.isArray(lr.data)) ? lr.data : null;
          if(legacy && Object.keys(legacy).length){
            let moved = 0;
            Object.keys(legacy).forEach(function(d){
              if(_data[d]) return;                                   /* DB 에 이미 있으면 DB 우선 */
              const a = legacy[d];
              if(!Array.isArray(a) || !a.some(function(v){ return String(v||'').trim(); })) return;
              _data[d] = a.map(function(v){ return String(v == null ? '' : v); });
              _dirtyDates.add(d); moved++;
            });
            if(moved) _flushSave();
            /* 이전 완료 — JSON 비워 다음 부팅 때 재이전 방지 (실패해도 DB 우선 규칙이라 무해) */
            try{ if(api.jsonSaveCommon) api.jsonSaveCommon(DATA_KEY, {}); }catch(_){}
          }
          return _data;
        }).catch(function(){ return _data; });
      }
      return _data;
    })
    .catch(function(){ _data = {}; return _data; });
  return _loadPromise;
}
function _cells(date){
  if(!_data) return ['','','','',''];
  let a = _data[date];
  if(!Array.isArray(a)){ a = ['','','','','']; _data[date] = a; }
  while(a.length < MAX_COLS) a.push('');
  return a;
}
function _scheduleSave(){ clearTimeout(_saveTimer); _saveTimer = setTimeout(_flushSave, 600); }
function _flushSave(){
  clearTimeout(_saveTimer); _saveTimer = null;
  if(!_data) return;
  const api = _api();
  if(api && api.todayMemoSet){
    /* DB 모드 — dirty 날짜만 upsert (빈 칸 전부면 서버가 행 삭제) */
    const dates = Array.from(_dirtyDates); _dirtyDates.clear();
    dates.forEach(function(d){
      const a = _data[d];
      const empty = !Array.isArray(a) || a.every(function(v){ return !String(v||'').trim(); });
      if(empty) delete _data[d];
      try{ api.todayMemoSet(d, empty ? [] : a); }catch(_){}
    });
  } else if(api && api.jsonSaveCommon){
    /* 폴백 (todayMemoSet 미지원 구버전 브리지) — 옛 방식 전체 맵 저장 */
    _dirtyDates.clear();
    try{ Object.keys(_data).forEach(function(d){ const a = _data[d]; if(Array.isArray(a) && a.every(function(v){ return !String(v||'').trim(); })) delete _data[d]; }); }catch(_){}
    try{ api.jsonSaveCommon(DATA_KEY, _data); }catch(_){}
  }
}
window.addEventListener('beforeunload', _flushSave);

/* ── 인쇄용 (diary-print 일 단위 "매일 한 페이지") ──
 *  토글 ON 이면 표 HTML 반환 — 내용이 없어도 빈 칸 양식 그대로 (사용자 결정 2026-06-10). OFF 면 ''.
 *  비동기 로드가 안 끝났으면 '' (print 직전 tmEnsureLoaded() 로 선로드 권장). */
export function tmEnsureLoaded(){ return _loadData(); }
/* Excel 내보내기용 — 토글 ON 이면 {titles, cells} 반환 (빈 칸 포함, 양식 그대로). OFF 면 null. (2026-06-11) */
export function tmGetMemoForExport(date){
  const st = _settings();
  if(!st.on) return null;
  const arr = (_data && Array.isArray(_data[date])) ? _data[date] : [];
  const titles = [], cells = [];
  for(let i = 0; i < st.cols; i++){
    titles.push(st.titles[i] || DEFAULT_TITLES[i] || ('칸 ' + (i+1)));
    cells.push(String(arr[i] || ''));
  }
  return { titles: titles, cells: cells };
}
export function tmGetPrintBlock(date){
  const st = _settings();
  if(!st.on) return '';
  /* 내용이 없어도 빈 칸 그대로 표를 출력 — 양식으로서 항상 표시 (사용자 결정 2026-06-10).
   * 토글(오늘의 메모 기능) OFF 또는 출력 옵션 OFF 일 때만 생략. */
  const arr = (_data && Array.isArray(_data[date])) ? _data[date] : [];
  let ths = '', tds = '';
  for(let i = 0; i < st.cols; i++){
    ths += '<th style="background:#eef2f6;color:#475569;font-size:11pt;font-weight:700;padding:5px 8px;border:1px solid #cbd5e1;text-align:center">' + _esc(st.titles[i] || DEFAULT_TITLES[i] || ('칸 ' + (i+1))) + '</th>';
    /* contenteditable + data 식별자 — 미리보기에서 직접 클릭·수정 가능 (사용자 요청 2026-06-11).
     * 수정은 아래 전역 input 위임이 DB(today_memos)와 일반 일지 아코디언에 즉시 동기화.
     * PDF 인쇄 시 contenteditable 속성은 시각 영향 0. */
    tds += '<td contenteditable="true" data-tm-date="' + _esc(date) + '" data-tm-i="' + i + '" style="background:#fff;border:1px solid #cbd5e1;padding:6px 8px;font-size:11pt;line-height:1.6;vertical-align:top;white-space:pre-wrap;word-break:break-all;color:#0f172a;outline:none">' + _esc(arr[i] || '') + '</td>';
  }
  return '<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:6px 0 10px"><tr>' + ths + '</tr><tr style="height:52px">' + tds + '</tr></table>';
}

/* ── 1회 주입 스타일 (contenteditable placeholder 등 — 인라인 불가 항목만) ── */
function _ensureStyle(){
  if(document.getElementById('tmMemoStyle')) return;
  const st = document.createElement('style');
  st.id = 'tmMemoStyle';
  st.textContent =
    /* placeholder("내용을 입력하세요...") 제거 — 빈 칸은 그냥 빈 흰칸 (사용자 결정 2026-06-10) */
    '#dailyTodayMemo .tm-cell:focus{background:rgba(132,204,22,0.05);outline:none}' +
    '#dailyTodayMemo .tm-head:hover{background:rgba(132,204,22,0.14)}' +
    '#tmGearPop input[type=text]:focus{border-color:#84cc16;outline:none}';
  document.head.appendChild(st);
}

/* ── 토글 버튼 색 ── */
function _paintToggle(btn, on){
  btn.style.background = on ? 'rgba(132,204,22,0.16)' : 'rgba(148,163,184,0.12)';
  btn.style.color = on ? '#4d7c0f' : '#64748b';
  btn.style.border = on ? '1px solid rgba(132,204,22,0.5)' : '1px solid rgba(148,163,184,0.35)';
}

/* ── 아코디언 골격 ── */
function _ensureBox(box){
  if(box._tmBuilt) return;
  box._tmBuilt = true;
  _ensureStyle();
  box.innerHTML =
    '<div class="tm-head" id="tmHead" style="display:flex;align-items:center;gap:8px;width:100%;background:rgba(132,204,22,0.08);border:1px solid rgba(132,204,22,0.4);border-radius:8px;padding:6px 12px;cursor:pointer;user-select:none;font-weight:700;color:#4d7c0f;font-size:12px;box-sizing:border-box;transition:background .15s">'
      + '<span id="tmChevron" style="font-size:10px;display:inline-block;transition:transform .18s">▶</span>'
      + '<span id="tmHeadLabel">📝 오늘의 메모: 클릭하여 펼치기 (보건일지 출력 시 \'매일 한 페이지\'로 선택하면 함께 출력이 가능합니다.)</span>'
      + '<button id="tmGearBtn" data-tooltip="메모 헤더 열의 갯수, 각 열의 제목을 정합니다." style="margin-left:auto;border:1px solid var(--bdr);background:var(--card);border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;line-height:1;color:var(--t2);font-family:var(--f)">⚙</button>'
    + '</div>'
    + '<div id="tmBody" style="display:none;border:1px solid var(--bdr);border-top:none;border-radius:0 0 10px 10px;overflow:hidden;opacity:0;transform:translateY(-4px);transition:opacity .18s ease, transform .2s cubic-bezier(0.16,1,0.3,1)">'
      + '<table id="tmGrid" style="width:100%;border-collapse:collapse;table-layout:fixed"></table>'
    + '</div>';
  /* 톱니 미니팝업 — 표준 showHeaderTooltip(테두리 자동 맞춤). 동적 생성이라 공용 data-tooltip 바인딩이 안 닿으므로 직접 부착.
   *  순환 import 회피를 위해 emergency-view 는 동적 import(호버 시 이미 로드돼 있어 지연 없음). (사용자 보고 2026-06-17) */
  const _gear = box.querySelector('#tmGearBtn');
  if(_gear){
    _gear.addEventListener('mouseenter', function(e){
      import('../emergency/emergency-view.js').then(function(m){ try{ m.showHeaderTooltip(e, _gear.getAttribute('data-tooltip')); }catch(_){} });
    });
    _gear.addEventListener('mouseleave', function(){
      import('../emergency/emergency-view.js').then(function(m){ try{ m.hideHeaderTooltip(); }catch(_){} });
    });
  }
}

/* ── 표 렌더 — 2층 제목(회색) + 1층 입력(흰색) ── */
function _renderGrid(){
  const grid = document.getElementById('tmGrid');
  if(!grid) return;
  const st = _settings();
  const date = S.selectedDate;
  _loadData().then(function(){
    /* 비동기 사이 날짜가 바뀌었으면 최신 호출이 다시 그린다 */
    if(S.selectedDate !== date) return;
    const arr = _cells(date);
    let ths = '', tds = '';
    for(let i = 0; i < st.cols; i++){
      const t = st.titles[i] || DEFAULT_TITLES[i] || ('칸 ' + (i+1));
      ths += '<th style="background:var(--bg2);color:var(--t2);font-size:11.5px;font-weight:700;padding:7px 10px;border:1px solid var(--bdr);border-top:none;text-align:center">' + _esc(t) + '</th>';
      /* 오늘의 메모 영역 최대 높이 제한 + 스크롤 (사용자 요청 2026-06-12. 긴 입력도 일지표 밀리지 않게) */
      tds += '<td style="background:var(--card);border:1px solid var(--bdr);border-bottom:none;padding:0;vertical-align:top">'
        + '<div class="tm-cell" contenteditable="true" data-i="' + i + '" style="width:100%;min-height:74px;max-height:240px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--cyan) transparent;padding:8px 10px;font-size:12px;line-height:1.6;font-family:var(--f);color:var(--t1);white-space:pre-wrap;word-break:break-all;box-sizing:border-box">' + _esc(arr[i] || '') + '</div>'
        + '</td>';
    }
    grid.innerHTML = '<tr>' + ths + '</tr><tr>' + tds + '</tr>';
    _renderedDate = date;
  });
}

function _setOpen(open){
  const body = document.getElementById('tmBody');
  const chev = document.getElementById('tmChevron');
  const label = document.getElementById('tmHeadLabel');
  if(!body) return;
  _open = open;
  if(chev) chev.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
  if(label) label.textContent = '📝 오늘의 메모: 클릭하여 ' + (open ? '접기' : '펼치기') + ' (보건일지 출력 시 \'매일 한 페이지\'로 선택하면 함께 출력이 가능합니다.)';
  const head = document.getElementById('tmHead');
  if(head) head.style.borderRadius = open ? '8px 8px 0 0' : '8px';
  if(open){
    _renderGrid();
    body.style.display = 'block';
    requestAnimationFrame(function(){ body.style.opacity = '1'; body.style.transform = 'translateY(0)'; });
    _adjustHeightsSoon();   /* 표 maxHeight 재계산 — 마지막 행 잘림 방지 */
  } else {
    body.style.opacity = '0'; body.style.transform = 'translateY(-4px)';
    setTimeout(function(){ if(!_open) body.style.display = 'none'; _adjustHeightsSoon(); }, 200);
  }
}

/* ── 공개 sync — 날짜 변경(updateDailyDateLabel)·render:daily 마다 호출 ── */
export function tmSyncDailyMemo(){
  const btn = document.getElementById('dailyTodayMemoBtn');
  const box = document.getElementById('dailyTodayMemo');
  if(!btn || !box) return;
  const st = _settings();
  _paintToggle(btn, st.on);
  const _prevDisp = box.style.display;
  box.style.display = st.on ? 'block' : 'none';
  if(box.style.display !== _prevDisp) _adjustHeightsSoon();   /* 토글 ON/OFF 로 표 시작점 변동 → 높이 재계산 */
  if(st.on){
    _ensureBox(box);
    if(_open && _renderedDate !== S.selectedDate) _renderGrid();
  }
}

/* ── 톱니 설정 팝오버 (열림/닫힘 애니메이션 — 사용자 요청) ── */
let _gearDraft = null;
function _closeGearPop(){
  const pop = document.getElementById('tmGearPop');
  if(!pop) return;
  pop.style.opacity = '0';
  pop.style.transform = 'translateY(-6px) scale(0.98)';
  setTimeout(function(){ if(pop.parentNode) pop.parentNode.removeChild(pop); }, 190);
}
function _renderGearTitles(pop){
  const box = pop.querySelector('#tmTitleRows');
  let h = '';
  for(let i = 0; i < _gearDraft.cols; i++){
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;font-size:12px">'
      + '<label style="width:56px;color:var(--t2);font-weight:700;font-size:11.5px;flex-shrink:0">' + (i+1) + '열 제목</label>'
      + '<input type="text" data-ti="' + i + '" value="' + _esc(_gearDraft.titles[i] || DEFAULT_TITLES[i] || ('칸 ' + (i+1))) + '" style="flex:1;border:1px solid var(--bdr);border-radius:6px;padding:6px 9px;font-size:12px;font-family:var(--f);background:var(--card);color:var(--t1)">'
      + '</div>';
  }
  box.innerHTML = h;
  box.querySelectorAll('input').forEach(function(inp){
    inp.addEventListener('input', function(){
      const i = +inp.dataset.ti;
      _gearDraft.titles[i] = inp.value;
      /* 즉시 저장 + 표 2층 제목 실시간 반영 (사용자 요청 2026-06-10) */
      const st = _settings();
      st.titles[i] = inp.value;
      _saveSettings();
      const grid = document.getElementById('tmGrid');
      if(grid){
        const th = grid.querySelectorAll('tr:first-child th')[i];
        if(th) th.textContent = inp.value || DEFAULT_TITLES[i] || ('칸 ' + (i+1));
      }
    });
  });
}
function _openGearPop(anchorBtn){
  if(document.getElementById('tmGearPop')){ _closeGearPop(); return; }
  /* 라이브 반영이 보이도록 — 아코디언이 접혀 있으면 먼저 펼침 (사용자 요청 2026-06-10) */
  if(!_open) _setOpen(true);
  const st = _settings();
  _gearDraft = { cols: st.cols, titles: st.titles.slice() };
  const pop = document.createElement('div');
  pop.id = 'tmGearPop';
  const r = anchorBtn.getBoundingClientRect();
  pop.style.cssText = 'position:fixed;z-index:12000;width:330px;background:var(--card);border:1px solid var(--bdr);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,0.25);overflow:hidden;'
    + 'top:' + (r.bottom + 6) + 'px;'
    + 'opacity:0;transform:translateY(-6px) scale(0.98);transition:opacity .16s ease, transform .18s cubic-bezier(0.16,1,0.3,1)';
  let segBtns = '';
  [3,4,5].forEach(function(n){
    segBtns += '<button data-tmcol="' + n + '" style="border:1px solid ' + (n === st.cols ? 'rgba(132,204,22,0.5)' : 'var(--bdr)') + ';background:' + (n === st.cols ? 'rgba(132,204,22,0.16)' : 'var(--bg2)') + ';color:' + (n === st.cols ? '#4d7c0f' : 'var(--t2)') + ';border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">' + n + '칸</button>';
  });
  pop.innerHTML =
    '<div style="padding:10px 16px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:12.5px;font-weight:800;color:var(--t1)">⚙ 오늘의 메모 설정</div>'
    + '<div style="padding:12px 16px">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:11px;font-size:12px">'
        + '<label style="width:56px;color:var(--t2);font-weight:700;font-size:11.5px;flex-shrink:0">칸 수</label>'
        + '<div id="tmColSeg" style="display:flex;gap:4px">' + segBtns + '</div>'
        + '<span style="font-size:10.5px;color:var(--t3)">행은 2행 고정</span>'
      + '</div>'
      + '<div id="tmTitleRows"></div>'
    + '</div>'
    /* 완료 버튼 제거 — 자동 저장이므로 불필요 (사용자 요청 2026-06-10). 닫기는 외부 클릭. */
    + '<div style="padding:9px 16px;border-top:1px solid var(--bdr)">'
      + '<span style="font-size:10.5px;color:var(--t3)">수정 즉시 저장·반영됩니다. 이 팝업 밖을 클릭하면 닫힙니다.</span>'
    + '</div>';
  document.body.appendChild(pop);
  /* 우측 정렬 — 화면 밖 방지 */
  const left = Math.max(8, Math.min(r.right - 330, window.innerWidth - 338));
  pop.style.left = left + 'px';
  _renderGearTitles(pop);
  requestAnimationFrame(function(){ pop.style.opacity = '1'; pop.style.transform = 'translateY(0) scale(1)'; });

  pop.querySelector('#tmColSeg').addEventListener('click', function(e){
    const b = e.target.closest('button[data-tmcol]'); if(!b) return;
    _gearDraft.cols = +b.dataset.tmcol;
    pop.querySelectorAll('#tmColSeg button').forEach(function(x){
      const sel = +x.dataset.tmcol === _gearDraft.cols;
      x.style.border = '1px solid ' + (sel ? 'rgba(132,204,22,0.5)' : 'var(--bdr)');
      x.style.background = sel ? 'rgba(132,204,22,0.16)' : 'var(--bg2)';
      x.style.color = sel ? '#4d7c0f' : 'var(--t2)';
    });
    _renderGearTitles(pop);
    /* 칸 수도 즉시 저장·반영 (사용자 요청 2026-06-10 — 라이브 적용) */
    const st = _settings();
    st.cols = _gearDraft.cols;
    _saveSettings();
    _renderGrid();
    _adjustHeightsSoon();
  });
}

/* ── 이벤트 위임 (1회 — fragment 로딩 타이밍과 무관) ── */
document.addEventListener('click', function(e){
  const toggle = e.target.closest('#dailyTodayMemoBtn');
  if(toggle){
    const st = _settings();
    st.on = !st.on;
    _saveSettings();
    if(!st.on){ _open = false; const body = document.getElementById('tmBody'); if(body){ body.style.display = 'none'; body.style.opacity = '0'; } const ch = document.getElementById('tmChevron'); if(ch) ch.style.transform = 'rotate(0deg)'; _closeGearPop(); }
    tmSyncDailyMemo();
    return;
  }
  const gear = e.target.closest('#tmGearBtn');
  if(gear){ e.stopPropagation(); _openGearPop(gear); return; }
  const head = e.target.closest('#tmHead');
  if(head){ _setOpen(!_open); return; }
  /* 팝오버 외부 클릭 → 닫기 (애니메이션) */
  if(document.getElementById('tmGearPop') && !e.target.closest('#tmGearPop')) _closeGearPop();
});
document.addEventListener('input', function(e){
  const cell = e.target.closest && e.target.closest('#dailyTodayMemo .tm-cell');
  if(cell && _data){
    _cells(S.selectedDate)[+cell.dataset.i] = cell.innerText;
    _dirtyDates.add(S.selectedDate);   /* DB 반영 대상 날짜 표시 */
    _scheduleSave();
    _adjustHeightsSoon();   /* 여러 줄 입력으로 메모 표가 커지면 일지 표 높이 재계산 */
    /* 역방향: 일지 출력 미리보기가 열려 있으면 그쪽 셀도 실시간 갱신 */
    const pv = document.querySelector('#dpPreviewArea [data-tm-date="' + S.selectedDate + '"][data-tm-i="' + cell.dataset.i + '"]');
    if(pv && pv !== document.activeElement) pv.innerText = cell.innerText;
    return;
  }
  /* 일지 출력 미리보기의 메모 셀 편집 (사용자 요청 2026-06-11) — DB + 일반 일지 즉시 동기화 */
  const pvCell = e.target.closest && e.target.closest('[data-tm-date]');
  if(pvCell && _data){
    const d = pvCell.getAttribute('data-tm-date');
    const i = +pvCell.getAttribute('data-tm-i');
    if(!d || !(i >= 0)) return;
    _cells(d)[i] = pvCell.innerText;
    _dirtyDates.add(d);
    _scheduleSave();
    /* 같은 날짜가 일반 일지 아코디언에 떠 있으면 그 칸도 실시간 갱신 (입력 중인 칸 제외) */
    if(d === S.selectedDate){
      const acc = document.querySelector('#dailyTodayMemo .tm-cell[data-i="' + i + '"]');
      if(acc && acc !== document.activeElement) acc.innerText = pvCell.innerText;
    }
  }
});
document.addEventListener('focusout', function(e){
  if(e.target && e.target.closest && (e.target.closest('#dailyTodayMemo .tm-cell') || e.target.closest('[data-tm-date]'))) _flushSave();
});

/* 초기/재렌더 동기화 */
bus.on('render:daily', function(){ try{ tmSyncDailyMemo(); }catch(_){} });
