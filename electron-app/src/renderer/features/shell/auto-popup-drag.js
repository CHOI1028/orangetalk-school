/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module — auto-popup-drag.js
 *
 * 모든 팝업/모달의 제목(헤더) 영역을 자동으로 드래그 가능하게 만듭니다.
 * MutationObserver로 DOM에 새 팝업이 추가될 때마다 감지하여 자동 적용.
 *
 * 헤더 후보 (자동 탐지):
 *   1. .modal-header / .popup-header / .vp-header / .ems-modal-header
 *   2. [data-drag-handle] 또는 .drag-handle
 *   3. .modal-content 의 첫 번째 자식 (display:flex 또는 padding 있는 div)
 *   4. id 가 *Header / *Title 로 끝나는 요소
 *
 * 적용 대상 (자동 탐지):
 *   - .modal-overlay 직계 / id 가 *Overlay 로 끝나는 요소
 *   - position:fixed 이고 z-index >= 1000 인 박스 (단, body 직계만)
 *
 * 이미 드래그 가능한 박스(_autoDragApplied 플래그 있음)는 건너뜀.
 */

(function _initAutoPopupDrag(){
  if(window._autoPopupDragInited) return;
  window._autoPopupDragInited = true;

  /* 헤더로 인식할 클래스 패턴 */
  const HEADER_CLASS_PATTERNS = [
    'modal-header','popup-header','vp-header','ems-modal-header',
    'qm-header','nl-header','sym-header','tr-header','drag-handle'
  ];

  /* 박스 식별: 모달 컨텐츠 박스. 드래그 적용 대상 */
  function _findDragBox(overlay){
    /* 우선순위 1: .modal-content / .vp-modal / .ems-modal / .qm-container */
    const candidates = ['.modal-content','.vp-modal','.ems-modal','.qm-container','.popup-box','.modal-box'];
    for(let i=0;i<candidates.length;i++){
      const el = overlay.querySelector(candidates[i]);
      if(el) return el;
    }
    /* 우선순위 2: overlay 의 첫 번째 자식 (보통 컨텐츠 박스) */
    const fc = overlay.firstElementChild;
    if(fc && fc.tagName !== 'STYLE' && fc.tagName !== 'SCRIPT') return fc;
    return null;
  }

  /* 헤더 요소 탐지 */
  function _findHeaderEl(box){
    if(!box) return null;
    /* 1) data-drag-handle */
    let h = box.querySelector('[data-drag-handle]');
    if(h) return h;
    /* 2) 클래스 매칭 */
    for(let i=0;i<HEADER_CLASS_PATTERNS.length;i++){
      h = box.querySelector('.'+HEADER_CLASS_PATTERNS[i]);
      if(h && box.contains(h)) return h;
    }
    /* 3) class*="modal-header" 또는 *Header / *Title id */
    h = box.querySelector('[class*="modal-header"]');
    if(h) return h;
    h = box.querySelector('[id$="Header"],[id$="Title"]');
    if(h && box.contains(h)) return h;
    /* 4) box 의 첫 번째 자식 (보편적 패턴) */
    const fc = box.firstElementChild;
    if(fc) return fc;
    return null;
  }

  /* 드래그 가능 여부 점검: 이미 드래그 핸들러 부착된 경우 건너뜀 */
  function _alreadyDraggable(headerEl){
    if(!headerEl) return true;
    if(headerEl._autoDragApplied) return true;
    /* cursor:grab 이 inline 으로 설정되었으면 누군가가 이미 처리 */
    const inline = headerEl.style && headerEl.style.cursor;
    if(inline === 'grab' || inline === 'grabbing' || inline === 'move') return true;
    return false;
  }

  /* 인터랙티브 자식 (버튼·입력·data-action 칩 등) 클릭 시 드래그 시작 안 함.
   *  ★ [data-action] 추가 (2026-06-18) — 헤더의 클릭 칩(요보호·동의·시간 등 span)이 드래그로 가로채여
   *    grab 커서·팝업 이동이 일어나던 문제 해결. 클릭 가능한 요소는 모두 드래그 제외. */
  function _isInteractiveTarget(target){
    if(!target) return false;
    return !!target.closest('button,input,select,textarea,a,[role="button"],[contenteditable="true"],[data-action]');
  }

  /* 박스에 드래그 적용 */
  function _applyDrag(box){
    if(!box || box._autoDragApplied) return;
    const headerEl = _findHeaderEl(box);
    if(!headerEl) return;
    if(_alreadyDraggable(headerEl)) return;

    box._autoDragApplied = true;
    headerEl._autoDragApplied = true;
    headerEl.style.cursor = 'grab';
    headerEl.style.userSelect = 'none';

    /* 위치 정규화 — 실제 드래그 시작 직전에만 transform→pixel 좌표로 변환.
       이전엔 setTimeout(260ms) 으로 자동 호출했으나, 그 시점이 사용자 호버와
       겹치면 "호버 시 팝업이 살짝 이동" 처럼 보이는 부작용이 있어 제거.
       이제 호버는 어떠한 위치 변화도 일으키지 않음. */
    let _normalized = false;
    function _normalize(){
      if(_normalized) return;
      const rect = box.getBoundingClientRect();
      if(rect.width === 0 || rect.height === 0) return;
      _normalized = true;
      const prevTransition = box.style.transition;
      box.style.transition = 'none';
      box.style.transform = 'none';
      box.style.margin = '0';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
      box.style.position = 'fixed';
      box.style.left = Math.round(rect.left) + 'px';
      box.style.top  = Math.round(rect.top)  + 'px';
      void box.offsetWidth; /* reflow */
      box.style.transition = prevTransition;
    }

    const dd = { active:false, offX:0, offY:0 };
    function _down(e){
      if(_isInteractiveTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      _normalize();
      dd.active = true;
      const r = box.getBoundingClientRect();
      dd.offX = e.clientX - r.left;
      dd.offY = e.clientY - r.top;
      headerEl.style.cursor = 'grabbing';
    }
    function _move(e){
      if(!dd.active) return;
      box.style.left = (e.clientX - dd.offX) + 'px';
      box.style.top  = (e.clientY - dd.offY) + 'px';
    }
    function _up(){
      if(dd.active){ dd.active = false; headerEl.style.cursor = 'grab'; }
    }
    headerEl.addEventListener('mousedown', _down);
    document.addEventListener('mousemove', _move);
    document.addEventListener('mouseup', _up);
  }

  /* 추가된 노드가 드래그 대상인지 검사 후 적용 */
  function _processNode(node){
    if(!node || node.nodeType !== 1) return; /* Element only */
    /* 1) overlay 클래스 또는 id 가 *Overlay 로 끝남 */
    const isOverlay =
      (node.classList && (node.classList.contains('modal-overlay'))) ||
      (typeof node.id === 'string' && /Overlay$/.test(node.id));
    if(isOverlay){
      const box = _findDragBox(node);
      if(box) _applyDrag(box);
      return;
    }
    /* 2) body 직계로 추가된 fixed + 높은 z-index 박스 */
    if(node.parentNode === document.body){
      const cs = window.getComputedStyle(node);
      if(cs.position === 'fixed'){
        const z = parseInt(cs.zIndex, 10);
        if(!isNaN(z) && z >= 1000){
          /* 자체가 박스라면 직접, 아니면 .modal-content 류 검색 */
          const inner = _findDragBox(node) || node;
          _applyDrag(inner);
          return;
        }
      }
    }
    /* 3) 자식 트리에 overlay 가 들어있을 가능성 검사 */
    if(node.querySelectorAll){
      const subs = node.querySelectorAll('.modal-overlay,[id$="Overlay"]');
      subs.forEach(function(sub){
        const box = _findDragBox(sub);
        if(box) _applyDrag(box);
      });
    }
  }

  /* MutationObserver — body 자식 추가 감지 */
  function _start(){
    if(!document.body) return;
    /* 시작 시 이미 떠있는 모달도 처리 */
    document.querySelectorAll('.modal-overlay,[id$="Overlay"]').forEach(function(ov){
      const box = _findDragBox(ov);
      if(box) _applyDrag(box);
    });
    const mo = new MutationObserver(function(muts){
      for(let i=0;i<muts.length;i++){
        const m = muts[i];
        if(m.type !== 'childList') continue;
        for(let j=0;j<m.addedNodes.length;j++){
          _processNode(m.addedNodes[j]);
        }
      }
    });
    mo.observe(document.body, { childList:true, subtree:true });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }
})();
