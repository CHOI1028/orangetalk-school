/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ui-utils.js — 공유 DOM 유틸리티 */
import { escHtml } from './format-utils.js';
import { getStu, getGuardianType, getGuardianContact, getStudentBirth } from './student-utils.js';

/* ── 미니 팝업 효과음 (assets/sounds/*) — 파일별 Audio 캐시 재사용 ── */
const _uiSndCache={};
export function playUiSound(file, vol){
  try{
    let a=_uiSndCache[file];
    if(!a){ a=new Audio('./assets/sounds/'+file); a.volume=(vol==null?0.6:vol); _uiSndCache[file]=a; }
    a.currentTime=0;
    const p=a.play(); if(p&&p.catch)p.catch(function(){});
  }catch(_){}
}
export function playQuickMenuSound(){ playUiSound('quickmenu.wav',0.6); }   /* 빠른 작업·이름 클릭·드래그 선택 팝업 */
export function playCautionSound(){ playUiSound('caution.wav',0.7); }       /* 비-오늘 날짜에서 이름 검색 경고 팝업 */

let _nameHoverPopEl=null;

export function showNameHoverPop(anchor,stuId){
  if(document.querySelector('.ems-mini-popup'))return;
  if(document.getElementById('emsMiniPopup'))return;
  hideNameHoverPop();
  const s=getStu(stuId);if(!s)return;
  const lines=[];
  if(s.type==='staff'){
    if(s.gender)lines.push('성별: '+escHtml(s.gender));
    if(s.familyContact)lines.push('연락 가능한 가족: '+escHtml(s.familyContact));
    if(s.familyPhone)lines.push('연락처: '+escHtml(s.familyPhone));
  } else {
    lines.push('생년월일: '+escHtml(getStudentBirth(s)));
    const _gc=getGuardianContact(s);
    if(_gc&&String(_gc).trim())lines.push('주 보호자 연락처: '+escHtml(_gc));
  }
  if(!lines.length)return;
  const pop=document.createElement('div');
  pop.className='name-hover-pop';
  pop.style.display='block';
  pop.innerHTML=lines.map(function(l){return '<div style="font-size:10px;color:var(--t2);line-height:1.5">'+l+'</div>';}).join('');
  document.body.appendChild(pop);
  _nameHoverPopEl=pop;
  const r=anchor.getBoundingClientRect();
  const card=anchor.closest('.ec-list-card,.inf-list-card,[id$="ListCard"],#dailyTableWrap');
  const cardRect=card?card.getBoundingClientRect():{left:0,right:window.innerWidth,top:0,bottom:window.innerHeight};
  pop.style.left='-9999px';pop.style.top='-9999px';
  const pw=pop.offsetWidth||230;
  const ph=pop.offsetHeight||40;
  const left=Math.max(cardRect.left+4,Math.min(r.left,cardRect.right-pw-4));
  let top=r.bottom+6;
  if(top+ph>cardRect.bottom-4)top=Math.max(cardRect.top+4,r.top-ph-6);
  pop.style.left=left+'px';
  pop.style.top=top+'px';
}
export function hideNameHoverPop(){
  if(_nameHoverPopEl){_nameHoverPopEl.remove();_nameHoverPopEl=null;}
}
export function closeModalGracefully(elOrId){
  const el = (typeof elOrId === 'string') ? document.getElementById(elOrId) : elOrId;
  if(!el || !el.isConnected) return;
  if(typeof el._onModalClose === 'function'){ el._onModalClose(); return; }
  if(el.classList.contains('modal-closing')) return;
  el.classList.add('modal-closing');
  /* Windows 에서도 애니메이션이 확실히 재생되도록:
     1) will-change 를 runtime 에 주입해 GPU 합성 레이어 승격
     2) animationend 이벤트로 실제 종료 시점에 제거 (setTimeout 경합 방지)
     3) 안전망으로 500ms 타이머 — 애니메이션이 어떤 이유로 dispatch 되지 않을 때 복구 */
  const content = el.classList.contains('modal-content') ? el : el.querySelector('.modal-content, .gp2-glass');
  if (content) content.style.willChange = 'transform, opacity';
  let removed = false;
  function _doRemove(){
    if (removed) return;
    removed = true;
    if (el && el.parentNode) el.remove();
  }
  /* animationend 는 모달 컨텐츠(애니메이션 대상)에서 발생 */
  const animTarget = content || el;
  const onEnd = function(e){
    /* 하위 요소에서 발생한 animationend 는 무시 (모달 자신에서만) */
    if (e && e.target !== animTarget) return;
    animTarget.removeEventListener('animationend', onEnd);
    _doRemove();
  };
  animTarget.addEventListener('animationend', onEnd);
  /* 안전망 */
  setTimeout(_doRemove, 500);
}
export function createEmptyState(opts){
  opts = opts || {};
  const icon = opts.icon || '📭';
  const title = opts.title || '데이터가 없습니다';
  const desc = opts.desc || '';
  const actionLabel = opts.actionLabel || '';
  return '<div class="empty-state">'
    + '<div class="empty-state-icon">'+ icon +'</div>'
    + '<div class="empty-state-title">'+ escHtml(title) +'</div>'
    + (desc ? '<div class="empty-state-desc">'+ escHtml(desc) +'</div>' : '')
    + (actionLabel ? '<button class="empty-state-action" data-empty-action="1">'+ escHtml(actionLabel) +'</button>' : '')
    + '</div>';
}
export function showLoading(container, text){
  const c = (typeof container === 'string') ? document.getElementById(container) : container;
  if(!c) return;
  hideLoading(c);
  const ov = document.createElement('div');
  ov.className = 'loading-overlay';
  ov.dataset.uiHelperLoading = '1';
  ov.innerHTML = '<div class="loading-spinner"></div>'
    + (text ? '<span class="loading-overlay-text">'+ escHtml(text) +'</span>' : '');
  const st = getComputedStyle(c);
  if(st.position === 'static') c.style.position = 'relative';
  c.appendChild(ov);
}
export function hideLoading(container){
  const c = (typeof container === 'string') ? document.getElementById(container) : container;
  if(!c) return;
  const ov = c.querySelector('[data-ui-helper-loading="1"]');
  if(ov){
    ov.style.transition = 'opacity .15s ease';
    ov.style.opacity = '0';
    setTimeout(function(){ if(ov.parentNode) ov.remove(); }, 160);
  }
}
export function fireConfetti(stuId){
  const colors=['#f44336','#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#4caf50','#ffeb3b','#ff9800','#ff5722','#e040fb','#76ff03','#ffd700','#ff69b4'];
  const shapes=['●','■','▲','★','◆','♦','❤','🎉','🎊','✨','🎈','🎁','🎀','🎗️','🏅'];
  const origins=[[50,100],[30,100],[70,100],[20,100],[80,100]];
  /* top 기반 좌표 사용 — Windows Chromium 에서 bottom 앵커 + transform 혼용 시 GPU 합성 실패 회피.
     document.documentElement 에 직접 append — body 에 걸린 backdrop-filter 스태킹 컨텍스트 밖으로 분리. */
  origins.forEach(function(orig,idx){
    setTimeout(function(){
      const flash=document.createElement('div');
      flash.className='confetti-burst-flash';
      flash.style.left='calc('+orig[0]+'vw - 60px)';
      flash.style.top='calc(100vh - 120px)';
      flash.style.width='120px';flash.style.height='120px';
      flash.style.background='radial-gradient(circle,rgba(255,215,0,0.6),rgba(255,165,0,0.3),transparent)';
      document.documentElement.appendChild(flash);
      setTimeout(function(){flash.remove();},700);
    },idx*100);
  });
  origins.forEach(function(orig,idx){
    setTimeout(function(){
      for(let i=0;i<30;i++){
        const piece=document.createElement('div');
        piece.className='confetti-piece';
        piece.style.left=orig[0]+'vw';
        piece.style.top='calc(100vh - 30px)';
        const cx=(Math.random()-0.5)*70+'vw';
        const cy='-'+(25+Math.random()*55)+'vh';
        piece.style.setProperty('--cx',cx);
        piece.style.setProperty('--cy',cy);
        piece.style.color=colors[Math.floor(Math.random()*colors.length)];
        piece.style.fontSize=(10+Math.random()*18)+'px';
        piece.style.animationDuration=(1.5+Math.random()*1.5)+'s';
        piece.textContent=shapes[Math.floor(Math.random()*shapes.length)];
        document.documentElement.appendChild(piece);
        (function(el){setTimeout(function(){el.remove();},4500);})(piece);
      }
    },idx*100);
  });
}

/* ─────────────────────────────────────────────────────────────
 * v3 (사용자 결정 2026-05-21) — 앱 표준 확인 모달 (삭제 등 위험 액션용).
 * 일반 일지의 인원/일지 삭제 시 사용되던 _dailyConfirm 과 동일 GUI 를 공통화.
 *   호출: const ok = await appConfirmModal('삭제하시겠습니까?', '약품 삭제');
 *   · 헤더(회색) + 바디(흰색) + 푸터(취소·삭제) 분리, ESC=취소, Enter=확인
 *   · resolve(true|false) 반환. backdrop 클릭 = 취소. */
export function appConfirmModal(msg, title, opts){
  /* opts (선택):
   *   okLabel       — ok 버튼 라벨 (기본 "삭제")
   *   cancelLabel   — cancel 버튼 라벨 (기본 "취소")
   *   vertical      — true 면 버튼을 세로 배열 (ok 위, cancel 아래) + full width. 라벨이 긴 경우용.
   *   okBg / okBorder / okColor — ok 버튼 색 (기본 빨강 계열 — 삭제 액션)
   * 기존 호출자 (msg, title 만 전달) 는 모두 그대로 동작 — 옵션 미지정 시 옛 GUI 유지. */
  opts = opts || {};
  const okLabel = opts.okLabel || '삭제';
  const cancelLabel = opts.cancelLabel || '취소';
  const vertical = !!opts.vertical;
  const okOnly = !!opts.okOnly;   /* true 면 취소 버튼 없이 ok(확인) 단일 버튼 — 정보/완료 모달용 (네이티브 alert 대체) */
  const noButtons = !!opts.noButtons;   /* true 면 버튼 자체를 없앰 — 배경 클릭/ESC 로만 닫는 순수 정보 모달 (사용자 요청 2026-06-24) */
  const okBg = opts.okBg || 'rgba(239,68,68,0.12)';
  const okBorder = opts.okBorder || 'rgba(239,68,68,0.35)';
  const okColor = opts.okColor || '#dc2626';
  return new Promise(function(resolve){
    const _title = title || '인원 삭제';
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:50000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
    /* 세로 배열: ok(예) 위 + cancel(아니오) 아래 — 라벨이 길 때 사용자 정책 (2026-05-21) */
    const btnRowStyle = vertical
      ? 'display:flex;flex-direction:column;gap:6px;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)'
      : 'display:flex;gap:6px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)';
    const okBtnStyle = 'padding:6px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid '+okBorder+';background:'+okBg+';color:'+okColor+';cursor:pointer;outline:none;font-family:var(--f)'+(vertical?';width:100%':'');
    const cancelBtnStyle = 'padding:6px 14px;font-size:11.5px;font-weight:600;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;outline:none;font-family:var(--f)'+(vertical?';width:100%':'');
    const okBtn = '<button data-act="ok" style="'+okBtnStyle+'">'+okLabel+'</button>';
    const cancelBtn = '<button data-act="cancel" style="'+cancelBtnStyle+'">'+cancelLabel+'</button>';
    /* 가로: 취소 → ok (옛 동작). 세로: ok → 취소 (예 위 / 아니오 아래) */
    const btnsHtml = okOnly ? okBtn : (vertical ? (okBtn + cancelBtn) : (cancelBtn + okBtn));
    /* 세로 배열 시 너비 살짝 확대 — 긴 라벨이 한 줄에 들어오도록. opts.width 로 호출자가 명시 가능(긴 한 줄 안내문용). */
    const boxWidth = opts.width || (vertical ? '400px' : '340px');
    /* noButtons: 푸터(버튼 행) 자체를 생략 — 본문 하단 여백만 살짝 확보 */
    const footerHtml = noButtons ? '<div style="height:6px;background:var(--card)"></div>' : ('<div style="'+btnRowStyle+'">'+btnsHtml+'</div>');
    ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:'+boxWidth+';max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden">'
      +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">'+_title+'</div>'
      +'<div style="padding:18px 20px;font-size:12.5px;color:var(--t1);line-height:1.7;background:var(--card)">'+msg+'</div>'
      +footerHtml+'</div>';
    document.body.appendChild(ov);
    const close=function(r){ try{document.removeEventListener('keydown',onKey,true);}catch(_){} ov.remove(); resolve(r); };
    const _okBtnEl = ov.querySelector('[data-act="ok"]');   /* noButtons 면 ok 버튼이 없음 — null 가드 */
    if(_okBtnEl) _okBtnEl.addEventListener('click',function(){close(true);});
    const _cancelBtnEl = ov.querySelector('[data-act="cancel"]');   /* okOnly 면 취소 버튼이 없음 — null 가드 */
    if(_cancelBtnEl) _cancelBtnEl.addEventListener('click',function(){close(false);});
    ov.addEventListener('click',function(e){ if(e.target===ov) close(false); });
    const onKey=function(e){
      if(e.key==='Escape'){ e.preventDefault(); close(false); }
      else if(e.key==='Enter'){ e.preventDefault(); close(true); }
    };
    document.addEventListener('keydown',onKey,true);
  });
}

/* ─────────────────────────────────────────────────────────────
 * 슬라이드 투 삭제 — 위험 액션 실수 방지용. (사용자 결정 2026-05-21)
 * 사용:
 *   const btn = document.getElementById('xxxBtn');
 *   const slider = makeSlideToDelete(btn, {
 *     label: '클릭하여 우측으로 밀어서 삭제',
 *     color: '#dc2626',   // 위험: 빨강 / 주의: '#b45309' 등
 *   });
 *   // 라벨 갱신: slider.setLabel('클릭하여 우측으로 밀어서 삭제 (42건)');
 *   // 비활성:  slider.setDisabled(true);
 * 슬라이드 완료(>=92%) 시 원래 button.click() 가 호출되어 기존 핸들러 그대로 동작. */
export function makeSlideToDelete(btnEl, opts){
  opts = opts || {};
  if(!btnEl || btnEl._hasSlider) return null;
  btnEl._hasSlider = true;
  const color = opts.color || '#dc2626';
  const bg = opts.bg || 'rgba(239,68,68,0.07)';
  const borderRGBA = opts.borderRGBA || 'rgba(239,68,68,0.35)';
  const knobBg = opts.knobBg || color;
  const initLabel = opts.label || '클릭하여 우측으로 밀어서 삭제';
  /* SVG chevron-right (>>) — 휴지통보다 세련된 "오른쪽으로 미세요" 아이콘 */
  const knobIconSvg = opts.iconSvg || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
  const wrapper = document.createElement('div');
  wrapper.className = 'std-slider';
  wrapper.style.cssText = 'position:relative;width:280px;max-width:100%;height:42px;border-radius:21px;background:'+bg+';border:1px solid '+borderRGBA+';overflow:hidden;display:flex;align-items:center;justify-content:center;user-select:none';
  const text = document.createElement('span');
  text.className = 'std-slider-text';
  text.style.cssText = 'font-size:11.5px;color:'+color+';font-weight:700;letter-spacing:0.2px;pointer-events:none;transition:opacity .15s;padding-left:34px';
  text.textContent = initLabel;
  const knob = document.createElement('div');
  knob.className = 'std-slider-knob';
  knob.style.cssText = 'position:absolute;left:4px;top:4px;width:34px;height:34px;border-radius:50%;background:'+knobBg+';display:flex;align-items:center;justify-content:center;color:#fff;cursor:grab;box-shadow:0 2px 6px '+color+'66;transition:left .2s cubic-bezier(0.4,0,0.2,1),background-color .15s,box-shadow .15s';
  knob.innerHTML = knobIconSvg;
  wrapper.appendChild(text);
  wrapper.appendChild(knob);
  /* DOM 에 삽입 — 기존 버튼은 숨김 (라벨 갱신/disabled 동기화에 활용) */
  if(btnEl.parentNode){
    btnEl.parentNode.insertBefore(wrapper, btnEl);
    btnEl.style.display = 'none';
  }
  /* Pointer events 기반 — pointerdown 에서 pointer capture → 같은 노브의 pointermove/pointerup 만 받음.
   *  hover 만으로는 절대 움직이지 않음. dragging 플래그 + 활성 pointer id 이중 가드. */
  let dragging = false;
  let activePointerId = null;
  let startX = 0, startLeft = 4;
  const MIN_DRAG_PX = 4; /* 이 이하 움직임은 무시 — 클릭만 한 경우 노브가 살짝 흔들리는 것 차단 */
  let exceeded = false;
  function trackWidth(){ return wrapper.clientWidth - knob.offsetWidth - 8; /* 4px padding each side */ }
  function setKnob(left){
    knob.style.left = left + 'px';
    const pct = Math.max(0, Math.min(1, (left - 4) / Math.max(1, trackWidth())));
    text.style.opacity = String(1 - pct * 0.9);
  }
  function reset(animated){
    knob.style.transition = animated ? 'left .25s cubic-bezier(0.4,0,0.2,1)' : 'none';
    knob.style.cursor = 'grab';
    setKnob(4);
  }
  knob.addEventListener('pointerdown', function(e){
    if(btnEl.disabled) return;
    /* 좌클릭/주 터치만 허용 */
    if(e.button !== undefined && e.button !== 0) return;
    dragging = true;
    exceeded = false;
    activePointerId = e.pointerId;
    try { knob.setPointerCapture(e.pointerId); } catch(_){}
    knob.style.transition = 'none';
    knob.style.cursor = 'grabbing';
    startX = e.clientX;
    startLeft = parseFloat(knob.style.left) || 4;
    if(e.cancelable) e.preventDefault();
  });
  knob.addEventListener('pointermove', function(e){
    if(!dragging) return;
    if(activePointerId !== null && e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    if(!exceeded && Math.abs(dx) < MIN_DRAG_PX) return; /* 임계값 이하 무시 */
    exceeded = true;
    let nl = startLeft + dx;
    nl = Math.max(4, Math.min(trackWidth() + 4, nl));
    setKnob(nl);
  });
  function endDrag(e){
    if(!dragging) return;
    if(activePointerId !== null && e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    try { knob.releasePointerCapture(e.pointerId); } catch(_){}
    knob.style.transition = 'left .25s cubic-bezier(0.4,0,0.2,1)';
    knob.style.cursor = 'grab';
    const nl = parseFloat(knob.style.left) || 4;
    const pct = (nl - 4) / Math.max(1, trackWidth());
    if(pct >= 0.92){
      setKnob(trackWidth() + 4);
      setTimeout(function(){ try{ btnEl.click(); }catch(_){} }, 80);
      setTimeout(function(){ reset(true); }, 360);
    } else {
      reset(true);
    }
  }
  knob.addEventListener('pointerup', endDrag);
  knob.addEventListener('pointercancel', endDrag);
  /* 초기 비활성 처리 — disabled 면 시각적으로 회색화 */
  function applyDisabled(){
    if(btnEl.disabled){
      wrapper.style.opacity = '0.45';
      wrapper.style.filter = 'grayscale(0.7)';
      knob.style.cursor = 'not-allowed';
    } else {
      wrapper.style.opacity = '';
      wrapper.style.filter = '';
      knob.style.cursor = 'grab';
    }
  }
  applyDisabled();
  return {
    wrapper,
    setLabel: function(s){ text.textContent = s; },
    setDisabled: function(d){ btnEl.disabled = !!d; applyDisabled(); },
    refresh: function(){ applyDisabled(); }
  };
}
