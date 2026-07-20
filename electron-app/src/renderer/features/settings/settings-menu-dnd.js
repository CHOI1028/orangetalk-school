/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { renderSettingsPanel } from './settings-view.js';
import { switchView } from '../shell/view-router.js';

/* ═══ TOP MENU DND (mouse-based) ═══ */
let _tmDrag=null, _tmClone=null, _tmOffX=0;
export function getTopMenuVisibility(){
  return JSON.parse(localStorage.getItem('ec_tab_visibility')||'null')||{};
}
function saveTopMenuVisibility(state){
  localStorage.setItem('ec_tab_visibility',JSON.stringify(state||{}));
}
export function toggleTopMenuVisibility(view){
  /* 켜고 끌 수 있는 건 대시보드(home)만 (사용자 요청 2026-05-28). 나머지 탭은 항상 표시. */
  if(view!=='home') return;
  const vis=getTopMenuVisibility();
  const cur=vis[view]!==false;
  vis[view]=!cur;
  saveTopMenuVisibility(vis);
  applyTabOrder();
  renderSettingsPanel('topmenu');
}
export function initTopMenuDnD(){
  const list=document.getElementById('dragTabList');
  if(!list)return;
  /* 눈알 토글 클릭 위임 — 항목 안의 [data-tm-eye] 요소 클릭 시 표시/숨김 전환.
   * 드래그(mousedown) 와 같은 요소에서 발화하지 않게, 눈알 element 위에서는 mousedown 도 차단. */
  list.addEventListener('click',function(e){
    const eye = e.target.closest('[data-tm-eye]');
    if(!eye) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTopMenuVisibility(eye.getAttribute('data-tm-eye'));
  });
  list.addEventListener('mousedown',function(e){
    /* 눈알 위에서는 드래그 시작 안 함 (toggle 만 됨) */
    if(e.target.closest && e.target.closest('[data-tm-eye]')){ return; }
    const item=e.target.closest('.drag-tab-item');
    if(!item)return;
    /* 오렌지팜은 항상 맨 오른쪽 고정 — 드래그 자체를 막음 */
    if(item.dataset.view==='orange') return;
    e.preventDefault();
    _tmDrag=item;
    const rect=item.getBoundingClientRect();
    _tmOffX=e.clientX-rect.left;
    _tmClone=item.cloneNode(true);
    _tmClone.style.cssText='position:fixed;top:'+rect.top+'px;left:'+rect.left+'px;width:'+rect.width+'px;opacity:0.8;z-index:9999;pointer-events:none;border:2px solid var(--cyan);border-radius:8px;background:var(--card);padding:10px 16px;display:flex;align-items:center;gap:6px';
    document.body.appendChild(_tmClone);
    item.style.opacity='0.3';
    document.addEventListener('mousemove',_tmMove);
    document.addEventListener('mouseup',_tmUp);
  });
}
function _tmMove(e){
  if(!_tmClone)return;
  _tmClone.style.left=(e.clientX-_tmOffX)+'px';
  _tmClone.style.top=(e.clientY-20)+'px';
  const list=document.getElementById('dragTabList');
  if(!list)return;
  list.querySelectorAll('.drag-tab-item').forEach(function(el){el.style.borderLeft='';el.style.borderRight='';});
  const items=[].slice.call(list.querySelectorAll('.drag-tab-item'));
  for(let i=0;i<items.length;i++){
    if(items[i]===_tmDrag)continue;
    const r=items[i].getBoundingClientRect();
    if(e.clientX>r.left&&e.clientX<r.right){
      const mid=r.left+r.width/2;
      if(e.clientX<mid){items[i].style.borderLeft='3px solid var(--cyan)';}
      else{items[i].style.borderRight='3px solid var(--cyan)';}
      break;
    }
  }
}
function _tmUp(e){
  document.removeEventListener('mousemove',_tmMove);
  document.removeEventListener('mouseup',_tmUp);
  if(_tmClone){_tmClone.remove();_tmClone=null;}
  if(!_tmDrag)return;
  _tmDrag.style.opacity='1';
  const list=document.getElementById('dragTabList');
  if(!list){_tmDrag=null;return;}
  const items=[].slice.call(list.querySelectorAll('.drag-tab-item'));
  for(let i=0;i<items.length;i++){
    if(items[i]===_tmDrag)continue;
    /* 오렌지팜 항목 *앞*에는 떨어뜨릴 수 있어도, *뒤*로는 못 가도록 — 다음 정리 단계에서 강제 마지막으로 보냄 */
    const r=items[i].getBoundingClientRect();
    if(e.clientX>r.left&&e.clientX<r.right){
      const mid=r.left+r.width/2;
      if(e.clientX<mid){list.insertBefore(_tmDrag,items[i]);}
      else{list.insertBefore(_tmDrag,items[i].nextSibling);}
      break;
    }
  }
  /* 오렌지팜 항목은 항상 맨 마지막에 강제 위치 */
  const orangeEl=list.querySelector('.drag-tab-item[data-view="orange"]');
  if(orangeEl) list.appendChild(orangeEl);
  list.querySelectorAll('.drag-tab-item').forEach(function(el){el.style.borderLeft='';el.style.borderRight='';});
  _tmDrag=null;
  applyTabOrder();
}
function applyTabOrder(){
  const list=document.getElementById('dragTabList');
  if(!list)return;
  let order=[];
  list.querySelectorAll('.drag-tab-item').forEach(function(el){order.push(el.dataset.view);});
  /* 오렌지팜은 항상 맨 마지막으로 정렬 */
  order=order.filter(function(v){return v!=='orange';});
  order.push('orange');
  localStorage.setItem('ec_tab_order',JSON.stringify(order));
  const row=document.querySelector('.header-row2');
  if(!row)return;
  /* 앵커: 버전 배지 > nav-spacer. 탭 재배치 시에도 배지가 항상 탭들의 오른쪽 끝에 위치 */
  const anchor=row.querySelector('#appVersionBadge')||row.querySelector('.nav-spacer');
  const vis=getTopMenuVisibility();
  order.forEach(function(view){
    const btn=row.querySelector('.nav-link[data-view="'+view+'"]');
    if(btn){
      btn.style.display=vis[view]===false?'none':'';
      if(anchor)row.insertBefore(btn,anchor);
    }
  });
  const active=row.querySelector('.nav-link.active[data-view]');
  if(active&&active.style.display==='none'){
    let firstVisible=null;
    row.querySelectorAll('.nav-link[data-view]').forEach(function(btn){
      if(!firstVisible&&btn.style.display!=='none') firstVisible=btn;
    });
    if(firstVisible) switchView(firstVisible.dataset.view,firstVisible);
  }
}

/* ── Public exports ── */
