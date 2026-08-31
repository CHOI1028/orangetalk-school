/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { _closeDateVisitors, _hideVisitHistory, _dailyResetEntryOverlay } from '../daily/daily-view.js';
import { adjustPanelHeights } from '../emergency/emergency-view.js';
import { bus } from '../../core/event-bus.js';
import { renderHomeDashboard } from '../dashboard/home-dashboard.js';
import { floatingPostitOnViewChange } from '../dashboard/floating-postit.js';
import { S } from '../../core/app-state.js';
import { renderStats } from '../stats/stats-view.js';
import { _magicApplyBounce, _magicSwitchSub } from '../planner/planner-view.js';
import { kioskUpdateSidebar, kioskRenderHome } from '../kiosk/kiosk-view.js';
import { svSwitchSub } from '../survey/survey-view.js';
import { trSwitchSub } from '../training/training-view.js';

/* ═══════════════════════════════════════
   VIEW ROUTER — switchView, sidebar, story, weather picker
   ═══════════════════════════════════════ */
let _svInitialized=false;

export function switchView(view, btn){
  /* 매직 스테이션은 베타 단계에서 미공개 — 진입 차단 + 토스트만 표시.
     내부 개발/테스트 우회: DevTools 콘솔에서
       localStorage.setItem('ec_magic_unlock','1')   ← 잠금 해제
       localStorage.removeItem('ec_magic_unlock')    ← 다시 잠금
     (main 브랜치 = 잠금 유지. magic-station-open 병합 시 이 게이트가 열린 버전으로
      덮이지 않도록 주의 — 정식 빌드는 반드시 이 잠금 상태로. 2026-08-25) */
  if (view === 'magic' && localStorage.getItem('ec_magic_unlock') !== '1') {
    bus.emit('toast:show', { text: '매직 스테이션은 준비 중입니다.', kind: 'info' });
    return;
  }
  S.currentView = view;
  try{ floatingPostitOnViewChange(view); }catch(_){}
  /* fade-in 은 매 전환마다 재생되어야 하므로 모든 view 에서 사전 제거 후 active 갱신.
     같은 프레임에 add 하면 브라우저가 애니메이션 재트리거를 건너뛰므로
     reflow 강제 + rAF 로 다음 프레임에 add 하여 확실히 재생한다. */
  document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active');v.classList.remove('fade-in');});
  const el = document.getElementById('view-'+view);
  if(el){
    el.classList.add('active');
    /* 강제 reflow — 브라우저가 display:block 과 animation 재시작을 확실히 인식 */
    void el.offsetWidth;
    requestAnimationFrame(function(){ el.classList.add('fade-in'); });
  }
  document.querySelectorAll('.nav-link').forEach(function(l){l.classList.remove('active');});
  if(btn) btn.classList.add('active');
  else { const nb=document.querySelector('.nav-link[data-view="'+view+'"]'); if(nb) nb.classList.add('active'); }
  if(view==='home'&&typeof renderHomeDashboard==='function')renderHomeDashboard();
  if(view==='dashboard'){_closeDateVisitors();bus.emit('render:dashboard');}
  if(view==='daily'){ if(typeof _dailyResetEntryOverlay==='function')_dailyResetEntryOverlay(); bus.emit('render:daily'); _focusDailyCatSearch(); }
  if(view==='stats') renderStats();
  /* 오렌지팜 진입 시 버튼 위치는 view-orange.html 의 CSS(right:1%, top:30%) 에 맡김 */
  /* 플래너 제거 후 매직 스테이션 진입 기본 탭 = 설문. (플래너 전용 위젯 버튼은 표시하지 않음) */
  if(view==='magic'){_magicSwitchSub('survey',document.getElementById('magicSubTabSurvey'));setTimeout(function(){_magicApplyBounce();},100);}
  const _wsb2=document.getElementById('gp2WidgetStoreBtn');if(_wsb2)_wsb2.style.display='none';const _ws2=document.getElementById('gp2WidgetStore');if(_ws2)_ws2.style.display='none';const _dpb2=document.getElementById('gp2DrivePathBtn');if(_dpb2)_dpb2.style.display='none';const _dw2=document.getElementById('gp2DateWidgets');if(_dw2)_dw2.style.display='none';
  bus.emit('render:calendar');
  kioskUpdateSidebar();
  bus.emit('render:sidebar');
  setTimeout(function(){adjustPanelHeights();},100);
  const rc=document.getElementById('sideRecentCard');
  const vh=document.getElementById('sideVisitHistory');
  const smc=document.getElementById('mainCalendar');
  const ssb=document.getElementById('sidebarSearchBox');
  const ssr=document.getElementById('sideSearchResults');
  const sun=document.getElementById('sideUpdateNews');
  const ssp=document.getElementById('sideStoryPostList');

  if(rc) rc.style.display='none';
  _hideVisitHistory();
  if(smc) smc.style.display=(view==='magic')?'none':'block';
  if(ssb) ssb.style.display=(view==='magic')?'none':'block';
  if(ssr) ssr.style.display=(view==='magic')?'none':'block';
  if(sun) sun.style.display='none';
  if(ssp){
    ssp.style.display='none';
  }
  /* story 뷰 전환 시 날짜 방문자 패널 정리 */
  _closeDateVisitors();
  const sgl=document.getElementById('sideMagicLinks');
  if(sgl) sgl.style.display=(view==='magic')?'block':'none';
  const sgr=document.getElementById('sideMagicRoutine');
  if(sgr) sgr.style.display=(view==='magic')?'block':'none';
  const sgt=document.getElementById('sideMagicTodo');
  if(sgt) sgt.style.display=(view==='magic')?'block':'none';
  const sgi=document.getElementById('sideMagicImages');
  if(sgi) sgi.style.display=(view==='magic')?'block':'none';
  const app=document.querySelector('.app');
  if(app){
    const peekMode=false;
    app.classList.toggle('side-peek-mode',peekMode);
    app.classList.remove('sidebar-open');
    const h=document.getElementById('sidePeekHandle');
    if(h)h.textContent='▶';
  }
  /* 뷰별 스크롤바 색 — Firefox 는 scrollbar-color, Webkit 은 CSS 변수로 전파.
     일반일지=하늘, 매직 스테이션=녹, 소개=보라. 대시보드(방문 통계)는 주황 제거→중립 회색 (사용자 요청 2026-06-13). */
  const sbColors={daily:'#7dd3fc transparent',magic:'#86efac transparent',story:'#d8b4fe transparent'};
  const sbFill={daily:'rgba(125,211,252,0.7)',magic:'rgba(134,239,172,0.7)',story:'rgba(216,180,254,0.7)'};
  document.documentElement.style.scrollbarColor=sbColors[view]||'';
  document.body.style.setProperty('--view-scroll-color', sbFill[view] || 'rgba(148,163,184,0.55)');
  document.body.setAttribute('data-active-view', view);
  if(view==='story'){const nb=document.getElementById('storyNewBadge');if(nb)nb.style.display='none';localStorage.setItem('ec_story_seen',localStorage.getItem('ec_story_version')||'');
    /* 튜토리얼 default — 소개가 아코디언으로 이동했으므로 진입 즉시 튜토리얼 렌더 */
    import('../settings/settings-view.js').then(function(m){if(m.switchStorySub)m.switchStorySub('tutorial');}).catch(function(){});
  }
}

function showStoryNewBadge(version){
  localStorage.setItem('ec_story_version',version);
  const seen=localStorage.getItem('ec_story_seen')||'';
  if(seen!==version){const nb=document.getElementById('storyNewBadge');if(nb)nb.style.display='';}
}
function hideStoryNewBadge(){const nb=document.getElementById('storyNewBadge');if(nb)nb.style.display='none';}
export function dismissStoryBadge(){localStorage.setItem('ec_story_seen',localStorage.getItem('ec_story_version')||'');hideStoryNewBadge();}

S.weatherData=JSON.parse(localStorage.getItem('ec_weather'))||{};
S.memoData=JSON.parse(localStorage.getItem('ec_memos'))||{};
let dailyCat='general';

export function switchDailyCat(cat,btn){
  dailyCat=cat;
  document.querySelectorAll('.magic-index-tab[data-cat]').forEach(function(t){t.classList.toggle('active',t.dataset.cat===cat);});
  document.querySelectorAll('.daily-cat-content').forEach(function(c){c.classList.remove('active');});
  const el=document.getElementById('dailyCat-'+cat);
  if(el)el.classList.add('active');
  if(cat==='emergency')bus.emit('render:ecList');
  if(cat==='infection')bus.emit('render:infList');
  if(cat==='survey'){if(!_svInitialized){svSwitchSub('template');_svInitialized=true;}}
  if(cat==='kiosk')kioskRenderHome();
  if(cat==='training'){const curSub=document.getElementById('trSubStatus')&&document.getElementById('trSubStatus').style.display!=='none'?'status':'reg';trSwitchSub(curSub);}
  /* cat 진입 시 해당 이름 검색창에 자동 포커스 (일반/응급/감염만 — 사이드바 검색 아님) */
  if(cat==='general') _focusNameSearch('dailySearchInput');
  else if(cat==='emergency') _focusNameSearch('ecSearchInput');
  else if(cat==='infection') _focusNameSearch('infSearchInput');
}

/* ── 화면 진입 시 이름 검색창 자동 포커스 (사용자 요청) ──────────────────
 *  일반일지·응급처치·감염병 화면에 들어오면 클릭 없이 바로 이름을 입력할 수 있도록
 *  해당 이름 검색 input 에 커서를 둔다. (사이드바 검색창과는 무관)
 *  반드시 네비게이션(switchView/switchDailyCat)에서만 호출 — renderDaily/renderEcList 등
 *  잦은 재렌더에 넣으면 저장·갱신 때마다 커서가 튀므로 금지. */
function _focusNameSearch(inputId){
  function doFocus(){
    const el=document.getElementById(inputId);
    if(el && el.offsetParent!==null) el.focus();   /* 보이는(활성 cat) 입력만 */
  }
  /* 로그인 완료(body.loaded) 후에 포커스. 첫 시작 시 switchView('daily') 가 로그인 전에
   *  호출되므로, 로그인이 끝나 스플래시가 사라진 뒤로 미룬다. */
  if(document.body.classList.contains('loaded')){ setTimeout(doFocus,120); return; }
  const mo=new MutationObserver(function(_m,obs){
    if(document.body.classList.contains('loaded')){ obs.disconnect(); setTimeout(doFocus,450); }
  });
  mo.observe(document.body,{attributes:true,attributeFilter:['class']});
}
/* 현재 활성 daily cat 의 이름 검색창에 포커스 (일반일지 진입 시 사용) */
function _focusDailyCatSearch(){
  const id = dailyCat==='emergency' ? 'ecSearchInput'
           : dailyCat==='infection' ? 'infSearchInput'
           : dailyCat==='general'   ? 'dailySearchInput'
           : null;
  if(id) _focusNameSearch(id);
}
function getWeatherEmoji(date){return S.weatherData[date]||'☀️';}
function setWeather(date,emoji){S.weatherData[date]=emoji;localStorage.setItem('ec_weather',JSON.stringify(S.weatherData));closeWeatherPicker();bus.emit('render:daily');}
function toggleWeatherPicker(e){e.stopPropagation();const p=document.getElementById('weatherPicker');if(p)p.classList.toggle('show');}
function closeWeatherPicker(){const p=document.getElementById('weatherPicker');if(p)p.classList.remove('show');}
document.addEventListener('click',function(e){if(!e.target.closest('.weather-wrap'))closeWeatherPicker();});

S.weatherData=S.weatherData;
S.memoData=S.memoData;

