/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* format-utils.js — 순수 포맷/변환 유틸리티 (DOM·상태 무관) */
import { S, dayNames, symptomTagClass, resultLabels, ensureHolidayYear } from './app-state.js';

export function escHtml(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
export function escJs(v){return String(v==null?'':v).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
export function toDateStr(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export function dateObj(s){ const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]); }
export function getDow(s){ return dayNames[dateObj(s).getDay()]; }
export function isHoliday(ds){
  /* 표시 대상 연도가 캐시에 없으면 그 연도를 API 로 lazy fetch (가드 내장 — 캐시/진행중/키없음이면 즉시 무시).
     모든 달력이 이 함수를 거치므로, 어느 연도로 이동하든 해당 연도 공휴일이 자동으로 채워진다. */
  if(typeof ds==='string' && ds.length>=4){ try{ ensureHolidayYear(ds.slice(0,4)); }catch(_){} }
  if(ds.endsWith('-05-01'))return false; return !!S.koreanHolidays[ds];
}
export function isWeekend(ds){ const d=dateObj(ds).getDay();return d===0||d===6; }
export function getSymClass(s){ return symptomTagClass[s]||'tag-default'; }
export function getResultClass(r){ return 'result-'+r; }
export function getResultLabel(r){ return resultLabels[r]||r; }

/* ── 학기 정보 ──
   사용자가 설정의 "학기 정보" 아코디언에서 1학기 시작일·2학기 시작일을 지정하면
   ec_semester_info localStorage 에 저장되고, 없으면 전통적 기본값(3/1, 9/1) 사용.
   1학기 종료일 = 2학기 시작일 - 1일 (여름방학을 1학기에 포함시키는 해석).
   2학기 종료일 = 학년도 다음 해의 2월 말일 (윤년 자동 반영). */
export function getSemesterInfo(academicYear){
  if(academicYear==null){
    const now=new Date();
    academicYear=now.getMonth()>=2?now.getFullYear():now.getFullYear()-1;
  }
  /* ★ 단일 출처 — 대시보드/설정의 학기·학년도 4일자(ec_settings.semesterInfo)를 우선 사용.
   *  4일자(시작·종료)가 모두 있고 해당 학년도와 일치하면 그대로 반환 → 보건일지·방문통계·진행률이 같은 값 공유. (사용자 지시 2026-06-16) */
  try{
    const _st=JSON.parse(localStorage.getItem('ec_settings')||'{}');
    const si=_st&&_st.semesterInfo;
    if(si&&si.sem1Start&&si.sem1End&&si.sem2Start&&si.sem2End
       && parseInt(String(si.sem1Start).slice(0,4),10)===academicYear){
      return { academicYear: academicYear, s1Start: si.sem1Start, s1End: si.sem1End, s2Start: si.sem2Start, s2End: si.sem2End };
    }
  }catch(e){}
  let s1Start='', s2Start='';
  try{
    const raw=JSON.parse(localStorage.getItem('ec_semester_info')||'{}');
    if(raw&&typeof raw==='object'){
      s1Start=raw.s1Start||'';
      s2Start=raw.s2Start||'';
    }
  }catch(e){}
  /* 기본값: 1학기 3/1, 2학기 9/1 (1학기 마지막날=8/31) */
  if(!s1Start)s1Start=academicYear+'-03-01';
  if(!s2Start)s2Start=academicYear+'-09-01';
  /* 2학기 시작일 전날 = 1학기 종료일 */
  function _ymdSub1(ymd){
    const p=ymd.split('-');
    const d=new Date(+p[0],+p[1]-1,+p[2]);
    d.setDate(d.getDate()-1);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  const s1End=_ymdSub1(s2Start);
  /* 2학기 종료일 = 다음해 2월 말일 (윤년이면 29, 아니면 28) */
  const nextYr=academicYear+1;
  const isLeap=(nextYr%4===0&&nextYr%100!==0)||nextYr%400===0;
  const s2End=nextYr+'-02-'+(isLeap?'29':'28');
  return { academicYear: academicYear, s1Start: s1Start, s1End: s1End, s2Start: s2Start, s2End: s2End };
}
/* 현재(또는 주어진) 날짜가 속한 학기 정보 반환 */
