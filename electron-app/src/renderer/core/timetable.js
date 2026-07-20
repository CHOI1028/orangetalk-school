/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════════════════════════════
 *  학교 시간표 검색 (나이스 Open API) — 2026-06-17
 *  ───────────────────────────────────────────────────────────────
 *  · 인증키·학교코드는 급식·학사일정과 동일(같은 나이스 키 1개)
 *  · 학교급에 따라 엔드포인트 자동 선택:
 *      초등학교 elsTimetable · 중학교 misTimetable · 고등학교 hisTimetable · 특수학교 spsTimetable
 *  · 고등학교·특수학교는 학과(계열)가 여러 개 → schoolAptInfo 로 학과 목록을 받아 콤보박스로 제공
 *  · 학년도/학기/학년/반/날짜(+학과) 를 골라 교시별 수업내용을 조회
 * ═══════════════════════════════════════════════════════════════ */

import { neisFetchJson, resolveNeisCode, neisKey, NEIS_BASE } from './school-meal.js';
import { getClassPopups, addClassPopup, removeClassPopupByKey, clearAllClassPopups, classPopupKey, classDowLabel } from './class-popup.js';
import { appConfirmModal } from './ui-utils.js';

const KIND_ENDPOINT = { '초등학교':'elsTimetable', '중학교':'misTimetable', '고등학교':'hisTimetable', '특수학교':'spsTimetable' };
function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

/* 학교급(초/중/고/특수) — 캐시 우선. schoolInfo 의 SCHUL_KND_SC_NM */
let _kind = null;
async function _getSchoolKind(){
  if(_kind) return _kind;
  const cached=localStorage.getItem('ec_neis_school_kind'); if(cached){ _kind=cached; return cached; }
  const key=neisKey(); const code=await resolveNeisCode();
  if(!key||!code) return null;
  const url=NEIS_BASE+'/schoolInfo?KEY='+encodeURIComponent(key)+'&Type=json&pSize=1'
    +'&ATPT_OFCDC_SC_CODE='+encodeURIComponent(code.office)+'&SD_SCHUL_CODE='+encodeURIComponent(code.school);
  const j=await neisFetchJson(url);
  let row=null; try{ row=j&&j.schoolInfo&&j.schoolInfo[1]&&j.schoolInfo[1].row&&j.schoolInfo[1].row[0]; }catch(_){}
  if(row&&row.SCHUL_KND_SC_NM){ _kind=String(row.SCHUL_KND_SC_NM).trim(); try{localStorage.setItem('ec_neis_school_kind',_kind);}catch(_){} return _kind; }
  return null;
}

/* 학과 목록(고/특수) — [{dept, ord, dght}] */
async function _getDepartments(){
  const key=neisKey(); const code=await resolveNeisCode(); if(!key||!code) return [];
  const url=NEIS_BASE+'/schoolAptInfo?KEY='+encodeURIComponent(key)+'&Type=json&pSize=200'
    +'&ATPT_OFCDC_SC_CODE='+encodeURIComponent(code.office)+'&SD_SCHUL_CODE='+encodeURIComponent(code.school);
  const j=await neisFetchJson(url);
  let rows=null; try{ rows=j&&j.schoolAptInfo&&j.schoolAptInfo[1]&&j.schoolAptInfo[1].row; }catch(_){}
  if(!rows) return [];
  const seen={}, out=[];
  rows.forEach(function(r){ const d=String(r.DDDEP_NM||'').trim(); if(d&&!seen[d]){seen[d]=1; out.push({dept:d, ord:String(r.ORD_SC_NM||'').trim(), dght:String(r.DGHT_CRSE_SC_NM||'').trim()});} });
  return out;
}

/* 시간표 조회 — params:{ay,sem,ymd,grade,cls,dept} → {rows:[{perio,content,room,grade,cls,ymd}], kind} 또는 {error} */
async function _fetchTimetable(params){
  const key=neisKey(); if(!key) return {error:'no-key'};
  const code=await resolveNeisCode(); if(!code) return {error:'no-school'};
  const kind=await _getSchoolKind(); const op=KIND_ENDPOINT[kind]||'hisTimetable';
  let url=NEIS_BASE+'/'+op+'?KEY='+encodeURIComponent(key)+'&Type=json&pSize=300'
    +'&ATPT_OFCDC_SC_CODE='+encodeURIComponent(code.office)+'&SD_SCHUL_CODE='+encodeURIComponent(code.school);
  if(params.ay)   url+='&AY='+encodeURIComponent(params.ay);
  if(params.sem)  url+='&SEM='+encodeURIComponent(params.sem);
  if(params.ymd)  url+='&ALL_TI_YMD='+encodeURIComponent(params.ymd);
  if(params.grade)url+='&GRADE='+encodeURIComponent(params.grade);
  if(params.cls)  url+='&CLASS_NM='+encodeURIComponent(params.cls);
  if(params.dept && (kind==='고등학교'||kind==='특수학교')) url+='&DDDEP_NM='+encodeURIComponent(params.dept);
  const j=await neisFetchJson(url);
  let rows=null; try{ rows=j&&j[op]&&j[op][1]&&j[op][1].row; }catch(_){}
  if(!rows||!rows.length) return {rows:[], kind:kind};
  const out=rows.map(function(r){ return {
    perio:String(r.PERIO||'').trim(), content:String(r.ITRT_CNTNT||'').trim(),
    room:String(r.CLRM_NM||'').trim(), grade:String(r.GRADE||'').trim(),
    cls:String(r.CLASS_NM||'').trim(), ymd:String(r.ALL_TI_YMD||'').trim() };
  });
  out.sort(function(a,b){ return (parseInt(a.perio)||99)-(parseInt(b.perio)||99); });
  return {rows:out, kind:kind};
}

/* 한 주(월~금) 시간표 — params:{ay,sem,fromYmd,toYmd,grade?,cls?,dept?} → {rows,kind} 또는 {error} (사용자 요청 2026-06-17 표 형태) */
async function _fetchTimetableWeek(params){
  const key=neisKey(); if(!key) return {error:'no-key'};
  const code=await resolveNeisCode(); if(!code) return {error:'no-school'};
  const kind=await _getSchoolKind(); const op=KIND_ENDPOINT[kind]||'hisTimetable';
  let url=NEIS_BASE+'/'+op+'?KEY='+encodeURIComponent(key)+'&Type=json&pSize=1000'
    +'&ATPT_OFCDC_SC_CODE='+encodeURIComponent(code.office)+'&SD_SCHUL_CODE='+encodeURIComponent(code.school);
  if(params.ay)   url+='&AY='+encodeURIComponent(params.ay);
  if(params.sem)  url+='&SEM='+encodeURIComponent(params.sem);
  if(params.fromYmd) url+='&TI_FROM_YMD='+encodeURIComponent(params.fromYmd);
  if(params.toYmd)   url+='&TI_TO_YMD='+encodeURIComponent(params.toYmd);
  if(params.grade)url+='&GRADE='+encodeURIComponent(params.grade);
  if(params.cls)  url+='&CLASS_NM='+encodeURIComponent(params.cls);
  if(params.dept && (kind==='고등학교'||kind==='특수학교')) url+='&DDDEP_NM='+encodeURIComponent(params.dept);
  const j=await neisFetchJson(url);
  let rows=null; try{ rows=j&&j[op]&&j[op][1]&&j[op][1].row; }catch(_){}
  if(!rows||!rows.length) return {rows:[], kind:kind};
  const out=rows.map(function(r){ return {
    perio:String(r.PERIO||'').trim(), content:String(r.ITRT_CNTNT||'').trim(),
    room:String(r.CLRM_NM||'').trim(), grade:String(r.GRADE||'').trim(),
    cls:String(r.CLASS_NM||'').trim(), dept:String(r.DDDEP_NM||'').trim(), ymd:String(r.ALL_TI_YMD||'').trim() };
  });
  return {rows:out, kind:kind};
}
/* 'YYYYMMDD' 가 포함된 주의 월~금 5일 배열 */
function _weekRange(ymd){
  const s=/^\d{8}$/.test(ymd)?ymd:_todayYmd();
  const dt=new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
  const dow=dt.getDay(); const monOff=(dow===0?-6:1-dow);
  const mon=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()+monOff);
  const out=[]; for(let i=0;i<5;i++){ const x=new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+i); out.push(x.getFullYear()+String(x.getMonth()+1).padStart(2,'0')+String(x.getDate()).padStart(2,'0')); }
  return out;
}

/* 현재 학년도/학기 추정 (한국 학사: 3~8월=1학기, 그 외=2학기. 학년도=새학년 시작 연도) */
function _defaultAySem(){
  const d=new Date(); const m=d.getMonth()+1;
  const ay=(m>=3)?d.getFullYear():(d.getFullYear()-1);
  const sem=(m>=3&&m<=7)?1:2;   /* 단순화: 3~7월 1학기 */
  return {ay:ay, sem:sem};
}
function _todayYmd(){ const d=new Date(); return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }
function _ymdToInput(y){ return /^\d{8}$/.test(y)? (y.slice(0,4)+'-'+y.slice(4,6)+'-'+y.slice(6,8)) : ''; }

let _ttDepts = [];   /* 마지막으로 받은 학과 목록 */

/* 공개 — 시간표 검색 모달 표시 */
export async function showTimetableModal(opts){
  opts=opts||{};
  const PICK=!!opts.pick;   /* 수업 팝업 대상 선택 모드 — 셀 클릭으로 알림 시각 지정 */
  const old=document.getElementById('ttSearchOverlay'); if(old)old.remove();
  const sel='font-size:12px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1);font-family:var(--f)';
  const def=_defaultAySem();
  /* 학년도 옵션 — 당해학년도만 (사용자 요청 2026-06-17) */
  let ayOpts='<option value="'+def.ay+'" selected>'+def.ay+'학년도</option>';

  const ov=document.createElement('div');
  ov.id='ttSearchOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13050;opacity:0;transition:opacity 0.15s ease';
  ov.innerHTML='<div id="ttSearchBox" style="background:var(--card);border-radius:14px;width:1140px;max-width:97vw;height:auto;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity 0.18s,transform 0.18s">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:18px">'+(PICK?'🔔':'🔍')+'</span><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">'+(PICK?'나의 수업 시간 선택':'나이스 전체 시간표 보기')+'</div><div id="ttKindLine" style="font-size:10.5px;color:var(--t3)">'+(PICK?'학교급 확인 중…':'학교급 확인 중…')+'</div>'+(PICK?'<div style="font-size:12.5px;color:#ec4899;font-weight:700;margin-top:4px">원클릭으로 나의 수업 선택, 더블클릭으로 팝업 알림 시간 선택이 가능합니다.</div>':'')+'</div>'
      +'<button id="ttFilterBtn" type="button" style="padding:7px 14px;background:linear-gradient(135deg,var(--cyan),#0891b2);color:#fff;border:none;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:var(--f);align-self:center">🔎 필터링 검색</button>'
      +'<button id="ttReload" type="button" style="margin-left:6px;padding:7px 12px;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:var(--f);align-self:center">↻ 새로고침</button>'
      +(PICK?'<button id="ttClearAll" type="button" style="margin-left:6px;padding:7px 12px;background:linear-gradient(135deg,#ec4899,#db2777);color:#fff;border:none;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:var(--f);align-self:center">🗑 모두 삭제</button>':'')
      +'</div>'   /* X 닫기 제거 — 바깥 클릭으로 닫음. 입력폼·조회 버튼 제거 — 열면 이번 주 자동 표시. 상세조건은 [필터링 검색] (사용자 요청 2026-06-17) */
    +'<div id="ttResult" style="padding:14px 20px;overflow:auto;flex:0 0 auto;min-height:160px;font-size:12px;color:var(--t2)">이번 주 시간표를 불러오는 중…</div>'
    +'</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('ttSearchBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('ttSearchBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.97)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },180); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  const cls=document.getElementById('ttClose'); if(cls)cls.addEventListener('click',close);
  if(PICK){
    /* 원클릭 = 나의 수업 선택/해제 토글, 더블클릭 = 팝업 알림 시간 지정 (사용자 요청 2026-06-17).
     *  더블클릭의 첫 click 이 토글되지 않도록 240ms 디바운스 — 시간 내 두 번째 click 오면 dblclick 으로 처리. */
    const _resEl=document.getElementById('ttResult');
    let _cpClickTimer=null;
    if(_resEl){
      _resEl.addEventListener('click',function(e){ const td=e.target.closest('td[data-cp-dow]'); if(!td)return;
        if(_cpClickTimer)return;   /* 더블클릭의 두 번째 click → 무시 */
        _cpClickTimer=setTimeout(function(){ _cpClickTimer=null; _toggleClassSelect(td); }, 240);
      });
      _resEl.addEventListener('dblclick',function(e){ const td=e.target.closest('td[data-cp-dow]'); if(!td)return;
        if(_cpClickTimer){ clearTimeout(_cpClickTimer); _cpClickTimer=null; }
        _openTimePicker(td);
      });
    }
  }

  /* 필터 상태 — [필터링 검색] 서브모달이 갱신. 기본: 올해/현학기/전체. (사용자 요청 2026-06-17) */
  const _dfl=_defaultAySem();
  const _flt={ ay:String(_dfl.ay), sem:String(_dfl.sem), dept:'', grade:'', cls:'' };
  /* 열면 바로 이번 주 시간표 표시 (입력폼·조회 버튼 없음) — 자동 로드 함수 */
  async function _ttLoad(){
    const res=document.getElementById('ttResult'); if(!res)return;
    if(!neisKey()){ res.innerHTML='<div style="color:var(--t2)">나이스 인증키가 없습니다. 설정 → API 관리에서 등록해 주세요.</div>'; return; }
    const ay=_flt.ay, sem=_flt.sem, grade=String(_flt.grade||''), clsv=String(_flt.cls||''), dept=String(_flt.dept||'');
    res.innerHTML='<div style="text-align:center;color:var(--t3);padding:16px 0">이번 주 시간표 불러오는 중…</div>';
    /* 주간(월~금) × (학년·학과) 표 — 이번 주 (사용자 요청 2026-06-17) */
    const week=_weekRange(_todayYmd());
    const r=await _fetchTimetableWeek({ay:ay,sem:sem,fromYmd:week[0],toYmd:week[4],grade:grade,cls:clsv,dept:dept});
    if(r.error==='no-key'){ res.innerHTML='<div style="color:var(--t2)">나이스 인증키가 없습니다. 설정 → API 관리에서 등록해 주세요.</div>'; return; }
    if(r.error==='no-school'){ res.innerHTML='<div style="color:var(--t2)">학교를 찾지 못했습니다.</div>'; return; }
    const rows=r.rows||[];
    /* 응답의 학과(DDDEP_NM)로도 학과 목록 보강 — schoolAptInfo 가 비어도 필터링 검색에 학과가 나오게 (사용자 보고 2026-06-17) */
    { const _have={}; (_ttDepts||[]).forEach(function(d){_have[d.dept]=1;}); Array.from(new Set(rows.map(function(x){return x.dept;}).filter(Boolean))).forEach(function(dn){ if(!_have[dn]){ _ttDepts.push({dept:dn,ord:'',dght:''}); _have[dn]=1; } }); }
    if(!rows.length){ res.innerHTML='<div style="color:var(--t2);text-align:center;padding:12px 0">해당 조건의 시간표가 없습니다.<br><span style="font-size:10.5px;color:var(--t3)">학기·학과(계열)·주(날짜)를 확인하거나, 아직 시간표가 등록되지 않았을 수 있습니다.</span></div>'; return; }
    /* 컬럼 = (학년 × 학과) 조합 — 학과가 여러 개면 학과별로 구분해 표기 (사용자 요청 2026-06-17).
     *  학년 입력 시 그 학년만. 반 입력 시 그 반만(fetch 에서 필터). */
    const _seen={}; let pairs=[];
    rows.forEach(function(x){ if(grade && String(x.grade)!==String(grade))return; const k=x.grade+''+(x.dept||''); if(!_seen[k]){_seen[k]=1; pairs.push({grade:x.grade, dept:x.dept||''});} });
    const _deptsPresent=Array.from(new Set(pairs.map(function(p){return p.dept;}).filter(Boolean)));
    const _multiDept=_deptsPresent.length>1;   /* 학과가 둘 이상일 때만 라벨에 학과명 병기 */
    pairs.sort(function(a,b){ const g=(parseInt(a.grade)||0)-(parseInt(b.grade)||0); if(g)return g; return String(a.dept).localeCompare(String(b.dept),'ko'); });
    if(!pairs.length) pairs=[{grade:'',dept:''}];
    const cols=pairs.map(function(p){ return { key:p.grade+''+p.dept, grade:p.grade, dept:p.dept, label:(p.grade?_esc(p.grade)+'학년':'-')+((_multiDept&&p.dept)?('<br><span style="font-weight:600;color:var(--t3);font-size:9.5px">'+_esc(p.dept)+'</span>'):'') }; });
    /* 최대 교시 */
    let maxP=1; rows.forEach(function(x){ const p=parseInt(x.perio)||0; if(p>maxP)maxP=p; });
    /* map[ymd][gradeDeptKey][perio] = 수업내용 (같은 칸 충돌 시 첫 값 유지) */
    const map={};
    rows.forEach(function(x){ const k=x.grade+''+(x.dept||''); if(!map[x.ymd])map[x.ymd]={}; if(!map[x.ymd][k])map[x.ymd][k]={}; if(map[x.ymd][k][x.perio]==null)map[x.ymd][k][x.perio]=x.content; });
    /* 수업 팝업 대상 선택 모드: 이미 선택된 칸(요일·교시·학년·학과·반) → 시각 맵 */
    const _pickMap={};
    if(PICK){ getClassPopups().forEach(function(x){ _pickMap[classPopupKey(x)]=x; }); }
    const DOW=['월','화','수','목','금'];
    const _md=function(y){ return (parseInt(y.slice(4,6))||0)+'/'+(parseInt(y.slice(6,8))||0); };
    const _todayY=_todayYmd();
    const bd='1px solid var(--bdr)';
    let h='<div style="overflow:auto;max-height:58vh;scrollbar-width:thin;scrollbar-color:var(--cyan) var(--bg2)"><table style="border-collapse:collapse;font-size:11px;table-layout:fixed">';
    /* 헤더 1행: 교시(rowspan2) + 요일(colspan=학년·학과 컬럼수) */
    h+='<thead><tr><th rowspan="2" style="position:sticky;left:0;z-index:2;background:var(--bg2);border:'+bd+';padding:6px 8px;width:48px;color:var(--t2)">교시</th>';
    week.forEach(function(wy,i){ const tdy=(wy===_todayY); h+='<th colspan="'+cols.length+'" style="border:'+bd+';padding:5px 6px;background:'+(tdy?'rgba(6,182,212,0.12)':'var(--bg2)')+';color:'+(tdy?'var(--cyan)':'var(--t1)')+';font-weight:800">'+DOW[i]+' <span style="font-weight:600;color:var(--t3);font-size:10px">'+_md(wy)+'</span></th>'; });
    h+='</tr><tr>';
    week.forEach(function(wy){ const tdy=(wy===_todayY); cols.forEach(function(c){ h+='<th style="border:'+bd+';padding:4px 5px;background:'+(tdy?'rgba(6,182,212,0.06)':'var(--bg2)')+';color:var(--t2);font-weight:700;min-width:84px;line-height:1.25">'+c.label+'</th>'; }); });
    h+='</tr></thead><tbody>';
    for(let p=1;p<=maxP;p++){
      h+='<tr><td style="position:sticky;left:0;z-index:1;background:var(--card);border:'+bd+';padding:5px 6px;text-align:center;font-weight:700;color:var(--cyan)">'+p+'교시</td>';
      week.forEach(function(wy,di){ cols.forEach(function(c){ const cc=(map[wy]&&map[wy][c.key]&&map[wy][c.key][p])||'';
        if(PICK){
          const _k=[di,p,c.grade||'',c.dept||'',clsv||''].join('|');
          const _selEntry=_pickMap[_k];
          const _sel=!!_selEntry; const _selT=_selEntry&&_selEntry.time;
          h+='<td data-cp-dow="'+di+'" data-cp-perio="'+p+'" data-cp-content="'+_esc(cc)+'" data-cp-grade="'+_esc(c.grade||'')+'" data-cp-dept="'+_esc(c.dept||'')+'" data-cp-cls="'+_esc(clsv||'')+'" style="border:'+bd+';padding:5px 6px;text-align:center;cursor:pointer;color:var(--t1);white-space:normal;word-break:break-all;line-height:1.35'+(_sel?';background:rgba(236,72,153,0.18);font-weight:700':'')+'">'+_esc(cc)+(_sel?('<div class="cp-badge" style="font-size:9px;color:#db2777;margin-top:2px;font-weight:700">'+(_selT?('⏰ '+_esc(_selT)):'✓ 선택됨')+'</div>'):'')+'</td>';
        } else {
          h+='<td style="border:'+bd+';padding:5px 6px;text-align:center;color:var(--t1);white-space:normal;word-break:break-all;line-height:1.35">'+_esc(cc)+'</td>';
        }
      }); });
      h+='</tr>';
    }
    h+='</tbody></table></div>';
    h+='<div style="font-size:10px;color:var(--t3);margin-top:8px">'+week[0].slice(0,4)+'년 '+_md(week[0])+' ~ '+_md(week[4])+' 주간'+(dept?(' · '+_esc(dept)):(_multiDept?' · 전체 학과':''))+(clsv?(' · '+_esc(clsv)+'반'):'')+'</div>';
    res.innerHTML=h;
  }

  /* 학교급 + 학과 목록 로드 → 자동 표시 */
  (async function(){
    if(!neisKey()){ const k=document.getElementById('ttKindLine'); if(k)k.innerHTML='<span style="color:#ef4444">나이스 인증키 미등록</span> — 설정 → API 관리'; return; }
    const kind=await _getSchoolKind();
    const kl=document.getElementById('ttKindLine');
    if(kl)kl.textContent=kind?(kind+' · 나이스 교육정보 개방 포털에서 데이터를 불러옵니다.'):'학교를 찾지 못했습니다 (학교명·교육청 확인)';
    if(kind==='고등학교'||kind==='특수학교'){ try{ _ttDepts=await _getDepartments(); }catch(_){ _ttDepts=[]; } }
    _ttLoad();
  })();
  const _rl=document.getElementById('ttReload'); if(_rl)_rl.addEventListener('click',function(){ _flt.grade=''; _flt.cls=''; _flt.dept=''; _ttLoad(); });
  const _ca=document.getElementById('ttClearAll'); if(_ca)_ca.addEventListener('click',function(){
    if(!getClassPopups().length){ try{ appConfirmModal('선택한 수업이 없습니다.','알림',{okOnly:true}); }catch(_){} return; }
    appConfirmModal('선택한 나의 수업과 알림을 모두 삭제할까요?','모두 삭제',{okLabel:'모두 삭제'}).then(function(ok){ if(ok){ clearAllClassPopups(); _ttLoad(); } });
  });
  const _fb=document.getElementById('ttFilterBtn'); if(_fb)_fb.addEventListener('click',_openFilter);

  /* ── 필터링 검색 서브모달 — 학년도/학기/학과(있을 때)/학년/반 드롭다운. 열고 닫을 때 애니메이션. (사용자 요청 2026-06-17) ── */
  function _openFilter(){
    const old=document.getElementById('ttFilterOv'); if(old)old.remove();
    let ayO='<option value="'+_flt.ay+'" selected>'+_flt.ay+'학년도</option>'; /* 당해학년도만 (사용자 요청 2026-06-17) */
    let gradeO='<option value="">전체</option>'; for(let g=1;g<=6;g++){ gradeO+='<option value="'+g+'"'+(String(g)===String(_flt.grade)?' selected':'')+'>'+g+'학년</option>'; }
    let deptO='<option value="">전체 학과</option>'; (_ttDepts||[]).forEach(function(d){ deptO+='<option value="'+_esc(d.dept)+'"'+(d.dept===_flt.dept?' selected':'')+'>'+_esc(d.dept)+(d.ord?(' ('+_esc(d.ord)+')'):'')+'</option>'; });
    const hasDept=(_ttDepts||[]).length>0;
    const fsel='font-size:12px;padding:7px 9px;border:1px solid var(--bdr);border-radius:7px;background:var(--bg2);color:var(--t1);font-family:var(--f);width:100%';
    const lab='display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--t2)';
    const ov=document.createElement('div');
    ov.id='ttFilterOv';
    ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13070;opacity:0;transition:opacity 0.15s ease';
    ov.innerHTML='<div id="ttFilterBox" style="background:var(--card);border-radius:14px;width:360px;max-width:92vw;box-shadow:0 18px 48px rgba(0,0,0,0.4);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.18s,transform 0.2s cubic-bezier(0.34,1.4,0.64,1)">'
      +'<div style="padding:13px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));font-size:13.5px;font-weight:800;color:var(--t1)">🔎 필터링 검색</div>'
      +'<div style="padding:16px 18px;display:flex;flex-direction:column;gap:11px">'
        +'<div style="display:flex;gap:10px"><label style="'+lab+';flex:1">학년도<select id="ttfAy" style="'+fsel+'">'+ayO+'</select></label>'
          +'<label style="'+lab+';flex:1">학기<select id="ttfSem" style="'+fsel+'"><option value="1"'+(_flt.sem==='1'?' selected':'')+'>1학기</option><option value="2"'+(_flt.sem==='2'?' selected':'')+'>2학기</option></select></label></div>'
        +(hasDept?'<label style="'+lab+'">학과(계열)<select id="ttfDept" style="'+fsel+'">'+deptO+'</select></label>':'')
        +'<div style="display:flex;gap:10px"><label style="'+lab+';flex:1">학년<select id="ttfGrade" style="'+fsel+'">'+gradeO+'</select></label>'
          +'<label style="'+lab+';flex:1">반<input id="ttfCls" type="text" value="'+_esc(_flt.cls)+'" placeholder="전체 (예: 3)" style="'+fsel+'"></label></div>'
      +'</div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--bdr)">'
        +'<button id="ttfReset" type="button" style="padding:7px 14px;font-size:12px;font-weight:600;border:1px solid var(--bdr);background:transparent;color:var(--t2);border-radius:7px;cursor:pointer;font-family:var(--f)">초기화</button>'
        +'<button id="ttfApply" type="button" style="padding:7px 18px;font-size:12px;font-weight:700;border:none;background:linear-gradient(135deg,var(--cyan),#0891b2);color:#fff;border-radius:7px;cursor:pointer;font-family:var(--f)">적용</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('ttFilterBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
    const fclose=function(){ ov.style.opacity='0'; const b=document.getElementById('ttFilterBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.95)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },190); };
    ov.addEventListener('mousedown',function(e){ if(e.target===ov)fclose(); });
    const _rs=document.getElementById('ttfReset'); if(_rs)_rs.addEventListener('click',function(){ const d=_defaultAySem(); _flt.ay=String(d.ay); _flt.sem=String(d.sem); _flt.dept=''; _flt.grade=''; _flt.cls=''; fclose(); _ttLoad(); });
    const _ap=document.getElementById('ttfApply'); if(_ap)_ap.addEventListener('click',function(){
      _flt.ay=(document.getElementById('ttfAy')||{}).value||_flt.ay;
      _flt.sem=(document.getElementById('ttfSem')||{}).value||_flt.sem;
      _flt.dept=hasDept?((document.getElementById('ttfDept')||{}).value||''):'';
      _flt.grade=(document.getElementById('ttfGrade')||{}).value||'';
      _flt.cls=((document.getElementById('ttfCls')||{}).value||'').trim();
      fclose(); _ttLoad();
    });
  }

  /* ── 셀 클릭 → "팝업 알림을 희망하는 시간을 지정하세요" 미니 팝업 (수업 팝업 대상 선택 모드) ── */
  function _openTimePicker(td){
    const dow=td.dataset.cpDow, perio=td.dataset.cpPerio, content=td.dataset.cpContent||'';
    const grade=td.dataset.cpGrade||'', dept=td.dataset.cpDept||'', clsv2=td.dataset.cpCls||'';
    const key=[dow,perio,grade,dept,clsv2].join('|');
    const existing=getClassPopups().find(function(x){ return classPopupKey(x)===key; });
    const cur=(existing&&existing.time)||'08:40';
    const cm=cur.match(/^(\d{1,2}):(\d{2})$/); let ch=cm?parseInt(cm[1],10):8; const cmin=cm?parseInt(cm[2],10):40;
    let hOpts=''; for(let h=7;h<=18;h++){ hOpts+='<option value="'+h+'"'+(h===ch?' selected':'')+'>'+String(h).padStart(2,'0')+'시</option>'; }
    let mOpts=''; for(let m=0;m<60;m+=5){ mOpts+='<option value="'+m+'"'+(m===cmin?' selected':'')+'>'+String(m).padStart(2,'0')+'분</option>'; }
    const _ssel='font-size:13px;padding:7px 10px;border:1px solid var(--bdr);border-radius:7px;background:var(--bg2);color:var(--t1);font-family:var(--f)';
    const dowL=classDowLabel(parseInt(dow,10));
    const old=document.getElementById('cpTimeOv'); if(old)old.remove();
    const ov=document.createElement('div'); ov.id='cpTimeOv';
    ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);z-index:13090;opacity:0;transition:opacity 0.15s';
    ov.innerHTML='<div id="cpTimeBox" style="background:var(--card);border-radius:14px;width:340px;max-width:92vw;box-shadow:0 18px 48px rgba(0,0,0,0.4);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.18s,transform 0.2s cubic-bezier(0.34,1.4,0.64,1)">'
      +'<div style="padding:14px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(236,72,153,0.14),rgba(139,92,246,0.06))"><div style="font-size:13.5px;font-weight:800;color:var(--t1)">⏰ 팝업 알림을 희망하는 시간을 지정하세요.</div><div style="font-size:10.5px;color:var(--t3);margin-top:3px">'+_esc(dowL)+'요일 '+_esc(perio)+'교시'+(content?(' · '+_esc(content)):'')+'</div></div>'
      +'<div style="padding:18px;display:flex;align-items:center;justify-content:center;gap:8px"><select id="cpTimeHour" style="'+_ssel+'">'+hOpts+'</select><select id="cpTimeMin" style="'+_ssel+'">'+mOpts+'</select></div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--bdr)">'
        +(existing?'<button id="cpTimeDel" type="button" style="padding:7px 14px;font-size:12px;font-weight:600;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);color:#dc2626;border-radius:7px;cursor:pointer;font-family:var(--f);margin-right:auto">선택 해제</button>':'')
        +'<button id="cpTimeCancel" type="button" style="padding:7px 14px;font-size:12px;font-weight:600;border:1px solid var(--bdr);background:transparent;color:var(--t2);border-radius:7px;cursor:pointer;font-family:var(--f)">취소</button>'
        +'<button id="cpTimeSave" type="button" style="padding:7px 18px;font-size:12px;font-weight:700;border:none;background:linear-gradient(135deg,#ec4899,#a855f7);color:#fff;border-radius:7px;cursor:pointer;font-family:var(--f)">저장</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('cpTimeBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
    const tclose=function(){ ov.style.opacity='0'; const b=document.getElementById('cpTimeBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.95)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },180); };
    ov.addEventListener('mousedown',function(e){ if(e.target===ov)tclose(); });
    const _c=document.getElementById('cpTimeCancel'); if(_c)_c.addEventListener('click',tclose);
    const _mark=function(time){
      td.style.background='rgba(236,72,153,0.18)'; td.style.fontWeight='700';
      let badge=td.querySelector('.cp-badge');
      if(!badge){ badge=document.createElement('div'); badge.className='cp-badge'; badge.style.cssText='font-size:9px;color:#db2777;margin-top:2px;font-weight:700'; td.appendChild(badge); }
      badge.textContent='⏰ '+time;
    };
    const _sv=document.getElementById('cpTimeSave');
    if(_sv)_sv.addEventListener('click',function(){
      const h=(document.getElementById('cpTimeHour')||{}).value||'8';
      const m=(document.getElementById('cpTimeMin')||{}).value||'0';
      const time=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
      addClassPopup({ dow:parseInt(dow,10), perio:perio, content:content, grade:grade, dept:dept, cls:clsv2, time:time });
      _mark(time); tclose();
    });
    const _del=document.getElementById('cpTimeDel');
    if(_del)_del.addEventListener('click',function(){
      removeClassPopupByKey(key);
      td.style.background=''; td.style.fontWeight='';
      const badge=td.querySelector('.cp-badge'); if(badge)badge.remove();
      tclose();
    });
  }

  /* ── 셀 칠하기(선택 표시) ── */
  function _cpPaint(td, selected, time){
    if(selected){ td.style.background='rgba(236,72,153,0.18)'; td.style.fontWeight='700'; }
    else { td.style.background=''; td.style.fontWeight=''; }
    let badge=td.querySelector('.cp-badge');
    if(selected){
      if(!badge){ badge=document.createElement('div'); badge.className='cp-badge'; badge.style.cssText='font-size:9px;color:#db2777;margin-top:2px;font-weight:700'; td.appendChild(badge); }
      badge.textContent=time?('⏰ '+time):'✓ 선택됨';
    } else if(badge){ badge.remove(); }
  }
  /* ── 원클릭: 나의 수업 선택/해제 (시각은 더블클릭으로 지정) ── */
  function _toggleClassSelect(td){
    const content=td.dataset.cpContent||'';
    if(!content.trim()) return;   /* 빈 칸(수업 없음) 은 선택 불가 */
    const dow=parseInt(td.dataset.cpDow,10), perio=td.dataset.cpPerio;
    const grade=td.dataset.cpGrade||'', dept=td.dataset.cpDept||'', clsv2=td.dataset.cpCls||'';
    const key=[td.dataset.cpDow,perio,grade,dept,clsv2].join('|');
    const existing=getClassPopups().find(function(x){ return classPopupKey(x)===key; });
    if(existing){ removeClassPopupByKey(key); _cpPaint(td,false); }
    else { addClassPopup({ dow:dow, perio:perio, content:content, grade:grade, dept:dept, cls:clsv2, time:'' }); _cpPaint(td,true,''); }
  }
}
