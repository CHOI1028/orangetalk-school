/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   PLANNER 2 (매직 스테이션 플래너 2) — 통합 모듈
   ═══════════════════════════════════════ */
/* ES Module */
import { S, ensureHolidayYear } from '../../core/app-state.js';
import { escHtml, closeModalGracefully, createEmptyState } from '../../core/helpers.js';
import { closeModalWithAnim } from '../daily/daily-autocomplete.js';
import { renderTrainingHome } from '../training/training-view.js';
import { svSwitchSub } from '../survey/survey-view.js';
import { nlRenderInlineTab } from '../survey/survey-newsletter-editor.js';
import { bus } from '../../core/event-bus.js';
"use strict";

/* ── DayStore — 일별 데이터 localStorage 캐시 ── */
const _dayCache = {};
function _dayKey(date){ return 'gp2_' + date; }
function _dayLoad(date){
  if(_dayCache[date]) return _dayCache[date];
  const cached = localStorage.getItem(_dayKey(date));
  if(cached){ try{ const d=JSON.parse(cached); _dayCache[date]=d; return d; }catch(e){} }
  return { date:date, todos:[], memo:'', images:[] };
}
function _daySave(date, data){
  if(!data.todos.length && !data.memo && !data.images.length){
    localStorage.removeItem(_dayKey(date));
    delete _dayCache[date];
    return;
  }
  localStorage.setItem(_dayKey(date), JSON.stringify(data));
  _dayCache[date] = data;
}
function _dayHasData(date){
  if(_dayCache[date]) return true;
  return !!localStorage.getItem(_dayKey(date));
}

/* ── SidebarStore — 링크/루틴/글로벌 할일 ── */
function _sbGetLinks(current){ return (current && Array.isArray(current)) ? current.slice() : JSON.parse(localStorage.getItem('ec_magic_links2') || '[]'); }
function _sbSaveLinks(items){ localStorage.setItem('ec_magic_links2', JSON.stringify(items || [])); }
function _sbGetRoutines(current){ return (current && Array.isArray(current)) ? current.slice() : JSON.parse(localStorage.getItem('ec_gp2_routines') || '[]'); }
function _sbSaveRoutines(items){ localStorage.setItem('ec_gp2_routines', JSON.stringify(items || [])); }
function _sbGetGlobalTodos(current){ return (current && Array.isArray(current)) ? current.slice() : JSON.parse(localStorage.getItem('ec_gp2_gtodos') || '[]'); }
function _sbSaveGlobalTodos(items){ localStorage.setItem('ec_gp2_gtodos', JSON.stringify(items || [])); }

/* ── SettingsStore — 날짜 설정 + 위젯 레이아웃 ── */
function _ssFieldName(key){
  if(key === 'semester_end') return 'semesterEnd';
  if(key === 'school_year_end') return 'schoolYearEnd';
  return key;
}
function _ssGetDate(dateSettings, key){ return ((dateSettings || {})[_ssFieldName(key)]) || localStorage.getItem('gp2_' + key) || ''; }
function _ssSaveDate(dateSettings, key, value){
  localStorage.setItem('gp2_' + key, value);
  const next = Object.assign({}, dateSettings || {});
  next[_ssFieldName(key)] = value;
  return next;
}
function _ssSaveWidgetLayout(types){ localStorage.setItem('gp2_widget_layout', JSON.stringify(types || [])); }
function _ssLoadWidgetLayout(){
  const saved = localStorage.getItem('gp2_widget_layout');
  if(!saved) return null;
  try{ const arr = JSON.parse(saved); return Array.isArray(arr) ? arr : null; }catch(e){ return null; }
}

/* ── CalendarBundle — Google Calendar 데이터 처리 ── */
function _cbHas(res){ return !!(res && res.success && res.data && res.data.calendars && res.data.calendars.length); }
function _cbApplyBasic(state, res){
  if(!_cbHas(res)) return false;
  state.calendarId = res.data.calendars[0].id || 'primary';
  state.primaryCalId = res.data.primaryCalendarId || 'primary';
  state.events = res.data.eventsByDate || {};
  return true;
}
function _cbApplyDetailed(state, res){
  if(!_cbHas(res)) return false;
  const calendars = res.data.calendars || [];
  state.calColors = {};
  state.calNames = {};
  calendars.forEach(function(cal){
    state.calColors[cal.id] = cal.backgroundColor || '#3b82f6';
    state.calNames[cal.id] = cal.summary || cal.id;
  });
  state.primaryCalId = res.data.primaryCalendarId || 'primary';
  state.events = res.data.eventsByDate || {};
  state.calendarId = calendars[0].id || 'primary';
  return true;
}
function _cbStatusHtml(calCount, totalCount, todayEvents){
  return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:4px;vertical-align:middle"></span><span style="color:#22c55e">연결됨</span> · '+calCount+'개 캘린더 · 이번 달 '+totalCount+'건'+(todayEvents?' · 오늘 '+todayEvents+'건':'');
}

/* ── RenderHelper — UI HTML 생성 ── */
function _rhGcalStatus(connected){
  if(connected) return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:4px;vertical-align:middle"></span><span style="color:#22c55e">연결됨</span>';
  return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#9ca3af;margin-right:4px;vertical-align:middle"></span>미연결';
}
function _rhLoginLoading(){ return '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 로그인 중...'; }
function _rhLoginSuccess(){ return '✅ 로그인 성공! 캘린더 불러오는 중...'; }
function _rhLoginDefault(){ return 'Google 로그인'; }
function _rhSavingToast(toast){ if(!toast) return; toast.textContent='저장 중…'; toast.className='global-save-toast show saving'; }
function _rhSavedToast(toast){ if(!toast) return; toast.textContent='모든 내용이 저장되었습니다.'; toast.className='global-save-toast show'; }

const _gp2={
  date:null, /* 현재 선택된 날짜 (YYYY-MM-DD) */
  calYear:new Date().getFullYear(),
  calMonth:new Date().getMonth(),
  events:{}, /* 캘린더 이벤트 캐시 {date:[...]} */
  calendarId:null, /* 구글 캘린더 ID */
  initialized:false
};

/* ── Event delegation helpers ── */
function _gp2DelegateActions(container){
  if(!container)return;
  container.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');
    if(!el||!container.contains(el))return;
    const action=el.getAttribute('data-action');
    const arg=el.getAttribute('data-arg');
    const arg2=el.getAttribute('data-arg2');
    e.preventDefault();
    switch(action){
      case 'calPrev':_gp2CalPrev();break;
      case 'calNext':_gp2CalNext();break;
      case 'calSetYear':_gp2CalSetYear(+arg);break;
      case 'calSetMonth':_gp2CalSetMonth(+arg);break;
      case 'selectDate':_gp2SelectDate(arg,e);break;
      case 'dpPrev':_gp2DpMonth--;if(_gp2DpMonth<0){_gp2DpMonth=11;_gp2DpYear--;}_gp2DpRender();break;
      case 'dpNext':_gp2DpMonth++;if(_gp2DpMonth>11){_gp2DpMonth=0;_gp2DpYear++;}_gp2DpRender();break;
      case 'dpSetYear':_gp2DpYear=+arg;_gp2DpRender();break;
      case 'dpSetMonth':_gp2DpMonth=+arg;_gp2DpRender();break;
      case 'dpSelect':_gp2DpSelect(arg);break;
      case 'openExternal':e.stopPropagation();window.electronAPI.openExternal(arg);break;
      case 'deleteLink':_gp2DeleteLink(+arg);break;
      case 'deleteRoutine':_gp2DeleteRoutine(+arg);break;
      case 'toggleRoutine':/* handled via onchange */break;
      case 'deleteGlobalTodo':_gp2DeleteGlobalTodo(+arg);break;
      case 'toggleGlobalTodo':/* handled via onchange */break;
      case 'deleteTodo':_gp2DeleteTodo(+arg);break;
      case 'carryOver':_gp2CarryOver(arg);break;
      case 'deleteDday':_gp2DeleteDday(+arg);break;
      case 'toggleShop':/* handled via onchange */break;
      case 'deleteShop':_gp2DeleteShop(+arg);break;
      case 'copyPhone':navigator.clipboard.writeText(arg).then(function(){const t=document.getElementById('globalSaveToast');if(t){t.textContent='번호 복사됨';t.className='global-save-toast show';setTimeout(function(){t.className='global-save-toast';},2000);}});break;
      case 'deletePhone':_gp2DeletePhone(+arg);break;
      case 'deleteNote':_gp2DeleteNote(+arg);break;
      case 'deleteProgressB':_gp2DeleteProgressB(+arg);break;
      case 'toggleProgressB':/* handled via onchange */break;
      case 'editProgress':_gp2EditProgress(+arg);break;
      case 'incrProgress':_gp2IncrProgress(+arg);break;
      case 'foldScrap':_gp2FoldScrap(+arg);break;
      case 'deleteScrap':_gp2DeleteScrap(+arg);break;
      case 'unfoldScrap':_gp2UnfoldScrap(+arg);break;
      case 'selectBirthday':_gp2SelectBirthday(arg,el.closest('[data-birthday-row]'));break;
      case 'setColor':_gp2SetColor(arg);break;
      case 'addLink':_gp2AddLink();break;
      case 'addRoutine':_gp2AddRoutine();break;
      case 'addGlobalTodo':_gp2AddGlobalTodo();break;
      case 'addTodo':_gp2AddTodo();break;
      case 'prevDay':_gp2PrevDay();break;
      case 'nextDay':_gp2NextDay();break;
      case 'goToday':_gp2.date=_gp2Today();_gp2.calYear=new Date().getFullYear();_gp2.calMonth=new Date().getMonth();_gp2Render();break;
      case 'search':_gp2Search();break;
      case 'setSemesterEnd':_gp2SetSemesterEnd();break;
      case 'setSchoolYearEnd':_gp2SetSchoolYearEnd();break;
      case 'doLogin':_gp2DoLogin();break;
      case 'closeLogin':closeModalGracefully('gp2LoginOverlay');break;
      case 'saveMemo':/* handled via oninput */break;
      case 'toggleDone':const ns=el.nextElementSibling;if(ns)ns.style.display=ns.style.display==='none'?'block':'none';const sp=el.querySelector('span');if(sp)sp.textContent=ns&&ns.style.display==='none'?'\u25B6':'\u25BC';break;
      case 'calMonthPrev':_gp2.calMonth--;if(_gp2.calMonth<0){_gp2.calMonth=11;_gp2.calYear--;}_gp2Render();break;
      case 'calMonthNext':_gp2.calMonth++;if(_gp2.calMonth>11){_gp2.calMonth=0;_gp2.calYear++;}_gp2Render();break;
      case 'calSetYearDirect':e.stopPropagation();_gp2.calYear=+arg;_gp2Render();break;
      case 'calSetMonthDirect':e.stopPropagation();_gp2.calMonth=+arg;_gp2Render();break;
    }
    /* 동기 저장 액션만 토스트 — add/edit 는 프롬프트 콜백에서 별도 처리(취소 시 거짓 토스트 방지). 검색·달력이동·복사 제외. (사용자 지시 2026-06-16) */
    if(['deleteLink','deleteRoutine','deleteGlobalTodo','deleteTodo','carryOver','deleteDday','deleteShop','deletePhone','deleteNote','deleteProgressB','incrProgress','deleteScrap','selectBirthday','setColor'].indexOf(action)!==-1) _gp2ShowSaveToast();
  });
  /* Delegate change events for checkboxes and inputs */
  container.addEventListener('change',function(e){
    const el=e.target.closest('[data-action]');
    if(!el||!container.contains(el))return;
    const action=el.getAttribute('data-action');
    const arg=el.getAttribute('data-arg');
    const arg2=el.getAttribute('data-arg2');
    switch(action){
      case 'toggleRoutine':_gp2ToggleRoutine(+arg,el.checked);break;
      case 'toggleGlobalTodo':_gp2ToggleGlobalTodo(+arg);break;
      case 'toggleTodo':_gp2ToggleTodo(+arg);break;
      case 'updateTodo':_gp2UpdateTodo(+arg,el.value);break;
      case 'toggleShop':_gp2ToggleShop(+arg);break;
      case 'toggleProgressB':_gp2ToggleProgressB(+arg,+arg2);break;
    }
  });
  /* Delegate input events */
  container.addEventListener('input',function(e){
    const el=e.target.closest('[data-action]');
    if(!el||!container.contains(el))return;
    const action=el.getAttribute('data-action');
    const arg=el.getAttribute('data-arg');
    switch(action){
      case 'saveNote':_gp2SaveNote(+arg,el.value);break;
      case 'saveMemo':_gp2SaveMemo();break;
    }
  });
  /* Delegate keydown events */
  container.addEventListener('keydown',function(e){
    const el=e.target.closest('[data-action]');
    if(!el||!container.contains(el))return;
    const action=el.getAttribute('data-action');
    if(action==='searchKeydown'&&e.key==='Enter')_gp2Search();
  });
}
/* Hover opacity delegation: elements with data-hover-opacity get mouseenter/leave */
function _gp2DelegateHoverOpacity(container){
  if(!container)return;
  container.addEventListener('mouseenter',function(e){
    const el=e.target.closest('[data-hover-opacity]');
    if(el&&container.contains(el))el.style.opacity=el.getAttribute('data-hover-opacity');
  },true);
  container.addEventListener('mouseleave',function(e){
    const el=e.target.closest('[data-hover-opacity]');
    if(el&&container.contains(el))el.style.opacity=el.getAttribute('data-rest-opacity')||'0.4';
  },true);
}
/* Hover background delegation: elements with data-hover-bg */
function _gp2DelegateHoverBg(container){
  if(!container)return;
  container.addEventListener('mouseenter',function(e){
    const el=e.target.closest('[data-hover-bg]');
    if(el&&container.contains(el))el.style.background=el.getAttribute('data-hover-bg');
  },true);
  container.addEventListener('mouseleave',function(e){
    const el=e.target.closest('[data-hover-bg]');
    if(el&&container.contains(el))el.style.background=el.getAttribute('data-rest-bg')||'';
  },true);
}
/* Combined delegation setup for a container */
function _gp2SetupDelegation(container){
  if(!container||container._gp2Delegated)return;
  container._gp2Delegated=true;
  _gp2DelegateActions(container);
  _gp2DelegateHoverOpacity(container);
  _gp2DelegateHoverBg(container);
}

function _gp2Today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

function _gp2Load(date){ return _dayLoad(date); }
function _gp2Save(date,data){ _daySave(date,data); }
function _gp2HasData(date){ return _dayHasData(date); }

export function _magicSwitchSub(sub,btn){
  /* 매직 스테이션 하위 탭 전환 */
  document.querySelectorAll('#view-magic .magic-index-tab').forEach(function(t){t.classList.remove('active');});
  if(btn)btn.classList.add('active');
  ['magicSubPlanner2','magicSubTraining','magicSubNewsletter','magicSubSurvey'].forEach(function(id){
    const el=document.getElementById(id);if(el){el.classList.remove('active');el.style.display='';}
  });
  const map={planner:'magicSubPlanner2',training:'magicSubTraining',newsletter:'magicSubNewsletter',survey:'magicSubSurvey'};
  const target=document.getElementById(map[sub]);
  if(target){target.classList.add('active');target.style.display='block';}
  /* 위젯 보관함 & Drive 버튼: 플래너만 표시 */
  const wsb=document.getElementById('gp2WidgetStoreBtn');
  if(wsb)wsb.style.display=sub==='planner'?'block':'none';
  const dpb=document.getElementById('gp2DrivePathBtn');
  if(dpb)dpb.style.display=sub==='planner'?'block':'none';
  const dw=document.getElementById('gp2DateWidgets');
  if(dw)dw.style.display=sub==='planner'?'block':'none';
  const ws=document.getElementById('gp2WidgetStore');
  if(ws&&sub!=='planner')ws.style.display='none';
  /* 가정통신문: 부모 스크롤 차단 (내부만 스크롤) */
  const chartBody=document.querySelector('#view-magic .magic-chart-body');
  if(chartBody){
    if(sub==='newsletter'){chartBody.style.overflowY='hidden';}
    else{chartBody.style.overflowY='auto';}
  }
  if(sub==='planner')gp2Init();
  if(sub==='survey')svSwitchSub('template');
  if(sub==='training')renderTrainingHome();
  if(sub==='newsletter')nlRenderInlineTab();
  /* [BACKUP] if(sub==='physical')peRenderMain(); */
  /* 바운스 스크롤 적용 */
  _magicApplyBounce();
}
/* 바운스 스크롤 — 일반 일지와 동일한 속도/이징 */
function _magicBounceAttach(area){
  if(!area||area._bounceInit)return;
  area._bounceInit=true;
  let bouncing=false;
  area.addEventListener('scroll',function(){
    if(bouncing)return;
    const atBottom=area.scrollTop+area.clientHeight>=area.scrollHeight-2;
    const atTop=area.scrollTop<=0;
    if(atBottom||atTop){
      bouncing=true;
      const dir=atBottom?-1:1;
      area.style.transition='transform 0.2s cubic-bezier(.2,.8,.4,1.4)';
      area.style.transform='translateY('+(dir*18)+'px)';
      setTimeout(function(){
        area.style.transition='transform 0.35s cubic-bezier(.25,.1,.25,1)';
        area.style.transform='translateY(0)';
        setTimeout(function(){area.style.transition='';bouncing=false;},350);
      },200);
    }
  });
}
export function _magicApplyBounce(){
  /* 내부 스크롤 영역에만 적용 (magic-chart-body 전체에는 적용하지 않음) */
  ['magicSubPlanner2','magicSubTraining'].forEach(function(id){
    _magicBounceAttach(document.getElementById(id));
  });
  /* 가정통신문: 내부 미리보기 영역만 */
  const nlPreview=document.getElementById('nlInlineWrap');
  if(nlPreview){
    const nlScroll=nlPreview.querySelector('[style*="overflow"]')||nlPreview;
    _magicBounceAttach(nlScroll);
  }
}
export function gp2Init(){
  if(!_gp2.date)_gp2.date=_gp2Today();
  /* Quick Links 기본값 + favicon 아이콘 보장 */
  const _qlDef=[{name:'Canva',url:'https://www.canva.com',icon:'<img src="https://www.canva.com/favicon.ico" width="14" height="14" style="vertical-align:middle">'},{name:'웅쌤튜브',url:'https://www.youtube.com/@TUBE-sc1su',icon:'<img src="https://www.youtube.com/favicon.ico" width="14" height="14" style="vertical-align:middle">'}];
  const ql=JSON.parse(localStorage.getItem('ec_magic_links2')||'[]');
  if(!ql.length){localStorage.setItem('ec_magic_links2',JSON.stringify(_qlDef));_gp2.links=_qlDef.slice();}
  else{let _ch=false;ql.forEach(function(l){if(l.url&&l.icon&&l.icon.indexOf('<img')===-1){try{const u=new URL(l.url);if(u.protocol==='https:'||u.protocol==='http:'){l.icon='<img src="'+escHtml(u.origin)+'/favicon.ico" width="14" height="14" style="vertical-align:middle" onerror="this.style.display=\'none\'">';_ch=true;}}catch(e){}}});if(_ch)localStorage.setItem('ec_magic_links2',JSON.stringify(ql));_gp2.links=ql;}
  _gp2UpdateAll();
  _gp2RestoreWidgetLayout();
  _gp2UpdateDateWidgets();
  /* 캘린더 미연결이면 자동 연결 시도 (토큰 복원) */
  if(!_gp2.calendarId&&window.electronAPI){
    window.electronAPI.plannerFetchMonthEvents(_gp2.date||_gp2Today()).then(function(calRes){
      if(_cbApplyBasic(_gp2,calRes)){
        
        _gp2FetchEvents();
      }
    }).catch(function(){});
  }
}

/* 정적 HTML 내부만 업데이트 */
function _gp2UpdateAll(){
  _gp2UpdateDateLabel();
  _gp2UpdateCalendar();
  _gp2UpdateEvents();
  _gp2UpdateLinks();
  _gp2UpdateRoutines();
  _gp2UpdateGlobalTodos();
  _gp2UpdateYearProgress();
  _gp2UpdateDayContent();
  _gp2UpdateGcalStatus();
}

/* ── 사이드바 날짜 위젯 ── */
function _gp2UpdateDateWidgets(){
  const now=new Date();
  const yr=now.getFullYear(), mo=now.getMonth(), dd=now.getDate();
  const dayNames=['일','월','화','수','목','금','토'];
  /* 오늘 */
  const todayEl=document.getElementById('gp2DwToday');
  if(todayEl){
    const dayPassed=now.getHours()*60+now.getMinutes();
    const dayPct=Math.round(dayPassed/1440*100);
    todayEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><span style="font-size:10px;font-weight:700;color:var(--cyan)">오늘</span><span style="font-size:9px;color:var(--t3)">'+dayPct+'%</span></div>'
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+dayPct+'%;height:100%;background:#d97706;border-radius:2px"></div></div>';
  }
  /* 이번 달 */
  const moStart=new Date(yr,mo,1);
  const moEnd=new Date(yr,mo+1,0);
  const moDays=moEnd.getDate();
  const moPassed=dd;
  const moPct=Math.round(moPassed/moDays*100);
  const moEl=document.getElementById('gp2DwMonth');
  if(moEl){
    moEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><span style="font-size:10px;font-weight:700;color:var(--t2)">이번 달</span><span style="font-size:9px;color:var(--t3)">'+moPct+'%</span></div>'
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+moPct+'%;height:100%;background:#f472b6;border-radius:2px"></div></div>';
  }
  /* 올해 */
  const yearStart=new Date(yr,0,1);
  const yearEnd=new Date(yr,11,31);
  const yearTotal=Math.ceil((yearEnd-yearStart)/(1000*60*60*24))+1;
  const yearPassed=Math.ceil((now-yearStart)/(1000*60*60*24));
  const yearPct=Math.round(yearPassed/yearTotal*100);
  const yearEl=document.getElementById('gp2DwYear');
  if(yearEl){
    yearEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><span style="font-size:10px;font-weight:700;color:var(--t2)">올해</span><span style="font-size:9px;color:var(--t3)">'+yearPct+'%</span></div>'
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+yearPct+'%;height:100%;background:#0891b2;border-radius:2px"></div></div>';
  }
  /* 이번 학기 (3~8월:1학기, 9~2월:2학기) */
  let sem, semStart, semEnd;
  if(mo>=2&&mo<=7){sem='1학기';semStart=new Date(yr,2,1);semEnd=new Date(yr,7,31);}
  else if(mo>=8){sem='2학기';semStart=new Date(yr,8,1);semEnd=new Date(yr+1,1,28);}
  else{sem='2학기';semStart=new Date(yr-1,8,1);semEnd=new Date(yr,1,28);}
  const semTotal=Math.ceil((semEnd-semStart)/(1000*60*60*24))+1;
  const semPassed=Math.max(0,Math.ceil((now-semStart)/(1000*60*60*24)));
  const semPct=Math.min(100,Math.round(semPassed/semTotal*100));
  const semEl=document.getElementById('gp2DwSemester');
  if(semEl){
    semEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><div style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;font-weight:700;color:var(--t2)">이번 학기</span><span data-action="setSemesterEnd" style="cursor:pointer;opacity:0.4;transition:opacity 0.15s" title="방학식 날짜 설정"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span></div><span style="font-size:9px;color:var(--t3)">'+semPct+'%</span></div>'
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+semPct+'%;height:100%;background:#16a34a;border-radius:2px"></div></div>';
    _gp2DelegateHoverOpacity(semEl);
    const _semBtn=semEl.querySelector('[data-action="setSemesterEnd"]');
    if(_semBtn)_semBtn.addEventListener('click',function(){_gp2SetSemesterEnd();});
  }
  /* 이번 학년도 (3월~다음해 2월) */
  let syStart, syEnd, syLabel;
  if(mo>=2){syStart=new Date(yr,2,1);syEnd=new Date(yr+1,1,28);syLabel=yr+'학년도';}
  else{syStart=new Date(yr-1,2,1);syEnd=new Date(yr,1,28);syLabel=(yr-1)+'학년도';}
  const syTotal=Math.ceil((syEnd-syStart)/(1000*60*60*24))+1;
  const syPassed=Math.max(0,Math.ceil((now-syStart)/(1000*60*60*24)));
  const syPct=Math.min(100,Math.round(syPassed/syTotal*100));
  const syEl=document.getElementById('gp2DwSchoolYear');
  if(syEl){
    syEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><div style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;font-weight:700;color:var(--t2)">이번 학년도</span><span data-action="setSchoolYearEnd" style="cursor:pointer;opacity:0.4;transition:opacity 0.15s" title="종업식 날짜 설정"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span></div><span style="font-size:9px;color:var(--t3)">'+syPct+'%</span></div>'
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+syPct+'%;height:100%;background:#facc15;border-radius:2px"></div></div>';
    _gp2DelegateHoverOpacity(syEl);
    const _syBtn=syEl.querySelector('[data-action="setSchoolYearEnd"]');
    if(_syBtn)_syBtn.addEventListener('click',function(){_gp2SetSchoolYearEnd();});
  }
}

/* ── 달력 그리드 렌더링 ── */
function _gp2UpdateCalendar(){
  const el=document.getElementById('gp2CalendarGrid');if(!el)return;
  const d=_gp2.date||_gp2Today();
  const dp=d.split('-');
  const yr=parseInt(dp[0]), mo=parseInt(dp[1])-1;
  const now=new Date();const todayStr=_gp2Today();
  const first=new Date(yr,mo,1);const dow=first.getDay();
  const dim=new Date(yr,mo+1,0).getDate();
  ensureHolidayYear(String(yr)); const holidays={};Object.keys(S.koreanHolidays).forEach(function(k){if(k.startsWith(String(yr)))holidays[k]=S.koreanHolidays[k];});

  let h='<div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-bottom:6px">';
  h+='<button data-action="calPrev" style="border:none;background:transparent;cursor:pointer;font-size:14px;color:var(--t2);padding:4px 8px">◀</button>';
  /* 연도 — 호버 시 선택 팝업 */
  h+='<span class="mcal-year" data-wheel="calYearWheel" style="font-size:15px;font-weight:800;color:var(--t1);cursor:pointer;user-select:none;position:relative" title="클릭하여 연도 선택 / 휠로 이동">'+yr+'년';
  h+='<span class="mcal-popup" style="font-size:11px">';
  for(let _yi=yr-5;_yi<=yr+5;_yi++){
    h+='<div class="mcal-popup-item'+(_yi===yr?' active':'')+'" data-action="calSetYear" data-arg="'+_yi+'">'+_yi+'</div>';
  }
  h+='</span></span>';
  h+='<span style="font-size:15px;font-weight:800;color:var(--t1);margin:0 2px"> </span>';
  /* 월 — 호버 시 선택 팝업 */
  h+='<span class="mcal-month" data-wheel="calWheel" style="font-size:15px;font-weight:800;color:var(--t1);cursor:pointer;user-select:none;position:relative" title="클릭하여 월 선택 / 휠로 이동">'+(mo+1)+'월';
  h+='<span class="mcal-popup" style="display:none;flex-wrap:wrap;gap:2px;min-width:140px;max-height:none;overflow:visible">';
  for(let _mi=0;_mi<12;_mi++){
    h+='<div class="mcal-popup-item'+(_mi===mo?' active':'')+'" style="width:38px" data-action="calSetMonth" data-arg="'+_mi+'">'+(_mi+1)+'월</div>';
  }
  h+='</span></span>';
  h+='<button data-action="calNext" style="border:none;background:transparent;cursor:pointer;font-size:14px;color:var(--t2);padding:4px 8px">▶</button>';
  h+='</div>';
  /* 요일 헤더 */
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--t3);margin-bottom:2px">';
  ['일','월','화','수','목','금','토'].forEach(function(dn,i){h+='<span style="padding:3px;color:'+(i===0?'var(--rs)':i===6?'#3b82f6':'var(--t3)')+'">'+dn+'</span>';});
  h+='</div>';
  /* 날짜 그리드 — 구글 캘린더 스타일 (일정 제목 표시) */
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;border:1px solid var(--bdrl);border-radius:6px;overflow:hidden">';
  for(let e=0;e<dow;e++) h+='<div style="min-height:'+_gp2CellH+'px;max-height:'+_gp2CellH+'px;overflow:hidden;background:var(--bg2);opacity:0.3"></div>';
  for(let dd=1;dd<=dim;dd++){
    const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
    const isT=(ds===todayStr);
    const isSel=(ds===d);
    const ddow=(dow+dd-1)%7;
    const isH=!!holidays[ds];
    const dayEvents=_gp2.events[ds]||[];
    const hasData=_gp2HasData(ds);
    const col=(ddow===0||isH)?'var(--rs)':ddow===6?'#3b82f6':'var(--t2)';
    const cellBg=isSel?'rgba(6,182,212,0.08)':'var(--card)';
    h+='<div data-action="selectDate" data-arg="'+ds+'" style="min-height:'+_gp2CellH+'px;max-height:'+_gp2CellH+'px;overflow:hidden;padding:3px;cursor:pointer;background:'+cellBg+';border-left:'+(isSel?'3px solid var(--cyan)':'3px solid transparent')+';transition:all 0.1s;overflow:hidden" data-hover-bg="var(--hover)" data-rest-bg="'+cellBg+'">';
    /* 날짜 숫자 */
    h+='<div style="font-size:11px;font-weight:'+(isT||isH?'800':'600')+';color:'+col+';margin-bottom:2px;display:flex;align-items:center;gap:3px">';
    if(isT)h+='<span style="background:var(--cyan);color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:10px">'+dd+'</span>';
    else h+=dd;
    if(isH)h+='<span style="font-size:8px;color:var(--rs)">'+holidays[ds]+'</span>';
    h+='</div>';
    /* 일정 표시 */
    dayEvents.forEach(function(ev,idx){
      if(idx>=3)return;
      const time=ev.start&&ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'}):'';
      const evColor=ev._calColor||'#3b82f6';
      h+='<div style="font-size:9px;padding:1px 3px;margin-bottom:1px;border-radius:3px;background:'+evColor+'22;color:'+evColor+';border-left:2px solid '+evColor+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(time?time+' ':'')+escHtml(ev.summary||'')+'</div>';
    });
    if(dayEvents.length>3)h+='<div style="font-size:8px;color:var(--t3)">+'+(dayEvents.length-3)+'건 더</div>';
    /* 기록 표시 */
    if(hasData){
      const _dd=_gp2Load(ds);
      _dd.todos.forEach(function(t,ti){
        if(ti>=2)return;
        h+='<div style="font-size:8px;padding:1px 2px;margin-bottom:1px;border-radius:2px;background:rgba(34,197,94,0.12);color:#16a34a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(t.done?'✓ ':'')+escHtml(t.text||'')+'</div>';
      });
      if(_dd.todos.length>2)h+='<div style="font-size:7px;color:var(--t3)">+'+(_dd.todos.length-2)+'건</div>';
      if(_dd.memo)h+='<div style="font-size:7px;color:#22c55e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📝 '+escHtml(_dd.memo.substring(0,15))+'</div>';
    }
    h+='</div>';
  }
  /* 남은 칸 채우기 */
  const totalCells=dow+dim;const remaining=totalCells%7?7-totalCells%7:0;
  for(let r=0;r<remaining;r++) h+='<div style="min-height:'+_gp2CellH+'px;max-height:'+_gp2CellH+'px;overflow:hidden;background:var(--bg2);opacity:0.3"></div>';
  h+='</div>';
  el.innerHTML=h;
  _gp2SetupDelegation(el);
  /* Bind wheel events on year/month labels */
  const _ywEl=el.querySelector('[data-wheel="calYearWheel"]');
  if(_ywEl)_ywEl.addEventListener('wheel',_gp2CalYearWheel);
  const _mwEl=el.querySelector('[data-wheel="calWheel"]');
  if(_mwEl)_mwEl.addEventListener('wheel',_gp2CalWheel);
}

/* 중복 _gp2CalSetYear/_gp2CalSetMonth 제거 — L316/L321의 정의 사용 */
function _gp2CalPrev(){
  const d=_gp2.date||_gp2Today();const dp=d.split('-');
  let yr=parseInt(dp[0]), mo=parseInt(dp[1])-2;
  if(mo<0){mo=11;yr--;}
  _gp2.date=yr+'-'+String(mo+1).padStart(2,'0')+'-'+dp[2];
  /* 날짜가 해당 월에 없으면 마지막 날로 */
  const dim=new Date(yr,mo+1,0).getDate();
  if(parseInt(dp[2])>dim)_gp2.date=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(dim).padStart(2,'0');
  _gp2UpdateAll();_gp2FetchEvents();
}
function _gp2CalNext(){
  const d=_gp2.date||_gp2Today();const dp=d.split('-');
  let yr=parseInt(dp[0]), mo=parseInt(dp[1]);
  if(mo>11){mo=0;yr++;}
  _gp2.date=yr+'-'+String(mo+1).padStart(2,'0')+'-'+dp[2];
  const dim=new Date(yr,mo+1,0).getDate();
  if(parseInt(dp[2])>dim)_gp2.date=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(dim).padStart(2,'0');
  _gp2UpdateAll();_gp2FetchEvents();
}
function _gp2CalSetYear(y){
  const d=_gp2.date||_gp2Today();const dp=d.split('-');
  _gp2.date=y+'-'+dp[1]+'-'+dp[2];
  _gp2UpdateAll();_gp2FetchEvents();
}
function _gp2CalSetMonth(m){
  const d=_gp2.date||_gp2Today();const dp=d.split('-');
  const yr=parseInt(dp[0]);
  const dim=new Date(yr,m+1,0).getDate();
  const day=Math.min(parseInt(dp[2]),dim);
  _gp2.date=yr+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  _gp2UpdateAll();_gp2FetchEvents();
}

function _gp2UpdateDateLabel(){
  const el=document.getElementById('gp2DateLabel');if(!el)return;
  const d=_gp2.date||_gp2Today();const p=d.split('-');
  const dt=new Date(+p[0],+p[1]-1,+p[2]);
  const dow=['일','월','화','수','목','금','토'][dt.getDay()];
  let txt=parseInt(p[1])+'월 '+parseInt(p[2])+'일 ('+dow+')';
  if(d===_gp2Today())txt+=' <span style="font-size:10px;font-weight:700;color:var(--cyan);background:rgba(6,182,212,0.1);padding:1px 7px;border-radius:8px;margin-left:4px">오늘</span>';
  el.innerHTML=txt;
}

function _gp2UpdateGcalStatus(){
  const el=document.getElementById('gp2GcalStatus');
  if(!el)return;
  el.innerHTML=_rhGcalStatus(!!_gp2.calendarId);
}

function _gp2UpdateEvents(){
  const el=document.getElementById('gp2EventTags');if(!el)return;
  const d=_gp2.date||_gp2Today();
  const events=_gp2.events[d]||[];
  if(!events.length){
    el.innerHTML = (typeof createEmptyState==='function')
      ? createEmptyState({icon:'📅',title:'이 날짜에 일정이 없습니다',desc:'Google Calendar 연동 후 자동으로 표시됩니다.'})
      : '<span style="font-size:10px;color:var(--t3)">이 날짜에 일정이 없습니다</span>';
    return;
  }
  let h='<div style="font-size:10px;font-weight:700;color:var(--t2);margin-bottom:4px">📅 선택 날짜 일정 ('+events.length+'건)</div>';
  events.forEach(function(ev){
    const time=ev.start&&ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'}):'종일';
    const evColor=ev._calColor||'#3b82f6';
    const calName=ev._calName||'';
    h+='<span style="font-size:11px;padding:4px 10px;border-radius:6px;background:'+evColor+'15;color:'+evColor+';border:1px solid '+evColor+'40;display:inline-flex;align-items:center;gap:4px">';
    h+='<span style="width:8px;height:8px;border-radius:50%;background:'+evColor+';flex-shrink:0"></span>';
    h+='<span style="font-weight:700">'+time+'</span> '+escHtml(ev.summary||'(제목 없음)');
    if(calName)h+='<span style="font-size:9px;opacity:0.6;margin-left:2px">('+escHtml(calName)+')</span>';
    h+='</span>';
  });
  el.innerHTML=h;
}

function _gp2UpdateYearProgress(){
  const now=new Date();
  /* 올해 경과율 */
  const startOfYear=new Date(now.getFullYear(),0,1);
  const endOfYear=new Date(now.getFullYear(),11,31);
  const totalDays=Math.ceil((endOfYear-startOfYear)/(1000*60*60*24))+1;
  const elapsed=Math.ceil((now-startOfYear)/(1000*60*60*24))+1;
  const pct=Math.round(elapsed/totalDays*1000)/10;
  const label=document.getElementById('gp2YearLabel');if(label)label.textContent='올해';
  const bar=document.getElementById('gp2YearBar');if(bar)bar.style.width=pct+'%';
  const pctEl=document.getElementById('gp2YearPct');if(pctEl)pctEl.textContent=pct+'%';
  /* 1학기 경과율 */
  const semEnd=((_gp2.dateSettings||{}).semesterEnd)||localStorage.getItem('gp2_semester_end')||'';
  const semBar=document.getElementById('gp2SemBar');
  const semPct=document.getElementById('gp2SemPct');
  if(semEnd){
    const semStart=new Date(now.getFullYear(),2,2); /* 3월 2일 기준 */
    const semEndDate=new Date(semEnd);
    const semTotal=Math.ceil((semEndDate-semStart)/(1000*60*60*24));
    const semElapsed=Math.ceil((now-semStart)/(1000*60*60*24));
    const sp=semTotal>0?Math.min(100,Math.round(semElapsed/semTotal*1000)/10):0;
    if(semBar)semBar.style.width=Math.max(0,sp)+'%';
    if(semPct)semPct.textContent=sp+'%';
  } else {
    if(semBar)semBar.style.width='0%';
    if(semPct)semPct.textContent='미설정';
  }
  /* 학년도 경과율 */
  const schEnd=((_gp2.dateSettings||{}).schoolYearEnd)||localStorage.getItem('gp2_school_year_end')||'';
  const schBar=document.getElementById('gp2SchoolBar');
  const schPct=document.getElementById('gp2SchoolPct');
  if(schEnd){
    const schStart=new Date(now.getFullYear(),2,2);
    const schEndDate=new Date(schEnd);
    const schTotal=Math.ceil((schEndDate-schStart)/(1000*60*60*24));
    const schElapsed=Math.ceil((now-schStart)/(1000*60*60*24));
    const scp=schTotal>0?Math.min(100,Math.round(schElapsed/schTotal*1000)/10):0;
    if(schBar)schBar.style.width=Math.max(0,scp)+'%';
    if(schPct)schPct.textContent=scp+'%';
  } else {
    if(schBar)schBar.style.width='0%';
    if(schPct)schPct.textContent='미설정';
  }
}

/* ── 1학기 방학식 날짜 설정 ── */
function _gp2SetSemesterEnd(){
  const saved=_ssGetDate(_gp2.dateSettings,'semester_end');
  _gp2ShowDatePicker('1학기 방학식 날짜를 선택하세요.',saved,function(ds){
    _gp2.dateSettings=_ssSaveDate(_gp2.dateSettings,'semester_end',ds);
    _gp2UpdateYearProgress();
  });
}
function _gp2SetSchoolYearEnd(){
  const saved=_ssGetDate(_gp2.dateSettings,'school_year_end');
  _gp2ShowDatePicker('종업식(졸업식) 날짜를 선택하세요.',saved,function(ds){
    _gp2.dateSettings=_ssSaveDate(_gp2.dateSettings,'school_year_end',ds);
    _gp2UpdateYearProgress();
  });
}

/* ── 날짜 선택 달력 팝업 ── */
let _gp2DpCallback=null;

let _gp2DpYear;
let _gp2DpMonth;
function _gp2ShowDatePicker(title,initVal,callback){
  _gp2DpCallback=callback;
  const now=new Date();
  if(initVal){const d=new Date(initVal);_gp2DpYear=d.getFullYear();_gp2DpMonth=d.getMonth();}
  else{_gp2DpYear=now.getFullYear();_gp2DpMonth=now.getMonth();}
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2DpOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div class="modal-content" style="width:320px;max-width:94vw;padding:0">';
  h+='<div style="background:rgba(6,182,212,0.10);padding:12px 16px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
  h+='<div style="font-size:13px;font-weight:800;color:var(--t1)">📅 '+title+'</div>';
  if(!initVal)h+='<div style="font-size:10px;color:var(--t3);margin-top:3px">방학식 날을 넣어야 경과율이 표시됩니다</div>';
  h+='</div>';
  h+='<div id="gp2DpBody" style="padding:12px"></div>';
  h+='</div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  _gp2DpRender();
}
function _gp2DpRender(){
  const body=document.getElementById('gp2DpBody');if(!body)return;
  const yr=_gp2DpYear, mo=_gp2DpMonth;
  const now=new Date();
  const first=new Date(yr,mo,1);const dow=first.getDay();
  const dim=new Date(yr,mo+1,0).getDate();
  ensureHolidayYear(String(yr)); const holidays={};Object.keys(S.koreanHolidays).forEach(function(k){if(k.startsWith(String(yr)))holidays[k]=S.koreanHolidays[k];});
  let h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h+='<button data-action="dpPrev" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2)">◀</button>';
  h+='<div style="display:flex;gap:2px;align-items:baseline">';
  h+='<div class="dp-hover-wrap" style="position:relative;padding-bottom:2px">';
  h+='<span style="font-size:13px;font-weight:800;color:var(--t1);cursor:pointer">'+yr+'년</span>';
  h+='<div class="dp-dd" style="display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--cyan);border-radius:8px;box-shadow:var(--sh);z-index:600;min-width:90px;padding:4px 0">';
  [yr,yr+1].forEach(function(y){
    h+='<div data-action="dpSetYear" data-arg="'+y+'" style="padding:6px 12px;font-size:12px;cursor:pointer;font-weight:'+(y===yr?'700':'400')+';color:'+(y===yr?'var(--cyan)':'var(--t1)')+';text-align:center" data-hover-bg="var(--hover)" data-rest-bg="">'+y+'</div>';
  });
  h+='</div></div>';
  /* 월 hover */
  h+='<div class="dp-hover-wrap" data-dd-display="grid" style="position:relative;padding-bottom:2px">';
  h+='<span style="font-size:13px;font-weight:800;color:var(--t1);cursor:pointer">'+(mo+1)+'월</span>';
  h+='<div class="dp-dd" style="display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--cyan);border-radius:8px;box-shadow:var(--sh);z-index:600;min-width:110px;padding:6px;grid-template-columns:1fr 1fr;grid-template-rows:repeat(6,auto);grid-auto-flow:column;gap:2px">';
  for(let m=0;m<12;m++){
    h+='<div data-action="dpSetMonth" data-arg="'+m+'" style="padding:5px 8px;font-size:11px;cursor:pointer;font-weight:'+(m===mo?'700':'400')+';color:'+(m===mo?'var(--cyan)':'var(--t1)')+';text-align:center;border-radius:4px" data-hover-bg="var(--hover)" data-rest-bg="">'+(m+1)+'월</div>';
  }
  h+='</div></div></div>';
  h+='<button data-action="dpNext" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2)">▶</button>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){h+='<span style="padding:3px;color:'+(i===0?'var(--rs)':i===6?'#3b82f6':'var(--t3)')+'">'+d+'</span>';});
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:11px;gap:2px">';
  for(let e=0;e<dow;e++)h+='<span></span>';
  for(let dd=1;dd<=dim;dd++){
    const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
    const ddow=(dow+dd-1)%7;
    const isH=!!holidays[ds];
    const col=(ddow===0||isH)?'var(--rs)':ddow===6?'#3b82f6':'var(--t1)';
    h+='<span data-action="dpSelect" data-arg="'+ds+'" style="padding:6px 2px;cursor:pointer;border-radius:6px;color:'+col+';font-weight:'+(isH?'700':'400')+'" data-hover-bg="var(--hover)" data-rest-bg="">'+dd+'</span>';
  }
  h+='</div>';
  body.innerHTML=h;
  _gp2SetupDelegation(body);
  /* Bind hover show/hide for dp-hover-wrap */
  body.querySelectorAll('.dp-hover-wrap').forEach(function(wrap){
    const dd=wrap.querySelector('.dp-dd');
    if(!dd)return;
    const displayMode=wrap.getAttribute('data-dd-display')||'block';
    wrap.addEventListener('mouseenter',function(){dd.style.display=displayMode;});
    wrap.addEventListener('mouseleave',function(){dd.style.display='none';});
  });
}
function _gp2DpSelect(ds){
  if(_gp2DpCallback)_gp2DpCallback(ds);
  const ov=document.getElementById('gp2DpOverlay');if(ov)closeModalWithAnim(ov);
}

function _gp2Render(){_gp2UpdateAll();}

function _gp2UpdateLinks(){
  const el=document.getElementById('gp2LinkList');if(!el)return;
  let links=_sbGetLinks(_gp2.links);
  if(!links.length){
    links=[{name:'Canva',url:'https://www.canva.com',icon:'<img src=\"https://www.canva.com/favicon.ico\" width=\"14\" height=\"14\" style=\"vertical-align:middle\">'},{name:'웅쌤튜브',url:'https://www.youtube.com/@TUBE-sc1su',icon:'<img src=\"https://www.youtube.com/favicon.ico\" width=\"14\" height=\"14\" style=\"vertical-align:middle\">'}];
    _sbSaveLinks(links);
    _gp2.links=links;
  }
  if(!links.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:6px">제목을 클릭하여 사이트를 추가하세요</div>';return;}
  let h='';
  links.forEach(function(lk,i){
    h+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0">';
    h+='<span style="font-size:13px;display:inline-flex;align-items:center">'+(lk.icon||'🌐')+'</span>';
    h+='<a href="#" data-action="openExternal" data-arg="'+escHtml(lk.url)+'" style="flex:1;font-size:11px;color:var(--cyan);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(lk.url)+'">'+escHtml(lk.name)+'</a>';
    h+='<button data-action="deleteLink" data-arg="'+i+'" class="btn btn-outline btn-sm" style="font-size:9px;padding:1px 5px;opacity:0.5">✕</button>';
    h+='</div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}

function _gp2UpdateRoutines(){
  const el=document.getElementById('gp2RoutineList');if(!el)return;
  const routines=_sbGetRoutines(_gp2.routines);
  const todayKey='gp2rt_'+(_gp2.date||_gp2Today());
  const checks=JSON.parse(localStorage.getItem(todayKey)||'{}');
  if(!routines.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:6px">매일 반복할 루틴을 추가하세요</div>';return;}
  let h='';
  routines.forEach(function(rt,i){
    const checked=!!checks[i];
    h+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0">';
    h+='<input type="checkbox"'+(checked?' checked':'')+' data-action="toggleRoutine" data-arg="'+i+'" style="cursor:pointer;accent-color:var(--cyan)">';
    h+='<span style="flex:1;font-size:11px;color:'+(checked?'var(--t3)':'var(--t1)')+';'+(checked?'text-decoration:line-through':'')+'">'+escHtml(rt)+'</span>';
    h+='<button data-action="deleteRoutine" data-arg="'+i+'" class="btn btn-outline btn-sm" style="font-size:9px;padding:1px 5px;opacity:0.5">✕</button>';
    h+='</div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}

function _gp2UpdateGlobalTodos(){
  const el=document.getElementById('gp2GlobalTodoList');if(!el)return;
  const gtodos=_sbGetGlobalTodos(_gp2.globalTodos);
  if(!gtodos.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:6px">할 일을 추가하세요</div>';return;}
  let h='';
  gtodos.forEach(function(t,i){
    h+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;'+(t.done?'opacity:0.5':'')+'">';
    h+='<input type="checkbox"'+(t.done?' checked':'')+' data-action="toggleGlobalTodo" data-arg="'+i+'" style="cursor:pointer;accent-color:var(--cyan)">';
    h+='<span style="flex:1;font-size:11px;color:var(--t1);'+(t.done?'text-decoration:line-through;color:var(--t3)':'')+'">'+escHtml(t.text)+'</span>';
    h+='<button data-action="deleteGlobalTodo" data-arg="'+i+'" class="btn btn-outline btn-sm" style="font-size:9px;padding:1px 5px;opacity:0.5">✕</button>';
    h+='</div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}

function _gp2UpdateDayContent(){
  const d=_gp2.date||_gp2Today();
  const data=_gp2Load(d);
  /* 날짜 헤더 */
  const hdr=document.getElementById('gp2SelectedDateHeader');
  if(hdr){
    const dp=d.split('-');const dt=new Date(+dp[0],+dp[1]-1,+dp[2]);
    const dow=['일','월','화','수','목','금','토'][dt.getDay()];
    hdr.textContent='📅 '+parseInt(dp[1])+'월 '+parseInt(dp[2])+'일 ('+dow+')'+(d===_gp2Today()?' — 오늘':'');
  }
  /* 일정 */
  const evEl=document.getElementById('gp2DayEvents');
  if(evEl){
    const events=_gp2.events[d]||[];
    if(events.length){
      let h='';
      events.forEach(function(ev){
        const time=ev.start&&ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'}):'종일';
        const evColor=ev._calColor||'#3b82f6';
        h+='<div style="font-size:11px;padding:4px 6px;margin-bottom:3px;border-radius:4px;background:'+evColor+'12;border-left:3px solid '+evColor+'">';
        h+='<span style="color:'+evColor+';font-weight:700;margin-right:6px">'+time+'</span>'+escHtml(ev.summary||'')+'</div>';
      });
      evEl.innerHTML=h;
    } else {
      evEl.innerHTML = (typeof createEmptyState==='function')
        ? createEmptyState({icon:'📅',title:'일정 없음',desc:'이 날짜에 등록된 일정이 없습니다.'})
        : '<div style="font-size:10px;color:var(--t3)">이 날짜에 일정이 없습니다</div>';
    }
  }
  /* 할 일 */
  const todoEl=document.getElementById('gp2TodoList');
  if(todoEl){
    if(!data.todos.length){
      todoEl.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:10px">+ 추가를 눌러 할 일을 추가하세요</div>';
    } else {
      let h='';
      data.todos.forEach(function(t,idx){
        h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid var(--bdrl);'+(t.done?'opacity:0.5':'')+'">';
        h+='<input type="checkbox"'+(t.done?' checked':'')+' data-action="toggleTodo" data-arg="'+idx+'" style="cursor:pointer;width:16px;height:16px;accent-color:var(--cyan)">';
        h+='<input class="form-input" value="'+escHtml(t.text)+'" data-action="updateTodo" data-arg="'+idx+'" style="flex:1;font-size:12px;border:none;background:transparent;color:var(--t1);padding:2px 0;'+(t.done?'text-decoration:line-through':'') +'" placeholder="할 일 입력...">';
        if(t.completedAt)h+='<span style="font-size:9px;color:var(--t3)">✓'+t.completedAt+'</span>';
        h+='<button data-action="deleteTodo" data-arg="'+idx+'" style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.4" data-hover-opacity="1" data-rest-opacity="0.4">✕</button>';
        h+='</div>';
      });
      todoEl.innerHTML=h;
      _gp2SetupDelegation(todoEl);
    }
  }
  /* 메모 */
  const memoEl=document.getElementById('gp2Memo');
  if(memoEl&&memoEl!==document.activeElement){
    memoEl.value=data.memo||'';
  }
  /* 이월 알림 */
  const carryEl=document.getElementById('gp2CarryOver');
  if(carryEl){
    const yesterday=_gp2PrevDateStr(d);
    const yData=_gp2Load(yesterday);
    const yPending=yData.todos.filter(function(t){return !t.done;});
    if(yPending.length&&d===_gp2Today()){
      let h='<div class="cc" style="padding:10px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.06)">';
      h+='<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:6px">⚠️ 어제 미완료 ('+yPending.length+'건)</div>';
      yPending.forEach(function(t){
        h+='<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;color:var(--t2)">';
        h+='<span>'+escHtml(t.text)+'</span>';
        h+='<button data-action="carryOver" data-arg="'+escHtml(t.text)+'" class="btn btn-outline btn-sm" style="font-size:9px;padding:2px 8px;color:#f59e0b;border-color:#f59e0b">오늘로 이월</button>';
        h+='</div>';
      });
      h+='</div>';
      carryEl.innerHTML=h;
      _gp2SetupDelegation(carryEl);
    } else {
      carryEl.innerHTML='';
    }
  }
}

export function _gp2GoToday(){_gp2.date=_gp2Today();_gp2UpdateAll();_gp2FetchEvents();}

/* 위젯 초기화 함수들 (placeholder) */
let _gp2QuoteTimer=null;
function _gp2InitQuote(){
  const defaults=['교육은 양동이를 채우는 것이 아니라, 불을 지피는 것이다.|예이츠','아이들은 우리가 가르치는 대로가 아니라, 우리가 사는 대로 배운다.','좋은 교사는 희망을 불어넣는다.','건강은 스스로 지키는 것이 아닌, 모두가 함께 돌봐야 하는 것이다.','보건교사의 하루는 예측할 수 없지만, 그래서 더 의미가 있다.','작은 관심이 큰 건강을 만든다.','학교는 아이들이 가장 오래 머무는 곳, 건강한 환경이 곧 교육이다.'];
  const custom=JSON.parse(localStorage.getItem('gp2_custom_quotes')||'[]');
  const quotes=custom.length?custom:defaults;
  const intervalStr=localStorage.getItem('gp2_quote_interval')||'00:10';
  const ip=intervalStr.split(':');let intervalMs=(parseInt(ip[0]||0)*60+parseInt(ip[1]||10))*1000;
  if(intervalMs<3000)intervalMs=3000;
  let idx=0;
  function show(){
    const el=document.getElementById('gp2QuoteText');if(!el)return;
    const q=quotes[idx%quotes.length];
    const sep=q.indexOf('|');
    const text=sep!==-1?q.substring(0,sep):q;
    const person=sep!==-1?q.substring(sep+1):'';
    el.innerHTML='<div>'+escHtml(text)+(person?'<div style="text-align:right;font-size:10px;color:var(--t3);margin-top:4px;font-style:normal">— '+escHtml(person)+'</div>':'')+'</div>';
    idx++;
  }
  show();
  if(_gp2QuoteTimer)clearInterval(_gp2QuoteTimer);
  _gp2QuoteTimer=setInterval(show,intervalMs);
}
function _gp2InitDday(){
  const el=document.getElementById('gp2DdayList');if(!el)return;
  const ddays=JSON.parse(localStorage.getItem('gp2_ddays')||'[]');
  let h='';const now=new Date();now.setHours(0,0,0,0);
  ddays.forEach(function(dd,i){
    const target=new Date(dd.date);target.setHours(0,0,0,0);
    const diff=Math.ceil((target-now)/(1000*60*60*24));
    const label=diff>0?'D-'+diff:diff===0?'D-Day':'D+'+Math.abs(diff);
    h+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px"><span style="font-weight:700;color:'+(diff<=0?'var(--rs)':'var(--cyan)')+'">'+label+'</span><span style="color:var(--t1)">'+escHtml(dd.name)+'</span><button data-action="deleteDday" data-arg="'+i+'" style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:10px;opacity:0.4;margin-left:auto" data-hover-opacity="1" data-rest-opacity="0.4">✕</button></div>';
  });
  el.innerHTML=h||'<div style="font-size:10px;color:var(--t3)">D-Day를 추가하세요</div>';
  _gp2SetupDelegation(el);
}
function _gp2AddDday(){
  _gp2Prompt('D-Day 추가','이름 (예: 여름방학)','',function(name){
    if(!name)return;
    _gp2ShowDatePicker('D-Day 날짜 선택','',function(ds){
      const ddays=JSON.parse(localStorage.getItem('gp2_ddays')||'[]');
      ddays.push({name:name,date:ds});
      localStorage.setItem('gp2_ddays',JSON.stringify(ddays));
      _gp2InitDday();
    });
  });
}
function _gp2DeleteDday(i){
  const ddays=JSON.parse(localStorage.getItem('gp2_ddays')||'[]');
  ddays.splice(i,1);
  localStorage.setItem('gp2_ddays',JSON.stringify(ddays));
  _gp2InitDday();
}
function _gp2InitShop(){
  const el=document.getElementById('gp2ShopList');if(!el)return;
  const items=JSON.parse(localStorage.getItem('gp2_shop')||'[]');
  let h='';
  items.forEach(function(item,i){
    h+='<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px"><input type="checkbox"'+(item.done?' checked':'')+' data-action="toggleShop" data-arg="'+i+'" style="accent-color:var(--cyan)"><span style="color:var(--t1);'+(item.done?'text-decoration:line-through;opacity:0.5':'')+'">'+escHtml(item.text)+'</span><button data-action="deleteShop" data-arg="'+i+'" style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:10px;opacity:0.4;margin-left:auto" data-hover-opacity="1" data-rest-opacity="0.4">✕</button></div>';
  });
  el.innerHTML=h||'<div style="font-size:10px;color:var(--t3)">구매할 물건을 추가하세요</div>';
  _gp2SetupDelegation(el);
}
function _gp2AddShopItem(){
  _gp2Prompt('구매 목록 추가','물품명','',function(text){
    if(!text)return;
    const items=JSON.parse(localStorage.getItem('gp2_shop')||'[]');
    items.push({text:text,done:false});
    localStorage.setItem('gp2_shop',JSON.stringify(items));
    _gp2InitShop();
  },{noCancel:true});
}
function _gp2ToggleShop(i){
  const items=JSON.parse(localStorage.getItem('gp2_shop')||'[]');
  if(items[i])items[i].done=!items[i].done;
  localStorage.setItem('gp2_shop',JSON.stringify(items));
  _gp2InitShop();
}
function _gp2DeleteShop(i){
  const items=JSON.parse(localStorage.getItem('gp2_shop')||'[]');
  items.splice(i,1);
  localStorage.setItem('gp2_shop',JSON.stringify(items));
  _gp2InitShop();
}
/* ── 타이머 ── */
let _gp2TimerInterval=null, _gp2TimerSeconds=0, _gp2TimerRunning=false;
/* ── 계산기 ── */
function _gp2Calc(){
  const inp=document.getElementById('gp2CalcInput');
  const res=document.getElementById('gp2CalcResult');
  if(!inp||!res)return;
  try{
    let expr=inp.value.replace(/[^0-9+\-*/.()% ]/g,'').trim();
    if(!expr||/[^0-9+\-*/.()% ]/.test(expr)){res.textContent='오류';return;}
    /* %를 /100으로 변환 후 안전한 토큰 파싱 */
    expr=expr.replace(/(\d+(\.\d+)?)%/g,'($1/100)');
    /* 안전한 문자만 포함되었는지 최종 검증 */
    if(!/^[0-9+\-*/.() ]+$/.test(expr)){res.textContent='오류';return;}
    const v=Function('"use strict";return ('+expr+')')();
    if(typeof v!=='number'||!isFinite(v)){res.textContent='오류';return;}
    res.textContent='= '+v;
  } catch(e){res.textContent='오류';}
}
/* ── 방문 통계 ── */
/* ── 자주 거는 전화 ── */
function _gp2InitPhone(){
  const el=document.getElementById('gp2PhoneList');if(!el)return;
  const phones=JSON.parse(localStorage.getItem('gp2_phones')||'[]');
  if(!phones.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:6px">전화번호를 추가하세요</div>';return;}
  let h='';
  phones.forEach(function(p,i){
    h+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px">';
    h+='<span style="color:var(--t1);font-weight:600;flex:1">'+escHtml(p.name)+'</span>';
    h+='<span style="color:var(--cyan);cursor:pointer" data-action="copyPhone" data-arg="'+escHtml(p.num)+'" title="클릭하여 복사">'+escHtml(p.num)+'</span>';
    h+='<button data-action="deletePhone" data-arg="'+i+'" style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:10px;opacity:0.4" data-hover-opacity="1" data-rest-opacity="0.4">✕</button>';
    h+='</div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}
function _gp2AddPhone(){
  _gp2PromptMulti('업무 연락처 추가',[{label:'이름/장소',placeholder:'예: 교무실'},{label:'전화번호',placeholder:'예: 031-000-0000'}],function(vals){
    if(!vals||!vals[0])return;
    const phones=JSON.parse(localStorage.getItem('gp2_phones')||'[]');
    phones.push({name:vals[0],num:vals[1]||''});
    localStorage.setItem('gp2_phones',JSON.stringify(phones));
    _gp2InitPhone();
  },{noCancel:true});
}
function _gp2DeletePhone(i){
  const phones=JSON.parse(localStorage.getItem('gp2_phones')||'[]');
  phones.splice(i,1);
  localStorage.setItem('gp2_phones',JSON.stringify(phones));
  _gp2InitPhone();
}

/* ── 환율 ── */
function _gp2InitExchange(){
  const el=document.getElementById('gp2ExchangeResult');if(!el)return;
  el.innerHTML='<div style="font-size:10px;color:var(--t3)">환율 조회 중...</div>';
  window.electronAPI.externalFetchExchange().then(function(res){
    if(!res.success){el.innerHTML='<div style="font-size:10px;color:var(--rs)">조회 실패'+(res.error?': '+escHtml(String(res.error)):'')+'</div>';return;}
    const d=res.data;
    el.innerHTML='<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px">'
      +'<div>🇺🇸 USD <b style="color:var(--cyan)">'+(d.usd||'?')+'</b>원</div>'
      +'<div>🇪🇺 EUR <b style="color:var(--cyan)">'+(d.eur||'?')+'</b>원</div>'
      +'<div>🇯🇵 JPY(100) <b style="color:var(--cyan)">'+(d.jpy||'?')+'</b>원</div>'
      +'<div>🇨🇳 CNY <b style="color:var(--cyan)">'+(d.cny||'?')+'</b>원</div>'
      +'</div><div style="font-size:8px;color:var(--t3);margin-top:4px">'+escHtml(d.date)+'</div>';
  }).catch(function(err){el.innerHTML='<div style="font-size:10px;color:var(--rs)">조회 실패: '+escHtml(String(err.message||'알 수 없는 오류'))+'</div>';});
}

/* ── 주식 ── */
function _gp2LoadStock(){
  const inp=document.getElementById('gp2StockTicker');
  const el=document.getElementById('gp2StockResult');
  if(!inp||!el)return;
  const ticker=inp.value.trim();if(!ticker)return;
  localStorage.setItem('gp2_stock_ticker',ticker);
  el.innerHTML='<div style="font-size:10px;color:var(--t3)">조회 중...</div>';
  window.electronAPI.externalFetchStock(ticker).then(function(res){
    if(!res.success){el.innerHTML='<div style="font-size:10px;color:var(--rs)">'+escHtml(String(res.error||'조회 실패'))+'</div>';return;}
    const d=res.data;
    const bgColor=d.up?'rgba(34,197,94,0.06)':'rgba(239,68,68,0.06)';
    const borderColor=d.up?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)';
    el.innerHTML='<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:4px 6px;border-radius:6px;background:'+bgColor+';border:1px solid '+borderColor+'">'
      +'<span style="color:'+(d.up?'#22c55e':'#ef4444')+';font-weight:800;font-size:10px">'+escHtml(d.ticker)+'</span>'
      +'<span style="color:var(--t1);font-weight:700;flex:1">'+escHtml(d.name)+'</span>'
      +'<span style="font-weight:800;color:var(--t1)">'+d.price.toLocaleString()+'</span>'
      +'<span style="font-weight:700;color:'+(d.up?'#22c55e':'#ef4444')+'">'+(d.up?'▲':'▼')+Math.abs(d.change)+'%</span>'
      +'</div>';
  }).catch(function(err){el.innerHTML='<div style="font-size:10px;color:var(--rs)">조회 실패: '+escHtml(String(err.message||'알 수 없는 오류'))+'</div>';});
}
function _gp2InitStock(){
  const ticker=localStorage.getItem('gp2_stock_ticker');
  if(ticker)_gp2LoadStock();
}

/* ── WAQI 미세먼지 ── */

/* ── 에어코리아 미세먼지 ── */
function _gp2LoadAirkorea(){
  const keyEl=document.getElementById('gp2AirkoreaKey');
  const stationEl=document.getElementById('gp2AirkoreaStation');
  const resultEl=document.getElementById('gp2AirkoreaResult');
  if(!keyEl||!stationEl||!resultEl)return;
  const key=keyEl.value.trim();
  const station=stationEl.value.trim();
  if(!key){resultEl.innerHTML='<div style="font-size:10px;color:var(--rs)">API 키를 입력해 주세요</div>';return;}
  if(!station){resultEl.innerHTML='<div style="font-size:10px;color:var(--rs)">측정소명을 입력해 주세요</div>';return;}
  localStorage.setItem('gp2_airkorea_key',key);
  localStorage.setItem('gp2_airkorea_station',station);
  resultEl.innerHTML='<div style="font-size:10px;color:var(--t3)">조회 중...</div>';
  window.electronAPI.externalFetchAirkorea(key,station).then(function(res){
    if(!res.success){resultEl.innerHTML='<div style="font-size:10px;color:var(--rs)">'+escHtml(String(res.error||'조회 실패'))+'</div>';return;}
    const item=res.data;
    const pm10=item.pm10||'-';
    const pm25=item.pm25||'-';
    const pm25Num=parseInt(pm25)||0;
    const pm10Num=parseInt(pm10)||0;
    const pm25Tip='좋음: 0~15 / 보통: 16~35 / 나쁨: 36~75 / 매우나쁨: 76~';
    const pm10Tip='좋음: 0~30 / 보통: 31~80 / 나쁨: 81~150 / 매우나쁨: 151~';
    /* PM2.5 등급 색상 */
    const pm25Color=pm25Num<=15?'#22c55e':pm25Num<=35?'#06b6d4':pm25Num<=75?'#f59e0b':'#ef4444';
    const pm25Grade=pm25Num<=15?'좋음':pm25Num<=35?'보통':pm25Num<=75?'나쁨':'매우나쁨';
    /* PM10 등급 색상 */
    const pm10Color=pm10Num<=30?'#22c55e':pm10Num<=80?'#06b6d4':pm10Num<=150?'#f59e0b':'#ef4444';
    const pm10Grade=pm10Num<=30?'좋음':pm10Num<=80?'보통':pm10Num<=150?'나쁨':'매우나쁨';
    resultEl.innerHTML='<div style="font-size:10px;color:var(--t2);margin-bottom:4px;font-weight:600">'+escHtml(station)+' · '+escHtml(item.dataTime||'')+' 📍</div>'
      +'<div style="display:flex;gap:12px;align-items:center">'
      +'<div style="text-align:center;cursor:help" title="'+pm25Tip+'"><div style="font-size:9px;color:var(--t3)">PM2.5</div><div style="font-size:18px;font-weight:800;color:'+pm25Color+'">'+pm25+'</div><div style="font-size:9px;font-weight:700;color:'+pm25Color+'">'+pm25Grade+'</div></div>'
      +'<div style="text-align:center;cursor:help" title="'+pm10Tip+'"><div style="font-size:9px;color:var(--t3)">PM10</div><div style="font-size:18px;font-weight:800;color:'+pm10Color+'">'+pm10+'</div><div style="font-size:9px;font-weight:700;color:'+pm10Color+'">'+pm10Grade+'</div></div>'
      +'</div>'
      +'<div style="font-size:7px;color:var(--t3);margin-top:4px;opacity:0.6">마우스를 올리면 기준 범위를 확인할 수 있습니다</div>';
    /* 입력란 숨기기 */
    const setup=document.getElementById('gp2AirkoreaSetup');if(setup)setup.style.display='none';
    const sbtn=document.getElementById('gp2AirkoreaSettingsBtn');if(sbtn)sbtn.style.display='';
  }).catch(function(err){
    resultEl.innerHTML='<div style="font-size:10px;color:var(--rs)">조회 실패: '+escHtml(String(err.message||'알 수 없는 오류'))+'</div>';
  });
}


/* ── 자유 메모장 (복수 메모) ── */
const _gp2NoteColors=['#fce7f3','#fef9c3','#ede9fe','#d1fae5','#ffedd5','#dbeafe'];
const _gp2NoteBorders=['#f9a8d4','#fde047','#c4b5fd','#86efac','#fdba74','#93c5fd'];
function _gp2InitNotepad(){
  const el=document.getElementById('gp2NotepadList');if(!el)return;
  const notes=JSON.parse(localStorage.getItem('gp2_notes')||'[]');
  if(!notes.length){const old=localStorage.getItem('gp2_notepad');if(old){notes.push({text:old,ts:new Date().toISOString().substring(0,10)});localStorage.setItem('gp2_notes',JSON.stringify(notes));}}
  if(!notes.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:10px">＋ 버튼 또는 제목을 클릭하여 메모를 추가하세요</div>';return;}
  let h='';
  notes.forEach(function(note,i){
    const ci=i%_gp2NoteColors.length;
    h+='<div class="gp2-note" style="position:relative;background:'+_gp2NoteColors[ci]+';border:1px solid '+_gp2NoteBorders[ci]+';border-radius:8px;padding:8px 10px;margin-bottom:6px;transition:all 0.15s">';
    h+='<textarea style="width:100%;border:none;background:transparent;font-size:11px;line-height:1.6;resize:vertical;min-height:36px;color:#1e293b;font-family:var(--f);outline:none" data-action="saveNote" data-arg="'+i+'">'+escHtml(note.text)+'</textarea>';
    h+='<div style="font-size:8px;color:#94a3b8;margin-top:1px">'+(note.ts||'')+'</div>';
    h+='<span class="gp2-note-del" data-action="deleteNote" data-arg="'+i+'" style="position:absolute;top:4px;right:6px;cursor:pointer;font-size:12px;opacity:0;transition:opacity 0.15s" title="삭제">🗑️</span>';
    h+='</div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
  /* Note hover: show/hide delete button */
  el.querySelectorAll('.gp2-note').forEach(function(note){
    const del=note.querySelector('.gp2-note-del');
    if(!del)return;
    note.addEventListener('mouseenter',function(){del.style.opacity=1;});
    note.addEventListener('mouseleave',function(){del.style.opacity=0;});
  });
}
function _gp2AddNote(){
  const notes=JSON.parse(localStorage.getItem('gp2_notes')||'[]');
  notes.unshift({text:'',ts:new Date().toISOString().substring(0,10)});
  localStorage.setItem('gp2_notes',JSON.stringify(notes));
  _gp2InitNotepad();
  /* 새 메모에 포커스 */
  setTimeout(function(){const ta=document.querySelector('#gp2NotepadList textarea');if(ta)ta.focus();},50);
}
function _gp2SaveNote(i,val){
  const notes=JSON.parse(localStorage.getItem('gp2_notes')||'[]');
  if(notes[i])notes[i].text=val;
  localStorage.setItem('gp2_notes',JSON.stringify(notes));
}
function _gp2DeleteNote(i){
  _gp2Confirm('이 메모를 삭제하시겠습니까?',function(yes){
    if(!yes)return;
    const notes=JSON.parse(localStorage.getItem('gp2_notes')||'[]');
    notes.splice(i,1);
    localStorage.setItem('gp2_notes',JSON.stringify(notes));
    _gp2InitNotepad();
  });
}

/* ── 연락처 변환기 ── */
let _gp2ContactsData=[];
function _gp2InitContacts(){
  const zone=document.getElementById('gp2ContactsUploadZone');
  const fileInput=document.getElementById('gp2ContactsFile');
  const textarea=document.getElementById('gp2ContactsInput');
  if(!zone)return;
  zone.addEventListener('click',function(){if(fileInput)fileInput.click();});
  zone.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
  zone.addEventListener('dragleave',function(){this.style.borderColor='var(--bdr)';});
  zone.addEventListener('drop',function(e){e.preventDefault();this.style.borderColor='var(--bdr)';if(e.dataTransfer.files.length)_gp2ContactsLoadFile(e.dataTransfer.files[0]);});
  if(fileInput)fileInput.addEventListener('change',function(){if(this.files.length)_gp2ContactsLoadFile(this.files[0]);});
  /* 텍스트 붙여넣기 영역 표시 */
  zone.addEventListener('dblclick',function(){if(textarea)textarea.style.display='block';});
  if(textarea)textarea.addEventListener('input',function(){_gp2ContactsParseText(this.value);});
  /* 형식 선택 이벤트 */
  const fmt=document.getElementById('gp2ContactsFormat');
  const customFmt=document.getElementById('gp2ContactsCustomFmt');
  if(fmt)fmt.addEventListener('change',function(){if(customFmt)customFmt.style.display=this.value==='custom'?'block':'none';});
  const csvBtn=document.getElementById('gp2ContactsCsvBtn');
  if(csvBtn)csvBtn.addEventListener('click',_gp2ContactsExportCSV);
}
function _gp2ContactsLoadFile(file){
  if(file.name.match(/\.xlsx?$/i)){
    /* SheetJS로 엑셀 파싱 */
    const reader=new FileReader();
    reader.onload=function(e){
      try{
        const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const data=XLSX.utils.sheet_to_json(ws,{header:1});
        _gp2ContactsProcessData(data);
      }catch(err){
        const zone=document.getElementById('gp2ContactsUploadZone');
        if(zone){zone.innerHTML='<div style="color:var(--rs);font-size:10px">파일 읽기 실패: '+escHtml(String(err.message||'알 수 없는 오류'))+'</div>';}
      }
    };
    reader.readAsArrayBuffer(file);
  } else if(file.name.match(/\.csv$/i)){
    const reader2=new FileReader();
    reader2.onload=function(e){
      const lines=e.target.result.split('\n').map(function(l){return l.split(',').map(function(c){return c.replace(/^"|"$/g,'').trim();});});
      _gp2ContactsProcessData(lines);
    };
    reader2.readAsText(file);
  }
}
function _gp2ContactsParseText(text){
  if(!text.trim())return;
  const lines=text.trim().split('\n').map(function(l){return l.split('\t');});
  _gp2ContactsProcessData(lines);
}
function _gp2ContactsProcessData(data){
  if(!data||!data.length)return;
  _gp2ContactsData=[];
  /* 헤더 감지 */
  const headers=data[0].map(function(h){return String(h||'').trim();});
  let nameIdx=-1, posIdx=-1, phoneIdx=-1, deptIdx=-1;
  headers.forEach(function(h,i){
    const hl=h.toLowerCase();
    if(hl.match(/이름|성명|name/))nameIdx=i;
    if(hl.match(/직위|직책|position/))posIdx=i;
    if(hl.match(/전화|연락|phone|tel/))phoneIdx=i;
    if(hl.match(/부서|소속|dept/))deptIdx=i;
  });
  if(nameIdx===-1)nameIdx=0;
  const startRow=(headers.some(function(h){return h.match(/이름|성명|직위|전화/);}))?1:0;
  for(let r=startRow;r<data.length;r++){
    const row=data[r];if(!row||!row[nameIdx])continue;
    _gp2ContactsData.push({
      name:String(row[nameIdx]||'').trim(),
      position:posIdx>=0?String(row[posIdx]||'').trim():'',
      phone:phoneIdx>=0?String(row[phoneIdx]||'').trim():'',
      dept:deptIdx>=0?String(row[deptIdx]||'').trim():''
    });
  }
  _gp2ContactsRenderTable();
}
function _gp2ContactsRenderTable(){
  const el=document.getElementById('gp2ContactsTable');if(!el)return;
  if(!_gp2ContactsData.length){el.innerHTML='';return;}
  let h='<table style="width:100%;border-collapse:collapse;font-size:9px;border:1px solid var(--bdr);border-radius:6px;overflow:hidden">';
  h+='<tr style="background:var(--bg2)"><th style="padding:3px 5px;text-align:left;color:var(--t3)">이름</th><th style="padding:3px 5px;color:var(--t3)">직위</th><th style="padding:3px 5px;color:var(--t3)">전화</th></tr>';
  _gp2ContactsData.forEach(function(c){
    h+='<tr style="border-top:1px solid var(--bdrl)"><td style="padding:3px 5px;font-weight:600;color:var(--t1)">'+escHtml(c.name)+'</td><td style="padding:3px 5px;color:var(--t2)">'+escHtml(c.position)+'</td><td style="padding:3px 5px;color:var(--t3)">'+escHtml(c.phone)+'</td></tr>';
  });
  h+='</table>';
  h+='<div style="font-size:9px;color:var(--t3);margin-top:4px">'+_gp2ContactsData.length+'명 인식됨</div>';
  el.innerHTML=h;
  /* 내보내기 영역 표시 */
  const exp=document.getElementById('gp2ContactsExport');if(exp)exp.style.display='block';
  const zone=document.getElementById('gp2ContactsUploadZone');if(zone)zone.style.display='none';
}
function _gp2ContactsExportCSV(){
  if(!_gp2ContactsData.length)return;
  const fmt=document.getElementById('gp2ContactsFormat');
  const customFmt=document.getElementById('gp2ContactsCustomFmt');
  const format=fmt?fmt.value:'name_pos_school';
  const customStr=customFmt?customFmt.value:'';
  /* 사용자 학교명 가져오기 */
  const userSettings=JSON.parse(localStorage.getItem('ec_settings')||'{}');
  const school=userSettings.schoolName||'';
  let csv='Name,Phone 1 - Value,Organization 1 - Name,Organization 1 - Title\n';
  _gp2ContactsData.forEach(function(c){
    let displayName='';
    if(format==='name_pos_school')displayName=c.name+(c.position||school?' ('+[c.position,school].filter(Boolean).join(', ')+')':'');
    else if(format==='school_name_pos')displayName=[school,c.name,c.position].filter(Boolean).join(' ');
    else if(format==='name_school_pos')displayName=c.name+(school||c.position?' ('+[school,c.position].filter(Boolean).join(' ')+')':'');
    else if(format==='custom')displayName=customStr.replace('{이름}',c.name).replace('{직위}',c.position).replace('{학교}',school).replace('{부서}',c.dept||'');
    csv+='"'+displayName.replace(/"/g,'""')+'","'+c.phone+'","'+school+'","'+c.position+'"\n';
  });
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='contacts_'+new Date().toISOString().substring(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  _gp2ShowSaveToast();
}

/* ── 업무 진척도 B형 (체크리스트) ── */
function _gp2InitProgressB(){
  const el=document.getElementById('gp2ProgressBList');if(!el)return;
  const items=JSON.parse(localStorage.getItem('gp2_progressB')||'[]');
  if(!items.length){
    el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:8px">제목을 클릭하여 업무를 추가하세요<br><span style="font-size:9px">체크리스트 항목을 완료하면 자동으로 진척도가 계산됩니다</span></div>';
    return;
  }
  let h='';
  items.forEach(function(item,i){
    const done=item.checks.filter(function(c){return c.done;}).length;
    const total=item.checks.length;
    const pct=total?Math.round(done/total*100):0;
    const color=pct>=100?'#22c55e':pct>=50?'#06b6d4':pct>=25?'#f59e0b':'var(--t3)';
    h+='<div style="border-bottom:1px solid var(--bdrl);padding:6px 0">';
    h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
    h+='<span style="font-size:11px;font-weight:700;color:var(--t1);flex:1">'+escHtml(item.name)+'</span>';
    h+='<div style="display:flex;align-items:center;gap:3px;min-width:80px"><div style="flex:1;background:var(--bg2);border-radius:3px;height:6px;overflow:hidden"><div style="background:'+color+';width:'+pct+'%;height:100%;border-radius:3px"></div></div><span style="font-size:9px;font-weight:800;color:'+color+'">'+pct+'%</span></div>';
    h+='<span data-action="deleteProgressB" data-arg="'+i+'" style="cursor:pointer;font-size:10px;color:var(--t3);opacity:0.4" data-hover-opacity="1" data-rest-opacity="0.4">✕</span>';
    h+='</div>';
    item.checks.forEach(function(c,j){
      h+='<div style="display:flex;align-items:center;gap:5px;padding:1px 0;font-size:10px"><input type="checkbox"'+(c.done?' checked':'')+' data-action="toggleProgressB" data-arg="'+i+'" data-arg2="'+j+'" style="accent-color:var(--cyan)"><span style="color:var(--t1);'+(c.done?'text-decoration:line-through;opacity:0.5':'')+'">'+escHtml(c.text)+'</span></div>';
    });
    h+='</div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}
function _gp2AddProgressB(){
  _gp2Prompt('업무명','업무 제목','',function(name){
    if(!name)return;
    _gp2Prompt('체크리스트 (쉼표로 구분)','항목1, 항목2, 항목3','',function(checksStr){
      if(!checksStr)return;
      const checks=checksStr.split(',').map(function(s){return{text:s.trim(),done:false};}).filter(function(c){return c.text;});
      const items=JSON.parse(localStorage.getItem('gp2_progressB')||'[]');
      items.push({name:name,checks:checks});
      localStorage.setItem('gp2_progressB',JSON.stringify(items));
      _gp2InitProgressB();
    });
  });
}
function _gp2ToggleProgressB(i,j){
  const items=JSON.parse(localStorage.getItem('gp2_progressB')||'[]');
  if(items[i]&&items[i].checks[j])items[i].checks[j].done=!items[i].checks[j].done;
  localStorage.setItem('gp2_progressB',JSON.stringify(items));
  _gp2InitProgressB();_gp2ShowSaveToast();
}
function _gp2DeleteProgressB(i){
  _gp2Confirm('이 업무를 삭제하시겠습니까?',function(yes){
    if(!yes)return;
    const items=JSON.parse(localStorage.getItem('gp2_progressB')||'[]');
    items.splice(i,1);
    localStorage.setItem('gp2_progressB',JSON.stringify(items));
    _gp2InitProgressB();
  });
}

/* ── Google Drive JSON 백업 ── */
function _gp2InitDriveBackup(){
  const backupBtn=document.getElementById('gp2DriveBackupBtn');
  const restoreBtn=document.getElementById('gp2DriveRestoreBtn');
  const status=document.getElementById('gp2DriveStatus');
  if(backupBtn)backupBtn.addEventListener('click',_gp2DriveBackup);
  if(restoreBtn)restoreBtn.addEventListener('click',_gp2DriveRestore);
  /* 마지막 백업 시간 표시 */
  const lastBackup=localStorage.getItem('gp2_last_backup');
  if(status&&lastBackup)status.textContent='마지막 백업: '+lastBackup;
}
function _gp2DriveBackup(){
  const status=document.getElementById('gp2DriveStatus');
  if(status)status.textContent='백업 중...';
  /* 매직 스테이션 관련 localStorage 키 수집 */
  const data={};
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key.startsWith('gp2_')||key.startsWith('ec_gp2_')||key.startsWith('ec_magic_')||key==='gp2_widget_layout')
      data[key]=localStorage.getItem(key);
  }
  const json=JSON.stringify(data,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='magic_backup_'+new Date().toISOString().substring(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  const now=new Date().toLocaleString('ko');
  localStorage.setItem('gp2_last_backup',now);
  if(status)status.textContent='✅ 백업 완료: '+now;
  _gp2ShowSaveToast();
}
function _gp2DriveRestore(){
  const input=document.createElement('input');input.type='file';input.accept='.json';
  input.addEventListener('change',function(){
    if(!this.files.length)return;
    const reader=new FileReader();
    reader.onload=function(e){
      try{
        const data=JSON.parse(e.target.result);
        let count=0;
        Object.keys(data).forEach(function(key){localStorage.setItem(key,data[key]);count++;});
        const status=document.getElementById('gp2DriveStatus');
        if(status)status.textContent='✅ 복원 완료: '+count+'개 항목';
        _gp2ShowSaveToast();
      }catch(err){
        const status=document.getElementById('gp2DriveStatus');
        if(status)status.textContent='❌ 복원 실패: '+err.message;
      }
    };
    reader.readAsText(this.files[0]);
  });
  input.click();
}

/* ── 이미지 업로드 공통 ── */
function _gp2HandleImageFile(file,imgDiv,lsKey,zone){
  if(!file||!file.type.startsWith('image/'))return;
  const reader=new FileReader();
  reader.onload=function(e){
    if(imgDiv)imgDiv.innerHTML='<img src="'+e.target.result+'" style="width:100%;border-radius:6px;margin-top:6px">';
    if(zone)zone.style.display='none';
    try{localStorage.setItem(lsKey,e.target.result);}catch(err){/* 용량 초과 */}
  };
  reader.readAsDataURL(file);
}

/* ── 커스텀 프롬프트 (Electron에서 prompt() 미지원) ── */
function _gp2Prompt(title,placeholder,defaultVal,callback,opts){
  opts=opts||{};
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2PromptOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div style="width:380px;max-width:90vw;padding:0;background:var(--card);border:1px solid rgba(255,255,255,0.06);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.04) inset;animation:gp2PopIn 0.2s cubic-bezier(0.22,1,0.36,1) both;overflow:hidden">';
  h+='<div style="background:transparent;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.04)"><div style="font-size:13px;font-weight:700;color:var(--t1);letter-spacing:-0.2px">'+escHtml(title)+'</div></div>';
  h+='<div style="padding:16px 18px"><input class="form-input" id="gp2PromptInput" value="'+escHtml(defaultVal||'')+'" placeholder="'+(placeholder||'')+'" style="width:100%;font-size:12px;border-radius:8px;padding:10px 12px" autofocus></div>';
  h+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px 14px">';
  if(!opts.noCancel)h+='<button id="gp2PromptCancel" style="padding:7px 16px;font-size:11px;background:transparent;color:var(--t2);border:1px solid var(--bdr);border-radius:8px;cursor:pointer;font-family:var(--f);transition:all 0.15s" data-hover-bg="var(--hover)" data-rest-bg="transparent">취소</button>';
  h+='<button id="gp2PromptOk" style="padding:7px 20px;font-size:11px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 8px rgba(6,182,212,0.3);transition:all 0.15s">확인</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  _gp2DelegateHoverBg(ov);
  const okBtn=document.getElementById('gp2PromptOk');
  if(okBtn){okBtn.addEventListener('mouseenter',function(){this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(6,182,212,0.4)';});okBtn.addEventListener('mouseleave',function(){this.style.transform='';this.style.boxShadow='0 2px 8px rgba(6,182,212,0.3)';});}
  document.body.appendChild(ov);
  const inp=document.getElementById('gp2PromptInput');
  setTimeout(function(){if(inp)inp.focus();inp.select();},50);
  function done(val){closeModalGracefully(ov);if(callback)callback(val);}
  okBtn.addEventListener('click',function(){done(inp.value);});
  const cancelBtn=document.getElementById('gp2PromptCancel');if(cancelBtn)cancelBtn.addEventListener('click',function(){done(null);});
  inp.addEventListener('keydown',function(e){if(e.key==='Enter')done(inp.value);if(e.key==='Escape')done(null);});
  ov.addEventListener('click',function(e){if(e.target===ov)done(null);});
}
/* 다중 입력 프롬프트 */
function _gp2PromptMulti(title,fields,callback,opts){
  opts=opts||{};
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2PromptOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div class="modal-content" style="width:400px;max-width:90vw;padding:0">';
  h+='<div style="background:rgba(6,182,212,0.10);padding:10px 16px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0"><div style="font-size:13px;font-weight:700;color:var(--t1)">'+escHtml(title)+'</div></div>';
  h+='<div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">';
  fields.forEach(function(f,i){
    h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:2px">'+escHtml(f.label)+'</label><input class="form-input gp2-prompt-field" data-idx="'+i+'" value="'+escHtml(f.value||'')+'" placeholder="'+(f.placeholder||'')+'" style="width:100%;font-size:12px"></div>';
  });
  h+='</div>';
  h+='<div style="display:flex;justify-content:flex-end;gap:6px;padding:8px 16px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  if(!opts.noCancel)h+='<button id="gp2PromptCancel" style="padding:6px 14px;font-size:11px;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>';
  h+='<button id="gp2PromptOk" style="padding:6px 14px;font-size:11px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">확인</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  document.body.appendChild(ov);
  setTimeout(function(){const first=ov.querySelector('.gp2-prompt-field');if(first)first.focus();},50);
  function done(vals){closeModalGracefully(ov);if(callback)callback(vals);}
  document.getElementById('gp2PromptOk').addEventListener('click',function(){
    const vals=[];ov.querySelectorAll('.gp2-prompt-field').forEach(function(el){vals.push(el.value);});
    done(vals);
  });
  const cancelBtn=document.getElementById('gp2PromptCancel');if(cancelBtn)cancelBtn.addEventListener('click',function(){done(null);});
  ov.addEventListener('click',function(e){if(e.target===ov)done(null);});
}
/* 확인 팝업 */
function _gp2Confirm(msg,callback){
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2ConfirmOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div style="width:320px;max-width:90vw;padding:0;background:var(--card);border:1px solid rgba(255,255,255,0.06);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.04) inset;animation:gp2PopIn 0.2s cubic-bezier(0.22,1,0.36,1) both;overflow:hidden">';
  h+='<div style="padding:22px 20px 14px;font-size:13px;color:var(--t1);line-height:1.7;text-align:center;font-weight:500">'+escHtml(msg)+'</div>';
  h+='<div style="display:flex;justify-content:center;gap:10px;padding:10px 20px 16px">';
  h+='<button id="gp2ConfirmNo" style="padding:7px 18px;font-size:11px;background:transparent;color:var(--t2);border:1px solid var(--bdr);border-radius:8px;cursor:pointer;font-family:var(--f);transition:all 0.15s" data-hover-bg="var(--hover)" data-rest-bg="transparent">아니오</button>';
  h+='<button id="gp2ConfirmYes" style="padding:7px 18px;font-size:11px;font-weight:700;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 8px rgba(239,68,68,0.3);transition:all 0.15s">예</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  _gp2DelegateHoverBg(ov);
  const yesBtn=document.getElementById('gp2ConfirmYes');
  if(yesBtn){yesBtn.addEventListener('mouseenter',function(){this.style.transform='translateY(-1px)';});yesBtn.addEventListener('mouseleave',function(){this.style.transform='';});}
  document.body.appendChild(ov);
  yesBtn.addEventListener('click',function(){closeModalWithAnim(ov);callback(true);});
  document.getElementById('gp2ConfirmNo').addEventListener('click',function(){closeModalWithAnim(ov);callback(false);});
  ov.addEventListener('click',function(e){if(e.target===ov){closeModalGracefully(ov);callback(false);}});
}

/* ── 제목 클릭 핸들러 ── */
function _gp2OnTitleClick(type){
  if(type==='quicklinks')_gp2AddLink();
  else if(type==='routine')_gp2AddRoutine();
  else if(type==='todolist')_gp2AddGlobalTodo();
  else if(type==='dday')_gp2AddDday();
  else if(type==='shopping')_gp2AddShopItem();
  else if(type==='phonebook')_gp2AddPhone();
  else if(type==='progress')_gp2AddProgress();
  else if(type==='scrap')_gp2AddScrap();
  else if(type==='birthday')_gp2AddBirthday();
  else if(type==='quote')_gp2EditQuotes();
  else if(type==='notepad')_gp2AddNote();
  else if(type==='stock'){const s=document.getElementById('gp2StockSetup');if(s)s.style.display=s.style.display==='none'?'':'none';}
  else if(type==='dustAirkorea'){const s2=document.getElementById('gp2AirkoreaSetup');if(s2)s2.style.display=s2.style.display==='none'?'':'none';}
  else if(type==='progressB')_gp2AddProgressB();
  else if(type==='contacts'){const ta=document.getElementById('gp2ContactsInput');if(ta)ta.style.display=ta.style.display==='none'?'block':'none';}
}

/* ── 업무 진척도 ── */
function _gp2InitProgress(){
  const el=document.getElementById('gp2ProgressList');if(!el)return;
  const items=JSON.parse(localStorage.getItem('gp2_progress')||'[]');
  if(!items.length){
    el.innerHTML='<div style="font-size:9px;color:var(--t3);text-align:center;margin-bottom:4px">제목을 클릭하여 업무를 추가하세요</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:9px">'
      +'<tr style="background:var(--bg2)"><th style="padding:3px 5px;text-align:left;color:var(--t3)">업무</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">기간</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">우선</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">목표</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">완료</th><th style="padding:3px 5px;color:var(--t3)">진척도</th></tr>'
      +'<tr style="border-bottom:1px solid var(--bdrl);opacity:0.5;color:var(--t1)"><td style="padding:3px 5px;border-left:3px solid #06b6d4">블로그 글 작성</td><td style="padding:3px 5px;text-align:center;color:var(--t3)">3/29~4/2</td><td style="padding:3px 5px;text-align:center;color:#06b6d4;font-size:8px">보통</td><td style="padding:3px 5px;text-align:center;color:var(--t2)">10</td><td style="padding:3px 5px;text-align:center;font-weight:700">4</td><td style="padding:3px 5px"><div style="display:flex;align-items:center;gap:3px"><div style="flex:1;background:var(--bg2);border-radius:3px;height:5px"><div style="background:#f59e0b;width:40%;height:100%;border-radius:3px"></div></div><span style="font-size:8px;font-weight:800;color:#f59e0b">40%</span></div></td></tr>'
      +'<tr style="border-bottom:1px solid var(--bdrl);opacity:0.5;color:var(--t1)"><td style="padding:3px 5px;border-left:3px solid #ef4444">하루 60분 달리기</td><td style="padding:3px 5px;text-align:center;color:var(--t3)">3/25~3/31</td><td style="padding:3px 5px;text-align:center;color:#ef4444;font-size:8px">긴급</td><td style="padding:3px 5px;text-align:center;color:var(--t2)">7</td><td style="padding:3px 5px;text-align:center;font-weight:700">5</td><td style="padding:3px 5px"><div style="display:flex;align-items:center;gap:3px"><div style="flex:1;background:var(--bg2);border-radius:3px;height:5px"><div style="background:#06b6d4;width:71%;height:100%;border-radius:3px"></div></div><span style="font-size:8px;font-weight:800;color:#06b6d4">71%</span></div></td></tr>'
      +'<tr style="opacity:0.5;color:var(--t1)"><td style="padding:3px 5px;border-left:3px solid #22c55e">하루 50분 독서</td><td style="padding:3px 5px;text-align:center;color:var(--t3)">3/20~4/20</td><td style="padding:3px 5px;text-align:center;color:#22c55e;font-size:8px">낮음</td><td style="padding:3px 5px;text-align:center;color:var(--t2)">32</td><td style="padding:3px 5px;text-align:center;font-weight:700">32</td><td style="padding:3px 5px"><div style="display:flex;align-items:center;gap:3px"><div style="flex:1;background:var(--bg2);border-radius:3px;height:5px"><div style="background:#22c55e;width:100%;height:100%;border-radius:3px"></div></div><span style="font-size:8px;font-weight:800;color:#22c55e">100%</span></div></td></tr>'
      +'</table>'
      +'<div style="font-size:8px;color:var(--t3);text-align:center;margin-top:3px;opacity:0.5">↑ 예시 (업무 추가 시 사라집니다)</div>';
    return;
  }
  const now=new Date();now.setHours(0,0,0,0);
  /* 표 형식 */
  let h='<table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:8px">';
  h+='<tr style="background:var(--bg2)"><th style="padding:3px 4px;text-align:left;color:var(--t2)">업무</th><th style="padding:3px 4px;text-align:center;color:var(--t2)">기간</th><th style="padding:3px 4px;text-align:center;color:var(--t2)">우선</th><th style="padding:3px 4px;text-align:center;color:var(--t2)">목표</th><th style="padding:3px 4px;text-align:center;color:var(--t2)">완료</th><th style="padding:3px 4px;text-align:center;color:var(--t2)">진척도</th><th style="padding:3px 4px;color:var(--t2)"></th></tr>';
  items.forEach(function(item,i){
    const start=new Date(item.startDate);const end=new Date(item.endDate);
    const totalDays=Math.max(1,Math.ceil((end-start)/(86400000))+1);
    const target=item.dailyCount?totalDays*item.dailyCount:item.target||0;
    const done=item.done||0;
    const pct=target?Math.min(100,Math.round(done/target*100)):0;
    const pri=item.priority||'보통';
    const priColor=pri==='긴급'?'#ef4444':pri==='높음'?'#f59e0b':pri==='보통'?'#06b6d4':'#22c55e';
    const pctColor=pct>=100?'#22c55e':pct>=50?'#06b6d4':pct>=25?'#f59e0b':'var(--t3)';
    h+='<tr style="border-bottom:1px solid var(--bdrl)">';
    h+='<td style="padding:3px 4px;font-weight:600;color:var(--t1);border-left:3px solid '+priColor+'">'+escHtml(item.name)+'</td>';
    h+='<td style="padding:3px 4px;text-align:center;color:var(--t3)">'+item.startDate.substring(5)+'~'+item.endDate.substring(5)+'</td>';
    h+='<td style="padding:3px 4px;text-align:center"><span style="color:'+priColor+';font-weight:700;font-size:8px">'+pri+'</span></td>';
    h+='<td style="padding:3px 4px;text-align:center;color:var(--t2)">'+target+'</td>';
    h+='<td style="padding:3px 4px;text-align:center;color:var(--cyan);font-weight:700;cursor:pointer;text-decoration:underline" data-action="editProgress" data-arg="'+i+'" title="클릭하여 수정">'+done+'</td>';
    h+='<td style="padding:3px 4px;min-width:60px"><div style="display:flex;align-items:center;gap:3px"><div style="flex:1;background:var(--bg2);border-radius:3px;height:6px;overflow:hidden"><div style="background:'+pctColor+';width:'+pct+'%;height:100%;border-radius:3px"></div></div><span style="font-size:8px;font-weight:800;color:'+pctColor+'">'+pct+'%</span></div></td>';
    h+='<td style="padding:3px 2px"><span data-action="incrProgress" data-arg="'+i+'" style="cursor:pointer;font-size:9px;color:var(--cyan);font-weight:700" title="완료 +1">+1</span></td>';
    h+='</tr>';
  });
  h+='</table>';
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}
let _gp2ProgStartDate='', _gp2ProgEndDate='';
function _gp2AddProgress(){
  _gp2ProgStartDate=_gp2Today();
  _gp2ProgEndDate=_gp2Today();
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2ProgressOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  ov.innerHTML='<div class="modal-content" style="width:560px;max-width:94vw;padding:0">'
    +'<div style="background:rgba(6,182,212,0.10);padding:10px 16px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0"><div style="font-size:13px;font-weight:700;color:var(--t1)">👍 업무 진척도 A형 — 업무 추가</div></div>'
    +'<div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">'
    +'<div><label style="font-size:10px;color:var(--t3)">업무명</label><input class="form-input" id="gp2ProgName" placeholder="예: 블로그 글 작성" style="width:100%;font-size:11px"></div>'
    +'<div style="display:flex;gap:8px"><div style="flex:1"><label style="font-size:10px;color:var(--t3)">시작일</label><input class="form-input" id="gp2ProgStart" value="'+_gp2ProgStartDate+'" readonly style="width:100%;font-size:11px;cursor:pointer"></div>'
    +'<div style="flex:1"><label style="font-size:10px;color:var(--t3)">종료일</label><input class="form-input" id="gp2ProgEnd" value="'+_gp2ProgEndDate+'" readonly style="width:100%;font-size:11px;cursor:pointer"></div></div>'
    +'<div style="display:flex;gap:8px"><div style="flex:1"><label style="font-size:10px;color:var(--t3)">일 목표 횟수</label><input class="form-input" id="gp2ProgDaily" value="1" placeholder="숫자 입력" style="width:100%;font-size:11px"></div>'
    +'<div style="flex:1"><label style="font-size:10px;color:var(--t3)">우선순위</label><select class="form-input" id="gp2ProgPri" style="width:100%;font-size:11px"><option>긴급</option><option>높음</option><option selected>보통</option><option>낮음</option></select></div></div>'
    +'<div style="border:1px solid var(--bdr);border-radius:8px;overflow:hidden;margin-top:4px">'
    +'<div style="font-size:9px;font-weight:700;color:var(--t2);padding:4px 8px;background:var(--bg2)">📋 미리보기</div>'
    +'<div id="gp2ProgPreview" style="padding:4px"></div>'
    +'<div style="padding:4px 8px;font-size:8px;color:var(--t3)">※ 목표 = 기간(일) × 일 목표 횟수 · 완료 숫자 클릭으로 수정</div></div>'
    +'</div>'
    +'<div style="display:flex;justify-content:flex-end;gap:6px;padding:8px 16px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">'
    +'<button id="gp2ProgOk" style="padding:6px 18px;font-size:11px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">추가</button>'
    +'</div></div>';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  /* 시작일/종료일 클릭 → 달력 팝업 */
  document.getElementById('gp2ProgStart').addEventListener('click',function(){
    const inp=this;
    _gp2ShowDatePicker('시작일 선택',inp.value,function(ds){inp.value=ds;_gp2ProgStartDate=ds;updatePreview();});
  });
  document.getElementById('gp2ProgEnd').addEventListener('click',function(){
    const inp=this;
    _gp2ShowDatePicker('종료일 선택',inp.value,function(ds){inp.value=ds;_gp2ProgEndDate=ds;updatePreview();});
  });
  /* 실시간 미리보기 */
  function updatePreview(){
    const pv=document.getElementById('gp2ProgPreview');if(!pv)return;
    const n=document.getElementById('gp2ProgName').value.trim();
    if(!n){pv.innerHTML='<div style="font-size:9px;color:var(--t3);text-align:center;padding:6px">업무명을 입력하면 미리보기가 표시됩니다</div>';return;}
    const s=_gp2ProgStartDate, e=_gp2ProgEndDate;
    const daily=parseInt(document.getElementById('gp2ProgDaily').value)||1;
    const pri=document.getElementById('gp2ProgPri').value;
    const priColor=pri==='긴급'?'#ef4444':pri==='높음'?'#f59e0b':pri==='보통'?'#06b6d4':'#22c55e';
    const sd=new Date(s), ed=new Date(e);
    const days=Math.max(1,Math.ceil((ed-sd)/(86400000))+1);
    const target=days*daily;
    pv.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:9px">'
      +'<tr style="background:var(--bg2)"><th style="padding:3px 5px;text-align:left;color:var(--t3)">업무</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">기간</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">우선</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">목표</th><th style="padding:3px 5px;text-align:center;color:var(--t3)">완료</th><th style="padding:3px 5px;color:var(--t3)">진척도</th></tr>'
      +'<tr style="color:var(--t1)"><td style="padding:3px 5px;border-left:3px solid '+priColor+';font-weight:600">'+escHtml(n)+'</td><td style="padding:3px 5px;text-align:center;color:var(--t3)">'+s.substring(5)+'~'+e.substring(5)+'</td><td style="padding:3px 5px;text-align:center;color:'+priColor+';font-size:8px;font-weight:700">'+pri+'</td><td style="padding:3px 5px;text-align:center;color:var(--t2)">'+target+'</td><td style="padding:3px 5px;text-align:center;font-weight:700">0</td><td style="padding:3px 5px"><div style="display:flex;align-items:center;gap:3px"><div style="flex:1;background:var(--bg2);border-radius:3px;height:5px"><div style="background:var(--t3);width:0%;height:100%;border-radius:3px"></div></div><span style="font-size:8px;font-weight:800;color:var(--t3)">0%</span></div></td></tr>'
      +'</table>'
      +'<div style="font-size:8px;color:var(--t3);padding:2px 5px">'+days+'일 × 일 '+daily+'회 = 목표 '+target+'회</div>';
  }
  document.getElementById('gp2ProgName').addEventListener('input',updatePreview);
  document.getElementById('gp2ProgDaily').addEventListener('input',updatePreview);
  document.getElementById('gp2ProgPri').addEventListener('change',updatePreview);
  /* 날짜 변경 시에도 미리보기 갱신 */
  const _origStartPicker=document.getElementById('gp2ProgStart');
  const _origEndPicker=document.getElementById('gp2ProgEnd');
  if(_origStartPicker)new MutationObserver(updatePreview).observe(_origStartPicker,{attributes:true});
  if(_origEndPicker)new MutationObserver(updatePreview).observe(_origEndPicker,{attributes:true});
  updatePreview();
  document.getElementById('gp2ProgOk').addEventListener('click',function(){
    const name=document.getElementById('gp2ProgName').value.trim();
    if(!name){closeModalGracefully(ov);return;}
    const daily=parseInt(document.getElementById('gp2ProgDaily').value)||1;
    const pri=document.getElementById('gp2ProgPri').value;
    const items=JSON.parse(localStorage.getItem('gp2_progress')||'[]');
    items.push({name:name,startDate:_gp2ProgStartDate,endDate:_gp2ProgEndDate,dailyCount:daily,priority:pri,done:0});
    localStorage.setItem('gp2_progress',JSON.stringify(items));
    closeModalGracefully(ov);
    const pl=document.getElementById('gp2ProgressList');
    if(pl)_gp2InitProgress();
  });
}
function _gp2IncrProgress(i){
  const items=JSON.parse(localStorage.getItem('gp2_progress')||'[]');
  if(items[i]){items[i].done=(items[i].done||0)+1;}
  localStorage.setItem('gp2_progress',JSON.stringify(items));
  _gp2InitProgress();_gp2ShowSaveToast();
}
function _gp2EditProgress(i){
  const items=JSON.parse(localStorage.getItem('gp2_progress')||'[]');
  if(!items[i])return;
  _gp2Prompt('완료 횟수 수정','현재: '+items[i].done,String(items[i].done),function(v){
    if(v===null)return;items[i].done=Math.max(0,parseInt(v)||0);
    localStorage.setItem('gp2_progress',JSON.stringify(items));
    _gp2InitProgress();
  });
}

/* ── 웹 스크랩 ── */
function _gp2InitScrap(){
  const el=document.getElementById('gp2ScrapList');if(!el)return;
  const items=JSON.parse(localStorage.getItem('gp2_scraps')||'[]');
  if(!items.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:6px">제목을 클릭하여 URL을 추가하세요</div>';return;}
  const expanded=items.filter(function(it){return !it.folded;});
  const folded=items.filter(function(it){return it.folded;});
  let h='';
  /* 펼쳐진 북마크 */
  expanded.forEach(function(item,i){
    const idx=items.indexOf(item);
    let domain;try{const u=new URL(item.url);domain=u.hostname.replace('www.','');}catch(e){domain=item.url;}
    h+='<div class="gp2-scrap-card" style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden;margin-bottom:6px;transition:all 0.15s">';
    h+='<div style="padding:10px 12px;background:var(--card)">';
    h+='<div style="display:flex;align-items:flex-start;gap:8px">';
    let _fav1='';try{const _fu1=new URL(item.url);if(_fu1.protocol==='https:'||_fu1.protocol==='http:')_fav1=escHtml(_fu1.origin)+'/favicon.ico';}catch(e){}
    h+='<img src="'+_fav1+'" width="16" height="16" style="margin-top:2px;border-radius:2px" onerror="this.src=\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><text y=%2213%22 font-size=%2212%22>🌐</text></svg>\'">';
    h+='<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(item.title||item.url)+'</div>';
    h+='<div style="font-size:9px;color:var(--t3);margin-top:1px">'+escHtml(domain)+'</div></div>';
    h+='<div style="display:flex;gap:2px;flex-shrink:0">';
    h+='<span data-action="foldScrap" data-arg="'+idx+'" style="cursor:pointer;font-size:11px;color:var(--t3);padding:2px" title="접기">📄</span>';
    h+='<span data-action="deleteScrap" data-arg="'+idx+'" style="cursor:pointer;font-size:11px;color:var(--t3);padding:2px;opacity:0.4" data-hover-opacity="1" data-rest-opacity="0.4" title="삭제">✕</span>';
    h+='</div></div></div>';
    h+='<div style="height:3px;background:var(--cyan)"></div>';
    h+='</div>';
  });
  /* 접힌 북마크 (하단 가로 정렬) */
  if(folded.length){
    h+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">';
    folded.forEach(function(item){
      const idx=items.indexOf(item);
      let domain;try{domain=new URL(item.url).hostname.replace('www.','');}catch(e){domain='';}
      h+='<div data-action="unfoldScrap" data-arg="'+idx+'" data-scrap-tip="'+escHtml(item.title||domain)+'" style="position:relative;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--bg2);border:1px solid var(--bdr);transition:all 0.15s" title="'+escHtml(item.title||item.url)+'">';
      let _fav2='';try{const _fu2=new URL(item.url);if(_fu2.protocol==='https:'||_fu2.protocol==='http:')_fav2=escHtml(_fu2.origin)+'/favicon.ico';}catch(e){}
      h+='<img src="'+_fav2+'" width="14" height="14" style="border-radius:2px" onerror="this.parentElement.textContent=\'📑\'">';
      h+='</div>';
    });
    h+='</div>';
  }
  el.innerHTML=h;
  _gp2SetupDelegation(el);
  /* Scrap card hover shadow */
  el.querySelectorAll('.gp2-scrap-card').forEach(function(card){
    card.addEventListener('mouseenter',function(){this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';});
    card.addEventListener('mouseleave',function(){this.style.boxShadow='';});
  });
  /* Folded scrap hover */
  el.querySelectorAll('[data-scrap-tip]').forEach(function(item){
    item.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';this.style.transform='scale(1.1)';_gp2ShowScrapTip(this,this.getAttribute('data-scrap-tip'));});
    item.addEventListener('mouseleave',function(){this.style.borderColor='var(--bdr)';this.style.transform='';_gp2HideScrapTip();});
  });
}
function _gp2FoldScrap(i){
  const items=JSON.parse(localStorage.getItem('gp2_scraps')||'[]');
  if(items[i])items[i].folded=true;
  localStorage.setItem('gp2_scraps',JSON.stringify(items));
  _gp2InitScrap();
}
function _gp2UnfoldScrap(i){
  const items=JSON.parse(localStorage.getItem('gp2_scraps')||'[]');
  if(items[i])items[i].folded=false;
  localStorage.setItem('gp2_scraps',JSON.stringify(items));
  _gp2InitScrap();
}
function _gp2DeleteScrap(i){
  _gp2Confirm('이 스크랩을 삭제하시겠습니까?',function(yes){
    if(!yes)return;
    const items=JSON.parse(localStorage.getItem('gp2_scraps')||'[]');
    items.splice(i,1);
    localStorage.setItem('gp2_scraps',JSON.stringify(items));
    _gp2InitScrap();
  });
}
let _gp2ScrapTipEl=null;
function _gp2ShowScrapTip(el,text){
  _gp2HideScrapTip();
  const tip=document.createElement('div');
  tip.id='gp2ScrapTip';
  tip.style.cssText='position:fixed;z-index:12000;background:var(--card);border:1px solid var(--cyan);border-radius:6px;padding:4px 8px;font-size:10px;color:var(--t1);box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;pointer-events:none';
  tip.textContent=text;
  document.body.appendChild(tip);
  const rect=el.getBoundingClientRect();
  tip.style.left=rect.left+'px';
  tip.style.top=(rect.top-tip.offsetHeight-4)+'px';
  _gp2ScrapTipEl=tip;
}
function _gp2HideScrapTip(){if(_gp2ScrapTipEl){_gp2ScrapTipEl.remove();_gp2ScrapTipEl=null;}}
function _gp2AddScrap(){
  _gp2Prompt('웹 스크랩 추가','URL (https://...)','',function(url){
  if(!url)return;
  if(!url.startsWith('http'))url='https://'+url;
  const items=JSON.parse(localStorage.getItem('gp2_scraps')||'[]');
  items.push({url:url,title:url});
  localStorage.setItem('gp2_scraps',JSON.stringify(items));
  _gp2InitScrap();
  /* 제목 가져오기 시도 (백엔드 경유) */
  window.electronAPI.externalFetchUrlTitle(url).then(function(res){
    if(res.success&&res.data&&res.data.title){items[items.length-1].title=res.data.title;localStorage.setItem('gp2_scraps',JSON.stringify(items));_gp2InitScrap();}
  }).catch(function(){});
  });
}

/* ── 생일 알림 ── */
function _gp2InitBirthday(){
  const el=document.getElementById('gp2BirthdayList');if(!el)return;
  const ids=JSON.parse(localStorage.getItem('gp2_birthdays')||'[]');
  if(!ids.length){el.innerHTML='<div style="font-size:10px;color:var(--t3);text-align:center;padding:6px">제목을 클릭하여 학생을 추가하세요</div>';return;}
  const now=new Date();const thisMonth=now.getMonth()+1;const thisDay=now.getDate();
  const list=[];
  ids.forEach(function(id){
    const s=S.people.find(function(st){return st.id===id;});if(!s)return;
    const birth=s.birth||'';let bMonth=0, bDay=0;
    if(birth){const bp=birth.match(/(\d{1,2})[\-\/.](\d{1,2})/);if(bp){bMonth=parseInt(bp[1]);bDay=parseInt(bp[2]);}}
    list.push({s:s,bMonth:bMonth,bDay:bDay});
  });
  /* 이번 달 기준 가까운 순 정렬 */
  list.sort(function(a,b){return(a.bMonth*100+a.bDay)-(b.bMonth*100+b.bDay);});
  let h='';
  list.forEach(function(item){
    const s=item.s, bMonth=item.bMonth, bDay=item.bDay;
    const isToday=bMonth===thisMonth&&bDay===thisDay;
    const isSoon=bMonth===thisMonth;
    const belong=s.type==='student'?(s.grade+'학년 '+s.cls+'반'):(s.position||'교직원');
    h+='<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;margin-bottom:2px;border-radius:6px;'+(isToday?'background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2)':isSoon?'background:rgba(245,158,11,0.06)':'')+'">';
    h+='<span style="font-size:14px">'+(isToday?'🎉':isSoon?'🎂':'🎈')+'</span>';
    h+='<div style="flex:1;min-width:0">';
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1)">'+escHtml(s.name)+'</div>';
    h+='<div style="font-size:9px;color:var(--t3)">'+escHtml(belong)+'</div>';
    h+='</div>';
    if(bMonth&&bDay)h+='<div style="text-align:right"><div style="font-size:12px;font-weight:800;color:'+(isToday?'var(--cyan)':isSoon?'#f59e0b':'var(--t2)')+'">'+bMonth+'/'+bDay+'</div>'+(isToday?'<div style="font-size:8px;color:var(--cyan)">오늘!</div>':'')+'</div>';
    h+='</div>';
  });
  el.innerHTML=h;
}
function _gp2AddBirthday(){
  /* To-Do List 팝업 스타일과 동일한 디자인 */
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2BirthdayOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div style="width:420px;max-width:90vw;padding:0;background:var(--card);border:1px solid rgba(255,255,255,0.06);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.04) inset;animation:gp2PopIn 0.2s cubic-bezier(0.22,1,0.36,1) both;overflow:hidden">';
  h+='<div style="background:transparent;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.04)"><div style="font-size:13px;font-weight:700;color:var(--t1);letter-spacing:-0.2px">🎂 생일 알림을 받을 학생 검색하기</div></div>';
  h+='<div style="padding:16px 18px"><input class="form-input" id="gp2BirthdaySearch" placeholder="학생 이름을 입력하세요" style="width:100%;font-size:12px;border-radius:8px;padding:10px 12px" autofocus></div>';
  h+='<div id="gp2BirthdaySearchResults" style="max-height:240px;overflow-y:auto;padding:0 18px 8px;scrollbar-width:thin"></div>';
  h+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px 14px">';
  h+='<button id="gp2BirthdayClose" style="padding:7px 20px;font-size:11px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 8px rgba(6,182,212,0.3);transition:all 0.15s">닫기</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  document.body.appendChild(ov);
  const inp=document.getElementById('gp2BirthdaySearch');
  const resEl=document.getElementById('gp2BirthdaySearchResults');
  setTimeout(function(){if(inp)inp.focus();},50);
  function close(){ov.style.animation='gp2PopOut 0.18s ease forwards';setTimeout(function(){ov.remove();},200);}
  const _closeBtn=document.getElementById('gp2BirthdayClose');
  _closeBtn.addEventListener('click',close);
  _closeBtn.addEventListener('mouseenter',function(){this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(6,182,212,0.4)';});
  _closeBtn.addEventListener('mouseleave',function(){this.style.transform='';this.style.boxShadow='0 2px 8px rgba(6,182,212,0.3)';});
  ov.addEventListener('click',function(e){if(e.target===ov)close();});
  inp.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
  function renderResults(keyword){
    if(!keyword||keyword.length<1){resEl.innerHTML='<div style="text-align:center;color:var(--t3);font-size:11px;padding:8px">이름을 입력하면 검색 결과가 나타납니다</div>';return;}
    const ids=JSON.parse(localStorage.getItem('gp2_birthdays')||'[]');
    const matches=S.people.filter(function(s){return s.name&&s.name.indexOf(keyword)!==-1;}).slice(0,20);
    if(!matches.length){resEl.innerHTML='<div style="text-align:center;color:var(--t3);font-size:11px;padding:8px">검색 결과가 없습니다</div>';return;}
    let rh='';
    matches.forEach(function(s){
      const already=ids.indexOf(s.id)!==-1;
      const belong=s.type==='student'?(s.grade+'학년 '+s.cls+'반 '+s.number+'번'):(s.position||'교직원');
      rh+='<div data-birthday-row '+(already?'':'data-action="selectBirthday" data-arg="'+escHtml(s.id)+'"')+' style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:'+(already?'default':'pointer')+';transition:background 0.12s;border-bottom:1px solid rgba(255,255,255,0.03);'+(already?'opacity:0.5':'')+'" data-hover-bg="var(--hover)" data-rest-bg="">';
      rh+='<div style="width:32px;height:32px;border-radius:50%;background:rgba(6,182,212,0.1);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">🎂</div>';
      rh+='<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--t1)">'+escHtml(s.name)+'</div><div style="font-size:10px;color:var(--t3)">'+escHtml(belong)+(s.birth?' · 생일: '+escHtml(s.birth):'')+'</div></div>';
      rh+='<div style="font-size:9px;color:'+(already?'var(--gs)':'var(--cyan)')+';font-weight:700;white-space:nowrap">'+(already?'추가됨':'+ 추가')+'</div>';
      rh+='</div>';
    });
    resEl.innerHTML=rh;
    _gp2SetupDelegation(resEl);
  }
  inp.addEventListener('input',function(){renderResults(this.value.trim());});
  renderResults('');
}
function _gp2SelectBirthday(id,el){
  const ids=JSON.parse(localStorage.getItem('gp2_birthdays')||'[]');
  if(ids.indexOf(id)===-1)ids.push(id);
  localStorage.setItem('gp2_birthdays',JSON.stringify(ids));
  _gp2InitBirthday();
  if(el){el.style.opacity='0.5';el.style.cursor='default';el.removeAttribute('data-action');const badge=el.querySelector('div:last-child');if(badge){badge.textContent='추가됨';badge.style.color='var(--gs)';}}
}

/* ── 명언 구글 시트 연동 ── */
function _gp2EditQuotes(){
  const savedUrl=localStorage.getItem('gp2_quote_sheet_url')||'';
  const savedInterval=localStorage.getItem('gp2_quote_interval')||'00:10';
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2QuoteOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div class="modal-content" style="width:520px;max-width:94vw;padding:0">';
  h+='<div style="background:rgba(6,182,212,0.10);padding:12px 16px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0"><div style="font-size:14px;font-weight:800;color:var(--t1)">💬 명언/격언 설정</div></div>';
  h+='<div style="padding:16px">';
  /* 구글 시트 연동 */
  h+='<div style="margin-bottom:14px">';
  h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px;display:flex;align-items:center;gap:6px"><img src="https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico" width="16" height="16"> 구글 시트 연동</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:8px;line-height:1.6;background:var(--bg2);padding:8px 10px;border-radius:6px">';
  h+='선생님의 구글 드라이브에 명언 전용 구글 시트를 하나 만든 후<br>"뷰어 모드(링크가 있는 모든 사용자)"로 설정하여 아래 링크에 붙여넣기 하세요.<br><br>';
  h+='<b>A1</b>셀: 명언 &nbsp; <b>B1</b>셀: 사람 이름<br>';
  h+='<b>2행부터</b> 인식하여 표시됩니다.</div>';
  h+='<div style="display:flex;gap:4px"><input class="form-input" id="gp2QuoteSheetUrl" value="'+escHtml(savedUrl)+'" placeholder="https://docs.google.com/spreadsheets/d/..." style="flex:1;font-size:10px"><button id="gp2QuoteSheetBtn" class="btn btn-primary btn-sm" style="font-size:9px">불러오기</button></div>';
  h+='</div>';
  /* 회전 간격 */
  h+='<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:11px;font-weight:700;color:var(--t1)">⏱️ 회전 간격</span>';
  h+='<input class="form-input" id="gp2QuoteInterval" value="'+escHtml(savedInterval)+'" placeholder="00:10" maxlength="5" style="width:80px;font-size:11px;text-align:center">';
  h+='<span style="font-size:9px;color:var(--t3)">(분:초 형태. 예: 01:30 = 1분 30초)</span>';
  h+='</div>';
  /* 미리보기 */
  h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">미리보기</div>';
  h+='<div id="gp2QuotePreview" style="max-height:150px;overflow-y:auto;scrollbar-width:thin;border:1px solid var(--bdr);border-radius:6px;padding:8px;font-size:10px;color:var(--t2);line-height:1.8;background:var(--bg2)">불러오기를 클릭하세요</div>';
  h+='</div>';
  h+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  h+='<button id="gp2QuoteSaveBtn" style="padding:7px 20px;font-size:11px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">확인</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  /* 기존 데이터 미리보기 */
  const existingQuotes=JSON.parse(localStorage.getItem('gp2_custom_quotes')||'[]');
  if(existingQuotes.length){
    const preview=document.getElementById('gp2QuotePreview');
    if(preview)preview.innerHTML=existingQuotes.map(function(q,i){
      const parts=q.split('|');
      return '<div style="padding:2px 0;border-bottom:1px solid var(--bdrl)">'+(i+1)+'. '+escHtml(parts[0])+(parts[1]?' <span style="color:var(--cyan)">— '+escHtml(parts[1])+'</span>':'')+'</div>';
    }).join('');
  }
  /* 불러오기 */
  document.getElementById('gp2QuoteSheetBtn').addEventListener('click',function(){
    const url=document.getElementById('gp2QuoteSheetUrl').value.trim();
    if(!url)return;
    const match=url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if(!match){alert('올바른 구글 시트 URL이 아닙니다.');return;}
    const ssId=match[1];
    localStorage.setItem('gp2_quote_sheet_url',url);
    this.textContent='불러오는 중...';this.disabled=true;
    const btn=this;
    window.electronAPI.externalFetchPublicSheetCsv(ssId).then(function(res){
      if(!res.success){btn.textContent='실패: '+(res.error||'');btn.disabled=false;return;}
      const csv=res.data.csv;
      /* CSV 파싱 (쉼표 포함 문자열 처리) */
      function parseCSVRow(line){
        const cols=[];let cur='';let inQ=false;
        for(let c=0;c<line.length;c++){
          const ch=line[c];
          if(ch==='"'){if(inQ&&line[c+1]==='"'){cur+='"';c++;}else{inQ=!inQ;}}
          else if(ch===','&&!inQ){cols.push(cur.trim());cur='';}
          else{cur+=ch;}
        }
        cols.push(cur.trim());
        return cols;
      }
      const rows=csv.split('\n').slice(1); /* 1행(헤더) 건너뜀 */
      const quotes=[];
      rows.forEach(function(row){
        if(!row.trim())return;
        const cols=parseCSVRow(row);
        const a=cols[0]||'';const b=cols[1]||'';
        if(a)quotes.push(a+(b?'|'+b:''));
      });
      if(quotes.length){
        localStorage.setItem('gp2_custom_quotes',JSON.stringify(quotes));
        const preview=document.getElementById('gp2QuotePreview');
        if(preview)preview.innerHTML=quotes.map(function(q,i){
          const sep=q.indexOf('|');
          const text=sep!==-1?q.substring(0,sep):q;
          const person=sep!==-1?q.substring(sep+1):'';
          return '<div style="padding:3px 0;border-bottom:1px solid var(--bdrl);font-size:10px"><span style="color:var(--t1)">'+escHtml(text)+'</span>'+(person?' <span style="color:var(--t3)">— '+escHtml(person)+'</span>':'')+'</div>';
        }).join('');
        btn.textContent='✓ '+quotes.length+'개 불러옴';
      } else {btn.textContent='데이터 없음';}
      btn.disabled=false;
    }).catch(function(){btn.textContent='실패';btn.disabled=false;});
  });
  /* 확인 */
  document.getElementById('gp2QuoteSaveBtn').addEventListener('click',function(){
    let raw=document.getElementById('gp2QuoteInterval').value.trim().replace(/[^0-9]/g,'')||'0010';
    if(raw.length<4)raw=('0000'+raw).slice(-4);
    const interval=raw.substring(0,2)+':'+raw.substring(2,4);
    localStorage.setItem('gp2_quote_interval',interval);
    closeModalGracefully(ov);
    _gp2InitQuote();
  });
}

/* ── 캘린더 색상 팔레트 ── */
const _gp2Colors=[
  {id:'1',name:'라벤더',hex:'#7986cb'},
  {id:'2',name:'세이지',hex:'#33b679'},
  {id:'3',name:'포도',hex:'#8e24aa'},
  {id:'4',name:'플라밍고',hex:'#e67c73'},
  {id:'5',name:'바나나',hex:'#f6bf26'},
  {id:'6',name:'귤',hex:'#f4511e'},
  {id:'7',name:'공작새',hex:'#039be5'},
  {id:'8',name:'흑연',hex:'#616161'},
  {id:'9',name:'블루베리',hex:'#3f51b5'},
  {id:'10',name:'바질',hex:'#0b8043'},
  {id:'11',name:'토마토',hex:'#d50000'}
];
let _gp2SelectedColorId=localStorage.getItem('gp2_calColorId')||'2';

function _gp2RenderColorPalette(){
  const el=document.getElementById('gp2ColorPalette');if(!el)return;
  let h='';
  _gp2Colors.forEach(function(c){
    const sel=c.id===_gp2SelectedColorId;
    h+='<div data-action="setColor" data-arg="'+c.id+'" title="'+c.name+'" style="width:16px;height:16px;border-radius:50%;background:'+c.hex+';cursor:pointer;border:2px solid '+(sel?'var(--t1)':'transparent')+';box-shadow:'+(sel?'0 0 0 1px var(--card)':'none')+';transition:all 0.1s"></div>';
  });
  el.innerHTML=h;
  _gp2SetupDelegation(el);
}
function _gp2SetColor(id){
  _gp2SelectedColorId=id;
  localStorage.setItem('gp2_calColorId',id);
  _gp2RenderColorPalette();
}

function _gp2CalWheel(e){
  e.preventDefault();
  if(e.deltaY>0)_gp2CalNext();
  else _gp2CalPrev();
}
function _gp2CalYearWheel(e){
  e.preventDefault();
  const d=_gp2.date||_gp2Today();const dp=d.split('-');
  const yr=parseInt(dp[0])+(e.deltaY>0?1:-1);
  _gp2.date=yr+'-'+dp[1]+'-'+dp[2];
  const dim=new Date(yr,parseInt(dp[1])-1+1,0).getDate();
  if(parseInt(dp[2])>dim)_gp2.date=yr+'-'+dp[1]+'-'+String(dim).padStart(2,'0');
  _gp2UpdateAll();_gp2FetchEvents();
}

/* ── 날짜 클릭 팝업 ── */
function _gp2OpenPopup(ds,clickEvent){
  const popup=document.getElementById('gp2DayPopup');if(!popup)return;
  _gp2.date=ds;
  const dp=ds.split('-');const dt=new Date(+dp[0],+dp[1]-1,+dp[2]);
  const dow=['일','월','화','수','목','금','토'][dt.getDay()];
  const title=document.getElementById('gp2PopupTitle');
  if(title)title.textContent='📅 '+parseInt(dp[1])+'월 '+parseInt(dp[2])+'일 ('+dow+')'+(ds===_gp2Today()?' — 오늘':'');
  _gp2UpdateDayContent();
  _gp2RenderColorPalette();
  popup.style.transform='none';
  popup.style.display='block';
  const pw=popup.offsetWidth||360, ph=popup.offsetHeight||400;
  /* 마우스 클릭 위치 기준으로 배치 */
  const cx=clickEvent?clickEvent.clientX:window.innerWidth/2;
  const cy=clickEvent?clickEvent.clientY:window.innerHeight/2;
  let left=cx+10;
  if(left+pw>window.innerWidth-10)left=cx-pw-10;
  if(left<10)left=10;
  let top=cy-50;
  if(top+ph>window.innerHeight-10)top=window.innerHeight-ph-10;
  if(top<10)top=10;
  popup.style.left=left+'px';
  popup.style.top=top+'px';
}
function _gp2ClosePopup(){
  const popup=document.getElementById('gp2DayPopup');
  if(popup)popup.style.display='none';
}
/* 팝업 외부 클릭 시 닫기 */
document.addEventListener('mousedown',function(e){
  const popup=document.getElementById('gp2DayPopup');
  if(popup&&popup.style.display!=='none'&&!popup.contains(e.target)&&!e.target.closest('[data-action="selectDate"]')){
    _gp2ClosePopup();
  }
});

/* ── 달력 셀 높이 리사이즈 ── */
let _gp2CellH=80;
let _gp2ResizeData=null;
export function _gp2StartResize(e){
  e.preventDefault();e.stopPropagation();
  const wrap=document.getElementById('gp2CalendarWrap');
  if(!wrap)return;
  _gp2ResizeData={startY:e.clientY,startCellH:_gp2CellH,startWrapH:wrap.offsetHeight};
  document.addEventListener('mousemove',_gp2OnResize,true);
  document.addEventListener('mouseup',_gp2StopResize,true);
  document.body.style.cursor='grabbing';
  document.body.style.userSelect='none';
}
function _gp2OnResize(e){
  if(!_gp2ResizeData)return;
  e.preventDefault();
  const delta=e.clientY-_gp2ResizeData.startY;
  _gp2CellH=Math.max(24,Math.min(300,Math.round(_gp2ResizeData.startCellH+delta)));
  /* 달력 전체 다시 그리기 (비례적으로) */
  _gp2UpdateCalendar();
}
function _gp2StopResize(e){
  if(e)e.preventDefault();
  _gp2ResizeData=null;
  document.removeEventListener('mousemove',_gp2OnResize,true);
  document.removeEventListener('mouseup',_gp2StopResize,true);
  document.body.style.cursor='';
  document.body.style.userSelect='';
}

/* ── 캘린더 HTML ── */

/* ── 위젯 HTML ── */

/* ── Quick Links CRUD ── */
function _gp2AddLink(){
  _gp2PromptMulti('Quick Link 추가',[{label:'사이트 이름',placeholder:'예: 나이스'},{label:'URL',placeholder:'https://...'}],function(vals){
    if(!vals||!vals[0])return;
    let url=vals[1]||'';if(url&&!url.startsWith('http'))url='https://'+url;
    const links=_sbGetLinks(_gp2.links);
    let ico='🌐';try{const _u=new URL(url);if(_u.protocol==='https:'||_u.protocol==='http:')ico='<img src="'+escHtml(_u.origin)+'/favicon.ico" width="14" height="14" style="vertical-align:middle" onerror="this.style.display=\'none\'">';}catch(e){}
    links.push({name:vals[0],url:url,icon:ico});
    _sbSaveLinks(links);
    _gp2.links=links;
    _gp2UpdateLinks();
  });
}
function _gp2DeleteLink(i){
  const links=_sbGetLinks(_gp2.links);
  links.splice(i,1);
  _sbSaveLinks(links);
  _gp2.links=links;
  _gp2UpdateLinks();
}

/* ── Routine Tracker CRUD ── */
function _gp2AddRoutine(){
  _gp2Prompt('루틴 추가','매일 반복할 루틴','',function(text){
    if(!text)return;
    const routines=_sbGetRoutines(_gp2.routines);
    routines.push(text);
    _sbSaveRoutines(routines);
    _gp2.routines=routines;
    _gp2UpdateRoutines();
  });
}
function _gp2DeleteRoutine(i){
  const routines=_sbGetRoutines(_gp2.routines);
  routines.splice(i,1);
  _sbSaveRoutines(routines);
  _gp2.routines=routines;
  _gp2UpdateRoutines();
}
function _gp2ToggleRoutine(i,checked){
  const todayKey='gp2rt_'+(_gp2.date||_gp2Today());
  const checks=JSON.parse(localStorage.getItem(todayKey)||'{}');
  checks[i]=checked;
  localStorage.setItem(todayKey,JSON.stringify(checks));
}

/* ── Global To-Do CRUD ── */
function _gp2AddGlobalTodo(){
  _gp2Prompt('To-Do List','할 일','',function(text){
    if(!text)return;
    const todos=_sbGetGlobalTodos(_gp2.globalTodos);
    todos.push({text:text,done:false});
    _sbSaveGlobalTodos(todos);
    _gp2.globalTodos=todos;
    _gp2UpdateGlobalTodos();
  },{noCancel:true});
}
function _gp2ToggleGlobalTodo(idx){
  const todos=_sbGetGlobalTodos(_gp2.globalTodos);
  if(todos[idx])todos[idx].done=!todos[idx].done;
  _sbSaveGlobalTodos(todos);
  _gp2.globalTodos=todos;
  _gp2UpdateGlobalTodos();
}
function _gp2DeleteGlobalTodo(idx){
  const todos=_sbGetGlobalTodos(_gp2.globalTodos);
  todos.splice(idx,1);
  _sbSaveGlobalTodos(todos);
  _gp2.globalTodos=todos;
  _gp2UpdateGlobalTodos();
}

/* ── 날짜 헤더 ── */

/* ── 날짜별 컨텐츠 ── */
function _gp2DayContentHtml(){
  const d=_gp2.date||_gp2Today();
  const data=_gp2Load(d);
  const events=_gp2.events[d]||[];
  let h='';

  /* 구글 캘린더 일정 */
  if(events.length){
    h+='<div style="border:1px solid var(--bdr);border-radius:8px;padding:10px;margin-bottom:12px">';
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">📅 일정 ('+events.length+'건)</div>';
    events.forEach(function(ev){
      const time=ev.start&&ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'}):'종일';
      const evColor=ev._calColor||'#3b82f6';
      const calName=ev._calName||'';
      h+='<div style="font-size:11px;color:var(--t1);padding:4px 6px;margin-bottom:3px;border-radius:4px;background:'+evColor+'12;border-left:3px solid '+evColor+'">';
      h+='<span style="color:'+evColor+';font-weight:700;margin-right:6px">'+time+'</span>'+escHtml(ev.summary||'(제목 없음)');
      if(calName)h+='<span style="font-size:9px;color:var(--t3);margin-left:6px">'+escHtml(calName)+'</span>';
      h+='</div>';
    });
    h+='</div>';
  }

  /* 할 일 */
  h+='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:12px;margin-bottom:12px">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1)">✅ 할 일</div>';
  h+='<button data-action="addTodo" style="border:none;background:rgba(6,182,212,0.1);color:var(--cyan);cursor:pointer;font-size:11px;font-weight:700;padding:4px 10px;border-radius:5px;font-family:var(--f)">+ 추가</button>';
  h+='</div>';
  /* 미완료 */
  const pending=data.todos.filter(function(t){return !t.done;});
  const done=data.todos.filter(function(t){return t.done;});
  if(!data.todos.length){
    h+= (typeof createEmptyState==='function')
      ? createEmptyState({icon:'✅',title:'할 일이 없습니다',desc:'+ 추가 버튼을 눌러 새 할 일을 등록하세요.'})
      : '<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">할 일이 없습니다. + 추가를 눌러 추가하세요.</div>';
  }
  pending.forEach(function(t,i){
    const idx=data.todos.indexOf(t);
    h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--bdrl);transition:all 0.15s" data-idx="'+idx+'">';
    h+='<input type="checkbox" data-action="toggleTodo" data-arg="'+idx+'" style="cursor:pointer;width:16px;height:16px;accent-color:var(--cyan)">';
    h+='<input class="form-input" value="'+escHtml(t.text)+'" data-action="updateTodo" data-arg="'+idx+'" style="flex:1;font-size:12px;border:none;background:transparent;color:var(--t1);padding:2px 0" placeholder="할 일 입력...">';
    h+='<button data-action="deleteTodo" data-arg="'+idx+'" style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.5" data-hover-opacity="1" data-rest-opacity="0.5">✕</button>';
    h+='</div>';
  });
  /* 완료 */
  if(done.length){
    h+='<div style="margin-top:8px"><div data-action="toggleDone" style="font-size:10px;color:var(--t3);cursor:pointer;padding:4px 0"><span>▼</span> 완료된 항목 ('+done.length+'건)</div>';
    h+='<div>';
    done.forEach(function(t){
      const idx=data.todos.indexOf(t);
      h+='<div style="display:flex;align-items:center;gap:8px;padding:4px;opacity:0.5">';
      h+='<input type="checkbox" checked data-action="toggleTodo" data-arg="'+idx+'" style="cursor:pointer;width:16px;height:16px;accent-color:var(--cyan)">';
      h+='<span style="flex:1;font-size:11px;text-decoration:line-through;color:var(--t3)">'+escHtml(t.text)+'</span>';
      if(t.completedAt)h+='<span style="font-size:9px;color:var(--t3)">✓'+t.completedAt+'</span>';
      h+='</div>';
    });
    h+='</div></div>';
  }
  h+='</div>';

  /* 메모 */
  h+='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:12px;margin-bottom:12px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:8px">📝 메모</div>';
  h+='<textarea id="gp2Memo" style="width:100%;min-height:120px;font-size:12px;line-height:1.7;border:1px solid var(--bdrl);border-radius:6px;padding:8px;resize:vertical;background:var(--bg);color:var(--t1);font-family:var(--f)" placeholder="자유롭게 메모하세요..." data-action="saveMemo">'+escHtml(data.memo)+'</textarea>';
  h+='</div>';

  /* 미완료 이월 알림 */
  const yesterday=_gp2PrevDateStr(d);
  const yData=_gp2Load(yesterday);
  const yPending=yData.todos.filter(function(t){return !t.done;});
  if(yPending.length&&d===_gp2Today()){
    h+='<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:10px;margin-bottom:12px">';
    h+='<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:6px">⚠️ 어제 미완료 ('+yPending.length+'건)</div>';
    yPending.forEach(function(t){
      h+='<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;color:var(--t2)">';
      h+='<span>'+escHtml(t.text)+'</span>';
      h+='<button data-action="carryOver" data-arg="'+escHtml(t.text)+'" style="border:none;background:rgba(245,158,11,0.15);color:#f59e0b;cursor:pointer;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;font-family:var(--f)">오늘로 이월</button>';
      h+='</div>';
    });
    h+='</div>';
  }

  return h;
}

/* ── 날짜 이동 ── */
function _gp2SelectDate(ds,ev){
  _gp2.date=ds;
  _gp2UpdateCalendar();
  _gp2UpdateDateLabel();
  _gp2UpdateEvents();
  /* 팝업 열기 */
  _gp2OpenPopup(ds,ev);
}
function _gp2PrevDay(){
  const d=new Date(_gp2.date);d.setDate(d.getDate()-1);
  _gp2.date=_gp2DateStr(d);_gp2.calYear=d.getFullYear();_gp2.calMonth=d.getMonth();_gp2Render();
}
function _gp2NextDay(){
  const d=new Date(_gp2.date);d.setDate(d.getDate()+1);
  _gp2.date=_gp2DateStr(d);_gp2.calYear=d.getFullYear();_gp2.calMonth=d.getMonth();_gp2Render();
}
function _gp2DateStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function _gp2PrevDateStr(ds){const d=new Date(ds);d.setDate(d.getDate()-1);return _gp2DateStr(d);}

/* ── 할 일 CRUD ── */
export function _gp2AddTodo(){
  const d=_gp2.date;const data=_gp2Load(d);
  data.todos.push({text:'',done:false,completedAt:null});
  _gp2Save(d,data);_gp2UpdateDayContent();_gp2UpdateCalendar();_gp2ShowSaveToast();
  setTimeout(function(){
    const inputs=document.querySelectorAll('#gp2TodoList input.form-input');
    if(inputs.length)inputs[inputs.length-1].focus();
  },50);
}
function _gp2ToggleTodo(idx){
  const d=_gp2.date;const data=_gp2Load(d);
  if(!data.todos[idx])return;
  data.todos[idx].done=!data.todos[idx].done;
  if(data.todos[idx].done){
    const now=new Date();
    data.todos[idx].completedAt=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  } else {
    data.todos[idx].completedAt=null;
  }
  _gp2Save(d,data);_gp2UpdateDayContent();_gp2UpdateCalendar();_gp2ShowSaveToast();
}
function _gp2UpdateTodo(idx,val){
  const d=_gp2.date;const data=_gp2Load(d);
  if(!data.todos[idx])return;
  data.todos[idx].text=val;
  _gp2Save(d,data);_gp2ShowSaveToast();
  /* 구글 캘린더에 동기화 */
  const writeCalId=_gp2.primaryCalId||'primary';
  const canSync=val&&!data.todos[idx].calEventId&&writeCalId&&window.electronAPI;
  if(canSync){
    const nextDay=new Date(d);nextDay.setDate(nextDay.getDate()+1);
    const endDate=nextDay.getFullYear()+'-'+String(nextDay.getMonth()+1).padStart(2,'0')+'-'+String(nextDay.getDate()).padStart(2,'0');
    window.electronAPI.calendarCreate(writeCalId,{
      summary:val,
      colorId:_gp2SelectedColorId,
      start:{date:d},
      end:{date:endDate}
    }).then(function(res){
      if(res&&res.success){
        const eid=(res.data&&res.data.id)||'saved';
        const freshData=_gp2Load(d);
        if(freshData.todos[idx])freshData.todos[idx].calEventId=eid;
        _gp2Save(d,freshData);
      }
    }).catch(function(){});
  }
}
function _gp2DeleteTodo(idx){
  const d=_gp2.date;const data=_gp2Load(d);
  data.todos.splice(idx,1);
  _gp2Save(d,data);_gp2UpdateDayContent();_gp2UpdateCalendar();_gp2ShowSaveToast();
}
export function _gp2SaveMemo(){
  const el=document.getElementById('gp2Memo');if(!el)return;
  const d=_gp2.date;const data=_gp2Load(d);
  data.memo=el.value;
  _gp2Save(d,data);
  _gp2ShowSaveToast();
}
function _gp2ShowSaveToast(){
  const toast=document.getElementById('globalSaveToast');
  if(toast){
    _rhSavingToast(toast);
    setTimeout(function(){
      _rhSavedToast(toast);
      setTimeout(function(){toast.className='global-save-toast';},3000);
    },300);
  }
}
function _gp2CarryOver(text){
  const d=_gp2.date;const data=_gp2Load(d);
  data.todos.push({text:text,done:false,completedAt:null});
  _gp2Save(d,data);_gp2RefreshDay();
}

function _gp2RefreshDay(){
  const content=document.getElementById('gp2DayContent');
  if(content){content.innerHTML=_gp2DayContentHtml();_gp2SetupDelegation(content);}
}

/* ── 구글 캘린더 연결 + 이벤트 가져오기 ── */
export function _gp2ConnectCalendar(){
  if(!window.electronAPI){alert('Electron API 없음');return;}
  const statusEl=document.getElementById('gp2GcalStatus');
  if(statusEl)statusEl.textContent='연결 중...';
  window.electronAPI.plannerFetchMonthEvents(_gp2.date||_gp2Today()).then(function(bundleRes){
    if(_cbApplyBasic(_gp2,bundleRes)){
      
      _gp2UpdateCalendar();_gp2UpdateEvents();_gp2UpdateDayContent();
      if(statusEl)statusEl.innerHTML=_cbStatusHtml((bundleRes.data.calendars||[]).length,(bundleRes.data.totalCount||0),0);
      return;
    }
    _gp2ShowLoginGuide();
  }).catch(function(){_gp2ShowLoginGuide();});
}

function _gp2ShowLoginGuide(){
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='gp2LoginOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let h='<div class="modal-content" style="width:460px;max-width:94vw;padding:0">';
  /* 헤더 */
  h+='<div style="background:rgba(6,182,212,0.10);padding:16px 20px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
  h+='<div style="font-size:15px;font-weight:800;color:var(--t1)">📆 Google Calendar 연결</div>';
  h+='</div>';
  /* 본문 */
  h+='<div style="padding:20px">';
  h+='<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">';
  h+='<div style="width:48px;height:48px;border-radius:12px;background:#4285f4;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>';
  h+='<div><div style="font-size:13px;font-weight:700;color:var(--t1)">Google 계정으로 로그인</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-top:2px">캘린더 일정을 불러오려면 Google 로그인이 필요합니다</div></div>';
  h+='</div>';
  /* 안내 사항 */
  h+='<div style="background:var(--bg2);border-radius:8px;padding:14px;font-size:11px;color:var(--t2);line-height:1.8">';
  h+='<div style="margin-bottom:6px"><strong>연결하면 이런 기능을 사용할 수 있습니다:</strong></div>';
  h+='<div>📅 달력에 내 일정이 표시됩니다</div>';
  h+='<div>🔄 날짜별로 일정을 확인할 수 있습니다</div>';
  h+='<div>💾 한 번 로그인하면 다음부터 자동 연결됩니다</div>';
  h+='<div>🔒 개인 캘린더는 읽기만 하며 수정하지 않습니다</div>';
  h+='</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-top:12px;line-height:1.6">';
  h+='※ 버튼을 누르면 브라우저에서 Google 로그인 페이지가 열립니다.<br>';
  h+='※ 로그인 완료 후 "로그인 성공!" 메시지가 보이면 브라우저를 닫아주세요.</div>';
  h+='</div>';
  /* 하단 버튼 */
  h+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  h+='<button data-action="closeLogin" style="padding:8px 18px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>';
  h+='<button id="gp2LoginBtn" data-action="doLogin" style="padding:8px 22px;font-size:12px;font-weight:700;background:#4285f4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:6px">';
  h+='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
  h+='Google 로그인</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  _gp2SetupDelegation(ov);
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
}

function _gp2DoLogin(){
  const btn=document.getElementById('gp2LoginBtn');
  const statusEl=document.getElementById('gp2GcalStatus');
  if(btn){btn.disabled=true;btn.innerHTML=_rhLoginLoading();}
  window.electronAPI.googleLogin().then(function(loginRes){
    if(!loginRes||!loginRes.success){
      if(btn){btn.disabled=false;btn.innerHTML=_rhLoginDefault();}
      alert('Google 로그인 실패: '+(loginRes&&loginRes.error||'알 수 없는 오류'));
      return;
    }
    /* 로그인 성공 — 캘린더 가져오기 */
    if(btn)btn.innerHTML=_rhLoginSuccess();
    return window.electronAPI.plannerFetchMonthEvents(_gp2.date||_gp2Today()).then(function(bundleRes){
      if(_cbApplyBasic(_gp2,bundleRes)){
        
        _gp2UpdateCalendar();_gp2UpdateEvents();_gp2UpdateDayContent();
      }
      const ov=document.getElementById('gp2LoginOverlay');if(ov)closeModalWithAnim(ov);
    });
  }).catch(function(err){
    if(btn){btn.disabled=false;btn.innerHTML=_rhLoginDefault();}
    alert('오류: '+err.message);
  });
}

/* ── 구글 캘린더 이벤트 가져오기 ── */
function _gp2FetchEvents(){
  if(!window.electronAPI)return;
  const statusEl=document.getElementById('gp2GcalStatus');
  if(statusEl)statusEl.textContent='📅 일정 불러오는 중...';
  window.electronAPI.plannerFetchMonthEvents(_gp2.date||_gp2Today()).then(function(bundleRes){
    if(!bundleRes||!bundleRes.success)throw new Error((bundleRes&&bundleRes.error)||'캘린더 목록 실패');
    const calendars=(bundleRes.data&&bundleRes.data.calendars)||[];
    _cbApplyDetailed(_gp2,bundleRes);
    const d=_gp2.date||_gp2Today();
    _gp2UpdateCalendar();
    _gp2UpdateEvents();
    _gp2UpdateDayContent();
    const todayEvents=(_gp2.events[d]||[]).length;
    if(statusEl)statusEl.innerHTML=_cbStatusHtml(calendars.length,((bundleRes.data&&bundleRes.data.totalCount)||0),todayEvents);
  }).catch(function(e){
    if(statusEl)statusEl.textContent='⚠️ 오류: '+e.message;
  });
}

/* ── 검색 ── */
function _gp2Search(){
  const q=document.getElementById('gp2SearchInput');
  const results=document.getElementById('gp2SearchResults');
  if(!q||!results)return;
  const query=q.value.trim().toLowerCase();
  if(!query){results.innerHTML='';return;}
  const found=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(!key.startsWith('gp2_'))continue;
    const raw=localStorage.getItem(key);
    if(raw.toLowerCase().indexOf(query)===-1)continue;
    try{
      const data=JSON.parse(raw);
      const matches=[];
      data.todos.forEach(function(t){if(t.text.toLowerCase().indexOf(query)!==-1)matches.push('✅ '+t.text);});
      if(data.memo&&data.memo.toLowerCase().indexOf(query)!==-1)matches.push('📝 '+data.memo.substring(0,60));
      if(matches.length)found.push({date:data.date,matches:matches});
    }catch(e){}
  }
  found.sort(function(a,b){return b.date.localeCompare(a.date);});
  if(!found.length){results.innerHTML='<div style="font-size:10px;color:var(--t3);padding:6px">검색 결과 없음</div>';return;}
  let h='';
  found.forEach(function(f){
    h+='<div data-action="selectDate" data-arg="'+f.date+'" style="padding:6px 4px;border-bottom:1px solid var(--bdrl);cursor:pointer;transition:background 0.1s" data-hover-bg="var(--hover)" data-rest-bg="">';
    h+='<div style="font-size:10px;font-weight:700;color:var(--cyan)">'+f.date+'</div>';
    f.matches.forEach(function(m){h+='<div style="font-size:10px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(m)+'</div>';});
    h+='</div>';
  });
  results.innerHTML=h;
  _gp2SetupDelegation(results);
}

/* _gp2Prompt / _gp2PromptMulti — 내부 전용 (인라인 onclick 미사용), 전역 노출 제거 */

/* ── 위젯 리사이즈 ── */
const _gp2WR={el:null,type:null,startX:0,startY:0,startW:0,startH:0,startSpan:1};
function _gp2WidgetResizeStart(e,widget,type){
  e.preventDefault();e.stopPropagation();
  _gp2WR.el=widget;
  _gp2WR.type=type;
  _gp2WR.startX=e.clientX;
  _gp2WR.startY=e.clientY;
  _gp2WR.startW=widget.offsetWidth;
  _gp2WR.startH=widget.offsetHeight;
  const span=widget.style.gridColumn?parseInt(widget.style.gridColumn.replace('span ',''))||1:1;
  _gp2WR.startSpan=span;
  document.addEventListener('mousemove',_gp2WidgetResizeMove);
  document.addEventListener('mouseup',_gp2WidgetResizeEnd);
  document.body.style.cursor='nwse-resize';
  document.body.style.userSelect='none';
}
function _gp2WidgetResizeMove(e){
  if(!_gp2WR.el)return;
  const dx=e.clientX-_gp2WR.startX;
  const dy=e.clientY-_gp2WR.startY;
  /* 가로: grid-column span 조절 (1~6) */
  const area=document.getElementById('gp2BottomArea');
  const colW=area?(area.offsetWidth-50)/6:150;
  const newColSpan=Math.max(1,Math.min(6,Math.round((_gp2WR.startW+dx)/colW)));
  _gp2WR.el.style.gridColumn='span '+newColSpan;
  /* 세로: grid-row span 조절 + min-height */
  const rowH=70; /* 기본 행 높이 근사치 */
  const newH=Math.max(60,_gp2WR.startH+dy);
  const newRowSpan=Math.max(1,Math.round(newH/rowH));
  _gp2WR.el.style.gridRow='span '+newRowSpan;
  _gp2WR.el.style.minHeight=newH+'px';
}
function _gp2WidgetResizeEnd(){
  document.removeEventListener('mousemove',_gp2WidgetResizeMove);
  document.removeEventListener('mouseup',_gp2WidgetResizeEnd);
  document.body.style.cursor='';
  document.body.style.userSelect='';
  if(!_gp2WR.el)return;
  const cs=_gp2WR.el.style.gridColumn?parseInt(_gp2WR.el.style.gridColumn.replace('span ',''))||1:1;
  const rs=_gp2WR.el.style.gridRow?parseInt(_gp2WR.el.style.gridRow.replace('span ',''))||1:1;
  const h=parseInt(_gp2WR.el.style.minHeight)||0;
  localStorage.setItem('gp2_wsize_'+_gp2WR.type,JSON.stringify({w:cs,h:h,rw:rs}));
  _gp2WR.el=null;
}

/* ── 위젯 커스텀 드래그 이동 ── */
const _gp2WD={el:null,clone:null,type:null,active:false,startX:0,startY:0};
function _gp2HandleDragStart(e,type,widget){
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  _gp2WD.type=type;
  _gp2WD.el=widget;
  _gp2WD.active=false;
  _gp2WD.startX=e.clientX;
  _gp2WD.startY=e.clientY;
  document.addEventListener('mousemove',_gp2HandleDragMove);
  document.addEventListener('mouseup',_gp2HandleDragEnd);
}
function _gp2HandleDragMove(e){
  if(!_gp2WD.el)return;
  if(!_gp2WD.active){
    if(Math.abs(e.clientX-_gp2WD.startX)<4&&Math.abs(e.clientY-_gp2WD.startY)<4)return;
    _gp2WD.active=true;
    /* 클론 생성 (레고 블럭) */
    const clone=_gp2WD.el.cloneNode(true);
    clone.id='';
    clone.style.cssText='position:fixed;z-index:12000;width:'+_gp2WD.el.offsetWidth+'px;opacity:0.85;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.3);border:2px solid var(--cyan);border-radius:10px;background:var(--card);transform:rotate(2deg);transition:none';
    document.body.appendChild(clone);
    _gp2WD.clone=clone;
    _gp2WD.el.style.opacity='0.25';
    document.body.style.cursor='grabbing';
    document.body.style.userSelect='none';
  }
  /* 클론을 마우스 따라 이동 */
  _gp2WD.clone.style.left=(e.clientX+10)+'px';
  _gp2WD.clone.style.top=(e.clientY-20)+'px';
  /* 드롭 위치 표시 (파란 세로 줄) */
  const area=document.getElementById('gp2BottomArea');if(!area)return;
  const oldBar=document.getElementById('gp2DropBar');if(oldBar)oldBar.remove();
  const target=_gp2FindDropTarget(e.clientX,e.clientY);
  if(target&&target!==_gp2WD.el){
    const bar=document.createElement('div');
    bar.id='gp2DropBar';
    bar.style.cssText='width:3px;background:var(--cyan);border-radius:2px;align-self:stretch;flex-shrink:0;box-shadow:0 0 8px rgba(6,182,212,0.5)';
    area.insertBefore(bar,target);
  }
}
function _gp2HandleDragEnd(e){
  document.removeEventListener('mousemove',_gp2HandleDragMove);
  document.removeEventListener('mouseup',_gp2HandleDragEnd);
  document.body.style.cursor='';
  document.body.style.userSelect='';
  if(!_gp2WD.el)return;
  _gp2WD.el.style.opacity='';
  if(_gp2WD.clone){_gp2WD.clone.remove();_gp2WD.clone=null;}
  const dropBar=document.getElementById('gp2DropBar');if(dropBar)dropBar.remove();
  if(_gp2WD.active){
    const target=_gp2FindDropTarget(e.clientX,e.clientY);
    if(target&&target!==_gp2WD.el){
      const area=document.getElementById('gp2BottomArea');
      if(area)area.insertBefore(_gp2WD.el,target);
      _gp2SaveWidgetLayout();
    }
  }
  _gp2WD.el=null;_gp2WD.type=null;_gp2WD.active=false;
}
function _gp2FindDropTarget(cx,cy){
  const area=document.getElementById('gp2BottomArea');if(!area)return null;
  const widgets=area.querySelectorAll('[data-widget]');
  let best=null, bestDist=Infinity;
  widgets.forEach(function(w){
    if(w===_gp2WD.el)return;
    const rect=w.getBoundingClientRect();
    const wx=rect.left+rect.width/2, wy=rect.top+rect.height/2;
    const dist=Math.sqrt((cx-wx)*(cx-wx)+(cy-wy)*(cy-wy));
    if(dist<bestDist){bestDist=dist;best=w;}
  });
  return best;
}

/* ── 하단 위젯 영역 리사이즈 ── */
let _gp2BottomResizeData=null;
export function _gp2StartResizeBottom(e){
  e.preventDefault();e.stopPropagation();
  const area=document.getElementById('gp2BottomArea');if(!area)return;
  if(!area.style.minHeight)area.style.minHeight=area.offsetHeight+'px';
  _gp2BottomResizeData={startY:e.clientY,startH:parseInt(area.style.minHeight)};
  document.addEventListener('mousemove',_gp2OnResizeBottom,true);
  document.addEventListener('mouseup',_gp2StopResizeBottom,true);
  document.body.style.cursor='grabbing';document.body.style.userSelect='none';
}
function _gp2OnResizeBottom(e){
  if(!_gp2BottomResizeData)return;e.preventDefault();
  const delta=e.clientY-_gp2BottomResizeData.startY;
  const newH=Math.max(100,_gp2BottomResizeData.startH+delta);
  const area=document.getElementById('gp2BottomArea');
  if(area)area.style.minHeight=newH+'px';
}
function _gp2StopResizeBottom(){
  _gp2BottomResizeData=null;
  document.removeEventListener('mousemove',_gp2OnResizeBottom,true);
  document.removeEventListener('mouseup',_gp2StopResizeBottom,true);
  document.body.style.cursor='';document.body.style.userSelect='';
}

/* ── 위젯 보관함 ── */
export function _gp2ToggleWidgetStore(ev){
  const store=document.getElementById('gp2WidgetStore');if(!store)return;
  if(store.style.display!=='none'){
    store.style.transition='opacity 0.2s ease,transform 0.2s ease';store.style.opacity='0';store.style.transform='scale(0.97)';
    setTimeout(function(){store.style.display='none';store.style.transition='';},200);
    return;
  }
  _gp2RenderStoreItems();
  store.style.display='block';store.style.opacity='0';store.style.transform='scale(0.95)';
  /* 버튼 오른쪽 옆, 버튼 윗변 기준 */
  const btn=document.querySelector('#gp2WidgetStoreBtn button');
  if(btn){
    const rect=btn.getBoundingClientRect();
    let left=rect.right+8;
    let top=rect.top;
    const sw=store.offsetWidth||800;
    if(left+sw>window.innerWidth-10)left=window.innerWidth-sw-10;
    if(left<10)left=10;
    if(top+store.offsetHeight>window.innerHeight-10)top=window.innerHeight-store.offsetHeight-10;
    if(top<10)top=10;
    store.style.left=left+'px';
    store.style.top=top+'px';
  }
  requestAnimationFrame(function(){store.style.transition='opacity 0.25s ease,transform 0.25s ease';store.style.opacity='1';store.style.transform='scale(1)';});
}
/* 팝업 외부 클릭 닫기 */
document.addEventListener('mousedown',function(e){
  const store=document.getElementById('gp2WidgetStore');
  if(store&&store.style.display!=='none'&&!store.contains(e.target)&&!e.target.closest('#gp2WidgetStoreBtn')){
    store.style.transition='opacity 0.2s ease,transform 0.2s ease';store.style.opacity='0';store.style.transform='scale(0.97)';
    setTimeout(function(){store.style.display='none';store.style.transition='';},200);
  }
});

const _gp2WidgetPreviews={
  quicklinks:{icon:'🔗',title:'Quick Links',desc:'자주 방문하는 사이트 바로가기',preview:'<div style="font-size:9px">🌐 나이스<br>🌐 교육통계</div>'},
  routine:{icon:'⟳',title:'Routine Tracker',desc:'매일 반복하는 루틴 체크',preview:'<div style="font-size:9px">☑ 출근 체크<br>☐ 보건일지</div>'},
  todolist:{icon:'☑',title:'To-Do List',desc:'전역 할 일 목록',preview:'<div style="font-size:9px">☐ 약품 발주<br>☑ <s>서류 제출</s></div>'},
  search:{icon:'🔍',title:'전체 검색',desc:'키워드로 전체 기간 검색',preview:'<div style="font-size:9px;color:#64748b">키워드로 검색...</div>'},
  timetable:{icon:'📅',title:'시간표',desc:'Ctrl+V, 드래그, 파일 선택',preview:'<div style="background:#f0f4ff;border-radius:4px;height:30px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#64748b">📁 이미지</div>'},
  contacts:{icon:'📞',title:'연락처 변환기',desc:'엑셀 → 구글 연락처 CSV 변환',preview:'<div style="font-size:8px;color:#64748b">김OO 교장<br>→ 📥 CSV</div>'},
  dday:{icon:'📌',title:'D-Day',desc:'중요 일정 카운트다운',preview:'<div style="font-size:9px"><b style="color:var(--cyan)">D-35</b> 여름방학</div>'},
  shopping:{icon:'🛒',title:'구매 목록',desc:'구매할 물건 체크리스트',preview:'<div style="font-size:9px">☐ 체온계<br>☑ <s>에탄올</s></div>'},
  quote:{icon:'💬',title:'명언/격언',desc:'매일 바뀌는 명언, 커스텀 가능',preview:'<div style="font-size:9px;font-style:italic">"불을 지피는 것이다"</div>'},
  meal:{icon:'🍽️',title:'급식 메뉴',desc:'Ctrl+V, 드래그, 파일 선택',preview:'<div style="background:#fef9ef;border-radius:4px;height:30px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#92400e">📁 이미지</div>'},
  progress:{icon:'👍',title:'업무 진척도',desc:'업무별 진행률 프로그레스 바',preview:'<div style="font-size:9px">건강검사 <div style="background:#e2e8f0;border-radius:2px;height:6px;margin:2px 0"><div style="background:var(--cyan);width:70%;height:100%;border-radius:2px"></div></div></div>'},
  scrap:{icon:'📌',title:'웹 스크랩',desc:'URL을 북마크 카드로 저장',preview:'<div style="font-size:9px">🌐 교육부 매뉴얼</div>'},
  birthday:{icon:'🎂',title:'생일 알림',desc:'학생 선택하여 생일 관리',preview:'<div style="font-size:9px">🎂 김OO (3-2)</div>'},
  schedule:{icon:'📋',title:'학사일정',desc:'Ctrl+V, 드래그, 파일 선택',preview:'<div style="background:#f0f4ff;border-radius:4px;height:30px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#64748b">📁 이미지</div>'},
  notepad:{icon:'📓',title:'자유 메모장',desc:'자유 메모 공간 (연초록)',preview:'<div style="font-size:9px;color:#64748b;font-style:italic;background:#f0fdf4;padding:2px 4px;border-radius:3px">메모...</div>'},
  calculator:{icon:'🔢',title:'간단 계산기',desc:'수식 입력 → 즉시 계산',preview:'<div style="font-size:9px">25×30 = <b>750</b></div>'},
  phonebook:{icon:'📱',title:'업무 연락처',desc:'자주 사용하는 연락처 저장',preview:'<div style="font-size:9px">📱 교무실<br>📱 행정실</div>'},
  exchange:{icon:'💱',title:'환율',desc:'주요 통화 실시간 환율',preview:'<div style="font-size:9px">🇺🇸 1,350원</div>'},
  stock:{icon:'📈',title:'주식',desc:'관심 종목 현재가 조회',preview:'<div style="font-size:9px">삼성전자 <span style="color:#ef4444">-1.2%</span></div>'},
  progressB:{icon:'✊',title:'업무 진척도 B형',desc:'체크리스트 기반 진척도',preview:'<div style="font-size:9px">☑ 자료수집 ☑ 분석<br>☐ 보고서 = 67%</div>'},
  driveBackup:{icon:'☁️',title:'Drive 백업',desc:'매직 스테이션 데이터 클라우드 백업',preview:'<div style="font-size:9px">☁️ 백업/복원</div>'},
  dustAirkorea:{icon:'🌫️',title:'미세먼지',desc:'에어코리아 PM2.5/PM10',preview:'<div style="font-size:9px">PM2.5: 25 <span style="color:#22c55e">좋음</span></div>'}
};

function _gp2RenderStoreItems(){
  const el=document.getElementById('gp2StoreItems');if(!el)return;
  let h='';
  Object.keys(_gp2WidgetPreviews).forEach(function(type){
    const w=_gp2WidgetPreviews[type];
    const placed=!!document.getElementById('gp2Widget_'+type);
    h+='<div data-wtype="'+type+'" style="padding:8px;background:var(--card);border:1px solid var(--bdr);border-radius:8px;cursor:'+(placed?'default':'pointer')+';transition:all 0.15s;user-select:none;'+(placed?'opacity:0.3;pointer-events:none':'')+'">';
    h+='<div style="text-align:center;font-size:20px;margin-bottom:2px;pointer-events:none">'+w.icon+'</div>';
    h+='<div style="text-align:center;font-size:10px;font-weight:700;color:var(--t1);pointer-events:none">'+w.title+'</div>';
    h+='<div style="text-align:center;font-size:8px;color:var(--t3);pointer-events:none;margin-top:1px">'+w.desc+'</div>';
    if(placed)h+='<div style="text-align:center;font-size:8px;color:var(--cyan);margin-top:2px;pointer-events:none">✓ 배치됨</div>';
    h+='</div>';
  });
  el.innerHTML=h;
  /* mouseenter/mouseleave for store items */
  el.querySelectorAll('[data-wtype]').forEach(function(item){
    const isPlaced=item.style.opacity==='0.3';
    item.addEventListener('mouseenter',function(){if(!isPlaced)this.style.animation='gp2Bounce 0.4s ease';this.style.borderColor='var(--cyan)';});
    item.addEventListener('mouseleave',function(){this.style.animation='';this.style.borderColor='var(--bdr)';});
  });
}
/* 위젯 보관함 이벤트 위임 (한 번만 등록) */
document.addEventListener('click',function(e){
  const item=e.target.closest('[data-wtype]');
  if(!item)return;
  const store=document.getElementById('gp2WidgetStore');
  if(!store||store.style.display==='none')return;
  const type=item.getAttribute('data-wtype');
  if(!type||document.getElementById('gp2Widget_'+type))return;
  /* A/B형 중복 방지 */
  if(type==='progress'&&document.getElementById('gp2Widget_progressB'))return;
  if(type==='progressB'&&document.getElementById('gp2Widget_progress'))return;
  _gp2AddWidgetToArea(type);
  _gp2RenderStoreItems();
});
export function _gp2WidgetDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='copy';
  const area=document.getElementById('gp2BottomArea');
  if(area)area.style.borderColor='var(--cyan)';
}
export function _gp2WidgetDrop(e){
  e.preventDefault();
  const area=document.getElementById('gp2BottomArea');
  if(area)area.style.borderColor='transparent';
  const type=e.dataTransfer.getData('text/plain')||_gp2DraggingWidget;
  if(!type)return;
  _gp2AddWidgetToArea(type);
  _gp2DraggingWidget=null;
  _gp2StoreDragging=false;
  /* 보관함 업데이트 */
  _gp2RenderStoreItems();
}

const _gp2WidgetDefs={
  quicklinks:{icon:'🔗',title:'Quick Links',tip:'업무, 일상에서 자주 사용하는 웹 링크 모음입니다. 제목을 클릭하여 추가.',html:'<div id="gp2LinkList"></div>'},
  routine:{icon:'⟳',title:'Routine Tracker',tip:'매일 반복하는 루틴 체크. 제목을 클릭하여 추가.',html:'<div id="gp2RoutineList"></div>'},
  todolist:{icon:'☑',title:'To-Do List',tip:'전역 할 일 목록. 제목을 클릭하여 추가.',html:'<div id="gp2GlobalTodoList"></div>'},
  search:{icon:'🔍',title:'전체 검색',tip:'모든 날짜의 할 일/메모를 키워드로 검색.',html:'<div style="display:flex;gap:4px"><input class="form-input" id="gp2SearchInput" placeholder="검색..." style="flex:1;font-size:10px"></div><div id="gp2SearchResults" style="max-height:150px;overflow-y:auto;scrollbar-width:thin"></div>'},
  timetable:{icon:'📅',title:'시간표',tip:'이미지를 Ctrl+V, 드래그, 또는 파일 선택으로 등록.',html:'<div id="gp2TimetableDropZone" class="gp2-upload-zone" style="border:2px dashed var(--bdr);border-radius:8px;padding:16px;text-align:center;cursor:pointer;transition:border-color 0.15s"><div style="font-size:20px;margin-bottom:4px">📁</div><div style="font-size:10px;color:var(--t3);line-height:1.6">이미지를 여기에 드래그하거나<br>Ctrl+V로 붙여넣기<br>또는 클릭하여 파일 선택</div><input type="file" id="gp2TimetableFile" accept="image/*,.pdf" style="display:none"></div><div id="gp2TimetableImg"></div>'},
  contacts:{icon:'📞',title:'연락처 변환기',tip:'엑셀/이미지에서 연락처를 추출하여 구글 연락처용 CSV로 변환합니다.',html:'<div id="gp2ContactsUploadZone" class="gp2-upload-zone" style="border:2px dashed var(--bdr);border-radius:8px;padding:12px;text-align:center;cursor:pointer;transition:border-color 0.15s"><div style="font-size:18px;margin-bottom:4px">📁</div><div style="font-size:10px;color:var(--t3);line-height:1.5">엑셀(.xlsx) 파일을 드래그하거나<br>클릭하여 파일 선택<br>또는 텍스트를 아래에 직접 붙여넣기</div><input type="file" id="gp2ContactsFile" accept=".xlsx,.xls,.csv" style="display:none"></div><textarea class="form-input" id="gp2ContactsInput" placeholder="이름&#9;직위&#9;전화번호 (탭 구분으로 붙여넣기)" style="width:100%;height:50px;font-size:10px;resize:vertical;margin-top:6px;display:none"></textarea><div id="gp2ContactsTable" style="margin-top:6px"></div><div id="gp2ContactsExport" style="margin-top:6px;display:none"><select class="form-input" id="gp2ContactsFormat" style="font-size:10px;margin-bottom:4px"><option value="name_pos_school">{이름} ({직위}, {학교})</option><option value="school_name_pos">{학교} {이름} {직위}</option><option value="name_school_pos">{이름} ({학교} {직위})</option><option value="custom">직접 입력</option></select><input class="form-input" id="gp2ContactsCustomFmt" placeholder="{이름} {직위} {학교}" style="width:100%;font-size:10px;display:none;margin-bottom:4px"><button class="btn btn-primary btn-sm" id="gp2ContactsCsvBtn" style="font-size:10px;width:100%">📥 구글 연락처용 CSV 다운로드</button></div>'},
  dday:{icon:'📌',title:'D-Day',tip:'중요 일정 카운트다운. 제목을 클릭하여 추가.',html:'<div id="gp2DdayList"></div>'},
  shopping:{icon:'🛒',title:'구매 목록',tip:'구매할 물건 체크리스트. 제목을 클릭하여 추가.',html:'<div id="gp2ShopList"></div>'},
  quote:{icon:'💬',title:'명언/격언',tip:'매일 바뀌는 명언. 제목을 클릭하여 나만의 명언 등록.',html:'<div id="gp2QuoteText" style="font-size:11px;line-height:1.6;color:var(--t1);font-style:italic;padding:6px 0"></div>'},
  meal:{icon:'🍽️',title:'급식 메뉴',tip:'급식 메뉴 이미지를 Ctrl+V, 드래그, 또는 파일 선택으로 등록.',html:'<div id="gp2MealDropZone" class="gp2-upload-zone" style="border:2px dashed var(--bdr);border-radius:8px;padding:16px;text-align:center;cursor:pointer;transition:border-color 0.15s"><div style="font-size:20px;margin-bottom:4px">📁</div><div style="font-size:10px;color:var(--t3);line-height:1.6">이미지를 여기에 드래그하거나<br>Ctrl+V로 붙여넣기<br>또는 클릭하여 파일 선택</div><input type="file" id="gp2MealFile" accept="image/*,.pdf" style="display:none"></div><div id="gp2MealImg"></div>'},
  progress:{icon:'👍',title:'업무 진척도',tip:'기간별 목표를 설정하고 진행 상황을 추적합니다. 제목을 클릭하여 추가.',html:'<div id="gp2ProgressList"></div>'},
  scrap:{icon:'📌',title:'웹 스크랩',tip:'URL을 붙여넣으면 북마크 카드로 저장. 제목을 클릭하여 추가.',html:'<div id="gp2ScrapList"></div>'},
  birthday:{icon:'🎂',title:'생일 알림',tip:'기억할 학생을 선택하여 생일을 관리. 제목을 클릭하여 추가.',html:'<div id="gp2BirthdayList"></div>'},
  schedule:{icon:'📋',title:'학사일정',tip:'학사일정 이미지를 Ctrl+V, 드래그, 또는 파일 선택으로 등록.',html:'<div id="gp2ScheduleDropZone" class="gp2-upload-zone" style="border:2px dashed var(--bdr);border-radius:8px;padding:16px;text-align:center;cursor:pointer;transition:border-color 0.15s"><div style="font-size:20px;margin-bottom:4px">📁</div><div style="font-size:10px;color:var(--t3);line-height:1.6">학사일정 이미지를 여기에 드래그하거나<br>Ctrl+V로 붙여넣기<br>또는 클릭하여 파일 선택</div><input type="file" id="gp2ScheduleFile" accept="image/*,.pdf" style="display:none"></div><div id="gp2ScheduleImg"></div>'},
  notepad:{icon:'📓',title:'자유 메모장',tip:'날짜와 무관한 자유 메모. 제목 또는 + 버튼을 클릭하여 추가.',html:'<div id="gp2NotepadList"></div><div style="text-align:center;margin-top:4px"><button id="gp2NoteAddBtn" style="border:none;background:rgba(6,182,212,0.1);color:var(--cyan);cursor:pointer;font-size:14px;width:28px;height:28px;border-radius:50%;transition:all 0.15s;font-family:var(--f)" title="새 메모 추가">＋</button></div>'},
  calculator:{icon:'🔢',title:'간단 계산기',tip:'수식을 입력하고 Enter로 계산.',html:'<input class="form-input" id="gp2CalcInput" placeholder="수식 입력 (예: 25*30)" style="width:100%;font-size:11px"><div id="gp2CalcResult" style="font-size:14px;font-weight:700;color:var(--cyan);margin-top:4px;text-align:right"></div>'},
  phonebook:{icon:'📱',title:'업무 연락처',tip:'자주 사용하는 연락처 저장. 제목을 클릭하여 추가.',html:'<div id="gp2PhoneList"></div>'},
  exchange:{icon:'💱',title:'환율',tip:'주요 통화 실시간 환율.',html:'<div id="gp2ExchangeResult" style="font-size:11px;color:var(--t2)">로딩 중...</div>'},
  stock:{icon:'📈',title:'주식',tip:'관심 종목 현재가. 제목을 클릭하여 종목 추가.',html:'<div id="gp2StockResult"></div><div id="gp2StockSetup" style="display:none"><div style="display:flex;gap:4px;margin-top:6px"><input class="form-input" id="gp2StockTicker" placeholder="종목코드 (예: 005930.KS)" style="flex:1;font-size:10px"><button class="btn btn-primary btn-sm" id="gp2StockBtn" style="font-size:9px">조회</button></div><div style="font-size:9px;color:var(--t3);margin-top:3px">(종목코드, 티커를 입력하세요. 예: 005930.KS, AAPL)</div></div>'},
  progressB:{icon:'✊',title:'업무 진척도 B형',tip:'체크리스트 기반 진척도. 제목을 클릭하여 추가.',html:'<div id="gp2ProgressBList"></div>'},
  driveBackup:{icon:'☁️',title:'Drive 백업',tip:'매직 스테이션 데이터를 Google Drive에 백업/복원합니다.',html:'<div id="gp2DriveBackupArea"><div style="display:flex;gap:6px"><button class="btn btn-primary btn-sm" id="gp2DriveBackupBtn" style="font-size:10px;flex:1">☁️ 백업</button><button class="btn btn-outline btn-sm" id="gp2DriveRestoreBtn" style="font-size:10px;flex:1">📥 복원</button></div><div id="gp2DriveStatus" style="font-size:9px;color:var(--t3);margin-top:4px"></div></div>'},
  dustAirkorea:{icon:'🌫️',title:'미세먼지',tip:'에어코리아 실시간 미세먼지. 제목을 클릭하여 설정.',html:'<div id="gp2AirkoreaResult"></div><div id="gp2AirkoreaSetup" style="'+(localStorage.getItem('gp2_airkorea_key')?'display:none':'')+'"><label style="font-size:10px;color:var(--t3)">에어코리아 API 키</label><input class="form-input" id="gp2AirkoreaKey" value="'+(localStorage.getItem('gp2_airkorea_key')||'')+'" placeholder="공공데이터포털에서 발급" style="width:100%;font-size:10px;margin-top:2px"><label style="font-size:10px;color:var(--t3);margin-top:4px;display:block">측정소명</label><div style="display:flex;gap:4px;margin-top:2px"><input class="form-input" id="gp2AirkoreaStation" value="'+(localStorage.getItem('gp2_airkorea_station')||'')+'" placeholder="예: 논산" style="flex:1;font-size:10px"><button class="btn btn-primary btn-sm" id="gp2AirkoreaBtn" style="font-size:9px">저장 및 조회</button></div><div style="margin-top:4px"><a href="#" id="gp2AirkoreaApiLink" style="font-size:9px;color:var(--cyan)">API 키 발급받기 →</a></div></div>'}
};

function _gp2AddWidgetToArea(type){
  const def=_gp2WidgetDefs[type];if(!def)return;
  if(document.getElementById('gp2Widget_'+type)){return;}
  const area=document.getElementById('gp2BottomArea');if(!area)return;
  const widget=document.createElement('div');
  widget.id='gp2Widget_'+type;
  widget.setAttribute('data-widget',type);
  widget.style.cssText='padding:10px;overflow:hidden;position:relative;border:0.5px solid rgba(150,150,150,0.15);transition:border-color 0.15s,box-shadow 0.15s;border-radius:10px;background:var(--card);grid-column:span 2;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,0.06),inset 0 1px 0 rgba(255,255,255,0.04)';
  widget.addEventListener('mouseenter',function(){const c=this.querySelector('.gp2-widget-close');if(c)c.style.opacity='1';});
  widget.addEventListener('mouseleave',function(){const c=this.querySelector('.gp2-widget-close');if(c)c.style.opacity='0';});
  /* 헤더: ⠿드래그핸들 + 제목 + ✕ */
  const header=document.createElement('div');
  header.style.cssText='display:flex;align-items:center;gap:4px;margin-bottom:6px;user-select:none';
  /* ⠿ 드래그 핸들 (mousedown으로 커스텀 드래그) */
  const handle=document.createElement('span');
  handle.style.cssText='cursor:grab;font-size:12px;color:var(--t3);padding:4px 6px;border-radius:4px;transition:all 0.1s;flex-shrink:0';
  handle.textContent='⠿';
  handle.title='드래그하여 이동';
  handle.addEventListener('mouseenter',function(){this.style.background='var(--hover)';this.style.color='var(--cyan)';});
  handle.addEventListener('mouseleave',function(){this.style.background='';this.style.color='var(--t3)';});
  handle.addEventListener('mousedown',function(e){_gp2HandleDragStart(e,type,widget);});
  header.appendChild(handle);
  const titleSpan=document.createElement('span');
  titleSpan.style.cssText='font-size:11px;font-weight:700;color:var(--t1);flex:1;cursor:pointer;transition:color 0.1s';
  titleSpan.textContent=def.icon+' '+def.title;
  if(def.tip)titleSpan.title=def.tip;
  titleSpan.addEventListener('mouseenter',function(){this.style.color='var(--cyan)';});
  titleSpan.addEventListener('mouseleave',function(){this.style.color='var(--t1)';});
  /* 제목 클릭 → 위젯별 설정/추가 동작 */
  titleSpan.addEventListener('click',function(){_gp2OnTitleClick(type);});
  header.appendChild(titleSpan);
  const closeBtn=document.createElement('button');
  closeBtn.className='gp2-widget-close';
  closeBtn.style.cssText='border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:12px;opacity:0;transition:opacity 0.15s;pointer-events:auto';
  closeBtn.textContent='✕';
  closeBtn.addEventListener('click',function(){_gp2RemoveWidget(type);});
  header.appendChild(closeBtn);
  widget.appendChild(header);
  /* 본문 */
  const body=document.createElement('div');
  body.innerHTML=def.html;
  widget.appendChild(body);
  /* 리사이즈 핸들 (우하단) */
  const resizeHandle=document.createElement('div');
  resizeHandle.style.cssText='position:absolute;right:1px;bottom:1px;width:16px;height:16px;cursor:nwse-resize;opacity:0.35;transition:opacity 0.15s;color:var(--t3)';
  resizeHandle.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16"><path d="M14 4L4 14" stroke="currentColor" stroke-width="1.5"/><path d="M14 8L8 14" stroke="currentColor" stroke-width="1.5"/><path d="M14 12L12 14" stroke="currentColor" stroke-width="1.5"/></svg>';
  resizeHandle.title='드래그하여 크기 조정';
  resizeHandle.addEventListener('mouseenter',function(){this.style.opacity='1';this.style.color='var(--cyan)';});
  resizeHandle.addEventListener('mouseleave',function(){this.style.opacity='0.35';this.style.color='var(--t3)';});
  resizeHandle.addEventListener('mousedown',function(e){_gp2WidgetResizeStart(e,widget,type);});
  widget.appendChild(resizeHandle);
  area.appendChild(widget);
  /* 저장된 크기 복원 */
  const savedSize=JSON.parse(localStorage.getItem('gp2_wsize_'+type)||'null');
  if(savedSize){
    if(savedSize.w)widget.style.gridColumn='span '+Math.min(6,savedSize.w);
    if(savedSize.rw&&savedSize.rw>1)widget.style.gridRow='span '+savedSize.rw;
    if(savedSize.h)widget.style.minHeight=savedSize.h+'px';
  }
  const hint=document.getElementById('gp2DropHint');if(hint)hint.style.display='none';
  _gp2UpdateStoreVisibility();
  _gp2SaveWidgetLayout();
  /* 위젯 초기화 + addEventListener 바인딩 */
  if(type==='quicklinks')_gp2UpdateLinks();
  if(type==='routine')_gp2UpdateRoutines();
  if(type==='todolist')_gp2UpdateGlobalTodos();
  if(type==='quote')_gp2InitQuote();
  if(type==='dday')_gp2InitDday();
  if(type==='shopping')_gp2InitShop();
  if(type==='phonebook')_gp2InitPhone();
  if(type==='exchange')_gp2InitExchange();
  if(type==='progress')_gp2InitProgress();
  if(type==='scrap')_gp2InitScrap();
  if(type==='birthday')_gp2InitBirthday();
  if(type==='notepad'){_gp2InitNotepad();const nab=document.getElementById('gp2NoteAddBtn');if(nab)nab.addEventListener('click',_gp2AddNote);}
  if(type==='calculator'){const ci=document.getElementById('gp2CalcInput');if(ci)ci.addEventListener('keydown',function(e){if(e.key==='Enter')_gp2Calc();});}
  if(type==='search'){const si=document.getElementById('gp2SearchInput');if(si)si.addEventListener('keydown',function(e){if(e.key==='Enter')_gp2Search();});}
  /* 주식: 조회 버튼 바인딩 */
  if(type==='stock'){
    _gp2InitStock();
    const sb=document.getElementById('gp2StockBtn');if(sb)sb.addEventListener('click',_gp2LoadStock);
    const si=document.getElementById('gp2StockTicker');if(si)si.addEventListener('keydown',function(e){if(e.key==='Enter')_gp2LoadStock();});
  }
  /* 미세먼지: 조회 버튼 바인딩 */
  if(type==='contacts')_gp2InitContacts();
  if(type==='progressB')_gp2InitProgressB();
  if(type==='driveBackup')_gp2InitDriveBackup();
  if(type==='dustAirkorea'){
    const ab=document.getElementById('gp2AirkoreaBtn');if(ab)ab.addEventListener('click',_gp2LoadAirkorea);
    const al=document.getElementById('gp2AirkoreaApiLink');if(al)al.addEventListener('click',function(e){e.preventDefault();window.electronAPI.openExternal('https://www.data.go.kr/data/15073861/openapi.do');});
    const ak=localStorage.getItem('gp2_airkorea_key');if(ak)_gp2LoadAirkorea();
  }
  /* 이미지 업로드 영역 (시간표, 급식, 학사일정) */
  ['timetable','meal','schedule'].forEach(function(wt){
    if(type!==wt)return;
    const zone=document.getElementById('gp2'+wt.charAt(0).toUpperCase()+wt.slice(1)+'DropZone');
    const fileInput=document.getElementById('gp2'+wt.charAt(0).toUpperCase()+wt.slice(1)+'File');
    const imgDiv=document.getElementById('gp2'+wt.charAt(0).toUpperCase()+wt.slice(1)+'Img');
    const lsKey='gp2_'+wt;
    if(!zone)return;
    /* 클릭 → 파일 선택 */
    zone.addEventListener('click',function(){if(fileInput)fileInput.click();});
    /* 파일 선택 */
    if(fileInput)fileInput.addEventListener('change',function(){_gp2HandleImageFile(this.files[0],imgDiv,lsKey,zone);});
    /* 드래그 앤 드롭 */
    zone.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
    zone.addEventListener('dragleave',function(){this.style.borderColor='var(--bdr)';});
    zone.addEventListener('drop',function(e){e.preventDefault();this.style.borderColor='var(--bdr)';if(e.dataTransfer.files.length)_gp2HandleImageFile(e.dataTransfer.files[0],imgDiv,lsKey,zone);});
    /* Ctrl+V 붙여넣기 */
    widget.addEventListener('paste',function(e){
      const items=e.clipboardData&&e.clipboardData.items;if(!items)return;
      for(let i=0;i<items.length;i++){
        if(items[i].type.indexOf('image')!==-1){
          _gp2HandleImageFile(items[i].getAsFile(),imgDiv,lsKey,zone);break;
        }
      }
    });
    /* 저장된 이미지 복원 */
    const saved=localStorage.getItem(lsKey);
    if(saved&&imgDiv){imgDiv.innerHTML='<img src="'+saved+'" style="width:100%;border-radius:6px;margin-top:6px">';zone.style.display='none';}
  });
}

function _gp2RemoveWidget(type){
  const el=document.getElementById('gp2Widget_'+type);
  if(el){
    el.style.animation='gp2WidgetOut 0.28s cubic-bezier(0.4,0,0.2,1) forwards';
    el.style.pointerEvents='none';
    setTimeout(function(){
      el.remove();
      const area=document.getElementById('gp2BottomArea');
      const hint=document.getElementById('gp2DropHint');
      if(area&&hint&&!area.querySelector('[id^="gp2Widget_"]'))hint.style.display='block';
      _gp2UpdateStoreVisibility();
      _gp2SaveWidgetLayout();
    },280);
  } else {
    _gp2UpdateStoreVisibility();
    _gp2SaveWidgetLayout();
  }
}

function _gp2UpdateStoreVisibility(){
  /* A/B형 상호 비활성 */
  const hasA=!!document.getElementById('gp2Widget_progress');
  const hasB=!!document.getElementById('gp2Widget_progressB');
  document.querySelectorAll('[data-wtype]').forEach(function(item){
    const type=item.getAttribute('data-wtype');
    const placed=!!document.getElementById('gp2Widget_'+type);
    const disabled=placed||(type==='progress'&&hasB)||(type==='progressB'&&hasA);
    item.style.opacity=disabled?'0.3':'';
    item.style.pointerEvents=disabled?'none':'';
  });
}

function _gp2SaveWidgetLayout(){
  const area=document.getElementById('gp2BottomArea');if(!area)return;
  const types=[];
  area.querySelectorAll('[id^="gp2Widget_"]').forEach(function(w){
    types.push(w.id.replace('gp2Widget_',''));
  });
  _ssSaveWidgetLayout(types);
}

function _gp2RestoreWidgetLayout(){
  const saved = _ssLoadWidgetLayout();
  if(saved && saved.length){ saved.forEach(function(type){ _gp2AddWidgetToArea(type); }); }
}

/* ── Public exports ── */

/* ── Google Drive 저장 경로 선택 ── */
export function _gp2OpenDrivePathPicker(){
  const saved=JSON.parse(localStorage.getItem('gp2_drive_path')||'null');
  /* Drive 폴더 선택 팝업 — 설정의 Drive 폴더 브라우저 재사용 */
  if(!window.electronAPI||!window.electronAPI.driveListFolders){
    bus.emit('toast:show', {text: 'Google Drive 연결이 필요합니다.'});
    return;
  }
  const parentId=(saved&&saved.id)||null;
  const parentName=(saved&&saved.name)||'내 드라이브 (루트)';
  const pathStack=(saved&&saved.path)?saved.path.slice():[];
  const ov=document.createElement('div');ov.id='gp2DrivePickerOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9700;display:flex;align-items:center;justify-content:center';
  let box='<div style="background:var(--card);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.25);width:400px;max-height:500px;display:flex;flex-direction:column;overflow:hidden">';
  box+='<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between"><span style="font-size:13px;font-weight:700;color:var(--t1)">Google Drive 저장 경로 선택</span><button data-action="dp-close" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--t3)">✕</button></div>';
  box+='<div style="padding:8px 16px;font-size:11px;color:var(--t3)">현재: <b id="gp2DpCurPath">'+escHtml(parentName)+'</b></div>';
  box+='<div id="gp2DpList" style="flex:1;overflow-y:auto;padding:8px 16px;min-height:200px"><div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">로딩 중...</div></div>';
  box+='<div style="padding:10px 16px;border-top:1px solid var(--bdr);display:flex;gap:8px;justify-content:flex-end">';
  box+='<button data-action="dp-select" style="padding:6px 16px;font-size:11px;font-weight:700;background:var(--cyan);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">이 폴더 선택</button>';
  box+='<button data-action="dp-cancel" style="padding:6px 16px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>';
  box+='</div></div>';
  ov.innerHTML=box;
  document.body.appendChild(ov);
  ov.addEventListener('mousedown',function(e){if(e.target===ov)closeModalGracefully(ov);});
  /* 버튼 이벤트 바인딩 */
  ov.querySelectorAll('[data-action="dp-close"],[data-action="dp-cancel"]').forEach(function(btn){
    btn.addEventListener('click',function(){closeModalGracefully('gp2DrivePickerOverlay');});
  });
  const dpSelBtn=ov.querySelector('[data-action="dp-select"]');
  if(dpSelBtn)dpSelBtn.addEventListener('click',function(){_gp2DpSelect();});
  /* 폴더 로드 */
  let _dpParentId=parentId;
  const _dpPathStack=pathStack;
  function _dpLoad(){
    const list=document.getElementById('gp2DpList');if(!list)return;
    list.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">로딩 중...</div>';
    window.electronAPI.driveListFolders(_dpParentId||null).then(function(res){
      if(!res||!res.success){list.innerHTML='<div style="color:#ef4444;padding:10px;font-size:11px">로드 실패</div>';return;}
      const folders=res.folders||[];
      let h='';
      if(_dpParentId){h+='<div class="gp2-dp-item" data-action="dp-up" style="padding:6px 8px;cursor:pointer;border-radius:6px;font-size:11px;color:var(--cyan);font-weight:600;display:flex;align-items:center;gap:4px">⬆ 상위 폴더</div>';}
      folders.forEach(function(f){
        h+='<div class="gp2-dp-item" data-folder-id="'+escHtml(f.id)+'" data-folder-name="'+escHtml(f.name)+'" style="padding:6px 8px;cursor:pointer;border-radius:6px;font-size:11px;color:var(--t1);display:flex;align-items:center;gap:6px">📁 '+escHtml(f.name)+'</div>';
      });
      if(!folders.length&&!_dpParentId)h+='<div style="padding:10px;color:var(--t3);font-size:11px;text-align:center">폴더가 없습니다</div>';
      list.innerHTML=h;
      /* 폴더 항목 이벤트 바인딩 */
      const upBtn=list.querySelector('[data-action="dp-up"]');
      if(upBtn){
        upBtn.addEventListener('click',function(){_gp2DpUp();});
        upBtn.addEventListener('mouseenter',function(){this.style.background='var(--bg2)';});
        upBtn.addEventListener('mouseleave',function(){this.style.background='';});
      }
      list.querySelectorAll('[data-folder-id]').forEach(function(item){
        item.addEventListener('click',function(){_gp2DpEnter(this.getAttribute('data-folder-id'),this.getAttribute('data-folder-name'));});
        item.addEventListener('mouseenter',function(){this.style.background='var(--bg2)';});
        item.addEventListener('mouseleave',function(){this.style.background='';});
      });
    }).catch(function(){
      const list2=document.getElementById('gp2DpList');if(list2)list2.innerHTML='<div style="color:#ef4444;padding:10px;font-size:11px">Drive 연결 실패</div>';
    });
  }
  function _gp2DpEnter(folderId,folderName){
    _dpPathStack.push({id:_dpParentId,name:document.getElementById('gp2DpCurPath').textContent});
    _dpParentId=folderId;
    const cp=document.getElementById('gp2DpCurPath');if(cp)cp.textContent=folderName;
    _dpLoad();
  }
  function _gp2DpUp(){
    if(!_dpPathStack.length)return;
    const prev=_dpPathStack.pop();
    _dpParentId=prev.id;
    const cp=document.getElementById('gp2DpCurPath');if(cp)cp.textContent=prev.name;
    _dpLoad();
  }
  function _gp2DpSelect(){
    const name=document.getElementById('gp2DpCurPath').textContent;
    const data={id:_dpParentId,name:name,path:_dpPathStack.slice()};
    localStorage.setItem('gp2_drive_path',JSON.stringify(data));
    const label=document.getElementById('gp2DrivePathLabel');
    if(label){label.textContent=name;label.style.color='var(--cyan)';}
    const ov2=document.getElementById('gp2DrivePickerOverlay');if(ov2)closeModalGracefully(ov2);
    bus.emit('toast:show', {text: 'Drive 저장 경로: '+name});
  }
  _dpLoad();
}
/* Drive 경로 초기 라벨 복원 */
{
  const saved=JSON.parse(localStorage.getItem('gp2_drive_path')||'null');
  if(saved&&saved.name){
    const label=document.getElementById('gp2DrivePathLabel');
    if(label){label.textContent=saved.name;label.style.color='var(--cyan)';}
  }
}

