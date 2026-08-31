/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * DASHBOARD (Req 3) + Sheets 계정 선택 공통 UI
 */
/* ES Module */
import { getStu, escHtml, toDateStr, dateObj, getDow, isHoliday, getGrades, closeModalGracefully, compareClass } from '../../core/helpers.js';
import { hasMultipleSchoolLevels, getLevelShort } from '../../core/student-utils.js';
import { S, monthNames, dayNames, ensureHolidayYear } from '../../core/app-state.js';
import { _statMedicationStr, _statHasBed } from '../../core/record-utils.js';
import { _dashRenderSubTabs, _dashGetSubTabs, getFilteredRecords } from '../stats/stats-view.js';
import { selectDate, _closeDateVisitors } from '../daily/daily-view.js';
import { closeModalWithAnim, matchKorean } from '../daily/daily-autocomplete.js';
import { openPersonSearch } from '../../core/person-search-ui.js';
import { saveA4Pdf, openA4PrintDialog } from '../../core/a4-print-dialog.js';
import { openSymptomCategoryPopup, getEffectiveSymCatById, getEffectiveSymCats } from '../symptom/symptom-view.js';
import { hideHeaderTooltip, showHeaderTooltipHtml, showHeaderTooltip } from '../emergency/emergency-view.js';
import { bus } from '../../core/event-bus.js';

function _toast(text){ bus.emit('toast:show',{text}); }
/* 학급별 건강 히트맵 — 기본 ON (핀비즈 스타일). 사용자가 OFF한 경우만 false */
let _dashHmFinviz=(function(){
  const saved=localStorage.getItem('dash_hm_finviz');
  if(saved===null)return true; /* 첫 실행: ON */
  return saved==='true';
})();
let _deptSheetsFolder=null;
let _htTempSlots=null;
/* ═══════════════════════════════════════
   DASHBOARD (Req 3)
   ═══════════════════════════════════════ */
const _dashPastel=['#7C9EF5','#6DD4B8','#F5A3A3','#B5A3F5','#F5C89E','#F5A3D4','#93C5FD'];
/* 차트 공통 팔레트 — 초록(남)/보라(여)/파란(학생)/노란(교직원)/빨강(요보호) 제외, 12색 모두 고유 */
/* 진료과 14개 전용 색상 — 서로 뚜렷이 구분되는 14색 */
const _dashDeptColors=['#E11D48','#F97316','#CA8A04','#16A34A','#0D9488','#0891B2','#2563EB','#7C3AED','#C026D3','#DB2777','#78716C','#0F766E','#B45309','#64748B'];
const _dashGradeColors=['#06B6D4','#8B5CF6','#F59E0B','#EF4444','#10B981','#EC4899','#3B82F6','#F97316','#14B8A6'];

/* ── 백엔드 통계 캐시 (IPC 집계 결과) ── */
let _dashStatsCache=null;   /* 현재 기간 집계 (deptCounts, gradeCounts, gradeByDept ...) */
let _dashPrevCache=null;    /* 이전 기간 집계 */
let _dashYoyCache=null;     /* 전년 동기 집계 */
let _dashSummaryCache=null; /* 요약 통계 (topSymptoms, hourly, daily) */

/**
 * 현재 기간/서브탭을 {year, from, to} 날짜 범위 객체로 변환
 * @param {number} subIdxOffset - 0: 현재, 1: 이전 기간
 */
function _dashGetDateRange(subIdxOffset){
  const offset=subIdxOffset||0;
  const tabs=_dashGetSubTabs();
  const sub=tabs[S._dashSubIdx+offset];
  const year=String(S.calYear);

  if(S.statsPeriod==='today'){
    const d=S.selectedDate||toDateStr(new Date());
    return {year:year,from:d,to:d};
  }
  if(S.statsPeriod==='custom'){
    if(S._dashCustomStart&&S._dashCustomEnd)
      return {year:S._dashCustomStart.substring(0,4),from:S._dashCustomStart,to:S._dashCustomEnd};
    return null;
  }
  if(!sub)return null;

  /* 백엔드 sub 객체는 항상 from/to 포함 — 이걸 우선 사용 */
  if(sub&&sub.from&&sub.to){
    return {year:String(sub.year||year),from:sub.from,to:sub.to};
  }
  /* 호환성을 위한 폴백 */
  if(S.statsPeriod==='week'&&sub.start){
    return {year:year,from:toDateStr(sub.start),to:toDateStr(sub.end)};
  }
  if(S.statsPeriod==='month'&&sub.year!==undefined){
    const lastDay=new Date(sub.year,sub.month+1,0).getDate();
    const from=sub.year+'-'+String(sub.month+1).padStart(2,'0')+'-01';
    const to=sub.year+'-'+String(sub.month+1).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
    return {year:String(sub.year),from:from,to:to};
  }
  if(S.statsPeriod==='semester'&&sub.half){
    if(sub.half===1)
      return {year:String(sub.year),from:sub.year+'-03-01',to:sub.year+'-07-31'};
    return {year:String(sub.year),from:sub.year+'-08-01',to:(sub.year+1)+'-02-28'};
  }
  if(S.statsPeriod==='year'&&sub.year){
    return {year:String(sub.year),from:sub.year+'-03-01',to:(sub.year+1)+'-02-28'};
  }
  return null;
}

/**
 * 백엔드 통계 캐시 갱신 (renderDashboard 시작 시 호출)
 */
let _dashTreatCache=null;
let _dashRepeatCache=null;

async function _dashFetchStats(){
  _dashStatsCache=null;_dashPrevCache=null;_dashYoyCache=null;_dashSummaryCache=null;_dashTreatCache=null;_dashRepeatCache=null;
  const range=_dashGetDateRange();
  console.log('[DASH FETCH] period=',S.statsPeriod,'subIdx=',S._dashSubIdx,'range=',range);
  if(!range){console.log('[DASH FETCH] range null — skip');return;}
  try{
    /* 진료과 카테고리 로드 */
    await _dashLoadDeptCats();
    /* 현재 기간 집계 */
    const r1=await window.electronAPI.statsDbDeptGrade(range.year,range.from,range.to);
    if(r1&&r1.success)_dashStatsCache=r1.data;
    console.log('[DASH FETCH] stats cache updated. total=',_dashStatsCache&&_dashStatsCache.total);

    /* 요약 통계 (상위 증상) */
    const r2=await window.electronAPI.statsDbSummary(range.year,range.from,range.to);
    if(r2&&r2.success)_dashSummaryCache=r2.data;

    /* 처치·투약 통계 (DB 기반) */
    const r5=await window.electronAPI.statsDbTreatment(range.year,range.from,range.to);
    if(r5&&r5.success)_dashTreatCache=r5.data;

    /* 재방문 통계 (DB 기반) */
    const r6=await window.electronAPI.statsDbRepeatVisitors(range.year,range.from,range.to,3);
    if(r6&&r6.success)_dashRepeatCache=r6.data;

    /* 이전 기간 집계 */
    if(S.statsPeriod!=='today'&&S.statsPeriod!=='custom'){
      const prevRange=_dashGetDateRange(1);
      if(prevRange){
        const r3=await window.electronAPI.statsDbDeptGrade(prevRange.year,prevRange.from,prevRange.to);
        if(r3&&r3.success)_dashPrevCache=r3.data;
      }
    }

    /* 전년 동기 집계 (today·custom·year 제외) */
    if(S.statsPeriod!=='today'&&S.statsPeriod!=='custom'&&S.statsPeriod!=='year'){
      /* 현재 기간 진행 중이면 오늘 날짜까지만 YoY 비교 */
      const today=toDateStr(new Date());
      const yoyTo=(S._dashSubIdx===0&&range.to>today)?today:range.to;
      const r4=await window.electronAPI.statsDbDeptGradeYoY(range.year,range.from,yoyTo);
      if(r4&&r4.success)_dashYoyCache=r4.data;
    }
  }catch(e){console.error('[dashboard] _dashFetchStats 오류:',e);}
}

/* 진료과 카테고리 — 백엔드 유효 매핑(사용자 상분류 편집 반영) 로드 (캐시) */
let _dashDeptCats14Cache=null;
/* 설정에서 상분류(이름·추가·순서) 변경 시 캐시 무효화 — 다음 렌더 때 재요청 (2026-06-12) */
try{ bus.on('symcats:changed',function(){ _dashDeptCats14Cache=null; }); }catch(_){}
async function _dashLoadDeptCats(){
  if(_dashDeptCats14Cache)return _dashDeptCats14Cache;
  try{
    const res=await window.electronAPI.statsDbDeptCats();
    if(res&&res.success&&res.data)_dashDeptCats14Cache=res.data;
  }catch(e){}
  return _dashDeptCats14Cache||{};
}
function _dashDeptCats14(){return _dashDeptCats14Cache||{};}
/* 앱 내 자유기입 증상 → '선택한 대분류(catId)' 진료과 라벨. 기록의 symFreeTextByCat 사용 — 텍스트 추측보다 우선.
 *  자유기입은 무슨 글자든 반드시 선택한 대분류로만 집계 (사용자 보고 2026-06-17). 외부 이관(매핑 없음)은 기존 키워드 유지. */
function _dashFreeTextDeptMap(r){
  const m=new Map();
  const fbc=r&&r.symFreeTextByCat;
  if(fbc&&typeof fbc==='object'&&!Array.isArray(fbc)){
    Object.keys(fbc).forEach(function(catId){
      let lbl=''; try{ const c=getEffectiveSymCatById(catId); lbl=c&&c.name; }catch(_){}
      if(!lbl)return;
      const vv=fbc[catId];
      (Array.isArray(vv)?vv:[vv]).forEach(function(v){ const t=String(v||'').trim(); if(t)m.set(t,lbl); });
    });
  }
  return m;
}
/* 위 맵에서 증상의 대분류 라벨 조회(괄호 부위 메모 제거 base 도 시도). 없으면 '' (키워드 추측으로 폴백). */
function _dashFreeDept(map,sym){
  if(!map||!map.size)return '';
  let d=map.get(String(sym).trim());
  if(!d){ const mm=String(sym).match(/^(.+?)\s*\(/); if(mm)d=map.get(mm[1].trim()); }
  return d||'';
}

/* 🏷️ 미분류(기타) 증상 대분류 지정 도구 — 자유기입인데 대분류가 안 남아 기타로만 잡히는 증상을
 *  사용자가 직접 대분류를 골라 일괄 지정한다(sym_free_text_by_cat 채움 → 통계가 그 대분류로 집계). (사용자 요청 2026-06-17) */
async function _dashOpenUncatTool(){
  const range=_dashGetDateRange();
  if(!range){bus.emit('toast:show',{text:'기간 정보를 불러올 수 없습니다.'});return;}
  let list=[];
  try{
    const res=await window.electronAPI.statsDbUncategorizedSymptoms(range.year,range.from,range.to);
    if(res&&res.success)list=res.data||[]; else throw new Error((res&&res.error)||'조회 실패');
  }catch(e){bus.emit('toast:show',{text:'미분류 증상 조회 실패: '+e.message});return;}
  if(!list.length){bus.emit('toast:show',{text:'✅ 대분류를 지정할 미분류(기타) 증상이 없습니다.'});return;}
  const cats=getEffectiveSymCats(true);   /* 가린 분류 포함 — 통계는 가린 것도 집계하므로 */
  const optsHtml='<option value="">— 대분류 선택 —</option>'+cats.map(function(c){return '<option value="'+escHtml(c.id)+'">'+escHtml(c.name)+(c.isHidden?' (가림)':'')+'</option>';}).join('');
  let rows='';
  list.forEach(function(it,i){
    const _dts=(it.dates||[]);
    const _dtStr=_dts.length?(_dts.slice(0,3).join(', ')+(_dts.length>3?' 외 '+(_dts.length-3)+'일':'')):'-';
    rows+='<div style="display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--bdr)">'
      +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;color:var(--t1);word-break:break-all">'+escHtml(it.symptom)+'</div>'
      +'<div style="font-size:10.5px;color:var(--t3);margin-top:2px">'+it.count+'건 · 📅 '+escHtml(_dtStr)+' · 현재 진료과: <b style="color:#b45309">'+escHtml(it.currentDept||'기타')+'</b></div></div>'
      +'<select data-uncat-idx="'+i+'" style="flex-shrink:0;width:156px;font-size:12px;padding:6px 8px;border:1px solid var(--bdr);border-radius:7px;background:var(--bg2);color:var(--t1);font-family:var(--f);outline:none;cursor:pointer">'+optsHtml+'</select>'
      +'</div>';
  });
  const ov=document.createElement('div');
  ov.id='dashUncatOv';
  ov.style.cssText='position:fixed;inset:0;z-index:30000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)';
  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:580px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.5);overflow:hidden;font-family:var(--f)">'
    +'<div style="padding:14px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr)">'
    +'<div style="font-size:14px;font-weight:800;color:var(--t1)">🏷️ 미분류 증상 대분류 지정</div>'
    +'<div style="font-size:11px;color:var(--t3);margin-top:5px;line-height:1.55">아래는 현재 <b style="color:var(--t2)">기타</b>로 집계되는 증상입니다(미분류·자유기입 포함).<br>진료과(대분류)를 골라 <b style="color:var(--t2)">[적용]</b>하면 같은 증상의 모든 기록(해당 기간)이 그 진료과로 집계됩니다.</div></div>'
    +'<div style="flex:1;overflow-y:auto;padding:4px 18px">'+rows+'</div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--bdr)">'
    +'<button data-uncat-act="cancel" style="padding:7px 16px;font-size:12px;font-weight:600;border-radius:7px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;font-family:var(--f)">닫기</button>'
    +'<button data-uncat-act="apply" style="padding:7px 18px;font-size:12px;font-weight:700;border-radius:7px;border:1px solid rgba(6,182,212,0.4);background:rgba(6,182,212,0.12);color:var(--cyan);cursor:pointer;font-family:var(--f)">적용</button>'
    +'</div></div>';
  document.body.appendChild(ov);
  const close=function(){try{ov.remove();}catch(_){}};
  ov.addEventListener('mousedown',function(e){if(e.target===ov)close();});
  ov.querySelector('[data-uncat-act="cancel"]').addEventListener('click',close);
  ov.querySelector('[data-uncat-act="apply"]').addEventListener('click',async function(){
    const assignments=[];
    ov.querySelectorAll('select[data-uncat-idx]').forEach(function(sel){
      const idx=parseInt(sel.dataset.uncatIdx,10);const catId=sel.value;
      if(catId&&list[idx])assignments.push({symptom:list[idx].symptom,catId:catId,recordIds:list[idx].recordIds});
    });
    if(!assignments.length){bus.emit('toast:show',{text:'지정할 대분류를 한 개 이상 선택해주세요.'});return;}
    try{
      const res=await window.electronAPI.statsDbAssignSymCat({assignments:assignments});
      if(res&&res.success){
        /* S.records 도 즉시 동기화 — 대시보드 로컬 집계(성별 등)가 새 대분류 반영하도록 */
        assignments.forEach(function(a){
          a.recordIds.forEach(function(rid){
            const r=(S.records||[]).find(function(x){return x.id===rid;});
            if(r){ const m=(r.symFreeTextByCat&&typeof r.symFreeTextByCat==='object'&&!Array.isArray(r.symFreeTextByCat))?r.symFreeTextByCat:{}; m[a.catId]=a.symptom; r.symFreeTextByCat=m; }
          });
        });
        bus.emit('toast:show',{text:'✅ '+assignments.length+'개 증상 대분류 지정 완료 ('+(res.updated||0)+'건 반영)'});
        close();
        renderDashboard();
      } else { bus.emit('toast:show',{text:'적용 실패: '+((res&&res.error)||'오류')}); }
    }catch(e){bus.emit('toast:show',{text:'적용 실패: '+e.message});}
  });
}

export function _dashPrevPeriod(){
  if(S.statsPeriod==='today'){
    /* 오늘 탭: 하루 전으로 이동 */
    const d=new Date(S.selectedDate);d.setDate(d.getDate()-1);
    S.selectedDate=toDateStr(d);bus.emit('render:calendar');renderDashboard();
    return;
  }
  if(S._dashSubIdx<_dashGetSubTabs().length-1){S._dashSubIdx++;_dashRenderSubTabs();renderDashboard();}
}
export function _dashNextPeriod(){
  if(S.statsPeriod==='today'){
    /* 오늘 탭: 하루 후로 이동 */
    const d=new Date(S.selectedDate);d.setDate(d.getDate()+1);
    S.selectedDate=toDateStr(d);bus.emit('render:calendar');renderDashboard();
    return;
  }
  if(S._dashSubIdx>0){S._dashSubIdx--;_dashRenderSubTabs();renderDashboard();}
}

function _dashEmptyHtml(msg){
  return '<div class="dash-empty"><svg viewBox="0 0 64 64" fill="none"><rect x="12" y="20" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2"/><path d="M20 36h24M20 44h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="14" r="6" stroke="currentColor" stroke-width="2"/></svg><div class="de-msg">'+(msg||'아직 기록된 데이터가 없습니다.')+'</div><div class="de-hint">보건일지에서 기록을 추가해보세요</div></div>';
}

function _dashDelta(cur,prev){
  if(prev===0) return cur>0?{text:'신규 +'+cur,cls:'up'}:{text:'—',cls:'flat'};
  const pct=((cur-prev)/prev*100).toFixed(1);
  if(cur>prev) return {text:'▲ '+Math.abs(pct)+'%',cls:'up'};
  if(cur<prev) return {text:'▼ '+Math.abs(pct)+'%',cls:'down'};
  return {text:'—',cls:'flat'};
}

function _dashRangeLabel(){
  const tabs=_dashGetSubTabs();const sub=tabs[S._dashSubIdx];
  if(!sub)return '';
  if(S.statsPeriod==='week'&&sub.start){
    const s=sub.start, e=sub.end;
    return s.getFullYear()+'.'+(s.getMonth()+1)+'.'+s.getDate()+' ~ '+e.getFullYear()+'.'+(e.getMonth()+1)+'.'+e.getDate();
  }
  if(S.statsPeriod==='month'&&sub.year!==undefined) return sub.year+'년 '+(sub.month+1)+'월';
  if(S.statsPeriod==='semester'&&sub.half) return sub.year+'년 '+(sub.half===1?'1학기':'2학기');
  if(S.statsPeriod==='year'&&sub.year) return sub.year+'년 3월 ~ '+(sub.year+1)+'년 2월';
  if(S.statsPeriod==='today') return S.selectedDate||toDateStr(new Date());
  if(S.statsPeriod==='custom'&&S._dashCustomStart&&S._dashCustomEnd) return S._dashCustomStart+' ~ '+S._dashCustomEnd;
  return '';
}

/* ── 스크롤바 마우스 비활동 시 자동 숨김 ── */
let _scrollTimer=null;
const _scrollTargets=['view-dashboard','view-daily','view-magic','view-story'];
function _showScrollbars(){
  _scrollTargets.forEach(function(id){const el=document.getElementById(id);if(el)el.classList.add('scroll-active');});
  document.body.classList.add('scroll-active');
  clearTimeout(_scrollTimer);
  _scrollTimer=setTimeout(_hideScrollbars,1500);
}
function _hideScrollbars(){
  _scrollTargets.forEach(function(id){const el=document.getElementById(id);if(el)el.classList.remove('scroll-active');});
  document.body.classList.remove('scroll-active');
}
document.addEventListener('mousemove',_showScrollbars);
document.addEventListener('scroll',_showScrollbars,true);
document.addEventListener('wheel',_showScrollbars,{passive:true});

/* ── 대시보드 캔버스 커스텀 세로 스크롤바 ── */
{
  let _hideTimer=null, _inCanvas=false;
  function _initDashScroll(){
    const canvas=document.getElementById('dashCanvas');
    const bar=document.getElementById('dashVScroll');
    const thumb=document.getElementById('dashVScrollThumb');
    if(!canvas||!bar||!thumb)return;
    /* 상시 표시 (사용자 요청 2026-06-13) — 1.5초 자동 숨김·mouseleave 숨김 제거.
     * 콘텐츠가 스크롤 불가(ratio>=1)일 때만 숨김. */
    function _sync(){
      const ratio=canvas.clientHeight/canvas.scrollHeight;
      if(ratio>=1){bar.style.opacity='0';return;}
      bar.style.opacity='1';
      thumb.style.height=(ratio*100)+'%';
      thumb.style.top=(canvas.scrollTop/canvas.scrollHeight*100)+'%';
    }
    canvas.addEventListener('scroll',_sync);
    canvas.addEventListener('mouseenter',function(){_inCanvas=true;_sync();});
    canvas.addEventListener('mousemove',_sync);
    canvas.addEventListener('mouseleave',function(){_inCanvas=false;});
    void _hideTimer; /* 옛 자동 숨김 타이머 — 상시 표시 전환으로 미사용 */
    /* thumb 드래그 */
    let _dragging=false, _startY=0, _startScroll=0;
    thumb.addEventListener('mousedown',function(e){
      _dragging=true;_startY=e.clientY;_startScroll=canvas.scrollTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove',function(e){
      if(!_dragging)return;
      const dy=e.clientY-_startY;
      const ratio=canvas.scrollHeight/canvas.clientHeight;
      canvas.scrollTop=_startScroll+dy*ratio;
    });
    document.addEventListener('mouseup',function(){_dragging=false;});
    _sync();
    /* ── 바운스 스크롤 효과 (아래쪽만 — 탭 분리 방지) ── */
    let _canvasBouncing=false;
    canvas.addEventListener('scroll',function(){
      if(_canvasBouncing)return;
      const atBottom=canvas.scrollTop+canvas.clientHeight>=canvas.scrollHeight-2;
      if(atBottom){
        _canvasBouncing=true;
        canvas.style.transition='transform 0.2s cubic-bezier(.2,.8,.4,1.4)';
        canvas.style.transform='translateY(-18px)';
        setTimeout(function(){
          canvas.style.transition='transform 0.35s cubic-bezier(.25,.1,.25,1)';
          canvas.style.transform='translateY(0)';
          setTimeout(function(){canvas.style.transition='';_canvasBouncing=false;},350);
        },200);
      }
    });
  }
  /* DOM 로드 후 초기화 */
  if(document.readyState==='complete')_initDashScroll();
  else window.addEventListener('load',_initDashScroll);
}

export async function renderDashboard(){
  _closeDateVisitors();
  await _dashRenderSubTabs();
  await _dashFetchStats();
  const filtered=getFilteredRecords();
  const periodLabels={today:'오늘',week:'주간',month:'월간',semester:'학기',year:'연도',custom:'선택 기간'};
  const tabs=_dashGetSubTabs();const subLabel=tabs[S._dashSubIdx]?tabs[S._dashSubIdx].label:'';
  const dateLabel=periodLabels[S.statsPeriod]+(subLabel&&S._dashSubIdx>0?' · '+subLabel:'');
  document.querySelectorAll('#dashPeriodTabs .stats-period-tab').forEach(function(t){t.classList.toggle('active',t.dataset.period===S.statsPeriod);});
  const rl=document.getElementById('dashRangeLabel');if(rl)rl.textContent=_dashRangeLabel();
  /* 기간 선택(custom) 모드에서 ◀▶ 네비게이션 숨기기 */
  const _navPrev=document.getElementById('dashNavPrev');
  const _navNext=document.getElementById('dashNavNext');
  if(_navPrev)_navPrev.style.display=S.statsPeriod==='custom'?'none':'';
  if(_navNext)_navNext.style.display=S.statsPeriod==='custom'?'none':'';

  /* 기간 선택 모드: 입력란 클릭 → 달력 팝업 */
  if(S.statsPeriod==='custom'){
    const dEl=document.getElementById('dashDate');
    const _startVal=S._dashCustomStart||'시작일 선택';
    const _endVal=S._dashCustomEnd||'종료일 선택';
    const _startActive=S._dashCustomStart?'color:var(--cyan);font-weight:700':'color:var(--t3)';
    const _endActive=S._dashCustomEnd?'color:var(--cyan);font-weight:700':'color:var(--t3)';
    dEl.innerHTML='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      +'<span style="font-size:13px;font-weight:700;color:var(--t1)">📅 기간 선택</span>'
      +'<div style="display:flex;align-items:center;gap:6px">'
      +'<div data-action="dcp-open" data-target="start" class="dash-hover-border" style="padding:5px 14px;font-size:12px;'+_startActive+';border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-family:var(--f);min-width:100px;text-align:center;transition:border-color 0.15s;user-select:none">'+_startVal+'</div>'
      +'<span style="color:var(--t3);font-size:12px">~</span>'
      +'<div data-action="dcp-open" data-target="end" class="dash-hover-border" style="padding:5px 14px;font-size:12px;'+_endActive+';border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-family:var(--f);min-width:100px;text-align:center;transition:border-color 0.15s;user-select:none">'+_endVal+'</div>'
      +'</div>'
      +(S._dashCustomStart||S._dashCustomEnd?'<button data-action="dcp-reset" style="padding:3px 10px;font-size:10px;font-weight:600;background:transparent;color:var(--t3);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">초기화</button>':'')
      +'</div>';
    /* 이벤트 위임 바인딩 — 중복 방지 (재렌더 시 한 번만) */
    if(!dEl._dcpBound){
      dEl._dcpBound=true;
      dEl.addEventListener('click',function(e){
        const el=e.target.closest('[data-action]');if(!el)return;
        const act=el.dataset.action;
        if(act==='dcp-open')_dcpOpenPopup(el.dataset.target,el);
        else if(act==='dcp-reset'){_dcpStart='';_dcpEnd='';_dcpPhase='start';S._dashCustomStart='';S._dashCustomEnd='';renderDashboard();}
      });
      dEl.addEventListener('mouseenter',function(e){if(e.target.classList.contains('dash-hover-border'))e.target.style.borderColor='var(--cyan)';},true);
      dEl.addEventListener('mouseleave',function(e){if(e.target.classList.contains('dash-hover-border'))e.target.style.borderColor='var(--bdr)';},true);
    }
    /* 항상 렌더링 — 데이터 없으면 빈 프레임 */
    _dashRenderSummary(filtered);
    _dashRenderDeptStatsInline(filtered);
    _dashRenderDeptChart(filtered);
    return;
  }

  document.getElementById('dashDate').textContent=S.selectedDate+' ('+getDow(S.selectedDate)+') 기준 · '+dateLabel;
  _dashRenderSummary(filtered);
  _dashRenderDeptStatsInline(filtered);
  _dashRenderDeptChart(filtered);
}

/* ── 기간 선택 팝업 달력 ── */
let _dcpPopupTarget=''; /* 'start' 또는 'end' */
let _dcpPopupEl=null;
function _dcpOpenPopup(target,anchorEl){
  _dcpPopupTarget=target;
  /* 이전 팝업 제거 */
  const old=document.getElementById('dcpCalPopup');if(old)old.remove();
  /* 초기 연/월 설정 */
  if(typeof _dcpYear==='undefined'){const n=new Date();_dcpYear=n.getFullYear();_dcpMonth=n.getMonth();}
  if(target==='start'&&S._dashCustomStart){const p=new Date(S._dashCustomStart);_dcpYear=p.getFullYear();_dcpMonth=p.getMonth();}
  if(target==='end'&&S._dashCustomEnd){const p=new Date(S._dashCustomEnd);_dcpYear=p.getFullYear();_dcpMonth=p.getMonth();}
  /* 팝업 생성 */
  const pop=document.createElement('div');
  pop.id='dcpCalPopup';
  pop.style.cssText='position:absolute;z-index:9990;width:280px;border:1px solid var(--bdr);border-radius:10px;padding:8px;background:var(--card);box-shadow:0 8px 24px rgba(0,0,0,0.25);animation:spFadeIn 0.15s ease';
  /* 위치 계산 — 좌표 기준과 append 대상을 같은 컨테이너로 통일.
   *  옛 코드는 .canvas 기준으로 계산하고 #view-dashboard 에 붙여 두 원점이 다르면 달력이 엉뚱한 곳에 떴음.
   *  방문 순위 달력(_rkOpenCal)과 동일 패턴 (사용자 보고 2026-06-12) */
  let container=document.getElementById('view-dashboard');
  if(!container)container=document.querySelector('.canvas');
  container.style.position='relative';
  const rect=anchorEl.getBoundingClientRect();
  const cRect=container.getBoundingClientRect();
  pop.style.left=(rect.left-cRect.left)+'px';
  pop.style.top=(rect.bottom-cRect.top+4)+'px';
  container.appendChild(pop);
  _dcpPopupEl=pop;
  _dcpRenderPopup();
  /* 외부 클릭 닫기 */
  setTimeout(function(){document.addEventListener('mousedown',_dcpOutsideClick);},50);
}
function _dcpOutsideClick(e){
  const pop=document.getElementById('dcpCalPopup');
  if(pop&&!pop.contains(e.target)){_dcpClosePopup();}
}
function _dcpClosePopup(){
  document.removeEventListener('mousedown',_dcpOutsideClick);
  const pop=document.getElementById('dcpCalPopup');if(pop)pop.remove();
  _dcpPopupEl=null;
}
function _dcpRenderPopup(){
  const pop=document.getElementById('dcpCalPopup');if(!pop)return;
  const first=new Date(_dcpYear,_dcpMonth,1), last=new Date(_dcpYear,_dcpMonth+1,0);
  const startDay=first.getDay(), daysInMonth=last.getDate();
  const prevLast=new Date(_dcpYear,_dcpMonth,0).getDate();
  const today=toDateStr(new Date());
  /* 연/월 팝업 */
  let yPop='<div class="mcal-popup">';
  { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++) yPop+='<div class="mcal-popup-item'+(y===_dcpYear?' active':'')+'" data-action="dcp-popup-year" data-year="'+y+'">'+y+'</div>'; }
  yPop+='</div>';
  let mPop='<div class="mcal-popup" style="min-width:140px;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++) mPop+='<div class="mcal-popup-item'+(m===_dcpMonth?' active':'')+'" data-action="dcp-popup-month" data-month="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
  mPop+='</div>';
  let h='<div style="font-size:11px;color:var(--cyan);font-weight:600;text-align:center;margin-bottom:4px">'+(_dcpPopupTarget==='start'?'시작일 선택':'종료일 선택')+'</div>';
  h+='<div class="mcal-hdr" style="margin-bottom:4px">';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-action="dcp-popup-prev">◂</button></div>';
  h+='<div class="mcal-title"><span class="mcal-year">'+_dcpYear+'년'+yPop+'</span> <span class="mcal-month">'+monthNames[_dcpMonth]+mPop+'</span></div>';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-action="dcp-popup-next">▸</button></div>';
  h+='</div><div class="mcal-grid">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){
    let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
    h+='<div class="'+cls+'">'+d+'</div>';
  });
  for(let i=startDay-1;i>=0;i--) h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
  for(let d=1;d<=daysInMonth;d++){
    const ds=toDateStr(new Date(_dcpYear,_dcpMonth,d));
    const dow=new Date(_dcpYear,_dcpMonth,d).getDay();
    const hol=isHoliday(ds);
    const holName=hol?S.koreanHolidays[ds]:'';
    let cls='mcal-cell';
    if(ds===today)cls+=' today';
    if(dow===0)cls+=' sun';if(dow===6)cls+=' sat';
    if(hol&&dow!==0&&dow!==6)cls+=' holiday';
    /* 시작/종료 선택 표시 */
    if(ds===S._dashCustomStart||ds===S._dashCustomEnd)cls+=' selected';
    if(S._dashCustomStart&&S._dashCustomEnd&&ds>S._dashCustomStart&&ds<S._dashCustomEnd)cls+=' dcp-range';
    const title=holName||(dow===0?'일요일':dow===6?'토요일':'');
    h+='<div class="'+cls+'" data-action="dcp-popup-select" data-date="'+ds+'"'+(title?' title="'+title+'"':'')+'><span class="day-n">'+d+'</span></div>';
  }
  const totalCells=startDay+daysInMonth;const rem=(7-totalCells%7)%7;
  for(let i=1;i<=rem;i++) h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
  h+='</div>';
  /* 하단: 선택 범위 표시 */
  if(S._dashCustomStart||S._dashCustomEnd){
    h+='<div style="text-align:center;padding:6px 0 2px;font-size:10px;color:var(--t3)">';
    h+=(S._dashCustomStart||'?')+' ~ '+(S._dashCustomEnd||'?');
    h+='</div>';
  }
  pop.innerHTML=h;
  /* 리스너 누적 방지 — 같은 함수 reference 로 한 번만 바인딩 */
  if(!pop._dcpBound){
    pop._dcpBound=true;
    pop.addEventListener('click',function(e){
      e.stopPropagation();
      const el=e.target.closest('[data-action]');if(!el)return;
      const act=el.dataset.action;
      if(act==='dcp-popup-year'){_dcpYear=+el.dataset.year;_dcpRenderPopup();}
      else if(act==='dcp-popup-month'){_dcpMonth=+el.dataset.month;_dcpRenderPopup();}
      else if(act==='dcp-popup-prev'){_dcpMonth--;if(_dcpMonth<0){_dcpMonth=11;_dcpYear--;}_dcpRenderPopup();}
      else if(act==='dcp-popup-next'){_dcpMonth++;if(_dcpMonth>11){_dcpMonth=0;_dcpYear++;}_dcpRenderPopup();}
      else if(act==='dcp-popup-select'){_dcpPopupSelect(el.dataset.date);}
    });
  }
}
function _dcpPopupSelect(ds){
  if(_dcpPopupTarget==='start'){
    S._dashCustomStart=ds;
    /* 종료일이 시작일보다 이전이면 초기화 */
    if(S._dashCustomEnd&&S._dashCustomEnd<ds)S._dashCustomEnd='';
    _dcpClosePopup();
    /* 종료일이 없으면 자동으로 종료일 팝업 열기 */
    if(!S._dashCustomEnd){
      renderDashboard();
      setTimeout(function(){
        const endEl=document.querySelector('[data-action="dcp-open"][data-target="end"]');
        if(endEl)_dcpOpenPopup('end',endEl);
      },100);
      return;
    }
  } else {
    if(ds<S._dashCustomStart){S._dashCustomEnd=S._dashCustomStart;S._dashCustomStart=ds;}
    else S._dashCustomEnd=ds;
    _dcpClosePopup();
  }
  renderDashboard();
}

/* ── 진료과별 상세 통계 팝업 ── */
/* 전년 동기 대비: 현재 시점까지 정확히 자름 (일/시/분 반영) */
function _getYoyFiltered(){
  let yoy=[];
  if(S.statsPeriod==='today'||S.statsPeriod==='custom'||S.statsPeriod==='year')return yoy;
  const now=new Date();
  const tabs=_dashGetSubTabs();const sub=tabs[S._dashSubIdx];if(!sub)return yoy;

  if(S.statsPeriod==='week'&&sub.start){
    /* 이번 주: 월~현재요일+시간까지만. 작년도 같은 기간 */
    const daysSinceMonday=Math.floor((now-sub.start)/(24*60*60*1000));
    const yoyStart=new Date(sub.start);yoyStart.setFullYear(yoyStart.getFullYear()-1);
    const yoyEnd=new Date(yoyStart);yoyEnd.setDate(yoyEnd.getDate()+daysSinceMonday);
    yoyEnd.setHours(now.getHours(),now.getMinutes(),now.getSeconds());
    yoy=S.records.filter(function(r){
      const d=dateObj(r.date);
      if(d<yoyStart||d>yoyEnd)return false;
      /* 마지막 날은 시간까지 비교 */
      if(d.getTime()===dateObj(toDateStr(yoyEnd)).getTime()&&r.timeIn){
        const tp=r.timeIn.split(':');const rH=+tp[0]||0, rM=+tp[1]||0;
        if(rH>now.getHours()||(rH===now.getHours()&&rM>now.getMinutes()))return false;
      }
      return true;
    });
  } else if(S.statsPeriod==='month'&&sub.year!==undefined){
    /* 이번 달: 1일~현재일+시간. 작년도 같은 달 같은 일+시간까지 */
    const curDay=now.getDate();
    const yoyY=sub.year-1;const yoyM=sub.month;
    yoy=S.records.filter(function(r){
      const ry=+r.date.split('-')[0], rm=+r.date.split('-')[1]-1, rd=+r.date.split('-')[2];
      if(ry!==yoyY||rm!==yoyM)return false;
      if(rd>curDay)return false;
      if(rd===curDay&&r.timeIn){
        const tp=r.timeIn.split(':');const rH=+tp[0]||0, rM=+tp[1]||0;
        if(rH>now.getHours()||(rH===now.getHours()&&rM>now.getMinutes()))return false;
      }
      return true;
    });
  } else if(S.statsPeriod==='semester'&&sub.half){
    /* 학기: 시작월~현재월일+시간. 작년도 같은 학기 같은 시점까지 */
    const yoyY2=sub.year-1;
    const startM=sub.half===1?2:7; /* 0-indexed: 1학기=3월(2), 2학기=8월(7) */
    const curM=now.getMonth();const curD=now.getDate();
    yoy=S.records.filter(function(r){
      const ry=+r.date.split('-')[0], rm=+r.date.split('-')[1]-1, rd=+r.date.split('-')[2];
      if(sub.half===1){
        if(ry!==yoyY2||rm<startM)return false;
        if(rm>curM||(rm===curM&&rd>curD))return false;
      } else {
        const inRange=(ry===yoyY2&&rm>=startM)||(ry===yoyY2+1&&rm<=1);
        if(!inRange)return false;
        /* 현재 시점까지 자르기 */
        const curYrM=now.getMonth();const curYrD=now.getDate();
        if(ry===yoyY2+1&&rm<=1){if(rm>curYrM||(rm===curYrM&&rd>curYrD))return false;}
        else{if(rm>curYrM||(rm===curYrM&&rd>curYrD))return false;}
      }
      if(rm===curM&&rd===curD&&r.timeIn){
        const tp=r.timeIn.split(':');const rH=+tp[0]||0, rM2=+tp[1]||0;
        if(rH>now.getHours()||(rH===now.getHours()&&rM2>now.getMinutes()))return false;
      }
      return true;
    });
  }
  return yoy;
}

function _dashRenderDeptStatsInline(filtered){
  const panel=document.getElementById('dashPanelDeptStats');if(!panel)return;
  const _isKinder=(S.settings.schoolLevel||'')==='kindergarten';
  const _deptPeriodTitle={today:'일간',week:'주간',month:'월간',semester:'학기간',year:'연간',custom:'선택 기간'};
  const cmpLabels={week:'지난 주 대비',month:'지난 달 대비',semester:'지난 학기 대비'};
  const cmpLabel=cmpLabels[S.statsPeriod]||'';
  const gradeLabel=S.settings.schoolLevel==='kindergarten'?'세':'학년';
  const registeredGrades=S.people.filter(function(s){return s.type==='student';}).map(function(s){return parseInt(s.grade,10)||0;}).filter(function(g){return g>0;});
  const maxG=registeredGrades.length?Math.max.apply(null,registeredGrades):0;
  const gradeList=maxG>0?Array.from({length:maxG},function(_,i){return i+1;}):getGrades();

  /* 백엔드 캐시에서 deptKeys 추출 — 없으면 _dashDeptCats14() 폴백 */
  const deptKeys=_dashStatsCache?Object.keys(_dashStatsCache.deptCounts):Object.keys(_dashDeptCats14());
  const gradeByDept=(_dashStatsCache&&_dashStatsCache.gradeByDept)||{};
  const deptCounts=(_dashStatsCache&&_dashStatsCache.deptCounts)||{};

  /* 캐시 데이터를 {totals, grand} 형태로 변환하는 헬퍼 */
  function _makeSums(deptCacheObj,field){
    /* field: 'total'|'student'|'staff'|'male'|'female' */
    const t={};

    let g=0;
    deptKeys.forEach(function(dk){
      let v=0;
      if(field==='male'||field==='female'){
        /* gradeByDept 합산으로 성별 집계 */
        Object.values(gradeByDept).forEach(function(gd){v+=((gd[dk]||{})[field]||0);});
      } else {
        v=((deptCacheObj[dk]||{})[field]||0);
      }
      t[dk]=v;g+=v;
    });
    return{totals:t,grand:g};
  }
  function _makeCmpSums(cache,field){
    if(!cache)return null;
    const t={};
    let g=0;
    deptKeys.forEach(function(dk){const v=((cache.deptCounts[dk]||{})[field]||0);t[dk]=v;g+=v;});
    return{totals:t,grand:g};
  }

  function _cmpRow(label,cur,prev,bg){
    if(!prev)return'';
    let h2='<tr style="'+(bg||'')+'"><td style="padding:7px 6px;font-weight:700;color:var(--t3);position:sticky;left:0;z-index:1;'+(bg||'')+'">'+label+'</td>';
    deptKeys.forEach(function(dk){const diff=cur.totals[dk]-prev.totals[dk];const c=diff>0?'#16a34a':diff<0?'#dc2626':'var(--t3)';h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:'+c+'">'+(diff>0?'▲'+diff:diff<0?'▼'+Math.abs(diff):'—')+'</td>';});
    const gd=cur.grand-prev.grand;const gc=gd>0?'#16a34a':gd<0?'#dc2626':'var(--t3)';
    h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:'+gc+'">'+(gd>0?'▲'+gd:gd<0?'▼'+Math.abs(gd):'—')+'</td></tr>';
    return h2;
  }
  function _sumRow(label,sums,bold,bg){
    let h2='<tr style="border-top:'+(bold?'2':'1')+'px solid var(--bdr);'+(bg||'background:var(--bg2)')+'"><td style="padding:7px 6px;font-weight:700;color:var(--t1);position:sticky;left:0;z-index:1;'+(bg||'background:var(--bg2)')+'">'+label+'</td>';
    deptKeys.forEach(function(dk){h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:'+(bold?'800':'700')+';color:'+(sums.totals[dk]>0?'var(--t1)':'var(--t3)')+'">'+sums.totals[dk]+'</td>';});
    h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+sums.grand+'</td></tr>';
    return h2;
  }
  function _tblHead(){return '<div style="overflow-x:auto;scrollbar-width:thin"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><thead><tr style="background:var(--bg2);border-bottom:2px solid var(--bdr)"><th style="padding:7px 6px;text-align:left;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1">학년</th>'+deptKeys.map(function(dk){return '<th style="padding:7px 6px;text-align:center;color:var(--t3);font-weight:600;min-width:50px">'+dk.replace('계','')+'</th>';}).join('')+'<th style="padding:7px 6px;text-align:center;color:var(--cyan);font-weight:700">계</th></tr></thead><tbody>';}

  /* 집계 */
  const maleSums=_makeSums(deptCounts,'male');
  const femaleSums=_makeSums(deptCounts,'female');
  const allStuSums=_makeSums(deptCounts,'student');
  const staffSums=_makeSums(deptCounts,'staff');
  const allSums2=_makeSums(deptCounts,'total');
  const prevStuSums=_makeCmpSums(_dashPrevCache,'student');
  const prevStaffSums=_makeCmpSums(_dashPrevCache,'staff');
  const prevAllSums=_makeCmpSums(_dashPrevCache,'total');
  const yoyStuSums=_makeCmpSums(_dashYoyCache,'student');
  const yoyStaffSums=_makeCmpSums(_dashYoyCache,'staff');
  const yoyAllSums=_makeCmpSums(_dashYoyCache,'total');

  let h='<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:3px;display:flex;align-items:center">📋 진료과별 증상 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계<span style="flex:1"></span><button data-action="copy-element" data-el="dashPanelDeptStats" data-toast="통계표 이미지 복사됨" title="이미지로 복사" class="dash-copy-btn" style="background:none;border:none;cursor:pointer;padding:3px;opacity:0.3;transition:opacity 0.2s;flex-shrink:0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>'+(S.statsPeriod==='semester'?'<button data-action="uncat-tool" title="기타로 집계되는 증상에 진료과(대분류)를 지정합니다 — 학기 통계 전용" class="dash-copy-btn" style="background:none;border:none;cursor:pointer;padding:3px;opacity:0.3;transition:opacity 0.2s;flex-shrink:0;font-size:13px;line-height:1;margin-left:2px">🏷️</button>':'')+'</div>';
  h+='<div style="font-size:10.5px;color:var(--t3);margin-bottom:11px;line-height:1.55">※ 단순 방문 수가 아니라 <b style="color:var(--t2)">증상 건수</b>를 집계한 값입니다. 한 방문자가 증상이 여러 개면 각각 집계되어 방문자 수보다 많을 수 있습니다.</div>';

  /* 학생 통계 (학년별) — 백엔드 gradeByDept 사용 */
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">'+(_isKinder?'원아':'학생')+' '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계</div>';
  h+=_tblHead();
  /* 멀티 학교급 감지 — gradeByDept 키에 "초_1" 같은 prefix 있는지 확인 */
  const _gbdKeys=Object.keys(gradeByDept).filter(function(k){return k!=='미상';});
  const _hasMultiLvKeys={};
  _gbdKeys.forEach(function(k){const m=k.match(/^([가-힣A-Za-z]+)_(\d+)$/);if(m)_hasMultiLvKeys[m[1]]=true;});
  const _lvOrder={'유':0,'초':1,'중':2,'고':3,'대':4};
  const _multiLvList=Object.keys(_hasMultiLvKeys).sort(function(a,b){return(_lvOrder[a]!==undefined?_lvOrder[a]:99)-(_lvOrder[b]!==undefined?_lvOrder[b]:99);});
  /* 행 목록 구성 */
  const _rowList=[]; /* [{key,label}] */
  if(_multiLvList.length>=2){
    /* 학교급별 학년 그룹 — "초1학년", "중1학년" */
    _multiLvList.forEach(function(lv){
      const grades=_gbdKeys.filter(function(k){return k.indexOf(lv+'_')===0;}).map(function(k){return parseInt(k.split('_')[1],10);}).filter(function(g){return !isNaN(g);}).sort(function(a,b){return a-b;});
      grades.forEach(function(g){_rowList.push({key:lv+'_'+g,label:lv+g+(lv==='유'?'세':gradeLabel)});});
    });
  }else{
    /* 단일 학교급 — 기존 gradeList 그대로 */
    gradeList.forEach(function(g){_rowList.push({key:String(g),label:g+gradeLabel,_grade:g});});
  }
  _rowList.forEach(function(row){
    let gd=gradeByDept[row.key]||{};
    if(!Object.keys(gd).length&&row._grade!=null){
      const _lvAbbr={'elementary':'초','middle':'중','high':'고','kindergarten':'유','special':'특'};
      const _lk=(_lvAbbr[S.settings.schoolLevel]||'')+'_'+row._grade;
      gd=gradeByDept[_lk]||{};
    }
    let rt=0;
    h+='<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:7px 6px;font-weight:600;color:var(--t2)">'+row.label+'</td>';
    deptKeys.forEach(function(dk){const c=(gd[dk]||{}).total||0;rt+=c;h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);color:'+(c>0?'var(--t1)':'var(--t3)')+'">'+c+'</td>';});
    h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:var(--cyan)">'+rt+'</td></tr>';
  });
  h+=_sumRow('남 소계',maleSums,false,'background:rgba(16,185,129,0.08)');
  h+=_sumRow('여 소계',femaleSums,false,'background:rgba(56,189,248,0.10)');
  h+=_sumRow('남녀 소계',allStuSums,true,'background:rgba(168,85,247,0.08)');
  if(cmpLabel&&_dashPrevCache)h+=_cmpRow(cmpLabel,allStuSums,prevStuSums,'background:rgba(6,182,212,0.04)');
  if(S.statsPeriod!=='today'&&S.statsPeriod!=='year'&&_dashYoyCache&&_dashYoyCache.total>0)h+=_cmpRow('전년 동기 대비',allStuSums,yoyStuSums,'background:rgba(168,85,247,0.04)');
  h+='</tbody></table></div>';

  /* 교직원 통계 */
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin:16px 0 6px">교직원 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계</div>';
  h+='<div style="overflow-x:auto;scrollbar-width:thin"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><thead><tr style="background:var(--bg2);border-bottom:2px solid var(--bdr)"><th style="padding:7px 6px;text-align:left;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1"></th>'+deptKeys.map(function(dk){return '<th style="padding:7px 6px;text-align:center;color:var(--t3);font-weight:600;min-width:50px">'+dk.replace('계','')+'</th>';}).join('')+'<th style="padding:7px 6px;text-align:center;color:var(--cyan);font-weight:700">계</th></tr></thead><tbody>';
  h+=_sumRow('계',staffSums,true,'background:var(--bg2)');
  if(cmpLabel&&_dashPrevCache)h+=_cmpRow(cmpLabel,staffSums,prevStaffSums,'background:rgba(6,182,212,0.04)');
  if(S.statsPeriod!=='today'&&S.statsPeriod!=='year'&&_dashYoyCache&&_dashYoyCache.total>0)h+=_cmpRow('전년 동기 대비',staffSums,yoyStaffSums,'background:rgba(168,85,247,0.04)');
  h+='</tbody></table></div>';

  /* 전체 통계 */
  const _nurseChk=localStorage.getItem('ec_dashNurseChk')==='Y';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 6px">';
  h+='<span style="font-size:13px;font-weight:700;color:var(--t1)">전체 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계 (학생+교직원)</span>';
  h+='<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px;color:var(--t2);user-select:none"><input type="checkbox" id="dashNurseChk" '+(_nurseChk?'checked':'')+' style="accent-color:var(--cyan);cursor:pointer">처치자 구분</label>';
  h+='</div>';
  h+='<div style="overflow-x:auto;scrollbar-width:thin"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><thead><tr style="background:var(--bg2);border-bottom:2px solid var(--bdr)"><th style="padding:7px 6px;text-align:left;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1"></th>'+deptKeys.map(function(dk){return '<th style="padding:7px 6px;text-align:center;color:var(--t3);font-weight:600;min-width:50px">'+dk.replace('계','')+'</th>';}).join('')+'<th style="padding:7px 6px;text-align:center;color:var(--cyan);font-weight:700">계</th></tr></thead><tbody>';
  h+='<tr style="background:rgba(109,212,184,0.04)"><td style="padding:7px 6px;font-weight:600;color:var(--t1);position:sticky;left:0;z-index:1;background:rgba(109,212,184,0.04)">학생</td>';deptKeys.forEach(function(dk){const v=allStuSums.totals[dk];h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);color:'+(v>0?'var(--t1)':'var(--t3)')+'">'+v+'</td>';});h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+allStuSums.grand+'</td></tr>';
  h+='<tr style="background:rgba(245,163,212,0.04)"><td style="padding:7px 6px;font-weight:600;color:var(--t1);position:sticky;left:0;z-index:1;background:rgba(245,163,212,0.04)">교직원</td>';deptKeys.forEach(function(dk){const v=staffSums.totals[dk];h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);color:'+(v>0?'var(--t1)':'var(--t3)')+'">'+v+'</td>';});h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+staffSums.grand+'</td></tr>';
  /* 처치자 구분 — 체크 시 처치자별 계 행 추가 */
  if(_nurseChk){
    const _nMap={};
    filtered.forEach(function(r){
      const nm=r.nurse||'미지정';
      if(!_nMap[nm])_nMap[nm]={totals:{},grand:0};
      deptKeys.forEach(function(dk){if(!_nMap[nm].totals[dk])_nMap[nm].totals[dk]=0;});
      const dept=r.dept||'기타';
      let matched=false;
      deptKeys.forEach(function(dk){if(dk===dept||dk===dept+'계'){_nMap[nm].totals[dk]=(_nMap[nm].totals[dk]||0)+1;_nMap[nm].grand++;matched=true;}});
      if(!matched){const etcKey=deptKeys.indexOf('기타계')!==-1?'기타계':deptKeys[deptKeys.length-1];if(etcKey){_nMap[nm].totals[etcKey]=(_nMap[nm].totals[etcKey]||0)+1;_nMap[nm].grand++;}}
    });
    const _nColors=['rgba(59,130,246,0.06)','rgba(245,158,11,0.06)','rgba(139,92,246,0.06)','rgba(236,72,153,0.06)','rgba(34,197,94,0.06)'];
    let _ni=0;
    Object.keys(_nMap).sort().forEach(function(nm){
      const ns=_nMap[nm];const bg=_nColors[_ni%_nColors.length];_ni++;
      h+='<tr style="background:'+bg+'"><td style="padding:7px 6px;font-weight:600;color:var(--t1);position:sticky;left:0;z-index:1;background:'+bg+'">'+nm+' 계</td>';
      deptKeys.forEach(function(dk){const v=ns.totals[dk]||0;h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);color:'+(v>0?'var(--t1)':'var(--t3)')+'">'+v+'</td>';});
      h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+ns.grand+'</td></tr>';
    });
  }
  h+=_sumRow('계',allSums2,true,'background:var(--bg2)');
  if(cmpLabel&&_dashPrevCache)h+=_cmpRow(cmpLabel,allSums2,prevAllSums,'background:rgba(6,182,212,0.04)');
  if(S.statsPeriod!=='today'&&S.statsPeriod!=='year'&&_dashYoyCache&&_dashYoyCache.total>0)h+=_cmpRow('전년 동기 대비',allSums2,yoyAllSums,'background:rgba(168,85,247,0.04)');
  h+='</tbody></table></div>';

  /* 하단 버튼 */
  h+='<div style="display:flex;gap:4px;justify-content:center;padding:12px 0 4px;margin-top:12px;flex-wrap:wrap">';
  h+='<button data-action="dept-copy" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>클립보드 데이터 복사</button>';
  h+='<button data-action="dept-excel" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>엑셀 내보내기</button>';
  h+='<button data-action="dept-png" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>PNG 다운로드</button>';
  /* PDF 다운로드 버튼 제거됨 */
  h+='<button data-action="dept-sheet" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</button>';
  h+='</div>';
  panel.innerHTML=h;
  _dashBindPanelDelegation(panel);
}
function _dashRenderDeptChart(filtered){
  const panel=document.getElementById('dashPanelDeptChart');if(!panel)return;
  const _dptTitle={today:'일간',week:'주간',month:'월간',semester:'학기간',year:'연간',custom:'선택 기간'};

  /* 진료과 집계 — 백엔드 캐시 사용, 없으면 인메모리 폴백 */
  const deptCats14=_dashDeptCats14();
  const deptKeys=_dashStatsCache?Object.keys(_dashStatsCache.deptCounts):Object.keys(deptCats14);
  const counts={};
  if(_dashStatsCache){
    deptKeys.forEach(function(dk){counts[dk]=(_dashStatsCache.deptCounts[dk]||{}).total||0;});
  } else {
    /* 인메모리 폴백 — 매핑이 1:1(증상→상분류 1곳)이라 증상당 1회만 집계됨 (이중집계 제거, 2026-06-14) */
    deptKeys.forEach(function(dk){counts[dk]=0;});
    filtered.forEach(function(r){r.symptoms.forEach(function(sym){deptKeys.forEach(function(dk){if((deptCats14[dk]||[]).indexOf(sym)!==-1)counts[dk]++;});});});
  }

  /* 항상 14개 전부 표시 — 데이터 있는 것부터 정렬, 0인 것은 뒤에 원래 순서 유지 */
  const _hasData=deptKeys.filter(function(dk){return counts[dk]>0;}).sort(function(a,b){return counts[b]-counts[a];});
  const _noDataKeys=deptKeys.filter(function(dk){return counts[dk]===0;});
  const sorted=_hasData.concat(_noDataKeys);
  const _noData=!_hasData.length;
  const maxV=counts[sorted[0]]||1;
  let totalDept=0;sorted.forEach(function(dk){totalDept+=counts[dk];});
  const _copyBtnHtml=function(elId,toast){return '<button data-action="copy-element" data-el="'+elId+'" data-toast="'+toast+'" title="복사" class="dash-copy-btn" style="background:none;border:none;cursor:pointer;padding:3px;opacity:0.3;transition:opacity 0.2s;flex-shrink:0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';};
  let h='<div id="dashChartArea">';
  /* ── 전체 제목 ── */
  h+='<div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:4px">📊 '+(_dptTitle[S.statsPeriod]||'')+' 시각화 차트</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:16px">선택한 기간의 진료과별 분포와 학년별 방문 현황을 시각적으로 비교합니다.</div>';

  /* ── 학년 데이터 계산 ── */
  const _sl=S.settings.schoolLevel||'elementary';
  const _isSpecial=_sl==='special';
  const _isKinder=_sl==='kindergarten';
  const _barStroke='font-family:var(--fm);color:#fff;font-weight:800;-webkit-text-stroke:0.5px #000;paint-order:stroke fill;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000';

  /* 학년 목록 구성 */
  const gradeItems=[]; /* [{key,label,grade,level}] */
  if(_isSpecial){
    /* 특수학교: 실제 등록 학생의 학교급+학년을 동적 검출 */
    /* 정렬 우선순위 — s.level은 이미 한국어(유/초/중/고/대) */
    const _spOrderMap={'유':0,'초':1,'중':2,'고':3,'대':4};
    const _spFound={}; /* {level: Set of grades} */
    S.people.forEach(function(s){
      if(s.type!=='student')return;
      const lv=s.level||'';
      const g=parseInt(s.grade,10)||0;
      if(g<=0||!lv)return;
      if(!_spFound[lv])_spFound[lv]=new Set();
      _spFound[lv].add(g);
    });
    /* 발견된 학교급을 우선순위순 정렬 */
    const _spFoundKeys=Object.keys(_spFound).sort(function(a,b){return(_spOrderMap[a]!==undefined?_spOrderMap[a]:99)-(_spOrderMap[b]!==undefined?_spOrderMap[b]:99);});
    _spFoundKeys.forEach(function(lv){
      const grades=Array.from(_spFound[lv]).sort(function(a,b){return a-b;});
      const isAge=(lv==='유');
      grades.forEach(function(g){
        gradeItems.push({key:lv+'_'+g,label:isAge?(lv+g+'세'):(lv+g),grade:g,level:lv});
      });
    });
  } else if(_isKinder){
    /* 유치원: 실제 등록된 나이만 포함 */
    const _kAges={};
    S.people.forEach(function(s){if(s.type==='student'){const g=parseInt(s.grade,10)||0;if(g>0)_kAges[g]=true;}});
    let _kList=Object.keys(_kAges).map(Number).sort();
    if(!_kList.length)_kList=getGrades();
    _kList.forEach(function(g){gradeItems.push({key:'k_'+g,label:'만'+g+'세',grade:g,level:'kindergarten'});});
  } else if(hasMultipleSchoolLevels()){
    /* 학교급이 혼재(예: 유+초, 초+중) — 학교급+학년 조합으로 그룹 */
    const _mlOrderMap={'유':0,'초':1,'중':2,'고':3,'대':4};
    const _mlFound={}; /* {short: Set of grades} */
    S.people.forEach(function(s){
      if(s.type!=='student')return;
      const lvShort=getLevelShort(s); /* 초/중/고/유/대 */
      const g=parseInt(s.grade,10)||0;
      if(g<=0||!lvShort)return;
      if(!_mlFound[lvShort])_mlFound[lvShort]=new Set();
      _mlFound[lvShort].add(g);
    });
    const _mlKeys=Object.keys(_mlFound).sort(function(a,b){return(_mlOrderMap[a]!==undefined?_mlOrderMap[a]:99)-(_mlOrderMap[b]!==undefined?_mlOrderMap[b]:99);});
    _mlKeys.forEach(function(lv){
      const grades=Array.from(_mlFound[lv]).sort(function(a,b){return a-b;});
      const isAge=(lv==='유');
      grades.forEach(function(g){
        gradeItems.push({key:lv+'_'+g,label:isAge?(lv+g+'세'):(lv+g),grade:g,level:lv});
      });
    });
  } else {
    const registeredGrades=S.people.filter(function(s){return s.type==='student';}).map(function(s){return parseInt(s.grade,10)||0;}).filter(function(g){return g>0;});
    const maxG=registeredGrades.length?Math.max.apply(null,registeredGrades):0;
    const gradeList=maxG>0?Array.from({length:maxG},function(_,i){return i+1;}):getGrades();
    gradeList.forEach(function(g){gradeItems.push({key:'g_'+g,label:g+'학년',grade:g,level:_sl});});
  }

  /* 학년별 카운트 */
  const _isMulti=!_isSpecial&&!_isKinder&&hasMultipleSchoolLevels();
  const gradeCount={};gradeItems.forEach(function(gi){gradeCount[gi.key]=0;});
  filtered.forEach(function(r){
    const s=getStu(r.studentId);if(!s||s.type==='staff')return;
    const g=parseInt(s.grade,10)||0;if(g<=0)return;
    let k;
    if(_isSpecial){
      const lv=s.level||'';
      k=lv+'_'+g;
      if(gradeCount[k]!==undefined)gradeCount[k]++;
    } else if(_isKinder){
      k='k_'+g;if(gradeCount[k]!==undefined)gradeCount[k]++;
    } else if(_isMulti){
      const lv=getLevelShort(s);
      k=lv+'_'+g;
      if(gradeCount[k]!==undefined)gradeCount[k]++;
    } else {
      k='g_'+g;if(gradeCount[k]!==undefined)gradeCount[k]++;
    }
  });
  const gMaxV=Math.max.apply(null,gradeItems.map(function(gi){return gradeCount[gi.key];}))||1;
  let totalGrade=0;gradeItems.forEach(function(gi){totalGrade+=gradeCount[gi.key];});

  /* ── 막대 렌더 공통 ── */
  const barH=160;
  function _renderBar(cnt,maxVal,col,title,noData){
    const px=noData?6:Math.max(12,Math.round(cnt/maxVal*barH));
    const colFade=col+'33';
    const opacity=noData?'0.25':'1';
    return '<div style="width:100%;max-width:42px;height:'+px+'px;background:linear-gradient(180deg,'+col+','+col+'cc);border-radius:4px 4px 0 0;box-shadow:0 -2px 8px '+colFade+';transition:height 0.5s ease-out;display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px;opacity:'+opacity+'" title="'+title+'"><span style="font-size:11px;'+_barStroke+'">'+cnt+'</span></div>';
  }

  /* ── 레이아웃 결정 ── */
  const _deptBarCount=sorted.length||1;
  const _gradeBarCount=gradeItems.length||1;
  const _gradeFullWidth=_isSpecial; /* 특수학교는 학년 차트도 전체폭 */
  const _gradeTitle=_isKinder?'나이별 방문 분포':'학년별 방문 분포';

  /* ══ 진료과별 분포 ══ */
  if(_gradeFullWidth){
    /* 특수학교: 진료과 전체폭 */
    h+='<div id="dashChartDept" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative">';
  } else {
    h+='<div style="display:flex;gap:20px;flex-wrap:wrap">';
    h+='<div id="dashChartDept" style="flex:'+Math.max(6,_deptBarCount-4)+';min-width:200px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 8px 10px;position:relative">';
  }
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:24px;padding-bottom:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#3B82F6,#8B5CF6);border-radius:2px"></span>진료과(증상)별 분포 <span style="font-size:10px;color:var(--t3);font-weight:500">(총 '+totalDept+'건)</span><span style="flex:1"></span>'+_copyBtnHtml('dashChartDept','진료과별 차트 복사됨')+'</div>';
  /* 진료과별 남/여/미상 집계 — 백엔드 _guessDepts 와 동일한 정규식 매칭 로직 사용해 counts 와 합계 일치.
     단순 _deptCats14 indexOf 만으로는 자유 입력 증상(예: "감기 기운")이 매칭 안 돼 모두 "기타"로 흘러가 합계가 폭발하는 문제 방지. */
  const _deptMale={}, _deptFemale={}, _deptUnknown={};
  deptKeys.forEach(function(dk){_deptMale[dk]=0;_deptFemale[dk]=0;_deptUnknown[dk]=0;});
  const _deptCats14=_dashDeptCats14();
  function _ddGuessDepts(sym){
    const hits=[];
    deptKeys.forEach(function(dk){if((_deptCats14[dk]||[]).indexOf(sym)!==-1)hits.push(dk);});
    if(hits.length)return hits;
    /* 괄호(부위/메모) 떼고 base 증상명 사전 재매칭 — 연필 메모 케이스 정확 매핑 (2026-06-17) */
    const _bm=String(sym).match(/^(.+?)\s*\(/);
    if(_bm){const _bb=_bm[1].trim();deptKeys.forEach(function(dk){if((_deptCats14[dk]||[]).indexOf(_bb)!==-1)hits.push(dk);});if(hits.length)return hits;}
    const s=String(sym||'');
    if(/눈|안구|결막|시력|다래끼|눈꺼풀|충혈|안약/.test(s))hits.push('안과');
    if(/편도|인후|성대|귀|이명|난청|중이|외이|목감기|목아/.test(s))hits.push('이비인후');
    if(/치아|치통|잇몸|구내염|입술|혀|턱|이빨|어금니|앞니|송곳니|사랑니|충치|구강/.test(s))hits.push('구강/치아');
    if(/기침|가래|콧물|코막힘|재채기|호흡곤란|천식|감기|독감|코피|비염|축농증|부비동|인후염|편도염/.test(s))hits.push('호흡기');
    if(/두통|편두통|어지럼|어지러|현기|저림|경련|마비/.test(s))hits.push('두통/신경');
    if(/복통|구토|구역|설사|변비|속쓰림|소화불량|식욕부진|배아|배탈|배.*아|배.*아픔|명치/.test(s))hits.push('소화기');
    if(/가슴.*(두근|통증|답답)|두근|저혈압|고혈압|빈혈|심계|심장|심박|맥박|어지러움|기립성/.test(s))hits.push('순환기');
    if(/근육통|근육경련|관절|요통|허리|어깨|손목|무릎|발목.*염좌|염좌|손가락.*통|발가락.*통|팔.*통|다리.*통|삐|뼈|근육/.test(s))hits.push('근골격');
    if(/발진|두드러기|가려|습진|여드름|피부|수포|물린|물림|알레르기|아토피|홍반|따갑|발적|벌레|모기|벌\s*쏘|벌쏘/.test(s))hits.push('피부');
    if(/넘어짐|부딪|찰과|열상|베임|찔림|타박|접질|화상|골절|긁힘|까짐|부종|출혈|상처|외상|찢어|까진|부어|삠|삔|긁혀|꼬집|밟힘|부러|탈골/.test(s))hits.push('외상');
    if(/배뇨|빈뇨|혈뇨|생리|하복부|방광|소변|월경|생리통|요도|요실금|탈수/.test(s))hits.push('비뇨/생식');
    if(/불안|스트레스|우울|공황|과호흡|불면|자해|긴장|두려움|걱정|초조|무기력|공포|짜증|분노|자살|정신|심리|트라우마/.test(s))hits.push('정신/심리');
    if(/코로나|수두|이하선염|장염|식중독|수족구|감염|유행성|독감|인플루엔자|홍역|풍진|결핵|옴|머릿니|노로|로타/.test(s))hits.push('감염');
    if(/피로|수면부족|성장통/.test(s))hits.push('기타');
    return hits.length?hits:['기타'];
  }
  filtered.forEach(function(r){
    const stu=getStu(r.studentId);if(!stu)return;
    let g=stu.gender;if(g==='M')g='남';else if(g==='F')g='여';
    const _ftm=_dashFreeTextDeptMap(r);   /* 자유기입 → 선택한 대분류 고정 (2026-06-17) */
    r.symptoms.forEach(function(sym){
      /* 매핑 1:1 이라 증상당 상분류 1곳 (코막힘=호흡기). 남/여 합이 진료과 건수와 일치 (2026-06-14).
         자유기입(catId 보유)은 그 대분류로 고정, 아니면 키워드 추측(이관 데이터 포함). (2026-06-17) */
      const _fd=_dashFreeDept(_ftm,sym);
      const dks=_fd?[_fd]:_ddGuessDepts(sym);
      dks.forEach(function(dk){
        if(!_deptMale.hasOwnProperty(dk))return;
        if(g==='남')_deptMale[dk]++;
        else if(g==='여')_deptFemale[dk]++;
        else _deptUnknown[dk]++;
      });
    });
  });
  /* 컨테이너 높이를 barH + 라벨/여백(22px) 만큼 확보해 막대 위 숫자가 사각형 밖으로 삐져나가지 않게.
     실제 막대 max 는 (barH-22) 로 제한되어 raw barH 영역만 사용. */
  const _barAreaH=barH;
  const _barMaxH=Math.max(20,barH-22);
  h+='<div style="display:flex;gap:4px;align-items:flex-end;height:'+(_barAreaH+4)+'px;padding:18px 4px 0 4px;margin-bottom:6px;overflow:hidden">';
  sorted.forEach(function(dk,i){
    const cnt=counts[dk]||0;
    /* 안전 클램프 — 만일에라도 male+female+unknown 이 cnt 를 초과하면 비례 축소해 막대가 영역을 뚫지 않도록 */
    let mCnt=_deptMale[dk]||0, fCnt=_deptFemale[dk]||0, uCnt=_deptUnknown[dk]||0;
    const _gSum=mCnt+fCnt+uCnt;
    if(cnt>0&&_gSum>cnt){
      const k=cnt/_gSum;
      mCnt=Math.round(mCnt*k);fCnt=Math.round(fCnt*k);uCnt=Math.max(0,cnt-mCnt-fCnt);
    }
    const col=_dashDeptColors[i%_dashDeptColors.length];
    const totalH=_noData?0:(maxV>0?Math.max(cnt>0?4:0,Math.round(cnt/maxV*_barMaxH)):0);
    const mH=cnt>0?Math.round(mCnt/cnt*totalH):0;
    const fH=cnt>0?Math.round(fCnt/cnt*totalH):0;
    const uH=Math.max(0,totalH-mH-fH);
    const tipId='deptTip_'+i;
    /* 팝업(~96px) + 숫자라벨(~16px) + 막대높이가 barH+여유를 넘으면 우측 표시 */
    const _tipOverflow=(totalH+96)>_barAreaH;
    const _tipPos=_tipOverflow
      ?'left:calc(100% + 6px);top:0;transform:none'
      :'bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:6px';
    h+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0;position:relative;cursor:default" data-tip="'+tipId+'">';
    h+='<div id="'+tipId+'" style="display:none;position:absolute;'+_tipPos+';background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;z-index:10;font-size:10px;line-height:1.6;pointer-events:none">';
    h+='<div style="font-weight:700;color:var(--t1);margin-bottom:2px">'+escHtml(dk)+'</div>';
    h+='<div style="color:#10B981">남: '+mCnt+'명</div>';
    h+='<div style="color:#38BDF8">여: '+fCnt+'명</div>';
    if(uCnt>0)h+='<div style="color:var(--t3)">성별 미상: '+uCnt+'명</div>';
    h+='<div style="color:var(--t3);font-size:9px;border-top:1px solid var(--bdr);padding-top:2px;margin-top:2px">총 '+cnt+'건</div>';
    h+='</div>';
    if(cnt>0&&!_noData){
      h+='<span style="font-size:10px;margin-bottom:2px;'+_barStroke+'">'+cnt+'</span>';
      h+='<div style="width:70%;min-width:8px;display:flex;flex-direction:column">';
      /* 위→아래: 여(짙음) / 남(옅음) / 미상(회색). 미상은 색상 톤을 죽여서 시각적으로 구분 */
      if(fH>0) h+='<div style="height:'+fH+'px;background:'+col+';border-radius:3px 3px '+((mH+uH)>0?'0 0':'3px 3px')+';opacity:1"></div>';
      if(mH>0) h+='<div style="height:'+mH+'px;background:'+col+';opacity:0.35;border-radius:'+(fH>0?'0 0 ':'3px 3px ')+(uH>0?'0 0':'3px 3px')+'"></div>';
      if(uH>0) h+='<div style="height:'+uH+'px;background:rgba(148,163,184,0.45);border-radius:'+((fH+mH)>0?'0 0 ':'3px 3px ')+'3px 3px"></div>';
      h+='</div>';
    } else {
      h+='<div style="width:70%;min-width:8px;height:4px;background:var(--bdr);border-radius:3px"></div>';
    }
    h+='</div>';
  });
  h+='</div>';
  h+='<div style="display:flex;gap:4px;padding:0 4px">';
  sorted.forEach(function(dk,i){
    const col=_dashDeptColors[i%_dashDeptColors.length];
    h+='<div style="flex:1;text-align:center;min-width:0"><span style="writing-mode:vertical-rl;font-size:10px;color:'+col+';font-weight:700;letter-spacing:0.5px">'+dk.replace('계','')+'</span></div>';
  });
  h+='</div>';
  /* 범례 — 미상 카운트가 있는 진료과가 하나라도 있으면 '성별 미상' 표시 */
  let _hasUnknown=false;deptKeys.forEach(function(dk){if((_deptUnknown[dk]||0)>0)_hasUnknown=true;});
  h+='<div style="display:flex;justify-content:center;gap:12px;margin-top:6px;font-size:10px;color:var(--t3)">';
  h+='<span>■ 여 (짙은색)</span><span>■ 남 (옅은색)</span>';
  if(_hasUnknown)h+='<span><span style="display:inline-block;width:8px;height:8px;background:rgba(148,163,184,0.45);border-radius:1px;vertical-align:middle"></span> 성별 미상</span>';
  h+='</div>';
  h+='</div>'; /* 진료과 끝 */

  /* ══ 학생/교직원 방문 — 진료과 옆 배치 ══ */
  const _maleCol='#10B981', _femaleCol='#38BDF8';
  const _stuFiltered=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';});
  const _staffFiltered=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';});
  const _stuCount=_stuFiltered.length, _staffCount=_staffFiltered.length;
  const _roleData=[{label:_isKinder?'원아':'학생',count:_stuCount,color:'#3B82F6'},{label:'교직원',count:_staffCount,color:'#FACC15'}];
  if(_gradeFullWidth){
    h+='<div style="height:12px"></div>';
  }
  h+='<div id="dashChartRole" style="'+(!_gradeFullWidth?'flex:'+Math.max(7,_gradeBarCount+4)+';min-width:240px;':'')+'border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 14px;position:relative">';
  /* 학생/교직원 도넛 — 진료과 막대 옆에서 비주얼 균형이 맞도록 큼직하게.
     특수학교 등 진료과가 전체 폭을 쓰는 경우(_gradeFullWidth=true)는 더 넉넉히. */
  const _roleSz=_gradeFullWidth?260:230;
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#3B82F6,#FACC15);border-radius:2px"></span>'+(_isKinder?'원아':'학생')+'/교직원 방문 현황<span style="flex:1"></span>'+_copyBtnHtml('dashChartRole','학생/교직원 복사됨')+'</div>';
  /* 호버 툴팁 — 학생·교직원 건수와 비율 */
  const _roleTotal=_stuCount+_staffCount;
  const _stuPct=_roleTotal>0?(_stuCount/_roleTotal*100).toFixed(1):'0';
  const _staffPct=_roleTotal>0?(_staffCount/_roleTotal*100).toFixed(1):'0';
  window['_roleTip']='<b>'+(_isKinder?'원아':'학생')+'/교직원 방문</b> &nbsp; 총 '+_roleTotal+'건<br>'
    +'<span style="color:#3B82F6">'+(_isKinder?'원아':'학생')+': '+_stuCount+'건 ('+_stuPct+'%)</span> &nbsp; '
    +'<span style="color:#FACC15">교직원: '+_staffCount+'건 ('+_staffPct+'%)</span>';
  h+='<div style="display:flex;flex-direction:column;align-items:center;gap:6px;max-width:100%;cursor:default" data-tooltip-key="_roleTip">';
  h+=_donutSvg(_roleData,_roleSz);
  h+=_donutLegendInline(_roleData);
  h+='</div>';
  h+='</div>'; /* dashChartRole 끝 */
  if(!_gradeFullWidth) h+='</div>'; /* flex row 끝 */
  h+='<div style="height:12px"></div>';

  /* ══ 도넛 헬퍼 ══ */
  function _donutSvg(data,sz,centerOverride){
    const pad=0;
    const r=sz/2, cr=r*0.62, ir=r*0.38, midR=(cr+ir)/2, sw=cr-ir;
    let total=0;data.forEach(function(d){total+=d.count;});
    const svgH=sz+pad;
    let svg='<svg width="'+sz+'" height="'+svgH+'" viewBox="0 0 '+sz+' '+svgH+'">';
    const cy=r+pad;
    svg+='<circle cx="'+r+'" cy="'+cy+'" r="'+midR+'" fill="none" stroke="var(--bdr)" stroke-width="'+sw+'" opacity="0.2"/>';
    if(total>0){
      let cumAngle=-90;
      data.forEach(function(d){
        if(d.count===0)return;
        const angle=d.count/total*360;
        const startRad=cumAngle*Math.PI/180;const endRad=(cumAngle+angle)*Math.PI/180;
        const x1=r+midR*Math.cos(startRad), y1=cy+midR*Math.sin(startRad);
        const x2=r+midR*Math.cos(endRad), y2=cy+midR*Math.sin(endRad);
        if(angle>=359.99){svg+='<circle cx="'+r+'" cy="'+cy+'" r="'+midR+'" fill="none" stroke="'+d.color+'" stroke-width="'+sw+'"/>';}
        else{svg+='<path d="M'+x1+','+y1+' A'+midR+','+midR+' 0 '+(angle>180?1:0)+' 1 '+x2+','+y2+'" fill="none" stroke="'+d.color+'" stroke-width="'+sw+'" stroke-linecap="butt"/>';}
        cumAngle+=angle;
      });
    }
    const _centerVal=(centerOverride!==undefined)?centerOverride:(total||0);
    const _centerUnit=(centerOverride!==undefined)?'명':'건';
    svg+='<text x="'+r+'" y="'+(cy-1)+'" text-anchor="middle" dominant-baseline="middle" font-size="'+(sz>=130?'16':'12')+'" font-weight="800" fill="var(--t1)" font-family="var(--fm)">'+_centerVal+'</text>';
    svg+='<text x="'+r+'" y="'+(cy+(sz>=120?12:9))+'" text-anchor="middle" dominant-baseline="middle" font-size="'+(sz>=120?'8':'7')+'" fill="var(--t3)" font-family="var(--f)">'+_centerUnit+'</text>';
    svg+='</svg>';
    /* 범례를 SVG 위에 HTML로 출력 (잘림 방지) */
    let topHtml='';
    if(data.length>=2&&total>0){
      topHtml='<div style="display:flex;justify-content:center;gap:8px;margin-bottom:2px">';
      data.forEach(function(d){
        const pct=(d.count/total*100).toFixed(0);
        topHtml+='<span style="font-size:'+(sz>=130?'11':'9')+'px;font-weight:800;color:#fff;-webkit-text-stroke:0.4px #000;paint-order:stroke fill;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;display:flex;align-items:center;gap:3px">';
        topHtml+='<span style="width:8px;height:8px;border-radius:50%;background:'+d.color+';flex-shrink:0"></span>';
        topHtml+=d.count+'('+pct+'%)</span>';
      });
      topHtml+='</div>';
    }
    return topHtml+svg;
  }
  function _donutLegendInline(data){
    let total=0;data.forEach(function(d){total+=d.count;});
    let h2='<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">';
    data.forEach(function(d){
      const pct=total>0?(d.count/total*100).toFixed(1):'0';
      h2+='<span style="font-size:10px;color:var(--t2)"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+d.color+';vertical-align:middle;margin-right:3px"></span>'+d.label+' <b style="color:var(--t1)">'+d.count+'</b> <span style="color:var(--t3)">('+pct+'%)</span></span>';
    });
    h2+='</div>';
    return h2;
  }

  /* ══ 남/여 학생별 분포 (가로 전체) ══ */
  const _genderByGrade=[];
  gradeItems.forEach(function(gi){
    let mCnt=0, fCnt=0, uCnt=0;
    _stuFiltered.forEach(function(r){
      const s=getStu(r.studentId);if(!s)return;
      const g=parseInt(s.grade,10)||0;
      const match=_isSpecial?((s.level||'')===gi.level&&g===gi.grade):(_isMulti?(getLevelShort(s)===gi.level&&g===gi.grade):(g===gi.grade));
      if(match){const _sg=s.gender==='M'?'남':s.gender==='F'?'여':s.gender;if(_sg==='남')mCnt++;else if(_sg==='여')fCnt++;else uCnt++;}
    });
    _genderByGrade.push({item:gi,male:mCnt,female:fCnt,unknown:uCnt});
  });
  let _totalMale=0, _totalFemale=0, _totalUnknown=0;
  _genderByGrade.forEach(function(g){_totalMale+=g.male;_totalFemale+=g.female;_totalUnknown+=(g.unknown||0);});
  const _genderCount=gradeItems.length+1; /* +전체 */
  const _donutSz=Math.max(80,Math.min(150,Math.round(700/_genderCount)));

  h+='<div id="dashChartGender" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative">';
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:12px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,'+_maleCol+','+_femaleCol+');border-radius:2px"></span>'+(_isKinder?'아동 나이별 방문 남/여 분포':'학년별 방문 남/여학생 분포')+'<span style="flex:1"></span>'+_copyBtnHtml('dashChartGender','남/여 분포 복사됨')+'</div>';
  /* 학교급이 여러 개(특수학교 또는 통합학교)면 학교급별 행 분리. 단일 학교급이면 한 행. */
  const _genderMultiLevel=(_isMulti||_isSpecial);
  const _lvNameMap={'유':'유치원','초':'초등학교','중':'중학교','고':'고등학교','대':'대학교/전공과'};
  /* 도넛에 미상 슬라이스 — 합계 = 남+여+미상 보장. 미상은 회색. */
  const _unknownCol='rgba(148,163,184,0.55)';
  function _gbDonutData(gb){
    const arr=[{label:'남',count:gb.male,color:_maleCol},{label:'여',count:gb.female,color:_femaleCol}];
    if((gb.unknown||0)>0)arr.push({label:'미상',count:gb.unknown,color:_unknownCol});
    return arr;
  }
  /* 방문자가 0명인 학년은 도넛에서 제외 — 남+여+미상 합계 0 인 항목 필터 */
  function _gbHasVisits(gb){return (gb.male+gb.female+(gb.unknown||0))>0;}
  /* 학년별 도넛 호버 툴팁 HTML 생성 */
  let _gbTipSeq=0;
  function _gbBuildTip(label,male,female,unknown){
    const tot=male+female+(unknown||0);
    const mPct=tot>0?(male/tot*100).toFixed(1):'0';
    const fPct=tot>0?(female/tot*100).toFixed(1):'0';
    let s='<b>'+escHtml(label)+'</b> &nbsp; 총 '+tot+'건<br>'
      +'<span style="color:'+_maleCol+'">남: '+male+'건 ('+mPct+'%)</span> &nbsp; '
      +'<span style="color:'+_femaleCol+'">여: '+female+'건 ('+fPct+'%)</span>';
    if((unknown||0)>0){
      const uPct=tot>0?(unknown/tot*100).toFixed(1):'0';
      s+=' &nbsp; <span style="color:var(--t3)">미상: '+unknown+'건 ('+uPct+'%)</span>';
    }
    return s;
  }
  function _gbAttachTip(label,male,female,unknown){
    const key='_gbTip_'+(_gbTipSeq++);
    window[key]=_gbBuildTip(label,male,female,unknown);
    return key;
  }
  if(_genderMultiLevel){
    /* 학교급별 그룹핑 */
    const _gbByLv={};const _gbLvOrder=[];
    _genderByGrade.forEach(function(gb){
      const lv=(gb.item&&gb.item.level)||'';
      if(!_gbByLv[lv]){_gbByLv[lv]=[];_gbLvOrder.push(lv);}
      _gbByLv[lv].push(gb);
    });
    _gbLvOrder.forEach(function(lv){
      const fullList=_gbByLv[lv];
      /* 학교급 합계는 모든 학년 포함하여 계산 (방문자 0인 학년도 합계엔 영향 없음) */
      let _lvMale=0, _lvFemale=0, _lvUnknown=0;
      fullList.forEach(function(gb){_lvMale+=gb.male;_lvFemale+=gb.female;_lvUnknown+=(gb.unknown||0);});
      /* 방문자가 있는 학년만 도넛 표시 */
      const list=fullList.filter(_gbHasVisits);
      /* 그 학교급 전체에 방문자가 한 명도 없으면 행 자체를 생략 */
      if(_lvMale+_lvFemale+_lvUnknown===0)return;
      h+='<div style="margin-bottom:14px">';
      h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px;padding-left:2px">'+escHtml(_lvNameMap[lv]||lv||'기타')+'</div>';
      h+='<div style="display:flex;flex-wrap:wrap;justify-content:space-evenly;align-items:flex-start">';
      list.forEach(function(gb){
        const _gbKey=_gbAttachTip(gb.item.label,gb.male,gb.female,gb.unknown||0);
        h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default" data-tooltip-key="'+_gbKey+'">';
        h+=_donutSvg(_gbDonutData(gb),_donutSz);
        h+='<span style="font-size:10px;color:var(--t2);font-weight:600">'+gb.item.label+'</span>';
        h+='</div>';
      });
      /* 학교급 합계 도넛 */
      const _lvTotalArr=[{label:'남',count:_lvMale,color:_maleCol},{label:'여',count:_lvFemale,color:_femaleCol}];
      if(_lvUnknown>0)_lvTotalArr.push({label:'미상',count:_lvUnknown,color:_unknownCol});
      const _lvLabel=(_lvNameMap[lv]||lv||'기타')+' 합계';
      const _lvKey=_gbAttachTip(_lvLabel,_lvMale,_lvFemale,_lvUnknown);
      h+='<div style="display:flex;align-items:center;align-self:center;color:var(--t3);font-size:16px;margin:0 4px">▶</div>';
      h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default" data-tooltip-key="'+_lvKey+'">';
      h+=_donutSvg(_lvTotalArr,_donutSz);
      h+='<span style="font-size:10px;color:var(--cyan);font-weight:700">'+escHtml(_lvNameMap[lv]||lv||'기타')+' 합계</span>';
      h+='</div>';
      h+='</div>';
      h+='</div>';
    });
    /* 전체 합계 행 — 가운데 정렬 + 큰 도넛 */
    const _totalData=[{label:'남',count:_totalMale,color:_maleCol},{label:'여',count:_totalFemale,color:_femaleCol}];
    if(_totalUnknown>0)_totalData.push({label:'미상',count:_totalUnknown,color:_unknownCol});
    const _bigDonutSz=Math.round(_donutSz*1.4);
    const _totalKey=_gbAttachTip('전체 합계',_totalMale,_totalFemale,_totalUnknown);
    h+='<div style="display:flex;justify-content:center;align-items:center;border-top:1px dashed var(--bdrl);padding-top:14px;margin-top:6px;gap:10px">';
    h+='<span style="font-size:12px;font-weight:700;color:var(--t2)">전체 합계</span>';
    h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default" data-tooltip-key="'+_totalKey+'">';
    h+=_donutSvg(_totalData,_bigDonutSz);
    h+='<span style="font-size:11px;color:var(--cyan);font-weight:700">전체</span>';
    h+='</div>';
    h+='</div>';
  } else {
    /* 학년 도넛 — 가로 정렬 (전체 합계는 별도 하단 행에 분리 표시).
       방문자가 0인 학년은 도넛에서 제외. */
    h+='<div style="display:flex;flex-wrap:wrap;justify-content:space-evenly;align-items:flex-start">';
    _genderByGrade.filter(_gbHasVisits).forEach(function(gb){
      const _gbKey=_gbAttachTip(gb.item.label,gb.male,gb.female,gb.unknown||0);
      h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default" data-tooltip-key="'+_gbKey+'">';
      h+=_donutSvg(_gbDonutData(gb),_donutSz);
      h+='<span style="font-size:10px;color:var(--t2);font-weight:600">'+gb.item.label+'</span>';
      h+='</div>';
    });
    h+='</div>';
    /* 전체 합계 행 — 가운데 정렬 + 1.4배 크기 도넛 */
    const _totalData=[{label:'남',count:_totalMale,color:_maleCol},{label:'여',count:_totalFemale,color:_femaleCol}];
    if(_totalUnknown>0)_totalData.push({label:'미상',count:_totalUnknown,color:_unknownCol});
    const _bigDonutSz=Math.round(_donutSz*1.4);
    const _totalKey=_gbAttachTip('전체 합계',_totalMale,_totalFemale,_totalUnknown);
    h+='<div style="display:flex;justify-content:center;align-items:center;border-top:1px dashed var(--bdrl);padding-top:14px;margin-top:10px;gap:10px">';
    h+='<span style="font-size:12px;font-weight:700;color:var(--t2)">전체 합계</span>';
    h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default" data-tooltip-key="'+_totalKey+'">';
    h+=_donutSvg(_totalData,_bigDonutSz);
    h+='<span style="font-size:11px;color:var(--cyan);font-weight:700">전체</span>';
    h+='</div>';
    h+='</div>';
  }
  const _legendArr=[{label:'남학생',count:_totalMale,color:_maleCol},{label:'여학생',count:_totalFemale,color:_femaleCol}];
  if(_totalUnknown>0)_legendArr.push({label:'성별 미상',count:_totalUnknown,color:_unknownCol});
  h+='<div style="margin-top:10px">'+_donutLegendInline(_legendArr)+'</div>';
  h+='</div>';
  h+='<div style="height:12px"></div>';

  /* ══ 반별 남/여 방문 현황 (남녀 도넛) ══ */
  const _deptAbbr=S.settings.majorAbbrev||{};
  function _clsLabel(s){
    if(!s)return '';
    const g=s.grade, c=s.cls;
    /* 엑셀 업로드 시 사용자가 이미 "기린반"·"1반"처럼 '반'을 포함해 입력한 경우 중복 방지.
       숫자나 '반' 없는 텍스트만 들어오면 자동으로 '반'을 붙여 라벨링한다. */
    function _normCls(v){
      if(v==null||v==='')return '';
      const sv=String(v).trim();
      return /반\s*$/.test(sv)?sv:(sv+'반');
    }
    if(_isKinder)return '만'+g+'세';
    if(_isSpecial){
      const lv=s.level||'';
      return lv+' '+g+'학년 '+_normCls(c);
    }
    if(_isMulti){
      const lv=getLevelShort(s);
      const unit=(lv==='유'?'세':'학년');
      return lv+' '+g+unit+' '+_normCls(c);
    }
    if(s.department){
      const ab=_deptAbbr[s.department]||(s.department.substring(0,2));
      return ab+' '+g+'학년 '+_normCls(c);
    }
    return g+'학년 '+_normCls(c);
  }
  /* 미니팝업용 풀 라벨 — 학과는 축약 없이 전체, 학교급 여러 개면 학교급 포함 (사용자 요청 2026-06-11) */
  function _clsFullLabel(s){
    if(!s)return '';
    const g=s.grade, c=s.cls;
    function _normCls(v){ if(v==null||v==='')return ''; const sv=String(v).trim(); return /반\s*$/.test(sv)?sv:(sv+'반'); }
    if(_isKinder)return '만'+g+'세';
    if(_isSpecial)return (s.level||'')+' '+g+'학년 '+_normCls(c);
    let p='';
    if(_isMulti)p+=getLevelShort(s)+' ';
    if(s.department)p+=String(s.department).trim()+' ';
    const unit=(_isMulti&&getLevelShort(s)==='유')?'세':'학년';
    return p+g+unit+' '+_normCls(c);
  }
  const _clsCount={};const _clsLabelMap={};const _clsFullLabelMap={};
  filtered.forEach(function(r){
    const s=getStu(r.studentId);if(!s||s.type==='staff')return;
    const g=s.grade, c=s.cls;if(!g)return;
    const key=_isSpecial?((s.level||'')+'_'+g+'_'+c):(_isMulti?(getLevelShort(s)+'_'+g+'_'+c):(s.department?(s.department+'_'+g+'_'+c):(g+'_'+c)));
    _clsCount[key]=(_clsCount[key]||0)+1;
    if(!_clsLabelMap[key])_clsLabelMap[key]=_clsLabel(s);
    if(!_clsFullLabelMap[key])_clsFullLabelMap[key]=_clsFullLabel(s);
  });
  const _allCls={};S.people.forEach(function(s){
    if(s.type!=='student'||!s.grade)return;
    const key=_isSpecial?((s.level||'')+'_'+s.grade+'_'+s.cls):(_isMulti?(getLevelShort(s)+'_'+s.grade+'_'+s.cls):(s.department?(s.department+'_'+s.grade+'_'+s.cls):(s.grade+'_'+s.cls)));
    _allCls[key]=true;
  });
  const _totalCls=Object.keys(_allCls).length;
  const _clsTopN=_totalCls>30?10:(_totalCls>10?5:3);
  const _clsSorted=Object.entries(_clsCount).sort(function(a,b){return b[1]-a[1];}).slice(0,_clsTopN);
  const _clsMax=_clsSorted.length?_clsSorted[0][1]:1;

  const _clsGender={};
  filtered.forEach(function(r){
    const s=getStu(r.studentId);if(!s||s.type==='staff')return;
    const g=s.grade, c=s.cls;if(!g)return;
    const key=_isSpecial?((s.level||'')+'_'+g+'_'+c):(_isMulti?(getLevelShort(s)+'_'+g+'_'+c):(s.department?(s.department+'_'+g+'_'+c):(g+'_'+c)));
    if(!_clsGender[key]){
      let _lvKey='';
      if(_isSpecial) _lvKey=s.level||'';
      else if(_isMulti) _lvKey=getLevelShort(s);
      _clsGender[key]={label:_clsLabel(s),m:0,f:0,u:0,total:0,_lv:_lvKey};
    }
    _clsGender[key].total++;
    const _cg=s.gender==='M'?'남':s.gender==='F'?'여':s.gender;
    if(_cg==='남')_clsGender[key].m++;
    else if(_cg==='여')_clsGender[key].f++;
    else _clsGender[key].u++;
  });
  const _clsGenderSorted=Object.entries(_clsGender).sort(function(a,b){
    const ka=a[0].split('_'), kb=b[0].split('_');
    const ga=parseInt(ka[ka.length-2])||0, ca=parseInt(ka[ka.length-1])||0;
    const gb=parseInt(kb[kb.length-2])||0, cb=parseInt(kb[kb.length-1])||0;
    if(ka.length>2 && kb.length>2 && ka[0]!==kb[0]) return ka[0]<kb[0]?-1:1;
    return ga-gb || ca-cb;
  }).map(function(e){return e[1];});
  const _clsDonutSz=92; /* 10개/행을 위해 축소 (이전 110). 컨테이너 ~1000px 기준 */
  const _clsMultiLevel=(_isMulti||_isSpecial);

  h+='<div id="dashChartClsGender" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:18px 16px 16px;position:relative">';
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#10B981,#38BDF8);border-radius:2px"></span>'+(_isKinder?'아동 나이 - 반별 방문 남/여학생 분포':'반별 방문 남/여학생 분포')+'<span style="flex:1"></span>'+_copyBtnHtml('dashChartClsGender','남/여 분포 복사됨')+'</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px">(1학년 1반부터 순서대로 정렬됩니다.)</div>';
  /* 학교급이 여러 개면 학교급별 행 분리. 단일 학교급이면 한 행.
     ── grid 10열 고정. 11개 이상이면 자동으로 다음 줄로 wrap (가로 스크롤 제거). */
  let _cgTipSeq=0;
  function _renderClsGenderRow(list){
    let row='';
    row+='<div style="display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:14px 6px;width:100%;align-items:start;justify-items:center">';
    list.forEach(function(cg){
      const data=[{label:'남',count:cg.m,color:'#10B981'},{label:'여',count:cg.f,color:'#38BDF8'}];
      if((cg.u||0)>0)data.push({label:'미상',count:cg.u,color:'rgba(148,163,184,0.55)'});
      /* 호버 툴팁 — 반 라벨 + 남/여/미상 건수와 비율 */
      const _cgTot=cg.m+cg.f+(cg.u||0);
      const _mP=_cgTot>0?(cg.m/_cgTot*100).toFixed(1):'0';
      const _fP=_cgTot>0?(cg.f/_cgTot*100).toFixed(1):'0';
      let _cgTipHtml='<b>'+escHtml(cg.label)+'</b> &nbsp; 총 '+_cgTot+'건<br>'
        +'<span style="color:#10B981">남: '+cg.m+'건 ('+_mP+'%)</span> &nbsp; '
        +'<span style="color:#38BDF8">여: '+cg.f+'건 ('+_fP+'%)</span>';
      if((cg.u||0)>0){
        const _uP=_cgTot>0?(cg.u/_cgTot*100).toFixed(1):'0';
        _cgTipHtml+=' &nbsp; <span style="color:var(--t3)">미상: '+cg.u+'건 ('+_uP+'%)</span>';
      }
      const _cgKey='_cgTip_'+(_cgTipSeq++);
      window[_cgKey]=_cgTipHtml;
      row+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;max-width:100%;cursor:default" data-tooltip-key="'+_cgKey+'">';
      row+=_donutSvg(data,_clsDonutSz);
      row+='<span style="font-size:9px;color:var(--t2);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">'+cg.label+'</span>';
      row+='</div>';
    });
    row+='</div>';
    return row;
  }
  if(_clsMultiLevel){
    /* 학교급별 그룹핑 — 행마다 학교급 라벨 + 도넛 행 */
    const _cgByLv={};const _cgLvOrder=[];
    _clsGenderSorted.forEach(function(cg){
      const lv=cg._lv||'';
      if(!_cgByLv[lv]){_cgByLv[lv]=[];_cgLvOrder.push(lv);}
      _cgByLv[lv].push(cg);
    });
    _cgLvOrder.forEach(function(lv){
      h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin:4px 2px 6px">'+escHtml(_lvNameMap[lv]||lv||'기타')+'</div>';
      h+=_renderClsGenderRow(_cgByLv[lv]);
    });
  } else {
    h+=_renderClsGenderRow(_clsGenderSorted);
  }
  /* 반별 도넛 중 미상 카운트가 있으면 범례에도 노출 */
  let _clsHasUnknown=false;_clsGenderSorted.forEach(function(cg){if((cg.u||0)>0)_clsHasUnknown=true;});
  h+='<div class="cls-gender-legend" style="margin-top:8px;display:flex;gap:12px;justify-content:center;font-size:10px;width:100%;text-align:center">';
  h+='<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#10B981"></span><span style="color:var(--t2)">남학생</span></span>';
  h+='<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#38BDF8"></span><span style="color:var(--t2)">여학생</span></span>';
  if(_clsHasUnknown)h+='<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:rgba(148,163,184,0.55)"></span><span style="color:var(--t2)">성별 미상</span></span>';
  h+='</div>';
  h+='</div>';
  h+='<div style="height:12px"></div>';

  /* ══ 시간대별 방문 분포 (히트맵) ══ */
  const _htSlots=JSON.parse(localStorage.getItem('dash_hourly_slots')||'null')||[
    {from:'08:30',to:'09:30'},{from:'09:30',to:'10:30'},{from:'10:30',to:'11:30'},
    {from:'11:30',to:'12:30'},{from:'12:30',to:'13:30'},{from:'13:30',to:'14:30'},
    {from:'14:30',to:'15:30'},{from:'15:30',to:'16:30'}
  ];
  function _htMinutes(t){const p=t.split(':');return(parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0);}
  /* "YYYY-MM-DD" 문자열을 시간대 영향 없이 로컬 Date 로 파싱 (new Date(str) 은 UTC 파싱하여 KST 와 9h 차이로 요일 어긋남 가능) */
  function _htParseLocal(s){
    if(!s)return null;
    const m=String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(!m)return null;
    return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
  }
  const _htByDow={'월':{},'화':{},'수':{},'목':{},'금':{}};
  const _htTotal={};_htSlots.forEach(function(s,i){_htTotal[i]=0;});
  const _htDowNames=['일','월','화','수','목','금','토'];
  /* 오늘 탭: 선택된 날짜 하루만 표시 (해당 요일 행만 노출) — 헤더 통계와 일치
     주간/월간/학기/연도 등은 filtered (해당 기간 전체) 사용. */
  let _htRecords=filtered;
  let _htTodayDow=null; /* 'today' 모드에서 표시할 단일 요일 ('월','화',...) */
  if(S.statsPeriod==='today'){
    const _htSel=S.selectedDate||toDateStr(new Date());
    const _htD=_htParseLocal(_htSel)||new Date();
    _htTodayDow=_htDowNames[_htD.getDay()];
    _htRecords=S.records.filter(function(r){return r.date===_htSel;});
  }
  const _htGenderMap={};/* 'dow_slotIdx' → {m,f} */
  const _htStudentMap={};/* 'dow_slotIdx' → [info,...] */
  _htRecords.forEach(function(r){
    if(!r.timeIn)return;
    const mins=_htMinutes(r.timeIn);
    const _htRecDate=_htParseLocal(r.date)||new Date(r.date);
    const dow=_htDowNames[_htRecDate.getDay()];
    if(!_htByDow[dow])return;
    const g=_genderOf(r);const info=_stuInfoOf(r);
    _htSlots.forEach(function(s,i){
      if(mins>=_htMinutes(s.from)&&mins<_htMinutes(s.to)){
        _htByDow[dow][i]=(_htByDow[dow][i]||0)+1;
        _htTotal[i]++;
        const gk=dow+'_'+i;if(!_htGenderMap[gk])_htGenderMap[gk]={m:0,f:0};
        if(g==='남')_htGenderMap[gk].m++;else if(g==='여')_htGenderMap[gk].f++;
        if(S.statsPeriod==='today'){if(!_htStudentMap[gk])_htStudentMap[gk]=[];_htStudentMap[gk].push(info);}
      }
    });
  });
  let _htMax=1;Object.keys(_htByDow).forEach(function(d){_htSlots.forEach(function(s,i){const v=_htByDow[d][i]||0;if(v>_htMax)_htMax=v;});});
  let _htGrand=0;Object.values(_htTotal).forEach(function(v){_htGrand+=v;});
  const _hmPalette=['#E8F5E9','#C8E6C9','#A5D6A7','#81C784','#66BB6A','#4CAF50','#43A047','#388E3C','#2E7D32','#256F2B','#1B5E20','#145218','#0E4510','#083808','#042B04'];
  function _htColor(val){
    if(val===0)return 'rgba(148,163,184,0.12)';
    const idx=Math.min(14,Math.round(val/_htMax*14));
    return _hmPalette[idx];
  }
  const _htCellH=32;

  h+='<div id="dashChartHourly" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 16px 14px;position:relative">';
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:14px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#A5D6A7,#1B5E20);border-radius:2px"></span>시간대별 방문 분포<span style="font-size:10px;color:var(--t3);font-weight:500">(총 '+_htGrand+'건)</span><span style="flex:1"></span>';
  /* 톱니바퀴 설정 버튼 */
  h+='<button data-action="hourly-settings" title="시간대 설정" class="dash-copy-btn" style="background:none;border:none;cursor:pointer;padding:3px;opacity:0.35;transition:opacity 0.2s;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>';
  h+=_copyBtnHtml('dashChartHourly','시간대별 분포 복사됨')+'</div>';
  /* 히트맵 그리드 — 'today' 모드는 오늘 요일 한 행만, 그 외에는 월~금 5행 */
  const _htRowDays = (S.statsPeriod==='today' && _htTodayDow && ['월','화','수','목','금'].indexOf(_htTodayDow)!==-1)
    ? [_htTodayDow]
    : ['월','화','수','목','금'];
  h+='<div style="display:flex;gap:0;overflow:visible">';
  h+='<div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">';
  h+='<div style="height:'+_htCellH+'px;width:36px"></div>';
  _htRowDays.forEach(function(d){
    h+='<div style="height:'+_htCellH+'px;width:36px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--t2)">'+d+'</div>';
  });
  h+='<div style="height:'+_htCellH+'px;width:36px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--cyan)">계</div>';
  h+='</div>';
  _htSlots.forEach(function(slot,si){
    h+='<div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:60px">';
    h+='<div style="height:'+_htCellH+'px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2"><span style="font-size:9px;font-weight:600;color:var(--t2)">'+slot.from+'</span><span style="font-size:7px;color:var(--t3)">~'+slot.to+'</span></div>';
    _htRowDays.forEach(function(d,di){
      const v=(_htByDow[d]&&_htByDow[d][si])||0;
      const bg=_htColor(v);
      const _htStroke='color:#fff;font-weight:800;-webkit-text-stroke:0.5px #000;paint-order:stroke fill;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000';
      const htTipId='htTip_'+si+'_'+di;
      const htGd=_htGenderMap[d+'_'+si]||{m:0,f:0};
      const htStu=_htStudentMap[d+'_'+si]||[];
      let _htTipHtml3='';
      if(v>0){
        _htTipHtml3='<b>'+d+' '+slot.from+'~'+slot.to+'</b> &nbsp; <span style="color:#10B981">남:'+htGd.m+'</span> <span style="color:#38BDF8">여:'+htGd.f+'</span>';
        if(htStu.length)_htTipHtml3+='<br>'+htStu.slice(0,15).map(function(s){return escHtml(s);}).join(' &nbsp; ')+(htStu.length>15?' <span style="color:var(--t3)">외 '+(htStu.length-15)+'명</span>':'');
        window['_htTip_'+si+'_'+di]=_htTipHtml3;
      }
      h+='<div style="height:'+_htCellH+'px;background:'+bg+';border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:var(--fm);transition:background 0.3s;cursor:default;'+(v>0?_htStroke:'color:var(--t3);font-weight:600')+'"'+(v>0?' data-tooltip-key="_htTip_'+si+'_'+di+'"':'')+'>'+v+'</div>';
    });
    h+='<div style="height:'+_htCellH+'px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--cyan);font-family:var(--fm)">'+(_htTotal[si]||0)+'</div>';
    h+='</div>';
  });
  h+='</div>';
  h+='<div style="display:flex;align-items:center;gap:3px;margin-top:10px;justify-content:flex-end">';
  h+='<div style="width:12px;height:10px;border-radius:2px;background:rgba(148,163,184,0.12);border:1px solid var(--bdr)"></div>';
  h+='<span style="font-size:9px;color:var(--t3);margin-right:4px">0</span>';
  h+='<span style="font-size:9px;color:var(--t3)">적음</span>';
  _hmPalette.forEach(function(c){h+='<div style="width:8px;height:10px;border-radius:1px;background:'+c+'"></div>';});
  h+='<span style="font-size:9px;color:var(--t3)">많음</span>';
  h+='</div>';
  h+='</div>';
  h+='<div style="height:12px"></div>';

  /* ══ 학급별 건강 히트맵 ══ */
  const _hmClsData={};let _hmGrades=[];const _hmClasses={};
  const _hmGenderCls={};/* 'gKey_c' → {m,f,u} — u: 성별 미상 */
  const _hmStudentCls={};/* 'gKey_c' → [info,...] */
  const _hmStroke='color:#fff;font-weight:800;-webkit-text-stroke:0.5px #000;paint-order:stroke fill;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000';
  filtered.forEach(function(r){
    const s=getStu(r.studentId);if(!s||s.type==='staff')return;
    const g=parseInt(s.grade,10)||0;if(!g)return;
    const c=parseInt(s.cls,10)||0;if(!c)return;
    const gKey=_isSpecial?((s.level||'')+'_'+g):(_isMulti?(getLevelShort(s)+'_'+g):(s.department?(s.department+'_'+g):(''+g)));
    /* 학과는 5글자까지 + '학년' 표기, 학과 없으면 'N학년' (사용자 요청 2026-06-11. 예: 항공정비과 1학년) */
    const gLabel=_isSpecial?((s.level||'')+g+'학년'):(_isKinder?('만'+g+'세'):(_isMulti?(getLevelShort(s)+g+(getLevelShort(s)==='유'?'세':'학년')):(s.department?(((S.settings.majorAbbrev||{})[s.department]||s.department.substring(0,5))+' '+g+'학년'):(g+'학년'))));
    /* 풀 라벨 — 학과 전체(축약 없음). 핀비즈 미니팝업·넓은 셀 표기에 사용 (사용자 요청 2026-06-11) */
    const gFull=_isSpecial?((s.level||'')+g+'학년'):(_isKinder?('만'+g+'세'):(_isMulti?(getLevelShort(s)+g+(getLevelShort(s)==='유'?'세':'학년')):(s.department?(String(s.department).trim()+' '+g+'학년'):(g+'학년'))));
    /* 핀비즈 반응형 축약용 — 과명(있을 때)과 꼬리(학년)를 분리 보관 */
    const gDept=(!_isSpecial&&!_isKinder&&!_isMulti&&s.department)?String(s.department).trim():'';
    const gTail=gDept?(g+'학년'):gFull;
    if(!_hmClsData[gKey])_hmClsData[gKey]={};
    _hmClsData[gKey][c]=(_hmClsData[gKey][c]||0)+1;
    if(!_hmClasses[gKey]){_hmClasses[gKey]=new Set();_hmGrades.push({key:gKey,label:gLabel,fullLabel:gFull,dept:gDept,tail:gTail,grade:g});}
    _hmClasses[gKey].add(c);
    /* 성별 + 학생명 집계 */
    const _hmCk=gKey+'_'+c;
    if(!_hmGenderCls[_hmCk])_hmGenderCls[_hmCk]={m:0,f:0,u:0};
    let sg=s.gender;if(sg==='M')sg='남';else if(sg==='F')sg='여';
    if(sg==='남')_hmGenderCls[_hmCk].m++;else if(sg==='여')_hmGenderCls[_hmCk].f++;else _hmGenderCls[_hmCk].u++;
    if(S.statsPeriod==='today'){if(!_hmStudentCls[_hmCk])_hmStudentCls[_hmCk]=[];_hmStudentCls[_hmCk].push(_stuInfoOf(r));}
  });
  S.people.forEach(function(s){
    if(s.type!=='student'||!s.grade)return;
    const g=parseInt(s.grade,10)||0, c=parseInt(s.cls,10)||0;if(!g||!c)return;
    const gKey=_isSpecial?((s.level||'')+'_'+g):(_isMulti?(getLevelShort(s)+'_'+g):(s.department?(s.department+'_'+g):(''+g)));
    /* 학과는 5글자까지 + '학년' 표기, 학과 없으면 'N학년' (사용자 요청 2026-06-11. 예: 항공정비과 1학년) */
    const gLabel=_isSpecial?((s.level||'')+g+'학년'):(_isKinder?('만'+g+'세'):(_isMulti?(getLevelShort(s)+g+(getLevelShort(s)==='유'?'세':'학년')):(s.department?(((S.settings.majorAbbrev||{})[s.department]||s.department.substring(0,5))+' '+g+'학년'):(g+'학년'))));
    const gFull=_isSpecial?((s.level||'')+g+'학년'):(_isKinder?('만'+g+'세'):(_isMulti?(getLevelShort(s)+g+(getLevelShort(s)==='유'?'세':'학년')):(s.department?(String(s.department).trim()+' '+g+'학년'):(g+'학년'))));
    const gDept=(!_isSpecial&&!_isKinder&&!_isMulti&&s.department)?String(s.department).trim():'';
    const gTail=gDept?(g+'학년'):gFull;
    if(!_hmClsData[gKey])_hmClsData[gKey]={};
    if(!_hmClsData[gKey][c])_hmClsData[gKey][c]=0;
    if(!_hmClasses[gKey]){_hmClasses[gKey]=new Set();_hmGrades.push({key:gKey,label:gLabel,fullLabel:gFull,dept:gDept,tail:gTail,grade:g});}
    _hmClasses[gKey].add(c);
  });
  _hmGrades.sort(function(a,b){return a.grade-b.grade;});
  const _hmGradesSeen={};_hmGrades=_hmGrades.filter(function(g){if(_hmGradesSeen[g.key])return false;_hmGradesSeen[g.key]=true;return true;});
  let _hmClsMax=1;
  _hmGrades.forEach(function(g){Object.values(_hmClsData[g.key]||{}).forEach(function(v){if(v>_hmClsMax)_hmClsMax=v;});});
  let _maxClsNum=0;_hmGrades.forEach(function(g){if(_hmClasses[g.key])_hmClasses[g.key].forEach(function(c){if(c>_maxClsNum)_maxClsNum=c;});});
  const _hmClsList=[];for(let ci=1;ci<=_maxClsNum;ci++)_hmClsList.push(ci);
  const _hmGreenPalette=['#E8F5E9','#C8E6C9','#A5D6A7','#81C784','#66BB6A','#4CAF50','#43A047','#388E3C','#2E7D32','#256F2B','#1B5E20','#145218','#0E4510','#083808','#042B04'];
  const _hmRedPalette=['#FFEBEE','#FFCDD2','#EF9A9A','#E57373','#EF5350','#F44336','#E53935','#D32F2F','#C62828','#B71C1C','#A51414','#8E0E0E','#780808','#620404','#4E0000'];
  let _hmClsMaxDiff=1;
  function _hmClsColor(val,prevVal){
    /* 0명 셀은 Finviz 스타일이건 표 스타일이건 무조건 회색 처리 (이전 값과의 diff 무관).
       이전 로직: prev=5, val=0 이면 diff=-5 → 빨강 팔레트로 그려졌음.
       사용자 요청: 오늘 방문자 0명이면 회색으로 보이게. */
    if(val===0) return 'rgba(148,163,184,0.12)';
    const diff=val-(prevVal||0);
    if(diff===0)return 'rgba(148,163,184,0.25)';
    const intensity=Math.abs(diff)/_hmClsMaxDiff;
    const idx=Math.min(14,Math.round(intensity*14));
    return diff>0?_hmGreenPalette[idx]:_hmRedPalette[idx];
  }
  if(_hmGrades.length&&_hmClsList.length){
    /* 전기 대비 데이터 계산 (Finviz 모드용) */
    const _hmPrevData={};
    let _hmPrevRecords=[];
    let _fvPeriodLabel='전기';
    if(S.statsPeriod==='today'){
      /* 전일 대비 */
      _fvPeriodLabel='전일';
      const _hmSel=S.selectedDate||toDateStr(new Date());
      const _hmPrevD=new Date(_hmSel);_hmPrevD.setDate(_hmPrevD.getDate()-1);
      while(_hmPrevD.getDay()===0||_hmPrevD.getDay()===6)_hmPrevD.setDate(_hmPrevD.getDate()-1);
      const _hmPrevS=toDateStr(_hmPrevD);
      _hmPrevRecords=S.records.filter(function(r){return r.date===_hmPrevS;});
    } else if(S.statsPeriod==='week'){
      /* 전주 대비 */
      _fvPeriodLabel='전주';
      const _hmWkSel=S.selectedDate||toDateStr(new Date());
      const _hmWkD=new Date(_hmWkSel);
      const _hmWkStart=new Date(_hmWkD);_hmWkStart.setDate(_hmWkD.getDate()-_hmWkD.getDay()+1-7);
      const _hmWkEnd=new Date(_hmWkStart);_hmWkEnd.setDate(_hmWkStart.getDate()+4);
      _hmPrevRecords=S.records.filter(function(r){return r.date>=toDateStr(_hmWkStart)&&r.date<=toDateStr(_hmWkEnd);});
    } else if(S.statsPeriod==='month'){
      /* 전월 대비 */
      _fvPeriodLabel='전월';
      const _hmMSel=S.selectedDate||toDateStr(new Date());
      const _hmMD=new Date(_hmMSel);
      const _hmPM=new Date(_hmMD.getFullYear(),_hmMD.getMonth()-1,1);
      const _hmPME=new Date(_hmMD.getFullYear(),_hmMD.getMonth(),0);
      _hmPrevRecords=S.records.filter(function(r){return r.date>=toDateStr(_hmPM)&&r.date<=toDateStr(_hmPME);});
    } else if(S.statsPeriod==='semester'){
      /* 전 학기 대비 */
      _fvPeriodLabel='전학기';
      const _hmSemSub=_dashGetSubTabs()[S._dashSubIdx]||{};
      const _hmSemYear=_hmSemSub.year||new Date().getFullYear();
      const _hmSemHalf=_hmSemSub.half||1;
      let _hmPSY, _hmPSH, _hmPSStart, _hmPSEnd;
      if(_hmSemHalf===1){_hmPSY=_hmSemYear-1;_hmPSH=2;_hmPSStart=_hmPSY+'-09-01';_hmPSEnd=_hmPSY+'-12-31';}
      else{_hmPSY=_hmSemYear;_hmPSH=1;_hmPSStart=_hmPSY+'-03-01';_hmPSEnd=_hmPSY+'-07-31';}
      _hmPrevRecords=S.records.filter(function(r){return r.date>=_hmPSStart&&r.date<=_hmPSEnd;});
    } else if(S.statsPeriod==='year'){
      /* 전년 대비 */
      _fvPeriodLabel='전년';
      const _hmYrSub=_dashGetSubTabs()[S._dashSubIdx]||{};
      const _hmYrYear=_hmYrSub.year||new Date().getFullYear();
      const _hmPYStart=(_hmYrYear-1)+'-03-01';
      const _hmPYEnd=_hmYrYear+'-02-28';
      _hmPrevRecords=S.records.filter(function(r){return r.date>=_hmPYStart&&r.date<=_hmPYEnd;});
    } else {
      _hmPrevRecords=[];
    }
    _hmPrevRecords.forEach(function(r){
      const s=getStu(r.studentId);if(!s||s.type==='staff')return;
      const g=parseInt(s.grade,10)||0, c=parseInt(s.cls,10)||0;if(!g||!c)return;
      const gKey=_isSpecial?((s.level||'')+'_'+g):(_isMulti?(getLevelShort(s)+'_'+g):(s.department?(s.department+'_'+g):(''+g)));
      if(!_hmPrevData[gKey])_hmPrevData[gKey]={};
      _hmPrevData[gKey][c]=(_hmPrevData[gKey][c]||0)+1;
    });

    let _hmFinvizMode=_dashHmFinviz;
    if(_hmFinvizMode===undefined){const _hmSaved=localStorage.getItem('dash_hm_finviz');_hmFinvizMode=_hmSaved===null?true:_hmSaved==='true';_dashHmFinviz=_hmFinvizMode;}
    h+='<div id="dashChartHeatmap" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 16px 14px;position:relative">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#FFB5B5,#9B0000);border-radius:2px"></span>'+(_isKinder?'연령별':'학급별')+' 건강 히트맵<span style="flex:1"></span>';
    /* Finviz 토글 */
    h+='<span style="font-size:9px;color:var(--t3);margin-right:2px">표 스타일</span>';
    h+='<div class="sv-toggle'+(_hmFinvizMode?' on':'')+'" data-action="toggle-finviz" style="transform:scale(0.7);margin:0 -2px"></div>';
    h+='<span style="font-size:9px;color:var(--t3);margin-left:2px">Finviz 스타일</span>';
    h+=_copyBtnHtml('dashChartHeatmap','히트맵 복사됨')+'</div>';

    if(!_hmFinvizMode){
      /* ── 기본 모드: 테이블 히트맵 ── */
      /* maxDiff 계산 */
      _hmGrades.forEach(function(g){const cls=_hmClsData[g.key]||{};const prev=_hmPrevData[g.key]||{};_hmClsList.forEach(function(c){const d=Math.abs((cls[c]||0)-(prev[c]||0));if(d>_hmClsMaxDiff)_hmClsMaxDiff=d;});});
      h+='<div style="font-size:10px;color:var(--t3);margin-bottom:14px">'+_fvPeriodLabel+' 대비 학급별 보건실 방문 증감을 색상으로 표시합니다. (초록=증가, 빨강=감소)</div>';
      h+='<div style="overflow-x:auto">';
      h+='<table style="border-collapse:separate;border-spacing:3px;width:100%">';
      h+='<thead><tr><th style="font-size:10px;color:var(--t3);font-weight:600;padding:4px 8px"></th>';
      _hmClsList.forEach(function(c){h+='<th style="font-size:10px;color:var(--t2);font-weight:700;padding:4px 6px;text-align:center;min-width:42px">'+c+'반</th>';});
      h+='<th style="font-size:10px;color:var(--cyan);font-weight:700;padding:4px 6px;text-align:center">계</th></tr></thead>';
      h+='<tbody>';
      _hmGrades.forEach(function(g){
        const cls=_hmClsData[g.key]||{};const prev=_hmPrevData[g.key]||{};let rowTotal=0;
        h+='<tr><td style="font-size:10px;color:var(--t1);font-weight:700;padding:4px 8px;white-space:nowrap">'+g.label+'</td>';
        _hmClsList.forEach(function(c){
          const v=cls[c]||0;const pv=prev[c]||0;rowTotal+=v;
          const bg=_hmClsColor(v,pv);
          const hasClass=_hmClasses[g.key]&&_hmClasses[g.key].has(c);
          if(!hasClass){
            h+='<td style="padding:0;text-align:center"><div style="width:100%;height:32px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--t3);opacity:0.3">—</div></td>';
          } else {
            const _hmTipId='hmTip_'+g.key+'_'+c;
            const _hmGd=_hmGenderCls[g.key+'_'+c]||{m:0,f:0,u:0};
            const _hmStu=_hmStudentCls[g.key+'_'+c]||[];
            let _hmTipHtml3='<b>'+escHtml(g.label)+' '+c+'반</b> &nbsp; <span style="color:#10B981">남:'+_hmGd.m+'</span> <span style="color:#38BDF8">여:'+_hmGd.f+'</span>'+((_hmGd.u||0)>0?' <span style="color:var(--t3)">미상:'+_hmGd.u+'</span>':'');
            if(_hmStu.length)_hmTipHtml3+='<br>'+_hmStu.slice(0,15).map(function(s){return escHtml(s);}).join(' &nbsp; ')+(_hmStu.length>15?' <span style="color:var(--t3)">외 '+(_hmStu.length-15)+'명</span>':'');
            window['_hmTip_'+g.key+'_'+c]=_hmTipHtml3;
            h+='<td style="padding:0;text-align:center"><div style="width:100%;height:32px;background:'+bg+';border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:var(--fm);transition:background 0.3s;cursor:default;'+(v>0?_hmStroke:'color:var(--t3);font-weight:600')+'"'+(v>0?' data-tooltip-key="_hmTip_'+g.key+'_'+c+'"':'')+'>'+v+'</div></td>';
          }
        });
        h+='<td style="padding:0;text-align:center"><div style="height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--cyan);font-family:var(--fm)">'+rowTotal+'</div></td>';
        h+='</tr>';
      });
      h+='</tbody></table></div>';
      h+='<div style="display:flex;align-items:center;gap:3px;margin-top:10px;justify-content:flex-end">';
      h+='<span style="font-size:9px;color:var(--t3)">감소</span>';
      _hmRedPalette.slice().reverse().slice(0,5).forEach(function(c){h+='<div style="width:8px;height:10px;border-radius:1px;background:'+c+'"></div>';});
      h+='<div style="width:12px;height:10px;border-radius:2px;background:rgba(148,163,184,0.25);border:1px solid var(--bdr)"></div>';
      _hmGreenPalette.slice(0,5).forEach(function(c){h+='<div style="width:8px;height:10px;border-radius:1px;background:'+c+'"></div>';});
      h+='<span style="font-size:9px;color:var(--t3)">증가</span>';
      h+='</div>';
    } else {
      /* ── Finviz 트리맵 모드: 전기 대비 증감 ── */
      h+='<div style="font-size:10px;color:var(--t3);margin-bottom:14px">'+_fvPeriodLabel+' 대비 방문자 증감을 크기와 색상으로 표시합니다. (크기=방문자 수, 초록=증가, 빨강=감소)</div>';
      /* 트리맵 데이터 빌드 — 모든 학급 포함 */
      const _fvItems=[];let _fvTotal=0;
      _hmGrades.forEach(function(g){
        const cls=_hmClsData[g.key]||{};const prev=_hmPrevData[g.key]||{};
        _hmClsList.forEach(function(c){
          const hasClass=_hmClasses[g.key]&&_hmClasses[g.key].has(c);
          const allStuInClass=S.people.filter(function(s){return s.type==='student'&&parseInt(s.grade,10)===g.grade&&parseInt(s.cls,10)===c;});
          if(!hasClass&&!allStuInClass.length)return;
          const v=cls[c]||0;const pv=prev[c]||0;
          const diff=v-pv;const pct=pv>0?Math.round((diff/pv)*100):(v>0?100:0);
          const _fvGd=_hmGenderCls[g.key+'_'+c]||_hmGenderCls[String(g.grade)+'_'+c]||{m:0,f:0,u:0};
          let _fvStu=_hmStudentCls[g.key+'_'+c]||[];
          /* 키 불일치 보완: 숫자/문자열 차이 */
          if(!_fvStu.length){let _altKey=g.key+'_'+String(c);_fvStu=_hmStudentCls[_altKey]||[];if(!_fvStu.length){_altKey=String(g.grade)+'_'+c;_fvStu=_hmStudentCls[_altKey]||[];}}
          _fvItems.push({label:g.label+' '+c+'반',fullLabel:(g.fullLabel||g.label)+' '+c+'반',dept:g.dept||'',tail:(g.tail||g.label)+' '+c+'반',val:v,prev:pv,diff:diff,pct:pct,gd:_fvGd,stu:_fvStu});
          _fvTotal+=v;
        });
      });
      _fvItems.sort(function(a,b){return b.val-a.val;});
      /* 방문자 0건 학급은 트리맵에서 제외 — 시선이 실제 방문 학급에만 집중되도록 */
      const _fvAll=_fvItems.filter(function(it){return it.val>0;}).map(function(it){return {label:it.label,fullLabel:it.fullLabel,dept:it.dept,tail:it.tail,val:it.val,realVal:it.val,prev:it.prev,diff:it.diff,pct:it.pct,gd:it.gd,stu:it.stu};});
      const _fvAllTotal=_fvAll.reduce(function(s,it){return s+it.val;},0);
      if(_fvAll.length&&_fvAllTotal>0){
        /* ── Squarified Treemap (Bruls, Huizing, van Wijk 2000) ── */
        function _sqWorst(row,sideLen,totalArea){
          if(!row.length)return Infinity;
          let rowSum=0;for(let i=0;i<row.length;i++)rowSum+=row[i]._area;
          const s2=rowSum*rowSum;const side2=sideLen*sideLen;
          let worst=0;
          for(let i=0;i<row.length;i++){
            const a=row[i]._area;
            const r=Math.max((side2*a)/s2,s2/(side2*a));
            if(r>worst)worst=r;
          }
          return worst;
        }
        function _sqLayout(items,rect){
          if(!items.length)return;
          let total=0;for(let i=0;i<items.length;i++)total+=items[i]._area;
          if(items.length===1){items[0]._rx=rect.x;items[0]._ry=rect.y;items[0]._rw=rect.w;items[0]._rh=rect.h;return;}
          const isWide=rect.w>=rect.h;
          const sideLen=isWide?rect.h:rect.w;
          const row=[];const remaining=[];
          row.push(items[0]);
          for(let i=1;i<items.length;i++){
            const test=row.concat(items[i]);
            if(_sqWorst(test,sideLen,total)<=_sqWorst(row,sideLen,total)){
              row.push(items[i]);
            } else {
              for(let j=i;j<items.length;j++)remaining.push(items[j]);
              break;
            }
          }
          /* row 내 아이템 배치 */
          let rowSum=0;for(let i=0;i<row.length;i++)rowSum+=row[i]._area;
          const rowFrac=rowSum/total;
          if(isWide){
            const rw=rect.w*rowFrac;
            let ry=rect.y;
            for(let i=0;i<row.length;i++){
              const frac=row[i]._area/rowSum;
              const rh=rect.h*frac;
              row[i]._rx=rect.x;row[i]._ry=ry;row[i]._rw=rw;row[i]._rh=rh;
              ry+=rh;
            }
            if(remaining.length)_sqLayout(remaining,{x:rect.x+rw,y:rect.y,w:rect.w-rw,h:rect.h});
          } else {
            const rh=rect.h*rowFrac;
            let rx=rect.x;
            for(let i=0;i<row.length;i++){
              const frac=row[i]._area/rowSum;
              const rw2=rect.w*frac;
              row[i]._rx=rx;row[i]._ry=rect.y;row[i]._rw=rw2;row[i]._rh=rh;
              rx+=rw2;
            }
            if(remaining.length)_sqLayout(remaining,{x:rect.x,y:rect.y+rh,w:rect.w,h:rect.h-rh});
          }
        }
        /* 테이블 히트맵과 동일한 높이 (px) 계산: header(35) + 학년수×35 */
        const _sqHeightPx=35+_hmGrades.length*35;
        const _sqTotalPx=1000*_sqHeightPx;/* 비례용 */
        _fvAll.forEach(function(it){it._area=(it.val/_fvAllTotal)*_sqTotalPx;});
        _sqLayout(_fvAll,{x:0,y:0,w:1000,h:_sqHeightPx});
        /* 좌표를 %로 변환하여 렌더링 */
        _fvAll.forEach(function(it){it._rxP=(it._rx/1000)*100;it._ryP=(it._ry/_sqHeightPx)*100;it._rwP=(it._rw/1000)*100;it._rhP=(it._rh/_sqHeightPx)*100;});

        h+='<div style="position:relative;width:100%;height:'+_sqHeightPx+'px;overflow:hidden;border-radius:8px;border:1px solid var(--bdr)">';
        let _fvMaxDiff=1;
        _fvAll.forEach(function(it){const ad=Math.abs(it.diff);if(ad>_fvMaxDiff)_fvMaxDiff=ad;});
        /* 컨테이너 실제 너비로 px 환산용 */
        const _fvContainerW=document.getElementById('dashChartHeatmap');
        const _fvRealW=_fvContainerW?(_fvContainerW.offsetWidth-32):600;
        _fvAll.forEach(function(item){
          let bg, fg;
          /* 색상: 전기 대비 증감 — 증가=초록, 감소=빨강, 변동없음=회색 */
          const pctChange=item.prev>0?(item.diff/item.prev):item.diff>0?1:item.diff<0?-1:0;
          let _fvMaxDiff=1;_fvAll.forEach(function(it){const ad=Math.abs(it.diff);if(ad>_fvMaxDiff)_fvMaxDiff=ad;});
          if(item.diff>0){
            const intensity=Math.abs(item.diff)/_fvMaxDiff;
            /* 연초록 → 진한초록 (시간대별 히트맵과 동일 계열) */
            const idx=Math.min(14,Math.round(intensity*14));
            const _fvGreenPalette=['#E8F5E9','#C8E6C9','#A5D6A7','#81C784','#66BB6A','#4CAF50','#43A047','#388E3C','#2E7D32','#256F2B','#1B5E20','#145218','#0E4510','#083808','#042B04'];
            bg=_fvGreenPalette[idx];fg='#fff';
          } else if(item.diff<0){
            const intensity=Math.abs(item.diff)/_fvMaxDiff;
            const idx=Math.min(14,Math.round(intensity*14));
            const _fvRedPalette=['#FFEBEE','#FFCDD2','#EF9A9A','#E57373','#EF5350','#F44336','#E53935','#D32F2F','#C62828','#B71C1C','#A51414','#8E0E0E','#780808','#620404','#4E0000'];
            bg=_fvRedPalette[idx];fg='#fff';
          } else {
            bg='rgba(100,116,139,0.18)';fg='var(--t2)';
          }
          const lPct=item._rxP;
          const tPct=item._ryP;
          const wPct=item._rwP;
          const hPct=item._rhP;
          const sign=item.diff>0?'+':'';
          /* 실제 px 크기 계산 → 글씨 크기 결정.
             ── 박스 폭/높이를 모두 검증하여 잘림 방지 (작은 박스도 폰트를 줄여서 들어가도록).
             문자 평균 폭 비율(한글/숫자 안전계수): 0.65. */
          const realWpx=wPct/100*_fvRealW;
          const realHpx=hPct/100*_sqHeightPx;
          const _padX=6, _padY=4;
          const _availW=Math.max(0, realWpx-_padX);
          const _availH=Math.max(0, realHpx-_padY);
          const _CHAR_W=0.65;
          /* 숫자 — 항상 표시, 잘리지 않도록 폭 기준으로 축소 (최소 7px) */
          const _numText=String(item.realVal);
          let numSize=Math.max(10,Math.min(22,Math.sqrt(realWpx*realHpx)*0.18));
          const _numMaxByW=_availW/Math.max(1,_numText.length*_CHAR_W);
          if(numSize>_numMaxByW)numSize=Math.max(7,_numMaxByW);
          if(numSize>_availH)numSize=Math.max(7,_availH*0.85);
          /* 라벨 — 칸 폭을 '한글 실제 폭(≈1em)' 기준으로 정확히 감지하고,
             안 맞으면 과명을 풀 → 5 → 4 → 3 → 2글자 → 학년반만 순으로 줄여 절대 잘리지 않게 (사용자 요청 2026-06-11) */
          const _heightForLabel=_availH-numSize*1.15;
          const _wUnits=function(txt){ let w=0; for(let i=0;i<txt.length;i++){ w+=/[ㄱ-힣]/.test(txt[i])?1.0:0.55; } return Math.max(0.1,w); };
          function _fitLabel(txt){
            let ls=Math.max(10,Math.min(14,Math.sqrt(realWpx*realHpx)*0.12));
            const u=_wUnits(txt);
            const maxByW=_availW/u;
            if(ls>maxByW)ls=maxByW;
            const fits=ls>=8 && _heightForLabel>=ls*1.1 && u*ls<=_availW;
            return {fits:fits,size:fits?Math.max(8,Math.min(14,ls)):ls};
          }
          const _cands=[];
          if(item.dept){
            for(let n=item.dept.length;n>=2;n--)_cands.push(item.dept.substring(0,n)+' '+item.tail);
            _cands.push(item.tail);   /* 과명을 다 줄여도 안 되면 학년반만 */
          } else {
            _cands.push(item.fullLabel||item.label);
            if(item.label!==(item.fullLabel||item.label))_cands.push(item.label);
          }
          let _dispLabel=null,_lf={fits:false,size:8};
          for(let ci=0;ci<_cands.length;ci++){ const f=_fitLabel(_cands[ci]); if(f.fits){_dispLabel=_cands[ci];_lf=f;break;} }
          const labelFits=_lf.fits&&_dispLabel!=null;
          const labelSize=_lf.size;
          /* diff 텍스트 — 라벨/숫자 다음에 표시 (라벨 fits + 잔여 높이 충족 시) */
          let diffSize=Math.max(9,Math.min(12,Math.sqrt(realWpx*realHpx)*0.1));
          const _diffText=(item.diff>0?'+':'')+item.diff;
          const _diffMaxByW=_availW/Math.max(1,_diffText.length*_CHAR_W);
          if(diffSize>_diffMaxByW)diffSize=Math.max(7,_diffMaxByW);
          const _heightForDiff=_availH-numSize*1.15-(labelFits?labelSize*1.15:0);
          const _diffFits=labelFits && _heightForDiff>=diffSize*1.05 && diffSize>=7;
          /* 툴팁 텍스트 */
          const _fvU=(item.gd&&item.gd.u)||0;
          /* 미니팝업에는 과명 전체(fullLabel) 표시 (사용자 요청 2026-06-11) */
          let _fvTipHtml='<b>'+escHtml(item.fullLabel||item.label)+'</b> &nbsp; <span style="color:#10B981">남:'+(item.gd?item.gd.m:0)+'</span> <span style="color:#38BDF8">여:'+(item.gd?item.gd.f:0)+'</span>'+(_fvU>0?' <span style="color:var(--t3)">미상:'+_fvU+'</span>':'')+'<br>방문: '+item.realVal+'명 &nbsp; '+_fvPeriodLabel+' 대비: '+(item.diff>0?'+':'')+item.diff+'명';
          if(item.stu&&item.stu.length)_fvTipHtml+='<br>'+item.stu.slice().sort(function(a,b){return String(a).localeCompare(String(b),'ko');}).slice(0,15).map(function(s){return escHtml(s);}).join(' &nbsp; ')+(item.stu.length>15?' <span style="color:var(--t3)">외 '+(item.stu.length-15)+'명</span>':'');
          const _fvTipKey='_fvTip_'+_fvAll.indexOf(item);
          window[_fvTipKey]=_fvTipHtml;
          h+='<div style="position:absolute;left:'+lPct+'%;top:'+tPct+'%;width:'+wPct+'%;height:'+hPct+'%;box-sizing:border-box;border:1px solid rgba(0,0,0,0.12);background:'+bg+';display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:2px;cursor:default;transition:filter .15s;line-height:1.1" data-tooltip-key="'+_fvTipKey+'" data-hover-brightness="1">';
          if(labelFits)h+='<div style="font-size:'+labelSize.toFixed(1)+'px;font-weight:800;color:'+fg+';white-space:nowrap;line-height:1.1;text-shadow:0 1px 2px rgba(0,0,0,0.3)">'+_dispLabel+'</div>';
          h+='<div style="font-size:'+numSize.toFixed(1)+'px;font-weight:900;color:'+fg+';font-family:var(--fm);white-space:nowrap;line-height:1.05;text-shadow:0 1px 2px rgba(0,0,0,0.3)">'+item.realVal+'</div>';
          if(item.diff!==0 && _diffFits){
            const pctDisplay=item.prev>0?Math.round(pctChange*100):(item.diff>0?100:-100);
            h+='<div style="font-size:'+diffSize.toFixed(1)+'px;font-weight:700;color:'+fg+';white-space:nowrap;line-height:1.1;text-shadow:0 1px 2px rgba(0,0,0,0.3)">'+_diffText+'</div>';
          }
          h+='</div>';
        });
        h+='</div>';
      } else {
        h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:20px">해당 기간 방문 학급이 없습니다</div>';
      }
      /* 범례 */
      h+='<div style="display:flex;align-items:center;gap:10px;margin-top:10px;justify-content:flex-end">';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--t3)"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(34,197,94,0.6)"></span>증가</span>';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--t3)"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(239,68,68,0.6)"></span>감소</span>';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--t3)"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(148,163,184,0.15);border:1px solid var(--bdr)"></span>변동없음</span>';
      h+='</div>';
    }
    h+='</div>';
    h+='<div style="height:12px"></div>';
  }

  /* ══ 방문자 추이 + 반별 방문 TOP ══ */
  const dayCount={};
  let _allVals=[];/* full history for MA — 데이터 있는 날만 (today/week only) */
  const _dayIdxMap={};/* display key → _allVals index mapping */
  if(S.statsPeriod==='today'){
    /* 데이터 있는 날만 수집하여 이동평균 계산 (0건 날 제외) */
    const _today=S.selectedDate||toDateStr(new Date());
    const _fullCount={};
    S.records.forEach(function(r){if(r.date<=_today)_fullCount[r.date]=(_fullCount[r.date]||0)+1;});
    /* 방문 데이터가 있는 날만 정렬 */
    const _allDataDays=Object.keys(_fullCount).filter(function(d){return _fullCount[d]>0;}).sort();
    _allVals=_allDataDays.map(function(d){return _fullCount[d];});
    /* display last 20 data days */
    const _dispDays=_allDataDays.slice(-20);
    _dispDays.forEach(function(d){dayCount[d]=_fullCount[d];});
    /* 날짜→_allVals 인덱스 룩업 */
    _allDataDays.forEach(function(d,i){_dayIdxMap[d]=i;});
  } else if(S.statsPeriod==='week'){
    /* 데이터 있는 주만 수집하여 이동평균 계산 (0건 주 제외) */
    function _isoWeekKey(dt){
      const d=new Date(dt);
      const onejan=new Date(d.getFullYear(),0,1);
      const wk=Math.ceil((((d-onejan)/86400000)+onejan.getDay()+1)/7);
      return d.getFullYear()+'W'+String(wk).padStart(2,'0');
    }
    const _weekMap={};
    S.records.forEach(function(r){
      const key=_isoWeekKey(r.date);
      _weekMap[key]=(_weekMap[key]||0)+1;
    });
    /* 방문 데이터가 있는 주만 정렬 */
    const _allDataWeeks=Object.keys(_weekMap).filter(function(k){return _weekMap[k]>0;}).sort();
    _allVals=_allDataWeeks.map(function(k){return _weekMap[k];});
    /* display last 20 data weeks */
    const _dispKeys=_allDataWeeks.slice(-20);
    _dispKeys.forEach(function(k){dayCount[k]=_weekMap[k];});
    /* 주차→_allVals 인덱스 룩업 */
    _allDataWeeks.forEach(function(k,i){_dayIdxMap[k]=i;});
  } else {
    filtered.forEach(function(r){dayCount[r.date]=(dayCount[r.date]||0)+1;});
  }
  /* 방문자 0명인 날은 차트에서 제외 */
  Object.keys(dayCount).forEach(function(k){if(!dayCount[k])delete dayCount[k];});
  const days=Object.keys(dayCount).sort();

  /* MA helper: compute moving average array from full values */
  function _computeMA(vals,period){
    const result=[];
    for(let i=0;i<vals.length;i++){
      const start=Math.max(0,i-period+1);
      let sum=0;for(let j=start;j<=i;j++)sum+=vals[j];
      result.push(sum/(i-start+1));
    }
    return result;
  }
  /* pre-compute MAs for today/week */
  const _showMA=(S.statsPeriod==='today'||S.statsPeriod==='week')&&_allVals.length>0;
  let _ma20=[], _ma50=[], _ma200=[];
  if(_showMA){
    _ma20=_computeMA(_allVals,20);
    _ma50=_computeMA(_allVals,50);
    _ma200=_computeMA(_allVals,200);
  }

  /* period title */
  let _trendTitle='방문자 추이';
  if(S.statsPeriod==='today')_trendTitle='방문자 추이 및 이동평균선 (최근 20일)';
  else if(S.statsPeriod==='week')_trendTitle='방문자 추이 및 이동평균선 (최근 20주)';
  else if(S.statsPeriod==='month')_trendTitle='방문자 추이 (최근 10개월)';
  else if(S.statsPeriod==='semester')_trendTitle='방문자 추이 (최근 6학기)';
  else if(S.statsPeriod==='year')_trendTitle='방문자 추이 (최근 5개년)';
  else if(S.statsPeriod==='custom')_trendTitle='방문자 추이';

  h+='<div style="display:flex;gap:12px;flex-wrap:wrap">';
  if(days.length>1){
    h+='<div id="dashChartTrend" style="flex:2;min-width:250px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#06b6d4,#0891b2);border-radius:2px"></span>'+escHtml(_trendTitle)+'<span style="flex:1"></span>'+_copyBtnHtml('dashChartTrend','방문자 추이 복사됨')+'</div>';
    /* 꺾은선 그래프 */
    const _cdVals=days.map(function(d){return dayCount[d]||0;});
    /* compute max including MA values for y-axis scaling */
    let _allDisplayMax=Math.max.apply(null,_cdVals)||1;
    if(_showMA){
      for(let _mi=0;_mi<days.length;_mi++){
        const _idx=_dayIdxMap[days[_mi]];
        if(_idx!==undefined){
          _allDisplayMax=Math.max(_allDisplayMax,_ma20[_idx]||0,_ma50[_idx]||0,_ma200[_idx]||0);
        }
      }
    }
    const dMaxV=Math.ceil(_allDisplayMax)||1;
    const svgW=Math.max(600,days.length*32);const svgH=180;
    const padX=30, padY=16, padB=60, cW=svgW-padX*2, cH=svgH-padY-padB;
    const gap=cW/days.length;
    function _cdY(v){return padY+cH-(v/dMaxV)*cH;}
    let svg='<svg viewBox="0 0 '+svgW+' '+svgH+'" style="width:100%;height:'+svgH+'px">';
    /* 그리드 */
    for(let gi=0;gi<=4;gi++){const gy=padY+(cH/4)*gi;const gv=Math.round(dMaxV*(4-gi)/4);svg+='<line x1="'+padX+'" y1="'+gy+'" x2="'+(svgW-padX)+'" y2="'+gy+'" stroke="var(--bdr)" stroke-width="0.5" stroke-dasharray="3,3"/>';svg+='<text x="'+(padX-4)+'" y="'+(gy+3)+'" text-anchor="end" fill="var(--t3)" font-size="7" font-family="var(--fm)">'+gv+'</text>';}
    /* 영역 채우기 (gradient) */
    svg+='<defs><linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#06b6d4" stop-opacity="0.25"/><stop offset="100%" stop-color="#06b6d4" stop-opacity="0.02"/></linearGradient></defs>';
    let areaPath='M'+(padX+gap*0+gap/2)+','+_cdY(_cdVals[0]);
    for(let i=1;i<_cdVals.length;i++){areaPath+=' L'+(padX+gap*i+gap/2)+','+_cdY(_cdVals[i]);}
    areaPath+=' L'+(padX+gap*(_cdVals.length-1)+gap/2)+','+(padY+cH)+' L'+(padX+gap/2)+','+(padY+cH)+' Z';
    svg+='<path d="'+areaPath+'" fill="url(#lineGrad)"/>';
    /* 꺾은선 */
    let linePath='M'+(padX+gap*0+gap/2)+','+_cdY(_cdVals[0]);
    for(let i=1;i<_cdVals.length;i++){linePath+=' L'+(padX+gap*i+gap/2)+','+_cdY(_cdVals[i]);}
    svg+='<path d="'+linePath+'" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    /* 이동평균선 (today/week only) */
    if(_showMA){
      const _maConfigs=[
        {arr:_ma20,color:'#F97316',dash:'6,3',width:2,label:'20'},
        {arr:_ma50,color:'#16a34a',dash:'8,4',width:1.8,label:'50'},
        {arr:_ma200,color:'#333',dash:'3,3',width:1.5,label:'200'}
      ];
      _maConfigs.forEach(function(mc){
        if(_allVals.length<parseInt(mc.label,10))return;/* 데이터 부족 시 해당 MA 생략 */
        let maPath='';
        for(let mi=0;mi<days.length;mi++){
          const idx=_dayIdxMap[days[mi]];
          if(idx!==undefined&&idx<mc.arr.length&&idx>=parseInt(mc.label,10)-1){
            const mx=padX+gap*mi+gap/2;
            const my=_cdY(mc.arr[idx]);
            maPath+=(maPath?(' L'+mx+','+my):('M'+mx+','+my));
          }
        }
        if(maPath)svg+='<path d="'+maPath+'" fill="none" stroke="'+mc.color+'" stroke-width="'+mc.width+'" stroke-dasharray="'+mc.dash+'" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>';
      });
    }
    /* 날짜별 남/여 집계 */
    const _trendGender={};
    S.records.forEach(function(r){
      const d=r.date;if(!dayCount[d])return;
      if(!_trendGender[d])_trendGender[d]={m:0,f:0};
      const s=getStu(r.studentId);if(!s)return;
      let g=s.gender;if(g==='M')g='남';else if(g==='F')g='여';
      if(g==='남')_trendGender[d].m++;
      else if(g==='여')_trendGender[d].f++;
    });
    /* 점 + 값 라벨 + 호버 팝업 */
    _cdVals.forEach(function(v,i){
      const x=padX+gap*i+gap/2;
      const tipId='trendTip_'+i;
      const gd=_trendGender[days[i]]||{m:0,f:0};
      svg+='<circle cx="'+x+'" cy="'+_cdY(v)+'" r="5" fill="transparent" stroke="none" style="cursor:pointer" data-tip="'+tipId+'"/>';
      svg+='<circle cx="'+x+'" cy="'+_cdY(v)+'" r="3" fill="#06b6d4" stroke="#fff" stroke-width="1.5" style="pointer-events:none"/>';
      svg+='<text x="'+x+'" y="'+(_cdY(v)-7)+'" text-anchor="middle" fill="var(--t1)" font-size="7" font-weight="700" font-family="var(--fm)" style="pointer-events:none">'+v+'</text>';
    });
    /* 날짜 라벨 */
    const _labelInterval=Math.max(1,Math.ceil(days.length/20));
    days.forEach(function(d,i){const x=padX+gap*i+gap/2;if(i%_labelInterval===0)svg+='<text x="'+x+'" y="'+(padY+cH+10)+'" text-anchor="end" fill="var(--t1)" font-size="11" font-weight="700" font-family="var(--fm)" transform="rotate(-55,'+x+','+(padY+cH+10)+')">'+d.substring(5)+'</text>';});
    svg+='</svg>';
    /* SVG + HTML 팝업 */
    h+='<div style="position:relative">'+svg;
    _cdVals.forEach(function(v,i){
      const gd=_trendGender[days[i]]||{m:0,f:0};
      const tipId='trendTip_'+i;
      const leftPct=((padX+gap*i+gap/2)/svgW*100);
      const yPct=((_cdY(v))/svgH*100);
      /* 점이 우측 절반이면 왼쪽에, 좌측이면 오른쪽에 팝업 */
      const isRight=leftPct>55;
      const posStyle=isRight
        ?'top:'+yPct+'%;right:'+(100-leftPct+2)+'%;left:auto;transform:none'
        :'top:'+yPct+'%;left:'+(leftPct+2)+'%;transform:none';
      h+='<div id="'+tipId+'" style="display:none;position:absolute;'+posStyle+';background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;z-index:10;font-size:10px;line-height:1.5;pointer-events:none">';
      h+='<div style="font-weight:700;color:var(--t1)">'+days[i]+'</div>';
      h+='<div style="color:#10B981">남: '+gd.m+'명</div>';
      h+='<div style="color:#38BDF8">여: '+gd.f+'명</div>';
      h+='<div style="color:var(--t3);font-size:9px;border-top:1px solid var(--bdr);padding-top:2px;margin-top:2px">총 '+v+'명</div>';
      h+='</div>';
    });
    h+='</div>';
    /* 범례 (이동평균선 포함) */
    if(_showMA){
      const _maUnit=(S.statsPeriod==='week'?'주':'일');
      h+='<div style="display:flex;align-items:center;gap:12px;margin-top:6px;justify-content:flex-end;flex-wrap:wrap">';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--t3)"><span style="display:inline-block;width:10px;height:3px;border-radius:1px;background:#06b6d4"></span>방문자</span>';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:'+(_allVals.length>=20?'var(--t3)':'var(--t3);opacity:0.4')+'"><span style="display:inline-block;width:10px;height:2px;border-top:2px dashed #F97316;opacity:'+(_allVals.length>=20?'1':'0.3')+'"></span>20'+_maUnit+' 이평선</span>';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:'+(_allVals.length>=50?'var(--t3)':'var(--t3);opacity:0.4')+'"><span style="display:inline-block;width:10px;height:2px;border-top:2px dashed #16a34a;opacity:'+(_allVals.length>=50?'1':'0.3')+'"></span>50'+_maUnit+' 이평선</span>';
      h+='<span style="display:flex;align-items:center;gap:3px;font-size:9px;color:'+(_allVals.length>=200?'var(--t3)':'var(--t3);opacity:0.4')+'"><span style="display:inline-block;width:10px;height:2px;border-top:2px dashed #333;opacity:'+(_allVals.length>=200?'1':'0.3')+'"></span>200'+_maUnit+' 이평선</span>';
      h+='</div>';
    }
    h+='</div>';
  }
  /* ── 침상 이용 추이 (방문자 추이 옆) ── */
  const _bedCount={};
  filtered.forEach(function(r){
    if(_statHasBed(r))_bedCount[r.date]=(_bedCount[r.date]||0)+1; /* 합성칩 안 '침상'까지 인식 (2026-06-09) */
  });
  const _bedDays=Object.keys(_bedCount).sort();
  h+='<div id="dashChartBed" style="flex:2;min-width:250px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:8px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#8B5CF6,#EC4899);border-radius:2px"></span>침상 이용 추이<span style="flex:1"></span>'+_copyBtnHtml('dashChartBed','침상 이용 추이 복사됨')+'</div>';
  if(_bedDays.length>0){
    const _bedVals=_bedDays.map(function(d){return _bedCount[d];});
    const _bedMax=Math.max.apply(null,_bedVals)||1;
    const _bedSvgW=Math.max(400,_bedDays.length*28), _bedSvgH=180;
    const _bedPadX=30, _bedPadY=14, _bedPadB=60, _bedCW=_bedSvgW-_bedPadX*2, _bedCH=_bedSvgH-_bedPadY-_bedPadB;
    const _bedGap=_bedCW/Math.max(1,_bedDays.length);
    const _bedDMax=Math.ceil(_bedMax);
    function _bedY(v){return _bedPadY+_bedCH-(v/_bedDMax)*_bedCH;}
    let _bedSvg='<svg viewBox="0 0 '+_bedSvgW+' '+_bedSvgH+'" style="width:100%;height:'+_bedSvgH+'px">';
    for(let bgi=0;bgi<=3;bgi++){const bgy=_bedPadY+(_bedCH/3)*bgi;const bgv=Math.round(_bedDMax*(3-bgi)/3);_bedSvg+='<line x1="'+_bedPadX+'" y1="'+bgy+'" x2="'+(_bedSvgW-_bedPadX)+'" y2="'+bgy+'" stroke="var(--bdr)" stroke-width="0.5" stroke-dasharray="3,3"/>';_bedSvg+='<text x="'+(_bedPadX-4)+'" y="'+(bgy+3)+'" text-anchor="end" fill="var(--t3)" font-size="7" font-family="var(--fm)">'+bgv+'</text>';}
    _bedSvg+='<defs><linearGradient id="bedGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.25"/><stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.02"/></linearGradient></defs>';
    if(_bedDays.length>1){
      let _bedArea='M'+(_bedPadX+_bedGap/2)+','+_bedY(_bedVals[0]);
      for(let bi=1;bi<_bedVals.length;bi++)_bedArea+=' L'+(_bedPadX+_bedGap*bi+_bedGap/2)+','+_bedY(_bedVals[bi]);
      _bedArea+=' L'+(_bedPadX+_bedGap*(_bedVals.length-1)+_bedGap/2)+','+(_bedPadY+_bedCH)+' L'+(_bedPadX+_bedGap/2)+','+(_bedPadY+_bedCH)+' Z';
      _bedSvg+='<path d="'+_bedArea+'" fill="url(#bedGrad)"/>';
      let _bedLine='M'+(_bedPadX+_bedGap/2)+','+_bedY(_bedVals[0]);
      for(let bi2=1;bi2<_bedVals.length;bi2++)_bedLine+=' L'+(_bedPadX+_bedGap*bi2+_bedGap/2)+','+_bedY(_bedVals[bi2]);
      _bedSvg+='<path d="'+_bedLine+'" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    _bedVals.forEach(function(v,i){const x=_bedPadX+_bedGap*i+_bedGap/2;_bedSvg+='<circle cx="'+x+'" cy="'+_bedY(v)+'" r="3" fill="#8B5CF6" stroke="#fff" stroke-width="1.5"/>';_bedSvg+='<text x="'+x+'" y="'+(_bedY(v)-6)+'" text-anchor="middle" fill="var(--t1)" font-size="7" font-weight="700" font-family="var(--fm)">'+v+'</text>';});
    const _bedLblInt=Math.max(1,Math.ceil(_bedDays.length/15));
    _bedDays.forEach(function(d,i){const x=_bedPadX+_bedGap*i+_bedGap/2;if(i%_bedLblInt===0)_bedSvg+='<text x="'+x+'" y="'+(_bedPadY+_bedCH+10)+'" text-anchor="end" fill="var(--t1)" font-size="11" font-weight="700" font-family="var(--fm)" transform="rotate(-55,'+x+','+(_bedPadY+_bedCH+10)+')">'+d.substring(5)+'</text>';});
    _bedSvg+='</svg>';
    h+=_bedSvg;
  } else {
    h+='<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--t3);font-size:11px">🛏 침상 이용 데이터가 없습니다</div>';
  }
  h+='</div>';
  h+='</div>';/* 방문자추이+침상 행 끝 */
  h+='<div style="height:12px"></div>';

  /* 방문자 추이 TSV */
  if(days&&days.length>1){
    _dashChartTsvData['dashChartTrend']='날짜\t'+days.join('\t')+'\n방문자수\t'+days.map(function(d){return dayCount[d]||0;}).join('\t');
  }
  if(_clsSorted.length){
    _dashChartTsvData['dashChartClsTop']='순위\t학급\t건수\n'+_clsSorted.map(function(c,i){const label=_clsLabelMap[c[0]]||c[0];return(i+1)+'\t'+label+'\t'+c[1];}).join('\n');
  }

  /* ── 공통 성별 집계 (처치/투약/증상/요일/반별/시간대 등에서 사용) ── */
  function _genderOf(r){const s=getStu(r.studentId);if(!s)return '';const g=s.gender;if(g==='M')return '남';if(g==='F')return '여';return g||'';}
  /* 미니팝업 학생 표기 — 학과가 입력돼 있으면 학과 포함 (사용자 요청 2026-06-11. 예: 항공정비과 1학년 2반 김샛별) */
  function _stuInfoOf(r){const s=getStu(r.studentId);if(!s)return '';if(s.type==='staff')return (s.position||'교직원')+' '+s.name;const _dp=(s.department&&String(s.department).trim())?String(s.department).trim()+' ':'';return _dp+s.grade+'학년 '+s.cls+'반 '+s.name;}
  /* 처치별 성별 */
  const _treatGender={};/* key→{m,f} */
  /* 투약별 성별 */
  const _medGender={};
  /* 증상별 성별 */
  const _symGender={};
  /* 요일별 성별 */
  const _dowGender={월:{m:0,f:0},화:{m:0,f:0},수:{m:0,f:0},목:{m:0,f:0},금:{m:0,f:0}};
  /* 반별 성별 */
  const _clsGenderMap={};
  /* 시간대별 성별 */
  const _hourGender={};
  /* 오늘 탭: 항목별 학생 목록 */
  const _treatStudents={}, _medStudents={}, _symStudents={}, _dowStudents={}, _clsStudents={};

  /* 4. 처치별 분포 + 투약 TOP10 — 한 행 / 요일별 분포 + TOP10 증상 — 한 행 */
  const _treatCount={};
  filtered.forEach(function(r){
    const g=_genderOf(r);const info=_stuInfoOf(r);
    if(r.treatment)r.treatment.forEach(function(t){
      _treatCount[t]=(_treatCount[t]||0)+1;
      if(!_treatGender[t])_treatGender[t]={m:0,f:0};
      if(g==='남')_treatGender[t].m++;else if(g==='여')_treatGender[t].f++;
      if(S.statsPeriod==='today'){if(!_treatStudents[t])_treatStudents[t]=[];_treatStudents[t].push(info);}
    });
  });
  const _treatSorted=Object.entries(_treatCount).sort(function(a,b){return b[1]-a[1];}).slice(0,8);
  const _treatMax=_treatSorted.length?_treatSorted[0][1]:1;

  /* 투약 TOP10 데이터 수집 (처치 옆에 배치하므로 여기서 미리 계산) */
  function _medBaseName(name){
    if(!name)return '';
    /* "가네톡액(10ml)" → "가네톡액" — 새 명시적 투여량 포맷 분리 우선 */
    const noPar=String(name).replace(/\s*\([^)]*\)\s*$/,'').trim();
    /* 옛 포맷 호환 — "타이레놀500mg" 같이 단위 suffix 가 약명에 붙어있는 경우 */
    const n=noPar.replace(/[\d,.]+\s*(mg|ml|g|%|정|캡슐|시럽|연질캡슐|과립|산|액|겔|크림|로션|패치|현탁액).*$/i,'');
    const n2=n.replace(/(연질캡슐|연질|이브연질|프로연질|플러스|에스정|이엑스|서방정|속효정|장용정)$/,'');
    return (n2.length>=2?n2:n).replace(/\s+$/,'').trim();
  }
  const _medCount={};filtered.forEach(function(r){
    const _medStr=_statMedicationStr(r); /* 합성칩 안 투약[…]까지 합산 (2026-06-09) */
    if(!_medStr||!_medStr.trim())return;
    const g=_genderOf(r);const info=_stuInfoOf(r);
    _medStr.split(/[,\/]/).forEach(function(m){
      const base=_medBaseName(m.trim());
      if(!base)return;
      _medCount[base]=(_medCount[base]||0)+1;
      if(!_medGender[base])_medGender[base]={m:0,f:0};
      if(g==='남')_medGender[base].m++;else if(g==='여')_medGender[base].f++;
      if(S.statsPeriod==='today'){if(!_medStudents[base])_medStudents[base]=[];_medStudents[base].push(info);}
    });
  });
  const _medSorted=Object.entries(_medCount).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
  const _medMax=_medSorted.length?_medSorted[0][1]:1;

  const _dowCount={'월':0,'화':0,'수':0,'목':0,'금':0};
  const _dowNames=['일','월','화','수','목','금','토'];
  /* 오늘 탭: 해당 주 전체 데이터로 요일별 분포 계산 */
  let _dowRecords=filtered;
  if(S.statsPeriod==='today'){
    const _sel=S.selectedDate||toDateStr(new Date());
    const _selD=new Date(_sel);
    const _weekStart=new Date(_selD);_weekStart.setDate(_selD.getDate()-_selD.getDay()+1);
    const _weekEnd=new Date(_weekStart);_weekEnd.setDate(_weekStart.getDate()+4);
    const _ws=toDateStr(_weekStart), _we=toDateStr(_weekEnd);
    _dowRecords=S.records.filter(function(r){return r.date>=_ws&&r.date<=_we;});
  }
  _dowRecords.forEach(function(r){const d=new Date(r.date).getDay();const dn=_dowNames[d];if(_dowCount[dn]!==undefined){_dowCount[dn]++;const g=_genderOf(r);if(g==='남')_dowGender[dn].m++;else if(g==='여')_dowGender[dn].f++;if(S.statsPeriod==='today'){if(!_dowStudents[dn])_dowStudents[dn]=[];_dowStudents[dn].push(_stuInfoOf(r));}}});
  const _dowMax=Math.max.apply(null,Object.values(_dowCount))||1;

  /* 증상 별칭 승계 — 사용자가 이름 바꾼 중분류(ec_sym_renames {옛:새})는 옛 기록도 새 이름으로 합산 (2026-06-12) */
  let _symAliasMap={};try{_symAliasMap=JSON.parse(localStorage.getItem('ec_sym_renames')||'{}')||{};}catch(_){}
  function _aliasSym(s){
    const str=String(s||'');const m=str.match(/^(.+?)\s*\((.*)\)\s*$/);
    const b=(m?m[1]:str).trim();const nb=_symAliasMap[b];
    if(!nb||nb===b)return s;
    return m?(nb+' ('+m[2]+')'):nb;
  }
  const _symCount2={};filtered.forEach(function(r){const g=_genderOf(r);const info=_stuInfoOf(r);r.symptoms.forEach(function(s0){const s=_aliasSym(s0);_symCount2[s]=(_symCount2[s]||0)+1;if(!_symGender[s])_symGender[s]={m:0,f:0};if(g==='남')_symGender[s].m++;else if(g==='여')_symGender[s].f++;if(S.statsPeriod==='today'){if(!_symStudents[s])_symStudents[s]=[];_symStudents[s].push(info);}});});
  const _symSorted=Object.entries(_symCount2).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
  const _symMax=_symSorted.length?_symSorted[0][1]:1;

  /* ── 공통 성별 음영 바 렌더링 헬퍼 ── */
  const _tipStyle='display:none;position:absolute;bottom:calc(100% + 4px);left:0;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;z-index:20;font-size:10px;font-family:var(--f);line-height:1.5;pointer-events:none';
  /* 사람 라벨 + recId/date를 받아 클릭 가능 span을 생성. 클릭 시 해당 날짜로 이동 후 증상 팝업 오픈 */
  function _peopleSpansHtml(people){
    let s='';
    /* 학과(라벨 앞부분)별로 묶이도록 라벨 가나다 정렬 (사용자 요청 2026-06-11) */
    const _sorted=people.slice().sort(function(a,b){
      const la=(typeof a==='string')?a:(a&&a.label||'');
      const lb=(typeof b==='string')?b:(b&&b.label||'');
      return String(la).localeCompare(String(lb),'ko');
    });
    _sorted.slice(0,15).forEach(function(p){
      if(typeof p==='string'){s+='<span>'+escHtml(p)+'</span>';return;}
      /* {label, recId, date, studentId} 객체 — 클릭 동작 제거 (증상 팝업 오픈 안 함) */
      s+='<span>'+escHtml(p.label||'')+'</span>';
    });
    if(_sorted.length>15)s+='<span style="color:var(--t3)">외 '+(_sorted.length-15)+'명</span>';
    return s;
  }
  function _genderBar(label,total,gd,col,pct,rank,people,chartId,idx,tipLabel){
    const tipId=chartId+'Tip_'+idx;
    let hb='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;position:relative" data-tip="'+tipId+'">';
    if(rank!==undefined)hb+='<span style="font-size:9px;color:var(--cyan);font-weight:800;width:14px;text-align:right;flex-shrink:0">'+rank+'</span>';
    hb+='<span style="font-size:10px;color:var(--t2);width:60px;text-align:left;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(label)+'">'+escHtml(label)+'</span>';
    hb+='<div style="flex:1;height:14px;background:var(--bg2);border-radius:3px;overflow:hidden;display:flex">';
    if(gd.f>0)hb+='<div style="height:100%;width:'+Math.round(gd.f/total*pct)+'%;background:'+col+';transition:width 0.5s"></div>';
    if(gd.m>0)hb+='<div style="height:100%;width:'+Math.round(gd.m/total*pct)+'%;background:'+col+';opacity:0.35;transition:width 0.5s"></div>';
    const rest=pct-Math.round(gd.f/total*pct)-Math.round(gd.m/total*pct);
    if(rest>0&&total>gd.m+gd.f)hb+='<div style="height:100%;width:'+rest+'%;background:'+col+';opacity:0.6;transition:width 0.5s"></div>';
    hb+='</div>';
    hb+='<span style="font-size:10px;font-family:var(--fm);color:var(--t1);font-weight:700;min-width:24px">'+total+'</span>';
    /* 팝업 — 바 위에 표시, 가로 레이아웃 */
    hb+='<div id="'+tipId+'" style="'+_tipStyle+'">';
    hb+='<div style="display:flex;align-items:center;gap:8px">';
    hb+='<span style="font-weight:700;color:var(--t1)">'+escHtml(tipLabel||label)+'</span>';
    hb+='<span style="color:#10B981;font-weight:600">남:'+gd.m+'</span>';
    hb+='<span style="color:#38BDF8;font-weight:600">여:'+gd.f+'</span>';
    /* 성별 미기재가 섞여 있으면(총합 > 남+여) "남녀 미구분:N" 을 3번째로 표시 — 방문자 수와 안 맞다는 오해 방지. (2026-06-03) */
    var _uCnt=Math.max(0,(total||0)-(gd.m||0)-(gd.f||0));
    if(_uCnt>0)hb+='<span style="color:var(--t3);font-weight:600">남녀 미구분:'+_uCnt+'</span>';
    hb+='</div>';
    if(people&&people.length){
      hb+='<div style="display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:3px;padding-top:3px;border-top:1px solid var(--bdr);font-size:10px;font-family:var(--f);color:var(--t2)">';
      hb+=_peopleSpansHtml(people);
      hb+='</div>';
    }
    hb+='</div>';
    hb+='</div>';
    return hb;
  }

  /* ── 처치별 분포 + 투약 TOP10 한 행 ── */
  h+='<div style="display:flex;gap:12px;flex-wrap:wrap">';

  /* ▸ 처치별 분포 */
  h+='<div id="dashChartTreat" style="flex:1;min-width:180px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative;overflow:visible">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#F59E0B,#EF4444);border-radius:2px"></span>처치별 분포<span style="flex:1"></span>'+_copyBtnHtml('dashChartTreat','처치별 분포 복사됨')+'</div>';
  if(_treatSorted.length){
    _treatSorted.forEach(function(t,i){
      const pct=Math.max(8,Math.round(t[1]/_treatMax*100));
      const col=_dashDeptColors[i%_dashDeptColors.length];
      const gd=_treatGender[t[0]]||{m:0,f:0};
      const stu=S.statsPeriod==='today'?(_treatStudents[t[0]]||[]):null;
      h+=_genderBar(t[0],t[1],gd,col,pct,undefined,stu,'treat',i);
    });
  } else {h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:16px 0">데이터 없음</div>';}
  h+='</div>';

  /* ▸ 반별 방문 TOP — 처치와 투약 사이 */
  h+='<div id="dashChartClsTop" style="flex:1;min-width:180px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative;overflow:visible">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#F97316,#EF4444);border-radius:2px"></span>반별 방문 TOP '+_clsTopN+'<span style="flex:1"></span>'+_copyBtnHtml('dashChartClsTop','반별 TOP 복사됨')+'</div>';
  if(_clsSorted.length){
    /* 반별 성별 집계 */
    filtered.forEach(function(r){const s=getStu(r.studentId);if(!s||s.type==='staff'||!s.grade)return;const key=_isSpecial?((s.level||'')+'_'+s.grade+'_'+s.cls):(s.department?(s.department+'_'+s.grade+'_'+s.cls):(s.grade+'_'+s.cls));if(!_clsGenderMap[key])_clsGenderMap[key]={m:0,f:0};let g=s.gender;if(g==='M')g='남';else if(g==='F')g='여';if(g==='남')_clsGenderMap[key].m++;else if(g==='여')_clsGenderMap[key].f++;if(S.statsPeriod==='today'){if(!_clsStudents[key])_clsStudents[key]=[];_clsStudents[key].push({label:_stuInfoOf(r),recId:r.id,date:r.date,studentId:r.studentId});}});
    _clsSorted.forEach(function(c,i){
      const pct=Math.max(10,Math.round(c[1]/_clsMax*100));
      const col=_dashDeptColors[i%_dashDeptColors.length];
      const label=_clsLabelMap[c[0]]||c[0];
      const gd=_clsGenderMap[c[0]]||{m:0,f:0};
      const stu=S.statsPeriod==='today'?(_clsStudents[c[0]]||[]):null;
      /* 미니팝업에는 풀 라벨(학교급·학과 전체) 사용 (사용자 요청 2026-06-11) */
      h+=_genderBar(label,c[1],gd,col,pct,i+1,stu,'cls',i,_clsFullLabelMap[c[0]]||label);
    });
  } else {h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:16px 0">데이터 없음</div>';}
  h+='</div>';

  /* ▸ 투약 TOP10 */
  h+='<div id="dashChartTopMed" style="flex:1;min-width:180px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative;overflow:visible">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#10B981,#3B82F6);border-radius:2px"></span>투약 TOP 10<span style="flex:1"></span>'+_copyBtnHtml('dashChartTopMed','투약 TOP10 복사됨')+'</div>';
  if(_medSorted.length){
    _medSorted.forEach(function(m,i){
      const pct=Math.max(8,Math.round(m[1]/_medMax*100));
      const col=_dashDeptColors[i%_dashDeptColors.length];
      const gd=_medGender[m[0]]||{m:0,f:0};
      const stu=S.statsPeriod==='today'?(_medStudents[m[0]]||[]):null;
      h+=_genderBar(m[0],m[1],gd,col,pct,i+1,stu,'med',i);
    });
  } else {h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:16px 0">투약 데이터 없음</div>';}
  h+='</div>';

  h+='</div>';/* 처치+투약 행 끝 */
  h+='<div style="height:12px"></div>';

  /* (침상 이용 추이는 방문자 추이 옆에 배치됨) */

  /* ── 요일별 분포 + 증상 TOP10 한 행 ── */
  h+='<div style="display:flex;gap:12px;flex-wrap:wrap">';

  /* ▸ 요일별 분포 */
  h+='<div id="dashChartDow" style="flex:2;min-width:150px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative;overflow:visible;display:flex;flex-direction:column">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#3B82F6,#06B6D4);border-radius:2px"></span>요일별 분포<span style="flex:1"></span>'+_copyBtnHtml('dashChartDow','요일별 분포 복사됨')+'</div>';
  const _dowColors=['#EC4899','#06B6D4','#F97316','#14B8A6','#92400E'];
  const _dowKeys=['월','화','수','목','금'];
  const _dowFullNames={'월':'월요일','화':'화요일','수':'수요일','목':'목요일','금':'금요일'};
  if(_dowMax>0){
    h+='<div style="flex:0.3"></div>';
    _dowKeys.forEach(function(d,i){
      const cnt=_dowCount[d]||0;
      const pct=Math.max(8,Math.round(cnt/_dowMax*100));
      const gd=_dowGender[d]||{m:0,f:0};
      const stu=S.statsPeriod==='today'?(_dowStudents[d]||[]):null;
      h+=_genderBar(_dowFullNames[d],cnt,gd,_dowColors[i],pct,undefined,stu,'dow',i);
    });
  } else {h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:16px 0">데이터 없음</div>';}
  h+='</div>';

  /* ▸ 증상 TOP10 */
  h+='<div id="dashChartTopSym" style="flex:3;min-width:180px;border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative;overflow:visible">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#EC4899,#8B5CF6);border-radius:2px"></span>증상 TOP 10<span style="flex:1"></span>'+_copyBtnHtml('dashChartTopSym','증상 TOP10 복사됨')+'</div>';
  if(_symSorted.length){
    _symSorted.forEach(function(s,i){
      const pct=Math.max(8,Math.round(s[1]/_symMax*100));
      const col=_dashDeptColors[i%_dashDeptColors.length];
      const gd=_symGender[s[0]]||{m:0,f:0};
      const stu=S.statsPeriod==='today'?(_symStudents[s[0]]||[]):null;
      h+=_genderBar(s[0],s[1],gd,col,pct,i+1,stu,'sym',i);
    });
  } else {h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:16px 0">데이터 없음</div>';}
  h+='</div>';

  h+='</div>'; /* 3열 flex row 끝 */
  h+='<div style="height:12px"></div>';

  /* ▸ 재방문 학생 TOP 10 (오늘 탭 제외) */
  if(S.statsPeriod!=='today'){
    const _revisitCount={};
    filtered.forEach(function(r){
      const s=getStu(r.studentId);if(!s||s.type==='staff')return;
      _revisitCount[r.studentId]=(_revisitCount[r.studentId]||0)+1;
    });
    const _revisitSorted=Object.entries(_revisitCount).filter(function(e){return e[1]>=2;}).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    const _revisitMax=_revisitSorted.length?_revisitSorted[0][1]:1;
    if(_revisitSorted.length){
      h+='<div id="dashChartRevisit" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 16px 14px;position:relative">';
      h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:12px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#F43F5E,#FB923C);border-radius:2px"></span>재방문 '+(_isKinder?'원아':'학생')+' TOP 10 <span style="font-size:10px;color:var(--t3);font-weight:500">(2회 이상)</span><span style="flex:1"></span>'+_copyBtnHtml('dashChartRevisit','재방문 TOP 복사됨')+'</div>';
      h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px">';
      _revisitSorted.forEach(function(e,i){
        let s=getStu(e[0]);
        if(s.name==='?')s=getStu(Number(e[0]))||s;
        const name=(s&&s.name&&s.name!=='?')?s.name:'(삭제됨)';
        /* 학과 입력이 있으면 학과명 포함 (사용자 요청 2026-06-11. 예: 항공정비과 3학년 2반) */
        const grade=(s&&s.grade)?(((s.department&&String(s.department).trim())?String(s.department).trim()+' ':'')+s.grade+'학년 '+s.cls+'반'):'';
        const pct=Math.max(10,Math.round(e[1]/_revisitMax*100));
        const col=_dashDeptColors[i%_dashDeptColors.length];
        h+='<div style="display:flex;align-items:center;gap:6px">';
        h+='<span style="font-size:9px;color:var(--cyan);font-weight:800;width:14px;text-align:right;flex-shrink:0">'+(i+1)+'</span>';
        h+='<div style="flex-shrink:0;width:104px;overflow:hidden">';
        h+='<div style="font-size:10px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(name)+'</div>';
        h+='<div style="font-size:8px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+escHtml(grade)+'">'+escHtml(grade)+'</div>';
        h+='</div>';
        h+='<div style="flex:1;height:14px;background:var(--bg2);border-radius:3px;overflow:hidden;position:relative"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,'+col+','+col+'88);border-radius:3px;transition:width 0.5s"></div></div>';
        h+='<span style="font-size:11px;font-family:var(--fm);color:var(--t1);font-weight:800;min-width:28px;text-align:right">'+e[1]+'<span style="font-size:8px;color:var(--t3);font-weight:500">회</span></span>';
        h+='</div>';
      });
      h+='</div>';
      h+='</div>';
      h+='<div style="height:12px"></div>';
    }
  }

  /* (투약 TOP10은 처치별 분포 옆으로 이동됨) */

  /* TSV 저장: 처치별, 요일별, 증상TOP10, 투약TOP10 */
  _dashChartTsvData['dashChartTreat']=(_treatSorted.length?'처치\t건수\n'+_treatSorted.map(function(t){return t[0]+'\t'+t[1];}).join('\n'):'');
  _dashChartTsvData['dashChartDow']='요일\t'+_dowKeys.join('\t')+'\n건수\t'+_dowKeys.map(function(d){return _dowCount[d]||0;}).join('\t');
  _dashChartTsvData['dashChartTopSym']=(_symSorted.length?'순위\t증상\t건수\n'+_symSorted.map(function(s,i){return(i+1)+'\t'+s[0]+'\t'+s[1];}).join('\n'):'');
  _dashChartTsvData['dashChartTopMed']=(_medSorted.length?'순위\t투약\t건수\n'+_medSorted.map(function(m,i){return(i+1)+'\t'+m[0]+'\t'+m[1];}).join('\n'):'');

  /* ══════════════════════════════════════════════════════════════
     신규 차트 5: 남녀별 증상 차이 (나비형 차트)
     ══════════════════════════════════════════════════════════════ */
  const _mSymCount={}, _fSymCount={};
  const _femaleOnlySym=['생리통','생리불순'];
  filtered.forEach(function(r){
    const s=getStu(r.studentId);if(!s||s.type==='staff')return;
    let g=s.gender;if(g==='M')g='남';else if(g==='F')g='여';
    r.symptoms.forEach(function(sym0){
      const sym=_aliasSym(sym0);   /* 별칭 승계 (2026-06-12) */
      if(g==='남'){
        if(_femaleOnlySym.indexOf(sym)===-1)_mSymCount[sym]=(_mSymCount[sym]||0)+1;
      } else if(g==='여'){
        _fSymCount[sym]=(_fSymCount[sym]||0)+1;
      }
    });
  });
  const _gSymAll={};Object.keys(_mSymCount).forEach(function(k){_gSymAll[k]=true;});Object.keys(_fSymCount).forEach(function(k){_gSymAll[k]=true;});
  const _gSymSorted=Object.keys(_gSymAll).sort(function(a,b){return((_mSymCount[b]||0)+(_fSymCount[b]||0))-((_mSymCount[a]||0)+(_fSymCount[a]||0));}).slice(0,12);
  let _gSymMax=1;_gSymSorted.forEach(function(k){const m=_mSymCount[k]||0, f=_fSymCount[k]||0;if(m>_gSymMax)_gSymMax=m;if(f>_gSymMax)_gSymMax=f;});

  h+='<div id="dashChartGenderSym" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 16px 14px;position:relative">';
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#10B981,#38BDF8);border-radius:2px"></span>남여 증상 비교<span style="flex:1"></span>'+_copyBtnHtml('dashChartGenderSym','남녀 증상 비교 복사됨')+'</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:12px">상위 12개 증상의 성별 분포를 비교합니다.</div>';
  /* 범례 */
  h+='<div style="display:flex;gap:16px;justify-content:center;margin-bottom:10px">';
  h+='<span style="font-size:10px;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#10B981"></span><span style="color:var(--t2);font-weight:600">남학생</span></span>';
  h+='<span style="font-size:10px;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#38BDF8"></span><span style="color:var(--t2);font-weight:600">여학생</span></span>';
  h+='</div>';
  if(_gSymSorted.length){
    _gSymSorted.forEach(function(sym,i){
      const mV=_mSymCount[sym]||0, fV=_fSymCount[sym]||0;
      const mPct=Math.max(2,Math.round(mV/_gSymMax*100));
      const fPct=Math.max(2,Math.round(fV/_gSymMax*100));
      h+='<div style="display:flex;align-items:center;gap:0;margin-bottom:3px;height:22px">';
      /* 왼쪽 남학생 (오른쪽 정렬 바) */
      h+='<div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:4px">';
      h+='<span style="font-size:9px;font-family:var(--fm);color:#10B981;font-weight:700">'+mV+'</span>';
      h+='<div style="width:'+mPct+'%;max-width:100%;height:16px;background:linear-gradient(270deg,#10B981,#10B98166);border-radius:3px 0 0 3px;transition:width 0.5s"></div>';
      h+='</div>';
      /* 중앙 라벨 */
      h+='<div style="width:72px;text-align:center;font-size:10px;color:var(--t1);font-weight:600;flex-shrink:0;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+sym+'</div>';
      /* 오른쪽 여학생 (왼쪽 정렬 바) */
      h+='<div style="flex:1;display:flex;align-items:center;gap:4px">';
      h+='<div style="width:'+fPct+'%;max-width:100%;height:16px;background:linear-gradient(90deg,#38BDF8,#38BDF866);border-radius:0 3px 3px 0;transition:width 0.5s"></div>';
      h+='<span style="font-size:9px;font-family:var(--fm);color:#38BDF8;font-weight:700">'+fV+'</span>';
      h+='</div>';
      h+='</div>';
    });
  } else {h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:20px 0">데이터 없음</div>';}
  h+='</div>';
  h+='<div style="height:12px"></div>';

  /* ══════════════════════════════════════════════════════════════
     신규 차트 6: 계절별 질환 트렌드
     ══════════════════════════════════════════════════════════════ */
  const _seasonDef={
    '봄 (3~5월)':{months:[3,4,5],color:'#22C55E',icon:'🌸'},
    '여름 (6~8월)':{months:[6,7,8],color:'#F59E0B',icon:'☀️'},
    '가을 (9~11월)':{months:[9,10,11],color:'#F97316',icon:'🍂'},
    '겨울 (12~2월)':{months:[12,1,2],color:'#3B82F6',icon:'❄️'}
  };
  const _seasonKeys=Object.keys(_seasonDef);
  const _seasonSym={};const _seasonSymGender={};
  _seasonKeys.forEach(function(sk){_seasonSym[sk]={};_seasonSymGender[sk]={};});
  const _yearStart=new Date().getFullYear();
  const _seasonRecords=S.records.filter(function(r){const y=parseInt(r.date.substring(0,4),10);return y>=_yearStart-1;});
  _seasonRecords.forEach(function(r){
    const m=parseInt(r.date.substring(5,7),10);
    const g=_genderOf(r);
    _seasonKeys.forEach(function(sk){
      if(_seasonDef[sk].months.indexOf(m)!==-1){
        r.symptoms.forEach(function(sym0){
          const sym=_aliasSym(sym0);   /* 별칭 승계 (2026-06-12) */
          _seasonSym[sk][sym]=(_seasonSym[sk][sym]||0)+1;
          if(!_seasonSymGender[sk][sym])_seasonSymGender[sk][sym]={m:0,f:0};
          if(g==='남')_seasonSymGender[sk][sym].m++;else if(g==='여')_seasonSymGender[sk][sym].f++;
        });
      }
    });
  });

  h+='<div id="dashChartSeason" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 16px 14px;position:relative">';
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#22C55E,#3B82F6);border-radius:2px"></span>계절별 질환 트렌드<span style="flex:1"></span>'+_copyBtnHtml('dashChartSeason','계절별 트렌드 복사됨')+'</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:14px">최근 2년간 데이터 기반 계절별 상위 5개 증상</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">';
  _seasonKeys.forEach(function(sk){
    const def=_seasonDef[sk];
    const symSorted=Object.entries(_seasonSym[sk]).sort(function(a,b){return b[1]-a[1];}).slice(0,5);
    const sMax=symSorted.length?symSorted[0][1]:1;
    let sTotal=0;symSorted.forEach(function(e){sTotal+=e[1];});
    h+='<div style="background:'+def.color+'0a;border:1px solid '+def.color+'33;border-radius:10px;padding:12px 10px;position:relative;overflow:hidden">';
    /* 배경 아이콘 */
    h+='<div style="position:absolute;right:-4px;top:-8px;font-size:42px;opacity:0.07;pointer-events:none">'+def.icon+'</div>';
    h+='<div style="font-size:12px;font-weight:800;color:'+def.color+';margin-bottom:8px;display:flex;align-items:center;gap:4px">'+def.icon+' '+sk+'</div>';
    if(symSorted.length){
      symSorted.forEach(function(e,i){
        const pct=Math.max(8,Math.round(e[1]/sMax*100));
        const sgd=(_seasonSymGender[sk]||{})[e[0]]||{m:0,f:0};
        const fPct=e[1]>0?Math.round(sgd.f/e[1]*pct):0;
        const mPct=e[1]>0?Math.round(sgd.m/e[1]*pct):0;
        h+='<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">';
        h+='<span style="font-size:8px;color:'+def.color+';font-weight:800;width:10px;text-align:right;flex-shrink:0">'+(i+1)+'</span>';
        h+='<span style="font-size:9px;color:var(--t2);width:48px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+e[0]+'</span>';
        h+='<div style="flex:1;height:10px;background:var(--bg2);border-radius:2px;overflow:hidden;display:flex">';
        if(sgd.f>0)h+='<div style="height:100%;width:'+fPct+'%;background:'+def.color+'"></div>';
        if(sgd.m>0)h+='<div style="height:100%;width:'+mPct+'%;background:'+def.color+';opacity:0.35"></div>';
        h+='</div>';
        h+='<span style="font-size:9px;font-family:var(--fm);color:var(--t1);font-weight:700;min-width:18px;text-align:right">'+e[1]+'</span>';
        h+='</div>';
      });
    } else {h+='<div style="text-align:center;color:var(--t3);font-size:10px;padding:10px 0">데이터 없음</div>';}
    h+='</div>';
  });
  h+='</div>';
  h+='</div>';
  h+='<div style="height:12px"></div>';

  h+='</div>'; /* dashChartArea 끝 */

  /* ══ 요보호 대상 학생 현황 (기간선택 제외) ══ */
  if(S.statsPeriod!=='custom'){
    const _careStudents=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch')&&!!(s.condition||(s.careMemo&&s.careMemo.trim&&s.careMemo.trim()));});
    /* 학년별 요보호 카운트 */
    const _careByGrade=[];
    gradeItems.forEach(function(gi){
      let cnt=0;
      _careStudents.forEach(function(s){
        const g=parseInt(s.grade,10)||0;
        if(_isSpecial){if((s.level||'')===gi.level&&g===gi.grade)cnt++;}
        else if(_isMulti){if(getLevelShort(s)===gi.level&&g===gi.grade)cnt++;}
        else{if(g===gi.grade)cnt++;}
      });
      _careByGrade.push({item:gi,count:cnt});
    });
    const _careTotal=_careStudents.length;
    const _careGradeCount=gradeItems.length+1;
    const _careSz=Math.max(80,Math.min(150,Math.round(700/_careGradeCount)));

    h+='<div id="dashChartCare" style="border:1.5px dashed var(--bdr);border-radius:12px;padding:14px 12px 10px;position:relative;margin-top:12px">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:12px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:4px;height:16px;background:linear-gradient(180deg,#EF4444,#94A3B8);border-radius:2px"></span>요보호 대상 '+(_isKinder?'원아':'학생')+' 현황 <span style="font-size:10px;color:var(--t3);font-weight:500">(총 '+_careTotal+'명)</span><span style="flex:1"></span>'+_copyBtnHtml('dashChartCare','요보호 현황 복사됨')+'</div>';
    /* 다중 학교급(특수학교·복합학교) 인 경우 학교급별로 행 분할.
       단일 학교급(일반 학교)은 한 줄에 모두 배치. */
    const _careGroupByLv=(_isSpecial||_isMulti);
    const _careGroups=[];
    if(_careGroupByLv){
      const _seenLv={};
      _careByGrade.forEach(function(cg){
        const lv=cg.item.level||'';
        if(!_seenLv[lv]){_seenLv[lv]=[]; _careGroups.push({level:lv, items:_seenLv[lv]});}
        _seenLv[lv].push(cg);
      });
    } else {
      _careGroups.push({level:'', items:_careByGrade});
    }
    /* ▶ 학교급별 한 줄에 — 각 행 끝에 그 학교급의 ▶ 전체 도넛 */
    let _careTipSeq=0;
    _careGroups.forEach(function(grp,gi){
      h+='<div style="display:flex;flex-wrap:wrap;justify-content:space-evenly;align-items:flex-start;'+(gi>0?'margin-top:14px;padding-top:10px;border-top:1px dashed var(--bdrl);':'')+'">';
      let _grpCareTotal=0;
      let _grpAllStu=0;
      grp.items.forEach(function(cg){
        const grStu=S.people.filter(function(s){
          if(s.type!=='student')return false;
          const g=parseInt(s.grade,10)||0;
          if(_isSpecial)return(s.level||'')===cg.item.level&&g===cg.item.grade;
          if(_isMulti)return getLevelShort(s)===cg.item.level&&g===cg.item.grade;
          return g===cg.item.grade;
        });
        const total_stu=grStu.length;
        const normalCnt=total_stu-cg.count;
        _grpCareTotal+=cg.count; _grpAllStu+=total_stu;
        let _careMale=0, _careFemale=0;
        _careStudents.forEach(function(s){
          const g2=parseInt(s.grade,10)||0;
          const match=_isSpecial?((s.level||'')===cg.item.level&&g2===cg.item.grade):(_isMulti?(getLevelShort(s)===cg.item.level&&g2===cg.item.grade):(g2===cg.item.grade));
          if(match){let gn=s.gender;if(gn==='M')gn='남';else if(gn==='F')gn='여';if(gn==='남')_careMale++;else if(gn==='여')_careFemale++;}
        });
        const data=[{label:'요보호',count:cg.count,color:'#EF4444'},{label:'일반',count:Math.max(0,normalCnt),color:'#94A3B8'}];
        const _careTipId='careTip_'+(_careTipSeq++);
        h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;position:relative;cursor:default" data-tip="'+_careTipId+'">';
        h+=_donutSvg(data,_careSz,cg.count);
        h+='<span style="font-size:10px;color:var(--t2);font-weight:600">'+cg.item.label+'</span>';
        h+='<div id="'+_careTipId+'" style="display:none;position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;z-index:20;font-size:10px;font-family:var(--f);line-height:1.5;pointer-events:none">';
        h+='<div style="display:flex;align-items:center;gap:8px"><span style="font-weight:700;color:var(--t1)">'+cg.item.label+' 요보호</span><span style="color:#10B981;font-weight:600">남:'+_careMale+'</span><span style="color:#38BDF8;font-weight:600">여:'+_careFemale+'</span></div>';
        h+='</div>';
        h+='</div>';
      });
      /* 학교급별 ▶ 행 합계 도넛 (다중 학교급에서만 의미 있음) */
      if(_careGroupByLv){
        const _grpNormal=_grpAllStu-_grpCareTotal;
        const _grpData=[{label:'요보호',count:_grpCareTotal,color:'#EF4444'},{label:'일반',count:Math.max(0,_grpNormal),color:'#94A3B8'}];
        const _lvLabel=({'유':'유치원','초':'초등학교','중':'중학교','고':'고등학교','대':'대학교','특':'특수학교','kindergarten':'유치원','elementary':'초등학교','middle':'중학교','high':'고등학교','university':'대학교','special':'특수학교'})[grp.level]||grp.level||'';
        h+='<div style="display:flex;align-items:center;align-self:center;color:var(--t3);font-size:16px;margin:0 4px">▶</div>';
        h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px">';
        h+=_donutSvg(_grpData,_careSz,_grpCareTotal);
        h+='<span style="font-size:10px;color:var(--cyan);font-weight:700">'+escHtml(_lvLabel||'전체')+'</span>';
        h+='</div>';
      }
      h+='</div>';
    });
    /* ▶ 전체 (모든 학교급 합) — 별도 마지막 줄. 가운데 정렬 + 1.4배 큰 도넛 */
    const _careAllStu=S.people.filter(function(s){return s.type==='student';}).length;
    const _careNormal=_careAllStu-_careTotal;
    const _careAllData=[{label:'요보호',count:_careTotal,color:'#EF4444'},{label:'일반',count:Math.max(0,_careNormal),color:'#94A3B8'}];
    const _bigCareSz=Math.round(_careSz*1.4);
    h+='<div style="display:flex;justify-content:center;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid var(--bdr);gap:10px">';
    h+='<span style="font-size:12px;font-weight:700;color:var(--t2)">전체 합계</span>';
    h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px">';
    h+=_donutSvg(_careAllData,_bigCareSz,_careTotal);
    h+='<span style="font-size:11px;color:var(--cyan);font-weight:700">전체</span>';
    h+='</div>';
    h+='</div>';
    /* 범례 */
    h+='<div style="margin-top:10px">'+_donutLegendInline([{label:'요보호',count:_careTotal,color:'#EF4444'},{label:'일반',count:_careNormal,color:'#94A3B8'}])+'</div>';
    h+='</div>';
  }

  /* ── 각 차트의 TSV 데이터 저장 (엑셀/구글시트 붙여넣기용) ── */
  /* 진료과별 */
  const _dTsv=sorted.map(function(dk){return dk;}).join('\t')+'\n'+sorted.map(function(dk){return counts[dk]||0;}).join('\t');
  _dashChartTsvData['dashChartDept']=_dTsv;
  /* 학년별 */
  const _gTsv=gradeItems.map(function(gi){return gi.label;}).join('\t')+'\n'+gradeItems.map(function(gi){return gradeCount[gi.key]||0;}).join('\t');
  _dashChartTsvData['dashChartGrade']=_gTsv;
  /* 남/여 학생별 */
  const _gnH=[''].concat(gradeItems.map(function(gi){return gi.label;})).concat(['전체']).join('\t');
  const _gnM=['남학생'].concat(_genderByGrade.map(function(g){return g.male;})).concat([_totalMale]).join('\t');
  const _gnF=['여학생'].concat(_genderByGrade.map(function(g){return g.female;})).concat([_totalFemale]).join('\t');
  const _gnP=['비율(남%)'].concat(_genderByGrade.map(function(g){const t=g.male+g.female;return t>0?(g.male/t*100).toFixed(1)+'%':'0%';})).concat([(_totalMale+_totalFemale>0?(_totalMale/(_totalMale+_totalFemale)*100).toFixed(1)+'%':'0%')]).join('\t');
  _dashChartTsvData['dashChartGender']=_gnH+'\n'+_gnM+'\n'+_gnF+'\n'+_gnP;
  /* 학생/교직원 */
  _dashChartTsvData['dashChartRole']='구분\t건수\t비율\n학생\t'+_stuCount+'\t'+(_stuCount+_staffCount>0?(_stuCount/(_stuCount+_staffCount)*100).toFixed(1)+'%':'0%')+'\n교직원\t'+_staffCount+'\t'+(_stuCount+_staffCount>0?(_staffCount/(_stuCount+_staffCount)*100).toFixed(1)+'%':'0%');

  panel.innerHTML=h;
  _dashBindPanelDelegation(panel);
  /* 커스텀 스크롤바 동기화 */
  setTimeout(function(){
    const wrap=panel.querySelector('.cls-scroll-wrap');
    if(!wrap)return;
    const area=wrap.querySelector('.cls-scroll-area');
    const barWrap=wrap.querySelector('.cls-scroll-bar');
    const thumb=wrap.querySelector('.cls-scroll-bar-thumb');
    if(!area||!barWrap||!thumb)return;
    function _syncBar(){
      const inner=area.firstElementChild;if(!inner)return;
      const ratio=area.clientWidth/inner.scrollWidth;
      if(ratio>=1){barWrap.style.display='none';return;}
      barWrap.style.display='';
      thumb.style.width=(ratio*100)+'%';
      thumb.style.left=(area.scrollLeft/inner.scrollWidth*100)+'%';
    }
    _syncBar();
    area.addEventListener('scroll',_syncBar);
    new ResizeObserver(_syncBar).observe(area);
  },100);
}
/* 차트/표 → 클립보드 복사 */
let _dashChartTsvData={}; /* 통계표용 TSV 데이터 저장 */
/* ── 차트/표 이미지 캡처 → 클립보드 (숨겨진 윈도우, 인라인 스타일) ── */
function _dashCopyElement(el,toast){
  if(!el)return;
  if(!window.electronAPI||!window.electronAPI.captureElement){
    _toast('이미지 복사는 데스크톱 앱에서만 지원됩니다');return;
  }
  /* 모든 요소에 computed style 인라인 적용 */
  function _inlineAll(src,dst){
    if(src.nodeType!==1)return;
    const cs=getComputedStyle(src);
    const props=['color','background-color','background','background-image','font-family','font-size','font-weight',
      'line-height','letter-spacing','text-align','text-shadow','padding','margin','border','border-color',
      'border-width','border-style','border-radius','border-collapse','border-spacing',
      'display','flex-direction','flex-wrap','flex','flex-grow','flex-shrink','flex-basis',
      'align-items','justify-content','gap','column-gap','row-gap',
      'width','height','min-width','max-width','min-height','max-height',
      'overflow','overflow-x','overflow-y','opacity','box-shadow','white-space','text-overflow',
      'position','top','left','right','bottom','writing-mode','vertical-align',
      'fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','paint-order',
      '-webkit-text-stroke','text-decoration','transform'];
    props.forEach(function(p){try{const v=cs.getPropertyValue(p);if(v)dst.style.setProperty(p,v);}catch(e){}});
    for(let i=0;i<src.children.length&&i<dst.children.length;i++){
      _inlineAll(src.children[i],dst.children[i]);
    }
  }
  const clone=el.cloneNode(true);
  clone.querySelectorAll('button').forEach(function(b){b.remove();});
  clone.querySelectorAll('.cls-scroll-bar').forEach(function(b){b.remove();});
  const btns=el.querySelectorAll('button');
  btns.forEach(function(b){b.style.display='none';});
  _inlineAll(el,clone);
  btns.forEach(function(b){b.style.display='';});
  clone.style.border='none';clone.style.borderRadius='0';
  clone.style.margin='0';clone.style.position='static';
  /* 스크롤 영역 → 전체 표시 (_inlineAll 이후에 덮어쓰기) */
  clone.querySelectorAll('.cls-scroll-area').forEach(function(a){
    a.style.overflow='visible';a.style.maxWidth='none';a.style.width='auto';
  });
  clone.querySelectorAll('.cls-scroll-area > div').forEach(function(d){
    d.style.minWidth='auto';d.style.width='auto';
  });
  /* SVG 내부 텍스트에도 font-family 적용 */
  clone.querySelectorAll('text').forEach(function(t){
    if(!t.style.fontFamily)t.style.fontFamily='-apple-system,BlinkMacSystemFont,sans-serif';
  });
  const isLight=document.body.classList.contains('light');
  const captureBg=isLight?'#ffffff':'#181c24';
  const cs=getComputedStyle(el);
  /* 범례를 캡처 전체 너비에 맞춰 중앙 정렬 */
  clone.querySelectorAll('.cls-gender-legend').forEach(function(lg){
    lg.style.position='relative';lg.style.width='100%';lg.style.display='flex';lg.style.justifyContent='center';
  });
  const html='<div style="background:'+captureBg+';padding:'+cs.paddingTop+' '+cs.paddingRight+' '+cs.paddingBottom+' '+cs.paddingLeft+'">'+clone.innerHTML+'</div>';
  /* 스크롤 내부 콘텐츠의 실제 전체 너비 계산 */
  let _captureW=el.scrollWidth;
  const _scrollInner=el.querySelector('.cls-scroll-area > div');
  if(_scrollInner&&_scrollInner.scrollWidth>_captureW)_captureW=_scrollInner.scrollWidth+40;
  window.electronAPI.captureElement({
    html:html,
    width:_captureW,
    height:el.scrollHeight
  }).then(function(res){
    if(res&&res.success) _toast(toast||'이미지로 복사되었습니다');
    else _toast('캡처 실패: '+(res&&res.error||''));
  }).catch(function(){_toast('캡처 실패');});
}
/* ── 통계표 텍스트 → 클립보드 (엑셀/구글시트 붙여넣기용) ── */
function _dashCopyTableData(elId,toast){
  const tsv=_dashChartTsvData[elId];
  if(!tsv){_toast('복사할 데이터가 없습니다');return;}
  const rows=tsv.split('\n');
  let html='<table>';
  rows.forEach(function(row,ri){
    html+='<tr>';row.split('\t').forEach(function(cell){html+='<'+(ri===0?'th':'td')+'>'+cell+'</'+(ri===0?'th':'td')+'>';});
    html+='</tr>';
  });
  html+='</table>';
  if(window.electronAPI&&window.electronAPI.clipboardWriteHtml){
    window.electronAPI.clipboardWriteHtml(html,tsv);
    _toast(toast||'클립보드에 복사되었습니다 (엑셀 붙여넣기 가능)');
  } else {
    const ta=document.createElement('textarea');
    ta.value=tsv;ta.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(ta);ta.select();
    document.execCommand('copy');document.body.removeChild(ta);
    _toast(toast||'텍스트로 복사되었습니다');
  }
}
/* 개별 섹션 복사 */
function _dashCopySummary(){_dashCopyElement(document.getElementById('dashPanelSummary'),'요약 복사됨');}
function _dashCopyDeptStats(){_dashCopyElement(document.getElementById('dashPanelDeptStats'),'통계표 복사됨');}
function _dashCopyChart(){_dashCopyElement(document.getElementById('dashChartArea'),'차트 복사됨');}
/* 전체 차트 영역 */
function _dashChartCopyImg(){_dashCopyChart();}
function _dashChartPng(){_deptStatsPng();}
function _dashChartPdf(){_deptStatsPdf();}

/* ── 해당 기간 통계 & 시각화차트 전체 PDF 저장 ── */
export function _dashExportFullPDF(){
  const content=document.getElementById('dashContentArea');
  if(!content){_toast('대시보드 콘텐츠가 없습니다.');return;}
  const rangeLabel=_dashRangeLabel()||'통계';
  const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)?S.settings.schoolName:'';
  /* 실제 선택 기간(시작~종료) — _dashGetDateRange 는 기간 종류(custom 포함) 무관하게 from/to 반환(통계 집계와 동일 소스).
   * _dashRangeLabel 이 custom 등에서 빈값→'통계' 폴백되어 PDF 에 날짜가 안 나오고 파일명이 '_통계_통계' 되던 문제 대응 (2026-08-12). */
  const _pdfRange=_dashGetDateRange();
  const _dotYmd=function(ymd){ if(!ymd)return ''; const p=String(ymd).split('-'); return p.length>=3?(parseInt(p[0],10)+'.'+parseInt(p[1],10)+'.'+parseInt(p[2],10)+'.'):String(ymd); };
  const _hasRange=!!(_pdfRange&&_pdfRange.from&&_pdfRange.to);
  const _metaLabel=_hasRange?(_dotYmd(_pdfRange.from)+' ~ '+_dotYmd(_pdfRange.to)):rangeLabel;   /* PDF 헤더 표시용 */
  const _pdfRangeText=_hasRange?(_dotYmd(_pdfRange.from)+'-'+_dotYmd(_pdfRange.to)):'';           /* 파일명용 */
  const _pdfFileName=((schoolName?schoolName+' ':'')+'방문 통계'+(_pdfRangeText?' ('+_pdfRangeText+')':'')).replace(/[\\/:*?"<>|]/g,'_')+'.pdf';
  /* PDF 캡처 전 현재 선택(하이라이트)을 해제 — 히트맵 글자 블록 현상 방지 */
  try{const sel=window.getSelection&&window.getSelection();if(sel)sel.removeAllRanges();}catch(e){}
  /* 표지(1페이지)용 총 방문 요약 — 대시보드 요약과 동일한 DB 집계 캐시 사용 */
  const _sc=_dashStatsCache||{};
  const _summaryLine='총 방문 '+(_sc.total||0)+'건 │ 학생 '+(_sc.studentTotal||0)+'건 교직원 '+(_sc.staffTotal||0)+'건';
  /* 본문(2페이지~)은 진료과별 통계 + 시각화 차트 패널만 담는다. 헤더 행·기간선택 UI·요약칩(표지로 이동)은 제외.
   * (기존엔 dashContentArea 전체를 클론해 '📅 기간 선택'·날짜입력 등 UI 잔재가 표지에 섞이고 표가 밀리던 문제) 사용자 요청 2026-08-12. */
  const _bodyHtml=['dashPanelDeptStats','dashPanelDeptChart'].map(function(id){
    const el=document.getElementById(id); if(!el)return '';
    const c=el.cloneNode(true);
    c.querySelectorAll('button,.dash-nav-arrow,[data-action],.dash-pdf-omit').forEach(function(x){x.remove();});
    c.querySelectorAll('[style*="sticky"]').forEach(function(x){x.style.position='static';});
    c.querySelectorAll('[style]').forEach(function(x){
      const s=x.getAttribute('style')||'';
      if(s.indexOf('overflow')!==-1){ x.setAttribute('style', s.replace(/overflow[-a-z]*\s*:\s*[^;]+;?/gi,'').replace(/scrollbar[a-z-]*\s*:\s*[^;]+;?/gi,'')); x.style.overflow='visible'; }
    });
    return c.outerHTML;
  }).join('');
  const htmlStr='<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    +'@page{size:A4 landscape;margin:10mm}'
    +'html,body{margin:0;padding:0}'
    /* 표 잘림 방지 — 모든 열이 페이지 폭 안에 들어오도록 강제(내용은 줄바꿈으로 접힘). 오른쪽 잘림 사고 대응 (사용자 요청 2026-08-12) */
    +'body{width:auto!important}'
    +'table{width:100%!important;max-width:100%!important}'
    +'th,td{white-space:normal!important;word-break:break-word!important;overflow-wrap:anywhere!important}'
    +'body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","맑은 고딕",sans-serif;color:#1a1a2e;font-size:11px;line-height:1.6}'
    /* 큰 패널·표는 페이지 경계를 넘어 이어지게(avoid 제거) — 표가 통째로 다음 페이지로 밀려 1페이지에 여백이 크게 남던 문제 해결.
     * 단 행(tr)과 차트(svg/canvas)는 아래에서 계속 분리 방지 유지 (사용자 요청 2026-08-12). */
    +'.cc{border:1px solid #d1d5db;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff}'
    +'.dash-panel{margin-bottom:10px}'
    +'table{width:100%;border-collapse:collapse;font-size:10px}'
    +'tr{page-break-inside:avoid;break-inside:avoid}'
    +'th,td{border:1px solid #ccc;padding:4px 6px}'
    +'th{background:#f0f2f5;font-weight:600}'
    /* PDF 내 스크롤바 완전 제거 + 선택 하이라이트 제거 */
    +'*{overflow:visible!important;scrollbar-width:none!important}'
    +'*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}'
    +'*::selection,*::-moz-selection{background:transparent!important;color:inherit!important}'
    +'*{-webkit-user-select:none!important;user-select:none!important;-webkit-tap-highlight-color:transparent!important}'
    /* 시각화 차트 보호: 잘리지 않도록 강제 */
    +'svg,canvas,img{max-width:100%;height:auto;page-break-inside:avoid;break-inside:avoid}'
    +'[id*="chart" i],[id*="Chart"],[class*="chart" i],[class*="Chart"],'
    +'[id*="heatmap" i],[class*="heatmap" i],'
    +'[id*="pie" i],[class*="pie" i],'
    +'[id*="bar" i],[class*="bar" i],'
    +'[id*="graph" i],[class*="graph" i]{page-break-inside:avoid;break-inside:avoid}'
    +'.chart-container,.chart-wrap,.chart-box,.viz,.visualization{page-break-inside:avoid;break-inside:avoid}'
    +'h1,h2,h3,h4,h5,h6{page-break-after:avoid;break-after:avoid;page-break-inside:avoid;break-inside:avoid}'
    /* 스크롤 영역의 실제 스타일도 리셋 */
    +'[style*="overflow"],[style*="overflow-x"],[style*="overflow-y"]{overflow:visible!important}'
    /* 히트맵 텍스트 블록 처리(범위 선택 하이라이트) 방지 */
    +'.heatmap,[class*="heatmap"] *,[id*="heatmap"] *{background-image:none!important;-webkit-user-select:none!important;user-select:none!important}'
    /* 제목 위·아래 색상바 (보건일지 PDF / Excel 표지와 동일 팔레트) */
    +'.dash-pdf-title{margin-bottom:14pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.dash-pdf-bar{display:flex;height:6pt;overflow:hidden}'
    +'.dash-pdf-bar.top .b1{flex:7;background:#2855A0}.dash-pdf-bar.top .b2{flex:3;background:#D4A843}'
    +'.dash-pdf-bar.bot .b3{flex:3;background:#2E8B57}.dash-pdf-bar.bot .b4{flex:7;background:#C0392B}'
    +'.dash-pdf-heading{background:#F7F7F7;text-align:center;padding:10pt 0;font-size:20pt;font-weight:bold;letter-spacing:8pt}'
    +'.dash-pdf-meta{text-align:center;font-size:10.5pt;color:#475569;margin-top:6pt}'
    +'.dash-pdf-summary{text-align:center;font-size:13pt;font-weight:700;color:#1a1a2e;margin-top:16pt}'
    +'</style></head><body>'
    +'<div class="dash-pdf-title" style="page-break-after:always;break-after:page;min-height:96vh;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;margin-bottom:0">'   /* 표지 = 1페이지, 내용은 페이지 세로 중앙 정렬(빈 2페이지 방지 위해 96vh), 진료과 통계는 2페이지부터 (사용자 요청 2026-08-12) */
    +'<div class="dash-pdf-bar top"><span class="b1"></span><span class="b2"></span></div>'
    +'<div class="dash-pdf-heading">'+(schoolName?schoolName+' 보건실 통계':'보건실 통계')+'</div>'
    +'<div class="dash-pdf-bar bot"><span class="b3"></span><span class="b4"></span></div>'
    +'<div class="dash-pdf-meta">'+_metaLabel+'</div>'
    +'<div class="dash-pdf-summary">'+_summaryLine+'</div>'
    +'</div>'
    +_bodyHtml
    +'</body></html>';
  if(window.electronAPI&&window.electronAPI.printToPDF){
    window.electronAPI.printToPDF(htmlStr,{fileName:_pdfFileName,landscape:true}).then(function(res){
      if(res&&res.success)_toast('PDF가 저장되었습니다.');
      else _toast('PDF 저장 실패: '+(res&&res.error||'알 수 없는 오류'));
    }).catch(function(e){_toast('PDF 저장 실패: '+e.message);});
  }else{
    _toast('PDF 저장 기능을 사용할 수 없습니다.');
  }
}

function _dashOpenDeptStats(){
  const existing=document.getElementById('deptStatsOverlay');if(existing)existing.remove();
  const filtered=getFilteredRecords();
  /* 진료과 카테고리 매핑 */
  const deptCats=_dashDeptCats14();
  const deptKeys=Object.keys(deptCats);

  /* 기간에 맞는 단위로 집계 */
  let _deptTimeUnit='month'; /* day, month */
  if(S.statsPeriod==='today'||S.statsPeriod==='week') _deptTimeUnit='day';
  else _deptTimeUnit='month'; /* month, semester, year */

  const months={};
  filtered.forEach(function(r){
    const key=_deptTimeUnit==='day'?r.date:r.date.substring(0,7);
    if(!months[key])months[key]={};
    r.symptoms.forEach(function(sym){
      deptKeys.forEach(function(dk){
        if(deptCats[dk].indexOf(sym)!==-1){
          if(!months[key][dk])months[key][dk]=0;
          months[key][dk]++;
        }
      });
    });
  });
  let monthList=Object.keys(months).sort();
  if(!monthList.length) monthList=[_deptTimeUnit==='day'?toDateStr(new Date()):toDateStr(new Date()).substring(0,7)];
  const _deptPeriodTitle={today:'일간',week:'주간',month:'월간',semester:'학기간',year:'연간',custom:'선택 기간'};
  const _deptColLabel=_deptTimeUnit==='day'?'일자':'월';
  const _deptUnitLabel=_deptTimeUnit==='day'?'일별통계':'월별통계';

  /* 이전 기간 데이터 (증감 비교용) */
  let prevFiltered=[];
  if(S.statsPeriod!=='today'&&S.statsPeriod!=='custom'){
    const prevIdx=S._dashSubIdx+1;const prevTabs=_dashGetSubTabs();
    if(prevIdx<prevTabs.length){const saved=S._dashSubIdx;S._dashSubIdx=prevIdx;prevFiltered=getFilteredRecords();S._dashSubIdx=saved;}
  }
  const cmpLabels={week:'지난 주 대비',month:'지난 달 대비',semester:'지난 학기 대비'};
  const cmpLabel=cmpLabels[S.statsPeriod]||'';

  /* 전년동기 데이터 (현재 시점까지 정확히 자름) */
  const yoyFiltered=_getYoyFiltered();

  /* 학생/교직원 분리 집계 */
  function buildTable(title,recs,prevRecs,showGender,yoyRecs){
    /* 성별 분리 집계 함수 */
    function countByGender(recList,gender){
      const mData={};
      recList.forEach(function(r){
        if(gender){const s=getStu(r.studentId);if(!s||s.gender!==gender)return;}
        const m=r.date.substring(0,7);if(!mData[m])mData[m]={};
        r.symptoms.forEach(function(sym){deptKeys.forEach(function(dk){if(deptCats[dk].indexOf(sym)!==-1){mData[m][dk]=(mData[m][dk]||0)+1;}});});
      });
      return mData;
    }
    function sumData(mData){
      const totals={};deptKeys.forEach(function(dk){totals[dk]=0;});
      monthList.forEach(function(m){deptKeys.forEach(function(dk){totals[dk]+=(mData[m]&&mData[m][dk])||0;});});
      const gt=Object.values(totals).reduce(function(a,b){return a+b;},0);
      return {totals:totals,grand:gt};
    }
    function renderDataRow(label,mData,bold,bgStyle){
      let h2='';
      monthList.forEach(function(m){
        const mLabel=_deptTimeUnit==='day'?(+m.split('-')[1]+'/'+m.split('-')[2]):+m.split('-')[1]+'월';
        let rowTotal=0;
        h2+='<tr style="border-bottom:1px solid var(--bdr);'+(bgStyle||'')+'">';
        h2+='<td style="padding:5px 4px;font-weight:'+(bold?'700':'500')+';color:var(--t2);position:sticky;left:0;background:var(--card);z-index:1;'+(bgStyle||'')+'">'+mLabel+(label?' <span style="font-size:8px;color:var(--t3)">('+label+')</span>':'')+'</td>';
        deptKeys.forEach(function(dk){
          const v=(mData[m]&&mData[m][dk])||0;rowTotal+=v;
          h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);color:'+(v>0?'var(--t1)':'var(--t3)')+'">'+v+'</td>';
        });
        h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:var(--cyan)">'+rowTotal+'</td></tr>';
      });
      return h2;
    }
    function renderSumRow(label,sums,bold,bgStyle){
      let h2='<tr style="border-top:2px solid var(--bdr);'+(bgStyle||'background:var(--bg2)')+'"><td style="padding:6px 4px;font-weight:700;color:var(--t1);position:sticky;left:0;z-index:1;'+(bgStyle||'background:var(--bg2)')+'">'+label+'</td>';
      deptKeys.forEach(function(dk){h2+='<td style="padding:6px 4px;text-align:center;font-family:var(--fm);font-weight:'+(bold?'800':'700')+';color:'+(sums.totals[dk]>0?'var(--t1)':'var(--t3)')+'">'+sums.totals[dk]+'</td>';});
      h2+='<td style="padding:6px 4px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+sums.grand+'</td></tr>';
      return h2;
    }

    const allData=countByGender(recs,null);
    const allSums=sumData(allData);

    /* 이전 기간 집계 */
    const prevTotals={};deptKeys.forEach(function(dk){prevTotals[dk]=0;});let prevGrand=0;
    if(prevRecs&&prevRecs.length){
      prevRecs.forEach(function(r){r.symptoms.forEach(function(sym){deptKeys.forEach(function(dk){if(deptCats[dk].indexOf(sym)!==-1)prevTotals[dk]++;});});});
      prevGrand=Object.values(prevTotals).reduce(function(a,b){return a+b;},0);
    }

    let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin:18px 0 8px">'+title+'</div>';
    h+='<div style="overflow-x:auto;scrollbar-width:thin"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap">';
    h+='<thead><tr style="background:var(--bg2);border-bottom:2px solid var(--bdr)"><th style="padding:7px 6px;text-align:left;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1">'+_deptColLabel+'</th>';
    deptKeys.forEach(function(dk){h+='<th style="padding:7px 6px;text-align:center;color:var(--t3);font-weight:600;min-width:50px">'+dk.replace('계','')+'</th>';});
    h+='<th style="padding:6px 4px;text-align:center;color:var(--cyan);font-weight:700">계</th></tr></thead><tbody>';

    /* 전체 데이터 행 (남녀 구분 없이) */
    h+=renderDataRow('',allData,false,'');
    if(showGender){
      /* 남/여/남녀 소계 → 계 없이 바로 */
      const maleData=countByGender(recs,'남');const maleSums=sumData(maleData);
      const femaleData=countByGender(recs,'여');const femaleSums=sumData(femaleData);
      h+=renderSumRow('남 소계',maleSums,false,'background:rgba(16,185,129,0.08)');
      h+=renderSumRow('여 소계',femaleSums,false,'background:rgba(56,189,248,0.10)');
      h+=renderSumRow('남녀 소계',allSums,true,'background:rgba(168,85,247,0.08)');
    } else {
      h+=renderSumRow('계',allSums,true,'background:var(--bg2)');
    }

    /* 증감 행 */
    if(cmpLabel&&prevRecs&&prevRecs.length){
      h+='<tr style="background:rgba(6,182,212,0.04)"><td style="padding:7px 6px;font-weight:700;color:var(--t3);position:sticky;left:0;background:rgba(6,182,212,0.04);z-index:1">'+cmpLabel+'</td>';
      deptKeys.forEach(function(dk){
        const diff=allSums.totals[dk]-prevTotals[dk];
        const color=diff>0?'#16a34a':diff<0?'#dc2626':'var(--t3)';
        const text=diff>0?'▲'+diff:diff<0?'▼'+Math.abs(diff):'—';
        h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:'+color+'">'+text+'</td>';
      });
      const gDiff=allSums.grand-prevGrand;
      const gColor=gDiff>0?'#16a34a':gDiff<0?'#dc2626':'var(--t3)';
      const gText=gDiff>0?'▲'+gDiff:gDiff<0?'▼'+Math.abs(gDiff):'—';
      h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:'+gColor+'">'+gText+'</td></tr>';
    }
    /* 전년동기대비 행 */
    if(yoyRecs&&yoyRecs.length){
      const yoyTotals={};deptKeys.forEach(function(dk){yoyTotals[dk]=0;});
      yoyRecs.forEach(function(r){r.symptoms.forEach(function(sym){deptKeys.forEach(function(dk){if(deptCats[dk].indexOf(sym)!==-1)yoyTotals[dk]++;});});});
      const yoyGrand=Object.values(yoyTotals).reduce(function(a,b){return a+b;},0);
      h+='<tr style="background:rgba(168,85,247,0.04)"><td style="padding:7px 6px;font-weight:700;color:var(--t3);position:sticky;left:0;background:rgba(168,85,247,0.04);z-index:1">전년동기대비</td>';
      deptKeys.forEach(function(dk){
        const diff=allSums.totals[dk]-yoyTotals[dk];
        const color=diff>0?'#16a34a':diff<0?'#dc2626':'var(--t3)';
        const text=diff>0?'▲'+diff:diff<0?'▼'+Math.abs(diff):'—';
        h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:'+color+'">'+text+'</td>';
      });
      const yDiff=allSums.grand-yoyGrand;
      const yColor=yDiff>0?'#6DD4B8':yDiff<0?'#F5A3A3':'var(--t3)';
      const yText=yDiff>0?'▲'+yDiff:yDiff<0?'▼'+Math.abs(yDiff):'—';
      h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:'+yColor+'">'+yText+'</td></tr>';
    }
    h+='</tbody></table></div>';
    return h;
  }

  const stuRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';});
  const staffRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';});

  /* 학년별 통계 테이블 (학생용 — 행=학년, 남녀소계+비교행 포함) */
  function _buildGradeTable(title,gStuRecs,dc,dk2,prevRecs,yoyRecs){
    const _bgIsMulti=hasMultipleSchoolLevels();
    const gl=S.settings.schoolLevel==='kindergarten'?'세':'학년';
    /* 행 목록 구성 — 학교급 혼재면 "초1학년","중1학년" 분리 */
    const _rowList=[]; /* [{key,label}] */
    if(_bgIsMulti){
      const _lvOrder={'유':0,'초':1,'중':2,'고':3,'대':4};
      const _found={};
      S.people.forEach(function(s){
        if(s.type!=='student')return;
        const g=parseInt(s.grade,10)||0;if(g<=0)return;
        const lv=getLevelShort(s);if(!lv)return;
        if(!_found[lv])_found[lv]=new Set();
        _found[lv].add(g);
      });
      Object.keys(_found).sort(function(a,b){return(_lvOrder[a]!==undefined?_lvOrder[a]:99)-(_lvOrder[b]!==undefined?_lvOrder[b]:99);}).forEach(function(lv){
        Array.from(_found[lv]).sort(function(a,b){return a-b;}).forEach(function(g){
          _rowList.push({key:lv+'_'+g,label:lv+g+(lv==='유'?'세':gl),lv:lv,grade:g});
        });
      });
    } else {
      const registeredGrades=S.people.filter(function(s){return s.type==='student';}).map(function(s){return parseInt(s.grade,10)||0;}).filter(function(g){return g>0;});
      const maxG=registeredGrades.length?Math.max.apply(null,registeredGrades):0;
      const gradeList=maxG>0?Array.from({length:maxG},function(_,i){return i+1;}):getGrades();
      gradeList.forEach(function(g){_rowList.push({key:String(g),label:g+gl,grade:g});});
    }

    function _rowKeyOfStu(stu){
      const g=parseInt(stu.grade,10)||0;if(g<=0)return null;
      if(_bgIsMulti){const lv=getLevelShort(stu);return lv?(lv+'_'+g):null;}
      return String(g);
    }
    function countByGrade(recList){
      const gt={};dk2.forEach(function(d){gt[d]=0;});let grand=0;
      const byGrade={};
      _rowList.forEach(function(row){byGrade[row.key]={};dk2.forEach(function(d){byGrade[row.key][d]=0;});});
      recList.forEach(function(r){
        const s=getStu(r.studentId);if(!s)return;
        const k=_rowKeyOfStu(s);if(!k||!byGrade[k])return;
        r.symptoms.forEach(function(sym){dk2.forEach(function(d){if(dc[d].indexOf(sym)!==-1){byGrade[k][d]++;gt[d]++;grand++;}});});
      });
      return {byGrade:byGrade,totals:gt,grand:grand};
    }
    function countByGender(recList,gender){
      const gt={};dk2.forEach(function(d){gt[d]=0;});let grand=0;
      recList.forEach(function(r){const s=getStu(r.studentId);if(!s||(gender&&s.gender!==gender))return;
        r.symptoms.forEach(function(sym){dk2.forEach(function(d){if(dc[d].indexOf(sym)!==-1){gt[d]++;grand++;}});});});
      return {totals:gt,grand:grand};
    }
    function renderSumRow2(label,sums,bold,bg){
      let h2='<tr style="border-top:'+(bold?'2':'1')+'px solid var(--bdr);'+(bg||'background:var(--bg2)')+'"><td style="padding:7px 6px;font-weight:700;color:var(--t1);position:sticky;left:0;z-index:1;'+(bg||'background:var(--bg2)')+'">'+label+'</td>';
      dk2.forEach(function(d){h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:'+(bold?'800':'700')+';color:'+(sums.totals[d]>0?'var(--t1)':'var(--t3)')+'">'+sums.totals[d]+'</td>';});
      h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+sums.grand+'</td></tr>';return h2;
    }
    function renderCmpRow(label,cur,prev,bg){
      let h2='<tr style="'+(bg||'background:rgba(6,182,212,0.04)')+'"><td style="padding:7px 6px;font-weight:700;color:var(--t3);position:sticky;left:0;z-index:1;'+(bg||'background:rgba(6,182,212,0.04)')+'">'+label+'</td>';
      dk2.forEach(function(d){
        const diff=cur.totals[d]-prev.totals[d];const color=diff>0?'#16a34a':diff<0?'#dc2626':'var(--t3)';
        h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:'+color+'">'+(diff>0?'▲'+diff:diff<0?'▼'+Math.abs(diff):'—')+'</td>';
      });
      const gd=cur.grand-prev.grand;const gc=gd>0?'#16a34a':gd<0?'#dc2626':'var(--t3)';
      h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:'+gc+'">'+(gd>0?'▲'+gd:gd<0?'▼'+Math.abs(gd):'—')+'</td></tr>';return h2;
    }

    const cur=countByGrade(gStuRecs);
    let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin:18px 0 8px">'+title+'</div>';
    h+='<div style="overflow-x:auto;scrollbar-width:thin"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap">';
    h+='<thead><tr style="background:var(--bg2);border-bottom:2px solid var(--bdr)"><th style="padding:7px 6px;text-align:left;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1">학년</th>';
    dk2.forEach(function(d){h+='<th style="padding:7px 6px;text-align:center;color:var(--t3);font-weight:600;min-width:50px">'+d.replace('계','')+'</th>';});
    h+='<th style="padding:7px 6px;text-align:center;color:var(--cyan);font-weight:700">계</th></tr></thead><tbody>';

    /* 학년별 행 (멀티 학교급이면 학교급 prefix 포함) */
    _rowList.forEach(function(row){
      let rt=0;
      h+='<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:7px 6px;font-weight:600;color:var(--t2);position:sticky;left:0;background:var(--card);z-index:1">'+row.label+'</td>';
      dk2.forEach(function(d){const c=(cur.byGrade[row.key]||{})[d]||0;rt+=c;h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);color:'+(c>0?'var(--t1)':'var(--t3)')+'">'+c+'</td>';});
      h+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:700;color:var(--cyan)">'+rt+'</td></tr>';
    });

    /* 남소계, 여소계, 남녀소계 */
    const maleSums=countByGender(gStuRecs,'남');
    const femaleSums=countByGender(gStuRecs,'여');
    const allSums=countByGender(gStuRecs,null);
    h+=renderSumRow2('남 소계',maleSums,false,'background:rgba(16,185,129,0.08)');
    h+=renderSumRow2('여 소계',femaleSums,false,'background:rgba(56,189,248,0.10)');
    h+=renderSumRow2('남녀 소계',allSums,true,'background:rgba(168,85,247,0.08)');

    /* 비교 행 */
    if(cmpLabel&&prevRecs&&prevRecs.length){
      const prevSums=countByGender(prevRecs,null);
      h+=renderCmpRow(cmpLabel,allSums,prevSums,'background:rgba(6,182,212,0.04)');
    }
    if(S.statsPeriod!=='today'&&S.statsPeriod!=='year'){
      const yoySums=yoyRecs&&yoyRecs.length?countByGender(yoyRecs,null):{totals:(function(){const t={};dk2.forEach(function(d){t[d]=0;});return t;})(),grand:0};
      h+=renderCmpRow('전년 동기 대비',allSums,yoySums,'background:rgba(168,85,247,0.04)');
    }

    h+='</tbody></table></div>';return h;
  }

  /* 교직원/전체용 합산 테이블 (행=빈셀+계, 전체는 학생/교직원/계) */
  function _buildSummaryTable(title,recs,dc,dk2,prevRecs,yoyRecs,showStuStaff){
    function countAll(recList){
      const t={};dk2.forEach(function(d){t[d]=0;});let g=0;
      recList.forEach(function(r){r.symptoms.forEach(function(sym){dk2.forEach(function(d){if(dc[d].indexOf(sym)!==-1){t[d]++;g++;}});});});
      return {totals:t,grand:g};
    }
    function renderRow(label,sums,bold,bg){
      let h2='<tr style="'+(bg||'')+'"><td style="padding:5px 4px;font-weight:'+(bold?'700':'600')+';color:var(--t1);position:sticky;left:0;z-index:1;'+(bg||'background:var(--card)')+'">'+label+'</td>';
      dk2.forEach(function(d){h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:'+(bold?'700':'500')+';color:'+(sums.totals[d]>0?'var(--t1)':'var(--t3)')+'">'+sums.totals[d]+'</td>';});
      h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:var(--cyan)">'+sums.grand+'</td></tr>';return h2;
    }
    function renderCmp(label,cur,prev,bg){
      let h2='<tr style="'+(bg||'')+'"><td style="padding:7px 6px;font-weight:700;color:var(--t3);position:sticky;left:0;z-index:1;'+(bg||'')+'">'+label+'</td>';
      dk2.forEach(function(d){
        const diff=cur.totals[d]-prev.totals[d];const c=diff>0?'#16a34a':diff<0?'#dc2626':'var(--t3)';
        h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-size:9px;font-weight:600;color:'+c+'">'+(diff>0?'▲'+diff:diff<0?'▼'+Math.abs(diff):'—')+'</td>';
      });
      const gd=cur.grand-prev.grand;const gc=gd>0?'#16a34a':gd<0?'#dc2626':'var(--t3)';
      h2+='<td style="padding:7px 6px;text-align:center;font-family:var(--fm);font-weight:800;color:'+gc+'">'+(gd>0?'▲'+gd:gd<0?'▼'+Math.abs(gd):'—')+'</td></tr>';return h2;
    }

    const allSums=countAll(recs);
    let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin:18px 0 8px">'+title+'</div>';
    h+='<div style="overflow-x:auto;scrollbar-width:thin"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap">';
    h+='<thead><tr style="background:var(--bg2);border-bottom:2px solid var(--bdr)"><th style="padding:7px 6px;text-align:left;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1"></th>';
    dk2.forEach(function(d){h+='<th style="padding:7px 6px;text-align:center;color:var(--t3);font-weight:600;min-width:50px">'+d.replace('계','')+'</th>';});
    h+='<th style="padding:7px 6px;text-align:center;color:var(--cyan);font-weight:700">계</th></tr></thead><tbody>';

    if(showStuStaff){
      const stuOnly=recs.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';});
      const staffOnly=recs.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';});
      h+=renderRow('학생',countAll(stuOnly),false,'background:rgba(109,212,184,0.04)');
      h+=renderRow('교직원',countAll(staffOnly),false,'background:rgba(245,163,212,0.04)');
    }
    h+=renderRow('계',allSums,true,'background:var(--bg2)');

    if(cmpLabel&&prevRecs&&prevRecs.length){
      h+=renderCmp(cmpLabel,allSums,countAll(prevRecs),'background:rgba(6,182,212,0.04)');
    }
    if(S.statsPeriod!=='today'&&S.statsPeriod!=='year'){
      const yoySums2=yoyRecs&&yoyRecs.length?countAll(yoyRecs):{totals:(function(){const t={};dk2.forEach(function(d){t[d]=0;});return t;})(),grand:0};
      h+=renderCmp('전년 동기 대비',allSums,yoySums2,'background:rgba(168,85,247,0.04)');
    }
    h+='</tbody></table></div>';return h;
  }

  const ov=document.createElement('div');ov.id='deptStatsOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9500;display:flex;align-items:center;justify-content:center';
  const rangeLabel=_dashRangeLabel();
  ov.innerHTML='<div style="background:var(--card);border-radius:14px;width:96vw;max-width:1400px;box-shadow:0 12px 40px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--card);border-radius:14px 14px 0 0">'
    +'<div><div style="font-size:16px;font-weight:800;color:var(--t1)">📋 진료과별 증상 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계</div><div style="font-size:12px;color:var(--t3);margin-top:2px">'+rangeLabel+'</div><div style="font-size:11px;color:var(--t3);margin-top:3px">※ 단순 방문 수가 아니라 증상 건수를 집계한 값입니다. 한 방문자가 증상이 여러 개면 각각 집계되어 방문자 수보다 많을 수 있습니다.</div></div>'
    +'</div>'
    +'<div style="padding:8px 20px 20px;flex:1">'
    +_buildGradeTable('학생 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계 (남녀 전체/초중고전체)',stuRecs,deptCats,deptKeys,prevFiltered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';}),yoyFiltered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';}))
    +_buildSummaryTable('교직원 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계',staffRecs,deptCats,deptKeys,prevFiltered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';}),yoyFiltered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';}),false)
    +_buildSummaryTable('전체 '+(_deptPeriodTitle[S.statsPeriod]||'')+' 통계 (학생+교직원)',filtered,deptCats,deptKeys,prevFiltered,yoyFiltered,true)
    +'</div>'
    +'<div style="display:flex;gap:4px;justify-content:center;padding:10px 20px;border-top:1px solid var(--bdr);flex-shrink:0;flex-wrap:wrap;background:var(--card);border-radius:0 0 14px 14px">'
    +'<button data-action="dept-copy" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>클립보드 복사</button>'
    +'<button data-action="dept-excel" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>엑셀 내보내기</button>'
    +'<button data-action="dept-png" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>PNG 다운로드</button>'
    /* PDF 다운로드 버튼 제거됨 */
    +'<button data-action="dept-sheet" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</button>'
    +'</div></div>';
  document.body.appendChild(ov);
  _dashBindPanelDelegation(ov);
  const _dBox=ov.firstElementChild;
  if(_dBox){_dBox.style.transition='none';_dBox.style.opacity='0';_dBox.style.transform='scale(0.95)';
    requestAnimationFrame(function(){_dBox.style.transition='opacity 0.25s ease,transform 0.25s ease';_dBox.style.opacity='1';_dBox.style.transform='scale(1)';});}
  ov.addEventListener('click',function(e){
    if(e.target===ov){ov.remove();}
  });
}

/* ── 진료과별 상세 내보내기 ── */
function _deptStatsCopy(){
  /* 인라인 패널 또는 팝업 오버레이에서 테이블 찾기 */
  const src=document.getElementById('dashPanelDeptStats')||document.getElementById('deptStatsOverlay');
  if(!src){_toast('복사할 통계표가 없습니다');return;}
  const tables=src.querySelectorAll('table');
  if(!tables.length){_toast('복사할 통계표가 없습니다');return;}
  let text='';let html='';
  /* 제목들도 포함 */
  const titles=src.querySelectorAll('div[style*="font-weight:700"],div[style*="font-weight:800"]');
  const titleIdx=0;
  tables.forEach(function(tbl,ti){
    /* 테이블 앞의 제목 텍스트 추가 */
    const prev=tbl.parentElement?tbl.parentElement.previousElementSibling:null;
    if(prev&&prev.textContent){text+=prev.textContent.trim()+'\n';html+='<p><b>'+prev.textContent.trim()+'</b></p>';}
    html+='<table>';
    const rows=tbl.querySelectorAll('tr');
    rows.forEach(function(tr){
      const cells=[];html+='<tr>';
      tr.querySelectorAll('th,td').forEach(function(c){
        cells.push(c.textContent.trim());
        html+='<td>'+c.textContent.trim()+'</td>';
      });
      html+='</tr>';
      text+=cells.join('\t')+'\n';
    });
    html+='</table>';
    text+='\n';
  });
  if(window.electronAPI&&window.electronAPI.clipboardWriteHtml){
    window.electronAPI.clipboardWriteHtml(html,text);
    _toast('통계표가 클립보드에 복사되었습니다');
  } else {
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(ta);ta.select();
    document.execCommand('copy');document.body.removeChild(ta);
    _toast('통계표가 클립보드에 복사되었습니다');
  }
}
function _deptStatsGetTableData(){
  const ov=document.getElementById('dashPanelDeptStats')||document.getElementById('deptStatsOverlay');if(!ov)return[];
  const allData=[];
  ov.querySelectorAll('table').forEach(function(tbl){
    const title=tbl.parentElement.previousElementSibling;
    const titleText=title&&title.tagName==='DIV'?title.textContent.trim():'';
    const rows=[];
    tbl.querySelectorAll('tr').forEach(function(tr){
      const cells=[];tr.querySelectorAll('th,td').forEach(function(c){cells.push(c.textContent.trim());});
      rows.push(cells);
    });
    allData.push({title:titleText,rows:rows});
  });
  return allData;
}
function _deptStatsExcel(){
  if(!window.electronAPI||!window.electronAPI.xlsxBuildDeptStats){bus.emit('toast:show',{text:'Excel 빌드 IPC 미구성'});return;}
  const payload=_deptStatsBuildPayload();
  if(!payload){bus.emit('toast:show',{text:'출력할 데이터가 없습니다.'});return;}
  const rangeLabel=_dashRangeLabel()||'통계';
  const fileName='진료과별통계_'+rangeLabel.replace(/[\/\s~]/g,'_')+'.xlsx';
  bus.emit('toast:show',{text:'Excel 생성 중…'});
  window.electronAPI.xlsxBuildDeptStats(payload).then(function(res){
    if(!res||!res.success){bus.emit('toast:show',{text:'Excel 생성 실패: '+(res&&res.error||'')});return;}
    const buf=new Uint8Array(res.bytes);
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=fileName;a.click();
    URL.revokeObjectURL(url);
    bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
  }).catch(function(e){bus.emit('toast:show',{text:'Excel 오류: '+e.message});});
}
/* 학생/교직원/전체 3섹션 x (제목 + 컬럼헤더 + 월별 데이터 + 계) 페이로드 빌더 */
function _deptStatsBuildPayload(){
  if(!_deptSheetDeptCats)_deptSheetDeptCats=_dashDeptCats14();
  const filtered=getFilteredRecords();
  const deptKeys=Object.keys(_deptSheetDeptCats);
  function _guessDepts(sym){
    const hits=[];
    deptKeys.forEach(function(dk){if(_deptSheetDeptCats[dk].indexOf(sym)!==-1)hits.push(dk);});
    if(hits.length)return hits;
    /* 괄호(부위/메모) 떼고 base 증상명 재매칭 — 연필 메모 케이스 (2026-06-17) */
    const _bm=String(sym).match(/^(.+?)\s*\(/);
    if(_bm){const _bb=_bm[1].trim();deptKeys.forEach(function(dk){if(_deptSheetDeptCats[dk].indexOf(_bb)!==-1)hits.push(dk);});}
    return hits.length?hits:['기타'];
  }
  function _sectionFor(recs,title){
    const mData={};
    recs.forEach(function(r){
      const m=(r.date||'').substring(0,7);
      if(!mData[m])mData[m]={};
      const _ftm=_dashFreeTextDeptMap(r);   /* 자유기입 → 선택한 대분류 고정 (2026-06-17) */
      (r.symptoms||[]).forEach(function(sym){
        const _fd=_dashFreeDept(_ftm,sym);
        const dks=_fd?[_fd]:_guessDepts(sym);
        dks.forEach(function(dk){mData[m][dk]=(mData[m][dk]||0)+1;});
      });
    });
    let months=Object.keys(mData).sort();
    if(!months.length)months=[toDateStr(new Date()).substring(0,7)];
    const header=['월'].concat(deptKeys).concat(['계']);
    const rows=[];
    const totals={};deptKeys.forEach(function(dk){totals[dk]=0;});
    months.forEach(function(m){
      const row=[(+m.split('-')[1])+'월'];let rt=0;
      deptKeys.forEach(function(dk){
        const v=(mData[m]&&mData[m][dk])||0;totals[dk]+=v;rt+=v;row.push(v);
      });
      row.push(rt);rows.push(row);
    });
    const totalsRow=['계'];let gt=0;
    deptKeys.forEach(function(dk){totalsRow.push(totals[dk]);gt+=totals[dk];});
    totalsRow.push(gt);
    return {title:title,header:header,rows:rows,totalsRow:totalsRow};
  }
  const stuRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';});
  const staffRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';});
  const sections=[
    _sectionFor(stuRecs,'학생 월별통계'),
    _sectionFor(staffRecs,'교직원 월별통계'),
    _sectionFor(filtered,'전체 월별통계')
  ];
  const colCount=deptKeys.length+2; /* 월 + deptKeys + 계 */
  const _periodTitleMap={today:'일간',week:'주간',month:'월간',semester:'학기간',year:'연간',custom:'기간'};
  const rangeLabel=_dashRangeLabel()||'';
  const titleText='진료과별 '+(_periodTitleMap[S.statsPeriod]||'')+' 통계';
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  /* 컬럼 너비 — 월 60, 진료과 80씩, 계 70 */
  const colWidths=[60];
  deptKeys.forEach(function(){colWidths.push(80);});
  colWidths.push(70);
  /* 픽셀 기반 7:3 split */
  const total=colWidths.reduce(function(a,b){return a+b;},0);
  const th30=total*0.3;
  let acc=0,top2=0;
  for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=th30)break;}
  acc=0;let bot1=0;
  for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=th30)break;}
  const top1=Math.max(1,colCount-top2);
  return {
    sections:sections,
    titleText:titleText,
    schoolText:'학교: '+schoolName,
    periodText:'기간: '+rangeLabel,
    colCount:colCount,
    colWidths:colWidths,
    top1:top1,
    bot1:bot1
  };
}
function _deptStatsPng(){
  const tables=_deptStatsGetTableData();if(!tables.length){_toast('PNG으로 내보낼 통계표가 없습니다');return;}
  let htmlStr='<div style="font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',sans-serif;padding:20px;color:#1e293b;font-size:12px;background:#fff">';
  tables.forEach(function(t){
    if(t.title)htmlStr+='<div style="font-size:14px;font-weight:800;margin:12px 0 6px">'+t.title+'</div>';
    htmlStr+='<table style="width:100%;border-collapse:collapse;margin-bottom:16px">';
    t.rows.forEach(function(r,ri){
      htmlStr+='<tr>';r.forEach(function(c){htmlStr+='<'+(ri===0?'th':'td')+' style="border:1px solid #ccc;padding:5px 6px;text-align:center;font-size:11px;'+(ri===0?'background:#f0f0f0;font-weight:700':'')+'">'+c+'</'+(ri===0?'th':'td')+'>';});htmlStr+='</tr>';
    });
    htmlStr+='</table>';
  });
  htmlStr+='</div>';
  const rangeLabel=_dashRangeLabel()||'통계';
  if(window.electronAPI&&window.electronAPI.captureToPng){
    window.electronAPI.captureToPng({html:htmlStr,width:1200,fileName:'진료과별통계_'+rangeLabel.replace(/[\/\s~]/g,'_')+'.png'}).then(function(res){
      if(res&&res.success)_toast('PNG 저장 완료: '+res.filePath);
      else if(res&&res.error!=='cancelled')alert('PNG 저장 실패: '+(res.error||''));
    }).catch(function(err){console.error('[ERROR] captureToPng',err);});
  } else {alert('PNG 저장 기능을 사용할 수 없습니다.');}
}
function _deptStatsPdf(){
  const tables=_deptStatsGetTableData();if(!tables.length){_toast('PDF로 내보낼 통계표가 없습니다');return;}
  let htmlStr='<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:15mm}html,body{margin:0;padding:0;overflow:visible}*::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important}*{scrollbar-width:none !important;-ms-overflow-style:none !important;overflow:visible !important}body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:0;color:#1e293b;font-size:12px}table{width:100%;border-collapse:collapse;margin-bottom:16px;page-break-inside:avoid;break-inside:avoid}th,td{border:1px solid #ccc;padding:5px 6px;text-align:center;font-size:11px}th{background:#f0f0f0;font-weight:700}tr:nth-child(even){background:#fafafa}tr{page-break-inside:avoid;break-inside:avoid}.title{font-size:14px;font-weight:800;margin:12px 0 6px;page-break-after:avoid;break-after:avoid}</style></head><body>';
  tables.forEach(function(t){
    if(t.title)htmlStr+='<div class="title">'+t.title+'</div>';
    htmlStr+='<table>';
    t.rows.forEach(function(r,ri){
      htmlStr+='<tr>';r.forEach(function(c){htmlStr+='<'+(ri===0?'th':'td')+'>'+c+'</'+(ri===0?'th':'td')+'>';});htmlStr+='</tr>';
    });
    htmlStr+='</table>';
  });
  htmlStr+='</body></html>';
  const rangeLabel=_dashRangeLabel()||'통계';
  if(window.electronAPI&&window.electronAPI.printToPDF){
    window.electronAPI.printToPDF(htmlStr,{fileName:'진료과별통계_'+rangeLabel.replace(/[\/\s~]/g,'_')+'.pdf',landscape:true}).then(function(res){
      if(res&&res.success)_toast('PDF 저장 완료: '+res.filePath);
      else if(res&&res.error!=='cancelled')alert('PDF 저장 실패: '+(res.error||''));
    }).catch(function(err){console.error('[ERROR] printToPDF',err);});
  }
}
/* ═══ Sheets 계정 선택 공통 UI ═══ */
let _sheetsAccountCache=null;
async function _loadSheetsAccount(){
  if(_sheetsAccountCache)return _sheetsAccountCache;
  try{
    const u=await window.electronAPI.sheetsGetUser();
    if(u&&u.email){_sheetsAccountCache=u;return u;}
  }catch(e){}
  return null;
}
export function _sheetsAccountHtml(containerId){
  let h='<div id="'+containerId+'" style="margin-top:12px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:10px 12px">';
  h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">👤 내보내기 계정</div>';
  h+='<div id="'+containerId+'Info" style="font-size:10px;color:var(--t2);margin-bottom:6px"><span style="color:var(--t3)">확인 중...</span></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  h+='<button data-action="sheets-switch" data-container="'+containerId+'" style="padding:4px 10px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:5px;cursor:pointer;font-family:var(--f)">🔄 다른 계정 사용</button>';
  h+='<button data-action="sheets-use-main" data-container="'+containerId+'" style="padding:4px 10px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:5px;cursor:pointer;font-family:var(--f)">🏠 기본 계정 사용</button>';
  h+='</div></div>';
  return h;
}
function _sheetsAccountBadge(email,isSheetsOnly){
  const dot=isSheetsOnly?'#34a853':'var(--cyan)';
  const label=isSheetsOnly?'Sheets 전용 계정':'기본 로그인 계정';
  const badge=isSheetsOnly
    ?'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(52,168,83,0.12);color:#34a853;margin-left:4px">별도 계정</span>'
    :'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(6,182,212,0.12);color:var(--cyan);margin-left:4px">기본</span>';
  return '<div style="display:flex;align-items:center;gap:6px">'
    +'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+dot+';flex-shrink:0"></span>'
    +'<div><strong style="font-size:11px">'+escHtml(email)+'</strong>'+badge
    +'<div style="font-size:9px;color:var(--t3);margin-top:1px">이 계정의 Google 드라이브에 저장됩니다</div>'
    +'</div></div>';
}
export async function _sheetsAccountInit(containerId){
  const infoEl=document.getElementById(containerId+'Info');
  if(!infoEl)return;
  const sheetsUser=await _loadSheetsAccount();
  if(sheetsUser&&sheetsUser.email){
    infoEl.innerHTML=_sheetsAccountBadge(sheetsUser.email,true);
  } else {
    try{
      const mainUser=await window.electronAPI.getUserInfo();
      if(mainUser&&mainUser.email){
        infoEl.innerHTML=_sheetsAccountBadge(mainUser.email,false);
      } else {
        infoEl.innerHTML='<span style="color:var(--red)">로그인 필요</span>';
      }
    }catch(e){infoEl.innerHTML='<span style="color:var(--red)">계정 정보 없음</span>';}
  }
}
async function _sheetsAccountSwitch(containerId){
  const infoEl=document.getElementById(containerId+'Info');
  if(infoEl)infoEl.innerHTML='<span style="color:var(--t3)">Google 로그인 창을 확인하세요...</span>';
  try{
    const res=await window.electronAPI.sheetsLogin();
    if(res.success&&res.user){
      _sheetsAccountCache=res.user;
      if(infoEl)infoEl.innerHTML=_sheetsAccountBadge(res.user.email,true);
      _toast('Sheets 계정이 '+res.user.email+'로 변경되었습니다');
    } else {
      if(infoEl)_sheetsAccountInit(containerId);
    }
  }catch(e){if(infoEl)_sheetsAccountInit(containerId);}
}
async function _sheetsAccountUseMain(containerId){
  await window.electronAPI.sheetsUseMain();
  _sheetsAccountCache=null;
  const infoEl=document.getElementById(containerId+'Info');
  try{
    const mainUser=await window.electronAPI.getUserInfo();
    if(mainUser&&mainUser.email&&infoEl){
      infoEl.innerHTML=_sheetsAccountBadge(mainUser.email,false);
    }
  }catch(e){}
  _toast('기본 계정으로 전환되었습니다');
}

let _deptSheetDeptCats=null;
function _deptStatsSheet(){
  if(!_deptSheetDeptCats)_deptSheetDeptCats=_dashDeptCats14();
  const filtered=getFilteredRecords();
  const deptKeys=Object.keys(_deptSheetDeptCats);
  /* 백엔드 _guessDepts와 동일 로직 — 한 증상이 여러 카테고리에 속해도 각각 카운트 */
  function _guessDepts(sym){
    const hits=[];
    deptKeys.forEach(function(dk){if(_deptSheetDeptCats[dk].indexOf(sym)!==-1)hits.push(dk);});
    if(hits.length)return hits;
    /* 괄호(부위/메모) 떼고 base 증상명 재매칭 — 연필 메모 케이스, 키워드보다 우선 (2026-06-17) */
    const _bm=String(sym).match(/^(.+?)\s*\(/);
    if(_bm){const _bb=_bm[1].trim();deptKeys.forEach(function(dk){if(_deptSheetDeptCats[dk].indexOf(_bb)!==-1)hits.push(dk);});if(hits.length)return hits;}
    const s=String(sym||'');
    if(/눈|안구|결막|시력|다래끼|눈꺼풀|충혈|안약/.test(s))hits.push('안과');
    if(/편도|인후|성대|귀|이명|난청|중이|외이|목감기|목아/.test(s))hits.push('이비인후');
    if(/치아|치통|잇몸|구내염|입술|혀|턱|이빨|어금니|앞니|송곳니|사랑니|충치|구강/.test(s))hits.push('구강/치아');
    if(/기침|가래|콧물|코막힘|재채기|호흡곤란|천식|감기|독감|코피|비염|축농증|부비동|인후염|편도염/.test(s))hits.push('호흡기');
    if(/두통|편두통|어지럼|어지러|현기|저림|경련|마비/.test(s))hits.push('두통/신경');
    if(/복통|구토|구역|설사|변비|속쓰림|소화불량|식욕부진|배아|배탈|배.*아|배.*아픔|명치/.test(s))hits.push('소화기');
    if(/가슴.*(두근|통증|답답)|두근|저혈압|고혈압|빈혈|심계|심장|심박|맥박|어지러움|기립성/.test(s))hits.push('순환기');
    if(/근육통|근육경련|관절|요통|허리|어깨|손목|무릎|발목.*염좌|염좌|손가락.*통|발가락.*통|팔.*통|다리.*통|삐|뼈|근육/.test(s))hits.push('근골격');
    if(/발진|두드러기|가려|습진|여드름|피부|수포|물린|물림|알레르기|아토피|홍반|따갑|발적|벌레|모기|벌\s*쏘|벌쏘/.test(s))hits.push('피부');
    if(/넘어짐|부딪|찰과|열상|베임|찔림|타박|접질|화상|골절|긁힘|까짐|부종|출혈|상처|외상|찢어|까진|부어|삠|삔|긁혀|꼬집|밟힘|부러|탈골/.test(s))hits.push('외상');
    if(/배뇨|빈뇨|혈뇨|생리|하복부|방광|소변|월경|생리통|요도|요실금|탈수/.test(s))hits.push('비뇨/생식');
    if(/불안|스트레스|우울|공황|과호흡|불면|자해|긴장|두려움|걱정|초조|무기력|공포|짜증|분노|자살|정신|심리|트라우마/.test(s))hits.push('정신/심리');
    if(/코로나|수두|이하선염|장염|식중독|수족구|감염|유행성|독감|인플루엔자|홍역|풍진|결핵|옴|머릿니|노로|로타/.test(s))hits.push('감염');
    if(/피로|수면부족|성장통/.test(s))hits.push('기타');
    return hits.length?hits:['기타'];
  }
  function buildRows(recs,label){
    const mData={};
    recs.forEach(function(r){
      const m=r.date.substring(0,7);
      if(!mData[m])mData[m]={};
      const _ftm=_dashFreeTextDeptMap(r);   /* 자유기입 → 선택한 대분류 고정 (2026-06-17) */
      r.symptoms.forEach(function(sym){
        const _fd=_dashFreeDept(_ftm,sym);
        const dks=_fd?[_fd]:_guessDepts(sym);
        dks.forEach(function(dk){mData[m][dk]=(mData[m][dk]||0)+1;});
      });
    });
    let months=Object.keys(mData).sort();if(!months.length)months=[toDateStr(new Date()).substring(0,7)];
    const rows=[];rows.push([label+' 월별통계']);
    const header=['월'];deptKeys.forEach(function(dk){header.push(dk);});header.push('계');rows.push(header);
    const totals={};deptKeys.forEach(function(dk){totals[dk]=0;});
    months.forEach(function(m){const row=[+m.split('-')[1]+'월'];let rt=0;deptKeys.forEach(function(dk){const v=(mData[m]&&mData[m][dk])||0;totals[dk]+=v;rt+=v;row.push(v);});row.push(rt);rows.push(row);});
    const sumRow=['계'];let gt=0;deptKeys.forEach(function(dk){sumRow.push(totals[dk]);gt+=totals[dk];});sumRow.push(gt);rows.push(sumRow);rows.push([]);return rows;
  }
  const stuRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';});
  const staffRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';});
  const allRows=[].concat(buildRows(stuRecs,'학생')).concat(buildRows(staffRecs,'교직원')).concat(buildRows(filtered,'전체'));
  const rangeLabel=_dashRangeLabel()||'통계';
  const _periodTitleMap={today:'일간',week:'주간',month:'월간',semester:'학기간',year:'연간',custom:'기간'};
  const titleText='진료과별 '+(_periodTitleMap[S.statsPeriod]||'')+' 통계 '+rangeLabel;

  /* 확인 팝업 (연수 등록부 스타일) */
  const existing=document.getElementById('deptSheetsOverlay');if(existing)existing.remove();
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='deptSheetsOverlay';ov.style.cssText='background:rgba(0,0,0,0.35);z-index:9600';
  let html='<div class="modal-content" style="width:440px;max-width:94vw;padding:0">';
  html+='<div style="background:var(--bg2);padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</div></div>';
  html+='<div style="padding:18px">';
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#34a853,#1e8e3e);display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg></div>';
  html+='<div><div style="font-size:13px;font-weight:700;color:var(--t1)">내 Google 드라이브에 저장</div>';
  html+='<div style="font-size:10px;color:var(--t3)">새 스프레드시트가 자동으로 생성됩니다</div></div></div>';
  html+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11px;color:var(--t2)">';
  html+='<div style="margin-bottom:6px"><strong>파일명:</strong> '+escHtml(titleText)+'</div>';
  html+='<div style="margin-bottom:6px"><strong>내용:</strong> 학생/교직원/전체 진료과별 월별통계</div>';
  html+='<div><strong>총 행:</strong> '+allRows.length+'행</div>';
  html+='</div>';
  /* 계정 선택 */
  html+=_sheetsAccountHtml('deptSheetsAcct');
  /* 폴더 선택 */
  html+='<div style="margin-top:12px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:10px 12px">';
  html+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">📂 저장 위치</div>';
  html+='<div id="deptSheetsFolderPath" style="font-size:10px;color:var(--t2);margin-bottom:6px">내 드라이브 (루트)</div>';
  html+='<div style="display:flex;gap:6px">';
  html+='<button data-action="dept-sheets-browse" style="padding:4px 10px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:5px;cursor:pointer;font-family:var(--f)">📁 폴더 선택</button>';
  html+='</div></div>';
  html+='</div>';
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  html+='<button id="deptSheetsSendBtn" data-action="dept-sheets-send" style="padding:7px 22px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov){
      ov.remove();
      /* 뒤에 깔린 진료과 통계 popup도 같이 닫기 */
      const back=document.getElementById('deptStatsOverlay');if(back)back.remove();
      return;
    }
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='sheets-switch')_sheetsAccountSwitch(el.dataset.container);
    else if(act==='sheets-use-main')_sheetsAccountUseMain(el.dataset.container);
    else if(act==='dept-sheets-browse')_deptSheetsBrowse();
    else if(act==='dept-sheets-send')_deptSheetsSend(titleText,allRows);
  });
  document.body.appendChild(ov);
  _sheetsAccountInit('deptSheetsAcct');
  _deptSheetsFolder={id:null,name:'내 드라이브 (루트)',path:[]};
  /* 저장된 폴더 복원 */
  const savedFolder=JSON.parse(localStorage.getItem('sheets_export_folder')||'null');
  if(savedFolder&&savedFolder.id){_deptSheetsFolder=savedFolder;const fp=document.getElementById('deptSheetsFolderPath');if(fp)fp.textContent='📂 '+savedFolder.name;}
}
function _deptSheetsResetFolder(){
  _deptSheetsFolder={id:null,name:'내 드라이브 (루트)',path:[]};
  localStorage.removeItem('sheets_export_folder');
  const fp=document.getElementById('deptSheetsFolderPath');if(fp)fp.textContent='내 드라이브 (루트)';
}
async function _deptSheetsBrowse(){
  const cur=_deptSheetsFolder||{id:null,path:[]};
  const parentId=cur.id||null;
  /* 폴더 선택 팝업 */
  const ex=document.getElementById('driveFolderPicker');if(ex)ex.remove();
  const pk=document.createElement('div');pk.id='driveFolderPicker';
  pk.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9700;display:flex;align-items:center;justify-content:center';
  pk.innerHTML='<div style="background:var(--card);border-radius:12px;width:400px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.3);overflow:hidden"><div style="padding:12px 16px;background:var(--bg2);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">📂 폴더 선택</div><div id="driveFolderList" style="padding:12px 16px;max-height:300px;overflow-y:auto;min-height:60px"><div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">불러오는 중...</div></div><div style="padding:10px 16px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;justify-content:space-between"><button data-action="drive-folder-new" style="padding:5px 12px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">+ 새 폴더</button><button data-action="drive-folder-select" style="padding:5px 14px;font-size:10px;font-weight:700;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">이 폴더 선택</button></div></div>';
  pk.addEventListener('click',function(e){
    if(e.target===pk){_closeDrivePicker();return;}
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='drive-folder-new')_driveFolderNew();
    else if(act==='drive-folder-select')_driveFolderSelect();
    else if(act==='drive-folder-up')_driveFolderUp();
    else if(act==='drive-folder-enter')_driveFolderEnter(el.dataset.id,el.dataset.name);
  });
  document.body.appendChild(pk);
  /* 열기 애니메이션 */
  const _pkBox=pk.firstElementChild;
  if(_pkBox){_pkBox.style.transition='none';_pkBox.style.opacity='0';_pkBox.style.transform='scale(0.95)';
    requestAnimationFrame(function(){_pkBox.style.transition='opacity 0.25s ease,transform 0.25s ease';_pkBox.style.opacity='1';_pkBox.style.transform='scale(1)';});}
  S._driveBrowseStack=cur.path?cur.path.slice():[];
  S._driveBrowseCurrent=parentId;
  _driveFolderLoad(parentId);
}
async function _driveFolderLoad(parentId){
  const list=document.getElementById('driveFolderList');if(!list)return;
  list.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">불러오는 중...</div>';
  try{
    const res=await window.electronAPI.driveListFolders(parentId);
    if(!res.success)throw new Error(res.error);
    const folders=res.folders||[];
    let h='';
    /* 상위 폴더 */
    if(S._driveBrowseStack&&S._driveBrowseStack.length>0){
      h+='<div data-action="drive-folder-up" class="dash-hover-bg" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;color:var(--t2);font-weight:600;border:1px solid var(--bdr);margin-bottom:4px">⬆️ 상위 폴더</div>';
    }
    if(!folders.length){
      h+='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">하위 폴더가 없습니다</div>';
    }
    folders.forEach(function(f){
      h+='<div data-action="drive-folder-enter" data-id="'+f.id+'" data-name="'+escHtml(f.name).replace(/"/g,'&quot;')+'" class="dash-hover-bg-border" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;color:var(--t1);font-weight:600;border:1px solid transparent;margin-bottom:2px">';
      h+='<span style="font-size:16px">📁</span>'+escHtml(f.name)+'</div>';
    });
    list.innerHTML=h;
  }catch(err){
    if(err.message&&(err.message.indexOf('Not authenticated')>=0||err.message.indexOf('insufficient authentication')>=0)){
      list.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">Google 로그인이 필요합니다. 로그인 중...</div>';
      try{
        const loginRes=await window.electronAPI.googleLogin();
        if(loginRes&&loginRes.success){_driveFolderLoad(parentId);return;}
        else{list.innerHTML='<div style="text-align:center;padding:16px;color:#ef4444;font-size:11px">로그인 실패: '+(loginRes?loginRes.error:'')+'</div>';}
      }catch(le){list.innerHTML='<div style="text-align:center;padding:16px;color:#ef4444;font-size:11px">로그인 실패: '+escHtml(le.message)+'</div>';}
    } else {
      list.innerHTML='<div style="text-align:center;padding:16px;color:#ef4444;font-size:11px">오류: '+escHtml(err.message)+'</div>';
    }
  }
}
function _driveFolderEnter(id,name){
  S._driveBrowseStack=S._driveBrowseStack||[];
  S._driveBrowseStack.push({id:S._driveBrowseCurrent,name:name});
  S._driveBrowseCurrent=id;
  _driveFolderLoad(id);
}
function _driveFolderUp(){
  const stack=S._driveBrowseStack||[];
  if(!stack.length)return;
  const parent=stack.pop();
  S._driveBrowseCurrent=parent.id||null;
  _driveFolderLoad(S._driveBrowseCurrent);
}
export async function _driveFolderNew(){
  const name=prompt('새 폴더 이름을 입력하세요:','오렌지팜 보건일지');
  if(!name||!name.trim())return;
  try{
    const parentId=S._driveBrowseCurrent||null;
    const res=await window.electronAPI.driveCreateFolder(name.trim(),parentId);
    if(!res.success)throw new Error(res.error);
    _toast('폴더 "'+name.trim()+'" 생성됨');
    _driveFolderLoad(parentId);
  }catch(err){alert('폴더 생성 실패: '+err.message);}
}
function _closeDrivePicker(){
  const pk=document.getElementById('driveFolderPicker');if(pk)pk.remove();
}
function _driveFolderSelect(){
  const id=S._driveBrowseCurrent;
  const stack=S._driveBrowseStack||[];
  const name=stack.length?stack[stack.length-1].name:'내 드라이브';
  /* 현재 위치가 루트면 */
  if(!id){_deptSheetsResetFolder();_closeDrivePicker();return;}
  const pathNames=stack.map(function(s){return s.name;}).filter(Boolean);
  const folderData={id:id,name:pathNames.join(' / ')||name,path:stack.slice()};
  _deptSheetsFolder=folderData;
  localStorage.setItem('sheets_export_folder',JSON.stringify(folderData));
  const fp=document.getElementById('deptSheetsFolderPath');if(fp)fp.textContent='📂 '+folderData.name;
  _closeDrivePicker();
}
async function _deptSheetsNewFolder(){
  const name=prompt('새 폴더 이름을 입력하세요:','오렌지팜 보건일지');
  if(!name||!name.trim())return;
  try{
    const parentId=(_deptSheetsFolder&&_deptSheetsFolder.id)||null;
    const res=await window.electronAPI.driveCreateFolder(name.trim(),parentId);
    if(!res.success)throw new Error(res.error);
    const folder=res.folder;
    const folderData={id:folder.id,name:name.trim(),path:[{id:parentId,name:name.trim()}]};
    _deptSheetsFolder=folderData;
    localStorage.setItem('sheets_export_folder',JSON.stringify(folderData));
    const fp=document.getElementById('deptSheetsFolderPath');if(fp)fp.textContent='📂 '+name.trim();
    _toast('폴더 "'+name.trim()+'" 생성됨');
  }catch(err){alert('폴더 생성 실패: '+err.message);}
}
async function _deptSheetsSend(titleText,allRows){
  const btn=document.getElementById('deptSheetsSendBtn');
  btn.disabled=true;btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';
  /* 보건일지 출력과 동일한 양식 — 구조화 payload 사용 */
  const payload=_deptStatsBuildPayload();
  async function _doExport(){
    if(!payload)return {success:false,error:'데이터 없음'};
    const sheetId=0;
    const colCount=payload.colCount;
    const sp={top1:payload.top1,bot1:payload.bot1};
    /* 시트 데이터 구성 — Excel 과 동일 레이아웃 (1~7행 헤더 + 섹션 반복) */
    function pad(arr){const r=arr.slice();while(r.length<colCount)r.push('');return r;}
    const rows=[];
    rows.push(pad([])); /* 1 */
    rows.push(pad([payload.titleText])); /* 2 */
    rows.push(pad([])); /* 3 */
    rows.push(pad([])); /* 4 여백 */
    rows.push(pad([payload.schoolText])); /* 5 */
    rows.push(pad([payload.periodText])); /* 6 */
    rows.push(pad([])); /* 7 여백 */
    /* 섹션 경계 메타 */
    const sectionMeta=[]; /* {titleRow, headerRow, dataStart, dataEnd, totalsRow} */
    payload.sections.forEach(function(sec,si){
      if(si>0)rows.push(pad([])); /* 섹션 간 여백 */
      const titleRowIdx=rows.length; /* 0-indexed after push */
      rows.push(pad([sec.title])); /* 섹션 타이틀 */
      const headerRowIdx=rows.length;
      rows.push(pad(sec.header)); /* 컬럼 헤더 */
      const dataStart=rows.length;
      sec.rows.forEach(function(r){rows.push(pad(r));});
      const dataEnd=rows.length-1;
      let totalsRowIdx=-1;
      if(sec.totalsRow){totalsRowIdx=rows.length;rows.push(pad(sec.totalsRow));}
      sectionMeta.push({titleRow:titleRowIdx,headerRow:headerRowIdx,dataStart:dataStart,dataEnd:dataEnd,totalsRow:totalsRowIdx});
    });
    const fmtReqs=[];
    /* 1행: 상단 색상바 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:8},fields:'pixelSize'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:sp.top1},cell:{userEnteredFormat:{backgroundColor:{red:0.157,green:0.333,blue:0.627}}},fields:'userEnteredFormat.backgroundColor'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:sp.top1,endColumnIndex:colCount},cell:{userEnteredFormat:{backgroundColor:{red:0.831,green:0.659,blue:0.263}}},fields:'userEnteredFormat.backgroundColor'}});
    /* 2행: 제목 병합 + 굵게 */
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:14},backgroundColor:{red:0.969,green:0.969,blue:0.969}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)'}});
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:1,endIndex:2},properties:{pixelSize:32},fields:'pixelSize'}});
    /* 3행: 하단 색상바 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:2,endIndex:3},properties:{pixelSize:8},fields:'pixelSize'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:sp.bot1},cell:{userEnteredFormat:{backgroundColor:{red:0.180,green:0.545,blue:0.341}}},fields:'userEnteredFormat.backgroundColor'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:sp.bot1,endColumnIndex:colCount},cell:{userEnteredFormat:{backgroundColor:{red:0.753,green:0.224,blue:0.169}}},fields:'userEnteredFormat.backgroundColor'}});
    /* 4행 여백 / 5행 학교 / 6행 기간 / 7행 여백 */
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:3,endIndex:4},properties:{pixelSize:24},fields:'pixelSize'}});
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:4,endRowIndex:5},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
    fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
    fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:5,endRowIndex:6},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat(horizontalAlignment,textFormat)'}});
    fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:6,endIndex:7},properties:{pixelSize:24},fields:'pixelSize'}});
    /* 섹션별 서식 */
    sectionMeta.forEach(function(meta){
      /* 섹션 타이틀 — 병합 + 하늘 배경 */
      fmtReqs.push({mergeCells:{range:{sheetId:sheetId,startRowIndex:meta.titleRow,endRowIndex:meta.titleRow+1,startColumnIndex:0,endColumnIndex:colCount},mergeType:'MERGE_ALL'}});
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:meta.titleRow,endRowIndex:meta.titleRow+1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:13,foregroundColor:{red:0.055,green:0.459,blue:0.565}},backgroundColor:{red:0.902,green:0.969,blue:0.984}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor)'}});
      /* 컬럼 헤더 — 굵게 + 회색 배경 + 굵은 테두리 */
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:meta.headerRow,endRowIndex:meta.headerRow+1,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{bold:true,fontSize:11},backgroundColor:{red:0.918,green:0.918,blue:0.918},borders:{top:{style:'SOLID_MEDIUM'},bottom:{style:'SOLID_MEDIUM'},left:{style:'SOLID'},right:{style:'SOLID'}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,backgroundColor,borders)'}});
      /* 데이터 */
      const lastDataEnd=meta.totalsRow>=0?meta.totalsRow:meta.dataEnd;
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:meta.dataStart,endRowIndex:lastDataEnd+1,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},bottom:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},left:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}},right:{style:'SOLID',color:{red:0.4,green:0.4,blue:0.4}}}}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,borders)'}});
      /* 좌/우 굵은선 */
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:meta.headerRow,endRowIndex:lastDataEnd+1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{borders:{left:{style:'SOLID_MEDIUM'}}}},fields:'userEnteredFormat.borders.left'}});
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:meta.headerRow,endRowIndex:lastDataEnd+1,startColumnIndex:colCount-1,endColumnIndex:colCount},cell:{userEnteredFormat:{borders:{right:{style:'SOLID_MEDIUM'}}}},fields:'userEnteredFormat.borders.right'}});
      /* 마지막 행 하단 굵은선 */
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:lastDataEnd,endRowIndex:lastDataEnd+1,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{borders:{bottom:{style:'SOLID_MEDIUM'}}}},fields:'userEnteredFormat.borders.bottom'}});
      /* 합계 행 굵게 강조 */
      if(meta.totalsRow>=0){
        fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:meta.totalsRow,endRowIndex:meta.totalsRow+1,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{textFormat:{bold:true},backgroundColor:{red:0.980,green:0.984,blue:0.988}}},fields:'userEnteredFormat(textFormat,backgroundColor)'}});
      }
    });
    /* 컬럼 너비 */
    payload.colWidths.forEach(function(w,i){
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});
    });
    /* freeze 7행까지 */
    fmtReqs.push({updateSheetProperties:{properties:{sheetId:sheetId,gridProperties:{frozenRowCount:7}},fields:'gridProperties.frozenRowCount'}});
    /* 사용하지 않는 오른쪽/아래 영역 제거 */
    const DEFAULT_COLS=26,DEFAULT_ROWS=1000;
    if(colCount<DEFAULT_COLS)fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:colCount,endIndex:DEFAULT_COLS}}});
    if(rows.length<DEFAULT_ROWS)fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:rows.length,endIndex:DEFAULT_ROWS}}});

    return await window.sheetsExportWithConsent({
      title:titleText,
      sheetTitle:'진료과별통계',
      range:'진료과별통계!A1',
      values:rows,
      requests:fmtReqs,
      targetFolderId:(_deptSheetsFolder&&_deptSheetsFolder.id)||null
    });
  }
  try{
    let res=await _doExport();
    /* Not authenticated → 자동 로그인 후 재시도 */
    if(!res.success && /not authenticated|authenticate|no.*token|unauthorized|401/i.test(String(res.error||''))){
      btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 로그인 중...';
      const loginRes=await window.electronAPI.sheetsLogin();
      if(!loginRes||!loginRes.success)throw new Error((loginRes&&loginRes.error)||'Google 로그인 실패');
      _sheetsAccountCache=loginRes.user;
      const infoEl=document.getElementById('deptSheetsAcctInfo');
      if(infoEl&&loginRes.user)infoEl.innerHTML=_sheetsAccountBadge(loginRes.user.email,true);
      btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';
      res=await _doExport();
    }
    if(!res.success)throw new Error(res.error||'생성 실패');
    const ov=document.getElementById('deptSheetsOverlay');if(ov)ov.remove();
    const ssUrl=res.spreadsheetUrl||('https://docs.google.com/spreadsheets/d/'+res.spreadsheetId);
    if(ssUrl&&window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(ssUrl);
    _toast('Google Sheets에 저장되었습니다');
  }catch(err){
    btn.disabled=false;btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기';
    alert('Google Sheets 내보내기 실패:\n'+(err&&err.message||err));
  }
}

/* ── 시간대별 분포 설정 팝업 ── */
function _dashHourlySettings(){
  const existing=document.getElementById('hourlySettingsOv');if(existing)closeModalGracefully(existing);
  const slots=JSON.parse(localStorage.getItem('dash_hourly_slots')||'null')||[
    {from:'08:30',to:'09:30'},{from:'09:30',to:'10:30'},{from:'10:30',to:'11:30'},
    {from:'11:30',to:'12:30'},{from:'12:30',to:'13:30'},{from:'13:30',to:'14:30'},
    {from:'14:30',to:'15:30'},{from:'15:30',to:'16:30'}
  ];
  const ov=document.createElement('div');ov.id='hourlySettingsOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9600;display:flex;align-items:center;justify-content:center';
  function _renderRows(){
    let h='';
    slots.forEach(function(s,i){
      h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px" data-idx="'+i+'">';
      h+='<span style="font-size:10px;color:var(--t3);width:18px;text-align:right;flex-shrink:0">'+(i+1)+'</span>';
      h+='<input type="text" value="'+s.from+'" maxlength="5" placeholder="HH:MM" data-idx="'+i+'" data-field="from" class="ht-time-input" style="padding:6px 10px;font-size:13px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--fm);width:70px;text-align:center;letter-spacing:1px">';
      h+='<span style="color:var(--t3);font-size:10px">~</span>';
      h+='<input type="text" value="'+s.to+'" maxlength="5" placeholder="HH:MM" data-idx="'+i+'" data-field="to" class="ht-time-input" style="padding:6px 10px;font-size:13px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--fm);width:70px;text-align:center;letter-spacing:1px">';
      h+='<button data-action="ht-slot-remove" data-idx="'+i+'" class="dash-hover-red" style="background:none;border:none;cursor:pointer;color:var(--t3);font-size:14px;padding:2px 4px;opacity:0.5">✕</button>';
      h+='</div>';
    });
    return h;
  }
  let html='<div style="background:var(--card);border-radius:12px;width:460px;max-width:92vw;box-shadow:0 8px 30px rgba(0,0,0,0.25);overflow:hidden">';
  html+='<div style="padding:14px 18px;background:var(--bg2);border-bottom:1px solid var(--bdr);border-radius:12px 12px 0 0"><div style="font-size:14px;font-weight:800;color:var(--t1)">⏰ 시간대 설정</div><div style="font-size:10px;color:var(--t3);margin-top:4px;display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>클릭하여 숫자 입력, 더블 클릭하여 스크롤로 지정하세요.</div></div>';
  html+='<div style="padding:14px 18px;max-height:420px;overflow-y:auto;overscroll-behavior-y:contain" id="htSlotRows">'+_renderRows()+'</div>';
  html+='<div style="padding:10px 18px;border-top:1px solid var(--bdr);display:flex;gap:8px;align-items:center;background:var(--bg2);border-radius:0 0 12px 12px">';
  html+='<button id="htSlotAddBtn" data-action="ht-slot-add" style="padding:5px 12px;font-size:10px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)"'+(slots.length>=9?' disabled style="opacity:0.4"':'')+'>+ 시간대 추가</button>';
  html+='<button data-action="ht-slot-reset" style="padding:5px 12px;font-size:10px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">기본값</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov){_htSettingsClose();return;}
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='ht-slot-remove')_htSlotRemove(+el.dataset.idx);
    else if(act==='ht-slot-add')_htSlotAdd();
    else if(act==='ht-slot-reset')_htSlotReset();
  });
  _htBindInputEvents(ov);
  document.body.appendChild(ov);
  /* 열기 애니메이션 */
  const _box=ov.firstElementChild;
  if(_box){_box.style.transition='none';_box.style.opacity='0';_box.style.transform='scale(0.95)';
    requestAnimationFrame(function(){_box.style.transition='opacity 0.25s ease,transform 0.25s ease';_box.style.opacity='1';_box.style.transform='scale(1)';});}
  /* 바운스 스크롤 */
  setTimeout(function(){
    const rows=document.getElementById('htSlotRows');if(!rows)return;
    let _htBouncing=false;
    rows.addEventListener('scroll',function(){
      if(_htBouncing)return;
      const atTop=rows.scrollTop<=0;
      const atBot=rows.scrollTop+rows.clientHeight>=rows.scrollHeight-2;
      if(atTop||atBot){
        _htBouncing=true;
        const dir=atBot?-1:1;
        rows.style.transition='transform 0.2s cubic-bezier(.2,.8,.4,1.4)';
        rows.style.transform='translateY('+(dir*18)+'px)';
        setTimeout(function(){
          rows.style.transition='transform 0.35s cubic-bezier(.25,.1,.25,1)';
          rows.style.transform='translateY(0)';
          setTimeout(function(){rows.style.transition='';_htBouncing=false;},350);
        },200);
      }
    });
  },50);
  _htTempSlots=JSON.parse(JSON.stringify(slots));
}
function _htSettingsClose(){
  const ov=document.getElementById('hourlySettingsOv');if(ov)ov.remove();
}
function _htTimeWheel(e,input,idx,field){
  e.preventDefault();
  const cur=input.value||'08:00';
  const p=cur.split(':');const h=parseInt(p[0],10)||0, m=parseInt(p[1],10)||0;
  let total=h*60+m;
  total+=e.deltaY<0?30:-30;
  if(total<0)total=0;if(total>1430)total=1430;
  const nh=Math.floor(total/60), nm=total%60;
  const nv=(nh<10?'0':'')+nh+':'+(nm<10?'0':'')+nm;
  input.value=nv;
  _htSlotChange(idx,field,nv);
}
let _htSaveTimer=null;
function _htSlotChange(idx,field,val){
  if(!_htTempSlots)return;
  _htTempSlots[idx][field]=val;
  /* 자동 저장 */
  if(_htSaveTimer)clearTimeout(_htSaveTimer);
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='저장 중…';toast.className='global-save-toast show saving';}
  _htSaveTimer=setTimeout(function(){
    localStorage.setItem('dash_hourly_slots',JSON.stringify(_htTempSlots));
    if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
      window.electronAPI.jsonSaveCommon('dash_hourly_slots',_htTempSlots);
    if(toast){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';
      setTimeout(function(){toast.className='global-save-toast';},3000);}
    renderDashboard();
  },400);
}
/* 추가·삭제도 즉시 저장+토스트 — 기존엔 시간 편집(_htSlotChange)만 저장돼 추가/삭제만 하고 닫으면 유실됐음 (사용자 지시 2026-06-15) */
function _htSlotPersist(){
  if(!_htTempSlots)return;
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='저장 중…';toast.className='global-save-toast show saving';}
  if(_htSaveTimer)clearTimeout(_htSaveTimer);
  _htSaveTimer=setTimeout(function(){
    localStorage.setItem('dash_hourly_slots',JSON.stringify(_htTempSlots));
    if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
      window.electronAPI.jsonSaveCommon('dash_hourly_slots',_htTempSlots);
    if(toast){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';
      setTimeout(function(){toast.className='global-save-toast';},3000);}
    renderDashboard();
  },400);
}
function _htSlotRemove(idx){
  if(!_htTempSlots||_htTempSlots.length<=1)return;
  _htTempSlots.splice(idx,1);
  _htSlotRefreshUI();
  _htSlotPersist();
}
function _htSlotAdd(){
  if(!_htTempSlots||_htTempSlots.length>=9)return;
  const last=_htTempSlots[_htTempSlots.length-1];
  const nextFrom=last?last.to:'17:30';
  const nfMin=(parseInt(nextFrom.split(':')[0],10)||0)*60+(parseInt(nextFrom.split(':')[1],10)||0)+60;
  const nh=Math.floor(nfMin/60), nm=nfMin%60;
  const nextTo=(nh<10?'0':'')+nh+':'+(nm<10?'0':'')+nm;
  _htTempSlots.push({from:nextFrom,to:nextTo});
  _htSlotRefreshUI();
  _htSlotPersist();
}
function _htSlotReset(){
  _htTempSlots=[
    {from:'08:30',to:'09:30'},{from:'09:30',to:'10:30'},{from:'10:30',to:'11:30'},
    {from:'11:30',to:'12:30'},{from:'12:30',to:'13:30'},{from:'13:30',to:'14:30'},
    {from:'14:30',to:'15:30'},{from:'15:30',to:'16:30'}
  ];
  _htSlotRefreshUI();
  _htSlotChange(0,'from','08:30');
}
function _htOpenScroll(input,idx,field){
  const existing=document.querySelector('.ht-scroll-picker');if(existing)existing.remove();
  const rect=input.getBoundingClientRect();
  const cur=input.value||'08:00';
  const p=cur.split(':');const curH=parseInt(p[0],10)||0, curM=parseInt(p[1],10)||0;
  const pk=document.createElement('div');pk.className='ht-scroll-picker';
  pk.style.cssText='position:fixed;left:'+(rect.left-10)+'px;top:'+(rect.bottom+4)+'px;z-index:9700;background:var(--card);border:1px solid var(--cyan);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;gap:0;overflow:hidden';
  /* 시 스크롤 */
  let hCol='<div style="width:50px;max-height:180px;overflow-y:auto;scrollbar-width:thin;border-right:1px solid var(--bdr)">';
  for(let hh=0;hh<24;hh++){
    const hStr=(hh<10?'0':'')+hh;
    hCol+='<div data-h="'+hh+'" data-action="ht-scroll-pick" data-idx="'+idx+'" data-field="'+field+'" data-hval="'+hh+'" class="dash-hover-scroll'+(hh===curH?' ht-active':'')+'" style="padding:6px 8px;text-align:center;font-size:12px;font-weight:'+(hh===curH?'800':'400')+';color:'+(hh===curH?'var(--cyan)':'var(--t1)')+';cursor:pointer;background:'+(hh===curH?'rgba(6,182,212,0.1)':'')+'">'+hStr+'</div>';
  }
  hCol+='</div>';
  /* 분 스크롤 */
  let mCol='<div style="width:50px;max-height:180px;overflow-y:auto;scrollbar-width:thin">';
  for(let mm=0;mm<60;mm+=5){
    const mStr=(mm<10?'0':'')+mm;
    mCol+='<div data-m="'+mm+'" data-action="ht-scroll-pick" data-idx="'+idx+'" data-field="'+field+'" data-mval="'+mm+'" class="dash-hover-scroll'+(mm===curM?' ht-active':'')+'" style="padding:6px 8px;text-align:center;font-size:12px;font-weight:'+(mm===curM?'800':'400')+';color:'+(mm===curM?'var(--cyan)':'var(--t1)')+';cursor:pointer;background:'+(mm===curM?'rgba(6,182,212,0.1)':'')+'">'+mStr+'</div>';
  }
  mCol+='</div>';
  pk.innerHTML=hCol+mCol;
  pk.addEventListener('click',function(e){
    const el=e.target.closest('[data-action="ht-scroll-pick"]');if(!el)return;
    const hv=el.dataset.hval!==undefined?+el.dataset.hval:null;
    const mv=el.dataset.mval!==undefined?+el.dataset.mval:null;
    _htScrollPick(+el.dataset.idx,el.dataset.field,hv!==null?hv:null,mv!==null?mv:null,el);
  });
  pk.addEventListener('mouseenter',function(e){if(e.target.classList.contains('dash-hover-scroll'))e.target.style.background='var(--hover)';},true);
  pk.addEventListener('mouseleave',function(e){if(e.target.classList.contains('dash-hover-scroll'))e.target.style.background=e.target.classList.contains('ht-active')?'rgba(6,182,212,0.1)':'';},true);
  document.body.appendChild(pk);
  /* 현재 값으로 스크롤 */
  const cols=pk.querySelectorAll('div[style*="overflow-y"]');
  if(cols[0]){const sel=cols[0].querySelector('[data-h="'+curH+'"]');if(sel)cols[0].scrollTop=sel.offsetTop-60;}
  if(cols[1]){const sel2=cols[1].querySelector('[data-m="'+curM+'"]');if(sel2)cols[1].scrollTop=sel2.offsetTop-60;}
  pk._htIdx=idx;pk._htField=field;pk._htInput=input;pk._htH=curH;pk._htM=curM;
  setTimeout(function(){document.addEventListener('click',_htCloseScrollPicker);},10);
}
function _htCloseScrollPicker(e){
  const pk=document.querySelector('.ht-scroll-picker');
  if(pk&&!pk.contains(e.target)){pk.remove();document.removeEventListener('click',_htCloseScrollPicker);}
}
function _htScrollPick(idx,field,h,m,el){
  const pk=document.querySelector('.ht-scroll-picker');if(!pk)return;
  if(h!==null)pk._htH=h;
  if(m!==null)pk._htM=m;
  const nh=pk._htH, nm=pk._htM;
  const nv=(nh<10?'0':'')+nh+':'+(nm<10?'0':'')+nm;
  pk._htInput.value=nv;
  _htSlotChange(idx,field,nv);
  /* 하이라이트 갱신 */
  const parent=el.parentElement;
  parent.querySelectorAll('div[data-h],div[data-m]').forEach(function(d){
    const isAct=(h!==null&&d.dataset.h==String(h))||(m!==null&&d.dataset.m==String(m));
    d.style.fontWeight=isAct?'800':'400';
    d.style.color=isAct?'var(--cyan)':'var(--t1)';
    d.style.background=isAct?'rgba(6,182,212,0.1)':'';
  });
}
function _htSlotRefreshUI(){
  const rows=document.getElementById('htSlotRows');if(!rows)return;
  const slots=_htTempSlots||[];
  let h='';
  slots.forEach(function(s,i){
    h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">';
    h+='<span style="font-size:10px;color:var(--t3);width:18px;text-align:right;flex-shrink:0">'+(i+1)+'</span>';
    h+='<input type="text" value="'+s.from+'" maxlength="5" placeholder="HH:MM" data-idx="'+i+'" data-field="from" class="ht-time-input" style="padding:6px 10px;font-size:13px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--fm);width:70px;text-align:center;letter-spacing:1px">';
    h+='<span style="color:var(--t3);font-size:10px">~</span>';
    h+='<input type="text" value="'+s.to+'" maxlength="5" placeholder="HH:MM" data-idx="'+i+'" data-field="to" class="ht-time-input" style="padding:6px 10px;font-size:13px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);font-family:var(--fm);width:70px;text-align:center;letter-spacing:1px">';
    h+='<button data-action="ht-slot-remove" data-idx="'+i+'" class="dash-hover-red" style="background:none;border:none;cursor:pointer;color:var(--t3);font-size:14px;padding:2px 4px;opacity:0.5">✕</button>';
    h+='</div>';
  });
  rows.innerHTML=h;
  _htBindInputEvents(rows);
  const addBtn=document.getElementById('htSlotAddBtn');
  if(addBtn){addBtn.disabled=slots.length>=9;addBtn.style.opacity=slots.length>=9?'0.4':'1';}
}
function _htSlotSave(){
  if(!_htTempSlots)return;
  localStorage.setItem('dash_hourly_slots',JSON.stringify(_htTempSlots));
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
    window.electronAPI.jsonSaveCommon('dash_hourly_slots',_htTempSlots);
  setTimeout(renderDashboard,100);
}

/* ── 기간 선택 달력 팝업 ── */
let _dcpYear,_dcpMonth,_dcpStart='',_dcpEnd='',_dcpPhase='start';
function _dashOpenCustomPicker(){
  const existing=document.getElementById('dashCustomPickerOv');if(existing)closeModalGracefully(existing);
  const now=new Date();_dcpYear=now.getFullYear();_dcpMonth=now.getMonth();
  _dcpStart=S._dashCustomStart||'';_dcpEnd=S._dashCustomEnd||'';_dcpPhase=_dcpStart?'end':'start';
  const ov=document.createElement('div');ov.id='dashCustomPickerOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9500;display:flex;align-items:center;justify-content:center';
  ov.addEventListener('click',function(e){if(e.target===ov){ov.remove();if(!S._dashCustomStart||!S._dashCustomEnd)setStatsPeriod('month');}});
  _dcpRender(ov);
  document.body.appendChild(ov);
}
function _dcpRender(ov){
  if(!ov)ov=document.getElementById('dashCustomPickerOv');if(!ov)return;
  const first=new Date(_dcpYear,_dcpMonth,1), last=new Date(_dcpYear,_dcpMonth+1,0);
  const startDay=first.getDay(), daysInMonth=last.getDate();
  const prevLast=new Date(_dcpYear,_dcpMonth,0).getDate();
  const today=toDateStr(new Date());
  /* 연도/월 팝업 */
  let yPop='<div class="mcal-popup">';
  { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++) yPop+='<div class="mcal-popup-item'+(y===_dcpYear?' active':'')+'" data-action="dcp-year" data-year="'+y+'">'+y+'</div>'; }
  yPop+='</div>';
  let mPop='<div class="mcal-popup" style="min-width:140px;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++) mPop+='<div class="mcal-popup-item'+(m===_dcpMonth?' active':'')+'" data-action="dcp-month" data-month="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
  mPop+='</div>';

  let h='<div style="background:var(--card);border-radius:14px;width:340px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,0.3);overflow:hidden">';
  h+='<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);background:var(--bg2)">';
  h+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px">📅 기간 선택</div>';
  h+='<div style="font-size:11px;color:var(--t2)">시작: <b style="color:'+(_dcpStart?'var(--cyan)':'var(--t3)')+'">'+(_dcpStart||'선택하세요')+'</b> ~ 종료: <b style="color:'+(_dcpEnd?'var(--cyan)':'var(--t3)')+'">'+(_dcpEnd||'선택하세요')+'</b></div>';
  h+='</div>';
  /* 달력 헤더 */
  h+='<div style="padding:8px 12px">';
  h+='<div class="mcal-hdr" style="margin-bottom:4px">';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-action="dcp-prev">◂</button></div>';
  h+='<div class="mcal-title"><span class="mcal-year">'+_dcpYear+'년'+yPop+'</span> <span class="mcal-month">'+monthNames[_dcpMonth]+mPop+'</span></div>';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-action="dcp-next">▸</button></div>';
  h+='</div>';
  /* 요일 헤더 + 날짜 */
  h+='<div class="mcal-grid">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){
    let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
    h+='<div class="'+cls+'">'+d+'</div>';
  });
  for(let i=startDay-1;i>=0;i--) h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
  for(let d=1;d<=daysInMonth;d++){
    const ds=toDateStr(new Date(_dcpYear,_dcpMonth,d));
    const dow=new Date(_dcpYear,_dcpMonth,d).getDay();
    const hol=isHoliday(ds);
    let cls='mcal-cell';
    if(ds===today)cls+=' today';
    if(dow===0)cls+=' sun';if(dow===6)cls+=' sat';
    if(hol&&dow!==0&&dow!==6)cls+=' holiday';
    if(ds===_dcpStart||ds===_dcpEnd)cls+=' selected';
    if(_dcpStart&&_dcpEnd&&ds>_dcpStart&&ds<_dcpEnd)cls+=' dcp-range';
    h+='<div class="'+cls+'" data-action="dcp-select" data-date="'+ds+'"><span class="day-n">'+d+'</span></div>';
  }
  const totalCells=startDay+daysInMonth;const rem=(7-totalCells%7)%7;
  for(let i=1;i<=rem;i++) h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
  h+='</div></div>';
  /* 버튼 */
  h+='<div style="padding:8px 12px 12px;display:flex;gap:8px;justify-content:flex-end">';
  h+='<button data-action="dcp-reset-picker" style="padding:5px 12px;font-size:10px;font-weight:600;background:transparent;color:var(--t3);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">초기화</button>';
  h+='<button data-action="dcp-apply" style="padding:5px 16px;font-size:10px;font-weight:700;background:var(--cyan);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)"'+(!_dcpStart||!_dcpEnd?' disabled style="padding:5px 16px;font-size:10px;font-weight:700;background:var(--bdr);color:var(--t3);border:none;border-radius:6px;cursor:default;font-family:var(--f)"':'')+'>적용</button>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='dcp-year'){_dcpYear=+el.dataset.year;_dcpRender();}
    else if(act==='dcp-month'){_dcpMonth=+el.dataset.month;_dcpRender();}
    else if(act==='dcp-prev'){_dcpMonth--;if(_dcpMonth<0){_dcpMonth=11;_dcpYear--;}_dcpRender();}
    else if(act==='dcp-next'){_dcpMonth++;if(_dcpMonth>11){_dcpMonth=0;_dcpYear++;}_dcpRender();}
    else if(act==='dcp-select'){_dcpSelectDate(el.dataset.date);}
    else if(act==='dcp-reset-picker'){_dcpStart='';_dcpEnd='';_dcpPhase='start';_dcpRender();}
    else if(act==='dcp-apply'){_dcpApply();}
  });
}
function _dcpSelectDate(ds){
  if(_dcpPhase==='start'){_dcpStart=ds;_dcpEnd='';_dcpPhase='end';}
  else{
    if(ds<_dcpStart){_dcpEnd=_dcpStart;_dcpStart=ds;}
    else _dcpEnd=ds;
    _dcpPhase='start';
  }
  _dcpRender();
}
function _dcpApply(){
  if(!_dcpStart||!_dcpEnd)return;
  S._dashCustomStart=_dcpStart;S._dashCustomEnd=_dcpEnd;
  const ov=document.getElementById('dashCustomPickerOv');if(ov)closeModalGracefully(ov);
  renderDashboard();
}

/* ── 기간 합계 (한줄 요약 바) ── */
function _dashRenderSummary(filtered){
  const panel=document.getElementById('dashPanelSummary');if(!panel)return;

  /* 백엔드 캐시 사용 (DB 기반 집계) */
  const total=_dashStatsCache?_dashStatsCache.total:0;
  const stuCount=_dashStatsCache?_dashStatsCache.studentTotal:0;
  const staffCount=_dashStatsCache?_dashStatsCache.staffTotal:0;
  const traumaCount=(_dashStatsCache&&_dashStatsCache.deptCounts['외상'])?_dashStatsCache.deptCounts['외상'].total:0;
  const infectCount=(_dashStatsCache&&_dashStatsCache.deptCounts['감염'])?_dashStatsCache.deptCounts['감염'].total:0;
  const prevTotal=_dashPrevCache?_dashPrevCache.total:0;
  const d1=_dashDelta(total,prevTotal);
  const traumaPct=total>0?(traumaCount/total*100).toFixed(1):'0';
  const infectPct=total>0?(infectCount/total*100).toFixed(1):'0';

  let h='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  /* 주요 수치 칩들 */
  h+='<span class="dash-sum-chip" style="--c:#7C9EF5">총 방문 <b>'+total+'</b>건</span>';
  h+='<span class="dash-sum-sep">│</span>';
  h+='<span class="dash-sum-chip" style="--c:#6DD4B8">학생 <b>'+stuCount+'</b>건</span>';
  h+='<span class="dash-sum-chip" style="--c:#F5A3D4">교직원 <b>'+staffCount+'</b>건</span>';
  const _sumCmpLabel={week:'지난 주 대비',month:'지난 달 대비',semester:'지난 학기 대비',year:'전년도 대비',today:'전일 대비'}[S.statsPeriod]||'전기간 대비';
  /* 증감·전년동기·인사이트는 화면엔 표시하되 PDF 사본에선 제거(dash-pdf-omit) — 사용자 요청 2026-08-12 (PDF 는 총방문/학생/교직원만) */
  if(d1.text&&prevTotal>0){
    h+='<span class="dash-sum-sep dash-pdf-omit">│</span>';
    h+='<span class="dash-sum-delta dash-pdf-omit '+d1.cls+'">'+_sumCmpLabel+' '+d1.text+'</span>';
  } else if(S.statsPeriod!=='today'&&prevTotal===0){
    h+='<span class="dash-sum-sep dash-pdf-omit">│</span>';
    h+='<span class="dash-pdf-omit" style="font-size:10px;color:var(--t3)">지난 데이터가 존재하지 않아 '+_sumCmpLabel+' 증감은 표시되지 않습니다.</span>';
  }
  /* 전년 동기 대비 — 백엔드 YoY 캐시 사용 */
  if(S.statsPeriod!=='today'&&S.statsPeriod!=='custom'){
    const _yoyTotal=_dashYoyCache?_dashYoyCache.total:0;
    if(_yoyTotal>0){
      const _yoyDiff=total-_yoyTotal;
      const _yoyCls=_yoyDiff>0?'up':_yoyDiff<0?'down':'flat';
      const _yoyTxt=_yoyDiff>0?'▲'+_yoyDiff+'건':_yoyDiff<0?'▼'+Math.abs(_yoyDiff)+'건':'동일';
      h+='<span class="dash-sum-sep dash-pdf-omit">│</span>';
      h+='<span class="dash-sum-delta dash-pdf-omit '+_yoyCls+'">전년 동기 대비 '+_yoyTxt+' <small style="opacity:0.7">('+_yoyTotal+'→'+total+')</small></span>';
    } else {
      h+='<span class="dash-sum-sep dash-pdf-omit">│</span>';
      h+='<span class="dash-sum-delta dash-pdf-omit flat">전년 동기 대비 —</span>';
    }
  }
  h+='</div>';

  /* 한줄 인사이트 — 백엔드 topSymptoms 캐시 사용 (PDF 사본 제외) */
  const topName=(_dashSummaryCache&&_dashSummaryCache.topSymptoms&&_dashSummaryCache.topSymptoms[0])?_dashSummaryCache.topSymptoms[0].symptom:'';
  if(topName){
    const cmpText=d1.cls==='up'?'증가':d1.cls==='down'?'감소':'동일';
    h+='<div class="dash-pdf-omit" style="margin-top:8px;font-size:10px;color:var(--t3)">💡 '+_sumCmpLabel+' '+cmpText+' · 최다 증상: <b style="color:var(--t2)">'+topName+'</b></div>';
  }
  panel.innerHTML=h;
}

/* ── 증상 분포 (가로 막대) — 백엔드 DB 집계 사용 ── */
function _dashRenderSymptoms(filtered){
  const panel=document.getElementById('dashPanelSymptoms');if(!panel)return;
  /* 백엔드 캐시의 topSymptoms 사용 (DB 기반) */
  const sorted=(_dashSummaryCache&&_dashSummaryCache.topSymptoms)?_dashSummaryCache.topSymptoms.slice(0,10):[];
  const total=sorted.reduce(function(s,e){return s+e[1];},0)||1;
  if(!sorted.length){panel.innerHTML=_dashEmptyHtml('기록된 증상이 없습니다.');return;}
  const maxV=sorted[0][1];
  let h='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">🩺 증상 분포</div>';
  h+='<div style="display:flex;align-items:flex-end;gap:4px;height:100px;padding:0 4px;margin-bottom:4px">';
  sorted.forEach(function(e,i){
    const pct=(e[1]/maxV*100).toFixed(0);
    const bg=_dashPastel[i%_dashPastel.length];
    h+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">';
    h+='<span style="font-size:9px;font-family:var(--fm);color:var(--t1);font-weight:700">'+e[1]+'</span>';
    h+='<div style="width:100%;height:'+pct+'%;min-height:3px;background:'+bg+';border-radius:4px 4px 0 0;transition:height 0.6s ease-out" title="'+e[0]+' '+e[1]+'건 ('+(e[1]/total*100).toFixed(1)+'%)"></div>';
    h+='</div>';
  });
  h+='</div>';
  h+='<div style="display:flex;gap:4px;padding:0 4px">';
  sorted.forEach(function(e){
    h+='<div style="flex:1;text-align:center;min-width:0;display:flex;flex-direction:column;align-items:center"><span style="writing-mode:vertical-rl;font-size:10px;color:var(--t2);font-weight:600;letter-spacing:1px;white-space:nowrap">'+e[0]+'</span></div>';
  });
  h+='</div>';
  panel.innerHTML=h;
}

/* ── 처치 요약 (가로 막대 + TOP5 카드) — 백엔드 DB 집계 사용 ── */
function _dashRenderTreatment(filtered){
  const panel=document.getElementById('dashPanelTreatment');if(!panel)return;
  /* 백엔드 캐시의 topTreatments 사용 (DB 기반) */
  const sorted=(_dashTreatCache&&_dashTreatCache.topTreatments)?_dashTreatCache.topTreatments:[];
  if(!sorted.length){panel.innerHTML=_dashEmptyHtml('기록된 처치가 없습니다.');return;}
  const maxV=sorted[0][1];
  const topItems=sorted.slice(0,10);
  let h='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">💊 처치 요약</div>';
  h+='<div style="display:flex;align-items:flex-end;gap:4px;height:120px;padding:0 4px;margin-bottom:4px">';
  topItems.forEach(function(e,i){
    const pct=(e[1]/maxV*100).toFixed(0);
    h+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">';
    h+='<span style="font-size:9px;font-family:var(--fm);color:var(--t1);font-weight:700">'+e[1]+'</span>';
    h+='<div style="width:100%;height:'+pct+'%;min-height:3px;background:'+_dashPastel[i%_dashPastel.length]+';border-radius:4px 4px 0 0;transition:height 0.6s ease-out" title="'+e[0]+' '+e[1]+'건"></div>';
    h+='</div>';
  });
  h+='</div>';
  h+='<div style="display:flex;gap:4px;padding:0 4px;margin-bottom:12px">';
  topItems.forEach(function(e){
    h+='<div style="flex:1;text-align:center;min-width:0;display:flex;flex-direction:column;align-items:center"><span style="writing-mode:vertical-rl;font-size:9px;color:var(--t2);font-weight:600;letter-spacing:1px;white-space:nowrap">'+e[0]+'</span></div>';
  });
  h+='</div>';

  /* 투약/연고/파스 TOP5 — 투여량 분리 후 약명으로만 카운트 */
  const medCount={}, ointCount={}, patchCount={};
  filtered.forEach(function(r){
    const _medStr5=_statMedicationStr(r); /* 합성칩 안 투약 합산 (2026-06-09) */
    if(!_medStr5)return;
    _medStr5.split(', ').forEach(function(m){
      if(!m)return;
      let name;
      if(m.indexOf('연고(')===0||m.indexOf('연고 (')===0){name=m.replace(/^연고\s*\(/,'').replace(/\)$/,'');ointCount[name]=(ointCount[name]||0)+1;}
      else if(m.indexOf('파스(')===0||m.indexOf('파스 (')===0){name=m.replace(/^파스\s*\(/,'').replace(/\)$/,'');patchCount[name]=(patchCount[name]||0)+1;}
      else{
        name=m.replace(/^투약\s*\(/,'').replace(/\)$/,'');
        /* 새 포맷 "약명(투여량)" 의 투여량 분리 → 약명만 카운트 */
        name=name.replace(/\s*\([^)]*\)\s*$/,'').trim();
        if(name)medCount[name]=(medCount[name]||0)+1;
      }
    });
  });
  function top5Html(title,icon,data){
    const entries=Object.entries(data).sort(function(a,b){return b[1]-a[1];}).slice(0,5);
    let html='<div class="dash-mini-card"><div class="dmc-title">'+icon+' '+title+'</div>';
    if(!entries.length) html+='<div style="font-size:10px;color:var(--t3);padding:8px 0">데이터 없음</div>';
    entries.forEach(function(e,i){
      html+='<div class="dmc-row"'+(i===0?' style="font-weight:700"':'')+'><span class="dmc-rank">'+(i+1)+'</span><span class="dmc-name">'+e[0]+'</span><span class="dmc-cnt">'+e[1]+'</span></div>';
    });
    html+='</div>';return html;
  }
  h+='<div style="display:flex;gap:10px;flex-wrap:wrap">';
  h+=top5Html('투약 TOP5','💊',medCount);
  h+=top5Html('연고 TOP5','🧴',ointCount);
  h+=top5Html('파스 TOP5','🩹',patchCount);
  h+='</div>';
  panel.innerHTML=h;
}

/* ── 방문 현황 (2단계 구현 예정, 임시) ── */
let _dashVisitMode='all'; /* all, student, staff */
function _dashRenderVisits(filtered){
  _dashRenderVisitsChart(filtered);
}
function _dashRenderVisitsChart(filtered){
  const panel=document.getElementById('dashPanelVisitsChart');if(!panel)return;
  if(!filtered.length){panel.innerHTML=_dashEmptyHtml();return;}
  /* 세그먼트 컨트롤 */
  let h='<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1)">📊 방문 현황</div>';
  h+='<div style="display:inline-flex;border-radius:8px;border:1px solid var(--bdr);overflow:hidden">';
  ['all','student','staff'].forEach(function(m){
    const label=m==='all'?'전체':m==='student'?'학생':'교직원';
    const isActive=_dashVisitMode===m;
    h+='<button data-action="visit-mode" data-mode="'+m+'" style="padding:4px 14px;font-size:10px;font-weight:'+(isActive?'700':'500')+';border:none;cursor:pointer;font-family:var(--f);background:'+(isActive?'rgba(6,182,212,0.12)':'transparent')+';color:'+(isActive?'var(--cyan)':'var(--t3)')+'">'+label+'</button>';
  });
  h+='</div></div>';

  /* 필터 적용 */
  let data=filtered;
  if(_dashVisitMode==='student') data=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type!=='staff';});
  else if(_dashVisitMode==='staff') data=filtered.filter(function(r){const s=getStu(r.studentId);return s&&s.type==='staff';});

  /* 일별 집계 */
  const dayCount={};data.forEach(function(r){dayCount[r.date]=(dayCount[r.date]||0)+1;});
  const allDays=Object.keys(dayCount).sort();
  if(!allDays.length){panel.innerHTML=h+_dashEmptyHtml();return;}

  /* SVG Area Chart */
  const labels=allDays.map(function(d){return d.substring(5);});
  const values=allDays.map(function(d){return dayCount[d];});
  const maxV=Math.max.apply(null,values)||1;
  const svgW=Math.max(panel.clientWidth-40,250);const svgH=110;
  const padX=26, padY=14, chartW=svgW-padX*2, chartH=svgH-padY*2;
  const step=values.length>1?chartW/(values.length-1):chartW;
  const accentColor='#7C9EF5';

  const pts=values.map(function(v,i){
    const x=padX+(values.length>1?i*step:chartW/2);
    const y=padY+chartH-(v/maxV)*chartH;
    return {x:x,y:y,v:v,label:labels[i]};
  });
  const polyLine=pts.map(function(p){return p.x+','+p.y;}).join(' ');
  const polyArea=padX+','+(padY+chartH)+' '+polyLine+' '+pts[pts.length-1].x+','+(padY+chartH);

  let svg='<svg viewBox="0 0 '+svgW+' '+svgH+'" style="width:100%;height:'+svgH+'px">';
  svg+='<defs><linearGradient id="dashAreaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+accentColor+'" stop-opacity="0.3"/><stop offset="100%" stop-color="'+accentColor+'" stop-opacity="0.02"/></linearGradient></defs>';
  /* 그리드 */
  for(let gi=0;gi<=4;gi++){
    const gy=padY+(chartH/4)*gi;
    svg+='<line x1="'+padX+'" y1="'+gy+'" x2="'+(svgW-padX)+'" y2="'+gy+'" stroke="var(--bdr)" stroke-width="0.5" stroke-dasharray="3,3"/>';
    svg+='<text x="'+(padX-4)+'" y="'+(gy+3)+'" text-anchor="end" fill="var(--t3)" font-size="8" font-family="var(--fm)">'+Math.round(maxV*(4-gi)/4)+'</text>';
  }
  /* 영역 */
  svg+='<polygon points="'+polyArea+'" fill="url(#dashAreaGrad)"/>';
  /* 선 */
  svg+='<polyline points="'+polyLine+'" fill="none" stroke="'+accentColor+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  /* 점 + 레이블 */
  pts.forEach(function(p,i){
    svg+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3.5" fill="'+accentColor+'" stroke="var(--card)" stroke-width="2"/>';
    if(values.length<=14||i%Math.ceil(values.length/14)===0){
      svg+='<text x="'+p.x+'" y="'+(p.y-8)+'" text-anchor="middle" fill="var(--t2)" font-size="9" font-family="var(--fm)">'+p.v+'</text>';
      svg+='<text x="'+p.x+'" y="'+(svgH-2)+'" text-anchor="middle" fill="var(--t3)" font-size="8" font-family="var(--f)">'+p.label+'</text>';
    }
  });
  svg+='</svg>';
  h+='<div style="overflow-x:auto;scrollbar-width:thin">'+svg+'</div>';

  /* 전일 대비 요약 */
  if(allDays.length>=2){
    const last=dayCount[allDays[allDays.length-1]];
    const prev=dayCount[allDays[allDays.length-2]];
    const diff=last-prev;
    h+='<div style="margin-top:6px;font-size:10px;color:var(--t3)">최근일 '+allDays[allDays.length-1].substring(5)+': '+last+'건 (전일 대비 <span style="color:'+(diff>=0?'#16a34a':'#dc2626')+'">'+(diff>=0?'+':'')+diff+'건</span>)</div>';
  }

  panel.innerHTML=h;
  _dashBindPanelDelegation(panel);
}

/* ── 진료과별 분포 ── */
function _dashRenderDeptDist(filtered){
  const panel=document.getElementById('dashPanelDeptDist');if(!panel)return;
  if(!filtered.length){panel.innerHTML=_dashEmptyHtml('기록된 진료과가 없습니다.');return;}
  const deptCount={};
  filtered.forEach(function(r){
    if(r.dept){r.dept.split(', ').forEach(function(d){if(d)deptCount[d]=(deptCount[d]||0)+1;});}
  });
  const sorted=Object.entries(deptCount).sort(function(a,b){return b[1]-a[1];});
  if(!sorted.length){panel.innerHTML=_dashEmptyHtml('기록된 진료과가 없습니다.');return;}
  const maxV=sorted[0][1];
  const top=sorted.slice(0,10);
  let h='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">🏥 진료과별 분포</div>';
  h+='<div style="display:flex;align-items:flex-end;gap:4px;height:100px;padding:0 4px;margin-bottom:4px">';
  top.forEach(function(e,i){
    const pct=(e[1]/maxV*100).toFixed(0);
    h+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">';
    h+='<span style="font-size:9px;font-family:var(--fm);color:var(--t1);font-weight:700">'+e[1]+'</span>';
    h+='<div style="width:100%;height:'+pct+'%;min-height:3px;background:'+_dashPastel[i%_dashPastel.length]+';border-radius:4px 4px 0 0;transition:height 0.6s ease-out" title="'+e[0]+' '+e[1]+'건"></div>';
    h+='</div>';
  });
  h+='</div>';
  h+='<div style="display:flex;gap:4px;padding:0 4px">';
  top.forEach(function(e){
    h+='<div style="flex:1;text-align:center;min-width:0;display:flex;flex-direction:column;align-items:center"><span style="writing-mode:vertical-rl;font-size:9px;color:var(--t2);font-weight:600;letter-spacing:1px;white-space:nowrap">'+e[0]+'</span></div>';
  });
  h+='</div>';
  panel.innerHTML=h;
}

/* ── 학년별 분포 ── */
function _dashRenderGrade(filtered){
  const panel=document.getElementById('dashPanelGrade');if(!panel)return;
  const gradeCount={};
  const registeredGrades=S.people.filter(function(s){return s.type==='student';}).map(function(s){return parseInt(s.grade,10)||0;}).filter(function(g){return g>0;});
  const maxG=registeredGrades.length?Math.max.apply(null,registeredGrades):0;
  const grades=maxG>0?Array.from({length:maxG},function(_,i){return i+1;}):getGrades();
  grades.forEach(function(g){gradeCount[g]=0;});
  filtered.forEach(function(r){const s=getStu(r.studentId);if(s&&gradeCount[s.grade]!==undefined)gradeCount[s.grade]++;});
  const entries=Object.entries(gradeCount).sort(function(a,b){return +a[0]-+b[0];});
  const maxV=Math.max.apply(null,entries.map(function(e){return e[1];}))||1;
  const gradeLabel=S.settings.schoolLevel==='kindergarten'?'세':'학년';
  const gradeTotal=entries.reduce(function(s,e){return s+e[1];},0);
  if(!entries.length||gradeTotal===0){panel.innerHTML=_dashEmptyHtml();return;}

  let h='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:12px">🎓 학년별 분포 <span style="font-weight:500;font-size:11px;color:var(--t3)">총 '+gradeTotal+'건</span></div>';

  /* 수직 막대 차트 */
  h+='<div style="background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:10px;padding:16px 12px 8px;margin-bottom:16px">';
  h+='<div style="display:flex;align-items:flex-end;gap:8px;height:180px;padding:0 10px">';
  entries.forEach(function(e,i){
    const pct=(e[1]/maxV*100).toFixed(0);
    const ratio=(e[1]/gradeTotal*100).toFixed(1);
    h+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default" title="'+e[0]+gradeLabel+': '+e[1]+'건 ('+ratio+'%)">';
    h+='<span style="font-size:10px;font-family:var(--fm);color:var(--t1);font-weight:700">'+e[1]+'</span>';
    h+='<div style="width:100%;max-width:52px;height:'+pct+'%;min-height:4px;background:linear-gradient(180deg,'+_dashPastel[i%_dashPastel.length]+','+_dashPastel[i%_dashPastel.length]+'aa);border-radius:6px 6px 0 0;transition:height 0.6s ease-out;box-shadow:0 -2px 8px '+_dashPastel[i%_dashPastel.length]+'33"></div>';
    h+='<span style="font-size:10px;color:var(--t2);font-weight:600">'+e[0]+gradeLabel+'</span>';
    h+='</div>';
  });
  h+='</div></div>';

  /* 학년별 상세 테이블 */
  h+='<div style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden">';
  h+='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg2)"><th style="text-align:left;padding:8px 10px;color:var(--t3);font-weight:600">학년</th><th style="text-align:center;padding:8px 8px;color:var(--t3);font-weight:600">방문수</th><th style="text-align:center;padding:8px 8px;color:var(--t3);font-weight:600">비율</th><th style="text-align:left;padding:8px 8px;color:var(--t3);font-weight:600">주요증상 TOP3</th><th style="text-align:center;padding:8px 8px;color:var(--t3);font-weight:600">외상비율</th></tr></thead><tbody>';
  entries.forEach(function(e,i){
    const gRecs=filtered.filter(function(r){const s=getStu(r.studentId);return s&&String(s.grade)===String(e[0]);});
    const symC={};
    let traumaC=0;
    const traumaCats=['넘어짐','부딪힘','찰과상','열상','베임','찔림','타박상','접질림','화상','골절 의심'];
    gRecs.forEach(function(r){r.symptoms.forEach(function(s){symC[s]=(symC[s]||0)+1;if(traumaCats.indexOf(s)!==-1)traumaC++;});});
    const topSyms=Object.entries(symC).sort(function(a,b){return b[1]-a[1];}).slice(0,3).map(function(s){return s[0];}).join(', ')||'-';
    const traumaPct=gRecs.length>0?(traumaC/gRecs.length*100).toFixed(0)+'%':'0%';
    const ratio=(e[1]/gradeTotal*100).toFixed(1);
    h+='<tr style="border-bottom:1px solid var(--bdr);transition:background 0.15s" class="dash-hover-row">';
    h+='<td style="padding:8px 10px;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:'+_dashPastel[i%_dashPastel.length]+';margin-right:6px;vertical-align:middle"></span>'+e[0]+gradeLabel+'</td>';
    h+='<td style="text-align:center;padding:8px 8px;font-family:var(--fm);font-weight:700">'+e[1]+'</td>';
    h+='<td style="text-align:center;padding:8px 8px;font-family:var(--fm);color:var(--t2)">'+ratio+'%</td>';
    h+='<td style="padding:8px 8px;color:var(--t2)">'+topSyms+'</td>';
    h+='<td style="text-align:center;padding:8px 8px;font-family:var(--fm)">'+traumaPct+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  panel.innerHTML=h;
  _dashBindPanelDelegation(panel);
}

/* ── 요보호 학생 ── */
function _dashRenderCare(filtered){
  const panel=document.getElementById('dashPanelCare');if(!panel)return;
  const careStudents=S.people.filter(function(s){return s.status==='caution'||s.status==='watch';});
  const totalStu=S.people.filter(function(s){return s.type!=='staff';}).length||1;
  const carePct=(careStudents.length/totalStu*100).toFixed(1);
  /* 백엔드 DB 기반 재방문 통계 사용 */
  /* v9: person_uid 우선, 구 스키마 student_id fallback */
  const repeatVisitors=(_dashRepeatCache&&_dashRepeatCache.visitors)?_dashRepeatCache.visitors.map(function(v){
    /* 백엔드 반환 필드: studentId/count/topSymptoms (camelCase, 객체 배열) — 구 snake_case 폴백 유지 */
    const sid=String(v.studentId||v.student_id||v.person_uid||'');
    const cnt=v.count||v.visit_count||0;
    const syms=v.topSymptoms||v.top_symptoms||'-';
    /* topSymptoms 가 배열([{symptom,count},...])이면 상위 2개만 문자열화 */
    const symStr=Array.isArray(syms)?syms.slice(0,3).map(function(x){return x.symptom||x;}).join(', ')||'-':String(syms||'-');
    return [sid,cnt,symStr];
  }):[];

  let h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
  h+='<span style="font-size:11px;font-weight:700;color:var(--t1)">🔔 요보호</span>';
  h+='<span style="font-size:11px;color:var(--t2)">총 <b style="color:var(--t1)">'+careStudents.length+'</b>명 (주의 '+S.people.filter(function(s){return s.status==='caution';}).length+' · 관찰 '+S.people.filter(function(s){return s.status==='watch';}).length+')</span>';
  h+='<span class="dash-sum-sep">│</span>';
  h+='<span style="font-size:11px;color:var(--t2)">전교생 대비 <b style="color:var(--t1)">'+carePct+'%</b></span>';
  h+='<span class="dash-sum-sep">│</span>';
  h+='<span style="font-size:11px;color:var(--t2)">반복방문(3회+) <b style="color:#F5A3A3">'+repeatVisitors.length+'</b>명</span>';
  h+='</div>';

  /* 학년별 요보호 분포 막대그래프 */
  if(careStudents.length>0){
    const gradeLabel=S.settings.schoolLevel==='kindergarten'?'세':'학년';
    const carGrade={};
    careStudents.forEach(function(s){const g=s.grade||0;if(g>0)carGrade[g]=(carGrade[g]||0)+1;});
    const carEntries=Object.entries(carGrade).sort(function(a,b){return +a[0]-+b[0];});
    const carMax=Math.max.apply(null,carEntries.map(function(e){return e[1];}))||1;
    if(carEntries.length){
      h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px">학년별 요보호 학생 분포</div>';
      h+='<div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:0 20px;margin-bottom:20px">';
      carEntries.forEach(function(e,i){
        const pct=(e[1]/carMax*100).toFixed(0);
        h+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">';
        h+='<span style="font-size:10px;font-family:var(--fm);color:var(--t1);font-weight:600">'+e[1]+'</span>';
        h+='<div style="width:100%;max-width:40px;height:'+pct+'%;min-height:4px;background:'+_dashPastel[(i+4)%_dashPastel.length]+';border-radius:6px 6px 0 0;transition:height 0.6s ease-out"></div>';
        h+='<span style="font-size:10px;color:var(--t2);font-weight:600">'+e[0]+gradeLabel+'</span>';
        h+='</div>';
      });
      h+='</div>';
    }
  }

  /* 반복 방문 학생 리스트 */
  if(repeatVisitors.length){
    h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px">반복 방문 학생 리스트 <span style="font-weight:500;color:var(--t3)">(선택 기간 내 3회 이상)</span></div>';
    h+='<div style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden">';
    h+='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg2)"><th style="text-align:left;padding:8px 10px;color:var(--t3);font-weight:600">이름</th><th style="text-align:center;padding:8px 6px;color:var(--t3);font-weight:600">학년/반</th><th style="text-align:center;padding:8px 6px;color:var(--t3);font-weight:600">방문횟수</th><th style="text-align:left;padding:8px 6px;color:var(--t3);font-weight:600">주요증상</th><th style="text-align:center;padding:8px 6px;color:var(--t3);font-weight:600">상태</th></tr></thead><tbody>';
    repeatVisitors.forEach(function(rv){
      /* rv[0]이 's0289' 같은 문자열 uid 이므로 숫자 변환 금지 */
      const stu=getStu(rv[0]);if(!stu)return;
      const cnt=rv[1];
      /* 백엔드에서 이미 top_symptoms를 제공 */
      const topSym=rv[2]||'-';
      const badge=cnt>=5?'<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,0.15);color:#ef4444;font-size:9px;line-height:18px;text-align:center;font-weight:700">'+cnt+'</span>':'<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:rgba(234,179,8,0.15);color:#eab308;font-size:9px;line-height:18px;text-align:center;font-weight:700">'+cnt+'</span>';
      const isStaff=stu.type==='staff';
      const info=isStaff?(stu.position||'교직원'):(stu.grade+'-'+stu.cls);
      h+='<tr style="border-bottom:1px solid var(--bdr);transition:background 0.15s" class="dash-hover-row"><td style="padding:8px 10px;font-weight:600">'+escHtml(stu.name)+'</td><td style="text-align:center;padding:8px 6px">'+info+'</td><td style="text-align:center;padding:8px 6px">'+badge+'</td><td style="padding:8px 6px;color:var(--t2)">'+topSym+'</td><td style="text-align:center;padding:8px 6px">'+(cnt>=5?'🔴':'🟡')+'</td></tr>';
    });
    h+='</tbody></table></div>';
    h+='<div style="display:flex;gap:12px;font-size:10px;color:var(--t3);margin-top:8px"><span>🔴 5회 이상</span><span>🟡 3~4회</span></div>';
  } else {
    h+='<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">선택 기간 내 3회 이상 반복 방문 학생이 없습니다.</div>';
  }
  panel.innerHTML=h;
  _dashBindPanelDelegation(panel);
}

/* ── Event delegation helpers (replaces inline onclick/onmouseenter/onmouseleave) ── */

/** Bind common delegation to a panel (click actions + hover effects + tooltips) */
function _dashBindPanelDelegation(container){
  /* 중복 바인딩 방지 — 같은 컨테이너에 대해 두 번 이상 호출되어도 리스너가 한 번만 부착되도록 플래그로 가드
     (이전에는 _deptStatsExcel 등이 3번 호출되어 toast 가 3번 울리는 원인이었음) */
  if(container.__dashDelegated)return;
  container.__dashDelegated=true;
  /* Click delegation */
  container.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='copy-element'){const targetEl=document.getElementById(el.dataset.el);_dashCopyElement(targetEl,el.dataset.toast);}
    else if(act==='dept-copy')_deptStatsCopy();
    else if(act==='dept-excel')_deptStatsExcel();
    else if(act==='dept-png')_deptStatsPng();
    else if(act==='dept-pdf')_deptStatsPdf();
    else if(act==='dept-sheet')_deptStatsSheet();
    else if(act==='hourly-settings')_dashHourlySettings();
    else if(act==='uncat-tool')_dashOpenUncatTool();
    else if(act==='toggle-finviz'){_dashHmFinviz=!_dashHmFinviz;localStorage.setItem('dash_hm_finviz',_dashHmFinviz);renderDashboard();}
    else if(act==='visit-mode'){_dashVisitMode=el.dataset.mode;const _vp=document.getElementById('dashPanelVisitsChart');if(_vp){_vp.style.transition='opacity 0.15s';_vp.style.opacity='0';setTimeout(function(){_dashRenderVisitsChart(getFilteredRecords());_vp.style.opacity='1';},150);}}
  });
  /* Checkbox delegation — dashNurseChk */
  const _nurseChk=container.querySelector('#dashNurseChk');
  if(_nurseChk)_nurseChk.addEventListener('change',function(){localStorage.setItem('ec_dashNurseChk',this.checked?'Y':'N');renderDashboard();});
  /* Hover: copy buttons opacity */
  container.addEventListener('mouseenter',function(e){
    if(e.target.classList.contains('dash-copy-btn'))e.target.style.opacity='1';
    if(e.target.classList.contains('dash-hover-row'))e.target.style.background='rgba(255,255,255,0.04)';
    if(e.target.classList.contains('dash-hover-red')){e.target.style.opacity='1';e.target.style.color='#ef4444';}
  },true);
  container.addEventListener('mouseleave',function(e){
    if(e.target.classList.contains('dash-copy-btn'))e.target.style.opacity=e.target.style.opacity==='0.35'?'0.35':'0.3';
    if(e.target.classList.contains('dash-hover-row'))e.target.style.background='transparent';
    if(e.target.classList.contains('dash-hover-red')){e.target.style.opacity='0.5';e.target.style.color='var(--t3)';}
  },true);
  /* Hover: tooltip show/hide via data-tip (show/hide child element by id) */
  container.addEventListener('mouseenter',function(e){
    const el=e.target.closest('[data-tip]');if(!el)return;
    const t=document.getElementById(el.dataset.tip);if(t)t.style.display='block';
    if(el.dataset.hoverBrightness)el.style.filter='brightness(1.15)';
  },true);
  container.addEventListener('mouseleave',function(e){
    const el=e.target.closest('[data-tip]');if(!el)return;
    const t=document.getElementById(el.dataset.tip);if(t)t.style.display='none';
    if(el.dataset.hoverBrightness)el.style.filter='';
  },true);
  /* Hover: tooltip via data-tooltip-key (showHeaderTooltipHtml) */
  container.addEventListener('mouseenter',function(e){
    const el=e.target.closest('[data-tooltip-key]');if(!el)return;
    showHeaderTooltipHtml(e,window[el.dataset.tooltipKey]);
    if(el.dataset.hoverBrightness)el.style.filter='brightness(1.15)';
    if(String(el.dataset.tooltipKey||'').indexOf('_fvTip_')===0){_fvXY={x:e.clientX,y:e.clientY};_fvStartFollow();}
    else _fvStopFollow();
  },true);
  /* 핀비즈 히트맵 셀 — 미니 팝업이 마우스 커서 아래를 따라다님 (사용자 요청 2026-06-11).
     showHeaderTooltip 이 600ms 지연 후 요소 기준 좌표를 덮어쓰므로, 호버 중 rAF 루프로 매 프레임 커서 좌표를 재적용. */
  let _fvXY=null,_fvRaf=null;
  function _fvApply(){
    if(!_fvXY)return;
    const tip=document.getElementById('headerTooltipPopup');
    if(!tip||tip.style.display==='none')return;
    let _zf=1;
    try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
    const tw=tip.offsetWidth||280, th=tip.offsetHeight||80;
    const vw=window.innerWidth/_zf, vh=window.innerHeight/_zf;
    let lx=_fvXY.x/_zf - tw/2;            /* 커서 가로 중앙 정렬 */
    let ty=_fvXY.y/_zf + 18;              /* 커서 아래 18px */
    if(lx<8)lx=8; if(lx+tw>vw-8)lx=vw-8-tw;
    if(ty+th>vh-8)ty=_fvXY.y/_zf - th - 14; /* 화면 아래가 모자라면 커서 위로 */
    tip.style.left=lx+'px'; tip.style.top=ty+'px';
  }
  function _fvStartFollow(){ if(_fvRaf)return; const step=function(){ _fvRaf=requestAnimationFrame(step); _fvApply(); }; _fvRaf=requestAnimationFrame(step); }
  function _fvStopFollow(){ if(_fvRaf){cancelAnimationFrame(_fvRaf);_fvRaf=null;} _fvXY=null; }
  container.addEventListener('mousemove',function(e){
    if(!_fvRaf)return;
    _fvXY={x:e.clientX,y:e.clientY};
  });
  container.addEventListener('mouseleave',function(e){
    const el=e.target.closest('[data-tooltip-key]');if(!el)return;
    hideHeaderTooltip();
    if(el.dataset.hoverBrightness)el.style.filter='';
    if(String(el.dataset.tooltipKey||'').indexOf('_fvTip_')===0)_fvStopFollow();
  },true);
}

/** Bind events for hourly time slot inputs */
function _htBindInputEvents(container){
  container.querySelectorAll('.ht-time-input').forEach(function(input){
    input.addEventListener('click',function(){this.select();});
    input.addEventListener('dblclick',function(){_htOpenScroll(this,+this.dataset.idx,this.dataset.field);});
    input.addEventListener('change',function(){_htSlotChange(+this.dataset.idx,this.dataset.field,this.value);});
    input.addEventListener('wheel',function(e){_htTimeWheel(e,this,+this.dataset.idx,this.dataset.field);});
  });
}

/* ── Expose to global scope ── */

/* 내보내기 & 클립보드 복사 */

/* 외부 진입점: 보건일지 출력 등에서 "방문 통계" 버튼으로 호출 — 진료과별 통계 팝업 오픈 */
export function dashOpenDeptStatsOverlay(){
  _dashOpenDeptStats();
}

/* 대시보드 인물 클릭 → 해당 날짜로 이동 후 증상 팝업 오픈 */
export function dashOpenSymForRec(recId,date){
  if(!recId)return;
  if(date)selectDate(date);
  setTimeout(function(){
    openSymptomCategoryPopup(recId);
  },150);
}

/* ═══════════════════════════════════════
   방문 순위 / 상담실적 — 기간 탭 우측 별도 뷰 (사용자 요청 2026-06-12)
   대상 |학생|교직원|학생&교직원| → 학생: 전체·남·여·학년반 / 교직원: 전체·남·여 / 전체: 전체·남·여
   엑셀 내보내기 = 시트 3장(학생/교직원/학생·교직원), 색상바 비주얼(xlsx-build-visit-rank).
   ═══════════════════════════════════════ */
let _rk={target:'student',period:'month',start:'',end:''};
let _rkCalY=new Date().getFullYear(),_rkCalM=new Date().getMonth(),_rkCalTarget='start';

export function dashShowSubView(view){
  const rankPanel=document.getElementById('dashRankPanel');
  const contentArea=document.getElementById('dashContentArea');
  const subTabArea=document.getElementById('dashSubTabArea');
  if(!rankPanel||!contentArea)return;
  document.querySelectorAll('#dashPeriodTabs .stats-period-tab[data-dash-view]').forEach(function(t){
    t.classList.toggle('active', t.dataset.dashView===view);
  });
  if(view==='stats'){
    rankPanel.style.display='none';
    contentArea.style.display='';
    return; /* 기간 탭 active 는 renderDashboard 가 처리 */
  }
  document.querySelectorAll('#dashPeriodTabs .stats-period-tab[data-period]').forEach(function(t){t.classList.remove('active');});
  contentArea.style.display='none';
  if(subTabArea)subTabArea.style.display='none';
  rankPanel.style.display='';
  /* 흰 캔버스가 하단 글래스모피즘 직전까지 내려오도록 — '오늘' 클릭 시와 동일하게 캔버스 max-height(100vh-210px)에
   *  확실히 도달하게 내용 최소 높이를 그보다 크게 줌(캔버스가 max 에서 클램프). (사용자 요청 2026-06-12) */
  rankPanel.style.minHeight='calc(100vh - 215px)';
  if(view==='counsel'){
    /* _rk/_crk 클릭 핸들러는 각자 [data-rk]/[data-crk] 마커로 가드하므로 둘 다 상시 바인딩 유지(중복 방지). */
    _crkRender();
    return;
  }
  _rkRender();
}

/* ═══════════════════════════════════════
   상담실적 — 증상 팝업 상담록(rec.counselLog) 기반 집계 (사용자 요청 2026-06-12)
   기간 칩 | 요약 카드(상담 건수·인원·재상담 예정) | 주제별 건수 표 | 상담 기록 리스트
   ═══════════════════════════════════════ */
let _crkPeriod='month';
let _crkStart='', _crkEnd='';
let _crkCalY=new Date().getFullYear(), _crkCalM=new Date().getMonth(), _crkCalTarget='start';
let _crkPerson=null; /* 선택된 인원 정규화 키(uid 우선) — 설정 시 그 인원의 상담만 필터 (사용자 요청 2026-06-13) */
let _crkOffset=0;    /* 기간 이전/이후 이동 단위 (◂▸ 화살표) — 0=현재, -1=이전, +1=이후 (2026-06-13) */
/* id/uid/studentId 어떤 형태든 같은 인원이면 같은 키로 정규화 — openPersonSearch(=s.id)와 record.studentId(=uid) 불일치 방지 */
function _crkResolveKey(idOrUid){ const s=getStu(idOrUid); return s?String(s.uid||s.id):String(idOrUid||''); }
/* PDF 소속 풀표기 — 학교급 여러개면 학교급, 학과 있으면 학과, "1학년 1반 2번" 형태 (사용자 요청 2026-06-13) */
function _crkBelongFull(p){
  if(!p)return '';
  if(p.type==='staff')return p.position||'교직원';
  const multi=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const lv=multi?(getLevelShort(p)||''):'';
  const dept=(p.department||'').trim();
  const g=(p.grade!=null&&p.grade!=='')?p.grade+'학년':'';
  const c=(p.cls!=null&&p.cls!=='')?' '+p.cls+'반':'';
  const n=(p.num!=null&&p.num!=='')?' '+p.num+'번':'';
  return ((lv?lv+' ':'')+(dept?dept+' ':'')+g+c+n).trim();
}
function _crkLogOf(r){ return (r&&r.counselLog&&typeof r.counselLog==='object'&&!Array.isArray(r.counselLog))?r.counselLog:null; }
function _crkHas(cl){ return cl&&['content','action','plan','opinion'].some(function(k){return String(cl[k]||'').trim();}); }
/* ◂▸ 화살표 이동 — _crkOffset 만큼 기준 날짜를 그 기간 단위로 이동시켜 범위 계산 (2026-06-13) */
function _crkRefDate(){
  const now=new Date();
  const o=_crkOffset||0;
  if(_crkPeriod==='today')   return new Date(now.getFullYear(),now.getMonth(),now.getDate()+o);
  if(_crkPeriod==='week')    return new Date(now.getFullYear(),now.getMonth(),now.getDate()+o*7);
  if(_crkPeriod==='month')   return new Date(now.getFullYear(),now.getMonth()+o,1);
  if(_crkPeriod==='semester')return new Date(now.getFullYear(),now.getMonth()+o*6,1);
  if(_crkPeriod==='year')    return new Date(now.getFullYear()+o,now.getMonth(),1);
  return now;
}
function _crkRange(){
  const ref=_crkRefDate();
  const y=ref.getFullYear(),m=ref.getMonth();
  if(_crkPeriod==='today'){const d=_rkDs(ref);return {from:d,to:d,label:d+' ('+(_crkOffset===0?'오늘':getDow(d))+')'};}
  if(_crkPeriod==='week'){
    const dow=(ref.getDay()+6)%7;
    const mon=new Date(y,m,ref.getDate()-dow), sun=new Date(y,m,ref.getDate()-dow+6);
    return {from:_rkDs(mon),to:_rkDs(sun),label:_rkDs(mon)+' ~ '+_rkDs(sun)+(_crkOffset===0?' (이번 주)':'')};
  }
  if(_crkPeriod==='month'){
    return {from:y+'-'+_rkPad(m+1)+'-01',to:_rkDs(new Date(y,m+1,0)),label:y+'년 '+(m+1)+'월'};
  }
  if(_crkPeriod==='semester'){
    if(m>=2&&m<=6)return {from:y+'-03-01',to:y+'-07-31',label:y+'년 1학기'};
    const sy=(m>=7)?y:y-1;
    return {from:sy+'-08-01',to:_rkDs(new Date(sy+1,2,0)),label:sy+'년 2학기'};
  }
  if(_crkPeriod==='year'){
    const sy=(m>=2)?y:y-1;
    return {from:sy+'-03-01',to:_rkDs(new Date(sy+1,2,0)),label:sy+' 학년도'};
  }
  if(_crkPeriod==='custom'){
    if(!_crkStart||!_crkEnd)return null;
    return {from:_crkStart,to:_crkEnd,label:_crkStart+' ~ '+_crkEnd};
  }
  return null;
}
function _crkRender(){
  const panel=document.getElementById('dashRankPanel'); if(!panel)return;
  const range=_crkRange();
  const recs=range?(S.records||[]).filter(function(r){
    if(!_crkHas(_crkLogOf(r)))return false;
    if(_crkPerson&&_crkResolveKey(r.studentId)!==_crkPerson)return false; /* 인원 필터 */
    const d=String(r.date||'');
    return d>=range.from&&d<=range.to;
  }).sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''));}):[];
  const _selPerson=_crkPerson?getStu(_crkPerson):null;
  /* 집계 — 주제별 건수·인원·재상담 예정 */
  const topicCnt={}; const personSet={}; let followUps=0;
  const today=toDateStr(new Date());
  recs.forEach(function(r){
    personSet[String(r.studentId)]=1;
    const cl=_crkLogOf(r);
    const tps=(cl.topics&&cl.topics.length)?cl.topics:['(주제 미지정)'];
    tps.forEach(function(t){topicCnt[t]=(topicCnt[t]||0)+1;});
    if(String(cl.followUp||'')>=today)followUps++;
  });
  const topicRows=Object.keys(topicCnt).sort(function(a,b){return topicCnt[b]-topicCnt[a];});
  /* 기간 칩 — 방문 통계와 동일 (오늘/주간/월간/학기/연도/기간 선택) */
  const periods=[['today','오늘'],['week','주간'],['month','월간'],['semester','학기'],['year','연도'],['custom','기간 선택']];
  let h='<div style="padding:14px 16px">';
  h+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">'
    +'<span style="font-size:13px;font-weight:800;color:var(--t1)">💬 상담실적</span>'
    +'<span style="font-size:10.5px;color:var(--t3)">'+(range?escHtml(range.label):'시작일·종료일을 선택하세요')+'</span>'
    +'<span style="flex:1"></span>';
  periods.forEach(function(p){
    const act=_crkPeriod===p[0];
    h+='<button data-crk="period" data-val="'+p[0]+'" style="padding:4px 12px;font-size:10.5px;font-weight:700;border-radius:14px;cursor:pointer;font-family:var(--f);border:1px solid '+(act?'rgba(244,114,182,0.4)':'var(--bdr)')+';background:'+(act?'rgba(244,114,182,0.12)':'var(--bg2)')+';color:'+(act?'#f472b6':'var(--t2)')+'">'+p[1]+'</button>';
  });
  /* 기간 이전/이후 이동 화살표 (사용자 요청 2026-06-13) — custom 제외. 툴팁=미니 팝업(data-tooltip) */
  if(_crkPeriod!=='custom'){
    const _arrow='display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);cursor:pointer;font-size:12px;font-family:var(--f)';
    h+='<button data-crk="prevperiod" data-tooltip="이전 기간으로 이동합니다." data-tooltip-instant="1" style="'+_arrow+';margin-left:4px">◀</button>';
    h+='<button data-crk="nextperiod" data-tooltip="다음 기간으로 이동합니다." data-tooltip-instant="1" style="'+_arrow+'">▶</button>';
  }
  /* PDF 저장 · 인쇄 — 기본 노출. 호버 시 일반 일지와 동일한 미니 팝업 안내 (사용자 요청 2026-06-13) */
  h+='<button data-crk="pdf" data-tooltip="현재 기간·인원 조건의 상담 내역을 PDF로 저장합니다." data-tooltip-instant="1" style="margin-left:6px;padding:6px 12px;font-size:10.5px;font-weight:700;border-radius:7px;border:none;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:#dc2626;color:#fff;box-shadow:0 2px 6px rgba(220,38,38,0.3)">📄 PDF 저장</button>';
  h+='<button data-crk="print" data-tooltip="현재 기간·인원 조건의 상담 내역을 인쇄합니다." data-tooltip-instant="1" style="padding:6px 12px;font-size:10.5px;font-weight:700;border-radius:7px;border:none;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:#0891b2;color:#fff;box-shadow:0 2px 6px rgba(8,145,178,0.3)">🖨 인쇄</button>';
  h+='</div>';
  /* 기간 선택(custom) — 방문 통계와 동일 GUI */
  if(_crkPeriod==='custom'){
    const sA=_crkStart?'color:#f472b6;font-weight:700':'color:var(--t3)';
    const eA=_crkEnd?'color:#f472b6;font-weight:700':'color:var(--t3)';
    h+='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:-4px 0 12px">';
    h+='<span style="font-size:13px;font-weight:700;color:var(--t1)">📅 기간 선택</span>';
    h+='<div style="display:flex;align-items:center;gap:6px">';
    h+='<div data-crk="cal" data-val="start" class="dash-hover-border" style="padding:5px 14px;font-size:12px;'+sA+';border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-family:var(--f);min-width:100px;text-align:center;user-select:none">'+(_crkStart||'시작일 선택')+'</div>';
    h+='<span style="color:var(--t3);font-size:12px">~</span>';
    h+='<div data-crk="cal" data-val="end" class="dash-hover-border" style="padding:5px 14px;font-size:12px;'+eA+';border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-family:var(--f);min-width:100px;text-align:center;user-select:none">'+(_crkEnd||'종료일 선택')+'</div>';
    h+='</div>';
    if(_crkStart||_crkEnd)h+='<button data-crk="calreset" style="padding:3px 10px;font-size:10px;font-weight:600;background:transparent;color:var(--t3);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">초기화</button>';
    h+='</div>';
  }
  /* 요약 카드 */
  const card=function(label,val,color){
    return '<div style="flex:1;min-width:120px;border:1px solid var(--bdr);border-radius:10px;padding:12px 14px;background:var(--card)">'
      +'<div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">'+label+'</div>'
      +'<div style="font-size:20px;font-weight:800;color:'+color+'">'+val+'<span style="font-size:11px;color:var(--t3);margin-left:3px">건</span></div></div>';
  };
  h+='<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">'
    +card('상담 건수',recs.length,'#f472b6')
    +card('상담 인원',Object.keys(personSet).length,'#a855f7').replace('건</span>','명</span>')
    +card('재상담 예정',followUps,'var(--cyan)')
    +'</div>';
  /* 인원 검색창 (요약 카드와 주제별 표 사이) — 특정 인원 상담 내역 조회 + 상세 검색 + 그 인원 PDF (사용자 요청 2026-06-13) */
  h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
  if(_selPerson){
    h+='<div style="display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border:1px solid rgba(244,114,182,0.4);background:rgba(244,114,182,0.08);border-radius:9px">'
      +'<span style="font-size:12px;font-weight:800;color:#f472b6">👤 '+escHtml(_selPerson.name||'')+'</span>'
      +'<span style="font-size:10.5px;color:var(--t3)">'+escHtml(_crkBelongFull(_selPerson))+'</span>'
      +'<span data-crk="clearperson" data-tooltip="인원 선택을 해제합니다." data-tooltip-instant="1" style="cursor:pointer;color:var(--t3);font-size:13px;padding:0 2px;font-weight:700">✕</span>'
      +'</div>';
  } else {
    /* 일반 일지 검색창과 동일 구조 — 🔍 아이콘(좌) + 입력칸 안에 '상세 검색' 버튼(우, absolute) (사용자 요청 2026-06-13) */
    h+='<div style="position:relative;flex:0 0 auto;width:300px">'
      +'<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:11px;pointer-events:none;z-index:2">🔍</span>'
      +'<input id="crkSearchInput" type="text" lang="ko" inputmode="text" autocomplete="off" placeholder="이름으로 상담 내역 검색…" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 72px 8px 30px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;color:var(--t1);font-family:var(--f);outline:none">'
      +'<button data-crk="advsearch" class="adv-search-hover-btn" data-tooltip="이름으로 상세 검색합니다." style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:4px 9px;font-size:9.5px;font-weight:600;background:rgba(236,72,153,0.06);color:#a8456e;border:1px solid rgba(236,72,153,0.15);border-radius:4px;cursor:pointer;line-height:1;z-index:2">상세 검색</button>'
      +'<div id="crkACList" style="display:none;position:absolute;top:100%;left:0;width:100%;margin-top:3px;background:var(--card);border:1px solid var(--bdr);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.25);max-height:260px;overflow-y:auto;z-index:50;scrollbar-width:thin"></div>'
      +'</div>';
    h+='<span style="font-size:10.5px;color:var(--t3)">이름을 검색하거나 상세 검색으로 특정 인원의 상담 내역만 모아 볼 수 있습니다.</span>';
  }
  h+='</div>';
  h+='<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">';
  /* 주제별 건수 표 */
  h+='<div style="width:220px;flex-shrink:0;border:1px solid var(--bdr);border-radius:10px;overflow:hidden">'
    +'<div style="padding:8px 12px;background:rgba(244,114,182,0.08);font-size:11px;font-weight:800;color:#f472b6;border-bottom:1px solid var(--bdr)">주제별 상담 횟수</div>';
  if(!topicRows.length){
    h+='<div style="padding:16px 12px;font-size:11px;color:var(--t3);text-align:center">기간 내 상담 기록이 없습니다.</div>';
  } else {
    topicRows.forEach(function(t){
      h+='<div style="display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--bdr);font-size:11.5px"><span style="color:var(--t1);font-weight:600">'+escHtml(t)+'</span><span style="color:#f472b6;font-weight:800">'+topicCnt[t]+'</span></div>';
    });
    h+='<div style="display:flex;justify-content:space-between;padding:7px 12px;font-size:11.5px;background:var(--bg2)"><span style="font-weight:800;color:var(--t1)">계</span><span style="color:#f472b6;font-weight:800">'+recs.length+'</span></div>';
  }
  h+='</div>';
  /* 상담 기록 리스트 */
  h+='<div style="flex:1;min-width:300px;border:1px solid var(--bdr);border-radius:10px;overflow:hidden">'
    +'<div style="padding:8px 12px;background:rgba(168,85,247,0.08);font-size:11px;font-weight:800;color:#a855f7;border-bottom:1px solid var(--bdr)">상담 기록</div>';
  if(!recs.length){
    h+='<div style="padding:16px 12px;font-size:11px;color:var(--t3);text-align:center">기간 내 상담 기록이 없습니다.</div>';
  } else {
    h+='<table style="width:100%;border-collapse:collapse;font-size:11px">'
      +'<thead><tr style="background:var(--bg2)">'
      +'<th style="padding:6px 8px;text-align:left;color:var(--t3);font-weight:700;white-space:nowrap">일자</th>'
      +'<th style="padding:6px 8px;text-align:left;color:var(--t3);font-weight:700;white-space:nowrap">소속</th>'
      +'<th style="padding:6px 8px;text-align:left;color:var(--t3);font-weight:700;white-space:nowrap">이름</th>'
      +'<th style="padding:6px 8px;text-align:left;color:var(--t3);font-weight:700;white-space:nowrap">주제</th>'
      +'<th style="padding:6px 8px;text-align:left;color:var(--t3);font-weight:700">상담 내용 (주호소)</th>'
      +'</tr></thead><tbody>';
    recs.forEach(function(r){
      const cl=_crkLogOf(r)||{};
      const p=getStu(r.studentId)||{};
      const preview=String(cl.content||cl.action||cl.opinion||'').replace(/\s+/g,' ').slice(0,60);
      /* 행 클릭 → 그 레코드의 증상 팝업(상담 분류 잠금). 호버 시 손가락 커서 (사용자 요청 2026-06-13) */
      h+='<tr data-crk="openrec" data-rec-id="'+r.id+'" class="crk-rec-row" style="border-top:1px solid var(--bdr);cursor:pointer">'
        +'<td style="padding:6px 8px;white-space:nowrap;color:var(--t1);font-weight:600">'+escHtml(r.date||'')+'</td>'
        +'<td style="padding:6px 8px;white-space:nowrap;color:var(--t2)">'+escHtml(_crkBelongFull(p))+'</td>'
        +'<td style="padding:6px 8px;white-space:nowrap;color:var(--t1);font-weight:700">'+escHtml(p.name||'')+'</td>'
        +'<td style="padding:6px 8px;color:#a855f7;font-weight:600">'+escHtml((cl.topics&&cl.topics.length)?cl.topics.join(', '):'-')+'</td>'
        +'<td style="padding:6px 8px;color:var(--t2)">'+escHtml(preview)+'</td>'
        +'</tr>';
    });
    h+='</tbody></table>';
  }
  h+='</div></div></div>';
  panel.innerHTML=h;
  /* 미니 팝업 툴팁 위임 (사용자 요청 2026-06-13) — 일반 일지 버튼과 동일한 GUI(showHeaderTooltip).
   * [title] 도 첫 호버 때 data-tooltip 으로 옮겨 OS 기본 노란 툴팁이 뜨지 않게 통일. */
  if(!panel._crkTipBound){
    panel._crkTipBound=true;
    panel.addEventListener('mouseover',function(e){
      const el=e.target.closest&&e.target.closest('[data-tooltip],[title]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      let txt=el.getAttribute('data-tooltip');
      if(txt==null){ txt=el.getAttribute('title'); if(!txt)return; el.setAttribute('data-tooltip',txt); el.removeAttribute('title'); }
      if(!txt)return;
      try{ showHeaderTooltip(e, txt, false, true); }catch(_){}
    });
    panel.addEventListener('mouseout',function(e){
      const el=e.target.closest&&e.target.closest('[data-tooltip]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      try{ hideHeaderTooltip(); }catch(_){}
    });
  }
  /* 위임 — innerHTML 교체로 누적되지 않게 1회 가드. period/cal/calreset/검색/PDF 처리 */
  if(!panel._crkBound){
    panel._crkBound=true;
    panel.addEventListener('click',function(e){
      const t=e.target.closest('[data-crk]'); if(!t)return;
      /* 상담실적 패널이 아닐 때(방문 순위로 전환된 후)는 무시 */
      if(!panel.querySelector('[data-crk]'))return;
      const k=t.getAttribute('data-crk'), v=t.getAttribute('data-val');
      if(k==='period'){_crkPeriod=v;_crkOffset=0;_crkRender();}
      else if(k==='prevperiod'){_crkOffset=(_crkOffset||0)-1;_crkRender();}
      else if(k==='nextperiod'){_crkOffset=(_crkOffset||0)+1;_crkRender();}
      else if(k==='cal'){_crkOpenCal(v,t);}
      else if(k==='calreset'){_crkStart='';_crkEnd='';_crkRender();}
      else if(k==='clearperson'){_crkPerson=null;_crkRender();}
      else if(k==='advsearch'){_crkOpenPersonSearch();}
      else if(k==='ac-pick'){_crkPerson=_crkResolveKey(t.getAttribute('data-id'));_crkRender();}
      else if(k==='pdf'){_crkOpenPdfPopup('pdf');}
      else if(k==='print'){_crkOpenPdfPopup('print');}
      else if(k==='openrec'){
        const rid=parseInt(t.getAttribute('data-rec-id'),10);
        if(rid&&typeof openSymptomCategoryPopup==='function')openSymptomCategoryPopup(rid,{lockCategory:'counsel'});
      }
    });
    /* 이름 검색 autocomplete — 패널 재렌더 사이엔 입력칸이 유지되므로 위임 input 으로 처리 */
    panel.addEventListener('input',function(e){
      if(!e.target||e.target.id!=='crkSearchInput')return;
      _crkAcIdx=-1;
      _crkRenderAutocomplete(e.target.value);
    });
    /* 방향키 이동 + Enter 선택 + Esc 닫기 (사용자 요청 2026-06-13) */
    panel.addEventListener('keydown',function(e){
      if(!e.target||e.target.id!=='crkSearchInput')return;
      const list=document.getElementById('crkACList');
      if(!list||list.style.display==='none')return;
      const items=Array.from(list.querySelectorAll('[data-crk="ac-pick"]'));
      if(!items.length)return;
      if(e.key==='ArrowDown'){ e.preventDefault(); _crkAcIdx=Math.min(_crkAcIdx+1,items.length-1); _crkAcHighlight(items); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); _crkAcIdx=Math.max(_crkAcIdx-1,0); _crkAcHighlight(items); }
      else if(e.key==='Enter'){ e.preventDefault(); const pick=items[_crkAcIdx]||items[0]; if(pick){ _crkPerson=_crkResolveKey(pick.getAttribute('data-id')); _crkAcIdx=-1; _crkRender(); } }
      else if(e.key==='Escape'){ e.preventDefault(); list.style.display='none'; }
    });
  }
}
let _crkAcIdx=-1; /* autocomplete 하이라이트 인덱스 */
function _crkAcHighlight(items){
  items.forEach(function(el,i){
    const on=i===_crkAcIdx;
    el.style.background=on?'rgba(244,114,182,0.10)':'';
    if(on)el.scrollIntoView({block:'nearest'});
  });
}
/* 이름 검색 autocomplete 드롭다운 — S.people 한글 매칭 (일반 일지와 동일 UX) */
function _crkRenderAutocomplete(q){
  const list=document.getElementById('crkACList'); if(!list)return;
  q=String(q||'').trim();
  if(!q){ list.style.display='none'; list.innerHTML=''; return; }
  const matches=(S.people||[]).filter(function(p){ return p&&p.name&&matchKorean(p.name,q); })
    .sort(function(a,b){
      if((a.type==='staff')!==(b.type==='staff'))return a.type==='staff'?1:-1;
      const ga=Number(a.grade)||0, gb=Number(b.grade)||0; if(ga!==gb)return ga-gb;
      const cc=compareClass(a.cls,b.cls); if(cc)return cc;
      return (Number(a.num)||0)-(Number(b.num)||0);
    }).slice(0,40);
  if(!matches.length){ list.innerHTML='<div style="padding:10px 12px;font-size:11px;color:var(--t3)">일치하는 인원이 없습니다.</div>'; list.style.display='block'; return; }
  list.innerHTML=matches.map(function(p,i){
    return '<div data-crk="ac-pick" data-id="'+escHtml(p.uid||p.id)+'" style="padding:7px 12px;cursor:pointer;border-bottom:1px solid var(--bdr);font-size:11.5px;display:flex;align-items:center;gap:8px'+(i===_crkAcIdx?';background:rgba(244,114,182,0.10)':'')+'">'
      +'<span style="font-weight:700;color:var(--t1)">'+escHtml(p.name||'')+'</span>'
      +'<span style="font-size:10px;color:var(--t3)">'+escHtml(_crkBelongFull(p))+'</span></div>';
  }).join('');
  list.style.display='block';
}
/* 상세 검색 — 일반 일지와 동일한 openPersonSearch 재사용 */
function _crkOpenPersonSearch(){
  openPersonSearch({
    title:'🔎 상담실적 — 인원 검색',
    type:'student',
    allowStaff:true,
    overlayId:'crkPersonSearchOverlay',
    onPick:function(id){ _crkPerson=_crkResolveKey(id); _crkRender(); }
  });
}
/* 현재 화면 필터(기간 + 인원)에 해당하는 상담 기록 — PDF/인쇄 대상 */
function _crkFilteredRecords(){
  const range=_crkRange(); if(!range)return [];
  return (S.records||[]).filter(function(r){
    if(!_crkHas(_crkLogOf(r)))return false;
    if(_crkPerson&&_crkResolveKey(r.studentId)!==_crkPerson)return false;
    const d=String(r.date||''); return d>=range.from&&d<=range.to;
  }).sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''));});
}
/* PDF/인쇄 팝업 — 주제별 체크박스(전체 선택 포함) → 선택 주제 상담 내역 출력. mode: 'pdf' | 'print' */
function _crkOpenPdfPopup(mode){
  mode=(mode==='print')?'print':'pdf';
  const recs=_crkFilteredRecords();
  const p=_crkPerson?getStu(_crkPerson):null;
  const topicSet={};
  recs.forEach(function(r){ const cl=_crkLogOf(r); ((cl.topics&&cl.topics.length)?cl.topics:['(주제 미지정)']).forEach(function(t){topicSet[t]=(topicSet[t]||0)+1;}); });
  const topics=Object.keys(topicSet);
  const old=document.getElementById('crkPdfOverlay'); if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='crkPdfOverlay';
  /* 앱 표준 다이얼로그(appConfirmModal)와 동일 박스 구조 — 배경 블러·var(--card)·선호 헤더 그라데이션 (사용자 요청 2026-06-13) */
  ov.style.cssText='position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
  const _isP=mode==='print';
  const _title=_isP?'🖨 상담 내역 인쇄':'📄 상담 내역 PDF 저장';
  const _btn=_isP?'<button id="crkPdfSave" class="btn-print">🖨 인쇄</button>':'<button id="crkPdfSave" class="btn-pdf">📄 PDF 저장</button>';
  let body='';
  if(!topics.length){
    body='<div style="padding:20px 8px;text-align:center;font-size:12.5px;color:var(--t3)">이 기간에 출력할 상담 기록이 없습니다.</div>';
  } else {
    body='<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);cursor:pointer;margin-bottom:8px;font-size:12px;font-weight:800;color:var(--t1)">'
      +'<input type="checkbox" id="crkPdfAll" checked style="width:15px;height:15px;accent-color:#f472b6;cursor:pointer"> 전체 선택</label>';
    body+='<div style="display:flex;flex-direction:column;gap:5px;max-height:260px;overflow-y:auto;scrollbar-width:thin">';
    topics.forEach(function(t){
      body+='<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-size:12px">'
        +'<input type="checkbox" class="crk-pdf-topic" value="'+escHtml(t)+'" checked style="width:14px;height:14px;accent-color:#f472b6;cursor:pointer">'
        +'<span style="flex:1;color:var(--t1);font-weight:600">'+escHtml(t)+'</span>'
        +'<span style="font-size:10.5px;color:#f472b6;font-weight:800">'+topicSet[t]+'건</span></label>';
    });
    body+='</div>';
  }
  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:380px;max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden">'
    +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px">'
    +'<span style="font-size:13px;font-weight:800;color:var(--t1)">'+_title+'</span>'
    +'<span style="font-size:10.5px;color:var(--t3)">'+escHtml(p?p.name:'전체')+'</span></div>'
    +'<div style="padding:16px 18px;background:var(--card)">'+body+'</div>'
    +(topics.length?'<div style="display:flex;gap:6px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)">'+_btn+'</div>':'')
    +'</div>';
  document.body.appendChild(ov);
  /* 닫기 = 외부 클릭만 (X·취소 버튼 없음, 사용자 요청 2026-06-13) */
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)ov.remove(); });
  const _all=ov.querySelector('#crkPdfAll');
  if(_all)_all.addEventListener('change',function(){ ov.querySelectorAll('.crk-pdf-topic').forEach(function(cb){cb.checked=_all.checked;}); });
  ov.querySelectorAll('.crk-pdf-topic').forEach(function(cb){ cb.addEventListener('change',function(){
    const all=Array.from(ov.querySelectorAll('.crk-pdf-topic')); if(_all)_all.checked=all.every(function(x){return x.checked;});
  }); });
  const _save=ov.querySelector('#crkPdfSave');
  if(_save)_save.addEventListener('click',function(){
    const sel=Array.from(ov.querySelectorAll('.crk-pdf-topic:checked')).map(function(cb){return cb.value;});
    if(!sel.length){_toast('주제를 하나 이상 선택하세요.');return;}
    ov.remove();
    _crkBuildPdf(sel, mode);
  });
}
/* 선택 주제의 상담 내역 출력 — 응급처치 기록지와 동일 인프라, 제목 위아래 색상바. mode: 'pdf'(saveA4Pdf) | 'print'(openA4PrintDialog) */
function _crkBuildPdf(selectedTopics, mode){
  const p=_crkPerson?getStu(_crkPerson):null;
  const range=_crkRange();
  const selSet={}; selectedTopics.forEach(function(t){selSet[t]=1;});
  const recs=_crkFilteredRecords().filter(function(r){
    const cl=_crkLogOf(r); const tps=(cl.topics&&cl.topics.length)?cl.topics:['(주제 미지정)'];
    return tps.some(function(t){return selSet[t];});
  });
  if(!recs.length){_toast('선택한 주제의 상담 기록이 없습니다.');return;}
  const _lc=function(v){return escHtml(String(v||'-'));};
  const _d=new Date();
  const today=_d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
  const short=String(_d.getFullYear()).slice(2)+String(_d.getMonth()+1).padStart(2,'0')+String(_d.getDate()).padStart(2,'0');
  const fname=(p?(p.name||'')+'_':'상담실적_')+'상담내역('+short+')';
  let html='<html><head><meta charset="utf-8"><title>'+escHtml(fname)+'</title><style>'
    +'@page{size:A4;margin:20mm 12mm}body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:0;margin:0;color:#111}'
    +'table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-bottom:14px}thead{display:table-header-group}'
    +'tr,td,th{page-break-inside:avoid;break-inside:avoid}'
    +'th,td{border:1px solid #999;padding:7px 9px;text-align:left;vertical-align:top}th+th,td+td,th+td,td+th{border-left:0}tr+tr td,tr+tr th{border-top:0}'
    +'th{background:#f0f0f0;font-weight:700;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rec-head{background:#fce7f3;font-weight:800;padding:7px 9px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.long-cell{white-space:pre-wrap;word-break:break-word}'
    +'.bar{height:5px;background:linear-gradient(90deg,#06b6d4,#8b5cf6);border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'h2{text-align:center;margin:10px 0;font-size:20px;letter-spacing:8px}'
    +'</style></head><body>'
    +'<div class="bar"></div><h2>상 담 내 역</h2><div class="bar" style="margin-bottom:16px"></div>';
  /* 대상 표 — 인원 선택 시 인적사항, 전체면 대상/기간 요약 */
  if(p){
    html+='<table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%"></colgroup>'
      +'<tr><th>이름</th><td>'+_lc(p.name)+'</td><th>성별</th><td>'+_lc(p.gender)+'</td></tr>'
      +'<tr><th>소속</th><td colspan="3">'+_lc(_crkBelongFull(p))+'</td></tr>'
      +'<tr><th>대상 기간</th><td>'+_lc(range?range.label:'')+'</td><th>상담 건수</th><td>'+recs.length+'건</td></tr>'
      +'<tr><th>대상 주제</th><td colspan="3">'+_lc(selectedTopics.join(', '))+'</td></tr></table>';
  } else {
    const _persons={}; recs.forEach(function(r){_persons[_crkResolveKey(r.studentId)]=1;});
    html+='<table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%"></colgroup>'
      +'<tr><th>대상</th><td>전체</td><th>대상 인원</th><td>'+Object.keys(_persons).length+'명</td></tr>'
      +'<tr><th>대상 기간</th><td>'+_lc(range?range.label:'')+'</td><th>상담 건수</th><td>'+recs.length+'건</td></tr>'
      +'<tr><th>대상 주제</th><td colspan="3">'+_lc(selectedTopics.join(', '))+'</td></tr></table>';
  }
  /* 각 상담 기록 — 전체 출력 시 행 머리에 이름·소속도 표기 */
  recs.forEach(function(r,i){
    const cl=_crkLogOf(r)||{};
    const tp=(cl.topics&&cl.topics.length)?cl.topics.join(', '):'-';
    const rp=getStu(r.studentId)||{};
    const who=p?'':(' &nbsp;·&nbsp; '+escHtml(rp.name||'')+' ('+escHtml(_crkBelongFull(rp))+')');
    html+='<table><thead><tr><td class="rec-head" colspan="2">'+(i+1)+'. '+_lc(r.date)+(r.timeIn?' '+_lc(r.timeIn):'')+' &nbsp;·&nbsp; '+escHtml(tp)+who+'</td></tr></thead><tbody>'
      +'<tr><th style="width:22%">의뢰 경로</th><td>'+_lc(cl.route)+'</td></tr>'
      +'<tr><th>상담 내용 (주호소)</th><td class="long-cell">'+_lc(cl.content)+'</td></tr>'
      +'<tr><th>조치 및 지도 내용</th><td class="long-cell">'+_lc(cl.action)+'</td></tr>'
      +'<tr><th>후속 조치 계획</th><td class="long-cell">'+_lc(cl.plan)+'</td></tr>'
      +'<tr><th>상담자 의견</th><td class="long-cell">'+_lc(cl.opinion)+'</td></tr>'
      +'<tr><th>재상담 예정일</th><td>'+_lc(cl.followUp)+'</td></tr>'
      +'</tbody></table>';
  });
  html+='<table><tbody><tr><th style="width:22%">출력일</th><td>'+_lc(today)+'</td></tr></tbody></table>';
  html+='</body></html>';
  if(mode==='print') openA4PrintDialog({html:html, title:fname, headerLabel:'상담 내역 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}});
  else saveA4Pdf({html:html, title:fname, cssMargins:true});
}
/* 상담실적 기간 선택 달력 — 방문 순위(_rkOpenCal)와 동일 GUI (mcal 클래스 + 휴일 표시) */
function _crkOpenCal(target,anchorEl){
  _crkCalTarget=target;
  const old=document.getElementById('crkCalPopup');if(old)old.remove();
  const base=(target==='start'?_crkStart:_crkEnd);
  if(base){const p=new Date(base);if(!isNaN(p.getTime())){_crkCalY=p.getFullYear();_crkCalM=p.getMonth();}}
  const pop=document.createElement('div');
  pop.id='crkCalPopup';
  pop.style.cssText='position:absolute;z-index:9990;width:280px;border:1px solid var(--bdr);border-radius:10px;padding:8px;background:var(--card);box-shadow:0 8px 24px rgba(0,0,0,0.25)';
  const container=document.getElementById('view-dashboard')||document.querySelector('.canvas');
  const rect=anchorEl.getBoundingClientRect();
  const cRect=container.getBoundingClientRect();
  container.style.position='relative';
  pop.style.left=(rect.left-cRect.left)+'px';
  pop.style.top=(rect.bottom-cRect.top+4)+'px';
  container.appendChild(pop);
  _crkCalRender();
  setTimeout(function(){document.addEventListener('mousedown',_crkCalOutside);},50);
}
function _crkCalOutside(e){
  const pop=document.getElementById('crkCalPopup');
  if(pop&&!pop.contains(e.target)){pop.remove();document.removeEventListener('mousedown',_crkCalOutside);}
}
function _crkCalRender(){
  const pop=document.getElementById('crkCalPopup');if(!pop)return;
  try{ if(typeof ensureHolidayYear==='function')ensureHolidayYear(_crkCalY); }catch(_){}
  const first=new Date(_crkCalY,_crkCalM,1),last=new Date(_crkCalY,_crkCalM+1,0);
  const startDay=first.getDay(),days=last.getDate(),prevLast=new Date(_crkCalY,_crkCalM,0).getDate();
  const today=_rkDs(new Date());
  let h='<div style="font-size:11px;color:#f472b6;font-weight:600;text-align:center;margin-bottom:4px">'+(_crkCalTarget==='start'?'시작일 선택':'종료일 선택')+'</div>';
  h+='<div class="mcal-hdr" style="margin-bottom:4px">';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-crkcal="prev">◂</button></div>';
  h+='<div class="mcal-title">'+_crkCalY+'년 '+monthNames[_crkCalM]+'</div>';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-crkcal="next">▸</button></div>';
  h+='</div><div class="mcal-grid">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){
    let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
    h+='<div class="'+cls+'">'+d+'</div>';
  });
  for(let i=startDay-1;i>=0;i--)h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
  for(let d=1;d<=days;d++){
    const dd=_rkDs(new Date(_crkCalY,_crkCalM,d));
    const dw=new Date(_crkCalY,_crkCalM,d).getDay();
    let cls='mcal-cell';
    if(dd===today)cls+=' today';
    if(dw===0)cls+=' sun';if(dw===6)cls+=' sat';
    if(isHoliday(dd)&&dw!==0&&dw!==6)cls+=' holiday';
    if(dd===_crkStart||dd===_crkEnd)cls+=' selected';
    if(_crkStart&&_crkEnd&&dd>_crkStart&&dd<_crkEnd)cls+=' dcp-range';
    h+='<div class="'+cls+'" data-crkcal-date="'+dd+'"><span class="day-n">'+d+'</span></div>';
  }
  const total=startDay+days,rem=(7-total%7)%7;
  for(let k=1;k<=rem;k++)h+='<div class="mcal-cell other"><span class="day-n">'+k+'</span></div>';
  h+='</div>';
  if(_crkStart||_crkEnd)h+='<div style="text-align:center;padding:6px 0 2px;font-size:10px;color:var(--t3)">'+(_crkStart||'?')+' ~ '+(_crkEnd||'?')+'</div>';
  pop.innerHTML=h;
  pop.querySelectorAll('[data-crkcal]').forEach(function(b){
    b.addEventListener('click',function(){
      if(this.dataset.crkcal==='prev'){_crkCalM--;if(_crkCalM<0){_crkCalM=11;_crkCalY--;}}
      else{_crkCalM++;if(_crkCalM>11){_crkCalM=0;_crkCalY++;}}
      _crkCalRender();
    });
  });
  pop.querySelectorAll('[data-crkcal-date]').forEach(function(cell){
    cell.addEventListener('click',function(){
      const v=this.dataset.crkcalDate;
      if(_crkCalTarget==='start'){_crkStart=v;if(_crkEnd&&_crkEnd<v)_crkEnd='';_crkCalTarget='end';}
      else{if(_crkStart&&v<_crkStart)_crkStart=v;else _crkEnd=v;}
      _crkRender();
      /* 달력 유지 — 새로 그려진 칩 기준 재오픈 */
      const chips=document.querySelectorAll('#dashRankPanel [data-crk="cal"]');
      const anchor=_crkCalTarget==='start'?chips[0]:chips[1];
      if(anchor)_crkOpenCal(_crkCalTarget,anchor);
    });
  });
}

function _rkGenderOf(p){const g=p&&p.gender;if(g==='M'||g==='남'||g==='남자')return 'M';if(g==='F'||g==='여'||g==='여자')return 'F';return '';}
function _rkPad(n){return String(n).padStart(2,'0');}
function _rkDs(d){return d.getFullYear()+'-'+_rkPad(d.getMonth()+1)+'-'+_rkPad(d.getDate());}
/* 기간 → {from,to,label} (학기·학년도는 3월 기준 학사력) */
function _rkRange(){
  const now=new Date();
  const y=now.getFullYear(),m=now.getMonth();
  if(_rk.period==='today'){const d=_rkDs(now);return {from:d,to:d,label:d+' (오늘)'};}
  if(_rk.period==='week'){
    const dow=(now.getDay()+6)%7; /* 월=0 */
    const mon=new Date(y,m,now.getDate()-dow), sun=new Date(y,m,now.getDate()-dow+6);
    return {from:_rkDs(mon),to:_rkDs(sun),label:_rkDs(mon)+' ~ '+_rkDs(sun)+' (이번 주)'};
  }
  if(_rk.period==='month'){
    const from=y+'-'+_rkPad(m+1)+'-01', to=_rkDs(new Date(y,m+1,0));
    return {from:from,to:to,label:y+'년 '+(m+1)+'월'};
  }
  if(_rk.period==='semester'){
    if(m>=2&&m<=6)return {from:y+'-03-01',to:y+'-07-31',label:y+'년 1학기 (3/1~7/31)'};
    const sy=(m>=7)?y:y-1;
    return {from:sy+'-08-01',to:_rkDs(new Date(sy+1,2,0)),label:sy+'년 2학기 (8/1~'+(sy+1)+'/2월말)'};
  }
  if(_rk.period==='year'){
    const sy=(m>=2)?y:y-1;
    return {from:sy+'-03-01',to:_rkDs(new Date(sy+1,2,0)),label:sy+' 학년도 (3/1~'+(sy+1)+'/2월말)'};
  }
  if(_rk.period==='custom'){
    if(!_rk.start||!_rk.end)return null;
    return {from:_rk.start,to:_rk.end,label:_rk.start+' ~ '+_rk.end};
  }
  return null;
}
/* 기간 내 인원별 방문 횟수 집계 — key=studentId(uid) */
function _rkCounts(range){
  const counts={};
  (S.records||[]).forEach(function(r){
    const d=r.date||'';
    if(!d||d<range.from||d>range.to)return;
    const key=r.studentId||r.personUid||'';
    if(!key)return;
    counts[key]=(counts[key]||0)+1;
  });
  return counts;
}
function _rkPersonOf(key){
  return (S.people||[]).find(function(p){return p&&(String(p.uid||'')===String(key)||String(p.id||'')===String(key));});
}
/* 소속 표기 — 학교급(여러 개일 때만)+학과(있을 때)+N학년 N반 N번 / 직위 */
function _rkAff(p,multiLv){
  if(p.type==='staff')return p.position||'교직원';
  const lv=(multiLv&&p.level)?(getLevelShort(p)+' '):'';
  const dept=p.department?(p.department+' '):'';
  return lv+dept+(p.grade||0)+'학년 '+(p.cls||0)+'반 '+(p.num||0)+'번';
}
/* 대상별 순위 그룹 데이터 — [{title, kind:'person'|'class', list:[{aff,name,v}|{label,v}]}] */
function _rkGroups(target){
  const range=_rkRange();
  if(!range)return null;
  const counts=_rkCounts(range);
  const multiLv=hasMultipleSchoolLevels();
  const persons=[];
  Object.keys(counts).forEach(function(key){
    const p=_rkPersonOf(key);
    if(!p)return;
    persons.push({p:p,v:counts[key]});
  });
  const stu=persons.filter(function(x){return x.p.type!=='staff';});
  const stf=persons.filter(function(x){return x.p.type==='staff';});
  function srt(a){return a.slice().sort(function(x,y){return y.v-x.v;});}
  function toL(arr){return srt(arr).map(function(x){return {aff:_rkAff(x.p,multiLv),name:x.p.name||'',v:x.v};});}
  function clsGroups(){
    const by={};
    stu.forEach(function(x){
      const p=x.p;
      const key=((multiLv&&p.level)?(getLevelShort(p)+' '):'')+(p.department?(p.department+' '):'')+(p.grade||0)+'학년 '+(p.cls||0)+'반';
      if(!by[key])by[key]={label:key,v:0};
      by[key].v+=x.v;
    });
    return Object.values(by).sort(function(a,b){return b.v-a.v;});
  }
  if(target==='student'){
    return [
      {title:'🎒 학생 전체',kind:'person',list:toL(stu)},
      {title:'👦 남학생 순위',kind:'person',list:toL(stu.filter(function(x){return _rkGenderOf(x.p)==='M';}))},
      {title:'👧 여학생 순위',kind:'person',list:toL(stu.filter(function(x){return _rkGenderOf(x.p)==='F';}))},
      {title:'🏫 학년반 순위',kind:'class',list:clsGroups()}
    ];
  }
  if(target==='staff'){
    return [
      {title:'👨‍🏫 교직원 전체',kind:'person',list:toL(stf)},
      {title:'👨 남 교직원 순위',kind:'person',list:toL(stf.filter(function(x){return _rkGenderOf(x.p)==='M';}))},
      {title:'👩 여 교직원 순위',kind:'person',list:toL(stf.filter(function(x){return _rkGenderOf(x.p)==='F';}))}
    ];
  }
  return [
    {title:'🏆 전체 순위',kind:'person',list:toL(persons)},
    {title:'👦 남자 순위',kind:'person',list:toL(persons.filter(function(x){return _rkGenderOf(x.p)==='M';}))},
    {title:'👧 여자 순위',kind:'person',list:toL(persons.filter(function(x){return _rkGenderOf(x.p)==='F';}))}
  ];
}

function _rkRender(){
  const panel=document.getElementById('dashRankPanel');
  if(!panel)return;
  const range=_rkRange();
  const tgts=[['student','학생'],['staff','교직원'],['both','학생&교직원']];
  const pers=[['today','오늘'],['week','이번 주'],['month','이번 달'],['semester','이번 학기'],['year','이번 학년도'],['custom','기간 선택']];
  let h='';
  /* 대상 세그먼트 */
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h+='<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:34px">대상</span>';
  h+='<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px">';
  tgts.forEach(function(t){
    const on=_rk.target===t[0];
    h+='<button data-rk="target" data-val="'+t[0]+'" style="padding:6px 18px;font-size:12px;font-weight:'+(on?'700':'600')+';border:none;background:'+(on?'var(--cyan)':'transparent')+';color:'+(on?'#fff':'var(--t2)')+';border-radius:6px;cursor:pointer;font-family:var(--f)'+(on?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'')+'">'+t[1]+'</button>';
  });
  h+='</div></div>';
  /* 기간 칩 + 내보내기 버튼 (맨 오른쪽) */
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap">';
  h+='<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:34px">기간</span>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  pers.forEach(function(t){
    const on=_rk.period===t[0];
    h+='<button data-rk="period" data-val="'+t[0]+'" style="padding:6px 16px;border-radius:8px;border:1.5px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'var(--cyan)':'var(--bg2)')+';color:'+(on?'#fff':'var(--t2)')+';font-size:11px;font-weight:700;cursor:pointer;font-family:var(--f)'+(on?';box-shadow:0 0 14px rgba(6,182,212,0.25)':'')+'">'+t[1]+'</button>';
  });
  h+='</div>';
  h+='<div style="margin-left:auto;display:flex;gap:4px;align-items:center">';
  h+='<button data-rk="excel" style="padding:9px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>엑셀 내보내기</button>';
  h+='<button data-rk="sheets" style="padding:9px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</button>';
  h+='</div></div>';
  /* 기간 선택(custom) — 방문 통계와 동일 GUI */
  if(_rk.period==='custom'){
    const sA=_rk.start?'color:var(--cyan);font-weight:700':'color:var(--t3)';
    const eA=_rk.end?'color:var(--cyan);font-weight:700':'color:var(--t3)';
    h+='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">';
    h+='<span style="font-size:13px;font-weight:700;color:var(--t1)">📅 기간 선택</span>';
    h+='<div style="display:flex;align-items:center;gap:6px">';
    h+='<div data-rk="cal" data-val="start" class="dash-hover-border" style="padding:5px 14px;font-size:12px;'+sA+';border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-family:var(--f);min-width:100px;text-align:center;user-select:none">'+(_rk.start||'시작일 선택')+'</div>';
    h+='<span style="color:var(--t3);font-size:12px">~</span>';
    h+='<div data-rk="cal" data-val="end" class="dash-hover-border" style="padding:5px 14px;font-size:12px;'+eA+';border:1px solid var(--bdr);border-radius:7px;cursor:pointer;font-family:var(--f);min-width:100px;text-align:center;user-select:none">'+(_rk.end||'종료일 선택')+'</div>';
    h+='</div>';
    if(_rk.start||_rk.end)h+='<button data-rk="calreset" style="padding:3px 10px;font-size:10px;font-weight:600;background:transparent;color:var(--t3);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">초기화</button>';
    h+='</div>';
  }
  /* 집계 기간 — 위아래 여백 넉넉히 */
  h+='<div style="font-size:11.5px;font-weight:700;color:var(--t2);margin:18px 0 18px">집계 기간: '+(range?escHtml(range.label):'시작일·종료일을 선택하세요')+'</div>';
  /* 순위 열 */
  const groups=range?_rkGroups(_rk.target):null;
  const colN=groups?groups.length:3;
  h+='<div style="display:grid;grid-template-columns:repeat('+colN+',1fr);gap:10px">';
  (groups||[]).forEach(function(g){
    h+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;overflow:hidden;display:flex;flex-direction:column">';
    h+='<div style="padding:9px 14px;font-size:12px;font-weight:800;color:var(--t1);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))">'+g.title+'<span style="margin-left:auto;font-size:10px;color:var(--t3);font-weight:600">'+(g.kind==='class'?g.list.length+'개 반':g.list.length+'명')+'</span></div>';
    h+='<div style="flex:1;overflow-y:auto;max-height:max(340px,calc(100vh - 470px));padding:6px;scrollbar-width:thin">';
    if(!g.list.length)h+='<div style="padding:30px 10px;text-align:center;color:var(--t3);font-size:11px">데이터 없음</div>';
    g.list.forEach(function(it,i){
      const medal=i===0?'background:#fbbf24;color:#fff;box-shadow:0 0 10px rgba(251,191,36,0.5)':i===1?'background:#cbd5e1;color:#fff':i===2?'background:#d6a47c;color:#fff':'background:var(--bg2);color:var(--t3)';
      const who=g.kind==='class'
        ? '<span style="font-weight:700;color:var(--t1)">'+escHtml(it.label)+'</span>'
        : '<span style="font-size:10px;color:var(--t3);font-weight:600;margin-right:5px">'+escHtml(it.aff)+'</span><span style="font-weight:700;color:var(--t1)">'+escHtml(it.name)+'</span>';
      h+='<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;margin-bottom:3px;background:var(--card);border:1px solid '+(i===0?'rgba(251,191,36,0.5)':'var(--bdrl)')+';font-size:12px">'
        +'<span style="width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;'+medal+'">'+(i+1)+'</span>'
        +'<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+who+'</span>'
        +'<span style="font-size:11px;font-weight:800;color:var(--cyan);white-space:nowrap">'+it.v+'회</span>'
        +'</div>';
    });
    h+='</div></div>';
  });
  if(!groups){
    for(let i=0;i<colN;i++)h+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;padding:40px 12px;text-align:center;color:var(--t3);font-size:12px">기간을 선택하면 순위가 표시됩니다.</div>';
  }
  h+='</div>';
  panel.innerHTML=h;
  if(!panel._rkBound){
    panel._rkBound=true;
    panel.addEventListener('click',function(e){
      const t=e.target.closest('[data-rk]');if(!t)return;
      const k=t.getAttribute('data-rk'),v=t.getAttribute('data-val');
      if(k==='target'){_rk.target=v;_rkRender();}
      else if(k==='period'){_rk.period=v;_rkRender();}
      else if(k==='cal'){_rkOpenCal(v,t);}
      else if(k==='calreset'){_rk.start='';_rk.end='';_rkRender();}
      else if(k==='excel'){_rkExcel(t);}
      else if(k==='sheets'){_rkSheets(t);}
    });
  }
}

/* 기간 선택 달력 — 방문 통계 dcpCalPopup 과 동일 GUI (mcal 클래스 재사용) */
function _rkOpenCal(target,anchorEl){
  _rkCalTarget=target;
  const old=document.getElementById('rkCalPopup');if(old)old.remove();
  const base=(target==='start'?_rk.start:_rk.end);
  if(base){const p=new Date(base);if(!isNaN(p.getTime())){_rkCalY=p.getFullYear();_rkCalM=p.getMonth();}}
  const pop=document.createElement('div');
  pop.id='rkCalPopup';
  pop.style.cssText='position:absolute;z-index:9990;width:280px;border:1px solid var(--bdr);border-radius:10px;padding:8px;background:var(--card);box-shadow:0 8px 24px rgba(0,0,0,0.25)';
  const container=document.getElementById('view-dashboard')||document.querySelector('.canvas');
  const rect=anchorEl.getBoundingClientRect();
  const cRect=container.getBoundingClientRect();
  container.style.position='relative';
  pop.style.left=(rect.left-cRect.left)+'px';
  pop.style.top=(rect.bottom-cRect.top+4)+'px';
  container.appendChild(pop);
  _rkCalRender();
  setTimeout(function(){document.addEventListener('mousedown',_rkCalOutside);},50);
}
function _rkCalOutside(e){
  const pop=document.getElementById('rkCalPopup');
  if(pop&&!pop.contains(e.target)){pop.remove();document.removeEventListener('mousedown',_rkCalOutside);}
}
function _rkCalRender(){
  const pop=document.getElementById('rkCalPopup');if(!pop)return;
  const first=new Date(_rkCalY,_rkCalM,1),last=new Date(_rkCalY,_rkCalM+1,0);
  const startDay=first.getDay(),days=last.getDate(),prevLast=new Date(_rkCalY,_rkCalM,0).getDate();
  const today=_rkDs(new Date());
  let h='<div style="font-size:11px;color:var(--cyan);font-weight:600;text-align:center;margin-bottom:4px">'+(_rkCalTarget==='start'?'시작일 선택':'종료일 선택')+'</div>';
  h+='<div class="mcal-hdr" style="margin-bottom:4px">';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-rkcal="prev">◂</button></div>';
  h+='<div class="mcal-title">'+_rkCalY+'년 '+monthNames[_rkCalM]+'</div>';
  h+='<div class="mcal-nav"><button class="mcal-btn" data-rkcal="next">▸</button></div>';
  h+='</div><div class="mcal-grid">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){
    let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
    h+='<div class="'+cls+'">'+d+'</div>';
  });
  for(let i=startDay-1;i>=0;i--)h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
  for(let d=1;d<=days;d++){
    const dd=_rkDs(new Date(_rkCalY,_rkCalM,d));
    const dw=new Date(_rkCalY,_rkCalM,d).getDay();
    let cls='mcal-cell';
    if(dd===today)cls+=' today';
    if(dw===0)cls+=' sun';if(dw===6)cls+=' sat';
    if(isHoliday(dd)&&dw!==0&&dw!==6)cls+=' holiday';
    if(dd===_rk.start||dd===_rk.end)cls+=' selected';
    if(_rk.start&&_rk.end&&dd>_rk.start&&dd<_rk.end)cls+=' dcp-range';
    h+='<div class="'+cls+'" data-rkcal-date="'+dd+'"><span class="day-n">'+d+'</span></div>';
  }
  const total=startDay+days,rem=(7-total%7)%7;
  for(let k=1;k<=rem;k++)h+='<div class="mcal-cell other"><span class="day-n">'+k+'</span></div>';
  h+='</div>';
  if(_rk.start||_rk.end)h+='<div style="text-align:center;padding:6px 0 2px;font-size:10px;color:var(--t3)">'+(_rk.start||'?')+' ~ '+(_rk.end||'?')+'</div>';
  pop.innerHTML=h;
  pop.querySelectorAll('[data-rkcal]').forEach(function(b){
    b.addEventListener('click',function(){
      if(this.dataset.rkcal==='prev'){_rkCalM--;if(_rkCalM<0){_rkCalM=11;_rkCalY--;}}
      else{_rkCalM++;if(_rkCalM>11){_rkCalM=0;_rkCalY++;}}
      _rkCalRender();
    });
  });
  pop.querySelectorAll('[data-rkcal-date]').forEach(function(cell){
    cell.addEventListener('click',function(){
      const v=this.dataset.rkcalDate;
      if(_rkCalTarget==='start'){_rk.start=v;if(_rk.end&&_rk.end<v)_rk.end='';_rkCalTarget='end';}
      else{if(_rk.start&&v<_rk.start)_rk.start=v;else _rk.end=v;}
      _rkRender();
      /* 달력 유지 — 새로 그려진 칩 기준 재오픈 */
      const chips=document.querySelectorAll('#dashRankPanel [data-rk="cal"]');
      const anchor=_rkCalTarget==='start'?chips[0]:chips[1];
      if(anchor)_rkOpenCal(_rkCalTarget,anchor);
    });
  });
}

/* 엑셀 시트 데이터 — 3개 대상 전부 (탭 3장). 가로 그룹: [순위|소속|이름|횟수] + 좁은 간격 열 */
function _rkSheetPayload(){
  const range=_rkRange();
  if(!range)return null;
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  function grpFor(target){
    return (_rkGroups(target)||[]).map(function(g){
      if(g.kind==='class'){
        return {title:g.title.replace(/^[^\s]+\s/,''),header:['순위','학년반','횟수'],colWidths:[40,190,55],
          rows:g.list.map(function(it,i){return [i+1,it.label,it.v];})};
      }
      return {title:g.title.replace(/^[^\s]+\s/,''),header:['순위','소속','이름','횟수'],colWidths:[40,175,70,50],
        rows:g.list.map(function(it,i){return [i+1,it.aff,it.name,it.v];})};
    });
  }
  return {
    sheets:[
      {name:'학생',titleText:'방문 순위 — 학생',schoolText:'학교: '+schoolName,periodText:'기간: '+range.label,groups:grpFor('student')},
      {name:'교직원',titleText:'방문 순위 — 교직원',schoolText:'학교: '+schoolName,periodText:'기간: '+range.label,groups:grpFor('staff')},
      {name:'학생·교직원',titleText:'방문 순위 — 학생·교직원 전체',schoolText:'학교: '+schoolName,periodText:'기간: '+range.label,groups:grpFor('both')}
    ],
    label:range.label
  };
}
function _rkExcel(btn){
  if(!window.electronAPI||!window.electronAPI.xlsxBuildVisitRank){bus.emit('toast:show',{text:'Excel 빌드 IPC 미구성'});return;}
  const payload=_rkSheetPayload();
  if(!payload){bus.emit('toast:show',{text:'기간을 먼저 선택해주세요.'});return;}
  bus.emit('toast:show',{text:'Excel 생성 중…'});
  window.electronAPI.xlsxBuildVisitRank({sheets:payload.sheets}).then(function(res){
    if(!res||!res.success){bus.emit('toast:show',{text:'Excel 생성 실패: '+(res&&res.error||'')});return;}
    const buf=new Uint8Array(res.bytes);
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='방문순위_'+payload.label.replace(/[\/\s~()]/g,'_')+'.xlsx';a.click();
    URL.revokeObjectURL(url);
    bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
  }).catch(function(e){bus.emit('toast:show',{text:'Excel 오류: '+e.message});});
}
/* Google Sheets — 동일 데이터. (현재 Google 기능 OAuth 검증 대기로 비활성 — 활성화 시 탭 3개 구조로 동작) */
async function _rkSheets(btn){
  const payload=_rkSheetPayload();
  if(!payload){bus.emit('toast:show',{text:'기간을 먼저 선택해주세요.'});return;}
  if(typeof window.sheetsExportWithConsent!=='function'){bus.emit('toast:show',{text:'Google Sheets 기능이 아직 준비되지 않았습니다.'});return;}
  /* 시트 1장 values + 나머지 탭은 활성화 후 확장. 그룹들을 가로 배치한 2차원 배열 구성 */
  function flat(groups){
    const rows=[];
    const maxR=groups.reduce(function(m,g){return Math.max(m,g.rows.length);},0);
    const titleRow=[],headRow=[];
    groups.forEach(function(g,gi){
      titleRow.push(g.title);for(let i=1;i<g.header.length;i++)titleRow.push('');
      headRow.push.apply(headRow,g.header);
      if(gi<groups.length-1){titleRow.push('');headRow.push('');}
    });
    rows.push(titleRow);rows.push(headRow);
    for(let r=0;r<maxR;r++){
      const row=[];
      groups.forEach(function(g,gi){
        const src=g.rows[r]||new Array(g.header.length).fill('');
        row.push.apply(row,src);
        if(gi<groups.length-1)row.push('');
      });
      rows.push(row);
    }
    return rows;
  }
  try{
    const sh=payload.sheets[_rk.target==='staff'?1:_rk.target==='both'?2:0];
    const res=await window.sheetsExportWithConsent({
      title:'방문 순위 '+payload.label,
      sheetTitle:sh.name,
      range:sh.name+'!A1',
      values:[[sh.titleText],[sh.periodText],[]].concat(flat(sh.groups))
    });
    if(res&&res.disabled){bus.emit('toast:show',{text:'Google 기능은 검증 완료 후 제공됩니다.'});return;}
    if(!res||!res.success){bus.emit('toast:show',{text:'Sheets 내보내기 실패: '+(res&&res.error||'')});return;}
    bus.emit('toast:show',{text:'Google Sheets에 저장되었습니다.'});
  }catch(e){bus.emit('toast:show',{text:'Sheets 오류: '+(e&&e.message||e)});}
}

/* 날짜 선택기 & 히트맵 & Sheets — window bridges removed (event delegation used) */

/* ── Event bus registrations ── */
bus.on('render:dashboard', renderDashboard);
