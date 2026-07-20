/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { escHtml } from '../../core/helpers.js';
import { appConfirmModal, makeSlideToDelete } from '../../core/ui-utils.js';
import { triggerLocalTemplateDownload } from './settings-view.js';
import { S } from '../../core/app-state.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { openPersonSearch } from '../../core/person-search-ui.js';

/* 보건일지 기록의 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님). 예) 2025-02-26 → 2024학년도. (사용자 지시 2026-06-20) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

/* ═══════════════════════════════════════
   SETTINGS TAB: IMPORT (데이터 가져오기 / 이관)
   Extracted from settings-view.js
   ═══════════════════════════════════════ */

/* 직전 apply 호출이 삽입한 daily_records ID 들 — "↶ N건 삽입 되돌리기" 동작에 사용.
 *  applyToDaily 가 반환한 insertedIds 를 그대로 저장. revert 후 비움.
 *  staging clear 가 호출되면 무의미해지므로 그때도 비움. */
let _pastLastInsertedIds = [];

export function _renderImportTab(){
  let html='<div class="settings-panel-title">📥 데이터 가져오기 / 이관</div>';
  html+='<div class="settings-panel-desc">다른 보건일지 프로그램을 사용한 적이 있거나 따로 기록해둔 기록이 있다면 아래 "최적화 양식 다운로드" 버튼을 클릭하여 엑셀 파일을 다운받아 주세요. 내용을 엑셀 파일에 붙여넣고 업로드하면 과거 기록이 등록됩니다.</div>';
  /* 과거 보건기록 가져오기 */
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  html+='<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:8px">📋 과거 보건기록 가져오기</div>';
  html+='<div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:6px">① 이관 도우미로 자동 변환 (권장)</div>';
  html+='<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">';
  html+='<button class="btn btn-primary btn-sm" id="importDownloadHelperBtn">🔄 이관 도우미 다운로드</button>';
  html+='</div>';
  html+='<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.6">💡 다른 보건일지 프로그램의 엑셀(.xlsx / .xls)을 오렌지톡 <b>최적화 양식</b>으로 자동 변환해 주는 도구입니다.<br>더블클릭으로 연 뒤, 예전 프로그램에서 받은 일지 엑셀 파일을 그대로 불러와 변환·저장하고 아래 업로드 영역에 올리세요.<br><span style="color:var(--rs)">(PDF 사용은 제한됩니다.)</span></div>';
  /* 🔔 범위 안내 — 올해 기록만 */
  html+='<div style="background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.3);border-radius:8px;padding:10px 12px;margin-bottom:8px;line-height:1.7;font-size:11.5px;color:var(--t2)">';
  html+='<div style="font-weight:700;color:#ea580c;margin-bottom:4px;font-size:12px">🔔 가져올 데이터 범위 — 당해 연도(올해) 기록만 권장</div>';
  html+='<div>작년 이전 기록은 학년·반·번호가 이미 달라져 있어 매칭이 실패합니다. <b>올해 작성한 보건일지만 가져오세요.</b> 올해 기록이라면 <b style="color:#ea580c">학년 + 반 + 이름</b> 만으로 자동 매칭됩니다. 하지만 <b>번호·성별·학교급</b>까지 넣으면 가장 정확해집니다.</div>';
  html+='</div>';
  /* 이관 도우미 사용 단계 — 권장 흐름 */
  html+='<div style="background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.7;font-size:11.5px;color:var(--t2)">';
  html+='<div style="font-weight:700;color:#8b5cf6;margin-bottom:4px;font-size:12px">🔄 이관 도우미 사용 방법</div>';
  html+='<div style="margin-top:6px">1. 위 <b>🔄 이관 도우미 다운로드</b> 버튼으로 받은 HTML 파일을 더블클릭(또는 브라우저로 열기).</div>';
  html+='<div>2. 이관 도우미 화면에서 <b>.xlsx 또는 .xls 확장자의 보건일지 엑셀 파일</b>을 드래그하거나 클릭하여 업로드.</div>';
  html+='<div>3. 학교급·학과 등 몇 가지 조건을 클릭으로 지정하면 <b>오렌지톡 최적화 양식</b>으로 자동 변환됩니다.</div>';
  html+='<div>4. 변환된 엑셀을 저장 후 <b>아래 업로드 영역</b>에 드래그하거나 클릭하여 업로드.</div>';
  html+='</div>';
  /* 방법 ② — 직접 복사·붙여넣기 (이관 도우미가 안 맞는 경우) — 아코디언 (클릭하여 펼침) */
  html+='<details style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:8px;margin-bottom:10px;line-height:1.7;font-size:11.5px;color:var(--t2)">';
  html+='<summary style="font-weight:700;color:#10b981;font-size:12px;padding:10px 12px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;user-select:none"><span style="display:inline-block;transition:transform .15s;font-size:10px">▶</span>📋 최적화 양식에 직접 복사, 붙여넣기 하고자 하는 경우 <span style="font-weight:500;color:var(--t3);font-size:10.5px;margin-left:4px">(필요시 클릭)</span></summary>';
  html+='<style>details[open] > summary > span:first-child{transform:rotate(90deg)}details > summary::-webkit-details-marker{display:none}</style>';
  html+='<div style="padding:0 12px 12px 12px">';
  html+='<div>1. 아래 <b>📥 최적화 양식 다운로드</b> 버튼으로 받은 양식 파일은 <b style="color:var(--rs)">구조를 절대 변경하지 마세요</b> (열 추가/삭제·헤더 수정 금지).</div>';
  html+='<div>2. 선생님이 <b>다른 프로그램에서 다운받은 보건일지 파일</b>을 열어 <b>이 프로그램의 최적화 양식의 열에 맞게 복사 &amp; 붙여넣기</b> → 저장 → 아래 업로드 영역에 드롭.</div>';
  html+='<div style="margin-top:8px;padding:10px 12px;background:rgba(59,130,246,0.05);border-left:3px solid #3b82f6;border-radius:6px;font-size:11.5px;line-height:1.75;color:var(--t2)">';
  html+='<div style="margin-bottom:8px;padding:8px 10px;background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.3);border-radius:6px;color:var(--rs);font-weight:700">⚠ 반드시 엑셀 파일의 <b>「보건일지」 탭</b>에 입력해야 합니다. <b>「설명」 탭</b>에 입력하면 인식되지 않습니다.</div>';
  html+='<div style="margin-bottom:8px">◆ 다른 프로그램에서 가져온 데이터를 채워 넣어서 업로드하면 보건일지에 과거 기록으로 등록됩니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ A열 방문일</b>: 날짜를 입력합니다. (예: 2025.04.15., 2025-04-15, 20250415 등)<br>&nbsp;&nbsp;&nbsp;만약 날짜와 시간이 함께 적힌 경우라면 방문일에 일시를 적고 입실시간은 비워주세요.<br>&nbsp;&nbsp;&nbsp;다양한 형식을 자동으로 인식합니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ B열 입실시간(선택)</b>: 시간을 입력합니다. (예: 09:30, 0930, 오전 9시 30분 등)<br>&nbsp;&nbsp;&nbsp;비워두어도 됩니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ C열 학년</b>: 학생은 숫자만 입력하고 교직원은 한글로 입력하면 됩니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ D열 반</b>: 숫자만 입력합니다. (교직원은 비워두셔야 합니다.)</div>';
  html+='<div style="margin-bottom:6px"><b>◆ E열 번호(선택)</b>: 숫자만 입력합니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ F열 이름</b>: 필수 입력 항목으로 나이스 명렬표에 나온대로 입력하시면 다음 해에 매칭이 용이합니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ G열 증상</b>: 증상을 입력합니다. 여러 개인 경우 쉼표로 구분합니다.</div>';
  html+='<div style="margin-bottom:6px"><b>◆ H열 처치</b>: 처치 내용을 입력합니다.</div>';
  html+='<div style="margin-bottom:10px"><b>◆ I열 처치자(선택)</b>: 처치자 이름을 입력합니다. 선택 사항입니다.</div>';
  html+='<div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(59,130,246,0.25)">◆ <b>교직원</b>의 경우 방문일, 학년, 이름, 증상, 처치만 입력해주세요. <b>반은 비어 있어야 합니다.</b></div>';
  html+='<div style="margin-top:4px">◆ 교직원의 경우 <b>교장, 교감, 행정실장, 교원, 직원</b> 이렇게 다섯 직위로만 사용하시면 추후에 사용하기 아주 편리해집니다. (매칭의 단순화)</div>';
  html+='</div>';
  html+='</div>';
  html+='</details>';
  /* 최적화 양식 다운로드 버튼 — 업로드 영역 바로 위 */
  html+='<div style="margin-bottom:8px"><button class="btn btn-sm" id="importDownloadTemplateBtn" style="background:linear-gradient(135deg,#06b6d4,#0e7490);color:#fff;border:none;font-weight:700">📥 최적화 양식 다운로드</button><span style="margin-left:10px;font-size:11px;color:var(--t3)">변환된 파일 또는 직접 작성한 양식 파일을 아래에 업로드</span></div>';
  const _pastFname='past_health_records.xlsx';
  html+='<div class="upload-area" id="pastHistoryUploadArea" style="min-height:70px">📁 작성한 '+escHtml(_pastFname)+' 파일을 드래그하거나 클릭하여 업로드</div>';
  html+='<input type="file" id="pastHistoryFileInput" accept=".xlsx,.xls" style="display:none">';
  html+='<div id="pastHistoryMsg" style="margin-top:8px"></div>';
  html+='<div id="pastUndoUploadWrap" style="display:none;margin-top:6px"><button id="pastUndoUploadBtn" class="btn btn-sm" style="padding:7px 14px;font-size:11.5px;font-weight:700;background:rgba(245,158,11,0.10);color:#d97706;border:1px solid rgba(245,158,11,0.45);border-radius:7px;cursor:pointer" title="방금 업로드한 파일의 매칭/분석 결과를 모두 비우고 업로드 이전으로 돌아갑니다 (이미 DB에 삽입한 기록은 그대로)">↶ 방금 업로드 취소</button></div>';
  /* 필수 컬럼 누락 행 안내 — 파싱 단계에서 제외된 행 리스트 (옵션 1 사전 검증) */
  html+='<div id="pastInvalidRows"></div>';
  html+='<div id="pastMatchResultsSection" style="margin-top:14px;border-top:1px solid var(--bdr);padding-top:12px">';
  html+='<div style="font-size:12.5px;font-weight:700;color:var(--cyan);margin-bottom:8px">② 자동 매칭 결과</div>';
  html+='<div id="pastMatchStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
  html+='<div style="background:rgba(22,163,106,0.1);border:1px solid rgba(22,163,106,0.3);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#16a34a">✅ 0건 매칭</div>';
  html+='<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#f59e0b">⚠️ 0건 동명이인</div>';
  html+='<div style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#dc2626">❌ 0건 미매칭</div>';
  html+='</div></div>';
  html+='<div id="pastAmbiguousSection" style="display:none;margin-top:14px;border-top:1px solid var(--bdr);padding-top:12px">';
  html+='<div style="font-size:12.5px;font-weight:700;color:var(--cyan);margin-bottom:6px">③ 동명이인 처리</div>';
  html+='<p style="font-size:11.5px;color:var(--t2);margin-bottom:8px;line-height:1.6">같은 이름의 학생이 여러 명인 경우, 올바른 학생을 선택해주세요.</p>';
  html+='<div id="pastAmbiguousList" style="max-height:300px;overflow-y:auto;scrollbar-width:thin"></div>';
  html+='</div>';

  /* ③-2 미매칭 — 현재 명단에 없는 학생(전학/졸업/자퇴 등): 매칭 안 함, 안내만 표시.
   *   필요 시 사용자가 명단에 추가 후 "🔗 미매칭 매칭하기" 로 수동 연결 가능. */
  html+='<div id="pastUnmatchedSection" style="display:none;margin-top:14px;border-top:1px solid var(--bdr);padding-top:12px">';
  html+='<div style="font-size:12.5px;font-weight:700;color:var(--cyan);margin-bottom:6px">③-2 명단에 없는 학생 (매칭 안 됨)</div>';
  html+='<p style="font-size:11.5px;color:var(--t2);margin-bottom:8px;line-height:1.6">현재 명단에 등록되지 않은 학생(예: 전학·졸업·자퇴) 의 기록은 매칭하지 않고 건너뜁니다. 보관이 필요하면 해당 학생을 명단에 추가하신 뒤 아래 "수동 매칭" 버튼을 사용하세요.</p>';
  html+='<div id="pastUnmatchedList" style="max-height:240px;overflow-y:auto;border:1px solid var(--bdrl);border-radius:8px;background:rgba(220,38,38,0.03);margin-bottom:8px"></div>';
  html+='<div style="display:flex;align-items:center;gap:8px"><span id="pastUnmatchedSummary" style="font-size:12px;color:var(--t2);flex:1"></span><button id="pastUnmatchedOpenBtn" class="btn btn-sm" data-tooltip="현재 등록된 인원에게 강제로 수동 매칭을 진행합니다." style="padding:7px 12px;font-size:11px;font-weight:700;background:rgba(6,182,212,0.10);color:var(--cyan);border:1px solid rgba(6,182,212,0.40);border-radius:7px;cursor:pointer">🔗 일괄 수동 매칭</button></div>';
  html+='</div>';
  html+='<div id="pastApplySection" style="margin-top:14px;border-top:1px solid var(--bdr);padding-top:12px">';
  html+='<div style="font-size:12.5px;font-weight:700;color:var(--cyan);margin-bottom:8px">④ 보건일지에 DB 삽입</div>';
  html+='<div id="pastImportedStatus" style="font-size:12px;margin-bottom:6px"></div>';
  html+='<p style="font-size:11.5px;color:var(--t2);margin-bottom:8px;line-height:1.7">매칭된 과거 기록을 보건일지(일반일지)에 반영합니다.<br>이미 존재하는 기록은 건너뜁니다.<br><b style="color:var(--t1)">파일 업로드 후 매칭이 완료되면 아래 버튼이 활성화됩니다.</b></p>';
  html+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
  html+='<button class="btn btn-sm" id="pastApplyBtn" disabled style="padding:10px 20px;font-size:12px;font-weight:700;background:var(--bg2);color:var(--t3);border:1px solid var(--bdr);border-radius:8px;cursor:not-allowed;transition:all .2s;display:inline-flex;align-items:center;gap:6px">📋 지금 삽입하기</button>';
  html+='</div>';
  html+='<div id="pastApplyMsg" style="margin-top:8px"></div>';
  /* 위험 액션 — 슬라이드 삭제. 삽입 확인/취소 와 별도 영역으로 시각 구분 (구분선 + 위 여백) */
  html+='<div style="margin-top:18px;padding-top:14px;border-top:1px dashed var(--bdr);display:flex;flex-direction:column;gap:6px">';
  html+='<div style="font-size:10.5px;color:var(--t3);line-height:1.5">지금까지 업로드한 외부 데이터 모두 삭제</div>';
  html+='<button class="btn btn-sm" id="pastDeleteImportedBtn" style="padding:10px 16px;font-size:11px;font-weight:700;background:rgba(239,68,68,0.08);color:#dc2626;border:1px solid rgba(239,68,68,0.3);border-radius:8px;cursor:pointer;transition:all .15s" title="이전에 업로드 반영된 모든 기록을 일반일지에서 삭제합니다 (is_imported=1)">🗑 업로드한 이전 데이터 삭제</button>';
  html+='</div>';
  html+='</div>';
  html+='</div>';
  /* 매칭 처리 내역 — 동명이인 처리 + 미매칭 명단 + 자동 스킵 상세 + 명단 미등록 placeholder 기록 */
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  html+='<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:4px">📋 매칭 처리 내역</div>';
  html+='<p style="font-size:12px;color:var(--t2);margin-bottom:10px;line-height:1.7">동명이인 처리, 자동 스킵된 중복 기록, 매칭 안 한 인원 명단 등 매칭/삽입 과정에서 발생한 알림이 여기 표시됩니다.</p>';
  html+='<div id="pastSkipDetails" style="margin-bottom:10px"></div>';
  html+='<div id="pastAmbiguousStandalone" style="margin-bottom:10px"></div>';
  /* 매칭 안 한 인원 명단 — staging 의 unmatched 행 목록 (사용자 정책 2026-05-22) */
  html+='<div id="pastUnmatchedStandalone" style="margin-bottom:10px"></div>';
  html+='<div id="pastPlaceholderList"></div>';
  html+='</div>';

  return html;
}
/* ── Bind import tab event listeners after innerHTML ── */
export function _bindImportTabEvents(){
  const dlBtn=document.getElementById('importDownloadTemplateBtn');
  if(dlBtn)dlBtn.addEventListener('click',function(){_importDownloadPastTemplate();});
  const helperBtn=document.getElementById('importDownloadHelperBtn');
  if(helperBtn)helperBtn.addEventListener('click',function(){_importDownloadMigrationHelper();});
  const undoBtn=document.getElementById('pastUndoUploadBtn');
  if(undoBtn)undoBtn.addEventListener('click',function(){_importUndoRecentUpload();});
  const uploadArea=document.getElementById('pastHistoryUploadArea');
  const fileInput=document.getElementById('pastHistoryFileInput');
  if(uploadArea){
    uploadArea.addEventListener('click',function(){if(fileInput)fileInput.click();});
    uploadArea.addEventListener('dragover',function(e){e.preventDefault();uploadArea.classList.add('dragover');});
    uploadArea.addEventListener('dragleave',function(){uploadArea.classList.remove('dragover');});
    uploadArea.addEventListener('drop',function(e){e.preventDefault();uploadArea.classList.remove('dragover');if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0])_importPastFileFromBrowser(e.dataTransfer.files[0]);});
  }
  if(fileInput)fileInput.addEventListener('change',function(){
    if(this.files&&this.files[0]){
      const _f=this.files[0];
      /* input.value 즉시 비움 — 같은 파일을 다시 선택해도 change 이벤트가 다시 발화되게 (브라우저 표준 동작 회피) */
      try{this.value='';}catch(_){}
      _importPastFileFromBrowser(_f);
    }
  });
  const applyBtn=document.getElementById('pastApplyBtn');
  if(applyBtn)applyBtn.addEventListener('click',function(){_importPastApply();});
  const delImpBtn=document.getElementById('pastDeleteImportedBtn');
  if(delImpBtn){
    delImpBtn.addEventListener('click',function(){_importDeleteImported();});
    /* 위험 액션 — 슬라이드 투 삭제로 전환 (실수 방지) */
    if(!delImpBtn._slider){
      delImpBtn._slider = makeSlideToDelete(delImpBtn, { label: '클릭하여 우측으로 밀어서 삭제' });
    }
  }
  /* 탭 진입 시 올해 import된 데이터 개수 표시 + placeholder 리스트 갱신 +
   *  대기 중인 staging 통계도 함께 표시해 매칭/취소 버튼이 복원되게 함 (앱 재시작 후 보존 보장). */
  _importRefreshImportedStatus();
  try { _loadPlaceholderList(); } catch(_){}
  try { _importShowMatchStats(); } catch(_){}
}

async function _importRefreshImportedStatus(){
  const el=document.getElementById('pastImportedStatus');
  if(!window.electronAPI||!window.electronAPI.pastHistoryImportedCount)return;
  try{
    const res=await window.electronAPI.pastHistoryImportedCount();
    if(res&&res.success){
      const n=(res.data&&res.data.count)||0;
      const yr=(res.data&&res.data.year)||'';
      if(el){
        if(n>0){
          el.innerHTML='<span style="color:#dc2626;font-weight:700">🔴 '+yr+'학년도 기준, <b>'+n+'건</b>의 데이터가 데이터베이스에 삽입되었습니다.</span>';
        } else {
          el.innerHTML='<span style="color:var(--t3)">🟢 '+yr+'학년도 기준, 외부에서 가져온 데이터는 아직 없습니다.</span>';
        }
      }
      /* 슬라이드 라벨에 건수 반영 — 0건이면 비활성, 1건 이상이면 활성 (실수 방지 슬라이더) */
      const delBtn=document.getElementById('pastDeleteImportedBtn');
      if(delBtn){
        delBtn.innerHTML='🗑 업로드한 이전 데이터 ('+n+'건) 삭제';
        delBtn.disabled = !(n>0);
        if(delBtn._slider){
          const _ln = n>0 ? ('클릭하여 우측으로 밀어서 삭제 ('+n+'건)') : '삭제할 이전 데이터 없음';
          delBtn._slider.setLabel(_ln);
          delBtn._slider.setDisabled(!(n>0));
        }
      }
    }
  }catch(_){}
}

async function _importDeleteImported(){
  /* 슬라이드 완료 후 한 번 더 확인 모달 — 예/아니오 (이게 유일한 확인 단계) */
  const ok = await appConfirmModal(
    '이전에 업로드해서 반영한 모든 기록을 일반일지(daily_records) 에서 삭제합니다.<br><br>'
    + '<span style="color:#dc2626;font-weight:600">이 작업은 되돌릴 수 없습니다.</span>',
    '업로드 데이터 전체 삭제',
    { okLabel: '예', cancelLabel: '아니오' }
  );
  if(!ok) return;
  const msg=document.getElementById('pastApplyMsg');
  if(msg)msg.innerHTML='<div style="color:var(--t3);font-size:11px">🗑 삭제 중...</div>';
  try{
    const res=await window.electronAPI.pastHistoryDeleteImported();
    if(res&&res.success){
      const n=(res.data&&res.data.deleted)||0;
      if(msg)msg.innerHTML='<div style="color:#16a34a;font-size:11px;font-weight:600">✅ '+n+'건이 삭제되었습니다.</div>';
      /* 일괄 삭제 후 — "방금 삽입 되돌리기" 컨텍스트도 함께 정리 (참조 무효화) */
      _pastLastInsertedIds = [];
      try{ _importShowMatchStats(); }catch(_){}
      _importRefreshImportedStatus();
      /* S.records 재로드 + 달력·일지·사이드바 재렌더링 */
      try{
        const yr=String(_academicYear());
        if(window.electronAPI&&window.electronAPI.recordsGetDaily){
          const dRes=await window.electronAPI.recordsGetDaily(yr);
          if(dRes&&dRes.success&&Array.isArray(dRes.data)){
            S.records=dRes.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
          }
        }
        const busMod=await import('../../core/event-bus.js');
        if(busMod&&busMod.bus){
          busMod.bus.emit('render:daily');
          busMod.bus.emit('render:calendar');
          busMod.bus.emit('render:sidebar');
          busMod.bus.emit('render:dashboard');
        }
      }catch(_){}
    }else{
      if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 삭제 실패: '+escHtml((res&&res.error)||'')+'</div>';
    }
  }catch(e){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 오류: '+escHtml(e.message)+'</div>';}
}

/* ── Import functions ── */
/* 이관 도우미는 원격(오렌지팜 홈페이지)에서 최신본을 받아 항상 최신 상태로.
 *  원격 fetch 실패(오프라인/404) 시 번들 로컬 파일로 폴백.
 *  새 버전 업로드 위치: school114.org/data/Board/B11/migration-helper.html */
const _MIGRATION_HELPER_REMOTE_URL='https://school114.org/data/Board/B11/migration-helper.html';
const _MIGRATION_HELPER_LOCAL_PATH='templates/forms/migration-helper.html';
async function _importDownloadMigrationHelper(){
  const downloadName='오렌지톡_이관도우미.html';
  /* 1) 원격에서 최신본 fetch — 6초 타임아웃 */
  try{
    const ctrl=new AbortController();
    const tid=setTimeout(function(){ctrl.abort();},6000);
    const res=await fetch(_MIGRATION_HELPER_REMOTE_URL,{signal:ctrl.signal,cache:'no-cache'});
    clearTimeout(tid);
    if(res && res.ok){
      const blob=await res.blob();
      if(blob && blob.size>1000){
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url; a.download=downloadName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){URL.revokeObjectURL(url);},2000);
        return;
      }
    }
  }catch(_){ /* 네트워크 에러 — 폴백 */ }
  /* 2) 폴백 — 번들된 로컬 파일 */
  if(typeof triggerLocalTemplateDownload==='function'){
    triggerLocalTemplateDownload(_MIGRATION_HELPER_LOCAL_PATH,downloadName);
  } else {
    alert('이관 도우미 파일을 받을 수 없습니다. 인터넷 연결을 확인하시거나 잠시 후 다시 시도해 주세요.');
  }
}
function _importDownloadPastTemplate(){
  const fname='past_health_records.xlsx';
  if(typeof triggerLocalTemplateDownload==='function')triggerLocalTemplateDownload('templates/forms/'+fname,fname);
  else alert('템플릿 파일이 아직 준비되지 않았습니다.');
}
/* 브라우저의 File 객체 또는 파일 경로(Electron) 양쪽을 처리 */
async function _importPastFileFromBrowser(fileObj){
  const msg=document.getElementById('pastHistoryMsg');
  if(!fileObj){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 파일을 선택해 주세요.</div>';return;}
  if(msg)msg.innerHTML='<div style="color:var(--t3);font-size:11px">📦 파일 업로드 중...</div>';
  /* 새 파일 업로드 시작 — 직전 apply 의 "되돌리기" 컨텍스트 정리.
   *  새 묶음으로 작업하면 이전 묶음의 revert 는 의미가 없어짐 (사용자 혼동 방지). */
  _pastLastInsertedIds = [];
  try{ const _sd=document.getElementById('pastSkipDetails'); if(_sd) _sd.innerHTML=''; }catch(_){}
  try{ const _ir=document.getElementById('pastInvalidRows'); if(_ir) _ir.innerHTML=''; }catch(_){}
  /* Electron: file.path 로 바로 처리. Electron 32+ 에서는 webUtils.getPathForFile 사용 */
  let filePath=fileObj.path||'';
  if(!filePath&&window.electronAPI&&typeof window.electronAPI.getPathForFile==='function'){
    try{filePath=window.electronAPI.getPathForFile(fileObj)||'';}catch(e){}
  }
  if(!filePath&&window.electronAPI&&window.electronAPI.importPastHistoryXlsxBuffer){
    /* 마지막 폴백: ArrayBuffer 로 읽어 메인에 직접 전달 */
    try{
      const buf=await fileObj.arrayBuffer();
      const res=await window.electronAPI.importPastHistoryXlsxBuffer(new Uint8Array(buf),fileObj.name);
      if(res&&res.success&&res.filePath){filePath=res.filePath;}
      else if(res&&res.error){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 업로드 실패: '+escHtml(res.error)+'</div>';return;}
    }catch(e){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 업로드 오류: '+escHtml(e.message)+'</div>';return;}
  }
  if(!filePath){
    /* 웹 브라우저(웹서버 모드)에서만 /api/upload 시도 */
    try{
      const fd=new FormData();fd.append('file',fileObj);
      const up=await fetch('/api/upload',{method:'POST',body:fd}).then(function(r){return r.json();});
      if(!up||!up.filePath){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 업로드 실패: '+escHtml((up&&up.error)||'알 수 없음')+'</div>';return;}
      filePath=up.filePath;
    }catch(e){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 업로드 오류: '+escHtml(e.message)+'</div>';return;}
  }
  return _importPastFile(filePath);
}

async function _importPastFile(filePath){
  const msg=document.getElementById('pastHistoryMsg');
  if(msg)msg.innerHTML='<div style="color:var(--t3);font-size:11px">📦 데이터를 변환하는 중...</div>';
  try{
    const res=await window.electronAPI.importPastHistoryXlsx(filePath);
    if(!res||!res.success){
      if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ '+escHtml((res&&res.error)||'가져오기 실패')+'</div>';
      return;
    }
    /* 필수 컬럼 누락 행 안내 (옵션 1 사전 검증) — 빈 배열이면 함수 내부에서 안내 영역도 비움 */
    const _invalidRows = (res.data && Array.isArray(res.data.invalidRows)) ? res.data.invalidRows : [];
    _importRenderInvalidRows(_invalidRows);
    /* 유효 행 0건이면 자동 매칭 의미 없음 — 안내만 하고 종료 */
    if(!res.data.recordCount){
      if(msg)msg.innerHTML='<div style="color:#b45309;font-size:11px;font-weight:700">⚠ 가져올 유효 행이 없습니다. 필수 컬럼을 채운 후 다시 업로드해주세요.</div>';
      return;
    }
    if(msg){
      let _summary='<div style="color:#16a34a;font-size:11px;font-weight:600">✅ '+escHtml(String(res.data.recordCount))+'건 파싱 완료. 자동 매칭 중...</div>';
      if(_invalidRows.length>0){
        _summary+='<div style="color:#b45309;font-size:10.5px;margin-top:2px">(필수 컬럼 누락으로 '+_invalidRows.length+'건 제외됨 — 아래 안내 참조)</div>';
      }
      msg.innerHTML=_summary;
    }
    const yr=_academicYear();
    const sl=(S.settings&&S.settings.schoolLevel)||'elementary';
    const matchRes=await window.electronAPI.pastHistoryAutoMatch(yr,sl);
    if(!matchRes||!matchRes.success){
      if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 자동 매칭 실패: '+escHtml((matchRes&&matchRes.error)||'')+'</div>';
      return;
    }
    if(msg)msg.innerHTML='<div style="color:#16a34a;font-size:11px;font-weight:600">✅ 파싱 및 자동 매칭 완료!</div>';
    /* 방금 업로드 취소 버튼 노출 — 매칭 결과 있으면 사용자가 손쉽게 이전 상태로 돌릴 수 있도록 */
    const undoWrap=document.getElementById('pastUndoUploadWrap');
    if(undoWrap) undoWrap.style.display='';
    _importShowMatchStats();
  }catch(e){if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 오류: '+escHtml(e.message)+'</div>';}
}

/* 방금 업로드 취소 — staging 전체 비우기 + 업로드 관련 UI 영역 모두 숨김 */
async function _importUndoRecentUpload(){
  const ok=await appConfirmModal('방금 업로드한 파일의 매칭/분석 결과를 모두 비우고 <b>업로드 이전 상태</b>로 돌아갑니다.<br><br>이미 보건일지에 삽입된 기록은 그대로 유지됩니다.', '방금 업로드 취소', { okLabel:'네, 취소합니다', cancelLabel:'아니오' });
  if(!ok) return;
  try{
    if(window.electronAPI && window.electronAPI.pastHistoryClearStaging){
      await window.electronAPI.pastHistoryClearStaging();
    }
    /* UI 리셋 — 부모 섹션은 display:none 만 토글 (innerHTML 비우면 자식 ID 들이 DOM 에서 사라져 다음 업로드 때 카드 못 찾음) */
    const parentSections=['pastMatchResultsSection','pastAmbiguousSection','pastUnmatchedSection'];
    parentSections.forEach(function(id){const el=document.getElementById(id); if(el) el.style.display='none';});
    /* 리프 컨테이너(동적 내용물)는 innerHTML 비움 — 다음 업로드 때 새로 채워짐 */
    const leafContainers=['pastInvalidRows','pastSkipDetails','pastAmbiguousStandalone','pastUnmatchedStandalone','pastPlaceholderList','pastMatchStats','pastAmbiguousList','pastUnmatchedList'];
    leafContainers.forEach(function(id){const el=document.getElementById(id); if(el) el.innerHTML='';});
    const msg=document.getElementById('pastHistoryMsg'); if(msg) msg.innerHTML='<div style="color:var(--t3);font-size:11px">↶ 업로드를 취소했습니다. 다른 파일을 업로드해 주세요.</div>';
    const undoWrap=document.getElementById('pastUndoUploadWrap'); if(undoWrap) undoWrap.style.display='none';
    /* 삽입 버튼 상태도 비활성화로 되돌림 — 매칭 카운트 0 으로 갱신 */
    try{ _importShowMatchStats(); }catch(_){}
  }catch(e){ alert('업로드 취소 중 오류: '+(e&&e.message||e)); }
}
async function _importShowMatchStats(){
  try{
    const statsRes=await window.electronAPI.pastHistoryMatchStats();
    if(!statsRes||!statsRes.success)return;
    const d=statsRes.data;
    const matched=d.matched||0, graduated=d.graduated||0, ambiguous=d.ambiguous||0, unmatched=d.unmatched||0;
    /* staging 에 데이터가 있으면(앱 재시작 후 포함) "방금 업로드 취소" 버튼 항상 노출 */
    const undoWrap=document.getElementById('pastUndoUploadWrap');
    if(undoWrap){
      const hasStaging=(matched+ambiguous+unmatched+graduated)>0;
      undoWrap.style.display=hasStaging?'':'none';
    }
    const section=document.getElementById('pastMatchResultsSection');
    if(section)section.style.display='';
    const el=document.getElementById('pastMatchStats');
    if(el){
      el.innerHTML=''
        +'<div style="background:rgba(22,163,106,0.1);border:1px solid rgba(22,163,106,0.3);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#16a34a">✅ '+matched+'건 매칭</div>'
        +'<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#f59e0b">⚠️ '+ambiguous+'건 동명이인</div>'
        +'<div style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#dc2626">❌ '+unmatched+'건 미매칭</div>';
    }
    if(ambiguous>0){_importShowAmbiguous();}
    else{const ambSec=document.getElementById('pastAmbiguousSection');if(ambSec)ambSec.style.display='none';}
    /* 동명이인 standalone 섹션도 함께 갱신 — 이걸 안 하면 STALE staging ID 가 박힌 버튼이 남아
     * 사용자가 클릭해도 DB 에 매칭되는 행 0개로 무효 처리됨 (베타.10 버그) */
    try{_loadAmbiguousStandalone();}catch(e){}
    /* 매칭 처리 내역 카드 안에 미매칭 명단 렌더링 — 사용자 정책 2026-05-22 */
    try{_loadUnmatchedStandalone();}catch(e){}
    /* 미매칭 섹션 토글 + 버튼 핸들러 (한 번만 바인딩) */
    const unmatchSec=document.getElementById('pastUnmatchedSection');
    const unmatchSum=document.getElementById('pastUnmatchedSummary');
    const unmatchBtn=document.getElementById('pastUnmatchedOpenBtn');
    if(unmatchSec){
      if(unmatched>0){
        unmatchSec.style.display='';
        if(unmatchSum) unmatchSum.textContent='총 '+unmatched+'건의 인원이 자동 매칭되지 않았습니다.';
        /* 명단에 없는 학생 안내 리스트 — "X학년 Y반 Z번 김민준 학생이 명단에 없어서 매칭하지 않았습니다." */
        try {
          const listEl = document.getElementById('pastUnmatchedList');
          if(listEl){
            const unRes = await window.electronAPI.pastHistoryGetUnmatched();
            const groups = (unRes && unRes.success && Array.isArray(unRes.data)) ? unRes.data : [];
            if(groups.length === 0){
              listEl.innerHTML = '';
            } else {
              let lh = '';
              groups.forEach(function(g){
                const grade = (g.grade != null && String(g.grade).trim() !== '') ? String(g.grade).trim() : '';
                const cls   = (g.class_num != null && String(g.class_num).trim() !== '') ? String(g.class_num).trim() : '';
                const num   = (g.student_num != null && String(g.student_num).trim() !== '') ? String(g.student_num).trim() : '';
                const name  = (g.name && String(g.name).trim()) || '(이름 없음)';
                const recCnt = (g.records && g.records.length) || 0;
                let ident = '';
                if(grade) ident += grade+'학년 ';
                if(cls)   ident += cls+'반 ';
                if(num)   ident += num+'번 ';
                ident += escHtml(name);
                lh += '<div style="padding:8px 12px;border-bottom:1px solid var(--bdrl);font-size:11.5px;color:var(--t1);display:flex;align-items:center;gap:8px">'
                    + '<span style="color:#dc2626;font-weight:700;flex-shrink:0">⚠</span>'
                    + '<span style="flex:1"><b>'+ident+'</b> 학생이 명단에 없어서 매칭하지 않았습니다.</span>'
                    + '<span style="font-size:10px;color:var(--t3);background:var(--bg2);padding:2px 7px;border-radius:10px;flex-shrink:0">'+recCnt+'건</span>'
                    + '</div>';
              });
              listEl.innerHTML = lh;
            }
          }
        } catch(e){ console.error('[unmatched-list]', e); }
      } else {
        unmatchSec.style.display='none';
      }
    }
    if(unmatchBtn && !unmatchBtn._bound){
      unmatchBtn._bound=true;
      unmatchBtn.addEventListener('click', _importOpenUnmatchedModal);
      /* data-tooltip 미니 팝업 바인딩 — 일반 일지 칩과 동일 GUI */
      unmatchBtn.addEventListener('mouseenter', function(e){
        const tip=this.getAttribute('data-tooltip');
        if(tip && typeof showHeaderTooltip==='function') showHeaderTooltip(e, tip);
      });
      unmatchBtn.addEventListener('mouseleave', function(){
        if(typeof hideHeaderTooltip==='function') hideHeaderTooltip();
      });
    }
    /* 버튼 활성화 — 매칭된 건만 삽입 대상 (사용자 정책 2026-05-21: 미매칭은 보류, 매칭 후 처리).
     *  unmatched 건수는 보조 라벨로 안내만 — 명시적 처리(수동 매칭 또는 전학·전근·자퇴 chip) 필요. */
    const applyBtn=document.getElementById('pastApplyBtn');
    if(applyBtn){
      if(matched>0){
        applyBtn.disabled=false;
        applyBtn.style.cursor='pointer';
        applyBtn.style.opacity='';
        applyBtn.style.filter='';
        applyBtn.style.background='linear-gradient(135deg,#16a34a,#059669)';
        applyBtn.style.color='#fff';
        applyBtn.style.border='none';
        applyBtn.style.boxShadow='0 2px 8px rgba(22,163,74,0.3)';
        let _lbl = '📋 '+matched+'건 지금 삽입하기';
        if(unmatched>0){
          _lbl += ' <span style="font-size:10px;font-weight:600;opacity:0.85;margin-left:4px">(미매칭 '+unmatched+'건은 보류 — 매칭 처리 필요)</span>';
        }
        applyBtn.innerHTML=_lbl;
      } else {
        applyBtn.disabled=true;
        applyBtn.style.cursor='not-allowed';
        applyBtn.style.background='var(--bg2)';
        applyBtn.style.color='var(--t3)';
        applyBtn.style.border='1px solid var(--bdr)';
        applyBtn.style.boxShadow='none';
        applyBtn.innerHTML='📋 지금 삽입하기';
      }
    }
  }catch(e){console.error('[past-match-stats]',e);}
}

/* 직전 apply 의 삽입을 되돌림 — daily_records 의 그 ID 들만 정확히 삭제. */
async function _importRevertJustInserted(){
  const ids = (_pastLastInsertedIds||[]).slice();
  if(!ids.length){ alert('되돌릴 삽입 내역이 없습니다.'); return; }
  if(!await appConfirmModal('최근 삽입된 <b>'+ids.length+'</b>건을 보건일지에서 되돌립니다.<br><br>계속하시겠습니까?','최근 삽입한 기록 되돌리기')) return;
  try{
    if(window.electronAPI && window.electronAPI.pastHistoryRevertJustInserted){
      const res = await window.electronAPI.pastHistoryRevertJustInserted(ids);
      const reverted = (res && res.data && res.data.reverted) || 0;
      _pastLastInsertedIds = [];
      const msg=document.getElementById('pastApplyMsg');
      if(msg) msg.innerHTML='<div style="color:#16a34a;font-size:11px">↶ '+reverted+'건이 보건일지에서 되돌려졌습니다.</div>';
      /* S.records 재로드 + 화면 갱신 */
      try{
        const yr=String(_academicYear());
        if(window.electronAPI&&window.electronAPI.recordsGetDaily){
          const dRes=await window.electronAPI.recordsGetDaily(yr);
          if(dRes&&dRes.success&&Array.isArray(dRes.data)){
            S.records=dRes.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
          }
        }
        const busMod=await import('../../core/event-bus.js');
        if(busMod&&busMod.bus){
          busMod.bus.emit('render:daily');
          busMod.bus.emit('render:calendar');
          busMod.bus.emit('render:sidebar');
          busMod.bus.emit('render:dashboard');
        }
      }catch(_){}
      _importRefreshImportedStatus();
      try{_importShowMatchStats();}catch(_){}
    }
  }catch(e){
    alert('되돌리기 실패: '+e.message);
  }
}

/* 자동 스킵된 중복 기록 상세 — "📋 매칭 처리 내역" 섹션에 1행씩 표시.
 *  학년·반·번호 외에 학교급(여러 종) / 학과(있으면) 도 포함. */
function _importRenderDuplicateDetails(details){
  const el=document.getElementById('pastSkipDetails');
  if(!el) return;
  if(!Array.isArray(details) || details.length===0){ el.innerHTML=''; return; }
  const _lvShort={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  let _multi=false;
  try{
    const set={};
    (S.people||[]).forEach(function(s){ if(s && s.type!=='staff' && s.level) set[s.level]=true; });
    _multi=Object.keys(set).length>=2;
  }catch(_){}
  let h='<div style="padding:10px 12px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.30);border-radius:8px">';
  h+='<div style="color:#b45309;font-size:12px;font-weight:700;margin-bottom:6px">⚠ 자동 스킵된 중복 기록 ('+details.length+'건) — 이미 일반일지에 동일한 기록이 있어 추가 삽입하지 않음</div>';
  h+='<div style="display:flex;flex-direction:column;gap:3px;max-height:240px;overflow-y:auto">';
  details.forEach(function(d){
    const lvLabel=(_multi && d.level)?(_lvShort[d.level]||d.level):'';
    const parts=[];
    if(d.visit_date) parts.push('📅 '+escHtml(String(d.visit_date)));
    let id='';
    if(lvLabel) id+=lvLabel+' ';
    if(d.department) id+=escHtml(String(d.department))+' ';
    if(d.grade) id+=String(d.grade)+'학년 ';
    if(d.class_num) id+=String(d.class_num)+'반 ';
    if(d.student_num) id+=String(d.student_num)+'번 ';
    if(d.name) id+=escHtml(String(d.name));
    if(id) parts.push(id.trim());
    h+='<div style="padding:5px 8px;background:#fff;border-radius:5px;font-size:11.5px;color:var(--t1);border:1px solid var(--bdrl)">'+parts.join(' · ')+'</div>';
  });
  h+='</div></div>';
  el.innerHTML=h;
}
/* 필수 컬럼 누락 행 안내 — 파싱 단계에서 제외된 행 리스트 (옵션 1 사전 검증)
 *  - 양식 필수 컬럼: 방문일·학년·반·이름·증상·처치
 *  - 빈 배열이면 영역도 비움 (이전 업로드 잔재 제거) */
function _importRenderInvalidRows(invalidRows){
  const el=document.getElementById('pastInvalidRows');
  if(!el)return;
  if(!Array.isArray(invalidRows)||!invalidRows.length){el.innerHTML='';return;}
  const N=invalidRows.length;
  const samples=invalidRows.slice(0,5);
  let h='<div style="padding:10px 12px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.30);border-radius:8px;margin-top:8px">';
  h+='<div style="color:#dc2626;font-size:12px;font-weight:700;margin-bottom:6px">❌ 필수 컬럼 누락 — '+N+'개 행이 가져오기에서 제외되었습니다</div>';
  h+='<div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--t1);line-height:1.6;max-height:200px;overflow-y:auto">';
  samples.forEach(function(r){
    const idParts=[];
    if(r.visit_date)idParts.push(escHtml(String(r.visit_date)));
    if(r.grade)idParts.push(escHtml(String(r.grade))+'학년');
    if(r.class_num)idParts.push(escHtml(String(r.class_num))+'반');
    if(r.student_name)idParts.push(escHtml(String(r.student_name)));
    const idStr=idParts.length?' ('+idParts.join(' · ')+')':'';
    const missingStr=Array.isArray(r.missing)?r.missing.join(', '):'';
    h+='<div>• <b>'+escHtml(String(r.excelRow))+'행</b>'+idStr+' — <span style="color:#dc2626;font-weight:600">'+escHtml(missingStr)+'</span> 누락</div>';
  });
  if(N>samples.length){
    h+='<div style="margin-top:4px;font-size:10.5px;color:var(--t3)">... 외 '+(N-samples.length)+'건</div>';
  }
  h+='</div>';
  h+='<div style="margin-top:6px;font-size:10.5px;color:var(--t2);padding-top:6px;border-top:1px dashed rgba(239,68,68,0.25)">⚠ 양식 파일에서 누락된 컬럼을 채운 후 다시 업로드해주세요. 누락 행은 자동 매칭 대상에 포함되지 않습니다.</div>';
  h+='</div>';
  el.innerHTML=h;
}

async function _importShowAmbiguous(){
  /* 인라인 ③ 섹션 사용 중단 — standalone "👥 동명이인 처리" 로 일원화.
   * 두 섹션이 같은 데이터를 따로 그리면서 데이터 형식 불일치(raw row vs grouped) 로 한쪽이 에러 → 시각적으로 사라짐.
   * 사용자 보고(2026-05-11): "맨 처음 학생만 누르면 아래가 쫘악 없어진다" → 인라인이 죽는 현상.
   * 해결: 인라인 섹션 비표시 + standalone 단일 렌더로 통일. */
  const section=document.getElementById('pastAmbiguousSection');
  if(section)section.style.display='none';
  return;
  /* 이하 죽은 코드 — 인라인 섹션 복구 시 참고용으로만 보존. 실제로는 위 return 으로 도달 불가. */
  // eslint-disable-next-line no-unreachable
  try{
    const res=await window.electronAPI.pastHistoryGetAmbiguous();
    if(!res||!res.success||!res.data||!res.data.length){section.style.display='none';return;}
    section.style.display='';
    const list=document.getElementById('pastAmbiguousList');
    if(!list)return;
    let h='';
    res.data.forEach(function(group,gi){
      h+='<div class="cc" style="padding:10px;margin-bottom:8px">';
      h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">📌 "'+escHtml(group.name)+'" — '+group.records.length+'건의 과거 기록</div>';
      if(group.records.length>0){
        const preview=group.records.slice(0,3);
        h+='<div style="font-size:10px;color:var(--t3);margin-bottom:6px">';
        preview.forEach(function(r){h+='<div>'+escHtml(r.visit_date||'')+' | '+escHtml(r.grade||'')+'-'+escHtml(r.class_num||'')+' | '+escHtml(r.symptoms||'')+'</div>';});
        if(group.records.length>3)h+='<div>...외 '+(group.records.length-3)+'건</div>';
        h+='</div>';
      }
      h+='<div style="font-size:10.5px;font-weight:600;color:var(--t2);margin-bottom:4px">해당 학생 선택:</div>';
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
      const recIdsStr=JSON.stringify(group.records.map(function(r){return r.id;}));
      (group.candidates||[]).forEach(function(c){
        const label=escHtml(c.name)+' ('+escHtml(String(c.grade))+'학년 '+escHtml(String(c.class_num))+'반 '+escHtml(String(c.student_num))+'번'+(c.birth_date?', '+escHtml(c.birth_date):'')+')';
        h+='<button class="btn btn-sm" style="font-size:10px;padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;background:var(--card);color:var(--t1);cursor:pointer" '
          +'data-rec-ids=\''+recIdsStr.replace(/'/g,'&#39;')+'\' data-stu-id="'+c.id+'" '
          +'data-action="resolve-ambiguous">'+label+'</button>';
      });
      h+='<button class="btn btn-sm" style="font-size:10px;padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;background:var(--card);color:var(--t3);cursor:pointer" '
        +'data-rec-ids=\''+recIdsStr.replace(/'/g,'&#39;')+'\' '
        +'data-action="resolve-ambiguous-skip">건너뛰기</button>';
      h+='</div>';
      h+='</div>';
    });
    list.innerHTML=h;
    /* delegated click 1회만 바인딩 — 핸들러 누적 방지 (standalone 과 동일 이슈) */
    if(!list.__ambResolveBound){
      list.__ambResolveBound=true;
      list.addEventListener('click',function(e){
        const btn=e.target.closest('[data-action]');
        if(!btn)return;
        const action=btn.dataset.action;
        let recIds=[];
        try{ recIds=JSON.parse(btn.dataset.recIds||'[]'); }catch(_){ recIds=[]; }
        if(action==='resolve-ambiguous'){_importResolveAmbiguous(btn,btn.dataset.stuId,recIds);}
        else if(action==='resolve-ambiguous-skip'){_importResolveAmbiguousSkip(btn,recIds);}
      });
    }
  }catch(e){console.error('[past-ambiguous]',e);section.style.display='none';}
}
async function _importResolveAmbiguous(btnEl,studentId,recordIds){
  try{
    const res=await window.electronAPI.pastHistoryResolveAmbiguous(recordIds,studentId);
    if(res&&res.success){
      /* 실제 매칭된 행 수가 0 이면 stale ID 클릭이므로 사용자에게 명시 */
      const changed=(res.data&&typeof res.data.changes==='number')?res.data.changes:null;
      const card=btnEl.closest('.cc');
      if(card){
        if(changed===0){
          card.innerHTML='<div style="color:#dc2626;font-size:11px;font-weight:600;padding:4px">⚠ 이미 처리되었거나 만료된 항목입니다. 화면이 갱신됩니다.</div>';
        } else {
          card.innerHTML='<div style="color:#16a34a;font-size:11px;font-weight:600;padding:4px">✅ 매칭 완료 (학생 ID: '+escHtml(String(studentId))+')</div>';
        }
      }
      _importShowMatchStats();
    }else{alert('매칭 실패: '+((res&&res.error)||''));}
  }catch(e){alert('오류: '+e.message);}
}
async function _importResolveAmbiguousSkip(btnEl,recordIds){
  try{
    const res=await window.electronAPI.pastHistoryResolveAmbiguous(recordIds,null);
    if(res&&res.success){
      const card=btnEl.closest('.cc');
      if(card)card.innerHTML='<div style="color:var(--t3);font-size:11px;padding:4px">⏭ 건너뛰기 완료</div>';
      _importShowMatchStats();
    }else{alert('처리 실패: '+((res&&res.error)||''));}
  }catch(e){alert('오류: '+e.message);}
}
async function _importPastApply(){
  const btn=document.getElementById('pastApplyBtn');
  const msg=document.getElementById('pastApplyMsg');
  /* 삽입 중에는 버튼 비활성 — 더블 클릭 방지 */
  if(btn){btn.disabled=true;btn.style.cursor='not-allowed';btn.style.opacity='0.6';}
  if(msg)msg.innerHTML='<div style="color:var(--t3);font-size:11px">📦 반영 중...</div>';
  try{
    const res=await window.electronAPI.pastHistoryApply();
    if(res&&res.success){
      const d=res.data||{};
      const applied=d.applied||0, duplicates=d.duplicates||0, skipped=d.skipped||0;
      const placeheld=d.placeheld||0, placeheldDup=d.placeheldDuplicates||0;
      const samples=Array.isArray(d.skipSamples)?d.skipSamples:[];
      let extra='';
      if(duplicates>0)extra+=' (이미 일반일지에 완전히 동일한 기록이 있어 '+duplicates+'건 자동 스킵)';
      if(skipped>0)extra+=' (검증 실패 '+skipped+'건 스킵)';
      if(placeheldDup>0)extra+=' (명단 미등록 중복 '+placeheldDup+'건 자동 스킵)';
      const placeheldNote = placeheld>0
        ? '<div style="margin-top:6px;color:#b45309;font-size:11px;font-weight:600">⚠ 명단에 없는 학생 '+placeheld+'건은 임시 보관 상태로 삽입했습니다 — "📋 매칭 처리 내역" 에서 매칭하거나 삭제하세요.</div>'
        : '';
      let html='<div style="color:#16a34a;font-size:11px;font-weight:600">✅ '+applied+'건이 보건일지에 반영되었습니다.'+extra+'</div>'+placeheldNote;
      /* 진단용: 검증 실패가 있으면 처음 몇 건의 실제 사유를 노출 → 어떤 엑셀 컬럼이 문제인지 즉시 보임 */
      if(skipped>0 && samples.length>0){
        html+='<div style="margin-top:10px;padding:10px 12px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);border-radius:8px">';
        html+='<div style="color:#b91c1c;font-size:12px;font-weight:700;margin-bottom:6px">⚠ 검증 실패 사유 (샘플 '+samples.length+'건)</div>';
        html+='<div style="color:var(--t2);font-size:11px;line-height:1.6">엑셀의 컬럼명/날짜 형식이 양식과 다른 경우 발생합니다. 아래를 보고 문제 컬럼을 확인하세요:</div>';
        html+='<ul style="margin:6px 0 0 0;padding-left:18px;color:var(--t2);font-size:11px;line-height:1.6">';
        samples.forEach(function(s){
          const errs=(s.errors||[]).join(' / ');
          html+='<li><b>'+escHtml(String(s.name||'?'))+'</b> · 방문일=<code style="background:#fff;padding:1px 4px;border-radius:3px">'+escHtml(String(s.visit_date||''))+'</code>'+(s.time_in?' · 입실='+escHtml(String(s.time_in)):'')+'<br><span style="color:#b91c1c">'+escHtml(errs)+'</span></li>';
        });
        html+='</ul>';
        html+='<div style="margin-top:8px;color:var(--t3);font-size:10.5px;line-height:1.6">💡 가장 흔한 원인: 엑셀의 "방문일" 컬럼명이 다른 이름(예: 내원일, 일시, 보건일 작성일)이거나, 날짜가 비어 있거나, 한 자리 시간(예: 9:30)인 경우입니다.</div>';
        html+='</div>';
      }
      if(msg)msg.innerHTML=html;
      /* 방금 삽입한 daily_records ID 저장 — "↶ N건 삽입 되돌리기" 버튼 동작에 사용 */
      _pastLastInsertedIds = Array.isArray(d.insertedIds) ? d.insertedIds.slice() : [];
      /* 자동 스킵 상세 — "📋 매칭 처리 내역" 섹션에 1행씩 표시 */
      try { _importRenderDuplicateDetails(Array.isArray(d.duplicateDetails)?d.duplicateDetails:[]); } catch(_){}
      /* 명단 미등록 placeholder 리스트 갱신 (방금 삽입된 항목 포함) */
      try { _loadPlaceholderList(); } catch(_){}
      _importRefreshImportedStatus();
      /* 반영 후 S.records 재로드 + S.people/S.leavers 갱신 + 달력·일지·사이드바 재렌더링.
       *  apply 중 자동 ghost 등록된 인원이 즉시 일반일지에 이름으로 표시되려면 S.leavers 재로드 필수. */
      try{
        const yr=String(_academicYear());
        if(window.electronAPI&&window.electronAPI.recordsGetDaily){
          const dRes=await window.electronAPI.recordsGetDaily(yr);
          if(dRes&&dRes.success&&Array.isArray(dRes.data)){
            S.records=dRes.data.map(function(r){if(r.personUid!==undefined&&r.studentId===undefined)r.studentId=r.personUid;return r;});
            S.nextId=Math.max(1012,...S.records.map(function(r){return r.id||0;}))+1;
            S.records.forEach(function(r){if(r.bodymapData&&r.bodymapData.length>0){window._bmData=window._bmData||{};window._bmData[r.id]=r.bodymapData;}});
          }
        }
        /* ghost 등록된 인원이 S.leavers 에 반영되도록 학생/교직원 명단 재로드 */
        try {
          const stuUtils = await import('../../core/student-utils.js');
          if(stuUtils && stuUtils._reloadStudentsFromDB) await stuUtils._reloadStudentsFromDB();
        } catch(_){}
        /* bus 이벤트로 관련 화면 재렌더링 */
        const busMod=await import('../../core/event-bus.js');
        if(busMod&&busMod.bus){
          busMod.bus.emit('render:daily');
          busMod.bus.emit('render:calendar');
          busMod.bus.emit('render:sidebar');
          busMod.bus.emit('render:dashboard');
        }
      }catch(reloadErr){console.error('[import-apply] 재로드 실패:',reloadErr);}
      /* 삽입 성공 후 — staging 정리됨. 통계 다시 그려 두 버튼이 0건 상태로 비활성 표시되게 함. */
      try{ _importShowMatchStats(); }catch(_){}
    }else{
      if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ '+escHtml((res&&res.error)||'반영 실패')+'</div>';
      /* 실패 — 버튼 복원 */
      if(btn){btn.disabled=false;btn.style.cursor='pointer';btn.style.opacity='';}
      if(cancelBtn){cancelBtn.disabled=false;cancelBtn.style.cursor='pointer';cancelBtn.style.opacity='';}
    }
  }catch(e){
    if(msg)msg.innerHTML='<div style="color:#dc2626;font-size:11px">❌ 오류: '+escHtml(e.message)+'</div>';
    /* 예외 — 버튼 복원 */
    if(btn){btn.disabled=false;btn.style.cursor='pointer';btn.style.opacity='';}
    if(cancelBtn){cancelBtn.disabled=false;cancelBtn.style.cursor='pointer';cancelBtn.style.opacity='';}
  }
}
/* 매칭 처리 내역 카드 안에 미매칭 명단 렌더링 — staging 의 unmatched 행 목록.
 *  사용자 정책 (2026-05-22): 각 행에 [🔗 매칭] [🚌 전근·전학·자퇴] [🗑 삭제] 3버튼. */
export async function _loadUnmatchedStandalone(){
  const el=document.getElementById('pastUnmatchedStandalone');
  if(!el||!window.electronAPI||!window.electronAPI.pastHistoryGetUnmatched)return;
  try{
    const res=await window.electronAPI.pastHistoryGetUnmatched();
    const groups=(res&&res.success&&Array.isArray(res.data))?res.data:[];
    if(!groups.length){ el.innerHTML=''; return; }
    const n=groups.length;
    let h='<div style="padding:10px 12px;background:rgba(220,38,38,0.05);border:1px solid rgba(220,38,38,0.25);border-radius:8px">';
    h+='<div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:8px">⚠ 매칭 안 한 인원 ('+n+'건) — 처치자 입력 후 확인(변환 시작) 버튼을 클릭</div>';
    /* 일괄 처리 버튼 — 130건처럼 많을 때 한 번에 처리 */
    h+='<div style="display:flex;gap:6px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed rgba(220,38,38,0.25);flex-wrap:wrap">';
    h+='<button class="btn btn-sm" id="umBulkMatch" style="padding:6px 12px;font-size:10.5px;font-weight:700;background:rgba(6,182,212,0.10);color:var(--cyan);border:1px solid rgba(6,182,212,0.40);border-radius:6px;cursor:pointer">🔗 일괄 수동 매칭</button>';
    h+='<button class="btn btn-sm" id="umBulkLeaver" style="padding:6px 12px;font-size:10.5px;font-weight:700;background:rgba(168,85,247,0.10);color:#a855f7;border:1px solid rgba(168,85,247,0.40);border-radius:6px;cursor:pointer">🚌 일괄 전학·자퇴·전근 ('+n+'건)</button>';
    h+='<button class="btn btn-sm" id="umBulkDelete" style="padding:6px 12px;font-size:10.5px;font-weight:700;background:rgba(220,38,38,0.08);color:#dc2626;border:1px solid rgba(220,38,38,0.30);border-radius:6px;cursor:pointer">🗑 일괄 삭제 ('+n+'건)</button>';
    h+='</div>';
    h+='<div style="display:flex;flex-direction:column;gap:5px;max-height:320px;overflow-y:auto">';
    groups.forEach(function(g){
      /* records 의 첫 staging id 를 대표로 사용 — 백엔드가 같은 식별정보 행들을 일괄 처리 */
      const repId=(g.records&&g.records.length&&g.records[0].id)||0;
      const grade=(g.grade!=null&&String(g.grade).trim()!=='')?String(g.grade).trim():'';
      const cls  =(g.class_num!=null&&String(g.class_num).trim()!=='')?String(g.class_num).trim():'';
      const num  =(g.student_num!=null&&String(g.student_num).trim()!=='')?String(g.student_num).trim():'';
      const name =(g.name&&String(g.name).trim())||'(이름 없음)';
      const recCnt=(g.records&&g.records.length)||0;
      let ident='';
      if(grade) ident+=grade+'학년 ';
      if(cls)   ident+=cls+'반 ';
      if(num)   ident+=num+'번 ';
      ident+=escHtml(name);
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff;border-radius:6px;border:1px solid var(--bdrl)">';
      h+='<span style="font-size:11px;color:var(--t1);flex:1"><b>'+ident+'</b> <span style="font-size:10px;color:var(--t3);background:var(--bg2);padding:1px 7px;border-radius:10px;margin-left:6px">'+recCnt+'건</span></span>';
      h+='<button class="btn btn-sm" data-um-match="'+repId+'" style="padding:4px 10px;font-size:10.5px;font-weight:700;background:rgba(6,182,212,0.10);color:var(--cyan);border:1px solid rgba(6,182,212,0.40);border-radius:5px;cursor:pointer">🔗 매칭</button>';
      h+='<button class="btn btn-sm" data-um-leaver="'+repId+'" title="외부 엑셀의 학년 정보를 보고 학생/교직원을 자동 판단해 신규 uid 로 등록합니다" style="padding:4px 10px;font-size:10.5px;font-weight:700;background:rgba(168,85,247,0.10);color:#a855f7;border:1px solid rgba(168,85,247,0.40);border-radius:5px;cursor:pointer">🚌 전학·자퇴·전근</button>';
      h+='<button class="btn btn-sm" data-um-delete="'+repId+'" style="padding:4px 10px;font-size:10.5px;font-weight:700;background:rgba(220,38,38,0.08);color:#dc2626;border:1px solid rgba(220,38,38,0.30);border-radius:5px;cursor:pointer">🗑 삭제</button>';
      h+='</div>';
    });
    h+='</div></div>';
    el.innerHTML=h;
    /* 이벤트 위임 */
    el.querySelectorAll('[data-um-match]').forEach(function(b){
      b.addEventListener('click', function(){ _unmatchedInlineMatch(parseInt(this.dataset.umMatch,10)); });
    });
    el.querySelectorAll('[data-um-leaver]').forEach(function(b){
      b.addEventListener('click', function(){ _unmatchedInlineLeaver(parseInt(this.dataset.umLeaver,10)); });
    });
    el.querySelectorAll('[data-um-delete]').forEach(function(b){
      b.addEventListener('click', function(){ _unmatchedInlineDelete(parseInt(this.dataset.umDelete,10)); });
    });
    /* 일괄 처리 버튼 핸들러 */
    const bmBtn = el.querySelector('#umBulkMatch');
    if(bmBtn) bmBtn.addEventListener('click', function(){ _importOpenUnmatchedModal(); });
    const blBtn = el.querySelector('#umBulkLeaver');
    if(blBtn) blBtn.addEventListener('click', function(){ _unmatchedBulkLeaver(groups); });
    const bdBtn = el.querySelector('#umBulkDelete');
    if(bdBtn) bdBtn.addEventListener('click', function(){ _unmatchedBulkDelete(groups); });
  }catch(e){
    console.error('[unmatched-standalone]', e);
    el.innerHTML='<div style="color:#dc2626;font-size:11px">오류: '+escHtml(e.message)+'</div>';
  }
}

/* 매칭 처리 내역 [🔗 매칭] — 수동 매칭 모달을 해당 인원에서 시작 */
function _unmatchedInlineMatch(stagingId){
  if(!stagingId) return;
  _importOpenUnmatchedModal(stagingId);
}

/* 매칭 처리 내역 [🚌 전학·자퇴·전근] — stagingRowAsLeaver 호출 (같은 식별정보 일괄) */
async function _unmatchedInlineLeaver(stagingId){
  if(!stagingId) return;
  const ok = await appConfirmModal(
    '현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 보건일지 기록을 데이터베이스에 저장하시겠습니까?<br><br><span style="color:#dc2626;font-weight:700">아래에 예를 클릭하는 경우 위 초록색 삽입 확인 버튼을 반드시 눌러주세요.</span>',
    '전근·전학·자퇴 처리',
    {
      okLabel: '예 (그냥 데이터베이스에 등록하겠습니다)',
      cancelLabel: '아니오 (정확한 인원 매칭을 하여 등록하겠습니다)',
      vertical: true,
      okBg: 'rgba(168,85,247,0.10)',
      okBorder: 'rgba(168,85,247,0.40)',
      okColor: '#a855f7',
    }
  );
  if(!ok) return;
  try{
    const res=await window.electronAPI.pastHistoryStagingRowAsLeaver(stagingId);
    if(res && res.success){
      try{ _importShowMatchStats(); }catch(_){}
    } else {
      await _showResultModal('자동 등록 실패: '+((res&&res.error)||'알 수 없음'),'전학·자퇴·전근 처리','warn');
    }
  }catch(e){ await _showResultModal('오류: '+e.message,'전학·자퇴·전근 처리','warn'); }
}

/* 매칭 처리 내역 [🗑 삭제] — staging 의 같은 식별정보 행 일괄 삭제 */
async function _unmatchedInlineDelete(stagingId){
  if(!stagingId) return;
  if(!await appConfirmModal('이 미매칭된 인원을 삭제합니다.','미매칭 인원 삭제')) return;
  try{
    const res=await window.electronAPI.pastHistoryDeleteStagingRow(stagingId);
    if(res && res.success){
      try{ _importShowMatchStats(); }catch(_){}
    } else {
      await _showResultModal('삭제 실패: '+((res&&res.error)||'알 수 없음'),'미매칭 인원 삭제','warn');
    }
  }catch(e){ await _showResultModal('오류: '+e.message,'미매칭 인원 삭제','warn'); }
}

/* 일괄 처리 결과 알림 — 앱 모달 UI 와 일치하는 단일 버튼 정보 모달 (appConfirmModal 사용, "닫기" 버튼만 노출) */
function _showResultModal(msg, title, color){
  const okBg = color==='success' ? 'rgba(22,163,74,0.10)' : (color==='warn' ? 'rgba(245,158,11,0.10)' : 'rgba(6,182,212,0.10)');
  const okBorder = color==='success' ? 'rgba(22,163,74,0.40)' : (color==='warn' ? 'rgba(245,158,11,0.45)' : 'rgba(6,182,212,0.40)');
  const okColor = color==='success' ? '#16a34a' : (color==='warn' ? '#d97706' : 'var(--cyan)');
  return appConfirmModal(msg, title, { okLabel:'닫기', cancelLabel:'', vertical:true, okBg, okBorder, okColor });
}

/* 일괄 전학·자퇴·전근 — 모든 미매칭 그룹을 신규 uid 로 등록 */
async function _unmatchedBulkLeaver(groups){
  const n=(groups&&groups.length)||0;
  if(!n) return;
  const ok=await appConfirmModal(
    '미매칭된 <b>'+n+'명 전원</b>을 현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 <b>신규 uid 로 일괄 등록</b>합니다.<br><br><span style="color:#dc2626;font-weight:700">처리 후 위쪽 「📋 N건 지금 삽입하기」 버튼을 눌러 일반일지에 반영해 주세요.</span>',
    '일괄 전학·자퇴·전근 처리',
    { okLabel:'예, '+n+'명 모두 처리합니다', cancelLabel:'아니오', vertical:true,
      okBg:'rgba(168,85,247,0.10)', okBorder:'rgba(168,85,247,0.40)', okColor:'#a855f7' }
  );
  if(!ok) return;
  let okCnt=0, failCnt=0;
  for(const g of groups){
    const sid=(g.records&&g.records.length&&g.records[0].id)||0;
    if(!sid){ failCnt++; continue; }
    try{
      const res=await window.electronAPI.pastHistoryStagingRowAsLeaver(sid);
      if(res && res.success) okCnt++; else failCnt++;
    }catch(_){ failCnt++; }
  }
  try{ _importShowMatchStats(); }catch(_){}
  await _showResultModal('성공 <b>'+okCnt+'명</b>'+(failCnt?' / 실패 <b style="color:#dc2626">'+failCnt+'명</b>':'')+' 처리되었습니다.', '일괄 전학·자퇴·전근 완료', failCnt?'warn':'success');
}

/* 일괄 삭제 — 모든 미매칭 그룹을 staging 에서 제거 */
async function _unmatchedBulkDelete(groups){
  const n=(groups&&groups.length)||0;
  if(!n) return;
  const ok=await appConfirmModal(
    '미매칭된 <b>'+n+'명 전원</b>의 기록을 staging 에서 <b>삭제</b>합니다.<br><br>이 동작은 되돌릴 수 없습니다.',
    '일괄 삭제',
    { okLabel:'예, '+n+'명 모두 삭제합니다', cancelLabel:'아니오', vertical:true,
      okBg:'rgba(220,38,38,0.10)', okBorder:'rgba(220,38,38,0.45)', okColor:'#dc2626' }
  );
  if(!ok) return;
  let okCnt=0, failCnt=0;
  for(const g of groups){
    const sid=(g.records&&g.records.length&&g.records[0].id)||0;
    if(!sid){ failCnt++; continue; }
    try{
      const res=await window.electronAPI.pastHistoryDeleteStagingRow(sid);
      if(res && res.success) okCnt++; else failCnt++;
    }catch(_){ failCnt++; }
  }
  try{ _importShowMatchStats(); }catch(_){}
  await _showResultModal('성공 <b>'+okCnt+'명</b>'+(failCnt?' / 실패 <b style="color:#dc2626">'+failCnt+'명</b>':'')+' 삭제되었습니다.', '일괄 삭제 완료', failCnt?'warn':'success');
}

export async function _loadAmbiguousStandalone(){
  const el=document.getElementById('pastAmbiguousStandalone');
  if(!el||!window.electronAPI||!window.electronAPI.pastHistoryGetAmbiguous)return;
  try{
    const res=await window.electronAPI.pastHistoryGetAmbiguous();
    if(!res||!res.success||!res.data||!res.data.length){
      /* 동명이인 미해결 0건 — 이 wrapper 는 매칭 처리 내역 카드 안의 동명이인 영역이고
       *  카드에는 스킵 내역(pastSkipDetails) 등 다른 메시지도 함께 들어오므로 비워둠 (2026-05-18) */
      el.innerHTML='';
      return;
    }
    const n=res.data.length;
    /* 인라인 카드 → 모달 진입 버튼 한 개로 변경.
     * 카드 리스트는 클릭 누락·중복 매칭 위험이 있어 한 건씩 모달에서 처리하도록 일원화. */
    el.innerHTML='<div style="display:flex;align-items:center;gap:10px;padding:6px 0">'
      +'<div style="flex:1;font-size:12px;color:var(--t2);line-height:1.6">⚠ 동명이인 미해결 <b style="color:#ca8a04">'+n+'건</b> — 한 건씩 어느 학생의 기록인지 확인이 필요합니다.</div>'
      +'<button id="amOpenModalBtn" class="btn btn-sm" style="padding:9px 16px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:7px;cursor:pointer;box-shadow:0 2px 6px rgba(245,158,11,0.25)">🔗 동명이인 매칭 ('+n+'건)</button>'
      +'</div>';
    const btn=document.getElementById('amOpenModalBtn');
    if(btn) btn.addEventListener('click', _amOpenModal);
  }catch(e){el.innerHTML='<div style="color:#dc2626;font-size:11px">오류: '+escHtml(e.message)+'</div>';}
}

/* ════════════════════════════════════════════════════════════
   외부 데이터 동명이인 매칭 모달 — 인원 데이터 관리(person-manager-view.js)
   의 `openAmbiguousMatchModal` 과 동일 패턴.
   헤더(드래그) · 1/N 카운터 · ◀▶ 좌우 네비 · 학교급/학년 칩 ·
   반 카드 그리드(번호+이름) · 학생 클릭 = 매칭 + 자동 다음 항목 이동.
   ════════════════════════════════════════════════════════════ */
let _amState = null;
let _amKeyHandler = null;

async function _amOpenModal(){
  if(!window.electronAPI||!window.electronAPI.pastHistoryGetAmbiguous){
    alert('이 기능은 새 버전에서 사용 가능합니다.');
    return;
  }
  const res = await window.electronAPI.pastHistoryGetAmbiguous();
  if(!res||!res.success){
    alert('동명이인 목록 조회 실패: '+((res&&res.error)||''));
    return;
  }
  const items = res.data||[];
  if(!items.length){
    alert('동명이인 미해결 건이 없습니다.');
    return;
  }
  /* 활성 학생 명단 — 학교급/학년/반 칩 + 반 카드 그리드 의 데이터 소스 */
  const students = (S.people||[]).filter(function(p){
    return p.type==='student' && p.is_active!==false && p.is_active!==0;
  });
  /* 학교급 종류 추출 */
  const levelSet={};
  students.forEach(function(s){ if(s.level) levelSet[s.level]=true; });
  const levels = Object.keys(levelSet);
  if(!levels.length) levels.push('elementary');
  /* 초기 학교급·학년: 첫 레코드의 과거 학년을 힌트로 사용. staging 에는 level 이 없어서
     이름이 같은 학생들의 level 중 첫 번째를 기본값으로 채택 (없으면 levels[0]). */
  const firstName = items[0].student_name || '';
  const sameName = students.filter(function(s){ return s.name===firstName; });
  const initLevel = (sameName[0] && sameName[0].level) || items[0].level || levels[0];
  const initGrade = (items[0].grade != null && items[0].grade !== '') ? String(items[0].grade)
                  : (sameName[0] && sameName[0].grade != null ? String(sameName[0].grade) : '');
  _amState = {
    items: items,
    idx: 0,
    students: students,
    selectedLevel: initLevel,
    selectedGrade: initGrade,
    levels: levels
  };
  _amRenderModal();
}

function _amRenderModal(){
  const st = _amState;
  if(!st) return;
  const old = document.getElementById('amModal');
  if(old) old.remove();
  const ov = document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='amModal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;z-index:9999';
  ov.innerHTML = _amBuildHtml();
  document.body.appendChild(ov);
  _amBindEvents(ov);
  _amRenderClassGrid();
}

function _amEsc(s){ return escHtml(s == null ? '' : String(s)); }

function _amBuildHtml(){
  const st = _amState;
  const cur = st.items[st.idx];
  const total = st.items.length;
  const pct = ((st.idx+1)/total*100).toFixed(1);
  const meta = _umBuildMeta(cur);
  const symPrev = cur.symptoms ? (String(cur.symptoms).length>60 ? String(cur.symptoms).slice(0,60)+'…' : String(cur.symptoms)) : '';
  let h = '<div class="modal-content am-modal" id="amModalBox" style="width:840px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(0,0,0,0.08);box-shadow:0 24px 60px rgba(0,0,0,0.30);position:relative">';
  /* 헤더 (회색 + 드래그) */
  h += '<div class="am-head" id="amDragHandle" style="padding:12px 16px;display:flex;gap:10px;align-items:center;background:linear-gradient(180deg,#eef2f6,#e5e9ee);border-bottom:1px solid var(--bdr);cursor:grab;user-select:none">'
    + '<span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0.5"><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span></span>'
    + '<span style="font-size:13px;font-weight:700;color:var(--t1);flex:1">🔗 외부 데이터 동명이인 매칭 — 이 보건기록이 누구 것인지 확인</span>'
    + '<span id="amCounter" style="font-size:10.5px;padding:3px 9px;background:rgba(245,158,11,0.12);color:#ca8a04;border-radius:10px;font-weight:700">'+(st.idx+1)+' / '+total+'</span>'
    + '</div>';
  /* 진행 막대 */
  h += '<div style="height:3px;background:var(--bdrl);position:relative;overflow:hidden"><div id="amProgress" style="height:100%;background:linear-gradient(90deg,#f59e0b,#d97706);width:'+pct+'%;transition:width .25s ease"></div></div>';
  /* 레코드 정보 + ◀▶ */
  h += '<div style="padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl);background:linear-gradient(180deg,rgba(245,158,11,0.05),transparent)">'
    + '<button class="am-nav" data-am-nav="prev" '+(st.idx===0?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx===0?';opacity:0.35;cursor:not-allowed':'')+'">◀</button>'
    + '<div style="flex:1;padding:8px 14px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.22);border-radius:9px;display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:16px">📌</span>'
      + '<div style="flex:1"><div id="amRecName" style="font-size:13px;font-weight:800;color:var(--t1)">'+_amEsc(cur.student_name||'(이름 없음)')+'</div>'
      + '<div id="amRecMeta" style="font-size:10.5px;color:var(--t2);margin-top:1px">'
        + (cur.visit_date?'📅 '+_amEsc(cur.visit_date)+' · ':'')
        + (meta?'과거 '+_amEsc(meta):'학번 누락')
        + (symPrev?' · 💬 '+_amEsc(symPrev):'')
        + '</div></div>'
      + '<span style="font-size:9.5px;font-weight:700;color:#dc2626;background:rgba(239,68,68,0.10);padding:3px 8px;border-radius:8px">동명이인</span>'
    + '</div>'
    + '<button class="am-nav" data-am-nav="next" '+(st.idx>=total-1?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx>=total-1?';opacity:0.35;cursor:not-allowed':'')+'">▶</button>'
    + '</div>';
  /* 학교급 칩 — 2개 이상일 때만 표시 */
  h += '<div id="amLvRow" style="padding:10px 16px;display:'+(st.levels.length>=2?'flex':'none')+';align-items:center;gap:10px;border-bottom:1px solid var(--bdrl)">'+_amLvRowInner()+'</div>';
  /* 학년 칩 */
  const _grInner = _amGrRowInner();
  h += '<div id="amGrRow" style="padding:10px 16px;display:'+(_grInner?'flex':'none')+';gap:10px;align-items:center;border-bottom:1px solid var(--bdrl);flex-wrap:wrap">'+_grInner+'</div>';
  /* 반 카드 그리드 */
  h += '<div class="am-body" id="amClassGrid" style="flex:1;padding:14px 16px;overflow-y:auto"></div>';
  /* 푸터 */
  h += '<div style="padding:9px 16px;border-top:1px solid var(--bdrl);display:flex;flex-direction:column;gap:6px;background:#fafbfc">'
    + '<div style="display:flex;align-items:center;gap:10px">'
    +   '<span style="font-size:9.5px;color:var(--t3);flex:1">← / →: 이전·다음 / Esc: 닫기 / 제목 행 드래그로 창 이동</span>'
    +   '<button class="am-skip" style="padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--bdr);background:#fff;color:var(--t2)">⏭ 건너뛰기</button>'
    + '</div>'
    /* 사용자 정책 (2026-05-21): 건너뛰기 아래에 전학·자퇴·전근 칩 — 클릭 시 확인 모달 → "예" 선택 시 신규 등록 + matched 처리 */
    + '<button class="am-leaver" title="현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 보건일지 기록을 데이터베이스에 저장합니다." style="padding:8px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px dashed rgba(168,85,247,0.50);background:rgba(168,85,247,0.08);color:#a855f7;width:100%;text-align:center">🚌 전근·전학·자퇴 등으로 현재 없는 인원</button>'
    + '</div>';
  h += '</div>';
  return h;
}

/* 학교급 칩 inner HTML */
function _amLvRowInner(){
  const st = _amState;
  if(!st || st.levels.length<2) return '';
  const lvLabel={elementary:'초등학교',middle:'중학교',high:'고등학교',kindergarten:'유치원',special:'특수학교'};
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학교급</span>'
    + '<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px">';
  st.levels.forEach(function(lv){
    const act=st.selectedLevel===lv;
    h += '<button class="am-lv" data-am-lv="'+_amEsc(lv)+'" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(act?'var(--card)':'transparent')+';color:'+(act?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer'+(act?';box-shadow:0 1px 3px rgba(0,0,0,0.08)':'')+'">'+(lvLabel[lv]||lv)+'</button>';
  });
  h += '</div>';
  return h;
}

/* 학년 칩 inner HTML */
function _amGrRowInner(){
  const st = _amState;
  if(!st) return '';
  const grades = _amGetGrades(st.selectedLevel);
  if(!grades.length) return '';
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학년</span>';
  grades.forEach(function(g){
    const act=String(st.selectedGrade)===String(g);
    h += '<button class="am-gr" data-am-gr="'+_amEsc(g)+'" style="padding:5px 12px;font-size:11px;font-weight:600;border:1px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--card)')+';color:'+(act?'#fff':'var(--t2)')+';border-radius:14px;cursor:pointer'+(act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'')+'">'+_amEsc(g)+'학년</button>';
  });
  return h;
}

function _amGetGrades(level){
  const set={};
  (_amState.students||[]).forEach(function(s){
    if(level && s.level && s.level!==level) return;
    if(s.grade!==undefined && s.grade!==null && s.grade!=='') set[String(s.grade)]=true;
  });
  return Object.keys(set).sort(function(a,b){
    const na=parseInt(a,10), nb=parseInt(b,10);
    if(!isNaN(na)&&!isNaN(nb)) return na-nb;
    return a.localeCompare(b);
  });
}

/* 항목 변경 시 부분 갱신 — 모달 유지, 정보만 갱신 */
function _amApplyItemChange(){
  const ov = document.getElementById('amModal');
  if(!ov || !_amState) return;
  const st = _amState;
  const cur = st.items[st.idx];
  const total = st.items.length;
  const counter = ov.querySelector('#amCounter');
  if(counter) counter.textContent = (st.idx+1)+' / '+total;
  const prog = ov.querySelector('#amProgress');
  if(prog) prog.style.width = ((st.idx+1)/total*100).toFixed(1)+'%';
  const meta = _umBuildMeta(cur);
  const symPrev = cur.symptoms ? (String(cur.symptoms).length>60 ? String(cur.symptoms).slice(0,60)+'…' : String(cur.symptoms)) : '';
  const nameEl = ov.querySelector('#amRecName');
  if(nameEl) nameEl.textContent = cur.student_name || '(이름 없음)';
  const metaEl = ov.querySelector('#amRecMeta');
  if(metaEl) metaEl.textContent = (cur.visit_date?'📅 '+cur.visit_date+' · ':'') + (meta?'과거 '+meta:'학번 누락') + (symPrev?' · 💬 '+symPrev:'');
  const prevBtn = ov.querySelector('[data-am-nav="prev"]');
  if(prevBtn){
    if(st.idx===0){ prevBtn.setAttribute('disabled',''); prevBtn.style.opacity='0.35'; prevBtn.style.cursor='not-allowed'; }
    else{ prevBtn.removeAttribute('disabled'); prevBtn.style.opacity=''; prevBtn.style.cursor='pointer'; }
  }
  const nextBtn = ov.querySelector('[data-am-nav="next"]');
  if(nextBtn){
    if(st.idx>=total-1){ nextBtn.setAttribute('disabled',''); nextBtn.style.opacity='0.35'; nextBtn.style.cursor='not-allowed'; }
    else{ nextBtn.removeAttribute('disabled'); nextBtn.style.opacity=''; nextBtn.style.cursor='pointer'; }
  }
  /* 학교급/학년 칩 + 반 그리드 갱신 */
  _amApplyFilterChange();
}

function _amApplyFilterChange(){
  const ov = document.getElementById('amModal');
  if(!ov || !_amState) return;
  const lvRow = ov.querySelector('#amLvRow');
  if(lvRow){
    lvRow.innerHTML = _amLvRowInner();
    lvRow.style.display = (_amState.levels.length>=2) ? 'flex' : 'none';
    lvRow.querySelectorAll('[data-am-lv]').forEach(function(el){ el.addEventListener('click', _amOnLvClick); });
  }
  const grRow = ov.querySelector('#amGrRow');
  if(grRow){
    const inner = _amGrRowInner();
    grRow.innerHTML = inner;
    grRow.style.display = inner ? 'flex' : 'none';
    grRow.querySelectorAll('[data-am-gr]').forEach(function(el){ el.addEventListener('click', _amOnGrClick); });
  }
  _amRenderClassGrid();
}

function _amOnLvClick(){
  _amState.selectedLevel = this.dataset.amLv;
  const grades = _amGetGrades(_amState.selectedLevel);
  if(grades.length && grades.indexOf(_amState.selectedGrade)===-1) _amState.selectedGrade = grades[0];
  _amApplyFilterChange();
}

function _amOnGrClick(){
  _amState.selectedGrade = this.dataset.amGr;
  _amApplyFilterChange();
}

/* 반 카드 그리드 — 선택된 학교급+학년의 모든 반을 카드로 표시.
 * 각 카드 내부에 그 반 학생들의 번호 + 이름 리스트. 클릭 = 매칭 + 자동 다음. */
function _amRenderClassGrid(){
  const st = _amState;
  const grid = document.getElementById('amClassGrid');
  if(!grid || !st) return;
  const cur = st.items[st.idx];
  const recName = (cur.student_name || '').trim();
  const filtered = st.students.filter(function(s){
    if(st.selectedLevel && s.level && s.level !== st.selectedLevel) return false;
    if(st.selectedGrade !== '' && String(st.selectedGrade) !== String(s.grade)) return false;
    return true;
  });
  if(!filtered.length){
    grid.innerHTML = '<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">선택한 학년에 해당하는 학생이 없습니다. 다른 학년을 선택하세요.</div>';
    return;
  }
  const byCls={};
  filtered.forEach(function(s){
    const c = (s.cls===undefined||s.cls===null||s.cls==='')?'(반없음)':String(s.cls);
    if(!byCls[c]) byCls[c]=[];
    byCls[c].push(s);
  });
  const clsKeys = Object.keys(byCls).sort(function(a,b){
    const na=parseInt(a,10), nb=parseInt(b,10);
    if(!isNaN(na)&&!isNaN(nb)) return na-nb;
    return a.localeCompare(b);
  });
  const colors=['c1','c2','c3','c4','c5','c6'];
  const colorMap={c1:'#06b6d4,#0891b2',c2:'#8b5cf6,#6d28d9',c3:'#f59e0b,#d97706',c4:'#10b981,#047857',c5:'#ef4444,#b91c1c',c6:'#ec4899,#be185d'};
  let h = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
  clsKeys.forEach(function(c, ci){
    const stus = byCls[c].sort(function(a,b){
      const na=parseInt(a.num,10), nb=parseInt(b.num,10);
      if(!isNaN(na)&&!isNaN(nb)) return na-nb;
      return (a.num||'').localeCompare(b.num||'');
    });
    const cls = colors[ci%colors.length];
    const cc = colorMap[cls];
    /* 외부 staging 의 과거 반과 일치하는 카드는 강조(외곽 글로우). */
    const cur_cls = (cur.class_num!=null && String(cur.class_num)===String(c));
    h += '<div class="am-cls-card '+cls+(cur_cls?' active':'')+'" style="position:relative;border-radius:12px;padding:10px;display:flex;flex-direction:column;background:var(--card);border:1.5px solid var(--bdr);overflow:hidden;min-height:180px;max-height:240px'+(cur_cls?';box-shadow:0 0 0 2.5px rgba(6,182,212,0.30),0 4px 10px rgba(0,0,0,0.08)':'')+'">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-radius:8px;color:#fff;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,0.10);background:linear-gradient(135deg,'+cc+')">'
      + '<span style="font-size:12px;font-weight:800">'+_amEsc(c)+'반</span>'
      + '<span style="font-size:9px;font-weight:700;opacity:0.92;background:rgba(255,255,255,0.20);padding:1px 6px;border-radius:6px">'+stus.length+'명</span>'
      + '</div>';
    h += '<div class="am-stus" style="flex:1;overflow-y:auto;padding:0 1px;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px">';
    stus.forEach(function(s){
      const recommend = recName && s.name===recName;
      h += '<div class="am-stu" data-am-pick="'+_amEsc(s.id)+'" style="display:grid;grid-template-columns:32px 1fr;gap:6px;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;transition:background .12s'+(recommend?';background:rgba(245,158,11,0.10);font-weight:700':'')+'">'
        + '<span style="text-align:right;color:var(--t3);font-family:var(--fm);font-size:10px">'+(s.num?_amEsc(s.num)+'번':'')+'</span>'
        + '<span style="color:var(--t1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+_amEsc(s.name||'')+(recommend?' ⭐':'')+'</span>'
        + '</div>';
    });
    h += '</div></div>';
  });
  h += '</div>';
  grid.innerHTML = h;
  /* 학생 클릭 → 매칭 + 다음 항목 자동 이동 */
  grid.querySelectorAll('[data-am-pick]').forEach(function(el){
    el.addEventListener('mouseover', function(){ if(!this.style.background.includes('245,158,11')) this.style.background = 'rgba(6,182,212,0.10)'; });
    el.addEventListener('mouseout', function(){
      const recName=(_amState.items[_amState.idx].student_name||'').trim();
      const isRec = recName && this.textContent.trim().indexOf(recName) >= 0;
      this.style.background = isRec ? 'rgba(245,158,11,0.10)' : '';
    });
    el.addEventListener('click', function(){
      const stuId = this.dataset.amPick;
      _amMatchTo(stuId);
    });
  });
}

async function _amMatchTo(studentId){
  const st = _amState;
  if(!st) return;
  const cur = st.items[st.idx];
  if(!cur) return;
  try{
    const res = await window.electronAPI.pastHistoryResolveAmbiguous([cur.id], studentId);
    if(!res||!res.success){ alert('매칭 실패: '+((res&&res.error)||'')); return; }
  }catch(e){ alert('오류: '+e.message); return; }
  _amAdvanceOrClose();
}

async function _amSkipCurrent(){
  const st = _amState;
  if(!st) return;
  const cur = st.items[st.idx];
  /* studentId=null 로 호출 — staging 상태는 변경 없이 다음으로만 이동 (사용자 의도) */
  try{ await window.electronAPI.pastHistoryResolveAmbiguous([cur.id], null); }catch(_){}
  _amAdvanceOrClose();
}

/* 전근·전학·자퇴 — 현재 staging 행을 신규 학생/교직원으로 등록 + 같은 사람의 모든 staging 행 일괄 matched.
 *  사용자 정책 (2026-05-21): 일반일지 인원 삭제 GUI 동일 모달 + 세로 배열 예/아니오. */
async function _amOnLeaverClick(){
  const st = _amState;
  if(!st) return;
  const cur = st.items[st.idx];
  const nm = cur && cur.student_name ? cur.student_name : '(이름 없음)';
  const ok = await appConfirmModal(
    '<b>'+escHtml(nm)+'</b> 은(는) 현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 보건일지 기록을 데이터베이스에 저장하시겠습니까?<br><br><span style="color:#dc2626;font-weight:700">아래에 예를 클릭하는 경우 위 초록색 삽입 확인 버튼을 반드시 눌러주세요.</span>',
    '전근·전학·자퇴 처리',
    {
      okLabel: '예 (그냥 데이터베이스에 등록하겠습니다)',
      cancelLabel: '아니오 (정확한 인원 매칭을 하여 등록하겠습니다)',
      vertical: true,
      okBg: 'rgba(168,85,247,0.10)',
      okBorder: 'rgba(168,85,247,0.40)',
      okColor: '#a855f7',
    }
  );
  if(!ok) return;
  try {
    if(!window.electronAPI || !window.electronAPI.pastHistoryStagingRowAsLeaver){
      alert('이 기능은 새 버전에서 사용 가능합니다. 앱을 재시작해 주세요.');
      return;
    }
    const res = await window.electronAPI.pastHistoryStagingRowAsLeaver(cur.id);
    if(res && res.success){
      try {
        const typeLbl = res.personType === 'staff' ? '교직원' : '학생';
        const busMod = await import('../../core/event-bus.js');
        busMod.bus.emit('toast:show', { text: '✅ '+typeLbl+' "'+(res.name||nm)+'" 신규 등록 완료 — 보건일지 기록 연결됨' });
      } catch(_){}
      _amAdvanceOrClose();
    } else {
      alert('자동 등록 실패: ' + ((res && res.error) || '알 수 없음'));
    }
  } catch(e){
    alert('오류: ' + e.message);
  }
}

function _amAdvanceOrClose(){
  const st = _amState;
  if(!st) return;
  if(st.idx >= st.items.length-1){
    _amCloseModal();
    setTimeout(function(){ _importShowMatchStats(); }, 220);
    return;
  }
  st.idx++;
  /* 다음 항목의 학년 힌트로 학교급/학년 칩 자동 전환 (과거 학년이 있으면 활용) */
  const nx = st.items[st.idx];
  if(nx.grade != null && nx.grade !== '') st.selectedGrade = String(nx.grade);
  _amApplyItemChange();
}

function _amCloseModal(){
  const ov = document.getElementById('amModal');
  if(!ov) return;
  const box = document.getElementById('amModalBox');
  if(box){
    box.style.animation='umModalOut .18s cubic-bezier(0.4,0,1,1) forwards';
    setTimeout(function(){ ov.remove(); }, 200);
  } else {
    ov.remove();
  }
  if(_amKeyHandler){ document.removeEventListener('keydown', _amKeyHandler); }
  _amState = null;
  setTimeout(function(){ try{ _importShowMatchStats(); }catch(_){ } }, 220);
}

function _amBindEvents(ov){
  /* 모달 외부 (overlay 자체) 클릭 시 닫기 — 본체 박스 클릭은 닫히지 않음 */
  ov.addEventListener('click', function(e){
    if(e.target === ov) _amCloseModal();
  });
  /* 키보드 핸들러 — 누적 누수 방지 위해 기존 제거 후 재등록 */
  if(_amKeyHandler) document.removeEventListener('keydown', _amKeyHandler);
  _amKeyHandler = function(e){
    if(!_amState) return;
    if(e.key==='Escape'){ e.preventDefault(); _amCloseModal(); }
    else if(e.key==='ArrowLeft'){
      if(_amState.idx>0){
        _amState.idx--;
        const p=_amState.items[_amState.idx];
        if(p.grade!=null && p.grade!=='') _amState.selectedGrade = String(p.grade);
        _amApplyItemChange();
      }
    }
    else if(e.key==='ArrowRight'){
      if(_amState.idx<_amState.items.length-1){
        _amState.idx++;
        const p=_amState.items[_amState.idx];
        if(p.grade!=null && p.grade!=='') _amState.selectedGrade = String(p.grade);
        _amApplyItemChange();
      }
    }
  };
  document.addEventListener('keydown', _amKeyHandler);
  /* 레코드 네비 */
  ov.querySelectorAll('[data-am-nav]').forEach(function(el){
    el.addEventListener('click', function(){
      if(this.disabled) return;
      const dir = this.dataset.amNav;
      if(dir==='prev' && _amState.idx>0){
        _amState.idx--;
        const p=_amState.items[_amState.idx];
        if(p.grade!=null && p.grade!=='') _amState.selectedGrade = String(p.grade);
        _amApplyItemChange();
      } else if(dir==='next' && _amState.idx<_amState.items.length-1){
        _amState.idx++;
        const p=_amState.items[_amState.idx];
        if(p.grade!=null && p.grade!=='') _amState.selectedGrade = String(p.grade);
        _amApplyItemChange();
      }
    });
  });
  /* 학교급 / 학년 칩 */
  ov.querySelectorAll('[data-am-lv]').forEach(function(el){ el.addEventListener('click', _amOnLvClick); });
  ov.querySelectorAll('[data-am-gr]').forEach(function(el){ el.addEventListener('click', _amOnGrClick); });
  /* 건너뛰기 */
  const skip = ov.querySelector('.am-skip');
  if(skip) skip.addEventListener('click', _amSkipCurrent);
  /* 전근·전학·자퇴 칩 (사용자 정책 2026-05-21) */
  const leaverBtn = ov.querySelector('.am-leaver');
  if(leaverBtn) leaverBtn.addEventListener('click', _amOnLeaverClick);
  /* 드래그 */
  _amBindDrag(ov);
}

function _amBindDrag(ov){
  const handle = document.getElementById('amDragHandle');
  const box = document.getElementById('amModalBox');
  if(!handle||!box) return;
  let dragging=false, sx=0, sy=0, mx=0, my=0, initialized=false;
  function initPos(){
    if(initialized) return;
    const rect = box.getBoundingClientRect();
    box.style.position='fixed';
    box.style.left = rect.left+'px';
    box.style.top = rect.top+'px';
    box.style.margin='0';
    initialized=true;
  }
  handle.addEventListener('mousedown', function(e){
    initPos();
    dragging=true;
    sx=e.clientX; sy=e.clientY;
    const r=box.getBoundingClientRect();
    mx=r.left; my=r.top;
    handle.style.cursor='grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    let nx=mx+dx, ny=my+dy;
    const W=window.innerWidth, H=window.innerHeight;
    if(nx<-(box.offsetWidth-100)) nx=-(box.offsetWidth-100);
    if(nx>W-100) nx=W-100;
    if(ny<0) ny=0;
    if(ny>H-50) ny=H-50;
    box.style.left=nx+'px';
    box.style.top=ny+'px';
  });
  document.addEventListener('mouseup', function(){
    if(dragging){ dragging=false; handle.style.cursor='grab'; }
  });
}

/* ════════════════════════════════════════════════════════════
   미매칭 수동 매칭 모달 — 회색 헤더(드래그 이동), ✕ 없음, 열림/닫힘 애니메이션,
   진행 막대, ◀▶ 좌우 네비, 학교급/학년 칩 필터, 둥근 사각 반 카드 + 학생 리스트.
   ════════════════════════════════════════════════════════════ */
let _umState = null;

async function _importOpenUnmatchedModal(startStagingId){
  if(!window.electronAPI||!window.electronAPI.pastHistoryGetUnmatched){
    alert('이 기능은 새 버전에서 사용 가능합니다.');
    return;
  }
  const res = await window.electronAPI.pastHistoryGetUnmatched();
  if(!res||!res.success){
    alert('미매칭 목록 조회 실패: '+((res&&res.error)||''));
    return;
  }
  const items = res.data||[];
  if(!items.length){
    alert('미매칭 항목이 없습니다.');
    return;
  }
  /* startStagingId 가 지정되어 있으면 해당 staging 행을 포함한 그룹 인덱스로 시작 */
  let startIdx = 0;
  if(startStagingId){
    const found = items.findIndex(function(g){
      return g && Array.isArray(g.records) && g.records.some(function(r){ return r.id===startStagingId; });
    });
    if(found >= 0) startIdx = found;
  }
  /* 학생 명단 미리 로드 (S.people 활용 — 학생만, 활성만) */
  const students = (S.people||[]).filter(function(p){return p.type==='student'&&p.is_active!==false&&p.is_active!==0;});
  /* 학교급 종류 추출 */
  const levelSet={};
  students.forEach(function(s){if(s.level)levelSet[s.level]=true;});
  const levels = Object.keys(levelSet);
  if(!levels.length) levels.push('elementary');
  const startItem = items[startIdx];
  _umState = {
    items: items,
    idx: startIdx,
    students: students,
    selectedLevel: (startItem && startItem.level) || levels[0],
    selectedGrade: (startItem && startItem.grade) || '',
    levels: levels
  };
  _umRenderModal();
}

function _umRenderModal(){
  const st = _umState;
  if(!st) return;
  /* 기존 모달 제거 */
  const old = document.getElementById('umModal');
  if(old) old.remove();
  const ov = document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='umModal';
  ov.style.background='rgba(0,0,0,0.25)';
  ov.style.display='flex';
  ov.style.alignItems='center';
  ov.style.justifyContent='center';
  ov.innerHTML = _umBuildHtml();
  document.body.appendChild(ov);
  _umBindEvents(ov);
  /* 첫 진입 시 학년 자동 설정 — 미매칭 학생의 학년 기본 선택 */
  _umRenderClassGrid();
}

/* 매칭 모달의 학생 식별 문구 — 학교급 여러 종이면 학교급 prefix, 학과 있으면 학과 prefix.
 *  예) "고 지형공간디자인과 2학년 2반 6번" / "지형공간디자인과 2학년 2반 6번" / "초 2학년 2반 6번" / "2학년 2반 6번" */
function _umBuildMeta(cur){
  if(!cur) return '';
  const _lvShort={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  let _multi=false;
  try{
    const set={};
    (S.people||[]).forEach(function(s){ if(s && s.type!=='staff' && s.level) set[s.level]=true; });
    _multi=Object.keys(set).length>=2;
  }catch(_){}
  const lvCode=cur.level||'';
  const lvLabel=(_multi && lvCode)?(_lvShort[lvCode]||lvCode):'';
  const dept=(cur.department||'').trim();
  let s='';
  if(lvLabel) s+=lvLabel+' ';
  if(dept)    s+=dept+' ';
  if(cur.grade)       s+=cur.grade+'학년 ';
  if(cur.class_num)   s+=cur.class_num+'반 ';
  if(cur.student_num) s+=cur.student_num+'번';
  return s.trim();
}

function _umBuildHtml(){
  const st = _umState;
  const cur = st.items[st.idx];
  const total = st.items.length;
  const pct = ((st.idx+1)/total*100).toFixed(1);
  const meta = _umBuildMeta(cur);
  const recCount = (cur.records||[]).length;
  const recPreview = (cur.records||[]).slice(0,2).map(function(r){
    return (r.visit_date||'')+' · '+(r.symptoms||'-');
  }).join(' / ');
  /* padding:0 으로 .modal-content 기본 padding:24px 를 override — 회색 헤더가 모서리까지 꽉 차도록 */
  let h = '<div class="modal-content um-modal" id="umModalBox" style="width:840px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(0,0,0,0.08);box-shadow:0 24px 60px rgba(0,0,0,0.30);position:relative;padding:0">';
  /* 헤더 (회색 + 드래그) + 부가 설명 — 양 옆·위 풀 폭으로 표시 */
  h += '<div class="um-head" id="umDragHandle" style="padding:12px 16px;display:flex;gap:10px;align-items:center;background:linear-gradient(180deg,#eef2f6,#e5e9ee);border-bottom:1px solid var(--bdr);cursor:grab;user-select:none">'
    + '<span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0.5"><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span></span>'
    + '<div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0">'
      + '<span style="font-size:13px;font-weight:700;color:var(--t1)">🔗 미매칭 수동 매칭</span>'
      + '<span style="font-size:10.5px;color:var(--t2);line-height:1.4">이름 오탈자 또는 현재 등록된 인원이 아닌 경우 매칭되지 않습니다.</span>'
      + '<span style="font-size:10.5px;color:var(--t2);line-height:1.4">지금 또는 추후에 매칭해도 됩니다. 매칭이 되어야 보건일지 데이터베이스에 삽입됩니다.</span>'
    + '</div>'
    + '<span id="umCounter" style="font-size:10.5px;padding:3px 9px;background:rgba(6,182,212,0.10);color:var(--cyan);border-radius:10px;font-weight:700;flex-shrink:0">'+(st.idx+1)+' / '+total+'</span>'
    + '</div>';
  /* 진행 막대 */
  h += '<div style="height:3px;background:var(--bdrl);position:relative;overflow:hidden"><div id="umProgress" style="height:100%;background:linear-gradient(90deg,#06b6d4,#0891b2);width:'+pct+'%;transition:width .25s ease"></div></div>';
  /* 좌우 네비 + 미매칭 정보 */
  h += '<div style="padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl);background:linear-gradient(180deg,rgba(6,182,212,0.04),transparent)">'
    + '<button class="um-nav" data-um-nav="prev" '+(st.idx===0?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx===0?';opacity:0.35;cursor:not-allowed':'')+'">◀</button>'
    + '<div style="flex:1;padding:8px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.20);border-radius:9px;display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:16px">⚠</span>'
      + '<div><div id="umCurName" style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(cur.name||'(이름 없음)')+'</div>'
      + '<div id="umCurMeta" style="font-size:10.5px;color:var(--t2)">엑셀: '+escHtml(meta||'학번 누락')+' · '+recCount+'건 · '+escHtml(recPreview)+'</div></div>'
      + '<span style="flex:1"></span>'
      + '<span style="font-size:9.5px;font-weight:700;color:#dc2626;background:rgba(239,68,68,0.10);padding:3px 8px;border-radius:8px">미매칭</span>'
    + '</div>'
    + '<button class="um-nav" data-um-nav="next" '+(st.idx>=total-1?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx>=total-1?';opacity:0.35;cursor:not-allowed':'')+'">▶</button>'
    + '</div>';
  /* 학교급 (여러 개일 때만) — 항상 wrapper 렌더링하여 부분 갱신 가능 */
  h += '<div id="umLvRow" style="padding:10px 16px;display:'+(st.levels.length>=2?'flex':'none')+';align-items:center;gap:10px;border-bottom:1px solid var(--bdrl)">'+_umLvRowInner()+'</div>';
  /* 학년 칩 — 항상 wrapper 렌더링 */
  const _grInner = _umGrRowInner();
  h += '<div id="umGrRow" style="padding:10px 16px;display:'+(_grInner?'flex':'none')+';gap:10px;align-items:center;border-bottom:1px solid var(--bdrl);flex-wrap:wrap">'+_grInner+'</div>';
  /* 본문: 반 그리드 */
  h += '<div class="um-body" id="umClassGrid" style="flex:1;padding:14px 16px;overflow-y:auto"></div>';
  /* 푸터 — 건너뛰기·삭제·전근전학자퇴 3버튼 우측 정렬, 가로 50% 통일 */
  h += '<div style="padding:9px 16px;border-top:1px solid var(--bdrl);display:flex;flex-direction:column;gap:8px;background:#fafbfc">'
    + '<div style="display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:9.5px;color:var(--t3);flex:1">← / →: 이전·다음 / Esc: 닫기 / 제목 행 드래그로 창 이동</span>'
      + '<button class="um-skip" style="width:50%;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--bdr);background:#fff;color:var(--t2);text-align:center">⏭ 건너뛰기</button>'
    + '</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px">'
      + '<button class="um-delete" title="이 미매칭 인원의 staging 기록을 삭제합니다 (일반일지 영향 없음)" style="width:calc(25% - 4px);padding:8px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(220,38,38,0.40);background:rgba(220,38,38,0.06);color:#dc2626;text-align:center">🗑 삭제</button>'
      + '<button class="um-leaver" title="현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 보건일지 기록을 데이터베이스에 저장합니다." style="width:calc(75% - 4px);padding:8px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px dashed rgba(168,85,247,0.50);background:rgba(168,85,247,0.08);color:#a855f7;text-align:center">🚌 전근·전학·자퇴 등으로 현재 없는 인원</button>'
    + '</div>'
    + '</div>';
  h += '</div>';
  return h;
}

/* 학교급 칩 inner HTML — wrapper 제외 */
function _umLvRowInner(){
  const st = _umState;
  if(!st || st.levels.length<2) return '';
  const lvLabel={elementary:'초등학교',middle:'중학교',high:'고등학교',kindergarten:'유치원',special:'특수학교'};
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학교급</span>'
    + '<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px">';
  st.levels.forEach(function(lv){
    const act=st.selectedLevel===lv;
    h += '<button class="um-lv" data-um-lv="'+escHtml(lv)+'" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(act?'var(--card)':'transparent')+';color:'+(act?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer'+(act?';box-shadow:0 1px 3px rgba(0,0,0,0.08)':'')+'">'+(lvLabel[lv]||lv)+'</button>';
  });
  h += '</div>';
  return h;
}

/* 학년 칩 inner HTML — wrapper 제외, 빈 문자열 반환 시 wrapper 숨김 */
function _umGrRowInner(){
  const st = _umState;
  if(!st) return '';
  const grades = _umGetGrades(st.selectedLevel);
  if(!grades.length) return '';
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학년</span>';
  grades.forEach(function(g){
    const act=String(st.selectedGrade)===String(g);
    h += '<button class="um-gr" data-um-gr="'+escHtml(g)+'" style="padding:5px 12px;font-size:11px;font-weight:600;border:1px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--card)')+';color:'+(act?'#fff':'var(--t2)')+';border-radius:14px;cursor:pointer'+(act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'')+'">'+escHtml(g)+'학년</button>';
  });
  return h;
}

/* 항목 변경(◀▶, 키보드, 매칭 후 자동 이동) 시 부분 갱신 — 모달 자체는 유지하고 안의 정보만 갱신 */
function _umApplyItemChange(){
  const ov = document.getElementById('umModal');
  if(!ov || !_umState) return;
  const st = _umState;
  const cur = st.items[st.idx];
  const total = st.items.length;
  /* 카운터 (1 / N) */
  const counter = ov.querySelector('#umCounter');
  if(counter) counter.textContent = (st.idx+1)+' / '+total;
  /* 진행 막대 */
  const prog = ov.querySelector('#umProgress');
  if(prog) prog.style.width = ((st.idx+1)/total*100).toFixed(1)+'%';
  /* 현재 항목 정보 — 이름·메타·기록 미리보기 */
  const meta = _umBuildMeta(cur);
  const recCount = (cur.records||[]).length;
  const recPreview = (cur.records||[]).slice(0,2).map(function(r){
    return (r.visit_date||'')+' · '+(r.symptoms||'-');
  }).join(' / ');
  const nameEl = ov.querySelector('#umCurName');
  if(nameEl) nameEl.textContent = cur.name || '(이름 없음)';
  const metaEl = ov.querySelector('#umCurMeta');
  if(metaEl) metaEl.textContent = '엑셀: '+(meta||'학번 누락')+' · '+recCount+'건 · '+recPreview;
  /* 이전/다음 버튼 활성화 상태 */
  const prevBtn = ov.querySelector('[data-um-nav="prev"]');
  if(prevBtn){
    if(st.idx===0){ prevBtn.setAttribute('disabled',''); prevBtn.style.opacity='0.35'; prevBtn.style.cursor='not-allowed'; }
    else{ prevBtn.removeAttribute('disabled'); prevBtn.style.opacity=''; prevBtn.style.cursor='pointer'; }
  }
  const nextBtn = ov.querySelector('[data-um-nav="next"]');
  if(nextBtn){
    if(st.idx>=total-1){ nextBtn.setAttribute('disabled',''); nextBtn.style.opacity='0.35'; nextBtn.style.cursor='not-allowed'; }
    else{ nextBtn.removeAttribute('disabled'); nextBtn.style.opacity=''; nextBtn.style.cursor='pointer'; }
  }
  /* 학교급/학년 칩 + 반 그리드 갱신 */
  _umApplyFilterChange();
}

/* 학교급/학년 칩 영역 + 반 그리드만 부분 갱신 (모달 전체 재생성 없이) */
function _umApplyFilterChange(){
  const ov = document.getElementById('umModal');
  if(!ov) return;
  const lvRow = ov.querySelector('#umLvRow');
  if(lvRow){
    lvRow.innerHTML = _umLvRowInner();
    lvRow.style.display = (_umState.levels.length>=2) ? 'flex' : 'none';
    lvRow.querySelectorAll('[data-um-lv]').forEach(function(el){
      el.addEventListener('click', _umOnLvClick);
    });
  }
  const grRow = ov.querySelector('#umGrRow');
  if(grRow){
    const inner = _umGrRowInner();
    grRow.innerHTML = inner;
    grRow.style.display = inner ? 'flex' : 'none';
    grRow.querySelectorAll('[data-um-gr]').forEach(function(el){
      el.addEventListener('click', _umOnGrClick);
    });
  }
  _umRenderClassGrid();
}

function _umOnLvClick(){
  _umState.selectedLevel = this.dataset.umLv;
  const grades = _umGetGrades(_umState.selectedLevel);
  if(grades.length && grades.indexOf(_umState.selectedGrade)===-1){
    _umState.selectedGrade = grades[0];
  }
  _umApplyFilterChange();
}

function _umOnGrClick(){
  _umState.selectedGrade = this.dataset.umGr;
  _umApplyFilterChange();
}

/* 학교급별 학년 종류 추출 — 정렬됨 */
function _umGetGrades(level){
  const set={};
  (_umState.students||[]).forEach(function(s){
    if(level && s.level && s.level!==level) return;
    if(s.grade!==undefined && s.grade!==null && s.grade!=='') set[String(s.grade)]=true;
  });
  return Object.keys(set).sort(function(a,b){
    const na=parseInt(a,10), nb=parseInt(b,10);
    if(!isNaN(na)&&!isNaN(nb)) return na-nb;
    return a.localeCompare(b);
  });
}

/* 반 그리드 렌더 — 현재 선택된 학교급 + 학년의 반들을 카드로 표시.
   각 카드 안에 그 반의 학생 번호·이름 리스트. 클릭 시 매칭. */
function _umRenderClassGrid(){
  const st = _umState;
  const grid = document.getElementById('umClassGrid');
  if(!grid||!st) return;
  const cur = st.items[st.idx];
  /* 현재 처리 중 미매칭의 이름·학번으로 추천 학생 ID 계산 */
  const recName = (cur.name||'').trim();
  /* 학교급·학년 필터링 */
  const filtered = st.students.filter(function(s){
    if(st.selectedLevel && s.level && s.level!==st.selectedLevel) return false;
    if(st.selectedGrade!==''&&String(st.selectedGrade)!==String(s.grade)) return false;
    return true;
  });
  if(!filtered.length){
    grid.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">선택한 학년에 해당하는 학생이 없습니다. 다른 학년을 선택하세요.</div>';
    return;
  }
  /* 반별 그룹 */
  const byCls={};
  filtered.forEach(function(s){
    const c = s.cls===undefined||s.cls===null||s.cls===''?'(반없음)':String(s.cls);
    if(!byCls[c]) byCls[c]=[];
    byCls[c].push(s);
  });
  const clsKeys = Object.keys(byCls).sort(function(a,b){
    const na=parseInt(a,10), nb=parseInt(b,10);
    if(!isNaN(na)&&!isNaN(nb)) return na-nb;
    return a.localeCompare(b);
  });
  const colors=['c1','c2','c3','c4','c5','c6'];
  let h = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
  clsKeys.forEach(function(c, ci){
    const stus = byCls[c].sort(function(a,b){
      const na=parseInt(a.num,10), nb=parseInt(b.num,10);
      if(!isNaN(na)&&!isNaN(nb)) return na-nb;
      return (a.num||'').localeCompare(b.num||'');
    });
    const cls = colors[ci%colors.length];
    const cur_cls = (cur.class_num&&String(cur.class_num)===String(c));
    h += '<div class="um-cls-card '+cls+(cur_cls?' active':'')+'" style="position:relative;border-radius:12px;padding:10px;transition:transform .12s,box-shadow .12s;display:flex;flex-direction:column;background:var(--card);border:1.5px solid var(--bdr);overflow:hidden;min-height:180px;max-height:240px'+(cur_cls?';box-shadow:0 0 0 2.5px rgba(6,182,212,0.30),0 4px 10px rgba(0,0,0,0.08)':'')+'">';
    h += _umClsHead(c, stus.length, cls);
    h += '<div class="um-stus" style="flex:1;overflow-y:auto;padding:0 1px;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px">';
    stus.forEach(function(s){
      const recommend = recName && s.name===recName; /* 동일 이름 기본 추천 */
      h += '<div class="um-stu" data-um-pick="'+s.id+'" style="display:grid;grid-template-columns:32px 1fr;gap:6px;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;transition:background .12s'+(recommend?';background:rgba(245,158,11,0.10);font-weight:700':'')+'">'
        + '<span style="text-align:right;color:var(--t3);font-family:var(--fm);font-size:10px">'+(s.num?escHtml(String(s.num))+'번':'')+'</span>'
        + '<span style="color:var(--t1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(s.name||'')+(recommend?' ⭐':'')+'</span>'
        + '</div>';
    });
    h += '</div></div>';
  });
  h += '</div>';
  grid.innerHTML = h;
  /* 학생 클릭 → 매칭 */
  grid.querySelectorAll('[data-um-pick]').forEach(function(el){
    el.addEventListener('mouseover',function(){this.style.background='rgba(6,182,212,0.10)';});
    el.addEventListener('mouseout',function(){
      const recName=( _umState.items[_umState.idx].name||'').trim();
      const isRec = recName && this.textContent.trim().indexOf(recName)===0;
      this.style.background = isRec?'rgba(245,158,11,0.10)':'';
    });
    el.addEventListener('click', function(){
      const stuId = this.dataset.umPick;
      _umMatchToStudent(stuId);
    });
  });
}

function _umClsHead(clsName, count, colorClass){
  const colorMap={c1:'#06b6d4,#0891b2',c2:'#8b5cf6,#6d28d9',c3:'#f59e0b,#d97706',c4:'#10b981,#047857',c5:'#ef4444,#b91c1c',c6:'#ec4899,#be185d'};
  const c=colorMap[colorClass]||colorMap.c1;
  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-radius:8px;color:#fff;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,0.10);background:linear-gradient(135deg,'+c+')">'
    + '<span style="font-size:12px;font-weight:800">'+escHtml(clsName)+'반</span>'
    + '<span style="font-size:9px;font-weight:700;opacity:0.92;background:rgba(255,255,255,0.20);padding:1px 6px;border-radius:6px">'+count+'명</span>'
    + '</div>';
}

async function _umMatchToStudent(studentId){
  const st = _umState;
  if(!st) return;
  const cur = st.items[st.idx];
  const recordIds = (cur.records||[]).map(function(r){return r.id;});
  if(!recordIds.length){ _umAdvanceOrClose(); return; }
  try{
    const res = await window.electronAPI.pastHistoryResolveUnmatched(recordIds, studentId);
    if(!res||!res.success){
      alert('매칭 실패: '+((res&&res.error)||''));
      return;
    }
  }catch(e){ alert('오류: '+e.message); return; }
  /* 처리 완료 → 다음으로 */
  _umAdvanceOrClose();
}

function _umAdvanceOrClose(){
  const st = _umState;
  if(!st) return;
  /* 마지막 항목이었으면 모달 닫고 통계 갱신 */
  if(st.idx >= st.items.length-1){
    _umCloseModal();
    setTimeout(function(){ _importShowMatchStats(); }, 220);
    return;
  }
  st.idx++;
  /* 다음 미매칭의 학년·학교급으로 자동 전환 */
  const nx = st.items[st.idx];
  if(nx.level) st.selectedLevel = nx.level;
  if(nx.grade) st.selectedGrade = String(nx.grade);
  _umApplyItemChange();
}

function _umCloseModal(){
  const ov = document.getElementById('umModal');
  if(!ov) return;
  const box = document.getElementById('umModalBox');
  if(box){
    box.style.animation='umModalOut .18s cubic-bezier(0.4,0,1,1) forwards';
    setTimeout(function(){ ov.remove(); }, 200);
  } else {
    ov.remove();
  }
  /* 키보드 핸들러 해제 */
  document.removeEventListener('keydown', _umKeyHandler);
  _umState = null;
}

function _umKeyHandler(e){
  if(!_umState) return;
  if(e.key==='Escape'){ e.preventDefault(); _umCloseModal(); }
  else if(e.key==='ArrowLeft'){ if(_umState.idx>0){ _umState.idx--; const p=_umState.items[_umState.idx]; if(p.level)_umState.selectedLevel=p.level; if(p.grade)_umState.selectedGrade=String(p.grade); _umApplyItemChange(); } }
  else if(e.key==='ArrowRight'){ if(_umState.idx<_umState.items.length-1){ _umState.idx++; const p=_umState.items[_umState.idx]; if(p.level)_umState.selectedLevel=p.level; if(p.grade)_umState.selectedGrade=String(p.grade); _umApplyItemChange(); } }
}

function _umBindEvents(ov){
  /* 키보드 ←/→/Esc */
  document.addEventListener('keydown', _umKeyHandler);
  /* 모달 외부 (overlay 자체) 클릭 시 닫기 — 본체 박스 클릭은 닫히지 않음 */
  ov.addEventListener('click', function(e){
    if(e.target === ov) _umCloseModal();
  });
  /* 네비 버튼 */
  ov.querySelectorAll('[data-um-nav]').forEach(function(el){
    el.addEventListener('click', function(){
      const dir = this.dataset.umNav;
      if(this.disabled) return;
      if(dir==='prev' && _umState.idx>0){
        _umState.idx--;
        const p=_umState.items[_umState.idx];
        if(p.level)_umState.selectedLevel=p.level;
        if(p.grade)_umState.selectedGrade=String(p.grade);
        _umApplyItemChange();
      } else if(dir==='next' && _umState.idx<_umState.items.length-1){
        _umState.idx++;
        const p=_umState.items[_umState.idx];
        if(p.level)_umState.selectedLevel=p.level;
        if(p.grade)_umState.selectedGrade=String(p.grade);
        _umApplyItemChange();
      }
    });
  });
  /* 학교급 — 부분 갱신 (모달 재생성 없음, 깜빡임 방지) */
  ov.querySelectorAll('[data-um-lv]').forEach(function(el){
    el.addEventListener('click', _umOnLvClick);
  });
  /* 학년 — 부분 갱신 */
  ov.querySelectorAll('[data-um-gr]').forEach(function(el){
    el.addEventListener('click', _umOnGrClick);
  });
  /* 건너뛰기 */
  const skip = ov.querySelector('.um-skip');
  if(skip) skip.addEventListener('click', function(){ _umAdvanceOrClose(); });
  /* 🚌 전근·전학·자퇴 — 현재 staging 행을 신규 학생/교직원(ghost) 으로 등록 + matched 처리 */
  const leaverBtn = ov.querySelector('.um-leaver');
  if(leaverBtn) leaverBtn.addEventListener('click', _umOnLeaverClick);
  /* 🗑 삭제 — staging 의 같은 식별정보 행 일괄 삭제 후 다음으로 진행 */
  const deleteBtn = ov.querySelector('.um-delete');
  if(deleteBtn) deleteBtn.addEventListener('click', _umOnDeleteClick);
  /* 헤더 드래그 이동 */
  _umBindDrag(ov);
  /* 외부 영역 클릭 무시 — 모달 박스 외 클릭은 기본 동작 안 함 */
}

/* 미매칭 모달의 전근·전학·자퇴 chip — 현재 staging 행 1건과 같은 식별정보의 모든 staging 행을 매칭 처리.
 *  사용자 정책 (2026-05-21): "매칭된 것만 들어가게" — 이 칩으로 매칭 상태로 만들어야 일반일지 삽입됨. */
/* 미매칭 모달 [🗑 삭제] — 같은 식별정보의 staging 행 일괄 삭제 후 다음 항목으로 진행 */
async function _umOnDeleteClick(){
  const st = _umState;
  if(!st) return;
  const cur = st.items[st.idx];
  const nm = (cur && cur.name) ? cur.name : '(이름 없음)';
  const recordIds = (cur && Array.isArray(cur.records)) ? cur.records.map(function(r){return r.id;}) : [];
  if(!recordIds.length) return;
  const ok = await appConfirmModal('이 미매칭된 인원을 삭제합니다.','미매칭 인원 삭제');
  if(!ok) return;
  try {
    const res = await window.electronAPI.pastHistoryDeleteStagingRow(recordIds[0]);
    if(res && res.success){
      _umAdvanceOrClose();
    } else {
      alert('삭제 실패: ' + ((res && res.error) || '알 수 없음'));
    }
  } catch(e){ alert('오류: ' + e.message); }
}

async function _umOnLeaverClick(){
  const st = _umState;
  if(!st) return;
  const cur = st.items[st.idx];
  const nm = (cur && cur.name) ? cur.name : '(이름 없음)';
  /* unmatched 모달의 item 은 records 배열을 가진 그룹 — 그 안 첫 staging row id 를 대표로 사용 */
  const recordIds = (cur && Array.isArray(cur.records)) ? cur.records.map(function(r){return r.id;}) : [];
  if(!recordIds.length) return;
  const stagingId = recordIds[0];
  const ok = await appConfirmModal(
    '<b>'+escHtml(nm)+'</b> 은(는) 현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 보건일지 기록을 데이터베이스에 저장하시겠습니까?<br><br><span style="color:#dc2626;font-weight:700">아래에 예를 클릭하는 경우 위 초록색 삽입 확인 버튼을 반드시 눌러주세요.</span>',
    '전근·전학·자퇴 처리',
    {
      okLabel: '예 (그냥 데이터베이스에 등록하겠습니다)',
      cancelLabel: '아니오 (정확한 인원 매칭을 하여 등록하겠습니다)',
      vertical: true,
      okBg: 'rgba(168,85,247,0.10)',
      okBorder: 'rgba(168,85,247,0.40)',
      okColor: '#a855f7',
    }
  );
  if(!ok) return;
  try {
    if(!window.electronAPI || !window.electronAPI.pastHistoryStagingRowAsLeaver){
      alert('이 기능은 새 버전에서 사용 가능합니다. 앱을 재시작해 주세요.');
      return;
    }
    const res = await window.electronAPI.pastHistoryStagingRowAsLeaver(stagingId);
    if(res && res.success){
      try {
        const typeLbl = res.personType === 'staff' ? '교직원' : '학생';
        const busMod = await import('../../core/event-bus.js');
        busMod.bus.emit('toast:show', { text: '✅ '+typeLbl+' "'+(res.name||nm)+'" 신규 등록 + 매칭 완료 — 삽입 확인 시 일반일지에 반영' });
      } catch(_){}
      _umAdvanceOrClose();
    } else {
      alert('자동 등록 실패: ' + ((res && res.error) || '알 수 없음'));
    }
  } catch(e){
    alert('오류: ' + e.message);
  }
}

function _umBindDrag(ov){
  const handle = document.getElementById('umDragHandle');
  const box = document.getElementById('umModalBox');
  if(!handle||!box) return;
  let dragging=false, sx=0, sy=0, mx=0, my=0, initialized=false;
  function initPos(){
    if(initialized) return;
    const rect = box.getBoundingClientRect();
    /* 모달을 overlay 의 flex 중앙 정렬에서 분리해 절대좌표로 변환 */
    box.style.position='fixed';
    box.style.left = rect.left+'px';
    box.style.top = rect.top+'px';
    box.style.margin='0';
    initialized=true;
  }
  handle.addEventListener('mousedown', function(e){
    initPos();
    dragging=true;
    sx=e.clientX; sy=e.clientY;
    const r=box.getBoundingClientRect();
    mx=r.left; my=r.top;
    handle.style.cursor='grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    let nx=mx+dx, ny=my+dy;
    /* 화면 밖으로 완전 이탈 방지 — 헤더가 보이도록 30px 마진 */
    const W=window.innerWidth, H=window.innerHeight;
    if(nx<-(box.offsetWidth-100)) nx=-(box.offsetWidth-100);
    if(nx>W-100) nx=W-100;
    if(ny<0) ny=0;
    if(ny>H-50) ny=H-50;
    box.style.left=nx+'px';
    box.style.top=ny+'px';
  });
  document.addEventListener('mouseup', function(){
    if(dragging){ dragging=false; handle.style.cursor='grab'; }
  });
}

/* 열림/닫힘 애니메이션 — health-diary.css 가 modal-overlay 의 vpIn 사용하지만
   um-modal 은 별도 키프레임 사용. 인라인 스타일 + style 태그로 동적 주입. */
(function _umInjectStyles(){
  if(document.getElementById('um-modal-styles')) return;
  const s = document.createElement('style');
  s.id='um-modal-styles';
  s.textContent = '@keyframes umModalIn{0%{opacity:0;transform:scale(0.92) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}'
    + '@keyframes umModalOut{0%{opacity:1;transform:scale(1) translateY(0)}100%{opacity:0;transform:scale(0.92) translateY(10px)}}'
    + '#umModal .modal-content.um-modal{animation:umModalIn .22s cubic-bezier(0.4,0,0.2,1)}'
    + '#umModal .um-cls-card:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(0,0,0,0.06)}'
    + '#umModal .um-cls-card.c1{border-color:#06b6d4}'
    + '#umModal .um-cls-card.c2{border-color:#8b5cf6}'
    + '#umModal .um-cls-card.c3{border-color:#f59e0b}'
    + '#umModal .um-cls-card.c4{border-color:#10b981}'
    + '#umModal .um-cls-card.c5{border-color:#ef4444}'
    + '#umModal .um-cls-card.c6{border-color:#ec4899}'
    + '#umModal .um-head:active{cursor:grabbing;background:linear-gradient(180deg,#e5e9ee,#dde2e8) !important}'
    + '#umModal .um-stus::-webkit-scrollbar{width:3px}'
    + '#umModal .um-stus::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.10);border-radius:2px}'
    /* 학년 칩 · 반 카드(반·인원수) · 학생 행(번호·이름) 글씨체 맑은고딕 통일 (인라인 font-family:var(--fm) 도 override) */
    + '#umModal .um-gr,#umModal .um-cls-card,#umModal .um-stu,#umModal .um-stu *{font-family:"Malgun Gothic","맑은 고딕",sans-serif !important}';
  document.head.appendChild(s);
})();

/* ════════════════════════════════════════════════════════════
   명단 미등록 placeholder 기록 — 매칭 처리 내역 카드 안에 표시.
   • person_uid IS NULL AND is_imported=1 인 daily_records 행 목록 조회.
   • 각 행마다 [🔗 매칭] / [🗑 삭제] 버튼.
   • 매칭은 openPersonSearch 통합 팝업으로 학생/교직원 선택.
   ════════════════════════════════════════════════════════════ */
export async function _loadPlaceholderList(){
  const el = document.getElementById('pastPlaceholderList');
  if(!el || !window.electronAPI || !window.electronAPI.pastHistoryListPlaceholders) return;
  try {
    const res = await window.electronAPI.pastHistoryListPlaceholders();
    const rows = (res && res.success && Array.isArray(res.data)) ? res.data : [];
    if(!rows.length){ el.innerHTML=''; return; }
    /* 학교급 prefix 노출 조건 — S.people 학교급 종류가 2개 이상일 때만 */
    const _lvShort = {'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
    let _multi=false;
    try {
      const set={};
      (S.people||[]).forEach(function(s){ if(s && s.type!=='staff' && s.level) set[s.level]=true; });
      _multi = Object.keys(set).length >= 2;
    } catch(_){}
    let h = '<div style="padding:10px 12px;background:rgba(180,83,9,0.07);border:1px solid rgba(180,83,9,0.30);border-radius:8px">';
    h += '<div style="color:#b45309;font-size:12px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px">';
    h += '<span>⚠ 명단 미등록 기록 ('+rows.length+'건)</span>';
    h += '<span style="font-size:10.5px;font-weight:500;color:var(--t2)">— DB 에는 보관되어 있으며, 매칭하거나 삭제할 수 있습니다.</span>';
    h += '</div>';
    h += '<div style="display:flex;flex-direction:column;gap:5px;max-height:320px;overflow-y:auto">';
    rows.forEach(function(r){
      const id = r.identity || {};
      const lvLabel = (_multi && id.level) ? (_lvShort[id.level]||id.level) : '';
      let ident = '';
      if(lvLabel) ident += lvLabel+' ';
      if(id.department) ident += escHtml(String(id.department))+' ';
      if(id.grade) ident += String(id.grade)+'학년 ';
      if(id.class_num) ident += String(id.class_num)+'반 ';
      if(id.student_num) ident += String(id.student_num)+'번';
      const nm = id.name ? escHtml(String(id.name)) : '(이름 없음)';
      const sym = r.symptoms ? escHtml(String(r.symptoms).slice(0,40)) : '';
      h += '<div data-pl-row="'+r.id+'" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff;border-radius:6px;border:1px solid var(--bdrl)">';
      h += '<span style="font-size:11px;font-family:var(--fm);color:var(--t2);min-width:80px">'+escHtml(String(r.visit_date||''))+'</span>';
      h += '<span style="font-size:11px;color:var(--t1);flex:1"><b>'+nm+'</b>'+(ident?' · <span style="color:var(--t3)">'+ident.trim()+'</span>':'')+(sym?' · <span style="color:var(--t3)">'+sym+'</span>':'')+'</span>';
      h += '<button class="btn btn-sm" data-pl-match="'+r.id+'" style="padding:4px 10px;font-size:10.5px;font-weight:700;background:rgba(6,182,212,0.10);color:var(--cyan);border:1px solid rgba(6,182,212,0.40);border-radius:5px;cursor:pointer">🔗 매칭</button>';
      h += '<button class="btn btn-sm" data-pl-leaver="'+r.id+'" title="외부 엑셀의 학년 정보를 보고 학생/교직원을 자동 판단해 신규 uid 로 등록합니다 (전학·자퇴·전근 처리)" style="padding:4px 10px;font-size:10.5px;font-weight:700;background:rgba(168,85,247,0.10);color:#a855f7;border:1px solid rgba(168,85,247,0.40);border-radius:5px;cursor:pointer">🚌 전학·자퇴·전근</button>';
      h += '<button class="btn btn-sm" data-pl-delete="'+r.id+'" style="padding:4px 10px;font-size:10.5px;font-weight:700;background:rgba(220,38,38,0.08);color:#dc2626;border:1px solid rgba(220,38,38,0.30);border-radius:5px;cursor:pointer">🗑 삭제</button>';
      h += '</div>';
    });
    h += '</div>';
    h += '</div>';
    el.innerHTML = h;
    el.querySelectorAll('[data-pl-match]').forEach(function(b){
      b.addEventListener('click', function(){ _placeholderOpenMatch(parseInt(this.dataset.plMatch,10)); });
    });
    el.querySelectorAll('[data-pl-leaver]').forEach(function(b){
      b.addEventListener('click', function(){ _placeholderAsLeaver(parseInt(this.dataset.plLeaver,10)); });
    });
    el.querySelectorAll('[data-pl-delete]').forEach(function(b){
      b.addEventListener('click', function(){ _placeholderDelete(parseInt(this.dataset.plDelete,10)); });
    });
  } catch(e){
    console.error('[placeholder-list]', e);
  }
}

function _placeholderOpenMatch(recordId){
  if(!recordId) return;
  openPersonSearch({
    title: '🔗 명단 미등록 기록 매칭',
    type: 'student',
    allowStaff: true,
    overlayId: 'plMatchSearch',
    closeOnPick: true,
    onPick: async function(personUid){
      if(!personUid) return;
      try {
        const res = await window.electronAPI.pastHistoryMatchPlaceholder(recordId, personUid);
        if(res && res.success){
          /* 성공 — 리스트 갱신 + S.records 재로드 + 일지 재렌더 */
          try { await _placeholderRefreshDaily(); } catch(_){}
          try { _loadPlaceholderList(); } catch(_){}
        } else {
          alert('매칭 실패: ' + ((res && (res.error || (res.data && res.data.error))) || '알 수 없음'));
        }
      } catch(e){
        alert('오류: ' + e.message);
      }
    },
  });
}

async function _placeholderDelete(recordId){
  if(!recordId) return;
  if(!await appConfirmModal('이 명단 미등록 기록 1건을 영구 삭제합니다.<br><br>계속하시겠습니까?','명단 미등록 기록 삭제')) return;
  try {
    const res = await window.electronAPI.pastHistoryDeletePlaceholder(recordId);
    if(res && res.success){
      try { await _placeholderRefreshDaily(); } catch(_){}
      try { _loadPlaceholderList(); } catch(_){}
    } else {
      alert('삭제 실패: ' + ((res && res.error) || '알 수 없음'));
    }
  } catch(e){
    alert('오류: ' + e.message);
  }
}

/* "전학·자퇴·전근" 보조 옵션 — 외부 엑셀의 학년 칸을 보고 학생/교직원 자동 판단해 신규 uid 발급 + person_uid 연결.
 *  사용자 정책 (2026-05-21): 명단에 없으나 과거에 있었던 사람도 5년 보존을 위해 DB 등록 필요.
 *  클릭 즉시 IPC 호출이 아니라, 일반일지 인원 삭제와 동일 GUI 의 확인 모달을 먼저 띄움 (예/아니오 세로 배열). */
async function _placeholderAsLeaver(recordId){
  if(!recordId) return;
  const ok = await appConfirmModal(
    '현재 등록된 인원이 아니지만 과거에 있었던 인원으로 간주하여 보건일지 기록을 데이터베이스에 저장하시겠습니까?<br><br><span style="color:#dc2626;font-weight:700">아래에 예를 클릭하는 경우 위 초록색 삽입 확인 버튼을 반드시 눌러주세요.</span>',
    '전근·전학·자퇴 처리',
    {
      okLabel: '예 (그냥 데이터베이스에 등록하겠습니다)',
      cancelLabel: '아니오 (정확한 인원 매칭을 하여 등록하겠습니다)',
      vertical: true,
      okBg: 'rgba(168,85,247,0.10)',
      okBorder: 'rgba(168,85,247,0.40)',
      okColor: '#a855f7',
    }
  );
  if(!ok) return;
  try {
    if(!window.electronAPI || !window.electronAPI.pastHistoryPlaceholderAsLeaver){
      alert('이 기능은 새 버전에서 사용 가능합니다. 앱을 재시작해 주세요.');
      return;
    }
    const res = await window.electronAPI.pastHistoryPlaceholderAsLeaver(recordId);
    if(res && res.success){
      try { await _placeholderRefreshDaily(); } catch(_){}
      try { _loadPlaceholderList(); } catch(_){}
      try {
        const typeLbl = res.personType === 'staff' ? '교직원' : '학생';
        const nm = res.name || '';
        const busMod = await import('../../core/event-bus.js');
        busMod.bus.emit('toast:show', { text: '✅ '+typeLbl+' "'+nm+'" 신규 등록 완료 — 과거 기록 연결됨' });
      } catch(_){}
    } else {
      alert('자동 등록 실패: ' + ((res && res.error) || '알 수 없음'));
    }
  } catch(e){
    alert('오류: ' + e.message);
  }
}

/* placeholder 매칭/삭제 후 S.records 와 관련 화면 재로드 — _importPastApply 의 재로드 블록과 동일 동작.
 *  ghost 등록(placeholderAsLeaver)으로 새 학생/교직원이 생겼다면 S.people/S.leavers 도 함께 갱신해야
 *  방문 이력 카드의 getStu 결과가 fallback 으로 떨어지지 않는다. */
async function _placeholderRefreshDaily(){
  const yr = String(_academicYear());
  if(window.electronAPI && window.electronAPI.recordsGetDaily){
    const dRes = await window.electronAPI.recordsGetDaily(yr);
    if(dRes && dRes.success && Array.isArray(dRes.data)){
      S.records = dRes.data.map(function(r){
        if(r.personUid !== undefined && r.studentId === undefined) r.studentId = r.personUid;
        return r;
      });
    }
  }
  /* ghost 자동/수동 등록으로 새 학생·교직원이 생겼을 수 있으므로 명단도 함께 재로드 */
  try {
    const stuUtils = await import('../../core/student-utils.js');
    if(stuUtils && stuUtils._reloadStudentsFromDB) await stuUtils._reloadStudentsFromDB();
  } catch(_){}
  try {
    const busMod = await import('../../core/event-bus.js');
    if(busMod && busMod.bus){
      busMod.bus.emit('render:daily');
      busMod.bus.emit('render:calendar');
      busMod.bus.emit('render:sidebar');
      busMod.bus.emit('render:dashboard');
    }
  } catch(_){}
}

/* ── Expose to global scope ── */

