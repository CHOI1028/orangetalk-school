/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { S, ensureHolidayYear } from '../../core/app-state.js';
import { getStu, toDateStr, getStuGradeCol, saveData, saveRecordNow, closeModalGracefully, getSemesterInfo, dateObj, counselTreatText, isCounselSymLabel } from '../../core/helpers.js';
import { closeCellPopup } from './daily-view.js';
import { closeModalWithAnim } from './daily-autocomplete.js';
import { _makeDraggable, formatMedicationDisplay, _symBuildCounselPrintHtml, _symCounselSheetData } from '../symptom/symptom-view.js';
import { bus } from '../../core/event-bus.js';
import { dailyColEyeIcon, openClockPicker, cpCleanHandlers, closeClockPickerAnim, showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { buildDeptStatsCover, buildDeptStatsSections, buildCounselStatsCover, buildCounselSummaryVertical } from './diary-print-cover.js';
import { openPersonSearch } from '../../core/person-search-ui.js';
import { openA4PrintDialog } from '../../core/a4-print-dialog.js';
import { tmGetPrintBlock, tmEnsureLoaded, tmGetMemoForExport } from './today-memo.js';
import { appConfirmModal } from '../../core/ui-utils.js';

/* ── 공통 달력 렌더러 (사이드바 달력과 동일 스타일) ── */
/* ── 공유 달력(_commonCalRender) 방향키 이동 (2026-06-08) ──
 * 열린 달력에서 ←→ ±1일, ↑↓ ±7일로 강조 날짜 이동(달 경계 자동 전환), Enter 로 확정. 기존 클릭 동작은 그대로.
 * _commonCalRender 가 onNav 로 자기 자신을 재호출(재렌더)하므로, 표시월(_ccKnavDispY/M)을 매 렌더마다 갱신해
 * 달 경계 이동 시 onNav(±1) 로 재렌더 → 재강조한다. 사용처: 체격검사·보건일지 인쇄(시작/종료)·응급/감염 폼. */
let _ccKnavWrap=null,_ccKnavFocus=null,_ccKnavDispY=0,_ccKnavDispM=0,_ccKnavSelect=null,_ccKnavNav=null,_ccKnavBound=false;
function _ccKnavParse(ds){const m=String(ds||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
function _ccKnavFmt(d){const z=function(n){return String(n).padStart(2,'0');};return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());}
function _ccKnavHighlight(){
  if(!_ccKnavWrap)return;
  _ccKnavWrap.querySelectorAll('.mcal-cell.cal-knav-focus').forEach(function(el){el.classList.remove('cal-knav-focus');});
  if(!_ccKnavFocus)return;
  const cell=_ccKnavWrap.querySelector('.mcal-cell[data-cal-select="'+_ccKnavFocus+'"]');
  if(cell)cell.classList.add('cal-knav-focus');
}
function _ccKnavKey(e){
  if(!_ccKnavWrap||!_ccKnavWrap.isConnected){ if(_ccKnavBound){document.removeEventListener('keydown',_ccKnavKey,true);_ccKnavBound=false;} _ccKnavWrap=null; return; }
  /* 팝업 안의 글자 입력 중이면 양보 */
  const ae=document.activeElement;
  if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')&&ae.value&&_ccKnavWrap.contains&&_ccKnavWrap.contains(ae))return;
  if(e.key==='Enter'){ if(_ccKnavFocus&&_ccKnavSelect){e.preventDefault();e.stopImmediatePropagation();_ccKnavSelect(_ccKnavFocus);} return; }
  let delta=0;
  if(e.key==='ArrowLeft')delta=-1; else if(e.key==='ArrowRight')delta=1;
  else if(e.key==='ArrowUp')delta=-7; else if(e.key==='ArrowDown')delta=7;
  else return;
  /* 캡처 단계에서 전파 중단 — 사이드바 달력 등 다른 방향키 핸들러의 이중 이동 방지 */
  e.preventDefault();e.stopImmediatePropagation();
  const d=_ccKnavParse(_ccKnavFocus); if(!d)return;
  d.setDate(d.getDate()+delta);
  _ccKnavFocus=_ccKnavFmt(d);
  const dM=(d.getFullYear()-_ccKnavDispY)*12+(d.getMonth()-_ccKnavDispM);
  if(dM!==0 && _ccKnavNav){ _ccKnavNav(dM); /* 재렌더(_commonCalRender 재호출)가 _ccKnavHighlight 재실행 */ }
  else { _ccKnavHighlight(); }
}
export function _commonCalRender(wrap,yr,mo,onSelect,onNav,opts){
  opts=opts||{};
  /* onSelect/onNav: 함수 참조 또는 문자열(하위 호환) */
  const _selectFn=typeof onSelect==='function'?onSelect:null;
  const _navFn=typeof onNav==='function'?onNav:null;
  ensureHolidayYear(String(yr)); const holidays={};Object.keys(S.koreanHolidays).forEach(function(k){if(k.startsWith(String(yr)))holidays[k]=S.koreanHolidays[k];});
  const now=new Date();
  const first=new Date(yr,mo,1);const dow=first.getDay();
  const dim=new Date(yr,mo+1,0).getDate();
  const monthNames=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  /* 월 호버 팝업 (사이드바 달력과 동일) */
  let mPop='<div class="mcal-popup" style="min-width:140px;display:none;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++){
    mPop+='<div class="mcal-popup-item'+(m===mo?' active':'')+'" data-cal-nav="setMonth" data-cal-month="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
  }
  mPop+='</div>';
  let h='<div style="border:1px solid var(--bdr);border-radius:9px;padding:0;background:var(--card);min-width:240px;box-shadow:0 8px 24px rgba(0,0,0,0.2);overflow:hidden">';
  /* 헤더 (사이드바 달력과 동일) */
  h+='<div class="mcal-hdr" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--bdr)">';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-cal-nav="prev">◂</button></div>';
  h+='<div class="mcal-title" style="font-size:13px;font-weight:700;display:flex;gap:4px;align-items:center;color:var(--t1)">';
  if(opts.yearPopup){
    let yPop='<div class="mcal-popup">';
    for(let y=now.getFullYear();y>=now.getFullYear()-5;y--){
      yPop+='<div class="mcal-popup-item'+(y===yr?' active':'')+'" data-cal-nav="setYear" data-cal-year="'+y+'">'+y+'</div>';
    }
    yPop+='</div>';
    h+='<span class="mcal-year" style="cursor:pointer;position:relative;padding:2px 6px;border-radius:4px;transition:background 0.15s">'+yr+'년'+yPop+'</span>';
  } else {
    h+='<span style="padding:2px 6px">'+yr+'년</span>';
  }
  h+='<span class="mcal-month" style="cursor:pointer;position:relative;padding:2px 6px;border-radius:4px;transition:background 0.15s">'+monthNames[mo]+mPop+'</span>';
  h+='</div>';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-cal-nav="next">▸</button></div>';
  h+='</div>';
  /* 요일 + 날짜 */
  h+='<div style="padding:8px 10px">';
  h+='<div class="mcal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){
    let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
    h+='<div class="'+cls+'">'+d+'</div>';
  });
  /* 이전 달 날짜 */
  const prevLast=new Date(yr,mo,0).getDate();
  for(let i=dow-1;i>=0;i--)h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
  /* 이번 달 날짜 */
  for(let d=1;d<=dim;d++){
    const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const isToday=ds===toDateStr(now);const dayDow=(dow+d-1)%7;
    const isHol=!!holidays[ds];const holName=holidays[ds]||'';
    const isWkend=dayDow===0||dayDow===6;
    let cls='mcal-cell';
    if(isToday)cls+=' today';
    if(dayDow===0)cls+=' sun';
    if(dayDow===6)cls+=' sat';
    if(isHol&&!isWkend)cls+=' holiday';
    h+='<div class="'+cls+'" data-cal-select="'+ds+'" title="'+holName+'" style="cursor:pointer"><span class="day-n">'+d+'</span></div>';
  }
  /* 다음 달 날짜 */
  const totalCells=dow+dim;const rem=(7-totalCells%7)%7;
  for(let i=1;i<=rem;i++)h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
  h+='</div></div></div>';
  wrap.innerHTML=h;
  /* 월 팝업 display fix */
  wrap.querySelectorAll('.mcal-month .mcal-popup').forEach(function(p){p.style.display='';p.style.flexWrap='wrap';p.style.gap='2px';});
  /* 이벤트 위임: 날짜 선택 + 네비게이션 (재렌더링 시 중복 방지) */
  if(wrap._calClickHandler)wrap.removeEventListener('click',wrap._calClickHandler);
  wrap._calClickHandler=function(e){
    const selEl=e.target.closest('[data-cal-select]');
    if(selEl){
      const ds=selEl.dataset.calSelect;
      if(_selectFn)_selectFn(ds);
      return;
    }
    const navEl=e.target.closest('[data-cal-nav]');
    if(navEl){
      e.stopPropagation();
      const action=navEl.dataset.calNav;
      if(_navFn){
        if(action==='prev')_navFn(-1);
        else if(action==='next')_navFn(1);
        else if(action==='setMonth')_navFn(0,parseInt(navEl.dataset.calMonth,10));
        else if(action==='setYear')_navFn(0,undefined,parseInt(navEl.dataset.calYear,10));
      }
    }
  };
  wrap.addEventListener('click',wrap._calClickHandler);
  /* ── 방향키 날짜 이동 연결 (2026-06-08) ── */
  _ccKnavDispY=yr; _ccKnavDispM=mo; _ccKnavSelect=_selectFn; _ccKnavNav=_navFn;
  if(_ccKnavWrap!==wrap){
    /* 새 팝업 — 포커스 초기화: 표시월에 오늘이 있으면 오늘, 아니면 표시월 1일 */
    _ccKnavWrap=wrap;
    const _t=new Date();
    _ccKnavFocus=(_t.getFullYear()===yr&&_t.getMonth()===mo)?_ccKnavFmt(_t):(yr+'-'+String(mo+1).padStart(2,'0')+'-01');
  }
  if(!_ccKnavBound){ document.addEventListener('keydown',_ccKnavKey,true); _ccKnavBound=true; }
  _ccKnavHighlight();
}

/* ── 보건일지 출력 달력 (모듈 스코프 변수 선언) ── */
let dpCalTarget=null;
let dpCalYear=new Date().getFullYear();
let dpCalMonth=new Date().getMonth();
function dpOpenCal(inputId){
  const existing=document.getElementById('dpCalFloat');
  if(existing){existing.remove();document.removeEventListener('click',_dpCalOutside);return;}
  dpCalTarget=inputId;
  const inp=document.getElementById(inputId);
  if(!inp)return;
  const val=inp.value;
  if(val){const d=new Date(val);if(!isNaN(d)){dpCalYear=d.getFullYear();dpCalMonth=d.getMonth();}}
  /* 트리거(input 의 래핑 div) 의 화면 좌표를 사용 — input 이 readonly·transparent 라
     rect 가 가끔 0 으로 잡힘. 부모 wrap 우선. */
  const trigger=inp.closest('[data-action="dpOpenCal"]')||inp;
  const rect=trigger.getBoundingClientRect();
  /* 방어: rect 가 비정상(폭/높이 0, 좌상단 0,0)이면 캘린더 좌상단 freeze 방지 — 화면 중앙 폴백 */
  const calH=340, calW=300;
  const fl=document.createElement('div');fl.id='dpCalFloat';
  fl.style.cssText='position:fixed;z-index:9500;';
  let top, left;
  const looksBroken=(rect.width===0&&rect.height===0)||(rect.top===0&&rect.left===0&&rect.bottom===0);
  if(looksBroken){
    top=Math.max(20,(window.innerHeight-calH)/2);
    left=Math.max(20,(window.innerWidth-calW)/2);
  } else {
    top=(rect.bottom+calH>window.innerHeight)?Math.max(4,rect.top-calH-4):(rect.bottom+4);
    left=Math.min(Math.max(4,rect.left),window.innerWidth-calW-4);
  }
  fl.style.top=top+'px';
  fl.style.left=left+'px';
  document.body.appendChild(fl);
  _commonCalRender(fl,dpCalYear,dpCalMonth,dpSelectDate,_dpNav,{yearPopup:true});
  setTimeout(function(){document.addEventListener('click',_dpCalOutside);},10);
}
function _dpCalOutside(e){
  const fl=document.getElementById('dpCalFloat');if(!fl)return;
  if(fl.contains(e.target))return;
  if(e.target.closest('[data-action="dpOpenCal"]'))return;
  fl.remove();document.removeEventListener('click',_dpCalOutside);
}
function dpFetchHolidays(year,cb){
  ensureHolidayYear(String(year)); const holidays={};Object.keys(S.koreanHolidays).forEach(function(d){if(d.startsWith(String(year)))holidays[d]=S.koreanHolidays[d];});
  cb(holidays);
}
function _dpNav(delta,setMonth,setYear){
  if(setYear!==undefined)dpCalYear=setYear;
  if(setMonth!==undefined){dpCalMonth=setMonth;}
  else if(setYear===undefined){dpCalMonth+=delta;if(dpCalMonth<0){dpCalMonth=11;dpCalYear--;}if(dpCalMonth>11){dpCalMonth=0;dpCalYear++;}}
  const fl=document.getElementById('dpCalFloat');if(!fl)return;
  _commonCalRender(fl,dpCalYear,dpCalMonth,dpSelectDate,_dpNav,{yearPopup:true});
}
let _dpSingleMode=false;   /* '특정일 선택' 칩 활성 — 어느 달력으로 고르든 시작=종료 동기 (2026-06-11) */
function dpSelectDate(dateStr){
  if(dpCalTarget){const _el=document.getElementById(dpCalTarget); if(_el)_el.value=dateStr;}   /* dpSingle 은 가상 타겟(입력칸 없음) */
  /* 특정일 모드: 시작일이든 종료일이든 하나만 고르면 둘 다 그 날짜 (사용자 요청 2026-06-11) */
  if(_dpSingleMode || dpCalTarget==='dpSingle'){
    const _f=document.getElementById('dpFrom'), _t=document.getElementById('dpTo');
    if(_f)_f.value=dateStr; if(_t)_t.value=dateStr;
  }
  const fl=document.getElementById('dpCalFloat');if(fl)fl.remove();
  document.removeEventListener('click',_dpCalOutside);
  _dpCheckBtnState();
}
function _dpCheckBtnState(){
  const from=(document.getElementById('dpFrom')||{}).value;
  const to=(document.getElementById('dpTo')||{}).value;
  const btn=document.getElementById('dpPreviewMainBtn');if(!btn)return;
  /* 특정 방문자 형식은 대상(사람)을 선택해야 미리보기 활성 — 미선택이면 날짜가 있어도 비활성. (사용자 요청 2026-06-16) */
  const _needStudent=(_dpFormat==='student' && !_dpSelectedStudentId);
  if(from&&to&&!_needStudent){
    btn.disabled=false;btn.style.opacity='1';btn.style.background='';btn.style.cursor='pointer';
    btn.className='btn btn-primary btn-sm';
  } else {
    btn.disabled=true;btn.style.opacity='0.4';btn.style.background='#94a3b8';btn.style.cursor='default';
    btn.className='btn btn-sm';
  }
}

/* ── Infection/Emergency form floating calendar (uses _commonCalRender) ── */
let _infCalField=null;
let _infCalYear=new Date().getFullYear();
let _infCalMonth=new Date().getMonth();
export function infOpenCal(fieldId,el){
  const wrap=document.getElementById('infCalWrap');if(!wrap)return;
  if(_infCalField===fieldId&&wrap.style.display!=='none'){infCloseCal();return;}
  /* 시계 팝업이 열려 있으면 먼저 닫기 — 동시 표시 방지 */
  const _cpWrap=document.getElementById('clockPickerWrap');
  if(_cpWrap&&_cpWrap.style.display!=='none')_cpWrap.style.display='none';
  _infCalField=fieldId;
  const val=document.getElementById(fieldId)?document.getElementById(fieldId).value:'';
  if(val){const d=new Date(val);if(!isNaN(d)){_infCalYear=d.getFullYear();_infCalMonth=d.getMonth();}}
  else{_infCalYear=new Date().getFullYear();_infCalMonth=new Date().getMonth();}
  const rect=el.getBoundingClientRect();
  wrap.style.cssText='display:block;position:fixed;z-index:9999;top:-9999px;left:'+Math.min(rect.left,window.innerWidth-260)+'px';
  _commonCalRender(wrap,_infCalYear,_infCalMonth,infSelectDate,_infNav,{yearPopup:true});
  const wh=wrap.offsetHeight;
  if(window.innerHeight-rect.bottom<wh+8){
    wrap.style.top=Math.max(4,rect.top-wh-4)+'px';
  }else{
    wrap.style.top=(rect.bottom+4)+'px';
  }
}
function infCloseCal(){
  const wrap=document.getElementById('infCalWrap');if(wrap)wrap.style.display='none';
  _infCalField=null;
}
function _infNav(delta,setMonth,setYear){
  if(setYear!==undefined)_infCalYear=setYear;
  if(setMonth!==undefined)_infCalMonth=setMonth;
  else if(setYear===undefined){_infCalMonth+=delta;if(_infCalMonth<0){_infCalMonth=11;_infCalYear--;}if(_infCalMonth>11){_infCalMonth=0;_infCalYear++;}}
  const wrap=document.getElementById('infCalWrap');if(!wrap)return;
  _commonCalRender(wrap,_infCalYear,_infCalMonth,infSelectDate,_infNav,{yearPopup:true});
}
function infSelectDate(ds){
  if(_infCalField){
    const el=document.getElementById(_infCalField);
    if(el){el.value=ds;el.dispatchEvent(new Event('input',{bubbles:true}));}
  }
  infCloseCal();
}
/* 하위 호환: infRenderCal은 더 이상 사용하지 않음 */
function infRenderCal(){_infNav(0,_infCalMonth,_infCalYear);}
/* emergency-view.js의 click 핸들러가 window.infOpenCal 로 호출 — 순환 import 회피 */
window.infOpenCal=infOpenCal;
document.addEventListener('click',function(e){
  /* e.target.isConnected: innerHTML 재구성으로 분리된 요소 클릭 무시 */
  if(!e.target.isConnected)return;
  const wrap=document.getElementById('infCalWrap');
  if(wrap&&wrap.style.display!=='none'&&!wrap.contains(e.target)&&!e.target.closest('[data-inf-cal]'))infCloseCal();
  const cw=document.getElementById('clockPickerWrap');
  if(cw&&cw.style.display!=='none'&&!cw.contains(e.target)&&!e.target.closest('[data-action="openClockPicker"]')&&!e.target.closest('[data-action="openTimePicker"]')){cpCleanHandlers();cw.style.display='none';}
});

let timePickerState={recId:null,field:'timeIn',originalVal:''};
/* 퇴실시간은 입실시간보다 빠를 수 없다 — timeOut 을 입실시간 미만으로 조정하면 입실시간으로 보정.
 *  (timeIn 변경 시엔 openTimePicker 안에서 timeOut 을 timeIn+N분으로 자동 재계산하므로 별도 보정 불필요.) */
let _tpClampToastAt=0;
function _tpToMin(s){ const m=/^(\d{1,2}):(\d{2})$/.exec(s||''); return m? (parseInt(m[1],10)*60+parseInt(m[2],10)) : null; }
function _tpClampOut(rec, field, val){
  if(field!=='timeOut' || !val || !rec || !rec.timeIn) return val;
  const o=_tpToMin(val), i=_tpToMin(rec.timeIn);
  if(o!=null && i!=null && o<i){
    const now=performance.now();
    if(now-_tpClampToastAt>1500){ _tpClampToastAt=now; try{ bus.emit('toast:show',{text:'퇴실 시간은 입실 시간('+rec.timeIn+')보다 빠를 수 없습니다.'}); }catch(_){} }
    return rec.timeIn;
  }
  return val;
}
function tpAutoSave(){
  const rec=S.records.find(function(r){return r.id===timePickerState.recId;});
  const input=document.getElementById('tpTimeInput');
  if(!rec||!input||!input.value)return;
  const _cv=_tpClampOut(rec, timePickerState.field, input.value);
  rec[timePickerState.field]=_cv;
  if(_cv!==input.value)input.value=_cv;
  saveData();bus.emit('render:daily');bus.emit('render:calendar');bus.emit('render:sidebar');
}
function tpShiftTime(mins){
  const input=document.getElementById('tpTimeInput');
  if(!input||!input.value)return;
  const p=input.value.split(':');
  let total=(parseInt(p[0],10)*60)+(parseInt(p[1],10))+mins;
  total=((total%(24*60))+(24*60))%(24*60);
  input.value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
  tpAutoSave();
}
function tpRestore(){
  const rec=S.records.find(function(r){return r.id===timePickerState.recId;});
  const input=document.getElementById('tpTimeInput');
  if(!rec||!input)return;
  input.value=timePickerState.originalVal;
  rec[timePickerState.field]=timePickerState.originalVal;
  saveData();bus.emit('render:daily');bus.emit('render:calendar');bus.emit('render:sidebar');
}
function closeTimePicker(){closeCellPopup();}
export function openTimePicker(recId,field,btn){
  closeCellPopup();
  const rec=S.records.find(function(r){return r.id===recId;});
  if(!rec||!btn)return;
  const val=rec[field]||'00:00';
  timePickerState={recId:recId,field:field,originalVal:val};
  /* 숨겨진 input을 만들어 clockPicker가 값을 쓸 수 있게 함 */
  const hiddenId='_tpClockInput_'+recId+'_'+field;
  const existing=document.getElementById(hiddenId);
  if(existing)existing.remove();
  const hiddenInp=document.createElement('input');
  hiddenInp.id=hiddenId;hiddenInp.value=val;hiddenInp.style.display='none';
  hiddenInp.addEventListener('input',function(){
    const v=this.value;
    if(rec){
      rec[field]=_tpClampOut(rec, field, v);
      /* timeIn 이 변경되면 timeOut 자동 재계산 — 설정의 "퇴실 시간 N분 후" 를 사용.
       * 사용자 피드백(과거기록 작성 편의): 입실시간만 정하면 퇴실시간은 사이간격 자동 적용,
       * 필요한 경우에만 퇴실시간을 사용자가 직접 수정. */
      if(field === 'timeIn' && v){
        let _minAfter = parseInt(localStorage.getItem('ec_daily_auto_time_out_after')||'4', 10);
        if(isNaN(_minAfter) || _minAfter < 0) _minAfter = 4;
        else if(_minAfter > 60) _minAfter = 60;
        const m = v.match(/^(\d{1,2}):(\d{2})$/);
        if(m){
          const h = parseInt(m[1],10), mn = parseInt(m[2],10);
          const _d = new Date(); _d.setHours(h, mn, 0, 0);
          const _out = new Date(_d.getTime() + _minAfter*60000);
          rec.timeOut = String(_out.getHours()).padStart(2,'0')+':'+String(_out.getMinutes()).padStart(2,'0');
        }
      }
      rec._dirty=true;
      saveRecordNow(rec);
      bus.emit('render:daily');
      bus.emit('render:calendar');
      bus.emit('render:sidebar');
      /* 증상 모달의 시간 칩(.sym-time-chip) 라이브 갱신용 — 모달이 떠 있으면 칩 텍스트 즉시 반영 */
      bus.emit('record:time-changed', {recId: rec.id});
      const toast=document.getElementById('globalSaveToast');
      if(toast){
        toast.textContent='저장 중…';
        toast.className='global-save-toast show saving';
        setTimeout(function(){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);},300);
      }
    }
  });
  document.body.appendChild(hiddenInp);
  openClockPicker(hiddenId,btn);
  /* 분(minute) 단계 완료 시 호출되는 콜백 — 시계 픽커 코어(_cpStartDrumEdit)가 분 2자리완료/Tab/→ 에서 호출.
   *  입실(timeIn) 분 완료 → 시계 닫고 퇴실(timeOut) 시계 자동 오픈 (시 자동 블록).
   *  퇴실(timeOut) 분 완료 → 저장 후 닫기.
   *  일반일지표(openTimePicker, data-rid) · 증상 모달(openSymTimePicker, data-rec-id) 두 경로 셀렉터 모두 대응 (사용자 요청 2026-05-28). */
  window._cpMinuteAdvance = function(){
    const st = timePickerState;
    try{ closeClockPickerAnim(); }catch(_){ const w=document.getElementById('clockPickerWrap'); if(w)w.style.display='none'; }
    if(st && st.field==='timeIn'){
      setTimeout(function(){
        /* 증상 모달이 떠 있으면 그 모달의 퇴실 칩 위치에 시계가 떠야 함 (일반일지 표 셀은 모달 뒤라 위치가 어긋남).
         * 사용자 보고 2026-05-28: 증상 팝업에서 Tab 시 퇴실 시계가 엉뚱한 곳에 떴음. */
        const inSym = !!document.getElementById('symCatOverlay');
        const cell = inSym
          ? document.querySelector('[data-action="openSymTimePicker"][data-rec-id="'+st.recId+'"][data-field="timeOut"]')
          : document.querySelector('[data-action="openTimePicker"][data-rid="'+st.recId+'"][data-field="timeOut"]');
        if(cell) openTimePicker(st.recId,'timeOut',cell);
      }, 180);
    }
  };
  /* TAB 키 안전판 — 시계 픽커의 드럼 input 밖에 포커스가 있을 때만 _tpTabHandler 가 처리 (드럼 안 Tab 은 _cpStartDrumEdit 가 처리). 1회만 등록. */
  if(!window._tpTabHandlerBound){
    window._tpTabHandlerBound = true;
    document.addEventListener('keydown', _tpTabHandler, true);
  }
}
function _tpTabHandler(e){
  if(e.key !== 'Tab') return;
  const wrap = document.getElementById('clockPickerWrap');
  if(!wrap || wrap.style.display === 'none') return;
  if(!timePickerState || !timePickerState.recId) return;
  /* 시계 픽커의 시·분 드럼 input 안에서 Tab 이 발화된 경우엔 자체 핸들러(드럼 input keydown)가
   * 시→분 자동 이동을 처리한다. 여기선 가로채지 않고 통과시킴. */
  if(e.target && e.target.closest && e.target.closest('#cpDrumH, #cpDrumM')) return;
  e.preventDefault();
  e.stopPropagation();
  const curField = timePickerState.field;
  const recId = timePickerState.recId;
  /* 현재 시계 닫기 */
  try { closeClockPickerAnim(); } catch(_) { wrap.style.display='none'; }
  if(curField === 'timeIn'){
    /* 퇴실시간 셀 찾아 동일하게 시계 픽커 열기 — 증상 모달이면 그 모달 퇴실 칩 위치 우선 */
    setTimeout(function(){
      const inSym = !!document.getElementById('symCatOverlay');
      const cell = inSym
        ? document.querySelector('[data-action="openSymTimePicker"][data-rec-id="'+recId+'"][data-field="timeOut"]')
        : document.querySelector('[data-action="openTimePicker"][data-rid="'+recId+'"][data-field="timeOut"]');
      if(cell) openTimePicker(recId, 'timeOut', cell);
    }, 180);
  }
  /* timeOut 에서 TAB 은 단순히 닫힘 */
}

/* ── DB 조회 결과 + 화면(S.records) 정합화 ──────────────────────────────────
 * 보건일지 출력은 recordsDailyByDateRange(=DB) 로 방문을 읽지만, 일반 일지 화면은
 * S.records(메모리)로 보여준다. 방문을 새로 등록하면 화면에는 즉시 나타나지만 DB row 는
 * recordsDailyInsert 프로미스가 resolve 된 뒤에야 생긴다(삽입 지연·실패 시 더 늦거나 안 생김).
 * 그 사이 출력을 열면 "화면엔 2명인데 출력엔 1명"이 될 수 있다(사용자 보고 2026-07-06).
 * → DB 결과를 기준으로 하되, 같은 기간의 S.records 중 아직 DB 에 없는 방문을 보태
 *   출력이 화면보다 적게 나오는 일을 없앤다. (협업 다른 보건교사의 DB-only 방문은 그대로 유지)
 *   중복은 _dbId(=DB id) + (사람·날짜·입실시각) 복합키 두 겹으로 차단해 이중 계수 방지. */
function _dpReconcileWithMemory(dbRecs, from, to){
  const out=Array.isArray(dbRecs)?dbRecs.slice():[];
  const idSeen={}, compSeen={};
  out.forEach(function(r){
    if(!r)return;
    if(r.id!=null)idSeen[String(r.id)]=1;
    compSeen[(r.personUid||'')+'|'+(r.date||'')+'|'+(r.timeIn||'')]=1;
  });
  (S.records||[]).forEach(function(r){
    if(!r||r._deleted)return;
    if(!(r.date>=from&&r.date<=to))return;
    if(r._dbId!=null&&idSeen[String(r._dbId)])return;          /* 이미 DB 결과에 있음 */
    const ck=(r.personUid||'')+'|'+(r.date||'')+'|'+(r.timeIn||'');
    if(compSeen[ck])return;                                     /* 같은 사람·날짜·입실시각이 DB 에 있음(삽입 직후 _dbId 미반영 창 포함) */
    out.push(r); compSeen[ck]=1;
  });
  /* 보탠 방문이 뒤에 붙어 순서가 흐트러지지 않게 날짜→입실시각 정렬(폴백 경로와 동일 기준) */
  out.sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''))||String(a.timeIn||'').localeCompare(String(b.timeIn||''));});
  return out;
}

async function dpShowPreview(){
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  if(!from||!to){alert('시작일과 종료일을 선택하세요.');return;}
  if(from>to){alert('시작일이 종료일보다 늦습니다.');return;}
  /* 로딩 점 애니메이션 표시 */
  const _loadingDots=document.getElementById('dpLoadingDots');
  if(_loadingDots)_loadingDots.style.display='inline';
  const colMap={};
  dpColOrder.forEach(function(c){if(dpColVis[c]!==false)colMap[c]=true;});
  /* 동일 날짜 범위 내에서는 records / coverHtml / coverPromise / nurseCounts 를 캐시 — 토글 변경 시 즉시 재렌더 */
  if(!_dpCache||_dpCache.from!==from||_dpCache.to!==to)_dpCache={from:from,to:to,records:null,coverHtml:null,coverPromise:null,nurseCounts:null};
  /* 백엔드 DB 조회 + 표지 데이터 prefetch 를 병렬 실행 — 토글이 아직 OFF 여도 선제 로딩 */
  if(!_dpCache.records){
    /* 표지 prefetch (토글 상태와 무관) — 이후 토글 ON 시 즉시 재사용 */
    if(!_dpCache.coverHtml&&!_dpCache.coverPromise){
      _dpCache.coverPromise=buildDeptStatsCover(from,to).then(function(h){_dpCache.coverHtml=h||'';return h;}).catch(function(){return '';});
    }
    try{
      const res=await window.electronAPI.recordsDailyByDateRange(from,to);
      _dpCache.records=_dpReconcileWithMemory((res&&res.success)?(res.data||[]):[],from,to);
    }catch(e){
      _dpCache.records=S.records.filter(function(r){return r.date>=from&&r.date<=to;}).sort(function(a,b){return a.date.localeCompare(b.date)||a.timeIn.localeCompare(b.timeIn);});
    }
  }
  let filtered=_dpCache.records;
  /* 특정 학생 내역 형식 — selected student/staff 1명의 record 만 (사용자 요청 2026-05-28).
   *  studentId / personUid / person_uid (DB row) 셋 다 비교 — IPC 결과 키 케이스 안전망. */
  if(_dpFormat==='student'){
    if(!_dpSelectedStudentId){
      bus.emit('toast:show',{text:'먼저 대상(학생/교직원)을 선택하세요.'});
      return;
    }
    const _sid = String(_dpSelectedStudentId);
    filtered = filtered.filter(function(r){
      const _rid = r.studentId || r.personUid || r.person_uid || '';
      return String(_rid) === _sid;
    });
  }
  /* 상담 내역(보건일지 형식) — 실제 상담 기록이 있는 방문만 남김 (사용자 요청 2026-06-25) */
  if(_dpFormat==='counsel'){
    filtered = filtered.filter(function(r){ return _dpHasCounsel(r); });
  }
  /* 진행 카운터용 실제 출력 건수 — 특정 학생/상담 필터 후 건수. 이전엔 기간 전체 건수가 분모로 쓰여
   *  "학생 16건인데 분모가 전체"로 표시되던 버그 (사용자 보고 2026-08-27). */
  if(_dpCache){_dpCache.filteredCount=filtered.length;_dpCache.filteredRecs=filtered;}   /* Excel 병합용 순서 보존 */
  const area=document.getElementById('dpPreviewArea');
  /* 기록 0건이어도 양식은 빈 표로 출력 — 사용자가 공식 서식 자체를 출력해야 할 때 대비 */
  function formatDateKr(ds){const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  /* 표지 포함 옵션 — 진료과별 통계 (prefetch 된 값이 있으면 즉시 사용).
   * 상담 내역 형식 제외 — 카드가 숨겨져도 다른 형식에서 켠 체크 상태가 남아 상담 출력에
   * 전교 통계가 끼어드는 것 방어 (복원 범위: row/daily/student, 2026-08-12). */
  const _coverOpt=document.getElementById('dpOptCover');
  let html='';
  if(_coverOpt&&_coverOpt.checked&&_dpFormat!=='counsel'){
    if(_dpFormat==='student'&&_dpSelectedStudentId){
      /* 특정 방문자 — 전교생 표지 대신 그 사람만의 진료과별 집계 (사용자 보고 2026-06-10) */
      try{html=_dpBuildStudentCoverHtml(filtered);}catch(e){html='';}
    } else if(_dpCache.coverHtml){html=_dpCache.coverHtml;}
    else if(_dpCache.coverPromise){
      try{html=(await _dpCache.coverPromise)||'';}catch(e){html='';}
    } else {
      try{html=await buildDeptStatsCover(from,to);_dpCache.coverHtml=html;}catch(e){html='';}
    }
  }
  /* 진료과별 통계 표지 — 단독 페이지(2페이지)로, 본문은 그 다음 페이지부터 (사용자 요청 2026-06-16) */
  if(html)html='<div style="page-break-after:always;break-after:page">'+html+'</div>';
  /* 상담 주제별 통계 표지 — 진료과 표지 다음 단독 페이지 (사용자 요청 2026-06-25) */
  const _counselOpt=document.getElementById('dpOptCounsel');
  if(_counselOpt&&_counselOpt.checked){
    let _ch='';
    try{_ch=await buildCounselStatsCover(from,to);}catch(e){_ch='';}
    if(_ch)html+='<div style="page-break-after:always;break-after:page">'+_ch+'</div>';
  }
  html+='<div style="font-size:18pt;font-weight:800;text-align:center;margin-bottom:12px">'+escHtml(_dpRowTitleText())+'</div>';
  html+='<div style="height:12px"></div>';
  html+='<div style="font-size:12px;color:var(--t1)">'+escHtml(S.settings.schoolName||'')+'</div>';
  html+='<div style="font-size:12px;color:var(--t1)">기간: '+formatDateKr(from)+' ~ '+formatDateKr(to)+'</div>';
  if(colMap.nurseStat){
    /* 백엔드 DB에서 간호사별 집계 — 동일 범위 내 캐시 재사용 */
    let nurseCounts=_dpCache.nurseCounts;
    if(!nurseCounts){
      nurseCounts={};
      try{
        const nRes=await window.electronAPI.recordsNurseStats(from,to);
        if(nRes&&nRes.success)nurseCounts=nRes.data||{};
      }catch(e){
        filtered.forEach(function(r){const n=r.nurse||'미지정';nurseCounts[n]=(nurseCounts[n]||0)+1;});
      }
      _dpCache.nurseCounts=nurseCounts;
    }
    const nurseLine=Object.keys(nurseCounts).map(function(name){return name+' '+nurseCounts[name]+'명';}).join(', ');
    html+='<div style="font-size:12px;color:var(--t1)">처치자별 건수: '+(nurseLine||'-')+'</div>';
  }
  html+='<div style="height:12px"></div>';
  const dpLabels={seq:'순',schoolLevel:'학교급',department:'학과',gradeClass:'학년반',num:'번호',name:'이름',date:'날짜',time:'시간',gender:'성별',bodymap:'부위',symptoms:'증상',treatment:'처치 내용',medication:'투약 내용',bedUsage:'침상 이용',vitals:'V/S',nurse:'처치자'};
  /* 상담 내역(보건일지 형식) — 처치자→상담자, 증상→상담 주제, 처치 내용→상담 내용 (사용자 요청 2026-06-25) */
  if(_dpFormat==='counsel'){ dpLabels.nurse='상담자'; dpLabels.symptoms='상담 주제'; dpLabels.treatment='상담 내용'; }
  const dpAlign={seq:'center',schoolLevel:'center',department:'center',gradeClass:'center',num:'center',name:'center',date:'center',time:'center',gender:'center',bodymap:'left',symptoms:'left',dept:'left',treatment:'left',medication:'left',bedUsage:'center',vitals:'left',nurse:'center'};
  const _lvShort={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  /* V/S 열은 인쇄에서 항상 제외 — V/S 는 처치 칸 자리에 표로 인쇄한다(2026-07-21).
     상담 내역(보건일지 형식)은 침상 이용 열도 제외 (사용자 요청 2026-06-25). */
  const activeCols=dpColOrder.filter(function(c){ if(c==='vitals')return false; if(_dpFormat==='counsel'&&c==='bedUsage')return false; return colMap[c]; });
  /* 사용자 열 너비 반영 (2026-06-11) — colgroup + table-layout:fixed:
   * width:100% 유지로 페이지에 꽉 차되, 각 열의 상대 비율을 px 값이 결정 → 휠/숫자 조절이 그대로 보임.
   * PDF 는 이 미리보기 HTML 을 그대로 인쇄하므로 자동 일치. */
  area._dpActiveCols=activeCols.slice();
  let _cwColgroup='<colgroup>';
  activeCols.forEach(function(c){ const w=_dpEffW(c); _cwColgroup+='<col style="width:'+w+'px" width="'+w+'">'; });
  _cwColgroup+='</colgroup>';
  /* width:auto + fixed — px 수치가 절대 폭으로 그대로 적용 (사용자 요구 2026-06-11: 수치=실제 폭) */
  html+='<table data-dp-main="1" style="width:auto;border-collapse:collapse;font-size:11pt;table-layout:fixed">'+_cwColgroup+'<thead><tr style="background:var(--bg);border-bottom:1px solid var(--bdr)">';
  /* 셀 인라인 스타일 → dpx- 클래스 (경량화 2026-08-12) — 학기·연간 대용량 출력의 5MB 초과 방지 */
  activeCols.forEach(function(c){html+='<th class="dpx-th">'+(dpLabels[c]||c)+'</th>';});
  html+='</tr></thead><tbody>';
  filtered.forEach(function(r,ri){
    const s=getStu(r.personUid)||{name:r.personName||'',grade:r.studentGrade||0,cls:r.studentClass||0,num:r.studentNum||0,type:r.personType||'student',gender:r.studentGender||'',position:r.staffPosition||'',level:r.studentLevel||'',department:r.studentDepartment||''};
    const isStaff=s.type==='staff';
    const gradeCol=_dpGradeCol(s);
    const numCol=isStaff?'-':(s.num||'-');
    let _g=(s&&s.gender)||''; if(_g==='M')_g='남'; else if(_g==='F')_g='여';
    const cellData={seq:ri+1,schoolLevel:isStaff?'-':(_lvShort[s.level]||s.level||'-'),department:isStaff?'-':(s.department||'-'),gradeClass:gradeCol||'-',num:numCol,name:(s&&s.name?s.name:'-'),date:r.date||'-',time:r.timeIn+(r.timeOut?' ~ '+r.timeOut:''),gender:_g||'-',bodymap:(function(){
      var _bm=(window._bmData||{})[r.id]||[];
      var _ls=[];_bm.forEach(function(mm){if(mm&&mm.label&&_ls.indexOf(mm.label)===-1)_ls.push(mm.label);});
      return _ls.join(', ')||'-';
    })(),symptoms:(function(){
      /* 다중 증상 + treatmentBySym → 증상별 줄바꿈 분층 — daily 와 동일 규칙 (사용자 요청 2026-06-11, 세 형식 공통) */
      var _arr=(r.symptoms||[]);
      var _hasBySym=r.treatmentBySym&&typeof r.treatmentBySym==='object'&&!Array.isArray(r.treatmentBySym)&&Object.keys(r.treatmentBySym).length>0;
      var _isMulti=_arr.length>1&&_hasBySym&&r.treatmentBranched!==false;
      return _arr.join(_isMulti?'\n':', ')||'-';
    })(),dept:r.dept||'-',treatment:(function(){
      var arr=(r.treatment||[]);
      var medDisp=r.medication?formatMedicationDisplay(r.medication):'';
      var m=r.treatmentMemo||'';
      var _hasBySym=r.treatmentBySym&&typeof r.treatmentBySym==='object'&&!Array.isArray(r.treatmentBySym)&&Object.keys(r.treatmentBySym).length>0;
      var _isLegacyFlat=!_hasBySym&&arr.length>0;
      var _isMulti=r.symptoms&&r.symptoms.length>1&&!_isLegacyFlat&&r.treatmentBranched!==false;
      if(_isMulti){
        var _medDispForSym=function(sym){
          if(!r.medsBySym||!r.medsBySym[sym]||!r.medsBySym[sym].length)return '';
          var dm=(r.medDosesBySym&&r.medDosesBySym[sym])||{};
          var str=r.medsBySym[sym].map(function(mm){var d=dm[mm]||'';return d?(mm+'('+d+')'):mm;}).join(', ');
          return formatMedicationDisplay(str);
        };
        /* 상담 처치란 문구 — 맵에 없고 flat 에만 있으므로 상담 층에 직접 합류 (사용자 보고 2026-08-25) */
        var _clT=counselTreatText(r);
        var _clIdx=_clT?r.symptoms.findIndex(isCounselSymLabel):-1;
        var lines=r.symptoms.map(function(sym,idx){
          var symTreats=(r.treatmentBySym[sym]||[]);
          var medDispForSym=_medDispForSym(sym);
          var _lbl=symTreats.map(function(t){
            var b=t;var mt=t.match(/^(.+?)\s*\((.*)\)\s*$/);if(mt)b=mt[1].trim();
            if(b==='투약'&&medDispForSym)return medDispForSym;
            return t;
          });
          if(idx===_clIdx)_lbl.push(_clT);
          return '→ '+_lbl.join(', ');
        });
        if(m)lines[0]=(lines[0]?lines[0]+' / ':'')+m;
        return lines.join('\n')||'-';
      }
      var labeled=arr.map(function(t){return (t==='투약'&&medDisp)?medDisp:t;});
      var b=labeled.join(', ');
      var hasMedTreat=arr.indexOf('투약')!==-1;
      if(!hasMedTreat&&medDisp)b=(b?b+' / ':'')+medDisp;
      var out=(b+(m?(b?' / ':'')+m:'')).trim();return out||'-';
    })(),medication:r.medication||'-',bedUsage:_dpIsBedUsed(r)?'O':'',vitals:[r.temp?'T: '+r.temp:'',r.bp?'BP: '+r.bp:'',r.pulse?'P: '+r.pulse:'',(r.respiration||r.resp)?'R: '+(r.respiration||r.resp):'',r.spo2?'SpO₂: '+r.spo2:'',r.bst?'BST: '+r.bst:''].filter(Boolean).join(', ')||'-',nurse:r.nurse||'-'};
    html+='<tr class="dpx-tr">';
    activeCols.forEach(function(c){html+='<td class="dpx-td '+(dpAlign[c]==='center'?'dpx-c':'dpx-l')+'">'+(cellData[c]||'-')+'</td>';});
    html+='</tr>';
    /* ── V/S 값이 있으면 처치 칸 자리에 표로 인쇄 (항상 표 형식, 단일 측정도 1행 표). 2026-07-21 ── */
    {
      const _vsTbl=_dpVsTsTableHtml(r);
      if(_vsTbl){
        const _trtIdx=activeCols.indexOf('treatment');
        html+='<tr class="dp-vs-subrow dpx-tr">';
        if(_trtIdx<0){
          html+='<td colspan="'+activeCols.length+'" class="dpx-sub">'+_vsTbl+'</td>';
        } else {
          for(let _i=0;_i<_trtIdx;_i++){ html+='<td class="dpx-fill"></td>'; }
          html+='<td colspan="'+(activeCols.length-_trtIdx)+'" class="dpx-sub">'+_vsTbl+'</td>';
        }
        html+='</tr>';
      }
    }
    /* ── 신체사정이 있으면 처치 칸 자리에 표로 인쇄 ── */
    {
      const _paTbl=_dpPaTableHtml(r);
      if(_paTbl){
        const _trtIdx=activeCols.indexOf('treatment');
        html+='<tr class="dp-pa-subrow dpx-tr">';
        if(_trtIdx<0){
          html+='<td colspan="'+activeCols.length+'" class="dpx-sub">'+_paTbl+'</td>';
        } else {
          for(let _i=0;_i<_trtIdx;_i++){ html+='<td class="dpx-fill"></td>'; }
          html+='<td colspan="'+(activeCols.length-_trtIdx)+'" class="dpx-sub">'+_paTbl+'</td>';
        }
        html+='</tr>';
      }
    }
  });
  /* 데이터 없으면 빈 행 1개 추가 (양식 가시성 확보) */
  if(!filtered.length){
    const colspan=2+activeCols.length;
    html+='<tr><td colspan="'+colspan+'" style="padding:24px;text-align:center;color:var(--t3);font-size:11px">해당 기간에 기록이 없습니다. (양식만 출력됩니다)</td></tr>';
  }
  html+='</tbody></table>';
  /* dpx- 공용 CSS 를 미리보기 맨 앞에 삽입 — PDF/인쇄가 innerHTML 을 복제하므로 자동 승계 (경량화 2026-08-12) */
  area.innerHTML='<style>'+_DPX_CSS+'</style>'+html;
  area.style.display='block';
  /* 로딩 점 숨김 */
  if(_loadingDots)_loadingDots.style.display='none';
  /* 바운스 스크롤 적용 */
  if(!area._bounceInit){
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
}

const DP_COLS=[
  {col:'seq',label:'순'},
  {col:'schoolLevel',label:'학교급'},{col:'department',label:'학과'},
  {col:'gradeClass',label:'학년반'},
  {col:'num',label:'번호'},{col:'name',label:'이름'},
  {col:'date',label:'날짜'},
  {col:'time',label:'시간'},{col:'gender',label:'성별'},
  {col:'nurse',label:'처치자'},
  {col:'bodymap',label:'부위(바디맵)'},
  {col:'symptoms',label:'증상'},
  {col:'treatment',label:'처치 내용'},
  /* '투약 내용' 별도 컬럼 제거 (사용자 결정 2026-06-10) — 처치 내용이 일반일지와 동일하게
   * 투약[약품(투여량)]을 이미 결합 표시하므로 중복. cellData.medication 빌드는 보존(보관). */
  {col:'bedUsage',label:'침상 이용'}
  /* 'V/S' 열은 표시 항목에서 제거 — V/S 는 처치 칸 자리에 표로 인쇄(2026-07-21) */
];

/* 칩 라벨(DP_COLS.label)과 실제 출력 표 헤더가 다른 경우 덮어씀 */
const DP_PRINT_LABELS={bodymap:'부위'};

/* ═══ 출력 열 너비 사용자 조정 (2026-06-11) ═══
 *  표시 항목·순서 칩의 px 배지에서 휠/숫자 입력으로 각 열 너비를 조절.
 *  · 미리보기(방문 상세)에 즉시 반영 → PDF 는 미리보기 HTML 그대로 인쇄라 자동 일치.
 *  · Excel/Sheets payload 의 colWidths 에도 동일 적용 (ExcelJS 가 px/7 로 열폭 변환).
 *  · 저장: localStorage ec_dp_col_widths (+commonMappings/custom-backup — 업데이트·학교이동 보존). */
const DP_CW_KEY='ec_dp_col_widths';
let dpColWidthsUser={};
function _dpLoadUserWidths(){ try{ const v=JSON.parse(localStorage.getItem(DP_CW_KEY)||'{}'); dpColWidthsUser=(v&&typeof v==='object'&&!Array.isArray(v))?v:{}; }catch(_){ dpColWidthsUser={}; } }
function _dpClampW(v){ v=parseInt(v,10); if(!Number.isFinite(v))return null; return Math.max(24,Math.min(600,v)); }
function _dpUserW(col,fallback){ const v=_dpClampW(dpColWidthsUser[col]); return v==null?fallback:v; }
let _dpCwSaveTimer=null;
function _dpSetUserW(col,v){
  const c=_dpClampW(v); if(c==null)return;
  dpColWidthsUser[col]=c;
  clearTimeout(_dpCwSaveTimer);
  _dpCwSaveTimer=setTimeout(function(){
    try{ localStorage.setItem(DP_CW_KEY,JSON.stringify(dpColWidthsUser)); }catch(_){}
    /* DB blob write-through (사용자 보고 2026-06-11 fix) — 부팅 로드(app-data-bridge.loadCommon)가
     * dbGet(blob) 우선이라, blob 을 함께 갱신하지 않으면 최초 1회 스냅샷이 박제되어
     * 매 부팅 옛값이 localStorage 를 덮어씀. 기존 열필드(col_widths)의 dbSet 패턴과 동일하게 해결. */
    try{ if(window.electronAPI&&window.electronAPI.dbSet) window.electronAPI.dbSet('common','dp_col_widths',dpColWidthsUser); }catch(_){}
  },300);
}
/* 형식별 기본 너비 — daily 는 기존 _widthMap, row/student 는 기존 라벨 기반 _baseW 와 동일 값 유지 */
const DP_W_DAILY={seq:36,schoolLevel:52,department:80,gradeClass:70,num:44,name:70,time:70,gender:44,nurse:70,bodymap:90,symptoms:180,treatment:200,medication:130,bedUsage:56,vitals:130};
function _dpRowBaseWByLabel(label){
  if(/^순$/.test(label))return 44;
  if(/^침상 ?이용$/.test(label))return 64;
  if(/^바디맵$/.test(label))return 90;
  if(/^(학교급|학과|성별|번호|학년반)$/.test(label))return 60;
  if(/^(이름|날짜|시간|처치자)$/.test(label))return 90;
  if(/^(증상|처치 ?내용|투약 ?내용|V\/S)$/.test(label))return 200;
  return 110;
}
function _dpDefaultW(col){
  if(_dpFormat==='daily') return DP_W_DAILY[col]||110;
  const info=DP_COLS.find(function(c){return c.col===col;});
  return _dpRowBaseWByLabel(info?info.label:String(col));
}
function _dpEffW(col){ return _dpUserW(col,_dpDefaultW(col)); }
/* 너비 변경 → 미리보기 라이브 갱신: 즉시 DOM 패치(부드러움) + 디바운스 풀 리렌더(저장물 정합) */
let _dpCwRefreshTimer=null;
function _dpOnWidthChanged(col){
  try{
    const area=document.getElementById('dpPreviewArea');
    if(!area || area.style.display==='none') return;
    const w=_dpEffW(col);
    if(_dpFormat!=='daily'){
      /* row/student — 메인 표 colgroup·th 즉시 패치 (렌더 시 area._dpActiveCols 보관) */
      const t=area.querySelector('table[data-dp-main]');
      const act=area._dpActiveCols||[];
      const idx=act.indexOf(col);
      if(t && idx>=0){
        const colEl=t.querySelectorAll('colgroup col')[idx];
        if(colEl){ colEl.style.width=w+'px'; colEl.setAttribute('width',w); }
      }
    } else {
      /* daily — 각 날짜의 방문 상세 표 colgroup·th 즉시 패치 (절대 px) */
      const act=area._dpDailyCols||[];
      const idx=act.indexOf(col);
      if(idx>=0){
        area.querySelectorAll('table.dp-daily-detail').forEach(function(t){
          const colEl=t.querySelectorAll('colgroup col')[idx];
          if(colEl){ colEl.style.width=w+'px'; colEl.setAttribute('width',w); }
          const th=t.querySelectorAll('thead th')[idx];
          if(th) th.style.width=w+'px';
        });
      }
    }
    clearTimeout(_dpCwRefreshTimer);
    /* 너비 변경 리렌더 — 데이터 캐시 재사용 + 로딩 표시 없음 (깜빡임 방지, 2026-06-11) */
    _dpCwRefreshTimer=setTimeout(function(){ try{ if(_dpFormat==='daily')dpShowDailyPreview({reuse:true,silent:true}); else dpShowPreview(); }catch(_){} },450);
  }catch(_){}
}

/* 모든 칩(설정용+미리보기용)의 px 배지 텍스트 동기화 */
function _dpRefreshWBadge(col){
  document.querySelectorAll('.dp-card[data-col="'+col+'"] .dp-w-badge').forEach(function(b){
    b.innerHTML=_dpEffW(col)+'<span style="font-size:9.5px;color:var(--t3)">px</span>';
  });
}

/* 처치 내용에 "침상" 이 포함되어 있으면 침상 이용 O 로 표시 */
function _dpIsBedUsed(record){
  const tr=record.treatment;
  if(Array.isArray(tr))return tr.some(function(t){return String(t||'').indexOf('침상')!==-1;});
  if(typeof tr==='string')return tr.indexOf('침상')!==-1;
  return false;
}
let dpColOrder=DP_COLS.map(function(c){return c.col;});
let dpColVis={};DP_COLS.forEach(function(c){dpColVis[c.col]=true;});dpColVis.bodymap=false; /* 부위(바디맵) 는 기본 OFF (사용자 요청 2026-06-11) */
/* 같은 날짜 범위 내 records/coverHtml/nurseCounts 캐시 (토글 즉시 반응용) */
let _dpCache=null;
let dpColHistory=[];
function dpPushHistory(){dpColHistory.push({order:dpColOrder.slice(),vis:JSON.parse(JSON.stringify(dpColVis))});if(dpColHistory.length>30)dpColHistory.shift();}
function dpUndoCol(){
  if(!dpColHistory.length)return;
  const prev=dpColHistory.pop();dpColOrder=prev.order;dpColVis=prev.vis;
  dpRenderCards();
  const area=document.getElementById('dpPreviewArea');
  if(area&&area.style.display==='block')dpShowPreview();
}
function dpRenderCards(){
  /* 양쪽 컨테이너에 동일하게 렌더 — 설정용(dpColsChips) + 미리보기 헤더용(dpColsChipsPv) */
  ['dpColsChips','dpColsChipsPv'].forEach(_dpRenderCardsTo);
}
function _dpRenderCardsTo(containerId){
  const container=document.getElementById(containerId);if(!container)return;
  /* 미니 팝업 툴팁 위임 (사용자 요청 2026-06-11) — 네이티브 title 대신 설정 패널과 동일한 GUI 미니 팝업.
   * title 은 첫 호버 때 data-tooltip 으로 옮긴 뒤 제거해 OS 기본 툴팁이 함께 뜨지 않게 한다. */
  if(!container._tipDelegated){
    container._tipDelegated=true;
    container.addEventListener('mouseover',function(e){
      const el=e.target.closest('[data-tooltip],[title]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      let txt=el.getAttribute('data-tooltip');
      if(txt==null){ txt=el.getAttribute('title'); if(!txt)return; el.setAttribute('data-tooltip',txt); el.removeAttribute('title'); }
      if(!txt)return;
      try{ showHeaderTooltip(e, txt, false, true); }catch(_){}
    });
    container.addEventListener('mouseout',function(e){
      const el=e.target.closest('[data-tooltip]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      try{ hideHeaderTooltip(); }catch(_){}
    });
  }
  container.innerHTML='';
  let dragCol=null;
  dpColOrder.forEach(function(col){
    const info=DP_COLS.find(function(c){return c.col===col;});if(!info)return;
    /* 상담 내역(보건일지 형식): 침상 이용·V/S 칩 숨김 + 라벨 상담용 (사용자 요청 2026-06-25) */
    if(_dpFormat==='counsel'&&(col==='bedUsage'||col==='vitals'))return;
    const _chipLabel=(_dpFormat==='counsel')?({nurse:'상담자',symptoms:'상담 주제',treatment:'상담 내용'}[col]||info.label):info.label;
    /* '날짜' 컬럼은 매일 한 페이지 형식에서는 항상 OFF + 토글 불가 (페이지가 날짜) */
    const isLockedOff=(_dpFormat==='daily'&&col==='date');
    const active=isLockedOff?false:(dpColVis[col]!==false);
    const card=document.createElement('div');
    card.draggable=!isLockedOff;card.dataset.col=col;
    card.className='dp-card'+(active?' active':'')+(isLockedOff?' locked':'');
    /* 라벨 길이에 맞춰 자동 사이즈 — 짧은 라벨(학과/시간/증상)은 좁게, 긴 라벨은 넉넉하게 */
    const baseOpacity=isLockedOff?'0.4':(active?'1':'0.5');
    /* 2층 구조 (사용자 요청 2026-06-11): 위 = ☰ 라벨 👁 / 아래 = px 수치 — 가로 비대 방지 */
    card.style.cssText='display:inline-flex;flex-direction:column;align-items:stretch;gap:2px;padding:3px 6px;border:1px solid var(--bdr);border-radius:7px;background:var(--card);cursor:'+(isLockedOff?'not-allowed':'pointer')+';white-space:nowrap;user-select:none;box-sizing:border-box;opacity:'+baseOpacity+';transition:all .15s ease';
    const eyeBtnCursor=isLockedOff?'not-allowed':'pointer';
    const eyeBtnTitle=isLockedOff?'매일 한 페이지 형식에서는 날짜가 제목으로 사용되므로 표시할 수 없습니다':'';
    /* 🚫 빗금 동그라미 아이콘 — 잠긴 상태에서만 교체 */
    const lockedIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/></svg>';
    const iconHtml=isLockedOff?lockedIcon:dailyColEyeIcon(active);
    /* px 배지 — 칩 아래층(2층 구조) 가운데 배치 (사용자 요청 2026-06-11 — 가로 비대 방지). 잠긴 칩(daily 의 날짜)은 미표시 */
    const wBadgeHtml=isLockedOff?'':('<div style="display:flex;justify-content:center"><span class="dp-w-badge" title="열 너비(px) — 숫자에 마우스를 대고 휠로 조절, 클릭하면 직접 입력" style="display:inline-flex;align-items:center;gap:2px;font-size:12.5px;font-weight:700;color:#0e7490;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.22);border-radius:6px;padding:3px 9px;cursor:ns-resize;line-height:1.3;font-family:var(--fm)">'+_dpEffW(col)+'<span style="font-size:9.5px;color:var(--t3)">px</span></span></div>');
    card.innerHTML='<div style="display:flex;align-items:center;gap:3px;white-space:nowrap">'
      +'<span style="color:var(--t3);font-size:11px;cursor:'+(isLockedOff?'not-allowed':'grab')+'">☰</span>'
      +'<span style="font-size:11px;font-weight:700;color:var(--t1);white-space:nowrap;padding:0 2px;flex:1">'+_chipLabel+'</span>'
      +'<button type="button" class="dp-eye-btn" title="'+escHtml(eyeBtnTitle)+'" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:20px;padding:0;border:1px solid '+(active?'rgba(6,182,212,0.24)':'rgba(148,163,184,0.2)')+';border-radius:999px;background:'+(active?'rgba(6,182,212,0.10)':'rgba(148,163,184,0.10)')+';color:'+(isLockedOff?'#94a3b8':(active?'var(--cyan)':'var(--t3)'))+';cursor:'+eyeBtnCursor+'">'+iconHtml+'</button>'
      +'</div>'
      +wBadgeHtml;
    if(!isLockedOff){
      card.addEventListener('mouseenter',function(){this.style.background='rgba(186,230,253,0.45)';this.style.borderColor='rgba(14,116,144,0.3)';this.style.opacity='1';});
      card.addEventListener('mouseleave',function(){this.style.background='var(--card)';this.style.borderColor='var(--bdr)';this.style.opacity=dpColVis[col]!==false?'1':'0.5';});
    }
    card.querySelector('.dp-eye-btn').addEventListener('mousedown',function(e){e.stopPropagation();});
    card.querySelector('.dp-eye-btn').addEventListener('pointerdown',function(e){e.stopPropagation();});
    /* ── px 배지: 휠 = ±4px 조절 / 클릭 = 숫자 직접 입력 — 미리보기·PDF·Excel·Sheets 동일 반영 (2026-06-11) ── */
    const wBadge=card.querySelector('.dp-w-badge');
    if(wBadge){
      wBadge.addEventListener('mousedown',function(e){e.stopPropagation();});
      wBadge.addEventListener('pointerdown',function(e){e.stopPropagation();});
      wBadge.addEventListener('wheel',function(e){
        e.preventDefault();e.stopPropagation();
        const cur=_dpEffW(col);
        const next=_dpClampW(cur+(e.deltaY<0?4:-4));
        if(next==null||next===cur)return;
        _dpSetUserW(col,next);
        _dpRefreshWBadge(col);
        _dpOnWidthChanged(col);
      },{passive:false});
      wBadge.addEventListener('click',function(e){
        e.stopPropagation();
        if(wBadge.querySelector('input'))return;
        const cur=_dpEffW(col);
        wBadge.innerHTML='';
        const inp=document.createElement('input');
        inp.type='number';inp.min=24;inp.max=600;inp.value=cur;
        inp.style.cssText='width:46px;font-size:10px;font-weight:700;border:1px solid rgba(6,182,212,0.4);border-radius:4px;padding:1px 3px;font-family:var(--f);background:var(--card);color:var(--t1);outline:none';
        wBadge.appendChild(inp);
        inp.focus();inp.select();
        let done=false;
        function commit(cancel){
          if(done)return;done=true;
          if(!cancel){
            const v=_dpClampW(inp.value);
            if(v!=null && v!==cur){_dpSetUserW(col,v);_dpOnWidthChanged(col);}
          }
          _dpRefreshWBadge(col);
        }
        inp.addEventListener('keydown',function(ev){ev.stopPropagation();if(ev.key==='Enter'){ev.preventDefault();commit(false);}else if(ev.key==='Escape'){ev.preventDefault();commit(true);}});
        inp.addEventListener('blur',function(){commit(false);});
        inp.addEventListener('mousedown',function(ev){ev.stopPropagation();});
      });
    }
    card.querySelector('.dp-eye-btn').addEventListener('click',function(e){
      e.stopPropagation();
      if(isLockedOff){bus.emit('toast:show',{text:'매일 한 페이지 형식에서는 날짜가 페이지 제목으로 표시됩니다.'});return;}
      dpPushHistory();dpColVis[col]=!active;dpRenderCards();
      /* 미리보기 모드에서는 즉시 다시 그림 */
      const previewPanel=document.getElementById('dpPreviewPanel');
      if(previewPanel&&previewPanel.style.display==='flex'){
        if(_dpFormat==='daily')dpShowDailyPreview();else dpShowPreview();
      }
    });
    card.addEventListener('dragstart',function(e){
      if(e.target.closest('.dp-eye-btn')){e.preventDefault();return;}
      dragCol=col;card.style.opacity='0.45';
      if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',col);}
    });
    card.addEventListener('dragend',function(){dragCol=null;card.style.opacity='1';});
    card.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
    card.addEventListener('dragleave',function(){this.style.borderColor='var(--bdr)';});
    card.addEventListener('drop',function(e){
      e.preventDefault();if(!dragCol||dragCol===col)return;
      dpPushHistory();
      const from=dpColOrder.indexOf(dragCol), to=dpColOrder.indexOf(col);
      if(from===-1||to===-1)return;
      dpColOrder.splice(to,0,dpColOrder.splice(from,1)[0]);
      dpRenderCards();
      /* 미리보기 모드에서는 즉시 다시 그림 */
      const previewPanel=document.getElementById('dpPreviewPanel');
      if(previewPanel&&previewPanel.style.display==='flex'){
        if(_dpFormat==='daily')dpShowDailyPreview();else dpShowPreview();
      }
    });
    container.appendChild(card);
  });
}

/* ── 시간대별 V/S 표 HTML (출력 공용, 2026-06-15) ──
 *  record 에 시간대별 V/S 입력(vsHistory)이 있으면 일반일지표와 같은 형식으로 표를 만든다.
 *  · 입력된 항목(열)만 — 시각은 항상, 나머지는 값이 하나라도 있는 열만.
 *  · 옵션/토글 없음: 데이터가 있으면 무조건 표시 (방문자 행 아래·증상 칸 자리).
 *  · PDF 문서에서도 보이도록 CSS 변수 대신 명시 색상 사용. */
/* ── 출력 HTML 경량화 공용 CSS (2026-08-12, 사용자 보고: 1학기치 PDF 5MB 상한 초과) ──
 * 셀마다 반복되던 인라인 스타일(셀당 ~90자)을 dpx- 접두 클래스로 추출 — 문서 크기 5~8배 축소.
 * 선언 내용은 옛 인라인 스타일과 글자 단위로 동일해야 함(시각 회귀 금지).
 * · 미리보기: area.innerHTML 맨 앞에 <style> 로 삽입 (dpx- 접두라 앱 전역 오염 없음)
 * · PDF/인쇄: _dpBuildPrintDocHtml·printDiaryDirect 가 area.innerHTML 을 복제하므로 자동 승계.
 *   PDF 헤드의 11pt·테두리 !important 덮어쓰기와의 우선순위는 옛 인라인 시절과 동일하게 동작.
 * · Excel/Sheets: textContent + dp-vs-subrow/dp-pa-subrow 클래스 판별만 사용 — 영향 없음. */
const _DPX_CSS=''
  /* 방문자당 한 행(row/student/counsel-diary) 메인 표 */
  +'.dpx-th{padding:5px 6px;text-align:center;color:var(--t3);overflow-wrap:break-word}'
  +'.dpx-tr{border-bottom:1px solid var(--bdrl)}'
  +'.dpx-td{padding:4px 6px;color:var(--t2);overflow-wrap:break-word;white-space:pre-line}'
  +'.dpx-td.dpx-c{text-align:center}'
  +'.dpx-td.dpx-l{text-align:left}'
  +'.dpx-fill{padding:4px 6px}'
  +'.dpx-sub{padding:6px;text-align:left}'
  /* 매일 한 페이지 — 일자 헤더 */
  +'.dpx-dh{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid #0891b2;padding-bottom:8px;margin-bottom:10px}'
  +'.dpx-dh-date{font-size:14pt;font-weight:800;letter-spacing:-0.5px;color:#0f172a}'
  +'.dpx-dh-r{text-align:right}'
  +'.dpx-dh-l1{font-size:10px;color:#64748b}'
  +'.dpx-dh-n{font-size:18px;font-weight:800;color:#0891b2}'
  +'.dpx-dh-n span{font-size:11px;color:#475569;margin-left:3px}'
  +'.dpx-dh-l2{font-size:10px;color:#475569}'
  +'.dpx-nl{font-size:10px;color:#475569;background:#f1f5f9;padding:5px 8px;border-radius:6px;margin-bottom:8px}'
  /* 매일 한 페이지 — 섹션 제목 (오늘의 메모/일간 방문 통계/방문 상세) */
  +'.dpx-sh{font-size:12.5px;font-weight:800;color:#0f172a;letter-spacing:-0.2px;margin:22px 0 7px;display:flex;align-items:center;gap:6px}'
  +'.dpx-sh.dpx-sh-d{margin:26px 0 7px}'
  +'.dpx-sh .dpx-ico{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px}'
  +'.dpx-ico-memo{background:linear-gradient(135deg,#84cc16,#65a30d)}'
  +'.dpx-ico-stat{background:linear-gradient(135deg,#06b6d4,#0891b2)}'
  +'.dpx-ico-detail{background:linear-gradient(135deg,#6366f1,#8b5cf6)}'
  /* 매일 한 페이지 — 일간 방문 통계 표 (옛 cellStyle/headStyle) */
  +'.dpx-st{font-size:11px;font-weight:700;color:#0e7490;margin:8px 0 4px;display:flex;align-items:center;gap:5px}'
  +'.dpx-st span{display:inline-block;width:3px;height:12px;background:linear-gradient(180deg,#06b6d4,#0891b2);border-radius:2px}'
  +'.dpx-box{border:1px solid #cbd5e1;border-radius:6px}'
  +'.dpx-tbl{width:100%;border-collapse:collapse}'
  +'.dpx-sc{border:1px solid #cbd5e1;padding:4px 6px;font-size:11pt;text-align:center;color:#1e293b}'
  +'th.dpx-sc{background:#f1f5f9;font-weight:700;color:#475569}'
  +'.dpx-sc.dpx-b7{font-weight:700}'
  +'.dpx-sc.dpx-b8{font-weight:800}'
  +'.dpx-sc.dpx-cy{color:#0891b2}'
  /* dpx-mut 는 dpx-cy 뒤 — 0값 회색이 계열색을 이기는 옛 인라인 선언 순서 보존 */
  +'.dpx-sc.dpx-mut{color:#cbd5e1}'
  +'.dpx-sc.dpx-tc{color:#0e7490}'
  +'.dpx-sc.dpx-ts{font-size:11px}'
  +'.dpx-tot{background:rgba(6,182,212,0.06);border-top:2px solid #94a3b8}'
  /* 매일 한 페이지 — 방문 상세 표 (옛 tCell/tHead) */
  +'.dpx-dc{border:1px solid #cbd5e1;padding:5px 7px;font-size:11pt;color:#1e293b;white-space:pre-line}'
  +'th.dpx-dc{background:#f1f5f9;font-weight:700;color:#475569;text-align:center}'
  +'.dpx-dc.dpx-c{text-align:center}'
  +'.dpx-dc.dpx-l{text-align:left}'
  +'.dpx-dc.dpx-bold{font-weight:700}'
  +'.dpx-dc.dpx-seq{color:#64748b;font-weight:700}'
  +'.dpx-dc.dpx-nw{white-space:nowrap}'
  /* V/S 측정 값 미니표 */
  +'.dpx-vs-t{font-size:9pt;font-weight:700;color:#0e7490;margin:0 0 2px}'
  +'.dpx-mini{border-collapse:collapse;margin:0}'
  +'.dpx-vs-th{border:1px solid #cbd5e1;padding:2px 10px;background:#ecfeff;color:#0e7490;font-weight:700;font-size:9.5pt;white-space:nowrap;text-align:center}'
  +'.dpx-vs-td{border:1px solid #cbd5e1;padding:2px 10px;text-align:center;white-space:nowrap;font-size:9.5pt;color:#1e293b}'
  /* 신체사정 미니표 */
  +'.dpx-pa-t{font-size:9pt;font-weight:700;color:#b45309;margin:0 0 2px}'
  +'.dpx-pa-th{border:1px solid #cbd5e1;padding:2px 10px;background:#fff7ed;color:#b45309;font-weight:700;font-size:9.5pt;white-space:nowrap;text-align:center}'
  +'.dpx-pa-td{border:1px solid #cbd5e1;padding:2px 10px;font-size:9.5pt;color:#1e293b}'
  +'.dpx-pa-td.dpx-pa-k{text-align:center;white-space:nowrap;font-weight:600}'
  +'.dpx-pa-td.dpx-pa-v{text-align:left;word-break:break-word}'
  /* V/S·신체사정 서브행은 방문자 행과 한 덩어리로 — 사이 구분선 제거, 덩어리 마지막 행에만 선 (사용자 요청 2026-08-27) */
  +'.dpx-tr:has(+ tr.dp-vs-subrow),.dpx-tr:has(+ tr.dp-pa-subrow){border-bottom:none}';

function _dpVsTsTableHtml(r){
  let hist=(r&&Array.isArray(r.vsHistory))?r.vsHistory.slice():[];
  /* 시간대별 기록이 없고 단일 V/S 값만 있으면 1행 표로(인쇄는 항상 표 형식). 2026-07-21 */
  if(!hist.length && r && (r.temp||r.bp||r.pulse||r.resp||r.respiration||r.spo2||r.bst)){
    hist=[{t:(r.timeIn||''),temp:r.temp||'',bp:r.bp||'',pulse:r.pulse||'',resp:(r.respiration||r.resp||''),spo2:r.spo2||'',bst:r.bst||''}];
  }
  if(!hist.length) return '';
  const _hms=function(t){const m=String(t||'').match(/(\d{1,2}):(\d{2})/);return m?(parseInt(m[1],10)*60+parseInt(m[2],10)):999999;};
  hist.sort(function(a,b){return _hms(a.t)-_hms(b.t);});
  const allCols=[['t','시각'],['temp','체온'],['bp','혈압'],['pulse','맥박'],['resp','호흡'],['spo2','SpO₂'],['bst','BST']];
  const cols=allCols.filter(function(c){
    if(c[0]==='t') return true;
    return hist.some(function(rw){ return String(rw[c[0]]==null?'':rw[c[0]]).trim()!==''; });
  });
  if(cols.length<=1) return '';   /* 수치 항목이 하나도 없으면 표시 안 함 */
  /* 인라인 스타일 → dpx- 클래스 (경량화 2026-08-12) — 선언은 _DPX_CSS 에 동일 보존 */
  /* 단일 측정이면 'V/S 측정 값', 시간대 2개 이상이면 '시간대별 V/S 측정 값' (사용자 요청 2026-07-21) */
  let t='<div class="dpx-vs-t">'+(hist.length>=2?'시간대별 V/S 측정 값':'V/S 측정 값')+'</div>';
  t+='<table class="dpx-mini">';
  t+='<tr>'+cols.map(function(c){return '<th class="dpx-vs-th">'+c[1]+'</th>';}).join('')+'</tr>';
  hist.forEach(function(rw){ t+='<tr>'+cols.map(function(c){const v=String(rw[c[0]]==null?'':rw[c[0]]).trim();return '<td class="dpx-vs-td">'+escHtml(v||'-')+'</td>';}).join('')+'</tr>'; });
  t+='</table>';
  return t;
}

/* 신체사정 출력 표 — 시진·촉진·타진·청진 + 소견. V/S 표(_dpVsTsTableHtml) 와 동일 배치. 옛 record(pa 없음) 는 '' 반환. (2026-07-15) */
function _dpPaTableHtml(r){
  const pa=r&&r.physicalAssessment;
  if(!pa||typeof pa!=='object'||Array.isArray(pa))return '';
  const items=Array.isArray(pa.items)?pa.items:[];
  const details=(pa.details&&typeof pa.details==='object'&&!Array.isArray(pa.details))?pa.details:{};
  const order=['시진','촉진','타진','청진'];
  const shown=order.filter(function(it){return items.indexOf(it)!==-1||(details[it]&&String(details[it]).trim());});
  if(!shown.length)return '';
  /* 인라인 스타일 → dpx- 클래스 (경량화 2026-08-12) — 선언은 _DPX_CSS 에 동일 보존 */
  let t='<div class="dpx-pa-t">신체사정</div>';
  t+='<table class="dpx-mini">';
  t+='<tr><th class="dpx-pa-th">항목</th><th class="dpx-pa-th">소견</th></tr>';
  shown.forEach(function(it){
    const d=details[it]?String(details[it]).trim():'';
    t+='<tr><td class="dpx-pa-td dpx-pa-k">'+escHtml(it)+'</td><td class="dpx-pa-td dpx-pa-v">'+escHtml(d||'-')+'</td></tr>';
  });
  t+='</table>';
  return t;
}

/* ── Excel·Sheets 용 V/S·신체사정 텍스트 직렬화 (사용자 요청 2026-08-27) ──
 * PDF/인쇄는 서브행 미니표(dp-vs-subrow/dp-pa-subrow)로 포함되지만 Excel/Sheets 추출은
 * 서브행을 제외해 V/S·신체사정이 통째로 빠졌다 → 셀에 줄바꿈 텍스트로 병합한다. */
function _dpVsTextForExcel(r){
  let hist=(r&&Array.isArray(r.vsHistory))?r.vsHistory.slice():[];
  if(!hist.length && r && (r.temp||r.bp||r.pulse||r.resp||r.respiration||r.spo2||r.bst)){
    hist=[{t:(r.timeIn||''),temp:r.temp||'',bp:r.bp||'',pulse:r.pulse||'',resp:(r.respiration||r.resp||''),spo2:r.spo2||'',bst:r.bst||''}];
  }
  if(!hist.length)return '';
  const _hms=function(t){const m=String(t||'').match(/(\d{1,2}):(\d{2})/);return m?(parseInt(m[1],10)*60+parseInt(m[2],10)):999999;};
  hist.sort(function(a,b){return _hms(a.t)-_hms(b.t);});
  const lab=[['temp','체온'],['bp','혈압'],['pulse','맥박'],['resp','호흡'],['spo2','SpO₂'],['bst','BST']];
  const lines=hist.map(function(rw){
    const vals=lab.map(function(c){const v=String(rw[c[0]]==null?'':rw[c[0]]).trim();return v?(c[1]+' '+v):'';}).filter(Boolean);
    if(!vals.length)return '';
    return '['+String(rw.t||'-')+'] '+vals.join(', ');
  }).filter(Boolean);
  if(!lines.length)return '';
  return (lines.length>=2?'[시간대별 V/S]':'[V/S]')+'\n'+lines.join('\n');
}
function _dpPaTextForExcel(r){
  const pa=r&&r.physicalAssessment;
  if(!pa||typeof pa!=='object'||Array.isArray(pa))return '';
  const items=Array.isArray(pa.items)?pa.items:[];
  const details=(pa.details&&typeof pa.details==='object'&&!Array.isArray(pa.details))?pa.details:{};
  const order=['시진','촉진','타진','청진'];
  const shown=order.filter(function(it){return items.indexOf(it)!==-1||(details[it]&&String(details[it]).trim());});
  if(!shown.length)return '';
  return '[신체사정]\n'+shown.map(function(it){const d=details[it]?String(details[it]).trim():'';return it+': '+(d||'-');}).join('\n');
}
/* 추출된 데이터 행(처치 열)에 V/S·신체사정 텍스트 병합 — Excel/Sheets 공용 (2026-08-27) */
function _dpMergeVsPaIntoRow(row,headerLabels,recIdx){
  /* '처치'/'처치 내용'(상담 형식은 '상담 내용') 정확 매칭 — /처치/ 는 '처치자' 열에 먼저 걸리던 버그 (사용자 보고 2026-08-27) */
  const _trtCol=headerLabels.findIndex(function(l){return /^(처치(\s*내용)?|상담 내용)$/.test(String(l||'').trim());});
  if(_trtCol<0||_trtCol>=row.length)return;
  const _r=(_dpCache&&Array.isArray(_dpCache.filteredRecs))?_dpCache.filteredRecs[recIdx]:null;
  if(!_r)return;
  const _ex=[_dpVsTextForExcel(_r),_dpPaTextForExcel(_r)].filter(Boolean).join('\n');
  if(_ex)row[_trtCol]=(row[_trtCol]?row[_trtCol]+'\n':'')+_ex;
}

/* '매일 한 페이지' 출력용: 하루치 payload 한 개를 xlsxBuildDiary 포맷으로 생성
   dayStats = buildDeptStatsSections(dt,dt) 결과 → 일간 방문 통계 3섹션을 본문 앞에 삽입 */
function _dpBuildDailyDayPayload(dt, dayRecs, schoolName, dayStats){
  const _lvShort={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  const _activeCols=dpColOrder.filter(function(c){return c!=='date'&&dpColVis[c]!==false;});
  const headerLabels=_activeCols.map(function(c){const info=DP_COLS.find(function(dc){return dc.col===c;});return DP_PRINT_LABELS[c]||(info?info.label:c);});
  function _colW(col,lab){
    /* 사용자 조절값 우선 (2026-06-11) — Excel/Sheets 열폭에도 칩 조절이 그대로 반영 */
    const _u=_dpClampW(dpColWidthsUser[col]);
    if(_u!=null)return _u;
    if(/^순$/.test(lab))return 44;
    if(/^침상 ?이용$/.test(lab))return 64;
    if(/^바디맵$/.test(lab))return 90;
    if(/^(학교급|학과|성별|번호|학년반)$/.test(lab))return 60;
    if(/^(이름|날짜|시간|처치자)$/.test(lab))return 80;
    if(/^증상$/.test(lab))return 220;
    if(/^처치 ?내용$/.test(lab))return 240;
    if(/^투약 ?내용$/.test(lab))return 150;
    if(/^V\/S$/.test(lab))return 150;
    return 110;
  }
  const colWidths=_activeCols.map(function(c,i){return _colW(c,headerLabels[i]);});
  const colCount=_activeCols.length;
  const dataRows=dayRecs.map(function(r,ri){
    const s=getStu(r.personUid)||{name:r.personName||'',grade:r.studentGrade||0,cls:r.studentClass||0,num:r.studentNum||0,type:r.personType||'student',gender:r.studentGender||'',position:r.staffPosition||'',level:r.studentLevel||'',department:r.studentDepartment||''};
    const isStaff=s.type==='staff';
    const gradeCol=_dpGradeCol(s);
    const numCol=isStaff?'':(s.num||'');
    let _g=(s&&s.gender)||'';if(_g==='M')_g='남';else if(_g==='F')_g='여';
    const cd={
      seq:ri+1,
      schoolLevel:isStaff?'-':(_lvShort[s.level]||s.level||'-'),
      department:isStaff?'-':(s.department||'-'),
      gradeClass:gradeCol,
      num:numCol,
      name:s.name||'-',
      time:r.timeIn+(r.timeOut?' ~ '+r.timeOut:''),
      gender:_g||'',
      nurse:r.nurse||'-',
      bodymap:(function(){
        var _bm=(window._bmData||{})[r.id]||[];
        var _ls=[];_bm.forEach(function(mm){if(mm&&mm.label&&_ls.indexOf(mm.label)===-1)_ls.push(mm.label);});
        return _ls.join(', ')||'';
      })(),
      symptoms:(function(){
        /* 부위(바디맵 마커) 동적 부착 — DB 라벨에 부위가 누락되어 있어도 출력 시 항상 표시 (사용자 보고 2026-05-19) */
        var _arr=(r.symptoms||[]);
        var _bm=(typeof window!=='undefined' && window._bmData) ? (window._bmData[r.id]||[]) : [];
        var _composed=_arr.map(function(_s){
          var _m=String(_s).match(/^(.+?)\s*\((.*)\)\s*$/);
          var _base=_m?_m[1].trim():String(_s);
          var _ins=_m?_m[2]:'';
          var _parts=_bm.filter(function(mm){return mm && mm.symptom===_base;}).map(function(mm){return mm.label;}).filter(Boolean);
          var _missing=_parts.filter(function(p){return _ins.indexOf(p)===-1;});
          if(_missing.length===0)return _s;
          var _newIns=[_missing.join(', '), _ins].filter(Boolean).join(', ');
          return _base+'('+_newIns+')';
        });
        /* 다중 증상 + treatmentBySym 있음 → 줄바꿈으로 행 분리 (v3+ 사용자 결정 2026-05-20).
         * xlsx 셀은 wrapText 적용 시 \n 으로 줄바꿈 인식. */
        var _hasBySym = r.treatmentBySym && typeof r.treatmentBySym==='object' && !Array.isArray(r.treatmentBySym) && Object.keys(r.treatmentBySym).length>0;
        var _isMulti = _arr.length>1 && _hasBySym && r.treatmentBranched !== false; /* 미분기면 콤마 한 줄(2026-06-09) */
        return _composed.join(_isMulti?'\n':', ');
      })(),
      /* 처치 칩(treatment) + 약품(medication) + 자유 서술형 메모(treatmentMemo) 를 함께 표시 — daily-view 와 동일 규칙.
         · '투약' 칩이 있으면 약품명과 결합 (예: "투약[타이레놀 (1정)]")
         · '투약' 칩 없이 medication 만 있는 옛 기록도 약품 별도 표시 (4월 칩 통합 이전 데이터 호환)
         · 다중 증상 + treatmentBySym → 증상별 줄바꿈 분층 (v3+ 사용자 결정 2026-05-20) */
      treatment:(function(){
        var arr=(r.treatment||[]);
        var medDisp=r.medication?formatMedicationDisplay(r.medication):'';
        var m=r.treatmentMemo||'';
        var _hasBySym = r.treatmentBySym && typeof r.treatmentBySym==='object' && !Array.isArray(r.treatmentBySym) && Object.keys(r.treatmentBySym).length>0;
        /* 증상 2개 이상이면 분기 출력 — 옛 일지/외부 import(평면만) 는 단일 행 유지 (사용자 결정 2026-05-28). */
        var _isLegacyFlat = !_hasBySym && arr.length>0;
        var _isMulti = r.symptoms && r.symptoms.length>1 && !_isLegacyFlat && r.treatmentBranched !== false; /* 미분기면 콤마 한 줄(2026-06-09) */
        if(_isMulti){
          /* v3 (2026-05-28) — V/S·침상도 per-symptom. 각 증상 행에 그 증상 처치만 (record-level 공유 폐지).
           * sym 별 약품은 r.medsBySym[sym] 사용. */
          var _medDispForSym = function(sym){
            if(!r.medsBySym || !r.medsBySym[sym] || !r.medsBySym[sym].length) return '';
            var dm = (r.medDosesBySym && r.medDosesBySym[sym]) || {};
            var str = r.medsBySym[sym].map(function(mm){var d=dm[mm]||''; return d?(mm+'('+d+')'):mm;}).join(', ');
            return formatMedicationDisplay(str);
          };
          /* 상담 처치란 문구 — 맵에 없고 flat 에만 있으므로 상담 층에 직접 합류 (사용자 보고 2026-08-25) */
          var _clT2=counselTreatText(r);
          var _clIdx2=_clT2?r.symptoms.findIndex(isCounselSymLabel):-1;
          var lines = r.symptoms.map(function(sym, idx){
            var symTreats = (r.treatmentBySym[sym]||[]);
            var medDispForSym = _medDispForSym(sym);
            var symLabeled = symTreats.map(function(t){
              var b=t; var mt=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(mt)b=mt[1].trim();
              if(b==='투약' && medDispForSym) return medDispForSym;
              return t;
            });
            if(idx===_clIdx2)symLabeled.push(_clT2);
            return '→ '+symLabeled.join(', ');
          });
          if(m) lines[0] = (lines[0]?lines[0]+' / ':'')+m;
          return lines.join('\n');
        }
        var labeled=arr.map(function(t){return (t==='투약'&&medDisp)?medDisp:t;});
        var b=labeled.join(', ');
        var hasMedTreat=arr.indexOf('투약')!==-1;
        if(!hasMedTreat&&medDisp) b=(b?b+' / ':'')+medDisp;
        return (b+(m?(b?' / ':'')+m:'')).trim();
      })(),
      medication:r.medication||'',
      bedUsage:_dpIsBedUsed(r)?'O':'',
      vitals:(function(){
        /* 시간대별 V/S 가 있으면 전 시각을 줄바꿈으로 (사용자 요청 2026-08-27). 단일 측정은 기존 한 줄 유지. */
        if(Array.isArray(r.vsHistory)&&r.vsHistory.length>=2){
          const t=_dpVsTextForExcel(r);
          if(t)return t.replace(/^\[[^\]]*\]\n/,'');
        }
        return [r.temp?'T: '+r.temp:'',r.bp?'BP: '+r.bp:'',r.pulse?'P: '+r.pulse:'',(r.respiration||r.resp)?'R: '+(r.respiration||r.resp):'',r.spo2?'SpO₂: '+r.spo2:'',r.bst?'BST: '+r.bst:''].filter(Boolean).join(', ');
      })()
    };
    /* 신체사정은 처치 열에 병합 (사용자 요청 2026-08-27) */
    (function(){
      const _paX=_dpPaTextForExcel(r);
      if(_paX)cd.treatment=(cd.treatment&&cd.treatment!=='-'?cd.treatment+'\n':'')+_paX;
    })();
    return _activeCols.map(function(c){const v=cd[c];return v==null||v===''?'':String(v);});
  });
  const d=new Date(dt);
  const dow=['일','월','화','수','목','금','토'][d.getDay()];
  const titleText=d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 ('+dow+') 보건일지';
  const periodText='날짜: '+dt+' ('+dow+')';
  const total=colWidths.reduce(function(a,b){return a+b;},0);
  const th30=total*0.3;
  let acc=0,top2=0;
  for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=th30)break;}
  acc=0;let bot1=0;
  for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=th30)break;}
  /* 일간 방문 통계 3섹션 (학생 학년별 / 교직원 / 전체) → preambleSections 로 전달 */
  const preambleSections=(dayStats&&dayStats.sections&&dayStats.sections.length)?{
    sections:dayStats.sections,
    colCount:dayStats.colCount
  }:null;
  return {
    colCount:colCount,
    colWidths:colWidths,
    headerLabels:headerLabels,
    dataRows:dataRows,
    titleText:titleText,
    schoolText:'학교: '+schoolName,
    periodText:periodText,
    top1:Math.max(1,colCount-top2),
    bot1:bot1,
    preambleSections:preambleSections
  };
}

/* ── 엑셀 저장 시 인쇄/PDF 안내 팝업 (사용자 요청 2026-06-16) ──
 *  먼저 이 안내가 뜨고, "예 & 클립보드에 위 내용 복사"(복사+닫힘) 또는 외부 클릭(복사 없이 닫힘) 으로
 *  닫아야 그 다음에 저장 경로 선택 다이얼로그가 진행된다(Promise resolve 후 export 진행). */
function _dpShowExcelGuide(){
  return new Promise(function(resolve){
    const _txt="인쇄 할 때 용지는 'A4', 방향은 '가로', 여백은 '기본' 또는 '좁게', '한 페이지에 모든 열 맞추기'로 설정하여야 합니다.";
    const old=document.getElementById('dpExcelGuideOverlay'); if(old)old.remove();
    const ov=document.createElement('div');
    ov.id='dpExcelGuideOverlay';
    ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.32);z-index:13000;opacity:0;transition:opacity 0.15s ease';
    ov.innerHTML='<div id="dpExcelGuideBox" style="background:var(--card);border-radius:14px;width:470px;max-width:92vw;box-shadow:0 16px 44px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.18s ease,transform 0.18s ease">'
      +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));font-size:14px;font-weight:800;color:var(--t1)">📄 인쇄 또는 PDF로 저장 시 안내</div>'
      +'<div style="padding:18px 22px;font-size:13px;color:var(--t1);line-height:1.75">'+escHtmlDp(_txt)+'</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--bdr)">'
      +'<button id="dpExcelGuideYes" type="button" style="padding:9px 16px;font-size:12.5px;font-weight:700;border-radius:8px;border:none;background:var(--cyan);color:#fff;cursor:pointer;font-family:var(--f)">예 &amp; 클립보드에 위 내용 복사</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('dpExcelGuideBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
    let _settled=false;
    function _close(){ if(_settled)return;_settled=true; ov.style.opacity='0'; const b=document.getElementById('dpExcelGuideBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.96)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); resolve(); },180); }
    document.getElementById('dpExcelGuideYes').addEventListener('click',function(e){
      e.stopPropagation();
      try{ navigator.clipboard.writeText(_txt); bus.emit('toast:show',{text:'안내 문구가 클립보드에 복사되었습니다.'}); }catch(_){}
      _close();
    });
    ov.addEventListener('mousedown',function(e){ if(e.target===ov) _close(); });   /* 외부 클릭 = 복사 없이 닫기 */
  });
}

/* 상담 내역 개별 양식 — 상담 기록지(PDF 폼과 동일 레이아웃)를 기록당 워크시트 1장으로 Excel 출력 (사용자 요청 2026-06-25) */
async function _dpExportCounselExcel(){
  if(!(window.electronAPI&&window.electronAPI.xlsxBuildCounsel)){bus.emit('toast:show',{text:'Excel 저장 기능을 사용할 수 없습니다.'});return;}
  if(!_dpCache||!_dpCache.records){alert('먼저 미리보기를 실행하세요.');return;}
  const recs=_dpCounselRecsSorted();
  if(!recs.length){alert('선택한 기간에 작성된 상담 기록이 없습니다.');return;}
  const from=document.getElementById('dpFrom').value, to=document.getElementById('dpTo').value;
  const records=recs.map(function(r){ return _symCounselSheetData(r); });
  const fileName=_dpSaveBaseName(from,to)+'_상담기록지.xlsx';
  /* Excel 도 PDF 와 동일한 진행 오버레이 + 완주 후 저장 창 (사용자 요청 2026-08-12) */
  _dpShowExportProgress(recs.length,'Excel');
  window.electronAPI.xlsxBuildCounsel({records:records}).then(function(res){
    _dpDeliverXlsx(res,fileName);
  }).catch(function(e){_dpHideExportProgress();_dpExportFailModal('Excel 저장',(e&&e.message)||String(e));});
}
async function exportDiaryExcel(){
  if(!window.electronAPI||!window.electronAPI.xlsxBuildDiary){bus.emit('toast:show',{text:'Excel 빌드 IPC 미구성'});return;}
  await _dpShowExcelGuide();   /* 안내 팝업을 닫은 뒤에야 저장 진행 (사용자 요청 2026-06-16) — 모든 형식 공통 */
  /* 매일 한 페이지 형식: 날짜마다 별도 워크시트 */
  if(_dpFormat==='daily'){
    return _exportDailyExcel();
  }
  /* 상담 내역 개별 양식: 상담 기록 요약표 워크시트 (상담기록지 자체는 PDF/인쇄로) (사용자 요청 2026-06-25) */
  if(_dpIsCounselIndividual()){
    return _dpExportCounselExcel();
  }
  const built=_dpBuildExportTable();
  if(!built){alert('먼저 미리보기를 실행하세요.');return;}
  /* 진행 오버레이는 DOM 추출·표지 빌드 전에 미리 — 대용량에서 무피드백 공백 방지 (2026-08-12) */
  _dpShowExportProgress(_dpExportRecCount(),'Excel');
  const colWidths=built.colWidths||[];
  const colCount=built.colCount;
  const headerLabels=built.headerLabels||[];
  /* 미리보기에서 데이터 행 추출 — 메인 데이터표만 명시 선택(중첩 V/S 미니표에 안 휘말리게),
   *  V/S 시간대 표 행(.dp-vs-subrow)·중첩 td 제외 (2026-06-16 버그수정). */
  const area=document.getElementById('dpPreviewArea');
  const _allTables=area.querySelectorAll('table');
  const dataTable=area.querySelector('table[data-dp-main]')||_allTables[_allTables.length-1];
  const dataRows=[];
  dataTable.querySelectorAll(':scope > tbody > tr').forEach(function(tr){
    if(tr.classList&&(tr.classList.contains('dp-vs-subrow')||tr.classList.contains('dp-pa-subrow')))return;   /* V/S·신체사정 표 행 제외 */
    const cells=tr.querySelectorAll(':scope > td');
    const row=[];
    cells.forEach(function(c){row.push((c.textContent||'').trim());});
    while(row.length<colCount)row.push('');
    if(row.length>colCount)row.length=colCount;
    /* V/S·신체사정을 처치 셀 텍스트로 병합 — 서브행 미니표는 Excel 셀에 못 넣으므로 (사용자 요청 2026-08-27) */
    _dpMergeVsPaIntoRow(row,headerLabels,dataRows.length);
    dataRows.push(row);
  });
  const titleText=built.titleText;
  const schoolName=built.schoolName;
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  const sp=_dpColorSplit(colCount,colWidths);
  const fileName=_dpSaveBaseName(from,to)+'.xlsx';   /* 사용자 규칙 파일명 (2026-06-10) */
  /* (옵션) 진료과별 통계 표지 — 별도 워크시트로 포함.
   * 상담 내역 형식 제외 — 미리보기(dpShowPreview)와 동일 방어 (복원 2026-08-12) */
  const _coverOpt=document.getElementById('dpOptCover');
  let coverPayload={};
  if(_coverOpt&&_coverOpt.checked&&_dpFormat!=='counsel'){
    try{
      if(_dpFormat==='student'&&_dpSelectedStudentId){
        /* 특정 방문자 — 전교 통계 대신 그 사람 전용 진료과별 집계.
         * PDF 표지(_dpBuildStudentCoverHtml)와 동일 데이터·동일 필터(studentId/personUid/person_uid)
         * (사용자 요청 2026-08-12 "excel도 맞춰야 한다"). 집계 불가(캐시 없음/기록 0건)면 표지 생략 —
         * 전교 통계로 오인시키지 않는다. */
        const _sid=String(_dpSelectedStudentId);
        const _recs=((_dpCache&&_dpCache.records)||[]).filter(function(r){
          const _rid=r.studentId||r.personUid||r.person_uid||'';
          return String(_rid)===_sid;
        });
        const counts={};
        _recs.forEach(function(r){ const d=String(r.dept||'').trim()||'미상'; counts[d]=(counts[d]||0)+1; });
        const keys=Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
        if(keys.length){
          const stu=(typeof getStu==='function')?getStu(_dpSelectedStudentId):null;
          const who=(stu&&stu.name)?stu.name:String(_dpSelectedStudentId||'');
          const cvColCount=keys.length+2;   /* 진료과 라벨 + dept들 + 계 */
          const coverColWidths=[100];
          for(let i=0;i<cvColCount-1;i++)coverColWidths.push(90);
          coverPayload={
            coverSections:[{
              title:'진료과별 방문 건수',
              header:['진료과'].concat(keys).concat(['계']),
              rows:[['건수'].concat(keys.map(function(k){return counts[k];})).concat([_recs.length])]
            }],
            coverColCount:cvColCount,
            coverColWidths:coverColWidths,
            coverTitle:who+' — 진료과별 방문 통계'
          };
        }
      } else {
        const sd=await buildDeptStatsSections(from,to);
        if(sd&&sd.sections&&sd.sections.length){
          const cvColCount=sd.colCount;
          /* cover 열 너비: 첫 컬럼(학년/구분)=100, 나머지 dept + 계=90 */
          const coverColWidths=[100];
          for(let i=0;i<cvColCount-1;i++)coverColWidths.push(90);
          coverPayload={
            coverSections:sd.sections,
            coverColCount:cvColCount,
            coverColWidths:coverColWidths,
            coverTitle:'진료과별 선택기간 통계'
          };
        }
      }
    }catch(e){console.warn('[diary-print] coverSections build failed:',e);}
  }
  /* (오버레이는 위에서 이미 표시 — 여기서 다시 열면 카운터가 리셋됨) */
  window.electronAPI.xlsxBuildDiary(Object.assign({
    colCount:colCount,
    colWidths:colWidths,
    headerLabels:headerLabels,
    dataRows:dataRows,
    titleText:titleText,
    mainSheetTitle:(_dpFormat==='counsel'?'상담 내역':'보건일지'),   /* 시트 탭 이름 (사용자 요청 2026-06-25) */
    schoolText:schoolName,
    periodText:'기간: '+fmtD(from)+' ~ '+fmtD(to),
    top1:sp.top1,
    bot1:sp.bot1
  },coverPayload)).then(function(res){
    _dpDeliverXlsx(res,fileName);
  }).catch(function(e){_dpHideExportProgress();_dpExportFailModal('Excel 저장',(e&&e.message)||String(e));});
}

/* Excel bytes 전달 공통 — Electron: 위치 선택 다이얼로그 → 실제 저장 후 "저장되었습니다" (사용자 요청 2026-06-11:
 * 다이얼로그가 닫힌 뒤에 떠야 함). 취소하면 무음. 웹 변형: 기존 blob 다운로드 폴백.
 * 2026-08-12: bytes 완성 = 생성 완료 신호 → 진행 카운터를 총건수까지 완주시킨 뒤에야 저장 창을 연다.
 * 실패 안내는 토스트 대신 모달 (토스트는 기존 토스트와 충돌 시 무음 삼켜짐). */
function _dpDeliverXlsx(res, fileName){
  if(!res||!res.success){_dpHideExportProgress();_dpExportFailModal('Excel 저장',(res&&res.error)||'');return;}
  _dpFinishExportProgress().then(function(){
    _dpHideExportProgress();
    if(window.electronAPI&&window.electronAPI.saveBytesDialog){
      window.electronAPI.saveBytesDialog(fileName, res.bytes, [{name:'Excel 통합 문서', extensions:['xlsx']}]).then(function(sv){
        if(sv&&sv.success&&!sv.canceled)bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
        else if(!(sv&&sv.success)&&!(sv&&sv.canceled))_dpExportFailModal('Excel 저장',(sv&&sv.error)||'');
        /* 취소(canceled)는 무음 */
      }).catch(function(e){_dpExportFailModal('Excel 저장',(e&&e.message)||String(e));});
      return;
    }
    const buf=new Uint8Array(res.bytes);
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=fileName;a.click();
    URL.revokeObjectURL(url);
    bus.emit('toast:show',{text:'Excel 파일 다운로드를 시작했습니다.'});
  });
}

/* 매일 한 페이지 형식 공통 — 기간 내 모든 날짜의 스탯+방문표를 연속 배치용 payload 생성 */
async function _buildDailyContinuousData(from,to){
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  let filtered=[];
  try{
    const res=await window.electronAPI.recordsDailyByDateRange(from,to);
    if(res&&res.success)filtered=res.data||[];
  }catch(e){filtered=S.records.filter(function(r){return r.date>=from&&r.date<=to;}).sort(function(a,b){return a.date.localeCompare(b.date)||a.timeIn.localeCompare(b.timeIn);});}
  const byDate={};
  filtered.forEach(function(r){if(!byDate[r.date])byDate[r.date]=[];byDate[r.date].push(r);});
  const dates=Object.keys(byDate).sort();
  const dayStatsMap={};
  await Promise.all(dates.map(async function(dt){
    try{dayStatsMap[dt]=await buildDeptStatsSections(dt,dt);}catch(e){dayStatsMap[dt]=null;}
  }));
  /* 오늘의 메모 — Excel 에도 포함 (사용자 요청 2026-06-11). 출력 옵션(dpOptTodayMemo)+토글 ON 일 때만 */
  try{ await tmEnsureLoaded(); }catch(_){}
  const _tmOptEx=document.getElementById('dpOptTodayMemo');
  const _tmInclude=(!_tmOptEx||_tmOptEx.checked);
  const days=dates.map(function(dt){
    const p=_dpBuildDailyDayPayload(dt,byDate[dt],schoolName,dayStatsMap[dt]);
    let _memo=null;
    if(_tmInclude){ try{ _memo=tmGetMemoForExport(dt); }catch(_){ _memo=null; } }
    return Object.assign({date:dt, todayMemo:_memo},p);
  });
  return { schoolName:schoolName, from:from, to:to, days:days };
}

/* 매일 한 페이지 Excel — 단일 워크시트에 위 색상바·제목·색상바만 고정,
   이후 날짜별 방문 통계 + 방문 상세가 연속으로 쌓이며 각 날짜 전에 자동 페이지 나눔 */
async function _exportDailyExcel(){
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  if(!from||!to){alert('먼저 미리보기를 실행하세요.');return;}
  /* Excel 도 PDF 와 동일한 진행 오버레이 — 날짜별 통계 집계·빌드 전 구간을 모두 덮는다 (사용자 요청 2026-08-12) */
  _dpShowExportProgress(_dpExportRecCount(),'Excel');
  const data=await _buildDailyContinuousData(from,to);
  if(!data.days.length){_dpHideExportProgress();bus.emit('toast:show',{text:'해당 기간에 기록이 없습니다.'});return;}
  /* (옵션) 진료과별 통계 표지 — 같은 기간 전체를 별도 워크시트로 */
  const _coverOpt=document.getElementById('dpOptCover');
  let coverPayload={};
  if(_coverOpt&&_coverOpt.checked){
    try{
      const sd=await buildDeptStatsSections(from,to);
      if(sd&&sd.sections&&sd.sections.length){
        const cvColCount=sd.colCount;
        const coverColWidths=[100];for(let i=0;i<cvColCount-1;i++)coverColWidths.push(90);
        coverPayload={coverSections:sd.sections,coverColCount:cvColCount,coverColWidths:coverColWidths,coverTitle:'진료과별 선택기간 통계'};
      }
    }catch(e){}
  }
  /* 전체 제목·기간 — 맨 위 헤더 블록용 */
  function fmtD(ds){const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  const periodText=(from===to)?fmtD(from):('기간: '+fmtD(from)+' ~ '+fmtD(to));   /* 하루만 선택 시 "기간: " 없이 날짜만 (사용자 요청 2026-06-16) */
  /* 첫 날의 colWidths/colCount 를 워크시트 기본 열 폭으로 사용 */
  const first=data.days[0];
  const payload=Object.assign({},{
    colCount:first.colCount,
    colWidths:first.colWidths,
    titleText:'일일 보건일지',
    schoolText:data.schoolName,
    periodText:periodText,
    top1:first.top1,
    bot1:first.bot1,
    mainSheetTitle:'보건일지',
    continuousDays:data.days
  },coverPayload);
  const fileName=_dpSaveBaseName(from,to)+'.xlsx';   /* 사용자 규칙 파일명 (2026-06-10) */
  window.electronAPI.xlsxBuildDiary(payload).then(function(res){
    _dpDeliverXlsx(res,fileName);
  }).catch(function(e){_dpHideExportProgress();_dpExportFailModal('Excel 저장',(e&&e.message)||String(e));});
}

/* PDF 저장 — 미리보기 영역 HTML 을 Chromium printToPDF 로 인쇄. 같은 엔진이 렌더해
   셀 간격·폰트·페이지 나눔이 미리보기와 100% 일치 */
/* 미리보기(#dpPreviewArea) → 인쇄/PDF 공용 A4 가로 문서 HTML 생성 (2026-06-15 추출).
 *  @page A4 가로·12mm 여백 + 제목 색상바 + 표 테두리 + 11pt 통일 + fit-to-width zoom.
 *  PDF 저장(printToPDF)·인쇄(openA4PrintDialog) 가 동일 HTML 사용 → "미리보기=PDF=인쇄" 일치. */
function _dpBuildPrintDocHtml(){
  const area=document.getElementById('dpPreviewArea');
  if(!area||!area.innerHTML.trim())return null;
  /* 상담 내역 개별 양식 — 세로 A4 상담기록지(표준 시트). 가로 표·표지 로직 건너뜀. (사용자 요청 2026-06-25) */
  if(_dpIsCounselIndividual()){
    const recs=_dpCounselRecsSorted();
    if(!recs.length)return null;
    const parts=_dpCounselSheetsParts(recs);
    /* 상담 통계 표지 — 미리보기 area 의 표지(#dpCounselCoverWrap)를 그대로 첫 페이지로 (토글 ON 시에만 존재).
     *  "미리보기=PDF=인쇄" 일치 (사용자 요청 2026-06-25). */
    const _cw=area.querySelector('#dpCounselCoverWrap');
    const _coverHtml=_cw?_cw.innerHTML:'';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>상담 기록지</title><style>*{box-sizing:border-box}'
      + parts.globalCss
      + '</style></head><body>'+_coverHtml+parts.bodyHtml+'</body></html>';
  }
  /* 모든 형식 A4 가로 (사용자 결정 2026-06-11 — 세로는 fit 축소로 글자가 깨알이 됨, 가로+11pt 로 통일) */
  const landscape=true;
  /* 제목 위·아래 색상바 블록 (Excel/Sheets 표지와 동일 팔레트)
     상단 파랑 70% + 노랑 30% / 하단 초록 30% + 빨강 70% */
  const _pdfHeadingText=(_dpFormat==='student'||_dpFormat==='counsel')?_dpRowTitleText():'보건일지';
  const _pdfHeadingStyle=(_dpFormat==='student'||_dpFormat==='counsel')?' style="letter-spacing:2pt;font-size:18pt"':'';
  /* 표지(1페이지) — 제목+색상바 아래에 기관명 + 기간 (사용자 요청 2026-06-25: 학교명 아래 기간 명시).
   *  표지는 단독 페이지로 두고 본문은 다음 페이지부터 (사용자 요청 2026-06-16). */
  const _orgName=(S.settings&&S.settings.schoolName)||'';
  const _pdfPeriod=(function(){
    var f=document.getElementById('dpFrom'), t=document.getElementById('dpTo');
    var fv=f?f.value:'', tv=t?t.value:'';
    function fk(ds){ if(!ds)return ''; var d=new Date(ds); var dow=['일','월','화','수','목','금','토'][d.getDay()]; return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')'; }
    if(!fv||!tv)return '';
    return (fv===tv)?fk(fv):('기간: '+fk(fv)+' ~ '+fk(tv));
  })();
  const titleBlock=''
    +'<div class="dp-pdf-cover">'
    +'<div class="dp-pdf-title">'
    +'<div class="dp-pdf-bar top"><span class="b1"></span><span class="b2"></span></div>'
    +'<div class="dp-pdf-heading"'+_pdfHeadingStyle+'>'+escHtml(_pdfHeadingText)+'</div>'
    +'<div class="dp-pdf-bar bot"><span class="b3"></span><span class="b4"></span></div>'
    +'</div>'
    +(_orgName?'<div class="dp-pdf-org">'+escHtml(_orgName)+'</div>':'')
    +(_pdfPeriod?'<div style="text-align:center;font-size:12pt;color:#475569;margin-top:10pt">'+escHtml(_pdfPeriod)+'</div>':'')
    +'</div>';
  /* 미리보기 innerHTML 에서 중복 제목(보건실 방문자 현황 등) 제거 — 복제 후 조작 */
  const tmp=document.createElement('div');
  tmp.innerHTML=area.innerHTML;
  tmp.querySelectorAll('div').forEach(function(d){
    const t=(d.textContent||'').trim();
    /* 방문자당 한 행 포맷의 기존 최상단 "보건실 방문자 현황" h1 제거 */
    if(t===_dpRowTitleText()&&d.children.length===0)d.remove();
  });
  /* fit-to-width (2026-06-11, CDP 실측 후속) — 절대 px 합이 종이 인쇄폭보다 넓으면 PDF 에서
   * 오른쪽이 잘리며 '보이는 대로'가 깨짐. 본문 표 colgroup 합으로 최대 폭을 구해
   * 페이지 가용폭(A4 @96dpi - @page 12mm 여백)에 맞게 전체를 비율 축소(zoom) — 열 비율은 설정 그대로 유지. */
  let _maxTW=0;
  tmp.querySelectorAll('table[data-dp-main],table.dp-daily-detail').forEach(function(t){
    let s=0; t.querySelectorAll('colgroup col').forEach(function(c){ s+=parseInt(c.style.width)||0; });
    if(s>_maxTW)_maxTW=s;
  });
  const _mPx=Math.round(12*96/25.4);                       /* @page margin 12mm → px */
  const _usableW=(landscape?1123:794)-2*_mPx;              /* A4 @96dpi: 794×1123 */
  const _fit=(_maxTW>0&&_maxTW>_usableW)?(_usableW/_maxTW):1;
  /* ★ fit 축소는 본문 전체 래퍼가 아니라 '넓은 표 자체'의 인라인 zoom 으로 건다 (2026-08-26).
   *  옛 방식(<div style="zoom">본문 전체</div>)은 인쇄 다이얼로그의 페이지 분할기(_paginateWithHeaders)가
   *  본문 전체를 "분할 불가능한 단일 블록"으로 취급하게 만들어, 한 페이지(overflow:hidden)에 우겨넣고
   *  하단을 잘라버렸다 — "미리보기 11건, 실제 인쇄 5건+하단 잘림" 사고의 원인.
   *  표의 style 에 직접 zoom 을 넣으면 분할기가 표를 tr 단위로 자를 때 styleAttr 로 zoom 이
   *  각 페이지 조각 표에 그대로 승계되고, 행 높이 측정(getBoundingClientRect)도 zoom 반영값이라 정확하다.
   *  PDF(printToPDF)는 Chromium 이 직접 렌더하므로 어느 방식이든 결과 동일. */
  if(_fit<1){
    tmp.querySelectorAll('table[data-dp-main],table.dp-daily-detail').forEach(function(t){
      t.style.zoom=_fit.toFixed(4);
    });
  }
  /* 방문자당 한 행(기본) 출력은 본문 상단에 이미 제목·학교명·기간이 있어 표지가 중복된다 → 표지 생략, 본문이 곧 첫 페이지.
     학생 개인(student)·상담 내역(counsel) 형식만 표지 페이지 유지. (사용자 요청 2026-08-06) */
  const _useCover=(_dpFormat==='student'||_dpFormat==='counsel');
  const bodyHtml=(_useCover?titleBlock:'')+tmp.innerHTML;
  const html='<!DOCTYPE html><html><head><meta charset="utf-8"><title>보건일지</title><style>'
    /* 앱 전역과 동일한 border-box — 미리보기와 PDF 의 열 폭 픽셀 일치의 전제.
     * 이게 없으면 padding·border 가 col 폭에 더해져 작은 열은 커지고 넓은 열은 줄어듦 (CDP 실측으로 확인, 2026-06-11) */
    +'*{box-sizing:border-box}'
    +'@page{size:A4 '+(landscape?'landscape':'portrait')+';margin:12mm}'
    +'html,body{margin:0;padding:0}'
    +'body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","맑은 고딕","Apple SD Gothic Neo",sans-serif;color:#0f172a;font-size:11pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    /* 제목 블록 / 표지(1페이지 단독) */
    +'.dp-pdf-cover{page-break-after:always;break-after:page;padding-top:54mm}'
    +'.dp-pdf-org{text-align:center;font-size:19pt;font-weight:700;color:#0f172a;margin-top:40pt;letter-spacing:1pt}'
    +'.dp-pdf-title{margin-bottom:14pt}'
    +'.dp-pdf-bar{display:flex;height:6pt;overflow:hidden}'
    +'.dp-pdf-bar.top .b1{flex:7;background:#2855A0}.dp-pdf-bar.top .b2{flex:3;background:#D4A843}'
    +'.dp-pdf-bar.bot .b3{flex:3;background:#2E8B57}.dp-pdf-bar.bot .b4{flex:7;background:#C0392B}'
    +'.dp-pdf-heading{background:#F7F7F7;text-align:center;padding:10pt 0;font-size:20pt;font-weight:bold;letter-spacing:8pt}'
    +'.dp-pdf-meta{text-align:center;font-size:10.5pt;color:#475569;margin-top:6pt}'
    /* 모든 표는 테두리 고정 — 미리보기 스타일과 무관하게 PDF 에서는 항상 선이 보이도록 */
    +'table{border-collapse:collapse !important;width:100%}'
    /* 방문 상세 본문 표 — 칩의 px 수치가 절대 폭으로 그대로 저장되도록 100% 강제 제외 (2026-06-11) */
    +'table[data-dp-main],table.dp-daily-detail{width:auto !important;table-layout:fixed !important}'
    /* 글자 11pt 전면 통일 (사용자 결정 2026-06-11) — 인라인 px 지정(10px 등)을 덮도록 !important */
    +'table,th,td{font-size:11pt !important}'
    +'table,thead,tbody,tr,th,td{border:1px solid #475569 !important}'
    /* V/S·신체사정 서브행은 방문자 행과 한 덩어리 — 사이 가로선 제거 (세로 열선은 유지, 사용자 요청 2026-08-27) */
    +'tr:has(+ tr.dp-vs-subrow),tr:has(+ tr.dp-pa-subrow){border-bottom:none !important}'
    +'tr:has(+ tr.dp-vs-subrow)>td,tr:has(+ tr.dp-pa-subrow)>td{border-bottom:none !important}'
    +'tr.dp-vs-subrow,tr.dp-pa-subrow{border-top:none !important}'
    +'tr.dp-vs-subrow>td,tr.dp-pa-subrow>td{border-top:none !important}'
    +'th,td{padding:4pt 6pt}'
    +'thead{display:table-header-group}tr{page-break-inside:avoid}'
    +'</style></head><body>'+bodyHtml+'</body></html>';
  return html;
}

/* ── PDF 생성 진행 오버레이 (사용자 보고 2026-08-12) ──
 * 옛 1.5초 토스트는 두 가지 문제를 만들었다:
 *  ① 연간 등 대용량 출력은 생성이 30초~수 분 걸리는데 토스트가 먼저 사라져 "먹통"으로 오인.
 *  ② 실패 응답이 토스트 수명(1.5초) 안에 돌아오면 dailyShowToast 의 기존-토스트 가드에 걸려
 *     실패 안내가 통째로 삼켜짐 → 무음 실패.
 * → IPC 가 결과를 돌려줄 때까지 유지되는 지속형 오버레이 + 실패는 모달로 교체. */
let _dpExportProgTimer=null;   /* 진행 카운터 interval — hide/finish 시 반드시 해제 */
let _dpExportTotal=0;          /* 이번 내보내기 총 건수 — finish 완주 목표 */
function _dpShowExportProgress(recCount,label){
  _dpHideExportProgress();
  _dpExportTotal=recCount>0?recCount:0;
  const ov=document.createElement('div');
  ov.id='dpExportProgressOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:49000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px)';
  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--cyan);border-radius:12px;padding:22px 34px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.3);font-family:var(--f)">'
    +'<div style="width:30px;height:30px;margin:0 auto 12px;border:3px solid var(--bdr);border-top-color:var(--cyan);border-radius:50%;animation:dpExpSpin 0.9s linear infinite"></div>'
    +'<div style="font-size:13.5px;font-weight:800;color:var(--t1)">'+(label||'PDF')+' 생성 진행 중...'
      +(recCount>0?' <span id="dpExportProgCount" style="color:var(--cyan)">(0/'+recCount+'건)</span>':'')+'</div>'
    +'<div style="font-size:11.5px;color:var(--t3);margin-top:7px;line-height:1.6">일지 등록 건수가 많을수록 시간 지체가 발생할 수 있습니다.<br>창을 닫지 말고 잠시만 기다려 주세요.</div>'
    +'</div>'
    +'<style>@keyframes dpExpSpin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(ov);
  /* ── 상승 카운터 (사용자 요청 2026-08-12: "(7/470건)처럼 분자가 올라야 멈춘 걸로 오해 안 함") ──
   * printToPDF/xlsx 빌드는 진행 콜백이 없어 실제 처리 건수를 알 수 없다 → 건수 기반 예상 소요시간으로
   * 보정한 점근 진행(1-e^-x). 예상 시점에 ~80%, 이후에도 계속 오르되 생성 완료 전엔 총건수 미도달.
   * 완료 신호가 오면 _dpFinishExportProgress 가 총건수까지 완주시킨 뒤에야 저장 창이 뜬다
   * (사용자 요청 2026-08-12: "410건이면 분자가 410이 되고 나서 저장 창"). 실측 보정: 410건 ≈ 3~5초. */
  if(recCount>0){
    const t0=Date.now();
    const est=Math.max(2000,1800+recCount*8);   /* 예상 소요(ms) */
    _dpExportProgTimer=setInterval(function(){
      const el=document.getElementById('dpExportProgCount');
      if(!el){ clearInterval(_dpExportProgTimer); _dpExportProgTimer=null; return; }
      const t=Date.now()-t0;
      const p=1-Math.exp(-1.6*t/est);
      const n=Math.max(1,Math.min(recCount-1,Math.floor(recCount*p)));
      el.textContent='('+n+'/'+recCount+'건)';
    },200);
  }
}
/* 생성 완료 신호 후 호출 — 분자를 총건수까지 빠르게(~0.4초) 완주시키고 잠깐(0.35초) 보여준 뒤 resolve.
 * resolve 후에 저장 다이얼로그를 열어야 "완료를 보고 나서 저장 창" 순서가 성립한다. */
function _dpFinishExportProgress(){
  return new Promise(function(resolve){
    if(_dpExportProgTimer){ clearInterval(_dpExportProgTimer); _dpExportProgTimer=null; }
    const el=document.getElementById('dpExportProgCount');
    const total=_dpExportTotal;
    if(!el||!total){ resolve(); return; }
    const m=(el.textContent||'').match(/\((\d+)\//);
    let cur=m?parseInt(m[1],10):0;
    const step=Math.max(1,Math.ceil((total-cur)/8));   /* 8틱 ≈ 0.4초 완주 */
    const iv=setInterval(function(){
      cur=Math.min(total,cur+step);
      const el2=document.getElementById('dpExportProgCount');
      if(el2)el2.textContent='('+cur+'/'+total+'건)';
      if(cur>=total){ clearInterval(iv); setTimeout(resolve,350); }
    },50);
  });
}
function _dpHideExportProgress(){
  if(_dpExportProgTimer){ clearInterval(_dpExportProgTimer); _dpExportProgTimer=null; }
  const ov=document.getElementById('dpExportProgressOverlay');
  if(ov)ov.remove();
}

/* 내보내기 총 건수 — daily 형식은 _dpDailyDataCache, 그 외(row/student/counsel)는 _dpCache 가 캐시 (2026-08-12) */
function _dpExportRecCount(){
  if(_dpFormat==='daily')
    return ((_dpDailyDataCache&&_dpDailyDataCache.filtered&&_dpDailyDataCache.filtered.length)||0);
  /* 특정 학생/상담 등 필터 형식 — 미리보기에서 확정된 필터 후 건수 우선 (분모=전체 버그 수정 2026-08-27) */
  if(_dpCache&&typeof _dpCache.filteredCount==='number')return _dpCache.filteredCount;
  return ((_dpCache&&_dpCache.records&&_dpCache.records.length)||0);
}
function _dpExportFailModal(title,err){
  appConfirmModal(title+'에 실패했습니다.<br><br><span style="color:var(--t3);font-size:11.5px">'+escHtmlDp(err||'알 수 없는 오류')+'</span>',title+' 실패',{okOnly:true,okLabel:'확인'});
}
function exportDiaryPreviewPDF(){
  if(!(window.electronAPI&&window.electronAPI.printToPDF)){bus.emit('toast:show',{text:'PDF 저장 기능을 사용할 수 없습니다.'});return;}
  const html=_dpBuildPrintDocHtml();
  if(!html){appConfirmModal('먼저 미리보기를 실행하세요.','PDF 저장',{okOnly:true,okLabel:'확인',okBg:'rgba(6,182,212,0.12)',okBorder:'rgba(6,182,212,0.35)',okColor:'#0891b2'});return;}
  const from=document.getElementById('dpFrom').value, to=document.getElementById('dpTo').value;
  const fileName=_dpSaveBaseName(from,to)+'.pdf';   /* 사용자 규칙 파일명 (2026-06-10) */
  _dpShowExportProgress(_dpExportRecCount(),'PDF');
  const _ls=!_dpIsCounselIndividual();   /* 개별 양식(상담기록지)은 세로 */
  /* ── 2단계 경로 (Electron): 생성 → 카운터 완주(n/n건) → 저장 다이얼로그.
   * 저장 창은 분자가 총건수에 도달한 뒤에만 뜬다 (사용자 요청 2026-08-12). ── */
  if(window.electronAPI.printToPDFGenerate&&window.electronAPI.printToPDFSave){
    window.electronAPI.printToPDFGenerate(html,{landscape:_ls,marginsType:1}).then(function(res){
      if(!(res&&res.success)){
        _dpHideExportProgress();
        _dpExportFailModal('PDF 저장',(res&&res.error));
        return;
      }
      return _dpFinishExportProgress().then(function(){
        _dpHideExportProgress();
        return window.electronAPI.printToPDFSave(res.token,fileName);
      }).then(function(sv){
        if(sv&&sv.success){bus.emit('toast:show',{text:'PDF가 저장되었습니다.'});return;}
        if(sv&&sv.error==='cancelled')return;   /* 저장 다이얼로그에서 사용자가 취소 — 무음 */
        _dpExportFailModal('PDF 저장',(sv&&sv.error));
      });
    }).catch(function(e){
      _dpHideExportProgress();
      _dpExportFailModal('PDF 저장',(e&&e.message)||String(e));
    });
    return;
  }
  /* ── 단일 호출 폴백 (웹 변형 등 2단계 API 미노출 환경) — 기존 동작 유지 ── */
  window.electronAPI.printToPDF(html,{fileName:fileName,landscape:_ls,marginsType:1}).then(function(res){
    _dpHideExportProgress();
    if(res&&res.success){bus.emit('toast:show',{text:'PDF가 저장되었습니다.'});return;}
    if(res&&res.error==='cancelled')return;   /* 저장 다이얼로그에서 사용자가 취소 — 무음 */
    /* 실패는 토스트가 아닌 모달 — 토스트는 기존 토스트와 충돌 시 무음 삼켜짐 (2026-08-12) */
    _dpExportFailModal('PDF 저장',(res&&res.error));
  }).catch(function(e){
    _dpHideExportProgress();
    _dpExportFailModal('PDF 저장',(e&&e.message)||String(e));
  });
}

/* 인쇄 — PDF 와 동일 HTML 을 응급기록지와 동일한 A4 인쇄 미리보기 다이얼로그(가로)로 열어 실제 출력.
 *  사용자 요청 2026-06-15: 인쇄 버튼 → 미리보기 모달 → 프린터 지정 → 인쇄로 실제 출력. */
function printDiaryPreview(){
  const html=_dpBuildPrintDocHtml();
  if(!html){bus.emit('toast:show',{text:'먼저 미리보기를 실행하세요.'});return;}
  if(_dpIsCounselIndividual()){
    openA4PrintDialog({html:html, title:'상담 기록지', headerLabel:'상담 기록지 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}, landscape:false});
    return;
  }
  openA4PrintDialog({html:html, title:'보건일지', headerLabel:'보건일지 인쇄', marginsMm:{top:12,bottom:12,left:12,right:12}, landscape:true});
}

function printDiaryDirect(){
  /* 인쇄도 PDF 와 동일한 완성 문서 사용 (사용자 지시 2026-08-27) —
   * 1페이지 = 표지(제목·학교명·기간 단독, page-break), 2페이지부터 일지표.
   * 테두리·11pt·V/S 서브행 병합선 등 PDF 규칙이 인쇄에도 그대로 적용된다. */
  const html=_dpBuildPrintDocHtml();
  if(!html){alert('먼저 미리보기를 실행하세요.');return;}
  const win=window.open('','_blank');
  if(!win){bus.emit('toast:show',{text:'팝업이 차단되었습니다. 브라우저 설정을 확인하세요.'});return;}
  win.document.write(html);
  win.document.close();
  win.print();
}

let _dpFormat='row'; /* 'row'=방문자당 한 행, 'daily'=매일 한 페이지, 'student'=특정 방문자 내역, 'counsel'=상담 내역 (사용자 요청 2026-06-25) */
let _dpSelectedStudentId = null;
/* 상담 내역 형식의 하위 모드: 'diary'=보건일지 형식(row 양식 + 상담기록만 필터), 'individual'=개별 양식(상담기록지 출력) */
let _dpCounselMode='diary';
/* 레코드에 실제 상담 내용이 있는지 — 상담 이력 모달과 동일 판정(content/action/plan/opinion) */
function _dpHasCounsel(r){
  const log=(r&&r.counselLog&&typeof r.counselLog==='object'&&!Array.isArray(r.counselLog))?r.counselLog:null;
  if(!log)return false;
  return ['content','action','plan','opinion'].some(function(k){return String(log[k]||'').trim();});
}
function _dpIsCounselIndividual(){ return _dpFormat==='counsel' && _dpCounselMode==='individual'; }
/* 캐시된 기간 레코드에서 상담 기록만 추려 날짜·시간순 정렬 */
function _dpCounselRecsSorted(){
  return (((_dpCache&&_dpCache.records)||[]).filter(function(r){return _dpHasCounsel(r);}))
    .sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''))||String(a.timeIn||'').localeCompare(String(b.timeIn||''));});
}
/* 상담 기록지 여러 장을 조립 — _symBuildCounselPrintHtml 의 표준 시트를 페이지마다 쌓는다.
 *  반환: {globalCss(시트 표준 CSS), bodyHtml(.dp-counsel-sheet 들)} */
function _dpCounselSheetsParts(records){
  const parser=new DOMParser();
  let globalCss='';
  const bodies=[];
  records.forEach(function(r){
    let built=null;
    try{ built=_symBuildCounselPrintHtml(r); }catch(_){}
    if(!built||!built.html)return;
    const doc=parser.parseFromString(built.html,'text/html');
    if(!globalCss){ const st=doc.querySelector('style'); globalCss=st?st.textContent:''; }
    const body=doc.body?doc.body.innerHTML:'';
    bodies.push('<div class="dp-counsel-sheet" style="page-break-after:always;break-after:page">'+body+'</div>');
  });
  return {globalCss:globalCss, bodyHtml:bodies.join('')};
}
/* 미리보기 영역 전용 스코프 CSS — 시트 표준 CSS 를 .dp-counsel-sheet 안으로 한정(앱 전역 오염 방지) */
const _DP_COUNSEL_PREVIEW_CSS=
  /* A4 세로 한 장(794×1123px @96dpi) + 20mm/12mm 여백 — 상담기록지·통계표지 모두 A4 페이지로 (사용자 요청 2026-06-25) */
  '.dp-counsel-sheet,.dp-a4-page{width:794px;min-height:1123px;box-sizing:border-box;background:#fff;color:#111;padding:76px 45px;margin:0 auto 24px;box-shadow:0 2px 14px rgba(0,0,0,0.22);font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif}'
  +'.dp-counsel-sheet table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-bottom:14px}'
  +'.dp-counsel-sheet th,.dp-counsel-sheet td{border:1px solid #999;padding:7px 9px;text-align:left;vertical-align:top}'
  +'.dp-counsel-sheet th+th,.dp-counsel-sheet td+td,.dp-counsel-sheet th+td,.dp-counsel-sheet td+th{border-left:0}'
  +'.dp-counsel-sheet tr+tr td,.dp-counsel-sheet tr+tr th{border-top:0}'
  +'.dp-counsel-sheet th{background:#f0f0f0;font-weight:700;white-space:nowrap}'
  +'.dp-counsel-sheet .section-title{background:#ede9fe;font-weight:700;text-align:center;padding:8px}'
  +'.dp-counsel-sheet .long-cell{white-space:pre-wrap;word-break:break-word;height:64px}'
  +'.dp-counsel-sheet .bar{display:flex;height:5px;overflow:hidden;border-radius:2px}'
  +'.dp-counsel-sheet .bar.top .b1{flex:7;background:#2855A0}.dp-counsel-sheet .bar.top .b2{flex:3;background:#D4A843}'
  +'.dp-counsel-sheet .bar.bot .b3{flex:3;background:#2E8B57}.dp-counsel-sheet .bar.bot .b4{flex:7;background:#C0392B}'
  +'.dp-counsel-sheet h2{text-align:center;margin:10px 0;font-size:20px;letter-spacing:8px}';
/* 상담 내역 — 개별 양식: 기간 내 상담 기록지를 모두 모아 미리보기 (사용자 요청 2026-06-25) */
async function _dpShowCounselIndividualPreview(){
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  if(!from||!to){alert('시작일과 종료일을 선택하세요.');return;}
  if(from>to){alert('시작일이 종료일보다 늦습니다.');return;}
  const _loadingDots=document.getElementById('dpLoadingDots');
  if(_loadingDots)_loadingDots.style.display='inline';
  if(!_dpCache||_dpCache.from!==from||_dpCache.to!==to)_dpCache={from:from,to:to,records:null,coverHtml:null,coverPromise:null,nurseCounts:null};
  if(!_dpCache.records){
    try{
      const res=await window.electronAPI.recordsDailyByDateRange(from,to);
      _dpCache.records=_dpReconcileWithMemory((res&&res.success)?(res.data||[]):[],from,to);
    }catch(e){
      _dpCache.records=S.records.filter(function(r){return r.date>=from&&r.date<=to;});
    }
  }
  if(_loadingDots)_loadingDots.style.display='none';
  const area=document.getElementById('dpPreviewArea');
  if(!area)return;
  const recs=_dpCounselRecsSorted();
  if(_dpCache)_dpCache.filteredCount=recs.length;   /* 진행 카운터 분모 = 실제 출력 건수 (2026-08-27) */
  if(!recs.length){
    area.innerHTML='<div style="padding:48px 20px;text-align:center;color:var(--t3);font-size:13px">선택한 기간에 작성된 상담 기록이 없습니다.</div>';
    return;
  }
  const parts=_dpCounselSheetsParts(recs);
  /* 첫 페이지 상담 통계 표지 — 개별 양식(상담 기록지 전부)에도 통계 포함 (사용자 요청 2026-06-25).
   *  미리보기 innerHTML 을 _dpBuildPrintDocHtml 이 그대로 복제하므로 PDF·인쇄에도 자동 반영. */
  let _counselCover='';
  const _coOpt=document.getElementById('dpOptCounsel');
  if(_coOpt&&_coOpt.checked){
    try{ _counselCover=await buildCounselSummaryVertical(from,to); }catch(e){ _counselCover=''; }
  }
  area.innerHTML='<style>'+_DP_COUNSEL_PREVIEW_CSS+'</style>'
    +'<div style="font-size:11px;color:var(--t3);margin-bottom:12px">상담 기록지 '+recs.length+'장 — 기간 '+escHtmlDp(from)+' ~ '+escHtmlDp(to)+'</div>'
    +'<div style="overflow-x:auto;width:100%"><div style="width:794px;margin:0 auto">'
      +(_counselCover?'<div class="dp-a4-page" id="dpCounselCoverWrap">'+_counselCover+'</div>':'')
      +parts.bodyHtml
    +'</div></div>';
}
/* row/특정 방문자 양식의 문서 제목 — 'student' 모드면 선택 대상자별로 분기.
 *  학생: "OOO 학생의 보건실 방문 현황", 교직원: "OOO 님의 방문 현황". 그 외: "보건실 방문자 현황". (사용자 요청 2026-05-29) */
function _dpRowTitleText(){
  if(_dpFormat==='student' && _dpSelectedStudentId && typeof getStu==='function'){
    const stu=getStu(_dpSelectedStudentId);
    if(stu && stu.name){
      return stu.type==='staff'
        ? (stu.name+' 님의 방문 현황')
        : (stu.name+' 학생의 보건실 방문 현황');
    }
  }
  if(_dpFormat==='counsel') return '상담 내역';   /* 표지·제목 (사용자 요청 2026-06-25) */
  return '보건실 방문자 현황';
}
/* 저장 파일명 공통 — 사용자 규칙 (2026-06-10):
 *  · 특정 방문자: "OO고등학교 OOO학생의 보건일지 (20260301-20260711)" (교직원은 "OOO님의")
 *  · 방문자당 한 행·매일 한 페이지: "OO고등학교 보건일지 (20260301-20260711)"
 *  · 시작일=종료일이면 "(20260610)" 한 개만. 확장자는 호출부에서 부착. */
function _dpSaveBaseName(from,to){
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  const c=function(d){return String(d||'').replace(/-/g,'');};
  const range=(from&&to&&from!==to)?(c(from)+'-'+c(to)):c(from||to);
  let who='';
  if(_dpFormat==='student'&&_dpSelectedStudentId&&typeof getStu==='function'){
    const stu=getStu(_dpSelectedStudentId);
    if(stu&&stu.name) who=stu.type==='staff'?(stu.name+' 님의 '):(stu.name+' 학생의 ');   /* 이름 뒤 한 칸 (사용자 요청 2026-08-27) */
  }
  return (schoolName?schoolName+' ':'')+who+'보건일지'+(range?' ('+range+')':'');
}
/* 특정 방문자 형식 전용 통계 표지 — 전교생 집계(buildDeptStatsCover) 대신
 * 선택 대상 1명의 기간 내 기록(이미 필터됨)으로 진료과별 건수만 집계 (사용자 보고 2026-06-10). */
function _dpBuildStudentCoverHtml(records){
  const counts={};
  (records||[]).forEach(function(r){ const d=String(r.dept||'').trim()||'미상'; counts[d]=(counts[d]||0)+1; });
  const keys=Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
  const total=(records||[]).length;
  const stu=(typeof getStu==='function')?getStu(_dpSelectedStudentId):null;
  const who=(stu&&stu.name)?stu.name:String(_dpSelectedStudentId||'');
  const cell='border:1px solid #cbd5e1;padding:5px 8px;font-size:11pt;text-align:center;color:#1e293b';   /* 11pt 통일 (2026-06-11) */
  const head=cell+';background:#f1f5f9;font-weight:700;color:#475569;font-size:11pt';   /* 11pt 통일 (2026-06-11) */
  let s='<div style="font-size:13px;font-weight:800;color:#0f172a;margin:0 0 6px">📊 '+escHtml(who)+' — 진료과별 방문 통계</div>';
  s+='<div style="border:1px solid #cbd5e1;border-radius:6px;margin-bottom:16px"><table style="width:100%;border-collapse:collapse"><tr>';
  s+='<th style="'+head+'">진료과</th>';
  keys.forEach(function(k){ s+='<th style="'+head+'">'+escHtml(k)+'</th>'; });
  s+='<th style="'+head+';color:#0891b2">계</th></tr><tr>';
  s+='<td style="'+cell+';font-weight:700">건수</td>';
  keys.forEach(function(k){ s+='<td style="'+cell+'">'+counts[k]+'</td>'; });
  s+='<td style="'+cell+';font-weight:800;color:#0891b2">'+total+'</td></tr></table></div>';
  return s;
}
/* 학년반 칼럼 값 — 학교급(초/중/고)은 별도 '학교급' 칼럼에 이미 표시되므로, 특수학교에서도
 *  학년반은 접두 없이 "1-2" 단순 형식으로 통일 (일반 일지와 동일, 사용자 요청 2026-05-29). */
function _dpGradeCol(s){
  if(!s) return '-';
  if(s.type==='staff') return s.position||'교직원';
  const sl=(S.settings&&S.settings.schoolLevel)||'';
  if(sl==='special') return (s.grade&&s.cls)?(s.grade+'-'+s.cls):(s.grade||'-');
  return getStuGradeCol(s,{short:true})||'-';
}
/* ── 미리보기 모드 전환: 설정 ↔ 미리보기 ── */
function _dpEnterPreviewMode(){
  const settingsScroll=document.getElementById('dpSettingsScroll');
  if(settingsScroll)settingsScroll.style.display='none';
  const previewPanel=document.getElementById('dpPreviewPanel');
  if(previewPanel)previewPanel.style.display='flex';
}
function _dpExitPreviewMode(){
  const settingsScroll=document.getElementById('dpSettingsScroll');
  if(settingsScroll)settingsScroll.style.display='block'; /* 명시적 block 복원 */
  const previewPanel=document.getElementById('dpPreviewPanel');
  if(previewPanel)previewPanel.style.display='none';
}
/* ── 빠른 기간 프리셋 ── */
function _dpQuickRange(preset){
  _dpSingleMode=(preset==='single');   /* 다른 칩을 누르면 특정일 모드 해제 */
  const now=new Date();
  const y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
  function fmt(dt){return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');}
  let from=null, to=null;
  if(preset==='today'){from=new Date(y,m,d);to=from;}
  else if(preset==='week'){const dow=now.getDay(); from=new Date(y,m,d-((dow+6)%7)); to=new Date(from);to.setDate(from.getDate()+6);}
  else if(preset==='month'){from=new Date(y,m,1);to=new Date(y,m+1,0);}
  else if(preset==='semester'){
    /* 설정의 '학기 정보' 를 우선 읽고, 없으면 전통적 3/1·9/1 기본값 사용 */
    const ay=m>=2?y:y-1;
    const info=(typeof getSemesterInfo==='function')?getSemesterInfo(ay):null;
    const today=new Date();
    const ts=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    if(info){
      /* 오늘이 1학기 범위 안이면 1학기, 아니면 2학기 */
      if(ts>=info.s1Start&&ts<=info.s1End){from=dateObj(info.s1Start);to=dateObj(info.s1End);}
      else{from=dateObj(info.s2Start);to=dateObj(info.s2End);}
    } else {
      const half=(m>=2&&m<=7)?1:2;
      if(half===1){from=new Date(ay,2,1);to=new Date(ay,7,31);}else{from=new Date(ay,8,1);to=new Date(ay+1,1,28);}
    }
  }
  else if(preset==='year'){
    /* 이번 학년도 = 1학기 시작일 ~ 2학기 종료일 (학기 설정 semesterInfo 공유, 사용자 지시 2026-06-16). 없으면 전통 3/1~익년 2월말. */
    const ay=m>=2?y:y-1;
    const info=(typeof getSemesterInfo==='function')?getSemesterInfo(ay):null;
    if(info&&info.s1Start&&info.s2End){ from=dateObj(info.s1Start); to=dateObj(info.s2End); }
    else { from=new Date(ay,2,1); to=new Date(ay+1,1,28); }
  }
  /* 이번 학기·이번 학년도 — 종료일은 학기/학년도 말일이 아니라 '오늘'까지.
   * 미래 기록은 존재하지 않으므로 (사용자 지시 2026-08-27). 시작일보다 앞서지는 않게 방어. */
  if((preset==='semester'||preset==='year')&&to){
    const _todayD=new Date(y,m,d);
    if(to>_todayD)to=_todayD;
    if(from&&to<from)to=new Date(from);
  }
  else if(preset==='custom'){
    /* 기간 선택 — 날짜 입력만 초기화하고 시작일 캘린더를 바로 띄움 */
    const fEl=document.getElementById('dpFrom'), tEl=document.getElementById('dpTo');
    if(fEl)fEl.value=''; if(tEl)tEl.value='';
    _dpCheckBtnState();
    document.querySelectorAll('[data-action="dpQuickRange"]').forEach(function(b){
      b.style.background=b.dataset.arg===preset?'var(--cyan)':'var(--bg2)';
      b.style.color=b.dataset.arg===preset?'#fff':'var(--t2)';
      b.style.borderColor=b.dataset.arg===preset?'var(--cyan)':'var(--bdr)';
    });
    /* 시작일 캘린더 자동 표시 */
    setTimeout(function(){ if(typeof dpOpenCal==='function')dpOpenCal('dpFrom'); },50);
    return;
  }
  else if(preset==='single'){
    /* 특정일 선택 (사용자 요청 2026-06-11) — 달력 하나로 시작=종료=그 날 동시 설정 */
    const fEl=document.getElementById('dpFrom'), tEl=document.getElementById('dpTo');
    if(fEl)fEl.value=''; if(tEl)tEl.value='';
    _dpCheckBtnState();
    document.querySelectorAll('[data-action="dpQuickRange"]').forEach(function(b){
      b.style.background=b.dataset.arg===preset?'var(--cyan)':'var(--bg2)';
      b.style.color=b.dataset.arg===preset?'#fff':'var(--t2)';
      b.style.borderColor=b.dataset.arg===preset?'var(--cyan)':'var(--bdr)';
    });
    setTimeout(function(){
      if(typeof dpOpenCal==='function'){ dpOpenCal('dpFrom'); dpCalTarget='dpSingle'; }
    },50);
    return;
  }
  if(from&&to){
    const fEl=document.getElementById('dpFrom'), tEl=document.getElementById('dpTo');
    if(fEl)fEl.value=fmt(from);
    if(tEl)tEl.value=fmt(to);
    _dpCheckBtnState();
    /* 활성 프리셋 표시 */
    document.querySelectorAll('[data-action="dpQuickRange"]').forEach(function(b){
      b.style.background=b.dataset.arg===preset?'var(--cyan)':'var(--bg2)';
      b.style.color=b.dataset.arg===preset?'#fff':'var(--t2)';
      b.style.borderColor=b.dataset.arg===preset?'var(--cyan)':'var(--bdr)';
    });
  }
}
export function openDiaryPrint(){
  _dpFormat='row';
  _dpSingleMode=false;
  _dpSelectedStudentId=null;
  /* 모듈 캐시 초기화 — _dpCache/_dpDailyDataCache 는 세션 전역이라, 옛 세션에서 담아둔 같은 기간(예: '오늘') 캐시가
   * 그 뒤 추가된 방문(본인·협업 웹서버의 다른 보건교사·키오스크 접수)을 놓쳐 방문자 수가 실제보다 적게 나오던
   * 간헐 현상 방지 — 다이얼로그를 열 때마다 항상 현재 DB 를 다시 조회하도록 비움 (2026-07-06). */
  _dpCache=null; _dpDailyDataCache=null;
  const overlay=document.createElement('div');overlay.className='modal-overlay show';overlay.id='diaryPrintOverlay';overlay.style.background='rgba(0,0,0,0.35)';overlay.style.backdropFilter='none';overlay.style.webkitBackdropFilter='none';
  /* 미리보기 영역이 아래에 길게 나오는 경우를 대비해 모달을 상단 정렬 — 너무 붙지 않도록 약간 내려서 배치 */
  overlay.style.alignItems='flex-start';
  overlay.style.paddingTop='6vh';
  let h='<div class="modal-content" style="width:1480px;max-width:98vw;max-height:88vh;padding:0;display:flex;flex-direction:column;overflow:hidden;border-radius:14px">';
  /* 헤더 — X 버튼 제거 (외부 클릭으로 닫기) */
  h+='<div style="display:flex;align-items:center;padding:18px 24px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.04));flex-shrink:0">'
    +'<div><div style="font-size:16px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">📋 보건일지 출력</div><div style="font-size:11px;color:var(--t3);margin-top:2px">기간을 선택하고 출력 형식·항목을 지정한 뒤 미리보기 → 원하는 방식으로 내보내세요. (모달 외부 클릭 시 닫힘)</div></div>'
    +'</div>';
  h+='<div id="dpSettingsScroll" style="padding:22px 24px 12px;flex-shrink:0;overflow-y:auto;scrollbar-width:thin">';

  /* ── 1️⃣ 기간 선택 ── */
  h+='<div style="border:1px solid var(--bdr);border-radius:10px;padding:14px 16px;background:var(--bg2);margin-bottom:14px">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--cyan);color:#fff;font-size:11px;font-weight:800">1</span><span style="font-size:13px;font-weight:700;color:var(--t1)">출력 기간</span></div>';
  /* 빠른 프리셋 */
  h+='<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
  [['today','오늘'],['week','이번 주'],['month','이번 달'],['semester','이번 학기'],['year','이번 학년도'],['custom','기간 선택'],['single','특정일 선택']].forEach(function(p){
    h+='<button data-action="dpQuickRange" data-arg="'+p[0]+'" style="padding:5px 12px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:14px;cursor:pointer;transition:all .15s">'+p[1]+'</button>';
  });
  h+='</div>';
  /* 시작일/종료일 */
  h+='<div style="display:flex;gap:12px;align-items:center">';
  h+='<div style="flex:1"><label style="font-size:10px;color:var(--t3);font-weight:600;margin-bottom:3px;display:block">시작일</label><div data-action="dpOpenCal" data-arg="dpFrom" style="display:flex;align-items:center;gap:6px;padding:8px 12px;border:1.5px solid var(--bdr);border-radius:8px;cursor:pointer;background:var(--card);transition:border-color .15s" onmouseover="this.style.borderColor=\'var(--cyan)\'" onmouseout="this.style.borderColor=\'var(--bdr)\'">';
  h+='<span style="font-size:14px">📅</span><input type="text" id="dpFrom" placeholder="날짜를 선택하세요" readonly style="flex:1;border:none;outline:none;background:transparent;font-size:12px;color:var(--t1);cursor:pointer"></div></div>';
  h+='<div style="font-size:18px;color:var(--t3);padding-top:18px">→</div>';
  h+='<div style="flex:1"><label style="font-size:10px;color:var(--t3);font-weight:600;margin-bottom:3px;display:block">종료일</label><div data-action="dpOpenCal" data-arg="dpTo" style="display:flex;align-items:center;gap:6px;padding:8px 12px;border:1.5px solid var(--bdr);border-radius:8px;cursor:pointer;background:var(--card);transition:border-color .15s" onmouseover="this.style.borderColor=\'var(--cyan)\'" onmouseout="this.style.borderColor=\'var(--bdr)\'">';
  h+='<span style="font-size:14px">📅</span><input type="text" id="dpTo" placeholder="날짜를 선택하세요" readonly style="flex:1;border:none;outline:none;background:transparent;font-size:12px;color:var(--t1);cursor:pointer"></div></div>';
  h+='</div>';
  h+='</div>';

  /* ── 2️⃣ 출력 형식 (큰 카드 2장) ── */
  h+='<div style="border:1px solid var(--bdr);border-radius:10px;padding:14px 16px;background:var(--bg2);margin-bottom:14px">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--cyan);color:#fff;font-size:11px;font-weight:800">2</span><span style="font-size:13px;font-weight:700;color:var(--t1)">출력 형식</span></div>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">';
  h+='<div id="dpTabRow" data-action="dpSwitchFormat" data-arg="row" style="padding:14px;border:2px solid var(--cyan);border-radius:10px;background:rgba(6,182,212,0.06);cursor:pointer;transition:all .15s">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:22px">📊</span><span style="font-size:13px;font-weight:700;color:var(--t1)">방문자당 한 행</span><span id="dpTabRowCheck" style="margin-left:auto;color:var(--cyan);font-size:16px">✓</span></div>'
    +'<div style="font-size:10.5px;color:var(--t3);line-height:1.5">전체 기간을 하나의 표로 출력. 통계 정리·교육청 제출에 적합.</div>'
    +'</div>';
  h+='<div id="dpTabDaily" data-action="dpSwitchFormat" data-arg="daily" style="padding:14px;border:2px solid var(--bdr);border-radius:10px;background:var(--card);cursor:pointer;transition:all .15s">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:22px">📅</span><span style="font-size:13px;font-weight:700;color:var(--t1)">매일 한 페이지</span><span id="dpTabDailyCheck" style="margin-left:auto;color:var(--cyan);font-size:16px;display:none">✓</span></div>'
    +'<div style="font-size:10.5px;color:var(--t3);line-height:1.5">날짜별로 페이지를 나눠 일간 통계와 함께 출력.</div>'
    +'</div>';
  /* 사용자 요청 2026-05-28 — 3번째 카드: 특정 학생 내역. 양식·내보내기 흐름은 '방문자당 한 행' 동일, records 만 선택 학생 1명으로 필터. */
  h+='<div id="dpTabStudent" data-action="dpSwitchFormat" data-arg="student" style="padding:14px;border:2px solid var(--bdr);border-radius:10px;background:var(--card);cursor:pointer;transition:all .15s">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:22px">👤</span><span style="font-size:13px;font-weight:700;color:var(--t1)">특정 방문자 내역</span><span id="dpTabStudentCheck" style="margin-left:auto;color:var(--cyan);font-size:16px;display:none">✓</span></div>'
    +'<div style="font-size:10.5px;color:var(--t3);line-height:1.5">학생/교직원 1명의 방문 이력만 행으로 출력. 보호자 상담·면담 자료에 적합.</div>'
    +'<div id="dpStudentPickArea" data-action="dpPickStudent" style="margin-top:8px;padding:8px 10px;border:1px dashed var(--bdr);border-radius:7px;background:var(--bg2);font-size:10.5px;color:var(--t3);text-align:center;cursor:pointer">클릭하여 대상을 선택하세요</div>'
    +'</div>';
  /* 4번째 카드: 상담 내역 — 상담 기록이 있는 방문만. 하위 2모드(보건일지 형식 / 개별 양식). 사용자 요청 2026-06-25. */
  h+='<div id="dpTabCounsel" data-action="dpSwitchFormat" data-arg="counsel" style="padding:14px;border:2px solid var(--bdr);border-radius:10px;background:var(--card);cursor:pointer;transition:all .15s">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:22px">💬</span><span style="font-size:13px;font-weight:700;color:var(--t1)">상담 내역</span><span id="dpTabCounselCheck" style="margin-left:auto;color:var(--cyan);font-size:16px;display:none">✓</span></div>'
    +'<div style="font-size:10.5px;color:var(--t3);line-height:1.5">상담 기록이 있는 방문만 모아 출력.</div>'
    +'<div id="dpCounselModeArea" style="display:flex;margin-top:8px;flex-direction:column;gap:6px">'
      +'<button data-action="dpCounselMode" data-arg="diary" id="dpCounselModeDiary" style="padding:7px 8px;border:1.5px solid var(--cyan);border-radius:7px;background:rgba(6,182,212,0.08);font-size:10.5px;font-weight:700;color:var(--cyan);cursor:pointer;font-family:var(--f);text-align:left;line-height:1.3">보건일지 형식<div style="font-size:9px;color:var(--t3);font-weight:500;margin-top:1px">기존 형식 그대로 · 상담한 인원만</div></button>'
      +'<button data-action="dpCounselMode" data-arg="individual" id="dpCounselModeIndiv" style="padding:7px 8px;border:1.5px solid var(--bdr);border-radius:7px;background:var(--bg2);font-size:10.5px;font-weight:700;color:var(--t1);cursor:pointer;font-family:var(--f);text-align:left;line-height:1.3">개별 양식<div style="font-size:9px;color:var(--t3);font-weight:500;margin-top:1px">상담 기록지를 기간 내 전부 출력</div></button>'
    +'</div>'
    +'</div>';
  h+='</div>';
  /* (옵션 체크박스는 미리보기 패널 상단으로 이동됨 — 설정에서는 숨김 input 만 유지) */
  h+='<input type="checkbox" id="dpOptTodayMemo" checked style="display:none">';   /* 오늘의 메모 포함 — 기본 ON (2026-06-10) */
  h+='<input type="checkbox" id="dpOptCover" style="display:none">';
  h+='<input type="checkbox" id="dpOptCounsel" style="display:none">';
  h+='<input type="checkbox" id="dpOptNurse" style="display:none">';
  h+='</div>';

  /* (3️⃣ 표시 항목 / 순서는 미리보기 패널 상단으로 이동됨 — 설정 영역에서는 제거) */
  h+='<div id="dpColsChips" style="display:none"></div>';

  /* ── 4️⃣ 액션 (큰 미리보기 — 단일 액션) ── */
  h+='<div id="dpSettingsActions" style="display:flex;gap:10px;align-items:center;padding:14px 0;flex-wrap:wrap;border-top:1px solid var(--bdr);position:sticky;bottom:0;background:var(--card)">';
  h+='<button class="btn" id="dpPreviewMainBtn" disabled style="opacity:0.4;background:#94a3b8;color:#fff;border:none;cursor:default;padding:10px 28px;font-size:13px;font-weight:700;border-radius:8px;display:flex;align-items:center;gap:6px">👁 미리보기 실행</button>';
  h+='<span style="font-size:10px;color:var(--t3);margin-left:auto">기간을 선택하면 미리보기 버튼이 활성화됩니다.</span>';
  h+='</div>';

  h+='</div>'; /* scrollable settings end */

  /* ── 미리보기 모드 패널 (초기 숨김 — 미리보기 실행 시 노출, 설정 영역 숨김) ── */
  h+='<div id="dpPreviewPanel" style="display:none;flex:1;min-height:0;flex-direction:column">';
  /* ── 추가 옵션 카드 — div 기반 (label 의 네이티브 토글이 환경에 따라
     change 이벤트를 일관되게 발생시키지 못해 div + data-dp-toggle 으로 명시 토글) ── */
  function _dpOptCardHtml(id,iconPath,title,desc,tint){
    /* 세 카드 높이 통일(min-height) + 폭 균등(flex-basis 0) + 토글은 margin-left:auto 로 오른쪽 끝 밀착 (사용자 요청 2026-06-10) */
    return '<div class="dp-opt-card" data-dp-toggle="'+id+'" role="button" tabindex="0" aria-pressed="false" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid var(--bdr);border-radius:10px;background:var(--card);cursor:pointer;transition:all 0.18s ease;flex:1 1 0;min-width:0;min-height:62px;box-sizing:border-box;user-select:none">'
      +'<span class="dp-opt-card-icon" style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:var(--bg2);color:var(--t3);flex-shrink:0;transition:all 0.18s">'
        +'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+iconPath+'</svg>'
      +'</span>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:12.5px;font-weight:700;color:var(--t1);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(title)+'</div>'
        +'<div style="font-size:10.5px;color:var(--t3);margin-top:2px;line-height:1.4">'+escHtml(desc)+'</div>'
      +'</div>'
      +'<span class="dp-opt-switch" style="position:relative;display:inline-block;width:40px;height:22px;background:var(--bdr);border-radius:999px;transition:background 0.18s ease;flex-shrink:0;margin-left:auto">'
        +'<span class="dp-opt-switch-thumb" style="position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);transition:transform 0.18s ease"></span>'
      +'</span>'
      +'</div>';
  }
  h+='<div id="dpAddOptSection" style="padding:12px 24px 10px;border-bottom:1px solid var(--bdr);background:linear-gradient(180deg,rgba(99,102,241,0.04),rgba(99,102,241,0))">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
    +'<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:12px;font-weight:800">+</span>'
    +'<span style="font-size:13px;font-weight:800;color:var(--t1);letter-spacing:-0.2px">추가 옵션</span>'
    +'<span style="font-size:10px;color:var(--t3);font-weight:500">— 필요한 항목을 켜세요</span>'
    +'</div>';
  /* 추가 옵션 카드 — 2열 그리드 (오늘의 메모·진료과 표지·상담 표지·처치자별, 2026-06-25) */
  h+='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;align-items:stretch">';
  /* 오늘의 메모 — 매일 한 페이지 형식에서만 노출 (3번째 토글, 가장 왼쪽 — 사용자 요청 2026-06-10). _dpSwitchFormat 이 표시/숨김 제어 */
  h+=_dpOptCardHtml('dpOptTodayMemoPv','<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>','오늘의 메모','그 날짜의 오늘의 메모 표를 함께 인쇄');
  /* 진료과별 통계 표지 카드 — 2026-06-25 제거했다가 2026-08-12 사용자 요청으로 복원.
   * 방문자당 한 행·매일 한 페이지 = 전교 진료과별 통계 표지 / 특정 방문자 = 그 사람 전용 통계 표지.
   * 상담 내역 형식에서는 카드 숨김 + 렌더 조건에서도 제외 (복원 범위: row/daily/student 3형식). */
  h+=_dpOptCardHtml('dpOptCoverPv','<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>','진료과별 통계 표지','선택 기간의 진료과별 방문 통계를 표지 페이지로 포함');
  h+=_dpOptCardHtml('dpOptCounselPv','<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>','상담 주제별 통계 표지','중분류(상담 주제)별 상담 건수·총계 요약표');
  h+=_dpOptCardHtml('dpOptNursePv','<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>','처치자별 건수','보건교사 2인 배치 시 보건교사별 방문 수 합계를 표시');
  h+='</div>';
  /* 느린 이유 안내 — 최초 토글 시 수초 걸릴 수 있음 */
  h+='<div style="margin-top:8px;font-size:10px;color:var(--t3);line-height:1.5">💡 <b style="color:var(--t2)">처음 켤 때는 최대 수 초</b> 소요될 수 있습니다 — 선택 기간의 기록 전체를 SQLite 에서 집계(증상·진료과 매핑·학년 분류)하기 때문입니다. 한 번 로딩된 뒤에는 같은 기간 안에서 즉시 반응합니다.</div>';
  h+='</div>';
  /* ── 표시 항목 / 순서 — 별도 영역 (제목 크기는 추가 옵션과 동일) ── */
  h+='<div id="dpColsSection" style="padding:10px 24px 8px;border-bottom:1px solid var(--bdr);background:var(--bg2)">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--cyan);color:#fff;font-size:12px;font-weight:800">≡</span><span style="font-size:13px;font-weight:800;color:var(--t1);letter-spacing:-0.2px">표시 항목 · 순서</span><span style="font-size:10px;color:var(--t3);font-weight:500">— 드래그로 순서 변경, 눈 아이콘으로 표시/숨김, 숫자 입력 또는 마우스 휠 움직임으로 열 간격 조절 가능</span></div>';
  /* 표시 항목 칩은 한 줄에 모두 표시 — 폭이 부족하면 가로 스크롤로 대응 */
  h+='<div id="dpColsChipsPv" style="display:flex;flex-wrap:nowrap;gap:3px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px"></div>';
  h+='<div style="margin-top:4px;font-size:10.5px;font-weight:600;color:#2563eb">숫자 부분에 마우스 커서를 댄 후 마우스 휠로 수치 조정이 가능합니다.</div>';
  h+='</div>';
  /* 액션 버튼 바 */
  h+='<div style="display:flex;align-items:center;gap:8px;padding:12px 24px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(99,102,241,0.06),rgba(139,92,246,0.03))">';
  h+='<button id="dpPreviewBackBtn" style="padding:8px 16px;font-size:12px;font-weight:700;background:rgba(249,115,22,0.12);color:#ea580c;border:1px solid rgba(249,115,22,0.4);border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;animation:dpBackBlink 1.1s ease-in-out infinite">◀ 뒤로</button>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-left:8px">미리보기</div>';
  /* 로딩 점 애니메이션 + 안내 문구 — 두 포맷 모두에서 노출 (미리보기 실행 시 표시, 완료 시 숨김) */
  h+='<span id="dpDailySlowHint" style="font-size:11px;color:#dc2626;font-weight:600;margin-left:10px">'
    +'<span id="dpLoadingDots" style="display:none;color:#0891b2;margin-right:4px">로딩 중<span class="dp-dot1">.</span><span class="dp-dot2">.</span><span class="dp-dot3">.</span></span>'
    +'(데이터베이스 로딩에 시간이 걸릴 수 있습니다.)</span>'
    +'<style>@keyframes dpDotPulse{0%,20%{opacity:0.2}50%{opacity:1}100%{opacity:0.2}}'
    +'#dpLoadingDots .dp-dot1{animation:dpDotPulse 1.2s infinite;display:inline-block}'
    +'#dpLoadingDots .dp-dot2{animation:dpDotPulse 1.2s infinite;animation-delay:0.2s;display:inline-block}'
    +'#dpLoadingDots .dp-dot3{animation:dpDotPulse 1.2s infinite;animation-delay:0.4s;display:inline-block}</style>';
  h+='<span style="flex:1"></span>';
  /* 버튼 순서: PDF 저장 | Excel 저장 | 인쇄 (사용자 결정 2026-06-17). 구글 시트 버튼은 제거. */
  /* PDF — 미리보기 렌더 그대로. 편집은 못해도 셀 간격/폰트/페이지 나눔이 100% 동일 */
  h+='<button class="btn-pdf" id="dpSavePdf">📄 PDF 저장</button>';
  /* Excel — 미세격자 정렬 빌더 (exportDiaryExcel/_exportDailyExcel + main.js 빌더) */
  h+='<button class="btn btn-sm" id="dpSaveExcel" style="padding:8px 16px;font-size:11.5px;font-weight:700;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer">📊 Excel 저장</button>';
  /* 인쇄 — PDF 와 동일 HTML 을 응급기록지식 A4 인쇄 미리보기 다이얼로그(가로)로 출력 */
  h+='<button class="btn btn-sm" id="dpPrint" style="padding:8px 16px;font-size:11.5px;font-weight:700;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:6px;cursor:pointer">🖨 인쇄</button>';
  h+='</div>';
  h+='<div id="dpPreviewArea" style="flex:1;min-height:200px;margin:0;border:none;background:var(--bg2);padding:18px 24px;overflow-y:auto;scrollbar-width:thin"></div>';
  h+='</div>';

  h+='</div>'; /* modal-content end */
  overlay.innerHTML=h;
  document.body.appendChild(overlay);
  _makeDraggable(overlay.querySelector('.modal-content'));
  /* 이벤트 위임: data-action 기반 클릭 핸들러 */
  overlay.addEventListener('click',function(e){
    const actionEl=e.target.closest('[data-action]');
    if(!actionEl)return;
    const action=actionEl.dataset.action;
    const arg=actionEl.dataset.arg;
    if(action==='dpClose')closeModalGracefully('diaryPrintOverlay');
    else if(action==='dpOpenCal')dpOpenCal(arg);
    else if(action==='dpSwitchFormat')_dpSwitchFormat(arg);
    else if(action==='dpCounselMode'){ e.stopPropagation(); _dpSetCounselMode(arg); }
    else if(action==='dpPickStudent'){ /* 카드 안 picker area 클릭 — 대상 재선택 (사용자 요청 2026-05-28) */
      e.stopPropagation();
      /* 클릭 즉시 출력 형식을 '특정 방문자 내역'으로 전환(테두리 표시) — 사용자 요청 2026-06-10.
       * 대상 미선택이면 _dpSwitchFormat 이 picker 를 자동으로 열고, 이미 선택돼 있으면 변경용으로 직접 연다. */
      const _hadSel = !!_dpSelectedStudentId;
      _dpSwitchFormat('student');
      if(_hadSel) _dpOpenStudentPicker();
    }
    else if(action==='dpQuickRange')_dpQuickRange(arg);
    /* 전체 표시/숨김 액션 제거됨 — 카드별 눈 아이콘으로 개별 토글만 사용 */
  });
  /* 미리보기 버튼 */
  const mainBtn=document.getElementById('dpPreviewMainBtn');
  if(mainBtn){
    mainBtn.addEventListener('click',function(){
      /* 특정 방문자 형식인데 대상 미선택이면 미리보기 진행 금지 — 대신 대상 선택 팝업 안내. (사용자 요청 2026-06-16) */
      if(_dpFormat==='student' && !_dpSelectedStudentId){
        try{ bus.emit('toast:show',{text:'대상(사람)을 먼저 선택해 주세요.'}); }catch(_){}
        _dpOpenStudentPicker();
        return;
      }
      /* 미리보기 실행 = 사용자가 '지금의 데이터'를 명시적으로 요청한 순간 → 항상 DB 재조회.
       * 같은 기간을 다시 미리보기해도 그 사이 추가된 방문(협업 다른 보건교사·키오스크 접수 등)을
       * 놓치지 않도록 모듈 캐시를 비운다. 열 토글 등 재렌더는 여전히 캐시 재사용(속도) (2026-07-06). */
      _dpCache=null; _dpDailyDataCache=null;
      /* 미리보기 모드 전환: 설정 영역 숨김 + 미리보기 패널 노출 */
      _dpEnterPreviewMode();
      if(_dpFormat==='counsel' && _dpCounselMode==='individual') _dpShowCounselIndividualPreview();
      else if(_dpFormat==='daily') dpShowDailyPreview();
      else dpShowPreview();
    });
  }
  /* 뒤로 버튼 — 설정 모드로 복귀 */
  const backBtn=document.getElementById('dpPreviewBackBtn');
  if(backBtn){
    backBtn.addEventListener('click',function(){_dpExitPreviewMode();});
  }
  /* 미리보기 옵션 토글 — div 카드형 스위치 (aria-pressed 가 상태 원천) */
  function _dpApplyToggleSwitchVisual(card,on){
    const sw=card&&card.querySelector('.dp-opt-switch');
    const thumb=sw&&sw.querySelector('.dp-opt-switch-thumb');
    const iconBox=card&&card.querySelector('.dp-opt-card-icon');
    if(on){
      if(sw){sw.style.background='linear-gradient(135deg,#6366f1,#8b5cf6)';}
      if(thumb)thumb.style.transform='translateX(18px)';
      if(card){card.style.borderColor='#6366f1';card.style.background='linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.04))';card.style.boxShadow='0 1px 4px rgba(99,102,241,0.15)';}
      if(iconBox){iconBox.style.background='linear-gradient(135deg,#6366f1,#8b5cf6)';iconBox.style.color='#fff';}
    } else {
      if(sw)sw.style.background='var(--bdr)';
      if(thumb)thumb.style.transform='translateX(0)';
      if(card){card.style.borderColor='var(--bdr)';card.style.background='var(--card)';card.style.boxShadow='none';}
      if(iconBox){iconBox.style.background='var(--bg2)';iconBox.style.color='var(--t3)';}
    }
  }
  /* 카드 클릭 → 마스터 체크박스(dpOptCover/dpOptNurse) 에 상태 쓰기 + 미리보기 재렌더 */
  document.querySelectorAll('.dp-opt-card[data-dp-toggle]').forEach(function(card){
    const masterId=(card.dataset.dpToggle||'').replace('Pv','');
    const master=document.getElementById(masterId);
    /* 초기 상태 */
    const initOn=!!(master&&master.checked);
    card.setAttribute('aria-pressed',initOn?'true':'false');
    _dpApplyToggleSwitchVisual(card,initOn);
    function _toggle(){
      const on=card.getAttribute('aria-pressed')!=='true';
      card.setAttribute('aria-pressed',on?'true':'false');
      if(master)master.checked=on;
      _dpApplyToggleSwitchVisual(card,on);
      if(_dpFormat==='counsel' && _dpCounselMode==='individual') _dpShowCounselIndividualPreview();
      else if(_dpFormat==='daily')dpShowDailyPreview();
      else dpShowPreview();
    }
    card.addEventListener('click',_toggle);
    card.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();_toggle();}});
  });
  /* 오늘의 메모·처치자별 건수 카드 초기 표시 — 매일 한 페이지에서만 노출 (팝업 기본 형식 row 는 숨김, 2026-06-10) */
  (function(){
    /* display 복원은 'flex' 로 — '' 로 두면 인라인 display:flex 가 사라져 카드 내부가 세로로 쌓이며
       토글이 아래·왼쪽으로 내려가는 레이아웃 붕괴 발생 (사용자 보고 2026-06-11) */
    const _tm0=document.querySelector('.dp-opt-card[data-dp-toggle="dpOptTodayMemoPv"]');
    if(_tm0)_tm0.style.display=(_dpFormat==='daily')?'flex':'none';
    const _nu0=document.querySelector('.dp-opt-card[data-dp-toggle="dpOptNursePv"]');
    if(_nu0)_nu0.style.display=(_dpFormat==='daily')?'flex':'none';
    /* 진료과별 통계 표지 — row/daily/student 에서만 (상담 내역 형식 제외, 복원 2026-08-12) */
    const _cv0=document.querySelector('.dp-opt-card[data-dp-toggle="dpOptCoverPv"]');
    if(_cv0)_cv0.style.display=(_dpFormat!=='counsel')?'flex':'none';
  })();
  /* 엑셀 저장 */
  const xlsBtn=document.getElementById('dpSaveExcel');
  if(xlsBtn)xlsBtn.addEventListener('click',function(){exportDiaryExcel();});
  /* 구글 시트로 보내기 — 버튼·기능 제거 (사용자 결정 2026-06-17). exportDiarySheets 함수는 미사용. */
  /* PDF 저장 — 미리보기 그대로 */
  const pdfBtn=document.getElementById('dpSavePdf');
  if(pdfBtn)pdfBtn.addEventListener('click',function(){exportDiaryPreviewPDF();});
  /* 인쇄 — PDF 와 동일 HTML 을 A4 가로 인쇄 미리보기 다이얼로그로 (2026-06-15) */
  const printBtn=document.getElementById('dpPrint');
  if(printBtn)printBtn.addEventListener('click',function(){printDiaryPreview();});
  /* 방문 통계 버튼 제거됨 — 진료과별 통계는 토글 옵션으로 출력물에 포함 */
  _dpLoadUserWidths();   /* 사용자 열 너비 로드 (2026-06-11) */
  dpColOrder=DP_COLS.map(function(c){return c.col;});
  dpColVis={};DP_COLS.forEach(function(c){dpColVis[c.col]=true;});dpColVis.bodymap=false; /* 부위(바디맵) 는 기본 OFF (사용자 요청 2026-06-11) */
  dpColHistory=[];
  const dcv=JSON.parse(localStorage.getItem('dailyColVisibility')||'null');
  if(dcv){
    const colToPrint={5:'gender',6:'symptoms',8:'treatment',13:'nurse'};   /* 9:'medication'·12:'vitals' 제거 — 투약(2026-06-10)·V/S(2026-07-21) 인쇄 컬럼 폐지 */
    Object.keys(colToPrint).forEach(function(k){if(dcv[k]===false)dpColVis[colToPrint[k]]=false;});
    if(dcv[10]===false&&dcv[11]===false)dpColVis['time']=false;
  }
  dpRenderCards();
  function dpKeyHandler(e){if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();dpUndoCol();}}
  document.addEventListener('keydown',dpKeyHandler);
  /* 외부 클릭으로 닫기 — mousedown 시점에 target 이 overlay 자체일 때만 닫음.
     (click 만 사용하면 드래그 후 버블된 click 으로 오작동, mousedown 이 더 안정적) */
  function _dpOutsideClose(e){
    if(e.target!==overlay)return;
    document.removeEventListener('keydown',dpKeyHandler);
    closeModalWithAnim(overlay);
  }
  overlay.addEventListener('mousedown',_dpOutsideClose);
}

/* ── 특정 학생 내역: 학생/교직원 선택 팝업 + 카드 안 표시 영역 갱신 (사용자 요청 2026-05-28) ── */
function _dpOpenStudentPicker(){
  openPersonSearch({
    title:'🔎 보건일지 출력 — 대상 선택',
    type:'student',
    allowStaff:true,
    overlayId:'dpStudentSearchOverlay',
    onPick: function(id){
      _dpSelectedStudentId = id;
      /* 사람을 선택했으면 형식도 '특정 방문자 내역'으로 강제 전환 — 탭이 '방문자당 한 행'에 남는 문제 fix (사용자 보고 2026-06-10).
       * _dpSelectedStudentId 가 이미 설정돼 있어 picker 재호출 없음. */
      _dpSwitchFormat('student');
      _dpRefreshStudentCard();
      /* 미리보기 모드면 즉시 다시 그림 */
      const previewPanel=document.getElementById('dpPreviewPanel');
      if(previewPanel && previewPanel.style.display==='flex'){
        if(_dpFormat==='daily') dpShowDailyPreview(); else dpShowPreview();
      }
    }
  });
}
function _dpRefreshStudentCard(){
  const area=document.getElementById('dpStudentPickArea');
  if(!area) return;
  if(!_dpSelectedStudentId){
    area.style.color='var(--t3)';
    area.style.borderStyle='dashed';
    area.style.background='var(--bg2)';
    area.textContent='클릭하여 대상을 선택하세요';
    return;
  }
  const stu = getStu(_dpSelectedStudentId);
  if(!stu){
    /* 명단에 없는 (삭제된) 대상 — id 만 표시 */
    area.style.color='var(--t2)';
    area.style.borderStyle='solid';
    area.style.background='rgba(6,182,212,0.06)';
    area.innerHTML='<span style="font-weight:700;color:var(--t1)">선택: '+(_dpSelectedStudentId||'-')+'</span> <span style="font-size:9.5px;color:var(--t3)">(명단에 없음)</span><span style="float:right;color:var(--cyan)">변경 ▸</span>';
    return;
  }
  const isStf=stu.type==='staff';
  const info = isStf ? (stu.position||'교직원') : (stu.grade+'-'+stu.cls+' '+stu.num+'번');
  area.style.color='var(--t1)';
  area.style.borderStyle='solid';
  area.style.background='rgba(6,182,212,0.08)';
  area.style.borderColor='rgba(6,182,212,0.3)';
  area.innerHTML='<span style="font-weight:700">'+escHtmlDp(stu.name||'-')+'</span> <span style="font-size:9.5px;color:var(--t3)">· '+escHtmlDp(info)+'</span><span style="float:right;color:var(--cyan);font-size:10px">변경 ▸</span>';
}
function escHtmlDp(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

/* ── 출력 형식 탭 전환 (큰 카드 스타일) ── */
function _dpSwitchFormat(fmt){
  _dpFormat=fmt;
  const tabR=document.getElementById('dpTabRow');
  const tabD=document.getElementById('dpTabDaily');
  const tabS=document.getElementById('dpTabStudent');
  const ckR=document.getElementById('dpTabRowCheck');
  const ckD=document.getElementById('dpTabDailyCheck');
  const ckS=document.getElementById('dpTabStudentCheck');
  if(tabR){
    if(fmt==='row'){tabR.style.border='2px solid var(--cyan)';tabR.style.background='rgba(6,182,212,0.06)';if(ckR)ckR.style.display='';}
    else{tabR.style.border='2px solid var(--bdr)';tabR.style.background='var(--card)';if(ckR)ckR.style.display='none';}
  }
  if(tabD){
    if(fmt==='daily'){tabD.style.border='2px solid var(--cyan)';tabD.style.background='rgba(6,182,212,0.06)';if(ckD)ckD.style.display='';}
    else{tabD.style.border='2px solid var(--bdr)';tabD.style.background='var(--card)';if(ckD)ckD.style.display='none';}
  }
  if(tabS){
    if(fmt==='student'){tabS.style.border='2px solid var(--cyan)';tabS.style.background='rgba(6,182,212,0.06)';if(ckS)ckS.style.display='';}
    else{tabS.style.border='2px solid var(--bdr)';tabS.style.background='var(--card)';if(ckS)ckS.style.display='none';}
  }
  /* 상담 내역 탭 + 하위 모드 영역(보건일지 형식/개별 양식) 표시 (2026-06-25) */
  const tabC=document.getElementById('dpTabCounsel');
  const ckC=document.getElementById('dpTabCounselCheck');
  const cmArea=document.getElementById('dpCounselModeArea');
  if(tabC){
    if(fmt==='counsel'){tabC.style.border='2px solid var(--cyan)';tabC.style.background='rgba(6,182,212,0.06)';if(ckC)ckC.style.display='';}
    else{tabC.style.border='2px solid var(--bdr)';tabC.style.background='var(--card)';if(ckC)ckC.style.display='none';}
  }
  /* 하위 모드(보건일지 형식/개별 양식)는 상담 선택 전에도 항상 표시 (사용자 요청 2026-06-25) */
  if(cmArea)cmArea.style.display='flex';
  /* 오늘의 메모·처치자별 건수 카드 — 매일 한 페이지 형식에서만 노출.
   * (처치자별 건수는 날짜별 합계줄이라 daily 전용 — row/student 에선 ON/OFF 무차이라 숨김, 2026-06-10) */
  const _tmCard=document.querySelector('.dp-opt-card[data-dp-toggle="dpOptTodayMemoPv"]');
  if(_tmCard)_tmCard.style.display=(fmt==='daily')?'flex':'none';   /* '' 복원 금지 — display:flex 인라인이 사라져 토글이 아래로 떨어짐 */
  const _nuCard=document.querySelector('.dp-opt-card[data-dp-toggle="dpOptNursePv"]');
  if(_nuCard)_nuCard.style.display=(fmt==='daily')?'flex':'none';
  /* 진료과별 통계 표지 — row/daily/student 3형식에서만 노출 (상담 내역 제외, 복원 2026-08-12) */
  const _cvCard=document.querySelector('.dp-opt-card[data-dp-toggle="dpOptCoverPv"]');
  if(_cvCard)_cvCard.style.display=(fmt!=='counsel')?'flex':'none';
  /* 'student' 선택 시 — 아직 선택된 학생 없으면 학생 검색 팝업 자동 호출 (사용자 결정 2026-05-28). */
  if(fmt==='student' && !_dpSelectedStudentId){
    _dpOpenStudentPicker();
  }
  /* 포맷 스위치는 안내 문구 표시 여부에 영향 없음 — 두 포맷 모두 노출 */
  /* 칩 카드 렌더도 다시 해서 '날짜' 잠금 시각(🚫) 반영 */
  if(typeof dpRenderCards==='function')dpRenderCards();
  /* 개별 양식이면 추가옵션·표시항목 섹션 숨김 (상담기록지 자체 출력이라 불필요) */
  _dpUpdateOptionVisibility();
  /* 형식 전환 시 미리보기 버튼 활성/비활성 갱신 — 특정 방문자 대상 미선택이면 비활성. (2026-06-16) */
  _dpCheckBtnState();
}
/* 상담 내역 하위 모드 전환 — 'diary'(보건일지 형식) / 'individual'(개별 양식) (사용자 요청 2026-06-25) */
function _dpSetCounselMode(mode){
  _dpCounselMode=(mode==='individual')?'individual':'diary';
  if(_dpFormat!=='counsel')_dpSwitchFormat('counsel');
  /* 선택 버튼 강조 */
  const bD=document.getElementById('dpCounselModeDiary'), bI=document.getElementById('dpCounselModeIndiv');
  const _on=function(b){ if(!b)return; b.style.border='1.5px solid var(--cyan)'; b.style.background='rgba(6,182,212,0.08)'; b.style.color='var(--cyan)'; };
  const _off=function(b){ if(!b)return; b.style.border='1.5px solid var(--bdr)'; b.style.background='var(--bg2)'; b.style.color='var(--t1)'; };
  if(_dpCounselMode==='individual'){ _on(bI); _off(bD); } else { _on(bD); _off(bI); }
  _dpUpdateOptionVisibility();
  /* 미리보기 모드면 즉시 다시 그림 */
  const previewPanel=document.getElementById('dpPreviewPanel');
  if(previewPanel && previewPanel.style.display==='flex'){
    if(_dpFormat==='counsel' && _dpCounselMode==='individual') _dpShowCounselIndividualPreview();
    else dpShowPreview();
  }
}
/* 개별 양식(상담기록지) 모드에서는 추가옵션·표시항목 섹션 숨김. 그 외엔 표시. */
function _dpUpdateOptionVisibility(){
  const indiv=(_dpFormat==='counsel' && _dpCounselMode==='individual');
  /* 개별 양식도 추가옵션 섹션은 노출 — 상담 주제별 통계 표지 토글이 보여야 함 (사용자 요청 2026-06-25).
   *  오늘의 메모·처치자별 카드는 _dpSwitchFormat 에서 daily 전용으로 이미 숨김 → 개별 양식엔 상담 표지 토글만 노출. */
  const a=document.getElementById('dpAddOptSection'); if(a)a.style.display='';
  const c=document.getElementById('dpColsSection'); if(c)c.style.display=indiv?'none':'';
}

/* ── 매일 한 페이지 형식 미리보기 — 각 날짜 페이지마다 "우리 앱의 방문 통계" 섹션 + 방문 리스트 ── */
/* 열 너비 휠 조절 등 데이터가 안 변한 리렌더용 캐시 — { from, to, filtered, dayStatsMap } */
let _dpDailyDataCache=null;
async function dpShowDailyPreview(opts){
  opts=opts||{};
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  if(!from||!to){alert('날짜를 선택하세요.');return;}
  /* reuse: 같은 기간 데이터 캐시 재사용 (열 너비 변경 리렌더 — DB 재조회·로딩 표시 불필요, 2026-06-11) */
  const _canReuse=opts.reuse && _dpDailyDataCache && _dpDailyDataCache.from===from && _dpDailyDataCache.to===to;
  /* 로딩 점 애니메이션 표시 — silent(캐시 리렌더) 면 깜빡임 없이 */
  const _loadingDots=document.getElementById('dpLoadingDots');
  if(_loadingDots && !opts.silent)_loadingDots.style.display='inline';
  let filtered=[];
  if(_canReuse){
    filtered=_dpDailyDataCache.filtered;
  } else {
    try{
      const res=await window.electronAPI.recordsDailyByDateRange(from,to);
      filtered=_dpReconcileWithMemory((res&&res.success)?(res.data||[]):[],from,to);
    }catch(e){filtered=S.records.filter(function(r){return r.date>=from&&r.date<=to;}).sort(function(a,b){return a.date.localeCompare(b.date)||a.timeIn.localeCompare(b.timeIn);});}
  }
  const area=document.getElementById('dpPreviewArea');
  if(!filtered.length){
    area.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">해당 기간에 기록이 없습니다.</div>';
    area.style.display='block';
    if(_loadingDots)_loadingDots.style.display='none';
    return;
  }

  const schoolName=(S.settings&&S.settings.schoolName)||'';
  const _lvShort={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};

  /* 오늘의 메모 데이터 선로드 — tmGetPrintBlock(동기)이 빈 값을 돌려주지 않도록 */
  try{ await tmEnsureLoaded(); }catch(_){}

  /* 날짜별 그룹 */
  const byDate={};
  filtered.forEach(function(r){if(!byDate[r.date])byDate[r.date]=[];byDate[r.date].push(r);});
  const dates=Object.keys(byDate).sort();

  /* 각 날짜별 통계 섹션을 방문 통계와 동일한 포맷으로 병렬 로딩 (reuse 시 캐시) */
  let dayStatsMap={};
  if(_canReuse){
    dayStatsMap=_dpDailyDataCache.dayStatsMap||{};
  } else {
    await Promise.all(dates.map(async function(dt){
      try{
        const { buildDeptStatsSections } = await import('./diary-print-cover.js');
        dayStatsMap[dt]=await buildDeptStatsSections(dt,dt);
      }catch(e){dayStatsMap[dt]=null;}
    }));
    _dpDailyDataCache={from:from,to:to,filtered:filtered,dayStatsMap:dayStatsMap};
  }

  /* 표지 포함 옵션 — 진료과별 통계 (별도 모듈) */
  const _coverOpt2=document.getElementById('dpOptCover');
  let html='';
  if(_coverOpt2&&_coverOpt2.checked){
    /* 진료과별 통계 표지 — 단독 페이지(2페이지)로, 본문은 그 다음 페이지부터 (사용자 요청 2026-06-16) */
    try{const _cv=await buildDeptStatsCover(from,to);html=_cv?('<div style="page-break-after:always;break-after:page">'+_cv+'</div>'):'';}catch(e){html='';}
  }
  /* 상담 주제별 통계 표지 — 진료과 표지 다음 단독 페이지 (사용자 요청 2026-06-25) */
  const _counselOpt2=document.getElementById('dpOptCounsel');
  if(_counselOpt2&&_counselOpt2.checked){
    try{const _cc=await buildCounselStatsCover(from,to);if(_cc)html+='<div style="page-break-after:always;break-after:page">'+_cc+'</div>';}catch(e){}
  }

  function _renderStatSection(title,section,cyan){
    if(!section||!section.header)return '';
    /* 셀 인라인 스타일(옛 cellStyle/headStyle) → dpx- 클래스 (경량화 2026-08-12).
     * 날짜당 통계 3섹션 ≈ 15~18KB → 2~3KB. 선언은 _DPX_CSS 에 동일 보존.
     * cyan 인자는 현재 호출자 없음 — 전달되면 span 인라인으로만 덮어씀(옛 동작 보존). */
    let s='<div class="dpx-st"><span'+(cyan?' style="background:linear-gradient(180deg,'+cyan+',#0891b2)"':'')+'></span>'+title+'</div>';
    s+='<div class="dpx-box"><table class="dpx-tbl">';
    s+='<thead><tr>';section.header.forEach(function(h,i){s+='<th class="dpx-sc'+(i===section.header.length-1?' dpx-cy':'')+'">'+h+'</th>';});
    s+='</tr></thead><tbody>';
    (section.rows||[]).forEach(function(row){
      s+='<tr>';
      row.forEach(function(cell,i){
        const muted=(typeof cell==='number'&&cell===0)?' dpx-mut':'';   /* dpx-mut 는 CSS 에서 dpx-cy 뒤 — 0값 회색 우선(옛 선언 순서) */
        s+='<td class="dpx-sc'+(i===0?' dpx-b7':'')+(i===row.length-1?' dpx-b8 dpx-cy':'')+muted+'">'+cell+'</td>';
      });
      s+='</tr>';
    });
    if(section.totalsRow){
      s+='<tr class="dpx-tot">';
      section.totalsRow.forEach(function(cell,i){
        s+='<td class="dpx-sc dpx-b8'+(i===0?' dpx-tc':'')+(i===section.totalsRow.length-1?' dpx-cy dpx-ts':'')+'">'+cell+'</td>';
      });
      s+='</tr>';
    }
    s+='</tbody></table></div>';
    return s;
  }

  dates.forEach(function(dt,di){
    const dayRecs=byDate[dt];
    function fmtD(ds){const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 ('+dow+')';}

    /* 상단 요약 */
    let stuCnt=0, staffCnt=0;
    const nurseCounts={};
    dayRecs.forEach(function(r){
      const s=getStu(r.personUid);
      const isStaff=(r.personType||'student')==='staff'||(s&&s.type==='staff');
      if(isStaff)staffCnt++;else stuCnt++;
      const nm=r.nurse||'미지정';nurseCounts[nm]=(nurseCounts[nm]||0)+1;
    });
    const nurseLine=Object.keys(nurseCounts).map(function(n){return n+' '+nurseCounts[n]+'명';}).join(' · ');
    const showNurse=document.getElementById('dpOptNurse')&&document.getElementById('dpOptNurse').checked;

    /* 날짜가 바뀌면 반드시 새 페이지 맨 위에서 시작 — 점선 구분선은 이전 페이지 끝에 남기고
       페이지 나눔 div 는 빈 채로 분리(새 페이지 상단에 점선이 찍히지 않게). (사용자 요청 2026-06-11) */
    if(di>0){
      html+='<div style="border-top:2px dashed var(--bdr);margin:20px 0 0"></div>';
      html+='<div style="page-break-before:always"></div>';
    }
    /* ── 일자 헤더 — '보건일지' 제목·학교명은 문서 상단과 중복이라 제거, 날짜(페이지 식별용)+방문자 수만 (사용자 요청 2026-06-11) ── */
    /* 날짜마다 반복되는 인라인 스타일 → dpx- 클래스 (경량화 2026-08-12) */
    html+='<div class="dpx-dh">';
    html+='<div class="dpx-dh-date">'+fmtD(dt)+'</div>';
    html+='<div class="dpx-dh-r">'
      +'<div class="dpx-dh-l1">방문자 수</div>'
      +'<div class="dpx-dh-n">'+dayRecs.length+'<span>명</span></div>'
      +'<div class="dpx-dh-l2">학생 '+stuCnt+' · 교직원 '+staffCnt+'</div>'
      +'</div>';
    html+='</div>';
    if(showNurse&&nurseLine){
      html+='<div class="dpx-nl">👤 처치자: '+escHtml(nurseLine)+'</div>';
    }

    /* ── 오늘의 메모 — 추가 옵션 토글(dpOptTodayMemo, 기본 ON) + 그 날짜에 내용이 있으면 함께 인쇄 (사용자 요청 2026-06-10) ── */
    try{
      const _tmOptEl=document.getElementById('dpOptTodayMemo');
      const _tmBlk=(!_tmOptEl||_tmOptEl.checked)?tmGetPrintBlock(dt):'';
      if(_tmBlk){
        html+='<div class="dpx-sh"><span class="dpx-ico dpx-ico-memo">📝</span>오늘의 메모</div>'+_tmBlk;
      }
    }catch(_){}

    /* ── 방문 통계 (우리 앱의 '방문 통계'와 동일한 3섹션 구조) ── */
    const dayStats=dayStatsMap[dt];
    if(dayStats&&dayStats.sections&&dayStats.sections.length){
      html+='<div class="dpx-sh"><span class="dpx-ico dpx-ico-stat">📊</span>일간 방문 통계</div>';
      dayStats.sections.forEach(function(sec){html+=_renderStatSection(sec.title,sec);});
    }

    /* ── 방문 리스트 — 표시 항목/순서의 dpColOrder 를 그대로 사용
       (단, 'date' 는 매일 한 페이지에서는 자동 제외 — 페이지 자체가 날짜) ── */
    html+='<div class="dpx-sh dpx-sh-d"><span class="dpx-ico dpx-ico-detail">📝</span>방문 상세</div>';
    /* white-space: pre-line — 다중 증상 record 의 증상·처치 셀 내부 newline 을 시각 행으로 렌더 (v3+ 사용자 결정 2026-05-20) */
    /* 글자 11pt 통일 (사용자 결정 2026-06-11) — 미리보기·PDF 동일 */
    /* 옛 tCell/tHead 인라인 스타일 → dpx-dc 클래스 (경량화 2026-08-12) — 선언은 _DPX_CSS 에 동일 보존 */
    const _activeDailyCols=dpColOrder.filter(function(c){return c!=='date'&&dpColVis[c]!==false;});
    /* 매일 한 페이지 = A4 가로 전제. 증상/처치/투약은 min-width 크게 잡아 자동 확장 */
    /* 기본 너비는 DP_W_DAILY(모듈) — 사용자 조절값(_dpEffW) 우선 (2026-06-11) */
    area._dpDailyCols=_activeDailyCols.slice();
    /* ── 빈 여백 채우기 (사용자 요청 2026-06-16) — 눈 OFF 로 열을 끄면 표가 좌측으로 쪼그라들어
     *  우측에 회색 여백이 남는다. A4 가로 가용폭에 못 미치는 만큼을 증상·처치(·투약) 열에 비례
     *  배분해 표가 폭을 꽉 채우게 한다(사용자가 직접 넓혀 이미 꽉 차면 그대로 둠). 시간 열은
     *  'HH:MM ~ HH:MM' 가 한 줄에 들어가도록 최소폭을 보장한다. ── */
    const _ddW={}; _activeDailyCols.forEach(function(c){ _ddW[c]=_dpEffW(c)||110; });
    if(_ddW.time!=null) _ddW.time=Math.max(_ddW.time,120);
    (function(){
      const TARGET=1028;   /* A4 가로 12mm 여백 가용폭(px) — _dpBuildPrintDocHtml 와 동일 기준, 테두리 여유분 차감 */
      const _sum=_activeDailyCols.reduce(function(a,c){return a+_ddW[c];},0);
      const _gap=TARGET-_sum;
      if(_gap>2){
        const _grow=['symptoms','treatment','medication'].filter(function(c){return _ddW[c]!=null;});
        if(_grow.length){
          const _base=_grow.reduce(function(a,c){return a+_ddW[c];},0)||1;
          let _used=0;
          _grow.forEach(function(c,i){
            const _add=(i===_grow.length-1)?(_gap-_used):Math.round(_gap*(_ddW[c]/_base));
            _ddW[c]+=_add; _used+=_add;
          });
        }
      }
    })();
    const _ddEffW=function(c){ return _ddW[c]!=null?_ddW[c]:(_dpEffW(c)||110); };
    /* 절대 px 모드 (2026-06-11) — colgroup + fixed + width:auto → 칩의 px 수치가 그대로 실제 열 폭 (위 여백 채움 반영) */
    let _ddColgroup='<colgroup>';
    _activeDailyCols.forEach(function(c){ const w=_ddEffW(c); _ddColgroup+='<col style="width:'+w+'px" width="'+w+'">'; });
    _ddColgroup+='</colgroup>';
    html+='<div style="border:1px solid #cbd5e1;border-radius:6px"><table class="dp-daily-detail" style="width:auto;border-collapse:collapse;table-layout:fixed">'+_ddColgroup;
    html+='<thead><tr>';
    _activeDailyCols.forEach(function(c){
      const info=DP_COLS.find(function(dc){return dc.col===c;});if(!info)return;
      const w=_ddEffW(c);   /* 사용자 열 너비 우선 + 여백 채움 (2026-06-16) — 폭만 인라인 유지(_dpOnWidthChanged 라이브 패치 대상) */
      html+='<th class="dpx-dc"'+(w?' style="width:'+w+'px"':'')+'>'+escHtml(DP_PRINT_LABELS[c]||info.label)+'</th>';
    });
    html+='</tr></thead><tbody>';
    dayRecs.forEach(function(r,ri){
      const s=getStu(r.personUid)||{name:r.personName||'',grade:r.studentGrade||0,cls:r.studentClass||0,num:r.studentNum||0,type:r.personType||'student',gender:r.studentGender||'',position:r.staffPosition||'',level:r.studentLevel||'',department:r.studentDepartment||''};
      const isStaff=s.type==='staff';
      const gradeCol=_dpGradeCol(s);
      const numCol=isStaff?'':(s.num||'');
      let _g=(s&&s.gender)||'';if(_g==='M')_g='남';else if(_g==='F')_g='여';
      const cellData={
        seq:ri+1,
        schoolLevel:isStaff?'-':(_lvShort[s.level]||s.level||'-'),
        department:isStaff?'-':(s.department||'-'),
        gradeClass:gradeCol,
        num:numCol,
        name:s.name||'-',
        time:r.timeIn+(r.timeOut?' ~ '+r.timeOut:''),
        gender:_g||'',
        nurse:r.nurse||'-',
        bodymap:(function(){
          var _bm=(window._bmData||{})[r.id]||[];
          var _ls=[];_bm.forEach(function(mm){if(mm&&mm.label&&_ls.indexOf(mm.label)===-1)_ls.push(mm.label);});
          return _ls.join(', ')||'-';
        })(),
        symptoms:(function(){
        /* 부위(바디맵 마커) 동적 부착 — DB 라벨에 부위가 누락되어 있어도 출력 시 항상 표시 (사용자 보고 2026-05-19) */
        var _arr=(r.symptoms||[]);
        var _bm=(typeof window!=='undefined' && window._bmData) ? (window._bmData[r.id]||[]) : [];
        var _composed=_arr.map(function(_s){
          var _m=String(_s).match(/^(.+?)\s*\((.*)\)\s*$/);
          var _base=_m?_m[1].trim():String(_s);
          var _ins=_m?_m[2]:'';
          var _parts=_bm.filter(function(mm){return mm && mm.symptom===_base;}).map(function(mm){return mm.label;}).filter(Boolean);
          var _missing=_parts.filter(function(p){return _ins.indexOf(p)===-1;});
          if(_missing.length===0)return _s;
          var _newIns=[_missing.join(', '), _ins].filter(Boolean).join(', ');
          return _base+'('+_newIns+')';
        });
        /* 다중 증상 + treatmentBySym 있음 → 줄바꿈으로 행 분리 (v3+ 사용자 결정 2026-05-20) */
        var _hasBySym = r.treatmentBySym && typeof r.treatmentBySym==='object' && !Array.isArray(r.treatmentBySym) && Object.keys(r.treatmentBySym).length>0;
        var _isMulti = _arr.length>1 && _hasBySym && r.treatmentBranched !== false; /* 미분기면 콤마 한 줄(2026-06-09) */
        return _composed.join(_isMulti?'\n':', ');
      })(),
        /* 처치 칩 + 약품(medication) + 자유 서술형 메모 (daily-view 와 동일 규칙).
           '투약' 칩에 medication 결합, 옛 기록(medication 만 있는 경우)도 약품 별도 표시.
           다중 증상 + treatmentBySym 있으면 증상별로 줄바꿈 분층 (v3+ 사용자 결정 2026-05-20). */
        treatment:(function(){
          var arr=(r.treatment||[]);
          var medDisp=r.medication?formatMedicationDisplay(r.medication):'';
          var m=r.treatmentMemo||'';
          var _hasBySym = r.treatmentBySym && typeof r.treatmentBySym==='object' && !Array.isArray(r.treatmentBySym) && Object.keys(r.treatmentBySym).length>0;
          /* 증상 2개 이상이면 분기 출력 — 옛 일지/외부 import(평면만) 는 단일 행 유지 (사용자 결정 2026-05-28). */
          var _isLegacyFlat = !_hasBySym && arr.length>0;
          var _isMulti = r.symptoms && r.symptoms.length>1 && !_isLegacyFlat && r.treatmentBranched !== false; /* 미분기면 콤마 한 줄 — flat r.treatment 사용 (다른 형식과 동일, 2026-07-06 누락분 보정) */
          if(_isMulti){
            /* v3 (2026-05-28) — V/S·침상도 per-symptom. 각 증상 행에 그 증상 처치만 (record-level 공유 폐지). */
            var _medDispForSym = function(sym){
              if(!r.medsBySym || !r.medsBySym[sym] || !r.medsBySym[sym].length) return '';
              var dm = (r.medDosesBySym && r.medDosesBySym[sym]) || {};
              var str = r.medsBySym[sym].map(function(mm){var d=dm[mm]||''; return d?(mm+'('+d+')'):mm;}).join(', ');
              return formatMedicationDisplay(str);
            };
            /* 상담 처치란 문구 — 맵에 없고 flat 에만 있으므로 상담 층에 직접 합류 (사용자 보고 2026-08-25) */
            var _clT3=counselTreatText(r);
            var _clIdx3=_clT3?r.symptoms.findIndex(isCounselSymLabel):-1;
            var lines = r.symptoms.map(function(sym, idx){
              var symTreats = (r.treatmentBySym[sym]||[]);
              var medDispForSym = _medDispForSym(sym);
              var symLabeled = symTreats.map(function(t){
                var b=t; var mt=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(mt)b=mt[1].trim();
                if(b==='투약' && medDispForSym) return medDispForSym;
                return t;
              });
              if(idx===_clIdx3)symLabeled.push(_clT3);
              return '→ '+symLabeled.join(', ');
            });
            if(m) lines[0] = (lines[0]?lines[0]+' / ':'')+m;
            return lines.join('\n');
          }
          /* 단일 증상 또는 옛 일지 — 기존 로직 */
          var labeled=arr.map(function(t){return (t==='투약'&&medDisp)?medDisp:t;});
          var b=labeled.join(', ');
          var hasMedTreat=arr.indexOf('투약')!==-1;
          if(!hasMedTreat&&medDisp) b=(b?b+' / ':'')+medDisp;
          return (b+(m?(b?' / ':'')+m:'')).trim();
        })(),
        medication:r.medication||'',
        bedUsage:_dpIsBedUsed(r)?'O':'',
        vitals:[r.temp?'T: '+r.temp:'',r.bp?'BP: '+r.bp:'',r.pulse?'P: '+r.pulse:'',(r.respiration||r.resp)?'R: '+(r.respiration||r.resp):'',r.spo2?'SpO₂: '+r.spo2:'',r.bst?'BST: '+r.bst:''].filter(Boolean).join(', ')
      };
      const centerCols={seq:1,schoolLevel:1,department:1,gradeClass:1,num:1,name:1,gender:1,bedUsage:1,time:1,nurse:1};   /* name 가운데 정렬 (사용자 요청 2026-06-11) */
      html+='<tr>';
      _activeDailyCols.forEach(function(c){
        const v=cellData[c];
        const cls='dpx-dc'
          +(centerCols[c]?' dpx-c':'')
          +((c==='name')?' dpx-bold':'')
          +((c==='seq')?' dpx-seq':'')
          +((c==='time')?' dpx-nw':'');   /* 시간 'HH:MM ~ HH:MM' 한 줄 (사용자 요청 2026-06-16) */
        html+='<td class="'+cls+'">'+escHtml(String(v==null||v===''?'-':v))+'</td>';
      });
      html+='</tr>';
      /* ── V/S 값이 있으면 처치 칸 자리에 표로 인쇄 (항상 표 형식, 단일 측정도 1행 표). 2026-07-21 ── */
      {
        const _vsTbl=_dpVsTsTableHtml(r);
        if(_vsTbl){
          const _trtIdx=_activeDailyCols.indexOf('treatment');
          html+='<tr class="dp-vs-subrow">';
          if(_trtIdx<0){
            html+='<td colspan="'+_activeDailyCols.length+'" class="dpx-dc dpx-l">'+_vsTbl+'</td>';
          } else {
            for(let _i=0;_i<_trtIdx;_i++){ html+='<td class="dpx-dc"></td>'; }
            html+='<td colspan="'+(_activeDailyCols.length-_trtIdx)+'" class="dpx-dc dpx-l">'+_vsTbl+'</td>';
          }
          html+='</tr>';
        }
      }
      /* ── 신체사정이 있으면 처치 칸 자리에 표로 인쇄 ── */
      {
        const _paTbl=_dpPaTableHtml(r);
        if(_paTbl){
          const _trtIdx=_activeDailyCols.indexOf('treatment');
          html+='<tr class="dp-pa-subrow">';
          if(_trtIdx<0){
            html+='<td colspan="'+_activeDailyCols.length+'" class="dpx-dc dpx-l">'+_paTbl+'</td>';
          } else {
            for(let _i=0;_i<_trtIdx;_i++){ html+='<td class="dpx-dc"></td>'; }
            html+='<td colspan="'+(_activeDailyCols.length-_trtIdx)+'" class="dpx-dc dpx-l">'+_paTbl+'</td>';
          }
          html+='</tr>';
        }
      }
    });
    /* 빈 행 채움 제거 — 방문자 수만큼만 행 생성 (빈칸 행이 페이지를 넘기던 문제, 사용자 요청 2026-06-11) */
    html+='</tbody></table></div>';
  });
  /* dpx- 공용 CSS 를 미리보기 맨 앞에 삽입 — PDF/인쇄가 innerHTML 을 복제하므로 자동 승계 (경량화 2026-08-12) */
  area.innerHTML='<style>'+_DPX_CSS+'</style>'+html;area.style.display='block';
  /* 로딩 점 숨김 */
  if(_loadingDots)_loadingDots.style.display='none';
}

/* ── 색상바 + 제목 헤더 (연수/교육 등록부 양식과 동일) ──
   thead 안에 두면 페이지마다 자동 반복 인쇄됨
   비율: 상단 = 파랑(7) + 노랑(3), 하단 = 초록(3) + 빨강(7) — 10등분 기준 */
function _dpColorSplit(cols,colWidths){
  /* 픽셀 기반 분할 — 노란(top2)·초록(bot1) 줄이 시각적으로 같은 너비가 되도록
     총 픽셀의 30% 지점을 임계값으로 찾아 양쪽 바의 경계 컬럼 위치 결정 */
  if(Array.isArray(colWidths)&&colWidths.length){
    const total=colWidths.reduce(function(a,b){return a+b;},0);
    const threshold30=total*0.3;
    /* top2(노란, 우측 30%) — 우측부터 누적, 30% 넘으면 중단 */
    let acc=0,top2=0;
    for(let i=colWidths.length-1;i>=0;i--){
      acc+=colWidths[i];
      top2++;
      if(acc>=threshold30)break;
    }
    /* bot1(초록, 좌측 30%) — 좌측부터 누적 */
    acc=0;let bot1=0;
    for(let i=0;i<colWidths.length;i++){
      acc+=colWidths[i];
      bot1++;
      if(acc>=threshold30)break;
    }
    const top1=Math.max(1,cols-top2);
    const bot2=Math.max(1,cols-bot1);
    return {top1:top1,top2:top2,bot1:bot1,bot2:bot2};
  }
  /* 폴백: 컬럼 수 기반 7:3 */
  const left=Math.max(1,Math.round(cols*0.7));
  const right=Math.max(1,cols-left);
  return {top1:left,top2:right,bot1:right,bot2:left};
}
function _dpBuildTitledHeaderTr(titleText, totalCols, colWidths){
  const cols=Math.max(totalCols||10,4);
  const sp=_dpColorSplit(cols,colWidths);
  let h='';
  /* 1: 상단 색상바 (파랑 70% + 노랑 30%) */
  h+='<tr><td colspan="'+sp.top1+'" style="background:#2855A0;height:12px;padding:0;border:none"></td><td colspan="'+sp.top2+'" style="background:#D4A843;height:12px;padding:0;border:none"></td></tr>';
  /* 2: 제목 */
  h+='<tr><td colspan="'+cols+'" style="background:#F7F7F7;text-align:center;padding:10px 16px;border:none;font-size:16px;font-weight:700;color:#000;letter-spacing:3px">'+escHtml(titleText)+'</td></tr>';
  /* 3: 하단 색상바 (초록 30% + 빨강 70%) */
  h+='<tr><td colspan="'+sp.bot1+'" style="background:#2E8B57;height:12px;padding:0;border:none"></td><td colspan="'+sp.bot2+'" style="background:#C0392B;height:12px;padding:0;border:none"></td></tr>';
  return h;
}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* 데이터 tbody 의 각 <tr> 에 대해: 첫 칼럼·끝 칼럼·마지막 행에 굵은선 부여 */
function _dpDecorateBody(bodyHtml,lastColIdx){
  if(!bodyHtml)return '';
  /* tr 단위로 분리 */
  const trArr=[];
  bodyHtml.replace(/<tr[\s\S]*?<\/tr>/g,function(m){trArr.push(m);return m;});
  return trArr.map(function(trHtml,trI){
    const isLastTr=trI===trArr.length-1;
    let tdI=0;
    const newTr=trHtml.replace(/<td([^>]*)>/g,function(m,attrs){
      const isFirst=tdI===0;
      const isLast=tdI===lastColIdx;
      tdI++;
      const _bL=isFirst?'border-left:2.5px solid #000;':'border-left:1px solid #555;';
      const _bR=isLast?'border-right:2.5px solid #000;':'border-right:1px solid #555;';
      const _bT='border-top:1px solid #555;';
      const _bB=isLastTr?'border-bottom:2.5px solid #000;':'border-bottom:1px solid #555;';
      const baseStyle='padding:5px 7px;'+_bL+_bR+_bT+_bB;
      /* 기존 style 보존 후 border 만 덮어씀 */
      let merged='';
      if(/style\s*=/.test(attrs)){
        attrs=attrs.replace(/style\s*=\s*"([^"]*)"/,function(_,c){
          /* 기존 border 속성 제거 */
          c=c.replace(/border[^;]*;?/g,'');
          merged='style="'+c+';'+baseStyle+'"';
          return '';
        });
        attrs=attrs+' '+merged;
      } else {
        attrs+=' style="'+baseStyle+'"';
      }
      return '<td'+attrs+'>';
    });
    return newTr;
  }).join('');
}

/* 미리보기 영역 → 출력용 HTML 추출
   요구사항:
   - 굵은 테두리는 데이터 표(헤더행~마지막행)에만 적용
   - 색상바는 좌우 테두리 없음
   - 학교 위 + 기간 아래 여백
   - 헤더행은 페이지마다 반복 (PDF) + 고정 (Excel) */
function _dpBuildExportTable(){
  const area=document.getElementById('dpPreviewArea');
  if(!area)return null;
  const tables=area.querySelectorAll('table');
  if(!tables.length)return null;
  /* 메인 데이터표 명시 선택 — 중첩 V/S 미니표가 마지막 table 로 잡히던 버그 방지 (2026-06-16) */
  const dataTable=area.querySelector('table[data-dp-main]')||tables[tables.length-1];
  const thead=dataTable.querySelector('thead');
  const tbody=dataTable.querySelector('tbody');
  const headerRow=thead?thead.innerHTML:'';
  const bodyRows=tbody?tbody.innerHTML:'';
  const colCount=thead?thead.querySelectorAll('th').length:8;
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  const titleText=_dpRowTitleText();
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  const periodText=(from===to)?fmtD(from):('기간: '+fmtD(from)+' ~ '+fmtD(to));   /* 하루만 선택 시 "기간: " 없이 날짜만 (사용자 요청 2026-06-16) */
  const schoolText=schoolName;
  const wrapperBefore=''; /* 더 이상 별도 테이블 사용 안 함 */
  /* 컬럼 너비 — 라벨에 따라 차등 배정 (가로 출력 기준)
     좁은 칼럼(학교급/학과 등) 숨김 시 → 절약된 공간을 넓은 칼럼(증상/처치/투약/V/S)에 비례 분배 */
  const headerThs=Array.from(thead?thead.querySelectorAll('th'):[]);
  const headerLabels=headerThs.map(function(th){return (th.textContent||'').trim();});
  const _NARROW=/^(순|학교급|학과|성별|번호|학년반|침상 ?이용)$/;
  const _MEDIUM=/^(이름|날짜|시간|처치자|상담자)$/;
  const _WIDE=/^(증상|처치 ?내용|투약 ?내용|V\/S|상담 ?주제|상담 ?내용)$/;
  function _baseW(label){
    if(/^순$/.test(label))return 44;
    if(/^침상 ?이용$/.test(label))return 64;
    if(_NARROW.test(label))return 60;
    if(_MEDIUM.test(label))return 90;
    if(_WIDE.test(label))return 200;
    return 110;
  }
  /* 1차 너비 산정 */
  let colWidths=headerLabels.map(_baseW);
  /* 사용자 조절값 우선 적용 (2026-06-11) — 라벨→col 역매핑으로 Excel/Sheets/PDF 동일 반영 */
  headerLabels.forEach(function(lbl,i){
    const info=DP_COLS.find(function(c){return c.label===lbl;});
    if(info){ const u=_dpClampW(dpColWidthsUser[info.col]); if(u!=null)colWidths[i]=u; }
  });
  /* 누락된 좁은 칼럼(학교급·학과)이 있으면 확보 공간을 넓은 칼럼에 분배 */
  const _ALL_NARROW=['학교급','학과'];
  let bonusPx=0;
  _ALL_NARROW.forEach(function(lbl){if(headerLabels.indexOf(lbl)===-1)bonusPx+=60;});
  if(bonusPx>0){
    const wideIdx=[];
    headerLabels.forEach(function(l,i){if(_WIDE.test(l))wideIdx.push(i);});
    if(wideIdx.length){
      const add=Math.floor(bonusPx/wideIdx.length);
      wideIdx.forEach(function(i){
        /* 사용자가 직접 지정한 열은 보너스 분배로 덮지 않음 (2026-06-11) */
        const info=DP_COLS.find(function(c){return c.label===headerLabels[i];});
        if(info && _dpClampW(dpColWidthsUser[info.col])!=null) return;
        colWidths[i]+=add;
      });
    }
  }
  /* colgroup — HTML/PDF 용 */
  let colGroup='<colgroup>';
  colWidths.forEach(function(w){colGroup+='<col style="width:'+w+'px" width="'+w+'">';});
  colGroup+='</colgroup>';
  /* Excel은 colgroup 픽셀 무시하는 경우가 많음 — 컬럼 헤더 <th>에 직접 너비 지정해야 적용됨
     동시에 외곽 굵은선이 모든 사면(좌·우·위·아래)에 보이도록 각 <th> border 명시 */
  let headerCells=headerRow.replace(/<tr[^>]*>/,'').replace(/<\/tr>/,'');
  let _thIdx=0;
  const _thLast=colWidths.length-1;
  headerCells=headerCells.replace(/<th([^>]*)>/g,function(m,attrs){
    const w=colWidths[_thIdx]||100;
    const isFirst=_thIdx===0;
    const isLast=_thIdx===_thLast;
    /* 굵은선 — 위쪽 + 좌(첫칸) + 우(끝칸) */
    const _bL=isFirst?'border-left:2.5px solid #000;':'border-left:1px solid #000;';
    const _bR=isLast?'border-right:2.5px solid #000;':'border-right:1px solid #000;';
    const _bT='border-top:2.5px solid #000;';
    const _bB='border-bottom:2px solid #000;';
    const widthCSS='width:'+w+'px;min-width:'+w+'px;';
    const bgCSS='background:#EAEAEA;font-weight:bold;text-align:center;padding:6px 8px;';
    const newStyle=widthCSS+bgCSS+_bL+_bR+_bT+_bB;
    _thIdx++;
    /* 기존 style 제거하고 새 style 적용 */
    attrs=attrs.replace(/style\s*=\s*"[^"]*"/,'');
    return '<th width="'+w+'" style="'+newStyle+'"'+attrs+'>';
  });
  /* 색상바·여백·학교·기간 — colWidths 픽셀 기반 분할 적용 (노란/초록 시각 길이 동일) */
  const _wrapperHeadTrs=
    _dpBuildTitledHeaderTr(titleText,colCount,colWidths)
    +'<tr><td colspan="'+colCount+'" style="height:30px;padding:0;border:none;background:#fff"></td></tr>'
    +'<tr><td colspan="'+colCount+'" style="text-align:left;padding:4px 6px;border:none;font-size:12px;color:#000;font-weight:600;background:#fff">'+escHtml(schoolText)+'</td></tr>'
    +'<tr><td colspan="'+colCount+'" style="text-align:left;padding:4px 6px;border:none;font-size:12px;color:#000;font-weight:600;background:#fff">'+escHtml(periodText)+'</td></tr>'
    +'<tr><td colspan="'+colCount+'" style="height:30px;padding:0;border:none;background:#fff"></td></tr>';
  /* 데이터 행 처리 — 첫 칼럼 좌 굵은선, 끝 칼럼 우 굵은선, 마지막 행 하단 굵은선 */
  const _processedBody=_dpDecorateBody(bodyRows,_thLast);
  /* 데이터 표 — 단일 테이블 (thead에 wrapper rows 포함 → PDF 페이지마다 반복) */
  const dataHtml=
    '<table class="dp-data" style="width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed">'
    +colGroup
    +'<thead>'+_wrapperHeadTrs+'<tr>'+headerCells+'</tr></thead>'
    +'<tbody>'+_processedBody+'</tbody>'
    +'</table>';
  return {
    html:wrapperBefore+dataHtml,
    titleText:titleText,
    schoolName:schoolName,
    fileName:schoolName+'_보건일지_'+(from||'')+'_'+(to||'')+'',
    headerRowCount:8,
    colCount:colCount,
    colWidths:colWidths,
    headerLabels:headerLabels
  };
}

/* ── 진료과별 통계 표지용 Sheets payload 빌더 (엑셀 "진료과별 통계" 워크시트와 동일한 시각 구성) ── */
async function _dpBuildCoverSheetPayload(from,to,schoolName){
  const sd=await buildDeptStatsSections(from,to);
  if(!sd||!sd.sections||!sd.sections.length)return null;
  const cvColCount=sd.colCount;
  /* 열 너비: 첫 컬럼(학년/구분)=100, 나머지 dept + 계=90 */
  const cvColWidths=[100];
  for(let i=0;i<cvColCount-1;i++)cvColWidths.push(90);
  const cvTotalPx=cvColWidths.reduce(function(a,b){return a+b;},0);
  const th30=cvTotalPx*0.3;
  let acc=0,top2=0;
  for(let i=cvColWidths.length-1;i>=0;i--){acc+=cvColWidths[i];top2++;if(acc>=th30)break;}
  acc=0;let bot1=0;
  for(let i=0;i<cvColWidths.length;i++){acc+=cvColWidths[i];bot1++;if(acc>=th30)break;}
  const top1=Math.max(1,cvColCount-top2);
  const cvTitle='진료과별 선택기간 통계';
  const today=new Date();
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  const cvPeriod='기간: '+fmtD(from)+' ~ '+fmtD(to);
  const cvSchool='학교: '+schoolName;
  function pad(arr){const r=arr.slice();while(r.length<cvColCount)r.push('');return r;}
  /* 헤더 7행 (상단 색상바/제목/하단 색상바/여백/학교/기간/여백) — main 과 동일 */
  const rows=[];
  rows.push(pad([]));              /* 1 */
  rows.push(pad([cvTitle]));        /* 2 */
  rows.push(pad([]));              /* 3 */
  rows.push(pad([]));              /* 4 */
  rows.push(pad([cvSchool]));       /* 5 */
  rows.push(pad([cvPeriod]));       /* 6 */
  rows.push(pad([]));              /* 7 */
  const reqs=[];
  const sheetId=0;
  /* 상단 색상바 */
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:8},fields:'pixelSize'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:top1},cell:{userEnteredFormat:{backgroundColor:{red:0.157,green:0.333,blue:0.627}}},fields:'userEnteredFormat.backgroundColor'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:top1,endColumnIndex:cvColCount},cell:{userEnteredFormat:{backgroundColor:{red:0.831,green:0.659,blue:0.263}}},fields:'userEnteredFormat.backgroundColor'}});
  /* 제목 병합 */
  reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:cvColCount},mergeType:'MERGE_ALL'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:14},backgroundColor:{red:0.969,green:0.969,blue:0.969}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)'}});
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:1,endIndex:2},properties:{pixelSize:32},fields:'pixelSize'}});
  /* 하단 색상바 */
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:2,endIndex:3},properties:{pixelSize:8},fields:'pixelSize'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:bot1},cell:{userEnteredFormat:{backgroundColor:{red:0.180,green:0.545,blue:0.341}}},fields:'userEnteredFormat.backgroundColor'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:bot1,endColumnIndex:cvColCount},cell:{userEnteredFormat:{backgroundColor:{red:0.753,green:0.224,blue:0.169}}},fields:'userEnteredFormat.backgroundColor'}});
  /* 여백 */
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:3,endIndex:4},properties:{pixelSize:24},fields:'pixelSize'}});
  /* 학교/기간 병합 */
  reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:cvColCount},mergeType:'MERGE_ALL'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
  reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6,startColumnIndex:0,endColumnIndex:cvColCount},mergeType:'MERGE_ALL'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:6,endIndex:7},properties:{pixelSize:24},fields:'pixelSize'}});
  /* 섹션들 — 각 섹션: 타이틀 행(병합) + 헤더 행 + 데이터 행 + (있으면) 합계 행 + 빈 행 */
  let curRow=7;
  sd.sections.forEach(function(section,sIdx){
    if(sIdx>0){rows.push(pad([]));curRow++;} /* 섹션간 여백 */
    /* 섹션 타이틀 */
    rows.push(pad([section.title||'']));
    reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+1,startColumnIndex:0,endColumnIndex:cvColCount},mergeType:'MERGE_ALL'}});
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:12,foregroundColor:{red:0.055,green:0.455,blue:0.565}},backgroundColor:{red:0.902,green:0.969,blue:0.984}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)'}});
    reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:curRow,endIndex:curRow+1},properties:{pixelSize:26},fields:'pixelSize'}});
    curRow++;
    /* 헤더 */
    rows.push(pad(section.header||[]));
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+1,startColumnIndex:0,endColumnIndex:cvColCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:11},backgroundColor:{red:0.92,green:0.92,blue:0.92},borders:{top:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}},bottom:{style:'SOLID',color:{red:0,green:0,blue:0}},left:{style:'SOLID',color:{red:0,green:0,blue:0}},right:{style:'SOLID',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor,borders)'}});
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{borders:{left:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.left'}});
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+1,startColumnIndex:cvColCount-1,endColumnIndex:cvColCount},cell:{userEnteredFormat:{borders:{right:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.right'}});
    curRow++;
    /* 데이터 */
    const sRows=section.rows||[];
    const hasTotal=!!section.totalsRow;
    sRows.forEach(function(rd){rows.push(pad(rd));});
    if(sRows.length>0){
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+sRows.length,startColumnIndex:0,endColumnIndex:cvColCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},bottom:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},left:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},right:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,borders)'}});
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+sRows.length,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{borders:{left:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.left'}});
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+sRows.length,startColumnIndex:cvColCount-1,endColumnIndex:cvColCount},cell:{userEnteredFormat:{borders:{right:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.right'}});
    }
    curRow+=sRows.length;
    /* 합계 행 */
    if(hasTotal){
      rows.push(pad(section.totalsRow));
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow,endRowIndex:curRow+1,startColumnIndex:0,endColumnIndex:cvColCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:10},backgroundColor:{red:0.98,green:0.984,blue:0.988},borders:{top:{style:'SOLID',color:{red:0.3,green:0.3,blue:0.3}},bottom:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}},left:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}},right:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor,borders)'}});
      curRow++;
    } else {
      /* 단일 행 섹션도 하단 굵은선 마감 */
      if(sRows.length>0){
        reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:curRow-1,endRowIndex:curRow,startColumnIndex:0,endColumnIndex:cvColCount},cell:{userEnteredFormat:{borders:{bottom:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.bottom'}});
      }
    }
  });
  /* 헤더 7행 freeze */
  reqs.push({updateSheetProperties:{properties:{sheetId:sheetId,gridProperties:{frozenRowCount:7}},fields:'gridProperties.frozenRowCount'}});
  /* 컬럼 너비 */
  cvColWidths.forEach(function(w,i){
    reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});
  });
  /* 사용 범위 밖 셀 삭제 */
  const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
  if(cvColCount<DEFAULT_COLS){
    reqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:cvColCount,endIndex:DEFAULT_COLS}}});
  }
  if(rows.length<DEFAULT_ROWS){
    reqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:rows.length,endIndex:DEFAULT_ROWS}}});
  }
  return {
    sheetTitle:'진료과별 통계',
    range:"'진료과별 통계'!A1",
    values:rows,
    requests:reqs
  };
}

/* 매일 한 페이지 Google Sheets — 단일 메인 시트에 날짜별 통계·방문표 연속 배치.
   cover ON 이면 cover 를 맨 앞 탭으로, 메인(보건일지) 을 additionalSheets 로 */
async function _exportDailySheets(){
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  if(!from||!to){alert('먼저 미리보기를 실행하세요.');return;}
  if(!(window.electronAPI&&window.sheetsExportWithConsent)){bus.emit('toast:show',{text:'Google Sheets 연동이 필요합니다.'});return;}
  bus.emit('toast:show',{text:'Google Sheets 보내는 중…'});
  const data=await _buildDailyContinuousData(from,to);
  if(!data.days.length){bus.emit('toast:show',{text:'해당 기간에 기록이 없습니다.'});return;}
  function fmtD(ds){const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  /* 첫 날의 colCount 를 시트 기준 — 모든 날짜가 동일한 DP_COLS 활성 세트를 공유 */
  const colCount=data.days[0].colCount;
  const colWidths=data.days[0].colWidths;
  const titleText='일일 보건일지';
  const schoolText='학교: '+data.schoolName;
  const periodText=(from===to)?fmtD(from):('기간: '+fmtD(from)+' ~ '+fmtD(to));   /* 하루만 선택 시 "기간: " 없이 날짜만 (사용자 요청 2026-06-16) */
  const sheetId=0;
  const rows=[];
  const reqs=[];
  function pad(arr){const r=arr.slice();while(r.length<colCount)r.push('');return r;}
  /* 헤더 블록 (6행): 색상바·제목·색상바·여백·학교·기간 — 색상바 바로 아래 여백 추가 */
  rows.push(pad([]));rows.push(pad([titleText]));rows.push(pad([]));
  rows.push(pad([])); /* row 4 — 색상바 바로 아래 숨통 */
  rows.push(pad([schoolText]));rows.push(pad([periodText]));
  /* 색상바/제목 서식 */
  const total=colWidths.reduce(function(a,b){return a+b;},0);
  const th30=total*0.3;
  let acc=0,top2=0;for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=th30)break;}
  acc=0;let bot1=0;for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=th30)break;}
  const top1=Math.max(1,colCount-top2);
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:8},fields:'pixelSize'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:top1},cell:{userEnteredFormat:{backgroundColor:{red:0.157,green:0.333,blue:0.627}}},fields:'userEnteredFormat.backgroundColor'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:top1,endColumnIndex:colCount},cell:{userEnteredFormat:{backgroundColor:{red:0.831,green:0.659,blue:0.263}}},fields:'userEnteredFormat.backgroundColor'}});
  reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:14},backgroundColor:{red:0.969,green:0.969,blue:0.969}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)'}});
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:1,endIndex:2},properties:{pixelSize:32},fields:'pixelSize'}});
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:2,endIndex:3},properties:{pixelSize:8},fields:'pixelSize'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:bot1},cell:{userEnteredFormat:{backgroundColor:{red:0.180,green:0.545,blue:0.341}}},fields:'userEnteredFormat.backgroundColor'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:bot1,endColumnIndex:colCount},cell:{userEnteredFormat:{backgroundColor:{red:0.753,green:0.224,blue:0.169}}},fields:'userEnteredFormat.backgroundColor'}});
  /* row 3 (색상바 바로 아래 여백) — 높이 28 로 숨통 */
  reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:3,endIndex:4},properties:{pixelSize:28},fields:'pixelSize'}});
  /* row 4 학교 */
  reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
  /* row 5 기간 */
  reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
  reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
  /* 컬럼 너비 */
  colWidths.forEach(function(w,i){reqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});});
  /* 상단 5행 freeze */
  reqs.push({updateSheetProperties:{properties:{sheetId:sheetId,gridProperties:{frozenRowCount:3}},fields:'gridProperties.frozenRowCount'}});
  /* 각 날짜 연속 쌓기 */
  data.days.forEach(function(day){
    /* 여백 */
    rows.push(pad([]));
    /* 날짜 헤더 */
    const d=new Date(day.date);
    const dow=['일','월','화','수','목','금','토'][d.getDay()];
    const dayTitle='📅 '+d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 ('+dow+')  ·  방문 '+day.dataRows.length+'명';
    const dayTitleRow=rows.length;
    rows.push(pad([dayTitle]));
    reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:dayTitleRow,endRowIndex:dayTitleRow+1,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:dayTitleRow,endRowIndex:dayTitleRow+1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:13,foregroundColor:{red:0.059,green:0.09,blue:0.165}},backgroundColor:{red:0.878,green:0.949,blue:0.996}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'}});
    /* 일간 통계 3섹션 */
    if(day.preambleSections&&day.preambleSections.sections&&day.preambleSections.sections.length){
      const statsTitleRow=rows.length;
      rows.push(pad(['📊 일간 방문 통계']));
      reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:statsTitleRow,endRowIndex:statsTitleRow+1,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:statsTitleRow,endRowIndex:statsTitleRow+1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11,foregroundColor:{red:0.055,green:0.455,blue:0.565}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
      day.preambleSections.sections.forEach(function(section){
        rows.push(pad([]));
        const sRow=rows.length;
        rows.push(pad([section.title||'']));
        reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:sRow,endRowIndex:sRow+1,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
        reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:sRow,endRowIndex:sRow+1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:10},backgroundColor:{red:0.902,green:0.969,blue:0.984}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'}});
        const secCols=(section.header||[]).length;
        const hRow=rows.length;
        rows.push(pad((section.header||[])));
        reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:hRow,endRowIndex:hRow+1,startColumnIndex:0,endColumnIndex:secCols},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{bold:true,fontSize:10},backgroundColor:{red:0.92,green:0.92,blue:0.92},borders:{top:{style:'SOLID_MEDIUM',color:{red:0,green:0,blue:0}},bottom:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},left:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},right:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor,borders)'}});
        (section.rows||[]).forEach(function(r){rows.push(pad(r));});
        if(section.totalsRow){rows.push(pad(section.totalsRow));}
        const dataStart=hRow+1;
        const dataEnd=rows.length;
        if(dataEnd>dataStart){
          reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:dataStart,endRowIndex:dataEnd,startColumnIndex:0,endColumnIndex:secCols},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}},bottom:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}},left:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}},right:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,borders)'}});
          if(section.totalsRow){
            reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:dataEnd-1,endRowIndex:dataEnd,startColumnIndex:0,endColumnIndex:secCols},cell:{userEnteredFormat:{textFormat:{bold:true},backgroundColor:{red:0.98,green:0.984,blue:0.988},borders:{bottom:{style:'SOLID_MEDIUM',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat(textFormat,backgroundColor,borders.bottom)'}});
          }
        }
      });
    }
    /* 여백 */
    rows.push(pad([]));
    /* 방문 상세 타이틀 */
    const vtRow=rows.length;
    rows.push(pad(['📝 방문 상세']));
    reqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:vtRow,endRowIndex:vtRow+1,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:vtRow,endRowIndex:vtRow+1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11,foregroundColor:{red:0.263,green:0.22,blue:0.792}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
    /* 방문표 헤더 + 데이터 */
    const vHdrRow=rows.length;
    rows.push(pad(day.headerLabels||[]));
    const dayCols=(day.headerLabels||[]).length;
    reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:vHdrRow,endRowIndex:vHdrRow+1,startColumnIndex:0,endColumnIndex:dayCols},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{bold:true,fontSize:10},backgroundColor:{red:0.94,green:0.94,blue:0.94},borders:{top:{style:'SOLID_MEDIUM',color:{red:0,green:0,blue:0}},bottom:{style:'SOLID',color:{red:0,green:0,blue:0}},left:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},right:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor,borders)'}});
    const dDataStart=rows.length;
    (day.dataRows||[]).forEach(function(r){rows.push(pad(r));});
    const dDataEnd=rows.length;
    if(dDataEnd>dDataStart){
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:dDataStart,endRowIndex:dDataEnd,startColumnIndex:0,endColumnIndex:dayCols},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}},bottom:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}},left:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}},right:{style:'SOLID',color:{red:0.5,green:0.5,blue:0.5}}},wrapStrategy:'WRAP'}},fields:'userEnteredFormat(horizontalAlignment,textFormat,borders,wrapStrategy)'}});
      reqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:dDataEnd-1,endRowIndex:dDataEnd,startColumnIndex:0,endColumnIndex:dayCols},cell:{userEnteredFormat:{borders:{bottom:{style:'SOLID_MEDIUM',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.bottom'}});
    }
  });
  /* 사용하지 않는 우측 컬럼·하단 행 제거 */
  const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
  if(colCount<DEFAULT_COLS)reqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:colCount,endIndex:DEFAULT_COLS}}});
  if(rows.length<DEFAULT_ROWS)reqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:rows.length,endIndex:DEFAULT_ROWS}}});
  /* (옵션) 진료과별 통계 표지 — cover 를 메인 탭으로, 보건일지를 additionalSheets 로 */
  const _coverOpt=document.getElementById('dpOptCover');
  let cover=null;
  if(_coverOpt&&_coverOpt.checked){try{cover=await _dpBuildCoverSheetPayload(from,to,data.schoolName);}catch(e){}}
  const _ov=document.getElementById('diaryPrintOverlay');if(_ov)_ov.style.zIndex='9000';
  let jobArgs;
  if(cover){
    jobArgs={title:titleText,sheetTitle:cover.sheetTitle,range:cover.range,values:cover.values,requests:cover.requests,additionalSheets:[{sheetTitle:'보건일지',range:'보건일지!A1',values:rows,requests:reqs}]};
  } else {
    jobArgs={title:titleText,sheetTitle:'보건일지',range:'보건일지!A1',values:rows,requests:reqs};
  }
  window.sheetsExportWithConsent(jobArgs).then(function(res){
    if(_ov)_ov.style.zIndex='10500';
    if(res&&res.success){
      bus.emit('toast:show',{text:'Google Sheets 생성 완료'});
      if(res.spreadsheetUrl&&window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(res.spreadsheetUrl);
    } else bus.emit('toast:show',{text:'Sheets 내보내기 실패: '+(res&&res.error||'')});
  }).catch(function(e){if(_ov)_ov.style.zIndex='10500';bus.emit('toast:show',{text:'Sheets 오류: '+(e&&e.message||e)});});
}

/* ── Google Sheets 내보내기 — 색상바 + 굵은 외곽 + 실선 내부 + 헤더 freeze ── */
async function exportDiarySheets(){
  if(_dpFormat==='daily'){return _exportDailySheets();}
  const built=_dpBuildExportTable();
  if(!built){alert('먼저 미리보기를 실행하세요.');return;}
  const titleText=built.titleText;
  const schoolName=built.schoolName;
  const from=document.getElementById('dpFrom').value;
  const to=document.getElementById('dpTo').value;
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  /* 미리보기 영역에서 컬럼 헤더 + 데이터 추출 */
  const area=document.getElementById('dpPreviewArea');
  const tables=area.querySelectorAll('table');
  /* 메인 데이터표 명시 선택 + V/S 시간대 표 행(.dp-vs-subrow)·중첩 td 제외 (2026-06-16) */
  const dataTable=area.querySelector('table[data-dp-main]')||tables[tables.length-1];
  const headerThs=dataTable.querySelectorAll(':scope > thead th');
  const headerLabels=Array.from(headerThs).map(function(th){return (th.textContent||'').trim();});
  const colCount=headerLabels.length||8;
  const dataRows=[];
  dataTable.querySelectorAll(':scope > tbody > tr').forEach(function(tr){
    if(tr.classList&&(tr.classList.contains('dp-vs-subrow')||tr.classList.contains('dp-pa-subrow')))return;
    const cells=tr.querySelectorAll(':scope > td');
    if(!cells.length)return;
    /* 빈 안내 행("해당 기간에 기록이 없습니다") — colspan으로 단일 셀이면 그대로 둠 */
    const row=[];
    cells.forEach(function(c){row.push((c.textContent||'').trim());});
    /* 정렬 위해 콜수 맞춤 */
    while(row.length<colCount)row.push('');
    /* V/S·신체사정 병합 — Excel 과 동일 (2026-08-27) */
    _dpMergeVsPaIntoRow(row,headerLabels,dataRows.length);
    dataRows.push(row);
  });
  /* 시트 행 구성 — 빈 셀 padding으로 컬럼 수 맞춤 */
  function pad(arr){const r=arr.slice();while(r.length<colCount)r.push('');return r;}
  const rows=[];
  rows.push(pad([])); /* 1행: 상단 색상바 */
  rows.push(pad([titleText])); /* 2행: 제목 (병합) */
  rows.push(pad([])); /* 3행: 하단 색상바 */
  rows.push(pad([])); /* 4행: 학교 위 여백 */
  rows.push(pad(['학교: '+schoolName])); /* 5행: 학교 (병합) */
  rows.push(pad(['기간: '+fmtD(from)+' ~ '+fmtD(to)])); /* 6행: 기간 (병합) */
  rows.push(pad([])); /* 7행: 기간 아래 여백 */
  rows.push(pad(headerLabels)); /* 8행: 컬럼 헤더 */
  dataRows.forEach(function(r){rows.push(r);});

  /* 색상바 비율 계산 — 픽셀 기반 (노란/초록 시각 길이 동일) */
  const sp=_dpColorSplit(colCount,built.colWidths||[]);
  const fmtReqs=[];
  const sheetId=0;

  /* 1행: 상단 색상바 — 높이 줄이고 좌우 색 적용 */
  fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:8},fields:'pixelSize'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:sp.top1},cell:{userEnteredFormat:{backgroundColor:{red:0.157,green:0.333,blue:0.627}}},fields:'userEnteredFormat.backgroundColor'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:sp.top1,endColumnIndex:colCount},cell:{userEnteredFormat:{backgroundColor:{red:0.831,green:0.659,blue:0.263}}},fields:'userEnteredFormat.backgroundColor'}});
  /* 2행: 제목 병합 + 가운데 + 굵게 */
  fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:14},backgroundColor:{red:0.969,green:0.969,blue:0.969}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)'}});
  fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:1,endIndex:2},properties:{pixelSize:32},fields:'pixelSize'}});
  /* 3행: 하단 색상바 */
  fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:2,endIndex:3},properties:{pixelSize:8},fields:'pixelSize'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:sp.bot1},cell:{userEnteredFormat:{backgroundColor:{red:0.180,green:0.545,blue:0.341}}},fields:'userEnteredFormat.backgroundColor'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:sp.bot1,endColumnIndex:colCount},cell:{userEnteredFormat:{backgroundColor:{red:0.753,green:0.224,blue:0.169}}},fields:'userEnteredFormat.backgroundColor'}});
  /* 4행: 학교 위 여백 (확대) */
  fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:3,endIndex:4},properties:{pixelSize:30},fields:'pixelSize'}});
  /* 5행: 학교 병합 + 좌측 정렬 */
  fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
  /* 6행: 기간 병합 */
  fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
  /* 7행: 기간 아래 여백 (확대) */
  fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:6,endIndex:7},properties:{pixelSize:30},fields:'pixelSize'}});
  /* 8행: 컬럼 헤더 — 굵게 + 가운데 + 회색 배경 + 4면 굵은 테두리 (위/아래/좌/우) */
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:7,endRowIndex:8,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:10},backgroundColor:{red:0.94,green:0.94,blue:0.94},borders:{top:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}},bottom:{style:'SOLID',color:{red:0,green:0,blue:0}},left:{style:'SOLID',color:{red:0,green:0,blue:0}},right:{style:'SOLID',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor,borders)'}});
  /* 좌측 첫 칼럼/우측 끝 칼럼만 굵은 좌/우 외곽 */
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:7,endRowIndex:8,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{borders:{left:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.left'}});
  fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:7,endRowIndex:8,startColumnIndex:colCount-1,endColumnIndex:colCount},cell:{userEnteredFormat:{borders:{right:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.right'}});
  /* 데이터 행 (9행~끝): 내부 실선 + 가운데 정렬 */
  const totalRows=rows.length;
  if(totalRows>8){
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:8,endRowIndex:totalRows,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},bottom:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},left:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},right:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,borders)'}});
    /* 좌/우 외곽 굵은선 */
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:8,endRowIndex:totalRows,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{borders:{left:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.left'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:8,endRowIndex:totalRows,startColumnIndex:colCount-1,endColumnIndex:colCount},cell:{userEnteredFormat:{borders:{right:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.right'}});
    /* 마지막 행 하단 굵은선 */
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:totalRows-1,endRowIndex:totalRows,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{borders:{bottom:{style:'SOLID_THICK',color:{red:0,green:0,blue:0}}}}},fields:'userEnteredFormat.borders.bottom'}});
  }
  /* 컬럼 너비 — built.colWidths 그대로 사용 (학교급/번호=좁음, 증상/처치/투약/V/S=넓음) */
  if(built.colWidths&&built.colWidths.length){
    built.colWidths.forEach(function(w,i){
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});
    });
  }
  /* 데이터 행에 자동 줄바꿈 — 긴 증상/처치 텍스트 잘림 방지 */
  if(rows.length>8){
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:8,endRowIndex:rows.length,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{wrapStrategy:'WRAP'}},fields:'userEnteredFormat.wrapStrategy'}});
  }
  /* 헤더행(8) freeze */
  fmtReqs.push({updateSheetProperties:{properties:{sheetId:sheetId,gridProperties:{frozenRowCount:8}},fields:'gridProperties.frozenRowCount'}});
  /* 사용하지 않는 우측 컬럼·하단 행 삭제 → 출력 영역에 빈 셀이 포함되지 않게 함
     (Google Sheets 새 시트 기본: 26 cols × 1000 rows) */
  const totalDataRows=rows.length;
  const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
  if(colCount<DEFAULT_COLS){
    fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:colCount,endIndex:DEFAULT_COLS}}});
  }
  if(totalDataRows<DEFAULT_ROWS){
    fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:totalDataRows,endIndex:DEFAULT_ROWS}}});
  }

  /* (옵션) 진료과별 통계 표지 — 탭 순서: |진료과별 통계|보건일지| 가 되도록
     cover ON 이면 cover 를 메인 시트로, 보건일지를 additionalSheets 로 구성 */
  const _coverOpt=document.getElementById('dpOptCover');
  let _coverPayloadForSheets=null;
  if(_coverOpt&&_coverOpt.checked){
    try{
      _coverPayloadForSheets=await _dpBuildCoverSheetPayload(from,to,schoolName);
    }catch(e){console.warn('[diary-print] cover sheet payload failed:',e);}
  }

  if(window.electronAPI&&window.sheetsExportWithConsent){
    bus.emit('toast:show',{text:'Google Sheets로 보내는 중…'});
    const _ov=document.getElementById('diaryPrintOverlay');
    if(_ov)_ov.style.zIndex='9000';
    let jobArgs;
    if(_coverPayloadForSheets){
      /* cover 가 메인 시트(탭 맨 앞) — 보건일지는 additionalSheets 로 이어서 추가 */
      jobArgs={
        title:titleText,
        sheetTitle:_coverPayloadForSheets.sheetTitle,
        range:_coverPayloadForSheets.range,
        values:_coverPayloadForSheets.values,
        requests:_coverPayloadForSheets.requests,
        additionalSheets:[{
          sheetTitle:'보건일지',
          range:'보건일지!A1',
          values:rows,
          requests:fmtReqs
        }]
      };
    } else {
      jobArgs={
        title:titleText,
        sheetTitle:'보건일지',
        range:'보건일지!A1',
        values:rows,
        requests:fmtReqs
      };
    }
    window.sheetsExportWithConsent(jobArgs).then(function(res){
      if(_ov)_ov.style.zIndex='10500';
      if(res&&res.success){
        bus.emit('toast:show',{text:'Google Sheets 생성 완료'});
        if(res.spreadsheetUrl&&window.electronAPI&&window.electronAPI.openExternal){
          window.electronAPI.openExternal(res.spreadsheetUrl);
        }
      } else {
        bus.emit('toast:show',{text:'Sheets 내보내기 실패: '+(res&&res.error||'')});
      }
    }).catch(function(e){
      if(_ov)_ov.style.zIndex='10500';
      bus.emit('toast:show',{text:'Sheets 오류: '+e.message});
    });
  } else {
    bus.emit('toast:show',{text:'Google Sheets 연동이 필요합니다. 설정에서 Google 계정을 연결하세요.'});
  }
}
