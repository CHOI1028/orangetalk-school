/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { appData } from '../../core/app-data-bridge.js';

/* ═══════════════════════════════════════
   THEME MANAGER
   ═══════════════════════════════════════ */

/* glass styles */
const _glassStyles={
  none:{bg:'transparent',blur:0,border:'transparent'},
  frost:{bg:'rgba(255,255,255,0.08)',blur:12,border:'rgba(255,255,255,0.12)'},
  sunset:{bg:'rgba(251,146,60,0.06)',blur:10,border:'rgba(251,146,60,0.15)'},
  ocean:{bg:'rgba(6,182,212,0.06)',blur:10,border:'rgba(6,182,212,0.12)'},
  aurora:{bg:'rgba(139,92,246,0.06)',blur:10,border:'rgba(139,92,246,0.12)'},
  smoke:{bg:'rgba(30,30,30,0.35)',blur:14,border:'rgba(255,255,255,0.06)'},
  rose:{bg:'rgba(244,63,94,0.05)',blur:10,border:'rgba(244,63,94,0.12)'},
  mint:{bg:'rgba(52,211,153,0.05)',blur:10,border:'rgba(52,211,153,0.12)'},
  lavender:{bg:'rgba(167,139,250,0.06)',blur:10,border:'rgba(167,139,250,0.12)'},
  amber:{bg:'rgba(245,158,11,0.06)',blur:10,border:'rgba(245,158,11,0.12)'},
  slate:{bg:'rgba(100,116,139,0.08)',blur:12,border:'rgba(100,116,139,0.12)'},
  ruby:{bg:'rgba(220,38,38,0.05)',blur:10,border:'rgba(220,38,38,0.12)'},
  emerald:{bg:'rgba(16,185,129,0.05)',blur:10,border:'rgba(16,185,129,0.12)'}
};

function _applyGlassToEl(el,key){
  if(!el)return;
  const s=_glassStyles[key]||_glassStyles.none;
  el.style.background=s.bg;
  el.style.backdropFilter=s.blur?'blur('+s.blur+'px)':'none';
  el.style.webkitBackdropFilter=s.blur?'blur('+s.blur+'px)':'none';
  el.style.borderColor=s.border;
}
export function setFooterGlass(key){localStorage.setItem('ec_glass_footer',key);applyFooterGlass();}
export function applyFooterGlass(){
  const ft=document.querySelector('footer');
  if(!ft)return;
  /* 단색 모드여도 사용자가 선택한 글래스 색조 + 블러는 그대로 적용 (단색 위에서도 색조 띠가 보이도록).
   * 헤더/푸터 영역 자체의 가시성은 CSS 의 body[data-bg-mode="solid"] 분기와 텍스트 외곽선으로 분리. */
  const key=localStorage.getItem('ec_glass_footer')||'sunset';_applyGlassToEl(ft,key);
  /* 글래스가 바뀌면 footer 글씨 가독성도 재평가 — 라이트 단색 + 비 smoke 같은 조합에서 흰 글씨 보정. */
  setTimeout(_autoFooterColor,50);
}
export function setHeaderGlass(key){localStorage.setItem('ec_glass_header',key);applyHeaderGlass();}
export function applyHeaderGlass(){
  const hd=document.querySelector('.top-header');
  if(!hd)return;
  const key=localStorage.getItem('ec_glass_header')||'frost';_applyGlassToEl(hd,key);_autoHeaderTextColor();
}
export function _autoHeaderTextColor(){
  const dateEl=document.querySelector('.header-date');
  const infoEl=document.getElementById('headerUserInfo');
  /* 좌측 회전문구(cyclingBrand)도 동일 가독성 규칙 적용 — 라이트 단색 + 흰 글씨 안 보임 보고 대응 */
  const brandEl=document.getElementById('cyclingBrand');
  if(!dateEl&&!infoEl&&!brandEl)return;
  const isLight=document.body.classList.contains('light');
  const bgMode=localStorage.getItem('ec_bg_mode')||'';
  const isSolid=bgMode==='solid';
  const key=localStorage.getItem('ec_glass_header')||'frost';
  const darkGlass=key==='smoke';
  /* 가독성 규칙:
   *  - smoke (어두운 글래스)         → 흰 글씨 + 어두운 그림자 = 항상 또렷
   *  - 단색 라이트 + 비 smoke 글래스 → 글래스가 거의 투명이라 단색 흰 배경이 그대로 보임 → 검정 글씨
   *  - 이미지/그라데이션 배경        → 기존대로 흰 글씨 + 어두운 그림자 (canvas 샘플링 결과는 footer 만 사용)
   *  - 라이트 모드 + 단색이 아닌 경우 → 흰 글씨 유지 (이미지가 보통 어두운 톤이므로). */
  let color='#fff', shadow='0 1px 2px rgba(0,0,0,0.6),0 0 4px rgba(0,0,0,0.3)';
  if(isSolid && isLight && !darkGlass){
    /* 라이트 단색 + 글래스가 어둡지 않음 → 검정 글씨 + 흰 그림자 */
    color='#1f2937';
    shadow='0 1px 2px rgba(255,255,255,0.7),0 0 3px rgba(255,255,255,0.5)';
  }
  if(dateEl){dateEl.style.color=color;dateEl.style.textShadow=shadow;dateEl.style.transition='color 0.2s ease, text-shadow 0.2s ease';}
  if(infoEl){infoEl.style.color=color;infoEl.style.textShadow=shadow;infoEl.style.transition='color 0.2s ease, text-shadow 0.2s ease';}
  /* 좌측 회전문구는 슬롯별 사용자 지정 색이 있으므로 color 직접 덮어쓰지 않고,
   * 안 보이는 환경에서는 그림자만 강화해서 가독성 보조. 단, 흰 글씨에 가까운 슬롯은 위 규칙으로 분기. */
  if(brandEl){
    brandEl.style.textShadow=shadow;
    brandEl.style.transition='text-shadow 0.2s ease';
    /* 회전문구의 현재 색이 흰색계열이라면 라이트 단색에서는 검정으로 덮어쓰기 — 슬롯 색 우선이지만
     * 흰 글씨 → 흰 배경 충돌만 보정. */
    if(isSolid && isLight && !darkGlass){
      const cur=(brandEl.style.color||'').replace(/\s/g,'').toLowerCase();
      if(!cur || cur==='#fff' || cur==='#ffffff' || cur==='white' || cur==='rgb(255,255,255)'){
        brandEl.style.color='#1f2937';
      }
    }
  }
}
setTimeout(function(){applyHeaderGlass();applyFooterGlass();},100);
/* body class 변경 감지 — light 상태 변화에만 반응하도록 분기.
 * 이전엔 어떤 class 변경(kb-nav, scroll-active 등 포함)이든 발화하여 _autoHeaderTextColor 가
 * 매번 호출되었고 transition:all 0.4s 와 결합되어 "클릭할 때마다 헤더 색 변화" 처럼 보이는 회귀 발생. */
(function(){
  let _wasLight=document.body.classList.contains('light');
  new MutationObserver(function(){
    const isL=document.body.classList.contains('light');
    if(isL===_wasLight)return;
    _wasLight=isL;
    setTimeout(_autoHeaderTextColor,100);
    if((localStorage.getItem('ec_bg_mode')||'')==='solid'){
      import('../settings/settings-bg-theme.js').then(function(m){
        try { if(m && typeof m.applyBackground==='function') m.applyBackground(); } catch(_){}
      }).catch(function(){});
    }
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
})();

/* footer 글씨 색 자동 조정 (canvas sampling + 단색/라이트 보정).
 * lum 0~1 — 0 이면 매우 어두움, 1 이면 매우 밝음. 0.55 이상이면 검정 글씨가 가독성 우수. */
function _setFooterContrast(lum){
  const ft=document.querySelector('footer');if(!ft)return;
  const bgMode=localStorage.getItem('ec_bg_mode')||'';
  const isSolid=bgMode==='solid';
  const isLight=document.body.classList.contains('light');
  const fkey=localStorage.getItem('ec_glass_footer')||'sunset';
  const darkGlass=fkey==='smoke';
  /* 단색 라이트 + 비 smoke 글래스 → 검정 글씨. lum 높은 이미지도 같은 분기.
   * 그 외 (이미지/그라데이션 어둠 톤, 단색 다크, smoke 등) → 흰 글씨 */
  const useDark=(isSolid && isLight && !darkGlass) || (!isSolid && lum>0.55);
  if(useDark){
    ft.style.color='#1f2937';
    ft.style.textShadow='0 1px 2px rgba(255,255,255,0.7),0 0 3px rgba(255,255,255,0.5)';
  } else {
    ft.style.color='#fff';
    ft.style.textShadow='0 1px 2px rgba(0,0,0,0.6),0 0 4px rgba(0,0,0,0.3)';
  }
}
function _autoFooterColor(){
  const ft=document.querySelector('footer');if(!ft)return;
  try{
    const bgImg=getComputedStyle(document.body).backgroundImage;
    if(bgImg&&bgImg!=='none'){
      const img=new Image();img.crossOrigin='anonymous';
      const m=bgImg.match(/url\(["']?([^"')]+)["']?\)/);
      if(m){
        img.onload=function(){
          try{
            const c=document.createElement('canvas');c.width=1;c.height=1;
            const ctx=c.getContext('2d');
            ctx.drawImage(img,0,img.height*0.9,img.width,img.height*0.1,0,0,1,1);
            const d=ctx.getImageData(0,0,1,1).data;
            const lum=(0.299*d[0]+0.587*d[1]+0.114*d[2])/255;
            _setFooterContrast(lum);
          }catch(e){_setFooterContrast(0.2);}
        };
        img.onerror=function(){_setFooterContrast(0.2);};
        img.src=m[1];
        return;
      }
    }
    const bodyBg=getComputedStyle(document.body).backgroundColor;const mb=bodyBg.match(/[\d.]+/g)||[30,30,30];const lum=(0.299*(+mb[0])+0.587*(+mb[1])+0.114*(+mb[2]))/255;
    _setFooterContrast(lum);
  }catch(e){_setFooterContrast(0.2);}
}
setTimeout(_autoFooterColor,500);
/* footer 색도 light 변화에만 재평가. 기타 body class 토글(kb-nav 등) 에는 발화 안 함. */
(function(){
  let _wasLight=document.body.classList.contains('light');
  new MutationObserver(function(){
    const isL=document.body.classList.contains('light');
    if(isL===_wasLight)return;
    _wasLight=isL;
    setTimeout(_autoFooterColor,200);
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
})();

/* ── 글자 크기 조절 ── */
function applyFontScale(val){
  let n=parseInt(val);if(isNaN(n))n=115;
  /* 허용 범위 제한: 100~130% */
  if(n<100)n=100;if(n>130)n=130;
  localStorage.setItem('ec_fontScale',String(n));
  const fs=n/100;
  const fsModal=Math.min(1.10,fs);  /* 모달·팝업 상한 110% */
  document.documentElement.style.setProperty('--fs',fs);
  document.documentElement.style.setProperty('--fs-modal',fsModal);
  const prev=document.getElementById('fontScalePreview');
  if(prev)prev.style.fontSize=(12*fs).toFixed(1)+'px';
  const lbl=document.getElementById('fontScaleLabel');
  if(lbl)lbl.textContent=n+'%';
  /* DB 동기화 (persistence-orchestrator가 부팅 시 덮어쓰는 문제 방지) */
  try{
    if(appData&&appData.canUseBackend&&appData.canUseBackend()){
      appData.saveCommon('font_scale',String(n),{legacyJsonKey:'font_scale'});
    }else if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
      window.electronAPI.jsonSaveCommon('font_scale',String(n));
    }
  }catch(e){}
}
/* 글자 크기 100% 고정 */
localStorage.setItem('ec_fontScale','100');
document.documentElement.style.setProperty('--fs',1);
document.documentElement.style.setProperty('--fs-modal',1);

export function toggleTheme(){
  document.body.classList.add('theme-transitioning');
  const isLight=document.body.classList.toggle('light');
  document.getElementById('themeBtn').innerHTML=isLight?'🌙 다크모드':'☀️ 라이트모드';
  const val=isLight?'light':'dark';
  localStorage.setItem('ec_theme',val);
  /* DB에도 동기화 (persistence-orchestrator가 DB→localStorage 덮어쓰기 하는 경주 조건 방지) */
  try{
    if(appData&&appData.canUseBackend&&appData.canUseBackend()){
      appData.saveCommon('theme',val,{legacyJsonKey:'theme'});
    }else if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
      window.electronAPI.jsonSaveCommon('theme',val);
    }
  }catch(e){}
  if(typeof SE!=='undefined'&&SE.render)SE.render();
  setTimeout(function(){document.body.classList.remove('theme-transitioning');},350);
}
const _themeBtn=document.getElementById('themeBtn');
if(_themeBtn){_themeBtn.innerHTML=document.body.classList.contains('light')?'🌙 다크모드':'☀️ 라이트모드';}

export { applyFontScale };

/* ── 사이드바 위치 (기본=왼쪽 / 오른쪽 / 끄기) — body 클래스 전환. 2026-06-12 ──
   ec_sidebar_position: 'left'(기본) | 'right' | 'off'. 부팅 시 즉시 적용 + 설정 변경 시 호출.
   모달/드래그 예외는 .sidebar 클래스 기반이라 위치와 무관하게 그대로 작동(조정 불필요). */
export function applySidebarPosition(){
  try{
    const pos = localStorage.getItem('ec_sidebar_position') || 'left';
    const b = document.body;
    b.classList.remove('sidebar-right','sidebar-off');
    if(pos==='right') b.classList.add('sidebar-right');
    else if(pos==='off') b.classList.add('sidebar-off');
    /* 키오스크 수신 패널 — 사이드바 오른쪽이면 왼쪽으로(겹침 방지). 패널이 이미 떠 있으면 즉시 재배치. */
    const kp = document.getElementById('kioskReceptionPanel');
    if(kp){
      if(pos==='right'){ kp.style.left='16px'; kp.style.right='auto'; }
      else { kp.style.right='16px'; kp.style.left='auto'; }
    }
  }catch(_){}
}
applySidebarPosition();

