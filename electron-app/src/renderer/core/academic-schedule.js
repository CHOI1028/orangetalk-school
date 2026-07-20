/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════════════════════════════
 *  학사일정 (나이스 SchoolSchedule Open API) — 2026-06-17
 *  ───────────────────────────────────────────────────────────────
 *  · 인증키·학교 표준코드는 급식(school-meal.js)과 동일 — 같은 나이스 키 1개로 동작
 *  · 홈 대시보드 미니 캘린더에 방학·시험·행사 등 학사일정 표시
 *  · 보이는 달 단위 lazy 로드 + 누적 캐시(같은 달 재요청 안 함)
 *  · 무한 재렌더 방지: 실제 fetch 가 끝난 경우에만 onLoaded() 호출
 *    (이미 로드/진행 중이면 조용히 early-return → 콜백 미호출)
 * ═══════════════════════════════════════════════════════════════ */

import { neisFetchJson, resolveNeisCode, neisKey, NEIS_BASE } from './school-meal.js';
import { S } from './app-state.js';

function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function _schoolName(){ const cu=(S&&S._currentUser)||{}; const st=(S&&S.settings)||{}; return String(cu.school_name||st.schoolName||'').trim(); }

let _byDate = {};            /* 'YYYY-MM-DD' -> [{title}]  (여러 달 누적) */
let _spans = [];             /* [{title,start,end}] 연속일 묶음 (방학 등 다일 이벤트) */
const _loadedMonths = {};    /* 'YYYYMM' -> true (로드 완료) */
const _inflight = {};        /* 'YYYYMM' -> true (요청 중) */

/* 현재까지 로드된 학사일정 (날짜별) — 캘린더 렌더에서 읽기 전용으로 사용 */
export function getAcademicByDate(){ return _byDate; }
/* 연속일 묶음 — 같은 제목이 연달아 있으면 하나의 span 으로 (여름방학 등 이어 표시용) */
export function getAcademicSpans(){ return _spans; }

function _dayDiff(a, b){
  const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}
/* _byDate 로부터 연속 span 재계산 — 같은 제목의 연달은 날짜를 묶음 */
function _rebuildSpans(){
  const byTitle = {};
  Object.keys(_byDate).forEach(function(ds){
    (_byDate[ds] || []).forEach(function(ev){
      (byTitle[ev.title] = byTitle[ev.title] || []).push(ds);
    });
  });
  const spans = [];
  Object.keys(byTitle).forEach(function(title){
    const dates = byTitle[title].slice().sort();
    let s = dates[0], prev = dates[0];
    for(let i = 1; i < dates.length; i++){
      if(_dayDiff(prev, dates[i]) === 1){ prev = dates[i]; continue; }
      spans.push({ title: title, start: s, end: prev });
      s = dates[i]; prev = dates[i];
    }
    spans.push({ title: title, start: s, end: prev });
  });
  _spans = spans;
}

/* 해당 달(yr, mo0=0~11)이 이미 로드 중이거나 완료되었는가 — 중복요청·재렌더 가드 */
export function academicMonthBusy(yr, mo0){
  const mk = String(yr) + String(mo0 + 1).padStart(2, '0');
  return !!(_loadedMonths[mk] || _inflight[mk]);
}

/* 지정 달의 학사일정 로드. 실제 fetch 완료 시에만 onLoaded() 호출. */
export async function loadAcademicMonth(yr, mo0, onLoaded){
  const key = neisKey();
  if(!key) return;
  const mk = String(yr) + String(mo0 + 1).padStart(2, '0');
  if(_loadedMonths[mk] || _inflight[mk]) return;   /* 중복 차단 */
  _inflight[mk] = true;
  try{
    const code = await resolveNeisCode();
    if(!code) return;   /* finally 에서 inflight 해제 */
    const mm = String(mo0 + 1).padStart(2, '0');
    const last = new Date(yr, mo0 + 1, 0).getDate();
    const from = String(yr) + mm + '01';
    const to = String(yr) + mm + String(last).padStart(2, '0');
    const url = NEIS_BASE + '/SchoolSchedule?KEY=' + encodeURIComponent(key) + '&Type=json&pSize=1000'
      + '&ATPT_OFCDC_SC_CODE=' + encodeURIComponent(code.office)
      + '&SD_SCHUL_CODE=' + encodeURIComponent(code.school)
      + '&AA_FROM_YMD=' + from + '&AA_TO_YMD=' + to;
    const j = await neisFetchJson(url);
    let rows = null;
    try{ rows = j && j.SchoolSchedule && j.SchoolSchedule[1] && j.SchoolSchedule[1].row; }catch(_){}
    _loadedMonths[mk] = true;   /* 데이터가 없어도(방학·신설 등) 다시 안 받음 */
    if(rows && rows.length){
      rows.forEach(function(r){
        const ymd = String(r.AA_YMD || '').trim();      /* 'YYYYMMDD' */
        let nm = String(r.EVENT_NM || '').trim();
        if(!/^\d{8}$/.test(ymd) || !nm) return;
        /* '토요휴업일' 같은 단순 휴업 표기는 캘린더가 이미 주말/공휴일로 처리 → 노이즈 제외 */
        if(nm === '토요휴업일' || nm === '휴업일') return;
        const ds = ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
        if(!_byDate[ds]) _byDate[ds] = [];
        if(!_byDate[ds].some(function(e){ return e.title === nm; }))
          _byDate[ds].push({ title: nm });
      });
      _rebuildSpans();
    }
  }catch(_){
    /* 네트워크 실패 — 로드 표시 안 함(_loadedMonths 미설정) → 다음 렌더에서 재시도 가능 */
  }finally{
    delete _inflight[mk];
  }
  if(typeof onLoaded === 'function') onLoaded();
}

/* 학교 이동·키 변경 등으로 캐시를 비워야 할 때 */
export function resetAcademicCache(){
  _byDate = {};
  _spans = [];
  Object.keys(_loadedMonths).forEach(function(k){ delete _loadedMonths[k]; });
  Object.keys(_inflight).forEach(function(k){ delete _inflight[k]; });
}

/* ════════════ 학사일정 자동 팝업 (특별한 날 알림) ════════════ */

/* 지정 날짜(ds='YYYY-MM-DD')의 학사일정 제목들 — 공휴일 중복은 제외 */
function _eventsForDate(ds){
  const arr=(_byDate[ds]||[]).map(function(e){return e.title;});
  const hol=(S&&S.koreanHolidays)||{};
  const hn=hol[ds];
  return arr.filter(function(t){
    if(!hn)return true;
    const a=String(hn).replace(/\s/g,''), b=String(t).replace(/\s/g,'');
    return !(a&&b&&(a===b||a.indexOf(b)!==-1||b.indexOf(a)!==-1));
  });
}

function _renderAcadPopup(ds, events){
  const dt=new Date(ds+'T00:00:00');
  const dow=['일','월','화','수','목','금','토'][dt.getDay()];
  const dateStr=dt.getFullYear()+'. '+(dt.getMonth()+1)+'. '+dt.getDate()+'. ('+dow+')';
  const old=document.getElementById('acadPopupOverlay'); if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='acadPopupOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.32);z-index:13050;opacity:0;transition:opacity 0.15s ease';
  const body=events.length
    ? events.map(function(t){ return '<div style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:rgba(168,85,247,0.08);border-left:3px solid #a855f7;border-radius:5px;margin-bottom:6px;font-size:12.5px;color:var(--t1)"><span style="font-size:14px">📌</span>'+_esc(t)+'</div>'; }).join('')
    : '<div style="font-size:12.5px;color:var(--t2);text-align:center;padding:10px 0">오늘은 나이스에 등록된 학사일정이 없습니다.</div>';
  ov.innerHTML='<div id="acadPopupBox" style="background:var(--card);border-radius:14px;width:420px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.18s ease,transform 0.18s ease">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(168,85,247,0.12),rgba(99,102,241,0.06));display:flex;align-items:center;gap:8px"><span style="font-size:18px">📅</span><div><div style="font-size:14px;font-weight:800;color:var(--t1)">학사일정 안내</div><div style="font-size:10.5px;color:var(--t3)">'+_esc(_schoolName()||'')+' · '+_esc(dateStr)+'</div></div></div>'
    +'<div style="padding:18px 22px;overflow-y:auto;flex:1 1 auto">'+body+'</div>'
    +'</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('acadPopupBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('acadPopupBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.96)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },180); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  const ok=document.getElementById('acadPopupOk'); if(ok)ok.addEventListener('click',close);
}

/* 공개 — 지정 날짜의 학사일정 팝업 표시. opts.silent=true(자동) 면 학사일정 없을 때 조용히 패스. */
export async function showAcademicPopup(ds, opts){
  opts=opts||{};
  if(!neisKey()) { if(opts.silent)return; }
  const dt=new Date(ds+'T00:00:00');
  await loadAcademicMonth(dt.getFullYear(), dt.getMonth());   /* 해당 달 보장 로드 */
  const events=_eventsForDate(ds);
  if(opts.silent && !events.length) return;   /* 자동: 특별한 날 없으면 안 띄움 */
  _renderAcadPopup(ds, events);
}

/* ── 스케줄러 — ec_acad_popup_on==='Y' 일 때 지정 시각에 하루 1회 ── */
let _acadTimer=null;
function _ymdLocal(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export function restartAcademicScheduler(){
  if(_acadTimer){ clearInterval(_acadTimer); _acadTimer=null; }
  if(localStorage.getItem('ec_acad_popup_on')!=='Y') return;
  _acadTimer=setInterval(function(){
    try{
      if(localStorage.getItem('ec_acad_popup_on')!=='Y'){ clearInterval(_acadTimer); _acadTimer=null; return; }
      const t=(localStorage.getItem('ec_acad_popup_time')||'09:00');
      const now=new Date();
      const cur=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
      const todayStr=_ymdLocal(now);
      if(cur===t && localStorage.getItem('ec_acad_popup_last')!==todayStr){
        localStorage.setItem('ec_acad_popup_last',todayStr);
        /* 당일(today) / 전날(prev=내일 일정 미리 알림) */
        const when=localStorage.getItem('ec_acad_popup_when')||'today';
        const target=new Date(now); if(when==='prev')target.setDate(target.getDate()+1);
        showAcademicPopup(_ymdLocal(target), {silent:true});
      }
    }catch(_){}
  }, 30000);
}
export function maybeStartAcademicScheduler(){ restartAcademicScheduler(); }
