/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* Presentation-only dragging for independent dialogs. No settings or records are written. */
(function initAutoPopupDrag(){
  if(window._autoPopupDragInited)return;
  window._autoPopupDragInited=true;
  const overlays='.modal-overlay,.qm-overlay,.vp-overlay,.ems-overlay,.ec-form-overlay,.sv-modal-overlay,.nl-overlay,.memo-popup-overlay,.magic-link-popup-overlay,.school-confirm-overlay,[id$="Overlay"],[id$="OverlayRoot"],[id$="Modal"]';
  const boxes='#symCatBox,.modal-content,.vp-modal,.ems-modal,.qm-container,.ec-form-modal,.sv-modal,.nl-modal,.school-confirm-dialog,.popup-box,.modal-box,dialog';
  const headers='[data-drag-handle],.sym-editor-topline,.modal-header,.popup-header,.vp-header,.ems-modal-header,.qm-header,.nl-header,.sym-header,.tr-header,.ec-form-header,.sv-modal-header,.school-confirm-header,.drag-handle';
  const excluded='#splash,#cdkeyGateOverlay,#cpDragOverlay,[data-no-drag],[data-sym-focus-dock="1"],.cell-ac-popup,.ems-mini-popup,.sym-category-picker,.sym-focus-filter-panel,.sym-focus-inline-unit-editor,.school-context-backdrop,[role="tooltip"],[role="listbox"],[role="menu"]';
  const interactive='button,input,select,textarea,a,label,summary,[role="button"],[role="tab"],[role="combobox"],[role="menuitem"],[contenteditable]:not([contenteditable="false"]),[data-action],[data-no-drag]';
  const managed=new Map();
  let resizeFrame=0;
  function ignored(el){return !(el instanceof HTMLElement)||!!el.closest(excluded);}
  function contentChild(el){return [...el.children].find(c=>c instanceof HTMLElement&&!['STYLE','SCRIPT','TEMPLATE','LINK'].includes(c.tagName))||null;}
  function findBox(overlay){
    const direct=[...overlay.children].find(c=>c.matches?.(boxes));
    if(direct)return direct;
    const nested=overlay.querySelector(boxes);
    return nested||contentChild(overlay);
  }
  function findHeader(box){
    const marked=box.querySelector('[data-drag-handle]');
    if(marked)return marked;
    const named=box.querySelector(headers+', [class*="modal-header"], [id$="Header"], [id$="Title"]');
    if(named)return named;
    const first=contentChild(box);
    if(!first||first.matches(interactive)||first.matches('form,table,iframe,canvas'))return null;
    return first;
  }
  function scale(){
    const z=Number.parseFloat(getComputedStyle(document.documentElement).zoom);
    return Number.isFinite(z)&&z>0?z:1;
  }
  function limits(rect){
    const view=window.visualViewport;
    const left=view?.offsetLeft||0,top=view?.offsetTop||0,margin=12*scale();
    return {left:left+margin,top:top+margin,right:Math.max(left+margin,left+(view?.width||innerWidth)-rect.width-margin),bottom:Math.max(top+margin,top+(view?.height||innerHeight)-rect.height-margin)};
  }
  function position(box,x,y){
    const rect=box.getBoundingClientRect(),bound=limits(rect),z=scale();
    const left=Math.max(bound.left,Math.min(bound.right,x)),top=Math.max(bound.top,Math.min(bound.bottom,y));
    const oldLeft=Number.parseFloat(box.style.left)||0,oldTop=Number.parseFloat(box.style.top)||0;
    // Delta correction also works when an overlay establishes a containing block.
    box.style.setProperty('left',(oldLeft+(left-rect.left)/z)+'px','important');
    box.style.setProperty('top',(oldTop+(top-rect.top)/z)+'px','important');
  }
  function apply(box){
    if(ignored(box)||box._autoDragApplied)return;
    const handle=findHeader(box);
    if(!handle||handle._autoDragApplied)return;
    // Existing manually attached drag handlers remain their original owner's responsibility.
    if(['grab','grabbing','move'].includes(handle.style.cursor))return;
    box._autoDragApplied=true;handle._autoDragApplied=true;
    handle.style.cursor='grab';handle.style.userSelect='none';handle.style.touchAction='none';
    let drag=null;
    function finish(){
      if(!drag)return;
      const id=drag.id,transition=drag.transition;drag=null;
      handle.style.cursor='grab';box.style.transition=transition;
      if(handle.hasPointerCapture?.(id))handle.releasePointerCapture(id);
    }
    function down(e){
      if(e.button!==0||!e.isPrimary||ignored(box)||e.target.closest(interactive))return;
      const rect=box.getBoundingClientRect();if(!rect.width||!rect.height)return;
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,transition:box.style.transition,moved:false};
      handle.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
    }
    function move(e){
      if(!drag||e.pointerId!==drag.id)return;
      if(!box.isConnected){finish();return;}
      if(!drag.moved){
        if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<3)return;
        const rect=box.getBoundingClientRect(),style=getComputedStyle(box),z=scale();
        box.style.transition='none';
        if(!['fixed','absolute'].includes(style.position))box.style.width=(rect.width/z)+'px';
        box.style.setProperty('position','fixed','important');
        box.style.setProperty('transform','none','important');
        box.style.setProperty('margin','0','important');
        box.style.setProperty('right','auto','important');box.style.setProperty('bottom','auto','important');
        if(box.getAttribute('data-ec-zoom-rebound')==='card')box.removeAttribute('data-ec-zoom-rebound');
        box.style.setProperty('left','0px','important');box.style.setProperty('top','0px','important');
        position(box,rect.left,rect.top);
        box.dataset.popupDragged='1';drag.moved=true;handle.style.cursor='grabbing';
      }
      position(box,drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);e.preventDefault();
    }
    handle.addEventListener('pointerdown',down);
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',finish);
    handle.addEventListener('lostpointercapture',finish);
    managed.set(box,{handle,finish});
  }
  function process(node){
    if(!(node instanceof HTMLElement)||ignored(node))return;
    if(node.matches(boxes)){apply(node);return;}
    if(node.matches(overlays)){const box=findBox(node);if(box)apply(box);return;}
    if(node.matches('[role="dialog"]')||node.parentElement===document.body){
      const style=getComputedStyle(node),rect=node.getBoundingClientRect();
      if(node.matches('[role="dialog"]')||(style.position==='fixed'&&Number.parseInt(style.zIndex,10)>=1000)){
        const full=rect.width>=innerWidth-32&&rect.height>=innerHeight-32&&rect.left<=16&&rect.top<=16;
        apply(full?(findBox(node)||node):node);return;
      }
    }
    node.querySelectorAll(boxes+','+overlays+',[role="dialog"]').forEach(el=>process(el));
  }
  function clampMoved(){
    resizeFrame=0;
    managed.forEach((entry,box)=>{
      if(!box.isConnected){entry.finish();managed.delete(box);return;}
      if(box.dataset.popupDragged!=='1')return;
      const rect=box.getBoundingClientRect();
      if(rect.width&&rect.height)position(box,rect.left,rect.top);
    });
  }
  function scheduleClamp(){if(!resizeFrame)resizeFrame=requestAnimationFrame(clampMoved);}
  function start(){
    document.querySelectorAll(boxes+','+overlays+',[role="dialog"]').forEach(process);
    new MutationObserver(records=>{
      let removed=false;
      records.forEach(record=>{
        record.addedNodes.forEach(process);
        if(record.addedNodes.length&&record.target instanceof HTMLElement){
          const owner=record.target.closest(boxes);if(owner)apply(owner);
        }
        removed||=record.removedNodes.length>0;
      });
      if(removed)managed.forEach((entry,box)=>{if(!box.isConnected){entry.finish();managed.delete(box);}});
    }).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',scheduleClamp,{passive:true});
    window.visualViewport?.addEventListener('resize',scheduleClamp,{passive:true});
    window.addEventListener('ec:zoom-changed',scheduleClamp);
    window.addEventListener('blur',()=>managed.forEach(entry=>entry.finish()));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
