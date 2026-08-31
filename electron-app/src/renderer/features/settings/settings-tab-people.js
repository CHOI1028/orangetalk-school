/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { S } from '../../core/app-state.js';
import { _pushRosterToRelay, _checkKioskRosterStale, escHtml, extractGuardianLabel, _reloadStudentsFromDB, saveStudents, isKinder, closeModalGracefully, compareClass, normalizeClassInput } from '../../core/helpers.js';
import { renderSettingsPanel, triggerLocalTemplateDownload, openAccordion } from './settings-view.js';
import { closeModalWithAnim } from '../daily/daily-autocomplete.js';
import { bus } from '../../core/event-bus.js';
import { dailyColEyeIcon } from '../emergency/emergency-view.js';

/* 명단(인원) 도메인의 연도는 언제나 '학년도' — 학년도는 3월 1일에 시작한다(달력 연도 아님).
   예) 2025-02-26 → 2024학년도. (사용자 지시 2026-06-19: 반드시 3/1 기점.)
   ※ S.calYear 는 일일 달력의 '달력 연도'이므로 명단 연산엔 절대 쓰지 않는다 — 이 헬퍼만 사용. */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

/* ═══════════════════════════════════════
   SETTINGS TAB: PEOPLE (학생/교직원 데이터 관리)
   Extracted from settings-view.js
   ═══════════════════════════════════════ */

let careSelectedFileName='';
let careSelectedFile=null;
let careParsedRows=[];
let studentSelectedFileName='';
let staffSelectedFileName='';

export function _renderPeopleTab(){
  const _pk=typeof isKinder==='function'&&isKinder();
  const _psl=_pk?'원아':'학생';
  /* 학년도 계산 — 한국 학년도는 3월 1일~다음해 2월 28일 (1·2월은 전년도 유지) */
  const _now=new Date();
  const _ay = _now.getMonth()>=2 ? _now.getFullYear() : _now.getFullYear()-1;
  const _stuCnt=S.people.filter(function(s){return s.type==='student';}).length;
  const _staffCnt=S.people.filter(function(s){return s.type==='staff';}).length;
  const _careCnt=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch');}).length;
  const _mcNCnt=S.people.filter(function(s){return s.type==='student'&&s.med_consent==='N';}).length;
  let html='<div class="settings-panel-title">👥 '+_ay+'학년도 '+_psl+'/교직원 데이터 관리</div>';
  html+='<div class="settings-panel-desc">'+_ay+'학년도 '+_psl+' 및 교직원 명단을 업로드, 수정, 상태 관리합니다. 인원 데이터 관리 팝업과 동일한 기능입니다.</div>';
  const _ecNCnt=S.people.filter(function(s){return s.type==='student'&&s.emergency_consent==='N';}).length;
  /* ── 교직원 섹션 ── */
  html+='<div class="set-accordion" data-action="accordion"><span>👔 '+_ay+'학년도 교직원 명단 ('+_staffCnt+'명)</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body"><div id="peopleStaff">';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">'
    +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px">👔 교직원 일괄 업로드</div>'
    +'<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
    +'<button class="btn btn-primary btn-sm" data-action="dl-staff-template">📥 최적화 양식 다운로드</button>'
    +'<button class="btn btn-sm" id="btnUndoStaffUpload" data-action="undo-last-upload" data-type="staff" disabled style="background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.2);font-size:10px;cursor:not-allowed">↩ 업로드 명단 삭제</button>'
    +'<button class="btn btn-sm" data-action="bulk-delete" data-type="staff" style="background:rgba(239,68,68,0.07);color:#dc2626;border:1px solid rgba(239,68,68,0.25);font-size:10px">🗑 기존 명단 삭제</button>'
    +'</div>'
    +'<p style="font-size:10px;color:var(--t3);margin-bottom:4px">전체 일괄 등록 시 기존 명단을 삭제한 후 업로드하세요. 기존 명단을 삭제하더라도 기존 보건일지 내용은 삭제되지 않습니다.</p>'
    +'<p style="font-size:10px;color:var(--t2);margin-bottom:6px">💡 직위를 교원, 직원으로 심플하게 구분하면 관리하기 편리합니다.</p>'
    +'<div class="upload-area" id="staffUploadArea2" tabindex="0" style="min-height:70px;outline:none;opacity:0.4;pointer-events:none" data-action="staff-upload-area">📁 기존 명단을 삭제한 후 활성화됩니다.</div>'
    +'<input type="file" id="staffFileInput2" accept=".xlsx,.xls" style="display:none">'
    +'</div>';
  html+='<div style="text-align:center"><button class="btn btn-sm" data-action="open-staff-list" style="font-size:11px;font-weight:600">👔 '+_ay+'학년도 교직원 명단/내용 보기</button></div>';
  html+='</div></div></div>';
  /* ── 학생 섹션 ── */
  html+='<div class="set-accordion" data-action="accordion"><span>🎒 '+_ay+'학년도 '+_psl+' 명단 ('+_stuCnt+'명)</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body"><div id="peopleStudent">';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">'
    +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px">🎒 '+_psl+' 일괄 업로드</div>'
    +'<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
    +'<button class="btn btn-primary btn-sm" data-action="dl-student-template">📥 최적화 양식 다운로드</button>'
    +'<button class="btn btn-sm" id="btnUndoStudentUpload" data-action="undo-last-upload" data-type="student" disabled style="background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.2);font-size:10px;cursor:not-allowed">↩ 업로드 명단 삭제</button>'
    +'<button class="btn btn-sm" data-action="bulk-delete" data-type="student" style="background:rgba(239,68,68,0.07);color:#dc2626;border:1px solid rgba(239,68,68,0.25);font-size:10px">🗑 기존 명단 삭제</button>'
    +'</div>'
    +'<p style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:4px">반드시 위의 최적화 양식을 다운로드하여 사용해 주세요. 임의로 만든 파일은 업로드할 수 없습니다.</p>'
    +'<p style="font-size:10px;color:var(--t3);margin-bottom:6px">전체 일괄 등록 시 기존 명단을 삭제한 후 업로드하세요. 기존 명단을 삭제하더라도 기존 보건일지 내용은 삭제되지 않습니다.</p>'
    +'<div class="upload-area" id="studentUploadArea" tabindex="0" style="min-height:70px;outline:none;opacity:0.4;pointer-events:none" data-action="student-upload-area">📁 기존 명단을 삭제한 후 활성화됩니다.</div>'
    +'<input type="file" id="studentFileInput" accept=".xlsx,.xls" style="display:none">'
    +'<div id="studentUploadMsg" style="display:none;margin-top:6px;font-size:11px;padding:6px 10px;border-radius:5px"></div>'
    +'<div id="studentValidationArea" style="display:none;margin-top:8px;border:1px solid var(--bdr);border-radius:8px;padding:12px;max-height:300px;overflow-y:auto;scrollbar-width:thin;background:var(--bg2)"></div>'
    +'</div>';
  html+='<div style="text-align:center"><button class="btn btn-sm" data-action="open-student-list" style="font-size:11px;font-weight:600">🎒 '+_psl+' 명단/내용 보기 (인쇄·PDF·내보내기)</button></div>';
  html+='</div></div></div>';
  /* ── 요보호 학생 섹션 ── */
  const careList=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch');});
  html+='<div class="set-accordion" data-action="accordion"><span>🛡 요보호 & 미세먼지 기저질환 '+_psl+' ('+_careCnt+'명)</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body"><div id="peopleCare">';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">📤 요보호 '+_psl+' 일괄 업로드</div>'
    +'<p style="font-size:10.5px;color:var(--t3);margin-bottom:4px">자동 인식: 학년, 반, 번호, 이름, 요보호 질환명, 미세먼지 기저질환명, 메모 / 주의사항 (선택). <b>학년+반+번호+이름</b>으로 학생을 매칭합니다.</p>'
    +'<p style="font-size:10.5px;color:var(--rs);font-weight:700;margin-bottom:8px">⚠ 주의! 파일을 업로드하는 즉시 업데이트가 됩니다.</p>'
    +'<div style="margin-bottom:8px"><button class="btn btn-primary btn-sm" data-action="dl-care-template">📥 최적화 양식 다운로드</button></div>'
    +'<div class="upload-area" id="careUploadArea" data-action="care-upload-area" style="margin-bottom:8px">📁 파일을 복사하여 여기에 붙여넣기, 드래그 앤 드랍, 여기를 클릭하여 찾아주세요.</div>'
    +'<input type="file" id="careFileInput" accept=".csv,.xlsx,.xls" style="display:none">'
    +'<div id="careFileMeta" style="display:none;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding:6px 10px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2)"><span id="careFileName" style="font-size:11px;color:var(--t2)"></span><button class="magic-img-delete" style="position:static;display:inline-flex" data-action="clear-care-file">✕</button></div>'
    +'<div id="uploadCareMsg" style="display:none;margin-top:8px;font-size:11px;color:var(--gs);padding:6px 10px;background:var(--gbg);border-radius:5px">반영되었습니다</div>'
    +'</div>';
  html+='<div style="font-size:11px;color:var(--t2);margin-bottom:8px">현재 요보호 '+_psl+': <b>'+careList.length+'명</b></div>';
  html+='<div style="text-align:center;margin-top:10px"><button class="btn btn-sm" data-action="open-care-list" style="font-size:11px;font-weight:600">🛡 요보호 & 미세먼지 기저질환 '+_psl+' 명단 보기</button></div>';
  html+='</div></div></div>';
  /* ── 의약품 동의/비동의 섹션 ── */
  html+='<div class="set-accordion" data-action="accordion"><span>💊 응급처치 & 일반의약품 비동의 '+_psl+' '+(+_mcNCnt||+_ecNCnt?'<span style="font-size:9px;color:#dc2626">('+(_mcNCnt+_ecNCnt)+'명)</span>':'')+'</span><span class="set-acc-arrow">▼</span></div>';
  html+='<div class="set-accordion-body"><div id="peopleMedConsent">';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  html+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px">💊 의약품 사용 동의/비동의 관리</div>';
  html+='<p style="font-size:10.5px;color:var(--t3);margin-bottom:8px">비동의 '+_psl+'만 등록하면 됩니다. 등록하지 않은 '+_psl+'은 동의로 간주합니다.<br>비동의 '+_psl+'은 보건일지에 <span style="display:inline-block;padding:1px 6px;font-size:9px;font-weight:700;border-radius:8px;background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.2)">비동의</span> 칩이 표시됩니다.</p>';
  html+='<div style="font-size:11px;color:var(--t2);margin-bottom:8px">비동의 '+_psl+': <b style="color:#dc2626">'+_mcNCnt+'명</b> / 전체 '+_stuCnt+'명</div>';
  html+='</div>';
  html+='<div style="text-align:center;margin-top:10px"><button class="btn btn-sm" data-action="open-mc-list" style="font-size:11px;font-weight:600">💊 비동의 '+_psl+' 명단 보기</button></div>';
  html+='</div></div></div>';
  return html;
}

/* ── post-render event binding for people tab ── */

/* ── event binding for care list panel (used by person-manager too) ── */

/* ── People tab switch ── */

/* ── Med consent toggle ── */

/* ── Template downloads ── */
export function downloadOptimizedStudentTemplate(){
  triggerLocalTemplateDownload('templates/forms/students_list.xlsx','students_list.xlsx');
}
export function downloadOptimizedStaffTemplate(){
  triggerLocalTemplateDownload('templates/forms/staff_list.xlsx','staff_list.xlsx');
}
export function downloadOptimizedCareTemplate(){
  triggerLocalTemplateDownload('templates/forms/List_of_Students_with_Special_Health_Care_Needs.xlsx','List_of_Students_with_Special_Health_Care_Needs.xlsx');
}

/* ── File upload helpers ── */
function extractFirstFileFromTransfer(dt){
  if(!dt)return null;
  if(dt.items&&dt.items.length){
    for(let i=0;i<dt.items.length;i++){
      if(dt.items[i].kind==='file'){
        const f=dt.items[i].getAsFile();
        if(f)return f;
      }
    }
  }
  if(dt.files&&dt.files.length)return dt.files[0];
  return null;
}
export function handleStudentUploadPaste(e){
  const f=extractFirstFileFromTransfer(e.clipboardData);
  if(!f)return;
  e.preventDefault();
  handleStudentFile(f);
}
export function initPeopleUploadPaste(){
  const studentArea=document.getElementById('studentUploadArea');
  if(studentArea)studentArea.focus();
}
function setPeopleUploadFileName(type,name){
  const safeName=String(name||'').trim();
  if(type==='staff') staffSelectedFileName=safeName;
  else studentSelectedFileName=safeName;
  const area=document.getElementById(type==='staff'?'staffUploadArea':'studentUploadArea');
  if(area&&safeName) area.textContent='업로드된 파일: '+safeName;
}
function openBulkDeleteConfirm(type){
  const _bdNow=new Date();const _bdAy=_bdNow.getMonth()>=2?_bdNow.getFullYear():_bdNow.getFullYear()-1;
  const label=_bdAy+'학년도 '+(type==='staff'?'교직원 명단':type==='care'?'요보호 대상 학생 명단':'학생 명단');
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='bulkDeleteConfirmOverlay';
  ov.innerHTML='<div class="modal-content" style="width:360px;max-width:92vw;padding:16px">'
    +'<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:10px">'+label+' 일괄 삭제</div>'
    +'<div style="font-size:12px;color:var(--t2);margin-bottom:12px">정말로 삭제하시겠습니까?</div>'
    +'<div style="display:flex;justify-content:flex-end;gap:6px"><button class="btn btn-outline btn-sm" data-action="close-bulk-delete">아니오</button><button class="btn btn-primary btn-sm" data-action="confirm-bulk-delete" data-type="'+type+'">예</button></div>'
    +'</div>';
  ov.addEventListener('click',function(e){
    if(e.target===ov)closeBulkDeleteConfirm();
    const t=e.target.closest('[data-action]');if(!t)return;
    if(t.dataset.action==='close-bulk-delete')closeBulkDeleteConfirm();
    else if(t.dataset.action==='confirm-bulk-delete')confirmBulkDelete(t.dataset.type);
  });
  document.body.appendChild(ov);
}
function closeBulkDeleteConfirm(){
  const ov=document.getElementById('bulkDeleteConfirmOverlay');
  if(ov)closeModalGracefully(ov);
}
function confirmBulkDelete(type){
  if(type==='care'){
    S.people.forEach(function(s){
      if(s.status==='caution'||s.status==='watch'){s.status='normal';s.condition='';s.careMemo='';delete s.careYear;}
    });
    saveStudents();
    closeBulkDeleteConfirm();
    renderSettingsPanel('people');
  } else if(type==='staff'){
    S.people=S.people.filter(function(s){return s.type!=='staff';});
    saveStudents();
    closeBulkDeleteConfirm();
    renderSettingsPanel('people');
  } else {
    S.people=S.people.filter(function(s){return s.type!=='student';});
    saveStudents();
    closeBulkDeleteConfirm();
    renderSettingsPanel('people');
  }
  bus.emit('render:daily');
  bus.emit('render:dashboard');
}

/* ── Student file handling ── */
function _normalizePhone(raw){
  if(!raw)return'';
  const s=String(raw).replace(/[^0-9]/g,'');
  if(!s)return'';
  if(s.length===11&&s.startsWith('0'))return s.slice(0,3)+'-'+s.slice(3,7)+'-'+s.slice(7);
  if(s.length===10&&s.startsWith('02'))return s.slice(0,2)+'-'+s.slice(2,6)+'-'+s.slice(6);
  if(s.length===10&&s.startsWith('0'))return s.slice(0,3)+'-'+s.slice(3,6)+'-'+s.slice(6);
  const m=String(raw).match(/(\d{2,3})-(\d{3,4})-(\d{4})/);
  if(m)return m[0];
  if(s.length===8)return '010-'+s.slice(0,4)+'-'+s.slice(4);
  return s.length>=10?s.slice(0,3)+'-'+s.slice(3,7)+'-'+s.slice(7):'';
}
/* 생년월일 정규화 — 다양한 입력 형식을 NEIS 표준 "YYYY.MM.DD." 로 통일 */
function _parseBirthDate(bv){
  const _fmt=(y,m,d)=>y+'.'+String(m).padStart(2,'0')+'.'+String(d).padStart(2,'0')+'.';
  if(typeof bv==='number'){
    if(bv>30000&&typeof XLSX!=='undefined'){const d=XLSX.SSF.parse_date_code(bv);return _fmt(d.y,d.m,d.d);}
    const bs=String(bv);if(bs.length===8)return _fmt(bs.slice(0,4),bs.slice(4,6),bs.slice(6,8));
    if(bs.length===6){const y2=parseInt(bs.slice(0,2),10);return _fmt((y2<=50?'20':'19')+bs.slice(0,2),bs.slice(2,4),bs.slice(4,6));}
    return '';
  }
  bv=String(bv).trim().replace(/\.\s*$/,''); /* 끝의 점 제거 후 재구성 */
  const bm4=bv.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if(bm4)return _fmt(bm4[1],bm4[2],bm4[3]);
  const bm2=bv.match(/(\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  if(bm2){const by=parseInt(bm2[1],10);return _fmt((by<=50?'20':'19')+bm2[1],bm2[2],bm2[3]);}
  const bs2=bv.replace(/[^0-9]/g,'');
  if(bs2.length===8)return _fmt(bs2.slice(0,4),bs2.slice(4,6),bs2.slice(6,8));
  if(bs2.length===6){const by2=parseInt(bs2.slice(0,2),10);return _fmt((by2<=50?'20':'19')+bs2.slice(0,2),bs2.slice(2,4),bs2.slice(4,6));}
  return '';
}
/* 정규화된 birth 문자열에서 연·월·일 분리 — "YYYY.MM.DD." / "YYYY-MM-DD" 양쪽 호환 */
function _splitBirthYMD(birth){
  if(!birth)return null;
  const m=String(birth).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if(!m)return null;
  return [parseInt(m[1],10),parseInt(m[2],10),parseInt(m[3],10)];
}
function _validateStudentRow(r,rowNum,hdr){
  const errors=[];
  const _validLevels=['유','초','중','고','대'];
  const _slvMap={'유치원':'유','초등':'초','초등학교':'초','중등':'중','중학교':'중','고등':'고','고등학교':'고','대학':'대','대학교':'대','전공':'대'};
  /* 이름 필수 */
  const name=hdr.hName?String(r[hdr.hName]||'').trim():'';
  if(!name){return null;} /* 빈 행 스킵 */
  /* 학교급: 한 글자인지 확인 */
  const levelRaw=hdr.hSchoolLevel?String(r[hdr.hSchoolLevel]||'').trim():'';
  const level=_slvMap[levelRaw]||levelRaw;
  if(level&&_validLevels.indexOf(level)===-1) errors.push('학교급에 쓴 글자가 한 글자인지 확인해주세요. (현재: "'+levelRaw+'")');
  /* 학년, 반, 번호: 숫자만 */
  const gradeRaw=hdr.hGrade?r[hdr.hGrade]:'';
  const gradeNum=parseInt(gradeRaw,10);
  const clsRaw=hdr.hCls?r[hdr.hCls]:'';
  const numRaw=hdr.hNum?r[hdr.hNum]:'';
  const numNum=parseInt(numRaw,10);
  const _numErrors=[];
  if(gradeRaw!==''&&gradeRaw!=null&&(isNaN(gradeNum)||gradeNum<=0)) _numErrors.push('학년="'+gradeRaw+'"');
  /* 반은 숫자/한글(가람·나래) 모두 허용 — 숫자 강제 검증 제거 (사용자 요청 2026-05-28). */
  if(level!=='유'&&numRaw!==''&&numRaw!=null&&isNaN(numNum)) _numErrors.push('번호="'+numRaw+'"');
  if(_numErrors.length>0) errors.push('학년, 번호 중 숫자가 아닌 것이 입력되지 않았는지 확인해주세요. ('+_numErrors.join(', ')+')');
  /* 번호 필수 (유치원 제외) — 양식이 '번호(필수)' 로 변경됨 (사용자 요청 2026-06-09).
     번호가 비어 있으면 학생 식별·매칭(동일/신규/미매칭)이 부정확해지므로 필수로 안내. */
  if(level!=='유' && (numRaw===''||numRaw==null)) errors.push('번호는 필수 입력 항목입니다 — 비어 있습니다.');
  /* 성별: 남 또는 여 */
  let gender=hdr.hGender?String(r[hdr.hGender]||'').trim():'';
  if(gender){
    if(gender==='남자')gender='남';
    if(gender==='여자'||gender==='녀자'||gender==='녀')gender='여';
    if(gender!=='남'&&gender!=='여') errors.push('성별은 남 또는 여만 입력 바랍니다. (현재: "'+gender+'")');
  }
  /* 생년월일 */
  const birthRaw=hdr.hBirth?r[hdr.hBirth]:'';
  const birth=_parseBirthDate(birthRaw);
  if(birthRaw&&!birth) errors.push('생년월일 형식이 0000.00.00. 인지 확인바랍니다. 나이스(NEIS) 기본학적관리에서 다운로드 받으면 나오는 방식이 0000.00.00. 입니다. (현재: "'+birthRaw+'")');
  if(birth){const ymd=_splitBirthYMD(birth);if(ymd){const [bYear,bMonth,bDay]=ymd;
    if(bYear<1950||bYear>2030)errors.push('생년월일 연도가 비정상입니다. (현재: '+bYear+'년)');
    if(bMonth<1||bMonth>12)errors.push('생년월일 월이 1~12 범위를 벗어났습니다. (현재: '+bMonth+'월)');
    if(bDay<1||bDay>31)errors.push('생년월일 일이 1~31 범위를 벗어났습니다. (현재: '+bDay+'일)');}}
  /* 연락처 */
  const contactRaw=hdr.hGuardianContact?String(r[hdr.hGuardianContact]||'').trim():'';
  const guardianRaw=hdr.hGuardian?String(r[hdr.hGuardian]||'').trim():'';
  const phone=_normalizePhone(contactRaw)||_normalizePhone(guardianRaw)||'';
  if((contactRaw||guardianRaw)&&!phone) errors.push('연락처 형식이 올바르지 않습니다. 010-0000-0000 또는 01000000000 형식으로 입력 바랍니다. (현재: "'+(contactRaw||guardianRaw)+'")');
  return {name:name,level:level,department:hdr.hDepartment?String(r[hdr.hDepartment]||'').trim():'',grade:gradeNum||0,cls:normalizeClassInput(clsRaw),num:numNum||0,gender:(gender==='녀'||gender==='녀자'||gender==='여자')?'여':(gender==='남자'?'남':gender),birth:birth,guardianType:extractGuardianLabel(guardianRaw,contactRaw),guardianContact:phone,major:hdr.hMajor?String(r[hdr.hMajor]||'').trim():'',errors:errors,rowNum:rowNum};
}
export function handleStudentFile(file){
  if(!file)return;
  setPeopleUploadFileName('student',file.name||'선택된 파일');
  /* studentValidationArea 가 인원관리 모달과 설정 탭 두 곳에 같은 id 로 존재 →
     getElementById 는 먼저 나온 하나만 잡아, [확인] 후 설정 패널이 렌더되면 숨은 쪽에 그려지는 버그.
     인원관리 모달이 열려 있으면 그 안의 영역을 우선 사용 (2026-06-07). */
  const _apModal=document.getElementById('addPersonModal');
  const vArea=(_apModal&&_apModal.querySelector('#studentValidationArea'))||document.getElementById('studentValidationArea');
  if(vArea){vArea.style.display='none';vArea.innerHTML='';}
  /* 새 파일 업로드 시 이전 상태 메시지(저장 오류 등)를 지운다 — 오류 메시지는 자동 숨김이 안 돼
   *  비교 결과 화면에 "저장 오류: 저장 실패" 잔상으로 남던 문제 (사용자 보고 2026-07-15). */
  { const _um=document.getElementById('studentUploadMsg'); if(_um){ if(_um._autoHideTimer)clearTimeout(_um._autoHideTimer); _um.style.display='none'; _um.textContent=''; } }
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
      /* 시트 선택: '학생 명단' 이름이 있으면 우선, 없으면 첫 시트 */
      const dataSheetName=wb.SheetNames.find(function(n){return n.match(/학생\s*명단|student/i);});
      const dataSheet=dataSheetName?wb.Sheets[dataSheetName]:wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(dataSheet,{defval:''});
      if(!rows.length){showUploadMsg('studentUploadMsg','시트에 데이터가 없습니다.','error');return;}
      const staffList=S.people.filter(function(s){return s.type==='staff';});
      const headers=Object.keys(rows[0]);
      const hdr={
        hSchoolLevel:headers.find(function(h){return h.match(/학교\s*급|학교급/);}),
        hDepartment:headers.find(function(h){return h.match(/학과|과명/);}),
        hGrade:headers.find(function(h){return h.match(/학년/);}),
        hCls:headers.find(function(h){return h.match(/반/);}),
        hNum:headers.find(function(h){return h.match(/번호/);}),
        hName:headers.find(function(h){return h.match(/성명|이름|name/i);}),
        hGender:headers.find(function(h){return h.match(/성별/);}),
        hBirth:headers.find(function(h){return h.match(/생년|생일|birth/i);}),
        hGuardian:headers.find(function(h){return h.match(/주\s*보호자|보호자/i);}),
        hGuardianContact:headers.find(function(h){return h.match(/주\s*보호자\s*연락처|보호자\s*연락처|연락처|전화/i);}),
        hMajor:headers.find(function(h){return h.match(/전공$/);})
      };
      if(!hdr.hName){showUploadMsg('studentUploadMsg','이름 열을 찾을 수 없습니다. (성명/이름 헤더 필요)','error');return;}
      /* 양식 정합성 검증 — 학생 최적화 양식에는 학년 열이 반드시 있어야 함.
       *  교직원 양식(직위·이름·성별·생년월일만 있는 시트) 이 잘못 올라간 경우 차단.
       *  학년 없이 학생을 식별·매칭·진급 처리할 방법이 없으므로 업로드 자체를 거부. */
      if(!hdr.hGrade){
        showUploadMsg('studentUploadMsg','이 파일은 학생 양식이 아닙니다 — "학년" 열을 찾을 수 없습니다. 학생 일괄 등록은 학생 최적화 양식을 사용하세요.','error');
        return;
      }
      /* 1단계: 검증 */
      const validated=[];const allErrors=[];
      rows.forEach(function(r,i){
        const result=_validateStudentRow(r,i+2,hdr); /* +2: 엑셀 행 번호 (1=헤더) */
        if(!result)return; /* 빈 행 */
        validated.push(result);
        if(result.errors.length>0)allErrors.push(result);
      });
      /* 2단계: 검증 결과 표시 — 경고만 띄우고 업로드는 진행 */
      if(allErrors.length>0){
        if(vArea){
          let vh='<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:8px">\u26A0 '+allErrors.length+'건의 경고 (업로드는 진행됩니다)</div>';
          allErrors.forEach(function(item){
            vh+='<div style="padding:6px 8px;margin-bottom:4px;border-left:3px solid #f59e0b;background:rgba(245,158,11,0.06);border-radius:4px">';
            vh+='<div style="font-size:11px;font-weight:700;color:var(--t1)">'+item.rowNum+'행: '+escHtml(item.name)+'</div>';
            item.errors.forEach(function(err){
              vh+='<div style="font-size:10px;color:#d97706;margin-top:2px">\u2022 '+escHtml(err)+'</div>';
            });
            vh+='</div>';
          });
          vArea.innerHTML=vh;
          vArea.style.display='block';
        }
        /* 치명적 필드 누락만 차단 — 이름 필수 */
      }
      /* 3단계: 지능 매칭 — 학년·반·번호·생년월일·성별 기반으로 DB와 비교 */
      const newStudents=validated.map(function(v){
        return{name:v.name,grade:v.grade,class_num:v.cls,student_num:v.num,gender:v.gender,birth_date:v.birth,guardian_type:v.guardianType,guardian_contact:v.guardianContact,level:v.level||'',department:v.department||''};
      });
      const yr=String(_academicYear());
      const _reload=(typeof _reloadStudentsFromDB==='function')?_reloadStudentsFromDB():Promise.resolve();
      _reload.catch(function(){}).then(function(){
        _smartCompareStudents(vArea, newStudents, yr);
      }).catch(function(ex){
        /* 비교/렌더 단계 오류가 조용히 삼켜져 '아무것도 안 뜸' 이 되지 않도록 표면화 (2026-06-06) */
        console.error('[student-upload] 비교 처리 오류:', ex);
        showUploadMsg('studentUploadMsg','업로드 처리 오류: '+((ex&&ex.message)||ex),'error');
        bus.emit('toast:show',{text:'업로드 처리 오류: '+((ex&&ex.message)||ex)});
      });
    }catch(ex){showUploadMsg('studentUploadMsg','파일 읽기 오류: '+ex.message,'error');}
  };
  reader.readAsArrayBuffer(file);
}
/* ── 지능 매칭: 이름+성별 1차 매칭, 생년월일 tiebreaker (빈 생년월일 대응) ──
 * 1차 식별자: 이름 + 성별 (불변)
 * 2차 tiebreaker: 생년월일 (있을 때만, 동명이인 구분용)
 * 변경 필드: 학년(+1 진급) · 반 · 번호 (매년 재배치)
 *
 * 분류:
 *  - identical:  이름+성별 유일 매칭 + 학년·반·번호 모두 그대로(생년월일 정합)
 *  - updated:    이름+성별 매칭 + 학년이 다름(정상 진급) 또는 반·번호 둘 다 변경 → uid 보존 갱신
 *  - unmatched:  이름+성별이 매칭되는데 같은 학년에서 반·번호 중 '정확히 하나만' 다른 경우 + 동명이인 자동특정 불가.
 *               (학년이 다르면 진급으로 보고 제외.) → 보관 후 '🔗 수동 매칭'(요보호식 모달).
 *               ※ 이름이 아예 매칭 안 되면 위치(자리)가 겹쳐도 그냥 신규 — 반·학년 단위 신규 업로드 보호
 *                 (사용자 요청 2026-06-05: 위치충돌 기반 미매칭 폐지).
 *  - newOnes:    이름+성별 매칭 전혀 없음 → 신규 (전학생/새 반/새 학년 일괄 업로드).
 */
function _smartCompareStudents(vArea, newStudents, yr){
  /* 올해 비활성(일괄 삭제·미등록 처리)된 학생도 매칭 후보에 포함 — 전체 삭제 후 재업로드 시
     전원 '신규'로 새 uid 가 발급돼 과거 보건일지 이력과 단절되던 버그 수정 (교직원과 동일, 사용자 보고 2026-06-12).
     같은 자리·같은 이름이면 옛 uid 로 자동 재연결(재등록) → upsert 가 is_enrolled=1 로 복귀시킴. */
  const _activeStudents=(S.people||[]).filter(function(s){return s.type==='student';});
  const _fetchInactive=(window.electronAPI&&window.electronAPI.studentsGetAllIncludeLeft)
    ? window.electronAPI.studentsGetAllIncludeLeft(yr).then(function(res){
        const all=(res&&res.success&&Array.isArray(res.data))?res.data:[];
        const activeUids={}; _activeStudents.forEach(function(s){activeUids[String(s.uid||s.id)]=true;});
        return all.filter(function(s){return s&&!activeUids[String(s.uid||s.id)];});
      }).catch(function(){return [];})
    : Promise.resolve([]);
  /* 직전 학년도(yr-1) 학생 — 3/1 신학년도 업로드 시 '진급' 매칭 후보 (사용자 지시 2026-06-18).
     올해 매칭이 안 된 학생을 직전 학년도에서 이름으로 찾아 진급(영구 uid 보존)으로 잡는다.
     첫 해(직전연도 데이터 없음)면 빈 배열 → 진급 0. */
  const _priorYr=String((Number(String(yr==null?'':yr).replace(/[^0-9]/g,''))||0)-1);
  const _fetchPrior=(window.electronAPI&&window.electronAPI.studentsGetAllIncludeLeft&&_priorYr!=='-1'&&_priorYr!=='0')
    ? window.electronAPI.studentsGetAllIncludeLeft(_priorYr).then(function(res){
        return (res&&res.success&&Array.isArray(res.data))?res.data:[];
      }).catch(function(){return [];})
    : Promise.resolve([]);
  Promise.all([_fetchInactive, _fetchPrior]).then(function(_r){
    const _inactiveStudents=_r[0]||[], _priorStudents=_r[1]||[];
    /* 비활성 행에 표시 플래그 — 매칭 화면에서 "삭제했던 인원과 기록 연결" 설명 구분용 */
    const _marked=_inactiveStudents.map(function(s){return Object.assign({},s,{_inactive:true});});
    _smartCompareStudentsCore(vArea, newStudents, yr, _activeStudents.concat(_marked), _priorStudents);
  });
}
function _smartCompareStudentsCore(vArea, newStudents, yr, dbStudents, priorStudents){
  if(vArea) _pendingUploadSet('student', yr, newStudents); /* 보류 저장(확인/취소 전까지) — 닫거나 종료해도 재진입 시 다시 표시 */
  /* 성별은 매칭 키에서 제외 — 이름만으로 그룹/매칭 (사용자 지시 2026-06-13: 성별 빼기). 함수명은 호환 위해 유지. */
  const _nameGenderKey=function(name,gender){
    return String(name||'').trim();
  };
  const _dbBirth=function(d){return (d.birth||d.birth_date||'').trim();};

  /* DB 학생을 이름+성별별로 그룹핑 (동명이인 대응) */
  const dbByNameGender={};
  dbStudents.forEach(function(s){
    const k=_nameGenderKey(s.name,s.gender);
    if(!dbByNameGender[k])dbByNameGender[k]=[];
    dbByNameGender[k].push(s);
  });

  /* 미매칭 엔트리 — ex(엑셀 행, 명단 표시용) + entry(수동매칭 모달용, cls/num/birth 키) + conflict 설명 */
  const _mkUnmatched=function(ex, conflict){
    return { ex:ex, conflict:conflict, entry:{
      name:ex.name||'', grade:ex.grade, cls:ex.class_num, num:ex.student_num,
      level:ex.level||'', department:ex.department||'', gender:ex.gender||'',
      birth:ex.birth_date||'', conflict:conflict } };
  };

  const identical=[], updated=[], unmatched=[], newOnes=[];
  const claimedDbUids=new Set(); /* 이미 엑셀 row에 매칭된 DB uid (중복 매칭 방지용) */

  const _dbCls=function(d){return d.cls!=null?d.cls:(d.class_num!=null?d.class_num:'');};
  const _dbNum=function(d){return d.num!=null?d.num:(d.student_num!=null?d.student_num:'');};
  const _eq=function(a,b){return String(a==null?'':a).trim()===String(b==null?'':b).trim();};
  const _dbDesc=function(d){
    const c=_dbCls(d), n=_dbNum(d);
    return (d.name||'')
      + (String(d.department||'').trim()!==''?' '+String(d.department).trim():'')
      + (d.grade!=null&&String(d.grade).trim()!==''?' '+d.grade+'학년':'')
      + (String(c).trim()!==''?' '+c+'반':'')
      + (String(n).trim()!==''?' '+n+'번':'');
  };
  /* 학과+학년+반+번호 → DB 학생: 위치 충돌(같은 자리·다른 이름) 검출용. 학과 포함(다른 학과 같은 자리 오탐 방지). */
  const dbByPos={};
  dbStudents.forEach(function(s){
    const d=String(s.department==null?'':s.department).trim();
    const g=String(s.grade==null?'':s.grade).trim();
    const c=String(_dbCls(s)).trim();
    const n=String(_dbNum(s)).trim();
    if(g===''||c===''||n===''||n==='0')return;
    const k=d+'|'+g+'|'+c+'|'+n;
    if(!dbByPos[k])dbByPos[k]=s;
  });
  /* ── 분류: 자리(학과+학년+반+번호)를 이름보다 먼저 판정 (사용자 요청 2026-06-09) ──
   *  · 자리가 차 있으면: 이름+성별까지 같으면 그 학생(동일), 이름이나 성별이 다르면 → 미매칭.
   *  · 자리가 비어있으면(또는 번호 없음): 이름+성별 기반 — 학년 다르면 진급, 같으면 신규.
   *  예) 1-1-2 자리에 김대민(남)이 있는데 김대연(여) 1-1-2 업로드 → (이름이 다른 자리이므로) 미매칭.
   *      1-1-10 양정현(남) 자리에 오발탄(남) 1-1-10 → 미매칭. */
  newStudents.forEach(function(ex){
    const exBirth=(ex.birth_date||'').trim();
    const _exName=String(ex.name||'').trim();

    /* 1) 자리 우선 — 학과+학년+반+번호 (번호 0/빈값은 자리매칭 제외) */
    const _d=String(ex.department==null?'':ex.department).trim();
    const _g=String(ex.grade==null?'':ex.grade).trim();
    const _c=String(ex.class_num==null?'':ex.class_num).trim();
    const _n=String(ex.student_num==null?'':ex.student_num).trim();
    if(_g!==''&&_c!==''&&_n!==''&&_n!=='0'){
      const occ=dbByPos[_d+'|'+_g+'|'+_c+'|'+_n];
      if(occ){
        const _sameName=String(occ.name||'').trim()===_exName;
        if(_sameName){
          /* 같은 자리 + 이름 일치 → 그 학생 (동일, 세부 변동 있으면 저장 시 갱신). 성별은 매칭에서 제외 (사용자 지시 2026-06-13).
             자리로 이미 특정됐으므로 uid 를 실어 보내 백엔드가 이름만으로 재매칭·동명이인 보류하지 않게 함 (사용자 요청 2026-06-09). */
          claimedDbUids.add(occ.uid||occ.id);
          identical.push(Object.assign({}, ex, {uid: occ.uid||occ.id, _revive: !!occ._inactive}));
          return;
        }
        /* 같은 자리인데 이름이 다름 → 다른 사람이 그 자리에 있음 → 미매칭 */
        unmatched.push(_mkUnmatched(ex, '기존: '+_dbDesc(occ)+' · 이름 다름'));
        return;
      }
      /* 자리 비어있음 → 아래 이름 기반 분류 */
    }

    /* 2) 자리 비었거나 번호 없음 → 이름+성별 기반 */
    const candidates=dbByNameGender[_nameGenderKey(ex.name,ex.gender)]||[];
    if(candidates.length===0){ newOnes.push(ex); return; }

    /* 2-a) 번호 없는 이관 — 학과+학년+반으로 좁혀 '같은 반 동명이인'만 가린다 (사용자 요청 2026-06-09).
       · 그 반에 같은 이름 1명 → 반이 특정하므로 그 학생으로 연결 (다른 반에 동명이인이 있어도 모달 안 뜸)
       · 그 반에 같은 이름 2명+ → 진짜 같은 반 동명이인 → 신규(uid 없음)로 보내 백엔드 동명이인 보류 매칭
       번호가 있으면 위 자리매칭에서 처리되므로, 여기는 번호가 없을 때만 적용(한흑호=번호만 다른 케이스는 건드리지 않음). */
    if((_n===''||_n==='0') && _g!=='' && _c!==''){
      const inClass=candidates.filter(function(d){
        return _eq(d.grade, ex.grade) && _eq(_dbCls(d), ex.class_num)
          && String(d.department==null?'':d.department).trim()===_d;
      });
      if(inClass.length===1){
        claimedDbUids.add(inClass[0].uid||inClass[0].id);
        identical.push(Object.assign({}, ex, {uid: inClass[0].uid||inClass[0].id, _revive: !!inClass[0]._inactive}));
        return;
      }
      if(inClass.length>=2){ newOnes.push(ex); return; }
      /* inClass===0 → 그 반엔 같은 이름이 없음 → 아래 일반 이름기반 처리(이동/신규) */
    }

    /* 자리(학교급+학과+학년+반+번호)가 비어 여기까지 옴 → 올해 같은 이름이 다른 학년·반에 있든, 같은 반에
       번호만 다르든 모두 '신규'. (사용자 지시 2026-06-21: 자리만 안 겹치면 동명이인 여부와 무관하게 신규.
       점유 충돌은 위 자리매칭에서 이미 미매칭 처리됨. 올해 데이터로는 절대 진급을 만들지 않는다 —
       진급은 아래 '진급 후처리'가 직전 학년도(priorStudents) 후보로만 판정.) */
    newOnes.push(ex);
  });

  /* ── 진급 후처리 (사용자 지시 2026-06-18: 3/1 신학년도 업로드 시 직전 학년도 학생을 진급으로 잡는다) ──
     올해 매칭이 안 된 '신규' 후보를 직전 학년도(priorStudents)에서 이름으로 찾아, 1명으로 특정되면 진급으로 승격한다.
     진급은 그 학생의 영구 uid 를 실어보내(updated) 학년 간 보건일지 이력·플래그 승계를 유지한다(upsert 가 uid 로 처리).
     · 직전 학년도 후보 0명 → 진짜 신규 유지.  · 2명+(동명이인) → 자동 결정 불가 → 신규 유지(수동/백엔드 처리).
     · 생년월일이 양쪽에 있고 다르면 다른 사람 → 신규 유지.  · priorStudents 없으면(첫 해) 동작 안 함 → 진급 0. */
  if(Array.isArray(priorStudents) && priorStudents.length && newOnes.length){
    const _priorByName={};
    priorStudents.forEach(function(s){
      const k=String(s.name||'').trim(); if(!k)return;
      (_priorByName[k]=_priorByName[k]||[]).push(s);
    });
    const _claimedPrior=new Set();
    const _stillNew=[];
    newOnes.forEach(function(ex){
      let cands=(_priorByName[String(ex.name||'').trim()]||[]).filter(function(d){
        const u=d.uid||d.id;
        return !_claimedPrior.has(u) && !claimedDbUids.has(u);
      });
      /* ── 학년-1 게이트 (사용자 지시 2026-08-26) ──
         진급은 반드시 한 학년씩이므로 '올해 3학년'의 작년은 2학년뿐이다.
         작년 1학년·4학년 동명이인은 명백히 다른 사람이라 진급 후보에서 제외한다.
         (옛 동작: 이름으로 1명만 잡히면 학년을 보지 않고 진급 처리 → 그 사람의 uid 를 실어보내
          백엔드 검증까지 우회하며 졸업생·타학년 동명이인의 보건일지가 엉뚱한 학생에게 붙었다.)
         작년 학년 값이 없는 후보는 판정 불가로 보아 게이트 통과자가 없을 때만 폴백으로 쓴다. */
      const _exG=parseInt(ex.grade,10);
      if(!isNaN(_exG) && _exG>0){
        const _gated=cands.filter(function(d){ const g=parseInt(d.grade,10); return !isNaN(g) && g===_exG-1; });
        const _unknown=cands.filter(function(d){ return isNaN(parseInt(d.grade,10)); });
        cands=_gated.length?_gated:_unknown;
      }
      /* 성별로 좁힘 — 어느 한쪽이 비어 있으면 판정 불가로 보아 살려둔다(옛 데이터·미입력 보호) */
      if(cands.length>1){
        const _exGen=String(ex.gender||'').trim();
        if(_exGen){
          const _sg=cands.filter(function(d){ const dg=String(d.gender||'').trim(); return !dg || dg===_exGen; });
          if(_sg.length) cands=_sg;
        }
      }
      if(cands.length===1){
        const pd=cands[0];
        const exB=(ex.birth_date||'').trim(), pdB=_dbBirth(pd);
        if(exB && pdB && exB!==pdB){ _stillNew.push(ex); return; } /* 생년월일 다름 → 다른 사람 → 신규 */
        _claimedPrior.add(pd.uid||pd.id);
        updated.push({excel:ex, db:pd}); /* 진급: 직전 학년도 uid 보존 */
      } else {
        _stillNew.push(ex); /* 0명(진짜 신규) 또는 2명+(동명이인) → 신규 */
      }
    });
    newOnes.length=0; Array.prototype.push.apply(newOnes, _stillNew);
  }
  /* 엑셀에 없는 DB 학생(missing)은 더 이상 계산·표시하지 않는다 —
     업로드 목록에 없으면 upsert 대상이 아니므로 DB 에 그대로 자동 보존된다.
     (사용자 요청 2026-06-05: '엑셀에 없음(전학/자퇴 확인)' 섹션 제거) */
  const _totalUploaded=identical.length+(updated?updated.length:0)+unmatched.length+newOnes.length;
  if(_totalUploaded===0){
    showUploadMsg('studentUploadMsg','업로드할 학생이 없습니다.','error');
    return;
  }
  /* 항상 비교 팝업을 띄워 [확인]으로 저장 (사용자 요청 2026-06-05) */
  _showSmartCompareGUI(vArea,{identical:identical,updated:updated,unmatched:unmatched,newOnes:newOnes,all:newStudents,yr:yr});
}

/* 호버 미니 팝업 — 일반일지 표 셀 호버(_symShowTip)와 동일한 시안 톤 스타일 (사용자 요청 2026-06-07).
   비활성 [확인] 버튼에 커서를 올리면 "업로드하거나 변경할 내용이 없습니다" 를 이 팝업으로 표시. */
let _peopleTipEl=null;
function _peopleShowTip(anchor,text){
  _peopleHideTip();
  const tip=document.createElement('div');
  tip.style.cssText='position:fixed;z-index:15000;background:var(--card);border:1px solid var(--cyan);border-radius:10px;padding:7px 11px;font-size:10px;font-weight:600;color:var(--t1);white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,0.22);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s ease, transform .15s ease';
  tip.textContent=text;
  document.body.appendChild(tip);
  const rect=anchor.getBoundingClientRect();
  const tw=tip.offsetWidth, th=tip.offsetHeight;
  let left=rect.left+rect.width/2-tw/2;
  if(left<4)left=4; if(left+tw>window.innerWidth-4)left=window.innerWidth-tw-4;
  let top=rect.bottom+6;
  if(top+th>window.innerHeight-4)top=rect.top-th-6;
  tip.style.left=left+'px'; tip.style.top=top+'px';
  _peopleTipEl=tip;
  requestAnimationFrame(function(){tip.style.opacity='1';tip.style.transform='translateY(0)';});
}
function _peopleHideTip(){
  if(_peopleTipEl){ const el=_peopleTipEl; _peopleTipEl=null; el.style.opacity='0'; el.style.transform='translateY(4px)'; setTimeout(function(){if(el.parentNode)el.remove();},150); }
}

/* ── 지능 비교 결과 GUI ── */
function _showSmartCompareGUI(vArea, res){
  if(!vArea)return;
  const {identical,updated,unmatched,newOnes,all,yr}=res;
  /* 미매칭(학년+반+번호는 같은데 이름 다름 · 동명이인)은 인라인 해결하지 않고
     보관 후 요보호식 '🔗 수동 매칭' 버튼/모달로 처리한다 (사용자 요청 2026-06-05). */
  let _umPersisted=false;
  const _umEntries=function(){ return (unmatched||[]).map(function(u){return u.entry;}); };
  const _persistUnmatched=function(){
    if(_umPersisted)return;
    const e=_umEntries();
    if(e.length && typeof window!=='undefined' && window._stuUnmatchedAdd){ window._stuUnmatchedAdd(e); }
    _umPersisted=true;
  };
  /* 수동 매칭 모달에서 항목이 해결(매칭/신규 등록/삭제)되면 비교 팝업도 즉시 동기화 —
   * 보관함(localStorage)에서 사라진 항목을 unmatched·명단 표에서 제거하고 재렌더 (미매칭 칩·안내 박스·버튼 카운트 갱신).
   * (사용자 보고 2026-06-12: 신규 등록해도 "미매칭 1명"이 그대로) */
  const _umRowKey=function(en){ return [String(en.name||'').trim(), en.grade||'', String(en.cls||''), en.num||''].join('|'); };
  if(typeof window!=='undefined'){
    window._smartCompareSyncUnmatched=function(){
      try{
        if(!_umPersisted)return;   /* 아직 보관 전이면 보관함과 비교 불가 */
        let stored=[]; try{ stored=JSON.parse(localStorage.getItem('ec_student_unmatched_'+String(_academicYear()))||'[]')||[]; }catch(_){}
        const keep={}; stored.forEach(function(e){ keep[_umRowKey(e)]=true; });
        let changed=false;
        for(let i=unmatched.length-1;i>=0;i--){
          if(!keep[_umRowKey(unmatched[i].entry)]){
            const _ex=unmatched[i].ex;
            for(let j=_roster.length-1;j>=0;j--){ if(_roster[j].cat==='미매칭'&&_roster[j].ex===_ex){_roster.splice(j,1);} }
            unmatched.splice(i,1); changed=true;
          }
        }
        if(changed&&vArea&&vArea.style.display!=='none')_render();
      }catch(_){}
    };
  }

  /* ── 표시용 보조 (사용자 요청 2026-06-05) ──
     · 학교급: 업로드 명단에 학교급이 2종 이상일 때만 컬럼 노출 (1종이면 숨김)
     · 학과: 업로드 명단에 학과가 한 명이라도 있으면 컬럼 노출 (학과 있는 고등학교 등) */
  const _SLV_LABEL={'유':'유치원','초':'초등학교','중':'중학교','고':'고등학교','대':'대학교','elementary':'초등학교','middle':'중학교','high':'고등학교','kindergarten':'유치원'};
  const _lvLabel=function(l){l=String(l||'').trim();return _SLV_LABEL[l]||l;};
  const _lvSet={};
  (all||[]).forEach(function(s){const l=String(s.level||'').trim();if(l)_lvSet[l]=1;});
  const showLevel=Object.keys(_lvSet).length>=2;
  const showDept=(all||[]).some(function(s){return String(s.department||'').trim();});
  /* 업로드한 학생 전체 명단 — 구분 태그(동일/진급/신규/미매칭)와 함께 */
  const _CAT={
    '동일':{c:'#16a34a',bg:'rgba(34,197,94,0.12)'},
    '기록 연결':{c:'#059669',bg:'rgba(16,185,129,0.16)'},
    '진급':{c:'#0d9488',bg:'rgba(20,184,166,0.12)'},
    '신규':{c:'#2563eb',bg:'rgba(59,130,246,0.12)'},
    '미매칭':{c:'#e11d48',bg:'rgba(244,63,94,0.12)'}
  };
  /* 기록 연결 = 삭제(보관)했던 인원 재업로드 — 옛 uid 로 자동 연결해 재등록(과거 보건 기록 유지). 교직원과 동일 표기 (사용자 요청 2026-06-12) */
  const _revived=identical.filter(function(s){return s._revive;});
  const _sameNow=identical.filter(function(s){return !s._revive;});
  const _roster=[];
  identical.forEach(function(s){_roster.push({ex:s,cat:s._revive?'기록 연결':'동일'});});
  (updated||[]).forEach(function(u){_roster.push({ex:u.excel,cat:'진급'});});
  newOnes.forEach(function(s){_roster.push({ex:s,cat:'신규'});});
  (unmatched||[]).forEach(function(u){_roster.push({ex:u.ex,cat:'미매칭'});});
  const _gnum=function(v){const n=parseInt(v,10);return isNaN(n)?99999:n;};
  _roster.sort(function(a,b){
    const A=a.ex,B=b.ex;
    if(_gnum(A.grade)!==_gnum(B.grade))return _gnum(A.grade)-_gnum(B.grade);
    const ac=String(A.class_num==null?'':A.class_num),bc=String(B.class_num==null?'':B.class_num);
    if(ac!==bc)return ac<bc?-1:1;
    return _gnum(A.student_num)-_gnum(B.student_num);
  });

  function _render(){
    /* 실제로 업로드/변경할 게 있는지 — 진급(updated)·신규(newOnes)·미매칭(unmatched)·기록 연결(_revived) 중 하나라도 있어야 활성.
       모두 '동일'이면 할 일이 없으므로 [확인] 비활성화 (사용자 요청 2026-06-07).
       기록 연결은 재등록(is_enrolled 복귀) 저장이 필요하므로 반드시 활성에 포함 (2026-06-12) */
    const _act=(updated?updated.length:0)+newOnes.length+(unmatched?unmatched.length:0)+_revived.length;
    const _hasUnmatched=!!(unmatched&&unmatched.length>0);
    let h='<div style="padding:14px;border:2px solid rgba(245,158,11,0.3);border-radius:10px;background:rgba(245,158,11,0.04);margin-top:10px;max-height:70vh;overflow-y:auto">';
    /* 상단 바: 제목 + [취소][확인] 버튼을 맨 위에 고정 (사용자 요청 2026-06-05) */
    h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:3;background:var(--bg2);border-bottom:1px solid var(--bdr);padding:2px 0 8px;margin-bottom:12px">'
      +'<div style="font-size:13px;font-weight:800;color:#f59e0b">⚠ DB/엑셀 지능 비교 결과</div>'
      +'<div style="display:flex;gap:8px;flex-shrink:0">'
      +'<button class="btn btn-outline btn-sm" data-action="smart-cancel" style="font-size:11px">'+(_act===0?'닫기':'취소')+'</button>'
      +'<button class="btn btn-primary btn-sm" id="smartCompareConfirmBtn"'+(_act===0?' data-noact="1"':'')+' style="font-size:11px'+(_act===0?';opacity:0.45;cursor:not-allowed':'')+'">확인 (업로드 진행)</button>'
      +'<button class="btn btn-sm" id="smartStuMatchTopBtn" style="font-size:11px;font-weight:700;border-radius:7px;border:1px solid rgba(6,182,212,0.4);background:rgba(6,182,212,0.1);color:var(--cyan)'+(_hasUnmatched?'':';opacity:0.45;cursor:not-allowed')+'">🔗 수동 매칭'+(_hasUnmatched?' ('+unmatched.length+')':'')+'</button>'
      +'</div></div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">'
      +'<span data-cmptip="이미 있는 인원의 수이며 등록하지 않고 건너뜁니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(34,197,94,0.1);color:#16a34a;font-weight:700">동일 '+_sameNow.length+'명</span>'
      +(_revived.length?'<span data-cmptip="삭제(보관)했던 인원과 같은 자리·이름이 일치하여 기존 보건 기록과 연결한 채로 다시 등록합니다. 과거 방문 이력이 그대로 유지됩니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(16,185,129,0.14);color:#059669;font-weight:700">기록 연결 '+_revived.length+'명</span>':'')
      +'<span data-cmptip="지난 학년도 (3월 1일 이전)에 등록된 인원이 있는 상태에서 3월 1일 이후 인원 등록을 하게 되면 직전 학년도 데이터와 연결을 시도하며 성공한 인원수를 나타냅니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(20,184,166,0.1);color:#0d9488;font-weight:700">학년 진급 '+(updated?updated.length:0)+'명</span>'
      +'<span data-cmptip="등록되지 않은 인원의 수이며 신규로 등록합니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(59,130,246,0.1);color:#2563eb;font-weight:700">신규 '+newOnes.length+'명</span>'
      +'<span data-cmptip="학년, 반, 번호는 일치하지만 이름이 다른 경우 미매칭 처리가 되어 수동 매칭을 요구합니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(244,63,94,0.1);color:#e11d48;font-weight:700">미매칭 '+(unmatched?unmatched.length:0)+'명</span>'
      +'</div>';

    /* 업로드한 학생 명단 전체 — 구분 태그 + (조건부)학교급/학과 포함 (사용자 요청 2026-06-05) */
    h+='<div style="margin-bottom:14px">';
    h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:6px">📋 확인한 학생 명단 <span style="font-size:10px;color:var(--t3);font-weight:600">('+_roster.length+'명)</span></div>';
    h+='<div style="max-height:260px;overflow-y:auto;border:1px solid var(--bdr);border-radius:6px"><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr style="background:var(--bg2);position:sticky;top:0">';
    h+='<th style="border-bottom:1px solid var(--bdr);padding:5px">구분</th>';
    if(showLevel)h+='<th style="border-bottom:1px solid var(--bdr);padding:5px">학교급</th>';
    if(showDept)h+='<th style="border-bottom:1px solid var(--bdr);padding:5px">학과</th>';
    h+='<th style="border-bottom:1px solid var(--bdr);padding:5px">학년</th>'
      +'<th style="border-bottom:1px solid var(--bdr);padding:5px">반</th>'
      +'<th style="border-bottom:1px solid var(--bdr);padding:5px">번호</th>'
      +'<th style="border-bottom:1px solid var(--bdr);padding:5px">이름</th>'
      +'<th style="border-bottom:1px solid var(--bdr);padding:5px">성별</th>'
      +'<th style="border-bottom:1px solid var(--bdr);padding:5px">생년월일</th>'
      +'</tr></thead><tbody>';
    _roster.forEach(function(row){
      const s=row.ex;const cc=_CAT[row.cat]||{c:'#64748b',bg:'rgba(100,116,139,0.12)'};
      h+='<tr>';
      h+='<td style="padding:4px;text-align:center"><span style="display:inline-block;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;color:'+cc.c+';background:'+cc.bg+'">'+row.cat+'</span></td>';
      if(showLevel)h+='<td style="padding:4px;text-align:center">'+escHtml(_lvLabel(s.level))+'</td>';
      if(showDept)h+='<td style="padding:4px;text-align:center">'+escHtml(s.department||'')+'</td>';
      h+='<td style="padding:4px;text-align:center">'+escHtml(s.grade==null||s.grade===''?'-':String(s.grade))+'</td>'
        +'<td style="padding:4px;text-align:center">'+escHtml(s.class_num==null||s.class_num===''?'-':String(s.class_num))+'</td>'
        +'<td style="padding:4px;text-align:center">'+escHtml(s.student_num==null||s.student_num===''?'-':String(s.student_num))+'</td>'
        +'<td style="padding:4px;font-weight:600">'+escHtml(s.name||'')+'</td>'
        +'<td style="padding:4px;text-align:center">'+escHtml(s.gender||'-')+'</td>'
        +'<td style="padding:4px;text-align:center">'+escHtml(s.birth_date||'-')+'</td>';
      h+='</tr>';
    });
    h+='</tbody></table></div></div>';

    /* 미매칭 안내 + 수동 매칭 버튼 — 인라인 자동판단 대신 요보호식 수동 매칭으로 처리 (사용자 요청 2026-06-05) */
    if(unmatched&&unmatched.length>0){
      h+='<div style="margin-bottom:14px;padding:10px 12px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.06);border-radius:8px">';
      h+='<div style="font-size:12px;font-weight:700;color:#d97706;margin-bottom:4px">🔗 미매칭 '+unmatched.length+'명 — 자동 매칭이 안 돼 확인이 필요합니다</div>';
      h+='<div style="font-size:10px;color:var(--t3);margin-bottom:8px;line-height:1.6">반·번호는 같은데 이름이 달라 같은 자리에 다른 사람이 있는 경우입니다(개명·오타·실수 가능). <b>[확인]</b>을 누르면 따로 보관되고, <b>[🔗 수동 매칭]</b>에서 실제 학생에게 연결(정정)하거나 그대로 두면 됩니다.</div>';
      /* 각 인원의 실제 사유(번호 다름/반 다름/이름 다름/동명이인) 표시 — 잘못된 일괄 문구로 인한 혼란 방지 (사용자 요청 2026-06-07) */
      h+='<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:2px">';
      unmatched.forEach(function(u){
        const ex=u.ex||{};
        const _pos=(ex.grade!=null&&String(ex.grade)!==''?ex.grade+'학년 ':'')+(ex.class_num!=null&&String(ex.class_num)!==''?ex.class_num+'반 ':'')+(ex.student_num!=null&&String(ex.student_num)!==''?ex.student_num+'번':'');
        h+='<div style="font-size:10px;color:var(--t2)">• <b>'+escHtml(ex.name||'')+'</b> '+escHtml(_pos)+' — '+escHtml(u.conflict||'확인 필요')+'</div>';
      });
      h+='</div>';
      h+='<div style="font-size:10px;color:var(--t3);margin-top:6px">→ 위 <b>[🔗 수동 매칭]</b> 버튼으로 실제 학생에게 연결하거나, 그대로 두면 됩니다.</div>';
      h+='</div>';
    }

    /* (사용자 요청 2026-06-05) 개명 자동 판단 섹션 제거 — 프로그램이 판단할 일 아님.
       이름+성별 매칭이 없으면 신규로 처리한다. */

    /* (사용자 요청 2026-06-05) '엑셀에 없는 DB 학생' 섹션 제거 —
       업로드 목록에 없는 기존 학생은 자동 보존되므로 별도 확인 불필요. */

    h+='</div>';
    vArea.innerHTML='<div class="compare-panel">'+h+'</div>';
    vArea.style.display='block';
    /* 수동 매칭 버튼(상단 바, 확인 오른편) — 미매칭 있을 때만 활성. 저장+보관 후 수동 매칭 모달 열기. (사용자 요청 2026-06-07) */
    const matchTopBtn=document.getElementById('smartStuMatchTopBtn');
    if(matchTopBtn){
      if(_hasUnmatched){
        matchTopBtn.addEventListener('click',function(){
          /* 수동 매칭은 매칭 모달만 연다 — 절대 저장하지 않음.
           * 옛 동작(_onConfirm 선실행)은 미매칭 1명 확인하려고 눌렀는데 명단 전체가 등록돼버리는 사고 유발
           * (사용자 보고 2026-06-12: "수동 매칭 클릭하니 다른 명단이 다 삽입"). 저장은 [확인] 버튼만 담당.
           * 보류 업로드는 유지 → 매칭 후 재진입하면 비교 팝업이 다시 떠 [확인]으로 저장 가능. */
          _persistUnmatched();
          if(typeof window!=='undefined'){
            if(window._apStuRenderUnmatched)window._apStuRenderUnmatched();
            if(window._apStuUnmatchedModal)setTimeout(window._apStuUnmatchedModal,150);
            else bus.emit('toast:show',{text:'수동 매칭 화면을 열 수 없습니다. 인원 데이터 관리에서 다시 시도하세요.'});
          }
          /* 안내는 토스트 대신 모달 부제목에 — 토스트(z:9999·1.5초)는 모달이 바로 덮어 깜빡하고 사라짐 (사용자 보고 2026-06-12) */
        });
      } else {
        matchTopBtn.addEventListener('mouseenter',function(){_peopleShowTip(this,'수동 매칭할 미매칭 인원이 없습니다');});
        matchTopBtn.addEventListener('mouseleave',_peopleHideTip);
      }
    }
    vArea.querySelectorAll('[data-cmptip]').forEach(function(el){
      el.addEventListener('mouseenter',function(){_peopleShowTip(this,this.getAttribute('data-cmptip'));});
      el.addEventListener('mouseleave',_peopleHideTip);
    });
    const cancelBtn=vArea.querySelector('[data-action="smart-cancel"]');
    if(cancelBtn)cancelBtn.addEventListener('click',function(){_pendingUploadClear('student',res.yr);_peopleHideTip();vArea.style.display='none';vArea.innerHTML='';try{delete window._smartCompareSyncUnmatched;}catch(_){}});
    const confirmBtn=document.getElementById('smartCompareConfirmBtn');
    if(confirmBtn){
      if(_act>0){ confirmBtn.addEventListener('click',_onConfirm); }
      else {
        /* 비활성 — 일반일지 셀 호버와 동일한 시안 미니팝업으로 사유 표시 (사용자 요청 2026-06-07) */
        confirmBtn.addEventListener('mouseenter',function(){_peopleShowTip(this,'업로드하거나 변경할 내용이 없습니다');});
        confirmBtn.addEventListener('mouseleave',_peopleHideTip);
      }
    }
  }

  function _onConfirm(){
    /* 최종 저장 대상 구성:
     *  1) 동일(identical) — DB에 이미 있음, 변경 없음 → 그대로 포함 (멱등)
     *  2) 진급(updated) — 식별자 동일, 학년·반·번호만 변경 → uid 보존하여 업데이트
     *  3) 신규(newOnes) — 포함 (새 uid 발급됨)
     *  · 미매칭(unmatched) — 저장하지 않고 보관 → '🔗 수동 매칭'에서 처리 (사용자 요청 2026-06-05)
     *  · 엑셀에 없는 기존 학생(missing) — upsert 리스트에 없으면 자동 보존
     */
    _pendingUploadClear('student', yr); /* 업로드 진행 → 보류 해제 */
    const finalList=[];
    identical.forEach(function(s){finalList.push(s);});
    (updated||[]).forEach(function(u){
      finalList.push(Object.assign({},u.excel,{uid:u.db.uid||u.db.id}));
    });
    newOnes.forEach(function(s){finalList.push(s);});
    /* 미매칭 보관 + 배너 갱신 (이미 '수동 매칭' 버튼으로 보관했으면 _umPersisted 로 중복 방지) */
    _persistUnmatched();
    if(typeof window!=='undefined' && window._apStuRenderUnmatched) window._apStuRenderUnmatched();
    try{ delete window._smartCompareSyncUnmatched; }catch(_){}
    _saveStudentsToDb(finalList, yr, vArea);
  }

  _render();
}

/* ── 학생 DB/엑셀 비교 GUI (legacy, 사용처 없으면 제거 가능) ── */

/* ══════════════════════════════════════════════════════════
   업로드 되돌리기 — 직전 업로드한 학생/교직원만 삭제
   (실수로 잘못된 파일을 올렸을 때 원복용)
   ══════════════════════════════════════════════════════════ */
const _UP_KEY={student:'_lastStudentUpload',staff:'_lastStaffUpload'};
function _recordUploadSnapshot(type, list){
  try{
    /* 이름·성별·생년월일만 저장 — 최소 식별자 */
    const snap=(list||[]).map(function(s){return{
      name:(s.name||'').trim(),
      gender:(s.gender||'').trim(),
      birth_date:(s.birth_date||s.birth||'').trim(),
      /* 학생인 경우 학년·반·번호도 저장(동명이인 구분용) */
      grade:s.grade,
      class_num:s.class_num!=null?s.class_num:s.cls,
      student_num:s.student_num!=null?s.student_num:s.num
    };});
    localStorage.setItem(_UP_KEY[type]||'_lastUpload', JSON.stringify({at:Date.now(),count:snap.length,list:snap}));
  }catch(e){console.error('[upload-snapshot] 저장 실패:',e);}
  setTimeout(refreshUndoButtons,0);
}
function refreshUndoButtons(){
  ['student','staff'].forEach(function(type){
    const btn=document.getElementById(type==='student'?'btnUndoStudentUpload':'btnUndoStaffUpload');
    if(!btn)return;
    let snap=null;try{snap=JSON.parse(localStorage.getItem(_UP_KEY[type])||'null');}catch(e){}
    if(snap&&snap.list&&snap.list.length>0){
      /* 활성 — 빨간색 */
      btn.disabled=false;
      btn.style.background='rgba(239,68,68,0.12)';
      btn.style.color='#dc2626';
      btn.style.border='1px solid rgba(239,68,68,0.35)';
      btn.style.cursor='pointer';
      btn.title='직전에 업로드한 '+snap.count+'명 삭제 ('+new Date(snap.at).toLocaleString('ko-KR')+')';
    } else {
      /* 비활성 */
      btn.disabled=true;
      btn.style.background='rgba(148,163,184,0.08)';
      btn.style.color='#94a3b8';
      btn.style.border='1px solid rgba(148,163,184,0.2)';
      btn.style.cursor='not-allowed';
      btn.title='업로드 전에는 사용할 수 없습니다.';
    }
  });
}
function undoLastUpload(type){
  let snap=null;try{snap=JSON.parse(localStorage.getItem(_UP_KEY[type])||'null');}catch(e){}
  if(!snap||!snap.list||!snap.list.length){bus.emit('toast:show',{text:'되돌릴 업로드 기록이 없습니다.'});return;}
  const typeLabel=type==='staff'?'교직원':'학생';
  if(!confirm('직전에 업로드한 '+typeLabel+' '+snap.count+'명을 삭제하시겠습니까?\n\n'
    +'⚠️ 해당 인원의 보건일지 기록은 그대로 보존됩니다.\n'
    +'⚠️ 삭제 후에는 되돌릴 수 없습니다.'))return;
  /* 매칭 키: 이름+성별+생년월일 (있으면) — 조합으로 DB의 해당 학생 uid 찾아서 삭제 */
  const toDel=[];
  (S.people||[]).forEach(function(p){
    if(type==='staff'&&p.type!=='staff')return;
    if(type==='student'&&p.type!=='student')return;
    const match=snap.list.find(function(s){
      if(!s.name||s.name!==p.name)return false;
      if(s.gender&&p.gender&&s.gender!==p.gender)return false;
      if(s.birth_date&&(p.birth||p.birth_date)&&s.birth_date!==(p.birth||p.birth_date))return false;
      if(type==='student'){
        if(s.grade!=null&&Number(s.grade)!==Number(p.grade))return false;
        const pCls=p.cls!=null?String(p.cls):String(p.class_num||'');
        const sCls=s.class_num!=null?String(s.class_num):'';
        if(sCls&&pCls&&sCls!==pCls)return false;
      }
      return true;
    });
    if(match)toDel.push(p);
  });
  if(!toDel.length){
    bus.emit('toast:show',{text:'일치하는 인원이 없습니다. 이미 삭제되었거나 정보가 변경됐습니다.'});
    localStorage.removeItem(_UP_KEY[type]);refreshUndoButtons();return;
  }
  let done=0,err=0;
  const promises=toDel.map(function(p){
    if(!window.electronAPI)return Promise.resolve();
    const api=type==='staff'?window.electronAPI.staffDelete:window.electronAPI.studentsDelete;
    if(!api)return Promise.resolve();
    return api(p.uid||p.id).then(function(){done++;}).catch(function(){err++;});
  });
  Promise.all(promises).then(function(){
    localStorage.removeItem(_UP_KEY[type]);
    bus.emit('toast:show',{text:'✅ '+done+'명 삭제 완료'+(err?' ('+err+'건 실패)':'')});
    if(typeof _reloadStudentsFromDB==='function')_reloadStudentsFromDB().then(function(){renderSettingsPanel('people');});
    else renderSettingsPanel('people');
  });
}
/* 외부 접근용 */
if(typeof window!=='undefined'){
  window.undoLastUpload=undoLastUpload;
  window.refreshUndoButtons=refreshUndoButtons;
}
function _saveStudentsToDb(newStudents, yr, vArea){
  function _afterStudentSave(cnt,err){
    const msg=err?('저장 오류: '+(err.message||err)):('✅ '+cnt+'명 업로드 완료');
    showUploadMsg('studentUploadMsg',msg,err?'error':'success');
    bus.emit('toast:show',{text:msg});
    if(err)return;
    /* 업로드 명단 추적 — 취소(undo) 용 식별자 저장 */
    _recordUploadSnapshot('student', newStudents);
    if(vArea){vArea.style.display='none';vArea.innerHTML='';}
    if(typeof _reloadStudentsFromDB==='function')_reloadStudentsFromDB().then(function(){
      renderSettingsPanel('people');
      if(document.getElementById('apStuBody')&&typeof window._apStuAction==='function')window._apStuAction('bulk');
      if(document.getElementById('apStuInline')&&typeof window._apStuInlineRender==='function')window._apStuInlineRender();
      if(document.getElementById('apCareInline')&&typeof window._apCareInlineRender==='function')window._apCareInlineRender();
      if(typeof _pushRosterToRelay==='function')_pushRosterToRelay();
      if(typeof _checkKioskRosterStale==='function')_checkKioskRosterStale();
      /* 새 학년도 명단 업로드 직후 — 동명이인(같은 학교급+학년+이름+성별) 그룹 자동 탐지.
       *  작년에 같은 이름의 학생이 있어 매칭이 필요한 경우만 모달 발동. */
      import('../person-manager/name-dup-matcher.js').then(function(mod){
        if(mod && typeof mod.openNameDupMatcher==='function') mod.openNameDupMatcher({});
      }).catch(function(e){ console.error('[name-dup matcher load]', e); });
    });
    else renderSettingsPanel('people');
  }
  /* 학생 일괄 등록은 동명이인 감지 IPC 우선 — 동명이인 보류건이 있으면 매칭 모달 자동 발동 */
  const useAmbDetect = !!(window.electronAPI && window.electronAPI.studentsImportWithPending);
  if(useAmbDetect){
    window.electronAPI.studentsImportWithPending(newStudents,yr).then(function(res){
      if(!res || res.success===false){return _afterStudentSave(0,new Error((res&&res.error)||'저장 실패'));}
      const ambCount = res.ambiguousCount || 0;
      _afterStudentSave((res.count||0) + ambCount, null);
      /* 보류 건 있으면 모달 자동 발동 */
      if(ambCount > 0){
        setTimeout(function(){
          import('../person-manager/person-manager-view.js').then(function(m){
            if(m && typeof m.openAmbiguousMatchModal === 'function') m.openAmbiguousMatchModal();
          }).catch(function(e){console.error('[amb-modal] import 실패:',e);});
        }, 400);
      }
      /* 동명이인 처리 버튼 상태 갱신 — DOM 갱신 후 */
      setTimeout(function(){
        if(typeof window._refreshAmbBtn === 'function') window._refreshAmbBtn();
      }, 600);
    }).catch(function(err){_afterStudentSave(0,err);});
  } else if(window.electronAPI&&window.electronAPI.studentsSaveAll){
    window.electronAPI.studentsSaveAll(newStudents,yr).then(function(res){
      if(res&&res.success===false)return _afterStudentSave(0,new Error(res.error||'저장 실패'));
      _afterStudentSave(newStudents.length,null);
    }).catch(function(err){_afterStudentSave(0,err);});
  }else{
    showUploadMsg('studentUploadMsg','DB 연결이 없습니다.','error');
    bus.emit('toast:show',{text:'DB 연결이 없습니다.'});
  }
}

export function handleStaffFile(file){
  if(!file)return;
  setPeopleUploadFileName('staff',file.name||'선택된 파일');
  /* 새 파일 업로드 시 이전 상태 메시지(저장 오류 등) 클리어 — 학생과 동일 (사용자 보고 2026-07-15) */
  { const _um=document.getElementById('staffUploadMsg'); if(_um){ if(_um._autoHideTimer)clearTimeout(_um._autoHideTimer); _um.style.display='none'; _um.textContent=''; } }
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
      /* 시트 선택: '교직원 명단' 이름이 있으면 우선, 없으면 첫 시트 */
      const dataSheetName=wb.SheetNames.find(function(n){return n.match(/교직원\s*명단|staff/i);});
      const dataSheet=dataSheetName?wb.Sheets[dataSheetName]:wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(dataSheet,{defval:''});
      if(!rows.length){showUploadMsg('staffUploadMsg','시트에 데이터가 없습니다.','error');return;}
      const headers=Object.keys(rows[0]);
      const hName=headers.find(function(h){return h.match(/성명|이름|name/i);});
      const hPos=headers.find(function(h){return h.match(/직위|position/i);});
      const hGender=headers.find(function(h){return h.match(/성별|gender/i);});
      const hBirth=headers.find(function(h){return h.match(/생년|생일|birth/i);})||'';
      const hFamily=headers.find(function(h){return h.match(/가족|보호자|family|guardian/i);})||'';
      const hFamilyPhone=headers.find(function(h){return h.match(/가족.*연락|보호자.*연락|family.*phone|guardian.*phone|연락처/i);})||'';
      if(!hName){showUploadMsg('staffUploadMsg','이름 열을 찾을 수 없습니다. (성명/이름 헤더 필요)','error');return;}
      /* 양식 정합성 검증 — 교직원 최적화 양식에는 직위 열이 반드시 있어야 함.
       *  학생 양식이 잘못 올라간 경우(학년·반·번호만 있고 직위 없음) 차단.
       *  사용자가 학생 정보를 교직원 테이블에 부어넣어 staff DB 가 오염되는 것을 막음. */
      if(!hPos){
        showUploadMsg('staffUploadMsg','이 파일은 교직원 양식이 아닙니다 — "직위" 열을 찾을 수 없습니다. 교직원 일괄 등록은 교직원 최적화 양식을 사용하세요.','error');
        return;
      }
      /* 부수적 안전망 — 학년 열이 있으면 거의 확실히 학생 양식임. */
      const hStuGrade=headers.find(function(h){return h.match(/학년/);});
      if(hStuGrade){
        showUploadMsg('staffUploadMsg','이 파일은 학생 양식으로 보입니다 — "학년" 열이 감지되었습니다. 교직원 양식을 사용하세요.','error');
        return;
      }
      const newStaff=[];
      rows.forEach(function(r){
        if(!r[hName])return;
        let _g=String(r[hGender]||'').trim();if(_g==='남자')_g='남';if(_g==='여자'||_g==='녀자'||_g==='녀')_g='여';
        newStaff.push({
          name:String(r[hName]).trim(),
          gender:_g,
          position:String(r[hPos]||'').trim(),
          birth_date:hBirth?String(r[hBirth]||'').trim():'',
          family_relation:String(r[hFamily]||'').trim(),
          family_phone:_normalizePhone(r[hFamilyPhone]||'')||String(r[hFamilyPhone]||'').trim()
        });
      });
      const yr=String(_academicYear());
      function _afterStaffSave(cnt,err){
        const msg=err?('저장 오류: '+(err.message||err)):('✅ '+cnt+'명 업로드 완료');
        showUploadMsg('staffUploadMsg',msg,err?'error':'success');
        bus.emit('toast:show',{text:msg});
        if(err)return;
        _recordUploadSnapshot('staff', newStaff);
        if(typeof _reloadStudentsFromDB==='function'){
          _reloadStudentsFromDB().then(function(){
            if(document.getElementById('apStaffBody')){
              if(typeof window._apStaffAction==='function')window._apStaffAction('bulk');
            }
            if(document.getElementById('apStaffInline')&&typeof window._apStaffInlineRender==='function')window._apStaffInlineRender();
            renderSettingsPanel('people');
            /* 교직원 명단 업로드 직후 — 동명이인 자동 탐지 */
            import('../person-manager/name-dup-matcher.js').then(function(mod){
              if(mod && typeof mod.openNameDupMatcher==='function') mod.openNameDupMatcher({});
            }).catch(function(e){ console.error('[name-dup matcher load]', e); });
          });
        } else { renderSettingsPanel('people'); }
      }
      const _doSaveStaff=function(){
        if(window.electronAPI&&window.electronAPI.staffSaveAll){
          window.electronAPI.staffSaveAll(newStaff,yr).then(function(res){
            if(res&&res.success===false)return _afterStaffSave(0,new Error(res.error||'저장 실패'));
            _afterStaffSave(newStaff.length,null);
          }).catch(function(err){_afterStaffSave(0,err);});
        }else{
          /* fallback */
          const studentList=S.people.filter(function(s){return s.type==='student';});
          S.nextId=studentList.length+1;
          newStaff.forEach(function(s){s.id=S.nextId++;s.grade=0;s.cls=0;s.num=0;s.status='normal';s.condition='';s.type='staff';});
          S.people=studentList.concat(newStaff);
          saveStudents({reload:true});
          _afterStaffSave(newStaff.length,null);
        }
      };
      if(!newStaff.length){ showUploadMsg('staffUploadMsg','업로드할 교직원이 없습니다.','error'); return; }
      /* 학생과 동일하게 '지능 비교 결과' 팝업으로 동일/변경/신규를 보여주고 [확인]으로 저장 (사용자 요청 2026-06-07).
         staffValidationArea 도 중복 id 가능성 대비해 인원관리 모달 안의 영역을 우선 사용. */
      const _stfModal=document.getElementById('addPersonModal');
      const _stfVArea=(_stfModal&&_stfModal.querySelector('#staffValidationArea'))||document.getElementById('staffValidationArea');
      void _doSaveStaff; /* 구 단순 저장 경로 — 새 매칭 GUI 가 자체적으로 per-row uid 저장 (보존) */
      _showStaffCompareGUI(_stfVArea, newStaff, yr, _afterStaffSave);
    }catch(ex){
      showUploadMsg('staffUploadMsg','파일 읽기 오류: '+ex.message,'error');
      bus.emit('toast:show',{text:'교직원 파일 읽기 오류: '+ex.message});
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ── 교직원 DB/엑셀 지능 비교 결과 GUI (학생과 동일 톤, 교직원 필드용) ──
 *  동일/변경/신규를 보여주고 [확인]으로 저장. 저장 자체는 staffSaveAll(이름+성별 upsert) — 기존 유지·신규 추가.
 *  (사용자 요청 2026-06-07: 교직원도 학생처럼 지능 비교 후 확인하고 업로드) */
/* ── 교직원 작년 & 올해 매칭 확인 GUI (사용자 요청 2026-06-09) ──
 *  · 올해(현재 학년도)에 이미 같은 이름+성별이 있으면 → 동일(재등록) — 그대로 갱신(uid 보존).
 *  · 작년 명단(yr-1)에 같은 이름+성별이 있으면 → '작년 매칭' 후보 → [계속 재직 / 신규 인원 / 다른 사람] 토글.
 *  · 어디에도 없으면 → 신규.
 *  '학년 진급' 대신 '계속 재직' 용어 사용. */
/* 업로드 비교 GUI 보류 저장 — 업로드 진행/취소 전까지 유지(닫거나 종료해도 재진입 시 다시 표시). 사용자 요청 2026-06-09 */
function _pendingUploadKey(type,yr){ return 'ec_'+type+'_pending_upload_'+String(yr); }
function _pendingUploadSet(type,yr,rows){ try{ localStorage.setItem(_pendingUploadKey(type,yr), JSON.stringify(rows||[])); }catch(_){} }
function _pendingUploadClear(type,yr){ try{ localStorage.removeItem(_pendingUploadKey(type,yr)); }catch(_){} }
function _pendingUploadGet(type,yr){ try{ const a=JSON.parse(localStorage.getItem(_pendingUploadKey(type,yr))||'null'); return (Array.isArray(a)&&a.length)?a:null; }catch(_){ return null; } }

function _showStaffCompareGUI(vArea, newStaff, yr, afterSave){
  const _done=function(cnt,err){ if(typeof afterSave==='function')afterSave(cnt,err); };
  const _save=function(list){
    if(!(window.electronAPI&&window.electronAPI.staffSaveAll)){ _done(0,new Error('저장 기능을 사용할 수 없습니다')); return; }
    window.electronAPI.staffSaveAll(list,yr).then(function(res){
      if(res&&res.success===false)return _done(0,new Error(res.error||'저장 실패'));
      _pendingUploadClear('staff',yr); /* 업로드 진행 완료 → 보류 해제 */
      _done(list.length,null);
    }).catch(function(err){_done(0,err);});
  };
  if(!vArea){ _save(newStaff.map(function(s){return Object.assign({},s,{forceNew:true});})); return; }
  _pendingUploadSet('staff',yr,newStaff); /* 보류 저장(확인/취소 전까지) */
  const _ng=function(g){g=String(g||'').trim().toUpperCase();if(['M','남','남자','MALE','남성'].indexOf(g)>=0)return'M';if(['F','여','여자','FEMALE','여성'].indexOf(g)>=0)return'F';return g;};
  const _sv=function(v){return String(v==null?'':v).trim();};
  /* 직위 → 교원/직원 카테고리 (직원↔교원 전환은 없으므로 학년도 넘어도 안정적인 동명이인 구분 보조). 사용자 요청 2026-06-09
     교원: …교사/…부장 끝, 교장·교감·교원 / 직원: 그 외(행정실장·주무관·계장·실무사·교무행정사·조리사·상담사·행정과장 등) */
  const _staffCat=function(pos){ const p=_sv(pos); if(/교사$/.test(p)||/부장$/.test(p)||p==='교장'||p==='교감'||p==='교원') return '교원'; return '직원'; };
  const lastYr=String(parseInt(yr,10)-1);
  const curStaff=(S.people||[]).filter(function(s){return s&&s.type==='staff';});
  /* 동일 인물 판정 = 이름 + 직위 동시 일치 (사용자 확정 2026-06-13: "직위와 이름이 동시에 중복되지 않으면 무조건 새로 등록한다").
     직위가 다르면(교원·직원 등 동명이인) 절대 합치지 않고 새 인원으로 둔다. */
  const _pkey=function(s){return _sv(s.name)+'::'+_sv(s.position);};
  const curByKey={}; curStaff.forEach(function(s){const k=_pkey(s);(curByKey[k]=curByKey[k]||[]).push(s);});
  const fetchLast=(window.electronAPI&&window.electronAPI.staffGetAll)
    ? window.electronAPI.staffGetAll(lastYr).then(function(res){return (res&&res.success&&Array.isArray(res.data))?res.data:[];}).catch(function(){return [];})
    : Promise.resolve([]);
  /* 올해 비활성(삭제·전출 처리)된 교직원도 매칭 후보로 — 전체 일괄 삭제 후 재업로드 시 같은 사람이
     새 uid 를 받아 과거 보건일지 이력과 단절되던 버그 수정. 이름(+직위) 일치 시 옛 uid 로 자동 재연결(재직 복귀). (사용자 보고 2026-06-12) */
  const fetchCurInactive=(window.electronAPI&&window.electronAPI.staffGetAllIncludeInactive)
    ? window.electronAPI.staffGetAllIncludeInactive(yr).then(function(res){
        const all=(res&&res.success&&Array.isArray(res.data))?res.data:[];
        return all.filter(function(s){return s&&Number(s.is_active)!==1;});
      }).catch(function(){return [];})
    : Promise.resolve([]);
  Promise.all([fetchLast,fetchCurInactive]).then(function(_fetched){
    const lastStaff=_fetched[0]||[], curInactive=_fetched[1]||[];
    /* 모든 매칭은 이름+직위 동시 일치 기준 (사용자 확정 2026-06-13). 직위가 다르면 다른 사람. */
    const lastByKey={}; (lastStaff||[]).forEach(function(s){const k=_pkey(s);(lastByKey[k]=lastByKey[k]||[]).push(s);});
    const inactByKey={}; curInactive.forEach(function(s){const k=_pkey(s);(inactByKey[k]=inactByKey[k]||[]).push(s);});
    const identical=[], rows=[], fresh=[];
    newStaff.forEach(function(st){
      const key=_pkey(st);
      /* 올해 명단에 이름+직위가 완전히 같은 사람 → 동일(재등록, uid 보존 갱신) */
      const curM=curByKey[key]||[];
      if(curM.length>0){
        identical.push(Object.assign({},st,{uid:(curM[0].uid||curM[0].id)}));
        return;
      }
      /* 올해 삭제(보관)된 명단에 이름+직위 동일 → 옛 uid 로 재연결(기록 유지).
         _revive 플래그 — '삭제했던 인원과 기록 연결' 문구로 표시 (사용자 요청 2026-06-12) */
      const inactM=inactByKey[key]||[];
      if(inactM.length>0){
        identical.push(Object.assign({},st,{uid:(inactM[0].uid||inactM[0].id),_revive:true}));
        return;
      }
      /* 작년 명단에 이름+직위 동일 → '계속 재직' 후보(① 섹션, 토글). 없으면 신규(② 섹션).
         직위가 바뀐 승진자는 여기서 신규로 분류되며, 사용자가 '수동 매칭'으로 작년 인원과 연결할 수 있다. */
      const cands=lastByKey[key]||[];
      if(cands.length>0){ rows.push({staff:st, cands:cands, state:'stay', candUid:(cands[0].uid||cands[0].id), pickedUid:null, pickedLabel:''}); return; }
      fresh.push(st);
    });
    _renderStaffMatch(vArea, identical, rows, fresh, lastStaff||[], _save, yr);
  }).catch(function(e){ try{console.log('[STAFF-MATCH] fetchLast/classify 예외:',e&&e.message);}catch(_){}; /* 안전망 — 작년 조회 실패 시 전부 신규 처리 */ _save(newStaff.map(function(s){return Object.assign({},s,{forceNew:true});})); });
}

/* 교직원 매칭 결과 렌더 + 토글/푸터 바인딩. ①(작년 같은 이름)=토글, ②(작년에 없던)=신규만(토글 없음) */
function _renderStaffMatch(vArea, identical, rows, fresh, lastStaff, save, yr){
  const TIPS={stay:'작년에도 있었던 교직원이 맞습니다.',fresh:'이 이름의 교직원이 다른 학교로 가거나 퇴직하였고 같은 이름의 다른 사람이 이 학교에 온 케이스입니다.',other:'작년에 있던 인원과 정확한 매칭을 수동으로 진행합니다.'};
  const GRID='display:grid;grid-template-columns:1fr 270px 1fr;gap:10px;align-items:center';
  function _seg(i,k,label,state){
    const onbg=k==='stay'?'linear-gradient(135deg,#22c55e,#16a34a)':k==='fresh'?'linear-gradient(135deg,#3b82f6,#2563eb)':'linear-gradient(135deg,#f59e0b,#d97706)';
    return '<button data-srow="'+i+'" data-sk="'+k+'" style="border:none;border-right:1px solid var(--bdr);background:'+(state===k?onbg:'transparent')+';color:'+(state===k?'#fff':'var(--t3)')+';padding:7px 8px;font-size:10px;font-weight:800;cursor:pointer;font-family:var(--f);white-space:nowrap">'+label+'</button>';
  }
  function _person(name,pos,right){
    return '<div'+(right?' style="text-align:right"':'')+'><div style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(name||'')+'</div><div style="font-size:10px;color:var(--t3);font-weight:700;margin-top:1px">'+escHtml(pos||'')+'</div></div>';
  }
  /* 모든 업로드 인원이 토글(계속 재직 / 신규 인원 / 수동 매칭)을 가짐 — 작년 매칭(cands)이 없어도 표시 */
  function _rowHtml(r,i){
    const bc=r.state==='stay'?'rgba(34,197,94,0.5)':r.state==='fresh'?'rgba(59,130,246,0.5)':'rgba(245,158,11,0.55)';
    const bg=r.state==='stay'?'rgba(34,197,94,0.07)':r.state==='fresh'?'rgba(59,130,246,0.07)':'rgba(245,158,11,0.08)';
    const hasCand=r.cands.length>0; const prev=r.cands[0]||{};
    let info=''; if(r.state==='other')info='<div style="font-size:9.5px;color:#d97706;font-weight:700;margin-top:3px">↳ '+(r.pickedLabel?('작년: '+escHtml(r.pickedLabel)+' 과 매칭'):'작년 인원 선택 필요')+'</div>';
    const left=hasCand?_person(prev.name,'작년 · '+(prev.position||'')+(r.cands.length>1?(' 외 '+(r.cands.length-1)+'명'):'')):'<div style="font-size:11px;color:var(--t3);opacity:0.6">해당없음</div>';
    return '<div style="'+GRID+';padding:9px 12px;border:1.5px solid '+bc+';background:'+bg+';border-radius:11px;margin-bottom:7px">'
      +left
      +'<div style="text-align:center"><div style="display:inline-flex;border:1px solid var(--bdr);border-radius:9px;overflow:hidden;background:var(--bg2)">'+_seg(i,'stay','✓ 계속 재직',r.state)+_seg(i,'fresh','신규 인원',r.state)+_seg(i,'other','수동 매칭',r.state)+'</div>'+info+'</div>'
      +_person(r.staff.name,'올해 · '+(r.staff.position||''),true)
      +'</div>';
  }
  function render(){
    let cstay=0,cfresh=0; rows.forEach(function(r){if(r.state==='stay')cstay++;else if(r.state==='fresh')cfresh++;});
    let h='<div style="padding:14px;border:2px solid rgba(245,158,11,0.3);border-radius:10px;background:rgba(245,158,11,0.04);margin-top:10px;max-height:80vh;min-height:360px;overflow-y:auto">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:3;background:var(--bg2);border-bottom:1px solid var(--bdr);padding:8px 14px;margin-bottom:12px;flex-wrap:wrap">'
      +'<div style="font-size:13px;font-weight:800;color:#f59e0b">⚠ DB/엑셀 지능 비교 결과 — 교직원 작년 & 올해 매칭 확인</div>'
      +'<div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">'
      +'<button data-sft="cancel" class="btn btn-outline btn-sm" style="font-size:11px">취소</button>'
      +'<button data-sft="now" class="btn btn-primary btn-sm" style="font-size:11px">업로드 진행 및 지금 매칭 완료</button>'
      +'<button data-sft="later" class="btn btn-sm" style="font-size:11px;font-weight:700;border:1px solid rgba(245,158,11,0.5);background:rgba(245,158,11,0.14);color:#d97706;transition:transform .15s ease,background .15s ease,box-shadow .15s ease">업로드 진행 및 다음에 매칭 완료</button>'
      +'</div></div>';
    h+='<div style="font-size:9.5px;color:var(--t3);text-align:right;margin:-6px 0 10px">수동 매칭이 필요하지 않은 경우 위 취소 버튼 외 두 버튼 중 아무거나 눌러도 됩니다.</div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">'
      +'<span data-cmptip="올해 인원 데이터에 이미 등록된 인원으로서 다시 등록하지 않고 건너뜁니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(100,116,139,0.14);color:var(--t2);font-weight:700">동일 '+identical.length+'명</span>'
      +'<span data-cmptip="작년에도 재직했던 사람으로서 올해 데이터와 연결 (계속 재직으로 분류)되는 인원 수입니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(34,197,94,0.1);color:#16a34a;font-weight:700">계속 재직 '+cstay+'명</span>'
      +'<span data-cmptip="작년에 없던 사람(또는 같은 이름의 다른 사람)으로 새로 등록되는 인원 수입니다." style="cursor:help;padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(59,130,246,0.1);color:#2563eb;font-weight:700">신규 인원 '+(cfresh+fresh.length)+'명</span>'
      +'</div>';
    h+='<div style="font-size:10px;color:var(--t3);margin-bottom:6px;line-height:1.6">작년에 같은 이름이 있으면 기본 <b>"계속 재직"</b>입니다. 직위·이름은 입력하신 그대로 표시됩니다.</div>';
    /* ① 작년 명단과 같은 이름 (cands 있는 행) */
    h+='<div style="font-size:10.5px;font-weight:800;color:var(--t3);margin:14px 4px 8px">① 작년 명단과 같은 이름</div>';
    h+='<div style="'+GRID+';padding:0 12px 6px;font-size:10px;font-weight:800;color:var(--t3)"><span>작년 명단</span><span style="text-align:center">구분 (택1)</span><span style="text-align:right">올해 등록</span></div>';
    if(rows.length){ rows.forEach(function(r,i){ h+=_rowHtml(r,i); }); }
    else h+='<div style="'+GRID+';padding:9px 12px;border:1.5px dashed var(--bdr);background:var(--bg2);border-radius:11px;margin-bottom:7px;opacity:0.5">'
      +'<div style="font-size:11px;color:var(--t3)">해당없음</div>'
      +'<div style="text-align:center"><div data-disabled-tip="1" style="display:inline-flex;border:1px solid var(--bdr);border-radius:9px;overflow:hidden;background:var(--bg2);cursor:not-allowed">'
        +'<span style="padding:7px 8px;font-size:10px;font-weight:800;color:var(--t3);border-right:1px solid var(--bdr)">✓ 계속 재직</span>'
        +'<span style="padding:7px 8px;font-size:10px;font-weight:800;color:var(--t3);border-right:1px solid var(--bdr)">신규 인원</span>'
        +'<span style="padding:7px 8px;font-size:10px;font-weight:800;color:var(--t3)">수동 매칭</span>'
      +'</div></div>'
      +'<div></div>'
      +'</div>';
    /* ② 작년에 없던 이름 — 신규만 (토글 없음) */
    h+='<div style="font-size:10.5px;font-weight:800;color:var(--t3);margin:14px 4px 8px">② 작년에 없던 이름 — 신규 등록</div>';
    h+='<div style="'+GRID+';padding:0 12px 6px;font-size:10px;font-weight:800;color:var(--t3)"><span>작년 명단</span><span></span><span style="text-align:right">올해 등록</span></div>';
    if(fresh.length){
      fresh.forEach(function(st){
        h+='<div style="'+GRID+';padding:9px 12px;border:1.5px solid rgba(59,130,246,0.4);background:rgba(59,130,246,0.06);border-radius:11px;margin-bottom:7px">'
          +'<div style="font-size:11px;color:var(--t3);opacity:0.6">해당없음</div>'
          +'<div style="text-align:center"><span data-cmptip="이번 학년도에 이 인원이 등록되지 않아서 신규로 표시되었습니다." style="cursor:help;font-size:10px;font-weight:800;color:#2563eb;background:rgba(59,130,246,0.12);padding:4px 10px;border-radius:8px">신규</span></div>'
          +_person(st.name,'올해 · '+(st.position||''),true)
          +'</div>';
      });
    } else h+='<div style="font-size:10.5px;color:var(--t3);opacity:0.7;padding:10px 12px;border:1px dashed var(--bdr);border-radius:10px;margin-bottom:7px;text-align:center">작년에 없던 새 이름이 없습니다.</div>';
    /* ③ 기록 연결 — 올해 삭제(보관)됐던 인원 재업로드 → 옛 uid 로 자동 연결, 과거 보건 기록 그대로 유지 (사용자 요청 2026-06-12) */
    const _revived=identical.filter(function(s){return s._revive;});
    const _sameNow=identical.filter(function(s){return !s._revive;});
    if(_revived.length){
      h+='<div style="font-size:10.5px;font-weight:800;color:var(--t3);margin:14px 4px 8px">③ 삭제했던 인원 — 기존 보건 기록과 자동 연결하여 재등록</div>';
      h+='<div style="'+GRID+';padding:0 12px 6px;font-size:10px;font-weight:800;color:var(--t3)"><span>삭제(보관)된 명단</span><span style="text-align:center">구분</span><span style="text-align:right">올해 등록</span></div>';
      _revived.forEach(function(s){
        h+='<div style="'+GRID+';padding:9px 12px;border:1.5px solid rgba(34,197,94,0.45);background:rgba(34,197,94,0.06);border-radius:11px;margin-bottom:7px">'
          +'<div style="font-size:11px;color:var(--t2)">삭제된 명단에 같은 인원 — 과거 방문 기록 유지</div>'
          +'<div style="text-align:center"><span data-cmptip="삭제(보관)된 명단에서 같은 인원을 찾아 기존 보건 기록과 연결한 채로 다시 등록합니다." style="cursor:help;font-size:10px;font-weight:800;color:#16a34a;background:rgba(34,197,94,0.14);padding:4px 10px;border-radius:8px">기록 연결</span></div>'
          +_person(s.name,'올해 · '+(s.position||''),true)
          +'</div>';
      });
    }
    /* ④ 동일 — 같은 학년도에 이미 등록된 인원(재업로드) → 정보 갱신 (사용자 요청 2026-06-09) */
    if(_sameNow.length){
      h+='<div style="font-size:10.5px;font-weight:800;color:var(--t3);margin:14px 4px 8px">'+(_revived.length?'④':'③')+' 이미 올해 명단에 있는 인원 — 동일 (정보 갱신)</div>';
      h+='<div style="'+GRID+';padding:0 12px 6px;font-size:10px;font-weight:800;color:var(--t3)"><span>현재 명단</span><span style="text-align:center">구분</span><span style="text-align:right">올해 등록</span></div>';
      _sameNow.forEach(function(s){
        h+='<div style="'+GRID+';padding:9px 12px;border:1.5px solid rgba(100,116,139,0.4);background:rgba(100,116,139,0.06);border-radius:11px;margin-bottom:7px">'
          +'<div style="font-size:11px;color:var(--t3);opacity:0.6">이미 올해 등록됨</div>'
          +'<div style="text-align:center"><span style="font-size:10px;font-weight:800;color:var(--t2);background:rgba(100,116,139,0.18);padding:4px 10px;border-radius:8px">동일</span></div>'
          +_person(s.name,'올해 · '+(s.position||''),true)
          +'</div>';
      });
    }
    h+='</div>'; /* container */
    vArea.innerHTML='<div class="compare-panel">'+h+'</div>';
    vArea.style.display='block';
    vArea.querySelectorAll('button[data-srow]').forEach(function(b){
      b.addEventListener('mouseenter',function(){_peopleShowTip(this,TIPS[this.dataset.sk]||'');});
      b.addEventListener('mouseleave',_peopleHideTip);
      b.addEventListener('click',function(){ _peopleHideTip(); const i=+this.dataset.srow,k=this.dataset.sk; rows[i].state=k; if(k!=='other'){rows[i].pickedUid=null;rows[i].pickedLabel='';} render(); if(k==='other')_staffPick(rows[i],lastStaff,render); });
    });
    vArea.querySelectorAll('[data-cmptip]').forEach(function(el){
      el.addEventListener('mouseenter',function(){_peopleShowTip(this,this.getAttribute('data-cmptip'));});
      el.addEventListener('mouseleave',_peopleHideTip);
    });
    vArea.querySelectorAll('[data-disabled-tip]').forEach(function(el){
      el.addEventListener('mouseenter',function(){_peopleShowTip(this,'지난 학년도에 등록된 인원이 없어서 비활성화 되었습니다.');});
      el.addEventListener('mouseleave',_peopleHideTip);
    });
    const _close=function(){_peopleHideTip();vArea.style.display='none';vArea.innerHTML='';};
    const cancelB=vArea.querySelector('[data-sft="cancel"]'); if(cancelB)cancelB.addEventListener('click',function(){ _pendingUploadClear('staff',yr); _close(); });
    const _build=function(){
      const list=[];
      identical.forEach(function(s){list.push(s);}); /* 동일(재등록): uid 보존 갱신 */
      rows.forEach(function(r){
        if(r.state==='stay' && r.candUid){ list.push(Object.assign({},r.staff,{uid:r.candUid})); }
        else if(r.state==='other' && r.pickedUid){ list.push(Object.assign({},r.staff,{uid:r.pickedUid})); }
        else { list.push(Object.assign({},r.staff,{forceNew:true})); } /* 신규 인원 / 미선택 수동매칭 / 후보없는 계속재직 → 새 uid */
      });
      fresh.forEach(function(s){list.push(Object.assign({},s,{forceNew:true}));}); /* ② 작년에 없던 → 신규 */
      return list;
    };
    const nowB=vArea.querySelector('[data-sft="now"]');
    if(nowB){
      nowB.addEventListener('mouseenter',function(){_peopleShowTip(this,'지금 인원 등록을 진행하되 수동 매칭이 필요한 경우 지금 바로 진행합니다.');});
      nowB.addEventListener('mouseleave',_peopleHideTip);
      nowB.addEventListener('click',function(){
        _peopleHideTip();
        const un=rows.filter(function(r){return r.state==='other' && !r.pickedUid;});
        if(un.length){ bus.emit('toast:show',{text:'"수동 매칭"으로 둔 '+un.length+'명의 작년 인원을 선택하거나 "다음에 매칭 완료"를 누르세요.'}); return; }
        _close(); save(_build());
      });
    }
    const laterB=vArea.querySelector('[data-sft="later"]');
    if(laterB){
      laterB.addEventListener('mouseenter',function(){ this.style.transform='translateY(-1px)'; this.style.background='rgba(245,158,11,0.26)'; this.style.boxShadow='0 3px 10px rgba(245,158,11,0.25)'; _peopleShowTip(this,'지금 인원 등록을 진행하되 수동 매칭이 필요한 경우 나중에 진행합니다.'); });
      laterB.addEventListener('mouseleave',function(){ this.style.transform=''; this.style.background='rgba(245,158,11,0.14)'; this.style.boxShadow=''; _peopleHideTip(); });
      laterB.addEventListener('click',function(){ _peopleHideTip(); _close(); save(_build()); });
    }
  }
  render();
}

/* 다른 사람 → 작년 교직원 수동 선택 모달 (취소/확인 2버튼) */
function _staffPick(row, lastStaff, after){
  const id='_staffPickOverlay'; const old=document.getElementById(id); if(old&&old.parentNode)old.parentNode.removeChild(old);
  const list=(lastStaff&&lastStaff.length)?lastStaff:(row.cands||[]);
  let sel=-1;
  const ov=document.createElement('div'); ov.id=id;
  ov.style.cssText='position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4)';
  let h='<div style="background:var(--card);border-radius:14px;width:460px;max-width:92vw;border:1px solid var(--bdr);box-shadow:0 18px 46px rgba(0,0,0,0.4);overflow:hidden">';
  h+='<div style="padding:13px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(245,158,11,0.12),rgba(139,92,246,0.05));font-size:14px;font-weight:800;color:var(--t1)">🔗 작년 교직원과 수동 매칭</div>';
  h+='<div style="padding:6px 18px 0;font-size:11px;color:var(--t3)">올해 "'+escHtml(row.staff.position||'')+' '+escHtml(row.staff.name||'')+'" 이(가) 작년의 누구였는지 선택하세요.</div>';
  h+='<div id="_spList" style="padding:12px 18px;max-height:48vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px"></div>';
  h+='<div style="padding:12px 18px;border-top:1px solid var(--bdr);display:flex;gap:8px;justify-content:flex-end">'
    +'<button data-sp="cancel" class="btn btn-outline btn-sm" style="font-size:11px">취소</button>'
    +'<button data-sp="ok" class="btn btn-primary btn-sm" style="font-size:11px">확인</button>'
    +'</div></div>';
  ov.innerHTML=h; document.body.appendChild(ov);
  const listEl=ov.querySelector('#_spList');
  function rl(){ listEl.innerHTML='';
    if(!list.length){ listEl.innerHTML='<div style="font-size:11px;color:var(--t3);padding:14px;text-align:center">작년 교직원 명단이 없습니다.</div>'; return; }
    list.forEach(function(c,j){
      const el=document.createElement('div');
      el.style.cssText='display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid '+(sel===j?'var(--cyan)':'var(--bdr)')+';border-radius:10px;cursor:pointer;background:'+(sel===j?'rgba(6,182,212,0.12)':'transparent');
      el.innerHTML='<span style="width:15px;height:15px;border-radius:50%;border:2px solid '+(sel===j?'var(--cyan)':'var(--bdr)')+';flex-shrink:0;'+(sel===j?'box-shadow:inset 0 0 0 3px var(--card);background:var(--cyan)':'')+'"></span><div><div style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(c.name||'')+'</div><div style="font-size:10px;color:var(--t3);font-weight:700">작년 · '+escHtml(c.position||'')+'</div></div>';
      el.addEventListener('click',function(){sel=j;rl();});
      listEl.appendChild(el);
    });
  }
  rl();
  const close=function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); };
  ov.addEventListener('mousedown',function(e){if(e.target===ov)close();});
  ov.querySelector('[data-sp="cancel"]').addEventListener('click',close);
  ov.querySelector('[data-sp="ok"]').addEventListener('click',function(){
    if(sel>=0){ const c=list[sel]; row.pickedUid=(c.uid||c.id); row.pickedLabel=(c.position||'')+' '+(c.name||''); }
    close(); if(typeof after==='function')after();
  });
}

/* 교직원 업로드 보류 재표시 — 교직원 패널 진입 시 호출(업로드 진행/취소 안 한 경우 다시 표시). 사용자 요청 2026-06-09 */
export function reshowStaffPending(hostEl){
  if(!hostEl)return false;
  const yr=String(_academicYear());
  const pending=_pendingUploadGet('staff',yr);
  if(!pending){ hostEl.style.display='none'; hostEl.innerHTML=''; return false; }
  const afterSave=function(cnt,err){
    if(err){ bus.emit('toast:show',{text:'저장 오류: '+(err.message||err)}); return; }
    bus.emit('toast:show',{text:'✅ '+cnt+'명 업로드 완료'});
    if(typeof _reloadStudentsFromDB==='function'){ _reloadStudentsFromDB().then(function(){ if(typeof renderSettingsPanel==='function')renderSettingsPanel('people'); }); }
  };
  _showStaffCompareGUI(hostEl, pending, yr, afterSave);
  return true;
}

/* 학생 업로드 보류 재표시 — 학생 패널 진입 시 호출(확인/취소 안 한 경우 다시 표시). 사용자 요청 2026-06-09 */
export function reshowStudentPending(hostEl){
  if(!hostEl)return false;
  const yr=String(_academicYear());
  const pending=_pendingUploadGet('student',yr);
  if(!pending){ hostEl.style.display='none'; hostEl.innerHTML=''; return false; }
  hostEl.style.display='block';
  _smartCompareStudents(hostEl, pending, yr);
  return true;
}

/* ── Major abbreviation popup ── */

/* ── Export / preview ── */
function getStudentExportFields(){
  return [
    {key:'grade',label:'학년',value:function(s){return s.grade||'';}},
    {key:'class',label:'반',value:function(s){return s.cls||'';}},
    {key:'number',label:'번호',value:function(s){return s.num||'';}},
    {key:'name',label:'이름',value:function(s){return s.name||'';}},
    {key:'gender',label:'성별',value:function(s){return s.gender||'';}},
    {key:'birth',label:'생년월일',value:function(s){return s.birth||'';}},
    {key:'guardian',label:'주 보호자',value:function(s){return s.guardianType||'';}},
    {key:'contact',label:'연락처',value:function(s){return s.guardianContact||'';}}
  ];
}
function getStaffExportFields(){
  return [
    {key:'name',label:'이름',value:function(s){return s.name||'';}},
    {key:'position',label:'직위',value:function(s){return s.position||'교직원';}}
  ];
}
function getExportVisibilityKey(type){return type==='staff'?'staff_export_visibility':'student_export_visibility';}
function getExportVisibility(type,fields){
  const saved=JSON.parse(localStorage.getItem(getExportVisibilityKey(type))||'null')||{};
  fields.forEach(function(f){if(saved[f.key]===undefined)saved[f.key]=true;});
  return saved;
}
function saveExportVisibility(type,state){localStorage.setItem(getExportVisibilityKey(type),JSON.stringify(state));}
function renderPeoplePreviewFields(){
  const ov=document.getElementById('peoplePreviewOverlay');if(!ov)return;
  const type=ov.dataset.type||'student';
  const fields=type==='staff'?getStaffExportFields():getStudentExportFields();
  const vis=getExportVisibility(type,fields);
  const chips=document.getElementById('peoplePreviewFieldChips');if(!chips)return;
  chips.innerHTML='';
  fields.forEach(function(f){
    const active=vis[f.key]!==false;
    const card=document.createElement('div');
    card.style.cssText='display:inline-flex;align-items:center;justify-content:space-between;gap:4px;height:34px;padding:0 8px;border:1px solid '+(active?'rgba(6,182,212,0.32)':'var(--bdr)')+';border-radius:8px;background:'+(active?'rgba(6,182,212,0.08)':'var(--bg)')+';min-width:0;white-space:nowrap;user-select:none;flex:1 1 0;opacity:'+(active?'1':'0.72');
    card.innerHTML='<span style="font-size:10px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">'+f.label+'</span>'
      +'<button type="button" aria-label="'+(active?'필드 숨기기':'필드 표시')+'" title="'+(active?'필드 숨기기':'필드 표시')+'" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;padding:0;border:1px solid '+(active?'rgba(6,182,212,0.24)':'rgba(148,163,184,0.2)')+';border-radius:999px;background:'+(active?'rgba(6,182,212,0.10)':'rgba(148,163,184,0.10)')+';color:'+(active?'var(--cyan)':'var(--t3)')+';cursor:pointer;flex:0 0 auto">'+dailyColEyeIcon(active)+'</button>';
    card.querySelector('button').addEventListener('click',function(e){
      e.stopPropagation();
      vis[f.key]=!active;
      saveExportVisibility(type,vis);
      renderPeoplePreviewFields();
    });
    chips.appendChild(card);
  });
  renderPeoplePreviewTable();
}
function buildPeopleExportRows(type){
  const fields=type==='staff'?getStaffExportFields():getStudentExportFields();
  const vis=getExportVisibility(type,fields);
  let selected=fields.filter(function(f){return vis[f.key]!==false;});
  if(!selected.length) selected=fields.slice(0,1);
  let src=S.people.filter(function(s){return s.type===type;});
  if(type==='student') src=src.sort(function(a,b){return (a.grade-b.grade)||compareClass(a.cls,b.cls)||(a.num-b.num);});
  const rows=src.map(function(s){
    const row={};
    selected.forEach(function(f){row[f.label]=f.value(s);});
    return row;
  });
  return {rows:rows,selected:selected};
}
function renderPeoplePreviewTable(){
  const ov=document.getElementById('peoplePreviewOverlay');if(!ov)return;
  const type=ov.dataset.type||'student';
  const wrap=document.getElementById('peoplePreviewTableWrap');if(!wrap)return;
  const built=buildPeopleExportRows(type);
  if(!built.rows.length){wrap.innerHTML='<div style="padding:16px;text-align:center;color:var(--t3);font-size:11px">등록된 데이터가 없습니다.</div>';return;}
  const heads=built.selected.map(function(f){return f.label;});
  let html='<table class="settings-table" style="margin:0;font-size:11px"><thead><tr>';
  heads.forEach(function(h){html+='<th style="padding:6px 8px">'+h+'</th>';});
  html+='</tr></thead><tbody>';
  built.rows.forEach(function(r){
    html+='<tr>';
    heads.forEach(function(h){html+='<td style="padding:5px 8px">'+escHtml(r[h])+'</td>';});
    html+='</tr>';
  });
  html+='</tbody></table>';
  wrap.innerHTML=html;
}

/* ── Care file upload ── */
export function setCareFileName(name){
  careSelectedFileName=name||'';
  const meta=document.getElementById('careFileMeta');
  const nameEl=document.getElementById('careFileName');
  if(meta&&nameEl&&careSelectedFileName){
    const extra=(careParsedRows&&careParsedRows.length)?' ('+careParsedRows.length+'건 파싱됨)':'';
    nameEl.textContent=careSelectedFileName+extra;
    meta.style.display='flex';
  }
}

/* ── Care list panel (print/export) ── */
let _careSelectedYear=new Date().getFullYear();
/* careExportSheets and _careListPanelHtml are large — kept in this module */
export function _careListPanelHtml(careList,title){
  const yr=_careSelectedYear;
  const curYr=_academicYear();
  const schoolName=S.settings.schoolName||'○○학교';
  let h='<div style="width:100%;display:flex;flex-direction:column;height:100%">';
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:4px">'+title+'</div>';
  h+='<div style="display:flex;gap:4px;margin-bottom:8px">';
  for(let yi=curYr;yi>=curYr-4;yi--){
    const hasData=S.people.some(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch')&&(!s.careYear||s.careYear<=yi);});
    const isActive=yi===yr;
    if(hasData){
      h+='<button data-action="care-year" data-year="'+yi+'" style="padding:3px 10px;font-size:10px;font-weight:'+(isActive?'800':'600')+';border-radius:12px;cursor:pointer;border:1px solid '+(isActive?'var(--cyan)':'var(--bdr)')+';background:'+(isActive?'rgba(6,182,212,0.1)':'transparent')+';color:'+(isActive?'var(--cyan)':'var(--t2)')+';font-family:var(--f)">'+yi+'</button>';
    } else {
      h+='<button disabled title="해당 연도에 대한 데이터가 없습니다." style="padding:3px 10px;font-size:10px;font-weight:600;border-radius:12px;cursor:default;border:1px solid var(--bdr);background:rgba(148,163,184,0.1);color:#94a3b8;font-family:var(--f)">'+yi+'</button>';
    }
  }
  h+='</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:8px">총 '+careList.length+'명</div>';
  const _btnS='padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">';
  h+='<button data-action="care-copy" style="'+_btnS+'background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>클립보드 복사</button>';
  h+='<button data-action="care-excel" style="'+_btnS+'background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>엑셀 내보내기</button>';
  h+='<button data-action="care-sheets" style="'+_btnS+'background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets</button>';
  h+='<button data-action="care-print" style="'+_btnS+'background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none">인쇄</button>';
  h+='<button data-action="care-pdf" style="'+_btnS+'background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none">PDF</button>';
  h+='</div>';
  h+='<div style="font-size:9px;color:#ef4444;margin-bottom:8px">‼️ Google Sheets로 내보낼 경우 편집 용도로 사용하고 저장을 하지 마세요.</div>';
  const bd='border:1px solid #c0c0c0;';const pd='padding:3px 5px;';const ctr='text-align:center;';
  h+='<div style="flex:1;overflow:auto;background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:12px;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000">';
  h+='<table style="width:100%;border-collapse:collapse;font-size:9px">';
  h+='<tr style="background:#f0f0f0;height:18px"><td style="'+bd+ctr+'width:22px;color:#666;font-size:8px;font-weight:600;background:#f8f8f8"></td>';
  ['A','B','C','D','E','F','G','H'].forEach(function(c){h+='<td style="'+bd+ctr+'color:#666;font-size:8px;font-weight:600;background:#f8f8f8">'+c+'</td>';});
  h+='</tr>';
  h+='<tr style="height:2px"><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">1</td><td colspan="4" style="'+bd+'background:#2855A0;padding:0;line-height:1px;font-size:1px">&nbsp;</td><td colspan="4" style="'+bd+'background:#D4A843;padding:0;line-height:1px;font-size:1px">&nbsp;</td></tr>';
  h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">2</td><td colspan="8" style="'+bd+'background:#F7F7F7;text-align:center;padding:6px 12px;font-size:12px;font-weight:700;letter-spacing:2px">'+yr+'학년도 '+escHtml(schoolName)+' 요보호 대상 학생 명단</td></tr>';
  h+='<tr style="height:2px"><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">3</td><td colspan="4" style="'+bd+'background:#2E8B57;padding:0;line-height:1px;font-size:1px">&nbsp;</td><td colspan="4" style="'+bd+'background:#C0392B;padding:0;line-height:1px;font-size:1px">&nbsp;</td></tr>';
  h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">4</td><td colspan="8" style="border:none;padding:0;height:20px"></td></tr>';
  h+='<tr style="background:#e8f4f8"><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">5</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333;border-left:2px solid #333;width:22px">순</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333">학년</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333">반</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333">번호</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333">이름</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333">요보호 질환명</td>';
  h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333">미세먼지 기저질환</td>';
  h+='<td style="'+bd+pd+'font-weight:700;border-top:2px solid #333;border-right:2px solid #333">메모/주의사항</td>';
  h+='</tr>';
  careList.forEach(function(s,i){
    const isLast=i===careList.length-1;
    const btm=isLast?'border-bottom:2px solid #333;':'';
    const dustDisease=s.dust_disease||s.dustDisease||'';
    const careMemo=s.care_memo||s.careMemo||'';
    h+='<tr><td style="'+bd+ctr+'font-size:8px;color:#666;background:#f8f8f8">'+(i+6)+'</td>';
    h+='<td style="'+bd+pd+ctr+'border-left:2px solid #333;'+btm+'">'+(i+1)+'</td>';
    h+='<td style="'+bd+pd+ctr+btm+'">'+s.grade+'</td>';
    h+='<td style="'+bd+pd+ctr+btm+'">'+s.cls+'</td>';
    h+='<td style="'+bd+pd+ctr+btm+'">'+s.num+'</td>';
    h+='<td style="'+bd+pd+ctr+btm+'font-weight:600">'+escHtml(s.name)+'</td>';
    h+='<td style="'+bd+pd+btm+'">'+escHtml(s.condition||'')+'</td>';
    h+='<td style="'+bd+pd+btm+'">'+escHtml(dustDisease)+'</td>';
    h+='<td style="'+bd+pd+btm+'border-right:2px solid #333">'+escHtml(careMemo)+'</td>';
    h+='</tr>';
  });
  h+='</table></div></div>';
  return h;
}
async function careExportSheets(){
  const careList=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch');});
  careList.sort(function(a,b){if(a.grade!==b.grade)return a.grade-b.grade;var _c=compareClass(a.cls,b.cls);if(_c)return _c;return(a.num||0)-(b.num||0);});
  const yr=_careSelectedYear||new Date().getFullYear();
  const schoolName=S.settings.schoolName||'○○학교';
  const titleText=yr+'학년도 '+schoolName+' 요보호 대상 학생 명단';
  const rows=[];
  rows.push([titleText,'','','','','']);
  rows.push(['순','학년','반','번호','이름','요보호 내용']);
  careList.forEach(function(s,i){
    rows.push([i+1,s.grade,s.cls,s.num,s.name,(s.condition||'')+(s.careMemo?' / '+s.careMemo:'')]);
  });
  const existing=document.getElementById('careSheetsOverlay');if(existing)closeModalGracefully(existing);
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='careSheetsOverlay';ov.style.cssText='background:rgba(0,0,0,0.35);z-index:9600';
  let html='<div class="modal-content" style="width:420px;max-width:94vw;padding:0">';
  html+='<div style="background:var(--popup-head);padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 보내기</div></div>';
  html+='<div style="padding:18px">';
  html+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11px;color:var(--t2)">';
  html+='<div style="margin-bottom:6px"><strong>파일명:</strong> '+escHtml(titleText)+'</div>';
  html+='<div><strong>총 행:</strong> '+rows.length+'행</div>';
  html+='</div>';
  html+=_sheetsAccountHtml('careSheetsAcct');
  html+='</div>';
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  html+='<button data-action="close-care-sheets" style="padding:7px 16px;font-size:11px;font-weight:600;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>';
  html+='<button id="careSheetsSendBtn" style="padding:7px 22px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov)closeModalWithAnim(ov);
    const t=e.target.closest('[data-action="close-care-sheets"]');
    if(t)closeModalGracefully('careSheetsOverlay');
  });
  document.body.appendChild(ov);
  _sheetsAccountInit('careSheetsAcct');
  document.getElementById('careSheetsSendBtn').addEventListener('click',async function(){
    const btn=this;btn.disabled=true;btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';
    try{
      const fmtReqs=[];
      fmtReqs.push({mergeCells:{range:{sheetId:0,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:6},mergeType:'MERGE_ALL'}});
      fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:14},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(textFormat,horizontalAlignment)'}});
      fmtReqs.push({repeatCell:{range:{sheetId:0,startRowIndex:1,endRowIndex:2},cell:{userEnteredFormat:{textFormat:{bold:true},horizontalAlignment:'CENTER',backgroundColor:{red:0.91,green:0.96,blue:0.97}}},fields:'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)'}});
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{pixelSize:40},fields:'pixelSize'}});
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:1,endIndex:2},properties:{pixelSize:50},fields:'pixelSize'}});
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:2,endIndex:3},properties:{pixelSize:40},fields:'pixelSize'}});
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:3,endIndex:4},properties:{pixelSize:50},fields:'pixelSize'}});
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:4,endIndex:5},properties:{pixelSize:80},fields:'pixelSize'}});
      fmtReqs.push({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:5,endIndex:6},properties:{pixelSize:200},fields:'pixelSize'}});
      /* 데이터 영역 밖의 빈 셀 제거 (기본 26cols × 1000rows → 사용 범위로 축소) */
      const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
      const _careColCount=6;
      if(_careColCount<DEFAULT_COLS){
        fmtReqs.push({deleteDimension:{range:{sheetId:0,dimension:'COLUMNS',startIndex:_careColCount,endIndex:DEFAULT_COLS}}});
      }
      if(rows.length<DEFAULT_ROWS){
        fmtReqs.push({deleteDimension:{range:{sheetId:0,dimension:'ROWS',startIndex:rows.length,endIndex:DEFAULT_ROWS}}});
      }
      const createRes=await window.sheetsExportWithConsent({
        title:titleText,
        sheetTitle:'요보호명단',
        range:'요보호명단!A1',
        values:rows,
        requests:fmtReqs
      });
      if(!createRes.success) throw new Error(createRes.error||'스프레드시트 생성 실패');
      closeModalWithAnim(document.getElementById('careSheetsOverlay'));
      const ssUrl=createRes.spreadsheetUrl||('https://docs.google.com/spreadsheets/d/'+createRes.spreadsheetId);
      if(confirm('Google Sheets에 저장되었습니다!\n\nGoogle Sheets에서 열까요?')){
        window.electronAPI.openExternal(ssUrl);
      }
    }catch(err){
      btn.disabled=false;btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기';
      alert('Google Sheets 내보내기 실패:\n'+err.message);
    }
  });
}

function showUploadMsg(id,msg,type){
  const el=document.getElementById(id);
  if(!el)return;
  el.style.display='block';
  el.textContent=msg;
  el.style.background=type==='success'?'var(--gbg)':'var(--rbg)';
  el.style.color=type==='success'?'var(--gs)':'var(--rs)';
  /* 성공 메시지는 3초 후 자동 숨김. 오류는 수동 닫기 (읽어야 하므로 유지) */
  if(type==='success'){
    if(el._autoHideTimer)clearTimeout(el._autoHideTimer);
    el._autoHideTimer=setTimeout(function(){
      el.style.transition='opacity 0.4s ease';
      el.style.opacity='0';
      setTimeout(function(){
        el.style.display='none';
        el.style.opacity='1';
        el.style.transition='';
      },400);
    },3000);
  }
}

/* ── Expose to global scope ── */

