/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
import { getDailyRecord } from '../../core/daily-record-access.js';
/* ES Module */
import { getStu, escHtml, escJs, isBirthdayToday, getCareTooltipHtml, getStudentNameHoverHtml, toDateStr, dateObj, getDow, isHoliday, getSymClass, recsByDate, getRecordDates, getStuGradeCol, _recToDbRow, saveData, saveRecordNow, getDeptForSymptom, isKinder, createEmptyState, closeModalGracefully, getGuardianType, getGuardianContact, getStudentBirth, getCareMemoText, getLevelShort, hasMultipleSchoolLevels, counselTreatText, isCounselSymLabel, stuKeySet, recInStuKeys } from '../../core/helpers.js';
import { renderSettingsPanel } from '../settings/settings-view.js';
import { getPublicDataApiKey } from '../../core/public-data-settings.js';
import { openSymptomCategoryPopup, getCandidates, removeChip, formatMedicationDisplay, _symShowTip, _symHideTip, _symShowHistory } from '../symptom/symptom-view.js';
import { shouldShowTreatmentBySymptom } from '../../core/record-utils.js';
import { applyDailyColLayout, openBodyMap, ecSaveRecords, showHeaderTooltip, hideHeaderTooltip, migrateLegacyColWidths, sanitizeColWidths } from '../emergency/emergency-view.js';
import { switchView } from '../shell/view-router.js';
import { playQuickMenuSound } from '../../core/ui-utils.js';
import { S, monthNames, dayNames } from '../../core/app-state.js';
import { closeEmsPopup } from '../kiosk/ems-popup-view.js';
import { openTimePicker } from './diary-print-view.js';
import { tmSyncDailyMemo } from './today-memo.js';
import { isDailyPeriodSearchActive, closeDailyPeriodSearch, refreshDailyPeriodSearch } from './daily-period-view.js';
import { bus } from '../../core/event-bus.js';

let _nameHoverEl=null;
let _collabServerConnected=false;
let _lastRegisteredRecId=null;

/* v3 (사용자 결정 2026-05-21) — V/S 측정 칩의 값 부착 헬퍼.
 * 라벨 매핑: T·BP·P·R·SpO₂·BST. 의학 표준 순서. 입력 값만 콤마 join. */
function _vsValueStr(rec){
  if(!rec) return '';
  const parts = [];
  if(rec.temp) parts.push('T: ' + rec.temp);
  if(rec.bp) parts.push('BP: ' + rec.bp);
  if(rec.pulse) parts.push('P: ' + rec.pulse);
  const _resp = rec.respiration || rec.resp || '';
  if(_resp) parts.push('R: ' + _resp);
  if(rec.spo2) parts.push('SpO₂: ' + rec.spo2);
  if(rec.bst) parts.push('BST: ' + rec.bst);
  return parts.length ? '(' + parts.join(', ') + ')' : '';
}
function _closeSvOverlay(ov){if(ov)closeModalGracefully(ov);}

/* ═══════════════════════════════════════
   CALENDAR (persistent, Req 3-5)
   ═══════════════════════════════════════ */
export function renderCalendar(){
  const el = document.getElementById('mainCalendar');
  const year=S.calYear, month=S.calMonth;
  const first=new Date(year,month,1),last=new Date(year,month+1,0);
  const startDay=first.getDay(), daysInMonth=last.getDate();
  const prevLast=new Date(year,month,0).getDate();
  const recordDates=getRecordDates();
  const today=toDateStr(new Date());

  // Year popup — 올해 포함 최근 5개 연도 고정 (오늘 기준; 선택 연도에 따라 드리프트하지 않음)
  let yearPopup='<div class="mcal-popup">';
  { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++) yearPopup+=`<div class="mcal-popup-item${y===year?' active':''}" data-cal-year="${y}">${y}</div>`; }
  yearPopup+='</div>';
  // Month popup
  let monthPopup='<div class="mcal-popup" style="min-width:140px;display:none;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++) monthPopup+=`<div class="mcal-popup-item${m===month?' active':''}" data-cal-month="${m}" style="width:45px">${monthNames[m]}</div>`;
  monthPopup+='</div>';

  let html=`<div class="mcal-hdr">
    <div class="mcal-nav"><button class="mcal-btn" id="calPrevBtn">◂</button></div>
    <div class="mcal-title"><span class="mcal-year">${year}년${yearPopup}</span> <span class="mcal-month">${monthNames[month]}${monthPopup}</span></div>
    <div class="mcal-nav"><button class="mcal-btn" id="calNextBtn">▸</button></div>
  </div><div class="mcal-grid">`;

  ['일','월','화','수','목','금','토'].forEach((d,i)=>{
    let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
    html+=`<div class="${cls}">${d}</div>`;
  });
  for(let i=startDay-1;i>=0;i--) html+=`<div class="mcal-cell other"><span class="day-n">${prevLast-i}</span></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=toDateStr(new Date(year,month,d));
    const dow=new Date(year,month,d).getDay();
    const hol=isHoliday(ds);
    const cellIdx=startDay+(d-1);const weekRow=Math.floor(cellIdx/7);
    let cls='mcal-cell';if(weekRow===0)cls+=' week1';
    if(ds===today)cls+=' today';
    if(ds===S.selectedDate&&(S.currentView==='daily'||S.currentView==='story'))cls+=' selected';
    if(ds===S.selectedDate&&S.currentView==='dashboard')cls+=' dash-selected';
    if(dow===0)cls+=' sun';
    if(dow===6)cls+=' sat';
    const isWkend=dow===0||dow===6;
    if(hol&&!isWkend)cls+=' holiday';
    /* 토·일에도 방문자 등록이 있으면 점·카운트 표시 (키오스크·임시방문 등) */
    if(recordDates.has(ds))cls+=' has-dot';
    const cnt=recsByDate(ds).length;
    const tooltip=cnt>0?`<div class="mcal-tooltip">${cnt}명 방문</div>`:'';
    html+=`<div class="${cls}" data-cal-date="${ds}"><span class="day-n">${d}</span>${tooltip}</div>`;
  }
  const totalCells=startDay+daysInMonth;
  const rem=(7-totalCells%7)%7;
  for(let i=1;i<=rem;i++) html+=`<div class="mcal-cell other"><span class="day-n">${i}</span></div>`;
  html+='</div>';
  el.innerHTML=html;

  /* ── Calendar event listeners ── */
  const _calPrev=el.querySelector('#calPrevBtn');
  const _calNext=el.querySelector('#calNextBtn');
  if(_calPrev) _calPrev.addEventListener('click',function(){S.calMonth--;if(S.calMonth<0){S.calMonth=11;S.calYear--;}renderCalendar();});
  if(_calNext) _calNext.addEventListener('click',function(){S.calMonth++;if(S.calMonth>11){S.calMonth=0;S.calYear++;}renderCalendar();});
  el.querySelectorAll('[data-cal-year]').forEach(function(btn){
    btn.addEventListener('click',function(){S.calYear=parseInt(this.dataset.calYear);renderCalendar();});
  });
  el.querySelectorAll('[data-cal-month]').forEach(function(btn){
    btn.addEventListener('click',function(){S.calMonth=parseInt(this.dataset.calMonth);renderCalendar();});
  });
  el.querySelectorAll('[data-cal-date]').forEach(function(btn){
    btn.addEventListener('click',function(){selectDate(this.dataset.calDate);});
  });

  // Fix month popup display
  el.querySelectorAll('.mcal-month .mcal-popup').forEach(p=>{p.style.display='';p.style.flexWrap='wrap';p.style.gap='2px';});
  // 달력은 항상 표시
}

export function selectDate(d){
  closeDailyPeriodSearch(false);
  _lastRegisteredRecId=null;
  S.selectedDate=d;
  /* 달력에서 날짜를 선택하면 방향키(↑↓←→)로 날짜 이동 활성 — 모든 탭(일반/응급/감염/조사/교육/대시보드) 일관.
   * 빈 검색창 자동 포커스 중에도 유지되며, 다른 입력칸 포커스 시 focusin 핸들러가 해제. (2026-06-08) */
  _calFocusActive=true;
  renderCalendar();
  updateDailyDateLabel();
  /* ec/inf 탭이 활성이면 해당 날짜 방문자 드롭다운 표시 */
  const ecCat=document.getElementById('dailyCat-emergency');
  const infCat=document.getElementById('dailyCat-infection');
  if(S.currentView==='daily'&&ecCat&&ecCat.classList.contains('active')){
    _dailyAnimateTransition();_showDateVisitors(d,'ec');return;
  }
  if(S.currentView==='daily'&&infCat&&infCat.classList.contains('active')){
    _dailyAnimateTransition();_showDateVisitors(d,'inf');return;
  }
  const svCat=document.getElementById('dailyCat-survey');
  if(S.currentView==='daily'&&svCat&&svCat.classList.contains('active')){
    _dailyAnimateTransition();_showDateVisitors(d,'survey');return;
  }
  const trCat=document.getElementById('dailyCat-training');
  if(S.currentView==='daily'&&trCat&&trCat.classList.contains('active')){
    _dailyAnimateTransition();_showDateVisitors(d,'training');return;
  }
  if(S.currentView==='story'){
    _showDateVisitors(d,'story');
    return;
  }
  if(S.currentView==='dashboard'){
    if(S.statsPeriod==='today')bus.emit('render:dashboard');
    _showDateVisitors(d,'dashboard');
  } else if(S.currentView==='daily'){
    _dailyAnimateTransition();
    _focusDailySearch();
  } else {
    const dailyBtn=document.querySelector('.nav-link[data-view="daily"]');
    switchView('daily', dailyBtn);
    _focusDailySearch();
  }
  renderSidebarRecent();
}
/* 사이드바 날짜 클릭 시 일반일지 이름 검색란에 바로 포커스 — 커서 깜빡여 즉시 입력 가능. (사용자 요청 2026-06-04)
 * 일반 탭이 보일 때만(ec/inf/survey/training 등은 selectDate 위에서 이미 return). offsetParent 로 가시성 확인. */
function _focusDailySearch(){
  setTimeout(function(){
    const si=document.getElementById('dailySearchInput');
    if(si && si.offsetParent!==null){ try{ si.focus(); }catch(_e){} }
  },180);
}
/* 날짜 전환 시 테이블 fade 애니메이션 */
function _dailyAnimateTransition(){
  const body=document.getElementById('recBody');
  const wrap=document.getElementById('dailyTableWrap');
  const target=body||wrap;
  if(target){
    target.style.transition='opacity 0.12s ease';
    target.style.opacity='0';
    setTimeout(function(){
      renderDaily();
      target.style.opacity='1';
      setTimeout(function(){target.style.transition='';},150);
    },120);
  } else {
    renderDaily();
  }
}
let _calFocusActive=false;
document.addEventListener('keydown',function(e){
  if(!_calFocusActive)return;
  /* 입력칸 포커스 중이면 보통 양보. 단, 달력 날짜 클릭 시 자동 포커스되는 '빈' 검색창(dailySearchInput)에선
   * 방향키로 날짜 이동을 계속 허용 — 검색창에 글자를 입력하면(값 있음) 다시 캐럿 이동으로 양보. (2026-06-08) */
  const _ae=document.activeElement;
  if(_ae&&(_ae.tagName==='INPUT'||_ae.tagName==='TEXTAREA'||_ae.tagName==='SELECT'||_ae.isContentEditable)){
    const _isEmptyDailySearch=(_ae.id==='dailySearchInput' && !_ae.value);
    if(!_isEmptyDailySearch)return;
  }
  let delta=0;
  if(e.key==='ArrowLeft')delta=-1;
  else if(e.key==='ArrowRight')delta=1;
  else if(e.key==='ArrowUp')delta=-7;
  else if(e.key==='ArrowDown')delta=7;
  else return;
  e.preventDefault();
  const d=dateObj(S.selectedDate);
  d.setDate(d.getDate()+delta);
  /* 첫 주 위로 / 마지막 주 아래로 이동 시 표시 월 자동 전환 — S.calYear/calMonth 동기화 */
  const newYr=d.getFullYear(), newMo=d.getMonth();
  if(newYr!==S.calYear || newMo!==S.calMonth){
    S.calYear=newYr;
    S.calMonth=newMo;
  }
  selectDate(toDateStr(d));
});
/* 입력 필드 포커스 시 달력 키보드 비활성화.
 * 단, 검색창(dailySearchInput)은 달력 날짜 클릭 시 자동 포커스되므로 예외 — 빈 검색창에서 방향키 날짜이동을 유지. (2026-06-08) */
document.addEventListener('focusin',function(e){
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT')){
    if(t.id==='dailySearchInput')return;
    _calFocusActive=false;
  }
});

/* ── 달력 날짜 클릭 → 사이드바 달력 아래 방문자 드롭다운 ── */
function _showDateVisitors(dateStr,mode){
  _closeDateVisitors();
  const dayRecs=S.records.filter(function(r){return r.date===dateStr;}).sort(function(a,b){return a.timeIn.localeCompare(b.timeIn);});
  if(!dayRecs.length)return;
  const cal=document.getElementById('mainCalendar');
  const searchBox=document.getElementById('sidebarSearchBox');
  const searchResults=document.getElementById('sideSearchResults');
  if(!cal)return;
  const panel=document.createElement('div');
  /* 학교급 여러 개 혼재 시 학반 앞에 학교급(초/중/고/유) 접두어 표시 */
  const _multiLv = hasMultipleSchoolLevels();
  panel.className='date-visitors-panel';panel.id='dateVisitorsPanel';
  const dow=['일','월','화','수','목','금','토'][dateObj(dateStr).getDay()];
  let html='<div class="dv-header"><span>'+dateStr+' ('+dow+') 방문 '+dayRecs.length+'명</span><button class="dv-close-btn" style="border:none;background:none;color:var(--t3);cursor:pointer;font-size:14px;padding:0 4px">✕</button></div>';
  html+='<div class="dv-list">';
  dayRecs.forEach(function(r){
    const s=getStu(r.studentId);
    const isStf=s.type==='staff';
    const lvShort=(_multiLv&&!isStf)?(getLevelShort(s)||''):'';
    const lvPrefix=lvShort?'<span style="font-weight:700;color:var(--cyan);margin-right:3px">'+escHtml(lvShort)+'</span>':'';
    const classInfo=isStf?(s.position||'교직원'):(s.grade+'-'+s.cls+' '+s.num+'번');
    const symptoms=r.symptoms.join(', ')||'-';
    html+='<div class="dv-item" style="cursor:default">'
      +'<span class="dv-name">'+escHtml(s.name)+'</span>'
      +'<span class="dv-time" style="font-family:var(--fm);font-size:10px;color:var(--t3)">'+escHtml(r.timeIn)+'</span>'
      +'<span class="dv-info">'+lvPrefix+escHtml(classInfo)+'</span>'
      +'<span class="dv-sym">'+escHtml(symptoms)+'</span>'
      +'</div>';
  });
  html+='</div>';
  panel.innerHTML=html;
  const _dvCloseBtn=panel.querySelector('.dv-close-btn');
  if(_dvCloseBtn) _dvCloseBtn.addEventListener('click',function(){_closeDateVisitors();});
  /* 이름 검색창(+검색결과) 바로 아래에 삽입 */
  const anchor=searchResults||searchBox;
  if(anchor&&anchor.parentElement){
    if(anchor.nextSibling) anchor.parentElement.insertBefore(panel,anchor.nextSibling);
    else anchor.parentElement.appendChild(panel);
  } else {
    cal.parentElement.appendChild(panel);
  }
  const sidebar=panel.parentElement;
  /* 패널 아래 다른 요소만 숨김 (달력/검색창/검색결과는 건드리지 않음) */
  let afterPanel=false;
  Array.from(sidebar.children).forEach(function(ch){
    if(ch===panel){afterPanel=true;return;}
    if(afterPanel){ch._dvPrevDisplay=ch.style.display;ch.style.display='none';}
  });
  /* 패널 + 리스트 높이: 카드 + 검색창 + 하단 요소가 모두 footer 위에 보이도록 */
  setTimeout(function(){
    const footerEl=document.querySelector('footer');
    const footerTop=footerEl?footerEl.getBoundingClientRect().top:window.innerHeight;
    const panelTop=panel.getBoundingClientRect().top;
    /* 검색창과 그 아래 보이는 요소들의 높이 합산 */
    let belowH=0;
    let next=panel.nextElementSibling;
    while(next){
      if(next.style.display!=='none'&&next.offsetHeight>0) belowH+=next.offsetHeight+8;
      next=next.nextElementSibling;
    }
    let panelMaxH=footerTop-panelTop-belowH-12;
    if(panelMaxH<80)panelMaxH=80;
    panel.style.maxHeight=panelMaxH+'px';
    panel.style.overflow='hidden';
    const listEl=panel.querySelector('.dv-list');
    if(listEl){
      const headerEl=panel.querySelector('.dv-header');
      const headerH=headerEl?headerEl.offsetHeight:30;
      let listMaxH=panelMaxH-headerH-2;
      if(listMaxH<40)listMaxH=40;
      listEl.style.maxHeight=listMaxH+'px';
    }
  },10);
  setTimeout(function(){document.addEventListener('mousedown',_dvOutsideClick);},10);
}
function _dvOutsideClick(e){
  const panel=document.getElementById('dateVisitorsPanel');
  if(panel&&!panel.contains(e.target)&&!e.target.closest('.cal-day'))_closeDateVisitors();
}
export function _closeDateVisitors(){
  const panel=document.getElementById('dateVisitorsPanel');
  if(panel){
    const sidebar=panel.parentElement;
    /* 닫힘 애니메이션 — 페이드아웃 + 살짝 위로 collapse */
    panel.style.transformOrigin='top center';
    panel.style.transition='opacity .18s ease, transform .18s ease, max-height .22s ease, margin .18s ease';
    panel.style.opacity='0';
    panel.style.transform='scaleY(0.92) translateY(-4px)';
    panel.style.maxHeight='0px';
    panel.style.marginTop='0';
    panel.style.marginBottom='0';
    setTimeout(function(){
      /* 애니메이션 완료 후 실제 제거 + 숨겨둔 사이드바 요소 복원 */
      Array.from(sidebar.children).forEach(function(ch){
        if(ch._dvPrevDisplay!==undefined){ch.style.display=ch._dvPrevDisplay;delete ch._dvPrevDisplay;}
      });
      panel.remove();
    },220);
  }
  document.removeEventListener('mousedown',_dvOutsideClick);
}

/* ── 응급처치/감염병 리스트 이름 호버 → 방문 이력 표시
   사용자 요청: 호버 시 항상 자동으로 떠야 함. 락 상태와 무관하게 표시.
   ── 중복 호출 차단(_lastHoverStuId)은 패널이 보이는 동안에만 적용.
      패널이 숨겨졌다면 같은 학생을 호버해도 다시 표시 (외부 클릭으로 닫힌 후 재호버 케이스). ── */
let _lastHoverStuId=null;
function _onNameHover(e){
  const tr=e.target.closest('tr[data-stu-id]');
  if(!tr)return;
  const stuId=tr.dataset.stuId;
  /* 빈 문자열·"undefined"·"null" 문자열은 무효 (EC/INF 임포트 데이터에서 r.studentId 미설정 시 발생) */
  if(!stuId||stuId==='undefined'||stuId==='null')return;
  const _vhPanel=document.getElementById('sideVisitHistory');
  const _vhVisible=!!(_vhPanel && _vhPanel.classList.contains('vh-show'));
  /* 같은 학생 중복 호출 차단 — 단, 패널이 숨겨진 상태라면 재표시 허용 */
  if(stuId===_lastHoverStuId && _vhVisible)return;
  _lastHoverStuId=stuId;
  /* 달력 방문자 팝업이 열려 있으면 닫기 */
  if(document.getElementById('dateVisitorsPanel'))_closeDateVisitors();
  /* 클릭 잠금 상태일 때는 호버로 카드 내용을 바꾸지 않음 — 사용자 요청 2026-05-19:
     "특정 행이 선택되면 그 사람의 방문 이력이 고정되어 다른 사람 hover 해도 안 바뀌어야 한다."
     잠금 해제 (행 두 번 클릭 / 빈 영역 클릭 / 증상 팝업 닫힘 후) 상태에서만 호버가 카드를 갱신. */
  if(S._visitHistoryLocked)return;
  showVisitHistory(stuId);
}
function _onTbodyLeave(){
  _lastHoverStuId=null;
}
export function _bindNameHoverVisitHistory(){
  /* idempotent — 동일 tbody 에 중복 등록되지 않도록 _hoverBound 플래그로 가드.
     혹시 fragment 가 늦게 마운트되어 처음 호출 시 일부 element 가 없었더라도
     다음 호출에서 누락된 element 만 추가 등록 가능. */
  function _bindOne(el){
    if(!el || el._hoverBound)return;
    el._hoverBound=true;
    el.addEventListener('mouseover',_onNameHover);
    el.addEventListener('mouseleave',_onTbodyLeave);
  }
  _bindOne(document.getElementById('recBody'));
  _bindOne(document.getElementById('ecListBody'));
  _bindOne(document.getElementById('infListBody'));
}

function _initBounceScroll(){
  const targets=['#dailyTableWrap','.settings-panel','.sidebar','.visit-history-card','#trPreviewScroll','#trTargetBody','.modal-content','#storyTutorialGrid','#dpPreviewArea'];
  targets.forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(el){
      if(el._bounceInit)return;el._bounceInit=true;
      let bouncing=false;
      let lastScrollTop=el.scrollTop;
      let lastScrollLeft=el.scrollLeft;
      function _bounce(axis,dir){
        bouncing=true;
        const tf=(axis==='y')?('translateY('+(dir*18)+'px)'):('translateX('+(dir*18)+'px)');
        el.style.transition='transform 0.2s cubic-bezier(.2,.8,.4,1.4)';
        el.style.transform=tf;
        setTimeout(function(){
          el.style.transition='transform 0.35s cubic-bezier(.25,.1,.25,1)';
          el.style.transform=(axis==='y')?'translateY(0)':'translateX(0)';
          setTimeout(function(){el.style.transition='';bouncing=false;},350);
        },200);
      }
      el.addEventListener('scroll',function(){
        if(bouncing)return;
        /* 축별 변화 감지 — 변화 있는 축에만 바운스 (상호 간섭 방지). 가로 바운스 추가 (사용자 요청 2026-06-10) */
        const scrollTopChanged=Math.abs(el.scrollTop-lastScrollTop)>0;
        const scrollLeftChanged=Math.abs(el.scrollLeft-lastScrollLeft)>0;
        lastScrollTop=el.scrollTop;
        lastScrollLeft=el.scrollLeft;
        if(scrollTopChanged){
          const atBottom=el.scrollTop+el.clientHeight>=el.scrollHeight-2;
          const atTop=el.scrollTop<=0;
          if(atBottom||atTop)_bounce('y',atBottom?-1:1);
        } else if(scrollLeftChanged){
          const atRight=el.scrollLeft+el.clientWidth>=el.scrollWidth-2;
          const atLeft=el.scrollLeft<=0;
          if(atRight||atLeft)_bounce('x',atRight?-1:1);
        }
      });
    });
  });

  /* 가로 스크롤바는 네이티브(::-webkit-scrollbar) 한 개만 사용 — 호버 시 추가 생성하지 않음 */
  const wrap=document.getElementById('dailyTableWrap');
  if(wrap&&!wrap._hscrollInit){
    wrap._hscrollInit=true;
    /* 기존에 주입된 커스텀 썸 요소가 남아 있으면 제거 */
    const outer=document.getElementById('dailyTableOuter')||wrap.parentElement;
    if(outer){
      outer.querySelectorAll('.daily-hscrollbar-thumb').forEach(function(el){el.remove();});
    }
  }

  /* ── 툴바 영역 가로 스크롤바 초기화 ── */
  const toolbar=document.getElementById('dailyToolbarWrap');
  if(toolbar&&!toolbar._tbScrollInit){
    toolbar._tbScrollInit=true;
    const tbThumb=document.createElement('div');
    tbThumb.className='toolbar-hscrollbar-thumb';
    toolbar.appendChild(tbThumb);
    let tbHideTimer=null;let tbHovered=false;
    function showTbScroll(){ if(toolbar.scrollWidth<=toolbar.clientWidth+2){ tbThumb.style.opacity='0'; return; } tbThumb.style.opacity='1'; clearTimeout(tbHideTimer); if(!tbHovered)tbHideTimer=setTimeout(function(){ tbThumb.style.opacity='0'; },1200); }
    function updateTbThumb(){
      if(toolbar.scrollWidth<=toolbar.clientWidth+2){ tbThumb.style.opacity='0'; return; }
      const ratio=toolbar.clientWidth/toolbar.scrollWidth;
      const thumbW=Math.max(30,toolbar.clientWidth*ratio);
      const maxScroll=toolbar.scrollWidth-toolbar.clientWidth;
      const scrollRatio=maxScroll>0?toolbar.scrollLeft/maxScroll:0;
      const trackW=toolbar.clientWidth-8;
      const thumbLeft=4+scrollRatio*(trackW-thumbW);
      tbThumb.style.width=thumbW+'px';
      tbThumb.style.left=thumbLeft+'px';
    }
    toolbar.addEventListener('scroll',function(){ updateTbThumb(); showTbScroll(); });
    toolbar.addEventListener('mouseenter',function(){ tbHovered=true; updateTbThumb(); showTbScroll(); });
    toolbar.addEventListener('mousemove',function(){ showTbScroll(); });
    toolbar.addEventListener('mouseleave',function(){ tbHovered=false; clearTimeout(tbHideTimer); tbHideTimer=setTimeout(function(){ tbThumb.style.opacity='0'; },400); });

    /* 툴바 스크롤바 드래그 */
    let tbDragging=false, tbDragStartX=0, tbDragScrollStart=0;
    tbThumb.style.pointerEvents='auto';
    tbThumb.addEventListener('mousedown',function(e){
      tbDragging=true;tbDragStartX=e.clientX;tbDragScrollStart=toolbar.scrollLeft;
      e.preventDefault();
    });
    document.addEventListener('mousemove',function(e){
      if(!tbDragging)return;
      const trackW=toolbar.clientWidth-8;
      const thumbW=parseFloat(tbThumb.style.width)||30;
      const dx=e.clientX-tbDragStartX;
      const scrollRange=toolbar.scrollWidth-toolbar.clientWidth;
      const moveRatio=dx/(trackW-thumbW);
      toolbar.scrollLeft=tbDragScrollStart+moveRatio*scrollRange;
    });
    document.addEventListener('mouseup',function(){ tbDragging=false; });

    window.addEventListener('resize',function(){ updateTbThumb(); });
    setTimeout(updateTbThumb,500);
  }
}
setTimeout(_initBounceScroll,1000);
if(document.body){new MutationObserver(function(){setTimeout(_initBounceScroll,300);}).observe(document.body,{childList:true,subtree:true});}else{document.addEventListener('DOMContentLoaded',function(){new MutationObserver(function(){setTimeout(_initBounceScroll,300);}).observe(document.body,{childList:true,subtree:true});});}

/* 일반일지/응급처치/감염병 표 가로 스크롤 지원.
 * - Shift+휠 → deltaY 를 가로 스크롤로 변환
 * - 트랙패드 두 손가락 좌우 스와이프(|deltaX|>|deltaY|) → 가로 스크롤
 * 세 표 모두 동일한 동작이 필요하므로 _bindHScrollOnWheel 로 일원화. */
function _bindHScrollOnWheel(el){
  if(!el||el._hwheelBound)return;
  el._hwheelBound=true;
  el.addEventListener('wheel',function(e){
    if(e.shiftKey&&e.deltaY!==0){
      if(el.scrollWidth>el.clientWidth){
        e.preventDefault();
        el.scrollLeft+=e.deltaY;
      }
      return;
    }
    if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&e.deltaX!==0){
      if(el.scrollWidth>el.clientWidth){
        e.preventDefault();
        el.scrollLeft+=e.deltaX;
      }
    }
  },{passive:false});
}
function _initDailyWrapHScroll(){
  _bindHScrollOnWheel(document.getElementById('dailyTableWrap'));
  _bindHScrollOnWheel(document.getElementById('ecListCard'));
  _bindHScrollOnWheel(document.getElementById('infListCard'));
}
setTimeout(_initDailyWrapHScroll,500);
if(document.body){new MutationObserver(function(){_initDailyWrapHScroll();}).observe(document.body,{childList:true,subtree:true});}

/* ═══════════════════════════════════════
   SIDEBAR SEARCH (Req 6)
   ═══════════════════════════════════════ */
let _sideSearchIdx=-1;
/* 한글 초성/중성 매칭 헬퍼 — 이름 검색에 사용 */
const _CHOSUNG=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
/* Jamo 초성 블록(0x1100) → 호환 자모 블록(0x3131) 매핑 — macOS/일부 IME 대응 */
export const _JAMO_TO_COMPAT={0x1100:'ㄱ',0x1101:'ㄲ',0x1102:'ㄴ',0x1103:'ㄷ',0x1104:'ㄸ',0x1105:'ㄹ',0x1106:'ㅁ',0x1107:'ㅂ',0x1108:'ㅃ',0x1109:'ㅅ',0x110A:'ㅆ',0x110B:'ㅇ',0x110C:'ㅈ',0x110D:'ㅉ',0x110E:'ㅊ',0x110F:'ㅋ',0x1110:'ㅌ',0x1111:'ㅍ',0x1112:'ㅎ'};
export function _normalizeJamo(str){
  let r='';
  for(let i=0;i<str.length;i++){
    const c=str.charCodeAt(i);
    if(_JAMO_TO_COMPAT[c])r+=_JAMO_TO_COMPAT[c];
    else r+=str[i];
  }
  return r;
}
export function _getChosung(str){
  let r='';
  for(let i=0;i<str.length;i++){
    const c=str.charCodeAt(i);
    if(c>=0xAC00&&c<=0xD7A3){
      r+=_CHOSUNG[Math.floor((c-0xAC00)/588)];
    } else if(c>=0x3131&&c<=0x314E){
      r+=str[i];
    } else if(_JAMO_TO_COMPAT[c]){
      r+=_JAMO_TO_COMPAT[c];
    } else {
      r+=str[i];
    }
  }
  return r;
}
/* 초성만으로 이루어진 쿼리인지 판단 — 호환 자모(0x3131~0x314E) 및 Jamo(0x1100~0x1112) 모두 */
export function _isChosungQuery(q){
  if(!q)return false;
  for(let i=0;i<q.length;i++){
    const c=q.charCodeAt(i);
    const isCompat=(c>=0x3131&&c<=0x314E);
    const isJamo=!!_JAMO_TO_COMPAT[c];
    if(!isCompat&&!isJamo)return false;
  }
  return true;
}
/* 한글 조합형(NFC) + Jamo → 호환자모 정규화 — 저장된 이름과 쿼리의 코드포인트 차이 흡수 */
export function _normName(s){
  if(s==null)return '';
  let r=String(s);
  try{r=r.normalize('NFC');}catch(_){}
  return _normalizeJamo(r).toLowerCase().trim();
}
/* 이름에 쿼리가 포함되는지 — 일반 포함, 초성 포함, 초성만 쿼리 전부 지원 */
function _nameMatches(name,q){
  if(!name||!q)return false;
  const n=_normName(name);
  const qL=_normName(q);
  if(!qL)return false;
  if(n.indexOf(qL)>=0)return true;
  if(_isChosungQuery(qL)){
    const cho=_getChosung(n);
    if(cho.indexOf(qL)>=0)return true;
  }
  return false;
}

export function sidebarSearch(){
  _sideSearchIdx=-1;
  const qRaw=document.getElementById('sideSearch').value;
  const q=_normName(qRaw);
  const box=document.getElementById('sideSearchResults');
  _hideVisitHistory();
  if(!q){box.innerHTML='';return;}
  /* S.people 이 비었으면 DB에서 즉시 로드 시도 */
  if(!S.people||S.people.length===0){
    box.innerHTML='<div style="padding:8px;font-size:10.5px;color:var(--t3)">DB 로딩 중…</div>';
    if(window.electronAPI&&window.electronAPI.studentsGetAll){
      window.electronAPI.studentsGetAll().then(function(res){
        if(res&&res.success&&Array.isArray(res.data)){
          console.log('[검색] DB 에서 학생 '+res.data.length+'명 로드');
          const _b=function(v){if(!v)return '';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[1]+'.'+m[2]+'.'+m[3]+'.':String(v);};
          /* 버그 수정 2026-05-20: 학생 다시 로드 시 기존 S.people 의 staff 가 통째로 사라져
             "현재 재학 중인 정보가 없습니다" 가 나타나던 문제. staff 는 보존 후 학생만 갱신. */
          /* 데이터 손실 방지(2026-08-06): 이 지연 로드가 S.people 를 덮을 때 care/동의/vip 필드를 누락하면,
             이후 인원관리 저장에서 그 값을 못 읽어 요보호·미세먼지·비동의가 지워질 수 있음.
             메인 로더 _dbRowToStudent 와 동일하게 전 필드 매핑. */
          const _newStudents=res.data.map(function(r){return{uid:r.uid,id:r.uid,name:r.name,grade:r.grade,cls:r.class_num,num:r.student_num,gender:r.gender,birth:_b(r.birth_date),type:'student',level:r.level||'',department:r.department||'',guardianType:r.guardian_type||'',guardianContact:r.guardian_contact||'',homeroomTeacher:r.homeroom_teacher||'',status:r.is_care?'caution':'normal',condition:r.care_reason||'',careMemo:r.care_memo||'',dustDisease:r.dust_disease||'',medConsent:r.med_consent||'Y',emergencyConsent:r.emergency_consent||'Y',vip:r.vip||'',memoJson:r.memo_json||'{}',is_enrolled:r.is_enrolled};});
          const _existStaff=(S.people||[]).filter(function(p){return p && p.type==='staff';});
          S.people=_newStudents.concat(_existStaff);
          sidebarSearch();
        } else {box.innerHTML='<div style="padding:8px;color:#dc2626">DB 로드 실패</div>';}
      }).catch(function(e){box.innerHTML='<div style="padding:8px;color:#dc2626">DB 오류: '+escHtml(e.message||'')+'</div>';});
    }
    return;
  }
  /* 방문수 사전 계산 (2026-07-01 성능) — 정렬 비교자(_nameSort) 안에서 매 비교마다 S.records 전체를
   *  훑던 것을 1회 순회 맵으로 대체. O(N log N × M) → O(M + N log N). 결과·정렬순서 불변(값 동일). */
  const _visitCountMap={};
  (S.records||[]).forEach(function(r){ if(r&&r.studentId!=null) _visitCountMap[r.studentId]=(_visitCountMap[r.studentId]||0)+1; });
  const _visitCount=function(sid){return _visitCountMap[sid]||0;};
  /* 단순화: 이름 substring 포함 또는 초성(쿼리가 자음만일 때) 포함. 시작 일치 우선 정렬. */
  const isChosung=_isChosungQuery(q);
  const matched=S.people.filter(function(s){
    if(!s.name)return false;
    const n=_normName(s.name);
    if(n.indexOf(q)>=0)return true;
    if(isChosung&&_getChosung(n).indexOf(q)>=0)return true;
    return false;
  });
  console.log('[검색] q="'+qRaw+'" (정규화="'+q+'") | S.people='+S.people.length+'명 | 매칭='+matched.length+'명');
  function _nameSort(a,b){
    const na=_normName(a.name), nb=_normName(b.name);
    const aStart=na.indexOf(q)===0?0:1;
    const bStart=nb.indexOf(q)===0?0:1;
    if(aStart!==bStart)return aStart-bStart;
    const vc=_visitCount(b.id)-_visitCount(a.id);
    if(vc!==0)return vc;
    return (a.name||'').localeCompare(b.name||'','ko');
  }
  matched.sort(_nameSort);
  if(!matched.length){box.innerHTML='<div style="padding:8px;font-size:10.5px;color:var(--t3)">검색 결과 없음 · 입력 "'+escHtml(qRaw)+'" · DB 로드 '+S.people.length+'명</div>';return;}
  let html='<div style="padding:4px 8px;font-size:10px;color:var(--t3);border-bottom:1px solid var(--bdrl);background:var(--bg2);position:sticky;top:0;z-index:1">총 '+matched.length+'명'+(matched.length>20?' 중 상위 20명 · 이름을 더 입력하면 좁혀집니다':'')+'</div>';
  /* 범례 도트 4종 (요보호·미세먼지·응급처치비동의·일반의약품비동의) — 생년월일 제외.
     반·번호 정보 오른쪽에 작은 색점으로 표시. */
  function _sideDots(s){
    const colors=[];
    if(s.status==='caution') colors.push('#f97316');
    if(s.status==='watch')   colors.push('#eab308');
    if(s.emergencyConsent==='N') colors.push('#dc2626');
    if(s.medConsent==='N')       colors.push('#a855f7');
    if(!colors.length) return '';
    let h='<span style="display:inline-flex;gap:2px;margin-left:4px;align-items:center">';
    colors.forEach(function(c){ h+='<span title="범례" style="width:6px;height:6px;border-radius:50%;background:'+c+';box-shadow:0 0 3px '+c+'"></span>'; });
    h+='</span>';
    return h;
  }
  /* 상위 20명만 렌더 — 매칭 전원을 그리던 것을 제한(렌더 부담 감소, 2026-07-01). 더 있으면 이름 더 입력. */
  matched.slice(0,20).forEach(function(stu,i){
    const isStaff=stu.type==='staff';
    const info=isStaff
      ? '['+(stu.position||'교직원')+']'
      : '['+stu.grade+'학년'+stu.cls+'반'+stu.num+'번]';
    const dots = _sideDots(stu);
    html+=`<div class="search-result-item" data-side-idx="${i}" data-stu-id="${stu.id}" style="display:flex;justify-content:space-between;align-items:center;gap:4px">
      <span style="font-weight:700;font-size:11px;color:var(--t1);flex-shrink:0">${escHtml(stu.name)}</span>
      <span style="font-size:10px;color:var(--t3);display:inline-flex;align-items:center;justify-content:flex-end;flex:1;min-width:0">${info}${dots}</span>
    </div>`;
  });
  box.innerHTML=html;
  /* 결과 박스가 푸터 위쪽까지만 차지하도록 max-height 동적 계산 */
  try{
    const boxRect=box.getBoundingClientRect();
    const footer=document.querySelector('footer');
    const footerTop=footer?footer.getBoundingClientRect().top:window.innerHeight;
    const gap=8;
    const maxH=Math.max(120,Math.floor(footerTop-boxRect.top-gap));
    box.style.maxHeight=maxH+'px';
    box.style.overflowY='auto';
  }catch(_){}
  box.querySelectorAll('.search-result-item').forEach(function(el){
    el.addEventListener('click',function(){sideSelectStudent(this.dataset.stuId);});
    el.addEventListener('mouseenter',function(){_sideHoverItem(parseInt(this.dataset.sideIdx));});
  });
}
function _sideHighlightItem(){
  const items=document.querySelectorAll('#sideSearchResults .search-result-item');
  items.forEach(function(el,i){el.style.background=i===_sideSearchIdx?'var(--hover)':'';});
}
function _sideHoverItem(i){_sideSearchIdx=i;_sideHighlightItem();}

function sideSelectStudent(stuId){
  _sideSearchIdx=-1;
  document.getElementById('sideSearchResults').innerHTML='';
  const searchInput=document.getElementById('sideSearch');
  searchInput.value='';
  searchInput.blur();
  S.dailyLockedStudentId=null;S.dailySelectedRecId=null;
  document.querySelectorAll('#recBody tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
  showVisitHistory(stuId);
}
document.addEventListener('keydown',function(e){
  if(!e.target||e.target.id!=='sideSearch')return;
  const items=document.querySelectorAll('#sideSearchResults .search-result-item');
  if(!items.length)return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _sideSearchIdx=Math.min(_sideSearchIdx+1,items.length-1);
    _sideHighlightItem();
    items[_sideSearchIdx].scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _sideSearchIdx=Math.max(_sideSearchIdx-1,0);
    _sideHighlightItem();
    items[_sideSearchIdx].scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter'){
    e.preventDefault();
    const target=(_sideSearchIdx>=0&&items[_sideSearchIdx])?items[_sideSearchIdx]:items[0];
    if(target){
      const stuId=target.getAttribute('data-stu-id');
      if(stuId)sideSelectStudent(stuId);
    }
  } else if(e.key==='Escape'){
    e.preventDefault();
    document.getElementById('sideSearchResults').innerHTML='';
    const _si=document.getElementById('sideSearch');_si.value='';_si.blur();
    _hideVisitHistory();
  }
});

/* 방문 이력 닫기: ESC 키 또는 바깥 클릭 */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    const vh=document.getElementById('sideVisitHistory');
    if(vh&&vh.classList.contains('vh-show')){_hideVisitHistory();S.dailyLockedStudentId=null;}
  }
});
document.addEventListener('mousedown',function(e){
  /* 증상 팝업이 열려있는 동안에는 visitHistory 자동 해제 차단 — 팝업 안 모든 클릭(침상 칩 등) 으로
     사이드바 카드가 사라지지 않도록. 사용자 요청 2026-05-19. */
  if(document.getElementById('symCatOverlay'))return;
  const vh=document.getElementById('sideVisitHistory');
  if(!vh||!vh.classList.contains('vh-show'))return;
  if(vh.contains(e.target))return;
  /* 테이블 행 hover로 다시 열리는 것은 별도 — 여기서는 사이드바 검색 결과 선택 후 고정된 이력만 닫음 */
  if(e.target.closest('#recBody,#ecListBody,#infListBody'))return;
  /* 이름 클릭으로 뜨는 EMS 미니 메뉴(#emsMiniPopup) 와 그 호버 카드(#nameHoverFloat) 안 클릭도
     외부 클릭으로 보면 안 됨 — "증상 선택 및 처치 열기" 누를 때 mousedown 단계에서 vh-show 가
     제거되어 페이드 아웃 후 다시 페이드 인 되는 카드 깜빡임이 발생함. */
  if(e.target.closest('#emsMiniPopup,#nameHoverFloat'))return;
  _hideVisitHistory();
  S.dailyLockedStudentId=null;
});

/* ═══════════════════════════════════════
   SIDEBAR RECENT (Req 29)
   ═══════════════════════════════════════ */
export function renderSidebarRecent(){
  const dateRecs=S.records.filter(function(r){return r.date===S.selectedDate;}).sort(function(a,b){return a.timeIn.localeCompare(b.timeIn);});
  const titleEl=document.getElementById('sideRecentCard');
  if(titleEl){
    const titleDiv=titleEl.querySelector('div:first-child');
    if(titleDiv)titleDiv.textContent=dateRecs.length>0?(S.selectedDate+' 방문자 ('+dateRecs.length+'명)'):'최근 방문';
  }
  const list=dateRecs.length>0?dateRecs:[...S.records].sort(function(a,b){return b.date.localeCompare(a.date)||b.timeIn.localeCompare(a.timeIn);}).slice(0,8);
  document.getElementById('recentCompact').innerHTML=list.map(function(r){
    const s=getStu(r.studentId);
    const gradeInfo=s.type==='staff'?(s.position||'교직원'):(getStuGradeCol(s,{short:true})+' '+s.num+'번');
    const _sym0=r.symptoms&&r.symptoms.length?r.symptoms[0]:'-';
    return '<div class="compact-item"><span style="font-family:var(--fm);font-size:10px;color:var(--t3);width:36px;flex-shrink:0">'+r.timeIn+'</span><span style="font-weight:600">'+s.name+'</span><span style="font-size:9px;color:var(--t3);margin-left:2px">'+gradeInfo+'</span><span class="tag '+getSymClass(_sym0)+'" style="margin-left:auto;font-size:11px;flex-shrink:0">'+_sym0+'</span></div>';
  }).join('');
}

export function toggleSideCharts(){
  S.sideChartsOpen=!S.sideChartsOpen;
  document.getElementById('sideCharts').style.display=S.sideChartsOpen?'block':'none';
  document.getElementById('sideChartToggle').textContent=S.sideChartsOpen?'▲ 차트 접기':'▼ 통계 차트 보기';
  if(S.sideChartsOpen) renderSideCharts();
}

function renderSideCharts(){
  // Gender pie
  const genderCount={남:0,여:0,교직원:0};
  S.records.forEach(r=>{const s=getStu(r.studentId);if(s.type==='staff')genderCount['교직원']++;else{const _g2=s.gender==='M'?'남':s.gender==='F'?'여':s.gender||'남';genderCount[_g2]++;}});
  const total=Object.values(genderCount).reduce((a,b)=>a+b,0)||1;
  const gColors=['#3b82f6','#ec4899','#22c55e'];
  let gParts=[],gCum=0;
  Object.entries(genderCount).forEach(([k,v],i)=>{const p=v/total*100;gParts.push(`${gColors[i]} ${gCum.toFixed(1)}% ${(gCum+p).toFixed(1)}%`);gCum+=p;});
  document.getElementById('sideGenderPie').innerHTML=`<div style="display:flex;align-items:center;gap:10px"><div style="width:60px;height:60px;border-radius:50%;background:conic-gradient(${gParts.join(',')})"></div><div style="font-size:10px;color:var(--t2)">${Object.entries(genderCount).map(([k,v],i)=>`<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${gColors[i]};margin-right:4px"></span>${k} ${v}</div>`).join('')}<div style="margin-top:2px;font-weight:600;color:var(--t1)">합계 ${total}</div></div></div>`;
  // Dept bar
  const deptCount={};
  S.records.forEach(r=>{if(r.dept)deptCount[r.dept]=(deptCount[r.dept]||0)+1;});
  const deptEntries=Object.entries(deptCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxD=deptEntries[0]?deptEntries[0][1]:1;
  document.getElementById('sideDeptBar').innerHTML=deptEntries.map((e,i)=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:9px;color:var(--t3);width:55px;text-align:right;flex-shrink:0">${escHtml(e[0])}</span><div style="flex:1;height:14px;background:var(--bg2);border-radius:3px;overflow:hidden"><div style="width:${(e[1]/maxD*100).toFixed(0)}%;height:100%;background:${chartColors[i]};border-radius:3px"></div></div><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">${e[1]}</span></div>`).join('');
}

/* DASHBOARD → src/renderer/features/dashboard/dashboard-view.js */
/* ═══════════════════════════════════════
   DAILY RECORD (Req 26-28)
   ═══════════════════════════════════════ */
function updateDailyDateLabel(){
  const label=document.getElementById('dailyDateLabel');
  const btn=document.getElementById('btnNextDay');
  const today=toDateStr(new Date());
  /* 오늘의 메모 — 날짜 변경 시 그 날짜 칸으로 동기화 */
  try{ tmSyncDailyMemo(); }catch(_){}
  if(label){
    if(S.selectedDate===today){label.textContent='오늘의 보건일지';}
    else{label.textContent=S.selectedDate+' 보건일지';}
  }
  if(btn){
    const isToday=S.selectedDate>=today;
    btn.disabled=isToday;
    btn.style.opacity=isToday?'0.3':'1';
    btn.style.cursor=isToday?'default':'pointer';
  }
  /* 오늘 버튼 상태 */
  /* "오늘의 보건일지" 라벨: 오늘 날짜면 주황, 다른 날이면 녹색 */
  const _isToday=S.selectedDate===today;
  const _navBg=_isToday?'rgba(251,146,60,0.12)':'rgba(34,197,94,0.12)';
  const _navColor=_isToday?'#ea580c':'#16a34a';
  const _navBorder=_isToday?'rgba(251,146,60,0.35)':'rgba(34,197,94,0.3)';
  if(label){
    label.style.background=_isToday?'rgba(251,146,60,0.15)':'rgba(34,197,94,0.10)';
    label.style.color=_navColor;
    label.style.borderColor=_isToday?'rgba(251,146,60,0.4)':'rgba(34,197,94,0.25)';
  }
  const prevBtn=document.getElementById('btnPrevDay');
  if(prevBtn){prevBtn.style.background=_navBg;prevBtn.style.color=_navColor;prevBtn.style.borderColor=_navBorder;}
  const nextBtnEl=document.getElementById('btnNextDay');
  /* nextDay는 disabled 처리가 별도 있으므로 색상만 */
  if(nextBtnEl&&!nextBtnEl.disabled){nextBtnEl.style.background=_navBg;nextBtnEl.style.color=_navColor;nextBtnEl.style.borderColor=_navBorder;}
  const todayBtn=document.getElementById('btnToday');
  if(todayBtn){
    const isTodaySel=S.selectedDate===today;
    todayBtn.disabled=isTodaySel;
    todayBtn.style.opacity=isTodaySel?'0.5':'1';
    todayBtn.style.cursor=isTodaySel?'default':'pointer';
    todayBtn.style.background=isTodaySel?'rgba(148,163,184,0.12)':'rgba(34,197,94,0.12)';
    todayBtn.style.color=isTodaySel?'#94a3b8':'#16a34a';
    todayBtn.style.borderColor=isTodaySel?'rgba(148,163,184,0.3)':'rgba(34,197,94,0.3)';
  }
}
export function goToToday(){
  const wasPeriod=closeDailyPeriodSearch(false);
  const today=toDateStr(new Date());
  if(S.selectedDate===today){if(wasPeriod)renderDaily();return;}
  selectDate(today);
}
export function goToPrevDay(){
  closeDailyPeriodSearch(false);
  _lastRegisteredRecId=null;
  const d=dateObj(S.selectedDate);
  d.setDate(d.getDate()-1);
  S.selectedDate=toDateStr(d);
  updateDailyDateLabel();
  renderDaily();
  renderCalendar();
}
export function goToNextDay(){
  const wasPeriod=closeDailyPeriodSearch(false);
  _lastRegisteredRecId=null;
  const today=toDateStr(new Date());
  if(S.selectedDate>=today){if(wasPeriod)renderDaily();return;}
  const d=dateObj(S.selectedDate);
  d.setDate(d.getDate()+1);
  S.selectedDate=toDateStr(d);
  updateDailyDateLabel();
  renderDaily();
  renderCalendar();
}
/* S.dailySelectedRecId, S.dailyLockedStudentId → S 객체 사용 */
let _dragSelectedRecIds=[];
const _isMac=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
/* ── 삭제 Undo 스택 ── */
const _undoStack=[];/* [{records:[...], type:'single'|'bulk'}] */
function _undoPushDelete(deletedRecs){
  /* "삭제는 영구" — 삭제된 레코드에 _deleted 표시. 이후 늦게 도착한 saveRecordNow 가 재삽입하지 못하게 막는다.
   * (되돌리기 시 dailyUndoDelete 가 _deleted 를 해제하고 새로 INSERT 한다.) 2026-06-07 협업 동기화. */
  deletedRecs.forEach(function(r){ if(r) r._deleted=true; });
  _undoStack.push({records:deletedRecs.slice(),time:Date.now()});
  if(_undoStack.length>20)_undoStack.shift();/* 최대 20단계 */
}
function dailyUndoDelete(){
  if(!_undoStack.length){dailyShowToast('되돌릴 항목이 없습니다.');return;}
  const entry=_undoStack.pop();
  entry.records.forEach(function(rec){
    /* 되돌리기 = 삭제 취소 → _deleted 해제해 다시 저장 가능하게 */
    if(rec)rec._deleted=false;
    S.records.push(rec);
    /* DB에 다시 삽입 */
    if(window.electronAPI&&window.electronAPI.recordsDailyInsert){
      const row=_recToDbRow(rec);
      row.school_year=String(new Date().getMonth()>=2?new Date().getFullYear():new Date().getFullYear()-1);
      window.electronAPI.recordsDailyInsert(row).then(function(res){
        if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
        else if(res&&!res.success){console.error('[DB] undo insert 검증 실패:',res.error);dailyShowToast('⚠️ 되돌리기 실패: '+(res.error||''));}
      }).catch(function(err){console.error('[DB] undo insert 실패:',err);});
    }
  });
  renderDaily();renderCalendar();renderSidebarRecent();
  dailyShowToast(entry.records.length+'건의 삭제를 되돌렸습니다.');
}
document.addEventListener('keydown',function(e){
  /* 공통 — 입력 필드/편집 가능 요소 포커스 시 모두 스킵 (브라우저 기본 동작에 양보) */
  if(S.currentView!=='daily')return;
  const _general=document.getElementById('dailyCat-general');
  const _generalActive=!!(_general&&_general.classList.contains('active'));
  if(_generalActive&&isDailyPeriodSearchActive())return;
  const _ae=document.activeElement||{};
  const _aeTag=_ae.tagName;
  const _inInput=(_aeTag==='INPUT'||_aeTag==='TEXTAREA'||_aeTag==='SELECT'||(_ae.contentEditable==='true'));

  /* ⌘/Ctrl+Z — 삭제 취소 */
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){
    if(!_generalActive)return;
    /* V/S 팝업 떠 있을 때는 dailyUndoDelete 차단 (V/S 복구 핸들러가 처리) — input ID 가 recId 포함된 형식으로 바뀜에 따라 prefix 검색 */
    if(document.querySelector('[id^="vsTemp_"]'))return;
    if(_inInput)return;
    if(_undoStack.length){e.preventDefault();dailyUndoDelete();}
    return;
  }

  /* 일반일지/응급/감염 탭이 활성일 때만 동작하는 단축키들 */
  const _genEl=document.getElementById('dailyCat-general');
  const _emerEl=document.getElementById('dailyCat-emergency');
  const _infEl=document.getElementById('dailyCat-infection');
  let _activeCat=null;
  if(_genEl&&_genEl.classList.contains('active'))_activeCat='general';
  else if(_emerEl&&_emerEl.classList.contains('active'))_activeCat='emergency';
  else if(_infEl&&_infEl.classList.contains('active'))_activeCat='infection';
  if(!_activeCat)return;
  if(_inInput)return;
  /* 팝업·오버레이가 열려있으면 패스 */
  if(document.querySelector('.modal-overlay.show, .sv-modal-overlay, .ec-form-overlay.show, .ems-overlay.show, .vp-overlay.show, .qm-overlay.show, #bmOverlay, #symCatBox'))return;

  /* Delete/Backspace — 선택된 행 일괄 삭제 */
  if((e.key==='Delete'||e.key==='Backspace')&&_dragSelectedRecIds.length>0){
    e.preventDefault();
    if(_activeCat==='general')dailyBulkDelete();
    else if(_activeCat==='emergency')ecBulkDelete();
    else if(_activeCat==='infection')infBulkDelete();
    return;
  }
  /* Esc — 드래그 선택 해제 */
  if(e.key==='Escape'&&_dragSelectedRecIds.length>0){
    e.preventDefault();
    dailyClearDragSelect();
    return;
  }
  /* ⌘/Ctrl+A — 일반일지 탭에서만 전체 선택 (응급처치·감염병은 다중선택 비활성) */
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&_activeCat!=='emergency'&&_activeCat!=='infection'){
    e.preventDefault();
    const allRows=document.querySelectorAll('#recBody tr[data-rec-id]');
    _dragSelectedRecIds=[];
    allRows.forEach(function(r){r.classList.add('daily-drag-selected');_dragSelectedRecIds.push(parseInt(r.dataset.recId));});
    if(_dragSelectedRecIds.length>0&&typeof dailyShowToast==='function'){
      dailyShowToast(_dragSelectedRecIds.length+'건 전체 선택됨');
    }
    return;
  }
});
/* 협업 서버 연결 상태 — 보건실 다른 동료와 협업 탭에서 서버 연결 성공 시 true */
_collabServerConnected=false;
/* 날짜별 협업 기록 — 협업 중이었던 날짜를 저장 */
const _collabDates={'2026-03-20':true};
function _markCollabDate(dateStr){if(!_collabDates[dateStr]){_collabDates[dateStr]=true;}}
function _isCollabDate(dateStr){return !!_collabDates[dateStr];}
function _isMultiKey(e){return _isMac?e.metaKey:e.ctrlKey;}
const _dd={active:false,startX:0,startY:0,moved:false,box:null,popupOpen:false,lastClickIdx:-1};

/* 드래그 선택 중 자동 스크롤 — 마우스가 #dailyTableWrap 가장자리 근처에 닿으면
 * 컨테이너를 스크롤시켜 화면 밖의 행도 선택할 수 있도록 함. */
let _ddAutoScrollRaf=null;
let _ddLastMoveEvent=null;
const _DD_EDGE_PX=40;     /* 가장자리 감지 거리 (px) */
const _DD_SPEED_MAX=20;   /* 최대 스크롤 속도 (px/frame) */

function _ddReevaluateSelection(){
  const e=_ddLastMoveEvent; if(!e||!_dd.active) return;
  const dx=e.clientX-_dd.startX, dy=e.clientY-_dd.startY;
  const bx=Math.min(_dd.startX,e.clientX), by=Math.min(_dd.startY,e.clientY);
  const bw=Math.abs(dx), bh=Math.abs(dy);
  if(_dd.box){_dd.box.style.left=bx+'px';_dd.box.style.top=by+'px';_dd.box.style.width=bw+'px';_dd.box.style.height=bh+'px';}
  const _tbodyId=_dd._cat==='emergency'?'ecListBody':_dd._cat==='infection'?'infListBody':'recBody';
  const rows=document.querySelectorAll('#'+_tbodyId+' tr');
  /* 사용자 보고 2026-05-21: 22명 드래그했는데 20건만 카운트되는 버그 — 자동 스크롤로 첫 행이 viewport 위로 빠지면
   *  매 프레임 재평가 시 박스 밖이라 ID 배열에서 누락. 누적식으로 변경 — 박스에 한 번이라도 들어온 행은 유지.
   *  mousedown 시점에 dailyClearDragSelect() 가 _dragSelectedRecIds 와 daily-drag-selected 클래스를 초기화하므로 일관됨.
   *  (Windows 탐색기 동일 UX — 박스 그리는 도중 일부 행이 시야에서 사라져도 누적 선택 유지). */
  rows.forEach(function(r){
    const rect=r.getBoundingClientRect();
    const overlap=!(rect.bottom<by||rect.top>by+bh||rect.right<bx||rect.left>bx+bw);
    if(overlap){
      r.classList.add('daily-drag-selected');
      const rid=parseInt(r.dataset.recId);
      if(!isNaN(rid) && _dragSelectedRecIds.indexOf(rid)===-1){
        _dragSelectedRecIds.push(rid);
      }
    }
    /* 박스 밖 행은 daily-drag-selected 클래스도 제거하지 않음 — 누적 선택 시각화 유지 */
  });
  if(_dragSelectedRecIds.length>0){S.dailyLockedStudentId=null;_hideVisitHistory();}
}

function _ddAutoScrollTick(){
  _ddAutoScrollRaf=null;
  if(!_dd.active||!_ddLastMoveEvent)return;
  const wrap=document.getElementById('dailyTableWrap');
  if(!wrap)return;
  const rect=wrap.getBoundingClientRect();
  const e=_ddLastMoveEvent;
  let dir=0, dist=0;
  if(e.clientY<rect.top+_DD_EDGE_PX){dir=-1;dist=_DD_EDGE_PX-Math.max(0,e.clientY-rect.top);}
  else if(e.clientY>rect.bottom-_DD_EDGE_PX){dir=1;dist=_DD_EDGE_PX-Math.max(0,rect.bottom-e.clientY);}
  if(dir!==0){
    /* 가장자리에 가까울수록 빠르게 (4 ~ _DD_SPEED_MAX px/frame) */
    const speed=Math.max(4,Math.min(_DD_SPEED_MAX,Math.round(dist*0.5)));
    const before=wrap.scrollTop;
    wrap.scrollTop+=dir*speed;
    const delta=wrap.scrollTop-before;
    if(delta!==0){
      /* 핵심 fix (사용자 보고 2026-05-21): 자동 스크롤 시 _dd.startY 를 같은 양만큼 역방향 보정.
       *  행 rect 는 viewport 좌표 — 컨테이너가 위/아래로 스크롤되면 행도 함께 이동.
       *  startY 가 고정이면 박스가 viewport 의 한 영역에만 머물러서, 스크롤로 박스 영역 밖으로 빠진
       *  행은 overlap 검사에서 누락(예: 22명 드래그했는데 20건만 카운트). startY 를 스크롤만큼 역보정하면
       *  박스가 가상으로 컨테이너 전체를 덮어 빠짐 없이 잡힌다. */
      _dd.startY-=delta;
      _ddReevaluateSelection();
    }
    _ddAutoScrollRaf=requestAnimationFrame(_ddAutoScrollTick);
  }
}

function _ddMaybeStartAutoScroll(){
  if(_ddAutoScrollRaf!==null||!_dd.active||!_ddLastMoveEvent)return;
  const wrap=document.getElementById('dailyTableWrap');
  if(!wrap)return;
  const rect=wrap.getBoundingClientRect();
  const e=_ddLastMoveEvent;
  if(e.clientY<rect.top+_DD_EDGE_PX||e.clientY>rect.bottom-_DD_EDGE_PX){
    _ddAutoScrollRaf=requestAnimationFrame(_ddAutoScrollTick);
  }
}

function dailyInitDrag(){
  if(_dd._bindDone)return;
  _dd._bindDone=true;

  /* document 레벨 — 일반 일지 뷰 내부에서만 드래그 시작 */
  document.addEventListener('mousedown',function(e){
    /* view-daily 가 활성(보이는) 상태가 아니면 무시 — 다른 뷰의 텍스트 드래그 선택 방해 방지 */
    if(isDailyPeriodSearchActive())return;
    const dv=document.getElementById('view-daily');
    if(!dv||!dv.classList.contains('active'))return;
    /* 시작 위치 제한 없음 — 흰 영역(캔버스) 밖 어느 배경에서든 드래그 행 선택 시작 가능 (사용자 요청 2026-06-10).
     * 안전 가드: ① 일반일지 탭 활성일 때만(위/아래 가드) ② 아래 제외 목록(사이드바·헤더·footer·모달·입력 등)
     * ③ 스크롤바 영역 클릭은 제외 — preventDefault 가 네이티브 스크롤바 드래그를 죽이는 것 방지. */
    if(e.target instanceof Element){
      const _sbR=e.target.getBoundingClientRect();
      if(e.clientX > _sbR.left + e.target.clientWidth + 0.5 || e.clientY > _sbR.top + e.target.clientHeight + 0.5){
        if(e.target.clientWidth>0 || e.target.clientHeight>0) return;   /* 스크롤바 위 */
      }
    }
    /* 다중선택은 일반일지에서만 활성. 응급처치·감염병 리스트는 이동/팝업 불필요로
       다중선택 자체를 비활성화 (사용자 요청 — 단건 클릭으로 폼 열기 → 거기서 삭제). */
    let _ddCat=null;
    const gen=document.getElementById('dailyCat-general');
    if(gen&&gen.classList.contains('active'))_ddCat='general';
    if(!_ddCat)return;
    _dd._cat=_ddCat;
    /* 버튼/입력 등 인터랙티브 요소 위에서는 드래그 시작 안함 */
    if(e.target.closest('.cell-plus,.chip-x,.row-delete-x,.memo-plus,.ec-note-btn,.inf-note-btn,input,select,button,a,textarea,.tag,.flip-board,.autocomplete-wrap,.daily-ctx-popup,.sidebar,#headerBar,.modal-overlay,.sv-modal-overlay,.ec-form-overlay,.ems-overlay,.vp-overlay,.qm-overlay,#dailyTodayMemo,#tmGearPop,#kioskReceptionPanel,[contenteditable="true"],footer'))return;   /* #kioskReceptionPanel — 수신 패널 드래그가 행 선택으로 번지던 버그 (2026-06-12) */   /* footer·메모설정 팝오버 — 전역 시작 허용에 따른 안전망 (2026-06-10) */   /* 오늘의 메모(contenteditable) — preventDefault 가 캐럿을 막아 입력 불가 + 파란 선택박스 생기던 문제 fix (2026-06-10) */
    /* ── 일반 규칙: 떠 있는 UI(모달·팝업·토스트·패널 = position:fixed 조상 보유) 위에서는 행 선택 시작 금지 ──
     * 위 클래스 열거 방식은 새 모달이 생길 때마다 누락돼 "팝업 제목 드래그 → 행 선택" 버그가 반복 재발
     * (사용자 보고 2026-06-12: 여러 번 고쳐도 반복). fixed 조상 검사로 현재·미래의 모든 팝업을 자동 차단. */
    {
      let _n=(e.target instanceof Element)?e.target:null;
      let _onFloating=false;
      while(_n&&_n!==document.body&&_n!==document.documentElement){
        try{ if(getComputedStyle(_n).position==='fixed'){_onFloating=true;break;} }catch(_){break;}
        _n=_n.parentElement;
      }
      if(_onFloating)return;
    }
    if(e.button!==0)return;
    e.preventDefault();
    _dd.active=true;_dd.moved=false;
    _dd.startX=e.clientX;_dd.startY=e.clientY;
    /* Ctrl/Cmd/Shift 누른 상태면 기존 선택 유지 */
    if(!_isMultiKey(e)&&!e.shiftKey){
      dailyClearDragSelect();
      document.querySelectorAll('#recBody tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
    }
    /* 선택 박스 생성 */
    const box=document.createElement('div');box.className='daily-sel-box';
    box.style.left=e.clientX+'px';box.style.top=e.clientY+'px';
    box.style.width='0px';box.style.height='0px';
    document.body.appendChild(box);
    _dd.box=box;
  });

  document.addEventListener('mousemove',function(e){
    if(!_dd.active)return;
    const dx=e.clientX-_dd.startX, dy=e.clientY-_dd.startY;
    if(!_dd.moved&&(Math.abs(dx)>4||Math.abs(dy)>4))_dd.moved=true;
    if(!_dd.moved)return;
    /* 자동 스크롤용 마지막 이벤트 보관 — rAF tick 에서 사용 */
    _ddLastMoveEvent=e;
    /* 선택 박스 크기/위치 + 행 선택 갱신 (자동 스크롤 시에도 동일 로직을 재호출하므로 헬퍼로 분리) */
    _ddReevaluateSelection();
    /* 마우스가 컨테이너 가장자리 근처면 자동 스크롤 시작 (이미 돌고 있으면 무시) */
    _ddMaybeStartAutoScroll();
  });

  document.addEventListener('mouseup',function(e){
    if(!_dd.active)return;
    _dd.active=false;
    /* 자동 스크롤 rAF 정리 */
    if(_ddAutoScrollRaf!==null){cancelAnimationFrame(_ddAutoScrollRaf);_ddAutoScrollRaf=null;}
    _ddLastMoveEvent=null;
    /* 선택 박스 제거 */
    if(_dd.box){_dd.box.remove();_dd.box=null;}
    if(_dd.moved&&_dragSelectedRecIds.length>1){
      S.dailyLockedStudentId=null;
      _hideVisitHistory();
      _dd.popupOpen=true;
      dailyShowCtxPopup(e.clientX,e.clientY);
    } else if(_dd.moved&&_dragSelectedRecIds.length===1){
      /* 1행만 선택된 드래그 — 팝업 표시 */
      S.dailyLockedStudentId=null;
      _hideVisitHistory();
      _dd.popupOpen=true;
      dailyShowCtxPopup(e.clientX,e.clientY);
    } else if(_dd.moved&&_dragSelectedRecIds.length===0){
      /* 빈 영역 드래그 — 방문 이력 숨김 */
      S.dailyLockedStudentId=null;
      _hideVisitHistory();
    } else {
      /* 단일 클릭 — Ctrl/Cmd: 개별 토글, Shift: 범위 선택 */
      const _tbId=_dd._cat==='emergency'?'ecListBody':_dd._cat==='infection'?'infListBody':'recBody';
      let tr=document.elementFromPoint(e.clientX,e.clientY);
      if(tr)tr=tr.closest('#'+_tbId+' tr');
      if(!_isMultiKey(e)&&!e.shiftKey) dailyClearDragSelect();
      if(tr){
        const recId=parseInt(tr.dataset.recId);
        const stuId=tr.dataset.stuId;
        const rowIdx=Array.from(tr.parentElement.children).indexOf(tr);
        const rows=document.querySelectorAll('#'+_tbId+' tr');

        if(e.shiftKey&&_dd.lastClickIdx>=0){
          /* Shift+클릭: 마지막 클릭~현재 범위 선택 */
          const minI=Math.min(_dd.lastClickIdx,rowIdx), maxI=Math.max(_dd.lastClickIdx,rowIdx);
          _dragSelectedRecIds=[];
          rows.forEach(function(r,i){
            if(i>=minI&&i<=maxI){r.classList.add('daily-drag-selected');_dragSelectedRecIds.push(parseInt(r.dataset.recId));}
          });
          if(_dragSelectedRecIds.length>1){
            S.dailyLockedStudentId=null;
            _hideVisitHistory();
            _dd.popupOpen=true;dailyShowCtxPopup(e.clientX,e.clientY);
          }
        } else if(_isMultiKey(e)){
          /* Cmd(Mac)/Ctrl(Win)+클릭: 개별 토글 */
          const prevSel=document.querySelector('#'+_tbId+' tr.daily-selected');
          if(prevSel&&!prevSel.classList.contains('daily-drag-selected')){
            prevSel.classList.remove('daily-selected');
            prevSel.classList.add('daily-drag-selected');
            const prevId=parseInt(prevSel.dataset.recId);
            if(_dragSelectedRecIds.indexOf(prevId)===-1)_dragSelectedRecIds.push(prevId);
          }
          S.dailySelectedRecId=null;S.dailyLockedStudentId=null;
          if(tr.classList.contains('daily-drag-selected')){
            tr.classList.remove('daily-drag-selected');
            _dragSelectedRecIds=_dragSelectedRecIds.filter(function(id){return id!==recId;});
          } else {
            tr.classList.add('daily-drag-selected');
            _dragSelectedRecIds.push(recId);
          }
          _dd.lastClickIdx=rowIdx;
          if(_dragSelectedRecIds.length>1){
            _hideVisitHistory();
            _dd.popupOpen=true;dailyShowCtxPopup(e.clientX,e.clientY);
          }
        } else {
          /* 일반 클릭 */
          document.querySelectorAll('#'+_tbId+' tr.daily-drag-selected').forEach(function(r){r.classList.remove('daily-drag-selected');});
          _dragSelectedRecIds=[];
          if(S.dailySelectedRecId===recId){
            S.dailySelectedRecId=null;S.dailyLockedStudentId=null;
            document.querySelectorAll('#'+_tbId+' tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
            _dd.lastClickIdx=-1;
          } else {
            S.dailySelectedRecId=recId;
            S.dailyLockedStudentId=stuId||null;
            document.querySelectorAll('#'+_tbId+' tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
            tr.classList.add('daily-selected');
            _dd.lastClickIdx=rowIdx;
            S._visitHistoryLocked=false;
            if(S.dailyLockedStudentId)showVisitHistory(S.dailyLockedStudentId);
            S._visitHistoryLocked=true;
          }
        }
      }
    }
  });
}

function dailyShowCtxPopup(x,y){
  dailyCloseCtxPopup();
  try{ playQuickMenuSound(); }catch(_){}   /* 드래그 다중선택 팝업 효과음 (사용자 요청 2026-06-18) */
  const cat=_dd._cat||'general';
  const wrapId=cat==='emergency'?'ecListCard':cat==='infection'?'infListCard':'dailyTableWrap';
  let wrap=document.getElementById(wrapId);
  if(!wrap)wrap=document.body;
  const wr=wrap.getBoundingClientRect();
  const popup=document.createElement('div');popup.className='daily-ctx-popup';popup.id='dailyCtxPopup';
  let items='<div style="padding:8px 14px;border-bottom:1px solid var(--bdr)"><div style="font-size:12px;font-weight:800;color:var(--t1)">'+_dragSelectedRecIds.length+'건 선택됨</div><div style="font-size:9px;color:var(--t3);margin-top:2px">실수로 삭제/이동 시 Ctrl+Z로 되돌릴 수 있습니다.</div></div>';
  if(cat==='general'){
    items+='<div class="daily-ctx-item danger" data-ctx-action="dailyBulkDelete">🗑 선택한 방문자 기록 삭제</div>'
      +'<div class="daily-ctx-item" data-ctx-action="dailyBulkMove">📅 선택한 방문자 다른 날짜로 이동</div>';
  } else if(cat==='emergency'){
    items+='<div class="daily-ctx-item danger" data-ctx-action="ecBulkDelete">🗑 선택한 응급처치 기록 삭제</div>'
      +'<div class="daily-ctx-item" data-ctx-action="ecBulkMoveCalendar">📅 선택한 기록 다른 날짜로 이동</div>';
  } else if(cat==='infection'){
    items+='<div class="daily-ctx-item danger" data-ctx-action="infBulkDelete">🗑 선택한 감염병 기록 삭제</div>'
      +'<div class="daily-ctx-item" data-ctx-action="infBulkMoveCalendar">📅 선택한 기록 다른 날짜로 이동</div>';
  }
  popup.innerHTML=items;
  const _ctxActions={dailyBulkDelete:dailyBulkDelete,dailyBulkMove:dailyBulkMove,ecBulkDelete:ecBulkDelete,ecBulkMoveCalendar:ecBulkMoveCalendar,infBulkDelete:infBulkDelete,infBulkMoveCalendar:infBulkMoveCalendar};
  popup.querySelectorAll('[data-ctx-action]').forEach(function(el){
    el.addEventListener('click',function(){const fn=_ctxActions[this.dataset.ctxAction];if(fn)fn();});
  });
  document.body.appendChild(popup);
  const pr=popup.getBoundingClientRect();
  const px=Math.min(Math.max(x+8,wr.left),wr.right-pr.width);
  const py=Math.min(Math.max(y-40,wr.top),wr.bottom-pr.height);
  popup.style.left=px+'px';popup.style.top=py+'px';
  setTimeout(function(){document.addEventListener('click',_dailyCtxOutside);},10);
}
function _dailyCtxOutside(e){
  const popup=document.getElementById('dailyCtxPopup');
  if(popup&&!popup.contains(e.target)){dailyCloseCtxPopup();dailyClearDragSelect();}
}
export function dailyCloseCtxPopup(){
  _dd.popupOpen=false;
  const popup=document.getElementById('dailyCtxPopup');if(popup)popup.remove();
  document.removeEventListener('click',_dailyCtxOutside);
}
export function dailyClearDragSelect(){
  if(_dd.popupOpen)return;
  _dragSelectedRecIds=[];
  ['recBody','ecListBody','infListBody'].forEach(function(id){
    const tbody=document.getElementById(id);
    if(tbody)tbody.querySelectorAll('tr.daily-drag-selected').forEach(function(r){r.classList.remove('daily-drag-selected');});
  });
}

async function dailyBulkDelete(){
  dailyCloseCtxPopup();
  const ok=await _dailyConfirm('선택한 <b>'+_dragSelectedRecIds.length+'명</b>의 방문 기록을 삭제하시겠습니까?','방문 기록 삭제');
  if(!ok)return;
  const toDelete=S.records.filter(function(r){return _dragSelectedRecIds.indexOf(r.id)!==-1;});
  _undoPushDelete(toDelete);
  S.records=S.records.filter(function(r){return _dragSelectedRecIds.indexOf(r.id)===-1;});
  /* 이 기록들에 연결된 침상 이용 현황도 함께 삭제. 2026-06-10 */
  try{ const _bedIds=[]; toDelete.forEach(function(r){ _bedIds.push(r.id); if(r._dbId!=null)_bedIds.push(r._dbId); }); bus.emit('bed:recordsDeleted',{ids:_bedIds}); }catch(_){}
  if(window.electronAPI&&window.electronAPI.recordsDailyDelete){
    toDelete.forEach(function(r){
      const dbId=r._dbId||r.id;
      window.electronAPI.recordsDailyDelete(dbId).catch(function(err){console.error('[DB] daily delete 실패:',err);});
    });
  }
  dailyClearDragSelect();renderDaily();renderCalendar();renderSidebarRecent();
  dailyShowToast('삭제되었습니다.\n<span style="font-size:11px;font-weight:500;color:var(--t3)">('+(_isMac?'⌘':'Ctrl')+'+Z로 되돌릴 수 있습니다)</span>');
}

async function ecBulkDelete(){
  dailyCloseCtxPopup();
  const ok=await _dailyConfirm('선택한 <b>'+_dragSelectedRecIds.length+'건</b>의 응급처치 기록을 삭제하시겠습니까?','응급처치 기록 삭제');
  if(!ok)return;
  S.ecRecords=S.ecRecords.filter(function(r){return _dragSelectedRecIds.indexOf(r.id)===-1;});
  ecSaveRecords();
  dailyClearDragSelect();bus.emit('render:ecList');
}
async function infBulkDelete(){
  dailyCloseCtxPopup();
  const ok=await _dailyConfirm('선택한 <b>'+_dragSelectedRecIds.length+'건</b>의 감염병 기록을 삭제하시겠습니까?','감염병 기록 삭제');
  if(!ok)return;
  S.infRecords=S.infRecords.filter(function(r){return _dragSelectedRecIds.indexOf(r.id)===-1;});
  infSaveRecords();
  dailyClearDragSelect();bus.emit('render:infList');
}
function ecBulkMoveCalendar(){
  dailyCloseCtxPopup();
  _bulkMoveCalendar('ec');
}
function infBulkMoveCalendar(){
  dailyCloseCtxPopup();
  _bulkMoveCalendar('inf');
}
function _bulkMoveCalendar(type){
  const ov=document.createElement('div');ov.className='sv-modal-overlay';ov.id='bulkMoveOverlay';
  let yr=S.calYear, mo=S.calMonth;
  const monthNames=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  function renderMoveCal(){
    const first=new Date(yr,mo,1), last=new Date(yr,mo+1,0);
    const startDay=first.getDay(), dim=last.getDate(), prevLast=new Date(yr,mo,0).getDate();
    const today=toDateStr(new Date());
    let yp='<div class="mcal-popup">';
    { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++)yp+='<div class="mcal-popup-item'+(y===yr?' active':'')+'" data-dm-yr="'+y+'">'+y+'</div>'; }
    yp+='</div>';
    let mp='<div class="mcal-popup" style="min-width:140px;display:none;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
    for(let m=0;m<12;m++)mp+='<div class="mcal-popup-item'+(m===mo?' active':'')+'" data-dm-mo="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
    mp+='</div>';
    let h='<div style="background:var(--card);border-radius:12px;padding:20px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.4)">';
    h+='<div style="text-align:center;font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:10px">📅 이동할 날짜를 선택하세요</div>';
    h+='<div class="mcal-hdr" style="margin-bottom:8px">';
    h+='<div class="mcal-nav"><button class="mcal-btn" id="bmPrev">◂</button></div>';
    h+='<div class="mcal-title"><span class="mcal-year">'+yr+'년'+yp+'</span> <span class="mcal-month">'+monthNames[mo]+mp+'</span></div>';
    h+='<div class="mcal-nav"><button class="mcal-btn" id="bmNext">▸</button></div>';
    h+='</div>';
    h+='<div class="mcal-grid">';
    ['일','월','화','수','목','금','토'].forEach(function(d,i){
      let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
      h+='<div class="'+cls+'">'+d+'</div>';
    });
    for(let i=startDay-1;i>=0;i--)h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
    for(let d=1;d<=dim;d++){
      const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      const dow=new Date(yr,mo,d).getDay();
      const hol=isHoliday(ds);const holName=S.koreanHolidays[ds]||'';
      let cls='mcal-cell';
      if(ds===today)cls+=' today';
      if(dow===0)cls+=' sun';if(dow===6)cls+=' sat';
      if(hol&&dow!==0&&dow!==6)cls+=' holiday';
      h+='<div class="'+cls+'" data-move-date="'+ds+'"'+(holName?' title="'+holName+'"':'')+'><span class="day-n">'+d+'</span></div>';
    }
    const totalCells=startDay+dim;const rem=(7-totalCells%7)%7;
    for(let i=1;i<=rem;i++)h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
    h+='</div></div>';
    ov.innerHTML=h;
    ov.querySelectorAll('.mcal-month .mcal-popup').forEach(function(p){p.style.display='';p.style.flexWrap='wrap';p.style.gap='2px';});
    ov.querySelector('#bmPrev').addEventListener('click',function(e){e.stopPropagation();mo--;if(mo<0){mo=11;yr--;}renderMoveCal();});
    ov.querySelector('#bmNext').addEventListener('click',function(e){e.stopPropagation();mo++;if(mo>11){mo=0;yr++;}renderMoveCal();});
    ov.querySelectorAll('[data-dm-yr]').forEach(function(el){
      el.addEventListener('click',function(e){e.stopPropagation();yr=parseInt(this.dataset.dmYr);renderMoveCal();});
    });
    ov.querySelectorAll('[data-dm-mo]').forEach(function(el){
      el.addEventListener('click',function(e){e.stopPropagation();mo=parseInt(this.dataset.dmMo);renderMoveCal();});
    });
    ov.querySelectorAll('[data-move-date]').forEach(function(el){
      el.addEventListener('click',function(e){
        e.stopPropagation();
        const newDate=this.dataset.moveDate;
        if(type==='ec'){
          S.ecRecords.forEach(function(r){if(_dragSelectedRecIds.indexOf(r.id)!==-1)r.date=newDate;});
          ecSaveRecords();
          dailyClearDragSelect();bus.emit('render:ecList');
        } else {
          S.infRecords.forEach(function(r){if(_dragSelectedRecIds.indexOf(r.id)!==-1)r.date=newDate;});
          infSaveRecords();
          dailyClearDragSelect();bus.emit('render:infList');
        }
        _closeSvOverlay(ov);
        renderCalendar();renderSidebarRecent();
        dailyShowToast('해당 날짜로 이동하였습니다.');
      });
    });
  }
  renderMoveCal();
  ov.addEventListener('click',function(e){if(e.target===ov)_closeSvOverlay(ov);});
  document.body.appendChild(ov);
  requestAnimationFrame(function(){requestAnimationFrame(function(){ov.classList.add('show-anim');});});
}
function dailyBulkMove(){
  console.log('[date-move] dailyBulkMove 호출됨 — 선택된 기록 ID:',_dragSelectedRecIds);
  dailyCloseCtxPopup();
  const ov=document.createElement('div');ov.className='sv-modal-overlay';ov.id='dailyMoveOverlay';
  let yr=S.calYear, mo=S.calMonth;
  const monthNames=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  function renderMoveCal(){
    const first=new Date(yr,mo,1), last=new Date(yr,mo+1,0);
    const startDay=first.getDay(), dim=last.getDate(), prevLast=new Date(yr,mo,0).getDate();
    const today=toDateStr(new Date());

    /* 연도 팝업 — 올해 포함 최근 5개 연도 고정 */
    let yp='<div class="mcal-popup">';
    { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++)yp+='<div class="mcal-popup-item'+(y===yr?' active':'')+'" data-dm-yr="'+y+'">'+y+'</div>'; }
    yp+='</div>';
    /* 월 팝업 */
    let mp='<div class="mcal-popup" style="min-width:140px;display:none;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
    for(let m=0;m<12;m++)mp+='<div class="mcal-popup-item'+(m===mo?' active':'')+'" data-dm-mo="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
    mp+='</div>';

    let h='<div style="background:var(--card);border-radius:12px;padding:20px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.4)">';
    h+='<div style="text-align:center;font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:10px">📅 이동할 날짜를 선택하세요</div>';
    h+='<div class="mcal-hdr" style="margin-bottom:8px">';
    h+='<div class="mcal-nav"><button class="mcal-btn" id="dmPrev">◂</button></div>';
    h+='<div class="mcal-title"><span class="mcal-year">'+yr+'년'+yp+'</span> <span class="mcal-month">'+monthNames[mo]+mp+'</span></div>';
    h+='<div class="mcal-nav"><button class="mcal-btn" id="dmNext">▸</button></div>';
    h+='</div>';
    h+='<div class="mcal-grid">';
    ['일','월','화','수','목','금','토'].forEach(function(d,i){
      let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
      h+='<div class="'+cls+'">'+d+'</div>';
    });
    for(let i=startDay-1;i>=0;i--)h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
    for(let d=1;d<=dim;d++){
      const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      const dow=new Date(yr,mo,d).getDay();
      const hol=isHoliday(ds);
      const holName=S.koreanHolidays[ds]||'';
      let cls='mcal-cell';
      if(ds===today)cls+=' today';
      if(dow===0)cls+=' sun';
      if(dow===6)cls+=' sat';
      if(hol&&dow!==0&&dow!==6)cls+=' holiday';
      h+='<div class="'+cls+'" data-move-date="'+ds+'"'+(holName?' title="'+holName+'"':'')+'><span class="day-n">'+d+'</span></div>';
    }
    const totalCells=startDay+dim;const rem=(7-totalCells%7)%7;
    for(let i=1;i<=rem;i++)h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
    h+='</div></div>';
    ov.innerHTML=h;

    /* 월 팝업 display fix */
    ov.querySelectorAll('.mcal-month .mcal-popup').forEach(function(p){p.style.display='';p.style.flexWrap='wrap';p.style.gap='2px';});

    /* 이전/다음 */
    ov.querySelector('#dmPrev').addEventListener('click',function(e){e.stopPropagation();mo--;if(mo<0){mo=11;yr--;}renderMoveCal();});
    ov.querySelector('#dmNext').addEventListener('click',function(e){e.stopPropagation();mo++;if(mo>11){mo=0;yr++;}renderMoveCal();});
    /* 연도 팝업 클릭 */
    ov.querySelectorAll('[data-dm-yr]').forEach(function(el){
      el.addEventListener('click',function(e){e.stopPropagation();yr=parseInt(this.dataset.dmYr);renderMoveCal();});
    });
    /* 월 팝업 클릭 */
    ov.querySelectorAll('[data-dm-mo]').forEach(function(el){
      el.addEventListener('click',function(e){e.stopPropagation();mo=parseInt(this.dataset.dmMo);renderMoveCal();});
    });
    /* 날짜 클릭 → 이동 */
    ov.querySelectorAll('[data-move-date]').forEach(function(el){
      el.addEventListener('click',function(e){
        e.stopPropagation();
        const newDate=this.dataset.moveDate;
        console.log('[date-move] 날짜 클릭됨:',newDate,'선택된 rec IDs:',_dragSelectedRecIds);
        const movedRecs=[];
        _dragSelectedRecIds.forEach(function(rid){
          const rec=getDailyRecord(rid);
          console.log('[date-move] rid='+rid+' (type:'+typeof rid+') → rec found?',!!rec,rec?'id='+rec.id+' (type:'+typeof rec.id+')':'');
          if(rec){
            rec.date=newDate;
            rec._dirty=true;
            movedRecs.push(rec);
          }
        });
        console.log('[date-move] movedRecs count:',movedRecs.length);
        /* 직접 IPC 호출 — 모든 update Promise를 await하여 완료 보장 */
        if(window.electronAPI&&window.electronAPI.recordsDailyUpdate&&typeof _recToDbRow==='function'){
          const promises=movedRecs.map(function(rec){
            const row=_recToDbRow(rec);
            console.log('[date-move] DB UPDATE id='+row.id+' visit_date='+row.visit_date);
            return window.electronAPI.recordsDailyUpdate(row).then(function(res){
              if(res&&res.success){delete rec._dirty;console.log('[date-move] OK id='+row.id);}
              else console.error('[date-move] FAIL id='+row.id,res);
              return res;
            }).catch(function(err){
              console.error('[date-move] ERROR id='+row.id,err);
              return {success:false,error:err.message};
            });
          });
          Promise.all(promises).then(function(results){
            const okCount=results.filter(function(r){return r&&r.success;}).length;
            dailyShowToast(okCount+'건의 기록이 '+newDate+'로 이동·저장되었습니다.');
          });
        } else {
          /* 폴백 */
          if(typeof saveData==='function')saveData();
          dailyShowToast('해당 날짜로 이동하였습니다.');
        }
        dailyClearDragSelect();renderDaily();renderCalendar();renderSidebarRecent();
        _closeSvOverlay(ov);
      });
    });
  }
  renderMoveCal();
  ov.addEventListener('click',function(e){if(e.target===ov){_closeSvOverlay(ov);dailyClearDragSelect();}});
  document.body.appendChild(ov);
  requestAnimationFrame(function(){requestAnimationFrame(function(){ov.classList.add('show-anim');});});
}

/* openSaveFolder() 레거시 함수 제거됨 — 연도별 JSON 폴더 시절 잔존 코드.
   현재 모든 보건일지·응급·감염은 단일 SQLite 에 저장되어 연도별 폴더가 존재하지 않음. */
/* ═══ 협업 관련 함수 ═══ */
export function collabGenerateKey(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key='';for(let i=0;i<5;i++)key+=chars[Math.floor(Math.random()*chars.length)];
  document.getElementById('collabMyKey').value=key;
}
export function collabCopyKey(){
  const key=document.getElementById('collabMyKey').value;
  if(!key){dailyShowToast('연결 키를 먼저 생성하세요.');return;}
  navigator.clipboard.writeText(key).then(function(){dailyShowToast('연결 키가 클립보드에 복사되었습니다.');});
}
function _collabSetMode(mode){
  const cfg=JSON.parse(localStorage.getItem('collabConfig')||'{}');
  cfg._connMode=mode;
  localStorage.setItem('collabConfig',JSON.stringify(cfg));
  renderSettingsPanel('datasync');
}
function _collabAcceptPeer(){
  const cfg=JSON.parse(localStorage.getItem('collabConfig')||'{}');
  if(cfg._pendingPeer){
    cfg.peerName=cfg._pendingPeer.name;cfg.peerSchool=cfg._pendingPeer.school;
    delete cfg._pendingPeer;
    localStorage.setItem('collabConfig',JSON.stringify(cfg));
    dailyShowToast('협업 연결이 설정되었습니다.');
    renderSettingsPanel('datasync');
  }
}
function _collabRejectPeer(){
  const cfg=JSON.parse(localStorage.getItem('collabConfig')||'{}');
  delete cfg._pendingPeer;
  localStorage.setItem('collabConfig',JSON.stringify(cfg));
  dailyShowToast('연결 요청을 거절했습니다.');
  renderSettingsPanel('datasync');
}
function collabSaveAndConnect(){
  const eduOffice=document.getElementById('collabEduOffice').value;
  let mySchool=(document.getElementById('collabMySchool')||{}).value||'';
  mySchool=mySchool.trim();
  const myName=document.getElementById('collabMyName').value.trim();
  const myKey=document.getElementById('collabMyKey').value.trim();
  const peerName=document.getElementById('collabPeerName').value.trim();
  const peerKey=document.getElementById('collabPeerKey').value.trim();
  if(!eduOffice){dailyShowToast('소속 교육청을 선택하세요.');return;}
  if(!mySchool){dailyShowToast('소속 학교명을 입력하세요.');return;}
  if(!myName){dailyShowToast('이름을 입력하세요.');return;}
  if(!myKey||myKey.length!==5){dailyShowToast('내 연결키는 영문+숫자 5자리여야 합니다.');return;}
  if(!peerName){dailyShowToast('동료 이름을 입력하세요.');return;}
  if(!peerKey||peerKey.length!==5){dailyShowToast('동료 연결 키는 5자리여야 합니다.');return;}
  const cfg={eduOffice:eduOffice,mySchool:mySchool,myName:myName,myKey:myKey,peerName:peerName,peerKey:peerKey};
  S._collabConfig=cfg;
  /* 추후 실제 WebSocket 연결 구현 */
  _collabServerConnected=true;
  _markCollabDate(S.selectedDate);
  /* 동료를 _grantedUsers에 등록 */
  const granted=Array.isArray(S._grantedUsers)?S._grantedUsers:[];
  if(!granted.find(function(g){return g.name===peerName;})){
    granted.push({name:peerName,position:''});
    S._grantedUsers=granted;
  }
  renderDaily();
  switchSettingsCat('datasync',document.querySelector('[data-cat="datasync"]'));
  dailyShowToast('협업 연결이 설정되었습니다.');
}
function collabDisconnect(){
  if(!confirm('협업 연결을 해제하시겠습니까?'))return;
  _collabServerConnected=false;
  switchSettingsCat('datasync',document.querySelector('[data-cat="datasync"]'));
  renderDaily();
  dailyShowToast('협업 연결이 해제되었습니다.');
}

export function _showBlueToast(msg){
  const t=document.getElementById('globalSaveToast');
  if(!t)return;
  t.textContent=msg;
  const isLight=document.body.classList.contains('light');
  t.style.background=isLight?'rgba(6,182,212,0.12)':'rgba(6,182,212,0.2)';
  t.style.color=isLight?'#0891b2':'#22d3ee';
  t.style.borderColor=isLight?'rgba(6,182,212,0.28)':'rgba(6,182,212,0.45)';
  t.classList.add('show');t.classList.remove('saving');
  clearTimeout(globalSaveToastTimer);
  globalSaveToastTimer=setTimeout(function(){t.classList.remove('show');t.style.background='';t.style.color='';t.style.borderColor='';},3000);
}
/* macOS 스타일 토스트 — 빠른 연속 호출 시 우하단에 쌓임
 * 첫 토스트는 중앙에(기존 동작 유지), 다음 토스트들은 우하단 스택으로 */
/* 연속 중복/폭주 토스트 억제 — 1초 이내 동일 메시지 스킵 */
let _lastToastMsg='', _lastToastAt=0;
export function dailyShowToast(msg, _type, duration){
  const _dur = (typeof duration === 'number' && duration > 0) ? duration : 1500;
  const now=Date.now();
  if(msg===_lastToastMsg&&(now-_lastToastAt)<_dur)return;
  _lastToastMsg=msg;_lastToastAt=now;
  const _existing = document.getElementById('dailyActionToast');
  if(_existing){
    /* 이미 중앙 토스트가 뜬 상태면 새 토스트는 무시 (우하단 스택 팝콘 방지) */
    return;
  }
  const toast=document.createElement('div');toast.id='dailyActionToast';
  toast.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.92);opacity:0;background:var(--card);border:1px solid var(--cyan);border-radius:12px;padding:16px 28px;font-size:13px;font-weight:700;color:var(--t1);box-shadow:0 16px 48px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.06) inset;z-index:9999;text-align:center;line-height:1.6;transition:transform .22s cubic-bezier(0.34,1.32,0.64,1),opacity .18s ease';
  toast.innerHTML=msg.replace(/\n/g,'<br>');
  document.body.appendChild(toast);
  /* 스프링 애니메이션 */
  requestAnimationFrame(function(){
    toast.style.transform='translate(-50%,-50%) scale(1)';
    toast.style.opacity='1';
  });
  const _toastClick=function(){_fadeOutCenter(toast);document.removeEventListener('click',_toastClick);};
  setTimeout(function(){document.addEventListener('click',_toastClick);},50);
  /* duration 미지정 시 1500ms — 호출자가 짧게 띄우고 싶으면 emit 옵션의 duration 으로 단축 가능 (사용자 요청 2026-05-21). */
  setTimeout(function(){_fadeOutCenter(toast);document.removeEventListener('click',_toastClick);},_dur);
}

function _fadeOutCenter(toast){
  if(!toast||!toast.parentNode)return;
  toast.style.transform='translate(-50%,-50%) scale(0.92)';
  toast.style.opacity='0';
  setTimeout(function(){if(toast.parentNode)toast.remove();},200);
}

function _showStackedToast(msg){
  let cont = document.getElementById('toastStackContainer');
  if(!cont){
    cont = document.createElement('div');
    cont.id = 'toastStackContainer';
    cont.className = 'toast-stack-container';
    document.body.appendChild(cont);
  }
  const item = document.createElement('div');
  item.className = 'toast-stack-item';
  item.innerHTML = msg.replace(/\n/g,'<br>');
  cont.appendChild(item);
  requestAnimationFrame(function(){ item.classList.add('show'); });
  setTimeout(function(){
    item.classList.remove('show');
    item.classList.add('hide');
    setTimeout(function(){ if(item.parentNode)item.remove(); if(cont.children.length===0)cont.remove(); }, 320);
  }, 3500);
  /* 클릭으로 즉시 닫기 */
  item.addEventListener('click', function(){
    item.classList.remove('show');
    item.classList.add('hide');
    setTimeout(function(){ if(item.parentNode)item.remove(); if(cont.children.length===0)cont.remove(); }, 200);
  });
}
/* _showStackedToast — IIFE 내부 전용 */

/* 외부 클릭 시 락 해제 + 방문 이력 닫기 + 검색 초기화 */
document.addEventListener('click',function(e){
  /* 증상 팝업이 열려있는 동안에는 visitHistory 자동 해제 차단 — 팝업 내 칩 클릭(침상/V/S 등) 이
     일반 일지 외부 클릭으로 잘못 감지되어 사이드바가 사라지는 문제 방지. 사용자 요청 2026-05-19. */
  if(document.getElementById('symCatOverlay'))return;
  /* 방문 이력 락 해제: 일반일지·응급처치·감염병 표 + 사이드패널 외부 클릭 시 */
  if(!S.dailyLockedStudentId&&!S._visitHistoryLocked)return;
  const recBody=document.getElementById('recBody');
  const ecCard=document.getElementById('ecListCard');
  const infCard=document.getElementById('infListCard');
  const vhPanel=document.getElementById('sideVisitHistory');
  const inTable=(recBody&&recBody.contains(e.target))||(ecCard&&ecCard.contains(e.target))||(infCard&&infCard.contains(e.target));
  const inPanel=vhPanel&&vhPanel.contains(e.target);
  if(inTable||inPanel)return;
  S.dailySelectedRecId=null;S.dailyLockedStudentId=null;
  S._visitHistoryLocked=false;
  document.querySelectorAll('#recBody tr.daily-selected,#ecListBody tr.daily-selected,#infListBody tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
  if(typeof _hideVisitHistory==='function')_hideVisitHistory();
  /* 패널 닫힘 → 호버 dedup 캐시 리셋. 다음 호버 즉시 재표시되도록 보장 */
  _lastHoverStuId=null;
});
/* ── 프라이버시 모드 ── */
let _privacyOn=(localStorage.getItem('ec_privacy_mode')==='1');
export function isPrivacyOn(){return _privacyOn;}
function _applyPrivacyToRows(){
  const tbody=document.getElementById('recBody');
  if(!tbody)return;
  tbody.style.filter='';tbody.style.userSelect='';tbody.style.pointerEvents='';
  const rows=tbody.querySelectorAll('tr');
  rows.forEach(function(tr){
    if(_privacyOn){
      tr.style.filter='blur(3px)';tr.style.transition='filter 0.15s ease';
      tr.onmouseenter=function(){this.style.filter='none';};
      tr.onmouseleave=function(){this.style.filter='blur(3px)';};
    } else {
      tr.style.filter='';tr.style.transition='';
      tr.onmouseenter=null;tr.onmouseleave=null;
    }
  });
}
const _eyeOn='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"></path><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle></svg>';
const _eyeOff='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 20.5 20.5"></path><path d="M9.8 6.8A10.8 10.8 0 0 1 12 6.5c4 0 7.3 1.9 9.5 5a14.7 14.7 0 0 1-3.2 3.4"></path><path d="M6.2 9A14.8 14.8 0 0 0 2.5 12c2.2 3.1 5.5 5 9.5 5 1 0 1.9-.1 2.7-.4"></path></svg>';
export function togglePrivacyMode(forced){
  if(typeof forced==='boolean')_privacyOn=forced;
  else _privacyOn=!_privacyOn;
  try{localStorage.setItem('ec_privacy_mode',_privacyOn?'1':'0');}catch(e){}
  /* 설정 패널의 토글 상태도 동기화 */
  const setToggle=document.getElementById('setPrivacyModeToggle');
  if(setToggle)setToggle.checked=_privacyOn;
  _applyPrivacyToRows();
  if(isDailyPeriodSearchActive())refreshDailyPeriodSearch();
}
/* 페이지 로드 시 저장된 프라이버시 모드 적용 */
if(typeof document!=='undefined'){
  document.addEventListener('DOMContentLoaded',function(){
    if(_privacyOn)setTimeout(_applyPrivacyToRows,500);
  });
}
/* (Private 버튼은 설정 → 보건일지 설정으로 이전됨 — 정렬 불필요) */
function _alignMedFacBtn(){
  /* 의료기관 탐색 버튼 너비를 보건일지 출력 버튼 기준으로 맞추되, "탐색" 글자가 우측 테두리에 닿지 않도록 충분한 여백 추가 (사용자 요청 2026-05-19) */
  const printBtn=document.getElementById('dailyDiaryPrintBtn');
  const mfBtn=document.getElementById('medFacilityBtn');
  if(!printBtn||!mfBtn)return;
  const w=printBtn.getBoundingClientRect().width;
  if(w>40)mfBtn.style.width=Math.round(w)+24+'px';
}
setTimeout(function(){_alignMedFacBtn();},800);
window.addEventListener('resize',function(){setTimeout(function(){_alignMedFacBtn();},100);});

/* ── recBody event delegation ── */
export function bindDailyRecordActions(tbody,beforeAction){
  /* 중복 바인딩 방지 — renderDaily 마다 새 리스너 쌓이면 1번 클릭에 N번 실행됨 */
  if(tbody._recBodyBound)return;
  tbody._recBodyBound=true;
  /* 캡처 단계에서 row-delete-x 를 가장 먼저 처리 — 다른 핸들러가 가로채지 못하도록 */
  tbody.addEventListener('mousedown',function(e){
    const delBtn=e.target.closest('.row-delete-x');
    if(delBtn){e.stopPropagation();e.preventDefault();}
  },true);
  tbody.addEventListener('click',function(e){
    if(beforeAction && beforeAction(e)===false){e.stopPropagation();return;}
    /* 삭제 버튼 우선 처리 */
    const delBtn=e.target.closest('.row-delete-x');
    if(delBtn){
      e.stopPropagation();e.preventDefault();
      const rid=delBtn.dataset.rid?parseInt(delBtn.dataset.rid,10):null;
      if(rid!=null)dailyDeleteRecord(rid);
      return;
    }
    const el=e.target.closest('[data-action]');
    if(!el){
      /* 증상/처치 셀(col 6, 8) — 칩 아닌 빈 영역 클릭 시: 해당 행 선택 + 사이드 방문이력 고정 (사용자 요청 2026-05-24).
       *  · 칩(.treat-tag) 클릭은 위 data-action 분기에서 처리되므로 여기 안 옴.
       *  · 빈 영역 클릭만 행 선택 동작. */
      const td=e.target.closest('td[data-col-index="6"], td[data-col-index="8"]');
      if(td){
        const tr=td.closest('tr');
        if(tr){
          const stuId=tr.dataset.stuId;
          const recId=tr.dataset.recId?parseInt(tr.dataset.recId):null;
          if(beforeAction){if(recId)openSymptomCategoryPopup(recId);return;}
          /* 기존 선택 해제 + 이 row 만 선택 */
          document.querySelectorAll('#recBody tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
          tr.classList.add('daily-selected');
          if(recId)S.dailySelectedRecId=recId;
          /* 사이드 방문 이력 고정 표시 */
          if(stuId){
            S._visitHistoryLocked=false; /* 잠시 해제하여 showVisitHistory 통과 */
            S.dailyLockedStudentId=stuId;
            showVisitHistory(stuId);
            S._visitHistoryLocked=true;  /* 다시 잠금 — 호버 등으로 바뀌지 않게 */
          }
        }
      }
      return;
    }
    e.stopPropagation();
    const action=el.dataset.action;
    const rid=el.dataset.rid?parseInt(el.dataset.rid):null;
    const sid=el.dataset.sid||null;
    switch(action){
      case 'openCare':
        /* 요보호 칩 → 인원관리 모달 요보호 패널에서 해당 학생 편집폼 + 강조 애니메이션 (사용자 요청 2026-06-24).
         * 동적 import 로 순환참조 회피. (옛 openCareForStudent 는 daily-view 에 미import 라 무반응이었음) */
        import('../person-manager/person-manager-view.js').then(function(m){ if(m&&m.openCareEditForStudent) m.openCareEditForStudent(sid); }).catch(function(err){ console.error('[daily] 인원관리 모듈 로드 실패', err); });
        break;
      case 'openVipEdit': openVipEdit(sid,el); break;
      case 'vipClearAll': _vipClearAll(sid); break;
      case 'openBodyMap': openBodyMap(rid,el); break;
      case 'openSymptom': openSymptomCategoryPopup(rid); break;
      /* V/S·신체사정 표 클릭 → 증상 팝업 + 해당 입력 팝업 이어서 열기 (사용자 요청 2026-08-06) */
      case 'openSymptomVs': openSymptomCategoryPopup(rid,{autoOpen:'vs'}); break;
      case 'openSymptomPa': openSymptomCategoryPopup(rid,{autoOpen:'pa'}); break;
      case 'removeChip': removeChip(rid,el.dataset.field,el.dataset.val); break;
      case 'openCellEdit': openCellEdit(rid,el.dataset.field,el); break;
      case 'openTimePicker': openTimePicker(rid,el.dataset.field,el); break;
      case 'openVitalsEdit': openVitalsEdit(rid,el); break;
      /* 시간별 입력 칩 → 행 아래 시간대별 표 펼침 / 최소화 토글 (2026-06-15) */
      case 'vsTsExpand': _vsExpandedRids.add(String(rid)); bus.emit('render:daily'); break;
      case 'vsTsCollapse': _vsExpandedRids.delete(String(rid)); bus.emit('render:daily'); break;
      case 'vsOpenTimeseries': openVsTimeseries(rid); break;   /* '시간대 그래프' 칩 → 저장된 V/S 값 그래프 모달 */
      /* 처치 칸 V/S·신체사정 '자세히/간략히' 토글 — 기본 간략히(닫힘), 클릭 시 칩 아래 값 표 펼침/접음. (2026-07-21) */
      case 'vsToggleDetail': (_vsExpandedRids.has(String(rid))?_vsExpandedRids.delete(String(rid)):_vsExpandedRids.add(String(rid))); bus.emit('render:daily'); break;
      case 'paToggleDetail': (_paExpandedRids.has(String(rid))?_paExpandedRids.delete(String(rid)):_paExpandedRids.add(String(rid))); bus.emit('render:daily'); break;
      case 'toggleMemo': toggleMemo(sid,rid,el); break;
      case 'dailyDeleteRecord': dailyDeleteRecord(rid); break;
    }
  });
}

/* 페이지 로드(Ctrl+R/부팅) 후 일반일지 첫 진입 때만 안내 오버레이를 잠깐 띄우기 위한 플래그.
 *  오버레이는 표 위에 떠서(position:absolute) 빈화면+세로 스크롤 깜빡임을 0.7초 동안 덮는다. (2026-06-09) */
let _dailyEntryOverlayShown=false;
let _dailyOverlayHideTimer=null;
/* 일반일지 탭에 "들어오는 순간" view-router 가 호출 — 진입 안내 오버레이를 다시 0.7초 띄우도록 리셋.
 *  부팅 중 renderDaily 가 먼저 플래그를 소비해버려 진입 때 안 보이던 문제 해결(A안). (2026-06-09) */
export function _dailyResetEntryOverlay(){
  _dailyEntryOverlayShown=false;
  if(_dailyOverlayHideTimer){ clearTimeout(_dailyOverlayHideTimer); _dailyOverlayHideTimer=null; }
  const _ov=document.getElementById('dailyLoadingOverlay'); if(_ov)_ov.style.display='flex';
}
/* Both date and period views use exactly the same diary row markup and chips. */
export function renderDailyRecordRows(dayRecs,options={}){
  const _sl=S.settings.schoolLevel||'elementary';
  const _majorAbbrev=S.settings.majorAbbrev||{};
  /* 학교급 약칭 (특수학교용) */
  const _studentLevelAbbrev=function(s){return s.level||'';};
  return dayRecs.map((r,i)=>{
    r={...r, symptoms:Array.isArray(r.symptoms)?r.symptoms:[], treatment:Array.isArray(r.treatment)?r.treatment:[], treatmentBySym:r.treatmentBySym||{}};
    let s=getStu(r.studentId||r.personUid);
    if(options.period){s={...s,name:r.personName||s.name,type:r.personType||s.type,position:r.staffPosition||s.position||''};}
    if(options.period && Object.prototype.hasOwnProperty.call(r,'studentGrade')){
      s={...s,id:r.personUid||r.studentId,name:r.personName||s.name,type:r.personType||s.type,
        grade:r.studentGrade,cls:r.studentClass,num:r.studentNum,gender:r.studentGender||'',
        level:r.studentLevel||'',department:r.studentDepartment||'',position:r.staffPosition||s.position||''};
    }
    /* 명단 미등록 placeholder — person_uid IS NULL 인 가져오기 기록.
     *  fallback 학생 객체에 원본 엑셀 식별정보를 덧씌워 학년·반·번호·성별·학과·이름까지 보이고,
     *  _placeholder 플래그로 후속 흐름에서 매칭 처리/시각 구분 가능. 이름이 없을 때만 안내 문구로 대체. */
    if(r.isPlaceholder && r.unmatchedIdentity){
      const _id=r.unmatchedIdentity;
      const _idName=_id.name && String(_id.name).trim();
      s=Object.assign({},s,{
        name:_idName||'현재 등록된 정보가 없습니다.',
        grade:_id.grade||s.grade||'',
        cls:_id.class_num||s.cls||'',
        num:_id.student_num||s.num||'',
        gender:_id.gender||s.gender||'',
        type:_id.person_type||s.type||'student',
        level:_id.level||s.level||'',
        department:_id.department||s.department||'',
        position:_id.department||s.position||'',
        _placeholder:true,
      });
    }
    const isCare=(s.status==='caution'||s.status==='watch')&&!!(s.condition||(s.careMemo&&s.careMemo.trim&&s.careMemo.trim()));
    const isStaff=s.type==='staff';
    /* gradeCol: school-type aware */
    let gradeCol;
    if(isStaff){
      gradeCol=s.position||'교직원';
    } else if(_sl==='kindergarten'){
      gradeCol=s.grade?s.grade+'세':'-';
    } else {
      /* 특수학교 포함 — 학교급은 별도 컬럼에서 표시하고 학년반은 "1-1" 단순 형식으로 통일 */
      gradeCol=s.grade&&s.cls?s.grade+'-'+s.cls:(s.grade||'-');
    }
    /* 과 컬럼: 학과 있는 학생용 — 풀네임 표시 */
    let majorAbbr='';
    if((_sl==='high'||_sl==='special')&&!isStaff){
      majorAbbr=s.department||s.major||'';
    }
    /* V/S 표기: 라벨:값 공백 구분. 단위는 생략. 혈압은 그대로 "수축기/이완기" (사용자 요청 2026-05-19) */
    const vitals=(function(){
      /* v3 (사용자 결정 2026-05-21) — 한글 라벨 → 영문 약어 (T·BP·P·R·SpO₂·BST). 의학 표준 순서. */
      const _parts=[];
      if(r.temp) _parts.push('T: '+r.temp);
      if(r.bp) _parts.push('BP: '+r.bp);
      if(r.pulse) _parts.push('P: '+r.pulse);
      const _resp = r.respiration || r.resp || '';
      if(_resp) _parts.push('R: '+_resp);
      if(r.spo2) _parts.push('SpO₂: '+r.spo2);
      if(r.bst) _parts.push('BST: '+r.bst);
      return _parts.join(', ');
    })();
    const hasMemo=_memoHasAny(r.studentId)?'📌':'';
    const bday=isBirthdayToday(s);
    /* 번호/반 컬럼 */
    const numCol=isStaff?'-':(_sl==='kindergarten'?(s.cls||'-'):(s.num||'-'));
    /* === 다중 증상 분층 표시 판정 ===
     *  · 증상 2개 이상 + import 일지 아님 → 무조건 셀 내부를 점선으로 행 분리 (사용자 결정 2026-05-28).
     *  · 단, 옛 일지/외부 import(증상별 매핑 없이 평면 처치만 있는 레코드) 는 분기 시 처치가 사라지므로 단일 행 유지. */
    const _showLayered = shouldShowTreatmentBySymptom(r);
    /* 증상 칩 1개 렌더링 — 일반일지 표에서는 그 증상의 바디맵 부위+NRS 를 합쳐 표시한다.
     *  예: 저장값 "복통"(또는 "복통(자유기입)") + 바디맵 마커(우측 중앙복부, nrs 9) → "복통(우측 중앙복부 NRS: 9)".
     *  · 부위·NRS 는 바디맵 데이터에서, 자유기입 메모는 저장 라벨 괄호에서. (사용자 요청 2026-06-14) */
    const _dvBodyPartsForSym = (baseName) => {
      let arr=(window._bmData||{})[r.id];
      if((!arr||!arr.length)&&r.bodymapData&&r.bodymapData.length) arr=r.bodymapData;
      if(!arr||!arr.length) return [];
      const out=[],seen={};
      arr.forEach(function(m){ if(m&&m.symptom===baseName&&m.label){ const t=m.nrs?(m.label+' NRS: '+m.nrs):m.label; if(!seen[t]){seen[t]=1;out.push(t);} } });
      return out;
    };
    const _renderSymChip = (sym) => {
      const _base=String(sym).split('(')[0].trim();
      const _mm=String(sym).match(/\(([^)]*)\)\s*$/);
      const _memo=_mm?_mm[1].trim():'';
      const _parts=_dvBodyPartsForSym(_base);
      const _inside=[_parts.join(', '),_memo].filter(Boolean).join(', ');
      const _disp=_inside?(_base+'('+_inside+')'):_base;
      return `<span class="tag ${getSymClass(sym)}" style="cursor:pointer" data-action="openSymptom" data-rid="${r.id}" data-htip="${escHtml(_disp)}">${escHtml(_disp)}</span>`;
    };
    /* v3 — 특정 sym 의 약품 리스트를 "약명(도즈), 약명" 문자열로 직렬화 (사용자 결정 2026-05-21).
     * 없거나 비어 있으면 빈 문자열 → 옛 호환 r.medication 으로 폴백. */
    const _medStrForSym = (sym) => {
      if(!r.medsBySym || typeof r.medsBySym !== 'object') return '';
      const arr = r.medsBySym[sym];
      if(!Array.isArray(arr) || !arr.length) return '';
      const dm = (r.medDosesBySym && typeof r.medDosesBySym==='object' && r.medDosesBySym[sym]) || {};
      return arr.map(function(m){const d=dm[m]||''; return d?(m+'('+d+')'):m;}).join(', ');
    };
    /* 처치 칩 1개 렌더링.
     * v3 — sym 인자 받으면 그 sym 의 _medsBySym 약품 사용, 없으면 r.medication (옛 단일/legacy 호환). */
    const _renderTreatChip = (t, sym) => {
      /* 합성/단일 투약 칩("투약[약명 (용량)], 보건교육" 등) — 약명이 칩 텍스트에 이미 포함돼 있으므로
       *  medStr 을 덧붙이지 않고 그대로 렌더. (다중 증상 행에서 r.medication 합집합이 다른 증상 약품을
       *  잘못 덧붙이던 문제 방지. 옵션3 합성칩은 medsBySym 추출 없이 통째 저장됨. 2026-06-15) */
      const _isMedLiteral=t.indexOf('투약[')===0;
      const _isMedTreat=t==='투약'||t.indexOf('투약(')===0||_isMedLiteral||t==='연고 적용'||t==='파스 적용'||t==='인공눈물 적용';
      const _medStr = (sym ? _medStrForSym(sym) : '') || r.medication || '';
      const _medTip=(_isMedTreat&&!_isMedLiteral&&_medStr)?(' data-med-tip="'+escHtml(_medStr)+'"'):'';
      const _bedTip=(t==='침상 이용'||t==='침상안정')?' data-bed-tip="'+r.studentId+'"':'';
      const _label=_isMedLiteral?t:(t==='투약'&&_medStr?formatMedicationDisplay(_medStr):(_isMedTreat&&_medStr?(t+': '+_medStr):t));
      /* 'V/S 측정' 은 값을 칩에 붙이지 않는다 — 값은 처치 아래 인라인 표로 표시(2026-07-21). 칩 자체는 아래 전용 줄에서 별도 렌더. */
      return `<span class="treat-tag" style="cursor:pointer;position:relative" data-action="openSymptom" data-rid="${r.id}"${_medTip}${_bedTip} data-htip="${escHtml(_label)}">${escHtml(_label)}</span>`;
    };
    /* 증상·처치 셀 내부 HTML 미리 계산.
     *  V/S·신체사정 = 처치 칸 전용 줄 + '자세히/간략히' 토글. 기본 간략히(표 숨김), '자세히' 클릭 시 그 칩 바로
     *  아래에 값 표를 펼침. 칩 표시는 '값 존재' 기준(옛/import 호환). '📈 시간대 그래프' 는 저장된 V/S 값 그래프.
     *  (사용자 요청 2026-07-21) */
    let _symCellInner, _treatCellInner;
    const _hasVsData=!!((r.vsHistory&&r.vsHistory.length)||r.temp||r.bp||r.pulse||r.resp||r.respiration||r.spo2||r.bst);
    const _hasPaData=(function(){
      const pa=r&&r.physicalAssessment;
      if(!pa||typeof pa!=='object'||Array.isArray(pa))return false;
      const _it=Array.isArray(pa.items)?pa.items:[];
      const _dt=(pa.details&&typeof pa.details==='object'&&!Array.isArray(pa.details))?pa.details:{};
      return ['시진','촉진','타진','청진'].some(function(x){return _it.indexOf(x)!==-1||(_dt[x]&&String(_dt[x]).trim());});
    })();
    const _vsOpen=_vsExpandedRids.has(String(r.id));
    const _paOpen=_paExpandedRids.has(String(r.id));
    /* 'V/S (간략히/자세히)' · '신체사정 (간략히/자세히)' 하나의 칩이 토글 — 기본 간략히(표 숨김), 클릭 시 그 칩 아래 표 펼침. (사용자 요청 2026-07-21) */
    const _vsLineHtml = _hasVsData
      ? `<div class="layer vs-treat-line" style="display:block;margin-bottom:2px"><span class="treat-tag" style="cursor:pointer;position:relative" data-action="vsToggleDetail" data-rid="${r.id}" data-htip="클릭하여 V/S 표 ${_vsOpen?'접기':'펼치기'}">V/S (${_vsOpen?'자세히':'간략히'})</span><span class="treat-tag vs-graph-chip" style="cursor:pointer;position:relative;background:rgba(56,189,248,0.16);color:#0284c7;border:1px solid rgba(56,189,248,0.45)" data-action="vsOpenTimeseries" data-rid="${r.id}" data-htip="시간대별 값을 그래프로 보기">📈 시간대 그래프</span>${_vsOpen?`<div class="inline-detail-table" data-action="openSymptomVs" data-rid="${r.id}" style="cursor:pointer;display:block;overflow-x:auto;max-width:100%;margin-top:3px" data-htip="클릭하여 V/S 측정 입력 열기">${_vsTableHtml(r)}</div>`:''}</div>`
      : '';
    const _paLineHtml = _hasPaData
      ? `<div class="layer pa-treat-line" style="display:block;margin-top:2px"><span class="treat-tag" style="cursor:pointer;position:relative" data-action="paToggleDetail" data-rid="${r.id}" data-htip="클릭하여 신체사정 표 ${_paOpen?'접기':'펼치기'}">신체사정 (${_paOpen?'자세히':'간략히'})</span>${_paOpen?`<div class="inline-detail-table" data-action="openSymptomPa" data-rid="${r.id}" style="cursor:pointer;display:block;overflow-x:auto;max-width:100%;margin-top:3px" data-htip="클릭하여 신체사정 입력 열기">${_paTableHtml(r)}</div>`:''}</div>`
      : '';
    const _filterVsPa=(t)=>t!=='V/S 측정'&&t!=='신체사정';
    if(_showLayered){
      /* 다중 증상 — 각 증상이 한 층. V/S·신체사정은 전용 줄로 분리, 그 외 처치만 증상별 층에. */
      _symCellInner = r.symptoms.map(sym => `<div class="layer">${_renderSymChip(sym)}</div>`).join('');
      /* 상담 처치란 문구 — 맵에 없고 flat 에만 있으므로 상담 층(첫 번째)에 직접 합류 (사용자 보고 2026-08-25) */
      const _clTreat=counselTreatText(r);
      const _clSymIdx=_clTreat?r.symptoms.findIndex(isCounselSymLabel):-1;
      const _otherLayers = r.symptoms.map((sym, idx) => {
        const symTreats = (r.treatmentBySym[sym] || []).filter(_filterVsPa);
        let chips = symTreats.map(function(t){ return _renderTreatChip(t, sym); }).join('');
        if(idx===_clSymIdx) chips += _renderTreatChip(_clTreat, sym);
        const _memoSuffix = (idx===0 && r.treatmentMemo)
          ? `<span class="treat-memo" style="cursor:pointer;font-size:11px;color:var(--t2);margin-left:${symTreats.length?'4px':'0'}" data-action="openSymptom" data-rid="${r.id}" title="${escHtml(r.treatmentMemo)}">${escHtml(r.treatmentMemo)}</span>`
          : '';
        const inner = chips + _memoSuffix;
        return `<div class="layer">${inner || '<span style="color:var(--t3);font-size:11px;font-style:italic">-</span>'}</div>`;
      }).join('');
      _treatCellInner = _vsLineHtml + _otherLayers + _paLineHtml;
    } else {
      /* 단일 증상 또는 옛 일지 */
      _symCellInner = r.isImported
        ? `<span class="imported-text" style="font-size:11px;color:var(--t2);cursor:pointer" data-action="openSymptom" data-rid="${r.id}">${escHtml(r.symptoms.join(', ')||'-')}</span>`
        : r.symptoms.map(_renderSymChip).join('');
      _treatCellInner = r.isImported
        ? `<span class="imported-text" style="font-size:11px;color:var(--t2);cursor:pointer" data-action="openSymptom" data-rid="${r.id}">${escHtml(r.treatment.join(', ')||'-')}</span>`
        : (function(){
            const _tc = r.treatment.filter(_filterVsPa).map(_renderTreatChip).join('') + (r.treatmentMemo?`<span class="treat-memo" style="cursor:pointer;font-size:11px;color:var(--t2);margin-left:${r.treatment.length?'4px':'0'}" data-action="openSymptom" data-rid="${r.id}" title="${escHtml(r.treatmentMemo)}">${escHtml(r.treatmentMemo)}</span>`:'');
            const _body = _vsLineHtml + _tc + _paLineHtml;
            /* 처치 미입력(V/S·신체사정·칩·메모 모두 없음) → 빈 칸 대신 "+" 버튼. */
            return _body || `<span class="cell-plus" data-action="openSymptom" data-rid="${r.id}">+</span>`;
          })();
    }
    /* V/S·신체사정 '자세히' 표가 처치 칸 안에 펼쳐지면 칸 높이 제한(chip-clamp)을 풀어 표가 안 잘리게. */
    const _rowCls=[r.isImported?'imported-row':'',(_vsOpen||_paOpen)?'detail-open':''].filter(Boolean);
    return `<tr data-row-idx="${i}" data-rec-id="${r.id}" data-stu-id="${r.studentId}" style="cursor:pointer"${_rowCls.length?(' class="'+_rowCls.join(' ')+'"'):''}>
      <td data-col-index="0" class="mono">${options.period?escHtml(r.date):i+1}${r.isImported?'<span style="display:block;font-size:7px;font-weight:700;color:#6366f1;line-height:1;margin-top:1px">이전</span>':''}</td>
      <td data-col-index="19" style="text-align:center;font-size:10px">${s&&s.level?escHtml(s.level):'-'}</td>
      <td data-col-index="17" style="text-align:center;font-size:10px">${escHtml(majorAbbr)}</td>
      <td data-col-index="1">${escHtml(gradeCol)}</td>
      <td data-col-index="2" class="mono">${escHtml(numCol)}</td>
      <td data-col-index="3">${isCare?'<span class="yo-chip-wrap"><span class="yo-badge" data-action="openCare" data-sid="'+s.id+'" style="cursor:pointer" title="클릭하여 요보호 등록/변경">요보호</span><span class="yo-chip-pop">'+getCareTooltipHtml(s)+'</span></span>':''}</td>
      <td data-col-index="15" style="position:relative;text-align:center">${(function(){const vt=S._vipTags[r.studentId]||[];if(vt.length){const t=vt[vt.length-1];const _tip=vt.map(function(v){return '★ '+v.text;}).join('\n');return '<span class="vip-star-wrap vip-hover-wrap" style="position:relative;display:inline-block" data-action="openVipEdit" data-sid="'+r.studentId+'"><span style="color:'+t.color+';font-size:13px;cursor:pointer">★</span><span class="vip-hover-pop">'+escHtml(_tip)+'</span><span class="vip-tbl-x" data-action="vipClearAll" data-sid="'+r.studentId+'">✕</span></span>';}return '<span class="cell-plus" data-action="openVipEdit" data-sid="'+r.studentId+'">+</span>';})()}</td>
      <td data-col-index="4"><div class="name-cell">${bday?'<span style="position:absolute;left:0;font-size:13px">🎂</span>':''}${bday?getStudentNameHoverHtml(s).replace('class="name-hover-anchor"','class="name-hover-anchor birthday-name"'):getStudentNameHoverHtml(s)}</div></td>
      <td data-col-index="5">${(s.gender==='M'||s.gender==='남')?'남':(s.gender==='F'||s.gender==='여')?'여':(s.gender||'-')}</td>
      <td data-col-index="16" style="text-align:center">${(function(){
        /* _bmData(메모리) 우선, 없으면 레코드의 bodymapData(DB 로드분) 폴백 — 키오스크 자동 등록 직후
         * 메모리 동기화가 빠진 행도 DB 에 바디맵이 있으면 ✅ 표시 (사용자 보고 2026-06-13). 폴백 시 메모리도 복구. */
        let _bmArr=(window._bmData||{})[r.id];
        if((!_bmArr||!_bmArr.length)&&r.bodymapData&&r.bodymapData.length){ _bmArr=r.bodymapData; try{ window._bmData=window._bmData||{}; window._bmData[r.id]=r.bodymapData; }catch(_e){} }
        return (_bmArr&&_bmArr.length)?'<span style="cursor:pointer;font-size:13px" data-action="openBodyMap" data-rid="'+r.id+'" title="바디맵 보기/편집">✅</span>':'<span class="cell-plus" data-action="openBodyMap" data-rid="'+r.id+'">+</span>';
      })()}</td>
      <td data-col-index="6" style="position:relative"><div class="chip-clamp${_showLayered?' multi-layer':''}"${_showLayered?'':` data-htip="${escHtml((r.symptoms||[]).join(', '))}"`}>${_symCellInner}</div></td>
      <td data-col-index="8" style="position:relative"><div class="chip-clamp${_showLayered?' multi-layer':''}"${_showLayered?'':` data-htip="${escHtml((r.treatment.join(', ')+(r.treatmentMemo?(r.treatment.length?' / ':'')+r.treatmentMemo:'')).trim())}"`}>${_treatCellInner}</div></td>
      <!-- 의약품 컬럼 삭제됨 -->
      <td data-col-index="10" class="mono" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px" data-action="openTimePicker" data-rid="${r.id}" data-field="timeIn" data-htip="클릭하여 수정">${r.timeIn}</td>
      <td data-col-index="11" class="mono" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px" data-action="openTimePicker" data-rid="${r.id}" data-field="timeOut" data-htip="클릭하여 수정">${r.timeOut||'-'}</td>
      <!-- V/S(idx 12) 열 제거 — V/S 는 처치 칸 'V/S 측정' 칩 + 아래 인라인 표로 표시(2026-07-21) -->
      <td data-col-index="13" style="text-align:center;white-space:nowrap">${r.nurse||'-'}</td>
      <td data-col-index="14" style="position:relative;padding-right:32px"><span class="memo-plus" data-action="toggleMemo" data-sid="${r.studentId}" data-rid="${r.id}">${hasMemo||'+'}</span><button class="row-delete-x" data-action="dailyDeleteRecord" data-rid="${r.id}">✕</button></td>
    </tr>`;
  }).join('');
}

/* Reuse the diary header, row renderer, column preferences and click dispatcher. */
export function renderDailyPeriodTable(container,records,privacy,beforeAction){
  const source=document.querySelector('#recTable thead');
  if(!source)throw new Error('보건일지 표 머리글을 찾을 수 없습니다.');
  const head=source.cloneNode(true);
  head.querySelectorAll('span[id^="_sortArrow"]').forEach(node=>node.remove());
  head.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  head.querySelectorAll('[data-sort]').forEach(node=>node.removeAttribute('data-sort'));
  head.querySelectorAll('.col-resize-handle, [class*="cr-handle"], span[id^="_sortArrow"]').forEach(node=>node.remove());
  const dateHead=head.querySelector('[data-col-index="0"]');
  dateHead.textContent='날짜';
  container.innerHTML='<table class="rec-table daily-period-table" id="dailyPeriodTable">'+head.outerHTML
    +'<tbody>'+renderDailyRecordRows(records,{period:true})+'</tbody></table>';
  const table=container.querySelector('table');
  table.querySelectorAll('.row-delete-x').forEach(node=>node.remove());
  applyDailyColLayout(table);
  table.querySelectorAll('[data-col-index="0"]').forEach(node=>{
    node.classList.remove('col-hidden');node.style.display='';node.style.width='88px';node.style.minWidth='88px';
  });
  table.querySelectorAll('th[data-col-index="10"],th[data-col-index="11"]').forEach(node=>{node.style.width=Math.max(52,parseFloat(node.style.width)||0)+'px';});
  table.querySelectorAll('tbody > tr').forEach(tr=>{
    if(privacy){
      tr.querySelectorAll('td:not([data-col-index="0"]):not([data-col-index="10"]):not([data-col-index="11"])').forEach(td=>{td.innerHTML='•••';td.removeAttribute('data-htip');});
    }
    const sym=tr.querySelector('td[data-col-index="6"] .multi-layer');
    const treat=tr.querySelector('td[data-col-index="8"] .multi-layer');
    if(sym&&treat){
      const a=sym.querySelectorAll(':scope > .layer'), b=treat.querySelectorAll(':scope > .layer:not(.vs-treat-line):not(.pa-treat-line)');
      if(a.length===b.length)a.forEach((node,i)=>{const height=Math.max(node.offsetHeight,b[i].offsetHeight);node.style.minHeight=b[i].style.minHeight=height+'px';});
    }
  });
  bindDailyRecordActions(table.querySelector('tbody'),beforeAction);
}

export function renderDaily(){
  if(isDailyPeriodSearchActive()){refreshDailyPeriodSearch();return;}
  /* 렌더링 시작: 테이블 숨김 → applyDailyColLayout()에서 표시 (열 너비 변동 깜빡임 방지) */
  const _tblEl=document.getElementById('recTable');
  if(_tblEl)_tblEl.style.visibility='hidden';
  updateDailyDateLabel();
  /* 유치원 모드: 헤더 텍스트 변경 */
  if(typeof isKinder==='function'&&isKinder()){
    const thGc=document.getElementById('thGradeClass');if(thGc)thGc.childNodes[0].textContent='만 나이/반';
  }
  /* renderDaily 시 EMS 팝업은 닫지 않음 — 팝업이 fixed 좌표로 떠 있어 테이블
     재렌더링과 독립적이고, 사용자가 직접 다른 곳을 클릭할 때만 닫혀야 함. */
  if(typeof _nameHoverEl!=='undefined'&&_nameHoverEl){_nameHoverEl.remove();_nameHoverEl=null;}
  /* 부팅 초기 DB 로딩 중에는 dayRecs 와 무관하게 무조건 "로딩 중" 안내만 표시하고 일반 렌더 차단.
   *  데이터 도착 후 data-loader.js 의 .then() 에서 _dailyLoading=false + bus.emit('render:daily') 가 재호출함. */
  if(S._dailyLoading){
    /* 로딩/전환 안내 오버레이 표시 (position:absolute — 표 너비·스크롤 영향 0) */
    const _ovL=document.getElementById('dailyLoadingOverlay'); if(_ovL)_ovL.style.display='flex';
    const _loadingTbody=document.getElementById('recBody');
    if(_loadingTbody) _loadingTbody.innerHTML='';
    const _loadingWrap=document.getElementById('dailyTableWrap');
    let _loadingMsg=_loadingWrap&&_loadingWrap.querySelector('.daily-empty-msg');
    if(!_loadingMsg&&_loadingWrap){
      _loadingMsg=document.createElement('div');
      _loadingMsg.className='daily-empty-msg';
      _loadingMsg.style.cssText='text-align:center;padding:56px 0;color:var(--t3);font-size:12px;width:100%';
      _loadingWrap.appendChild(_loadingMsg);
    }
    if(_loadingMsg){
      _loadingMsg.textContent='로딩 중입니다. 잠시만 기다려주세요.';
      _loadingMsg.style.display='block';
    }
    return;
  }
  /* 안내 오버레이 — 페이지 로드 후 첫 진입엔 0.7초 노출(메시지·애니메이션을 보이게 + 빈화면/세로 스크롤 깜빡임을 덮음),
   *  그 뒤 렌더부터는 즉시 숨김(날짜 이동·재렌더 시 지연 없음). (2026-06-09) */
  const _ovHide=document.getElementById('dailyLoadingOverlay');
  if(_ovHide){
    if(!_dailyEntryOverlayShown){
      _dailyEntryOverlayShown=true;
      _ovHide.style.display='flex';
      _dailyOverlayHideTimer=setTimeout(function(){ _dailyOverlayHideTimer=null; const _o=document.getElementById('dailyLoadingOverlay'); if(_o)_o.style.display='none'; },1000);
    } else if(!_dailyOverlayHideTimer){
      _ovHide.style.display='none';
    }
  }
  const dayRecs=recsByDate(S.selectedDate);
  const d=dateObj(S.selectedDate);
  const yr=d.getFullYear(), mo=d.getMonth()+1, day=d.getDate(), dow=getDow(S.selectedDate);
  const wEmoji=(typeof getWeatherEmoji==='function')?getWeatherEmoji(S.selectedDate):'☀️';
  const weathers=['☀️','⛅','☁️','🌧️','❄️','🌫️'];
  const wBtns=weathers.map(w=>`<button class="weather-btn${w===wEmoji?' active':''}" data-weather="${w}">${w}</button>`).join('');
  const _dailyTitleEl=document.getElementById('dailyTitle');
  /* 가드 — daily 뷰 fragment 가 아직 로드되지 않은 시점(부트 초기)에 호출되면 조용히 종료 */
  if(!_dailyTitleEl) return;
  _dailyTitleEl.innerHTML=`${yr}년 ${mo}월 ${day}일 ${dow}요일 <span class="weather-wrap">(날씨: <span class="weather-emoji-display">${wEmoji}</span>)<div class="weather-picker" id="weatherPicker">${wBtns}</div></span>`;
  const _wEmojiEl=_dailyTitleEl.querySelector('.weather-emoji-display');
  if(_wEmojiEl) _wEmojiEl.addEventListener('click',function(e){toggleWeatherPicker(e);});
  _dailyTitleEl.querySelectorAll('[data-weather]').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();setWeather(S.selectedDate,this.dataset.weather);});
  });
  document.getElementById('dailySubtitle').textContent=`${dayRecs.length}건의 방문 기록`;

  const stuCount=dayRecs.filter(r=>getStu(r.studentId).type!=='staff').length;
  const staffCount=dayRecs.filter(r=>getStu(r.studentId).type==='staff').length;
  const vc=document.getElementById('dailyVisitorCount');
  if(vc){
    const _nurseMap={};
    /* 현재 로그인 사용자 = S._currentUser (우상단 회전문구와 동일 소스) */
    const _curU=S._currentUser||{};
    const _granted=Array.isArray(S._grantedUsers)?S._grantedUsers:[];
    const _posLookup={};const _schoolLookup={};
    const _myN=_curU.name||S.settings.nurse1||'';
    if(_myN){_posLookup[_myN]=_curU.position||'';_schoolLookup[_myN]=_curU.school_name||S.settings.schoolName||'';}
    _granted.forEach(function(g){if(g.name){_posLookup[g.name]=g.position||'';_schoolLookup[g.name]=g.school_name||S.settings.schoolName||'';}});
    dayRecs.forEach(function(r){
      const nurse=r.nurse||'미지정';
      if(!_nurseMap[nurse])_nurseMap[nurse]={stu:0,staff:0};
      if(getStu(r.studentId).type==='staff')_nurseMap[nurse].staff++;
      else _nurseMap[nurse].stu++;
      if(r.nursePosition&&nurse!=='미지정'&&!_posLookup[nurse])_posLookup[nurse]=r.nursePosition;
    });
    const total=stuCount+staffCount;
    /* 이전 전광판 숫자와 비교 — 변하지 않은 숫자는 flipping 안 함 */
    const _prevDigits=vc._prevDigits||'';
    const _newDigits=String(total).padStart(3,'0')+String(stuCount).padStart(3,'0')+String(staffCount).padStart(2,'0');
    let _digitIdx=0;
    function flipD(n,cls,digits){let s=String(n);while(s.length<(digits||3))s='0'+s;return s.split('').map(function(d){
      const changed=_prevDigits.charAt(_digitIdx)!==d;
      _digitIdx++;
      return '<div class="flip-digit '+cls+(changed?' flipping':'')+'"><span>'+d+'</span></div>';
    }).join('');}
    vc._prevDigits=_newDigits;
    let h='<div class="flip-board" style="flex-direction:column;gap:3px;padding:4px 8px;border-radius:0">';
    /* 1층: 전체/학생/교직원 — 기록 없어도 항상 표시 */
    h+='<div style="display:flex;align-items:center;gap:5px">'
      +'<div class="flip-section"><span class="flip-label flip-stat-total">'+(S.selectedDate===toDateStr(new Date())?'오늘 전체':'당일 전체')+'</span>'+flipD(total,'cyan',3)+'</div>'
      +'<span class="flip-sep">│</span>'
      +'<div class="flip-section"><span class="flip-label flip-stat-stu">학생</span>'+flipD(stuCount,'blue',3)+'</div>'
      +'<span class="flip-sep">│</span>'
      +'<div class="flip-section"><span class="flip-label flip-stat-staff">교직원</span>'+flipD(staffCount,'purple',2)+'</div>'
      +'</div>';
    /* 2층: 처치자별 — 왼편=항상 현재 사용자, 오른편=릴레이 연결 시 협업자 */
    const nurseKeys=[];
    const myName=_curU.name||S.settings.nurse1||'';
    const _relayConnected=!!(S.kioskSettings&&S.kioskSettings.relayConnected);
    /* 실제 기록이 있는 처치자 목록 (미지정 제외) */
    const _realNurses=Object.keys(_nurseMap).filter(function(n){return n!=='미지정';});
    _realNurses.sort(function(a,b){return(_nurseMap[b].stu+_nurseMap[b].staff)-(_nurseMap[a].stu+_nurseMap[a].staff);});

    /* 왼편: 항상 현재 사용자 (기록 0건이라도 표시) */
    if(!_nurseMap[myName])_nurseMap[myName]={stu:0,staff:0};
    if(myName)nurseKeys.push(myName);
    /* 오른편: 동료 접속자 — 웹/LAN 공통으로 S._collabPeer 우선 사용 */
    const _peer=S._collabPeer;
    if(_peer&&_peer.name){
      const peerName=_peer.name.replace(/\s*외\s*\d+명$/,''); /* "외 N명" 접미사 제거하고 저장 */
      _nurseMap[peerName]=_nurseMap[peerName]||{stu:0,staff:0};
      if(_peer.position)_posLookup[peerName]=_peer.position;
      if(_peer.school)_schoolLookup[peerName]=_peer.school;
      if(peerName!==myName&&nurseKeys.indexOf(peerName)===-1)nurseKeys.push(peerName);
    } else if(_relayConnected){
      /* 릴레이만 연결되고 피어 정보는 아직 미수신 — 기록에서 협업자 추정 */
      const partner=_realNurses.find(function(n){return n!==myName;});
      if(partner)nurseKeys.push(partner);
    }
    if(nurseKeys.length){
      h+='<div style="display:flex;gap:4px;border-top:1px solid rgba(255,255,255,0.08);padding-top:3px">';
      nurseKeys.forEach(function(name,idx){
        const pos=_posLookup[name]||'';
        const c=_nurseMap[name];
        const nurseTotal=c.stu+c.staff;
        if(idx>0)h+='<span class="flip-sep" style="font-size:10px">│</span>';
        h+='<div style="flex:1;display:flex;flex-direction:column;gap:0;font-size:10px">'
          +'<span class="flip-nurse-name" style="font-weight:700;font-size:10.5px;line-height:1.35">'+escHtml((_schoolLookup[name]||S.settings.schoolName||'')?(_schoolLookup[name]||S.settings.schoolName)+' ':'')+escHtml(pos?pos+' ':'')+escHtml(name)+'</span>'
          +'<span class="flip-nurse-stats" style="line-height:1.35">전체 <b class="flip-stat-total">'+nurseTotal+'</b>명 &nbsp;학생 <b class="flip-stat-stu">'+c.stu+'</b>명 &nbsp;교직원 <b class="flip-stat-staff">'+c.staff+'</b>명</span>'
          +'</div>';
      });
      h+='</div>';
    }
    h+='</div>';
    vc.innerHTML=h;
  }

  /* 학교급별 헤더/컬럼 표시 업데이트 */
  (function(){
    const sl=S.settings.schoolLevel||'elementary';
    const thMajor=document.getElementById('thMajorCol');
    const thGrade=document.getElementById('thGradeClass');
    const thNum=document.querySelector('#recTable thead th[data-col-index="2"]');
    if(thMajor){
      /* 과 열: 고등학교·특수학교일 때 표시, 나머지는 숨김 */
      thMajor.style.display=(sl==='high'||sl==='special')?'':'none';
    }
    if(thGrade){
      if(sl==='kindergarten'){
        thGrade.childNodes[0].textContent='만 나이';
      } else {
        /* 특수학교 포함 — 학교급은 별도 컬럼(19)에 표시, 학년반은 단순 "1-1" 형식 */
        thGrade.childNodes[0].textContent='학년반(소속)';
      }
    }
    if(thNum){
      thNum.childNodes[0].textContent=(sl==='kindergarten')?'반':'번호';
    }
  })();

  const tbody=document.getElementById('recBody');
  if(!tbody) return; /* 뷰 fragment 아직 미마운트 시 안전하게 종료 */
  if(!dayRecs.length){
    /* 데이터 없는 날: 테이블 너비를 컨테이너에 맞추고 저장된 열 px로 강제 */
    const _wrap=document.getElementById('dailyTableWrap');
    const _tbl=document.getElementById('recTable');
    if(_wrap&&_tbl)_tbl.style.width=_wrap.clientWidth+'px';
    const _sw=S._colWidths||null;
    if(_sw){
      const cols=document.querySelectorAll('#recTable colgroup col');
      cols.forEach(function(c,i){if(_sw[i])c.style.width=_sw[i]+'px';});
    }
    tbody.innerHTML='';
    const _emptyWrap=document.getElementById('dailyTableWrap');
    let _emptyMsg=_emptyWrap&&_emptyWrap.querySelector('.daily-empty-msg');
    if(!_emptyMsg&&_emptyWrap){_emptyMsg=document.createElement('div');_emptyMsg.className='daily-empty-msg';_emptyMsg.style.cssText='text-align:center;padding:56px 0;color:var(--t3);font-size:12px;width:100%';_emptyWrap.appendChild(_emptyMsg);}
    /* 부팅 초기 DB 로딩 중이면 "로딩 중..." 안내, 아니면 기존 "오늘 입력된 데이터가 없습니다." */
    if(_emptyMsg)_emptyMsg.textContent = S._dailyLoading ? '로딩 중입니다. 잠시만 기다려주세요.' : '오늘 입력된 데이터가 없습니다.';
    if(_emptyMsg)_emptyMsg.style.display='block';
    applyDailyColLayout();
    return;
  }
  /* 빈 메시지 숨김 */
  const _emptyHide=document.querySelector('#dailyTableWrap .daily-empty-msg');if(_emptyHide)_emptyHide.style.display='none';
  /* 데이터 있는 날: colgroup과 테이블 복구
     ※ 사용자가 변경한 열 너비(S._colWidths)가 있으면 그것을 우선 적용 — 절대 기본값으로 되돌리지 않음 */
  const _origColW=['24px','36px','58px','28px','34px','28px','52px','28px','34px','13%','19%','5%','38px','38px','36px','50px','72px'];
  const _tbl2=document.getElementById('recTable');if(_tbl2)_tbl2.style.width='100%';
  const cols2=document.querySelectorAll('#recTable colgroup col');
  const _userW=S._colWidths||null;
  cols2.forEach(function(c,i){
    if(_userW&&_userW[i]){c.style.width=_userW[i]+'px';}
    else if(_origColW[i]){c.style.width=_origColW[i];}
  });
  tbody.innerHTML=renderDailyRecordRows(dayRecs);

  if(!dayRecs.length){
    /* 빈 상태 — macOS 친근한 안내 (검색·달력에서 다른 날짜로 이동 안내) */
    const _emptyHtml = (typeof createEmptyState==='function')
      ? createEmptyState({
          icon:'📭',
          title:'이 날짜에 기록된 방문이 없습니다',
          desc:'학생 검색으로 새 방문을 등록하거나, 달력에서 다른 날짜로 이동하세요.',
          actionLabel:'+ 학생 검색으로 등록',
          actionFn:'document.getElementById(\'dailySearchInput\').focus()'
        })
      : '이 날짜에 기록된 방문이 없습니다.';
    tbody.innerHTML='<tr><td class="daily-empty-cell" colspan="15" style="padding:0;background:transparent">'+_emptyHtml+'</td></tr>';
  }
  /* ── recBody event delegation for [data-action] ── */
  bindDailyRecordActions(tbody);
  applyDailyColLayout();
  if(_crInsertHandlesRef)setTimeout(_crInsertHandlesRef,30);
  _updateSortArrows();
  /* 데이터 있는 날: 열 너비를 측정해서 저장 */
  if(dayRecs.length){
    setTimeout(function(){
      const ths=document.querySelectorAll('#recTable thead th');
      const widths=[];ths.forEach(function(th){widths.push(th.offsetWidth);});
      if(widths.length)S._colWidths=widths;
    },50);
  }
  setTimeout(function(){
    if(typeof adjustPanelHeights==='function')adjustPanelHeights();
    if(typeof initDailyCustomScrollbar==='function')initDailyCustomScrollbar();
    dailyInitDrag();
    /* 칩 오버플로우 감지: chip-clamp 컨테이너 */
    document.querySelectorAll('#recTable .chip-clamp').forEach(function(el){
      el.classList.toggle('overflowed', el.scrollHeight > el.clientHeight + 2);
    });
    /* 증상·처치 셀 다중 layer 높이 동기화 (사용자 요청 2026-05-24).
     *  같은 row 의 col6/col8 multi-layer 각 layer 가 같은 높이여야 점선이 정확히 정렬됨.
     *  단일 처치든 다중 처치든 무조건 sym layer = treat layer 높이 같게. */
    document.querySelectorAll('#recTable tbody tr').forEach(function(tr){
      const symML=tr.querySelector('td[data-col-index="6"] .chip-clamp.multi-layer');
      const trtML=tr.querySelector('td[data-col-index="8"] .chip-clamp.multi-layer');
      if(!symML || !trtML)return;
      const symLs=symML.querySelectorAll(':scope > .layer');
      const trtLs=trtML.querySelectorAll(':scope > .layer');
      if(symLs.length!==trtLs.length)return;
      /* 측정 전 min-height 초기화 */
      symLs.forEach(function(l){l.style.minHeight='';});
      trtLs.forEach(function(l){l.style.minHeight='';});
      /* max(symH, treatH) 로 양쪽 min-height 동기화 — 점선 정렬 */
      symLs.forEach(function(symL,i){
        const trtL=trtLs[i];
        const h=Math.max(symL.offsetHeight, trtL.offsetHeight);
        symL.style.minHeight=h+'px';
        trtL.style.minHeight=h+'px';
      });
    });
    /* 프라이버시 모드 유지 */
    if(_privacyOn)_applyPrivacyToRows();
  },150);
}

/* native confirm() 은 Electron+Windows 에서 닫힌 뒤 webContents 포커스 복귀가
 * 깨지는 케이스 보고됨(2026-05-19) — 삭제 후 사이드/일지 검색창 클릭·입력 안 됨.
 * 자체 HTML 모달로 교체. ESC=취소, Enter=확인. */
function _dailyConfirm(msg, title){
  return new Promise(function(resolve){
    const _title = title || '인원 삭제';
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:50000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
    /* 헤더(회색) + 바디(흰색/카드) + 푸터 분리 — 앱 표준 모달 톤. 기본 focus outline 제거. */
    ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:340px;max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden">'
      +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">'+_title+'</div>'
      +'<div style="padding:18px 20px;font-size:12.5px;color:var(--t1);line-height:1.7;background:var(--card)">'+msg+'</div>'
      +'<div style="display:flex;gap:6px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)">'
      +'<button data-act="cancel" style="padding:6px 14px;font-size:11.5px;font-weight:600;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;outline:none;font-family:var(--f)">취소</button>'
      +'<button data-act="ok" style="padding:6px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.12);color:#dc2626;cursor:pointer;outline:none;font-family:var(--f)">삭제</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    const close=function(r){ try{document.removeEventListener('keydown',onKey,true);}catch(_){} ov.remove(); resolve(r); };
    ov.querySelector('[data-act="ok"]').addEventListener('click',function(){close(true);});
    ov.querySelector('[data-act="cancel"]').addEventListener('click',function(){close(false);});
    ov.addEventListener('click',function(e){ if(e.target===ov) close(false); });
    const onKey=function(e){
      if(e.key==='Escape'){ e.preventDefault(); close(false); }
      else if(e.key==='Enter'){ e.preventDefault(); close(true); }
    };
    document.addEventListener('keydown',onKey,true);
    /* 자동 focus 제거 — 기본 outline 없애기 위함. ESC/Enter 는 document keydown 에서 처리. */
  });
}
async function dailyDeleteRecord(recId){
  const ok=await _dailyConfirm('삭제하시겠습니까?');
  if(!ok)return;
  const rec=S.records.find(function(r){return r.id===recId;});
  if(rec)_undoPushDelete([rec]);
  const dbId=rec?(rec._dbId||rec.id):recId;
  S.records=S.records.filter(function(r){return r.id!==recId;});
  /* 이 기록에 연결된 침상 이용 현황도 함께 삭제 (사이드바 카드 잔류 방지). 2026-06-10 */
  try{ bus.emit('bed:recordsDeleted',{ids:[recId, dbId]}); }catch(_){}
  /* 실시간 머지가 삭제한 레코드를 다시 살리지 않도록 7초 유예 표시 */
  if(!window._recentlyDeletedRecs)window._recentlyDeletedRecs={};
  window._recentlyDeletedRecs[recId]=Date.now();
  window._recentlyDeletedRecs[dbId]=Date.now();
  if(window.electronAPI&&window.electronAPI.recordsDailyDelete){
    window.electronAPI.recordsDailyDelete(dbId).catch(function(err){console.error('[DB] daily delete 실패:',err);});
  }
  renderDaily();renderCalendar();renderSidebarRecent();
  dailyShowToast('삭제되었습니다.\n<span style="font-size:11px;font-weight:500;color:var(--t3)">('+(_isMac?'⌘':'Ctrl')+'+Z로 되돌릴 수 있습니다)</span>');
}

/* ── VIP 태그 관리 ── */
const _vipTags=(function(){const raw=S._vipTags||{};/* 기존 중복 제거 */Object.keys(raw).forEach(function(k){const seen={}, unique=[];(raw[k]||[]).forEach(function(t){if(!seen[t.text]){seen[t.text]=true;unique.push(t);}});raw[k]=unique;});return raw;})();/* {stuId:[{color,text},...]} */
const _vipColors=['#e11d48','#f59e0b','#22c55e','#3b82f6','#a855f7'];
function _saveVipTags(){S._vipTags=S._vipTags;}
function openVipEdit(stuId,btn){
  _closeVipPopup();
  closeCellPopup();
  const tags=S._vipTags[stuId]||[];
  const rect=btn.getBoundingClientRect();
  const popup=document.createElement('div');
  popup.className='cell-ac-popup';popup.id='vipPopup';
  popup.style.cssText='position:fixed;top:'+(rect.bottom+4)+'px;left:'+Math.max(8,rect.left-100)+'px;width:260px;padding:10px;z-index:8500';
  popup.innerHTML=_vipBuildHtml(stuId,tags);
  _bindVipPopupEvents(popup,stuId);
  document.body.appendChild(popup);
  setTimeout(function(){
    document.addEventListener('mousedown',_vipOutside);
    document.addEventListener('keydown',_vipEsc);
  },10);
}
function _closeVipPopup(){
  const p=document.getElementById('vipPopup');if(p)p.remove();
  document.removeEventListener('mousedown',_vipOutside);
  document.removeEventListener('keydown',_vipEsc);
}
function _vipOutside(e){
  const popup=document.getElementById('vipPopup');
  if(!popup){_closeVipPopup();return;}
  if(!popup.contains(e.target))_closeVipPopup();
}
function _vipEsc(e){
  if(e.key==='Escape')_closeVipPopup();
}
function _bindVipPopupEvents(popup,stuId){
  popup.addEventListener('click',function(e){
    const el=e.target.closest('[data-vip-action]');
    if(!el)return;
    e.stopPropagation();
    const action=el.dataset.vipAction;
    if(action==='starCycle') _vipNewStarCycle();
    else if(action==='addTag') _vipAddTag(el.dataset.sid);
    else if(action==='cycleColor') _vipCycleColor(el.dataset.sid,parseInt(el.dataset.idx));
    else if(action==='removeTag') _vipRemoveTag(el.dataset.sid,parseInt(el.dataset.idx));
  });
  const _vipInput=popup.querySelector('#vipNewText');
  if(_vipInput) _vipInput.addEventListener('keydown',function(e){if(e.key==='Enter')_vipAddTag(stuId);});
  /* hover for vip-del-x */
  popup.querySelectorAll('.vip-tag-row').forEach(function(row){
    row.addEventListener('mouseenter',function(){const x=this.querySelector('.vip-del-x');if(x)x.style.display='flex';});
    row.addEventListener('mouseleave',function(){const x=this.querySelector('.vip-del-x');if(x)x.style.display='none';});
  });
}
function _vipBuildHtml(stuId,tags){
  let h='<div class="vp-header" style="margin:-10px -10px 8px;padding:10px 14px;border-radius:0"><span class="vp-header-title" style="font-size:12px">⭐ VIP 태그 달기</span></div>'
    +'<div style="font-size:9px;color:var(--t3);margin-bottom:2px">별표를 클릭하면 색깔이 변합니다.</div>'
    +'<div style="font-size:9px;color:var(--t3);margin-bottom:6px">3개까지 달 수 있습니다.</div>';
  h+='<div style="display:flex;gap:4px;align-items:center">'
    +'<span id="vipNewStar" style="font-size:16px;cursor:pointer;color:'+_vipColors[_vipNewColorIdx]+';user-select:none" data-vip-action="starCycle" title="색상 선택">★</span>'
    +'<input id="vipNewText" style="flex:1;border:1px solid var(--bdr);border-radius:4px;padding:3px 6px;font-size:11px;font-family:var(--f);background:var(--bg2);color:var(--t1);outline:none" placeholder="예. 동아리 부원, 단골 손님, etc">'
    +'<button data-vip-action="addTag" data-sid="'+stuId+'" style="padding:3px 8px;border:1px solid var(--cyan);border-radius:4px;background:rgba(6,182,212,0.1);color:var(--cyan);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--f)">추가</button>'
    +'</div>';
  if(tags.length){
    h+='<div style="border-top:1px solid var(--bdr);margin-top:8px;padding-top:6px">';
    tags.forEach(function(t,i){
      h+='<div class="vip-tag-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:3px 4px;border-radius:4px;position:relative">'
        +'<span style="font-size:14px;cursor:pointer;user-select:none;color:'+t.color+'" data-vip-action="cycleColor" data-sid="'+stuId+'" data-idx="'+i+'" title="클릭하여 색상 변경">★</span>'
        +'<span style="font-size:10px;color:var(--t2);flex:1">'+escHtml(t.text)+'</span>'
        +'<span class="vip-del-x" data-vip-action="removeTag" data-sid="'+stuId+'" data-idx="'+i+'" style="display:none;position:absolute;right:-4px;top:-4px;width:14px;height:14px;border-radius:50%;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2);font-size:8px;align-items:center;justify-content:center;cursor:pointer;line-height:1;font-family:var(--f)">✕</span>'
        +'</div>';
    });
    h+='</div>';
  }
  return h;
}
let _vipNewColorIdx=0;
function _vipNewStarCycle(){
  _vipNewColorIdx=(_vipNewColorIdx+1)%_vipColors.length;
  const star=document.getElementById('vipNewStar');
  if(star)star.style.color=_vipColors[_vipNewColorIdx];
}
function _vipAddTag(stuId){
  const input=document.getElementById('vipNewText');
  const text=input?input.value.trim():'';
  if(!text){input.placeholder='단골 손님';return;}
  if(!S._vipTags[stuId])S._vipTags[stuId]=[];
  if(S._vipTags[stuId].some(function(t){return t.text===text;})){input.value='';return;}
  if(S._vipTags[stuId].length>=3){alert('VIP 태그는 최대 3개까지 달 수 있습니다.');return;}
  S._vipTags[stuId].push({color:_vipColors[_vipNewColorIdx],text:text});
  _saveVipTags();
  /* VIP 표시 활성화 */
  const dayRecs=recsByDate(S.selectedDate);
  dayRecs.forEach(function(r){if(r.studentId===stuId)r.vip=true;});
  saveData();renderDaily();
}
function _vipCycleColor(stuId,idx){
  const tags=S._vipTags[stuId];if(!tags||!tags[idx])return;
  const ci=_vipColors.indexOf(tags[idx].color);
  tags[idx].color=_vipColors[(ci+1)%_vipColors.length];
  _saveVipTags();
  const popup=document.getElementById('vipPopup');
  if(popup){popup.innerHTML=_vipBuildHtml(stuId,tags);_bindVipPopupEvents(popup,stuId);}
}
function _vipClearAll(stuId){
  delete S._vipTags[stuId];
  _saveVipTags();
  renderDaily();
}
function _vipRemoveTag(stuId,idx){
  const tags=S._vipTags[stuId];if(!tags)return;
  tags.splice(idx,1);
  if(!tags.length){delete _vipTags[stuId];/* VIP 해제 */
    const dayRecs=recsByDate(S.selectedDate);dayRecs.forEach(function(r){if(r.studentId===stuId)r.vip=false;});saveData();
  }
  _saveVipTags();renderDaily();
}
S.dailySortOrder='desc';
S._dailySortCol='timeIn';
S._dailySortDir='desc';
export function dailySortByTime(order){
  S._lastRegisteredRecId=null;
  S.dailySortOrder=order;
  S._dailySortCol='timeIn';
  S._dailySortDir=order;
  S._dailySortCol=S._dailySortCol;
  S._dailySortDir=S._dailySortDir;
  renderDaily();
}
export function dailySortByCol(col){
  S._lastRegisteredRecId=null;
  if(S._dailySortCol===col){
    S._dailySortDir=(S._dailySortDir==='asc'?'desc':'asc');
  } else {
    S._dailySortCol=col;
    S._dailySortDir='asc';
  }
  S._dailySortCol=S._dailySortCol;
  S._dailySortDir=S._dailySortDir;
  if(col==='timeIn'||col==='timeOut') S.dailySortOrder=S._dailySortDir;
  renderDaily();
}
function _updateSortArrows(){
  const cols=['grade','num','care','gender','timeIn','timeOut'];
  cols.forEach(function(c){
    const el=document.getElementById('_sortArrow_'+c);
    if(!el)return;
    if(c===S._dailySortCol){
      el.textContent=S._dailySortDir==='asc'?'▲':'▼';
      el.style.opacity='1';
    } else {
      el.textContent='▲';
      el.style.opacity='0.2';
    }
  });
}

/* S.dailySortOrder → S 객체 사용 */

/* ── 처치 칩 투약 약품명 hover 미니 팝업 (이벤트 위임) ── */
document.addEventListener('mouseenter',function(e){
  if(!e.target||!e.target.closest)return;
  const tag=e.target.closest('.treat-tag[data-med-tip]');
  if(!tag)return;
  if(typeof _symShowTip==='function')_symShowTip(tag,'💊 '+tag.getAttribute('data-med-tip'));
},true);
document.addEventListener('mouseleave',function(e){
  if(!e.target||!e.target.closest)return;
  const tag=e.target.closest('.treat-tag[data-med-tip]');
  if(!tag)return;
  if(typeof _symHideTip==='function')_symHideTip();
},true);

/* ── 침상안정 칩 hover → 종료 시각 + 남은 시간 미니 팝업 (이벤트 위임) ── */
document.addEventListener('mouseenter',function(e){
  if(!e.target||!e.target.closest)return;
  const tag=e.target.closest('.treat-tag[data-bed-tip]');
  if(!tag)return;
  const stuId=tag.getAttribute('data-bed-tip');
  /* localStorage에서 침상 사용 정보 조회 */
  let beds=[];try{beds=JSON.parse(localStorage.getItem('ec_bed_usage')||'[]');}catch(err){}
  const usage=beds.find(function(u){return String(u.studentId)===String(stuId)||String(u.stuId)===String(stuId);});
  let msg;
  if(!usage||!usage.endTime){msg='🛏 침상 안정 (이용 등록 없음)';}
  else{
    const ed=new Date(usage.endTime);
    const pad=function(n){return (n<10?'0':'')+n;};
    const endStr=pad(ed.getHours())+':'+pad(ed.getMinutes());
    const remainMs=usage.endTime-Date.now();
    let remainStr;
    if(remainMs<=0)remainStr='⏰ 종료됨';
    else{const rm=Math.ceil(remainMs/60000);remainStr=rm>=60?(Math.floor(rm/60)+'시간 '+(rm%60)+'분 남음'):(rm+'분 남음');}
    msg='🛏 종료 시각: '+endStr+'\n'+remainStr;
  }
  if(typeof _symShowTip==='function')_symShowTip(tag,msg);
},true);
document.addEventListener('mouseleave',function(e){
  if(!e.target||!e.target.closest)return;
  const tag=e.target.closest('.treat-tag[data-bed-tip]');
  if(!tag)return;
  if(typeof _symHideTip==='function')_symHideTip();
},true);

/* ── 일반일지 표의 증상/처치/시간 셀 호버 설명 → 네이티브 title 대신 스타일 미니 팝업(시안 톤) 표시 (사용자 요청 2026-06-04).
 *  data-htip 속성을 가진 요소 호버 시 _symShowTip. 약품/침상 칩(data-med-tip/data-bed-tip)은 자체 팝업이 있으므로 건너뜀. */
document.addEventListener('mouseenter',function(e){
  if(!e.target||!e.target.closest)return;
  const el=e.target.closest('[data-htip]');
  if(!el||!el.closest('#recTable'))return;
  if(e.target.closest('[data-med-tip],[data-bed-tip]'))return;
  const txt=el.getAttribute('data-htip');
  if(txt&&typeof _symShowTip==='function')_symShowTip(el,txt);
},true);
document.addEventListener('mouseleave',function(e){
  if(!e.target||!e.target.closest)return;
  const el=e.target.closest('[data-htip]');
  if(!el)return;
  if(typeof _symHideTip==='function')_symHideTip();
},true);

/* ═══ 열 간격 드래그 조절 ═══ */
let _crInsertHandlesRef=null;
let _crUndoRef=null;
/* 열 너비 px 직접 조회/설정 — 블록 내부 구현을 ref 로 노출.
 * 열 필드 설정 팝업(emergency-view renderColSelectorCards)의 mm 수치 입력이 사용 (2026-06-10). */
let _cwGetPxRef=null,_cwSetPxRef=null;
export function dailyColWidthGetPx(idx){ return _cwGetPxRef?_cwGetPxRef(idx):null; }
export function dailyColWidthSetPx(idx,px){ if(_cwSetPxRef)_cwSetPxRef(idx,px); }
/* _initColResize */
{
  let _crActive=false;
  function _crStorageKey(){
    const uid=S._currentUser&&S._currentUser.id?S._currentUser.id:'default';
    return 'ec_col_widths_u'+uid;
  }
  const STORAGE_KEY='ec_col_widths'; /* fallback */

  /* 저장/로드 — 사용자가 드래그한 열만 저장 (다른 열은 건드리지 않음) */
  const _crTouchedCols={}; /* 이번 세션에서 드래그한 열 인덱스 기록 */
  /* undo 스택: 드래그 직전 너비 전체 스냅샷 */
  const _crUndoStack=[];
  function _crPushUndo(){
    const snap=_crLoad()||{};
    _crUndoStack.push(JSON.parse(JSON.stringify(snap)));
    if(_crUndoStack.length>30)_crUndoStack.shift();
  }
  function _crUndo(){
    if(!_crUndoStack.length)return false;
    const prev=_crUndoStack.pop();
    const key=_crStorageKey();
    localStorage.setItem(key,JSON.stringify(prev));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',prev);
    /* 레이아웃 재적용 */
    if(typeof applyDailyColLayout==='function')applyDailyColLayout();
    if(typeof dailyShowToast==='function')dailyShowToast('열 너비 변경을 되돌렸습니다.');
    return true;
  }
  function _crSave(table, draggedIdx){
    const key=_crStorageKey();
    const existing=_crLoad()||{};
    const headRow=table.querySelector('thead tr');
    const ths=headRow?Array.from(headRow.querySelectorAll('th')):[];
    ths.forEach(function(th){
      const idx=th.getAttribute('data-col-index');
      if(idx!==null && String(idx)===String(draggedIdx) && !th.classList.contains('col-hidden')){
        existing[idx]=th.offsetWidth;
      }
    });
    localStorage.setItem(key,JSON.stringify(existing));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',existing);
  }
  function _crLoad(){
    /* {열번호:px} 객체만 유효 (2026-06-11). 옛 측정 배열(위치 기반)이 사용자 키에 있으면
     * 업데이트 전 사용자의 드래그 조정값이 그 안에 있으므로 폐기하지 않고 객체로 1회 이행.
     * 글로벌 fallback 의 배열은 부팅 복사본이라 이행 없이 제거. 비정상값(20px 미만 등)은 걸러냄. */
    const key=_crStorageKey();
    try{
      let v=null;
      try{ v=JSON.parse(localStorage.getItem(key)); }catch(_){}
      if(Array.isArray(v)){
        const m=migrateLegacyColWidths(v);
        if(m){
          try{localStorage.setItem(key,JSON.stringify(m));}catch(_){}
          if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',m);
        } else { try{localStorage.removeItem(key);}catch(_){} }
        v=m;
      } else { v=sanitizeColWidths(v); }
      if(!v){
        let fb=null;
        try{ fb=JSON.parse(localStorage.getItem(STORAGE_KEY)); }catch(_){}
        if(Array.isArray(fb)){ try{localStorage.removeItem(STORAGE_KEY);}catch(_){} fb=null; }
        v=sanitizeColWidths(fb);
      }
      return v||null;
    }catch(e){return null;}
  }
  function _crApplySaved(table){
    /* applyDailyColLayout()이 이미 저장된 열 너비를 적용하므로
       여기서는 핸들 삽입만 수행. 이중 적용으로 인한 흔들림 방지 */
  }

  /* ── 열 너비 직접 설정(px) — 드래그와 동일 저장소(사용자키 + DB col_widths) 공유 (2026-06-10) ── */
  function _cwGetPx(idx){
    const w=_crLoad()||{};
    const n=parseInt(w[idx],10);
    return isNaN(n)?null:n;
  }
  function _cwSetPx(idx,px){
    const w=_crLoad()||{};
    if(px==null||isNaN(px)){ delete w[idx]; }           /* null = 자동 너비로 복귀 */
    else { w[idx]=Math.max(20,Math.min(1200,Math.round(px))); }
    localStorage.setItem(_crStorageKey(),JSON.stringify(w));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',w);
    if(typeof applyDailyColLayout==='function')applyDailyColLayout();
  }

  /* ── 헤더(1행) 우클릭 → "열 필드 너비 조정" 미니 팝업 (사용자 요청 2026-06-10) ──
   *  · 셀 팝업과 동일 GUI(.cell-ac-popup — popIn 애니메이션 포함) · mm 표기(96dpi: 1px=25.4/96mm)
   *  · 저장/취소 버튼 없음 — 입력 즉시 자동 저장+표 반영. [이전으로 되돌림]=팝업 열기 전 값 복원. */
  const _PX2MM=25.4/96;
  function _cwMmStr(px){ return String(Math.round(px*_PX2MM*10)/10); }
  function _crOpenWidthPopup(th,ev){
    const old=document.getElementById('colWidthPopup'); if(old)old.remove();
    const idx=parseInt(th.getAttribute('data-col-index'),10); if(isNaN(idx))return;
    /* 헤더 라벨 정리 — 정렬 세모(▼ 등)·화살표 글리프 제거, 텍스트만 (사용자 요청 2026-06-10) */
    const label=(th.textContent||'').replace(/[▼▽▾▿▲△↕↑↓◂▸]/g,'').trim();
    const prevPx=_cwGetPx(idx);                          /* 되돌림 기준 — 열기 전 저장값(null=자동) */
    const curPx=prevPx!=null?prevPx:th.offsetWidth;
    const pop=document.createElement('div');
    pop.id='colWidthPopup'; pop.className='cell-ac-popup';
    pop.style.position='fixed'; pop.style.zIndex='9500';
    pop.style.maxHeight='none'; pop.style.overflow='visible';
    pop.style.padding='10px 12px'; pop.style.minWidth='210px';
    pop.innerHTML='<div style="font-size:11px;font-weight:800;color:var(--t1);margin-bottom:8px">열 필드 너비 조정: '+escHtml(label)+'</div>'
      +'<div style="display:flex;align-items:center;gap:6px">'
      +'<input id="colWidthInp" type="text" inputmode="decimal" style="flex:1;min-width:0;font-size:12.5px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1);text-align:right;outline:none;font-family:var(--fm)">'
      +'<span style="font-size:11px;color:var(--t2);font-weight:700">mm</span>'
      +'</div>'
      +'<div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="colWidthRevert" type="button" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.14);color:#ef4444;font-size:9.5px;font-weight:800;cursor:pointer;font-family:var(--f);white-space:nowrap">↩ 이전 수치로 되돌림</button></div>'
      +'<div style="font-size:9.5px;color:var(--t3);margin-top:7px">입력 즉시 자동 저장되어 표에 반영됩니다.<br><span style="color:#3b82f6;font-weight:700">마우스 휠로 조절 또한 가능합니다.</span></div>';
    document.body.appendChild(pop);
    /* 위치 — 우클릭 지점 기준, 화면 밖 클램프 */
    const pw=pop.offsetWidth||230, ph=pop.offsetHeight||90;
    let lx=ev.clientX, ly=ev.clientY+4;
    if(lx+pw>window.innerWidth-8)lx=Math.max(8,window.innerWidth-pw-8);
    if(ly+ph>window.innerHeight-8)ly=Math.max(8,ev.clientY-ph-8);
    pop.style.left=lx+'px'; pop.style.top=ly+'px';
    const inp=pop.querySelector('#colWidthInp');
    inp.value=_cwMmStr(curPx);
    /* 현재 수치 블록(전체 선택) 처리 — 바로 덮어쓰기 가능 */
    setTimeout(function(){ inp.focus(); try{inp.select();}catch(_){} },0);
    inp.addEventListener('input',function(){
      /* 숫자·소수점만 허용 — 문자는 입력 즉시 제거 (붙여넣기 포함, 사용자 요청 2026-06-10) */
      const cleaned=inp.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1');
      if(cleaned!==inp.value)inp.value=cleaned;
      const t=inp.value.trim();
      if(t===''){ _cwSetPx(idx,null); return; }          /* 비우면 자동 너비 */
      const mm=parseFloat(t);
      if(!isNaN(mm)&&mm>0)_cwSetPx(idx, mm/_PX2MM);
    });
    /* 마우스 휠로 1mm 단위 증감 — 위로=증가, 아래로=감소. 즉시 저장+표 반영 (사용자 요청 2026-06-10) */
    const _MINMM=Math.round(20*_PX2MM*10)/10; /* px 하한 20px ≈ 5.3mm */
    inp.addEventListener('wheel',function(e){
      e.preventDefault();
      let base=parseFloat(inp.value);
      if(isNaN(base)){ const sp=_cwGetPx(idx); base=(sp!=null?sp:th.offsetWidth)*_PX2MM; }
      const next=Math.max(_MINMM, Math.round((base+(e.deltaY<0?1:-1))*10)/10);
      inp.value=String(next);
      _cwSetPx(idx, next/_PX2MM);
    },{passive:false});
    pop.querySelector('#colWidthRevert').addEventListener('click',function(){
      _cwSetPx(idx, prevPx);
      inp.value=_cwMmStr(prevPx!=null?prevPx:th.offsetWidth);
      inp.focus(); try{inp.select();}catch(_){}
    });
    function _close(){ if(pop.parentNode)pop.parentNode.removeChild(pop); document.removeEventListener('mousedown',_out,true); document.removeEventListener('keydown',_key,true); }
    function _out(e){ if(!pop.contains(e.target))_close(); }
    function _key(e){ if(e.key==='Escape'||e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); _close(); } }
    setTimeout(function(){ document.addEventListener('mousedown',_out,true); document.addEventListener('keydown',_key,true); },0);
  }

  /* 모든 th를 현재 렌더링된 px 값으로 고정 */
  function _freezeColWidths(table){
    const headRow=table.querySelector('thead tr');
    const ths=headRow?Array.from(headRow.querySelectorAll('th')):[];
    ths.forEach(function(th){
      if(!th.classList.contains('col-hidden'))th.style.width=th.offsetWidth+'px';
    });
  }

  /* 리사이즈 핸들 삽입 — renderDaily 내부에서 호출 */
  function _crInsertHandles(){
    const table=document.getElementById('recTable');if(!table)return;
    table.querySelectorAll('.col-resize-handle').forEach(function(h){h.remove();});
    const ths=table.querySelectorAll('thead th');
    ths.forEach(function(th){
      if(th.classList.contains('col-hidden'))return;
      th.style.position='relative';
      /* 우클릭 → 열 너비 수치(mm) 조정 팝업 — thead th 는 렌더 간 유지되므로 1회만 바인딩 (2026-06-10) */
      if(!th._cwCtxBound){
        th._cwCtxBound=true;
        th.addEventListener('contextmenu',function(e){ e.preventDefault(); e.stopPropagation(); _crOpenWidthPopup(th,e); });
        /* 헤더 호버 → 미니 팝업 안내 (사용자 요청 2026-06-11) — 설정 패널과 동일 GUI */
        th.addEventListener('mouseenter',function(e){
          if(_crActive)return; /* 드래그 중에는 표시하지 않음 */
          try{ showHeaderTooltip(e,'마우스 우클릭으로 열너비 설정이 가능합니다.',false,false); }catch(_){}
        });
        th.addEventListener('mouseleave',function(){ try{ hideHeaderTooltip(); }catch(_){} });
      }
      const handle=document.createElement('div');
      handle.className='col-resize-handle';
      handle.style.cssText='position:absolute;top:0;bottom:1px;right:-2px;width:5px;cursor:col-resize;z-index:20;background:transparent;transition:background .12s';
      th.addEventListener('mouseenter',function(){if(!_crActive)handle.style.background='rgba(6,182,212,0.45)';});
      th.addEventListener('mouseleave',function(){if(!_crActive)handle.style.background='transparent';});
      handle.addEventListener('mouseenter',function(){if(!_crActive)handle.style.background='rgba(6,182,212,0.8)';});
      handle.addEventListener('mouseleave',function(){if(!_crActive)handle.style.background='rgba(6,182,212,0.45)';});

      handle.addEventListener('mousedown',function(e){
        e.preventDefault();e.stopPropagation();
        _crActive=true;
        document.body.style.cursor='col-resize';

        /* 드래그 시작 직전 너비 스냅샷 저장 (undo용) */
        _crPushUndo();

        _freezeColWidths(table);

        const startX=e.clientX;
        const startW=th.offsetWidth;

        const guide=document.createElement('div');
        const thRect=th.getBoundingClientRect();
        guide.style.cssText='position:fixed;width:2px;background:rgba(6,182,212,0.7);z-index:99999;pointer-events:none;box-shadow:0 0 6px rgba(6,182,212,0.4)';
        guide.style.top=thRect.top+'px';
        guide.style.height=thRect.height+'px';
        guide.style.left=e.clientX+'px';
        document.body.appendChild(guide);

        const startTableW=table.offsetWidth;
        const wrap=document.getElementById('dailyTableWrap');
        const containerW=wrap?wrap.clientWidth:startTableW;
        table.style.width=startTableW+'px';
        table.style.minWidth=startTableW+'px';

        /* 맨 오른쪽 보이는 열 th 참조 — 줄어든 공간 흡수용 */
        let _lastTh=null;
        const headThs=Array.from(table.querySelectorAll('thead th'));
        for(let _li=headThs.length-1;_li>=0;_li--){
          if(!headThs[_li].classList.contains('col-hidden')&&headThs[_li]!==th){_lastTh=headThs[_li];break;}
        }
        const lastStartW=_lastTh?_lastTh.offsetWidth:0;
        const lastMinW=parseInt((_lastTh&&_lastTh.style.minWidth)||'50')||50;

        function onMove(ev){
          guide.style.left=ev.clientX+'px';
          const diff=ev.clientX-startX;
          const newW=Math.max(20,startW+diff);
          th.style.width=newW+'px';
          if(diff>0){
            table.style.width=(startTableW+diff)+'px';
            table.style.minWidth=(startTableW+diff)+'px';
            if(_lastTh)_lastTh.style.width='auto';
          } else {
            const newTableW=Math.max(containerW,startTableW+diff);
            table.style.width=newTableW+'px';
            table.style.minWidth=newTableW+'px';
            if(_lastTh){const lnw=Math.max(lastMinW,lastStartW-diff);_lastTh.style.width=lnw+'px';}
          }
        }
        function onUp(ev){
          _crActive=false;
          handle.style.background='transparent';
          document.body.style.cursor='';
          guide.remove();
          const diff=ev.clientX-startX;
          const newW=Math.max(20,startW+diff);
          th.style.width=newW+'px';
          if(diff>0){
            table.style.width=(startTableW+(newW-startW))+'px';
            table.style.minWidth=(startTableW+(newW-startW))+'px';
          } else {
            const newTableW=Math.max(containerW,startTableW+(newW-startW));
            table.style.width=newTableW+'px';
            table.style.minWidth=newTableW+'px';
          }
          /* 맨 오른쪽 열은 항상 auto로 복원 → 테두리 밀착 */
          if(_lastTh){_lastTh.style.width='auto';_lastTh.style.minWidth=lastMinW+'px';}
          document.removeEventListener('mousemove',onMove);
          document.removeEventListener('mouseup',onUp);
          /* 저장 — 드래그한 열만 */
          _crSave(table, th.getAttribute('data-col-index'));
          /* 칩 오버플로우 재감지 */
          setTimeout(function(){
            document.querySelectorAll('#recTable .chip-clamp').forEach(function(el){
              el.classList.toggle('overflowed',el.scrollHeight>el.clientHeight+2);
            });
          },50);
        }
        document.addEventListener('mousemove',onMove);
        document.addEventListener('mouseup',onUp);
      });
      th.appendChild(handle);
    });
  }

  /* 초기 실행 + DB에서 로드 */
  setTimeout(function(){
    if(window.electronAPI&&window.electronAPI.dbGet){
      window.electronAPI.dbGet('common','col_widths').then(function(res){
        /* res 는 {success,exists,data} 응답 — data 를 꺼내야 한다(과거엔 res 전체를 저장해 매 실행마다
         *  {success,exists,data} 가 한 겹씩 쌓여 depth 100+ 손상 → 동기화 skip 되던 버그. 2026-06-08 수정). */
        let v=(res&&res.success&&res.exists)?res.data:null;
        /* 기존 손상값 복구 — 중첩된 {success,exists,data} 래퍼를 실제 값까지 모두 벗긴다. */
        let _guard=0;
        while(v&&typeof v==='object'&&!Array.isArray(v)&&('data' in v)&&('success' in v)&&_guard++<200){ v=v.data; }
        /* 옛 측정 배열 포맷 폐기 (2026-06-11) — 배열이 STORAGE_KEY 로 들어가면 열번호로 오독돼 표 전체 짜부. */
        if(Array.isArray(v)){
          v=null;
          try{ const _ex=JSON.parse(localStorage.getItem(STORAGE_KEY)); if(Array.isArray(_ex))localStorage.removeItem(STORAGE_KEY); }catch(_){}
        }
        if(v&&typeof v==='object'&&Object.keys(v).length){
          localStorage.setItem(STORAGE_KEY,JSON.stringify(v));
          /* 정리된 값으로 DB 도 덮어써 손상 제거(다음 동기화 때 JSON 도 정상화). */
          if(window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',v);
        }
        const t=document.getElementById('recTable');
        if(t)_crApplySaved(t);
        _crInsertHandles();
      }).catch(function(){_crInsertHandles();});
    } else {
      const t=document.getElementById('recTable');
      if(t)_crApplySaved(t);
      _crInsertHandles();
    }
  },500);
  _crInsertHandlesRef=_crInsertHandles;
  _crUndoRef=_crUndo;
  _cwGetPxRef=_cwGetPx;
  _cwSetPxRef=_cwSetPx;
}
export function colWidthUndo(){ return _crUndoRef?_crUndoRef():false; }
export function crInsertHandles(){ if(_crInsertHandlesRef)_crInsertHandlesRef(); }

/* ═══════════════════════════════════════
   VISIT HISTORY (visit-history-view.js에서 통합)
   ═══════════════════════════════════════ */
function _showVisitHistory(){
  const vh=document.getElementById('sideVisitHistory');if(!vh)return;
  vh.style.display='block';
  requestAnimationFrame(function(){requestAnimationFrame(function(){vh.classList.add('vh-show');});});
}
export function _hideVisitHistory(){
  const vh=document.getElementById('sideVisitHistory');if(!vh)return;
  vh.classList.remove('vh-show');
  setTimeout(function(){
    /* 320ms 사이에 _showVisitHistory 가 다시 vh-show 를 add 한 경우 display:none 으로 덮지 않음 —
       증상 팝업 닫은 직후 다른 학생 클릭으로 새 카드를 띄울 때 사라지는 버그 fix. */
    if(!vh.classList.contains('vh-show'))vh.style.display='none';
  },320);
}
/* 사이드바 방문이력 렌더를 그대로 재사용해 {titleHTML, bodyHTML} 캡처 (바디맵·V/S·상담·플래그 포함).
 *  사이드바는 즉시 숨겨 플래시 최소화. 사용자 요청 2026-06-18. */
function _captureVisitHistoryHtml(studentId){
  const stu=getStu(studentId); if(!stu) return {titleHTML:'',bodyHTML:''};
  const prevLock=S._visitHistoryLocked; S._visitHistoryLocked=false;
  try{ showVisitHistory(studentId); }catch(_){}
  const titleEl=document.getElementById('visitHistoryTitle');
  const bodyEl=document.getElementById('visitHistoryBody');
  const titleHTML=titleEl?titleEl.innerHTML:('<div style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(stu.name)+'</div>');
  const bodyHTML=bodyEl?bodyEl.innerHTML:'<div style="padding:12px;text-align:center;color:var(--t3);font-size:11px">방문 이력 없음</div>';
  const _hideSide=function(){ const v=document.getElementById('sideVisitHistory'); if(v){ v.classList.remove('vh-show'); v.style.display='none'; } };
  _hideSide();
  requestAnimationFrame(function(){ requestAnimationFrame(_hideSide); });   /* _showVisitHistory 의 double-rAF 뒤 한 번 더 숨김 */
  S._visitHistoryLocked=prevLock;
  return {titleHTML:titleHTML, bodyHTML:bodyHTML};
}

/* 📋 최근 보건실 방문 이력 보기 — 검색창 내장 독립 팝업 모달. 사용자 요청 2026-06-18. */
export function openRecentVisitModal(){
  const old=document.getElementById('rvBrowserOv'); if(old)old.remove();
  const ov=document.createElement('div'); ov.id='rvBrowserOv';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13060;opacity:0;transition:opacity 0.15s ease';
  ov.innerHTML='<div id="rvBrowserBox" style="background:var(--card);border-radius:14px;width:460px;max-width:94vw;height:80vh;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity 0.18s,transform 0.2s cubic-bezier(0.34,1.4,0.64,1)">'
    +'<div style="padding:14px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px"><span style="font-size:18px">📋</span><div style="font-size:14px;font-weight:800;color:var(--t1)">최근 보건실 방문 이력 보기</div></div>'
    +'<div style="padding:12px 16px;border-bottom:1px solid var(--bdr)"><input id="rvSearchInput" type="text" placeholder="이름으로 검색 (학생·교직원)" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;font-size:13px;padding:9px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);color:var(--t1);font-family:var(--f);outline:none"></div>'
    +'<div id="rvSearchList" style="max-height:34vh;overflow:auto;border-bottom:1px solid var(--bdr);scrollbar-width:thin;scrollbar-color:var(--cyan) var(--bg2)"></div>'
    +'<div id="rvHistArea" style="flex:1;overflow:auto;padding:12px 16px;scrollbar-width:thin;scrollbar-color:var(--cyan) var(--bg2)"><div style="color:var(--t3);font-size:11.5px;text-align:center;padding:20px 0">이름을 검색해 인원을 선택하면<br>최근 보건실 방문 이력이 표시됩니다.</div></div>'
    +'</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('rvBrowserBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('rvBrowserBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.97)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },190); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });

  const inp=document.getElementById('rvSearchInput');
  const listEl=document.getElementById('rvSearchList');
  const histEl=document.getElementById('rvHistArea');
  const _norm=function(s){ return String(s||'').replace(/\s/g,'').toLowerCase(); };
  function _renderList(){
    const q=_norm(inp.value);
    if(!q){ listEl.innerHTML=''; return; }
    const ppl=(S.people||[]).filter(function(p){ return p && p.name && _norm(p.name).indexOf(q)!==-1; });
    if(!ppl.length){ listEl.innerHTML='<div style="padding:12px 16px;color:var(--t3);font-size:11.5px">검색 결과가 없습니다.</div>'; return; }
    ppl.sort(function(a,b){ return String(a.name).localeCompare(String(b.name),'ko'); });
    listEl.innerHTML=ppl.slice(0,60).map(function(p){
      const isStf=p.type==='staff';
      const info=isStf?(p.position||'교직원'):((p.department?p.department+' ':'')+(p.grade!=null?p.grade+'-':'')+(p.cls!=null?p.cls:'')+(p.num?(' '+p.num+'번'):''));
      return '<div class="rv-pick" data-rvid="'+escHtml(String(p.id))+'" style="display:flex;align-items:center;gap:8px;padding:9px 16px;cursor:pointer;border-bottom:1px solid var(--bdr);font-size:12.5px;color:var(--t1)"><span style="font-size:13px">'+(isStf?'👔':'👤')+'</span><span style="font-weight:700">'+escHtml(p.name)+'</span><span style="font-size:10.5px;color:var(--t3)">'+escHtml(info)+'</span></div>';
    }).join('');
  }
  listEl.addEventListener('click',function(e){
    const row=e.target.closest('[data-rvid]'); if(!row)return;
    const cap=_captureVisitHistoryHtml(row.dataset.rvid);
    histEl.innerHTML='<div style="margin:-12px -16px 10px;padding:12px 16px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.08),rgba(139,92,246,0.05))">'+cap.titleHTML+'</div>'+cap.bodyHTML;
    histEl.scrollTop=0;
  });
  inp.addEventListener('input',_renderList);
  setTimeout(function(){ try{ inp.focus(); }catch(_){} },60);
}

/* 📝 방문자 검색 및 일지 작성 — 검색창 내장 독립 팝업. 선택 시 opts.onPick(id) 호출(호출자가 일지 작성 플로우 실행).
 *  사용자 요청 2026-06-18. */
export function openVisitorLogModal(opts){
  opts=opts||{};
  const old=document.getElementById('vlogOv'); if(old)old.remove();
  const ov=document.createElement('div'); ov.id='vlogOv';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13055;opacity:0;transition:opacity 0.15s ease';
  ov.innerHTML='<div id="vlogBox" style="background:var(--card);border-radius:14px;width:440px;max-width:94vw;height:72vh;max-height:84vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity 0.18s,transform 0.2s cubic-bezier(0.34,1.4,0.64,1)">'
    +'<div style="padding:14px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px"><span style="font-size:18px">📝</span><div style="font-size:14px;font-weight:800;color:var(--t1)">방문자 검색 및 일지 작성</div></div>'
    +'<div style="padding:12px 16px;border-bottom:1px solid var(--bdr)"><input id="vlogInput" type="text" placeholder="이름으로 검색 (학생·교직원)" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;font-size:13px;padding:9px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);color:var(--t1);font-family:var(--f);outline:none"></div>'
    +'<div id="vlogList" style="flex:1;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--cyan) var(--bg2)"><div style="color:var(--t3);font-size:11.5px;text-align:center;padding:20px 0">이름을 검색해 방문자를 선택하면<br>증상·처치 입력 후 일반 일지에 기록됩니다.</div></div>'
    +'</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('vlogBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('vlogBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.97)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },190); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  const inp=document.getElementById('vlogInput');
  const listEl=document.getElementById('vlogList');
  const _norm=function(s){ return String(s||'').replace(/\s/g,'').toLowerCase(); };
  function _renderList(){
    const q=_norm(inp.value);
    if(!q){ listEl.innerHTML='<div style="color:var(--t3);font-size:11.5px;text-align:center;padding:20px 0">이름을 검색해 방문자를 선택하면<br>증상·처치 입력 후 일반 일지에 기록됩니다.</div>'; return; }
    const ppl=(S.people||[]).filter(function(p){ return p && p.name && _norm(p.name).indexOf(q)!==-1; });
    if(!ppl.length){ listEl.innerHTML='<div style="padding:14px 16px;color:var(--t3);font-size:11.5px">검색 결과가 없습니다.</div>'; return; }
    ppl.sort(function(a,b){ return String(a.name).localeCompare(String(b.name),'ko'); });
    listEl.innerHTML=ppl.slice(0,60).map(function(p){
      const isStf=p.type==='staff';
      const info=isStf?(p.position||'교직원'):((p.department?p.department+' ':'')+(p.grade!=null?p.grade+'-':'')+(p.cls!=null?p.cls:'')+(p.num?(' '+p.num+'번'):''));
      return '<div class="vlog-pick" data-vid="'+escHtml(String(p.id))+'" style="display:flex;align-items:center;gap:8px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--bdr);font-size:12.5px;color:var(--t1)"><span style="font-size:13px">'+(isStf?'👔':'👤')+'</span><span style="font-weight:700">'+escHtml(p.name)+'</span><span style="font-size:10.5px;color:var(--t3)">'+escHtml(info)+'</span></div>';
    }).join('');
  }
  listEl.addEventListener('click',function(e){
    const row=e.target.closest('[data-vid]'); if(!row)return;
    const id=row.dataset.vid;
    close();
    if(typeof opts.onPick==='function'){ try{ opts.onPick(id); }catch(_){} }
  });
  inp.addEventListener('input',_renderList);
  setTimeout(function(){ try{ inp.focus(); }catch(_){} },60);
}
export function showVisitHistory(studentId){
  if(S._dragSelectedRecIds&&S._dragSelectedRecIds.length>0)return;
  if(window._dd&&window._dd.active)return;
  const _ss=document.getElementById('sideSearch');
  const _sideSearchResults=document.getElementById('sideSearchResults');
  const _sideSearching=_ss&&_ss.value.trim().length>0&&_sideSearchResults&&_sideSearchResults.innerHTML.length>0;
  if(_sideSearching)return;
  if(S._visitHistoryLocked)return;
  const stu=getStu(studentId);
  /* 학생 데이터 못 찾으면 안전 종료 — 이전엔 stu.status 접근으로 silent TypeError */
  if(!stu)return;
  const panel=document.getElementById('sideVisitHistory');
  const title=document.getElementById('visitHistoryTitle');
  const body=document.getElementById('visitHistoryBody');
  if(!panel||!body)return;
  if(panel.classList.contains('vh-show')&&panel._lastStuId&&panel._lastStuId!==studentId){
    /* fade out/in 으로 학생 전환 시 시각적 컨텍스트 단절 표시. 0.08s + 70ms wait 로 단축 — 이전 ~310ms → ~150ms.
     * 단, 증상 선택 및 처치 팝업이 열려 있는 동안에는 페이드를 건너뛴다 — 팝업 켜는 순간 카드 깜빡임 방지. */
    if(!document.getElementById('symCatOverlay')){
      body.style.transition='opacity 0.08s';body.style.opacity='0';
      setTimeout(function(){body.style.opacity='1';},70);
    }
  }
  panel._lastStuId=studentId;
  const isCare=stu.status==='caution'||stu.status==='watch';
  const isStf=stu.type==='staff';
  /* 학년반 앞 prefix 우선순위 (자동완성 getStuAutoLine 과 동일):
   *  1) 학과가 있으면 학과를 반 왼편에 표기 — 학과별로 1반부터 시작해 한 학년에 1반이 여럿이므로 필수
   *  2) 학과 없고 학교급이 여러 개 혼재면 학교급 prefix (예: "초 4-4 6번")
   *  3) 단일 학교급이면 prefix 없음 (예: "4-4 6번") */
  const _vhDept=(!isStf && stu.department && String(stu.department).trim()) ? String(stu.department).trim() : '';
  const _vhPrefix=isStf ? '' : (_vhDept ? (_vhDept+' ') : ((hasMultipleSchoolLevels() && getLevelShort(stu)) ? (getLevelShort(stu)+' ') : ''));
  const infoStr=isStf?(stu.position||'교직원'):(_vhPrefix+stu.grade+'-'+stu.cls+' '+stu.num+'번');
  const guardianType=getGuardianType(stu);
  const guardianContact=getGuardianContact(stu);
  const birth=getStudentBirth(stu);
  /* 사용자 설정: 생년월일·연락처 팝업 ON/OFF (보건일지 설정 > "생년월일·주보호자 연락처 팝업 오픈 설정").
   * 기본 ON. OFF 면 입력값이 있어도 표시 안 함. */
  const _binfoOn = (localStorage.getItem('ec_daily_birthcontact_popup')||'Y') !== 'N';
  const birthInfo=(!_binfoOn||isStf)?'':'<div style="font-size:10px;color:var(--t3);margin-top:2px">생년월일: '+escHtml(birth)+'</div>';
  const guardianInfo=(!_binfoOn||isStf||!guardianContact||!String(guardianContact).trim())?'':'<div style="font-size:10px;color:var(--t2);margin-top:2px">주 보호자 연락처: '+escHtml(guardianContact)+'</div>';
  const careInfo=(isCare&&stu.condition)?'<div style="font-size:10px;color:var(--yl);margin-top:2px">요보호 질환명: '+escHtml(stu.condition)+'</div>':'';
  const dustInfo=(stu.dustDisease&&String(stu.dustDisease).trim())?'<div style="font-size:10px;color:#0ea5e9;margin-top:2px">미세먼지 기저질환: '+escHtml(stu.dustDisease)+'</div>':'';
  const careMemoInfo=(isCare&&getCareMemoText(stu))?'<div style="font-size:10px;color:var(--yl);margin-top:2px">메모 사항: '+escHtml(getCareMemoText(stu))+'</div>':'';
  /* 5종 상태 칩 — 이름 오른쪽. (요보호·관찰·미세먼지 기저질환·응급처치비동의·일반의약품비동의) */
  const _vhDots=(function(s){
    const chips=[];
    if(s.status==='caution') chips.push({c:'#f97316', t:'요보호'});
    if(s.status==='watch')   chips.push({c:'#eab308', t:'관찰'});
    if(s.dustDisease && String(s.dustDisease).trim()) chips.push({c:'#0ea5e9', t:'미세먼지 기저질환'});
    if(s.emergencyConsent==='N') chips.push({c:'#dc2626', t:'응급처치 비동의'});
    if(s.medConsent==='N')       chips.push({c:'#a855f7', t:'일반의약품 비동의'});
    if(!chips.length) return '';
    return '<span style="display:inline-flex;gap:4px;margin-left:6px;align-items:center;flex-wrap:wrap">'
      + chips.map(function(x){
          return '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:9px;font-size:9.5px;font-weight:700;color:'+x.c+';background:'+x.c+'14;border:1px solid '+x.c+'4d"><span style="width:6px;height:6px;border-radius:50%;background:'+x.c+'"></span>'+x.t+'</span>';
        }).join('')
      + '</span>';
  })(stu);
  /* 명단에서 빠진(전출·자퇴·졸업·전근·퇴직) 인원은 번호 옆에 [현재 미등록 인원] 대괄호 회색 텍스트 (오해 소지 방지) */
  const _leaverBadge = stu._isLeaver
    ? '<span style="font-size:10px;color:var(--t3)">[현재 미등록 인원]</span>'
    : '';
  /* [전체 이력 확인] — 사이드 카드에서 바로 전체 방문 이력 팝업 열기 (사용자 피드백 2026-08-26) */
  title.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px"><span style="font-size:11px;font-weight:700;color:var(--t2)">최근 보건실 방문 이력</span><button id="vhFullHistBtn" style="padding:2px 8px;font-size:9.5px;font-weight:700;background:rgba(34,197,94,0.08);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:6px;cursor:pointer;font-family:var(--f);white-space:nowrap">전체 이력 확인</button></div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-size:13px;font-weight:800;color:var(--t1)">${escHtml(stu.name)}</span><span style="font-size:10px;color:var(--t3)">${escHtml(infoStr)}</span>${_leaverBadge}${_vhDots}</div>${birthInfo}${guardianInfo}${careInfo}${dustInfo}${careMemoInfo}`;
  const _vhFullBtn=title.querySelector('#vhFullHistBtn');
  if(_vhFullBtn)_vhFullBtn.addEventListener('click',function(e){
    e.stopPropagation();
    _symShowHistory(studentId);   /* curRecId 없음 → 현재 일지 제외 없이 전체 이력 표시 */
  });
  /* 이력 누락 수정 (2026-08-26) — studentId 타입 혼재·personUid 엇갈림 레코드도 포함 */
  const _vhKeys=stuKeySet(studentId);
  const stuRecs=S.records.filter(r=>recInStuKeys(r,_vhKeys)).sort((a,b)=>b.date.localeCompare(a.date)||b.timeIn.localeCompare(a.timeIn));
  if(!stuRecs.length){body.innerHTML='<div style="padding:12px;text-align:center;color:var(--t3);font-size:11px">방문 이력 없음</div>';_showVisitHistory();return;}
  const _emsSaved=JSON.parse(localStorage.getItem('ec_ems_saved')||'[]');
  body.innerHTML=stuRecs.map(r=>{
    const hasEms=_emsSaved.some(function(s){return s.name===stu.name&&s.date&&s.date.startsWith(r.date);});
    const emsChip=hasEms?'<div style="font-size:9px;font-weight:800;color:#ef4444;margin-bottom:2px">🚑 구급대 이송 경험</div>':'';
    /* 증상은 처치와 동일한 글 형태로 표시 (사용자 요청 — 칩 톤이 시각적 노이즈 됨).
     * 부위/메모를 감싸는 () → []로 변환 (투약 표기 [약명 ...]와 통일). */
    const _symList=(r.symptoms||[]).map(function(_s){
      const _m=String(_s).match(/^(.+?)\((.*)\)\s*$/);
      return _m?(_m[1].trim()+'['+_m[2]+']'):_s;
    });
    const _medDisp=r.medication?formatMedicationDisplay(r.medication):'';
    /* v3 (사용자 결정 2026-05-21) — V/S 측정 칩에 값 부착: "V/S 측정 (BP: 150/100, T: 38.7)" */
    const _vsStr=_vsValueStr(r);
    /* v3 (사용자 결정 2026-05-21) — 다중 증상 + treatmentBySym 있으면 증상별 분기 표시.
     *  · 형식: "설사 → 정로환, 보건교육" 줄 + "두통 → 타이레놀, 침상 안정" 줄
     *  · record-level (침상·V/S) 처치는 첫 번째 증상 줄에 함께 표시
     *  · sym 별 약품은 r.medsBySym[sym] / r.medDosesBySym[sym] 에서 가져옴
     *  · 단일 증상 또는 옛 일지(treatmentBySym 없음) → 기존 한 줄 표시 */
    /* 일지 표·전체 이력과 동일한 분기/미분기 표시 기준을 사용한다. */
    const _isMultiSym = shouldShowTreatmentBySymptom(r);
    let _sympHtml, _treatHtml, _medTail;
    if(_isMultiSym){
      const _medStrForSym = function(sym){
        if(!r.medsBySym || !r.medsBySym[sym] || !r.medsBySym[sym].length) return '';
        var dm = (r.medDosesBySym && r.medDosesBySym[sym]) || {};
        return formatMedicationDisplay(r.medsBySym[sym].map(function(m){var d=dm[m]||''; return d?(m+'('+d+')'):m;}).join(', '));
      };
      /* v3 (2026-05-28) — V/S·침상도 per-symptom. 각 증상 행에 그 증상 처치만 (record-level 공유 폐지).
       *  V/S 측정 라벨의 값(BP·T 등) 부착은 해당 증상 행에서 처리. */
      /* 상담 처치란 문구 — 맵에 없고 flat 에만 있으므로 상담 층에 직접 합류 (사용자 보고 2026-08-25) */
      const _clTreatH=counselTreatText(r);
      const _clSymIdxH=_clTreatH?r.symptoms.findIndex(isCounselSymLabel):-1;
      const _lines = r.symptoms.map(function(sym, idx){
        var _spl=String(sym).match(/^(.+?)\s*\((.*)\)\s*$/);
        var _symDisp = _spl ? (_spl[1].trim()+'['+_spl[2]+']') : sym;
        var symTreats = ((r.treatmentBySym||{})[sym]||[]);
        var medDispForSym = _medStrForSym(sym);
        var symLabeled = symTreats.map(function(t){
          var _b=t; var _bm=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(_bm)_b=_bm[1].trim();
          if(_b==='투약' && medDispForSym) return medDispForSym;
          if(_b==='V/S 측정' && _vsStr) return 'V/S 측정 ' + _vsStr;
          return t;
        });
        if(idx===_clSymIdxH) symLabeled.push(_clTreatH);
        var treatStr = symLabeled.join(', ') || '-';
        /* 사용자 보고 2026-05-22 — 자유 기입 증상이 길어 사이드바 카드 폭 초과 시 가로 스크롤 발생 → word-break 로 자동 줄바꿈.
         *  사용자 요청 2026-05-22 추가 — 장문이라도 화살표(→) 가 처치 앞에 항상 명확히 따라가게:
         *    → 를 처치 span 안의 prefix 로 묶어, 처치가 줄바꿈되어도 → 가 처치 첫 글자 앞에서 함께 wrap.
         *  사용자 요청 2026-05-22 추가 — 자유 기입 또는 중분류+자유 추가 기입 케이스 (증상 텍스트가 길 때) 에는
         *    → 화살표·처치 자체를 무조건 다음 줄로 내려 처치 가로 영역 확보 (증상 span 에 flex-basis:100% 적용).
         *    짧은 일반 증상 (12자 미만) 은 종전과 같이 같은 줄. word-break 는 한국어 어절 단위 (keep-all). */
        var _symLong = String(_symDisp || '').length >= 12;
        return '<div style="display:flex;flex-wrap:wrap;gap:6px 6px;align-items:baseline;margin-top:'+(idx===0?'0':'3px')+';min-width:0">'
             + '<span style="font-size:10.5px;font-weight:700;color:var(--cyan);word-break:keep-all;overflow-wrap:break-word;'+(_symLong?'flex-basis:100%;width:100%':'')+'">'+escHtml(_symDisp)+'</span>'
             + '<span style="font-size:10.5px;color:var(--t1);font-weight:500;word-break:keep-all;overflow-wrap:break-word;min-width:0;flex:1"><span style="color:var(--t3);margin-right:6px;font-weight:700">→</span>'+escHtml(treatStr)+'</span>'
             + '</div>';
      });
      _sympHtml='';
      _treatHtml=_lines.join('') + (r.treatmentMemo?'<div style="margin-top:3px;font-size:10px;color:var(--t2);font-style:italic">'+escHtml(r.treatmentMemo)+'</div>':'');
      _medTail='';
    } else {
      /* 단일 증상 또는 옛 일지 — multi-symptom 와 동일하게 "증상 → 처치" 화살표 포맷 (사용자 요청 2026-05-24). */
      const _symDisp = _symList.join(', ') || '-';
      const _treatLabeled=(r.treatment||[]).map(function(t){
        if(t==='투약'&&_medDisp)return _medDisp;
        if(t==='V/S 측정' && _vsStr) return 'V/S 측정 ' + _vsStr;
        return t;
      });
      /* 정합성 통일 (2026-06-22) — 일반일지 표(2068~)와 동일 기준: r.treatment 에 '투약' 칩이 있을 때만 약품 표시.
       *  treatment 에 '투약'이 없는데 r.medication 문자열만 stale 로 남은 경우를 사이드바에만 노출하던 불일치 제거.
       *  데이터는 변경하지 않고, 읽어서 그리는 규칙만 일반일지와 일치시킨다. */
      const _treatList = _treatLabeled.slice();
      const _treatBase=_treatList.join(', ');
      const _treatCombo=(_treatBase+(r.treatmentMemo?((_treatBase?' / ':'')+r.treatmentMemo):''))||'-';
      const _symLong = String(_symDisp || '').length >= 12;
      /* 미분기(다중 증상 합쳐 표시)면 화살표·처치를 증상 아래 줄로 내림 (사용자 요청 2026-06-09). 단일 증상은 종전(짧으면 같은 줄). */
      const _forceBelow = _symLong || (Array.isArray(r.symptoms) && r.symptoms.length>1);
      _sympHtml='';
      _treatHtml='<div style="display:flex;flex-wrap:wrap;gap:6px 6px;align-items:baseline;min-width:0">'
        + '<span style="font-size:10.5px;font-weight:700;color:var(--cyan);word-break:keep-all;overflow-wrap:break-word;'+(_forceBelow?'flex-basis:100%;width:100%':'')+'">'+escHtml(_symDisp)+'</span>'
        + '<span style="font-size:10.5px;color:var(--t1);font-weight:500;word-break:keep-all;overflow-wrap:break-word;min-width:0;flex:1"><span style="color:var(--t3);margin-right:6px;font-weight:700">→</span>'+escHtml(_treatCombo)+'</span>'
        + '</div>';
      _medTail='';
    }
    /* 이전기록(imported)은 timeOut 없으면 "~" 자체 생략. 일반 기록은 timeOut 없을 때만 "진행중" */
    const _timeRange = r.isImported
      ? (r.timeIn ? escHtml(r.timeIn) + (r.timeOut ? '~'+escHtml(r.timeOut) : '') : '')
      : (escHtml(r.timeIn) + '~' + escHtml(r.timeOut||'진행중'));
    /* 바디맵 부위 — 날짜와 증상 사이. 기존 기록도 r.bodymapData 폴백으로 표시 (사용자 요청 2026-06-16) */
    const _vhBmArr = (window._bmData && window._bmData[r.id]) ? window._bmData[r.id] : (r.bodymapData||[]);
    const _vhParts=[]; (_vhBmArr||[]).forEach(function(m){ if(m&&m.label && _vhParts.indexOf(m.label)===-1) _vhParts.push(m.label); });
    const _vhBodymapHtml = _vhParts.length ? `<div style="font-size:10px;color:#6d28d9;font-weight:600;margin-top:3px"><span style="color:#7c3aed;font-weight:700">바디맵 부위:</span> ${escHtml(_vhParts.join(', '))}</div>` : '';
    return `<div style="padding:9px 0;border-bottom:1px solid var(--bdrl)"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-family:var(--fm);font-size:11px;color:var(--t2);font-weight:600">${escHtml(r.date)} ${_timeRange}</span>${r.isImported?'<span style="font-size:9.5px;padding:2px 6px;border-radius:6px;background:rgba(99,102,241,0.18);color:#6366f1;font-weight:800;margin-right:8px">이전기록</span>':''}</div>${_vhBodymapHtml}${(emsChip||_sympHtml)?`<div style="margin-top:4px">${emsChip}${_sympHtml}</div>`:''}<div style="font-size:11px;color:var(--t1);margin-top:3px;font-weight:500">${_treatHtml}${_medTail}</div></div>`;
  }).join('');
  _showVisitHistory();
  setTimeout(function(){
    const footer=document.querySelector('footer');
    const bodyEl=document.getElementById('visitHistoryBody');
    if(footer&&bodyEl){
      const footerTop=footer.getBoundingClientRect().top;
      const bodyTop=bodyEl.getBoundingClientRect().top;
      const available=footerTop-bodyTop-18;
      bodyEl.style.maxHeight=Math.max(100,available)+'px';
    }
  },0);
}

/* ═══════════════════════════════════════
   MEMO (memo-view.js에서 통합)
   ═══════════════════════════════════════ */
const _memoPostitColors=['#fffde7','#fce4ec','#e3f2fd','#e8f5e9','#fff3e0','#f3e5f5','#e0f7fa','#fff8e1','#fbe9e7','#ede7f6'];
let _memoSaveTimer=null;
function _memoSaveToDB(stuId){
  localStorage.setItem('ec_memos',JSON.stringify(S.memoData));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','memos',S.memoData);
  if(stuId&&window.electronAPI&&window.electronAPI.studentsUpdateMemo){
    const slots=S.memoData[stuId]||[];
    window.electronAPI.studentsUpdateMemo(stuId,JSON.stringify(slots)).catch(function(){});
  }
}
function _memoGetSlots(stuId){
  const key=stuId;
  let raw=S.memoData[key];
  if(typeof raw==='string'){const arr=[{text:raw,ts:''}];S.memoData[key]=arr;_memoSaveToDB(key);return arr;}
  if(Array.isArray(raw)){
    let migrated=false;
    raw=raw.map(function(s){if(typeof s==='string'){migrated=true;return s?{text:s,ts:''}:null;}return s;}).filter(Boolean);
    if(migrated){S.memoData[key]=raw;_memoSaveToDB(key);}
    return raw;
  }
  return raw||[];
}
export function _memoHasAny(stuId){
  const slots=_memoGetSlots(stuId);
  return slots.some(function(s){return s&&s.text&&s.text.trim();});
}
function _memoNowStr(){
  const d=new Date();
  return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function _memoSaveSlot(stuId,idx,text){
  const key=stuId;
  if(!S.memoData[key])S.memoData[key]=[];
  if(text&&text.trim()){
    S.memoData[key][idx]={text:text,ts:_memoNowStr()};
    const tsEl=document.getElementById('memoTs_'+idx);
    if(tsEl)tsEl.textContent=S.memoData[key][idx].ts;
  } else {
    S.memoData[key][idx]=null;
    const tsEl2=document.getElementById('memoTs_'+idx);
    if(tsEl2)tsEl2.textContent='';
  }
  if(!S.memoData[key].some(function(s){return s&&s.text&&s.text.trim();}))delete S.memoData[key];
  _memoSaveToDB(stuId);
  let ind=document.getElementById('memoSaveIndicator');
  if(!ind){ind=document.createElement('div');ind.id='memoSaveIndicator';ind.className='ec-save-indicator';ind.style.zIndex='9999';document.body.appendChild(ind);}
  ind.textContent='저장 중…';
  ind.className='ec-save-indicator saving';ind.style.zIndex='9999';
  if(_memoSaveTimer)clearTimeout(_memoSaveTimer);
  _memoSaveTimer=setTimeout(function(){
    ind.textContent='모든 내용이 저장되었습니다.';
    ind.className='ec-save-indicator saved';ind.style.zIndex='9999';
    setTimeout(function(){ind.className='ec-save-indicator hide';},3000);
  },300);
}
function closeMemoPopup(){
  const ov=document.getElementById('memoOverlay');
  if(ov){
    if(ov._escHandler)document.removeEventListener('keydown',ov._escHandler);
    closeModalGracefully(ov);
  }
  renderDaily();
}
export function openMemoPanel(stuId){
  closeMemoPopup();
  const stu=getStu(stuId);
  const stuName=stu?(stu.name||'학생'):'학생';
  const slots=_memoGetSlots(stuId);
  const ov=document.createElement('div');
  ov.className='modal-overlay show';ov.id='memoOverlay';ov.style.background='rgba(0,0,0,0.25)';ov.style.zIndex='10000';
  let h='<div class="modal-content" style="width:1060px;max-width:96vw;padding:0;overflow:hidden">'
    +'<div class="vp-header"><span class="vp-header-title">📝 주의사항(메모) — '+escHtml(stuName)+'</span></div>'
    +'<div style="padding:10px 16px 0;font-size:10px;color:var(--t3);line-height:1.5">포스트잇에 메모를 입력하면 자동 저장됩니다. 이 학생이 다음에 방문해도 메모가 유지됩니다.</div>'
    +'<div class="memo-grid">';
  for(let i=0;i<10;i++){
    const slot=slots[i]||null;
    const val=slot?slot.text:'';
    const ts=slot?slot.ts||'':'';
    h+='<div class="memo-postit" style="background:'+_memoPostitColors[i]+'">'
      +'<div class="memo-postit-meta"><span class="memo-postit-idx">'+(i+1)+'</span><span class="memo-postit-ts" id="memoTs_'+i+'">'+escHtml(ts)+'</span></div>'
      +'<textarea data-memo-idx="'+i+'" data-stu-id="'+stuId+'" placeholder="메모 입력...">'+escHtml(val)+'</textarea>'
      +'</div>';
  }
  h+='</div></div>';
  ov.innerHTML=h;
  /* 외부 클릭으로 닫기 — mousedown + click 양쪽 + ESC 키 */
  function _memoCloseIfOutside(e){if(e.target===ov)closeMemoPopup();}
  ov.addEventListener('mousedown',_memoCloseIfOutside);
  ov.addEventListener('click',_memoCloseIfOutside);
  function _memoEscHandler(e){if(e.key==='Escape'){closeMemoPopup();document.removeEventListener('keydown',_memoEscHandler);}}
  document.addEventListener('keydown',_memoEscHandler);
  ov._escHandler=_memoEscHandler;
  /* textarea oninput을 addEventListener로 바인딩 */
  ov.querySelectorAll('textarea[data-memo-idx]').forEach(function(ta){
    ta.addEventListener('input',function(){_memoSaveSlot(ta.dataset.stuId,parseInt(ta.dataset.memoIdx,10),ta.value);});
  });
  document.body.appendChild(ov);
}
export function toggleMemo(stuId,recId,btn){openMemoPanel(stuId);}

/* ═══════════════════════════════════════
   CELL EDIT (cell-edit-view.js에서 통합)
   ═══════════════════════════════════════ */
let activeCellPopup=null;
let _editingCell=null;
function _markEditingCell(el){
  _clearEditingCell();
  if(!el)return;
  const cell=el.closest?el.closest('td'):null;
  _editingCell=cell||el;
  if(_editingCell)_editingCell.classList.add('cell-editing');
}
function _clearEditingCell(){
  if(_editingCell)_editingCell.classList.remove('cell-editing');
  _editingCell=null;
}
function clearAllEditingCells(){
  document.querySelectorAll('.cell-editing').forEach(function(el){el.classList.remove('cell-editing');});
  _editingCell=null;
}
export function closeCellPopup(){
  if(activeCellPopup){activeCellPopup.remove();activeCellPopup=null;}
  _clearEditingCell();
}
function openCellEdit(recId,field,btn){
  if(field==='symptoms'){openSymptomCategoryPopup(recId);return;}
  closeCellPopup();
  _markEditingCell(btn);
  const rect=btn.getBoundingClientRect();
  const popup=document.createElement('div');
  popup.className='cell-ac-popup';
  popup.style.position='fixed';
  popup.style.top=(rect.bottom+2)+'px';
  popup.style.left=rect.left+'px';
  const input=document.createElement('input');
  input.className='form-input';
  input.style.cssText='font-size:11px;padding:6px 8px;border-radius:6px 6px 0 0;width:100%;border-bottom:1px solid var(--bdr)';
  input.placeholder='입력...';
  const listDiv=document.createElement('div');
  listDiv.style.maxHeight='140px';listDiv.style.overflowY='auto';
  popup.appendChild(input);
  popup.appendChild(listDiv);
  document.body.appendChild(popup);
  activeCellPopup=popup;
  input.focus();
  let hlIdx=-1;
  const allCands=getCandidates(field);
  function renderList(q){
    const filtered=q?allCands.filter(c=>c.toLowerCase().includes(q.toLowerCase())):allCands;
    hlIdx=-1;
    listDiv.innerHTML=filtered.map((c,i)=>`<div class="cell-ac-item" data-idx="${i}">${escHtml(c)}</div>`).join('');
    listDiv.querySelectorAll('.cell-ac-item').forEach(el=>{el.addEventListener('click',()=>selectItem(el.textContent));});
  }
  function selectItem(val){
    const rec=getDailyRecord(recId);
    if(!rec){closeCellPopup();return;}
    if(field==='symptoms'){if(!rec.symptoms.includes(val))rec.symptoms.push(val);const dept=getDeptForSymptom(val);if(dept&&!rec.dept)rec.dept=dept;}
    else if(field==='dept'){rec.dept=rec.dept?(rec.dept+', '+val):val;}
    else if(field==='treatment'){if(!rec.treatment.includes(val))rec.treatment.push(val);}
    else if(field==='medication'){rec.medication=rec.medication?(rec.medication+', '+val):val;}
    rec._dirty=true;saveRecordNow(rec);closeCellPopup();renderDaily();
  }
  input.oninput=()=>renderList(input.value);
  input.onkeydown=(e)=>{
    const items=listDiv.querySelectorAll('.cell-ac-item');
    if(e.key==='ArrowDown'){e.preventDefault();hlIdx=Math.min(hlIdx+1,items.length-1);items.forEach((el,i)=>el.classList.toggle('highlighted',i===hlIdx));}
    else if(e.key==='ArrowUp'){e.preventDefault();hlIdx=Math.max(hlIdx-1,0);items.forEach((el,i)=>el.classList.toggle('highlighted',i===hlIdx));}
    else if(e.key==='Enter'){e.preventDefault();if(hlIdx>=0&&items[hlIdx])selectItem(items[hlIdx].textContent);else if(input.value.trim())selectItem(input.value.trim());}
    else if(e.key==='Escape')closeCellPopup();
  };
  renderList('');
  setTimeout(()=>{document.addEventListener('click',function cl(e){if(!popup.contains(e.target)&&e.target!==btn){closeCellPopup();document.removeEventListener('click',cl);}});},10);
}

let vsOriginal={temp:'',bp:'',pulse:'',resp:'',spo2:'',bst:''};
/* 일반일지표에서 시간대별 V/S 표를 '펼친' record id 집합 (세션 한정). '시간별 입력' 칩으로 토글. (2026-06-15) */
let _vsExpandedRids=new Set();   /* V/S '자세히' 열린 rec id (기본 간략히=닫힘) */
let _paExpandedRids=new Set();   /* 신체사정 '자세히' 열린 rec id (기본 간략히=닫힘) */
/* V/S 값 표 HTML(표만 반환) — 시각·체온·혈압·맥박·호흡·SpO₂·BST. 단일 측정은 1행. 값 없으면 '' (2026-07-21 처치칸 인라인용으로 전환) */
function _vsTableHtml(r){
  const _hms=function(t){const m=String(t||'').match(/(\d{1,2}):(\d{2})/);return m?(parseInt(m[1],10)*60+parseInt(m[2],10)):999999;};
  let rows=(r.vsHistory||[]).slice().sort(function(a,b){return _hms(a.t)-_hms(b.t);});
  /* 시간대별 기록이 없고 단일 V/S 값만 있으면 1행 표로 표시(신체사정처럼 값이 있으면 항상 표). 2026-07-21 */
  if(!rows.length && (r.temp||r.bp||r.pulse||r.resp||r.respiration||r.spo2||r.bst)){
    rows=[{t:(r.timeIn||''),temp:r.temp||'',bp:r.bp||'',pulse:r.pulse||'',resp:(r.respiration||r.resp||''),spo2:r.spo2||'',bst:r.bst||''}];
  }
  if(!rows.length) return '';
  const cols=[['t','시각'],['temp','체온'],['bp','혈압'],['pulse','맥박'],['resp','호흡'],['spo2','SpO₂'],['bst','BST']];
  /* 이상 수치 판정 — 기존 _vitalThresholds(상한) + SpO₂<95 + BST≥200. 이상이면 빨간색 (사용자 요청 2026-06-15) */
  const _T=(typeof _vitalThresholds!=='undefined'&&_vitalThresholds)?_vitalThresholds:{temp:37.8,bpSystolic:140,bpDiastolic:90,pulse:100,resp:22};
  const _vsAbn=function(field,v){
    if(!v||v==='-')return false;
    if(field==='temp'){const n=parseFloat(v);return isFinite(n)&&n>=(_T.temp||37.8);}
    if(field==='bp'){const p=String(v).split('/');const s=parseInt(p[0],10),d=parseInt(p[1],10);return (isFinite(s)&&s>=(_T.bpSystolic||140))||(isFinite(d)&&d>=(_T.bpDiastolic||90));}
    if(field==='pulse'){const n=parseInt(v,10);return isFinite(n)&&n>=(_T.pulse||100);}
    if(field==='resp'){const n=parseInt(v,10);return isFinite(n)&&n>=(_T.resp||22);}
    if(field==='spo2'){const n=parseInt(v,10);return isFinite(n)&&n<95;}
    if(field==='bst'){const n=parseInt(v,10);return isFinite(n)&&n>=200;}
    return false;
  };
  let t='<table style="border-collapse:collapse;font-size:10px;margin:0">';
  t+='<tr>'+cols.map(function(c){return '<th style="border:1px solid var(--bdr);padding:3px 12px;background:var(--bg2);color:var(--t2);font-weight:700;font-size:9.5px;white-space:nowrap">'+c[1]+'</th>';}).join('')+'</tr>';
  rows.forEach(function(rw){ t+='<tr>'+cols.map(function(c){const v=String(rw[c[0]]==null?'':rw[c[0]]).trim();const abn=_vsAbn(c[0],v);return '<td style="border:1px solid var(--bdr);padding:3px 12px;text-align:center;white-space:nowrap;'+(abn?'color:#ef4444;font-weight:800':'color:var(--t1)')+'">'+escHtml(v||'-')+'</td>';}).join('')+'</tr>'; });
  t+='</table>';
  return t;
}

/* 신체사정 값 표 HTML(표만 반환) — 시진·촉진·타진·청진 + 소견. 체크·소견 있는 항목만. 없으면 '' (2026-07-21 처치칸 인라인용으로 전환) */
function _paTableHtml(r){
  const pa=r&&r.physicalAssessment;
  if(!pa||typeof pa!=='object'||Array.isArray(pa))return '';
  const items=Array.isArray(pa.items)?pa.items:[];
  const details=(pa.details&&typeof pa.details==='object'&&!Array.isArray(pa.details))?pa.details:{};
  const order=['시진','촉진','타진','청진'];
  const shown=order.filter(function(it){return items.indexOf(it)!==-1||(details[it]&&String(details[it]).trim());});
  if(!shown.length)return '';
  /* 소견 열은 실제로 적은 소견이 하나라도 있을 때만 표시 — 없으면 빈 소견 열이 뜨지 않게 (사용자 요청 2026-07-20) */
  const _anyDetail=shown.some(function(it){return details[it]&&String(details[it]).trim();});
  const _th='border:1px solid var(--bdr);padding:3px 12px;background:var(--bg2);color:var(--t2);font-weight:700;font-size:9.5px;white-space:nowrap';
  const _td='border:1px solid var(--bdr);padding:3px 12px;font-size:10px';
  let t='<table style="border-collapse:collapse;font-size:10px;margin:0">';
  t+='<tr><th style="'+_th+'">🩺 신체사정</th>'+(_anyDetail?'<th style="'+_th+'">소견</th>':'')+'</tr>';
  shown.forEach(function(it){
    const d=details[it]?String(details[it]).trim():'';
    t+='<tr><td style="'+_td+';color:var(--t1);text-align:center;white-space:nowrap;font-weight:600">'+escHtml(it)+'</td>'+(_anyDetail?('<td style="'+_td+';color:var(--t1);word-break:break-word">'+escHtml(d)+'</td>'):'')+'</tr>';
  });
  t+='</table>';
  return t;
}
function vsAutoSave(recId){
  const r=getDailyRecord(recId);if(!r)return;
  /* 사용자 보고 2026-05-27 — input ID 에 recId 포함하지 않으면 두 모달 DOM 공존 시
   *  document.getElementById 가 첫 매치(다른 학생 모달의 input)를 반환해서 학생 데이터가 오염됨.
   *  ID 에 recId 붙여 모달별 unique 보장. */
  const _g=function(id){return document.getElementById(id+'_'+recId)||document.getElementById(id);};
  r.temp=(_g('vsTemp')||{}).value||'';
  r.bp=(_g('vsBp')||{}).value||'';
  r.pulse=(_g('vsPulse')||{}).value||'';
  const _respVal=(_g('vsResp')||{}).value||'';
  r.resp=_respVal; r.respiration=_respVal; /* 호흡수 양쪽 필드 동기화 (DB 로드는 respiration 에 들어옴) */
  r.spo2=(_g('vsSpo2')||{}).value||'';
  r.bst=(_g('vsBst')||{}).value||'';
  r._dirty=true;vsCheckAlert();
  saveRecordNow(r);renderDaily();
}
let _vitalThresholds={temp:37.8,bpSystolic:140,bpDiastolic:90,pulse:100,resp:22};
if(window.electronAPI&&window.electronAPI.medicalGetVitalThresholds){
  window.electronAPI.medicalGetVitalThresholds().then(function(res){
    if(res&&res.success&&res.data)_vitalThresholds=res.data;
  }).catch(function(){});
}
function vsCheckAlert(){
  /* 현재 활성 V/S 팝업 안의 input 만 검사 (다른 학생 모달 fade-out 중 첫 매치가 잘못된 모달을 잡지 않도록) */
  const _pop=activeCellPopup||document;
  const t=_pop.querySelector('[id^="vsTemp"]');
  const b=_pop.querySelector('[id^="vsBp"]');
  const p=_pop.querySelector('[id^="vsPulse"]');
  const re=_pop.querySelector('[id^="vsResp"]');
  if(t)t.style.color=parseFloat(t.value)>=_vitalThresholds.temp?'#ef4444':'var(--t1)';
  if(b){const bv=b.value.split('/');const high=parseInt(bv[0])>=_vitalThresholds.bpSystolic||parseInt(bv[1])>=_vitalThresholds.bpDiastolic;b.style.color=high?'#ef4444':'var(--t1)';}
  if(p)p.style.color=parseInt(p.value)>=_vitalThresholds.pulse?'#ef4444':'var(--t1)';
  if(re)re.style.color=parseInt(re.value)>=_vitalThresholds.resp?'#ef4444':'var(--t1)';
}
function vsRestore(recId){
  const r=getDailyRecord(recId);if(!r)return;
  r.temp=vsOriginal.temp;r.bp=vsOriginal.bp;r.pulse=vsOriginal.pulse;r.resp=vsOriginal.resp;r.respiration=vsOriginal.resp;r.spo2=vsOriginal.spo2;r.bst=vsOriginal.bst;r._dirty=true;saveRecordNow(r);
  const _g=function(id){return document.getElementById(id+'_'+recId)||document.getElementById(id);};
  const t=_g('vsTemp');if(t)t.value=vsOriginal.temp;
  const b=_g('vsBp');if(b)b.value=vsOriginal.bp;
  const p=_g('vsPulse');if(p)p.value=vsOriginal.pulse;
  const re=_g('vsResp');if(re)re.value=vsOriginal.resp;
  const sp=_g('vsSpo2');if(sp)sp.value=vsOriginal.spo2;
  const bs=_g('vsBst');if(bs)bs.value=vsOriginal.bst;
  vsCheckAlert();saveData();renderDaily();
}
function vsClearAll(recId){
  const r=getDailyRecord(recId);if(!r)return;
  r.temp='';r.bp='';r.pulse='';r.resp='';r.respiration='';r.spo2='';r.bst='';
  const _g=function(id){return document.getElementById(id+'_'+recId)||document.getElementById(id);};
  const t=_g('vsTemp');if(t)t.value='';
  const b=_g('vsBp');if(b)b.value='';
  const p=_g('vsPulse');if(p)p.value='';
  const re=_g('vsResp');if(re)re.value='';
  const sp=_g('vsSpo2');if(sp)sp.value='';
  const bs=_g('vsBst');if(bs)bs.value='';
  r._dirty=true;vsCheckAlert();saveRecordNow(r);renderDaily();
}
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){
    /* V/S 복구 — 새 ID 형식 (vsTemp_{recId}) 에서 recId 추출 후 vsRestore 호출.
     *  활성 V/S 팝업이 있을 때만 동작 (activeCellPopup 안의 첫 input 의 data-rec-id 사용). */
    const _vsInp=(activeCellPopup||document).querySelector('input[id^="vsTemp_"][data-rec-id]');
    if(_vsInp){
      const _rid=parseInt(_vsInp.getAttribute('data-rec-id'),10);
      if(!isNaN(_rid)) vsRestore(_rid);
    }
  }
});
export function openVitalsEdit(recId,btn){
  closeCellPopup();
  const r=getDailyRecord(recId);
  if(!r)return;
  /* 호흡수는 DB 에서 r.respiration 로 들어옴 — r.resp 가 비어 있으면 r.respiration 폴백 */
  const _respCur=r.resp||r.respiration||'';
  vsOriginal={temp:r.temp||'',bp:r.bp||'',pulse:r.pulse||'',resp:_respCur,spo2:r.spo2||'',bst:r.bst||''};
  const rect=btn.getBoundingClientRect();
  const popup=document.createElement('div');
  popup.className='cell-ac-popup';
  let _popLeft=rect.left-120;
  if(_popLeft+260>window.innerWidth)_popLeft=rect.left-260;
  if(_popLeft<8)_popLeft=8;
  let _popTop=rect.bottom+2;
  if(_popTop+220>window.innerHeight)_popTop=rect.top-220;
  popup.style.cssText='position:fixed;top:'+_popTop+'px;left:'+_popLeft+'px;width:260px;max-height:none;overflow:visible;opacity:0;transform:scale(0.95);transition:opacity 0.15s ease,transform 0.15s ease';
  popup.innerHTML=''
    +'<div style="padding:8px 10px;border-bottom:1px solid var(--bdr);background:var(--popup-head);border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:12px;font-weight:700;color:var(--t1)">V/S 입력</span><button data-action="vsOpenTimeseries" data-rec-id="'+recId+'" title="시간대별로 여러 번 측정하여 추이 그래프로 관찰" style="padding:5px 9px;font-size:10px;font-weight:700;border-radius:7px;cursor:pointer;border:1px dashed #0e7490;background:var(--card);color:#0e7490;font-family:var(--f);white-space:nowrap;transition:all .15s" onmouseover="this.style.background=\'rgba(14,116,144,0.10)\';this.style.borderColor=\'var(--cyan)\';this.style.color=\'var(--cyan)\'" onmouseout="this.style.background=\'var(--card)\';this.style.borderColor=\'#0e7490\';this.style.color=\'#0e7490\'">＋ 시간대별 입력</button></div>'
    +'<div style="padding:10px;display:grid;grid-template-columns:70px 1fr;gap:8px;align-items:center">'
    +'<span style="font-size:11px;color:var(--t3)">체온</span><input class="form-input" id="vsTemp_'+recId+'" value="'+(r.temp||'')+'" placeholder="36.5" style="font-size:11px;padding:6px 8px" data-action="vsAutoSave" data-rec-id="'+recId+'">'
    +'<span style="font-size:11px;color:var(--t3)">혈압</span><input class="form-input" id="vsBp_'+recId+'" value="'+(r.bp||'')+'" placeholder="120/80" style="font-size:11px;padding:6px 8px" data-action="vsAutoSave" data-rec-id="'+recId+'">'
    +'<span style="font-size:11px;color:var(--t3)">맥박</span><input class="form-input" id="vsPulse_'+recId+'" value="'+(r.pulse||'')+'" placeholder="72" style="font-size:11px;padding:6px 8px" data-action="vsAutoSave" data-rec-id="'+recId+'">'
    +'<span style="font-size:11px;color:var(--t3)">호흡 수</span><input class="form-input" id="vsResp_'+recId+'" value="'+_respCur+'" placeholder="20" style="font-size:11px;padding:6px 8px" data-action="vsAutoSave" data-rec-id="'+recId+'">'
    +'<span style="font-size:11px;color:var(--t3)">SpO₂</span><input class="form-input" id="vsSpo2_'+recId+'" value="'+(r.spo2||'')+'" placeholder="98" style="font-size:11px;padding:6px 8px" data-action="vsAutoSave" data-rec-id="'+recId+'">'
    +'<span style="font-size:11px;color:var(--t3)">BST</span><input class="form-input" id="vsBst_'+recId+'" value="'+(r.bst||'')+'" placeholder="120" style="font-size:11px;padding:6px 8px" data-action="vsAutoSave" data-rec-id="'+recId+'">'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;align-items:flex-end;padding:0 10px 10px;gap:4px"><button class="btn btn-outline btn-sm" data-action="vsClearAll" data-rec-id="'+recId+'" style="color:#ef4444;border-color:#ef4444">🗑 모두 지우기</button>'
    +'<span style="font-size:9px;color:var(--t3)">'+(navigator.platform.indexOf('Mac')!==-1?'⌘':'Ctrl')+'+Z로 복구</span></div>';
  document.body.appendChild(popup);
  activeCellPopup=popup;
  popup.querySelectorAll('[data-action="vsAutoSave"]').forEach(function(el){el.addEventListener('input',function(){vsAutoSave(recId);});});
  /* 입력칸 간 이동 — Tab/↓ = 다음, Shift+Tab/↑ = 이전(끝에서 순환). stopPropagation 으로 증상 팝업
   *  전역 키핸들러(_symKeyNav: Tab→바디맵)에 안 뺏기게. (사용자 요청 2026-08-06) */
  (function(){
    const _vsInps=Array.prototype.slice.call(popup.querySelectorAll('input.form-input'));
    _vsInps.forEach(function(inp,i){
      inp.addEventListener('keydown',function(e){
        if(e.key==='Tab' || e.key==='ArrowDown' || e.key==='ArrowUp'){
          e.preventDefault(); e.stopPropagation();
          const _dir=(e.key==='ArrowUp' || (e.key==='Tab' && e.shiftKey)) ? -1 : 1;
          let _ni=i+_dir;
          if(_ni<0)_ni=_vsInps.length-1;
          if(_ni>=_vsInps.length)_ni=0;
          const _nx=_vsInps[_ni];
          if(_nx){ _nx.focus(); try{_nx.select();}catch(_){} }
        }
      });
    });
  })();
  popup.querySelector('[data-action="vsClearAll"]').addEventListener('click',function(){vsClearAll(recId);});
  const _tsBtn=popup.querySelector('[data-action="vsOpenTimeseries"]');
  if(_tsBtn)_tsBtn.addEventListener('click',function(){closeCellPopup();openVsTimeseries(recId);});
  /* 제목 부분 드래그로 이동 */
  const _vsHeader=popup.firstElementChild;
  if(_vsHeader){
    _vsHeader.style.cursor='grab';
    _vsHeader.style.userSelect='none';
    let _vsDD=null;
    _vsHeader.addEventListener('mousedown',function(ev){
      if(ev.target.closest('input,button,select,textarea'))return;
      ev.preventDefault();ev.stopPropagation();
      const rect=popup.getBoundingClientRect();
      _vsDD={offX:ev.clientX-rect.left, offY:ev.clientY-rect.top};
      _vsHeader.style.cursor='grabbing';
    });
    const _onMove=function(ev){
      if(!_vsDD)return;
      popup.style.left=(ev.clientX-_vsDD.offX)+'px';
      popup.style.top=(ev.clientY-_vsDD.offY)+'px';
    };
    const _onUp=function(){if(_vsDD){_vsDD=null;_vsHeader.style.cursor='grab';}};
    document.addEventListener('mousemove',_onMove);
    document.addEventListener('mouseup',_onUp);
  }
  requestAnimationFrame(function(){popup.style.opacity='1';popup.style.transform='scale(1)';});
  vsCheckAlert();
  function _vsClose(){
    popup.style.opacity='0';popup.style.transform='scale(0.95)';
    setTimeout(function(){if(popup.parentElement)popup.remove();if(activeCellPopup===popup)activeCellPopup=null;},150);
    document.removeEventListener('keydown',_vsKeyHandler);
    document.removeEventListener('mousedown',_vsOutside);
  }
  function _vsKeyHandler(e){if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();_vsClose();}}
  function _vsOutside(e){if(!popup.contains(e.target)&&e.target!==btn)_vsClose();}
  document.addEventListener('keydown',_vsKeyHandler);
  setTimeout(function(){document.addEventListener('mousedown',_vsOutside);},10);
}

/* ══════════════════════════════════════════
   V/S 시간대별 입력 모달 — 입력 표 + 레인(band) 추이 그래프 2종
   · 데이터는 record.vsHistory (extra_json.vs_history) 에 저장 — DB 스키마 변경 없음
   · 마지막(최신 시각) 측정값을 단일 V/S 컬럼에 미러링 → 통계·단일표시 호환
   ══════════════════════════════════════════ */
export function openVsTimeseries(recId){
  const r=getDailyRecord(recId);if(!r)return;
  const stu=getStu(r.personUid||r.studentId)||{};
  const _isStf=(stu.type==='staff');
  /* 제목 표기 — 이름(학교급 학과 학년 반 번) 형식. 학과는 입력 시, 학교급은 학교급이 여럿일 때만 표시, 띄어쓰기 (사용자 요청 2026-06-16) */
  let _whoRaw; const _whoParts=[];
  if(_isStf){
    if(stu.position)_whoParts.push(stu.position);
    _whoRaw=(stu.position?stu.position+' ':'')+(stu.name||'');
  } else {
    let _multiLv=false; try{ _multiLv=hasMultipleSchoolLevels(); }catch(_){}
    if(_multiLv){ const _lvS=getLevelShort(stu)||''; if(_lvS)_whoParts.push(_lvS); }
    const _dept=String(stu.department||'').trim();
    if(_dept)_whoParts.push(_dept);
    if(stu.grade)_whoParts.push(stu.grade+'학년');
    if(stu.cls)_whoParts.push(stu.cls+'반');
    if(stu.num!=null&&stu.num!=='')_whoParts.push(stu.num+'번');
    _whoRaw=(stu.name||'')+(_whoParts.length?('('+_whoParts.join(' ')+')'):'');
  }
  const _who=escHtml(_whoRaw);
  /* PNG 파일명용 — VS추이_이름_학과_학년_반_번_YYMMDD (사용자 요청 2026-06-16) */
  const _ymdAll=String(r.date||'').replace(/[^0-9]/g,'');
  const _yymmdd=_ymdAll.length>=8?_ymdAll.slice(2,8):_ymdAll;
  const _pngFileBase=['VS추이',(stu.name||'환자')].concat(_whoParts).concat(_yymmdd?[_yymmdd]:[]).join('_').replace(/[\\/:*?"<>|\s]/g,'');

  /* ── 헬퍼 (클로저) ── */
  function _nowHM(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function _t2m(t){const m=String(t||'').match(/^(\d{1,2}):(\d{2})/);if(!m)return null;return (+m[1])*60+(+m[2]);}
  /* 혈압 자동 / 삽입 — 4자리=2/2(90/80·입력중 12/08), 5자리=3/2(120/80) (사용자 보고 2026-06-15: 옛 코드는 4자리도 3/1 로 잘라 90/80 이 908/0 이 됐음) */
  function _formatBp(raw){const d=String(raw).replace(/\D/g,'').slice(0,5);if(d.length<=3)return d;if(d.length===4)return d.slice(0,2)+'/'+d.slice(2);return d.slice(0,3)+'/'+d.slice(3);}
  function _getBp(row){if(!row.bp)return null;const m=String(row.bp).match(/^(\d+)\s*\/\s*(\d+)/);if(!m)return null;return {sys:+m[1],dia:+m[2]};}
  function _getVal(row,it){const v=row[it.k];if(v===''||v==null)return null;const n=parseFloat(v);return isNaN(n)?null:n;}
  function _isOut(row,it){const v=_getVal(row,it);if(v==null)return false;return v<it.min||v>it.max;}
  function _isBpOut(row){const bp=_getBp(row);if(!bp)return false;return bp.sys<BP_ITEM.sysMin||bp.sys>BP_ITEM.sysMax||bp.dia<BP_ITEM.diaMin||bp.dia>BP_ITEM.diaMax;}
  function _niceNum(range,round){if(range<=0)return 1;const exp=Math.floor(Math.log10(range));const f=range/Math.pow(10,exp);let nf;if(round){if(f<1.5)nf=1;else if(f<3)nf=2;else if(f<7)nf=5;else nf=10;}else{if(f<=1)nf=1;else if(f<=2)nf=2;else if(f<=5)nf=5;else nf=10;}return nf*Math.pow(10,exp);}
  function _niceDomain(vMin,vMax){if(!isFinite(vMin)||!isFinite(vMax))return {min:0,max:100,step:25};if(vMin===vMax){vMin-=1;vMax+=1;}const pad=(vMax-vMin)*0.15;let lo=vMin-pad,hi=vMax+pad;if(lo<0&&vMin>=0)lo=0;const step=_niceNum((hi-lo)/4,true);return {min:Math.floor(lo/step)*step,max:Math.ceil(hi/step)*step,step:step};}
  function _fmtN(v){return Number.isInteger(v)?v:(Math.round(v*10)/10).toString();}
  function _resolveLabels(labels,minGap,yMin,yMax){const groups={};labels.forEach(function(lb){const key=Math.round(lb.x);(groups[key]=groups[key]||[]).push(lb);});Object.keys(groups).forEach(function(k){const grp=groups[k];grp.sort(function(a,b){return a.y-b.y;});for(let i=1;i<grp.length;i++){if(grp[i].y-grp[i-1].y<minGap)grp[i].y=grp[i-1].y+minGap;}if(grp[grp.length-1].y>yMax){grp[grp.length-1].y=yMax;for(let i=grp.length-2;i>=0;i--){if(grp[i+1].y-grp[i].y<minGap)grp[i].y=grp[i+1].y-minGap;}}if(grp[0].y<yMin)grp[0].y=yMin;});return labels;}

  const ITEMS=[
    {k:'temp',l:'체온',c:'#ef4444',min:36.0,max:37.7,axis:'°C'},
    {k:'pulse',l:'맥박',c:'#eab308',min:60,max:99,axis:'bpm'},
    {k:'bst',l:'BST',c:'#ec4899',min:70,max:140,axis:'mg/dL'},
    {k:'spo2',l:'SpO₂',c:'#a855f7',min:95,max:100,axis:'%'},
    {k:'resp',l:'호흡',c:'#10b981',min:12,max:21,axis:'/분'},
  ];
  const BP_ITEM={l:'혈압',c:'#3b82f6',sysMin:90,sysMax:139,diaMin:60,diaMax:89};
  const X_T_MIN=8*60, X_T_MAX=17*60;
  const GRAPHS=[
    {id:'vstsChart1_'+recId,title:'① 혈압 · 체온 · 호흡',hasBp:true,items:[
      {k:'temp',l:'체온',c:'#ef4444',axis:'°C',side:'R',dy:-10,nMin:36.0,nMax:37.7},
      {k:'resp',l:'호흡',c:'#10b981',axis:'/분',side:'R',dy:+15,dash:true,nMin:12,nMax:21},
    ]},
    {id:'vstsChart2_'+recId,title:'② 맥박 · BST · SpO₂',hasBp:false,items:[
      {k:'pulse',l:'맥박',c:'#eab308',axis:'bpm',side:'L',dy:-10,nMin:60,nMax:99},
      {k:'bst',l:'BST',c:'#ec4899',axis:'mg/dL',side:'L',dy:+15,nMin:70,nMax:140},
      {k:'spo2',l:'SpO₂',c:'#a855f7',axis:'%',side:'R',dy:-10,nMin:95,nMax:100},
    ]},
  ];

  /* ── rows 초기화: 기존 vsHistory 복사, 없고 단일 V/S 값 있으면 1행 시드 ── */
  let rows = Array.isArray(r.vsHistory) ? JSON.parse(JSON.stringify(r.vsHistory)) : [];
  if(rows.length===0 && (r.temp||r.bp||r.pulse||r.resp||r.respiration||r.spo2||r.bst)){
    rows.push({t:r.timeIn||_nowHM(),temp:r.temp||'',bp:r.bp||'',pulse:r.pulse||'',resp:r.resp||r.respiration||'',spo2:r.spo2||'',bst:r.bst||''});
  }

  /* ── 저장 (마지막 측정값 단일 컬럼 미러링) ── */
  let _saveTimer=null;
  function _mirrorLast(){
    if(!rows.length){return;}
    let last=rows[0], lastM=_t2m(rows[0].t); if(lastM==null)lastM=-1;
    rows.forEach(function(rw){const m=_t2m(rw.t);if(m!=null&&m>=lastM){lastM=m;last=rw;}});
    r.temp=last.temp||'';r.bp=last.bp||'';r.pulse=last.pulse||'';
    r.resp=last.resp||'';r.respiration=last.resp||'';r.spo2=last.spo2||'';r.bst=last.bst||'';
  }
  function _persist(){
    r.vsHistory = rows.slice();
    _mirrorLast();
    r._dirty=true;
    saveRecordNow(r);
  }
  function _persistDebounced(){clearTimeout(_saveTimer);_saveTimer=setTimeout(_persist,400);}

  /* ── 스타일 1회 주입 ── */
  if(!document.getElementById('vstsStyle')){
    const st=document.createElement('style');st.id='vstsStyle';
    st.textContent=''
    +'.vsts-ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:13000;transition:background .15s}'
    +'.vsts-box{background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:1120px;max-width:97vw;max-height:94vh;box-shadow:0 18px 50px rgba(0,0,0,0.45);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity .15s,transform .15s;font-family:var(--f)}'
    +'.vsts-hdr{padding:12px 16px;border-bottom:1px solid var(--bdr);background:var(--popup-head);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:grab;user-select:none}'
    +'.vsts-ttl{font-size:13px;font-weight:800;color:var(--t1)}'
    +'.vsts-x{background:transparent;border:0;color:var(--t3);font-size:19px;cursor:pointer;line-height:1;padding:0 4px}'
    +'.vsts-x:hover{color:var(--t1)}'
    +'.vsts-body{padding:14px 16px;display:grid;grid-template-columns:minmax(0,1fr) 640px;gap:16px;align-items:start;overflow:auto}'
    +'.vsts-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:11px}'
    +'.vsts-tbl thead th{position:sticky;top:0;background:var(--bg2);font-weight:700;font-size:10.5px;color:var(--t2);padding:8px 5px;border-bottom:1px solid var(--bdr);text-align:center;white-space:nowrap;z-index:1}'
    +'.vsts-tbl tbody tr{position:relative}'
    +'.vsts-tbl tbody td{padding:5px 4px;border-bottom:1px dashed var(--bdr);text-align:center}'
    +'.vsts-tbl input{width:100%;font-size:11px;padding:5px 6px;background:var(--bg2);border:1px solid transparent;border-radius:5px;color:var(--t1);text-align:center;font-family:var(--f)}'
    +'.vsts-tbl input:focus{outline:0;border-color:var(--cyan);background:var(--card)}'
    +'.vsts-tbl input.t{font-weight:600}'
    +'.vsts-tbl td.out input{color:#ef4444;font-weight:700}'
    +'.vsts-del{display:none;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer;align-items:center;justify-content:center;font-family:var(--f);padding:0;line-height:1;margin:0 auto}'
    +'.vsts-tbl tbody tr:hover .vsts-del{display:inline-flex}'
    +'.vsts-del:hover{background:rgba(239,68,68,0.2);border-color:#ef4444}'
    +'.vsts-del:active{transform:scale(0.88)}'
    +'.vsts-add{background:var(--cyan);color:#fff;font-weight:700;border:0;font-size:11px;padding:7px 13px;border-radius:6px;cursor:pointer;font-family:var(--f)}'
    +'.vsts-add:hover{filter:brightness(1.1)}'
    +'.vsts-chart-sub{font-size:11px;font-weight:700;color:var(--t1);margin:0 0 5px;padding-left:2px}'
    +'.vsts-svg{display:block;width:100%;height:268px}'
    +'.vsts-svg text.cnum{fill:var(--t1);font-weight:700}'
    +'.vsts-svg text.cdim{fill:var(--t2);font-weight:600}'
    +'.vsts-svg .vlbl{stroke:var(--card);stroke-width:3.2px;paint-order:stroke}'
    +'.vsts-svg .vdot{stroke:var(--card);stroke-width:1.4px}'
    +'.vsts-divider{height:12px}';
    document.head.appendChild(st);
  }

  /* ── 모달 DOM ── */
  const ov=document.createElement('div');ov.className='vsts-ov';ov.id='vstsOv_'+recId;
  ov.innerHTML=''
  +'<div class="vsts-box">'
  +'<div class="vsts-hdr">'
  +'<span class="vsts-ttl">📈 V/S 시간대별 입력 — '+_who+(r.timeIn?(' · 입실 '+escHtml(r.timeIn)):'')+'</span>'
  +'<button class="vsts-png" type="button" title="추이 그래프를 PNG 이미지로 저장" style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;font-size:11px;font-weight:700;border-radius:7px;border:1px solid rgba(59,130,246,0.35);background:rgba(59,130,246,0.10);color:#3b82f6;cursor:pointer;font-family:var(--f)">🖼 PNG 저장</button>'
  +'</div>'
  +'<div class="vsts-body">'
  +'<div>'
  +'<div style="overflow:auto;max-height:520px">'
  +'<table class="vsts-tbl"><thead><tr>'
  +'<th style="width:62px">시각</th><th style="width:58px">체온</th><th style="width:92px">혈압</th>'
  +'<th style="width:52px">맥박</th><th style="width:52px">호흡</th><th style="width:56px">SpO₂</th><th style="width:56px">BST</th><th style="width:26px"></th>'
  +'</tr></thead><tbody class="vsts-tbody"></tbody></table>'
  +'</div>'
  +'<div style="margin-top:10px"><button class="vsts-add">＋ 측정 추가</button></div>'
  +'</div>'
  +'<div id="vstsGraphCol_'+recId+'">'
  +'<div class="vsts-chart-sub">'+GRAPHS[0].title+'</div>'
  +'<svg class="vsts-svg" id="'+GRAPHS[0].id+'" viewBox="0 0 560 250" preserveAspectRatio="none"></svg>'
  +'<div class="vsts-divider"></div>'
  +'<div class="vsts-chart-sub">'+GRAPHS[1].title+'</div>'
  +'<svg class="vsts-svg" id="'+GRAPHS[1].id+'" viewBox="0 0 560 250" preserveAspectRatio="none"></svg>'
  +'</div>'
  +'</div>'
  +'</div>';
  document.body.appendChild(ov);
  const box=ov.querySelector('.vsts-box');
  requestAnimationFrame(function(){ov.style.background='rgba(0,0,0,0.45)';box.style.opacity='1';box.style.transform='scale(1)';});
  /* PNG 저장 — 추이 그래프 컬럼(SVG 2종)을 html2canvas 로 캡처해 다운로드 (사용자 요청 2026-06-16) */
  (function(){
    const _pngBtn=ov.querySelector('.vsts-png');
    if(!_pngBtn)return;
    _pngBtn.addEventListener('click',function(e){
      e.stopPropagation();
      const _gcol=ov.querySelector('#vstsGraphCol_'+recId);
      if(!_gcol)return;
      const _orig=_pngBtn.textContent;_pngBtn.textContent='저장 중…';
      function _cap(){
        let _bg='#ffffff';try{_bg=getComputedStyle(box).backgroundColor||'#ffffff';}catch(_){}
        html2canvas(_gcol,{scale:2,backgroundColor:_bg,useCORS:true,allowTaint:true}).then(function(canvas){
          canvas.toBlob(function(blob){
            _pngBtn.textContent=_orig;
            if(!blob){bus.emit('toast:show',{text:'PNG 생성 실패'});return;}
            const _url=URL.createObjectURL(blob);const _a=document.createElement('a');
            _a.href=_url;_a.download=_pngFileBase+'.png';
            document.body.appendChild(_a);_a.click();
            setTimeout(function(){URL.revokeObjectURL(_url);_a.remove();},120);
            bus.emit('toast:show',{text:'PNG 이미지로 저장되었습니다.'});
          });
        }).catch(function(err){_pngBtn.textContent=_orig;console.error('VS PNG',err);bus.emit('toast:show',{text:'PNG 저장 실패'});});
      }
      if(typeof html2canvas!=='undefined')_cap();
      else{const _sc=document.createElement('script');_sc.src='./node_modules/html2canvas/dist/html2canvas.min.js';_sc.onload=_cap;_sc.onerror=function(){_pngBtn.textContent=_orig;bus.emit('toast:show',{text:'html2canvas 로드 실패'});};document.head.appendChild(_sc);}
    });
  })();

  /* ── 닫기 ── */
  function _close(){
    _persist();
    box.style.opacity='0';box.style.transform='scale(0.97)';ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){if(ov.parentElement)ov.remove();renderDaily();},150);
    document.removeEventListener('keydown',_escH);
  }
  function _escH(e){if(e.key==='Escape'){e.preventDefault();_close();}}
  document.addEventListener('keydown',_escH);
  /* 우상단 X 버튼 제거됨 (사용자 요청 2026-05-28) — ESC·외부 클릭으로 닫음 */
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_close();});

  /* ── 헤더 드래그 이동 ── */
  (function(){
    const hdr=ov.querySelector('.vsts-hdr');let dd=null;
    hdr.addEventListener('mousedown',function(ev){if(ev.target.closest('button'))return;ev.preventDefault();const rc=box.getBoundingClientRect();dd={ox:ev.clientX-rc.left,oy:ev.clientY-rc.top};box.style.position='fixed';box.style.margin='0';box.style.left=rc.left+'px';box.style.top=rc.top+'px';ov.style.alignItems='flex-start';ov.style.justifyContent='flex-start';hdr.style.cursor='grabbing';});
    document.addEventListener('mousemove',function(ev){if(!dd)return;box.style.left=(ev.clientX-dd.ox)+'px';box.style.top=(ev.clientY-dd.oy)+'px';});
    document.addEventListener('mouseup',function(){if(dd){dd=null;hdr.style.cursor='grab';}});
  })();

  /* ── 표 렌더 ── */
  const tbody=ov.querySelector('.vsts-tbody');
  function _focusCell(i,c){if(i<0||i>=rows.length)return;const el=tbody.querySelector('input[data-i="'+i+'"][data-c="'+c+'"]');if(el){el.focus();el.select();}}
  function _updateOut(i){const rw=rows[i];const tr=tbody.querySelector('input[data-i="'+i+'"][data-c="0"]');if(!tr)return;const tds=tr.closest('tr').querySelectorAll('td');tds[1].classList.toggle('out',_isOut(rw,ITEMS[0]));tds[2].classList.toggle('out',_isBpOut(rw));tds[3].classList.toggle('out',_isOut(rw,ITEMS[1]));tds[4].classList.toggle('out',_isOut(rw,ITEMS[4]));tds[5].classList.toggle('out',_isOut(rw,ITEMS[3]));tds[6].classList.toggle('out',_isOut(rw,ITEMS[2]));}
  function _renderTable(focus){
    let h='';
    rows.forEach(function(rw,idx){
      const o0=_isOut(rw,ITEMS[0])?' out':'';const ob=_isBpOut(rw)?' out':'';const op=_isOut(rw,ITEMS[1])?' out':'';const ore=_isOut(rw,ITEMS[4])?' out':'';const os=_isOut(rw,ITEMS[3])?' out':'';const obs=_isOut(rw,ITEMS[2])?' out':'';
      h+='<tr>'
      +'<td><input class="t" data-i="'+idx+'" data-c="0" data-k="t" value="'+escHtml(rw.t||'')+'"></td>'
      +'<td class="'+o0.trim()+'"><input data-i="'+idx+'" data-c="1" data-k="temp" value="'+escHtml(rw.temp||'')+'"></td>'
      +'<td class="'+ob.trim()+'"><input data-i="'+idx+'" data-c="2" data-k="bp" value="'+escHtml(rw.bp||'')+'"></td>'
      +'<td class="'+op.trim()+'"><input data-i="'+idx+'" data-c="3" data-k="pulse" value="'+escHtml(rw.pulse||'')+'"></td>'
      +'<td class="'+ore.trim()+'"><input data-i="'+idx+'" data-c="4" data-k="resp" value="'+escHtml(rw.resp||'')+'"></td>'
      +'<td class="'+os.trim()+'"><input data-i="'+idx+'" data-c="5" data-k="spo2" value="'+escHtml(rw.spo2||'')+'"></td>'
      +'<td class="'+obs.trim()+'"><input data-i="'+idx+'" data-c="6" data-k="bst" value="'+escHtml(rw.bst||'')+'"></td>'
      +'<td><button class="vsts-del" data-del="'+idx+'" title="이 측정 삭제">✕</button></td>'
      +'</tr>';
    });
    tbody.innerHTML=h;
    tbody.querySelectorAll('input').forEach(function(inp){
      inp.addEventListener('input',function(e){
        const i=+e.target.dataset.i,k=e.target.dataset.k;
        if(k==='bp'){const f=_formatBp(e.target.value);if(f!==e.target.value){e.target.value=f;try{e.target.setSelectionRange(f.length,f.length);}catch(_){}}rows[i].bp=f;}
        else rows[i][k]=e.target.value;
        _updateOut(i);_renderCharts();_persistDebounced();
      });
      inp.addEventListener('keydown',function(e){
        const i=+e.target.dataset.i,c=+e.target.dataset.c;let ni=i,nc=c;
        if(e.key==='Tab'){e.preventDefault();nc=e.shiftKey?c-1:c+1;if(nc>6){nc=0;ni=i+1;}if(nc<0){nc=6;ni=i-1;}}
        else if(e.key==='ArrowRight'){if(e.target.selectionStart!==e.target.value.length)return;e.preventDefault();nc=c+1;if(nc>6){nc=0;ni=i+1;}}
        else if(e.key==='ArrowLeft'){if(e.target.selectionStart!==0)return;e.preventDefault();nc=c-1;if(nc<0){nc=6;ni=i-1;}}
        else if(e.key==='ArrowDown'){e.preventDefault();ni=i+1;}
        else if(e.key==='ArrowUp'){e.preventDefault();ni=i-1;}
        else if(e.key==='Enter'){e.preventDefault();ni=i+1;if(ni>=rows.length){_addRow();return;}}
        else return;
        _focusCell(ni,nc);
      });
    });
    tbody.querySelectorAll('.vsts-del').forEach(function(b){b.addEventListener('click',function(e){rows.splice(+e.target.dataset.del,1);_renderTable();_renderCharts();_persistDebounced();});});
    if(focus)_focusCell(focus.i,focus.c);
  }
  function _addRow(){rows.push({t:_nowHM(),temp:'',bp:'',pulse:'',resp:'',spo2:'',bst:''});_renderTable({i:rows.length-1,c:1});_renderCharts();_persistDebounced();}
  ov.querySelector('.vsts-add').addEventListener('click',_addRow);

  /* ── 차트 렌더 (레인 방식) ── */
  function _renderGraph(cfg){
    const svg=document.getElementById(cfg.id);if(!svg)return;
    const W=560,H=250,PAD={l:62,r:104,t:12,b:22};
    const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
    const tMin=X_T_MIN,tMax=X_T_MAX,span=tMax-tMin,X_INSET=0.06;
    function xAt(t){const n=(t-tMin)/span;return PAD.l+(X_INSET+n*(1-2*X_INSET))*cw;}
    const activeItems=cfg.items.filter(function(it){return rows.some(function(rw){return _getVal(rw,it)!=null;});});
    const hasBp=cfg.hasBp&&rows.some(function(rw){return _getBp(rw)!=null;});
    const bands=[];
    if(hasBp)bands.push({type:'bp',l:'혈압',c:BP_ITEM.c,unit:'mmHg'});
    activeItems.forEach(function(it){bands.push({type:'item',it:it,l:it.l,c:it.c,unit:it.axis,dash:it.dash});});
    const nB=bands.length;if(nB===0){svg.innerHTML='';return;}
    const bandH=ch/nB;let s='';
    for(let t=tMin;t<=tMax;t+=60){const x=xAt(t);s+='<line x1="'+x.toFixed(1)+'" y1="'+PAD.t+'" x2="'+x.toFixed(1)+'" y2="'+(PAD.t+ch)+'" stroke="#64748b" stroke-width="1" stroke-dasharray="2 3" opacity="0.55"/>';const hh=String(Math.floor(t/60)).padStart(2,'0'),mm=String(t%60).padStart(2,'0');s+='<text class="cdim" x="'+x.toFixed(1)+'" y="'+(H-PAD.b+13)+'" text-anchor="middle" font-size="12">'+hh+':'+mm+'</text>';}
    const dots=[];
    bands.forEach(function(band,bi){
      const top=PAD.t+bi*bandH,bot=top+bandH,bp2=Math.min(13,bandH*0.22),inTop=top+bp2,inBot=bot-bp2,inH=inBot-inTop;
      let vals=[];
      if(band.type==='bp'){rows.forEach(function(rw){const bp=_getBp(rw);if(bp)vals.push(bp.sys,bp.dia);});}
      else{rows.forEach(function(rw){const v=_getVal(rw,band.it);if(v!=null)vals.push(v);});}
      const dom=vals.length?_niceDomain(Math.min.apply(null,vals),Math.max.apply(null,vals)):{min:0,max:100,step:25};
      const yIn=function(v){return inBot-((v-dom.min)/(dom.max-dom.min))*inH;};
      const clampY=function(v){return Math.max(inTop,Math.min(inBot,yIn(v)));};
      if(bi%2===1)s+='<rect x="'+PAD.l+'" y="'+top.toFixed(1)+'" width="'+cw+'" height="'+bandH.toFixed(1)+'" fill="#ffffff" opacity="0.02"/>';
      if(bi>0)s+='<line x1="'+PAD.l+'" y1="'+top.toFixed(1)+'" x2="'+(W-PAD.r)+'" y2="'+top.toFixed(1)+'" stroke="#475569" stroke-width="1" opacity="0.5"/>';
      /* 정상범위 음영 */
      if(band.type==='item'&&band.it.nMin!=null){const yHi=clampY(band.it.nMax),yLo=clampY(band.it.nMin);if(yLo-yHi>0.5)s+='<rect x="'+PAD.l+'" y="'+yHi.toFixed(1)+'" width="'+cw+'" height="'+(yLo-yHi).toFixed(1)+'" fill="#10b981" opacity="0.10"/>';}
      else if(band.type==='bp'){[[BP_ITEM.diaMin,BP_ITEM.diaMax],[BP_ITEM.sysMin,BP_ITEM.sysMax]].forEach(function(rg){const yHi=clampY(rg[1]),yLo=clampY(rg[0]);if(yLo-yHi>0.5)s+='<rect x="'+PAD.l+'" y="'+yHi.toFixed(1)+'" width="'+cw+'" height="'+(yLo-yHi).toFixed(1)+'" fill="#10b981" opacity="0.08"/>';});}
      [dom.max,(dom.min+dom.max)/2,dom.min].forEach(function(gv){const y=yIn(gv);s+='<line x1="'+PAD.l+'" y1="'+y.toFixed(1)+'" x2="'+(W-PAD.r)+'" y2="'+y.toFixed(1)+'" stroke="#64748b" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>';s+='<text class="cnum" x="'+(W-PAD.r+4)+'" y="'+(y+3).toFixed(1)+'" text-anchor="start" font-size="11">'+_fmtN(gv)+'</text>';});
      const cy=(top+bot)/2;
      s+='<text x="6" y="'+(cy-1).toFixed(1)+'" text-anchor="start" font-size="13" font-weight="800" fill="'+band.c+'">'+band.l+'</text>';
      s+='<text class="cdim" x="6" y="'+(cy+11).toFixed(1)+'" text-anchor="start" font-size="10">'+(band.unit||'')+'</text>';
      const rngX=W-PAD.r+36;
      if(band.type==='item'&&band.it.nMin!=null){s+='<text x="'+rngX+'" y="'+(cy-5).toFixed(1)+'" text-anchor="start" font-size="10" font-weight="700" fill="#34d399">정상</text>';s+='<text x="'+rngX+'" y="'+(cy+6).toFixed(1)+'" text-anchor="start" font-size="10.5" font-weight="700" fill="#34d399">'+_fmtN(band.it.nMin)+'~'+_fmtN(band.it.nMax)+'</text>';}
      else if(band.type==='bp'){s+='<text x="'+rngX+'" y="'+(cy-11).toFixed(1)+'" text-anchor="start" font-size="10" font-weight="700" fill="#34d399">정상</text>';s+='<text x="'+rngX+'" y="'+(cy).toFixed(1)+'" text-anchor="start" font-size="10" font-weight="700" fill="#34d399">수축 '+BP_ITEM.sysMin+'~'+BP_ITEM.sysMax+'</text>';s+='<text x="'+rngX+'" y="'+(cy+11).toFixed(1)+'" text-anchor="start" font-size="10" font-weight="700" fill="#34d399">이완 '+BP_ITEM.diaMin+'~'+BP_ITEM.diaMax+'</text>';}
      const bl=[];
      if(band.type==='bp'){
        rows.forEach(function(rw){const bp=_getBp(rw);if(!bp)return;const t=_t2m(rw.t);if(t==null)return;const x=xAt(t);const yS=yIn(bp.sys),yD=yIn(bp.dia);s+='<line x1="'+x.toFixed(1)+'" y1="'+yS.toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+yD.toFixed(1)+'" stroke="'+BP_ITEM.c+'" stroke-width="3" stroke-linecap="round" opacity="0.85"/>';s+='<line x1="'+(x-5).toFixed(1)+'" y1="'+yS.toFixed(1)+'" x2="'+(x+5).toFixed(1)+'" y2="'+yS.toFixed(1)+'" stroke="'+BP_ITEM.c+'" stroke-width="2.2" stroke-linecap="round"/>';s+='<line x1="'+(x-5).toFixed(1)+'" y1="'+yD.toFixed(1)+'" x2="'+(x+5).toFixed(1)+'" y2="'+yD.toFixed(1)+'" stroke="'+BP_ITEM.c+'" stroke-width="2.2" stroke-linecap="round"/>';bl.push({x:x,y:yS-7,txt:String(bp.sys),c:BP_ITEM.c});bl.push({x:x,y:yD+12,txt:String(bp.dia),c:BP_ITEM.c});});
      }else{
        const it=band.it;const pts=rows.map(function(rw){const v=_getVal(rw,it);if(v==null)return null;const t=_t2m(rw.t);if(t==null)return null;return {x:xAt(t),y:yIn(v),v:v};}).filter(function(p){return p;});
        if(pts.length>=2){const d=pts.map(function(p,i){return (i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');const da=it.dash?' stroke-dasharray="3 3"':'';const sw=it.dash?1.4:1.8;s+='<path d="'+d+'" fill="none" stroke="'+it.c+'" stroke-width="'+sw+'"'+da+' stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>';}
        pts.forEach(function(p){dots.push({x:p.x,y:p.y,c:it.c,title:it.l+' '+p.v+(it.axis||'')});bl.push({x:p.x,y:p.y-7,txt:String(p.v),c:it.c});});
      }
      _resolveLabels(bl,15,top+10,bot-4);
      bl.forEach(function(lb){s+='<text class="vlbl" x="'+lb.x.toFixed(1)+'" y="'+lb.y.toFixed(1)+'" text-anchor="middle" font-size="12.5" font-weight="800" fill="'+lb.c+'">'+lb.txt+'</text>';});
    });
    let dh='';dots.forEach(function(d){dh+='<circle class="vdot" cx="'+d.x.toFixed(1)+'" cy="'+d.y.toFixed(1)+'" r="3" fill="'+d.c+'"><title>'+d.title+'</title></circle>';});
    s+='<rect x="'+PAD.l+'" y="'+PAD.t+'" width="'+cw+'" height="'+ch+'" fill="none" stroke="#64748b" stroke-width="1"/>';
    svg.innerHTML=dh+s;
  }
  function _renderCharts(){GRAPHS.forEach(function(g){_renderGraph(g);});}

  _renderTable();
  _renderCharts();
}

/* ══════════════════════════════════════════
   의료기관 탐색 팝업 — 카카오 REST API
   ══════════════════════════════════════════ */
const _EXCLUDE_KEYWORDS=['한약','한의원','한방','동물','수의','산후'];
const _SIDO_LIST_UNUSED=[
  {cd:'110000',nm:'서울'},{cd:'210000',nm:'부산'},{cd:'220000',nm:'대구'},{cd:'230000',nm:'인천'},
  {cd:'240000',nm:'광주'},{cd:'250000',nm:'대전'},{cd:'260000',nm:'울산'},{cd:'310000',nm:'세종'},
  {cd:'310000',nm:'경기'},{cd:'320000',nm:'강원'},{cd:'330000',nm:'충북'},{cd:'340000',nm:'충남'},
  {cd:'350000',nm:'전북'},{cd:'360000',nm:'전남'},{cd:'370000',nm:'경북'},{cd:'380000',nm:'경남'},{cd:'390000',nm:'제주'}
];
const _DEPT_LIST=[
  {cd:'01',nm:'내과'},{cd:'02',nm:'신경과'},{cd:'03',nm:'정신건강의학과'},{cd:'04',nm:'외과'},
  {cd:'05',nm:'정형외과'},{cd:'06',nm:'신경외과'},{cd:'08',nm:'성형외과'},{cd:'09',nm:'마취통증의학과'},
  {cd:'10',nm:'산부인과'},{cd:'11',nm:'소아청소년과'},{cd:'12',nm:'안과'},{cd:'13',nm:'이비인후과'},
  {cd:'14',nm:'피부과'},{cd:'15',nm:'비뇨의학과'},{cd:'21',nm:'재활의학과'},{cd:'23',nm:'가정의학과'},
  {cd:'24',nm:'응급의학과'},{cd:'26',nm:'치과'},{cd:'49',nm:'한방내과'},{cd:'80',nm:'약국'}
];
export function openMedFacilityPopup(){
  const _cu=S._currentUser||{};
  const schoolName=_cu.school_name||S.settings.schoolName||'';
  const eduOffice=_cu.edu_office||S.settings.eduOffice||'';
  const kakaoRest=localStorage.getItem('ec_kakao_rest_api_key')||'';
  const kakaoJs=localStorage.getItem('ec_kakao_js_api_key')||'';
  /* 데스크탑(호스트) 모드: SDK 가 든 BrowserWindow 팝업이라 REST + JS 두 키 모두 필수.
   * 웹 클라이언트(동료 PC) 모드: 카드리스트(/med-facility-list.html) 라 SDK 미사용,
   *   localStorage 동기화 race 도 있을 수 있으므로 가드 우회 → 서버가 blob 폴백으로 처리. */
  if(!window.__isWebBrowser && (!kakaoRest||!kakaoJs)){
    alert('카카오 개발자 API 키가 등록되지 않았습니다.\n설정 → API Key 관리 → 카카오 개발자 API 에서 REST API 키와 JavaScript 키를 먼저 등록해 주세요.');
    return;
  }
  if(window.electronAPI&&window.electronAPI.openMedFacility){
    const hiraKey=getPublicDataApiKey('hira');
    const emgKey=getPublicDataApiKey('emergency');
    const schoolAddr=localStorage.getItem('ec_school_address')||'';
    let schoolLat=localStorage.getItem('ec_school_lat')||'';
    let schoolLng=localStorage.getItem('ec_school_lng')||'';

    function _open(lat,lng){
      window.electronAPI.openMedFacility(schoolName,eduOffice,hiraKey,emgKey,schoolAddr,undefined,kakaoRest,kakaoJs,lat,lng);
    }

    /* 좌표가 없으면 즉석 지오코딩 후 저장 + 팝업 오픈. 카카오 키도 없으면 그냥 팝업만 띄움(좌표 없이). */
    if((!schoolLat||!schoolLng)&&schoolAddr&&kakaoRest&&window.electronAPI.kakaoKeywordSearch){
      window.electronAPI.kakaoKeywordSearch(schoolAddr,undefined,undefined,undefined,undefined,kakaoRest).then(function(r){
        if(r&&r.success&&r.data&&r.data.length){
          const d=r.data[0];
          if(d.x&&d.y){
            schoolLat=String(d.y);schoolLng=String(d.x);
            localStorage.setItem('ec_school_lat',schoolLat);
            localStorage.setItem('ec_school_lng',schoolLng);
          }
        }
        _open(schoolLat,schoolLng);
      }).catch(function(){_open(schoolLat,schoolLng);});
    } else {
      _open(schoolLat,schoolLng);
    }
    return;
  }
}
/* 오래된 심평원 API 검색 제거 — 카카오 REST API로 대체됨 */

/* ── Event bus registrations ── */
bus.on('daily:period-open', function(){
  dailyCloseCtxPopup();
  dailyClearDragSelect();
  _dd.active=false;
  _dd.moved=false;
  _dd.lastClickIdx=-1;
  if(_ddAutoScrollRaf!==null){cancelAnimationFrame(_ddAutoScrollRaf);_ddAutoScrollRaf=null;}
  _ddLastMoveEvent=null;
  if(_dd.box){_dd.box.remove();_dd.box=null;}
  _calFocusActive=false;
  S.dailySelectedRecId=null;
  S.dailyLockedStudentId=null;
  S._visitHistoryLocked=false;
  document.querySelectorAll('#recBody tr.daily-selected').forEach(function(row){row.classList.remove('daily-selected');});
  _hideVisitHistory();
});
bus.on('render:daily', function(){
  renderDaily();
  /* 보건일지 표 변경 시 최근 보건실 방문 이력 카드도 함께 갱신.
     · 잠금(클릭) 학생 또는 현재 카드의 마지막 학생(panel._lastStuId) 둘 다 즉시 재렌더.
     · v3 fix (사용자 보고 2026-05-21): showVisitHistory 가 _visitHistoryLocked 로 early return 하므로
       명시적 갱신 호출 시에는 잠시 해제 후 복원해 약품/처치 변경이 사이드바에 즉시 반영되도록.
     · 옛 코드의 panel ID 오타(visitHistoryPanel → sideVisitHistory) 도 같이 fix. */
  const _wasLocked = S._visitHistoryLocked;
  S._visitHistoryLocked = false;
  try {
    const lockedId=S.dailyLockedStudentId;
    if(lockedId){showVisitHistory(lockedId);return;}
    const panel=document.getElementById('sideVisitHistory');
    if(panel&&panel._lastStuId&&panel.classList.contains('vh-show'))showVisitHistory(panel._lastStuId);
  } finally {
    S._visitHistoryLocked = _wasLocked;
  }
});
bus.on('collab:peer-changed', function(){
  /* 협업 피어 변경 시 전광판(#dailyVisitorCount 2층) 즉시 갱신 */
  if(document.getElementById('dailyVisitorCount'))renderDaily();
});
bus.on('render:calendar', renderCalendar);
bus.on('render:sidebar', renderSidebarRecent);
bus.on('toast:show', function(d){ dailyShowToast(d.text, d.type, d.duration); });
bus.on('toast:blue', function(d){ _showBlueToast(d.text); });
