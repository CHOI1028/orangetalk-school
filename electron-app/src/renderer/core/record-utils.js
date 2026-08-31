/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* record-utils.js — 보건일지 레코드 조회·변환 */
import { S } from './app-state.js';
import { getStu } from './student-utils.js';

export function recsByDate(d){ const col=typeof S._dailySortCol!=='undefined'?S._dailySortCol:'timeIn'; const dir=typeof S._dailySortDir!=='undefined'?S._dailySortDir:'desc'; const recs=S.records.filter(function(r){return r.date===d;}); recs.sort(function(a,b){ const sa=getStu(a.personUid||a.studentId), sb=getStu(b.personUid||b.studentId); let va, vb; if(col==='timeIn'){va=a.timeIn||'00:00';vb=b.timeIn||'00:00';} else if(col==='timeOut'){va=a.timeOut||'';vb=b.timeOut||'';} else if(col==='grade'){const ga=sa.type==='staff'?'99-99':((sa.grade||'0')+'-'+(sa.cls||'0'));const gb=sb.type==='staff'?'99-99':((sb.grade||'0')+'-'+(sb.cls||'0'));va=ga.split('-').map(function(x){return /^\d+$/.test(x)?String(parseInt(x)).padStart(3,'0'):x;}).join('-');vb=gb.split('-').map(function(x){return /^\d+$/.test(x)?String(parseInt(x)).padStart(3,'0'):x;}).join('-');} else if(col==='num'){va=sa.type==='staff'?99999:(parseInt(sa.num)||99999);vb=sb.type==='staff'?99999:(parseInt(sb.num)||99999);return dir==='asc'?va-vb:vb-va;} else if(col==='gender'){va=sa.gender||'';vb=sb.gender||'';} else if(col==='care'){const ca=(sa.status==='caution'||sa.status==='watch')&&!!(sa.condition||(sa.careMemo&&sa.careMemo.trim&&sa.careMemo.trim()));const cb=(sb.status==='caution'||sb.status==='watch')&&!!(sb.condition||(sb.careMemo&&sb.careMemo.trim&&sb.careMemo.trim()));va=ca?0:1;vb=cb?0:1;return dir==='asc'?va-vb:vb-va;} else {va=a.timeIn||'00:00';vb=b.timeIn||'00:00';} return dir==='asc'?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va)); }); if(S._lastRegisteredRecId){const idx=recs.findIndex(function(r){return r.id===S._lastRegisteredRecId;});if(idx>0){const item=recs.splice(idx,1)[0];recs.unshift(item);}} return recs; }
export function getRecordDates(){ const s=new Set();S.records.forEach(function(r){s.add(r.date);});return s; }
export function getGrades(){ if(S.settings.schoolLevel==='kindergarten')return[3,4,5,6];if(S.settings.schoolLevel==='middle'||S.settings.schoolLevel==='high')return[1,2,3];return[1,2,3,4,5,6]; }
export function getDeptForSymptom(sym){
  const lines = S.deptMappingText.split('\n');
  for(let i=0;i<lines.length;i++){
    const parts = lines[i].split('→');
    if(parts.length===2 && parts[0].trim()===sym) return parts[1].trim();
  }
  return '';
}
export function getTreatmentsForSymptom(sym){
  const found = S.treatmentMap.find(function(t){return t.symptom===sym;});
  return found ? found.treatments.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
}
export function getMedsForSymptom(sym){
  const found = S.medicationMap.find(function(m){return m.symptom===sym;});
  return found ? found.meds.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
}
/* ── 통계 카운트용 공용 파서 (2026-06-09) ──
 *  합성 처치칩("처치[투약[타이레놀 (1T)], 보건교육, 침상 안정]" 등) 안에 묻힌 투약·침상이
 *  대시보드 카운트(투약 TOP·침상 추이)에 안 잡히던 문제 보완. 옛 기록 + 새 기록 모두 적용.
 *  표시·저장은 전혀 안 바꾸고, '셀 때'만 파싱한다. */
/** 한 기록의 "유효 투약 문자열" — r.medication + 합성칩 안 투약[...] 약명 합산.
 *  (새 기록은 선택 시 투약을 r.medication 으로 이미 빼내므로 합성칩에 투약[...] 이 없어 중복 안 됨) */
export function _statMedicationStr(r){
  const parts=[];
  const base=(typeof r.medication==='string')?r.medication.trim():'';
  if(base)parts.push(base);
  const arr=Array.isArray(r.treatment)?r.treatment:((typeof r.treatment==='string'&&r.treatment)?[r.treatment]:[]);
  const medNames=(typeof window!=='undefined'&&window._statMedNames&&window._statMedNames.size)?window._statMedNames:null;
  arr.forEach(function(chip){
    const s=String(chip||'');
    if(s.indexOf('투약[')!==-1||s.indexOf('투약 [')!==-1){
      /* 마킹된 칩(옵션1·3·5신규) — 투약[…] 안의 약명 모두 (옵션5는 약마다 투약[] 하나씩) */
      const re=/투약\s*\[([^\]]*)\]/g;
      let m;
      while((m=re.exec(s))!==null){
        const inner=m[1];
        let cur='',depth=0;
        /* 추출 약명 끝의 '(용량)'·' N개' 수량 접미 제거 → 약명만 카운트 (키오스크 "투약[루핑점안액 1개]" 도 "루핑점안액" 으로 집계). 2026-06-11 */
        const _clean=function(x){ return String(x||'').trim().replace(/\s*\([^)]*\)\s*$/,'').replace(/\s+\d+\s*개\s*$/,'').trim(); };
        for(let i=0;i<inner.length;i++){
          const c=inner[i];
          if(c==='(')depth++; else if(c===')')depth--;
          if(c===','&&depth===0){ const _n=_clean(cur); if(_n)parts.push(_n); cur=''; }
          else cur+=c;
        }
        { const _n=_clean(cur); if(_n)parts.push(_n); }
      }
    } else if(medNames){
      /* 마킹 없는 옛 합성칩(옵션4/5 옛 데이터) — 항목을 등록 약품명 목록과 대조해 '약'만 추출.
       *  picker 에서 고른 약은 프로그램 약품명 그대로라 정확히 매칭됨. (2026-06-09 소급) */
      _statTokenizeComposite(s).forEach(function(tok){
        const nm=tok.replace(/\s*\([^)]*\)\s*$/,'').trim(); /* 끝 (용량) 제거 */
        if(nm&&medNames.has(nm))parts.push(tok);
      });
    }
  });
  return parts.join(', ');
}
/* 합성칩을 원자 항목으로 분해 — 구조용 [ ] 는 투명(처치명 접두는 버림), () 는 용량 보호, depth0 콤마로 분리. */
function _statTokenizeComposite(s){
  const items=[]; let cur='',pd=0;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='(')pd++;
    else if(c===')')pd--;
    if(c==='['){ cur=''; continue; }   /* 처치명 접두 버림 */
    if(c===']'){ continue; }
    if(c===','&&pd===0){ if(cur.trim())items.push(cur.trim()); cur=''; continue; }
    cur+=c;
  }
  if(cur.trim())items.push(cur.trim());
  return items;
}
/** 한 기록이 '침상' 처치를 포함하는지 — 합성칩 안의 '침상'까지 substring 인식 + 경과관찰(observe). */
export function _statHasBed(r){
  const arr=Array.isArray(r.treatment)?r.treatment:((typeof r.treatment==='string'&&r.treatment)?[r.treatment]:[]);
  if(arr.some(function(t){return String(t).indexOf('침상')!==-1;}))return true;
  return r.result==='observe'||r.result==='경과관찰';
}
export function _recToDbRow(r){
  const dbId=r._dbId||r.id;
  const pUid=r.personUid||r.studentId||null;
  const pType=r.personType||'student';
  /* 바디맵 마커는 window._bmData[recordId] 에 저장 — DB 저장 시 반드시 함께 직렬화 */
  let bm=r.bodymapData;
  if(!bm&&typeof window!=='undefined'&&window._bmData){bm=window._bmData[r.id]||window._bmData[dbId];}
  /* school_year — 방문일자 월(3월 이후=해당 연도, 1-2월=전년도) 기준 또는 현재 학년도 */
  let sy=r.school_year||'';
  if(!sy){
    const d=r.date?new Date(r.date):new Date();
    if(!isNaN(d.getTime())){sy=String(d.getMonth()>=2?d.getFullYear():d.getFullYear()-1);}
    else{const n=new Date();sy=String(n.getMonth()>=2?n.getFullYear():n.getFullYear()-1);}
  }
  /* treatment 평탄 목록 — JSON 배열로 저장 (합성칩 안의 콤마가 split 으로 쪼개지던 버그 방지, 2026-05-28).
   *  옛 데이터(콤마 결합 문자열)는 _toDailyRecord 가 '[' 로 시작하지 않으면 split 으로 폴백 읽기. */
  const tr=Array.isArray(r.treatment)?JSON.stringify(r.treatment):(r.treatment||'');
  /* extra_json — 기존 값을 보존한 채 추가 메타만 갱신 (treatment_memo · meds_by_sym · med_doses_by_sym) */
  let _ej={};
  try { if (typeof r.extra_json==='string') _ej=JSON.parse(r.extra_json)||{}; else if (r.extra_json && typeof r.extra_json==='object') _ej=r.extra_json; } catch(_){ _ej={}; }
  if (typeof r.treatmentMemo==='string') _ej.treatment_memo=r.treatmentMemo;
  /* v3 — 증상별 약품/도즈 매핑은 extra_json 에 저장 (스키마 v3 유지, 옛 코드 호환).
   *  · meds_by_sym = {"증상라벨": ["약명","약명",...], ...}
   *  · med_doses_by_sym = {"증상라벨": {"약명":"도즈"}, ...}
   *  · 빈 객체이거나 없으면 키 자체 제외 (extra_json 크기 최소화). */
  if (r.medsBySym && typeof r.medsBySym==='object' && !Array.isArray(r.medsBySym) && Object.keys(r.medsBySym).length) {
    _ej.meds_by_sym = r.medsBySym;
  } else { delete _ej.meds_by_sym; }
  if (r.medDosesBySym && typeof r.medDosesBySym==='object' && !Array.isArray(r.medDosesBySym) && Object.keys(r.medDosesBySym).length) {
    _ej.med_doses_by_sym = r.medDosesBySym;
  } else { delete _ej.med_doses_by_sym; }
  /* 증상→선택 상분류 매핑 — 같은 증상명이 여러 상분류에 있어도 고른 상분류로 표시·통계 고정 (2026-06-25) */
  if (r.symCatMap && typeof r.symCatMap==='object' && !Array.isArray(r.symCatMap) && Object.keys(r.symCatMap).length) {
    _ej.sym_cat_map = r.symCatMap;
  } else { delete _ej.sym_cat_map; }
  /* 분기/미분기 모드 플래그 (2026-06-09) — boolean 일 때만 저장. 미설정(옛/외부)은 키 제외 → 기존 추론 유지. */
  if (typeof r.treatmentBranched === 'boolean') {
    _ej.treatment_branched = r.treatmentBranched;
  } else { delete _ej.treatment_branched; }
  /* 사용자 보고 2026-05-22 회귀 보강 — 자유 기입 증상의 카테고리 매핑(rec.symFreeTextByCat)이
   *  _recToDbRow 에서 누락되어 DB extra_json 까지 도달하지 못하던 버그 수정.
   *  symptom-view.js 의 모달 저장(_ftSnap) 이후 saveRecordNow → _recToDbRow → extra_json 까지 round-trip 보장. */
  if (r.symFreeTextByCat && typeof r.symFreeTextByCat==='object' && !Array.isArray(r.symFreeTextByCat) && Object.keys(r.symFreeTextByCat).length) {
    _ej.sym_free_text_by_cat = r.symFreeTextByCat;
  } else { delete _ej.sym_free_text_by_cat; }
  /* V/S 시간대별 측정 이력 — extra_json.vs_history 에 저장 (DB 스키마 변경 없음).
   *  형식: [{t:"09:00",temp:"36.5",bp:"120/80",pulse:"72",resp:"18",spo2:"98",bst:""}, ...]
   *  비어 있으면 키 제외 (extra_json 크기 최소화 + 옛 record 와 동일 폴백). */
  if (Array.isArray(r.vsHistory) && r.vsHistory.length) {
    _ej.vs_history = r.vsHistory;
  } else { delete _ej.vs_history; }
  /* 상담록 (2026-06-12) — extra_json.counsel_log 에 저장 (DB 스키마 변경 없음).
   *  형식: {route, content, action, opinion, followUp, topics[]}. 내용이 전부 비면 키 제외. */
  if (r.counselLog && typeof r.counselLog==='object' && !Array.isArray(r.counselLog)
      && Object.keys(r.counselLog).some(function(k){ const v=r.counselLog[k]; return Array.isArray(v)?false:String(v||'').trim(); })) {
    _ej.counsel_log = r.counselLog;
  } else { delete _ej.counsel_log; }
  /* v3 — 증상별 처치 매핑은 DB 의 treatment_by_sym 컬럼에 JSON 으로 저장.
   *  · 빈 객체/없음 → 빈 문자열 (옛 record 와 동일하게 폴백, _toDailyRecord 가 {} 로 복원). */
  const _tbsJson = (r.treatmentBySym && typeof r.treatmentBySym==='object' && !Array.isArray(r.treatmentBySym) && Object.keys(r.treatmentBySym).length)
    ? JSON.stringify(r.treatmentBySym) : '';
  /* v5 — 신체사정: {items:[...], details:{...}} JSON. 선택 항목도 상세도 없으면 빈 문자열(옛 record 와 동일 폴백, _toDailyRecord 가 null 로 복원). */
  const _paJson = (r.physicalAssessment && typeof r.physicalAssessment==='object' && !Array.isArray(r.physicalAssessment) && (
      (Array.isArray(r.physicalAssessment.items) && r.physicalAssessment.items.length) ||
      (r.physicalAssessment.details && typeof r.physicalAssessment.details==='object' && Object.keys(r.physicalAssessment.details).length)
    )) ? JSON.stringify(r.physicalAssessment) : '';
  return {id:dbId,school_year:sy,person_uid:pUid,person_type:pType,
    visit_date:r.date||'',time_in:r.timeIn||'',time_out:r.timeOut||'',
    symptoms:Array.isArray(r.symptoms)?JSON.stringify(r.symptoms):(r.symptoms||'[]'),
    treatment:tr,
    treatment_by_sym:_tbsJson,
    physical_assessment:_paJson,
    medication:r.medication||'',department:r.dept||'',
    body_temp:r.temp||'',blood_pressure:r.bp||'',
    pulse:r.pulse||'',respiration:r.resp||r.respiration||'',spo2:r.spo2||'',bst:r.bst||'',
    result_code:r.result||'',nurse_name:r.nurse||'',nurse_id:r.nurseId||null,
    vip_tags:JSON.stringify(r.vipTags||[]),memo:r.memo||'',
    bed:r.bed||'',
    bodymap_json:JSON.stringify(Array.isArray(bm)?bm:[]),
    extra_json:JSON.stringify(_ej)};
}

/* ── 상담 처치란(counselLog.treatmentText) 공용 헬퍼 (2026-08-25) ──
 *  상담 처치 문구는 flat(rec.treatment)에만 합류하고 treatmentBySym 맵에는 없다.
 *  다중 증상 분층(증상별) 렌더는 맵 기준으로만 그리므로 상담 몫이 화면·출력에서 누락되던 버그의
 *  공용 수정 지점 — 각 분층 렌더가 상담 증상 층에 이 문구를 직접 합류시킨다 (사용자 보고 2026-08-25). */
export function counselTreatText(rec){
  return (rec&&rec.counselLog&&rec.counselLog.treatmentText)?String(rec.counselLog.treatmentText).trim():'';
}
/* 저장 라벨 "상담" / "상담[학업 관련 상담]" / "상담(메모)" 모두 base='상담' */
export function isCounselSymLabel(sym){
  return String(sym||'').split('[')[0].split('(')[0].trim()==='상담';
}

/* ── 인물↔레코드 매칭 공용 헬퍼 (사용자 피드백 2026-08-26: 과거 방문 이력 누락) ──
 *  이력 조회들이 r.studentId===stuId 엄격 비교만 사용해
 *  ① studentId 숫자/문자 타입 혼재 ② personUid 만 같고 studentId 가 다른 레코드
 *  (신학년도 재업로드·명단 재등록 등)가 이력에서 빠졌다.
 *  같은 인물의 uid·구id 를 키 집합으로 만들어 personUid/studentId 어느 쪽이든 O(1) 매칭한다. */
export function stuKeySet(stuIdOrUid){
  const set=new Set();
  if(stuIdOrUid!=null&&stuIdOrUid!=='')set.add(String(stuIdOrUid));
  const s=getStu(stuIdOrUid);
  if(s&&!s._notFound){
    if(s.uid!=null&&s.uid!=='')set.add(String(s.uid));
    if(s.id!=null&&s.id!=='')set.add(String(s.id));
  }
  return set;
}
export function recInStuKeys(r,keySet){
  if(!r||!keySet)return false;
  return (r.studentId!=null&&keySet.has(String(r.studentId)))
      || (r.personUid!=null&&keySet.has(String(r.personUid)));
}
