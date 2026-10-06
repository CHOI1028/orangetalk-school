/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * 🏠 홈 대시보드 — 위젯 기반 홈 화면
 *
 * macOS 대시보드처럼 위젯 카드를 사용자가 선택·정렬하여 배치.
 * 위젯 선택 순서대로 그리드에 표시. 드래그 불필요 — 체크박스 선택 순서로 정렬.
 *
 * localStorage: ec_home_widgets = JSON array of widget ids (선택+순서)
 */
/* ES Module */
import { getStu, escHtml, closeModalGracefully } from '../../core/helpers.js';
import { compareClass } from '../../core/student-utils.js';
import { appConfirmModal } from '../../core/ui-utils.js';
import { S, ensureHolidayYear } from '../../core/app-state.js';
import { _statMedicationStr, _statHasBed } from '../../core/record-utils.js';
import { getGreeting } from './home-greetings.js';
import { getPublicDataApiKey } from '../../core/public-data-settings.js';
import { dailyColEyeIcon, showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { isHoliday } from '../../core/format-utils.js';
import { bus } from '../../core/event-bus.js';
import { getAcademicSpans, loadAcademicMonth, academicMonthBusy } from '../../core/academic-schedule.js';
import { getMealsForDate, neisKey, resolveNeisCode, neisFetchJson, NEIS_BASE } from '../../core/school-meal.js';
import { getRegionTop, userSidoCd, getInfectiousRequestKey, getInfectiousErrorMessage, clearInfectiousCache, INFECTIOUS_CACHE_TTL_MS } from '../../core/infectious-disease.js';

/* 공휴일 캐시가 비동기로 채워지면(다른 연도 lazy fetch 등) 홈 달력도 즉시 다시 그린다.
   renderHomeDashboard 는 홈 미표시 시 area 없음→즉시 반환하므로 백그라운드 부담 없음. */
bus.on('holidays:updated', function(){ try{ renderHomeDashboard(); }catch(_){} });
bus.on('classpopup:changed', function(){ try{ renderHomeDashboard(); }catch(_){} });   /* 수업 선택/알림 변경 → 나의 시간표 위젯 갱신 */

/* 학년반 짧은 표기 (helpers에 없으면 자체 구현) */
/* 대시보드 영역 data-tooltip 위임 — 증상 패널과 동일한 showHeaderTooltip GUI.
 *  data-tooltip-html 이면 HTML(<br> 등, 여러 줄) 허용, data-tooltip-instant 면 지연 없이 즉시. */
let _homeTipCurEl=null;
function _onHomeAreaTipOver(e){
  const el=e.target.closest&&e.target.closest('[data-tooltip]');
  if(!el||el===_homeTipCurEl)return;
  _homeTipCurEl=el;
  const txt=el.getAttribute('data-tooltip');
  if(txt&&typeof showHeaderTooltip==='function')showHeaderTooltip({currentTarget:el,target:el},txt,el.hasAttribute('data-tooltip-html'),el.hasAttribute('data-tooltip-instant'));
}
function _onHomeAreaTipOut(e){
  const el=e.target.closest&&e.target.closest('[data-tooltip]');
  if(!el)return;
  if(e.relatedTarget&&el.contains(e.relatedTarget))return;
  _homeTipCurEl=null;
  if(typeof hideHeaderTooltip==='function')hideHeaderTooltip();
}
function getStuGradeCol(s, opts){
  if(!s)return '';
  const grade=s.grade||'';
  const cls=s.class_num||s.cls||'';
  const num=s.student_num||s.num||'';
  if(opts&&opts.short)return grade+'-'+cls;
  return grade+'-'+cls+' '+num+'번';
}

/* ── 위젯 레지스트리 ── */
const WIDGETS = [
  /* 보건 전용 (DB 기반) */
  {id:'todayVisit',   icon:'📊', title:'오늘 방문 요약',       desc:'학생·교직원 오늘 방문 수'},
  {id:'bed',          icon:'🛏', title:'침상 현황',            desc:'사용 중 침상 수'},
  {id:'rental',       icon:'📦', title:'대여/미반납 물품',      desc:'대여·미반납 건수'},
  {id:'topMeds',      icon:'💊', title:'투약 Top 5',           desc:'오늘 가장 많이 사용한 약품'},
  {id:'frequent',     icon:'🔄', title:'자주 오는 학생',        desc:'이번 주 3회 이상 방문 학생'},
  {id:'peakHour',     icon:'🕐', title:'시간대 피크',           desc:'오늘 시간대별 방문 분포'},
  {id:'todayTreat',   icon:'📋', title:'오늘 처치 요약',        desc:'처치 항목별 건수'},
  {id:'gradeVisit',   icon:'🏫', title:'학년별 오늘 방문',      desc:'학년별 방문 분포'},
  {id:'caution',      icon:'⚠️',  title:'요보호 학생 최근 방문', desc:'요보호 지정 학생의 방문 이력'},
  {id:'birthday',     icon:'🎂', title:'이번 주 생일 학생',     desc:'이번 주 생일자 명단'},
  /* 플래너 공유 위젯 (localStorage 양방향 동기) */
  {id:'quicklinks',   icon:'🔗', title:'자주 가는 사이트',      desc:'북마크 링크 모음'},
  {id:'phonebook',    icon:'📱', title:'업무 연락처',           desc:'자주 거는 전화번호'},
  {id:'notepad',      icon:'📓', title:'자유 메모장',           desc:'간단한 메모 (플래너 동기)'},
  {id:'todolist',     icon:'☑', title:'오늘 할 일',    desc:'캘린더와 함께 관리하는 오늘의 일정·할 일'},
  {id:'routine',      icon:'⟳', title:'루틴 트래커',           desc:'매일 반복할 체크 항목'},
  {id:'shopping',     icon:'🛒', title:'구매 목록',             desc:'구매할 물건 체크리스트'},
  /* 보건 운영 보강 위젯 */
  {id:'rentalDue',    icon:'📦', title:'대여 미반납',             desc:'보건실 물품 대여 대장 연동'}
];

const DEFAULT_WIDGETS = ['todayVisit','bed','todayTreat','caution','frequent','infection','peakHour'];

function _getSelectedWidgets(){
  try{
    const raw=localStorage.getItem('ec_home_widgets');
    if(raw){const arr=JSON.parse(raw);if(Array.isArray(arr)&&arr.length)return arr;}
  }catch(e){}
  return DEFAULT_WIDGETS;
}

function _saveSelectedWidgets(arr){
  localStorage.setItem('ec_home_widgets',JSON.stringify(arr));
}

/* ── 학년도 계산 ── */
function _academicYear(){
  const n=new Date();return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}
/* '오늘'은 반드시 로컬(한국) 날짜로 계산한다. toISOString() 은 UTC 라 KST(UTC+9) 자정~오전 9시
 *  사이에는 하루 어제로 밀려, 캔버스 달력 오늘 동그라미·오늘 일정·알람이 어긋났다(2026-07-15 수정).
 *  사이드바 달력이 쓰는 toDateStr(new Date()) 과 동일한 로컬 기준으로 통일. */
function _todayStr(){ const n=new Date(); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); }

/* 인사말은 home-greetings.js 모듈에서 가져옴 (getGreeting) */
function _userName(){
  try{const u=JSON.parse(localStorage.getItem('ec_user')||'{}');return u.name||'';}catch(e){return '';}
}
function _weatherShortLine(){
  const t=localStorage.getItem('ec_temp')||'';
  const w=localStorage.getItem('ec_weatherText')||'';
  const d10=localStorage.getItem('ec_dustG10')||'';
  const parts=[];
  if(w)parts.push(w);
  if(t)parts.push(t+'°');
  if(d10)parts.push('미세먼지 '+d10);
  return parts.join(' · ');
}

/* ── 위젯 카드 셸 빌더 ─────────────────────────────────────────────
 *  보관함의 순서·열배정(_widgetsInCol)을 단일 출처로 렌더하기 위해 위젯 카드 HTML 을 id 로 생성.
 *  기존 하드코딩 카드의 외형·data-action 을 그대로 보존(회귀 0). 가시성은 렌더 후 vis IIFE 에 위임. */
function _hwHeader(icon,title,btn,info){
  return '<div class="school-widget-heading">'
    +'<span class="school-widget-icon" aria-hidden="true">'+icon+'</span>'
    +'<span class="school-widget-title">'+escHtml(title)+'</span>'
    +(info||'')+(btn||'')+'</div>';
}
function _schoolEmpty(icon,title,hint){
  return '<div class="school-empty">'
    +'<span class="school-empty-art" aria-hidden="true">'+icon+'<i></i></span>'
    +'<div class="school-empty-copy"><strong>'+escHtml(title)+'</strong>'
    +(hint?'<p>'+escHtml(hint)+'</p>':'')+'</div></div>';
}
function _schoolWidgetIcon(kind){
  const paths={
    api:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
    loading:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    error:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
    school:'<path d="m3 9 9-6 9 6v12H3V9Zm6 12v-6h6v6M7 10h1m8 0h1M11 8h2"/>',
    weather:'<path d="M6 18a4 4 0 0 1-1-7.9A6 6 0 0 1 17 10a4 4 0 1 1 1 8H6Z"/>',
    list:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8m-8 4h5"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(paths[kind]||paths.list)+'</svg>';
}
function _schoolWidgetButton(action,label,secondary){
  return '<button type="button" class="school-widget-action'+(secondary?' is-secondary':'')+'" data-action="'+escHtml(action)+'">'+escHtml(label)+'</button>';
}
function _schoolWidgetState(kind,title,hint,actions,service){
  const labels={api:'연동 필요',empty:'아직 자료가 없어요',ready:'사용 준비 완료',loading:'불러오는 중',error:'확인이 필요해요'};
  const icon=kind==='api'?'api':kind==='loading'?'loading':kind==='error'?'error':'calendar';
  return '<div class="school-widget-state" data-state="'+escHtml(kind)+'"'+(service?' data-service="'+escHtml(service)+'"':'')+(kind==='loading'?' role="status"':'')+'>'
    +'<div class="school-widget-state-top"><span class="school-widget-state-icon">'+_schoolWidgetIcon(icon)+'</span><span class="school-widget-status">'+escHtml(labels[kind]||labels.empty)+'</span></div>'
    +'<div class="school-widget-state-copy"><strong>'+escHtml(title)+'</strong><p>'+escHtml(hint||'')+'</p></div>'
    +(actions?'<div class="school-widget-actions">'+actions+'</div>':'')+'</div>';
}
function _schoolWidgetApiState(service,description){
  const name=service==='neis'?'나이스(NEIS)':'공공데이터포털';
  return _schoolWidgetState('api',name+' API 키를 등록해 주세요',description,
    _schoolWidgetButton('open-widget-api-settings','API 키 등록하기'),service);
}
function _schoolWidgetDate(){
  return new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short'});
}
function _schoolScheduleList(items,action,label){
  let h='<div class="school-schedule"><div class="school-widget-dateline"><span>'+escHtml(_schoolWidgetDate())+'</span><span class="school-widget-status">'+items.length+'개 수업</span></div><ol class="school-schedule-list">';
  items.forEach(function(item){
    h+='<li><span class="school-schedule-period"><b>'+escHtml(String(item.period))+'</b><small>교시</small></span><div class="school-schedule-copy"><strong>'+escHtml(item.subject)+'</strong>'
      +(item.time?'<span class="school-schedule-time">'+escHtml(item.time)+'</span>':'')+'</div></li>';
  });
  return h+'</ol><div class="school-widget-actions">'+_schoolWidgetButton(action,label,true)+'</div></div>';
}

function _hwAddBtn(action,title){
  return '<button data-action="'+action+'" title="'+title+'" style="border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:14px;display:inline-flex;align-items:center;justify-content:center;font-weight:700">+</button>';
}
function _hwListBody(inner){
  return '<div style="font-size:11px;color:var(--t2);line-height:1.7;display:flex;flex-direction:column;gap:0">'+inner+'</div>';
}
/* 위젯별 설명 — 헤더 ⓘ 호버 시 캘린더 토글과 동일한 showHeaderTooltip 미니 팝업으로 노출. <br> 허용. */
const _HW_DESC = {
  progress:    '오늘·이번 달·학기·학년도가 각각 얼마나 지났는지<br>진행률 막대로 보여줍니다.',
  quicklinks:  '자주 가는 업무 사이트를 모아 두고<br>클릭 한 번으로 바로 엽니다.',
  phonebook:   '자주 거는 업무 전화번호를 저장해 둡니다.',
  procurement: '품의(구매)할 물건 목록을 적어 둡니다.',
  routine:     '매일 반복하는 업무를 체크리스트로 관리합니다.',
  todolist:    '캘린더와 같은 오늘의 일정·할 일을 보여줍니다.<br>지난 날짜의 기록은 캘린더에 남습니다.<br>Google 일정의 완료 체크는 오렌지톡 안에서만 표시됩니다.',
  timetable:   '주간 수업 시간표입니다.<br>위젯에는 오늘 요일의 수업만 표시됩니다.',
  lessonmemo:  '수업 차시(주차)별 간단 메모를 적습니다.',
  memos:       '포스트잇처럼 자유롭게 메모를 붙여 둡니다.',
  todayTreat:  '오늘 보건실에서 시행한 처치를<br>항목별 건수로 집계합니다.',
  gradeVisit:  '오늘 방문한 학생을 학년별로 나눠 보여줍니다.',
  topMeds:     '오늘 가장 많이 사용한 약품 순위입니다.',
  peakHour:    '오늘 시간대별 방문 분포(피크 시간대)를 보여줍니다.',
  rentalDue:   '보건실 대여 물품의 반납 예정·미반납 현황입니다.',
  birthday:    '이번 주에 생일을 맞는 학생 명단입니다.',
  bed:         '현재 사용 중인 보건실 침상 현황입니다.',
  caution:     '요보호(주의) 지정 학생의 최근 방문 이력입니다.',
  frequent:    '최근 자주(반복) 방문하는 학생을 보여줍니다.',
};
/* 헤더 ⓘ 아이콘 — data-tooltip(캘린더 토글과 동일 GUI). 설명 없으면 빈 문자열. */
function _hwInfoIcon(wid){
  const d=_HW_DESC[wid];
  if(!d) return '';
  return '<span data-tooltip="'+d+'" data-tooltip-html="1" data-tooltip-instant="1" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--bdr);color:var(--t3);font-size:9px;font-weight:800;font-style:normal;cursor:help;flex-shrink:0;line-height:1;user-select:none">i</span>';
}
const _HOME_WIDGET_RENDERERS = {
  progress:    { header:function(){return _hwHeader('📊','시기별 진행률','<button data-action="prog-gear" title="표시할 항목 켜고 끄기" style="border:1px solid var(--bdr);background:var(--bg2);color:var(--t3);width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center">⚙</button>',_hwInfoIcon('progress'));}, body:function(){return _wProgressContent();} },
  quicklinks:  { header:function(){return _hwHeader('🔗','업무 사이트',_hwAddBtn('add-quicklink','추가'),_hwInfoIcon('quicklinks'));}, body:function(){return _homeCapEl('quicklinks')+_hwListBody(_wQuicklinksEditable());} },
  phonebook:   { header:function(){return _hwHeader('📱','업무 연락처',_hwAddBtn('add-phone','추가'),_hwInfoIcon('phonebook'));}, body:function(){return _homeCapEl('phonebook')+_hwListBody(_wPhonebookEditable());} },
  procurement: { header:function(){return _hwHeader('🛒','구매·품의 목록',_hwAddBtn('add-procurement','추가'),_hwInfoIcon('procurement'));}, body:function(){return _homeCapEl('procurement')+_hwListBody(_wProcurementEditable());} },
  routine:     { header:function(){return _hwHeader('⟳','루틴 트래커',_hwAddBtn('add-routine','추가'),_hwInfoIcon('routine'));}, body:function(){return _homeCapEl('routine')+_hwListBody(_wRoutineEditable());} },
  todolist:    { header:function(){return _hwHeader('☑','오늘 할 일',_hwAddBtn('add-todo','추가'),_hwInfoIcon('todolist'));}, body:function(){return _homeCapEl('todolist')+_hwListBody(_wTodoEditable());} },
  timetable:   { header:function(){return _hwHeader('📅','수업 시간표',_hwAddBtn('open-timetable-editor','시간표 입력·편집'),_hwInfoIcon('timetable'));}, body:function(){return _wTimetableContent();} },
  myTimetable: { header:function(){return _hwHeader('🗓️','나의 시간표 보기','<button data-action="open-classpopup-picker" data-tooltip="나이스에서 불러온 학교 시간표 상 나의 수업 시간을 선택하여 내 시간표를 만듭니다. 또한 팝업 알람까지 설정할 수 있습니다." data-tooltip-instant="1" style="border:1px solid var(--bdr);background:var(--bg2);color:var(--t3);width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center">⚙</button>',_hwInfoIcon('myTimetable'));}, body:function(){return _wMyTimetable();} },
  lessonmemo:  { header:function(){return _hwHeader('📝','수업 메모','<button data-action="lesson-sem-config" title="1·2학기 시작/끝 날짜 설정" style="border:1px solid var(--bdr);background:var(--bg2);color:var(--t3);width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center">⚙</button>',_hwInfoIcon('lessonmemo'));}, body:function(){return _wLessonMemoContent();} },
  memos:       { header:function(){return _hwHeader('📝','포스트잇 메모',_hwAddBtn('add-memo','새 메모 추가'),_hwInfoIcon('memos'));}, body:function(){return '<div id="homeMemoList" style="display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 280px);overflow-y:auto;scrollbar-width:thin">'+_renderHomeMemos()+'</div>';} },
};
/* 위젯 id 로 카드 1장 HTML 생성. 고정 위젯(_HOME_WIDGET_RENDERERS) vs 보건 위젯(WIDGETS+_renderWidget) 분기.
 *  어느 열에 있든 id 기준으로 동일 카드 → 열간 이동해도 일관 렌더. */
function _renderHomeWidgetCard(wid, ctx){
  const R=_HOME_WIDGET_RENDERERS[wid];
  const groupKey=escHtml(_effectiveColOf(wid)||'col1');
  if(R){
    return '<div class="cc home-widget-card home-fixed-pin" data-widget-id="'+wid+'" data-widget-group="'+groupKey+'" style="padding:16px;display:flex;flex-direction:column">'
      +R.header()+'<div class="school-widget-body">'+R.body(ctx)+'</div>'+'</div>';
  }
  /* WIDGETS(구 목록)에 없어도 _HOME_WIDGET_DEFS 메타로 카드 렌더 — meal·wxalert·infectTrend 등이 보관함에서
   *  눈알 ON 인데도 화면에 안 뜨던 버그 수정 (둘 다 아닌 id 만 '' 반환). (사용자 보고 2026-06-17) */
  let def=WIDGETS.find(function(w){return w.id===wid;});
  if(!def){ try{ Object.keys(_HOME_WIDGET_DEFS).forEach(function(ck){ (_HOME_WIDGET_DEFS[ck].items||[]).forEach(function(it){ if(it.id===wid)def=it; }); }); }catch(_){} }
  if(!def) return '';
  const content=_renderWidget(wid, ctx.todayRecs, ctx.ay, ctx.today);
  const conciseTitles={todayTreat:'오늘 처치',gradeVisit:'학년별 방문',timetableSearch:'학교 시간표',schoolStats:'학교 현황',birthday:'이번 주 생일',caution:'요보호 학생',frequent:'반복 방문',wxalert:'기상·보건 알림',infectTrend:'감염병 유행'};
  const _wIcon=def.icon||'📋', _wTitle=conciseTitles[wid]||def.title||def.name||'';
  return '<div class="cc home-widget-card" data-widget-id="'+wid+'" data-widget-group="'+groupKey+'" style="padding:16px;min-height:120px;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s">'
    +_hwHeader(_wIcon,_wTitle,'',_hwInfoIcon(wid))
    +'<div class="school-widget-body">'+content+'</div>'
    +'</div>';
}

/* Existing storage keys stay intact; groups now feed a spacious, row-first board. */
const _SCHOOL_HOME_GROUP_ORDER=['col4','col2','col3','col5','col1'];
function _schoolHomeWidgetPlan(){
  const vis=_getHomeWidgetVis();
  const groups=_SCHOOL_HOME_GROUP_ORDER.map(function(key){
    const def=_HOME_WIDGET_DEFS[key];
    return {
      key:key,
      name:def.name.replace(/^\d+열\s*·\s*/,''),
      widgets:_widgetsInCol(key).filter(function(w){return vis[w.id]!==false;})
    };
  });
  const widgets=[];
  groups.forEach(function(group){group.widgets.forEach(function(w){widgets.push(w);});});
  return {
    calendar:vis.calendar!==false,
    todo:widgets.find(function(w){return w.id==='todolist';}) || null,
    memo:widgets.find(function(w){return w.id==='memos';}) || null,
    widgets:widgets.filter(function(w){return w.id!=='todolist' && w.id!=='memos';}),
    groups:groups.map(function(group){
      return {key:group.key,name:group.name,widgets:group.widgets.filter(function(w){return w.id!=='memos';})};
    }).filter(function(group){return group.widgets.length>0;})
  };
}

/* ── 메인 렌더 ── */
/* 수업메모 스크롤 보존(2026-06-08) — 윈도우 전역 scroll-behavior:smooth 때문에 재렌더 시 0→현재주차로
 *  "부드럽게 굴러가는" 현상이 보였다. 직전 위치를 숫자로 기억→즉시(scroll-behavior:auto) 복원해 움직임 0.
 *  _lessonForceCur=true(최초 로드·학기 변경) 면 기억 안 하고 현재 주차로 보낸다. */
let _lessonSavedScroll=null;
let _lessonForceCur=false;
export function renderHomeDashboard(){
  const area=document.getElementById('homeWidgetArea');
  if(!area)return;

  const selected=_getSelectedWidgets();
  const ay=_academicYear();
  const today=_todayStr();
  const todayRecs=(Array.isArray(S.records)?S.records:[]).filter(function(r){return r.date===today;});

  const userName=_userName();
  const greeting=getGreeting();
  const weatherLine=_weatherShortLine();
  /* 두 줄 인사: "OOO 선생님, 안녕하세요!" / "좋은 오후입니다." */
  const line1=(userName?escHtml(userName)+' 선생님, ':'')+'안녕하세요!';
  const line2=escHtml(greeting);

  /* Keep the greeting and existing widget controls without extra summary cards. */
  let h='<section class="home-hero school-home-hero" aria-label="오늘의 보건실">';
  h+='<div class="school-home-greeting"><span class="school-home-eyebrow">오늘의 보건실</span>';
  h+='<h1>'+line1+'</h1><p>'+line2+'</p></div>';
  h+='<div class="school-home-actions"><button type="button" class="btn-add school-context-toggle" data-school-action="toggle-context" aria-controls="schoolSidebar" aria-expanded="false">날짜·방문 이력</button>';
  h+='<button data-action="open-widget-box" class="school-widget-store-button" style="border:1px solid var(--bdr);background:var(--card);color:var(--t2);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px;font-family:var(--f);flex-shrink:0" data-tooltip="홈 위젯 표시 여부와 그룹별 순서를 설정합니다." data-tooltip-html="1" data-tooltip-instant="1">📦 위젯 보관함</button>';
  h+='</div></section>';

  const _ctx={todayRecs:todayRecs, ay:ay, today:today};
  const _layout=_schoolHomeWidgetPlan();
  // Build even when hidden so calendar-backed tasks and reminders keep working.
  const _calendarHtml=_buildMiniCalendar();
  const _hasHomeSide=!!_layout.memo;
  if(_layout.calendar || _hasHomeSide){
    h+='<div class="school-home-start school-home-memo-first'+(_layout.calendar && _hasHomeSide?' has-calendar-and-side':'')+'">';
    if(_layout.calendar){
      h+='<section class="school-home-calendar" data-widget-id="calendar" data-widget-group="col2" aria-label="일정 캘린더">'+_calendarHtml+'</section>';
    }
    if(_hasHomeSide){
      h+='<div class="school-home-side school-home-memo-column">';
      h+=_renderHomeWidgetCard('memos',_ctx);
      h+='</div>';
    }
    h+='</div>';
  }
  _layout.groups.forEach(function(group){
    const headingId='school-home-group-'+group.key;
    const columns=Math.min(group.widgets.length,group.key==='col2'?2:3);
    h+='<section class="school-widget-group" data-widget-group="'+group.key+'" aria-labelledby="'+headingId+'">';
    h+='<div class="school-widget-group-heading"><h2 id="'+headingId+'">'+escHtml(group.name)+'</h2>';
    h+='<span class="school-widget-group-count">'+group.widgets.length+'개</span></div>';
    h+='<div class="school-widget-group-grid" style="--school-group-columns:'+columns+'">';
    group.widgets.forEach(function(w){h+=_renderHomeWidgetCard(w.id,_ctx);});
    h+='</div></section>';
  });
  if(!_layout.groups.length && !_layout.calendar && !_hasHomeSide){
    h+=_schoolEmpty('📦','필요한 위젯을 꺼내보세요','위젯 보관함에서 홈에 표시할 항목을 선택할 수 있어요.');
  }

  /* 수업메모 스크롤 — 새 hlmList 가 그려지기 직전 현재 위치를 숫자로 기억(복원용).
   *  단, '현재 주차에 자리잡기 전'(시작 churn)·학기변경 때는 기억하지 않아야 현재 주차로 갈 수 있다. */
  let _lpre=null;
  /* 보존 대상은 '보이는 상태에서 사용자가 실제로 스크롤해 둔 위치(>4)'만. 숨김 상태(offsetParent null)거나
   *  맨 위(0~4)면 보존하지 않아 현재 주차로 가게 한다 — 로그인 전환 중 0 으로 리셋된 값을 붙잡지 않도록. */
  if(!_lessonForceCur){ try{ const _o=document.getElementById('hlmList'); if(_o && _o.offsetParent!==null && _o.scrollTop>4) _lpre=_o.scrollTop; }catch(_){} }
  _lessonForceCur=false;
  area.innerHTML=h;
  /* 같은 tick 에 즉시(scroll-behavior:auto) 복원 → 굴러가지 않음. 보존값 없으면 setTimeout 이 현재 주차로. */
  _lessonSavedScroll=_lpre;
  if(_lpre!=null){ try{ const _n=document.getElementById('hlmList'); if(_n){ _n.style.setProperty('scroll-behavior','auto','important'); _n.scrollTop=_lpre; } }catch(_){} }

  area.querySelectorAll('.home-widget-card').forEach(function(card){
    card.addEventListener('mouseenter',function(){this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)';});
    card.addEventListener('mouseleave',function(){this.style.transform='';this.style.boxShadow='';});
  });
  /* 포스트잇 메모 에디터 바인딩 */
  if(typeof _bindMemoEditors==='function')_bindMemoEditors();
  /* 카드 내부 액션 위임 — 모듈 함수 reference 로 자동 dedup (같은 함수는 한 번만 등록됨) */
  area.addEventListener('click',_onHomeAreaClick);
  area.addEventListener('dblclick',_onHomeAreaDblClick);
  /* data-tooltip 호버 툴팁 위임 (Google 연동 등) — 함수 ref 라 재바인딩돼도 dedup */
  area.addEventListener('mouseover',_onHomeAreaTipOver);
  area.addEventListener('mouseout',_onHomeAreaTipOut);
  /* 수업 메모 input + 학기 select change 위임 */
  area.addEventListener('input',_onHomeAreaInput);
  area.addEventListener('change',_onHomeAreaChange);
  /* 위젯 보관함 가시성 일괄 적용 — [data-widget-id] 카드들의 display 토글 */
  (function _applyHomeWidgetVis(){
    const vis = _getHomeWidgetVis();
    area.querySelectorAll('[data-widget-id]').forEach(function(el){
      const id = el.dataset.widgetId;
      el.style.display = (vis[id] === false) ? 'none' : '';
    });
  })();
  const pickerBtnEl=area.querySelector('.home-widget-picker-btn');
  if(pickerBtnEl){
    pickerBtnEl.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';this.style.background='var(--bg2)';});
    pickerBtnEl.addEventListener('mouseleave',function(){this.style.borderColor='var(--bdr)';this.style.background='var(--card)';});
  }
  _bindHomeSyncListeners();
  _bindHomeCalRangeDrag();
}

/* 캡션 더블클릭 → 인라인 input 으로 전환 → blur/Enter 저장 */
function _onHomeAreaDblClick(e){
  /* 수업 시간표 위젯 본문 더블클릭 → 편집 팝업 (사용자 요청 2026-05-28) */
  if(e.target.closest('.tt-body')){ e.preventDefault(); _openTimetableEditor(); return; }
  const cap=e.target.closest('.home-cap[data-cap-key]');
  if(!cap)return;
  if(cap.querySelector('input'))return;
  const key=cap.dataset.capKey;
  const cur=_homeCapGet(key);
  const inp=document.createElement('input');
  inp.type='text';inp.value=cur;inp.maxLength=120;
  inp.style.cssText='width:100%;box-sizing:border-box;padding:3px 6px;font-size:10px;color:var(--t1);background:var(--bg);border:1px solid var(--cyan);border-radius:4px;outline:none;line-height:1.4;font-family:var(--f)';
  cap.innerHTML='';cap.appendChild(inp);
  setTimeout(function(){inp.focus();inp.select();},0);
  let _done=false;
  function _save(){
    if(_done)return;_done=true;
    const v=inp.value.trim();
    _homeCapSet(key,v);
    cap.innerHTML=escHtml(v||_homeCapDefaults[key]||'');
  }
  function _cancel(){if(_done)return;_done=true;cap.innerHTML=escHtml(cur);}
  inp.addEventListener('keydown',function(ev){
    if(ev.key==='Enter'){ev.preventDefault();_save();}
    else if(ev.key==='Escape'){ev.preventDefault();_cancel();}
  });
  inp.addEventListener('blur',_save);
}

/* 수업 메모 input 위임 — 입력 즉시 저장 (debounce 없음, 한 글자씩) */
function _onHomeAreaInput(e){
  const el = e.target.closest && e.target.closest('[data-action]');
  if(!el) return;
  if(el.dataset.action === 'lesson-memo-input'){
    const sem = el.dataset.sem || 'sem1';
    const week = parseInt(el.dataset.week, 10);
    if(!isNaN(week)){ _saveLessonMemo(sem, week, el.value || ''); _homeSaveToast(); }   /* 자동저장 + 토스트 (사용자 지시 2026-06-15) */
  }
}
/* 학기 select change 위임 */
function _onHomeAreaChange(e){
  const el = e.target.closest && e.target.closest('[data-action]');
  if(!el) return;
  if(el.dataset.action === 'lesson-sem-change'){
    try{ localStorage.setItem('ec_home_lesson_semester', el.value); }catch(_){}
    _lessonScrolledFor = null;
    _lessonForceCur = true; /* 학기 바뀜 — 위치 기억 말고 새 학기 현재 주차로 */
    renderHomeDashboard();
  }
}
/* 모듈 레벨 클릭 핸들러 (같은 reference 라 addEventListener 호출 누적되어도 한 번만 등록) */
function _onHomeAreaClick(e){
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const act=el.dataset.action;
  if(true){
    if(act==='open-widget-picker'){e.preventDefault();_openWidgetPicker();return;}
    if(act==='lesson-goto-current'){e.preventDefault();_scrollLessonToCurrent();return;}
    if(act==='home-cal-prev'){
      e.preventDefault();
      _homeCalMonth--;
      if(_homeCalMonth<0){_homeCalMonth=11;_homeCalYear--;}
      renderHomeDashboard();return;
    }
    if(act==='home-cal-next'){
      e.preventDefault();
      _homeCalMonth++;
      if(_homeCalMonth>11){_homeCalMonth=0;_homeCalYear++;}
      renderHomeDashboard();return;
    }
    if(act==='home-cal-refresh'){
      e.preventDefault();
      _homeCalLoaded=false;
      _homeCalPrevSnapshot='';
      _homeCalLoadAsync();
      return;
    }
    if(act==='home-cal-today'){
      e.preventDefault();
      const now=new Date();
      _homeCalYear=now.getFullYear();
      _homeCalMonth=now.getMonth();
      renderHomeDashboard();
      return;
    }
    /* 연·월 호버 팝업 클릭 — 사용자 요청 2026-06-02. 사이드 달력과 동일 동작. */
    if(act==='home-cal-set-year'){
      e.preventDefault();
      const yv=parseInt(el.dataset.arg,10);
      if(!isNaN(yv)&&yv>=1900&&yv<=2999){
        _homeCalYear=yv;
        renderHomeDashboard();
      }
      return;
    }
    if(act==='home-cal-set-month'){
      e.preventDefault();
      const mv=parseInt(el.dataset.arg,10);
      if(!isNaN(mv)&&mv>=0&&mv<=11){
        _homeCalMonth=mv;
        renderHomeDashboard();
      }
      return;
    }
    if(act==='home-cal-connect'){
      e.preventDefault();
      _homeCalConnect();
      return;
    }
    if(act==='gcal-share'){ e.preventDefault(); _homeManageGcalShare(); return; }
    if(act==='home-gcal-on'){
      e.preventDefault();
      /* 구글 기능 비활성(검증 대기) 상태면 깔끔히 안내하고 중단 — 검증 통과 후 활성화 (2026-06-30) */
      if(window.electronAPI && window.electronAPI.isGoogleFeaturesEnabled && !window.electronAPI.isGoogleFeaturesEnabled()){
        appConfirmModal('구글 캘린더 연동은 현재 준비 중입니다. 곧 제공될 예정입니다.','Google 캘린더 연동',{okOnly:true});
        return;
      }
      /* 실제 연동(로그인) 진행 — 동의 후에만 호출 */
      const _proceedGcalOn=function(){
        /* 보안: 켤 때마다 Google 인증 다이얼로그 강제 (계정 확인) */
        if(window.electronAPI&&window.electronAPI.googleLogin){
          window.electronAPI.googleLogin().then(function(res){
            if(res&&res.success){
              _setGcalEnabled(true);
              _homeCalLoaded=false;_homeCalPrevSnapshot='';
              _homeBackfillLocalToGcal().then(function(){ renderHomeDashboard(); });
            } else {
              appConfirmModal('Google 로그인이 완료되지 않았습니다.','Google 캘린더 연동',{okOnly:true});
            }
          }).catch(function(err){appConfirmModal('연결 실패: '+(err&&err.message||err),'Google 캘린더 연동',{okOnly:true});});
        } else {
          /* 웹 모드: IPC 없음 → 그냥 켜기 */
          _setGcalEnabled(true);
          _homeCalLoaded=false;_homeCalPrevSnapshot='';
          renderHomeDashboard();
        }
      };
      /* 켜기 전 개인정보 동의 모달 — 동의해야 연동 진행(취소하면 연동 안 함) */
      if(window.confirmExportConsent){
        window.confirmExportConsent({
          modalTitle:'Google 캘린더 연동 — 동의 필요',
          bodyText:'<b>오렌지톡 캘린더</b>와 <b>구글 캘린더</b>를 연결하시겠습니까?',
          warningText:'',
          footerNote:'',
          iconSvg:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
        }).then(function(ok){ if(ok) _proceedGcalOn(); });
      } else {
        _proceedGcalOn();
      }
      return;
    }
    if(act==='home-gcal-off'){
      e.preventDefault();
      _setGcalEnabled(false);
      _homeCalEvents={};_homeCalLoaded=false;_homeCalCount={calendars:0,total:0};
      renderHomeDashboard();
      return;
    }
    if(act==='home-cal-day'){
      e.preventDefault();
      const ds=el.dataset.arg;
      if(ds)_homeOpenDayPopup(ds);
      return;
    }
    if(act==='academic-color'){ e.preventDefault(); e.stopPropagation(); _openAcademicColorPicker(el, el.getAttribute('data-arg')||''); return; }
    if(act==='range-edit'){ e.preventDefault(); e.stopPropagation(); const rid=el.getAttribute('data-arg'); const r=_localRanges.find(function(x){return x.id===rid;}); if(r)_openRangeEditor(r,r.start,r.end); return; }
    if(act==='open-widget-api-settings'){ e.preventDefault(); import('../settings/settings-view.js').then(function(m){ m.openSettings(); const entry=document.querySelector('#settingsSidebar [data-cat="apikeys"]'); if(entry)entry.click(); }); return; }
    if(act==='retry-widget-meal'){ e.preventDefault(); _mealWidgetCache=null; renderHomeDashboard(); return; }
    if(act==='open-timetable-search'){ e.preventDefault(); import('../../core/timetable.js').then(function(m){ try{ m.showTimetableModal(); }catch(_){} }); return; }
    if(act==='open-classpopup-picker'){ e.preventDefault(); import('../../core/timetable.js').then(function(m){ try{ m.showTimetableModal({pick:true}); }catch(_){} }); return; }
    if(act==='open-my-week'){ e.preventDefault(); _openMyWeekModal(); return; }
    if(act==='open-rental-ledger'){ e.preventDefault(); import('../daily/rental-ledger-view.js').then(function(m){ try{ m.openRentalLedger(); }catch(_){} }); return; }
    if(act==='open-school-stats'){ e.preventDefault(); _openSchoolStatsModal(); return; }
    if(act==='open-infect-detail'){ e.preventDefault(); import('../../core/infectious-disease.js').then(function(m){ try{ m.showInfectiousModal(); }catch(_){} }); return; }
    if(act==='retry-infect-trend'){ e.preventDefault(); _retryInfectTrend(); return; }
    if(act==='open-timetable-editor'){ e.preventDefault(); _openTimetableEditor(); return; }
    if(act==='open-widget-box'){ e.preventDefault(); _openWidgetBoxModal(); return; }
    if(act==='prog-gear'){ e.preventDefault(); _openProgGearModal(); return; }
    if(act==='lesson-sem-config'){ e.preventDefault(); _openLessonSemConfig(); return; }
    if(act==='open-planner'){
      e.preventDefault();
      /* 매직 스테이션 탭으로 이동 (view-router) */
      const navBtn=document.querySelector('[data-view="magic"]');
      if(navBtn)navBtn.click();
      return;
    }
    if(act==='open-gcal'){
      e.preventDefault();
      if(window.electronAPI&&window.electronAPI.openExternal){
        window.electronAPI.openExternal('https://calendar.google.com');
      } else {
        window.open('https://calendar.google.com','_blank');
      }
      return;
    }
    if(act==='open-external'){
      e.preventDefault();
      e.stopPropagation();
      let url=(el.dataset.url||'').trim();
      if(!url)return;
      /* 프로토콜 자동 보완 */
      if(!/^https?:\/\//i.test(url))url='https://'+url.replace(/^\/+/,'');
      if(window.electronAPI&&window.electronAPI.openExternal){
        window.electronAPI.openExternal(url);
      } else {
        window.open(url,'_blank','noopener,noreferrer');
      }
      return;
    }
    if(act==='copy-phone'){
      e.preventDefault();
      const num=el.dataset.num||'';
      if(num&&navigator.clipboard){
        navigator.clipboard.writeText(num).then(function(){
          const prev=el.textContent;
          el.textContent='복사됨 ✓';
          setTimeout(function(){el.textContent=prev;},1200);
        });
      }
      return;
    }
    if(act==='add-quicklink'){e.preventDefault();_homeAddQuicklink();return;}
    if(act==='add-phone'){e.preventDefault();_homeAddPhone();return;}
    if(act==='del-quicklink'){e.preventDefault();_homeDelQuicklink(parseInt(el.dataset.idx,10));return;}
    if(act==='del-phone'){e.preventDefault();_homeDelPhone(parseInt(el.dataset.idx,10));return;}
    if(act==='add-routine'){e.preventDefault();_homeAddRoutine();return;}
    if(act==='add-todo'){e.preventDefault();_homeAddTodo();return;}
    if(act==='del-routine'){e.preventDefault();_homeDelRoutine(parseInt(el.dataset.idx,10));return;}
    if(act==='del-todo'){e.preventDefault();_homeDelTodo(el.dataset.key,el.dataset.date);return;}
    if(act==='retry-todo'){e.preventDefault();_requireHomeCalendar().then(function(){renderHomeDashboard();});return;}
    if(act==='toggle-routine'){_homeToggleRoutine(parseInt(el.dataset.idx,10));return;}
    if(act==='toggle-todo'){_homeToggleTodo(el.dataset.key,el.dataset.date);return;}
    if(act==='toggle-calevent'){_homeToggleCalEvent(el.dataset.key);return;}
    if(act==='add-procurement'){e.preventDefault();_homeAddProcurement();return;}
    if(act==='del-procurement'){e.preventDefault();_homeDelProcurement(parseInt(el.dataset.idx,10));return;}
    if(act==='toggle-procurement'){_homeToggleProcurement(parseInt(el.dataset.idx,10));return;}
    if(act==='open-procurement-url'){
      e.preventDefault();e.stopPropagation();
      /* idx 로 항목 조회 → URL 1개면 바로 열기, 복수면 선택 모달. (구버전 data-url 도 호환) */
      const idx=parseInt(el.dataset.idx,10);
      const items=_prGet();
      const it=(!isNaN(idx)&&items[idx])?items[idx]:null;
      const urls=it?_prUrls(it):(el.dataset.url?[el.dataset.url]:[]);
      if(urls.length===1)_prOpenUrl(urls[0]);
      else if(urls.length>1)_prOpenUrlChooser(it?(it.text||it.title||''):'',urls);
      return;
    }
    if(act==='add-memo'){e.preventDefault();_homeAddMemo();return;}
    if(act==='del-memo'){e.preventDefault();_homeDelMemo(el.dataset.id);return;}
    if(act==='edit-quicklink'){e.preventDefault();_homeEditQuicklink(parseInt(el.dataset.idx,10));return;}
    if(act==='edit-phone'){e.preventDefault();_homeEditPhone(parseInt(el.dataset.idx,10));return;}
    if(act==='edit-procurement'){e.preventDefault();_homeEditProcurement(parseInt(el.dataset.idx,10));return;}
    if(act==='edit-routine'){e.preventDefault();_homeEditRoutine(parseInt(el.dataset.idx,10));return;}
    if(act==='edit-todo'){e.preventDefault();_homeEditTodo(el.dataset.key,el.dataset.date);return;}
  }
}
/* ── 수정 다이얼로그 (펜 아이콘) — 증상/처치 펜 동일한 ✏️ 사용 ── */
async function _homeEditQuicklink(idx){
  const items=_qlGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  const cur=items[idx]||{};
  await _homePromptMulti('🔗 사이트 수정',[
    {label:'사이트 이름',value:cur.name||cur.title||'',placeholder:'예: 나이스 업무포털'},
    {label:'URL',value:cur.url||cur.href||'',placeholder:'https://...'}
  ],{
    onSave:function(vals){
      const ls=_qlGet();if(!ls[idx])return;
      ls[idx]={name:vals[0]||'',url:vals[1]||''};
      _qlSet(ls).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      const ls=_qlGet();ls.splice(idx,1);
      _qlSet(ls).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
async function _homeEditPhone(idx){
  const items=_phGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  const cur=items[idx]||{};
  await _homePromptMulti('📱 전화번호 수정',[
    {label:'이름/소속',value:cur.label||cur.name||'',placeholder:'예: OO교육지원청 체육건강과'},
    {label:'전화번호',value:cur.number||cur.phone||'',placeholder:'02-1234-5678'}
  ],{
    onSave:function(vals){
      const ls=_phGet();if(!ls[idx])return;
      ls[idx]={label:vals[0]||'',number:vals[1]||''};
      _phSet(ls).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      const ls=_phGet();ls.splice(idx,1);
      _phSet(ls).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
async function _homeEditProcurement(idx){
  const items=_prGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  const cur=items[idx]||{};
  await _homePromptMulti('🛒 품의 물건 리스트 수정',[
    {label:'품목',value:cur.text||cur.title||'',placeholder:'예: 알코올 티슈 24개 1박스'},
    {label:'URL (선택 · 복수 가능)',type:'urllist',value:_prUrls(cur)}
  ],{
    onSave:function(vals){
      const ls=_prGet();if(!ls[idx])return;
      const urls=Array.isArray(vals[1])?vals[1]:((vals[1]||'').trim()?[(vals[1]||'').trim()]:[]);
      ls[idx]=Object.assign({},ls[idx],{text:vals[0]||'',urls:urls,url:urls[0]||''});
      _prSet(ls).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      const ls=_prGet();ls.splice(idx,1);
      _prSet(ls).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
async function _homeEditRoutine(idx){
  const items=_rtGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  const cur=items[idx]||{};
  await _homePromptMulti('⟳ 루틴 수정',[
    {label:'루틴 이름',value:cur.text||cur.title||'',placeholder:'예: 보건일지 결재 확인'}
  ],{
    onSave:function(vals){
      const ls=_rtGet();if(!ls[idx])return;
      ls[idx]=Object.assign({},ls[idx],{text:vals[0]||''});
      _rtSet(ls).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      const ls=_rtGet();ls.splice(idx,1);
      _rtSet(ls).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
async function _homeEditTodo(key,ds){
  if(!await _requireHomeCalendar())return;
  ds=ds||_todayStr();
  const ev=_homeFindTodo(key,ds);if(!ev)return;
  if(ev._local)return _homeEditLocalEvent(ds,_homeLocalTodoIndex(ds,ev),null);
  return _homeEditGcalEvent(ds,ev.id,null);
}

/* Google Calendar 로그인/연결 (매직스테이션과 동일 IPC) */
async function _homeCalConnect(){
  if(!(window.electronAPI))return;
  try{
    if(window.electronAPI.googleLogin){
      const loginRes=await window.electronAPI.googleLogin();
      if(loginRes&&loginRes.success){
        _homeCalLoaded=false;
        _homeCalPrevSnapshot='';
        await _homeCalLoadAsync();
        renderHomeDashboard();
      } else {
        appConfirmModal('Google 로그인 실패: '+((loginRes&&loginRes.error)||''),'Google 캘린더 연동',{okOnly:true});
      }
    }
  }catch(e){appConfirmModal('연결 실패: '+e.message,'Google 캘린더 연동',{okOnly:true});}
}

/* 캘린더 셀 높이 리사이즈 — 매직스테이션 스타일 드래그 */
/* ── 캘린더 날짜 드래그 → 기간 선택 (시작일~종료일). 단순 클릭은 기존 당일 팝업 유지. (2026-06-22) ── */
function _bindHomeCalRangeDrag(){
  const grid=document.getElementById('homeCalGrid');
  if(!grid||grid._rangeDragBound)return;
  grid._rangeDragBound=true;
  /* 날짜 셀(빈칸 제외)만 대상 — data-action="home-cal-day" + data-arg=YYYY-MM-DD */
  function _cellOf(t){ return t&&t.closest?t.closest('[data-action="home-cal-day"]'):null; }
  function _cells(){ return Array.prototype.slice.call(grid.querySelectorAll('[data-action="home-cal-day"]')); }
  function _highlight(startDs,endDs){
    const lo=startDs<endDs?startDs:endDs, hi=startDs<endDs?endDs:startDs;
    _cells().forEach(function(c){
      const ds=c.getAttribute('data-arg');
      if(ds>=lo&&ds<=hi){ c.style.outline='2px solid var(--cyan)'; c.style.outlineOffset='-2px'; c.style.background='rgba(6,182,212,0.12)'; }
      else { c.style.outline=''; c.style.outlineOffset=''; /* 원래 배경 복원은 재렌더가 처리 */ }
    });
  }
  function _clearHighlight(){ _cells().forEach(function(c){ c.style.outline=''; c.style.outlineOffset=''; }); }

  grid.addEventListener('mousedown',function(e){
    if(e.button!==0)return;
    const cell=_cellOf(e.target);
    if(!cell)return;
    /* 칸 안의 라벨(학사일정 색상·기간 편집 등)을 누른 경우엔 드래그 시작 안 함 — 그 클릭은 위임 핸들러가 처리 */
    if(e.target.closest('[data-action="academic-color"],[data-action="range-edit"]'))return;
    const startDs=cell.getAttribute('data-arg');
    if(!startDs)return;
    let curDs=startDs, moved=false;
    const startX=e.clientX, startY=e.clientY;
    /* 드래그 중에는 학사일정 막대(절대배치 오버레이)가 elementFromPoint 를 가로채지 않도록 pointer-events 차단 */
    const bars=Array.prototype.slice.call(grid.querySelectorAll('.acad-bar'));
    function _barsPE(v){ bars.forEach(function(b){ b.style.pointerEvents=v; }); }
    function onMove(ev){
      if(!moved && (Math.abs(ev.clientX-startX)>4||Math.abs(ev.clientY-startY)>4)){ moved=true; _barsPE('none'); }
      const overCell=_cellOf(document.elementFromPoint(ev.clientX,ev.clientY));
      if(overCell){ const ds=overCell.getAttribute('data-arg'); if(ds)curDs=ds; }
      if(moved)_highlight(startDs,curDs);
    }
    function onUp(){
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
      _barsPE('');
      _clearHighlight();
      if(moved && curDs!==startDs){
        /* 실제 기간 드래그 → 직후 발생할 click(위임 당일팝업) 1회 차단 */
        const swallow=function(ev){ ev.stopPropagation(); ev.preventDefault(); window.removeEventListener('click',swallow,true); };
        window.addEventListener('click',swallow,true);
        setTimeout(function(){ window.removeEventListener('click',swallow,true); },0);
        const lo=startDs<curDs?startDs:curDs, hi=startDs<curDs?curDs:startDs;
        _openRangeEditor(null,lo,hi);
      }
      /* moved 가 아니거나 같은 날 → 아무것도 안 함. 위임 click 이 당일 팝업 처리. */
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}

let _homeSyncBound=false;
function _bindHomeSyncListeners(){
  if(_homeSyncBound)return;
  _homeSyncBound=true;
  /* 다른 창/탭에서 변경 시 */
  window.addEventListener('storage',function(e){
    if(!e.key)return;
    const syncKeys=['ec_quicklinks','ec_phonebook','ec_notepad','ec_todolist','ec_routine','ec_dday','ec_shopping','ec_home_local_events','ec_home_local_ranges'];
    if(syncKeys.indexOf(e.key)!==-1){
      if(document.getElementById('view-home')&&document.getElementById('view-home').style.display!=='none'){
        renderHomeDashboard();
      }
    }
  });
}

/* ── 개별 위젯 렌더 ── */
function _renderWidget(id,todayRecs,ay,today){
  switch(id){
    case 'todayVisit': return _wTodayVisit(todayRecs);
    case 'bed': return _wBed();
    case 'rental': return _wRental();
    case 'weather': return _wWeather();
    case 'schedule': return _wSchedule();
    case 'topMeds': return _wTopMeds(todayRecs);
    case 'frequent': return _wFrequent(ay);
    case 'peakHour': return _wPeakHour(todayRecs);
    case 'todayTreat': return _wTodayTreat(todayRecs);
    case 'gradeVisit': return _wGradeVisit(todayRecs);
    case 'infection': return _wInfection();
    case 'infectTrend': return _wInfectTrend();
    case 'meal': return _wMeal();
    case 'timetableSearch': return _wTimetableSearch();
    case 'myTimetable': return _wMyTimetable();
    case 'wxalert': return _wWxAlert();
    case 'timetable': return _wTimetable();
    case 'caution': return _wCaution(todayRecs);
    case 'birthday': return _wBirthday();
    case 'weekTrend': return _wWeekTrend();
    case 'kiosk': return _wKiosk();
    case 'quicklinks': return _wQuicklinks();
    case 'phonebook': return _wPhonebook();
    case 'notepad': return _wNotepad();
    case 'todolist': return _wTodolist();
    case 'routine': return _wRoutine();
    case 'dday': return _wDday();
    case 'shopping': return _wShopping();
    case 'medExpiry': return _wMedExpiry();
    case 'diaryApproval': return _wDiaryApproval();
    case 'tbStatus': return _wTbStatus();
    case 'rentalDue': return _wRentalDue();
    case 'schoolStats': return _wSchoolStats();
    default: return _schoolEmpty("📋","아직 표시할 내용이 없어요","기록을 추가하면 이곳에 표시돼요.");
  }
}

/* ── 위젯 구현 ── */

function _wTodayVisit(recs){
  const stu=recs.filter(function(r){const s=typeof getStu==='function'?getStu(r.studentId):null;return s&&s.type==='student';}).length;
  const staff=recs.length-stu;
  return '<div style="display:flex;gap:20px;align-items:baseline">'
    +'<div><span style="font-size:28px;font-weight:900;color:var(--cyan)">'+recs.length+'</span><span style="font-size:10px;color:var(--t3);margin-left:4px">명</span></div>'
    +'<div style="font-size:10px;color:var(--t3)">학생 <b style="color:var(--t1)">'+stu+'</b> · 교직원 <b style="color:var(--t1)">'+staff+'</b></div>'
    +'</div>';
}

function _wBed(){
  /* 침상 데이터 (2026-06-10 수정):
   *  · 분모 total = 등록 침상 개수 = ec_bed_config.beds.length (예전엔 ec_bed_usage.length 로 잘못 읽음)
   *  · 현재 사용 inUse = ec_bed_usage 중 활성(endTime>now)
   *  · 오늘 총 사용 todayUsed = 오늘 일반일지 기록 중 '침상 이용 처치'(기본 침상 칩 + 합성칩 안 침상 포함)를 받은 행
   *    → _statHasBed 로 통일(예전엔 r.bed 컬럼만 봐서 자주쓰는 처치의 침상 칩/합성칩이 안 세짐). */
  let total=0,inUse=0;
  try{
    const cfg=JSON.parse(localStorage.getItem('ec_bed_config')||'null');
    if(cfg&&Array.isArray(cfg.beds))total=cfg.beds.length;
  }catch(e){}
  try{
    const usage=JSON.parse(localStorage.getItem('ec_bed_usage')||'[]');
    if(Array.isArray(usage)){ const now=Date.now(); inUse=usage.filter(function(u){return u&&u.endTime>now;}).length; }
  }catch(e){}
  const today=_todayStr();
  let todayUsed=0;
  if(Array.isArray(S.records)){
    todayUsed=S.records.filter(function(r){ return r.date===today && _statHasBed(r); }).length;
  }
  if(!total&&!todayUsed)return _schoolEmpty("🛏","침상 사용 기록이 없어요","침상 설정과 사용 현황을 확인해 주세요.");
  let h='<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">';
  h+='<div><span style="font-size:11px;color:var(--t3);margin-right:4px">현재 사용</span><span style="font-size:20px;font-weight:800;color:'+(inUse>0?'#f59e0b':'var(--t1)')+'">'+inUse+'</span><span style="font-size:11px;color:var(--t3)"> / '+total+'</span></div>';
  h+='<div><span style="font-size:11px;color:var(--t3);margin-right:4px">오늘 총 사용</span><span style="font-size:20px;font-weight:800;color:var(--cyan)">'+todayUsed+'</span><span style="font-size:11px;color:var(--t3)">건</span></div>';
  h+='</div>';
  return h;
}

function _wRental(){
  try{
    const raw=localStorage.getItem('ec_rental_'+_academicYear());
    if(raw){
      const data=JSON.parse(raw);
      const rows=data.rows||[];
      const unreturned=rows.filter(function(r){return r.item&&!r.returnDate;}).length;
      const total=rows.filter(function(r){return r.item;}).length;
      return '<div style="display:flex;gap:16px">'
        +'<div>대여 <b style="color:var(--t1)">'+total+'</b>건</div>'
        +'<div>미반납 <b style="color:'+(unreturned>0?'#dc2626':'var(--t1)')+'">'+unreturned+'</b>건</div>'
        +'</div>';
    }
  }catch(e){}
  return _schoolEmpty("📦","대여 기록이 없어요","물품을 대여하면 이곳에서 현황을 볼 수 있어요.");
}

function _wWeather(){
  const el=document.getElementById('headerWeatherInfo');
  if(el&&el.textContent.trim())return '<div>'+escHtml(el.textContent.trim())+'</div>';
  const hdrMeta=document.getElementById('header-meta');
  if(hdrMeta){
    const spans=hdrMeta.querySelectorAll('span');
    const parts=[];spans.forEach(function(s){if(s.textContent.trim())parts.push(s.textContent.trim());});
    if(parts.length)return parts.join(' · ');
  }
  return '<span style="color:var(--t3)">날씨 정보 로딩 중...</span>';
}

function _wSchedule(){
  /* 플래너 오늘 일정 */
  const today=_todayStr();
  try{
    const key='ec_planner_events_'+today;
    const raw=localStorage.getItem(key);
    if(raw){
      const evts=JSON.parse(raw);
      if(evts.length){
        return evts.slice(0,4).map(function(e){
          return '<div style="margin-bottom:4px"><b>'+escHtml(e.time||'')+'</b> '+escHtml(e.title||'')+'</div>';
        }).join('');
      }
    }
  }catch(e){}
  return '<span style="color:var(--t3)">오늘 일정이 없습니다</span>';
}

function _wTopMeds(recs){
  const counts={};
  /* v3 — 약품 도즈 부착 라벨도 괄호 앞 base 로 카운트 (사용자 결정 2026-05-21).
   * 예: "타이레놀 (1정)" 과 "타이레놀" 은 "타이레놀" 로 통합. */
  function _baseOfMed(x){
    if(!x)return '';
    const _s=String(x).trim();
    const _m=_s.match(/^(.+?)\s*\(/);
    return _m ? _m[1].trim() : _s;
  }
  recs.forEach(function(r){
    const meds=_statMedicationStr(r)||r.medications||''; /* 합성칩 안 투약 합산 (2026-06-09) */
    if(typeof meds==='string'&&meds)meds.split(',').forEach(function(m){const b=_baseOfMed(m);if(b)counts[b]=(counts[b]||0)+1;});
    if(Array.isArray(meds))meds.forEach(function(m){const b=_baseOfMed(m);if(b)counts[b]=(counts[b]||0)+1;});
  });
  const sorted=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}).slice(0,5);
  if(!sorted.length)return _schoolEmpty("💊","오늘 투약 기록이 없어요","보건일지의 투약 기록을 모아 보여드려요.");
  return sorted.map(function(m,i){
    return '<div style="display:flex;justify-content:space-between;margin-bottom:3px"><span>'+(i+1)+'. '+escHtml(m)+'</span><b>'+counts[m]+'건</b></div>';
  }).join('');
}

function _wFrequent(ay){
  /* 이번 주 3회 이상 방문 학생 */
  const now=new Date();
  /* 월요일 시작 — getDay()-1 방식은 일요일(getDay()=0)에 기준이 "내일"이 되어 목록이 항상 비던 버그 (2026-08-27 수정) */
  const mon=new Date(now);mon.setDate(now.getDate()-((now.getDay()+6)%7));
  const monStr=_ymd(mon);   /* UTC(toISOString) 금지 — 오전엔 주 시작이 하루 밀림. 로컬 기준 (2026-07-15) */
  const weekRecs=(Array.isArray(S.records)?S.records:[]).filter(function(r){return r.date>=monStr;});
  const counts={};
  weekRecs.forEach(function(r){
    /* 학생 위젯이므로 교직원 방문 제외 — 학년별·주의 학생 위젯과 동일 기준 (2026-08-27 수정) */
    const s=typeof getStu==='function'?getStu(r.studentId):null;
    if(!s||s.type!=='student')return;
    counts[r.studentId]=(counts[r.studentId]||0)+1;
  });
  const freq=Object.keys(counts).filter(function(id){return counts[id]>=3;}).sort(function(a,b){return counts[b]-counts[a];}).slice(0,5);
  if(!freq.length)return _schoolEmpty("🔄","반복 방문 학생이 없어요","이번 주 3회 이상 방문한 학생을 표시해요.");
  return freq.map(function(id){
    const s=typeof getStu==='function'?getStu(id):{name:'?'};
    const grade=typeof getStuGradeCol==='function'?getStuGradeCol(s,{short:true}):'';
    return '<div style="margin-bottom:3px">'+escHtml(grade)+' <b>'+escHtml(s.name||'?')+'</b> — '+counts[id]+'회</div>';
  }).join('');
}

function _wPeakHour(recs){
  const hours=new Array(24).fill(0);
  recs.forEach(function(r){
    const t=r.timeIn||'';
    const h=parseInt(t.split(':')[0]);
    if(!isNaN(h)&&h>=0&&h<24)hours[h]++;
  });
  const maxH=Math.max.apply(null,hours);
  if(maxH===0)return _schoolEmpty("🕐","오늘 방문 기록이 없어요","방문 기록이 쌓이면 시간대별 현황을 볼 수 있어요.");
  /* 8~17시만 표시 */
  let bars='';
  for(let i=8;i<=17;i++){
    const pct=maxH>0?Math.round(hours[i]/maxH*100):0;
    const clr=hours[i]===maxH&&hours[i]>0?'var(--cyan)':'rgba(6,182,212,0.3)';
    bars+='<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px"><span style="font-size:9px;min-width:24px;color:var(--t3)">'+i+'시</span><div style="height:10px;width:'+pct+'%;min-width:2px;background:'+clr+';border-radius:3px"></div><span style="font-size:9px;color:var(--t3)">'+hours[i]+'</span></div>';
  }
  return bars;
}

function _wTodayTreat(recs){
  const counts={};
  /* base 추출 — 메모 괄호 '(' 또는 약품목록 대괄호 '[' 앞까지. (사용자 결정 2026-05-21 + 2026-06-09)
   * 예: "소독 (5분간)"·"소독" → "소독", "투약[타이레놀정, 게보린]" → "투약". */
  function _baseOf(x){
    if(!x)return '';
    const _m=String(x).match(/^(.+?)\s*[\(\[]/);
    return _m ? _m[1].trim() : String(x).trim();
  }
  /* 최상위 콤마로만 분리 — 대괄호/괄호 안 콤마는 보존 (합성칩 "투약[타이레놀정, 게보린]" 이 콤마에서 반쪽으로 깨지던 버그 수정 2026-06-09). */
  function _splitTop(s){
    const out=[]; let cur='',d=0;
    for(let i=0;i<s.length;i++){
      const c=s[i];
      if(c==='['||c==='(')d++;
      else if(c===']'||c===')'){ if(d>0)d--; }
      if(c===','&&d<=0){ if(cur.trim())out.push(cur.trim()); cur=''; }
      else cur+=c;
    }
    if(cur.trim())out.push(cur.trim());
    return out;
  }
  /* 처치 base 카운트 */
  recs.forEach(function(r){
    const t=r.treatment||r.treatments||'';
    let arr;
    if(Array.isArray(t)) arr=t;
    else if(typeof t==='string'&&t){
      if(t.charAt(0)==='['){ try{ const p=JSON.parse(t); arr=Array.isArray(p)?p:_splitTop(t); }catch(_){ arr=_splitTop(t); } }
      else arr=_splitTop(t);
    } else arr=[];
    arr.forEach(function(x){ const b=_baseOf(String(x).trim()); if(b)counts[b]=(counts[b]||0)+1; });
  });
  /* 당일 실제 사용 약품 집계 — 합성칩 "투약[…]" 안 약품 + r.medication 까지 추출(_statMedicationStr), 약명 기준 중복 제거. */
  const medNames=[]; const medSeen={};
  recs.forEach(function(r){
    const ms=(typeof _statMedicationStr==='function')?_statMedicationStr(r):(r.medication||'');
    if(!ms)return;
    _splitTop(String(ms)).forEach(function(m){
      const nm=String(m).replace(/\s*\([^)]*\)\s*$/,'').trim(); /* 끝 (용량) 제거 */
      if(nm&&!medSeen[nm]){ medSeen[nm]=true; medNames.push(nm); }
    });
  });
  const sorted=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}).slice(0,5);
  /* 투약 라벨 — "투약[약품1, 약품2, … 등]" (당일 실제 사용 약품, 최대 10개 + 초과 시 '등'). */
  function _medLabel(){
    const shown=medNames.slice(0,10);
    return '투약['+shown.join(', ')+(medNames.length>10?' 등':'')+']';
  }
  let h='';
  if(sorted.length){
    h+=sorted.map(function(t){
      const left=(t==='투약'&&medNames.length)?_medLabel():t;
      return '<div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:3px"><span style="word-break:break-all">'+escHtml(left)+'</span><b style="white-space:nowrap">'+counts[t]+'건</b></div>';
    }).join('');
  } else {
    h+=_schoolEmpty("📋","오늘 처치 기록이 없어요","보건일지에 남긴 처치 내용을 모아 보여드려요.");
  }
  /* 투약이 상위 5에 못 들었지만 당일 약품 사용이 있으면 투약[약품] 라인 보강 */
  if(medNames.length&&sorted.indexOf('투약')===-1){
    h+='<div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:3px"><span style="word-break:break-all">'+escHtml(_medLabel())+'</span>'+(counts['투약']?('<b style="white-space:nowrap">'+counts['투약']+'건</b>'):'')+'</div>';
  }
  return h;
}

function _wGradeVisit(recs){
  const grades={};
  recs.forEach(function(r){
    const s=typeof getStu==='function'?getStu(r.studentId):null;
    if(!s||s.type!=='student')return;
    const g=s.grade||'?';
    grades[g]=(grades[g]||0)+1;
  });
  const keys=Object.keys(grades).sort(function(a,b){return(parseInt(a)||99)-(parseInt(b)||99);});
  if(!keys.length)return _schoolEmpty("🏫","오늘 학생 방문이 없어요","보건일지를 작성하면 학년별 현황이 표시돼요.");
  const maxV=Math.max.apply(null,keys.map(function(k){return grades[k];}));
  return keys.map(function(g){
    const pct=maxV>0?Math.round(grades[g]/maxV*100):0;
    return '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><span style="font-size:9px;min-width:28px;color:var(--t3)">'+g+'학년</span><div style="height:14px;width:'+pct+'%;min-width:32px;background:var(--cyan);border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:5px;box-sizing:border-box"><span style="font-size:9px;font-weight:800;color:#fff;white-space:nowrap;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000">'+grades[g]+'명</span></div></div>';
  }).join('');
}

function _wInfection(){
  /* 감염병 기록 중 현재 진행 중인 것 */
  if(typeof S.infRecords==='undefined'||!Array.isArray(S.infRecords))return _schoolEmpty("🩺","표시할 감염병 기록이 없어요","등록된 감염병 기록을 기준으로 현황을 보여드려요.");
  const active=S.infRecords.filter(function(r){return r.progress==='진행'||r.progress==='격리';});
  if(!active.length)return '<span style="color:#22c55e;font-weight:700">현재 진행 중인 감염 없음 ✅</span>';
  return active.slice(0,5).map(function(r){
    const s=typeof getStu==='function'?getStu(r.studentId):{name:'?'};
    return '<div style="margin-bottom:3px;color:#dc2626"><b>'+escHtml(s.name||'?')+'</b> — '+escHtml(r.disease||r.infectionName||'?')+' ('+escHtml(r.progress||'')+')</div>';
  }).join('');
}

/* 오늘 급식 위젯 — school-meal.js getMealsForDate 비동기 1회 로드 후 캐시(같은 날 재요청 안 함). */
let _mealWidgetCache=null;   /* {ymd, meals:[...], error} */
let _mealWidgetLoading=false;
function _wMeal(){
  const ymd=_todayStr().replace(/-/g,'');
  if(!neisKey()) return _schoolWidgetApiState('neis','학교 급식과 학사일정을 연결할 수 있어요. 환경설정의 API Key 관리에서 등록해 주세요.');
  if(_mealWidgetCache&&_mealWidgetCache.error==='no-key') _mealWidgetCache=null;
  if(_mealWidgetCache&&_mealWidgetCache.ymd===ymd){
    const c=_mealWidgetCache;
    if(c.error==='no-school') return _schoolWidgetState('error','학교 정보를 확인해 주세요','등록한 학교명·교육청과 나이스 연동 정보를 확인해 주세요.',_schoolWidgetButton('open-widget-api-settings','연동 설정 확인',true));
    if(c.error) return _schoolWidgetState('error','급식 정보를 불러오지 못했어요','연결 상태를 확인한 후 다시 조회해 주세요.',_schoolWidgetButton('retry-widget-meal','다시 조회',true));
    if(!c.meals||!c.meals.length) return _schoolWidgetState('empty','오늘 등록된 급식이 없어요','주말·공휴일·방학에는 급식 정보가 없을 수 있어요.');
    let h='<div class="school-meal"><div class="school-widget-dateline"><span>'+escHtml(_schoolWidgetDate())+'</span><span class="school-widget-status">NEIS 연동</span></div>';
    c.meals.forEach(function(m){
      h+='<section class="school-meal-service"><div class="school-meal-heading"><strong>'+escHtml(m.type||'급식')+'</strong>'+(m.cal?'<span>'+escHtml(m.cal)+'</span>':'')+'</div><ul class="school-meal-menu">';
      (m.menu||[]).forEach(function(item){h+='<li>'+escHtml(item)+'</li>';});
      h+='</ul></section>';
    });
    return h+'</div>';
  }
  if(!_mealWidgetLoading){
    _mealWidgetLoading=true;
    getMealsForDate(ymd).then(function(r){
      _mealWidgetCache={ymd:ymd,meals:(r&&r.meals)||[],error:(r&&r.error)||null};
      _mealWidgetLoading=false;
      try{renderHomeDashboard();}catch(_){}
    }).catch(function(){
      _mealWidgetCache={ymd:ymd,meals:[],error:'fetch'};
      _mealWidgetLoading=false;
      try{renderHomeDashboard();}catch(_){}
    });
  }
  return _schoolWidgetState('loading','오늘의 식단을 가져오고 있어요','나이스에서 학교 급식 정보를 확인하고 있어요.');
}

/* 감염병 유행 현황 위젯 — 질병관리청 전수신고 감염병(설정 지역 시도) 상위 발생. 클릭 시 상세 모달. */
let _infectCache=null;   /* {key, fetchedAt, result}; key는 메모리 비교 전용 — DOM/로그에 넣지 않는다. */
let _infectLoading=null; /* {key, requestId} */
let _infectRequestId=0;
function _loadInfectTrend(year, sido, key, force){
  const requestId=++_infectRequestId;
  _infectLoading={key:key, requestId:requestId};
  function finish(result){
    if(requestId!==_infectRequestId) return;
    _infectLoading=null;
    /* 조회 중 키·지역·연도가 바뀌었으면 이전 응답을 표시하지 않는다. */
    const currentKey=getInfectiousRequestKey(new Date().getFullYear(), userSidoCd());
    if(key===currentKey){
      _infectCache={key:key, fetchedAt:Date.now(), result:result};
    }
    try{ renderHomeDashboard(); }catch(_){}
  }
  Promise.resolve().then(function(){
    return getRegionTop(year, sido, 5, {force:!!force});
  }).then(function(result){
    finish(result&&typeof result==='object'?result:{error:'fetch'});
  },function(){ finish({error:'fetch'}); });
}
function _resetInfectTrend(){
  clearInfectiousCache();
  _infectCache=null;
  _infectLoading=null;
  ++_infectRequestId;
  try{ renderHomeDashboard(); }catch(_){}
}
/* 같은 키를 다시 반영한 경우에도 실패 캐시와 이전 요청을 폐기한다. */
bus.on('infectious:settings-changed', _resetInfectTrend);
function _retryInfectTrend(){
  const year=new Date().getFullYear(), sido=userSidoCd();
  const key=getInfectiousRequestKey(year, sido);
  if(_infectLoading&&_infectLoading.key===key) return;
  _infectCache=null;
  _loadInfectTrend(year, sido, key, true);
  try{ renderHomeDashboard(); }catch(_){}
}
function _wInfectTrend(){ return _wInfectTrendBody(); }
function _wInfectTrendBody(){
  if(!getPublicDataApiKey('kdca')) return _schoolWidgetApiState('kdca','우리 지역의 감염병 발생 현황을 확인할 수 있어요. 공공데이터 인증키와 서비스 활용승인이 필요해요.');
  const detail=_schoolWidgetButton('open-infect-detail','지역·기간별 자세히 보기',true);
  const retry=_schoolWidgetButton('retry-infect-trend','다시 조회',true);
  const year=new Date().getFullYear(),sido=userSidoCd(),key=getInfectiousRequestKey(year,sido);
  if(_infectCache&&(_infectCache.key!==key||Date.now()-_infectCache.fetchedAt>=INFECTIOUS_CACHE_TTL_MS)) _infectCache=null;
  if(_infectCache){
    const c=_infectCache.result;
    if(c.error==='no-key') return _schoolWidgetApiState('kdca','우리 지역 감염병 현황을 조회하려면 공공데이터 인증키를 등록해 주세요.');
    if(c.error) return _schoolWidgetState('error','감염병 현황을 확인하지 못했어요',getInfectiousErrorMessage(c),retry+detail);
    if(!c.rows||!c.rows.length) return _schoolWidgetState('empty','조회된 발생 자료가 없어요',String(c.year)+'년 '+(c.sidoNm||'설정 지역')+' 조회 결과예요. 자료가 없다는 것이 발생이 없다는 뜻은 아니에요.',retry+detail);
    let h='<div class="school-infect"><div class="school-widget-dateline"><span>'+escHtml(c.sidoNm||'전국')+' · '+escHtml(String(c.year))+'년</span><span class="school-widget-status">발생 상위</span></div><ol class="school-infect-list">';
    c.rows.forEach(function(x,i){
      h+='<li><span class="school-infect-rank">'+(i+1)+'</span><span class="school-infect-name">'+escHtml(x.icdNm)+'</span><strong>'+escHtml(Number(x.val).toLocaleString('ko-KR'))+'<small>건</small></strong></li>';
    });
    return h+'</ol><p class="school-widget-note">지역 전체 발생 자료로, 우리 학교의 감염병 기록과는 달라요.</p><div class="school-widget-actions">'+detail+'</div></div>';
  }
  if(!_infectLoading||_infectLoading.key!==key) _loadInfectTrend(year,sido,key,false);
  return _schoolWidgetState('loading','지역 감염병 현황을 가져오고 있어요','조회가 끝나면 해당 연도의 발생 상위 항목을 보여드려요.');
}

/* 시간표 검색 위젯 — 클릭 시 나이스 시간표 조회 모달 (초·중·고·특수 학교급 자동) */
function _wTimetableSearch(){
  if(!neisKey()) return _schoolWidgetApiState('neis','학교 전체 시간표를 조회할 수 있어요. 급식·학사일정과 같은 나이스 키를 사용해요.');
  return _schoolWidgetState('ready','학교 시간표를 한곳에서','학교급에 맞는 학년·반·교시별 수업을 조회하고, 내 수업도 선택할 수 있어요.',_schoolWidgetButton('open-timetable-search','학교 시간표 열기'));
}

/* 🗓️ 나의 시간표 보기 위젯 — 설정 '팝업 대상 시간 선택하기'(class-popup)와 연동.
 *  오늘 요일에 선택한 수업을 'N교시 과목명' 으로 표시, 클릭하면 주간(월~금) 시간표 모달. (사용자 요청 2026-06-17) */
function _myClassPopups(){ try{ const a=JSON.parse(localStorage.getItem('ec_class_popups')||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } }
function _wMyTimetable(){
  const list=_myClassPopups();
  if(!list.length){
    if(!neisKey()) return _schoolWidgetApiState('neis','학교 시간표를 불러온 뒤 내 수업을 선택할 수 있어요. 급식과 같은 나이스 키를 사용해요.');
    return _schoolWidgetState('empty','내 수업을 선택해 주세요','학교 시간표에서 맡은 수업을 고르면 오늘의 교시와 수업을 이곳에 모아드려요.',_schoolWidgetButton('open-classpopup-picker','내 수업 선택하기'));
  }
  const dow=new Date().getDay();
  const weekButton=_schoolWidgetButton('open-my-week','나의 주간 시간표 보기',true);
  if(dow<1||dow>5) return _schoolWidgetState('empty','오늘은 주말이에요','선택한 수업은 주간 시간표에서 확인할 수 있어요.',weekButton);
  const today=list.filter(function(x){return String(x.dow)===String(dow-1);}).sort(function(a,b){return (parseInt(a.perio)||99)-(parseInt(b.perio)||99);});
  if(!today.length) return _schoolWidgetState('empty','오늘 선택한 수업이 없어요','다른 요일의 수업은 주간 시간표에서 확인해 주세요.',weekButton);
  return _schoolScheduleList(today.map(function(x){return {period:x.perio,subject:x.content||'수업',time:x.time||''};}),'open-my-week','나의 주간 시간표 보기');
}
/* 나의 1주일 시간표 모달 — X:월~금, Y:1~7교시(초과 시 확장), 선택 수업 칸에 과목명 */
function _openMyWeekModal(){
  const old=document.getElementById('myWeekOv'); if(old)old.remove();
  const list=_myClassPopups();
  const DOW=['월','화','수','목','금'];
  let maxP=7; list.forEach(function(x){ const p=parseInt(x.perio)||0; if(p>maxP)maxP=p; });
  const map={};
  list.forEach(function(x){ const d=parseInt(x.dow,10); const p=String(x.perio); if(d>=0&&d<=4){ (map[d]=map[d]||{})[p]={content:x.content||'',time:x.time||''}; } });
  const bd='1px solid var(--bdr)';
  const jsDow=new Date().getDay(); const todayDow=(jsDow>=1&&jsDow<=5)?(jsDow-1):-1;
  let tbl='<div style="overflow:auto;max-height:64vh;scrollbar-width:thin;scrollbar-color:var(--cyan) var(--bg2)"><table style="border-collapse:collapse;font-size:12px;table-layout:fixed;width:100%">';
  tbl+='<thead><tr><th style="position:sticky;left:0;z-index:2;background:var(--bg2);border:'+bd+';padding:6px 8px;width:48px;color:var(--t2)">교시</th>';
  DOW.forEach(function(d,i){ const tdy=(i===todayDow); tbl+='<th style="border:'+bd+';padding:6px 6px;background:'+(tdy?'rgba(6,182,212,0.12)':'var(--bg2)')+';color:'+(tdy?'var(--cyan)':'var(--t1)')+';font-weight:800;min-width:62px">'+d+'</th>'; });
  tbl+='</tr></thead><tbody>';
  for(let p=1;p<=maxP;p++){
    tbl+='<tr><td style="position:sticky;left:0;z-index:1;background:var(--card);border:'+bd+';padding:6px 8px;text-align:center;font-weight:700;color:var(--cyan)">'+p+'교시</td>';
    for(let d=0;d<5;d++){ const cell=map[d]&&map[d][String(p)]; const tdy=(d===todayDow);
      tbl+='<td style="border:'+bd+';padding:6px 5px;text-align:center;color:var(--t1);background:'+(tdy?'rgba(6,182,212,0.04)':'transparent')+';line-height:1.3;font-size:11.5px">'+(cell?('<div style="font-weight:700">'+escHtml(cell.content)+'</div>'+(cell.time?'<div style="font-size:9px;color:#db2777;font-weight:700;margin-top:2px">⏰'+escHtml(cell.time)+'</div>':'')):'')+'</td>';
    }
    tbl+='</tr>';
  }
  tbl+='</tbody></table></div>';
  const empty=!list.length;
  const ov=document.createElement('div'); ov.id='myWeekOv';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13050;opacity:0;transition:opacity 0.15s ease';
  ov.innerHTML='<div id="myWeekBox" style="background:var(--card);border-radius:14px;width:max-content;min-width:380px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity 0.18s,transform 0.2s cubic-bezier(0.34,1.4,0.64,1)">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:rgba(6,182,212,0.10);display:flex;align-items:center;gap:8px"><span style="font-size:18px">🗓️</span><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">나의 1주일 시간표</div><div style="font-size:10.5px;color:var(--t3)">월~금 · 내가 선택한 수업 (⏰=팝업 알림)</div></div>'
      +'<button id="myWeekEdit" data-tooltip="수업 선택·알림 시간을 편집합니다." data-tooltip-instant="1" style="padding:6px 12px;border:1px solid var(--cyan);border-radius:7px;background:rgba(6,182,212,0.08);color:var(--cyan);font-size:11.5px;font-weight:700;cursor:pointer;font-family:var(--f)">⚙ 편집</button></div>'
    +'<div style="padding:14px 20px;overflow:auto">'+(empty?'<div style="color:var(--t3);text-align:center;padding:16px 0">아직 선택한 수업이 없습니다. 우측 상단 ⚙ 편집으로 골라보세요.</div>':tbl)+'</div></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('myWeekBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('myWeekBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.97)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },190); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  const _edit=document.getElementById('myWeekEdit'); if(_edit)_edit.addEventListener('click',function(){ close(); import('../../core/timetable.js').then(function(m){ try{ m.showTimetableModal({pick:true}); }catch(_){} }); });
}

/* 폭염·한파·자외선 위젯 — 헤더(header-widget.js)가 채워 둔 localStorage 캐시를 읽어 표시. */
function _wWxAlert(){
  const heat=localStorage.getItem('ec_heatAlert')||'', cold=localStorage.getItem('ec_coldAlert')||'';
  const uv=localStorage.getItem('ec_uvIndex')||'', uvGrade=localStorage.getItem('ec_uvGrade')||'';
  const n=Number(uv),hasUv=uv.trim()!==''&&Number.isFinite(n);
  const readTemperature=function(key){const value=localStorage.getItem(key);return value!==null&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;};
  const hi=readTemperature('ec_tempHi'),lo=readTemperature('ec_tempLo');
  const hasTemperature=hi!==null||lo!==null;
  if(!heat&&!cold&&!hasUv&&!hasTemperature) return '<div class="school-weather-brief" role="status"><p class="school-weather-brief-loading">지역 기상 정보를 기다리고 있어요.</p></div>';
  const region=localStorage.getItem('ec_user_region')||localStorage.getItem('ec_weatherRegion')||'설정 지역';
  const temperature=function(value){return value===null?'확인 중':escHtml(String(value))+'°C';};
  let h='<div class="school-weather-brief"><div class="school-weather-brief-region">'+escHtml(region)+'</div>'
    +'<dl class="school-weather-brief-temperatures"><div><dt>최고</dt><dd>'+temperature(hi)+'</dd></div><div><dt>최저</dt><dd>'+temperature(lo)+'</dd></div></dl>'
    +'<dl class="school-weather-brief-details">';
  const notice=function(label,message,tone){return '<div data-tone="'+tone+'"><dt>'+escHtml(label)+'</dt><dd>'+escHtml(message)+'</dd></div>';};
  if(heat) h+=notice('폭염 참고',heat.indexOf('경보')!==-1?'경보 기준':heat.indexOf('주의보')!==-1?'주의 기준':heat,'warm');
  if(cold) h+=notice('한파 참고',cold.indexOf('경보')!==-1?'경보 기준':cold.indexOf('주의보')!==-1?'주의 기준':cold,'cool');
  if(!heat&&!cold) h+=notice('기온 참고',hasTemperature?'폭염·한파 알림 없음':'기온 정보 확인 중','neutral');
  if(hasUv){
    const tone=n<=2?'cool':n<=5?'normal':n<=7?'warm':'high';
    h+='<div data-tone="'+tone+'"><dt>자외선</dt><dd><b>'+escHtml(uv)+'</b><span class="school-weather-brief-grade">'+escHtml(uvGrade||'등급 확인 중')+'</span></dd></div>';
  }else h+='<div><dt>자외선</dt><dd>정보 확인 중</dd></div>';
  return h+'</dl><p class="school-widget-note">기온 기준 참고 알림이며, 공식 기상특보는 아니에요.</p></div>';
}

function _wTimetable(){
  try{
    const raw=localStorage.getItem('ec_timetable');
    if(raw){
      const tt=JSON.parse(raw);
      const dayIdx=new Date().getDay(); /* 0=일, 1=월 ... */
      if(dayIdx===0||dayIdx===6)return '<span style="color:var(--t3)">오늘은 주말입니다</span>';
      const dayKey=['','mon','tue','wed','thu','fri'][dayIdx];
      const daySchedule=tt[dayKey]||[];
      const classes=daySchedule.filter(function(c){return c&&c.trim();});
      if(!classes.length)return '<span style="color:var(--t3)">오늘 수업이 없습니다</span>';
      const periods=['1교시','2교시','3교시','4교시','5교시','6교시'];
      return daySchedule.map(function(c,i){
        if(!c||!c.trim())return '';
        return '<div style="margin-bottom:3px"><b style="color:var(--cyan)">'+periods[i]+'</b> '+escHtml(c)+'</div>';
      }).filter(Boolean).join('');
    }
  }catch(e){}
  return '<span style="color:var(--t3)">시간표를 설정에서 등록하세요</span>';
}

function _wCaution(recs){
  const cautionIds={};
  (Array.isArray(S.people)?S.people:[]).forEach(function(s){
    if(s.type==='student'&&(s.status==='caution'||s.status==='watch'))cautionIds[s.uid||s.id]=s;
  });
  const visited=recs.filter(function(r){return cautionIds[r.studentId];});
  if(!visited.length)return _schoolEmpty("🌿","오늘 요보호 학생 방문이 없어요","요보호 학생의 방문 기록을 이곳에 모아드려요.");
  return visited.slice(0,5).map(function(r){
    const s=cautionIds[r.studentId];
    return '<div style="margin-bottom:3px;color:#f59e0b"><b>'+escHtml(s.name||'?')+'</b> ('+escHtml(s.careReason||s.status||'')+')</div>';
  }).join('');
}

function _wBirthday(){
  const now=new Date();
  const mon=now.getMonth()+1;
  const startDay=now.getDate();
  const endDay=startDay+6;
  const bdays=(Array.isArray(S.people)?S.people:[]).filter(function(s){
    if(s.type!=='student'||!s.birthdate)return false;
    const bd=s.birthdate;/* YYYY-MM-DD or YYMMDD */
    let bm, bday;
    if(bd.length>=10){bm=parseInt(bd.slice(5,7));bday=parseInt(bd.slice(8,10));}
    else if(bd.length===6){bm=parseInt(bd.slice(2,4));bday=parseInt(bd.slice(4,6));}
    else return false;
    return bm===mon&&bday>=startDay&&bday<=endDay;
  });
  if(!bdays.length)return _schoolEmpty("🎂","표시할 생일 학생이 없어요","등록된 학생의 생년월일을 기준으로 표시해요.");
  return bdays.slice(0,5).map(function(s){
    const grade=typeof getStuGradeCol==='function'?getStuGradeCol(s,{short:true}):'';
    return '<div style="margin-bottom:3px">🎂 '+escHtml(grade)+' <b>'+escHtml(s.name||'?')+'</b> ('+escHtml((s.birthdate||'').slice(5))+')</div>';
  }).join('');
}

function _wWeekTrend(){
  const now=new Date();
  const thisWeekStart=new Date(now);thisWeekStart.setDate(now.getDate()-now.getDay()+1);
  const lastWeekStart=new Date(thisWeekStart);lastWeekStart.setDate(lastWeekStart.getDate()-7);
  const twStr=_ymd(thisWeekStart);   /* UTC(toISOString) 금지 — 오전엔 주 시작이 하루 밀림. 로컬 기준 (2026-07-15) */
  const lwStr=_ymd(lastWeekStart);
  const allRecs=Array.isArray(S.records)?S.records:[];
  const thisWeek=allRecs.filter(function(r){return r.date>=twStr;}).length;
  const lastWeek=allRecs.filter(function(r){return r.date>=lwStr&&r.date<twStr;}).length;
  const diff=thisWeek-lastWeek;
  const arrow=diff>0?'↑':diff<0?'↓':'→';
  const color=diff>0?'#dc2626':diff<0?'#22c55e':'var(--t3)';
  return '<div style="display:flex;gap:16px;align-items:baseline">'
    +'<div>이번 주 <b style="font-size:20px;color:var(--t1)">'+thisWeek+'</b>명</div>'
    +'<div>지난 주 <span style="color:var(--t3)">'+lastWeek+'</span>명</div>'
    +'<div style="color:'+color+';font-weight:700">'+arrow+' '+(diff>0?'+':'')+diff+'</div>'
    +'</div>';
}

/* ── 홈 미니 캘린더 (캔버스 최상단 고정, Google Calendar 연동 옵션) ── */
let _homeCalYear=null, _homeCalMonth=null;
let _homeCalEvents={};  /* {date:[evt,...]} */
let _homeCalLoaded=false;
let _homeCalCount={calendars:0,total:0};

/* Google Calendar 연동 여부 — 브라우저/PC별 독립 설정
 * 기본은 모두 OFF (로컬 캘린더만 사용). 사용자가 명시적으로 켜야 Google 연동. */
function _gcalEnabled(){
  const v=localStorage.getItem('ec_home_gcal_enabled');
  return v==='Y';
}
function _setGcalEnabled(b){
  localStorage.setItem('ec_home_gcal_enabled',b?'Y':'N');
}

/* ── 로컬 캘린더 이벤트 (호스트 DB 공유) ──
 * 저장: electronAPI.dbSet('common','home_local_events', {date:[{id,title,time,color,memo}]})
 * 백엔드 SQLite blob store에 저장됨 → 호스트 PC + 모든 브라우저 동료가 같은 데이터 봄.
 */
let _localEvents={};      /* {YYYY-MM-DD:[{id,title,time,color,memo}]} */
let _localRanges=[];      /* [{id,title,start,end,color}] — 사용자 기간 일정(기말고사 등). 칸 배경색으로 표시 (2026-06-22) */
let _localEventsLoaded=false;
let _localEventsLoading=null;
let _localEventsSaveQueue=Promise.resolve();
let _localEventsStamp=0;
let _localEventsReadFailed=false;
let _todoCalendarReady=false;
let _todoCalendarError="";
let _localTodoImports={};
let _localTodoLegacyDate="";
/* ── 저장 포맷 v2 (2026-08-12) ─────────────────────────────────────────────
 * 단일 일정 {__ts:<epoch ms>, ev:{날짜:[...]}} / 기간 일정 {__ts, rv:[...]} —
 * 갱신 시각을 페이로드와 한 덩어리(원자적)로 묶어 DB본·localStorage 캐시본 중 최신본을 판별.
 * 배경(사용자 제보): DB 쓰기가 한 번 실패하면 두 본이 어긋나고, 부팅 때 어느 쪽을 읽느냐에
 * 따라 캘린더 메모가 사라졌다/되돌아왔다 반복 + 낡은 본 위에서 편집하면 최신 메모 영구 유실.
 * 옛 형식(순수 {날짜:[...]} / [...])도 그대로 인식(ts=0 취급, 자연스럽게 v2 로 이행). */
function _evUnwrap(v){
  if(v&&typeof v==='object'&&!Array.isArray(v)&&v.ev&&typeof v.ev==='object'){
    return {ts:(+v.__ts||0),data:v.ev,schema:+v.schema||0,todoImports:v.todoImports&&typeof v.todoImports==='object'&&!Array.isArray(v.todoImports)?v.todoImports:{},todoLegacyDate:v.todoLegacyDate||''};
  }
  if(v&&typeof v==='object'&&!Array.isArray(v))return {ts:0,data:v,schema:0,todoImports:{},todoLegacyDate:''};
  return null;
}
function _rvUnwrap(v){
  if(v&&typeof v==='object'&&!Array.isArray(v)&&Array.isArray(v.rv))return {ts:(+v.__ts||0),data:v.rv};
  if(Array.isArray(v))return {ts:0,data:v};                            /* 옛 형식 */
  return null;
}
/* 승자 결정 — 비어있지 않은 쪽 우선, 둘 다 있으면 __ts 최신 우선, 동률은 DB 우선(기존 동작 보존) */
function _pickFresh(dbW,lsW,sizeFn){
  const dn=dbW?sizeFn(dbW.data):0, ln=lsW?sizeFn(lsW.data):0;
  if(dn&&ln)return (lsW.ts>dbW.ts)?lsW:dbW;
  return dn?dbW:(ln?lsW:null);
}
async function _loadLocalEvents(){
  if(_localEventsLoading)return _localEventsLoading;
  if(_localEventsLoaded&&_todoCalendarReady)return _localEvents;
  _localEventsLoading=(async function(){
    try{
      await _readLocalEvents();
      if(_localEventsReadFailed)throw new Error('일정 저장소를 읽지 못했습니다.');
      await _migrateLegacyHomeTodos();
      _todoCalendarReady=true;
      _todoCalendarError='';
    }catch(e){
      _todoCalendarError='일정과 할 일을 불러오지 못했습니다. 기존 자료는 그대로 보관되어 있습니다.';
      console.error('[home-todo] load failed',e);
    }
    return _localEvents;
  })();
  try{return await _localEventsLoading;}finally{_localEventsLoading=null;}
}
async function _requireHomeCalendar(){
  if(_localEventsReadFailed){_localEventsLoaded=false;_localEventsReadFailed=false;}
  await _loadLocalEvents();
  if(_todoCalendarReady)return true;
  await appConfirmModal(_todoCalendarError||'일정을 다시 불러온 뒤 시도해 주세요.','일정 불러오기',{okOnly:true});
  return false;
}
async function _readLocalEvents(){
  if(_localEventsLoaded)return _localEvents;
  try{
    let dbEv=null,dbRv=null,lsEv=null,lsRv=null;
    if(window.electronAPI&&window.electronAPI.dbGet){
      try{
        const res=await window.electronAPI.dbGet('common','home_local_events');
        if(!res||!res.success)_localEventsReadFailed=true;
        dbEv=_evUnwrap((res&&res.success)?(res.data!=null?res.data:res.value):null);
      }catch(e){_localEventsReadFailed=true;console.error('[home-cal] DB 이벤트 로드 실패',e);}
      try{
        const rr=await window.electronAPI.dbGet('common','home_local_ranges');
        dbRv=_rvUnwrap((rr&&rr.success)?(rr.data!=null?rr.data:rr.value):null);
      }catch(e){console.error('[home-cal] DB 기간일정 로드 실패',e);}
    }
    try{const raw=localStorage.getItem('ec_home_local_events');if(raw)lsEv=_evUnwrap(JSON.parse(raw));}catch(e){}
    try{const rawR=localStorage.getItem('ec_home_local_ranges');if(rawR)lsRv=_rvUnwrap(JSON.parse(rawR));}catch(e){}
    // A linked calendar may legitimately be empty after its last item is deleted.
    const candidates=[dbEv,lsEv].filter(Boolean);
    const wEv=candidates.some(function(v){return v.schema>=3;})
      ?candidates.reduce(function(a,b){return !a||b.ts>a.ts?b:a;},null)
      :_pickFresh(dbEv,lsEv,function(d){return Object.keys(d).length;});
    const wRv=_pickFresh(dbRv,lsRv,function(d){return d.length;});
    if(wEv){_localEventsStamp=wEv.ts;_localEvents=wEv.data;_localTodoImports=Object.assign({},wEv.todoImports);_localTodoLegacyDate=wEv.todoLegacyDate||"";}
    if(wRv)_localRanges=wRv.data;
    /* 치유 — 두 본이 어긋나 있으면 승자로 양쪽 통일. 이후 120초 주기 미러(localStorage→DB)가
     * 낡은 캐시로 좋은 DB본을 되덮거나, 낡은 본 위에서 편집해 최신 메모를 잃는 사고를 차단. */
    try{
      if(wEv&&!_localEventsReadFailed){
        const wrapped={__ts:(wEv.ts||Date.now()),ev:wEv.data,schema:wEv.schema,todoImports:wEv.todoImports,todoLegacyDate:wEv.todoLegacyDate};
        if(!lsEv||!lsEv.ts||JSON.stringify(lsEv.data)!==JSON.stringify(wEv.data)||JSON.stringify(lsEv.todoImports)!==JSON.stringify(wEv.todoImports)||lsEv.todoLegacyDate!==wEv.todoLegacyDate||lsEv.schema!==wEv.schema)localStorage.setItem('ec_home_local_events',JSON.stringify(wrapped));
        if(window.electronAPI&&window.electronAPI.dbSet&&(!dbEv||!dbEv.ts||JSON.stringify(dbEv.data)!==JSON.stringify(wEv.data)||JSON.stringify(dbEv.todoImports)!==JSON.stringify(wEv.todoImports)||dbEv.todoLegacyDate!==wEv.todoLegacyDate||dbEv.schema!==wEv.schema))await window.electronAPI.dbSet('common','home_local_events',wrapped);
      }
      if(wRv){
        const wrappedR={__ts:(wRv.ts||Date.now()),rv:wRv.data};
        if(!lsRv||!lsRv.ts||JSON.stringify(lsRv.data)!==JSON.stringify(wRv.data))localStorage.setItem('ec_home_local_ranges',JSON.stringify(wrappedR));
        if(window.electronAPI&&window.electronAPI.dbSet&&(!dbRv||!dbRv.ts||JSON.stringify(dbRv.data)!==JSON.stringify(wRv.data)))await window.electronAPI.dbSet('common','home_local_ranges',wrappedR);
      }
    }catch(e){console.error('[home-cal] 치유 저장 실패(치명 아님)',e);}
  }catch(e){console.error('[home-cal] load failed',e);}
  _localEventsLoaded=true;
  return _localEvents;
}
async function _saveLocalEvents(){
  if(!_localEventsLoaded||_localEventsReadFailed)return false;
  _localEventsStamp=Math.max(Date.now(),_localEventsStamp+1);
  const payload=JSON.parse(JSON.stringify({__ts:_localEventsStamp,schema:3,ev:_localEvents,todoImports:_localTodoImports,todoLegacyDate:_localTodoLegacyDate}));
  // Keep rapid edits in order and keep each queued snapshot independent.
  _localEventsSaveQueue=_localEventsSaveQueue.catch(function(){return false;}).then(async function(){
    let saved=false;
    try{
      if(window.electronAPI&&window.electronAPI.dbSet){
        const res=await window.electronAPI.dbSet('common','home_local_events',payload);
        if(res&&res.success)saved=true;
      }
    }catch(e){console.error('[home-cal] save(DB) failed',e);}
    try{localStorage.setItem('ec_home_local_events',JSON.stringify(payload));saved=true;}
    catch(e){console.error('[home-cal] save(cache) failed',e);}
    return saved;
  });
  return _localEventsSaveQueue;
}
function _validHomeTodoDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
  const d=new Date(value+'T12:00:00');
  return Number.isFinite(d.getTime())&&d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')===value?value:'';
}
async function _migrateLegacyHomeTodos(){
  // Preserve the original list. Import markers and events are saved in one payload,
  // so edits or deletions never cause an old task to be imported again.
  let rows=_getLSList('ec_home_todolist');
  if(window.electronAPI&&window.electronAPI.dbGet){
    const res=await window.electronAPI.dbGet('common','ec_home_todolist');
    if(!res||!res.success)throw new Error('기존 할 일 저장소를 읽지 못했습니다.');
    if(Array.isArray(res.data)&&res.data.length>rows.length)rows=res.data;
  }
  if(!rows.length)rows=_getLSList('gp2_todolist');
  if(!rows.length)rows=_getLSList('ec_todolist');
  if(!rows.length)return;
  const ds=_validHomeTodoDate(localStorage.getItem('ec_home_todolist_lastDate'))||_validHomeTodoDate(_localTodoLegacyDate)||_todayStr();
  const nextEvents=Object.assign({},_localEvents);
  const nextImports=Object.assign({},_localTodoImports);
  const list=(nextEvents[ds]||[]).slice();
  let changed=false;
  rows.forEach(function(item,index){
    if(!item||typeof item!=='object')return;
    const title=String(item.text||item.title||'').trim();
    if(!title)return;
    const key=ds+'|'+index+'|'+JSON.stringify([item.id||'',title]);
    if(Object.prototype.hasOwnProperty.call(nextImports,key))return;
    const id='todo-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
    list.push({id:id,title:title,time:String(item.time||''),memo:String(item.memo||''),color:'#22c55e',done:!!item.done});
    nextImports[key]=id;
    changed=true;
  });
  if(!changed)return;
  nextEvents[ds]=list;
  const previous={events:_localEvents,imports:_localTodoImports,date:_localTodoLegacyDate};
  _localEvents=nextEvents;_localTodoImports=nextImports;_localTodoLegacyDate=ds;
  if(!await _saveLocalEvents()){
    _localEvents=previous.events;_localTodoImports=previous.imports;_localTodoLegacyDate=previous.date;
    throw new Error('기존 할 일의 일정 저장에 실패했습니다.');
  }
}
async function _saveLocalRanges(){
  if(!_localEventsLoaded){console.warn('[home-cal] 로드 전 기간일정 저장 시도 차단');return;}
  const payload={__ts:Date.now(),rv:_localRanges};
  try{
    if(window.electronAPI&&window.electronAPI.dbSet){
      await window.electronAPI.dbSet('common','home_local_ranges',payload);
    }
  }catch(e){console.error('[home-cal] save ranges(DB) failed',e);}
  try{
    localStorage.setItem('ec_home_local_ranges',JSON.stringify(payload));
  }catch(e){console.error('[home-cal] save ranges(cache) failed',e);}
}


/* ── 홈 위젯 보관함 — 5열 위젯 가시성 토글 ────────────────────────────
 * 저장: ec_home_widget_vis = JSON {widgetId: boolean}. 기본값 = 모두 ON.
 * 위젯 ID 는 _HOME_WIDGET_DEFS 정의. 렌더 시 _isHomeWidgetVisible(id) 로 표시 여부 결정. */
const _HOME_WIDGET_DEFS = {
  col1: { name: '1열 · 업무 도구', items: [
    {id:'progress',   icon:'📊', name:'시기별 진행률'},
    {id:'schoolStats',icon:'🏫', name:'학교 현황 위젯'},   /* 시기별 진행률 바로 아래, 디폴트 ON (사용자 요청 2026-06-17) */
    {id:'quicklinks', icon:'🔗', name:'업무 사이트'},
    {id:'phonebook',  icon:'📱', name:'업무 연락처'},
    {id:'procurement',icon:'🛒', name:'구매·품의 목록'},
  ]},
  col2: { name: '2열 · 일정·수업', items: [
    {id:'routine',    icon:'⟳',  name:'루틴 트래커'},
    {id:'todolist',   icon:'☑',  name:'오늘 할 일'},
    {id:'timetableSearch', icon:'🔍', name:'나이스 전체 시간표 보기'},   /* TO-DO 아래·수업시간표 위 (사용자 요청 2026-06-17) */
    {id:'myTimetable', icon:'🗓️', name:'나의 시간표 보기'},   /* 나이스 전체 시간표 보기 바로 아래 (사용자 요청 2026-06-17) */
    {id:'timetable',  icon:'📅', name:'수업 시간표'},
    {id:'lessonmemo', icon:'📝', name:'수업 메모'},
    {id:'meal',       icon:'🍽️', name:'오늘 급식'},
  ]},
  /* 사용자 요청 2026-05-28 — 3·4열 통합 해제, 각각 별도 컬럼으로 분리. */
  col3: { name: '3열 · 보건 통계', items: [
    {id:'todayTreat', icon:'💊', name:'오늘 처치'},
    {id:'gradeVisit', icon:'🎓', name:'학년별 방문'},
    {id:'topMeds',    icon:'⭐', name:'자주 쓴 약품'},
    {id:'peakHour',   icon:'🕐', name:'피크 시간대'},
    {id:'rentalDue',  icon:'📦', name:'대여 반납 예정'},
  ]},
  col4: { name: '4열 · 보건 알림', items: [
    {id:'caution',    icon:'⚠',  name:'주의 학생'},
    {id:'bed',        icon:'🛏', name:'침상 현황'},
    {id:'birthday',   icon:'🎂', name:'오늘의 생일'},
    {id:'frequent',   icon:'🔁', name:'빈번 방문'},
    {id:'wxalert',    icon:'🌡️', name:'폭염·한파·자외선 정보'},
    {id:'infectTrend',icon:'🦠', name:'감염병 유행 현황'},
  ]},
  col5: { name: '5열 · 메모', items: [
    {id:'memos', icon:'📌', name:'포스트잇 메모'},
  ]},
};
function _getHomeWidgetVis(){
  try{ return JSON.parse(localStorage.getItem('ec_home_widget_vis')||'{}') || {}; }
  catch(e){ return {}; }
}
function _saveHomeWidgetVis(v){
  try{ localStorage.setItem('ec_home_widget_vis', JSON.stringify(v||{})); }catch(e){}
}
function _isHomeWidgetVisible(id){
  const vis = _getHomeWidgetVis();
  return vis[id] !== false;   /* 기본 ON (vis[id]===false 일 때만 숨김) */
}
function _toggleHomeWidgetVis(id){
  const vis = _getHomeWidgetVis();
  vis[id] = !(vis[id] !== false);   /* 토글 */
  _saveHomeWidgetVis(vis);
}
/* 사용자 위젯 정렬 저장 (사용자 요청 2026-05-28 — 모달 안 같은 컬럼 내 드래그 정렬, ec_home_widget_order).
 *  스키마: { col1:[wid,...], col2:[...], col3:[...], col4:[...], col5:[...] }
 *  저장된 순서가 있으면 그 순서대로, 없는 신규 위젯은 _HOME_WIDGET_DEFS 기본 순서대로 뒤에 추가. */
function _getHwbOrder(){
  try{ return JSON.parse(localStorage.getItem('ec_home_widget_order')||'{}'); }catch(_){ return {}; }
}
function _saveHwbOrder(o){
  try{ localStorage.setItem('ec_home_widget_order', JSON.stringify(o)); }catch(_){}
}
/* 1회성 이행 — 기존 사용자는 저장된 순서 끝에 schoolStats 가 붙으므로, '시기별 진행률(progress)' 바로 아래로 옮긴다. (사용자 요청 2026-06-17) */
(function _migrateSchoolStatsPos(){
  try{
    if(localStorage.getItem('ec_home_schoolstats_placed')==='1') return;
    const o=_getHwbOrder();
    if(o && Array.isArray(o.col1) && o.col1.length){
      const arr=o.col1.filter(function(id){ return id!=='schoolStats'; });
      const pi=arr.indexOf('progress');
      if(pi>=0) arr.splice(pi+1,0,'schoolStats'); else arr.unshift('schoolStats');
      o.col1=arr; _saveHwbOrder(o);
    }
    localStorage.setItem('ec_home_schoolstats_placed','1');
  }catch(_){}
})();
/* 1회성 이행 — 'myTimetable' 을 저장된 col2 순서에서 'timetableSearch(나이스 전체 시간표 보기)' 바로 아래로. (사용자 요청 2026-06-17) */
(function _migrateMyTimetablePos(){
  try{
    if(localStorage.getItem('ec_home_mytt_placed')==='1') return;
    const o=_getHwbOrder();
    if(o && Array.isArray(o.col2) && o.col2.length){
      const arr=o.col2.filter(function(id){ return id!=='myTimetable'; });
      const pi=arr.indexOf('timetableSearch');
      if(pi>=0) arr.splice(pi+1,0,'myTimetable'); else arr.push('myTimetable');
      o.col2=arr; _saveHwbOrder(o);
    }
    localStorage.setItem('ec_home_mytt_placed','1');
  }catch(_){}
})();
function _orderedHwbItems(colKey, defaultItems){
  const order = _getHwbOrder()[colKey];
  if(!Array.isArray(order) || !order.length) return defaultItems;
  const byId = {};
  defaultItems.forEach(function(it){ byId[it.id] = it; });
  const result = [];
  const used = {};
  order.forEach(function(id){
    if(byId[id] && !used[id]){ result.push(byId[id]); used[id] = true; }
  });
  defaultItems.forEach(function(it){
    if(!used[it.id]) result.push(it);
  });
  return result;
}
/* ── 위젯 열간(컬럼 간) 이동 — 사용자 지정 컬럼 배정 (ec_home_widget_col). 비어있으면 원래 컬럼 유지(=기존 동작). ── */
function _getWidgetColMap(){ try{ return JSON.parse(localStorage.getItem('ec_home_widget_col')||'{}')||{}; }catch(_){ return {}; } }
function _saveWidgetColMap(m){ try{ localStorage.setItem('ec_home_widget_col', JSON.stringify(m||{})); }catch(_){} }
let _hwbAllDefsCache=null;
function _hwbAllDefs(){
  if(_hwbAllDefsCache) return _hwbAllDefsCache;
  const m={}; Object.keys(_HOME_WIDGET_DEFS).forEach(function(ck){ _HOME_WIDGET_DEFS[ck].items.forEach(function(it){ m[it.id]=it; }); });
  _hwbAllDefsCache=m; return m;
}
function _defaultColOf(wid){ let r=null; Object.keys(_HOME_WIDGET_DEFS).forEach(function(ck){ if(_HOME_WIDGET_DEFS[ck].items.some(function(it){return it.id===wid;})) r=ck; }); return r; }
function _effectiveColOf(wid){ const m=_getWidgetColMap(); return m[wid]||_defaultColOf(wid); }
/* colKey 에 (override 반영) 현재 속한 위젯 def 목록 — 저장 순서 적용. */
function _widgetsInCol(colKey){
  const all=_hwbAllDefs();
  const defs=Object.keys(all).filter(function(id){ return _effectiveColOf(id)===colKey; }).map(function(id){ return all[id]; });
  return _orderedHwbItems(colKey, defs);
}
/* 위젯 보관함 변경 되돌리기(Ctrl+Z) — {순서·열배정·가시성} 한 묶음 스냅샷 스택.
 *  렌더가 데이터 주도(_widgetsInCol)라, 스냅샷 복원 후 renderHomeDashboard 만 호출하면 그대로 반영됨. */
let _hwbHist=[];
function _hwbSnapshot(){
  try{ _hwbHist.push(JSON.stringify({order:_getHwbOrder(), col:_getWidgetColMap(), vis:_getHomeWidgetVis()})); }catch(_){ return; }
  if(_hwbHist.length>200) _hwbHist.shift();
}
function _hwbUndo(){
  if(!_hwbHist.length) return;
  let o; try{ o=JSON.parse(_hwbHist.pop()); }catch(_){ return; }
  _saveHwbOrder(o.order||{});
  _saveWidgetColMap(o.col||{});
  _saveHomeWidgetVis(o.vis||{});
  const b=document.getElementById('hwbBody'); if(b) b.innerHTML=_buildHwbBodyHtmlExternal();
  try{ renderHomeDashboard(); }catch(_){}
}
/* 드래그 시작 — settings-tab-diary.js 의 _setSymStartDrag 와 동일 패턴 (클론 + cyan 플레이스홀더).
 *  같은 컬럼 내 상하 정렬 + 컬럼 간(열간) 이동 모두 지원 (사용자 요청 2026-05-30). */
function _hwbStartDrag(cardEl, e){
  e.preventDefault(); e.stopPropagation();
  const colWrap = cardEl.parentElement;
  if(!colWrap) return;
  const wid = cardEl.dataset.wid;
  const colKey = colWrap.dataset.colkey;
  if(!wid || !colKey) return;
  const startY = e.clientY;
  const startX = e.clientX;
  let moved = false;
  const rect = cardEl.getBoundingClientRect();
  const clone = cardEl.cloneNode(true);
  clone.style.cssText = 'position:fixed;z-index:12000;pointer-events:none;opacity:0.9;box-shadow:0 6px 20px rgba(0,0,0,0.35);width:'+rect.width+'px;padding:7px 10px;border-radius:7px;background:var(--card);border:1.5px solid var(--cyan);display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;color:var(--t1);box-sizing:border-box';
  clone.style.left = rect.left + 'px';
  clone.style.top = rect.top + 'px';
  document.body.appendChild(clone);
  cardEl.style.opacity = '0.3';
  const placeholder = document.createElement('div');
  placeholder.className = '_hwb-drag-ph';
  placeholder.style.cssText = 'height:3px;background:var(--cyan);border-radius:2px;margin:2px 0;box-shadow:0 0 4px rgba(6,182,212,0.5)';
  function onMove(ev){
    if(!moved && (Math.abs(ev.clientY-startY)>3 || Math.abs(ev.clientX-startX)>3)) moved = true;
    clone.style.top = (ev.clientY - (startY - rect.top)) + 'px';
    clone.style.left = (ev.clientX - (startX - rect.left)) + 'px';
    /* 커서가 올라간 모달 컬럼 결정 — 열간(컬럼 간) 이동 지원 */
    let targetCol = colWrap;
    const modal = document.getElementById('homeWidgetBoxModal');
    if(modal){
      const cols = Array.from(modal.querySelectorAll('[data-colkey]'));
      for(let i=0;i<cols.length;i++){ const r=cols[i].getBoundingClientRect(); if(ev.clientX>=r.left && ev.clientX<=r.right && ev.clientY>=r.top && ev.clientY<=r.bottom){ targetCol=cols[i]; break; } }
    }
    const liveCards = Array.from(targetCol.querySelectorAll(':scope > [data-wid]'));
    let closest = null, closestDist = Infinity;
    liveCards.forEach(function(c){
      if(c === cardEl) return;
      const r = c.getBoundingClientRect();
      const mid = r.top + r.height/2;
      const dist = Math.abs(ev.clientY - mid);
      if(dist < closestDist){ closestDist = dist; closest = {el:c, above: ev.clientY < mid}; }
    });
    if(placeholder.parentNode) placeholder.remove();
    if(closest){
      if(closest.above) closest.el.before(placeholder);
      else closest.el.after(placeholder);
    } else {
      targetCol.appendChild(placeholder);   /* 빈 컬럼이거나 카드 없음 → 끝에 */
    }
  }
  function onUp(){
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    if(clone.parentNode) clone.remove();
    cardEl.style.opacity = '1';
    const phInDom = !!placeholder.parentNode;
    if(!moved || !phInDom){ if(placeholder.parentNode) placeholder.remove(); return; }
    /* 놓인 컬럼 결정 */
    const destCol = placeholder.closest('[data-colkey]');
    const destColKey = destCol && destCol.dataset.colkey;
    if(!destColKey){ placeholder.remove(); return; }
    /* dest 컬럼 최종 순서 (placeholder 위치 = wid) */
    const finalOrder = [];
    Array.from(destCol.children).forEach(function(child){
      if(child === placeholder){ finalOrder.push(wid); return; }
      if(child === cardEl) return;
      const _w = child.dataset && child.dataset.wid;
      if(_w && _w !== wid) finalOrder.push(_w);
    });
    placeholder.remove();
    _hwbSnapshot();   /* 변경 직전 상태 저장 — Ctrl+Z 되돌리기용 */
    const orderMap = _getHwbOrder();
    if(destColKey !== colKey){
      /* 열간 이동 — 컬럼 배정 갱신 (기본 컬럼으로 되돌아가면 override 제거) + 원본 컬럼 순서에서 제거 */
      const colMap = _getWidgetColMap();
      if(destColKey === _defaultColOf(wid)) delete colMap[wid]; else colMap[wid] = destColKey;
      _saveWidgetColMap(colMap);
      const srcBase = Array.isArray(orderMap[colKey]) ? orderMap[colKey] : _widgetsInCol(colKey).map(function(x){return x.id;});
      orderMap[colKey] = srcBase.filter(function(id){ return id !== wid; });
    }
    orderMap[destColKey] = finalOrder;
    _saveHwbOrder(orderMap);
    /* 저장 즉시 홈 대시보드 재렌더 — 순서·열 배정을 실제 화면에 반영. (모달 body 오버레이는 유지) */
    try{ renderHomeDashboard(); }catch(_){}
    /* 모달 본문만 in-place 재렌더 — 깜빡임 X */
    const body = document.getElementById('hwbBody');
    if(body) body.innerHTML = _buildHwbBodyHtmlExternal();
  }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
}
/* _buildBodyHtml 은 _openWidgetBoxModal 안 closure — 드래그 종료 후 재렌더 시 호출하기 위해 외부에서도 같은 결과 반환하는 헬퍼 별도 제공. */
function _buildHwbBodyHtmlExternal(){
  const vis = _getHomeWidgetVis();
  const displayNames = {
    caution:'요보호 학생', birthday:'이번 주 생일', frequent:'반복 방문',
    wxalert:'기상·보건 알림', infectTrend:'감염병 유행'
  };
  function cardHtml(w, colKey, fixed){
    const on = vis[w.id] !== false;
    const label = displayNames[w.id] || w.name;
    let card = '<button type="button" class="school-hwb-widget '+(on?'is-visible':'is-hidden')+(w.id==='calendar'?' school-hwb-calendar':'')+'" data-action="hwb-toggle" data-wid="'+escHtml(w.id)+'" data-widget-group="'+escHtml(colKey)+'" aria-pressed="'+(on?'true':'false')+'" aria-label="'+escHtml(label)+' · '+(on?'홈에 표시 중, 누르면 숨김':'홈에서 숨김, 누르면 표시')+'" title="'+(on?'클릭하여 숨기기':'클릭하여 표시')+'">';
    if(!fixed){
      card += '<span data-action="hwb-drag" class="hwb-grip" title="드래그하여 그룹과 순서 변경" aria-hidden="true">⠿</span>';
    }
    card += '<span class="school-hwb-widget-icon" aria-hidden="true">'+escHtml(w.icon||'')+'</span>';
    card += '<span class="school-hwb-widget-copy"><span class="school-hwb-widget-name">'+escHtml(label)+'</span>';
    if(fixed) card += '<span class="school-hwb-fixed">홈 상단 고정</span>';
    card += '</span>';
    card += '<span class="school-hwb-state" aria-hidden="true">'+dailyColEyeIcon(on)+'<span>'+(on?'표시':'숨김')+'</span></span>';
    return card+'</button>';
  }
  let g = cardHtml({id:'calendar',icon:'📅',name:'캘린더'}, 'col2', true);
  _SCHOOL_HOME_GROUP_ORDER.forEach(function(colKey){
    const col = _HOME_WIDGET_DEFS[colKey];
    const label = String(col.name||'').replace(/^\d열\s*·\s*/,'');
    const items = _widgetsInCol(colKey);
    const visible = items.filter(function(w){return vis[w.id]!==false;}).length;
    g += '<section class="school-hwb-group" data-widget-group="'+escHtml(colKey)+'">';
    g += '<div class="school-hwb-group-heading"><h3>'+escHtml(label)+'</h3><span class="school-hwb-count">표시 '+visible+'/'+items.length+'</span></div>';
    g += '<div class="school-hwb-list" data-colkey="'+escHtml(colKey)+'">';
    items.forEach(function(w){g += cardHtml(w, colKey, w.id==='memos');});
    if(!items.length) g += '<p class="school-hwb-empty">이곳으로 위젯을 옮길 수 있어요.</p>';
    g += '</div></section>';
  });
  return g;
}
function _openWidgetBoxModal(){
  if(document.getElementById('homeWidgetBoxModal')) return;
  _hwbHist=[];   /* 모달 열 때마다 되돌리기 이력 초기화 */
  const ov = document.createElement('div');
  ov.id = 'homeWidgetBoxModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0);z-index:11000;display:flex;align-items:center;justify-content:center;transition:background .18s ease';
  /* 그리드 본문 빌더 — 외부 _buildHwbBodyHtmlExternal() 일원화 (드래그 종료 후 재렌더 함수도 동일). */
  /* 사용자 요청 2026-05-28 — 모달 너비 760→920 (5단 그리드 수용). 헤더 X 버튼 제거 (하단 "확인"·ESC·배경 클릭으로 닫음). */
  let h = '<div id="hwbCard" style="background:var(--card);border-radius:14px;width:1160px;max-width:96vw;max-height:84vh;box-shadow:0 24px 60px rgba(0,0,0,0.45);overflow:hidden;display:flex;flex-direction:column;opacity:0;transform:scale(0.96);transition:opacity .18s ease,transform .18s ease">';
  h += '<div style="padding:14px 20px;background:rgba(6,182,212,0.10);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px">';
  h += '<span style="font-size:22px">📦</span>';
  h += '<div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">홈 위젯 보관함</div>';
  h += '<div style="font-size:11px;color:var(--t3);margin-top:2px">홈과 같은 색상으로 위젯을 구분했어요. 카드를 눌러 표시 여부를 바꾸고, 손잡이를 끌어 그룹과 순서를 정하세요. 캘린더·포스트잇 메모는 홈 상단, 오늘 할 일은 일정·수업에 표시됩니다.</div></div>';
  h += '</div>';
  /* 5단 균등 그리드 (사용자 요청 2026-05-28) — col1·col2·col3·col4·col5 각각 1fr. */
  h += '<div id="hwbBody" style="padding:14px 18px;overflow-y:auto;overflow-x:hidden;flex:1;display:grid;grid-template-columns:repeat(5, minmax(0,1fr));gap:14px;align-content:start">';
  h += _buildHwbBodyHtmlExternal();
  h += '</div>';
  /* footer — 순서·열 배치 초기화(가시성 제외) + 되돌리기(Ctrl+Z). */
  h += '<div style="padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;align-items:center;justify-content:space-between;gap:8px">';
  h += '<button data-action="hwb-reset" style="border:1px solid rgba(220,38,38,0.35);background:rgba(220,38,38,0.06);color:#dc2626;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--f)">⟲ 순서·그룹 초기화</button>';
  h += '<button data-action="hwb-undo" title="단축키: Ctrl+Z" style="border:0;background:#0891b2;color:#fff;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--f);box-shadow:0 4px 12px rgba(6,182,212,0.25)">↶ 되돌리기</button>';
  h += '</div>';
  h += '</div>';
  ov.innerHTML = h;
  let _onKey = null;
  const _close = function(){
    if(_onKey) document.removeEventListener('keydown', _onKey, true);
    if(!ov || !ov.parentNode || ov._closing) return;
    ov._closing = true;
    ov.style.background='rgba(0,0,0,0)';
    const _c = ov.querySelector('#hwbCard');
    if(_c){ _c.style.opacity='0'; _c.style.transform='scale(0.96)'; }
    setTimeout(function(){ if(ov.parentNode) ov.remove(); }, 180);
  };
  /* 본문 in-place 재렌더 — 모달 자체는 그대로 유지 → 깜빡임 0. 스크롤 위치도 보존됨 (같은 #hwbBody 컨테이너). */
  const _refreshBody = function(){
    const body = ov.querySelector('#hwbBody');
    if(body) body.innerHTML = _buildHwbBodyHtmlExternal();
  };
  /* 드래그 시작 위임 — grip(⠿) mousedown 캡처. grip 자체가 data-action="hwb-drag" 라 click 위임은 hwb-toggle 분기에 잡히지 않아 토글되지 않음 (closest 가 grip 을 먼저 잡음). */
  ov.addEventListener('mousedown', function(e){
    const g = e.target.closest('[data-action="hwb-drag"]');
    if(!g) return;
    const card = g.parentElement;
    if(!card || !card.dataset || !card.dataset.wid) return;
    _hwbStartDrag(card, e);
  });
  ov.addEventListener('click', function(e){
    if(e.target === ov){ _close(); return; }
    const t = e.target.closest('[data-action]');
    if(!t) return;
    const a = t.dataset.action;
    if(a === 'hwb-close'){ _close(); return; }
    if(a === 'hwb-undo'){ _hwbUndo(); return; }   /* _hwbUndo 가 #hwbBody 재렌더 + 대시보드 갱신 수행 */
    if(a === 'hwb-reset'){
      if(window.confirm('위젯 순서와 그룹을 처음 상태로 되돌릴까요? (켜기/끄기 설정은 유지됩니다)')){
        _hwbSnapshot();   /* 초기화 직전 상태 저장 — Ctrl+Z 로 되돌릴 수 있게 */
        try{ localStorage.removeItem('ec_home_widget_order'); }catch(_){}
        try{ localStorage.removeItem('ec_home_widget_col'); }catch(_){}
        _refreshBody();
        renderHomeDashboard();
      }
      return;
    }
    if(a === 'hwb-toggle'){
      const wid = t.dataset.wid;
      if(!wid) return;
      _hwbSnapshot();          /* 토글 직전 상태 저장 — Ctrl+Z 되돌리기용 */
      _toggleHomeWidgetVis(wid);
      _refreshBody();          /* 모달 내부 토글 즉시 반영 (깜빡임 없음) */
      renderHomeDashboard();   /* 홈 대시보드 백그라운드 갱신 */
      return;
    }
  });
  document.body.appendChild(ov);
  /* 열기 애니메이션 — 배경 페이드 + 카드 스케일 인. 강제 reflow 로 초기 상태 커밋 후 전환. */
  const _hwbC = ov.querySelector('#hwbCard');
  void ov.offsetHeight;
  ov.style.background='rgba(0,0,0,0.45)';
  if(_hwbC){ _hwbC.style.opacity='1'; _hwbC.style.transform='scale(1)'; }
  _onKey = function(e){
    if(e.key === 'Escape'){ _close(); return; }
    if((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey){
      const ae = document.activeElement || {};
      if(ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) return;  /* 입력칸은 브라우저 기본 undo 양보 */
      e.preventDefault(); e.stopPropagation();   /* 전역 Ctrl+Z(일반일지 삭제취소) 버블 핸들러보다 모달이 먼저 처리 */
      _hwbUndo();
      return;
    }
  };
  document.addEventListener('keydown', _onKey, true);
}

/* ── 수업 시간표 위젯 — 이미지 업로드 + 꽉 차게 표시 ─────────────────────
 * 저장: ec_home_timetable_img (base64). 큰 이미지 주의 (5MB 이상 막음).
 * 사용자가 시간표 이미지 파일을 올리면 위젯 안에 가득 차게 표시. */
/* 주간 시간표 — 월~금 × 1~8교시 텍스트 입력 (사용자 요청 2026-05-28, 이미지 업로드 폐지).
 * 저장: ec_home_timetable = { periods:[{time:"09:00~09:50"},...8], grid:{mon:[과목,...8],...fri} }
 * 위젯 본문: 오늘 요일의 수업(과목+시간)만 표시. + 버튼/본문 더블클릭 → 편집 팝업. */
const _TT_DAYS=[{k:'mon',l:'월'},{k:'tue',l:'화'},{k:'wed',l:'수'},{k:'thu',l:'목'},{k:'fri',l:'금'}];
const _TT_PERIODS=8;
function _getTimetable(){
  try{
    const o=JSON.parse(localStorage.getItem('ec_home_timetable')||'{}')||{};
    if(!o.grid||typeof o.grid!=='object') o.grid={};
    if(!Array.isArray(o.periods)) o.periods=[];
    return o;
  }catch(_){ return {periods:[],grid:{}}; }
}
function _saveTimetable(o){ try{ localStorage.setItem('ec_home_timetable', JSON.stringify(o)); }catch(_){} }
function _wTimetableContent(){
  const tt=_getTimetable(), dow=new Date().getDay();
  const dayKey=['','mon','tue','wed','thu','fri',''][dow]||'';
  const action=_schoolWidgetButton('open-timetable-editor','시간표 입력·편집');
  let body;
  if(!dayKey){
    body=_schoolWidgetState('empty','오늘은 주말이에요','직접 입력한 시간표를 편집하거나 다음 주 수업을 준비해 보세요.',action);
  }else{
    const row=tt.grid[dayKey]||[],items=[];
    for(let i=0;i<_TT_PERIODS;i++){
      const subject=String(row[i]||'').trim();
      if(subject) items.push({period:i+1,subject:subject,time:(tt.periods[i]&&tt.periods[i].time)||''});
    }
    body=items.length?_schoolScheduleList(items,'open-timetable-editor','시간표 편집'):_schoolWidgetState('empty','오늘 등록된 수업이 없어요','담당 수업과 시간을 등록해 보세요.',action);
  }
  return '<div class="tt-body" title="더블클릭하여 시간표 편집">'+body+'</div>';
}
/* 시간표 편집 팝업 — 행=1~8교시, 열=[교시·시간] 월 화 수 목 금. 입력 즉시 저장. */
function _openTimetableEditor(){
  const old=document.getElementById('ttEditorOverlay'); if(old) old.remove();
  const tt=_getTimetable();
  const ov=document.createElement('div'); ov.id='ttEditorOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
  let h='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:780px;max-width:96vw;max-height:92vh;box-shadow:0 18px 50px rgba(0,0,0,0.45);display:flex;flex-direction:column;overflow:hidden;font-family:var(--f)">';
  /* 헤더 — 위젯 보관함과 동일 그라데이션(시안0.10+보라0.06,135deg). ✕ 버튼 제거(ESC·배경클릭으로 닫힘, 입력 즉시 저장이라 닫아도 보존). */
  h+='<div style="padding:14px 18px;background:rgba(6,182,212,0.10);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px"><span style="font-size:22px">📅</span><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">주간 시간표 입력</div><div style="font-size:11px;color:var(--t3);margin-top:2px">각 칸에 과목명을 입력하면 즉시 저장됩니다. (ESC 또는 바깥 클릭으로 닫기)</div></div></div>';
  h+='<div style="padding:14px 16px;overflow:auto;flex:1">';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px;line-height:1.6">맨 왼쪽 칸은 위=교시, 아래=시간(예: 09:00~09:50). 각 칸에 과목명을 입력하세요. 빈 칸은 공강입니다.</div>';
  h+='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>';
  h+='<th style="padding:6px;border:1px solid var(--bdr);background:var(--bg2);width:92px"></th>';
  _TT_DAYS.forEach(function(d){h+='<th style="padding:6px;border:1px solid var(--bdr);background:var(--bg2);font-weight:700;color:var(--t2)">'+d.l+'</th>';});
  h+='</tr></thead><tbody>';
  for(let pi=0;pi<_TT_PERIODS;pi++){
    const time=(tt.periods[pi]&&tt.periods[pi].time)||'';
    h+='<tr><td style="padding:4px;border:1px solid var(--bdr);background:var(--bg2);text-align:center">'
      +'<div style="font-size:11px;font-weight:800;color:var(--t1);margin-bottom:3px">'+(pi+1)+'교시</div>'
      +'<input data-tt-time="'+pi+'" value="'+escHtml(time)+'" placeholder="09:00~09:50" style="width:80px;font-size:9px;padding:3px 4px;text-align:center;border:1px solid var(--bdr);border-radius:4px;background:var(--card);color:var(--t1)">'
      +'</td>';
    _TT_DAYS.forEach(function(d){
      const subj=((tt.grid[d.k]||[])[pi])||'';
      h+='<td style="padding:2px;border:1px solid var(--bdr)"><input data-tt-day="'+d.k+'" data-tt-period="'+pi+'" value="'+escHtml(subj)+'" placeholder="·" style="width:100%;font-size:11px;padding:6px;text-align:center;border:none;background:transparent;color:var(--t1);box-sizing:border-box"></td>';
    });
    h+='</tr>';
  }
  h+='</tbody></table></div>';
  /* 하단 버튼 줄 — 전체 초기화(좌, 위험) / 바로 앞으로 되돌리기(우, Ctrl+Z) */
  h+='<div style="padding:12px 18px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;align-items:center;justify-content:space-between;gap:8px">';
  h+='<button data-tt-reset style="border:1px solid rgba(220,38,38,0.35);background:rgba(220,38,38,0.06);color:#dc2626;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--f)">⟲ 전체 초기화</button>';
  h+='<button data-tt-undo style="border:0;background:#0891b2;color:#fff;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--f);box-shadow:0 4px 12px rgba(6,182,212,0.25)" title="단축키: Ctrl+Z">↶ 바로 앞으로 되돌리기</button>';
  h+='</div>';
  h+='</div>';
  ov.innerHTML=h;
  document.body.appendChild(ov);
  /* ── 되돌리기(undo) 히스토리 — 모달 세션 한정. 같은 칸 연속 입력은 1단계로 합침. ── */
  const _ttHist=[];
  let _ttCoalesce=null;
  function _ttSnapshot(targetKey){
    if(_ttCoalesce===targetKey) return;                 /* 같은 칸 연속 편집 → 1단계 유지 */
    _ttCoalesce=targetKey;
    _ttHist.push(JSON.stringify(_getTimetable()));      /* 변경 직전 상태 보관 */
    if(_ttHist.length>200) _ttHist.shift();
  }
  function _ttSyncInputs(state){
    ov.querySelectorAll('input[data-tt-time]').forEach(function(inp){
      const pi=+inp.getAttribute('data-tt-time');
      inp.value=(state.periods&&state.periods[pi]&&state.periods[pi].time)||'';
    });
    ov.querySelectorAll('input[data-tt-day]').forEach(function(inp){
      const dk=inp.getAttribute('data-tt-day'), pi=+inp.getAttribute('data-tt-period');
      inp.value=(((state.grid&&state.grid[dk])||[])[pi])||'';
    });
  }
  function _ttUndo(){
    if(!_ttHist.length) return;                          /* 되돌릴 변경 없음 */
    const prev=JSON.parse(_ttHist.pop());
    _ttCoalesce=null;
    _saveTimetable(prev);
    _ttSyncInputs(prev);
    _homeSaveToast();
  }
  function _ttReset(){
    _ttHist.push(JSON.stringify(_getTimetable()));       /* 초기화도 되돌릴 수 있게 */
    _ttCoalesce=null;
    const def={periods:[],grid:{}};
    _saveTimetable(def);
    _ttSyncInputs(def);
    _homeSaveToast();
  }
  function _close(){ if(ov.parentNode)ov.remove(); document.removeEventListener('keydown',_onKey,true); renderHomeDashboard(); }
  function _onKey(e){
    if(e.key==='Escape'){ e.preventDefault(); _close(); return; }
    if((e.ctrlKey||e.metaKey) && (e.key==='z'||e.key==='Z') && !e.shiftKey){ e.preventDefault(); _ttUndo(); return; }
  }
  document.addEventListener('keydown',_onKey,true);
  ov.addEventListener('click',function(e){
    if(e.target===ov){ _close(); return; }
    if(e.target.closest('[data-tt-undo]')){ _ttUndo(); return; }
    if(e.target.closest('[data-tt-reset]')){
      if(window.confirm('주간 시간표를 모두 비우고 처음 상태로 되돌릴까요?')) _ttReset();
      return;
    }
  });
  /* 입력 즉시 저장 (+ 변경 직전 상태를 되돌리기 히스토리에 적재) */
  ov.addEventListener('input',function(e){
    const t=e.target;
    let key=null;
    if(t.hasAttribute('data-tt-time')) key='time:'+t.getAttribute('data-tt-time');
    else if(t.hasAttribute('data-tt-day')) key='day:'+t.getAttribute('data-tt-day')+':'+t.getAttribute('data-tt-period');
    else return;
    _ttSnapshot(key);
    const cur=_getTimetable();
    if(t.hasAttribute('data-tt-time')){
      const pi=+t.getAttribute('data-tt-time');
      while(cur.periods.length<=pi) cur.periods.push({});
      cur.periods[pi]={time:t.value};
    } else {
      const dk=t.getAttribute('data-tt-day'), pi=+t.getAttribute('data-tt-period');
      if(!Array.isArray(cur.grid[dk])) cur.grid[dk]=[];
      while(cur.grid[dk].length<=pi) cur.grid[dk].push('');
      cur.grid[dk][pi]=t.value;
    }
    _saveTimetable(cur);
    _homeSaveToast();
  });
  setTimeout(function(){ const f=ov.querySelector('input[data-tt-day]'); if(f)f.focus(); },30);
}

/* ── 수업 간단 메모 위젯 — 학기 1~18주차, 현재 주차 자동 스크롤 ──────────
 * 저장: ec_home_lesson_memos = {sem1:{1:'...',2:'...'}, sem2:{...}}
 *      ec_home_lesson_semester = 'sem1' | 'sem2' (현재 선택 학기)
 * 학기 시작일은 ec_settings.semesterInfo 가 있으면 사용, 없으면 기본 3/2·9/1. */
/* 학기 시작일이 포함된 주의 월요일 — 매년 학기 시작일이 다른 요일이어도 그 주 월요일을 1주차 월요일로 사용.
 *  사용자 요청 2026-05-28 — 주차 라벨을 "월/일-월/일" 범위로 표시하기 위한 기준일. */
function _semesterWeek1Monday(sem){
  try{
    const _s = JSON.parse(localStorage.getItem('ec_settings')||'{}');
    const _si = _s.semesterInfo || _s.semester_info || {};
    const _startStr = sem==='sem1' ? (_si.sem1Start||_si.semester1Start) : (_si.sem2Start||_si.semester2Start);
    let start;
    if(_startStr){ start = new Date(_startStr); }
    if(!start || isNaN(start.getTime())){
      const yr = new Date().getFullYear();
      start = sem==='sem1' ? new Date(yr,2,2) : new Date(yr,8,1);
    }
    const day = start.getDay(); /* 0=일, 1=월, ..., 6=토 */
    /* 일요일이면 다음 날(+1), 토요일이면 다다음 날(+2), 평일이면 그 주 월요일 (1-day) */
    const daysToMon = (day === 0) ? 1 : (day === 6 ? 2 : (1 - day));
    const mon = new Date(start.getFullYear(), start.getMonth(), start.getDate() + daysToMon);
    return mon;
  }catch(e){ return null; }
}
/* w 주차의 월~금 라벨 — 예: "5/4-5/8", "12/30-1/3" (월 넘어가도 자동). */
function _lessonWeekLabel(sem, w){
  const w1Mon = _semesterWeek1Monday(sem);
  if(!w1Mon) return w+'주차'; /* 폴백 — 학기 정보 못 읽으면 옛 라벨 */
  const mon = new Date(w1Mon.getFullYear(), w1Mon.getMonth(), w1Mon.getDate() + (w-1)*7);
  const fri = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 4);
  return (mon.getMonth()+1)+'/'+mon.getDate()+'-'+(fri.getMonth()+1)+'/'+fri.getDate();
}
function _calcCurrentWeek(sem){
  try{
    const w1Mon = _semesterWeek1Monday(sem);
    if(!w1Mon) return 0;
    const now = new Date();
    if(now < w1Mon) return 0;
    const diff = Math.floor((now - w1Mon)/(7*24*60*60*1000)) + 1;
    if(diff < 1 || diff > 18) return 0;
    return diff;
  }catch(e){ return 0; }
}
/* 오늘이 속한 학기 — 3~7월=1학기, 그 외=2학기. */
function _currentSemester(){ const m=new Date().getMonth(); return (m>=2&&m<=6)?'sem1':'sem2'; }
let _lessonSemDefaulted=false;
/* 자동 스크롤 1회 가드 — 같은 학기 안에서는 첫 렌더에만 현재 주차로 스크롤.
 *  사용자 보고 2026-05-31: 다른 위젯 입력 모달(_homePromptMulti)에 입력할 때마다 250ms debounce 로
 *  renderHomeDashboard() 가 호출되어 lessonmemo body 가 재렌더되고 30/200/600ms setTimeout 3개가
 *  누적 발사돼 hlmList scrollTop 이 마구 흔들리는 기현상.
 *  학기 변경(lesson-sem-change) 시 null 로 reset → 새 학기에서 1회 스크롤. */
let _lessonScrolledFor=null;
function _wLessonMemoContent(){
  let sem = localStorage.getItem('ec_home_lesson_semester') || _currentSemester();
  /* 프로그램 실행 후 첫 렌더 — 오늘이 포함된 학기로 자동 맞춤 → 현재 주차 하이라이트가 항상 보이게.
   *  이후 드롭다운 수동 전환은 그대로 보존(세션 한정 _lessonSemDefaulted 플래그). */
  if(!_lessonSemDefaulted){
    _lessonSemDefaulted=true;
    let _todaySem=null;
    if(_calcCurrentWeek('sem1')>0) _todaySem='sem1';
    else if(_calcCurrentWeek('sem2')>0) _todaySem='sem2';
    if(_todaySem && _todaySem!==sem){ sem=_todaySem; try{ localStorage.setItem('ec_home_lesson_semester', sem); }catch(_){} }
  }
  let memos = {};
  try{ memos = JSON.parse(localStorage.getItem('ec_home_lesson_memos')||'{}')||{}; }catch(e){}
  const semMemos = memos[sem] || {};
  const curWeek = _calcCurrentWeek(sem);
  let h = '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">';
  h += '<select data-action="lesson-sem-change" style="flex:1;font-size:10.5px;padding:4px 7px;border:1px solid var(--bdr);border-radius:5px;background:var(--bg);color:var(--t1);cursor:pointer">';
  h += '<option value="sem1"'+(sem==='sem1'?' selected':'')+'>1학기</option>';
  h += '<option value="sem2"'+(sem==='sem2'?' selected':'')+'>2학기</option>';
  h += '</select>';
  if(curWeek > 0) h += '<span data-action="lesson-goto-current" title="현재 주차로 이동" style="font-size:9.5px;font-weight:700;color:var(--cyan);background:rgba(6,182,212,0.10);padding:3px 7px;border-radius:5px;cursor:pointer">현재 '+_lessonWeekLabel(sem, curWeek)+'</span>';
  h += '</div>';
  const _weekCount = _lessonWeekCount(sem, semMemos); /* 학기 기간(⚙)에 맞춘 주차 수. 메모 있는 주차는 항상 포함. */
  h += '<div id="hlmList" data-cur-week="'+curWeek+'" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;padding-right:4px">';
  for(let w = 1; w <= _weekCount; w++){
    const isCur = (w === curWeek);
    const memo = (semMemos[w] || '').toString();
    h += '<div data-week="'+w+'" style="display:flex;gap:5px;align-items:center;padding:2px 5px;border-radius:4px;'+(isCur?'background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.35)':'border:1px solid transparent')+'">';
    h += '<span style="font-size:9.5px;font-weight:'+(isCur?'800':'600')+';color:'+(isCur?'var(--cyan)':'var(--t3)')+';min-width:64px;white-space:nowrap">'+_lessonWeekLabel(sem, w)+'</span>';
    h += '<input type="text" placeholder="간단 메모" value="'+escHtml(memo)+'" data-action="lesson-memo-input" data-week="'+w+'" data-sem="'+sem+'" style="flex:1;min-width:0;font-size:10.5px;padding:3px 6px;border:1px solid var(--bdr);border-radius:3px;background:var(--bg);color:var(--t1)">';
    h += '</div>';
  }
  h += '</div>';
  /* 렌더 후 현재 주차로 자동 스크롤 — 사용자 보고 2026-05-28: 재실행/탭 복귀 시 항상 현재 주차가 보여야 함.
   *  단일 30ms 로는 위젯 가시성 토글·비동기 위젯 로딩으로 인한 layout shift 시 scrollTop 이 초기화되거나
   *  list 가 아직 hidden(offsetParent=null)이라 실패하는 케이스 → 다단계로 재시도하여 확실히 보장. */
  function _scrollHlmToCurrent(){
    const _list = document.getElementById('hlmList');
    if(!_list || _list.offsetParent === null) return;
    _list.style.setProperty('scroll-behavior','auto','important');
    /* 사용자가 스크롤해 둔 위치(>4)면 그대로 유지(편집 시 안 움직임). 0~4·없음이면 현재 주차로. */
    if(_lessonSavedScroll!=null && _lessonSavedScroll>4){
      if(Math.abs(_list.scrollTop - _lessonSavedScroll) > 1) _list.scrollTop=_lessonSavedScroll;
      return;
    }
    if(curWeek <= 0) return;
    if(document.getElementById('homePromptOv') || document.getElementById('ttEditorOverlay')) return;
    const _cur = _list.querySelector('[data-week="'+curWeek+'"]');
    if(_cur){
      /* 현재 주차 위에 3개 주차만 보이게 — getBoundingClientRect 로 hlmList 기준 정확히(offsetTop 부정확 회피). */
      const _delta = (_cur.getBoundingClientRect().top - _list.getBoundingClientRect().top) - 3*(_cur.offsetHeight+3);
      _list.scrollTop = Math.max(0, _list.scrollTop + _delta);
    }
  }
  setTimeout(_scrollHlmToCurrent, 30);
  setTimeout(_scrollHlmToCurrent, 200);
  setTimeout(_scrollHlmToCurrent, 600);
  return h;
}
/* "현재 ○주차" 배지 클릭 → 현재 주차를 목록 가운데로 스크롤 (명시적 클릭이므로 가드 없음) */
function _scrollLessonToCurrent(){
  const _list=document.getElementById('hlmList');
  if(!_list)return;
  _list.style.setProperty('scroll-behavior','auto','important');
  const cw=parseInt(_list.dataset.curWeek||'0',10);
  if(!cw)return;
  const _cur=_list.querySelector('[data-week="'+cw+'"]');
  if(_cur){ const _d=(_cur.getBoundingClientRect().top-_list.getBoundingClientRect().top)-3*(_cur.offsetHeight+3); _list.scrollTop=Math.max(0,_list.scrollTop+_d); } /* 현재 주차 위 3주차만 */
}
function _saveLessonMemo(sem, week, val){
  let memos = {};
  try{ memos = JSON.parse(localStorage.getItem('ec_home_lesson_memos')||'{}')||{}; }catch(e){}
  if(!memos[sem]) memos[sem] = {};
  if(val) memos[sem][week] = val;
  else delete memos[sem][week];
  try{ localStorage.setItem('ec_home_lesson_memos', JSON.stringify(memos)); }catch(e){}
}

/* ── 수업 메모 ⚙ 학기 기간 설정 (2026-06-08) ───────────────────────────────
 *  1·2학기 시작/끝 날짜를 ec_settings.semesterInfo 에 저장. 시작일은 _semesterWeek1Monday 가 읽어
 *  주차 라벨·현재주차 계산에 사용. 끝날짜는 _lessonWeekCount 가 표시 주차 수 산정에 사용
 *  (단, 메모가 있는 주차는 절대 숨기지 않음). 날짜는 사이드바와 동일한 휴일 달력(_openProgCalPicker)에서 선택. */
function _semDateLabel(v){
  const m = String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[1]+'.'+parseInt(m[2],10)+'.'+parseInt(m[3],10)+'.') : '미지정';
}
function _saveLessonSemCfg(cfg){
  let s = {};
  try{ s = JSON.parse(localStorage.getItem('ec_settings')||'{}')||{}; }catch(_){}
  s.semesterInfo = Object.assign({}, s.semesterInfo||{}, cfg);
  try{ localStorage.setItem('ec_settings', JSON.stringify(s)); }catch(_){}
  try{ if(S && S.settings) S.settings.semesterInfo = s.semesterInfo; }catch(_){}
  /* ec_settings 는 commonMappings('settings')로 DB 백업 대상 — dbSet 으로 영속화. */
  try{ if(window.electronAPI&&window.electronAPI.dbSet) window.electronAPI.dbSet('common','settings',s); }catch(_){}
}
/* 표시할 주차 수 — 시작~끝으로 산정(기본 18, [1,30] 클램프). 메모가 입력된 최대 주차는 절대 가리지 않음. */
function _lessonWeekCount(sem, semMemos){
  let maxMemoWeek = 0;
  try{ Object.keys(semMemos||{}).forEach(function(k){ const n=parseInt(k,10); if(n>maxMemoWeek && (semMemos[k]||'').toString()!=='') maxMemoWeek=n; }); }catch(_){}
  let weeks = 18;
  try{
    const w1 = _semesterWeek1Monday(sem);
    const _s = JSON.parse(localStorage.getItem('ec_settings')||'{}');
    const _si = _s.semesterInfo || {};
    const endStr = sem==='sem1' ? (_si.sem1End||_si.semester1End) : (_si.sem2End||_si.semester2End);
    if(w1 && endStr){
      const end = new Date(endStr);
      if(!isNaN(end.getTime()) && end >= w1) weeks = Math.floor((end - w1)/(7*24*60*60*1000)) + 1;
    }
  }catch(_){}
  if(weeks < 1) weeks = 1;
  if(weeks > 30) weeks = 30;
  if(maxMemoWeek > weeks) weeks = maxMemoWeek; /* 메모 있는 주차는 절대 숨김 금지 */
  return weeks;
}
/* 인라인 미니 달력 HTML — 사이드바와 동일한 mcal 마크업 + 휴일. 연도 팝업은 올해·내년 2개만.
 *  sel: 선택된 'YYYY-MM-DD'. data-action 은 mc-* 로(모달 안 4개 독립). */
function _lscCalHtml(curY, curM, sel){
  const MONTHS=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  try{ ensureHolidayYear(String(curY)); }catch(_){}
  const first=new Date(curY,curM,1), last=new Date(curY,curM+1,0);
  const startDay=first.getDay(), days=last.getDate(), prevLast=new Date(curY,curM,0).getDate();
  const today=_ymd(new Date());
  const _ny=new Date().getFullYear();
  let yPop='<div class="mcal-popup">';
  for(let y=_ny;y<=_ny+1;y++) yPop+='<div class="mcal-popup-item'+(y===curY?' active':'')+'" data-action="mc-year" data-year="'+y+'">'+y+'</div>';
  yPop+='</div>';
  let mPop='<div class="mcal-popup" style="min-width:140px;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++) mPop+='<div class="mcal-popup-item'+(m===curM?' active':'')+'" data-action="mc-month" data-month="'+m+'" style="width:45px">'+MONTHS[m]+'</div>';
  mPop+='</div>';
  let html='<div class="mcal-hdr"><div class="mcal-nav"><button class="mcal-btn" data-action="mc-prev">◂</button></div>'
    +'<div class="mcal-title"><span class="mcal-year">'+curY+'년'+yPop+'</span> <span class="mcal-month">'+MONTHS[curM]+mPop+'</span></div>'
    +'<div class="mcal-nav"><button class="mcal-btn" data-action="mc-next">▸</button></div></div><div class="mcal-grid">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){ let cls='mcal-dow'; if(i===0)cls+=' sun'; if(i===6)cls+=' sat'; html+='<div class="'+cls+'">'+d+'</div>'; });
  for(let i=startDay-1;i>=0;i--) html+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
  for(let d=1;d<=days;d++){
    const ds=_ymd(new Date(curY,curM,d));
    const dow=new Date(curY,curM,d).getDay();
    const hol=isHoliday(ds);
    let cls='mcal-cell';
    if(ds===today)cls+=' today';
    if(ds===sel)cls+=' selected';
    if(dow===0)cls+=' sun'; if(dow===6)cls+=' sat';
    if(hol&&dow!==0&&dow!==6)cls+=' holiday';
    html+='<div class="'+cls+'" data-action="mc-day" data-ds="'+ds+'"><span class="day-n">'+d+'</span></div>';
  }
  const total=startDay+days, rem=(7-total%7)%7;
  for(let i=1;i<=rem;i++) html+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
  html+='</div>';
  return html;
}
/* host 컨테이너에 미니 달력을 마운트. cfg[slotKey] 를 선택값으로, 날짜 클릭 시 cfg 갱신 + afterPick(). */
function _lscMountCal(host, slotKey, cfg, afterPick, defY, defM){
  if(host._cy==null){
    const v=cfg[slotKey]; const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m){ host._cy=parseInt(m[1],10); host._cm=parseInt(m[2],10)-1; }
    else { const n=new Date(); host._cy=(defY!=null?defY:n.getFullYear()); host._cm=(defM!=null?defM:n.getMonth()); }
  }
  function _render(){ host.innerHTML=_lscCalHtml(host._cy, host._cm, cfg[slotKey]||''); }
  host._render=_render;
  host.onclick=function(e){
    if(e.target.closest('[data-action="mc-prev"]')){ host._cm--; if(host._cm<0){host._cm=11;host._cy--;} _render(); return; }
    if(e.target.closest('[data-action="mc-next"]')){ host._cm++; if(host._cm>11){host._cm=0;host._cy++;} _render(); return; }
    const y=e.target.closest('[data-action="mc-year"]'); if(y){ const yv=parseInt(y.dataset.year,10); if(!isNaN(yv)){ host._cy=yv; _render(); } return; }
    const m=e.target.closest('[data-action="mc-month"]'); if(m){ const mv=parseInt(m.dataset.month,10); if(!isNaN(mv)){ host._cm=mv; _render(); } return; }
    const day=e.target.closest('[data-action="mc-day"]'); if(day){ cfg[slotKey]=day.dataset.ds; host._cy=parseInt(day.dataset.ds.slice(0,4),10); host._cm=parseInt(day.dataset.ds.slice(5,7),10)-1; _render(); if(afterPick) afterPick(); return; }
  };
  _render();
}
function _openLessonSemConfig(){
  if(document.getElementById('lessonSemCfgOv')) return;
  let si = {};
  try{ si = (JSON.parse(localStorage.getItem('ec_settings')||'{}').semesterInfo)||{}; }catch(_){}
  const cfg = {
    sem1Start: si.sem1Start || si.semester1Start || '',
    sem1End:   si.sem1End   || si.semester1End   || '',
    sem2Start: si.sem2Start || si.semester2Start || '',
    sem2End:   si.sem2End   || si.semester2End   || '',
  };
  const ov = document.createElement('div');
  ov.id='lessonSemCfgOv';
  ov.style.cssText='position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;opacity:0;transition:opacity 0.18s ease';
  const _slot=function(label,key){
    return '<div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:800;color:var(--t1);margin-bottom:5px;text-align:right">'+label+' <span id="lsclbl-'+key+'" style="color:var(--cyan);font-weight:700;margin-left:4px">'+_semDateLabel(cfg[key])+'</span></div><div id="lscal-'+key+'" style="width:100%"></div></div>';
  };
  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:980px;max-width:95vw;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.4);overflow:hidden">'
    +'<div style="padding:14px 18px;border-bottom:1px solid var(--bdr);background:rgba(6,182,212,0.10);display:flex;align-items:center;gap:8px;flex-shrink:0"><span style="font-size:16px">⚙</span><div style="font-size:14px;font-weight:800;color:var(--t1)">학기·학년도 기간 설정</div></div>'
    +'<div style="padding:14px 18px;overflow:auto">'
    +'<div style="font-size:10.5px;color:var(--t3);margin-bottom:12px;line-height:1.5">올해 각 학기의 시작일과 종료일을 설정하며 아래 <b style="color:var(--t2)">학년도</b>에 자동 적용됩니다. 날짜를 누르면 <b style="color:var(--t2)">바로 저장</b>됩니다. 비우면 기본값(1학기 3/2, 2학기 9/1). 입력한 메모는 영향받지 않습니다.</div>'
    +'<div style="display:flex;gap:20px;margin-bottom:14px">'
    +  '<div style="flex:1;min-width:0">'
    +    '<div style="font-size:16px;font-weight:800;color:var(--cyan);margin-bottom:8px">📘 1학기</div>'
    +    '<div style="display:flex;gap:10px">'+_slot('시작일','sem1Start')+_slot('종료일','sem1End')+'</div>'
    +  '</div>'
    +  '<div style="flex:1;min-width:0;border-left:1px dashed var(--bdr);padding-left:20px">'
    +    '<div style="font-size:16px;font-weight:800;color:var(--cyan);margin-bottom:8px">📗 2학기</div>'
    +    '<div style="display:flex;gap:10px">'+_slot('시작일','sem2Start')+_slot('종료일','sem2End')+'</div>'
    +  '</div>'
    +'</div>'
    +'<div style="font-size:16px;font-weight:800;color:#f59e0b;margin:4px 0 8px;border-top:1px dashed var(--bdr);padding-top:14px">🎓 학년도 <span style="font-size:10.5px;font-weight:600;color:var(--t3)">(자동 적용)</span></div>'
    +'<div style="font-size:10.5px;color:var(--t3);margin-bottom:10px;line-height:1.5">이번 학년도의 시작일과 종료일을 설정하며 위 <b style="color:var(--t2)">학기</b> 설정으로 자동 적용됩니다. (1학기 시작일 ~ 2학기 종료일)</div>'
    +'<div style="display:flex;gap:14px;margin-bottom:12px">'
    +  '<div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:800;color:var(--t1);text-align:right">시작일 <span id="lsclbl-ayStart" style="color:#f59e0b;font-weight:700;margin-left:4px">'+_semDateLabel(cfg.sem1Start)+'</span></div></div>'
    +  '<div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:800;color:var(--t1);text-align:right">종료일 <span id="lsclbl-ayEnd" style="color:#f59e0b;font-weight:700;margin-left:4px">'+_semDateLabel(cfg.sem2End)+'</span></div></div>'
    +'</div>'
    +'<div style="display:flex;justify-content:flex-end"><button id="lscClearAll" style="padding:8px 16px;border:1px solid rgba(220,38,38,0.4);background:rgba(220,38,38,0.06);color:#dc2626;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">날짜 전체 삭제</button></div>'
    +'</div></div>';
  document.body.appendChild(ov);
  /* 열기 애니메이션 — 오버레이 페이드 + 카드 팝인(다른 모달과 동일 톤). */
  const _card=ov.firstElementChild;
  if(_card){ _card.style.transition='transform 0.2s cubic-bezier(.2,.9,.3,1.1),opacity 0.2s ease'; _card.style.transform='translateY(10px) scale(.97)'; _card.style.opacity='0'; }
  requestAnimationFrame(function(){ ov.style.opacity='1'; if(_card){ _card.style.transform='none'; _card.style.opacity='1'; } });
  const _onHol=function(){ Object.keys(_hosts).forEach(function(k){ if(_hosts[k]&&_hosts[k]._render)_hosts[k]._render(); }); };
  /* 닫기 애니메이션 — 페이드아웃 후 제거. */
  const _close=function(){ try{ bus.off('holidays:updated',_onHol); }catch(_){} ov.style.opacity='0'; if(_card){ _card.style.transform='translateY(8px) scale(.98)'; _card.style.opacity='0'; } setTimeout(function(){ const o=document.getElementById('lessonSemCfgOv'); if(o)o.remove(); }, 180); };
  ov.addEventListener('click', function(e){ if(e.target===ov) _close(); });
  /* 날짜 선택·삭제 시 즉시 저장 + 라벨·대시보드 갱신(저장 버튼 없음, 자동 저장). */
  function _afterChange(){
    ['sem1Start','sem1End','sem2Start','sem2End'].forEach(function(k){ const l=document.getElementById('lsclbl-'+k); if(l) l.textContent=_semDateLabel(cfg[k]); });
    /* 학년도(자동) 라벨 = 1학기 시작 ~ 2학기 종료 */
    const _ays=document.getElementById('lsclbl-ayStart'); if(_ays)_ays.textContent=_semDateLabel(cfg.sem1Start);
    const _aye=document.getElementById('lsclbl-ayEnd'); if(_aye)_aye.textContent=_semDateLabel(cfg.sem2End);
    _saveLessonSemCfg(cfg);
    _lessonForceCur=true; /* 기간 바뀜 → 현재 주차로 */
    try{ renderHomeDashboard(); }catch(_){}
    if(typeof _homeSaveToast==='function') _homeSaveToast();
  }
  const _hosts={};
  /* 각 달력 기본 표시 월 — 1학기: 3월·7월 / 2학기: 8월·다음해 1월 (기준=학년도 시작 연도). 날짜가 이미 있으면 그 월. */
  const _ay=_academicYear();
  const _defs={ sem1Start:[_ay,2], sem1End:[_ay,6], sem2Start:[_ay,7], sem2End:[_ay+1,0] };
  ['sem1Start','sem1End','sem2Start','sem2End'].forEach(function(key){
    const host=document.getElementById('lscal-'+key); if(!host) return;
    _hosts[key]=host;
    _lscMountCal(host, key, cfg, _afterChange, _defs[key][0], _defs[key][1]);
  });
  try{ bus.on('holidays:updated',_onHol); }catch(_){}
  const clr=document.getElementById('lscClearAll');
  if(clr) clr.addEventListener('click', function(){
    cfg.sem1Start=cfg.sem1End=cfg.sem2Start=cfg.sem2End='';
    Object.keys(_hosts).forEach(function(k){ if(_hosts[k]&&_hosts[k]._render)_hosts[k]._render(); });
    _afterChange();
  });
}

/* 학기·학년도 4-달력 설정을 다른 모듈(설정 탭 등)에서도 열 수 있게 노출 — 순환 import 회피 (사용자 지시 2026-06-16) */
try{ window._homeOpenSemConfig = _openLessonSemConfig; }catch(_){}

/* ── 출근(앱 시작) 시 당일 일정 알림 ──────────────────────────────────────
 * 사용자 피드백: 보건일지 내장 캘린더를 구글 연동 없이 직장 전용으로 쓰는 수요.
 * 같은 날 1회만 표시 (마커: ec_home_today_events_alerted = YYYY-MM-DD).
 * 오늘 일정 0건이면 표시 X. */
function _checkTodayEventsAlert(){
  try{
    const today = _todayStr();
    const lastShown = localStorage.getItem('ec_home_today_events_alerted') || '';
    if(lastShown === today) return;                /* 오늘 이미 표시됨 — skip */
    const todayEvents = _localEvents[today] || [];
    if(!todayEvents.length) return;                /* 오늘 일정 0건 — 표시 X */
    /* 시간순 정렬 (시간 없는 일정 = 종일, 맨 위) */
    const sorted = todayEvents.slice().sort(function(a,b){
      const ta = a.time || ''; const tb = b.time || '';
      if(!ta && tb) return -1;
      if(ta && !tb) return 1;
      return ta.localeCompare(tb);
    });
    _showTodayEventsAlert(sorted, today);
    localStorage.setItem('ec_home_today_events_alerted', today);
  }catch(e){ console.error('[today-events-alert]', e); }
}
/* ── 일정 시간 도래 알람 워처 (매분) ─────────────────────────────────────
 * 일정의 time(HH:MM) 이 현재 분과 같으면 알람 모달 + 비프음.
 * 같은 일정 같은 날에 1회만 (마커: ec_home_event_alarm_fired_YYYY-MM-DD = {eventId:true}). */
let _alarmIntervalId = null;
function _startTodayEventAlarmsWatcher(){
  if(_alarmIntervalId) return;
  /* 즉시 1회 + 매분 체크. 분 경계 정확도는 ±1분 허용. */
  _checkEventAlarms();
  _alarmIntervalId = setInterval(_checkEventAlarms, 60000);
}
function _checkEventAlarms(){
  try{
    const today = _todayStr();
    const todayEvents = _localEvents[today] || [];
    if(!todayEvents.length) return;
    const now = new Date();
    const nowHHMM = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    let fired = {};
    try{ fired = JSON.parse(localStorage.getItem('ec_home_event_alarm_fired_'+today)||'{}'); }catch(e){}
    let changed = false;
    todayEvents.forEach(function(ev){
      if(!ev || !ev.time) return;          /* 종일 일정 제외 */
      if(ev.time !== nowHHMM) return;      /* 현재 분 매칭만 */
      if(fired[ev.id]) return;             /* 이미 알람됨 */
      _showEventAlarm(ev);
      fired[ev.id] = true;
      changed = true;
    });
    if(changed){
      try{ localStorage.setItem('ec_home_event_alarm_fired_'+today, JSON.stringify(fired)); }catch(e){}
    }
  }catch(e){ console.error('[event-alarm]', e); }
}
function _showEventAlarm(ev){
  /* 짧은 비프음 (data URI) — 외부 파일 의존 X */
  try{ new Audio('data:audio/wav;base64,UklGRiQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQADAACAgIB/f3+AgIB/f4CAgH9/gIB/gIB/gIB/f4CAf4CAgH9/gIB/gIB/gIB/gIB/gIB/gIB/gIB/gIB/gIB/gIB/gIB/gIB/gICAf4CAf4CAf4CAf4CAgH+AgH+AgH+Af4CAf4CAf4CAf4CAf4CAf4CAgH+AgIB/gICAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CAf4CA').play(); }catch(e){}
  if(document.getElementById('eventAlarmModal')) document.getElementById('eventAlarmModal').remove();
  const ov = document.createElement('div');
  ov.id = 'eventAlarmModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:11500;display:flex;align-items:center;justify-content:center';
  let h = '<div style="background:var(--card);border-radius:14px;width:380px;max-width:92vw;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden;border:2px solid '+(ev.color || '#22c55e')+'">';
  h += '<div style="padding:14px 20px;background:'+(ev.color||'#22c55e')+';color:#fff;display:flex;align-items:center;gap:10px">';
  h += '<span style="font-size:28px">⏰</span>';
  h += '<div style="flex:1"><div style="font-size:11px;font-weight:700;opacity:0.85;letter-spacing:0.5px">일정 알람</div>';
  h += '<div style="font-size:16px;font-weight:800;margin-top:2px">'+escHtml(ev.time||'')+'</div></div>';
  h += '</div>';
  h += '<div style="padding:18px 22px">';
  h += '<div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:6px">'+escHtml(ev.title||'')+'</div>';
  if(ev.memo) h += '<div style="font-size:12px;color:var(--t2);line-height:1.6">'+escHtml(ev.memo)+'</div>';
  h += '</div>';
  h += '<div style="padding:10px 20px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-end;background:var(--bg2)">';
  h += '<button id="ea-close-btn" style="padding:9px 22px;background:'+(ev.color||'#22c55e')+';color:#fff;border:none;border-radius:7px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:var(--f)">확인</button>';
  h += '</div></div>';
  ov.innerHTML = h;
  const _close = function(){ if(ov && ov.parentNode) ov.remove(); };
  ov.addEventListener('click', function(e){ if(e.target === ov) _close(); });
  document.body.appendChild(ov);
  const _btn = document.getElementById('ea-close-btn');
  if(_btn){ _btn.addEventListener('click', _close); setTimeout(function(){ _btn.focus(); }, 30); }
  const _esc = function(e){ if(e.key === 'Escape'){ _close(); document.removeEventListener('keydown', _esc, true); } };
  document.addEventListener('keydown', _esc, true);
}

function _showTodayEventsAlert(events, today){
  if(document.getElementById('todayEventsAlert')) return;
  const _m = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const todayKr = _m ? (_m[1]+'년 '+parseInt(_m[2],10)+'월 '+parseInt(_m[3],10)+'일') : today;
  const ov = document.createElement('div');
  ov.id = 'todayEventsAlert';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:11000;display:flex;align-items:center;justify-content:center';
  let h = '<div style="background:var(--card);border-radius:14px;width:440px;max-width:92vw;max-height:80vh;box-shadow:0 24px 60px rgba(0,0,0,0.45);overflow:hidden;display:flex;flex-direction:column">';
  h += '<div style="padding:14px 20px;background:rgba(6,182,212,0.12);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px">';
  h += '<span style="font-size:24px">📅</span>';
  h += '<div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">오늘의 일정 안내</div>';
  h += '<div style="font-size:11px;color:var(--t3);margin-top:2px">'+escHtml(todayKr)+' · '+events.length+'건</div></div>';
  h += '</div>';
  h += '<div style="padding:14px 18px;overflow-y:auto;flex:1">';
  events.forEach(function(ev){
    h += '<div style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:rgba(34,197,94,0.08);border-left:3px solid #22c55e;border-radius:5px;margin-bottom:6px">';
    if(ev.time) h += '<span style="font-size:12px;font-family:var(--fm);font-weight:800;color:#22c55e;min-width:50px">'+escHtml(ev.time)+'</span>';
    else h += '<span style="font-size:10px;color:var(--t3);min-width:50px;font-weight:700">종일</span>';
    h += '<span style="font-size:12px;color:var(--t1);flex:1;line-height:1.5">'+escHtml(ev.title||'')+(ev.memo?'<br><span style="font-size:10px;color:var(--t3)">'+escHtml(ev.memo)+'</span>':'')+'</span>';
    h += '</div>';
  });
  h += '</div>';
  h += '<div style="padding:12px 20px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-end;background:var(--bg2)">';
  h += '<button id="tea-close-btn" style="padding:9px 22px;background:var(--cyan);color:#fff;border:none;border-radius:7px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:var(--f);box-shadow:0 4px 12px rgba(6,182,212,0.30)">확인</button>';
  h += '</div>';
  h += '</div>';
  ov.innerHTML = h;
  const _close = function(){ if(ov && ov.parentNode) ov.remove(); };
  ov.addEventListener('click', function(e){ if(e.target === ov) _close(); });
  document.body.appendChild(ov);
  const _btn = document.getElementById('tea-close-btn');
  if(_btn){ _btn.addEventListener('click', _close); setTimeout(function(){ _btn.focus(); }, 30); }
  /* Esc 로 닫기 */
  const _esc = function(e){ if(e.key === 'Escape'){ _close(); document.removeEventListener('keydown', _esc, true); } };
  document.addEventListener('keydown', _esc, true);
}

/* 학사일정 통합 색상 팝업 — 막대(배경+글씨, 이 일정만/전체 일괄) + 방학 칸 색(여름/겨울)을 한 곳에서. (사용자 요청 2026-06-17)
 *  · 막대 "이 일정만": ec_academic_colors / ec_academic_text_colors {title:color}
 *  · 막대 "전체 일괄": ec_academic_color / ec_academic_text_color + 개별 지정 해제
 *  · 방학 색: ec_vacation_colors {summer,winter} (기본 여름 분홍·겨울 연하늘)
 *  · 스와치 클릭 즉시 라이브 적용(팝업 유지), 외부 클릭으로 닫힘. */
function _openAcademicColorPicker(anchorEl, title){
  title = title || '';
  const existing=document.getElementById('acadColorPop'); if(existing)existing.remove();
  const isVac=String(title).replace(/\s/g,'').indexOf('방학')>=0;
  const _obj=function(k){ try{ const m=JSON.parse(localStorage.getItem(k)||'{}'); return (m&&typeof m==='object'&&!Array.isArray(m))?m:{}; }catch(_){ return {}; } };
  const bgPresets=['#a855f7','#8b5cf6','#6366f1','#3b82f6','#06b6d4','#10b981','#22c55e','#84cc16','#f59e0b','#ef4444','#ec4899','#64748b'];
  const fgPresets=['#ffffff','#000000','#1f2937','#fde047','#fca5a5','#a7f3d0','#bae6fd','#f5d0fe'];
  const vacPresets=['#ec4899','#f472b6','#fb7185','#fda4af','#38bdf8','#7dd3fc','#22c55e','#a78bfa'];
  let scope = (title && !isVac) ? 'one' : 'all';
  const _curBg=function(){ const m=_obj('ec_academic_colors'); const g=localStorage.getItem('ec_academic_color')||'#a855f7'; return String((scope==='one'&&title)?(m[title]||g):g).toLowerCase(); };
  const _curFg=function(){ const m=_obj('ec_academic_text_colors'); const g=localStorage.getItem('ec_academic_text_color')||'#ffffff'; return String((scope==='one'&&title)?(m[title]||g):g).toLowerCase(); };
  const _curVac=function(s){ const v=Object.assign({summer:'#ec4899',winter:'#38bdf8'},_obj('ec_vacation_colors')); return String(v[s]||'').toLowerCase(); };
  const _live=function(){ try{ renderHomeDashboard(); }catch(_){} _render(); };
  const _applyBar=function(kind,color){
    if(scope==='one'&&title){ const k=kind==='bg'?'ec_academic_colors':'ec_academic_text_colors'; const m=_obj(k); m[title]=color; try{localStorage.setItem(k,JSON.stringify(m));}catch(_){} }
    else { if(kind==='bg'){ try{localStorage.setItem('ec_academic_color',color);localStorage.removeItem('ec_academic_colors');}catch(_){} } else { try{localStorage.setItem('ec_academic_text_color',color);localStorage.removeItem('ec_academic_text_colors');}catch(_){} } }
    _live();
  };
  const _applyVac=function(season,color){ const v=Object.assign({summer:'#ec4899',winter:'#38bdf8'},_obj('ec_vacation_colors')); v[season]=color; try{localStorage.setItem('ec_vacation_colors',JSON.stringify(v));}catch(_){} _live(); };
  const _curVacText=function(s){ const v=Object.assign({summer:'#db2777',winter:'#0284c7'},_obj('ec_vacation_text_colors')); return String(v[s]||'').toLowerCase(); };
  const _applyVacText=function(season,color){ const v=Object.assign({summer:'#db2777',winter:'#0284c7'},_obj('ec_vacation_text_colors')); v[season]=color; try{localStorage.setItem('ec_vacation_text_colors',JSON.stringify(v));}catch(_){} _live(); };
  const _sw=function(attr,val,cur){ return '<div data-'+attr+'="'+val+'" title="'+val+'" style="width:22px;height:22px;border-radius:6px;background:'+val+';cursor:pointer;border:2px solid '+(val.toLowerCase()===cur?'var(--t1)':'rgba(127,127,127,0.25)')+';box-shadow:0 1px 3px rgba(0,0,0,0.2)"></div>'; };
  const pop=document.createElement('div');
  pop.id='acadColorPop';
  pop.style.cssText='position:fixed;z-index:13060;background:var(--card);border:1px solid var(--bdr);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.3);padding:11px 13px;width:250px;font-family:var(--f)';
  function _render(){
    let inner='';
    if(title && !isVac){
      const _sBtn=function(v,l){ const on=(scope===v); return '<button data-acad-scope="'+v+'" style="flex:1;font-size:10.5px;font-weight:700;padding:5px;border-radius:6px;cursor:pointer;font-family:var(--f);border:1px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.12)':'transparent')+';color:'+(on?'var(--cyan)':'var(--t2)')+'">'+l+'</button>'; };
      inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:6px">학사일정 색상 — <b style="color:var(--t2)">'+escHtml(title)+'</b></div>';
      inner+='<div style="display:flex;gap:6px;margin-bottom:9px">'+_sBtn('one','이 일정만')+_sBtn('all','전체 일괄')+'</div>';
      const cb=_curBg(); inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px">막대 색</div><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-bottom:9px">'+bgPresets.map(function(c){return _sw('acad-bg',c,cb);}).join('')+'</div>';
      const cf=_curFg(); inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px">글씨 색</div><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-bottom:9px">'+fgPresets.map(function(c){return _sw('acad-fg',c,cf);}).join('')+'</div>';
    }
    /* 방학 색 조정은 방학 칸에서 연 팝업에서만 — 개별 학사일정 팝업에는 넣지 않음 (사용자 요청 2026-06-17) */
    if(isVac){
      inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px">🏖 여름방학 칸 색</div><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-bottom:8px">'+vacPresets.map(function(c){return _sw('acad-vsummer',c,_curVac('summer'));}).join('')+'</div>';
      inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px">🏖 여름방학 글자 색</div><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-bottom:9px">'+fgPresets.map(function(c){return _sw('acad-vsummer-fg',c,_curVacText('summer'));}).join('')+'</div>';
      inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px">❄️ 겨울방학 칸 색</div><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-bottom:8px">'+vacPresets.map(function(c){return _sw('acad-vwinter',c,_curVac('winter'));}).join('')+'</div>';
      inner+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px">❄️ 겨울방학 글자 색</div><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px">'+fgPresets.map(function(c){return _sw('acad-vwinter-fg',c,_curVacText('winter'));}).join('')+'</div>';
    }
    pop.innerHTML=inner;
  }
  _render();
  document.body.appendChild(pop);
  /* 위치 — 막대/라벨 아래, 화면 밖으로 안 나가게 */
  const r=anchorEl.getBoundingClientRect(); const pw=pop.offsetWidth||250, ph=pop.offsetHeight||180;
  pop.style.left=Math.max(8,Math.min(r.left, window.innerWidth-pw-8))+'px';
  pop.style.top=((r.bottom+ph+8>window.innerHeight)?Math.max(8,r.top-ph-6):(r.bottom+6))+'px';
  pop.addEventListener('click',function(ev){
    const sb=ev.target.closest('[data-acad-scope]'); if(sb){ scope=sb.getAttribute('data-acad-scope'); _render(); return; }
    let el;
    if((el=ev.target.closest('[data-acad-bg]'))){ _applyBar('bg',el.getAttribute('data-acad-bg')); return; }
    if((el=ev.target.closest('[data-acad-fg]'))){ _applyBar('fg',el.getAttribute('data-acad-fg')); return; }
    if((el=ev.target.closest('[data-acad-vsummer-fg]'))){ _applyVacText('summer',el.getAttribute('data-acad-vsummer-fg')); return; }
    if((el=ev.target.closest('[data-acad-vwinter-fg]'))){ _applyVacText('winter',el.getAttribute('data-acad-vwinter-fg')); return; }
    if((el=ev.target.closest('[data-acad-vsummer]'))){ _applyVac('summer',el.getAttribute('data-acad-vsummer')); return; }
    if((el=ev.target.closest('[data-acad-vwinter]'))){ _applyVac('winter',el.getAttribute('data-acad-vwinter')); return; }
  });
  setTimeout(function(){
    const off=function(ev){ if(!pop.contains(ev.target)){ pop.remove(); document.removeEventListener('mousedown',off,true); } };
    document.addEventListener('mousedown',off,true);
  },0);
}

/* 공휴일·학사일정 동의어 정규화 — 같은 날 같은 뜻인데 명칭만 다른 항목을 한 가지로 묶어 달력 중복 표기 방지.
 *  (석가탄신일=부처님오신날, 삼일절=3·1절, 신정=새해, 성탄절=기독탄신일=크리스마스 등) (사용자 요청 2026-06-17) */
function _holiNorm(s){
  let t=String(s||'').replace(/\s/g,'');
  if(/석가탄신|부처님오신날|초파일/.test(t))return '부처님오신날';
  if(/삼일절|3[.·,]?1절|3·1절/.test(t))return '삼일절';
  if(/기독탄신|성탄절|크리스마스|예수탄신/.test(t))return '성탄절';
  if(/신정|새해|양력설|^1월1일$|^1[.]1$/.test(t))return '신정';
  if(/추석/.test(t))return '추석';
  if(/설날|음력설|구정/.test(t))return '설날';
  if(/현충일/.test(t))return '현충일';
  if(/광복절/.test(t))return '광복절';
  if(/개천절/.test(t))return '개천절';
  if(/한글날/.test(t))return '한글날';
  if(/어린이날/.test(t))return '어린이날';
  return t;
}

function _buildMiniCalendar(){
  const now=new Date();
  if(_homeCalYear===null){_homeCalYear=now.getFullYear();_homeCalMonth=now.getMonth();}
  const yr=_homeCalYear, mo=_homeCalMonth;
  const todayStr=_todayStr();
  const first=new Date(yr,mo,1);
  const dow=first.getDay();
  const dim=new Date(yr,mo+1,0).getDate();
  /* Google Calendar 연동이 켜진 경우에만 비동기 fetch */
  const gcalOn=_gcalEnabled();
  if(gcalOn)setTimeout(_homeCalLoadAsync,50);
  else { _homeCalEvents={}; _homeCalLoaded=false; _homeCalCount={calendars:0,total:0}; }
  /* 로컬 이벤트 첫 로드 (호스트 DB) */
  if(!_todoCalendarReady&&!_todoCalendarError){_loadLocalEvents().then(function(){renderHomeDashboard();if(_todoCalendarReady){_checkTodayEventsAlert();_startTodayEventAlarmsWatcher();}});}
  /* 학사일정(나이스 SchoolSchedule) — 보이는 달만 lazy 로드. 실제 fetch 완료 시에만 1회 재렌더(무한루프 가드).
     셀 렌더에서 연속 바(span)로 표시 — 여름방학 등 다일 이벤트는 이어진 막대로. */
  if(!academicMonthBusy(yr,mo)) loadAcademicMonth(yr,mo,function(){ renderHomeDashboard(); });
  const _acadSpans=getAcademicSpans();
  _refreshHomeCalendarDayPopup();

  // Keep the date grid at the requested height for four-, five- and six-week months.
  const gridHeight = 280;
  const weekRows=Math.ceil((dow+dim)/7);


  let h='<div class="cc" id="homeCalWrap" style="padding:10px 14px;margin-bottom:0;overflow:visible;background:var(--card);border:1px solid var(--bdr);border-radius:12px">';
  /* 헤더 — 매직스테이션과 동일 구조 + Google 연동 토글 */
  h+='<div class="school-calendar-toolbar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">';
  h+='<span style="font-size:13px;font-weight:700;color:var(--t1)">📆 캘린더</span>';
  let gcalLabel;
  if(!gcalOn){
    gcalLabel='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#9ca3af;margin-right:4px;vertical-align:middle"></span><span style="color:var(--t3)">Google 연동 꺼짐 (기본 달력만 표시)</span>';
  } else if(_homeCalLoaded){
    gcalLabel='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:4px;vertical-align:middle"></span><span style="color:#22c55e">Google 연결됨</span> · '+_homeCalCount.calendars+'개 · 이번 달 '+_homeCalCount.total+'건';
  } else {
    gcalLabel='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fbbf24;margin-right:4px;vertical-align:middle"></span><span style="color:#fbbf24">로딩 중...</span>';
  }
  h+='<span style="font-size:11px;color:var(--t3)">'+gcalLabel+'</span>';
  /* Google 캘린더 연동 ON/OFF 토글 — 설문(survey) 의 sv-toggle 과 100% 동일 GUI.
   * ON  → 구글 캘린더 연동 (이벤트 가져오기)
   * OFF → 개인 사용 (오렌지톡 내 로컬 캘린더만, 구글 호출 0) */
  h+='<div style="display:flex;align-items:center;gap:6px" data-tooltip="업무와 일상을 구분하고 싶은 경우에는 OFF,<br>모든 것을 Google과 연동하고 싶으면 ON 해주세요." data-tooltip-html="1" data-tooltip-instant="1">'
    +'<span style="font-size:10px;font-weight:700;color:var(--t2)">Google 연동</span>'
    +'<div class="sv-toggle'+(gcalOn?' on':'')+'" data-action="'+(gcalOn?'home-gcal-off':'home-gcal-on')+'"></div>'
    +'</div>';
  if(gcalOn){
    h+='<button data-action="home-cal-refresh" style="border:none;background:transparent;cursor:pointer;font-size:12px;color:var(--cyan);padding:2px 6px" title="새로고침">🔄</button>';
    h+='<button data-action="gcal-share" style="border:none;background:transparent;cursor:pointer;font-size:12px;color:var(--cyan);padding:2px 6px" title="공유 관리 — 누구와 공유되는지 보고 공유 대상·권한을 설정">🔗</button>';
  }
  h+='<div style="flex:1"></div>';
  /* 진행률 4종은 1열 최상단 위젯(progress)으로 이동 (사용자 요청 2026-05-28) — 캘린더 헤더에는 '오늘' 버튼만 유지. */
  h+='</div>';
  /* 월 이동 — 사이드/통계 달력과 동일한 연·월 호버 팝업 추가 (mcal-* 클래스 재사용).
     ※ 이 미니 캘린더는 기존엔 mcal-* 가 아니라 자체 그리드라, mcal-title/year/month 클래스만
        타이틀 영역에 부여해서 글로벌 CSS 의 hover 팝업 규칙(:hover .mcal-popup) 을 그대로 받음. */
  const MONTH_NAMES=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let _yPopHC='<div class="mcal-popup">';
  { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++) _yPopHC+='<div class="mcal-popup-item'+(y===yr?' active':'')+'" data-action="home-cal-set-year" data-arg="'+y+'">'+y+'</div>'; }
  _yPopHC+='</div>';
  let _mPopHC='<div class="mcal-popup" style="min-width:140px;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++) _mPopHC+='<div class="mcal-popup-item'+(m===mo?' active':'')+'" data-action="home-cal-set-month" data-arg="'+m+'" style="width:45px">'+MONTH_NAMES[m]+'</div>';
  _mPopHC+='</div>';
  h+='<div class="school-calendar-month" style="display:flex;justify-content:center;align-items:center;gap:16px;margin-bottom:10px">';
  h+='<button data-action="home-cal-prev" style="border:1px solid var(--bdr);background:var(--bg2);cursor:pointer;font-size:14px;color:var(--t2);padding:4px 10px;border-radius:6px">◀</button>';
  h+='<div class="mcal-title" style="font-size:16px;font-weight:800;color:var(--t1);min-width:120px;justify-content:center;gap:6px"><span class="mcal-year">'+yr+'년'+_yPopHC+'</span><span class="mcal-month">'+(mo+1)+'월'+_mPopHC+'</span></div>';
  h+='<button data-action="home-cal-next" style="border:1px solid var(--bdr);background:var(--bg2);cursor:pointer;font-size:14px;color:var(--t2);padding:4px 10px;border-radius:6px">▶</button>';
  h+='<button class="school-calendar-today btn btn-primary btn-sm" data-action="home-cal-today" style="font-size:10px;padding:3px 10px">오늘</button>';
  h+='</div>';
  /* === 매직스테이션 _gp2UpdateCalendar 그대로 === */
  /* 한국 공휴일 — 표시 연도가 캐시에 없으면 lazy fetch (가드 내장) */
  ensureHolidayYear(String(yr));
  const holidays={};
  if(S.koreanHolidays){
    Object.keys(S.koreanHolidays).forEach(function(k){if(k.startsWith(String(yr)))holidays[k]=S.koreanHolidays[k];});
  }
  /* 요일 헤더 */
  h+='<div class="school-calendar-weekdays" style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--t3);margin-bottom:2px">';
  ['일','월','화','수','목','금','토'].forEach(function(dn,i){
    h+='<span style="padding:3px;color:'+(i===0?'var(--rs,#dc2626)':i===6?'#3b82f6':'var(--t3)')+'">'+dn+'</span>';
  });
  h+='</div>';

  /* Each week owns one uninterrupted rule; blanks and dates share its columns. */
  h+='<div id="homeCalGrid" class="school-calendar-count-grid" style="position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:repeat('+weekRows+',minmax(0,1fr));height:'+gridHeight+'px;box-sizing:border-box;gap:0;border:1px solid var(--bdr);border-radius:6px;overflow:hidden">';
  for(let week=0;week<weekRows;week++){
    h+='<div class="school-calendar-week">';
    for(let column=0;column<7;column++){
      const dd=week*7+column-dow+1;
      if(dd<1||dd>dim){
        h+='<div class="school-calendar-empty" aria-hidden="true"></div>';
        continue;
      }
      const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
      const isT=ds===todayStr, isH=!!holidays[ds];
      const count=_homeCalendarDayItems(ds,_acadSpans).length;
      const label=ds+(isH?' \u00b7 '+holidays[ds]:'')+' \u00b7 \uc77c\uc815 '+count+'\uac74';
      h+='<button type="button" class="school-calendar-day'+(isT?' is-today':'')+(column===0?' is-sunday':column===6?' is-saturday':'')+(isH?' is-holiday':'')+'" data-action="home-cal-day" data-arg="'+ds+'" aria-haspopup="dialog" aria-label="'+escHtml(label)+'" title="'+escHtml(label)+'"'+(isT?' aria-current="date"':'')+' style="overflow:hidden;background:var(--school-calendar-day-bg,var(--card))">';
      h+='<span class="school-calendar-date" style="display:flex;align-items:center;gap:4px;min-width:0;max-width:100%">'
        +(isT?'<span class="school-calendar-today-number" style="flex-shrink:0">'+dd+'</span>':'<span style="flex-shrink:0">'+dd+'</span>')
        +(isH?'<span class="school-calendar-holiday-name" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:700;line-height:1.4;color:var(--rs,#dc2626)">'+escHtml(holidays[ds])+'</span>':'')+'</span>';
      if(count) h+='<span class="school-calendar-count">'+count+'<span>\uac74</span></span>';
      h+='</button>';
    }
    h+='</div>';
  }
  h+='</div><p class="school-calendar-count-hint">\ub0a0\uc9dc\ub97c \uc120\ud0dd\ud558\uba74 \uc804\uccb4 \uc77c\uc815\uc744 \ubcf4\uace0 \ucd94\uac00\ud560 \uc218 \uc788\uc5b4\uc694.</p></div>';
  return h;
}

/* Google Calendar 이벤트 비동기 로딩 — 매직스테이션과 동일 IPC */
async function _homeCalLoadAsync(){
  if(!(window.electronAPI&&window.electronAPI.plannerFetchMonthEvents))return;
  const yr=_homeCalYear, mo=_homeCalMonth;
  /* 해당 월 중간 날짜로 요청 (백엔드가 해당 월 전체 이벤트 반환) */
  const midDate=yr+'-'+String(mo+1).padStart(2,'0')+'-15';
  try{
    const res=await window.electronAPI.plannerFetchMonthEvents(midDate);
    if(res&&res.success&&res.data){
      _homeCalEvents=res.data.eventsByDate||{};
      const calendars=res.data.calendars||[];
      let total=0;
      Object.keys(_homeCalEvents).forEach(function(k){total+=_homeCalEvents[k].length;});
      _homeCalCount={calendars:calendars.length,total:total};
      const wasLoaded=_homeCalLoaded;
      _homeCalLoaded=true;
      if(!wasLoaded||JSON.stringify(_homeCalEvents)!==_homeCalPrevSnapshot){
        _homeCalPrevSnapshot=JSON.stringify(_homeCalEvents);
        renderHomeDashboard();
      }
    }
  }catch(e){
    _homeCalLoaded=false;
  }
}
let _homeCalPrevSnapshot='';

/* ── 기간 일정(기말고사 등) 입력/편집 모달 — 드래그 선택 또는 라벨 클릭으로 진입. (2026-06-22)
 *  existing: 편집 대상 range 객체(없으면 신규). lo/hi: 시작·종료일 'YYYY-MM-DD'. ── */
function _openRangeEditor(existing, lo, hi){
  const ex=document.getElementById('homeRangePopup'); if(ex)ex.remove();
  const isEdit=!!existing;
  const cur=existing||{title:'',color:'#f59e0b',start:lo,end:hi};
  const sVal=cur.start||lo, eVal=cur.end||hi;
  const palette=['#f59e0b','#ef4444','#ec4899','#a855f7','#6366f1','#3b82f6','#06b6d4','#10b981','#22c55e','#84cc16','#64748b','#0ea5e9'];
  const ov=document.createElement('div');
  ov.id='homeRangePopup';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9710;display:flex;align-items:center;justify-content:center';
  const inp='font-size:12px;padding:7px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--f)';
  let h='<div style="background:var(--card);border-radius:12px;width:380px;max-width:92vw;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4)">';
  h+='<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:14px;font-weight:800;color:var(--t1)">🗓️ '+(isEdit?'기간 일정 편집':'기간 일정 추가')+'</span>';
  h+='<span style="font-size:10px;color:var(--t3);margin-left:auto">'+(isEdit?'수정 후 저장':'시작일~종료일 일정')+'</span>';
  h+='</div>';
  h+='<div style="padding:16px 18px;display:flex;flex-direction:column;gap:11px">';
  h+='<label style="display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--t3)">제목<input id="hrTitle" type="text" placeholder="예: 기말고사" value="'+escHtml(cur.title||'')+'" style="'+inp+'"></label>';
  h+='<div style="display:flex;gap:10px">';
  h+='<label style="flex:1;display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--t3)">시작일<input id="hrStart" type="date" value="'+escHtml(sVal)+'" style="'+inp+'"></label>';
  h+='<label style="flex:1;display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--t3)">종료일<input id="hrEnd" type="date" value="'+escHtml(eVal)+'" style="'+inp+'"></label>';
  h+='</div>';
  h+='<div style="font-size:10px;color:var(--t3)">색상</div>';
  h+='<div id="hrPalette" style="display:grid;grid-template-columns:repeat(6,1fr);gap:7px">';
  palette.forEach(function(c){ h+='<div data-hr-c="'+c+'" style="height:26px;border-radius:6px;background:'+c+';cursor:pointer;border:2px solid '+(c.toLowerCase()===String(cur.color).toLowerCase()?'var(--t1)':'transparent')+'"></div>'; });
  h+='</div>';
  h+='<div style="display:flex;gap:8px;margin-top:4px">';
  if(isEdit)h+='<button id="hrDelete" style="padding:8px 14px;font-size:12px;font-weight:700;border:1px solid #ef4444;border-radius:7px;background:rgba(239,68,68,0.06);color:#ef4444;cursor:pointer;font-family:var(--f)">삭제</button>';
  h+='<div style="flex:1"></div>';
  h+='<button id="hrCancel" style="padding:8px 14px;font-size:12px;border:1px solid var(--bdr);border-radius:7px;background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">취소</button>';
  h+='<button id="hrSave" style="padding:8px 18px;font-size:12px;font-weight:700;border:none;border-radius:7px;background:var(--cyan);color:#fff;cursor:pointer;font-family:var(--f)">저장</button>';
  h+='</div></div></div>';
  ov.innerHTML=h;
  document.body.appendChild(ov);
  let pickColor=cur.color||'#f59e0b';
  const pal=ov.querySelector('#hrPalette');
  pal.addEventListener('click',function(e){ const sw=e.target.closest('[data-hr-c]'); if(!sw)return; pickColor=sw.getAttribute('data-hr-c'); pal.querySelectorAll('[data-hr-c]').forEach(function(x){x.style.border='2px solid '+(x.getAttribute('data-hr-c')===pickColor?'var(--t1)':'transparent');}); });
  const close=function(){ if(ov.parentNode)ov.remove(); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  ov.querySelector('#hrCancel').addEventListener('click',close);
  const delBtn=ov.querySelector('#hrDelete');
  if(delBtn)delBtn.addEventListener('click',async function(){
    _localRanges=_localRanges.filter(function(x){return x.id!==existing.id;});
    await _saveLocalRanges(); _homeSaveToast(); close(); try{renderHomeDashboard();}catch(_){}
  });
  ov.querySelector('#hrSave').addEventListener('click',async function(){
    const title=(ov.querySelector('#hrTitle').value||'').trim();
    let s=ov.querySelector('#hrStart').value||sVal;
    let en=ov.querySelector('#hrEnd').value||eVal;
    if(!title){ ov.querySelector('#hrTitle').focus(); ov.querySelector('#hrTitle').style.borderColor='#ef4444'; return; }
    if(s>en){ const t=s; s=en; en=t; }   /* 시작>종료면 자동 교환 */
    if(isEdit){ existing.title=title; existing.start=s; existing.end=en; existing.color=pickColor; }
    else { _localRanges.push({id:String(Date.now())+Math.random().toString(36).slice(2,6),title:title,start:s,end:en,color:pickColor}); }
    await _saveLocalRanges(); _homeSaveToast(); close(); try{renderHomeDashboard();}catch(_){}
  });
  setTimeout(function(){ const t=ov.querySelector('#hrTitle'); if(t)t.focus(); },30);
}

/* ── 날짜 클릭 → 일정 추가/편집 팝업 (호스트 DB 공유) ── */
/* 날짜 팝업의 일정 목록(오렌지톡 + Google) HTML — 입력 즉시 부분 갱신용 (2026-07-02) */
function _homeCalendarDayItems(ds, academicSpans){
  const items=[], local=_localEvents[ds]||[];
  function add(kind,ev,index){
    const timed=kind==='local'||kind==='google';
    const event=timed?Object.assign({},ev,{_local:kind==='local'}):ev;
    items.push({kind:kind,event:event,index:index,order:items.length,
      title:timed?_homeEvTitle(event):(ev.title||'(제목 없음)'),
      time:kind==='local'?(ev.time||''):kind==='google'?_evTimeStatic(ev):''});
  }
  local.forEach(function(ev,i){if(ev)add('local',ev,i);});
  if(_gcalEnabled()) (_homeCalEvents[ds]||[]).forEach(function(ev){
    if(!ev)return;
    const duplicate=local.some(function(own){return own&&((own.gid&&own.gid===ev.id)||(own.gcalMap&&Object.keys(own.gcalMap).some(function(key){return own.gcalMap[key]===ev.id;})));});
    if(!duplicate)add('google',ev);
  });
  (academicSpans||getAcademicSpans()).forEach(function(ev){
    if(!ev||!ev.start||!ev.end||ds<ev.start||ds>ev.end)return;
    if(/선거|투표일/.test(String(ev.title||'')))return;
    if(ev.start===ev.end){
      const holiday=S.koreanHolidays&&S.koreanHolidays[ev.start];
      const a=String(holiday||'').replace(/\s/g,''),b=String(ev.title||'').replace(/\s/g,'');
      if(a&&b&&(a===b||a.indexOf(b)!==-1||b.indexOf(a)!==-1||_holiNorm(a)===_holiNorm(b)))return;
    }
    add('academic',ev);
  });
  _localRanges.forEach(function(ev){if(ev&&ev.start&&ev.end&&ds>=ev.start&&ds<=ev.end)add('range',ev);});
  return items.sort(function(a,b){
    const at=String(a.time||'').padStart(5,'0'),bt=String(b.time||'').padStart(5,'0');
    return at.localeCompare(bt)||a.order-b.order;
  });
}
function _refreshHomeCalendarDayPopup(){
  const popup=document.getElementById('homeCalDayPopup');
  if(!popup||!popup.dataset.date)return;
  const list=popup.querySelector('#hcdListWrap');
  if(list)list.innerHTML=_hcdListHtml(popup.dataset.date);
}
function _hcdListHtml(ds){
  const items=_homeCalendarDayItems(ds);
  const names={local:'오렌지톡',google:'Google',academic:'학사 일정',range:'기간 일정'};
  const defaults={local:'#22c55e',google:'#3b82f6',academic:'#a855f7',range:'#f59e0b'};
  let h='<div class="school-hcd-list-heading"><h3>전체 일정</h3><span>'+items.length+'건</span></div>';
  if(_gcalEnabled()&&!_homeCalLoaded)h+='<p class="school-hcd-loading" role="status">Google 일정을 불러오는 중이에요.</p>';
  if(!items.length)return h+'<div class="school-hcd-empty"><strong>등록된 일정이 없어요</strong><p>입력란에서 이 날짜의 일정이나 할 일을 추가해 보세요.</p></div>';
  h+='<ul class="school-hcd-events">';
  items.forEach(function(item){
    const ev=item.event, timed=item.kind==='local'||item.kind==='google';
    const done=timed&&_homeEventDone(ds,ev);
    const rawColor=ev._calColor||ev.backgroundColor||ev.color||defaults[item.kind];
    const color=/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawColor)?rawColor:defaults[item.kind];
    h+='<li class="school-hcd-event'+(done?' is-complete':'')+'" data-kind="'+item.kind+'" style="--hcd-event-accent:'+color+'">';
    h+='<div class="school-hcd-event-top"><span class="school-hcd-time">'+escHtml(item.time||'종일')+'</span><span class="school-hcd-source">'+names[item.kind]+'</span>'+(done?'<span class="school-hcd-done-label">완료</span>':'')+'</div>';
    h+='<div class="school-hcd-event-main">';
    if(timed)h+=_homeCalendarDoneControl(ds,ev);
    h+='<div class="school-hcd-event-copy"><div class="school-hcd-event-title">'+escHtml(item.title)+'</div>';
    if(ev.memo)h+='<p class="school-hcd-event-memo">'+escHtml(ev.memo)+'</p>';
    if(!timed)h+='<p class="school-hcd-event-period">'+escHtml(ev.start)+' ~ '+escHtml(ev.end)+'</p>';
    h+='</div></div>';
    if(timed){
      const google=item.kind==='google';
      const attrs=' data-arg="'+escHtml(ds)+'"'+(google?' data-gid="'+escHtml(ev.id||'')+'"':' data-idx="'+item.index+'"');
      h+='<div class="school-hcd-event-actions"><button type="button" data-action="'+(google?'hcd-gedit':'hcd-edit')+'"'+attrs+' aria-label="'+escHtml(item.title)+' 수정">수정</button><button type="button" class="is-delete" data-action="'+(google?'hcd-gdel':'hcd-del')+'"'+attrs+' aria-label="'+escHtml(item.title)+' 삭제">삭제</button></div>';
    }else if(item.kind==='range'&&ev.id){
      h+='<div class="school-hcd-event-actions"><button type="button" data-action="hcd-range-edit" data-range-id="'+escHtml(ev.id)+'">기간 일정 수정</button></div>';
    }
    h+='</li>';
  });
  return h+'</ul>';
}
let _homeDayPopupRequest=0;
async function _homeOpenDayPopup(ds,focusNew=false){
  const request=++_homeDayPopupRequest;
  const ex=document.getElementById('homeCalDayPopup');
  if(ex && ex._homeCloseDraft && !await ex._homeCloseDraft())return;
  if(request!==_homeDayPopupRequest)return;
  /* 로컬 일정 로드가 끝나기 전에 팝업에서 저장하면, 빈 _localEvents 를 DB 에 통째로 덮어써
   *  이전 날짜 일정이 유실될 수 있다 → 팝업을 열기(편집 가능해지기) 전에 로드를 보장한다. (2026-07-15) */
  if(!await _requireHomeCalendar() || request!==_homeDayPopupRequest)return;
  const events=_localEvents[ds]||[];
  /* 오렌지톡 일정이 구글에 올린 이벤트는 'Google Calendar' 섹션에서 제외 → '오렌지톡 일정' 섹션에만 표시 (중복 방지, 2026-07-02) */
  const gcalEvents=(_homeCalEvents[ds]||[]).filter(function(gev){ return !(_localEvents[ds]||[]).some(function(lev){ return (lev.gid&&lev.gid===gev.id) || (lev.gcalMap && Object.keys(lev.gcalMap).some(function(k){return lev.gcalMap[k]===gev.id;})); }); });
  const ov=document.createElement('div');
  ov.id='homeCalDayPopup';
  ov.dataset.date=ds;
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9700;display:flex;align-items:center;justify-content:center';
  const dateLabel=new Date(ds+'T12:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  const holiday=S.koreanHolidays&&S.koreanHolidays[ds];
  let h='<div class="school-calendar-day-dialog" role="dialog" aria-modal="true" aria-labelledby="hcdDialogTitle" tabindex="-1">';
  h+='<header class="school-calendar-day-header"><div><p>선택한 날짜</p><h2 id="hcdDialogTitle">'+escHtml(dateLabel)+'</h2>'+(holiday?'<span class="school-hcd-holiday">'+escHtml(holiday)+'</span>':'')+'</div><button type="button" class="school-hcd-input-link" data-action="hcd-focus-new">일정 입력</button></header>';
  h+='<div class="school-calendar-day-body"><section class="school-calendar-day-list" aria-label="선택한 날짜의 일정 목록"><div id="hcdListWrap">'+_hcdListHtml(ds)+'</div></section>';
  h+='<section class="school-calendar-day-form" aria-labelledby="hcdAddHeading"><div class="school-hcd-form-heading"><h3 id="hcdAddHeading">새 일정·할 일</h3><span>자동 저장</span></div>';
  h+='<p class="school-hcd-form-note">제목을 입력하면 자동 저장됩니다. Enter를 누르면 다음 일정을 입력할 수 있어요.</p>';
  h+='<label for="hcdTitle">일정 제목 <span>필수</span></label><input id="hcdTitle" type="text" placeholder="어떤 일정이 있나요?" autocomplete="off">';
  h+='<label for="hcdTime">시간 <span>선택</span></label><input id="hcdTime" type="text" placeholder="HH:MM · 비워 두면 종일" maxlength="5" autocomplete="off">';
  h+='<label for="hcdMemo">메모 <span>선택</span></label><textarea id="hcdMemo" placeholder="장소나 준비할 내용을 적어 주세요." rows="3"></textarea>';
  h+='<div class="school-hcd-color-label">일정 색상</div><div id="hcdColorRow" role="group" aria-label="일정 색상">';
  const _palette=[{c:'#22c55e',n:'녹색'},{c:'#0891b2',n:'사이안'},{c:'#3b82f6',n:'파랑'},{c:'#7c3aed',n:'보라'},{c:'#ec4899',n:'분홍'},{c:'#dc2626',n:'빨강'},{c:'#f97316',n:'주황'},{c:'#ca8a04',n:'노랑'}];
  _palette.forEach(function(p,i){h+='<button type="button" class="hcd-color-chip'+(i===0?' selected':'')+'" data-color="'+p.c+'" title="'+p.n+'" aria-label="'+p.n+'" aria-pressed="'+(i===0?'true':'false')+'" style="background:'+p.c+'" data-action="hcd-color-pick"></button>';});
  h+='</div><p class="school-hcd-sync-note">'+(_gcalEnabled()?'오렌지톡 일정은 Google 캘린더에도 동기화됩니다.':'Google 연동을 켜면 오렌지톡 일정을 함께 동기화할 수 있어요.')+'</p></section></div>';
  h+='<footer class="school-calendar-day-footer"><span>학사·기간 일정도 이 날짜에 해당하는 항목을 모두 보여드려요.</span><button type="button" data-action="hcd-close">닫기</button></footer></div>';
  ov.innerHTML=h;
  ov.addEventListener('mousedown',function(e){if(e.target===ov)ov._homeCloseDraft();});
  ov.addEventListener('click',function(e){
    const t=e.target.closest('[data-action]');if(!t)return;
    const a=t.dataset.action;
    if(a==='hcd-close'){ov._homeCloseDraft();return;}
    if(a==='hcd-focus-new'){const input=ov.querySelector('#hcdTitle');if(input)input.focus();return;}
    if(a==='hcd-range-edit'){const range=_localRanges.find(function(item){return item&&String(item.id)===t.dataset.rangeId;});if(range)_openRangeEditor(range,range.start,range.end);return;}
    if(a==='hcd-done'){_homeToggleCalEvent(t.dataset.key,t.dataset.arg);return;}
    if(a==='hcd-edit'){_homeEditLocalEvent(t.dataset.arg,parseInt(t.dataset.idx,10),ov);return;}
    if(a==='hcd-del'){_homeDelLocalEvent(t.dataset.arg,parseInt(t.dataset.idx,10),ov);return;}
    if(a==='hcd-gedit'){_homeEditGcalEvent(t.dataset.arg,t.dataset.gid,ov);return;}
    if(a==='hcd-gdel'){_homeDelGcalEvent(t.dataset.arg,t.dataset.gid,ov);return;}
    if(a==='hcd-color-pick'){
      ov.querySelectorAll('.hcd-color-chip').forEach(function(c){c.classList.remove('selected');c.setAttribute('aria-pressed','false');c.style.border='2px solid transparent';});
      t.classList.add('selected');
      t.setAttribute('aria-pressed','true');
      t.style.border='2px solid var(--t1)';
      _homeDayDraftSave(ds,ov);   /* 색상 선택 즉시 반영·저장 */
      return;
    }
  });
  document.body.appendChild(ov);
  /* 자동 저장 — 제목/시간/메모 타이핑 시 디바운스로 그날 일정 1건을 생성·갱신(추가 버튼 없이 즉시 달력 표시+저장). 닫았다 다시 열면 새 일정. (사용자 지시 2026-06-15) */
  ov._homeDraftId=null;
  let _dayDraftTimer=null;
  ov._homeFlushDraft=function(){
    clearTimeout(_dayDraftTimer);_dayDraftTimer=null;
    return _homeDayDraftSave(ds,ov);
  };
  ov._homeCloseDraft=function(){
    if(ov._homeClosing)return ov._homeClosing;
    const controls=Array.from(ov.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)'));
    controls.forEach(function(el){el.disabled=true;});
    ov.setAttribute('aria-busy','true');
    ov._homeClosing=(async function(){
      try{
        if(!await ov._homeFlushDraft())return false;
        ov.remove();return true;
      }finally{
        controls.forEach(function(el){el.disabled=false;});
        ov.removeAttribute('aria-busy');ov._homeClosing=null;
      }
    })();
    return ov._homeClosing;
  };
  ov._onModalClose=ov._homeCloseDraft;
  ['hcdTitle','hcdTime','hcdMemo'].forEach(function(id){
    const el=ov.querySelector('#'+id);if(!el)return;
    el.addEventListener('input',function(){ if(_dayDraftTimer)clearTimeout(_dayDraftTimer); _dayDraftTimer=setTimeout(function(){_homeDayDraftSave(ds,ov);},400); });
    /* Enter → 즉시 저장하고 팝업 닫기 (사용자 요청 2026-07-02) */
    el.addEventListener('keydown',function(e){ if(e.key==='Enter' && id!=='hcdMemo'){ e.preventDefault(); _homeOpenDayPopup(ds,true); } });
  });
  _bindTimeInput(ov.querySelector('#hcdTime'));
  setTimeout(function(){if(!ov.isConnected)return;const target=ov.querySelector(focusNew?'#hcdTitle':'.school-calendar-day-dialog');if(target)target.focus({preventScroll:!focusNew});},50);
}
/* 구글 일정 description 의 HTML(<br>·<a> 등)을 사람이 읽는 플레인 텍스트로 변환 — 구글은 렌더링하지만 앱 입력란엔 태그가 그대로 보이므로. (사용자 요청 2026-07-02) */
function _gcalHtmlToText(html){
  if(!html) return '';
  let s=String(html);
  s=s.replace(/<br\s*\/?>/gi,'\n');
  s=s.replace(/<\/(p|div|li)>/gi,'\n');
  s=s.replace(/<a\b[^>]*href=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/a>/gi,function(m,url,txt){ txt=(txt||'').replace(/<[^>]+>/g,'').trim(); return txt||url; });
  s=s.replace(/<[^>]+>/g,'');
  const _ta=document.createElement('textarea'); _ta.innerHTML=s; s=_ta.value;
  return s.replace(/\n{3,}/g,'\n\n').trim();
}
/* 시간 입력 자동 포맷 — 숫자 2자리를 넘어가면 HH:MM 형태로 ':' 자동 삽입 (사용자 요청 2026-07-02) */
function _bindTimeInput(el){
  if(!el) return;
  el.addEventListener('input',function(){
    let v=el.value.replace(/[^0-9]/g,'').slice(0,4);
    if(v.length>2) v=v.slice(0,2)+':'+v.slice(2);
    el.value=v;
  });
}
/* 날짜(YYYY-MM-DD) → "2026-07-02 목요일" 표기 (2026-07-02) */
function _homeDsLabel(ds){ try{ const d=new Date(ds+'T00:00:00'); return d.getFullYear()+'. '+(d.getMonth()+1)+'. '+d.getDate()+'. '+['일','월','화','수','목','금','토'][d.getDay()]+'요일'; }catch(e){ return ds; } }
/* 텍스트 입력 모달 (native prompt 대체) — 새 캘린더 이름 등. Promise<string|null> (2026-07-02) */
function _homePromptText(title, placeholder){
  return new Promise(function(resolve){
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4)';
    ov.innerHTML='<div style="background:var(--card);border-radius:12px;width:340px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden">'
      +'<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(title||'')+'</div>'
      +'<div style="padding:14px 18px"><input id="_hptInput" type="text" placeholder="'+escHtml(placeholder||'')+'" style="width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:text"></div>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--bdr);background:var(--bg2)"><button id="_hptCancel" style="padding:7px 16px;font-size:12px;font-weight:600;background:var(--card);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button><button id="_hptOk" style="padding:7px 18px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">확인</button></div>'
      +'</div>';
    document.body.appendChild(ov);
    const inp=document.getElementById('_hptInput');
    setTimeout(function(){if(inp)inp.focus();},50);
    function _done(v){ ov.remove(); resolve(v); }
    document.getElementById('_hptCancel').addEventListener('click',function(){_done(null);});
    document.getElementById('_hptOk').addEventListener('click',function(){_done((inp.value||'').trim());});
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();_done((inp.value||'').trim());} if(e.key==='Escape'){e.preventDefault();_done(null);} });
    ov.addEventListener('mousedown',function(e){if(e.target===ov)_done(null);});
  });
}
/* ── 앱 일정 → 구글 캘린더 동기화 (calendar.events). 연동 ON 일 때만, 실패해도 로컬 저장은 유지. (2026-07-02) ── */
function _homeEvToGcalBody(ds, ev){
  const body = { summary: ev.title||'', description: ev.memo||'' };
  const t = (ev.time||'').trim();
  if(/^\d{1,2}:\d{2}$/.test(t)){
    const hhmm = t.length===4 ? '0'+t : t;
    const endHH = String((parseInt(hhmm.slice(0,2),10)+1)%24).padStart(2,'0');
    body.start = { dateTime: ds+'T'+hhmm+':00', timeZone: 'Asia/Seoul' };
    body.end   = { dateTime: ds+'T'+endHH+hhmm.slice(2)+':00', timeZone: 'Asia/Seoul' };
  } else {
    body.start = { date: ds };
    body.end   = { date: ds };
  }
  return body;
}

/* 앱 일정을 체크된 '여러 구글 캘린더'에 동기화 — 없으면 생성, 해제된 캘린더에선 삭제. ev.gcalMap={calId:eventId}. (사용자 요청 2026-07-02) */
async function _homeSyncEventToCals(ds, ev, calIds){
  try{
    if(!_gcalEnabled()) return;
    const api=window.electronAPI;
    if(!(api && api.calendarCreate)) return;
    ev.gcalMap = ev.gcalMap || {};
    if(ev.gid && !Object.keys(ev.gcalMap).length){ ev.gcalMap[ev._calId||'primary']=ev.gid; }
    const body=_homeEvToGcalBody(ds, ev);
    const want={}; (calIds||[]).forEach(function(c){ want[c]=1; });
    /* 체크 해제된 캘린더에서 삭제 */
    const _have=Object.keys(ev.gcalMap);
    for(let i=0;i<_have.length;i++){ const cid=_have[i];
      if(!want[cid]){ try{ await api.calendarDelete(cid, ev.gcalMap[cid]); }catch(e){} delete ev.gcalMap[cid]; }
    }
    /* 체크된 캘린더에 생성 또는 수정 */
    for(let j=0;j<(calIds||[]).length;j++){ const cid=calIds[j];
      try{
        if(ev.gcalMap[cid]){ await api.calendarUpdate(cid, ev.gcalMap[cid], body); }
        else { const res=await api.calendarCreate(cid, body); if(res && res.success && res.data && res.data.id){ ev.gcalMap[cid]=res.data.id; } }
      }catch(e){}
    }
    delete ev.gid;   /* 옛 단일 필드 정리 → 이후 gcalMap 사용 */
    await _saveLocalEvents();
  }catch(e){}
}
/* 연동 OFF 상태에서 기록해둔 로컬 일정(gid 없음)을, 연동을 켜면 일괄로 구글 캘린더에 올림. (사용자 요청 2026-07-02) */
async function _homeBackfillLocalToGcal(){
  try{
    if(!_gcalEnabled()) return;
    const api = window.electronAPI;
    if(!(api && api.calendarCreate)) return;
    let pushed = false;
    const days = Object.keys(_localEvents);
    for(let i=0;i<days.length;i++){
      const ds = days[i];
      const list = _localEvents[ds] || [];
      for(let j=0;j<list.length;j++){
        const ev = list[j];
        if(ev.gid) continue;   /* 이미 올라간 것은 건너뜀 */
        try{
          const res = await api.calendarCreate('primary', _homeEvToGcalBody(ds, ev));
          if(res && res.success && res.data && res.data.id){ ev.gid = res.data.id; pushed = true; }
        }catch(e){}
      }
    }
    if(pushed) await _saveLocalEvents();
  }catch(e){}
}
/* 달력 일별 팝업 자동 저장 — 제목이 있으면 이번 세션의 일정 1건을 생성·갱신(드래프트 id). 제목 비우면 그 초안 제거. (사용자 지시 2026-06-15) */
function _homeDayDraftSave(ds,ov){
  const titleEl=ov&&ov.querySelector('#hcdTitle');
  if(!titleEl)return Promise.resolve(false);
  const chip=ov.querySelector('.hcd-color-chip.selected');
  const draft={
    title:(titleEl.value||'').trim(),
    time:(ov.querySelector('#hcdTime').value||'').trim(),
    memo:(ov.querySelector('#hcdMemo').value||'').trim(),
    color:chip&&chip.dataset.color||'#22c55e'
  };
  const signature=JSON.stringify(draft);
  const save=async function(){
    let undo=null;
    try{
      if(!await _requireHomeCalendar())throw Error("calendar_not_loaded");
      if(ov._homeSavedDraft===signature)return true;
      const list=_localEvents[ds]||[];
      const index=list.findIndex(function(ev){return ev.id===ov._homeDraftId;});
      const previous=index>=0?list[index]:null;
      const previousId=ov._homeDraftId;
      if(!draft.title&&!previous){ov._homeSavedDraft=signature;return true;}
      const next=draft.title?Object.assign({},previous||{id:String(Date.now())+Math.random().toString(36).slice(2,8)},draft):null;
      if(next){
        if(index>=0)list[index]=next;else list.push(next);
        _localEvents[ds]=list;ov._homeDraftId=next.id;
      }else{
        list.splice(index,1);if(!list.length)delete _localEvents[ds];ov._homeDraftId=null;
      }
      undo=function(){
        const current=_localEvents[ds]||[];
        if(next){
          const at=current.indexOf(next);
          if(at>=0){if(previous)current[at]=previous;else current.splice(at,1);}
        }else if(previous&&!current.some(function(ev){return ev.id===previous.id;})){current.splice(Math.min(index,current.length),0,previous);}
        if(current.length)_localEvents[ds]=current;else delete _localEvents[ds];
        ov._homeDraftId=previousId;
      };
      if(!await _saveLocalEvents())throw Error("calendar_save_failed");
      undo=null;ov._homeSavedDraft=signature;
      if(!next&&previous)await _homeSyncEventToCals(ds,previous,[]);
      const error=ov.querySelector('[data-home-save-error]');if(error)error.remove();
      _homeSaveToast();
      try{renderHomeDashboard();}catch(_){}
      const wrap=ov.querySelector('#hcdListWrap');if(wrap)wrap.innerHTML=_hcdListHtml(ds);
      return true;
    }catch(error){
      if(undo)undo();
      let note=ov.querySelector('[data-home-save-error]');
      if(!note){note=document.createElement('p');note.dataset.homeSaveError='';note.setAttribute('role','alert');ov.querySelector('.school-calendar-day-form').appendChild(note);}
      note.textContent='일정을 저장하지 못했습니다. 입력 내용은 그대로 두었으니 연결과 저장 공간을 확인한 뒤 다시 시도해 주세요.';
      console.warn('[home-cal] draft save failed',error);
      return false;
    }
  };
  ov._homeDraftQueue=Promise.resolve(ov._homeDraftQueue).catch(function(){}).then(save);
  return ov._homeDraftQueue;
}
function _evTimeStatic(ev){
  if(ev.time)return ev.time;
  if(ev.start){
    if(typeof ev.start==='string')return ev.start.length>=16?ev.start.slice(11,16):'';
    if(ev.start.dateTime)return ev.start.dateTime.slice(11,16);
  }
  return '';
}

/* 오렌지톡(로컬) 일정 수정 — 제목·시간·메모·색상. gid 있으면 구글에도 반영. (사용자 요청 2026-07-02) */
async function _homeEditLocalEvent(ds, idx, dayOv){
  /* 로드 미완 상태에서 편집·저장 시 빈 _localEvents 로 DB 덮어쓰기 방지 — 로드 보장. (2026-07-15) */
  if(!await _requireHomeCalendar())return;
  const list=_localEvents[ds]||[];
  const ev=list[idx];
  if(!ev)return;
  const _pal=['#22c55e','#0891b2','#3b82f6','#7c3aed','#ec4899','#dc2626','#f97316','#ca8a04'];
  let _selColor=ev.color||'#22c55e';
  let chips='';
  _pal.forEach(function(c){ const sel=(_selColor===c); chips+='<span class="lce-chip" data-color="'+c+'" style="width:18px;height:18px;border-radius:50%;background:'+c+';cursor:pointer;border:'+(sel?'2px solid var(--t1)':'2px solid transparent')+';display:inline-block;box-shadow:0 1px 3px rgba(0,0,0,0.15)"></span>'; });
  const _gon=_gcalEnabled();
  const _shareToggleHtml='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bdr)">'
    +'<div style="font-size:11px;font-weight:700;color:'+(_gon?'var(--t2)':'var(--t3)')+';margin-bottom:6px">📅 구글 캘린더에 등록된 다른 캘린더와 공유</div>'
    +(_gon?'<div id="lceCalList" style="font-size:11px;color:var(--t3);max-height:130px;overflow-y:auto">불러오는 중…</div><button type="button" id="lceCalAdd" style="margin-top:7px;font-size:10px;padding:5px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-radius:5px;cursor:pointer;color:var(--t2);font-family:var(--f)">＋ 새 캘린더 추가</button>':'<div style="font-size:10px;color:var(--t3)">구글 연동 시 사용 가능</div>')
    +'</div>';
  const ov=document.createElement('div');
  ov.id='localEditOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9800;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35)';
  ov.innerHTML='<div style="background:var(--card);border-radius:12px;width:400px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden">'
    +'<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">오렌지톡 일정 수정 ('+escHtml(_homeDsLabel(ds))+')</div>'
    +'<div style="padding:14px 18px">'
    +'<input id="lceTime" type="text" maxlength="5" placeholder="HH:MM (선택)" value="'+escHtml(ev.time||'')+'" style="width:120px;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--fm);margin-bottom:8px;cursor:text"><span style="font-size:9px;color:var(--t3);margin-left:6px">24시간 형태로 입력하세요. 예: 16:30</span>'
    +'<input id="lceTitle" type="text" placeholder="제목 (필수)" value="'+escHtml(ev.title||'')+'" style="display:block;width:100%;box-sizing:border-box;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);margin-bottom:8px;cursor:text">'
    +'<textarea id="lceMemo" placeholder="메모 (선택)" rows="3" style="display:block;width:100%;box-sizing:border-box;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:text;resize:vertical;font-family:var(--f);line-height:1.6;min-height:60px;max-height:40vh;overflow-y:auto">'+escHtml(ev.memo||'')+'</textarea>'
    +'<div style="display:flex;gap:5px;align-items:center;margin-top:10px"><span style="font-size:10px;color:var(--t3);margin-right:2px">색상:</span>'+chips+'</div>'
    +_shareToggleHtml
    +'</div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){const t=document.getElementById('lceTitle');if(t)t.focus();},50);
  _bindTimeInput(document.getElementById('lceTime'));
  const _lm=document.getElementById('lceMemo');
  if(_lm){ const _grow=function(){ _lm.style.height='auto'; _lm.style.height=Math.min(_lm.scrollHeight+2, Math.round(window.innerHeight*0.4))+'px'; }; _lm.addEventListener('input',_grow); setTimeout(_grow,0); }
  ov.querySelectorAll('.lce-chip').forEach(function(chip){
    chip.addEventListener('click',function(){
      _selColor=chip.dataset.color;
      ov.querySelectorAll('.lce-chip').forEach(function(c){c.style.border='2px solid transparent';});
      chip.style.border='2px solid var(--t1)';
    });
  });
  /* 넣을 캘린더 목록(체크박스) 로드 — 내가 편집 가능한 캘린더만. 이미 올라간 캘린더는 체크 표시 (2026-07-02) */
  if(_gon){
    (async function(){
      const _cl=document.getElementById('lceCalList');
      if(!_cl)return;
      let _cals=[];
      try{ const cres=await window.electronAPI.calendarList(); _cals=(cres&&cres.data&&(cres.data.items||cres.data))||[]; }catch(e){}
      _cals=_cals.filter(function(c){ return c && c.id && (!c.accessRole || c.accessRole==='owner' || c.accessRole==='writer'); });
      if(!_cals.length){ _cals=[{id:'primary',summary:'기본 캘린더',primary:true}]; }
      const _onCals={}; if(ev.gcalMap){ Object.keys(ev.gcalMap).forEach(function(k){_onCals[k]=1;}); }
      if(ev.gid && !Object.keys(_onCals).length){ _onCals[ev._calId||'primary']=1; }
      _cl.innerHTML=_cals.map(function(c){ const _cc=c.backgroundColor||'#3b82f6'; return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer"><input type="checkbox" class="lce-cal-chk" value="'+escHtml(c.id)+'" data-color="'+_cc+'"'+(_onCals[c.id]?' checked':'')+' style="width:15px;height:15px;cursor:pointer"><span style="width:11px;height:11px;border-radius:50%;background:'+_cc+';display:inline-block;flex-shrink:0"></span><span style="font-size:11px;color:var(--t1)">'+escHtml(c.summary||c.id)+(c.primary?' (기본)':'')+'</span></label>'; }).join('');
      const _addB=document.getElementById('lceCalAdd');
      if(_addB)_addB.addEventListener('click',async function(){
        const nm=await _homePromptText('새 캘린더 만들기','캘린더 이름 (예: 업무 일정)');
        if(!nm)return;
        try{
          const cr=await window.electronAPI.calendarCreateCalendar(nm);
          if(cr&&cr.success&&cr.data&&cr.data.id){ _cl.insertAdjacentHTML('beforeend','<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer"><input type="checkbox" class="lce-cal-chk" value="'+escHtml(cr.data.id)+'" checked style="width:15px;height:15px;cursor:pointer"><span style="font-size:11px;color:var(--t1)">'+escHtml(nm)+'</span></label>'); _homeSaveToast(); }
          else { await appConfirmModal('캘린더 추가 실패: '+((cr&&cr.error)||''),'새 캘린더',{okOnly:true}); }
        }catch(e){ await appConfirmModal('캘린더 추가 오류: '+e.message,'새 캘린더',{okOnly:true}); }
      });
    })();
  }
  let _saved=false;
  const _save=async function(){
    if(_saved)return;_saved=true;
    const title=(document.getElementById('lceTitle').value||'').trim();
    if(!title){ ov.remove(); return; }
    ev.title=title;
    ev.time=(document.getElementById('lceTime').value||'').trim();
    ev.memo=(document.getElementById('lceMemo').value||'').trim();
    ev.color=_selColor;
    /* 넣은 구글 캘린더가 있으면 그 캘린더 색을 일정 색으로 자동 적용 (첫 체크 캘린더 기준, 2026-07-02) */
    if(_gcalEnabled()){
      const _chk=Array.prototype.slice.call(ov.querySelectorAll('.lce-cal-chk:checked'));
      if(_chk.length){ const _cc=_chk[0].getAttribute('data-color'); if(_cc) ev.color=_cc; }
    }
    await _saveLocalEvents();
    /* 체크된 캘린더에 올리고, 해제된 캘린더에서 내림 (연동 ON 일 때만) */
    if(_gcalEnabled()){
      const _checked=Array.prototype.slice.call(ov.querySelectorAll('.lce-cal-chk:checked')).map(function(c){return c.value;});
      await _homeSyncEventToCals(ds, ev, _checked);
    }
    ov.remove();
    _homeSaveToast();
    renderHomeDashboard();
    if(dayOv) _homeOpenDayPopup(ds);
  };
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_save();});
  ['lceTime','lceTitle'].forEach(function(id){
    const el=document.getElementById(id);
    if(el)el.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); _save(); } });
  });
}
async function _homeDelLocalEvent(ds,idx,ov){
  if(!await _requireHomeCalendar())return;
  const list=_localEvents[ds];
  if(!list||isNaN(idx)||idx<0||idx>=list.length)return;
  const ok=await appConfirmModal('"'+escHtml(list[idx].title||'')+'" 일정을 삭제할까요?','일정 삭제',{okLabel:'삭제',cancelLabel:'취소'});
  if(!ok)return;
  const _delEv=list[idx];
  await _homeSyncEventToCals(ds, _delEv, []);   /* gcalMap 의 모든 캘린더에서 삭제 (빈 배열 = 전부 해제) */
  list.splice(idx,1);
  if(!list.length)delete _localEvents[ds];
  await _saveLocalEvents();
  _homeSaveToast();
  renderHomeDashboard();
  /* 남은 일정이 있으면 팝업을 갱신해 유지(닫지 않음), 마지막까지 지우면 닫기 (사용자 요청 2026-07-02) */
  const _remain=(_localEvents[ds]||[]).length + (_homeCalEvents[ds]||[]).length;
  if(ov&&_remain>0){ _homeOpenDayPopup(ds); }
  else if(ov){ ov.remove(); }
}
/* 구글 캘린더에서 만든 일정을 앱에서 삭제 → 구글에 반영. (2026-07-02) */
async function _homeDelGcalEvent(ds, gid, dayOv){
  const list=_homeCalEvents[ds]||[];
  const gev=list.find(function(x){return x.id===gid;});
  if(!gev)return;
  const ok=await appConfirmModal('"'+escHtml(gev.summary||gev.title||'')+'" 구글 일정을 삭제할까요?','Google 일정 삭제',{okLabel:'삭제',cancelLabel:'취소'});
  if(!ok)return;
  try{
    const res=await window.electronAPI.calendarDelete(gev._calId||'primary', gid);
    if(!(res && res.success)){ await appConfirmModal('삭제 실패: '+((res&&res.error)||''),'Google 일정',{okOnly:true}); return; }
  }catch(e){ await appConfirmModal('삭제 오류: '+e.message,'Google 일정',{okOnly:true}); return; }
  _homeCalEvents[ds]=list.filter(function(x){return x.id!==gid;});
  if(!_homeCalEvents[ds].length)delete _homeCalEvents[ds];
  _homeSaveToast();
  renderHomeDashboard();
  /* 남은 일정이 있으면 팝업을 갱신해 유지(닫지 않음), 마지막까지 지우면 닫기 (사용자 요청 2026-07-02) */
  const _remain=(_localEvents[ds]||[]).length + (_homeCalEvents[ds]||[]).length;
  if(dayOv&&_remain>0){ _homeOpenDayPopup(ds); }
  else if(dayOv){ dayOv.remove(); }
}
/* 구글 캘린더에서 만든 일정을 앱에서 수정 → 구글에 반영. (2026-07-02) */
async function _homeEditGcalEvent(ds, gid, dayOv){
  const list=_homeCalEvents[ds]||[];
  const gev=list.find(function(x){return x.id===gid;});
  if(!gev)return;
  const curTime=_evTimeStatic(gev);
  const ov=document.createElement('div');
  ov.id='gcalEditOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9800;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35)';
  ov.innerHTML='<div style="background:var(--card);border-radius:12px;width:400px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden">'
    +'<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">Google 일정 수정 ('+escHtml(_homeDsLabel(ds))+')</div>'
    +'<div style="padding:14px 18px">'
    +'<input id="gceTime" type="text" maxlength="5" placeholder="HH:MM (선택)" value="'+escHtml(curTime)+'" style="width:120px;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--fm);margin-bottom:8px;cursor:text"><span style="font-size:9px;color:var(--t3);margin-left:6px">24시간 형태로 입력하세요. 예: 16:30</span>'
    +'<input id="gceTitle" type="text" placeholder="제목 (필수)" value="'+escHtml(gev.summary||gev.title||'')+'" style="display:block;width:100%;box-sizing:border-box;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);margin-bottom:8px;cursor:text">'
    +'<textarea id="gceMemo" placeholder="메모 (선택)" rows="4" style="display:block;width:100%;box-sizing:border-box;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:text;resize:vertical;font-family:var(--f);line-height:1.6;min-height:70px;max-height:46vh;overflow-y:auto">'+escHtml(_gcalHtmlToText(gev.description||''))+'</textarea>'
    +'<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bdr)"><div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px">📅 구글 캘린더에 등록된 다른 캘린더와 공유</div><div id="gceCalList" style="font-size:11px;color:var(--t3);max-height:130px;overflow-y:auto">불러오는 중…</div><button type="button" id="gceCalAdd" style="margin-top:7px;font-size:10px;padding:5px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-radius:5px;cursor:pointer;color:var(--t2);font-family:var(--f)">＋ 새 캘린더 추가</button></div>'
    +'</div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){const t=document.getElementById('gceTitle');if(t)t.focus();},50);
  /* 메모 내용 길이에 맞춰 세로 자동 확장 (최대 46vh, 넘으면 스크롤) — 예매내역 등 긴 메모 가독성 (사용자 요청 2026-07-02) */
  const _gm=document.getElementById('gceMemo');
  if(_gm){
    const _grow=function(){ _gm.style.height='auto'; _gm.style.height=Math.min(_gm.scrollHeight+2, Math.round(window.innerHeight*0.46))+'px'; };
    _gm.addEventListener('input',_grow);
    setTimeout(_grow,0);
  }
  _bindTimeInput(document.getElementById('gceTime'));
  /* 이 일정이 들어갈 캘린더 목록(체크박스) — 로컬 일정과 동일 GUI. 현재 캘린더는 체크됨 (2026-07-02) */
  (async function(){
    const _cl=document.getElementById('gceCalList');
    if(!_cl)return;
    let _cals=[];
    try{ const cres=await window.electronAPI.calendarList(); _cals=(cres&&cres.data&&(cres.data.items||cres.data))||[]; }catch(e){}
    _cals=_cals.filter(function(c){ return c && c.id && (!c.accessRole || c.accessRole==='owner' || c.accessRole==='writer'); });
    if(!_cals.length){ _cals=[{id:'primary',summary:'기본 캘린더',primary:true}]; }
    gev.gcalMap = gev.gcalMap || {}; if(!Object.keys(gev.gcalMap).length){ gev.gcalMap[gev._calId||'primary']=gev.id; }
    _cl.innerHTML=_cals.map(function(c){ const _cc=c.backgroundColor||'#3b82f6'; return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer"><input type="checkbox" class="gce-cal-chk" value="'+escHtml(c.id)+'"'+(gev.gcalMap[c.id]?' checked':'')+' style="width:15px;height:15px;cursor:pointer"><span style="width:11px;height:11px;border-radius:50%;background:'+_cc+';display:inline-block;flex-shrink:0"></span><span style="font-size:11px;color:var(--t1)">'+escHtml(c.summary||c.id)+(c.primary?' (기본)':'')+'</span></label>'; }).join('');
    const _addB=document.getElementById('gceCalAdd');
    if(_addB)_addB.addEventListener('click',async function(){
      const nm=await _homePromptText('새 캘린더 만들기','캘린더 이름 (예: 업무 일정)');
      if(!nm)return;
      try{
        const cr=await window.electronAPI.calendarCreateCalendar(nm);
        if(cr&&cr.success&&cr.data&&cr.data.id){ _cl.insertAdjacentHTML('beforeend','<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer"><input type="checkbox" class="gce-cal-chk" value="'+escHtml(cr.data.id)+'" checked style="width:15px;height:15px;cursor:pointer"><span style="font-size:11px;color:var(--t1)">'+escHtml(nm)+'</span></label>'); _homeSaveToast(); }
        else { await appConfirmModal('캘린더 추가 실패: '+((cr&&cr.error)||''),'새 캘린더',{okOnly:true}); }
      }catch(e){ await appConfirmModal('캘린더 추가 오류: '+e.message,'새 캘린더',{okOnly:true}); }
    });
  })();
  let _saved=false;
  const _gceSave=async function(){
    if(_saved)return; _saved=true;
    const title=(document.getElementById('gceTitle').value||'').trim();
    if(!title){ ov.remove(); return; }   /* 제목 비우면 저장 없이 닫기 */
    const time=(document.getElementById('gceTime').value||'').trim();
    const memo=(document.getElementById('gceMemo').value||'').trim();
    /* 메모를 안 건드렸으면(정리된 원본과 동일) 원본 HTML description 보존, 편집했으면 새 텍스트로 교체 */
    const _finalDesc=(memo===_gcalHtmlToText(gev.description||'').trim())?(gev.description||''):memo;
    gev.title=title; gev.time=time; gev.memo=_finalDesc;
    gev.gcalMap = gev.gcalMap || {}; if(!Object.keys(gev.gcalMap).length){ gev.gcalMap[gev._calId||'primary']=gid; }
    const _checked=Array.prototype.slice.call(ov.querySelectorAll('.gce-cal-chk:checked')).map(function(c){return c.value;});
    await _homeSyncEventToCals(ds, gev, _checked);
    const body=_homeEvToGcalBody(ds,{title:title,time:time,memo:_finalDesc});
    gev.summary=title; gev.description=_finalDesc; gev.start=body.start; gev.end=body.end;
    ov.remove();
    _homeSaveToast();
    renderHomeDashboard();
    if(dayOv) _homeOpenDayPopup(ds);   /* 수정 창만 닫고 날짜 팝업은 갱신해 유지 (사용자 요청 2026-07-02) */
  };
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_gceSave();});
  ['gceTime','gceTitle'].forEach(function(id){   /* 메모(textarea)는 Enter=줄바꿈이므로 제외 */
    const el=document.getElementById(id);
    if(el)el.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); _gceSave(); } });
  });
}
/* ── 구글 캘린더 공유 관리 — 누구와 공유되는지 표시 + 공유 대상·권한 추가/해제 (사용자 요청 2026-07-02) ── */
const _GCAL_ROLE_LABEL={owner:'소유자',writer:'편집 가능',reader:'보기 가능',freeBusyReader:'한가함/바쁨만'};
async function _homeManageGcalShare(){
  if(!_gcalEnabled()){ await appConfirmModal('먼저 구글 캘린더 연동(토글)을 켜주세요.','캘린더 공유',{okOnly:true}); return; }
  if(!(window.electronAPI && window.electronAPI.calendarAclList)){ await appConfirmModal('구글 캘린더 연동이 필요합니다.','캘린더 공유',{okOnly:true}); return; }
  const ov=document.createElement('div');
  ov.id='gcalShareOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9800;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35)';
  ov.innerHTML='<div style="background:var(--card);border-radius:12px;width:460px;max-width:94vw;max-height:82vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4)">'
    +'<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">📅 내 구글 캘린더 공유 관리</div>'
    +'<div style="padding:12px 18px 0"><label style="font-size:10px;color:var(--t3);font-weight:700">캘린더 선택</label><select id="gcalShareCal" style="display:block;width:100%;margin-top:4px;font-size:12px;padding:7px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:pointer"><option>불러오는 중…</option></select></div>'
    +'<div id="gcalShareBody" style="padding:14px 18px;overflow-y:auto;flex:1"><div style="text-align:center;color:var(--t3);font-size:12px;padding:20px">불러오는 중…</div></div>'
    +'</div>';
  document.body.appendChild(ov);
  ov.addEventListener('mousedown',function(e){if(e.target===ov)ov.remove();});
  /* 내 모든 캘린더 목록을 드롭다운에 채움 — 공동작업자를 추가한 캘린더가 기본이 아닐 수 있으므로 (2026-07-02) */
  const sel=document.getElementById('gcalShareCal');
  try{
    const cres=await window.electronAPI.calendarList();
    const cals=(cres && cres.data && (cres.data.items||cres.data))||[];
    if(cals.length){
      sel.innerHTML=cals.map(function(c){ return '<option value="'+escHtml(c.id||'')+'">'+escHtml(c.summary||c.summaryOverride||c.id||'')+(c.primary?' (기본)':'')+'</option>'; }).join('');
    } else { sel.innerHTML='<option value="primary">기본 캘린더</option>'; }
  }catch(e){ sel.innerHTML='<option value="primary">기본 캘린더</option>'; }
  sel.addEventListener('change',function(){ _gcalShareRefresh(sel.value); });
  await _gcalShareRefresh(sel.value||'primary');
}
async function _gcalShareRefresh(calId){
  calId=calId||'primary';
  const body=document.getElementById('gcalShareBody');
  if(!body)return;
  const res=await window.electronAPI.calendarAclList(calId);
  if(!(res && res.success)){ body.innerHTML='<div style="color:#dc2626;font-size:12px;padding:12px">공유 목록을 불러오지 못했습니다: '+escHtml((res&&res.error)||'')+'</div>'; return; }
  const rules=(res.data && res.data.items)||[];
  const shared=rules.filter(function(r){return r.scope && r.scope.type==='user' && r.role!=='owner';});
  let h='<div style="font-size:11px;color:var(--t2);font-weight:700;margin-bottom:8px">공유 중인 대상</div>';
  if(!shared.length){ h+='<div style="font-size:11px;color:var(--t3);padding:6px 0 10px">이 캘린더에 공유한 사람이 없습니다.</div>'; }
  shared.forEach(function(r){
    h+='<div style="display:flex;align-items:center;gap:8px;padding:7px 9px;background:var(--bg2);border-radius:6px;margin-bottom:5px">'
      +'<span style="flex:1;font-size:12px;color:var(--t1);word-break:break-all">'+escHtml(r.scope.value||'')+'</span>'
      +'<span style="font-size:10px;color:var(--t3);flex-shrink:0">'+escHtml(_GCAL_ROLE_LABEL[r.role]||r.role)+'</span>'
      +'<span data-share-del="'+escHtml(r.id||'')+'" title="공유 해제" style="cursor:pointer;color:var(--t3);font-size:12px;padding:2px 5px;flex-shrink:0">✕</span>'
      +'</div>';
  });
  h+='<div style="border-top:1px solid var(--bdr);margin-top:12px;padding-top:12px">'
    +'<div style="font-size:11px;color:var(--t2);font-weight:700;margin-bottom:8px">새로 공유하기</div>'
    +'<div style="display:flex;gap:6px">'
    +'<input id="gcalShareEmail" type="email" placeholder="상대방 gmail 주소" style="flex:1;min-width:0;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:text">'
    +'<select id="gcalShareRole" style="font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:pointer;flex-shrink:0"><option value="reader">보기 가능</option><option value="writer">편집 가능</option></select>'
    +'<button id="gcalShareAdd" style="padding:6px 14px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;flex-shrink:0">공유</button>'
    +'</div>'
    +'<div style="font-size:10px;color:var(--t3);margin-top:6px">선택한 캘린더를 상대방 구글 계정과 공유합니다.</div>'
    +'</div>';
  body.innerHTML=h;
  body.querySelectorAll('[data-share-del]').forEach(function(el){
    el.addEventListener('click',async function(){
      const rid=el.getAttribute('data-share-del');
      const ok=await appConfirmModal('이 대상의 공유를 해제할까요?','공유 해제',{okLabel:'해제',cancelLabel:'취소'});
      if(!ok)return;
      const dres=await window.electronAPI.calendarAclDelete(calId, rid);
      if(dres && dres.success){ _homeSaveToast(); _gcalShareRefresh(calId); }
      else await appConfirmModal('해제 실패: '+((dres&&dres.error)||''),'공유',{okOnly:true});
    });
  });
  const addBtn=document.getElementById('gcalShareAdd');
  if(addBtn)addBtn.addEventListener('click',async function(){
    const email=(document.getElementById('gcalShareEmail').value||'').trim();
    const role=document.getElementById('gcalShareRole').value||'reader';
    if(!email || email.indexOf('@')===-1){ await appConfirmModal('올바른 이메일을 입력해 주세요.','공유',{okOnly:true}); return; }
    const rule={scope:{type:'user',value:email},role:role};
    const ires=await window.electronAPI.calendarAclInsert(calId, rule);
    if(ires && ires.success){ _homeSaveToast(); _gcalShareRefresh(calId); }
    else await appConfirmModal('공유 실패: '+((ires&&ires.error)||''),'공유',{okOnly:true});
  });
}

/* 진행률 데이터 4종 */
/* 📊 진행률 상태바 위젯 — 1열 최상단 (캘린더 헤더에서 이동). 오늘/이번달/학기/학년도 4종 세로 배치. */
function _wProgressContent(){
  const _prog=_progressData();
  function bar(label,pct,color){
    /* 퍼센트 글씨 — 흰 글씨 + 검은 외곽선 (채워진 바·빈 바 양쪽에서 또렷). */
    const _pctStyle='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:11px;font-weight:800;color:#fff;text-shadow:0 0 2px #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;letter-spacing:0.3px;line-height:1';
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px" title="'+escHtml(label)+' 진행률 '+pct+'%">'
      +'<span style="font-size:11px;font-weight:700;color:var(--t2);min-width:62px;white-space:nowrap">'+escHtml(label)+'</span>'
      +'<div style="flex:1;height:20px;background:var(--bg2);border-radius:5px;overflow:hidden;position:relative"><div style="background:'+color+';height:100%;width:'+pct+'%;border-radius:5px"></div><span style="'+_pctStyle+'">'+pct+'%</span></div>'
      +'</div>';
  }
  const _vis=_getProgVis();
  let _out='';
  if(_vis.day!==false)      _out+=bar('🕐 오늘',_prog.day,'#0891b2');
  if(_vis.month!==false)    _out+=bar('📅 이달',_prog.month,'#16a34a');
  if(_vis.year!==false)     _out+=bar('🗓 올해',_prog.year,'#4f46e5');
  if(_vis.semester!==false) _out+=bar('📚 학기',_prog.semester,'#7c3aed');
  if(_vis.ay!==false)       _out+=bar('🎓 학년도',_prog.ay,'#d97706');
  if(!_out) _out='<div style="font-size:10.5px;color:var(--t3);text-align:center;padding:6px 0">표시할 항목이 없습니다 (⚙ 에서 켜기)</div>';
  return _out;
}
function _progressData(){
  const now=new Date();
  /* 오늘 (00:00~24:00 — 하루 전체 기준) */
  const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(now);dayEnd.setHours(23,59,59,999);
  const day=Math.min(100,Math.max(0,Math.round((now-dayStart)/(dayEnd-dayStart)*100)));
  /* 이번 달 */
  const mStart=new Date(now.getFullYear(),now.getMonth(),1);
  const mEnd=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59);
  const month=Math.min(100,Math.max(0,Math.round((now-mStart)/(mEnd-mStart)*100)));
  /* 올해 (1/1~12/31) */
  const yStart=new Date(now.getFullYear(),0,1);
  const yEnd=new Date(now.getFullYear(),11,31,23,59,59);
  const year=Math.min(100,Math.max(0,Math.round((now-yStart)/(yEnd-yStart)*100)));
  /* 학기·학년도 — 학기 기간 설정(semesterInfo, 4-달력 ⚙)에서 공유. 학년도 = 1학기 시작 ~ 2학기 종료 (사용자 결정 2026-06-15). */
  const _sy=_semYearDates();
  const _pct=function(s,e){ const a=new Date(s+'T00:00:00'), b=new Date(e+'T23:59:59'); return (b>a)?Math.min(100,Math.max(0,Math.round((now-a)/(b-a)*100))):0; };
  let semester, semLabel;
  if(now.getTime()<=new Date(_sy.sem1End+'T23:59:59').getTime()){ semester=_pct(_sy.sem1Start,_sy.sem1End); semLabel='1학기'; }
  else { semester=_pct(_sy.sem2Start,_sy.sem2End); semLabel='2학기'; }
  const ayPct=_pct(_sy.sem1Start,_sy.sem2End);
  return {day:day,month:month,year:year,semester:semester,semLabel:semLabel,ay:ayPct};
}

/* 진행률 4종 표시 토글 (⚙ prog-gear). 기본 전부 ON — vis[key]===false 일 때만 숨김. */
const _PROG_ITEMS=[
  {key:'day',      icon:'🕐', name:'오늘'},
  {key:'month',    icon:'📅', name:'이달'},
  {key:'year',     icon:'🗓', name:'올해'},
  {key:'semester', icon:'📚', name:'학기'},
  {key:'ay',       icon:'🎓', name:'학년도'},
];
function _getProgVis(){ try{ return JSON.parse(localStorage.getItem('ec_home_progress_vis')||'{}')||{}; }catch(_){ return {}; } }
function _saveProgVis(v){ try{ localStorage.setItem('ec_home_progress_vis', JSON.stringify(v||{})); }catch(_){} }
function _toggleProgVis(key){ const v=_getProgVis(); v[key]=!(v[key]!==false); _saveProgVis(v); }
/* 시기별 진행률 표시 항목 켜고/끄기 모달 (위젯 보관함과 동일한 눈알 토글·헤더 그라데이션). */
function _openProgGearModal(){
  if(document.getElementById('homeProgGearModal')) return;
  const ov=document.createElement('div');
  ov.id='homeProgGearModal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:11000;display:flex;align-items:center;justify-content:center';
  function bodyHtml(){
    const vis=_getProgVis();
    let g='';
    _PROG_ITEMS.forEach(function(it){
      const on=vis[it.key]!==false;
      g+='<div data-action="prog-vis-toggle" data-pkey="'+it.key+'" style="display:flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid '+(on?'var(--bdr)':'rgba(220,38,38,0.25)')+';border-radius:7px;background:'+(on?'var(--card)':'rgba(220,38,38,0.04)')+';cursor:pointer;opacity:'+(on?'1':'0.55')+';transition:all .12s;margin-bottom:7px" title="'+(on?'클릭하여 숨기기':'클릭하여 표시')+'">';
      g+='<span style="font-size:15px;flex-shrink:0">'+it.icon+'</span>';
      g+='<span style="font-size:12px;font-weight:600;color:var(--t1);flex:1">'+escHtml(it.name)+'</span>';
      if(it.key==='semester'||it.key==='ay'){
        const _gtip = (it.key==='semester')
          ? "올해 각 학기의 시작일과 종료일을 설정하며 아래 '학년도'에 자동 적용됩니다."
          : "이번 학년도의 시작일과 종료일을 설정하며 위 '학기' 설정으로 자동 적용됩니다.";
        g+='<span data-action="prog-period-cfg" data-pkey="'+it.key+'" data-tip="'+escHtml(_gtip)+'" style="flex-shrink:0;cursor:pointer;font-size:12px;color:var(--t3);width:22px;height:22px;border-radius:50%;border:1px solid var(--bdr);background:var(--bg2);display:inline-flex;align-items:center;justify-content:center;margin-right:2px">⚙</span>';
      }
      g+='<span style="color:'+(on?'var(--cyan)':'#dc2626')+';flex-shrink:0;display:inline-flex">'+dailyColEyeIcon(on)+'</span>';
      g+='</div>';
    });
    return g;
  }
  let h='<div style="background:var(--card);border-radius:14px;width:300px;max-width:92vw;box-shadow:0 24px 60px rgba(0,0,0,0.45);overflow:hidden;display:flex;flex-direction:column">';
  h+='<div style="padding:13px 18px;background:rgba(6,182,212,0.10);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:9px">';
  h+='<span style="font-size:19px">📊</span>';
  h+='<div style="flex:1"><div style="font-size:13px;font-weight:800;color:var(--t1)">시기별 진행률 표시 설정</div>';
  h+='<div style="font-size:10.5px;color:var(--t3);margin-top:2px">눈알 아이콘으로 켜고 끕니다. 즉시 반영됩니다.</div></div></div>';
  h+='<div id="progGearBody" style="padding:13px 16px">'+bodyHtml()+'</div>';
  h+='</div>';
  ov.innerHTML=h;
  const _esc=function(e){ if(e.key==='Escape') _close(); };
  function _close(){ if(ov&&ov.parentNode) ov.remove(); document.removeEventListener('keydown',_esc,true); }
  ov.addEventListener('click',function(e){
    if(e.target===ov){ _close(); return; }
    const cfg=e.target.closest('[data-action="prog-period-cfg"]');
    if(cfg){ _openLessonSemConfig(); return; }   /* 학기·학년도 모두 4-달력 통합 설정(semesterInfo) — 원래대로 (사용자 지시 2026-06-15) */
    const t=e.target.closest('[data-action="prog-vis-toggle"]');
    if(!t) return;
    const pk=t.dataset.pkey; if(!pk) return;
    _toggleProgVis(pk);
    const body=ov.querySelector('#progGearBody'); if(body) body.innerHTML=bodyHtml();
    try{ renderHomeDashboard(); }catch(_){}
  });
  /* 톱니바퀴 hover → 우리 프로그램 미니팝업으로 설명 표시 (사용자 지시 2026-06-16) */
  ov.addEventListener('mouseover',function(e){ const g=e.target.closest&&e.target.closest('[data-action="prog-period-cfg"]'); if(g&&g.dataset.tip){ try{ showHeaderTooltip({target:g,currentTarget:g}, g.dataset.tip, false, true); }catch(_){} } });
  ov.addEventListener('mouseout',function(e){ if(e.target.closest&&e.target.closest('[data-action="prog-period-cfg"]')){ try{ hideHeaderTooltip(); }catch(_){} } });
  document.body.appendChild(ov);
  document.addEventListener('keydown',_esc,true);
}

/* 커스텀 학기·학년도 기간 저장 (⚙ 보조 톱니바퀴). 스키마: {semester:{start,end}, ay:{start,end}} (YYYY-MM-DD). */
function _getProgPeriods(){ try{ return JSON.parse(localStorage.getItem('ec_home_progress_period')||'{}')||{}; }catch(_){ return {}; } }
function _saveProgPeriods(v){ try{ localStorage.setItem('ec_home_progress_period', JSON.stringify(v||{})); }catch(_){} }
function _ymd(dt){ const y=dt.getFullYear(),m=('0'+(dt.getMonth()+1)).slice(-2),d=('0'+dt.getDate()).slice(-2); return y+'-'+m+'-'+d; }
/* 학기 기간(semesterInfo, 4-달력 ⚙)에서 1·2학기 시작/종료 4일자 해석 — 진행률 학기·학년도가 공유. 학년도 = 1학기 시작 ~ 2학기 종료 (사용자 결정 2026-06-15). */
function _semYearDates(){
  let si={};
  try{ si=(JSON.parse(localStorage.getItem('ec_settings')||'{}').semesterInfo)||{}; }catch(_){}
  const ay=_academicYear();
  const lastFeb=new Date(ay+1,2,0).getDate();
  const ok=function(v){ return v&&/^\d{4}-\d{2}-\d{2}$/.test(v); };
  return {
    sem1Start: ok(si.sem1Start)?si.sem1Start:(ok(si.semester1Start)?si.semester1Start:_ymd(_firstSchoolDay(ay))),
    sem1End:   ok(si.sem1End)?si.sem1End:(ok(si.semester1End)?si.semester1End:_ymd(new Date(ay,6,25))),
    sem2Start: ok(si.sem2Start)?si.sem2Start:(ok(si.semester2Start)?si.semester2Start:_ymd(new Date(ay,7,20))),
    sem2End:   ok(si.sem2End)?si.sem2End:(ok(si.semester2End)?si.semester2End:_ymd(new Date(ay+1,1,lastFeb)))
  };
}
/* pkey('semester'|'ay') 의 기본 시작/종료일 (사용자 미지정 시 입력란에 채워줄 기본값). */
/* 3/2 부터 시작해 주말·공휴일(대체휴일 포함, isHoliday)이 아닌 첫 등교일. */
function _firstSchoolDay(year){
  const d=new Date(year,2,2);
  for(let i=0;i<20;i++){
    const dow=d.getDay();
    if(dow!==0 && dow!==6 && !isHoliday(_ymd(d))) return new Date(d);
    d.setDate(d.getDate()+1);
  }
  return new Date(year,2,2);
}
function _progPeriodDefault(pkey){
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  if(pkey==='ay'){
    /* 학년도: 3월 첫 등교일 ~ 다음해 2월 말일(28/29). 1·2월이면 전년도 3월 시작분. */
    const ayY=(m<=1)?y-1:y;
    const lastFeb=new Date(ayY+1,2,0).getDate();
    return { start:_ymd(_firstSchoolDay(ayY)), end:_ymd(new Date(ayY+1,1,lastFeb)) };
  }
  /* 학기 — 현재 시점이 2학기(8월~익년 2월)면 2학기 기본, 아니면 1학기 기본. */
  const is2nd=(m>=7)||(m<=1);
  if(is2nd){
    const sy=(m<=1)?y-1:y;                         /* 1·2월이면 전년도 8월 시작분 */
    const lastFeb=new Date(sy+1,2,0).getDate();
    return { start:_ymd(new Date(sy,7,20)), end:_ymd(new Date(sy+1,1,lastFeb)) };  /* 2학기: 8/20 ~ 익년 2월 말일 */
  }
  return { start:_ymd(_firstSchoolDay(y)), end:_ymd(new Date(y,6,25)) };            /* 1학기: 3월 첫 등교일 ~ 7/25 */
}
/* 시작일·종료일 미니 팝업 (입력란 클릭 → 휴일 달력 picker). */
function _openProgPeriodPopup(pkey){
  if(document.getElementById('progPeriodPopup')) return;
  const label = pkey==='ay' ? '학년도' : '학기';
  const def = _progPeriodDefault(pkey);
  const saved = _getProgPeriods()[pkey] || {};
  let cur = { start: saved.start||def.start, end: saved.end||def.end };
  const ov=document.createElement('div');
  ov.id='progPeriodPopup';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:11050;display:flex;align-items:center;justify-content:center';
  function fieldRow(which){
    const val = which==='start'?cur.start:cur.end;
    const cap = which==='start'?'시작일':'종료일';
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">'
      +'<span style="font-size:11.5px;font-weight:700;color:var(--t2);min-width:42px">'+cap+'</span>'
      +'<input type="text" readonly data-action="prog-period-pick" data-which="'+which+'" value="'+escHtml(val||'')+'" placeholder="날짜 선택" style="flex:1;font-size:12px;padding:6px 9px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);cursor:pointer">'
      +'</div>';
  }
  function body(){
    return '<div id="ppFields">'+fieldRow('start')+fieldRow('end')+'</div>'
      +'<div style="display:flex;margin-top:8px">'
      +'<button data-action="prog-period-reset" style="flex:1;font-size:11.5px;padding:7px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);border-radius:6px;cursor:pointer">초기화</button>'
      +'</div>'
      +'<div style="font-size:10px;color:var(--t3);text-align:center;margin-top:7px">날짜를 선택하면 자동 저장됩니다</div>';
  }
  let h='<div style="background:var(--card);border-radius:14px;width:280px;max-width:92vw;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">';
  h+='<div style="padding:12px 16px;background:rgba(6,182,212,0.10);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:16px">⚙</span><div style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(label)+' 기간 설정</div></div>';
  h+='<div id="ppBody" style="padding:14px 16px">'+body()+'</div></div>';
  ov.innerHTML=h;
  function _close(){ if(ov&&ov.parentNode) ov.remove(); document.removeEventListener('keydown',_esc,true); }
  function _esc(e){ if(e.key==='Escape') _close(); }
  function _refresh(){ const b=ov.querySelector('#ppFields'); if(b) b.innerHTML=fieldRow('start')+fieldRow('end'); }
  ov.addEventListener('click',function(e){
    if(e.target===ov){ _close(); return; }
    const pick=e.target.closest('[data-action="prog-period-pick"]');
    if(pick){
      const which=pick.dataset.which;
      _openProgCalPicker(cur[which], function(ds){
        cur[which]=ds; _refresh();
        /* 날짜 지정 즉시 저장 (저장 버튼 없음) */
        const all=_getProgPeriods(); all[pkey]={start:cur.start,end:cur.end}; _saveProgPeriods(all);
        try{ renderHomeDashboard(); }catch(_){}
      });
      return;
    }
    if(e.target.closest('[data-action="prog-period-reset"]')){
      /* 초기화 — 커스텀 지정 해제 → 기본값으로 복귀 */
      const all=_getProgPeriods(); delete all[pkey]; _saveProgPeriods(all);
      const d=_progPeriodDefault(pkey); cur={start:d.start,end:d.end}; _refresh();
      try{ renderHomeDashboard(); }catch(_){}
      return;
    }
  });
  document.body.appendChild(ov);
  document.addEventListener('keydown',_esc,true);
}
/* 휴일 달력 picker — 좌측 사이드바 달력(renderCalendar)과 동일한 mcal-* 마크업 + isHoliday() 사용.
 * initial: 'YYYY-MM-DD' (선택 표시·시작 월). onPick(ds): 날짜 클릭 시 호출 후 닫힘. */
function _openProgCalPicker(initial, onPick, opts){
  if(document.getElementById('progCalPicker')) return;
  /* 연도 팝업 범위 — 기본 올해 포함 최근 5개년(yearBack=4). 호출부 옵션으로 조정 가능
   *  (예: 학기 기간 설정은 {yearBack:0, yearAhead:1} → 당해·내년 2개). 2026-06-08 */
  opts = opts || {};
  const _yBack = (opts.yearBack==null)?4:opts.yearBack;
  const _yAhead = (opts.yearAhead==null)?0:opts.yearAhead;
  const MONTHS=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let base = (initial && /^\d{4}-\d{2}-\d{2}$/.test(initial)) ? new Date(initial+'T00:00:00') : new Date();
  let curY=base.getFullYear(), curM=base.getMonth();
  const ov=document.createElement('div');
  ov.id='progCalPicker';
  /* z-index — 다른 모달(학기 기간 설정 등) 위에서 열려도 항상 최상단(2026-06-08). */
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483640;display:flex;align-items:center;justify-content:center';
  function grid(){
    try{ ensureHolidayYear(String(curY)); }catch(_){}   /* 해당 연도 공휴일을 API 로 불러옴(캐시 없으면 백그라운드 fetch). */
    const first=new Date(curY,curM,1), last=new Date(curY,curM+1,0);
    const startDay=first.getDay(), days=last.getDate(), prevLast=new Date(curY,curM,0).getDate();
    const today=_ymd(new Date());
    /* 연·월 호버 팝업 — 사이드 달력(daily-view) / 대시보드 통계 달력(dashboard-view) 와 동일 마크업.
       data-action 위임이 이미 ppc-* 패턴이라 충돌 없도록 ppc-year / ppc-month 로 통일. */
    let yPop='<div class="mcal-popup">';
    { const _ny=new Date().getFullYear(); for(let y=_ny-_yBack;y<=_ny+_yAhead;y++) yPop+='<div class="mcal-popup-item'+(y===curY?' active':'')+'" data-action="ppc-year" data-year="'+y+'">'+y+'</div>'; }
    yPop+='</div>';
    let mPop='<div class="mcal-popup" style="min-width:140px;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
    for(let m=0;m<12;m++) mPop+='<div class="mcal-popup-item'+(m===curM?' active':'')+'" data-action="ppc-month" data-month="'+m+'" style="width:45px">'+MONTHS[m]+'</div>';
    mPop+='</div>';
    let html='<div class="mcal-hdr">'
      +'<div class="mcal-nav"><button class="mcal-btn" data-action="ppc-prev">◂</button></div>'
      +'<div class="mcal-title"><span class="mcal-year">'+curY+'년'+yPop+'</span> <span class="mcal-month">'+MONTHS[curM]+mPop+'</span></div>'
      +'<div class="mcal-nav"><button class="mcal-btn" data-action="ppc-next">▸</button></div>'
      +'</div><div class="mcal-grid">';
    ['일','월','화','수','목','금','토'].forEach(function(d,i){ let cls='mcal-dow'; if(i===0)cls+=' sun'; if(i===6)cls+=' sat'; html+='<div class="'+cls+'">'+d+'</div>'; });
    for(let i=startDay-1;i>=0;i--) html+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
    for(let d=1;d<=days;d++){
      const ds=_ymd(new Date(curY,curM,d));
      const dow=new Date(curY,curM,d).getDay();
      const hol=isHoliday(ds);
      let cls='mcal-cell';
      if(ds===today)cls+=' today';
      if(ds===initial)cls+=' selected';
      if(dow===0)cls+=' sun';
      if(dow===6)cls+=' sat';
      if(hol&&dow!==0&&dow!==6)cls+=' holiday';
      html+='<div class="'+cls+'" data-action="ppc-day" data-ds="'+ds+'"><span class="day-n">'+d+'</span></div>';
    }
    const total=startDay+days, rem=(7-total%7)%7;
    for(let i=1;i<=rem;i++) html+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
    html+='</div>';
    return html;
  }
  let h='<div style="background:var(--card);border-radius:14px;padding:10px;box-shadow:0 24px 60px rgba(0,0,0,0.55)"><div id="ppcCal" style="width:300px;max-width:90vw">'+grid()+'</div></div>';
  ov.innerHTML=h;
  function _close(){ if(ov&&ov.parentNode) ov.remove(); document.removeEventListener('keydown',_esc,true); try{ bus.off('holidays:updated', _onHol); }catch(_){} }
  function _esc(e){ if(e.key==='Escape') _close(); }
  function _re(){ const c=ov.querySelector('#ppcCal'); if(c) c.innerHTML=grid(); }
  /* 공휴일 API 응답이 늦게 도착하면 달력을 다시 그려 휴일 표시 반영(2026-06-08). */
  function _onHol(){ if(document.getElementById('progCalPicker')) _re(); }
  try{ bus.on('holidays:updated', _onHol); }catch(_){}
  ov.addEventListener('click',function(e){
    if(e.target===ov){ _close(); return; }
    if(e.target.closest('[data-action="ppc-prev"]')){ curM--; if(curM<0){curM=11;curY--;} _re(); return; }
    if(e.target.closest('[data-action="ppc-next"]')){ curM++; if(curM>11){curM=0;curY++;} _re(); return; }
    /* 연 팝업 클릭 → curY 변경 (월은 유지). 잘못된 값 방어. */
    const yBtn=e.target.closest('[data-action="ppc-year"]');
    if(yBtn){ const yv=parseInt(yBtn.dataset.year,10); if(!isNaN(yv)&&yv>=1900&&yv<=2999){ curY=yv; _re(); } return; }
    /* 월 팝업 클릭 → curM 변경 (연은 유지). */
    const mBtn=e.target.closest('[data-action="ppc-month"]');
    if(mBtn){ const mv=parseInt(mBtn.dataset.month,10); if(!isNaN(mv)&&mv>=0&&mv<=11){ curM=mv; _re(); } return; }
    const day=e.target.closest('[data-action="ppc-day"]');
    if(day){ const ds=day.dataset.ds; _close(); if(typeof onPick==='function') onPick(ds); return; }
  });
  document.body.appendChild(ov);
  document.addEventListener('keydown',_esc,true);
}

/* ── 신규 위젯 구현 (플래너 양방향 동기 / 외부 RSS) ── */

/* 공용 헬퍼 */
function _getLSList(key){
  try{const raw=localStorage.getItem(key);if(raw){const arr=JSON.parse(raw);if(Array.isArray(arr))return arr;}}catch(e){}
  return [];
}
function _emptyMsg(text){return _schoolEmpty('📋',text,'');}

/* (질병관리청 위젯 제거됨 — KDCA RSS 관련 코드 삭제) */

/* ── 업무 사이트·전화번호·품의 (호스트 DB 공유 + 자동 저장) ── */

/* 자동 저장 토스트 — 다른 모듈과 동일 패턴 (#globalSaveToast)
   ※ 스플래시/사용자 선택 화면(body.loaded 미부여)에서는 표시하지 않음 — 부적절한 컨텍스트 */
let _homeSaveTimer=null;
function _homeSaveToast(){
  /* 스플래시/로그인 화면 단계에서는 토스트 억제 */
  if(!document.body.classList.contains('loaded'))return;
  const splash=document.getElementById('splash');
  if(splash&&splash.style.display!=='none')return;
  const toast=document.getElementById('globalSaveToast');
  if(!toast)return;
  toast.textContent='저장 중…';
  toast.className='global-save-toast show saving';
  if(_homeSaveTimer)clearTimeout(_homeSaveTimer);
  _homeSaveTimer=setTimeout(function(){
    toast.textContent='모든 내용이 저장되었습니다.';
    toast.className='global-save-toast show';
    setTimeout(function(){toast.className='global-save-toast';},3000);
  },300);
}

/* 호스트 DB(SQLite blob) 저장/조회 — 모든 접속자 공유
   ※ localStorage는 항상 동기 저장되므로 가장 최신 상태로 간주.
     DB 보다 localStorage 우선 → 재시작 시 데이터 손실 방지 */
async function _hostDbGet(key,fallbackKeys){
  /* 1) localStorage 우선 — 매 저장마다 동기적으로 기록되므로 가장 신뢰 가능 */
  const lsArr=_getLSList(key);
  if(lsArr.length){
    /* DB는 백그라운드로 검증/동기 — 다른 접속자 변경이 있을 수 있으니 비동기로 가져와 cache 갱신 */
    if(window.electronAPI&&window.electronAPI.dbGet){
      window.electronAPI.dbGet('common',key).then(function(res){
        if(res&&res.success&&Array.isArray(res.data)&&res.data.length>lsArr.length){
          /* DB가 더 많은 항목을 가지고 있으면 (다른 접속자 추가) 머지 */
          try{localStorage.setItem(key,JSON.stringify(res.data));}catch(e){}
          if(_hostListCache[key]){_hostListCache[key]=res.data;setTimeout(renderHomeDashboard,0);}
        }
      }).catch(function(){});
    }
    return lsArr;
  }
  /* 2) localStorage가 비어있으면 DB 시도 */
  try{
    if(window.electronAPI&&window.electronAPI.dbGet){
      const res=await window.electronAPI.dbGet('common',key);
      if(res&&res.success){
        if(Array.isArray(res.data)&&res.data.length){
          /* DB에서 받은 데이터를 localStorage에도 즉시 반영 */
          try{localStorage.setItem(key,JSON.stringify(res.data));}catch(e){}
          return res.data;
        }
      }
    }
  }catch(e){}
  /* 3) 마지막 폴백: 다른 키(과거 키 등) */
  if(fallbackKeys){
    for(let i=0;i<fallbackKeys.length;i++){
      const a=_getLSList(fallbackKeys[i]);
      if(a.length)return a;
    }
  }
  return [];
}
async function _hostDbSet(key,arr){
  /* ★ localStorage 먼저 동기 저장 — DB 저장 실패/앱 강제종료 시에도 데이터 보존 */
  try{localStorage.setItem(key,JSON.stringify(arr));}catch(e){}
  try{
    if(window.electronAPI&&window.electronAPI.dbSet){
      await window.electronAPI.dbSet('common',key,arr);
    }
  }catch(e){console.error('[home] dbSet failed',key,e);}
  _homeSaveToast();
}

/* 메모리 캐시 + 첫 로드 플래그 */
const _hostListCache={ec_home_quicklinks:null,ec_home_phonebook:null,ec_home_procurement:null,ec_home_routine:null,ec_home_todolist:null};
async function _ensureHostListLoaded(key,fallback){
  if(_hostListCache[key]!==null)return _hostListCache[key];
  const arr=await _hostDbGet(key,fallback||[]);
  /* 로드 도중에 사용자가 저장했다면 사용자 변경을 우선 */
  if(_hostListCache[key]!==null)return _hostListCache[key];
  _hostListCache[key]=arr;
  /* DB/LS에서 불러온 데이터를 localStorage에도 반영해 새 세션 즉시 표시 */
  try{if(Array.isArray(arr))localStorage.setItem(key,JSON.stringify(arr));}catch(e){}
  /* 첫 로드 후 화면 갱신 */
  if(arr&&arr.length)setTimeout(renderHomeDashboard,0);
  return arr;
}
function _qlGet(){
  if(_hostListCache.ec_home_quicklinks===null){_ensureHostListLoaded('ec_home_quicklinks',['gp2_quicklinks','ec_quicklinks']);return _getLSList('ec_home_quicklinks');}
  return _hostListCache.ec_home_quicklinks||[];
}
async function _qlSet(items){
  _hostListCache.ec_home_quicklinks=items;
  await _hostDbSet('ec_home_quicklinks',items);
}
function _phGet(){
  if(_hostListCache.ec_home_phonebook===null){_ensureHostListLoaded('ec_home_phonebook',['gp2_phonebook','ec_phonebook']);return _getLSList('ec_home_phonebook');}
  return _hostListCache.ec_home_phonebook||[];
}
async function _phSet(items){
  _hostListCache.ec_home_phonebook=items;
  await _hostDbSet('ec_home_phonebook',items);
}

/* ── 위젯 제목 하단 설명(캡션) — 더블클릭으로 편집 ── */
const _homeCapDefaults={
  quicklinks:'자주 방문하는 업무 사이트를 등록하세요.',
  phonebook:'자주 연락하는 업무 전화번호를 등록하세요.',
  procurement:'구매 예정 물품을 기록하고 체크하세요.',
  routine:'매일 반복할 체크 항목입니다. (자동 초기화 안 함)',
  todolist:'오늘 처리할 일의 목록으로 캘린더와 연동됩니다.'
};
let _homeCapCache=null;
async function _homeCapEnsureAsync(){
  try{
    if(window.electronAPI&&window.electronAPI.dbGet){
      const res=await window.electronAPI.dbGet('common','ec_home_widget_caps');
      if(res&&res.success&&res.data&&typeof res.data==='object'&&!Array.isArray(res.data)){
        _homeCapCache=Object.assign({},_homeCapDefaults,res.data);
        setTimeout(renderHomeDashboard,0);
        return _homeCapCache;
      }
    }
  }catch(e){}
  try{
    const cached=JSON.parse(localStorage.getItem('ec_home_widget_caps')||'null');
    if(cached&&typeof cached==='object'&&!Array.isArray(cached)){
      _homeCapCache=Object.assign({},_homeCapDefaults,cached);
      return _homeCapCache;
    }
  }catch(e){}
  _homeCapCache=Object.assign({},_homeCapDefaults);
  return _homeCapCache;
}
function _homeCapGet(key){
  if(!_homeCapCache){_homeCapEnsureAsync();return _homeCapDefaults[key]||'';}
  const value=(_homeCapCache[key]!=null?_homeCapCache[key]:_homeCapDefaults[key])||'';
  return key==='todolist'&&value==='캘린더와 같은 오늘의 일정이에요. 추가·수정·삭제가 함께 반영됩니다.'?_homeCapDefaults.todolist:value;
}
async function _homeCapSet(key,val){
  if(!_homeCapCache)_homeCapCache=Object.assign({},_homeCapDefaults);
  _homeCapCache[key]=val;
  try{localStorage.setItem('ec_home_widget_caps',JSON.stringify(_homeCapCache));}catch(e){}
  try{
    if(window.electronAPI&&window.electronAPI.dbSet){
      await window.electronAPI.dbSet('common','ec_home_widget_caps',_homeCapCache);
    }
  }catch(e){console.error('[home] cap dbSet failed',key,e);}
  _homeSaveToast();
}
function _homeCapEl(key){
  const v=_homeCapGet(key);
  return '<div class="home-cap" data-cap-key="'+key+'" title="더블클릭으로 설명 수정" style="font-size:10px;color:var(--t3);margin:-4px 0 8px 0;padding:3px 6px;border-radius:4px;cursor:text;user-select:none;line-height:1.4">'+escHtml(v)+'</div>';
}

/* ── 커스텀 입력 모달 (Electron prompt() 대체)
   - 입력 즉시 자동 저장 (onSave 콜백 호출)
   - 확인 버튼 없음, 대신 X 버튼으로 닫으면 저장된 상태 그대로 유지
   - onDelete 콜백 제공 시 "삭제" 버튼 표시 */
/* URL 입력 한 줄 (입력칸 + ✕ 삭제) — _homePromptMulti 의 urllist 필드용 (복수 URL, 사용자 요청 2026-06-24) */
function _hpUrlRowHtml(u){
  return '<div class="hp-url-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">'
    +'<input type="text" class="hp-url-inp" value="'+escHtml(u||'')+'" placeholder="https://..." style="flex:1;padding:7px 10px;font-size:12px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);box-sizing:border-box;outline:none">'
    +'<span class="hp-url-del" title="이 URL 삭제" style="cursor:pointer;color:var(--t3);font-size:13px;padding:2px 7px;border:1px solid var(--bdr);border-radius:6px;flex-shrink:0;user-select:none">✕</span>'
    +'</div>';
}
function _homePromptMulti(title,fields,opts){
  opts=opts||{};
  return new Promise(function(resolve){
    const ex=document.getElementById('homePromptOv');if(ex)ex.remove();
    const ov=document.createElement('div');ov.id='homePromptOv';
    /* 켜질 때 페이드 인 — 다른 모달과 동일한 opacity fade only */
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:11000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.18s ease';
    let h='<div style="background:var(--card);border-radius:12px;width:380px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden">';
    h+='<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(title)+'</div>';
    h+='<div style="padding:16px 18px">';
    fields.forEach(function(f,i){
      h+='<div style="margin-bottom:10px">';
      h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:4px">'+escHtml(f.label)+(f.required?' <span style="color:#dc2626">*</span>':'')+'</div>';
      if(f.type==='urllist'){
        /* 복수 URL — 동적 추가/삭제(최대 10). value 는 배열(또는 단일 문자열) (사용자 요청 2026-06-24) */
        let _urls=(Array.isArray(f.value)?f.value:(f.value?[f.value]:[])).filter(Boolean);
        if(!_urls.length)_urls=[''];
        if(_urls.length>10)_urls=_urls.slice(0,10);
        h+='<div id="hpUrlList'+i+'">';
        _urls.forEach(function(u){ h+=_hpUrlRowHtml(u); });
        h+='</div>';
        h+='<button type="button" id="hpUrlAdd'+i+'"'+(_urls.length>=10?' disabled':'')+' style="margin-top:2px;padding:6px 12px;font-size:11px;font-weight:700;background:rgba(6,182,212,0.08);color:var(--cyan);border:1px solid rgba(6,182,212,0.3);border-radius:6px;cursor:pointer;font-family:var(--f)">+ URL 링크 추가</button>';
        h+='<div style="font-size:10px;color:var(--t3);margin-top:3px">여러 곳에서 구입하는 경우 URL 을 최대 10개까지 추가할 수 있습니다.</div>';
      } else {
        h+='<input id="hpInp'+i+'" type="text" value="'+escHtml(f.value||'')+'" placeholder="'+escHtml(f.placeholder||'')+'" style="width:100%;padding:7px 10px;font-size:12px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);box-sizing:border-box;outline:none">';
      }
      h+='</div>';
    });
    h+='<div style="font-size:10px;color:var(--t3);margin-top:4px;line-height:1.6">※ 입력하는 즉시 자동 저장됩니다.<br>※ <b>Enter</b> 또는 팝업 바깥 클릭으로 저장 후 닫기.</div>';
    h+='</div>';
    /* 닫기 버튼 제거 — Enter / 바깥 클릭 / Esc 로 닫기. 삭제 버튼은 옵션 시 표시 */
    if(opts.showDelete){
      h+='<div style="background:var(--bg2);padding:10px 18px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-start;gap:6px;align-items:center">';
      h+='<button id="hpDelete" style="padding:6px 14px;font-size:11px;font-weight:700;background:rgba(239,68,68,0.1);color:#dc2626;border:1px solid rgba(239,68,68,0.3);border-radius:6px;cursor:pointer;font-family:var(--f)">🗑 삭제</button>';
      h+='</div>';
    }
    h+='</div>';
    ov.innerHTML=h;
    let _closed=false;
    function _close(result){
      if(_closed)return;_closed=true;
      /* 꺼질 때 페이드 아웃 후 제거 */
      ov.style.opacity='0';
      setTimeout(function(){
        if(ov.parentNode)ov.remove();
        resolve(result);
      }, 180);
    }
    /* 값 수집 — urllist 필드는 배열, 일반 필드는 문자열 */
    function _collectVals(){
      return fields.map(function(f,i){
        if(f.type==='urllist'){
          const cont=document.getElementById('hpUrlList'+i);
          if(!cont)return [];
          return Array.prototype.slice.call(cont.querySelectorAll('input.hp-url-inp')).map(function(inp){return inp.value.trim();}).filter(Boolean);
        }
        const inp=document.getElementById('hpInp'+i);return inp?inp.value.trim():'';
      });
    }
    /* 입력할 때마다 자동 저장 (디바운스 250ms) */
    let _autoSaveTimer=null;
    function _autoSave(){
      if(_autoSaveTimer)clearTimeout(_autoSaveTimer);
      _autoSaveTimer=setTimeout(function(){
        const vals=_collectVals();
        if(typeof opts.onSave==='function'){
          try{opts.onSave(vals);}catch(e){}
        }
      },250);
    }
    /* 닫기 직전 마지막 저장 — 바깥 클릭 / Enter / Esc 모든 경로에서 호출 */
    function _saveAndClose(){
      if(_autoSaveTimer)clearTimeout(_autoSaveTimer);
      const vals=_collectVals();
      if(typeof opts.onSave==='function'){try{opts.onSave(vals);}catch(e){}}
      _close(null);
    }
    ov.addEventListener('mousedown',function(e){if(e.target===ov)_saveAndClose();});
    /* 입력칸에서 포커스가 빠지면(다른 칸/팝업 빈 공간 클릭) 즉시 저장 → _hostDbSet 가 저장 토스트 표시.
     * urllist(복수 URL) 도 input 이벤트만으로는 '적고 클릭' 시 토스트가 안 떠서 보강 (사용자 요청 2026-06-24). */
    ov.addEventListener('focusout',function(e){
      const t=e.target;
      if(!t)return;
      if(t.classList&&(t.classList.contains('hp-url-inp')||/^hpInp\d+$/.test(t.id||''))){
        if(_autoSaveTimer)clearTimeout(_autoSaveTimer);
        const vals=_collectVals();
        if(typeof opts.onSave==='function'){try{opts.onSave(vals);}catch(_e){}}
      }
    });
    document.body.appendChild(ov);
    /* 다음 프레임에 opacity 1로 전환 → 페이드 인 */
    requestAnimationFrame(function(){ov.style.opacity='1';});
    setTimeout(function(){
      fields.forEach(function(f,i){
        const inp=document.getElementById('hpInp'+i);
        if(!inp)return;
        inp.addEventListener('input',_autoSave);
        /* Enter 키 → 저장 후 닫기 (모든 입력칸에서) */
        inp.addEventListener('keydown',function(e){
          if(e.key==='Enter'){e.preventDefault();_saveAndClose();}
        });
      });
      /* urllist 필드 — 입력/삭제(✕, 위임)/Enter + "+ URL 링크 추가" 버튼 바인딩 (최대 10) */
      fields.forEach(function(f,i){
        if(f.type!=='urllist')return;
        const cont=document.getElementById('hpUrlList'+i);
        const addBtn=document.getElementById('hpUrlAdd'+i);
        if(cont){
          cont.addEventListener('input',function(e){ if(e.target&&e.target.classList.contains('hp-url-inp'))_autoSave(); });
          cont.addEventListener('keydown',function(e){ if(e.key==='Enter'&&e.target&&e.target.classList.contains('hp-url-inp')){e.preventDefault();_saveAndClose();} });
          cont.addEventListener('click',function(e){
            const del=e.target.closest('.hp-url-del'); if(!del)return;
            const row=del.closest('.hp-url-row'); if(row)row.remove();
            if(addBtn)addBtn.disabled=(cont.querySelectorAll('.hp-url-row').length>=10);
            _autoSave();
          });
        }
        if(addBtn){
          addBtn.addEventListener('click',function(){
            if(!cont)return;
            if(cont.querySelectorAll('.hp-url-row').length>=10){ addBtn.disabled=true; return; }
            const tmp=document.createElement('div'); tmp.innerHTML=_hpUrlRowHtml('');
            const newRow=tmp.firstElementChild; if(newRow){ cont.appendChild(newRow); const ni=newRow.querySelector('.hp-url-inp'); if(ni)ni.focus(); }
            if(cont.querySelectorAll('.hp-url-row').length>=10)addBtn.disabled=true;
            _autoSave();
          });
        }
      });
      const del=document.getElementById('hpDelete');
      if(del)del.addEventListener('click',function(){
        if(typeof opts.onDelete==='function'){try{opts.onDelete();}catch(e){}}
        _close('deleted');
      });
      const first=document.getElementById('hpInp0');if(first){first.focus();first.select();}
      ov.addEventListener('keydown',function(e){
        if(e.key==='Escape'){_saveAndClose();}
      });
    },10);
  });
}

export async function _homeAddQuicklink(){
  let newIdx=-1;
  await _homePromptMulti('🔗 새 사이트 추가',[
    {label:'사이트 이름',placeholder:'예: 나이스 업무포털'},
    {label:'URL',placeholder:'https://...',value:'https://'}
  ],{
    onSave:function(vals){
      const items=_qlGet();
      if(newIdx===-1){items.push({name:vals[0]||'',url:vals[1]||''});newIdx=items.length-1;}
      else {items[newIdx]={name:vals[0]||'',url:vals[1]||''};}
      _qlSet(items).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      if(newIdx<0)return;
      const items=_qlGet();items.splice(newIdx,1);
      _qlSet(items).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
export async function _homeDelQuicklink(idx){
  const items=_qlGet();
  if(isNaN(idx)||idx<0||idx>=items.length)return;
  items.splice(idx,1);
  await _qlSet(items);
  renderHomeDashboard();
}
export async function _homeAddPhone(){
  let newIdx=-1;
  await _homePromptMulti('📱 새 전화번호 추가',[
    {label:'이름/소속',placeholder:'예: OO교육지원청 체육건강과'},
    {label:'전화번호',placeholder:'02-1234-5678'}
  ],{
    onSave:function(vals){
      const items=_phGet();
      if(newIdx===-1){items.push({label:vals[0]||'',number:vals[1]||''});newIdx=items.length-1;}
      else {items[newIdx]={label:vals[0]||'',number:vals[1]||''};}
      _phSet(items).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      if(newIdx<0)return;
      const items=_phGet();items.splice(newIdx,1);
      _phSet(items).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
export async function _homeDelPhone(idx){
  const items=_phGet();
  if(isNaN(idx)||idx<0||idx>=items.length)return;
  items.splice(idx,1);
  await _phSet(items);
  renderHomeDashboard();
}

function _wQuicklinksEditable(){
  const items=_qlGet();
  if(!items.length){
    return _schoolEmpty("🔗","자주 가는 사이트를 모아보세요","위의 + 버튼으로 업무 사이트를 추가할 수 있어요.");
  }
  return items.map(function(l,i){
    const url=l.url||l.href||'';
    const name=l.name||l.title||url;
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bdr)">'
      +'<span style="font-size:9px;color:var(--t3);font-weight:700;font-family:var(--fm);min-width:18px;text-align:right">'+(i+1)+'.</span>'
      +'<a href="#" data-action="open-external" data-url="'+escHtml(url).replace(/"/g,'&quot;')+'" style="color:var(--t1);text-decoration:none;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🌐 '+escHtml(name)+'</a>'
      +'<span data-action="edit-quicklink" data-idx="'+i+'" title="수정" style="cursor:pointer;color:var(--t3);font-size:11px;padding:2px 4px;flex-shrink:0;opacity:0.5">✏️</span>'
      +'<span data-action="del-quicklink" data-idx="'+i+'" title="삭제" style="cursor:pointer;color:var(--t3);font-size:11px;padding:2px 4px;flex-shrink:0;opacity:0.5">✕</span>'
      +'</div>';
  }).join('');
}
function _wPhonebookEditable(){
  const items=_phGet();
  if(!items.length){
    return _schoolEmpty("📱","연락처를 모아보세요","위의 + 버튼으로 자주 쓰는 전화번호를 추가하세요.");
  }
  return items.map(function(p,i){
    const label=p.label||p.name||'';
    const number=p.number||p.phone||'';
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bdr)">'
      +'<span style="font-size:9px;color:var(--t3);font-weight:700;font-family:var(--fm);min-width:18px;text-align:right">'+(i+1)+'.</span>'
      +'<span style="font-size:11px;color:var(--t1);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(label)+'</span>'
      +'<span data-action="copy-phone" data-num="'+escHtml(number).replace(/"/g,'&quot;')+'" title="복사" style="font-size:10px;font-family:var(--fm);color:var(--cyan);cursor:pointer">'+escHtml(number)+'</span>'
      +'<span data-action="edit-phone" data-idx="'+i+'" title="수정" style="cursor:pointer;color:var(--t3);font-size:11px;padding:2px 4px;flex-shrink:0;opacity:0.5">✏️</span>'
      +'<span data-action="del-phone" data-idx="'+i+'" title="삭제" style="cursor:pointer;color:var(--t3);font-size:11px;padding:2px 4px;flex-shrink:0;opacity:0.5">✕</span>'
      +'</div>';
  }).join('');
}

/* 품의 물건 리스트 */
function _prGet(){
  if(_hostListCache.ec_home_procurement===null){_ensureHostListLoaded('ec_home_procurement',['gp2_shopping','ec_shopping']);return _getLSList('ec_home_procurement');}
  return _hostListCache.ec_home_procurement||[];
}
async function _prSet(items){
  _hostListCache.ec_home_procurement=items;
  await _hostDbSet('ec_home_procurement',items);
}
/* 품목의 URL 목록 — 신모델 urls 배열 우선, 옛 단일 url 도 호환 (사용자 요청 2026-06-24) */
function _prUrls(t){
  if(!t)return [];
  if(Array.isArray(t.urls))return t.urls.map(function(u){return String(u||'').trim();}).filter(Boolean);
  const u=String(t.url||'').trim();
  return u?[u]:[];
}
/* 긴 URL 을 일정 길이로 자르고 … 표기 (네이티브 title 툴팁이 가로로 길어지지 않게) */
function _prTruncUrl(u,max){
  u=String(u||''); max=max||46;
  return u.length>max ? (u.slice(0,max-1)+'…') : u;
}
function _prOpenUrl(u){
  u=String(u||'').trim(); if(!u)return;
  try{
    if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(u);
    else window.open(u,'_blank');
  }catch(_){window.open(u,'_blank');}
}
/* 복수 URL 선택 모달 — 클릭하면 해당 URL 로 웹 브라우저 팝업. 가로로 길면 … 로 줄임(CSS ellipsis). */
function _prOpenUrlChooser(itemText,urls){
  const ex=document.getElementById('prUrlChooserOv');if(ex)ex.remove();
  const ov=document.createElement('div');ov.id='prUrlChooserOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:12000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s ease';
  let h='<div style="background:var(--card);border-radius:12px;width:440px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden">';
  h+='<div style="background:var(--popup-head);padding:12px 18px;border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">🔗 이동할 URL 선택'+(itemText?' — '+escHtml(itemText):'')+'</div>';
  h+='<div style="padding:10px 14px;max-height:60vh;overflow-y:auto">';
  urls.forEach(function(u){
    h+='<div class="pr-url-choice" data-url="'+escHtml(u)+'" title="'+escHtml(u)+'" style="display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--bdr);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:all .12s">'
      +'<span style="color:var(--cyan);font-size:13px;flex-shrink:0">🔗</span>'
      +'<span style="font-size:11.5px;color:var(--t1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(u)+'</span>'
      +'</div>';
  });
  h+='</div>';
  h+='<div style="font-size:10px;color:var(--t3);padding:0 16px 12px">※ 클릭하면 웹 브라우저로 열립니다.</div>';
  h+='</div>';
  ov.innerHTML=h;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ov.style.opacity='1';});
  function _close(){ ov.style.opacity='0'; document.removeEventListener('keydown',_onKey,true); setTimeout(function(){if(ov.parentNode)ov.remove();},180); }
  function _onKey(e){ if(e.key==='Escape'){e.preventDefault();_close();} }
  document.addEventListener('keydown',_onKey,true);
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_close();});
  ov.querySelectorAll('.pr-url-choice').forEach(function(row){
    row.addEventListener('mouseenter',function(){row.style.background='rgba(6,182,212,0.08)';row.style.borderColor='var(--cyan)';});
    row.addEventListener('mouseleave',function(){row.style.background='';row.style.borderColor='var(--bdr)';});
    row.addEventListener('click',function(){_prOpenUrl(row.dataset.url);_close();});
  });
}
export async function _homeAddProcurement(){
  let newIdx=-1;
  await _homePromptMulti('🛒 품의 물건 리스트 추가',[
    {label:'품목',placeholder:'예: 알코올 티슈 24개 1박스'},
    {label:'URL (선택 · 복수 가능)',type:'urllist',value:[]}
  ],{
    onSave:function(vals){
      const items=_prGet();
      const txt=(vals[0]||'').trim();
      const urls=Array.isArray(vals[1])?vals[1]:((vals[1]||'').trim()?[(vals[1]||'').trim()]:[]);
      /* 빈 텍스트면 이전에 추가된 항목 제거 (빈 칸만 남는 버그 방지) */
      if(!txt){
        if(newIdx!==-1&&newIdx<items.length){items.splice(newIdx,1);newIdx=-1;}
        _prSet(items).then(function(){renderHomeDashboard();});
        return;
      }
      if(newIdx===-1){items.push({text:txt,done:false,urls:urls,url:urls[0]||''});newIdx=items.length-1;}
      else if(newIdx<items.length){items[newIdx].text=txt;items[newIdx].urls=urls;items[newIdx].url=urls[0]||'';}
      _prSet(items).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      if(newIdx<0)return;
      const items=_prGet();items.splice(newIdx,1);
      _prSet(items).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  /* 닫을 때 빈 텍스트 항목이 남아있으면 정리 (안전장치) */
  const items=_prGet();
  if(newIdx!==-1&&newIdx<items.length){
    const t=(items[newIdx]&&items[newIdx].text||'').trim();
    if(!t){items.splice(newIdx,1);await _prSet(items);}
  }
  renderHomeDashboard();
}
export async function _homeDelProcurement(idx){
  const items=_prGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  items.splice(idx,1);await _prSet(items);renderHomeDashboard();
}
export async function _homeToggleProcurement(idx){
  const items=_prGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  items[idx].done=!items[idx].done;await _prSet(items);renderHomeDashboard();
}
function _wProcurementEditable(){
  const items=_prGet();
  if(!items.length)return _schoolEmpty("🛒","구매할 물품을 적어보세요","위의 + 버튼으로 품의할 품목을 추가하세요.");
  return items.map(function(t,i){
    const done=!!t.done;
    const urls=_prUrls(t);
    /* 단일이면 바로 열기, 복수면 선택 모달 — 핸들러가 idx 로 판단. 툴팁은 길면 … 로 줄임 (사용자 요청 2026-06-24) */
    const _linkTitle = urls.length>1
      ? ('URL 열기 ('+urls.length+'개) — 클릭하여 선택')
      : ('URL 열기 ('+_prTruncUrl(urls[0])+')');
    const linkBtn=urls.length
      ? '<span data-action="open-procurement-url" data-idx="'+i+'" title="'+escHtml(_linkTitle)+'" style="cursor:pointer;color:var(--cyan);font-size:11px;padding:2px 4px;flex-shrink:0">🔗'+(urls.length>1?'<sup style="font-size:8px;font-weight:700">'+urls.length+'</sup>':'')+'</span>'
      : '';
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bdr)">'
      +'<span style="font-size:9px;color:var(--t3);font-weight:700;font-family:var(--fm);min-width:18px;text-align:right">'+(i+1)+'.</span>'
      +'<span data-action="toggle-procurement" data-idx="'+i+'" style="cursor:pointer;font-size:14px;color:'+(done?'#22c55e':'var(--t3)')+';flex-shrink:0">'+(done?'☑':'☐')+'</span>'
      +'<span data-action="toggle-procurement" data-idx="'+i+'" style="cursor:pointer;font-size:11px;color:var(--t1);flex:1;'+(done?'text-decoration:line-through;color:var(--t3)':'')+'">'+escHtml(t.text||t.title||'')+'</span>'
      +linkBtn
      +'<span data-action="edit-procurement" data-idx="'+i+'" title="수정" style="cursor:pointer;color:var(--t3);font-size:11px;padding:2px 4px;flex-shrink:0;opacity:0.5">✏️</span>'
      +'<span data-action="del-procurement" data-idx="'+i+'" title="삭제" style="cursor:pointer;color:var(--t3);font-size:11px;padding:2px 4px;flex-shrink:0;opacity:0.5">✕</span>'
      +'</div>';
  }).join('');
}

/* 루틴 트래커 */
function _rtGet(){
  if(_hostListCache.ec_home_routine===null){_ensureHostListLoaded('ec_home_routine',['gp2_routine','ec_routine']);return _getLSList('ec_home_routine');}
  return _hostListCache.ec_home_routine||[];
}
async function _rtSet(items){
  _hostListCache.ec_home_routine=items;
  await _hostDbSet('ec_home_routine',items);
}
export async function _homeAddRoutine(){
  let newIdx=-1;
  await _homePromptMulti('⟳ 새 루틴 추가',[
    {label:'루틴 이름',placeholder:'예: 보건일지 결재 확인'}
  ],{
    onSave:function(vals){
      const items=_rtGet();
      if(newIdx===-1){items.push({text:vals[0]||'',checks:{}});newIdx=items.length-1;}
      else {items[newIdx].text=vals[0]||'';}
      _rtSet(items).then(function(){renderHomeDashboard();});
    },
    onDelete:function(){
      if(newIdx<0)return;
      const items=_rtGet();items.splice(newIdx,1);
      _rtSet(items).then(function(){renderHomeDashboard();});
    },
    showDelete:true
  });
  renderHomeDashboard();
}
export async function _homeDelRoutine(idx){
  const items=_rtGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  items.splice(idx,1);await _rtSet(items);renderHomeDashboard();
}
export async function _homeToggleRoutine(idx){
  const items=_rtGet();if(isNaN(idx)||idx<0||idx>=items.length)return;
  const today=_todayStr();
  if(!items[idx].checks)items[idx].checks={};
  items[idx].checks[today]=!items[idx].checks[today];
  await _rtSet(items);renderHomeDashboard();
}
function _schoolTaskIcon(kind){
  const paths={check:'<path d="m5 12 4 4L19 6"/>',edit:'<path d="m16 3 5 5-12 12H4v-5L16 3Z"/><path d="m13 6 5 5"/>',delete:'<path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'};
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+paths[kind]+'</svg>';
}
function _wRoutineEditable(){
  const items=_rtGet();
  if(!items.length)return _schoolEmpty("☑","반복 업무를 정리해 보세요","위의 + 버튼으로 매일 확인할 일을 추가하세요.");
  const today=_todayStr();
  return items.map(function(r,i){
    const done=r.checks&&r.checks[today]===true;
    const text=r.text||r.title||'',title=escHtml(text||'내용을 입력해 주세요'),label=escHtml(text||'루틴 항목');
    const attrs=' data-idx="'+i+'"';
    return '<div class="school-task-row school-routine-row'+(done?' is-complete':'')+'">'
      +'<button type="button" class="school-task-check" data-action="toggle-routine"'+attrs+' aria-pressed="'+!!done+'" aria-label="'+label+' 완료 표시">'+_schoolTaskIcon('check')+'</button>'
      +'<button type="button" class="school-task-text-toggle school-task-label" data-action="toggle-routine"'+attrs+' aria-pressed="'+!!done+'"><span class="school-task-title'+(text?'':' is-placeholder')+'">'+title+'</span></button>'
      +'<span class="school-task-actions">'
      +'<button type="button" class="school-task-action" data-action="edit-routine"'+attrs+' aria-label="'+label+' 수정" title="수정"><span class="school-task-emoji" aria-hidden="true">✏️</span></button>'
      +'<button type="button" class="school-task-action school-task-delete" data-action="del-routine"'+attrs+' aria-label="'+label+' 삭제" title="삭제"><span class="school-task-emoji" aria-hidden="true">🗑️</span></button>'
      +'</span></div>';
  }).join('');
}
/* Today's task list is a view of the same dated calendar records. */
export async function _homeAddTodo(){
  if(!await _requireHomeCalendar())return;
  return _homeOpenDayPopup(_todayStr());
}
export async function _homeDelTodo(key,ds){
  if(!await _requireHomeCalendar())return;
  ds=ds||_todayStr();
  const ev=_homeFindTodo(key,ds);if(!ev)return;
  if(ev._local)return _homeDelLocalEvent(ds,_homeLocalTodoIndex(ds,ev),null);
  return _homeDelGcalEvent(ds,ev.id,null);
}
export async function _homeToggleTodo(key,ds){
  ds=ds||_todayStr();
  if(!await _requireHomeCalendar())return;
  const ev=_homeFindTodo(key,ds);if(!ev)return;
  return _homeToggleCalEvent(_homeCalEventKey(ev),ds);
}
function _homeEvTime(ev){
  if(ev.time)return ev.time;
  if(ev.start){
    if(typeof ev.start==='string')return ev.start.length>=16?ev.start.slice(11,16):'';
    if(ev.start.dateTime)return ev.start.dateTime.slice(11,16);
  }
  return '';
}
function _homeEvTitle(ev){return ev.summary||ev.title||ev.text||'(제목 없음)';}
function _homeEventsForDate(ds){
  const local=_localEvents[ds]||[];
  const out=local.map(function(ev){return Object.assign({},ev,{_local:true});});
  (_homeCalEvents[ds]||[]).forEach(function(ev){
    const duplicate=local.some(function(item){return item.gid===ev.id||(item.gcalMap&&Object.keys(item.gcalMap).some(function(id){return item.gcalMap[id]===ev.id;}));});
    if(!duplicate)out.push(Object.assign({},ev,{_local:false}));
  });
  return out;
}
function _homeTodayCalEvents(){return _homeEventsForDate(_todayStr());}
function _homeCalEventKey(ev){
  const source=ev._local===false?'google:'+(ev._calId||ev.calendarId||'primary')+':':'local:';
  return source+String(ev.id||ev.eventId||(_homeEvTime(ev)+'|'+_homeEvTitle(ev)));
}
function _homeLocalTodoIndex(ds,ev){
  return (_localEvents[ds]||[]).findIndex(function(item){return _homeCalEventKey(item)===_homeCalEventKey(ev);});
}
function _homeFindTodo(key,ds){
  const items=_homeEventsForDate(ds);
  if(typeof key==='number')return items[key];
  return items.find(function(ev){return _homeCalEventKey(ev)===key;});
}
function _homeCalDoneMap(ds){
  try{return JSON.parse(localStorage.getItem('ec_home_calevent_done_'+(ds||_todayStr()))||'{}')||{};}catch(_){return {};}
}
function _homeEventDone(ds,ev){
  if(ev._local!==false&&typeof ev.done==='boolean')return ev.done;
  const map=_homeCalDoneMap(ds),key=_homeCalEventKey(ev);
  if(Object.prototype.hasOwnProperty.call(map,key))return map[key]===true;
  return map[String(ev.id||ev.eventId||(_homeEvTime(ev)+'|'+_homeEvTitle(ev)))]===true;
}
async function _homeToggleCalEvent(key,ds){
  ds=ds||_todayStr();
  if(!await _requireHomeCalendar())return;
  const ev=_homeFindTodo(key,ds);if(!ev)return;
  const done=!_homeEventDone(ds,ev);
  if(ev._local){
    const item=(_localEvents[ds]||[])[_homeLocalTodoIndex(ds,ev)];if(!item)return;
    const previous=item.done;item.done=done;
    if(!await _saveLocalEvents()){
      if(previous===undefined)delete item.done;else item.done=previous;
      await appConfirmModal('완료 상태를 저장하지 못했습니다. 다시 시도해 주세요.','일정 저장',{okOnly:true});
      return;
    }
  }else{
    const map=_homeCalDoneMap(ds);map[key]=done;
    try{localStorage.setItem('ec_home_calevent_done_'+ds,JSON.stringify(map));}
    catch(e){await appConfirmModal('완료 상태를 저장하지 못했습니다.','일정 저장',{okOnly:true});return;}
  }
  renderHomeDashboard();
  const popup=document.getElementById('homeCalDayPopup');
  if(popup&&popup.dataset.date===ds){const list=popup.querySelector('#hcdListWrap');if(list)list.innerHTML=_hcdListHtml(ds);}
}
function _homeCalendarDoneControl(ds,ev){
  const done=_homeEventDone(ds,ev);
  return '<button type="button" class="school-todo-check" data-action="hcd-done" data-arg="'+escHtml(ds)+'" data-key="'+escHtml(_homeCalEventKey(ev))+'" aria-pressed="'+done+'" aria-label="'+escHtml(_homeEvTitle(ev))+' 완료 표시">'+(done?'☑':'☐')+'</button>';
}
function _wCalEventTodos(){
  const ds=_todayStr(),events=_homeTodayCalEvents();
  return events.map(function(ev){
    const key=escHtml(_homeCalEventKey(ev)),done=_homeEventDone(ds,ev),title=escHtml(_homeEvTitle(ev)),time=_homeEvTime(ev);
    const attrs=' data-key="'+key+'" data-date="'+ds+'"';
    return '<div class="school-todo-row school-task-row'+(done?' is-complete':'')+'">'
      +'<button type="button" class="school-todo-check school-task-check" data-action="toggle-todo"'+attrs+' aria-pressed="'+done+'" aria-label="'+title+' 완료 표시">'+_schoolTaskIcon('check')+'</button>'
      +'<span class="school-todo-label school-task-label">'+(time?'<span class="school-todo-time school-task-time">'+escHtml(time)+'</span> ':'')+'<span class="school-todo-title school-task-title">'+title+'</span>'+(ev._local?'':'<small class="school-todo-source">Google</small>')+'</span>'
      +'<span class="school-task-actions">'
      +'<button type="button" class="school-task-action" data-action="edit-todo"'+attrs+' aria-label="'+title+' 수정" title="수정"><span class="school-task-emoji" aria-hidden="true">✏️</span></button>'
      +'<button type="button" class="school-task-action school-task-delete" data-action="del-todo"'+attrs+' aria-label="'+title+' 삭제" title="삭제"><span class="school-task-emoji" aria-hidden="true">🗑️</span></button>'
      +'</span></div>';
  }).join('');
}
function _wTodoEditable(){
  if(_todoCalendarError)return '<div role="status" class="school-todo-loading">'+escHtml(_todoCalendarError)+'<button type="button" class="btn btn-sm" data-action="retry-todo">다시 불러오기</button></div>';
  if(!_todoCalendarReady)return '<div role="status" class="school-todo-loading">일정과 할 일을 불러오고 있어요.</div>';
  return _wCalEventTodos()||_schoolEmpty('📌','오늘 일정과 할 일이 없어요','위의 + 버튼이나 캘린더에서 추가하면 함께 표시돼요.');
}

function _wQuicklinks(){
  /* 플래너와 동일 키 사용 (gp2_quicklinks or ec_quicklinks — 둘 다 확인) */
  let items=_getLSList('gp2_quicklinks');
  if(!items.length)items=_getLSList('ec_quicklinks');
  if(!items.length){
    return _emptyMsg('플래너의 Quick Links 위젯에서 사이트를 추가하세요.');
  }
  return items.slice(0,6).map(function(l){
    const url=l.url||l.href||'';
    const name=l.name||l.title||url;
    return '<div style="margin-bottom:3px"><a href="#" data-action="open-external" data-url="'+escHtml(url).replace(/"/g,'&quot;')+'" style="color:var(--t1);text-decoration:none;font-size:11px">🌐 '+escHtml(name)+'</a></div>';
  }).join('');
}

function _wPhonebook(){
  let items=_getLSList('gp2_phonebook');
  if(!items.length)items=_getLSList('ec_phonebook');
  if(!items.length){
    return _emptyMsg('플래너의 업무 연락처 위젯에서 번호를 추가하세요.');
  }
  return items.slice(0,6).map(function(p){
    const label=p.label||p.name||'';
    const number=p.number||p.phone||'';
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;padding:3px 0;border-bottom:1px solid var(--bdr)"><span style="font-size:11px;color:var(--t1)">'+escHtml(label)+'</span><span data-action="copy-phone" data-num="'+escHtml(number).replace(/"/g,'&quot;')+'" style="font-size:10px;font-family:var(--fm);color:var(--cyan);cursor:pointer">'+escHtml(number)+'</span></div>';
  }).join('');
}

function _wNotepad(){
  const raw=localStorage.getItem('gp2_notepad')||localStorage.getItem('ec_notepad')||'';
  if(!raw.trim()){
    return _emptyMsg('플래너의 자유 메모장에서 메모를 작성하세요.');
  }
  /* 최대 250자 미리보기 */
  const text=raw.length>250?raw.slice(0,250)+'…':raw;
  return '<div style="white-space:pre-wrap;font-size:11px;color:var(--t1);line-height:1.6;background:rgba(240,253,244,0.4);padding:8px 10px;border-radius:6px">'+escHtml(text)+'</div>';
}

function _wTodolist(){return _wTodoEditable();}

function _wRoutine(){
  let items=_getLSList('gp2_routine');
  if(!items.length)items=_getLSList('ec_routine');
  if(!items.length){
    return _emptyMsg('플래너의 루틴 트래커에서 루틴을 추가하세요.');
  }
  const today=_todayStr();
  return items.slice(0,6).map(function(r){
    const done=(r.checks||{})[today]===true;
    return '<div style="margin-bottom:3px;font-size:11px">'+(done?'☑':'☐')+' '+escHtml(r.text||r.title||'')+'</div>';
  }).join('');
}

function _wDday(){
  let items=_getLSList('gp2_dday');
  if(!items.length)items=_getLSList('ec_dday');
  if(!items.length){
    return _emptyMsg('플래너의 D-Day 위젯에서 일정을 추가하세요.');
  }
  const now=new Date();now.setHours(0,0,0,0);
  return items.slice(0,6).map(function(d){
    const target=new Date(d.date||d.targetDate||'');
    if(isNaN(target))return '';
    target.setHours(0,0,0,0);
    const diff=Math.round((target-now)/86400000);
    const color=diff<0?'#94a3b8':diff<=7?'#dc2626':diff<=30?'#f59e0b':'var(--cyan)';
    const label=diff===0?'D-DAY':(diff>0?'D-'+diff:'D+'+Math.abs(diff));
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;font-size:11px"><span style="color:var(--t1)">'+escHtml(d.title||d.text||'')+'</span><span style="font-weight:800;color:'+color+'">'+label+'</span></div>';
  }).filter(Boolean).join('')||_emptyMsg('D-Day 일정이 없습니다.');
}

function _wShopping(){
  let items=_getLSList('gp2_shopping');
  if(!items.length)items=_getLSList('ec_shopping');
  if(!items.length){
    return _emptyMsg('플래너의 구매 목록 위젯에서 물품을 추가하세요.');
  }
  const open=items.filter(function(i){return !i.done;});
  if(!open.length){
    return '<span style="color:#22c55e;font-weight:700">모두 구매 완료 ✅</span>';
  }
  return open.slice(0,6).map(function(i){
    return '<div style="margin-bottom:3px;font-size:11px">🛒 '+escHtml(i.text||i.title||'')+'</div>';
  }).join('');
}

/* ── 추가 보건 운영 위젯 ── */

function _wMedExpiry(){
  /* 약품 유효기간 임박 — localStorage 의 expiry 필드 확인 */
  let meds=[];
  try{
    const raw=localStorage.getItem('ec_medications')||localStorage.getItem('gp2_medications');
    if(raw){const p=JSON.parse(raw);if(Array.isArray(p))meds=p;}
  }catch(e){}
  if(!meds.length){
    return _emptyMsg('약품 데이터 없음. 보건일지 설정 → 약품 관리에서 등록하세요.');
  }
  const now=new Date();now.setHours(0,0,0,0);
  const limit=new Date(now);limit.setDate(now.getDate()+30);
  const items=[];
  meds.forEach(function(m){
    const exp=m.expiry||m.expiryDate||m.exp;
    if(!exp)return;
    const d=new Date(exp);
    if(isNaN(d))return;
    d.setHours(0,0,0,0);
    if(d<=limit){
      const days=Math.round((d-now)/86400000);
      items.push({name:m.name||m.title||'',date:exp,days:days});
    }
  });
  if(!items.length){
    return '<span style="color:#22c55e;font-weight:700">유효기간 임박 약품 없음 ☕</span>';
  }
  items.sort(function(a,b){return a.days-b.days;});
  return items.slice(0,5).map(function(it){
    const c=it.days<0?'#dc2626':it.days<=7?'#f59e0b':'#3b82f6';
    const label=it.days<0?'⚠ 만료 '+Math.abs(it.days)+'일':'D-'+it.days;
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;font-size:11px"><span>💊 '+escHtml(it.name)+'</span><span style="font-weight:800;color:'+c+';font-family:var(--fm)">'+label+'</span></div>';
  }).join('');
}

function _wDiaryApproval(){
  /* 결재 컬럼이 daily_records에 아직 없으니 기본 안내 */
  const recs=Array.isArray(S.records)?S.records:[];
  const dateMap={};
  recs.forEach(function(r){if(r.date)dateMap[r.date]=true;});
  const dates=Object.keys(dateMap).sort();
  if(!dates.length)return _emptyMsg('일지 기록 없음.');
  /* 결재 상태 컬럼이 없으므로, 최근 7일 중 비어있는 날짜 안내 */
  const recent=dates.slice(-7);
  return '<div style="font-size:11px;color:var(--t2);line-height:1.7">최근 일지 기록일: '+recent.length+'일</div>'
    +'<div style="font-size:9px;color:var(--t3);margin-top:6px">※ 결재 상태 추적은 차기 업데이트 예정</div>';
}

function _wTbStatus(){
  /* 잠복결핵 검사: tb_tests 테이블 정보. 메모리 캐시가 없으면 안내. */
  if(typeof S.tbTests==='undefined'||!Array.isArray(S.tbTests)){
    return _emptyMsg('잠복결핵 데이터를 불러오려면 인원 데이터 관리 → 잠복결핵 탭을 한 번 열어주세요.');
  }
  const tested=S.tbTests.filter(function(t){return t.date;}).length;
  const total=S.tbTests.length;
  if(!total)return _emptyMsg('잠복결핵 검사 대상이 없습니다.');
  const pct=Math.round(tested/total*100);
  return '<div style="font-size:11px;color:var(--t1)">검사 완료 <b style="color:var(--cyan);font-size:14px">'+tested+'</b> / '+total+'명</div>'
    +'<div style="margin-top:6px;height:6px;background:var(--bg2);border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:var(--cyan)"></div></div>'
    +'<div style="font-size:9px;color:var(--t3);margin-top:4px">진행률 '+pct+'%</div>';
}

function _wRentalDue(){
  /* 보건실 물품 대여 대장(ec_rental_records)과 직접 연동 */
  let records=[];
  try{
    const raw=localStorage.getItem('ec_rental_records');
    if(raw){const p=JSON.parse(raw);if(Array.isArray(p))records=p;}
  }catch(e){}
  if(!records.length)return _emptyMsg('대여 기록이 없습니다.');
  /* 미반납만 (returned=true 또는 returnedAt 있으면 반납 완료) */
  const unreturned=records.filter(function(r){
    if(!r||!r.item)return false;
    if(r.returned===true||r.returned==='Y'||r.done===true||r.done==='Y')return false;
    if(r.returnedAt||r.returnAt)return false;
    return true;
  });
  if(!unreturned.length){
    return '<div><span style="color:#22c55e;font-weight:700">미반납 물품 없음 ✅</span><div style="font-size:9px;color:var(--t3);margin-top:4px">총 대여 기록: '+records.length+'건</div>'+_rentalLedgerBtn()+'</div>';
  }
  const now=new Date();now.setHours(0,0,0,0);
  /* 반납예정일 파싱 + 정렬 */
  const items=unreturned.map(function(r){
    let days=null;
    const dueDateRaw=r.returnDate||r.returnDue||r.dueDate||'';
    if(dueDateRaw){
      const datePart=String(dueDateRaw).slice(0,10);
      const d=new Date(datePart+'T00:00:00');
      if(!isNaN(d)){d.setHours(0,0,0,0);days=Math.round((d-now)/86400000);}
    }
    /* 사람 표시: personId로 학생/교직원 조회 → 학년반·이름 */
    let who='';
    try{
      const s=r.personId?getStu(r.personId):null;
      if(s){
        if(s.grade&&(s.class_num||s.cls)){
          who=s.grade+'-'+(s.class_num||s.cls)+(s.student_num||s.num?(' '+(s.student_num||s.num)):'')+' '+(s.name||'');
        }else if(s.position){
          who=s.position+' '+(s.name||'');
        }else{
          who=s.name||'';
        }
      }else if(r.name){
        who=r.name;
      }
    }catch(e){if(r.name)who=r.name;}
    return {item:r.item,who:who.trim(),days:days,borrow:r.borrowDate||r.borrow||''};
  });
  items.sort(function(a,b){return (a.days===null?9999:a.days)-(b.days===null?9999:b.days);});
  let h='<div style="font-size:10px;color:var(--t3);margin-bottom:6px">미반납 <b style="color:#dc2626;font-size:13px;font-family:var(--fm)">'+unreturned.length+'</b>건 / 총 '+records.length+'건</div>';
  items.slice(0,5).forEach(function(it){
    let label='기한 미설정';let c='var(--t3)';
    if(it.days!==null){
      if(it.days<0){label='⚠ '+Math.abs(it.days)+'일 지남';c='#dc2626';}
      else if(it.days===0){label='오늘 반납';c='#f59e0b';}
      else if(it.days<=3){label='D-'+it.days;c='#f59e0b';}
      else{label='D-'+it.days;c='#3b82f6';}
    }
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;font-size:11px;gap:6px">'
      +'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">📦 '+escHtml(it.item)+(it.who?' <span style="color:var(--t3);font-size:9px">('+escHtml(it.who)+')</span>':'')+'</span>'
      +'<span style="font-weight:800;color:'+c+';font-family:var(--fm);flex-shrink:0">'+label+'</span>'
      +'</div>';
  });
  if(unreturned.length>5)h+='<div style="font-size:9px;color:var(--t3);margin-top:4px;text-align:center">… 외 '+(unreturned.length-5)+'건 더</div>';
  h+=_rentalLedgerBtn();
  return h;
}
/* 대여대장 바로가기 버튼 — 보건실 물품 대여 대장 열기 (사용자 요청 2026-06-17) */
function _rentalLedgerBtn(){
  return '<div style="margin-top:9px;text-align:center"><button data-action="open-rental-ledger" data-tooltip="보건실 물품 대여 대장으로 바로가서 처리합니다." data-tooltip-instant="1" style="font-size:10.5px;font-weight:700;padding:5px 13px;border:1px solid var(--cyan);border-radius:6px;background:rgba(6,182,212,0.08);color:var(--cyan);cursor:pointer;font-family:var(--f)">📦 대여대장</button></div>';
}

/* 🏫 학교 현황 위젯 — 버튼 클릭 시 팝업: 학교 정보(NEIS: 주소·전화·홈페이지·개교기념일) + 인원 통계 표(DB). (사용자 요청 2026-06-17) */
function _wSchoolStats(){
  const people=Array.isArray(S.people)?S.people:[];
  const students=people.filter(function(p){return p&&p.type!=='staff'&&p.grade!=null&&String(p.grade).trim()!=='';});
  const staff=people.filter(function(p){return p&&p.type==='staff';});
  const classes=new Set();
  students.forEach(function(p){const cls=String(p.cls!=null?p.cls:p.class_num||'').trim();if(cls)classes.add(JSON.stringify([p.school_level||'',String(p.grade).trim(),p.department||'',cls]));});
  const user=S._currentUser||{},settings=S.settings||{};
  const school=String(user.school_name||settings.schoolName||'우리 학교');
  let h='<div class="school-profile"><div class="school-profile-heading"><span class="school-profile-icon">'+_schoolWidgetIcon('school')+'</span><div><span>학교 현황</span><strong>'+escHtml(school)+'</strong></div></div><dl class="school-profile-metrics">';
  [['학생',students.length,'명'],['교직원',staff.length,'명'],['학급',classes.size,'개']].forEach(function(item){h+='<div><dt>'+item[0]+'</dt><dd>'+item[1].toLocaleString('ko-KR')+'<small>'+item[2]+'</small></dd></div>';});
  h+='</dl><p class="school-widget-note">현재 프로그램에 등록된 인원 기준이에요.</p><div class="school-widget-actions">'+_schoolWidgetButton('open-school-stats','학교 현황 자세히 보기',true)+'</div>';
  if(!neisKey()) h+='<div class="school-widget-connect-note"><span>'+_schoolWidgetIcon('api')+'학교 주소·연락처는 NEIS 연동이 필요해요.</span>'+_schoolWidgetButton('open-widget-api-settings','API 키 등록하기',true)+'</div>';
  return h+'</div>';
}
function _openSchoolStatsModal(){
  const old=document.getElementById('schoolStatsOv'); if(old)old.remove();
  /* ── 인원 통계 (DB 재학생) ── */
  const studs=(S.people||[]).filter(function(p){return p&&p.type!=='staff'&&p.grade!=null&&String(p.grade).trim()!=='';}).map(function(p){
    let g=p.gender; g=(g==='남'||g==='M'||g==='m')?'m':((g==='여'||g==='F'||g==='f')?'f':'u');
    return { grade:String(p.grade).trim(), dept:String(p.department||'').trim(), cls:String(p.cls!=null?p.cls:'').trim(), g:g };
  });
  const hasDept=studs.some(function(s){return s.dept;});
  const cnt=function(f){ let m=0,fm=0,u=0; studs.forEach(function(s){ if(f(s)){ if(s.g==='m')m++; else if(s.g==='f')fm++; else u++; } }); return {m:m,f:fm,sub:m+fm+u}; };
  const grades=Array.from(new Set(studs.map(function(s){return s.grade;}))).sort(function(a,b){return (parseInt(a)||0)-(parseInt(b)||0);});
  const struct=grades.map(function(g){
    const gs=studs.filter(function(s){return s.grade===g;});
    const depts=hasDept?Array.from(new Set(gs.map(function(s){return s.dept;}))).sort(function(a,b){return (a===''?1:(b===''?-1:String(a).localeCompare(String(b),'ko')));}):[''];
    return { grade:g, depts:depts.map(function(d){ const ds=gs.filter(function(s){return s.dept===d;}); const clss=Array.from(new Set(ds.map(function(s){return s.cls;}))).sort(compareClass); return {dept:d, clss:clss}; }) };
  });
  const bd='1px solid var(--bdr)';
  const _gcols=function(gr){ let n=0; gr.depts.forEach(function(d){ n+=Math.max(1,d.clss.length); }); return n+1; };  /* 반 수 + 학년소계 */
  /* 헤더 */
  let head='';
  if(hasDept){
    head+='<tr><th rowspan="3" style="position:sticky;left:0;z-index:2;background:var(--bg2);border:'+bd+';padding:6px 8px">구분</th>';
    struct.forEach(function(gr){ head+='<th colspan="'+_gcols(gr)+'" style="border:'+bd+';padding:5px 6px;background:var(--bg2);font-weight:800;color:var(--t1)">'+escHtml(gr.grade)+'학년</th>'; });
    head+='<th rowspan="3" style="border:'+bd+';padding:5px 8px;background:var(--bg2);font-weight:800;color:var(--cyan)">총계</th></tr>';
    head+='<tr>'; struct.forEach(function(gr){ gr.depts.forEach(function(d){ head+='<th colspan="'+Math.max(1,d.clss.length)+'" style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t2);font-weight:700">'+(d.dept?escHtml(d.dept):'-')+'</th>'; }); head+='<th rowspan="2" style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t2);font-weight:700">소계</th>'; }); head+='</tr>';
    head+='<tr>'; struct.forEach(function(gr){ gr.depts.forEach(function(d){ if(!d.clss.length){ head+='<th style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t3)">-</th>'; } d.clss.forEach(function(c){ head+='<th style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t3);width:52px;min-width:52px;max-width:52px">'+escHtml(c||'-')+'반</th>'; }); }); }); head+='</tr>';
  } else {
    head+='<tr><th rowspan="2" style="position:sticky;left:0;z-index:2;background:var(--bg2);border:'+bd+';padding:6px 8px">구분</th>';
    struct.forEach(function(gr){ head+='<th colspan="'+_gcols(gr)+'" style="border:'+bd+';padding:5px 6px;background:var(--bg2);font-weight:800;color:var(--t1)">'+escHtml(gr.grade)+'학년</th>'; });
    head+='<th rowspan="2" style="border:'+bd+';padding:5px 8px;background:var(--bg2);font-weight:800;color:var(--cyan)">총계</th></tr>';
    head+='<tr>'; struct.forEach(function(gr){ gr.depts[0].clss.forEach(function(c){ head+='<th style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t3);width:52px;min-width:52px;max-width:52px">'+escHtml(c||'-')+'반</th>'; }); if(!gr.depts[0].clss.length)head+='<th style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t3)">-</th>'; head+='<th style="border:'+bd+';padding:4px 5px;background:var(--bg2);color:var(--t2);font-weight:700">소계</th>'; }); head+='</tr>';
  }
  /* 본문 행: 남 / 녀 / 소계 */
  const rowDefs=[{k:'m',label:'남'},{k:'f',label:'녀'},{k:'sub',label:'소계'}];
  let body='';
  rowDefs.forEach(function(rd){
    const isSub=rd.k==='sub';
    body+='<tr><td style="position:sticky;left:0;z-index:1;background:var(--card);border:'+bd+';padding:5px 8px;font-weight:'+(isSub?'800':'700')+';color:'+(isSub?'var(--t1)':'var(--t2)')+'">'+rd.label+'</td>';
    struct.forEach(function(gr){
      gr.depts.forEach(function(d){
        const cells=d.clss.length?d.clss:[''];
        cells.forEach(function(c){ const v=cnt(function(s){return s.grade===gr.grade&&s.dept===d.dept&&s.cls===c;})[rd.k]; body+='<td style="border:'+bd+';padding:5px 6px;text-align:center;color:var(--t1);width:52px">'+v+'</td>'; });
      });
      const gv=cnt(function(s){return s.grade===gr.grade;})[rd.k]; body+='<td style="border:'+bd+';padding:5px 6px;text-align:center;font-weight:800;color:var(--t1);background:rgba(6,182,212,0.05)">'+gv+'</td>';
    });
    const tv=cnt(function(){return true;})[rd.k]; body+='<td style="border:'+bd+';padding:5px 8px;text-align:center;font-weight:800;color:var(--cyan);background:rgba(6,182,212,0.08)">'+tv+'</td>';
    body+='</tr>';
  });
  const total=cnt(function(){return true;});
  const ov=document.createElement('div');
  ov.id='schoolStatsOv';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13050;opacity:0;transition:opacity 0.15s ease';
  ov.innerHTML='<div id="schoolStatsBox" style="background:var(--card);border-radius:14px;width:max-content;min-width:420px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity 0.18s,transform 0.2s cubic-bezier(0.34,1.4,0.64,1)">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:rgba(6,182,212,0.10);display:flex;align-items:center;gap:8px"><span style="font-size:18px">🏫</span><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">학교 현황</div><div style="font-size:10.5px;color:var(--t3)">재학생 '+total.sub+'명</div></div></div>'
    +'<div id="schoolStatsInfo" style="padding:12px 20px;border-bottom:1px solid var(--bdr);font-size:11.5px;color:var(--t2);line-height:1.8">학교 정보 불러오는 중…</div>'
    +'<div style="padding:6px 20px 16px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--cyan) var(--bg2)">'
      +'<div style="font-size:11px;font-weight:800;color:var(--t1);margin:8px 0 6px">👥 학년·학과·반별 인원 (DB 재학생 기준)</div>'
      +'<table style="border-collapse:collapse;font-size:11px;table-layout:auto"><thead>'+head+'</thead><tbody>'+body+'</tbody></table>'
    +'</div></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('schoolStatsBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('schoolStatsBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.97)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },190); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  /* 학교 정보 — NEIS schoolInfo (주소·전화·홈페이지·개교기념일) */
  (async function(){
    const box=document.getElementById('schoolStatsInfo'); if(!box)return;
    if(!neisKey()){ box.innerHTML='<span style="color:var(--t3)">학교 정보: 나이스 인증키 미등록 (설정 → API 관리)</span>'; return; }
    try{
      const code=await resolveNeisCode();
      if(!code){ box.innerHTML='<span style="color:var(--t3)">학교 정보: 학교를 찾지 못했습니다</span>'; return; }
      const j=await neisFetchJson(NEIS_BASE+'/schoolInfo?KEY='+encodeURIComponent(neisKey())+'&Type=json&pSize=1&ATPT_OFCDC_SC_CODE='+encodeURIComponent(code.office)+'&SD_SCHUL_CODE='+encodeURIComponent(code.school));
      const row=j&&j.schoolInfo&&j.schoolInfo[1]&&j.schoolInfo[1].row&&j.schoolInfo[1].row[0];
      if(!row){ box.innerHTML='<span style="color:var(--t3)">학교 정보를 불러오지 못했습니다</span>'; return; }
      const addr=String(row.ORG_RDNMA||'').trim(), tel=String(row.ORG_TELNO||'').trim(), hp=String(row.HMPG_ADRES||'').trim();
      const fy=String(row.FOND_YMD||'').trim();
      const fyStr=/^\d{8}$/.test(fy)?(fy.slice(0,4)+'.'+fy.slice(4,6)+'.'+fy.slice(6,8)+'.'):'';
      let h='';
      h+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:4px">'+escHtml(String(row.SCHUL_NM||''))+'</div>';
      if(addr)h+='<div>📍 '+escHtml(addr)+'</div>';
      if(tel)h+='<div>📞 '+escHtml(tel)+'</div>';
      if(hp){ const url=/^https?:/.test(hp)?hp:('http://'+hp); h+='<div>🌐 <a href="'+escHtml(url)+'" target="_blank" style="color:var(--cyan);text-decoration:none">'+escHtml(hp)+'</a></div>'; }
      if(fyStr)h+='<div>🎂 개교기념일 '+escHtml(fyStr)+'</div>';
      box.innerHTML=h||'<span style="color:var(--t3)">학교 정보 없음</span>';
    }catch(_){ box.innerHTML='<span style="color:var(--t3)">학교 정보 조회 실패</span>'; }
  })();
}

function _wKiosk(){
  if(!S.kioskSettings||!S.kioskSettings.active)return '<span style="color:var(--t3)">키오스크 비활성</span>';
  const panel=document.getElementById('kioskSidePanel');
  if(panel){
    const dot=panel.querySelector('[data-kiosk-dot]');
    if(dot)return '<div>'+dot.outerHTML+' 키오스크 활성 중</div>';
  }
  return '<span style="color:var(--cyan);font-weight:700">키오스크 활성 중</span>';
}

/* ── 위젯 보관함 팝업 (플래너 GUI 동일) ── */
function _openWidgetPicker(){
  const existing=document.getElementById('widgetPickerOverlay');
  if(existing){_closeWidgetPicker(existing);return;}
  const selected=_getSelectedWidgets();
  const ov=document.createElement('div');ov.id='widgetPickerOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0);z-index:9700;display:flex;align-items:center;justify-content:center;transition:background .18s ease';
  let h='<div id="widgetPickerCard" style="background:var(--card);border-radius:14px;width:92vw;max-width:960px;max-height:85vh;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden;display:flex;flex-direction:column;opacity:0;transform:scale(0.96);transition:opacity .18s ease,transform .18s ease">';
  /* 헤더 */
  h+='<div style="background:rgba(6,182,212,0.10);padding:14px 20px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">';
  h+='<div><span style="font-size:15px;font-weight:800;color:var(--t1)">📦 위젯 보관함</span>';
  h+='<span style="font-size:10px;color:var(--t3);margin-left:10px">카드를 클릭하면 대시보드에 추가됩니다. 이미 배치된 것은 다시 클릭하여 제거할 수 있습니다.</span></div>';
  h+='<button data-action="picker-close" style="background:transparent;border:none;font-size:16px;color:var(--t3);cursor:pointer;padding:4px 8px">✕</button>';
  h+='</div>';
  /* 카드 그리드 */
  h+='<div style="padding:16px 20px;overflow-y:auto;flex:1">';
  h+='<div id="wpickGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">';
  WIDGETS.forEach(function(w){
    const placed=selected.indexOf(w.id)!==-1;
    const order=placed?selected.indexOf(w.id)+1:0;
    h+='<div data-wid="'+w.id+'" class="wpick-card" style="padding:12px 10px;background:var(--card);border:1.5px solid '+(placed?'var(--cyan)':'var(--bdr)')+';border-radius:10px;cursor:pointer;transition:all 0.15s;user-select:none;position:relative;text-align:center;'+(placed?'background:rgba(6,182,212,0.06)':'')+'">';
    if(placed)h+='<span style="position:absolute;top:6px;right:6px;font-size:9px;font-weight:800;color:#fff;background:var(--cyan);padding:2px 7px;border-radius:999px">'+order+'</span>';
    h+='<div style="font-size:26px;margin-bottom:6px;pointer-events:none">'+w.icon+'</div>';
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1);pointer-events:none;margin-bottom:2px">'+escHtml(w.title)+'</div>';
    h+='<div style="font-size:9px;color:var(--t3);pointer-events:none;line-height:1.4;min-height:24px">'+escHtml(w.desc||'')+'</div>';
    if(placed)h+='<div style="font-size:9px;color:var(--cyan);margin-top:4px;pointer-events:none;font-weight:700">✓ 배치됨</div>';
    h+='</div>';
  });
  h+='</div>';
  h+='</div>';
  /* 푸터 */
  h+='<div style="padding:10px 20px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">';
  h+='<div style="font-size:10px;color:var(--t3)">배치된 위젯: <b id="wpickCount" style="color:var(--cyan)">'+selected.length+'</b> / '+WIDGETS.length+'</div>';
  h+='<div style="display:flex;gap:6px">';
  h+='<button data-action="reset-widgets" style="padding:6px 14px;font-size:10px;font-weight:600;background:var(--card);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">기본값으로 초기화</button>';
  h+='<button data-action="picker-done" style="padding:6px 18px;font-size:10px;font-weight:700;background:var(--cyan);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">완료</button>';
  h+='</div></div>';
  h+='</div>';
  ov.innerHTML=h;
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_closeWidgetPicker(ov);});
  ov.addEventListener('click',function(e){
    const actEl=e.target.closest('[data-action]');
    if(actEl){
      const act=actEl.dataset.action;
      if(act==='picker-close'||act==='picker-done'){_closeWidgetPicker(ov);return;}
      if(act==='reset-widgets'){_resetWidgets();return;}
    }
    const card=e.target.closest('[data-wid]');
    if(card){
      const wid=card.dataset.wid;
      _toggleWidget(wid);
      /* 팝업 안에서 즉시 UI 갱신 */
      _refreshPickerCards();
    }
  });
  /* 카드 hover 효과 */
  ov.addEventListener('mouseenter',function(e){
    const card=e.target.closest('.wpick-card');
    if(card){card.style.transform='translateY(-2px)';card.style.boxShadow='0 6px 16px rgba(6,182,212,0.15)';}
  },true);
  ov.addEventListener('mouseleave',function(e){
    const card=e.target.closest('.wpick-card');
    if(card){card.style.transform='';card.style.boxShadow='';}
  },true);
  document.body.appendChild(ov);
  /* 열기 애니메이션 — 배경 페이드 + 카드 스케일 인. 새로 append 된 요소는 초기 상태(opacity:0)가
   *  먼저 커밋돼야 transition 이 발동한다. 단일 RAF 는 append 와 같은 프레임에 묶여 애니메이션이
   *  생략되는 경우가 있어, 강제 reflow(offsetHeight 읽기) 로 초기 상태를 커밋한 뒤 최종 상태로 전환. */
  const _wc=document.getElementById('widgetPickerCard');
  void ov.offsetHeight;
  ov.style.background='rgba(0,0,0,0.35)';
  if(_wc){ _wc.style.opacity='1'; _wc.style.transform='scale(1)'; }
}
/* 위젯 보관함 닫기 애니메이션 — 배경 페이드아웃 + 카드 스케일 아웃 후 제거 */
function _closeWidgetPicker(ov){
  ov = ov || document.getElementById('widgetPickerOverlay');
  if(!ov || ov._closing) return;
  ov._closing = true;
  ov.style.background='rgba(0,0,0,0)';
  const _c = ov.querySelector('#widgetPickerCard');
  if(_c){ _c.style.opacity='0'; _c.style.transform='scale(0.96)'; }
  setTimeout(function(){ if(ov.parentNode) ov.remove(); }, 180);
}

/* 위젯 토글 (카드 클릭 → 추가/제거) */
function _toggleWidget(wid){
  const selected=_getSelectedWidgets().slice();
  const idx=selected.indexOf(wid);
  if(idx>=0){selected.splice(idx,1);}
  else{selected.push(wid);}
  _saveSelectedWidgets(selected);
  /* 홈 캔버스 즉시 재렌더 */
  renderHomeDashboard();
}

/* 위젯 보관함 카드 그리드만 재렌더 (현재 레이아웃·스크롤 유지) */
function _refreshPickerCards(){
  const grid=document.getElementById('wpickGrid');
  const cntEl=document.getElementById('wpickCount');
  if(!grid)return;
  const selected=_getSelectedWidgets();
  let h='';
  WIDGETS.forEach(function(w){
    const placed=selected.indexOf(w.id)!==-1;
    const order=placed?selected.indexOf(w.id)+1:0;
    h+='<div data-wid="'+w.id+'" class="wpick-card" style="padding:12px 10px;background:var(--card);border:1.5px solid '+(placed?'var(--cyan)':'var(--bdr)')+';border-radius:10px;cursor:pointer;transition:all 0.15s;user-select:none;position:relative;text-align:center;'+(placed?'background:rgba(6,182,212,0.06)':'')+'">';
    if(placed)h+='<span style="position:absolute;top:6px;right:6px;font-size:9px;font-weight:800;color:#fff;background:var(--cyan);padding:2px 7px;border-radius:999px">'+order+'</span>';
    h+='<div style="font-size:26px;margin-bottom:6px;pointer-events:none">'+w.icon+'</div>';
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1);pointer-events:none;margin-bottom:2px">'+escHtml(w.title)+'</div>';
    h+='<div style="font-size:9px;color:var(--t3);pointer-events:none;line-height:1.4;min-height:24px">'+escHtml(w.desc||'')+'</div>';
    if(placed)h+='<div style="font-size:9px;color:var(--cyan);margin-top:4px;pointer-events:none;font-weight:700">✓ 배치됨</div>';
    h+='</div>';
  });
  grid.innerHTML=h;
  if(cntEl)cntEl.textContent=selected.length;
}

function _resetWidgets(){
  _saveSelectedWidgets(DEFAULT_WIDGETS);
  _refreshPickerCards();
  renderHomeDashboard();
}

/* ── 📝 포스트잇 메모 — localStorage 영구 저장 ──
   ec_home_memos: [{id, text, color, updatedAt}] */
const _HOME_MEMO_KEY='ec_home_memos';
const _HOME_MEMO_COLORS=['#fef3c7','#dbeafe','#fce7f3','#dcfce7','#ede9fe','#fed7aa'];
function _hmGet(){
  try{const raw=localStorage.getItem(_HOME_MEMO_KEY);if(raw){const a=JSON.parse(raw);if(Array.isArray(a))return a;}}catch(e){}
  /* 최초 로드: 기본 빈 포스트잇 3개 자동 생성 (앞으로도 꺼짐-켜짐 시 유지됨) */
  const seeded=[0,1,2].map(function(i){
    return {id:Date.now()+i,text:'',color:_HOME_MEMO_COLORS[i%_HOME_MEMO_COLORS.length],updatedAt:new Date().toISOString()};
  });
  try{localStorage.setItem(_HOME_MEMO_KEY,JSON.stringify(seeded));}catch(e){}
  return seeded;
}
function _hmSet(arr, source){
  try{localStorage.setItem(_HOME_MEMO_KEY,JSON.stringify(arr));}catch(e){}
  /* DB 동기화 (선택, 다른 접속자/기기 공유) */
  try{if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common',_HOME_MEMO_KEY,arr);}catch(e){}
  _homeSaveToast();
  /* 떠다니는 포스트잇(floating-postit.js) ↔ 홈 위젯 양방향 동기화.
   *  source 가 'home' 이면 홈이 직접 갱신했으므로 홈 핸들러는 skip, 떠다니는 쪽만 따라옴(반대도 동일). */
  try{ bus.emit('home:memos-changed', source||'home'); }catch(_){}
}
/* ── 포스트잇 DB 백업 복구 (2026-08-12) ──────────────────────────────────
 * ec_home_memos 는 localStorage 가 정본이고 _hmSet 이 DB(common)에도 백업을 써 왔지만,
 * 그 백업을 읽는 코드가 없었다(死藏). 캐시가 유실되면(프로필 손상 등) _hmGet 의 빈 3개 시드가
 * 자리를 차지해 사용자 메모가 증발한 것처럼 보였음(사용자 제보 2026-08-12).
 * 부팅 시 1회: 캐시에 실제 텍스트가 하나도 없을 때만 DB 백업에서 복구.
 * 실제 텍스트가 있는 캐시는 절대 덮지 않는다(사용자가 전부 비운 경우 DB 백업도 빈 상태라 복구 안 함). */
let _hmRestoreTried=false;
async function _hmRestoreFromDb(){
  if(_hmRestoreTried)return; _hmRestoreTried=true;
  try{
    if(!(window.electronAPI&&window.electronAPI.dbGet))return;
    const _hasText=function(a){return Array.isArray(a)&&a.some(function(m){return m&&typeof m.text==='string'&&m.text.trim();});};
    let ls=null;
    try{ls=JSON.parse(localStorage.getItem(_HOME_MEMO_KEY)||'null');}catch(e){}
    if(_hasText(ls))return;                       /* 캐시에 실데이터 있음 — 복구 불필요 */
    const res=await window.electronAPI.dbGet('common',_HOME_MEMO_KEY);
    const db=(res&&res.success)?(res.data!=null?res.data:res.value):null;
    if(!_hasText(db))return;                      /* 백업에도 실데이터 없음 */
    localStorage.setItem(_HOME_MEMO_KEY,JSON.stringify(db));
    console.log('[home-memo] DB 백업에서 포스트잇 '+db.length+'건 복구');
    try{ bus.emit('home:memos-changed','db-restore'); }catch(_){}
  }catch(e){console.error('[home-memo] DB 백업 복구 실패',e);}
}
_hmRestoreFromDb();
function _renderHomeMemos(){
  const items=_hmGet();
  if(!items.length){
    return _schoolEmpty('📝','기억할 내용을 적어두세요','위의 + 버튼으로 새 메모를 붙일 수 있어요.');
  }
  return items.map(function(m,i){
    const col=m.color||_HOME_MEMO_COLORS[i%_HOME_MEMO_COLORS.length];
    return '<div class="home-memo-card" data-memo-id="'+escHtml(String(m.id))+'" style="background:'+col+';border-radius:8px;padding:14px 14px 12px;box-shadow:0 1px 4px rgba(0,0,0,0.08);position:relative;border:1px solid rgba(0,0,0,0.05)">'
      +'<button data-action="del-memo" data-id="'+escHtml(String(m.id))+'" title="삭제" style="position:absolute;top:4px;right:4px;width:18px;height:18px;border:none;background:transparent;color:rgba(0,0,0,0.35);font-size:12px;cursor:pointer;font-weight:700;line-height:1;border-radius:3px">✕</button>'
      +'<div contenteditable="true" data-memo-edit="'+escHtml(String(m.id))+'" style="font-size:12px;color:#1f2937;line-height:1.7;outline:none;min-height:120px;padding-right:18px;white-space:pre-wrap;word-break:break-word">'+escHtml(m.text||'')+'</div>'
      +'</div>';
  }).join('');
}
function _homeAddMemo(){
  const items=_hmGet();
  const id=Date.now()+Math.floor(Math.random()*1000);
  items.unshift({id:id,text:'',color:_HOME_MEMO_COLORS[items.length%_HOME_MEMO_COLORS.length],updatedAt:new Date().toISOString()});
  _hmSet(items);
  /* 부분 갱신 */
  const list=document.getElementById('homeMemoList');
  if(list){list.innerHTML=_renderHomeMemos();_bindMemoEditors();
    /* 새 메모에 포커스 */
    const newEl=list.querySelector('[data-memo-edit="'+id+'"]');
    if(newEl){newEl.focus();}
  }
}
function _homeDelMemo(id){
  if(!id)return;
  const items=_hmGet().filter(function(m){return String(m.id)!==String(id);});
  _hmSet(items);
  const list=document.getElementById('homeMemoList');
  if(list){list.innerHTML=_renderHomeMemos();_bindMemoEditors();}
}
let _hmSaveTimers={};
function _bindMemoEditors(){
  const list=document.getElementById('homeMemoList');
  if(!list)return;
  list.querySelectorAll('[data-memo-edit]').forEach(function(el){
    if(el._memoBound)return;
    el._memoBound=true;
    el.addEventListener('input',function(){
      const id=el.dataset.memoEdit;
      if(_hmSaveTimers[id])clearTimeout(_hmSaveTimers[id]);
      _hmSaveTimers[id]=setTimeout(function(){
        const items=_hmGet();
        const m=items.find(function(x){return String(x.id)===String(id);});
        if(m){m.text=el.innerText;m.updatedAt=new Date().toISOString();_hmSet(items,'home');}
      },350);
    });
    /* 붙여넣기 위생화 — 서식 제거 */
    el.addEventListener('paste',function(e){
      e.preventDefault();
      const text=(e.clipboardData||window.clipboardData).getData('text');
      document.execCommand('insertText',false,text);
    });
  });
}
/* 직접 호출도 가능하도록 export */
window._bindMemoEditors=_bindMemoEditors;

/* 떠다니는 포스트잇이 낸 변경을 홈 위젯에 반영 (홈에서 낸 변경은 홈이 직접 갱신했으므로 skip) */
bus.on('home:memos-changed', function(source){
  if(source==='home')return;
  const list=document.getElementById('homeMemoList');
  if(list){ list.innerHTML=_renderHomeMemos(); _bindMemoEditors(); }
});

/* ── 떠다니는 포스트잇(floating-postit.js)과 데이터 공유용 export ── */
export function homeMemosGet(){ return _hmGet(); }
export function homeMemosSet(arr, source){ _hmSet(arr, source); }
export function homeMemoColors(){ return _HOME_MEMO_COLORS.slice(); }
/* 🏫 학교 현황 모달 — 배경 우클릭 메뉴 등 외부에서도 열 수 있도록 공개 */
export function openSchoolStatsModal(){ _openSchoolStatsModal(); }
export function openMyWeekModal(){ _openMyWeekModal(); }

