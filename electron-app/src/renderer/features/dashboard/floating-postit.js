/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * 📌 떠다니는 포스트잇 (floating-postit.js)
 *
 * 어느 화면에서나 화면 위에 떠 있는 포스트잇 메모. 작은 제목 막대(헤더)를 드래그해 이동한다.
 * 데이터는 홈 대시보드의 '포스트잇 메모'(ec_home_memos)와 완전히 공유 —
 *  한쪽에서 고치면 home:memos-changed 이벤트로 양쪽이 즉시 따라온다.
 * 일반/응급/감염 일지 배경 우클릭 메뉴의 '포스트잇 켜기/끄기'로 토글.
 */
/* ES Module */
import { escHtml } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { homeMemosGet, homeMemosSet, homeMemoColors } from './home-dashboard.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';

const _POS_KEY = 'ec_floating_postit_pos';
const _OPEN_KEY = 'ec_floating_postit_open';
let _saveTimers = {};

function _isOpen(){ return !!document.getElementById('floatingPostit'); }

export function toggleFloatingPostit(){
  if(_isOpen()) closeFloatingPostit();
  else openFloatingPostit();
}

export function openFloatingPostit(){
  if(_isOpen()) return;
  const box = document.createElement('div');
  box.id = 'floatingPostit';
  box.className = 'floating-postit fpostit-hidden';
  box.innerHTML =
      '<div class="fpostit-head" id="fpostitHead">'
    +   '<span class="fpostit-title">📌 포스트잇</span>'
    +   '<span class="fpostit-actions">'
    +     '<button class="fpostit-btn" data-fp="add" title="새 메모 추가">＋</button>'
    +     '<button class="fpostit-btn" data-fp="close" data-tooltip="닫기: 모든 내용은 자동 저장된 채로 닫힙니다." data-tooltip-instant="1">✕</button>'
    +   '</span>'
    + '</div>'
    + '<div class="fpostit-body" id="fpostitBody"></div>';
  document.body.appendChild(box);
  _restorePos(box);
  _renderList();
  _bindHead(box);
  /* 헤더 버튼(추가/닫기) — 위임 */
  box.addEventListener('click', function(e){
    const b = e.target.closest('.fpostit-head [data-fp]');
    if(!b) return;
    const act = b.dataset.fp;
    if(act==='close') closeFloatingPostit();
    else if(act==='add') _addMemo();
  });
  /* 등장 애니메이션 — 다음 프레임에 hidden 해제 */
  requestAnimationFrame(function(){ box.classList.remove('fpostit-hidden'); });
  try{ localStorage.setItem(_OPEN_KEY,'1'); }catch(_){}
}

export function closeFloatingPostit(){
  const el = document.getElementById('floatingPostit');
  if(el){
    el.classList.add('fpostit-hidden');        /* 부드럽게 사라진 뒤 제거 */
    if(el._fpCleanup) el._fpCleanup();
    setTimeout(function(){ if(el.parentNode) el.remove(); }, 240);
  }
  try{ localStorage.setItem(_OPEN_KEY,'0'); }catch(_){}
}

/* 뷰 전환 시 — 홈 대시보드(포스트잇 메모 위젯과 중복)에선 숨기고, 다른 탭으로 가면 켜진 상태일 때 다시 표시 */
export function floatingPostitOnViewChange(view){
  if(localStorage.getItem(_OPEN_KEY) !== '1') return;   /* 꺼진 상태면 관여 안 함 */
  if(view === 'home'){
    const el = document.getElementById('floatingPostit');
    if(el) el.classList.add('fpostit-hidden');          /* 부드럽게 사라짐 (DOM 유지) */
  } else {
    const el = document.getElementById('floatingPostit');
    if(!el){ openFloatingPostit(); return; }             /* 없으면 새로 등장(자체 애니메이션) */
    requestAnimationFrame(function(){ el.classList.remove('fpostit-hidden'); });  /* 부드럽게 나타남 */
  }
}

/* ── 메모 목록 렌더 ── */
function _renderList(){
  const body = document.getElementById('fpostitBody');
  if(!body) return;
  const items = homeMemosGet();
  const colors = homeMemoColors();
  if(!items.length){
    body.innerHTML = '<div class="fpostit-empty">＋ 로 메모를 추가하세요</div>';
    return;
  }
  body.innerHTML = items.map(function(m,i){
    const col = m.color || colors[i%colors.length];
    return '<div class="fpostit-card" style="background:'+col+'">'
      + '<button class="fpostit-del" data-fp-del="'+escHtml(String(m.id))+'" title="삭제">✕</button>'
      + '<div contenteditable="true" class="fpostit-edit" data-fp-edit="'+escHtml(String(m.id))+'">'+escHtml(m.text||'')+'</div>'
      + '</div>';
  }).join('');
  _bindEditors();
}

function _bindEditors(){
  const body = document.getElementById('fpostitBody');
  if(!body) return;
  body.querySelectorAll('[data-fp-edit]').forEach(function(el){
    el.addEventListener('input', function(){
      const id = el.dataset.fpEdit;
      if(_saveTimers[id]) clearTimeout(_saveTimers[id]);
      _saveTimers[id] = setTimeout(function(){
        const items = homeMemosGet();
        const m = items.find(function(x){ return String(x.id)===String(id); });
        if(m){ m.text = el.innerText; m.updatedAt = new Date().toISOString(); homeMemosSet(items,'floating'); }
      }, 350);
    });
    /* 붙여넣기 위생화 — 서식 제거 (홈 메모와 동일 정책) */
    el.addEventListener('paste', function(e){
      e.preventDefault();
      const text = (e.clipboardData||window.clipboardData).getData('text');
      document.execCommand('insertText', false, text);
    });
  });
  body.querySelectorAll('[data-fp-del]').forEach(function(el){
    el.addEventListener('click', function(){
      const id = el.dataset.fpDel;
      const items = homeMemosGet().filter(function(x){ return String(x.id)!==String(id); });
      homeMemosSet(items,'floating');
      _renderList();
    });
  });
}

function _addMemo(){
  const items = homeMemosGet();
  const colors = homeMemoColors();
  const id = Date.now() + Math.floor(Math.random()*1000);
  items.unshift({ id:id, text:'', color:colors[items.length%colors.length], updatedAt:new Date().toISOString() });
  homeMemosSet(items,'floating');
  _renderList();
  const body = document.getElementById('fpostitBody');
  const nw = body && body.querySelector('[data-fp-edit="'+id+'"]');
  if(nw) nw.focus();
}

/* ── 헤더 드래그로 이동 ── */
function _bindHead(box){
  const head = document.getElementById('fpostitHead');
  if(!head) return;
  /* 제목 막대 hover — 대시보드 동기화 안내 미니 팝업 */
  head.addEventListener('mouseenter', function(e){ showHeaderTooltip(e, '대시보드의 포스트잇과 동기화됩니다.', false, true); });
  head.addEventListener('mouseleave', function(){ hideHeaderTooltip(); });
  let dragging=false, sx=0, sy=0, ox=0, oy=0;
  function _down(e){
    if(e.target.closest('[data-fp]')) return; /* 버튼 클릭은 드래그 아님 */
    dragging = true;
    const r = box.getBoundingClientRect();
    sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top;
    document.body.style.userSelect='none';
    e.preventDefault();
  }
  function _mv(e){
    if(!dragging) return;
    let nx = ox + (e.clientX-sx), ny = oy + (e.clientY-sy);
    nx = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, nx));
    ny = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, ny));
    box.style.left = nx+'px'; box.style.top = ny+'px'; box.style.right='auto';
  }
  function _up(){
    if(!dragging) return;
    dragging = false;
    document.body.style.userSelect='';
    _savePos(box);
  }
  head.addEventListener('mousedown', _down);
  document.addEventListener('mousemove', _mv);
  document.addEventListener('mouseup', _up);
  /* 포스트잇 바깥(다른 공간) 클릭 시 편집 포커스 해제 → :focus-within 선택 테두리 제거 (사용자 요청 2026-06-18).
   *  contenteditable 은 비-포커스 요소를 클릭해도 포커스를 유지하므로 명시적으로 blur 해 준다. */
  function _outsideBlur(e){
    if(box.contains(e.target)) return;
    const ae=document.activeElement;
    if(ae && ae.classList && ae.classList.contains('fpostit-edit')){ try{ ae.blur(); }catch(_){} }
  }
  document.addEventListener('mousedown', _outsideBlur, true);
  box._fpCleanup = function(){
    document.removeEventListener('mousemove', _mv);
    document.removeEventListener('mouseup', _up);
    document.removeEventListener('mousedown', _outsideBlur, true);
  };
}

function _savePos(box){
  try{ localStorage.setItem(_POS_KEY, JSON.stringify({left:box.offsetLeft, top:box.offsetTop})); }catch(_){}
}
function _restorePos(box){
  let pos=null;
  try{ pos = JSON.parse(localStorage.getItem(_POS_KEY)||'null'); }catch(_){}
  if(pos && typeof pos.left==='number'){
    box.style.left = Math.max(0, Math.min(window.innerWidth-60, pos.left))+'px';
    box.style.top  = Math.max(0, Math.min(window.innerHeight-40, pos.top))+'px';
    box.style.right = 'auto';
  } else {
    /* 최초: 우측 상단 근처 */
    box.style.right = '24px';
    box.style.top = '90px';
  }
}

/* 홈 위젯·다른 경로에서 메모가 바뀌면 떠다니는 포스트잇도 따라 갱신 (자기 입력은 skip) */
bus.on('home:memos-changed', function(source){
  if(source==='floating') return;
  if(_isOpen()) _renderList();
});

/* 앱 시작 시 마지막 상태 복원 — 켜 둔 채 종료했으면 다시 띄운다 */
function _restoreOnBoot(){
  try{ if(localStorage.getItem(_OPEN_KEY)==='1') openFloatingPostit(); }catch(_){}
}
if(document.body) _restoreOnBoot();
else document.addEventListener('DOMContentLoaded', _restoreOnBoot);
