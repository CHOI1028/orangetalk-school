/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module — 화면 배율(글자크기) 컨트롤러
 * 핵심 전략:
 *   1) document.documentElement.style.zoom = factor (CSS zoom, Chromium 네이티브)
 *      → 헤더(position:fixed)·메인·하단 모두 동일 비율로 시각·레이아웃 모두 확대.
 *   2) 확대 시에만 body { overflow:auto; min-width:unset } 인라인 오버라이드 주입
 *      → viewport propagation 으로 인한 스크롤 차단 해제 + 가로 폭 viewport 정렬.
 *   3) Ctrl+휠로 1.0 ~ 1.6 범위 조절. 100% 미만 불가.
 * 메인 프로세스 IPC 호출 없음 — 스플래시·렌더 라이프사이클에 절대 간섭하지 않음.
 */
'use strict';

const _LS_FACTOR  = 'ec_zoom_factor';
const _LS_ENABLED = 'ec_zoom_enabled';
const MIN_ZOOM = 1.0;
const MAX_ZOOM = 1.6;   /* 상한 160% (2026-07-21, 노안·대형 모니터 요청). _clamp·Ctrl+휠·setZoomFactor 모두 이 값 기준 */
const STEP     = 0.05;

let _styleEl = null;
let _inlineObserver = null;
let _zoomActive = false;

/* zoom 활성화 시 동작:
 *   - "외곽 오버레이"(풀스크린 fixed 컨테이너)를 식별 → 자체 + 모든 fixed 자손 마킹
 *   - 외곽 오버레이 식별 기준: 클래스명 매칭 OR 인라인 `position:fixed` + 풀스크린 패턴(`inset:0` 등)
 *   - tooltip/dropdown/미니팝업 등 작은 fixed 단독 요소는 외곽 오버레이의 자손이 아니면 마킹하지 않음 → 원래 fixed 위치 유지.
 */
const _INLINE_FIXED_RE = /position\s*:\s*fixed/i;
/* 풀스크린 패턴 — 브라우저는 인라인 `inset:0` 을 `inset: 0px;` 로 정규화하므로 단위까지 허용 */
const _FULLSCREEN_INLINE_RE = /\binset\s*:\s*0(?:px|em|rem|%)?\s*;|\binset\s*:\s*0(?:px|em|rem|%)?\s*$|top\s*:\s*0[^;]*;\s*left\s*:\s*0[^;]*;\s*(width\s*:\s*100%|right\s*:\s*0)|width\s*:\s*100%[^;]*;\s*height\s*:\s*100%/i;
const _OVERLAY_CLASSES = [
  'modal-overlay', 'qm-overlay', 'vp-overlay', 'ec-form-overlay',
  'ems-overlay', 'sv-modal-overlay', 'nl-overlay',
  'magic-link-popup-overlay', 'memo-popup-overlay'
];

/* drugSearchOverlay 는 인라인 `inset:0` 풀스크린 오버레이라 _hasFullScreenInline 으로
 * 자동 detect 됨. 별도 standalone ID 필요 없음. */
/* 단독 팝업(position:fixed, 풀스크린 아님) — 줌 활성 시 absolute 로 재배치해야 화면에 보임.
 * 미등록 시 html.style.zoom 때문에 fixed 위치가 깨져 안 보임(아날로그 시계·달력 등). (2026-06-03) */
const _STANDALONE_POPUP_IDS = new Set(['clockPickerWrap','infCalWrap']);

function _hasOverlayClass(el){
  if(!el || el.nodeType !== 1 || !el.classList) return false;
  for(const c of _OVERLAY_CLASSES) if(el.classList.contains(c)) return true;
  return false;
}

function _hasFullScreenInline(el){
  if(!el || el.nodeType !== 1) return false;
  const s = el.getAttribute && el.getAttribute('style');
  if(!s || !_INLINE_FIXED_RE.test(s)) return false;
  return _FULLSCREEN_INLINE_RE.test(s);
}

function _isOuterOverlay(el){
  if(!el || el.nodeType !== 1) return false;
  if(_hasOverlayClass(el) || _hasFullScreenInline(el)) return true;
  if(el.id && _STANDALONE_POPUP_IDS.has(el.id)) return true;
  return false;
}

function _hasInlineFixed(el){
  if(!el || el.nodeType !== 1) return false;
  const s = el.getAttribute && el.getAttribute('style');
  return !!(s && _INLINE_FIXED_RE.test(s));
}

/* 외곽 오버레이 + 자손 중 인라인 position:fixed 인 카드들을 함께 마킹.
 * 두 가지 마커:
 *   - data-ec-zoom-rebound="overlay" : 풀스크린 오버레이 → body 전체 span (inset:auto, top/left:0, width:100%, min-height:100vh)
 *   - data-ec-zoom-rebound="card"    : 내부 카드/standalone 팝업 → position 만 absolute, top/left/width 는 인라인 그대로
 */
/* standalone 팝업의 자식 마킹은 건너뛴다 — 인라인 좌표가 viewport 기반이라
 * absolute 변환 시 위치가 깨지기 쉬움. 부모만 마킹해서 부모는 스크롤 따라가고
 * 자식들은 부모 좌표계를 그대로 따른다. */
function _markOverlayAndChildren(el){
  if(!_zoomActive) return;
  if(!_isOuterOverlay(el)) return;
  let isStandalone = false;
  /* 자체 마킹 */
  if(_hasFullScreenInline(el)){
    el.setAttribute('data-ec-zoom-rebound','overlay');
    _adjustOverlayTop(el);
  } else if(_hasOverlayClass(el)){
    /* class 기반 overlay(.modal-overlay 등) — OVERLAY_SEL CSS 가 이미 적용되므로 별도 attribute 불필요.
     * 다만 top:0 이 body 절대좌표 기준이라 스크롤 시 viewport 위로 빠지는 문제 → 동적 top 보정. */
    _adjustOverlayTop(el);
  } else if(el.id && _STANDALONE_POPUP_IDS.has(el.id)){
    el.setAttribute('data-ec-zoom-rebound','card');
    isStandalone = true;
    _adjustCardPosition(el);
  }
  /* 자손 마킹 — standalone 팝업은 자식까지 마킹하지 않음 (좌표 충돌 회피) */
  if(!isStandalone && el.querySelectorAll){
    el.querySelectorAll('[style*="position"]').forEach(function(child){
      if(_hasInlineFixed(child)){
        child.setAttribute('data-ec-zoom-rebound','card');
        _adjustCardPosition(child);
      }
    });
  }
}

function _scanAllInlineOverlays(){
  if(!_zoomActive) return;
  /* 풀스크린 인라인 오버레이 + 그 자손 */
  document.querySelectorAll('[style*="position"]').forEach(function(el){
    if(_hasFullScreenInline(el)) _markOverlayAndChildren(el);
  });
  /* 클래스 기반 오버레이의 자손 */
  document.querySelectorAll(_OVERLAY_CLASSES.map(c=>'.'+c).join(',')).forEach(_markOverlayAndChildren);
  /* standalone 팝업 ID 직접 마킹 */
  _STANDALONE_POPUP_IDS.forEach(function(id){
    const el = document.getElementById(id);
    if(el) _markOverlayAndChildren(el);
  });
}

/* 외곽 오버레이의 자손인지 확인 (드래그 등으로 늦게 fixed 가 박히는 .modal-content 케이스) */
function _isInsideOverlay(el){
  if(!el || el.nodeType !== 1) return false;
  const sel = _OVERLAY_CLASSES.map(c=>'.'+c).join(',') + ',[data-ec-zoom-rebound]';
  return !!el.closest(sel);
}

function _markIfFixedAndInOverlay(el){
  if(!_zoomActive) return;
  if(!el || el.nodeType !== 1) return;
  if(!_hasInlineFixed(el)) return;
  if(el.hasAttribute('data-ec-zoom-rebound')) return;
  /* auto-popup-drag 가 관리하는 box 는 건너뛰기 — 드래그용으로 의도적으로 position:fixed 를 사용하므로
   * card 마킹 → absolute 강제 + 자동 재배치 시 클릭 직후 점프 현상 발생. */
  if(el._autoDragApplied) return;
  /* standalone 팝업의 자식이면 마킹 건너뛰기 (좌표 충돌 회피) */
  for(const id of _STANDALONE_POPUP_IDS){
    const sp = document.getElementById(id);
    if(sp && sp.contains(el) && el !== sp) return;
  }
  if(!_isInsideOverlay(el)) return;
  el.setAttribute('data-ec-zoom-rebound','card');
  _adjustCardPosition(el);
}

/* zoom 활성 시 overlay 의 top 을 현재 scrollY 로 보정 — body 절대좌표 기준이라
 * 사용자가 zoom 으로 인해 스크롤 내려간 상태에서 overlay 가 열리면 viewport 위로 빠지는 문제 방지.
 * OVERLAY_SEL CSS 의 top:0!important 를 inline !important 로 오버라이드.
 * 어떤 배율(110/120/125%) 에서든 overlay 가 viewport 안에서 시작하도록 보장. */
function _adjustOverlayTop(el){
  if(!_zoomActive) return;
  if(!el || el.nodeType !== 1) return;
  const sy = window.scrollY || document.documentElement.scrollTop || 0;
  el.style.setProperty('top', sy + 'px', 'important');
}

/* zoom 활성 + position:absolute 로 전환된 팝업 카드의 top 을 보이는 영역 기준으로 재배치.
 * 이유: 절대 좌표가 body 기준이라 스크롤 위치/zoom 미스매치로 화면 밖에 그려질 수 있음.
 * 정책 (사용자 요청):
 *   1) 위치: 보이는 viewport 의 상단 1/3 지점 (아래쪽 여유 더 확보 → 잘림 방지)
 *   2) 높이: 카드가 viewport 보다 크면 max-height 로 자동 축소
 *   3) 한 번만 보정 (data-ec-zoom-pos-adjusted) — 드래그 후 재보정 안 함 */
function _adjustCardPosition(el){
  if(!_zoomActive) return;
  if(!el || el.nodeType !== 1) return;
  if(el.hasAttribute('data-ec-zoom-pos-adjusted')) return;
  requestAnimationFrame(function(){
    if(!el.isConnected) return;
    if(el.hasAttribute('data-ec-zoom-pos-adjusted')) return;
    const rect = el.getBoundingClientRect();
    if(rect.height < 50) return; /* 너무 작은 요소 (툴팁/메뉴) 는 건드리지 않음 */
    const innerH = window.innerHeight;
    const margin = 20;
    let h = rect.height;
    /* 높이가 viewport 보다 크면 max-height 강제로 축소 — 내부 콘텐츠 스크롤로 위임 */
    if(h > innerH - margin * 2){
      h = innerH - margin * 2;
      el.style.maxHeight = h + 'px';
      /* 내부 콘텐츠 스크롤 가능하도록 — overflow 가 hidden 이면 풀어줌 */
      const cs = window.getComputedStyle(el);
      if(cs.overflow === 'hidden' || cs.overflowY === 'hidden'){
        el.style.overflowY = 'auto';
      }
    }
    /* 상단 1/3 지점 — scrollY 더해 body 좌표계로 변환 */
    const desiredViewportTop = Math.max(margin, (innerH - h) / 3);
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    el.style.top = (scrollY + desiredViewportTop) + 'px';
    el.setAttribute('data-ec-zoom-pos-adjusted', '1');
  });
}

function _ensureInlineObserver(){
  if(_inlineObserver) return;
  _inlineObserver = new MutationObserver(function(muts){
    if(!_zoomActive) return;
    for(const m of muts){
      if(m.type === 'childList'){
        m.addedNodes.forEach(function(n){
          if(n.nodeType !== 1) return;
          _markOverlayAndChildren(n);
          if(n.querySelectorAll){
            n.querySelectorAll('[style*="position"]').forEach(function(d){
              if(_hasFullScreenInline(d)) _markOverlayAndChildren(d);
            });
            n.querySelectorAll(_OVERLAY_CLASSES.map(c=>'.'+c).join(',')).forEach(_markOverlayAndChildren);
            /* standalone popup ID 도 자손에서 검사 */
            _STANDALONE_POPUP_IDS.forEach(function(id){
              const found = n.id === id ? n : n.querySelector('#'+id);
              if(found) _markOverlayAndChildren(found);
            });
          }
        });
      } else if(m.type === 'attributes'){
        if(m.attributeName === 'style' || m.attributeName === 'class'){
          /* (1) 자체가 외곽 오버레이가 됐으면 자손까지 마킹 */
          _markOverlayAndChildren(m.target);
          /* (2) 외곽 오버레이 자손이 fixed 로 바뀐 경우(_makeDraggable 등) → 단독 마킹 */
          _markIfFixedAndInOverlay(m.target);
        }
      }
    }
  });
  _inlineObserver.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['style','class']
  });
}

function _ensureStyle(){
  if(_styleEl && document.head.contains(_styleEl)) return _styleEl;
  _styleEl = document.createElement('style');
  _styleEl.id = 'ec-zoom-overrides';
  document.head.appendChild(_styleEl);
  return _styleEl;
}

function _clamp(v){
  const n = Number(v);
  if(!Number.isFinite(n)) return 1.0;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(n*100)/100));
}

function _apply(factor){
  const html = document.documentElement;
  const f = factor;
  if(f > 1.0001){
    _zoomActive = true;
    html.style.zoom = String(f);
    /* 핵심 원칙: body 의 자연 폭(min-width:1618px) 그대로 두고, 헤더를 absolute 로
     * 전환해 body 와 함께 좌우·상하로 스크롤되도록 만든다. 결과: 헤더·캔버스·콘텐츠
     * 모두 같은 폭(=확대된 body 폭)에 맞춰지고, viewport 가 작으면 좌우·상하 스크롤로
     * 이동하여 본다 (사용자 요구사항). */
    /* 풀스크린 외곽 오버레이 — body 전체 span. inline `inset:0` 무력화 위해
     * inset:auto 를 먼저 선언하고 개별 top/left/right/bottom 을 뒤에 배치 (CSS cascade). */
    const SPAN_OVERLAYS = [
      '.modal-overlay',          /* 설정 / 물품대여대장 / 보건일지출력 / 커스텀양식 / 인원관리 등 */
      '.qm-overlay',             /* 상용 메시지 */
      '.vp-overlay',             /* 방문확인증 */
      '.ec-form-overlay',        /* 응급처치 / 감염병 기록지 form */
      '.ems-overlay',            /* EMS 메시지 */
      '.sv-modal-overlay',       /* 설문 */
      '.nl-overlay',             /* 가정통신문 */
      '.magic-link-popup-overlay',
      '.memo-popup-overlay'
    ].join(',');

    /* 외곽 오버레이 셀렉터 — class-based + 인라인 풀스크린(data-attribute "overlay") */
    const OVERLAY_SEL = SPAN_OVERLAYS + ',[data-ec-zoom-rebound="overlay"]';
    _ensureStyle().textContent =
      'html{overflow:auto!important}'
      /* 세로: min-height:100vh + 콘텐츠로 넘침 → html 세로 스크롤. 가로: min-width:max-content 로
       * body 가 '콘텐츠 실제 폭'만큼 넓어졌다고 html 에 알려야 html 가로 스크롤바가 생긴다.
       * (루트 zoom + overflow 조합에서 세로만 잡히고 가로가 안 잡히던 문제 — 2026-07-21 160% 대응) */
      + 'body,body.loaded{overflow:visible!important;min-height:100vh!important;min-width:max-content!important}'
      + '.top-header{position:absolute!important;left:0!important;right:auto!important;width:100%!important}'
      + '.header-row1,.header-row2{max-width:none!important}'
      /* 사이드바 sticky 해제 — zoom 활성 시 본문과 같이 스크롤되도록 (사용자 요청) */
      + '.sidebar{position:relative!important;top:auto!important}'
      /* 외곽 오버레이 — body 전체 span (top/left/width/min-height 강제) */
      + OVERLAY_SEL + '{inset:auto!important;position:absolute!important;top:0!important;left:0!important;right:auto!important;bottom:auto!important;width:100%!important;min-height:100vh!important}'
      /* 내부 카드 / standalone 팝업 — position 만 absolute 로, 인라인 top/left 등 좌표 유지 */
      + '[data-ec-zoom-rebound="card"]{position:absolute!important}';
    _ensureInlineObserver();
    _scanAllInlineOverlays();
  } else {
    _zoomActive = false;
    html.style.zoom = '';
    if(_styleEl) _styleEl.textContent = '';
    /* 마커 제거 — zoom OFF 시 원래 fixed 레이아웃으로 복원 */
    document.querySelectorAll('[data-ec-zoom-rebound]').forEach(function(el){
      el.removeAttribute('data-ec-zoom-rebound');
    });
    /* 위치 보정 흔적도 제거 — 다음에 zoom 켜질 때 재보정 */
    document.querySelectorAll('[data-ec-zoom-pos-adjusted]').forEach(function(el){
      el.removeAttribute('data-ec-zoom-pos-adjusted');
    });
  }
}

export function getZoomFactor(){
  return _clamp(localStorage.getItem(_LS_FACTOR) || '1.0');
}

export function isEnabled(){
  /* 기본값 ON. '0' 일 때만 비활성 */
  return localStorage.getItem(_LS_ENABLED) !== '0';
}

export function setEnabled(on){
  localStorage.setItem(_LS_ENABLED, on ? '1' : '0');
  _apply(on ? getZoomFactor() : 1.0);
  _broadcast();
}

export function setZoomFactor(factor){
  const c = _clamp(factor);
  localStorage.setItem(_LS_FACTOR, String(c));
  _apply(isEnabled() ? c : 1.0);
  _broadcast();
  return c;
}

function _broadcast(){
  try{
    window.dispatchEvent(new CustomEvent('ec:zoom-changed', {
      detail: { factor: isEnabled()?getZoomFactor():1.0, enabled: isEnabled() }
    }));
  }catch(_){}
}

function _onWheel(e){
  if(!(e.ctrlKey || e.metaKey)) return;
  if(!isEnabled()) return;
  e.preventDefault();
  const cur = getZoomFactor();
  const dir = e.deltaY < 0 ? 1 : -1;
  setZoomFactor(cur + dir*STEP);
}

function _init(){
  if(localStorage.getItem(_LS_ENABLED) === null) localStorage.setItem(_LS_ENABLED,'1');
  _apply(isEnabled() ? getZoomFactor() : 1.0);
  document.addEventListener('wheel', _onWheel, { passive:false, capture:true });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}

/* 외부 액세스 (설정 화면에서 사용) */
window.ecZoom = {
  get:        getZoomFactor,
  set:        setZoomFactor,
  enabled:    isEnabled,
  setEnabled: setEnabled,
  MIN: MIN_ZOOM, MAX: MAX_ZOOM, STEP: STEP
};
