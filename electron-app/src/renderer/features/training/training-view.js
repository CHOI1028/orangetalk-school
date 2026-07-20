/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══ 연수 & 교육 등록부 (training-view.js) ═══ */
/* ES Module */
import { S, ensureHolidayYear } from '../../core/app-state.js';
import { escHtml, closeModalGracefully, createEmptyState, compareClass } from '../../core/helpers.js';
import { closeModalWithAnim } from '../daily/daily-autocomplete.js';
import { _makeDraggable } from '../symptom/symptom-view.js';
import { dailyColEyeIcon, openClockPicker } from '../emergency/emergency-view.js';
import { sortStaffList } from '../settings/settings-view.js';

/* ═══ 연수 & 교육 등록부 ═══ */
let _trainingState={name:'',date:'',time:'',date2:'',time2:'',place:'',sortNote:'관리자는 상단에 배열, 이하 가나다 순',sortNoteOn:true,selectedIds:{},selectedType:'staff',marginTop:15,marginBottom:15,marginLeft:12,marginRight:12};
/** 선택된 학생/교직원을 정렬: 교직원 우선(이름순), 학생(학년→반→번호 순) */
function _trSortSelected(list){
  return list.slice().sort(function(a,b){
    if(a.type==='staff'&&b.type==='staff')return(a.name||'').localeCompare(b.name||'','ko');
    if(a.type==='student'&&b.type==='student'){if(a.grade!==b.grade)return a.grade-b.grade;var _c=compareClass(a.cls,b.cls);if(_c)return _c;return(a.num||0)-(b.num||0);}
    return a.type==='staff'?-1:1;
  });
}
let _trCalYear=new Date().getFullYear(), _trCalMonth=new Date().getMonth(), _trCalTarget=null;
let _trMarginDrag=null; /* {side, startVal, startPos} */

export function renderTrainingHome(){
  const area=document.getElementById('trainingArea');if(!area)return;
  const st=_trainingState;
  const selCount=Object.keys(st.selectedIds).filter(function(k){return st.selectedIds[k];}).length;
  let h='<div style="display:flex;gap:0;align-items:stretch;height:calc(100vh - 300px);overflow:hidden">';

  /* ═══ 왼쪽: 입력 폼 ═══ */
  h+='<div style="width:350px;flex-shrink:0;background:var(--card);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden">';
  /* 헤더 */
  h+='<div style="flex-shrink:0;padding:14px 14px 0">';
  h+='<div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:4px">연수/교육 등록부</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:14px">양식을 작성하면 오른쪽 화면에서 미리보기 가능합니다.</div>';
  h+='</div>';
  /* 스크롤 가능한 폼 영역 */
  h+='<div style="flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;padding:0 14px">';
  h+='<div style="display:flex;flex-direction:column;gap:8px">';
  /* 연수명 */
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px">연수 또는 교육명</label><input class="form-input" id="trName" value="'+escHtml(st.name)+'" placeholder="예: 감염병 예방 연수" style="width:100%;font-size:11px"></div>';
  /* 법정 연수 체크 */
  /* 시작 날짜 + 시간 */
  h+='<div style="font-size:10px;font-weight:700;color:var(--cyan);margin-top:4px">시작</div>';
  h+='<div style="display:flex;gap:8px"><div style="flex:1"><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px">날짜</label>'
    +'<div style="position:relative"><input class="form-input" id="trDate" value="'+escHtml(st.date)+'" placeholder="날짜 선택" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openCal" data-field="trDate">'
    +'</div></div>'
    +'<div style="flex:1"><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px">시간</label>'
    +'<div style="position:relative"><input class="form-input" id="trTime" value="'+escHtml(st.time)+'" placeholder="시간 선택" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openClock" data-field="trTime">'
    +'</div></div></div>';
  /* 종료 날짜 + 시간 */
  h+='<div style="font-size:10px;font-weight:700;color:var(--cyan);margin-top:4px">종료</div>';
  h+='<div style="display:flex;gap:8px"><div style="flex:1"><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px">날짜</label>'
    +'<div style="position:relative"><input class="form-input" id="trDate2" value="'+escHtml(st.date2)+'" placeholder="날짜 선택" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openCal" data-field="trDate2">'
    +'</div></div>'
    +'<div style="flex:1"><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px">시간</label>'
    +'<div style="position:relative"><input class="form-input" id="trTime2" value="'+escHtml(st.time2)+'" placeholder="시간 선택" readonly style="width:100%;font-size:11px;cursor:pointer" data-action="openClock" data-field="trTime2">'
    +'</div></div></div>';
  /* 장소 */
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px">연수 장소</label><input class="form-input" id="trPlace" value="'+escHtml(st.place)+'" placeholder="예: 보건실" style="width:100%;font-size:11px"></div>';
  /* 정렬 안내 문구 */
  h+='<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="checkbox" id="trSortNoteOn" '+(st.sortNoteOn?'checked':'')+' style="width:14px;height:14px;accent-color:var(--cyan)" data-action="sortNoteToggle"><label for="trSortNoteOn" style="font-size:10px;color:var(--t3)">정렬 안내 문구 표시</label></div>';
  h+='<div style="display:'+(st.sortNoteOn?'block':'none')+'" id="trSortNoteWrap"><input class="form-input" id="trSortNote" value="'+escHtml(st.sortNote)+'" placeholder="예: 관리자는 상단에 배열, 이하 가나다 순" style="width:100%;font-size:10px;margin-top:4px"></div>';
  h+='</div>';
  h+='</div>'; /* 스크롤 폼 영역 닫기 */
  /* 고정 하단 버튼 */
  h+='<div style="flex-shrink:0;padding:10px 14px;border-top:1px solid var(--bdr);display:flex;flex-direction:column;gap:6px">';
  h+='<button data-action="openTargetSelect" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:linear-gradient(135deg,rgba(236,72,153,0.15),rgba(236,72,153,0.08));color:#f9a8d4;border:1px solid rgba(236,72,153,0.25);border-radius:7px;cursor:pointer;font-family:var(--f)">📋 연수/교육 대상 선택'+(selCount>0?' ('+selCount+'명)':'')+'</button>';
  h+='<button data-action="showMessage" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(168,85,247,0.08));color:#c084fc;border:1px solid rgba(168,85,247,0.25);border-radius:7px;cursor:pointer;font-family:var(--f)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>안내 메시지 미리보기 & 복사</button>';
  h+='<button data-action="exportSheets" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 6px rgba(52,168,83,0.25);display:flex;align-items:center;justify-content:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</button>';
  h+='<button class="btn-pdf btn-block" data-action="exportPDF" style="padding:9px 14px">📄 PDF 저장</button>';
  h+='<button class="btn-print btn-block" data-action="print" style="padding:9px 14px">🖨 인쇄</button>';
  h+='</div>';
  h+='</div>'; /* 입력 폼 끝 */

  /* ═══ 오른쪽: 구글 시트 스타일 미리보기 ═══ */
  h+='<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:#e5e7eb">';
  h+='<div style="flex:1;overflow:auto;padding:20px;display:flex;justify-content:center">';
  h+='<div id="trPreviewA4Wrap" style="background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.1);width:100%;max-width:760px;align-self:flex-start;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000"></div>';
  h+='</div></div>';

  h+='</div>'; /* 전체 flex 끝 */
  area.innerHTML=h;
  /* 이벤트 위임 — data-action 기반 */
  area.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='openCal') trOpenCal(el.dataset.field,el);
    else if(act==='openClock') trOpenClock(el.dataset.field,e,el);
    else if(act==='openTargetSelect') trOpenTargetSelect();
    else if(act==='showMessage') trShowMessage();
    else if(act==='exportSheets') trExportSheets();
    else if(act==='exportPDF') trExportPDF();
    else if(act==='print') trainingPrint();
  });
  const _sortNoteChk=document.getElementById('trSortNoteOn');
  if(_sortNoteChk)_sortNoteChk.addEventListener('change',function(){_trainingState.sortNoteOn=this.checked;_trainingReadForm();trainingRefreshPreview();});
  /* 이벤트 바인딩 */
  const _trFields=['trName','trDate','trTime','trDate2','trTime2','trPlace','trSortNote','trFontSize','trFontFamily','trRowHeight'];
  _trFields.forEach(function(id,idx){
    const el=document.getElementById(id);if(!el)return;
    el.addEventListener('input',function(){_trainingReadForm();trainingRefreshPreview();});
    el.addEventListener('change',function(){_trainingReadForm();trainingRefreshPreview();});
    el.addEventListener('keydown',function(e){
      if(e.key==='Tab'){
        e.preventDefault();
        /* 현재 열린 달력/시계 닫기 */
        const _calW=document.getElementById('trCalWrap');if(_calW)_calW.style.display='none';
        const _clkW=document.getElementById('clockPickerWrap');if(_clkW)_clkW.style.display='none';
        const nextIdx=e.shiftKey?idx-1:idx+1;
        if(nextIdx>=0&&nextIdx<_trFields.length){
          const next=document.getElementById(_trFields[nextIdx]);
          if(next){next.focus();next.click();}
        }
      } else if(e.key==='Enter'){
        e.preventDefault();
        if(id==='trDate'||id==='trDate2')el.click();
        else if(id==='trTime'||id==='trTime2')el.click();
        else{const ni=idx+1;if(ni<_trFields.length){const n2=document.getElementById(_trFields[ni]);if(n2){n2.focus();n2.click();}}}
      }
    });
  });
  trainingRefreshPreview();
  _trRenderRulers();
  _trAutoFitPreview();
}

/* ── A4 미리보기 자동 크기 맞춤 ── */
function _trAutoFitPreview(){
  setTimeout(function(){
    const scroll=document.getElementById('trPreviewScroll');
    const a4wrap=document.getElementById('trPreviewA4Wrap');
    if(!scroll||!a4wrap)return;
    const availH=scroll.clientHeight-20;
    const availW=scroll.clientWidth-20;
    const mmToPx=3.7795;
    const a4Wpx=210*mmToPx;
    const a4Hpx=297*mmToPx;
    const scaleW=availW/a4Wpx;
    const scaleH=availH/a4Hpx;
    const scale=Math.min(scaleW,scaleH,1);
    _trPreviewScale=scale;
    a4wrap.style.transform='scale('+scale+')';
    a4wrap.style.transformOrigin='top center';
    a4wrap.style.width=a4Wpx+'px';
    /* scale로 축소하면 실제 DOM 크기는 그대로라 스크롤 발생 — margin-bottom으로 보정 */
    const scaledH=a4Hpx*scale;
    a4wrap.style.marginBottom=-(a4Hpx-scaledH)+'px';
  },50);
}
let _trPreviewScale=1;

/* ── 자(ruler) 렌더링 ── */
function _trRenderRulers(){
  const mmToPx=3.7795;
  const topR=document.getElementById('trRulerTop');
  const leftR=document.getElementById('trRulerLeft');
  if(topR){
    let h='';for(let i=0;i<=210;i+=5){
      h+='<div style="position:absolute;left:'+(20+i*mmToPx)+'px;bottom:0;'+(i%10===0?'height:8px;border-left:1px solid var(--t3)':'height:4px;border-left:1px solid #ccc')+'">'+(i%10===0?'<span style="position:absolute;left:2px;bottom:0;font-size:7px">'+i+'</span>':'')+'</div>';
    }
    topR.innerHTML=h;
  }
  if(leftR){
    let h='';for(let i=0;i<=297;i+=5){
      h+='<div style="position:absolute;top:'+(i*mmToPx)+'px;right:0;'+(i%10===0?'width:8px;border-top:1px solid var(--t3)':'width:4px;border-top:1px solid #ccc')+'">'+(i%10===0?'<span style="position:absolute;right:10px;top:-4px;font-size:7px">'+i+'</span>':'')+'</div>';
    }
    leftR.innerHTML=h;
  }
}

/* ── 여백 설정 ── */
function trSetMargin(side,val){
  val=Math.max(0,Math.min(40,parseInt(val)||0));
  _trainingState['margin'+side]=val;
  const inp=document.getElementById('trMarginInput'+side);if(inp)inp.value=val;
  trainingRefreshPreview();
}

/* ── 여백 점선 드래그 ── */
function _trMarginMouseDown(side,e){
  e.preventDefault();e.stopPropagation();
  _trMarginDrag={side:side,startVal:_trainingState['margin'+side],startX:e.clientX,startY:e.clientY};
  document.addEventListener('mousemove',_trMarginMouseMove);
  document.addEventListener('mouseup',_trMarginMouseUp);
}
function _trMarginMouseMove(e){
  if(!_trMarginDrag)return;
  const d=_trMarginDrag;
  const mmToPx=3.7795*_trPreviewScale;
  let delta;
  if(d.side==='Top') delta=(e.clientY-d.startY)/mmToPx;
  else if(d.side==='Bottom') delta=-(e.clientY-d.startY)/mmToPx;
  else if(d.side==='Left') delta=(e.clientX-d.startX)/mmToPx;
  else delta=-(e.clientX-d.startX)/mmToPx;
  trSetMargin(d.side,Math.round(d.startVal+delta));
}
function _trMarginMouseUp(){
  _trMarginDrag=null;
  document.removeEventListener('mousemove',_trMarginMouseMove);
  document.removeEventListener('mouseup',_trMarginMouseUp);
}

/* ── 달력 피커 (왼편 달력과 동일 형태) ── */
export function trOpenCal(fieldId,btn){
  _trCalTarget=fieldId;
  const val=document.getElementById(fieldId)?document.getElementById(fieldId).value:'';
  if(val){const d=new Date(val);if(!isNaN(d)){_trCalYear=d.getFullYear();_trCalMonth=d.getMonth();}}
  else{_trCalYear=new Date().getFullYear();_trCalMonth=new Date().getMonth();}
  let wrap=document.getElementById('trCalWrap');
  if(!wrap){
    wrap=document.createElement('div');wrap.id='trCalWrap';
    wrap.style.cssText='position:fixed;z-index:11000;display:none';
    document.body.appendChild(wrap);
  }
  const rect=btn.getBoundingClientRect();
  /* 방어: zoom 적용 / detached 등으로 rect 가 0/0 일 때는 화면 중앙에 배치 */
  const _bad=(!rect || (rect.width===0 && rect.height===0 && rect.left===0 && rect.top===0));
  if(_bad){
    wrap.style.left=Math.max(0,(window.innerWidth-260)/2)+'px';
    wrap.style.top='-9999px';wrap.style.display='block';
    wrap.style.opacity='0';wrap.style.transform='scale(0.95)';wrap.style.transition='';
    _trRenderCal();
    const wh=wrap.offsetHeight;
    wrap.style.top=Math.max(20,(window.innerHeight-wh)/2)+'px';
  } else {
    wrap.style.left=Math.min(rect.left,window.innerWidth-270)+'px';
    wrap.style.top='-9999px';wrap.style.display='block';
    wrap.style.opacity='0';wrap.style.transform='scale(0.95)';wrap.style.transition='';
    _trRenderCal();
    const wh=wrap.offsetHeight;
    wrap.style.top=(window.innerHeight-rect.bottom<wh+8?(rect.top-wh-4):(rect.bottom+4))+'px';
  }
  /* 열기 애니메이션 + 열린 직후 보호 플래그 */
  _trCalJustOpened=true;
  requestAnimationFrame(function(){
    wrap.style.transition='opacity 0.15s ease,transform 0.15s ease';
    wrap.style.opacity='1';wrap.style.transform='scale(1)';
  });
  setTimeout(function(){_trCalJustOpened=false;},300);
}
function _trCloseCal(){
  const wrap=document.getElementById('trCalWrap');
  if(!wrap||wrap.style.display==='none')return;
  wrap.style.transition='opacity 0.15s ease,transform 0.15s ease';
  wrap.style.opacity='0';wrap.style.transform='scale(0.95)';
  setTimeout(function(){wrap.style.display='none';wrap.style.transition='';},150);
  _trCalTarget=null;
}

function _trRenderCal(){
  const wrap=document.getElementById('trCalWrap');if(!wrap)return;
  ensureHolidayYear(String(_trCalYear)); const holidays={};Object.keys(S.koreanHolidays).forEach(function(d){if(d.startsWith(String(_trCalYear)))holidays[d]=S.koreanHolidays[d];});
  const now=new Date();const thisY=now.getFullYear();
  const first=new Date(_trCalYear,_trCalMonth,1);const dow=first.getDay();
  const dim=new Date(_trCalYear,_trCalMonth+1,0).getDate();
  let html='<div style="border:1px solid var(--bdr);border-radius:8px;padding:10px;background:var(--card);min-width:240px;box-shadow:var(--sh)">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  html+='<button data-cal-action="prevMonth" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2)">◀</button>';
  /* 연도 hover */
  html+='<div style="display:flex;gap:2px;align-items:baseline">';
  html+='<div class="tr-cal-year-wrap" style="position:relative;padding-bottom:4px">';
  html+='<span style="font-size:13px;font-weight:800;color:var(--t1);cursor:pointer">'+_trCalYear+'년</span>';
  html+='<div class="dp-dd" style="display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--cyan);border-radius:8px;box-shadow:var(--sh);z-index:500;max-height:200px;overflow-y:auto;scrollbar-width:thin;min-width:90px;padding:4px 0">';
  for(let y=thisY-2;y<=thisY+2;y++){
    html+='<div data-cal-action="setYear" data-year="'+y+'" class="tr-cal-hover-item" style="padding:7px 14px;font-size:12px;cursor:pointer;font-weight:'+(y===_trCalYear?'700':'400')+';color:'+(y===_trCalYear?'var(--cyan)':'var(--t1)')+';text-align:center">'+y+'</div>';
  }
  html+='</div></div>';
  /* 월 hover — 2열 6행 (1~6월 왼쪽, 7~12월 오른쪽) */
  html+='<div class="tr-cal-month-wrap" style="position:relative;padding-bottom:4px">';
  html+='<span style="font-size:13px;font-weight:800;color:var(--t1);cursor:pointer">'+(_trCalMonth+1)+'월</span>';
  html+='<div class="dp-dd" style="display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--cyan);border-radius:8px;box-shadow:var(--sh);z-index:500;min-width:110px;padding:6px;grid-template-columns:1fr 1fr;grid-template-rows:repeat(6,auto);grid-auto-flow:column;gap:2px">';
  for(let m=0;m<12;m++){
    html+='<div data-cal-action="setMonth" data-month="'+m+'" class="tr-cal-hover-item" style="padding:6px 8px;font-size:11px;cursor:pointer;font-weight:'+(m===_trCalMonth?'700':'400')+';color:'+(m===_trCalMonth?'var(--cyan)':'var(--t1)')+';text-align:center;border-radius:4px">'+(m+1)+'월</div>';
  }
  html+='</div></div></div>';
  html+='<button data-cal-action="nextMonth" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2)">▶</button>';
  html+='</div>';
  /* 요일 헤더 */
  html+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){html+='<span style="padding:4px;color:'+(i===0?'var(--rs)':i===6?'#3b82f6':'var(--t3)')+'">'+d+'</span>';});
  html+='</div>';
  /* 날짜 그리드 */
  const todayStr=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  html+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:11px">';
  for(let e=0;e<dow;e++) html+='<span></span>';
  for(let dd=1;dd<=dim;dd++){
    const ds=_trCalYear+'-'+String(_trCalMonth+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
    const isT=(ds===todayStr);
    const ddow=(dow+dd-1)%7;
    const isH=!!holidays[ds];
    const col=(ddow===0||isH)?'var(--rs)':ddow===6?'#3b82f6':'var(--t1)';
    html+='<span data-cal-action="selectDate" data-date="'+ds+'" data-is-today="'+isT+'" class="tr-cal-hover-item" title="'+(holidays[ds]||'')+'" style="padding:5px;cursor:pointer;border-radius:4px;color:'+col+';font-weight:'+(isH||isT?'700':'400')+';'+(isT?'background:var(--cyan);color:#fff;':'')+'transition:background 0.1s">'+dd+'</span>';
  }
  html+='</div></div>';
  wrap.innerHTML=html;
  /* 이벤트 위임 — 달력 */
  wrap.addEventListener('click',function(e){
    const el=e.target.closest('[data-cal-action]');if(!el)return;
    const act=el.dataset.calAction;
    if(act==='prevMonth'){_trCalMonth--;if(_trCalMonth<0){_trCalMonth=11;_trCalYear--;}_trRenderCal();}
    else if(act==='nextMonth'){_trCalMonth++;if(_trCalMonth>11){_trCalMonth=0;_trCalYear++;}_trRenderCal();}
    else if(act==='setYear'){e.stopPropagation();_trCalYear=parseInt(el.dataset.year);_trRenderCal();}
    else if(act==='setMonth'){e.stopPropagation();_trCalMonth=parseInt(el.dataset.month);_trRenderCal();}
    else if(act==='selectDate'){_trSelectDate(el.dataset.date);}
  });
  /* hover 드롭다운 표시/숨김 */
  const yearWrap=wrap.querySelector('.tr-cal-year-wrap');
  if(yearWrap){
    yearWrap.addEventListener('mouseenter',function(){this.querySelector('.dp-dd').style.display='block';});
    yearWrap.addEventListener('mouseleave',function(){this.querySelector('.dp-dd').style.display='none';});
  }
  const monthWrap=wrap.querySelector('.tr-cal-month-wrap');
  if(monthWrap){
    monthWrap.addEventListener('mouseenter',function(){this.querySelector('.dp-dd').style.display='grid';});
    monthWrap.addEventListener('mouseleave',function(){this.querySelector('.dp-dd').style.display='none';});
  }
  /* hover 스타일 */
  wrap.querySelectorAll('.tr-cal-hover-item').forEach(function(el){
    el.addEventListener('mouseenter',function(){
      if(el.dataset.calAction==='selectDate'&&el.dataset.isToday==='true')return;
      el.style.background='var(--hover)';
    });
    el.addEventListener('mouseleave',function(){
      el.style.background=(el.dataset.calAction==='selectDate'&&el.dataset.isToday==='true')?'var(--cyan)':'';
    });
  });
}

function _trSelectDate(ds){
  if(_trCalTarget){
    const el=document.getElementById(_trCalTarget);
    if(el){el.value=ds;el.dispatchEvent(new Event('input',{bubbles:true}));}
    if(_trCalTarget==='trDate'){
      const d2=document.getElementById('trDate2');
      if(d2&&!d2.value){d2.value=ds;d2.dispatchEvent(new Event('input',{bubbles:true}));}
    }
  }
  _trCloseCal();
}

/* 달력 외부 클릭 닫기 — 열린 직후 클릭과 충돌 방지 */
let _trCalJustOpened=false;
document.addEventListener('mousedown',function(e){
  if(_trCalJustOpened)return;
  const wrap=document.getElementById('trCalWrap');
  if(!wrap||wrap.style.display==='none')return;
  if(wrap.contains(e.target))return;
  _trCloseCal();
});

/* ── 시계 피커 (clockPickerWrap 사용) ── */
function trOpenClock(fieldId,ev,btn){
  if(ev)ev.stopPropagation();
  /* 달력 팝업이 열려있으면 닫기 */
  const calWrap=document.getElementById('trCalWrap');
  if(calWrap)calWrap.style.display='none';
  openClockPicker(fieldId,btn);
  const inp=document.getElementById(fieldId);
  if(inp&&fieldId==='trTime'){
    /* 시작 시간 변경 시 종료 시간을 항상 +2시간으로 동기화 */
    if(!inp._trTimeHandler){
      inp._trTimeHandler=function(){
        const v=inp.value;if(!v)return;
        const t2=document.getElementById('trTime2');
        if(t2){
          const pp=v.split(':');let hh=parseInt(pp[0]||0)+2;const mm=parseInt(pp[1]||0);
          if(hh>=24)hh-=24;
          t2.value=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
          t2.dispatchEvent(new Event('input',{bubbles:true}));
        }
        _trainingReadForm();trainingRefreshPreview();
      };
      inp.addEventListener('input',inp._trTimeHandler);
    }
  }
}

/* ── 안내 메시지 미리보기 & 복사 ── */
let _trMsgOpts={isLegal:false,signRemind:false};
let _trMsgEditing=false;
let _trMsgTemplate=null; /* null=기본 템플릿, string=사용자 커스텀 */
const _trMsgDefaultTemplate='[연수 안내] 안녕하세요 선생님들, {일시}에 {연수/교육명}를 실시할 예정입니다. 장소는 {장소} 입니다. 감사합니다.';

function _trMsgGetTemplate(){
  if(_trMsgTemplate!==null)return _trMsgTemplate;
  const saved=localStorage.getItem('tr_msg_template');
  if(saved)return saved;
  return _trMsgDefaultTemplate;
}

function _trMsgResolveVars(tpl){
  const st=_trainingState;
  const o=_trMsgOpts;
  /* {일시} 계산 */
  let dateTimeStr='';
  if(st.date){
    const p1=st.date.split('-');
    let startPart=parseInt(p1[1])+'월 '+parseInt(p1[2])+'일';
    if(st.time)startPart+=' '+st.time;
    if(st.date2&&st.date===st.date2){
      /* 같은 날 */
      dateTimeStr=startPart+(st.time2?' ~ '+st.time2:'');
    } else if(st.date2&&st.date!==st.date2){
      /* 다른 날 */
      const p2=st.date2.split('-');
      let endPart=parseInt(p2[1])+'월 '+parseInt(p2[2])+'일';
      if(st.time2)endPart+=' '+st.time2;
      dateTimeStr=startPart+' ~ '+endPart;
    } else {
      dateTimeStr=startPart;
    }
  }
  const result=tpl
    .replace(/\{일시\}/g,dateTimeStr||'(일시 미정)')
    .replace(/\{연수\/교육명\}/g,st.name||'(연수명 미정)')
    .replace(/\{장소\}/g,st.place||'(장소 미정)');
  /* 체크박스 옵션 추가 */
  let extra='';
  if(o.isLegal) extra+='\n\n이 연수는 법정의무연수로, 1년에 한 번 반드시 이수해야 하는 연수입니다.\n따라서 다른 복무가 없으신 선생님들께서는 연수에 꼭 참여해 주시기 바랍니다.';
  if(o.signRemind) extra+='\n\n연수 참여 전, 입구의 연수 등록부에 자필 서명을 꼭 부탁드립니다.';
  return result+extra;
}

function trShowMessage(){
  _trainingReadForm();
  const o=_trMsgOpts;
  _trMsgEditing=false;
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='trMsgOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let html='<div class="modal-content" style="width:520px;max-width:94vw;padding:0">';
  html+='<div style="background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0;cursor:grab">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)">💬 안내 메시지 미리보기 &amp; 복사</div>';
  html+='<div style="font-size:10px;color:var(--t3);margin-top:3px">아래 옵션을 체크하면 메시지에 자동 반영됩니다. 변수 삽입 버튼으로 원하는 위치에 변수를 넣을 수 있습니다.</div></div>';
  /* 옵션 체크박스 */
  html+='<div style="padding:12px 18px;border-bottom:1px solid var(--bdr);display:flex;flex-wrap:wrap;gap:6px 14px">';
  const opts=[{key:'isLegal',label:'법정의무연수 안내'},{key:'signRemind',label:'자필 서명 안내'}];
  opts.forEach(function(op){
    html+='<label style="font-size:11px;color:var(--t1);display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="trMsgOpt" data-key="'+op.key+'"'+(o[op.key]?' checked':'')+' style="accent-color:var(--cyan)"> '+op.label+'</label>';
  });
  html+='</div>';
  /* 변수 삽입 버튼 */
  html+='<div style="padding:8px 18px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  html+='<span style="font-size:10px;color:var(--t3);font-weight:600">변수 삽입:</span>';
  [{v:'{일시}',l:'일시'},{v:'{연수/교육명}',l:'연수/교육명'},{v:'{장소}',l:'장소'}].forEach(function(vi){
    html+='<button class="trMsgVarBtn" data-var="'+vi.v+'" style="padding:3px 10px;font-size:10px;font-weight:700;background:rgba(6,182,212,0.1);color:var(--cyan);border:1px solid rgba(6,182,212,0.25);border-radius:12px;cursor:pointer;font-family:var(--f)">'+vi.l+'</button>';
  });
  html+='</div>';
  /* 메시지 본문 (수정 가능 textarea) */
  html+='<div style="padding:18px"><textarea id="trMsgBody" style="width:100%;height:220px;padding:12px;font-size:12px;line-height:1.8;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);color:var(--t1);font-family:var(--f);resize:vertical">'+escHtml(_trMsgResolveVars(_trMsgGetTemplate()))+'</textarea></div>';
  /* 하단 — 편집 + 복사 버튼 */
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  html+='<button id="trMsgEditBtn" style="padding:7px 16px;font-size:11px;font-weight:700;background:var(--card);color:var(--t1);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>편집</button>';
  html+='<button id="trMsgCopyBtn" style="padding:7px 16px;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>클립보드에 복사</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  /* 이벤트 바인딩 */
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalWithAnim(ov);});
  /* 체크박스 이벤트 */
  ov.querySelectorAll('.trMsgOpt').forEach(function(chk){
    chk.addEventListener('change',function(){
      _trMsgOpts[this.dataset.key]=this.checked;
      if(!_trMsgEditing){
        document.getElementById('trMsgBody').value=_trMsgResolveVars(_trMsgGetTemplate());
      }
    });
  });
  /* 변수 삽입 버튼 이벤트 */
  ov.querySelectorAll('.trMsgVarBtn').forEach(function(btn){
    btn.addEventListener('click',function(){
      const ta=document.getElementById('trMsgBody');if(!ta)return;
      const start=ta.selectionStart, end=ta.selectionEnd;
      const v=this.dataset.var;
      ta.value=ta.value.substring(0,start)+v+ta.value.substring(end);
      ta.selectionStart=ta.selectionEnd=start+v.length;
      ta.focus();
      _trMsgEditing=true;
    });
  });
  /* textarea 수정 시 자동 저장 — 단 [편집] 모드(템플릿 직접 편집)일 때만 실제 저장+토스트.
     미리보기(변수 치환) 상태 입력은 저장 대상이 아니므로 토스트도 안 띄운다(거짓 신호 제거, 사용자 지시 2026-06-15). */
  let _msgSaveTimer=null;
  ov.querySelector('#trMsgBody').addEventListener('input',function(){
    if(!_trMsgEditing) return;          /* 편집 모드 아니면 저장·토스트 안 함 */
    _trMsgTemplate=this.value;
    localStorage.setItem('tr_msg_template',this.value);   /* 실제 저장 */
    globalSaveToast('저장 중…');
    if(_msgSaveTimer)clearTimeout(_msgSaveTimer);
    _msgSaveTimer=setTimeout(function(){
      globalSaveToast('모든 내용이 저장되었습니다.');
    },400);
  });
  /* 편집 버튼: 템플릿 모드 전환 */
  ov.querySelector('#trMsgEditBtn').addEventListener('click',function(){
    _trMsgEditing=true;
    const ta=document.getElementById('trMsgBody');
    /* 변수가 치환된 상태 → 템플릿 상태로 전환 */
    ta.value=_trMsgGetTemplate();
    ta.focus();
    ta.style.border='2px solid var(--cyan)';
    this.textContent='편집 중…';
    this.style.background='rgba(6,182,212,0.12)';
    this.style.color='var(--cyan)';
    /* 저장은 위 #trMsgBody input 핸들러가 편집 모드일 때 처리(중복 리스너 제거) */
  });
  /* 복사 버튼 */
  ov.querySelector('#trMsgCopyBtn').addEventListener('click',function(){
    const ta=document.getElementById('trMsgBody');if(!ta)return;
    /* 복사 시 변수 치환 */
    const text=_trMsgEditing?_trMsgResolveVars(ta.value):ta.value;
    navigator.clipboard.writeText(text).then(function(){
      const btn=ov.querySelector('#trMsgCopyBtn');
      if(btn){const orig=btn.innerHTML;btn.innerHTML='✓ 복사됨';setTimeout(function(){btn.innerHTML=orig;},1500);}
    });
  });
  document.body.appendChild(ov);
  _makeDraggable(ov.querySelector('.modal-content'));
}

function _trRefreshMsgBody(){
  const body=document.getElementById('trMsgBody');
  if(body&&!_trMsgEditing)body.value=_trMsgResolveVars(_trMsgGetTemplate());
}


/* ── 대상 선택 팝업 ── */
function trOpenTargetSelect(){
  const st=_trainingState;
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='trTargetOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let html='<div class="modal-content" style="width:700px;max-width:96vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;padding:0">';
  /* 헤더 — 회색 배경 */
  html+='<div style="background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));padding:14px 18px;border-bottom:1px solid var(--bdr)">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)">📋 연수/교육 대상 선택</div>';
  html+='<div style="font-size:11px;color:var(--t3);margin-top:3px">교직원 또는 학생을 선택하세요</div>';
  html+='</div>';
  /* 탭 */
  html+='<div style="display:flex;gap:4px;padding:10px 18px 0">';
  html+='<button class="daily-cat-tab active" id="trTargetTabStaff" data-action="switchTab" data-tab="staff">교직원</button>';
  html+='<button class="daily-cat-tab" id="trTargetTabStudent" data-action="switchTab" data-tab="student">학생</button>';
  html+='</div>';
  /* 본문 */
  html+='<div id="trTargetBody" style="flex:1;overflow-y:auto;padding:14px 18px;scrollbar-width:thin;scrollbar-color:rgba(6,182,212,0.4) transparent"></div>';
  /* 하단 버튼 */
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2)">';
  html+='<button class="btn btn-outline btn-sm" id="trTargetBackBtn" data-action="targetBack" style="display:none">← 뒤로</button>';
  html+='<button id="trTargetDoneBtn" data-action="targetComplete" style="padding:7px 22px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f)">다음</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalWithAnim(ov,function(){_trainingReadForm();trainingRefreshPreview();});return;}
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='switchTab') trTargetSwitchTab(el.dataset.tab);
    else if(act==='targetBack') trTargetBack();
    else if(act==='targetComplete') trTargetComplete();
  });
  document.body.appendChild(ov);
  trTargetSwitchTab('staff');
}

let _trTargetStep='main';
let _trTargetSelectedGrades=[];
function trTargetSwitchTab(type){
  /* 탭 전환 시 이전 유형 선택 초기화 */
  const prevType=_trainingState.selectedType;
  if(prevType!==type){
    S.people.forEach(function(s){
      if(prevType==='staff'&&s.type==='staff')delete _trainingState.selectedIds[s.id];
      if(prevType==='student'&&s.type==='student')delete _trainingState.selectedIds[s.id];
    });
  }
  _trainingState.selectedType=type;
  _trTargetStep='main';
  const tabStaff=document.getElementById('trTargetTabStaff');
  const tabStu=document.getElementById('trTargetTabStudent');
  if(tabStaff)tabStaff.classList.toggle('active',type==='staff');
  if(tabStu)tabStu.classList.toggle('active',type==='student');
  const backBtn=document.getElementById('trTargetBackBtn');if(backBtn)backBtn.style.display='none';
  const body=document.getElementById('trTargetBody');if(!body)return;
  const st=_trainingState;
  const _doneBtn=document.getElementById('trTargetDoneBtn');
  if(_doneBtn){_doneBtn.textContent=type==='staff'?'완료':'다음';_doneBtn.style.display=type==='staff'?'inline-block':'none';}

  if(type==='staff'){
    const staffList=sortStaffList(S.people.filter(function(s){return s.type==='staff';}));
    /* 최초 진입 시 전체 선택 */
    const hasAnyStaffSelection=staffList.some(function(s){return st.selectedIds.hasOwnProperty(s.id);});
    if(!hasAnyStaffSelection)staffList.forEach(function(s){st.selectedIds[s.id]=true;});
    let allChecked=true;staffList.forEach(function(s){if(!st.selectedIds[s.id])allChecked=false;});
    let html='<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--t2);display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="trStaffAll"'+(allChecked?' checked':'')+' > 전체 선택</label></div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
    staffList.forEach(function(s){
      const sel=!!st.selectedIds[s.id];
      html+='<span class="sv-student-chip '+(sel?'checked':'unchecked')+'" data-sid="'+s.id+'" data-action="toggleTarget" style="padding:6px 12px;font-size:12px;font-weight:600">'
        +(s.position||'교직원')+' '+s.name+'</span>';
    });
    html+='</div>';
    body.innerHTML=html;
    const _staffAllCb=document.getElementById('trStaffAll');
    if(_staffAllCb)_staffAllCb.addEventListener('change',function(){trToggleAllStaff(this);});
    body.addEventListener('click',function(e){
      const chip=e.target.closest('[data-action="toggleTarget"]');
      if(chip)trToggleTarget(parseInt(chip.dataset.sid),chip);
    });
  } else {
    _trRenderGradeSelect(body);
  }
}

function trToggleAllStaff(el){
  const staffList=S.people.filter(function(s){return s.type==='staff';});
  staffList.forEach(function(s){_trainingState.selectedIds[s.id]=el.checked;});
  document.querySelectorAll('#trTargetBody .sv-student-chip[data-sid]').forEach(function(c){
    c.className='sv-student-chip '+(el.checked?'checked':'unchecked');
  });
}

function trToggleTarget(id,chip){
  _trainingState.selectedIds[id]=!_trainingState.selectedIds[id];
  const sel=_trainingState.selectedIds[id];
  chip.className='sv-student-chip '+(sel?'checked':'unchecked');
  /* 전체선택 체크박스 동기화 */
  const allCb=document.getElementById('trStaffAll')||document.querySelector('.tr-cls-all[data-key]');
  if(document.getElementById('trStaffAll')){
    const staffList=S.people.filter(function(s){return s.type==='staff';});
    let allChecked=true;staffList.forEach(function(s){if(!_trainingState.selectedIds[s.id])allChecked=false;});
    document.getElementById('trStaffAll').checked=allChecked;
  }
  /* 반 전체 체크박스 동기화 */
  if(chip.dataset.cls){
    const clsAll=document.querySelector('.tr-cls-all[data-key="'+chip.dataset.cls+'"]');
    if(clsAll){
      const chips=document.querySelectorAll('.sv-student-chip[data-cls="'+chip.dataset.cls+'"]');
      let allC=true;chips.forEach(function(c){if(!_trainingState.selectedIds[parseInt(c.dataset.sid)])allC=false;});
      clsAll.checked=allC;
    }
  }
}

/* ── 학년 선택 (1단계) ── */
function _trRenderGradeSelect(body){
  const stuList=S.people.filter(function(s){return s.type==='student';});
  const grades=[...new Set(stuList.map(function(s){return s.grade;}))].sort(function(a,b){return a-b;});
  const sl=S.settings.schoolLevel||'elementary';
  let h='<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:14px">학년을 선택하세요</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  h+='<label style="display:flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--cyan);border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;color:var(--t1);background:rgba(6,182,212,0.06);transition:all .15s;margin-right:12px"><input type="checkbox" id="trGradeAll"> 전체 선택</label>';
  grades.forEach(function(g){
    const cnt=stuList.filter(function(s){return s.grade===g;}).length;
    const label=(sl==='kindergarten')?g+'세':g+'학년';
    h+='<label class="tr-grade-label" style="display:flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--bdr);border-radius:8px;cursor:pointer;font-size:12px;color:var(--t2);background:var(--bg2);transition:all .15s">'
      +'<input type="checkbox" class="tr-grade-cb" value="'+g+'"> '+label+'<span style="font-size:10px;color:var(--t3)">('+cnt+'명)</span></label>';
  });
  h+='<button class="sv-btn-primary" id="trStep1Next" data-action="goClassCards" disabled style="opacity:0.5;margin-left:12px;padding:8px 16px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f)">다음 →</button>';
  h+='</div>';
  body.innerHTML=h;
  const _gradeAllCb=document.getElementById('trGradeAll');
  if(_gradeAllCb)_gradeAllCb.addEventListener('change',function(){trToggleAllGrades(this);});
  body.querySelectorAll('.tr-grade-cb').forEach(function(cb){cb.addEventListener('change',function(){trUpdateGradeSelection();});});
  const _step1Next=document.getElementById('trStep1Next');
  if(_step1Next)_step1Next.addEventListener('click',function(){trGoClassCards();});
  body.querySelectorAll('.tr-grade-label').forEach(function(lbl){
    lbl.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';});
    lbl.addEventListener('mouseleave',function(){this.style.borderColor='var(--bdr)';});
  });
}

function trToggleAllGrades(el){
  document.querySelectorAll('.tr-grade-cb').forEach(function(cb){cb.checked=el.checked;});
  trUpdateGradeSelection();
  if(el.checked)setTimeout(function(){trGoClassCards();},300);
}
function trUpdateGradeSelection(){
  const cbs=document.querySelectorAll('.tr-grade-cb:checked');
  const totalCbs=document.querySelectorAll('.tr-grade-cb');
  const btn=document.getElementById('trStep1Next');
  if(btn){btn.disabled=cbs.length===0;btn.style.opacity=cbs.length?'1':'0.5';}
  const all=document.getElementById('trGradeAll');
  if(all)all.checked=cbs.length===totalCbs.length;
  if(cbs.length===totalCbs.length&&totalCbs.length>0){setTimeout(function(){trGoClassCards();},300);}
}

function trGoClassCards(){
  _trTargetSelectedGrades=[];
  document.querySelectorAll('.tr-grade-cb:checked').forEach(function(cb){_trTargetSelectedGrades.push(parseInt(cb.value));});
  if(!_trTargetSelectedGrades.length)return;
  _trTargetStep='class';
  const backBtn=document.getElementById('trTargetBackBtn');if(backBtn)backBtn.style.display='';
  const _db=document.getElementById('trTargetDoneBtn');if(_db){_db.textContent='완료';_db.style.display='inline-block';}
  const body=document.getElementById('trTargetBody');if(!body)return;
  _trRenderClassCards(body);
}

/* ── 반/학생 선택 (2단계) ── */
function _trRenderClassCards(body){
  const stuList=S.people.filter(function(s){return s.type==='student'&&_trTargetSelectedGrades.indexOf(s.grade)!==-1;});
  const groups={};
  stuList.forEach(function(s){const k=s.grade+'-'+s.cls;if(!groups[k])groups[k]={grade:s.grade,cls:s.cls,people:[]};groups[k].people.push(s);});
  Object.keys(groups).forEach(function(k){groups[k].people.sort(function(a,b){return(a.num||0)-(b.num||0);});});
  const keys=Object.keys(groups).sort();
  const sl=S.settings.schoolLevel||'elementary';
  const st=_trainingState;
  /* 초기: 선택 학년 전체 선택 상태 */
  stuList.forEach(function(s){if(!st.selectedIds.hasOwnProperty(s.id))st.selectedIds[s.id]=true;});
  let h='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div style="font-size:14px;font-weight:700;color:var(--t1)">반/학생을 선택하세요.</div>';
  h+='<label style="font-size:11px;color:var(--t2);display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="trClassAllAll" checked> 전체 선택/해제</label></div>';
  h+='<div class="sv-class-list" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;padding-right:4px;padding-bottom:16px;scrollbar-width:thin;scrollbar-color:rgba(6,182,212,0.4) transparent">';
  keys.forEach(function(k){
    const g=groups[k];
    const gradeLabel=(sl==='kindergarten')?g.grade+'세':g.grade+'학년';
    h+='<div class="sv-class-card" style="border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;background:var(--bg2)">'
      +'<div style="display:flex;align-items:center;margin-bottom:6px">'
      +'<div style="font-size:12px;font-weight:700;color:var(--cyan)">'+gradeLabel+' '+g.cls+'반 ('+g.people.length+'명)</div>'
      +'<label style="font-size:10px;color:var(--t2);cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:8px"><input type="checkbox" checked class="tr-cls-all" data-key="'+k+'"> 전체</label></div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    g.people.forEach(function(s){
      const sel=st.selectedIds[s.id]!==false;
      const care=svIsCare(s);const careText=care?svCareLabel(s):'';
      h+='<span class="sv-student-chip '+(sel?'checked':'unchecked')+'" data-sid="'+s.id+'" data-cls="'+k+'" data-action="toggleTarget">'
        +s.num+'번 '+s.name+(care?' <span style="font-size:9px;color:var(--yl)">*'+careText+'*</span>':'')+'</span>';
    });
    h+='</div></div>';
  });
  h+='</div>';
  body.innerHTML=h;
  const _classAllCb=document.getElementById('trClassAllAll');
  if(_classAllCb)_classAllCb.addEventListener('change',function(){trToggleAllClasses(this);});
  body.querySelectorAll('.tr-cls-all').forEach(function(cb){cb.addEventListener('change',function(){trToggleClass(this.dataset.key,this);});});
  body.addEventListener('click',function(e){
    const chip=e.target.closest('[data-action="toggleTarget"]');
    if(chip)trToggleTarget(parseInt(chip.dataset.sid),chip);
  });
}

function trToggleClass(key,el){
  const chips=document.querySelectorAll('#trTargetBody .sv-student-chip[data-cls="'+key+'"]');
  chips.forEach(function(c){
    const sid=parseInt(c.dataset.sid);
    _trainingState.selectedIds[sid]=el.checked;
    c.className='sv-student-chip '+(el.checked?'checked':'unchecked');
  });
}
function trToggleAllClasses(el){
  document.querySelectorAll('#trTargetBody .sv-student-chip[data-sid]').forEach(function(c){
    const sid=parseInt(c.dataset.sid);
    _trainingState.selectedIds[sid]=el.checked;
    c.className='sv-student-chip '+(el.checked?'checked':'unchecked');
  });
  document.querySelectorAll('.tr-cls-all').forEach(function(cb){cb.checked=el.checked;});
}

function trTargetBack(){
  if(_trTargetStep==='class'){
    _trTargetStep='main';
    const backBtn=document.getElementById('trTargetBackBtn');if(backBtn)backBtn.style.display='none';
    const _db2=document.getElementById('trTargetDoneBtn');if(_db2)_db2.textContent='다음';
    const body=document.getElementById('trTargetBody');if(body)_trRenderGradeSelect(body);
  }
}

function trTargetComplete(){
  const ov=document.getElementById('trTargetOverlay');if(ov)closeModalGracefully(ov);
  _trainingReadForm();trainingRefreshPreview();
  renderTrainingHome();
}

/* ── 폼 읽기 ── */
function _trainingReadForm(){
  const st=_trainingState;let el;
  el=document.getElementById('trName');if(el)st.name=el.value;
  el=document.getElementById('trDate');if(el)st.date=el.value;
  el=document.getElementById('trTime');if(el)st.time=el.value;
  el=document.getElementById('trDate2');if(el)st.date2=el.value;
  el=document.getElementById('trTime2');if(el)st.time2=el.value;
  el=document.getElementById('trPlace');if(el)st.place=el.value;
  el=document.getElementById('trSortNote');if(el)st.sortNote=el.value;
  el=document.getElementById('trSortNoteOn');if(el)st.sortNoteOn=el.checked;
}

/* ── 미리보기 갱신 (구글 시트 스타일) ── */
function trainingRefreshPreview(){
  const wrap=document.getElementById('trPreviewA4Wrap');
  if(!wrap)return;
  const st=_trainingState;
  const yr=new Date().getFullYear();
  const selected=_trSortSelected(S.people.filter(function(s){return st.selectedIds[s.id];}));
  const isStudent=selected.length>0&&selected[0].type==='student';
  const posLabel=isStudent?'학번':'직위';
  const ROWS_PER_PAGE=24; /* 한 페이지 당 좌우 각 24행 = 48명 */
  const MARGIN='padding:20mm';
  const ln='border:1px solid #c0c0c0;';
  const bi='border:1px solid #c0c0c0;';
  const bdE='border:1px solid #c0c0c0;border-right:2px solid #333;';
  const pd='padding:3px 5px;';const ctr='text-align:center;';

  /* 전체 인원 기준 페이지 계산: 한 페이지 = 좌24 + 우24 = 48명 */
  const totalSlots=Math.max(selected.length,ROWS_PER_PAGE*2);
  const totalPages=Math.ceil(totalSlots/(ROWS_PER_PAGE*2));
  let allHtml='';

  for(let page=0;page<totalPages;page++){
    const pageStart=page*ROWS_PER_PAGE*2; /* 이 페이지 시작 인덱스 */
    let h='<div style="'+MARGIN+';font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000'+(page>0?';border-top:3px dashed #ccc;margin-top:20px;padding-top:24px':'')+'">';
    /* 헤더 — 색상선 좌우에 박스 테두리 정렬 (제목·정보 행과 폭 일치) */
    h+='<div style="height:12px;display:flex;margin-bottom:0;border-left:1px solid #c0c0c0;border-right:1px solid #c0c0c0;border-top:1px solid #c0c0c0"><div style="flex:7;background:#2855A0"></div><div style="flex:3;background:#D4A843"></div></div>';
    const titleName=escHtml(st.name);
    h+='<div style="background:#F7F7F7;text-align:center;padding:10px 16px;font-size:16px;font-weight:700;letter-spacing:3px;border-left:1px solid #c0c0c0;border-right:1px solid #c0c0c0">'+(titleName?yr+'학년도 '+titleName+' 등록부':'&nbsp;')+'</div>';
    h+='<div style="height:12px;display:flex;border-left:1px solid #c0c0c0;border-right:1px solid #c0c0c0"><div style="flex:3;background:#2E8B57"></div><div style="flex:7;background:#C0392B"></div></div>';
    h+='<div style="padding:4px 5px;font-size:10px;color:#333;border-left:1px solid #c0c0c0;border-right:1px solid #c0c0c0">◆ 일시: '+_formatTrainingDateTime()+'</div>';
    h+='<div style="padding:4px 5px;font-size:10px;color:#333;border-left:1px solid #c0c0c0;border-right:1px solid #c0c0c0">◆ 장소: '+(escHtml(st.place)||'')+'</div>';
    if(st.sortNoteOn&&st.sortNote){h+='<div style="padding:2px 5px;font-size:9px;color:#555;text-align:right;border-left:1px solid #c0c0c0;border-right:1px solid #c0c0c0">'+escHtml(st.sortNote)+'</div>';}
    /* 표 */
    h+='<table style="width:100%;border-collapse:collapse;font-size:9px;margin-top:0">';
    /* 컬럼 헤더 */
    h+='<tr style="background:#e8f4f8">';
    for(let side=0;side<2;side++){
      h+='<td style="'+bi+pd+ctr+'font-weight:700;font-size:8px;width:22px'+(side===0?';border-left:2px solid #333':'')+';border-top:2px solid #333">순</td>';
      h+='<td style="'+bi+pd+ctr+'font-weight:700;font-size:8px;width:32px;border-top:2px solid #333">'+posLabel+'</td>';
      h+='<td style="'+bi+pd+ctr+'font-weight:700;font-size:8px;width:68px;border-top:2px solid #333">성명</td>';
      h+='<td style="'+bi+pd+ctr+'font-weight:700;font-size:8px;width:60px;border-top:2px solid #333">서명</td>';
      h+='<td style="'+(side===0?bdE:bi)+pd+ctr+'font-weight:700;font-size:8px;border-top:2px solid #333'+(side===1?';border-right:2px solid #333':'')+'">비고</td>';
    }
    h+='</tr>';
    /* 데이터 행 */
    for(let i=0;i<ROWS_PER_PAGE;i++){
      const isLast=i===ROWS_PER_PAGE-1;
      const btm=isLast?'border-bottom:2px solid #333;':'';
      h+='<tr>';
      /* 좌측 번호: pageStart + i + 1 */
      const leftIdx=pageStart+i;
      const leftNum=leftIdx+1;
      const sL=selected[leftIdx];
      const lL='border-left:2px solid #333;';
      const rE=bdE;
      if(sL){
        const posL=isStudent?(sL.grade+'-'+sL.cls+' '+sL.num+'번'):(escHtml(sL.position)||'');
        h+='<td style="'+bi+pd+ctr+lL+btm+'">'+leftNum+'</td>';
        h+='<td style="'+bi+pd+ctr+btm+'">'+posL+'</td>';
        h+='<td style="'+bi+pd+ctr+btm+'font-weight:600">'+escHtml(sL.name)+'</td>';
        h+='<td style="'+bi+pd+btm+'">&nbsp;</td><td style="'+rE+pd+btm+'">&nbsp;</td>';
      } else {
        h+='<td style="'+bi+pd+ctr+lL+btm+'">'+leftNum+'</td>';
        h+='<td style="'+bi+pd+btm+'">&nbsp;</td><td style="'+bi+pd+btm+'">&nbsp;</td><td style="'+bi+pd+btm+'">&nbsp;</td>';
        h+='<td style="'+rE+pd+btm+'">&nbsp;</td>';
      }
      /* 우측 번호: pageStart + ROWS_PER_PAGE + i + 1 */
      const rightIdx=pageStart+ROWS_PER_PAGE+i;
      const rightNum=rightIdx+1;
      const sR=selected[rightIdx];
      const rR='border-right:2px solid #333;';
      if(sR){
        const posR=isStudent?(sR.grade+'-'+sR.cls+' '+sR.num+'번'):(escHtml(sR.position)||'');
        h+='<td style="'+bi+pd+ctr+btm+'">'+rightNum+'</td>';
        h+='<td style="'+bi+pd+ctr+btm+'">'+posR+'</td>';
        h+='<td style="'+bi+pd+ctr+btm+'font-weight:600">'+escHtml(sR.name)+'</td>';
        h+='<td style="'+bi+pd+btm+'">&nbsp;</td><td style="'+bi+pd+btm+rR+'">&nbsp;</td>';
      } else {
        h+='<td style="'+bi+pd+ctr+btm+'">'+rightNum+'</td>';
        h+='<td style="'+bi+pd+btm+'">&nbsp;</td><td style="'+bi+pd+btm+'">&nbsp;</td><td style="'+bi+pd+btm+'">&nbsp;</td>';
        h+='<td style="'+bi+pd+btm+rR+'">&nbsp;</td>';
      }
      h+='</tr>';
    }
    h+='</table>';
    h+='<div style="font-size:9px;color:#555;margin-top:4px">자필로 직접 서명 바랍니다.</div>';
    if(totalPages>1)h+='<div style="text-align:right;font-size:9px;color:#999;margin-top:4px">('+(page+1)+' / '+totalPages+' 페이지)</div>';
    h+='</div>';
    allHtml+=h;
  }
  wrap.innerHTML=allHtml;
}

function _formatTrainingDate(dateStr,timeStr){
  if(!dateStr)return '';
  const parts=dateStr.split('-');
  const y=parts[0], m=parseInt(parts[1]), d=parseInt(parts[2]);
  const dow=['일','월','화','수','목','금','토'][new Date(+y,m-1,d).getDay()];
  let result=y+'. '+m+'. '+d+'. ('+dow+')';
  if(timeStr)result+=', '+timeStr;
  return result;
}
function _formatTrainingDateTime(){
  const st=_trainingState;
  const start=_formatTrainingDate(st.date,st.time);
  const end=_formatTrainingDate(st.date2,st.time2);
  if(!start)return '';
  if(end){
    if(st.date===st.date2){
      /* 같은 날이면 시간만 표시 */
      return start+(st.time2?' ~ '+st.time2:'');
    }
    return start+' ~ '+end;
  }
  return start;
}

function _buildTrainingPreviewHtml(){
  const st=_trainingState;
  const yr=new Date().getFullYear();
  const selected=_trSortSelected(S.people.filter(function(s){return st.selectedIds[s.id];}));
  const bd='border:1px solid #bbb;';const pd='padding:4px 6px;';const ctr='text-align:center;';
  let h='<div style="font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000;width:100%">';
  /* 제목 상단 색상선 + 제목 + 하단 색상선 — thead에 포함하여 페이지 반복 */
  const isStudent=selected.length>0&&selected[0].type==='student';
  const half=Math.ceil(selected.length/2);
  let maxRows=Math.max(half,selected.length-half,1);
  if(maxRows<24)maxRows=24;
  const posLabel=isStudent?'학번':'직위';
  h+='<table style="width:100%;border-collapse:collapse;font-size:10px">';
  /* thead — 제목+정보+컬럼헤더 (인쇄 시 매 페이지 반복) */
  h+='<thead>';
  h+='<tr><td colspan="10" style="padding:0;border:none"><table style="width:100%;border-collapse:collapse;margin-bottom:0"><tbody>'
    +'<tr><td colspan="7" style="background:#2855A0;height:12px;padding:0;border:none"></td><td colspan="3" style="background:#D4A843;height:12px;padding:0;border:none"></td></tr>'
    +'<tr><td colspan="10" style="background:#F7F7F7;text-align:center;padding:10px 16px;border:none;font-size:16px;font-weight:700;color:#000;letter-spacing:3px">'+(escHtml(st.name)?(yr+'학년도 '+escHtml(st.name)+' 등록부'):'&nbsp;')+'</td></tr>'
    +'<tr><td colspan="3" style="background:#2E8B57;height:12px;padding:0;border:none"></td><td colspan="7" style="background:#C0392B;height:12px;padding:0;border:none"></td></tr>'
    +'</tbody></table>'
    +'<div style="padding:14px 4px 12px"><div style="font-size:11px;margin-bottom:3px;color:#333">◆ 일시: '+_formatTrainingDateTime()+'</div>'
    +'<div style="font-size:11px;color:#333">◆ 장소: '+(escHtml(st.place)||'')+'</div></div></td></tr>';
  if(st.sortNoteOn&&st.sortNote){h+='<tr><td colspan="10" style="border:none;text-align:right;padding:2px 4px;font-size:10px;color:#555">'+escHtml(st.sortNote)+'</td></tr>';}
  const bdo='border:1px solid #bbb;'; /* 내부 */
  const bdE5='border:1px solid #bbb;border-right:2px solid #333;'; /* 비고/순 경계 */
  h+='<tr>'
    +'<th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-left:2px solid #333;border-top:2px solid #333;width:22px">순</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333">'+posLabel+'</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333;width:45px">성명</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333;width:70px">서명</th><th style="'+bdE5+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333">비고</th>'
    +'<th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333;width:22px">순</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333">'+posLabel+'</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333;width:45px">성명</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333;width:70px">서명</th><th style="'+bdo+pd+ctr+'background:#F7F7F7;font-weight:700;border-top:2px solid #333;border-right:2px solid #333">비고</th>'
    +'</tr></thead><tbody>';
  if(!selected.length){h+='<tr><td colspan="10" style="'+bd+'padding:20px;color:#999;text-align:center">연수/교육 대상을 선택해 주세요</td></tr>';}
  else{for(let ri=0;ri<maxRows;ri++){
    h+='<tr>';
    const isLastRow=ri===maxRows-1;
    const btmS=isLastRow?'border-bottom:2px solid #333;':'';
    function _trCell(idx,isLeft){
      const lB=isLeft?'border-left:2px solid #333;':'';
      const rB=isLeft?bdE5:bdo;
      const rBLast=isLeft?'':';border-right:2px solid #333';
      if(idx<selected.length){
        const s=selected[idx];
        const pos=isStudent?(s.grade+'-'+s.cls+' '+s.num+'번'):(escHtml(s.position)||'');
        return '<td style="'+bdo+pd+ctr+lB+btmS+'">'+(idx+1)+'</td><td style="'+bdo+pd+ctr+btmS+'">'+pos+'</td><td style="'+bdo+pd+ctr+btmS+'">'+escHtml(s.name)+'</td><td style="'+bdo+pd+btmS+'">&nbsp;</td><td style="'+rB+pd+btmS+rBLast+'">&nbsp;</td>';
      }
      return '<td style="'+bdo+pd+ctr+lB+btmS+'">'+(idx+1)+'</td><td style="'+bdo+pd+btmS+'">&nbsp;</td><td style="'+bdo+pd+btmS+'">&nbsp;</td><td style="'+bdo+pd+btmS+'">&nbsp;</td><td style="'+rB+pd+btmS+rBLast+'">&nbsp;</td>';
    }
    h+=_trCell(ri,true)+_trCell(half+ri,false);
    h+='</tr>';}}
  h+='</tbody><tfoot><tr><td colspan="10" style="border:none;padding:4px 0;font-size:10px;color:#555">자필로 직접 서명 바랍니다.</td></tr></tfoot></table></div>';
  return h;
}

/* ── 인쇄용 HTML 생성 ── */
function _trPrintHtml(){
  _trainingReadForm();
  const st=_trainingState;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>연수 & 교육 등록부</title>'
    +'<style>'
    +'@page{size:A4;margin:10mm}tr{page-break-inside:avoid}'
    +'body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","맑은 고딕",sans-serif;margin:0;padding:'+st.marginTop+'mm '+st.marginRight+'mm '+st.marginBottom+'mm '+st.marginLeft+'mm;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}'
    +'table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 6px;font-size:10px}'
    +'thead{display:table-header-group}tfoot{display:table-footer-group}'
    +'@media screen{body{max-width:210mm;margin:0 auto;box-shadow:0 0 10px rgba(0,0,0,0.1)}}'
    +'</style></head><body>'
    +_buildTrainingPreviewHtml()
    +'</body></html>';
}

function trainingPrint(){
  const html=_trPrintHtml();
  const w=window.open('','_blank','width=800,height=1000');
  w.document.write(html);w.document.close();
  setTimeout(function(){w.print();},500);
}

async function trExportPDF(){
  const html=_trPrintHtml();
  const st=_trainingState;
  const yr=new Date().getFullYear();
  const fileName=yr+'학년도 '+(st.name||'연수_교육_등록부').replace(/[\/\\:*?"<>|]/g,'_')+'.pdf';
  try{
    const res=await window.electronAPI.printToPDF(html,{fileName:fileName});
    if(res.success){
      alert('PDF가 저장되었습니다.\n'+res.filePath);
    } else if(res.error!=='cancelled'){
      alert('PDF 저장 실패: '+res.error);
    }
  }catch(err){
    alert('PDF 저장 오류: '+err.message);
  }
}

/* ── Google Sheets 내보내기 (새 스프레드시트 자동 생성) ── */
function trExportSheets(){
  _trainingReadForm();
  const st=_trainingState;
  const selected=_trSortSelected(S.people.filter(function(s){return st.selectedIds[s.id];}));
  const isStudent=selected.length>0&&selected[0].type==='student';
  const yr=new Date().getFullYear();
  const posLabel=isStudent?'학번':'직위';
  const isStudentExport=selected.length>0&&selected[0].type==='student';
  const regTypeExport=isStudentExport?'교육':'연수';
  const titleText=st.name?(yr+'학년도 '+st.name+' 등록부'):'등록부';

  /* 시트 데이터 구성 */
  const rows=[];
  rows.push(['','','','','','','','','','']); /* 1행: 색상선 */
  rows.push([titleText,'','','','','','','','','']); /* 2행: 제목 */
  rows.push(['','','','','','','','','','']); /* 3행: 색상선 */
  rows.push(['','','','','','','','','','']); /* 4행: 여백 */
  rows.push(['◆ 일시: '+_formatTrainingDateTime(),'','','','','◆ 장소: '+(st.place||''),'','','','']); /* 5행 */
  rows.push(['','','','','','','','','','']); /* 6행: 여백 */
  rows.push([(st.sortNoteOn&&st.sortNote)?st.sortNote:'','','','','','','','','','']); /* 7행 */
  rows.push(['순',posLabel,'성명','서명','비고','순',posLabel,'성명','서명','비고']); /* 8행 */
  const half=Math.ceil(selected.length/2);
  let maxRows=Math.max(half,selected.length-half,1);
  if(maxRows<24)maxRows=24;
  for(let ri=0;ri<maxRows;ri++){
    const row=[];
    function addCell(idx){
      if(idx<selected.length){
        const s=selected[idx];
        const pos=isStudent?(s.grade+'-'+s.cls+' '+s.num+'번'):(s.position||'');
        row.push(String(idx+1),pos,s.name,'','');
      } else {
        row.push(String(idx+1),'','','','');
      }
    }
    addCell(ri);addCell(half+ri);
    rows.push(row);
  }
  rows.push(['자필로 직접 서명 바랍니다.','','','','','','','','','']);

  /* 확인 팝업 */
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='trSheetsOverlay';ov.style.background='rgba(0,0,0,0.35)';ov.style.backdropFilter='none';ov.style.webkitBackdropFilter='none';
  let html='<div class="modal-content" style="width:440px;max-width:94vw;padding:0">';
  html+='<div style="background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 내보내기</div></div>';
  html+='<div style="padding:18px">';
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#34a853,#1e8e3e);display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg></div>';
  html+='<div><div style="font-size:13px;font-weight:700;color:var(--t1)">내 Google 드라이브에 저장</div>';
  html+='<div style="font-size:10px;color:var(--t3)">새 스프레드시트가 자동으로 생성됩니다</div></div></div>';
  html+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11px;color:var(--t2)">';
  html+='<div style="margin-bottom:6px"><strong>파일명:</strong> '+escHtml(titleText)+'</div>';
  html+='<div style="margin-bottom:6px"><strong>대상:</strong> '+selected.length+'명</div>';
  html+='<div><strong>총 행:</strong> '+(rows.length)+'행 (헤더 포함)</div>';
  html+='</div>';
  html+=_sheetsAccountHtml('trSheetsAcct');
  html+='</div>';
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  html+='<button data-action="closeSheetsOverlay" style="padding:7px 16px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>';
  html+='<button id="trSheetsSendBtn" style="padding:7px 22px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const el=e.target.closest('[data-action]');if(!el)return;
    if(el.dataset.action==='closeSheetsOverlay')closeModalGracefully(ov);
    else if(el.dataset.action==='openExternal')window.electronAPI.openExternal(el.dataset.url);
  });
  document.body.appendChild(ov);
  _sheetsAccountInit('trSheetsAcct');

  document.getElementById('trSheetsSendBtn').addEventListener('click',function(){
    _trSheetsSend(titleText,rows,selected,isStudent,posLabel,half,maxRows);
  });
}

async function _trSheetsSend(titleText,rows,selected,isStudent,posLabel,half,maxRows){
  const btn=document.getElementById('trSheetsSendBtn');
  btn.disabled=true;btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';

  try{
    btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 서식 준비 중...';
    const totalRows=rows.length;
    const fmtReqs=[];

    /* 1행: 색상선 — pixelSize:2 (선처럼) */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:2},fields:'pixelSize'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:7},cell:{userEnteredFormat:{backgroundColor:{red:0.157,green:0.333,blue:0.627}}},fields:'userEnteredFormat.backgroundColor'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:7,endColumnIndex:10},cell:{userEnteredFormat:{backgroundColor:{red:0.831,green:0.659,blue:0.263}}},fields:'userEnteredFormat.backgroundColor'}});

    /* 2행: 제목 병합 + 가운데 정렬 + 굵게 */
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:10},mergeType:'MERGE_ALL'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{bold:true,fontSize:14},backgroundColor:{red:0.969,green:0.969,blue:0.969}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'}});

    /* 3행: 색상선 — pixelSize:2 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:2,endIndex:3},properties:{pixelSize:2},fields:'pixelSize'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:3},cell:{userEnteredFormat:{backgroundColor:{red:0.180,green:0.545,blue:0.341}}},fields:'userEnteredFormat.backgroundColor'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:3,endColumnIndex:10},cell:{userEnteredFormat:{backgroundColor:{red:0.753,green:0.224,blue:0.169}}},fields:'userEnteredFormat.backgroundColor'}});

    /* 4행: 여백 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:3,endIndex:4},properties:{pixelSize:10},fields:'pixelSize'}});

    /* 5행: 일시/장소 병합 */
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:5},mergeType:'MERGE_ALL'}});
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:5,endColumnIndex:10},mergeType:'MERGE_ALL'}});

    /* 6행: 여백 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:5,endIndex:6},properties:{pixelSize:6},fields:'pixelSize'}});

    /* 7행: 안내 병합 */
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:6,endRowIndex:7,startColumnIndex:0,endColumnIndex:10},mergeType:'MERGE_ALL'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:6,endRowIndex:7},cell:{userEnteredFormat:{textFormat:{fontSize:9,italic:true}}},fields:'userEnteredFormat.textFormat'}});

    /* 8행: 헤더행 배경색 + 굵게 + 가운데 */
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:7,endRowIndex:8,startColumnIndex:0,endColumnIndex:10},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{bold:true,fontSize:9},backgroundColor:{red:0.91,green:0.96,blue:0.97}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'}});

    /* 데이터 영역 가운데 정렬 + 테두리 */
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:7,endRowIndex:totalRows-1,startColumnIndex:0,endColumnIndex:10},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{fontSize:9},borders:{top:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},bottom:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},left:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},right:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,borders)'}});

    /* E열 오른쪽 굵은 선 */
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:7,endRowIndex:totalRows-1,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{borders:{right:{style:'SOLID_MEDIUM',color:{red:0.3,green:0.3,blue:0.3}}}}},fields:'userEnteredFormat.borders.right'}});

    /* 마지막행 (서명 안내) 병합 */
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:totalRows-1,endRowIndex:totalRows,startColumnIndex:0,endColumnIndex:10},mergeType:'MERGE_ALL'}});

    /* 열 너비 조절 */
    const colWidths=[35,80,70,70,60,35,80,70,70,60];
    colWidths.forEach(function(w,i){
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});
    });

    /* 행 높이 (데이터) */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:8,endIndex:totalRows-1},properties:{pixelSize:24},fields:'pixelSize'}});
    /* 데이터 영역 밖의 빈 셀 제거 (기본 26cols × 1000rows → 사용 범위로 축소) */
    const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
    const _trColCount=10;
    if(_trColCount<DEFAULT_COLS){
      fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:_trColCount,endIndex:DEFAULT_COLS}}});
    }
    if(totalRows<DEFAULT_ROWS){
      fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:totalRows,endIndex:DEFAULT_ROWS}}});
    }
    btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';
    const createRes=await window.sheetsExportWithConsent({
      title:titleText,
      sheetTitle:'등록부',
      range:'등록부!A1',
      values:rows,
      requests:fmtReqs
    });
    if(!createRes.success) throw new Error(createRes.error||'스프레드시트 생성 실패');
    const ssId=createRes.spreadsheetId;
    const ssUrl=createRes.spreadsheetUrl;

    /* 4. 완료 — 링크 표시 */
    btn.style.background='#22c55e';
    btn.innerHTML='✓ 완료!';
    const body=document.querySelector('#trSheetsOverlay .modal-content > div:nth-child(2)');
    if(body){
      body.innerHTML='<div style="text-align:center;padding:10px 0">'
        +'<div style="font-size:40px;margin-bottom:10px">✅</div>'
        +'<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:6px">Google Sheets에 저장 완료!</div>'
        +'<div style="font-size:11px;color:var(--t3);margin-bottom:14px">내 Google 드라이브에 새 스프레드시트가 생성되었습니다.</div>'
        +'<button data-action="openExternal" data-url="'+ssUrl+'" style="padding:10px 24px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:6px">'
        +'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        +'Google Sheets에서 열기</button>'
        +'</div>';
    }
    /* 닫기 버튼만 남기기 */
    const footer=document.querySelector('#trSheetsOverlay .modal-content > div:last-child');
    if(footer){footer.innerHTML='<button data-action="closeSheetsOverlay" style="padding:7px 20px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">닫기</button>';}

  }catch(err){
    alert('Google Sheets 내보내기 실패:\n'+err.message);
    btn.disabled=false;btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg> 생성 및 보내기';
  }
}

/* ═══ 연수 서브탭 전환 ═══ */
export function trSwitchSub(sub){
  document.getElementById('trSubReg').style.display=sub==='reg'?'block':'none';
  document.getElementById('trSubStatus').style.display=sub==='status'?'block':'none';
  document.getElementById('trSubTabReg').classList.toggle('active',sub==='reg');
  document.getElementById('trSubTabStatus').classList.toggle('active',sub==='status');
  if(sub==='reg')renderTrainingHome();
  if(sub==='status')renderTrainingStatus();
}

/* ═══ 이수 현황 ═══ */
const _trsItems=JSON.parse(localStorage.getItem('trs_items')||'[]');
/* 각 item: {id, name, deadline, isLegal, siteUrl, createdAt, message, completions:{staffId:certNo}, sheetId} */
function _trsSave(){localStorage.setItem('trs_items',JSON.stringify(_trsItems));}
/* 기본 연수 항목 자동 생성 */
if(_trsItems.length===0){
  const yr=new Date().getFullYear();
  const dl=yr+'-12-15';
  const today=yr+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0');
  _trsItems.push({id:1,name:'성희롱·성폭력·성매매 예방 원격연수',deadline:dl,isLegal:true,siteUrl:'',createdAt:today,message:'',completions:{},certInstitutions:{},institutions:[],sheetId:null});
  _trsItems.push({id:2,name:'심폐소생술 이론 원격연수',deadline:dl,isLegal:true,siteUrl:'',createdAt:today,message:'',completions:{},certInstitutions:{},institutions:[],sheetId:null});
  _trsSave();
}

let _trsOpenIdx=null;
function renderTrainingStatus(){
  const area=document.getElementById('trainingStatusArea');if(!area)return;
  const staffList=sortStaffList(S.people.filter(function(s){return s.type==='staff';}));
  const totalStaff=staffList.length;
  const yr=new Date().getFullYear();
  const schoolName=S.settings.schoolName||'○○학교';
  const numTr=_trsItems.length;
  /* 열 구성: 순(A) + 직위(B) + 이름(C) + [연수1: 이수기관(D), 이수번호(E)] + [연수2: F, G] + ... */
  const fixedCols=3; /* A,B,C */
  const totalCols=fixedCols+numTr*2;
  const colLetters=[];for(let ci=0;ci<totalCols;ci++){colLetters.push(ci<26?String.fromCharCode(65+ci):(String.fromCharCode(64+Math.floor(ci/26))+String.fromCharCode(65+ci%26)));}

  let h='<div style="display:flex;height:calc(100vh - 300px);overflow:hidden">';
  /* ═══ 왼쪽: 헤더 + 스크롤 리스트 + 고정 하단 버튼 ═══ */
  h+='<div style="width:350px;flex-shrink:0;background:var(--card);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden">';
  /* 헤더 */
  h+='<div style="flex-shrink:0;padding:12px 14px;border-bottom:1px solid var(--bdr)">';
  h+='<div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:4px">연수 이수 현황</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:8px">연수를 추가하면 오른쪽 시트에 열이 추가됩니다.</div>';
  h+='<button data-trs-action="addNew" style="width:100%;padding:6px;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">+ 연수 추가</button>';
  h+='</div>';
  /* 스크롤 가능한 리스트 */
  h+='<div style="flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin">';
  if(numTr===0){
    h += (typeof createEmptyState==='function')
      ? createEmptyState({icon:'📋',title:'등록된 연수가 없습니다',desc:'+ 연수 추가 버튼으로 새 연수를 등록하세요.'})
      : '<div style="text-align:center;padding:30px 14px;color:var(--t3)"><div style="font-size:28px;margin-bottom:6px">📋</div><div style="font-size:11px;font-weight:600">등록된 연수가 없습니다.</div></div>';
  } else {
    _trsItems.forEach(function(item,idx){
      h+='<div data-trs-action="editItem" data-idx="'+idx+'" class="trs-list-item" style="padding:8px 14px;cursor:pointer;transition:all .12s;border-left:3px solid transparent;border-bottom:1px solid var(--bdr)">';
      h+='<div style="font-size:11px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(item.name)+'</div>';
      h+='<div style="font-size:9px;color:var(--t3);margin-top:2px">';
      if(item.isLegal)h+='<span style="color:#ef4444;font-weight:700">법정</span> · ';
      if(item.deadline)h+='기한: '+item.deadline;
      h+='</div></div>';
    });
  }
  h+='</div>'; /* 스크롤 리스트 닫기 */
  /* 하단 고정 버튼 */
  h+='<div style="flex-shrink:0;padding:10px 14px;border-top:1px solid var(--bdr);display:flex;flex-direction:column;gap:6px">';
  h+='<button data-trs-action="showMessagePopup" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(168,85,247,0.08));color:#c084fc;border:1px solid rgba(168,85,247,0.25);border-radius:7px;cursor:pointer;font-family:var(--f)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>안내 메시지 미리보기 & 복사</button>';
  h+='<button data-trs-action="showNoticeLog" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(245,158,11,0.08));color:#fbbf24;border:1px solid rgba(245,158,11,0.25);border-radius:7px;cursor:pointer;font-family:var(--f)">📝 안내 내역 기록에 남기기</button>';
  h+='<div style="display:flex;flex-direction:column;gap:6px">';
  h+='<button data-trs-action="exportAllSheets" style="width:100%;padding:9px 14px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 6px rgba(52,168,83,0.25);display:flex;align-items:center;justify-content:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</button>';
  h+='<button class="btn-pdf btn-block" data-trs-action="exportPDF" style="padding:9px 14px">📄 PDF 저장</button>';
  h+='<button class="btn-print btn-block" data-trs-action="trsPrint" style="padding:9px 14px">🖨 인쇄</button>';
  h+='</div></div>';
  h+='</div>';

  /* ═══ 오른쪽: 통합 구글 시트 미리보기 ═══ */
  h+='<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg2)">';
  if(numTr===0){
    h+='<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:13px;font-weight:600">왼쪽에서 연수를 추가해 주세요.</div>';
  } else {
    h+='<div style="flex:1;overflow:auto;padding:20px;display:flex;justify-content:center">';
    h+='<div style="background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.1);display:inline-block;align-self:flex-start;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000">';
    const bd='border:1px solid #c0c0c0;';const bdt='border:2px solid #333;';const pd='padding:3px 5px;';const ctr='text-align:center;';
    const nb='border:none;'; /* no border */
    h+='<table style="border-collapse:collapse;font-size:9px">';
    /* 열 헤더 행 */
    h+='<tr style="background:#f0f0f0;height:18px">';
    h+='<td style="'+bd+ctr+'width:22px;color:#666;font-size:8px;font-weight:600;background:#f8f8f8"></td>';
    colLetters.forEach(function(c){h+='<td style="'+bd+ctr+'color:#666;font-size:8px;font-weight:600;background:#f8f8f8;min-width:50px">'+c+'</td>';});
    h+='</tr>';
    /* 1행: 색상선 (좌우 테두리 없음) */
    h+='<tr style="height:2px"><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">1</td>';
    const halfCols=Math.ceil(totalCols/2);
    h+='<td colspan="'+halfCols+'" style="border-top:1px solid #c0c0c0;border-bottom:1px solid #c0c0c0;border-left:none;border-right:none;background:#2855A0;padding:0;line-height:1px;font-size:1px">&nbsp;</td>';
    h+='<td colspan="'+(totalCols-halfCols)+'" style="border-top:1px solid #c0c0c0;border-bottom:1px solid #c0c0c0;border-left:none;border-right:none;background:#D4A843;padding:0;line-height:1px;font-size:1px">&nbsp;</td></tr>';
    /* 2행: 제목 (좌우 테두리 없음) */
    h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">2</td>';
    h+='<td colspan="'+totalCols+'" style="border-top:none;border-bottom:none;border-left:none;border-right:none;background:#F7F7F7;text-align:center;padding:4px 12px;font-size:12px;font-weight:700;letter-spacing:2px">'+yr+'학년도 '+escHtml(schoolName)+' 보건 연수 이수 현황</td></tr>';
    /* 3행: 색상선 (좌우 테두리 없음) */
    h+='<tr style="height:2px"><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">3</td>';
    const halfCols2=Math.ceil(totalCols*3/10);
    h+='<td colspan="'+halfCols2+'" style="border-top:1px solid #c0c0c0;border-bottom:1px solid #c0c0c0;border-left:none;border-right:none;background:#2E8B57;padding:0;line-height:1px;font-size:1px">&nbsp;</td>';
    h+='<td colspan="'+(totalCols-halfCols2)+'" style="border-top:1px solid #c0c0c0;border-bottom:1px solid #c0c0c0;border-left:none;border-right:none;background:#C0392B;padding:0;line-height:1px;font-size:1px">&nbsp;</td></tr>';
    /* 4행: 여백 (테두리 없음) */
    h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">4</td>';
    h+='<td colspan="'+totalCols+'" style="'+nb+'padding:0;height:24px"></td></tr>';
    /* 5행: 안내 (윗줄 없음, 오른쪽 정렬) */
    h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">5</td>';
    h+='<td colspan="'+totalCols+'" style="'+nb+pd+'font-size:9px;color:#555;text-align:right">관리자는 상단에 배열, 이하 가나다 순</td></tr>';
    /* 6행: 연수명 (바깥 굵은선, 내부 일반선) */
    const ci='border:1px solid #c0c0c0;'; /* 내부 셀 */
    h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">6</td>';
    h+='<td rowspan="3" style="'+ci+pd+ctr+'font-weight:700;background:#e8f4f8;width:22px;vertical-align:middle;border-left:2px solid #333;border-top:2px solid #333">순</td>';
    h+='<td rowspan="3" style="'+ci+pd+ctr+'font-weight:700;background:#e8f4f8;width:55px;vertical-align:middle;border-top:2px solid #333">직위</td>';
    h+='<td rowspan="3" style="'+ci+pd+ctr+'font-weight:700;background:#e8f4f8;width:55px;vertical-align:middle;border-top:2px solid #333">이름</td>';
    _trsItems.forEach(function(item,ti){
      const isLastTr=ti===_trsItems.length-1;
      h+='<td colspan="2" style="'+ci+pd+ctr+'font-weight:700;font-size:8px;white-space:nowrap;overflow:hidden;max-width:160px;background:#e8f4f8;border-top:2px solid #333'+(isLastTr?';border-right:2px solid #333':'')+'">'+escHtml(item.name);
      if(item.isLegal)h+=' <span style="color:#c0392b;font-size:7px">(법정)</span>';
      h+='</td>';
    });
    h+='</tr>';
    /* 7행: 이수율 % */
    h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">7</td>';
    _trsItems.forEach(function(item,ti){
      const comps=item.completions||{};
      let filled=0;
      staffList.forEach(function(s){if(comps[s.id])filled++;});
      const pct=totalStaff>0?Math.round(filled/totalStaff*100):0;
      const isLastTr=ti===_trsItems.length-1;
      h+='<td colspan="2" style="'+ci+pd+ctr+'font-size:8px;font-weight:700;color:'+(pct>=100?'#16a34a':pct>0?'#2855A0':'#999')+';background:#f0f8ff'+(isLastTr?';border-right:2px solid #333':'')+'">'+pct+'% ('+filled+'/'+totalStaff+')</td>';
    });
    h+='</tr>';
    /* 8행: 이수기관 / 이수번호 서브 헤더 */
    h+='<tr style="background:#e8f4f8"><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">8</td>';
    _trsItems.forEach(function(item,ti){
      const isLastTr=ti===_trsItems.length-1;
      h+='<td style="'+ci+pd+ctr+'font-weight:700;font-size:8px;width:70px">연수기관</td>';
      h+='<td style="'+ci+pd+ctr+'font-weight:700;font-size:8px;width:70px'+(isLastTr?';border-right:2px solid #333':'')+'">이수번호</td>';
    });
    h+='</tr>';
    /* 데이터 행 (바깥 굵은선, 내부 일반선) */
    staffList.forEach(function(s,si){
      const isLast=si===staffList.length-1;
      const btm=isLast?'border-bottom:2px solid #333;':'';
      h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">'+(si+9)+'</td>';
      h+='<td style="'+ci+pd+ctr+'border-left:2px solid #333;'+btm+'">'+(si+1)+'</td>';
      h+='<td style="'+ci+pd+ctr+btm+'">'+(s.position||'교직원')+'</td>';
      h+='<td style="'+ci+pd+ctr+btm+'font-weight:600">'+escHtml(s.name)+'</td>';
      _trsItems.forEach(function(item,ti){
        const inst=(item.certInstitutions&&item.certInstitutions[s.id])||'';
        const cert=(item.completions&&item.completions[s.id])||'';
        const isLastTr=ti===_trsItems.length-1;
        h+='<td style="'+ci+pd+ctr+btm+'color:#555;font-size:8px">'+escHtml(inst)+'</td>';
        h+='<td style="'+ci+pd+ctr+btm+'color:#555;font-size:8px'+(isLastTr?';border-right:2px solid #333':'')+'">'+escHtml(cert)+'</td>';
      });
      h+='</tr>';
    });
    h+='</table>';
    h+='</div></div>';
  }
  h+='</div>';
  h+='</div>';
  area.innerHTML=h;
  /* 이벤트 위임 — renderTrainingStatus */
  area.addEventListener('click',function(e){
    const el=e.target.closest('[data-trs-action]');if(!el)return;
    const act=el.dataset.trsAction;
    if(act==='addNew') trsAddNew();
    else if(act==='editItem') trsEditItem(parseInt(el.dataset.idx));
    else if(act==='showMessagePopup') trsShowMessagePopup();
    else if(act==='showNoticeLog') trsShowNoticeLog();
    else if(act==='exportAllSheets') trsExportAllSheets();
    else if(act==='exportPDF') trsExportPDF();
    else if(act==='trsPrint') trsPrint();
  });
  area.querySelectorAll('.trs-list-item').forEach(function(el){
    el.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.04)';this.style.borderLeftColor='var(--cyan)';});
    el.addEventListener('mouseleave',function(){this.style.background='';this.style.borderLeftColor='transparent';});
  });
}

/* ── 연수 항목 편집 팝업 ── */
function trsEditItem(idx){
  const item=_trsItems[idx];if(!item)return;
  const ov=document.createElement('div');ov.id='trsEditOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.36);z-index:2200';
  let h='<div class="modal-content" style="width:440px;max-height:80vh;overflow-y:auto;padding:0">';
  h+='<div class="modal-header" style="padding:16px 24px;margin-bottom:0;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))"><div class="modal-title">📝 연수 정보 수정</div><span data-edit-action="close" style="cursor:pointer;font-size:18px;color:var(--t3);line-height:1">✕</span></div>';
  h+='<div style="padding:18px 24px;display:flex;flex-direction:column;gap:10px">';
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px;font-weight:600">연수 또는 교육명</label><input class="form-input trs-edit-field" id="trsEditName" value="'+escHtml(item.name)+'" style="width:100%;font-size:12px"></div>';
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px;font-weight:600">이수 기한</label><input class="form-input trs-edit-field" id="trsEditDeadline" value="'+(item.deadline||'')+'" placeholder="YYYY-MM-DD" style="width:100%;font-size:12px"></div>';
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px;font-weight:600">연수로 바로 연결되는 URL 링크</label><input class="form-input trs-edit-field" id="trsEditUrl" value="'+escHtml(item.siteUrl||'')+'" placeholder="https://..." style="width:100%;font-size:12px"></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="trsEditLegal" class="trs-edit-field" '+(item.isLegal?'checked':'')+' style="width:16px;height:16px;accent-color:var(--cyan)"><label for="trsEditLegal" style="font-size:12px;font-weight:600;color:var(--t2)">법정의무연수</label></div>';
  /* 이수 기관 목록 */
  const instList=item.institutions||[];
  h+='<div style="border-top:1px solid var(--bdr);padding-top:10px;margin-top:4px"><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:6px;font-weight:600">이수 기관 목록 (드롭다운 제공용)</label>';
  h+='<div id="trsInstList" style="display:flex;flex-direction:column;gap:4px">';
  instList.forEach(function(inst){
    h+='<div style="display:flex;gap:4px;align-items:center"><input class="form-input trs-inst-input trs-edit-field" value="'+escHtml(inst)+'" style="flex:1;font-size:11px;padding:4px 8px" placeholder="기관명"><button data-edit-action="removeInst" style="padding:2px 8px;font-size:10px;color:#ef4444;background:none;border:1px solid rgba(239,68,68,0.2);border-radius:4px;cursor:pointer;font-family:var(--f)">✕</button></div>';
  });
  h+='</div>';
  h+='<button data-edit-action="addInst" style="margin-top:6px;padding:4px 12px;font-size:10px;font-weight:600;background:rgba(6,182,212,0.08);color:var(--cyan);border:1px solid rgba(6,182,212,0.2);border-radius:5px;cursor:pointer;font-family:var(--f)">+ 기관 추가</button>';
  h+='</div>';
  h+='<div id="trsEditSaveStatus" style="font-size:10px;color:var(--t3);height:14px"></div>';
  h+='</div>';
  h+='<div style="padding:12px 24px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-start">';
  h+='<button data-edit-action="delete" style="padding:8px 14px;font-size:11px;font-weight:600;background:transparent;color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:6px;cursor:pointer;font-family:var(--f)">🗑️ 삭제</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const el=e.target.closest('[data-edit-action]');if(!el)return;
    const act=el.dataset.editAction;
    if(act==='close') closeModalGracefully(ov);
    else if(act==='removeInst'){el.parentElement.remove();_trsAutoSaveEdit(idx);}
    else if(act==='addInst') _trsAddInstField(idx);
    else if(act==='delete') trsDeleteFromEdit(idx);
  });
  ov.querySelectorAll('.trs-edit-field').forEach(function(el){
    el.addEventListener('input',function(){_trsAutoSaveEdit(idx);});
    el.addEventListener('change',function(){_trsAutoSaveEdit(idx);});
  });
  document.body.appendChild(ov);
}
function _trsAddInstField(idx){
  const list=document.getElementById('trsInstList');if(!list)return;
  const d=document.createElement('div');d.style.cssText='display:flex;gap:4px;align-items:center';
  d.innerHTML='<input class="form-input trs-inst-input" value="" style="flex:1;font-size:11px;padding:4px 8px" placeholder="기관명"><button data-edit-action="removeInst" style="padding:2px 8px;font-size:10px;color:#ef4444;background:none;border:1px solid rgba(239,68,68,0.2);border-radius:4px;cursor:pointer;font-family:var(--f)">✕</button>';
  d.querySelector('input').addEventListener('input',function(){_trsAutoSaveEdit(idx||0);});
  d.querySelector('button').addEventListener('click',function(){d.remove();_trsAutoSaveEdit(idx||0);});
  list.appendChild(d);
  d.querySelector('input').focus();
}
let _trsEditSaveTimer=null;
function _trsAutoSaveEdit(idx){
  _trsToast('저장 중...');
  clearTimeout(_trsEditSaveTimer);
  _trsEditSaveTimer=setTimeout(function(){
    const item=_trsItems[idx];if(!item)return;
    item.name=(document.getElementById('trsEditName')||{}).value||item.name;
    item.deadline=(document.getElementById('trsEditDeadline')||{}).value||'';
    item.siteUrl=(document.getElementById('trsEditUrl')||{}).value||'';
    item.isLegal=(document.getElementById('trsEditLegal')||{}).checked||false;
    const instInputs=document.querySelectorAll('.trs-inst-input');
    item.institutions=[];
    instInputs.forEach(function(inp){const v=inp.value.trim();if(v)item.institutions.push(v);});
    _trsSave();
    renderTrainingStatus();
    _trsToast('✓ 모든 내용이 저장되었습니다.');
  },500);
}
function trsDeleteFromEdit(idx){
  if(!confirm('삭제하시겠습니까?\n\n'+_trsItems[idx].name))return;
  _trsItems.splice(idx,1);_trsSave();_trsOpenIdx=null;
  closeModalGracefully('trsEditOverlay');
  renderTrainingStatus();
}

/* ── 안내 메시지 팝업 ── */
function trsShowMessagePopup(){
  const existing=document.getElementById('trsMsgOverlay');if(existing)closeModalGracefully(existing);
  const ov=document.createElement('div');ov.id='trsMsgOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.36);z-index:2200';
  let h='<div class="modal-content" style="width:520px;max-height:85vh;overflow-y:auto;padding:0">';
  h+='<div class="modal-header" style="padding:16px 24px;margin-bottom:0;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))"><div class="modal-title">💬 안내 메시지 미리보기 & 복사</div></div>';
  h+='<div style="padding:18px 24px">';
  h+='<div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:8px">안내할 연수를 선택하세요:</div>';
  h+='<div id="trsMsgChecks" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">';
  _trsItems.forEach(function(item,idx){
    h+='<label class="trs-msg-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 10px;border-radius:6px;background:var(--bg2);transition:background .1s">';
    h+='<input type="checkbox" class="trs-msg-chk" data-idx="'+idx+'" checked style="width:16px;height:16px;accent-color:var(--cyan)">';
    h+='<span style="font-size:12px;font-weight:600;color:var(--t1)">'+escHtml(item.name)+'</span>';
    if(item.isLegal)h+='<span style="font-size:8px;font-weight:700;background:rgba(239,68,68,0.15);color:#ef4444;padding:1px 5px;border-radius:3px">법정</span>';
    h+='</label>';
  });
  h+='</div>';
  h+='<div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:4px">미리보기 (직접 수정 가능):</div>';
  h+='<textarea id="trsMsgPreview" style="width:100%;height:180px;padding:12px;font-size:12px;line-height:1.7;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);color:var(--t1);font-family:var(--f);resize:vertical"></textarea>';
  h+='</div>';
  h+='<div style="padding:14px 24px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-end;background:var(--bg2)">';
  h+='<button data-msg-action="copy" style="padding:8px 20px;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:6px">📋 클립보드에 복사</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const el=e.target.closest('[data-msg-action]');
    if(el&&el.dataset.msgAction==='copy')_trsMsgCopy();
  });
  ov.querySelectorAll('.trs-msg-chk').forEach(function(chk){chk.addEventListener('change',function(){_trsMsgUpdate();});});
  ov.querySelectorAll('.trs-msg-label').forEach(function(lbl){
    lbl.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.08)';});
    lbl.addEventListener('mouseleave',function(){this.style.background='var(--bg2)';});
  });
  document.body.appendChild(ov);
  _trsMsgUpdate();
}
const _trsMsgSaveTimer=null;
function _trsMsgUpdate(){
  const checks=document.querySelectorAll('.trs-msg-chk:checked');
  const yr=new Date().getFullYear();
  const nurse=S.settings.nurse1||'보건교사';
  let msg='[연수 이수 안내]\n\n안녕하세요 선생님들, 보건교사입니다.\n이수하셔야 할 연수를 안내드립니다.\n\n';
  const names=[];
  checks.forEach(function(chk){
    const idx=parseInt(chk.dataset.idx);
    const item=_trsItems[idx];if(!item)return;
    names.push(item.name);
    msg+='▶ '+item.name;
    if(item.isLegal)msg+=' (법정의무연수)';
    msg+='\n';
    if(item.deadline)msg+='   이수 기한: '+item.deadline+'\n';
    if(item.siteUrl)msg+='   연수 사이트: '+item.siteUrl+'\n';
    msg+='\n';
  });
  if(names.length>0){
    msg+='이수 완료 후 아래 URL 링크를 클릭하셔서 구글 시트 상 본인의 영역에서 연수 기관을 선택 후 이수 번호('+yr+' 뒤)를 숫자로만 적어주시면 감사하겠습니다.\n\n'+nurse+' 드림.';
  }
  const ta=document.getElementById('trsMsgPreview');
  if(ta)ta.value=msg;
  _trsMsgAutoSave();
}
function _trsMsgAutoSave(){
  _trsToast('✓ 모든 내용이 저장되었습니다.');
}
function _trsMsgCopy(){
  const ta=document.getElementById('trsMsgPreview');if(!ta)return;
  navigator.clipboard.writeText(ta.value).then(function(){
    _trsToast('📋 안내 메시지가 클립보드에 복사되었습니다.');
  });
}

/* ── PDF / 인쇄 (이수 현황) ── */
function _trsBuildPrintHtml(){
  const staffList=sortStaffList(S.people.filter(function(s){return s.type==='staff';}));
  const yr=new Date().getFullYear();
  const schoolName=S.settings.schoolName||'○○학교';
  const numTr=_trsItems.length;
  const totalCols=3+numTr*2;
  const bd='border:1px solid #999;';const pd='padding:4px 6px;';const ctr='text-align:center;';
  let h='<!DOCTYPE html><html><head><meta charset="utf-8"><title>연수 이수 현황</title>';
  const bdt2='border:2px solid #333;';
  h+='<style>@page{size:landscape;margin:10mm 10mm 10mm 10mm}body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","맑은 고딕",sans-serif;color:#000;font-size:9px}table{border-collapse:collapse;width:100%}thead{display:table-header-group}tr{page-break-inside:avoid}</style></head><body>';
  h+='<table>';
  /* thead — 색상선+제목+헤더 (인쇄 시 매 페이지 반복) */
  h+='<thead>';
  /* 1행: 색상선 */
  const halfC=Math.ceil(totalCols/2);
  h+='<tr><td colspan="'+halfC+'" style="background:#2855A0;height:12px;padding:0;border:none"></td><td colspan="'+(totalCols-halfC)+'" style="background:#D4A843;height:12px;padding:0;border:none"></td></tr>';
  /* 2행: 제목 */
  h+='<tr><td colspan="'+totalCols+'" style="background:#F7F7F7;text-align:center;padding:10px 16px;font-size:16px;font-weight:700;letter-spacing:3px;border:none">'+yr+'학년도 '+escHtml(schoolName)+' 보건 연수 이수 현황</td></tr>';
  /* 3행: 색상선 */
  const halfC2=Math.ceil(totalCols*3/10);
  h+='<tr><td colspan="'+halfC2+'" style="background:#2E8B57;height:12px;padding:0;border:none"></td><td colspan="'+(totalCols-halfC2)+'" style="background:#C0392B;height:12px;padding:0;border:none"></td></tr>';
  /* 4행: 여백 */
  h+='<tr><td colspan="'+totalCols+'" style="height:12px;padding:0;border:none"></td></tr>';
  /* 5행: 안내 */
  h+='<tr><td colspan="'+totalCols+'" style="text-align:right;font-size:9px;color:#555;border:none;padding:2px 4px">관리자는 상단에 배열, 이하 가나다 순</td></tr>';
  /* 6행: 연수명 */
  h+='<tr><td rowspan="3" style="font-weight:700;background:#e8f4f8;width:22px;vertical-align:middle;'+bdt2+'">순</td>';
  h+='<td rowspan="3" style="font-weight:700;background:#e8f4f8;width:50px;vertical-align:middle;'+bdt2+'">직위</td>';
  h+='<td rowspan="3" style="font-weight:700;background:#e8f4f8;width:50px;vertical-align:middle;'+bdt2+'">이름</td>';
  _trsItems.forEach(function(item){
    h+='<td colspan="2" style="font-weight:700;background:#e8f4f8;font-size:8px;'+bdt2+'">'+item.name;
    if(item.isLegal)h+=' <span style="color:#c0392b">(법정)</span>';
    h+='</td>';
  });
  h+='</tr>';
  /* 7행: 이수율 */
  h+='<tr>';
  _trsItems.forEach(function(item){
    const comps=item.completions||{};let filled=0;
    staffList.forEach(function(s){if(comps[s.id])filled++;});
    const pct=staffList.length>0?Math.round(filled/staffList.length*100):0;
    h+='<td colspan="2" style="font-size:8px;font-weight:700;color:'+(pct>=100?'#16a34a':'#2855A0')+';background:#f0f8ff;'+bdt2+'">'+pct+'% ('+filled+'/'+staffList.length+')</td>';
  });
  h+='</tr>';
  /* 8행: 서브헤더 */
  h+='<tr style="background:#e8f4f8">';
  _trsItems.forEach(function(){
    h+='<td style="font-weight:700;font-size:8px;'+bdt2+'">연수기관</td><td style="font-weight:700;font-size:8px;'+bdt2+'">이수번호</td>';
  });
  h+='</tr>';
  h+='</thead><tbody>';
  /* 데이터 행 */
  const ci2='border:1px solid #999;padding:4px 6px;text-align:center;';
  staffList.forEach(function(s,si){
    const isLast=si===staffList.length-1;
    const btm=isLast?'border-bottom:2px solid #333;':'';
    h+='<tr><td style="'+ci2+'border-left:2px solid #333;'+btm+'">'+(si+1)+'</td><td style="'+ci2+btm+'">'+(s.position||'교직원')+'</td><td style="font-weight:600;'+ci2+btm+'">'+s.name+'</td>';
    _trsItems.forEach(function(item,ti){
      const inst=(item.certInstitutions&&item.certInstitutions[s.id])||'';
      const cert=(item.completions&&item.completions[s.id])||'';
      const isLastTr=ti===_trsItems.length-1;
      h+='<td style="font-size:8px;'+ci2+btm+'">'+inst+'</td><td style="font-size:8px;'+ci2+btm+(isLastTr?'border-right:2px solid #333;':'')+'">'+cert+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table></body></html>';
  return h;
}
function trsExportPDF(){
  const html=_trsBuildPrintHtml();
  const yr=new Date().getFullYear();
  const fileName=yr+'학년도 보건 연수 이수 현황.pdf';
  if(window.electronAPI&&window.electronAPI.printToPDF){
    window.electronAPI.printToPDF(html,{fileName:fileName}).then(function(res){
      if(res&&res.success)_trsToast('✓ PDF 저장 완료');
      else if(res&&res.error!=='cancelled')alert('PDF 저장 실패: '+res.error);
    }).catch(function(e){alert('PDF 저장 실패: '+e.message);});
  } else { alert('PDF 저장 기능을 사용할 수 없습니다.'); }
}
function trsPrint(){
  const html=_trsBuildPrintHtml();
  const w=window.open('','_blank','width=1100,height=700');
  if(w){w.document.write(html);w.document.close();setTimeout(function(){w.print();},500);}
}

/* ── 안내 내역 기록 ── */
const _trsNoticeLog=JSON.parse(localStorage.getItem('trs_notice_log')||'[]');
const _trsNoticeColVis={0:true,1:true,2:true,3:true,4:true}; /* 순,안내일자,안내자,안내연수,안내문구 */
function _trsNoticeLogSave(){localStorage.setItem('trs_notice_log',JSON.stringify(_trsNoticeLog));}

function trsShowNoticeLog(){
  const existing=document.getElementById('trsNoticeOverlay');if(existing)closeModalGracefully(existing);
  const vis=_trsNoticeColVis;
  const cols=[{key:0,label:'순'},{key:1,label:'안내일자'},{key:2,label:'안내자'},{key:3,label:'안내연수'},{key:4,label:'안내문구'}];
  const ov=document.createElement('div');ov.id='trsNoticeOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.36);z-index:2200';
  let h='<div class="modal-content" style="width:700px;max-height:85vh;padding:0;display:flex;flex-direction:column">';
  h+='<div class="modal-header" style="padding:16px 24px;margin-bottom:0;border-bottom:1px solid var(--bdr);flex-shrink:0;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))"><div class="modal-title">📝 안내 내역 기록</div><span data-ntc-action="close" style="cursor:pointer;font-size:18px;color:var(--t3);line-height:1">✕</span></div>';
  /* 열 필드 설정 (일반 일지와 동일한 카드+SVG 눈알) */
  h+='<div style="padding:10px 24px;border-bottom:1px solid var(--bdr);flex-shrink:0;display:flex;align-items:center;gap:4px;flex-wrap:wrap">';
  h+='<span style="font-size:10px;font-weight:700;color:var(--t3);margin-right:4px">열 필드:</span>';
  cols.forEach(function(col){
    const active=vis[col.key]!==false;
    h+='<div data-ntc-action="toggleCol" data-col-key="'+col.key+'" data-col-active="'+active+'" class="trs-ntc-col-btn" style="display:inline-flex;align-items:center;justify-content:space-between;gap:4px;height:34px;padding:0 4px;border:1px solid '+(active?'rgba(6,182,212,0.32)':'var(--bdr)')+';border-radius:8px;background:var(--card);cursor:pointer;white-space:nowrap;user-select:none;opacity:'+(active?'1':'0.5')+';transition:all .15s;min-width:0">';
    h+='<span style="font-size:9.5px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;padding:0 4px">'+col.label+'</span>';
    h+='<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;padding:0;border:1px solid '+(active?'rgba(6,182,212,0.24)':'rgba(148,163,184,0.2)')+';border-radius:999px;background:'+(active?'rgba(6,182,212,0.10)':'rgba(148,163,184,0.10)')+';color:'+(active?'var(--cyan)':'var(--t3)')+';flex:0 0 auto">'+dailyColEyeIcon(active)+'</span>';
    h+='</div>';
  });
  h+='<button data-ntc-action="addRow" style="margin-left:auto;padding:4px 12px;font-size:10px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:var(--f)">+ 기록 추가</button>';
  h+='</div>';
  /* 테이블 */
  h+='<div style="flex:1;overflow-y:auto;padding:14px 24px">';
  h+='<table style="width:100%;border-collapse:collapse;font-size:11px" id="trsNoticeTable">';
  h+='<thead><tr style="background:var(--bg2)">';
  cols.forEach(function(col){
    h+='<th style="padding:6px 8px;text-align:'+(col.key===4?'left':'center')+';font-weight:700;color:var(--t3);border-bottom:1px solid var(--bdr);display:'+(vis[col.key]!==false?'':'none')+'">'+col.label+'</th>';
  });
  h+='<th style="padding:6px 8px;text-align:center;font-weight:700;color:var(--t3);border-bottom:1px solid var(--bdr);width:30px"></th>';
  h+='</tr></thead><tbody>';
  _trsNoticeLog.forEach(function(row,ri){
    h+='<tr class="trs-ntc-row" style="border-bottom:1px solid var(--bdr)">';
    h+='<td style="padding:5px 8px;text-align:center;display:'+(vis[0]!==false?'':'none')+'">'+(ri+1)+'</td>';
    h+='<td style="padding:5px 8px;text-align:center;display:'+(vis[1]!==false?'':'none')+'">'+escHtml(row.date||'')+'</td>';
    h+='<td style="padding:5px 8px;text-align:center;display:'+(vis[2]!==false?'':'none')+'">'+escHtml(row.person||'')+'</td>';
    h+='<td style="padding:5px 8px;text-align:center;display:'+(vis[3]!==false?'':'none')+'">'+escHtml(row.training||'')+'</td>';
    h+='<td style="padding:5px 8px;display:'+(vis[4]!==false?'':'none')+'">'+escHtml(row.message||'')+'</td>';
    h+='<td style="padding:5px 8px;text-align:center"><span class="ntc-del" data-ntc-action="deleteRow" data-row-idx="'+ri+'" style="opacity:0;transition:opacity .15s;cursor:pointer;color:#ef4444;font-size:14px;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,0.08)" title="삭제">✕</span></td>';
    h+='</tr>';
  });
  if(_trsNoticeLog.length===0){
    const _trEmpty = (typeof createEmptyState==='function')
      ? createEmptyState({icon:'📝',title:'기록이 없습니다',desc:'"기록 추가" 버튼으로 새 항목을 추가하세요.'})
      : '기록이 없습니다.';
    h+='<tr><td colspan="6" style="padding:0;background:transparent">'+_trEmpty+'</td></tr>';
  }
  h+='</tbody></table>';
  h+='</div>';
  h+='<div style="padding:12px 24px;border-top:1px solid var(--bdr);display:flex;justify-content:space-between;flex-shrink:0;background:var(--bg2)">';
  h+='<button data-ntc-action="copyTable" style="padding:8px 16px;font-size:11px;font-weight:600;background:var(--card);color:var(--t1);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>표 클립보드에 복사</button>';
  h+='<button data-ntc-action="close" style="padding:8px 18px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">닫기</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const el=e.target.closest('[data-ntc-action]');if(!el)return;
    const act=el.dataset.ntcAction;
    if(act==='close') closeModalGracefully(ov);
    else if(act==='toggleCol') _trsNoticeToggleCol(parseInt(el.dataset.colKey));
    else if(act==='addRow') _trsNoticeAddRow();
    else if(act==='deleteRow') _trsNoticeDeleteRow(parseInt(el.dataset.rowIdx));
    else if(act==='copyTable') _trsNoticeCopyTable();
  });
  ov.querySelectorAll('.trs-ntc-col-btn').forEach(function(el){
    el.addEventListener('mouseenter',function(){this.style.background='rgba(186,230,253,0.45)';this.style.borderColor='rgba(14,116,144,0.3)';this.style.opacity='1';});
    el.addEventListener('mouseleave',function(){const a=this.dataset.colActive==='true';this.style.background='var(--card)';this.style.borderColor=a?'rgba(6,182,212,0.32)':'var(--bdr)';this.style.opacity=a?'1':'0.5';});
  });
  ov.querySelectorAll('.trs-ntc-row').forEach(function(tr){
    tr.addEventListener('mouseenter',function(){const d=this.querySelector('.ntc-del');if(d)d.style.opacity='1';});
    tr.addEventListener('mouseleave',function(){const d=this.querySelector('.ntc-del');if(d)d.style.opacity='0';});
  });
  document.body.appendChild(ov);
}

function _trsNoticeToggleCol(key){
  _trsNoticeColVis[key]=!(_trsNoticeColVis[key]!==false);
  trsShowNoticeLog();
}

function _trsNoticeAddRow(){
  const today=new Date();
  const ds=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  const nurse=S.settings.nurse1||'';
  const trainNames=_trsItems.map(function(it){return it.name;}).join(', ');
  _trsNoticeLog.push({date:ds,person:nurse,training:trainNames,message:''});
  _trsNoticeLogSave();
  trsShowNoticeLog();
}

function _trsNoticeDeleteRow(ri){
  _trsNoticeLog.splice(ri,1);_trsNoticeLogSave();trsShowNoticeLog();
}
function _trsNoticeCopyTable(){
  const vis=_trsNoticeColVis;
  const cols=['순','안내일자','안내자','안내연수','안내문구'];
  const header=cols.filter(function(c,i){return vis[i]!==false;}).join('\t');
  const rows=[header];
  _trsNoticeLog.forEach(function(row,ri){
    const r=[];
    if(vis[0]!==false)r.push(ri+1);
    if(vis[1]!==false)r.push(row.date||'');
    if(vis[2]!==false)r.push(row.person||'');
    if(vis[3]!==false)r.push(row.training||'');
    if(vis[4]!==false)r.push(row.message||'');
    rows.push(r.join('\t'));
  });
  navigator.clipboard.writeText(rows.join('\n')).then(function(){
    _trsToast('✓ 표가 클립보드에 복사되었습니다.');
  });
}

/* ── 새 연수 이수 안내 추가 팝업 ── */
function trsAddNew(){
  const ov=document.createElement('div');
  ov.id='trsAddOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.36);z-index:2200';
  let h='<div class="modal-content" style="width:460px;max-height:85vh;overflow-y:auto;padding:0">';
  h+='<div class="modal-header" style="padding:16px 24px;margin-bottom:0;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))"><div class="modal-title" style="display:flex;align-items:center;gap:8px">📢 새 연수 이수 안내</div><span data-add-action="close" style="cursor:pointer;font-size:18px;color:var(--t3);line-height:1">✕</span></div>';
  h+='<div style="padding:18px 24px;display:flex;flex-direction:column;gap:12px">';
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px;font-weight:600">연수 또는 교육명 *</label><input class="form-input" id="trsNewName" placeholder="예: 성희롱/성폭력/성매매 예방 원격연수" style="width:100%;font-size:12px"></div>';
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px;font-weight:600">이수 기한</label>';
  h+='<input class="form-input" id="trsNewDeadline" placeholder="날짜 선택" readonly style="width:100%;font-size:12px;cursor:pointer" data-add-action="openDeadlineCal">';
  h+='<div id="trsDeadlineCalWrap" style="display:none;margin-top:6px"></div></div>';
  h+='<div><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:3px;font-weight:600">연수로 바로 연결되는 URL 링크</label><input class="form-input" id="trsNewUrl" placeholder="예: https://www.calsec.or.kr" style="width:100%;font-size:12px"></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="trsNewLegal" style="width:16px;height:16px;accent-color:var(--cyan)"><label for="trsNewLegal" style="font-size:12px;font-weight:600;color:var(--t2)">법정의무연수</label></div>';
  /* 이수 기관 목록 */
  h+='<div style="border-top:1px solid var(--bdr);padding-top:10px"><label style="font-size:10px;color:var(--t3);display:block;margin-bottom:6px;font-weight:600">이수 기관 목록 (드롭다운 제공용)</label>';
  h+='<div id="trsNewInstList" style="display:flex;flex-direction:column;gap:4px"></div>';
  h+='<button data-add-action="addInstField" style="margin-top:6px;padding:4px 12px;font-size:10px;font-weight:600;background:rgba(6,182,212,0.08);color:var(--cyan);border:1px solid rgba(6,182,212,0.2);border-radius:5px;cursor:pointer;font-family:var(--f)">+ 기관 추가</button>';
  h+='</div>';
  h+='</div>';
  h+='<div style="padding:14px 24px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-end;background:var(--bg2)">';
  h+='<button data-add-action="confirm" style="padding:8px 22px;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">생성</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const el=e.target.closest('[data-add-action]');if(!el)return;
    const act=el.dataset.addAction;
    if(act==='close') closeModalGracefully(ov);
    else if(act==='openDeadlineCal') trsOpenDeadlineCal(el);
    else if(act==='addInstField') _trsAddNewInstField();
    else if(act==='confirm') trsConfirmAdd();
  });
  document.body.appendChild(ov);
  /* URL 입력 시 미리보기 */
  const urlInput=document.getElementById('trsNewUrl');
  let urlTimer=null;
  urlInput.addEventListener('input',function(){
    clearTimeout(urlTimer);
    urlTimer=setTimeout(function(){
      const url=urlInput.value.trim();
      const preview=document.getElementById('trsUrlPreview');
      if(url&&(url.startsWith('http://')||url.startsWith('https://'))){
        preview.style.display='block';
        preview.innerHTML='<iframe src="'+escHtml(url)+'" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin"></iframe>';
      } else {preview.style.display='none';preview.innerHTML='';}
    },800);
  });
}

let _trsCalYear=new Date().getFullYear(), _trsCalMonth=new Date().getMonth();
function trsOpenDeadlineCal(btn){
  const wrap=document.getElementById('trsDeadlineCalWrap');
  if(wrap.style.display!=='none'){wrap.style.display='none';return;}
  const val=btn.value;
  if(val){const d=new Date(val);if(!isNaN(d)){_trsCalYear=d.getFullYear();_trsCalMonth=d.getMonth();}}
  wrap.style.display='block';
  _trsRenderCal();
}
function _trsRenderCal(){
  const wrap=document.getElementById('trsDeadlineCalWrap');if(!wrap)return;
  const y=_trsCalYear, m=_trsCalMonth;
  let h='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:10px;box-shadow:var(--sh)">';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  h+='<button data-trs-cal="prevYear" style="padding:2px 8px;font-size:12px;background:none;border:1px solid var(--bdr);border-radius:4px;color:var(--t2);cursor:pointer;font-family:var(--f)">◀</button>';
  h+='<div style="display:flex;gap:8px;align-items:center">';
  h+='<span style="font-size:12px;font-weight:700;color:var(--t1)">'+y+'년</span>';
  h+='<span id="trsCalMonthLabel" style="font-size:12px;font-weight:700;color:var(--cyan);cursor:pointer;position:relative">'+(m+1)+'월</span>';
  h+='</div>';
  h+='<button data-trs-cal="nextYear" style="padding:2px 8px;font-size:12px;background:none;border:1px solid var(--bdr);border-radius:4px;color:var(--t2);cursor:pointer;font-family:var(--f)">▶</button>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){h+='<div style="font-size:9px;font-weight:700;color:'+(i===0?'var(--rs)':i===6?'#3b82f6':'var(--t3)')+'">'+d+'</div>';});
  const first=new Date(y,m,1).getDay(), days=new Date(y,m+1,0).getDate();
  for(let i=0;i<first;i++)h+='<div></div>';
  for(let d=1;d<=days;d++){
    const ds=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dow=new Date(y,m,d).getDay();
    const hol=typeof S.koreanHolidays!=='undefined'&&S.koreanHolidays[ds];
    const col=hol?'var(--rs)':dow===0?'var(--rs)':dow===6?'#3b82f6':'var(--t1)';
    h+='<div data-trs-cal="selectDate" data-date="'+ds+'" class="trs-cal-hover-item" title="'+(hol||'')+'" style="padding:4px 0;font-size:11px;font-weight:600;color:'+col+';cursor:pointer;border-radius:4px;transition:background .1s">'+d+'</div>';
  }
  h+='</div></div>';
  wrap.innerHTML=h;
  /* 이벤트 위임 — 이수 기한 달력 */
  wrap.addEventListener('click',function(e){
    const el=e.target.closest('[data-trs-cal]');if(!el)return;
    const act=el.dataset.trsCal;
    if(act==='prevYear'){_trsCalYear--;_trsRenderCal();}
    else if(act==='nextYear'){_trsCalYear++;_trsRenderCal();}
    else if(act==='selectDate'){_trsSelectDate(el.dataset.date);}
  });
  const _monthLabel=wrap.querySelector('#trsCalMonthLabel');
  if(_monthLabel){
    _monthLabel.addEventListener('mouseenter',function(){_trsShowMonthPicker(this);});
    _monthLabel.addEventListener('mouseleave',function(){_trsHideMonthPickerDelay();});
  }
  wrap.querySelectorAll('.trs-cal-hover-item').forEach(function(el){
    el.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.15)';});
    el.addEventListener('mouseleave',function(){this.style.background='';});
  });
}
let _trsMonthPickerTimer=null;
function _trsShowMonthPicker(el){
  clearTimeout(_trsMonthPickerTimer);
  const existing=document.getElementById('trsMonthPicker');if(existing)existing.remove();
  const pop=document.createElement('div');pop.id='trsMonthPicker';
  pop.style.cssText='position:absolute;top:100%;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:8px;box-shadow:var(--sh);z-index:10;display:grid;grid-template-columns:1fr 1fr;gap:3px;min-width:120px';
  pop.addEventListener('mouseenter',function(){clearTimeout(_trsMonthPickerTimer);});
  pop.addEventListener('mouseleave',function(){_trsHideMonthPickerDelay();});
  let _monthHtml='';
  for(let i=1;i<=12;i++){
    const isActive=i===_trsCalMonth+1;
    _monthHtml+='<div data-month-pick="'+(i-1)+'" class="trs-month-hover-item" style="padding:5px 10px;font-size:11px;font-weight:'+(isActive?'800':'600')+';color:'+(isActive?'var(--cyan)':'var(--t2)')+';cursor:pointer;border-radius:4px;text-align:center;transition:background .1s">'+i+'월</div>';
  }
  pop.innerHTML=_monthHtml;
  pop.addEventListener('click',function(e){
    const el=e.target.closest('[data-month-pick]');if(!el)return;
    _trsPickMonth(parseInt(el.dataset.monthPick));
  });
  pop.querySelectorAll('.trs-month-hover-item').forEach(function(el){
    el.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.12)';});
    el.addEventListener('mouseleave',function(){this.style.background='';});
  });
  el.style.position='relative';
  el.appendChild(pop);
}
function _trsHideMonthPickerDelay(){_trsMonthPickerTimer=setTimeout(function(){const p=document.getElementById('trsMonthPicker');if(p)p.remove();},200);}
function _trsPickMonth(m){_trsCalMonth=m;const p=document.getElementById('trsMonthPicker');if(p)p.remove();_trsRenderCal();}
function _trsCalPrevMonth(){_trsCalMonth--;if(_trsCalMonth<0){_trsCalMonth=11;_trsCalYear--;}_trsRenderCal();}
function _trsCalNextMonth(){_trsCalMonth++;if(_trsCalMonth>11){_trsCalMonth=0;_trsCalYear++;}_trsRenderCal();}
function _trsSelectDate(ds){
  const el=document.getElementById('trsNewDeadline');if(el)el.value=ds;
  const wrap=document.getElementById('trsDeadlineCalWrap');if(wrap)wrap.style.display='none';
}

function _trsAddNewInstField(){
  const list=document.getElementById('trsNewInstList');if(!list)return;
  const d=document.createElement('div');d.style.cssText='display:flex;gap:4px;align-items:center';
  d.innerHTML='<input class="form-input trs-new-inst-input" value="" style="flex:1;font-size:11px;padding:4px 8px" placeholder="기관명"><button style="padding:2px 8px;font-size:10px;color:#ef4444;background:none;border:1px solid rgba(239,68,68,0.2);border-radius:4px;cursor:pointer;font-family:var(--f)">✕</button>';
  d.querySelector('input').addEventListener('input',function(){_trsNewInstSave();});
  d.querySelector('button').addEventListener('click',function(){d.remove();_trsNewInstSave();});
  list.appendChild(d);
  d.querySelector('input').focus();
}
let _trsNewInstTimer=null;
function _trsNewInstSave(){
  _trsToast('저장 중...');
  clearTimeout(_trsNewInstTimer);
  _trsNewInstTimer=setTimeout(function(){_trsToast('✓ 모든 내용이 저장되었습니다.');},500);
}
function trsConfirmAdd(){
  const name=(document.getElementById('trsNewName')||{}).value||'';
  if(!name.trim()){alert('연수명을 입력해 주세요.');return;}
  const deadline=(document.getElementById('trsNewDeadline')||{}).value||'';
  const isLegal=(document.getElementById('trsNewLegal')||{}).checked||false;
  const siteUrl=(document.getElementById('trsNewUrl')||{}).value||'';
  const instInputs=document.querySelectorAll('.trs-new-inst-input');
  const institutions=[];
  instInputs.forEach(function(inp){const v=inp.value.trim();if(v)institutions.push(v);});
  const today=new Date();const todayStr=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  const msg=_trsGenerateMessage(name.trim(),deadline,isLegal,siteUrl.trim());
  _trsItems.push({id:Date.now(),name:name.trim(),deadline:deadline,isLegal:isLegal,siteUrl:siteUrl.trim(),createdAt:todayStr,message:msg,completions:{},certInstitutions:{},institutions:institutions,sheetId:null});
  _trsSave();
  const ov=document.getElementById('trsAddOverlay');if(ov)closeModalGracefully(ov);
  _trsOpenIdx=_trsItems.length-1;renderTrainingStatus();
}

function _trsGenerateMessage(name,deadline,isLegal,siteUrl){
  let msg='';
  msg+='📢 [연수 이수 안내]\n\n';
  msg+='안녕하세요, 보건실입니다.\n\n';
  if(isLegal)msg+='⚠️ 법정의무연수 안내드립니다.\n\n';
  msg+='▶ 연수명: '+name+'\n';
  if(deadline)msg+='▶ 이수 기한: '+deadline+'\n';
  if(siteUrl)msg+='▶ 이수 사이트: '+siteUrl+'\n';
  msg+='\n위 연수의 이수를 부탁드립니다.\n';
  msg+='이수 완료 후 이수 번호를 회신해 주시면 감사하겠습니다.\n\n';
  msg+='감사합니다. 🙏';
  return msg;
}



function _trsToast(msg){
  /* 다른 save indicator 숨기기 */
  document.querySelectorAll('.ec-save-indicator').forEach(function(el){if(el.id!=='trsSaveIndicator')el.className='ec-save-indicator hide';});
  let ind=document.getElementById('trsSaveIndicator');
  if(!ind){ind=document.createElement('div');ind.id='trsSaveIndicator';ind.className='ec-save-indicator';document.body.appendChild(ind);}
  if(msg.indexOf('저장 중')!==-1){
    ind.textContent='저장 중…';ind.className='ec-save-indicator saving';
  } else {
    ind.textContent=msg;ind.className='ec-save-indicator saved';
    setTimeout(function(){ind.className='ec-save-indicator hide';},3000);
  }
}

/* ── 이수 번호 입력/수정 팝업 ── */




/* ── Google Sheets 내보내기 (이수 현황) ── */
/* ── 통합 시트 내보내기 (모든 연수를 열로) ── */
async function trsExportAllSheets(){
  if(!confirm('Google Sheets에 새 스프레드시트를 생성합니다.\n\n계속하시겠습니까?'))return;
  const staffList=sortStaffList(S.people.filter(function(s){return s.type==='staff';}));
  const yr=new Date().getFullYear();
  const schoolName=S.settings.schoolName||'○○학교';
  const titleText=yr+'학년도 '+schoolName+' 보건 연수 이수 현황';
  const rows=[];
  const totalCols2=3+_trsItems.length*2;
  /* 1행: 색상선 (빈 행 — 서식으로 색 입힘) */
  const r0=[];for(let ci=0;ci<totalCols2;ci++)r0.push('');
  rows.push(r0);
  /* 2행: 제목 */
  const r1=[titleText];for(let i=1;i<totalCols2;i++)r1.push('');
  rows.push(r1);
  /* 3행: 색상선 (빈 행) */
  rows.push(r0.slice());
  /* 4행: 여백 */
  rows.push(r0.slice());
  /* 5행: 안내 */
  const r5=['관리자는 상단에 배열, 이하 가나다 순'];for(let ci2=1;ci2<totalCols2;ci2++)r5.push('');
  rows.push(r5);
  /* 6행: 연수명 헤더 */
  const r2=['','',''];
  _trsItems.forEach(function(item){r2.push(item.name+(item.isLegal?' (법정)':''));r2.push('');});
  rows.push(r2);
  /* 7행: 서브 헤더 */
  const r3=['순','직위','이름'];
  _trsItems.forEach(function(){r3.push('연수기관');r3.push('이수번호');});
  rows.push(r3);
  /* 데이터 행 */
  staffList.forEach(function(s,i){
    const row=[i+1,s.position||'교직원',s.name];
    _trsItems.forEach(function(item){
      const inst=(item.certInstitutions&&item.certInstitutions[s.id])||'';
      const cert=(item.completions&&item.completions[s.id])||'';
      row.push(inst);row.push(cert);
    });
    rows.push(row);
  });
  try{
    let ssId;
    const totalCols=3+_trsItems.length*2;
    const fmtReqs=[];
    /* 1행: 색상선 — 높이 2px (선처럼) */
    const halfC=Math.ceil(totalCols/2);
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:2},fields:'pixelSize'}});
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:halfC},cell:{userEnteredFormat:{backgroundColor:{red:0.157,green:0.333,blue:0.627}}},fields:'userEnteredFormat.backgroundColor'}});
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:0,endRowIndex:1,startColumnIndex:halfC,endColumnIndex:totalCols},cell:{userEnteredFormat:{backgroundColor:{red:0.831,green:0.659,blue:0.263}}},fields:'userEnteredFormat.backgroundColor'}});
    /* 2행: 제목 */
    fmtReqs.push({mergeCells:{range:{sheetId:0,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:totalCols},mergeType:'MERGE_ALL'}});
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13},horizontalAlignment:'CENTER',backgroundColor:{red:0.969,green:0.969,blue:0.969}}},fields:'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)'}});
    /* 3행: 색상선 — 높이 2px */
    const halfC2=Math.ceil(totalCols*3/10);
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'ROWS',startIndex:2,endIndex:3},properties:{pixelSize:2},fields:'pixelSize'}});
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:halfC2},cell:{userEnteredFormat:{backgroundColor:{red:0.180,green:0.545,blue:0.341}}},fields:'userEnteredFormat.backgroundColor'}});
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:2,endRowIndex:3,startColumnIndex:halfC2,endColumnIndex:totalCols},cell:{userEnteredFormat:{backgroundColor:{red:0.753,green:0.224,blue:0.169}}},fields:'userEnteredFormat.backgroundColor'}});
    /* 4행: 여백 — 높이 크게 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'ROWS',startIndex:3,endIndex:4},properties:{pixelSize:20},fields:'pixelSize'}});
    /* 5행: 안내 */
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:4,endRowIndex:5},cell:{userEnteredFormat:{textFormat:{fontSize:9,italic:true},horizontalAlignment:'LEFT'}},fields:'userEnteredFormat(textFormat,horizontalAlignment)'}});
    /* 6행: 연수명 병합 (각 2열씩) */
    _trsItems.forEach(function(item,ti){
      const startCol=3+ti*2;
        fmtReqs.push({mergeCells:{range:{sheetId:0,startRowIndex:5,endRowIndex:6,startColumnIndex:startCol,endColumnIndex:startCol+2},mergeType:'MERGE_ALL'}});
    });
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:5,endRowIndex:6},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:10},horizontalAlignment:'CENTER',backgroundColor:{red:0.91,green:0.96,blue:0.97}}},fields:'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)'}});
    /* 7행: 서브 헤더 */
    fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:6,endRowIndex:7},cell:{userEnteredFormat:{textFormat:{bold:true},horizontalAlignment:'CENTER',backgroundColor:{red:0.91,green:0.96,blue:0.97}}},fields:'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)'}});
    /* 데이터 영역 밖의 빈 셀 제거 (기본 26cols × 1000rows → 사용 범위로 축소) */
    const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
    if(totalCols<DEFAULT_COLS){
      fmtReqs.push({deleteDimension:{range:{sheetId:0,dimension:'COLUMNS',startIndex:totalCols,endIndex:DEFAULT_COLS}}});
    }
    if(rows.length<DEFAULT_ROWS){
      fmtReqs.push({deleteDimension:{range:{sheetId:0,dimension:'ROWS',startIndex:rows.length,endIndex:DEFAULT_ROWS}}});
    }
    const createRes=await window.sheetsExportWithConsent({
      title:titleText,
      sheetTitle:'이수현황',
      range:'이수현황!A1',
      values:rows,
      requests:fmtReqs
    });
    if(!createRes.success) throw new Error(createRes.error||'스프레드시트 생성 실패');
    ssId=createRes.spreadsheetId;
    /* sheetId 저장 (모든 아이템에) */
    _trsItems.forEach(function(item){item.sheetId=ssId;});_trsSave();
    const ssUrl='https://docs.google.com/spreadsheets/d/'+ssId;
    if(confirm('Google Sheets에 저장되었습니다!\n\n교직원에게 공유하면 직접 이수 기관과 번호를 입력할 수 있습니다.\n\nGoogle Sheets에서 열까요?')){
      window.electronAPI.openExternal(ssUrl);
    }
  }catch(err){alert('Google Sheets 내보내기 실패:\n'+err.message);}
}


/* ── Google Sheets에서 불러오기 (이수 현황) ── */

/* ── window exports ── */

/* _trAutoFitPreview — IIFE 내부 전용 */
/* _trRenderRulers — IIFE 내부 전용 */

/* _trMarginMouseDown — IIFE 내부 전용 */
/* _trMarginMouseMove — IIFE 내부 전용 */
/* _trMarginMouseUp — IIFE 내부 전용 */
/* _trCloseCal — IIFE 내부 전용 */

/* _trCalMonth/_trCalYear — 모듈 로컬 변수 */
/* _trRefreshMsgBody — IIFE 내부 전용 */

/* _trRenderGradeSelect — IIFE 내부 전용 */
/* _trRenderClassCards — IIFE 내부 전용 */

/* _formatTrainingDate — IIFE 내부 전용 */
/* _formatTrainingDateTime — IIFE 내부 전용 */
/* _buildTrainingPreviewHtml — IIFE 내부 전용 */
/* _trPrintHtml — IIFE 내부 전용 */
/* _trsSave — IIFE 내부 전용 */

/* _trsMsgAutoSave — IIFE 내부 전용 */
/* _trsBuildPrintHtml — IIFE 내부 전용 */
/* _trsNoticeLogSave — IIFE 내부 전용 */

/* _trsCalPrevMonth — IIFE 내부 전용 */
/* _trsCalNextMonth — IIFE 내부 전용 */
/* _trsGenerateMessage — IIFE 내부 전용 */

/* _trSheetsSend — IIFE 내부 전용 */

/* Live-bound variables (referenced by inline onclick handlers) */
const _trLiveVars = {
  get _trainingState(){ return _trainingState; }, set _trainingState(v){ _trainingState = v; },
  get _trCalYear(){ return _trCalYear; }, set _trCalYear(v){ _trCalYear = v; },
  get _trCalMonth(){ return _trCalMonth; }, set _trCalMonth(v){ _trCalMonth = v; },
  get _trMsgOpts(){ return _trMsgOpts; }, set _trMsgOpts(v){ _trMsgOpts = v; },
  get _trsCalYear(){ return _trsCalYear; }, set _trsCalYear(v){ _trsCalYear = v; },
  get _trsOpenIdx(){ return _trsOpenIdx; }, set _trsOpenIdx(v){ _trsOpenIdx = v; }
};
/* _trLiveVars — 모듈 로컬 (defineProperty 제거) */
/* Snapshot-only variables (internal use) */
/* _trMarginDrag — IIFE 내부 전용 */
/* _trPreviewScale — IIFE 내부 전용 */
/* _trTargetStep — IIFE 내부 전용 */
/* _trTargetSelectedGrades — IIFE 내부 전용 */
/* _trsItems — IIFE 내부 전용 */
/* _trsEditSaveTimer — IIFE 내부 전용 */
/* _trsMsgSaveTimer — IIFE 내부 전용 */
/* _trsNoticeLog — IIFE 내부 전용 */
/* _trsNoticeColVis — IIFE 내부 전용 */

