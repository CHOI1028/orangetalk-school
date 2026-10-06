/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════════════════════════════
 *  학교 급식 자동 팝업 (나이스 Open API) — 2026-06-17
 *  ───────────────────────────────────────────────────────────────
 *  · 인증키: localStorage ec_neis_api_key (설정 > API 관리 > 🍽️ 나이스(NEIS) — 급식·학사일정)
 *  · 등록된 학교명 + 교육청 → 나이스 schoolInfo 로 학교 표준코드 자동 조회
 *    (캐시: ec_neis_school_code / ec_neis_office_code / ec_neis_school_name — 학교명 바뀌면 재조회)
 *  · mealServiceDietInfo 로 해당 날짜의 전체 식단(조식·중식·석식)
 *  · 모든 외부 호출은 메인 프로세스(externalFetchJson) 경유 → CORS/CSP 무관
 *  · 설정(보건일지 설정)의 토글 ON + 지정 시각에 하루 1회 자동 팝업
 *  · 팝업: |전날|오늘|다음날| 네비게이션으로 날짜 이동 (확인 버튼 대신, 사용자 요청 2026-06-17)
 * ═══════════════════════════════════════════════════════════════ */

import { S, ensureHolidayYear } from './app-state.js';
import { playUiSound } from './ui-utils.js';

const NEIS_BASE = 'https://open.neis.go.kr/hub';

function _neisKey(){ return (localStorage.getItem('ec_neis_api_key')||'').trim(); }
function _school(){ const cu=(S&&S._currentUser)||{}; const st=(S&&S.settings)||{}; return String(cu.school_name||st.schoolName||'').trim(); }
function _edu(){ const cu=(S&&S._currentUser)||{}; const st=(S&&S.settings)||{}; return String(cu.edu_office||st.eduOffice||'').trim(); }
function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function _todayYmd(){ const d=new Date(); return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }

/* 메인 프로세스 fetch — 반환 형태가 {success,data} 든 json 자체든 모두 흡수 */
async function _fetchJson(url){
  const _api=window.electronAPI;
  /* NEIS 전용(호스트 키 폴백) 우선 — 웹 협업 클라이언트가 자기 키 없어도 호스트 NEIS 키로 동작. 없으면 범용 fetch. (2026-07-02) */
  const _fn=_api&&(_api.externalFetchNeis||_api.externalFetchJson);
  if(!_fn) return null;
  try{
    const res=await _fn(url);
    if(res&&res.success===false) return null;
    let d=(res&&res.data!=null)?res.data:res;
    if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(_){ return null; } }
    return d;
  }catch(_){ return null; }
}

/* 학교 표준코드 조회 (캐시 우선) — {office, school} 또는 null */
async function _resolveCode(){
  const key=_neisKey(); const school=_school();
  /* 캐시 — 학교명이 그대로면 재사용 (학교 이동 시 학교명이 바뀌므로 자동 재조회) */
  const cachedName=localStorage.getItem('ec_neis_school_name')||'';
  const cachedSchool=localStorage.getItem('ec_neis_school_code')||'';
  const cachedOffice=localStorage.getItem('ec_neis_office_code')||'';
  /* ★ 학교명이 아직 안 불러와져 비어 있어도(위젯이 S 로드 전 렌더되는 타이밍) 유효한 캐시 코드가 있으면 사용.
   *  학교명이 있으면 캐시명과 같을 때만 사용(학교 이동 시 자동 재조회). (사용자 보고 2026-06-17 — 급식 "못찾았다") */
  if(cachedSchool&&cachedOffice&&(!school||cachedName===school)) return {office:cachedOffice, school:cachedSchool};
  if(!key||!school) return null;
  const url=NEIS_BASE+'/schoolInfo?KEY='+encodeURIComponent(key)+'&Type=json&pSize=100&SCHUL_NM='+encodeURIComponent(school);
  const j=await _fetchJson(url);
  let rows=null;
  try{ rows=j&&j.schoolInfo&&j.schoolInfo[1]&&j.schoolInfo[1].row; }catch(_){}
  console.log('[MEAL] schoolInfo rows='+(rows?rows.length:0)+(rows&&rows[0]?(' 첫행='+rows[0].SCHUL_NM+'/'+rows[0].SD_SCHUL_CODE):'')+(j&&j.RESULT?(' RESULT='+JSON.stringify(j.RESULT)):''));
  if(!rows||!rows.length) return null;
  /* 교육청(ATPT_OFCDC_SC_NM)으로 동명 학교 구분 — 일치 우선, 없으면 첫 행 */
  const edu=_edu().replace('교육청','');
  let pick=rows[0];
  if(edu){ const m=rows.find(function(r){return String(r.ATPT_OFCDC_SC_NM||'').indexOf(edu)!==-1;}); if(m)pick=m; }
  const office=pick.ATPT_OFCDC_SC_CODE, sc=pick.SD_SCHUL_CODE;
  if(!office||!sc) return null;
  try{
    localStorage.setItem('ec_neis_office_code',office);
    localStorage.setItem('ec_neis_school_code',sc);
    localStorage.setItem('ec_neis_school_name',school);
  }catch(_){}
  return {office:office, school:sc};
}

/* 특정 날짜(ymd, 미지정 시 오늘) 급식 — {meals:[{type, menu:[...], cal}]} 또는 {error} */
async function _fetchMeals(ymd){
  if(!_neisKey()) return {error:'no-key'};
  const code=await _resolveCode();
  if(!code) return {error:'no-school'};
  const url=NEIS_BASE+'/mealServiceDietInfo?KEY='+encodeURIComponent(_neisKey())+'&Type=json'
    +'&ATPT_OFCDC_SC_CODE='+encodeURIComponent(code.office)
    +'&SD_SCHUL_CODE='+encodeURIComponent(code.school)
    +'&MLSV_YMD='+(ymd||_todayYmd());
  const j=await _fetchJson(url);
  let rows=null;
  try{ rows=j&&j.mealServiceDietInfo&&j.mealServiceDietInfo[1]&&j.mealServiceDietInfo[1].row; }catch(_){}
  if(!rows||!rows.length) return {meals:[]};   /* 데이터 없음(주말·공휴일·방학 등) */
  const order={'조식':0,'중식':1,'석식':2};
  const meals=rows.map(function(r){
    const menu=String(r.DDISH_NM||'').split(/<br\s*\/?>/i)
      .map(function(x){ return x.replace(/\s*\([0-9.\s]+\)\s*$/,'').trim(); })   /* 알레르기 숫자 제거 */
      .filter(Boolean);
    return { type:String(r.MMEAL_SC_NM||'급식').trim(), menu:menu, cal:String(r.CAL_INFO||'').trim() };
  }).sort(function(a,b){ return (order[a.type]==null?9:order[a.type])-(order[b.type]==null?9:order[b.type]); });
  return {meals:meals};
}

let _mealPopupOff = 0;   /* 현재 팝업이 보는 날짜 오프셋 (0=오늘, -1=전날, +1=다음날 …) */

/* 급식 본문 HTML — 로딩/에러/식단 */
function _mealBodyHtml(state){
  if(state.loading) return '<div style="font-size:13px;color:var(--t3);text-align:center;padding:16px 0">급식 정보를 불러오는 중…</div>';
  if(state.error==='no-key') return '<div style="font-size:12px;color:var(--t2);line-height:1.85">나이스 인증키가 없습니다.<br><b>설정 → API 관리 → 🍽️ 나이스(NEIS) — 급식·학사일정</b> 에 인증키를 등록해 주세요.</div>';
  if(state.error==='no-school') return '<div style="font-size:12px;color:var(--t2);line-height:1.85">학교를 찾지 못했습니다.<br>학교명·교육청이 정확한지, 나이스 인증키가 유효한지 확인해 주세요.</div>';
  if(!state.meals||!state.meals.length) return '<div style="font-size:13px;color:var(--t2);text-align:center;padding:12px 0">이 날은 등록된 급식이 없습니다.<br><span style="font-size:11px;color:var(--t3)">(주말·공휴일·방학 등)</span></div>';
  return state.meals.map(function(m){
    return '<div style="margin-bottom:14px">'
      +'<div style="font-size:12.5px;font-weight:800;color:#0e7490;margin-bottom:6px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:3px;height:13px;background:#0891b2;border-radius:2px"></span>'+_esc(m.type)+(m.cal?' <span style="font-size:10px;font-weight:600;color:var(--t3)">· '+_esc(m.cal)+'</span>':'')+'</div>'
      +'<div style="font-size:12px;color:var(--t1);line-height:1.9;padding-left:9px">'+m.menu.map(_esc).join('<br>')+'</div>'
      +'</div>';
  }).join('');
}

/* 팝업 렌더 — 없으면 생성, 있으면 내용만 교체. off=0 오늘 / ±N 일 이동 */
function _renderPopup(state, dateObj, off){
  const dow=['일','월','화','수','목','금','토'][dateObj.getDay()];
  const dateStr=dateObj.getFullYear()+'. '+(dateObj.getMonth()+1)+'. '+dateObj.getDate()+'. ('+dow+')';
  /* 오늘 기준 오프셋(off)으로 제목 분기 — ±2일까지 자연어, 3일 이상은 일반 (사용자 요청 2026-06-17) */
  let title;
  if(off===0) title='오늘의 학교 급식 메뉴';
  else if(off===-1) title='어제 학교 급식 메뉴';
  else if(off===1) title='내일 학교 급식 메뉴';
  else if(off===-2) title='그저께 학교 급식 메뉴';
  else if(off===2) title='모레 학교 급식 메뉴';
  else title='학교 급식 메뉴';
  const headHtml='<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:rgba(6,182,212,0.10);display:flex;align-items:center;gap:8px"><span style="font-size:18px">🍽️</span><div><div style="font-size:14px;font-weight:800;color:var(--t1)">'+_esc(title)+'</div><div style="font-size:10.5px;color:var(--t3)">'+_esc(_school()||'')+' · '+_esc(dateStr)+'</div></div></div>';
  /* 확인 버튼 대신 |전날|오늘|다음날| 네비게이션 (클릭마다 날짜 이동) */
  const navHtml='<div style="display:flex;border-top:1px solid var(--bdr);flex:none">'
    +'<button data-meal-nav="prev" type="button" style="flex:1;padding:11px 0;font-size:12px;font-weight:700;border:none;border-right:1px solid var(--bdr);background:var(--card);color:var(--t2);cursor:pointer;font-family:var(--f)">◂ 1일 전</button>'
    +'<button data-meal-nav="today" type="button" style="flex:1;padding:11px 0;font-size:12px;font-weight:800;border:none;border-right:1px solid var(--bdr);background:'+(off===0?'rgba(6,182,212,0.10)':'var(--card)')+';color:'+(off===0?'var(--cyan)':'var(--t2)')+';cursor:pointer;font-family:var(--f)">오늘</button>'
    +'<button data-meal-nav="next" type="button" style="flex:1;padding:11px 0;font-size:12px;font-weight:700;border:none;background:var(--card);color:var(--t2);cursor:pointer;font-family:var(--f)">1일 후 ▸</button>'
    +'</div>';
  const boxInner=headHtml
    +'<div id="mealPopupBody" style="padding:18px 22px;overflow-y:auto;flex:1 1 auto">'+_mealBodyHtml(state)+'</div>'
    +navHtml;
  let ov=document.getElementById('mealPopupOverlay');
  if(ov){
    const box=document.getElementById('mealPopupBox');
    if(box){ box.innerHTML=boxInner; _bindMealNav(); return; }
  }
  try{ playUiSound('happybell.wav', 0.7); }catch(_){}   /* 급식 메뉴 팝업 최초 표시 효과음 (사용자 요청 2026-06-18) — 날짜 네비게이션 재사용 경로에서는 위에서 return */
  ov=document.createElement('div');
  ov.id='mealPopupOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.32);z-index:13050;opacity:0;transition:opacity 0.15s ease';
  ov.innerHTML='<div id="mealPopupBox" style="background:var(--card);border-radius:14px;width:420px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.18s ease,transform 0.18s ease">'+boxInner+'</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('mealPopupBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  ov.addEventListener('mousedown',function(e){ if(e.target!==ov)return; ov.style.opacity='0'; const b=document.getElementById('mealPopupBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.96)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },180); });
  _bindMealNav();
}

/* 평일 판정 — 주말·공휴일(특일정보 API: S.koreanHolidays) 제외 */
function _ymdKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function _isSchoolDay(d){
  const wd=d.getDay();
  if(wd===0||wd===6) return false;                /* 토·일 */
  try{ ensureHolidayYear(String(d.getFullYear())); }catch(_){}
  const hol=(S&&S.koreanHolidays)||{};
  if(hol[_ymdKey(d)]) return false;               /* 공휴일·대체휴일 */
  return true;
}
/* fromOff(오늘 기준) 에서 dir(+1/-1) 방향으로 가장 가까운 평일 오프셋 — 주말·공휴일 건너뜀 */
function _nextSchoolOffset(fromOff, dir){
  for(let i=1;i<=31;i++){
    const off=fromOff+dir*i;
    const d=new Date(); d.setDate(d.getDate()+off);
    if(_isSchoolDay(d)) return off;
  }
  return fromOff+dir;   /* 안전망 */
}

function _bindMealNav(){
  ['prev','today','next'].forEach(function(k){
    const b=document.querySelector('#mealPopupBox [data-meal-nav="'+k+'"]');
    if(!b)return;
    b.addEventListener('click',function(){
      /* 1일 전 / 1일 후 = 가장 가까운 평일(주말·공휴일 건너뜀), 오늘 = 실제 오늘 */
      const off=(k==='today')?0:_nextSchoolOffset(_mealPopupOff, k==='prev'?-1:1);
      _showMealAt(off, {});
    });
  });
}

/* 지정 오프셋(0=오늘) 급식 로드 + 팝업 표시/갱신 */
async function _showMealAt(off, opts){
  opts=opts||{};
  _mealPopupOff=off;
  const d=new Date(); d.setDate(d.getDate()+off);
  const ymd=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
  if(opts.silent){   /* 자동 첫 표시: 데이터 없으면 팝업 안 띄움 */
    const r=await _fetchMeals(ymd);
    if(r.error || !r.meals || !r.meals.length) return;
    _renderPopup(r, d, off);
    return;
  }
  /* 네비게이션 중에는 로딩 표시로 본문을 비우지 않는다(팝업이 줄었다 커지는 깜빡임 방지).
     이전 내용을 그대로 둔 채 새 데이터가 오면 교체. */
  const r=await _fetchMeals(ymd);
  if(_mealPopupOff!==off) return;   /* 빠른 연속 이동 레이스 방지 */
  _renderPopup(r, d, off);
}

/* 공개 — 급식 팝업 표시(오늘부터). opts.silent=true(자동) 면 데이터 없을 때 조용히 패스. */
export async function showSchoolMealPopup(opts){
  return _showMealAt(0, opts||{});
}

/* 공개 — 지정 날짜(ymd='YYYYMMDD', 미지정 시 오늘) 급식 조회. 대시보드 위젯 등에서 사용.
 * 반환: {meals:[{type,menu,cal}]} 또는 {error:'no-key'|'no-school'} */
export async function getMealsForDate(ymd){ return _fetchMeals(ymd); }

/* ── 스케줄러 — ec_meal_popup_on==='Y' 일 때 지정 시각에 하루 1회 ── */
let _mealTimer=null;
export function restartMealScheduler(){
  if(_mealTimer){ clearInterval(_mealTimer); _mealTimer=null; }
  if(localStorage.getItem('ec_meal_popup_on')!=='Y') return;
  _mealTimer=setInterval(function(){
    try{
      if(localStorage.getItem('ec_meal_popup_on')!=='Y'){ clearInterval(_mealTimer); _mealTimer=null; return; }
      const t=(localStorage.getItem('ec_meal_popup_time')||'09:30');
      const now=new Date();
      const cur=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
      const todayStr=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
      if(cur===t && localStorage.getItem('ec_meal_popup_last')!==todayStr){
        localStorage.setItem('ec_meal_popup_last',todayStr);
        showSchoolMealPopup({silent:true});
      }
    }catch(_){}
  }, 30000);   /* 30초마다 확인 → 지정 분(60초) 안에 반드시 1회 잡힘 */
}
export function maybeStartMealScheduler(){ restartMealScheduler(); }

/* 공통 NEIS 헬퍼 — 다른 모듈(학사일정 등)에서 재사용 */
export { _fetchJson as neisFetchJson, _resolveCode as resolveNeisCode, _neisKey as neisKey, NEIS_BASE };
