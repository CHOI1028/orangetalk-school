/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { escHtml } from '../../core/helpers.js';
import { renderSettingsPanel } from '../settings/settings-view.js';
import { closeModalWithAnim } from '../daily/daily-autocomplete.js';
import { S } from '../../core/app-state.js';
import { bus } from '../../core/event-bus.js';
import { getPublicDataApiKey, hasPublicDataApiKeySetting } from '../../core/public-data-settings.js';

/* ═══════════════════════════════════════
   HEADER WIDGET — cycling brand, piljeok, weather
   ═══════════════════════════════════════ */

/* ══════════════════════════════════════════
   배너 통합 관리 (banner.json)
   - header: 좌상단 브랜드 순환 메시지 [{emoji,text,color,lightColor,time},...]
   - footer: 하단 회전 문구 [string,...]
   - url: 클릭 시 열리는 단일 URL
   소스: 원격 GitHub → 로컬 캐시 → 번들 폴백
   ══════════════════════════════════════════ */

/* 공식 배포 서버의 banner.json — 하단 회전문구 (오렌지팜 홍보) 원격 관리 (2026-05-27 GitHub → school114.org 이전) */
const _BANNER_REMOTE_URL='https://school114.org/data/Board/B11/banner.json';

/* 고정(잠금) 헤더 메시지 — 편집/삭제 불가, 프로그램 로고 아이콘 사용 */
const _lockedHeaderMsgs=[
  {emoji:'\uD83C\uDF47',text:'오렌지톡',color:'#9c27b0',lightColor:'#6a1b9a',time:15000,locked:true,useLogo:true}
];

/* 하드코딩 폴백 (번들 로드 실패 시에만 사용) — 잠금 메시지 + 기본 커스텀 메시지 */
const _defaultHeaderMsgs=_lockedHeaderMsgs.concat([
  {emoji:'\u2600\uFE0F',text:'건강한 하루를 위한 기록',color:'#fde68a',lightColor:'#92400e',time:15000},
  {emoji:'\uD83C\uDF4E',text:'Simple is the Best!',color:'#e85d5d',lightColor:'#9b4d4d',time:15000},
  {emoji:'\uD83C\uDF40',text:'가장 중요한 것은 선생님의 행복과 추억',color:'#4caf50',lightColor:'#2e7d32',time:15000},
  {emoji:'\uD83D\uDE0A',text:'오늘도 선생님의 칼퇴를 응원합니다!',color:'#3b82f6',lightColor:'#1d4ed8',time:15000}
]);

function _isLockedHeaderText(t){
  const s=String(t||'').trim();
  return _lockedHeaderMsgs.some(function(m){return m.text===s;});
}
export function getLockedHeaderMsgs(){return _lockedHeaderMsgs.slice();}
/* 잠금 제외 기본 커스텀 메시지 (사용자 저장값이 없을 때 기본 제시용) */
export function getDefaultCustomHeaderMsgs(){
  return _defaultHeaderMsgs.filter(function(m){return !m.locked;}).map(function(m){return Object.assign({},m);});
}
/* 현재 활성 커스텀 메시지 — 사용자 저장값 우선, 없으면 기본값 */
export function getCurrentCustomHeaderMsgs(){
  const u=loadUserHeaderMsgs();
  if(u&&u.length)return u;
  return getDefaultCustomHeaderMsgs();
}

export function loadUserHeaderMsgs(){
  try{
    const s=JSON.parse(localStorage.getItem('ec_header_msgs_user')||'null');
    if(Array.isArray(s))return s.filter(function(m){return m&&typeof m==='object'&&!_isLockedHeaderText(m.text);});
  }catch(e){}
  return [];
}
export function saveUserHeaderMsgs(list){
  try{
    const safe=(list||[]).filter(function(m){return m&&typeof m==='object'&&m.text&&!_isLockedHeaderText(m.text);});
    localStorage.setItem('ec_header_msgs_user',JSON.stringify(safe));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','header_msgs_user',safe);
    _rebuildHeaderMsgs();
  }catch(e){}
}

/* 재적용: 잠금 메시지 + 사용자 커스텀(또는 배너/기본값) → _headerMsgs */
function _rebuildHeaderMsgs(){
  const user=loadUserHeaderMsgs();
  if(user.length){
    _headerMsgs=_lockedHeaderMsgs.concat(user);
    return;
  }
  /* 사용자 저장값이 없으면 배너 캐시의 커스텀 부분 + 잠금 메시지 */
  let bannerCustom=[];
  try{
    const bc=JSON.parse(localStorage.getItem('ec_banner_cache')||'null');
    if(bc&&Array.isArray(bc.header)){
      bannerCustom=bc.header.filter(function(m){return m&&typeof m==='object'&&m.text&&!_isLockedHeaderText(m.text);});
    }
  }catch(e){}
  if(bannerCustom.length){_headerMsgs=_lockedHeaderMsgs.concat(bannerCustom);return;}
  _headerMsgs=_defaultHeaderMsgs.slice();
}
/* 설정 패널의 자동 저장이 localStorage 업데이트 후 호출 — 헤더 순환 메시지 즉시 반영 */
window._reloadHeaderMsgs = function(){
  try{ _rebuildHeaderMsgs(); }catch(e){}
};
/* 하단 회전문구 리로더 — 설정 저장 후 호출되어 _footerMsgs 재구성 */
window._reloadFooterMsgs = function(){
  try{
    _userFooterMsgs = _loadUserFooterMsgs();
    _userFooterIdx = 0;
  }catch(e){}
};

/* 사용자 결정 2026-05-27: banner.json 은 footer 회전 문구만 관리. headerUrl/footerUrl/tutorials 제거. */
let _headerMsgs=_defaultHeaderMsgs.slice();
let _footerMsgs=[];
let _footerIdx=0;
let _footerOrder='sequential';   /* 'sequential' | 'random' — banner.json 의 order 필드로 제어 (없으면 순차) */

/* ── 캐시 로드/저장 ── */
/* 사용자 결정 2026-05-27: banner.json 은 footer 회전 문구만 관리. header/url/tutorials 제거. */
function _loadBannerCache(){
  try{
    const c=JSON.parse(localStorage.getItem('ec_banner_cache')||'null');
    if(c&&typeof c==='object'){
      if(Array.isArray(c.footer)&&c.footer.length){_footerMsgs=c.footer.filter(Boolean);_footerIdx=Math.floor(Math.random()*_footerMsgs.length);}
      _footerOrder=(c.order==='random')?'random':'sequential';
    }
  }catch(e){}
}
function _saveBannerCache(data){
  try{
    /* 캐시에도 footer 만 — 옛 필드 잔존 차단 */
    const clean={footer: Array.isArray(data&&data.footer)?data.footer:[], order:(data&&data.order==='random')?'random':'sequential'};
    localStorage.setItem('ec_banner_cache',JSON.stringify(clean));
  }catch(e){}
}

/* ── 배너 데이터 적용 ── */
function _applyBannerData(data){
  if(!data||typeof data!=='object')return;
  if(Array.isArray(data.footer)&&data.footer.length){_footerMsgs=data.footer.filter(Boolean);_footerIdx=Math.floor(Math.random()*_footerMsgs.length);}
  _footerOrder=(data.order==='random')?'random':'sequential';
  _saveBannerCache(data);
  /* 첫 설치 시 푸터 문구 시드 — ec_footer_msgs 가 한 번도 없으면 banner 의 footer 를 사용자 문구로 자동 등록 */
  _bootstrapFooterMsgsFromBanner();
}

/* 첫 설치 시 — ec_footer_msgs 키 자체가 localStorage 에 없을 때만 banner.json footer 를 사용자 문구로 시드.
   이미 빈 배열로라도 저장된 경우엔 사용자 의도로 보고 덮어쓰지 않음. */
function _bootstrapFooterMsgsFromBanner(){
  try{
    if(localStorage.getItem('ec_footer_msgs')!==null) return; /* 이미 한 번 저장된 적 있음 → skip */
    if(!_footerMsgs||!_footerMsgs.length) return;
    const seed=_footerMsgs.slice(0,40).map(function(item){
      const text=(typeof item==='string')?item:(item&&item.text?item.text:'');
      return text?{text:text, time:15000}:null;
    }).filter(Boolean);
    if(!seed.length) return;
    localStorage.setItem('ec_footer_msgs', JSON.stringify(seed));
    if(window.electronAPI&&window.electronAPI.dbSet) window.electronAPI.dbSet('common','footer_msgs',seed);
    _userFooterMsgs=seed;
    _userFooterIdx=Math.floor(Math.random()*seed.length);
  }catch(e){}
}

/* 번들 banner.json (오프라인 폴백) */
function _loadBannerFromBundle(){
  if(!window.electronAPI||!window.electronAPI.readFile)return;
  window.electronAPI.readFile('__app__/templates/banner.json').then(function(res){
    if(res&&res.success){
      try{_applyBannerData(JSON.parse(res.data));}catch(e){}
    }
  }).catch(function(){});
}

/* 원격 fetch (메인 프로세스 경유) */
function _fetchBannerRemote(){
  if(!window.electronAPI||!window.electronAPI.externalFetchJson)return;
  window.electronAPI.externalFetchJson(_BANNER_REMOTE_URL).then(function(res){
    if(res&&res.success){
      try{_applyBannerData(JSON.parse(res.data));}catch(e){}
    }
  }).catch(function(){});
}

/* 초기화: 캐시 → 번들 → 원격 (비동기) */
_loadBannerCache();
_loadBannerFromBundle();
_fetchBannerRemote();
/* 사용자 저장된 상단 메시지 + 잠금 메시지 병합 (배너 로딩 이후) */
_rebuildHeaderMsgs();

/* ── 상단 브랜드 메시지 순환 ── */
let _hdrIdx=0;
/* hex #rrggbb → {r,g,b} */
function _hexToRgb(hex){
  const m=(hex||'').match(/^#?([0-9a-f]{6})$/i);if(!m)return null;
  const n=parseInt(m[1],16);return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function _rgbToHex(r,g,b){return '#'+[r,g,b].map(function(v){return Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');}).join('');}
/* 다크모드: 채도 유지하며 밝게. 라이트모드: 어둡게 해서 흰 배경 대비 확보 */
function _themeAdjustColor(color,isLight){
  const rgb=_hexToRgb(color);if(!rgb)return color;
  /* 상대 휘도 */
  const lum=(0.2126*rgb.r+0.7152*rgb.g+0.0722*rgb.b)/255;
  if(isLight){
    /* 밝은 색(luminance>0.6) 이면 60% 어둡게, 아니면 최소 어둡기만 적용 */
    const factor=lum>0.6?0.45:(lum>0.45?0.6:0.85);
    return _rgbToHex(rgb.r*factor,rgb.g*factor,rgb.b*factor);
  } else {
    /* 어두운 색(luminance<0.35) 이면 밝게 */
    if(lum<0.35){
      const f=1.5;
      return _rgbToHex(Math.min(255,rgb.r*f+40),Math.min(255,rgb.g*f+40),Math.min(255,rgb.b*f+40));
    }
    return color;
  }
}
function _pickBrandColor(m,isLight){
  if(isLight){
    if(m.lightColor)return m.lightColor;
    return _themeAdjustColor(m.color||'#3b82f6',true);
  }
  return m.color||'#fde68a';
}
/* 가려진(hidden=true) 슬롯은 회전에서 skip 하되 _headerMsgs 자체는 그대로 유지
 * (설정 화면이 모든 슬롯을 표시해야 하므로). 한 바퀴 다 hidden 이면 안전망으로 첫 슬롯 사용. */
function _advanceToVisibleIdx(){
  const N=_headerMsgs.length;
  if(N===0)return null;
  for(let tries=0;tries<N;tries++){
    const m=_headerMsgs[_hdrIdx];
    if(m && m.hidden!==true) return m;
    _hdrIdx=(_hdrIdx+1)%N;
  }
  /* 전 슬롯이 hidden — 잠금(locked) 메시지로 fallback (잠금은 hidden 될 수 없는 데이터 모델) */
  return _headerMsgs[0]||null;
}

function cycleBrand(){
  const el=document.getElementById('cyclingBrand');if(!el)return;
  const m=_advanceToVisibleIdx();if(!m)return;
  const isLight=document.body.classList.contains('light');
  el.style.opacity='0';el.style.transform='translateY(-6px)';
  setTimeout(function(){
    const _useLogo=m.useLogo===true||m.emoji==='🍇';
    /* 브랜드(오렌지톡) 슬롯은 오렌지 톤 강제 — #f97316 */
    el.style.color=_useLogo ? '#f97316' : _pickBrandColor(m,isLight);
    /* 가독성 향상 — 라이트모드에선 얇은 흰 그림자, 다크모드에선 얇은 검은 그림자 */
    el.style.textShadow=isLight?'0 1px 2px rgba(255,255,255,0.6)':'0 1px 2px rgba(0,0,0,0.4)';
    /* \uC544\uC774\uCF58(\uB610\uB294 \uC774\uBAA8\uC9C0)\uACFC \uD14D\uC2A4\uD2B8 \uC218\uC9C1 \uC815\uB82C \u2014 \uD14D\uC2A4\uD2B8 \uB178\uB4DC baseline \uACFC \uC544\uC774\uCF58(vertical-align:middle) \uC5B4\uAE0B\uB0A8 fix. */
    const emojiHtml=_useLogo
      ? '<img src="assets/logo/logo_orange.gif" style="width:28px;height:28px;object-fit:contain;vertical-align:middle;margin-right:8px">'
      : '<span style="font-size:26px;vertical-align:middle;margin-right:8px;line-height:1">'+(m.emoji||'')+'</span>';
    /* 로고 슬롯("오렌지톡") 텍스트는 로고와 시각적 baseline 어긋남 보정 — 1px 아래로 */
    const _txtStyle=_useLogo?'vertical-align:middle;position:relative;top:1px':'vertical-align:middle';
    el.innerHTML=emojiHtml+'<span style="'+_txtStyle+'">'+escHtml(m.text||'')+'</span>';
    el.style.cursor='default';
    el.style.opacity='1';el.style.transform='translateY(0)';
  },400);
  _hdrIdx=(_hdrIdx+1)%_headerMsgs.length;
  /* 슬롯별 전환 시간 우선 — m.time(ms). 없으면 전역 ec_hdr_msg_interval(초) fallback, 최종 기본 30초. */
  let _interval = (typeof m.time === 'number' && m.time >= 3000) ? m.time : 0;
  if(!_interval){
    const _userSec = parseInt(localStorage.getItem('ec_hdr_msg_interval')||'', 10);
    _interval = (!isNaN(_userSec) && _userSec >= 3) ? _userSec*1000 : 15000;
  }
  setTimeout(cycleBrand, _interval);
}
/* 상단 회전문구 비활성화 (오렌지팜 요청 2026-05-27) — 회전 시작 호출 제거.
 *  cycleBrand 함수 자체는 그대로 두되 호출 안 함 → #cyclingBrand 는 로고 이미지 순환으로 대체.
 *  데이터(_headerMsgs, _lockedHeaderMsgs) 도 그대로 — 다른 곳에서 참조 시 안전. */
/* cycleBrand(); */

/* ── 좌측 상단 로고 순환 (오렌지팜 요청 2026-05-27 회전문구 대체) ──
 *  #cyclingBrand 자리에 otalk_logo / orangetalk_logo 두 이미지를 5초마다 cross-fade.
 *  두 이미지를 같은 grid 칸에 겹쳐 긴 로고의 너비를 확보하고 opacity 만 전환.
 *  preload 로 첫 전환 시 네트워크 지연도 제거. */
(function _initBrandLogoCycle(){
  function _start(){
    const el=document.getElementById('cyclingBrand');
    if(!el || el._brandLogoInit) return;
    el._brandLogoInit=true;
    const sources=['assets/icons/otalk_logo.png','assets/icons/orangetalk_logo.png'];
    sources.forEach(function(s){const i=new Image();i.src=s;});
    el.style.display='inline-grid';
    el.style.position='relative';
    el.style.verticalAlign='middle';
    el.style.lineHeight='0';
    /* CSS 의 transform:translateY(152px)(회전문구 시절 위치) 를 0 으로 override
     *  → row1 정중앙으로 올라와 대시보드 탭 바로 위에 위치 */
    el.style.transform='translateY(0)';
    el.innerHTML =
      '<img class="brand-logo-base" src="'+sources[0]+'" alt="" '+
        'style="grid-area:1/1;justify-self:center;display:block;height:38px;width:auto;opacity:1;transition:opacity 0.6s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));pointer-events:none" />' +
      '<img class="brand-logo-over" src="'+sources[1]+'" alt="" '+
        'style="grid-area:1/1;justify-self:center;display:block;height:38px;width:auto;opacity:0;transition:opacity 0.6s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));pointer-events:none" />';
    let showBase=true;
    setInterval(function(){
      showBase=!showBase;
      const base=el.querySelector('.brand-logo-base');
      const over=el.querySelector('.brand-logo-over');
      if(!base||!over)return;
      base.style.opacity = showBase ? '1' : '0';
      over.style.opacity = showBase ? '0' : '1';
    }, 10000);
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', _start);
  }else{
    _start();
  }
})();

/* 테마 전환 시 현재 브랜드 메시지 색상 즉시 갱신.
 *
 * 회귀 fix:
 *  - 이전에는 body class 가 변경될 때마다(매 클릭에 가까운 빈도로) 발화하여
 *    cyclingBrand 의 color/textShadow 를 매번 재설정 → transition:all 0.4s 와 결합되어
 *    "클릭할 때마다 색이 변하는 것처럼 보임" 회귀가 발생.
 *  - 또 useLogo 분기가 빠져 있어 잠금 메시지(오렌지팜) 표시 중에 #f97316(오렌지) 였던 색이
 *    이 옵저버에 의해 _pickBrandColor 값(보라)으로 덮어써졌음.
 *
 * 수정:
 *  1) light 클래스 토글 시에만 실제로 의미있는 색 변화 → light 변화만 감지
 *  2) cycleBrand 와 동일한 useLogo 분기 적용 (오렌지팜 슬롯 = 강제 오렌지)
 *  3) 같은 값을 다시 적용하지 않도록 가드 (idempotent) */
(function(){
  let _wasLight=document.body.classList.contains('light');
  new MutationObserver(function(){
    const isL=document.body.classList.contains('light');
    if(isL===_wasLight)return; /* light 상태 변화 없음 → 무시. 다른 클래스 변경에 휘둘리지 않음. */
    _wasLight=isL;
    const el=document.getElementById('cyclingBrand');if(!el)return;
    const cur=_headerMsgs[(_hdrIdx===0?_headerMsgs.length:_hdrIdx)-1];
    if(!cur)return;
    const _useLogo=cur.useLogo===true||cur.emoji==='🍇';
    const _nextColor=_useLogo?'#f97316':_pickBrandColor(cur,isL);
    const _nextShadow=isL?'0 1px 2px rgba(255,255,255,0.6)':'0 1px 2px rgba(0,0,0,0.4)';
    if(el.style.color!==_nextColor)el.style.color=_nextColor;
    if(el.style.textShadow!==_nextShadow)el.style.textShadow=_nextShadow;
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
})();

/* 상단 브랜드 메시지 클릭 → (이전 동작: 외부 URL 열기)
   변경: settings-view.js 의 핸들러가 설정 > 상단 회전문구 탭을 열도록 처리한다.
   외부 URL 을 열고 싶다면 해당 파일에서 경로를 바꿀 것. */

/* ── 사용자 커스텀 문구 (text + time 객체) ── */
function _loadUserFooterMsgs(){
  try{
    const s=JSON.parse(localStorage.getItem('ec_footer_msgs')||'null');
    if(Array.isArray(s)){
      const arr=s.map(function(item){
        if(typeof item==='string') return { text:item, time:15000 };
        if(item&&typeof item==='object'&&item.text){
          const t=(typeof item.time==='number'&&item.time>=3000)?item.time:15000;
          return { text:item.text, time:t };
        }
        return null;
      }).filter(Boolean);
      if(arr.length)return arr;
    }
  }catch(e){}
  return [];
}
let _userFooterMsgs=_loadUserFooterMsgs();
let _userFooterIdx=Math.floor(Math.random()*Math.max(_userFooterMsgs.length,1));

/* ── 순환 표시 ── */
/* 사용자 요청 2026-06-05 — 하단 푸터는 오렌지팜이 banner.json 으로 원격 관리하는 문구만 7초 순환.
 *  · 기존 2단계(브랜드↔문구) 순환 폐기. 브랜드 "오렌지톡 · Since 2026" 제거.
 *  · 사용자 커스텀 슬롯 없음, 브랜드 fallback 도 없음.
 *  · banner.json 비어있거나 로딩 실패면 푸터는 빈 칸 (오렌지팜이 채우면 자동 노출). */

/* 현재 슬롯의 time(ms) — 사용자 요청 2026-05-27: 기본 7초. */
let _footerNextInterval = 7000;
function _cycleFooter(){
  const el=document.getElementById('footerText');if(!el)return;

  /* 문구 0개 → 빈 푸터로 유지 (다음 tick 에 다시 검사). */
  if(!_footerMsgs.length){
    el.textContent='';
    _footerNextInterval=7000;
    return;
  }
  if(_footerIdx>=_footerMsgs.length)_footerIdx=0;
  const fm=_footerMsgs[_footerIdx];
  const text=(typeof fm==='string')?fm:(fm&&fm.text?fm.text:'');
  if(_footerOrder==='random' && _footerMsgs.length>1){
    let n; do{ n=Math.floor(Math.random()*_footerMsgs.length); }while(n===_footerIdx);
    _footerIdx=n;
  } else {
    _footerIdx=(_footerIdx+1)%_footerMsgs.length;
  }
  _footerNextInterval=7000;

  el.style.transition='opacity 0.4s,transform 0.4s';
  el.style.opacity='0';el.style.transform='translateY(6px)';
  setTimeout(function(){
    el.textContent=text;
    el.style.cursor='default';
    el.style.opacity='1';el.style.transform='translateY(0)';
  },400);
}
/* 슬롯별 시간 존중 — 매 전환 뒤 다음 interval 로 재스케줄. 첫 표시 1.5초. */
(function _footerScheduler(){
  setTimeout(function tick(){
    _cycleFooter();
    setTimeout(tick, _footerNextInterval);
  }, 1500);
})();

/* 설정에서 호출하는 저장/복원 함수 (사용자 커스텀 문구 — text만) */
export function _saveFooterMsgs(){
  const inputs=document.querySelectorAll('.footer-msg-input');
  const msgs=[];
  inputs.forEach(function(inp){const v=inp.value.trim();if(v)msgs.push(v);});
  localStorage.setItem('ec_footer_msgs',JSON.stringify(msgs));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','footer_msgs',msgs);
  _userFooterMsgs=msgs;
  _userFooterIdx=0;
  alert('하단 회전 문구가 저장되었습니다. ('+msgs.length+'개)');
}
export function _resetFooterMsgs(){
  if(!confirm('커스텀 문구를 모두 삭제하시겠습니까?'))return;
  localStorage.removeItem('ec_footer_msgs');
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','footer_msgs',null);
  _userFooterMsgs=[];
  _userFooterIdx=0;
  if(typeof renderSettingsPanel==='function')renderSettingsPanel('background');
}

/* ── 헤더 날짜/시간 업데이트 (항상 표시 — 2층 고정) ── */
function updateHeaderDate(){
  const now=new Date();const days=['일','월','화','수','목','금','토'];
  const y=now.getFullYear(), mo=String(now.getMonth()+1).padStart(2,'0'), d=String(now.getDate()).padStart(2,'0');
  const h=String(now.getHours()).padStart(2,'0'), mi=String(now.getMinutes()).padStart(2,'0');
  const el=document.getElementById('headerDate');
  if(el)el.textContent=y+'.'+mo+'.'+d+' '+days[now.getDay()]+'요일 '+h+':'+mi;
}
updateHeaderDate();setInterval(updateHeaderDate,1000);

/* ── 상단 1층 순환: 0=사용자정보 1=기온 2=폭염·한파·자외선 3=미세먼지 / 2층(날짜+날씨) 고정 ── */
export const _hdrCycle={phase:0,weatherEmoji:'',temp:'',tempHi:'',tempLo:'',weatherText:'',dustPm10:0,dustPm25:0,dustG10:'',dustG25:'',region:'',uvIndex:'',uvGrade:'',heatAlert:'',coldAlert:'',rain:'',o3:'',o3Grade:''};
_hdrCycle.weatherEmoji=localStorage.getItem('ec_headerWeather')||'☀️';
_hdrCycle.rain=localStorage.getItem('ec_rain')||'';   /* 현재 강수량(mm) — 비 올 때만 (사용자 요청 2026-06-17) */
_hdrCycle.o3=localStorage.getItem('ec_o3')||''; _hdrCycle.o3Grade=localStorage.getItem('ec_o3Grade')||'';
/* 2층 날씨 이모지 + (비 올 때) 강수량 흰 글씨. 여러 곳에서 공용. */
function _hdrWxEmojiHtml(){ const e=_hdrCycle.weatherEmoji||'☀️'; const r=String(_hdrCycle.rain||'').trim(); return e + (r?(' <span style="color:#fff;font-size:12px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.45)">('+r.replace(/[<>&]/g,'')+')</span>'):''); }
_hdrCycle.temp=localStorage.getItem('ec_temp')||'';
_hdrCycle.tempHi=localStorage.getItem('ec_tempHi')||'';
_hdrCycle.tempLo=localStorage.getItem('ec_tempLo')||'';
_hdrCycle.weatherText=localStorage.getItem('ec_weatherText')||'';
_hdrCycle.dustPm10=parseInt(localStorage.getItem('ec_dustPm10')||'0');
_hdrCycle.dustPm25=parseInt(localStorage.getItem('ec_dustPm25')||'0');
_hdrCycle.dustG10=localStorage.getItem('ec_dustG10')||'';
_hdrCycle.dustG25=localStorage.getItem('ec_dustG25')||'';
_hdrCycle.uvIndex=localStorage.getItem('ec_uvIndex')||'';
_hdrCycle.uvGrade=localStorage.getItem('ec_uvGrade')||'';
_hdrCycle.heatAlert=localStorage.getItem('ec_heatAlert')||'';
_hdrCycle.coldAlert=localStorage.getItem('ec_coldAlert')||'';
_hdrCycle.region=localStorage.getItem('ec_user_region')||localStorage.getItem('ec_weatherRegion')||'';
/* 지역명 폴백 — 학교 주소에서 광역시/특별시/시/군 추출 */
if(!_hdrCycle.region){
  const _addr=localStorage.getItem('ec_school_address')||'';
  if(_addr){
    const _m=_addr.match(/(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|제주특별자치도|경기도|충청북도|충청남도|전라북도|전북특별자치도|전라남도|경상북도|경상남도|강원특별자치도|강원도)/);
    if(_m){
      /* 광역시/특별시는 그대로, 도는 뒤에 시/군 붙이기 */
      const _prov=_m[1];
      if(_prov.includes('광역시')||_prov.includes('특별시')||_prov.includes('특별자치시')){
        _hdrCycle.region=_prov;
      } else {
        const _city=_addr.substring(_addr.indexOf(_prov)+_prov.length).trim().match(/^(\S+[시군구])/);
        _hdrCycle.region=_city?_city[1]:_prov;
      }
    }
  }
}
const _we=document.getElementById('headerWeather');
if(_we)_we.innerHTML=_hdrWxEmojiHtml();
/* 이층(날짜) 고정: 1층 최대 너비를 측정하여 header-meta min-width 확정 */
_recalcHdrWidth();
/* phase 0 즉시 렌더 (사용자 정보 — 20초 공백 방지) */
const _initInfoEl=document.getElementById('headerUserInfo');
if(_initInfoEl&&!_initInfoEl.innerHTML.trim()){
  _initInfoEl.innerHTML=_hdrPhaseHtml(0);
}
S._hdrRendering=false;
function _recalcHdrWidth(){
  const metaEl=document.querySelector('.header-meta');
  if(!metaEl)return;
  const c=_hdrCycle;
  const region=localStorage.getItem('ec_user_region')||localStorage.getItem('ec_weatherRegion')||c.region||'';
  const dustText=(region?region+' · ':'')+'PM10 '+(c.dustPm10||999)+'μg/m³ (매우나쁨) · PM2.5 '+(c.dustPm25||999)+'μg/m³ (매우나쁨)';
  const tempText=(region?region+' · ':'')+'현재 기온 '+(c.temp||'-99')+'°C (최고 '+(c.tempHi||'99')+'°C · 최저 '+(c.tempLo||'-99')+'°C)';
  /* 폭염·한파·자외선 페이즈도 폭 측정(가장 긴 경우 가정) */
  const wxText=(region?region+' · ':'')+(c.heatAlert?'🔥 '+c.heatAlert+' · ':'')+(c.coldAlert?'🥶 '+c.coldAlert+' · ':'')+'자외선지수 '+(c.uvIndex||'99')+' (매우높음)'+((c.o3!==''&&c.o3!=null)?' · 오존 '+c.o3+'ppm (매우나쁨)':'');
  const span=document.createElement('span');
  span.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;font-size:12px;font-weight:800;left:-9999px';
  document.body.appendChild(span);
  span.textContent=dustText;const w1=span.offsetWidth;
  span.textContent=tempText;const w2=span.offsetWidth;
  span.textContent=wxText;const w3=span.offsetWidth;
  span.remove();
  const maxW=Math.max(w1,w2,w3)+8;/* 볼드 태그 차이 최소 여유분 */
  const dateEl=metaEl.querySelector('.header-date');
  const dw=dateEl?dateEl.scrollWidth:0;
  const needed=Math.max(maxW,dw);
  metaEl.style.minWidth=needed+'px';
  metaEl.setAttribute('data-hdr-mw',String(needed));
}
/* 피어 배지는 전광판(#dailyVisitorCount 2층)으로 이동 — 회전문구에서는 표시하지 않음 */
function _resolveRegionFromSchoolAddress(){
  const _addr=localStorage.getItem('ec_school_address')||'';
  if(!_addr)return '';
  const _m=_addr.match(/(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|제주특별자치도|경기도|충청북도|충청남도|전라북도|전북특별자치도|전라남도|경상북도|경상남도|강원특별자치도|강원도)/);
  if(!_m)return '';
  const _prov=_m[1];
  if(_prov.includes('광역시')||_prov.includes('특별시')||_prov.includes('특별자치시'))return _prov;
  const _city=_addr.substring(_addr.indexOf(_prov)+_prov.length).trim().match(/^(\S+[시군구])/);
  return _city?_city[1]:_prov;
}
function _hdrPhaseHtml(phase){
  const c=_hdrCycle;
  const _dc=function(g){return g==='좋음'?'#4ade80':g==='보통'?'#60a5fa':g==='나쁨'?'#fbbf24':'#f87171';};
  /* 매 렌더마다 학교 주소 폴백 시도 — 학교 주소가 나중에 로드되는 경우 대응 */
  let region=localStorage.getItem('ec_user_region')||localStorage.getItem('ec_weatherRegion')||c.region||'';
  if(!region){region=_resolveRegionFromSchoolAddress();if(region)c.region=region;}
  if(phase===0){
    /* 사용자 정보 — 교육청 · 학교 · 직위 · 이름 을 한 덩어리로 표시 */
    const cu=S._currentUser||{};
    const up=S._userProfile||(function(){try{return JSON.parse(localStorage.getItem('ec_user')||'{}');}catch(e){return {};}})();
    const hs=JSON.parse(localStorage.getItem('ec_settings')||'{}');
    const eduOffice=cu.edu_office||up.eduOffice||hs.eduOffice||'';
    const schoolName=cu.school_name||up.school||hs.schoolName||'';
    /* 첫 실행 시(cu/up/hs에 position 미저장 상태) 에도 직위를 노출하기 위해 기본값 '보건교사' 적용 —
       앱 전반(방문증·설문·스플래시 등)에서 동일하게 '보건교사' 를 기본 직위로 사용 중 */
    const position=cu.position||up.position||hs.position||hs.nursePosition||'보건교사';
    const nameStr=cu.name||up.name||hs.nurse1||'';
    /* 가운데 점(·)으로 구분 — 교육청 · 학교 · 직위 · 이름 */
    const _parts=[eduOffice,schoolName,position].filter(Boolean);
    /* 이름도 교육청·학교·직위와 동일한 굵기·크기·색 (강조 래퍼 제거 — 사용자 요청 2026-06-13) */
    let u1='<span>'+escHtml(_parts.join(' · '))+
      (nameStr?(_parts.length?' · ':'')+escHtml(nameStr):'')+'</span>';
    return u1;
  } else if(phase===1){
    const parts=[];
    if(region)parts.push(escHtml(region));
    const tempStr=(c.temp!==''&&c.temp!==null&&c.temp!==undefined)?String(c.temp):'';
    if(tempStr){
      /* 기온 숫자도 "현재 기온" 글씨와 동일한 굵기·크기·색 (강조 래퍼 제거 — 사용자 요청 2026-06-13) */
      let t='현재 기온 '+escHtml(tempStr)+'°C';
      if(c.tempHi||c.tempLo){
        t+=' (';
        if(c.tempHi)t+='<span style="color:#fb923c;font-weight:700">최고 '+escHtml(String(c.tempHi))+'°C</span>';
        if(c.tempHi&&c.tempLo)t+=' · ';
        if(c.tempLo)t+='<span style="color:#60a5fa;font-weight:700">최저 '+escHtml(String(c.tempLo))+'°C</span>';
        t+=')';
      }
      parts.push(t);
    }
    return parts.join(' · ')||(region||'날씨 데이터 없음');
  } else if(phase===2){
    /* 폭염·한파 특보 + 자외선지수 */
    const parts=[];
    if(region)parts.push(escHtml(region));
    if(c.heatAlert)parts.push('<span style="color:#f87171;font-weight:800">🔥 '+escHtml(c.heatAlert)+'</span>');
    if(c.coldAlert)parts.push('<span style="color:#60a5fa;font-weight:800">🥶 '+escHtml(c.coldAlert)+'</span>');
    if(c.uvIndex!==''&&c.uvIndex!=null&&!isNaN(parseFloat(c.uvIndex))){
      const g=c.uvGrade||_uvGrade(c.uvIndex);
      parts.push('자외선지수 '+escHtml(String(c.uvIndex))+' <span style="color:'+_uvColor(g)+';font-weight:700">('+escHtml(g||'--')+')</span>');
    }
    if(c.o3!==''&&c.o3!=null&&!isNaN(parseFloat(c.o3))){
      const og=c.o3Grade||'';
      parts.push('오존 '+escHtml(String(c.o3))+'ppm <span style="color:'+_dc(og)+';font-weight:700">('+escHtml(og||'--')+')</span>');
    }
    return parts.join(' · ')||(region||'자외선·특보 데이터 없음');
  } else {
    const parts=[];
    if(region)parts.push(escHtml(region));
    const pm10=c.dustPm10;const pm25=c.dustPm25;
    if(pm10||pm10===0){
      const g10=c.dustG10||'';
      parts.push('PM10 '+pm10+'μg/m³ <span style="color:'+_dc(g10)+';font-weight:700">('+escHtml(g10||'--')+')</span>');
    }
    if(pm25||pm25===0){
      const g25=c.dustG25||'';
      parts.push('PM2.5 '+pm25+'μg/m³ <span style="color:'+_dc(g25)+';font-weight:700">('+escHtml(g25||'--')+')</span>');
    }
    return parts.join(' · ')||(region||'미세먼지 데이터 없음');
  }
}
function _hdrCycleRender(){
  const infoEl=document.getElementById('headerUserInfo');
  if(!infoEl)return;
  if(S._hdrRendering)return;
  S._hdrRendering=true;
  infoEl.style.transition='opacity 0.35s ease,transform 0.35s ease';
  infoEl.style.opacity='0';
  infoEl.style.transform='translateY(-7px)';
  setTimeout(function(){
    try{infoEl.innerHTML=_hdrPhaseHtml(_hdrCycle.phase);}catch(e){infoEl.textContent='';}
    infoEl.style.transition='none';
    infoEl.style.transform='translateY(7px)';
    void infoEl.offsetWidth;
    infoEl.style.transition='opacity 0.4s ease,transform 0.4s ease';
    infoEl.style.opacity='1';
    infoEl.style.transform='translateY(0)';
    S._hdrRendering=false;
  },370);
}
/* 동료 접속/해제 시 전광판 즉시 갱신 */
bus.on('collab:peer-changed',function(){
  _hdrCycle.phase=0;
  _hdrCycleRender();
});
/* 사용자 정보 (교육청·학교·직위·이름) 갱신 시 phase 0 즉시 재렌더.
 * 첫 설치 후 phase 0 가 "보건교사" 만 단독 표시되던 회귀 fix —
 * 모듈 로드 시점에는 DB 로딩이 아직 안 끝나 S._currentUser/S._userProfile 가 비어 있다.
 * data-loader / 로그인 / 설정 저장 시점마다 이 이벤트를 emit 해 즉시 반영. */
bus.on('header:refresh-user',function(){
  _hdrCycle.phase=0;
  _hdrCycleRender();
});
/* phase별 표시 시간: 0 사용자정보 7초 / 1 기온 / 2 폭염·한파·자외선 / 3 미세먼지 각 5초 */
const _hdrTimers=[7000,5000,5000,5000];
/* 해당 phase 에 표시할 데이터가 있는가 — 없으면 순환에서 건너뜀 */
function _hasPhaseData(p){
  if(p===0)return true;
  if(p===1)return _hdrCycle.temp!==''&&_hdrCycle.temp!=null;
  if(p===2)return !!(_hdrCycle.heatAlert||_hdrCycle.coldAlert||(_hdrCycle.uvIndex!==''&&_hdrCycle.uvIndex!=null)||(_hdrCycle.o3!==''&&_hdrCycle.o3!=null));
  if(p===3)return !!_hdrCycle.dustG10;
  return false;
}
/* cur 다음의 '데이터 있는' phase 로 진행 (없으면 0 으로 회귀) */
function _advancePhase(cur){
  for(let i=1;i<=4;i++){ const n=(cur+i)%4; if(_hasPhaseData(n))return n; }
  return 0;
}
function _hdrNextPhase(){
  if(localStorage.getItem('ec_weather_rotate')==='false')return;
  if(S._hdrRendering){clearTimeout(_hdrCycle._timer);_hdrCycle._timer=setTimeout(_hdrNextPhase,1000);return;}
  const next=_advancePhase(_hdrCycle.phase);
  _hdrCycle.phase=next;
  _hdrCycleRender();
  clearTimeout(_hdrCycle._timer);
  _hdrCycle._timer=setTimeout(_hdrNextPhase,_hdrTimers[next]||20000);
}
_hdrCycle._timer=setTimeout(_hdrNextPhase,_hdrTimers[0]);
export function cycleWeather(){
  if(S._hdrRendering)return;
  clearTimeout(_hdrCycle._timer);
  const next=_advancePhase(_hdrCycle.phase);
  _hdrCycle.phase=next;
  _hdrCycleRender();
  _hdrCycle._timer=setTimeout(_hdrNextPhase,_hdrTimers[next]||20000);
}

/* ── WMO 날씨 코드 변환 ── */
function wmoToEmoji(code){
  if(code===0)return '☀️';
  if(code===1)return '🌤️';
  if(code===2)return '⛅';
  if(code===3)return '☁️';
  if(code>=45&&code<=48)return '🌫️';
  if(code>=51&&code<=55)return '🌦️';
  if(code>=56&&code<=57)return '🌧️';
  if(code>=61&&code<=65)return '🌧️';
  if(code>=66&&code<=67)return '🌧️';
  if(code>=71&&code<=75)return '❄️';
  if(code===77)return '🌨️';
  if(code>=80&&code<=82)return '🌦️';
  if(code>=85&&code<=86)return '🌨️';
  if(code>=95&&code<=99)return '⛈️';
  return '☀️';
}
function wmoToText(code){
  if(code===0)return '맑음';
  if(code===1)return '대체로 맑음';
  if(code===2)return '구름 조금';
  if(code===3)return '흐림';
  if(code>=45&&code<=48)return '안개';
  if(code>=51&&code<=55)return '이슬비';
  if(code>=56&&code<=57)return '얼어붙는 이슬비';
  if(code>=61&&code<=65)return '비';
  if(code>=66&&code<=67)return '얼어붙는 비';
  if(code>=71&&code<=75)return '눈';
  if(code===77)return '싸락눈';
  if(code>=80&&code<=82)return '소나기';
  if(code>=85&&code<=86)return '눈보라';
  if(code>=95&&code<=99)return '뇌우';
  return '맑음';
}

/* ── 위치 가져오기 ── */
function _getLocation(){
  return new Promise(function(resolve){
    /* 0순위: 기준위치 (설정 → API 관리에서 넣은 학교 위치 ec_school_lat/lng). 날씨·자외선은 이 위치 기준이어야 함 (사용자 지시 2026-06-17).
     *  GPS/IP 는 학교가 아닌 현재 PC 위치라 부정확 → 기준위치가 있으면 무조건 우선. */
    const _sLat=parseFloat(localStorage.getItem('ec_school_lat')||''), _sLon=parseFloat(localStorage.getItem('ec_school_lng')||localStorage.getItem('ec_school_lon')||'');
    if(isFinite(_sLat)&&isFinite(_sLon)&&_sLat!==0&&_sLon!==0){
      resolve({latitude:_sLat,longitude:_sLon,city:(localStorage.getItem('ec_user_region')||'')});
      return;
    }
    /* 1순위: GPS (navigator.geolocation) */
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        function(pos){
          const lat=pos.coords.latitude, lon=pos.coords.longitude;
          /* 역지오코딩으로 도시명 가져오기 */
          window.electronAPI.weatherReverseGeocode(lat,lon)
            .then(function(res){
              const city=(res&&res.success&&res.data&&res.data.city)||'';
              resolve({latitude:lat,longitude:lon,city:city});
            })
            .catch(function(){resolve({latitude:lat,longitude:lon,city:''});});
        },
        function(){_getLocationByIP().then(resolve);},
        {timeout:5000,maximumAge:600000}
      );
    } else {
      _getLocationByIP().then(resolve);
    }
  });
}
function _getLocationByIP(){
  return window.electronAPI.weatherIpLocation().then(function(res){
    if(res&&res.success&&res.data)return res.data;
    return{latitude:37.5665,longitude:126.9780,city:''};
  }).catch(function(){return{latitude:37.5665,longitude:126.9780,city:''};});
}

/* ── 날씨 가져오기 ── */
window.fetchWeather=fetchWeather;
function fetchWeather(){
  const src=localStorage.getItem('ec_weather_source')||'openmeteo';
  console.log('[WEATHER] fetchWeather called, source='+src);
  if(src==='kma'){fetchWeatherKMA();return;}
  _getLocation().then(function(loc){
      const lat=(loc.latitude||37.5665).toFixed(4);
      const lon=(loc.longitude||126.9780).toFixed(4);
      const _cityKo={
/* 특별시·광역시·특별자치시 */
'Seoul':'서울','Busan':'부산','Incheon':'인천','Daegu':'대구','Daejeon':'대전','Gwangju':'광주','Ulsan':'울산','Sejong':'세종',
/* 경기도 */
'Suwon':'수원','Seongnam':'성남','Goyang':'고양','Yongin':'용인','Bucheon':'부천','Ansan':'안산','Anyang':'안양','Namyangju':'남양주','Hwaseong':'화성','Pyeongtaek':'평택','Uijeongbu':'의정부','Siheung':'시흥','Gimpo':'김포','Gwangmyeong':'광명','Hanam':'하남','Gunpo':'군포','Osan':'오산','Icheon':'이천','Yangju':'양주','Paju':'파주','Gwacheon':'과천','Pocheon':'포천','Dongducheon':'동두천','Guri':'구리','Yeoju':'여주','Gwangju':'광주','Yangpyeong':'양평','Gapyeong':'가평','Yeoncheon':'연천',
/* 강원도 */
'Chuncheon':'춘천','Wonju':'원주','Gangneung':'강릉','Donghae':'동해','Taebaek':'태백','Sokcho':'속초','Samcheok':'삼척','Hongcheon':'홍천','Hoengseong':'횡성','Yeongwol':'영월','Pyeongchang':'평창','Jeongseon':'정선','Cheorwon':'철원','Hwacheon':'화천','Yanggu':'양구','Inje':'인제','Goseong':'고성','Yangyang':'양양',
/* 충청북도 */
'Cheongju':'청주','Chungju':'충주','Jecheon':'제천','Boeun':'보은','Okcheon':'옥천','Yeongdong':'영동','Jeungpyeong':'증평','Jincheon':'진천','Goesan':'괴산','Eumseong':'음성','Danyang':'단양',
/* 충청남도 */
'Cheonan':'천안','Asan':'아산','Gongju':'공주','Boryeong':'보령','Seosan':'서산','Nonsan':'논산','Gyeryong':'계룡','Dangjin':'당진','Geumsan':'금산','Buyeo':'부여','Seocheon':'서천','Cheongyang':'청양','Hongseong':'홍성','Yesan':'예산','Taean':'태안',
/* 전라북도 */
'Jeonju':'전주','Gunsan':'군산','Iksan':'익산','Jeongeup':'정읍','Namwon':'남원','Gimje':'김제','Wanju':'완주','Jinan':'진안','Muju':'무주','Jangsu':'장수','Imsil':'임실','Sunchang':'순창','Gochang':'고창','Buan':'부안',
/* 전라남도 */
'Mokpo':'목포','Yeosu':'여수','Suncheon':'순천','Naju':'나주','Gwangyang':'광양','Damyang':'담양','Gokseong':'곡성','Gurye':'구례','Goheung':'고흥','Boseong':'보성','Hwasun':'화순','Jangheung':'장흥','Gangjin':'강진','Haenam':'해남','Yeongam':'영암','Muan':'무안','Hampyeong':'함평','Yeonggwang':'영광','Jangseong':'장성','Wando':'완도','Jindo':'진도','Sinan':'신안',
/* 경상북도 */
'Pohang':'포항','Gyeongju':'경주','Gimcheon':'김천','Andong':'안동','Gumi':'구미','Yeongju':'영주','Yeongcheon':'영천','Sangju':'상주','Mungyeong':'문경','Gyeongsan':'경산','Gunwi':'군위','Uiseong':'의성','Cheongsong':'청송','Yeongyang':'영양','Yeongdeok':'영덕','Cheongdo':'청도','Goryeong':'고령','Seongju':'성주','Chilgok':'칠곡','Yecheon':'예천','Bonghwa':'봉화','Uljin':'울진','Ulleung':'울릉',
/* 경상남도 */
'Changwon':'창원','Jinju':'진주','Tongyeong':'통영','Sacheon':'사천','Gimhae':'김해','Miryang':'밀양','Geoje':'거제','Yangsan':'양산','Uiryeong':'의령','Haman':'함안','Changnyeong':'창녕','Goseong':'고성','Namhae':'남해','Hadong':'하동','Sancheong':'산청','Hamyang':'함양','Geochang':'거창','Hapcheon':'합천',
/* 제주도 */
'Jeju':'제주','Seogwipo':'서귀포'};
      const userRegion=localStorage.getItem('ec_user_region')||'';
      const region=userRegion||(loc.city?((/[\uAC00-\uD7AF]/.test(loc.city))?loc.city:(_cityKo[loc.city]||loc.city)):'');
      _hdrCycle.region=region;
      localStorage.setItem('ec_weatherRegion',region);
      /* 날씨 + 대기질 동시 요청 */
      window.electronAPI.weatherOpenMeteo(lat,lon).then(function(res){
        const d=res&&res.success&&res.data?res.data.weather:null, aq=res&&res.success&&res.data?res.data.airQuality:null;
        if(d&&d.current){
          const code=d.current.weather_code;
          const temp=Math.round(d.current.temperature_2m);
          const hi=d.daily?Math.round(d.daily.temperature_2m_max[0]):'';
          const lo=d.daily?Math.round(d.daily.temperature_2m_min[0]):'';
          _setHeaderWeather(wmoToEmoji(code),wmoToText(code),temp,hi,lo);
          _setHeaderUv(_extractUv(d));   /* 자외선지수(오늘 최대) */
        }
        localStorage.setItem('ec_weather_actual_source','openmeteo');
        /* 미세먼지: 에어코리아 키+측정소 있으면 우선 사용, 실패 시 Open-Meteo 폴백 */
        const _airKey=getPublicDataApiKey('airkorea');
        const _airStn=(localStorage.getItem('ec_airkorea_station')||'').trim();
        function _applyOpenMeteoDust(){
          if(aq&&aq.current&&(aq.current.pm10!==undefined||aq.current.pm2_5!==undefined)){
            const pm10=Math.round(aq.current.pm10||0);
            const pm25=Math.round(aq.current.pm2_5||0);
            localStorage.setItem('ec_dust_source','openmeteo');
            _setHeaderDust(pm10,pm25);
          }
        }
        if(_airKey&&_airStn&&window.electronAPI&&window.electronAPI.externalFetchAirkorea){
          window.electronAPI.externalFetchAirkorea(_airKey,_airStn).then(function(r2){
            if(r2&&r2.success&&r2.data){
              const pm10=parseInt(r2.data.pm10)||0;
              const pm25=parseInt(r2.data.pm25)||0;
              localStorage.setItem('ec_dust_source','airkorea');
              _setHeaderDust(pm10,pm25);
              _setHeaderO3(r2.data.o3);   /* 오존 (ppm) — 자외선 옆 표시 (사용자 요청 2026-06-17) */
            } else {
              _applyOpenMeteoDust();
            }
          }).catch(function(){_applyOpenMeteoDust();});
        } else {
          _applyOpenMeteoDust();
        }
        /* 시간별 데이터 캐시 */
        _cacheHourlyData(d,aq);
      }).catch(function(err){console.error('[WEATHER] API error:',err);});
    })
    .catch(function(err){console.error('[WEATHER] location error:',err);});
}
function _setHeaderWeather(emoji,text,temp,hi,lo){
  const hadTemp=!!_hdrCycle.temp;
  _hdrCycle.weatherEmoji=emoji;
  _hdrCycle.weatherText=text;
  _hdrCycle.temp=temp;
  _hdrCycle.tempHi=hi||'';
  _hdrCycle.tempLo=lo||'';
  localStorage.setItem('ec_headerWeather',emoji);
  localStorage.setItem('ec_weatherText',text);
  localStorage.setItem('ec_temp',String(temp));
  localStorage.setItem('ec_tempHi',String(hi||''));
  localStorage.setItem('ec_tempLo',String(lo||''));
  localStorage.setItem('ec_weatherInfo',text+' '+temp+'°C');
  _computeWxAlerts();   /* 최고/최저기온 기반 폭염·한파 산출 */
  /* 2층 날씨(이모지+강수량)는 고정 영역이라 항상 갱신 */
  { const el=document.getElementById('headerWeather'); if(el)el.innerHTML=_hdrWxEmojiHtml(); }
  _recalcHdrWidth();
  /* 날씨 데이터 도착 시 phase 0에 머물러 있으면 즉시 순환 시작 */
  if(temp&&_hdrCycle.phase===0){clearTimeout(_hdrCycle._timer);_hdrCycle._timer=setTimeout(_hdrNextPhase,3000);}
}
/* 폭염·한파 — 기상청 특보 기준(일최고/일최저기온)에 따른 파생 표기.
 *  폭염주의보 일최고 33℃↑ / 폭염경보 35℃↑ · 한파주의보 일최저 -12℃↓ / 한파경보 -15℃↓.
 *  (정식 특보는 체감온도·지속시간까지 보지만, 학교 보건 안내 목적의 근사 경고로 충분히 유용하고 안전.) */
function _computeWxAlerts(){
  const hi=parseFloat(_hdrCycle.tempHi), lo=parseFloat(_hdrCycle.tempLo);
  let heat='', cold='';
  if(!isNaN(hi)){ if(hi>=35)heat='폭염경보'; else if(hi>=33)heat='폭염주의보'; }
  if(!isNaN(lo)){ if(lo<=-15)cold='한파경보'; else if(lo<=-12)cold='한파주의보'; }
  _hdrCycle.heatAlert=heat; _hdrCycle.coldAlert=cold;
  try{ localStorage.setItem('ec_heatAlert',heat); localStorage.setItem('ec_coldAlert',cold); }catch(_){}
}
/* 자외선지수 등급 — 기상청 5단계 */
function _uvGrade(v){
  if(v==null||v==='')return '';
  const n=Math.round(parseFloat(v)); if(isNaN(n))return '';
  if(n<=2)return '낮음'; if(n<=5)return '보통'; if(n<=7)return '높음'; if(n<=10)return '매우높음'; return '위험';
}
function _uvColor(g){ return g==='낮음'?'#4ade80':g==='보통'?'#facc15':g==='높음'?'#fb923c':g==='매우높음'?'#f87171':g==='위험'?'#a855f7':'#9ca3af'; }
/* Open-Meteo 응답에서 오늘 자외선지수(일최대) 추출 */
function _extractUv(weatherData){
  try{
    if(weatherData&&weatherData.daily&&Array.isArray(weatherData.daily.uv_index_max)&&weatherData.daily.uv_index_max.length){
      const v=weatherData.daily.uv_index_max[0];
      if(v!=null&&!isNaN(parseFloat(v)))return Math.round(parseFloat(v)*10)/10;
    }
  }catch(_){}
  return '';
}
function _setHeaderUv(uv){
  if(uv===''||uv==null||isNaN(parseFloat(uv)))return;
  const g=_uvGrade(uv);
  _hdrCycle.uvIndex=uv; _hdrCycle.uvGrade=g;
  try{ localStorage.setItem('ec_uvIndex',String(uv)); localStorage.setItem('ec_uvGrade',g); }catch(_){}
  _recalcHdrWidth();
}
function _dustGrade(val,type){
  if(type==='pm10')return val<=30?'좋음':val<=80?'보통':val<=150?'나쁨':'매우나쁨';
  return val<=15?'좋음':val<=35?'보통':val<=75?'나쁨':'매우나쁨';
}
function _setHeaderDust(pm10,pm25){
  const hadDust=!!_hdrCycle.dustG10;
  const g10=_dustGrade(pm10,'pm10');
  const g25=_dustGrade(pm25,'pm25');
  _hdrCycle.dustPm10=pm10;
  _hdrCycle.dustPm25=pm25;
  _hdrCycle.dustG10=g10;
  _hdrCycle.dustG25=g25;
  localStorage.setItem('ec_dustPm10',String(pm10));
  localStorage.setItem('ec_dustPm25',String(pm25));
  localStorage.setItem('ec_dustG10',g10);
  localStorage.setItem('ec_dustG25',g25);
  _recalcHdrWidth();
  /* 미세먼지 데이터 도착 시 phase 0에 머물러 있으면 즉시 순환 시작 */
  if(g10&&_hdrCycle.phase===0){clearTimeout(_hdrCycle._timer);_hdrCycle._timer=setTimeout(_hdrNextPhase,3000);}
}
/* 오존(ppm) 등급 — 환경부 1시간 기준 (좋음≤0.030, 보통≤0.090, 나쁨≤0.150, 매우나쁨>0.150) */
function _o3Grade(ppm){
  const n=parseFloat(ppm); if(isNaN(n))return '';
  return n<=0.030?'좋음':n<=0.090?'보통':n<=0.150?'나쁨':'매우나쁨';
}
function _setHeaderO3(o3){
  if(o3===''||o3==null||o3==='-'||isNaN(parseFloat(o3))){ _hdrCycle.o3=''; _hdrCycle.o3Grade=''; return; }
  const v=parseFloat(o3);
  const g=_o3Grade(v);
  _hdrCycle.o3=v; _hdrCycle.o3Grade=g;
  try{ localStorage.setItem('ec_o3',String(v)); localStorage.setItem('ec_o3Grade',g); }catch(_){}
  _recalcHdrWidth();
}

/* ── 기상청 단기예보 API ── */
function _latLonToGrid(lat,lon){
  const RE=6371.00877, GRID=5.0, SLAT1=30.0, SLAT2=60.0, OLON=126.0, OLAT=38.0, XO=43, YO=136;
  const DEGRAD=Math.PI/180.0;
  const re=RE/GRID;
  const slat1=SLAT1*DEGRAD, slat2=SLAT2*DEGRAD, olon=OLON*DEGRAD, olat=OLAT*DEGRAD;
  let sn=Math.tan(Math.PI*0.25+slat2*0.5)/Math.tan(Math.PI*0.25+slat1*0.5);
  sn=Math.log(Math.cos(slat1)/Math.cos(slat2))/Math.log(sn);
  let sf=Math.tan(Math.PI*0.25+slat1*0.5);sf=Math.pow(sf,sn)*Math.cos(slat1)/sn;
  let ro=Math.tan(Math.PI*0.25+olat*0.5);ro=re*sf/Math.pow(ro,sn);
  let ra=Math.tan(Math.PI*0.25+lat*DEGRAD*0.5);ra=re*sf/Math.pow(ra,sn);
  let theta=lon*DEGRAD-olon;if(theta>Math.PI)theta-=2*Math.PI;if(theta<-Math.PI)theta+=2*Math.PI;
  theta*=sn;
  return{nx:Math.floor(ra*Math.sin(theta)+XO+0.5),ny:Math.floor(ro-ra*Math.cos(theta)+YO+0.5)};
}
function _kmaSkyToEmoji(sky,pty){
  if(pty==='1'||pty==='4')return{emoji:'🌧️',text:'비'};
  if(pty==='2'||pty==='6')return{emoji:'🌨️',text:'비/눈'};
  if(pty==='3'||pty==='7')return{emoji:'❄️',text:'눈'};
  if(sky==='1')return{emoji:'☀️',text:'맑음'};
  if(sky==='3')return{emoji:'⛅',text:'구름많음'};
  if(sky==='4')return{emoji:'☁️',text:'흐림'};
  return{emoji:'🌤️',text:'맑음'};
}
function fetchWeatherKMA(){
  const apiKey=getPublicDataApiKey('kma');
  if(!apiKey){
    /* KMA 키 없으면 Open-Meteo로 폴백 (설정값은 유지) */
    _fetchWeatherOpenMeteo();
    return;
  }
  _getLocation().then(function(loc){   /* 기준위치(API관리) 우선 — KMA 모드도 동일 위치 사용 (사용자 지시 2026-06-17) */
    const lat=loc.latitude||37.5665, lon=loc.longitude||126.9780;

    /* 자외선지수 — 기상청 생활기상지수 API(data.go.kr) + 카카오 좌표→지역코드 (학교망에서 open-meteo 차단되어도 작동).
     *  실패 시에만 open-meteo 로 폴백. (사용자 보고/지시 2026-06-17) */
    if(window.electronAPI&&window.electronAPI.weatherUvKma){
      window.electronAPI.weatherUvKma(getPublicDataApiKey('uv'),(localStorage.getItem('ec_kakao_rest_api_key')||''),lat,lon).then(function(r){
        if(r&&r.success&&r.data&&r.data.uv!=null){ _setHeaderUv(r.data.uv); return; }
        /* 실패해도 직전 캐시값(ec_uvIndex)이 있으면 그대로 표시 중이므로 조용히. 캐시도 없을 때만 경고. */
        if(!(localStorage.getItem('ec_uvIndex')||'').trim()) console.warn('[WEATHER-UV-KMA] 미표시:', JSON.stringify(r));
        if(window.electronAPI.weatherOpenMeteo){
          window.electronAPI.weatherOpenMeteo(lat,lon).then(function(r2){ const wd=r2&&r2.success&&r2.data?r2.data.weather:null; if(wd)_setHeaderUv(_extractUv(wd)); }).catch(function(){});
        }
      }).catch(function(e){ console.warn('[WEATHER-UV-KMA] 실패:', e&&e.message); });
    }

    /* ① 기상청 초단기예보 + 단기예보 (기온, 하늘, 최고/최저) */
    window.electronAPI.weatherKma(apiKey,lat,lon).then(function(res){
      console.log('[WEATHER-KMA] 응답:', JSON.stringify(res).substring(0,500));
      const d=res&&res.success?res.data:null;
      if(!d){console.log('[WEATHER-KMA] 데이터 없음, Open-Meteo 폴백');_fetchWeatherOpenMeteo();return;}

      /* 초단기예보: 현재 기온, 하늘, 강수(형태/량). RN1·PTY 는 가장 가까운 예보시각(첫 값) 사용. */
      let sky='1', pty='0', t1h='', rn1='', ptyNear='';
      const ultraData=d.ultra;
      if(ultraData&&ultraData.response&&ultraData.response.body&&ultraData.response.body.items){
        const uItems=ultraData.response.body.items.item||[];
        uItems.forEach(function(it){
          if(it.category==='SKY')sky=it.fcstValue;
          if(it.category==='PTY')pty=it.fcstValue;
          if(it.category==='T1H')t1h=it.fcstValue;
          if(it.category==='PTY'&&ptyNear==='')ptyNear=it.fcstValue;   /* 가장 가까운 시각의 강수형태 */
          if(it.category==='RN1'&&rn1==='')rn1=it.fcstValue;           /* 가장 가까운 시각의 1시간 강수량 */
        });
      }
      /* 비가 올 때만(강수형태 1·2·5·6 = 비계열) 강수량 표시. 눈(3·7)·없음(0)은 미표시. (사용자 요청 2026-06-17) */
      let rainStr='';
      { const _isRain=(ptyNear==='1'||ptyNear==='2'||ptyNear==='5'||ptyNear==='6'); const _n=parseFloat(rn1);
        if(_isRain && isFinite(_n) && _n>0) rainStr=(Math.round(_n*10)/10)+'mm'; }
      _hdrCycle.rain=rainStr; try{ localStorage.setItem('ec_rain',rainStr); }catch(_){}

      /* 단기예보: TMN(최저, 0200응답) + TMX(최고, 0500응답) */
      let tmx='', tmn='';
      function _parseVilag(vd){
        if(!vd||!vd.response||!vd.response.body||!vd.response.body.items)return;
        const items=vd.response.body.items.item||[];
        items.forEach(function(it){
          if(it.category==='TMX'&&it.fcstValue)tmx=it.fcstValue;
          if(it.category==='TMN'&&it.fcstValue)tmn=it.fcstValue;
        });
      }
      _parseVilag(d.vilag0200);
      _parseVilag(d.vilag0500);

      console.log('[WEATHER-KMA] 파싱: t1h='+t1h+', sky='+sky+', pty='+pty+', tmx='+tmx+', tmn='+tmn);
      /* KMA 응답에서 기온(t1h) 파싱 실패 → Open-Meteo 폴백 (기존 기온 유지) */
      if(!t1h){
        console.warn('[WEATHER-KMA] 기온 데이터 없음, Open-Meteo 폴백');
        _fetchWeatherOpenMeteo();
        return;
      }
      const w=_kmaSkyToEmoji(sky,pty);
      localStorage.setItem('ec_weather_actual_source','kma');
      _setHeaderWeather(w.emoji,w.text,parseInt(t1h),tmx?Math.round(parseFloat(tmx)):'',tmn?Math.round(parseFloat(tmn)):'');
    }).catch(function(){
      _fetchWeatherOpenMeteo();
    });

    /* ② 에어코리아 미세먼지 (측정소명 기반).
     *  웹 클라이언트(__isWebBrowser) 는 본인 PC localStorage 가 비어 있어도 호출 시도 —
     *  server.js 의 external-fetch-airkorea 가 키·측정소 모두 호스트 blob 으로 폴백한다. */
    const airKey=getPublicDataApiKey('airkorea');
    const airStation=localStorage.getItem('ec_airkorea_station')||'';
    if((airKey&&airStation)||window.__isWebBrowser){
      window.electronAPI.externalFetchAirkorea(airKey,airStation).then(function(res){
        if(res&&res.success&&res.data){
          const pm10=parseInt(res.data.pm10)||0;
          const pm25=parseInt(res.data.pm25)||0;
          localStorage.setItem('ec_dust_source','airkorea');
          _setHeaderDust(pm10,pm25);
          _setHeaderO3(res.data.o3);   /* 오존 (ppm) — 자외선 옆 표시 (사용자 요청 2026-06-17) */
        } else {
          /* 에어코리아 응답 실패 → Open-Meteo 폴백 */
          window.electronAPI.weatherOpenMeteo(lat.toFixed(4),lon.toFixed(4)).then(function(r2){
            const aq=r2&&r2.success&&r2.data?r2.data.airQuality:null;
            if(aq&&aq.current){
              localStorage.setItem('ec_dust_source','openmeteo');
              _setHeaderDust(Math.round(aq.current.pm10||0),Math.round(aq.current.pm2_5||0));
            }
          }).catch(function(){});
        }
      }).catch(function(){
        window.electronAPI.weatherOpenMeteo(lat.toFixed(4),lon.toFixed(4)).then(function(r2){
          const aq=r2&&r2.success&&r2.data?r2.data.airQuality:null;
          if(aq&&aq.current){
            localStorage.setItem('ec_dust_source','openmeteo');
            _setHeaderDust(Math.round(aq.current.pm10||0),Math.round(aq.current.pm2_5||0));
          }
        }).catch(function(){});
      });
    } else {
      /* 에어코리아 키/측정소 없으면 Open-Meteo 미세먼지 폴백 */
      window.electronAPI.weatherOpenMeteo(lat.toFixed(4),lon.toFixed(4)).then(function(res){
        const aq=res&&res.success&&res.data?res.data.airQuality:null;
        if(aq&&aq.current){
          const pm10=Math.round(aq.current.pm10||0);const pm25=Math.round(aq.current.pm2_5||0);
          localStorage.setItem('ec_dust_source','openmeteo');
          _setHeaderDust(pm10,pm25);
        }
      }).catch(function(){});
    }
  }).catch(function(){_fetchWeatherOpenMeteo();});
}
function _fetchWeatherOpenMeteo(){
  _getLocation().then(function(loc){
    const lat=(loc.latitude||37.5665).toFixed(4);
    const lon=(loc.longitude||126.9780).toFixed(4);
    const region=localStorage.getItem('ec_user_region')||loc.city||'';
    _hdrCycle.region=region;
    window.electronAPI.weatherOpenMeteo(lat,lon).then(function(res){
      const d=res&&res.success&&res.data?res.data.weather:null, aq=res&&res.success&&res.data?res.data.airQuality:null;
      if(d&&d.current){
        const code=d.current.weather_code;const temp=Math.round(d.current.temperature_2m);
        const hi=d.daily?Math.round(d.daily.temperature_2m_max[0]):'';
        const lo=d.daily?Math.round(d.daily.temperature_2m_min[0]):'';
        _setHeaderWeather(wmoToEmoji(code),wmoToText(code),temp,hi,lo);
      }
      /* 미세먼지: 에어코리아 키+측정소 우선 */
      const _airKey2=getPublicDataApiKey('airkorea');
      const _airStn2=(localStorage.getItem('ec_airkorea_station')||'').trim();
      function _applyOm(){
        if(aq&&aq.current&&(aq.current.pm10!==undefined||aq.current.pm2_5!==undefined)){
          const pm10=Math.round(aq.current.pm10||0);const pm25=Math.round(aq.current.pm2_5||0);
          localStorage.setItem('ec_dust_source','openmeteo');
          _setHeaderDust(pm10,pm25);
        }
      }
      if(((_airKey2&&_airStn2)||window.__isWebBrowser)&&window.electronAPI&&window.electronAPI.externalFetchAirkorea){
        window.electronAPI.externalFetchAirkorea(_airKey2,_airStn2).then(function(r2){
          if(r2&&r2.success&&r2.data){
            localStorage.setItem('ec_dust_source','airkorea');
            _setHeaderDust(parseInt(r2.data.pm10)||0,parseInt(r2.data.pm25)||0);
          } else _applyOm();
        }).catch(_applyOm);
      } else {
        _applyOm();
      }
      localStorage.setItem('ec_weather_actual_source','openmeteo');
      _cacheHourlyData(d,aq);
    }).catch(function(){});
  }).catch(function(){});
}
/* 날씨 설정 → localStorage + S.settings.weather (settings JSON 파일로 저장) */
function _persistWeatherToSettings(){
  if(!S.settings)S.settings={};
  if(!S.settings.weather)S.settings.weather={};
  S.settings.weather.source=localStorage.getItem('ec_weather_source')||'';
  S.settings.weather.show=localStorage.getItem('ec_weather_show')||'';
  S.settings.weather.kmaApiKey=getPublicDataApiKey('kma');
  S.settings.weather.airkoreaApiKey=getPublicDataApiKey('airkorea');
  S.settings.weather.userRegion=localStorage.getItem('ec_user_region')||'';
  S.settings.weather.airkoreaStation=localStorage.getItem('ec_airkorea_station')||'';
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
    window.electronAPI.jsonSaveCommon('settings',S.settings).catch(function(){});
  }
}
/* 외부 모듈(settings-view)에서 호출 가능하도록 전역 노출 */
window.persistWeatherToSettings=_persistWeatherToSettings;
/* 앱 시작 시 localStorage에 없으면 settings.weather JSON에서 복구
 * (settings 로드 완료 시점 이후에 실행되도록 약간 지연) */
setTimeout(function(){
  if(!S.settings||!S.settings.weather)return;
  const w=S.settings.weather;
  const map={
    'ec_weather_source':w.source,
    'ec_weather_show':w.show,
    'ec_kma_api_key':w.kmaApiKey,
    'ec_airkorea_api_key':w.airkoreaApiKey,
    'ec_user_region':w.userRegion,
    'ec_airkorea_station':w.airkoreaStation
  };
  Object.keys(map).forEach(function(k){
    /* 공통 키 등록/삭제 뒤에는 예전 settings.json 키를 되살리지 않는다. */
    if((k==='ec_kma_api_key'||k==='ec_airkorea_api_key')&&hasPublicDataApiKeySetting())return;
    if(localStorage.getItem(k))return;/* 이미 있으면 유지 */
    const v=map[k];
    if(v!=null&&v!==''){
      localStorage.setItem(k,String(v));
      if(k==='ec_weather_source')console.log('[WEATHER] restored source from settings.json: '+v);
    }
  });
},1500);
// fetchWeather는 로그인 후 hideSplash()에서 호출

/* S._hdrRendering → S 객체 사용 */

/* ── 시간별 예보 캐시 ── */
let _hourlyCache=null; /* {temps:[], codes:[], pm10:[], pm25:[], times:[]} */

function _cacheHourlyData(weatherData,airData){
  if(!weatherData||!weatherData.hourly)return;
  const h=weatherData.hourly;
  const now=new Date();
  const curHour=now.getHours();
  _hourlyCache={temps:[],codes:[],pm10:[],pm25:[],times:[]};
  for(let i=curHour;i<Math.min(curHour+8,24);i++){
    _hourlyCache.temps.push(Math.round(h.temperature_2m[i]));
    _hourlyCache.codes.push(h.weather_code[i]);
    _hourlyCache.times.push(i===curHour?'지금':i+'시');
  }
  if(airData&&airData.hourly){
    for(let i=curHour;i<Math.min(curHour+8,24);i++){
      _hourlyCache.pm10.push(Math.round(airData.hourly.pm10[i]||0));
      _hourlyCache.pm25.push(Math.round(airData.hourly.pm2_5[i]||0));
    }
  }
}

/* ── 우측 상단 클릭 → A형 날씨 카드 팝업 ── */
function _openWeatherCardPopup(){
  const existing=document.getElementById('weatherCardPopup');if(existing)existing.remove();
  const isLight=document.body.classList.contains('light');

  /* 오버레이 생성 */
  const ov=document.createElement('div');ov.id='weatherCardPopup';
  ov.style.cssText='position:fixed;inset:0;z-index:10500;display:flex;justify-content:flex-end;align-items:flex-start;padding:56px 16px 20px;background:rgba(0,0,0,'+(isLight?'0.15':'0.35')+')';
  ov.innerHTML='<div id="weatherCardInner" style="width:440px;max-width:92vw;border-radius:20px;overflow:hidden;'
    +(isLight
      ?'background:rgba(255,255,255,0.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(0,0,0,0.1);box-shadow:0 8px 32px rgba(0,0,0,0.12);color:#1e293b;'
      :'background:rgba(30,41,59,0.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,0.4);color:#e2e8f0;')
    +'transform:translateY(-20px);opacity:0;transition:transform 0.35s ease,opacity 0.35s ease">'
    +'<div style="padding:40px;text-align:center;font-size:12px;color:'+(isLight?'#64748b':'#94a3b8')+'">날씨 데이터를 불러오는 중...</div></div>';
  ov.addEventListener('click',function(e){
    if(e.target.closest('[data-weather-refresh]')){
      e.stopPropagation();
      /* 캐시 초기화 → fetchWeather 재호출 → 렌더 갱신 */
      _hourlyCache=null;
      try{fetchWeather();}catch(_){}
      setTimeout(function(){_renderWeatherCard();},1200);
      return;
    }
    if(e.target===ov){_closeWeatherCard(ov);}
  });
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    const inner=document.getElementById('weatherCardInner');
    if(inner){inner.style.transform='translateY(0)';inner.style.opacity='1';}
  });

  /* 데이터가 없으면 즉시 fetch */
  if(!_hourlyCache){
    _getLocation().then(function(loc){
      const lat=(loc.latitude||37.5665).toFixed(4), lon=(loc.longitude||126.9780).toFixed(4);
      window.electronAPI.weatherOpenMeteo(lat,lon).then(function(res){
        const d=res&&res.success&&res.data?res.data.weather:null, aq=res&&res.success&&res.data?res.data.airQuality:null;
        if(d&&d.current){
          const code=d.current.weather_code, temp=Math.round(d.current.temperature_2m);
          const hi=d.daily?Math.round(d.daily.temperature_2m_max[0]):'', lo=d.daily?Math.round(d.daily.temperature_2m_min[0]):'';
          _setHeaderWeather(wmoToEmoji(code),wmoToText(code),temp,hi,lo);
          _setHeaderUv(_extractUv(d));
        }
        if(aq&&aq.current){_setHeaderDust(Math.round(aq.current.pm10||0),Math.round(aq.current.pm2_5||0));}
        _cacheHourlyData(d,aq);
        _renderWeatherCard();
      });
    });
  } else {
    _renderWeatherCard();
  }
}

function _renderWeatherCard(){
  const inner=document.getElementById('weatherCardInner');if(!inner)return;
  const c=_hdrCycle;
  const isLight=document.body.classList.contains('light');
  const region=localStorage.getItem('ec_user_region')||localStorage.getItem('ec_weatherRegion')||c.region||'';
  const t1=isLight?'#1e293b':'#f1f5f9';
  const t2=isLight?'#475569':'#cbd5e1';
  const t3=isLight?'#94a3b8':'#64748b';
  const cardBg=isLight?'rgba(0,0,0,0.03)':'rgba(255,255,255,0.05)';
  const cardBdr=isLight?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.08)';
  const secBdr=isLight?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.08)';
  const _dc=function(g){return g==='좋음'?'#16a34a':g==='보통'?'#2563eb':g==='나쁨'?'#d97706':'#dc2626';};
  const _de=function(g){return g==='좋음'?'😊':g==='보통'?'😐':g==='나쁨'?'😷':'🤢';};

  /* ── 데이터 출처 판별 (실제 데이터가 어디서 왔는지 기준) ── */
  const _wActual=localStorage.getItem('ec_weather_actual_source')||'';
  const _dActual=localStorage.getItem('ec_dust_source')||'';
  const _wSrc=localStorage.getItem('ec_weather_source')||'openmeteo';
  const _kmaKey=getPublicDataApiKey('kma');
  const _airKey=getPublicDataApiKey('airkorea');
  const _airStn=(localStorage.getItem('ec_airkorea_station')||'').trim();
  const _wSrcLabel=_wActual==='kma'?'기상청':_wActual==='openmeteo'?'OPEN METEO':((_wSrc==='kma'&&_kmaKey)?'기상청':'OPEN METEO');
  const _dSrcLabel=_dActual==='airkorea'?'에어코리아':_dActual==='openmeteo'?'OPEN METEO':((_airKey&&_airStn)?'에어코리아':'OPEN METEO');
  const _badgeCss='display:inline-block;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;letter-spacing:0.3px;background:'+(isLight?'rgba(14,165,233,0.12)':'rgba(56,189,248,0.18)')+';color:'+(isLight?'#0369a1':'#7dd3fc')+';border:1px solid '+(isLight?'rgba(14,165,233,0.25)':'rgba(56,189,248,0.3)');

  let h='';
  /* ── 헤더: 현재 날씨 ── */
  h+='<div style="padding:20px 24px 16px;display:flex;align-items:center;gap:16px;border-bottom:1px solid '+secBdr+'">';
  h+='<div style="font-size:48px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.15))">'+(c.weatherEmoji||'☀️')+'</div>';
  h+='<div style="flex:1"><div style="font-size:36px;font-weight:800;color:'+t1+'">'+(c.temp!==''?c.temp+'°C':'--')+'</div>';
  h+='<div style="font-size:12px;color:'+t2+';margin-top:2px">'+(c.weatherText||'')+'</div>';
  if(c.tempHi||c.tempLo){
    h+='<div style="font-size:11px;margin-top:4px;color:'+t3+'">';
    if(c.tempHi)h+='<span style="color:#ea580c;font-weight:700">↑ '+c.tempHi+'°C</span>';
    if(c.tempHi&&c.tempLo)h+=' · ';
    if(c.tempLo)h+='<span style="color:#2563eb;font-weight:700">↓ '+c.tempLo+'°C</span>';
    h+='</div>';
  }
  h+='</div>';
  h+='<div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px">';
  h+='<div style="font-size:11px;color:'+t3+'">📍 '+escHtml(region||'--')+'</div>';
  h+='<span style="'+_badgeCss+'" title="기온·날씨 데이터 출처">'+escHtml(_wSrcLabel)+'</span>';
  h+='</div></div>';

  /* ── 시간별 예보 ── */
  if(_hourlyCache&&_hourlyCache.temps.length){
    h+='<div style="padding:12px 14px;display:flex;justify-content:space-between;border-bottom:1px solid '+secBdr+';overflow-x:auto;gap:2px">';
    _hourlyCache.temps.forEach(function(t,i){
      var isNow=i===0;
      h+='<div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:44px;padding:6px 3px;border-radius:10px;'
        +(isNow?'background:'+cardBg+';border:1px solid '+cardBdr:'')+';">';
      h+='<span style="font-size:9px;color:'+t3+'">'+_hourlyCache.times[i]+'</span>';
      h+='<span style="font-size:17px">'+wmoToEmoji(_hourlyCache.codes[i])+'</span>';
      h+='<span style="font-size:11px;font-weight:700;color:'+t1+'">'+t+'°</span>';
      h+='</div>';
    });
    h+='</div>';
  }

  /* ── 듀얼 그래프 ── */
  if(_hourlyCache&&_hourlyCache.temps.length>1){
    var temps=_hourlyCache.temps, pm10s=_hourlyCache.pm10||[], pm25s=_hourlyCache.pm25||[];
    var n=temps.length;
    var tMin=Math.min.apply(null,temps)-2, tMax=Math.max.apply(null,temps)+2;
    var pAll=pm10s.concat(pm25s);
    var pMax=Math.max.apply(null,[80].concat(pAll));
    function _ty(v){return 10+(1-(v-tMin)/(tMax-tMin||1))*60;}
    function _py(v){return 10+(1-v/(pMax||1))*60;}
    var w=380, step=w/(n-1);
    var tPts='', pm10Pts='', pm25Pts='', tArea='M0,'+_ty(temps[0]);
    for(var i=0;i<n;i++){
      var x=Math.round(i*step);
      tPts+=x+','+Math.round(_ty(temps[i]))+' ';
      tArea+=' L'+x+','+Math.round(_ty(temps[i]));
      if(pm10s[i]!==undefined)pm10Pts+=x+','+Math.round(_py(pm10s[i]))+' ';
      if(pm25s[i]!==undefined)pm25Pts+=x+','+Math.round(_py(pm25s[i]))+' ';
    }
    tArea+=' L'+w+',80 L0,80Z';

    h+='<div style="padding:12px 20px 10px;border-bottom:1px solid '+secBdr+'">';
    h+='<div style="display:flex;gap:14px;margin-bottom:6px">';
    h+='<span style="font-size:10px;display:flex;align-items:center;gap:4px;color:'+t3+'"><span style="width:8px;height:3px;border-radius:2px;background:#f59e0b"></span>기온</span>';
    if(pm10Pts)h+='<span style="font-size:10px;display:flex;align-items:center;gap:4px;color:'+t3+'"><span style="width:8px;height:3px;border-radius:2px;background:#8b5cf6"></span>PM10</span>';
    if(pm25Pts)h+='<span style="font-size:10px;display:flex;align-items:center;gap:4px;color:'+t3+'"><span style="width:8px;height:3px;border-radius:2px;background:#06b6d4"></span>PM2.5</span>';
    h+='</div>';
    h+='<svg viewBox="0 0 '+w+' 80" style="width:100%;height:80px">';
    h+='<defs><linearGradient id="wc-tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f59e0b" stop-opacity="0.2"/><stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/></linearGradient></defs>';
    h+='<path d="'+tArea+'" fill="url(#wc-tg)"/>';
    h+='<polyline points="'+tPts.trim()+'" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    if(pm10Pts)h+='<polyline points="'+pm10Pts.trim()+'" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="5,3" stroke-linecap="round"/>';
    if(pm25Pts)h+='<polyline points="'+pm25Pts.trim()+'" fill="none" stroke="#06b6d4" stroke-width="1.5" stroke-dasharray="5,3" stroke-linecap="round"/>';
    var maxT=Math.max.apply(null,temps), maxI=temps.indexOf(maxT);
    h+='<circle cx="'+Math.round(maxI*step)+'" cy="'+Math.round(_ty(maxT))+'" r="4" fill="#f59e0b" stroke="'+(isLight?'#fff':'rgba(255,255,255,0.5)')+'" stroke-width="1.5"/>';
    h+='<text x="'+Math.round(maxI*step-6)+'" y="'+Math.round(_ty(maxT)-7)+'" font-size="10" fill="#f59e0b" font-weight="bold" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke">'+maxT+'°</text>';
    h+='</svg>';
    /* 시간 라벨 */
    if(_hourlyCache.times.length>1){
      h+='<div style="display:flex;justify-content:space-between;margin-top:2px;padding:0 2px">';
      _hourlyCache.times.forEach(function(t){h+='<span style="font-size:8px;color:'+t3+'">'+t+'</span>';});
      h+='</div>';
    }
    h+='</div>';
  }

  /* ── 폭염·한파·자외선 ── */
  {
    const uv=c.uvIndex, uvG=c.uvGrade||_uvGrade(uv);
    const hasUv=(uv!==''&&uv!=null&&!isNaN(parseFloat(uv)));
    if(c.heatAlert||c.coldAlert||hasUv){
      h+='<div style="padding:10px 20px 4px"><span style="font-size:10px;font-weight:700;color:'+t2+'">폭염·한파·자외선</span></div>';
      h+='<div style="padding:4px 20px 16px;display:flex;gap:10px;flex-wrap:wrap">';
      /* 폭염/한파 특보 카드 (있을 때만) */
      if(c.heatAlert){
        h+='<div style="flex:1;min-width:110px;padding:12px;border-radius:14px;background:'+cardBg+';border:1px solid rgba(248,113,113,0.35);text-align:center">'
          +'<div style="font-size:22px;margin-bottom:2px">🔥</div>'
          +'<div style="font-size:9px;color:'+t3+';margin-bottom:4px">폭염</div>'
          +'<div style="font-size:14px;font-weight:800;color:#ef4444">'+escHtml(c.heatAlert)+'</div></div>';
      }
      if(c.coldAlert){
        h+='<div style="flex:1;min-width:110px;padding:12px;border-radius:14px;background:'+cardBg+';border:1px solid rgba(96,165,250,0.35);text-align:center">'
          +'<div style="font-size:22px;margin-bottom:2px">🥶</div>'
          +'<div style="font-size:9px;color:'+t3+';margin-bottom:4px">한파</div>'
          +'<div style="font-size:14px;font-weight:800;color:#3b82f6">'+escHtml(c.coldAlert)+'</div></div>';
      }
      /* 자외선지수 카드 */
      if(hasUv){
        h+='<div style="flex:1;min-width:110px;padding:12px;border-radius:14px;background:'+cardBg+';border:1px solid '+cardBdr+';text-align:center">'
          +'<div style="font-size:22px;margin-bottom:2px">🌞</div>'
          +'<div style="font-size:9px;color:'+t3+';margin-bottom:4px">자외선지수</div>'
          +'<div style="font-size:22px;font-weight:800;color:'+_uvColor(uvG)+'">'+escHtml(String(uv))+'</div>'
          +'<div style="font-size:11px;font-weight:700;color:'+_uvColor(uvG)+';margin-top:2px">'+escHtml(uvG||'--')+'</div></div>';
      }
      /* 특보가 하나도 없을 때 안내 (자외선만 있는 경우) */
      if(!c.heatAlert&&!c.coldAlert){
        h+='<div style="flex:1;min-width:110px;padding:12px;border-radius:14px;background:'+cardBg+';border:1px solid '+cardBdr+';text-align:center">'
          +'<div style="font-size:22px;margin-bottom:2px">✅</div>'
          +'<div style="font-size:9px;color:'+t3+';margin-bottom:4px">폭염·한파</div>'
          +'<div style="font-size:13px;font-weight:700;color:#22c55e">특보 없음</div></div>';
      }
      h+='</div>';
    }
  }

  /* ── 미세먼지 현재값 ── */
  var g10=c.dustG10||'--', g25=c.dustG25||'--';
  /* 사용자가 에어코리아 키를 입력했음에도 실제 사용 중이 아니면 힌트 문구 노출 */
  var _airHint='';
  if(_airKey&&_dActual!=='airkorea'){
    if(!_airStn)_airHint='측정소명을 입력해야 에어코리아가 활성화됩니다';
    else _airHint='측정소명 "'+_airStn+'"을(를) 확인해 주세요';
  }
  h+='<div style="padding:10px 20px 4px;display:flex;justify-content:space-between;align-items:center;gap:8px">';
  h+='<span style="font-size:10px;font-weight:700;color:'+t2+'">미세먼지</span>';
  h+='<span style="display:flex;gap:6px;align-items:center">';
  if(_airHint)h+='<span style="font-size:9px;color:#dc2626" title="'+escHtml(_airHint)+'">⚠</span>';
  h+='<span data-weather-refresh="1" style="cursor:pointer;font-size:10px;color:'+t3+';padding:2px 6px;border:1px solid '+cardBdr+';border-radius:6px;user-select:none" title="날씨/미세먼지 다시 불러오기">↻ 새로고침</span>';
  h+='<span style="'+_badgeCss+'" title="미세먼지 데이터 출처">'+escHtml(_dSrcLabel)+'</span>';
  h+='</span></div>';
  if(_airHint){
    h+='<div style="padding:0 20px 4px;font-size:9px;color:#dc2626;text-align:right">⚠ '+escHtml(_airHint)+'</div>';
  }
  h+='<div style="padding:4px 20px 16px;display:flex;gap:10px">';
  h+='<div style="flex:1;padding:12px;border-radius:14px;background:'+cardBg+';border:1px solid '+cardBdr+';text-align:center">';
  h+='<div style="font-size:22px;margin-bottom:2px">'+_de(g10)+'</div>';
  h+='<div style="font-size:9px;color:'+t3+';margin-bottom:4px">PM10 미세먼지</div>';
  h+='<div style="font-size:22px;font-weight:800;color:#8b5cf6">'+(c.dustPm10||0)+'</div>';
  h+='<div style="font-size:9px;color:'+t3+'">μg/m³</div>';
  h+='<div style="font-size:11px;font-weight:700;color:'+_dc(g10)+';margin-top:2px">'+g10+'</div>';
  h+='</div>';
  h+='<div style="flex:1;padding:12px;border-radius:14px;background:'+cardBg+';border:1px solid '+cardBdr+';text-align:center">';
  h+='<div style="font-size:22px;margin-bottom:2px">'+_de(g25)+'</div>';
  h+='<div style="font-size:9px;color:'+t3+';margin-bottom:4px">PM2.5 초미세먼지</div>';
  h+='<div style="font-size:22px;font-weight:800;color:#06b6d4">'+(c.dustPm25||0)+'</div>';
  h+='<div style="font-size:9px;color:'+t3+'">μg/m³</div>';
  h+='<div style="font-size:11px;font-weight:700;color:'+_dc(g25)+';margin-top:2px">'+g25+'</div>';
  h+='</div></div>';

  inner.innerHTML=h;
}

function _closeWeatherCard(ov){
  const inner=document.getElementById('weatherCardInner');
  if(inner){inner.style.transform='translateY(-20px)';inner.style.opacity='0';}
  ov.style.transition='opacity 0.3s';ov.style.opacity='0';
  setTimeout(function(){ov.remove();},350);
}

/* header-meta 클릭 이벤트 등록 */
function _bindHeaderMetaClick(){
  const targets=[document.getElementById('headerUserInfo'),document.getElementById('headerDate'),document.getElementById('headerWeather')];
  let bound=false;
  targets.forEach(function(el){
    if(!el)return;
    el.style.cursor='pointer';
    el.addEventListener('click',function(e){
      e.stopPropagation();
      _openWeatherCardPopup();
    });
    bound=true;
  });
  if(!bound)setTimeout(_bindHeaderMetaClick,500);
}
_bindHeaderMetaClick();

/* ── 튜토리얼 데이터 접근 ── */
/* banner.json 의 tutorials 슬롯 제거됨 (2026-05-27). 호출 측 호환을 위해 빈 배열만 반환. */
export function getBannerTutorials(){ return []; }

