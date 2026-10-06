/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 보건일지 출력 — 진료과별 통계 표지 (대시보드 진료과별 선택기간 통계와 같은 로직, 별도 모듈) */
'use strict';
import { S } from '../../core/app-state.js';

function _esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function _academicYear(from){
  if(!from)from=new Date().toISOString().slice(0,10);
  const d=new Date(from);
  return d.getMonth()>=2?d.getFullYear():d.getFullYear()-1;
}

/**
 * 진료과별 통계 표지 HTML 생성 (보건일지 출력용)
 * 대시보드 _dashRenderDeptStatsInline 와 같은 데이터 로직을 사용하지만 별도 모듈
 */
export async function buildDeptStatsCover(from,to){
  if(!window.electronAPI||!window.electronAPI.statsDbDeptGrade){
    return _basicFallback(from,to);
  }
  const year=_academicYear(from);
  let cache=null;
  try{
    const res=await window.electronAPI.statsDbDeptGrade(year,from,to);
    if(res&&res.success)cache=res.data;
  }catch(e){console.warn('[diary-print-cover] stats fetch failed:',e);}
  if(!cache)return _basicFallback(from,to);

  const deptCounts=cache.deptCounts||{};
  const gradeByDept=cache.gradeByDept||{};
  const deptKeys=Object.keys(deptCounts);
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  const _isKinder=(S.settings.schoolLevel||'')==='kindergarten';
  const gradeLabel=_isKinder?'세':'학년';
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}

  /* 학년 행 목록 — gradeByDept 키에서 자동 산출
     키 포맷 두 가지: `${level}_${grade}` (예: 중_1, 초_3) 또는 숫자만 (예: '1','2') */
  const _lvOrder={'유':0,'초':1,'중':2,'고':3,'대':4};
  const gKeys=Object.keys(gradeByDept).filter(function(k){return k!=='미상';});
  const _lvSet={};
  const prefixedKeys=[];const plainKeys=[];
  gKeys.forEach(function(k){
    const m=k.match(/^([가-힣A-Za-z]+)_(\d+)$/);
    if(m){_lvSet[m[1]]=true;prefixedKeys.push({key:k,lv:m[1],grade:parseInt(m[2],10)});}
    else if(/^\d+$/.test(k))plainKeys.push({key:k,grade:parseInt(k,10)});
  });
  const multiList=Object.keys(_lvSet).sort(function(a,b){return(_lvOrder[a]!==undefined?_lvOrder[a]:99)-(_lvOrder[b]!==undefined?_lvOrder[b]:99);});
  const rowList=[];
  if(multiList.length>=1){
    /* 학교급 prefix 포맷 — 단일 학교급이어도 모든 학년이 개별 행으로 나와야 함 */
    multiList.forEach(function(lv){
      const grades=prefixedKeys.filter(function(p){return p.lv===lv;}).map(function(p){return p.grade;}).sort(function(a,b){return a-b;});
      grades.forEach(function(g){
        const lbl=(lv==='유')?(lv+g+'세'):(multiList.length>=2?(lv+g+gradeLabel):(g+gradeLabel));
        rowList.push({key:lv+'_'+g,label:lbl});
      });
    });
  } else {
    /* prefix 없는 숫자 키만 — 평이한 학년 표시 */
    const grades=plainKeys.map(function(p){return p.grade;}).sort(function(a,b){return a-b;});
    grades.forEach(function(g){rowList.push({key:String(g),label:g+gradeLabel});});
  }

  /* HTML 빌드 — 대시보드 "방문 통계 > 진료과별 통계" 팝업과 동일한 비주얼 스타일 */
  const cellStyle='border:1px solid var(--bdrl,#e5e7eb);padding:6px 8px;font-size:11pt;text-align:center;color:var(--t1,#1e293b)';
  const headStyle=cellStyle+';background:var(--bg2,#f8fafc);font-weight:700;color:var(--t2,#475569);font-size:11pt;letter-spacing:-0.2px';
  const sectionTitle='font-size:13px;font-weight:800;color:var(--t1,#1e293b);margin:18px 0 8px;display:flex;align-items:center;gap:6px';
  const wrap='border:1px solid var(--bdr,#cbd5e1);border-radius:10px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)';
  let h='<div style="page-break-after:always;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:var(--t1,#1e293b)">';
  /* 제목 박스 */
  h+='<div style="text-align:center;padding:14px 0 4px"><div style="display:inline-flex;align-items:center;gap:8px;font-size:16px;font-weight:800;letter-spacing:-0.3px"><span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:#0891b2;color:#fff;font-size:14px">📋</span>진료과별 선택기간 통계</div></div>';
  h+='<div style="text-align:center;font-size:11px;color:var(--t3,#64748b);margin-bottom:14px">'+_esc(schoolName)+' · '+fmtD(from)+' ~ '+fmtD(to)+'</div>';

  function _sectionBar(label){return '<div style="'+sectionTitle+'"><span style="display:inline-block;width:3px;height:14px;background:#0891b2;border-radius:2px"></span>'+label+'</div>';}

  /* 1) 학생 — 학년별 진료과 통계 */
  h+=_sectionBar('학생 — 학년별 진료과 통계');
  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  h+='<thead><tr><th style="'+headStyle+'">학년</th>';
  deptKeys.forEach(function(dk){h+='<th style="'+headStyle+'">'+_esc(dk)+'</th>';});
  h+='<th style="'+headStyle+';color:#0891b2">계</th></tr></thead><tbody>';
  rowList.forEach(function(row,ri){
    let rowTotal=0;
    const alt=ri%2===1?'background:var(--bg2,#f8fafc);':'';
    h+='<tr style="'+alt+'"><td style="'+cellStyle+';font-weight:700;color:var(--t1,#1e293b);text-align:center">'+_esc(row.label)+'</td>';
    deptKeys.forEach(function(dk){const v=((gradeByDept[row.key]||{})[dk]||{}).total||0;rowTotal+=v;h+='<td style="'+cellStyle+(v>0?'':';color:#cbd5e1')+'">'+v+'</td>';});
    h+='<td style="'+cellStyle+';font-weight:800;color:#0891b2">'+rowTotal+'</td></tr>';
  });
  let stuColSums={};deptKeys.forEach(function(dk){stuColSums[dk]=0;});
  rowList.forEach(function(row){deptKeys.forEach(function(dk){stuColSums[dk]+=((gradeByDept[row.key]||{})[dk]||{}).total||0;});});
  let stuGrand=0;deptKeys.forEach(function(dk){stuGrand+=stuColSums[dk];});
  h+='<tr style="background:rgba(6,182,212,0.06);border-top:2px solid var(--bdr,#cbd5e1)"><td style="'+cellStyle+';font-weight:800;color:#0e7490">학생 소계</td>';
  deptKeys.forEach(function(dk){h+='<td style="'+cellStyle+';font-weight:700;color:#0e7490">'+stuColSums[dk]+'</td>';});
  h+='<td style="'+cellStyle+';font-weight:800;color:#0891b2;font-size:11.5px">'+stuGrand+'</td></tr>';
  h+='</tbody></table></div>';

  /* 2) 교직원 — 진료과 통계 */
  h+=_sectionBar('교직원 — 진료과 통계');
  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  h+='<thead><tr><th style="'+headStyle+'">구분</th>';
  deptKeys.forEach(function(dk){h+='<th style="'+headStyle+'">'+_esc(dk)+'</th>';});
  h+='<th style="'+headStyle+';color:#0891b2">계</th></tr></thead><tbody>';
  let staffGrand=0;
  h+='<tr><td style="'+cellStyle+';font-weight:700">교직원</td>';
  deptKeys.forEach(function(dk){const v=(deptCounts[dk]||{}).staff||0;staffGrand+=v;h+='<td style="'+cellStyle+(v>0?'':';color:#cbd5e1')+'">'+v+'</td>';});
  h+='<td style="'+cellStyle+';font-weight:800;color:#0891b2">'+staffGrand+'</td></tr>';
  h+='</tbody></table></div>';

  /* 3) 전체 — 학생 + 교직원 */
  h+=_sectionBar('전체 — 학생 + 교직원');
  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  h+='<thead><tr><th style="'+headStyle+'">구분</th>';
  deptKeys.forEach(function(dk){h+='<th style="'+headStyle+'">'+_esc(dk)+'</th>';});
  h+='<th style="'+headStyle+';color:#0891b2">계</th></tr></thead><tbody>';
  let allGrand=0;
  h+='<tr style="background:rgba(6,182,212,0.06)"><td style="'+cellStyle+';font-weight:800;color:#0e7490">합계</td>';
  deptKeys.forEach(function(dk){const v=(deptCounts[dk]||{}).total||0;allGrand+=v;h+='<td style="'+cellStyle+';font-weight:700;color:#0e7490">'+v+'</td>';});
  h+='<td style="'+cellStyle+';font-weight:800;color:#0891b2;font-size:11.5px">'+allGrand+'</td></tr>';
  h+='</tbody></table></div>';

  h+='</div>'; /* page-break-after */
  return h;
}

/**
 * 진료과별 통계 payload (xlsxBuildDeptStats / Sheets export 재사용용)
 * 대시보드 "방문 통계 > 진료과별 통계"의 sections 구조를 그대로 반환
 */
export async function buildDeptStatsSections(from,to){
  if(!window.electronAPI||!window.electronAPI.statsDbDeptGrade)return null;
  const year=_academicYear(from);
  let cache=null;
  try{
    const res=await window.electronAPI.statsDbDeptGrade(year,from,to);
    if(res&&res.success)cache=res.data;
  }catch(e){console.warn('[diary-print-cover] stats sections failed:',e);}
  if(!cache)return null;
  const deptCounts=cache.deptCounts||{};
  const gradeByDept=cache.gradeByDept||{};
  const deptKeys=Object.keys(deptCounts);
  const _isKinder=(S.settings.schoolLevel||'')==='kindergarten';
  const gradeLabel=_isKinder?'세':'학년';
  const _lvOrder={'유':0,'초':1,'중':2,'고':3,'대':4};
  const gKeys=Object.keys(gradeByDept).filter(function(k){return k!=='미상';});
  const _lvSet2={};
  const prefixedKeys2=[];const plainKeys2=[];
  gKeys.forEach(function(k){
    const m=k.match(/^([가-힣A-Za-z]+)_(\d+)$/);
    if(m){_lvSet2[m[1]]=true;prefixedKeys2.push({key:k,lv:m[1],grade:parseInt(m[2],10)});}
    else if(/^\d+$/.test(k))plainKeys2.push({key:k,grade:parseInt(k,10)});
  });
  const multiList=Object.keys(_lvSet2).sort(function(a,b){return(_lvOrder[a]!==undefined?_lvOrder[a]:99)-(_lvOrder[b]!==undefined?_lvOrder[b]:99);});
  const rowList=[];
  if(multiList.length>=1){
    multiList.forEach(function(lv){
      const grades=prefixedKeys2.filter(function(p){return p.lv===lv;}).map(function(p){return p.grade;}).sort(function(a,b){return a-b;});
      grades.forEach(function(g){
        const lbl=(lv==='유')?(lv+g+'세'):(multiList.length>=2?(lv+g+gradeLabel):(g+gradeLabel));
        rowList.push({key:lv+'_'+g,label:lbl});
      });
    });
  } else {
    const grades=plainKeys2.map(function(p){return p.grade;}).sort(function(a,b){return a-b;});
    grades.forEach(function(g){rowList.push({key:String(g),label:g+gradeLabel});});
  }
  /* Section 1: 학생 — 학년별 진료과 */
  const stuHeader=['학년'].concat(deptKeys).concat(['계']);
  const stuRows=[];
  const stuColSums={};deptKeys.forEach(function(dk){stuColSums[dk]=0;});
  rowList.forEach(function(row){
    const r=[row.label];
    let t=0;
    deptKeys.forEach(function(dk){const v=((gradeByDept[row.key]||{})[dk]||{}).total||0;r.push(v);t+=v;stuColSums[dk]+=v;});
    r.push(t);
    stuRows.push(r);
  });
  const stuTotalsRow=['학생 소계'];
  let stuGrand=0;
  deptKeys.forEach(function(dk){stuTotalsRow.push(stuColSums[dk]);stuGrand+=stuColSums[dk];});
  stuTotalsRow.push(stuGrand);
  /* Section 2: 교직원 */
  const staffHeader=['구분'].concat(deptKeys).concat(['계']);
  let staffGrand=0;
  const staffRow=['교직원'];
  deptKeys.forEach(function(dk){const v=(deptCounts[dk]||{}).staff||0;staffRow.push(v);staffGrand+=v;});
  staffRow.push(staffGrand);
  /* Section 3: 전체 */
  const allHeader=['구분'].concat(deptKeys).concat(['계']);
  let allGrand=0;
  const allRow=['합계'];
  deptKeys.forEach(function(dk){const v=(deptCounts[dk]||{}).total||0;allRow.push(v);allGrand+=v;});
  allRow.push(allGrand);
  return {
    sections:[
      {title:'학생 — 학년별 진료과 통계',header:stuHeader,rows:stuRows,totalsRow:stuTotalsRow},
      {title:'교직원 — 진료과 통계',header:staffHeader,rows:[staffRow]},
      {title:'전체 — 학생 + 교직원',header:allHeader,rows:[allRow]}
    ],
    deptKeys:deptKeys,
    colCount:deptKeys.length+2 /* 학년/구분 + depts + 계 */
  };
}

/* 백엔드 IPC 사용 불가 시 — 간단한 폴백 (deptMap만) */
function _basicFallback(from,to){
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  let h='<div style="page-break-after:always;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000">';
  h+='<div style="text-align:center;font-size:18px;font-weight:800;margin-bottom:6px">진료과별 선택기간 통계</div>';
  h+='<div style="text-align:center;font-size:11px;color:#444">'+_esc(schoolName)+' · '+fmtD(from)+' ~ '+fmtD(to)+'</div>';
  h+='<div style="text-align:center;color:#888;font-size:11px;padding:30px 0">통계 서비스 연결 실패 — 데이터를 불러올 수 없습니다.</div>';
  h+='</div>';
  return h;
}

/**
 * 상담 주제(중분류)별 통계 표지 HTML 생성 (보건일지 출력용, 사용자 요청 2026-06-25)
 * 진료과 표지(buildDeptStatsCover)와 같은 구조 — 진료과 열 대신 상담 주제 열, 보라 톤.
 */
export async function buildCounselStatsCover(from,to){
  if(!window.electronAPI||!window.electronAPI.statsDbCounsel){
    return _counselFallback(from,to);
  }
  const year=_academicYear(from);
  let data=null;
  try{
    const res=await window.electronAPI.statsDbCounsel(year,from,to);
    if(res&&res.success)data=res.data;
  }catch(e){console.warn('[diary-print-cover] counsel stats fetch failed:',e);}
  if(!data)return _counselFallback(from,to);

  const topicCounts=data.topicCounts||{};
  const gradeByTopic=data.gradeByTopic||{};
  const tKeys=(data.topicKeys&&data.topicKeys.length)?data.topicKeys.slice():Object.keys(topicCounts);
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  const _isKinder=(S.settings.schoolLevel||'')==='kindergarten';
  const gradeLabel=_isKinder?'세':'학년';
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}

  /* 학년 행 목록 — gradeByTopic 키에서 자동 산출 (진료과 표지와 동일 로직) */
  const _lvOrder={'유':0,'초':1,'중':2,'고':3,'대':4};
  const gKeys=Object.keys(gradeByTopic).filter(function(k){return k!=='미상';});
  const _lvSet={};const prefixedKeys=[];const plainKeys=[];
  gKeys.forEach(function(k){
    const m=k.match(/^([가-힣A-Za-z]+)_(\d+)$/);
    if(m){_lvSet[m[1]]=true;prefixedKeys.push({key:k,lv:m[1],grade:parseInt(m[2],10)});}
    else if(/^\d+$/.test(k))plainKeys.push({key:k,grade:parseInt(k,10)});
  });
  const multiList=Object.keys(_lvSet).sort(function(a,b){return(_lvOrder[a]!==undefined?_lvOrder[a]:99)-(_lvOrder[b]!==undefined?_lvOrder[b]:99);});
  const rowList=[];
  if(multiList.length>=1){
    multiList.forEach(function(lv){
      const grades=prefixedKeys.filter(function(p){return p.lv===lv;}).map(function(p){return p.grade;}).sort(function(a,b){return a-b;});
      grades.forEach(function(g){
        const lbl=(lv==='유')?(lv+g+'세'):(multiList.length>=2?(lv+g+gradeLabel):(g+gradeLabel));
        rowList.push({key:lv+'_'+g,label:lbl});
      });
    });
  } else {
    const grades=plainKeys.map(function(p){return p.grade;}).sort(function(a,b){return a-b;});
    grades.forEach(function(g){rowList.push({key:String(g),label:g+gradeLabel});});
  }

  const cellStyle='border:1px solid var(--bdrl,#e5e7eb);padding:6px 7px;font-size:10pt;text-align:center;color:var(--t1,#1e293b)';
  const headStyle=cellStyle+';background:var(--bg2,#f8fafc);font-weight:700;color:var(--t2,#475569);letter-spacing:-0.2px';
  const sectionTitle='font-size:13px;font-weight:800;color:var(--t1,#1e293b);margin:18px 0 8px;display:flex;align-items:center;gap:6px';
  const wrap='border:1px solid var(--bdr,#cbd5e1);border-radius:10px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)';
  function _sectionBar(label){return '<div style="'+sectionTitle+'"><span style="display:inline-block;width:3px;height:14px;background:#a855f7;border-radius:2px"></span>'+label+'</div>';}

  let h='<div style="page-break-after:always;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:var(--t1,#1e293b)">';
  h+='<div style="text-align:center;padding:14px 0 4px"><div style="display:inline-flex;align-items:center;gap:8px;font-size:16px;font-weight:800;letter-spacing:-0.3px"><span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:#a855f7;color:#fff;font-size:14px">💬</span>상담 주제별 선택기간 통계</div></div>';
  h+='<div style="text-align:center;font-size:11px;color:var(--t3,#64748b);margin-bottom:14px">'+_esc(schoolName)+' · '+fmtD(from)+' ~ '+fmtD(to)+'</div>';

  if(!(data.recordTotal>0)){
    h+='<div style="text-align:center;color:#94a3b8;font-size:12px;padding:22px 0;border:1px dashed var(--bdr,#cbd5e1);border-radius:10px;margin-bottom:14px">선택한 기간에 기록된 상담 내역이 없습니다.</div>';
  }

  /* 1) 학생 — 학년별 상담 주제 통계 */
  h+=_sectionBar('학생 — 학년별 상담 주제 통계');
  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  h+='<thead><tr><th style="'+headStyle+'">'+gradeLabel+'</th>';
  tKeys.forEach(function(tk){h+='<th style="'+headStyle+'">'+_esc(tk)+'</th>';});
  h+='<th style="'+headStyle+';color:#8b5cf6">계</th></tr></thead><tbody>';
  rowList.forEach(function(row,ri){
    let rowTotal=0;
    const alt=ri%2===1?'background:var(--bg2,#f8fafc);':'';
    h+='<tr style="'+alt+'"><td style="'+cellStyle+';font-weight:700;text-align:center">'+_esc(row.label)+'</td>';
    tKeys.forEach(function(tk){const v=((gradeByTopic[row.key]||{})[tk]||{}).total||0;rowTotal+=v;h+='<td style="'+cellStyle+(v>0?'':';color:#cbd5e1')+'">'+v+'</td>';});
    h+='<td style="'+cellStyle+';font-weight:800;color:#8b5cf6">'+rowTotal+'</td></tr>';
  });
  const stuColSums={};tKeys.forEach(function(tk){stuColSums[tk]=0;});
  rowList.forEach(function(row){tKeys.forEach(function(tk){stuColSums[tk]+=((gradeByTopic[row.key]||{})[tk]||{}).total||0;});});
  let stuGrand=0;tKeys.forEach(function(tk){stuGrand+=stuColSums[tk];});
  h+='<tr style="background:rgba(168,85,247,0.06);border-top:2px solid var(--bdr,#cbd5e1)"><td style="'+cellStyle+';font-weight:800;color:#7c3aed">학생 소계</td>';
  tKeys.forEach(function(tk){h+='<td style="'+cellStyle+';font-weight:700;color:#7c3aed">'+stuColSums[tk]+'</td>';});
  h+='<td style="'+cellStyle+';font-weight:800;color:#8b5cf6;font-size:11pt">'+stuGrand+'</td></tr>';
  h+='</tbody></table></div>';

  /* 2) 교직원 — 상담 주제 통계 */
  h+=_sectionBar('교직원 — 상담 주제 통계');
  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  h+='<thead><tr><th style="'+headStyle+'">구분</th>';
  tKeys.forEach(function(tk){h+='<th style="'+headStyle+'">'+_esc(tk)+'</th>';});
  h+='<th style="'+headStyle+';color:#8b5cf6">계</th></tr></thead><tbody>';
  let staffGrand=0;
  h+='<tr><td style="'+cellStyle+';font-weight:700">교직원</td>';
  tKeys.forEach(function(tk){const v=(topicCounts[tk]||{}).staff||0;staffGrand+=v;h+='<td style="'+cellStyle+(v>0?'':';color:#cbd5e1')+'">'+v+'</td>';});
  h+='<td style="'+cellStyle+';font-weight:800;color:#8b5cf6">'+staffGrand+'</td></tr>';
  h+='</tbody></table></div>';

  /* 3) 전체 — 학생 + 교직원 */
  h+=_sectionBar('전체 — 학생 + 교직원');
  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  h+='<thead><tr><th style="'+headStyle+'">구분</th>';
  tKeys.forEach(function(tk){h+='<th style="'+headStyle+'">'+_esc(tk)+'</th>';});
  h+='<th style="'+headStyle+';color:#8b5cf6">계</th></tr></thead><tbody>';
  let allGrand=0;
  h+='<tr style="background:rgba(168,85,247,0.06)"><td style="'+cellStyle+';font-weight:800;color:#7c3aed">합계</td>';
  tKeys.forEach(function(tk){const v=(topicCounts[tk]||{}).total||0;allGrand+=v;h+='<td style="'+cellStyle+';font-weight:700;color:#7c3aed">'+v+'</td>';});
  h+='<td style="'+cellStyle+';font-weight:800;color:#8b5cf6;font-size:11pt">'+allGrand+'</td></tr>';
  h+='</tbody></table></div>';

  h+='</div>'; /* page-break-after */
  return h;
}

/* 상담 표지 — 백엔드 IPC 사용 불가 시 폴백 */
function _counselFallback(from,to){
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}
  let h='<div style="page-break-after:always;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000">';
  h+='<div style="text-align:center;font-size:18px;font-weight:800;margin-bottom:6px">상담 주제별 선택기간 통계</div>';
  h+='<div style="text-align:center;font-size:11px;color:#444">'+_esc(schoolName)+' · '+fmtD(from)+' ~ '+fmtD(to)+'</div>';
  h+='<div style="text-align:center;color:#888;font-size:11px;padding:30px 0">통계 서비스 연결 실패 — 데이터를 불러올 수 없습니다.</div>';
  h+='</div>';
  return h;
}

/**
 * 상담 주제별 세로 요약표 (개별 양식 — 세로 A4 첫 페이지용, 사용자 요청 2026-06-25)
 * 주제를 행으로 (성·건강·학업…) × [학생·교직원·계] 열 + 합계행. 학년 세분 없음.
 */
export async function buildCounselSummaryVertical(from,to){
  if(!window.electronAPI||!window.electronAPI.statsDbCounsel)return _counselFallback(from,to);
  const year=_academicYear(from);
  let data=null;
  try{
    const res=await window.electronAPI.statsDbCounsel(year,from,to);
    if(res&&res.success)data=res.data;
  }catch(e){console.warn('[diary-print-cover] counsel summary fetch failed:',e);}
  if(!data)return _counselFallback(from,to);

  const topicCounts=data.topicCounts||{};
  const tKeys=(data.topicKeys&&data.topicKeys.length)?data.topicKeys.slice():Object.keys(topicCounts);
  const schoolName=(S.settings&&S.settings.schoolName)||'';
  function fmtD(ds){if(!ds)return '';const d=new Date(ds);const dow=['일','월','화','수','목','금','토'][d.getDay()];return d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'.('+dow+')';}

  const cellStyle='border:1px solid var(--bdrl,#e5e7eb);padding:7px 10px;font-size:11pt;color:var(--t1,#1e293b)';
  const headStyle=cellStyle+';background:var(--bg2,#f8fafc);font-weight:700;color:var(--t2,#475569);text-align:center';
  const numStyle=cellStyle+';text-align:center';
  const wrap='border:1px solid var(--bdr,#cbd5e1);border-radius:10px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.03)';

  let h='<div style="page-break-after:always;max-width:600px;margin:0 auto;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:var(--t1,#1e293b)">';
  /* 제목 — 보건일지/상담기록지와 동일한 위아래 색상바 (위:파랑70%+금30% / 아래:초록30%+빨강70%), 이모티콘 제거 (사용자 요청 2026-06-25) */
  h+='<div style="max-width:440px;margin:14px auto 4px">'
    +'<div style="display:flex;height:6px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact"><span style="flex:7;background:#2855A0"></span><span style="flex:3;background:#D4A843"></span></div>'
    +'<div style="text-align:center;font-size:18px;font-weight:800;letter-spacing:4px;padding:9px 0;background:#F7F7F7;-webkit-print-color-adjust:exact;print-color-adjust:exact">상담 주제별 통계</div>'
    +'<div style="display:flex;height:6px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact"><span style="flex:3;background:#2E8B57"></span><span style="flex:7;background:#C0392B"></span></div>'
    +'</div>';
  h+='<div style="text-align:center;font-size:11px;color:var(--t3,#64748b);margin-bottom:16px">'+_esc(schoolName)+' · '+fmtD(from)+' ~ '+fmtD(to)+'</div>';

  if(!(data.recordTotal>0)){
    h+='<div style="text-align:center;color:#94a3b8;font-size:12px;padding:22px 0;border:1px dashed var(--bdr,#cbd5e1);border-radius:10px">선택한 기간에 기록된 상담 내역이 없습니다.</div>';
  }

  h+='<div style="'+wrap+'"><table style="width:100%;border-collapse:collapse">';
  /* 교직원 열 제외 — 학생 상담 건수만 (사용자 요청 2026-06-25) */
  h+='<thead><tr><th style="'+headStyle+';text-align:left">상담 주제</th><th style="'+headStyle+';color:#8b5cf6">상담 건수</th></tr></thead><tbody>';
  let sStu=0;
  tKeys.forEach(function(tk,ri){
    const c=topicCounts[tk]||{student:0};
    const _st=c.student||0;
    sStu+=_st;
    const alt=ri%2===1?'background:var(--bg2,#f8fafc);':'';
    h+='<tr style="'+alt+'"><td style="'+cellStyle+';font-weight:600">'+_esc(tk)+'</td>'
      +'<td style="'+numStyle+(_st?';font-weight:800;color:#8b5cf6':';color:#cbd5e1')+'">'+_st+'</td></tr>';
  });
  h+='<tr style="background:rgba(168,85,247,0.06);border-top:2px solid var(--bdr,#cbd5e1)"><td style="'+cellStyle+';font-weight:800;color:#7c3aed">합계</td>'
    +'<td style="'+numStyle+';font-weight:800;color:#8b5cf6;font-size:11.5pt">'+sStu+'</td></tr>';
  h+='</tbody></table></div>';
  h+='</div>';
  return h;
}
