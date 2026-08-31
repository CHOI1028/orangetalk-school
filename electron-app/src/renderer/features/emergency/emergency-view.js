/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { getStu, escHtml, getGuardianContact, getStudentBirth, getCareTooltipHtml, showNameHoverPop, hideNameHoverPop, toDateStr, getStuGradeCol, isKinder, gradeClsLabel, closeModalGracefully, createEmptyState, saveRecordNow } from '../../core/helpers.js';
import { hasMultipleSchoolLevels, getLevelShort } from '../../core/student-utils.js';
import { crInsertHandles, showVisitHistory, toggleMemo, _memoHasAny, colWidthUndo, dailyColWidthGetPx, dailyColWidthSetPx } from '../daily/daily-view.js';
import { closeModalWithAnim, matchKorean, matchKoreanFromStart } from '../daily/daily-autocomplete.js';
import { _makeDraggable, openSymptomCategoryPopup } from '../symptom/symptom-view.js';
import { switchView } from '../shell/view-router.js';
import { playQuickMenuSound } from '../../core/ui-utils.js';
import { loadTabOrder, closeSettings, openAdvancedSearch } from '../settings/settings-view.js';
import { S, addEcRecord, addInfRecord } from '../../core/app-state.js';
import { _bmBodyPartsAdult, _bmFaceParts, _bmTeethParts, _bmHandTopParts, _bmPalmParts, _bmFootTopParts, _bmFootBottomParts, _BM_LR_POSITIONS, _BM_LR_POSITIONS_PROGRAM } from '../../core/bodymap-anchors.js';
import { _hdrCycle } from '../shell/header-widget.js';
import { bus } from '../../core/event-bus.js';
import { openA4PrintDialog, saveA4Pdf } from '../../core/a4-print-dialog.js';
/* ═══════════════════════════════════════
   EMERGENCY RECORDS (#38-46)
   ═══════════════════════════════════════ */
S.ecRecords=[];
S.ecNextId=1;
let ecAcHighlight=-1;
let ecSaveTimer=null;
let ecCurrentId=null;
let ecSortDir='desc'; // 'asc' | 'desc'

/* 학년도 계산: 3월~12월 → 올해, 1월~2월 → 작년. 학년도는 3월 1일 시작(달력 연도 아님).
   인자(날짜)가 주어지면 그 날짜 기준 학년도 — 과거 날짜로 입력·수정한 기록도 '그 사고/방문 당시 학년도'로 정확히 박는다
   (학생의 학년·반·번호가 학년도마다 다르므로 절대 달력연도로 박으면 안 됨. 사용자 지시 2026-06-20). */
function _academicYear(d){
  const x=d?new Date(d):new Date();
  const b=isNaN(x.getTime())?new Date():x;
  return b.getMonth()>=2?b.getFullYear():b.getFullYear()-1;
}

function _ecToDbRow(rec){
  const ai=rec.accidentInfo||{};
  const v=rec.vitals||{};
  const tr=rec.transfer||{};
  const dtParts=(ai.datetime||'').split(' ');
  return {
    id:rec._dbId||rec.id,
    school_year:String(_academicYear(rec.date)), /* 사고/방문 날짜 기준 학년도(3/1) — 달력연도 slice 금지 (사용자 지시 2026-06-20) */
    person_uid:rec.personUid||rec.studentId||null,
    person_type:rec.personType||'student',
    accident_date:dtParts[0]||rec.date||'',
    accident_time:dtParts[1]||'',
    location:ai.location||'',
    situation:ai.situation||'',
    patient_status:rec.patientStatus||'',
    consciousness:rec.consciousness||'명료',
    vital_temp:v.temp||'',
    vital_pulse:v.pulse||'',
    vital_bp:v.bp||'',
    vital_resp:v.resp||'',
    vital_spo2:v.spo2||'',
    vital_bst:v.bst||'',
    summary:rec.summary||'',
    treatment:rec.treatment||'',
    is_transported:tr.transferred?1:0,
    transport_method:tr.method||'',
    transport_dest:tr.facility||'',
    author_date:rec.authorDate||'',
    author_name:rec.authorName||'',
    guardian_contact:rec.guardianContact||'',
    homeroom_teacher:rec.homeroomTeacher||'',
    memo:rec.notes||'',
    extra_json:JSON.stringify({
      photoData:rec.photoData,
      displayGrade:rec.displayGrade,
      displayNum:rec.displayNum,
      displayGender:rec.displayGender,
      vitalsList:rec.vitalsList||null,
      recConsciousness:rec.recConsciousness||'',
      consciousnessEtc:rec.consciousnessEtc||'',
      recConsciousnessEtc:rec.recConsciousnessEtc||''
    })
  };
}
export function ecSaveRecords(){
  if(!window.electronAPI)return;
  S.ecRecords.forEach(function(rec){
    const row=_ecToDbRow(rec);
    if(rec._dbId){
      window.electronAPI.recordsEmergencyUpdate(row).catch(function(err){console.error('[DB] emergency update 실패:',err);});
    }else{
      window.electronAPI.recordsEmergencyInsert(row).then(function(res){
        if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
      }).catch(function(err){console.error('[DB] emergency insert 실패:',err);});
    }
  });
}
/* DB에서 불러온 레코드를 렌더러 도메인 모델로 복원 (snake→camel + 중첩 객체 재구성) */
function _ecHydrate(r){
  const accidentDate=r.accidentDate||r.accident_date||'';
  const accidentTime=r.accidentTime||r.accident_time||'';
  const dt=accidentDate+(accidentTime?' '+accidentTime:'');
  let extra={};
  try{if(r.extra_json)extra=JSON.parse(r.extra_json)||{};}catch(e){}
  return Object.assign({},r,{
    studentId:r.studentId||r.personUid||r.person_uid||'',
    date:r.date||accidentDate||r.authorDate||r.author_date||'',
    accidentInfo:r.accidentInfo||{
      datetime:dt,
      location:r.location||'',
      situation:r.situation||''
    },
    vitals:r.vitals||{
      temp:r.vital_temp||'',pulse:r.vital_pulse||'',bp:r.vital_bp||'',
      resp:r.vital_resp||'',spo2:r.vital_spo2||'',bst:r.vital_bst||''
    },
    /* 시간별 다중 측정 배열 — 없으면 단일 vitals/flat 컬럼에서 마이그레이션 */
    vitalsList:(Array.isArray(r.vitalsList)&&r.vitalsList.length)?r.vitalsList:[Object.assign({time:'',temp:r.vital_temp||'',pulse:r.vital_pulse||'',bp:r.vital_bp||'',resp:r.vital_resp||'',spo2:r.vital_spo2||'',bst:r.vital_bst||''},(r.vitals&&!Array.isArray(r.vitals))?r.vitals:{})],
    transfer:r.transfer||{
      transferred:!!(r.isTransported||r.is_transported),
      method:r.transportMethod||r.transport_method||'',
      facility:r.transportDest||r.transport_dest||''
    },
    patientStatus:r.patientStatus||r.patient_status||'',
    consciousness:r.consciousness||'명료',
    guardianContact:r.guardianContact||r.guardian_contact||'',
    homeroomTeacher:r.homeroomTeacher||r.homeroom_teacher||'',
    authorDate:r.authorDate||r.author_date||'',
    authorName:r.authorName||r.author_name||'',
    photoData:r.photoData||extra.photoData||'',
    notes:r.notes||r.memo||''
  });
}
function _ecLoadFromDB(){
  const yr=String(_academicYear());
  if(window.electronAPI&&window.electronAPI.recordsGetEmergency){
    window.electronAPI.recordsGetEmergency(yr).then(function(res){
      if(res&&res.success&&Array.isArray(res.data)){
        S.ecRecords=res.data.map(_ecHydrate);
        S.ecNextId=S.ecRecords.length?Math.max.apply(null,S.ecRecords.map(function(r){return r.id||0;}))+1:1;
        S.ecRecords=S.ecRecords;S.ecNextId=S.ecNextId;
        /* _bmData 복원 (응급처치 바디맵) */
        S.ecRecords.forEach(function(r){
          try{const ex=r.extra_json?JSON.parse(r.extra_json):null;if(ex&&ex.bodymap){window._bmData=window._bmData||{};window._bmData[r.id]=ex.bodymap;}}catch(e){}
        });
        if(typeof renderEcList==='function')renderEcList();
      }
    }).catch(function(err){console.error('[DB] emergency load 실패:',err);});
  }
}

function _attachEcListDelegation(tbody){
  if(tbody._ecListBound)return; /* 중복 바인딩 방지 */
  tbody._ecListBound=true;
  tbody.addEventListener('click',function(e){
    const actionEl=e.target.closest('[data-action]');
    if(actionEl){
      e.stopPropagation();
      const action=actionEl.dataset.action;
      if(action==='toggleMemo'){toggleMemo(actionEl.dataset.sid,Number(actionEl.dataset.rid),actionEl);return;}
      if(action==='ecDeleteFromList'){ecDeleteFromList(Number(actionEl.dataset.rid));return;}
    }
    const tr=e.target.closest('tr[data-stu-id]');
    if(!tr)return;
    if(window._dd&&(window._dd.moved||window._dd.popupOpen))return;
    if(S._dragSelectedRecIds&&S._dragSelectedRecIds.length>0)return;
    tbody.querySelectorAll('tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
    tr.classList.add('daily-selected');
    S._visitHistoryLocked=false;
    showVisitHistory(tr.dataset.stuId);
    S._visitHistoryLocked=true;
  });
}

export function renderEcList(){
  const acYr=_academicYear();const acStart=acYr+'-03-01';const acEnd=(acYr+1)+'-03-01';
  const label=document.getElementById('ecYearLabel');
  if(label)label.textContent=acYr+'학년도 응급처치 기록';
  /* 날짜 필터 — accidentDate·authorDate·date 중 존재하는 것으로 판정 (빈 날짜도 목록 유지) */
  const _ecGetDate=function(r){return r.date||r.accidentDate||r.authorDate||'';};
  const yearRecs=S.ecRecords.filter(function(r){const d=_ecGetDate(r);return !d||(d>=acStart&&d<acEnd);}).sort(function(a,b){const da=_ecGetDate(a)||'0000-00-00',db=_ecGetDate(b)||'0000-00-00';return ecSortDir==='asc'?da.localeCompare(db):db.localeCompare(da);});
  const tbody=document.getElementById('ecListBody');
  if(!tbody)return;
  if(!yearRecs.length){
    const _ecEmpty = (typeof createEmptyState==='function')
      ? createEmptyState({icon:'🚑',title:'이 연도의 응급처치 기록이 없습니다',desc:'위 검색창에서 학생을 검색하고 Enter를 누르면<br>새 기록지가 자동 생성됩니다.',actionLabel:'학생 검색'})
      : '<div style="text-align:center;padding:40px;color:var(--t3)"><div style="font-size:36px;margin-bottom:8px">🚑</div>이 연도의 응급처치 기록이 없습니다.</div>';
    tbody.innerHTML='<tr><td colspan="13" style="padding:0;background:transparent">'+_ecEmpty+'</td></tr>';
    const _ecActBtn=tbody.querySelector('[data-empty-action]');
    if(_ecActBtn) _ecActBtn.addEventListener('click',function(){
      if(typeof openAdvancedSearch==='function'){
        openAdvancedSearch(function(id){ if(id) ecSelectStudent(id); });
      } else {
        const el=document.getElementById('ecSearchInput');if(el)el.focus();
      }
    });
    applyEcColLayout();
  } else {
    tbody.innerHTML=yearRecs.map((r,i)=>{
      const s=getStu(r.studentId);
      const ai=r.accidentInfo||{};
      const ecIsStaff=s.type==='staff';
      const ecIsCare=s.status==='caution'||s.status==='watch';
      const ecGradeCol=ecIsStaff?(s.position||'교직원'):s.grade+'-'+s.cls;
      const vi=r.vitals||{};
      const vsParts=[vi.temp?vi.temp+'°C':'',vi.bp||'',vi.pulse?'맥박'+vi.pulse:'',vi.resp?'호흡'+vi.resp:'',vi.spo2?'SpO₂'+vi.spo2:''].filter(Boolean).join(' ')||'-';
      const tf=r.transfer||{};
      const ecHasMemo=_memoHasAny(r.studentId)?'📌':'';
      const ecDateDisplay=(r.authorDate||r.date||'-');
      const _ecDtParts=(ai.datetime||'').replace('T',' ').split(' ');
      const ecDatetimeDisplay=_ecDtParts.length>1?_ecDtParts[1]:(_ecDtParts[0]||'-');
      const _ecLvShort=(s.type==='staff')?'':((function(){const m={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};return m[s.level]||s.level||'';})());
      return '<tr style="cursor:pointer;position:relative" data-rec-id="'+r.id+'" data-stu-id="'+(r.studentId||r.personUid||'')+'">'
        +'<td data-col-index="0" class="mono" style="text-align:center">'+(i+1)+'</td>'
        +'<td data-col-index="1" class="mono">'+ecDateDisplay+'</td>'
        +'<td data-col-index="12" style="text-align:center">'+escHtml(_ecLvShort||'-')+'</td>'
        +'<td data-col-index="2">'+ecGradeCol+'</td>'
        +'<td data-col-index="3" class="mono">'+(ecIsStaff?'-':s.num||'-')+'</td>'
        +'<td data-col-index="4" style="text-align:center">'+(ecIsCare?'<span class="yo-chip-wrap"><span class="yo-badge">요보호</span><span class="yo-chip-pop">'+getCareTooltipHtml(s)+'</span></span>':'')+'</td>'
        +'<td data-col-index="5" style="text-align:center">'+_ecInfNameHtml(s,r.id,'_ecShowNamePop')+'</td>'
        +'<td data-col-index="6" class="mono" style="white-space:nowrap">'+ecDatetimeDisplay+'</td>'
        +'<td data-col-index="7">'+escHtml(ai.location||'-')+'</td>'
        +'<td data-col-index="8" style="font-size:10px">'+escHtml(vsParts)+'</td>'
        +'<td data-col-index="9" style="text-align:center">'+(tf.transferred?'예':'-')+'</td>'
        +'<td data-col-index="10">'+escHtml(tf.facility||'-')+'</td>'
        +'<td data-col-index="11" style="position:relative;padding-right:32px"><span class="memo-plus" data-action="toggleMemo" data-sid="'+r.studentId+'" data-rid="'+r.id+'">'+(ecHasMemo||'+')+'</span><button class="row-delete-x" data-action="ecDeleteFromList" data-rid="'+r.id+'">✕</button></td>'
        +'</tr>';
    }).join('');
    applyEcColLayout();
    _initEcInfHScroll('ecListCard');
    _attachEcListDelegation(tbody);
    _bindEcInfNameCells(tbody);
  }
  /* 전광판 — 학년도·학생·교직원 단일 층 + 제목줄 */
  (function(){
    const vc=document.getElementById('ecVisitorCount');if(!vc)return;
    const stuCnt=yearRecs.filter(function(r){return getStu(r.studentId).type!=='staff';}).length;
    const staffCnt=yearRecs.filter(function(r){return getStu(r.studentId).type==='staff';}).length;
    const total=stuCnt+staffCnt;
    const _ecCurU=S._currentUser||{};
    const _ecSchool=_ecCurU.school_name||S.settings.schoolName||'';
    function fD(n,cls,d){let s=String(n);while(s.length<(d||3))s='0'+s;return s.split('').map(function(c){return '<div class="flip-digit '+cls+' flipping"><span>'+c+'</span></div>';}).join('');}
    let h='<div class="flip-board" style="flex-direction:column;align-items:center;gap:7px;padding:5px 10px;border:1.5px solid #444;border-radius:0">'
      +'<div class="flip-title-text" style="font-size:11px;font-weight:700;letter-spacing:0.5px">'+escHtml(_ecSchool?_ecSchool+' ':'')+'응급 환자 발생 현황</div>'
      +'<div style="display:flex;align-items:center;gap:5px">'
        +'<div class="flip-section"><span class="flip-label flip-stat-total">'+acYr+'학년도</span>'+fD(total,'cyan',3)+'</div>'
        +'<span class="flip-sep">│</span>'
        +'<div class="flip-section"><span class="flip-label flip-stat-stu">학생</span>'+fD(stuCnt,'blue',3)+'</div>'
        +'<span class="flip-sep">│</span>'
        +'<div class="flip-section"><span class="flip-label flip-stat-staff">교직원</span>'+fD(staffCnt,'purple',2)+'</div>'
      +'</div></div>';
    vc.innerHTML=h;
  })();
}

export function ecAutoComplete(){
  const input=document.getElementById('ecSearchInput');
  const q=input.value.trim();
  const list=document.getElementById('ecACList');
  ecAcHighlight=-1;
  if(!q){list.classList.remove('show');return;}
  const qLower=q.toLowerCase();
  function _ecVisitCount(sid){return S.records.filter(function(r){return r.studentId===sid;}).length;}
  function _ecNameSort(a,b){const vc=_ecVisitCount(b.id)-_ecVisitCount(a.id);if(vc!==0)return vc;return a.name.localeCompare(b.name,'ko');}
  const _ecStart=S.people.filter(function(s){ return matchKoreanFromStart(s.name,q); });
  const _ecOther=S.people.filter(function(s){
    if(_ecStart.indexOf(s)>=0) return false;
    if(matchKorean(s.name,q)) return true;
    const isStf=s.type==='staff';
    const str=isStf?(s.name+' '+(s.position||'교직원')):(s.name+' '+gradeClsLabel(s.grade,s.cls)+(isKinder()?'':s.num+'번'));
    return str.toLowerCase().indexOf(qLower)>=0;
  });
  _ecStart.sort(_ecNameSort);_ecOther.sort(_ecNameSort);
  const matched=_ecStart.concat(_ecOther).slice(0,100);
  if(!matched.length){list.classList.remove('show');return;}
  list.innerHTML=matched.map(function(s,i){
    const isCare=s.status==='caution'||s.status==='watch';
    const isStf=s.type==='staff';
    const info=isStf?'['+(s.position||'교직원')+(isCare?' *요보호*':'')+']':'['+gradeClsLabel(s.grade,s.cls)+(isKinder()?'':' '+s.num+'번')+(isCare?' *요보호*':'')+']';
    return '<div class="ac-item" data-idx="'+i+'" data-stu-id="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
  }).join('');
  list.querySelectorAll('.ac-item').forEach(function(el){
    el.addEventListener('click',function(){ecSelectStudent(el.dataset.stuId);});
    el.addEventListener('mouseenter',function(){ecAcHighlight=Number(el.dataset.idx);ecHighlightAC();});
  });
  list.classList.add('show');
}

function ecHighlightAC(){
  document.querySelectorAll('#ecACList .ac-item').forEach(function(el,i){el.classList.toggle('highlighted',i===ecAcHighlight);});
}

export function ecSearchKeydown(e){
  const items=document.querySelectorAll('#ecACList .ac-item');
  if(e.key==='ArrowDown'){e.preventDefault();ecAcHighlight=Math.min(ecAcHighlight+1,items.length-1);ecHighlightAC();}
  else if(e.key==='ArrowUp'){e.preventDefault();ecAcHighlight=Math.max(ecAcHighlight-1,0);ecHighlightAC();}
  else if(e.key==='Enter'){e.preventDefault();if(ecAcHighlight>=0&&items[ecAcHighlight])items[ecAcHighlight].click();else if(items.length)items[0].click();const _eci=document.getElementById('ecSearchInput');_eci.value='';_eci.blur();}
  else if(e.key==='Escape'){document.getElementById('ecACList').classList.remove('show');const _eci2=document.getElementById('ecSearchInput');_eci2.value='';_eci2.blur();}
}

export function ecSelectStudent(id){
  document.getElementById('ecSearchInput').value='';
  document.getElementById('ecACList').classList.remove('show');
  const s=getStu(id);
  const now=new Date();
  const dateStr=toDateStr(now);
  const timeStr=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const _ecPType=(s&&s.type==='staff')?'staff':'student';
  const newRec={
    id:S.ecNextId++,date:dateStr,personUid:id,personType:_ecPType,studentId:id,
    accidentInfo:{datetime:dateStr+' '+timeStr,location:'',situation:''},
    patientStatus:'',consciousness:'명료',
    vitals:{temp:'',pulse:'',bp:'',resp:'',spo2:''},
    summary:'',photoData:'',treatment:'',
    transfer:{transferred:false,method:'',facility:''},
    authorDate:dateStr,authorName:S.settings.nurse1||'',
    guardianContact:s.guardianContact||'',
    homeroomTeacher:s.homeroomTeacher||'',
    notes:''
  };
  addEcRecord(newRec);
  /* 새 레코드 즉시 DB 삽입하여 _dbId 확보 */
  if(window.electronAPI&&window.electronAPI.recordsEmergencyInsert){
    window.electronAPI.recordsEmergencyInsert(_ecToDbRow(newRec)).then(function(res){
      if(res&&res.success&&res.id){newRec._dbId=res.id;newRec.id=res.id;ecCurrentId=res.id;}
    }).catch(function(err){console.error('[DB] emergency insert 실패:',err);});
  }
  openEcForm(newRec.id);
}

/* 의식 상태 라디오(명료/혼미/반혼수/혼수) + "자유기술"(주관식) 행 생성.
 * fieldKey: 저장 대상 rec 속성(consciousness=발생당시, recConsciousness=기록시점).
 * 프리셋이 아니면 자유기술로 간주하고 그 텍스트를 fieldKey 에 그대로 저장. */
function _ecConsciousnessRow(label, groupName, curVal, fieldKey, etcVal){
  const presets=['명료','혼미','반혼수','혼수'];
  const etcKey=fieldKey+'Etc';
  let h='<td class="ec-label">'+label+'</td><td colspan="5">';
  h+='<div class="ec-radio-group" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">';
  presets.forEach(function(p){
    h+='<span class="ec-cs-opt" style="display:inline-flex;align-items:center;gap:2px;white-space:nowrap">'
      +'<label style="display:inline-flex;align-items:center;gap:3px;margin:0"><input type="radio" name="'+groupName+'" value="'+p+'" '+(curVal===p?'checked':'')+' data-ec-csfield="'+fieldKey+'"> '+p+'</label>'
      +'<button type="button" class="ec-cs-pencil" data-ec-csdetail="'+etcKey+'" data-tooltip="필요시 연필 아이콘을 클릭하여 더 자세히 기록할 수 있습니다." data-tooltip-instant="1">✏️</button>'
      +'</span>';
  });
  h+='</div>';
  /* 상세 기록 — 라디오 아래 줄에 펼쳐짐 */
  h+='<textarea class="ec-cs-etc" data-ec-csetc="'+etcKey+'" rows="1" placeholder="상세 기록 (필요시 연필 아이콘 클릭) — 내용에 따라 칸이 늘어납니다" style="width:100%;box-sizing:border-box;margin-top:7px;min-height:36px;resize:none;overflow:hidden;padding:7px 10px;'+(etcVal?'':'display:none')+'">'+escHtml(etcVal||'')+'</textarea>';
  h+='</td>';
  return h;
}
function ecBuildFormHtml(rec){
  const s=getStu(rec.studentId);
  const gc=rec.guardianContact||s.guardianContact||'';
  const ht=rec.homeroomTeacher||s.homeroomTeacher||'';
  const ai=rec.accidentInfo||{};
  const aiDatetime=ai.datetime||'';const aiDate=aiDatetime.split(' ')[0]||'';const aiTime=aiDatetime.split(' ')[1]||'';
  const v=rec.vitals||{};
  const tr=rec.transfer||{};
  const photoHtml=rec.photoData
    ?'<img src="'+rec.photoData+'" id="ecPhotoPreview"><button class="ec-photo-remove" data-action="ecRemovePhoto">✕</button>'
    :'<div class="ec-photo-hint"><div style="font-size:22px;line-height:1;margin-bottom:3px">📁</div><div>파일을 복사하여 여기에 붙여넣기, 드래그 앤 드랍,</div><div>여기를 클릭하여 찾아주세요.</div></div>';
  /* disabled 는 클릭 이벤트 자체를 삼키므로 readonly 로 전환 — 클릭 시 자동 활성화 가능 */
  const trDisabled=tr.transferred?'':'readonly';
  const trOpacity=tr.transferred?'':'opacity:0.4;';

  const _ecIsStaff=s.type==='staff';
  /* 학년-반 표기: [(학교급) ][학과 ]학년-반 — 학교급 여러 개면 (초)/(고) 접두, 학과 있으면 학과명 접두 */
  const _ecMulti=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const _ecLvPfx=_ecMulti?('('+((typeof getLevelShort==='function'?getLevelShort(s):'')||'')+') '):'';
  const _ecDeptPfx=((s.department||'').trim())?(String(s.department).trim()+' '):'';
  const _ecGradeBase=isKinder()?('만'+s.grade+'세-'+s.cls+'반'):(s.grade+'-'+s.cls);
  const _ecGradeVal=_ecIsStaff?(rec.displayGrade!==undefined?rec.displayGrade:''):(_ecLvPfx+_ecDeptPfx+_ecGradeBase);
  const _ecNumVal=_ecIsStaff?(rec.displayNum!==undefined?rec.displayNum:''):(isKinder()?'':s.num);
  const _ecGenderVal=_ecIsStaff?(rec.displayGender!==undefined?rec.displayGender:(s.gender||'')):(s.gender||'');
  return '<h2>응 급 처 치 &nbsp; 기 록 지</h2>'
    +'<table class="ec-ftable"><tr>'
    +'<td class="ec-label">이 름</td><td><input value="'+s.name+'" readonly style="font-weight:700;background:#fff;text-align:center"></td>'
    +'<td class="ec-label">'+(isKinder()?'나이-반':'학년반번호')+'</td><td colspan="3"><input data-field="displayGrade" value="'+(_ecIsStaff?escHtml(_ecGradeVal):escHtml((_ecGradeVal+(_ecNumVal?(' '+_ecNumVal+(isKinder()?'':'번')):'')).trim()))+'"'+(_ecIsStaff?'':' readonly')+' style="background:#fff;text-align:center"></td>'
    +'<td class="ec-label">성 별</td><td><input data-field="displayGender" value="'+escHtml(_ecGenderVal)+'"'+(_ecIsStaff?'':' readonly')+' style="background:#fff;width:40px;text-align:center"></td>'
    +'</tr><tr>'
    +'<td class="ec-label">보호자<br>연락처</td><td colspan="3"><input data-field="guardianContact" value="'+gc+'" placeholder="보호자 연락처 입력" style="text-align:center"></td>'
    +'<td class="ec-label">담임교사</td><td colspan="3"><input data-field="homeroomTeacher" value="'+ht+'" placeholder="담임교사명 입력" style="text-align:center"></td>'
    +'</tr></table>'
    +'<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">사 고 &nbsp; 발 생 &nbsp; 정 보</td></tr>'
    +'<tr><td class="ec-label">날 짜</td><td><div style="display:flex;gap:3px;align-items:center"><input id="ecAccidentDate" value="'+aiDate+'" placeholder="YYYY-MM-DD" readonly style="cursor:pointer;font-size:11px;flex:1;min-width:0;text-align:center"><button data-inf-cal data-action="infOpenCal" data-field-id="ecAccidentDate" type="button" style="border:1px solid #ccc;background:#f5f5f5;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:12px;flex-shrink:0">📅</button></div></td>'
    +'<td class="ec-label">시 간</td><td colspan="3"><div style="display:flex;gap:3px;align-items:center"><input id="ecAccidentTime" value="'+aiTime+'" placeholder="HH:MM" readonly style="cursor:pointer;font-size:11px;flex:1;min-width:0;text-align:center"><button type="button" data-action="openClockPicker" data-field-id="ecAccidentTime" style="border:1px solid #ccc;background:#f5f5f5;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:14px;flex-shrink:0">🕐</button></div></td></tr>'
    +'<tr><td class="ec-label">장 소</td><td colspan="5"><textarea data-field="accidentInfo.location" class="ec-autogrow" rows="1" placeholder="사고 발생 장소" style="width:100%;box-sizing:border-box;min-height:32px;resize:none;overflow:hidden;padding:6px 10px;text-align:center">'+escHtml(ai.location||'')+'</textarea></td></tr>'
    +'<tr>'+_ecConsciousnessRow('발생 당시<br>의식 상태','ecConsciousness',rec.consciousness||'명료','consciousness',rec.consciousnessEtc)+'</tr>'
    +'<tr><td class="ec-label">사고 발생<br>상황 및 개요</td><td colspan="5" style="padding:0"><textarea data-field="accidentInfo.situation" placeholder="사고 발생 상황 및 개요를 자세히 기술하세요..." style="min-height:120px;padding:10px">'+escHtml(ai.situation||rec.summary||'')+'</textarea></td></tr></table>'
    +'<div id="ecVitalsBox"></div>'
    +'<table class="ec-ftable"><tr><td colspan="2" class="ec-section-title">응 급 처 치 &nbsp; 기 록</td></tr>'
    +'<tr><td colspan="2" style="padding:0"><textarea data-field="treatment" placeholder="실시한 응급처치 내용을 기록하세요..." style="min-height:80px;padding:10px">'+escHtml(rec.treatment||'')+'</textarea></td></tr></table>'
    +'<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">기 록 &nbsp; 시 점 의 &nbsp; 환 자 &nbsp; 의 식 &nbsp; 및 &nbsp; 상 태</td></tr>'
    +'<tr>'+_ecConsciousnessRow('의식 상태','ecRecConsciousness',rec.recConsciousness||'','recConsciousness',rec.recConsciousnessEtc)+'</tr>'
    +'<tr><td class="ec-label">환자 상태</td><td colspan="5"><textarea data-field="patientStatus" class="ec-autogrow" rows="1" placeholder="의식 상태 선택 시 자동 기입됩니다 — 이어서 자세히 기술하세요" style="width:100%;box-sizing:border-box;min-height:36px;resize:none;overflow:hidden;padding:7px 10px">'+escHtml(rec.patientStatus||'')+'</textarea></td></tr></table>'
    +'<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">이 송 &nbsp; 정 보</td></tr>'
    +'<tr><td class="ec-label">이송 여부</td><td><div class="ec-transfer-toggle">'
    +'<label><input type="radio" name="ecTransfer" value="yes" '+(tr.transferred?'checked':'')+'> 이송</label>'
    +'<label><input type="radio" name="ecTransfer" value="no" '+(!tr.transferred?'checked':'')+'> 미이송</label>'
    +'</div></td>'
    +'<td class="ec-label" id="ecTransferMethodLabel" style="'+trOpacity+'">이송 수단</td>'
    +'<td><input class="ec-ph-dark" data-field="transfer.method" value="'+(tr.method||'')+'" placeholder="구급차, 자가용 등" id="ecTransferMethod" '+trDisabled+' style="text-align:center;'+trOpacity+'"></td>'
    +'<td class="ec-label" id="ecTransferFacilityLabel" style="'+trOpacity+'">이송 기관</td>'
    +'<td><input class="ec-ph-dark" data-field="transfer.facility" value="'+(tr.facility||'')+'" placeholder="○○병원" id="ecTransferFacility" '+trDisabled+' style="text-align:center;'+trOpacity+'"></td></tr></table>'
    +'<table class="ec-ftable"><tr><td colspan="2" class="ec-section-title">주 의 사 항 &nbsp; (메 모)</td></tr>'
    +'<tr><td colspan="2" style="padding:0"><textarea data-field="notes" class="ec-autogrow" rows="1" placeholder="주의사항이나 메모를 입력하세요..." style="width:100%;box-sizing:border-box;min-height:60px;resize:none;overflow:hidden;padding:10px">'+escHtml(rec.notes||'')+'</textarea></td></tr></table>'
    +'<table class="ec-ftable"><tr><td colspan="4" class="ec-section-title">작 성 &nbsp; 정 보</td></tr>'
    +'<tr><td class="ec-label">작성일</td><td><div style="display:flex;gap:3px;align-items:center"><input id="ecAuthorDate" data-field="authorDate" value="'+(rec.authorDate||'')+'" placeholder="YYYY-MM-DD" readonly style="cursor:pointer;flex:1"><button data-inf-cal type="button" data-action="infOpenCal" data-field-id="ecAuthorDate" style="border:1px solid #ccc;background:#f5f5f5;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:12px;flex-shrink:0">📅</button></div></td>'
    +'<td class="ec-label">작성자</td><td><input data-field="authorName" value="'+(rec.authorName||'')+'" placeholder="작성자 이름" style="text-align:center"></td></tr></table>'
    +'<div class="ec-autosave-msg">모든 내용이 자동으로 저장되어 창을 종료해도 상태가 유지됩니다.</div>'
    +'<div class="ec-btn-bar"><button class="btn-print" data-action="ecPrintForm">🖨 인쇄</button><button class="btn-pdf" data-action="ecPdfForm">📄 PDF 저장</button></div>';
}

/* ── 활력징후(시간별 다중 측정) ── rec.vitalsList = [{time,temp,pulse,bp,resp,spo2,bst}, ...] ── */
function _ecEnsureVitalsList(rec){
  if(!Array.isArray(rec.vitalsList)){
    const v=(rec.vitals&&typeof rec.vitals==='object'&&!Array.isArray(rec.vitals))?rec.vitals:{};
    rec.vitalsList=[{time:v.time||'',temp:v.temp||'',pulse:v.pulse||'',bp:v.bp||'',resp:v.resp||'',spo2:v.spo2||'',bst:v.bst||''}];
  }
  if(!rec.vitalsList.length)rec.vitalsList.push({time:'',temp:'',pulse:'',bp:'',resp:'',spo2:'',bst:''});
  return rec.vitalsList;
}
/* 첫 측정을 rec.vitals 에 동기화 — DB flat 컬럼·목록 표시·구버전 호환 유지 */
function _ecSyncVitals(rec){ rec.vitals=Object.assign({time:'',temp:'',pulse:'',bp:'',resp:'',spo2:'',bst:''},rec.vitalsList[0]||{}); }
function _ecVCell(k,i,val,ph){ return '<td><input data-vl="'+k+'" data-vl-i="'+i+'" value="'+escHtml(val||'')+'" placeholder="'+ph+'" style="text-align:center"></td>'; }
/* 시계 팝업을 측정시간 입력란 옆에, 시:분 드럼(#cpDrumH)이 입력란 세로 중앙에 오도록 재배치 */
function _ecAlignVitalClock(fid){
  try{
    var inp=document.getElementById(fid), wrap=document.getElementById('clockPickerWrap');
    if(!inp||!wrap||wrap.style.display==='none')return;
    var ir=inp.getBoundingClientRect(), wr=wrap.getBoundingClientRect();
    var drum=document.getElementById('cpDrumH');
    var drumOff = drum ? ((drum.getBoundingClientRect().top - wr.top) + drum.getBoundingClientRect().height/2) : 56;
    var top = (ir.top + ir.height/2) - drumOff;
    var left = ir.right + 12;
    if(left + wr.width > window.innerWidth - 8) left = ir.left - wr.width - 12;
    if(left < 8) left = 8;
    top = Math.max(8, Math.min(top, window.innerHeight - wr.height - 8));
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
  }catch(_e){}
}
function _ecRenderVitals(rec){
  const box=document.getElementById('ecVitalsBox'); if(!box||!rec)return;
  const list=_ecEnsureVitalsList(rec);
  let h='<table class="ec-ftable"><tr><td colspan="7" class="ec-section-title">활 력 &nbsp; 징 후 &nbsp; (Vital Sign)</td></tr>';
  list.forEach(function(m,i){
    h+='<tr>'
      +'<td class="ec-label ec-vt-cell" rowspan="2" style="vertical-align:middle;width:124px">'
        +'<div style="position:relative">'
          +'<div style="display:flex;gap:3px;align-items:center;justify-content:center">'
            +'<input id="ecVitTime'+i+'" class="ec-vt-time" data-action="openClockPicker" data-field-id="ecVitTime'+i+'" data-vl="time" data-vl-i="'+i+'" value="'+escHtml(m.time||'')+'" placeholder="측정 시간" readonly style="width:74px;text-align:center;cursor:pointer;background:#fff" data-tooltip="클릭하면 시계로 측정 시각을 입력합니다." data-tooltip-instant="1">'
            +'<button type="button" class="ec-vt-clock" data-action="openClockPicker" data-field-id="ecVitTime'+i+'" data-vl-clock="'+i+'" data-tooltip="시계로 측정 시각 입력" data-tooltip-instant="1" style="border:1px solid #ccc;background:#f5f5f5;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:13px;flex-shrink:0">🕐</button>'
          +'</div>'
          +'<div class="ec-vt-btns">'
            +'<button type="button" class="ec-vt-btn ec-vt-add" data-vl-add="1" data-tooltip="아래에 칸 하나를 더 추가합니다." data-tooltip-instant="1">＋ 추가</button>'
            +'<button type="button" class="ec-vt-btn ec-vt-del" data-vl-del="'+i+'" data-tooltip="이 측정치 입력칸을 삭제합니다." data-tooltip-instant="1"'+(list.length<=1?' disabled':'')+'>－ 삭제</button>'
          +'</div>'
        +'</div>'
      +'</td>'
      +'<td class="ec-label">체온(℃)</td>'+_ecVCell('temp',i,m.temp,'예) 36.5')
      +'<td class="ec-label">맥박(bpm)</td>'+_ecVCell('pulse',i,m.pulse,'예) 72')
      +'<td class="ec-label">혈압(mmHg)</td>'+_ecVCell('bp',i,m.bp,'예) 120/80')
      +'</tr><tr>'
      +'<td class="ec-label">호흡(/min)</td>'+_ecVCell('resp',i,m.resp,'예) 18')
      +'<td class="ec-label">SpO2(%)</td>'+_ecVCell('spo2',i,m.spo2,'예) 98')
      +'<td class="ec-label">혈당(mg/dL)</td>'+_ecVCell('bst',i,m.bst,'예) 98')
      +'</tr>';
  });
  h+='</table>';
  box.innerHTML=h;
  /* 동적 콘텐츠 — 렌더 직후 직접 바인딩(위임 대신 확실히) */
  box.querySelectorAll('input[data-vl]').forEach(function(inp){
    inp.addEventListener('input',function(){ var i=parseInt(inp.dataset.vlI,10), k=inp.dataset.vl; if(list[i]){ list[i][k]=inp.value; _ecSyncVitals(rec); ecDebounceSave(); } });
  });
  box.querySelectorAll('.ec-vt-time').forEach(function(inp){
    inp.addEventListener('click',function(){ openClockPicker(inp.id, inp); _ecAlignVitalClock(inp.id); });
  });
  box.querySelectorAll('[data-vl-clock]').forEach(function(btn){
    btn.addEventListener('click',function(){ var fid='ecVitTime'+btn.dataset.vlClock; openClockPicker(fid, btn); _ecAlignVitalClock(fid); });
  });
  box.querySelectorAll('[data-vl-add]').forEach(function(btn){
    btn.addEventListener('click',function(){ hideHeaderTooltip(); list.push({time:'',temp:'',pulse:'',bp:'',resp:'',spo2:'',bst:''}); _ecSyncVitals(rec); ecDebounceSave(); _ecRenderVitals(rec); });
  });
  box.querySelectorAll('[data-vl-del]').forEach(function(btn){
    btn.addEventListener('click',function(){ hideHeaderTooltip(); if(list.length<=1)return; var i=parseInt(btn.dataset.vlDel,10); if(i>=0){ list.splice(i,1); _ecSyncVitals(rec); ecDebounceSave(); _ecRenderVitals(rec); } });
  });
  _ecBindTips(box);
}
function _attachEcFormListeners(container){
  container.querySelectorAll('input[data-field],textarea[data-field]').forEach(function(el){
    el.addEventListener('input',function(){ecFieldChange(el);});
  });
  /* 활력징후 박스 렌더 — 입력/시계팝업/추가·삭제 바인딩은 _ecRenderVitals 내부에서 처리 */
  { const _r=S.ecRecords.find(function(r){return r.id===ecCurrentId;}); if(_r)_ecRenderVitals(_r); }
  const accDate=container.querySelector('#ecAccidentDate');
  const accTime=container.querySelector('#ecAccidentTime');
  if(accDate)accDate.addEventListener('input',function(){ecAccidentCombine();});
  if(accTime)accTime.addEventListener('input',function(){ecAccidentCombine();});
  container.querySelectorAll('input[type="radio"][data-ec-csfield]').forEach(function(el){
    el.addEventListener('change',function(){_ecConsciousnessChange(el);});
  });
  container.querySelectorAll('[data-ec-csetc]').forEach(function(el){
    el.addEventListener('input',function(){_ecConsciousnessEtcChange(el);});
  });
  container.querySelectorAll('.ec-cs-pencil').forEach(function(el){
    el.addEventListener('click',function(){_ecConsciousnessPencil(el);});
  });
  _ecBindTips(container);
  /* 반응형 textarea(상세 기록 + 기록시점 환자 상태) 자동 높이 */
  container.querySelectorAll('.ec-cs-etc, textarea.ec-autogrow').forEach(function(t){
    t.addEventListener('input',function(){_ecAutoGrow(t);});
    if(t.style.display!=='none') _ecAutoGrow(t);
  });
  /* 기록 시점 환자 상태 — 의식 상태 미선택 시 입력 차단(팝업 안내) */
  const _psEl=container.querySelector('textarea[data-field="patientStatus"]');
  if(_psEl){
    _psEl.addEventListener('mousedown',function(e){
      const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
      if(rec && !rec.recConsciousness){ e.preventDefault(); _psEl.blur(); alert('기록 시점의 환자 의식 상태 (바로 위)를 먼저 체크해주세요.'); }
    });
  }
  container.querySelectorAll('input[name="ecTransfer"]').forEach(function(el){
    el.addEventListener('change',function(){ecTransferChange(el.value==='yes');});
  });
  /* 이송 수단·기관 — readonly 상태에서 클릭 시 "이송" 라디오 자동 체크 + 편집 가능 상태로 전환 */
  ['ecTransferMethod','ecTransferFacility'].forEach(function(id){
    const inp=container.querySelector('#'+id);if(!inp)return;
    inp.addEventListener('click',function(){
      if(!inp.hasAttribute('readonly'))return;
      const yes=container.querySelector('input[name="ecTransfer"][value="yes"]');
      if(yes&&!yes.checked){yes.checked=true;}
      ecTransferChange(true);
      setTimeout(function(){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);},30);
    });
  });
  const photoArea=container.querySelector('#ecPhotoArea');
  if(photoArea){
    photoArea.addEventListener('click',function(e){if(!e.target.closest('[data-action="ecRemovePhoto"]'))document.getElementById('ecPhotoInput').click();});
    photoArea.addEventListener('dragover',function(e){e.preventDefault();this.classList.add('dragover');});
    photoArea.addEventListener('dragleave',function(){this.classList.remove('dragover');});
    photoArea.addEventListener('drop',function(e){ecHandlePhotoDrop(e);});
    const removeBtn=photoArea.querySelector('[data-action="ecRemovePhoto"]');
    if(removeBtn)removeBtn.addEventListener('click',function(e){e.stopPropagation();ecRemovePhoto();});
  }
  const photoInput=container.querySelector('#ecPhotoInput');
  if(photoInput)photoInput.addEventListener('change',function(){ecHandlePhotoFile(photoInput);});
  container.querySelectorAll('[data-action="infOpenCal"]').forEach(function(el){
    el.addEventListener('click',function(){if(!this.closest('[disabled]')&&!this.previousElementSibling.disabled)window.infOpenCal(el.dataset.fieldId,el);});
  });
  container.querySelectorAll('[data-action="openClockPicker"]').forEach(function(el){
    el.addEventListener('click',function(){openClockPicker(el.dataset.fieldId,el);});
  });
  /* 날짜·시간 input 직접 클릭도 팝업 열기 — 문서 outside-close 핸들러가 잡지 않도록 data-inf-cal 속성 부여 */
  ['ecAccidentDate','ecAuthorDate'].forEach(function(id){
    const inp=container.querySelector('#'+id);if(!inp||inp.disabled)return;
    inp.setAttribute('data-inf-cal','');
    inp.addEventListener('click',function(e){
      e.stopPropagation();
      if(typeof window.infOpenCal==='function')window.infOpenCal(id,inp);
    });
  });
  ['ecAccidentTime'].forEach(function(id){
    const inp=container.querySelector('#'+id);if(!inp||inp.disabled)return;
    inp.setAttribute('data-action','openClockPicker');
    inp.setAttribute('data-field-id',id);
    inp.addEventListener('click',function(e){
      e.stopPropagation();
      openClockPicker(id,inp);
    });
  });
  const printBtn=container.querySelector('[data-action="ecPrintForm"]');
  if(printBtn)printBtn.addEventListener('click',function(){ecPrintForm();});
  const pdfBtn=container.querySelector('[data-action="ecPdfForm"]');
  if(pdfBtn)pdfBtn.addEventListener('click',function(){ /* 바로 PDF 저장(경로 선택) */
    if(!ecCurrentId)return; const r=S.ecRecords.find(function(x){return x.id===ecCurrentId;}); if(!r)return;
    saveA4Pdf({html:_ecBuildPrintHtml(r), title:_ecPrintFileName(r), cssMargins:true});
  });
}

function openEcForm(recId){
  const rec=S.ecRecords.find(function(r){return r.id===recId;});
  if(!rec)return;
  ecCurrentId=recId;
  const body=document.getElementById('ecFormBody');
  body.innerHTML=ecBuildFormHtml(rec);
  _attachEcFormListeners(body);
  document.getElementById('ecFormOverlay').classList.add('show');
  document.body.style.overflow='hidden';
}

function closeEcForm(){
  /* 팝업 닫을 때 DB에 저장 후 localStorage 임시 삭제 */
  const closingId=ecCurrentId;
  if(closingId){
    const rec=S.ecRecords.find(function(r){return r.id===closingId;});
    if(rec&&window.electronAPI){
      const row=_ecToDbRow(rec);
      if(rec._dbId){
        window.electronAPI.recordsEmergencyUpdate(row).then(function(){
          if(typeof queueGlobalSaveToast==='function')queueGlobalSaveToast();
        }).catch(function(err){console.error('[DB] emergency update 실패:',err);});
      }else{
        window.electronAPI.recordsEmergencyInsert(row).then(function(res){
          if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
          if(typeof queueGlobalSaveToast==='function')queueGlobalSaveToast();
        }).catch(function(err){console.error('[DB] emergency insert 실패:',err);});
      }
    }
    try{localStorage.removeItem('ec_form_draft_EC_'+closingId);}catch(_){}
  }
  document.getElementById('ecFormOverlay').classList.remove('show');
  document.body.style.overflow='';
  ecCurrentId=null;
  if(ecSaveTimer){clearTimeout(ecSaveTimer);ecSaveTimer=null;}
  renderEcList();
}

/* 의식 상태 라디오 변경 — 선택한 프리셋(명료~혼수)을 fieldKey 에 저장.
 * 기록 시점(recConsciousness)이면 바로 아래 "환자 상태"에 의식값을 기입(앞쪽 의식 토큰만 교체). */
function _ecConsciousnessChange(radio){
  if(!ecCurrentId)return; const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;}); if(!rec)return;
  rec[radio.dataset.ecCsfield]=radio.value;
  if(radio.dataset.ecCsfield==='recConsciousness') _ecWriteRecStatus(radio.value);
  ecDebounceSave();
}
/* 선택한 의식 상태를 기록시점 "환자 상태" 칸 앞에 기입 — 기존 의식 토큰이 있으면 교체, 뒤 서술은 유지 */
function _ecWriteRecStatus(val){
  const ps=document.querySelector('textarea[data-field="patientStatus"]'); if(!ps)return;
  const presets=['명료','혼미','반혼수','혼수'];
  let cur=ps.value||'';
  for(let i=0;i<presets.length;i++){ if(cur.indexOf(presets[i])===0){ cur=cur.slice(presets[i].length).replace(/^[\s:,\-]+/,''); break; } }
  ps.value = val + (cur ? ' ' + cur : ' ');
  const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;}); if(rec)rec.patientStatus=ps.value;
  _ecAutoGrow(ps);
}
/* 상세 기록 입력 변경 — etcKey(consciousnessEtc / recConsciousnessEtc) 에 저장 */
function _ecConsciousnessEtcChange(inp){
  if(!ecCurrentId)return; const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;}); if(!rec)return;
  rec[inp.dataset.ecCsetc]=inp.value;
  ecDebounceSave();
}
/* textarea 내용에 맞춰 세로 높이 자동 조절(반응형) */
function _ecAutoGrow(el){ if(!el)return; el.style.height='auto'; el.style.height=(el.scrollHeight)+'px'; }
/* data-tooltip 요소에 증상 화면과 동일한 미니 팝업(showHeaderTooltip) 바인딩 */
function _ecBindTips(root){
  if(!root)return;
  root.querySelectorAll('[data-tooltip]').forEach(function(el){
    if(el._ecTipBound)return; el._ecTipBound=true;
    el.addEventListener('mouseenter',function(ev){ showHeaderTooltip(ev, el.getAttribute('data-tooltip'), false, el.getAttribute('data-tooltip-instant')==='1'); });
    el.addEventListener('mouseleave',function(){ hideHeaderTooltip(); });
    /* 클릭 시(특히 클릭으로 요소가 재렌더되어 사라지면 mouseleave 가 안 떠 툴팁이 남는 문제) 강제로 닫음 */
    el.addEventListener('click',function(){ hideHeaderTooltip(); });
  });
}
/* 연필 클릭 — 같은 행의 상세 기록 입력칸을 펼치고 포커스 */
function _ecConsciousnessPencil(btn){
  const cell=btn.closest('td'); if(!cell)return;
  const etc=cell.querySelector('[data-ec-csetc="'+btn.dataset.ecCsdetail+'"]');
  if(etc){ etc.style.display=''; _ecAutoGrow(etc); setTimeout(function(){etc.focus();},0); }
}
function ecFieldChange(input,directField){
  if(!ecCurrentId)return;
  const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
  if(!rec)return;
  const field=directField||input.dataset.field;
  if(!field)return;
  const value=input.value;
  const parts=field.split('.');
  if(parts.length===2){
    if(!rec[parts[0]])rec[parts[0]]={};
    rec[parts[0]][parts[1]]=value;
  }else{
    rec[field]=value;
  }
  /* summary 수정 시 EMS 저장 메시지에도 반영 */
  if(field==='summary'){
    const emsSaved=JSON.parse(localStorage.getItem('ec_ems_saved')||'[]');
    const stu=getStu(rec.studentId);
    let updated=false;
    emsSaved.forEach(function(s){
      if(s.name===stu.name&&s.date&&s.date.startsWith(rec.date)){
        s.desc=value;
        /* html 미리보기에서 경위 부분 업데이트 */
        const div=document.createElement('div');div.innerHTML=s.html;
        const descEl=div.querySelector('.ems-p-desc');
        if(descEl){descEl.innerHTML='<span class="ems-p-label">경 위:</span><br>'+escHtml(value);}
        s.html=div.innerHTML;
        updated=true;
      }
    });
    if(updated){
      localStorage.setItem('ec_ems_saved',JSON.stringify(emsSaved));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','ems_saved',emsSaved);
    }
  }
  ecDebounceSave();
}

function ecDebounceSave(){
  /* 편집 중: localStorage 임시 저장 */
  if(ecCurrentId){
    const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
    if(rec){
      try{localStorage.setItem('ec_form_draft_EC_'+ecCurrentId,JSON.stringify(rec));}catch(_){}
    }
  }
  const ind=document.getElementById('ecSaveIndicator');
  if(ind){ind.textContent='저장 중…';ind.className='ec-save-indicator saving';}
  if(ecSaveTimer)clearTimeout(ecSaveTimer);
  ecSaveTimer=setTimeout(function(){
    /* 실제 DB 반영 + 리스트 실시간 갱신 */
    if(ecCurrentId){
      const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
      if(rec&&window.electronAPI){
        const row=_ecToDbRow(rec);
        if(rec._dbId){
          window.electronAPI.recordsEmergencyUpdate(row).then(function(){
            if(typeof renderEcList==='function')renderEcList();
          }).catch(function(err){console.error('[DB] emergency update 실패:',err);});
        } else if(window.electronAPI.recordsEmergencyInsert){
          window.electronAPI.recordsEmergencyInsert(row).then(function(res){
            if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
            if(typeof renderEcList==='function')renderEcList();
          }).catch(function(err){console.error('[DB] emergency insert 실패:',err);});
        } else if(typeof renderEcList==='function'){
          renderEcList();
        }
      } else if(typeof renderEcList==='function'){
        renderEcList();
      }
    }
    if(ind){ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';}
    setTimeout(function(){if(ind)ind.className='ec-save-indicator hide';},3000);
  },400);
}

function ecAccidentCombine(){
  const d=document.getElementById('ecAccidentDate');
  const t=document.getElementById('ecAccidentTime');
  const combined=(d?d.value:'').trim()+' '+(t?t.value:'').trim();
  const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
  if(rec){
    if(!rec.accidentInfo)rec.accidentInfo={};
    rec.accidentInfo.datetime=combined.trim();
    ecDebounceSave();
  }
}

/* ─── Clock Picker (drag & click) ─── */
let _cpHour=0, _cpMin=0, _cpMode='hour', _cpField=null;
let _cpMoveH=null, _cpUpH=null;

/* 시계 드래그 상태·오버레이 — 모듈 레벨에 둔다.
 *  과거엔 cpRender 안의 클로저 지역변수였는데, 드래그 도중 cpRender 가 한 번이라도 다시
 *  호출되면(예: 자동 포커스된 시/분 드럼 input 의 blur → finalApply → cpRender) 새 클로저가
 *  mouseup 리스너를 새로 달면서 옛 오버레이 참조를 잃어, 마우스를 떼도 화면 전체를 덮은
 *  cursor:grabbing 오버레이(#cpDragOverlay)가 제거되지 않아 모든 클릭이 잠기는 버그가 있었다.
 *  모듈 레벨로 올려 두면 어느 cpRender 세대의 mouseup 이 실행되든 같은 상태를 정리한다. */
let dragTarget=null;
let _cpDragOverlay=null;
function _cpAddDragOverlay(){
  if(_cpDragOverlay)return;
  _cpDragOverlay=document.createElement('div');
  _cpDragOverlay.id='cpDragOverlay';
  _cpDragOverlay.style.cssText='position:fixed;inset:0;z-index:99998;cursor:grabbing;background:transparent';
  document.body.appendChild(_cpDragOverlay);
}
function _cpRemoveDragOverlay(){
  /* id 기반 폴백까지 둬서 어떤 경로로든 떠 있는 오버레이를 확실히 제거 */
  const el=_cpDragOverlay||document.getElementById('cpDragOverlay');
  if(el&&el.parentNode)el.parentNode.removeChild(el);
  _cpDragOverlay=null;
}

export function cpCleanHandlers(){
  if(_cpMoveH){document.removeEventListener('mousemove',_cpMoveH);_cpMoveH=null;}
  if(_cpUpH){document.removeEventListener('mouseup',_cpUpH);_cpUpH=null;}
}

let _cpOutsideHandler=null;
export function closeClockPickerAnim(){
  const wrap=document.getElementById('clockPickerWrap');if(!wrap)return;
  if(wrap.style.display==='none'||!wrap.style.display)return;
  cpCleanHandlers();
  /* 드래그 도중 닫힌 경우 mouseup 이 안 올 수 있으니 드래그 상태·오버레이를 여기서도 정리 */
  dragTarget=null;
  _cpRemoveDragOverlay();
  if(_cpOutsideHandler){document.removeEventListener('mousedown',_cpOutsideHandler,true);_cpOutsideHandler=null;}
  wrap.style.transition='opacity 0.18s ease, transform 0.18s ease';
  wrap.style.opacity='0';
  wrap.style.transform='scale(0.94)';
  setTimeout(function(){
    wrap.style.display='none';
    wrap.style.transition='';
    wrap.style.transform='';
    wrap.style.opacity='';
  },180);
}
export function openClockPicker(fieldId,btn){
  /* 달력 팝업이 열려 있으면 먼저 닫기 — 동시 표시 방지 */
  const _calWrap=document.getElementById('infCalWrap');
  if(_calWrap&&_calWrap.style.display!=='none')_calWrap.style.display='none';
  _cpField=fieldId;
  /* 분 완료 콜백 초기화 — openTimePicker 경로면 그 함수가 이후 재설정. 직접 호출(응급/감염 폼) 경로면 null 이라
   *  분 완료 시 stale 콜백으로 엉뚱하게 퇴실 전환되지 않고 그냥 저장 후 닫힘 (사용자 요청 2026-05-28 회귀 방지). */
  window._cpMinuteAdvance = null;
  /* 위치 계산에 필요한 rect를 cpAutoSave가 DOM을 재렌더링하기 전에 먼저 캡처 */
  const btnRect=btn?btn.getBoundingClientRect():null;
  const inp=document.getElementById(fieldId);
  const val=inp?inp.value.trim():'';
  let _cpParsed=false;
  if(val){
    const m1=val.match(/^(\d{1,2}):(\d{2})$/);
    if(m1){_cpHour=parseInt(m1[1],10)||0;_cpMin=parseInt(m1[2],10)||0;_cpParsed=true;}
    else{const m2=val.match(/^(\d{1,2})(\d{2})$/);if(m2){_cpHour=parseInt(m2[1],10)||0;_cpMin=parseInt(m2[2],10)||0;_cpParsed=true;}}
    if(_cpParsed){
      _cpHour=Math.min(23,Math.max(0,_cpHour));
      _cpMin=Math.min(59,Math.max(0,_cpMin));
      /* 정규화한 값이 원래 값과 다를 때만 저장 (예: "9:5" → "09:05" 형식 보정).
       * 같은 값이면 단순히 셀을 클릭해 픽커를 연 것 — 저장/토스트 발화 금지. */
      const _norm=cpPad(_cpHour)+':'+cpPad(_cpMin);
      if(_norm!==val)cpAutoSave();
    }
  }
  if(!_cpParsed){const now=new Date();_cpHour=now.getHours();_cpMin=now.getMinutes();}
  _cpMode='hour';
  const wrap=document.getElementById('clockPickerWrap');if(!wrap)return;
  /* 이전 상태 초기화 */
  wrap.style.transition='';
  wrap.style.transform='';
  wrap.style.opacity='';
  /* 모달(EC 폼 등) 위에 확실히 그려지도록 body 맨 끝으로 이동 — z-index 만으로 페인트가 안 되는 환경 대비 */
  try{ if(document.body.lastElementChild!==wrap) document.body.appendChild(wrap); }catch(_e){}
  wrap.style.display='block';
  cpRender();
  const ww=wrap.offsetWidth||248, wh=wrap.offsetHeight||390;
  const rect=(btnRect&&(btnRect.left||btnRect.top||btnRect.bottom||btnRect.right))?btnRect:(btn&&btn.isConnected?btn.getBoundingClientRect():{left:window.innerWidth/2-ww/2,top:window.innerHeight/2-wh/2,bottom:window.innerHeight/2+wh/2,right:window.innerWidth/2+ww/2});
  /* 기본 위치: 앵커 오른쪽/하단 → 화면 밖이면 좌/상으로 반전 */
  let left=rect.right+4;
  if(left+ww>window.innerWidth-8)left=rect.left-ww-4;
  if(left<8)left=Math.max(8,rect.left);
  if(left+ww>window.innerWidth-8)left=window.innerWidth-ww-8;
  let top=rect.bottom+4;
  if(top+wh>window.innerHeight-8)top=rect.top-wh-4;
  if(top<8)top=Math.max(8,rect.top);
  if(top+wh>window.innerHeight-8)top=window.innerHeight-wh-8;
  wrap.style.left=left+'px';wrap.style.top=top+'px';
  /* 외부 클릭 감지 — 앵커/시계 팝업 외부 클릭 시 애니메이션으로 닫기 */
  if(_cpOutsideHandler){document.removeEventListener('mousedown',_cpOutsideHandler,true);}
  const anchorEl=btn||null;
  _cpOutsideHandler=function(e){
    const w=document.getElementById('clockPickerWrap');
    if(!w||w.style.display==='none')return;
    if(w.contains(e.target))return;
    if(anchorEl&&anchorEl.isConnected&&anchorEl.contains(e.target))return;
    closeClockPickerAnim();
  };
  /* 현재 클릭 이벤트가 버블링 후 즉시 닫히는 것 방지 */
  setTimeout(function(){document.addEventListener('mousedown',_cpOutsideHandler,true);},0);
  /* 팝업 열리면 시(hour) 자동 블록 — 키보드 숫자 즉시 입력 가능 (사용자 요청 2026-05-28).
   *  cpRender 로 드럼이 그려진 뒤 활성화. 외부 클릭 핸들러 등록(위 setTimeout 0)보다 뒤 시점이라 즉시 닫힘 충돌 없음. */
  setTimeout(function(){
    const w=document.getElementById('clockPickerWrap');
    if(!w||w.style.display==='none')return;
    const hEdit=document.querySelector('#cpDrumH [data-role="edit"]');
    if(hEdit)_cpStartDrumEdit(hEdit);
  },60);
}

function cpCalcAngle(e,svgEl){
  const r=svgEl.getBoundingClientRect();
  const dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
  const ang=Math.atan2(dy,dx)*180/Math.PI+90;
  return((ang%360)+360)%360;
}
function cpAngleToHour(ang){const h=Math.round(ang/30);return((h-1+12)%12)+1;}
function cpAngleToMin(ang){return(Math.round(ang/6)+60)%60;}

function cpPad(n){return n<10?'0'+n:''+n;}
function cpDrumHtml(val,max,id){
  const prev2=(val-2+max)%max, prev1=(val-1+max)%max, next1=(val+1)%max, next2=(val+2)%max;
  return '<div id="'+id+'" style="display:flex;flex-direction:column;align-items:center;width:52px;user-select:none;cursor:ns-resize">'
    +'<div style="font-size:12px;color:rgba(255,255,255,0.2);line-height:1.6">'+cpPad(prev2)+'</div>'
    +'<div style="font-size:16px;color:rgba(255,255,255,0.35);line-height:1.6">'+cpPad(prev1)+'</div>'
    +'<div style="font-size:28px;font-weight:800;color:#fff;line-height:1.4;border-top:1px solid rgba(255,255,255,0.2);border-bottom:1px solid rgba(255,255,255,0.2);padding:2px 0;min-width:36px;text-align:center;cursor:text" data-role="edit">'+cpPad(val)+'</div>'
    +'<div style="font-size:16px;color:rgba(255,255,255,0.35);line-height:1.6">'+cpPad(next1)+'</div>'
    +'<div style="font-size:12px;color:rgba(255,255,255,0.2);line-height:1.6">'+cpPad(next2)+'</div>'
    +'</div>';
}

function cpRender(){
  const wrap=document.getElementById('clockPickerWrap');if(!wrap)return;
  cpCleanHandlers();
  const h=_cpHour, m=_cpMin, ampm=h<12?'AM':'PM', h12=h%12||12;
  const size=216, cx=108, cy=108, R=100;
  const hRad=((h12*30+m*0.5)-90)*Math.PI/180, mRad=((m/60)*360-90)*Math.PI/180;
  const hx=cx+Math.cos(hRad)*46, hy=cy+Math.sin(hRad)*46;
  const mx=cx+Math.cos(mRad)*78, my=cy+Math.sin(mRad)*78;
  let ticks='';
  for(let i=0;i<60;i++){
    const a2=((i/60)*360-90)*Math.PI/180;
    const isH=i%5===0;
    ticks+='<line x1="'+(cx+Math.cos(a2)*(isH?83:91))+'" y1="'+(cy+Math.sin(a2)*(isH?83:91))+'" x2="'+(cx+Math.cos(a2)*R)+'" y2="'+(cy+Math.sin(a2)*R)+'" stroke="'+(isH?'#cbd5e1':'#e9ecef')+'" stroke-width="'+(isH?2:1)+'"/>';
  }
  let nums='';
  const activeColor='#0891b2';
  for(let i=1;i<=12;i++){
    const a2=((i/12)*360-90)*Math.PI/180;
    const nx=cx+Math.cos(a2)*70;
    const ny=cy+Math.sin(a2)*70;
    const act=i===h12;
    nums+='<circle class="cpnc" data-v="'+i+'" cx="'+nx+'" cy="'+ny+'" r="13" fill="'+(act?activeColor:'transparent')+'"/>';
    nums+='<text class="cpnt" data-v="'+i+'" x="'+nx+'" y="'+(ny+4.5)+'" text-anchor="middle" font-size="12" font-weight="700" fill="'+(act?'#fff':'#475569')+'" style="user-select:none;pointer-events:none">'+i+'</text>';
  }
  const headerBg='linear-gradient(135deg,#0e7490,#06b6d4)';
  wrap.innerHTML=
    '<div id="cpHeader" style="background:'+headerBg+';padding:10px 18px 8px;user-select:none">'
    +'<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.6);margin-bottom:4px">시간 선택</div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between">'
    +'<div style="display:flex;align-items:center;gap:0">'
    +cpDrumHtml(h,24,'cpDrumH')
    +'<div style="font-size:28px;font-weight:800;color:rgba(255,255,255,0.4);line-height:1;margin:0 2px;padding-top:3px">:</div>'
    +cpDrumHtml(m,60,'cpDrumM')
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px">'
    +'<button id="cpAmBtn" style="padding:4px 10px;border:1.5px solid rgba(255,255,255,'+(ampm==='AM'?'0.9':'0.3')+');border-radius:7px;font-size:11px;cursor:pointer;font-weight:700;background:'+(ampm==='AM'?'rgba(255,255,255,0.92)':'transparent')+';color:'+(ampm==='AM'?'#0e7490':'rgba(255,255,255,0.75)')+';font-family:var(--f);min-width:46px;transition:all .2s">AM</button>'
    +'<button id="cpPmBtn" style="padding:4px 10px;border:1.5px solid rgba(255,255,255,'+(ampm==='PM'?'0.9':'0.3')+');border-radius:7px;font-size:11px;cursor:pointer;font-weight:700;background:'+(ampm==='PM'?'rgba(255,255,255,0.92)':'transparent')+';color:'+(ampm==='PM'?'#0e7490':'rgba(255,255,255,0.75)')+';font-family:var(--f);min-width:46px;transition:all .2s">PM</button>'
    +'</div></div></div>'
    +'<div style="padding:10px 16px 0;background:#fff">'
    +'<svg id="cpSvg" width="'+size+'" height="'+size+'" style="display:block;margin:0 auto;cursor:default" viewBox="0 0 '+size+' '+size+'">'
    +'<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5"/>'
    +ticks+nums
    +'<line id="cpMLine" x1="'+cx+'" y1="'+cy+'" x2="'+mx+'" y2="'+my+'" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" opacity="0.35" style="pointer-events:none"/>'
    +'<line id="cpHLine" x1="'+cx+'" y1="'+cy+'" x2="'+hx+'" y2="'+hy+'" stroke="#06b6d4" stroke-width="4" stroke-linecap="round" style="pointer-events:none"/>'
    +'<circle cx="'+cx+'" cy="'+cy+'" r="5" fill="#1e293b" style="pointer-events:none"/>'
    +'<rect id="cpInteract" x="0" y="0" width="'+size+'" height="'+size+'" fill="transparent" style="cursor:crosshair;pointer-events:fill"/>'
    +'<line id="cpMHit" x1="'+cx+'" y1="'+cy+'" x2="'+mx+'" y2="'+my+'" stroke="transparent" stroke-width="18" stroke-linecap="round" style="cursor:pointer;pointer-events:stroke"/>'
    +'<line id="cpHHit" x1="'+cx+'" y1="'+cy+'" x2="'+hx+'" y2="'+hy+'" stroke="transparent" stroke-width="18" stroke-linecap="round" style="cursor:pointer;pointer-events:stroke"/>'
    +'</svg></div>'
    +'<div style="padding:6px 16px 10px;background:#fff">'
    +'<div style="text-align:left;font-size:9px;color:#94a3b8;line-height:1.5">시간 숫자를 클릭하여 숫자를 입력, 또는 마우스 휠을 위/아래로 돌리며 시간을 선택할 수 있습니다.<br>아래 시계의 시침과 분침을 클릭 &amp; 드래그를 통해 시간을 선택할 수도 있습니다.<br>Ctrl+Z(Cmd+Z)로 이전 되돌림이 가능합니다.</div>'
    +'</div>';

  /* 버튼 이벤트 */
  document.getElementById('cpAmBtn').addEventListener('click',function(){if(_cpHour>=12)_cpHour-=12;cpRender();cpAutoSave();});
  document.getElementById('cpPmBtn').addEventListener('click',function(){if(_cpHour<12)_cpHour+=12;cpRender();cpAutoSave();});

  /* 드럼 스크롤 */
  document.getElementById('cpDrumH').addEventListener('wheel',function(e){
    e.preventDefault();_cpHour=(e.deltaY<0?(_cpHour+1)%24:(_cpHour-1+24)%24);cpRender();cpAutoSave();
  },{passive:false});
  document.getElementById('cpDrumM').addEventListener('wheel',function(e){
    e.preventDefault();
    const oldMin=_cpMin;
    _cpMin=(e.deltaY<0?(_cpMin+1)%60:(_cpMin-1+60)%60);
    /* 분이 59→0 넘으면 시침 +1, 0→59 넘으면 시침 -1 */
    if(oldMin===59&&_cpMin===0)_cpHour=(_cpHour+1)%24;
    else if(oldMin===0&&_cpMin===59)_cpHour=(_cpHour-1+24)%24;
    cpRender();cpAutoSave();
  },{passive:false});

  /* 드럼 클릭 편집 — mousedown 으로 처리(focus 이동 전에 잡아야 함).
   * 클릭 즉시 _cpStartDrumEdit 하면, 진행 중 input 이 focus 를 잃으며 blur→finalApply→cpRender 가 방금 만든 input/대상 요소를
   * 파괴해 편집이 안 시작되던 문제 → 진행 중 편집이 '다른 드럼'이면 먼저 커밋(cpRender) 후 새로 그려진 드럼에서 시작. (2026-06-04) */
  document.querySelectorAll('#cpDrumH [data-role="edit"],#cpDrumM [data-role="edit"]').forEach(function(el){
    el.addEventListener('mousedown',function(e){
      e.stopPropagation(); e.preventDefault();
      var isHour=this.closest('#cpDrumH')!==null;
      var active=document.querySelector('#cpDrumH input,#cpDrumM input');
      if(active && active.parentNode===this){ try{ active.focus(); active.select(); }catch(_e){} return; }   /* 이미 이 드럼 편집 중 → 블록만 */
      if(active){ active.blur(); setTimeout(function(){ var fresh=document.querySelector((isHour?'#cpDrumH':'#cpDrumM')+' [data-role="edit"]'); if(fresh)_cpStartDrumEdit(fresh); },35); }
      else { _cpStartDrumEdit(this); }
    });
  });

  /* SVG 드래그 — 시침·분침 개별 드래그.
   *  dragTarget·오버레이 상태는 모듈 레벨(파일 상단) 것을 공유한다 — 드래그 도중 재렌더에도 보존. */
  const svg=document.getElementById('cpSvg');
  dragTarget=null;

  function cpStartDrag(target,e){
    e.preventDefault();e.stopPropagation();
    dragTarget=target;
    _cpAddDragOverlay();
    cpApplyDrag(e);
  }

  let _cpPrevMinForCross=-1;/* 분침 0 경계 통과 감지용 */
  function cpApplyDrag(e){
    const ang=cpCalcAngle(e,svg);
    if(dragTarget==='hour'){
      const h12n=cpAngleToHour(ang), isPM=_cpHour>=12;
      _cpHour=isPM?(h12n===12?12:h12n+12):(h12n===12?0:h12n);
      _cpPrevMinForCross=-1;
    } else if(dragTarget==='min'){
      const newMin=cpAngleToMin(ang);
      /* 분침이 59→0 경계를 넘으면 시침 +1, 0→59 경계면 시침 -1 */
      if(_cpPrevMinForCross>=0){
        if(_cpPrevMinForCross>=45&&newMin<=15) _cpHour=(_cpHour+1)%24;
        else if(_cpPrevMinForCross<=15&&newMin>=45) _cpHour=(_cpHour-1+24)%24;
      }
      _cpPrevMinForCross=newMin;
      _cpMin=newMin;
    }
    cpLiveUpdate();
  }

  /* 시침 히트 영역 */
  const cpHHitEl=document.getElementById('cpHHit');
  cpHHitEl.addEventListener('mousedown',function(e){cpStartDrag('hour',e);});
  cpHHitEl.addEventListener('wheel',function(e){e.preventDefault();_cpHour=(e.deltaY<0?(_cpHour+1)%24:(_cpHour-1+24)%24);cpRender();cpAutoSave();},{passive:false});
  /* 분침 히트 영역 */
  const cpMHitEl=document.getElementById('cpMHit');
  cpMHitEl.addEventListener('mousedown',function(e){cpStartDrag('min',e);});
  cpMHitEl.addEventListener('wheel',function(e){e.preventDefault();_cpMin=(e.deltaY<0?(_cpMin+1)%60:(_cpMin-1+60)%60);cpRender();cpAutoSave();},{passive:false});
  /* 빈 영역 클릭 — 가까운 침 판단 */
  document.getElementById('cpInteract').addEventListener('mousedown',function(e){
    e.preventDefault();
    const ang=cpCalcAngle(e,svg);
    const h12n=cpAngleToHour(ang);
    const hAng=(((_cpHour%12||12)/12)*360)%360;
    const mAng=((_cpMin/60)*360)%360;
    const clickAng=(ang+360)%360;
    const hDiff=Math.min(Math.abs(clickAng-hAng),360-Math.abs(clickAng-hAng));
    const mDiff=Math.min(Math.abs(clickAng-mAng),360-Math.abs(clickAng-mAng));
    dragTarget=hDiff<=mDiff?'hour':'min';
    cpApplyDrag(e);
  });

  _cpMoveH=function(e){if(!dragTarget)return;e.preventDefault();e.stopPropagation();cpApplyDrag(e);};
  _cpUpH=function(){dragTarget=null;_cpRemoveDragOverlay();};
  document.addEventListener('mousemove',_cpMoveH);
  document.addEventListener('mouseup',_cpUpH);

  /* 헤더 드래그 기능 제거 — 사용자 요청 */
}

/* 시침/분침 + active 숫자만 갱신 (드럼 textContent 는 건드리지 않음 — 편집 input 노드 보존용).
 *  사용자 요청 2026-05-28: 시/분 input 타이핑 중 라이브로 아날로그 시계에 반영하되 input 이 날아가지 않게. */
function _cpUpdateHandsOnly(h, m){
  const h12 = h%12||12;
  const cx=108, cy=108;
  const hRad=((h12*30+m*0.5)-90)*Math.PI/180, mRad=((m/60)*360-90)*Math.PI/180;
  const hl=document.getElementById('cpHLine'), ml=document.getElementById('cpMLine');
  const hx=cx+Math.cos(hRad)*46, hy=cy+Math.sin(hRad)*46;
  const mx=cx+Math.cos(mRad)*78, my=cy+Math.sin(mRad)*78;
  if(hl){hl.setAttribute('x2',hx);hl.setAttribute('y2',hy);}
  if(ml){ml.setAttribute('x2',mx);ml.setAttribute('y2',my);}
  const hHit=document.getElementById('cpHHit'), mHit=document.getElementById('cpMHit');
  if(hHit){hHit.setAttribute('x2',hx);hHit.setAttribute('y2',hy);}
  if(mHit){mHit.setAttribute('x2',mx);mHit.setAttribute('y2',my);}
  const svg=document.getElementById('cpSvg');if(!svg)return;
  svg.querySelectorAll('.cpnc').forEach(function(c){const v=parseInt(c.getAttribute('data-v'),10);c.setAttribute('fill',v===h12?'#0891b2':'transparent');});
  svg.querySelectorAll('.cpnt').forEach(function(t){const v=parseInt(t.getAttribute('data-v'),10);t.setAttribute('fill',v===h12?'#fff':'#475569');});
}
/* 드럼(시/분) 직접 편집 input 시작 — 클릭 또는 팝업 자동 활성화로 호출 (사용자 요청 2026-05-28).
 *  · 생성 즉시 focus + select (블록) → 숫자키로 바로 입력
 *  · 2자리 입력 완료 시 자동으로 다음 단계 (시→분, 분→_cpMinuteAdvance 콜백/닫기)
 *  · Tab / ArrowRight 로도 다음 단계
 *  · 입력 중 시침/분침 라이브 반영 (input 노드 보존) */
function _cpStartDrumEdit(drumEl){
  if(!drumEl)return;
  const isHour=drumEl.closest('#cpDrumH')!==null;
  const max=isHour?23:59;
  const cur=isHour?_cpHour:_cpMin;
  const inp=document.createElement('input');
  inp.type='text';inp.inputMode='numeric';inp.pattern='[0-9]*';inp.value=String(cur);inp.maxLength=2;
  inp.style.cssText='width:36px;text-align:center;font-size:24px;font-weight:800;background:rgba(255,255,255,0.25);border:2px solid rgba(255,255,255,0.7);border-radius:6px;color:#fff;outline:none;padding:2px;font-family:var(--f)';
  drumEl.textContent='';drumEl.appendChild(inp);inp.focus();inp.select();
  let _committed=false;   /* finalApply 중복 방지 */
  let _advancing=false;   /* 자동 이동/콜백 중복 방지 */
  function finalApply(){
    if(_committed)return;_committed=true;
    let v=parseInt(inp.value,10);
    if(isNaN(v))v=cur;
    v=Math.max(0,Math.min(max,v));
    const changed=(v!==cur);
    if(isHour)_cpHour=v;else _cpMin=v;
    cpRender();
    if(changed)cpAutoSave();
  }
  /* 다음 단계 진행 — 시면 분 드럼 자동 활성화, 분이면 콜백(입실→퇴실) 또는 저장 후 닫기 */
  function advance(){
    if(_advancing)return;_advancing=true;
    finalApply();
    if(isHour){
      setTimeout(function(){
        const mEdit=document.querySelector('#cpDrumM [data-role="edit"]');
        if(mEdit)_cpStartDrumEdit(mEdit);
      },30);
    } else {
      /* 분 단계 완료 — 호출처가 등록한 콜백(입실→퇴실 전환) 있으면 호출, 없으면 저장 후 닫기 */
      if(typeof window._cpMinuteAdvance==='function'){
        const cb=window._cpMinuteAdvance;
        setTimeout(function(){ try{cb();}catch(_){} },30);
      } else {
        setTimeout(function(){ try{closeClockPickerAnim();}catch(_){ const w=document.getElementById('clockPickerWrap'); if(w)w.style.display='none'; } },30);
      }
    }
  }
  /* 입력 — 숫자만 유지 + 라이브 아날로그 반영 + 2자리 완료 시 자동 진행 */
  inp.addEventListener('input',function(){
    const digits=inp.value.replace(/[^0-9]/g,'').slice(0,2);
    if(digits!==inp.value)inp.value=digits;
    const v=parseInt(digits,10);
    if(!isNaN(v)){
      const vc=Math.max(0,Math.min(max,v));
      _cpUpdateHandsOnly(isHour?vc:_cpHour, isHour?_cpMin:vc);
    }
    if(digits.length>=2) advance();
  });
  /* keypress: 숫자만 통과 */
  inp.addEventListener('keypress',function(ev){ if(!/^[0-9]$/.test(ev.key)){ev.preventDefault();} });
  inp.addEventListener('blur',finalApply);
  inp.addEventListener('keydown',function(ev){
    if(ev.key==='Enter'){
      /* 엔터 = 저장 후 즉시 닫기 (입실·퇴실 공통, 자동 진행 없음 — 자동 진행은 Tab/→ 담당).
       * 사용자 요청 2026-05-28: 시간 입력 후 엔터치면 저장되고 시계창이 사라져야 함. */
      ev.preventDefault(); ev.stopPropagation();
      finalApply();
      setTimeout(function(){ try{ closeClockPickerAnim(); }catch(_){ const w=document.getElementById('clockPickerWrap'); if(w)w.style.display='none'; } },30);
    }
    else if(ev.key==='Tab'||ev.key==='ArrowRight'){
      /* 시→분, 분→다음(콜백/닫기). stopPropagation 으로 document-level _tpTabHandler 와 중복 처리 차단. */
      ev.preventDefault(); ev.stopPropagation();
      advance();
    }
    else if(ev.key==='Escape'){
      ev.preventDefault();
      _committed=true;        /* 후속 blur 가 또 적용 시도하지 않도록 */
      inp.value=String(cur);  /* 원복 */
      cpRender();             /* 저장 없음 */
    }
  });
}

/* 드래그 중 침+숫자만 빠르게 갱신 */
function cpLiveUpdate(){
  const h=_cpHour, m=_cpMin, h12=h%12||12;
  const cx=108, cy=108;
  const hRad=((h12*30+m*0.5)-90)*Math.PI/180, mRad=((m/60)*360-90)*Math.PI/180;
  const hl=document.getElementById('cpHLine'), ml=document.getElementById('cpMLine');
  const hx=cx+Math.cos(hRad)*46, hy2=cy+Math.sin(hRad)*46;
  const mx=cx+Math.cos(mRad)*78, my2=cy+Math.sin(mRad)*78;
  if(hl){hl.setAttribute('x2',hx);hl.setAttribute('y2',hy2);}
  if(ml){ml.setAttribute('x2',mx);ml.setAttribute('y2',my2);}
  const hHit=document.getElementById('cpHHit'), mHit=document.getElementById('cpMHit');
  if(hHit){hHit.setAttribute('x2',hx);hHit.setAttribute('y2',hy2);}
  if(mHit){mHit.setAttribute('x2',mx);mHit.setAttribute('y2',my2);}
  /* 드럼 갱신 */
  const dh=document.getElementById('cpDrumH'), dm=document.getElementById('cpDrumM');
  if(dh){const c=dh.children;c[0].textContent=cpPad((h-2+24)%24);c[1].textContent=cpPad((h-1+24)%24);c[2].textContent=cpPad(h);c[3].textContent=cpPad((h+1)%24);c[4].textContent=cpPad((h+2)%24);}
  if(dm){const c=dm.children;c[0].textContent=cpPad((m-2+60)%60);c[1].textContent=cpPad((m-1+60)%60);c[2].textContent=cpPad(m);c[3].textContent=cpPad((m+1)%60);c[4].textContent=cpPad((m+2)%60);}
  const activeColor='#0891b2';
  const svg=document.getElementById('cpSvg');if(!svg)return;
  svg.querySelectorAll('.cpnc').forEach(function(c){
    const v=parseInt(c.getAttribute('data-v'),10);
    c.setAttribute('fill',v===h12?activeColor:'transparent');
  });
  svg.querySelectorAll('.cpnt').forEach(function(t){
    const v=parseInt(t.getAttribute('data-v'),10);
    t.setAttribute('fill',v===h12?'#fff':'#475569');
  });
  cpAutoSave();
}

let _cpSaveTimer=null;
function cpAutoSave(){
  const val=cpPad(_cpHour)+':'+cpPad(_cpMin);
  const inp=document.getElementById(_cpField);
  if(inp){inp.value=val;inp.dispatchEvent(new Event('input'));}
  const ecOpen=document.getElementById('ecFormOverlay');
  const infOpen=document.getElementById('infFormOverlay');
  if((ecOpen&&ecOpen.classList.contains('show'))||(infOpen&&infOpen.classList.contains('show')))return;
  const toast=document.getElementById('globalSaveToast');
  if(toast){
    toast.textContent='저장 중…';
    toast.className='global-save-toast show saving';
    if(_cpSaveTimer)clearTimeout(_cpSaveTimer);
    _cpSaveTimer=setTimeout(function(){
      toast.textContent='모든 내용이 저장되었습니다.';
      toast.className='global-save-toast show';
      setTimeout(function(){toast.className='global-save-toast';},3000);
    },300);
  }
}

function ecTransferChange(transferred){
  if(!ecCurrentId)return;
  const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
  if(!rec)return;
  if(!rec.transfer)rec.transfer={};
  rec.transfer.transferred=transferred;
  const mI=document.getElementById('ecTransferMethod'), fI=document.getElementById('ecTransferFacility');
  const mL=document.getElementById('ecTransferMethodLabel'), fL=document.getElementById('ecTransferFacilityLabel');
  [mI,fI].forEach(function(el){
    if(!el)return;
    if(transferred){el.removeAttribute('readonly');el.style.opacity='1';}
    else{el.setAttribute('readonly','');el.style.opacity='0.4';el.value='';}
  });
  [mL,fL].forEach(function(el){if(el)el.style.opacity=transferred?'1':'0.4';});
  /* 미이송이면 이송수단·기관 값 자체를 비워 기록/출력에 안 남도록 */
  if(!transferred){ rec.transfer.method=''; rec.transfer.facility=''; }
  ecDebounceSave();
}

function ecHandlePhotoDrop(e){
  e.preventDefault();e.currentTarget.classList.remove('dragover');
  const file=e.dataTransfer.files[0];
  if(file&&file.type.startsWith('image/'))ecProcessPhoto(file);
}

function ecHandlePhotoFile(input){if(input.files[0])ecProcessPhoto(input.files[0]);}

function ecProcessPhoto(file){
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      let w=img.width;
      let h=img.height;
      const maxDim=800;
      if(w>maxDim||h>maxDim){if(w>h){h=Math.round(h*maxDim/w);w=maxDim;}else{w=Math.round(w*maxDim/h);h=maxDim;}}
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const dataUrl=c.toDataURL('image/jpeg',0.7);
      if(!ecCurrentId)return;
      const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
      if(!rec)return;
      rec.photoData=dataUrl;ecDebounceSave();
      const area=document.getElementById('ecPhotoArea');
      area.innerHTML='<img src="'+dataUrl+'" id="ecPhotoPreview"><button class="ec-photo-remove" data-action="ecRemovePhoto">✕</button>';
      area.querySelector('[data-action="ecRemovePhoto"]').addEventListener('click',function(e){e.stopPropagation();ecRemovePhoto();});
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function ecRemovePhoto(){
  if(!ecCurrentId)return;
  const rec=S.ecRecords.find(function(r){return r.id===ecCurrentId;});
  if(!rec)return;
  rec.photoData='';ecDebounceSave();
  document.getElementById('ecPhotoArea').innerHTML='<div class="ec-photo-hint"><div style="font-size:22px;line-height:1;margin-bottom:3px">📁</div><div>파일을 복사하여 여기에 붙여넣기, 드래그 앤 드랍,</div><div>여기를 클릭하여 찾아주세요.</div></div>';
}




function ecPrintForm(){
  if(!ecCurrentId)return;
  const r=S.ecRecords.find(function(x){return x.id===ecCurrentId;});
  if(!r){bus.emit('toast:show',{text:'기록을 찾을 수 없습니다.'});return;}
  /* A4 세로 미리보기 다이얼로그(공용) — 미리보기 = 실제 출력물. A4 전용. (2026-06-02) */
  const html=_ecBuildPrintHtml(r);
  const _title=_ecPrintFileName(r);
  openA4PrintDialog({html:html, title:_title, headerLabel:'응급처치 기록지 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}});
}

document.addEventListener('click',function(e){if(e.target&&e.target.id==='ecFormOverlay'){closeEcForm();}});

/* ═══════════════════════════════════════
   INFECTION MANAGEMENT (#47-67)
   ═══════════════════════════════════════ */
S.infRecords=[];
S.infNextId=1;
S.infNotes={};
let infAcHighlight=-1;
let infSaveTimer=null;
let infSortDir='desc'; // 'asc' | 'desc'
let infCurrentId=null;

function _infToDbRow(rec){
  const sym=rec.symptoms||{};
  const rt=rec.route||{};
  const act=rec.actions||{};
  return {
    id:rec._dbId||rec.id,
    school_year:String(_academicYear(rec.date)), /* 사고/방문 날짜 기준 학년도(3/1) — 달력연도 slice 금지 (사용자 지시 2026-06-20) */
    person_uid:rec.personUid||rec.studentId||null,
    person_type:rec.personType||'student',
    disease_name:rec.diseaseName||'',
    hospital:rec.hospital||'',
    diag_date:rec.diagDate||'',
    onset_date:rec.onsetDate||'',
    report_date:rec.reportDate||rec.date||'',
    is_suspended:rec.suspended==='예'?1:0,
    suspend_start:rec.suspendStart||'',
    expected_return:rec.expectedReturn||'',
    actual_return:rec.actualReturn||'',
    main_symptoms:sym.main||'',
    has_fever:sym.fever||'아니오',
    has_cough:sym.cough||'아니오',
    has_throat:sym.throat||'아니오',
    other_symptoms:sym.other||'',
    infection_route:rt.path||'',
    school_contact:rt.schoolContact||'아니오',
    class_contact:rt.classContact||'아니오',
    situation_memo:rt.situationMemo||'',
    parent_notified:act.parentNotified||'아니오',
    notify_time:act.notifyTime||'',
    hospital_visit:act.hospitalVisit||'아니오',
    is_isolated:act.isolated||'아니오',
    additional_actions:act.additionalActions||'',
    progress_json:JSON.stringify(rec.progress||[]),
    additional_memo:rec.additionalMemo||'',
    author_date:rec.authorDate||'',
    author_name:rec.authorName||'',
    memo:rec.memo||'',
    extra_json:JSON.stringify({
      displayGrade:rec.displayGrade,
      displayNum:rec.displayNum,
      displayGender:rec.displayGender
    })
  };
}
function infSaveRecords(){
  if(!window.electronAPI)return;
  S.infRecords.forEach(function(rec){
    const row=_infToDbRow(rec);
    if(rec._dbId){
      window.electronAPI.recordsInfectionUpdate(row).catch(function(err){console.error('[DB] infection update 실패:',err);});
    }else{
      window.electronAPI.recordsInfectionInsert(row).then(function(res){
        if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
      }).catch(function(err){console.error('[DB] infection insert 실패:',err);});
    }
  });
}
/* [REMOVED] infSaveNotes — dead code. 감염병 메모는 진행 기록(progress)에 포함. */
function _infHydrate(r){
  /* 폼(infBuildFormHtml) 은 nested 객체 (rec.symptoms / rec.route / rec.actions) 를 읽고,
   * _infToDbRow 도 nested 에서 평면화하여 DB 저장. 따라서 hydrate 도 nested 로 복원해야 재오픈 시 값 유지됨.
   * 사용자 보고 (2026-05-18): 재시작 후 감염 경로/조치 사항/증상 체크리스트가 사라지던 버그 — 평면 키만 만들고
   * nested 를 안 만들어서 폼이 빈 객체로 읽었음. */
  /* 기존 nested 객체가 있으면 보존, 없으면 평면 키에서 재구성 */
  const symRaw=(r.symptoms&&typeof r.symptoms==='object')?r.symptoms:{};
  const rtRaw=(r.route&&typeof r.route==='object')?r.route:{};
  const actRaw=(r.actions&&typeof r.actions==='object')?r.actions:{};
  const symptoms={
    main:symRaw.main||r.mainSymptoms||r.main_symptoms||'',
    fever:symRaw.fever||r.hasFever||r.has_fever||'아니오',
    cough:symRaw.cough||r.hasCough||r.has_cough||'아니오',
    throat:symRaw.throat||r.hasThroat||r.has_throat||'아니오',
    other:symRaw.other||r.otherSymptoms||r.other_symptoms||''
  };
  const route={
    path:rtRaw.path||r.infectionRoute||r.infection_route||'',
    schoolContact:rtRaw.schoolContact||r.schoolContact||r.school_contact||'아니오',
    classContact:rtRaw.classContact||r.classContact||r.class_contact||'아니오',
    situationMemo:rtRaw.situationMemo||r.situationMemo||r.situation_memo||''
  };
  const actions={
    parentNotified:actRaw.parentNotified||r.parentNotified||r.parent_notified||'아니오',
    notifyTime:actRaw.notifyTime||r.notifyTime||r.notify_time||'',
    hospitalVisit:actRaw.hospitalVisit||r.hospitalVisit||r.hospital_visit||'아니오',
    isolated:actRaw.isolated||r.isIsolated||r.is_isolated||'아니오',
    additionalActions:actRaw.additionalActions||r.additionalActions||r.additional_actions||''
  };
  /* suspended: DB 의 is_suspended(0/1) → '예'/'아니오' 문자열 */
  let suspendedStr=r.suspended;
  if(typeof suspendedStr!=='string'||!suspendedStr){
    if(r.is_suspended===1||r.isSuspended===true)suspendedStr='예';
    else if(r.is_suspended===0||r.isSuspended===false)suspendedStr='아니오';
    else suspendedStr='';
  }
  return Object.assign({},r,{
    studentId:r.studentId||r.personUid||r.person_uid||'',
    date:r.date||r.diagDate||r.diag_date||r.authorDate||r.author_date||r.reportDate||r.report_date||'',
    diseaseName:r.diseaseName||r.disease_name||'',
    hospital:r.hospital||'',
    diagDate:r.diagDate||r.diag_date||'',
    onsetDate:r.onsetDate||r.onset_date||'',
    reportDate:r.reportDate||r.report_date||'',
    suspended:suspendedStr,
    suspendStart:r.suspendStart||r.suspend_start||'',
    expectedReturn:r.expectedReturn||r.expected_return||'',
    actualReturn:r.actualReturn||r.actual_return||'',
    symptoms:symptoms,
    route:route,
    actions:actions,
    progress:Array.isArray(r.progress)?r.progress:[],
    additionalMemo:r.additionalMemo||r.additional_memo||'',
    authorDate:r.authorDate||r.author_date||'',
    authorName:r.authorName||r.author_name||'',
    notes:r.notes||r.memo||''
  });
}
function _infLoadFromDB(){
  const yr=String(_academicYear());
  if(window.electronAPI&&window.electronAPI.recordsGetInfection){
    window.electronAPI.recordsGetInfection(yr).then(function(res){
      if(res&&res.success&&Array.isArray(res.data)){
        S.infRecords=res.data.map(_infHydrate);
        S.infNextId=S.infRecords.length?Math.max.apply(null,S.infRecords.map(function(r){return r.id||0;}))+1:1;
        /* infNotes 복원 (additionalMemo 필드에서) */
        S.infNotes={};
        S.infRecords.forEach(function(r){if(r.additionalMemo)S.infNotes[r.id]=r.additionalMemo;});
        S.infRecords=S.infRecords;S.infNextId=S.infNextId;S.infNotes=S.infNotes;
        if(typeof renderInfList==='function')renderInfList();
      }
    }).catch(function(err){console.error('[DB] infection load 실패:',err);});
  }
}

function _attachInfListDelegation(tbody){
  if(tbody._infListBound)return; /* 중복 바인딩 방지 */
  tbody._infListBound=true;
  tbody.addEventListener('click',function(e){
    const actionEl=e.target.closest('[data-action]');
    if(actionEl){
      e.stopPropagation();
      const action=actionEl.dataset.action;
      if(action==='toggleMemo'){toggleMemo(actionEl.dataset.sid,Number(actionEl.dataset.rid),actionEl);return;}
      if(action==='infDeleteFromList'){infDeleteFromList(Number(actionEl.dataset.rid));return;}
    }
    const tr=e.target.closest('tr[data-stu-id]');
    if(!tr)return;
    if(window._dd&&(window._dd.moved||window._dd.popupOpen))return;
    if(S._dragSelectedRecIds&&S._dragSelectedRecIds.length>0)return;
    tbody.querySelectorAll('tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});
    tr.classList.add('daily-selected');
    S._visitHistoryLocked=false;
    showVisitHistory(tr.dataset.stuId);
    S._visitHistoryLocked=true;
  });
}

export function renderInfList(){
  const acYr=_academicYear();const acStart=acYr+'-03-01';const acEnd=(acYr+1)+'-03-01';
  const label=document.getElementById('infYearLabel');
  if(label)label.textContent=acYr+'학년도 감염병 관리';
  /* 날짜 필터 — 빈 날짜도 목록 유지 */
  const _infGetDate=function(r){return r.date||r.reportDate||r.diagDate||r.onsetDate||'';};
  const yearRecs=S.infRecords.filter(function(r){const d=_infGetDate(r);return !d||(d>=acStart&&d<acEnd);}).sort(function(a,b){const da=_infGetDate(a)||'0000-00-00',db=_infGetDate(b)||'0000-00-00';return infSortDir==='asc'?da.localeCompare(db):db.localeCompare(da);});
  const tbody=document.getElementById('infListBody');
  if(!tbody)return;
  if(!yearRecs.length){
    const _infEmpty = (typeof createEmptyState==='function')
      ? createEmptyState({icon:'🦠',title:'이 연도의 감염병 관리 기록이 없습니다',desc:'위 검색창에서 학생을 검색하고 Enter를 누르면<br>새 기록지가 자동 생성됩니다.',actionLabel:'학생 검색'})
      : '<div style="text-align:center;padding:40px;color:var(--t3)"><div style="font-size:36px;margin-bottom:8px">🦠</div>이 연도의 감염병 관리 기록이 없습니다.</div>';
    tbody.innerHTML='<tr><td colspan="14" style="padding:0;background:transparent">'+_infEmpty+'</td></tr>';
    const _infActBtn=tbody.querySelector('[data-empty-action]');
    if(_infActBtn) _infActBtn.addEventListener('click',function(){
      if(typeof openAdvancedSearch==='function'){
        openAdvancedSearch(function(id){ if(id) infSelectStudent(id); });
      } else {
        const el=document.getElementById('infSearchInput');if(el)el.focus();
      }
    });
    applyInfColLayout();
  } else {
    tbody.innerHTML=yearRecs.map(function(r,i){
      const s=getStu(r.studentId);
      const infIsStaff=s.type==='staff';
      const infIsCare=s.status==='caution'||s.status==='watch';
      const infGradeCol=infIsStaff?(s.position||'교직원'):s.grade+'-'+s.cls;
      const susText=r.suspended==='예'?'예':r.suspended==='아니오'?'아니오':'-';
      const susCls=r.suspended==='예'?'inf-sus-yes':r.suspended==='아니오'?'inf-sus-no':'';
      const infHasMemo=_memoHasAny(r.studentId)?'📌':'';
      const mainSym=(r.symptoms&&r.symptoms.main)||'';
      const _infLvShort=(s.type==='staff')?'':((function(){const m={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};return m[s.level]||s.level||'';})());
      return '<tr style="cursor:pointer" data-rec-id="'+r.id+'" data-stu-id="'+(r.studentId||r.personUid||'')+'">'
        +'<td data-col-index="0" class="mono" style="text-align:center">'+(i+1)+'</td>'
        +'<td data-col-index="1" class="mono">'+(r.authorDate||r.date||'-')+'</td>'
        +'<td data-col-index="13" style="text-align:center">'+escHtml(_infLvShort||'-')+'</td>'
        +'<td data-col-index="2">'+infGradeCol+'</td>'
        +'<td data-col-index="3" class="mono">'+(infIsStaff?'-':s.num||'-')+'</td>'
        +'<td data-col-index="4" style="text-align:center">'+(infIsCare?'<span class="yo-chip-wrap"><span class="yo-badge">요보호</span><span class="yo-chip-pop">'+getCareTooltipHtml(s)+'</span></span>':'')+'</td>'
        +'<td data-col-index="5" style="text-align:center">'+_ecInfNameHtml(s,r.id,'_infShowNamePop')+'</td>'
        +'<td data-col-index="6" class="mono">'+(r.diagDate||'-')+'</td>'
        +'<td data-col-index="7" style="font-size:11px">'+escHtml(r.diseaseName||'-')+'</td>'
        +'<td data-col-index="8" style="font-size:11px;color:var(--t2)">'+escHtml(mainSym||'-')+'</td>'
        +'<td data-col-index="9" style="text-align:center">'+(susCls?'<span class="inf-sus-badge '+susCls+'">'+susText+'</span>':susText)+'</td>'
        +'<td data-col-index="10" class="mono">'+(r.suspendStart||'-')+'</td>'
        +'<td data-col-index="11" class="mono">'+(r.actualReturn||'-')+'</td>'
        +'<td data-col-index="12" style="position:relative;padding-right:32px"><span class="memo-plus" data-action="toggleMemo" data-sid="'+r.studentId+'" data-rid="'+r.id+'">'+(infHasMemo||'+')+'</span><button class="row-delete-x" data-action="infDeleteFromList" data-rid="'+r.id+'">✕</button></td>'
        +'</tr>';
    }).join('');
    applyInfColLayout();
    _initEcInfHScroll('infListCard');
    _attachInfListDelegation(tbody);
    _bindEcInfNameCells(tbody);
  }
  /* 전광판 — 학년도·학생·교직원 단일 층 + 제목줄 */
  (function(){
    const vc=document.getElementById('infVisitorCount');if(!vc)return;
    const stuCnt=yearRecs.filter(function(r){return getStu(r.studentId).type!=='staff';}).length;
    const staffCnt=yearRecs.filter(function(r){return getStu(r.studentId).type==='staff';}).length;
    const total=stuCnt+staffCnt;
    const _infCurU=S._currentUser||{};
    const _infSchool=_infCurU.school_name||S.settings.schoolName||'';
    function fD(n,cls,d){let s=String(n);while(s.length<(d||3))s='0'+s;return s.split('').map(function(c){return '<div class="flip-digit '+cls+' flipping"><span>'+c+'</span></div>';}).join('');}
    let h='<div class="flip-board" style="flex-direction:column;align-items:center;gap:7px;padding:5px 10px;border:1.5px solid #444;border-radius:0">'
      +'<div class="flip-title-text" style="font-size:11px;font-weight:700;letter-spacing:0.5px">'+escHtml(_infSchool?_infSchool+' ':'')+'감염병 발생 현황</div>'
      +'<div style="display:flex;align-items:center;gap:5px">'
        +'<div class="flip-section"><span class="flip-label flip-stat-total">'+acYr+'학년도</span>'+fD(total,'cyan',3)+'</div>'
        +'<span class="flip-sep">│</span>'
        +'<div class="flip-section"><span class="flip-label flip-stat-stu">학생</span>'+fD(stuCnt,'blue',3)+'</div>'
        +'<span class="flip-sep">│</span>'
        +'<div class="flip-section"><span class="flip-label flip-stat-staff">교직원</span>'+fD(staffCnt,'purple',2)+'</div>'
      +'</div></div>';
    vc.innerHTML=h;
  })();
}

export function infAutoComplete(){
  const input=document.getElementById('infSearchInput');
  const q=input.value.trim();
  const list=document.getElementById('infACList');
  infAcHighlight=-1;
  if(!q){list.classList.remove('show');return;}
  const qLower=q.toLowerCase();
  function _infVisitCount(sid){return S.records.filter(function(r){return r.studentId===sid;}).length;}
  function _infNameSort(a,b){const vc=_infVisitCount(b.id)-_infVisitCount(a.id);if(vc!==0)return vc;return a.name.localeCompare(b.name,'ko');}
  const _infStart=S.people.filter(function(s){ return matchKoreanFromStart(s.name,q); });
  const _infOther=S.people.filter(function(s){
    if(_infStart.indexOf(s)>=0) return false;
    if(matchKorean(s.name,q)) return true;
    const isStf=s.type==='staff';
    const str=isStf?(s.name+' '+(s.position||'교직원')):(s.name+' '+gradeClsLabel(s.grade,s.cls)+(isKinder()?'':s.num+'번'));
    return str.toLowerCase().indexOf(qLower)>=0;
  });
  _infStart.sort(_infNameSort);_infOther.sort(_infNameSort);
  const matched=_infStart.concat(_infOther).slice(0,100);
  if(!matched.length){list.classList.remove('show');return;}
  list.innerHTML=matched.map(function(s,i){
    const isCare=s.status==='caution'||s.status==='watch';
    const isStf=s.type==='staff';
    const info=isStf?'['+(s.position||'교직원')+(isCare?' *요보호*':'')+']':'['+gradeClsLabel(s.grade,s.cls)+(isKinder()?'':' '+s.num+'번')+(isCare?' *요보호*':'')+']';
    return '<div class="ac-item" data-idx="'+i+'" data-stu-id="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
  }).join('');
  list.querySelectorAll('.ac-item').forEach(function(el){
    el.addEventListener('click',function(){infSelectStudent(el.dataset.stuId);});
    el.addEventListener('mouseenter',function(){infAcHighlight=Number(el.dataset.idx);infHighlightAC();});
  });
  list.classList.add('show');
}

function infHighlightAC(){
  document.querySelectorAll('#infACList .ac-item').forEach(function(el,i){el.classList.toggle('highlighted',i===infAcHighlight);});
}

export function infSearchKeydown(e){
  const items=document.querySelectorAll('#infACList .ac-item');
  if(e.key==='ArrowDown'){e.preventDefault();infAcHighlight=Math.min(infAcHighlight+1,items.length-1);infHighlightAC();}
  else if(e.key==='ArrowUp'){e.preventDefault();infAcHighlight=Math.max(infAcHighlight-1,0);infHighlightAC();}
  else if(e.key==='Enter'){e.preventDefault();if(infAcHighlight>=0&&items[infAcHighlight])items[infAcHighlight].click();else if(items.length)items[0].click();const _infi=document.getElementById('infSearchInput');_infi.value='';_infi.blur();}
  else if(e.key==='Escape'){document.getElementById('infACList').classList.remove('show');const _infi2=document.getElementById('infSearchInput');_infi2.value='';_infi2.blur();}
}

export function infSelectStudent(id){
  document.getElementById('infSearchInput').value='';
  document.getElementById('infACList').classList.remove('show');
  const now=new Date();
  const dateStr=toDateStr(now);
  const _infStu=getStu(id);const _infPType=(_infStu&&_infStu.type==='staff')?'staff':'student';
  const newRec={
    id:S.infNextId++,date:dateStr,personUid:id,personType:_infPType,studentId:id,
    diseaseName:'',hospital:'',diagDate:'',onsetDate:'',reportDate:dateStr,
    suspended:'',suspendStart:'',expectedReturn:'',actualReturn:'',
    symptoms:{main:'',fever:'아니오',cough:'아니오',throat:'아니오',other:''},
    route:{path:'',schoolContact:'아니오',classContact:'아니오',situationMemo:''},
    actions:{parentNotified:'아니오',notifyTime:'',hospitalVisit:'아니오',isolated:'아니오',additionalActions:''},
    progress:[],additionalMemo:'',
    authorDate:dateStr,authorName:S.settings.nurse1||''
  };
  addInfRecord(newRec);
  /* 새 레코드 즉시 DB 삽입하여 _dbId 확보 */
  if(window.electronAPI&&window.electronAPI.recordsInfectionInsert){
    window.electronAPI.recordsInfectionInsert(_infToDbRow(newRec)).then(function(res){
      if(res&&res.success&&res.id){newRec._dbId=res.id;newRec.id=res.id;infCurrentId=res.id;}
    }).catch(function(err){console.error('[DB] infection insert 실패:',err);});
  }
  openInfForm(newRec.id);
}

function infDP(fieldId,dataField,value,disabled){
  /* disabled 는 마우스 이벤트를 차단하므로 시각적 opacity 만 적용, 클릭은 가능 */
  const opStyle=disabled?' opacity:0.5':'';
  return '<div style="display:flex;gap:4px;align-items:center;min-width:95px'+opStyle+'">'
    +'<input id="'+fieldId+'" data-field="'+dataField+'" value="'+escHtml(value)+'" placeholder="YYYY-MM-DD" readonly style="cursor:pointer;flex:1;min-width:0;text-align:center">'
    +'<button data-inf-cal data-action="infOpenCal" data-field-id="'+fieldId+'" type="button" style="border:1px solid var(--bdr);background:var(--bg2);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:13px;flex-shrink:0">📅</button>'
    +'</div>';
}
function infBuildFormHtml(rec){
  const s=getStu(rec.studentId);
  const sym=rec.symptoms||{};
  const rt=rec.route||{};
  const act=rec.actions||{};
  const prog=rec.progress||[];
  const susDisabled=rec.suspended!=='예';

  function ynToggle(value,path){
    const yesA=value==='예'?' active-yes':'';
    const noA=value==='아니오'?' active-no':'';
    return '<div class="inf-toggle">'
      +'<button type="button" class="inf-toggle-opt'+yesA+'" data-action="infToggleField" data-path="'+path+'" data-value="예">예</button>'
      +'<button type="button" class="inf-toggle-opt'+noA+'" data-action="infToggleField" data-path="'+path+'" data-value="아니오">아니오</button>'
      +'</div>';
  }

  let progressRows='';
  prog.forEach(function(p,i){
    progressRows+='<tr>'
      +'<td><input data-progress="'+i+'" data-pfield="date" value="'+(p.date||'')+'" placeholder="YYYY-MM-DD"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="status" value="'+(p.status||'')+'" placeholder="상태 기술"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="temp" value="'+(p.temp||'')+'" placeholder="36.5" style="text-align:center"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="notes" value="'+(p.notes||'')+'" placeholder="특이사항"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="recorder" value="'+escHtml(p.recorder||'')+'" placeholder="기록자" style="text-align:center"></td>'
      +'</tr>';
  });

  const _infIsStaff=s.type==='staff';
  /* 학년반번호 표기: [(학교급) ][학과 ]학년-반 번호 — 학교급 2개 이상이면 (초)/(고) 접두, 학과 있으면 학과명 접두 (EC 기록지와 통일) */
  const _infMulti=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const _infLvPfx=_infMulti?('('+((typeof getLevelShort==='function'?getLevelShort(s):'')||'')+') '):'';
  const _infDeptPfx=((s.department||'').trim())?(String(s.department).trim()+' '):'';
  const _infGradeBase=isKinder()?('만'+s.grade+'세-'+s.cls+'반'):(s.grade+'-'+s.cls);
  const _infGradeVal=_infIsStaff?(rec.displayGrade!==undefined?rec.displayGrade:''):(_infLvPfx+_infDeptPfx+_infGradeBase);
  const _infNumVal=_infIsStaff?(rec.displayNum!==undefined?rec.displayNum:''):(isKinder()?'':s.num);
  const _infGenderVal=_infIsStaff?(rec.displayGender!==undefined?rec.displayGender:(s.gender||'')):(s.gender||'');
  let html='<h2>감 염 병 &nbsp; 관 리 &nbsp; 기 록 지</h2>';
  html+='<table class="ec-ftable"><tr>'
    +'<td class="ec-label">이 름</td><td><input value="'+s.name+'" readonly style="font-weight:700;background:#fff;text-align:center"></td>'
    +'<td class="ec-label">'+(isKinder()?'나이-반':'학년반번호')+'</td><td colspan="3"><input data-field="displayGrade" value="'+(_infIsStaff?escHtml(_infGradeVal):escHtml((_infGradeVal+(_infNumVal?(' '+_infNumVal+(isKinder()?'':'번')):'')).trim()))+'"'+(_infIsStaff?'':' readonly')+' style="background:#fff;text-align:center"></td>'
    +'<td class="ec-label">성 별</td><td><input data-field="displayGender" value="'+escHtml(_infGenderVal)+'"'+(_infIsStaff?'':' readonly')+' style="background:#fff;width:40px;text-align:center"></td>'
    +'</tr></table>';
  html+='<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">감 염 병 &nbsp; 기 본 &nbsp; 정 보</td></tr>'
    +'<tr><td class="ec-label">감염병명</td><td colspan="2"><input data-field="diseaseName" value="'+(rec.diseaseName||'')+'" placeholder="감염병명 입력" style="text-align:center"></td>'
    +'<td class="ec-label">진단 기관<br>(병원명)</td><td colspan="2"><input data-field="hospital" value="'+(rec.hospital||'')+'" placeholder="병원명 입력" style="text-align:center"></td></tr>'
    +'<tr><td class="ec-label">진단일</td><td style="width:110px">'+infDP('diagDate','diagDate',rec.diagDate||'',false)+'</td>'
    +'<td class="ec-label">최초 증상<br>발현일</td><td style="width:110px">'+infDP('onsetDate','onsetDate',rec.onsetDate||'',false)+'</td>'
    +'<td class="ec-label">보고일</td><td style="width:110px">'+infDP('reportDate','reportDate',rec.reportDate||'',false)+'</td></tr>'
    +'</table>';
  html+='<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">관 리 &nbsp; 현 황</td></tr>'
    +'<tr><td class="ec-label">등교중지<br>여부</td><td>'+ynToggle(rec.suspended||'','suspended')+'</td>'
    +'<td class="ec-label">등교중지<br>개시일시</td><td>'+infDP('infSuspendStart','suspendStart',rec.suspendStart||'',susDisabled)+'</td>'
    +'<td class="ec-label">등교재개<br>예정일</td><td>'+infDP('infExpectedReturn','expectedReturn',rec.expectedReturn||'',susDisabled)+'</td></tr>'
    +'<tr><td class="ec-label">실제<br>등교재개일</td><td colspan="5">'+infDP('infActualReturn','actualReturn',rec.actualReturn||'',susDisabled)+'</td></tr>'
    +'</table>';
  html+='<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">증 상 &nbsp; 체 크 리 스 트</td></tr>'
    +'<tr><td class="ec-label">주요 증상</td><td colspan="5"><input data-field="symptoms.main" value="'+(sym.main||'')+'" placeholder="주요 증상을 기술하세요"></td></tr>'
    +'<tr><td class="ec-label">발열 여부</td><td>'+ynToggle(sym.fever||'아니오','symptoms.fever')+'</td>'
    +'<td class="ec-label">기침 여부</td><td>'+ynToggle(sym.cough||'아니오','symptoms.cough')+'</td>'
    +'<td class="ec-label">인후통 여부</td><td>'+ynToggle(sym.throat||'아니오','symptoms.throat')+'</td></tr>'
    +'<tr><td class="ec-label">기타 증상</td><td colspan="5"><input data-field="symptoms.other" value="'+(sym.other||'')+'" placeholder="기타 증상 (자유 기술)"></td></tr>'
    +'</table>';
  html+='<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">감 염 &nbsp; 경 로</td></tr>'
    +'<tr><td class="ec-label">감염 추정<br>경로</td><td colspan="5"><input data-field="route.path" value="'+(rt.path||'')+'" placeholder="감염 추정 경로 기술"></td></tr>'
    +'<tr><td class="ec-label">학교 내<br>접촉 가능</td><td>'+ynToggle(rt.schoolContact||'아니오','route.schoolContact')+'</td>'
    +'<td class="ec-label">동일 반 내<br>추가 의심자</td><td>'+ynToggle(rt.classContact||'아니오','route.classContact')+'</td>'
    +'<td colspan="2"></td></tr>'
    +'<tr><td class="ec-label">발생 상황<br>메모</td><td colspan="5"><textarea data-field="route.situationMemo" placeholder="발생 상황을 자세히 기술하세요..." style="min-height:60px;padding:8px">'+(rt.situationMemo||'')+'</textarea></td></tr>'
    +'</table>';
  html+='<table class="ec-ftable"><tr><td colspan="6" class="ec-section-title">조 치 &nbsp; 사 항</td></tr>'
    +'<tr><td class="ec-label">보호자<br>통보 여부</td><td>'+ynToggle(act.parentNotified||'아니오','actions.parentNotified')+'</td>'
    +'<td class="ec-label">통보 시간</td><td><div style="display:flex;gap:3px;align-items:center"><input id="infNotifyTime" data-field="actions.notifyTime" value="'+escHtml(act.notifyTime||'')+'" placeholder="HH:MM" readonly style="cursor:pointer;text-align:center;flex:1;min-width:0"><button type="button" data-action="openClockPicker" data-field-id="infNotifyTime" style="border:1px solid var(--bdr);background:var(--bg2);border-radius:4px;padding:2px 5px;cursor:pointer;font-size:14px;flex-shrink:0">🕐</button></div></td>'
    +'<td class="ec-label">병원 진료<br>여부</td><td>'+ynToggle(act.hospitalVisit||'아니오','actions.hospitalVisit')+'</td></tr>'
    +'<tr><td class="ec-label">격리 조치<br>여부</td><td>'+ynToggle(act.isolated||'아니오','actions.isolated')+'</td>'
    +'<td class="ec-label">학교 내<br>추가 조치</td><td colspan="3"><input data-field="actions.additionalActions" value="'+(act.additionalActions||'')+'" placeholder="학교 내 추가 조치 내용"></td></tr>'
    +'</table>';
  html+='<table class="ec-ftable"><tr><td colspan="5" class="ec-section-title">경 과 &nbsp; 관 찰</td></tr></table>'
    +'<table class="inf-progress-table" id="infProgressTable">'
    +'<thead><tr><th style="width:110px">날짜</th><th>학생 상태</th><th style="width:70px">체온(℃)</th><th>특이사항</th><th style="width:80px">기록자</th></tr></thead>'
    +'<tbody id="infProgressBody">'+progressRows+'</tbody></table>'
    +'<button type="button" class="inf-add-row-btn" data-action="infAddProgressRow">＋ 경과 관찰 추가</button>';
  html+='<table class="ec-ftable" style="margin-top:12px"><tr><td colspan="2" class="ec-section-title">추 가 &nbsp; 메 모</td></tr>'
    +'<tr><td colspan="2" style="padding:0"><textarea data-field="additionalMemo" placeholder="추가 메모를 입력하세요..." style="min-height:80px;padding:10px">'+(rec.additionalMemo||'')+'</textarea></td></tr></table>';
  html+='<table class="ec-ftable"><tr><td colspan="4" class="ec-section-title">작 성 &nbsp; 정 보</td></tr>'
    +'<tr><td class="ec-label">작성일</td><td>'+infDP('infAuthorDate','authorDate',rec.authorDate||'',false)+'</td>'
    +'<td class="ec-label">작성자<br>(보건교사)</td><td><input data-field="authorName" value="'+(rec.authorName||'')+'" placeholder="작성자 이름" style="text-align:center"></td></tr></table>';
  html+='<div class="ec-autosave-msg">모든 내용이 자동으로 저장되어 창을 종료해도 상태가 유지됩니다.</div>'
    +'<div class="ec-btn-bar"><button class="btn-print" data-action="infPrintForm">🖨 인쇄</button><button class="btn-pdf" data-action="infPdfForm">📄 PDF 저장</button></div>';
  return html;
}

function openInfForm(recId){
  const rec=S.infRecords.find(function(r){return r.id===recId;});
  if(!rec)return;
  infCurrentId=recId;
  const body=document.getElementById('infFormBody');
  body.innerHTML=infBuildFormHtml(rec);
  _attachInfFormListeners(body);
  document.getElementById('infFormOverlay').classList.add('show');
  document.body.style.overflow='hidden';
}

function _attachInfFormListeners(container){
  container.querySelectorAll('input[data-field],textarea[data-field]').forEach(function(el){
    el.addEventListener('input',function(){infFieldChange(el);});
  });
  container.querySelectorAll('input[data-progress]').forEach(function(el){
    el.addEventListener('input',function(){infProgressChange(el);});
  });
  container.querySelectorAll('[data-action="infToggleField"]').forEach(function(el){
    el.addEventListener('click',function(){infToggleField(el.dataset.path,el.dataset.value,el);});
  });
  container.querySelectorAll('[data-action="infOpenCal"]').forEach(function(el){
    el.addEventListener('click',function(){if(!this.closest('[disabled]')&&!this.previousElementSibling.disabled)window.infOpenCal(el.dataset.fieldId,el);});
  });
  /* infDP 로 렌더된 readonly 날짜 input 직접 클릭도 달력 팝업 열기 */
  container.querySelectorAll('[data-action="infOpenCal"]').forEach(function(btn){
    const id=btn.dataset.fieldId;if(!id)return;
    const inp=container.querySelector('#'+id);
    if(!inp||inp._dpClickBound)return;
    inp._dpClickBound=true;
    inp.setAttribute('data-inf-cal','');
    inp.addEventListener('click',function(e){
      e.stopPropagation();
      if(typeof window.infOpenCal==='function')window.infOpenCal(id,inp);
    });
  });
  /* 통보 시간 시계 팝업 — 🕐 버튼 + input 직접 클릭 */
  container.querySelectorAll('[data-action="openClockPicker"]').forEach(function(btn){
    btn.addEventListener('click',function(){openClockPicker(btn.dataset.fieldId,btn);});
    const id=btn.dataset.fieldId;
    const inp=container.querySelector('#'+id);
    if(inp&&!inp._cpClickBound){
      inp._cpClickBound=true;
      inp.setAttribute('data-action','openClockPicker');
      inp.setAttribute('data-field-id',id);
      inp.addEventListener('click',function(e){e.stopPropagation();openClockPicker(id,inp);});
    }
  });
  /* 경과 관찰 테이블의 기록자 input 가운데 정렬 */
  container.querySelectorAll('input[data-pfield="recorder"]').forEach(function(el){
    el.style.textAlign='center';
  });
  const addBtn=container.querySelector('[data-action="infAddProgressRow"]');
  if(addBtn)addBtn.addEventListener('click',function(){infAddProgressRow();});
  const printBtn=container.querySelector('[data-action="infPrintForm"]');
  if(printBtn)printBtn.addEventListener('click',function(){infPrintForm();});
  const pdfBtn=container.querySelector('[data-action="infPdfForm"]');
  if(pdfBtn)pdfBtn.addEventListener('click',function(){ /* 바로 PDF 저장(경로 선택) */
    if(!infCurrentId)return; const r=S.infRecords.find(function(x){return x.id===infCurrentId;}); if(!r)return;
    saveA4Pdf({html:_infBuildPrintHtml(r), title:_infPrintFileName(r), cssMargins:true});
  });
}

export function closeInfForm(){
  /* 팝업 닫을 때 DB에 저장 후 localStorage 임시 삭제 */
  const closingId=infCurrentId;
  if(closingId){
    const rec=S.infRecords.find(function(r){return r.id===closingId;});
    if(rec&&window.electronAPI){
      const row=_infToDbRow(rec);
      if(rec._dbId){
        window.electronAPI.recordsInfectionUpdate(row).then(function(){
          if(typeof queueGlobalSaveToast==='function')queueGlobalSaveToast();
        }).catch(function(err){console.error('[DB] infection update 실패:',err);});
      }else{
        window.electronAPI.recordsInfectionInsert(row).then(function(res){
          if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
          if(typeof queueGlobalSaveToast==='function')queueGlobalSaveToast();
        }).catch(function(err){console.error('[DB] infection insert 실패:',err);});
      }
    }
    try{localStorage.removeItem('ec_form_draft_INF_'+closingId);}catch(_){}
  }
  document.getElementById('infFormOverlay').classList.remove('show');
  document.body.style.overflow='';
  infCurrentId=null;
  if(infSaveTimer){clearTimeout(infSaveTimer);infSaveTimer=null;}
  renderInfList();
}

function infFieldChange(input,directField){
  if(!infCurrentId)return;
  const rec=S.infRecords.find(function(r){return r.id===infCurrentId;});
  if(!rec)return;
  const field=directField||input.dataset.field;
  if(!field)return;
  const value=input.value;
  const parts=field.split('.');
  if(parts.length===2){
    if(!rec[parts[0]])rec[parts[0]]={};
    rec[parts[0]][parts[1]]=value;
  }else{
    rec[field]=value;
  }
  infDebounceSave();
}

function infToggleField(path,value,btn){
  if(!infCurrentId)return;
  const rec=S.infRecords.find(function(r){return r.id===infCurrentId;});
  if(!rec)return;
  const parts=path.split('.');
  if(parts.length===2){
    if(!rec[parts[0]])rec[parts[0]]={};
    rec[parts[0]][parts[1]]=value;
  }else{
    rec[path]=value;
  }
  const parent=btn.parentElement;
  parent.querySelectorAll('.inf-toggle-opt').forEach(function(el){el.classList.remove('active-yes','active-no');});
  btn.classList.add(value==='예'?'active-yes':'active-no');
  if(path==='suspended'){
    const enabled=value==='예';
    ['infSuspendStart','infExpectedReturn','infActualReturn'].forEach(function(id){
      const el=document.getElementById(id);
      if(el){
        el.disabled=!enabled;
        const par=el.parentElement;
        if(par){
          par.style.opacity=enabled?'1':'0.4';
          par.style.pointerEvents=enabled?'':'none';
          const btn=par.querySelector('button[data-inf-cal]');
          if(btn)btn.disabled=!enabled;
        }
      }
    });
  }
  infDebounceSave();
}

function infDebounceSave(){
  /* 편집 중: localStorage 임시 저장 */
  if(infCurrentId){
    const rec=S.infRecords.find(function(r){return r.id===infCurrentId;});
    if(rec){
      try{localStorage.setItem('ec_form_draft_INF_'+infCurrentId,JSON.stringify(rec));}catch(_){}
    }
  }
  const ind=document.getElementById('infSaveIndicator');
  if(ind){ind.textContent='저장 중…';ind.className='ec-save-indicator saving';}
  if(infSaveTimer)clearTimeout(infSaveTimer);
  infSaveTimer=setTimeout(function(){
    /* 실제 DB 반영 + 리스트 실시간 갱신 */
    if(infCurrentId){
      const rec=S.infRecords.find(function(r){return r.id===infCurrentId;});
      if(rec&&window.electronAPI){
        const row=_infToDbRow(rec);
        if(rec._dbId){
          window.electronAPI.recordsInfectionUpdate(row).then(function(){
            if(typeof renderInfList==='function')renderInfList();
          }).catch(function(err){console.error('[DB] infection update 실패:',err);});
        } else if(window.electronAPI.recordsInfectionInsert){
          window.electronAPI.recordsInfectionInsert(row).then(function(res){
            if(res&&res.success&&res.id){rec._dbId=res.id;rec.id=res.id;}
            if(typeof renderInfList==='function')renderInfList();
          }).catch(function(err){console.error('[DB] infection insert 실패:',err);});
        } else if(typeof renderInfList==='function'){
          renderInfList();
        }
      } else if(typeof renderInfList==='function'){
        renderInfList();
      }
    }
    if(ind){ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';}
    setTimeout(function(){if(ind)ind.className='ec-save-indicator hide';},3000);
  },400);
}

function infProgressChange(input){
  if(!infCurrentId)return;
  const rec=S.infRecords.find(function(r){return r.id===infCurrentId;});
  if(!rec)return;
  const idx=+input.dataset.progress;
  const field=input.dataset.pfield;
  if(!rec.progress)rec.progress=[];
  if(!rec.progress[idx])rec.progress[idx]={date:'',status:'',temp:'',notes:'',recorder:''};
  rec.progress[idx][field]=input.value;
  infDebounceSave();
}

function infAddProgressRow(){
  if(!infCurrentId)return;
  const rec=S.infRecords.find(function(r){return r.id===infCurrentId;});
  if(!rec)return;
  if(!rec.progress)rec.progress=[];
  const now=new Date();
  rec.progress.push({date:toDateStr(now),status:'',temp:'',notes:'',recorder:S.settings.nurse1||''});
  infDebounceSave();
  const tbody=document.getElementById('infProgressBody');
  if(tbody){
    const i=rec.progress.length-1;
    const p=rec.progress[i];
    const row=document.createElement('tr');
    row.innerHTML='<td><input data-progress="'+i+'" data-pfield="date" value="'+escHtml(p.date||'')+'" placeholder="YYYY-MM-DD"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="status" value="" placeholder="상태 기술"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="temp" value="" placeholder="36.5" style="text-align:center"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="notes" value="" placeholder="특이사항"></td>'
      +'<td><input data-progress="'+i+'" data-pfield="recorder" value="'+escHtml(p.recorder||'')+'" placeholder="기록자"></td>';
    row.querySelectorAll('input[data-progress]').forEach(function(el){
      el.addEventListener('input',function(){infProgressChange(el);});
    });
    tbody.appendChild(row);
    row.querySelector('input[data-pfield="status"]').focus();
  }
}




function infPrintForm(){
  if(!infCurrentId)return;
  const r=S.infRecords.find(function(x){return x.id===infCurrentId;});
  if(!r){bus.emit('toast:show',{text:'기록을 찾을 수 없습니다.'});return;}
  /* A4 세로 미리보기 다이얼로그(공용) — 미리보기 = 실제 출력물. A4 전용. (2026-06-02) */
  const html=_infBuildPrintHtml(r);
  const _title=_infPrintFileName(r);
  openA4PrintDialog({html:html, title:_title, headerLabel:'감염병 관리 기록지 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}});
}

document.addEventListener('click',function(e){if(e.target&&e.target.id==='infFormOverlay')closeInfForm();});

function ecDeleteFromList(recId){
  if(!confirm('삭제하시겠습니까?'))return;
  const rec=S.ecRecords.find(function(r){return r.id===recId;});
  if(rec&&rec._dbId&&window.electronAPI&&window.electronAPI.recordsEmergencyDelete){
    window.electronAPI.recordsEmergencyDelete(rec._dbId).catch(function(err){console.error('[DB] emergency delete 실패:',err);});
  }
  S.ecRecords=S.ecRecords.filter(function(r){return r.id!==recId;});renderEcList();
}
function infDeleteFromList(recId){
  if(!confirm('삭제하시겠습니까?'))return;
  const rec=S.infRecords.find(function(r){return r.id===recId;});
  if(rec&&rec._dbId&&window.electronAPI&&window.electronAPI.recordsInfectionDelete){
    window.electronAPI.recordsInfectionDelete(rec._dbId).catch(function(err){console.error('[DB] infection delete 실패:',err);});
  }
  S.infRecords=S.infRecords.filter(function(r){return r.id!==recId;});renderInfList();
}
/* 출력/PDF용 식별 문자열: [(학교급) ][학과 ]N학년 M반 K번 — 학교급 2개 이상이면 (고) 등 접두, 학과 입력 시 학과명 접두.
 *  화면 폼과 통일하되 인쇄는 "1학년 1반 17번" 풀표기. 교직원은 직책 그대로. (사용자 요청 2026-06-04) */
function _ecPrintGradeStr(s){
  if(!s) return '-';
  if(s.type==='staff') return getStuGradeCol(s,{short:false});
  const lvPfx=(typeof hasMultipleSchoolLevels==='function'&&hasMultipleSchoolLevels())?('('+((typeof getLevelShort==='function'?getLevelShort(s):'')||'')+') '):'';
  const deptPfx=((s.department||'').trim())?(String(s.department).trim()+' '):'';
  const gradeVerbose=isKinder()?('만'+(s.grade||'-')+'세 '+(s.cls||'-')+'반'):((s.grade||'-')+'학년 '+(s.cls||'-')+'반');
  const numPart=isKinder()?'':(s.num?(' '+s.num+'번'):'');
  return (lvPfx+deptPfx+gradeVerbose+numPart).trim();
}
function _ecBuildPrintHtml(r){
  const s=getStu(r.studentId);const ai=r.accidentInfo||{};const v=r.vitals||{};const tr=r.transfer||{};
  const _ecGradeStr=_ecPrintGradeStr(s);
  const _fname=_ecPrintFileName(r);
  const gc=r.guardianContact||s.guardianContact||'';
  const ht=r.homeroomTeacher||s.homeroomTeacher||'';
  /* <thead> + display:table-header-group → 표가 다음 페이지로 넘어가도 섹션 제목이 매 페이지 상단에 반복 표시 */
  /* 페이지 분할 정책 (사용자 요청 2026-06-04 — 정책 변경):
   *  - tr,td,th { page-break-inside:avoid } → 다음 페이지로 넘어갈 때 행(셀) 단위로만 끊고, 셀을 가로지르며 자르지 않음
   *  - 활력징후처럼 측정시간 rowspan 으로 2행이 1카드면 <tbody class="keep"> 로 묶어 카드째 다음 페이지로 이동
   *  - thead { display:table-header-group } → 표가 페이지를 넘어가면 섹션 제목줄이 매 페이지 상단에 자동 반복
   *  - border-collapse:separate + border-spacing:0 → 각 셀이 독립 4방향 border 보유(2026-05-18 셀 테두리 누락 대응 유지) */
  let html='<html><head><meta charset="utf-8"><title>'+escHtml(_fname)+'</title><style>@page{size:A4;margin:20mm 12mm}body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:0;margin:0;color:#111}table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-bottom:14px}thead{display:table-header-group}tr,td,th{page-break-inside:avoid;break-inside:avoid}tbody.keep{page-break-inside:avoid;break-inside:avoid}th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top;box-decoration-break:clone;-webkit-box-decoration-break:clone}th+th,td+td,th+td,td+th{border-left:0}tr+tr td,tr+tr th{border-top:0}th{background:#f0f0f0;font-weight:700;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}.section-title{background:#e0e0e0;font-weight:700;text-align:center;padding:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{text-align:center;margin:0 0 16px;font-size:18px}.long-cell{white-space:pre-wrap;word-break:break-word}</style></head><body><h2>응 급 처 치 &nbsp; 기 록 지</h2>';
  /* 학생 기본 정보 + 보호자/담임 */
  html+='<table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%"></colgroup>'
    +'<tr><th>이름</th><td>'+escHtml(s.name)+'</td><th>성별</th><td>'+escHtml(s.gender||'-')+'</td></tr>'
    +'<tr><th>'+(isKinder()?'나이-반':'학년반번호')+'</th><td colspan="3">'+escHtml(_ecGradeStr)+'</td></tr>'
    +'<tr><th>보호자 연락처</th><td>'+escHtml(gc||'-')+'</td><th>담임교사</th><td>'+escHtml(ht||'-')+'</td></tr></table>';
  /* 사고 발생 정보 */
  html+='<table><thead><tr><td class="section-title" colspan="6">사고 발생 정보</td></tr></thead><tbody>'
    +'<tr><th>날짜</th><td>'+escHtml((ai.datetime||'').split(' ')[0]||'-')+'</td><th>시간</th><td colspan="3">'+escHtml((ai.datetime||'').split(' ')[1]||'-')+'</td></tr>'
    +'<tr><th>장소</th><td colspan="5" class="long-cell">'+escHtml(ai.location||'-')+'</td></tr>'
    +'<tr><th>발생 당시<br>의식 상태</th><td colspan="5">'+escHtml((r.consciousness||'-')+(r.consciousnessEtc?' — '+r.consciousnessEtc:''))+'</td></tr>'
    +'<tr><th>사고 발생<br>상황 및 개요</th><td colspan="5" class="long-cell">'+escHtml(ai.situation||r.summary||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 활력징후 — 시간별 다중 측정. vitalsList 우선, 없으면 단일 vitals/flat 컬럼에서 구성 */
  let _vlist = Array.isArray(r.vitalsList)&&r.vitalsList.length ? r.vitalsList : null;
  if(!_vlist){
    let _vv = r.vitals || {}; if(typeof _vv==='string'){ try{_vv=JSON.parse(_vv)||{};}catch(e){_vv={};} }
    _vlist=[{time:_vv.time||'',temp:_vv.temp||r.vital_temp||'',pulse:_vv.pulse||r.vital_pulse||'',bp:_vv.bp||r.vital_bp||'',resp:_vv.resp||r.vital_resp||'',spo2:_vv.spo2||r.vital_spo2||'',bst:_vv.bst||r.vital_bst||''}];
  }
  /* table-layout:fixed + colgroup → 측정값이 비어 있어도(빈칸) 값이 들어찬 칸과 동일한 가로폭 확보 (사용자 요청 2026-06-04) */
  html+='<table style="table-layout:fixed"><colgroup><col style="width:12%"><col style="width:15%"><col style="width:13%"><col style="width:15%"><col style="width:13%"><col style="width:15%"><col style="width:17%"></colgroup><thead><tr><td class="section-title" colspan="7">활력 징후 (Vital Sign)</td></tr></thead>';
  _vlist.forEach(function(m){
    var _c=function(x){return escHtml(x||'-');};
    /* 측정 1건(2행, 측정시간 rowspan)을 tbody.keep 로 묶어 페이지 경계에서 카드가 쪼개지지 않게 함 */
    html+='<tbody class="keep"><tr><th rowspan="2" style="width:90px;vertical-align:middle">측정 시간<br>'+_c(m.time)+'</th>'
      +'<th>체온(℃)</th><td>'+_c(m.temp)+'</td><th>맥박(bpm)</th><td>'+_c(m.pulse)+'</td><th>혈압(mmHg)</th><td>'+_c(m.bp)+'</td></tr>'
      +'<tr><th>호흡(/min)</th><td>'+_c(m.resp)+'</td><th>SpO2(%)</th><td>'+_c(m.spo2)+'</td><th>혈당(mg/dL)</th><td>'+_c(m.bst)+'</td></tr></tbody>';
  });
  html+='</table>';
  /* 응급처치 기록 */
  html+='<table><thead><tr><td class="section-title" colspan="2">응급처치 기록</td></tr></thead><tbody><tr><td colspan="2" class="long-cell">'+escHtml(r.treatment||'-')+'</td></tr></tbody></table>';
  /* 기록 시점의 환자 의식 및 상태 */
  html+='<table><thead><tr><td class="section-title" colspan="2">기록 시점의 환자 의식 및 상태</td></tr></thead><tbody>'
    +'<tr><th style="width:120px">의식 상태</th><td>'+escHtml((r.recConsciousness||'-')+(r.recConsciousnessEtc?' — '+r.recConsciousnessEtc:''))+'</td></tr>'
    +'<tr><th>환자 상태</th><td class="long-cell">'+escHtml(r.patientStatus||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 이송 정보 */
  html+='<table><thead><tr><td class="section-title" colspan="4">이송 정보</td></tr></thead><tbody>'
    +'<tr><th>이송 여부</th><td>'+escHtml(tr.transferred?'이송':'미이송')+'</td><th>이송 수단</th><td>'+escHtml(tr.method||'-')+'</td></tr>'
    +'<tr><th>이송 기관</th><td colspan="3">'+escHtml(tr.facility||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 작성 정보 */
  /* 주의사항(메모) */
  html+='<table><thead><tr><td class="section-title" colspan="2">주의사항 (메모)</td></tr></thead><tbody><tr><td colspan="2" class="long-cell">'+escHtml(r.notes||'-')+'</td></tr></tbody></table>';
  /* 작성 정보 */
  html+='<table><thead><tr><td class="section-title" colspan="4">작성 정보</td></tr></thead><tbody>'
    +'<tr><th>작성일</th><td>'+escHtml(r.authorDate||'-')+'</td><th>작성자</th><td>'+escHtml(r.authorName||'-')+'</td></tr>'
    +'</tbody></table>';
  html+='</body></html>';
  return html;
}
/* 파일명 규칙 (사용자 요청 2026-05-18):
 *  - 학교에 학교급이 여러 개면 학교급 prefix 포함 (예: "고_지형공간디자인과_2-1_김재웅의 응급처치기록지")
 *  - 학교급이 하나뿐이면 학교급 생략 (예: "2-1_김재웅의 응급처치기록지")
 *  - 학과(department)가 있으면 항상 포함 */
function _buildPersonFileBase(s){
  if(!s)return '';
  const multi=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const lv=multi?(getLevelShort(s)||''):'';
  const dept=(s.department||'').trim();
  let gc='';
  if(s.type==='staff'){
    gc=(s.position||'').trim();
  } else {
    const g=(s.grade!==undefined&&s.grade!==null&&s.grade!=='')?String(s.grade):'';
    const c=(s.cls!==undefined&&s.cls!==null&&s.cls!=='')?String(s.cls):'';
    if(g&&c)gc=g+'-'+c;
    else if(g)gc=g;
    else if(c)gc=c;
  }
  const parts=[];
  if(lv)parts.push(lv);
  if(dept)parts.push(dept);
  if(gc)parts.push(gc);
  return parts.join('_');
}
/* 출력 파일명용 오늘 날짜 — NEIS 표준 YY.MM.DD. 형식 (점 + 끝점, 예: 26.05.18.) */
function _ecPrintDateShort(){
  const d=new Date();
  const y=String(d.getFullYear()).slice(2);
  const m=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return y+'.'+m+'.'+dd+'.';
}
function _ecPrintFileName(r){
  const s=getStu(r.studentId);
  const prefix=_buildPersonFileBase(s);
  const base=(prefix?prefix+'_':'')+s.name+'_응급처치기록지('+_ecPrintDateShort()+')';
  return base.replace(/[\\\/:*?"<>|]/g,'_');
}
function _infPrintFileName(r){
  const s=getStu(r.studentId);
  const prefix=_buildPersonFileBase(s);
  const base=(prefix?prefix+'_':'')+s.name+'_감염병관리기록지('+_ecPrintDateShort()+')';
  return base.replace(/[\\\/:*?"<>|]/g,'_');
}
export function ecPrintList(){
  if(!S.ecRecords.length){alert('응급처치 기록이 없습니다.');return;}
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='ecPrintSelOverlay';
  let html='<div class="modal-content" style="width:540px;padding:0;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--bdr);background:var(--popup-head)"><span style="font-size:15px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">🚑 응급처치 개별 기록 출력</span><button class="modal-close" data-action="closeModal">✕</button></div><div style="padding:20px">';
  html+='<p style="font-size:12px;color:var(--t2);margin-bottom:12px">출력할 학생의 행에서 🖨 인쇄 / 📄 PDF 저장 을 선택하세요.</p>';
  html+='<div style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto">';
  S.ecRecords.forEach(function(r){
    const s=getStu(r.studentId);
    const ai=r.accidentInfo||{};
    html+='<div style="padding:10px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);display:flex;align-items:center;gap:10px">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;font-size:12px;color:var(--t1)">'+escHtml(s.name)+'</span><span style="font-size:10px;color:var(--t3)">'+escHtml(getStuGradeCol(s,{short:true}))+(s.type==='staff'?'':(' '+escHtml(s.num)+'번'))+'</span></div>'
        +'<div style="font-size:10px;color:var(--t2);margin-top:3px">'+escHtml(r.date||'-')+' · '+escHtml((ai.situation||'상황 미기록').substring(0,40))+'</div>'
      +'</div>'
      +'<button class="btn-print" data-action="ecHardPrint" data-rid="'+r.id+'" title="인쇄/PDF 다이얼로그 열기">🖨 인쇄</button>'
      +'<button class="btn-pdf" data-action="ecPdfPrint" data-rid="'+r.id+'" title="인쇄/PDF 다이얼로그 열기">📄 PDF 저장</button>'
      +'</div>';
  });
  html+='</div></div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  const closeBtn=ov.querySelector('[data-action="closeModal"]');
  if(closeBtn)closeBtn.addEventListener('click',function(){closeModalGracefully('ecPrintSelOverlay');});
  ov.querySelectorAll('[data-action="ecHardPrint"]').forEach(function(el){
    el.addEventListener('click',function(e){e.stopPropagation();ecHardPrintOne(Number(el.dataset.rid));});
  });
  ov.querySelectorAll('[data-action="ecPdfPrint"]').forEach(function(el){
    el.addEventListener('click',function(e){e.stopPropagation();ecPdfPrintOne(Number(el.dataset.rid));});
  });
  document.body.appendChild(ov);
}
function ecHardPrintOne(recId){
  const r=S.ecRecords.find(function(x){return x.id===recId;});if(!r)return;
  const html=_ecBuildPrintHtml(r);
  const _title=_ecPrintFileName(r);
  /* 선택 모달 닫고 → A4 세로 미리보기 다이얼로그(공용) */
  const _ov=document.getElementById('ecPrintSelOverlay');
  if(_ov)closeModalGracefully(_ov);
  openA4PrintDialog({html:html, title:_title, headerLabel:'응급처치 기록지 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}});
}
function ecPdfPrintOne(recId){
  const r=S.ecRecords.find(function(x){return x.id===recId;});if(!r)return;
  /* PDF 저장 = 바로 저장 경로 선택창 (인쇄 미리보기 없이 즉시 저장) */
  const _ov=document.getElementById('ecPrintSelOverlay');
  if(_ov)closeModalGracefully(_ov);
  saveA4Pdf({html:_ecBuildPrintHtml(r), title:_ecPrintFileName(r)});
}
// Legacy compat - keep old function signature for remaining references
function _infBuildPrintHtml(r){
  const s=getStu(r.studentId);
  const sym=r.symptoms||{};const rt=r.route||{};const act=r.actions||{};const prog=r.progress||[];
  const _infGradeStr=_ecPrintGradeStr(s);
  const _fname=_infPrintFileName(r);
  /* 페이지 분할 정책 — 응급처치와 동일(사용자 요청 2026-06-04): tr,td,th page-break-inside:avoid 로 셀 단위 분할 +
   * thead 자동 반복. 셀 테두리 누락 방지(2026-05-18) border-collapse:separate + border-spacing:0 유지 */
  let html='<html><head><meta charset="utf-8"><title>'+escHtml(_fname)+'</title><style>@page{size:A4;margin:20mm 12mm}body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:0;margin:0;color:#111}table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-bottom:14px}thead{display:table-header-group}tr,td,th{page-break-inside:avoid;break-inside:avoid}tbody.keep{page-break-inside:avoid;break-inside:avoid}th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top;box-decoration-break:clone;-webkit-box-decoration-break:clone}th+th,td+td,th+td,td+th{border-left:0}tr+tr td,tr+tr th{border-top:0}th{background:#f0f0f0;font-weight:700;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}.section-title{background:#e0e0e0;font-weight:700;text-align:center;padding:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{text-align:center;margin:0 0 16px;font-size:18px}.long-cell{white-space:pre-wrap;word-break:break-word}</style></head><body><h2>감 염 병 &nbsp; 관 리 &nbsp; 기 록 지</h2>';
  /* 학생 기본 정보 */
  html+='<table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%"></colgroup>'
    +'<tr><th>이름</th><td>'+escHtml(s.name)+'</td><th>성별</th><td>'+escHtml(s.gender||'-')+'</td></tr>'
    +'<tr><th>'+(isKinder()?'나이-반':'학년반번호')+'</th><td colspan="3">'+escHtml(_infGradeStr)+'</td></tr></table>';
  /* 감염병 기본 정보 */
  html+='<table><thead><tr><td class="section-title" colspan="6">감염병 기본 정보</td></tr></thead><tbody>'
    +'<tr><th>감염병명</th><td colspan="2">'+escHtml(r.diseaseName||'-')+'</td><th>진단 기관(병원명)</th><td colspan="2">'+escHtml(r.hospital||'-')+'</td></tr>'
    +'<tr><th>진단일</th><td>'+escHtml(r.diagDate||'-')+'</td><th>최초 증상 발현일</th><td>'+escHtml(r.onsetDate||'-')+'</td><th>보고일</th><td>'+escHtml(r.reportDate||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 관리 현황 (등교중지) */
  html+='<table><thead><tr><td class="section-title" colspan="6">관리 현황</td></tr></thead><tbody>'
    +'<tr><th>등교중지 여부</th><td>'+escHtml(r.suspended||'-')+'</td><th>등교중지 개시일시</th><td>'+escHtml(r.suspendStart||'-')+'</td><th>등교재개 예정일</th><td>'+escHtml(r.expectedReturn||'-')+'</td></tr>'
    +'<tr><th>실제 등교재개일</th><td colspan="5">'+escHtml(r.actualReturn||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 증상 체크리스트 */
  html+='<table><thead><tr><td class="section-title" colspan="6">증상 체크리스트</td></tr></thead><tbody>'
    +'<tr><th>주요 증상</th><td colspan="5" class="long-cell">'+escHtml(sym.main||'-')+'</td></tr>'
    +'<tr><th>발열 여부</th><td>'+escHtml(sym.fever||'-')+'</td><th>기침 여부</th><td>'+escHtml(sym.cough||'-')+'</td><th>인후통 여부</th><td>'+escHtml(sym.throat||'-')+'</td></tr>'
    +'<tr><th>기타 증상</th><td colspan="5" class="long-cell">'+escHtml(sym.other||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 감염 경로 */
  html+='<table><thead><tr><td class="section-title" colspan="6">감염 경로</td></tr></thead><tbody>'
    +'<tr><th>감염 추정 경로</th><td colspan="5" class="long-cell">'+escHtml(rt.path||'-')+'</td></tr>'
    +'<tr><th>학교 내 접촉 가능</th><td>'+escHtml(rt.schoolContact||'-')+'</td><th>동일 반 내 추가 의심자</th><td colspan="3">'+escHtml(rt.classContact||'-')+'</td></tr>'
    +'<tr><th>발생 상황 메모</th><td colspan="5" class="long-cell">'+escHtml(rt.situationMemo||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 조치 사항 */
  html+='<table><thead><tr><td class="section-title" colspan="6">조치 사항</td></tr></thead><tbody>'
    +'<tr><th>보호자 통보 여부</th><td>'+escHtml(act.parentNotified||'-')+'</td><th>통보 시간</th><td>'+escHtml(act.notifyTime||'-')+'</td><th>병원 진료 여부</th><td>'+escHtml(act.hospitalVisit||'-')+'</td></tr>'
    +'<tr><th>격리 조치 여부</th><td>'+escHtml(act.isolated||'-')+'</td><th>학교 내 추가 조치</th><td colspan="3" class="long-cell">'+escHtml(act.additionalActions||'-')+'</td></tr>'
    +'</tbody></table>';
  /* 경과 관찰 */
  let progRows='';
  if(prog && prog.length){
    prog.forEach(function(p){
      progRows+='<tr>'
        +'<td>'+escHtml(p.date||'-')+'</td>'
        +'<td class="long-cell">'+escHtml(p.status||'-')+'</td>'
        +'<td style="text-align:center">'+escHtml(p.temp||'-')+'</td>'
        +'<td class="long-cell">'+escHtml(p.notes||'-')+'</td>'
        +'<td style="text-align:center">'+escHtml(p.recorder||'-')+'</td>'
        +'</tr>';
    });
  } else {
    progRows='<tr><td colspan="5" style="text-align:center;color:#888">기록 없음</td></tr>';
  }
  html+='<table><thead><tr><td class="section-title" colspan="5">경과 관찰</td></tr><tr><th style="width:110px">날짜</th><th>학생 상태</th><th style="width:70px">체온(℃)</th><th>특이사항</th><th style="width:80px">기록자</th></tr></thead><tbody>'+progRows+'</tbody></table>';
  /* 추가 메모 */
  html+='<table><thead><tr><td class="section-title" colspan="2">추가 메모</td></tr></thead><tbody><tr><td colspan="2" class="long-cell">'+escHtml(r.additionalMemo||'-')+'</td></tr></tbody></table>';
  /* 작성 정보 */
  html+='<table><thead><tr><td class="section-title" colspan="4">작성 정보</td></tr></thead><tbody><tr><th>작성일</th><td>'+escHtml(r.authorDate||'-')+'</td><th>작성자 (보건교사)</th><td>'+escHtml(r.authorName||'-')+'</td></tr></tbody></table>';
  html+='</body></html>';
  return html;
}
export function infPrintList(){
  if(!S.infRecords.length){alert('감염병 기록이 없습니다.');return;}
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='infPrintSelOverlay';
  let html='<div class="modal-content" style="width:540px;padding:0;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--bdr);background:var(--popup-head)"><span style="font-size:15px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">🦠 감염병 개별 기록 출력</span><button class="modal-close" data-action="closeModal">✕</button></div><div style="padding:20px">';
  html+='<p style="font-size:12px;color:var(--t2);margin-bottom:12px">출력할 학생의 행에서 🖨 인쇄 / 📄 PDF 저장 을 선택하세요.</p>';
  html+='<div style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto">';
  S.infRecords.forEach(function(r){
    const s=getStu(r.studentId);
    html+='<div style="padding:10px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);display:flex;align-items:center;gap:10px">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;font-size:12px;color:var(--t1)">'+escHtml(s.name)+'</span><span style="font-size:10px;color:var(--t3)">'+escHtml(getStuGradeCol(s,{short:true}))+(s.type==='staff'?'':(' '+escHtml(s.num)+'번'))+'</span></div>'
        +'<div style="font-size:10px;color:var(--t2);margin-top:3px">'+escHtml(r.date||'-')+' · '+escHtml(r.diseaseName||'미기록')+'</div>'
      +'</div>'
      +'<button class="btn-print" data-action="infHardPrint" data-rid="'+r.id+'" title="인쇄/PDF 다이얼로그 열기">🖨 인쇄</button>'
      +'<button class="btn-pdf" data-action="infPdfPrint" data-rid="'+r.id+'" title="인쇄/PDF 다이얼로그 열기">📄 PDF 저장</button>'
      +'</div>';
  });
  html+='</div></div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  const closeBtn=ov.querySelector('[data-action="closeModal"]');
  if(closeBtn)closeBtn.addEventListener('click',function(){closeModalGracefully('infPrintSelOverlay');});
  ov.querySelectorAll('[data-action="infHardPrint"]').forEach(function(el){
    el.addEventListener('click',function(e){e.stopPropagation();infHardPrintOne(Number(el.dataset.rid));});
  });
  ov.querySelectorAll('[data-action="infPdfPrint"]').forEach(function(el){
    el.addEventListener('click',function(e){e.stopPropagation();infPdfPrintOne(Number(el.dataset.rid));});
  });
  document.body.appendChild(ov);
}
function infHardPrintOne(recId){
  const r=S.infRecords.find(function(x){return x.id===recId;});if(!r)return;
  const html=_infBuildPrintHtml(r);
  const _title=_infPrintFileName(r);
  /* 선택 모달 닫고 → A4 세로 미리보기 다이얼로그(공용) */
  const _ov=document.getElementById('infPrintSelOverlay');
  if(_ov)closeModalGracefully(_ov);
  openA4PrintDialog({html:html, title:_title, headerLabel:'감염병 관리 기록지 인쇄', marginsMm:{top:20,bottom:20,left:12,right:12}});
}
function infPdfPrintOne(recId){
  const r=S.infRecords.find(function(x){return x.id===recId;});if(!r)return;
  /* PDF 저장 = 바로 저장 경로 선택창 (인쇄 미리보기 없이 즉시 저장) */
  const _ov=document.getElementById('infPrintSelOverlay');
  if(_ov)closeModalGracefully(_ov);
  saveA4Pdf({html:_infBuildPrintHtml(r), title:_infPrintFileName(r)});
}
// Legacy - old infPrintList

export function ecPrintTable(){
  const table=document.getElementById('ecListTable');
  if(!table)return;
  const clone=table.cloneNode(true);
  clone.querySelectorAll('tr').forEach(function(tr){const cells=tr.querySelectorAll('th,td');if(cells.length>0)cells[cells.length-1].remove();});
  const pw=window.open('','','width=900,height=700');
  pw.document.write('<html><head><title>응급처치 기록표</title><style>body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#f0f0f0;font-weight:700}h2{text-align:center;margin-bottom:16px}@media print{body{padding:10px}}</style></head><body>');
  pw.document.write('<h2>응급처치 기록표</h2>');
  pw.document.write(clone.outerHTML);
  pw.document.write('</body></html>');
  pw.document.close();
  pw.focus();
  setTimeout(function(){pw.print();pw.close();},300);
}
export function infPrintTable(){
  const table=document.getElementById('infListTable');
  if(!table)return;
  const clone=table.cloneNode(true);
  clone.querySelectorAll('tr').forEach(function(tr){const cells=tr.querySelectorAll('th,td');if(cells.length>0)cells[cells.length-1].remove();});
  const pw=window.open('','','width=900,height=700');
  pw.document.write('<html><head><title>감염병 기록표</title><style>body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#f0f0f0;font-weight:700}h2{text-align:center;margin-bottom:16px}@media print{body{padding:10px}}</style></head><body>');
  pw.document.write('<h2>감염병 기록표</h2>');
  pw.document.write(clone.outerHTML);
  pw.document.write('</body></html>');
  pw.document.close();
  pw.focus();
  setTimeout(function(){pw.print();pw.close();},300);
}

/* ═══════════════════════════════════════
   GYOMU (매직 스테이션)
   ═══════════════════════════════════════ */
S.magicMemos=JSON.parse(localStorage.getItem('ec_magic_memos')||'[]');
S.magicLinks=JSON.parse(localStorage.getItem('ec_magic_links')||'[]');

function autoSaveMagic(){localStorage.setItem('ec_magic_data',JSON.stringify({memos:S.magicMemos,links:S.magicLinks}));}



function renderMemoList(filter){
  const list=document.getElementById('magicMemoList');if(!list)return;
  const filtered=filter?S.magicMemos.filter(m=>m.title.includes(filter)||m.content.includes(filter)):S.magicMemos;
  if(!filtered.length){list.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">메모가 없습니다.</div>';return;}
  list.innerHTML=filtered.map((m,i)=>`<div class="memo-list-card" data-memo-idx="${i}"><div class="memo-list-title">${escHtml(m.title)}</div><div class="memo-list-preview">${escHtml(m.content.substring(0,60))}</div><div class="memo-list-date">${escHtml(m.ts)}</div><button class="memo-list-del" data-action="deleteMemoListItem" data-idx="${i}">✕</button></div>`).join('');
  list.querySelectorAll('.memo-list-card').forEach(function(el){
    el.addEventListener('click',function(e){if(!e.target.closest('[data-action="deleteMemoListItem"]'))openMemoPopup(Number(el.dataset.memoIdx));});
  });
  list.querySelectorAll('[data-action="deleteMemoListItem"]').forEach(function(el){
    el.addEventListener('click',function(e){e.stopPropagation();deleteMemoListItem(Number(el.dataset.idx));});
  });
}

function openMemoPopup(idx){
  const memos=JSON.parse(localStorage.getItem('ec_magic_memolist')||'[]');
  const m=memos[idx];if(!m)return;
  const ov=document.createElement('div');
  ov.className='memo-popup-overlay';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  ov.innerHTML='<div class="memo-popup"><h3>'+escHtml(m.title)+'</h3><p>'+escHtml(m.content)+'</p><div class="memo-popup-date">'+escHtml(m.ts)+'</div></div>';
  document.body.appendChild(ov);
}
function deleteMemoListItem(idx){
  if(!confirm('이 메모를 삭제하시겠습니까?'))return;
  const memos=JSON.parse(localStorage.getItem('ec_magic_memolist')||'[]');
  memos.splice(idx,1);
  localStorage.setItem('ec_magic_memolist',JSON.stringify(memos));
  renderMemoList();
}


function addResizeHandles(el){
  if(el.querySelector('.resize-handle'))return;
  ['nw','ne','sw','se'].forEach(function(dir){
    const h=document.createElement('div');h.className='resize-handle '+dir;
    h.addEventListener('mousedown',function(e){e.stopPropagation();e.preventDefault();startResize(e,el,dir);});
    el.appendChild(h);
  });
}
function startResize(e,el,dir){
  const startX=e.clientX, startY=e.clientY;
  const startW=el.offsetWidth, startH=el.offsetHeight;
  function onMove(ev){
    const dx=ev.clientX-startX, dy=ev.clientY-startY;
    if(dir==='se'||dir==='ne')el.style.width=Math.max(80,startW+dx)+'px';
    if(dir==='sw'||dir==='nw')el.style.width=Math.max(80,startW-dx)+'px';
    if(dir==='se'||dir==='sw')el.style.height=Math.max(60,startH+dy)+'px';
    if(dir==='ne'||dir==='nw')el.style.height=Math.max(60,startH-dy)+'px';
  }
  function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}
function initDragReorder(container,selector){
  let dragEl=null;
  container.addEventListener('dragstart',function(e){
    const item=e.target.closest(selector);if(!item)return;
    dragEl=item;item.style.opacity='0.4';
    e.dataTransfer.effectAllowed='move';
  });
  container.addEventListener('dragend',function(e){
    const item=e.target.closest(selector);if(item)item.style.opacity='1';dragEl=null;
  });
  container.addEventListener('dragover',function(e){
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const target=e.target.closest(selector);
    if(target&&target!==dragEl&&dragEl){
      const rect=target.getBoundingClientRect();
      const mid=rect.left+rect.width/2;
      if(e.clientX<mid)container.insertBefore(dragEl,target);
      else container.insertBefore(dragEl,target.nextSibling);
    }
  });
}
function initAllResizeHandles(){
  document.querySelectorAll('.magic-img-block,.magic-postit').forEach(addResizeHandles);
  const imgWrap=document.getElementById('magicImageBlocks');
  if(imgWrap)initDragReorder(imgWrap,'.magic-img-block');
  const memoWrap=document.getElementById('magicQuickMemo');
  if(memoWrap)initDragReorder(memoWrap,'.magic-postit');
}
const _resizeObserver=new MutationObserver(function(){
  document.querySelectorAll('.magic-img-block,.magic-postit').forEach(addResizeHandles);
});
setTimeout(function(){
  const imgW=document.getElementById('magicImageBlocks');if(imgW)_resizeObserver.observe(imgW,{childList:true});
  const memoW=document.getElementById('magicQuickMemo');if(memoW)_resizeObserver.observe(memoW,{childList:true});
  initAllResizeHandles();
},500);

function magicImgUpload(input){
  if(!input.files.length)return;const file=input.files[0];const reader=new FileReader();
  reader.onload=function(e){const block=input.closest('.magic-img-block');const img=block.querySelector('.magic-img-preview');const ph=block.querySelector('.magic-img-placeholder');img.src=e.target.result;img.style.display='block';ph.style.display='none';};
  reader.readAsDataURL(file);
}
document.addEventListener('paste',function(e){
  const items=e.clipboardData&&e.clipboardData.items;if(!items)return;
  for(let i=0;i<items.length;i++){
    if(items[i].type.indexOf('image')!==-1){
      const file=items[i].getAsFile();if(!file)continue;
      const blocks=document.querySelectorAll('.magic-img-block');
      let target=null;
      for(let j=0;j<blocks.length;j++){const img=blocks[j].querySelector('.magic-img-preview');if(!img||!img.src||img.style.display==='none'){target=blocks[j];break;}}
      if(!target)return;
      const dt=new DataTransfer();dt.items.add(file);
      const input=target.querySelector('input[type=file]');input.files=dt.files;magicImgUpload(input);
      e.preventDefault();return;
    }
  }
});




function getMagicLinks(){
  const links=JSON.parse(localStorage.getItem('ec_magic_links')||'[]');
  if(!Array.isArray(links)) return [];
  return links.filter(function(it){return it&&it.title&&it.url;});
}
function saveMagicLinks(links){
  magicLinks=links||[];
  localStorage.setItem('ec_magic_links',JSON.stringify(magicLinks));
  autoSaveMagic();
}
function renderMagicLinks(){
  const list=document.getElementById('magicLinkList');
  if(!list) return;
  const links=getMagicLinks();
  if(!links.length){
    list.innerHTML='<div class="magic-link-empty">＋ 버튼을 눌러 링크를 추가하세요.</div>';
    return;
  }
  list.innerHTML=links.map(function(link,idx){
    const t=escHtml(link.title);
    const u=escHtml(link.url);
    return '<div class="magic-link-item">'
      +'<span style="flex:1;font-size:11px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+t+'</span>'
      +'<a class="link-go" href="'+u+'" target="_blank" rel="noopener noreferrer" title="사이트로 이동">↗</a>'
      +'<button data-action="delLink" data-idx="'+idx+'" style="width:14px;height:14px;border-radius:50%;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.12);color:#ef4444;font-size:9px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0" title="삭제">✕</button>'
      +'</div>';
  }).join('');
  list.querySelectorAll('[data-action="delLink"]').forEach(function(el){
    el.addEventListener('click',function(){deleteMagicLinkItem(Number(el.dataset.idx));});
  });
}
function deleteMagicLinkItem(idx){
  const links=getMagicLinks();
  links.splice(idx,1);
  saveMagicLinks(links);
  renderMagicLinks();
}

function magicTodayKey(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function getMagicRoutineItems(){
  const items=JSON.parse(localStorage.getItem('ec_magic_routines')||'[]');
  const today=magicTodayKey();
  let changed=false;
  items.forEach(function(item){
    if(item && item.checkedDate && item.checkedDate!==today){
      item.checkedDate='';
      changed=true;
    }
  });
  if(changed) localStorage.setItem('ec_magic_routines',JSON.stringify(items));
  return items;
}
function saveMagicRoutineItems(items){
  localStorage.setItem('ec_magic_routines',JSON.stringify(items));
}
function renderMagicRoutineList(){
  const list=document.getElementById('magicRoutineList');
  if(!list) return;
  const items=getMagicRoutineItems();
  list.innerHTML='';
  items.forEach(function(item, idx){
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:6px;width:100%';
    const checked=item&&item.checkedDate===magicTodayKey();
    const safeText=String(item&&item.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    row.innerHTML='<input type="checkbox" style="accent-color:var(--cyan);width:13px;height:13px" '+(checked?'checked':'')+' data-role="routineCheck">'
      +'<input class="form-input" value="'+safeText+'" placeholder="루틴 입력" style="flex:1;font-size:10.5px;padding:5px 8px;border:none;border-bottom:1px solid var(--bdr);border-radius:0;background:transparent;'+(checked?'text-decoration:line-through;opacity:0.6;':'')+'" data-role="routineText">'
      +'<button data-role="routineDel" style="margin-left:auto;width:14px;height:14px;border-radius:50%;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.12);color:#ef4444;font-size:9px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0" title="삭제">✕</button>';
    row.querySelector('[data-role="routineCheck"]').addEventListener('change',function(){toggleMagicRoutineItem(idx,this.checked);});
    row.querySelector('[data-role="routineText"]').addEventListener('input',function(){updateMagicRoutineText(idx,this.value);});
    row.querySelector('[data-role="routineDel"]').addEventListener('click',function(){deleteMagicRoutineItem(idx);});
    list.appendChild(row);
  });
}
function updateMagicRoutineText(idx, value){
  const items=getMagicRoutineItems();
  if(!items[idx]) return;
  items[idx].text=value;
  saveMagicRoutineItems(items);
}
function toggleMagicRoutineItem(idx, checked){
  const items=getMagicRoutineItems();
  if(!items[idx]) return;
  items[idx].checkedDate=checked?magicTodayKey():'';
  saveMagicRoutineItems(items);
  renderMagicRoutineList();
}
function deleteMagicRoutineItem(idx){
  const items=getMagicRoutineItems();
  items.splice(idx,1);
  saveMagicRoutineItems(items);
  renderMagicRoutineList();
}

function magicTodoTodayKey(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function getMagicTodoItems(){
  const items=JSON.parse(localStorage.getItem('ec_magic_todos')||'[]');
  const today=magicTodoTodayKey();
  const filtered=items.filter(function(item){
    if(item&&item.checkedDate&&item.checkedDate!==today) return false;
    return true;
  });
  if(filtered.length!==items.length) localStorage.setItem('ec_magic_todos',JSON.stringify(filtered));
  return filtered;
}
function saveMagicTodoItems(items){
  localStorage.setItem('ec_magic_todos',JSON.stringify(items));
}
function renderMagicTodoList(){
  const list=document.getElementById('magicTodoList');
  if(!list) return;
  const items=getMagicTodoItems();
  list.innerHTML='';
  items.forEach(function(item, idx){
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:6px;width:100%';
    const checked=item&&item.checkedDate===magicTodoTodayKey();
    const safeText=String(item&&item.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    row.innerHTML='<input type="checkbox" style="accent-color:var(--cyan);width:13px;height:13px" '+(checked?'checked':'')+' data-role="todoCheck">'
      +'<input class="form-input" value="'+safeText+'" placeholder="할 일 입력" style="flex:1;font-size:10.5px;padding:5px 8px;border:none;border-bottom:1px solid var(--bdr);border-radius:0;background:transparent;'+(checked?'text-decoration:line-through;opacity:0.6;':'')+'" data-role="todoText">'
      +'<button data-role="todoDel" style="margin-left:auto;width:14px;height:14px;border-radius:50%;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.12);color:#ef4444;font-size:9px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0" title="삭제">✕</button>';
    row.querySelector('[data-role="todoCheck"]').addEventListener('change',function(){toggleMagicTodoItem(idx,this.checked);});
    row.querySelector('[data-role="todoText"]').addEventListener('input',function(){updateMagicTodoText(idx,this.value);});
    row.querySelector('[data-role="todoDel"]').addEventListener('click',function(){deleteMagicTodoItem(idx);});
    list.appendChild(row);
  });
}
function updateMagicTodoText(idx, value){
  const items=getMagicTodoItems();
  if(!items[idx]) return;
  items[idx].text=value;
  saveMagicTodoItems(items);
}
function toggleMagicTodoItem(idx, checked){
  const items=getMagicTodoItems();
  if(!items[idx]) return;
  items[idx].checkedDate=checked?magicTodoTodayKey():'';
  saveMagicTodoItems(items);
  renderMagicTodoList();
}
function deleteMagicTodoItem(idx){
  const items=getMagicTodoItems();
  items.splice(idx,1);
  saveMagicTodoItems(items);
  renderMagicTodoList();
}

function initMagic(){
  renderMagicLinks();
  renderMagicTodoList();
  renderMagicRoutineList();
  renderMemoList();
  const savedMemo=localStorage.getItem('ec_magic_memo');
  const active=document.querySelector('#magicMemoActive .memo-content-input');
  if(active&&savedMemo)active.value=savedMemo;
  const now=new Date();const ts=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const tsEl=document.querySelector('#magicMemoActive .memo-timestamp');if(tsEl)tsEl.textContent=ts;
}

/* ═══════════════════════════════════════
   INIT
   ═══════════════════════════════════════ */
function renderHeader(){
  if(_hdrCycle.phase!==0||S._hdrRendering)return;
  const infoEl=document.getElementById('headerUserInfo');
  if(infoEl){
    const cu=S._currentUser||{};
    const up=S._userProfile||(function(){try{return JSON.parse(localStorage.getItem('ec_user')||'{}');}catch(e){return {};}})();
    const hs=JSON.parse(localStorage.getItem('ec_settings')||'{}');
    /* 첫 실행 시(position 미저장 상태) 에도 직위를 노출하기 위해 기본값 '보건교사' 적용 —
       header-widget.js _hdrPhaseHtml 와 동일한 폴백 체인 사용 */
    const eduOffice=cu.edu_office||up.eduOffice||hs.eduOffice||'';
    const schoolName=cu.school_name||up.school||hs.schoolName||'';
    const position=cu.position||up.position||hs.position||hs.nursePosition||'보건교사';
    const nameStr=cu.name||up.name||hs.nurse1||'';
    const parts=[eduOffice,schoolName,position,nameStr].filter(Boolean);
    infoEl.textContent=parts.join(' · ')||'';
  }
}
/* ═══════════════════════════════════════
   DAILY COLUMN SELECTOR (#col-selector)
   ═══════════════════════════════════════ */
/* ═══ 바디맵 바디맵 시스템 ═══ */
const _bmData={};
window._bmData=_bmData;
/* 바디맵 마커 변경 시 해당 daily_records 를 즉시 DB에 저장 */
function _bmPersist(recId){
  if(recId==null)return;
  const rec=(S.records||[]).find(function(r){return r&&(r.id===recId||r._dbId===recId);});
  if(!rec)return;
  rec.bodymapData=_bmData[recId]||[];
  if(typeof saveRecordNow==='function')saveRecordNow(rec);
  /* 바디맵 마커 추가·삭제(바디맵 클릭) 시에도 저장 완료 토스트 표시 (사용자 요청 2026-06-16) */
  if(typeof showGlobalSaveToast==='function')showGlobalSaveToast();
}
window._bmPersist=_bmPersist;
/* 더미 바디맵 데이터 병합 */
if(typeof _bmDummyData!=='undefined'&&_bmDummyData){Object.keys(_bmDummyData).forEach(function(k){if(!_bmData[k])_bmData[k]=_bmDummyData[k];});}
/* 바디맵 영역 anchor — bodymap-anchors-preview.html 편집기에서 사각형으로 그린 부위 영역.
 * 형식: {cx, cy, w, h, shape:'rect', label} — 클릭이 영역 안에 들어가면 그 label 적용 (면적 작은 것 우선).
 * 영역 외 클릭은 _bmNearestLabel 의 폴백 최근접 점 매칭으로 처리.
 * 원본 백업: assets/bodymap/bodymap-anchors.json.js */
/* anchor 배열 7개 (_bmBodyPartsAdult, _bmFaceParts, _bmTeethParts, _bmHandTopParts, _bmPalmParts, _bmFootTopParts, _bmFootBottomParts) 는 src/renderer/core/bodymap-anchors.js 로 이전. 사용처는 import 로 가져옴. */

/* 모든 알려진 바디맵 부위명 — 증상 라벨에서 "부위명 vs 자유서술 메모" 를 구분하는 데 사용.
 * symptom-view.js 의 메모 추출이 stored 문자열에서 부위명을 안전하게 strip 할 수 있도록 전역 노출. */
window._bmAllKnownPartLabels = (function(){
  const _s = new Set();
  [_bmBodyPartsAdult, _bmFaceParts, _bmTeethParts, _bmHandTopParts, _bmPalmParts, _bmFootTopParts, _bmFootBottomParts].forEach(function(arr){
    arr.forEach(function(p){ if(p && p.label) _s.add(p.label); });
  });
  return _s;
})();
function _bmIsKinder(recId){
  if((S.settings||{}).schoolLevel==='kindergarten') return true;
  /* 특수학교: 개별 학생의 level 확인 */
  if((S.settings||{}).schoolLevel==='special'&&recId){
    const rec=S.records.find(function(r){return r.id===recId;})||S.ecRecords&&S.ecRecords.find(function(r){return r.id===recId;});
    if(rec){const s=getStu(rec.studentId);if(s&&s.level==='유')return true;}
  }
  return false;
}
function _bmGetImages(recId){
  const kinder=_bmIsKinder(recId);
  return [
    {key:'body',  file:kinder?'assets/bodymap/child_body.png' :'assets/bodymap/adult_body.png',  name:'전신',parts:_bmBodyPartsAdult},
    {key:'face',  file:kinder?'assets/bodymap/face_child.png' :'assets/bodymap/face_adult.png',  name:'얼굴',parts:_bmFaceParts},
    {key:'teeth', file:kinder?'assets/bodymap/child_teeth.png':'assets/bodymap/adult_teeth.png', name:'구강',parts:_bmTeethParts},
    {key:'handTop',  file:'assets/bodymap/hands-top.png',  name:'손등',  parts:_bmHandTopParts},
    {key:'palm',     file:'assets/bodymap/palm.png',       name:'손바닥',parts:_bmPalmParts},
    {key:'footTop',  file:'assets/bodymap/foot_top.png',   name:'발등',  parts:_bmFootTopParts},
    {key:'footBottom',file:'assets/bodymap/foot_bottom.png',name:'발바닥',parts:_bmFootBottomParts}
  ];
}
let _bmImages=_bmGetImages();
function _bmActualImgRect(img){
  const r=img.getBoundingClientRect();
  const nw=img.naturalWidth||r.width, nh=img.naturalHeight||r.height;
  const ratio=nw/nh, cRatio=r.width/r.height;
  let aw, ah, ox, oy;
  if(ratio>cRatio){aw=r.width;ah=r.width/ratio;ox=0;oy=(r.height-ah)/2;}
  else{ah=r.height;aw=r.height*ratio;ox=(r.width-aw)/2;oy=0;}
  return{left:r.left+ox,top:r.top+oy,width:aw,height:ah};
}
/* 클릭 위치 → 부위 라벨 매칭
 *  1) hit-region 매칭 우선 — anchor 에 shape(circle/ellipse/rect) + w/h 가 정의되어 있고
 *     클릭이 그 영역 안에 들어가면 후보로. 여러 영역 겹치면 면적 가장 작은 = 가장 구체적인 라벨 선택.
 *  2) 폴백 — 기존 점 기반 최근접 매칭 (영역 미정의 anchor 호환). */
function _bmNearestLabel(parts,xPct,yPct){
  let bestHit=null, bestArea=Infinity;
  parts.forEach(function(p){
    if(p.shape && p.w>0 && p.h>0){
      const hw=p.w/2, hh=p.h/2;
      let inside=false;
      if(p.shape==='circle'||p.shape==='ellipse'){
        const dx=(xPct-p.cx)/hw, dy=(yPct-p.cy)/hh;
        inside=(dx*dx+dy*dy)<=1;
      } else if(p.shape==='rect'){
        inside=Math.abs(xPct-p.cx)<=hw && Math.abs(yPct-p.cy)<=hh;
      }
      if(inside){
        const area=p.w*p.h;
        if(area<bestArea){bestArea=area;bestHit=p.label;}
      }
    }
  });
  if(bestHit) return bestHit;
  let best=null, bd=Infinity;
  parts.forEach(function(p){const d=(xPct-p.cx)*(xPct-p.cx)+(yPct-p.cy)*(yPct-p.cy);if(d<bd){bd=d;best=p.label;}});
  return best||'미지정';
}
/* L/R 라벨 위치 — 모듈 레벨 (사용자 결정 2026-05-27, bodymap-label-editor.html 로 직접 배치 후 박음).
 *  _bmRenderMarkers 에서 직접 접근하도록 모듈 스코프에 둠.
 *  좌표는 "이미지 내부 0~100%" — 마커와 동일한 좌표 시스템. */
/* _BM_LR_POSITIONS 는 src/renderer/core/bodymap-anchors.js 로 이전. import 로 가져옴. */
/* 부위명 태그(ov 최상위 position:fixed)를 마커(dot) 화면 좌표 cx,cy 옆 4방향(우→하→좌→상)에 배치.
 *  마커를 가리지 않게 18px 여백. dir 클릭마다 +1 누적 → %4 순환. (사용자 요청 2026-06-16) */
/* 태그를 마커 중심(cx,cy) 둘레 angleDeg(도) 방향·반경 R 에 배치 — 360° 자유 회전. 라벨은 항상 마커 바깥으로 뻗는다. (사용자 요청 2026-06-16) */
function _bmTagAngleOf(m){
  if(m && typeof m.labelAngle==='number') return m.labelAngle;
  const d=(m&&typeof m.labelDir==='number')?(((m.labelDir%4)+4)%4):0;  /* 구버전 labelDir(우하좌상) 각도 호환 */
  return [0,90,180,270][d];
}
function _bmTagPos(el,cx,cy,angleDeg){
  const a=(angleDeg||0)*Math.PI/180, R=14;
  /* CSS zoom 보정: cx,cy 는 getBoundingClientRect 의 시각(확대) 좌표지만, position:fixed 태그의
   * style.left/top 은 레이아웃 단위(렌더 시 ×배율)라 배율로 나눠야 한다. 안 나누면 고배율에서
   * 태그가 화면 밖으로 밀려 부위명이 안 뜬다. 100%면 1이라 무해. (2026-07-21 160% 대응) */
  let _zf=1;
  try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
  el.style.left=((cx+R*Math.cos(a))/_zf)+'px';
  el.style.top=((cy+R*Math.sin(a))/_zf)+'px';
  el.style.transform='translate('+(-50+50*Math.cos(a)).toFixed(2)+'%,'+(-50+50*Math.sin(a)).toFixed(2)+'%)';
}
/* 태그 회전 — 태그를 끌면 마커 둘레를 따라 360° 어느 각도로든 회전(atan2). document 레벨 capture 로 한 번만 등록
 *  (zone 안 클릭이 환경 따라 미발화하던 문제 우회). 펜(편집)·입력칸에서는 회전 시작 안 함. (사용자 요청 2026-06-16) */
let _bmTagRotateBound=false;
function _bmBindTagRotate(){
  if(_bmTagRotateBound)return; _bmTagRotateBound=true;
  document.addEventListener('mousedown',function(e){
    if(e.button!==0)return;
    const _lbl=e.target&&e.target.closest&&e.target.closest('.bm-marker-label');
    if(!_lbl||_lbl.dataset.recid==null||_lbl.dataset.recid==='')return;
    if(e.target.closest&&(e.target.closest('.bm-lbl-pen')||e.target.closest('.bm-lbl-input')))return;
    e.preventDefault(); e.stopPropagation();
    const _rid=parseInt(_lbl.dataset.recid,10);
    const _mi=parseInt(_lbl.dataset.mi,10);
    const _arr=(typeof _bmData!=='undefined'&&_bmData[_rid])||[];
    const _m=_arr[_mi];
    if(!_m)return;
    const _dot=document.querySelector('.bm-marker[data-mi="'+_mi+'"]');
    if(!_dot)return;
    const _r=_dot.getBoundingClientRect();
    const cx=_r.left+_r.width/2, cy=_r.top+_r.height/2;
    const _prevTr=_lbl.style.transition; _lbl.style.transition='none'; _lbl.style.cursor='grabbing';
    let _changed=false;
    function _mv(ev){
      _changed=true;
      const ang=Math.atan2(ev.clientY-cy, ev.clientX-cx)*180/Math.PI;
      _m.labelAngle=((ang%360)+360)%360; if('labelDir' in _m) delete _m.labelDir;
      _bmTagPos(_lbl, cx, cy, _m.labelAngle);
    }
    function _up(){
      document.removeEventListener('mousemove',_mv,true);
      document.removeEventListener('mouseup',_up,true);
      _lbl.style.transition=_prevTr||''; _lbl.style.cursor='grab';
      if(_changed && typeof _bmPersist==='function')_bmPersist(_rid);
    }
    document.addEventListener('mousemove',_mv,true);
    document.addEventListener('mouseup',_up,true);
  },true);
}
function _bmRenderMarkers(recId){
  const markers=_bmData[recId]||[];
  const ov=document.getElementById('bmOverlay')||document.getElementById('chartModeOverlay');
  if(!ov)return;
  /* 이전 태그(ov 직접 fixed 자식)를 zone 재렌더와 별도로 ov 에서 직접 제거 (2026-06-16) */
  ov.querySelectorAll('.bm-marker-label').forEach(function(el){el.remove();});
  const allZones=ov.querySelectorAll('.bm-zone');
  allZones.forEach(function(zone){
    const bmKey=zone.dataset.bmKey;
    zone.querySelectorAll('.bm-marker,.bm-marker-label').forEach(function(el){el.remove();});
    /* 마커가 있는 zone 을 인접 zone 위로 올림 — 부위명 태그가 zone 경계를 넘어
     *  옆 이미지(전신 등) 아래로 가려지지 않도록 (사용자 요청 2026-06-16).
     *  이미지는 각자 flex 칸 안이라 안 겹치고, 삐져나온 태그만 위로 뜬다. */
    zone.style.zIndex = markers.some(function(m){return m.imgKey===bmKey;}) ? '500' : '';
    const markersDiv=zone.querySelector('.bm-markers');
    if(markersDiv)markersDiv.innerHTML='';
    const img=zone.querySelector('img');
    if(!img)return;
    /* 왼쪽/오른쪽 라벨 동적 렌더 — zone 기준 % 직접 적용 (사용자 결정 2026-05-27 옵션 A).
     *  편집기와 프로그램이 같은 PC window 크기 기반 동일 zone 비율 — letterbox 보정 불필요. */
    const _lrList=_BM_LR_POSITIONS_PROGRAM[bmKey];   /* 프로그램 전용 L/R 위치 (키오스크 불변) */
    if(_lrList && _lrList.length && markersDiv){
      _lrList.forEach(function(lb){
        const sp=document.createElement('span');
        sp.className='bm-lr-label';
        sp.style.cssText='position:absolute;left:'+lb.leftPct+'%;top:'+lb.topPct+'%;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif;font-size:11px;font-weight:700;color:#888;background:transparent;border:1px solid rgba(128,128,128,0.4);border-radius:3px;padding:1px 5px;line-height:1.2;pointer-events:none;user-select:none';
        sp.textContent=lb.label;
        markersDiv.appendChild(sp);
      });
    }
    const _nrsColors=['#22c55e','#4ade80','#a3e635','#facc15','#fbbf24','#f59e0b','#f97316','#ef4444','#dc2626','#991b1b'];
    markers.forEach(function(mk,mi){
      if(mk.imgKey!==bmKey)return;
      const zoneRect=zone.getBoundingClientRect();
      const actualRect=_bmActualImgRect(img);
      const offXPct=(actualRect.left-zoneRect.left)/zoneRect.width*100;
      const offYPct=(actualRect.top-zoneRect.top)/zoneRect.height*100;
      const scaleX=actualRect.width/zoneRect.width*100;
      const scaleY=actualRect.height/zoneRect.height*100;
      const leftPct=offXPct+mk.x/100*scaleX;
      const topPct=offYPct+mk.y/100*scaleY;
      const dot=document.createElement('div');
      dot.className='bm-marker';
      dot.dataset.mi=mi;
      dot.style.cssText='position:absolute;width:20px;height:20px;border-radius:50%;border:2px solid #fff;transform:translate(-50%,-50%);z-index:10;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:#fff;pointer-events:auto';
      let dotBg='#22c55e';
      if(mk.nrs===0){
        dot.style.background='#22c55e';
        dot.textContent='✓';
        dot.title='';
      } else {
        dotBg=_nrsColors[Math.min((mk.nrs||1)-1,9)];
        dot.style.background=dotBg;
        dot.textContent=mk.nrs;
        dot.title='';
      }
      dot.style.left=leftPct+'%';
      dot.style.top=topPct+'%';
      /* 드래그 = 위치 이동 / 단순 클릭 = 해제(삭제) (사용자 요청 2026-06-16) */
      dot.style.cursor='grab';
      dot.addEventListener('click',function(e){e.stopPropagation();});
      dot.addEventListener('mousedown',function(e){
        if(e.button!==0)return;
        e.stopPropagation();e.preventDefault();
        const _sx=e.clientX,_sy=e.clientY;let _moved=false;
        const _aRect=_bmActualImgRect(img);
        dot.style.cursor='grabbing';
        function _mv(ev){
          if(!_moved && (Math.abs(ev.clientX-_sx)>3||Math.abs(ev.clientY-_sy)>3))_moved=true;
          if(!_moved)return;
          let _nx=(ev.clientX-_aRect.left)/_aRect.width*100;
          let _ny=(ev.clientY-_aRect.top)/_aRect.height*100;
          _nx=Math.max(0,Math.min(100,_nx));_ny=Math.max(0,Math.min(100,_ny));
          mk.x=+_nx.toFixed(2);mk.y=+_ny.toFixed(2);
          const _lp=(offXPct+mk.x/100*scaleX)+'%', _tp=(offYPct+mk.y/100*scaleY)+'%';
          dot.style.left=_lp; dot.style.top=_tp;
          /* 태그(ov fixed)도 dot 새 화면 위치 따라 이동 — 해제 시 뚝 점프 방지 (사용자 보고 2026-06-16) */
          const _ovEl=document.getElementById('bmOverlay');
          const _lbl=_ovEl&&_ovEl.querySelector('.bm-marker-label[data-mi="'+mi+'"]');
          if(_lbl){ const _dr2=dot.getBoundingClientRect(); _bmTagPos(_lbl,_dr2.left+_dr2.width/2,_dr2.top+_dr2.height/2,_bmTagAngleOf(mk)); }
        }
        function _up(){
          document.removeEventListener('mousemove',_mv,true);
          document.removeEventListener('mouseup',_up,true);
          dot.style.cursor='grab';
          if(_moved){
            /* 이동한 새 위치의 부위명으로 갱신 — 이전 부위명이 아니라 옮긴 자리의 부위명 (사용자 요청 2026-06-16) */
            const _bmDef=(_bmImages||[]).find(function(b){return b.key===mk.imgKey;});
            if(_bmDef && typeof _bmNearestLabel==='function'){ const _nl=_bmNearestLabel(_bmDef.parts,mk.x,mk.y); if(_nl)mk.label=_nl; }
            _bmPersist(recId); _bmRenderMarkers(recId);
          }
          else {
            /* 사용자 요청 — 바디맵 부위 해제 시 선택 증상에서도 해제 + 일반일지 표에서도 사라져야 함 */
            const _removedSym=mk.symptom||'';
            _bmData[recId].splice(mi,1);
            _bmRenderMarkers(recId);_bmPersist(recId);
            try{bus.emit('bm:marker-changed',{recId:recId,removedSymptom:_removedSym});}catch(_){}
          }
        }
        document.addEventListener('mousemove',_mv,true);
        document.addEventListener('mouseup',_up,true);
      });
      if(markersDiv)markersDiv.appendChild(dot);
      else zone.appendChild(dot);
      /* 부위명 칩 — 마커 주변 4 방향 중 경계 안에 들어가는 곳에 자동 배치.
       * 좌우는 marker 의 leftPct, 상하는 topPct 기준으로 결정.
       * leftPct > 65 → 좌측, 그 외 → 우측 / topPct > 80 → 위, < 5 → 아래, 그 외 → 마커와 수직 중앙.
       * 호버 시 ✏️ 펜 아이콘 노출 → 클릭하면 라벨 텍스트가 input 으로 전환되어 인라인 수정.
       * 라벨 클릭으로 마커 삭제 방지: pointer-events:auto + stopPropagation. */
      if(mk.label){
        const lblWrap=document.createElement('div');
        lblWrap.className='bm-marker-label';
        lblWrap.dataset.mi=mi;
        lblWrap.dataset.recid=recId;
        const stickerBg=mk.nrs===0?'#22c55e':dotBg;
        /* 태그는 모달 최상위(ov)에 position:fixed 로 — zone 안에서는 클릭이 통과해 안 잡히던 문제 해결(확진 2026-06-16).
         *  마커(dot) 실제 화면 좌표 옆에 배치, 태그를 끌면 _bmTagPos 로 마커 둘레 360° 자유 회전(옆 부위 가림 방지). transition 으로 부드럽게. */
        lblWrap.style.cssText='position:fixed;transition:left .35s cubic-bezier(0.34,1.56,0.64,1),top .35s cubic-bezier(0.34,1.56,0.64,1);display:inline-flex;align-items:center;gap:4px;background:rgba(15,23,42,0.92);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;border:1.5px solid '+stickerBg+';white-space:nowrap;z-index:13000;pointer-events:auto;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:grab';
        lblWrap.title='끌어서 마커 둘레로 360° 회전합니다 (옆 부위 가림 방지)';
        const lblText=document.createElement('span');
        lblText.className='bm-lbl-text';
        /* 부위 뒤에 ", 증상" 함께 표시. mk.symptom 가 있으면 "목, 인후통" 형태 */
        lblText.textContent=mk.label+(mk.symptom?(', '+mk.symptom):'');
        const penIcon=document.createElement('span');
        penIcon.className='bm-lbl-pen';
        penIcon.textContent='✏️';
        penIcon.title='부위명 수정';
        penIcon.style.cssText='cursor:pointer;font-size:10px;line-height:1;padding:0 2px;border-radius:3px;transition:transform .12s;margin-left:1px';
        penIcon.addEventListener('mouseenter',function(){penIcon.style.transform='scale(1.25)';});
        penIcon.addEventListener('mouseleave',function(){penIcon.style.transform='scale(1)';});
        lblWrap.appendChild(lblText);
        lblWrap.appendChild(penIcon);
        /* 펜 클릭 → 인라인 편집(회전과 분리: stopPropagation 으로 ov 회전 핸들러 미발화) */
        penIcon.addEventListener('click',function(e){
          e.stopPropagation();
          const cur=mk.label;
          const inp=document.createElement('input');
          inp.type='text';inp.value=cur;inp.className='bm-lbl-input';
          inp.style.cssText='background:transparent;border:none;outline:none;color:#fff;font-size:10px;font-weight:700;font-family:inherit;width:'+Math.max(60,cur.length*8)+'px;padding:0';
          lblWrap.replaceChild(inp,lblText);
          inp.focus();inp.select();
          let _done2=false;
          function commit(){
            if(_done2)return;_done2=true;
            const v=inp.value.trim()||cur;
            mk.label=v;
            _bmPersist(recId);
            _bmRenderMarkers(recId);
            if(typeof _bmUpdateSummary==='function')_bmUpdateSummary(recId);
            try{bus.emit('bm:marker-changed',{recId:recId});}catch(_){}
          }
          inp.addEventListener('blur',function(){setTimeout(commit,50);});
          inp.addEventListener('keydown',function(ev){
            if(ev.key==='Enter'){ev.preventDefault();inp.blur();}
            else if(ev.key==='Escape'){ev.preventDefault();_done2=true;_bmRenderMarkers(recId);}
          });
        });
        ov.appendChild(lblWrap);
        /* dot 의 실제 화면 좌표 기준으로 태그 배치 */
        const _dr=dot.getBoundingClientRect();
        _bmTagPos(lblWrap, _dr.left+_dr.width/2, _dr.top+_dr.height/2, _bmTagAngleOf(mk));
      }
    });
  });
  /* 부위 라벨 칩 겹침 회피 — 모든 마커 렌더 직후 측정/조정.
   * 두 칩이 사각형이 겹치면 아래쪽 칩을 px 단위로 내려 분리.
   * CSS zoom 환경에서도 getBoundingClientRect 와 marginTop 모두 같은 배율로
   * 적용되므로 비율적으로 정확. 최대 8회 반복으로 다중 충돌 해소. */
  requestAnimationFrame(function(){
    allZones.forEach(function(zone){
      const lbls=Array.from(zone.querySelectorAll('.bm-marker-label'));
      if(lbls.length<2)return;
      lbls.forEach(function(el){el.style.marginTop='0px';el.dataset.shiftY='0';});
      const items=lbls.map(function(el){return {el:el,rect:el.getBoundingClientRect()};});
      items.sort(function(a,b){return a.rect.top-b.rect.top;});
      for(let pass=0;pass<8;pass++){
        let moved=false;
        for(let i=0;i<items.length;i++){
          for(let j=i+1;j<items.length;j++){
            const a=items[i].rect,b=items[j].rect;
            if(a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom){
              const dy=(a.bottom-b.top)+3;
              const cur=parseFloat(items[j].el.dataset.shiftY||'0');
              const nxt=cur+dy;
              items[j].el.dataset.shiftY=String(nxt);
              items[j].el.style.marginTop=nxt+'px';
              items[j].rect=items[j].el.getBoundingClientRect();
              moved=true;
            }
          }
        }
        if(!moved)break;
      }
    });
  });
}
function _bmUpdateSummary(recId){
  const el=document.getElementById('bmSummary');
  if(!el)return;
  const markers=_bmData[recId]||[];
  if(!markers.length){el.innerHTML='<span style="color:var(--t3);font-size:11px">원클릭은 불편한 곳 체크 표시, 더블클릭은 불편한 곳 통증 척도 입력, 체크 또는 척도를 한 번 더 클릭하여 해제할 수 있고 제시된 부위명을 수정버튼을 클릭하여 수정할 수 있습니다.<br>체크, 척도 동그라미를 클릭해서 이동도 가능하고 부위 태그를 클릭하여 360도 회전도 가능합니다.</span>';return;}
  let html='';
  markers.forEach(function(mk,i){
    const colors=['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899'];
    html+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px;border-bottom:1px solid var(--bdr)">'
      +'<span style="width:8px;height:8px;border-radius:50%;background:'+colors[i%colors.length]+';flex-shrink:0"></span>'
      +'<span style="font-weight:600;color:var(--t1)">'+mk.label+(mk.symptom?(', '+mk.symptom):'')+'</span>'
      +'<span style="color:var(--t3)">NRS '+mk.nrs+'</span>'
      +'<span data-action="bmDel" data-idx="'+i+'" style="cursor:pointer;color:#ef4444;margin-left:auto;font-size:9px">✕</span>'
      +'</div>';
  });
  el.innerHTML=html;
  el.querySelectorAll('[data-action="bmDel"]').forEach(function(btn){
    btn.addEventListener('click',function(){const idx=Number(btn.dataset.idx);const _removedSym=(_bmData[recId][idx]&&_bmData[recId][idx].symptom)||'';_bmData[recId].splice(idx,1);_bmRenderMarkers(recId);_bmUpdateSummary(recId);_bmPersist(recId);try{bus.emit('bm:marker-changed',{recId:recId,removedSymptom:_removedSym});}catch(_){}});
  });
}
export function openBodyMap(recId,anchor,opts){
  /* opts.readOnly: 마커 표시만, 클릭/더블클릭 입력 비활성. 바디맵 이력 보기 전용.
   * opts.symptom: 새 마커 추가 시 그 증상 이름을 marker.symptom 으로 부착 (Phase 3d). */
  const _readOnly=!!(opts&&opts.readOnly);
  const _activeSymptom=(opts&&opts.symptom)?String(opts.symptom):'';
  const existing=document.getElementById('bmOverlay');
  if(existing)closeModalGracefully(existing);
  if(!_bmData[recId])_bmData[recId]=[];
  /* 모달 열릴 때 학교급에 맞는 이미지 목록 갱신 */
  _bmImages=_bmGetImages(recId);
  const kinder=_bmIsKinder(recId);
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='bmOverlay';
  ov.style.cssText='z-index:9999;background:transparent';

  /* _BM_LR_POSITIONS 는 모듈 레벨로 이동 (_bmRenderMarkers 에서 접근 가능하도록). 아래 const 만 남김. */
  function _bmRenderLrLabels(key){
    const list = _BM_LR_POSITIONS_PROGRAM[key];   /* 프로그램 전용 L/R 위치 (키오스크 불변) */
    if(!list || !list.length) return '';
    return list.map(function(lb){
      /* 회색 글자 + 반투명 회색 테두리 + 투명 배경 (사용자 요청 2026-05-27).
       *  체크 표시·통증 척도 마커가 라벨 위에 그려지도록 z-index 0 (마커는 더 높음).
       *  pointer-events:none 으로 클릭/이벤트 가로채지 않음 — 마커 입력 절대 방해 X. */
      return '<span class="bm-lr-label" style="position:absolute;left:'+lb.leftPct+'%;top:'+lb.topPct+'%;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif;font-size:11px;font-weight:700;color:#888;background:transparent;border:1px solid rgba(128,128,128,0.4);border-radius:3px;padding:1px 5px;line-height:1.2;pointer-events:none;z-index:0;user-select:none">'+lb.label+'</span>';
    }).join('');
  }
  function _bmZone(key,file,style){
    /* 라벨은 정적 HTML 박지 않음 — _bmRenderMarkers 가 _bmActualImgRect 로 letterbox 보정 후 동적 추가.
     *  사용자 보고 2026-05-27: 정적 % 는 컨테이너 기준이라 object-fit:contain letterbox 만큼 어긋남.
     *  마커와 동일한 좌표 시스템 (이미지 영역 내부 %) 으로 변환해 정확한 위치 보장. */
    return '<div class="bm-zone" data-bm-key="'+key+'" style="position:relative;cursor:'+(_readOnly?'default':'crosshair')+';user-select:none;-webkit-user-select:none;'+style+'">'
      +'<img src="'+file+'" style="width:100%;height:100%;object-fit:contain;display:block;border-radius:6px;border:1px solid var(--bdr);background:#fff;pointer-events:none" crossorigin="anonymous">'
      +'<div class="bm-markers" style="position:absolute;inset:0;pointer-events:none;z-index:10"></div></div>';
  }

  const faceFile =kinder?'assets/bodymap/face_child.png' :'assets/bodymap/face_adult.png';
  const teethFile=kinder?'assets/bodymap/child_teeth.png':'assets/bodymap/adult_teeth.png';
  const bodyFile =kinder?'assets/bodymap/child_body.png' :'assets/bodymap/adult_body.png';

  ov.innerHTML='<div class="modal-content" style="width:98vw;max-width:1200px;height:96vh;padding:0;overflow:hidden;display:flex;flex-direction:column">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));flex-shrink:0">'
    +'<div><span style="font-size:14px;font-weight:800;color:var(--t1)">🩺 바디맵 '+(_readOnly?'— 읽기 전용 보기':'— 통증 부위 선택')+'</span><div style="font-size:12px;color:var(--t3);margin-top:3px;line-height:1.5">'+(_readOnly?'이력 조회 모드 · 입력은 해당 일자의 일지를 다시 열어 진행하세요.':'원클릭은 불편한 곳 체크 표시, 더블클릭은 불편한 곳 통증 척도 입력, 체크 또는 척도를 한 번 더 클릭하여 해제할 수 있고 제시된 부위명을 수정버튼을 클릭하여 수정할 수 있습니다.<br>체크, 척도 동그라미를 클릭해서 이동도 가능하고 부위 태그를 클릭하여 360도 회전도 가능합니다.')+'</div></div>'
    +''/* 확인 버튼 제거 — 바깥 클릭으로 닫힘 */
    +'</div>'
    +'<div style="display:flex;flex:1;min-height:0;overflow:hidden">'
    /* 왼쪽: 얼굴, 구강, 손, 발 */
    /* overflow:hidden 제거 — 부위명 태그가 옆 이미지(전신 등)로 넘어가도 잘리지 않게.
     *  모달 본문(상위 flex div)의 overflow:hidden 이 팝업 경계 역할을 하므로 모달 밖으로는 안 나감. (사용자 요청 2026-06-16) */
    +'<div style="width:520px;flex-shrink:0;padding:4px;display:flex;flex-direction:column;gap:3px;border-right:1px solid var(--bdr)">'
    +'<div class="bm-pair" style="display:flex;gap:4px;flex:1;min-height:0">'
  +_bmZone('face',faceFile,'flex:1;height:100%')
  +_bmZone('teeth',teethFile,'flex:1;height:100%')
    +'</div>'
    +'<div class="bm-pair" style="display:flex;gap:2px;flex:0.55;min-height:0">'
  +_bmZone('handTop','assets/bodymap/hands-top.png','flex:1;height:100%')
  +_bmZone('palm','assets/bodymap/palm.png','flex:1;height:100%')
    +'</div>'
    +'<div class="bm-pair" style="display:flex;gap:2px;flex:0.7;min-height:0">'
  +_bmZone('footTop','assets/bodymap/foot_top.png','flex:1;height:100%')
  +_bmZone('footBottom','assets/bodymap/foot_bottom.png','flex:1;height:100%')
    +'</div>'
    +'</div>'
    /* 오른쪽: 전신 — 다른 zone 과 동일하게 fixed container + object-fit:contain (사용자 결정 2026-05-27).
     *  편집기와 layout 통일을 위해 inline-block 대신 width:100% height:98% 사용. */
    +'<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:0 6px 0 0;position:relative">'
  +_bmZone('body',bodyFile,'width:100%;height:98%')
    +'</div>'
    +'</div></div>';

  document.body.appendChild(ov);
  /* 바깥 클릭 한 번에 닫기 — mousedown 하나만 등록 (click 중복 제거) */

  /* 읽기 전용 모드: 마커만 렌더, 입력 리스너 없음 */
  if(_readOnly){
    _bmRenderMarkers(recId);
    ov.addEventListener('mousedown',function(e){
      if(e.target===ov){e.stopPropagation();_bmCloseAndRefresh();}
    });
    return;
  }

  /* 태그 클릭 회전 — document capture 로 1회 바인딩(ov capture 가 미발화하던 문제 우회) */
  _bmBindTagRotate();
  /* 모든 zone에 클릭 이벤트 등록 */
  const allZones=ov.querySelectorAll('.bm-zone');
  allZones.forEach(function(zone){
    const bmKey=zone.dataset.bmKey;
    const bm=_bmImages.find(function(b){return b.key===bmKey;});
    if(!bm)return;
    const img=zone.querySelector('img');
    /* 싱글클릭: 초록 체크 / 더블클릭: NRS — 우리가 직접 클릭 카운트 추적 (브라우저 native dblclick 의도치 않게 발화하는 경우 차단).
     * - 첫 클릭: 250ms 타이머 시작
     * - 두번째 클릭이 250ms 이내 + 가까운 위치(<10px) 면 더블클릭 → 타이머 취소 + NRS 팝업
     * - 두번째 클릭이 멀리/늦으면 별개의 싱글클릭으로 처리 */
    let _bmClickTimer=null;
    let _bmLastClickPos=null;
    function _openNrsAt(e){
      if(e.target.classList.contains('bm-marker'))return;
      const actualRect=_bmActualImgRect(img);
      const xPct=(e.clientX-actualRect.left)/actualRect.width*100;
      const yPct=(e.clientY-actualRect.top)/actualRect.height*100;
      if(xPct<0||xPct>100||yPct<0||yPct>100)return;
      try{
        if(!img._bmCache){const _cv=document.createElement('canvas');_cv.width=img.naturalWidth;_cv.height=img.naturalHeight;const _ctx=_cv.getContext('2d');_ctx.drawImage(img,0,0);img._bmCache={ctx:_ctx,w:img.naturalWidth,h:img.naturalHeight};}
        const _cx=Math.floor(xPct/100*img._bmCache.w), _cy=Math.floor(yPct/100*img._bmCache.h);
        const _r=3;
        let _found=false;
        const _sx=Math.max(0,_cx-_r), _sy=Math.max(0,_cy-_r);
        const _sw=Math.min(img._bmCache.w-_sx,_r*2+1), _sh=Math.min(img._bmCache.h-_sy,_r*2+1);
        if(_sw>0&&_sh>0){const _id=img._bmCache.ctx.getImageData(_sx,_sy,_sw,_sh).data;for(let _i=3;_i<_id.length;_i+=4){if(_id[_i]>30){_found=true;break;}}}
        if(!_found) return;
      }catch(ex){}
      const label=_bmNearestLabel(bm.parts,xPct,yPct);
      if(!label)return;
      /* 싱글클릭으로 방금 추가된 체크 마커가 있으면 제거 (같은 위치) */
      const data=_bmData[recId];
      for(let di=data.length-1;di>=0;di--){
        if(data[di].imgKey===bmKey&&Math.abs(data[di].x-xPct)<3&&Math.abs(data[di].y-yPct)<3&&data[di].nrs===0){data.splice(di,1);break;}
      }
      const oldNrs=document.getElementById('bmNrsPop');if(oldNrs)oldNrs.remove();
      const nrsDiv=document.createElement('div');nrsDiv.id='bmNrsPop';
      nrsDiv.style.cssText='position:fixed;left:'+(e.clientX+10)+'px;top:'+(e.clientY-20)+'px;background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:8px 10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:12000;display:flex;flex-direction:column;gap:4px;align-items:center';
      nrsDiv.innerHTML='<div style="font-size:10px;color:var(--t3)">통증 척도(NRS)</div>'
        +'<div style="display:flex;gap:4px" id="bmNrsButtons"></div>'
        +'<img src="assets/bodymap/scale.png" style="width:280px;margin-top:2px;border-radius:4px" onerror="this.style.display=\'none\'">';
      const btnsDiv=nrsDiv.querySelector('#bmNrsButtons');
      for(let n=1;n<=10;n++){
        (function(nrs){
          const btn=document.createElement('button');btn.textContent=nrs;
          const _nrsColors=['#22c55e','#4ade80','#a3e635','#facc15','#fbbf24','#f59e0b','#f97316','#ef4444','#dc2626','#991b1b'];
          btn.style.cssText='width:26px;height:26px;border-radius:50%;border:none;font-size:11px;font-weight:800;color:#fff;cursor:pointer;background:'+_nrsColors[Math.min(nrs-1,9)]+';transition:transform .1s';
          btn.addEventListener('mouseenter',function(){btn.style.transform='scale(1.2)';});
          btn.addEventListener('mouseleave',function(){btn.style.transform='scale(1)';});
          btn.addEventListener('click',function(ev){
            ev.stopPropagation();
            _bmData[recId].push({imgKey:bmKey,x:+xPct.toFixed(2),y:+yPct.toFixed(2),nrs:nrs,label:label,symptom:_activeSymptom});
            nrsDiv.remove();_bmRenderMarkers(recId);_bmPersist(recId);
            try{bus.emit('bm:marker-changed',{recId:recId});}catch(_){}
          });
          btnsDiv.appendChild(btn);
        })(n);
      }
      document.body.appendChild(nrsDiv);
      setTimeout(function(){document.addEventListener('click',function cl(ev){if(!nrsDiv.contains(ev.target)){nrsDiv.remove();document.removeEventListener('click',cl);}});},10);
    }
    zone.addEventListener('click',function(e){
      if(e.target.classList.contains('bm-marker'))return;
      /* 태그 클릭 회전은 ov capture 핸들러가 처리(태그는 ov 최상위 fixed). zone 에서는 빈 영역 클릭만 마커 생성. */
      const _pos={x:e.clientX,y:e.clientY};
      /* 두번째 클릭이 가까운 위치(20px)면 dblclick 으로 인식 → NRS */
      if(_bmClickTimer && _bmLastClickPos &&
         Math.abs(_pos.x-_bmLastClickPos.x)<20 && Math.abs(_pos.y-_bmLastClickPos.y)<20){
        clearTimeout(_bmClickTimer); _bmClickTimer=null; _bmLastClickPos=null;
        _openNrsAt(e);
        return;
      }
      /* 첫 클릭(또는 멀리 떨어진 별도 클릭): 400ms 후 단일 클릭 확정 (자연스러운 더블클릭 인식 윈도우) */
      if(_bmClickTimer){clearTimeout(_bmClickTimer);_bmClickTimer=null;}
      _bmLastClickPos=_pos;
      const _e={clientX:e.clientX,clientY:e.clientY,target:e.target};
      _bmClickTimer=setTimeout(function(){
        _bmClickTimer=null; _bmLastClickPos=null;
        const actualRect=_bmActualImgRect(img);
        const xPct=(_e.clientX-actualRect.left)/actualRect.width*100;
        const yPct=(_e.clientY-actualRect.top)/actualRect.height*100;
        if(xPct<0||xPct>100||yPct<0||yPct>100)return;
        try{
          if(!img._bmCache){const _cv=document.createElement('canvas');_cv.width=img.naturalWidth;_cv.height=img.naturalHeight;const _ctx=_cv.getContext('2d');_ctx.drawImage(img,0,0);img._bmCache={ctx:_ctx,w:img.naturalWidth,h:img.naturalHeight};}
          const _cx=Math.floor(xPct/100*img._bmCache.w), _cy=Math.floor(yPct/100*img._bmCache.h);
          const _r=3;
          let _found=false;
          const _sx=Math.max(0,_cx-_r), _sy=Math.max(0,_cy-_r);
          const _sw=Math.min(img._bmCache.w-_sx,_r*2+1), _sh=Math.min(img._bmCache.h-_sy,_r*2+1);
          if(_sw>0&&_sh>0){const _id=img._bmCache.ctx.getImageData(_sx,_sy,_sw,_sh).data;for(let _i=3;_i<_id.length;_i+=4){if(_id[_i]>30){_found=true;break;}}}
          if(!_found) return;
        }catch(ex){}
        const label=_bmNearestLabel(bm.parts,xPct,yPct);
        if(!label)return;
        const oldNrs=document.getElementById('bmNrsPop');if(oldNrs)oldNrs.remove();
        _bmData[recId].push({imgKey:bmKey,x:+xPct.toFixed(2),y:+yPct.toFixed(2),nrs:0,label:label,symptom:_activeSymptom});
        try{bus.emit('bm:marker-changed',{recId:recId});}catch(_){}
        _bmRenderMarkers(recId);_bmPersist(recId);
      },400);
    });
    /* 브라우저 native dblclick 의도치 않은 발화 방지 — preventDefault 로 무력화 */
    zone.addEventListener('dblclick',function(e){
      e.preventDefault();
      e.stopPropagation();
      if(false){
      if(e.target.classList.contains('bm-marker'))return;
      const actualRect=_bmActualImgRect(img);
      const xPct=(e.clientX-actualRect.left)/actualRect.width*100;
      const yPct=(e.clientY-actualRect.top)/actualRect.height*100;
      if(xPct<0||xPct>100||yPct<0||yPct>100)return;
      try{
        if(!img._bmCache){const _cv=document.createElement('canvas');_cv.width=img.naturalWidth;_cv.height=img.naturalHeight;const _ctx=_cv.getContext('2d');_ctx.drawImage(img,0,0);img._bmCache={ctx:_ctx,w:img.naturalWidth,h:img.naturalHeight};}
        const _cx=Math.floor(xPct/100*img._bmCache.w), _cy=Math.floor(yPct/100*img._bmCache.h);
        const _r=3;
        let _found=false;
        const _sx=Math.max(0,_cx-_r), _sy=Math.max(0,_cy-_r);
        const _sw=Math.min(img._bmCache.w-_sx,_r*2+1), _sh=Math.min(img._bmCache.h-_sy,_r*2+1);
        if(_sw>0&&_sh>0){const _id=img._bmCache.ctx.getImageData(_sx,_sy,_sw,_sh).data;for(let _i=3;_i<_id.length;_i+=4){if(_id[_i]>30){_found=true;break;}}}
        if(!_found) return;
      }catch(ex){}
      const label=_bmNearestLabel(bm.parts,xPct,yPct);
      if(!label)return;
      /* 싱글클릭으로 추가된 체크 마커 제거 (같은 위치) */
      const data=_bmData[recId];
      for(let di=data.length-1;di>=0;di--){
        if(data[di].imgKey===bmKey&&Math.abs(data[di].x-xPct)<3&&Math.abs(data[di].y-yPct)<3&&data[di].nrs===0){data.splice(di,1);break;}
      }
      const oldNrs=document.getElementById('bmNrsPop');if(oldNrs)oldNrs.remove();
      const nrsDiv=document.createElement('div');nrsDiv.id='bmNrsPop';
      nrsDiv.style.cssText='position:fixed;left:'+(e.clientX+10)+'px;top:'+(e.clientY-20)+'px;background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:8px 10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:12000;display:flex;flex-direction:column;gap:4px;align-items:center';
      nrsDiv.innerHTML='<div style="font-size:10px;color:var(--t3)">통증 척도(NRS)</div>'
        +'<div style="display:flex;gap:4px" id="bmNrsButtons"></div>'
  +'<img src="assets/bodymap/scale.png" style="width:280px;margin-top:2px;border-radius:4px" onerror="this.style.display=\'none\'">';
      const btnsDiv=nrsDiv.querySelector('#bmNrsButtons');
      for(let n=1;n<=10;n++){
        (function(nrs){
          const btn=document.createElement('button');btn.textContent=nrs;
          const _nrsColors=['#22c55e','#4ade80','#a3e635','#facc15','#fbbf24','#f59e0b','#f97316','#ef4444','#dc2626','#991b1b'];
          btn.style.cssText='width:26px;height:26px;border-radius:50%;border:none;font-size:11px;font-weight:800;color:#fff;cursor:pointer;background:'+_nrsColors[Math.min(nrs-1,9)]+';transition:transform .1s';
          btn.addEventListener('mouseenter',function(){btn.style.transform='scale(1.2)';});
          btn.addEventListener('mouseleave',function(){btn.style.transform='scale(1)';});
          btn.addEventListener('click',function(ev){
            ev.stopPropagation();
            _bmData[recId].push({imgKey:bmKey,x:+xPct.toFixed(2),y:+yPct.toFixed(2),nrs:nrs,label:label,symptom:_activeSymptom});
            nrsDiv.remove();_bmRenderMarkers(recId);_bmPersist(recId);
            try{bus.emit('bm:marker-changed',{recId:recId});}catch(_){}
          });
          btnsDiv.appendChild(btn);
        })(n);
      }
      document.body.appendChild(nrsDiv);
      setTimeout(function(){document.addEventListener('click',function cl(ev){if(!nrsDiv.contains(ev.target)){nrsDiv.remove();document.removeEventListener('click',cl);}});},10);
      }/* end if(false) — dead code */
    });
  });
  _bmRenderMarkers(recId);
  /* 바깥 클릭으로 바디맵만 닫기 (증상 팝업은 유지) */
  ov.addEventListener('mousedown',function(e){
    if(e.target===ov){e.stopPropagation();_bmCloseAndRefresh();}
  });
}
function _bmCloseAndRefresh(){
  const o=document.getElementById('bmOverlay');
  if(!o)return;
  if(o._closing)return; /* 중복 방지 */
  o._closing=true;
  /* 다른 팝업과 동일한 페이드아웃 (opacity 만, scale/translate 없음) */
  const content=o.querySelector('.modal-content');
  if(content){
    content.style.transition='opacity 0.18s ease';
    content.style.opacity='0';
  }
  o.style.transition='opacity 0.18s ease';
  o.style.opacity='0';
  setTimeout(function(){
    if(o.parentNode)o.remove();
    bus.emit('render:daily');
    /* 증상 팝업이 열려있으면 — 전체 재오픈(깜빡임) 대신 바디맵 칩만 in-place 갱신 */
    const _spId=typeof S._symPopupRecId!=='undefined'?S._symPopupRecId:null;
    if(_spId!==null&&document.getElementById('symCatOverlay')){
      try{_symRefreshBmChip(_spId);}catch(e){
        /* 폴백: in-place 갱신 실패 시 기존 방식 (전체 재오픈) */
        openSymptomCategoryPopup(_spId);
      }
    }
    /* Phase 3d: 바디맵 닫힘 이벤트 발행 — 중분류 패널이 🧍 색 즉시 갱신하도록 */
    try{bus.emit('bm:closed',{recId:_spId});}catch(e){}
  },220);
}
/* 외부(증상 팝업 ESC 핸들러 등)에서 바디맵을 안전하게 닫기 위해 window 노출 */
window._bmCloseAndRefresh=_bmCloseAndRefresh;

/* 증상 팝업 헤더의 바디맵 칩만 in-place로 색상·아이콘 업데이트 (깜빡임 방지) */
function _symRefreshBmChip(recId){
  const ov=document.getElementById('symCatOverlay');
  if(!ov)return;
  const chips=ov.querySelectorAll('.sym-hdr-chip');
  let bmChip=null;
  chips.forEach(function(c){if(c.textContent.indexOf('바디맵')!==-1)bmChip=c;});
  if(!bmChip)return;
  /* 같은 학생의 모든 일지 중 바디맵 마커가 있는 record 개수 = 바디맵 이력 카운트 */
  let _cnt=0;
  try{
    const bd=window._bmData||{};
    const rec=(S.records||[]).find(function(r){return r&&r.id===recId;});
    const stuId=rec?rec.studentId:null;
    if(stuId!=null){
      (S.records||[]).forEach(function(r){if(r&&r.studentId===stuId&&bd[r.id]&&bd[r.id].length>0)_cnt++;});
    }
  }catch(_){}
  const hasBm=_cnt>0;
  bmChip.style.color=hasBm?'var(--cyan)':'#a855f7';
  bmChip.style.background=hasBm?'rgba(6,182,212,0.08)':'rgba(168,85,247,0.08)';
  bmChip.style.borderColor=hasBm?'rgba(6,182,212,0.3)':'rgba(168,85,247,0.15)';
  /* 사용자 요청 — 항상 "📚 바디맵 이력 (N)" 형태로 표시 (체크 표시 X) */
  const newText='📚 바디맵 이력'+(_cnt>0?' ('+_cnt+')':'');
  if(bmChip.firstChild&&bmChip.firstChild.nodeType===3) bmChip.firstChild.textContent=newText;
  else bmChip.textContent=newText;
}
/* _symRefreshBmChip — IIFE 내부 전용 */
/* ──────────────────────── EC 열 필드 설정 ──────────────────────── */
const EC_COLS=[
  {idx:0,key:'seq',label:'순'},
  {idx:1,key:'authorDate',label:'작성일'},
  {idx:12,key:'schoolLevel',label:'학교급'},
  {idx:2,key:'gradeClass',label:'학년반'},
  {idx:3,key:'num',label:'번호'},
  {idx:4,key:'care',label:'요보호'},
  {idx:5,key:'name',label:'이름'},
  {idx:6,key:'datetime',label:'사고발생시간'},
  {idx:7,key:'location',label:'발생장소'},
  {idx:8,key:'vitals',label:'V/S'},
  {idx:9,key:'transferred',label:'이송여부'},
  {idx:10,key:'facility',label:'이송기관명'},
  {idx:11,key:'memo',label:'주의사항(메모)'}
];
const _EC_MANDATORY=[0,5,11];
const ecColHistory=[];
function getEcColOrder(){let saved=JSON.parse(localStorage.getItem(_userKey('ecColOrder'))||'null');const def=EC_COLS.map(function(c){return c.idx;});if(!Array.isArray(saved))return def;saved=saved.map(function(v){return parseInt(v,10);}).filter(function(v){return !isNaN(v);});def.forEach(function(v){if(saved.indexOf(v)===-1)saved.push(v);});return saved.filter(function(v,i,a){return a.indexOf(v)===i;});}
function saveEcColOrder(order){localStorage.setItem(_userKey('ecColOrder'),JSON.stringify(order));}
function getEcColVisibility(){let v=JSON.parse(localStorage.getItem(_userKey('ecColVisibility'))||'null');if(!v)v={};return v;}
function saveEcColVisibility(state){localStorage.setItem(_userKey('ecColVisibility'),JSON.stringify(state));}
function pushEcColHistory(){ecColHistory.push({order:getEcColOrder().slice(),visibility:Object.assign({},getEcColVisibility())});if(ecColHistory.length>30)ecColHistory.shift();}
function undoEcColChange(){if(!ecColHistory.length)return;const prev=ecColHistory.pop();saveEcColOrder(prev.order||EC_COLS.map(function(c){return c.idx;}));saveEcColVisibility(prev.visibility||{});const ov=document.getElementById('ecColSelectorOverlay');if(ov)renderEcColSelectorCards(ov.querySelector('#ecColSelectorChips'));applyEcColLayout();}
function renderEcColSelectorCards(container){
  if(!container)return;
  container.innerHTML='';
  const order=getEcColOrder();const vis=getEcColVisibility();let dragIdx=null;
  order.forEach(function(idx){
    const col=EC_COLS.find(function(c){return c.idx===idx;});if(!col)return;
    const active=vis[idx]!==false;const isMandatory=_EC_MANDATORY.indexOf(idx)!==-1;
    const card=document.createElement('div');card.draggable=true;card.className='col-setting-card'+(active?' active':'');card.dataset.colIndex=idx;
    const _lpx=Array.from(col.label).reduce(function(s,c){return s+(c.charCodeAt(0)>127?10:6);},0);
    const flexVal='0 0 '+Math.max(68,_lpx+56)+'px';
    card.style.cssText='display:inline-flex;align-items:center;justify-content:space-between;gap:4px;height:34px;padding:0 4px;border:1px solid var(--bdr);border-radius:8px;background:var(--card);cursor:pointer;min-width:0;white-space:nowrap;user-select:none;flex:'+flexVal+';box-sizing:border-box;opacity:'+(active?'1':'0.5')+';transition:all .15s ease';
    card.addEventListener('mouseenter',function(){this.style.background='rgba(186,230,253,0.45)';this.style.borderColor='rgba(14,116,144,0.3)';this.style.opacity='1';});
    card.addEventListener('mouseleave',function(){this.style.background='var(--card)';this.style.borderColor='var(--bdr)';this.style.opacity=this.classList.contains('active')?'1':'0.5';});
    card.innerHTML='<span class="col-drag-grip" style="color:var(--t3);font-size:12px;flex:0 0 auto">☰</span><span style="font-size:9.5px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">'+col.label+'</span><button type="button" class="col-toggle-btn" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;padding:0;border:1px solid '+(active?'rgba(6,182,212,0.24)':'rgba(148,163,184,0.2)')+';border-radius:999px;background:'+(active?'rgba(6,182,212,0.10)':'rgba(148,163,184,0.10)')+';color:'+(active?'var(--cyan)':'var(--t3)')+';cursor:'+(isMandatory?'not-allowed':'pointer')+';flex:0 0 auto;opacity:'+(isMandatory?'0.4':'1')+'">'+dailyColEyeIcon(active)+'</button>';
    card.querySelector('.col-toggle-btn').addEventListener('mousedown',function(e){e.stopPropagation();});
    card.querySelector('.col-toggle-btn').addEventListener('pointerdown',function(e){e.stopPropagation();});
    card.querySelector('.col-toggle-btn').addEventListener('click',function(e){
      e.stopPropagation();if(isMandatory)return;
      pushEcColHistory();const state=getEcColVisibility();state[idx]=(state[idx]===false)?true:false;
      saveEcColVisibility(state);renderEcColSelectorCards(container);applyEcColLayout();
    });
    card.addEventListener('dragstart',function(e){if(e.target.closest('.col-toggle-btn')){e.preventDefault();return;}dragIdx=idx;card.style.opacity='0.45';if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(idx));}});
    card.addEventListener('dragend',function(){dragIdx=null;card.style.opacity='1';container.querySelectorAll('.col-setting-card').forEach(function(el){el.style.borderColor=el.classList.contains('active')?'rgba(6,182,212,0.32)':'var(--bdr)';});});
    card.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
    card.addEventListener('dragleave',function(){this.style.borderColor=this.classList.contains('active')?'rgba(6,182,212,0.32)':'var(--bdr)';});
    card.addEventListener('drop',function(e){
      e.preventDefault();if(dragIdx===null||dragIdx===idx)return;
      pushEcColHistory();const next=getEcColOrder().slice();const from=next.indexOf(dragIdx), to=next.indexOf(idx);
      if(from===-1||to===-1)return;next.splice(to,0,next.splice(from,1)[0]);
      saveEcColOrder(next);renderEcColSelectorCards(container);applyEcColLayout();
    });
    container.appendChild(card);
  });
}
export function toggleEcColSelector(){
  const existing=document.getElementById('ecColSelectorOverlay');if(existing){closeModalWithAnim(existing);return;}
  const overlay=document.createElement('div');overlay.className='modal-overlay show';overlay.id='ecColSelectorOverlay';overlay.style.background='rgba(0,0,0,0.35)';overlay.style.backdropFilter='none';overlay.style.webkitBackdropFilter='none';
  overlay.innerHTML='<div class="modal-content" style="width:98vw;max-width:1800px;padding:0;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--glass-border);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))"><span style="font-size:15px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">🔧 열 필드 설정 — 응급처치 기록</span></div><div style="padding:18px"><div style="font-size:12px;color:var(--t2);margin-bottom:6px;line-height:1.7">응급처치 기록표에 보이도록 할 필드를 선택할 수 있으며 클릭 &amp; 드래그를 통해 순서를 원하는대로 변경할 수 있습니다.</div><div style="font-size:11px;color:var(--t3);margin-bottom:12px">Ctrl + Z (Cmd + Z)로 이전으로 되돌리기 가능합니다.</div><div id="ecColSelectorChips" style="display:flex;flex-wrap:nowrap;gap:4px;overflow-x:auto;width:100%"></div></div></div>';
  document.body.appendChild(overlay);_makeDraggable(overlay.querySelector('.modal-content'));
  overlay.addEventListener('click',function(e){if(e.target===overlay)closeModalWithAnim(overlay);});
  renderEcColSelectorCards(overlay.querySelector('#ecColSelectorChips'));
}
function applyEcColLayout(){
  const order=getEcColOrder();const vis=getEcColVisibility();
  const table=document.getElementById('ecListTable');if(!table)return;
  const headRow=table.querySelector('thead tr');
  if(headRow)order.forEach(function(idx){const th=headRow.querySelector('th[data-col-index="'+idx+'"]');if(th)headRow.appendChild(th);});
  table.querySelectorAll('tbody tr').forEach(function(tr){
    const empty=tr.querySelector('td[colspan]');
    if(empty){empty.colSpan=order.filter(function(idx){return vis[idx]!==false;}).length||1;return;}
    order.forEach(function(idx){const td=tr.querySelector('td[data-col-index="'+idx+'"]');if(td)tr.appendChild(td);});
  });
  EC_COLS.forEach(function(col){
    const visible=vis[col.idx]!==false;
    const th=table.querySelector('thead th[data-col-index="'+col.idx+'"]');
    if(th)th.classList.toggle('col-hidden',!visible);
    table.querySelectorAll('tbody td[data-col-index="'+col.idx+'"]').forEach(function(td){td.classList.toggle('col-hidden',!visible);});
  });
}

/* ──────────────────────── INF 열 필드 설정 ──────────────────────── */
const INF_COLS=[
  {idx:0,key:'seq',label:'순'},
  {idx:1,key:'authorDate',label:'작성일'},
  {idx:13,key:'schoolLevel',label:'학교급'},
  {idx:2,key:'gradeClass',label:'학년반'},
  {idx:3,key:'num',label:'번호'},
  {idx:4,key:'care',label:'요보호'},
  {idx:5,key:'name',label:'이름'},
  {idx:6,key:'diagDate',label:'진단일'},
  {idx:7,key:'diseaseName',label:'감염병명'},
  {idx:8,key:'mainSym',label:'주요 증상'},
  {idx:9,key:'suspension',label:'등교중지'},
  {idx:10,key:'suspendStart',label:'등교중지개시일시'},
  {idx:11,key:'actualReturn',label:'등교재개일시'},
  {idx:12,key:'memo',label:'주의사항(메모)'}
];
const _INF_MANDATORY=[0,5,12];
const infColHistory=[];
function getInfColOrder(){let saved=JSON.parse(localStorage.getItem(_userKey('infColOrder'))||'null');const def=INF_COLS.map(function(c){return c.idx;});if(!Array.isArray(saved))return def;saved=saved.map(function(v){return parseInt(v,10);}).filter(function(v){return !isNaN(v);});def.forEach(function(v){if(saved.indexOf(v)===-1)saved.push(v);});return saved.filter(function(v,i,a){return a.indexOf(v)===i;});}
function saveInfColOrder(order){localStorage.setItem(_userKey('infColOrder'),JSON.stringify(order));}
function getInfColVisibility(){let v=JSON.parse(localStorage.getItem(_userKey('infColVisibility'))||'null');if(!v)v={};return v;}
function saveInfColVisibility(state){localStorage.setItem(_userKey('infColVisibility'),JSON.stringify(state));}
function pushInfColHistory(){infColHistory.push({order:getInfColOrder().slice(),visibility:Object.assign({},getInfColVisibility())});if(infColHistory.length>30)infColHistory.shift();}
function undoInfColChange(){if(!infColHistory.length)return;const prev=infColHistory.pop();saveInfColOrder(prev.order||INF_COLS.map(function(c){return c.idx;}));saveInfColVisibility(prev.visibility||{});const ov=document.getElementById('infColSelectorOverlay');if(ov)renderInfColSelectorCards(ov.querySelector('#infColSelectorChips'));applyInfColLayout();}
function renderInfColSelectorCards(container){
  if(!container)return;
  container.innerHTML='';
  const order=getInfColOrder();const vis=getInfColVisibility();let dragIdx=null;
  order.forEach(function(idx){
    const col=INF_COLS.find(function(c){return c.idx===idx;});if(!col)return;
    const active=vis[idx]!==false;const isMandatory=_INF_MANDATORY.indexOf(idx)!==-1;
    const card=document.createElement('div');card.draggable=true;card.className='col-setting-card'+(active?' active':'');card.dataset.colIndex=idx;
    const _lpx=Array.from(col.label).reduce(function(s,c){return s+(c.charCodeAt(0)>127?10:6);},0);
    const flexVal='0 0 '+Math.max(68,_lpx+56)+'px';
    card.style.cssText='display:inline-flex;align-items:center;justify-content:space-between;gap:4px;height:34px;padding:0 4px;border:1px solid var(--bdr);border-radius:8px;background:var(--card);cursor:pointer;min-width:0;white-space:nowrap;user-select:none;flex:'+flexVal+';box-sizing:border-box;opacity:'+(active?'1':'0.5')+';transition:all .15s ease';
    card.addEventListener('mouseenter',function(){this.style.background='rgba(186,230,253,0.45)';this.style.borderColor='rgba(14,116,144,0.3)';this.style.opacity='1';});
    card.addEventListener('mouseleave',function(){this.style.background='var(--card)';this.style.borderColor='var(--bdr)';this.style.opacity=this.classList.contains('active')?'1':'0.5';});
    card.innerHTML='<span class="col-drag-grip" style="color:var(--t3);font-size:12px;flex:0 0 auto">☰</span><span style="font-size:9.5px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">'+col.label+'</span><button type="button" class="col-toggle-btn" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;padding:0;border:1px solid '+(active?'rgba(6,182,212,0.24)':'rgba(148,163,184,0.2)')+';border-radius:999px;background:'+(active?'rgba(6,182,212,0.10)':'rgba(148,163,184,0.10)')+';color:'+(active?'var(--cyan)':'var(--t3)')+';cursor:'+(isMandatory?'not-allowed':'pointer')+';flex:0 0 auto;opacity:'+(isMandatory?'0.4':'1')+'">'+dailyColEyeIcon(active)+'</button>';
    card.querySelector('.col-toggle-btn').addEventListener('mousedown',function(e){e.stopPropagation();});
    card.querySelector('.col-toggle-btn').addEventListener('pointerdown',function(e){e.stopPropagation();});
    card.querySelector('.col-toggle-btn').addEventListener('click',function(e){
      e.stopPropagation();if(isMandatory)return;
      pushInfColHistory();const state=getInfColVisibility();state[idx]=(state[idx]===false)?true:false;
      saveInfColVisibility(state);renderInfColSelectorCards(container);applyInfColLayout();
    });
    card.addEventListener('dragstart',function(e){if(e.target.closest('.col-toggle-btn')){e.preventDefault();return;}dragIdx=idx;card.style.opacity='0.45';if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(idx));}});
    card.addEventListener('dragend',function(){dragIdx=null;card.style.opacity='1';container.querySelectorAll('.col-setting-card').forEach(function(el){el.style.borderColor=el.classList.contains('active')?'rgba(6,182,212,0.32)':'var(--bdr)';});});
    card.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
    card.addEventListener('dragleave',function(){this.style.borderColor=this.classList.contains('active')?'rgba(6,182,212,0.32)':'var(--bdr)';});
    card.addEventListener('drop',function(e){
      e.preventDefault();if(dragIdx===null||dragIdx===idx)return;
      pushInfColHistory();const next=getInfColOrder().slice();const from=next.indexOf(dragIdx), to=next.indexOf(idx);
      if(from===-1||to===-1)return;next.splice(to,0,next.splice(from,1)[0]);
      saveInfColOrder(next);renderInfColSelectorCards(container);applyInfColLayout();
    });
    container.appendChild(card);
  });
}
export function toggleInfColSelector(){
  const existing=document.getElementById('infColSelectorOverlay');if(existing){closeModalWithAnim(existing);return;}
  const overlay=document.createElement('div');overlay.className='modal-overlay show';overlay.id='infColSelectorOverlay';overlay.style.background='rgba(0,0,0,0.35)';overlay.style.backdropFilter='none';overlay.style.webkitBackdropFilter='none';
  overlay.innerHTML='<div class="modal-content" style="width:98vw;max-width:1800px;padding:0;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--glass-border);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))"><span style="font-size:15px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">🔧 열 필드 설정 — 감염병 관리</span></div><div style="padding:18px"><div style="font-size:12px;color:var(--t2);margin-bottom:6px;line-height:1.7">감염병 관리 기록표에 보이도록 할 필드를 선택할 수 있으며 클릭 &amp; 드래그를 통해 순서를 원하는대로 변경할 수 있습니다.</div><div style="font-size:11px;color:var(--t3);margin-bottom:12px">Ctrl + Z (Cmd + Z)로 이전으로 되돌리기 가능합니다.</div><div id="infColSelectorChips" style="display:flex;flex-wrap:nowrap;gap:4px;overflow-x:auto;width:100%"></div></div></div>';
  document.body.appendChild(overlay);_makeDraggable(overlay.querySelector('.modal-content'));
  overlay.addEventListener('click',function(e){if(e.target===overlay)closeModalWithAnim(overlay);});
  renderInfColSelectorCards(overlay.querySelector('#infColSelectorChips'));
}
function applyInfColLayout(){
  const order=getInfColOrder();const vis=getInfColVisibility();
  const table=document.getElementById('infListTable');if(!table)return;
  const headRow=table.querySelector('thead tr');
  if(headRow)order.forEach(function(idx){const th=headRow.querySelector('th[data-col-index="'+idx+'"]');if(th)headRow.appendChild(th);});
  table.querySelectorAll('tbody tr').forEach(function(tr){
    const empty=tr.querySelector('td[colspan]');
    if(empty){empty.colSpan=order.filter(function(idx){return vis[idx]!==false;}).length||1;return;}
    order.forEach(function(idx){const td=tr.querySelector('td[data-col-index="'+idx+'"]');if(td)tr.appendChild(td);});
  });
  INF_COLS.forEach(function(col){
    const visible=vis[col.idx]!==false;
    const th=table.querySelector('thead th[data-col-index="'+col.idx+'"]');
    if(th)th.classList.toggle('col-hidden',!visible);
    table.querySelectorAll('tbody td[data-col-index="'+col.idx+'"]').forEach(function(td){td.classList.toggle('col-hidden',!visible);});
  });
}

const DAILY_COLS=[
  {idx:0,key:'seq',label:'순'},
  {idx:19,key:'schoolLevel',label:'학교급'},
  {idx:17,key:'major',label:'학과'},
  {idx:1,key:'gradeClass',label:'학년반'},
  {idx:2,key:'num',label:'번호'},
  {idx:3,key:'care',label:'요보호'},
  {idx:15,key:'vip',label:'VIP'},
  {idx:4,key:'name',label:'이름'},
  {idx:5,key:'gender',label:'성별'},
  {idx:16,key:'bodyMap',label:'바디맵'},
  {idx:6,key:'symptoms',label:'증상'},
  {idx:8,key:'treatment',label:'처치'},
  {idx:10,key:'timeIn',label:'입실'},
  {idx:11,key:'timeOut',label:'퇴실'},
  /* V/S(idx 12) 열은 열 선택에서 제거 — V/S 는 처치 칸의 'V/S 측정' 칩 + 아래 인라인 표로 표시(2026-07-21).
     기존 사용자 저장 순서에 남은 12 는 getDailyColOrder 필터가 걸러낸다. */
  {idx:13,key:'nurse',label:'처치자'},
  {idx:14,key:'memo',label:'주의사항(메모)'}
];
const dailyColHistory=[];
/* 사용자별 localStorage 키 (userId 기반) */
function _userKey(base){
  const uid=S._currentUser&&S._currentUser.id?S._currentUser.id:'default';
  return base+'_u'+uid;
}
function getDailyColOrder(){
  let saved=JSON.parse(localStorage.getItem(_userKey('dailyColOrder'))||localStorage.getItem('dailyColOrder')||'null');
  const def=DAILY_COLS.map(function(c){return c.idx;});
  if(!Array.isArray(saved)) return def;
  saved=saved.map(function(v){return parseInt(v,10);}).filter(function(v){return !isNaN(v);});
  /* ★ 이행 안전(2026-07-21): DAILY_COLS 에서 제거된 열(예: 옛 V/S idx 12)이 저장 순서에 남아 있어도
   *   여기서 걸러낸다. 하위 소비부는 모두 if(!col)/if(th) 가드가 있어 크래시는 없지만, 고아 idx 가
   *   _lastVisIdx 등으로 새어들어가 레이아웃이 어긋나는 것을 원천 차단. */
  const _validIdx=def;
  saved=saved.filter(function(v){return _validIdx.indexOf(v)!==-1;});
  def.forEach(function(v){if(saved.indexOf(v)===-1)saved.push(v);});
  return saved.filter(function(v,i,a){return a.indexOf(v)===i;});
}
function saveDailyColOrder(order){
  localStorage.setItem(_userKey('dailyColOrder'),JSON.stringify(order));
  /* DB blob write-through — localStorage 유실(재설치 등) 시에도 부팅 매핑으로 복원 (2026-06-12) */
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','daily_col_order',order);
}
function getDailyColVisibility(){
  /* 사용자 키 → 레거시 키 → null 순으로 로드 */
  const key=_userKey('dailyColVisibility');
  const raw=localStorage.getItem(key)||localStorage.getItem('dailyColVisibility')||'null';
  let v=JSON.parse(raw);
  if(!v){v={19:false,17:false,15:false,16:false,13:false};}
  /* 신규 열이 기존 저장본에 없으면 기본 OFF */
  if(typeof v[19]==='undefined')v[19]=false;
  if(typeof v[17]==='undefined')v[17]=false;
  if(typeof v[15]==='undefined')v[15]=false;
  if(typeof v[16]==='undefined')v[16]=false;
  if(typeof v[13]==='undefined')v[13]=false;
  /* 14번 열: 컬럼(삭제 ✕)은 applyDailyColLayout 에서 항상 표시하고, v[14]===false 는
   * "메모 글리프만 숨김" 의미로 사용 (옵션2 2026-06-05). 기본(undefined)은 메모 표시. */
  /* 사용자 키로 저장본이 없고 레거시 키에만 있으면 사용자 키로 마이그레이션 */
  if(!localStorage.getItem(key)&&localStorage.getItem('dailyColVisibility')){
    localStorage.setItem(key,JSON.stringify(v));
  }
  return v;
}
function saveDailyColVisibility(state){
  localStorage.setItem(_userKey('dailyColVisibility'),JSON.stringify(state));
  /* DB blob write-through — 바디맵 ON 등 사용자가 켠 열 상태는 업데이트·재설치에도 보존 (2026-06-12) */
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','daily_col_visibility',state);
}
/* ── 열 너비 저장 형식 정리 (2026-06-11) ──────────────────────────────
 * 유효 형식: {열번호:px} 객체 (20~1200px — UI 가 허용하는 범위).
 * 옛 포맷: 렌더 측정 px 배열(위치 기반). 업데이트 전 사용자의 드래그 조정값이 이 배열 안에
 * 패치되어 있으므로 절대 폐기하지 않고, 저장된 열 순서(getDailyColOrder)로 위치→열번호를
 * 복원해 객체로 1회 이행한다. (위치 i = 측정 시점의 i번째 표시 열 = order[i])
 * 0(숨김 열)·범위 밖 값(오염으로만 생길 수 있는 값)은 제외. */
export function sanitizeColWidths(o){
  if(!o||typeof o!=='object'||Array.isArray(o))return null;
  const out={};
  Object.keys(o).forEach(function(k){
    const n=Math.round(parseFloat(o[k]));
    if(isFinite(n)&&n>=20&&n<=1200)out[k]=n;
  });
  return Object.keys(out).length?out:null;
}
export function migrateLegacyColWidths(arr){
  if(!Array.isArray(arr))return null;
  const order=getDailyColOrder();
  const out={};
  for(let i=0;i<arr.length&&i<order.length;i++){
    const n=Math.round(parseFloat(arr[i]));
    if(isFinite(n)&&n>=20&&n<=1200)out[order[i]]=n;
  }
  return Object.keys(out).length?out:null;
}
export function dailyColEyeIcon(active){
  return active
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"></path><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 3.5 20.5 20.5"></path><path d="M9.8 6.8A10.8 10.8 0 0 1 12 6.5c4 0 7.3 1.9 9.5 5a14.7 14.7 0 0 1-3.2 3.4"></path><path d="M6.2 9A14.8 14.8 0 0 0 2.5 12c2.2 3.1 5.5 5 9.5 5 1 0 1.9-.1 2.7-.4"></path></svg>';
}
function pushDailyColHistory(){
  dailyColHistory.push({order:getDailyColOrder().slice(),visibility:Object.assign({},getDailyColVisibility())});
  if(dailyColHistory.length>30) dailyColHistory.shift();
}
function undoDailyColChange(){
  if(!dailyColHistory.length) return;
  const prev=dailyColHistory.pop();
  saveDailyColOrder(prev.order||DAILY_COLS.map(function(c){return c.idx;}));
  saveDailyColVisibility(prev.visibility||{});
  const overlay=document.getElementById('colSelectorOverlay');
  if(overlay) renderColSelectorCards(overlay.querySelector('#colSelectorChips'));
  applyDailyColLayout();
}
function renderColSelectorCards(container){
  if(!container) return;
  container.innerHTML='';
  const order=getDailyColOrder();
  const vis=getDailyColVisibility();
  let dragIdx=null;
  const _slCard=S.settings.schoolLevel||'elementary';
  order.forEach(function(idx){
    const col=DAILY_COLS.find(function(c){return c.idx===idx;});
    if(!col) return;
    /* 모든 열을 선택기에 표시 */
    const active=vis[idx]!==false;
    const card=document.createElement('div');
    card.draggable=true;
    card.className='col-setting-card'+(active?' active':'');
    card.dataset.colIndex=idx;
    const _lbl=col.label;const _labelLen=_lbl.length;
    const _isShortCode=(_lbl==='VIP'||_lbl==='V/S');
    const _flexVal=(_labelLen<=1)?'0.7 0 0':_isShortCode?'0.8 0 0':(_labelLen>=5)?'1.4 1 0':(_labelLen>=3)?'1.1 1 0':'1 1 0';
    card.style.cssText='display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:clamp(62px,6.4vw,74px);padding:4px 5px 5px;border:1px solid var(--bdr);border-radius:6px;background:var(--card);cursor:pointer;min-width:0;white-space:nowrap;user-select:none;flex:'+_flexVal+';box-sizing:border-box;opacity:'+(active?'1':'0.5')+';transition:all .15s ease';
    card.addEventListener('mouseenter',function(){this.style.background='rgba(186,230,253,0.45)';this.style.borderColor='rgba(14,116,144,0.3)';this.style.opacity='1';});
    card.addEventListener('mouseleave',function(){this.style.background='var(--card)';this.style.borderColor='var(--bdr)';this.style.opacity=this.classList.contains('active')?'1':'0.5';});
    /* 카드 하단 너비(mm) 수치 — 저장값(없으면 현재 렌더 너비)을 표시, 입력 즉시 표에 라이브 반영 (사용자 요청 2026-06-10).
     * 눈 OFF(숨김) 열은 마지막 설정값을 회색 비활성으로 표시. 96dpi 기준 1px=25.4/96mm. */
    const _PXMM=25.4/96;
    const _savedPx=(typeof dailyColWidthGetPx==='function')?dailyColWidthGetPx(idx):null;
    let _wMm='';
    if(_savedPx!=null){ _wMm=String(Math.round(_savedPx*_PXMM*10)/10); }
    else if(active){
      const _thEl=document.querySelector('#recTable thead th[data-col-index="'+idx+'"]');
      if(_thEl&&_thEl.offsetWidth>0)_wMm=String(Math.round(_thEl.offsetWidth*_PXMM*10)/10);
    }
    card.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:3px;min-width:0">'
      +'<span class="col-drag-grip" style="color:var(--t3);font-size:clamp(9px,1vw,12px);flex:0 0 auto">☰</span><span style="font-size:clamp(8px,0.75vw,9.5px);font-weight:700;color:var(--t1);white-space:nowrap;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis">'+col.label+'</span><button type="button" class="col-toggle-btn" aria-label="'+(active?'필드 숨기기':'필드 표시')+'" title="'+(active?'필드 숨기기':'필드 표시')+'" style="display:inline-flex;align-items:center;justify-content:center;width:clamp(20px,2vw,26px);height:clamp(18px,1.8vw,22px);padding:0;border:1px solid '+(active?'rgba(6,182,212,0.24)':'rgba(148,163,184,0.2)')+';border-radius:999px;background:'+(active?'rgba(6,182,212,0.10)':'rgba(148,163,184,0.10)')+';color:'+(active?'var(--cyan)':'var(--t3)')+';cursor:pointer;flex:0 0 auto">'+dailyColEyeIcon(active)+'</button>'
      +'</div>'
      /* 숫자 입력칸과 mm 단위를 두 층으로 분리 — 위: 입력 네모칸, 아래: mm (사용자 요청 2026-06-10) */
      +'<div style="display:flex;flex-direction:column;gap:1px;min-width:0">'
      +'<input type="text" inputmode="decimal" class="col-w-inp"'+(active?'':' disabled')+' value="'+_wMm+'" placeholder="자동" title="열 너비(mm) — 입력 즉시 표에 반영, 비우면 자동" style="width:100%;min-width:0;font-size:clamp(12px,1.2vw,14px);font-weight:700;padding:5px 6px;border:1px solid var(--bdr);border-radius:5px;background:'+(active?'var(--bg2)':'transparent')+';color:'+(active?'var(--t1)':'var(--t3)')+';text-align:right;outline:none;font-family:var(--fm);opacity:'+(active?'1':'0.55')+';box-sizing:border-box">'
      +'<span style="font-size:9px;color:var(--t3);font-weight:700;text-align:right;line-height:1.2">mm</span>'
      +'</div>';
    card.querySelector('.col-toggle-btn').addEventListener('mousedown',function(e){e.stopPropagation();});
    card.querySelector('.col-toggle-btn').addEventListener('pointerdown',function(e){e.stopPropagation();});
    const _wInp=card.querySelector('.col-w-inp');
    if(_wInp){
      ['mousedown','pointerdown','click','dblclick'].forEach(function(evt){_wInp.addEventListener(evt,function(e){e.stopPropagation();});});
      _wInp.addEventListener('keydown',function(e){ e.stopPropagation(); if(e.key==='Enter'){e.preventDefault();_wInp.blur();} });
      _wInp.addEventListener('input',function(){
        /* 숫자·소수점만 허용 — 문자는 입력 즉시 제거 (붙여넣기 포함, 사용자 요청 2026-06-10) */
        const cleaned=_wInp.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1');
        if(cleaned!==_wInp.value)_wInp.value=cleaned;
        const t=_wInp.value.trim();
        if(t===''){ if(typeof dailyColWidthSetPx==='function')dailyColWidthSetPx(idx,null); return; } /* 비우면 자동 */
        const mm=parseFloat(t);
        if(!isNaN(mm)&&mm>0&&typeof dailyColWidthSetPx==='function')dailyColWidthSetPx(idx, mm/_PXMM);
      });
      /* 마우스 휠로 1mm 단위 증감 — 위로=증가, 아래로=감소. 즉시 저장+표 라이브 반영 (사용자 요청 2026-06-10) */
      _wInp.addEventListener('wheel',function(e){
        if(_wInp.disabled)return;
        e.preventDefault(); e.stopPropagation();
        const _minMm=Math.round(20*_PXMM*10)/10; /* px 하한 20px ≈ 5.3mm */
        let base=parseFloat(_wInp.value);
        if(isNaN(base)){
          const sp=(typeof dailyColWidthGetPx==='function')?dailyColWidthGetPx(idx):null;
          if(sp!=null)base=sp*_PXMM;
          else{ const _thEl2=document.querySelector('#recTable thead th[data-col-index="'+idx+'"]'); base=(_thEl2&&_thEl2.offsetWidth>0)?_thEl2.offsetWidth*_PXMM:10; }
        }
        const next=Math.max(_minMm, Math.round((base+(e.deltaY<0?1:-1))*10)/10);
        _wInp.value=String(next);
        if(typeof dailyColWidthSetPx==='function')dailyColWidthSetPx(idx, next/_PXMM);
      },{passive:false});
    }
    card.querySelector('.col-toggle-btn').addEventListener('click',function(e){
      e.stopPropagation();
      /* 순0·이름4·증상6·처치8 은 일지 필수 열이라 잠금. 메모14 는 옵션2(2026-06-05)로
       * 토글 허용 — 단 컬럼(삭제 ✕)은 applyDailyColLayout 에서 항상 표시하고 메모 글리프만 숨김. */
      if([0,4,6,8].indexOf(idx)!==-1)return;
      pushDailyColHistory();
      const state=getDailyColVisibility();
      const curVisible=(state[idx]!==false);
      state[idx]=!curVisible;
      saveDailyColVisibility(state);
      renderColSelectorCards(container);
      applyDailyColLayout();
    });
    card.addEventListener('dragstart',function(e){
      if(e.target.closest('.col-toggle-btn')||e.target.closest('.col-w-inp')){e.preventDefault();return;}
      dragIdx=idx;
      card.style.opacity='0.45';
      if(e.dataTransfer){
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain',String(idx));
      }
    });
    card.addEventListener('dragend',function(){dragIdx=null;card.style.opacity='1';container.querySelectorAll('.col-setting-card').forEach(function(el){el.style.borderColor=el.classList.contains('active')?'rgba(6,182,212,0.32)':'var(--bdr)';});});
    card.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
    card.addEventListener('dragleave',function(){this.style.borderColor=this.classList.contains('active')?'rgba(6,182,212,0.32)':'var(--bdr)';});
    card.addEventListener('drop',function(e){
      e.preventDefault();
      if(dragIdx===null||dragIdx===idx) return;
      pushDailyColHistory();
      const next=getDailyColOrder().slice();
      const from=next.indexOf(dragIdx), to=next.indexOf(idx);
      if(from===-1||to===-1) return;
      next.splice(to,0,next.splice(from,1)[0]);
      saveDailyColOrder(next);
      renderColSelectorCards(container);
      applyDailyColLayout();
    });
    container.appendChild(card);
  });
}
export function toggleColSelector(){
  const existing=document.getElementById('colSelectorOverlay');
  if(existing){closeModalWithAnim(existing);return;}
  const overlay=document.createElement('div');overlay.className='modal-overlay show';overlay.id='colSelectorOverlay';overlay.style.background='rgba(0,0,0,0.35)';overlay.style.backdropFilter='none';overlay.style.webkitBackdropFilter='none';
  overlay.innerHTML='<div class="modal-content" style="width:98vw;max-width:1600px;padding:0;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--glass-border);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));cursor:grab"><span style="font-size:clamp(12px,1.2vw,15px);font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">🔧 열 필드 설정</span></div><div style="padding:clamp(10px,1.5vw,18px)"><div style="font-size:clamp(10px,1vw,12px);color:var(--t2);margin-bottom:6px;line-height:1.7">보건일지 표에 보이도록 할 필드를 선택할 수 있으며 클릭 &amp; 드래그를 통해 순서를 원하는대로 변경할 수 있습니다.</div><div style="font-size:clamp(9px,0.9vw,11px);color:var(--t3);margin-bottom:8px">Ctrl + Z (Cmd + Z)로 이전으로 되돌리기 가능합니다.</div><div style="font-size:clamp(9px,0.85vw,10px);color:var(--t3);margin-bottom:12px;line-height:1.8;background:var(--bg2);padding:8px 10px;border-radius:6px;border:1px solid var(--bdr)">학과가 있는 고등학교의 경우 "학과"를 ON상태로 두면 편리합니다. 다양한 학교급이 포함된 학교 (예: 병설유치원이 있는 초등학교나 중학생까지 케어하는 초등학교, 특수학교)는 "학교급"을 ON상태로 두면 편리합니다. 오직 1~3학년만 있는 인문계 고등학교나 중학교, 1~6학년만 있는 초등학교는 "학교급", "학과"를 OFF상태로 두면 편리합니다. 보건교사가 두 명 이상 배치되지 않은 경우라면 처치자를 OFF로 두는 것을 권합니다.</div><div id="colSelectorChips" style="display:flex;flex-wrap:nowrap;gap:clamp(2px,0.3vw,4px);overflow:hidden;width:100%"></div></div></div>';
  document.body.appendChild(overlay);
  _makeDraggable(overlay.querySelector('.modal-content'));
  overlay.addEventListener('click',function(e){if(e.target===overlay)closeModalWithAnim(overlay);});
  renderColSelectorCards(overlay.querySelector('#colSelectorChips'));
}
export function applyDailyColLayout(){
  const saved=getDailyColVisibility();
  const order=getDailyColOrder();
  const table=document.getElementById('recTable');
  if(!table) return;

  /* 특수학교는 학교급 컬럼(19)을 항상 표시 — 유·초·중·고가 한 학교에 공존하므로
   *  학년반만으로는 어느 학교급의 학생인지 식별 불가. (사용자 정책 2026-05-22) */
  try {
    const _sl = (S && S.settings && S.settings.schoolLevel) || '';
    if(_sl === 'special'){
      saved[19] = true;
    }
  } catch(_){}

  /* 메모 열(14): 컬럼 자체(행 삭제 ✕ 포함)는 항상 표시하고, 메모 글리프(📌/+)만 표시 여부를
   * 분리 토글한다. (옵션2 2026-06-05 — 메모는 끌 수 있되 삭제 버튼은 항상 유지) */
  const _memoGlyphVisible = saved[14]!==false;
  saved[14]=true;

  /* ── 열 순서 재배치: 헤더+바디 모두 항상 정렬 (헤더/바디 순서 불일치 방지) ── */
  const headRow=table.querySelector('thead tr');
  if(headRow){
    order.forEach(function(idx){const th=headRow.querySelector('th[data-col-index="'+idx+'"]');if(th)headRow.appendChild(th);});
    table.querySelectorAll('tbody tr').forEach(function(tr){
      const empty=tr.querySelector('.daily-empty-cell');
      if(empty){
        empty.colSpan=order.filter(function(idx2){return saved[idx2]!==false;}).length||1;
        return;
      }
      order.forEach(function(idx){const td=tr.querySelector('td[data-col-index="'+idx+'"]');if(td)tr.appendChild(td);});
    });
  }

  /* ── 가시성 토글 — class + 인라인 display 둘 다 설정 (CSS 충돌 안전 가드) ── */
  DAILY_COLS.forEach(function(col){
    const visible=saved[col.idx]!==false;
    const th=table.querySelector('thead th[data-col-index="'+col.idx+'"]');
    if(th){
      th.classList.toggle('col-hidden',!visible);
      th.style.display=visible?'':'none';
    }
    table.querySelectorAll('tbody td[data-col-index="'+col.idx+'"]').forEach(function(td){
      td.classList.toggle('col-hidden',!visible);
      td.style.display=visible?'':'none';
    });
  });

  /* 메모 글리프 표시 토글 — 열은 위에서 항상 visible 강제, 메모(📌/+)만 CSS 로 숨김 (옵션2) */
  const _memoTh=table.querySelector('thead th[data-col-index="14"]');
  if(_memoTh)_memoTh.classList.toggle('memo-glyph-hidden',!_memoGlyphVisible);
  table.querySelectorAll('tbody td[data-col-index="14"]').forEach(function(td){
    td.classList.toggle('memo-glyph-hidden',!_memoGlyphVisible);
  });

  /* ── 사용자 저장 열 너비만 적용 (나머지는 HTML 원본 유지) ── */
  const _pxW={0:24,19:36,17:36,1:58,2:28,3:34,15:28,4:52,5:28,16:34,10:38,11:38,12:36,13:50,14:72};
  const _cwKey=_userKey('ec_col_widths');
  /* 사용자 열 너비 로드 — 사용자 키 우선. 옛 측정 배열은 객체로 1회 이행(조정값 보존),
   * 글로벌 fallback 의 배열은 부팅 복사본(사용자 키가 원본)이라 이행 없이 제거 (2026-06-11) */
  let _userColW=null;
  try{ _userColW=JSON.parse(localStorage.getItem(_cwKey)); }catch(e){}
  if(Array.isArray(_userColW)){
    const _mig=migrateLegacyColWidths(_userColW);
    if(_mig){
      try{localStorage.setItem(_cwKey,JSON.stringify(_mig));}catch(_){}
      try{ if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','col_widths',_mig); }catch(_){}
    } else { try{localStorage.removeItem(_cwKey);}catch(_){} }
    _userColW=_mig;
  } else { _userColW=sanitizeColWidths(_userColW); }
  if(!_userColW){
    let _fb=null;
    try{ _fb=JSON.parse(localStorage.getItem('ec_col_widths')); }catch(e2){}
    if(Array.isArray(_fb)){ try{localStorage.removeItem('ec_col_widths');}catch(_){} _fb=null; }
    _userColW=sanitizeColWidths(_fb);
  }
  /* 메모 글리프 숨김 시: 14번 열에는 삭제 ✕(우측 16px·폭 14px)만 들어가므로 너비를 최소(36px)로
   * 줄여 오른쪽에 빈 메모 공간이 남아 가로 스크롤이 늘어나는 현상 방지 (옵션2 2026-06-05).
   * 사용자가 직접 늘려둔 너비(_userColW[14])도 이때는 무시. */
  if(!_memoGlyphVisible){_pxW[14]=36;if(_userColW&&_userColW[14])delete _userColW[14];}
  let hiddenPx=0;
  const allThs=headRow?Array.from(headRow.querySelectorAll('th')):[];
  /* % 기반 열 기본 너비 — 보이는 열 수에 따라 축소 */
  let _visCount=0;
  DAILY_COLS.forEach(function(c){if(saved[c.idx]!==false)_visCount++;});
  /* 학교급(19)/학과(17) ON 시 증상/처치 비율 축소 + 고정 열 축소 */
  const _extraCols=(saved[19]!==false?1:0)+(saved[17]!==false?1:0);
  const _symPct=Math.max(7,13-_extraCols*2-(_visCount>=17?2:0));
  const _treatPct=Math.max(10,19-_extraCols*2-(_visCount>=17?3:0));
  const _pctW={6:_symPct+'%',8:_treatPct+'%'};
  /* 보이는 열이 많으면 고정 열 너비 축소 */
  const _shrink=(_visCount>=17)?0.78:(_visCount>14)?0.82:(_visCount>13)?0.85:(_visCount>11)?0.92:1;
  /* 맨 오른쪽 보이는 열 찾기 — 항상 오른쪽 테두리에 밀착 */
  let _lastVisIdx=-1;
  order.forEach(function(ci){if(saved[ci]!==false)_lastVisIdx=ci;});
  /* VIP(15)·바디맵(16) 기본 폭 10mm(38px) — 다른 열과 동일하게 자유 조정 가능 (사용자 요청 2026-06-11).
   *  ※ 옛 자동폭(width:1%) 방식은 table-layout:fixed 에서 shrink-to-fit 이 아니라
   *    말 그대로 1% 폭이 되어 열이 짜부되던 버그 — 제거(2026-06-11). */
  _pxW[15]=Math.round(10*96/25.4);_pxW[16]=Math.round(10*96/25.4);
  allThs.forEach(function(th){
    const idx=parseInt(th.getAttribute('data-col-index'));
    const visible=saved[idx]!==false;
    if(!visible){
      th.style.width='0';th.style.minWidth='0';th.style.padding='0';
      if(_pxW[idx])hiddenPx+=_pxW[idx];
    } else if(idx===_lastVisIdx){
      /* 맨 오른쪽 보이는 열: 남은 공간 자동 채움 → 오른쪽 테두리 밀착 */
      th.style.padding='';th.style.maxWidth='';
      th.style.width='auto';
      th.style.minWidth=(_pxW[idx]||50)+'px';
    } else {
      th.style.minWidth='';th.style.padding='';th.style.maxWidth='';
      if(_userColW&&_userColW[idx]){th.style.width=_userColW[idx]+'px';}
      else if(_pctW[idx]){th.style.width=_pctW[idx];}
      else if(_pxW[idx]){
        th.style.width=Math.round(_pxW[idx]*_shrink)+'px';
      }
    }
  });
  if(hiddenPx>0){
    allThs.forEach(function(th){
      const idx=parseInt(th.getAttribute('data-col-index'));
      if(idx===6&&!(_userColW&&_userColW[idx]))th.style.width='calc('+_symPct+'% + '+Math.round(hiddenPx*0.4)+'px)';
      if(idx===8&&!(_userColW&&_userColW[idx]))th.style.width='calc('+_treatPct+'% + '+Math.round(hiddenPx*0.6)+'px)';
    });
  }
  /* 보이는 열 총 너비 기반 min-width 동적 설정 — 필요한 만큼만.
   * 보이는 열이 전부 화면에 들어가면 가로 스크롤이 생기지 않아야 하므로(사용자 요청 2026-06-10)
   * 옛 1100px 고정 하한을 제거하고 실제 보이는 열들의 필요 폭 합으로만 계산.
   * 넘칠 때만 이 min-width 가 가로 스크롤을 만든다. 사용자 지정 너비(_userColW)는 %열(6·8)보다 우선 합산. */
  const _pctCols={6:13,8:19};
  let _totalFixedPx=0;let _totalPct=0;
  allThs.forEach(function(th){
    const idx=parseInt(th.getAttribute('data-col-index'));
    if(saved[idx]===false)return;
    if(_userColW&&_userColW[idx]){_totalFixedPx+=_userColW[idx];}
    else if(_pctCols[idx]){_totalPct+=_pctCols[idx];}
    else{_totalFixedPx+=(_pxW[idx]||50);}
  });
  const _minW=_totalPct>0?Math.ceil(_totalFixedPx/(1-_totalPct/100)):_totalFixedPx;
  table.style.minWidth=_minW+'px';
  /* 드래그가 남긴 고정 width 잔재 제거 — 표가 항상 컨테이너를 가득 채워 마지막 열이 오른쪽 테두리에 밀착.
   * (열 너비를 수치로 줄이거나 창이 넓어진 뒤 표 오른쪽에 잔여 여백이 남던 문제 — 사용자 보고 2026-06-10)
   * 표 확장(가로 스크롤)은 위의 동적 min-width 가 담당하므로 width 는 100% 로 둔다. */
  table.style.width='100%';
  /* 레이아웃 완료 후 테이블 표시 — 로그인 전이면 숨김 유지 (기본값→사용자값 깜빡임 방지) */
  if(S._currentUser&&S._currentUser.id){
    table.style.visibility='visible';
  }
  /* 열 ON/OFF 후 리사이즈 핸들 재생성 */
  setTimeout(crInsertHandles,50);
}
function restoreDailyColVisibility(){
  applyDailyColLayout();
}
let globalSaveToastTimer=null;
function _isSurveyTabActive(){return false;/* [BACKUP] 건강설문 제거됨 — 추후 재삽입 시 복원 */}
export function showGlobalSaveToast(){
  if(_isSurveyTabActive())return;
  const t=document.getElementById('globalSaveToast');
  if(!t)return;
  t.classList.remove('saving');
  t.textContent='모든 내용이 저장되었습니다.';
  t.classList.add('show');
  clearTimeout(globalSaveToastTimer);
  globalSaveToastTimer=setTimeout(function(){t.classList.remove('show');},3000);
}
let globalInputDebounce=null;
export function queueGlobalSaveToast(){
  if(_isSurveyTabActive())return;
  const t=document.getElementById('globalSaveToast');
  if(t&&!t.classList.contains('show')){
    t.classList.add('saving');
    t.textContent='저장 중...';
    t.classList.add('show');
  } else if(t){
    t.classList.add('saving');
    t.textContent='저장 중...';
  }
  clearTimeout(globalInputDebounce);
  globalInputDebounce=setTimeout(showGlobalSaveToast,1000);
}

function init(){
  loadTabOrder();
  let firstVisible=null;
  document.querySelectorAll('.header-row2 .nav-link[data-view]').forEach(function(btn){
    if(!firstVisible&&btn.style.display!=='none') firstVisible=btn;
  });
  switchView((firstVisible?firstVisible.dataset.view:'daily'),(firstVisible||document.querySelector('.nav-link[data-view="daily"]')));
  initMagic();
  renderHeader();
  restoreDailyColVisibility();
  applyEcColLayout();
  applyInfColLayout();
}
// Close modals on outside click — settingsModal click handled via delegation (element may not exist at load time)
document.addEventListener('click',function(e){if(e.target&&e.target.id==='settingsModal')closeSettings();});
document.addEventListener('click',function(e){
  // addPersonModal is now a modal-overlay; closes via ESC or backdrop click
  if(!e.target.closest('.autocomplete-wrap')){document.getElementById('dailyACList').classList.remove('show');const ecl=document.getElementById('ecACList');if(ecl)ecl.classList.remove('show');const infl=document.getElementById('infACList');if(infl)infl.classList.remove('show');}
  if(!e.target.closest('.vpe-dropdown-wrap'))document.querySelectorAll('.vpe-action-dropdown.show').forEach(function(d){d.classList.remove('show');});
});
document.addEventListener('paste',function(e){
  const settingsOpen=document.getElementById('settingsModal')&&document.getElementById('settingsModal').classList.contains('show');
  if(!settingsOpen) return;
  const peopleActive=document.querySelector('.settings-sidebar-item.active[data-cat="people"]');
  if(!peopleActive) return;
  const f=extractFirstFileFromTransfer(e.clipboardData);
  if(!f) return;
  const stuWrap=document.getElementById('peopleStudent');
  const isStudentTab=stuWrap&&stuWrap.style.display!=='none';
  e.preventDefault();
  if(isStudentTab) handleStudentFile(f);
  else handleStaffFile(f);
});
document.addEventListener('keydown',function(e){
  /* Cmd+Z (macOS) / Ctrl+Z (Windows·Linux) 통합 감지 — metaKey=Mac, ctrlKey=Win/Linux */
  if(!(e.ctrlKey||e.metaKey)||String(e.key).toLowerCase()!=='z') return;
  /* 텍스트 입력 필드에선 브라우저 기본 undo 허용 */
  if(e.target&&((e.target.tagName||'').match(/INPUT|TEXTAREA|SELECT/)||e.target.isContentEditable)) return;
  /* 열 필드 설정 팝업 — 순서/가시성 undo */
  if(document.getElementById('colSelectorOverlay')){e.preventDefault();undoDailyColChange();return;}
  if(document.getElementById('ecColSelectorOverlay')){e.preventDefault();undoEcColChange();return;}
  if(document.getElementById('infColSelectorOverlay')){e.preventDefault();undoInfColChange();return;}
  /* 일반 일지 화면 — 열 너비 드래그 undo */
  const dailyTab=document.getElementById('view-daily');
  const dailyVisible=dailyTab&&dailyTab.offsetParent!==null;
  if(dailyVisible&&typeof colWidthUndo==='function'){
    if(colWidthUndo()){e.preventDefault();return;}
  }
});
document.addEventListener('input',function(e){
  const t=e.target;
  if(!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)))return;
  if(t.closest('#vpOverlay')||t.closest('#ecFormOverlay')||t.closest('#infFormOverlay'))return;
  if(!(t.closest('#view-daily')||t.closest('#view-magic')||t.closest('#view-story')||t.closest('#settingsModal')))return;
  /* 일부 입력은 사용자 액션(버튼 클릭) 시점에만 저장 토스트를 띄워야 함 → 제외.
     - data-no-auto-save 속성 가진 요소 일괄 제외 (약품 검색·추가 input 등).
     - (구) #setMedAddInput ID 체크는 2026-05-27 2단 재구성으로 제거 — 새 input 들은 data-no-auto-save 보유. */
  if(t.closest('[data-no-auto-save]')) return;
  if(t.hasAttribute && t.hasAttribute('data-no-auto-save')) return;
  queueGlobalSaveToast();
},true);

/* init()은 모든 스크립트 로드 후 실행 (switchView 등 의존성 보장) */
window.addEventListener('DOMContentLoaded',function(){
  try{init();}catch(e){console.error('init error:',e);}
  try{renderHeader();}catch(e){}
});
/* CD Key 만료 체크 */
/* [REMOVED] try{checkCdkeyExpiry();}catch(e){} — 시디키는 설치 단계에서 처리 */
window.onerror=function(msg,url,line){console.error('Global error at line '+line+': '+msg);};
/* 모든 뷰의 오른쪽 패널 max-height를 footer 흰선 기준 18px 마진으로 맞춤 */
export function adjustPanelHeights(){
  const footer=document.querySelector('footer');
  if(!footer)return;
  const footerTop=footer.getBoundingClientRect().top;
  document.querySelectorAll('.magic-chart-body').forEach(function(el){
    const top=el.getBoundingClientRect().top;
    if(top>0)el.style.maxHeight=(footerTop-top-5)+'px';
  });
  const dtw=document.getElementById('dailyTableWrap');
  if(dtw){
    const dtTop=dtw.getBoundingClientRect().top;
    if(dtTop>0)dtw.style.maxHeight=(footerTop-dtTop-18)+'px';
  }
  ['ecListCard','infListCard'].forEach(function(id){
    const el=document.getElementById(id);
    if(el){
      const top=el.getBoundingClientRect().top;
      if(top>0){el.style.maxHeight=(footerTop-top-2)+'px';el.style.overflowY='auto';}
    }
  });
}
/* 헤더 정보 반드시 표시 보장 */
window.addEventListener('load',function(){
  renderHeader();
  setTimeout(adjustPanelHeights,300);
  window.addEventListener('resize',function(){setTimeout(adjustPanelHeights,100);});
});
setInterval(function(){const el=document.getElementById('headerUserInfo');if(el&&!el.textContent.trim())renderHeader();},2000);

document.addEventListener('DOMContentLoaded',function(){
  if(!document.getElementById('headerTooltipPopup')){
    const _tip=document.createElement('div');
    _tip.id='headerTooltipPopup';
    document.body.appendChild(_tip);
  }
});

/* macOS 스타일 — 600ms 호버 지연 후 등장. 빠르게 지나가는 마우스에는 안 뜸 */
let _hdrTipTimer=null, _hdrTipLastShow=0;
export function showHeaderTooltip(e,text,useHtml,instant){
  const tip=document.getElementById('headerTooltipPopup');
  if(!tip)return;
  /* 다른 툴팁이 방금 닫힌 상태(800ms 이내)면 즉시 표시 — 인접 버튼 호버 시 자연스러움 (macOS 멘토십 행동).
   * instant=true 면 600ms 지연 없이 곧바로 표시 (특정 칩 아이콘의 명시적 요청 시). */
  const fastShow = instant || (Date.now() - _hdrTipLastShow) < 800;
  if(_hdrTipTimer){clearTimeout(_hdrTipTimer);_hdrTipTimer=null;}
  /* 앵커 요소 결정 — 이벤트 위임 환경에서 e.currentTarget 은 delegated handler 의 parent
     (대시보드 패널 등) 을 가리키므로, 실제 호버된 요소(data-tooltip-key, data-tip 보유)를
     우선 앵커로 사용해서 툴팁을 그 위치에 표시한다.
     이전 버그: 시간대별 히트맵·학년별 처치 분포에서 tooltip 이 글래스모피즘 헤더 중앙에 뜨던 현상. */
  const hoverEl = (e.target && e.target.closest)
    ? (e.target.closest('[data-tooltip-key]') || e.target.closest('[data-tip]') || e.target.closest('[data-tooltip]') || e.target.closest('[data-_ntip]'))
    : null;
  const ct = hoverEl || e.currentTarget;
  function _doShow(){
    const hasNewline=text.indexOf('\n')>=0;
    if(hasNewline||useHtml){tip.style.whiteSpace=useHtml?'normal':'pre-line';tip.style.width='auto';tip.style.maxWidth='450px';}
    else{tip.style.whiteSpace='nowrap';tip.style.width='auto';tip.style.maxWidth='none';}
    if(useHtml)tip.innerHTML=text;
    else tip.textContent=text;
    tip.style.display='block';
    tip.style.opacity='0';
    tip.style.transform='translateY(-2px)';
    tip.style.transition='opacity .12s ease, transform .12s ease';
    /* 위치 계산 — 캡처한 ct 기준 */
    if(!ct){_doPositionFallback();return;}
    /* CSS zoom 적용 시 getBoundingClientRect 는 시각 픽셀(scaled) 을 반환하나
     * style.left/top 은 레이아웃 단위로 해석 → zoom factor 로 나눠 보정 (110%, 120%, 125% 등에서 툴팁이 중앙으로 빠지는 버그) */
    let _zf=1;
    try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
    const r=ct.getBoundingClientRect();
    const _rL=r.left/_zf, _rT=r.top/_zf, _rB=r.bottom/_zf, _rW=r.width/_zf;
    const tw=tip.offsetWidth||280, th=tip.offsetHeight||80;
    const vw=window.innerWidth/_zf, vh=window.innerHeight/_zf;
    let maxRight=vw-8;
    const dashCanvas=document.getElementById('dashCanvas');
    if(dashCanvas&&dashCanvas.contains(ct)){
      const dcR=dashCanvas.getBoundingClientRect();
      maxRight=Math.min(maxRight,dcR.right/_zf-8);
    }
    /* 증상 선택 및 처치 팝업 박스 내부 칩에 호버 → 툴팁이 팝업 우측 테두리를 넘지 않도록 제한 */
    const symBox=document.getElementById('symCatBox');
    if(symBox&&symBox.contains(ct)){
      const sR=symBox.getBoundingClientRect();
      maxRight=Math.min(maxRight,sR.right/_zf-8);
    }
    let left=_rL+_rW/2-tw/2;
    if(left<8)left=8;
    if(left+tw>maxRight)left=Math.max(8,maxRight-tw);
    let top=_rB+8;
    if(top+th>vh-8)top=_rT-th-8;
    if(top<8)top=8;
    tip.style.left=left+'px';
    tip.style.top=top+'px';
    requestAnimationFrame(function(){tip.style.opacity='1';tip.style.transform='translateY(0)';});
    _hdrTipLastShow=Date.now();
  }
  function _doPositionFallback(){tip.style.left='50%';tip.style.top='50%';tip.style.opacity='1';}
  if(fastShow){_doShow();return;}
  _hdrTipTimer=setTimeout(_doShow, 600);
}
export function showHeaderTooltipRight(e,text){
  const tip=document.getElementById('headerTooltipPopup');if(!tip)return;
  tip.style.whiteSpace='normal';tip.style.width='240px';
  tip.textContent=text;tip.style.display='block';
  /* CSS zoom 보정 — getBoundingClientRect (scaled) ↔ style.left/top (layout) 단위 차이 */
  let _zf=1;
  try{ if(window.ecZoom && window.ecZoom.enabled && window.ecZoom.enabled()) _zf=window.ecZoom.get()||1; }catch(_){}
  const r=e.currentTarget.getBoundingClientRect();
  const _rL=r.left/_zf, _rR=r.right/_zf, _rT=r.top/_zf;
  const tw=tip.offsetWidth||240, th=tip.offsetHeight||60;
  const vw=window.innerWidth/_zf, vh=window.innerHeight/_zf;
  let left=_rR+8;
  if(left+tw>vw-8)left=_rL-tw-8;
  let top=_rT;
  if(top+th>vh-8)top=vh-th-8;
  if(top<8)top=8;
  tip.style.left=left+'px';tip.style.top=top+'px';
}
export function hideHeaderTooltip(){
  /* 보류 중인 지연 표시 취소 (마우스가 빠르게 지나간 경우) */
  if(_hdrTipTimer){clearTimeout(_hdrTipTimer);_hdrTipTimer=null;}
  const tip=document.getElementById('headerTooltipPopup');
  if(tip){
    /* 부드럽게 페이드아웃 후 숨김 */
    tip.style.opacity='0';
    tip.style.transform='translateY(-2px)';
    setTimeout(function(){
      if(tip.style.opacity==='0')tip.style.display='none';
    },140);
  }
}
/* 전역 안전장치 — 어디서든 mousedown 시 미니팝업(헤더 툴팁) 강제 닫기.
 * data-tooltip 요소가 클릭으로 재렌더되어 사라질 때 mouseleave 가 안 떠 툴팁이 남는 문제를 앱 전역에서 한 번에 방지. (2026-06-04) */
document.addEventListener('mousedown',function(){ hideHeaderTooltip(); }, true);
/* 이름 호버 팝업 위치 조정 — 어떤 팝업이든 열려있으면 완전 차단 */
document.addEventListener('mouseover',function(e){
  /* 클릭 팝업이 하나라도 열려있으면 호버 팝업 차단 */
  if(_ecInfMiniPop||_ecInfHoverPop)return;
  if(document.getElementById('emsMiniPopup'))return;
  if(document.getElementById('nameHoverFloat'))return;
  const wrap=e.target.closest('.name-hover-wrap');
  if(!wrap)return;
  const pop=wrap.querySelector('.name-hover-pop');
  if(!pop)return;
  const rect=wrap.getBoundingClientRect();
  pop.style.left=rect.left+'px';
  pop.style.top=(rect.bottom+6)+'px';
  if(rect.bottom+180>window.innerHeight)pop.style.top=(rect.top-pop.offsetHeight-6)+'px';
});

/* ═══ 커스텀 둥근 스크롤바 — DISABLED (네이티브 ::-webkit-scrollbar 가 이미 있어 중복) ═══ */
function initDailyCustomScrollbar(){
  /* 기존에 주입된 커스텀 scrollbar 요소가 남아 있으면 제거 */
  const outer=document.getElementById('dailyTableOuter');
  if(outer){
    outer.querySelectorAll('.daily-scrollbar-track,.daily-scrollbar-thumb').forEach(el => el.remove());
  }
  return;
  /* eslint-disable-next-line no-unreachable */
  // below is dead code, kept for reference only
  const wrap=document.getElementById('dailyTableWrap');
  if(!wrap||outer.querySelector('.daily-scrollbar-track'))return;
  outer.style.position='relative';
  const track=document.createElement('div');track.className='daily-scrollbar-track';
  const thumb=document.createElement('div');thumb.className='daily-scrollbar-thumb';
  outer.appendChild(track);outer.appendChild(thumb);
  function updateThumb(){
    const sh=wrap.scrollHeight, ch=wrap.clientHeight, st=wrap.scrollTop;
    if(sh<=ch){track.style.display='none';thumb.style.display='none';return;}
    track.style.display='block';thumb.style.display='block';
    const trackH=ch-16;
    const thumbH=Math.max(30,trackH*(ch/sh));
    const scrollRatio=st/(sh-ch);
    /* outer 기준 좌표: wrap의 offsetTop + 스크롤 위치 */
    const wrapTop=wrap.offsetTop||0;
    const thumbTop=wrapTop+8+scrollRatio*(trackH-thumbH);
    const trackTop=wrapTop+8;
    track.style.top=trackTop+'px';track.style.height=trackH+'px';
    thumb.style.height=thumbH+'px';thumb.style.top=thumbTop+'px';
  }
  let _scrollHideTimer=null;
  function showThumbTemporarily(){
    thumb.style.opacity='1';
    clearTimeout(_scrollHideTimer);
    _scrollHideTimer=setTimeout(function(){thumb.style.opacity='0';},1200);
  }
  wrap.addEventListener('scroll',function(){updateThumb();showThumbTemporarily();});
  wrap.addEventListener('mousemove',function(){updateThumb();showThumbTemporarily();});
  wrap.addEventListener('mouseleave',function(){thumb.style.opacity='0';clearTimeout(_scrollHideTimer);});
  new MutationObserver(updateThumb).observe(wrap,{childList:true,subtree:true});
  setTimeout(updateThumb,200);
  /* 드래그 지원 */
  let dragging=false, startY=0, startScroll=0;
  thumb.addEventListener('mousedown',function(e){
    e.preventDefault();dragging=true;startY=e.clientY;startScroll=wrap.scrollTop;
    thumb.style.background='#60a5fa';thumb.style.opacity='1';clearTimeout(_scrollHideTimer);
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    const sh=wrap.scrollHeight, ch=wrap.clientHeight;
    const trackH=ch-16;const thumbH=Math.max(30,trackH*(ch/sh));
    const dy=e.clientY-startY;
    const scrollDelta=dy*(sh-ch)/(trackH-thumbH);
    wrap.scrollTop=startScroll+scrollDelta;
  });
  document.addEventListener('mouseup',function(){if(dragging){dragging=false;thumb.style.background='#93c5fd';showThumbTemporarily();}});
  /* 트랙 클릭 */
  track.style.pointerEvents='auto';
  track.addEventListener('click',function(e){
    const rect=track.getBoundingClientRect();
    const clickRatio=(e.clientY-rect.top)/rect.height;
    wrap.scrollTop=clickRatio*(wrap.scrollHeight-wrap.clientHeight);
  });
}
setTimeout(initDailyCustomScrollbar,500);

// --- Expose to global scope ---

/* _bmImages, _bmGetImages, _bmActualImgRect, _bmNearestLabel — IIFE 내부 전용, 전역 노출 불필요 */
 /* daily-view.js, symptom-view.js에서 참조 — 유지 필수 */

/* [REMOVED] window.infSaveNotes — dead code 함수 제거됨 */

/* ── EC/INF 가로 스크롤바 (일반 일지와 동일 방식) ── */
function _initEcInfHScroll(cardId){
  const wrap=document.getElementById(cardId);if(!wrap||wrap._hscrollInit)return;
  wrap._hscrollInit=true;
  const thumb=document.createElement('div');thumb.className='daily-hscrollbar-thumb';
  wrap.appendChild(thumb);
  let hideT=null;
  function showHS(){if(wrap.scrollWidth<=wrap.clientWidth+2){thumb.style.opacity='0';return;}thumb.style.opacity='0.7';clearTimeout(hideT);hideT=setTimeout(function(){thumb.style.opacity='0';},1200);}
  function updateT(){if(wrap.scrollWidth<=wrap.clientWidth){thumb.style.opacity='0';return;}const r=wrap.clientWidth/wrap.scrollWidth;const tw=Math.max(40,wrap.clientWidth*r);const ms=wrap.scrollWidth-wrap.clientWidth;const sr=ms>0?wrap.scrollLeft/ms:0;const trW=wrap.clientWidth-8;thumb.style.width=tw+'px';thumb.style.left=(4+sr*(trW-tw))+'px';}
  wrap.addEventListener('scroll',function(){updateT();showHS();});
  wrap.addEventListener('mouseenter',function(){updateT();if(wrap.scrollWidth>wrap.clientWidth)showHS();});
  wrap.addEventListener('mousemove',function(){if(wrap.scrollWidth>wrap.clientWidth)showHS();});
  wrap.addEventListener('mouseleave',function(){clearTimeout(hideT);hideT=setTimeout(function(){thumb.style.opacity='0';},400);});
  let dragging=false, dragSX=0, dragSS=0;
  thumb.style.pointerEvents='auto';
  thumb.addEventListener('mousedown',function(e){dragging=true;dragSX=e.clientX;dragSS=wrap.scrollLeft;e.preventDefault();});
  document.addEventListener('mousemove',function(e){if(!dragging)return;const tw=parseFloat(thumb.style.width)||40;const dx=e.clientX-dragSX;const sr=wrap.scrollWidth-wrap.clientWidth;const mr=dx/(wrap.clientWidth-8-tw);wrap.scrollLeft=dragSS+mr*sr;});
  document.addEventListener('mouseup',function(){dragging=false;});
  window.addEventListener('resize',function(){updateT();});
  setTimeout(updateT,300);
}

/* ── EC/INF 이름 셀 HTML 생성 (호버 팝업 + 클릭 팝업) ── */
function _ecInfNameHtml(s,recId,clickFn){
  if(!s)return '';
  return '<span class="name-hover-wrap" data-stu-id="'+s.id+'" data-click-fn="'+clickFn+'" data-rec-id="'+recId+'" style="cursor:pointer">'
    +'<span class="name-hover-anchor"><strong>'+escHtml(s.name||'')+'</strong></span>'
    +'</span>';
}
function _bindEcInfNameCells(container){
  container.querySelectorAll('.name-hover-wrap[data-click-fn]').forEach(function(wrap){
    const stuId=wrap.dataset.stuId;
    const fnName=wrap.dataset.clickFn;
    const recId=Number(wrap.dataset.recId);
    const clickFn=fnName==='_ecShowNamePop'?_ecShowNamePop:fnName==='_infShowNamePop'?_infShowNamePop:null;
    wrap.addEventListener('mouseenter',function(){showNameHoverPop(wrap,stuId);});
    wrap.addEventListener('mouseleave',function(){hideNameHoverPop();});
    const anchor=wrap.querySelector('.name-hover-anchor');
    if(anchor)anchor.addEventListener('click',function(e){
      e.stopPropagation();
      const tr=anchor.closest('tr');
      if(tr){const tb=tr.parentElement;if(tb)tb.querySelectorAll('tr.daily-selected').forEach(function(r){r.classList.remove('daily-selected');});tr.classList.add('daily-selected');}
      S._visitHistoryLocked=false;
      if(typeof showVisitHistory==='function')showVisitHistory(stuId);
      S._visitHistoryLocked=true;
      hideNameHoverPop();
      if(clickFn)clickFn(wrap,stuId,recId);
    });
  });
}

/* ── EC/INF 이름 클릭 미니팝업 (showEmsPopup 방식: 오른쪽 버튼 + 왼쪽 생년월일) ── */
let _ecInfMiniPop=null;
let _ecInfHoverPop=null;
function _closeEcInfPop(){
  if(_ecInfMiniPop){_ecInfMiniPop.remove();_ecInfMiniPop=null;}
  if(_ecInfHoverPop){_ecInfHoverPop.remove();_ecInfHoverPop=null;}
  document.removeEventListener('click',_ecInfPopOutClick,true);
}
function _ecInfPopOutClick(e){
  if(_ecInfMiniPop&&!_ecInfMiniPop.contains(e.target)&&(!_ecInfHoverPop||!_ecInfHoverPop.contains(e.target))){_closeEcInfPop();}
}
function _buildEcInfMiniPop(anchor,stuId,recId,btnLabel,openFn){
  _closeEcInfPop();
  try{ playQuickMenuSound(); }catch(_){}   /* EC/INF 이름 클릭 팝업 효과음 (사용자 요청 2026-06-18) */
  /* 모든 잔상 팝업 강제 제거 */
  if(typeof hideNameHoverPop==='function')hideNameHoverPop();
  if(typeof closeEmsPopup==='function')closeEmsPopup();
  document.querySelectorAll('body > .name-hover-pop, #nameHoverFloat').forEach(function(el){el.remove();});
  const s=getStu(stuId);if(!s)return;
  const isStaff=s.type==='staff';
  const nameInfo=isStaff?((s.position||'교직원')+' '+escHtml(s.name)):(gradeClsLabel(s.grade,s.cls)+(isKinder()?'':' '+s.num+'번')+' '+escHtml(s.name));
  const nameRect=anchor.getBoundingClientRect();
  const tableWrap=anchor.closest('[id$="ListCard"]');
  const tBot=tableWrap?tableWrap.getBoundingClientRect().bottom:window.innerHeight;
  const tTop=tableWrap?tableWrap.getBoundingClientRect().top:0;
  /* ── 버튼 팝업 (오른쪽) ── */
  const pop=document.createElement('div');
  pop.className='ems-mini-popup';
  pop.innerHTML='<div style="padding:8px 14px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--bdr);background:linear-gradient(145deg,var(--bg2),color-mix(in srgb,var(--bg2) 85%,#6b7280 15%));border-radius:8px 8px 0 0">'+(isStaff?'👔':'👤')+' '+nameInfo+'</div>'
    +'<div class="ems-msg-link" data-action="openRecForm">📋 '+escHtml(btnLabel)+'</div>';
  const fnRef=openFn==='openEcForm'?openEcForm:openFn==='openInfForm'?openInfForm:null;
  pop.querySelector('[data-action="openRecForm"]').addEventListener('click',function(e){e.stopPropagation();_closeEcInfPop();if(fnRef)fnRef(recId);});
  let bLeft=nameRect.right+12;
  if(bLeft+260>window.innerWidth)bLeft=Math.max(4,nameRect.right-260);
  pop.style.left=bLeft+'px';pop.style.top='0';pop.style.visibility='hidden';
  document.body.appendChild(pop);
  let bTop=nameRect.top;
  const ph=pop.offsetHeight;
  if(bTop+ph>tBot)bTop=Math.max(tTop+4,nameRect.top-ph);
  pop.style.top=bTop+'px';pop.style.visibility='';
  _ecInfMiniPop=pop;
  /* ── 왼쪽 팝업 (생년월일/보호자 — JS 데이터에서 직접 생성) ── */
  const hoverLines=[];
  if(!isStaff){
    hoverLines.push('<div class="line-main">생년월일: '+escHtml(getStudentBirth(s))+'</div>');
    const _gc=getGuardianContact(s);
    if(_gc&&String(_gc).trim())hoverLines.push('<div class="line-sub">주 보호자 연락처: '+escHtml(_gc)+'</div>');
  } else {
    if(s.gender)hoverLines.push('<div class="line-main">성별: '+escHtml(s.gender)+'</div>');
    if(s.familyContact)hoverLines.push('<div class="line-sub">연락 가능한 가족: '+escHtml(s.familyContact)+'</div>');
    if(s.familyPhone)hoverLines.push('<div class="line-sub">연락처: '+escHtml(s.familyPhone)+'</div>');
  }
  if(hoverLines.length){
    const clone=document.createElement('div');
    clone.className='ems-hover-float';
    clone.style.cssText='position:fixed;min-width:230px;max-width:290px;background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:7px 9px;z-index:9000;font-size:10px;line-height:1.45;color:var(--t2);box-shadow:0 8px 32px rgba(0,0,0,0.15),0 2px 8px rgba(0,0,0,0.06);pointer-events:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)';
    clone.innerHTML=hoverLines.join('');
    clone.style.left='0';clone.style.top='0';clone.style.visibility='hidden';
    document.body.appendChild(clone);
    const hW=clone.offsetWidth;
    let hLeft=nameRect.left-hW-6;
    if(hLeft<4)hLeft=4;
    let hTop=nameRect.top;
    if(hTop+clone.offsetHeight>tBot)hTop=Math.max(tTop+4,nameRect.top-clone.offsetHeight);
    clone.style.left=hLeft+'px';clone.style.top=hTop+'px';clone.style.visibility='';
    _ecInfHoverPop=clone;
  }
  setTimeout(function(){document.addEventListener('click',_ecInfPopOutClick,true);},0);
}
function _ecShowNamePop(anchor,stuId,recId){_buildEcInfMiniPop(anchor,stuId,recId,'응급처치 기록지 보기','openEcForm');}
function _infShowNamePop(anchor,stuId,recId){_buildEcInfMiniPop(anchor,stuId,recId,'감염병 관리 기록지 보기','openInfForm');}

export function ecSortByTime(dir){
  ecSortDir=dir;
  const aBtn=document.getElementById('ecSortAscBtn');
  const dBtn=document.getElementById('ecSortDescBtn');
  const activeStyle='font-size:11px;padding:0 8px;height:32px;background:rgba(6,182,212,0.12);color:var(--cyan);border-color:rgba(6,182,212,0.35)';
  const normalStyle='font-size:11px;padding:0 8px;height:32px';
  if(aBtn)aBtn.setAttribute('style',dir==='asc'?activeStyle:normalStyle);
  if(dBtn)dBtn.setAttribute('style',dir==='desc'?activeStyle:normalStyle);
  renderEcList();
}
export function infSortByTime(dir){
  infSortDir=dir;
  const aBtn=document.getElementById('infSortAscBtn');
  const dBtn=document.getElementById('infSortDescBtn');
  const activeStyle='font-size:11px;padding:0 8px;height:32px;background:rgba(6,182,212,0.12);color:var(--cyan);border-color:rgba(6,182,212,0.35)';
  const normalStyle='font-size:11px;padding:0 8px;height:32px';
  if(aBtn)aBtn.setAttribute('style',dir==='asc'?activeStyle:normalStyle);
  if(dBtn)dBtn.setAttribute('style',dir==='desc'?activeStyle:normalStyle);
  renderInfList();
}

/* _bmCloseAndRefresh — IIFE 내부 전용 */

export function showHeaderTooltipHtml(e,html){showHeaderTooltip(e,html,true);}

/* DB에서 비동기 로드 (앱 초기화 시) */
document.addEventListener('DOMContentLoaded',function(){
  _ecLoadFromDB();
  _infLoadFromDB();
});

/* 방문 이력 락 플래그 초기화 (daily-view.js의 document click 핸들러에서 통합 관리) */
S._visitHistoryLocked=S._visitHistoryLocked||false;

/* ═══════════════════════════════════════
   EmergencyStore — 응급처치/감염병 데이터 로드/저장
   ═══════════════════════════════════════ */

/**
 * EmergencyStore — 응급처치·감염병 데이터 로드/저장 Store
 *
 * View는 이 Store를 통해 데이터를 읽고 쓰며, IPC 세부사항을 모릅니다.
 */

/* ──────────── 응급처치 ──────────── */

function saveEmergencyRecords(year, records) {
  if (window.electronAPI && window.electronAPI.recordsSaveEmergency) {
    return window.electronAPI.recordsSaveEmergency(year, records).catch(function(err) {
      console.error('[EmergencyStore] emergency 저장 실패:', err);
    });
  }
  return Promise.resolve();
}


/* ──────────── 감염병 ──────────── */

function saveInfectionRecords(year, records) {
  if (window.electronAPI && window.electronAPI.recordsSaveInfection) {
    return window.electronAPI.recordsSaveInfection(year, records).catch(function(err) {
      console.error('[EmergencyStore] infection 저장 실패:', err);
    });
  }
  return Promise.resolve();
}

function saveInfectionNotes(year, notes) {
  if (window.electronAPI && window.electronAPI.recordsSaveInfectionNotes) {
    return window.electronAPI.recordsSaveInfectionNotes(year, notes).catch(function(err) {
      console.error('[EmergencyStore] infNotes 저장 실패:', err);
    });
  }
  return Promise.resolve();
}


/* ═══════════════════════════════════════
   SlideEditor (SE) — 교무 스테이션 슬라이드 에디터
   ═══════════════════════════════════════ */

function _closeSeToolbar(){
  const _tb=document.getElementById('seTb');
  const _tbtn=document.querySelector('.se-tb-toggle');
  if(_tb)_tb.classList.remove('open');
  if(_tbtn){_tbtn.classList.remove('open');_tbtn.textContent='▼ 도구 모음';}
}

const SE=(function(){
  const W=1600;
  const H=700;
  let data;
  let sel=null;
  let tool='select';
  let dragSt=null;
  let canvas;
  let thumbsEl;
  let fileIn;
  function _id(){return 'o'+(Date.now()%1e8).toString(36)+Math.random().toString(36).substr(2,3);}
  function cur(){return data.slides[data.current];}
  function find(id){const s=cur().objects;for(let i=0;i<s.length;i++)if(s[i].id===id)return s[i];return null;}
  function maxZ(){let m=0;cur().objects.forEach(function(o){if((o.z||0)>m)m=o.z;});return m;}
  function save(){try{localStorage.setItem('ec_magic_slides',JSON.stringify(data));}catch(e){}}
  function load(){
    try{data=JSON.parse(localStorage.getItem('ec_magic_slides'));}catch(e){data=null;}
    if(!data||!data.slides||!data.slides.length)data={slides:[{id:_id(),objects:[]}],current:0};
    if(data.current>=data.slides.length)data.current=0;
  }
  function scaleCanvas(){
    const wrap=document.getElementById('seCw');
    if(!wrap||!canvas)return;
    const sc=wrap.clientWidth/W;
    canvas.style.transform='scale('+sc+')';
    wrap.style.height=(H*sc)+'px';
  }
  function m2l(e){
    const r=canvas.getBoundingClientRect(), sc=r.width/W;
    return{x:Math.max(0,Math.min(W,(e.clientX-r.left)/sc)),y:Math.max(0,Math.min(H,(e.clientY-r.top)/sc))};
  }
  function init(){
    canvas=document.getElementById('seCanvas');
    thumbsEl=document.getElementById('seThumbs');
    fileIn=document.getElementById('seFileInput');
    if(!canvas)return;
    load();scaleCanvas();render();renderThumbs();
    canvas.addEventListener('mousedown',onCanvasDown);
    const cw=document.getElementById('seCw');
    document.addEventListener('mousedown',function(e){
      const tb=document.getElementById('seTb');
      const btn=document.querySelector('.se-tb-toggle');
      if(!tb||!tb.classList.contains('open'))return;
      if((cw&&cw.contains(e.target))||(tb&&tb.contains(e.target))||(btn&&btn.contains(e.target)))return;
      _closeSeToolbar();
    });
    document.addEventListener('mousemove',onDocMove);
    document.addEventListener('mouseup',onDocUp);
    canvas.addEventListener('dragover',function(e){e.preventDefault();});
    canvas.addEventListener('drop',function(e){
      e.preventDefault();if(!e.dataTransfer.files||!e.dataTransfer.files.length)return;
      const f=e.dataTransfer.files[0];if(!f.type.startsWith('image/'))return;
      const p=m2l(e), rd=new FileReader();
      rd.onload=function(ev){const o={id:_id(),type:'image',x:Math.max(0,p.x-200),y:Math.max(0,p.y-150),w:400,h:300,z:maxZ()+1,src:ev.target.result};cur().objects.push(o);sel=o.id;save();render();renderThumbs();};
      rd.readAsDataURL(f);
    });
    canvas.addEventListener('paste',function(e){
      const items=e.clipboardData&&e.clipboardData.items;if(!items)return;
      for(let i=0;i<items.length;i++){
        if(items[i].type.indexOf('image')!==-1){
          e.preventDefault();e.stopPropagation();const f=items[i].getAsFile();if(!f)continue;
          const rd=new FileReader();
          rd.onload=function(ev){const o={id:_id(),type:'image',x:100+Math.random()*200,y:100+Math.random()*100,w:400,h:300,z:maxZ()+1,src:ev.target.result};cur().objects.push(o);sel=o.id;save();render();renderThumbs();};
          rd.readAsDataURL(f);return;
        }
      }
    });
    canvas.setAttribute('tabindex','0');
    canvas.addEventListener('keydown',function(e){
      if(e.target.isContentEditable)return;
      if((e.key==='Delete'||e.key==='Backspace')&&sel){deleteSelected();e.preventDefault();}
    });
    window.addEventListener('resize',scaleCanvas);
  }
  function render(){
    if(!canvas)return;
    canvas.querySelectorAll('.se-obj,.se-preview-box').forEach(function(el){el.remove();});
    const svg=document.getElementById('seSvg');
    if(svg)svg.innerHTML='';
    const ns='http://www.w3.org/2000/svg';
    const defs=document.createElementNS(ns,'defs');svg.appendChild(defs);
    const sorted=cur().objects.slice().sort(function(a,b){return(a.z||0)-(b.z||0);});
    sorted.forEach(function(obj){
      if(obj.type==='line'||obj.type==='arrow')renderSvgObj(obj,svg,ns,defs);
      else renderDomObj(obj);
    });
    updateTbState();
  }
  function renderDomObj(obj){
    const el=document.createElement('div');
    el.className='se-obj'+(sel===obj.id?' selected':'');
    el.dataset.id=obj.id;
    el.style.left=obj.x+'px';el.style.top=obj.y+'px';el.style.width=obj.w+'px';el.style.height=obj.h+'px';el.style.zIndex=obj.z||1;
    ['nw','ne','sw','se2'].forEach(function(d){const h=document.createElement('div');h.className='se-h '+d;h.dataset.dir=d.replace('2','');el.appendChild(h);});
    switch(obj.type){
      case 'text':
        const t=document.createElement('div');t.className='se-text';t.contentEditable='true';
        t.innerHTML=obj.content||'';
        t.style.fontFamily=obj.fontFamily||'sans-serif';
        t.style.fontSize=(obj.fontSize||16)+'px';
        const fc=obj.fontColor||'default';t.style.color=(fc==='default')?(document.body.classList.contains('light')?'#222':'#e8ecf1'):fc;
        if(obj.bold)t.style.fontWeight='bold';
        if(obj.italic)t.style.fontStyle='italic';
        const td=[];if(obj.underline)td.push('underline');if(obj.strikethrough)td.push('line-through');
        if(td.length)t.style.textDecoration=td.join(' ');
        t.addEventListener('input',function(){obj.content=t.innerHTML;save();});
        t.addEventListener('mousedown',function(e){if(sel===obj.id)e.stopPropagation();});
        t.addEventListener('focus',function(e){if(sel!==obj.id){e.target.blur();}});
        el.appendChild(t);break;
      case 'image':
        const img=document.createElement('img');img.className='se-img';img.src=obj.src||'';img.draggable=false;el.appendChild(img);break;
      case 'table':
        const tbl=document.createElement('table');tbl.className='se-tbl';
        for(let r=0;r<obj.rows;r++){const tr=document.createElement('tr');
          for(let c=0;c<obj.cols;c++){const td2=document.createElement('td');td2.contentEditable='true';
            td2.textContent=(obj.cells&&obj.cells[r]&&obj.cells[r][c])||'';
            (function(rr,cc){td2.addEventListener('input',function(){if(!obj.cells)obj.cells=[];if(!obj.cells[rr])obj.cells[rr]=[];obj.cells[rr][cc]=td2.textContent;save();});})(r,c);
            td2.addEventListener('mousedown',function(e){if(sel===obj.id)e.stopPropagation();});
            tr.appendChild(td2);}tbl.appendChild(tr);}
        el.appendChild(tbl);break;
      case 'rect':case 'circle':case 'triangle':
        const svgNs='http://www.w3.org/2000/svg';
        const s=document.createElementNS(svgNs,'svg');s.setAttribute('viewBox','0 0 100 100');s.setAttribute('preserveAspectRatio','none');s.style.cssText='width:100%;height:100%;display:block';
        let shape;
        if(obj.type==='rect'){shape=document.createElementNS(svgNs,'rect');shape.setAttribute('x','2');shape.setAttribute('y','2');shape.setAttribute('width','96');shape.setAttribute('height','96');shape.setAttribute('rx','2');}
        else if(obj.type==='circle'){shape=document.createElementNS(svgNs,'ellipse');shape.setAttribute('cx','50');shape.setAttribute('cy','50');shape.setAttribute('rx','48');shape.setAttribute('ry','48');}
        else{shape=document.createElementNS(svgNs,'polygon');shape.setAttribute('points','50,2 98,98 2,98');}
        shape.setAttribute('fill',obj.fill||'rgba(99,102,241,0.3)');shape.setAttribute('stroke',obj.stroke||'#333');shape.setAttribute('stroke-width',obj.strokeWidth||2);
        s.appendChild(shape);el.appendChild(s);break;
    }
    canvas.appendChild(el);
  }
  function renderSvgObj(obj,svgP,ns,defs){
    const g=document.createElementNS(ns,'g');g.dataset.id=obj.id;g.style.pointerEvents='auto';
    if(obj.type==='arrow'){
      const mid='arr_'+obj.id;
      const mk=document.createElementNS(ns,'marker');mk.setAttribute('id',mid);mk.setAttribute('markerWidth','10');mk.setAttribute('markerHeight','7');mk.setAttribute('refX','9');mk.setAttribute('refY','3.5');mk.setAttribute('orient','auto');
      const pg=document.createElementNS(ns,'polygon');pg.setAttribute('points','0 0,10 3.5,0 7');pg.setAttribute('fill',obj.color||'#333');mk.appendChild(pg);defs.appendChild(mk);
    }
    const hit=document.createElementNS(ns,'line');hit.setAttribute('x1',obj.x1);hit.setAttribute('y1',obj.y1);hit.setAttribute('x2',obj.x2);hit.setAttribute('y2',obj.y2);
    hit.setAttribute('class','se-hit');g.appendChild(hit);
    const ln=document.createElementNS(ns,'line');ln.setAttribute('x1',obj.x1);ln.setAttribute('y1',obj.y1);ln.setAttribute('x2',obj.x2);ln.setAttribute('y2',obj.y2);
    ln.setAttribute('stroke',obj.color||'#333');ln.setAttribute('stroke-width',obj.lineWidth||2);
    if(obj.type==='arrow')ln.setAttribute('marker-end','url(#arr_'+obj.id+')');
    g.appendChild(ln);
    if(sel===obj.id){
      const hl=document.createElementNS(ns,'line');hl.setAttribute('x1',obj.x1);hl.setAttribute('y1',obj.y1);hl.setAttribute('x2',obj.x2);hl.setAttribute('y2',obj.y2);
      hl.setAttribute('stroke','#06b6d4');hl.setAttribute('stroke-width',(obj.lineWidth||2)+4);hl.setAttribute('opacity','0.3');hl.style.pointerEvents='none';
      g.insertBefore(hl,g.firstChild);
      [['x1','y1'],['x2','y2']].forEach(function(ep,i){
        const c=document.createElementNS(ns,'circle');c.setAttribute('cx',obj[ep[0]]);c.setAttribute('cy',obj[ep[1]]);c.setAttribute('r','6');c.setAttribute('class','se-ep');c.dataset.ep=i;g.appendChild(c);
      });
    }
    svgP.appendChild(g);
  }
  function renderThumbs(){return;
  if(!thumbsEl)return;thumbsEl.innerHTML='';
    data.slides.forEach(function(slide,idx){
      const th=document.createElement('div');th.className='se-th'+(idx===data.current?' active':'');
      th.addEventListener('click',function(e){if(!e.target.classList.contains('se-th-del'))selectSlide(idx);});
      const pv=document.createElement('div');pv.className='se-th-pv';
      slide.objects.forEach(function(obj){
        const d=document.createElement('div');d.style.position='absolute';
        if(obj.type==='line'||obj.type==='arrow'){
          const mx=Math.min(obj.x1,obj.x2), my=Math.min(obj.y1,obj.y2);
          d.style.left=mx/W*100+'%';d.style.top=my/H*100+'%';d.style.width=Math.max(2,Math.abs(obj.x2-obj.x1)/W*100)+'%';d.style.height='2px';d.style.background='rgba(107,114,128,.5)';
        }else{
          d.style.left=obj.x/W*100+'%';d.style.top=obj.y/H*100+'%';d.style.width=obj.w/W*100+'%';d.style.height=obj.h/H*100+'%';
          const cl={text:'rgba(59,130,246,.3)',image:'rgba(16,185,129,.3)',table:'rgba(245,158,11,.3)',rect:'rgba(99,102,241,.3)',circle:'rgba(236,72,153,.3)',triangle:'rgba(249,115,22,.3)'};
          d.style.background=cl[obj.type]||'rgba(107,114,128,.2)';
          if(obj.type==='circle')d.style.borderRadius='50%';
        }
        pv.appendChild(d);
      });
      const n=document.createElement('div');n.className='se-th-n';n.textContent=idx+1;
      if(data.slides.length>1){const del=document.createElement('button');del.className='se-th-del';del.textContent='\u2715';del.addEventListener('click',function(e){e.stopPropagation();deleteSlide(idx);});th.appendChild(del);}
      th.appendChild(pv);th.appendChild(n);thumbsEl.appendChild(th);
    });
  }
  function selectSlide(idx){sel=null;data.current=idx;save();render();renderThumbs();}
  function addSlide(){data.slides.push({id:_id(),objects:[]});data.current=data.slides.length-1;sel=null;save();render();renderThumbs();}
  function deleteSlide(idx){
    if(data.slides.length<=1)return;data.slides.splice(idx,1);
    if(data.current>=data.slides.length)data.current=data.slides.length-1;
    sel=null;save();render();renderThumbs();
  }
  function setTool(t){
    tool=t;canvas.style.cursor=t==='select'?'default':'crosshair';
    document.querySelectorAll('#seTb .se-btn[data-tool]').forEach(function(b){b.classList.toggle('active',b.dataset.tool===t);});
  }
  function selectObj(id){sel=id;render();}
  function deselect(){if(sel){sel=null;render();}}
  function updateTbState(){
    const obj=sel?find(sel):null;
    if(obj&&obj.type==='text'){
      const ff=document.getElementById('seFontFamily');if(ff)ff.value=obj.fontFamily||'sans-serif';
      const fs=document.getElementById('seFontSize');if(fs)fs.value=obj.fontSize||16;
      const fc=document.getElementById('seFontColor');if(fc)fc.value=obj.fontColor||'default';
    }
  }
  function fmt(prop,val){
    const obj=sel?find(sel):null;if(!obj||obj.type!=='text')return;
    if(prop==='bold'||prop==='italic'||prop==='underline'||prop==='strikethrough'){
      const cmd=prop==='strikethrough'?'strikeThrough':prop;
      document.execCommand(cmd,false,null);
      const te=canvas.querySelector('[data-id="'+obj.id+'"] .se-text');
      if(te)obj.content=te.innerHTML;
      save();return;
    }
    obj[prop]=val;save();render();
  }
  function onCanvasDown(e){
    const pos=m2l(e);
    const hEl=e.target.closest('.se-h');
    if(hEl&&sel){
      e.preventDefault();const obj=find(sel);if(!obj)return;
      dragSt={type:'resize',dir:hEl.dataset.dir,obj:obj,sx:pos.x,sy:pos.y,ox:obj.x,oy:obj.y,ow:obj.w,oh:obj.h};return;
    }
    if(e.target.dataset.ep!==undefined&&sel){
      e.preventDefault();const obj=find(sel);if(!obj)return;
      dragSt={type:'endpoint',ep:+e.target.dataset.ep,obj:obj};return;
    }
    const svgG=e.target.closest('g[data-id]');
    if(svgG){
      e.preventDefault();const id=svgG.dataset.id;selectObj(id);const obj=find(id);if(!obj)return;
      dragSt={type:'linemove',obj:obj,sx:pos.x,sy:pos.y,ox1:obj.x1,oy1:obj.y1,ox2:obj.x2,oy2:obj.y2};return;
    }
    const objEl=e.target.closest('.se-obj');
    if(objEl){
      const id=objEl.dataset.id,obj=find(id);if(!obj)return;
      if(sel===id&&(obj.type==='text'||obj.type==='table')){
        const textTarget=e.target.closest('.se-text');
        const tableTarget=e.target.closest('.se-tbl');
        const isEditingText=textTarget&&document.activeElement===textTarget;
        const isEditingTable=tableTarget&&document.activeElement&&document.activeElement.tagName==='TD'&&tableTarget.contains(document.activeElement);
        if(isEditingText||isEditingTable)return;
      }
      e.preventDefault();selectObj(id);
      dragSt={type:'move',obj:obj,sx:pos.x,sy:pos.y,ox:obj.x,oy:obj.y};return;
    }
    if(tool==='select'){deselect();return;}
    if(tool==='text'){
      const o={id:_id(),type:'text',x:pos.x,y:pos.y,w:240,h:44,z:maxZ()+1,content:'',fontFamily:'sans-serif',fontSize:16,fontColor:'default',bold:false,italic:false,underline:false,strikethrough:false};
      cur().objects.push(o);sel=o.id;save();render();renderThumbs();
      const te=canvas.querySelector('[data-id="'+o.id+'"] .se-text');if(te)te.focus();
      setTool('select');return;
    }
    if(tool==='line'||tool==='arrow'||tool==='rect'||tool==='circle'||tool==='triangle'){
      e.preventDefault();dragSt={type:'draw',tool:tool,sx:pos.x,sy:pos.y,cx:pos.x,cy:pos.y};return;
    }
  }
  function onDocMove(e){
    if(!dragSt||!canvas)return;
    const r=canvas.getBoundingClientRect(), sc=r.width/W;
    const pos={x:Math.max(0,Math.min(W,(e.clientX-r.left)/sc)),y:Math.max(0,Math.min(H,(e.clientY-r.top)/sc))};
    let dx, dy, o, d;
    switch(dragSt.type){
      case 'move':
        dx=pos.x-dragSt.sx;dy=pos.y-dragSt.sy;o=dragSt.obj;
        o.x=Math.max(0,Math.min(W-o.w,dragSt.ox+dx));o.y=Math.max(0,Math.min(H-o.h,dragSt.oy+dy));render();break;
      case 'resize':
        dx=pos.x-dragSt.sx;dy=pos.y-dragSt.sy;o=dragSt.obj;d=dragSt.dir;
        if(d.indexOf('e')>=0){o.w=Math.max(30,dragSt.ow+dx);}
        if(d.indexOf('w')>=0){o.x=dragSt.ox+dx;o.w=Math.max(30,dragSt.ow-dx);}
        if(d.indexOf('s')>=0){o.h=Math.max(20,dragSt.oh+dy);}
        if(d.indexOf('n')>=0){o.y=dragSt.oy+dy;o.h=Math.max(20,dragSt.oh-dy);}
        render();break;
      case 'linemove':
        dx=pos.x-dragSt.sx;dy=pos.y-dragSt.sy;o=dragSt.obj;
        o.x1=dragSt.ox1+dx;o.y1=dragSt.oy1+dy;o.x2=dragSt.ox2+dx;o.y2=dragSt.oy2+dy;render();break;
      case 'endpoint':
        o=dragSt.obj;if(dragSt.ep===0){o.x1=pos.x;o.y1=pos.y;}else{o.x2=pos.x;o.y2=pos.y;}render();break;
      case 'draw':
        dragSt.cx=pos.x;dragSt.cy=pos.y;drawPreview();break;
    }
  }
  function onDocUp(){
    if(!dragSt)return;
    if(dragSt.type==='draw'){
      clearPreview();
      const sx=dragSt.sx;
      const sy=dragSt.sy;
      const ex=dragSt.cx;
      const ey=dragSt.cy;
      let o;
      if(dragSt.tool==='line'||dragSt.tool==='arrow'){
        if(Math.abs(ex-sx)<8&&Math.abs(ey-sy)<8){dragSt=null;return;}
        o={id:_id(),type:dragSt.tool,x1:sx,y1:sy,x2:ex,y2:ey,z:maxZ()+1,color:'#333333',lineWidth:2};
      }else{
        const x=Math.min(sx,ex), y=Math.min(sy,ey), w=Math.abs(ex-sx), h=Math.abs(ey-sy);
        if(w<10||h<10){dragSt=null;return;}
        const fills={rect:'rgba(99,102,241,0.3)',circle:'rgba(59,130,246,0.3)',triangle:'rgba(249,115,22,0.3)'};
        o={id:_id(),type:dragSt.tool,x:x,y:y,w:w,h:h,z:maxZ()+1,fill:fills[dragSt.tool],stroke:'#333333',strokeWidth:2};
      }
      cur().objects.push(o);sel=o.id;save();render();renderThumbs();setTool('select');
    }else if(dragSt.type==='move'||dragSt.type==='resize'||dragSt.type==='linemove'||dragSt.type==='endpoint'){
      save();renderThumbs();
    }
    dragSt=null;
  }
  let pvEl=null;
  function drawPreview(){
    clearPreview();if(!dragSt||dragSt.type!=='draw')return;
    const sx=dragSt.sx, sy=dragSt.sy, cx=dragSt.cx, cy=dragSt.cy;
    if(dragSt.tool==='line'||dragSt.tool==='arrow'){
      const svg=document.getElementById('seSvg');if(!svg)return;
      const ns='http://www.w3.org/2000/svg';
      const ln=document.createElementNS(ns,'line');ln.setAttribute('x1',sx);ln.setAttribute('y1',sy);ln.setAttribute('x2',cx);ln.setAttribute('y2',cy);
      ln.setAttribute('class','se-preview-line');ln.style.pointerEvents='none';svg.appendChild(ln);pvEl=ln;
    }else{
      const x=Math.min(sx,cx), y=Math.min(sy,cy), w=Math.abs(cx-sx), h=Math.abs(cy-sy);
      const d=document.createElement('div');d.className='se-preview-box';
      d.style.left=x+'px';d.style.top=y+'px';d.style.width=w+'px';d.style.height=h+'px';
      if(dragSt.tool==='circle')d.style.borderRadius='50%';
      canvas.appendChild(d);pvEl=d;
    }
  }
  function clearPreview(){if(pvEl){pvEl.remove();pvEl=null;}canvas.querySelectorAll('.se-preview-box,.se-preview-line').forEach(function(el){el.remove();});const svg=document.getElementById('seSvg');if(svg)svg.querySelectorAll('.se-preview-line').forEach(function(el){el.remove();});}
  function insertImage(input){
    if(!input.files||!input.files.length)return;
    Array.from(input.files).forEach(function(file){
      if(!file.type.startsWith('image/'))return;
      const rd=new FileReader();
      rd.onload=function(ev){const o={id:_id(),type:'image',x:100+Math.random()*300,y:80+Math.random()*200,w:400,h:300,z:maxZ()+1,src:ev.target.result};cur().objects.push(o);sel=o.id;save();render();renderThumbs();setTool('select');};
      rd.readAsDataURL(file);
    });input.value='';
  }
  function addTable(){
    const existing=document.getElementById('seTablePrompt');if(existing)existing.remove();
    const d=document.createElement('div');d.id='seTablePrompt';
    d.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--card);border:1px solid var(--cyan);border-radius:10px;padding:20px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:220px';
    d.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:12px">표 삽입</div>'
      +'<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><label style="font-size:11px;color:var(--t2)">행</label><input id="seTableRows" type="number" value="3" min="1" max="20" style="width:50px;padding:4px 6px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);font-size:12px">'
      +'<label style="font-size:11px;color:var(--t2)">열</label><input id="seTableCols" type="number" value="3" min="1" max="20" style="width:50px;padding:4px 6px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);font-size:12px"></div>'
      +'<div style="display:flex;gap:6px;justify-content:flex-end"><button data-se-click="cancelTable" style="padding:5px 12px;border:1px solid var(--bdr);border-radius:4px;background:none;color:var(--t2);cursor:pointer;font-size:11px">취소</button>'
      +'<button data-se-click="confirmTable" style="padding:5px 12px;border:none;border-radius:4px;background:var(--cyan);color:#fff;cursor:pointer;font-size:11px;font-weight:600">삽입</button></div>';
    document.body.appendChild(d);
    d.querySelector('[data-se-click="cancelTable"]').addEventListener('click', function(){ document.getElementById('seTablePrompt').remove(); });
    d.querySelector('[data-se-click="confirmTable"]').addEventListener('click', function(){ _doAddTable(); });
    document.getElementById('seTableRows').focus();
  }
  function _doAddTable(){
    const rowsV=parseInt(document.getElementById('seTableRows').value)||3;
    const colsV=parseInt(document.getElementById('seTableCols').value)||3;
    const rows=Math.min(Math.max(rowsV,1),20), cols=Math.min(Math.max(colsV,1),20);
    const cells=[];for(let r=0;r<rows;r++){cells[r]=[];for(let c=0;c<cols;c++)cells[r][c]='';}
    const o={id:_id(),type:'table',x:100,y:100,w:Math.min(cols*130,1400),h:Math.min(rows*44,800),z:maxZ()+1,rows:rows,cols:cols,cells:cells};
    cur().objects.push(o);sel=o.id;save();render();setTool('select');
    const p=document.getElementById('seTablePrompt');if(p)p.remove();
  }
  function layerFront(){if(!sel)return;const o=find(sel);if(o){o.z=maxZ()+1;save();render();}}
  function layerBack(){if(!sel)return;const o=find(sel);if(!o)return;let mn=Infinity;cur().objects.forEach(function(ob){if((ob.z||0)<mn)mn=ob.z||0;});o.z=mn-1;save();render();}
  function deleteSelected(){
    if(!sel)return;
    const objs=cur().objects;
    let idx=-1;
    for(let i=0;i<objs.length;i++)if(objs[i].id===sel){idx=i;break;}
    if(idx>=0)objs.splice(idx,1);sel=null;save();render();renderThumbs();
  }
  function getSelected(){return sel?find(sel):null;}
  function alignLeft(){const o=getSelected();if(!o)return;o.x=0;save();render();}
  function alignCenter(){const o=getSelected();if(!o)return;o.x=Math.round((W-o.w)/2);save();render();}
  function alignRight(){const o=getSelected();if(!o)return;o.x=W-o.w;save();render();}
  function alignTop(){const o=getSelected();if(!o)return;o.y=0;save();render();}
  function alignMiddle(){const o=getSelected();if(!o)return;o.y=Math.round((H-o.h)/2);save();render();}
  function alignBottom(){const o=getSelected();if(!o)return;o.y=H-o.h;save();render();}
  return{init:init,scaleCanvas:scaleCanvas,render:render,setTool:setTool,addSlide:addSlide,selectSlide:selectSlide,insertImage:insertImage,addTable:addTable,_doAddTable:_doAddTable,fmt:fmt,layerFront:layerFront,layerBack:layerBack,deleteSelected:deleteSelected,getSelected:getSelected,alignLeft:alignLeft,alignCenter:alignCenter,alignRight:alignRight,alignTop:alignTop,alignMiddle:alignMiddle,alignBottom:alignBottom};
})();
setTimeout(function(){SE.init();},600);

/* ── Public exports ── */

/* ── Event bus registrations ── */
bus.on('render:ecList', renderEcList);
bus.on('render:infList', renderInfList);
bus.on('toast:save', showGlobalSaveToast);
bus.on('toast:saveLater', queueGlobalSaveToast);
