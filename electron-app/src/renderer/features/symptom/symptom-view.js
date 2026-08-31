/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { getStu, escHtml, escJs, getGuardianContact, getStudentBirth, getDeptForSymptom, saveData, saveRecordNow, closeModalGracefully, getLevelShort, hasMultipleSchoolLevels, isHoliday, toDateStr, stuKeySet, recInStuKeys } from '../../core/helpers.js';
import { openA4PrintDialog, saveA4Pdf } from '../../core/a4-print-dialog.js';
/* visit-pass-view 는 visit-pass-editor → symptom-view 의 circular dependency 가 있어
 * 물품 대여(rental-ledger)와 동일하게 dynamic import 로 우회 (커스텀 양식 칩 2026-06-12). */
import { bus } from '../../core/event-bus.js';
import { renderSettingsPanel, openSettings, switchSettingsCat, openAccordion } from '../settings/settings-view.js';
import { matchKorean, matchKoreanFromStart } from '../daily/daily-autocomplete.js';
import { openVitalsEdit, openMemoPanel, showVisitHistory as _dvShowVisitHistory, _hideVisitHistory as _dvHideVisitHistory } from '../daily/daily-view.js';
import { openTimePicker } from '../daily/diary-print-view.js';
import { dailyColEyeIcon, openBodyMap, showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { S, monthNames, ensureHolidayYear } from '../../core/app-state.js';
import { openBedManager, releaseBedByStudentId } from '../newsletter/bed-management-view.js';
import { appConfirmModal } from '../../core/ui-utils.js';
import { openEmsMsg } from '../kiosk/ems-popup-view.js';
import { acquireEditLock, releaseEditLock, checkEditLock, showEditLockWarning } from '../../core/collab-edit-lock.js';
/* rental-ledger-view 는 symptom-view 에서 _makeDraggable, _symPrompt 를 import 하므로 circular dependency.
 *  ESM 의 module 평가 순서에 따라 함수 binding 이 undefined 가 될 수 있어 dynamic import 로 우회.
 *  rental count 조회는 localStorage 직접 읽는 한 줄짜리라 inline 구현. */

/* ═══════════════════════════════════════
   CELL EDIT WITH AUTOCOMPLETE (#26-30)
   ═══════════════════════════════════════ */
let activeCellPopup=null;
function closeCellPopup(){if(activeCellPopup){activeCellPopup.remove();activeCellPopup=null;}}

export function getCandidates(field){
  if(field==='symptoms') return [...new Set(S.treatmentMap.map(t=>t.symptom).concat(Object.keys(symptomTagClass)))];
  if(field==='dept') return [...new Set(S.deptMappingText.split('\n').flatMap(l=>{const p=l.split('→');return p.length===2?p[1].split(',').map(s=>s.trim()):[];}))];
  if(field==='treatment') return [...new Set(S.treatmentMap.flatMap(t=>t.treatments.split(',').map(s=>s.trim()).filter(Boolean)))];
  if(field==='medication') return [...new Set(S.medicationMap.flatMap(m=>m.meds.split(',').map(s=>s.trim()).filter(Boolean)))];
  return [];
}

export function removeChip(recId,field,val){
  const r=S.records.find(function(x){return x.id===recId;});if(!r)return;
  if(field==='symptoms'){
    r.symptoms=r.symptoms.filter(function(s){return s!==val;});
    /* 증상 모두 삭제 시 전부 초기화, 아니면 해당 증상의 처치만 스마트 삭제 */
    if(r.symptoms.length===0){r.treatment=[];r.medication='';r.dept='';}
    else{
      /* 삭제된 증상의 자주 쓰는 처치 목록 */
      const removedTreats=_symTreatMap[val]||[];
      /* 남은 증상들이 여전히 필요로 하는 처치 집합 */
      const keepSet={};
      r.symptoms.forEach(function(s){const ts=_symTreatMap[s]||[];ts.forEach(function(t){keepSet[t]=true;});});
      /* 삭제된 증상 전용 처치만 제거 (남은 증상이 공유하는 처치는 유지) */
      r.treatment=r.treatment.filter(function(t){
        if(removedTreats.indexOf(t)===-1)return true; /* 삭제된 증상과 무관한 처치 → 유지 */
        return keepSet[t]; /* 남은 증상이 필요로 하면 유지, 아니면 제거 */
      });
      /* 투약 처치가 제거되면 투약 정보도 제거 */
      if(r.treatment.indexOf('투약')===-1 && !r.treatment.some(function(t){return t.indexOf('투약(')===0||t.indexOf('투약[')===0;})){
        r.medication='';
      }
      /* 진료과 재설정: 남은 첫 증상 기준 */
      if(typeof S.deptMappingText!=='undefined'){
        const newDepts=[];
        r.symptoms.forEach(function(s){
          const d=S.deptMappingText[s];
          if(d && newDepts.indexOf(d)===-1) newDepts.push(d);
        });
        r.dept=newDepts.join(', ');
      }
    }
  }
  else if(field==='dept'){const depts=r.dept.split(', ').filter(function(d){return d!==val;});r.dept=depts.join(', ');}
  else if(field==='treatment'){
    r.treatment=r.treatment.filter(function(t){return t!==val;});
    /* 침상 이용 칩 삭제 시: 해당 학생 퇴실 처리 + 침상 사용 카운트 해제 */
    if(val==='침상 이용'||val==='침상 안정'){
      try{releaseBedByStudentId(r.studentId);}catch(e){console.error('[chip] bed release failed',e);}
    }
  }
  else if(field==='medication'){const meds=r.medication.split(', ').filter(function(m){return m!==val;});r.medication=meds.join(', ');}
  r._dirty=true;saveRecordNow(r);bus.emit('render:daily');
}
/* ═══ 처치 이름 커스텀 (rename) ═══
 *  · '자주 쓰는 처치' 의 칩 표시명을 사용자가 펜으로 변경. 내부 데이터·기능 무변경.
 *  · 저장: localStorage('ec_treat_renames') = {원본명: 변경명}.
 *  · 적용: _treatDisplayName(원본명) → 변경명 or 원본명. */
function _treatRenames(){
  try{ return JSON.parse(localStorage.getItem('ec_treat_renames')||'{}')||{}; }
  catch(_){ return {}; }
}
function _treatSaveRenames(map){
  try{ localStorage.setItem('ec_treat_renames', JSON.stringify(map||{})); }catch(_){}
}
function _treatDisplayName(name){
  if(!name) return name;
  const m=_treatRenames();
  return (m && m[name]) ? m[name] : name;
}
/* 펜 클릭 → 칩 라벨을 인라인 input 으로 전환 (Electron 은 window.prompt 가 비활성 처리됨).
 *   · Enter / blur → 저장
 *   · Esc → 취소 (원래 라벨 복귀)
 *   · 빈 값 또는 원본명과 동일 → rename 제거 (기본 이름으로 복귀)
 *   · 그 외 → ec_treat_renames 에 저장 + 패널 재렌더 */
function _symPromptRenameTreat(original, recId){
  if(!original) return;
  /* 칩 자체 찾기 — data-action 이 toggleTreat/bedRest/openVs 중 하나이면서 data-treat===original 인 sym-fav-chip */
  const chip = document.querySelector('.sym-fav-chip[data-treat="'+original.replace(/"/g,'\\"')+'"]');
  if(!chip) return;
  if(chip.querySelector('.sym-chip-rename-input')) return; /* 이미 편집 중 */
  const map=_treatRenames();
  const cur=map[original]||original;
  /* 칩 안의 기존 내용 백업 후 input 만 남기기. ✕ 버튼은 보존하지 않음 — 짧은 편집 시간이라 단순화. */
  const _saved=chip.innerHTML;
  const inp=document.createElement('input');
  inp.type='text';
  inp.className='sym-chip-rename-input';
  inp.value=cur;
  inp.style.cssText='border:none;outline:none;background:transparent;color:inherit;font:inherit;width:'+Math.max(80,(cur.length*10+20))+'px;text-align:center';
  chip.innerHTML='';
  chip.appendChild(inp);
  inp.focus();
  inp.select();
  let _done=false;
  function commit(cancel){
    if(_done) return;
    _done=true;
    if(!cancel){
      const next=(inp.value||'').trim();
      const m2=_treatRenames();
      if(!next || next===original) delete m2[original];
      else m2[original]=next;
      _treatSaveRenames(m2);
    }
    /* 패널 재렌더로 정상 상태 복귀 (취소·저장 어느 경우든 다시 그려야 _saved 잔존 노이즈 없음) */
    if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
  }
  inp.addEventListener('keydown',function(e){
    e.stopPropagation();
    if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }
    else if(e.key==='Escape'){ e.preventDefault(); commit(true); }
  });
  inp.addEventListener('blur',function(){ commit(false); });
  /* input 클릭이 칩의 toggle 액션을 트리거하지 않도록 차단 */
  inp.addEventListener('mousedown',function(e){ e.stopPropagation(); });
  inp.addEventListener('click',function(e){ e.stopPropagation(); });
}

/* ═══ 증상 카테고리 시스템 ═══ */
/* ═══════════════════════════════════════
 * 의료 데이터: JSON 파일에서 로드 (medical-data.json)
 * 증상 카테고리, 처치 목록, 약품 DB, 매핑 정보
 * ═══════════════════════════════════════ */
let _symCategories=[];
let _symTreatments=['침상 이용'];
let _medDb={};
let _medSymMap={};
let _medFrequent={};
let _symTreatMap={};
let _medCatNames={};
if(typeof window.electronAPI!=='undefined'&&window.electronAPI.readFile){
  window.electronAPI.readFile('__app__/templates/medical-data.json').then(function(res){
    if(!res||!res.success||!res.data)return;
    try{
      const d=JSON.parse(res.data);
      if(d.symptomCategories)_symCategories=d.symptomCategories;
      if(d.treatmentList){
        _symTreatments=d.treatmentList.filter(function(t){return t!=='침상 안정';});
        if(_symTreatments.indexOf('침상 이용')===-1)_symTreatments.push('침상 이용');
      }
      if(d.medicationDB){_medDb=d.medicationDB; try{_symBuildStatMedNames();}catch(_){}}
      if(d.symptomToMedCategory)_medSymMap=d.symptomToMedCategory;
      if(d.symptomToFrequentMeds)_medFrequent=d.symptomToFrequentMeds;
      if(d.symptomToTreatments){
        _symTreatMap=d.symptomToTreatments;
        Object.keys(_symTreatMap).forEach(function(k){
          _symTreatMap[k]=_symTreatMap[k].map(function(t){return t==='침상 안정'?'침상 이용':t;}).filter(function(t,i,a){return a.indexOf(t)===i;});
          if(_symTreatMap[k].indexOf('경과 관찰')===-1)_symTreatMap[k].push('경과 관찰');
          if(_symTreatMap[k].indexOf('투약')===-1)_symTreatMap[k].push('투약');
        });
      }
      if(d.medCategoryNames)_medCatNames=d.medCategoryNames;
    }catch(e){console.error('[MED] JSON parse error:',e);}
  }).catch(function(err){console.error('[MED] load failed:',err);});
}
/* ── 종합 약품 데이터베이스 (사용자 추가 약품) ── */
/* 사용자 추가 약품 (localStorage 유지, 카테고리별) */
S._medDbUser=JSON.parse(localStorage.getItem('ec_meddb_user')||'null')||{};
function _medDbSaveUser(){
  localStorage.setItem('ec_meddb_user',JSON.stringify(S._medDbUser));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','meddb_user',S._medDbUser);
}
function _medDbGetAll(cat){return (_medDb[cat]||[]).concat(S._medDbUser[cat]||[]);}
/* 통계 카운트용 — 등록된 모든 약품명 집합을 window._statMedNames 에 노출 (2026-06-09).
 *  옛 옵션4/5 합성칩에 마킹 없이 묻힌 약(picker에서 고른 실제 약품명)을 대시보드 카운트가 대조해 잡도록.
 *  _medDb(번들) + S._medDbUser(사용자 추가) 의 모든 분류 약명을 평탄화. */
function _symBuildStatMedNames(){
  try{
    const set=new Set();
    const addByCat=function(obj){ if(!obj||typeof obj!=='object')return; Object.keys(obj).forEach(function(c){ const a=obj[c]; if(Array.isArray(a))a.forEach(function(m){ const nm=String(m||'').trim(); if(nm)set.add(nm); }); }); };
    addByCat(_medDb);                                                              /* 번들 약품 DB */
    try{ addByCat(S._medDbUser); }catch(_){}                                       /* ec_meddb_user (메모리, 분류별 사용자 약품) */
    try{ addByCat(JSON.parse(localStorage.getItem('ec_meddb_user')||'{}')); }catch(_){} /* 부팅 시 메모리 로드 전 대비 — localStorage 직접 */
    try{ addByCat(JSON.parse(localStorage.getItem('ec_user_added_meds')||'{}')); }catch(_){} /* 설정→약품관리 추가분(분류별) */
    /* ec_user_med_syms = {약명:[증상들]} — 키가 약명. 설정 투약 리스트 관리 등록분 (picker 3411행과 동일 소스). */
    try{ const ums=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}'); if(ums&&typeof ums==='object')Object.keys(ums).forEach(function(m){ const nm=String(m||'').trim(); if(nm)set.add(nm); }); }catch(_){}
    if(typeof window!=='undefined') window._statMedNames=set;
  }catch(_){}
}
/* medical-data.json 의 medicationDB 가 약품 목록 단일 출처. */

/* ── _symMeds, _symOintments, _symPatches: helpers.js에서 IPC로 비동기 로드됨 ── */
/* S._symMeds/Ointments/Patches가 설정될 때까지 medDb 기본값 사용 */
S._symMeds=S._symMeds||{
  pain:(_medDb.pain||[]).slice(),
  cough:(_medDb.respiratory||[]).slice(),
  digest:(_medDb.digest||[]).slice()
};
S._symOintments=(Array.isArray(S._symOintments)?S._symOintments:null)||(_medDb.wound||[]).slice();
S._symPatches=(Array.isArray(S._symPatches)?S._symPatches:null)||(_medDb.trauma||[]).slice();
function _symSaveMeds(){
  S._symMeds=S._symMeds; S._symMeds=S._symMeds;
  if(window.electronAPI&&window.electronAPI.medicalSetSymMeds)
    window.electronAPI.medicalSetSymMeds(S._symMeds).catch(function(err){console.error('[DB] sym_meds 저장 실패:',err);});
}
function _symSaveOintments(){
  S._symOintments=S._symOintments; S._symOintments=S._symOintments;
  if(window.electronAPI&&window.electronAPI.medicalSetSymOintments)
    window.electronAPI.medicalSetSymOintments(S._symOintments).catch(function(err){console.error('[DB] sym_ointments 저장 실패:',err);});
}
function _symSavePatches(){
  S._symPatches=S._symPatches; S._symPatches=S._symPatches;
  if(window.electronAPI&&window.electronAPI.medicalSetSymPatches)
    window.electronAPI.medicalSetSymPatches(S._symPatches).catch(function(err){console.error('[DB] sym_patches 저장 실패:',err);});
}
/* ── 약품 숨기기 (눈알 아이콘) ── */
const _medHidden=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}'); /* {약품명:true} */
function _medIsHidden(name){return !!_medHidden[name];}
function _medToggleHidden(name){
  if(_medHidden[name])delete _medHidden[name];
  else _medHidden[name]=true;
  localStorage.setItem('ec_med_hidden',JSON.stringify(_medHidden));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_hidden',_medHidden);
}
const _medHiddenUndoStack=[];
function _medHide(name,el){
  _medHidden[name]=true;
  _medHiddenUndoStack.push(name);
  localStorage.setItem('ec_med_hidden',JSON.stringify(_medHidden));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_hidden',_medHidden);
  /* 항목 fadeOut */
  if(el){
    const row=el.closest('.sym-sel-chip')||el.parentElement;
    if(row){row.style.transition='opacity .2s,max-height .2s';row.style.opacity='0';row.style.maxHeight='0';row.style.overflow='hidden';setTimeout(function(){row.remove();},220);}
  }
  /* 미니 팝업 */
  _medShowHideTip(name);
}
function _medShowHideTip(name){
  const existing=document.getElementById('medHideTip');if(existing)existing.remove();
  const tip=document.createElement('div');tip.id='medHideTip';
  tip.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 18px;border-radius:10px;font-size:11px;line-height:1.7;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.3);opacity:0;transition:opacity .2s,transform .2s;max-width:360px;text-align:center';
  tip.innerHTML='<div style="font-weight:700;margin-bottom:4px">👁‍🗨 '+escHtml(name)+' 숨김</div>'
    +'<div>다음부터 표시되지 않습니다.</div>'
    +'<div style="margin-top:4px">지금 <b>Ctrl+Z</b>를 누르면 되돌릴 수 있습니다.</div>'
    +'<div style="margin-top:4px;color:#94a3b8">설정 > 보건일지 설정에서 다시 보이도록 할 수 있습니다.</div>';
  document.body.appendChild(tip);
  requestAnimationFrame(function(){tip.style.opacity='1';});
  setTimeout(function(){tip.style.opacity='0';setTimeout(function(){tip.remove();},200);},4000);
}
/* ── 처치 승격/강등 되돌리기 스택 ── */
const _treatUndoStack=[];/* {action:'promote'|'demote', treat, recId, fav:[...], dem:[...]} */
/* Ctrl+Z 되돌리기 (약품 숨기기 + 처치 승격/강등) */
document.addEventListener('keydown',function(e){
  if(!(e.ctrlKey||e.metaKey)||e.key!=='z')return;
  /* 1. 약품 숨기기 되돌리기 우선 */
  if(_medHiddenUndoStack.length){
    const last=_medHiddenUndoStack.pop();
    delete _medHidden[last];
    localStorage.setItem('ec_med_hidden',JSON.stringify(_medHidden));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','med_hidden',_medHidden);
    const tip=document.getElementById('medHideTip');if(tip)tip.remove();
    bus.emit('toast:show', {text: last+' 숨김이 해제되었습니다.'});
    const pop=document.getElementById('symMedPopup');
    if(pop){pop.remove();}
    return;
  }
  /* 2. 처치 변경 되돌리기 (Phase 3a 새 액션 + 레거시 promote/demote 지원) */
  if(_treatUndoStack.length){
    const u=_treatUndoStack.pop();
    if(u.action==='hardRemove'){
      /* 증상별 영구 삭제 → 이전 상태 복원 */
      localStorage.setItem('ec_user_sym_removed',JSON.stringify(u.prevRemoved||{}));
      localStorage.setItem('ec_user_sym_fav',JSON.stringify(u.prevFav||{}));
      bus.emit('toast:show', {text: '"'+u.treat+'" 삭제 되돌려짐'});
    } else if(u.action==='hardRemoveLegacy'){
      /* 레거시 전역 favorites 에서 제거 되돌리기 */
      localStorage.setItem('ec_user_fav_treatments',JSON.stringify(u.prevFav||[]));
      bus.emit('toast:show', {text: '"'+u.treat+'" 삭제 되돌려짐'});
    } else if(u.action==='addUser'){
      /* 사용자 +추가 되돌리기 */
      localStorage.setItem('ec_user_sym_fav',JSON.stringify(u.prevFav||{}));
      bus.emit('toast:show', {text: '"'+u.treat+'" 추가 되돌려짐'});
    } else {
      /* 레거시 promote/demote (이전 버전에서 만들어진 스택 호환) */
      if(u.fav)localStorage.setItem('ec_user_fav_treatments',JSON.stringify(u.fav));
      if(u.dem)localStorage.setItem('ec_user_demoted_treatments',JSON.stringify(u.dem));
      bus.emit('toast:show', {text: '"'+u.treat+'" 이동이 되돌려졌습니다.'});
    }
    if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(u.recId);
    return;
  }
});
/* 설정에서 투약 리스트 관리 */
function _symRemoveMed(cat,idx){S._symMeds[cat].splice(idx,1);_symSaveMeds();renderSettingsPanel('diary');}
function _symAddMedSetting(cat){_symPrompt('추가할 약품명','',function(v){S._symMeds[cat].push(v);_symSaveMeds();renderSettingsPanel('diary');});}
function _symRemoveOintment(idx){S._symOintments.splice(idx,1);_symSaveOintments();renderSettingsPanel('diary');}
function _symAddOintmentSetting(){_symPrompt('추가할 연고명','',function(v){S._symOintments.push(v);_symSaveOintments();renderSettingsPanel('diary');});}
function _symRemovePatch(idx){S._symPatches.splice(idx,1);_symSavePatches();renderSettingsPanel('diary');}
function _symAddPatchSetting(){_symPrompt('추가할 파스명','',function(v){S._symPatches.push(v);_symSavePatches();renderSettingsPanel('diary');});}

let _symPopupRecId=null;
let _symSelectedSymptoms=[];
let _symSelectedTreatments=[];
let _symSelectedMeds=[];
/* 약품별 투여량 — 약명을 키, 투여량 문자열(예 "10ml", "1정")을 값으로 가짐.
 * 빈 값/없음 = 투여량 미기재 (옛 데이터 호환). 통계는 약명만으로 카운트. */
let _symMedDoses={};
/* v3+ 증상별 처치 매핑 — { "증상라벨(메모포함)": ["처치1","처치2",...], ... }
 *  · 우측 패널 블록 분기의 데이터 소스.
 *  · _symAutoSave 가 rec.treatmentBySym 으로 sync → DB treatment_by_sym 컬럼 저장.
 *  · 평탄 _symSelectedTreatments 는 호환용으로 항상 동기 (값들의 union).
 *  · 옛 일지(이 객체가 비어있고 _symSelectedTreatments 만 있음) → "선택 증상에 대한 처치" 단일 블록 폴백. */
let _symTreatmentsBySym={};
/* v3+ 증상별 약품/투여량 매핑 — 투약 처치만 증상별 분리, 침상/V/S 는 record-level (어느 블록 클릭이든 공유). */
let _symMedsBySym={};
let _symMedDosesBySym={};
let _symSymCatMap={}; /* 증상 base → 선택한 상분류 id. 같은 증상명이 여러 상분류에 있어도 "고른 상분류"로 표시·통계 고정 (사용자 요청 2026-06-25) */
/* sticky legacy 판정 (2026-05-28 정합성 수정) — 팝업 열 때 1회 결정.
 *  · true: 진짜 옛 일지 (로드 시 맵 비었는데 평면 처치 있음) → 단일 "선택 증상에 대한 처치" 블록.
 *  · false: 새 레코드(맵 있음, 또는 맵·평면 모두 비어 처치 0) → 증상별 블록.
 *  렌더 모드를 '현재 맵이 비었나'(가변)가 아니라 이 플래그(불변)로 결정해 맵이 비어도 단일 블록으로 붕괴하지 않게 한다. */
let _symRecordIsLegacy=false;
/* 분기/미분기 모드 (2026-06-09 재구현) — true: 증상별 분기, false: 미분기(단일 블록).
 *  · 미분기 처치/약품은 _symTreatmentsBySym['__flat__'] / _symMedsBySym['__flat__'] 예약키에만 보관 →
 *    분기(증상명 키)와 같은 필드에 공존, 서로 안 덮어쓰고 토글해도 양쪽 보존.
 *  · 옛/외부 데이터(rec.treatmentBranched 미설정)는 기존 추론 그대로 → 팝업·표 모두 현행 100% 동일.
 *  · ★ 일반일지 표/열 레이아웃 코드는 이 기능과 무관하게 절대 불변. */
const SYM_FLAT_KEY='__flat__';
let _symBranchMode=true;
/* 아코디언 .open 상태 캡처용 — _symRenderTreatPanel 가 panel.innerHTML 을 교체하기 직전에
 *  현재 펼쳐있는 .sym-fav-acc 의 symKey 들을 모아서 새 HTML 에 'open' 클래스를 박아 재현 → CSS transition 깜빡임 차단.
 *  (사용자 요청 2026-05-21 — 증상 삭제/처치 추가 등 패널 재렌더 트리거되는 모든 액션 후에도
 *   자주 쓰는 처치 아코디언이 닫히지 않도록.) */
let _symRenderOpenAccSymKeys = null;
/* v3 — 현재 약품 팝업이 어느 sym-key 의 것인지 추적 (사용자 결정 2026-05-21).
 * popup 진입 시 '__legacy__' 로 초기화, 투약 칩 클릭 시 해당 sym-key 로 갱신.
 * _symOpenMedPopup 진입 시 _symSelectedMeds / _symMedDoses 를 그 sym-key 의 array/map reference 로 swap. */
let _symActiveSymKey='__legacy__';
/* "가네톡액(10ml)" → {name:'가네톡액', dose:'10ml'} / "타이레놀" → {name:'타이레놀', dose:''}
 * 약품명 자체에 괄호가 있는 경우(예 "타이레놀(아세트아미노펜)") 는 dose 로 잘못 잡지 않도록
 * 괄호 안 내용이 숫자로 시작할 때만 dose 로 인식. 그 외엔 약품명의 일부로 간주. */
function _parseMedWithDose(s){
  const _s=String(s||'').trim();
  if(!_s)return {name:'',dose:''};
  const m=_s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if(m){
    const _inner=m[2].trim();
    /* 숫자(또는 소수점) 로 시작하는 경우만 dose. 그 외엔 약품명 일부. */
    if(/^[\d.]/.test(_inner)) return {name:m[1].trim(), dose:_inner};
  }
  return {name:_s, dose:''};
}
function _serializeMedWithDose(name, dose){
  const _n=String(name||'').trim();
  const _d=String(dose||'').trim();
  if(!_n)return '';
  return _d ? (_n+'('+_d+')') : _n;
}
/* 통계용 — "가네톡액(10ml)" → "가네톡액" */
function _stripMedDose(s){
  return _parseMedWithDose(s).name;
}
/* 현재 선택 + 투여량을 "약명(투여량), 약명, ..." 직렬화 */
function _symMedsToSaveStr(){
  /* v3 — sym-key 별 약품 union 으로 flat medication 생성 (사용자 결정 2026-05-21).
   *  · 옛 호환: 통계·표·인쇄 코드는 r.medication 평탄 문자열을 사용하므로 union 으로 유지.
   *  · 같은 약품을 여러 블록에서 쓰면 flat 에서는 한 번만 (record-level 단일 카운트).
   *  · 도즈는 sym-key 별로 다를 수 있어 flat 에서는 첫 발견 도즈 사용 (옛 단일 문자열 호환).
   *  · 옛 일지/legacy (_symMedsBySym 비어있음) 는 record-level _symSelectedMeds 사용. */
  if (_symMedsBySym && Object.keys(_symMedsBySym).length) {
    const seen=new Set();
    const out=[];
    Object.keys(_symMedsBySym).filter(function(k){
      /* 분기 모드: __flat__ 제외 / 미분기 모드: __flat__ 만. 기존 데이터엔 __flat__ 없어 무동작=현행 동일. (2026-06-09) */
      return _symRecordIsLegacy ? true : (_symBranchMode ? (k!==SYM_FLAT_KEY) : (k===SYM_FLAT_KEY));
    }).forEach(function(k){
      const arr=_symMedsBySym[k];
      if(!Array.isArray(arr))return;
      arr.forEach(function(name){
        if(!name||seen.has(name))return;
        seen.add(name);
        const dose = (_symMedDosesBySym[k] && _symMedDosesBySym[k][name]) || '';
        out.push(_serializeMedWithDose(name, dose));
      });
    });
    return out.filter(Boolean).join(', ');
  }
  /* _symMedsBySym 키가 (약품 전부 제거로) 사라져 fallback 에 도달했는데 sym-key 일지(non-legacy)면,
   *  flat(_symSelectedMeds)에 남은 값은 delete 된 옛 배열 참조라 stale 이므로 빈 값으로 처리한다(= 약품 모두 지움).
   *  진짜 레거시(_symRecordIsLegacy: treatmentBySym 없이 로드된 옛 일지)일 때만 flat 을 써서 옛 약품을 보존. (2026-06-22 정합성 A) */
  if(!_symRecordIsLegacy) return '';
  return _symSelectedMeds.map(function(m){return _serializeMedWithDose(m, _symMedDoses[m]);}).filter(Boolean).join(', ');
}
/* 저장된 medication 문자열 → 표시용 "투약[약명 (투여량), 약명]" 변환.
 * 옛 데이터(약명만)는 "투약[가네톡액, 베아제]" 로 표시. 빈 입력은 빈 문자열 반환. */
export function formatMedicationDisplay(medsStr){
  if(!medsStr||!String(medsStr).trim())return '';
  const items=String(medsStr).split(',').map(function(s){return s.trim();}).filter(Boolean);
  const parts=items.map(function(s){
    const p=_parseMedWithDose(s);
    return p.dose?(p.name+' ('+p.dose+')'):p.name;
  });
  return '투약[' + parts.join(', ') + ']';
}
/* 투약 팝업 — 단위 드롭다운 호버 핸들러 직접 부착. 매 렌더 직후 호출.
 * 부모 팝업(symMedPopup)이 transform 을 사용해 position:fixed 자식의 containing block 을 변경하므로,
 * 메뉴를 document.body 로 이동해 viewport 기준 좌표가 정확히 동작하게 함. */
function _symAttachUnitHover(root){
  if(!root) root = document.getElementById('symMedList') || document.getElementById('symMedPopup');
  if(!root) return;
  root.querySelectorAll('.sym-med-dose-wrap').forEach(function(wrap){
    if(wrap._unitHoverBound) return;
    wrap._unitHoverBound = true;
    /* 메뉴를 body 로 이동 (transform 영향 차단). wrap 의 _unitMenu 에 참조 보관.
     * body 로 옮긴 뒤에는 popup 의 click delegation 이 닿지 않으므로 메뉴에 직접 click 핸들러 부착.
     * 단위 클릭 시 stopPropagation 으로 popup 외부 클릭 검사를 무력화. */
    const _menu0 = wrap.querySelector('.sym-med-unit-menu');
    if(_menu0){
      document.body.appendChild(_menu0);
      wrap._unitMenu = _menu0;
      _menu0.addEventListener('mousedown', function(e){ e.stopPropagation(); }, true);
      _menu0.addEventListener('click', function(e){
        e.stopPropagation();
        const unitBtn = e.target.closest('[data-action="pickMedUnit"]');
        if(!unitBtn) return;
        const med = unitBtn.dataset.med;
        const unit = unitBtn.dataset.unit;
        const inp = document.querySelector('[data-action="medDoseInput"][data-med="'+(window.CSS&&CSS.escape?CSS.escape(med):med.replace(/"/g,'\\"'))+'"]');
        if(!inp) return;
        let v = String(inp.value||'').trim();
        ['T','C','g','cc','ml','mg','gtt','포','개','병'].forEach(function(u){
          if(v.endsWith(u)) v = v.slice(0, -u.length).trim();
        });
        inp.value = v + unit;
        inp.dispatchEvent(new Event('input', {bubbles:true}));
        /* 메뉴 닫기 */
        _menu0.style.display = 'none';
      });
      /* 키보드 네비게이션 — 방향키 이동 / 엔터 선택 / ESC 는 저장하고 닫기 (사용자 요청 2026-06-16).
       *  투여량 input 에서 Tab 으로 진입 → 첫 단위에 focus 된 상태로 시작. */
      _menu0.addEventListener('keydown', function(e){
        const items = Array.from(_menu0.querySelectorAll('[data-action="pickMedUnit"]'));
        if(!items.length) return;
        const cur = document.activeElement;
        let idx = items.indexOf(cur);
        if(e.key==='ArrowDown' || e.key==='ArrowRight'){
          e.preventDefault(); idx = (idx<0 ? 0 : (idx+1)%items.length); items[idx].focus();
        } else if(e.key==='ArrowUp' || e.key==='ArrowLeft'){
          e.preventDefault(); idx = (idx<0 ? items.length-1 : (idx-1+items.length)%items.length); items[idx].focus();
        } else if(e.key==='Enter'){
          e.preventDefault(); if(cur && cur.dataset && cur.dataset.action==='pickMedUnit') cur.click();
        } else if(e.key==='Escape'){
          e.preventDefault();
          _menu0.style.display = 'none';
          if(typeof _symAutoSave==='function') _symAutoSave();   /* 취소가 아니라 저장하고 닫기 */
          const _med = items[0] && items[0].dataset ? items[0].dataset.med : '';
          const _inp = _med ? document.querySelector('[data-action="medDoseInput"][data-med="'+(window.CSS&&CSS.escape?CSS.escape(_med):_med.replace(/"/g,'\\"'))+'"]') : null;
          if(_inp) _inp.focus();
        }
      });
    }
    /* 마우스가 단위 트리거 → 메뉴 갭을 가로지를 때 즉시 닫지 않도록 300ms 지연. */
    let _hideTimer = null;
    /* v3 (사용자 결정 2026-05-21) — hover 부착을 wrap 전체가 아닌 '단위' 트리거(.sym-med-unit-trigger) 에만.
     * 옛 코드는 wrap 전체에 부착되어 투여량 입력란 호버에도 메뉴가 떴음 (회귀). */
    const trig = wrap.querySelector('.sym-med-unit-trigger');
    const _show = function(){
      clearTimeout(_hideTimer);
      const menu = wrap._unitMenu;
      if(!trig || !menu) return;
      document.querySelectorAll('.sym-med-unit-menu').forEach(function(m){ if(m!==menu) m.style.display='none'; });
      menu.style.display = 'flex';
      const tR = trig.getBoundingClientRect();
      const mW = menu.offsetWidth || 240;
      const mH = menu.offsetHeight || 32;
      let top = tR.bottom + 4;
      let left = tR.right - mW;
      if(left < 6) left = 6;
      if(left + mW > window.innerWidth - 6) left = window.innerWidth - mW - 6;
      if(top + mH > window.innerHeight - 6) top = tR.top - mH - 4;
      menu.style.top = top + 'px';
      menu.style.left = left + 'px';
      menu.style.right = 'auto';
    };
    const _scheduleHide = function(){
      clearTimeout(_hideTimer);
      _hideTimer = setTimeout(function(){
        const menu = wrap._unitMenu;
        if(menu && !menu.matches(':hover') && (!trig || !trig.matches(':hover'))) menu.style.display='none';
      }, 300);
    };
    if(trig){
      trig.addEventListener('mouseenter', _show);
      trig.addEventListener('mouseleave', _scheduleHide);
    }
    /* 메뉴 자체에도 호버 핸들러 — 메뉴 위 마우스 있으면 닫기 취소 */
    if(wrap._unitMenu){
      wrap._unitMenu.addEventListener('mouseenter', function(){ clearTimeout(_hideTimer); });
      wrap._unitMenu.addEventListener('mouseleave', _scheduleHide);
    }
  });
}
/* 투여량 입력칸 + 단위(T/C/g/ml/mg/cc) 호버 드롭다운. 단위 클릭 시 값 끝에 추가/교체. */
function _buildMedDoseInput(item){
  const cur=_symMedDoses[item]||'';
  const units=['T','C','g','cc','ml','mg','gtt','포','개','병'];
  const menuItems=units.map(function(u){
    const _lbl=(u==='gtt')?'gtt(방울)':u;
    return '<span data-action="pickMedUnit" tabindex="-1" data-med="'+escHtml(item)+'" data-unit="'+u+'" style="padding:3px 10px;font-size:11px;font-weight:600;color:var(--t1);border-radius:4px;cursor:pointer;text-align:center" onmouseover="this.style.background=\'rgba(6,182,212,0.12)\'" onmouseout="this.style.background=\'transparent\'">'+_lbl+'</span>';
  }).join('');
  return '<div class="sym-med-dose-wrap" style="position:relative;display:inline-flex;align-items:center;gap:3px;flex-shrink:0">'
    +'<input data-action="medDoseInput" data-med="'+escHtml(item)+'" type="text" value="'+escHtml(cur)+'" placeholder="숫자로 투여량 입력" maxlength="20" style="width:100px;font-size:10px;padding:2px 7px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);outline:none;font-family:var(--f);text-align:center">'
    +'<span class="sym-med-unit-trigger" data-med="'+escHtml(item)+'" style="padding:2px 6px;font-size:10px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:2px">단위<span style="font-size:8px">▾</span></span>'
    +'<div class="sym-med-unit-menu">'+menuItems+'</div>'
    +'</div>';
}
/* 통계용 — "가네톡액(10ml), 베아제" → ["가네톡액", "베아제"] (투여량 제거) */
export function extractMedNames(medsStr){
  if(!medsStr||!String(medsStr).trim())return [];
  return String(medsStr).split(',').map(function(s){return _stripMedDose(s.trim());}).filter(Boolean);
}

let _symOpening=false;
/* 표(V/S·신체사정) 클릭으로 이어 열 입력 팝업 — 팝업 함수가 2번 호출돼도(중복방지 포함) 살아남도록
 *  모듈 변수에 보관 후, 실제로 팝업을 그린 호출이 소비. (2026-08-06) */
let _symPendingAutoOpen=null;
let _symLockCategory=null; /* 상담실적 행 클릭 등 — 특정 상분류만 활성, 나머지 비활성 (사용자 요청 2026-06-13) */
/* 외부 창(병원 찾기 등)에서 main 으로 포커스 복귀 직후 200ms 동안 플래그 ON.
 * 증상 팝업의 외부 클릭 닫기 핸들러가 이 플래그를 보고 무시 — popup 잘못 닫힘 방지.
 * 한 번만 등록되도록 가드. */
if(typeof window!=='undefined' && !window._symFocusGuardBound){
  window._symFocusGuardBound=true;
  window.addEventListener('focus',function(){
    window._symFocusJustReturned=true;
    setTimeout(function(){window._symFocusJustReturned=false;},200);
  });
}

/* 동명이인 미해결 그룹 체크 — openSymptomCategoryPopup 의 비동기 분기.
 *  isPersonInNameDupGroup 으로 확인 → 그룹원이면 confirm 띄움 → 사용자 선택에 따라:
 *    ① 확인 → openNameDupMatcher (focusUid) — 종료 후 본 팝업 재진입
 *    ② 취소 → 본 팝업 그대로 진행 (skip 플래그로 무한 재귀 차단)
 *  분기 진입 시 _symOpening 을 false 로 풀어 재진입 시 dedup guard 가 막지 않게 함. */
function _symCheckNameDupAndProceed(rec, recId){
  _symOpening = false;
  import('../person-manager/name-dup-matcher.js').then(function(mod){
    if(!mod || typeof mod.isPersonInNameDupGroup !== 'function'){
      S._symSkipNameDupCheck = true;
      openSymptomCategoryPopup(recId);
      return;
    }
    mod.isPersonInNameDupGroup(rec.studentId).then(function(isDup){
      if(!isDup){
        S._symSkipNameDupCheck = true;
        openSymptomCategoryPopup(recId);
        return;
      }
      const stu = (S.people||[]).find(function(p){ return p.uid===rec.studentId || p.id===rec.studentId; });
      const nm = stu ? stu.name : '이 학생';
      const ok = confirm('이 학생('+nm+')의 학년에 동명이인이 있기 때문에 매칭 작업이 필요합니다.\n\n지금 매칭하시겠습니까?');
      if(ok){
        mod.openNameDupMatcher({
          focusUid: rec.studentId,
          onDone: function(){
            /* 매칭 종료 — 증상 팝업 재진입. recId 가 가리키던 학생 uid 가 바뀌었을 수 있으나
             *  records 재로드는 _resolveMatch 안에서 처리되어 rec.studentId 가 최신화됨. */
            S._symSkipNameDupCheck = true;
            setTimeout(function(){ openSymptomCategoryPopup(recId); }, 50);
          },
        });
      } else {
        /* 사용자 취소 — 그대로 증상 팝업 진행 */
        S._symSkipNameDupCheck = true;
        openSymptomCategoryPopup(recId);
      }
    }).catch(function(e){
      console.error('[name-dup symptom-trigger]', e);
      S._symSkipNameDupCheck = true;
      openSymptomCategoryPopup(recId);
    });
  }).catch(function(e){
    console.error('[name-dup matcher load]', e);
    S._symSkipNameDupCheck = true;
    openSymptomCategoryPopup(recId);
  });
}

export function openSymptomCategoryPopup(recId, opts){
  /* opts.lockCategory: 그 상분류만 활성, 나머지 상분류는 클릭 비활성(흐리게). (상담실적 행 클릭 진입 2026-06-13) */
  _symLockCategory=(opts&&opts.lockCategory)?opts.lockCategory:null;
  /* autoOpen 은 어느 호출이 실제로 팝업을 그리든 살아남도록 먼저 보관(중복방지 return 전에). */
  if(opts && opts.autoOpen) _symPendingAutoOpen=opts.autoOpen;
  /* 중복 호출 방지 (이벤트 버블링으로 2번 호출되는 문제) */
  if(_symOpening)return;
  _symOpening=true;
  setTimeout(function(){_symOpening=false;},300);
  /* 통계 카운트용 약품명 집합 갱신 — 세션 중 설정에서 약품 추가했어도 반영 (boot 외 보강). (2026-06-09) */
  try{ if(typeof _symBuildStatMedNames==='function')_symBuildStatMedNames(); }catch(_){}

  _symPopupRecId=recId;S._symPopupRecId=recId;
  const rec=S.records.find(function(r){return r.id===recId;});
  if(!rec){_symOpening=false;return;}
  /* 협업 편집 잠금 확인 (2026-06-07) — 같은 방문 레코드를 다른 사람이 이미 열어 수정 중이면 중앙 경고.
   *  모든 진입점(일반일지·대시보드·응급·EMS)을 한 곳에서 커버. 강제차단 아님(그래도 열기 가능, last-write-wins).
   *  _symLockChecked 플래그로 한 번만 확인 — 동명이인 재진입/그래도열기 재호출 시 재확인 안 함. (협업 꺼짐 시 checkEditLock=locked:false → 그대로 열림) */
  if(!S._symLockChecked){
    /* 팝업을 막지 않고 즉시 연다 — 잠금 확인은 백그라운드로(2026-06-09 지연 제거).
     *  예전엔 여기서 checkEditLock 네트워크 응답을 기다린 뒤에야 팝업을 열어 매번 수십 ms 지연됐다.
     *  이제 바로 아래로 진행해 즉시 열고, 다른 사람이 편집 중이면 팝업 위로 경고를 띄워 "닫기" 시에만 닫는다.
     *  서버 GET /api/edit-lock 은 내 sid 의 잠금은 locked:false 로 주므로(2620행) 내 잠금에 자기경고 안 뜸.
     *  (soft lock = 강제차단 아님, last-write-wins) */
    S._symLockChecked=true;
    checkEditLock(recId).then(function(r){
      if(r && r.locked && document.getElementById('symCatOverlay')){
        showEditLockWarning(r.name).then(function(ok){
          if(!ok){ const _ov=document.getElementById('symCatOverlay'); if(_ov) _ov.remove(); }
        });
      }
    }).catch(function(){});
    /* return 없음 — 아래로 계속 진행해 팝업 즉시 열림 */
  }
  /* 동명이인 미해결 그룹 멤버라면 매칭 진행 의사 확인 (사용자 요청 2026-05-19).
   *  확인 → 매칭 모달 진입 후 종료 시 본 팝업 재진입
   *  취소 → 본 팝업 그대로 진행 (선택 학생이 동명이인 중 한 명일 수 있음) */
  if(rec.studentId && !S._symSkipNameDupCheck){
    _symCheckNameDupAndProceed(rec, recId);
    return; /* 비동기 분기 — 실제 팝업 열기는 _symCheckNameDupAndProceed 안에서 재호출 */
  }
  S._symSkipNameDupCheck = false;
  /* 실제 열기 도달 — 다음 "새 열기"가 잠금 재확인하도록 플래그 리셋 (이번 호출은 이미 확인 통과). */
  S._symLockChecked = false;
  /* 사이드바 최근 방문 이력 자동 표시 (사용자 요청 2026-05-18) — 팝업 컨텍스트의 학생으로 잠금.
   *  state 변경 시 bus.emit('render:daily') 가 발화되고 daily-view 의 구독이 사이드바를 재렌더하므로
   *  입력 중인 값이 실시간 반영됨 (가장 최근 = 현 레코드가 항상 맨 위).
   *  A→B 학생 교체(popup replace) 케이스에서 prev 백업이 덮어쓰이지 않도록 첫 진입 시에만 저장. */
  try {
    const _popupAlreadyOpen = !!document.getElementById('symCatOverlay');
    if(!_popupAlreadyOpen){
      S._symPrevLockedStuId = S.dailyLockedStudentId || null;
      S._symPrevVisitHistoryLocked = !!S._visitHistoryLocked;
    }
    /* studentId 우선, 없으면 personUid (EC/INF 임포트 데이터 호환) */
    const _sid = rec.studentId || rec.personUid;
    if(_sid){
      /* 이미 같은 학생의 카드가 보이는 상태라면 body.innerHTML 재렌더 자체를 건너뜀.
       *   - 깜빡임의 주 원인은 row 클릭으로 카드가 떠 있는데 chip 클릭으로 같은/다른 학생 카드를
       *     showVisitHistory 가 다시 그리면서 옵acity transition 또는 페인트 플래시가 일어나는 것.
       *   - 같은 학생이면 그대로 두고 잠금 상태와 dailyLockedStudentId 만 갱신.
       *   - 다른 학생이면 정식 경로(_dvShowVisitHistory)로 페이드 후 교체.
       * showVisitHistory 의 early-return 회피용으로 잠깐 false 로 내렸다가, 재표시 직후 다시 잠금. */
      const _vhPanel = document.getElementById('sideVisitHistory');
      const _sameStudentVisible = _vhPanel
        && _vhPanel.classList.contains('vh-show')
        && _vhPanel._lastStuId === _sid;
      S._visitHistoryLocked = false;
      S.dailyLockedStudentId = _sid;
      if(!_sameStudentVisible && typeof _dvShowVisitHistory==='function'){
        _dvShowVisitHistory(_sid);
      }
      S._visitHistoryLocked = true;
    }
  } catch(_e){ /* 사이드바 표시 실패해도 팝업은 정상 진행 */ }
  /* 상담 장식 라벨("상담[학업 관련 상담]")은 내부 raw 주제("학업")로 역변환 — 칩 매칭·상담 블록 로직 호환 (2026-06-13) */
  _symSelectedSymptoms=rec.symptoms?rec.symptoms.map(_symFromSavedSymptom):[];
  _symSelectedTreatments=rec.treatment?rec.treatment.slice():[];
  /* v3 — 증상별 처치 매핑 복원. 옛 record (없음/빈 객체) 면 빈 객체 → 렌더러가 "선택 증상에 대한 처치" 폴백. */
  _symTreatmentsBySym = (rec.treatmentBySym && typeof rec.treatmentBySym==='object' && !Array.isArray(rec.treatmentBySym))
    ? JSON.parse(JSON.stringify(rec.treatmentBySym)) : {};
  /* sticky legacy 판정 (2026-05-28) — 로드 시점에 맵은 비었는데 '일반(비 record-level) 평면 처치'가 있으면 진짜 옛 일지.
   *  · record-level(침상·V/S)만 있는 건 비legacy 로 본다 (증상별 모드의 공유 처치이므로) → +추가가 옛 팝업으로 새지 않음.
   *  · 이후 세션 동안 맵이 비어도 이 값은 유지되어 증상별 블록이 단일 블록으로 붕괴하지 않는다. */
  /* v3 (2026-05-28) — V/S·침상도 per-symptom 으로 귀속 → record-level 개념 폐지.
   *  맵이 비었는데 평면 처치가 하나라도 있으면 옛 일지(증상별 매핑 없음)로 보고 보존. */
  const _hasNonRLFlat = _symSelectedTreatments.length>0;
  /* 상담 레코드 제외 (사용자 보고 2026-06-26): 상담은 treatmentBySym 가 없고 상담 처치란(treatmentText)이
   *  flat rec.treatment 에 1건 들어가므로, 그것만으로 옛 일지로 오판되면 상담록이 사라지고 "선택 증상에 대한
   *  처치" 블록이 떴다. 상담 증상이 하나라도 있으면 legacy 가 아니다. */
  const _hasCounselSym = _symSelectedSymptoms.some(function(sx){ return typeof _symIsCounselSym==='function' && _symIsCounselSym(sx); });
  _symRecordIsLegacy = (Object.keys(_symTreatmentsBySym).length===0) && _hasNonRLFlat && !_hasCounselSym;
  /* v3 — 증상별 약품/도즈 매핑 복원 (사용자 결정 2026-05-21).
   * 깊은 복사로 외부 mutation 차단. 옛 record 는 빈 객체 → 옛 일지 폴백. */
  _symMedsBySym = (rec.medsBySym && typeof rec.medsBySym==='object' && !Array.isArray(rec.medsBySym))
    ? JSON.parse(JSON.stringify(rec.medsBySym)) : {};
  _symMedDosesBySym = (rec.medDosesBySym && typeof rec.medDosesBySym==='object' && !Array.isArray(rec.medDosesBySym))
    ? JSON.parse(JSON.stringify(rec.medDosesBySym)) : {};
  /* 증상→선택 상분류 매핑 복원 (없으면 빈 객체 → 표시·통계는 _symFindCategoryForSym 폴백) */
  _symSymCatMap = (rec.symCatMap && typeof rec.symCatMap==='object' && !Array.isArray(rec.symCatMap))
    ? JSON.parse(JSON.stringify(rec.symCatMap)) : {};
  /* 분기/미분기 모드 결정 — 명시 플래그 우선, 없으면 기존 추론(legacy→미분기, 그 외→분기).
   *  플래그 없는 기존/외부 데이터는 _symRecordIsLegacy 그대로 → 현행과 100% 동일. (2026-06-09) */
  _symBranchMode = (typeof rec.treatmentBranched === 'boolean')
    ? rec.treatmentBranched
    : (rec.isImported ? false : !_symRecordIsLegacy); /* 외부 이관 데이터 → 미분기 고정 (2026-06-09) */
  /* 사용자 보고 2026-05-22 — 자유 기입 증상의 카테고리 매핑 복원.
   *  rec.symFreeTextByCat = { catId: text } 형태로 저장된 것을 _symFreeTextByCat 에 recId::catId 키로 풀어 적용.
   *  모듈 스코프 _symFreeTextByCat 는 const 라 in-place 갱신 (옛 다른 record 키 보존 + 이 record 키 갱신).
   *  먼저 이 record 의 키들을 제거 후 새로 적용 (옛 잔재 정리). */
  Object.keys(_symFreeTextByCat).forEach(function(k){
    if(k.indexOf(rec.id + '::') === 0) delete _symFreeTextByCat[k];
  });
  if(rec.symFreeTextByCat && typeof rec.symFreeTextByCat==='object' && !Array.isArray(rec.symFreeTextByCat)){
    Object.keys(rec.symFreeTextByCat).forEach(function(catId){
      if(catId) _symFreeTextByCat[rec.id + '::' + catId] = rec.symFreeTextByCat[catId];
    });
    if(typeof _symPersistFreeTextByCat==='function') _symPersistFreeTextByCat();
  }
  /* v3 — 약품 팝업 sym-key 추적자 reset. 약품 칩 클릭 시 갱신. */
  _symActiveSymKey='__legacy__';
  /* 사용자 요청 — 바디맵 마커에 .symptom 이 부착돼 있으면 그 중분류 증상은 반드시 선택 상태여야 함.
   * 옛 데이터/직접 편집/마이그레이션 등으로 마커는 있는데 증상이 빠진 경우가 있어 여기서 보정. */
  try{
    const _bm=(window._bmData||{})[recId]||[];
    const _bases=new Set();
    _bm.forEach(function(m){ if(m && m.symptom) _bases.add(String(m.symptom)); });
    _bases.forEach(function(base){
      const _has=_symSelectedSymptoms.some(function(x){
        return x===base || x.indexOf(base+'(')===0 || x.indexOf(base+' (')===0;
      });
      if(!_has){
        /* 부위(마커 라벨) 부착해 라벨 재구성 */
        _symSelectedSymptoms.push(typeof _symBuildSymLabel==='function'?_symBuildSymLabel(recId,base):base);
      }
    });
    /* DB 동기화 — 보정된 증상도 record 에 반영되도록 */
    if(_bases.size>0){
      rec.symptoms=_symSelectedSymptoms.map(_symToSavedSymptom); /* 상담 주제는 "상담[X 관련 상담]" 으로 저장 (2026-06-13) */
      if(typeof _symAutoSave==='function')_symAutoSave();
    }
  }catch(_){}
  /* 메모 캐시 시드 — 알려진 모든 바디맵 부위명을 사용해 stored 라벨에서 부위명을 strip.
   * (CURRENT markers 만 쓰면 이미 해제된 부위명을 메모로 오인하는 버그가 발생.)
   * window._bmAllKnownPartLabels 는 emergency-view.js 에서 전역 노출. */
  try{
    const _known=(typeof window!=='undefined' && window._bmAllKnownPartLabels) || null;
    _symSelectedSymptoms.forEach(function(s){
      const _bm2=s.match(/^(.+?)\s*\((.*)\)\s*$/);
      const _base2=_bm2?_bm2[1].trim():s;
      let _memo='';
      if(_bm2){
        const _inside=_bm2[2];
        const _items=_inside.split(/,\s*/);
        const _memoItems=_items.filter(function(x){
          const _t=x.trim();
          if(!_t)return false;
          /* 알려진 부위명이면 메모 아님 */
          if(_known && _known.has(_t)) return false;
          return true;
        });
        _memo=_memoItems.join(', ').trim();
      }
      _symSymMemoCache[_symSymMemoKey(recId, _base2)]=_memo;
    });
    /* 캐시 시드 후 즉시 라벨 재구성 — 이미 stale 한 부위명을 가진 라벨도 깔끔히 cleanup */
    _symRebuildAllSymLabels(recId);
    rec.symptoms=_symSelectedSymptoms.map(_symToSavedSymptom); /* 상담 주제는 "상담[X 관련 상담]" 으로 저장 (2026-06-13) */
  }catch(_){}
  /* rec.medication 에서 "약명(투여량), 약명, ..." 을 분리해 _symSelectedMeds 와 _symMedDoses 로 분해.
   * 옛 데이터(약명만 있는 경우)는 dose 가 비어있는 채로 들어옴. */
  _symSelectedMeds=[]; _symMedDoses={};
  if(rec.medication){
    rec.medication.split(',').forEach(function(token){
      const p=_parseMedWithDose(token);
      if(p.name){
        _symSelectedMeds.push(p.name);
        if(p.dose)_symMedDoses[p.name]=p.dose;
      }
    });
  }
  const existing=document.getElementById('symCatOverlay');if(existing){existing.remove();}
  /* 협업 편집 잠금 획득 + heartbeat 시작 — 이 레코드를 "수정 중"으로 서버에 알림.
   * 학생 교체(팝업 replace)면 acquireEditLock 이 이전 레코드 잠금을 먼저 해제한다. (2026-06-07) */
  try{ acquireEditLock(recId); }catch(_lk){}
  const ov=document.createElement('div');ov.id='symCatOverlay';
  /* 사용자 요청 (2026-05-18) — 팝업 주변 어두워지는 backdrop 제거. 단순 투명 오버레이. */
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:transparent;z-index:9500';
  /* 상담 상분류 추가(15개)로 세로 여유 확대 720→780 (사용자 요청 2026-06-12) */
  const _boxW=960, _boxH=Math.min(window.innerHeight-40,780);
  const _boxL=Math.max(0,(window.innerWidth-_boxW)/2);
  const _boxT=Math.max(0,(window.innerHeight-_boxH)/2);
  /* 팝업 박스에 recId data 속성을 부여하여 _symRenderTreatPanel이 참조 가능하도록 */
  S._symPopupRecId=recId;
  let h='<div id="symCatBox" data-rec-id="'+recId+'" style="background:var(--card);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.2);width:'+_boxW+'px;max-width:85vw;height:'+_boxH+'px;display:flex;flex-direction:column;overflow:hidden;position:fixed;left:'+_boxL+'px;top:'+_boxT+'px">';
  /* 헤더 (드래그 가능) */
  const stu=rec?getStu(rec.studentId):null;
  /* 학년반 표기: 학교급=유 → "N세 반이름" (번호 생략), 그 외 → "N학년 M반 K번" */
  const _lvMap={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  const _stuLv=stu?(_lvMap[stu.level]||stu.level||''):'';
  /* 학교급 prefix 는 본교에 학교급이 둘 이상 있을 때만 표시.
   * 단일 학교급이면 "고 3학년 ..." 처럼 중복 정보로 보여서 사용자 요청대로 prefix 생략. */
  let _multiLevel=false;
  try{
    if(Array.isArray(S.people)){
      const _seen=new Set();
      for(let i=0;i<S.people.length;i++){
        const lv=S.people[i]&&S.people[i].level;
        if(lv)_seen.add(lv);
        if(_seen.size>1){_multiLevel=true;break;}
      }
    }
  }catch(_e){}
  const _stuLvPrefix=(_multiLevel && _stuLv) ? (_stuLv+' ') : '';
  /* 학과(department) 입력된 학생: "학과명 학년 반 번 이름" 형태로 표시 */
  const _stuDept=stu?String(stu.department||'').trim():'';
  /* 성별 접미사 — 학생/교직원 공통, 값 없으면 빈 문자열. (사용자 요청 2026-05-19) */
  const _stuGenderSfx=(function(){
    const g=stu&&stu.gender;
    const m={'M':'남','F':'여','남':'남','여':'여'};
    return (g&&m[g])?(' ('+m[g]+')'):'';
  })();
  const stuInfo=stu?(
    (stu.type==='staff'
      ? ((stu.position||'교직원')+' '+stu.name)
      : (_stuLv==='유'
          ? (_stuLvPrefix+stu.grade+'세 '+(stu.cls||'')+' '+(stu.num?stu.num+'번 ':'')+stu.name)
          : (_stuLvPrefix+(_stuDept?_stuDept+' ':'')+stu.grade+'학년 '+stu.cls+'반 '+stu.num+'번 '+stu.name)
        )
    )+_stuGenderSfx
  ):'';
  /* 보호자 연락처 + 생년월일 — 별도 칩으로 표시할 데이터 수집 */
  let _gContact='', _birth='';
  if(stu){
    try{
      if(typeof getGuardianContact==='function')_gContact=getGuardianContact(stu)||'';
      if(!_gContact)_gContact=stu.guardianContact||stu.familyContact||stu.familyPhone||'';
    }catch(e){}
    try{
      if(typeof getStudentBirth==='function')_birth=getStudentBirth(stu)||'';
      if(!_birth)_birth=stu.birth||stu.birth_date||'';
    }catch(e){}
    if(_birth){
      const _bd=String(_birth).replace(/-/g,'').replace(/\./g,'');
      if(/^\d{8}$/.test(_bd))_birth=_bd.slice(0,4)+'. '+parseInt(_bd.slice(4,6),10)+'. '+parseInt(_bd.slice(6,8),10)+'.';
    }
  }
  h+='<div style="padding:8px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));flex-shrink:0">';
  const _isCare=stu&&((stu.status==='caution'||stu.status==='watch')||stu.is_care===1||stu.is_care==='1')&&!!(stu.condition||stu.care_reason||(stu.careMemo&&stu.careMemo.trim&&stu.careMemo.trim())||(stu.care_memo&&stu.care_memo.trim&&stu.care_memo.trim()));
  const _isMedN=stu&&(stu.med_consent==='N'||stu.medConsent==='N');
  /* 칩 데이터 수집 */
  const _hasBm=(window._bmData||{})[recId]&&(window._bmData||{})[recId].length>0;
  /* 학생 전체 일지 중 바디맵 마커 있는 일지 수 (📚 바디맵 이력 칩 카운트) */
  /* 인물 키 집합 — studentId 타입 혼재·personUid 엇갈림 레코드도 이력에 포함 (2026-08-26 누락 수정) */
  const _stuKeys=stuKeySet(rec.personUid||rec.studentId);
  const _bmHistCount=(function(){
    let c=0;const bd=window._bmData||{};
    S.records.forEach(function(r){if(recInStuKeys(r,_stuKeys)&&bd[r.id]&&bd[r.id].length>0)c++;});
    return c;
  })();
  const _isEcN=stu&&(stu.emergency_consent==='N'||stu.emergencyConsent==='N'||stu.ec_consent==='N');
  const _dustBaseVal=(stu&&(stu.dust_disease||stu.dustDisease||stu.dust_base_disease))||'';
  const _isDustBase=!!_dustBaseVal;
  /* 등록 학년도 prefix — 칩 툴팁 앞에 "2026학년도 " 표기. 학생 정보(students_info)가 등록된 학년도.
   *  1순위: stu.school_year(로스터 등록 학년도). 없으면 방문일자 기준(3월~ = 해당 연도, 1~2월 = 전년도)으로 폴백. */
  const _stuYear=(function(){
    const y=stu&&(stu.school_year||stu.schoolYear);
    if(y)return String(y);
    const d=(rec&&rec.date)?new Date(rec.date):new Date();
    const base=isNaN(d.getTime())?new Date():d;
    return String(base.getMonth()>=2?base.getFullYear():base.getFullYear()-1);
  })();
  const _yrPfx=_stuYear?(_stuYear+'학년도 '):'';
  S._vipTags=(S._vipTags||{})[rec.studentId]||[];
  const _hasVip=S._vipTags.length>0;
  /* 주의사항(메모) 건수 — 일반 일지 memoData 참조 */
  let _memoCnt=0;try{const _mSlots=(typeof S.memoData!=='undefined'&&S.memoData[rec.studentId])||[];if(Array.isArray(_mSlots)){_memoCnt=_mSlots.filter(function(s){return s&&s.text&&s.text.trim();}).length;}}catch(e){}
  /* 물품 대여 — 이 학생의 미반납 건수 (사용자 요청 2026-05-27) — localStorage 직접 읽기 */
  let _rentalCnt = 0;
  try {
    const _rlRecs = JSON.parse(localStorage.getItem('ec_rental_records') || '[]');
    if(Array.isArray(_rlRecs)){
      _rentalCnt = _rlRecs.filter(function(r){ return r && r.personId == rec.studentId && !r.returned; }).length;
    }
  } catch(_) {}
  /* 과거 방문 이력 건수 (현재 날짜 제외, 날짜 기준 고유 카운트) */
  const _visitDates={};S.records.forEach(function(r){if(recInStuKeys(r,_stuKeys)&&r.date!==rec.date)_visitDates[r.date]=1;});
  const _visitCnt=Object.keys(_visitDates).length;
  /* V/S 이력 건수 — 같은 학생의 모든 일지 중 V/S 필드(체온/혈압/맥박/호흡/SpO₂/BST) 하나라도 입력된 건수 */
  let _vsHistCount=0;
  S.records.forEach(function(r){
    if(!recInStuKeys(r,_stuKeys))return;
    if(r.temp||r.bp||r.pulse||r.resp||r.spo2||r.bst)_vsHistCount++;
  });
  /* V/S 데이터 수집 */
  const _vsArr=[];
  if(rec.temp)_vsArr.push('체온 '+rec.temp+'°C');
  if(rec.bp)_vsArr.push('혈압 '+rec.bp);
  if(rec.pulse)_vsArr.push('맥박 '+rec.pulse);
  if(rec.resp)_vsArr.push('호흡 '+rec.resp);
  if(rec.spo2)_vsArr.push('SpO₂ '+rec.spo2);
  if(rec.bst)_vsArr.push('BST '+rec.bst);
  const _hasVs=_vsArr.length>0;
  const _vsSummary=_hasVs?_vsArr.join(' / '):'활력징후가 입력되지 않았습니다. 클릭하여 입력하세요.';

  /* 1행: 제목 */
  h+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px">🩺 증상 선택 및 처치</div>';
  /* 2행: 학년반(소속) + 이름 / 주 보호자 연락처 / 생년월일 — 칩 3개로 분리 */
  /* 미입력 표시 헬퍼 — 빈 값/'-' 면 기울임체 "(미입력)", 아니면 escHtml 그대로 */
  const _emptyMark='<span style="font-style:italic;opacity:0.7;font-weight:500">(미입력)</span>';
  function _showOrEmpty(v){
    const t=String(v||'').trim();
    return (!t||t==='-')?_emptyMark:escHtml(v);
  }
  h+='<div id="symStuRow" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:6px">'
    +'<span style="font-size:11px;font-weight:700;color:var(--cyan);padding:2px 8px;border-radius:6px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.15)">'+escHtml(stuInfo)+'</span>';
  /* 보호자 연락처 — 값이 있을 때만 칩 표시 (사용자 요청 2026-05-19, 미입력 칩 제거). */
  {
    const _gcT=String(_gContact||'').trim();
    if(_gcT && _gcT!=='-'){
      h+='<span style="font-size:10px;font-weight:600;color:var(--t2);padding:2px 8px;border-radius:6px;background:var(--bg2);border:1px solid var(--bdr)">📞 주 보호자 '+escHtml(_gContact)+'</span>';
    }
  }
  /* 생년월일 — 값이 있을 때만 칩 표시 (사용자 요청 2026-05-19, 미입력 칩 제거). */
  if(_birth&&String(_birth).trim()&&String(_birth).trim()!=='-'){
    let _birthFmt=_birth;try{const _bd=new Date(_birth);if(!isNaN(_bd.getTime()))_birthFmt=_bd.getFullYear()+'년 '+(_bd.getMonth()+1)+'월 '+_bd.getDate()+'일';}catch(e){}
    h+='<span data-birth-tip="'+escHtml(_birthFmt)+'" data-tooltip="생년월일입니다. '+escHtml(_birthFmt)+'" data-tooltip-instant="1" style="font-size:10px;font-weight:600;color:var(--t2);padding:2px 8px;border-radius:6px;background:var(--bg2);border:1px solid var(--bdr);cursor:default">🎂 '+escHtml(_birth)+'</span>';
  }
  /* 입실·퇴실 시간 칩 — 생년월일 오른편 (생년월일 없으면 그 자리). 클릭 시 시계 픽커 열림.
   * 입실 변경 시 퇴실 자동 재계산 (openTimePicker 안에서 처리), 사용자가 퇴실 수동 수정도 가능.
   * 사후 기록 시 사용자가 입실 시각을 곧바로 보고 수정할 수 있도록 화면에 명시 표시. */
  {
    const _tIn  = rec.timeIn  || '-';
    const _tOut = rec.timeOut || '-';
    h+='<span class="sym-time-chip" data-action="openSymTimePicker" data-field="timeIn" data-rec-id="'+recId+'" '
      +'data-tooltip="입실 시간 - 클릭하여 직접 수정 가능합니다." data-tooltip-instant="1" '
      +'style="font-size:10px;font-weight:700;color:var(--cyan);padding:2px 8px;border-radius:6px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.25);cursor:pointer;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif;letter-spacing:0.3px">🕐 입실 '+escHtml(_tIn)+'</span>';
    h+='<span class="sym-time-chip" data-action="openSymTimePicker" data-field="timeOut" data-rec-id="'+recId+'" '
      +'data-tooltip="퇴실 시간 - 클릭하여 직접 수정 가능합니다." data-tooltip-instant="1" '
      +'style="font-size:10px;font-weight:700;color:var(--t2);padding:2px 8px;border-radius:6px;background:var(--bg2);border:1px solid var(--bdr);cursor:pointer;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif;letter-spacing:0.3px">🕓 퇴실 '+escHtml(_tOut)+'</span>';
  }
  h+='</div>';
  /* 3행: 정보 칩들. 순서 (사용자 지정 2026-06-12 — 3층 구조 개편):
   *   바디맵 이력 | 과거 방문 이력 | V/S 측정 이력 | 상담 이력 | 요보호 | 미세먼지 기저질환
   *   | 일반의약품 동의 | 응급처치 동의 | (VIP) */
  h+='<div id="symChipRow" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px">'
    /* 바디맵 이력 — 신규 입력은 중분류 증상 칩의 🧍 에서. 여기는 조회 전용.
     * 툴팁은 부위명 나열 대신 건수 안내로 통일 — 과거 방문 이력 칩과 동일 문구 패턴 (사용자 요청 2026-06-12). */
    +(function(){
      const _hdrBmTip=_bmHistCount>0
        ? '과거 '+_bmHistCount+'건의 바디맵 입력 내역이 있습니다.'
        : '과거 바디맵 입력 이력을 봅니다. 신규 입력은 중분류 증상 칩의 🧍에서 진행하세요.';
      return '<button class="sym-hdr-chip" data-tooltip="'+escHtml(_hdrBmTip)+'" data-tooltip-instant="1" data-action="openBmHistory" data-stu-id="'+rec.studentId+'" data-rec-id="'+recId+'" style="padding:2px 8px;font-size:10px;font-weight:700;color:'+(_bmHistCount>0?'var(--cyan)':'#a855f7')+';background:'+(_bmHistCount>0?'rgba(6,182,212,0.08)':'rgba(168,85,247,0.08)')+';border:1px solid '+(_bmHistCount>0?'rgba(6,182,212,0.3)':'rgba(168,85,247,0.15)')+';border-radius:6px;cursor:pointer;font-family:var(--f)">📚 바디맵 이력'+(_bmHistCount>0?' ('+_bmHistCount+')':'')+'</button>';
    })()
    /* 과거 방문 이력 */
    +'<button class="sym-hdr-chip" data-tooltip="과거 '+_visitCnt+'건의 방문 내역이 있습니다." data-tooltip-instant="1" data-action="showHistory" data-stu-id="'+rec.studentId+'" data-rec-id="'+recId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_visitCnt>0?'rgba(34,197,94,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_visitCnt>0?'rgba(34,197,94,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_visitCnt>0?'#22c55e':'#94a3b8')+';cursor:pointer;font-family:var(--f)">📅 과거 방문 이력'+(_visitCnt>0?' ('+_visitCnt+')':'')+'</button>'
    /* V/S 측정 이력 (구 V/S 이력) — 체온·맥박·혈압·호흡·SpO₂·혈당 시간순 꺾은선 그래프 */
    +'<button class="sym-hdr-chip" data-tooltip="과거 '+_vsHistCount+'건의 V/S 측정 이력 그래프(체온·맥박·혈압·호흡·SpO₂·혈당)" data-tooltip-instant="1" data-action="showVsTimeline" data-stu-id="'+rec.studentId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_vsHistCount>0?'rgba(59,130,246,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_vsHistCount>0?'rgba(59,130,246,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_vsHistCount>0?'#3b82f6':'#94a3b8')+';cursor:pointer;font-family:var(--f)">📈 V/S 측정 이력'+(_vsHistCount>0?' ('+_vsHistCount+')':'')+'</button>'
    /* 상담 이력 — counselLog 가 기록된 과거 방문 수. 이력 있으면 연분홍, 없으면 회색 (사용자 요청 2026-06-12) */
    +(function(){
      const _clCnt=_symCounselCount(rec.studentId);
      return '<button class="sym-hdr-chip" data-tooltip="'+(_clCnt>0?('과거 '+_clCnt+'건의 상담 내역이 있습니다. 클릭하면 주제별로 열람할 수 있습니다.'):'상담 내역이 없습니다.')+'" data-tooltip-instant="1" data-action="openCounselHist" data-stu-id="'+rec.studentId+'" data-rec-id="'+recId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_clCnt>0?'rgba(244,114,182,0.35)':'rgba(148,163,184,0.2)')+';background:'+(_clCnt>0?'rgba(244,114,182,0.10)':'rgba(148,163,184,0.06)')+';color:'+(_clCnt>0?'#f472b6':'#94a3b8')+';cursor:pointer;font-family:var(--f)">💬 상담 이력'+(_clCnt>0?' ('+_clCnt+')':'')+'</button>';
    })()
    /* 요보호 */
    +'<span class="sym-hdr-chip" data-action="showCareInfo" data-stu-id="'+rec.studentId+'" data-tooltip="'+(_isCare?escHtml(_yrPfx+(stu.condition||stu.careMemo||'요보호 등록됨')):'요보호 대상자가 아닙니다.')+'" data-tooltip-instant="1" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_isCare?'rgba(202,138,4,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_isCare?'rgba(202,138,4,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_isCare?'#ca8a04':'#94a3b8')+';cursor:pointer">🛡 요보호</span>'
    /* 미세먼지 기저질환 */
    +'<span class="sym-hdr-chip" data-action="showDustInfo" data-stu-id="'+rec.studentId+'" data-tooltip="'+(_isDustBase?escHtml(_yrPfx+_dustBaseVal):'미세먼지 기저질환 미등록')+'" data-tooltip-instant="1" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_isDustBase?'rgba(249,115,22,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_isDustBase?'rgba(249,115,22,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_isDustBase?'#f97316':'#94a3b8')+';cursor:pointer">🌫 미세먼지 기저질환</span>'
    /* 일반의약품 동의/비동의 */
    +'<span class="sym-hdr-chip" data-action="showMedConsentInfo" data-stu-id="'+rec.studentId+'" data-tooltip="'+(_yrPfx+(_isMedN?'비동의':'동의'))+'" data-tooltip-instant="1" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_isMedN?'rgba(239,68,68,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_isMedN?'rgba(239,68,68,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_isMedN?'#ef4444':'#94a3b8')+';cursor:pointer">💊 일반의약품 '+(_isMedN?'비동의':'동의')+'</span>'
    /* 응급처치 동의/비동의 */
    +'<span class="sym-hdr-chip" data-action="showEcConsentInfo" data-stu-id="'+rec.studentId+'" data-tooltip="'+(_yrPfx+(_isEcN?'비동의':'동의'))+'" data-tooltip-instant="1" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_isEcN?'rgba(239,68,68,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_isEcN?'rgba(239,68,68,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_isEcN?'#ef4444':'#94a3b8')+';cursor:pointer">🚑 응급처치 '+(_isEcN?'비동의':'동의')+'</span>'
    /* VIP — 조건부 (있을 때만) */
    +(_hasVip?'<span class="sym-hdr-chip" data-tooltip="'+escHtml(S._vipTags.map(function(v){return '★ '+v.text;}).join(', '))+'" data-tooltip-instant="1" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid rgba(234,179,8,0.3);background:rgba(234,179,8,0.08);color:#eab308">★ VIP</span>':'')
    +'</div>';
  /* 4행 (사용자 요청 2026-06-12 — 3층 구조): 주의사항(메모) | 물품 대여 | 커스텀 양식 | 병원 찾기 | 구급대 메시지 */
  h+='<div id="symChipRow2" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px">'
    /* 주의사항(메모) */
    +'<button class="sym-hdr-chip" data-tooltip="'+(_memoCnt>0?_memoCnt+'건의 주의사항(메모)가 있습니다.':'클릭하면 주의사항 메모를 작성할 수 있습니다.')+'" data-tooltip-instant="1" data-action="openMemo" data-stu-id="'+rec.studentId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_memoCnt>0?'rgba(6,182,212,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_memoCnt>0?'rgba(6,182,212,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_memoCnt>0?'var(--cyan)':'#94a3b8')+';cursor:pointer;font-family:var(--f)">📝 주의사항(메모)'+(_memoCnt>0?' ('+_memoCnt+')':'')+'</button>'
    /* 물품 대여 — 클릭 시 물품 대여 대장 팝업 (대여자 자동 입력) */
    +'<button class="sym-hdr-chip" data-tooltip="'+(_rentalCnt>0?_rentalCnt+'건의 미반납 대여 물품이 있습니다.':'클릭하면 보건실 물품을 대여 등록할 수 있습니다.')+'" data-tooltip-instant="1" data-action="openRentalFromSymptom" data-stu-id="'+rec.studentId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid '+(_rentalCnt>0?'rgba(6,182,212,0.3)':'rgba(148,163,184,0.2)')+';background:'+(_rentalCnt>0?'rgba(6,182,212,0.08)':'rgba(148,163,184,0.06)')+';color:'+(_rentalCnt>0?'var(--cyan)':'#94a3b8')+';cursor:pointer;font-family:var(--f)">📦 물품 대여'+(_rentalCnt>0?' ('+_rentalCnt+')':'')+'</button>'
    /* 커스텀 양식 — 이 방문자를 선택한 상태로 커스텀 양식 출력 팝업을 증상 팝업 위에 띄움 (2026-06-12) */
    +'<button class="sym-hdr-chip" data-tooltip="이 방문자를 선택한 상태로 커스텀 양식 출력(방문확인증 등)을 엽니다." data-tooltip-instant="1" data-action="openVpFromSymptom" data-rec-id="'+recId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.08);color:#6366f1;cursor:pointer;font-family:var(--f)">🖨 커스텀 양식</button>'
    /* 병원 찾기 + 구급대 메시지 — 커스텀 양식 오른편 (2행에서 이동, 2026-06-12) */
    +'<button class="sym-hdr-chip" data-tooltip="학교 인근 병원, 약국, 응급실을 검색합니다." data-tooltip-instant="1" data-action="openMedFacility" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.08);color:#d97706;cursor:pointer;font-family:var(--f)">🗺️ 병원 찾기</button>'
    +'<button class="sym-hdr-chip" data-tooltip="구급대에게 보낼 메시지를 작성합니다." data-tooltip-instant="1" data-action="openEmsMsg" data-stu-id="'+rec.studentId+'" data-rec-id="'+recId+'" style="padding:2px 8px;font-size:10px;font-weight:700;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#dc2626;cursor:pointer;font-family:var(--f)">🚑 구급대 메시지</button>'
    +'</div>';
  /* 증상 빠른 검색 — 중분류 증상 초성/부분일치 검색 → 선택 시 상분류·중분류 즉시 이동 (사용자 요청 2026-08-06) */
  h+='<div id="symQuickSearchRow" style="position:relative;margin-top:8px">'
    +'<input id="symQuickSearchInput" type="text" autocomplete="off" spellcheck="false" placeholder="증상을 입력해 등록된 증상을 찾습니다" style="width:100%;box-sizing:border-box;font-size:12px;padding:7px 11px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);color:var(--t1);font-family:var(--f);outline:none">'
    +'<div id="symQuickSearchList" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:3px;max-height:264px;overflow-y:auto;background:var(--card);border:1px solid var(--bdr);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.28);z-index:30;scrollbar-width:thin"></div>'
    +'</div>';
  h+='</div>';  /* header 종료 */
  /* 본문: 3패널 */
  h+='<div style="flex:1;display:flex;min-height:0;overflow:hidden">';
  /* 1패널: 카테고리 */
  h+='<div style="width:180px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--bdr);scrollbar-width:thin;background:var(--bg2)" id="symCatList">';
  /* 유효 상분류 — 사용자 이름변경·추가·가림·순서 반영 (2026-06-12) */
  getEffectiveSymCats(false).forEach(function(cat,ci){
    /* 잠금 모드(_symLockCategory): 그 분류만 활성, 나머지는 흐리게 + 클릭 비활성 (사용자 요청 2026-06-13) */
    const _locked=_symLockCategory && cat.id!==_symLockCategory;
    h+='<div class="sym-cat-item'+(_locked?' sym-cat-locked':'')+'" data-cat="'+cat.id+'"'+(_locked?'':' data-action="selectCat"')+' style="padding:9px 10px;cursor:'+(_locked?'not-allowed':'pointer')+';transition:all .15s;border-left:3px solid transparent;font-size:11px;display:flex;align-items:center;gap:6px;position:relative'+(_locked?';opacity:0.38;pointer-events:none':'')+'">';
    /* 화살표 자리(▶) — 항상 width 12px 확보, visibility 만 토글 (배지 위치 고정 위해) */
    h+='<span style="font-size:15px">'+cat.icon+'</span><span style="font-weight:600;color:var(--t2);line-height:1.3;flex:1">'+cat.name+'</span><span class="sym-cat-arrow" style="visibility:hidden;display:inline-block;width:12px;text-align:right;color:var(--cyan);font-size:10px;flex-shrink:0">▶</span></div>';
  });
  h+='</div>';
  /* 2패널: 증상 목록 — 가로 240px 로 확대 (사용자 요청: 칩 글자가 2층 분리 안되게) */
  h+='<div style="width:240px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--bdr);scrollbar-width:thin;padding:8px" id="symSymList">';
  h+='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">← 카테고리를 선택하세요</div>';
  h+='</div>';
  /* 3패널: 처치 */
  h+='<div style="flex:1;overflow-y:auto;scrollbar-width:thin;padding:12px;display:flex;flex-direction:column" id="symTreatPanel">';
  h+='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">증상을 선택하면 처치를 입력할 수 있습니다</div>';
  h+='</div>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('mousedown',function(e){
    if(e.target===ov){
      /* 바디맵/투약/설정 모달이 열려있으면 증상 팝업은 닫지 않음 */
      if(document.getElementById('bmOverlay'))return;
      if(document.getElementById('symMedPopup'))return;
      const _setOv=document.getElementById('settingsModal');
      if(_setOv&&_setOv.classList.contains('show'))return;
      /* 병원 찾기 / 외부 창에서 main 으로 포커스 복귀한 직후 mousedown 은 무시.
       * 사용자 보고: 병원 찾기 창 외부 클릭 시 증상 팝업도 같이 닫히는 문제.
       * 외부창에서 main 으로 돌아온 클릭은 popup 닫기 의도가 아니므로 200ms 디바운스. */
      if(window._symFocusJustReturned)return;
      /* 사이드바 가로 영역 안의 클릭은 닫지 않음 — 사용자가 최근 보건실 방문이력 카드를 클릭했는데,
       *  카드 본문이 짧아 카드 아래 빈 공간(실제론 ov 영역) 까지 클릭한 경우 팝업이 의도치 않게 닫히지 않도록.
       *  사이드바는 본래 z:9550 으로 ov 위에 있어 카드 위 직접 클릭은 사이드바가 target 이 되어 이미 통과되지만,
       *  카드 아래/사이드바 컬럼의 빈 공간은 ov 가 target 이라 추가 가드가 필요. (사용자 요청 2026-05-19) */
      const _sb=document.querySelector('.sidebar');
      if(_sb){
        const _r=_sb.getBoundingClientRect();
        if(e.clientX>=_r.left && e.clientX<=_r.right)return;
      }
      _symComplete();return;
    }
    e.stopPropagation();
  });
  ov.addEventListener('click',function(e){e.stopPropagation();});
  document.body.appendChild(ov);
  /* 증상 선택 및 처치 팝업 전역 미니 팝업 위임 — 카테고리 패널·처치 패널·헤더 칩 등 모든 자식 요소의
   * data-tooltip 호버를 통일된 GUI(showHeaderTooltip) 로 처리. (2026-05-20 통합) */
  _symBindTipDelegation(ov);
  /* 사용자 요청 (2026-05-19) — 증상 팝업 열린 동안 좌측 사이드바를 ov(z:9500) 위로 끌어올려
     "최근 보건실 방문 이력"에서 마우스 휠 스크롤로 과거 이력 열람 가능하게.
     ov 외부 클릭으로 팝업이 닫히는 정책은 그대로 유지 (사이드바 영역은 클릭이 사이드바로 흡수되어 닫기 미발생 — 의도된 동작).
     ov 가 DOM 에서 사라지면 자동으로 body 클래스 해제. */
  document.body.classList.add('sym-popup-open');
  /* visitHistoryBody 영역 위에서 휠을 굴리면 그쪽 scrollTop 을 직접 변경 — 증상 팝업이 떠있는 동안
     z-index/stacking context 영향으로 휠이 카드까지 안 전달되는 케이스를 강제 우회.
     좌표가 visitHistoryBody 안일 때만 작동. (사용자 요청 2026-05-19) */
  const _symVhWheel = function(e){
    const vhBody=document.getElementById('visitHistoryBody');
    if(!vhBody)return;
    if(vhBody.offsetParent===null)return; /* 숨김 상태 */
    const r=vhBody.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
    vhBody.scrollTop+=e.deltaY;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('wheel', _symVhWheel, {passive:false, capture:true});
  const _symOvWatcher = new MutationObserver(function(){
    if(!document.getElementById('symCatOverlay')){
      document.body.classList.remove('sym-popup-open');
      document.removeEventListener('wheel', _symVhWheel, {capture:true});
      /* 협업 편집 잠금 해제 — 팝업이 완전히 닫혔을 때만(교체 시엔 새 overlay 가 있어 이 분기 미진입). (2026-06-07) */
      try{ releaseEditLock(); }catch(_lk){}
      _symOvWatcher.disconnect();
    }
  });
  _symOvWatcher.observe(document.body,{childList:true});
  /* symSymList stopPropagation (대체: inline onclick 제거) */
  const _symSymListEl=document.getElementById('symSymList');
  if(_symSymListEl)_symSymListEl.addEventListener('click',function(e){e.stopPropagation();});
  /* 헤더 칩 이벤트 위임.
   *
   * #symStuRow (2행: 학생 정보 + 🗺️ 병원찾기 + 🚑 구급대 메시지)
   * #symChipRow (3행: 바디맵 이력 / 방문 이력 / V/S / 요보호 / VIP 등)
   *
   * 두 행은 부모가 동일 (header div) 이라 부모 위임으로 가도 되지만,
   * 변경 폭 최소화를 위해 같은 dispatcher 를 두 row 모두에 부착.
   * (과거 병원찾기·구급대 버튼이 #symStuRow 로 이동했을 때 핸들러 추가가 누락돼 클릭이 안 잡히던 회귀 fix) */
  /* 상태 칩(요보호·미세먼지 기저질환·일반의약품/응급처치 동의) 클릭 → 정보 미니 모달 (사용자 요청 2026-06-18).
   *  과거엔 data-action 이 없어 전역 팝업 드래그에 가로채여 grab 커서·팝업 이동만 됐음. 이제 data-action 부여 +
   *  전역 드래그가 [data-action] 을 제외하도록 하여 드래그 없이 클릭 모달이 뜬다. */
  async function _symStatusInfoModal(kind, stuId){
    const stu = getStu(stuId);
    if(!stu) return;
    const _titleMap={ care:'🛡 요보호', dust:'🌫 미세먼지 기저질환', med:'💊 일반의약품 동의 여부', ec:'🚑 응급처치 동의 여부' };
    const _label=_symFullStuLabel(stu);   /* 학교급(여러개)+학과+학년반번+이름 (사용자 요청 2026-06-18) */
    const title=(_titleMap[kind]||'')+(_label?' — '+escHtml(_label):'');
    /* 요보호·미세먼지 기저질환 정보 모달은 버튼 없이 배경 클릭/ESC 로만 닫음 (사용자 요청 2026-06-24). 동의(med/ec)는 기존 확인 버튼 유지 */
    const _okOpt = (kind==='care'||kind==='dust')
      ? { noButtons:true, width:'460px' }
      : { okOnly:true, okLabel:'확인', okBg:'rgba(6,182,212,0.12)', okBorder:'rgba(6,182,212,0.35)', okColor:'#0e7490', width:'460px' };
    /* 요보호·미세먼지 기저질환·동의는 매년 누적 추적 → 전 학년도 students_info 이력을 표로 (사용자 요청 2026-06-18). */
    let rows=[];
    try{
      const uid = stu.uid || stuId;
      if(window.electronAPI && window.electronAPI.studentsGetHistory){
        const res = await window.electronAPI.studentsGetHistory(uid);
        if(res && res.success && Array.isArray(res.data)) rows = res.data;
      }
    }catch(_){}
    /* 이력 조회 실패 시 현재 정보 1행으로 폴백 (항상 무언가 보이게) */
    if(!rows.length){
      rows = [{ school_year:'현재', is_care:(stu.status==='caution'||stu.status==='watch'||stu.is_care===1||stu.is_care==='1')?1:0,
        care_reason:stu.condition||stu.care_reason||'', care_memo:stu.careMemo||stu.care_memo||'',
        dust_disease:stu.dust_disease||stu.dustDisease||'', med_consent:stu.medConsent||stu.med_consent||'Y',
        emergency_consent:stu.emergencyConsent||stu.emergency_consent||'Y' }];
    }
    /* 학년도 오름차순(옛→최근) */
    rows = rows.slice().sort(function(a,b){ return String(a.school_year||'').localeCompare(String(b.school_year||'')); });
    const _cellFor = function(r){
      if(kind==='care'){
        const detail=[String(r.care_reason||'').trim(), String(r.care_memo||'').trim()].filter(Boolean).join(' / ');
        const on=(r.is_care===1||r.is_care==='1')||!!detail;
        return on ? ('<b style="color:#ca8a04">요보호</b>'+(detail?' — '+escHtml(detail):'')) : '<span style="color:var(--t3)">대상 아님</span>';
      } else if(kind==='dust'){
        const d=String(r.dust_disease||'').trim();
        return d ? ('<b style="color:#f97316">'+escHtml(d)+'</b>') : '<span style="color:var(--t3)">등록된 기저질환 없음</span>';
      } else if(kind==='med'){
        return (r.med_consent==='N') ? '<b style="color:#dc2626">비동의</b>' : '<b style="color:#0e7490">동의</b>';
      } else {
        return (r.emergency_consent==='N') ? '<b style="color:#dc2626">비동의</b>' : '<b style="color:#0e7490">동의</b>';
      }
    };
    let trs='';
    rows.forEach(function(r){
      const _yr=String(r.school_year||''); const _yLabel=/^\d+$/.test(_yr)?(_yr+'학년도'):escHtml(_yr);
      trs += '<tr><td style="padding:6px 10px;border-bottom:1px solid var(--bdrl);white-space:nowrap;font-weight:700;color:var(--t2)">'+_yLabel+'</td>'
           + '<td style="padding:6px 10px;border-bottom:1px solid var(--bdrl);color:var(--t1)">'+_cellFor(r)+'</td></tr>';
    });
    const msg = '<div style="font-size:11px;color:var(--t3);margin-bottom:8px">학년도별 누적 기록입니다.</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'
      + '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid var(--bdr);color:var(--t2);font-size:10.5px;width:96px">학년도</th>'
      + '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid var(--bdr);color:var(--t2);font-size:10.5px">내용</th>'
      + '</tr></thead><tbody>'+trs+'</tbody></table>';
    try{ appConfirmModal(msg, title, _okOpt); }catch(_){}
  }
  function _symHeaderChipDispatch(e){
    const btn=e.target.closest('[data-action]');if(!btn)return;
    const action=btn.dataset.action;
    if(action==='openBodyMap'){openBodyMap(parseInt(btn.dataset.recId));}
    else if(action==='openBmHistory'){_symOpenBmHistory(btn.dataset.stuId,parseInt(btn.dataset.recId));}
    else if(action==='openMemo'){_symOpenMemoPopup(btn.dataset.stuId);}
    else if(action==='openRentalFromSymptom'){_symOpenRentalFromChip(btn);}
    else if(action==='showHistory'){_symShowHistory(btn.dataset.stuId,parseInt(btn.dataset.recId));}
    else if(action==='showVsTimeline'){_symShowVsTimeline(btn.dataset.stuId);}
    else if(action==='openCounselHist'){_symOpenCounselHistModal(btn.dataset.stuId,parseInt(btn.dataset.recId));}
    else if(action==='openVpFromSymptom'){
      /* 커스텀 양식 출력을 증상 팝업(z:9500) 위로 — vpOverlay 기본 z:3000 을 일시 상향, 닫히면 원복.
       * vpOverlay 배경 클릭은 vp 만 닫고(이벤트가 증상 ov 까지 안 감) 증상 팝업은 유지된다. (2026-06-12) */
      const _vpRid=parseInt(btn.dataset.recId);
      const _vpOv=document.getElementById('vpOverlay');
      if(_vpOv){
        _vpOv.style.zIndex='10800';
        const _vpWatch=new MutationObserver(function(){
          if(!_vpOv.classList.contains('show')){_vpOv.style.zIndex='';_vpWatch.disconnect();}
        });
        _vpWatch.observe(_vpOv,{attributes:true,attributeFilter:['class']});
      }
      import('../visit-pass/visit-pass-view.js').then(function(m){
        if(m&&typeof m.openVisitPass==='function')m.openVisitPass(_vpRid);
      }).catch(function(err){console.error('[symptom] visit-pass 모듈 로드 실패',err);});
    }
    else if(action==='openMedFacility'){
      const _cu=S._currentUser||{};
      const sn=_cu.school_name||S.settings.schoolName||'';
      const eo=_cu.edu_office||S.settings.eduOffice||'';
      const kakaoRest=localStorage.getItem('ec_kakao_rest_api_key')||'';
      const kakaoJs=localStorage.getItem('ec_kakao_js_api_key')||'';
      /* 웹 클라이언트(동료 PC) 는 카드리스트(SDK 미사용)+서버 blob 폴백 → 가드 우회.
       * 데스크탑(호스트) 만 SDK 가 필요해서 두 키 모두 강제. */
      if(!window.__isWebBrowser && (!kakaoRest||!kakaoJs)){
        alert('카카오 개발자 API 키가 등록되지 않았습니다.\n설정 → API Key 관리 → 카카오 개발자 API 에서 REST API 키와 JavaScript 키를 먼저 등록해 주세요.');
        return;
      }
      if(window.electronAPI&&window.electronAPI.openMedFacility){
        const _schAddr=localStorage.getItem('ec_school_address')||'';
        const _schLat=localStorage.getItem('ec_school_lat')||'';
        const _schLng=localStorage.getItem('ec_school_lng')||'';
        window.electronAPI.openMedFacility(sn,eo,localStorage.getItem('ec_hira_api_key')||'',localStorage.getItem('ec_emergency_api_key')||'',_schAddr,undefined,kakaoRest,kakaoJs,_schLat,_schLng);
      }
    }
    else if(action==='openEmsMsg'){_symOpenEmsMsg(btn.dataset.stuId,parseInt(btn.dataset.recId));}
    else if(action==='openVs'){const _vb=btn.closest('.sym-block-pair');_symOpenVsPopup(parseInt(btn.dataset.recId),btn,_vb?_vb.dataset.symKey:undefined);}
    else if(action==='openPhysAssess'){try{const _pb=btn.closest('.sym-block-pair');_symOpenPhysAssessPopup(parseInt(btn.dataset.recId),btn,_pb?_pb.dataset.symKey:undefined);}catch(_e){try{bus.emit('toast:show',{text:'신체사정 오류: '+(_e&&_e.message||_e)});}catch(_){}console.error('[신체사정]',_e);}}
    else if(action==='openSymTimePicker'){
      /* 입실·퇴실 시간 칩 클릭 → 시계 픽커 열기 (record.timeIn 또는 timeOut 수정).
       * 변경 시 record 즉시 갱신 + 일지 표 자동 재렌더 (openTimePicker 의 hidden input 이벤트가 처리). */
      const _rid = parseInt(btn.dataset.recId);
      const _field = btn.dataset.field;
      if(_rid && _field && typeof openTimePicker === 'function'){
        openTimePicker(_rid, _field, btn);
      }
    }
    else if(action==='showCareInfo'){ _symStatusInfoModal('care', btn.dataset.stuId); }
    else if(action==='showDustInfo'){ _symStatusInfoModal('dust', btn.dataset.stuId); }
    else if(action==='showMedConsentInfo'){ _symStatusInfoModal('med', btn.dataset.stuId); }
    else if(action==='showEcConsentInfo'){ _symStatusInfoModal('ec', btn.dataset.stuId); }
  }
  const _symStuRowEl=document.getElementById('symStuRow');
  if(_symStuRowEl)_symStuRowEl.addEventListener('click',_symHeaderChipDispatch);
  const _symChipRow=document.getElementById('symChipRow');
  if(_symChipRow)_symChipRow.addEventListener('click',_symHeaderChipDispatch);
  const _symChipRow2=document.getElementById('symChipRow2');
  if(_symChipRow2)_symChipRow2.addEventListener('click',_symHeaderChipDispatch);
  /* 카테고리 리스트 이벤트 위임 */
  const _symCatListEl=document.getElementById('symCatList');
  if(_symCatListEl){
    _symCatListEl.addEventListener('click',function(e){
      const item=e.target.closest('[data-action="selectCat"]');if(!item)return;
      _symSelectCat(item.dataset.cat);
    });
    _symCatListEl.addEventListener('mouseenter',function(e){
      const item=e.target.closest('.sym-cat-item');if(!item)return;
      if(!item.style.borderLeftColor||item.style.borderLeftColor==='transparent')item.style.background='rgba(6,182,212,0.04)';
    },true);
    _symCatListEl.addEventListener('mouseleave',function(e){
      const item=e.target.closest('.sym-cat-item');if(!item)return;
      if(!item.style.borderLeftColor||item.style.borderLeftColor==='transparent')item.style.background='';
    },true);
  }
  /* 헤더 칩 애니메이션 미니 팝업 (title 대신 data-tip) */
  _symBindChipTooltips(ov);
  /* 전 학년도 인별 상담 기록 프리페치 → 회차·상담 이력 칩이 과거 학년도까지 누적 반영 (2026-06-14) */
  try{ _symPrefetchCounselHist(rec.studentId||rec.personUid); }catch(_){}
  /* 잠금 모드면 그 분류를 강제 선택 (상담실적 행 클릭 — 상담 분류 고정, 2026-06-13) */
  if(_symLockCategory){
    _symSelectCat(_symLockCategory);
    _symRenderTreatPanel();
  } else if(_symSelectedSymptoms.length>0){
    /* 선택된 증상이 속한 첫 카테고리를 찾아 선택 — 유효 분류(사용자 추가 증상 포함) 기준 (2026-06-12) */
    const _effCats=getEffectiveSymCats(false);
    let _usAll={};try{_usAll=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');}catch(_){}
    const _firstCat=_effCats.find(function(c){
      const syms=(c.symptoms||[]).concat(_usAll[c.id]||[]);
      return syms.some(function(s){return _symSelectedSymptoms.indexOf(s)!==-1;});
    });
    if(_firstCat||_effCats.length)_symSelectCat((_firstCat||_effCats[0]).id);
    _symRenderTreatPanel();
  } else {
    /* 카테고리 미선택 — 안내 메시지 */
    const _emptyPanel=document.getElementById('symSymList');
    if(_emptyPanel)_emptyPanel.innerHTML='<div style="padding:30px 12px;text-align:center;color:var(--t3);font-size:11px">왼쪽에서 카테고리를 선택하세요.</div>';
  }
  /* 열기 애니메이션 */
  const _symBox=document.getElementById('symCatBox');
  if(_symBox){_symBox.style.opacity='0';_symBox.style.transform='scale(0.95)';
    requestAnimationFrame(function(){_symBox.style.transition='opacity 0.2s ease, transform 0.2s ease';_symBox.style.opacity='1';_symBox.style.transform='scale(1)';});}
  /* 키보드 네비게이션 */
  let _skFocus='cat'; /* cat, sym, treatSym, treatInput, treat */
  let _skCatIdx=-1, _skSymIdx=-1, _skTreatSymIdx=-1, _skTreatIdx=-1, _skSymIconIdx=-1;
  function _skHighlight(){
    if(_skFocus==='cat'){
      const items=document.querySelectorAll('#symCatList .sym-cat-item');
      items.forEach(function(el,i){el.style.outline=i===_skCatIdx?'2px solid var(--cyan)':'none';el.style.outlineOffset='-2px';});
    } else {
      document.querySelectorAll('#symCatList .sym-cat-item').forEach(function(el){el.style.outline='none';});
    }
    if(_skFocus==='sym'){
      const syms=document.querySelectorAll('#symSymList .sym-sel-chip');
      syms.forEach(function(el,i){el.style.outline=i===_skSymIdx?'2px solid var(--cyan)':'none';el.style.outlineOffset='-2px';});
      if(syms[_skSymIdx])syms[_skSymIdx].scrollIntoView({block:'nearest'});
    } else {
      document.querySelectorAll('#symSymList .sym-sel-chip').forEach(function(el){el.style.outline='none';});
    }
    /* 중분류 칩 아이콘(🧍/✏️) 포커스 — 'symIcon' (2026-06-09) */
    document.querySelectorAll('#symSymList .sym-bm-mark, #symSymList .sym-chip-pen').forEach(function(el){el.style.outline='none';});
    if(_skFocus==='symIcon'){
      const _syms2=document.querySelectorAll('#symSymList .sym-sel-chip');
      const _chip=_syms2[_skSymIdx];
      if(_chip){
        _chip.style.outline='2px solid var(--cyan)';_chip.style.outlineOffset='-2px';
        _chip.scrollIntoView({block:'nearest'});
        const _bm=_chip.querySelector('.sym-bm-mark'), _pen=_chip.querySelector('.sym-chip-pen');
        if(_bm){_bm.style.outline=(_skSymIconIdx===0)?'2px solid var(--cyan)':'none';_bm.style.outlineOffset='1px';}
        if(_pen){_pen.style.outline=(_skSymIconIdx===1)?'2px solid var(--cyan)':'none';_pen.style.outlineOffset='1px';}
      }
    }
    /* 처치 증상 칩 */
    const treatSymChips=document.querySelectorAll('#symTreatPanel > div:first-child .sym-sel-chip');
    if(_skFocus==='treatSym'){
      treatSymChips.forEach(function(el,i){el.style.outline=i===_skTreatSymIdx?'2px solid var(--cyan)':'none';el.style.outlineOffset='-2px';});
    } else {
      treatSymChips.forEach(function(el){el.style.outline='none';});
    }
    /* 처치 항목 */
    if(_skFocus==='treat'){
      const treats=document.querySelectorAll('#symTreatPanel .sym-sel-chip');
      /* treatSym 칩 제외 */
      const treatOnly=[];treats.forEach(function(el){if(!el.closest('#symTreatPanel > div:first-child'))treatOnly.push(el);});
      treatOnly.forEach(function(el,i){el.style.outline=i===_skTreatIdx?'2px solid var(--cyan)':'none';el.style.outlineOffset='-2px';});
      if(treatOnly[_skTreatIdx])treatOnly[_skTreatIdx].scrollIntoView({block:'nearest'});
    } else {
      document.querySelectorAll('#symTreatPanel .sym-sel-chip').forEach(function(el){if(!el.closest('#symTreatPanel > div:first-child'))el.style.outline='none';});
    }
  }
  const _symKeyNav=function(e){
    /* 텍스트 입력창(input/textarea/contenteditable) 안에서 좌·우 방향키는 캐럿 이동이 우선되어야 함.
     * 사용자 보고 2026-05-21 — 자유 기술 dock·증상 자유 기술 dock·메모 dock·투약 검색 input 등에서
     * ArrowLeft/Right 가 전역 핸들러의 preventDefault 로 캐럿이 안 움직이던 회귀 fix.
     * ArrowUp/Down 은 투약 팝업이 아이템 네비게이션용으로 사용하므로 그대로 통과시킴. */
    const _tg = e.target;
    const _isTxt = _tg && (_tg.tagName === 'INPUT' || _tg.tagName === 'TEXTAREA' || _tg.isContentEditable);
    /* 입력창 안에서 Tab 은 전역 네비(바디맵 등)로 가지 않게 양보 — 입력칸은 자체 keydown 으로 이동 처리. (2026-08-06) */
    if(_isTxt && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab')) return;
    /* 여러 줄 textarea(자유 기술 dock 등)에선 위·아래 방향키도 캐럿 줄이동이 우선 (사용자 보고 2026-05-30 — 두 줄 이상 시 ↑↓ 안 먹던 문제). */
    if(_tg && _tg.tagName === 'TEXTAREA' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if(document.getElementById('symMedPopup')){
      /* 투약 팝업 키보드 */
      const medItems=document.querySelectorAll('#symMedList>div');
      if(!medItems.length)return;
      let _mkIdx=-1;medItems.forEach(function(el,i){if(el.style.outline&&el.style.outline.indexOf('cyan')!==-1)_mkIdx=i;});
      if(e.key==='ArrowDown'){e.preventDefault();_mkIdx=Math.min(_mkIdx+1,medItems.length-1);medItems.forEach(function(el,i){el.style.outline=i===_mkIdx?'2px solid var(--cyan)':'none';el.style.outlineOffset='-2px';});medItems[_mkIdx].scrollIntoView({block:'nearest'});return;}
      if(e.key==='ArrowUp'){e.preventDefault();_mkIdx=Math.max(_mkIdx-1,0);medItems.forEach(function(el,i){el.style.outline=i===_mkIdx?'2px solid var(--cyan)':'none';el.style.outlineOffset='-2px';});medItems[_mkIdx].scrollIntoView({block:'nearest'});return;}
      if(e.key==='Enter'&&_mkIdx>=0){e.preventDefault();medItems[_mkIdx].click();return;}
      if(e.key==='Escape')return; /* 투약 팝업 자체 ESC 핸들러가 처리 */
      return;
    }
    if(!document.getElementById('symCatOverlay')){document.removeEventListener('keydown',_symKeyNav);return;}
    /* 바디맵(또는 바디맵 이력)이 열려 있으면 ESC 는 그 팝업만 닫고 증상 팝업은 유지. */
    if(e.key==='Escape' && (document.getElementById('bmOverlay')||document.getElementById('symBmHistOverlay'))){
      e.preventDefault();
      try{
        if(document.getElementById('bmOverlay') && typeof window._bmCloseAndRefresh==='function') window._bmCloseAndRefresh();
        else if(document.getElementById('bmOverlay')){const _o=document.getElementById('bmOverlay'); if(_o&&_o.parentNode)_o.parentNode.removeChild(_o);}
        if(document.getElementById('symBmHistOverlay'))_symCloseBmHistory();
      }catch(_){}
      return;
    }
    /* 증상 팝업 위에 떠 있는 자식 팝업(옵션 선택·미니 약품 픽커·옵션 3/5/복합 모달·약품 정보/검색·프롬프트)이 있으면
     *  ESC 는 그 자식 팝업이 스스로 닫도록 두고 증상 팝업은 닫지 않는다 (사용자 보고 2026-06-04). */
    if(e.key==='Escape' && (document.getElementById('symAddOptOverlay')||document.getElementById('symMiniDrugPick')||document.getElementById('symAddMixedOverlay')||document.getElementById('symAddNoMedOverlay')||document.getElementById('symAddCpxOverlay')||document.getElementById('drugInfoPopup')||document.getElementById('drugSearchOverlay')||document.getElementById('symPromptOverlay'))){
      return;
    }
    if(e.key==='Escape'){_symComplete();document.removeEventListener('keydown',_symKeyNav);return;}
    const catItems=document.querySelectorAll('#symCatList .sym-cat-item');
    const symItems=document.querySelectorAll('#symSymList .sym-sel-chip');
    const treatSymChips=document.querySelectorAll('#symTreatPanel > div:first-child .sym-sel-chip');
    const allTreatChips=document.querySelectorAll('#symTreatPanel .sym-sel-chip');
    const treatItems=[];allTreatChips.forEach(function(el){if(!el.closest('#symTreatPanel > div:first-child'))treatItems.push(el);});
    if(e.key==='ArrowDown'){
      e.preventDefault();
      if(_skFocus==='cat'){if(_skCatIdx<0){_skCatIdx=0;catItems.forEach(function(_el,_i){var _ar=_el.querySelector('.sym-cat-arrow');if(_ar&&_ar.style.visibility==='visible')_skCatIdx=_i;});}_skCatIdx=Math.min(_skCatIdx+1,catItems.length-1);if(catItems[_skCatIdx])_symSelectCat(catItems[_skCatIdx].dataset.cat);_skHighlight();}
      else if(_skFocus==='sym'){_skSymIdx=Math.min(_skSymIdx+1,symItems.length-1);_skHighlight();}
      else if(_skFocus==='symIcon'){_skSymIdx=Math.min(_skSymIdx+1,symItems.length-1);_skHighlight();}
      else if(_skFocus==='treatSym'){
        /* Phase 3a: symTreatInput 제거 → 증상 칩 → 처치 칩 직행 */
        _skFocus='treat';_skTreatIdx=0;_skTreatSymIdx=-1;_skHighlight();
      }
      else if(_skFocus==='treat'){_skTreatIdx=Math.min(_skTreatIdx+1,treatItems.length-1);_skHighlight();}
    } else if(e.key==='ArrowUp'){
      e.preventDefault();
      if(_skFocus==='cat'){if(_skCatIdx<0){_skCatIdx=0;catItems.forEach(function(_el,_i){var _ar=_el.querySelector('.sym-cat-arrow');if(_ar&&_ar.style.visibility==='visible')_skCatIdx=_i;});}_skCatIdx=Math.max(_skCatIdx-1,0);if(catItems[_skCatIdx])_symSelectCat(catItems[_skCatIdx].dataset.cat);_skHighlight();}
      else if(_skFocus==='sym'){_skSymIdx=Math.max(_skSymIdx-1,0);_skHighlight();}
      else if(_skFocus==='symIcon'){_skSymIdx=Math.max(_skSymIdx-1,0);_skHighlight();}
      else if(_skFocus==='treat'){
        if(_skTreatIdx<=0){
          /* Phase 3a: symTreatInput 제거 → 처치 첫 칩 → 증상 칩 마지막으로 직행 */
          _skFocus='treatSym';_skTreatIdx=-1;_skTreatSymIdx=Math.max(0,treatSymChips.length-1);_skHighlight();
        }
        else{_skTreatIdx--;_skHighlight();}
      }
      else if(_skFocus==='treatSym'){
        if(_skTreatSymIdx<=0){_skFocus='sym';_skTreatSymIdx=-1;_skHighlight();}
        else{_skTreatSymIdx--;_skHighlight();}
      }
    } else if(e.key==='ArrowRight'){
      e.preventDefault();
      if(_skFocus==='cat'){
        if(catItems[_skCatIdx])catItems[_skCatIdx].click();
        _skFocus='sym';_skSymIdx=0;_skHighlight();
      } else if(_skFocus==='sym'){
        /* 중분류 증상 → 그 칩의 🧍바디맵/✏️연필 아이콘 포커스 (사용자 요청 2026-06-09) */
        _skFocus='symIcon';_skSymIconIdx=0;_skHighlight();
      } else if(_skFocus==='symIcon'){
        if(_skSymIconIdx<1){_skSymIconIdx++;_skHighlight();}        /* 🧍 → ✏️ */
        else{_skFocus='treatSym';_skTreatSymIdx=0;_skSymIconIdx=-1;_skHighlight();} /* ✏️ 다음 → 처치 증상 칩 */
      } else if(_skFocus==='treatSym'){
        _skTreatSymIdx=Math.min(_skTreatSymIdx+1,treatSymChips.length-1);_skHighlight();
      }
    } else if(e.key==='ArrowLeft'){
      e.preventDefault();
      if(_skFocus==='treat'||_skFocus==='treatInput'){_skFocus='sym';_skTreatIdx=-1;_skHighlight();}
      else if(_skFocus==='treatSym'){
        if(_skTreatSymIdx<=0){_skFocus='sym';_skTreatSymIdx=-1;_skHighlight();}
        else{_skTreatSymIdx--;_skHighlight();}
      }
      else if(_skFocus==='symIcon'){
        if(_skSymIconIdx>0){_skSymIconIdx--;_skHighlight();}        /* ✏️ → 🧍 */
        else{_skFocus='sym';_skSymIconIdx=-1;_skHighlight();}       /* 🧍 이전 → 중분류 증상 칩 */
      }
      else if(_skFocus==='sym'){_skFocus='cat';_skSymIdx=-1;_skHighlight();}
    } else if(e.key==='Enter'){
      e.preventDefault();
      if(_skFocus==='cat'&&catItems[_skCatIdx]){catItems[_skCatIdx].click();_skFocus='sym';_skSymIdx=0;_skHighlight();}
      else if(_skFocus==='sym'&&symItems[_skSymIdx]){symItems[_skSymIdx].click();setTimeout(function(){_skHighlight();},50);}
      else if(_skFocus==='symIcon'&&symItems[_skSymIdx]){
        /* 🧍(idx 0)=바디맵 / ✏️(idx 1)=증상 메모 — 포커스된 아이콘 클릭 → 해당 모달 (2026-06-09) */
        const _ic=symItems[_skSymIdx].querySelector(_skSymIconIdx===0?'.sym-bm-mark':'.sym-chip-pen');
        if(_ic)_ic.click();
      }
      else if(_skFocus==='treatSym'&&treatSymChips[_skTreatSymIdx]){treatSymChips[_skTreatSymIdx].querySelector('.sym-chip-del').click();setTimeout(function(){_skTreatSymIdx=Math.min(_skTreatSymIdx,document.querySelectorAll('#symTreatPanel > div:first-child .sym-sel-chip').length-1);_skHighlight();},50);}
      else if(_skFocus==='treat'&&treatItems[_skTreatIdx]){treatItems[_skTreatIdx].click();setTimeout(function(){_skFocus='treat';_skHighlight();},50);}
    } else if(e.key==='Tab'){
      /* 중분류 증상 칩 포커스 상태에서 Tab → 그 칩 안의 🧍 (바디맵) 아이콘 클릭.
       * 사용자 요구: 키보드만으로 중분류 증상 → 바디맵 빠른 접근.
       * _symOpenBmForSym 이 자동으로 그 증상을 선택해주므로 클릭 1번 = 증상 선택 + 바디맵 열림. */
      if(_skFocus==='sym' && symItems[_skSymIdx]){
        const _bmIcon = symItems[_skSymIdx].querySelector('.sym-bm-mark');
        if(_bmIcon){ e.preventDefault(); _bmIcon.click(); }
      }
    }
  };
  document.addEventListener('keydown',_symKeyNav);
  /* 초기에는 키보드 포커스 하이라이트 없음 — 사용자가 ↓↑를 누르면 나타남 */
  /* 드래그 이동 */
  const box=document.getElementById('symCatBox');
  const headerEl=box?box.firstElementChild:null;
  if(box&&headerEl){
    headerEl.style.cursor='grab';headerEl.style.userSelect='none';
    const _dd={active:false,offX:0,offY:0};
    headerEl.addEventListener('mousedown',function(e){
      if(e.target.closest('button'))return;
      e.preventDefault();
      _dd.active=true;
      _dd.offX=e.clientX-box.offsetLeft;
      _dd.offY=e.clientY-box.offsetTop;
      headerEl.style.cursor='grabbing';
    });
    document.addEventListener('mousemove',function(e){
      if(!_dd.active)return;
      box.style.left=(e.clientX-_dd.offX)+'px';
      box.style.top=(e.clientY-_dd.offY)+'px';
    });
    document.addEventListener('mouseup',function(){
      if(_dd.active){_dd.active=false;headerEl.style.cursor='grab';}
    });
  }
  /* 증상 빠른 검색 바인딩 + 자동 포커스 (사용자 요청 2026-08-06) */
  try{ _symBindQuickSearch(ov); }catch(_){}
  /* 표(V/S·신체사정) 클릭으로 열린 경우 — 해당 입력 팝업을 이어서 자동으로 연다 (사용자 요청 2026-08-06).
   *  선택된 처치의 V/S 측정/신체사정 sub-action 칩을 클릭해 기존 경로(symKey 포함)를 재사용하고,
   *  칩을 못 찾으면 record-level 로 직접 연다. */
  /* 표 클릭으로 이어 열 입력 팝업 — 보관해둔 autoOpen 값을 소비(어느 호출이 팝업을 그렸든 실행됨). */
  if(_symPendingAutoOpen){
    const _ao=_symPendingAutoOpen; _symPendingAutoOpen=null;
    const _isPa=(_ao==='pa');
    setTimeout(function(){
      /* 위치 anchor — 처치 패널의 V/S 측정/신체사정 칩(원래 뜨던 위치)에 맞춘다. 없으면 헤더칩 폴백. */
      const _anchor=ov.querySelector(_isPa?'[data-sub-action="openPhysAssess"]':'[data-sub-action="openVs"]')||ov.querySelector('.sym-hdr-chip')||ov;
      try{
        if(_isPa) _symOpenPhysAssessPopup(recId, _anchor, undefined);
        else _symOpenVsPopup(recId, _anchor, undefined);
      }catch(e){ try{ console.error('[autoOpen] 입력 팝업 열기 실패:', e); }catch(_){} }
    }, 350);
  }
}

/* ── 증상 빠른 검색 (사용자 요청 2026-08-06) ──
 *  헤더 검색란: 중분류 증상 초성/부분일치 검색 → 방향키·클릭 선택 시 상분류로 이동하며 중분류 선택.
 *  검색 대상은 일반 상분류의 중분류만(상담 제외, 사용자 결정). */
const _SYM_QS_CHO=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
function _symQsChoOf(str){
  return String(str||'').split('').map(function(ch){
    const c=ch.charCodeAt(0);
    return (c>=0xAC00&&c<=0xD7A3)?_SYM_QS_CHO[Math.floor((c-0xAC00)/588)]:ch;
  }).join('');
}
function _symQsIsChoQuery(q){ return /^[ㄱ-ㅎ]+$/.test(q); }
/* 검색 인덱스 — 일반 상분류(상담 제외)의 중분류 증상 [{sym,catId,catName}] */
function _symQuickBuildIndex(){
  const out=[]; const seen={};
  try{
    getEffectiveSymCats(false).forEach(function(cat){
      if(!cat||cat.id==='counsel')return;
      (cat.symptoms||[]).forEach(function(s){
        if(!s)return; const _k=cat.id+'|'+s; if(seen[_k])return; seen[_k]=1;
        out.push({sym:s, catId:cat.id, catName:cat.name||cat.id});
      });
    });
  }catch(_){}
  return out;
}
function _symBindQuickSearch(ov){
  const inp=ov.querySelector('#symQuickSearchInput');
  const list=ov.querySelector('#symQuickSearchList');
  if(!inp||!list)return;
  const index=_symQuickBuildIndex();
  let _hi=-1, _cur=[];
  const _hide=function(){ list.style.display='none'; list.innerHTML=''; _hi=-1; _cur=[]; };
  const _render=function(){
    const q=String(inp.value||'').trim();
    if(!q){ _hide(); return; }
    const ql=q.toLowerCase(), isCho=_symQsIsChoQuery(q);
    const _startHit=function(it){ return String(it.sym).toLowerCase().indexOf(ql)===0 || (isCho&&_symQsChoOf(it.sym).indexOf(q)===0); };
    const matched=index.filter(function(it){
      const s=String(it.sym).toLowerCase();
      if(s.indexOf(ql)>=0)return true;
      if(isCho && _symQsChoOf(it.sym).indexOf(q)>=0)return true;
      return false;
    });
    matched.sort(function(a,b){
      const _sa=_startHit(a)?0:1, _sb=_startHit(b)?0:1;
      if(_sa!==_sb)return _sa-_sb;
      return String(a.sym).localeCompare(String(b.sym),'ko');
    });
    _cur=matched.slice(0,50); _hi=_cur.length?0:-1;
    if(!_cur.length){ list.innerHTML='<div style="padding:10px 12px;font-size:11px;color:var(--t3);text-align:center">일치하는 증상이 없습니다</div>'; list.style.display='block'; return; }
    list.innerHTML=_cur.map(function(it,i){
      return '<div class="sym-qs-item" data-qi="'+i+'" style="padding:7px 11px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;'+(i===_hi?'background:rgba(6,182,212,0.12)':'')+'">'
        +'<span style="color:var(--t3);font-size:10px;white-space:nowrap">'+escHtml(it.catName)+' ›</span>'
        +'<span style="color:var(--t1);font-weight:600">'+escHtml(it.sym)+'</span></div>';
    }).join('');
    list.style.display='block';
  };
  const _paint=function(){
    list.querySelectorAll('.sym-qs-item').forEach(function(el,i){ el.style.background=(i===_hi)?'rgba(6,182,212,0.12)':''; });
    const _sel=list.querySelector('.sym-qs-item[data-qi="'+_hi+'"]'); if(_sel&&_sel.scrollIntoView)try{_sel.scrollIntoView({block:'nearest'});}catch(_){}
  };
  const _pick=function(i){
    const it=_cur[i]; if(!it)return;
    _hide(); inp.value='';
    try{
      _symSelectCat(it.catId);   /* 상분류 이동 */
      if(typeof _symFindSymIdx==='function'){ if(_symFindSymIdx(it.sym)===-1)_symToggleSym(it.sym); }
      else _symToggleSym(it.sym);   /* 중분류 선택(이미 선택돼 있으면 유지) */
    }catch(_){}
    try{ inp.focus(); }catch(_){}
  };
  inp.addEventListener('input', _render);
  inp.addEventListener('keydown', function(e){
    if(list.style.display==='none') return;   /* 드롭다운 닫혀 있으면 팝업 기본 네비에 맡김 */
    if(e.key==='ArrowDown'){ e.preventDefault(); e.stopPropagation(); _hi=Math.min(_hi+1,_cur.length-1); _paint(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); _hi=Math.max(_hi-1,0); _paint(); }
    else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); if(_hi>=0)_pick(_hi); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); inp.value=''; _hide(); }
  });
  list.addEventListener('mousedown', function(e){
    const it=e.target.closest('.sym-qs-item'); if(!it)return;
    e.preventDefault(); _pick(parseInt(it.dataset.qi,10)||0);
  });
  /* 팝업이 뜨면 검색란에 커서 자동 포커스 */
  setTimeout(function(){ try{ inp.focus(); }catch(_){} }, 60);
}

/* ═══ 재사용 가능한 팝업 드래그 이동 함수 ═══ */
export function _makeDraggable(box){
  if(!box)return;
  const headerEl=box.querySelector('[class*="modal-header"]')||box.firstElementChild;
  if(!headerEl)return;
  /* auto-popup-drag.js 의 MutationObserver 가 같은 박스에 중복 적용하지 않도록 마커 부착.
   * 마커 없으면 auto-drag 가 pop.firstElementChild(제목줄) 를 별개 박스로 인식해 _normalize 에서
   * position:fixed 로 띄워버려, 제목줄이 flex flow 에서 빠지고 검색줄이 위로 올라오는 버그 발생. */
  box._autoDragApplied=true;
  headerEl._autoDragApplied=true;
  headerEl.style.cursor='grab';headerEl.style.userSelect='none';

  /* transform:translate 기반 드래그 — flex 중앙정렬은 그대로 두고 box 만 상대 이동.
   * position:fixed 전환·left/top 재계산이 없어 어떠한 튐도 발생하지 않음. zoom 도 자동 보정됨. */
  function _getZoom(){
    try { if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) return window.ecZoom.get()||1; }
    catch(e){}
    return 1;
  }
  const _dd={active:false,startX:0,startY:0,baseX:0,baseY:0,z:1,moved:false,prevTransition:''};
  /* 현재 누적된 translate(X, Y) px 값 — box._dragOffset 에 보관 */
  if(box._dragOffset==null) box._dragOffset={x:0,y:0};
  function _applyTransform(){
    /* 베이스 transform(예: translate(-50%,-50%) 중앙정렬·scale 등) 을 보존하고
     * 드래그 오프셋(px) 만 뒤에 덧붙임. 단순 덮어쓰기 시 중앙정렬이 깨져 팝업이 우하단으로 튐. */
    const _base=box._baseTransform||'';
    box.style.transform=(_base+' translate('+box._dragOffset.x+'px,'+box._dragOffset.y+'px)').trim();
  }
  headerEl.addEventListener('mousedown',function(e){
    if(e.target.closest('button,input,select,textarea'))return;
    e.preventDefault();e.stopPropagation();
    _dd.active=true;_dd.moved=false;
    _dd.z=_getZoom();
    _dd.startX=e.clientX;
    _dd.startY=e.clientY;
    _dd.baseX=box._dragOffset.x;
    _dd.baseY=box._dragOffset.y;
    /* 드래그 시작 시점의 transform 에서 drag 가 추가한 'translate(...px,...px)' 부분만 제거하고
     * 베이스(translate -50%,-50% / scale 등) 는 보존해 둠. */
    box._baseTransform=(box.style.transform||'').replace(/translate\([^)]*px[^)]*\)/g,'').trim();
    /* 드래그 중에는 CSS 애니메이션 transition 차단 (튐 방지). 종료 시 복원. */
    _dd.prevTransition=box.style.transition||'';
    box.style.transition='none';
    headerEl.style.cursor='grabbing';
  });
  document.addEventListener('mousemove',function(e){
    if(!_dd.active)return;
    const z=_dd.z||1;
    const dx=(e.clientX-_dd.startX)/z;
    const dy=(e.clientY-_dd.startY)/z;
    /* 의도적 드래그와 클릭 시 마우스 미세 떨림 구분 — 3px 미만은 무시.
     * (이 임계값이 없으면 마우스 1px 떨림에도 transform 이 덮어써져 중앙정렬이 깨짐) */
    if(!_dd.moved && Math.abs(dx)<3 && Math.abs(dy)<3) return;
    _dd.moved=true;
    box._dragOffset.x=_dd.baseX+dx;
    box._dragOffset.y=_dd.baseY+dy;
    _applyTransform();
  });
  document.addEventListener('mouseup',function(){
    if(_dd.active){
      _dd.active=false;_dd.moved=false;
      headerEl.style.cursor='grab';
      /* transition 복원 — 그렇지 않으면 이후 닫힘 애니메이션이 깨짐. */
      box.style.transition=_dd.prevTransition;
    }
  });
}

function _symUpdateCatHighlights(){
  /* 화살표는 항상 자리 차지 (visibility 만 토글) → active 판별을 visibility 로 변경 */
  const activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
  const activeCatId=activeArrow?activeArrow.parentElement.dataset.cat:null;
  /* 대분류별 선택 증상 개수 — 신구 포맷 모두 인식 ("설사", "설사 (메모)", "설사(부위, 메모)") */
  const _selectedBaseNames=new Set();
  _symSelectedSymptoms.forEach(function(x){
    const m=String(x).match(/^(.+?)\s*\(/);
    _selectedBaseNames.add(m?m[1].trim():String(x));
  });
  /* 사용자 보고 2026-05-22 폴백 계산 — 옛 자유 기입(catId 매핑 없음)은 'etc' 카테고리에 카운트.
   *  어느 카테고리의 등록 증상에도 없고 _symFreeTextByCat 매핑도 없는 base 만 etc 폴백. */
  const _allRegisteredSyms = new Set();
  try {
    (_symCategories || []).forEach(function(cat){
      (cat && cat.symptoms || []).forEach(function(s){ if(s) _allRegisteredSyms.add(s); });
    });
    const _us = JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
    Object.keys(_us).forEach(function(catId){
      (_us[catId]||[]).forEach(function(s){ if(s) _allRegisteredSyms.add(s); });
    });
  } catch(_){}
  const _ftMappedBases = new Set();
  try {
    /* record ID 무관 — 모든 매핑의 base 를 수집 (실제 카운트는 _ftExtra 에서 _selectedBaseNames 매칭으로 거름).
     *  _symPopupRecId 가 자유 기입 시점과 다를 수 있는 케이스에도 안전. */
    Object.keys(_symFreeTextByCat||{}).forEach(function(key){
      const val = String(_symFreeTextByCat[key]||'').trim();
      if(val){
        const _m = val.match(/^(.+?)\s*\(/);
        _ftMappedBases.add((_m ? _m[1] : val).trim());
      }
    });
  } catch(_){}
  let _etcFallbackCount = 0;
  _selectedBaseNames.forEach(function(base){
    if(!_allRegisteredSyms.has(base) && !_ftMappedBases.has(base)) _etcFallbackCount++;
  });
  document.querySelectorAll('.sym-cat-item').forEach(function(el){
    const isAct=el.dataset.cat===activeCatId;
    const thisCat=getEffectiveSymCatById(el.dataset.cat);   /* 사용자 추가 분류도 조회 (2026-06-12) */
    /* 사용자 추가 증상도 포함 */
    let _allSyms=thisCat?thisCat.symptoms.slice():[];
    try{
      const _us=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
      const _u=_us[el.dataset.cat]||[];
      _u.forEach(function(s){if(_allSyms.indexOf(s)===-1)_allSyms.push(s);});
    }catch(_){}
    const selSyms=_allSyms.filter(function(s){
      if(!_selectedBaseNames.has(s))return false;
      /* symCatMap 에 기록된 증상은 "고른 상분류"에서만 카운트·하이라이트.
       *  같은 증상명(예: 두통)이 호흡기·두통신경 양쪽에 등록돼 있어도 선택한 상분류에만 표시 (2026-06-25) */
      if(_symSymCatMap && _symSymCatMap[s] && _symSymCatMap[s]!==el.dataset.cat) return false;
      return true;
    });
    /* 사용자 보고 2026-05-22 — 자유 기입 base 매칭 방식 카운트.
     *  _symFreeTextByCat 의 모든 매핑을 순회하며 (recId 무관) 그 catId 가 el.dataset.cat 과 같고
     *  매핑 값(자유 기입 텍스트의 base)이 현재 _selectedBaseNames 에 있으면 그 카테고리에 +1.
     *  → _symPopupRecId 가 자유 기입 시점과 다를 수 있는 케이스 (모달 재진입·record id 갱신) 안전망. */
    let _ftExtra = 0;
    try {
      Object.keys(_symFreeTextByCat||{}).forEach(function(key){
        const _parts = String(key).split('::');
        if(_parts.length < 2) return;
        const _catId = _parts.slice(1).join('::');
        if(_catId !== el.dataset.cat) return;
        const _val = String(_symFreeTextByCat[key]||'').trim();
        if(!_val) return;
        const _m = _val.match(/^(.+?)\s*\(/);
        const _valBase = (_m ? _m[1] : _val).trim();
        if(_selectedBaseNames.has(_valBase)){
          _ftExtra = 1;
        }
      });
    } catch(_){ }
    let totalSelCount = selSyms.length + _ftExtra;
    /* 사용자 보고 2026-05-22 — etc 카테고리에 폴백 카운트 합산 (옛 자유 기입 / catId 매핑 없는 자유 기입). */
    if(el.dataset.cat === 'etc') totalSelCount += _etcFallbackCount;
    const hasSel = totalSelCount > 0;
    /* 카운트 배지 갱신 */
    let badge=el.querySelector('.sym-cat-badge');
    if(hasSel){
      if(!badge){
        badge=document.createElement('span');
        badge.className='sym-cat-badge';
        badge.style.cssText='margin-left:auto;display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#eab308;color:#fff;font-size:10px;font-weight:800;flex-shrink:0';
        /* arrow 직전에 삽입 */
        const arr=el.querySelector('.sym-cat-arrow');
        if(arr)el.insertBefore(badge,arr);else el.appendChild(badge);
      }
      badge.textContent=totalSelCount;
    } else if(badge){
      badge.remove();
    }
    if(isAct){
      el.style.borderLeftColor='var(--cyan)';el.style.background='rgba(6,182,212,0.1)';
      el.querySelector('span:nth-child(2)').style.color='var(--cyan)';el.querySelector('span:nth-child(2)').style.fontWeight='800';
    } else if(hasSel){
      /* 다른 대분류 클릭 중에도 옅은 황색 배경 + 글자색으로 선택 표시 */
      el.style.borderLeftColor='#eab308';el.style.background='rgba(234,179,8,0.08)';
      el.querySelector('span:nth-child(2)').style.color='#a16207';el.querySelector('span:nth-child(2)').style.fontWeight='700';
    } else {
      el.style.borderLeftColor='transparent';el.style.background='';
      el.querySelector('span:nth-child(2)').style.color='var(--t2)';el.querySelector('span:nth-child(2)').style.fontWeight='600';
    }
  });
}
function _symDeselectCat(){
  document.querySelectorAll('.sym-cat-item').forEach(function(el){
    const thisCat=getEffectiveSymCatById(el.dataset.cat);
    const hasSel=thisCat&&thisCat.symptoms.some(function(s){return _symSelectedSymptoms.indexOf(s)!==-1;});
    if(hasSel){
      el.style.borderLeftColor='#eab308';el.style.background='';
      el.querySelector('span:nth-child(2)').style.color='var(--t2)';el.querySelector('span:nth-child(2)').style.fontWeight='600';
    } else {
      el.style.borderLeftColor='transparent';el.style.background='';
      el.querySelector('span:nth-child(2)').style.color='var(--t2)';el.querySelector('span:nth-child(2)').style.fontWeight='600';
    }
    const arrow=el.querySelector('.sym-cat-arrow');if(arrow)arrow.style.visibility='hidden';
  });
  const panel=document.getElementById('symSymList');
  if(panel)panel.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">← 카테고리를 선택하세요</div>';
}
function _symSelectCat(catId){
  const cat=getEffectiveSymCatById(catId);   /* 사용자 추가 분류 + 이름변경 반영 (2026-06-12) */
  if(!cat)return;
  /* 카테고리 하이라이트 — _symUpdateCatHighlights 와 동일한 스타일 규칙 사용 */
  document.querySelectorAll('.sym-cat-item').forEach(function(el){
    const isAct=el.dataset.cat===catId;
    const arrow=el.querySelector('.sym-cat-arrow');
    if(arrow){arrow.style.visibility=isAct?'visible':'hidden';arrow.style.color=isAct?'var(--cyan)':'';}
  });
  /* 화살표 표시 갱신 후 통합 헬퍼로 색/배지 일괄 적용 */
  _symUpdateCatHighlights();
  /* 증상 목록 렌더 (스크롤 위치 보존) */
  const panel=document.getElementById('symSymList');if(!panel)return;
  const _prevScroll=panel.scrollTop;
  let h='';
  /* 기본 증상 + 사용자 추가 증상 (숨긴 증상 제외) */
  const _userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  const _hiddenSyms=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  const _catHidden=_hiddenSyms[cat.id]||[];
  const _catUserSyms=_userSyms[cat.id]||[];
  const _rawSyms=cat.symptoms.filter(function(s){return _catHidden.indexOf(s)===-1;}).concat(_catUserSyms);
  /* 저장된 순서 반영 */
  const _orderMap=JSON.parse(localStorage.getItem('ec_sym_order')||'{}');
  const _savedOrder=_orderMap[cat.id];
  let allSyms;
  if(_savedOrder&&Array.isArray(_savedOrder)){
    allSyms=[];
    _savedOrder.forEach(function(s){if(_rawSyms.indexOf(s)!==-1)allSyms.push(s);});
    _rawSyms.forEach(function(s){if(allSyms.indexOf(s)===-1)allSyms.push(s);});
  } else {
    allSyms=_rawSyms;
  }
  /* Phase 3d: 중분류 칩 — base name 매칭 + 🧍 바디맵 + ✏️ 펜
   *  · 🧍 색: 그 증상의 바디맵 마커가 있으면 초록(#22c55e), 없으면 보라(#a855f7)
   *  · 🧍 클릭: 바디맵 입력 팝업 → 마커에 symptom 필드 부착 → 닫으면 색 갱신
   *  · ✏️ 펜 클릭: 증상 메모 미니 팝업 → "증상명 (메모)" 형태로 rec.symptoms 갱신 */
  const _curRecForBm=S.records.find(function(r){return r.id===_symPopupRecId;});
  const _bmMarkers=(window._bmData||{})[_symPopupRecId]||[];
  allSyms.forEach(function(sym,si){
    /* base name 매칭 — 신구 포맷 모두: "증상" / "증상 (메모)" (옛 공백) / "증상(부위, 메모)" (새 공백 없음) */
    const _matchIdx=_symSelectedSymptoms.findIndex(function(x){return x===sym||x.indexOf(sym+' (')===0||x.indexOf(sym+'(')===0;});
    const isSel=_matchIdx!==-1;
    const isUser=_catUserSyms.indexOf(sym)!==-1;
    /* 이 증상에 부착된 바디맵 마커가 있는지 — symptom 필드 매칭 */
    const _hasBmForSym=_bmMarkers.some(function(m){return m.symptom===sym;});
    const _bmColor=_hasBmForSym?'#22c55e':'#a855f7';
    /* 중분류 칩 자체는 선택 상태 시 cyan(하늘색), 미선택은 기본. 바디맵 입력 표시는 🧍 아이콘만 녹색으로. */
    h+='<div class="sym-sel-chip'+(isSel?' is-sel':'')+(_hasBmForSym?' has-bm':'')+'" data-sym="'+escHtml(sym)+'" data-cat="'+escHtml(cat.id)+'" data-user="'+(isUser?'1':'')+'" data-sel="'+(isSel?'1':'0')+'" data-action="toggleSym" style="padding:7px 12px;margin:0 4px 4px 4px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:600;transition:all .15s;display:flex;align-items:center;gap:6px;border:1px solid '+(isSel?'var(--cyan)':'var(--bdr)')+';background:'+(isSel?'rgba(6,182,212,0.1)':'transparent')+';color:'+(isSel?'var(--cyan)':'var(--t1)')+';position:relative">';
    h+='<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(sym)+'</span>';
    /* 🧍 바디맵 아이콘 — 상담 분류에서는 제외 (바디맵 불필요, 사용자 요청 2026-06-13) */
    if(cat.id!=='counsel'){
      /* 바디맵 입력된 증상은 🧍 아이콘 자체에 녹색 테두리 + 옅은 녹색 배경으로 강조 */
      const _bmIconBorder=_hasBmForSym?'1.5px solid #22c55e':'1.5px solid transparent';
      const _bmIconBg=_hasBmForSym?'rgba(34,197,94,0.15)':'transparent';
      /* 호버 즉시 표시되는 미니 팝업 — 기본 안내 문구 + (이미 등록된 부위가 있으면) 부위 목록 부가. */
      const _bmParts=_bmMarkers.filter(function(m){return m.symptom===sym;}).map(function(m){return m.label;}).filter(Boolean);
      const _bmTipText='증상이 나타난 부위 또는 통증척도를 바디맵 상에 입력할 수 있습니다.'
        +((_hasBmForSym&&_bmParts.length>0)?('\n등록된 부위: '+_bmParts.join(', ')):'');
      h+='<span class="sym-bm-mark" data-action="openSymBm" data-sym="'+escHtml(sym)+'" data-rec-id="'+_symPopupRecId+'" data-tooltip="'+escHtml(_bmTipText)+'" data-tooltip-instant="1" style="cursor:pointer;font-size:13px;line-height:1;padding:1px 4px;border-radius:6px;color:'+_bmColor+';border:'+_bmIconBorder+';background:'+_bmIconBg+'">🧍</span>';
    }
    /* ✏️ 펜 아이콘 — 호버 즉시 표시 미니 팝업.
     *  자유 기술(메모)이 입력된 증상은 🧍 바디맵 아이콘과 동일하게 펜 아이콘에도 주황 테두리 + 옅은 배경으로 강조 (사용자 요청 2026-06-05).
     *  상담 분류는 펜 제외 — 자유 기술 대신 우측 상담록 블록이 그 역할 (사용자 결정 2026-06-12). */
    if(cat.id!=='counsel'){
      const _hasSymMemo = isSel && (function(){
        const _mp=_symGetBodyPartsForSym(_symPopupRecId, sym);
        const _mm=_symExtractMemoFromStored(_symSelectedSymptoms[_matchIdx], _mp);
        return !!(_mm && _mm.trim());
      })();
      const _penBorder=_hasSymMemo?'1.5px solid #d97706':'1.5px solid transparent';
      const _penBg=_hasSymMemo?'rgba(217,119,6,0.15)':'transparent';
      h+='<span class="sym-chip-pen" data-action="openSymMemo" data-sym="'+escHtml(sym)+'" data-rec-id="'+_symPopupRecId+'" data-tooltip="증상에 대한 자세한 경위, 상태 등을 자유 기술할 수 있습니다." data-tooltip-instant="1" style="cursor:pointer;font-size:13px;line-height:1;padding:1px 3px;border-radius:6px;color:#d97706;border:'+_penBorder+';background:'+_penBg+'">✏️</span>';
    }
    /* ✕ 취소 — 선택된 칩에서만 hover 시 노출, 선택 안 된 칩도 같은 폭의 placeholder 로 자리 확보 (정렬 일관성). */
    if(isSel){
      h+='<span class="sym-chip-del" data-action="cancelSym" data-sym="'+escHtml(sym)+'" data-tooltip="이 증상 선택 해제" data-tooltip-instant="1">✕</span>';
    } else {
      h+='<span class="sym-chip-del-placeholder" aria-hidden="true"></span>';
    }
    h+='</div>';
  });
  /* Phase 3d Section E: 하단 + 추가 / ✏️ 자유 기입 칩 — 증상 목록 끝에 고정.
   * 자유 기입 칩은 이미 입력된 자유 서술이 있으면 그 텍스트를 그대로 칩 라벨로 표시 (cyan + 🧍 + ✕).
   * 부위(바디맵)가 마커로 부착되면 칩 테두리 녹색 + 🧍 아이콘 강조. */
  const _ftKey=_symPopupRecId+'::'+cat.id;
  let _ftLast=(_symFreeTextByCat[_ftKey]||'').trim();
  /* 만약 선택 증상에 없으면 stale 캐시 — 비우기 */
  if(_ftLast && _symSelectedSymptoms.indexOf(_ftLast)===-1){
    delete _symFreeTextByCat[_ftKey];
    _ftLast='';
  }
  const _ftBaseName=_ftLast?(_ftLast.match(/^(.+?)\s*\(/)?_ftLast.match(/^(.+?)\s*\(/)[1].trim():_ftLast):'';
  const _ftHasInSel=_ftLast && _symSelectedSymptoms.indexOf(_ftLast)!==-1;
  const _ftHasBm=_ftBaseName && _bmMarkers.some(function(m){return m.symptom===_ftBaseName;});
  const _ftBg=_ftHasInSel?'rgba(6,182,212,0.10)':'rgba(251,191,36,0.08)';
  const _ftColor=_ftHasInSel?'var(--cyan)':'#d97706';
  const _ftBorder=_ftHasBm?'2px solid #22c55e':(_ftHasInSel?'1px solid var(--cyan)':'1px solid #fbbf24');
  const _ftBmIconColor=_ftHasBm?'#22c55e':'#a855f7';
  const _ftBmIconBorder=_ftHasBm?'1.5px solid #22c55e':'1.5px solid transparent';
  const _ftBmIconBg=_ftHasBm?'rgba(34,197,94,0.15)':'transparent';
  const _ftLabel=_ftHasInSel?_ftLast:'✏️ 증상 자유 기입';
  /* + 추가 / ✏️ 증상 자유 기입 — 사용자 요청으로 두 칩을 별도 줄로 분리.
   *   상단: + 추가 (영구 등록용)
   *   하단: ✏️ 증상 자유 기입 (가로 전체 폭, 일회용 자유 서술) */
  h+='<div class="sym-cat-add-wrap" style="margin:10px 4px 4px;padding-top:10px;border-top:1px dashed var(--bdr);position:relative;display:flex;flex-direction:column;gap:6px">';
  h+='<div><span class="sym-sel-chip" data-action="addUserSym" data-cat="'+escHtml(cat.id)+'" data-tooltip="이 분류에 새 증상을 영구 등록합니다." data-tooltip-instant="1" style="position:relative;display:inline-flex;align-items:center;padding:8px 18px;font-size:14px;font-weight:800;border-radius:16px;cursor:pointer;border:1.5px dashed #f97316;background:rgba(249,115,22,0.12);color:#f97316;font-family:var(--f)">+ 추가</span></div>';
  /* ✏️ 증상 자유 기입 칩 — 상담 분류에서는 제외 (상담록이 그 역할, 사용자 요청 2026-06-13). */
  if(cat.id!=='counsel'){
    h+='<span class="sym-sel-chip" data-action="openSymFreeText" data-cat="'+escHtml(cat.id)+'" data-rec-id="'+_symPopupRecId+'" data-last="'+escHtml(_ftLast)+'" data-tooltip="일회성으로 증상을 자유롭게 적을 수 있습니다." data-tooltip-instant="1" style="display:flex;width:100%;min-width:0;align-items:center;gap:5px;padding:6px 14px;font-size:12px;font-weight:700;border-radius:14px;cursor:pointer;border:'+_ftBorder+';background:'+_ftBg+';color:'+_ftColor+';font-family:var(--f);box-sizing:border-box">';
    h+='<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(_ftLabel)+'</span>';
    /* 자유 기입 칩 자체의 🧍 버튼 제거 — 사용자 요청 2026-05-19: 부위 입력은 자유 기입 dock 안의 🧍 버튼으로 대체.
     * 자유 기입 칩 테두리 색만 _ftBorder(_ftHasBm 시 녹색) 으로 입력 여부 표시. */
    /* ✕ 삭제 버튼 — 텍스트 입력된 경우만 노출 */
    if(_ftHasInSel){
      h+='<span class="sym-chip-del" data-action="cancelSym" data-sym="'+escHtml(_ftLast)+'">✕</span>';
    }
    h+='</span>';
  }
  h+='</div>';
  panel.innerHTML=h;
  /* data-tooltip 미니 팝업 위임 — 일반 일지 버튼과 동일한 GUI 사용 (showHeaderTooltip). */
  _symBindTipDelegation(panel);
  /* 증상 목록 이벤트 위임 — 중복 등록 방지 */
  if(!panel._symSymDelegated){
    panel._symSymDelegated=true;
    panel.addEventListener('click',function(e){
      /* Phase 3d: inner 액션(🧍·✏️·✕) 을 toggle 보다 먼저 검사 */
      const del=e.target.closest('[data-action="toggleSymDel"]');
      if(del){e.stopPropagation();_symToggleSym(del.dataset.sym);return;}
      const bmBtn=e.target.closest('[data-action="openSymBm"]');
      if(bmBtn){
        e.stopPropagation();
        let _bmSym=bmBtn.dataset.sym||'';
        /* 자유 기입 칩의 🧍 — data-sym 이 비어있어도 _symFreeTextByCat 에 입력된 텍스트가 있으면 그걸로 바디맵 진행.
         * 사용자 보고 2026-05-19: 자유 기입 후 바디맵 클릭 시 "자유 서술 먼저 입력" 토스트 뜨고 막히던 누락 보완. */
        if(bmBtn.dataset.ft==='1' && !_bmSym){
          const _rid=parseInt(bmBtn.dataset.recId);
          const _catFt=bmBtn.dataset.cat||'';
          const _ftK=_rid+'::'+_catFt;
          const _ftRaw=(typeof _symFreeTextByCat==='object' && _symFreeTextByCat && _symFreeTextByCat[_ftK]) ? String(_symFreeTextByCat[_ftK]).trim() : '';
          if(_ftRaw){
            const _ftM=_ftRaw.match(/^(.+?)\s*\(/);
            _bmSym=_ftM?_ftM[1].trim():_ftRaw;
          } else {
            /* 정말 텍스트 없으면 dock 부터 열기 */
            const _ftAnchor=bmBtn.closest('[data-action="openSymFreeText"]')||bmBtn;
            _symOpenSymFreeTextDock(_rid, _ftAnchor, '', _catFt);
            bus.emit('toast:show', {text: '자유 서술을 먼저 입력하세요.'});
            return;
          }
        }
        _symOpenBmForSym(parseInt(bmBtn.dataset.recId), _bmSym);
        return;
      }
      const memoBtn=e.target.closest('[data-action="openSymMemo"]');
      if(memoBtn){
        e.stopPropagation();
        const chip=memoBtn.closest('.sym-sel-chip');
        _symOpenSymMemoDock(parseInt(memoBtn.dataset.recId),memoBtn.dataset.sym,chip||memoBtn);
        return;
      }
      /* 선택 상태 ✕ 취소 — toggleSym 보다 먼저 검사 (호버로 노출되는 빨간 동그라미) */
      const cancelBtn=e.target.closest('[data-action="cancelSym"]');
      if(cancelBtn){e.stopPropagation();_symToggleSym(cancelBtn.dataset.sym);return;}
      /* Phase 3d Section E: + 추가 / ✏️ 자유 기입 */
      const addSym=e.target.closest('[data-action="addUserSym"]');
      if(addSym){e.stopPropagation();_symAddUserSym(addSym.dataset.cat);return;}
      const ftSym=e.target.closest('[data-action="openSymFreeText"]');
      if(ftSym){
        e.stopPropagation();
        _symOpenSymFreeTextDock(parseInt(ftSym.dataset.recId), ftSym, ftSym.dataset.last||'', ftSym.dataset.cat||'');
        return;
      }
      const chip=e.target.closest('[data-action="toggleSym"]');
      if(chip){
        /* 사용자 결정 2026-05-31: 칩 재클릭 해제 시 그 증상에 입력한 처치(treatmentBySym) 가
         * 함께 삭제되어 작업 손실 → 해제는 ✕ 버튼(.sym-chip-del)으로만. 추가는 그대로 칩 클릭. */
        if(_symFindSymIdx(chip.dataset.sym) !== -1) return;
        _symToggleSym(chip.dataset.sym);
      }
    });
  }
  /* 증상 미선택 상태에선 우측 placeholder 안내가 활성 분류(상담 등)를 따라가도록 재렌더 (2026-06-12) */
  if(_symSelectedSymptoms.length===0 && !_symRecordIsLegacy && typeof _symRenderTreatPanel==='function')_symRenderTreatPanel();
  panel.scrollTop=_prevScroll;
}

/* ── 사용자 증상 호버 버튼 표시/숨김 ── */
function _symShowUserBtns(el){
  const hasSel=!!el.querySelector('.sym-chip-del');
  el.querySelectorAll('.sym-user-grip,.sym-user-edit,.sym-user-del').forEach(function(b){
    /* 선택된 칩은 이미 sym-chip-del(✕)이 있으므로 sym-user-del 숨김 — ✕ 중복 방지 */
    if(hasSel&&b.classList.contains('sym-user-del'))return;
    b.style.display='inline-flex';
  });
}
function _symHideUserBtns(el){
  el.querySelectorAll('.sym-user-grip,.sym-user-edit,.sym-user-del').forEach(function(b){b.style.display='none';});
}

/* ── 증상 수정 (인라인 — 실시간 미리보기 + 외부 클릭 시 자동 저장) ── */
function _symEditUserSym(catId,oldName){
  /* 해당 증상 칩을 찾아서 인라인 input으로 교체 */
  const chips=document.querySelectorAll('#symSymList .sym-sel-chip');
  let targetChip=null;
  chips.forEach(function(c){if(c.dataset.sym===oldName&&c.dataset.cat===catId)targetChip=c;});
  if(!targetChip){
    /* fallback: 팝업 */
    window._symPrompt('증상명 수정',oldName,function(newName){
      if(newName===oldName)return;
      _symEditUserSymApply(catId,oldName,newName);
    });
    return;
  }
  const inp=document.createElement('input');
  inp.type='text';inp.value=oldName;
  inp.style.cssText='width:100%;font-size:11px;font-weight:600;border:1px solid var(--cyan);border-radius:6px;padding:5px 8px;outline:none;background:var(--bg2);color:var(--t1)';
  targetChip.textContent='';targetChip.appendChild(inp);
  inp.focus();inp.select();
  /* 실시간 미리보기: 선택된 증상 목록에도 반영 */
  inp.addEventListener('input',function(){
    const si=_symSelectedSymptoms.indexOf(oldName);
    if(si!==-1)_symSelectedSymptoms[si]=inp.value.trim()||oldName;
  });
  function _commit(){
    const newName=inp.value.trim();
    if(!newName||newName===oldName){_symSelectCat(catId);return;}
    _symEditUserSymApply(catId,oldName,newName);
  }
  inp.addEventListener('blur',function(){setTimeout(_commit,50);});
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();inp.blur();}
    if(e.key==='Escape'){inp.value=oldName;inp.blur();}
  });
}
function _symEditUserSymApply(catId,oldName,newName){
  const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  if(!userSyms[catId])userSyms[catId]=[];
  const idx=userSyms[catId].indexOf(oldName);
  if(idx!==-1){
    /* 사용자 정의 증상 수정 */
    userSyms[catId][idx]=newName;
  } else {
    /* 기본 증상 수정: 원본 숨기고 새 이름을 사용자 증상으로 추가 */
    const hidden=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
    if(!hidden[catId])hidden[catId]=[];
    if(hidden[catId].indexOf(oldName)===-1)hidden[catId].push(oldName);
    localStorage.setItem('ec_hidden_symptoms',JSON.stringify(hidden));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','hidden_symptoms',hidden);
    userSyms[catId].push(newName);
  }
  localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
  /* 선택된 증상에도 반영 */
  const si=_symSelectedSymptoms.indexOf(oldName);
  if(si!==-1)_symSelectedSymptoms[si]=newName;
  _symSelectCat(catId);
  bus.emit('toast:save');
}

/* ── 사용자 증상 드래그 이동 (드롭 위치 표시선 포함) ── */
function _symStartDragSym(el,e){
  e.preventDefault();
  const panel=document.getElementById('symSymList');if(!panel)return;
  const catId=el.dataset.cat;
  const items=Array.from(panel.querySelectorAll('.sym-sel-chip[data-user="1"][data-cat="'+catId+'"]'));
  const dragIdx=items.indexOf(el);
  if(dragIdx===-1)return;
  el.style.opacity='0.5';el.style.boxShadow='0 2px 8px rgba(0,0,0,0.2)';el.style.zIndex='100';
  const startY=e.clientY;
  /* 드롭 위치 표시선 */
  const indicator=document.createElement('div');
  indicator.style.cssText='height:2px;background:#06b6d4;border-radius:1px;position:absolute;left:4px;right:4px;z-index:99;pointer-events:none;display:none';
  panel.style.position='relative';panel.appendChild(indicator);
  function onMove(ev){
    const diff=ev.clientY-startY;
    el.style.transform='translateY('+diff+'px)';
    /* 드롭 위치 계산 + 표시선 */
    let hoverIdx=-1;
    items.forEach(function(item,i){
      const rect=item.getBoundingClientRect();
      if(ev.clientY>rect.top+rect.height/2)hoverIdx=i;
      item.style.borderTop='';item.style.borderBottom='';
    });
    if(hoverIdx===-1){
      /* 맨 위 */
      indicator.style.display='block';
      indicator.style.top=(items[0]?items[0].offsetTop-1:0)+'px';
    } else if(hoverIdx<items.length){
      indicator.style.display='block';
      const target=items[hoverIdx];
      indicator.style.top=(target.offsetTop+target.offsetHeight-1)+'px';
    }
  }
  function onUp(ev){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    el.style.opacity='';el.style.boxShadow='';el.style.transform='';el.style.zIndex='';
    indicator.remove();
    items.forEach(function(item){item.style.borderTop='';item.style.borderBottom='';});
    const dropY=ev.clientY;
    let newIdx=dragIdx;
    items.forEach(function(item,i){
      const rect=item.getBoundingClientRect();
      if(dropY>rect.top+rect.height/2)newIdx=i;
    });
    if(newIdx!==dragIdx){
      const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
      if(!userSyms[catId])return;
      const moved=userSyms[catId].splice(dragIdx,1)[0];
      userSyms[catId].splice(newIdx,0,moved);
      localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
      _symSelectCat(catId);
      bus.emit('toast:save');
    }
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ── 모든 증상 드래그 이동 (기본+사용자 통합) ── */
function _symStartDragAll(el,e){
  e.preventDefault();
  const panel=document.getElementById('symSymList');if(!panel)return;
  const catId=el.dataset.cat;
  /* 모든 증상 칩 (기본+사용자) */
  const items=Array.from(panel.querySelectorAll('.sym-sel-chip[data-cat="'+catId+'"]'));
  const dragIdx=items.indexOf(el);
  if(dragIdx===-1)return;
  el.style.opacity='0.5';el.style.boxShadow='0 2px 8px rgba(0,0,0,0.2)';el.style.zIndex='100';
  const startY=e.clientY;
  const indicator=document.createElement('div');
  indicator.style.cssText='height:2px;background:#06b6d4;border-radius:1px;position:absolute;left:4px;right:4px;z-index:99;pointer-events:none;display:none';
  panel.style.position='relative';panel.appendChild(indicator);
  function onMove(ev){
    const diff=ev.clientY-startY;
    el.style.transform='translateY('+diff+'px)';
    let hoverIdx=-1;
    items.forEach(function(item,i){
      const rect=item.getBoundingClientRect();
      if(ev.clientY>rect.top+rect.height/2)hoverIdx=i;
    });
    if(hoverIdx===-1){indicator.style.display='block';indicator.style.top=(items[0]?items[0].offsetTop-1:0)+'px';}
    else if(hoverIdx<items.length){indicator.style.display='block';const t=items[hoverIdx];indicator.style.top=(t.offsetTop+t.offsetHeight-1)+'px';}
  }
  function onUp(ev){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    el.style.opacity='';el.style.boxShadow='';el.style.transform='';el.style.zIndex='';
    indicator.remove();
    const dropY=ev.clientY;
    let newIdx=dragIdx;
    items.forEach(function(item,i){
      const rect=item.getBoundingClientRect();
      if(dropY>rect.top+rect.height/2)newIdx=i;
    });
    if(newIdx!==dragIdx){
      /* 전체 순서를 ec_sym_order에 저장 */
      const symNames=items.map(function(it){return it.dataset.sym;});
      const moved=symNames.splice(dragIdx,1)[0];
      symNames.splice(newIdx,0,moved);
      const orderMap=JSON.parse(localStorage.getItem('ec_sym_order')||'{}');
      orderMap[catId]=symNames;
      localStorage.setItem('ec_sym_order',JSON.stringify(orderMap));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','sym_order',orderMap);
      _symSelectCat(catId);
      bus.emit('toast:save');
    }
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ── prompt() 대체 커스텀 입력 팝업 ──
 *  · 안내 문구 / 취소 버튼 제거.
 *  · 자동 저장: 외부 클릭 / ESC / Enter 모두 _done() 호출 (입력값이 있으면 콜백). */
export function _symPrompt(title,defaultVal,callback,hint,noParen){
  const old=document.getElementById('symPromptOverlay');if(old)closeModalGracefully(old);
  const ov=document.createElement('div');ov.id='symPromptOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12000;transition:background 0.15s ease';
  const box='<div id="symPromptBox" style="background:var(--card);border-radius:10px;width:320px;box-shadow:0 8px 24px rgba(0,0,0,0.3);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s ease,transform 0.15s ease">'
    +'<div style="font-size:13px;font-weight:700;color:var(--t1);padding:10px 16px;background:var(--popup-head);border-bottom:1px solid var(--bdr)">'+escHtml(title)+'</div>'
    +'<div style="padding:16px">'
    +(hint?'<div style="font-size:10.5px;color:var(--t3);line-height:1.6;margin-bottom:10px">'+escHtml(hint)+'</div>':'')
    +'<input id="symPromptInput" type="text" value="'+escHtml(defaultVal||'')+'" placeholder="입력 즉시 자동 저장" style="width:100%;padding:8px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;background:var(--bg2);color:var(--t1);outline:none;box-sizing:border-box" autofocus>'
    +'<div id="symPromptWarn" style="display:none;font-size:10px;color:#dc2626;font-weight:600;margin-top:7px;line-height:1.5"></div>'
    +'</div></div>';
  ov.innerHTML=box;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symPromptBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  const inp=document.getElementById('symPromptInput');
  inp.focus();inp.select();
  setTimeout(function(){ try{ if(document.activeElement!==inp) inp.focus(); }catch(_){} }, 60);
  /* 괄호 입력 차단 — 타이핑·붙여넣기 즉시 ( ) 제거 (증상 추가용). 부위·메모 자유기입 괄호와 충돌 방지. (사용자 요청 2026-06-24) */
  if(noParen){
    inp.addEventListener('input',function(){
      const _w=document.getElementById('symPromptWarn');
      const _c=inp.value.replace(/[()（）]/g,'');
      if(_c!==inp.value){
        const _p=Math.max(0,(inp.selectionStart||1)-1); inp.value=_c; try{inp.setSelectionRange(_p,_p);}catch(_){}
        /* 괄호 입력 시 안내 — 모달 안 인라인(토스트는 z-index 9999 < 모달 12000 이라 가려짐) (사용자 요청 2026-06-24) */
        if(_w){ _w.textContent='⚠ 괄호 ( ) 는 쓸 수 없습니다. / 로 대체해 주세요.'; _w.style.display='block'; }
      } else if(_w){
        /* 정상 문자 입력 시 경고 제거 (사용자 요청 2026-06-24) */
        _w.style.display='none';
      }
    });
  }
  let _settled=false;
  function _closeAnim(cb){
    const b=document.getElementById('symPromptBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  function _done(){
    if(_settled)return;_settled=true;
    const v=inp.value.trim();
    _closeAnim(function(){if(v)callback(v);});
  }
  inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();_done();}if(e.key==='Escape')_done();});
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_done();});
}

/* ── 사용자 정의 증상 추가/삭제 ── */
function _symAddUserSym(catId){
  _symPrompt('추가할 증상명을 입력하세요.','',function(name){
    /* 괄호 차단 — 증상명의 ( )는 부위·메모(자유 기입) 표기와 충돌하므로 입력 불가 (사용자 결정 2026-06-23) */
    if(/[()（）]/.test(name)){bus.emit('toast:show', {text: '증상명에 괄호( )는 쓸 수 없습니다. / 로 대체해 주세요.'});return;}
    const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
    if(!userSyms[catId])userSyms[catId]=[];
    if(userSyms[catId].indexOf(name)!==-1){bus.emit('toast:show', {text: '이미 추가된 증상입니다.'});return;}
    userSyms[catId].push(name);
    localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
    _symSelectCat(catId);
    bus.emit('toast:save');
  },'괄호는 증상 자유 기입 시 나타나는 괄호와 충돌하므로 쓸 수 없으며 /로 대체 바랍니다.',true);
}
async function _symRemoveUserSym(catId,name){
  const ok=await appConfirmModal('"'+escHtml(name)+'" 증상을 삭제하시겠습니까?','증상 삭제',{okLabel:'삭제',cancelLabel:'취소'});
  if(!ok)return;
  const userSyms=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  if(!userSyms[catId])return;
  userSyms[catId]=userSyms[catId].filter(function(s){return s!==name;});
  localStorage.setItem('ec_user_symptoms',JSON.stringify(userSyms));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_symptoms',userSyms);
  _symSelectCat(catId);
  bus.emit('toast:save');
}

/* ── 기본 증상 숨기기 (삭제 대신) ── */
function _symHideDefaultSym(catId,name){
  if(!confirm('"'+name+'" 증상을 숨기시겠습니까?\n(설정에서 다시 복원할 수 있습니다.)'))return;
  const hidden=JSON.parse(localStorage.getItem('ec_hidden_symptoms')||'{}');
  if(!hidden[catId])hidden[catId]=[];
  if(hidden[catId].indexOf(name)===-1)hidden[catId].push(name);
  localStorage.setItem('ec_hidden_symptoms',JSON.stringify(hidden));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','hidden_symptoms',hidden);
  _symSelectCat(catId);
  bus.emit('toast:save');
}

/* 즉시 저장 + 일지 반영 */
function _symAutoSave(_silent){
  const rec=S.records.find(function(r){return r.id===_symPopupRecId;});
  if(rec){
    /* 저장 직전 바디맵 부위 라벨 재구성 — 어느 흐름에서 마커가 추가/변경되었더라도 항상 라벨이 동기화되도록 안전망.
     * 사용자 보고 2026-05-19: 부위 마커는 추가됐는데 출력에 부위가 안 보이던 누락 보완. */
    try{
      if(typeof _symRebuildAllSymLabels==='function' && _symPopupRecId!=null){
        _symRebuildAllSymLabels(_symPopupRecId);
      }
    }catch(_){}
    /* 분기 모드에서 '증상별 처치가 입력돼 있으면' 미분기(__flat__) 잔존 통합 처치는 폐기 (사용자 결정 2026-06-09).
     *  · 미분기 작성 → 분기(입력 없음) → 미분기 = 통합 보존 (분기에서 증상별 처치가 비어 있으니 폐기 안 함)
     *  · 분기에서 각 증상에 처치 입력 = 통합 폐기 (미분기 다시 누르면 현재 분기 처치가 merge 로 합쳐짐) */
    if(_symBranchMode!==false){
      /* 폐기 조건 = '증상별에 __flat__ 엔 없는 처치/약품이 있다'(= 분기에서 새로 입력함).
       *  merge 직후나 미분기 편집으로 __flat__ 이 증상별을 포함만 하면 폐기 안 함 → "분기 입력 없으면 보존" 정확 충족. (2026-06-09 정밀화) */
      const _flatT = new Set(_symTreatmentsBySym[SYM_FLAT_KEY]||[]);
      const _flatM = new Set(_symMedsBySym[SYM_FLAT_KEY]||[]);
      let _newPerSym = false;
      Object.keys(_symTreatmentsBySym).forEach(function(k){
        if(k===SYM_FLAT_KEY) return;
        (_symTreatmentsBySym[k]||[]).forEach(function(t){ if(!_flatT.has(t)) _newPerSym=true; });
      });
      Object.keys(_symMedsBySym).forEach(function(k){
        if(k===SYM_FLAT_KEY) return;
        (_symMedsBySym[k]||[]).forEach(function(m){ if(!_flatM.has(m)) _newPerSym=true; });
      });
      if(_newPerSym){
        delete _symTreatmentsBySym[SYM_FLAT_KEY];
        delete _symMedsBySym[SYM_FLAT_KEY];
        delete _symMedDosesBySym[SYM_FLAT_KEY];
      }
    }
    /* 변경 감지 — 실제로 바뀐 게 없으면 저장도 토스트도 스킵.
     * 사용자 보고: "의미없이 저장 중… 모든 내용이 저장되었습니다 가 뜬다."
     * 클릭 했지만 데이터 동일한 경우(예: 같은 칩 더블 트리거)에 무용 토스트가 떴음. */
    const _nextSym=JSON.stringify(_symSelectedSymptoms);
    const _nextTrt=JSON.stringify(_symSelectedTreatments);
    const _nextMed=_symMedsToSaveStr();
    const _nextTbs=JSON.stringify(_symTreatmentsBySym||{});
    const _nextMbs=JSON.stringify(_symMedsBySym||{});
    const _nextMdbs=JSON.stringify(_symMedDosesBySym||{});
    const _nextScm=JSON.stringify(_symSymCatMap||{});
    const _curSym=JSON.stringify(rec.symptoms||[]);
    const _curTrt=JSON.stringify(rec.treatment||[]);
    const _curMed=rec.medication||'';
    const _curTbs=JSON.stringify(rec.treatmentBySym||{});
    const _curMbs=JSON.stringify(rec.medsBySym||{});
    const _curMdbs=JSON.stringify(rec.medDosesBySym||{});
    const _curScm=JSON.stringify(rec.symCatMap||{});
    /* 분기/미분기 모드 변경도 "변경"으로 감지 — 처치가 없어 다른 값이 안 바뀌어도 토글이 저장·재렌더되도록.
     *  미분기↔분기 전환 시 표/방문이력이 즉시 따라 바뀌게. undefined·true 는 둘 다 분기이므로 effective 로 비교. (2026-06-09) */
    const _nextBranchEff=(_symBranchMode===false);
    const _curBranchEff=(rec.treatmentBranched===false);
    const _noChange=(_nextSym===_curSym && _nextTrt===_curTrt && _nextMed===_curMed
                  && _nextTbs===_curTbs && _nextMbs===_curMbs && _nextMdbs===_curMdbs
                  && _nextScm===_curScm
                  && _nextBranchEff===_curBranchEff);
    if(_noChange) return;
    rec.symptoms=_symSelectedSymptoms.map(_symToSavedSymptom); /* 상담 주제는 "상담[X 관련 상담]" 으로 저장 (2026-06-13) */
    rec.treatment=_symSelectedTreatments.slice();
    /* v3 — 증상별 처치 매핑도 함께 저장. 깊은 복사로 외부 mutation 차단. */
    rec.treatmentBySym = JSON.parse(JSON.stringify(_symTreatmentsBySym||{}));
    /* 분기/미분기 모드 저장 (2026-06-09) — 증상 2개+ 이고 옛 일지 아닐 때만 명시 플래그.
     *  증상 1개/옛 일지엔 안 써서(undefined) 기존 데이터·표 동작에 영향 0. */
    if(_symSelectedSymptoms.length>=2 && !_symRecordIsLegacy){
      rec.treatmentBranched = _symBranchMode;
    }
    /* v3 — 증상별 약품/도즈 매핑도 함께 저장 (사용자 결정 2026-05-21).
     * 깊은 복사로 외부 mutation 차단. extra_json 으로 직렬화는 _recToDbRow 가 담당. */
    rec.medsBySym = JSON.parse(JSON.stringify(_symMedsBySym||{}));
    rec.medDosesBySym = JSON.parse(JSON.stringify(_symMedDosesBySym||{}));
    /* 증상→선택 상분류 저장 (extra_json sym_cat_map 직렬화는 _recToDbRow 담당) */
    rec.symCatMap = JSON.parse(JSON.stringify(_symSymCatMap||{}));
    /* 사용자 보고 2026-05-22 — 자유 기입 증상의 카테고리 매핑을 record 에 저장.
     *  형식: { catId: text }. 모달 재진입·앱 재시작 후에도 카테고리 카운트 복원 가능. */
    /* ★ recId 프리픽스에만 의존하던 옛 방식은 자동생성 record·모달 재진입으로 recId 가 어긋나면 매핑이
     *  통째로 누락돼, 자유기입 증상이 통계에서 '기타'로 빠졌다 (2026-06-17 DB 387건 중 0건 확인).
     *  → '현재 선택 증상에 실제로 들어있는 자유기입' 을 catId 별로 저장(값 기준, recId 무관)해 항상 잡히게 한다.
     *  base(괄호 부위/메모 제거) 도 매칭해 "두근거림 (가슴)" 처럼 부위가 붙은 자유기입도 누락 없이 잡는다. */
    const _ftSnap = {};
    const _ftBaseOf = function(s){ const m=String(s).match(/^(.+?)\s*\(/); return m?m[1].trim():String(s).trim(); };
    const _ftSelSet = {};
    _symSelectedSymptoms.forEach(function(s){ _ftSelSet[String(s)] = 1; _ftSelSet[_ftBaseOf(s)] = 1; });
    Object.keys(_symFreeTextByCat||{}).forEach(function(k){
      const _v = _symFreeTextByCat[k];
      if(_v == null || _v === '') return;
      if(!_ftSelSet[String(_v)] && !_ftSelSet[_ftBaseOf(_v)]) return;   /* 현재 선택에 실제로 있는 자유기입만 */
      const _catId = String(k).split('::').slice(1).join('::');         /* 키 형식 recId::catId → catId 추출 */
      if(_catId) _ftSnap[_catId] = _v;
    });
    rec.symFreeTextByCat = _ftSnap;
    rec.medication=_symMedsToSaveStr();
    /* Phase 3a: symTreatInput 제거됨 → treatmentMemo 자유서술 입력 안 받음.
       기존 DB 의 treatmentMemo 값은 유지 (rec 객체에 그대로 남음). */
    if(rec.symptoms.length>0&&!rec.dept){const dept=getDeptForSymptom(rec.symptoms[0]);if(dept)rec.dept=dept;}
    /* 사용자가 무엇이든 입력했다면 자동 생성 플래그 해제 — 빈 레코드 정리 대상에서 제외 */
    if(rec._autoCreated && (rec.symptoms.length>0 || rec.treatment.length>0 || rec.medication || (rec.treatmentMemo&&rec.treatmentMemo.trim()))){
      rec._autoCreated=false;
    }
    rec._dirty=true;
    saveRecordNow(rec);
    bus.emit('render:daily');
    bus.emit('ems:refresh',rec.id);
    /* 처치/약품 변경 시 대시보드(투약 TOP5)·방문 통계(투약 TOP10) 도 갱신 */
    bus.emit('render:dashboard');
    bus.emit('render:stats');
    /* 저장 토스트 — silent=true 면 토스트 없이 조용히 저장 (팝업 닫힘 시 호출되는 마무리 저장용).
     * 입력은 어차피 모두 실시간 저장되므로 닫을 때 또 토스트가 뜨는 건 사용자 입장에서 부자연스러움. */
    if(_silent)return;
    /* 토스트 디바운스 — 타이핑 중에는 600ms idle 까지 대기. 빠른 연타에도 한 번만 표시.
     * 저장 자체는 위 saveRecordNow 에서 매 호출마다 즉시 수행되므로 데이터 손실 없음. */
    if(window._symToastTimer)clearTimeout(window._symToastTimer);
    window._symToastTimer=setTimeout(function(){
      window._symToastTimer=null;
      const toast=document.getElementById('globalSaveToast');
      if(!toast)return;
      toast.textContent='저장 중…';
      toast.className='global-save-toast show saving';
      setTimeout(function(){
        toast.textContent='모든 내용이 저장되었습니다.';
        toast.className='global-save-toast show';
        setTimeout(function(){toast.className='global-save-toast';},3000);
      },300);
    },600);
  }
}

function _symToggleSym(sym){
  /* Phase 3d: base name 매칭 — 메모 부착 항목도 동일 토글 */
  const idx=_symFindSymIdx(sym);
  const wasSelected=idx!==-1;
  let _removedLabel=null;
  if(!wasSelected){
    _symSelectedSymptoms.push(sym);
    /* 선택한 상분류를 기록 — 같은 증상명이 여러 상분류에 있어도 고른 상분류로 표시·통계 고정 (2026-06-25) */
    try{ const _ac=document.querySelector('.sym-cat-item .sym-cat-arrow[style*="visibility: visible"]'); const _acid=_ac?_ac.parentElement.dataset.cat:null; if(_acid){ const _mb=String(sym).match(/^(.+?)\s*\(/); _symSymCatMap[_mb?_mb[1].trim():String(sym)]=_acid; } }catch(_){}
  }
  else {
    _removedLabel=_symSelectedSymptoms[idx];_symSelectedSymptoms.splice(idx,1);
    /* 해제 시 그 증상의 상분류 기록도 제거 */
    try{ const _rl=_removedLabel||sym; const _mb=String(_rl).match(/^(.+?)\s*\(/); delete _symSymCatMap[_mb?_mb[1].trim():String(_rl)]; }catch(_){}
  }
  /* v3 — 해제된 증상의 treatmentBySym 키도 함께 제거 (사용자 결정 2026-05-21).
   * 다시 추가 시 옛 처치가 의도치 않게 부활하지 않도록. */
  if(wasSelected && _removedLabel){
    /* 해제 대상 증상이 V/S 측정·신체사정 칩을 갖고 있었는지 — 삭제 전 캡처 (연결 데이터 정리 게이트) */
    var _rmArr=(_symTreatmentsBySym&&_symTreatmentsBySym[_removedLabel])||[];
    var _hadVs=_rmArr.some(function(x){return String(x).indexOf('V/S 측정')!==-1;});
    var _hadPa=_rmArr.some(function(x){return String(x).indexOf('신체사정')!==-1;});
    if(_symTreatmentsBySym && _symTreatmentsBySym[_removedLabel]){
      delete _symTreatmentsBySym[_removedLabel];
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    }
    /* 약품·도즈 맵도 함께 제거 — 처치와 동일 사유(고아·부활 방지). 검증 2026-06-05. */
    if(_symMedsBySym && _symMedsBySym[_removedLabel]) delete _symMedsBySym[_removedLabel];
    if(_symMedDosesBySym && _symMedDosesBySym[_removedLabel]) delete _symMedDosesBySym[_removedLabel];
    /* 그 증상에만 있던 V/S·신체사정이면 record-level 데이터도 함께 정리. 2026-07-20 */
    _symClearOrphanVsPa((typeof S!=='undefined'&&S._symPopupRecId!=null)?S._symPopupRecId:null, _hadVs, _hadPa);
  }
  /* 선택 추가 시 — 키오스크 접수로 들어온 미귀속(symptom 없는) 바디맵 마커를 이 증상에 자동 귀속 (사용자 요청 2026-06-11).
   *  방문자가 키오스크에서 찍은 바디맵이, 보건교사가 중분류 증상을 고르는 즉시 그 증상에 적용되게. 키오스크 기록(memo)에 한정 — 일반 기록 동작 불변. */
  if(!wasSelected){
    const _recIdA=(typeof S!=='undefined'&&S._symPopupRecId!=null)?S._symPopupRecId:null;
    if(_recIdA!=null && window._bmData && Array.isArray(window._bmData[_recIdA]) && window._bmData[_recIdA].length){
      const _recA=Array.isArray(S.records)?S.records.find(function(r){return r.id===_recIdA;}):null;
      if(_recA && String(_recA.memo||'').indexOf('키오스크')!==-1){
        const _mA=String(sym).match(/^(.+?)\s*\(/);
        const _baseA=_mA?_mA[1].trim():String(sym);
        let _chA=false;
        window._bmData[_recIdA].forEach(function(mk){ if(mk && !mk.symptom){ mk.symptom=_baseA; _chA=true; } });
        if(_chA && typeof window._bmPersist==='function')window._bmPersist(_recIdA);
      }
    }
  }
  /* 선택 해제 시 — 그 증상에 부착된 바디맵 마커도 함께 제거 (사용자 요청) */
  if(wasSelected){
    const _m=String(sym).match(/^(.+?)\s*\(/);
    const _base=_m?_m[1].trim():String(sym);
    const recId=(typeof S!=='undefined'&&S._symPopupRecId!=null)?S._symPopupRecId:null;
    if(recId!=null && window._bmData && window._bmData[recId]){
      window._bmData[recId]=window._bmData[recId].filter(function(m){return m && m.symptom!==_base;});
      if(typeof window._bmPersist==='function')window._bmPersist(recId);
    }
  }
  const cnt=document.getElementById('symSelCount');
  if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
  const activeCat=document.querySelector('.sym-cat-item .sym-cat-arrow[style*="visibility: visible"]');
  if(activeCat)_symSelectCat(activeCat.parentElement.dataset.cat);
  _symRenderTreatPanel();
  _symUpdateCatHighlights();
  _symAutoSave();
}

/* ═══════════════════════════════════════════════════════════════════
 * v3+ 증상별 처치 블록 분기 헬퍼 (사용자 결정 2026-05-20)
 *   · 우측 처치 패널을 증상마다 별도 블록으로 분기.
 *   · 옛 일지 (treatment_by_sym 없음) → "선택 증상에 대한 처치" 단일 블록 폴백.
 *   · 침상·V/S = record-level (어느 블록 클릭이든 같은 데이터)
 *   · 투약·일반 처치 = 증상별 분리 (Phase 3 에서 핸들러 연동)
 * ═══════════════════════════════════════════════════════════════════ */

/* v3 (사용자 결정 2026-05-21) — V/S 측정 칩의 값 부착 헬퍼.
 * 라벨 매핑: T(체온) · BP(혈압) · P(맥박) · R(호흡) · SpO₂(산소포화도) · BST(혈당).
 * 의학 표준 순서로 정렬. 입력된 값만 콤마 join. 결과: "(BP: 150/100, T: 38.7)" 형태.
 * SpO₂ 의 2 는 유니코드 아래첨자(U+2082) 로 자연스럽게 작게 표시. */
function _vsValueStr(rec){
  if(!rec) return '';
  const parts = [];
  if(rec.temp) parts.push('T: ' + rec.temp);
  if(rec.bp) parts.push('BP: ' + rec.bp);
  if(rec.pulse) parts.push('P: ' + rec.pulse);
  /* respiration · resp 두 필드명 모두 지원 (legacy 호환) */
  const _resp = rec.respiration || rec.resp || '';
  if(_resp) parts.push('R: ' + _resp);
  if(rec.spo2) parts.push('SpO₂: ' + rec.spo2);
  if(rec.bst) parts.push('BST: ' + rec.bst);
  return parts.length ? '(' + parts.join(', ') + ')' : '';
}

/* 카테고리 찾기 — symptom base name 으로 유효 분류 검색 (사용자 추가 분류·증상 포함, 2026-06-12). 없으면 null */
function _symFindCategoryForSym(symBase){
  if(!symBase)return null;
  /* 선택 시 기록한 상분류 우선 — 같은 증상명이 여러 상분류에 있어도 고른 상분류로 (2026-06-25) */
  try{ if(_symSymCatMap && _symSymCatMap[symBase]){ const _sc=getEffectiveSymCatById(_symSymCatMap[symBase]); if(_sc)return _sc; } }catch(_){}
  let _us={};try{_us=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');}catch(_){}
  const cats=getEffectiveSymCats(true);
  for(let i=0;i<cats.length;i++){
    const c=cats[i];
    if(!c)continue;
    if(Array.isArray(c.symptoms)&&c.symptoms.indexOf(symBase)!==-1)return c;
    if((_us[c.id]||[]).indexOf(symBase)!==-1)return c;
  }
  return null;
}

/* 라벨 분리 — "찰과상 (오른쪽 무릎, 범위 2cm)" → {base:'찰과상', memo:'오른쪽 무릎, 범위 2cm'} */
function _symSplitSymLabel(symLabel){
  const s=String(symLabel||'').trim();
  const m=s.match(/^(.+?)\s*\((.*)\)\s*$/);
  if(m)return {base:m[1].trim(), memo:m[2]};
  return {base:s, memo:''};
}

/* flat _symSelectedTreatments 재계산 — _symTreatmentsBySym 의 union + record-level 보존 */
function _symRecomputeFlatTreatments(){
  /* v3 (2026-05-28) — V/S·침상도 per-symptom 으로 귀속 → record-level 공유 폐지.
   * 모든 처치(투약·V/S·침상 포함)는 sym-key 별 분리. */
  const _RECORD_LEVEL = new Set();
  const recordLevelTreats = _symSelectedTreatments.filter(function(t){
    let _base=t;
    const _bm=t.match(/^(.+?)\s*\((.*)\)\s*$/);
    if(_bm)_base=_bm[1].trim();
    return _RECORD_LEVEL.has(_base);
  });
  /* v3 fix (사용자 보고 2026-05-21) — legacy 자유 기입 처치 보존.
   * 옛 코드: flat = recordLevel + Σ(_symTreatmentsBySym) 로 재계산 → _symTreatmentsBySym 에 없는 legacy 자유 기입 처치가 wipe.
   *   사용자가 ✕ 한 개 클릭 시 나머지 자유 기입 처치들도 모두 사라지는 회귀.
   * 새: _symTreatmentsBySym 의 어디에도 없는 처치(=legacy 자유 기입)는 그대로 보존. */
  const knownInBySym = new Set();
  Object.keys(_symTreatmentsBySym).forEach(function(k){
    const arr=_symTreatmentsBySym[k];
    if(Array.isArray(arr))arr.forEach(function(t){knownInBySym.add(t);});
  });
  /* 사용자 보고 2026-05-22 — legacyFreeText 의 중복 제거 보강.
   *  옛 자유 기입 수정 회귀로 인해 rec.treatment 에 같은 처치가 여러 번 누적 저장된 케이스가 있음 (3중·4중 표시).
   *  filter 결과에서 동일 처치는 한 번만 보존하여 옛 누적 데이터도 다음 저장 시 자동 정리되도록. */
  const legacyFreeText = [];
  _symSelectedTreatments.forEach(function(t){
    let _base=t;
    const _bm=t.match(/^(.+?)\s*\((.*)\)\s*$/);
    if(_bm)_base=_bm[1].trim();
    if(_RECORD_LEVEL.has(_base) || knownInBySym.has(t)) return;
    if(legacyFreeText.indexOf(t) !== -1) return;
    legacyFreeText.push(t);
  });
  const symLevelTreats=[];
  Object.keys(_symTreatmentsBySym).filter(function(k){
    /* 분기 모드: __flat__ 제외 / 미분기 모드: __flat__ 만 union. legacy 는 전부.
     *  기존 분기 데이터엔 __flat__ 없어 무동작 → 현행과 100% 동일. (2026-06-09) */
    return _symRecordIsLegacy ? true : (_symBranchMode ? (k!==SYM_FLAT_KEY) : (k===SYM_FLAT_KEY));
  }).forEach(function(k){
    const arr=_symTreatmentsBySym[k];
    if(Array.isArray(arr)){
      arr.forEach(function(t){
        if(symLevelTreats.indexOf(t)===-1 && recordLevelTreats.indexOf(t)===-1)symLevelTreats.push(t);
      });
    }
  });
  /* 비legacy(증상별 모드): 평면 = record-level + Σ맵 만. 맵에 없는 고아 처치는 버려 '팝업에서 지운 게 표에 잔존'을 막는다.
   * legacy(옛 일지): 평면이 곧 진실이므로 legacyFreeText 도 보존 (2026-05-28 정합성 수정). */
  _symSelectedTreatments = _symRecordIsLegacy
    ? recordLevelTreats.concat(symLevelTreats).concat(legacyFreeText)
    : recordLevelTreats.concat(symLevelTreats);
  /* 상담 처치란 — 상담록 treatmentText 를 모드(분기/미분기)·맵 무관하게 flat 에 1건 반영.
   *  상담 분류는 처치 블록이 없어 treatmentBySym 경로가 없으므로 여기서 직접 합류.
   *  일반일지 처치 칸·DB·처치 통계가 기존 rec.treatment 경로로 자동 정합 (사용자 요청 2026-06-25). */
  try{
    const _cr=S.records.find(function(x){return x.id===_symPopupRecId;});
    const _ct=(_cr&&_cr.counselLog&&_cr.counselLog.treatmentText)?String(_cr.counselLog.treatmentText).trim():'';
    if(_ct && _symSelectedTreatments.indexOf(_ct)===-1) _symSelectedTreatments.push(_ct);
  }catch(_){}
}

/* ===== 분기/미분기 토글 (2026-06-09 재구현) — 팝업 전용. 일반일지 표/열 레이아웃과 무관. ===== */
function _symRenderBranchToggle(disabled){
  const _on = _symBranchMode!==false; /* true=분기 */
  const _seg=function(active,label,branch,desc){
    /* disabled(분기 전 옛 평면 기록): data-action 제거 → 클릭 무효, cursor default. (2026-06-09) */
    const _act = disabled ? '' : ' data-action="symSetBranch" data-branch="'+branch+'"';
    return '<span'+_act+' data-tooltip="'+desc+'" data-tooltip-instant="1" style="padding:4px 13px;cursor:'+(disabled?'default':'pointer')+';font-size:11.5px;font-weight:800;font-family:var(--f);'
      +(active?'background:rgba(6,182,212,0.16);color:var(--cyan)':'background:transparent;color:var(--t3)')+'">'+label+'</span>';
  };
  const _note = disabled ? '<span style="font-size:10px;color:var(--t3);font-weight:600">(분기 전 옛 기록 — 미분기 고정)</span>' : '';
  return '<div class="sym-branch-toggle" style="display:flex;align-items:center;gap:9px;margin:2px 0 12px 0;flex-wrap:wrap'+(disabled?';opacity:0.6':'')+'">'
    + '<span style="font-size:11.5px;color:var(--t3);font-weight:700">기록 방식</span>'
    + '<div style="display:inline-flex;border:1px solid var(--bdr);border-radius:9px;overflow:hidden">'
    + _seg(_on,'증상 분기 처치 기록','1','선택한 증상들을 분기하여 각각의 처치를 기록합니다.')
    + _seg(!_on,'증상 미분기 처치 기록','0','선택한 증상들을 분기함 없이 처치를 한 번에 기록합니다.')
    + '</div>'+_note+'</div>';
}
/* 분기→미분기 첫 전환 시 __flat__ 가 비어있으면 분기 처치·약품 합집합으로 seed (이미 내용 있으면 보존). */
function _symSeedFlatFromBranchedIfEmpty(){
  /* 분기→미분기 전환 시 모든 증상별 처치/약품을 __flat__ 에 '항상' 합집합 merge.
   *  (2026-06-09 수정: 예전엔 __flat__ 가 비었을 때만 모아서, 한 번이라도 미분기를 봤거나 __flat__에
   *   내용이 있으면 분기 처치가 다시 안 모이던 문제. 이제 미분기 누를 때마다 현재 분기 처치가 다 모임.
   *   기존 __flat__ 내용도 union 으로 보존.) */
  if(!Array.isArray(_symTreatmentsBySym[SYM_FLAT_KEY])) _symTreatmentsBySym[SYM_FLAT_KEY]=[];
  if(!Array.isArray(_symMedsBySym[SYM_FLAT_KEY])) _symMedsBySym[SYM_FLAT_KEY]=[];
  if(!_symMedDosesBySym[SYM_FLAT_KEY] || typeof _symMedDosesBySym[SYM_FLAT_KEY]!=='object') _symMedDosesBySym[SYM_FLAT_KEY]={};
  const _t=_symTreatmentsBySym[SYM_FLAT_KEY], _m=_symMedsBySym[SYM_FLAT_KEY], _md=_symMedDosesBySym[SYM_FLAT_KEY];
  Object.keys(_symTreatmentsBySym).forEach(function(k){
    if(k===SYM_FLAT_KEY)return;
    (_symTreatmentsBySym[k]||[]).forEach(function(x){ if(_t.indexOf(x)===-1)_t.push(x); });
  });
  Object.keys(_symMedsBySym).forEach(function(k){
    if(k===SYM_FLAT_KEY)return;
    (_symMedsBySym[k]||[]).forEach(function(name){
      if(_m.indexOf(name)===-1)_m.push(name);
      const d=_symMedDosesBySym[k]&&_symMedDosesBySym[k][name]; if(d&&!_md[name])_md[name]=d;
    });
  });
}
/* 토글 클릭 — 분기(1)/미분기(0) 전환. 두 저장소(증상별 키 · __flat__) 모두 보존, 팝업 표시만 전환. */
function _symSetBranch(branch){
  const _next=(String(branch)==='1');
  if(_next===(_symBranchMode!==false)) return; /* 변화 없음 */
  if(!_next) _symSeedFlatFromBranchedIfEmpty(); /* 미분기로 갈 때만 seed */
  _symBranchMode=_next;
  _symRecomputeFlatTreatments();
  _symRenderTreatPanel(_symPopupRecId);
  _symAutoSave();
}

/* 한 블록의 HTML 렌더링 — opts: {label, symLabels[], treatments[], isLegacy, index, symKey} */
function _symRenderSingleBlock(recId, opts){
  /* 자주 쓰는 처치 읽기 전에 옛 풀네임 키를 base 로 복구(세션 1회·멱등·삭제 0). (2026-06-09) */
  if(typeof _symMigrateFavKeysToBase==='function')_symMigrateFavKeysToBase();
  const label=opts.label||'';
  const symLabels=opts.symLabels||[];
  const treatments=opts.treatments||[];
  const isLegacy=!!opts.isLegacy;
  const idx=opts.index||0;
  const symKey=opts.symKey||'';
  /* v3 (사용자 결정 2026-05-21) — V/S 측정 칩 값 부착용 rec 참조 */
  const _curRec = S.records.find(function(r){return r.id===recId;});

  /* === Header: breadcrumb(s) + bodymap btn === */
  let headerHtml='';
  symLabels.forEach(function(sl){
    const split=_symSplitSymLabel(sl);
    const cat=_symFindCategoryForSym(split.base);
    const catHtml = cat
      ? (escHtml(cat.icon||'')+' '+escHtml(cat.name||'')+'<span class="gt"> › </span>')
      : '';
    /* 사용자 요청 2026-05-22 — breadcrumb 2층 구조:
     *   · 2층 (위): 상분류 › 중분류 (한국어 어절 단위 wrap; 영문/숫자만 break-word 안전망)
     *   · 1층 (아래): 자유 기입 메모 — block 으로 다음 줄, 상분류 시작 지점부터 정렬
     *  중분류 선택 없이 자유 기입만 한 경우(긴 base) 도 영역 밖으로 튀지 않도록 wrap.
     *  display:flex + flex-direction:column + width:100% 로 두 줄 무조건 분리 + 정렬 보장. */
    /* 사용자 요청 2026-06-05 — 브레드크럼 클릭 시 좌측 패널을 이 증상의 대분류-중분류로 전환.
     *  cat 매칭(기본 중분류 증상)일 때만 네비 가능 (사용자 추가/자유 기입 증상은 분류 매칭 불가). */
    const _navAttr = cat
      ? (' data-action="symNavCat" data-nav-cat="'+escHtml(cat.id)+'" data-sym-base="'+escHtml(split.base)+'" data-tooltip="클릭하면 이 증상의 분류로 이동합니다." data-tooltip-instant="1" style="display:flex;flex-direction:column;align-items:flex-start;width:100%;min-width:0;cursor:pointer"')
      : ' style="display:flex;flex-direction:column;align-items:flex-start;width:100%;min-width:0"';
    /* 사용자 요청 2026-06-05 — 중분류 증상 글자 오른편 ✕ : 이 증상 전체 삭제(바디맵·자유 기술·처치 포함 + 대분류-중분류 선택 해제).
     *  호버 시 노출(빈 자리는 항상 확보). _symRemoveSym 이 마커·treatmentBySym·선택 모두 정리. */
    headerHtml+='<span class="sym-breadcrumb"'+_navAttr+'>'
      + '<span style="word-break:keep-all;overflow-wrap:break-word">'+catHtml+'<b>'+escHtml(split.base)+'</b>'
      + '<span class="sym-breadcrumb-del" data-action="removeSym" data-sym="'+escHtml(split.base)+'" data-tooltip="이 증상 전체 삭제 (바디맵·자유 기술 포함, 선택 해제)" data-tooltip-instant="1">✕</span>'
      + '</span>';
    if(split.memo){
      /* split.memo 에 "부위, 자유메모" 가 합쳐져 있으므로 부위 부분 제거 (바디맵 버튼 옆에 이미 표시). 자유 메모만 노출. */
      const _bmOfSym = ((window._bmData||{})[recId] || []).filter(function(m){return m && m.symptom===split.base;}).map(function(m){return m.label;}).filter(Boolean);
      const _memoOnly = (typeof _symExtractMemoFromStored === 'function') ? _symExtractMemoFromStored(sl, _bmOfSym) : split.memo;
      if(_memoOnly){
        /* 사용자 요청 2026-06-05:
         *  · 메모 텍스트 클릭 → 자유 기술 미니 팝업을 (내용 전체 선택된 채) 다시 열고 해당 분류로 전환.
         *  · 닫힘 괄호 오른편의 ✕ 는 호버 시 노출(빈 자리는 항상 확보) → 클릭 시 이 자유 기술만 삭제(중분류 증상 메모와 연동). */
        const _navCatAttr = cat ? (' data-nav-cat="'+escHtml(cat.id)+'"') : '';
        headerHtml+='<span class="sym-memo-note" data-action="symEditMemo" data-sym-base="'+escHtml(split.base)+'" data-rec-id="'+recId+'"'+_navCatAttr+' data-tooltip="클릭하면 자유 기술 내용을 수정합니다." data-tooltip-instant="1" style="cursor:pointer">'
          /* 사용자 요청 2026-06-08 — 닫는 괄호 앞에 ✏️ 펜을 넣어 "수정 가능"을 시각적으로 표시.
           *  data-action 은 안 달아도 됨: 펜이 sym-memo-note(symEditMemo) 안에 있어 클릭 시 라벨 전체와 동일하게 수정 동작. */
          + '('+escHtml(_memoOnly)+'<span class="sym-memo-edit-pen" style="margin-left:3px;font-size:11px;line-height:1;color:#d97706">✏️</span>)'
          + '<span class="sym-memo-del" data-action="symMemoDel" data-sym-base="'+escHtml(split.base)+'" data-rec-id="'+recId+'" data-tooltip="이 자유 기술 삭제" data-tooltip-instant="1">✕</span>'
          + '</span>';
      }
    }
    headerHtml+='</span>';
  });

  /* 바디맵 입력 완료 버튼 — 단일 증상 블록 + 마커 있을 때만 */
  let bmBtnHtml='';
  if(!isLegacy && symLabels.length===1){
    const split=_symSplitSymLabel(symLabels[0]);
    const _bm=((window._bmData||{})[recId])||[];
    const _hasMarker = _bm.some(function(m){return m && m.symptom===split.base;});
    if(_hasMarker){
      /* 사용자 요청 2026-05-22 — 바디맵 입력 완료 버튼 오른편에 [부위명] 시각 표시.
       *  NRS(통증척도) 가 있는 마커는 [부위명, Vas: N] 형태로. 여러 부위면 각각 [] 로 나란히. */
      const _markers=_bm.filter(function(m){return m&&m.symptom===split.base && m.label;});
      const _partLabels=_markers.map(function(m){return m.label;});
      const _partTags=_markers.map(function(m){return m.nrs ? '['+m.label+', Vas: '+m.nrs+']' : '['+m.label+']';});
      const _title='클릭하여 바디맵 다시 열기'+(_partLabels.length?' — 부위: '+_partLabels.join(', '):'');
      bmBtnHtml='<button type="button" class="sym-bm-btn" data-action="openSymBmFromBlock" data-sym="'+escHtml(split.base)+'" data-rec-id="'+recId+'" title="'+escHtml(_title)+'">🧍 바디맵 입력 완료</button>'
        + (_partTags.length ? '<span style="margin-left:8px;font-size:11.5px;color:var(--t2);font-weight:600">'+escHtml(_partTags.join(' '))+'</span>' : '');
    }
  }

  /* === Favorites recommended Set 미리 계산 — _displayTreatments forEach 의 자유 기술 식별용 (사용자 결정 2026-05-21).
   *   · 자유 기술 처치(_symOpenFreeTextDock 으로 사용자가 자유 입력) 와 자주 쓰는 처치(fav) 구별 위함.
   *   · 자유 기술 처치의 펜 클릭 시: _symOpenFreeTextDock(initialEntry=처치명) → 처치 라벨 자체 수정
   *   · 자주 쓰는 처치의 펜 클릭 시: _symOpenTreatMemoDock → "처치 (메모)" 형태로 메모만 부착 */
  const FIXED_FAVS=['투약','침상 이용','V/S 측정','신체사정','보건교육','병원진료 권유','추적 관찰'];
  const CORE_FIXED=['투약','침상 이용','V/S 측정','신체사정'];
  const _REMOVED_TREATS=new Set(['인공눈물 적용','인공눈물','파스 적용','연고 적용']);
  let _userSymFav={};try{_userSymFav=JSON.parse(localStorage.getItem('ec_user_sym_fav')||'{}');}catch(e){}
  let _userSymRemoved={};try{_userSymRemoved=JSON.parse(localStorage.getItem('ec_user_sym_removed')||'{}');}catch(e){}
  let _legacyFav=[];try{_legacyFav=JSON.parse(localStorage.getItem('ec_user_fav_treatments')||'[]');}catch(e){}
  const recommended=new Set();
  const _baseSet=new Set();
  symLabels.forEach(function(sl){
    const sp=_symSplitSymLabel(sl);
    if(sp.base)_baseSet.add(sp.base);
  });
  /* 이 블록 증상들의 '증상별 삭제 목록(removed)' 합집합 — 기본 제공 fav(보건교육·병원진료 권유·추적 관찰)도
   *  증상별 ✕ 삭제가 반영되도록. 예전엔 FIXED_FAVS 를 무조건 추가해, ✕ 로 지워도 다시 떴음. (2026-06-09 버그수정) */
  const _removedUnion=new Set();
  _baseSet.forEach(function(base){ (_userSymRemoved[base]||[]).forEach(function(t){_removedUnion.add(t);}); });
  /* 코어(투약·침상·V/S)는 항상 유지, 그 외 기본 제공(보건교육 등)은 삭제 목록에 있으면 제외 */
  FIXED_FAVS.forEach(function(t){
    if(CORE_FIXED.indexOf(t)!==-1 || !_removedUnion.has(t))recommended.add(t);
  });
  _legacyFav.forEach(function(t){if(!_REMOVED_TREATS.has(t))recommended.add(t);});
  _baseSet.forEach(function(base){
    const removedForSym=new Set(_userSymRemoved[base]||[]);
    (_userSymFav[base]||[]).forEach(function(t){
      if(!_REMOVED_TREATS.has(t)&&!removedForSym.has(t))recommended.add(t);
    });
  });

  /* === Selected treatments chips ===
   *  · v3 (2026-05-28) — V/S·침상도 per-symptom → record-level 공유 폐지. 이 sym-key 의 처치만 표시.
   *  · legacy 블록은 flat 그대로 (sym-key 매핑 없음) */
  const _RECORD_LEVEL_BASES = new Set();
  const _recordLevelTrtFromFlat = isLegacy ? [] : _symSelectedTreatments.filter(function(t){
    let _b=t; const _bm0=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(_bm0)_b=_bm0[1].trim();
    return _RECORD_LEVEL_BASES.has(_b);
  });
  const _symLevelTrt = isLegacy ? [] : treatments.filter(function(t){
    let _b=t; const _bm0=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(_bm0)_b=_bm0[1].trim();
    return !_RECORD_LEVEL_BASES.has(_b);
  });
  const _displayTreatments = isLegacy ? treatments : _recordLevelTrtFromFlat.concat(_symLevelTrt);
  let treatChipsHtml='';
  let hasMedTreat=false;
  _displayTreatments.forEach(function(t){
    let _base=t, _memo='';
    const _bm=t.match(/^(.+?)\s*\((.*)\)\s*$/);
    if(_bm){_base=_bm[1].trim();_memo=_bm[2];}
    if(_base==='투약'){hasMedTreat=true; return;}
    const _sumAction=(_base==='침상 이용'||_base==='침상 안정')?'bedRest':'toggleTreat';
    const _isFixedSum=_base==='침상 이용'||_base==='침상 안정'||_base==='V/S 측정';
    /* v3 (사용자 결정 2026-05-21) — 자유 기술 처치 식별 (recommended Set 에 없는 처치).
     * 펜 클릭 시: 자유 기술 → 처치명 자체 수정 (editFreeText), 일반 → 메모 부착 (openTreatMemo). */
    const _isFreeText = !_isFixedSum && !recommended.has(_base);
    const _penAction = _isFreeText ? 'editFreeText' : 'openTreatMemo';
    const _penTip = _isFreeText ? '자유 기술 내용을 수정합니다.' : '처치에 대한 자세한 경위, 상태 등을 자유 기술할 수 있습니다.';
    const _penSum=_isFixedSum?'':'<span class="sym-chip-pen" data-action="'+_penAction+'" data-treat="'+escHtml(_base)+'" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" data-tooltip="'+_penTip+'" data-tooltip-instant="1" style="margin-left:5px;color:#d97706;cursor:pointer;font-size:13px;padding:0 3px;border-radius:4px;line-height:1">✏️</span>';
    const _dispBase=_treatDisplayName(_base);
    let _dispChip=_memo?(_dispBase+' ('+_memo+')'):_dispBase;
    /* v3 (사용자 결정 2026-05-21) — V/S 측정 칩에 측정값 부착.
     * BP/P/T/R/SpO₂/BST 중 입력된 값만 콤마 join → "V/S 측정 (BP: 150/100, T: 38.7)". */
    if(_base === 'V/S 측정'){
      const _vsStr = _vsValueStr(_curRec);
      if(_vsStr) _dispChip = _dispBase + ' ' + _vsStr;
    }
    else if(_base === '신체사정'){
      /* 선택 항목만 → "신체사정 (시진, 청진)", 소견 있으면 → "신체사정 (청진-둔탁음이 들림, 촉진-딱딱한 느낌)" */
      const _paStr = _physAssessDisplayStr(_curRec && _curRec.physicalAssessment);
      if(_paStr) _dispChip = _dispBase + ' ' + _paStr;
    }
    /* 합성 fav 칩 (예: "투약[X], V/S 측정, 침상 안정, 학부모 연락") 안의 V/S 측정/침상 안정 부분을
     *  개별 클릭 가능한 sub-action 으로 변환. 그 외 텍스트는 escHtml 그대로. */
    const _renderDispChip=function(s){
      let h=escHtml(s);
      h=h.replace(/V\/S 측정/g,'<span data-sub-action="openVs" data-rec-id="'+recId+'" style="text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer" data-tooltip="V/S 측정치 입력" data-tooltip-instant="1">V/S 측정</span>');
      /* 신체사정 칩 클릭 → 신체사정 입력 팝업 (V/S 와 동일 — 자주 쓰는 목록에서 다시 안 찾게, 사용자 요청 2026-08-06) */
      h=h.replace(/신체사정/g,'<span data-sub-action="openPhysAssess" data-rec-id="'+recId+'" style="text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer" data-tooltip="신체사정 입력" data-tooltip-instant="1">신체사정</span>');
      h=h.replace(/침상 안정/g,'<span data-sub-action="bedRest" data-rec-id="'+recId+'" style="text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer" data-tooltip="침상 설정" data-tooltip-instant="1">침상 안정</span>');
      return h;
    };
    treatChipsHtml+='<span class="sym-sel-chip sym-treat-chip" data-action="'+_sumAction+'" data-treat="'+escHtml(_base)+'" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" style="position:relative;display:inline-flex;align-items:center;padding:3px 10px;border-radius:12px;background:rgba(6,182,212,0.10);color:var(--cyan);border:1px solid rgba(6,182,212,0.28);font-size:12px;font-weight:700;cursor:pointer">'+_renderDispChip(_dispChip)+_penSum+'<span class="sym-chip-del" data-action="removeTreat" data-treat="'+escHtml(_base)+'" data-sym-key="'+escHtml(symKey)+'" data-tooltip="이 칩을 삭제" data-tooltip-instant="1">✕</span></span>';
  });

  /* 투약 칩 — 약품 리스트 표시.
   * v3 — sym-key 별 약품/도즈 표시 (사용자 결정 2026-05-21).
   *  · 새 모드 (isLegacy=false): _symMedsBySym[symKey] 의 약품만, 도즈는 _symMedDosesBySym[symKey][약명].
   *  · legacy 모드: 옛 record-level _symSelectedMeds / _symMedDoses 사용 (옛 일지 호환). */
  if(hasMedTreat){
    let medInner;
    const _useByForMed = !isLegacy;
    const _medList = _useByForMed ? (_symMedsBySym[symKey]||[]) : _symSelectedMeds;
    const _doseMap = _useByForMed ? (_symMedDosesBySym[symKey]||{}) : _symMedDoses;
    if(_medList.length){
      medInner=_medList.map(function(m){
        const _d=_doseMap[m];
        const _lbl=_d?(m+' ('+_d+')'):m;
        return '<span class="sym-med-item">'+escHtml(_lbl)+'<span class="sym-med-del" data-action="removeMed" data-med="'+escHtml(m)+'" data-sym-key="'+escHtml(symKey)+'" data-tooltip="이 약품만 삭제" data-tooltip-instant="1">✕</span></span>';
      }).join('<span style="opacity:.6">, </span>');
    } else {
      medInner='<span style="opacity:.7;font-style:italic">약품 미선택</span>';
    }
    treatChipsHtml+='<span class="sym-sel-chip sym-treat-chip" data-action="openMedFromChip" data-treat="투약" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" data-tooltip="클릭하여 약품 선택" data-tooltip-instant="1" style="position:relative;display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:3px 10px;border-radius:12px;background:rgba(168,85,247,0.10);color:#a855f7;border:1px solid rgba(168,85,247,0.28);font-size:12px;font-weight:700;cursor:pointer;max-width:100%">💊 '+escHtml(_treatDisplayName('투약'))+' ['+medInner+']<span class="sym-chip-del" data-action="removeTreat" data-treat="투약" data-sym-key="'+escHtml(symKey)+'" data-tooltip="이 투약 칩 삭제" data-tooltip-instant="1">✕</span></span>';
  }

  /* === Favorites — 자주 쓰는 처치. 변수들(FIXED_FAVS·CORE_FIXED·recommended 등) 은 위에서 이미 정의됨.
   *   v3 (사용자 결정 2026-05-21): 자유 기술 식별을 위해 recommended Set 을 forEach 보다 먼저 계산함. */
  const recArr=Array.from(recommended);
  recArr.sort(function(a,b){
    const pri={'투약':0,'침상 이용':1,'V/S 측정':2,'신체사정':3,'보건교육':4,'병원진료 권유':5,'추적 관찰':6};
    const pa=(a in pri)?pri[a]:99;
    const pb=(b in pri)?pri[b]:99;
    return pa-pb;
  });

  /* 카테고리 라벨 — 헤더 옆에 (외상)·(공통) 표시 */
  let _catLabel='';
  if(!isLegacy && symLabels.length===1){
    const split=_symSplitSymLabel(symLabels[0]);
    const cat=_symFindCategoryForSym(split.base);
    if(cat&&cat.name)_catLabel='('+escHtml(cat.name)+')';
  } else if(isLegacy){
    _catLabel='(공통)';
  }

  /* 자주 쓰는 처치 칩 */
  let favChipsHtml='';
  favChipsHtml+='<span class="sym-sel-chip" data-action="addUserTreat" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" data-tooltip="이 증상에 새 처치 칩을 추가합니다." data-tooltip-instant="1" style="position:relative;display:inline-flex;align-items:center;padding:3px 11px;font-size:12px;font-weight:800;border-radius:12px;cursor:pointer;border:1.5px dashed #f97316;background:rgba(249,115,22,0.12);color:#f97316;font-family:var(--f)">+ 추가</span>';
  favChipsHtml+='<span class="sym-sel-chip" data-action="openFreeText" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" style="position:relative;display:inline-flex;align-items:center;padding:3px 11px;font-size:12px;font-weight:700;border-radius:12px;cursor:pointer;border:1px solid #fbbf24;background:rgba(251,191,36,0.08);color:#d97706;font-family:var(--f)" data-tooltip="일회성으로 처치를 자유롭게 적을 수 있습니다." data-tooltip-instant="1">✏️ 처치 자유 기입</span>';
  recArr.forEach(function(t){
    const isFixed=FIXED_FAVS.indexOf(t)!==-1;
    const isCore=CORE_FIXED.indexOf(t)!==-1;
    const _disp=_treatDisplayName(t);
    let treatAction='toggleTreat';
    if(t==='침상 이용')treatAction='bedRest';
    else if(t==='V/S 측정')treatAction='openVs';
    else if(t==='신체사정')treatAction='openPhysAssess';
    const delBtn=isCore?'':'<span class="sym-chip-del" data-action="hardRemoveTreat" data-treat="'+escHtml(t)+'" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" data-tooltip="이 증상의 자주 쓰는 처치 목록에서 삭제 (Ctrl+Z로 복원 가능)" data-tooltip-instant="1">✕</span>';
    let _tipAttr='';
    if(t==='V/S 측정')_tipAttr=' data-tooltip="V/S, SpO₂, 혈당을 입력할 수 있습니다." data-tooltip-instant="1"';
    else if(t==='신체사정')_tipAttr=' data-tooltip="시진·촉진·타진·청진을 선택하고 소견을 적을 수 있습니다." data-tooltip-instant="1"';
    else if(t==='투약')_tipAttr=' data-tooltip="일반의약품을 선택할 수 있습니다." data-tooltip-instant="1"';
    else if(t==='침상 이용'||t==='침상 안정')_tipAttr=' data-tooltip="침상 선택, 시간과 알람 지정을 할 수 있습니다." data-tooltip-instant="1"';
    favChipsHtml+='<span class="sym-sel-chip sym-fav-chip" data-action="'+treatAction+'" data-treat="'+escHtml(t)+'" data-sym-key="'+escHtml(symKey)+'" data-rec-id="'+recId+'" data-is-fixed="'+(isFixed?'1':'0')+'"'+_tipAttr+' style="position:relative;display:inline-flex;align-items:center;padding:3px 11px;font-size:12px;font-weight:700;border-radius:12px;cursor:pointer;transition:all .12s;border:1px solid var(--bdr);background:transparent;color:var(--t2);font-family:var(--f)'+(isFixed?';border-style:dashed':'')+'">'+_disp+delBtn+'</span>';
  });

  /* === 블록 조립 === */
  /* 사용자 요청 2026-06-05 — 블록 라벨("N 번째 선택 증상에 대한 처치") 클릭 시에도 그 증상의 분류로 좌측 패널 전환.
   *  단일 증상(비legacy) 블록만 분류 매칭 가능. */
  let _blockNavCatId='';
  if(!isLegacy && symLabels.length===1){
    const _bnCat=_symFindCategoryForSym(_symSplitSymLabel(symLabels[0]).base);
    if(_bnCat)_blockNavCatId=_bnCat.id;
  }
  const _labelNavAttr=_blockNavCatId
    ? (' data-action="symNavCat" data-nav-cat="'+escHtml(_blockNavCatId)+'" data-tooltip="클릭하면 이 증상의 분류로 이동합니다." data-tooltip-instant="1" style="cursor:pointer"')
    : '';
  let blockHtml='';
  blockHtml+='<div class="sym-block-pair" data-sym-key="'+escHtml(symKey)+'">';
  blockHtml+='<div><span class="sym-block-label tone-mint"'+_labelNavAttr+'>'+escHtml(label)+'</span></div>';
  blockHtml+='<div class="sym-block tone-mint">';
  blockHtml+='<div class="sym-block-head">'+headerHtml+bmBtnHtml+'</div>';
  blockHtml+='<div class="sym-block-sub-title">선택한 처치 및 내용</div>';
  blockHtml+='<div class="sym-sum-wrap" style="display:flex;flex-wrap:wrap;gap:6px;position:relative">';
  if(treatChipsHtml) blockHtml+=treatChipsHtml;
  else blockHtml+='<span style="font-size:11.5px;color:var(--t3);font-style:italic;opacity:0.85;padding:4px 0">아직 선택된 처치 없음 — 아래에서 추가</span>';
  blockHtml+='</div>';
  blockHtml+='<hr class="sym-block-divider">';
  /* v4 (사용자 결정 2026-08-12) — 자주 쓰는 처치 목록은 항상 펼침 고정. hover/토글 폐지로 'open' 상시 부착. */
  blockHtml+='<div class="sym-fav-acc open">';
  blockHtml+='<div class="sym-fav-acc-head"><span class="chev">▼</span><span class="title">자주 쓰는 처치 목록</span>';
  if(_catLabel)blockHtml+='<span class="cat">'+_catLabel+'</span>';
  blockHtml+='<span class="count">'+recArr.length+'개</span>';
  blockHtml+='</div>';
  /* 안내 — "자" 글자 위치에 맞춤 (chev 10px + gap 8px + padding 12px = ~30px) */
  blockHtml+='<div style="padding:5px 12px 6px 30px;font-size:10.5px;color:var(--t3);font-weight:600;line-height:1.5">칩 하나 이상을 선택해주세요.</div>';
  blockHtml+='<div class="sym-fav-acc-body sym-fav-wrap">';
  blockHtml+=favChipsHtml;
  blockHtml+='</div>';
  blockHtml+='</div>';
  blockHtml+='</div>';
  blockHtml+='</div>';
  return blockHtml;
}

/* 이벤트 위임 — 중복 등록 방지. Phase 3: 핸들러에 sym-key 인자 전달. */
/* ═══════════════════════════════════════════════════════════════════
 * 상담록 (사용자 요청 2026-06-12)
 *  · 상담 분류(counsel)의 중분류(주제)를 선택하면 우측 처치 패널에 처치 블록 대신 상담록 블록 렌더.
 *  · 구성: 의뢰 경로 / 상담 내용(주호소) / 조치·지도 내용(+빠른 칩) / 상담자 의견 / 재상담 예정일.
 *  · 저장: rec.counselLog → extra_json.counsel_log (스키마 변경 없음). 입력 idle 600ms 자동 저장 + render:daily.
 *  · 회차: 같은 사람의 과거 상담록(내용 있는 것) 수 + 1. 배지 클릭 = 과거 내역 미니 팝업(누적 조회).
 *  · PDF/인쇄: 응급처치 기록지와 동일 경로 (saveA4Pdf / openA4PrintDialog — 3인치 감열 프린터 자동 제외).
 * ═══════════════════════════════════════════════════════════════════ */
function _symBaseName(label){ const m=String(label||'').match(/^(.+?)\s*\(/); return m?m[1].trim():String(label||'').trim(); }
function _symCounselSymSet(){
  const out={};
  try{ const c=getEffectiveSymCatById('counsel'); ((c&&c.symptoms)||[]).forEach(function(s){out[s]=1;}); }catch(_){}
  try{ const u=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}'); (u['counsel']||[]).forEach(function(s){out[s]=1;}); }catch(_){}
  return out;
}
function _symIsCounselSym(label){
  /* 일반일지 저장 라벨 "상담[학업 관련 상담]" 도 상담 증상으로 인식 (내부 표현은 raw "학업") */
  if(_symCounselParseDisplay(label)!=null)return true;
  return !!_symCounselSymSet()[_symBaseName(label)];
}
/* 일반일지 저장·표시용 라벨 ↔ 내부 표현 변환 (사용자 요청 2026-06-13).
 *  내부 _symSelectedSymptoms 는 raw 주제("학업")로 두고, rec.symptoms 에 쓸 때만 "상담[학업 관련 상담]" 으로 장식.
 *  팝업 로드 시 역변환해 칩 매칭·상담 블록 로직이 raw 주제로 동작하도록 한다. */
function _symCounselDisplayLabel(topic){ return '상담['+topic+' 관련 상담]'; }
function _symCounselParseDisplay(label){
  const m=String(label||'').match(/^상담\[(.+?)\s*관련 상담\]$/);
  return m?m[1].trim():null;
}
/* rec.symptoms 로 저장할 형태로 변환 — 상담 주제는 장식, 일반 증상은 그대로 */
function _symToSavedSymptom(label){
  if(_symCounselParseDisplay(label)!=null)return label;           /* 이미 장식됨 */
  if(_symCounselSymSet()[_symBaseName(label)])return _symCounselDisplayLabel(_symBaseName(label));
  return label;
}
/* rec.symptoms 에서 내부 표현으로 역변환 — 장식 라벨은 raw 주제로 */
function _symFromSavedSymptom(label){
  const t=_symCounselParseDisplay(label);
  return t!=null?t:label;
}
function _symCounselLogOf(rec){ return (rec&&rec.counselLog&&typeof rec.counselLog==='object'&&!Array.isArray(rec.counselLog))?rec.counselLog:null; }
function _symCounselHasContent(log){ if(!log)return false; return ['content','action','plan','opinion'].some(function(k){return String(log[k]||'').trim();}); }
/* ── 상담 이력 인별 캐시 — 전 학년도 누적 조회(getDailyByPerson)로 채움. 회차·헤더 칩·이력 모달이 공유. (2026-06-14)
 *  · 일반일지(S.records)는 현재 학년도만이라 과거 상담을 못 봤음 → person_uid 로 전 학년도 끌어와 누적 표시.
 *  · 캐시 없으면(프리페치 전·실패) 현재 학년도 S.records 로 폴백 — 동작은 기존과 동일. */
let _clPersonCache={ uid:null, recs:null };
function _symCounselPool(stuId){
  if(stuId!=null && _clPersonCache.uid===String(stuId) && Array.isArray(_clPersonCache.recs)) return _clPersonCache.recs;
  const _clKeys=stuKeySet(stuId);   /* 이력 누락 수정 (2026-08-26) */
  return (S.records||[]).filter(function(r){return recInStuKeys(r,_clKeys);});
}
function _symCounselCount(stuId){
  return _symCounselPool(stuId).filter(function(r){return _symCounselHasContent(_symCounselLogOf(r));}).length;
}
/* 증상 팝업 열 때 전 학년도 인별 상담 기록 프리페치 → 캐시 + 헤더 칩 즉시 갱신 (편집 영역은 안 건드림) */
function _symPrefetchCounselHist(stuId){
  if(stuId==null||!window.electronAPI||!window.electronAPI.recordsGetDailyByPerson)return;
  const _uid=String(stuId);
  window.electronAPI.recordsGetDailyByPerson(_uid).then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){ _clPersonCache={ uid:_uid, recs:res.data }; _symUpdateCounselChip(_uid); }
  }).catch(function(){});
}
/* 헤더 상담 이력 칩 라벨·툴팁·색을 캐시 카운트로 갱신 (DOM 텍스트만 — 폼/입력 영향 없음) */
function _symUpdateCounselChip(stuId){
  try{
    const _sel='[data-action="openCounselHist"][data-stu-id="'+(window.CSS&&CSS.escape?CSS.escape(String(stuId)):String(stuId))+'"]';
    document.querySelectorAll(_sel).forEach(function(btn){
      const n=_symCounselCount(stuId);
      btn.innerHTML='💬 상담 이력'+(n>0?' ('+n+')':'');
      btn.setAttribute('data-tooltip', n>0?('과거 '+n+'건의 상담 내역이 있습니다. 클릭하면 주제별로 열람할 수 있습니다.'):'상담 내역이 없습니다.');
      btn.style.borderColor=n>0?'rgba(244,114,182,0.35)':'rgba(148,163,184,0.2)';
      btn.style.background=n>0?'rgba(244,114,182,0.10)':'rgba(148,163,184,0.06)';
      btn.style.color=n>0?'#f472b6':'#94a3b8';
    });
  }catch(_){}
}
/* 회차 — 같은 사람의 과거(같은 날 포함, 이 기록 제외) 상담록 수 + 1. 풀=전 학년도 캐시(없으면 현재 학년도) */
function _symCounselRound(rec){
  let n=1;
  _symCounselPool(rec.studentId).forEach(function(r){
    if(!r||r.id===rec.id)return;
    if(!_symCounselHasContent(_symCounselLogOf(r)))return;
    if(String(r.date||'')<=String(rec.date||''))n++;
  });
  return n;
}
const _CL_TA_CSS='width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:8px 10px;color:var(--t1);font-size:12px;line-height:1.55;font-family:var(--f);outline:none;resize:vertical;min-height:54px';
function _symRenderCounselBlock(recId, counselLabels){
  const rec=S.records.find(function(r){return r.id===recId;}); if(!rec)return '';
  const log=_symCounselLogOf(rec)||{};
  const topics=counselLabels.map(_symBaseName);
  const round=_symCounselRound(rec);
  let h='<div class="sym-counsel-block" data-rec-id="'+recId+'" style="border:1px solid rgba(168,85,247,0.35);border-radius:10px;padding:12px 14px;margin:10px 0;background:rgba(168,85,247,0.05)">';
  /* 헤더 — 제목·주제([N 관련 상담] 표기, 사용자 요청 2026-06-12)·회차 배지 + PDF/인쇄 버튼
   *  PDF 버튼 GUI = 응급처치 기록지(.btn-pdf), 인쇄 버튼 GUI = 커스텀 양식 출력(#vpPrintBtn 인디고 그라데이션) */
  h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    +'<span style="font-size:12.5px;font-weight:800;color:#a855f7">💬 상담록</span>'
    +'<span style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(topics.map(function(t){return '['+t+' 관련 상담]';}).join(' '))+'</span>'
    +'<button type="button" data-cl-act="hist" data-tooltip="이 사람의 과거 상담 내역(누적)을 봅니다." data-tooltip-instant="1" style="padding:2px 9px;font-size:10px;font-weight:800;border-radius:999px;border:1px solid rgba(168,85,247,0.35);background:rgba(168,85,247,0.10);color:#a855f7;cursor:pointer;font-family:var(--f)">'+round+'회기</button>'
    +'<span style="flex:1"></span>'
    +'<button type="button" class="btn-pdf" data-cl-act="pdf">📄 PDF 저장</button>'
    +'<button type="button" data-cl-act="excel" style="padding:7px 13px;font-size:11.5px;font-weight:700;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">📊 Excel 저장</button>'
    +'</div>';   /* 🖨 인쇄 버튼 제거 — 사용자 요청 2026-06-25 */
  /* 의뢰 경로 — 기입란 (사용자 결정 2026-06-12: 칩 → 자유 기입) */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin:10px 0 4px">의뢰 경로</div>'
    +'<input type="text" class="cl-inp" data-cl-field="route" value="'+escHtml(log.route||'')+'" placeholder="예: 본인 방문, 담임교사 의뢰, 보호자 요청 …" style="width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:7px 10px;color:var(--t1);font-size:12px;font-family:var(--f);outline:none">';
  /* 상담 내용 (주호소) */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin:10px 0 4px">상담 내용 (주호소)</div>'
    +'<textarea class="cl-inp" data-cl-field="content" rows="2" placeholder="학생(교직원)이 호소한 내용·경위를 기록합니다." style="'+_CL_TA_CSS+'">'+escHtml(log.content||'')+'</textarea>';
  /* 조치 및 지도 내용 — 기입란 (사용자 결정 2026-06-12: 빠른 칩 제거) */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin:10px 0 4px">조치 및 지도 내용</div>'
    +'<textarea class="cl-inp" data-cl-field="action" rows="2" placeholder="실시한 조치·교육·연계(보호자 연락, Wee클래스, 전문기관 안내 등) 내용을 기록합니다." style="'+_CL_TA_CSS+'">'+escHtml(log.action||'')+'</textarea>';
  /* 후속 조치 계획 — 기입란 (사용자 요청 2026-06-13) */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin:10px 0 4px">후속 조치 계획</div>'
    +'<textarea class="cl-inp" data-cl-field="plan" rows="2" placeholder="향후 모니터링·재상담·연계 등 후속 조치 계획을 기록합니다." style="'+_CL_TA_CSS+'">'+escHtml(log.plan||'')+'</textarea>';
  /* 상담자 의견 */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin:10px 0 4px">상담자 의견</div>'
    +'<textarea class="cl-inp" data-cl-field="opinion" rows="2" placeholder="관찰 소견·상담자(보건교사) 의견을 기록합니다." style="'+_CL_TA_CSS+'">'+escHtml(log.opinion||'')+'</textarea>';
  /* 추후 계획 — 달력 픽커 (방문 통계 기간 선택 달력과 동일 GUI + 휴일 표시, 2026-06-12) */
  h+='<div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span style="font-size:10.5px;font-weight:700;color:var(--t2)">재상담 예정일</span>'
    +'<input type="text" class="cl-inp" data-cl-field="followUp" data-cl-act="cal" readonly value="'+escHtml(log.followUp||'')+'" placeholder="클릭하여 선택" style="width:130px;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:6px 9px;color:var(--t1);font-size:11px;font-family:var(--fm);outline:none;cursor:pointer;text-align:center">'
    +(log.followUp?'<span data-cl-act="calClear" data-tooltip="재상담 예정일 지우기" data-tooltip-instant="1" style="cursor:pointer;color:var(--t3);font-size:12px;padding:2px 4px">✕</span>':'')
    +'</div>';
  /* 처치란 기입 — 상담은 처치(treatment)가 비어 일반일지 처치 칸이 공란.
   *  원하면 처치란에 들어갈 문구를 입력 (사용자 요청 2026-06-25). treatmentText → flat → rec.treatment. */
  const _ctv=String(log.treatmentText||'').trim();
  h+='<div style="margin-top:12px;padding-top:10px;border-top:1px dashed rgba(168,85,247,0.25)">'
    +'<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;font-weight:700;color:var(--t2);white-space:nowrap">'
    +'<input type="checkbox" data-cl-act="treatToggle"'+(_ctv?' checked':'')+' style="width:14px;height:14px;cursor:pointer;accent-color:#a855f7">'
    +'일반일지 처치란에 기입</label>'
    /* 기입한 문구를 칩으로 — 호버 시 우측 ✕(삭제), 클릭 시 수정 모달, 호버 시 미니 팝업 안내 (사용자 요청 2026-06-26) */
    +(_ctv
      ? '<div style="margin-top:8px"><span class="cl-treat-chip-wrap" data-cl-act="treatEdit" data-tooltip="클릭해서 수정이 가능합니다." data-tooltip-instant="1" style="position:relative;display:inline-flex;align-items:center;gap:6px;max-width:100%;vertical-align:middle;cursor:pointer;background:rgba(168,85,247,0.10);border:1px solid rgba(168,85,247,0.32);border-radius:999px;padding:5px 10px 5px 12px;color:var(--t1);font-size:12px;font-weight:600;font-family:var(--f);line-height:1.4">'
          +'<span style="min-width:0;word-break:break-word">'+escHtml(_ctv)+'</span>'
          +'<span data-cl-act="treatDelete" class="cl-treat-x" data-tooltip="이 문구 삭제" data-tooltip-instant="1" style="cursor:pointer;flex-shrink:0;width:16px;height:16px;align-items:center;justify-content:center;color:#dc2626;font-size:10px;font-weight:800;border-radius:50%;background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.4)">✕</span>'
        +'</span></div>'
      : '<div style="margin-top:6px;font-size:11px;color:var(--t3);font-style:italic">체크하면 처치란에 들어갈 문구를 입력합니다.</div>')
    +'</div>';
  h+='</div>';
  return h;
}
/* 입력 → rec.counselLog 수집·저장 (idle 600ms 디바운스 — 방문 이력 등 실시간 반영) */
let _symCounselSaveTimer=null;
function _symCounselSaveNow(recId){
  const rec=S.records.find(function(r){return r.id===recId;}); if(!rec)return;
  const blk=document.querySelector('.sym-counsel-block[data-rec-id="'+recId+'"]'); if(!blk)return;
  const log=_symCounselLogOf(rec)||{};
  blk.querySelectorAll('[data-cl-field]').forEach(function(el){ log[el.dataset.clField]=el.value; });
  /* 주제 스냅샷 — 과거 내역 팝업·인쇄에서 사용 (증상 선택이 나중에 바뀌어도 당시 주제 보존) */
  log.topics=_symSelectedSymptoms.filter(_symIsCounselSym).map(_symBaseName);
  rec.counselLog=log; rec._dirty=true;
  saveRecordNow(rec);
  bus.emit('render:daily');
}
function _symCounselQueueSave(recId){
  if(_symCounselSaveTimer)clearTimeout(_symCounselSaveTimer);
  _symCounselSaveTimer=setTimeout(function(){_symCounselSaveTimer=null;_symCounselSaveNow(recId);},600);
}
/* 상담 주제 전체 목록 — 상담 분류 기본 + 사용자 추가 (카테고리 순서 유지) */
function _symCounselTopicList(){
  let arr=[];
  try{ const c=getEffectiveSymCatById('counsel'); arr=((c&&c.symptoms)||[]).slice(); }catch(_){}
  try{ const u=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}'); (u['counsel']||[]).forEach(function(s){ if(arr.indexOf(s)===-1)arr.push(s); }); }catch(_){}
  return arr;
}
/* ── 상담 이력 통합 모달 (사용자 요청 2026-06-12) ──
 *  드롭다운(전체 + 주제별, 괄호에 횟수) → 해당 상담 일자 리스트 → 일자 클릭 → 내용. 모두 한 모달에서. */
async function _symOpenCounselHistModal(stuId, recId){
  const old=document.getElementById('clHistModal'); if(old)old.remove();
  const stu=getStu(stuId)||{};
  /* 전 학년도 인별 누적 상담 — 캐시 우선, 없으면 즉시 조회(getDailyByPerson). 실패 시 현재 학년도 S.records 폴백. (2026-06-14) */
  let pool=null;
  if(_clPersonCache.uid===String(stuId)&&Array.isArray(_clPersonCache.recs)) pool=_clPersonCache.recs;
  else if(window.electronAPI&&window.electronAPI.recordsGetDailyByPerson){
    try{ const res=await window.electronAPI.recordsGetDailyByPerson(String(stuId)); if(res&&res.success&&Array.isArray(res.data)){ pool=res.data; _clPersonCache={uid:String(stuId),recs:res.data}; } }catch(_){}
  }
  if(!pool) pool=(S.records||[]).filter(function(r){return r&&String(r.studentId)===String(stuId);});
  const all=pool.filter(function(r){
    return _symCounselHasContent(_symCounselLogOf(r));
  }).sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''));});
  const topics=_symCounselTopicList();
  const cntOf=function(t){ return all.filter(function(r){const cl=_symCounselLogOf(r);return cl&&Array.isArray(cl.topics)&&cl.topics.indexOf(t)!==-1;}).length; };
  const ov=document.createElement('div');
  ov.id='clHistModal';
  ov.style.cssText='position:fixed;inset:0;z-index:12500;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center';
  let selHtml='<option value="">전체 ('+all.length+')</option>';
  topics.forEach(function(t){ selHtml+='<option value="'+escHtml(t)+'">'+escHtml(t)+' ('+cntOf(t)+')</option>'; });
  ov.innerHTML='<div class="modal-content" style="width:580px;max-width:92vw;height:520px;max-height:82vh;display:flex;flex-direction:column;padding:0;border-radius:12px;overflow:hidden">'
    +'<div style="padding:12px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px;cursor:grab">'
    +'<span style="font-size:13.5px;font-weight:800;color:var(--t1)">💬 상담 이력 — '+escHtml(_symFullStuLabel(stu))+'</span>'
    +'<span style="flex:1"></span></div>'   /* ✕ 닫기 버튼 제거 — 배경 클릭으로 닫음 (사용자 요청 2026-06-24) */
    +'<div style="padding:12px 18px 16px;display:flex;flex-direction:column;gap:10px;min-height:0;flex:1;overflow:hidden">'
    +'<select id="clHistSel" style="width:100%;font-size:12px;padding:8px 10px;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;color:var(--t1);font-family:var(--f);outline:none;cursor:pointer">'+selHtml+'</select>'
    +'<div style="display:flex;gap:10px;min-height:0;flex:1">'
    +'<div id="clHistDates" style="width:175px;flex-shrink:0;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);scrollbar-width:thin"></div>'
    +'<div id="clHistDetail" style="flex:1;min-width:0;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;scrollbar-width:thin"></div>'
    +'</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)ov.remove(); e.stopPropagation(); });
  try{ if(typeof _makeDraggable==='function')_makeDraggable(ov.querySelector('.modal-content')); }catch(_){}
  let filtered=all, selId=(all.length?all[0].id:null);
  function renderDates(){
    const box=ov.querySelector('#clHistDates'); if(!box)return;
    if(!filtered.length){ box.innerHTML='<div style="padding:16px 10px;font-size:11px;color:var(--t3);text-align:center">상담 기록이 없습니다.</div>'; return; }
    box.innerHTML=filtered.map(function(r){
      const cl=_symCounselLogOf(r)||{};
      const tp=(cl.topics&&cl.topics.length)?cl.topics.join(', '):'';
      const act=(r.id===selId);
      return '<div data-cl-date-id="'+r.id+'" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--bdr);background:'+(act?'rgba(244,114,182,0.10)':'transparent')+';border-left:3px solid '+(act?'#f472b6':'transparent')+'">'
        +'<div style="font-size:11.5px;font-weight:700;color:'+(act?'#f472b6':'var(--t1)')+'">'+escHtml(r.date||'')+'</div>'
        +(tp?'<div style="font-size:10px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(tp)+'</div>':'')
        +'</div>';
    }).join('');
  }
  function renderDetail(){
    const box=ov.querySelector('#clHistDetail'); if(!box)return;
    const r=filtered.find(function(x){return x.id===selId;});
    if(!r){ box.innerHTML='<div style="padding:24px 0;font-size:11.5px;color:var(--t3);text-align:center">왼쪽에서 상담 일자를 선택하세요.</div>'; return; }
    const cl=_symCounselLogOf(r)||{};
    const F=function(label,val,pre){ return '<div style="margin-bottom:9px"><div style="font-size:10px;font-weight:700;color:#a855f7;margin-bottom:2px">'+label+'</div><div style="font-size:11.5px;color:var(--t1);line-height:1.6'+(pre?';white-space:pre-wrap;word-break:break-word':'')+'">'+(String(val||'').trim()?escHtml(val):'<span style="color:var(--t3)">-</span>')+'</div></div>'; };
    box.innerHTML=F('상담 일시',(r.date||'')+(r.timeIn?' '+r.timeIn:''))
      +F('주제',(cl.topics&&cl.topics.length)?cl.topics.join(', '):'')
      +F('의뢰 경로',cl.route)
      +F('상담 내용 (주호소)',cl.content,true)
      +F('조치 및 지도 내용',cl.action,true)
      +F('후속 조치 계획',cl.plan,true)
      +F('상담자 의견',cl.opinion,true)
      +F('재상담 예정일',cl.followUp);
  }
  ov.querySelector('#clHistSel').addEventListener('change',function(){
    const t=this.value;
    filtered=t?all.filter(function(r){const cl=_symCounselLogOf(r);return cl&&Array.isArray(cl.topics)&&cl.topics.indexOf(t)!==-1;}):all;
    selId=filtered.length?filtered[0].id:null;
    renderDates(); renderDetail();
  });
  ov.querySelector('#clHistDates').addEventListener('click',function(e){
    const row=e.target.closest('[data-cl-date-id]'); if(!row)return;
    selId=parseInt(row.dataset.clDateId,10);
    renderDates(); renderDetail();
  });
  renderDates(); renderDetail();
}
/* ── 재상담 예정일 달력 — 방문 통계 기간 선택 달력(mcal)과 동일 GUI + 휴일 정보 API (2026-06-12) ── */
let _clCalY=null,_clCalM=null;
function _clOpenCalPopup(recId, anchor){
  const old=document.getElementById('clCalPopup'); if(old){old.remove();return;}
  const cur=(anchor.value||'').trim();
  const base=(cur&&!isNaN(new Date(cur).getTime()))?new Date(cur):new Date();
  _clCalY=base.getFullYear(); _clCalM=base.getMonth();
  const pop=document.createElement('div');
  pop.id='clCalPopup';
  pop.style.cssText='position:fixed;z-index:12600;width:280px;border:1px solid var(--bdr);border-radius:10px;padding:8px;background:var(--card);box-shadow:0 8px 24px rgba(0,0,0,0.25)';
  document.body.appendChild(pop);
  function _position(){
    const r=anchor.getBoundingClientRect();
    let lx=r.left, ly=r.bottom+4;
    const ph=pop.offsetHeight||300;
    if(lx+288>window.innerWidth-8)lx=Math.max(8,window.innerWidth-288-8);
    if(ly+ph>window.innerHeight-8)ly=Math.max(8,r.top-ph-4);
    pop.style.left=lx+'px'; pop.style.top=ly+'px';
  }
  const _holListener=function(){ if(document.getElementById('clCalPopup'))render(); };
  try{ bus.on('holidays:updated',_holListener); }catch(_){}
  function _close(){
    const p=document.getElementById('clCalPopup'); if(p)p.remove();
    document.removeEventListener('mousedown',_out,true);
    try{ bus.off('holidays:updated',_holListener); }catch(_){}
  }
  function _out(e){ if(!pop.contains(e.target)&&e.target!==anchor)_close(); }
  function render(){
    try{ if(typeof ensureHolidayYear==='function')ensureHolidayYear(_clCalY); }catch(_){}
    const first=new Date(_clCalY,_clCalM,1), last=new Date(_clCalY,_clCalM+1,0);
    const startDay=first.getDay(), daysInMonth=last.getDate();
    const prevLast=new Date(_clCalY,_clCalM,0).getDate();
    const today=toDateStr(new Date());
    const selVal=(anchor.value||'').trim();
    /* 연/월 선택 팝업 — 재상담은 미래 일정이므로 올해 전후 연도 제공 */
    let yPop='<div class="mcal-popup">';
    { const _ny=new Date().getFullYear(); for(let y=_ny-1;y<=_ny+1;y++) yPop+='<div class="mcal-popup-item'+(y===_clCalY?' active':'')+'" data-action="clcal-year" data-year="'+y+'">'+y+'</div>'; }
    yPop+='</div>';
    let mPop='<div class="mcal-popup" style="min-width:140px;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
    for(let m=0;m<12;m++) mPop+='<div class="mcal-popup-item'+(m===_clCalM?' active':'')+'" data-action="clcal-month" data-month="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
    mPop+='</div>';
    let h='<div style="font-size:11px;color:var(--cyan);font-weight:600;text-align:center;margin-bottom:4px">재상담 예정일 선택</div>';
    h+='<div class="mcal-hdr" style="margin-bottom:4px">';
    h+='<div class="mcal-nav"><button class="mcal-btn" data-action="clcal-prev">◂</button></div>';
    h+='<div class="mcal-title"><span class="mcal-year">'+_clCalY+'년'+yPop+'</span> <span class="mcal-month">'+monthNames[_clCalM]+mPop+'</span></div>';
    h+='<div class="mcal-nav"><button class="mcal-btn" data-action="clcal-next">▸</button></div>';
    h+='</div><div class="mcal-grid">';
    ['일','월','화','수','목','금','토'].forEach(function(d,i){
      let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
      h+='<div class="'+cls+'">'+d+'</div>';
    });
    for(let i=startDay-1;i>=0;i--) h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
    for(let d=1;d<=daysInMonth;d++){
      const ds=toDateStr(new Date(_clCalY,_clCalM,d));
      const dow=new Date(_clCalY,_clCalM,d).getDay();
      const hol=isHoliday(ds);
      const holName=hol?S.koreanHolidays[ds]:'';
      let cls='mcal-cell';
      if(ds===today)cls+=' today';
      if(dow===0)cls+=' sun';if(dow===6)cls+=' sat';
      if(hol&&dow!==0&&dow!==6)cls+=' holiday';
      if(ds===selVal)cls+=' selected';
      const title=holName||(dow===0?'일요일':dow===6?'토요일':'');
      h+='<div class="'+cls+'" data-action="clcal-select" data-date="'+ds+'"'+(title?' title="'+title+'"':'')+'><span class="day-n">'+d+'</span></div>';
    }
    const totalCells=startDay+daysInMonth;const rem=(7-totalCells%7)%7;
    for(let i=1;i<=rem;i++) h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
    h+='</div>';
    pop.innerHTML=h;
    _position();
  }
  pop.addEventListener('click',function(e){
    e.stopPropagation();
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='clcal-year'){_clCalY=+el.dataset.year;render();}
    else if(act==='clcal-month'){_clCalM=+el.dataset.month;render();}
    else if(act==='clcal-prev'){_clCalM--;if(_clCalM<0){_clCalM=11;_clCalY--;}render();}
    else if(act==='clcal-next'){_clCalM++;if(_clCalM>11){_clCalM=0;_clCalY++;}render();}
    else if(act==='clcal-select'){
      anchor.value=el.dataset.date;
      _symCounselSaveNow(recId);
      _close();
      _symRenderTreatPanel(recId); /* ✕(지우기) 표시 갱신 */
    }
  });
  setTimeout(function(){document.addEventListener('mousedown',_out,true);},0);
  render();
}
/* 인쇄/PDF 용 소속 문자열 — EC 기록지 규칙과 동일 (학교급 여러 개면 접두, 학과 포함) */
function _symCounselGradeStr(s){
  if(!s)return '';
  if(s.type==='staff')return (s.position||'교직원');
  const multi=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const lv=multi?(getLevelShort(s)||''):'';
  const dept=(s.department||'').trim();
  return (lv?'('+lv+') ':'')+(dept?dept+' ':'')+(s.grade||'')+'학년 '+(s.cls||'')+'반'+(s.num?' '+s.num+'번':'');
}
/* 팝업 헤더용 전체 소속 라벨 — 학교급(여러 개일 때만 접두) + 학과(있으면) + 학년·반·번호 + 이름.
 *  V/S 시계열·상담 이력 등 팝업 헤더 공용 (사용자 요청 2026-06-18). */
function _symFullStuLabel(stu){
  if(!stu) return '';
  if(stu.type==='staff') return ((stu.position||'교직원')+' '+(stu.name||'')).trim();
  const multi=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const lv=multi?(getLevelShort(stu)||''):'';
  const dept=String(stu.department||'').trim();
  return ((lv?lv+' ':'')+(dept?dept+' ':'')+(stu.grade?stu.grade+'학년 ':'')+(stu.cls?stu.cls+'반 ':'')+(stu.num?stu.num+'번 ':'')+(stu.name||'')).trim();
}
export function _symBuildCounselPrintHtml(rec){
  const s=getStu(rec.studentId)||{};
  const log=_symCounselLogOf(rec)||{};
  const topics=(log.topics&&log.topics.length)?log.topics:_symSelectedSymptoms.filter(_symIsCounselSym).map(_symBaseName);
  const round=_symCounselRound(rec);
  const nurse=rec.nurse||((S._currentUser&&S._currentUser.name)||'');
  const school=(S.settings&&S.settings.schoolName)||'';
  const _d=new Date();
  const today=_d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
  const short=String(_d.getFullYear()).slice(2)+String(_d.getMonth()+1).padStart(2,'0')+String(_d.getDate()).padStart(2,'0');
  const fname=(s.name||'')+'_상담기록지('+short+')';
  const _lc=function(v){return escHtml(String(v||'-'));};
  let html='<html><head><meta charset="utf-8"><title>'+escHtml(fname)+'</title><style>'
    +'@page{size:A4;margin:20mm 12mm}body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:0;margin:0;color:#111}'
    +'table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-bottom:14px}thead{display:table-header-group}'
    +'tr,td,th{page-break-inside:avoid;break-inside:avoid}'
    +'th,td{border:1px solid #999;padding:7px 9px;text-align:left;vertical-align:top}th+th,td+td,th+td,td+th{border-left:0}tr+tr td,tr+tr th{border-top:0}'
    +'th{background:#f0f0f0;font-weight:700;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.section-title{background:#ede9fe;font-weight:700;text-align:center;padding:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.long-cell{white-space:pre-wrap;word-break:break-word;height:64px}'
    /* 색상바 — 보건일지 제목 색상바와 동일 (위:파랑70%+금30% / 아래:초록30%+빨강70%) (사용자 요청 2026-06-25) */
    +'.bar{display:flex;height:5px;overflow:hidden;border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.bar.top .b1{flex:7;background:#2855A0}.bar.top .b2{flex:3;background:#D4A843}'
    +'.bar.bot .b3{flex:3;background:#2E8B57}.bar.bot .b4{flex:7;background:#C0392B}'
    +'h2{text-align:center;margin:10px 0;font-size:20px;letter-spacing:8px}'
    +'</style></head><body>'
    /* 제목 — 위아래 색상바 (사용자 요청 2026-06-12, 색상 통일 2026-06-25) */
    +'<div class="bar top"><span class="b1"></span><span class="b2"></span></div><h2>상 담 기 록 지</h2><div class="bar bot" style="margin-bottom:16px"><span class="b3"></span><span class="b4"></span></div>';
  html+='<table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%"></colgroup>'
    +'<tr><th>이름</th><td>'+_lc(s.name)+'</td><th>성별</th><td>'+_lc(s.gender)+'</td></tr>'
    +'<tr><th>소속</th><td>'+_lc(_symCounselGradeStr(s))+'</td><th>상담 일시</th><td>'+_lc((rec.date||'')+(rec.timeIn?' '+rec.timeIn:''))+'</td></tr>'
    +'<tr><th>상담 주제</th><td>'+_lc(topics.join(', '))+'</td><th>회차</th><td>'+round+'회기</td></tr>'
    +'<tr><th>의뢰 경로</th><td colspan="3">'+_lc(log.route)+'</td></tr></table>';
  html+='<table><thead><tr><td class="section-title">상담 내용 (주호소)</td></tr></thead><tbody><tr><td class="long-cell">'+_lc(log.content)+'</td></tr></tbody></table>';
  html+='<table><thead><tr><td class="section-title">조치 및 지도 내용</td></tr></thead><tbody><tr><td class="long-cell">'+_lc(log.action)+'</td></tr></tbody></table>';
  html+='<table><thead><tr><td class="section-title">후속 조치 계획</td></tr></thead><tbody><tr><td class="long-cell">'+_lc(log.plan)+'</td></tr></tbody></table>';
  html+='<table><thead><tr><td class="section-title">상담자 의견</td></tr></thead><tbody><tr><td class="long-cell">'+_lc(log.opinion)+'</td></tr></tbody></table>';
  html+='<table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%"></colgroup><thead><tr><td class="section-title" colspan="4">추후 계획 · 작성 정보</td></tr></thead><tbody>'
    +'<tr><th>재상담 예정일</th><td>'+_lc(log.followUp)+'</td><th>상담자</th><td>'+_lc(nurse)+'</td></tr>'
    +'<tr><th>작성일</th><td>'+_lc(today)+'</td><th>학교</th><td>'+_lc(school)+'</td></tr>'
    +'</tbody></table>';
  html+='</body></html>';
  return {html:html, fname:fname};
}
function _symCounselExport(recId, mode){
  if(_symCounselSaveTimer){clearTimeout(_symCounselSaveTimer);_symCounselSaveTimer=null;}
  _symCounselSaveNow(recId);                       /* 미저장 입력 flush 후 출력 */
  const rec=S.records.find(function(r){return r.id===recId;}); if(!rec)return;
  if(mode==='excel'){ _symCounselExportExcel(rec); return; }
  const b=_symBuildCounselPrintHtml(rec);
  if(mode==='pdf')saveA4Pdf({html:b.html, title:b.fname, cssMargins:true});
  else openA4PrintDialog({html:b.html, title:b.fname, headerLabel:'상담록 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}});
}
/* 상담 기록지 1건의 폼 데이터 — PDF(_symBuildCounselPrintHtml)와 동일한 추출 로직. Excel 폼 빌더(xlsxBuildCounsel)용. (2026-06-25) */
export function _symCounselSheetData(rec){
  const s=getStu(rec.studentId)||{};
  const log=_symCounselLogOf(rec)||{};
  const topics=(log.topics&&log.topics.length)?log.topics:_symSelectedSymptoms.filter(_symIsCounselSym).map(_symBaseName);
  const round=_symCounselRound(rec);
  const nurse=rec.nurse||((S._currentUser&&S._currentUser.name)||'');
  const school=(S.settings&&S.settings.schoolName)||'';
  const _d=new Date();
  const today=_d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
  return {
    wsName:((s.name||'')+'_'+(rec.date||'').replace(/-/g,'')).slice(0,28)||'상담',
    name:s.name||'', gender:s.gender||'', soc:_symCounselGradeStr(s)||'',
    datetime:(rec.date||'')+(rec.timeIn?' '+rec.timeIn:''),
    topics:topics.join(', '), round:round+'회기', route:log.route||'',
    content:log.content||'', action:log.action||'', plan:log.plan||'',
    opinion:log.opinion||'', followUp:log.followUp||'', nurse:nurse, today:today, school:school
  };
}
/* 상담 기록지 Excel 저장 — PDF 폼과 동일 레이아웃(xlsxBuildCounsel). 단일 레코드. (사용자 요청 2026-06-25) */
function _symCounselExportExcel(rec){
  if(!(window.electronAPI&&window.electronAPI.xlsxBuildCounsel)){bus.emit('toast:show',{text:'Excel 저장 기능을 사용할 수 없습니다.'});return;}
  const s=getStu(rec.studentId)||{};
  const _d=new Date();
  const short=String(_d.getFullYear()).slice(2)+String(_d.getMonth()+1).padStart(2,'0')+String(_d.getDate()).padStart(2,'0');
  const fname=(s.name||'')+'_상담기록지('+short+').xlsx';
  bus.emit('toast:show',{text:'Excel 생성 중…'});
  window.electronAPI.xlsxBuildCounsel({records:[_symCounselSheetData(rec)]}).then(function(res){
    if(!res||!res.success){bus.emit('toast:show',{text:'Excel 생성 실패: '+((res&&res.error)||'')});return;}
    if(window.electronAPI.saveBytesDialog){
      window.electronAPI.saveBytesDialog(fname,res.bytes,[{name:'Excel 통합 문서',extensions:['xlsx']}]).then(function(sv){
        if(sv&&sv.success&&!sv.canceled)bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
        else if(!(sv&&sv.success))bus.emit('toast:show',{text:'Excel 저장 실패: '+((sv&&sv.error)||'')});
      }).catch(function(e){bus.emit('toast:show',{text:'Excel 저장 오류: '+(e&&e.message||e)});});
    }
  }).catch(function(e){bus.emit('toast:show',{text:'Excel 오류: '+(e&&e.message||e)});});
}

/* ── 상담 처치란 입력 (사용자 요청 2026-06-25) ──
 *  상담은 처치(treatment)가 비어 일반일지 처치 칸이 공란. 체크박스 → 단순 자유 텍스트 미니 모달 →
 *  rec.counselLog.treatmentText 에 보관 → _symRecomputeFlatTreatments 가 flat(rec.treatment)에 1건 합류.
 *  일반일지 처치 칸·DB·처치 통계가 기존 처치 경로로 자동 정합. */
function _symOpenCounselTreatModal(recId){
  const rec=S.records.find(function(x){return x.id===recId;}); if(!rec)return;
  const cur=(rec.counselLog&&rec.counselLog.treatmentText)?String(rec.counselLog.treatmentText):'';
  const old=document.getElementById('clTreatModal'); if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='clTreatModal';
  ov.style.cssText='position:fixed;inset:0;z-index:13000;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center';
  ov.innerHTML='<div class="modal-content" style="width:460px;max-width:92vw;padding:0;border-radius:12px;overflow:hidden">'
    +'<div style="padding:12px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">보건일지표 처치란에 기입할 문구</div>'
    +'<div style="padding:16px 18px">'
    +'<textarea id="clTreatTa" rows="3" placeholder="예: 보건교육 실시, 학부모 연락, Wee클래스 연계 안내 …" style="'+_CL_TA_CSS+'">'+escHtml(cur)+'</textarea>'
    +'<div style="font-size:10.5px;color:var(--t3);margin-top:8px;line-height:1.55">이 문구는 보건일지표의 <b style="color:var(--t2)">처치</b> 칸에 그대로 표시되며, 처치 통계에도 1건으로 집계됩니다.<br>입력하면 자동 저장되며, 팝업 바깥을 클릭하면 닫힙니다.</div>'
    +'</div></div>';
  document.body.appendChild(ov);
  const ta=ov.querySelector('#clTreatTa'); if(ta){ta.focus();try{ta.setSelectionRange(ta.value.length,ta.value.length);}catch(_){}}
  /* 취소·확인 버튼 제거 — 입력 즉시 자동 저장(디바운스), 바깥 클릭/Esc = 저장 후 닫기 (사용자 요청 2026-06-25) */
  function _apply(){
    const v=ta?String(ta.value).trim():'';
    if(!rec.counselLog||typeof rec.counselLog!=='object'||Array.isArray(rec.counselLog))rec.counselLog={};
    rec.counselLog.treatmentText=v;
    _symCounselApplyTreat(recId);
  }
  let _clTreatSaveT=null, _clTreatClosed=false;
  if(ta)ta.addEventListener('input',function(){ if(_clTreatSaveT)clearTimeout(_clTreatSaveT); _clTreatSaveT=setTimeout(_apply,500); });
  function _clTreatClose(){ if(_clTreatClosed)return; _clTreatClosed=true; if(_clTreatSaveT){clearTimeout(_clTreatSaveT);_clTreatSaveT=null;} _apply(); document.removeEventListener('keydown',_clTreatKey,true); ov.remove(); }
  function _clTreatKey(e){ if(e.key==='Escape'){e.preventDefault();_clTreatClose();} }
  document.addEventListener('keydown',_clTreatKey,true);
  /* Enter = 저장 후 닫기 / Shift+Enter = 줄바꿈 / ESC = 저장 후 닫기 (사용자 요청 2026-06-26) */
  if(ta)ta.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); e.stopPropagation(); _clTreatClose(); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); _clTreatClose(); }
  });
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)_clTreatClose(); });
}
/* 상담 처치란 적용 — flat 재계산 + 저장(rec.treatment·counselLog·DB) + 일반일지/패널 갱신 */
function _symCounselApplyTreat(recId){
  const rec=S.records.find(function(x){return x.id===recId;}); if(!rec)return;
  rec._dirty=true;
  if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
  if(typeof _symAutoSave==='function')_symAutoSave();      /* rec.treatment·treatmentBySym·DB 반영 */
  if(typeof saveRecordNow==='function')saveRecordNow(rec); /* counselLog.treatmentText 영속 */
  bus.emit('render:daily');
  _symRenderTreatPanel(recId);                             /* 체크박스·요약 UI 갱신 */
}

function _symBindTreatPanelEvents(panel){
  if(!panel||panel._symTreatDelegated)return;
  panel._symTreatDelegated=true;
  /* ── 상담록 입력 위임 (2026-06-12) — textarea/일자 입력 → idle 600ms 자동 저장 ── */
  panel.addEventListener('input',function(e){
    const fld=e.target.closest&&e.target.closest('[data-cl-field]');
    if(!fld)return;
    const blk=fld.closest('.sym-counsel-block'); if(!blk)return;
    _symCounselQueueSave(parseInt(blk.dataset.recId,10));
  });
  panel.addEventListener('change',function(e){
    const fld=e.target.closest&&e.target.closest('[data-cl-field]');
    if(!fld)return;
    const blk=fld.closest('.sym-counsel-block'); if(!blk)return;
    _symCounselQueueSave(parseInt(blk.dataset.recId,10));
  });
  panel.addEventListener('click',function(e){
    /* 합성 fav 칩 안 sub-action (V/S 측정, 침상 안정) — 가장 먼저 검사하여
     *  부모 칩의 toggleTreat 핸들러로 전파되지 않도록 stopPropagation */
    const subAct=e.target.closest('[data-sub-action]');
    if(subAct){
      e.stopPropagation();
      const act=subAct.dataset.subAction;
      const _rid=parseInt(subAct.dataset.recId,10)||0;
      const _saBp=subAct.closest('.sym-block-pair');
      const _saSk=_saBp?_saBp.dataset.symKey:'';
      if(act==='openVs'){
        _symOpenVsPopup(_rid, subAct, _saSk);
      } else if(act==='openPhysAssess'){
        _symOpenPhysAssessPopup(_rid, subAct, _saSk);
      } else if(act==='bedRest'){
        _symHandleBedRest(_rid, _saSk);
      }
      return;
    }
    /* 분기/미분기 토글 (2026-06-09) */
    const branchBtn=e.target.closest('[data-action="symSetBranch"]');
    if(branchBtn){ e.stopPropagation(); _symSetBranch(branchBtn.dataset.branch); return; }
    /* ── 상담록 액션 (2026-06-12) — 회차이력/달력/PDF/인쇄 ── */
    const clEl=e.target.closest('[data-cl-act]');
    if(clEl){
      e.stopPropagation();
      const _clBlk=clEl.closest('.sym-counsel-block');
      const _clRid=_clBlk?parseInt(_clBlk.dataset.recId,10):0;
      const _clAct=clEl.dataset.clAct;
      if(_clAct==='hist'){
        const _clRec=S.records.find(function(x){return x.id===_clRid;});
        if(_clRec)_symOpenCounselHistModal(_clRec.studentId,_clRid);
      }
      else if(_clAct==='cal')_clOpenCalPopup(_clRid, clEl);
      else if(_clAct==='calClear'){
        const _fuInp=_clBlk?_clBlk.querySelector('[data-cl-field="followUp"]'):null;
        if(_fuInp)_fuInp.value='';
        _symCounselSaveNow(_clRid);
        _symRenderTreatPanel(_clRid);
      }
      else if(_clAct==='pdf')_symCounselExport(_clRid,'pdf');
      else if(_clAct==='excel')_symCounselExport(_clRid,'excel');
      else if(_clAct==='print')_symCounselExport(_clRid,'print');
      else if(_clAct==='treatToggle'){
        /* 체크 ON → 입력 모달, OFF → 처치란 비우고 flat 에서 제거 (사용자 요청 2026-06-25) */
        const _trec=S.records.find(function(x){return x.id===_clRid;});
        if(_trec){
          if(clEl.checked){ _symOpenCounselTreatModal(_clRid); }
          else { if(_trec.counselLog) _trec.counselLog.treatmentText=''; _symCounselApplyTreat(_clRid); }
        }
      }
      else if(_clAct==='treatEdit') _symOpenCounselTreatModal(_clRid);
      else if(_clAct==='treatDelete'){
        /* 칩 ✕ — 처치란 문구 즉시 삭제 + 일반일지표 반영 (사용자 요청 2026-06-26) */
        const _trec=S.records.find(function(x){return x.id===_clRid;});
        if(_trec){ if(_trec.counselLog) _trec.counselLog.treatmentText=''; _symCounselApplyTreat(_clRid); }
      }
      return;
    }
    /* 사용자 요청 2026-06-05 — 처치 패널 헤더(메모/브레드크럼·블록 라벨) 클릭 동작.
     *  우선순위: 메모 ✕ 삭제 → 메모 텍스트 편집 → 분류 이동. (메모/✕ 는 브레드크럼 안에 중첩되므로 먼저 검사) */
    const memoDel=e.target.closest('[data-action="symMemoDel"]');
    if(memoDel){
      e.stopPropagation();
      _symClearSymMemo(parseInt(memoDel.dataset.recId), memoDel.dataset.symBase);
      return;
    }
    const editMemo=e.target.closest('[data-action="symEditMemo"]');
    if(editMemo){
      e.stopPropagation();
      const _rid=parseInt(editMemo.dataset.recId);
      const _base=editMemo.dataset.symBase;
      /* 좌측 패널을 이 증상의 분류로 전환(cat 매칭 시) → 그 중분류 칩을 앵커로 메모 dock 열기(내용 전체 선택됨) */
      if(editMemo.dataset.navCat)_symSelectCat(editMemo.dataset.navCat);
      const _chip=document.querySelector('#symSymList .sym-sel-chip[data-sym="'+String(_base).replace(/"/g,'\\"')+'"]');
      _symOpenSymMemoDock(_rid, _base, _chip||editMemo);
      return;
    }
    /* 우선순위: inner 액션(✕ 삭제·✏️ 펜·+추가·자유기입) 을 toggle/bed/vs 보다 먼저 검사.
     *  브레드크럼 ✕(증상 전체 삭제) 도 removeSym 액션 — 분류 이동(navCat)보다 먼저 검사해야 함 (✕ 는 브레드크럼 안에 중첩). */
    const del=e.target.closest('[data-action="removeSym"]');
    if(del){e.stopPropagation();_symRemoveSym(del.dataset.sym);return;}
    /* 브레드크럼/블록 라벨 클릭 → 좌측 패널을 이 증상의 대분류-중분류로 전환 (✕·메모 등 inner 액션 모두 통과한 뒤) */
    const navCat=e.target.closest('[data-action="symNavCat"]');
    if(navCat){
      e.stopPropagation();
      if(navCat.dataset.navCat)_symSelectCat(navCat.dataset.navCat);
      return;
    }
    const delT=e.target.closest('[data-action="removeTreat"]');
    if(delT){e.stopPropagation();_symRemoveTreat(delT.dataset.treat, delT.dataset.symKey);return;}
    const delM=e.target.closest('[data-action="removeMed"]');
    if(delM){e.stopPropagation();_symRemoveMedAndUpdate(delM.dataset.med, delM.dataset.symKey);return;}
    const hardDel=e.target.closest('[data-action="hardRemoveTreat"]');
    if(hardDel){
      e.stopPropagation();
      const _t=hardDel.dataset.treat;
      const _rid=parseInt(hardDel.dataset.recId);
      const _sk=hardDel.dataset.symKey;
      (async function(){
        const ok=await appConfirmModal(
          '"'+escHtml(_t)+'" 칩을 자주 쓰는 처치 목록에서 삭제하시겠습니까?<br><br><span style="font-size:11px;color:var(--t3)">Ctrl+Z로 복원 가능합니다.</span>',
          '자주 쓰는 처치 목록에서 삭제',
          { okLabel:'예', cancelLabel:'아니오' }
        );
        if(ok)_symHardRemoveTreat(_t,_rid,_sk);
      })();
      return;
    }
    const renameBtn=e.target.closest('[data-action="renameTreatFav"]');
    if(renameBtn){
      e.stopPropagation();
      _symPromptRenameTreat(renameBtn.dataset.treat, parseInt(renameBtn.dataset.recId));
      return;
    }
    const memoBtn=e.target.closest('[data-action="openTreatMemo"]');
    if(memoBtn){
      e.stopPropagation();
      const wrap=memoBtn.closest('.sym-fav-wrap')||memoBtn.closest('.sym-sum-wrap');
      const anchor=wrap||memoBtn.closest('.sym-fav-chip')||memoBtn.closest('.sym-treat-chip')||memoBtn;
      _symOpenTreatMemoDock(parseInt(memoBtn.dataset.recId),memoBtn.dataset.treat,anchor,memoBtn.dataset.symKey);
      return;
    }
    /* v3 (사용자 결정 2026-05-21) — 자유 기술 처치의 펜 클릭: 처치명 자체를 수정.
     *   initialEntry=현재 처치명 → _symOpenFreeTextDock 으로 dock 열어 input 안에 그 텍스트 미리 채워줌. */
    const editFt=e.target.closest('[data-action="editFreeText"]');
    if(editFt){
      e.stopPropagation();
      const anchorChip=editFt.closest('.sym-treat-chip')||editFt.closest('.sym-sum-wrap')||editFt;
      _symOpenFreeTextDock(parseInt(editFt.dataset.recId),anchorChip,editFt.dataset.treat,editFt.dataset.symKey);
      return;
    }
    const addUT=e.target.closest('[data-action="addUserTreat"]');
    if(addUT){
      e.stopPropagation();
      /* Phase 1 (2026-05-22): 증상별 + 추가 클릭 → 5종 옵션 진입 모달.
       *  symKey 가 있으면 옵션 모달, 없으면 옛 다중 증상 선택 흐름으로 폴백. */
      _symOpenAddOptionsModal(parseInt(addUT.dataset.recId), addUT.dataset.symKey || '');
      return;
    }
    const ftBtn=e.target.closest('[data-action="openFreeText"]');
    if(ftBtn){e.stopPropagation();_symOpenFreeTextDock(parseInt(ftBtn.dataset.recId),ftBtn,undefined,ftBtn.dataset.symKey);return;}
    const bed=e.target.closest('[data-action="bedRest"]');
    if(bed){const _bBp=bed.closest('.sym-block-pair');_symHandleBedRest(parseInt(bed.dataset.recId),bed.dataset.symKey||(_bBp?_bBp.dataset.symKey:''));return;}
    const vs=e.target.closest('[data-action="openVs"]');
    if(vs){
      const _vBp=vs.closest('.sym-block-pair');
      const _vsSym=vs.dataset.symKey||(_vBp?_vBp.dataset.symKey:'');
      _symOpenVsPopup(parseInt(vs.dataset.recId),vs,_vsSym);
      if(_vsSym && _vsSym!=='__legacy__'){
        if(!_symTreatmentsBySym[_vsSym])_symTreatmentsBySym[_vsSym]=[];
        if(_symTreatmentsBySym[_vsSym].every(function(x){return String(x).indexOf('V/S 측정')===-1;})){
          _symTreatmentsBySym[_vsSym].push('V/S 측정');_symRecomputeFlatTreatments();_symAutoSave();_symRenderTreatPanel();
        }
      } else if(_symSelectedTreatments.indexOf('V/S 측정')===-1){
        _symSelectedTreatments.push('V/S 측정');_symAutoSave();_symRenderTreatPanel();
      }
      return;
    }
    const _paChip=e.target.closest('[data-action="openPhysAssess"]');
    if(_paChip){
      const _paBp=_paChip.closest('.sym-block-pair');
      const _paSym=_paChip.dataset.symKey||(_paBp?_paBp.dataset.symKey:'');
      _symOpenPhysAssessPopup(parseInt(_paChip.dataset.recId),_paChip,_paSym);
      return;
    }
    const medChip=e.target.closest('[data-action="openMedFromChip"]');
    if(medChip){_symOpenMedPopup('med', medChip.dataset.symKey);return;}
    /* 바디맵 입력 완료 버튼 — 블록 헤더의 명시적 진입점 (Phase 2-B 사용자 요청 2026-05-20) */
    const bmBtn=e.target.closest('[data-action="openSymBmFromBlock"]');
    if(bmBtn){
      e.stopPropagation();
      if(typeof _symOpenBmForSym==='function'){
        _symOpenBmForSym(parseInt(bmBtn.dataset.recId), bmBtn.dataset.sym);
      }
      return;
    }
    const toggle=e.target.closest('[data-action="toggleTreat"]');
    if(toggle){_symToggleTreat(toggle.dataset.treat, toggle.dataset.symKey);return;}
  });
  /* Phase 3c: 칩 더블클릭 — 메모 입력 미니 팝업 (펜 클릭과 동일 동작, 고정 3종 제외). */
  panel.addEventListener('dblclick',function(e){
    const chip=e.target.closest('.sym-fav-chip')||e.target.closest('.sym-treat-chip');
    if(!chip)return;
    if(chip.dataset.isFixed==='1')return;
    e.preventDefault();e.stopPropagation();
    const wrap=chip.closest('.sym-fav-wrap')||chip.closest('.sym-sum-wrap');
    _symOpenTreatMemoDock(parseInt(chip.dataset.recId),chip.dataset.treat,wrap||chip,chip.dataset.symKey);
  });
}

export function _symRenderTreatPanel(recId){
  const panel=document.getElementById('symTreatPanel');if(!panel)return;
  /* === 재렌더 직전 — 현재 펼쳐있는 .sym-fav-acc 의 symKey 캡처 ===
   *  사용자 요청 2026-05-21: 선택 증상 ✕ / 자주 쓰는 처치 칩 클릭 등 패널 재렌더 트리거 액션 후에도
   *  자주 쓰는 처치 아코디언이 닫히지 않도록. innerHTML 교체로 .open 클래스가 유실되는데,
   *  새 HTML 을 만들기 전에 현재 .open 인 symKey 들을 모아 → _symRenderSingleBlock 가 이 Set 을 참조해
   *  'open' 클래스를 HTML 단계에서 박는다 → CSS transition 자체가 트리거되지 않음 (깜빡임 0). */
  _symRenderOpenAccSymKeys = new Set();
  panel.querySelectorAll('.sym-block-pair').forEach(function(bp){
    const _acc = bp.querySelector('.sym-fav-acc');
    if(_acc && _acc.classList.contains('open')){
      _symRenderOpenAccSymKeys.add(bp.dataset.symKey || '__legacy__');
    }
  });
  /* recId 미지정 시 현재 팝업의 데이터 속성에서 가져오기 */
  if(recId===undefined||recId===null){
    const box=document.getElementById('symCatBox');
    if(box&&box.dataset.recId)recId=parseInt(box.dataset.recId);
    else recId=S._symPopupRecId||0;
  }
  /* === 외부 재동기화 (2026-05-28 정합성 수정) ===
   *  · rec.treatmentBySym(맵)을 쓰는 외부 코드는 없음(저장은 _symAutoSave 단독) → rec 에서 맵을 재동기화하지 않는다.
   *    옛 add-only 맵 union 은 팝업에서 해제/삭제한 증상의 맵 엔트리를 stale rec 에서 되살리던 회귀의 원인이었음.
   *  · rec.treatment(평면)은 외부(침상 관리 bed-management-view, V/S·침상 등록)가 record-level 처치만 추가하므로
   *    비legacy 에서는 record-level(침상·V/S)만 재동기화한다. 일반/증상별 처치는 in-memory 가 유일 진실.
   *  · legacy(옛 일지)는 평면이 진실이므로 기존처럼 전체 재동기화 유지. */
  const _curRec=S.records.find(function(r){return r.id===recId;});
  if(_curRec&&Array.isArray(_curRec.treatment)){
    if(_symRecordIsLegacy){
      _curRec.treatment.forEach(function(t){
        if(_symSelectedTreatments.indexOf(t)===-1)_symSelectedTreatments.push(t);
      });
    } else {
      const _RL_BASE={'침상 이용':1,'침상 안정':1,'V/S 측정':1};
      _curRec.treatment.forEach(function(t){
        let _b=t; const _m=String(t).match(/^(.+?)\s*\(/); if(_m)_b=_m[1].trim();
        if(_RL_BASE[_b] && _symSelectedTreatments.indexOf(t)===-1)_symSelectedTreatments.push(t);
      });
    }
  }
  /* === 모드 판정 (sticky, 2026-05-28) ===
   *  · isLegacy: 팝업 열 때 결정된 _symRecordIsLegacy (옛 일지) → "선택 증상에 대한 처치" 단일 블록
   *  · 비legacy + 증상 선택됨 → 증상별 블록 (맵이 비어도 붕괴 안 함)
   *  · 증상도 없고 legacy 도 아니면 → 안내 placeholder */
  const _hasSymptoms = _symSelectedSymptoms.length>0;
  const _isLegacy = _symRecordIsLegacy || !!(_curRec && _curRec.isImported); /* 이관 데이터도 미분기 단일 블록 + 비활성 토글 (2026-06-09) */

  let h='';

  if(!_hasSymptoms && !_isLegacy){
    /* === 안내 placeholder (증상 미선택) ===
     * 상담 분류가 활성일 땐 이 공간이 상담록 작성 공간임을 안내 (사용자 요청 2026-06-12). */
    const _activeCatArrow=document.querySelector('.sym-cat-item .sym-cat-arrow[style*="visibility: visible"]');
    const _activeCatId=_activeCatArrow?(_activeCatArrow.parentElement.dataset.cat||''):'';
    h+= _activeCatId==='counsel'
      ? '<div style="font-size:13px;color:var(--t3);margin:14px 0;padding:14px 16px;background:var(--bg2);border-radius:8px;line-height:1.7">💡 상담 주제를 선택하면 여기에 상담록이 만들어지며 등록 및 누적할 수 있습니다.</div>'
      : '<div style="font-size:13px;color:var(--t3);margin:14px 0;padding:14px 16px;background:var(--bg2);border-radius:8px;line-height:1.7">💡 증상을 먼저 선택하면 자주 쓰는 처치를 증상별로 등록할 수 있습니다.</div>';
  } else if(_isLegacy){
    /* === 옛 일지(분기 전 평면 기록) — 증상 2개+면 비활성 토글(미분기 고정) 표시, 데이터·블록은 그대로 === */
    if(_symSelectedSymptoms.length >= 2){
      h+=_symRenderBranchToggle(true); /* 비활성 — 미분기 고정. 옛 평면 데이터 무변경(변환·recompute 없음) */
    }
    h+=_symRenderSingleBlock(recId, {
      label: '선택 증상에 대한 처치',
      symLabels: _symSelectedSymptoms,
      treatments: _symSelectedTreatments,
      isLegacy: true,
      symKey: '__legacy__',
    });
  } else {
    /* === 새 일지 === */
    /* 상담 주제(상담 분류)는 처치 블록 대신 상담록 블록으로 분리 (사용자 요청 2026-06-12).
     *  분기 토글·블록 개수·순번 라벨은 일반 증상(_medLabels)만 기준으로 계산. */
    const _counselLabels=_symSelectedSymptoms.filter(function(sx){return _symIsCounselSym(sx);});
    const _medLabels=_symSelectedSymptoms.filter(function(sx){return !_symIsCounselSym(sx);});
    const _multiSym = _medLabels.length >= 2;
    if(_multiSym){
      h+=_symRenderBranchToggle(); /* 증상 2개+ 일 때만 토글 노출. 기본 분기. */
    }
    if(_multiSym && _symBranchMode===false){
      /* === 미분기 — 선택 증상 전체에 대한 단일 블록 (__flat__ 예약키).
       *  symLabels 에 선택 증상 전부를 넘기면 _symRenderSingleBlock 의 recommended(자주쓰는 처치)가
       *  그 증상들의 합집합으로 자동 구성됨. 처치/약품은 __flat__ 키에 누적. === */
      h+=_symRenderSingleBlock(recId, {
        label: '선택 증상에 대한 처치',
        symLabels: _medLabels,
        treatments: _symTreatmentsBySym[SYM_FLAT_KEY] || [],
        isLegacy: false,
        symKey: SYM_FLAT_KEY,
      });
    } else {
      /* === 분기 (또는 증상 1개) — 증상별 블록 (기존) === */
      _medLabels.forEach(function(sym, idx){
        h+=_symRenderSingleBlock(recId, {
          /* 사용자 정책 (2026-05-22): 증상 1개면 "선택 증상에 대한 처치" 단일,
           *  2개 이상이면 "첫 번째 선택 증상에 대한 처치" / "두 번째 …" 순으로 분기. */
          label: (_medLabels.length >= 2)
            ? ((['첫','두','세','네','다섯','여섯','일곱'][idx] || ('제'+(idx+1))) + ' 번째 선택 증상에 대한 처치')
            : '선택 증상에 대한 처치',
          symLabels: [sym],
          treatments: _symTreatmentsBySym[sym] || [],
          isLegacy: false,
          index: idx+1,
          symKey: sym,
        });
      });
    }
    /* 상담록 블록 — 일반 증상 블록 아래 (주제 1개 이상 선택 시) */
    if(_counselLabels.length){
      h+=_symRenderCounselBlock(recId, _counselLabels);
    }
  }

  panel.innerHTML=h;
  /* v3 (사용자 결정 2026-05-21) — 재렌더 시 떠 있던 tooltip 닫음.
   * 옛 chip 이 detached 되면 mouseout 안 발화되어 tooltip 영구 표시되는 회귀 fix. */
  if(typeof hideHeaderTooltip==='function')try{hideHeaderTooltip();}catch(_){}
  /* data-tooltip 미니 팝업 위임 — 일반 일지 버튼과 동일한 GUI (showHeaderTooltip). */
  _symBindTipDelegation(panel);
  /* 처치 패널 이벤트 위임 — 중복 등록 방지 */
  _symBindTreatPanelEvents(panel);
  /* v3 (사용자 결정 2026-05-21 갱신) — 자주 쓰는 처치 아코디언 hover/3초 idle 자동 닫힘 동작. */
  _symBindFavAccHover(panel);
  /* 패널 재렌더 시 마우스 위치 위의 아코디언이 있으면 자동 .open — 옛 hover 잃음 회귀 fix.
   * 사용자가 증상 칩을 누르는 등으로 패널이 다시 그려져도 마우스 좌표 위면 펼친 상태 유지. */
  setTimeout(function(){
    if(typeof window._symLastMouseX === 'number'){
      const el = document.elementFromPoint(window._symLastMouseX, window._symLastMouseY);
      if(el){
        const acc = el.closest && el.closest('.sym-fav-acc');
        if(acc) acc.classList.add('open');
      }
    }
    /* 자유 기술 dock 이 떠있는 동안에는 그 블록의 자주 쓰는 처치 아코디언이 항상 펼쳐져 있어야 함 (사용자 요청 2026-05-21).
     * 마우스가 dock 입력창에 있으므로 hover/elementFromPoint 양쪽 모두 잡히지 않아 별도 복원 필요. */
    const _ftDock = document.getElementById('symFreeDock');
    if(_ftDock){
      const _sk = _ftDock.dataset.symKey || '__legacy__';
      const _bps = panel.querySelectorAll('.sym-block-pair');
      for(let i=0;i<_bps.length;i++){
        if(_bps[i].dataset.symKey === _sk){
          const _acc = _bps[i].querySelector('.sym-fav-acc');
          if(_acc) _acc.classList.add('open');
          break;
        }
      }
    }
  }, 0);
}

/* v4 (사용자 결정 2026-08-12) — 자주 쓰는 처치 목록은 항상 펼침 고정.
 *  v3 의 hover 열림 + 3초 idle 자동 닫힘 + 헤드 클릭 토글을 전면 폐지 — 토글 없이 언제나 열림.
 *  CSS .sym-fav-acc-body 도 상시 펼침으로 변경. .open 클래스는 하위 호환(재렌더 보존 로직)용으로만 부착. */
function _symBindFavAccHover(panel){
  if(!panel)return;
  panel.querySelectorAll('.sym-fav-acc').forEach(function(acc){ acc.classList.add('open'); });
}

/* 합성 처치 문자열 — 괄호 depth 0 의 콤마로 분리. "투약[X (1T)], V/S 측정, 학부모 연락" 등 처리.
 *  괄호·대괄호 안의 콤마는 무시 (예: "투약[X (1T), Y (1T)]" 는 한 덩어리). */
function _splitCompositeTreat(s){
  const parts=[];
  let cur='';
  let depth=0;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='['||c==='(')depth++;
    else if(c===']'||c===')')depth--;
    if(c===',' && depth===0){
      if(cur.trim())parts.push(cur.trim());
      cur='';
    } else {
      cur+=c;
    }
  }
  if(cur.trim())parts.push(cur.trim());
  return parts;
}

function _symToggleTreat(treat, symKey){
  /* 합성 fav 칩 ("지혈, 코튼볼 삽입" 등) 은 단일 칩으로 유지 (분리하지 않음).
   *  · 사용자 요청 2026-05-27: 자주 쓰는 처치에 등록한 합성 칩은 record 의 선택된 처치 영역에도 단일 칩으로 표시.
   *  · V/S 측정·침상 안정 sub-action 은 칩 렌더 단계의 _renderDispChip 에서 처리되므로 분리 불필요. */
  /* 사용자 요청 (2026-05-14) — 자주 쓰는 처치 목록 칩은 'add only' 동작.
   *   - 투약: 항상 약품 팝업 오픈 (해제는 처치 영역의 ✕ 로만). record-level.
   *   - 침상·V/S: record-level — 어느 블록 클릭이든 같은 데이터 (사용자 결정 2026-05-20).
   *   - 일반 처치: 증상별 블록에서만 추가 (sym-key 별 분리). 이미 그 증상에 선택 돼 있으면 무시 (add only).
   *   - legacy mode (symKey='__legacy__'): flat 에만 추가 — 옛 일지 호환. */
  if(treat==='투약'){_symOpenMedPopup('med', symKey);return;}
  /* 침상 안정 — per-symptom (선택 증상에만). 사용자 결정 2026-05-28: record-level 폐지. */
  if(treat==='침상 이용'||treat==='침상 안정'){
    if(symKey && symKey !== '__legacy__'){
      if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
      if(_symTreatmentsBySym[symKey].every(function(x){return String(x).indexOf('침상')===-1;})){
        _symTreatmentsBySym[symKey].push(treat);
        _symRecomputeFlatTreatments();
      }
    } else {
      const idx2=_symFindTreatIdx(treat);
      if(idx2===-1)_symSelectedTreatments.push(treat);
    }
    _symRenderTreatPanel();
    _symAutoSave();
    _symAskBedFullChoice(_symPopupRecId, symKey);
    return;
  }
  /* === 순수 투약 칩(옵션 1 — "투약[약1 (용량), 약2 (용량)]") 만 구조화 필드로 추출 ===
   *  약품을 _symMedsBySym/도즈로 빼내고 '투약' 토큰을 넣어 💊 칩으로 렌더 + 통계 카운트.
   *  ─ 투약 + 다른 처치 합성 칩(옵션 3 — "투약[…], 보건교육")은 여기서 처리하지 않고
   *    아래 일반 push 로 '통째 한 항목'을 보존한다(일반일지 표에 한 칩으로 표시, 자주쓰는 처치
   *    목록과 동일한 모습). 그 칩 안의 약품은 셀 때 _statMedicationStr 가 칩 텍스트의 "투약[…]"
   *    를 파싱해 통계에 카운트하므로 medsBySym 추출이 불필요하다 (옵션 5 와 동일 처리).
   *    옛 코드는 '투약' 토큰 + 나머지로 쪼개 일반일지에 두 칩으로 보이던 버그가 있었다. (2026-06-15) */
  if(symKey && symKey !== '__legacy__'){
    const _compParts = _splitCompositeTreat(treat);
    const _isPureMed = _compParts.length===1 && /^투약\s*\[[\s\S]*\]$/.test(_compParts[0]);
    if(_isPureMed){
      const _inner = _compParts[0].replace(/^투약\s*\[/, '').replace(/\]\s*$/, '');
      const _medItems = _splitCompositeTreat(_inner); /* 도즈 괄호 보호하며 약품 분리 */
      if(!_symMedsBySym[symKey]) _symMedsBySym[symKey]=[];
      if(!_symMedDosesBySym[symKey]) _symMedDosesBySym[symKey]={};
      _medItems.forEach(function(it){
        const _p=_parseMedWithDose(it);
        if(_p.name && _symMedsBySym[symKey].indexOf(_p.name)===-1){
          _symMedsBySym[symKey].push(_p.name);
          if(_p.dose) _symMedDosesBySym[symKey][_p.name]=_p.dose;
        }
      });
      if(!_symTreatmentsBySym[symKey]) _symTreatmentsBySym[symKey]=[];
      if(_symTreatmentsBySym[symKey].indexOf('투약')===-1) _symTreatmentsBySym[symKey].push('투약');
      _symRecomputeFlatTreatments();
      _symRenderTreatPanel();
      _symAutoSave();
      return;
    }
  }
  /* === sym-key 별 분리 (일반 처치) === */
  if(symKey && symKey !== '__legacy__'){
    if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
    /* base name 매칭 — 이미 그 증상에 있으면 무시 (add only) */
    const found = _symTreatmentsBySym[symKey].some(function(x){return x===treat||x.indexOf(treat+' (')===0;});
    if(found){_symRenderTreatPanel();return;}
    _symTreatmentsBySym[symKey].push(treat);
    _symRecomputeFlatTreatments();
  } else {
    /* legacy mode 또는 symKey 누락 — flat 에 직접 추가 (옛 일지 호환) */
    const idx=_symFindTreatIdx(treat);
    if(idx!==-1){_symRenderTreatPanel();return;}
    _symSelectedTreatments.push(treat);
  }
  _symRenderTreatPanel();
  _symAutoSave();
}

/* Phase 3a: _symAddCustomTreat 함수 제거됨 — symTreatInput 자유서술 입력란 폐지에 따라.
 * 새 처치 추가는 자주 쓰는 처치 목록의 +추가 칩 → _symPromptAddUserTreat 로 진행. */

/* ── 인라인 onclick에서 클로저 변수 접근을 위한 래퍼 함수 ──
 *  · base name 매칭: "아이스팩 적용 (15분)" 같이 메모 부착된 항목도 base name 으로 찾음 */
function _symFindTreatIdx(baseName){
  return _symSelectedTreatments.findIndex(function(x){return x===baseName||x.indexOf(baseName+' (')===0;});
}
/* data-tooltip 미니 팝업 위임 — 일반 일지 버튼과 동일한 GUI (showHeaderTooltip / hideHeaderTooltip).
 * mouseover/mouseout 는 버블링되므로 패널에 한 번만 바인딩해 내부 재렌더 후에도 동작.
 * 중복 등록 방지를 위해 panel._symTipDelegated 플래그 사용. */
function _symBindTipDelegation(panel){
  if(!panel||panel._symTipDelegated)return;
  panel._symTipDelegated=true;
  let _curEl=null;
  function _closeTip(){
    _curEl=null;
    if(typeof hideHeaderTooltip==='function')hideHeaderTooltip();
  }
  panel.addEventListener('mouseover',function(e){
    /* 자유 기입 dock(symFreeDock) 이 떠있는 동안에는 dock 외부 미니 팝업만 차단.
       dock 내부 (예: dock 의 🧍 부위 추가 버튼) 호버는 정상 표시. (사용자 요청 2026-05-19, 2026-05-20 보정) */
    const _dock=document.getElementById('symFreeDock');
    if(_dock && !_dock.contains(e.target)){
      /* v3 (사용자 결정 2026-05-21) — dock 떠 있는데 마우스가 dock 외부면 옛 tooltip 닫음 (영구 표시 회귀 fix). */
      if(_curEl) _closeTip();
      return;
    }
    const el=e.target.closest&&e.target.closest('[data-tooltip]');
    if(!el||!panel.contains(el)){
      /* v3 — data-tooltip 영역 밖이면 옛 tooltip 닫음 */
      if(_curEl) _closeTip();
      return;
    }
    if(el===_curEl)return;
    _curEl=el;
    const txt=el.getAttribute('data-tooltip');
    const _instant=el.hasAttribute('data-tooltip-instant');
    if(txt&&typeof showHeaderTooltip==='function')showHeaderTooltip({currentTarget:el,target:el},txt,false,_instant);
  });
  panel.addEventListener('mouseout',function(e){
    const el=e.target.closest&&e.target.closest('[data-tooltip]');
    if(!el)return;
    if(e.relatedTarget&&el.contains(e.relatedTarget))return;
    if(el===_curEl)_closeTip();
    else if(typeof hideHeaderTooltip==='function')hideHeaderTooltip();
  });
  /* v3 (사용자 결정 2026-05-21) — panel 밖으로 마우스 나가면 무조건 tooltip 닫음.
   * 패널 재렌더로 옛 element 가 detached 되어 mouseout 이 안 발화되거나, 마우스가 빠르게 빠질 때 mouseout 누락되는 회귀 fix. */
  panel.addEventListener('mouseleave',function(){
    if(_curEl) _closeTip();
  });
}
/* ── V/S·신체사정 고아 데이터 정리 ─────────────────────────────────────────
 * 처치 칩('V/S 측정'·'신체사정')과 그 실제 데이터(record-level: vsHistory·단일 V/S 필드·physicalAssessment)는
 * 별개 저장이다. 지금까지 칩을 지워도 데이터가 남아 일반일지 표(V/S 열·신체사정 인라인 표)에 계속 떠 있었다.
 * → 삭제한 칩이 실제로 그 항목이었고(hadVs/hadPa), 삭제 후 어느 증상·flat 에도 그 칩이 남아있지 않으면
 *   연결 데이터도 함께 비운다. (사용자 보고 2026-07-20)
 * ★ hadVs/hadPa 게이트로만 동작 → '칩 없이 값만 있는' 옛/외부 import 레코드는 절대 건드리지 않음. */
function _symChipStillHas(needle){
  var ks=Object.keys(_symTreatmentsBySym||{});
  for(var i=0;i<ks.length;i++){ var a=_symTreatmentsBySym[ks[i]]||[]; for(var j=0;j<a.length;j++){ if(String(a[j]).indexOf(needle)!==-1) return true; } }
  if(Array.isArray(_symSelectedTreatments)){ for(var m=0;m<_symSelectedTreatments.length;m++){ if(String(_symSelectedTreatments[m]).indexOf(needle)!==-1) return true; } }
  return false;
}
function _symClearOrphanVsPa(recId, hadVs, hadPa){
  if((!hadVs && !hadPa) || recId==null) return;
  var rec=Array.isArray(S.records)?S.records.find(function(r){return r.id===recId;}):null;
  if(!rec) return;
  if(hadVs && !_symChipStillHas('V/S 측정')){
    rec.vsHistory=[]; rec.temp=''; rec.bp=''; rec.pulse=''; rec.resp=''; rec.respiration=''; rec.spo2=''; rec.bst='';
    rec._dirty=true;
  }
  if(hadPa && !_symChipStillHas('신체사정')){
    rec.physicalAssessment={items:[],details:{}};
    rec._dirty=true;
  }
}
function _symRemoveTreat(t, symKey){
  /* === sym-key 별 제거 (일반 처치) === */
  if(symKey && symKey !== '__legacy__' && _symTreatmentsBySym[symKey]){
    const arr=_symTreatmentsBySym[symKey];
    const idx=arr.findIndex(function(x){return x===t||x.indexOf(t+' (')===0;});
    if(idx!==-1)arr.splice(idx,1);
    if(arr.length===0)delete _symTreatmentsBySym[symKey];
  }
  /* v3 (2026-05-28) — V/S·침상도 per-symptom. legacy/symKey 누락만 flat 에서 직접 제거.
   *  (per-symptom 항목은 위 sym-key 제거 → _symRecomputeFlatTreatments 가 평면에서 자동 제외) */
  if(symKey === '__legacy__' || !symKey){
    const i=_symFindTreatIdx(t);
    if(i!==-1)_symSelectedTreatments.splice(i,1);
  }
  /* flat 재계산 — sym-key 변경분 반영 + record-level 보존 */
  _symRecomputeFlatTreatments();
  /* 투약 삭제 시 — 선택된 약품·투여량도 함께 비움 (다음 투약 추가 시 깨끗하게 시작).
   * v3 — sym-key 모드면 그 블록의 약품/도즈만 비움 (사용자 결정 2026-05-21). 다른 블록 약품은 보존. */
  if(t==='투약'){
    if(symKey && symKey !== '__legacy__'){
      delete _symMedsBySym[symKey];
      delete _symMedDosesBySym[symKey];
      /* _symActiveSymKey 가 이 블록이면 reference 도 끊어 다음 약품 팝업이 새 array 받게 */
      if(_symActiveSymKey === symKey){_symSelectedMeds=[]; _symMedDoses={};}
    } else {
      _symSelectedMeds=[];
      try{if(typeof _symMedDoses==='object')Object.keys(_symMedDoses).forEach(function(k){delete _symMedDoses[k];});}catch(_){}
    }
  }
  /* 침상 이용 삭제 시 — 침상 점유도 해제. */
  if(t==='침상 이용'||t==='침상 안정'){
    try{
      const rec=S.records.find(function(r){return r.id===_symPopupRecId;});
      if(rec&&typeof releaseBedByStudentId==='function')releaseBedByStudentId(rec.studentId);
    }catch(_){}
  }
  /* V/S 측정·신체사정 칩 삭제 시 — 연결된 record-level 데이터도 함께 정리 (다른 증상에 안 남았을 때만). 2026-07-20 */
  _symClearOrphanVsPa(_symPopupRecId, String(t).indexOf('V/S 측정')!==-1, String(t).indexOf('신체사정')!==-1);
  _symAutoSave();_symRenderTreatPanel();
}
/* Phase 3d: 증상 base name 매칭 — "증상명(...)" (no space) 과 옛 "증상명 (...)" (space) 둘 다 인식 */
function _symFindSymIdx(baseName){
  return _symSelectedSymptoms.findIndex(function(x){
    return x===baseName || x.indexOf(baseName+'(')===0 || x.indexOf(baseName+' (')===0;
  });
}
/* ── Phase 3e: 증상 라벨 통합 포맷 ──
 *   증상(부위1, 부위2, 자유서술) — 부위는 _bmData[recId] 의 symptom 매칭 마커 라벨, 자유서술은 메모 dock 입력값.
 *   사용자 요청 형식: "설사(중앙하복부, 오늘 아침부터 4번)" (괄호 앞 공백 X, 콤마+한 칸 띄움). */
function _symGetBodyPartsForSym(recId, baseName){
  const markers = (window._bmData||{})[recId] || [];
  const out=[];
  markers.forEach(function(m){ if(m && m.symptom===baseName && m.label && out.indexOf(m.label)===-1) out.push(m.label); });
  return out;
}
function _symEscapeRegex(s){ return String(s).replace(/[\\^$*+?.()|[\]{}]/g,'\\$&'); }
/* 기존 저장 문자열에서 메모만 추출 (부위명 제거 후 남은 문자열) */
function _symExtractMemoFromStored(stored, parts){
  if(!stored) return '';
  const m = stored.match(/^(.+?)\s*\((.*)\)\s*$/);
  if(!m) return '';
  let rest = m[2];
  /* 부위명을 stored 앞쪽부터 제거 (콤마+공백 포함) */
  for(let i=0;i<parts.length;i++){
    const p = parts[i];
    rest = rest.replace(new RegExp('^\\s*'+_symEscapeRegex(p)+'\\s*(?:,\\s*NRS:\\s*\\d+)?\\s*,?\\s*','i'), '');
  }
  return rest.trim();
}
/* 메모 캐시 — recId+base 별 사용자가 입력한 자유 서술을 보존.
 * 이유: 마커가 splice 된 후 _symBuildSymLabel 이 호출되면 parts 가 이미 줄어든 상태라
 * _symExtractMemoFromStored 가 옛 부위명을 메모로 오인하여 라벨에 잔존시키는 버그가 발생.
 * 캐시에 메모가 있으면 stored 재추출 없이 그대로 사용 → 부위만 깔끔히 제거됨. */
const _symSymMemoCache = {};
function _symSymMemoKey(recId, baseName){ return recId+'::'+baseName; }
/* 중분류 자유 기입 칩 — 카테고리별 마지막 입력 텍스트 저장 (recId+catId → text).
 * 사용자 요청: 자유 기입 칩 클릭 시 기존 입력값 pre-populate, 입력 후 칩 라벨 자체에 표시, 🧍 바디맵 + 테두리 강조.
 * 사용자 보고 2026-05-22 — 모달 닫았다 다시 열면 옛 자유 기입의 catId 매핑이 휘발되어 카테고리 카운트가 누락되던 회귀.
 *  localStorage('ec_symFreeTextByCat') 에 영구 저장하여 앱/모달 재진입에도 보존되도록.
 *  ※ 백업 등록부(custom-backup-keys.js)에도 'ec_symFreeTextByCat' 등록 필요. */
const _symFreeTextByCat = (function(){
  try {
    const raw = localStorage.getItem('ec_symFreeTextByCat');
    if(raw){
      const obj = JSON.parse(raw);
      if(obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    }
  } catch(_){}
  return {};
})();
function _symPersistFreeTextByCat(){
  try { localStorage.setItem('ec_symFreeTextByCat', JSON.stringify(_symFreeTextByCat)); } catch(_){}
}
function _symBuildSymLabel(recId, baseName, memoOverride){
  const parts = _symGetBodyPartsForSym(recId, baseName);
  const _ck = _symSymMemoKey(recId, baseName);
  let memo;
  if(typeof memoOverride==='string'){
    memo = memoOverride.trim();
    _symSymMemoCache[_ck] = memo; /* 캐시 갱신 */
  } else if(_symSymMemoCache[_ck] !== undefined){
    memo = _symSymMemoCache[_ck]; /* 캐시 히트 — stored 재추출 안 함 */
  } else {
    /* 초기 추출 — 이 시점엔 markers 가 stored 라벨과 동기화된 상태로 가정 (레코드 로드 직후) */
    const idx = _symFindSymIdx(baseName);
    memo = idx!==-1 ? _symExtractMemoFromStored(_symSelectedSymptoms[idx], parts) : '';
    _symSymMemoCache[_ck] = memo; /* 캐시 시드 */
  }
  /* 저장·증상칩 라벨에는 부위명·NRS 를 넣지 않는다 — 증상 자체는 "복통"(+자유기입 메모)만.
   *  · 바디맵 입력 이력 모달: 부위 칸에 "우측 중앙복부 (NRS: 9)" 가 따로 있으니 증상 칸은 "복통"만.
   *  · 일반일지 표: 증상 칸에서 부위+NRS 를 렌더 시점에 합쳐 "복통(우측 중앙복부 NRS: 9)" 로 표시(daily-view).
   *  (parts 는 옛 저장문자열 메모 추출용으로만 유지) (사용자 요청 2026-06-14) */
  const inside = memo;
  return inside ? baseName+'('+inside+')' : baseName;
}
/* ── per-sym 맵(처치·약품·도즈) 키 lockstep 이전 — 증상 라벨이 바뀌면 세 맵을 oldLabel→newLabel 로 함께 이동 ──
 *  검증 2026-06-05: 옛 코드는 _symRebuildAllSymLabels 가 처치(_symTreatmentsBySym) 키만 재명명하고
 *  약품(_symMedsBySym)·도즈(_symMedDosesBySym) 키는 방치 → 라벨 변경(바디맵 추가·메모 편집 등) 시
 *  약품이 옛 키에 고아로 남아 rec.medsBySym 로 stale 키가 DB 에 직렬화되고,
 *  같은 증상 재선택 시 의도치 않게 부활하던 결함. 세 맵을 한 곳에서 묶어 모든 라벨 변경 지점의 정합성 보장.
 *  ※ 약품 배열/도즈 객체는 _symSelectedMeds/_symMedDoses 가 reference 할 수 있어 같은 객체를 그대로 이동(충돌 시에만 병합). */
function _symMigrateSymMaps(oldLabel, newLabel){
  if(!oldLabel || !newLabel || oldLabel===newLabel) return;
  /* 처치 (배열) */
  if(_symTreatmentsBySym && _symTreatmentsBySym[oldLabel]){
    if(_symTreatmentsBySym[newLabel] && _symTreatmentsBySym[newLabel]!==_symTreatmentsBySym[oldLabel]){
      _symTreatmentsBySym[oldLabel].forEach(function(t){ if(_symTreatmentsBySym[newLabel].indexOf(t)===-1)_symTreatmentsBySym[newLabel].push(t); });
    } else {
      _symTreatmentsBySym[newLabel]=_symTreatmentsBySym[oldLabel];
    }
    delete _symTreatmentsBySym[oldLabel];
  }
  /* 약품 (배열) */
  if(_symMedsBySym && _symMedsBySym[oldLabel]){
    if(_symMedsBySym[newLabel] && _symMedsBySym[newLabel]!==_symMedsBySym[oldLabel]){
      _symMedsBySym[oldLabel].forEach(function(mm){ if(_symMedsBySym[newLabel].indexOf(mm)===-1)_symMedsBySym[newLabel].push(mm); });
    } else {
      _symMedsBySym[newLabel]=_symMedsBySym[oldLabel];
    }
    delete _symMedsBySym[oldLabel];
  }
  /* 도즈 (객체) */
  if(_symMedDosesBySym && _symMedDosesBySym[oldLabel]){
    if(_symMedDosesBySym[newLabel] && _symMedDosesBySym[newLabel]!==_symMedDosesBySym[oldLabel]){
      Object.keys(_symMedDosesBySym[oldLabel]).forEach(function(k){ if(_symMedDosesBySym[newLabel][k]===undefined)_symMedDosesBySym[newLabel][k]=_symMedDosesBySym[oldLabel][k]; });
    } else {
      _symMedDosesBySym[newLabel]=_symMedDosesBySym[oldLabel];
    }
    delete _symMedDosesBySym[oldLabel];
  }
}
/* 선택된 모든 증상의 라벨을 _bmData 와 기존 메모로부터 재구성 — 바디맵 닫힘 후 호출 */
function _symRebuildAllSymLabels(recId){
  if(recId==null) return;
  for(let i=0;i<_symSelectedSymptoms.length;i++){
    const cur = _symSelectedSymptoms[i];
    const m = cur.match(/^(.+?)\s*\(/);
    const base = m ? m[1].trim() : cur;
    const newLabel = _symBuildSymLabel(recId, base);
    /* 라벨 변경 시 처치·약품·도즈 맵 키를 lockstep 으로 이전 (stale 키·고아 방지 — 검증 2026-06-05).
     * 옛 코드는 처치 키만 재명명했으나 약품/도즈까지 _symMigrateSymMaps 로 함께 이전. */
    if(newLabel !== cur) _symMigrateSymMaps(cur, newLabel);
    _symSelectedSymptoms[i] = newLabel;
  }
}
function _symRemoveSym(s){
  /* s 는 "설사" 또는 "설사(중앙하복부, 메모)" 등 보관된 전체 문자열 — base name 추출 후 매칭 */
  const _m=String(s).match(/^(.+?)\s*\(/);
  const _base=_m?_m[1].trim():String(s);
  const idx=_symFindSymIdx(_base);
  let _removedLabel=null;
  if(idx!==-1){_removedLabel=_symSelectedSymptoms[idx];_symSelectedSymptoms.splice(idx,1);}
  /* v3 — 해제된 증상의 treatmentBySym 키도 함께 제거 (사용자 결정 2026-05-21).
   * 다시 추가 시 옛 처치가 의도치 않게 부활하지 않도록. */
  if(_removedLabel){
    /* 삭제 대상 증상이 V/S 측정·신체사정 칩을 갖고 있었는지 — 삭제 전 캡처 (연결 데이터 정리 게이트) */
    var _rmArr2=(_symTreatmentsBySym&&_symTreatmentsBySym[_removedLabel])||[];
    var _hadVs2=_rmArr2.some(function(x){return String(x).indexOf('V/S 측정')!==-1;});
    var _hadPa2=_rmArr2.some(function(x){return String(x).indexOf('신체사정')!==-1;});
    if(_symTreatmentsBySym && _symTreatmentsBySym[_removedLabel]){
      delete _symTreatmentsBySym[_removedLabel];
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    }
    /* 약품·도즈 맵도 함께 제거 — 처치와 동일 사유(고아·부활 방지). 검증 2026-06-05. */
    if(_symMedsBySym && _symMedsBySym[_removedLabel]) delete _symMedsBySym[_removedLabel];
    if(_symMedDosesBySym && _symMedDosesBySym[_removedLabel]) delete _symMedDosesBySym[_removedLabel];
    /* 그 증상에만 있던 V/S·신체사정이면 record-level 데이터도 함께 정리. 2026-07-20 */
    _symClearOrphanVsPa((typeof S!=='undefined'&&S._symPopupRecId!=null)?S._symPopupRecId:null, _hadVs2, _hadPa2);
  }
  /* 그 증상에 부착된 바디맵 마커도 함께 제거 (관련 부위가 더 이상 유효하지 않으므로) */
  const recId=(typeof S!=='undefined'&&S._symPopupRecId!=null)?S._symPopupRecId:null;
  let _bmRemoved=false;
  if(recId!=null && window._bmData && window._bmData[recId]){
    const _before=window._bmData[recId].length;
    window._bmData[recId]=window._bmData[recId].filter(function(m){return m && m.symptom!==_base;});
    if(window._bmData[recId].length<_before){
      _bmRemoved=true;
      if(typeof window._bmPersist==='function')window._bmPersist(recId);
    }
  }
  if(_bmRemoved){try{bus.emit('bm:marker-changed',{recId:recId});}catch(_){}}
  const cnt=document.getElementById('symSelCount');
  if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
  _symAutoSave();
  /* 중분류 패널 재렌더 — 선택 해제된 칩 테두리/🧍 색 모두 갱신 */
  let _catId=null;
  const _activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
  if(_activeArrow)_catId=_activeArrow.parentElement.dataset.cat;
  if(!_catId){
    const _activeCat=document.querySelector('#symCatList .sym-cat-item[style*="font-weight: 700"]')||document.querySelector('#symCatList .sym-cat-item');
    if(_activeCat)_catId=_activeCat.dataset.cat;
  }
  if(_catId)_symSelectCat(_catId);
  _symRenderTreatPanel();
  _symUpdateCatHighlights();
}
function _symRemoveMedAndUpdate(m, symKey){
  /* v3 — sym-key 모드면 _symMedsBySym[symKey] 에서만 제거, legacy 면 record-level (사용자 결정 2026-05-21).
   * 같은 약품이 다른 블록에도 있으면 그쪽은 그대로 유지. */
  const _useBy = !!(symKey && symKey !== '__legacy__');
  if(_useBy){
    const arr = _symMedsBySym[symKey] || [];
    const ai = arr.indexOf(m);
    if(ai!==-1)arr.splice(ai,1);
    /* 도즈도 정리 */
    if(_symMedDosesBySym[symKey]) delete _symMedDosesBySym[symKey][m];
    /* 마지막 약품이 빠지면 그 블록의 '투약' 처치도 제거 */
    if(arr.length===0 && _symTreatmentsBySym[symKey]){
      const tArr=_symTreatmentsBySym[symKey];
      const ti=tArr.findIndex(function(x){return x==='투약'||x.indexOf('투약(')===0||x.indexOf('투약 (')===0;});
      if(ti!==-1)tArr.splice(ti,1);
      if(tArr.length===0)delete _symTreatmentsBySym[symKey];
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    }
  } else {
    /* legacy 모드 — 옛 동작 */
    const idx=_symSelectedMeds.indexOf(m);
    if(idx!==-1)_symSelectedMeds.splice(idx,1);
    if(!_symSelectedMeds.length){const ti=_symSelectedTreatments.indexOf('투약');if(ti!==-1)_symSelectedTreatments.splice(ti,1);}
  }
  _symAutoSave();_symRenderTreatPanel();
}

/* ── 최근 1년 사용 빈도 집계 ── */
function _symGetMedFrequency(){
  const freq={};
  if(typeof S.records==='undefined'||!Array.isArray(S.records))return freq;
  const oneYearAgo=new Date();oneYearAgo.setFullYear(oneYearAgo.getFullYear()-1);
  const cutoff=oneYearAgo.toISOString().slice(0,10);
  S.records.forEach(function(r){
    if(!r.date||r.date<cutoff)return;
    if(!r.medication)return;
    /* medication 필드: "투약(약A, 약B)" 또는 약품명 직접 */
    let meds=[];
    const txt=r.medication;
    if(typeof txt==='string'){
      const m1=txt.match(/투약\(([^)]+)\)/);
      if(m1)meds=m1[1].split(',').map(function(s){return s.trim();});
      const m2=txt.match(/연고 적용\(([^)]+)\)/);
      if(m2)meds=meds.concat(m2[1].split(',').map(function(s){return s.trim();}));
      const m3=txt.match(/파스 적용\(([^)]+)\)/);
      if(m3)meds=meds.concat(m3[1].split(',').map(function(s){return s.trim();}));
    }
    /* treatment 배열에서도 추출 */
    if(Array.isArray(r.treatment)){
      r.treatment.forEach(function(t){
        const tm=t.match(/^(?:투약|연고 적용|파스 적용)\((.+)\)$/);
        if(tm)meds=meds.concat(tm[1].split(',').map(function(s){return s.trim();}));
      });
    }
    meds.forEach(function(med){if(med)freq[med]=(freq[med]||0)+1;});
  });
  return freq;
}

/* ➕ 약품 관리 바로가기 — 설정 → 보건일지 → "증상에 따른 투약 리스트 관리" 아코디언 자동 펼침.
 * 증상 처치 팝업과 투약 팝업은 그대로 유지하고, 설정 모달만 위에 덧입혀 띄운다.
 * 설정 모달이 닫히면 (사용자가 모달 바깥을 클릭하거나 ESC) — 투약 팝업의 약 목록을 재렌더링하여
 * 새로 추가된 약품이 즉시 보이도록 한다.
 *
 * subTarget (사용자 요청 2026-05-27):
 *   · 'add'  (기본) — 📥 상용 약품 추가 및 수정 (setMedSubAdd, 2단 grid 우측) 로 스크롤 + 하이라이트
 *   · 'hide'        — 👁 약품 숨기거나 보이게 하기 (setMedSubHide, 2단 grid 좌측) 로 스크롤 + 하이라이트
 *   투약 팝업 헤더의 "+" 드롭다운 두 항목에서 각각 호출됨. */
function _symOpenMedListSettings(curType, subTarget){
  if(typeof openSettings!=='function'){bus.emit&&bus.emit('toast:show',{text:'설정 화면을 열 수 없습니다.'});return;}
  const _sub = (subTarget==='hide') ? 'hide' : 'add';
  openSettings();
  /* 보건일지 카테고리로 전환 — 사이드바 active 표시까지 맞춤 */
  const _sb=document.querySelector('.settings-sidebar-item[data-cat="diary"]');
  if(typeof switchSettingsCat==='function')switchSettingsCat('diary', _sb||null);
  /* 투약 팝업(9600) / 증상 팝업(10100) 위로 설정 모달이 올라오도록 z-index 강제.
   * closeSettings 가 removeAttribute('style') 로 정리하므로 별도 복원 불필요. */
  const setOv=document.getElementById('settingsModal');
  if(setOv)setOv.style.zIndex='10800';
  /* 다이어리 탭 렌더가 끝난 다음 프레임에서 아코디언 검색·자동 펼침·스크롤 */
  setTimeout(function(){
    const accs=document.querySelectorAll('#settingsPanel .set-accordion');
    let target=null;
    accs.forEach(function(a){if(a.textContent.indexOf('증상에 따른 투약 리스트 관리')!==-1)target=a;});
    if(target){
      if(!target.classList.contains('open')&&typeof openAccordion==='function')openAccordion(target);
      /* 아코디언 열림 → 본문 렌더 완료 후 sub-target 으로 스크롤 + 하이라이트.
       * 아코디언 자체 스크롤은 sub-target 스크롤이 있으니 생략. */
      setTimeout(function(){
        const subId = (_sub==='hide') ? 'setMedSubHide' : 'setMedSubAdd';
        const sub = document.getElementById(subId);
        if(sub){
          sub.scrollIntoView({behavior:'smooth',block:'start'});
          /* 시안 박스 + 일시 강조 — 어디로 이동했는지 사용자가 즉시 인지 */
          const _prevBox = sub.style.boxShadow;
          const _prevTr  = sub.style.transition;
          sub.style.transition='box-shadow 0.25s';
          sub.style.boxShadow='0 0 0 2px var(--cyan)';
          setTimeout(function(){
            sub.style.boxShadow=_prevBox;
            setTimeout(function(){sub.style.transition=_prevTr;},260);
          },1400);
        } else {
          /* sub-section 못 찾으면 fallback — 아코디언 자체로 스크롤 */
          target.scrollIntoView({behavior:'smooth',block:'start'});
        }
      },120);
    }
  },80);
  /* 설정 모달 닫힘 감지 → 투약 팝업의 안쪽 내용만 교체하여 신규 추가 약품 반영.
   * 팝업 자체는 그대로 유지(remove/append 없음) → 깜빡임 발생 안 함. */
  if(setOv){
    const obs=new MutationObserver(function(){
      if(!setOv.classList.contains('show')){
        obs.disconnect();
        const cur=document.getElementById('symMedPopup');
        if(cur){
          /* 두 번째 인자 _isRefresh=true — 기존 팝업의 innerHTML 만 교체.
           * 위치·드래그 상태·문서 리스너·hover 위임 그대로 보존. */
          _symOpenMedPopup(curType||'med', _symActiveSymKey, true);
        }
      }
    });
    obs.observe(setOv,{attributes:true,attributeFilter:['class']});
  }
}

/* 2차 팝업: 투약/연고/파스.
 * _isRefresh=true 면 기존 팝업을 제거하지 않고 안쪽 내용만 교체 (깜빡임 방지).
 * v3 (사용자 결정 2026-05-21): symKey 인자 추가 — 어느 증상 블록의 투약 팝업인지 추적.
 *   진입 시 _symActiveSymKey 갱신 + _symSelectedMeds/_symMedDoses 를 그 sym-key 의 array/map reference 로 swap.
 *   기존 코드 (push/splice/delete/도즈 set) 는 reference 를 통해 _symMedsBySym/_symMedDosesBySym 에 자동 반영.
 *   legacy 모드 일지 (symKey 없음/__legacy__) 는 옛 동작 그대로 — 별도 record-level _symSelectedMeds 사용. */
function _symOpenMedPopup(type, symKey, _isRefresh){
  /* sym-key 모드 vs legacy — popup 진입 시 _symSelectedMeds/_symMedDoses swap. */
  if(!_isRefresh){
    const _newKey = (typeof symKey === 'string' && symKey) ? symKey : '__legacy__';
    _symActiveSymKey = _newKey;
    if(_newKey !== '__legacy__'){
      if(!_symMedsBySym[_newKey])_symMedsBySym[_newKey]=[];
      if(!_symMedDosesBySym[_newKey])_symMedDosesBySym[_newKey]={};
      /* reference swap — 이후 _symSelectedMeds.push/splice 가 _symMedsBySym[_newKey] 에 그대로 반영 */
      _symSelectedMeds = _symMedsBySym[_newKey];
      _symMedDoses = _symMedDosesBySym[_newKey];
    }
    /* legacy 모드는 popup 진입 시 복원된 _symSelectedMeds/_symMedDoses 를 그대로 사용 (회귀 없음) */
  }
  const existing=document.getElementById('symMedPopup');
  if(existing&&!_isRefresh)existing.remove();
  /* 팝업 제목 — '투약' 처치명이 _treatDisplayName 으로 커스텀된 경우 그 이름으로 표시.
   * 사용자가 "투약" → "약물 투여" 로 변경했다면 팝업 제목도 "💊 약물 투여 선택" 으로 자연스럽게 반영. */
  const _medTitleName=_treatDisplayName('투약');
  const titles={med:'💊 '+_medTitleName+' 선택',ointment:'🧴 연고 선택',patch:'🩹 파스 선택',eyedrop:'👁 인공눈물 선택',cleansing:'🧴 소독 드레싱 선택'};

  /* 투약 팝업: 증상 기반 추천 + 전체 목록 */
  let recItems=[], recCats=[];
  let allItems=[];
  if(type==='med'){
    /* v3 (사용자 결정 2026-05-21) — sym-key 모드면 활성 블록 sym 만, legacy 면 전체 합집합.
     * 옛 코드는 항상 전체 _symSelectedSymptoms 합집합이라 여러 증상 약이 복합적으로 떴음 (회귀). */
    let matchedCats=[];
    const _catTargetSyms = (_symActiveSymKey && _symActiveSymKey !== '__legacy__')
      ? [_symActiveSymKey] : _symSelectedSymptoms;
    _catTargetSyms.forEach(function(s){
      const _split = (typeof _symSplitSymLabel==='function') ? _symSplitSymLabel(s) : null;
      const sym = (_split && _split.base) || s;
      const cats=_medSymMap[sym]||[];
      cats.forEach(function(c){if(matchedCats.indexOf(c)===-1)matchedCats.push(c);});
    });
    /* 투약 팝업: 내복약 카테고리만 필터 */
    const allMedCats=['digest','digestPain','menstrual','pain','supplement','respiratory','allergy','anxiety','throat','oral','skin','wound','eye','trauma','herpes','burn','hemostasis','cleansing','scar','nasal'];
    matchedCats=matchedCats.filter(function(c){return allMedCats.indexOf(c)!==-1;});
    /* 카테고리 우선순위 정렬 (외상→소독/연고→파스→진통, 피부→연고→알레르기, 눈→점안액 등) */
    const _catPriority=['wound','skin','herpes','burn','scar','hemostasis','cleansing','trauma','eye','nasal','oral','digest','digestPain','menstrual','respiratory','throat','allergy','anxiety','supplement','pain'];
    matchedCats.sort(function(a,b){const ai=_catPriority.indexOf(a), bi=_catPriority.indexOf(b);return(ai===-1?99:ai)-(bi===-1?99:bi);});
    /* 추천 약품: 증상별 지그재그 순환 (증상1약1→증상2약1→증상1약2→증상2약2...) */
    const recSet={};
    recItems=[];
    /* v3 (사용자 결정 2026-05-21) — sym-key 단일 매칭. 옛 코드의 합집합은 회귀 (여러 증상 약이 복합적으로 뜸).
     * sym-key 모드: 현재 활성 블록의 증상만 매칭. legacy 모드: 옛 동작 (모든 증상 합집합). */
    const _targetSyms = (_symActiveSymKey && _symActiveSymKey !== '__legacy__')
      ? [_symActiveSymKey]
      : _symSelectedSymptoms;
    const _usageFreq=_symGetMedFrequency();
    const symMedLists=[];
    _targetSyms.forEach(function(symLabel){
      /* sym 라벨에서 base name 추출 — _medFrequent/_medSymMap/ec_user_med_syms 는 base 기준 매핑 */
      const _split = (typeof _symSplitSymLabel==='function') ? _symSplitSymLabel(symLabel) : null;
      const sym = (_split && _split.base) || symLabel;
      const freq=_medFrequent[sym]||[];
      /* 사용자 커스텀 매칭 — 약품→증상 매핑을 역변환해 이 sym 에 매핑된 약품 추출 */
      const _ums=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
      const userFreq=[];
      Object.keys(_ums).forEach(function(med){if((_ums[med]||[]).indexOf(sym)!==-1)userFreq.push(med);});
      const cats=(_medSymMap[sym]||[]).filter(function(c){return matchedCats.indexOf(c)!==-1;});
      cats.sort(function(a,b){const ai=_catPriority.indexOf(a), bi=_catPriority.indexOf(b);return(ai===-1?99:ai)-(bi===-1?99:bi);});
      /* v3 (사용자 결정 2026-05-21) — 우선순위 명시 분리:
       *   ① 사용자 등록 약물 (ec_user_med_syms + S._medDbUser) — 가장 먼저
       *   ② 프로그램 기본 매핑 (_medFrequent + _medDb)
       * 각 그룹 내부는 사용 빈도순 정렬. */
      const _userMeds=[];
      userFreq.forEach(function(m){if(_userMeds.indexOf(m)===-1)_userMeds.push(m);});
      cats.forEach(function(c){
        ((S._medDbUser&&S._medDbUser[c])||[]).forEach(function(m){if(_userMeds.indexOf(m)===-1)_userMeds.push(m);});
      });
      /* 사용자 요청 2026-05-27: 사용자가 직접 "+ 약품 추가" 로 등록한 약품(_userAddedMeds)은
       *  매칭된 증상 선택 시 최상위. user_added → frequency → 알파벳 순. */
      const _userAddedMap=(function(){
        try{ return JSON.parse(localStorage.getItem('ec_user_added_meds')||'{}')||{}; }catch(_){ return {}; }
      })();
      _userMeds.sort(function(a,b){
        const aA=!!_userAddedMap[a], bA=!!_userAddedMap[b];
        if(aA && !bA) return -1;
        if(!aA && bA) return 1;
        return (_usageFreq[b]||0)-(_usageFreq[a]||0);
      });
      const _defaultMeds=[];
      freq.forEach(function(m){if(_defaultMeds.indexOf(m)===-1 && _userMeds.indexOf(m)===-1)_defaultMeds.push(m);});
      cats.forEach(function(c){
        (_medDb[c]||[]).forEach(function(m){if(_defaultMeds.indexOf(m)===-1 && _userMeds.indexOf(m)===-1)_defaultMeds.push(m);});
      });
      _defaultMeds.sort(function(a,b){return(_usageFreq[b]||0)-(_usageFreq[a]||0);});
      const meds=_userMeds.concat(_defaultMeds);
      if(meds.length)symMedLists.push(meds);
    });
    /* 지그재그 순환 */
    if(symMedLists.length){
      const maxLen=Math.max.apply(null,symMedLists.map(function(l){return l.length;}));
      for(let mi=0;mi<maxLen;mi++){
        symMedLists.forEach(function(list){
          if(mi<list.length&&!recSet[list[mi]]){recSet[list[mi]]=true;recItems.push(list[mi]);}
        });
      }
    }
    recCats=matchedCats;
    /* 전체 목록: _medDb + S._medDbUser (카테고리별 사용자 약품) + ec_user_med_syms 의 키 (설정→약품관리 에서
     * 추가된 약품 — 카테고리 매핑은 없지만 검색에는 잡혀야 함). 추천에 이미 들어간 약품은 제외.
     * 사용자 보고 2026-05-19 — 새로 추가한 약품이 투약 팝업 검색에 안 잡히던 누락 보완. */
    const allSet={};
    allMedCats.forEach(function(c){
      (_medDb[c]||[]).forEach(function(m){if(!recSet[m])allSet[m]=1;});
      ((S._medDbUser&&S._medDbUser[c])||[]).forEach(function(m){if(!recSet[m])allSet[m]=1;});
    });
    try{
      const _userMedAll=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
      Object.keys(_userMedAll).forEach(function(m){if(!recSet[m])allSet[m]=1;});
    }catch(_){}
    /* 현재 선택된 약품(_symSelectedMeds)은 카테고리/숨김 여부와 무관하게 무조건 목록에 포함 —
     * 칩 클릭 → 위치 이동 시 누락되지 않도록. (사용자 보고 2026-05-20) */
    _symSelectedMeds.forEach(function(m){if(!recSet[m])allSet[m]=1;});
    allItems=Object.keys(allSet);
  } else if(type==='ointment'){
    allItems=(S._symOintments.length?S._symOintments:(_medDb.wound||[])).slice();
  } else if(type==='eyedrop'){
    allItems=(_medDb.eyeDrop||[]).slice();
    /* eye 카테고리에서 점안/눈물 키워드 포함 항목도 추가 */
    (_medDb.eye||[]).forEach(function(m){if((m.indexOf('점안')!==-1||m.indexOf('눈물')!==-1)&&allItems.indexOf(m)===-1)allItems.push(m);});
  } else if(type==='cleansing'){
    allItems=(_medDb.cleansing||[]).slice();
    /* disinfect 카테고리도 포함 */
    (_medDb.disinfect||[]).forEach(function(m){if(allItems.indexOf(m)===-1)allItems.push(m);});
  } else {
    allItems=(S._symPatches.length?S._symPatches:(_medDb.trauma||[])).slice();
  }

  /* 리프레시 모드: 기존 팝업 재사용. 새로 만들 때만 위치·애니메이션 설정. */
  const pop = _isRefresh ? existing : document.createElement('div');
  if(!_isRefresh){
    pop.id='symMedPopup';
    pop.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.92);opacity:0;background:var(--card);border:1px solid var(--cyan);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.3);width:340px;height:460px;z-index:9600;display:flex;flex-direction:column;overflow:hidden;transition:opacity .18s ease,transform .18s ease';
  }

  /* 헤더: 제목 + 우측 "+" 드롭다운 (사용자 요청 2026-05-27).
   *  · "+" 만 보이는 토글 버튼 → 클릭 시 두 항목 메뉴:
   *      ① 상용 약품 추가 및 수정     → 설정 → 증상에 따른 투약 리스트 관리 → 2단 grid 우측 (setMedSubAdd)
   *      ② 약품 숨기거나 보이게 하기  → 같은 아코디언의 2단 grid 좌측 (setMedSubHide)
   *  · 메뉴 항목 사이는 회색 구분선. 외부 클릭 시 메뉴 닫힘.
   *  · 약품이 없을 때 처치 팝업을 닫고 설정으로 가는 번거로움 제거. 클릭해도 증상/투약 팝업은 유지. */
  let h='<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px">';
  h+='<span style="flex:1;font-size:13px;font-weight:700;color:var(--t1)">'+titles[type]+'</span>';
  h+='<div style="position:relative;display:inline-flex">';
  h+='<button class="sym-hdr-chip" data-action="toggleMedAddMenu" data-tooltip="약품 추가·수정 / 숨기기 메뉴 열기" data-tooltip-instant="1" style="width:26px;height:26px;padding:0;font-size:16px;font-weight:800;border-radius:6px;border:1px solid rgba(34,197,94,0.35);background:rgba(34,197,94,0.10);color:#16a34a;cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;font-family:var(--f)">+</button>';
  h+='<div id="symMedAddMenu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);background:var(--card);border:1px solid var(--bdr);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.22);min-width:260px;z-index:30;overflow:hidden">';
  h+='<div data-action="medAddCommon" class="sym-med-add-menu-item" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'var(--card)\'" style="padding:10px 14px;font-size:11.5px;color:var(--t1);cursor:pointer;display:flex;align-items:center;gap:8px;font-family:var(--f);background:var(--card);transition:background .12s"><span style="font-size:13px">📥</span><span style="font-weight:700">상용 약품 추가 및 수정</span></div>';
  h+='<div style="border-top:1px solid var(--bdr)"></div>';
  h+='<div data-action="medEditHide" class="sym-med-add-menu-item" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'var(--card)\'" style="padding:10px 14px;font-size:11.5px;color:var(--t1);cursor:pointer;display:flex;align-items:center;gap:8px;font-family:var(--f);background:var(--card);transition:background .12s"><span style="font-size:13px">👁</span><span style="font-weight:700">약품 숨기거나 보이게 하기</span></div>';
  h+='</div>';
  h+='</div>';
  h+='</div>';
  h+='<div style="padding:8px 16px;border-bottom:1px solid var(--bdr)">';
  h+='<input class="form-input" id="symMedSearch" data-med-type="'+type+'" placeholder="검색" style="width:100%;font-size:11px;padding:5px 8px">';
  h+='</div>';
  /* 선택된 약품 칩 표시 (✕로 개별 삭제 가능) — 빈 상태에서도 컨테이너 유지해서 동적 갱신 가능 */
  h+='<div id="symMedSelectedChips" data-med-type="'+type+'" style="padding:'+(_symSelectedMeds.length>0?'6px 16px':'0')+';border-bottom:'+(_symSelectedMeds.length>0?'1px solid var(--bdr)':'none')+';display:'+(_symSelectedMeds.length>0?'flex':'none')+';flex-wrap:wrap;gap:3px;align-items:center">';
  if(_symSelectedMeds.length>0){
    h+='<span style="font-size:9px;color:var(--t3);font-weight:700;margin-right:2px">선택:</span>';
    _symSelectedMeds.forEach(function(m){
      const _d=_symMedDoses[m]||'';
      const _disp=_d?(escHtml(m)+' ('+escHtml(_d)+')'):escHtml(m);
      h+='<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border-radius:8px;background:rgba(6,182,212,0.1);color:var(--cyan);font-size:9px;font-weight:600;border:1px solid rgba(6,182,212,0.2)"><span data-action="scrollToMed" data-med="'+escHtml(m)+'" data-med-type="'+type+'" style="cursor:pointer" data-tooltip="이 약품 위치로 이동" data-tooltip-instant="1">'+_disp+'</span><span data-action="deselectMedChip" data-med="'+escHtml(m)+'" data-med-type="'+type+'" style="cursor:pointer;font-size:11px;line-height:1;margin-left:2px;color:var(--cyan);opacity:0.7">✕</span></span>';
    });
  }
  h+='</div>';
  h+='<div style="flex:1;overflow-y:auto;padding:8px 16px;scrollbar-width:thin" id="symMedList">';

  function _medItem(item,tp){
    const isSel=_symSelectedMeds.indexOf(item)!==-1;
    /* 숨긴 약은 제외 — 단 현재 선택된 약은 항상 표시(칩 → 위치 이동 보장) */
    if(_medIsHidden(item) && !isSel) return '';
    /* 선택된 약품에만 투여량 입력 칸 노출 (선택사항 — 비워두면 칩에 약명만). */
    const _doseInp=isSel
      ? _buildMedDoseInput(item)
      : '';
    return '<div class="sym-sel-chip" data-action="selectMed" data-med="'+escHtml(item)+'" data-med-type="'+tp+'" data-sel="'+(isSel?'1':'')+'" style="padding:5px 8px;margin-bottom:2px;border-radius:6px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:6px;border:1px solid '+(isSel?'var(--cyan)':'transparent')+';background:'+(isSel?'rgba(6,182,212,0.08)':'transparent')+';transition:all .15s">'+
      (isSel?'<span style="color:var(--cyan);font-size:13px">✓</span>':'')+
      '<span class="sym-med-name" title="'+escHtml(item)+'">'+escHtml(item)+'</span>'+
      _doseInp+
      '<span data-action="drugInfo" data-drug="'+escHtml(item)+'" style="cursor:pointer;font-size:12px;flex-shrink:0;color:var(--cyan);opacity:0.6;transition:opacity .12s;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--cyan);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:10px" data-tooltip="약품 정보 조회" data-tooltip-instant="1">i</span>'+'</div>';
  }

  if(type==='med'&&recItems.length>0){
    h+='<div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px;padding-bottom:2px;border-bottom:1px solid rgba(6,182,212,0.15)">★ 추천 약품 (선택 증상 기반)</div>';
    if(recCats.length>0){
      h+='<div style="font-size:9px;color:var(--t3);margin-bottom:4px">'+recCats.map(function(c){return _medCatNames[c]||c;}).join(' · ')+'</div>';
    }
    recItems.forEach(function(item){h+=_medItem(item,type);});
    if(allItems.length>0){
      h+='<div style="font-size:10px;font-weight:700;color:var(--t3);margin-top:8px;margin-bottom:4px;padding-top:6px;border-top:1px solid var(--bdr)">전체 약품</div>';
      allItems.forEach(function(item){h+=_medItem(item,type);});
    }
  } else {
    allItems.forEach(function(item){h+=_medItem(item,type);});
  }

  h+='</div>';
  /* 푸터 — 커스텀 안내 (사용자 요청 2026-05-27) + 외부 클릭으로 저장 (사용자 요청 2026-05-23).
   * 두 줄을 하나의 푸터 박스 안에 두고 사이를 가는 회색 구분선으로 분리. */
  h+='<div style="border-top:1px solid var(--bdr);background:var(--bg3);font-family:var(--f);flex-shrink:0">';
  h+='<div style="padding:7px 16px;font-size:10px;color:var(--t3);line-height:1.7">선생님의 학교에서 자주 사용하는 약품만 따로 등록하고 싶은 경우 이 팝업 우측 상단의 <b style="color:#16a34a;font-weight:800">"+"</b> &gt; <b>"상용 약품 추가 및 수정"</b>, <b>"약품 숨기거나 보이게 하기"</b>에서 커스텀할 수 있습니다.</div>';
  h+='<div style="border-top:1px solid var(--bdr)"></div>';
  h+='<div style="padding:7px 16px;font-size:10px;color:var(--t3);text-align:right">외부 클릭으로 저장</div>';
  h+='</div>';
  pop.innerHTML=h;
  setTimeout(function(){_symAttachUnitHover(pop);}, 0);
  if(!_isRefresh){
    document.body.appendChild(pop);
    /* 약품 선택 팝업도 통합 미니 팝업 GUI 사용 — 'i' 약품 정보 / ✕ 약품 삭제 / 약품 위치 이동 칩 등. */
    _symBindTipDelegation(pop);
    /* 열림 애니메이션 + 글자 흐림 방지.
     * 애니메이션 종료 후 transform 에서 scale 을 빼서 GPU compositor layer 해제 — 그래야 텍스트가
     * subpixel antialiasing 으로 또렷하게 그려짐 (scale 이 남아 있으면 GPU 텍스처에 비정수 픽셀로
     * 래스터라이즈되어 흐림 → 사용자가 클릭/스크롤할 때마다 또렷해졌다 흐려졌다 반복하는 원인). */
    requestAnimationFrame(function(){pop.style.opacity='1';pop.style.transform='translate(-50%,-50%) scale(1)';});
    /* 검색 input 자동 포커스 — 사용자 요청 (2026-05-23): 팝업 열리면 바로 타이핑 가능하도록 */
    requestAnimationFrame(function(){
      const _srch=document.getElementById('symMedSearch');
      if(_srch){
        try{_srch.focus();}catch(_){}
      }
    });
    setTimeout(function(){
      if(!pop || pop._closing) return;
      /* 드래그로 픽셀 좌표 고정된 경우 (top/left 가 % 아닌 px) 는 건드리지 않음 */
      if(pop.style.top && pop.style.top.indexOf('%')!==-1){
        pop.style.transform='translate(-50%,-50%)';
      }
      /* 애니메이션 종료 후에도 포커스가 빠졌다면 다시 시도 */
      const _srch2=document.getElementById('symMedSearch');
      if(_srch2 && document.activeElement!==_srch2){
        try{_srch2.focus();}catch(_){}
      }
    }, 220);
    /* 닫기 애니메이션 — 드래그로 픽셀 좌표 고정된 경우/아닌 경우 분기 */
    pop._animClose=function(cb){
      if(pop._closing)return;pop._closing=true;
      const dragged=pop.style.left&&pop.style.left.indexOf('px')!==-1;
      pop.style.opacity='0';
      pop.style.transform=dragged?'scale(0.92)':'translate(-50%,-50%) scale(0.92)';
      setTimeout(function(){if(pop.parentNode)pop.remove();if(cb)cb();},180);
    };
    /* 헤더 드래그 이동 */
    _makeDraggable(pop);
  }
  /* 투약 팝업 이벤트 위임 — 리프레시 모드일 땐 이미 부착되어 있으므로 스킵 */
  if(!_isRefresh)pop.addEventListener('click',function(e){
    /* 드롭다운 메뉴가 열려 있고 클릭이 메뉴/토글 외 영역이면 메뉴 먼저 닫기 — 다른 action 처리는 그대로 진행. */
    const _openMn=document.getElementById('symMedAddMenu');
    if(_openMn && _openMn.style.display==='block'
       && !e.target.closest('#symMedAddMenu')
       && !e.target.closest('[data-action="toggleMedAddMenu"]')){
      _openMn.style.display='none';
    }
    const drugBtn=e.target.closest('[data-action="drugInfo"]');
    if(drugBtn){e.stopPropagation();_showDrugInfo(drugBtn.dataset.drug);return;}
    const hideBtn=e.target.closest('[data-action="medHide"]');
    if(hideBtn){e.stopPropagation();_medHide(hideBtn.dataset.med,hideBtn);return;}
    const deselChip=e.target.closest('[data-action="deselectMedChip"]');
    if(deselChip){e.stopPropagation();_symSelectMed(deselChip.dataset.med,deselChip.dataset.medType);return;}
    /* 선택 칩 텍스트 클릭 — 리스트 내 해당 약품 위치로 스크롤 + 잠시 하이라이트 */
    const scrollChip=e.target.closest('[data-action="scrollToMed"]');
    if(scrollChip){
      e.stopPropagation();
      const med=scrollChip.dataset.med;
      const list=document.getElementById('symMedList');
      if(list){
        const rows=list.querySelectorAll('[data-action="selectMed"]');
        let target=null;
        rows.forEach(function(r){if(r.dataset.med===med)target=r;});
        if(target){
          try{ target.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){ target.scrollIntoView(); }
          const _prev=target.style.boxShadow;
          target.style.transition='box-shadow 0.25s';
          target.style.boxShadow='0 0 0 2px var(--cyan)';
          setTimeout(function(){target.style.boxShadow=_prev;},1200);
        }
      }
      return;
    }
    /* 헤더 "+" 토글 — 드롭다운 메뉴 열기/닫기 (사용자 요청 2026-05-27) */
    const tgBtn=e.target.closest('[data-action="toggleMedAddMenu"]');
    if(tgBtn){
      e.stopPropagation();
      const mn=document.getElementById('symMedAddMenu');
      if(mn) mn.style.display = (mn.style.display==='block')?'none':'block';
      return;
    }
    /* 메뉴 항목 — 상용 약품 추가 (sub-target='add') */
    const addBtn=e.target.closest('[data-action="medAddCommon"]');
    if(addBtn){
      e.stopPropagation();
      const mn=document.getElementById('symMedAddMenu'); if(mn) mn.style.display='none';
      _symOpenMedListSettings(type, 'add');
      return;
    }
    /* 메뉴 항목 — 약품 숨기거나 보이게 하기 (sub-target='hide') */
    const editBtn=e.target.closest('[data-action="medEditHide"]');
    if(editBtn){
      e.stopPropagation();
      const mn=document.getElementById('symMedAddMenu'); if(mn) mn.style.display='none';
      _symOpenMedListSettings(type, 'hide');
      return;
    }
    /* (구) data-action="openMedListSettings" — 새 메뉴로 대체되어 더 이상 발화하지 않지만,
     * 외부 호출/하위 호환을 위해 핸들러는 유지 (sub-target 미지정 → 'add' 기본). */
    const setBtn=e.target.closest('[data-action="openMedListSettings"]');
    if(setBtn){e.stopPropagation();_symOpenMedListSettings(type, 'add');return;}
    /* 투여량 입력칸 클릭 — 선택 토글 차단 (입력 포커스만 가져가도록) */
    const doseInp=e.target.closest('[data-action="medDoseInput"]');
    if(doseInp){e.stopPropagation();return;}
    /* 단위 트리거 클릭 — 선택 토글만 차단 (호버 메뉴는 CSS :hover 로 표시) */
    const unitTrig=e.target.closest('.sym-med-unit-trigger');
    if(unitTrig){e.stopPropagation();return;}
    /* 단위 메뉴 영역 클릭 — 외부 클릭으로 인식되지 않도록 차단 */
    const unitMenu=e.target.closest('.sym-med-unit-menu');
    if(unitMenu){e.stopPropagation();return;}
    /* 단위 선택 — 입력칸 값 끝의 기존 단위 제거 후 새 단위 부착, input 이벤트 dispatch */
    const unitPick=e.target.closest('[data-action="pickMedUnit"]');
    if(unitPick){
      e.stopPropagation();
      const med=unitPick.dataset.med;
      const unit=unitPick.dataset.unit;
      const wrap=unitPick.closest('.sym-med-dose-wrap');
      const inp=wrap?wrap.querySelector('[data-action="medDoseInput"]'):null;
      if(inp){
        let v=String(inp.value||'').trim();
        ['T','C','g','cc','ml','mg','gtt','포','개','병'].forEach(function(u){
          if(v.endsWith(u)) v=v.slice(0,-u.length).trim();
        });
        inp.value=v+unit;
        inp.dispatchEvent(new Event('input',{bubbles:true}));
      }
      return;
    }
    const sel=e.target.closest('[data-action="selectMed"]');
    if(sel){_symSelectMed(sel.dataset.med,sel.dataset.medType);return;}
  });
  /* 투여량 input — 사용자가 타이핑할 때 _symMedDoses 동기화 + 상단 칩 라이브 갱신 */
  if(!_isRefresh)pop.addEventListener('input',function(e){
    const di=e.target.closest('[data-action="medDoseInput"]');
    if(!di)return;
    const med=di.dataset.med;
    const v=String(di.value||'').trim();
    if(v)_symMedDoses[med]=v;
    else delete _symMedDoses[med];
    /* 상단 "선택:" 칩만 가벼운 부분 갱신 — 전체 리스트 재렌더하지 않아 포커스 유지 */
    _symRefreshSelectedChips(type);
    /* 즉시 저장 */
    _symAutoSave();
  });
  /* 투여량 input keydown — Enter / 화살표 등 기본 동작 보존, 단 픽업 셀렉트 토글 막기 */
  if(!_isRefresh)pop.addEventListener('keydown',function(e){
    const di=e.target.closest('[data-action="medDoseInput"]');
    if(!di)return;
    if(e.key==='Enter'){e.preventDefault();di.blur();}
    /* Tab — 바디맵 이력 칩으로 가지 말고, 단위 메뉴를 열어 첫 단위에 focus (사용자 요청 2026-06-16).
     *  이후 방향키 이동 / 엔터 선택 / ESC 저장후닫기 는 메뉴 자체 keydown 핸들러가 처리. */
    else if(e.key==='Tab' && !e.shiftKey){
      const wrap=di.closest('.sym-med-dose-wrap');
      const trig=wrap?wrap.querySelector('.sym-med-unit-trigger'):null;
      const menu=wrap?wrap._unitMenu:null;
      if(trig && menu){
        e.preventDefault();
        trig.dispatchEvent(new Event('mouseenter'));   /* _show 로 메뉴 위치 계산 + 표시 */
        const first=menu.querySelector('[data-action="pickMedUnit"]');
        if(first)first.focus();
      }
    }
  });
  /* ➕ 약품 관리 바로가기 칩 tooltip 바인딩 — innerHTML 재설정 후 새 칩에 매번 부착 */
  pop.querySelectorAll('.sym-hdr-chip[data-tip]').forEach(function(chip){
    chip.addEventListener('mouseenter',function(){_symShowTip(chip,chip.getAttribute('data-tip'));});
    chip.addEventListener('mouseleave',function(){_symHideTip();});
  });
  /* 단위 메뉴 — JS 전용 hover 처리. CSS :hover 미사용.
   *  · mouseover wrap → 트리거 좌표 계산 후 display:flex
   *  · mouseover menu → 유지 (display:flex)
   *  · mouseout (relatedTarget 가 wrap/menu 외부) → display:none */
  if(!_isRefresh){
    const _hideAllUnitMenus=function(){
      pop.querySelectorAll('.sym-med-unit-menu').forEach(function(m){m.style.display='none';});
    };
    const _showUnitMenu=function(wrap){
      const trig=wrap.querySelector('.sym-med-unit-trigger');
      const menu=wrap.querySelector('.sym-med-unit-menu');
      if(!trig || !menu)return;
      /* 다른 메뉴 모두 닫고 이 메뉴만 표시 */
      _hideAllUnitMenus();
      menu.style.display='flex';
      const tR=trig.getBoundingClientRect();
      const mW=menu.offsetWidth||240, mH=menu.offsetHeight||32;
      let top=tR.bottom+4;
      let left=tR.right-mW;
      if(left<6) left=6;
      if(left+mW>window.innerWidth-6) left=window.innerWidth-mW-6;
      if(top+mH>window.innerHeight-6) top=tR.top-mH-4;
      menu.style.top=top+'px';
      menu.style.left=left+'px';
      menu.style.right='auto';
    };
    pop.addEventListener('mouseover', function(e){
      const wrap=e.target.closest('.sym-med-dose-wrap');
      if(wrap){ _showUnitMenu(wrap); return; }
      const inMenu=e.target.closest('.sym-med-unit-menu');
      if(inMenu){ inMenu.style.display='flex'; return; }
    }, true);
    pop.addEventListener('mouseout', function(e){
      const fromWrap=e.target.closest('.sym-med-dose-wrap');
      const fromMenu=e.target.closest('.sym-med-unit-menu');
      if(!fromWrap && !fromMenu) return;
      const to=e.relatedTarget;
      /* relatedTarget 이 wrap(또는 그 안 menu) 안이면 유지 */
      if(to){
        const toWrap=to.closest && to.closest('.sym-med-dose-wrap');
        const toMenu=to.closest && to.closest('.sym-med-unit-menu');
        if(toWrap || toMenu) return;
      }
      _hideAllUnitMenus();
    }, true);
  }
  /* 약품 항목 hover — 배경색 + 눈알 아이콘 표시 (리프레시 모드 X — pop 자체에 한 번만 부착) */
  if(!_isRefresh){
    pop.addEventListener('mouseenter',function(e){
      const row=e.target.closest('[data-action="selectMed"]');if(!row)return;
      row.style.background='rgba(6,182,212,0.06)';
      const eye=row.querySelector('.med-eye-btn');if(eye)eye.style.opacity='1';
      /* drugInfo 아이콘 opacity */
      const di=e.target.closest('[data-action="drugInfo"]');if(di)di.style.opacity='1';
    },true);
    pop.addEventListener('mouseleave',function(e){
      const row=e.target.closest('[data-action="selectMed"]');if(!row)return;
      row.style.background=row.dataset.sel?'rgba(6,182,212,0.08)':'transparent';
      const eye=row.querySelector('.med-eye-btn');if(eye)eye.style.opacity='0';
      const di=e.target.closest('[data-action="drugInfo"]');if(di)di.style.opacity='0.6';
    },true);
  }
  /* 검색 input — 300ms 디바운스로 입력 중 연속 필터링 부하 완화.
     검색어가 바뀔 때마다 상한도 50 으로 초기화. */
  const _medSearchInp=document.getElementById('symMedSearch');
  if(_medSearchInp){
    let _medSearchTimer=null;
    _medSearchInp.addEventListener('input',function(){
      clearTimeout(_medSearchTimer);
      /* 새 검색어 → 결과 표시 상한 초기화 */
      const _t=_medSearchInp.dataset.medType;
      if(_t) _symMedSearchShownLimit[_t]=50;
      _medSearchTimer=setTimeout(function(){
        _symMedSearchFilter(_t);
      }, 300);
    });
  }
  /* 바깥 클릭/ESC로 닫기 — 리프레시 모드는 이미 부착된 리스너가 살아있으므로 스킵 */
  if(_isRefresh)return;
  setTimeout(function(){
    function _medPopClose(e){
      const p=document.getElementById('symMedPopup');
      if(!p){document.removeEventListener('mousedown',_medPopClose,true);document.removeEventListener('keydown',_medPopEsc,true);return;}
      /* 약 정보 팝업(상위)이 떠 있는 동안은 투약 팝업 유지 — 상위 팝업이 먼저 닫히도록 */
      if(document.getElementById('drugInfoPopup'))return;
      /* 설정 모달이 떠 있는 동안 (➕ 약품 추가에서 진입) 투약 팝업 유지 */
      const _setOv=document.getElementById('settingsModal');
      if(_setOv&&_setOv.classList.contains('show'))return;
      /* 단위 드롭다운 메뉴는 body 로 옮겨져 있어 popup 외부로 인식됨 — 메뉴 안 클릭 시 popup 유지 */
      if(e.target.closest && e.target.closest('.sym-med-unit-menu'))return;
      if(!p.contains(e.target)){
        e.stopImmediatePropagation();e.preventDefault();
        const doClose=function(){if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel();};
        if(p._animClose)p._animClose(doClose);else{p.remove();doClose();}
        document.removeEventListener('mousedown',_medPopClose,true);
        document.removeEventListener('keydown',_medPopEsc,true);
      }
    }
    function _medPopEsc(e){
      if(e.key==='Escape'){
        /* 약 정보 팝업이 떠 있으면 그것이 먼저 닫히도록 투약 팝업은 유지 */
        if(document.getElementById('drugInfoPopup'))return;
        /* 설정 모달이 떠 있으면 ESC 는 설정 닫기 우선 */
        const _setOv=document.getElementById('settingsModal');
        if(_setOv&&_setOv.classList.contains('show'))return;
        e.stopImmediatePropagation();e.preventDefault();
        const p=document.getElementById('symMedPopup');
        if(p){
          const doClose=function(){if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel();};
          if(p._animClose)p._animClose(doClose);else{p.remove();doClose();}
        }
        document.removeEventListener('mousedown',_medPopClose,true);
        document.removeEventListener('keydown',_medPopEsc,true);
      }
    }
    document.addEventListener('mousedown',_medPopClose,true);
    document.addEventListener('keydown',_medPopEsc,true);
  },10);
}

function _symMedSearchFilter(type){
  const input=document.getElementById('symMedSearch');
  const q=(input&&input.value.trim().toLowerCase())||'';
  if(!q){
    /* 검색어 비우면 원래 목록 복원 — 팝업 재생성 없이 리스트만 */
    const list0=document.getElementById('symMedList');if(!list0)return;
    /* 전체 내복약 표시 — _medDb + S._medDbUser + ec_user_med_syms 키 모두 포함.
     * 사용자 보고 2026-05-19: 추가한 약품이 빈 검색 상태에서도 보여야 함. */
    const allMedCats0=['digest','digestPain','menstrual','pain','supplement','respiratory','allergy','anxiety','throat','oral','skin','wound','eye','trauma','herpes','burn','hemostasis','cleansing','scar','nasal'];
    const all0={};
    allMedCats0.forEach(function(c){
      (_medDb[c]||[]).forEach(function(m){all0[m]=1;});
      ((S._medDbUser&&S._medDbUser[c])||[]).forEach(function(m){all0[m]=1;});
    });
    try{
      const _userMedAll0=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
      Object.keys(_userMedAll0).forEach(function(m){all0[m]=1;});
    }catch(_){}
    /* 약품 이름 수정 매핑 — 데이터는 item(원본), 표시만 새 이름. (사용자 보고 2026-05-19) */
    let _medRenames0={};
    try{_medRenames0=JSON.parse(localStorage.getItem('ec_med_renames')||'{}');}catch(_){}
    const items0=Object.keys(all0);
    let h0='';items0.forEach(function(item){
      const _disp0=_medRenames0[item]||item;
      const isSel=_symSelectedMeds.indexOf(item)!==-1;
      const _doseInp0=isSel?_buildMedDoseInput(item):'';
      h0+='<div data-action="selectMed" data-med="'+escHtml(item)+'" data-med-type="'+type+'" data-sel="'+(isSel?'1':'')+'" style="padding:5px 8px;margin-bottom:2px;border-radius:6px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:6px;border:1px solid '+(isSel?'var(--cyan)':'transparent')+';background:'+(isSel?'rgba(6,182,212,0.08)':'transparent')+'">'+(isSel?'<span style="color:var(--cyan)">✓</span>':'')+'<span class="sym-med-name" title="'+escHtml(_disp0)+'">'+escHtml(_disp0)+'</span>'+_doseInp0+'<span data-action="drugInfo" data-drug="'+escHtml(item)+'" style="cursor:pointer;font-size:12px;flex-shrink:0;color:var(--cyan);opacity:0.6;transition:opacity .12s;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--cyan);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:10px" data-tooltip="약품 정보 조회" data-tooltip-instant="1">i</span></div>';
    });
    list0.innerHTML=h0; _symAttachUnitHover(list0); return;
  }
  /* 검색어로 전체 풀 탐색 — _medDb + S._medDbUser + ec_user_med_syms 키 모두 포함.
   * 사용자 보고 2026-05-19: 설정→약품 관리에서 추가한 약품이 검색에 안 잡히던 누락 보완. */
  let allPool={};
  Object.keys(_medDb).forEach(function(c){(_medDb[c]||[]).forEach(function(m){allPool[m]=1;});});
  Object.keys(S._medDbUser).forEach(function(c){(S._medDbUser[c]||[]).forEach(function(m){allPool[m]=1;});});
  try{
    const _userMedAllSrch=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
    Object.keys(_userMedAllSrch).forEach(function(m){allPool[m]=1;});
  }catch(_){}
  if(type==='ointment'){allPool={};[].concat(S._symOintments).forEach(function(m){allPool[m]=1;});}
  if(type==='patch'){allPool={};[].concat(S._symPatches).forEach(function(m){allPool[m]=1;});}
  if(type==='eyedrop'){allPool={};(_medDb.eyeDrop||[]).forEach(function(m){allPool[m]=1;});(_medDb.eye||[]).forEach(function(m){if(m.indexOf('점안')!==-1||m.indexOf('눈물')!==-1)allPool[m]=1;});}
  if(type==='cleansing'){allPool={};(_medDb.cleansing||[]).forEach(function(m){allPool[m]=1;});(_medDb.disinfect||[]).forEach(function(m){allPool[m]=1;});}
  /* 초성 검색 + 첫 글자 매칭 우선 + 괄호 안 내용도 검색.
   * 사용자가 약품 이름을 수정한 경우 (ec_med_renames) 그 새 이름으로도 매칭되어야 함.
   * 사용자 보고 2026-05-19 — 이름 수정 후 새 이름으로 검색 안 잡히던 누락 보완. */
  let _medRenames={};
  try{_medRenames=JSON.parse(localStorage.getItem('ec_med_renames')||'{}');}catch(_){}
  const startMatch=[];const chosungMatch=[];const containMatch=[];
  const _hasKorean=/[가-힣ㄱ-ㅎ]/.test(q);
  Object.keys(allPool).forEach(function(m){
    const ml=m.toLowerCase();
    let paren='';const pi=m.indexOf('(');if(pi!==-1){paren=m.substring(pi+1).replace(')','').toLowerCase();}
    const _newName=_medRenames[m]||'';
    const _newL=_newName.toLowerCase();
    if(ml.startsWith(q)||paren.startsWith(q)||(_newL&&_newL.startsWith(q))) startMatch.push(m);
    else if(_hasKorean && typeof matchKoreanFromStart==='function' && (matchKoreanFromStart(m,q)||(_newName&&matchKoreanFromStart(_newName,q)))) chosungMatch.push(m);
    else if(_hasKorean && typeof matchKorean==='function' && (matchKorean(m,q)||(_newName&&matchKorean(_newName,q)))) chosungMatch.push(m);
    else if(ml.includes(q)||paren.includes(q)||(_newL&&_newL.includes(q))) containMatch.push(m);
  });
  const filtered=startMatch.concat(chosungMatch).concat(containMatch);
  const list=document.getElementById('symMedList');
  if(!list)return;
  /* 성능: 한 번에 최대 50개만 렌더 — 나머지는 "더보기" 버튼으로 추가 노출.
     결과가 수백개여도 첫 화면은 빠르게. */
  const MAX_SHOW = Math.max(50, _symMedSearchShownLimit[type]||50);
  const shown = filtered.slice(0, MAX_SHOW);
  const hiddenCount = filtered.length - shown.length;
  let h='';
  shown.forEach(function(item){
    /* 표시명은 rename 매핑 적용 (사용자 보고 2026-05-19) */
    const _dispS=_medRenames[item]||item;
    const isSel=_symSelectedMeds.indexOf(item)!==-1;
    const _doseInpS=isSel?_buildMedDoseInput(item):'';
    h+='<div data-action="selectMed" data-med="'+escHtml(item)+'" data-med-type="'+type+'" data-sel="'+(isSel?'1':'')+'" style="padding:5px 8px;margin-bottom:2px;border-radius:6px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:6px;border:1px solid '+(isSel?'var(--cyan)':'transparent')+';background:'+(isSel?'rgba(6,182,212,0.08)':'transparent')+'">'+
      (isSel?'<span style="color:var(--cyan)">✓</span>':'')+
      '<span class="sym-med-name" title="'+escHtml(_dispS)+'">'+escHtml(_dispS).replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark style="background:rgba(6,182,212,0.2);color:var(--t1);border-radius:2px;padding:0 1px">$1</mark>')+'</span>'+
      _doseInpS+
      '<span data-action="drugInfo" data-drug="'+escHtml(item)+'" style="cursor:pointer;font-size:12px;flex-shrink:0;color:var(--cyan);opacity:0.6;transition:opacity .12s;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--cyan);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:10px" data-tooltip="약품 정보 조회" data-tooltip-instant="1">i</span></div>';
  });
  if(!h)h='<div style="text-align:center;padding:10px;color:var(--t3);font-size:10px">검색 결과 없음</div>';
  if(hiddenCount>0){
    h+='<div data-action="loadMoreMeds" data-med-type="'+type+'" style="text-align:center;padding:8px;margin-top:4px;border-top:1px dashed var(--bdr);cursor:pointer;font-size:10px;color:var(--cyan);font-weight:700">+ '+hiddenCount+'개 더보기</div>';
  }
  list.innerHTML=h;
  _symAttachUnitHover(list);
  /* "더보기" 바인딩 */
  const moreBtn=list.querySelector('[data-action="loadMoreMeds"]');
  if(moreBtn){
    moreBtn.addEventListener('click', function(){
      _symMedSearchShownLimit[type] = (_symMedSearchShownLimit[type]||50) + 100;
      _symMedSearchFilter(type);
    });
  }
}
/* 타입별 현재 표시 상한 — 검색어 바뀔 때 초기화됨(아래 리셋 로직에서) */
const _symMedSearchShownLimit = {};

/* 투여량 입력 중 — 상단 "선택:" 칩만 부분 갱신 (포커스 유지) */
function _symRefreshSelectedChips(type){
  const chipBox=document.getElementById('symMedSelectedChips');
  if(!chipBox)return;
  const chipType=chipBox.dataset.medType||type;
  if(!_symSelectedMeds.length){
    chipBox.innerHTML='';
    chipBox.style.padding='0';
    chipBox.style.borderBottom='none';
    chipBox.style.display='none';
    return;
  }
  let _chipH='<span style="font-size:9px;color:var(--t3);font-weight:700;margin-right:2px">선택:</span>';
  _symSelectedMeds.forEach(function(m){
    const _d=_symMedDoses[m]||'';
    const _disp=_d?(escHtml(m)+' ('+escHtml(_d)+')'):escHtml(m);
    _chipH+='<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border-radius:8px;background:rgba(6,182,212,0.1);color:var(--cyan);font-size:9px;font-weight:600;border:1px solid rgba(6,182,212,0.2)">'+_disp+'<span data-action="deselectMedChip" data-med="'+escHtml(m)+'" data-med-type="'+chipType+'" style="cursor:pointer;font-size:11px;line-height:1;margin-left:2px;color:var(--cyan);opacity:0.7">✕</span></span>';
  });
  chipBox.innerHTML=_chipH;
}

function _symSelectMed(item,type){
  const idx=_symSelectedMeds.indexOf(item);
  if(idx===-1){
    _symSelectedMeds.push(item);
    const treatName=type==='med'?'투약':type==='ointment'?'연고 적용':type==='eyedrop'?'인공눈물 적용':type==='cleansing'?'소독 드레싱':'파스 적용';
    /* v3 — sym-key 모드면 _symTreatmentsBySym[symKey] 에 처치 추가, legacy 면 flat 에 추가 (사용자 결정 2026-05-21).
     * base name 매칭 — 메모 부착 처치도 같은 base 면 중복 추가 안 함. */
    if(_symActiveSymKey && _symActiveSymKey !== '__legacy__'){
      if(!_symTreatmentsBySym[_symActiveSymKey])_symTreatmentsBySym[_symActiveSymKey]=[];
      const _arr=_symTreatmentsBySym[_symActiveSymKey];
      const _found=_arr.some(function(x){return x===treatName||x.indexOf(treatName+'(')===0||x.indexOf(treatName+' (')===0;});
      if(!_found)_arr.push(treatName);
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    } else {
      if(_symSelectedTreatments.indexOf(treatName)===-1)_symSelectedTreatments.push(treatName);
    }
  } else {
    _symSelectedMeds.splice(idx,1);
    /* 약 해제 시 투여량도 같이 정리 */
    delete _symMedDoses[item];
  }
  _symAutoSave();
  _symRenderTreatPanel();
  /* 검색창 아래 선택된 약품 칩 영역 즉시 갱신 (X 클릭이든 행 클릭이든 동일하게) */
  const chipBox=document.getElementById('symMedSelectedChips');
  if(chipBox){
    const chipType=chipBox.dataset.medType||type;
    if(_symSelectedMeds.length>0){
      let _chipH='<span style="font-size:9px;color:var(--t3);font-weight:700;margin-right:2px">선택:</span>';
      _symSelectedMeds.forEach(function(m){
        const _d=_symMedDoses[m]||'';
        const _disp=_d?(escHtml(m)+' ('+escHtml(_d)+')'):escHtml(m);
        _chipH+='<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border-radius:8px;background:rgba(6,182,212,0.1);color:var(--cyan);font-size:9px;font-weight:600;border:1px solid rgba(6,182,212,0.2)">'+_disp+'<span data-action="deselectMedChip" data-med="'+escHtml(m)+'" data-med-type="'+chipType+'" style="cursor:pointer;font-size:11px;line-height:1;margin-left:2px;color:var(--cyan);opacity:0.7">✕</span></span>';
      });
      chipBox.innerHTML=_chipH;
      chipBox.style.padding='6px 16px';
      chipBox.style.borderBottom='1px solid var(--bdr)';
      chipBox.style.display='flex';
    } else {
      chipBox.innerHTML='';
      chipBox.style.padding='0';
      chipBox.style.borderBottom='none';
      chipBox.style.display='none';
    }
  }
  /* 투약 팝업 목록 선택 상태 즉시 갱신 (팝업 재생성 없이 in-place) */
  const list=document.getElementById('symMedList');
  if(list){
    const search=document.getElementById('symMedSearch');
    if(search&&search.value.trim()){
      _symMedSearchFilter(type);
    } else {
      list.querySelectorAll('[data-action="selectMed"]').forEach(function(el){
        const nameSpan=el.querySelector('.sym-med-name')||el.querySelector('span[style*="flex:1"]');
        if(!nameSpan)return;
        /* class 적용된 span 은 title 속성에 정규 약명이 들어있고, 옛 inline-style fallback 은 textContent */
        const medName=nameSpan.getAttribute('title')||nameSpan.textContent;
        const isSel=_symSelectedMeds.indexOf(medName)!==-1;
        el.style.border='1px solid '+(isSel?'var(--cyan)':'transparent');
        el.style.background=isSel?'rgba(6,182,212,0.08)':'transparent';
        el.dataset.sel=isSel?'1':'';
        const _doseInp2=isSel?_buildMedDoseInput(medName):'';
        el.innerHTML=(isSel?'<span style="color:var(--cyan);font-size:13px">✓</span>':'')+
          '<span class="sym-med-name" title="'+escHtml(medName)+'">'+escHtml(medName)+'</span>'+
          _doseInp2+
          '<span data-action="drugInfo" data-drug="'+escHtml(medName)+'" style="cursor:pointer;font-size:12px;flex-shrink:0;color:var(--cyan);opacity:0.6;transition:opacity .12s;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--cyan);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:10px" data-tooltip="약품 정보 조회" data-tooltip-instant="1">i</span>';
      });
      _symAttachUnitHover(list);
    }
  }
  /* 약을 새로 선택하면 그 약의 투여량 입력칸에 커서 자동 포커스 — 바로 숫자 입력 (사용자 요청 2026-06-04) */
  if(idx===-1){
    setTimeout(function(){
      const _mSel=(window.CSS&&CSS.escape)?CSS.escape(item):String(item).replace(/"/g,'\\"');
      const _doseEl=document.querySelector('[data-action="medDoseInput"][data-med="'+_mSel+'"]');
      if(_doseEl){ try{ _doseEl.focus(); _doseEl.select(); }catch(_){} }
    },0);
  }
}

function _symAddMedItem(type){
  const input=document.getElementById('symMedSearch');
  if(!input||!input.value.trim())return;
  const val=input.value.trim();
  if(type==='med'){S._symMeds.pain.push(val);_symSaveMeds();}
  else if(type==='ointment'){S._symOintments.push(val);_symSaveOintments();}
  else{S._symPatches.push(val);_symSavePatches();}
  _symSelectMed(val,type);
}

/* 팝업 닫힘 시점에 그 레코드가 비어있으면(증상·처치·메모·V/S·바디맵·태그 모두 0) 일반일지에서 삭제.
   사용자 결정 2026-05-31: "신규 진입 즉시 닫기" 와 "기존 행에서 증상 전부 해제 후 닫기" 가
   동일한 결과(빈 행 사라짐)로 일관되어야 한다. 이전엔 _autoCreated 플래그 가드로 신규 진입 케이스에만
   적용됐으나, 그 가드는 풀고 _symRecordIsEmpty 만으로 판정 — 기존 행도 정말 비었으면 삭제. */
function _symRecordIsEmpty(rec){
  if(!rec)return false;
  const _arrEmpty=function(a){return !a || (Array.isArray(a) && a.filter(function(x){return x&&String(x).trim();}).length===0);};
  if(!_arrEmpty(rec.symptoms))return false;
  if(!_arrEmpty(rec.treatment))return false;
  if(rec.medication && String(rec.medication).trim())return false;
  if(rec.memo && String(rec.memo).trim())return false;
  if(rec.dept && String(rec.dept).trim())return false;
  if(rec.bodymapData && Array.isArray(rec.bodymapData) && rec.bodymapData.length>0)return false;
  if(rec.temp || rec.bp || rec.pulse || rec.respiration || rec.resp || rec.spo2 || rec.bst)return false;
  if(rec.vipTags && Array.isArray(rec.vipTags) && rec.vipTags.length>0)return false;
  return true;
}

function _symComplete(){
  /* 입력은 모두 실시간으로 _symAutoSave() 가 처리되므로, 팝업 닫힘 시 호출되는 마지막 저장은 토스트 없이 조용히.
   * 이렇게 해야 사용자 관점에서 "닫기 = 저장" 이 아니라 "입력 중 자동 저장 + 닫기는 그냥 닫는 동작" 으로 자연스러움. */
  _symAutoSave(true);
  /* 빈 레코드 정리 — 신규/기존 무관, 닫는 시점에 _symRecordIsEmpty 면 삭제 (위 함수 주석 참고). */
  const _emptyRecId=_symPopupRecId;
  const _emptyRec=_emptyRecId ? S.records.find(function(r){return r.id===_emptyRecId;}) : null;
  if(_emptyRec && _symRecordIsEmpty(_emptyRec)){
    const _delId=_emptyRec._dbId || _emptyRec.id;
    S.records=S.records.filter(function(r){return r.id!==_emptyRec.id;});
    if(window.electronAPI && window.electronAPI.recordsDailyDelete && _delId){
      window.electronAPI.recordsDailyDelete(_delId).catch(function(e){console.warn('[sym] 빈 레코드 삭제 실패:',e);});
    }
  }
  const medPop=document.getElementById('symMedPopup');if(medPop)medPop.remove();
  /* 사이드바 방문이력 정책 (사용자 요청 2026-05-19):
   *  - 팝업이 닫혀도 그 학생의 최근 보건실 방문이력 카드는 사이드바에 그대로 유지 (hide 안 함).
   *  - 잠금은 해제하여 사용자가 일반 일지의 다른 사람 이름에 호버 시 그 학생의 이력으로 즉시 교체되게.
   *  - 따라서 팝업 진입 직전의 잠금 학생으로 되돌리지 않음 (이전 정책 폐기). */
  try {
    S._symPrevLockedStuId = null;
    S._symPrevVisitHistoryLocked = null;
    S.dailyLockedStudentId = null;
    S._visitHistoryLocked = false;
  } catch(_e){ /* 상태 정리 실패해도 팝업 닫힘은 정상 진행 */ }
  const ov=document.getElementById('symCatOverlay');
  if(ov){
    const box=document.getElementById('symCatBox');
    if(box){box.style.transition='opacity 0.2s ease, transform 0.2s ease';box.style.opacity='0';box.style.transform='scale(0.96)';}
    ov.style.transition='opacity 0.2s ease';ov.style.opacity='0';
    setTimeout(function(){ov.remove();bus.emit('render:daily');},200);
  } else {bus.emit('render:daily');}
}

/* ═══ 애니메이션 미니 팝업 tooltip 시스템 ═══ */
let _symTipEl=null, _symTipTimer=null;
export function _symShowTip(anchor,text,delay){
  _symHideTip();
  _symTipTimer=setTimeout(function(){
    const tip=document.createElement('div');
    tip.className='sym-anim-tip';
    tip.style.cssText='position:fixed;z-index:15000;background:var(--card);border:1px solid var(--cyan);border-radius:10px;padding:7px 11px;font-size:10px;font-weight:600;color:var(--t1);white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,0.22);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s ease, transform .15s ease';
    tip.textContent=text;
    document.body.appendChild(tip);
    const rect=anchor.getBoundingClientRect();
    const tw=tip.offsetWidth, th=tip.offsetHeight;
    let left=rect.left+rect.width/2-tw/2;
    if(left<4)left=4;if(left+tw>window.innerWidth-4)left=window.innerWidth-tw-4;
    let top=rect.bottom+6;
    if(top+th>window.innerHeight-4)top=rect.top-th-6;
    tip.style.left=left+'px';tip.style.top=top+'px';
    _symTipEl=tip;
    requestAnimationFrame(function(){tip.style.opacity='1';tip.style.transform='translateY(0)';});
  },delay||0);
}
export function _symHideTip(){
  if(_symTipTimer){clearTimeout(_symTipTimer);_symTipTimer=null;}
  if(_symTipEl){
    const el=_symTipEl;_symTipEl=null;
    el.style.opacity='0';el.style.transform='translateY(4px)';
    setTimeout(function(){if(el.parentNode)el.remove();},150);
  }
}
function _symBindChipTooltips(container){
  container.querySelectorAll('.sym-hdr-chip[data-tip]').forEach(function(chip){
    chip.addEventListener('mouseenter',function(){_symShowTip(chip,chip.getAttribute('data-tip'));});
    chip.addEventListener('mouseleave',function(){_symHideTip();});
  });
}

/* 전역 노출 — 외부 모듈에서 사용하는 것만 유지 */

/* cross-module export — settings-tab-diary.js에서 import */
export function getSymData(){ return { medDb:_medDb, symCategories:_symCategories, medFrequent:_medFrequent, medSymMap:_medSymMap }; }

/* ═══ 유효 상분류(카테고리) 시스템 (2026-06-12) ═══
 * 기본(medical-data.json) + 사용자 편집 4종을 합성한 "유효 상분류" 목록.
 *  · ec_renamed_sym_cats : {catId: 새이름}        — 기본 분류 이름 변경 (id 불변 → 통계·증상 매핑 유지)
 *  · ec_user_sym_cats    : [{id,name,icon}]       — 사용자 추가 분류 (id 'ucat_*', 증상은 ec_user_symptoms[id])
 *  · ec_hidden_sym_cats  : [catId]                — 가린 분류 (선택 화면에서만 숨김 — 통계 집계에는 계속 포함)
 *  · ec_sym_cat_order    : [catId]                — 분류 순서
 * 설정 GUI·증상 선택 팝업·키오스크·백엔드 통계가 모두 이 규칙을 따른다. */
function _symCatUserData(){
  function _ls(k,d){ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?d:v; }catch(_){ return d; } }
  return {
    renamed:_ls('ec_renamed_sym_cats',{}),
    userCats:_ls('ec_user_sym_cats',[]),
    hidden:_ls('ec_hidden_sym_cats',[]),
    order:_ls('ec_sym_cat_order',[]),
    icons:_ls('ec_sym_cat_icons',{})   /* {catId:이모티콘} — 아이콘 사용자 변경 (2026-06-12) */
  };
}
export function getEffectiveSymCats(includeHidden){
  const u=_symCatUserData();
  const list=[];
  (_symCategories||[]).forEach(function(c){
    list.push({ id:c.id, name:(u.renamed&&u.renamed[c.id])||c.name, defaultName:c.name, icon:(u.icons&&u.icons[c.id])||c.icon||'', defaultIcon:c.icon||'', symptoms:c.symptoms||[], isUser:false, isHidden:(u.hidden||[]).indexOf(c.id)!==-1 });
  });
  (u.userCats||[]).forEach(function(c){
    if(!c||!c.id)return;
    list.push({ id:c.id, name:c.name||'(이름 없음)', defaultName:c.name||'', icon:(u.icons&&u.icons[c.id])||c.icon||'🗂️', defaultIcon:c.icon||'🗂️', symptoms:[], isUser:true, isHidden:(u.hidden||[]).indexOf(c.id)!==-1 });
  });
  /* 순서 적용 — 저장된 id 순서 우선, 누락분은 기본 순서로 뒤에 */
  let out=[];
  (u.order||[]).forEach(function(id){ const f=list.find(function(c){return c.id===id;}); if(f&&out.indexOf(f)===-1)out.push(f); });
  list.forEach(function(c){ if(out.indexOf(c)===-1)out.push(c); });
  if(!includeHidden)out=out.filter(function(c){return !c.isHidden;});
  return out;
}
/* 유효 분류 단건 조회 — 가린 분류 포함 (선택 상태 유지·옛 기록 호환) */
export function getEffectiveSymCatById(catId){
  return getEffectiveSymCats(true).find(function(c){return c.id===catId;})||null;
}
/* 유효 분류 + 완전 병합 증상 목록 (사용자 추가 + 숨김 제외 + 저장 순서) — 키오스크 임베드 등 자급자족 소비처용 */
export function getEffectiveSymCatsWithSyms(){
  function _ls(k){ try{ const v=JSON.parse(localStorage.getItem(k)); return (v&&typeof v==='object')?v:{}; }catch(_){ return {}; } }
  const userSyms=_ls('ec_user_symptoms'), hiddenSyms=_ls('ec_hidden_symptoms'), orderMap=_ls('ec_sym_order');
  return getEffectiveSymCats(false).map(function(c){
    const ch=hiddenSyms[c.id]||[], cu=userSyms[c.id]||[];
    const raw=(c.symptoms||[]).filter(function(s){return ch.indexOf(s)===-1;}).concat(cu.filter(function(s){return (c.symptoms||[]).indexOf(s)===-1;}));
    const so=orderMap[c.id];
    let all;
    if(so&&Array.isArray(so)){ all=[]; so.forEach(function(s){if(raw.indexOf(s)!==-1)all.push(s);}); raw.forEach(function(s){if(all.indexOf(s)===-1)all.push(s);}); }
    else all=raw;
    return { id:c.id, name:c.name, icon:c.icon, symptoms:all };
  }).filter(function(c){return c.symptoms.length||c.id!=='__none__';});
}

/* 약품 → 시스템 매핑 증상 역인덱스 (사용자 요청 2026-05-27).
 *  · _medFrequent (sym → [meds]) 직접 매핑
 *  · _medSymMap (sym → [cats]) + _medDb (cat → [meds]) 간접 매핑
 *  두 경로 합집합 반환. ✏️ 미니 팝업의 슬롯 prefill 에 사용. */
export function getMedSystemSyms(medName){
  if(!medName) return [];
  const syms=[];
  Object.keys(_medFrequent||{}).forEach(function(sym){
    if((_medFrequent[sym]||[]).indexOf(medName)!==-1 && syms.indexOf(sym)===-1) syms.push(sym);
  });
  Object.keys(_medSymMap||{}).forEach(function(sym){
    const cats=_medSymMap[sym]||[];
    for(let i=0;i<cats.length;i++){
      if((_medDb[cats[i]]||[]).indexOf(medName)!==-1){
        if(syms.indexOf(sym)===-1) syms.push(sym);
        break;
      }
    }
  });
  return syms;
}

/* _medHidden 동기화 (사용자 요청 2026-05-27).
 *  설정 패널에서 _setMedToggle 이 ec_med_hidden 을 갱신할 때 module-level _medHidden 객체도
 *  mutate 해야 _medIsHidden() 이 다음 검색 필터에서 즉시 반영됨. */
export function refreshMedHidden(){
  try{
    const h=JSON.parse(localStorage.getItem('ec_med_hidden')||'{}');
    Object.keys(_medHidden).forEach(function(k){ delete _medHidden[k]; });
    Object.assign(_medHidden, h);
  }catch(_){ /* parse 실패해도 기존 _medHidden 유지 */ }
}

/* ── 물품 대여 chip 클릭 — 대장 팝업 위에 띄움 (대여자 자동 입력) (사용자 요청 2026-05-27) ──
 *  · prefilledVisitor: 현재 증상 모달의 방문자 (rec.studentId → getStu)
 *  · onClose 콜백: 닫힌 후 chip 카운트만 직접 DOM 갱신 → 증상 팝업 전체 재렌더 X → 깜빡임 0
 *  · 부모 모달(증상) DOM 은 절대 안 건드림 */
function _symGetRentalCount(stuId){
  try {
    const recs = JSON.parse(localStorage.getItem('ec_rental_records') || '[]');
    if(!Array.isArray(recs)) return 0;
    return recs.filter(function(r){ return r && r.personId == stuId && !r.returned; }).length;
  } catch(_) { return 0; }
}
function _symOpenRentalFromChip(chipBtn){
  if(!chipBtn) return;
  /* 학생 ID 는 UID string ("s000179") — parseInt 하면 NaN. string 그대로 사용 (사용자 보고 2026-05-27) */
  const stuId = chipBtn.dataset.stuId;
  if(!stuId) return;
  const stu = (typeof getStu==='function') ? getStu(stuId) : null;
  if(!stu) return;
  /* dynamic import — circular dependency 회피 (rental-ledger-view → symptom-view import 가 존재) */
  import('../daily/rental-ledger-view.js').then(function(m){
    if(!m || typeof m.openRentalLedger !== 'function') {
      console.warn('[symptom] openRentalLedger import 실패', m);
      return;
    }
    m.openRentalLedger({
      prefilledVisitor: stu,
      onClose: function(){
        /* chip 단독 갱신 — 전체 재렌더 절대 X */
        if(!chipBtn || !chipBtn.parentElement) return;
        const cnt = _symGetRentalCount(stuId);
        chipBtn.innerHTML = '📦 물품 대여' + (cnt>0 ? ' (' + cnt + ')' : '');
        chipBtn.style.borderColor = cnt > 0 ? 'rgba(6,182,212,0.3)' : 'rgba(148,163,184,0.2)';
        chipBtn.style.background = cnt > 0 ? 'rgba(6,182,212,0.08)' : 'rgba(148,163,184,0.06)';
        chipBtn.style.color = cnt > 0 ? 'var(--cyan)' : '#94a3b8';
        chipBtn.setAttribute('data-tooltip', cnt>0 ? (cnt+'건의 미반납 대여 물품이 있습니다.') : '클릭하면 보건실 물품을 대여 등록할 수 있습니다.');
      }
    });
  }).catch(function(err){
    console.error('[symptom] rental-ledger 모듈 로드 실패', err);
  });
}

/* ── 주의사항(메모) — 일반 일지와 동일한 openMemoPanel 호출 ── */
function _symOpenMemoPopup(stuId){
  if(typeof openMemoPanel==='function') openMemoPanel(stuId);
}

/* V/S 입력 팝업 — 일반 일지의 openVitalsEdit 재사용 (rec.temp/bp/pulse/resp 공유) */
function _symOpenVsPopup(recId,anchorBtn,symKey){
  if(typeof openVitalsEdit!=='function'){bus.emit('toast:show', {text: 'V/S 입력 기능을 사용할 수 없습니다.'});return;}
  /* 증상 팝업이 열려있는 상태에서도 V/S 팝업이 위에 올라오도록 처리 */
  openVitalsEdit(recId,anchorBtn);
  const symOv=document.getElementById('symOverlay')||document.querySelector('[id^="symOverlay"]');
  setTimeout(function(){
    const popup=document.querySelector('.cell-ac-popup');
    if(!popup)return;
    /* V/S 팝업이 증상 팝업(z-index 10100)보다 위에 뜨도록 */
    popup.style.zIndex='10200';
    /* 증상 오버레이 내부에서 V/S 팝업 밖 클릭 시 부드럽게 닫기
       (기존: 증상 오버레이 mousedown 이 stopPropagation() 하여 document-level 외부클릭 핸들러 무력화됨) */
    const _closeOnOutside=function(ev){
      if(!popup.isConnected){document.removeEventListener('mousedown',_closeOnOutside,true);return;}
      if(popup.contains(ev.target))return;
      if(anchorBtn&&anchorBtn.contains&&anchorBtn.contains(ev.target))return;
      /* 부드럽게 닫기 — opacity + scale 전환 후 제거 */
      popup.style.transition='opacity .15s ease, transform .15s ease';
      popup.style.opacity='0';
      popup.style.transform='scale(0.95)';
      setTimeout(function(){if(popup.parentElement)popup.remove();},160);
      document.removeEventListener('mousedown',_closeOnOutside,true);
    };
    /* capture phase 사용 — 증상 오버레이의 stopPropagation 전에 먼저 실행 */
    document.addEventListener('mousedown',_closeOnOutside,true);
  },20);
  /* 팝업 닫힐 때 V/S 값 저장 + "V/S 측정" 칩 자동 추가 */
  const _obsTimer=setInterval(function(){
    const popup=document.querySelector('.cell-ac-popup');
    if(!popup){
      clearInterval(_obsTimer);
      const rec=S.records.find(function(r){return r.id===recId;});
      if(!rec)return;
      const _has=!!(rec.temp||rec.bp||rec.pulse||rec.resp||rec.spo2||rec.bst||(rec.vsHistory&&rec.vsHistory.length));
      if(_has){
        /* per-symptom (선택 증상 map) 으로 'V/S 측정' 귀속 — 사용자 결정 2026-05-28 (record-level 폐지).
         *  · 복합칩 안에 이미 'V/S 측정' 이 들어있으면(indexOf) 중복 추가 안 함. */
        if(symKey && symKey!=='__legacy__'){
          if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
          if(_symTreatmentsBySym[symKey].every(function(x){return String(x).indexOf('V/S 측정')===-1;}))
            _symTreatmentsBySym[symKey].push('V/S 측정');
          _symRecomputeFlatTreatments();
          rec.treatment=_symSelectedTreatments.slice();
          rec.treatmentBySym=JSON.parse(JSON.stringify(_symTreatmentsBySym));
        } else {
          /* legacy / sym-key 누락 — 옛 동작 (flat 에 직접) */
          if(!Array.isArray(rec.treatment))rec.treatment=[];
          if(rec.treatment.indexOf('V/S 측정')===-1)rec.treatment.push('V/S 측정');
          if(_symSelectedTreatments.indexOf('V/S 측정')===-1)_symSelectedTreatments.push('V/S 측정');
        }
        rec._dirty=true;
        if(typeof saveRecordNow==='function')saveRecordNow(rec);
        /* 처치 패널 재렌더 — 선택된 처치 섹션에 V/S 측정 (값들) 칩 표시 */
        _symRenderTreatPanel(recId);
      } else {
        /* V/S 값을 모두 비웠으면 — 남아있는 'V/S 측정' 칩도 함께 제거 (신체사정과 동일 동작).
         *  칩만 남으면 일반일지 표에 값 없는 V/S 가 계속 떠 있음. 2026-07-20 */
        var _removedVsChip=false;
        if(symKey && symKey!=='__legacy__'){
          if(_symTreatmentsBySym[symKey]){
            var _b4=_symTreatmentsBySym[symKey].length;
            _symTreatmentsBySym[symKey]=_symTreatmentsBySym[symKey].filter(function(x){return String(x).indexOf('V/S 측정')===-1;});
            if(_symTreatmentsBySym[symKey].length!==_b4)_removedVsChip=true;
            if(!_symTreatmentsBySym[symKey].length)delete _symTreatmentsBySym[symKey];
          }
          if(_removedVsChip){
            _symRecomputeFlatTreatments();
            rec.treatment=_symSelectedTreatments.slice();
            rec.treatmentBySym=JSON.parse(JSON.stringify(_symTreatmentsBySym));
          }
        } else {
          if(Array.isArray(rec.treatment)){ var _ci=rec.treatment.indexOf('V/S 측정'); if(_ci>=0){rec.treatment.splice(_ci,1);_removedVsChip=true;} }
          var _fi=_symSelectedTreatments.indexOf('V/S 측정'); if(_fi>=0)_symSelectedTreatments.splice(_fi,1);
        }
        if(_removedVsChip){
          /* 다른 증상에도 V/S 칩이 없으면 record-level V/S 데이터도 정리 */
          _symClearOrphanVsPa(recId, true, false);
          rec._dirty=true;
          if(typeof saveRecordNow==='function')saveRecordNow(rec);
          _symRenderTreatPanel(recId);
        }
      }
    }
  },300);
}

/* ══════════════════════════════════════════
   신체사정 — 시진·촉진·타진·청진 체크(복수) + 연필로 항목별 자유 소견.
   V/S(_symOpenVsPopup) 와 동일 패턴: 증상 팝업 위 표시, 외부클릭 부드럽게 닫기,
   내용 있으면 per-sym '신체사정' 칩 자동 추가. 데이터 rec.physicalAssessment={items,details},
   DB physical_assessment 컬럼(v5) 에 JSON 저장. (2026-07-15) */
const PHYS_ASSESS_ITEMS=['시진','촉진','타진','청진'];
function _symPhysAssessData(rec){
  if(!rec.physicalAssessment||typeof rec.physicalAssessment!=='object'||Array.isArray(rec.physicalAssessment))rec.physicalAssessment={items:[],details:{}};
  if(!Array.isArray(rec.physicalAssessment.items))rec.physicalAssessment.items=[];
  if(!rec.physicalAssessment.details||typeof rec.physicalAssessment.details!=='object'||Array.isArray(rec.physicalAssessment.details))rec.physicalAssessment.details={};
  return rec.physicalAssessment;
}
function _symPhysAssessHasContent(pa){
  return !!((pa.items&&pa.items.length)||(pa.details&&Object.keys(pa.details).some(function(k){return pa.details[k]&&String(pa.details[k]).trim();})));
}
/* 처치 칩 표시 문자열 — 선택만 "(시진, 청진)", 소견 있으면 "(청진-둔탁음이 들림, 촉진-딱딱한 느낌)". 고정 순서(시진→촉진→타진→청진). */
function _physAssessDisplayStr(pa){
  if(!pa||typeof pa!=='object'||Array.isArray(pa))return '';
  const order=['시진','촉진','타진','청진'];
  const items=Array.isArray(pa.items)?pa.items:[];
  const details=(pa.details&&typeof pa.details==='object'&&!Array.isArray(pa.details))?pa.details:{};
  const parts=order.filter(function(it){return items.indexOf(it)!==-1||(details[it]&&String(details[it]).trim());})
    .map(function(it){const d=details[it]?String(details[it]).trim():'';return d?(it+'-'+d):it;});
  return parts.length?'('+parts.join(', ')+')':'';
}
/* 저장 + per-sym '신체사정' 칩 추가/제거. saveRecordNow 가 우하단 "저장 중→저장되었습니다" 토스트 자동 발생. */
function _symPhysAssessSave(recId,symKey){
  const rec=S.records.find(function(r){return r.id===recId;});if(!rec)return;
  const pa=_symPhysAssessData(rec);
  const _has=_symPhysAssessHasContent(pa);
  if(symKey&&symKey!=='__legacy__'){
    if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
    const _hasChip=_symTreatmentsBySym[symKey].some(function(x){return String(x).indexOf('신체사정')!==-1;});
    if(_has&&!_hasChip)_symTreatmentsBySym[symKey].push('신체사정');
    else if(!_has&&_hasChip)_symTreatmentsBySym[symKey]=_symTreatmentsBySym[symKey].filter(function(x){return String(x).indexOf('신체사정')===-1;});
    _symRecomputeFlatTreatments();
    rec.treatment=_symSelectedTreatments.slice();
    rec.treatmentBySym=JSON.parse(JSON.stringify(_symTreatmentsBySym));
  } else {
    if(!Array.isArray(rec.treatment))rec.treatment=[];
    const _idx=rec.treatment.indexOf('신체사정');
    if(_has&&_idx===-1)rec.treatment.push('신체사정');
    else if(!_has&&_idx>=0)rec.treatment.splice(_idx,1);
  }
  rec._dirty=true;
  if(typeof saveRecordNow==='function')saveRecordNow(rec);
  if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
  /* 일반일지 표 즉시 재렌더 — 체크 해제·소견 삭제 등이 표에 바로 반영되게. (사용자 보고 2026-07-20) */
  try{ bus.emit('render:daily'); }catch(_){}
}
/* 팝업 내용 렌더(체크박스 세로 + 연필). 체크/상세 변경 시 in-place 재렌더. */
function _symRenderPhysAssessBody(popup,recId,symKey){
  const rec=S.records.find(function(r){return r.id===recId;});if(!rec)return;
  const pa=_symPhysAssessData(rec);
  let h='<div class="pa-pop-header" style="padding:8px 12px;border-bottom:1px solid var(--bdr);background:var(--popup-head);border-radius:8px 8px 0 0;cursor:grab;user-select:none"><span style="font-size:12.5px;font-weight:700;color:var(--t1)">🩺 신체사정</span></div>';
  h+='<div style="padding:8px 12px 4px;font-size:11px;color:var(--t3);line-height:1.5">해당 항목을 선택하고, 오른쪽 칸에 소견을 바로 적을 수 있습니다.</div>';
  h+='<div style="padding:4px 10px 12px;display:flex;flex-direction:column;gap:1px">';
  PHYS_ASSESS_ITEMS.forEach(function(it){
    const checked=pa.items.indexOf(it)!==-1;
    const det=pa.details[it]?String(pa.details[it]):'';
    /* 연필/dock 대신 항목 오른쪽 인라인 입력란 — 바로 소견 기입 (사용자 요청 2026-08-06) */
    h+='<div style="display:flex;align-items:center;gap:8px;padding:3px 2px">'
      +'<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--t1);white-space:nowrap">'
      +'<input type="checkbox" data-pa-item="'+escHtml(it)+'" '+(checked?'checked':'')+' style="width:15px;height:15px;cursor:pointer;accent-color:#06b6d4">'
      +'<span style="font-weight:600;min-width:28px">'+it+'</span></label>'
      +'<input type="text" data-pa-detail="'+escHtml(it)+'" value="'+escHtml(det)+'" placeholder="소견 입력" style="flex:1;min-width:0;background:var(--bg2);border:1px solid var(--bdr);border-radius:6px;padding:5px 8px;color:var(--t1);font-size:12.5px;outline:none;font-family:var(--f)">'
      +'</div>';
  });
  h+='</div>';
  popup.innerHTML=h;
  if(typeof _symBindTipDelegation==='function')try{_symBindTipDelegation(popup);}catch(_){}
  popup.querySelectorAll('[data-pa-item]').forEach(function(cb){
    cb.addEventListener('change',function(){
      const it=cb.getAttribute('data-pa-item');
      const _pa=_symPhysAssessData(rec);
      const idx=_pa.items.indexOf(it);
      if(cb.checked){if(idx<0)_pa.items.push(it);}
      else{
        if(idx>=0)_pa.items.splice(idx,1);
        delete _pa.details[it];  /* 체크 해제 시 그 항목의 소견도 삭제 — 일반일지 표 잔상 방지 (2026-07-20) */
        /* 재렌더 없이 그 항목 입력란만 비움 (포커스·깜빡임 없이) */
        const _inp=popup.querySelector('[data-pa-detail="'+String(it).replace(/"/g,'\\"')+'"]');
        if(_inp)_inp.value='';
      }
      _symPhysAssessSave(recId,symKey);
    });
  });
  /* 소견 입력란 — 연필/dock 대신 인라인 입력(사용자 요청 2026-08-06). 타이핑 즉시 저장(debounce 250),
   *  소견을 적으면 그 항목 자동 체크. 팝업 재렌더 없이 저장만 → 포커스 유지·깜빡임 없음. */
  popup.querySelectorAll('[data-pa-detail]').forEach(function(inp){
    let _t=null;
    const _flush=function(){
      if(_t){clearTimeout(_t);_t=null;}
      const it=inp.getAttribute('data-pa-detail');
      const _pa=_symPhysAssessData(rec);
      const v=inp.value.trim();
      if(v){
        _pa.details[it]=v;
        if(_pa.items.indexOf(it)===-1){
          _pa.items.push(it);
          const _cb=popup.querySelector('[data-pa-item="'+String(it).replace(/"/g,'\\"')+'"]');
          if(_cb)_cb.checked=true;
        }
      } else {
        delete _pa.details[it];
      }
      _symPhysAssessSave(recId,symKey);
    };
    inp.addEventListener('input',function(){ if(_t)clearTimeout(_t); _t=setTimeout(_flush,250); });
    inp.addEventListener('blur',_flush);   /* 포커스 이동·팝업 닫기 시 마지막 입력 즉시 저장(유실 방지) */
    /* 소견칸 간 이동 — Tab/↓ = 다음, Shift+Tab/↑ = 이전(끝에서 순환). stopPropagation 으로 전역 키핸들러 차단. (2026-08-06) */
    inp.addEventListener('keydown',function(e){
      if(e.key==='Tab' || e.key==='ArrowDown' || e.key==='ArrowUp'){
        e.preventDefault(); e.stopPropagation();
        const _inps=Array.prototype.slice.call(popup.querySelectorAll('[data-pa-detail]'));
        const _ci=_inps.indexOf(inp);
        const _dir=(e.key==='ArrowUp' || (e.key==='Tab' && e.shiftKey)) ? -1 : 1;
        let _ni=_ci+_dir;
        if(_ni<0)_ni=_inps.length-1;
        if(_ni>=_inps.length)_ni=0;
        const _nx=_inps[_ni];
        if(_nx){ _nx.focus(); try{_nx.select();}catch(_){} }
      }
    });
  });
  const _hd=popup.querySelector('.pa-pop-header');
  if(_hd){
    _hd.addEventListener('mousedown',function(ev){
      if(ev.target.closest('input,button,label'))return;
      ev.preventDefault();ev.stopPropagation();
      const rect=popup.getBoundingClientRect();
      const offX=ev.clientX-rect.left, offY=ev.clientY-rect.top;
      _hd.style.cursor='grabbing';
      function _mv(e2){popup.style.left=(e2.clientX-offX)+'px';popup.style.top=(e2.clientY-offY)+'px';}
      function _up(){document.removeEventListener('mousemove',_mv);document.removeEventListener('mouseup',_up);_hd.style.cursor='grab';}
      document.addEventListener('mousemove',_mv);document.addEventListener('mouseup',_up);
    });
  }
}
/* 신체사정 팝업 열기 — 증상 팝업 위(z 10200), 외부클릭 부드럽게 닫기. */
function _symOpenPhysAssessPopup(recId,anchorBtn,symKey){
  const rec=S.records.find(function(r){return r.id===recId;});if(!rec)return;
  _symPhysAssessData(rec);
  const _ex=document.querySelector('.cell-ac-popup');if(_ex)_ex.remove();
  const rect=(anchorBtn&&anchorBtn.getBoundingClientRect)?anchorBtn.getBoundingClientRect():{left:100,top:100,bottom:120};
  const _W=340;   /* 항목 옆 인라인 소견 입력란 공간 확보 (2026-08-06) */
  let _popLeft=rect.left-40;
  if(_popLeft+_W>window.innerWidth)_popLeft=window.innerWidth-_W-8;
  if(_popLeft<8)_popLeft=8;
  let _popTop=rect.bottom+2;
  if(_popTop+280>window.innerHeight)_popTop=Math.max(8,rect.top-280);
  const popup=document.createElement('div');
  popup.className='cell-ac-popup';
  popup.style.cssText='position:fixed;top:'+_popTop+'px;left:'+_popLeft+'px;width:'+_W+'px;max-height:none;overflow:visible;opacity:0;transform:scale(0.95);transition:opacity .15s ease,transform .15s ease;z-index:10200';
  document.body.appendChild(popup);
  _symRenderPhysAssessBody(popup,recId,symKey);
  requestAnimationFrame(function(){popup.style.opacity='1';popup.style.transform='scale(1)';});
  const _closeOnOutside=function(ev){
    if(!popup.isConnected){document.removeEventListener('mousedown',_closeOnOutside,true);return;}
    if(popup.contains(ev.target))return;
    if(anchorBtn&&anchorBtn.contains&&anchorBtn.contains(ev.target))return;
    const _dock=document.getElementById('physAssessDetailDock');
    if(_dock&&_dock.contains&&_dock.contains(ev.target))return;
    popup.style.opacity='0';popup.style.transform='scale(0.95)';
    setTimeout(function(){if(popup.parentElement)popup.remove();},160);
    document.removeEventListener('mousedown',_closeOnOutside,true);
  };
  setTimeout(function(){document.addEventListener('mousedown',_closeOnOutside,true);},20);
}
/* 연필 → 항목별 자세히 기입 dock — 증상 자유 기술 dock 과 동일 GUI. 입력 즉시 pa.details[item] 저장.
   Enter/외부클릭 저장, ESC 저장 안 함. */
function _symOpenPhysAssessDetailDock(recId,anchorChip,item,symKey,parentPopup){
  if(typeof hideHeaderTooltip==='function')try{hideHeaderTooltip();}catch(_){}
  const existing=document.getElementById('physAssessDetailDock');
  if(existing){ const _prev=existing.dataset.item||''; existing.remove(); if(_prev===item)return; }
  const rec=S.records.find(function(r){return r.id===recId;});if(!rec)return;
  const pa=_symPhysAssessData(rec);
  const _initial=pa.details[item]?String(pa.details[item]):'';
  const dock=document.createElement('div');
  dock.id='physAssessDetailDock';
  dock.dataset.item=item;
  dock.style.cssText='position:fixed;left:0;top:0;z-index:12000;background:var(--card);border:1.5px solid rgba(217,119,6,0.7);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:9px;width:480px;max-width:92vw;box-shadow:0 6px 18px rgba(0,0,0,0.45);opacity:0;visibility:hidden;transition:opacity .18s ease';
  dock.innerHTML='<span style="font-size:14px;font-weight:800;color:#d97706;white-space:nowrap;padding-top:6px">✏️ '+escHtml(item)+' :</span>'
    +'<textarea id="physAssessDetailInput" rows="1" placeholder="입력 즉시 자동 저장됩니다... (Enter·외부 클릭: 저장 / ESC: 저장 안 함)" style="flex:1;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:8px 12px;color:var(--t1);font-size:14px;outline:none;font-family:var(--f);resize:none;overflow-y:auto;line-height:1.5;min-height:36px;max-height:240px;box-sizing:border-box"></textarea>';
  document.body.appendChild(dock);
  if(typeof _symBindTipDelegation==='function')try{_symBindTipDelegation(dock);}catch(_){}
  const inp=dock.querySelector('#physAssessDetailInput');
  inp.value=_initial;
  function _autoSize(){inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,240)+'px';}
  function _pos(){
    if(!dock.isConnected)return;
    const _r=(anchorChip&&anchorChip.isConnected)?anchorChip.getBoundingClientRect():{left:120,top:140,right:160,bottom:160};
    const _dh=dock.offsetHeight||0, _dw=dock.offsetWidth||480;
    let _lf=_r.right, _tp=_r.top-_dh-6;
    if(_lf+_dw>window.innerWidth-8)_lf=Math.max(8,window.innerWidth-_dw-8);
    if(_tp<8)_tp=_r.bottom+6;
    if(_tp+_dh>window.innerHeight-8)_tp=Math.max(8,window.innerHeight-_dh-8);
    dock.style.left=_lf+'px';dock.style.top=_tp+'px';
  }
  requestAnimationFrame(function(){_autoSize();_pos();dock.style.visibility='visible';dock.style.opacity='1';setTimeout(function(){try{inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);}catch(_){}},0);});
  function _save(){
    const _pa=_symPhysAssessData(rec);
    const v=inp.value.trim();
    if(v){ _pa.details[item]=v; if(_pa.items.indexOf(item)===-1)_pa.items.push(item); }  /* 소견을 적으면 그 항목 자동 체크 */
    else delete _pa.details[item];
    _symPhysAssessSave(recId,symKey);
    if(parentPopup&&parentPopup.isConnected)_symRenderPhysAssessBody(parentPopup,recId,symKey);
  }
  let _saveT=null;
  inp.addEventListener('input',function(){_autoSize();if(_saveT)clearTimeout(_saveT);_saveT=setTimeout(_save,250);});
  function _close(saveIt){
    if(_saveT){clearTimeout(_saveT);_saveT=null;}
    if(saveIt)_save();
    dock.style.opacity='0';
    setTimeout(function(){if(dock.parentElement)dock.remove();},160);
    document.removeEventListener('mousedown',_outside,true);
  }
  function _outside(ev){
    if(dock.contains(ev.target))return;
    if(anchorChip&&anchorChip.contains&&anchorChip.contains(ev.target))return;
    _close(true);
  }
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();_close(true);}
    else if(e.key==='Escape'){e.preventDefault();_close(false);}
  });
  setTimeout(function(){document.addEventListener('mousedown',_outside,true);},20);
}

/* 증상 팝업 헤더에서 구급대 인계 메시지 작성으로 직접 이동 */
function _symOpenEmsMsg(stuId,recId){
  if(typeof openEmsMsg!=='function'){bus.emit('toast:show', {text: '구급대 메시지 기능을 사용할 수 없습니다.'});return;}
  /* 증상 팝업이 열려있어도 그대로 두고 EMS 팝업을 위에 띄움 (z-index가 더 높음) */
  openEmsMsg(stuId);
}

/* ── 약품 정보 조회 (식약처 e약은요 API + 의약품안전나라 공식 DB) ──
   조회 우선순위:
   1) 런타임 메모리 캐시 _drugInfoCache — 같은 세션에서 다시 열 때 즉시 표시
   2) 번들 templates/medications_list.json — 앱 배포판에 들어있는 564건 상세정보 (개발자 관리)
   3) userData/data/medications_list.json — 사용자가 런타임에 API로 받아 upsert 한 추가분
   4) API 호출 — 위 모두가 없을 때만
   번들(2)이 userData(3)보다 먼저 로드되므로, 앱 업데이트로 번들 내용이 바뀌면 자동 반영됨.
   사용자 추가분은 번들에 없는 약품만 채움 (덮어쓰지 않음). */
const _drugInfoCache={};
(function _hydrateDrugCache(){
  if(!window.electronAPI)return;
  const loadBundle = (window.electronAPI.readFile)
    ? window.electronAPI.readFile('__app__/templates/medications_list.json').then(function(res){
        if(!res||!res.success||!res.data)return;
        try{
          const bundle=JSON.parse(res.data);
          const items=(bundle&&bundle.items)||{};
          Object.keys(items).forEach(function(name){ _drugInfoCache[name]=items[name]; });
        }catch(e){}
      }).catch(function(){})
    : Promise.resolve();
  const loadUser = (window.electronAPI.jsonLoadCommon)
    ? window.electronAPI.jsonLoadCommon({key:'medications_list'}).then(function(r){
        if(!r||!r.success||!r.data||!r.data.items)return;
        const items=r.data.items;
        Object.keys(items).forEach(function(name){
          /* 번들에 없는 약만 사용자 캐시에서 가져옴 — 번들이 최신 */
          if(items[name]&&!_drugInfoCache[name]) _drugInfoCache[name]=items[name];
        });
      }).catch(function(){})
    : Promise.resolve();
  loadBundle.then(loadUser);
})();

function _showDrugInfo(drugName){
  if(!drugName)return;
  /* 기존 팝업 제거 */
  const old=document.getElementById('drugInfoPopup');if(old)old.remove();
  const apiKey=localStorage.getItem('ec_drug_api_key')||'';
  const pop=document.createElement('div');pop.id='drugInfoPopup';
  pop.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.92);opacity:0;background:var(--card);border:1px solid var(--cyan);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.35);width:420px;max-height:520px;z-index:9700;display:flex;flex-direction:column;overflow:hidden;transition:opacity .18s ease,transform .18s ease';
  const hdr='<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px">'
    +'<span style="font-size:13px;font-weight:700;color:var(--t1);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">💊 '+escHtml(drugName)+'</span>'
    +'<button data-action="drugInfoBack" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--bdr);background:var(--card);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;transition:background .15s" data-tooltip="돌아가기" data-tooltip-instant="1">✕</button>'
    +'</div>';
  let body='<div id="drugInfoBody" style="flex:1;overflow-y:auto;padding:14px 16px;scrollbar-width:thin;font-size:11px;color:var(--t1);line-height:1.8">';
  if(_drugInfoCache[drugName]){
    body+=_buildDrugInfoHtml(_drugInfoCache[drugName]);
  } else if(apiKey){
    body+='<div style="text-align:center;padding:20px;color:var(--t3)">⏳ 약품 정보를 불러오는 중...</div>';
  } else if(!apiKey){
    /* API 키 없으면 팝업 없이 식약처 의약품안전나라로 바로 이동 */
    if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal('https://nedrug.mfds.go.kr/searchDrug?searchYn=true&itemName='+encodeURIComponent(drugName));
    return;
  }
  body+='</div>';
  const footer='<div style="padding:8px 16px;border-top:1px solid var(--bdr);text-align:center">'
    +'<div style="font-size:9px;color:var(--t3);line-height:1.5">출처: 식품의약품안전처 의약품개요정보(e약은요) · 공공데이터포털(data.go.kr)</div>'
    +'</div>';
  pop.innerHTML=hdr+body+footer;
  document.body.appendChild(pop);
  requestAnimationFrame(function(){pop.style.opacity='1';pop.style.transform='translate(-50%,-50%) scale(1)';});
  /* 헤더 드래그 이동 */
  _makeDraggable(pop);
  function _diClosePop(){
    const p=document.getElementById('drugInfoPopup');
    if(!p)return;
    /* 드래그 후(left/top 픽셀로 고정됨) 에는 translate 없이 scale만, 아니면 중앙정렬 유지 */
    const dragged=p.style.left&&p.style.left.indexOf('px')!==-1;
    p.style.opacity='0';
    p.style.transform=dragged?'scale(0.92)':'translate(-50%,-50%) scale(0.92)';
    setTimeout(function(){if(p.parentNode)p.remove();},180);
  }
  /* 약품 정보 팝업 이벤트 위임 */
  pop.addEventListener('click',function(e){
    const back=e.target.closest('[data-action="drugInfoBack"]');
    if(back){_diClosePop();return;}
    const ext=e.target.closest('[data-action="openDrugExternal"]');
    if(ext){
      e.preventDefault();
      /* 우선순위: data-src-url (엔트리별 실제 원본) → 기본 식약처 의약품안전나라 검색 */
      const url=ext.dataset.srcUrl||('https://nedrug.mfds.go.kr/searchDrug?searchYn=true&itemName='+encodeURIComponent(ext.dataset.drug||''));
      if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(url);
      return;
    }
  });
  /* 바깥 클릭 닫기 */
  setTimeout(function(){
    function _diClose(e){const p=document.getElementById('drugInfoPopup');if(!p){document.removeEventListener('mousedown',_diClose,true);return;}if(!p.contains(e.target)){_diClosePop();document.removeEventListener('mousedown',_diClose,true);}}
    document.addEventListener('mousedown',_diClose,true);
  },10);
  /* API 호출 — 메모리 캐시 미히트 시만 */
  if(apiKey&&!_drugInfoCache[drugName]){
    if(window.electronAPI&&window.electronAPI.externalFetchDrugInfo){
      window.electronAPI.externalFetchDrugInfo(apiKey,drugName).then(function(res){
        const bd=document.getElementById('drugInfoBody');if(!bd)return;
        if(res&&res.success){
          _drugInfoCache[drugName]=res.data;
          bd.innerHTML=_buildDrugInfoHtml(res.data);
          /* 영구 JSON 캐시에도 저장 — 다음 실행 시 API 호출 없이 즉시 반환 */
          _persistDrugToUserJson(drugName, res.data);
        }
        else {
          const errMsg=(res&&res.error)||'정보를 검색할 수 없습니다';
          bd.innerHTML='<div style="color:var(--t3);padding:12px;text-align:center;line-height:1.7">'+escHtml(errMsg)+'<br><br><span style="font-size:10px">API 키 설정 상태를 확인하거나, 식약처 의약품안전나라에서 검색하실 수 있습니다.</span></div>';
        }
      }).catch(function(e){
        const bd=document.getElementById('drugInfoBody');if(bd)bd.innerHTML='<div style="color:var(--t3);padding:12px;text-align:center">오류: '+escHtml(e&&e.message||'알 수 없음')+'</div>';
      });
    }
  }
}

/* API fetch 결과를 medications_list.json 에 upsert — debounced 로 연속 조회 시 단일 write */
let _persistDrugTimer=null;
const _pendingDrugUpsert={};
function _persistDrugToUserJson(drugName, info){
  if(!drugName||!info)return;
  _pendingDrugUpsert[drugName]={
    itemSeq: info.itemSeq || '',
    itemName: info.itemName || drugName,
    entpName: info.entpName || '',
    efcyQesitm: info.efcyQesitm || '',
    useMethodQesitm: info.useMethodQesitm || '',
    atpnWarnQesitm: info.atpnWarnQesitm || '',
    atpnQesitm: info.atpnQesitm || '',
    intrcQesitm: info.intrcQesitm || '',
    seQesitm: info.seQesitm || '',
    depositMethodQesitm: info.depositMethodQesitm || '',
    itemImage: info.itemImage || '',
    source: 'auto_fetch',
    cachedAt: new Date().toISOString()
  };
  clearTimeout(_persistDrugTimer);
  _persistDrugTimer=setTimeout(function(){
    if(!window.electronAPI||!window.electronAPI.jsonLoadCommon||!window.electronAPI.jsonSaveCommon)return;
    window.electronAPI.jsonLoadCommon({key:'medications_list'}).then(function(r){
      const cache=(r&&r.success&&r.data&&typeof r.data==='object')?r.data:{items:{},order:[]};
      cache.items=cache.items||{};
      cache.order=Array.isArray(cache.order)?cache.order:[];
      Object.keys(_pendingDrugUpsert).forEach(function(nm){
        cache.items[nm]=_pendingDrugUpsert[nm];
        if(cache.order.indexOf(nm)===-1) cache.order.push(nm);
      });
      /* 큐 비우기 */
      Object.keys(_pendingDrugUpsert).forEach(function(nm){ delete _pendingDrugUpsert[nm]; });
      return window.electronAPI.jsonSaveCommon({key:'medications_list', data:cache});
    }).catch(function(err){ console.warn('[drugCache] persist failed', err); });
  }, 600);
}
/* ── 약품 검색 팝업 ── */
function _drugContainsChoseong(s){
  /* 한글 자음만(ㄱ~ㅎ, U+3131~U+314E)이 포함되어 있는지 */
  return /[ㄱ-ㅎ]/.test(s);
}
function _drugChoseongMatch(name,query){
  /* matchKorean 보다 가벼운 자체 구현 — 약품명에서 초성 시퀀스가 어디든 등장하면 true */
  if(!query)return true;
  const cho=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  /* name의 각 한글 글자를 초성으로 변환 */
  let nameCho='';
  for(const ch of name){
    const code=ch.charCodeAt(0);
    if(code>=0xAC00&&code<=0xD7A3){nameCho+=cho[Math.floor((code-0xAC00)/588)];}
    else if(code>=0x3131&&code<=0x314E){nameCho+=ch;}
    else nameCho+=ch.toLowerCase();
  }
  let qCho='';
  for(const ch of query){
    const code=ch.charCodeAt(0);
    if(code>=0xAC00&&code<=0xD7A3){qCho+=cho[Math.floor((code-0xAC00)/588)];}
    else if(code>=0x3131&&code<=0x314E){qCho+=ch;}
    else qCho+=ch.toLowerCase();
  }
  return nameCho.indexOf(qCho)!==-1;
}
export function openDrugSearchPopup(){
  const oldOv=document.getElementById('drugSearchOverlay');if(oldOv){oldOv.remove();return;}
  const apiKey=localStorage.getItem('ec_drug_api_key')||'';

  /* 외곽 오버레이 + 내부 카드 구조 (다른 모달과 동일 패턴) — zoom 호환 */
  const ov=document.createElement('div');ov.id='drugSearchOverlay';
  /* 위치 계산 — 물품 대여 대장 버튼 바로 아래쪽에 띄울 padding 으로 카드 위치 지정 */
  let _padTop=120, _padLeft=200;
  const anchor=document.getElementById('dailyRentalLedgerBtn');
  if(anchor){
    const r=anchor.getBoundingClientRect();
    _padTop=r.bottom+8;
    _padLeft=r.left;
    const _maxLeft=window.innerWidth-490;
    if(_padLeft>_maxLeft)_padLeft=Math.max(10,_maxLeft);
  }
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0);z-index:9700;display:flex;align-items:flex-start;justify-content:flex-start;padding:'+_padTop+'px 0 0 '+_padLeft+'px;box-sizing:border-box;pointer-events:none';

  /* 내부 카드 (실제 약품 검색 popup) */
  const pop=document.createElement('div');pop.id='drugSearchPopup';
  pop.style.cssText='opacity:0;transform:scale(0.98);transform-origin:top left;background:var(--card);border:1px solid var(--cyan);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.35);width:480px;max-height:600px;display:flex;flex-direction:column;overflow:hidden;transition:opacity .1s ease,transform .1s ease;pointer-events:auto';
  pop.innerHTML=
    '<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:8px">'
    +'<span style="font-size:13px;font-weight:700;color:var(--t1);flex:1">💊 약품 검색 (e약은요)</span>'
    +'</div>'
    +'<div style="padding:10px 14px;border-bottom:1px solid var(--bdr)">'
    +'<input id="drugSearchInput" type="text" placeholder="약품명 입력 (예: 타이레놀)" autocomplete="off" style="width:100%;padding:8px 10px;font-size:12px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t1);box-sizing:border-box;outline:none">'
    +'<div style="font-size:9px;color:var(--t3);margin-top:4px">2글자 이상 입력하면 검색됩니다.</div>'
    +'</div>'
    +'<div id="drugSearchList" style="flex:1;overflow-y:auto;padding:6px 0;scrollbar-width:thin">'
    +(apiKey?'<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">검색어를 입력해 주세요</div>':'<div style="padding:30px;text-align:center;color:var(--rd);font-size:11px;line-height:1.7">⚠ 식약처 API 키가 설정되어 있지 않습니다.<br>설정 → 외부 API 키에서 등록해 주세요.</div>')
    +'</div>'
    +'<div style="padding:8px 14px;border-top:1px solid var(--bdr);text-align:center;font-size:9px;color:var(--t3)">출처: 식품의약품안전처 의약품개요정보(e약은요)</div>';
  ov.appendChild(pop);
  document.body.appendChild(ov);
  requestAnimationFrame(function(){pop.style.opacity='1';pop.style.transform='scale(1)';});
  function _close(){
    const p=document.getElementById('drugSearchPopup');
    const o=document.getElementById('drugSearchOverlay');
    if(p){p.style.opacity='0';p.style.transform='scale(0.95)';}
    setTimeout(function(){if(o&&o.parentNode)o.remove();},180);
  }
  pop.addEventListener('click',function(e){
    const btn=e.target.closest('[data-action="drugSearchClose"]');
    if(btn){_close();return;}
    const item=e.target.closest('[data-action="drugSearchPick"]');
    if(item){const name=item.dataset.name;if(name){_showDrugInfo(name);}return;}
  });
  /* 바깥 클릭 닫기 — 단, drugInfoPopup이 위에 떠있으면 그쪽 처리 우선 */
  setTimeout(function(){
    function _outside(e){
      const sp=document.getElementById('drugSearchPopup');if(!sp){document.removeEventListener('mousedown',_outside,true);return;}
      const ip=document.getElementById('drugInfoPopup');
      if(ip&&ip.contains(e.target))return;
      if(!sp.contains(e.target)){_close();document.removeEventListener('mousedown',_outside,true);}
    }
    document.addEventListener('mousedown',_outside,true);
  },10);
  /* 입력 디바운스 검색 */
  const input=document.getElementById('drugSearchInput');
  const list=document.getElementById('drugSearchList');
  if(input)input.focus();
  let _searchTimer=null;
  let _seq=0;
  let _lastSearched=null;   /* 직전에 실제로 검색/표시한 값 — 한글 IME 커밋(blur 시 삭제→삽입) 재발화 흡수용 */
  if(input)input.addEventListener('input',function(){
    const raw=this.value.trim();
    if(_searchTimer)clearTimeout(_searchTimer);
    /* 모든 리스트 갱신을 디바운스 안으로 옮긴다 — 결과 항목 클릭 시 입력창이 blur 되며 한글 IME 가
     *  삭제("트")→삽입("트리") 로 input 을 재발화시킨다. 예전엔 여기서 동기적으로 "검색 중..."으로
     *  리스트를 갈아엎어 클릭하려던 항목이 사라졌다(→ 클릭 무시·재검색). clearTimeout 으로 그 연쇄를
     *  합치고, 값이 실제로 바뀐 경우(_lastSearched 비교)에만 갱신하면 재발화가 흡수되어 리스트가 유지된다. */
    _searchTimer=setTimeout(function(){
      if(raw===_lastSearched)return;
      _lastSearched=raw;
      if(raw.length<2){
        list.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">2글자 이상 입력하면 검색됩니다</div>';
        return;
      }
      list.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">⏳ 검색 중...</div>';
      const mySeq=++_seq;
      /* 초성만 입력된 경우 — API에 보낼 키워드가 없으므로 안내 */
      const onlyChoseong=/^[ㄱ-ㅎ]+$/.test(raw);
      if(onlyChoseong){
        list.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px;line-height:1.7">초성만으로는 e약은요 API에서 검색할 수 없습니다.<br>한 글자 이상 완성된 한글을 포함해 주세요.<br><span style="font-size:9px">예: "타" 또는 "ㅌ이"가 아니라 "타이"</span></div>';
        return;
      }
      /* API 호출 — 입력 그대로 전달 */
      if(!window.electronAPI||!window.electronAPI.externalSearchDrugList){
        list.innerHTML='<div style="padding:30px;text-align:center;color:var(--rd);font-size:11px">검색 기능을 사용할 수 없습니다.</div>';
        return;
      }
      window.electronAPI.externalSearchDrugList(apiKey,raw).then(function(res){
        if(mySeq!==_seq)return; /* 더 새 입력이 있으면 무시 */
        if(!res||!res.success){
          list.innerHTML='<div style="padding:30px;text-align:center;color:var(--rd);font-size:11px;line-height:1.7">'+escHtml((res&&res.error)||'검색 실패')+'</div>';
          return;
        }
        let items=res.items||[];
        /* 초성이 섞여있으면 클라이언트 측 추가 필터 */
        if(_drugContainsChoseong(raw)){
          items=items.filter(function(it){return _drugChoseongMatch(it.itemName||'',raw);});
        }
        if(!items.length){
          list.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">"'+escHtml(raw)+'"에 해당하는 약품이 없습니다</div>';
          return;
        }
        let html='';
        items.slice(0,80).forEach(function(it){
          const name=it.itemName||'(이름없음)';
          const ent=it.entpName||'';
          html+='<div data-action="drugSearchPick" data-name="'+escHtml(name).replace(/"/g,'&quot;')+'" style="padding:8px 14px;cursor:pointer;border-bottom:1px solid var(--bdr);transition:background .12s" onmouseenter="this.style.background=\'var(--bg2)\'" onmouseleave="this.style.background=\'\'">'
            +'<div style="font-size:11px;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(name)+'</div>'
            +(ent?'<div style="font-size:9px;color:var(--t3);margin-top:2px">'+escHtml(ent)+'</div>':'')
            +'</div>';
        });
        if(items.length>80)html+='<div style="padding:8px;text-align:center;font-size:9px;color:var(--t3)">... 외 '+(items.length-80)+'건</div>';
        list.innerHTML=html;
      }).catch(function(e){
        if(mySeq!==_seq)return;
        list.innerHTML='<div style="padding:30px;text-align:center;color:var(--rd);font-size:11px">오류: '+escHtml(e&&e.message||'알 수 없음')+'</div>';
      });
    },350);
  });
  /* ESC 키로 닫기 */
  pop.addEventListener('keydown',function(e){if(e.key==='Escape')_close();});
}

/* 약품 캐시에 저장된 텍스트의 HTML 엔티티를 안전하게 디코딩.
   원본 식약처/제약사 첨부문서가 ▪(U+25AA), &amp; 등을 엔티티로 들고 있어 표시 시 그대로 글자가 노출되는 문제 방지.
   - 숫자 참조: &#xHEX;, &#DEC; → 해당 유니코드
   - 명명 참조: &amp; &lt; &gt; &quot; &apos; &nbsp; (가장 흔한 것만)
   순서 중요: 명명 참조 후에 &amp; 처리 (이중 디코딩 방지) */
function _decodeDrugEntities(s){
  if(s==null)return '';
  let t=String(s);
  /* 1) 숫자 참조 */
  t=t.replace(/&#x([0-9a-fA-F]+);/g,function(_m,hex){
    const cp=parseInt(hex,16);
    if(isNaN(cp)||cp<0x20||cp>0x10FFFF)return _m;
    try{return String.fromCodePoint(cp);}catch(e){return _m;}
  });
  t=t.replace(/&#(\d+);/g,function(_m,dec){
    const cp=parseInt(dec,10);
    if(isNaN(cp)||cp<0x20||cp>0x10FFFF)return _m;
    try{return String.fromCodePoint(cp);}catch(e){return _m;}
  });
  /* 2) 명명 참조 (자주 쓰이는 것만) — &amp; 는 마지막에 */
  t=t.replace(/&nbsp;/g,' ')
     .replace(/&lt;/g,'<')
     .replace(/&gt;/g,'>')
     .replace(/&quot;/g,'"')
     .replace(/&apos;/g,"'")
     .replace(/&amp;/g,'&');
  return t;
}
function _buildDrugInfoHtml(d){
  /* 캐시 값에 박힌 HTML 엔티티 디코딩 후 escHtml 로 안전 표시 */
  const _dec=_decodeDrugEntities;
  let h='';
  if(d.itemName)h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">'+escHtml(_dec(d.itemName))+'</div>';
  if(d.entpName)h+='<div style="font-size:10px;color:var(--t3);margin-bottom:8px">'+escHtml(_dec(d.entpName))+'</div>';
  if(d.efcyQesitm)h+='<div style="margin-bottom:10px"><b style="color:var(--cyan)">효능</b><div style="margin-top:2px">'+escHtml(_dec(d.efcyQesitm))+'</div></div>';
  if(d.useMethodQesitm)h+='<div style="margin-bottom:10px"><b style="color:var(--cyan)">용법·용량</b><div style="margin-top:2px">'+escHtml(_dec(d.useMethodQesitm))+'</div></div>';
  if(d.atpnQesitm)h+='<div style="margin-bottom:10px"><b style="color:#f59e0b">주의사항</b><div style="margin-top:2px">'+escHtml(_dec(d.atpnQesitm))+'</div></div>';
  if(d.intrcQesitm)h+='<div style="margin-bottom:10px"><b style="color:#ef4444">상호작용</b><div style="margin-top:2px">'+escHtml(_dec(d.intrcQesitm))+'</div></div>';
  if(d.seQesitm)h+='<div style="margin-bottom:10px"><b style="color:#ef4444">부작용</b><div style="margin-top:2px">'+escHtml(_dec(d.seQesitm))+'</div></div>';
  if(!h)h='<div style="color:var(--t3);padding:12px">상세 정보가 없습니다.</div>';
  /* 출처 블록 — 식약처 API 외 출처일 때만 표시 (기본은 팝업 하단 고정 문구로 처리) */
  if(d.sourceNotice){
    h+='<div style="margin-top:12px;padding:10px 12px;background:rgba(234,179,8,0.08);border-left:3px solid #eab308;border-radius:0 6px 6px 0;font-size:10px;line-height:1.7">'
      +'<div style="color:#ca8a04;font-weight:700;margin-bottom:4px">⚠ '+escHtml(d.sourceNotice)+'</div>'
      +'<div style="color:var(--t2)">출처: <b>'+escHtml(d.sourceLabel||'')+'</b></div>';
    if(d.sourceUrl){
      h+='<div style="margin-top:4px"><a href="#" data-action="openDrugExternal" data-drug="'+escHtml(d.itemName||'')+'" data-src-url="'+escHtml(d.sourceUrl)+'" style="color:var(--cyan);font-size:10px;text-decoration:underline">원본 페이지 열기 ↗</a></div>';
    }
    h+='</div>';
  }
  return h;
}

/* ── 자주 쓰는 ↔ 그 외 처치 양방향 이동 ──
 * fav: 사용자 승격 목록, dem: 사용자 강등 목록 (기본 5개도 강등 가능) */
function _symPromoteTreat(t,recId){
  let fav=[];let dem=[];
  try{fav=JSON.parse(localStorage.getItem('ec_user_fav_treatments')||'[]');}catch(e){}
  try{dem=JSON.parse(localStorage.getItem('ec_user_demoted_treatments')||'[]');}catch(e){}
  /* 되돌리기용 이전 상태 저장 */
  _treatUndoStack.push({action:'promote',treat:t,recId:recId,fav:fav.slice(),dem:dem.slice()});
  /* 강등 목록에서 제거 (기본 5개를 다시 자주 쓰는 처치로 복귀시키는 경우) */
  dem=dem.filter(function(x){return x!==t;});
  /* 승격 목록에 추가 (없으면) */
  if(fav.indexOf(t)===-1)fav.push(t);
  localStorage.setItem('ec_user_fav_treatments',JSON.stringify(fav));
  localStorage.setItem('ec_user_demoted_treatments',JSON.stringify(dem));
  if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
  bus.emit('toast:show', {text: '"'+t+'" 자주 쓰는 처치 목록으로 이동 (Ctrl+Z 되돌리기)'});
}
function _symDemoteTreat(t,recId){
  let fav=[];let dem=[];
  try{fav=JSON.parse(localStorage.getItem('ec_user_fav_treatments')||'[]');}catch(e){}
  try{dem=JSON.parse(localStorage.getItem('ec_user_demoted_treatments')||'[]');}catch(e){}
  /* 되돌리기용 이전 상태 저장 */
  _treatUndoStack.push({action:'demote',treat:t,recId:recId,fav:fav.slice(),dem:dem.slice()});
  /* 승격 목록에서 제거 */
  fav=fav.filter(function(x){return x!==t;});
  /* 강등 목록에 추가 (없으면) — 기본 5개도 여기 들어가면 자주 쓰는 처치에서 사라짐 */
  if(dem.indexOf(t)===-1)dem.push(t);
  localStorage.setItem('ec_user_fav_treatments',JSON.stringify(fav));
  localStorage.setItem('ec_user_demoted_treatments',JSON.stringify(dem));
  if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
  bus.emit('toast:show', {text: '"'+t+'" 그 외 빠른 처치 목록으로 이동 (Ctrl+Z 되돌리기)'});
}

/* ── Phase 3a: 증상별 영구 삭제 (Ctrl+Z 로 복구, 팝업 닫히면 확정) ──
 *  · 현재 선택된 첫 증상에서 해당 처치 삭제 (ec_user_sym_removed)
 *  · 증상별 사용자 +추가 목록(ec_user_sym_fav)에서도 제거
 *  · 증상 미선택 상태 → 레거시 전역(ec_user_fav_treatments)에서 제거
 *  · 현재 일지의 선택 처치(rec.treatment)에서도 함께 해제 */
function _symHardRemoveTreat(t,recId,symKeyArg){
  /* symKeyArg: 칩이 속한 블록의 증상 키. render 가 _userSymFav[base]/_userSymRemoved[base] 를 base 명으로 읽으므로
   *  삭제도 그 칩 증상의 base 로 통일한다. (사용자 보고 2026-05-28: 다중 증상에서 첫 증상이 아닌 블록의 fav 칩이
   *  ✕ 로 안 지워지던 버그 — 이전엔 항상 _symSelectedSymptoms[0] 만 키로 봐서 다른 블록 칩은 매칭 실패.) */
  let firstSym=(symKeyArg && symKeyArg!=='__legacy__') ? symKeyArg : _symSelectedSymptoms[0];
  if(firstSym){
    const _sp=(typeof _symSplitSymLabel==='function')?_symSplitSymLabel(firstSym):null;
    if(_sp && _sp.base) firstSym=_sp.base;
    let userSymRemoved={};try{userSymRemoved=JSON.parse(localStorage.getItem('ec_user_sym_removed')||'{}');}catch(e){}
    let userSymFav={};try{userSymFav=JSON.parse(localStorage.getItem('ec_user_sym_fav')||'{}');}catch(e){}
    _treatUndoStack.push({
      action:'hardRemove',symptom:firstSym,treat:t,recId:recId,
      prevRemoved:JSON.parse(JSON.stringify(userSymRemoved)),
      prevFav:JSON.parse(JSON.stringify(userSymFav))
    });
    if(!userSymRemoved[firstSym])userSymRemoved[firstSym]=[];
    if(userSymRemoved[firstSym].indexOf(t)===-1)userSymRemoved[firstSym].push(t);
    if(userSymFav[firstSym]){
      userSymFav[firstSym]=userSymFav[firstSym].filter(function(x){return x!==t;});
      if(!userSymFav[firstSym].length)delete userSymFav[firstSym];
    }
    localStorage.setItem('ec_user_sym_removed',JSON.stringify(userSymRemoved));
    localStorage.setItem('ec_user_sym_fav',JSON.stringify(userSymFav));
    bus.emit('toast:show', {text: '"'+t+'" 자주 쓰는 처치 목록에서 삭제됨 ('+firstSym+') (Ctrl+Z로 복원 가능)'});
  } else {
    /* 증상 미선택 → 레거시 전역 favorites 에서만 제거 */
    let leg=[];try{leg=JSON.parse(localStorage.getItem('ec_user_fav_treatments')||'[]');}catch(e){}
    if(leg.indexOf(t)===-1){
      bus.emit('toast:show', {text: '증상을 먼저 선택해 주세요. 증상별로 관리됩니다.'});
      return;
    }
    _treatUndoStack.push({action:'hardRemoveLegacy',treat:t,recId:recId,prevFav:leg.slice()});
    leg=leg.filter(function(x){return x!==t;});
    localStorage.setItem('ec_user_fav_treatments',JSON.stringify(leg));
    bus.emit('toast:show', {text: '"'+t+'" 자주 쓰는 처치 목록에서 삭제됨 (Ctrl+Z로 복원 가능)'});
  }
  /* 현재 일지의 선택 처치에서도 해제 */
  if(_symSelectedTreatments.indexOf(t)!==-1)_symRemoveTreat(t);
  if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
}

/* ── 5종 옵션 진입 모달 (Phase 1, 2026-05-22) ──
 *  · 증상별 처치 블록의 + 추가 클릭 → 5종 옵션 모달
 *  · 옵션 1 (투약 단일) → 기존 _symOpenMedPopup('med', symKey) 직행
 *  · 옵션 2 (처치 단일) → 기존 _symPromptAddUserTreatForSym(recId, symKey) 텍스트 입력
 *  · 옵션 3·4·5 → 토스트 안내 (Phase 3·4·5 에서 구현 예정)
 *  · symKey 없으면 옛 다중 증상 선택 흐름으로 폴백 (_symPromptAddUserTreat). */
/* 미분기(__flat__) 모드에서 +추가 시 — 자주 쓰는 처치는 증상별 라이브러리에 저장되므로,
 *  여러 선택 증상 중 '어느 증상에 추가할지' 먼저 고르는 팝업. 선택하면 그 증상 symKey 로 옵션 모달 재진입. (사용자 요청 2026-07-01) */
function _symChooseSymForFav(recId, symList){
  const ov=document.createElement('div');
  ov.id='symChooseFavOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);transition:background 0.15s';
  let btns='';
  symList.forEach(function(sym){
    btns+='<button data-sym="'+escHtml(sym)+'" style="display:block;width:100%;padding:12px 16px;margin-bottom:8px;background:var(--card);border:1px solid var(--bdrl);border-left:3px solid var(--cyan);border-radius:8px;cursor:pointer;text-align:left;font-size:13px;font-weight:700;color:var(--t1);font-family:var(--f);transition:all .15s">'+escHtml(sym)+'</button>';
  });
  ov.innerHTML='<div id="symChooseFavBox" style="background:var(--card);border-radius:12px;width:420px;max-width:94vw;box-shadow:0 16px 40px rgba(0,0,0,0.18);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s,transform 0.15s">'
    +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">어느 증상에 대해 자주 쓰는 처치를 추가하시겠나요?</div>'
    +'<div style="padding:14px 16px">'
    +'<div style="font-size:11px;color:var(--t3);margin-bottom:10px">선택하신 증상별로 자주 쓰는 처치가 따로 관리됩니다.</div>'
    +btns
    +'</div></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.background='rgba(0,0,0,0.25)'; const b=document.getElementById('symChooseFavBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  function _close(cb){ const b=document.getElementById('symChooseFavBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.95)';} ov.style.background='rgba(0,0,0,0)'; document.removeEventListener('keydown',_esc,true); setTimeout(function(){ov.remove();if(cb)cb();},150); }
  const _esc=function(ev){ if(ev.key==='Escape' && document.getElementById('symChooseFavOverlay')){ ev.preventDefault(); ev.stopPropagation(); _close(); } };
  document.addEventListener('keydown',_esc,true);
  ov.addEventListener('click',function(e){
    const btn=e.target.closest('[data-sym]');
    if(btn){ const sym=btn.dataset.sym; _close(function(){ _symOpenAddOptionsModal(recId, sym); }); return; }
    if(e.target===ov){ _close(); }
  });
}
export function _symOpenAddOptionsModal(recId, symKey){ /* export — 키오스크 편집기 증상처치입력 모달이 동일 +추가(옵션1~5) 재사용 (2026-06-12) */
  if(!symKey || symKey === '__legacy__'){
    _symPromptAddUserTreat(recId);
    return;
  }
  /* 미분기(__flat__) — 어느 증상의 '자주 쓰는 처치'에 추가할지 먼저 선택.
   *  증상 1개면 바로 그 증상, 2개+면 증상 선택 팝업. (사용자 요청 2026-07-01) */
  if(symKey === SYM_FLAT_KEY){
    const _medSyms = (_symSelectedSymptoms||[]).filter(function(sx){return !_symIsCounselSym(sx);});
    if(!_medSyms.length){ _symPromptAddUserTreat(recId); return; }
    if(_medSyms.length === 1){ symKey = _medSyms[0]; }
    else { _symChooseSymForFav(recId, _medSyms); return; }
  }
  const old=document.getElementById('symAddOptOverlay');if(old)closeModalGracefully(old);
  const ov=document.createElement('div');ov.id='symAddOptOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12100;transition:background 0.15s ease';
  const optCard=function(num,color,title,examples,horizontal){
    /* 예시 칩 — 증상 블록 fav 칩 동일 스펙. examples 는 1~2개 문자열 배열.
     * horizontal=true 면 칩들 가로 한 줄(짧은 예시용), false 면 세로 누적(긴 예시용). */
    const chipStyle='display:inline-block;padding:3px 11px;border-radius:12px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:12px;font-weight:700;font-family:var(--f)';
    let chipsHtml='';
    examples.forEach(function(ex){
      chipsHtml+='<span style="'+chipStyle+'">'+escHtml(ex)+'</span>';
    });
    const chipsDir=horizontal?'row':'column';
    const chipsAlign=horizontal?'center':'flex-start';
    const labelPad=horizontal?'0':'4px';
    /* 저시력 가독성 — 왼쪽 색 세로선을 두껍게(6px, 진하게) + 칸 배경을 옅은 옵션 색으로.
     *  (사용자 요청 2026-07-09: 색 버튼형은 반려, 진한 세로선 + 옅은 칸 방식으로) */
    return '<button data-opt="'+num+'" onmouseover="this.style.background=\''+color+'22\';this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 12px '+color+'33\';this.style.borderLeftWidth=\'8px\'" onmouseout="this.style.background=\''+color+'14\';this.style.transform=\'none\';this.style.boxShadow=\'none\';this.style.borderLeftWidth=\'6px\'" style="display:flex;flex-direction:column;gap:6px;padding:11px 13px;background:'+color+'14;border:1px solid var(--bdrl);border-left:6px solid '+color+';border-radius:8px;cursor:pointer;text-align:left;font-family:var(--f);width:100%;margin-bottom:7px;transition:all .15s">'
      +'<span style="font-size:12.5px;font-weight:700;color:var(--t1);display:flex;align-items:center;gap:6px">'
      +'<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#fce7f3;color:#be185d;font-size:10px;font-weight:800">'+num+'</span>'
      +escHtml(title)+'</span>'
      +'<div style="display:flex;align-items:'+(horizontal?'center':'flex-start')+';gap:6px">'
        +'<span style="font-size:10.5px;color:var(--t3);font-weight:600;flex-shrink:0;padding-top:'+labelPad+'">예시</span>'
        +'<div style="display:flex;flex-direction:'+chipsDir+';gap:6px;align-items:'+chipsAlign+';flex-wrap:'+(horizontal?'nowrap':'wrap')+';min-width:0;overflow-x:'+(horizontal?'auto':'visible')+'">'+chipsHtml+'</div>'
      +'</div>'
      +'</button>';
  };
  let inner='<div id="symAddOptBox" style="background:var(--card);border-radius:12px;width:520px;max-width:96vw;max-height:90vh;box-shadow:0 16px 40px rgba(0,0,0,0.18);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s,transform 0.15s;display:flex;flex-direction:column">'
    +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(symKey)+'에 대한 자주 쓰는 처치 추가 방식 선택</div>'
    +'<div style="padding:14px 16px;background:var(--card);overflow-y:auto">'
    +'<div style="font-size:11.5px;color:var(--t1);font-weight:700;margin-bottom:3px">선택한 증상에 대한 나만의 처치를 커스텀한 칩을 만듭니다.</div>'
    +'<div style="font-size:13px;color:var(--t2);margin-bottom:10px">추가하고자 형태에 맞는 옵션을 <span style="color:#dc2626;font-weight:800">클릭(선택)</span>해주세요.</div>'
    +optCard(1,'#a855f7','하나의 칩에 약품(1개 이상)을 추가하는 경우',['투약[타이레놀정 (1T)]','투약[루핑점안액 (0.5ml), 지르텍 (1T)]'],true)
    +optCard(2,'#16a34a','하나의 칩에 약품 제외 처치 1개를 추가하는 경우',['아이스팩 적용','병원진료 권유'],true)
    +optCard(3,'#06b6d4','하나의 칩에 약품(1개 이상)과 다른 여러 처치들을 추가하는 경우',['투약[쌍화탕 (1포), 모드콜에스연질캡슐 (1C)], 보건교육, observation','투약[모드콜에스연질캡슐 (1C)], 보건교육, observation'])
    +optCard(4,'#94a3b8','하나의 칩에 약품 외 다른 여러 처치를 추가하는 경우',['침상 안정, 학부모 연락, 병원 진료 권유','칼토스타트 1cmX1cm, 코튼볼 1개 삽입'])
    +optCard(5,'#f59e0b','처치 한 건에 약품(1개 이상)과 다른 여러 처치를 패키지로 묶는 경우',['소독 드레싱[애니클린, 에스로반, 밴드 적용]','처치[신신파스아렉스(중형) (1개), 스포츠테이핑, 압박붕대 적용]'])
    +'<div style="margin-top:12px;padding:10px 12px;background:var(--bg3);border:1px solid var(--bdrl);border-radius:7px;font-size:10.5px;color:var(--t2);line-height:1.55">※ 약품 사용을 통계에 반영하는 관계로 약품 사용 여부에 따라 옵션을 구분하였습니다.</div>'
    +'</div>'
    +'</div>';
  ov.innerHTML=inner;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symAddOptBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  /* ESC = 이 옵션 선택 모달만 닫기 (밑의 증상 팝업까지 닫히지 않도록 capture+stopPropagation, 사용자 보고 2026-06-04) */
  const _symAddOptEsc=function(ev){ if(ev.key==='Escape' && document.getElementById('symAddOptOverlay')){ ev.preventDefault(); ev.stopPropagation(); _closeAnim(); } };
  document.addEventListener('keydown',_symAddOptEsc,true);
  function _closeAnim(cb){
    document.removeEventListener('keydown',_symAddOptEsc,true);
    const b=document.getElementById('symAddOptBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  ov.addEventListener('click',function(e){
    const btn=e.target.closest('[data-opt]');
    if(btn){
      const opt=parseInt(btn.dataset.opt,10);
      _closeAnim(function(){
        if(opt===1){
          /* 옵션 1 — 다중 약품 픽커 → "투약[약1 (용량), 약2 (용량)]" 단일 칩으로 fav 등록
           * onBack: 자동 저장 후 진입 모달 재오픈 */
          _symOpenDrugDoseMiniPicker(function(chip){
            _symRegisterFav(symKey, chip, recId);
          }, symKey, null, function(){
            _symOpenAddOptionsModal(recId, symKey);
          });
        } else if(opt===2){
          _symOpenAddTreatSingleDialog(recId,symKey);
        } else if(opt===3){
          _symOpenAddMixedDialog(recId,symKey);
        } else if(opt===4){
          _symOpenAddNoMedDialog(recId,symKey);
        } else if(opt===5){
          _symOpenAddComplexDialog(recId,symKey);
        }
      });
      return;
    }
    if(e.target===ov)_closeAnim();
  });
}

/* ── 자주 쓰는 처치 키 base 정규화 마이그레이션 (2026-06-09 버그수정·데이터 복구) ──
 *  과거 _symRegisterFav 가 풀네임("발목 염좌 (왼발)") 키로 저장해, base("발목 염좌") 로 읽는 렌더와
 *  안 맞아 다른 기록에서 안 보이던 커스텀들을 base 키로 모아 복원한다.
 *  · union 병합 → 절대 삭제 없음(기존 base 값 + 풀네임 값 합집합·중복제거)
 *  · 멱등(이미 base 면 무동작) · 어떤 오류도 데이터 무변경(try/catch)
 *  · 세션당 1회 · 변경 전 원본 1회 스냅샷 보관(안전망)
 *  · ec_user_sym_fav / ec_user_sym_removed 둘 다 정규화 (백업 등록부에 이미 포함). */
let _symFavBaseMigrated=false;
function _symMigrateFavKeysToBase(){
  if(_symFavBaseMigrated)return; _symFavBaseMigrated=true;
  try{
    ['ec_user_sym_fav','ec_user_sym_removed'].forEach(function(sk){
      let obj=null;
      try{obj=JSON.parse(localStorage.getItem(sk)||'{}');}catch(e){return;}
      if(!obj||typeof obj!=='object'||Array.isArray(obj))return;
      let changed=false; const out={};
      Object.keys(obj).forEach(function(k){
        const base=(_symSplitSymLabel(k).base||k);
        if(base!==k)changed=true;
        if(!out[base])out[base]=[];
        (Array.isArray(obj[k])?obj[k]:[]).forEach(function(t){ if(out[base].indexOf(t)===-1)out[base].push(t); });
      });
      if(changed){
        /* 안전망 — 마이그레이션 전 원본 1회 스냅샷. ec_ 접두사 아님 → 백업 스캔 경고 무관. */
        const bakKey='sym_fav_premigrate_bak__'+sk;
        if(!localStorage.getItem(bakKey)){ try{localStorage.setItem(bakKey, (localStorage.getItem(sk)||'{}'));}catch(e){} }
        localStorage.setItem(sk, JSON.stringify(out));
      }
    });
  }catch(e){ /* 어떤 오류도 사용자 데이터를 건드리지 않는다 */ }
}

/* ── 자주 쓰는 처치 목록에 단일 칩 등록 (Phase 6 공통 헬퍼, 2026-05-23) ──
 *  · 옵션 1·2·3·4·5 모두 이 함수로 ec_user_sym_fav[base] 에 단일 칩 텍스트 push
 *  · 중복 차단, removed 목록에서 복원, undo stack 등록, toast:save, _symRenderTreatPanel 호출 */
function _symRegisterFav(symKey, chipText, recId){
  if(!chipText || !String(chipText).trim()) return;
  const v=String(chipText).trim();
  /* ★ 저장 키는 반드시 base(부위/메모 괄호 제외) — 렌더(읽기) 와 제거 경로가 모두 _userSymFav[base] 로 동작하므로.
   *  과거엔 풀네임("발목 염좌 (왼발)") 으로 저장돼 base("발목 염좌") 읽기와 안 맞아 다른 기록에서 안 보였음.
   *  (2026-06-09 버그수정 — 옛 데이터는 _symMigrateFavKeysToBase 가 base 로 모아 복원) */
  const baseKey=(_symSplitSymLabel(symKey).base||symKey);
  let userSymFav={};
  try{userSymFav=JSON.parse(localStorage.getItem('ec_user_sym_fav')||'{}');}catch(e){}
  let userSymRemoved={};
  try{userSymRemoved=JSON.parse(localStorage.getItem('ec_user_sym_removed')||'{}');}catch(e){}
  _treatUndoStack.push({
    action:'addUser',symptom:baseKey,treat:v,recId:recId,
    prevFav:JSON.parse(JSON.stringify(userSymFav))
  });
  if(!userSymFav[baseKey])userSymFav[baseKey]=[];
  if(userSymFav[baseKey].indexOf(v)===-1)userSymFav[baseKey].push(v);
  if(userSymRemoved[baseKey]){
    userSymRemoved[baseKey]=userSymRemoved[baseKey].filter(function(x){return x!==v;});
    if(!userSymRemoved[baseKey].length)delete userSymRemoved[baseKey];
    localStorage.setItem('ec_user_sym_removed',JSON.stringify(userSymRemoved));
  }
  localStorage.setItem('ec_user_sym_fav',JSON.stringify(userSymFav));
  bus.emit('toast:save');
  if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
}

/* ── 미니 약품+용량 픽커 (Phase 6 공통, 2026-05-23 / 토글 방식) ──
 *  · 옵션 1·3·옵션 5(Complex) 에서 사용
 *  · 약 클릭 = 선택 (✓), 다시 클릭 = 해제. 여러 개 동시 선택 가능
 *  · 선택된 약 행마다 인라인 용량/단위 입력
 *  · 외부 클릭 = 자동 저장 → onPick("투약[약1 (용량), 약2 (용량)]") 콜백 */
export function _symOpenDrugDoseMiniPicker(onPick, symKey, preselected, onBack){ /* export — 키오스크 편집기 증상처치입력 모달이 동일 약품 픽커 재사용 (2026-06-12) */
  const oldP=document.getElementById('symMiniDrugPick');if(oldP)oldP.remove();
  const allCats=['digest','digestPain','menstrual','pain','supplement','respiratory','allergy','anxiety','throat','oral','skin','wound','eye','trauma','herpes','burn','hemostasis','cleansing','scar','nasal','disinfect','ointment','patch'];
  const allSet={};
  allCats.forEach(function(c){
    (_medDb[c]||[]).forEach(function(m){allSet[m]=1;});
    ((S._medDbUser&&S._medDbUser[c])||[]).forEach(function(m){allSet[m]=1;});
  });
  try{
    const u=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
    Object.keys(u).forEach(function(m){allSet[m]=1;});
  }catch(_){}
  const allList=Object.keys(allSet).sort();
  /* 추천 약품 — 활성 증상(symKey) 의 카테고리 매칭 약 */
  const recSet={};
  const recList=[];
  if(symKey && symKey !== '__legacy__'){
    const _split=(typeof _symSplitSymLabel==='function')?_symSplitSymLabel(symKey):null;
    const _sym=(_split && _split.base) || symKey;
    const _cats=_medSymMap[_sym]||[];
    try{
      const _ums=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
      Object.keys(_ums).forEach(function(med){
        if((_ums[med]||[]).indexOf(_sym)!==-1 && !recSet[med]){recSet[med]=1;recList.push(med);}
      });
    }catch(_){}
    _cats.forEach(function(c){
      ((S._medDbUser&&S._medDbUser[c])||[]).forEach(function(m){if(!recSet[m]){recSet[m]=1;recList.push(m);}});
      (_medDb[c]||[]).forEach(function(m){if(!recSet[m]){recSet[m]=1;recList.push(m);}});
    });
    (_medFrequent[_sym]||[]).forEach(function(m){if(!recSet[m]){recSet[m]=1;recList.push(m);}});
  }
  const pop=document.createElement('div');pop.id='symMiniDrugPick';
  pop.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.20);z-index:12200';
  /* 높이 고정 — 검색 결과 수에 따라 박스가 작아졌다 커졌다 하지 않도록 (사용자 요청 2026-06-04). 리스트(flex:1)가 스크롤로 흡수. */
  let h='<div id="symMiniDrugBox" style="background:var(--card);border:1px solid var(--cyan);border-radius:12px;width:360px;height:540px;max-height:90vh;box-shadow:0 12px 40px rgba(0,0,0,0.30);display:flex;flex-direction:column;overflow:hidden;font-family:var(--f)">'
    +'<div style="padding:11px 16px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));font-size:12.5px;font-weight:800;color:var(--t1)">하나의 칩에 약품(1개 이상)을 추가</div>'
    +'<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:var(--t2);letter-spacing:0.2px">미리보기</div>'
    +'<div id="symMiniPreview" style="margin:0 14px 8px;padding:8px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-left:3px solid var(--cyan);border-radius:6px;min-height:40px;box-sizing:border-box;display:flex;align-items:center"></div>'
    +'<div style="padding:8px 14px;border-bottom:1px solid var(--bdr);border-top:1px solid var(--bdr)"><input id="symMiniDrugSrch" placeholder="약품명 검색…" style="width:100%;font-size:11px;padding:5px 8px;border:1px solid var(--bdr);border-radius:6px;font-family:var(--f);background:var(--card);color:var(--t1)" autofocus></div>'
    +'<div id="symMiniSelectedChips" style="padding:0;border-bottom:none;display:none;flex-wrap:wrap;gap:3px;align-items:center"></div>'
    +'<div id="symMiniDrugList" style="flex:1;overflow-y:auto;padding:8px 14px"></div>'
    +'<div style="padding:8px 14px;border-top:1px solid var(--bdr);background:var(--bg3);font-size:11px;font-weight:600;color:var(--t2);display:flex;justify-content:space-between;align-items:center">'
      +'<span>선택됨 <span id="symMiniPickedCount" style="color:var(--cyan);font-weight:800">0개</span></span>'
      +'<span style="font-size:10px;color:var(--t3)">외부 클릭으로 저장</span>'
    +'</div>'
    /* 뒤로가기 버튼 — onBack(옵션 선택 모달로 복귀)이 있을 때만 표시. 옵션 3·5 처럼 onBack 이 없으면
     * 외부 클릭이 곧 저장+닫힘(=뒤로 간 셈)이라 버튼이 중복이므로 숨김 (사용자 요청 2026-05-28). */
    +((typeof onBack==='function')
      ? '<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card);flex-shrink:0">'
        +'<button id="symMiniBackBtn" style="padding:7px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;font-family:var(--f)">← 뒤로가기</button>'
        +'<span style="font-size:9.5px;color:var(--t3);font-weight:600;line-height:1.4">뒤로가기 버튼 클릭 이전에 기입한 내용은 자동 저장됩니다.</span>'
      +'</div>'
      : '')
    +'</div>';
  pop.innerHTML=h;
  document.body.appendChild(pop);
  const search=document.getElementById('symMiniDrugSrch');
  const listEl=document.getElementById('symMiniDrugList');
  /* 선택된 약품 상태 — {drugName: {dose, unit}}. preselected 인자로 초기화 가능 (수정 모드) */
  const _picked = preselected ? JSON.parse(JSON.stringify(preselected)) : {};
  /* 단위 호버 메뉴 — body 부착 단일 공유 */
  const UNITS=['T','C','g','cc','ml','mg','gtt','포','개','병'];
  let _unitMenu=document.getElementById('symMiniUnitMenu');
  if(_unitMenu)_unitMenu.remove();
  _unitMenu=document.createElement('div');
  _unitMenu.id='symMiniUnitMenu';
  _unitMenu.style.cssText='position:fixed;display:none;flex-direction:row;gap:2px;padding:4px;background:var(--card);border:1px solid var(--bdr);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:12300;font-family:var(--f)';
  UNITS.forEach(function(u){
    const b=document.createElement('span');
    b.dataset.unit=u;
    b.textContent=(u==='gtt'?'gtt(방울)':u);
    b.style.cssText='padding:3px 10px;font-size:11px;font-weight:600;color:var(--t1);border-radius:4px;cursor:pointer;text-align:center';
    b.onmouseover=function(){b.style.background='rgba(6,182,212,0.12)';};
    b.onmouseout=function(){b.style.background='transparent';};
    _unitMenu.appendChild(b);
  });
  document.body.appendChild(_unitMenu);
  let _unitHideTimer=null;
  let _activeUnitTrig=null;
  let _activeUnitMed='';
  function _showUnitMenu(trig, med){
    clearTimeout(_unitHideTimer);
    _activeUnitTrig=trig;
    _activeUnitMed=med;
    const tR=trig.getBoundingClientRect();
    _unitMenu.style.display='flex';
    const mW=_unitMenu.offsetWidth||280;
    const mH=_unitMenu.offsetHeight||32;
    let top=tR.bottom+4;
    let left=tR.right-mW;
    if(left<6)left=6;
    if(left+mW>window.innerWidth-6)left=window.innerWidth-mW-6;
    if(top+mH>window.innerHeight-6)top=tR.top-mH-4;
    _unitMenu.style.top=top+'px';
    _unitMenu.style.left=left+'px';
  }
  function _scheduleHideUnit(){
    clearTimeout(_unitHideTimer);
    _unitHideTimer=setTimeout(function(){
      if(_unitMenu.matches(':hover'))return;
      if(_activeUnitTrig && _activeUnitTrig.matches(':hover'))return;
      _unitMenu.style.display='none';
      _activeUnitTrig=null;
      _activeUnitMed='';
    },300);
  }
  _unitMenu.addEventListener('mouseenter',function(){clearTimeout(_unitHideTimer);});
  _unitMenu.addEventListener('mouseleave',_scheduleHideUnit);
  _unitMenu.addEventListener('click',function(e){
    e.stopPropagation();
    const b=e.target.closest('[data-unit]');
    if(!b || !_activeUnitMed)return;
    const u=b.dataset.unit;
    if(_picked[_activeUnitMed]){
      _picked[_activeUnitMed].unit=u;
      /* 해당 단위 라벨 갱신 */
      const lblEl=listEl.querySelector('[data-unit-lbl-for="'+escSel(_activeUnitMed)+'"]');
      if(lblEl)lblEl.textContent=u;
      /* 칩 영역 + 미리보기 갱신 (단위 변경 반영) */
      _renderSelectedChips();
      _renderPreview();
    }
    _unitMenu.style.display='none';
    _activeUnitTrig=null;
    _activeUnitMed='';
  });
  /* 단위 메뉴 키보드 네비게이션 — 투여량 칸에서 Tab → 단위 가로 메뉴 열림, ←→로 이동, Enter 선택+저장, ESC 닫기 (사용자 요청 2026-06-04) */
  let _unitKbIndex=-1;
  function _unitKbHighlight(){
    const items=_unitMenu.querySelectorAll('[data-unit]');
    items.forEach(function(it,i){ it.style.background=(i===_unitKbIndex)?'rgba(6,182,212,0.18)':'transparent'; });
  }
  function _unitKbStart(){
    _unitKbIndex=0; _unitKbHighlight();
    document.addEventListener('keydown',_unitKbKeydown,true);
  }
  function _unitKbEnd(){
    document.removeEventListener('keydown',_unitKbKeydown,true);
    _unitKbIndex=-1;
    _unitMenu.querySelectorAll('[data-unit]').forEach(function(it){it.style.background='transparent';});
  }
  function _unitKbKeydown(e){
    if(_unitMenu.style.display==='none'){ _unitKbEnd(); return; }
    const items=_unitMenu.querySelectorAll('[data-unit]');
    if(!items.length)return;
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){ e.preventDefault(); _unitKbIndex=(_unitKbIndex+1)%items.length; _unitKbHighlight(); }
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ e.preventDefault(); _unitKbIndex=(_unitKbIndex-1+items.length)%items.length; _unitKbHighlight(); }
    else if(e.key==='Enter'){ e.preventDefault(); const it=items[_unitKbIndex]; _unitKbEnd(); if(it)it.click(); /* click → 단위 적용+메뉴 닫힘+미리보기 갱신(=저장 반영) */ }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); _unitMenu.style.display='none'; _activeUnitTrig=null; _activeUnitMed=''; _unitKbEnd(); }
  }
  function _drugRow(m){
    const isSel=!!_picked[m];
    const sel=_picked[m]||{};
    let html='<div data-drug="'+escHtml(m)+'" style="display:flex;align-items:center;gap:6px;padding:5px 8px;margin-bottom:2px;border-radius:6px;cursor:pointer;font-size:11.5px;color:var(--t1);border:1px solid '+(isSel?'var(--cyan)':'transparent')+';background:'+(isSel?'rgba(6,182,212,0.08)':'transparent')+'">';
    html+=isSel?'<span style="color:var(--cyan);font-size:13px;width:13px;flex-shrink:0">✓</span>':'<span style="width:13px;flex-shrink:0"></span>';
    html+='<span style="flex:1">'+escHtml(m)+'</span>';
    if(isSel){
      /* 기존 투약 팝업 _buildMedDoseInput 와 동일 스타일 — 회색 톤, 100px 입력 */
      html+='<input data-dose-for="'+escHtml(m)+'" type="text" value="'+escHtml(sel.dose||'')+'" placeholder="숫자로 투여량 입력" maxlength="20" style="width:100px;font-size:10px;padding:2px 7px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);outline:none;font-family:var(--f);text-align:center">';
      html+='<span data-unit-for="'+escHtml(m)+'" style="padding:2px 6px;font-size:10px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:2px;flex-shrink:0"><span data-unit-lbl-for="'+escHtml(m)+'">'+escHtml(sel.unit||'단위')+'</span><span style="font-size:8px">▾</span></span>';
    }
    html+='</div>';
    return html;
  }
  /* 검색 매칭 — 기존 투약 팝업과 동일: startsWith / 초성 / contains 통합 */
  function _matchDrug(m, q){
    if(!q)return true;
    const ml=m.toLowerCase();
    let paren='';const pi=m.indexOf('(');if(pi!==-1){paren=m.substring(pi+1).replace(')','').toLowerCase();}
    if(ml.startsWith(q)||paren.startsWith(q))return true;
    const _hasKorean=/[가-힣ㄱ-ㅎ]/.test(q);
    if(_hasKorean){
      if(typeof matchKoreanFromStart==='function' && matchKoreanFromStart(m,q))return true;
      if(typeof matchKorean==='function' && matchKorean(m,q))return true;
    }
    if(ml.includes(q)||paren.includes(q))return true;
    return false;
  }
  function _renderList(filter){
    const f=(filter||'').trim().toLowerCase();
    let html='';
    if(recList.length){
      const recFiltered=f?recList.filter(function(m){return _matchDrug(m,f);}):recList;
      if(recFiltered.length){
        html+='<div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px;padding-bottom:2px;border-bottom:1px solid rgba(6,182,212,0.15)">★ 추천 약품 (선택 증상 기반)</div>';
        recFiltered.forEach(function(m){html+=_drugRow(m);});
      }
    }
    const allFiltered=allList.filter(function(m){
      if(recSet[m])return false;
      if(!_matchDrug(m,f))return false;
      return true;
    });
    if(allFiltered.length){
      html+='<div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px;'+(recList.length?'margin-top:8px;padding-top:6px;border-top:1px solid var(--bdrl);':'')+'">전체 약품</div>';
      allFiltered.forEach(function(m){html+=_drugRow(m);});
    }
    if(!html)html='<div style="font-size:11px;color:var(--t3);padding:8px;text-align:center">검색 결과 없음</div>';
    listEl.innerHTML=html;
    /* 단위 trigger 호버 부착 (이벤트 위임 어려워서 직접) */
    listEl.querySelectorAll('[data-unit-for]').forEach(function(trig){
      const med=trig.dataset.unitFor;
      trig.addEventListener('mouseenter',function(){_showUnitMenu(trig, med);});
      trig.addEventListener('mouseleave',_scheduleHideUnit);
    });
  }
  /* 미리보기 — 헤더 아래 검색바 위 영역 */
  function _renderPreview(){
    const prevEl=document.getElementById('symMiniPreview');
    if(!prevEl)return;
    const names=Object.keys(_picked);
    if(names.length===0){
      prevEl.innerHTML='<span style="font-size:10.5px;color:var(--t3);font-style:italic">입력한 대로 여기에 표시됩니다.</span>';
      return;
    }
    const parts=names.map(function(m){
      const s=_picked[m];
      const full=s.dose?(s.dose+(s.unit||'')):'';
      return full?(m+' ('+full+')'):m;
    });
    const chip='투약['+parts.join(', ')+']';
    /* 외부 wrapper(스크롤) → 내부 chip(고정 한 줄). flex 부모의 align-items:center 가 wrapper 를 수직 정중앙 배치 */
    prevEl.innerHTML='<div style="width:100%;overflow-x:auto;overflow-y:hidden;padding:2px 0"><span style="display:inline-block;padding:2px 10px;border-radius:11px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:11.5px;font-weight:700;font-family:var(--f);white-space:nowrap;line-height:1.4">'+escHtml(chip)+'</span></div>';
  }
  function _updateCount(){
    const cEl=document.getElementById('symMiniPickedCount');
    if(cEl)cEl.textContent=Object.keys(_picked).length+'개';
  }
  /* 선택된 약품 칩 영역 — 검색창 아래, 투약 팝업과 동일 GUI */
  function _renderSelectedChips(){
    const wrap=document.getElementById('symMiniSelectedChips');
    if(!wrap)return;
    const names=Object.keys(_picked);
    if(names.length===0){
      wrap.style.padding='0';
      wrap.style.borderBottom='none';
      wrap.style.display='none';
      wrap.innerHTML='';
      return;
    }
    wrap.style.padding='6px 14px';
    wrap.style.borderBottom='1px solid var(--bdr)';
    wrap.style.display='flex';
    let h='<span style="font-size:9px;color:var(--t3);font-weight:700;margin-right:2px">선택:</span>';
    names.forEach(function(m){
      const s=_picked[m]||{};
      const full=s.dose?(s.dose+(s.unit||'')):'';
      const disp=full?(escHtml(m)+' ('+escHtml(full)+')'):escHtml(m);
      h+='<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border-radius:8px;background:rgba(6,182,212,0.1);color:var(--cyan);font-size:9px;font-weight:600;border:1px solid rgba(6,182,212,0.2)"><span data-scroll-to="'+escHtml(m)+'" style="cursor:pointer" title="이 약품 위치로 이동">'+disp+'</span><span data-deselect="'+escHtml(m)+'" style="cursor:pointer;font-size:11px;line-height:1;margin-left:2px;color:var(--cyan);opacity:0.7">✕</span></span>';
    });
    wrap.innerHTML=h;
  }
  _renderList('');
  _updateCount();
  _renderSelectedChips();
  _renderPreview();
  function _close(){
    document.removeEventListener('keydown',_miniEsc,true);
    if(_unitMenu&&_unitMenu.parentNode)_unitMenu.remove();
    if(pop.parentNode)pop.remove();
  }
  function _save(){
    const names=Object.keys(_picked);
    if(names.length===0){_close();return;}
    const parts=names.map(function(m){
      const s=_picked[m];
      const full=s.dose?(s.dose+(s.unit||'')):'';
      return full?(m+' ('+full+')'):m;
    });
    const chip='투약['+parts.join(', ')+']';
    _close();
    if(typeof onPick==='function')onPick(chip);
  }
  /* ESC = 이 미니 픽커만 닫고 저장 (밑의 옵션/증상 팝업까지 닫히지 않게 capture+stopPropagation, 사용자 보고 2026-06-04).
   *  단위 가로 메뉴가 열려 있으면 그쪽 ESC(_unitKbKeydown)가 먼저 닫으므로 여기선 건너뜀. */
  function _miniEsc(ev){
    if(ev.key!=='Escape')return;
    if(!document.getElementById('symMiniDrugPick'))return;
    if(_unitMenu && _unitMenu.style.display!=='none')return;
    ev.preventDefault(); ev.stopPropagation();
    _save();
  }
  document.addEventListener('keydown',_miniEsc,true);
  search.addEventListener('input',function(){_renderList(search.value);});
  /* 약품 행 클릭 = 토글 (단, 용량 input / 단위 trigger 클릭은 무시) */
  listEl.addEventListener('click',function(e){
    if(e.target.closest('[data-dose-for]'))return;
    if(e.target.closest('[data-unit-for]'))return;
    const row=e.target.closest('[data-drug]');
    if(!row)return;
    const m=row.dataset.drug;
    const _added=!_picked[m];   /* 지금 선택 안 돼 있으면 이번 클릭으로 추가됨 */
    if(_picked[m])delete _picked[m];
    else _picked[m]={dose:'',unit:''};
    _renderList(search.value);
    _updateCount();
    _renderSelectedChips();
    _renderPreview();
    /* 약을 새로 선택하면 그 약의 "숫자로 투여량 입력" 칸에 커서 자동 포커스 (사용자 요청 2026-06-04) */
    if(_added){
      setTimeout(function(){
        const _mSel=(window.CSS&&CSS.escape)?CSS.escape(m):String(m).replace(/"/g,'\\"');
        const _di=listEl.querySelector('[data-dose-for="'+_mSel+'"]');
        if(_di){ try{ _di.focus(); _di.select(); }catch(_){} }
      },0);
    }
  });
  /* 용량 input — 변경 시 _picked 에 반영 + 칩 영역 갱신 */
  listEl.addEventListener('input',function(e){
    const di=e.target.closest('[data-dose-for]');
    if(di && _picked[di.dataset.doseFor]){
      _picked[di.dataset.doseFor].dose=di.value;
      _renderSelectedChips();
      _renderPreview();
    }
  });
  /* 투여량 칸 Tab → 단위 가로 메뉴 열고 키보드 모드 진입 (사용자 요청 2026-06-04) */
  listEl.addEventListener('keydown',function(e){
    const di=e.target.closest('[data-dose-for]');
    if(!di)return;
    const med=di.dataset.doseFor;
    if(e.key==='Tab' && !e.shiftKey){
      const trig=listEl.querySelector('[data-unit-for="'+escSel(med)+'"]');
      if(trig){ e.preventDefault(); _showUnitMenu(trig, med); _unitKbStart(); }
    } else if(e.key==='Enter'){
      e.preventDefault(); di.blur();
    }
  });
  /* 선택된 칩 — 텍스트 클릭=스크롤+하이라이트, ✕=해제 */
  pop.addEventListener('click',function(e){
    const x=e.target.closest('[data-deselect]');
    if(x){
      e.stopPropagation();
      const m=x.dataset.deselect;
      delete _picked[m];
      _renderList(search.value);
      _updateCount();
      _renderSelectedChips();
      return;
    }
    const sc=e.target.closest('[data-scroll-to]');
    if(sc){
      e.stopPropagation();
      const med=sc.dataset.scrollTo;
      const rows=listEl.querySelectorAll('[data-drug]');
      let target=null;
      rows.forEach(function(r){if(r.dataset.drug===med)target=r;});
      if(target){
        try{target.scrollIntoView({block:'center',behavior:'smooth'});}catch(_){target.scrollIntoView();}
        const _prev=target.style.boxShadow;
        target.style.transition='box-shadow 0.25s';
        target.style.boxShadow='0 0 0 2px var(--cyan)';
        setTimeout(function(){target.style.boxShadow=_prev;},1200);
      }
      return;
    }
  });
  /* 외부 클릭 = 자동 저장 + 닫힘 */
  pop.addEventListener('mousedown',function(e){
    if(e.target===pop)_save();
  });
  /* 뒤로가기 버튼 — 자동 저장 후 onBack 콜백 */
  const backBtn=document.getElementById('symMiniBackBtn');
  if(backBtn){
    backBtn.addEventListener('click',function(e){
      e.stopPropagation();
      _save();
      if(typeof onBack==='function')onBack();
    });
  }
  search.focus();
}

/* CSS selector escape helper for Korean med names */
function escSel(s){return String(s||'').replace(/(["\\])/g,'\\$1');}

/* 용량+단위 문자열 파싱 — "1T" → {dose:"1",unit:"T"}, "0.5ml" → {dose:"0.5",unit:"ml"} */
function _symParseDoseUnit(str){
  if(!str)return {dose:'',unit:''};
  const units=['mg','gtt','cc','ml','T','C','g','포','개','병'];
  for(let i=0;i<units.length;i++){
    const u=units[i];
    if(str.endsWith(u))return {dose:str.slice(0,-u.length).trim(),unit:u};
  }
  return {dose:str,unit:''};
}

/* 미리보기 칩 ✕ 호버 스타일 — 모든 옵션 모달에서 공유 */
function _symInjectPrevChipXStyle(){
  if(document.getElementById('symPrevChipXStyle'))return;
  const st=document.createElement('style');
  st.id='symPrevChipXStyle';
  st.textContent='.sym-prev-chip-wrap{position:relative;display:inline-block}'
    +'.sym-prev-chip-wrap .sym-prev-x{position:absolute;top:-7px;right:-7px;width:18px;height:18px;border-radius:50%;background:#dc2626;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.15s ease;border:none;font-family:var(--f);box-shadow:0 2px 4px rgba(0,0,0,0.2);padding:0;line-height:1}'
    +'.sym-prev-chip-wrap:hover .sym-prev-x{opacity:1}';
  document.head.appendChild(st);
}

/* ── V/S 팝업 anchor 안전 조회 (Phase 3, 2026-05-22) ──
 *  · openVitalsEdit 는 anchor.getBoundingClientRect() 를 호출해 null 이면 크래시
 *  · 우선 같은 sym-key 의 V/S 측정 fav 칩을 찾고, 없으면 +추가 칩, 그래도 없으면 body 사용 */
function _symFindVsAnchor(symKey){
  const allVs=document.querySelectorAll('[data-action="openVs"]');
  for(let i=0;i<allVs.length;i++){
    if(allVs[i].dataset.symKey===symKey)return allVs[i];
  }
  const allAdd=document.querySelectorAll('[data-action="addUserTreat"]');
  for(let i=0;i<allAdd.length;i++){
    if(allAdd[i].dataset.symKey===symKey)return allAdd[i];
  }
  if(allVs.length)return allVs[0];
  if(allAdd.length)return allAdd[0];
  return document.body;
}

/* ── 우하단 경고 토스트 (Phase 2, 2026-05-22) ──
 *  · global-save-toast 와 동일 위치(right:24px, bottom:48px), 빨강 톤
 *  · 콤마/마침표 차단 안내 등 거부 메시지용 */
function _symShowWarnToast(text){
  const id='symRejectToast';
  let t=document.getElementById(id);
  if(t)t.remove();
  t=document.createElement('div');
  t.id=id;
  t.style.cssText='position:fixed;right:24px;bottom:48px;z-index:99999;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;background:rgba(220,38,38,0.12);color:#dc2626;border:1px solid rgba(220,38,38,0.28);opacity:0;transform:translateY(8px);transition:all .2s ease;font-family:var(--f);max-width:380px;line-height:1.5';
  t.textContent=text;
  document.body.appendChild(t);
  requestAnimationFrame(function(){
    t.style.opacity='1';
    t.style.transform='translateY(0)';
  });
  setTimeout(function(){
    if(!document.getElementById(id))return;
    t.style.opacity='0';
    t.style.transform='translateY(8px)';
    setTimeout(function(){if(t.parentNode)t.remove();},200);
  },3000);
}

/* ── 옵션 2 — 처치 단일 추가 다이얼로그 (Phase 2, 2026-05-22) ──
 *  · 미리보기 + input + 콤마/마침표 차단 (안내 토스트)
 *  · 엔터 / Esc / 외부 클릭 = 자동 저장 + 우하단 저장 토스트
 *  · 저장 위치: localStorage 'ec_user_sym_fav' (옛 _symPromptAddUserTreatForSym 과 동일) */
function _symOpenAddTreatSingleDialog(recId, symKey){
  const old=document.getElementById('symAddTreatSingleOverlay');if(old)closeModalGracefully(old);
  const ov=document.createElement('div');ov.id='symAddTreatSingleOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12100;transition:background 0.15s ease';
  let inner='<div id="symAddTreatSingleBox" style="background:var(--card);border-radius:12px;width:380px;max-width:96vw;box-shadow:0 16px 40px rgba(0,0,0,0.18);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s,transform 0.15s;display:flex;flex-direction:column">'
    +'<div style="padding:12px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">"'+escHtml(symKey)+'" — 하나의 칩에 약품 제외 처치 1개를 추가</div>'
    +'<div style="padding:14px 18px">'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">처치명</div>'
    +'<input id="symAddTreatInput" type="text" placeholder="예: 아이스팩 적용" style="width:100%;padding:7px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:12.5px;background:var(--card);color:var(--t1);outline:none;box-sizing:border-box;font-family:var(--f);margin-bottom:11px" autofocus>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);letter-spacing:0.2px;margin-bottom:5px">미리보기 <span style="font-size:9px;color:var(--t3);margin-left:3px">— 타이핑 즉시 갱신</span></div>'
    +'<div id="symAddTreatPreview" style="padding:9px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-left:3px solid var(--cyan);border-radius:6px;min-height:30px;display:flex;align-items:center"></div>'
    +'<div style="font-size:10px;color:var(--t3);margin-top:8px;line-height:1.5">'
    +'• 콤마(,) → 칩 구분자로 오인되어 차단<br>'
    +'• 마침표(.) → 문장 종결 인상이라 칩 정체성에 안 맞아 차단'
    +'</div>'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card);flex-shrink:0">'
      +'<button data-act="cancel" style="padding:7px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;font-family:var(--f)">← 뒤로가기</button>'
      +'<span style="font-size:9.5px;color:var(--t3);font-weight:600;line-height:1.4">뒤로가기 버튼 클릭 이전에 기입한 내용은 자동 저장됩니다.</span>'
    +'</div>'
    +'</div>';
  ov.innerHTML=inner;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symAddTreatSingleBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  const inp=document.getElementById('symAddTreatInput');
  const prev=document.getElementById('symAddTreatPreview');
  function _updatePreview(){
    const v=inp.value.trim();
    if(v){
      /* 진입 모달 예시 칩과 동일 스펙: 1.5px dashed, padding 3px 11px, 12px 700 */
      prev.innerHTML='<span style="display:inline-block;padding:3px 11px;border-radius:12px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:12px;font-weight:700;font-family:var(--f)">'+escHtml(v)+'</span>';
    } else {
      prev.innerHTML='<span style="font-size:10.5px;color:var(--t3);font-style:italic">입력한 대로 여기에 표시됩니다.</span>';
    }
  }
  _updatePreview();
  inp.focus();
  setTimeout(function(){try{if(document.activeElement!==inp)inp.focus();}catch(_){}},60);
  /* 콤마·마침표 차단 — beforeinput 으로 단일 문자 차단, paste 도 함께 막음 */
  inp.addEventListener('beforeinput',function(e){
    if(e.data && (e.data.indexOf(',')!==-1 || e.data.indexOf('.')!==-1)){
      e.preventDefault();
      const _ch=(e.data.indexOf(',')!==-1)?',':'.';
      _symShowWarnToast('"'+_ch+'" 가 필요하다면 처치 추가 방식 선택 4번 투약이 포함되지 않은 복수 처치를 선택하여 추가해주시기 바랍니다.');
    }
  });
  inp.addEventListener('input',_updatePreview);
  let _settled=false;
  function _closeAnim(cb){
    const b=document.getElementById('symAddTreatSingleBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  function _done(){
    if(_settled)return;_settled=true;
    const v=inp.value.trim();
    _closeAnim(function(){
      _symRegisterFav(symKey, v, recId);
    });
  }
  function _cancel(){
    /* 뒤로가기 — 자동 저장 후 진입 모달로 복귀 */
    if(_settled)return;_settled=true;
    const v=inp.value.trim();
    _closeAnim(function(){
      if(v)_symRegisterFav(symKey, v, recId);
      _symOpenAddOptionsModal(recId, symKey);
    });
  }
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();_done();}
    if(e.key==='Escape')_cancel();
  });
  ov.addEventListener('click',function(e){
    if(e.target.closest('[data-act="cancel"]')){_cancel();}
  });
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_done();});
}

/* ── 옵션 3 — 투약 + 처치 복수 추가 (Phase 6 재구현, 2026-05-23) ──
 *  · 모달 유지, 4 트리거로 항목을 로컬 누적 → 닫힘 시 콤마로 묶어 단일 칩 fav 등록
 *  · + 투약 → 미니 약품 픽커 → "투약[약 (용량)]" 항목 추가
 *  · + V/S 측정 / + 침상 안정 → 라벨 텍스트만 항목 추가 (모달 호출 안 함)
 *  · + 텍스트 → 미니 텍스트 입력 → 텍스트 항목 추가
 *  · 외부 클릭 = 단일 칩으로 fav 등록 (예: "투약[X], V/S 측정, 침상 안정, 온찜질") */
function _symOpenAddMixedDialog(recId, symKey){
  const old=document.getElementById('symAddMixedOverlay');if(old)closeModalGracefully(old);
  const state={items:[]};
  const ov=document.createElement('div');ov.id='symAddMixedOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12100;transition:background 0.15s ease';
  const trig=function(kind,color,label){
    return '<button data-trig="'+kind+'" style="padding:10px 12px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;font-family:var(--f);border:1px dashed '+color+';background:var(--card);color:'+color+';text-align:center;transition:all .15s">＋ '+escHtml(label)+'</button>';
  };
  let inner='<div id="symAddMixedBox" style="background:var(--card);border-radius:12px;width:420px;max-width:96vw;max-height:90vh;box-shadow:0 16px 40px rgba(0,0,0,0.18);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s,transform 0.15s;display:flex;flex-direction:column">'
    +'<div style="padding:12px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">"'+escHtml(symKey)+'" — 하나의 칩에 약품(1개 이상)과 다른 여러 처치들을 추가</div>'
    +'<div style="padding:14px 18px;overflow-y:auto">'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">항목 추가</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:11px">'
    +trig('med','#a855f7','투약')
    +trig('vs','#dc2626','V/S 측정')
    +trig('bed','#0e7490','침상 안정')
    +trig('txt','#b45309','텍스트')
    +'</div>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">추가된 항목 <span id="symMixCount" style="font-size:9.5px;color:var(--t3);font-weight:600">(0건)</span></div>'
    +'<div id="symMixItems" style="display:flex;flex-direction:column;gap:5px;margin-bottom:11px"></div>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">미리보기</div>'
    +'<div id="symMixPreview" style="padding:9px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-left:3px solid var(--cyan);border-radius:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px"></div>'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card);flex-shrink:0">'
      +'<button data-act="cancel" style="padding:7px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;font-family:var(--f)">← 뒤로가기</button>'
      +'<span style="font-size:9.5px;color:var(--t3);font-weight:600;line-height:1.4">뒤로가기 버튼 클릭 이전에 기입한 내용은 자동 저장됩니다.</span>'
    +'</div>'
    +'</div>';
  ov.innerHTML=inner;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symAddMixedBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  const itemsDiv=document.getElementById('symMixItems');
  const countSp=document.getElementById('symMixCount');
  const prev=document.getElementById('symMixPreview');
  function _renderItems(){
    countSp.textContent='('+state.items.length+'건)';
    let h='';
    state.items.forEach(function(it,idx){
      const kindLbl={med:'투약',vs:'V/S',bed:'침상',txt:'텍스트'}[it.kind]||'';
      const kindBg={med:'rgba(168,85,247,0.12)',vs:'rgba(220,38,38,0.10)',bed:'rgba(14,116,144,0.10)',txt:'rgba(245,158,11,0.10)'}[it.kind]||'var(--bg2)';
      const kindCol={med:'#a855f7',vs:'#dc2626',bed:'#0e7490',txt:'#b45309'}[it.kind]||'var(--t2)';
      const kindBdr={med:'rgba(168,85,247,0.25)',vs:'rgba(220,38,38,0.25)',bed:'rgba(14,116,144,0.25)',txt:'rgba(245,158,11,0.25)'}[it.kind]||'var(--bdrl)';
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:1px solid var(--bdrl);border-radius:7px;font-size:11.5px">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 7px;border-radius:8px;font-size:9.5px;font-weight:700;background:'+kindBg+';color:'+kindCol+';border:1px solid '+kindBdr+'">'+kindLbl+'</span>'
        +'<span style="flex:1;color:var(--t1)">'+escHtml(it.text)+'</span>'
        +'<button data-rm="'+idx+'" style="padding:3px 7px;font-size:10.5px;border:1px solid #fecaca;background:#fee2e2;color:#dc2626;border-radius:5px;cursor:pointer;font-weight:700;font-family:var(--f)">✕</button>'
        +'</div>';
    });
    itemsDiv.innerHTML=h;
  }
  function _renderPreview(){
    if(state.items.length===0){
      prev.innerHTML='<span style="font-size:10.5px;color:var(--t3);font-style:italic">입력한 대로 여기에 표시됩니다.</span>';
      return;
    }
    /* 단일 칩 텍스트: 항목들 콤마로 joined */
    const txt=state.items.map(function(it){return it.text;}).join(', ');
    prev.innerHTML='<span style="display:inline-block;padding:3px 11px;border-radius:12px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:12px;font-weight:700;font-family:var(--f)">'+escHtml(txt)+'</span>';
  }
  function _refresh(){_renderItems();_renderPreview();}
  _refresh();
  let _settled=false;
  function _closeAnim(cb){
    const b=document.getElementById('symAddMixedBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  function _done(){
    if(_settled)return;_settled=true;
    _closeAnim(function(){
      /* 옵션3은 '약품(1개 이상)+다른 처치' — 약품 1개 이상 AND 다른 처치 1개 이상이어야 등록.
       *  미달이면 외부 클릭/ESC/뒤로가기 어느 쪽이든 등록 안 함 + 안내 (사용자 결정 2026-05-28). */
      const _hasMed=state.items.some(function(it){return it.kind==='med';});
      const _hasOther=state.items.some(function(it){return it.kind!=='med';});
      if(_hasMed && _hasOther){
        const chip=state.items.map(function(it){return it.text;}).join(', ');
        _symRegisterFav(symKey, chip, recId);
      } else if(state.items.length){
        _symShowWarnToast('약품 1개 이상과 다른 처치 1개 이상이 있어야 저장됩니다. 저장 없이 돌아갑니다.');
      }
    });
  }
  function _openTxtMini(){
    const oldP=document.getElementById('symMixTxtMini');if(oldP)oldP.remove();
    const pop=document.createElement('div');pop.id='symMixTxtMini';
    pop.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.20);z-index:12200';
    let h='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;width:260px;box-shadow:0 10px 28px rgba(0,0,0,0.20);overflow:hidden;font-family:var(--f)">'
      +'<div style="padding:9px 14px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:12px;font-weight:800;color:var(--t1)">텍스트 항목 추가</div>'
      +'<div style="padding:12px 14px"><input id="symMixTxtInp" type="text" placeholder="예: 온찜질" style="width:100%;padding:7px 10px;font-size:12.5px;border:1px solid var(--bdr);border-radius:6px;font-family:var(--f);background:var(--card);color:var(--t1);outline:none;box-sizing:border-box" autofocus></div>'
      +'<div style="padding:7px 14px 10px;font-size:9.5px;color:var(--t3);border-top:1px dashed var(--bdrl);line-height:1.5">⏎ 엔터 또는 외부 클릭 시 추가</div>'
      +'</div>';
    pop.innerHTML=h;
    document.body.appendChild(pop);
    const inp=document.getElementById('symMixTxtInp');
    inp.focus();
    inp.addEventListener('beforeinput',function(e){
      if(e.data && (e.data.indexOf(',')!==-1 || e.data.indexOf('.')!==-1)){
        e.preventDefault();
        const _ch=(e.data.indexOf(',')!==-1)?',':'.';
        _symShowWarnToast('"'+_ch+'" 는 항목 텍스트에 사용할 수 없습니다.');
      }
    });
    let _ts=false;
    function _add(){
      if(_ts)return;_ts=true;
      const v=inp.value.trim();
      if(v){state.items.push({kind:'txt',text:v});_refresh();}
      if(pop.parentNode)pop.remove();
    }
    inp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();_add();}
      if(e.key==='Escape'){_ts=true;if(pop.parentNode)pop.remove();}
    });
    pop.addEventListener('mousedown',function(e){if(e.target===pop)_add();});
  }
  ov.addEventListener('click',function(e){
    if(e.target.closest('[data-act="cancel"]')){
      /* 뒤로가기 — 누적된 항목 자동 저장 후 진입 모달로 복귀 */
      _settled=true;
      _closeAnim(function(){
        /* 옵션3은 '약품+다른 처치' — 약품 1개 이상 AND 다른 처치 1개 이상이어야 등록 (사용자 결정 2026-05-28). */
        const _hasMed=state.items.some(function(it){return it.kind==='med';});
        const _hasOther=state.items.some(function(it){return it.kind!=='med';});
        if(_hasMed && _hasOther){
          const chip=state.items.map(function(it){return it.text;}).join(', ');
          _symRegisterFav(symKey, chip, recId);
        } else if(state.items.length){
          _symShowWarnToast('약품 1개 이상과 다른 처치 1개 이상이 있어야 저장됩니다. 저장 없이 돌아갑니다.');
        }
        _symOpenAddOptionsModal(recId, symKey);
      });
      return;
    }
    const trigBtn=e.target.closest('[data-trig]');
    if(trigBtn){
      e.stopPropagation();
      const kind=trigBtn.dataset.trig;
      if(kind==='med'){
        /* 다중 약품 픽커 — 콜백으로 완전한 "투약[...]" 문자열을 받음 */
        _symOpenDrugDoseMiniPicker(function(chipText){
          state.items.push({kind:'med',text:chipText});
          _refresh();
        }, symKey);
      } else if(kind==='vs'){
        /* 라벨 텍스트만 항목 추가 (실제 V/S 입력은 fav 클릭 후 record 에서 진행) */
        if(!state.items.some(function(it){return it.kind==='vs';})){
          state.items.push({kind:'vs',text:'V/S 측정'});
          _refresh();
        } else {
          _symShowWarnToast('이미 V/S 측정 항목이 있습니다.');
        }
      } else if(kind==='bed'){
        if(!state.items.some(function(it){return it.kind==='bed';})){
          state.items.push({kind:'bed',text:'침상 안정'});
          _refresh();
        } else {
          _symShowWarnToast('이미 침상 안정 항목이 있습니다.');
        }
      } else if(kind==='txt'){
        _openTxtMini();
      }
      return;
    }
    const rmBtn=e.target.closest('[data-rm]');
    if(rmBtn){
      e.stopPropagation();
      const idx=parseInt(rmBtn.dataset.rm,10);
      state.items.splice(idx,1);
      _refresh();
      return;
    }
  });
  document.addEventListener('keydown',function _escH(e){
    if(e.key==='Escape' && document.getElementById('symAddMixedOverlay')){
      e.preventDefault();
      document.removeEventListener('keydown',_escH);
      _done();
    }
  });
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_done();});
}

/* ── 옵션 5 — 약품 없는 복수 처치 (Phase 6 재구현, 2026-05-23) ──
 *  · 텍스트 input + V/S/침상 트리거로 항목 누적
 *  · 외부 클릭 = 콤마로 묶은 단일 칩 (예: "침상 안정, 학부모 연락, 병원 진료 권유") 자주 쓰는 처치에 등록
 *  · V/S/침상 트리거는 라벨 텍스트만 항목 추가 (모달 호출 안 함) */
function _symOpenAddNoMedDialog(recId, symKey){
  const old=document.getElementById('symAddNoMedOverlay');if(old)closeModalGracefully(old);
  const state={items:[]};
  const ov=document.createElement('div');ov.id='symAddNoMedOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12100;transition:background 0.15s ease';
  const trig=function(kind,color,label){
    return '<button data-trig="'+kind+'" style="padding:9px 12px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;font-family:var(--f);border:1px dashed '+color+';background:var(--card);color:'+color+';text-align:center">＋ '+escHtml(label)+'</button>';
  };
  let inner='<div id="symAddNoMedBox" style="background:var(--card);border-radius:12px;width:420px;max-width:96vw;max-height:90vh;box-shadow:0 16px 40px rgba(0,0,0,0.18);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s,transform 0.15s;display:flex;flex-direction:column">'
    +'<div style="padding:12px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">"'+escHtml(symKey)+'" — 하나의 칩에 약품 외 다른 여러 처치를 추가</div>'
    +'<div style="padding:14px 18px;overflow-y:auto">'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:3px">항목 추가</div>'
    +'<div style="font-size:10.5px;color:var(--t3);font-weight:600;margin-bottom:7px;line-height:1.5">건건이 추가하여 입력하시면 하나의 칩 안에 들어갑니다.</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:11px">'
    +trig('vs','#dc2626','V/S 측정')
    +trig('bed','#0e7490','침상 안정')
    +trig('txt','#b45309','텍스트')
    +'</div>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">추가된 항목 <span id="symNoMedCount" style="font-size:9.5px;color:var(--t3);font-weight:600">(0건)</span></div>'
    +'<div id="symNoMedItems" style="display:flex;flex-direction:column;gap:5px;margin-bottom:11px"></div>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">미리보기</div>'
    +'<div id="symNoMedPreview" style="padding:9px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-left:3px solid var(--cyan);border-radius:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px"></div>'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card);flex-shrink:0">'
      +'<button data-act="cancel" style="padding:7px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;font-family:var(--f)">← 뒤로가기</button>'
      +'<span style="font-size:9.5px;color:var(--t3);font-weight:600;line-height:1.4">뒤로가기 버튼 클릭 이전에 기입한 내용은 자동 저장됩니다.</span>'
    +'</div>'
    +'</div>';
  ov.innerHTML=inner;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symAddNoMedBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  const itemsDiv=document.getElementById('symNoMedItems');
  const countSp=document.getElementById('symNoMedCount');
  const prev=document.getElementById('symNoMedPreview');
  function _renderItems(){
    countSp.textContent='('+state.items.length+'건)';
    let h='';
    state.items.forEach(function(it,idx){
      const kindLbl={vs:'V/S',bed:'침상',txt:'텍스트'}[it.kind]||'';
      const kindBg={vs:'rgba(220,38,38,0.10)',bed:'rgba(14,116,144,0.10)',txt:'rgba(245,158,11,0.10)'}[it.kind]||'var(--bg2)';
      const kindCol={vs:'#dc2626',bed:'#0e7490',txt:'#b45309'}[it.kind]||'var(--t2)';
      const kindBdr={vs:'rgba(220,38,38,0.25)',bed:'rgba(14,116,144,0.25)',txt:'rgba(245,158,11,0.25)'}[it.kind]||'var(--bdrl)';
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:1px solid var(--bdrl);border-radius:7px;font-size:11.5px">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 7px;border-radius:8px;font-size:9.5px;font-weight:700;background:'+kindBg+';color:'+kindCol+';border:1px solid '+kindBdr+'">'+kindLbl+'</span>'
        +'<span style="flex:1;color:var(--t1)">'+escHtml(it.text)+'</span>'
        +'<button data-rm="'+idx+'" style="padding:3px 7px;font-size:10.5px;border:1px solid #fecaca;background:#fee2e2;color:#dc2626;border-radius:5px;cursor:pointer;font-weight:700;font-family:var(--f)">✕</button>'
        +'</div>';
    });
    itemsDiv.innerHTML=h;
  }
  function _renderPreview(){
    if(state.items.length===0){
      prev.innerHTML='<span style="font-size:10.5px;color:var(--t3);font-style:italic">입력한 대로 여기에 표시됩니다.</span>';
      return;
    }
    const txt=state.items.map(function(it){return it.text;}).join(', ');
    prev.innerHTML='<span style="display:inline-block;padding:3px 11px;border-radius:12px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:12px;font-weight:700;font-family:var(--f)">'+escHtml(txt)+'</span>';
  }
  function _refresh(){_renderItems();_renderPreview();}
  _refresh();
  let _settled=false;
  function _closeAnim(cb){
    const b=document.getElementById('symAddNoMedBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  function _done(){
    if(_settled)return;
    /* 1건만 입력하고 외부 클릭으로 닫는 경우 — 확인 모달 (사용자 요청 2026-06-11).
     *  예 = 저장 없이 나감 / 아니오 = 안내만 닫고 이 다이얼로그 유지. */
    if(state.items.length===1){
      _settled=true; /* 확인 모달 떠 있는 동안 중복 트리거 잠금 */
      appConfirmModal(
        '투약 외 두 개 이상의 처치를 입력해야 합니다. 나가시겠습니까?<br>\'예\'를 클릭하면 저장되지 않습니다.',
        '⚠️ 처치 추가 미완료',
        {okLabel:'예', cancelLabel:'아니오', okBg:'rgba(6,182,212,0.10)', okBorder:'rgba(6,182,212,0.35)', okColor:'var(--cyan)'}
      ).then(function(yes){
        if(yes){ _closeAnim(function(){}); }   /* 저장 없이 나감 */
        else { _settled=false; }               /* 다이얼로그 유지 — 이어서 입력 */
      });
      return;
    }
    _settled=true;
    _closeAnim(function(){
      /* 옵션4는 '약품 외 여러 처치' — 항목 2개 이상이어야 등록 (사용자 결정 2026-05-28). 0건이면 조용히 닫힘. */
      if(state.items.length>=2){
        const chip=state.items.map(function(it){return it.text;}).join(', ');
        _symRegisterFav(symKey, chip, recId);
      }
    });
  }
  function _openNoMedTxtMini(){
    const oldP=document.getElementById('symNoMedTxtMini');if(oldP)oldP.remove();
    const pop=document.createElement('div');pop.id='symNoMedTxtMini';
    pop.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.20);z-index:12200';
    let h='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;width:260px;box-shadow:0 10px 28px rgba(0,0,0,0.20);overflow:hidden;font-family:var(--f)">'
      +'<div style="padding:9px 14px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:12px;font-weight:800;color:var(--t1)">텍스트 항목 추가</div>'
      +'<div style="padding:12px 14px"><input id="symNoMedTxtInp" type="text" placeholder="예: 학부모 연락" style="width:100%;padding:7px 10px;font-size:12.5px;border:1px solid var(--bdr);border-radius:6px;font-family:var(--f);background:var(--card);color:var(--t1);outline:none;box-sizing:border-box" autofocus></div>'
      +'<div style="padding:7px 14px 10px;font-size:9.5px;color:var(--t3);border-top:1px dashed var(--bdrl);line-height:1.5">⏎ 엔터 또는 외부 클릭 시 추가</div>'
      +'</div>';
    pop.innerHTML=h;
    document.body.appendChild(pop);
    const ti=document.getElementById('symNoMedTxtInp');
    ti.focus();
    ti.addEventListener('beforeinput',function(e){
      if(e.data && (e.data.indexOf(',')!==-1 || e.data.indexOf('.')!==-1)){
        e.preventDefault();
        const _ch=(e.data.indexOf(',')!==-1)?',':'.';
        _symShowWarnToast('"'+_ch+'" 는 텍스트 항목에 사용할 수 없습니다.');
      }
    });
    let _ts=false;
    function _add(){
      if(_ts)return;_ts=true;
      const v=ti.value.trim();
      if(v && !state.items.some(function(it){return it.text===v;})){
        state.items.push({kind:'txt',text:v});
        _refresh();
      }
      if(pop.parentNode)pop.remove();
    }
    ti.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();_add();}
      if(e.key==='Escape'){_ts=true;if(pop.parentNode)pop.remove();}
    });
    pop.addEventListener('mousedown',function(e){if(e.target===pop)_add();});
  }
  ov.addEventListener('click',function(e){
    if(e.target.closest('[data-act="cancel"]')){
      /* 뒤로가기 — 누적 항목 자동 저장 후 진입 모달로 복귀 */
      _settled=true;
      _closeAnim(function(){
        /* 옵션4는 '약품 외 여러 처치' — 항목 2개 이상이어야 등록 (사용자 결정 2026-05-28). */
        if(state.items.length>=2){
          const chip=state.items.map(function(it){return it.text;}).join(', ');
          _symRegisterFav(symKey, chip, recId);
        } else if(state.items.length){
          _symShowWarnToast('처치를 2개 이상 추가해야 저장됩니다. 저장 없이 돌아갑니다.');
        }
        _symOpenAddOptionsModal(recId, symKey);
      });
      return;
    }
    const trigBtn=e.target.closest('[data-trig]');
    if(trigBtn){
      e.stopPropagation();
      const kind=trigBtn.dataset.trig;
      if(kind==='vs'){
        if(!state.items.some(function(it){return it.kind==='vs';})){
          state.items.push({kind:'vs',text:'V/S 측정'});
          _refresh();
        } else {
          _symShowWarnToast('이미 V/S 측정 항목이 있습니다.');
        }
      } else if(kind==='bed'){
        if(!state.items.some(function(it){return it.kind==='bed';})){
          state.items.push({kind:'bed',text:'침상 안정'});
          _refresh();
        } else {
          _symShowWarnToast('이미 침상 안정 항목이 있습니다.');
        }
      } else if(kind==='txt'){
        _openNoMedTxtMini();
      }
      return;
    }
    const rmBtn=e.target.closest('[data-rm]');
    if(rmBtn){
      e.stopPropagation();
      const idx=parseInt(rmBtn.dataset.rm,10);
      state.items.splice(idx,1);
      _refresh();
      return;
    }
  });
  document.addEventListener('keydown',function _escH(e){
    if(e.key==='Escape' && document.getElementById('symAddNoMedOverlay')){
      e.preventDefault();
      document.removeEventListener('keydown',_escH);
      _done();
    }
  });
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_done();});
}

/* ── 옵션 4 — 약품 포함된 복수 처치 빌더 (Phase 6 재구현, 2026-05-23) ──
 *  · 처치명 input + 미니 약품 픽커 + 미니 텍스트 입력 + 항목 리스트
 *  · 단일 칩 형태: "처치명[항목1, 항목2, 항목3]" 으로 자주 쓰는 처치에 등록
 *  · 외부 클릭 = 단일 칩 fav 저장 + 우하단 토스트 */
function _symOpenAddComplexDialog(recId, symKey){
  const old=document.getElementById('symAddCpxOverlay');if(old)closeModalGracefully(old);
  /* 로컬 상태 — 처치명 + 항목 배열 */
  const state={action:'', items:[]};
  const ov=document.createElement('div');ov.id='symAddCpxOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12100;transition:background 0.15s ease';
  let inner='<div id="symAddCpxBox" style="background:var(--card);border-radius:12px;width:440px;max-width:96vw;max-height:90vh;box-shadow:0 16px 40px rgba(0,0,0,0.18);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s,transform 0.15s;display:flex;flex-direction:column">'
    +'<div style="padding:12px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">"'+escHtml(symKey)+'" — 처치 한 건에 약품(1개 이상)과 다른 여러 처치를 패키지로 묶기</div>'
    +'<div style="padding:14px 18px;overflow-y:auto">'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">먼저 괄호 앞에 표시될 문구(처치명)를 적어주세요. <span style="color:#dc2626;font-weight:800">(필수, 비우면 저장되지 않습니다)</span></div>'
    +'<input id="symCpxAction" type="text" placeholder="예: 소독 드레싱, 상처 처치" style="width:100%;padding:7px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:12.5px;background:var(--card);color:var(--t1);outline:none;box-sizing:border-box;font-family:var(--f);margin-bottom:11px" autofocus>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">괄호 안 항목 추가</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:11px">'
    +'<button data-trig="drug" style="padding:9px 12px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;font-family:var(--f);border:1px dashed #a855f7;background:var(--card);color:#a855f7">＋ 투약</button>'
    +'<button data-trig="vs" style="padding:9px 12px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;font-family:var(--f);border:1px dashed #dc2626;background:var(--card);color:#dc2626">＋ V/S 측정</button>'
    +'<button data-trig="bed" style="padding:9px 12px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;font-family:var(--f);border:1px dashed #0e7490;background:var(--card);color:#0e7490">＋ 침상 안정</button>'
    +'<button data-trig="txt" style="padding:9px 12px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;font-family:var(--f);border:1px dashed #b45309;background:var(--card);color:#b45309">＋ 텍스트</button>'
    +'</div>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">추가된 항목 <span id="symCpxCount" style="font-size:9.5px;color:var(--t3);font-weight:600">(0건)</span></div>'
    +'<div id="symCpxItems" style="display:flex;flex-direction:column;gap:5px;margin-bottom:11px"></div>'
    +'<div style="font-size:10.5px;font-weight:700;color:var(--t2);margin-bottom:5px">미리보기</div>'
    +'<div id="symCpxPreview" style="padding:9px 11px;background:var(--bg2);border:1px solid var(--bdrl);border-left:3px solid var(--cyan);border-radius:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px"></div>'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card);flex-shrink:0">'
      +'<button data-act="cancel" style="padding:7px 14px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;font-family:var(--f)">← 뒤로가기</button>'
      +'<span style="font-size:9.5px;color:var(--t3);font-weight:600;line-height:1.4">뒤로가기 버튼 클릭 이전에 기입한 내용은 자동 저장됩니다.</span>'
    +'</div>'
    +'</div>';
  ov.innerHTML=inner;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symAddCpxBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  const actionInp=document.getElementById('symCpxAction');
  const prev=document.getElementById('symCpxPreview');
  const itemsDiv=document.getElementById('symCpxItems');
  const countSp=document.getElementById('symCpxCount');
  function _buildChipText(){
    const a=state.action.trim();
    if(!a)return '';
    if(state.items.length===0)return a;
    /* 약품 항목은 '투약[…]'로 마킹해 저장 — picker 에서 고른 약품이 통계(투약 카운트)에 잡히도록.
     *  (옵션 3과 동일 형식. 예전엔 약을 일반 텍스트와 똑같이 넣어 카운트 누락됐음. 2026-06-09) */
    return a+'['+state.items.map(function(it){return it.kind==='drug'?('투약['+it.name+']'):it.name;}).join(', ')+']';
  }
  function _renderPreview(){
    const txt=_buildChipText();
    if(!txt){
      /* 사용자 보고 2026-05-28 — 처치명(괄호 앞 문구)을 비운 채 항목만 추가하면 _buildChipText 가 ''
       *  를 반환해 미리보기가 비고 종료 시 저장도 안 되어 입력이 통째로 사라지던 혼란.
       *  항목이 이미 있으면 그 항목들을 보여주고 "처치명을 입력해야 저장됨" 경고를 명시한다. */
      if(state.items.length>0){
        const _itemsTxt=state.items.map(function(it){return it.name;}).join(', ');
        prev.innerHTML='<div style="display:flex;flex-direction:column;gap:5px;width:100%">'
          +'<span style="align-self:flex-start;display:inline-block;padding:3px 11px;border-radius:12px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:12px;font-weight:700;font-family:var(--f)">['+escHtml(_itemsTxt)+']</span>'
          +'<span style="font-size:10.5px;color:#dc2626;font-weight:700">⚠ 맨 위 &quot;괄호 앞 문구&quot;(처치명)를 입력해야 저장됩니다.</span>'
          +'</div>';
      } else {
        prev.innerHTML='<span style="font-size:10.5px;color:var(--t3);font-style:italic">입력한 대로 여기에 표시됩니다.</span>';
      }
      return;
    }
    /* 단일 칩 — 점선 스타일 (옵션 진입 모달 예시 칩과 동일) */
    prev.innerHTML='<span style="display:inline-block;padding:3px 11px;border-radius:12px;background:var(--card);border:1.5px dashed var(--t3);color:var(--t1);font-size:12px;font-weight:700;font-family:var(--f)">'+escHtml(txt)+'</span>';
  }
  function _renderItems(){
    countSp.textContent='('+state.items.length+'건)';
    let h='';
    state.items.forEach(function(it,idx){
      const kindLbl={drug:'투약',vs:'V/S',bed:'침상',text:'텍스트'}[it.kind]||'텍스트';
      const kindBg={drug:'rgba(168,85,247,0.12)',vs:'rgba(220,38,38,0.10)',bed:'rgba(14,116,144,0.10)',text:'rgba(245,158,11,0.10)'}[it.kind]||'var(--bg2)';
      const kindCol={drug:'#a855f7',vs:'#dc2626',bed:'#0e7490',text:'#b45309'}[it.kind]||'var(--t2)';
      const kindBdr={drug:'rgba(168,85,247,0.25)',vs:'rgba(220,38,38,0.25)',bed:'rgba(14,116,144,0.25)',text:'rgba(245,158,11,0.25)'}[it.kind]||'var(--bdrl)';
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:1px solid var(--bdrl);border-radius:7px;font-size:11.5px">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 7px;border-radius:8px;font-size:9.5px;font-weight:700;background:'+kindBg+';color:'+kindCol+';border:1px solid '+kindBdr+'">'+kindLbl+'</span>'
        +'<span style="flex:1;color:var(--t1)">'+escHtml(it.name)+'</span>'
        +'<button data-rm="'+idx+'" style="padding:3px 7px;font-size:10.5px;border:1px solid #fecaca;background:#fee2e2;color:#dc2626;border-radius:5px;cursor:pointer;font-weight:700;font-family:var(--f)">✕</button>'
        +'</div>';
    });
    itemsDiv.innerHTML=h;
  }
  function _refresh(){_renderPreview();_renderItems();}
  _refresh();
  actionInp.focus();
  /* 처치명 input — 콤마/마침표 차단 (Phase 2 와 동일 규칙) */
  actionInp.addEventListener('beforeinput',function(e){
    if(e.data && (e.data.indexOf(',')!==-1 || e.data.indexOf('.')!==-1)){
      e.preventDefault();
      const _ch=(e.data.indexOf(',')!==-1)?',':'.';
      _symShowWarnToast('"'+_ch+'" 는 처치명에 사용할 수 없습니다.');
    }
  });
  actionInp.addEventListener('input',function(){state.action=actionInp.value;_refresh();});
  let _settled=false;
  function _closeAnim(cb){
    const b=document.getElementById('symAddCpxBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  function _done(){
    if(_settled)return;_settled=true;
    _closeAnim(function(){
      const chip=_buildChipText();
      /* 옵션5는 '약품(1개 이상)+다른 처치' 패키지 — 처치명 + 약품 항목이 1개 이상 있어야 등록.
       *  약 없이 나가면(외부 클릭/ESC/뒤로가기 모두) 등록 안 함 + 안내 (사용자 결정 2026-05-28). */
      if(chip && state.items.some(function(it){return it.kind==='drug';})){
        _symRegisterFav(symKey, chip, recId);
      } else if(state.action.trim() || state.items.length){
        _symShowWarnToast('처치명과 약품(1개 이상)이 있어야 저장됩니다. 저장 없이 돌아갑니다.');
      }
    });
  }
  /* 미니 약품 픽커 — 검색 + flat 약 목록 (간소화) */
  function _openDrugMini(){
    const oldP=document.getElementById('symCpxDrugMini');if(oldP)oldP.remove();
    const allCats=['digest','digestPain','menstrual','pain','supplement','respiratory','allergy','anxiety','throat','oral','skin','wound','eye','trauma','herpes','burn','hemostasis','cleansing','scar','nasal','disinfect','ointment','patch'];
    const allSet={};
    allCats.forEach(function(c){
      (_medDb[c]||[]).forEach(function(m){allSet[m]=1;});
      ((S._medDbUser&&S._medDbUser[c])||[]).forEach(function(m){allSet[m]=1;});
    });
    try{
      const u=JSON.parse(localStorage.getItem('ec_user_med_syms')||'{}');
      Object.keys(u).forEach(function(m){allSet[m]=1;});
    }catch(_){}
    const allList=Object.keys(allSet).sort();
    const pop=document.createElement('div');pop.id='symCpxDrugMini';
    pop.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.20);z-index:12200';
    let h='<div style="background:var(--card);border:1px solid var(--cyan);border-radius:12px;width:320px;max-height:440px;box-shadow:0 12px 40px rgba(0,0,0,0.30);display:flex;flex-direction:column;overflow:hidden;font-family:var(--f)">'
      +'<div style="padding:11px 16px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));font-size:12.5px;font-weight:800;color:var(--t1)">💊 약품 선택 (괄호 안에 추가)</div>'
      +'<div style="padding:8px 14px;border-bottom:1px solid var(--bdr)"><input id="symCpxDrugSearch" placeholder="검색…" style="width:100%;font-size:11px;padding:5px 8px;border:1px solid var(--bdr);border-radius:6px;font-family:var(--f);background:var(--card);color:var(--t1)" autofocus></div>'
      +'<div id="symCpxDrugList" style="flex:1;overflow-y:auto;padding:8px 14px"></div>'
      +'<div style="padding:7px 14px;border-top:1px solid var(--bdr);font-size:9.5px;color:var(--t3);text-align:right">외부 클릭 시 닫힘</div>'
      +'</div>';
    pop.innerHTML=h;
    document.body.appendChild(pop);
    const search=document.getElementById('symCpxDrugSearch');
    const listEl=document.getElementById('symCpxDrugList');
    function _renderList(filter){
      const f=(filter||'').trim().toLowerCase();
      const items=f?allList.filter(function(m){return m.toLowerCase().indexOf(f)!==-1;}):allList;
      let html='';
      items.slice(0,80).forEach(function(m){
        html+='<div data-drug="'+escHtml(m)+'" style="padding:6px 10px;margin-bottom:2px;border-radius:6px;cursor:pointer;font-size:11.5px;border:1px solid transparent;color:var(--t1)" onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'transparent\'">'+escHtml(m)+'</div>';
      });
      if(!items.length)html='<div style="font-size:11px;color:var(--t3);padding:8px;text-align:center">검색 결과 없음</div>';
      listEl.innerHTML=html;
    }
    _renderList('');
    search.addEventListener('input',function(){_renderList(search.value);});
    search.focus();
    pop.addEventListener('click',function(e){
      const it=e.target.closest('[data-drug]');
      if(it){
        const drug=it.dataset.drug;
        state.items.push({kind:'drug',name:drug});
        _refresh();
        pop.remove();
        return;
      }
      if(e.target===pop)pop.remove();
    });
  }
  /* 미니 텍스트 입력 */
  function _openTextMini(){
    const oldP=document.getElementById('symCpxTxtMini');if(oldP)oldP.remove();
    const pop=document.createElement('div');pop.id='symCpxTxtMini';
    pop.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.20);z-index:12200';
    let h='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;width:260px;box-shadow:0 10px 28px rgba(0,0,0,0.20);overflow:hidden;font-family:var(--f)">'
      +'<div style="padding:9px 14px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);font-size:12px;font-weight:800;color:var(--t1)">괄호 안에 추가할 내용</div>'
      +'<div style="padding:12px 14px"><input id="symCpxTxtInp" type="text" placeholder="예: 밴드 적용" style="width:100%;padding:7px 10px;font-size:12.5px;border:1px solid var(--bdr);border-radius:6px;font-family:var(--f);background:var(--card);color:var(--t1);outline:none;box-sizing:border-box" autofocus></div>'
      +'<div style="padding:7px 14px 10px;font-size:9.5px;color:var(--t3);border-top:1px dashed var(--bdrl);line-height:1.5">⏎ 엔터 또는 외부 클릭 시 추가</div>'
      +'</div>';
    pop.innerHTML=h;
    document.body.appendChild(pop);
    const inp=document.getElementById('symCpxTxtInp');
    inp.focus();
    inp.addEventListener('beforeinput',function(e){
      if(e.data && (e.data.indexOf(',')!==-1 || e.data.indexOf('.')!==-1)){
        e.preventDefault();
        const _ch=(e.data.indexOf(',')!==-1)?',':'.';
        _symShowWarnToast('"'+_ch+'" 는 괄호 안 텍스트에 사용할 수 없습니다.');
      }
    });
    let _txtSettled=false;
    function _addAndClose(){
      if(_txtSettled)return;_txtSettled=true;
      const v=inp.value.trim();
      if(v){state.items.push({kind:'text',name:v});_refresh();}
      pop.remove();
    }
    inp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();_addAndClose();}
      if(e.key==='Escape'){_txtSettled=true;pop.remove();}
    });
    pop.addEventListener('mousedown',function(e){if(e.target===pop)_addAndClose();});
  }
  /* 모달 클릭 핸들러 — 트리거 / 항목 삭제 / 외부 클릭 */
  ov.addEventListener('click',function(e){
    if(e.target.closest('[data-act="cancel"]')){
      /* 뒤로가기 — 자동 저장 후 진입 모달로 복귀 */
      _settled=true;
      _closeAnim(function(){
        const chip=_buildChipText();
        /* 옵션5는 '약품+다른 처치' 패키지 — 약품 항목이 1개 이상 있어야 등록 (사용자 결정 2026-05-28). */
        if(chip && state.items.some(function(it){return it.kind==='drug';})){
          _symRegisterFav(symKey, chip, recId);
        } else if(state.action.trim() || state.items.length){
          _symShowWarnToast('처치명과 약품(1개 이상)이 있어야 저장됩니다. 저장 없이 돌아갑니다.');
        }
        _symOpenAddOptionsModal(recId, symKey);
      });
      return;
    }
    const trigBtn=e.target.closest('[data-trig]');
    if(trigBtn){
      e.stopPropagation();
      const kind=trigBtn.dataset.trig;
      if(kind==='drug'){
        /* 다중 약품 픽커 사용 — "투약[...]" 래퍼를 벗기고 각 약품을 별도 항목으로 추가
         * (옵션 5 는 "처치명[약1 (용량), 약2 (용량), 텍스트1]" 형태이므로 중첩 괄호 회피) */
        _symOpenDrugDoseMiniPicker(function(chipText){
          const inner=String(chipText||'').replace(/^투약\[/,'').replace(/\]$/,'');
          if(!inner)return;
          inner.split(', ').forEach(function(p){
            if(p)state.items.push({kind:'drug',name:p});
          });
          _refresh();
        }, symKey);
      } else if(kind==='txt')_openTextMini();
      else if(kind==='vs'){
        if(!state.items.some(function(it){return it.kind==='vs';})){
          state.items.push({kind:'vs',name:'V/S 측정'});_refresh();
        } else {_symShowWarnToast('이미 V/S 측정 항목이 있습니다.');}
      } else if(kind==='bed'){
        if(!state.items.some(function(it){return it.kind==='bed';})){
          state.items.push({kind:'bed',name:'침상 안정'});_refresh();
        } else {_symShowWarnToast('이미 침상 안정 항목이 있습니다.');}
      }
      return;
    }
    const rmBtn=e.target.closest('[data-rm]');
    if(rmBtn){
      e.stopPropagation();
      const idx=parseInt(rmBtn.dataset.rm,10);
      state.items.splice(idx,1);
      _refresh();
      return;
    }
  });
  /* Esc 처리 — 모달 전체에 keydown 부착 */
  document.addEventListener('keydown',function _escH(e){
    if(e.key==='Escape' && document.getElementById('symAddCpxOverlay')){
      e.preventDefault();
      document.removeEventListener('keydown',_escH);
      _done();
    }
  });
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_done();});
}

/* ── Phase 3a: +추가 ──
 *  · 증상 0개 → 안내 토스트
 *  · 증상 1개 → 그 증상에 자동 등록 (자유 입력 다이얼로그)
 *  · 증상 2개 이상 → 어느 증상에 등록할지 선택 다이얼로그 → 자유 입력 다이얼로그 */
function _symPromptAddUserTreat(recId){
  /* 자주 쓰는 처치는 base name 으로 관리 — 괄호 안 메모는 일회성이므로 제거.
   * 동일 base name 중복 제거 (예: '복통' 과 '복통 (찢어지는 통증)' 모두 선택돼 있어도 '복통' 1회만 표시).
   * 사용자 요청 — 자유기입으로 입력된 증상(중분류에 없는 항목)은 picker 에서 제외. 자주 쓰는 처치는 중분류 증상에만 등록 가능.
   * 사용자 보고 2026-05-19 — '+추가' 로 사용자가 직접 등록한 중분류 증상도 자유기입이 아니라 정식 중분류이므로 picker 에 포함되어야 함.
   * 이를 위해 ec_user_symptoms (카테고리별 사용자 추가 증상) 도 _inCat 가 인식하도록 보강. */
  const _seen=new Set();
  const _userSymsForInCat=JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
  const _inCat=function(base){
    /* 유효 분류 기준 — 사용자 추가 분류(ucat_*)의 증상도 정식 중분류로 인식 (2026-06-12) */
    return getEffectiveSymCats(true).some(function(c){
      if(!c||!c.id)return false;
      if(Array.isArray(c.symptoms)&&c.symptoms.indexOf(base)!==-1)return true;
      const _u=_userSymsForInCat[c.id]||[];
      return _u.indexOf(base)!==-1;
    });
  };
  const syms=[];
  _symSelectedSymptoms.forEach(function(s){
    let base=s;
    const m=s.match(/^(.+?)\s*\((.*)\)\s*$/);
    if(m)base=m[1].trim();
    if(_seen.has(base))return;
    _seen.add(base);
    if(_inCat(base))syms.push(base);
  });
  if(!syms.length){
    bus.emit('toast:show', {text: '중분류 증상을 먼저 선택해 주세요. 자주 쓰는 처치는 자유기입 증상에는 등록할 수 없습니다.'});
    return;
  }
  if(syms.length===1){
    _symPromptAddUserTreatForSym(recId,syms[0]);
    return;
  }
  /* 2개 이상 — 어느 증상에 등록할지 선택 다이얼로그 */
  const old=document.getElementById('symPromptOverlay');if(old)closeModalGracefully(old);
  const ov=document.createElement('div');ov.id='symPromptOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);z-index:12000;transition:background 0.15s ease';
  let inner='<div id="symPromptBox" style="background:var(--card);border-radius:10px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,0.3);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.95);transition:opacity 0.15s ease,transform 0.15s ease">'
    +'<div style="font-size:13px;font-weight:700;color:var(--t1);padding:10px 16px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr)">어느 증상에 추가할까요?</div>'
    +'<div style="padding:12px 16px;display:flex;flex-direction:column;gap:6px">';
  /* 사용자 요청 — "[대분류 이모티콘] 카테고리명 > 증상명" 형태로 표시 (예: "🤢 소화기 증상 > 구역질"). data-pick 은 증상명만. */
  const _catFor=function(base){
    /* 유효 분류 기준 — 사용자 추가 분류·이름변경 반영, 사용자 추가 증상도 매칭 (2026-06-12) */
    return getEffectiveSymCats(true).find(function(c){
      if(!c)return false;
      if(Array.isArray(c.symptoms)&&c.symptoms.indexOf(base)!==-1)return true;
      return ((_userSymsForInCat[c.id]||[]).indexOf(base)!==-1);
    })||null;
  };
  syms.forEach(function(s){
    const _c=_catFor(s);
    const _ic=_c&&_c.icon?_c.icon:'🩺';
    const _cn=_c&&_c.name?_c.name:'';
    const _lbl=_cn?(escHtml(_cn)+' <span style="opacity:0.55;font-weight:500;margin:0 4px">&gt;</span> '+escHtml(s)):escHtml(s);
    inner+='<button data-pick="'+escHtml(s)+'" style="padding:9px 12px;border-radius:8px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t1);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--f);text-align:left">'+_ic+' '+_lbl+'</button>';
  });
  inner+='</div></div>';
  ov.innerHTML=inner;
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.25)';
    const b=document.getElementById('symPromptBox');if(b){b.style.opacity='1';b.style.transform='scale(1)';}
  });
  function _closeAnim(cb){
    const b=document.getElementById('symPromptBox');
    if(b){b.style.opacity='0';b.style.transform='scale(0.95)';}
    ov.style.background='rgba(0,0,0,0)';
    setTimeout(function(){ov.remove();if(cb)cb();},150);
  }
  ov.addEventListener('click',function(e){
    const btn=e.target.closest('[data-pick]');
    if(btn){const s=btn.dataset.pick;_closeAnim(function(){_symPromptAddUserTreatForSym(recId,s);});return;}
    if(e.target===ov)_closeAnim();
  });
}

function _symPromptAddUserTreatForSym(recId,sym){
  _symPrompt('"'+sym+'" 에 추가할 처치명','',function(name){
    if(!name||!name.trim())return;
    /* ★ 예전엔 여기서 풀네임 키(sym)로 직접 저장 → base 읽기와 안 맞아 부위 붙은 증상은 안 보였음.
     *  base 정규화·dedup·removed·undo·toast·render 를 모두 처리하는 공통 등록기로 위임. (2026-06-09 키 불일치 수정) */
    _symRegisterFav(sym, name.trim(), recId);
  });
}

/* ── Phase 3b: ✏️ 완전 자유 기입 — 칩 바로 아래에 미니 팝업, 위→아래 슬라이드 ──
 *  · 이번 일지의 처치(rec.treatment)에 자유 서술 항목을 직접 추가
 *  · 자주 쓰는 처치 목록(localStorage)에는 저장 안 함 (일회용)
 *  · 외부 클릭 / Enter / ESC = 자동 저장 + 닫힘. 저장/취소 버튼 없음. */
function _symOpenFreeTextDock(recId,anchorChip,initialEntry,symKey){
  /* 모달 열기 직전 미니 팝업 즉시 닫기 — 모달 아래로 설명이 겹치지 않게. (사용자 요청 2026-05-19) */
  if(typeof hideHeaderTooltip==='function')try{hideHeaderTooltip();}catch(_){}
  /* v3 — symKey 기반 분기: 새 모드에서 클릭한 블록의 증상에 자유 기술 처치 등록 (사용자 결정 2026-05-21).
   * legacy(__legacy__) 또는 symKey 없음 → flat(_symSelectedTreatments) 에만 추가하여 옛 일지 호환 유지. */
  const _useBySym = !!(symKey && symKey !== '__legacy__');
  /* 사용자 보고 2026-05-22 — 수정 모드(펜 클릭, initialEntry 있음) 시 flat 의 옛 값을 dock 열림 시점에 미리 제거.
   *  in-place 타이핑 중 800ms 디바운스로 _symRecomputeFlatTreatments 가 호출되면 flat 의 옛 값이 legacyFreeText
   *  보존 분류에 걸려 wipe 안 되고 살아남음 → 일반일지/사이드바에 옛값+새값 중복 누적되는 회귀.
   *  dock 열림 시점에 단 한 번 제거하여 input 이벤트·_save·디바운스 모두 깨끗한 상태에서 시작하도록. */
  if(_useBySym && initialEntry){
    const _flatOldIdx = _symSelectedTreatments.indexOf(initialEntry);
    if(_flatOldIdx !== -1) _symSelectedTreatments.splice(_flatOldIdx, 1);
  }
  function _ftTarget(){
    if(_useBySym){
      if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
      return _symTreatmentsBySym[symKey];
    }
    return _symSelectedTreatments;
  }
  const existing=document.getElementById('symFreeDock');
  if(existing && !initialEntry){existing.remove();return;}
  if(existing){existing.remove();}
  /* anchorChip 이 패널 재렌더로 detached 되었을 가능성 — 최신 DOM 에서 재조회.
   * 미조회 시 getBoundingClientRect 가 {0,0} 을 반환해 dock 이 화면 좌상단에 뜨는 버그 방지. */
  if(!anchorChip||!anchorChip.isConnected){
    const _fresh=document.querySelector('.sym-sel-chip[data-action="openFreeText"][data-rec-id="'+recId+'"]');
    if(_fresh)anchorChip=_fresh;
  }
  /* dock 을 body 에 position:fixed 로 띄움 — 처치 영역 위로 항상 노출 + 패널 재렌더 시 깜빡임 0.
   * CSS zoom 보정: getBoundingClientRect 는 시각 픽셀(scaled), style.left/top 은 레이아웃 단위 → zoom factor 로 나눠 보정.
   * 100% 가 아닐 때 dock 이 우측으로 어긋나는 버그 방지. */
  let _zf=1;
  try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
  let _r=anchorChip?anchorChip.getBoundingClientRect():{left:0,top:0,bottom:0,width:0,height:0};
  if(_r.width===0&&_r.height===0){
    /* 그래도 detached — symCatOverlay 우측 하단 fallback */
    const _ov=document.getElementById('symCatOverlay');
    if(_ov){const _ovR=_ov.getBoundingClientRect();_r={left:_ovR.left+24,top:_ovR.bottom-100,bottom:_ovR.bottom-80,width:0,height:0};}
  }
  /* 초기 좌표는 0,0 — 아래 _updatePos() 가 anchor 의 우상단에 정확히 재배치한다 (사용자 요청 2026-05-28). */
  /* dock 의 부모 블록 — dock 즉시 .open 부착 + input 핸들러의 sumWrap 정확도 보강 양쪽에서 사용 */
  const _ftBlockPair = (anchorChip && anchorChip.closest) ? anchorChip.closest('.sym-block-pair') : null;
  const dock=document.createElement('div');
  dock.id='symFreeDock';
  /* dock 이 어느 블록의 자유 기술인지 기억 — _symRenderTreatPanel 재렌더 시 그 블록 아코디언 .open 복원용 (사용자 요청 2026-05-21) */
  dock.dataset.symKey = (symKey && symKey !== '') ? symKey : '__legacy__';
  /* align-items:flex-start — textarea 가 여러 줄로 늘어날 때 label/textarea 윗변 정렬. visibility:hidden 으로 초기 깜빡임 방지 (좌표 계산 전 미리 렌더). */
  dock.style.cssText='position:fixed;left:0;top:0;z-index:12000;background:var(--card);border:1.5px solid rgba(251,191,36,0.7);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:9px;width:520px;max-width:92vw;box-shadow:0 6px 18px rgba(0,0,0,0.45);cursor:default;opacity:0;visibility:hidden;transition:opacity 0.18s ease';
  /* input → textarea: 줄이 길어지면 그 줄만큼 dock 세로 늘어남 (사용자 요청 2026-05-28).
   *  resize:none + overflow-y:auto + line-height:1.5 + 입력마다 height 자동 (max 240px). */
  dock.innerHTML='<span style="font-size:14px;font-weight:800;color:#d97706;white-space:nowrap;padding-top:6px">✏️ 처치 자유 기술 :</span>'
    +'<textarea id="symFreeInput" rows="1" placeholder="입력 즉시 자동 저장됩니다... (Enter, 이 팝업 외부 클릭: 저장)(ESC: 이 팝업 종료하되 저장 X)" style="flex:1;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:8px 12px;color:var(--t1);font-size:14px;outline:none;font-family:var(--f);resize:none;overflow-y:auto;line-height:1.5;min-height:36px;max-height:240px;box-sizing:border-box"></textarea>';
  document.body.appendChild(dock);
  /* dock 열림과 동시에 같은 블록의 자주 쓰는 처치 아코디언 즉시 펼침 — 사용자가 자유 기술 입력 중 항상 열린 채 유지 (사용자 요청 2026-05-21) */
  if(_ftBlockPair){
    const _accNow = _ftBlockPair.querySelector('.sym-fav-acc');
    if(_accNow) _accNow.classList.add('open');
  }
  const inp=dock.querySelector('#symFreeInput');
  /* textarea 자동 height — 입력마다 scrollHeight 기준 재계산. max 240px 후엔 textarea 자체 스크롤. */
  function _autoSize(){
    inp.style.height='auto';
    inp.style.height=Math.min(inp.scrollHeight, 240)+'px';
  }
  /* rAF loop: anchor 칩의 우상단에 dock 위치 추적 — 페이지/모달 스크롤·zoom·anchor 위치 변화 모두 자동 대응 (사용자 보고 2026-05-28).
   *  · 칩 위쪽에 띄움, 위 공간 부족 시 아래로 폴백
   *  · 좌측은 칩 우측 가장자리 기준, 오른쪽 화면 밖으로 나가면 자동 클립 */
  let _rafId=null;
  function _updatePos(){
    if(!dock.isConnected){ if(_rafId) cancelAnimationFrame(_rafId); _rafId=null; return; }
    if(anchorChip && anchorChip.isConnected){
      const _r=anchorChip.getBoundingClientRect();
      const _dh=dock.offsetHeight||0;
      const _dw=dock.offsetWidth||520;
      const _vw=window.innerWidth/_zf;
      const _vh=window.innerHeight/_zf;
      /* 우상단 정렬: dock 좌상단을 anchor 우상단 옆에 — 좌측은 anchor.right, 상단은 anchor.top - dock.height */
      let _lf=_r.right/_zf;
      let _tp=(_r.top - _dh - 6)/_zf;
      /* 오른쪽 화면 밖 → anchor.left 로 좌측 정렬 폴백 */
      if(_lf + _dw > _vw - 8) _lf = Math.max(8, _r.left/_zf);
      if(_lf + _dw > _vw - 8) _lf = Math.max(8, _vw - _dw - 8);
      /* 위 공간 부족 → 아래로 폴백 */
      if(_tp < 8) _tp=(_r.bottom + 6)/_zf;
      /* 아래도 화면 밖이면 강제 클립 */
      if(_tp + _dh > _vh - 8) _tp = Math.max(8, _vh - _dh - 8);
      dock.style.left=_lf+'px';
      dock.style.top=_tp+'px';
    }
    _rafId=requestAnimationFrame(_updatePos);
  }
  /* 다음 frame 에 좌표 잡고 가시화 — 첫 깜빡임 방지 */
  requestAnimationFrame(function(){
    _autoSize();
    _updatePos();
    dock.style.visibility='visible';
    dock.style.opacity='1';
    /* dock 가 보인 뒤 포커스 — visibility:hidden 상태에선 focus() 가 안 먹어 칩 클릭 후 입력란을 또 눌러야 했음 (사용자 보고 2026-05-30). */
    try{ inp.focus(); }catch(_){}
  });
  inp.focus();
  /* ESC 취소용 초기 상태 스냅샷 — 입력 시작 전 현재 처치 배열(_ftTarget) 과 flat(_symSelectedTreatments) 보관 (사용자 요청 2026-05-30 — ESC = 저장 안 함). */
  const _initialT = _ftTarget().slice();
  const _initialSelectedTreatments = _symSelectedTreatments.slice();
  let settled=false;
  /* _ftInputDebounce 는 _save 안에서 cancel 해야 하므로 함수 정의 전에 선언 (TDZ 회피).
   * input 핸들러가 실제로 setTimeout 하기 전에는 null. */
  let _ftInputDebounce = null;
  function _save(){
    if(settled)return;settled=true;
    /* rAF loop 중단 */
    if(_rafId){ cancelAnimationFrame(_rafId); _rafId=null; }
    /* 디바운스 살아있으면 즉시 cancel — _save 안에서 _symAutoSave 를 직접 호출하므로 중복 방지. */
    if(_ftInputDebounce){ clearTimeout(_ftInputDebounce); _ftInputDebounce = null; }
    const val=inp.value.trim();
    /* 닫힘 애니메이션 후 dock 제거 */
    dock.style.opacity='0';dock.style.transform='scaleY(0.2) translateY(-10px)';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},220);
    /* val 유무와 무관하게 in-memory 변경분(_symTreatmentsBySym 또는 _symSelectedTreatments)을 즉시 DB 로 commit.
     * 옛 코드: if(val) 블록 안에서만 _symAutoSave 호출 → 사용자가 입력 후 전체 삭제하고 Enter 누르면 800ms 디바운스가 안전망 역할이지만, 그 사이 부모 팝업이 닫히면 누락 가능 → val 여부와 무관하게 호출하도록 강건화 (사용자 보고 2026-05-21 — 자동 저장 보장 검증). */
    const _t=_ftTarget();
    /* 사용자 보고 2026-05-22 — 수정(펜 클릭) 시 옛 값(initialEntry) 을 제거하지 않아 옛값+새값이 중복 push 됨.
     *  결과: 같은 처치 두 칩 표시, X 로 새 값만 지워도 옛 값이 일지에 남음. 옛 값 먼저 제거 후 새 값 push.
     *  initialEntry 가 falsy 면 신규 추가 흐름 — 옛 값 제거 단계 생략 (옛 동작 그대로).
     *  추가 보강: sym-key 모드에서 by-sym 뿐 아니라 flat(_symSelectedTreatments) 의 옛 값도 함께 제거.
     *    _symRecomputeFlatTreatments 가 by-sym 에 없는 flat 항목을 "legacy 자유 기입" 으로 보존하기 때문에
     *    flat 에 옛 값이 남아 있으면 재계산 후 flat 에 다시 살아남아 일지에 잔존함 (사용자 보고 2026-05-22). */
    if(initialEntry){
      const _oldIdx=_t.indexOf(initialEntry);
      if(_oldIdx!==-1)_t.splice(_oldIdx,1);
      if(_useBySym){
        const _flatIdx=_symSelectedTreatments.indexOf(initialEntry);
        if(_flatIdx!==-1)_symSelectedTreatments.splice(_flatIdx,1);
      }
    }
    if(val && _t.indexOf(val)===-1)_t.push(val);
    if(_useBySym && typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    _symAutoSave();
    if(val){
      /* initialEntry 가 truthy → 펜 클릭으로 기존 자유 기술 처치 수정. falsy → 신규 추가 (사용자 요청 2026-05-21).
       * duration 700ms — autosave 토스트는 짧게 (사용자 요청 2026-05-21). */
      const _toastMsg = initialEntry ? ('"'+val+'" 수정됨') : ('"'+val+'" 추가됨');
      bus.emit('toast:show', {text: _toastMsg, duration: 700});
    }
    if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
    document.removeEventListener('click',_outside,true);
  }
  /* ESC 호출 — 입력 중 변경분 롤백 + DB 까지 원상복구 commit. dock 닫기. (사용자 요청 2026-05-30 — 디바운스가 이미 _symAutoSave 했을 수 있어 롤백 상태도 DB 에 다시 저장 필요.) */
  function _cancel(){
    if(settled)return;settled=true;
    if(_rafId){ cancelAnimationFrame(_rafId); _rafId=null; }
    if(_ftInputDebounce){ clearTimeout(_ftInputDebounce); _ftInputDebounce=null; }
    dock.style.opacity='0';dock.style.transform='scaleY(0.2) translateY(-10px)';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},220);
    /* in-memory 롤백 — _t(현재 처치 배열) 와 flat(_symSelectedTreatments) 을 입력 이전으로. */
    const _t=_ftTarget();
    _t.length=0;
    _initialT.forEach(function(x){ _t.push(x); });
    _symSelectedTreatments.length=0;
    _initialSelectedTreatments.forEach(function(x){ _symSelectedTreatments.push(x); });
    if(_useBySym && typeof _symRecomputeFlatTreatments==='function') _symRecomputeFlatTreatments();
    /* 입력 중 디바운스가 이미 _symAutoSave 했을 수 있으므로 롤백 상태를 DB 에 다시 commit. */
    _symAutoSave();
    if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
    document.removeEventListener('click',_outside,true);
  }
  function _outside(ev){
    if(!dock.contains(ev.target)&&ev.target!==anchorChip&&!anchorChip.contains(ev.target)){_save();}
  }
  /* 실시간 반영: input 마다 _symSelectedTreatments 갱신 + 선택된 처치 영역 즉시 갱신.
   * _curEntry 로 이전 입력값 추적 → 기존 칩 in-place 갱신/삭제.
   * 칩이 없거나 placeholder 상태면 전체 재렌더 + dock 재현 (포커스·커서 보존).
   * initialEntry 받아 재귀 호출 시 이전 값 seed (없으면 매번 새 push 되어 칩이 누적됨). */
  let _curEntry=initialEntry||'';
  if(initialEntry){inp.value=initialEntry;}
  /* v3 (사용자 결정 2026-05-21) — 디바운스 + sumWrap 검색 정확도 보강.
   *  · 옛 코드: 매 input 이벤트마다 _symRecomputeFlatTreatments + _symAutoSave + _symRenderTreatPanel 호출 →
   *    panel.innerHTML 전체 교체가 한국어 IME 매 자모마다 발생 → 심각한 입력 지연.
   *  · v3 200ms: DOM in-place 즉시 갱신 + 무거운 작업(recompute/save/render)은 디바운스.
   *  · v4 800ms (사용자 보고 2026-05-21 — 펜 클릭 자유 기술 입력 지연):
   *    한국어 IME 자모 간격이 200ms 를 자주 넘어 정상 타이핑 중에도 디바운스 발화 → autosave 의 JSON.stringify x6 + 깊은 복사 x3 + bus.emit 4종 캐스케이드 (render:daily, render:dashboard, render:stats, ems:refresh) 가 UI 를 짧게 freeze.
   *    800ms 로 늘려 자연스러운 타이핑 중에는 발화 안 함. dock 닫힘 시 _save() → _symAutoSave() 가 어차피 호출되므로 데이터 손실 0. */
  /* _ftInputDebounce 는 _save 정의 직전에 이미 선언됨. _ftBlockPair 도 함수 상단(dock 생성 직전) 에서 선언됨. */
  inp.addEventListener('input',function(){
    _autoSize();
    const val=inp.value.trim();
    const oldEntry=_curEntry;
    const _t=_ftTarget();
    if(oldEntry){
      const oldIdx=_t.indexOf(oldEntry);
      if(oldIdx!==-1){
        if(val)_t[oldIdx]=val;
        else _t.splice(oldIdx,1);
      } else if(val && _t.indexOf(val)===-1){
        _t.push(val);
      }
    } else if(val && _t.indexOf(val)===-1){
      _t.push(val);
    }
    /* 사용자 보고 2026-05-22 — sym-key 모드에서 flat(_symSelectedTreatments) 에도 동일 갱신/제거 동기.
     *  타이핑 중 800ms 멈춤으로 디바운스가 발동하면 _symRecomputeFlatTreatments 가 호출되어 in-progress 값이 flat 에 들어감.
     *  그 다음 타이핑 재개 시 _t (by-sym) 만 in-place 갱신되고 flat 은 그대로 → 다음 디바운스에서 flat 의 옛 in-progress 값이
     *  legacyFreeText 로 잘못 분류·보존되어 일반일지·사이드바에 누적 중복 표시되는 회귀.
     *  input 이벤트마다 flat 도 같이 갱신/제거하여 디바운스 호출 시 깨끗한 상태 보장. */
    if(_useBySym && oldEntry){
      const _flatOldIdx = _symSelectedTreatments.indexOf(oldEntry);
      if(_flatOldIdx !== -1){
        if(val) _symSelectedTreatments[_flatOldIdx] = val;
        else _symSelectedTreatments.splice(_flatOldIdx, 1);
      }
    }
    _curEntry=val;
    /* DOM 즉시 in-place 갱신 — anchor 의 블록 안 sumWrap 우선 (sym-key 별 정확) */
    const sumWrap = (_ftBlockPair ? _ftBlockPair.querySelector('.sym-sum-wrap') : null) || document.querySelector('.sym-sum-wrap');
    let _chipUpdated = false;
    if(oldEntry && sumWrap){
      const escSel=oldEntry.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
      const chip=sumWrap.querySelector('.sym-treat-chip[data-treat="'+escSel+'"]');
      if(chip){
        if(val){
          chip.dataset.treat=val;
          const delBtn=chip.querySelector('.sym-chip-del');
          if(delBtn)delBtn.dataset.treat=val;
          for(let n=chip.firstChild;n;n=n.nextSibling){
            if(n.nodeType===Node.TEXT_NODE){n.nodeValue=val;break;}
          }
        } else {
          chip.remove();
        }
        _chipUpdated = true;
      }
    }
    /* 무거운 작업 (recompute + autosave + panel render) 디바운스 — 입력 끝나면 한 번만.
     * 800ms — 한국어 IME 자모 간격(보통 100~300ms)보다 충분히 길어 정상 타이핑 중 발화 안 함. */
    if(_ftInputDebounce) clearTimeout(_ftInputDebounce);
    _ftInputDebounce = setTimeout(function(){
      _ftInputDebounce = null;
      if(_useBySym && typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
      _symAutoSave();
      /* in-place 갱신 성공하면 panel 재렌더 불필요 (사용자 체감 부드러움 + 속도 ↑) */
      if(!_chipUpdated && typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
    }, 800);
  });
  inp.addEventListener('keydown',function(e){
    /* Shift+Enter = 줄바꿈(textarea 기본 동작 유지), Enter 단독 = 저장, Esc = 저장 안 하고 종료(사용자 요청 2026-05-30 — 디바운스 자동저장 분도 DB 롤백).
     * ESC 는 stopPropagation — _symKeyNav 가 ESC 를 받아 전체 증상 팝업까지 닫는 것 방지. */
    if(e.key==='Enter' && !e.shiftKey){e.preventDefault();_save();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_cancel();}
  });
  /* 외부 클릭 감지 — capture 단계로 (다른 핸들러보다 먼저 실행) */
  setTimeout(function(){document.addEventListener('click',_outside,true);},50);
}

/* ── Phase 3d Section E: 증상 자유 기입 미니 팝업 ──
 *  · 증상 카테고리 목록 하단 ✏️ 자유 기입 칩 클릭으로 호출
 *  · rec.symptoms 에 자유 서술 항목 push (NEIS 표기 그대로)
 *  · _curEntry seed (initialEntry) 로 재귀 호출 시 칩 누적 방지
 *  · 실시간 반영: 선택 증상 영역 in-place 갱신, 없으면 패널 재렌더 + dock 재현 */
function _symOpenSymFreeTextDock(recId,anchorChip,initialEntry,catId){
  /* 모달 열기 직전 미니 팝업 즉시 닫기 — 모달 아래로 설명이 겹치지 않게. (사용자 요청 2026-05-19) */
  if(typeof hideHeaderTooltip==='function')try{hideHeaderTooltip();}catch(_){}
  const existing=document.getElementById('symFreeDock');
  /* 기존 dock 이 같은 칩(같은 cat)에서 열려있으면 토글 close, 아니면 닫고 새로 열기 */
  if(existing){
    const _prevCat=existing.dataset.cat||'';
    existing.remove();
    if(_prevCat===(catId||'') && !initialEntry) return;
  }
  /* anchorChip 가 stale(detached) 면 좌표가 0/0 으로 잡혀 dock 이 좌상단에 뜨는 문제 — 현재 DOM 에서 재조회 */
  const _ftCatId=catId||'';
  const _ftCatKey=recId+'::'+_ftCatId;
  /* ESC 취소용 초기 상태 스냅샷 — 입력 시작 전 _symSelectedSymptoms 와 _symFreeTextByCat[_ftCatKey] 보관 (사용자 요청 2026-05-30 — ESC = 저장 안 함). */
  const _initialSelectedSymptoms = _symSelectedSymptoms.slice();
  const _initialHadFt = Object.prototype.hasOwnProperty.call(_symFreeTextByCat, _ftCatKey);
  const _initialFreeText = _initialHadFt ? _symFreeTextByCat[_ftCatKey] : null;
  if(_ftCatId){
    const _fresh=document.querySelector('[data-action="openSymFreeText"][data-cat="'+_ftCatId.replace(/"/g,'\\"')+'"]');
    if(_fresh) anchorChip=_fresh;
  }
  /* 사용자 요청 — dock 을 처치 영역 위로 올리기 위해 position:fixed + body append. anchor 좌표 기준 배치.
   * CSS zoom 보정 — 100% 가 아닐 때 dock 이 어긋나는 문제 방지. */
  let _zf=1;
  try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
  let _r=(anchorChip&&anchorChip.isConnected)?anchorChip.getBoundingClientRect():{left:0,top:0,bottom:0,width:0,height:0};
  if(_r.width===0&&_r.height===0){
    /* anchor 가 detached 라도 dock 이 좌상단에 뜨지 않게 fallback */
    const _ov=document.getElementById('symCatOverlay');
    if(_ov){const _ovR=_ov.getBoundingClientRect();_r={left:_ovR.left+24,top:_ovR.bottom-100,bottom:_ovR.bottom-80,width:0,height:0};}
  }
  /* 초기 좌표는 0,0 — _updatePos() 가 anchor 우상단에 정확히 재배치 (사용자 요청 2026-05-28). */
  const dock=document.createElement('div');
  dock.id='symFreeDock';
  dock.dataset.cat=_ftCatId;
  /* align-items:flex-start — textarea 가 여러 줄로 늘 때 label·버튼이 윗변 정렬. visibility:hidden 으로 좌표 계산 전 깜빡임 차단. */
  dock.style.cssText='position:fixed;left:0;top:0;z-index:12000;background:var(--card);border:1.5px solid rgba(251,191,36,0.7);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:9px;width:520px;max-width:92vw;box-shadow:0 6px 18px rgba(0,0,0,0.45);cursor:default;opacity:0;visibility:hidden;transition:opacity 0.18s ease';
  /* 입력란 오른편에 🧍 바디맵 버튼 — 입력 후 부위 추가 진입 (사용자 요청 2026-05-19).
   *  input → textarea: 줄이 길어지면 dock 세로 늘어남 (사용자 요청 2026-05-28). */
  dock.innerHTML='<span style="font-size:14px;font-weight:800;color:#d97706;white-space:nowrap;padding-top:6px">✏️ 증상 자유 기술 :</span>'
    +'<textarea id="symFreeSymInput" rows="1" placeholder="입력 즉시 자동 저장됩니다... (Enter, 이 팝업 외부 클릭: 저장)(ESC: 이 팝업 종료하되 저장 X)" style="flex:1;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:8px 12px;color:var(--t1);font-size:14px;outline:none;font-family:var(--f);resize:none;overflow-y:auto;line-height:1.5;min-height:36px;max-height:240px;box-sizing:border-box"></textarea>'
    +'<button id="symFreeSymBmBtn" type="button" data-tooltip="입력한 증상에 부위(바디맵) 추가" data-tooltip-instant="1" style="flex-shrink:0;font-size:18px;line-height:1;padding:6px 10px;border-radius:8px;border:1.5px solid #a855f7;background:rgba(168,85,247,0.10);color:#a855f7;cursor:pointer;font-family:var(--f)">🧍</button>';
  document.body.appendChild(dock);
  /* 자유 기술 dock 내부의 미니 팝업도 통합 GUI 사용 — 🧍 부위 추가 버튼 호버 등. */
  _symBindTipDelegation(dock);
  const inp=dock.querySelector('#symFreeSymInput');
  function _autoSize(){
    inp.style.height='auto';
    inp.style.height=Math.min(inp.scrollHeight, 240)+'px';
  }
  /* rAF loop: anchor 우상단에 dock 추적 (스크롤·zoom·anchor 위치 변화 대응, 사용자 보고 2026-05-28). */
  let _rafId=null;
  function _updatePos(){
    if(!dock.isConnected){ if(_rafId) cancelAnimationFrame(_rafId); _rafId=null; return; }
    if(anchorChip && anchorChip.isConnected){
      const _r=anchorChip.getBoundingClientRect();
      const _dh=dock.offsetHeight||0;
      const _dw=dock.offsetWidth||520;
      const _vw=window.innerWidth/_zf;
      const _vh=window.innerHeight/_zf;
      let _lf=_r.right/_zf;
      let _tp=(_r.top - _dh - 6)/_zf;
      if(_lf + _dw > _vw - 8) _lf = Math.max(8, _r.left/_zf);
      if(_lf + _dw > _vw - 8) _lf = Math.max(8, _vw - _dw - 8);
      if(_tp < 8) _tp=(_r.bottom + 6)/_zf;
      if(_tp + _dh > _vh - 8) _tp = Math.max(8, _vh - _dh - 8);
      dock.style.left=_lf+'px';
      dock.style.top=_tp+'px';
    }
    _rafId=requestAnimationFrame(_updatePos);
  }
  requestAnimationFrame(function(){
    _autoSize();
    _updatePos();
    dock.style.visibility='visible';
    dock.style.opacity='1';
    /* dock 가 보인 뒤 포커스 — visibility:hidden 상태에선 focus() 가 안 먹어 칩 클릭 후 입력란을 또 눌러야 했음 (사용자 보고 2026-05-30). */
    try{ inp.focus(); if(initialEntry) inp.select(); }catch(_){}
  });
  const bmBtnEl=dock.querySelector('#symFreeSymBmBtn');
  if(bmBtnEl){
    bmBtnEl.addEventListener('click',function(ev){
      ev.stopPropagation();
      const _v=(inp.value||'').trim();
      if(!_v){
        bus.emit('toast:show',{text:'자유 서술을 먼저 입력하세요.'});
        inp.focus();return;
      }
      /* 1) 현재 입력값을 _symSelectedSymptoms / 캐시에 반영 (input 이벤트와 동일 효과) — _symAutoSave 호출 흐름은 _save 안에서 처리되므로 여기서는 dock 만 닫고 바디맵 진입.
       *  base 추출 후 _symOpenBmForSym 호출. */
      const _bmBase=_v.match(/^(.+?)\s*\(/)?_v.match(/^(.+?)\s*\(/)[1].trim():_v;
      /* 직접 _save() 로 마무리 (textarea 값 저장 + dock 제거 + 패널 재렌더) 후 바디맵 열기 */
      _save();
      setTimeout(function(){
        try{_symOpenBmForSym(recId, _bmBase);}catch(_){}
      },200);
    });
  }
  let _curEntry=initialEntry||'';
  if(initialEntry){inp.value=initialEntry;inp.select();}
  inp.focus();
  let settled=false;
  /* _symFtInputDebounce 는 _save 안에서 cancel 해야 하므로 함수 정의 전에 선언 (TDZ 회피). */
  let _symFtInputDebounce = null;
  function _save(){
    if(settled)return;settled=true;
    /* rAF loop 중단 */
    if(_rafId){ cancelAnimationFrame(_rafId); _rafId=null; }
    /* 살아있는 디바운스 즉시 cancel — 아래에서 _symAutoSave 를 직접 호출하므로 중복 방지 (사용자 보고 2026-05-21 — 자동 저장 보장 검증). */
    if(_symFtInputDebounce){ clearTimeout(_symFtInputDebounce); _symFtInputDebounce = null; }
    /* fade-out 동안 같은 칩 재클릭 시 토글-close 분기 차단 */
    dock.id='';
    const val=inp.value.trim();
    dock.style.opacity='0';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},180);
    /* 카테고리별 마지막 텍스트 저장 — 다음 클릭 시 pre-populate 용 */
    if(_ftCatId){
      if(val) _symFreeTextByCat[_ftCatKey]=val;
      else delete _symFreeTextByCat[_ftCatKey];
    }
    _symAutoSave();
    /* ★ 자유기입 커밋 후 처치 패널 즉시 렌더 — 입력 중 디바운스 렌더가 _save 진입 때 취소되므로
     *  여기서 직접 그려야 '선택한 증상에 대한 처치' 블록이 뜬다. (사용자 보고 2026-06-17: 엔터/외부클릭 시 처치 안 뜸) */
    if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
    /* 칩 자체에 cyan/녹색 상태 반영 위해 중분류 패널 재렌더 */
    const _activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
    if(_activeArrow && typeof _symSelectCat==='function') _symSelectCat(_activeArrow.parentElement.dataset.cat);
    /* 사용자 보고 2026-05-22 — 활성 카테고리가 없을 때 _symSelectCat 미호출 → _symUpdateCatHighlights 누락.
     *  자유 기입 후에는 무조건 카테고리 카운트 배지 갱신해야 함. 안전망 직접 호출. */
    if(typeof _symUpdateCatHighlights === 'function') _symUpdateCatHighlights();
    /* initialEntry 가 있으면 펜 클릭으로 기존 자유 서술 수정, 없으면 신규 추가 (사용자 요청 2026-05-21).
     * duration 700ms — autosave 토스트는 짧게. */
    if(val){
      const _toastMsg = initialEntry ? ('"'+val+'" 증상 수정됨') : ('"'+val+'" 증상 추가됨');
      bus.emit('toast:show', {text: _toastMsg, duration: 700});
    }
    document.removeEventListener('click',_outside,true);
  }
  /* ESC 호출 — 저장 없이 인메모리·캐시 원상복구 후 dock 닫기. _symAutoSave 호출 안 함 → DB·일지 변경 X. (사용자 요청 2026-05-30) */
  function _cancel(){
    if(settled)return;settled=true;
    if(_rafId){ cancelAnimationFrame(_rafId); _rafId=null; }
    if(_symFtInputDebounce){ clearTimeout(_symFtInputDebounce); _symFtInputDebounce=null; }
    dock.id='';
    dock.style.opacity='0';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},180);
    /* in-memory 롤백 — 입력 중 변경된 _symSelectedSymptoms 와 _symFreeTextByCat 을 원상태로. */
    _symSelectedSymptoms.length=0;
    _initialSelectedSymptoms.forEach(function(s){ _symSelectedSymptoms.push(s); });
    if(_ftCatId){
      if(_initialHadFt) _symFreeTextByCat[_ftCatKey]=_initialFreeText;
      else delete _symFreeTextByCat[_ftCatKey];
      if(typeof _symPersistFreeTextByCat==='function') _symPersistFreeTextByCat();
    }
    /* DB·일지 반영 X — _symAutoSave 호출 안 함. 화면만 원상태로 재렌더. */
    const _activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
    if(_activeArrow && typeof _symSelectCat==='function') _symSelectCat(_activeArrow.parentElement.dataset.cat);
    if(typeof _symUpdateCatHighlights === 'function') _symUpdateCatHighlights();
    if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
    const cnt=document.getElementById('symSelCount');
    if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    document.removeEventListener('click',_outside,true);
  }
  function _outside(ev){
    if(!dock.contains(ev.target)&&ev.target!==anchorChip&&!anchorChip.contains(ev.target)){_save();}
  }
  /* 실시간 반영 — 깜빡임 차단: dock 은 body 에 fixed 로 떠 있으므로 처치 패널을 in-place 재렌더해도
   * dock 은 영향 안 받음.
   * v3 (사용자 결정 2026-05-21) — 매 키스트로크마다 _symRenderTreatPanel (panel.innerHTML 통째 교체) 호출하던
   * 회귀를 200ms 디바운스로 완화. 한국어 IME 입력 시 심각한 지연 해소.
   * _symFtInputDebounce 는 _save 정의 직전에 이미 선언됨. */
  inp.addEventListener('input',function(){
    _autoSize();
    const val=inp.value.trim();
    const oldEntry=_curEntry;
    if(oldEntry){
      const oldIdx=_symSelectedSymptoms.indexOf(oldEntry);
      if(oldIdx!==-1){
        if(val)_symSelectedSymptoms[oldIdx]=val;
        else _symSelectedSymptoms.splice(oldIdx,1);
      } else if(val && _symSelectedSymptoms.indexOf(val)===-1){
        _symSelectedSymptoms.push(val);
      }
    } else if(val && _symSelectedSymptoms.indexOf(val)===-1){
      _symSelectedSymptoms.push(val);
    }
    _curEntry=val;
    /* 카테고리별 마지막 텍스트 캐시 즉시 갱신 (자유 기입 칩 라벨 동기화용) + localStorage 영구 저장 */
    if(_ftCatId){
      if(val) _symFreeTextByCat[_ftCatKey]=val;
      else delete _symFreeTextByCat[_ftCatKey];
      if(typeof _symPersistFreeTextByCat==='function') _symPersistFreeTextByCat();
    }
    /* 사용자 보고 2026-05-22 — 자유 기입 input 마다 카테고리 카운트 배지 즉시 갱신.
     *  _save 까지 안 가도 카운트 보이게 (사용자가 dock 안 닫은 채 카운트 확인하는 케이스). */
    if(typeof _symUpdateCatHighlights==='function') _symUpdateCatHighlights();
    const cnt=document.getElementById('symSelCount');
    if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    /* 무거운 작업 (panel 재렌더) 디바운스 — 입력 끝난 후만 호출.
     * 800ms — 처치 자유 기술 dock 과 동일 사유 (한국어 IME 지연 해소, 2026-05-21). */
    if(_symFtInputDebounce) clearTimeout(_symFtInputDebounce);
    _symFtInputDebounce = setTimeout(function(){
      _symFtInputDebounce = null;
      if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
    }, 800);
  });
  inp.addEventListener('keydown',function(e){
    /* Shift+Enter = 줄바꿈(textarea 기본 동작), Enter 단독 = 저장, Esc = 저장 안 하고 종료(사용자 요청 2026-05-30 — 자동저장 분도 인메모리·캐시 롤백).
     * ESC 는 stopPropagation — _symKeyNav 가 ESC 를 받아 전체 증상 팝업까지 닫는 것 방지. */
    if(e.key==='Enter' && !e.shiftKey){e.preventDefault();_save();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_cancel();}
  });
  setTimeout(function(){document.addEventListener('click',_outside,true);},50);
}

/* ── Phase 3c: 자주 쓰는 처치 칩 메모 입력 미니 팝업 ──
 *  · 칩 ✏️ 펜 클릭 또는 칩 더블클릭으로 호출
 *  · rec.treatment 의 해당 항목을 "처치명 (메모)" 로 갱신 (없으면 추가)
 *  · base name 매칭 — 칩 라벨에 (메모) 가 붙어있어도 base name 으로 찾음
 *  · 자동 저장 (외부 클릭 / Enter / ESC)
 *  · 메모 비우면 "(메모)" 부분 제거 (base name 만 남김) */
function _symOpenTreatMemoDock(recId,baseName,anchorChip,symKey){
  /* v3 — sym-key 모드 판정 (사용자 결정 2026-05-21).
   *  · legacy('__legacy__') 또는 symKey 없음 → flat 만 갱신 (옛 일지 동작 유지).
   *  · 그 외 → 클릭한 블록의 sym-key 의 _symTreatmentsBySym[symKey] 에서만 base 매칭 처치 라벨을 갱신.
   *    다른 블록의 같은 base 처치는 독립적으로 메모 입력 가능. */
  const _useBySym = !!(symKey && symKey !== '__legacy__');
  const _symKeyStr = symKey || '';
  /* 토글: 이미 열려있고 (base, sym-key) 쌍이 같으면 닫고 종료. 다른 (base 또는 sym-key) 면 닫고 새로 열기.
   * 옛 코드에서 baseName 만 비교하던 회귀 fix — 같은 base 처치가 두 블록에 있을 때 두번째 펜 클릭이 닫혀버렸던 문제. */
  const existing=document.getElementById('symFreeDock');
  if(existing){
    const prevName=existing.dataset.treat;
    const prevSymKey=existing.dataset.symKey||'';
    existing.remove();
    if(prevName===baseName && prevSymKey===_symKeyStr)return;
  }
  /* 기존 메모 추출 (있으면 input value 에 미리 채움).
   * v3 — sym-key 모드면 _symTreatmentsBySym[symKey] 의 매칭 항목에서 추출.
   *      legacy 모드는 flat 에서 추출 (옛 동작). */
  let curMemo='';
  if(_useBySym){
    const _arr=_symTreatmentsBySym[_symKeyStr]||[];
    const _v=_arr.find(function(x){return x===baseName||x.indexOf(baseName+'(')===0||x.indexOf(baseName+' (')===0;});
    if(_v && _v!==baseName){const _m=_v.match(/^(.+?)\s*\((.*)\)\s*$/);if(_m)curMemo=_m[2];}
  } else {
    const matchIdx=_symFindTreatIdx(baseName);
    if(matchIdx!==-1){
      const v=_symSelectedTreatments[matchIdx];
      if(v!==baseName){const _m=v.match(/^(.+?)\s*\((.*)\)\s*$/);if(_m)curMemo=_m[2];}
    }
  }
  const dock=document.createElement('div');
  dock.id='symFreeDock';
  dock.dataset.treat=baseName;
  dock.dataset.symKey=_symKeyStr;   /* v3 — 토글 비교 + DOM selector 정확도용 */
  /* 사용자 요청 — 처치 팝업 우측 테두리에 딱 붙지 않고, 칩 위쪽에 떠 있되 팝업 경계 바깥으로 나가도 됨.
   * 처치 자유 기입 dock 과 동일한 크기/패딩/폰트 (width 520px, padding 12/14, 14px).
   * position:fixed + document.body append → 부모 overflow 영향 제거, 전 화면 좌표로 자유 배치. */
  dock.style.cssText='position:fixed;left:0;top:0;z-index:12000;background:var(--card);border:1.5px solid rgba(251,191,36,0.7);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:9px;width:520px;max-width:92vw;box-shadow:0 6px 18px rgba(0,0,0,0.45);cursor:default;visibility:hidden;transform-origin:top left;transition:opacity 0.22s ease, transform 0.25s cubic-bezier(0.16,1,0.3,1)';
  /* 처치/증상 자유 기술 dock 과 동일 — textarea + 자동 높이(세로 확대) + 자동 저장 안내 placeholder (사용자 요청 2026-06-02). */
  dock.innerHTML='<span style="font-size:14px;font-weight:800;color:#d97706;white-space:nowrap;padding-top:6px">✏️ "'+escHtml(baseName)+'" 자유 기술 :</span>'
    +'<textarea id="symTreatMemoInput" rows="1" placeholder="입력 즉시 자동 저장됩니다... (Enter, 이 팝업 외부 클릭: 저장)(ESC: 이 팝업 종료하되 저장 X)" style="flex:1;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:8px 12px;color:var(--t1);font-size:14px;outline:none;font-family:var(--f);resize:none;overflow-y:auto;line-height:1.5;min-height:36px;max-height:240px;box-sizing:border-box"></textarea>';
  document.body.appendChild(dock);
  /* anchor 기준 좌표 — 칩 위쪽에 4px 띄움. 좌우는 anchor.left 기준, 화면 밖 안 나가게만 clamp.
   * CSS zoom 보정 — 100% 가 아닐 때 dock 이 우측으로 어긋나는 문제 방지. */
  let _zf=1;
  try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
  const _arRaw=(anchorChip&&anchorChip.isConnected)?anchorChip.getBoundingClientRect():{left:0,top:0,bottom:0};
  const _ar={left:_arRaw.left/_zf, top:_arRaw.top/_zf, bottom:_arRaw.bottom/_zf};
  const _vw=window.innerWidth/_zf;
  const _dw=dock.offsetWidth||520, _dh=dock.offsetHeight||56;
  let _lf=_ar.left;
  if(_lf+_dw>_vw-8)_lf=Math.max(8,_vw-_dw-8);
  if(_lf<8)_lf=8;
  let _tp=_ar.top-_dh-6;
  if(_tp<8)_tp=(_ar.bottom||0)+6; /* 위쪽 공간 부족 시 아래로 폴백 */
  dock.style.left=_lf+'px';
  dock.style.top=_tp+'px';
  dock.style.visibility='';
  const inp=dock.querySelector('#symTreatMemoInput');
  /* textarea 자동 높이 — 입력마다 scrollHeight 기준 재계산 (max 240px 후엔 자체 스크롤). 처치 자유 기술 dock 과 동일. */
  function _autoSize(){ inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,240)+'px'; }
  /* 명시적으로 value 재설정 (HTML attribute 만 의존하지 않음) + 블록 선택 */
  inp.value=curMemo;
  _autoSize();
  setTimeout(function(){
    inp.focus();
    try{inp.setSelectionRange(0,(inp.value||'').length);}catch(_){ inp.select(); }
  },0);
  /* ESC 취소용 초기 상태 스냅샷 — 입력 시작 전 처치 배열 보관 (ESC = 저장 안 함, 처치 자유 기술 dock 과 동일). */
  const _initialSelTreat=_symSelectedTreatments.slice();
  const _initialTreatArr=_useBySym?((_symTreatmentsBySym[_symKeyStr]||[]).slice()):null;
  let settled=false;
  function _save(){
    if(settled)return;settled=true;
    /* fade-out 동안 같은 칩 재클릭 시 토글-close 분기 차단 */
    dock.id='';
    const memo=inp.value.trim();
    /* 닫기 애니메이션 — 증상 dock·자유 기술 dock 과 동일 (fade + scaleY, 220ms). */
    dock.style.opacity='0';dock.style.transform='scaleY(0.2) translateY(-10px)';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},220);
    /* rec.treatment 업데이트 — 메모 있으면 "(메모)" 부착, 없으면 base name */
    const newVal=memo?(baseName+' ('+memo+')'):baseName;
    /* v3 — sym-key 모드: 클릭한 블록의 _symTreatmentsBySym[symKey] 의 base 매칭 항목만 갱신.
     *      다른 블록의 같은 base 처치는 독립 유지. recompute 로 flat 동기.
     *      legacy 모드: 옛 동작 그대로 flat 만 갱신. */
    if(_useBySym){
      if(!_symTreatmentsBySym[_symKeyStr])_symTreatmentsBySym[_symKeyStr]=[];
      const arr=_symTreatmentsBySym[_symKeyStr];
      const _mi=arr.findIndex(function(x){return x===baseName||x.indexOf(baseName+'(')===0||x.indexOf(baseName+' (')===0;});
      if(_mi===-1)arr.push(newVal);
      else arr[_mi]=newVal;
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    } else {
      const idx=_symFindTreatIdx(baseName);
      if(idx===-1)_symSelectedTreatments.push(newVal);
      else _symSelectedTreatments[idx]=newVal;
    }
    _symAutoSave();
    /* 중앙 안내 토스트 제거 — 우하단 autosave 토스트로 충분 (사용자 요청). */
    if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
    document.removeEventListener('click',_outside,true);
  }
  /* ESC — 입력 중 변경분 롤백 + DB 원상복구 commit 후 닫기 (저장 X). 처치 자유 기술 dock 과 동일. */
  function _cancel(){
    if(settled)return;settled=true;
    dock.id='';
    if(_memoInputDebounce){ clearTimeout(_memoInputDebounce); _memoInputDebounce=null; }
    /* 닫기 애니메이션 — 증상 dock·자유 기술 dock 과 동일 (fade + scaleY, 220ms). */
    dock.style.opacity='0';dock.style.transform='scaleY(0.2) translateY(-10px)';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},220);
    if(_useBySym){
      _symTreatmentsBySym[_symKeyStr]=_initialTreatArr?_initialTreatArr.slice():[];
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    } else {
      _symSelectedTreatments.length=0;
      _initialSelTreat.forEach(function(x){_symSelectedTreatments.push(x);});
    }
    _symAutoSave();
    if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
    document.removeEventListener('click',_outside,true);
  }
  function _outside(ev){
    if(!dock.contains(ev.target)&&ev.target!==anchorChip&&!anchorChip.contains(ev.target)){_save();}
  }
  /* 실시간 반영: input 마다 _symSelectedTreatments 갱신 + 선택된 처치 영역의 칩 텍스트 즉시 교체.
   * 칩이 아직 없으면 (메모로 첫 push) 전체 재렌더 후 dock 재현 — 입력값·커서 보존.
   * v3 (사용자 결정 2026-05-21) — 매 키스트로크마다 _symAutoSave + _symRenderTreatPanel 호출하던 회귀를 200ms 디바운스로 완화.
   * 데이터 갱신·in-place chip 텍스트 변경은 즉시, 무거운 작업은 디바운스. */
  let _memoInputDebounce = null;
  inp.addEventListener('input',function(){
    _autoSize();
    const memo=inp.value.trim();
    const newVal=memo?(baseName+' ('+memo+')'):baseName;
    let wasSelected;
    if(_useBySym){
      if(!_symTreatmentsBySym[_symKeyStr])_symTreatmentsBySym[_symKeyStr]=[];
      const arr=_symTreatmentsBySym[_symKeyStr];
      const _mi=arr.findIndex(function(x){return x===baseName||x.indexOf(baseName+'(')===0||x.indexOf(baseName+' (')===0;});
      wasSelected=_mi!==-1;
      if(_mi===-1)arr.push(newVal);
      else arr[_mi]=newVal;
      if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
    } else {
      const idx=_symFindTreatIdx(baseName);
      wasSelected=idx!==-1;
      if(idx===-1)_symSelectedTreatments.push(newVal);
      else _symSelectedTreatments[idx]=newVal;
    }
    if(wasSelected){
      /* DOM in-place 갱신 — sym-key 모드일 때 그 블록 안 chip 만 정확히 찾아 갱신 (즉시).
       * 같은 base 처치가 여러 블록에 있을 때 다른 블록의 chip 을 잘못 갱신하던 회귀 fix. */
      const _bnEsc=baseName.replace(/"/g,'\\"');
      const _skEsc=_symKeyStr.replace(/"/g,'\\"');
      const _root = _useBySym
        ? document.querySelector('.sym-block-pair[data-sym-key="'+_skEsc+'"]')
        : document;
      if(_root){
        const sumWrap=_root.querySelector('.sym-sum-wrap');
        if(sumWrap){
          const _selChip = _useBySym
            ? '.sym-treat-chip[data-treat="'+_bnEsc+'"][data-sym-key="'+_skEsc+'"]'
            : '.sym-treat-chip[data-treat="'+_bnEsc+'"]';
          const chip=sumWrap.querySelector(_selChip);
          if(chip){
            for(let n=chip.firstChild;n;n=n.nextSibling){
              if(n.nodeType===Node.TEXT_NODE){n.nodeValue=newVal;break;}
            }
          }
        }
      }
      /* v3 — 무거운 작업(autosave)은 디바운스로 입력 끝난 후만 한 번 */
      if(_memoInputDebounce) clearTimeout(_memoInputDebounce);
      _memoInputDebounce = setTimeout(function(){
        _memoInputDebounce = null;
        _symAutoSave();
      }, 200);
    } else {
      /* 새로 선택됨 — 디바운스 후 panel 재렌더 + dock 재현 (sym-key 도 함께 전달해 정확한 블록 anchor 회복).
       * v3 — 200ms 디바운스로 사용자가 빠르게 타이핑할 때 매 자모마다 dock 재생성하던 깜빡임 차단. */
      if(_memoInputDebounce) clearTimeout(_memoInputDebounce);
      const _curVal=inp.value;
      const _selS=inp.selectionStart||_curVal.length, _selE=inp.selectionEnd||_curVal.length;
      _memoInputDebounce = setTimeout(function(){
        _memoInputDebounce = null;
        settled=true;
        document.removeEventListener('click',_outside,true);
        _symAutoSave();
        if(dock.parentNode)dock.parentNode.removeChild(dock);
        _symRenderTreatPanel(recId);
      const _bnEsc2=baseName.replace(/"/g,'\\"');
      const _skEsc2=_symKeyStr.replace(/"/g,'\\"');
      const _navSel = _useBySym
        ? '.sym-fav-chip[data-treat="'+_bnEsc2+'"][data-sym-key="'+_skEsc2+'"]'
        : '.sym-fav-chip[data-treat="'+_bnEsc2+'"]';
      const newAnchor=document.querySelector(_navSel);
      if(newAnchor){
        const wrap=newAnchor.closest('.sym-fav-wrap')||newAnchor;
        _symOpenTreatMemoDock(recId,baseName,wrap,_symKeyStr);
        const newInp=document.getElementById('symTreatMemoInput');
        if(newInp){
          newInp.value=_curVal;
          newInp.focus();
          try{newInp.setSelectionRange(_selS,_selE);}catch(e){}
        }
      }
      }, 200);  /* v3 — 디바운스 setTimeout 닫기 */
    }
  });
  inp.addEventListener('keydown',function(e){
    /* Enter 단독 = 저장, Shift+Enter = 줄바꿈, ESC = 저장 안 하고 종료(롤백). 처치 자유 기술 dock 과 동일.
     * ESC stopPropagation — _symKeyNav 가 ESC 로 전체 증상 팝업까지 닫는 것 방지. */
    if(e.key==='Enter' && !e.shiftKey){e.preventDefault();_save();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_cancel();}
  });
  setTimeout(function(){document.addEventListener('click',_outside,true);},50);
}

/* ── 사용자 요청 2026-06-05: 처치 패널 메모 노트의 ✕ → 그 증상의 자유 기술(메모)만 삭제 ──
 *  · 중분류 증상의 메모(자유 기술)와 동일 데이터이므로 연동 삭제됨 (펜 테두리도 자동 해제).
 *  · 바디맵 부위는 보존, 증상 선택 자체는 유지 — 메모만 비운다. */
function _symClearSymMemo(recId, baseName){
  const idx=_symFindSymIdx(baseName);
  if(idx===-1)return;
  /* 메모 캐시만 비운다. 라벨 재구성(부위만 남김) + 처치·약품·도즈 맵 키 이전은
   * _symAutoSave → _symRebuildAllSymLabels(→_symMigrateSymMaps) 가 일괄 처리한다.
   * ※ 여기서 _symSelectedSymptoms[idx] 를 미리 바꾸면 rebuild 의 키 이전 탐지(newLabel!==cur)가 무력화되어
   *   처치·약품이 옛 라벨에 고아로 남는다 → 절대 사전 변경하지 말 것 (검증 2026-06-05). */
  _symSymMemoCache[_symSymMemoKey(recId, baseName)]='';
  _symAutoSave();
  /* 좌측 중분류 칩(펜 테두리) + 처치 패널 + 카테고리 배지 동기 갱신 */
  const activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
  if(activeArrow && activeArrow.parentElement)_symSelectCat(activeArrow.parentElement.dataset.cat);
  _symRenderTreatPanel(recId);
  _symUpdateCatHighlights();
}

/* ── Phase 3d: 중분류 증상 칩의 ✏️ 펜 → 증상 메모 미니 팝업 ──
 *  · _symOpenTreatMemoDock 와 동일 패턴, 대상이 rec.symptoms
 *  · 메모 입력 시 그 증상도 자동 선택 (base name 매칭 안되어 있으면 push)
 *  · 메모 비우면 base name 만 남기되 선택 상태 유지 */
let _symMemoLiveSaveDebounce=null; /* ✏️ dock 타이핑 중 실시간 저장 디바운스 (2026-06-12) */
function _symOpenSymMemoDock(recId,baseName,anchorChip){
  const existing=document.getElementById('symFreeDock');
  if(existing){
    const prevSym=existing.dataset.sym||'';
    existing.remove();
    if(prevSym===baseName)return;
  }
  /* 펜 클릭 즉시 그 증상을 선택 상태로 — 칩 색 변화 + 우측 처치 패널 활성화 (사용자 결정 2026-06-12).
   * (옛 결정 "펜 클릭만으로 색이 변하면 안 됨 — 저장 시점에만 반영" 은 이 지시로 역전됨.) */
  if(_symFindSymIdx(baseName)===-1)_symToggleSym(baseName);
  const matchIdx=_symFindSymIdx(baseName);
  /* 기존 저장 문자열에서 바디맵 부위명을 제거한 "자유 서술" 부분만 input 초기값으로 사용 — 부위명 중복 입력 방지 */
  const _curParts=_symGetBodyPartsForSym(recId, baseName);
  let curMemo = matchIdx!==-1 ? _symExtractMemoFromStored(_symSelectedSymptoms[matchIdx], _curParts) : '';
  /* position:fixed + body append — 처치 패널/카테고리 패널 stacking 영향 받지 않음 */
  /* 위 즉시-선택 로직이 칩을 재렌더했을 수 있으므로 anchorChip 이 detached 면 같은 baseName 칩을 다시 찾기 */
  let _anchor = anchorChip;
  if(!_anchor || !_anchor.isConnected){
    _anchor = document.querySelector('#symSymList .sym-sel-chip[data-sym="'+baseName.replace(/"/g,'\\"')+'"]') || anchorChip;
  }
  const _r=_anchor.getBoundingClientRect();
  const dock=document.createElement('div');
  dock.id='symFreeDock';
  dock.dataset.sym=baseName;
  dock.style.cssText='position:fixed;left:'+_r.left+'px;top:'+(_r.bottom+4)+'px;z-index:12000;background:var(--card);border:1.5px solid rgba(251,191,36,0.7);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:9px;width:520px;max-width:92vw;box-shadow:0 6px 18px rgba(0,0,0,0.45);cursor:default;opacity:0;transform:scaleY(0.2) translateY(-10px);transform-origin:top left;transition:opacity 0.22s ease, transform 0.25s cubic-bezier(0.16,1,0.3,1)';
  /* 처치/증상 자유 기술 dock 과 동일 — textarea + 자동 높이(세로 확대) + 자동 저장 안내 placeholder (사용자 요청 2026-06-02). */
  dock.innerHTML='<span style="font-size:14px;font-weight:800;color:#d97706;white-space:nowrap;padding-top:6px">✏️ "'+escHtml(baseName)+'" 자유 기술 :</span>'
    +'<textarea id="symSymMemoInput" rows="1" placeholder="입력 즉시 자동 저장됩니다... (Enter, 이 팝업 외부 클릭: 저장)(ESC: 이 팝업 종료하되 저장 X)" style="flex:1;background:var(--bg2);border:1px solid var(--bdr);border-radius:7px;padding:8px 12px;color:var(--t1);font-size:14px;outline:none;font-family:var(--f);resize:none;overflow-y:auto;line-height:1.5;min-height:36px;max-height:240px;box-sizing:border-box"></textarea>';
  document.body.appendChild(dock);
  /* 가로 폭 확대(520px)로 우측 화면 밖으로 나가지 않게 left 클램프 */
  try{ const _vw=window.innerWidth; const _dw=dock.offsetWidth||520; let _lf=_r.left; if(_lf+_dw>_vw-8)_lf=Math.max(8,_vw-_dw-8); if(_lf<8)_lf=8; dock.style.left=_lf+'px'; }catch(_){}
  /* 즉시 표시 (애니메이션 제거 — 깜빡임 방지) */
  dock.style.opacity='1';
  dock.style.transform='none';
  const inp=dock.querySelector('#symSymMemoInput');
  /* textarea 자동 높이 — 입력마다 scrollHeight 기준 재계산 (max 240px). 증상 자유 기술 dock 과 동일. */
  function _autoSize(){ inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,240)+'px'; }
  inp.value=curMemo;
  _autoSize();
  setTimeout(function(){
    inp.focus();
    try{inp.setSelectionRange(0,(inp.value||'').length);}catch(_){ inp.select(); }
  },0);
  /* ESC 취소용 초기 상태 스냅샷 — 입력 시작 전 선택 증상 배열 보관 (ESC = 저장 안 함). */
  const _initialSyms=_symSelectedSymptoms.slice();
  let settled=false;
  function _save(){
    if(settled)return;settled=true;
    if(_symMemoLiveSaveDebounce){clearTimeout(_symMemoLiveSaveDebounce);_symMemoLiveSaveDebounce=null;}
    /* fade-out 220ms 동안 dock 이 DOM 에 남아 있어 같은 펜 재클릭 시 토글-close 분기로 빠지는 문제 차단:
     * id 를 즉시 비워 getElementById('symFreeDock') 가 새 dock 만 찾도록 함 */
    dock.id='';
    const memo=inp.value.trim();
    dock.style.opacity='0';dock.style.transform='scaleY(0.2) translateY(-10px)';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},220);
    const idx=_symFindSymIdx(baseName);
    /* 사용자 요청 포맷: "설사(중앙하복부, 메모)" — 바디맵 부위 + 자유 서술 결합 */
    const newVal=_symBuildSymLabel(recId, baseName, memo);
    /* 라벨이 바뀌면 처치·약품·도즈 맵 키를 옛 라벨→새 라벨로 이전 (고아 방지 — 검증 2026-06-05).
     * 배열 원소를 갱신하기 전에 호출해야 함 (갱신 후엔 _symAutoSave 의 rebuild 가 변경을 못 잡음). */
    const _oldLabel = idx!==-1 ? _symSelectedSymptoms[idx] : null;
    if(_oldLabel && _oldLabel!==newVal) _symMigrateSymMaps(_oldLabel, newVal);
    if(idx===-1)_symSelectedSymptoms.push(newVal);
    else _symSelectedSymptoms[idx]=newVal;
    const cnt=document.getElementById('symSelCount');
    if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    _symAutoSave();
    /* 중앙 안내 토스트 제거 — 우하단 autosave 토스트로 충분 (사용자 요청). */
    /* 중분류 + 처치 패널 + 카테고리 하이라이트 갱신 */
    const activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
    if(activeArrow)_symSelectCat(activeArrow.parentElement.dataset.cat);
    _symRenderTreatPanel(recId);
    _symUpdateCatHighlights();
    document.removeEventListener('click',_outside,true);
  }
  /* ESC — 입력 중 변경분 롤백 후 닫기 (저장 X). 증상 자유 기술 dock 과 동일.
   * 실시간 저장(2026-06-12)이 중간 상태를 DB 에 남겼더라도 아래 롤백 후 _symAutoSave 가 원상태로 재저장. */
  function _cancel(){
    if(settled)return;settled=true;
    if(_symMemoLiveSaveDebounce){clearTimeout(_symMemoLiveSaveDebounce);_symMemoLiveSaveDebounce=null;}
    dock.id='';
    dock.style.opacity='0';dock.style.transform='scaleY(0.2) translateY(-10px)';
    setTimeout(function(){if(dock.parentNode)dock.parentNode.removeChild(dock);},220);
    _symSelectedSymptoms.length=0;
    _initialSyms.forEach(function(x){_symSelectedSymptoms.push(x);});
    const cnt=document.getElementById('symSelCount');
    if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    _symAutoSave();
    const activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
    if(activeArrow)_symSelectCat(activeArrow.parentElement.dataset.cat);
    _symRenderTreatPanel(recId);
    _symUpdateCatHighlights();
    document.removeEventListener('click',_outside,true);
  }
  function _outside(ev){
    if(!dock.contains(ev.target)&&ev.target!==_anchor&&!(_anchor&&_anchor.contains&&_anchor.contains(ev.target))){_save();}
  }
  /* 사용자 요청 — 타이핑할 때마다 선택된 증상 영역에 실시간 반영 */
  inp.addEventListener('input',function(){
    _autoSize();
    const memo=inp.value.trim();
    const idx=_symFindSymIdx(baseName);
    const newVal=_symBuildSymLabel(recId, baseName, memo);
    /* 타이핑마다 라벨이 바뀌므로 처치·약품·도즈 맵 키도 함께 따라가야 고아가 안 생김 (검증 2026-06-05).
     * 배열 원소 갱신 전에 옛 라벨 캡처 → 이전. */
    const _oldLabel = idx!==-1 ? _symSelectedSymptoms[idx] : null;
    if(memo){
      if(idx===-1)_symSelectedSymptoms.push(newVal);
      else { if(_oldLabel && _oldLabel!==newVal) _symMigrateSymMaps(_oldLabel, newVal); _symSelectedSymptoms[idx]=newVal; }
    } else if(idx!==-1){
      const _parts=_symGetBodyPartsForSym(recId, baseName);
      if(!_parts.length){
        /* 메모 비우고 부위도 없으면 증상 자체 제거 — 그 증상의 처치·약품·도즈 맵도 함께 정리 (고아/부활 방지). */
        _symSelectedSymptoms.splice(idx,1);
        if(_oldLabel){
          if(_symTreatmentsBySym)delete _symTreatmentsBySym[_oldLabel];
          if(_symMedsBySym)delete _symMedsBySym[_oldLabel];
          if(_symMedDosesBySym)delete _symMedDosesBySym[_oldLabel];
          if(typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
        }
      } else {
        if(_oldLabel && _oldLabel!==newVal) _symMigrateSymMaps(_oldLabel, newVal);
        _symSelectedSymptoms[idx]=newVal;
      }
    }
    const cnt=document.getElementById('symSelCount');
    if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
    /* 타이핑 중에도 최근 보건실 방문 이력·일지 표에 바로바로 반영 (사용자 요청 2026-06-12) —
     * idle 600ms 후 조용히 저장(_symAutoSave silent → 토스트 X, render:daily 등 emit).
     * ESC 는 _cancel 이 롤백 후 재저장하므로 중간 저장분도 안전하게 원복된다. */
    if(_symMemoLiveSaveDebounce)clearTimeout(_symMemoLiveSaveDebounce);
    _symMemoLiveSaveDebounce=setTimeout(function(){
      _symMemoLiveSaveDebounce=null;
      if(typeof _symAutoSave==='function')_symAutoSave(true);
    },600);
  });
  inp.addEventListener('keydown',function(e){
    /* Enter 단독 = 저장, Shift+Enter = 줄바꿈, ESC = 저장 안 하고 종료(롤백). 증상 자유 기술 dock 과 동일. */
    if(e.key==='Enter' && !e.shiftKey){e.preventDefault();_save();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_cancel();}
  });
  setTimeout(function(){document.addEventListener('click',_outside,true);},50);
}

/* ── Phase 3d: 중분류 증상 칩의 🧍 → 바디맵 입력 (그 증상 마커로 부착) ──
 *  · openBodyMap(recId, null, {symptom: sym}) 호출 — 마커에 symptom 필드 자동 부착
 *  · 바디맵 닫히면 중분류 패널 다시 렌더링하여 🧍 색 갱신 */
function _symOpenBmForSym(recId,sym){
  /* 증상이 선택 안 되어 있으면 자동으로 선택 (바디맵 입력 = 그 증상 발생) */
  if(_symFindSymIdx(sym)===-1){
    _symSelectedSymptoms.push(sym);
    /* 카운트 + 활성 대분류 + 카테고리 하이라이트 + 처치 패널 모두 갱신 */
    const cnt=document.getElementById('symSelCount');
    if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    const activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
    if(activeArrow)_symSelectCat(activeArrow.parentElement.dataset.cat);
    _symUpdateCatHighlights();
    _symRenderTreatPanel(recId);  /* 처치 패널(자주 쓰는 처치 목록) 즉시 표시 */
    _symAutoSave();               /* DB 저장 — saveRecordNow → IPC → SQLite */
  }
  if(typeof openBodyMap==='function'){
    openBodyMap(recId,null,{symptom:sym});
  } else {
    bus.emit('toast:show', {text: '바디맵 기능을 사용할 수 없습니다.'});
  }
  /* 바디맵 닫힘은 bus 이벤트 'bm:closed' 로 통일 청취 (모듈 load 시 1회 등록 — 아래 참조) */
}

/* ── 특정 중분류 증상 🧍 색 in-place 갱신 — 카테고리 재렌더에 의존하지 않고 모든 칩 직접 업데이트 ── */
function _symRefreshAllBmMarks(recId){
  const list=document.getElementById('symSymList');
  if(!list)return;
  const markers=(window._bmData||{})[recId]||[];
  list.querySelectorAll('.sym-sel-chip').forEach(function(chip){
    const sym=chip.dataset.sym;
    if(!sym)return;
    const hasBm=markers.some(function(m){return m.symptom===sym;});
    const mark=chip.querySelector('.sym-bm-mark');
    if(mark){
      mark.style.color=hasBm?'#22c55e':'#a855f7';
      mark.style.border=hasBm?'1.5px solid #22c55e':'1.5px solid transparent';
      mark.style.background=hasBm?'rgba(34,197,94,0.15)':'transparent';
      mark.title=hasBm?'바디맵 입력 완료 (클릭하여 추가/수정)':'바디맵에 부위를 입력';
    }
    /* 칩 자체 색은 선택 상태(cyan)만 유지 — 바디맵 표시는 🧍 아이콘으로만 */
  });
}

/* 바디맵 마커 추가·라벨 수정 즉시 — 증상 패널의 선택 증상 칩/🧍 색을 라이브로 갱신
 * (바디맵 모달이 위에 떠 있어 화면엔 안 보이지만, 닫는 즉시 최신 상태로 보임) */
bus.on('bm:marker-changed',function(ev){
  const _rid = (ev && ev.recId!=null) ? ev.recId : (typeof S!=='undefined' && S._symPopupRecId!=null ? S._symPopupRecId : null);
  if(_rid==null)return;
  /* 사용자 요청 — 바디맵 부위 해제 시, 그 마커에 부착됐던 증상에 더 이상 다른 마커가 없으면
   * 그 증상 자체를 선택 해제하고 일반일지 표에서도 함께 사라져야 함. */
  const _removed=(ev && ev.removedSymptom)?String(ev.removedSymptom):'';
  let _symRemovedFromSelected=false;
  if(_removed){
    const _bd=window._bmData||{};
    const _stillHas=(_bd[_rid]||[]).some(function(m){return m && m.symptom===_removed;});
    if(!_stillHas){
      for(let i=_symSelectedSymptoms.length-1;i>=0;i--){
        const _m=String(_symSelectedSymptoms[i]).match(/^(.+?)\s*\(/);
        const _base=_m?_m[1].trim():_symSelectedSymptoms[i];
        if(_base===_removed){
          const _rl=_symSelectedSymptoms[i];
          _symSelectedSymptoms.splice(i,1);
          _symRemovedFromSelected=true;
          /* 증상이 해제되면 그 증상의 처치·약품·도즈 맵도 함께 정리 — _symRemoveSym 과 동일 사유(고아·부활 방지). 검증 2026-06-05. */
          if(_symTreatmentsBySym && _symTreatmentsBySym[_rl]) delete _symTreatmentsBySym[_rl];
          if(_symMedsBySym && _symMedsBySym[_rl]) delete _symMedsBySym[_rl];
          if(_symMedDosesBySym && _symMedDosesBySym[_rl]) delete _symMedDosesBySym[_rl];
        }
      }
      if(_symRemovedFromSelected && typeof _symRecomputeFlatTreatments==='function')_symRecomputeFlatTreatments();
      const cnt=document.getElementById('symSelCount');
      if(cnt)cnt.textContent='선택 증상: '+_symSelectedSymptoms.length+'개';
    }
  }
  _symRebuildAllSymLabels(_rid);
  _symAutoSave();
  if(document.getElementById('symCatOverlay')){
    _symRefreshAllBmMarks(_rid);
    /* 선택 증상이 실제로 빠졌으면 중분류 패널(선택 상태 표시) + 카테고리 강조 도 함께 새로고침 */
    if(_symRemovedFromSelected){
      let _catId=null;
      const _activeArrow=document.querySelector('.sym-cat-arrow[style*="visibility: visible"]');
      if(_activeArrow)_catId=_activeArrow.parentElement.dataset.cat;
      if(!_catId){
        const _activeCat=document.querySelector('#symCatList .sym-cat-item[style*="font-weight: 700"]')||document.querySelector('#symCatList .sym-cat-item');
        if(_activeCat)_catId=_activeCat.dataset.cat;
      }
      if(_catId && typeof _symSelectCat==='function')_symSelectCat(_catId);
      if(typeof _symUpdateCatHighlights==='function')_symUpdateCatHighlights();
    }
    if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(_rid);
  }
  _symUpdateBmHistChip(_rid);
});

/* 📚 바디맵 이력 칩 카운트·색상 라이브 갱신.
 * 마커 추가/삭제 시 호출. 팝업이 닫혀 있어도 안전(early return). */
function _symUpdateBmHistChip(recId){
  const _chip=document.querySelector('#symChipRow button[data-action="openBmHistory"]');
  if(!_chip)return;
  const rec=(S.records||[]).find(function(r){return r.id===recId;});
  if(!rec)return;
  const bd=window._bmData||{};
  let _cnt=0;
  const _bmKeys=stuKeySet(rec.personUid||rec.studentId);   /* 이력 누락 수정 (2026-08-26) */
  (S.records||[]).forEach(function(r){
    if(recInStuKeys(r,_bmKeys) && bd[r.id] && bd[r.id].length>0) _cnt++;
  });
  _chip.textContent='📚 바디맵 이력'+(_cnt>0?' ('+_cnt+')':'');
  if(_cnt>0){
    _chip.style.color='var(--cyan)';
    _chip.style.background='rgba(6,182,212,0.08)';
    _chip.style.borderColor='rgba(6,182,212,0.3)';
  } else {
    _chip.style.color='#a855f7';
    _chip.style.background='rgba(168,85,247,0.08)';
    _chip.style.borderColor='rgba(168,85,247,0.15)';
  }
}

/* Phase 3d: 바디맵 닫힘 시 중분류 🧍 색 + 선택 증상 칩 + 처치 패널 갱신 */
bus.on('bm:closed',function(ev){
  const _rid = (ev && ev.recId!=null) ? ev.recId : (typeof S!=='undefined' && S._symPopupRecId!=null ? S._symPopupRecId : null);
  if(_rid!=null){ _symRebuildAllSymLabels(_rid); _symAutoSave(); }
  if(!document.getElementById('symCatOverlay'))return;
  /* 1) 중분류 칩들의 🧍 색을 직접 업데이트 (카테고리 재렌더 X — 손가락 위치/스크롤 보존) */
  if(_rid!=null) _symRefreshAllBmMarks(_rid);
  /* 2) 카테고리 하이라이트 갱신 */
  _symUpdateCatHighlights();
  /* 3) 선택 증상 칩(부위명 포함) + 처치 패널 재렌더 */
  if(_rid!=null && typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(_rid);
});

/* record.timeIn / timeOut 변경 시 증상 모달의 시간 칩(.sym-time-chip) 즉시 갱신.
 * openTimePicker 의 hidden input 이벤트가 발화. 모달이 닫혀있어도 안전(쿼리 결과 0건). */
bus.on('record:time-changed', function(ev){
  if(!ev || ev.recId == null) return;
  const _rid = ev.recId;
  const rec = (S.records||[]).find(function(r){return r && r.id === _rid;});
  if(!rec) return;
  const _ridStr = String(_rid);
  document.querySelectorAll('.sym-time-chip').forEach(function(chip){
    if(chip.dataset.recId !== _ridStr) return;
    const _field = chip.dataset.field;
    const _icon  = _field === 'timeIn' ? '🕐' : '🕓';
    const _label = _field === 'timeIn' ? '입실' : '퇴실';
    const _val   = (rec[_field] || '-');
    chip.textContent = _icon + ' ' + _label + ' ' + _val;
  });
});

/* ── 침상 분기 선택 모달 (사용자 요청 2026-05-19) ──────────────────────────
 *  과거 일지를 사후 기록만 하는 사용자를 위해, 침상 칩 클릭 시 두 가지 선택권 제공:
 *    예: 침상·시간·알람 설정 → 기존 openBedManager 흐름
 *    그건 필요치 않음: 처치 칩만 남기고 좌하단 카운트다운 미표시 + 퇴실시간 = 입실시간 + 30분 자동.
 */
function _symAskBedFullChoice(recId, symKey){
  /* 이 침상 흐름의 원복 기준 캡처 — 예/아니오 없이 외부 클릭으로 끄거나, '예' 후 침상 모달을 확인 없이
   *  취소하면 들어갔던 '침상' 칩을 제거(+picker 로 바뀐 퇴실시간 원복). 칩은 _symToggleTreat/_symHandleBedRest
   *  가 이미 추가했고, 여기 시점의 퇴실시간이 흐름 시작 전 값이다. 매 호출마다 새로 캡처해 스테일 방지. (2026-06-15) */
  _symBedRestRevert={recId:recId, symKey:symKey, prevTimeOut:(function(){var _r=S.records.find(function(r){return r.id===recId;});return _r?(_r.timeOut||''):'';})()};
  let _bedChoiceResolved=false; /* 예/아니오 를 명시적으로 고르면 true → 외부 클릭 원복 안 함 */
  const old=document.getElementById('symBedAskOverlay');if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='symBedAskOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.32);z-index:11000;opacity:0;transition:opacity 0.15s ease';
  /* 프로그램 표준 모달 패턴 — 헤더(회색) + 본문(카드색). 사용자 요청 2026-05-20. */
  ov.innerHTML='<div id="symBedAskBox" style="background:var(--card);border-radius:14px;width:420px;max-width:92vw;box-shadow:0 14px 40px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.18s ease,transform 0.18s ease">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));font-size:15px;font-weight:800;color:var(--t1)">🛏 침상 안정 등록</div>'
    +'<div style="padding:18px 22px 14px">'
    +'<div style="font-size:12px;color:var(--t2);line-height:1.7">침상 선택, 시간, 알람 설정까지 하시겠습니까?<br><span style="font-size:10.5px;color:var(--t3)">\'아니오\'를 클릭하면 처치에 \'침상 안정\'만 기입되고, 좌측 하단 카운트다운 팝업도 뜨지 않으며, 퇴실 시간이 입실 시간 +'+(function(){var v=parseInt(localStorage.getItem('ec_daily_bedrest_minutes')||'30',10);if(isNaN(v)||v<1)v=30;else if(v>120)v=120;return v;})()+'분으로 자동 설정됩니다. (설정 가능)</span></div>'
    +'<div style="height:1px;background:var(--bdr);margin:16px -22px 14px"></div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">'
    +'<button id="symBedAskNo" type="button" style="padding:8px 14px;font-size:12px;font-weight:700;border-radius:8px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">아니오 (침상·시간·알람 설정 안함)</button>'
    +'<button id="symBedAskYes" type="button" style="padding:8px 16px;font-size:12px;font-weight:700;border-radius:8px;border:none;background:var(--cyan);color:#fff;cursor:pointer;font-family:var(--f)">예 (침상·시간·알람 설정)</button>'
    +'</div></div></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){
    ov.style.opacity='1';
    const _box=ov.querySelector('#symBedAskBox');
    if(_box){_box.style.opacity='1';_box.style.transform='scale(1)';}
  });
  function _close(){
    ov.style.opacity='0';
    const _b=ov.querySelector('#symBedAskBox');
    if(_b){_b.style.opacity='0';_b.style.transform='scale(0.96)';}
    setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},180);
  }
  ov.querySelector('#symBedAskYes').addEventListener('click',function(ev){
    ev.stopPropagation();_bedChoiceResolved=true;_close();
    /* 기존 흐름 — openBedManager 띄움. 원복 기준(_symBedRestRevert)은 함수 진입 시 캡처됨.
     *  침상 모달을 확인 없이 취소하면 _bedCloseManager → bus 'bed:addCancelled' → _symRevertBedRest 가 원복. */
    S._pendingBedRestRecId=recId;
    setTimeout(function(){
      const _rec=S.records.find(function(r){return r.id===recId;});
      if(_rec && typeof openBedManager==='function'){
        openBedManager(_rec.studentId||null);
      }
    },100);
  });
  ov.querySelector('#symBedAskNo').addEventListener('click',function(ev){
    ev.stopPropagation();_bedChoiceResolved=true;_symBedRestRevert=null;_close();
    /* 칩만 추가 + 퇴실 시간 자동 (입실 + 설정값 분). _bedUsage 등록 안 함 → 좌하단 팝업 미표시.
     * 설정값: 보건일지 설정 > "침상안정 퇴실 시간" (ec_daily_bedrest_minutes, 기본 30, 1~120). */
    S._pendingBedRestRecId=null;
    try{
      const _rec=S.records.find(function(r){return r.id===recId;});
      if(_rec){
        const _tm=(_rec.timeIn||'').match(/^(\d{1,2}):(\d{2})/);
        if(_tm){
          let _h=parseInt(_tm[1],10), _m=parseInt(_tm[2],10);
          let _bedMin = parseInt(localStorage.getItem('ec_daily_bedrest_minutes')||'30', 10);
          if(isNaN(_bedMin) || _bedMin < 1) _bedMin = 30;
          else if(_bedMin > 120) _bedMin = 120;
          _m += _bedMin;
          if(_m>=60){_h+=Math.floor(_m/60);_m%=60;}
          if(_h>=24)_h%=24;
          _rec.timeOut=String(_h).padStart(2,'0')+':'+String(_m).padStart(2,'0');
        }
        /* 처치에 "침상 이용" 칩 보장 — per-symptom (이미 toggle/handleBedRest 에서 map 에 push 됐지만 경로 호환). */
        if(symKey && symKey!=='__legacy__'){
          if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
          if(_symTreatmentsBySym[symKey].every(function(x){return String(x).indexOf('침상')===-1;}))
            _symTreatmentsBySym[symKey].push('침상 이용');
          _symRecomputeFlatTreatments();
          _rec.treatment=_symSelectedTreatments.slice();
          _rec.treatmentBySym=JSON.parse(JSON.stringify(_symTreatmentsBySym));
        } else {
          if(!Array.isArray(_rec.treatment))_rec.treatment=[];
          if(_rec.treatment.indexOf('침상 이용')===-1 && _rec.treatment.indexOf('침상 안정')===-1)_rec.treatment.push('침상 이용');
        }
        _rec._dirty=true;
        if(typeof saveRecordNow==='function')saveRecordNow(_rec);
        bus.emit('render:daily');
        if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
      }
    }catch(_){}
  });
  /* 바깥 클릭 = 취소 — 예/아니오 어느 것도 안 골랐으므로 들어갔던 '침상' 칩을 제거(선택 안함).
   *  사용자 요청 2026-06-15: 선택 모달을 외부 클릭으로 끄면 선택증상 처치의 침상 칩도 사라져야 함. */
  ov.addEventListener('mousedown',function(e){
    if(e.target!==ov)return;
    _close();
    if(!_bedChoiceResolved){ try{ _symRevertBedRest(recId); }catch(_){} }
  });
}

/* 침상 이용 처치 클릭 — 모달 분기 (사용자 요청 2026-05-19). */
function _symHandleBedRest(recId, symKey){
  const rec=(typeof S.records!=='undefined')?S.records.find(function(r){return r.id===recId;}):null;
  if(!rec){bus.emit('toast:show', {text: '레코드를 찾을 수 없습니다.'});return;}
  /* 처치 칩 보장 — per-symptom (선택 증상 map). 사용자 결정 2026-05-28. */
  if(symKey && symKey!=='__legacy__'){
    if(!_symTreatmentsBySym[symKey])_symTreatmentsBySym[symKey]=[];
    if(_symTreatmentsBySym[symKey].every(function(x){return String(x).indexOf('침상')===-1;})){
      _symTreatmentsBySym[symKey].push('침상 이용');
      _symRecomputeFlatTreatments();
      if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
      _symAutoSave();
    }
  } else if(_symSelectedTreatments.indexOf('침상 이용')===-1 && _symSelectedTreatments.indexOf('침상 안정')===-1){
    _symSelectedTreatments.push('침상 이용');
    if(typeof _symRenderTreatPanel==='function')_symRenderTreatPanel(recId);
    _symAutoSave();
  }
  _symAskBedFullChoice(recId, symKey);
}
/* _symHandleBedRest — no longer needs window exposure (called via event delegation) */

/* 침상 '예'(침상·시간·알람 설정) 흐름 시작 시 캡처해 두는 원복 정보 — {recId, symKey, prevTimeOut}. (2026-06-15) */
let _symBedRestRevert=null;
/* 침상 등록 모달을 '확인' 없이 취소(바깥 클릭)했을 때 호출 — bed-management 가 bus.emit('bed:addCancelled',{recId}).
 *  _symToggleTreat/_symHandleBedRest 가 미리 넣어둔 '침상 안정/이용' 칩을 제거하고, picker 미리보기로 +N분
 *  바뀐 퇴실시간을 원복한다. (사용자 보고 2026-06-15: 취소해도 칩이 남고 퇴실시간이 +30분으로 잡혀 '선택 안함'이 안 됨.) */
function _symRevertBedRest(recId){
  if(recId==null)return;
  const info=(_symBedRestRevert && _symBedRestRevert.recId===recId)?_symBedRestRevert:null;
  _symBedRestRevert=null;
  const rec=(S.records||[]).find(function(r){return r.id===recId;});
  if(!rec)return;
  const _isBed=function(t){return String(t).indexOf('침상')!==-1;};
  /* 혹시 등록된 침상 점유가 있으면 해제(확인 안 했으면 보통 없음) */
  try{ if(typeof releaseBedByStudentId==='function' && rec.studentId!=null) releaseBedByStudentId(rec.studentId); }catch(_){}
  if(_symPopupRecId===recId){
    /* 팝업이 이 레코드를 열고 있음 — in-memory 상태에서 침상 제거 후 정식 저장 경로 사용 */
    Object.keys(_symTreatmentsBySym).forEach(function(k){
      if(Array.isArray(_symTreatmentsBySym[k])){
        _symTreatmentsBySym[k]=_symTreatmentsBySym[k].filter(function(t){return !_isBed(t);});
        if(!_symTreatmentsBySym[k].length) delete _symTreatmentsBySym[k];
      }
    });
    if(Array.isArray(_symSelectedTreatments)) _symSelectedTreatments=_symSelectedTreatments.filter(function(t){return !_isBed(t);});
    if(typeof _symRecomputeFlatTreatments==='function') _symRecomputeFlatTreatments();
    if(info) rec.timeOut=info.prevTimeOut;
    if(typeof _symRenderTreatPanel==='function') _symRenderTreatPanel(recId);
    if(typeof _symAutoSave==='function') _symAutoSave(true); /* silent 저장 */
  } else {
    if(Array.isArray(rec.treatment)) rec.treatment=rec.treatment.filter(function(t){return !_isBed(t);});
    if(rec.treatmentBySym && typeof rec.treatmentBySym==='object' && !Array.isArray(rec.treatmentBySym)){
      Object.keys(rec.treatmentBySym).forEach(function(k){
        if(Array.isArray(rec.treatmentBySym[k])){
          rec.treatmentBySym[k]=rec.treatmentBySym[k].filter(function(t){return !_isBed(t);});
          if(!rec.treatmentBySym[k].length) delete rec.treatmentBySym[k];
        }
      });
    }
    if(info) rec.timeOut=info.prevTimeOut;
    rec._dirty=true;
    if(typeof saveRecordNow==='function') saveRecordNow(rec);
  }
  bus.emit('render:daily');
  bus.emit('record:time-changed',{recId:recId}); /* 팝업 퇴실 시간 칩 즉시 갱신 */
}
bus.on('bed:addCancelled',function(payload){ try{ _symRevertBedRest(payload&&payload.recId); }catch(_){} });
/* 침상 모달 picker '← 뒤로' → 바로 이전 확인 모달("…하시겠습니까?") 다시 띄움. 칩은 유지된 상태. (사용자 요청 2026-06-24) */
bus.on('bed:backToConfirm',function(payload){
  try{
    const recId=payload&&payload.recId;
    if(recId==null)return;
    const symKey=(_symBedRestRevert&&_symBedRestRevert.recId===recId)?_symBedRestRevert.symKey:'__legacy__';
    if(typeof _symAskBedFullChoice==='function') _symAskBedFullChoice(recId, symKey);
  }catch(_){}
});

/* ── V/S 시계열 점도표 팝업 ──
 * 학생의 모든 방문 기록에서 체온·맥박·혈압(수축기 빨강/이완기 파랑)·호흡·SpO₂·혈당을
 * 시간순(왼→오)으로 점만 찍어 표시. 선 연결 없음. 점 위(상단 위기 시 아래)에 값 라벨.
 * Y축 고정 범위(정상범위 중심), X축은 데이터 날짜에만 눈금 표시. */
function _symShowVsTimeline(stuId){
  /* 한 번만 keyframes 주입 — 팝업 열림/닫힘 애니메이션 */
  if(!document.getElementById('vsTimelineStyles')){
    const st=document.createElement('style');st.id='vsTimelineStyles';
    st.textContent='@keyframes vsOvIn{from{opacity:0}to{opacity:1}}@keyframes vsOvOut{from{opacity:1}to{opacity:0}}@keyframes vsBoxIn{from{opacity:0;transform:scale(0.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes vsBoxOut{from{opacity:1;transform:scale(1) translateY(0)}to{opacity:0;transform:scale(0.94) translateY(8px)}}';
    document.head.appendChild(st);
  }
  const existing=document.getElementById('symVsTimelineOverlay');
  if(existing){_symCloseVsTimeline();return;}
  const stu=getStu(stuId)||{};
  const _vstKeys=stuKeySet(stuId);   /* 이력 누락 수정 (2026-08-26) — uid/구id·타입 혼재 모두 매칭 */
  const visits=S.records.filter(function(r){return recInStuKeys(r,_vstKeys);})
                        .sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
  if(!visits.length){
    if(typeof bus!=='undefined'&&bus.emit)bus.emit('toast:show',{text:'표시할 V/S 데이터가 없습니다.'});
    else alert('표시할 V/S 데이터가 없습니다.');
    return;
  }
  const series=visits.map(function(r){
    let sys=null,dia=null;
    if(r.bp){const m=String(r.bp).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);if(m){sys=parseFloat(m[1]);dia=parseFloat(m[2]);}}
    const respVal=r.respiration!=null&&r.respiration!==''?r.respiration:r.resp;
    return {
      date:r.date||'',
      temp:r.temp!=null&&r.temp!==''?parseFloat(r.temp):null,
      bpSys:sys,bpDia:dia,
      pulse:r.pulse!=null&&r.pulse!==''?parseFloat(r.pulse):null,
      resp:respVal!=null&&respVal!==''?parseFloat(respVal):null,
      spo2:r.spo2!=null&&r.spo2!==''?parseFloat(r.spo2):null,
      bst:r.bst!=null&&r.bst!==''?parseFloat(r.bst):null,
    };
  });
  const stuInfo=_symFullStuLabel(stu);   /* 학교급(여러개)+학과+학년반번+이름 (사용자 요청 2026-06-18) */
  const dates=series.map(function(s){return s.date;});

  const ov=document.createElement('div');ov.id='symVsTimelineOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:11500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:vsOvIn .18s ease both';
  const box=document.createElement('div');box.id='symVsTimelineBox';
  box.style.cssText='width:840px;max-width:96vw;max-height:88vh;background:var(--card);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.30);border:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden;animation:vsBoxIn .22s cubic-bezier(0.4,0,0.2,1) both';
  /* 헤더 (종료 버튼 없음 — 바깥 클릭 / ESC 로 닫음) */
  let h='<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,rgba(59,130,246,0.07),transparent)">'
    +'<span style="font-size:18px">📈</span>'
    +'<div style="flex:1"><div style="font-size:13px;font-weight:800;color:var(--t1)">V/S 시계열 — '+escHtml(stuInfo)+'</div>'
    +'<div style="font-size:10.5px;color:var(--t3);margin-top:1px">총 '+visits.length+'건 · '+escHtml(dates[0]||'')+' ~ '+escHtml(dates[dates.length-1]||'')+' · 왼쪽 옛날 → 오른쪽 최근  ·  바깥 클릭/ESC 로 닫기</div></div>'
    +'</div>';
  /* 본문 — 6 차트 (2열 3행). 점만, 검정 (혈압은 빨강/파랑) */
  h+='<div style="flex:1;overflow-y:auto;padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;background:var(--bg2)">';
  h+=_vsChart('체온','°C',series.map(function(s){return s.temp;}),dates,35.5,41);
  h+=_vsChart('맥박','bpm',series.map(function(s){return s.pulse;}),dates,40,160);
  h+=_vsChartBp(series.map(function(s){return s.bpSys;}),series.map(function(s){return s.bpDia;}),dates,50,200);
  h+=_vsChart('호흡','회/분',series.map(function(s){return s.resp;}),dates,10,30);
  h+=_vsChart('SpO₂','%',series.map(function(s){return s.spo2;}),dates,60,100);
  h+=_vsChart('혈당','mg/dL',series.map(function(s){return s.bst;}),dates,50,500);
  h+='</div>';
  box.innerHTML=h;ov.appendChild(box);document.body.appendChild(ov);

  function _close(){
    if(!ov.parentElement)return;
    ov.style.animation='vsOvOut .16s ease both';
    box.style.animation='vsBoxOut .16s cubic-bezier(0.4,0,1,1) both';
    setTimeout(function(){if(ov.parentElement)ov.remove();},170);
    document.removeEventListener('keydown',_esc);
  }
  const _esc=function(e){if(e.key==='Escape'){e.preventDefault();_close();}};
  ov.addEventListener('mousedown',function(e){if(e.target===ov)_close();});
  document.addEventListener('keydown',_esc);
}

function _symCloseVsTimeline(){
  const ov=document.getElementById('symVsTimelineOverlay');
  if(ov&&ov.parentElement)ov.remove();
}

/* 단일 항목 점도표 (체온·맥박·호흡·SpO₂·혈당) — 검정 점, 값 라벨 점 위(상단 위기 시 아래) */
function _vsChart(title,unit,values,dates,yMin,yMax){
  return _vsChartCore(title,unit,[{vals:values,color:'#111827',label:''}],dates,yMin,yMax);
}
/* 혈압 점도표 — 수축기 빨강 / 이완기 파랑 */
function _vsChartBp(sysVals,diaVals,dates,yMin,yMax){
  return _vsChartCore('혈압','mmHg',[
    {vals:sysVals,color:'#dc2626',label:'수축기'},
    {vals:diaVals,color:'#2563eb',label:'이완기'},
  ],dates,yMin,yMax);
}

/* 공통 점도표 코어 — series 는 [{vals,color,label}, ...] */
function _vsChartCore(title,unit,seriesList,dates,yMin,yMax){
  /* 라이트/다크 자동 색상 — currentColor 우회. 모드별로 확실히 보이는 회색 분기 */
  const _isLight=document.body.classList.contains('light');
  const AXIS=_isLight?'#475569':'#cbd5e1';    /* 축선 — 라이트:어둡게, 다크:밝게 */
  const TICK=_isLight?'#475569':'#cbd5e1';    /* 눈금선 + 라벨 동일 */
  const GRID=_isLight?'rgba(15,23,42,0.10)':'rgba(255,255,255,0.10)';
  /* 차트 크기 — 세로 확대 */
  const W=440,H=240,ML=44,MR=12,MT=20,MB=34;
  const innerW=W-ML-MR,innerH=H-MT-MB;
  const N=dates.length;
  let hasData=false;
  seriesList.forEach(function(s){s.vals.forEach(function(v){if(v!=null&&!isNaN(v))hasData=true;});});
  if(!hasData)return _vsChartEmpty(title,unit,seriesList);
  const xPx=function(i){return ML+(N===1?innerW/2:(i/(N-1))*innerW);};
  const yPx=function(v){return MT+innerH-((v-yMin)/(yMax-yMin))*innerH;};
  /* X·Y 축선 — 명확하게 굵게 */
  let axes='';
  axes+='<line x1="'+ML+'" y1="'+MT+'" x2="'+ML+'" y2="'+(MT+innerH)+'" stroke="'+AXIS+'" stroke-width="2"/>';
  axes+='<line x1="'+ML+'" y1="'+(MT+innerH)+'" x2="'+(W-MR)+'" y2="'+(MT+innerH)+'" stroke="'+AXIS+'" stroke-width="2"/>';
  /* Y축 눈금 — 5등분 */
  const yTicksCount=5;
  let yTicks='',grid='';
  for(let k=0;k<=yTicksCount;k++){
    const yv=yMin+(yMax-yMin)*(k/yTicksCount);
    const yy=yPx(yv);
    yTicks+='<line x1="'+(ML-5)+'" x2="'+ML+'" y1="'+yy.toFixed(1)+'" y2="'+yy.toFixed(1)+'" stroke="'+TICK+'" stroke-width="1.2"/>';
    yTicks+='<text x="'+(ML-7)+'" y="'+(yy+3.5).toFixed(1)+'" text-anchor="end" font-size="10" fill="'+TICK+'" font-weight="600">'+(Math.round(yv*10)/10)+'</text>';
    if(k>0&&k<yTicksCount) grid+='<line x1="'+ML+'" x2="'+(W-MR)+'" y1="'+yy.toFixed(1)+'" y2="'+yy.toFixed(1)+'" stroke="'+GRID+'" stroke-width="0.6"/>';
  }
  /* X축 날짜 눈금 */
  const maxXLabels=6;
  let xIdxs=[];
  if(N<=maxXLabels){for(let i=0;i<N;i++)xIdxs.push(i);}
  else{xIdxs=[0];for(let k=1;k<maxXLabels-1;k++)xIdxs.push(Math.round(k*(N-1)/(maxXLabels-1)));xIdxs.push(N-1);}
  let xTicks='';
  xIdxs.forEach(function(i){const d=dates[i]||'';const short=d.length>=10?d.slice(5):d;const xx=xPx(i);
    xTicks+='<line x1="'+xx.toFixed(1)+'" x2="'+xx.toFixed(1)+'" y1="'+(MT+innerH)+'" y2="'+(MT+innerH+5)+'" stroke="'+TICK+'" stroke-width="1.2"/>';
    xTicks+='<text x="'+xx.toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle" font-size="10" fill="'+TICK+'" font-weight="600">'+escHtml(short)+'</text>';
  });
  /* 데이터 점 + 값 라벨 */
  let dots='';
  seriesList.forEach(function(s){
    for(let i=0;i<N;i++){
      const v=s.vals[i];if(v==null||isNaN(v))continue;
      const vClamped=Math.max(yMin,Math.min(yMax,v));
      const cx=xPx(i),cy=yPx(vClamped);
      const labelText=(Math.round(v*10)/10).toString();
      /* 상단에서 18px 이내면 점 아래(+14), 아니면 점 위(-9) */
      const labelAbove=(cy-MT)>=18;
      const ly=labelAbove?(cy-9):(cy+14);
      dots+='<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="4" fill="'+s.color+'" stroke="#fff" stroke-width="1">'
        +'<title>'+escHtml(dates[i]||'')+(s.label?' '+s.label:'')+': '+v+' '+unit+'</title></circle>';
      dots+='<text x="'+cx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" font-size="10.5" font-weight="800" fill="'+s.color+'" style="paint-order:stroke;stroke:'+(_isLight?'#fff':'#0c1220')+';stroke-width:2.6px;stroke-linejoin:round">'+escHtml(labelText)+'</text>';
    }
  });
  /* 범례 (다중 시리즈일 때만) */
  let legend='';
  if(seriesList.length>1){
    let lx=ML+8;
    seriesList.forEach(function(s){
      legend+='<circle cx="'+lx+'" cy="'+(MT-6)+'" r="3.5" fill="'+s.color+'"/>';
      legend+='<text x="'+(lx+7)+'" y="'+(MT-2)+'" font-size="10" font-weight="700" fill="'+s.color+'">'+s.label+'</text>';
      lx+=64;
    });
  }
  return '<div style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:10px 12px">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
    +'<span style="font-size:12.5px;font-weight:800;color:var(--t1)">'+title+'</span>'
    +'<span style="font-size:10px;color:var(--t3);font-weight:600">'+unit+'</span></div>'
    +'<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet">'
    +grid+axes+yTicks+xTicks+legend+dots
    +'</svg></div>';
}

function _vsChartEmpty(title,unit,seriesList){
  return '<div style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:8px 10px;min-height:150px;display:flex;flex-direction:column">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
    +'<span style="font-size:11.5px;font-weight:700;color:var(--t1)">'+title+'</span>'
    +'<span style="font-size:9.5px;color:var(--t3)">'+unit+'</span></div>'
    +'<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:10px">기록된 데이터가 없습니다.</div>'
    +'</div>';
}

/* ── 바디맵 입력 이력 팝업 ──
 * 학생의 전체 일지 중 바디맵 마커가 있는 일지를 시간순(최신→과거)으로 나열.
 * 각 행: 날짜 / 부위 / 증상 / 보기 버튼
 *  · 부위 = _bmData[r.id] 의 label 들을 unique 로 콤마 join
 *  · 증상 = r.symptoms 콤마 join
 *  · 보기 → openBodyMap(recId, null, {readOnly:true}) 로 읽기 전용 표시
 *    (특정 일자 수정 필요 시 사용자가 일반일지에서 해당 일자 일지를 다시 열면 됨)
 */
function _symOpenBmHistory(stuId,curRecId){
  const existing=document.getElementById('symBmHistOverlay');
  if(existing){_symCloseBmHistory();return;}
  /* 바디맵 마커 보유 일지만 (모든 날짜, 현재 일지 포함) */
  const _bm=window._bmData||{};
  const _bmhKeys=stuKeySet(stuId);   /* 이력 누락 수정 (2026-08-26) */
  const recs=S.records.filter(function(r){
    return recInStuKeys(r,_bmhKeys)&&_bm[r.id]&&_bm[r.id].length>0;
  }).sort(function(a,b){
    const cmp=(b.date||'').localeCompare(a.date||'');
    if(cmp)return cmp;
    return (b.timeIn||'').localeCompare(a.timeIn||'');
  });

  const ov=document.createElement('div');ov.id='symBmHistOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:11500;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background .25s ease';

  const pop=document.createElement('div');pop.id='symBmHistPop';
  /* translateY 제거 — 아래에서 위로 튀는 깜빡임 차단. opacity + 약한 scale 만 사용 */
  pop.style.cssText='width:680px;max-width:92vw;max-height:70vh;background:var(--card);border:1.5px solid rgba(168,85,247,0.5);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.4);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity .18s ease, transform .18s ease';

  let h='<div class="bm-hist-header" style="padding:10px 16px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;cursor:grab;user-select:none">'
    +'<div><div style="font-size:13px;font-weight:800;color:var(--t1)">📚 바디맵 입력 이력 ('+recs.length+'건)</div>'
    +'<div style="font-size:10.5px;color:var(--t3);margin-top:2px">신규 입력은 중분류 증상 칩의 🧍 아이콘에서. 여기는 조회 전용.</div></div>'
    +'</div>';

  if(!recs.length){
    h+='<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:11px;padding:32px">바디맵 입력 이력이 없습니다.</div>';
  } else {
    h+='<div style="flex:1;overflow-y:auto;scrollbar-width:thin">';
    h+='<table style="width:100%;border-collapse:collapse;font-size:11px">';
    h+='<thead style="background:var(--bg2);position:sticky;top:0;z-index:1">'
      +'<tr>'
      +'<th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--bdr);font-size:10.5px;color:var(--t2);font-weight:700;width:100px">날짜</th>'
      +'<th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--bdr);font-size:10.5px;color:var(--t2);font-weight:700;width:160px">부위</th>'
      +'<th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--bdr);font-size:10.5px;color:var(--t2);font-weight:700">증상</th>'
      +'<th style="padding:8px 10px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10.5px;color:var(--t2);font-weight:700;width:70px"></th>'
      +'</tr></thead><tbody>';
    recs.forEach(function(r){
      const markers=_bm[r.id]||[];
      /* 부위 unique 추출 */
      const _seen={};const partsArr=[];
      /* 통증척도(NRS)로 입력된 부위는 "오른발 아치 (NRS: 7)" 로 표기. 체크(nrs 0)는 부위명만. (사용자 요청 2026-06-14) */
      markers.forEach(function(m){const l=(m.label||'').trim();if(l&&!_seen[l]){_seen[l]=1;partsArr.push(m.nrs?(l+' (NRS: '+m.nrs+')'):l);}});
      const partsStr=partsArr.join(', ')||'-';
      const symStr=(r.symptoms||[]).join(', ')||'-';
      /* NEIS 표준 날짜 포맷 (YYYY-MM-DD → YYYY. M. D.) */
      let dateLabel=r.date||'';
      const _m=String(dateLabel).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if(_m)dateLabel=_m[1]+'. '+parseInt(_m[2],10)+'. '+parseInt(_m[3],10)+'.';
      h+='<tr>'
        +'<td style="padding:8px 10px;border-bottom:1px solid var(--bdrl);color:var(--t1);font-weight:500;white-space:nowrap">'+escHtml(dateLabel)+'</td>'
        +'<td style="padding:8px 10px;border-bottom:1px solid var(--bdrl);color:var(--t1)">'+escHtml(partsStr)+'</td>'
        +'<td style="padding:8px 10px;border-bottom:1px solid var(--bdrl);color:var(--t2)">'+escHtml(symStr)+'</td>'
        +'<td style="padding:6px 10px;border-bottom:1px solid var(--bdrl);text-align:center">'
        +'<button data-action="viewBmReadOnly" data-rec-id="'+r.id+'" style="padding:3px 12px;font-size:10.5px;font-weight:700;color:var(--cyan);background:rgba(6,182,212,0.10);border:1px solid rgba(6,182,212,0.35);border-radius:6px;cursor:pointer;font-family:var(--f);white-space:nowrap">보기</button>'
        +'</td>'
        +'</tr>';
    });
    h+='</tbody></table></div>';
  }
  pop.innerHTML=h;
  ov.appendChild(pop);

  /* 보기 버튼 — 읽기 전용 바디맵 뷰어 호출 후 이력 팝업은 즉시 닫음 */
  pop.addEventListener('click',function(e){
    const btn=e.target.closest('[data-action="viewBmReadOnly"]');
    if(btn){
      const rid=parseInt(btn.dataset.recId);
      if(!isNaN(rid)){
        _symCloseBmHistory();
        openBodyMap(rid,null,{readOnly:true});
      }
    }
  });

  /* 오버레이 클릭으로 닫기 */
  ov.addEventListener('mousedown',function(e){
    if(e.target===ov)_symCloseBmHistory();
  });
  document.body.appendChild(ov);
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.12)';
    pop.style.opacity='1';pop.style.transform='scale(1) translateY(0)';
  });});
  _makeDraggable(pop);
}
function _symCloseBmHistory(){
  const ov=document.getElementById('symBmHistOverlay');
  if(!ov)return;
  const pop=document.getElementById('symBmHistPop');
  if(pop){pop.style.opacity='0';pop.style.transform='scale(0.92) translateY(10px)';}
  ov.style.background='rgba(0,0,0,0)';ov.style.transition='background .2s ease';
  setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},220);
}

/* ── 과거 방문 이력 미니 팝업 ── */
export function _symShowHistory(stuId,curRecId){
  const existing=document.getElementById('symHistoryOverlay');
  if(existing){_symCloseHistory();return;}
  /* 현재 레코드 제외한 과거 방문만 필터 (칩 건수와 일치 — 날짜 기준 고유 카운트) */
  const curRec=S.records.find(function(r){return r.id===curRecId;});
  const curDate=curRec?curRec.date:'';
  const _histKeys=stuKeySet(stuId);   /* 이력 누락 수정 (2026-08-26) — uid/구id·타입 혼재 모두 매칭 */
  const allVisits=S.records.filter(function(r){return recInStuKeys(r,_histKeys)&&r.date!==curDate;}).sort(function(a,b){return b.date.localeCompare(a.date);});
  /* 고유 날짜 수 (칩 숫자와 일치) */
  const _uniqueDates={};allVisits.forEach(function(r){_uniqueDates[r.date]=1;});
  const uniqueDateCnt=Object.keys(_uniqueDates).length;
  const visits=allVisits.slice(0,50);

  const ov=document.createElement('div');ov.id='symHistoryOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:11500;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background .25s ease';

  const pop=document.createElement('div');pop.id='symHistoryPop';
  pop.style.cssText='width:460px;max-width:90vw;max-height:60vh;background:var(--card);border:1px solid var(--bdr);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:scale(0.92) translateY(10px);transition:opacity .25s ease, transform .25s ease';
  let h='<div class="sym-hist-header" style="padding:10px 16px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;cursor:grab;user-select:none">'
    +'<span style="font-size:13px;font-weight:800;color:var(--t1)">📅 과거 방문 이력 ('+uniqueDateCnt+'건)</span>'
    +'</div>';
  h+='<div style="flex:1;overflow-y:auto;padding:8px">';
  visits.forEach(function(v){
    const hasBm=(window._bmData||{})[v.id]&&(window._bmData||{})[v.id].length>0;
    /* v3 (사용자 결정 2026-05-21) — 다중 증상 + treatmentBySym 있으면 증상별 분기 표시.
     *  · 형식: "설사 → 정로환, 보건교육" / "두통 → 타이레놀, 침상 안정"
     *  · record-level (침상·V/S) 처치는 첫 줄에 함께 표시
     *  · 단일 증상 또는 옛 일지(treatmentBySym 없음) → 기존 layout 유지 */
    const _hasBySym = v.treatmentBySym && typeof v.treatmentBySym==='object'
                   && !Array.isArray(v.treatmentBySym) && Object.keys(v.treatmentBySym).length>0;
    const _isMultiSym = Array.isArray(v.symptoms) && v.symptoms.length>1 && _hasBySym;
    h+='<div style="padding:8px 10px;border-bottom:1px solid var(--bdr);display:flex;align-items:flex-start;gap:8px">';
    h+='<span style="font-size:11px;font-weight:700;color:var(--t2);min-width:80px;padding-top:1px">'+escHtml(v.date)+'</span>';
    if(_isMultiSym){
      const _vsStrV = _vsValueStr(v);
      const _medDispForSym = function(sym){
        if(!v.medsBySym || !v.medsBySym[sym] || !v.medsBySym[sym].length) return '';
        var dm = (v.medDosesBySym && v.medDosesBySym[sym]) || {};
        return formatMedicationDisplay(v.medsBySym[sym].map(function(m){var d=dm[m]||''; return d?(m+'('+d+')'):m;}).join(', '));
      };
      h+='<div style="flex:1;display:flex;flex-direction:column;gap:2px">';
      /* v3 (2026-05-28) — V/S·침상도 per-symptom. 각 증상 행에 그 증상 처치만 (record-level 공유 폐지). */
      v.symptoms.forEach(function(sym, idx){
        var _spl=String(sym).match(/^(.+?)\s*\((.*)\)\s*$/);
        var _symDisp = _spl ? (_spl[1].trim()+'['+_spl[2]+']') : sym;
        var symTreats = (v.treatmentBySym[sym]||[]);
        var medDispForSym = _medDispForSym(sym);
        var symLabeled = symTreats.map(function(t){
          var _b=t; var _bm=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(_bm)_b=_bm[1].trim();
          if(_b==='투약' && medDispForSym) return medDispForSym;
          if(_b==='V/S 측정' && _vsStrV) return 'V/S 측정 ' + _vsStrV;
          return t;
        });
        var treatStr = symLabeled.join(', ') || '-';
        h+='<div style="display:flex;gap:6px;align-items:baseline">'
         + '<span style="font-size:10px;font-weight:700;color:var(--cyan);white-space:nowrap">'+escHtml(_symDisp)+'</span>'
         + '<span style="font-size:9px;color:var(--t3)">→</span>'
         + '<span style="font-size:10px;color:var(--t2)">'+escHtml(treatStr)+'</span>'
         + '</div>';
      });
      if(v.treatmentMemo) h+='<div style="font-size:9.5px;color:var(--t3);font-style:italic;margin-top:1px">'+escHtml(v.treatmentMemo)+'</div>';
      h+='</div>';
    } else {
      /* V/S 측정 라벨에 값 부착 — 단일/legacy 분기 */
      const _vsStrV2 = _vsValueStr(v);
      const _treatStr = (v.treatment||[]).map(function(t){
        if(t==='V/S 측정' && _vsStrV2) return 'V/S 측정 ' + _vsStrV2;
        return t;
      }).join(', ') || '-';
      h+='<span style="font-size:10px;color:var(--t3);flex:1;padding-top:1px">'+escHtml((v.symptoms||[]).join(', ')||'-')+'</span>';
      h+='<span style="font-size:10px;color:var(--t3);padding-top:1px">'+escHtml(_treatStr)+'</span>';
    }
    /* 사용자 요청 — 체크 표시 제거. 바디맵 마커가 있으면 보라색 🧍 활성, 없으면 흐린 🧍 */
    h+='<span class="hist-bm-chip" data-bm-active="'+(hasBm?'1':'0')+'" '+(hasBm?'data-action="openBodyMap" data-rec-id="'+v.id+'"':'')+' style="font-size:12px;cursor:'+(hasBm?'pointer':'default')+';opacity:'+(hasBm?'1':'0.3')+';color:'+(hasBm?'#a855f7':'var(--t3)')+';padding-top:1px" title="'+(hasBm?'바디맵 이력 보기':'바디맵 이력 없음')+'">🧍</span>';
    h+='</div>';
  });
  if(!visits.length) h+='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">과거 방문 내역이 없습니다.</div>';
  h+='</div>';
  pop.innerHTML=h;
  ov.appendChild(pop);
  /* 활성 바디맵 칩 클릭 이벤트 위임 — 이력 팝업 닫고 바디맵 오픈 */
  pop.addEventListener('click',function(e){
    const bm=e.target.closest('[data-action="openBodyMap"]');
    if(bm){_symCloseHistory();openBodyMap(parseInt(bm.dataset.recId));}
  });
  /* 비활성 바디맵칩 hover 시 애니메이션 tooltip (1.5초 후 사라짐) */
  pop.querySelectorAll('.hist-bm-chip[data-bm-active="0"]').forEach(function(chip){
    let _hideTimer=null;
    chip.addEventListener('mouseenter',function(){
      if(_hideTimer){clearTimeout(_hideTimer);_hideTimer=null;}
      _symShowTip(chip,'해당 방문일에 바디맵 입력 내역이 없습니다.');
    });
    chip.addEventListener('mouseleave',function(){
      _hideTimer=setTimeout(function(){_symHideTip();_hideTimer=null;},1500);
    });
  });
  /* 오버레이 클릭으로 닫기 (팝업 내부 클릭은 무시) */
  ov.addEventListener('mousedown',function(e){
    if(e.target===ov)_symCloseHistory();
  });
  document.body.appendChild(ov);
  /* 열기 애니메이션 */
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.12)';
    pop.style.opacity='1';pop.style.transform='scale(1) translateY(0)';
  });});
  /* 헤더 드래그 이동 — 애니메이션 종료 후 정규화 */
  _makeDraggable(pop);
}
function _symCloseHistory(){
  const ov=document.getElementById('symHistoryOverlay');
  if(!ov)return;
  const pop=document.getElementById('symHistoryPop');
  if(pop){pop.style.opacity='0';pop.style.transform='scale(0.92) translateY(10px)';}
  ov.style.background='rgba(0,0,0,0)';ov.style.transition='background .2s ease';
  setTimeout(function(){if(ov.parentNode)ov.remove();},250);
}
/* _symShowHistory — no longer needs window exposure (called via event delegation) */

