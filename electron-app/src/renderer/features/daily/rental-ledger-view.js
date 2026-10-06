/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══ 보건실 물품 대여 대장 (rental-ledger-view.js) ═══ */
/* ES Module */
import { S } from '../../core/app-state.js';
import { getStu, escHtml, escJs, toDateStr, compareClass } from '../../core/helpers.js';
import { dailyShowToast } from './daily-view.js';
import { closeModalWithAnim, matchKorean, matchKoreanFromStart } from './daily-autocomplete.js';
import { _makeDraggable, _symPrompt } from '../symptom/symptom-view.js';
import { openClockPicker, showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { openAdvancedSearch } from '../settings/settings-view.js';
import { trOpenCal } from '../training/training-view.js';
import { openA4PrintDialog } from '../../core/a4-print-dialog.js';
import { appConfirmModal } from '../../core/ui-utils.js';
import { bus } from '../../core/event-bus.js';
'use strict';

/* ── State ── */
const _rlItems = JSON.parse(localStorage.getItem('ec_rental_items') || 'null') || [
  '핫팩','아이스팩','얼음팩','목발','휠체어','체온계','혈압계'
];
/* 핫팩·아이스팩은 기본 보장 — 키오스크 기본 흐름(대여/반납)이 참조하므로 기존 사용자 목록에 없으면 1회 보충 (사용자 지시 2026-06-13) */
['핫팩','아이스팩'].forEach(function(_must){
  if(_rlItems.indexOf(_must)===-1){ _rlItems.push(_must); try{ localStorage.setItem('ec_rental_items', JSON.stringify(_rlItems)); }catch(_){} }
});
let _rlRecords = JSON.parse(localStorage.getItem('ec_rental_records') || '[]');
let _rlSelected = null; /* 선택된 사람 {id,name,type,grade,cls,num,position} */
let _rlSelectedItem = '';
let _rlBorrowDate = '';
let _rlBorrowTime = '';
let _rlReturnDate = '';
let _rlReturnTime = '';
const _rlMsgDefault='이 학생이 조속히 반납할 수 있도록 언급 한 번 부탁드립니다.';
const _RL_MSG_UPGRADE_VER=4;
let _rlMsgTemplate = localStorage.getItem('ec_rental_msg') || _rlMsgDefault;
/* 버전 기반 강제 업그레이드 — 사용자가 어떻게 편집했든 v4 미만이면 한 번 새 기본값으로 초기화.
   이후 편집은 버전 태그가 현재와 같아 보존됨. */
const _rlMsgStoredVer = parseInt(localStorage.getItem('ec_rental_msg_ver')||'0',10);
if(_rlMsgStoredVer < _RL_MSG_UPGRADE_VER){
  _rlMsgTemplate = _rlMsgDefault;
  localStorage.setItem('ec_rental_msg', _rlMsgTemplate);
  localStorage.setItem('ec_rental_msg_ver', String(_RL_MSG_UPGRADE_VER));
}
const _rlMsgEditing = false;
/* 헤더는 항상 기본값 고정 — 이름 변경 불가 (사용자 요청 2026-07-01). 옛 커스텀(ec_rental_headers)은 무시. */
const _rlHeaders = {
  seq:'순', belong:'학년반(소속)', name:'성명', item:'대여물품',
  borrow:'대여일시', returnDue:'반납예정일시', done:'반납완료', returnAt:'반납일시'
};
function _rlSaveHeaders(){
  localStorage.setItem('ec_rental_headers',JSON.stringify(_rlHeaders));
}

function _rlSave(){
  localStorage.setItem('ec_rental_records', JSON.stringify(_rlRecords));
  localStorage.setItem('ec_rental_items', JSON.stringify(_rlItems));
  rentalRefreshLedgerBtn();
}

/* ── 반납 기간 경과(연체) 물품 존재 여부 ── */
/* checkUnreturnedItems(시작 안내 팝업)와 동일한 판정 기준 — returned 안됨 + 반납예정일시 지남 */
export function rentalHasOverdue(){
  return _rlRecords.some(_rlIsOverdue);
}
/* 단일 레코드 연체 판정 — 미반납 + 반납예정일시(returnDate[+returnTime]) 가 현재를 지남. 연체면 표에 빨간 글씨 (사용자 요청 2026-06-17) */
function _rlIsOverdue(r){
  if(!r || r.returned || !r.returnDate) return false;
  const due = new Date(r.returnDate + 'T' + (r.returnTime || '23:59'));
  return new Date() > due;
}
/* ── 일반일지 "📦 물품 대여 대장" 버튼 상태 갱신 ──
 * 연체 물품이 있으면 분홍색 + 안내 툴팁, 없으면 기본 상태로 복원.
 * _rlSave() 직후(대여/반납/삭제 모든 경로)와 daily 뷰 진입(render:daily) 때 호출. */
export function rentalRefreshLedgerBtn(){
  const btn = document.getElementById('dailyRentalLedgerBtn');
  if(!btn) return;
  /* 호버 시 data-tooltip(연체 안내 등)을 미니 팝업으로 표시 — 데일리 툴바는 전역 data-tooltip 위임이 없어 직접 바인딩 (사용자 요청 2026-07-01) */
  if(!btn._rlTipBound){
    btn._rlTipBound=true;
    btn.addEventListener('mouseenter',function(ev){ try{ const t=btn.getAttribute('data-tooltip'); if(t) showHeaderTooltip(ev,t,false,true); }catch(_){} });
    btn.addEventListener('mouseleave',function(){ try{ hideHeaderTooltip(); }catch(_){} });
  }
  if(rentalHasOverdue()){
    btn.style.background='rgba(236,72,153,0.14)';
    btn.style.borderColor='#ec4899';
    btn.style.color='#db2777';
    btn.setAttribute('data-tooltip','현재 반납 일시를 초과한 물품이 있습니다.');
  } else {
    btn.style.background='';
    btn.style.borderColor='';
    btn.style.color='';
    btn.setAttribute('data-tooltip','보건실 물품 대여를 관리합니다.');
  }
}
/* daily 뷰가 그려질 때마다 버튼 상태 반영 (모달 밖에서도 최신 상태 유지) */
bus.on('render:daily', rentalRefreshLedgerBtn);
/* 대여 물품(드롭다운) 변경 undo — 다른 물품 선택 후 Ctrl+Z 로 직전(드롭다운 열기 전) 물품값 복구 (사용자 요청 2026-07-01) */
let _rlItemUndo=null;
document.addEventListener('keydown', function(e){
  if(!(e.ctrlKey||e.metaKey) || String(e.key).toLowerCase()!=='z') return;
  if(!_rlItemUndo) return;
  if(!document.getElementById('rentalLedgerOverlay')) return;   /* 대여 대장 모달이 열려 있을 때만 */
  const ae=document.activeElement;
  if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.isContentEditable)) return;   /* 입력칸 편집 중이면 네이티브 undo 양보 */
  e.preventDefault();
  const u=_rlItemUndo; _rlItemUndo=null;
  const rec=_rlRecords.find(function(r){return r.id===u.recId;});
  if(rec){ rec.item=u.prevItem; _rlSave(); _rlRenderPreview(); _rlRenderLeft(); _rlShowSaveToast(); }
}, true);
/* 소속 표시 (미등록 학생 방어) — 학교급/학과 있으면 함께 표시 */
/* 전체 학생 중 존재하는 고유 학교급 개수 계산 (캐시) */
function _rlUniqueLevelCount(){
  const set={};
  (S.people||[]).forEach(function(p){
    if(p&&p.type==='student'&&p.level)set[String(p.level).trim()]=1;
  });
  return Object.keys(set).length;
}
function _rlBelong(s){
  if(!s||s._notFound)return '-';
  if(s.type==='staff')return s.position||'교직원';
  const _LV={elementary:'초',middle:'중',high:'고',kindergarten:'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  const lv=s.level?(_LV[s.level]||s.level):'';
  const dept=s.department?String(s.department).trim():'';
  const gc=(s.grade||'')+'학년 '+(s.cls||'')+'반';
  const parts=[];
  /* 학교급은 DB에 여러 학교급이 섞여 있을 때만 표시 */
  if(lv&&_rlUniqueLevelCount()>1)parts.push(lv);
  if(dept)parts.push(dept);
  parts.push(gc);
  return parts.join(' · ');
}
function _rlName(s){
  if(!s)return '-';
  if(s._notFound)return s.name||'(삭제됨)';
  return s.name||'-';
}
/* 날짜 포맷: YYYY-MM-DD HH:MM → YY.MM.DD. HH:MM */
function _rlFmtDt(date,time){
  /* 대여 대장 표시 포맷 — YY.MM.DD HH:MM (NEIS 생년월일과 달리 trailing dot 없음).
   * 사용자가 셀에 숫자만 입력해도(예: 2605141430) parser→_rlFmtDt 가 자동으로 이 포맷 적용. */
  if(!date)return '__.__.__ __:__';
  const p=date.split('-');
  const yy=p[0]?p[0].slice(-2):'__';
  const mm=p[1]||'__';
  const dd=p[2]||'__';
  return yy+'.'+mm+'.'+dd+' '+(time||'__:__');
}
/* 선택 인원 해제 */
function _rlClearSelected(){_rlSelected=null;_rlRenderLeft();}

/* ── 매년 3월 1일 초기화 ── */
/* _rlYearlyReset */
{
  const now = new Date();
  const resetKey = 'ec_rental_reset_' + now.getFullYear();
  if(now.getMonth() >= 2 && !localStorage.getItem(resetKey)){
    /* 3월 이후인데 올해 리셋 안됐으면 리셋 */
    const prev = _rlRecords.length;
    _rlRecords = [];
    _rlSave();
    localStorage.setItem(resetKey, '1');
  }
}

/* ── 미반납 물품 체크 (프로그램 시작 시) ── */
function checkUnreturnedItems(){
  if(localStorage.getItem('ec_rental_alert')==='false')return;
  const now = new Date();
  const unreturned = _rlRecords.filter(function(r){
    if(r.returned) return false;
    if(!r.returnDate)return false;
    const due = new Date(r.returnDate + 'T' + (r.returnTime || '23:59'));
    return now > due;
  });
  if(!unreturned.length) return;
  const msgs = unreturned.map(function(r){
    const s = getStu(r.personId);
    if(!s) return null;
    if(s.type === 'staff'){
      return (s.position||'교직원') + ' ' + s.name + ' — 물품: ' + r.item;
    }
    return s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+s.name + ' — 물품: ' + r.item;
  }).filter(Boolean);
  if(!msgs.length) return;

  const ov = document.createElement('div');
  ov.className = 'modal-overlay show';
  ov.style.zIndex = '12000';
  ov.innerHTML = '<div class="modal-content" style="width:500px;max-width:95vw;padding:0">'
    +'<div style="padding:14px 20px;background:var(--popup-head);border-bottom:1px solid var(--bdr);border-radius:12px 12px 0 0"><span style="font-size:15px;font-weight:800;color:var(--t1)">📦 미반납 물품 안내</span></div>'
    +'<div style="padding:20px"><div style="font-size:12px;color:var(--t2);line-height:2;margin-bottom:12px">반납되지 않은 물품이 있습니다.</div>'
    +'<div style="display:flex;flex-direction:column;gap:6px">'
    + msgs.map(function(m){
      return '<div style="padding:8px 12px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:8px;font-size:12px;color:var(--t1)">'+escHtml(m)+'</div>';
    }).join('')
    +'</div>'
    +'<div style="text-align:right;margin-top:16px"><button class="btn btn-primary btn-sm" data-action="goToRentalLedgerFromAlert">📦 물품 대여 대장 바로가기</button></div>'
    +'</div></div>';
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalWithAnim(ov);return;}
    const actionEl=e.target.closest('[data-action="goToRentalLedgerFromAlert"]');
    if(actionEl){_goToRentalLedgerFromAlert(actionEl);}
  });
  document.body.appendChild(ov);
}
/* 미반납 안내 팝업에서 대여 대장으로 바로 이동 */
function _goToRentalLedgerFromAlert(btn){
  const ov=btn.closest('.modal-overlay');
  if(ov)closeModalWithAnim(ov);
  setTimeout(function(){if(typeof openRentalLedger==='function')openRentalLedger();},180);
}


/* 특정 학생/교직원의 미반납(active) 대여 건수 조회 — symptom 팝업 chip 카운트 등 외부에서 사용.
 *  localStorage 에서 매번 신선하게 읽음 (모듈 캐시 _rlRecords 와 동기화 갭 방지). */

/* ── 메인 팝업 ──
 *  opts.prefilledVisitor : 학생/교직원 객체 — 팝업 열림과 동시에 _rlSelected 채움 (증상 모달에서 호출 시 사용).
 *  opts.onClose          : 팝업 닫힘(외부 클릭 등) 후 호출되는 콜백 — chip 카운트 갱신 등.
 */
export function openRentalLedger(opts){
  opts = opts || {};
  const existing = document.getElementById('rentalLedgerOverlay');
  if(existing){closeModalWithAnim(existing);return;}

  const now = new Date();
  /* prefilledVisitor 있으면 _rlSelected 미리 채움 — 검색창에 이름 자동 표시.
   *  record 는 자동 생성 X (사용자 결정 2026-05-27 — 반납하러 온 경우도 있어 클릭만으로 등록되면 안 됨).
   *  사용자가 물품 선택·일시 확인 후 명시적으로 등록 버튼 누를 때 record 추가. */
  if(opts.prefilledVisitor){
    const s = opts.prefilledVisitor;
    _rlSelected = {id:s.id, name:s.name, type:s.type, grade:s.grade, cls:s.cls, num:s.num, position:s.position};
  } else {
    _rlSelected = null;
  }
  _rlSelectedItem = '';
  /* 활성/선택 레코드 초기화 (사용자 제보 2026-06-12) — 모듈 전역이라 이전 팝업에서 등록·행선택한
   * 레코드 ID 가 세션 내내 남아, 새로 열고 물품을 클릭하면 옛 레코드의 물품명이 덮어써지던 버그. */
  _rlActiveRecId = null;
  _rlSelectedRecId = null;
  _rlBorrowDate = toDateStr(now);
  _rlBorrowTime = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const retH = now.getHours()+1;
  _rlReturnDate = toDateStr(now);
  _rlReturnTime = String(retH > 23 ? 23 : retH).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');

  const ov = document.createElement('div');
  ov.className = 'modal-overlay show';
  ov.id = 'rentalLedgerOverlay';
  ov.style.zIndex = '10500';

  ov.innerHTML = '<div class="modal-content" style="width:96vw;max-width:1400px;height:90vh;padding:0;overflow:hidden;display:flex;flex-direction:column">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid var(--glass-border);background:var(--popup-head);cursor:grab;flex-shrink:0"><span style="font-size:15px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">📦 보건실 물품 대여 대장</span></div>'
    +'<div style="display:flex;flex:1;min-height:0;overflow:hidden">'
    /* 왼쪽 패널: 입력 */
    +'<div style="width:360px;flex-shrink:0;background:var(--card);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;padding:14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain" id="rlLeftPanel"></div>'
    /* 하단 버튼 */
    +'<div style="flex-shrink:0;padding:10px 14px;border-top:1px solid var(--bdr);display:flex;flex-direction:column;gap:6px" id="rlBtnPanel"></div>'
    +'</div>'
    /* 오른쪽 패널: 미리보기 (인라인 테이블) */
    +'<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg)">'
    +'<div id="rlPreviewScroll" style="flex:1;overflow-y:auto;overflow-x:auto;padding:16px 20px;scrollbar-width:thin;-webkit-overflow-scrolling:touch;overscroll-behavior:contain">'
    +'<div id="rlPreviewWrap"></div>'
    +'</div></div>'
    +'</div></div>';

  ov.addEventListener('mousedown',function(e){
    if(e.target===ov){
      /* opts.onClose — 팝업 부드럽게 fade-out 끝난 후 호출. 증상 모달 chip 카운트 갱신 등에 사용.
       *  여기서 외부 모달(증상 팝업) DOM 은 절대 안 건드림 — 부모 모달 깜빡임 방지. */
      closeModalWithAnim(ov, function(){
        if(typeof opts.onClose === 'function') try { opts.onClose(); } catch(_){}
      });
    }
  });
  document.body.appendChild(ov);
  _makeDraggable(ov.querySelector('.modal-content'));
  /* 미리보기 영역 바깥 클릭 시 행 선택 해제 */
  const scrollArea=ov.querySelector('#rlPreviewScroll');
  if(scrollArea)scrollArea.addEventListener('click',function(e){
    if(!e.target.closest('tr[data-rl-id]'))_rlClearRowSelection();
  });
  _rlRenderLeft();
  _rlRenderButtons();
  _rlRenderPreview();
}

/* ── 왼쪽 패널 렌더링 ── */
function _rlRenderLeft(){
  const panel = document.getElementById('rlLeftPanel');
  if(!panel) return;
  let h = '';

  /* 이름 검색 */
  h += '<div style="font-size:11px;color:var(--t1);font-weight:700;margin-bottom:5px">이름 검색</div>';
  h += '<div style="display:flex;gap:6px;margin-bottom:14px">';
  /* 사용자 보고 2026-05-27 — 검색창에 현재 컨텍스트의 학생 이름 자동 표시.
   *  1순위: _rlSelected (검색 후 학생 선택 직후 잠깐 채워짐)
   *  2순위: _rlActiveRecId 의 record 의 personId → getStu (증상 모달 chip 진입 직후 _rlSelectPerson 거치면서 active rec 설정됨).
   *  그래서 chip 으로 들어와도, preview 행 클릭해도 동일하게 검색창에 이름이 보임. */
  let _rlInitName = '';
  if(_rlSelected && _rlSelected.name){
    _rlInitName = _rlSelected.name;
  } else if(_rlActiveRecId){
    const _ar = _rlRecords.find(function(r){return r && r.id===_rlActiveRecId;});
    if(_ar && _ar.personId){
      const _arStu = getStu(_ar.personId);
      if(_arStu && _arStu.name) _rlInitName = _arStu.name;
    }
  }
  h += '<div class="autocomplete-wrap" style="flex:1;position:relative"><span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:11px;pointer-events:none;z-index:1">🔍</span><input class="form-input" id="rlSearchInput" value="'+escHtml(_rlInitName)+'" placeholder="이름 검색 (오른쪽 대여 기록에 등록)" style="width:100%;font-size:11px;padding-left:30px;padding-top:8px;padding-bottom:8px;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px"><div class="autocomplete-list" id="rlACList"></div></div>';
  h += '<button data-action="advSearch" style="padding:4px 10px;font-size:11px;font-weight:700;background:rgba(236,72,153,0.1);color:#a8456e;border:1px solid rgba(236,72,153,0.2);border-radius:6px;cursor:pointer;white-space:nowrap">🔍 상세 검색</button>';
  h += '</div>';

  /* 선택된 사람 표시 — 이름 검색 하단 배지 제거 (중복 UI) */

  /* 물품 선택 */
  h += '<div style="font-size:11px;color:var(--t1);font-weight:700;margin-bottom:4px">대여 물품</div>';
  h += '<div style="font-size:10px;color:var(--t1);margin-bottom:8px;line-height:1.5">보건실에서 대여 가능한 물품을 "+추가"하여 등록할 수 있습니다.</div>';
  h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">';
  _rlItems.forEach(function(item,idx){
    const sel = _rlSelectedItem === item;
    h += '<span data-action="selectItem" data-item="'+escHtml(item)+'" style="cursor:pointer;padding:4px 10px;border-radius:16px;font-size:11px;font-weight:600;border:1px solid '+(sel?'var(--cyan)':'var(--bdr)')+';background:'+(sel?'rgba(6,182,212,0.1)':'var(--bg2)')+';color:'+(sel?'var(--cyan)':'var(--t2)')+';transition:all .15s;position:relative">'+escHtml(item)
      +'<span class="rl-item-btns" style="display:none;position:absolute;top:-8px;right:-8px;gap:2px">'
      +'<span data-action="editItem" data-idx="'+idx+'" style="width:14px;height:14px;border-radius:50%;background:rgba(59,130,246,0.15);color:#3b82f6;font-size:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:1px solid rgba(59,130,246,0.3)" title="수정">✏️</span>'
      +'<span data-action="removeItem" data-idx="'+idx+'" style="width:14px;height:14px;border-radius:50%;background:rgba(239,68,68,0.15);color:#ef4444;font-size:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:1px solid rgba(239,68,68,0.3)" title="삭제">✕</span>'
      +'</span></span>';
  });
  h += '<span data-action="addItem" style="cursor:pointer;padding:4px 10px;border-radius:16px;font-size:11px;font-weight:600;border:1px dashed rgba(249,115,22,0.45);background:rgba(249,115,22,0.08);color:#f97316">+ 추가</span>';
  h += '</div>';

  /* 빌려간 날짜/시간 */
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:5px">빌려간 날짜 · 시간</div>';
  h += '<div style="display:flex;gap:8px;margin-bottom:10px">';
  h += '<div style="flex:1"><input class="form-input" id="rlBorrowDate" value="'+escHtml(_rlBorrowDate)+'" placeholder="날짜" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openCal" data-target="rlBorrowDate"></div>';
  h += '<div style="flex:1"><input class="form-input" id="rlBorrowTime" value="'+escHtml(_rlBorrowTime)+'" placeholder="시간" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openClock" data-target="rlBorrowTime"></div>';
  h += '</div>';

  /* 반납 예정 날짜/시간 */
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:5px">반납 예정 날짜 · 시간</div>';
  h += '<div style="display:flex;gap:8px;margin-bottom:10px">';
  h += '<div style="flex:1"><input class="form-input" id="rlReturnDate" value="'+escHtml(_rlReturnDate)+'" placeholder="날짜" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openCal" data-target="rlReturnDate"></div>';
  h += '<div style="flex:1"><input class="form-input" id="rlReturnTime" value="'+escHtml(_rlReturnTime)+'" placeholder="시간" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openClock" data-target="rlReturnTime"></div>';
  h += '</div>';

  /* 반납 예정 일시 초과 알림 체크 */
  const _alertChecked=localStorage.getItem('ec_rental_alert')!=='false';
  h += '<div style="margin-top:6px;display:flex;align-items:center;gap:6px">';
  h += '<input type="checkbox" id="rlAlertCheck" '+(_alertChecked?'checked':'')+' data-action="alertCheck" style="accent-color:#06b6d4;width:14px;height:14px;cursor:pointer">';
  h += '<label for="rlAlertCheck" style="font-size:10px;color:var(--t1);cursor:pointer">반납 예정 일시 초과 시 다음 날 자동 팝업 알림</label>';
  h += '</div>';

  panel.innerHTML = h;

  /* ── Event delegation for left panel (bind once) ── */
  const _searchInp = document.getElementById('rlSearchInput');
  if(_searchInp && !_searchInp._rlBound){
    _searchInp._rlBound = true;
    _searchInp.addEventListener('input', function(){ _rlAutoComplete(); });
    _searchInp.addEventListener('focus', function(){ _rlAutoComplete(); });
    _searchInp.addEventListener('keydown', function(e){ _rlSearchKeydown(e); });
  }
  if(!panel._rlBound){
    panel._rlBound = true;
    panel.addEventListener('click', function(e){
      const el = e.target.closest('[data-action]');
      if(!el) return;
      const action = el.dataset.action;
      if(action==='advSearch'){ _rlOpenAdvSearch(); }
      else if(action==='clearSelected'){ _rlClearSelected(); }
      else if(action==='selectItem'){ _rlSelectItem(el.dataset.item); }
      else if(action==='editItem'){ e.stopPropagation(); _rlEditItem(parseInt(el.dataset.idx)); }
      else if(action==='removeItem'){ e.stopPropagation(); _rlRemoveItem(parseInt(el.dataset.idx)); }
      else if(action==='addItem'){ _rlAddItem(); }
      else if(action==='openCal'){ _rlOpenCal(el.dataset.target, el); }
      else if(action==='openClock'){ e.stopPropagation(); _rlOpenClock(el.dataset.target, e, el); }
    });
    panel.addEventListener('change', function(e){
      if(e.target.closest('[data-action="alertCheck"]')){
        localStorage.setItem('ec_rental_alert', e.target.checked ? 'true' : 'false');
      }
    });
    /* mouseenter/mouseleave for item chips */
    panel.addEventListener('mouseenter', function(e){
      const itemEl = e.target.closest('[data-action="selectItem"]');
      if(itemEl){ const btns = itemEl.querySelector('.rl-item-btns'); if(btns) btns.style.display = 'flex'; }
    }, true);
    panel.addEventListener('mouseleave', function(e){
      const itemEl = e.target.closest('[data-action="selectItem"]');
      if(itemEl){ const btns = itemEl.querySelector('.rl-item-btns'); if(btns) btns.style.display = 'none'; }
    }, true);
  }
}

/* ── 하단 버튼 패널 ── */
function _rlRenderButtons(){
  const panel = document.getElementById('rlBtnPanel');
  if(!panel) return;
  panel.innerHTML = ''
    +'<button data-action="showMessage" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.25);border-radius:7px;cursor:pointer;font-family:var(--f)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>안내 메시지 미리보기 & 복사</button>'
    +'<button data-action="exportExcel" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:#16a34a;color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 6px rgba(22,163,74,0.25);display:flex;align-items:center;justify-content:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>Excel 다운로드</button>'
    +'<button class="btn-print btn-block" data-action="print" style="padding:9px 14px">🖨 인쇄</button>';
  panel.addEventListener('click', function(e){
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const action = el.dataset.action;
    if(action==='showMessage') _rlShowMessage();
    else if(action==='exportExcel') _rlExportExcel();
    else if(action==='print') _rlPrint();
  });
}

/* ── 현재 편집 중인 레코드 (미리보기 실시간 반영) ── */
let _rlActiveRecId=null;

/* ── 사람 선택 → 즉시 레코드 생성 + 미리보기 반영 ── */
function _rlSelectPerson(id){
  const s = getStu(id);
  if(!s) return;
  _rlSelected = {id:s.id, name:s.name, type:s.type, grade:s.grade, cls:s.cls, num:s.num, position:s.position};
  const now = new Date();
  _rlBorrowDate = toDateStr(now);
  _rlBorrowTime = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const retH = now.getHours()+1;
  _rlReturnDate = toDateStr(now);
  _rlReturnTime = String(retH > 23 ? 23 : retH).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const inp = document.getElementById('rlSearchInput');
  if(inp) inp.value = '';
  const list = document.getElementById('rlACList');
  if(list) list.classList.remove('show');
  /* 즉시 레코드 생성 → 미리보기에 표시 (대여일시=현재, 반납예정=+1시간) */
  const newRec={id:Date.now(),personId:s.id,item:'',borrowDate:_rlBorrowDate,borrowTime:_rlBorrowTime,returnDate:_rlReturnDate,returnTime:_rlReturnTime,returned:false,returnedAt:''};
  _rlRecords.push(newRec);
  _rlActiveRecId=newRec.id;
  _rlSave();
  _rlSelected=null;
  _rlSelectedItem='';
  _rlRenderLeft();
  _rlRenderPreview();
  _rlShowSaveToast();
}

function _rlSelectItem(item){
  _rlSelectedItem = (_rlSelectedItem === item) ? '' : item;
  if(_rlActiveRecId&&_rlSelectedItem){
    /* 활성 레코드에 물품 즉시 반영 (이름 검색 등록·미리보기 행 선택 흐름) */
    const rec=_rlRecords.find(function(r){return r.id===_rlActiveRecId;});
    if(rec){rec.item=_rlSelectedItem;_rlSave();}
  } else if(!_rlActiveRecId&&_rlSelectedItem&&_rlSelected&&_rlSelected.id){
    /* 활성 레코드가 없고 방문자가 정해져 있으면(증상 팝업 prefilled 진입 등) 물품 클릭 즉시 등록 —
     * 소속·이름·물품·대여일시·반납예정·반납완료가 우측 대여 기록에 바로 표시 (사용자 제보 2026-06-12).
     * 옛 설계 주석은 "명시적 등록 버튼" 전제였으나 등록 버튼이 존재하지 않아
     * prefilled 흐름이 어디에도 기록되지 않은 채 끝나던 버그. */
    const newRec={id:Date.now(),personId:_rlSelected.id,item:_rlSelectedItem,borrowDate:_rlBorrowDate,borrowTime:_rlBorrowTime,returnDate:_rlReturnDate,returnTime:_rlReturnTime,returned:false,returnedAt:''};
    _rlRecords.push(newRec);
    _rlActiveRecId=newRec.id;
    _rlSave();
    _rlShowSaveToast();
  }
  _rlRenderLeft();
  _rlRenderPreview();
}

function _rlAddItem(){
  /* 인라인 입력 — Enter로 추가 (여러 개 연속 가능), Escape 또는 blur로 종료 */
  const btn=document.querySelector('[data-action="addItem"]');
  if(!btn)return;
  const inp=document.createElement('input');
  inp.type='text';inp.placeholder='물품 이름 입력 후 Enter';
  inp.style.cssText='width:200px;min-width:200px;font-size:11px;padding:4px 12px;border:2px solid var(--cyan);border-radius:8px;outline:none;background:var(--bg2);color:var(--t1);font-family:var(--f)';
  btn.parentNode.insertBefore(inp,btn);btn.style.display='none';
  inp.focus();
  let _closing=false;
  function _finish(){
    if(_closing)return;_closing=true;
    const v=inp.value.trim();
    if(v){_rlItems.push(v);_rlSave();}
    btn.style.display='';if(inp.parentNode)inp.remove();_rlRenderLeft();
  }
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){
      e.preventDefault();
      const v=inp.value.trim();
      if(v){_rlItems.push(v);_rlSave();inp.value='';_rlRenderLeft();
        /* 입력 필드 재포커스 (연속 추가) */
        setTimeout(function(){const ni=document.querySelector('input[placeholder="물품 이름 입력 후 Enter"]');if(ni)ni.focus();},50);
      }
    }
    if(e.key==='Escape')_finish();
  });
  inp.addEventListener('blur',function(){setTimeout(_finish,100);});
}

/* ── 자동완성 (일반 일지와 동일 UI) ── */
let _rlAcHighlight=-1;
function _rlAutoComplete(){
  const inp = document.getElementById('rlSearchInput');
  const list = document.getElementById('rlACList');
  if(!inp || !list) return;
  /* 자동완성 팝업이 좌측 패널의 overflow:hidden·overflow-y:auto 에 의해 잘리지 않도록 position:fixed 로 전환.
   * input 의 화면 좌표를 기준으로 매 호출마다 다시 계산.
   * CSS zoom(>100%) 환경 보정 — getBoundingClientRect 는 시각 px(zoom 적용된 값) 을 반환하지만
   * position:fixed 의 left/top 은 layout px 로 해석되므로 zoom factor 로 나눠줘야 화면상 input 바로 아래에 붙음.
   * 이 보정 없으면 110% 이상에서 검색창 한참 아래·중앙쪽으로 떠 버림. */
  /* 가장 가까운 "transformed 조상" 찾기.
   * CSS spec — transform/perspective/filter 가 set 된 조상은 자손의 position:fixed 컨테이닝 블록이 됨.
   * .modal-overlay.show .modal-content 가 transform:translate3d(0,0,0) 을 갖고 있어서
   * 자동완성 list 가 viewport 가 아닌 모달 내부 좌표계로 잡혀 엉뚱한 위치에 떠 있었음. */
  function _findFixedContainingBlock(el){
    let p = el && el.parentElement;
    while(p && p !== document.documentElement){
      const cs = getComputedStyle(p);
      if((cs.transform && cs.transform !== 'none') ||
         (cs.perspective && cs.perspective !== 'none') ||
         (cs.filter && cs.filter !== 'none')) return p;
      p = p.parentElement;
    }
    return null;
  }
  const _positionList = function(){
    let _zf=1;
    try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
    const r = inp.getBoundingClientRect();
    /* transformed 조상이 있으면 그 rect 를 빼서 보정 — fixed 가 viewport 기준이 아니므로. */
    let _ox=0, _oy=0;
    const _cb = _findFixedContainingBlock(list);
    if(_cb){ const cbr = _cb.getBoundingClientRect(); _ox = cbr.left; _oy = cbr.top; }
    const _rL=(r.left - _ox)/_zf, _rB=(r.bottom - _oy)/_zf, _rW=r.width/_zf;
    list.style.position = 'fixed';
    list.style.top = (_rB + 2) + 'px';
    list.style.left = _rL + 'px';
    list.style.width = _rW + 'px';
    list.style.maxHeight = Math.min(280, Math.max(120, (window.innerHeight - r.bottom)/_zf - 16)) + 'px';
    list.style.zIndex = '11000';
  };
  _positionList();
  /* 한 번만 등록 — scroll/resize 발생 시 재배치 */
  if(!inp._rlACPosBound){
    inp._rlACPosBound = true;
    const _reposIfShown = function(){ if(list.classList.contains('show')) _positionList(); };
    window.addEventListener('scroll', _reposIfShown, true);
    window.addEventListener('resize', _reposIfShown);
    /* 외부 클릭 시 닫기 */
    document.addEventListener('mousedown', function(e){
      if(!list.classList.contains('show')) return;
      if(list.contains(e.target) || e.target === inp) return;
      list.classList.remove('show'); list.style.display='none';
    });
  }
  _rlAcHighlight=-1;
  const q = inp.value.trim();
  /* 빈 입력: 등록된 전체 인원(학년·반·번 정렬) 상위 50명 노출 — 초성 입력 후 지워도 다시 전체 목록 확인 가능 */
  if(!q){
    const _all=S.people.slice().sort(function(a,b){
      if((a.type==='staff')!==(b.type==='staff'))return a.type==='staff'?1:-1;
      const ga=Number(a.grade)||0, gb=Number(b.grade)||0;if(ga!==gb)return ga-gb;
      var _cc=compareClass(a.cls,b.cls);if(_cc)return _cc;   /* 한글 반(가람·나래) 정렬 지원 (사용자 요청 2026-05-28) */
      const na=Number(a.num)||0,   nb=Number(b.num)||0;  if(na!==nb)return na-nb;
      return (a.name||'').localeCompare(b.name||'','ko');
    }).slice(0,50);
    if(!_all.length){list.classList.remove('show');return;}
    const hint='<div style="padding:4px 10px;font-size:10px;color:var(--t3);background:var(--bg2);border-bottom:1px solid var(--bdrl)">등록된 전체 인원 '+S.people.length+'명 중 상위 '+_all.length+'명 · 이름을 입력하면 좁혀집니다</div>';
    list.innerHTML=hint+_all.map(function(s,i){
      const isCare=s.status==='caution'||s.status==='watch';
      const isStf=s.type==='staff';
      const info=isStf?'['+(s.position||'교직원')+(isCare?' *요보호*':'')+']':'['+s.grade+'학년'+s.cls+'반'+s.num+'번'+(isCare?' *요보호*':'')+']';
      return '<div class="ac-item" data-idx="'+i+'" data-person-id="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
    }).join('');
    list.classList.add('show');
    list.onclick=function(ev){const item=ev.target.closest('.ac-item');if(item&&item.dataset.personId)_rlSelectPerson(item.dataset.personId);};
    list.onmouseover=function(ev){const item=ev.target.closest('.ac-item');if(item){_rlAcHighlight=parseInt(item.dataset.idx);_rlHighlightAC();}};
    return;
  }
  const qLower=q.toLowerCase();
  /* 초성 검색 지원 (matchKorean 전역 함수 사용) */
  const _startMatch=typeof matchKoreanFromStart==='function'?S.people.filter(function(s){return matchKoreanFromStart(s.name,q);}):[];
  const _otherMatch=S.people.filter(function(s){
    if(_startMatch.indexOf(s)>=0) return false;
    if(typeof matchKorean==='function'&&matchKorean(s.name,q)) return true;
    const isStf=s.type==='staff';
    const searchStr=isStf?(s.name+' '+(s.position||'교직원')):(s.name+' '+s.grade+'학년'+s.cls+'반'+s.num+'번');
    return searchStr.toLowerCase().indexOf(qLower)>=0;
  });
  const _allMatched=_startMatch.concat(_otherMatch);
  const matched=_allMatched.slice(0,50);
  if(!matched.length){
    /* 매칭 없음 — 기존엔 숨기기만 했으나 안내 표시하여 "왜 안 뜨는지" 명확화 */
    list.innerHTML='<div style="padding:14px 16px;text-align:center;color:var(--t3);font-size:11px;line-height:1.6">"<b style="color:var(--t2)">'+escHtml(q)+'</b>"에 일치하는 사람이 없습니다<br><span style="font-size:9px">입력란을 비우면 전체 목록이 다시 표시됩니다</span></div>';
    list.classList.add('show');
    return;
  }
  const hint=_allMatched.length>matched.length?'<div style="padding:4px 10px;font-size:10px;color:var(--t3);background:var(--bg2);border-bottom:1px solid var(--bdrl)">총 '+_allMatched.length+'명 중 상위 '+matched.length+'명 · 더 입력하면 좁혀집니다</div>':'';
  list.innerHTML = hint + matched.map(function(s,i){
    const isCare=s.status==='caution'||s.status==='watch';
    const isStf=s.type==='staff';
    const info=isStf?'['+(s.position||'교직원')+(isCare?' *요보호*':'')+']':'['+s.grade+'학년'+s.cls+'반'+s.num+'번'+(isCare?' *요보호*':'')+']';
    return '<div class="ac-item" data-idx="'+i+'" data-person-id="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
  }).join('');
  list.classList.add('show');
  /* Event delegation for autocomplete list */
  list.onclick = function(ev){
    const item = ev.target.closest('.ac-item');
    if(item && item.dataset.personId) _rlSelectPerson(item.dataset.personId);
  };
  list.onmouseover = function(ev){
    const item = ev.target.closest('.ac-item');
    if(item){ _rlAcHighlight = parseInt(item.dataset.idx); _rlHighlightAC(); }
  };
}
function _rlHighlightAC(){
  document.querySelectorAll('#rlACList .ac-item').forEach(function(el,i){el.classList.toggle('highlighted',i===_rlAcHighlight);});
}
function _rlSearchKeydown(e){
  const items=document.querySelectorAll('#rlACList .ac-item');
  if(e.key==='ArrowDown'){e.preventDefault();_rlAcHighlight=Math.min(_rlAcHighlight+1,items.length-1);_rlHighlightAC();}
  else if(e.key==='ArrowUp'){e.preventDefault();_rlAcHighlight=Math.max(_rlAcHighlight-1,0);_rlHighlightAC();}
  else if(e.key==='Enter'){e.preventDefault();if(_rlAcHighlight>=0&&items[_rlAcHighlight])items[_rlAcHighlight].click();else if(items.length)items[0].click();}
  else if(e.key==='Escape'){document.getElementById('rlACList').classList.remove('show');const _ei=document.getElementById('rlSearchInput');_ei.value='';_ei.blur();}
}

/* ── 미리보기 행 1회 클릭 선택 ── */
let _rlSelectedRecId=null;
function _rlSelectRow(tr){
  const wrap=document.getElementById('rlPreviewWrap');
  if(!wrap)return;
  const rid=parseInt(tr.getAttribute('data-rl-id'))||null;
  const wasSelected=(_rlSelectedRecId===rid);
  if(wasSelected){_rlSelectedRecId=null;_rlActiveRecId=null;_rlRenderPreview();_rlRenderLeft();return;}
  _rlSelectedRecId=rid;
  _rlActiveRecId=rid;
  /* 선택한 레코드 정보를 왼쪽 패널에 반영 */
  const rec=_rlRecords.find(function(r){return r.id===rid;});
  if(rec){
    const s=getStu(rec.personId);
    if(s)_rlSelected={id:s.id,name:s.name,type:s.type,grade:s.grade,cls:s.cls,num:s.num,position:s.position};
    _rlSelectedItem=rec.item||'';
    _rlBorrowDate=rec.borrowDate||'';
    _rlBorrowTime=rec.borrowTime||'';
    _rlReturnDate=rec.returnDate||'';
    _rlReturnTime=rec.returnTime||'';
  }
  _rlRenderPreview();
  _rlRenderLeft();
}
function _rlClearRowSelection(){
  _rlSelectedRecId=null;
  const wrap=document.getElementById('rlPreviewWrap');
  if(wrap)wrap.querySelectorAll('tr[data-rl-id]').forEach(function(r){r.style.background='';});
}

/* ── 물품 칩 수정/삭제 ── */
function _rlEditItem(idx){
  _symPrompt('물품 이름 수정',_rlItems[idx],function(v){
    _rlItems[idx]=v;_rlSave();_rlRenderLeft();_rlRenderPreview();
  });
}
function _rlRemoveItem(idx){
  const _name=_rlItems[idx];
  appConfirmModal('"'+_name+'" 물품을 삭제하시겠습니까?','대여 물품 삭제').then(function(ok){
    if(!ok)return;
    _rlItems.splice(idx,1);_rlSave();_rlRenderLeft();_rlRenderPreview();
  });
}

/* ── 왼쪽 패널 → 활성 레코드 동기화 ── */
function _rlSyncActiveRec(){
  if(!_rlActiveRecId)return;
  const rec=_rlRecords.find(function(r){return r.id===_rlActiveRecId;});
  if(!rec)return;
  if(_rlBorrowDate)rec.borrowDate=_rlBorrowDate;
  if(_rlBorrowTime)rec.borrowTime=_rlBorrowTime;
  if(_rlReturnDate)rec.returnDate=_rlReturnDate;
  if(_rlReturnTime)rec.returnTime=_rlReturnTime;
  _rlSave();
}

/* ── 날짜/시간 피커 (연수/교육 등록부와 동일 방식) ── */
function _rlOpenCal(targetId, anchor){
  /* 기존 시계 닫기 */
  const clk = document.getElementById('clockPickerWrap');
  if(clk) clk.style.display = 'none';
  trOpenCal(targetId, anchor);
  /* 달력 팝업을 대여 대장 위에 표시 */
  const cal=document.getElementById('trCalWrap');
  if(cal)cal.style.zIndex='11500';
  /* 값 변경 감시 — 날짜 선택 후 자동으로 아날로그 시계 팝업 */
  const inp = document.getElementById(targetId);
  if(inp){
    function _rlCalChange(){
      if(targetId === 'rlBorrowDate') _rlBorrowDate = inp.value;
      else if(targetId === 'rlReturnDate') _rlReturnDate = inp.value;
      _rlSyncActiveRec();
      _rlRenderPreview();
      inp.removeEventListener('input', _rlCalChange);
      inp.removeEventListener('change', _rlCalChange);
      /* 달력 닫기 */
      const calW=document.getElementById('trCalWrap');if(calW)calW.style.display='none';
      /* 대응하는 시간 입력에 아날로그 시계 자동 오픈 */
      const timeTargetId = targetId==='rlBorrowDate'?'rlBorrowTime':'rlReturnTime';
      const timeInp = document.getElementById(timeTargetId);
      if(timeInp){
        setTimeout(function(){
          /* openClockPicker를 사용하여 아날로그 시계 표시 */
          const _hiddenId='_rlClockInput_'+timeTargetId;
          const existing=document.getElementById(_hiddenId);if(existing)existing.remove();
          const hidden=document.createElement('input');hidden.id=_hiddenId;hidden.value=timeInp.value||'';hidden.style.display='none';
          hidden.addEventListener('input',function(){
            timeInp.value=this.value;
            if(timeTargetId==='rlBorrowTime')_rlBorrowTime=this.value;
            else _rlReturnTime=this.value;
            _rlSyncActiveRec();_rlRenderPreview();
          });
          document.body.appendChild(hidden);
          if(typeof openClockPicker==='function')openClockPicker(_hiddenId,timeInp);
          const cw=document.getElementById('clockPickerWrap');if(cw)cw.style.zIndex='11500';
        },200);
      }
    }
    inp.addEventListener('input', _rlCalChange);
    inp.addEventListener('change', _rlCalChange);
  }
}

function _rlOpenClock(targetId, e, anchor){
  if(e)e.stopPropagation();
  /* 기존 달력 닫기 */
  const cal = document.getElementById('trCalWrap');
  if(cal) cal.style.display = 'none';
  /* openClockPicker 직접 호출 (trOpenClock 우회) */
  if(typeof openClockPicker==='function') openClockPicker(targetId, anchor);
  /* 시계 팝업을 대여 대장 위에 표시 */
  setTimeout(function(){
    const cw=document.getElementById('clockPickerWrap');if(cw)cw.style.zIndex='11500';
  },0);
  /* 값 변경 감시 (input + change + MutationObserver) */
  const inp = document.getElementById(targetId);
  if(inp){
    function _syncTime(){
      if(targetId === 'rlBorrowTime') _rlBorrowTime = inp.value;
      else if(targetId === 'rlReturnTime') _rlReturnTime = inp.value;
      _rlSyncActiveRec();
      _rlRenderPreview();
    }
    inp.addEventListener('input', _syncTime);
    inp.addEventListener('change', _syncTime);
    const _ob = new MutationObserver(_syncTime);
    _ob.observe(inp, {attributes:true, attributeFilter:['value']});
  }
}

/* ── 대여 등록 ── */
/* 자동 등록 (사람+물품 선택 시 즉시) */
let _rlAutoRegLock=false;
/* 저장 인디케이터 (ec-save-indicator 패턴) */
let _rlSaveTimer=null;
function _rlShowSaveToast(){
  let ind=document.getElementById('rlSaveIndicator');
  if(!ind){ind=document.createElement('div');ind.id='rlSaveIndicator';ind.className='ec-save-indicator';ind.style.zIndex='12000';document.body.appendChild(ind);}
  ind.textContent='저장 중…';
  ind.className='ec-save-indicator saving';ind.style.zIndex='12000';
  if(_rlSaveTimer)clearTimeout(_rlSaveTimer);
  _rlSaveTimer=setTimeout(function(){
    ind.textContent='모든 내용이 저장되었습니다.';
    ind.className='ec-save-indicator saved';ind.style.zIndex='12000';
    setTimeout(function(){ind.className='ec-save-indicator hide';},3000);
  },300);
}

/* ── 반납 체크 ── */
function _rlToggleReturn(id){
  const rec = _rlRecords.find(function(r){return r.id === id;});
  if(!rec) return;
  rec.returned = !rec.returned;
  if(rec.returned){
    const now = new Date();
    rec.returnedAt = toDateStr(now) + ' ' + String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  } else {
    rec.returnedAt = '';
  }
  _rlSave();
  _rlRenderPreview();
  _rlRenderLeft();
  _rlShowSaveToast();
}

/* ═══ 키오스크 접수 연동 (2026-06-12) ═══
 *  수신 패널이 태그 "물품 대여(반납 필요)" / "물품 반납" 접수를 대장에 반영할 때 사용.
 *  localStorage 직접 조작 금지 — 이 모듈의 _rlRecords 가 단일 출처이므로 반드시 이 함수로만 변경. */
/* 대여 대장 등록 물품 목록 — 키오스크 편집기의 물품 지정 드롭다운용 (2026-06-13).
 *  localStorage(대장 단일 출처) 최신값 우선 — 대장에서 물품을 추가/수정해도 즉시 반영 (사용자 요청 2026-06-13). */
export function rentalGetItems(){
  try{ const v=JSON.parse(localStorage.getItem('ec_rental_items')||'null'); if(Array.isArray(v)&&v.length){ return v.slice(); } }catch(_){}
  return _rlItems.slice();
}
/* 물품 신규 등록 — 키오스크 편집기의 [+ 추가]와 실시간 연동 (2026-06-13). 중복이면 추가 안 함. */
export function rentalAddItem(name){
  const n=String(name||'').trim();
  if(!n) return false;
  if(_rlItems.indexOf(n)!==-1) return true;   /* 이미 있음 — 성공 취급 */
  _rlItems.push(n);
  _rlSave();
  try{ if(document.getElementById('rlPreviewWrap')){_rlRenderLeft();} }catch(_){}
  return true;
}
/* 대여일로부터 평일 N일 후 (주말 제외) — 키오스크 반납 예정일 계산 (2026-06-13) */
function _rlAddBusinessDays(date, n){
  const d=new Date(date); let added=0;
  while(added<n){ d.setDate(d.getDate()+1); const dow=d.getDay(); if(dow!==0&&dow!==6)added++; }
  return d;
}
/* 키오스크 대여 등록 — returnDays(평일) 가 있으면 반납 예정일시를 그 날짜 12:00 으로 기록 (사용자 결정 2026-06-13) */
export function rentalAddFromKiosk(personId, item, returnDays){
  const now=new Date();
  let retDate, retTime;
  const nd=parseInt(returnDays,10);
  if(nd&&nd>0){
    const due=_rlAddBusinessDays(now, nd);
    retDate=toDateStr(due); retTime='12:00';   /* 반납 예정 시각 12:00 고정 (사용자 결정 2026-06-13) */
  } else {
    const _retH=Math.min(now.getHours()+1,23);
    retDate=toDateStr(now); retTime=String(_retH).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  }
  const rec={
    id:Date.now(), personId:String(personId||''), item:String(item||''),
    borrowDate:toDateStr(now), borrowTime:String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),
    returnDate:retDate, returnTime:retTime,
    returned:false, returnedAt:''
  };
  _rlRecords.push(rec);
  _rlSave();
  /* 대장 모달이 열려 있으면 즉시 재렌더 */
  try{ if(document.getElementById('rlPreviewWrap')){_rlRenderPreview();_rlRenderLeft();} }catch(_){}
  return rec.id;
}
export function rentalMarkReturnedFromKiosk(personId, item){
  /* 같은 인물의 미반납 레코드 — 물품명 일치 우선, 없으면 가장 최근 미반납 1건 */
  const mine=_rlRecords.filter(function(r){return !r.returned && String(r.personId)===String(personId);});
  if(!mine.length) return false;
  let target=null;
  if(item){
    const norm=String(item).trim();
    target=mine.slice().reverse().find(function(r){return String(r.item||'').trim()===norm;});
  }
  if(!target) target=mine[mine.length-1];
  target.returned=true;
  const now=new Date();
  target.returnedAt=toDateStr(now)+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  _rlSave();
  try{ if(document.getElementById('rlPreviewWrap')){_rlRenderPreview();_rlRenderLeft();} }catch(_){}
  return true;
}

/* ── 삭제 ── */
function _rlDelete(id){
  _rlRecords = _rlRecords.filter(function(r){return r.id !== id;});
  _rlSave();
  _rlRenderPreview();
  _rlShowSaveToast();
}

/* ── 오른쪽 미리보기 (연수/교육 등록부 스타일 엑셀 시트) ── */
/* PDF·인쇄 전용 A4 페이지 HTML — 렌더러 DOM 과 독립 생성 */
function _rlRenderA4Html(){
  const sorted = _rlRecords.slice().reverse();
  const ROWS = 30;
  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS));
  const yr=typeof _academicYear==='function'?_academicYear():new Date().getFullYear();
  /* 행 높이·여백을 줄여 (헤더+30행)이 물리적 A4 한 장(여백 제외 ≈277mm)에 확실히 들어가게 함.
   * 이전 7px 패딩 + 빈칸 4줄에서는 30행째가 다음 장으로 밀려(spill) 2페이지가 됐고,
   * 넘친 페이지에서 thead 색상바(중첩테이블 배경)가 인쇄 누락됐음. 여유 확보로 두 문제 모두 해소. (2026-06-02) */
  const bd='border:2px solid #333;';const pd='padding:5px 6px;';const ctr='text-align:center;';
  const _hdrKeys=['seq','belong','name','item','borrow','returnDue','done','returnAt'];
  const _hdrWidths=['26px','80px','48px','72px','95px','95px','40px','95px'];
  let h = '<div style="font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000;width:100%">';
  for(let page = 0; page < totalPages; page++){
    const pageRecs = sorted.slice(page * ROWS, (page + 1) * ROWS);
    h += '<div class="rl-page-box" style="padding:10mm 10mm;background:#fff">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead>';
    h += '<tr><td colspan="8" style="padding:0;border:none"><table style="width:100%;border-collapse:collapse"><tbody>'
      +'<tr><td colspan="5" style="background:#2855A0;height:12px;padding:0;border:none"></td><td colspan="3" style="background:#D4A843;height:12px;padding:0;border:none"></td></tr>'
      +'<tr><td colspan="8" style="background:#F7F7F7;text-align:center;padding:10px 16px;border:none;font-size:16px;font-weight:700;color:#000;letter-spacing:3px">'+yr+'학년도 보건실 물품 대여 대장</td></tr>'
      +'<tr><td colspan="3" style="background:#2E8B57;height:12px;padding:0;border:none"></td><td colspan="5" style="background:#C0392B;height:12px;padding:0;border:none"></td></tr>'
      +'</tbody></table></td></tr>';
    for(let sp=0;sp<2;sp++){h+='<tr><td colspan="8" style="border:none;padding:0;height:12px"></td></tr>';}
    h += '<tr>';
    _hdrKeys.forEach(function(k,ki){
      h += '<th style="'+bd+pd+ctr+'background:#F7F7F7;font-weight:700;width:'+_hdrWidths[ki]+';border-top:2px solid #333;'+(ki===0?'border-left:2px solid #333;':'')+(ki===_hdrKeys.length-1?'border-right:2px solid #333;':'')+'">'+escHtml(_rlHeaders[k])+'</th>';
    });
    h += '</tr></thead><tbody>';
    const startNum = page * ROWS + 1;
    pageRecs.forEach(function(rec, i){
      const s = getStu(rec.personId);
      const belong = _rlBelong(s);
      const name = _rlName(s);
      const _lB='border-left:2px solid #333;';const _rB='border-right:2px solid #333;';
      h += '<tr>'
        +'<td style="'+bd+pd+ctr+_lB+'">'+(startNum + i)+'</td>'
        +'<td style="'+bd+pd+ctr+'">'+escHtml(belong)+'</td>'
        +'<td style="'+bd+pd+ctr+'">'+escHtml(name)+'</td>'
        +'<td style="'+bd+pd+ctr+'">'+escHtml(rec.item||'')+'</td>'
        /* 대여일시 / 반납예정일시 / 반납일시 — 모두 클릭해서 contenteditable 로 수정 가능. focus 시 전체 텍스트 블록 선택 */
        +'<td contenteditable="true" data-action="editDtCell" data-field="borrow" data-rec-id="'+rec.id+'" style="'+bd+pd+ctr+'font-size:9px;cursor:text" spellcheck="false">'+escHtml(_rlFmtDt(rec.borrowDate,rec.borrowTime))+'</td>'
        +'<td contenteditable="true" data-action="editDtCell" data-field="return" data-rec-id="'+rec.id+'" style="'+bd+pd+ctr+'font-size:9px;cursor:text'+(_rlIsOverdue(rec)?';color:#dc2626;font-weight:700':'')+'" spellcheck="false">'+escHtml(_rlFmtDt(rec.returnDate,rec.returnTime))+'</td>'
        +'<td style="'+bd+pd+ctr+'">'+(rec.returned?'<b style="font-size:16px">☑</b>':'☐')+'</td>'
        +'<td contenteditable="true" data-action="editDtCell" data-field="returnedAt" data-rec-id="'+rec.id+'" style="'+bd+pd+ctr+'font-size:9px;cursor:text;'+_rB+'" spellcheck="false">'+escHtml(rec.returnedAt?_rlFmtDt(rec.returnedAt.split(' ')[0],rec.returnedAt.split(' ')[1]):'__.__.__  __:__')+'</td>'
        +'</tr>';
    });
    for(let e = pageRecs.length; e < ROWS; e++){
      const isLast=e===ROWS-1;const btm=isLast?'border-bottom:2px solid #333;':'';
      h += '<tr>'
        +'<td style="'+bd+pd+ctr+'border-left:2px solid #333;'+btm+'">'+(startNum+e)+'</td>'
        +'<td style="'+bd+pd+ctr+btm+'">&nbsp;</td>'
        +'<td style="'+bd+pd+ctr+btm+'">&nbsp;</td>'
        +'<td style="'+bd+pd+ctr+btm+'">&nbsp;</td>'
        +'<td style="'+bd+pd+ctr+btm+'font-size:9px;color:#aaa">__.__.__&nbsp;__:__</td>'
        +'<td style="'+bd+pd+ctr+btm+'font-size:9px;color:#aaa">__.__.__&nbsp;__:__</td>'
        +'<td style="'+bd+pd+ctr+btm+'">☐</td>'
        +'<td style="'+bd+pd+ctr+btm+'font-size:9px;color:#aaa;'+(isLast?'border-right:2px solid #333;':'')+'">&nbsp;</td>'
        +'</tr>';
    }
    h += '</tbody></table></div>';
  }
  h += '</div>';
  return h;
}

function _rlRenderPreview(){
  const wrap = document.getElementById('rlPreviewWrap');
  if(!wrap) return;
  const sorted = _rlRecords.slice().reverse();
  const _hdrKeys=['seq','belong','name','item','borrow','returnDue','done','returnAt'];
  const _hdrWidths=['36px','150px','72px','90px','108px','108px','46px','108px'];
  const _TH='padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);background:var(--bg2)';
  const _TD='padding:6px 6px;text-align:center;border-bottom:1px solid var(--bdrl);font-size:11px;color:var(--t1)';

  let h = '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:6px">📋 대여 기록 <span style="font-size:10px;color:var(--t3);font-weight:600">(총 '+_rlRecords.length+'건)</span></div>';
  h += '<div style="border:1px solid var(--bdr);border-radius:8px;overflow:hidden;background:var(--card)">';
  h += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
  h += '<thead style="position:sticky;top:0;z-index:5"><tr>';
  _hdrKeys.forEach(function(k,ki){
    h += '<th style="'+_TH+';width:'+_hdrWidths[ki]+'">'+escHtml(_rlHeaders[k])+'</th>';   /* 헤더 이름 변경 불가 (사용자 요청 2026-07-01) */
  });
  h += '</tr></thead><tbody>';

  if(sorted.length===0){
    h += '<tr><td colspan="8" style="padding:32px 16px;text-align:center;color:var(--t3);font-size:11px">대여 기록이 없습니다. 왼쪽 패널에서 대상·물품·일시를 선택하여 새 기록을 추가하세요.</td></tr>';
  } else {
    sorted.forEach(function(rec, i){
      const s = getStu(rec.personId);
      const belong = _rlBelong(s);
      const name = _rlName(s);
      const _rid=rec.id;
      const _isSel=(_rlSelectedRecId===_rid);
      const _cellBg=_isSel?';background:rgba(6,182,212,0.18)':'';
      const _rowStyle=_isSel?'cursor:pointer;box-shadow:inset 3px 0 0 var(--cyan);transition:background .12s':'cursor:pointer;transition:background .12s';
      h += '<tr data-rl-id="'+_rid+'"'+(_isSel?' class="rl-row-sel"':'')+' style="'+_rowStyle+'">'
        +'<td style="'+_TD+';color:var(--t3);font-size:10px'+_cellBg+'">'+(i+1)+'</td>'
        /* 사용자 요청: 대여 기록 표에서 사람 입력 비활성화 — 성명·학년반 셀은 더블클릭 편집/포인터 제거 */
        +'<td style="'+_TD+_cellBg+'">'+escHtml(belong)+'</td>'
        +'<td style="'+_TD+';font-weight:600'+_cellBg+'">'+escHtml(name)+'</td>'
        +'<td style="'+_TD+';cursor:pointer'+_cellBg+'" data-action="editCellItem">'+escHtml(rec.item||'')+'</td>'
        /* 대여일시·반납예정일시 — 읽기 전용. 행 클릭 시 왼편 입력 폼이 채워져 거기서 수정. */
        +'<td style="'+_TD+';font-size:10px;color:var(--t2)'+_cellBg+'">'+escHtml(_rlFmtDt(rec.borrowDate,rec.borrowTime))+'</td>'
        +'<td style="'+_TD+';font-size:10px;color:'+(_rlIsOverdue(rec)?'#dc2626;font-weight:700':'var(--t2)')+_cellBg+'">'+escHtml(_rlFmtDt(rec.returnDate,rec.returnTime))+'</td>'
        +'<td style="'+_TD+_cellBg+'"><input type="checkbox" '+(rec.returned?'checked':'')+' data-action="toggleReturn" data-rec-id="'+rec.id+'" style="accent-color:var(--cyan);width:18px;height:18px;cursor:pointer" title="'+(rec.returned?'체크 해제 시 반납일시가 초기화됩니다':'반납 완료 처리 (체크 시 현재 시각 기록)')+'"></td>'
        /* 반납일시 — 사용자 요청: 반납완료 체크된 경우에만 테이블에서 직접 클릭해 수정 가능 (contenteditable). 미체크 시 회색 비활성.
         * box-sizing:border-box + overflow:hidden + outline:none — 셀이 표 밖으로 비져나오지 않도록. */
        +'<td '+(rec.returned?'contenteditable="true" data-action="editDtCell" data-field="returnedAt" data-rec-id="'+rec.id+'"':'')+' style="padding:4px 4px;text-align:center;border-bottom:1px solid var(--bdrl);font-size:9px;color:'+(rec.returned?'var(--t2)':'var(--t3)')+';'+(rec.returned?'cursor:text':'cursor:default;opacity:0.55')+';box-sizing:border-box;overflow:hidden;white-space:nowrap;outline:none;max-width:108px'+_cellBg+'" spellcheck="false">'+escHtml(rec.returnedAt?_rlFmtDt(rec.returnedAt.split(' ')[0],rec.returnedAt.split(' ')[1]):'__.__.__  __:__')+'</td>'
        +'</tr>';
    });
    /* 새 기록 추가 행은 사용자 요청으로 제거 — 대여 기록 표에서는 사람 추가 불가, 왼쪽 패널에서만 등록 */
  }
  h += '</tbody></table></div>';
  wrap.innerHTML = h;

  /* ── Event delegation for preview table (bind once) ── */
  if(!wrap._rlBound){
    wrap._rlBound = true;
    wrap.addEventListener('click', function(e){
      /* contenteditable 셀(반납일시 직접 수정) — 행 선택/재렌더 차단해서 포커스 유지. */
      const edit = e.target.closest('[data-action="editDtCell"]');
      if(edit){ e.stopPropagation(); return; }
      /* toggleReturn checkbox — handled by change event, just stop propagation */
      const chk = e.target.closest('[data-action="toggleReturn"]');
      if(chk){ e.stopPropagation(); return; }
      /* editCellItem (single click on item cell) */
      const itemTd = e.target.closest('[data-action="editCellItem"]');
      if(itemTd){
        e.stopPropagation();
        const tr = itemTd.closest('tr[data-rl-id]');
        if(tr) _rlEditCellItem(parseInt(tr.dataset.rlId), itemTd);
        return;
      }
      /* 대여일시·반납예정일시: 싱글 클릭으로도 달력+시계 팝업 열기 (행 선택도 함께 수행) */
      const dateTd = e.target.closest('[data-dblaction="editCell"][data-field="borrowDate"], [data-dblaction="editCell"][data-field="returnDate"]');
      if(dateTd && !dateTd.querySelector('input')){
        e.stopPropagation();
        const tr = dateTd.closest('tr[data-rl-id]');
        if(tr){
          _rlSelectRow(tr);
          _rlEditCell(parseInt(tr.dataset.rlId), dateTd.dataset.field, dateTd);
        }
        return;
      }
      /* editHeader */
      const hdrEl = e.target.closest('[data-action="editHeader"]');
      if(hdrEl){ _rlEditHeader(hdrEl.dataset.key, hdrEl); return; }
      /* newFromPreviewAdvSearch (empty row belong cell) */
      if(e.target.closest('[data-action="newFromPreviewAdvSearch"]')){ _rlNewFromPreviewAdvSearch(); return; }
      /* newFromPreview (empty row name cell) */
      const nfp = e.target.closest('[data-action="newFromPreview"]');
      if(nfp){ _rlNewFromPreview(nfp); return; }
      /* selectRow (click on data row) */
      const dataRow = e.target.closest('tr[data-rl-id]');
      if(dataRow) _rlSelectRow(dataRow);
    });
    wrap.addEventListener('dblclick', function(e){
      const td = e.target.closest('[data-dblaction="editCell"]');
      if(!td) return;
      e.stopPropagation();
      const tr = td.closest('tr[data-rl-id]');
      if(tr) _rlEditCell(parseInt(tr.dataset.rlId), td.dataset.field, td);
    });
    wrap.addEventListener('mouseenter', function(e){
      const tr = e.target.closest('tr[data-rl-id]');
      if(tr) _rlShowRowX(tr, parseInt(tr.dataset.rlId));
    }, true);
    wrap.addEventListener('mouseleave', function(e){
      const tr = e.target.closest('tr[data-rl-id]');
      if(tr) _rlHideRowX();
    }, true);
    wrap.addEventListener('change', function(e){
      const chk = e.target.closest('[data-action="toggleReturn"]');
      if(chk){ e.stopPropagation(); _rlToggleReturn(parseInt(chk.dataset.recId)); }
    });
    /* 대여일시 / 반납예정일시 / 반납일시 contenteditable — 클릭 시 전체 블록 선택, blur·Enter 시 저장. 달력 안 띄움. */
    wrap.addEventListener('focusin', function(e){
      const cell = e.target.closest('[data-action="editDtCell"]');
      if(!cell) return;
      /* 텍스트 전체 블록 선택 — 사용자가 숫자 바로 입력하면 덮어씀 */
      setTimeout(function(){
        try{
          const range = document.createRange();
          range.selectNodeContents(cell);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }catch(_){}
      }, 0);
    });
    wrap.addEventListener('keydown', function(e){
      const cell = e.target.closest('[data-action="editDtCell"]');
      if(!cell) return;
      if(e.key==='Enter'){ e.preventDefault(); cell.blur(); return; }
      /* 숫자만 허용 — 사용자 요청. 영문·한글·기호 입력 차단.
       * 허용: 0~9 / 백스페이스 / Delete / 화살표 / Tab / Home / End / 복사·붙여넣기 (Ctrl 조합) / Esc */
      if(e.ctrlKey || e.metaKey || e.altKey) return; /* Ctrl+C/V/X 등은 그대로 허용 */
      const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End','Escape','Enter'];
      if(allowed.indexOf(e.key)!==-1) return;
      if(e.key && e.key.length===1 && !/^[0-9]$/.test(e.key)){
        e.preventDefault();
      }
    }, true);
    /* 붙여넣기에도 숫자 외 제거 적용 — Excel 등에서 "2026-05-14 09:30" 복붙 가능하도록 :·-·.·공백은 유지,
     * 한글·영문만 제거. parser 가 어차피 \D 를 제거하므로 사실상 영향 0 이지만 시각적으로 깨끗. */
    wrap.addEventListener('paste', function(e){
      const cell = e.target.closest('[data-action="editDtCell"]');
      if(!cell) return;
      const txt = (e.clipboardData||window.clipboardData).getData('text');
      if(!txt) return;
      const cleaned = txt.replace(/[^0-9\s:\.\-]/g,'');
      if(cleaned !== txt){
        e.preventDefault();
        document.execCommand('insertText', false, cleaned);
      }
    }, true);
    wrap.addEventListener('blur', function(e){
      const cell = e.target.closest('[data-action="editDtCell"]');
      if(!cell) return;
      const recId = parseInt(cell.dataset.recId);
      const field = cell.dataset.field;
      const rec = _rlRecords.find(function(r){return r.id===recId;});
      if(!rec) return;
      const txt = (cell.textContent||'').trim();
      /* 입력 파싱 — "YYYY.MM.DD HH:MM" / "YY.MM.DD HH:MM" / "YYYY-MM-DD HH:MM" 모두 허용.
       * 숫자만 8+4 자리(예: 20260514 0930) 도 인식. */
      function _parseDt(s){
        if(!s || /^_+\.?_*/.test(s)) return {date:'', time:''};
        /* 숫자만: YYYYMMDD HHMM 또는 YYMMDD HHMM */
        const digitOnly = s.replace(/\D/g, '');
        if(digitOnly.length===12){
          return {date: digitOnly.slice(0,4)+'-'+digitOnly.slice(4,6)+'-'+digitOnly.slice(6,8), time: digitOnly.slice(8,10)+':'+digitOnly.slice(10,12)};
        }
        if(digitOnly.length===10){
          return {date: '20'+digitOnly.slice(0,2)+'-'+digitOnly.slice(2,4)+'-'+digitOnly.slice(4,6), time: digitOnly.slice(6,8)+':'+digitOnly.slice(8,10)};
        }
        const m = s.match(/(\d{2,4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})\s+(\d{1,2})\s*[:]\s*(\d{1,2})/);
        if(m){
          let yy = m[1]; if(yy.length===2) yy='20'+yy;
          return {
            date: yy+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0'),
            time: String(m[4]).padStart(2,'0')+':'+String(m[5]).padStart(2,'0')
          };
        }
        return null; /* 파싱 실패 */
      }
      const p = _parseDt(txt);
      if(field==='borrow'){
        if(p===null){ /* 파싱 실패 — 이전 값 복원 */ }
        else { rec.borrowDate=p.date; rec.borrowTime=p.time; }
      } else if(field==='return'){
        if(p===null){ }
        else { rec.returnDate=p.date; rec.returnTime=p.time; }
      } else if(field==='returnedAt'){
        if(p===null){ rec.returnedAt = txt; }
        else if(!p.date && !p.time){ rec.returnedAt = ''; }
        else { rec.returnedAt = p.date+' '+p.time; }
      }
      _rlSave();
      _rlRenderPreview();
      _rlRenderLeft();
    }, true);
  }
}

/* ── 안내 메시지 ── */
function _rlShowMessage(){
  const existing = document.getElementById('rlMsgOverlay');
  if(existing){closeModalWithAnim(existing); return;}

  const ov = document.createElement('div');
  ov.className = 'modal-overlay show';
  ov.id = 'rlMsgOverlay';
  ov.style.zIndex = '11000';

  function _buildMsgHtml(){
    /* 선택된 인원 정보 */
    let target=null;
    if(_rlSelectedRecId)target=_rlRecords.find(function(r){return r.id===_rlSelectedRecId;});
    if(!target){const unreturned=_rlRecords.filter(function(r){return !r.returned;});target=unreturned.length?unreturned[unreturned.length-1]:null;}
    let infoText='';
    if(target){
      const s=getStu(target.personId);
      infoText=_rlBelong(s)+' '+_rlName(s)+(target.item?' — '+target.item:'');
    }
    /* 상용 메시지 팝업 스타일 참고한 레이아웃 — 헤더 / 선택 인원 / 섹션별 카드 / 복사 버튼 */
    const _fixedPart=_rlGetFixedPart(target);
    const _itemName=(target&&target.item)||'(물품)';
    let h = '<div class="modal-content" style="width:620px;max-width:95vw;padding:0;border-radius:14px;overflow:hidden">';
    /* 헤더 */
    h += '<div style="padding:16px 22px;background:rgba(6,182,212,0.08);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center">'
      +  '<div><div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:2px">📩 안내 메시지</div>'
      +  '<div style="font-size:10.5px;color:var(--t3)">담임·학부모에게 전달할 반납 안내 문구입니다</div></div>'
      +  '</div>';
    h += '<div style="padding:18px 22px;background:var(--card)">';
    /* 선택 인원 배지 */
    if(infoText) h += '<div style="padding:10px 14px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.25);border-radius:10px;font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:14px;display:flex;align-items:center;gap:8px"><span>👤</span>'+escHtml(infoText)+'</div>';
    else h += '<div style="padding:10px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:10px;font-size:11px;color:var(--t3);margin-bottom:14px">왼쪽 미리보기 표에서 대상을 먼저 선택하세요.</div>';
    /* 섹션 1 — 자동 생성 (읽기 전용) */
    h += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:6px;letter-spacing:0.3px">① 자동 생성 (수정 불가)</div>'
      +  '<div style="padding:12px 14px;background:rgba(6,182,212,0.05);border:1px solid rgba(6,182,212,0.18);border-radius:10px;font-size:12.5px;line-height:1.75;color:var(--t1);white-space:pre-wrap">'
      +  escHtml(_fixedPart) + '\n\n'
      +  '<span style="font-weight:700;color:var(--cyan)">빌려간 물품: '+escHtml(_itemName)+'</span>'
      +  '</div></div>';
    /* 섹션 2 — 편집 가능 */
    h += '<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:6px;letter-spacing:0.3px">② 편집 가능 — 맞춤 문구 (자동 저장)</div>'
      +  '<div id="rlMsgEditable" contenteditable="true" spellcheck="false" style="padding:12px 14px;background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;font-size:12.5px;line-height:1.75;color:var(--t1);outline:none;min-height:48px;white-space:pre-wrap;transition:border-color .15s" data-focus-border="var(--cyan)" data-blur-border="var(--bdr)">'+escHtml(_rlMsgTemplate)+'</div>'
      +  '</div>';
    /* 액션 바 */
    h += '<div style="display:flex;gap:10px;align-items:center;padding-top:12px;border-top:1px dashed var(--bdr)">';
    h += '<button data-action="copyMsg" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;font-size:12px;font-weight:700;border:none;border-radius:10px;background:#0891b2;color:#fff;cursor:pointer;box-shadow:0 4px 12px rgba(6,182,212,0.25);transition:transform .15s,box-shadow .15s" data-hover-in="transform:translateY(-1px);boxShadow:0 6px 18px rgba(6,182,212,0.35)" data-hover-out="transform:translateY(0);boxShadow:0 4px 12px rgba(6,182,212,0.25)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>클립보드에 복사</button>';
    h += '<span style="flex:1;font-size:10px;color:var(--t3);line-height:1.5">자동 생성 부분은 대상·물품·날짜가 변경되면 자동 반영됩니다.</span>';
    h += '</div>';
    h += '</div></div>';
    return h;
  }

  ov.innerHTML = _buildMsgHtml();
  ov.addEventListener('mousedown',function(e){if(e.target===ov)closeModalWithAnim(ov);});
  ov.addEventListener('click',function(e){
    if(e.target.closest('[data-action="copyMsg"]')) _rlCopyMsg();
  });
  document.body.appendChild(ov);
  _makeDraggable(ov.querySelector('.modal-content'));
  _rlBindMsgEdit();
}

function _rlResolveMsg(){
  let target=null;
  if(_rlSelectedRecId)target=_rlRecords.find(function(r){return r.id===_rlSelectedRecId;});
  if(!target){const unreturned=_rlRecords.filter(function(r){return !r.returned;});target=unreturned.length?unreturned[unreturned.length-1]:null;}
  /* 메시지 조립: 인사문 + 빌려간 물건 + 편집부(언급 요청 / 감사) */
  let itemName='(물품)';
  if(target){itemName=target.item||'(물품)';}
  return _rlGetFixedPart(target)+'\n\n빌려간 물품: '+itemName+'\n\n'+String(_rlMsgTemplate||'').trim();
}

/* 한글 마지막 음절 받침 유무로 조사 선택 (을/를, 이/가, 은/는, 과/와)
   - 받침 있음 → consonantParticle, 받침 없음 → vowelParticle
   - 비한글(숫자/영문)은 받침 있는 것으로 처리 (예: "3학년" 처럼 뒤 한글이 판단) */
function _rlParticle(word,conP,vowP){
  if(!word)return conP;
  const last=String(word).trim().slice(-1);
  if(!last)return conP;
  const code=last.charCodeAt(0);
  if(code>=0xAC00&&code<=0xD7A3){
    return ((code-0xAC00)%28)!==0 ? conP : vowP;
  }
  /* 숫자/영문 끝 — 받침 기본값 */
  return conP;
}
/* 24h "HH:MM" → "오전" 또는 "오후" 만 (구체 시각 제외) */
function _rlTime12(hm){
  if(!hm)return '';
  const parts=String(hm).split(':');
  const h=parseInt(parts[0],10);
  if(isNaN(h))return '';
  return h<12?'오전':'오후';
}
/* 고정 부분 생성 (인원/대여일시) — 학교급·학과는 제외하고 학년 반 이름 학생 */
function _rlGetFixedPart(target){
  if(!target)return '안녕하세요 선생님,';
  const s=getStu(target.personId);
  let personInfo='(대여자)';
  if(s&&!s._notFound){
    if(s.type==='staff'){
      personInfo=(s.position||'교직원')+' '+(s.name||'')+'님';
    } else {
      const grade=s.grade||'';const cls=s.cls||'';const nm=s.name||'';
      personInfo=grade+'학년 '+cls+'반 '+nm+' 학생';
    }
  }
  const itemName=target.item||'(물품)';
  let borrowInfo='';
  if(target.borrowDate){
    const bp=target.borrowDate.split('-');
    const ampm=target.borrowTime?_rlTime12(target.borrowTime):'';
    borrowInfo=parseInt(bp[1])+'월 '+parseInt(bp[2])+'일'+(ampm?' '+ampm:'');
  }
  const _subjP=_rlParticle(personInfo,'이','가');
  /* 첫 문장만 반환 — 대여한 물품 표기는 _rlResolveMsg 에서 메시지 뒤에 붙임 */
  return '안녕하세요 선생님, '+personInfo+_subjP+' '+borrowInfo+'에 보건실에서 물건을 빌려갔습니다.';
}

/* 편집 가능 부분 자동 저장 — 팝업 열린 후 바인딩 */
function _rlBindMsgEdit(){
  const editable=document.getElementById('rlMsgEditable');
  if(!editable)return;
  editable.addEventListener('input',function(){
    _rlMsgTemplate=editable.innerText;
    localStorage.setItem('ec_rental_msg',_rlMsgTemplate);
  });
}


function _rlCopyMsg(){
  /* 미리보기(_rlResolveMsg)와 완전히 동일한 포맷으로 복사 — 인사문 + 빌려간 물품 + 편집부 */
  let target=null;
  if(_rlSelectedRecId)target=_rlRecords.find(function(r){return r.id===_rlSelectedRecId;});
  if(!target){const unreturned=_rlRecords.filter(function(r){return !r.returned;});target=unreturned.length?unreturned[unreturned.length-1]:null;}
  const fixed=_rlGetFixedPart(target);
  const itemName=(target&&target.item)||'(물품)';
  /* 편집부 — 사용자가 인라인 편집했다면 그 내용 우선, 아니면 저장된 템플릿 */
  const editable=document.getElementById('rlMsgEditable');
  let userPart=(editable?editable.innerText:_rlMsgTemplate)||'';
  userPart=String(userPart).trim();
  const full=fixed+'\n\n빌려간 물품: '+itemName+'\n\n'+userPart;
  if(navigator.clipboard){
    navigator.clipboard.writeText(full).then(function(){
      dailyShowToast('클립보드에 복사되었습니다.');
    });
  }
}


/* ── 인쇄용 전체 HTML (A4) ── */
function _rlFullHtml(){
  /* 인쇄 전 행 선택 배경색 제거 */
  _rlClearRowSelection();
  const content=_rlRenderA4Html();
  /* @page margin:0 — 여백은 HTML 안의 .rl-page-box padding이 담당 (미리보기와 동일) */
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>보건실 물품 대여 대장</title>'
    +'<style>'
    +'@page{size:A4;margin:0}'
    +'body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","맑은 고딕",sans-serif;color:#000;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'table{border-collapse:collapse;width:100%}td,th{font-size:10px}'
    +'tr{page-break-inside:avoid}thead{display:table-header-group}'
    +'.rl-page-box{page-break-after:always}'
    +'.rl-page-box:last-child{page-break-after:auto}'
    +'</style></head><body>'+content+'</body></html>';
}

/* ── Excel 다운로드 — 보건일지/잠복결핵/요보호와 동일한 색상바·제목·외곽선·Freeze 스타일 ── */
function _rlExportExcel(){
  if(!(window.electronAPI && window.electronAPI.xlsxBuildDiary)){
    dailyShowToast('Excel 빌드 IPC 미구성');
    return;
  }
  const yr=typeof _academicYear==='function'?_academicYear():new Date().getFullYear();
  const schoolName=(S&&S.settings&&S.settings.schoolName)||'○○학교';
  const headerLabels=[_rlHeaders.seq,_rlHeaders.belong,_rlHeaders.name,_rlHeaders.item,_rlHeaders.borrow,_rlHeaders.returnDue,_rlHeaders.done,_rlHeaders.returnAt];
  const colCount=headerLabels.length;
  const colWidths=[50,120,100,140,150,150,80,150];
  const dataRows=_rlRecords.map(function(rec,i){
    const s=getStu(rec.personId);
    return [i+1,_rlBelong(s),_rlName(s),rec.item||'',_rlFmtDt(rec.borrowDate,rec.borrowTime),_rlFmtDt(rec.returnDate,rec.returnTime),rec.returned?'O':'',rec.returnedAt?_rlFmtDt(rec.returnedAt.split(' ')[0],rec.returnedAt.split(' ')[1]):''];
  });
  const titleText=yr+'학년도 '+schoolName+' 보건실 물품 대여 대장';
  const today=new Date();
  const todayStr=today.getFullYear()+'.'+(today.getMonth()+1)+'.'+today.getDate();
  const periodText='기준일: '+todayStr;
  /* 색상바 pixel-based split */
  const totalPx=colWidths.reduce(function(a,b){return a+b;},0);
  const threshold30=totalPx*0.3;
  let acc=0,top2=0;
  for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=threshold30)break;}
  acc=0;let bot1=0;
  for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=threshold30)break;}
  const top1=Math.max(1,colCount-top2);
  dailyShowToast('Excel 생성 중…');
  window.electronAPI.xlsxBuildDiary({
    colCount:colCount,
    colWidths:colWidths,
    headerLabels:headerLabels,
    dataRows:dataRows,
    titleText:titleText,
    schoolText:'학교: '+schoolName,
    periodText:periodText,
    top1:top1,
    bot1:bot1
  }).then(function(res){
    if(!res||!res.success){dailyShowToast('Excel 생성 실패: '+(res&&res.error||''));return;}
    const buf=new Uint8Array(res.bytes);
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=titleText+'.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    dailyShowToast('Excel 파일이 저장되었습니다.');
  }).catch(function(e){dailyShowToast('Excel 오류: '+(e&&e.message||e));});
}

/* ── 인쇄 / PDF 저장 ── 공용 A4 세로 다이얼로그로 통일. 미리보기 = 실제 출력물(_rlFullHtml 그대로 iframe 렌더).
 * _rlFullHtml 은 @page{size:A4;margin:0} + .rl-page-box padding 으로 여백을 직접 통제 → 공용 다이얼로그(marginType:none) 와 정확히 일치. */
function _rlPrint(){
  const html=_rlFullHtml();
  if(!html)return;
  const yr=typeof _academicYear==='function'?_academicYear():new Date().getFullYear();
  openA4PrintDialog({html:html, title:yr+'학년도 보건실 물품 대여 대장', headerLabel:'보건실 물품 대여 대장 인쇄'});
}

/* ── 헤더 클릭 편집 ── */
function _rlEditHeader(key,thEl){
  const cur=_rlHeaders[key]||'';
  const inp=document.createElement('input');
  inp.type='text';inp.value=cur;
  inp.style.cssText='width:100%;font-size:11px;font-weight:700;border:1px solid #06b6d4;border-radius:3px;padding:2px 4px;text-align:center;background:#fff;color:#000;outline:none';
  thEl.textContent='';thEl.appendChild(inp);
  inp.focus();inp.select();
  function _commit(){
    const v=inp.value.trim()||cur;
    _rlHeaders[key]=v;_rlSaveHeaders();
    _rlRenderPreview();
  }
  inp.addEventListener('blur',_commit);
  inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){inp.value=cur;inp.blur();}});
}

/* ── 빈 행 성명 셀 클릭 → 새 레코드 생성 (일반 일지 동일 UI) ── */
function _rlNewFromPreview(tdEl){
  const wrap=document.createElement('div');wrap.className='autocomplete-wrap';wrap.style.cssText='position:relative';
  const inp=document.createElement('input');inp.type='text';inp.value='';
  inp.placeholder='이름, 학년/반/번호, 직위로 찾기';
  inp.className='form-input';
  inp.style.cssText='width:100%;font-size:11px;padding:4px 8px;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;color:var(--t1)';
  const dd=document.createElement('div');dd.className='autocomplete-list';dd.style.display='none';
  wrap.appendChild(inp);wrap.appendChild(dd);
  tdEl.textContent='';tdEl.appendChild(wrap);
  inp.focus();
  function _filter(){
    const q=inp.value.trim();if(!q){dd.style.display='none';dd.classList.remove('show');return;}
    const qLow=q.toLowerCase();
    const _startMatch=typeof matchKoreanFromStart==='function'?S.people.filter(function(s){return matchKoreanFromStart(s.name,q);}):[];
    const _otherMatch=S.people.filter(function(s){
      if(_startMatch.indexOf(s)>=0)return false;
      if(typeof matchKorean==='function'&&matchKorean(s.name,q))return true;
      const isStf=s.type==='staff';
      const searchStr=isStf?(s.name+' '+(s.position||'교직원')):(s.name+' '+s.grade+'학년'+s.cls+'반'+s.num+'번');
      return searchStr.toLowerCase().indexOf(qLow)>=0;
    });
    const matched=_startMatch.concat(_otherMatch).slice(0,50);
    if(!matched.length){dd.style.display='none';dd.classList.remove('show');return;}
    dd.innerHTML=matched.map(function(s,i){
      const isCare=s.status==='caution'||s.status==='watch';
      const isStf=s.type==='staff';
      const info=isStf?'['+(s.position||'교직원')+(isCare?' *요보호*':'')+']':'['+s.grade+'학년'+s.cls+'반'+s.num+'번'+(isCare?' *요보호*':'')+']';
      return '<div class="ac-item" data-sid="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
    }).join('');
    dd.style.display='block';dd.classList.add('show');
    dd.querySelectorAll('.ac-item').forEach(function(el){
      el.addEventListener('mousedown',function(e){
        e.preventDefault();e.stopPropagation();
        const now=new Date();
        const _retH=Math.min(now.getHours()+1,23);
        const newRec={
          id:Date.now(),personId:el.dataset.sid,item:'',
          borrowDate:toDateStr(now),borrowTime:String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),
          returnDate:toDateStr(now),returnTime:String(_retH).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),
          returned:false,returnedAt:''
        };
        _rlRecords.push(newRec);_rlActiveRecId=newRec.id;
        _rlSave();_rlRenderPreview();_rlRenderLeft();_rlShowSaveToast();
        setTimeout(function(){
          const row=document.querySelector('#rlPreviewWrap tr[data-rl-id="'+newRec.id+'"]');
          if(row){const itemTd=row.querySelectorAll('td')[3];if(itemTd)_rlEditCellItem(newRec.id,itemTd);}
        },100);
      });
    });
  }
  inp.addEventListener('input',_filter);
  inp.addEventListener('blur',function(){setTimeout(function(){_rlRenderPreview();},150);});
  inp.addEventListener('keydown',function(e){if(e.key==='Escape')_rlRenderPreview();});
}

/* ── 미리보기 셀 클릭 편집 ── */
function _rlEditCell(recId,field,tdEl){
  const rec=_rlRecords.find(function(r){return r.id===recId;});
  if(!rec)return;
  /* 학년반(소속): 상세 검색 열기 → 선택 시 성명까지 자동 입력 */
  if(field==='belong'){
    if(typeof openAdvancedSearch==='function'){
      openAdvancedSearch(function(id){
        rec.personId=id;_rlSave();_rlRenderPreview();_rlRenderLeft();_rlShowSaveToast();
      });
      setTimeout(function(){const adv=document.getElementById('advSearchOverlay');if(adv)adv.style.zIndex='11000';},50);
    }
    return;
  }
  /* 성명: 자동완성 팝업 */
  if(field==='name'){_rlCellNameAC(rec,tdEl);return;}
  /* 날짜+시간: 달력 팝업 → 확인 → 시계 팝업 (연수/교육 등록부 방식) */
  if(field==='borrowDate'||field==='returnDate'||field==='returnAt'){
    _rlCellDatePicker(rec,field,tdEl);
    return;
  }
}

/* ── 달력→시계 팝업으로 날짜+시간 편집 (전역 함수 오버라이드 없음) ── */
function _rlCellDatePicker(rec,field,tdEl){
  let curDate, curTime;
  if(field==='borrowDate'){curDate=rec.borrowDate;curTime=rec.borrowTime;}
  else if(field==='returnDate'){curDate=rec.returnDate;curTime=rec.returnTime;}
  else{const ra=(rec.returnedAt||'').split(' ');curDate=ra[0]||'';curTime=ra[1]||'';}
  /* 1단계: 날짜 입력용 임시 input → trOpenCal */
  const dateId='_rlCellD'+Date.now();
  const dateInp=document.createElement('input');dateInp.id=dateId;dateInp.type='text';dateInp.value=curDate||'';dateInp.readOnly=true;
  dateInp.style.cssText='width:100%;font-size:9px;border:1px solid #06b6d4;border-radius:3px;padding:2px 4px;background:#fff;color:#000;outline:none;cursor:pointer;text-align:center';
  tdEl.textContent='';tdEl.appendChild(dateInp);
  trOpenCal(dateId,dateInp);
  setTimeout(function(){const cw=document.getElementById('trCalWrap');if(cw)cw.style.zIndex='11500';},0);
  /* 날짜 선택 감시 (input event 발생) → 시계 팝업으로 전환 */
  dateInp.addEventListener('input',function _onDatePick(){
    dateInp.removeEventListener('input',_onDatePick);
    const pickedDate=dateInp.value;
    if(!pickedDate){_rlRenderPreview();return;}
    /* 2단계: 시간 입력용 → openClockPicker */
    const timeId='_rlCellT'+Date.now();
    dateInp.id=timeId;dateInp.value=curTime||'12:00';
    setTimeout(function(){
      openClockPicker(timeId,dateInp);
      setTimeout(function(){const cw=document.getElementById('clockPickerWrap');if(cw)cw.style.zIndex='11500';},0);
      /* 시계 닫힘 감시 */
      const _poll=setInterval(function(){
        const cw=document.getElementById('clockPickerWrap');
        if(!cw||cw.style.display==='none'){
          clearInterval(_poll);
          const pickedTime=dateInp.value||curTime||'12:00';
          if(field==='borrowDate'){rec.borrowDate=pickedDate;rec.borrowTime=pickedTime;_rlBorrowDate=pickedDate;_rlBorrowTime=pickedTime;}
          else if(field==='returnDate'){rec.returnDate=pickedDate;rec.returnTime=pickedTime;_rlReturnDate=pickedDate;_rlReturnTime=pickedTime;}
          else{rec.returnedAt=pickedDate+' '+pickedTime;}
          _rlSave();_rlRenderPreview();_rlRenderLeft();_rlShowSaveToast();
        }
      },300);
    },150);
  });
  /* 달력 외부 클릭으로 닫힐 때 → 미리보기 복원 (테두리 잔상 제거) */
  const _rlCalWatchTimer=setInterval(function(){
    const cw=document.getElementById('trCalWrap');
    const ck=document.getElementById('clockPickerWrap');
    const calOpen=cw&&cw.style.display!=='none';
    const clockOpen=ck&&ck.style.display!=='none';
    if(!calOpen&&!clockOpen&&!dateInp._done){
      clearInterval(_rlCalWatchTimer);
      _rlRenderPreview();
    }
  },500);
  dateInp._done=false;
  /* 정상 완료 시 플래그 */
  const _origInput=dateInp.addEventListener.bind(dateInp);
  dateInp.addEventListener('input',function _markDone(){dateInp._done=true;});
}
/* 성명 셀: 일반 일지와 동일한 자동완성 UI */
function _rlCellNameAC(rec,tdEl){
  const wrap=document.createElement('div');wrap.className='autocomplete-wrap';wrap.style.cssText='position:relative';
  const inp=document.createElement('input');inp.type='text';inp.value='';inp.placeholder='이름, 학년/반/번호, 직위로 찾기';
  inp.className='form-input';
  inp.style.cssText='width:100%;font-size:11px;padding:4px 8px;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;color:var(--t1)';
  const dd=document.createElement('div');dd.className='autocomplete-list show';
  dd.style.display='none';
  wrap.appendChild(inp);wrap.appendChild(dd);
  tdEl.textContent='';tdEl.appendChild(wrap);
  inp.focus();
  function _filter(){
    const q=inp.value.trim();if(!q){dd.style.display='none';dd.classList.remove('show');return;}
    const qLow=q.toLowerCase();
    const _startMatch=typeof matchKoreanFromStart==='function'?S.people.filter(function(s){return matchKoreanFromStart(s.name,q);}):[];
    const _otherMatch=S.people.filter(function(s){
      if(_startMatch.indexOf(s)>=0)return false;
      if(typeof matchKorean==='function'&&matchKorean(s.name,q))return true;
      const isStf=s.type==='staff';
      const searchStr=isStf?(s.name+' '+(s.position||'교직원')):(s.name+' '+s.grade+'학년'+s.cls+'반'+s.num+'번');
      return searchStr.toLowerCase().indexOf(qLow)>=0;
    });
    const matched=_startMatch.concat(_otherMatch).slice(0,50);
    if(!matched.length){dd.style.display='none';dd.classList.remove('show');return;}
    dd.innerHTML=matched.map(function(s,i){
      const isCare=s.status==='caution'||s.status==='watch';
      const isStf=s.type==='staff';
      const info=isStf?'['+(s.position||'교직원')+(isCare?' *요보호*':'')+']':'['+s.grade+'학년'+s.cls+'반'+s.num+'번'+(isCare?' *요보호*':'')+']';
      return '<div class="ac-item" data-sid="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
    }).join('');
    dd.style.display='block';dd.classList.add('show');
    dd.querySelectorAll('.ac-item').forEach(function(el){
      el.addEventListener('mousedown',function(e){
        e.preventDefault();e.stopPropagation();
        rec.personId=el.dataset.sid;_rlSave();_rlRenderPreview();_rlRenderLeft();_rlShowSaveToast();
      });
    });
  }
  inp.addEventListener('input',_filter);
  inp.addEventListener('blur',function(){setTimeout(function(){_rlRenderPreview();},150);});
  inp.addEventListener('keydown',function(e){if(e.key==='Escape')_rlRenderPreview();});
}
/* 물품 셀: "물품 선택 또는 입력" + 아래 물품 드롭다운 */
function _rlEditCellItem(recId,tdEl){
  const rec=_rlRecords.find(function(r){return r.id===recId;});
  if(!rec)return;
  /* 드롭다운 옵션 선택 여부 — 선택 후 input blur 가 옛 값(inp.value)으로 rec.item 을 되돌리던 버그 방지 (사용자 보고 2026-07-01) */
  let _rlItemPicked=false;
  const _rlOrigItem=(rec.item||'');   /* 드롭다운 열기 전 원래 물품 — Ctrl+Z 복구 기준 */
  const inp=document.createElement('input');inp.type='text';inp.value=rec.item||'';
  inp.placeholder='물품 선택 또는 입력';
  inp.style.cssText='width:100%;font-size:10px;border:1px solid #06b6d4;border-radius:3px;padding:2px 4px;background:#fff;color:#000;outline:none;text-align:center';
  tdEl.textContent='';tdEl.appendChild(inp);
  /* 드롭다운은 document.body 에 fixed 로 부착 → 상위 overflow 에 클리핑 방지 */
  const existingDd=document.getElementById('rlItemDropdown');if(existingDd)existingDd.remove();
  const dd=document.createElement('div');dd.id='rlItemDropdown';
  dd.style.cssText='position:fixed;z-index:99999;background:#fff;border:1px solid #06b6d4;border-radius:0 0 6px 6px;box-shadow:0 6px 18px rgba(0,0,0,0.22);min-width:160px;max-height:240px;overflow-y:auto;display:none';
  document.body.appendChild(dd);
  function _positionDd(){
    const r=inp.getBoundingClientRect();
    const ddW=Math.max(r.width,160);
    dd.style.width=ddW+'px';
    let left=r.left+r.width/2-ddW/2;
    left=Math.max(8,Math.min(left,window.innerWidth-ddW-8));
    let top=r.bottom+2;
    const maxH=240;
    if(top+maxH>window.innerHeight-8)top=Math.max(8,r.top-maxH-2);
    dd.style.left=left+'px';dd.style.top=top+'px';
  }
  inp.focus();if(rec.item)inp.select();
  function _buildList(showAll){
    const q=showAll?'':inp.value.trim().toLowerCase();
    dd.innerHTML='';
    const list=q?_rlItems.filter(function(it){return it.toLowerCase().indexOf(q)>=0;}):_rlItems;
    if(!list.length){dd.style.display='none';return;}
    dd.style.display='block';_positionDd();
    list.forEach(function(item){
      const opt=document.createElement('div');opt.textContent=item;
      opt.style.cssText='padding:6px 12px;font-size:11px;cursor:pointer;color:#000;border-bottom:1px solid #eee;text-align:center';
      opt.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.1)';});
      opt.addEventListener('mouseleave',function(){this.style.background='#fff';});
      opt.addEventListener('mousedown',function(e){
        e.preventDefault();e.stopPropagation();
        _rlItemPicked=true;   /* blur 되돌림 방지 */
        if(item!==_rlOrigItem) _rlItemUndo={recId:rec.id, prevItem:_rlOrigItem};   /* Ctrl+Z 복구용 */
        rec.item=item;_rlSave();_closeDd();_rlRenderPreview();_rlRenderLeft();_rlShowSaveToast();
      });
      dd.appendChild(opt);
    });
  }
  function _closeDd(){if(dd&&dd.parentNode)dd.remove();window.removeEventListener('scroll',_onScroll,true);window.removeEventListener('resize',_positionDd);}
  function _onScroll(){_positionDd();}
  _buildList(true);   /* 셀 클릭 첫 표시: 현재 값과 무관하게 등록 물품 전체를 드롭다운에 노출 (사용자 보고 2026-06-30) */
  window.addEventListener('scroll',_onScroll,true);
  window.addEventListener('resize',_positionDd);
  /* 입력 시마다 자동 저장 + 토스트 — Enter 없이 즉시 반영 */
  let _rlItemInpTimer=null;
  inp.addEventListener('input',function(){
    _buildList();
    rec.item=inp.value;
    /* 짧은 디바운스로 연속 타이핑을 단일 저장으로 병합 */
    if(_rlItemInpTimer)clearTimeout(_rlItemInpTimer);
    _rlShowSaveToast();
    _rlItemInpTimer=setTimeout(function(){_rlSave();_rlRenderLeft();},200);
  });
  inp.addEventListener('blur',function(){
    setTimeout(function(){
      if(_rlItemPicked)return;   /* 드롭다운에서 물품을 골랐으면 이미 저장·재렌더됨 → 옛 값으로 되돌리지 않음 */
      /* blur 시 drop 닫고 확정 저장(미보류 타이머 처리) */
      if(_rlItemInpTimer){clearTimeout(_rlItemInpTimer);_rlItemInpTimer=null;}
      rec.item=inp.value.trim();
      _rlSave();_rlRenderLeft();
      _closeDd();_rlRenderPreview();
    },150);
  });
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();const v=inp.value.trim();rec.item=v;_rlSave();_closeDd();_rlRenderPreview();_rlRenderLeft();_rlShowSaveToast();}
    if(e.key==='Escape'){_closeDd();_rlRenderPreview();}
  });
}

/* ── 행 호버 삭제 버튼 (테이블 밖 fixed) ── */
let _rlRowXEl=null;
let _rlRowXHideTimer=null;
function _rlShowRowX(tr,recId){
  if(_rlRowXHideTimer){clearTimeout(_rlRowXHideTimer);_rlRowXHideTimer=null;}
  if(!_rlRowXEl){
    _rlRowXEl=document.createElement('div');
    /* 클릭 여유를 위해 크기 확대 + hover 판정 확장(padding 포함) */
    _rlRowXEl.style.cssText='position:fixed;width:22px;height:22px;background:rgba(239,68,68,0.18);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#ef4444;font-size:11px;font-weight:700;z-index:11000;border:1px solid rgba(239,68,68,0.35);transition:background .12s,transform .12s';
    _rlRowXEl.textContent='✕';
    _rlRowXEl.addEventListener('mouseenter',function(){
      if(_rlRowXHideTimer){clearTimeout(_rlRowXHideTimer);_rlRowXHideTimer=null;}
      _rlRowXEl.style.background='rgba(239,68,68,0.28)';
      _rlRowXEl.style.transform='scale(1.08)';
    });
    _rlRowXEl.addEventListener('mouseleave',function(){
      _rlRowXEl.style.background='rgba(239,68,68,0.18)';
      _rlRowXEl.style.transform='';
      _rlHideRowX();
    });
    document.body.appendChild(_rlRowXEl);
  }
  const r=tr.getBoundingClientRect();
  /* CSS zoom 보정: getBoundingClientRect 는 zoom 적용된 시각 픽셀을 반환하지만, body 에 붙은 fixed 요소의
   * left/top 은 다시 zoom 으로 스케일되므로 zoom 으로 나눠 CSS 픽셀 좌표로 변환해야 위치가 일치한다.
   * (이전 100% 에서 정확히 행 우측 안쪽에 위치하던 X 버튼이 110% 에서 1.10× 추가로 이동해 모달 바깥으로 나가던 원인) */
  let _z=1;
  try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _z=window.ecZoom.get()||1; }catch(_){}
  const _btnW=22;
  const _modal=document.querySelector('#rentalLedgerOverlay .modal-content');
  const _modalRect=_modal?_modal.getBoundingClientRect():null;
  const _maxRightCss=((_modalRect?_modalRect.right:window.innerWidth)-6)/_z;
  let _left=(r.right-2)/_z;
  if(_left+_btnW>_maxRightCss)_left=_maxRightCss-_btnW;
  _rlRowXEl.style.left=_left+'px';
  _rlRowXEl.style.top=((r.top+r.height/2-11)/_z)+'px';
  _rlRowXEl.style.display='flex';
  _rlRowXEl.dataset.recId=recId;
  if(!_rlRowXEl._bound){
    _rlRowXEl.addEventListener('click',function(){_rlDelete(parseInt(_rlRowXEl.dataset.recId));_rlRowXEl.style.display='none';});
    _rlRowXEl._bound=true;
  }
}
function _rlHideRowX(){
  /* 팝업이 너무 빨리 사라져 삭제 클릭이 어렵다는 이슈 — 여유있게 2초로 연장 */
  _rlRowXHideTimer=setTimeout(function(){if(_rlRowXEl)_rlRowXEl.style.display='none';_rlRowXHideTimer=null;},2000);
}

/* 물품 대여 대장: localStorage only (매년 3/1 초기화 대상, DB 저장 안 함) */

/* ── 상세 검색 래퍼 ── */
function _rlOpenAdvSearch(){
  openAdvancedSearch(function(id){ _rlSelectPerson(id); });
  /* 상세 검색 팝업을 물품 대여 대장 위에 표시 */
  setTimeout(function(){
    const adv=document.getElementById('advSearchOverlay');
    if(adv)adv.style.zIndex='11000';
  },50);
}
/* 빈 행 학년반(소속) 클릭 → 상세 검색 → 새 레코드 생성 */
function _rlNewFromPreviewAdvSearch(){
  if(typeof openAdvancedSearch==='function'){
    openAdvancedSearch(function(id){ _rlSelectPerson(id); });
    setTimeout(function(){const adv=document.getElementById('advSearchOverlay');if(adv)adv.style.zIndex='11000';},50);
  }
}

/* ── window expose (only externally used functions) ── */

