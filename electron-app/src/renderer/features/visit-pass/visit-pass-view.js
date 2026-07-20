/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { getStu, escHtml, recsByDate } from '../../core/helpers.js';
import { appData } from '../../core/app-data-bridge.js';
import { S } from '../../core/app-state.js';
import { bus } from '../../core/event-bus.js';
import { appConfirmModal } from '../../core/ui-utils.js';
import { vpUpdatePreview, vpeEditorInit, vpeEditorAutoSave, vpSetSigMode, vpResetPrintExtra, vpSetExtraDefault } from './visit-pass-editor.js';

let dpCalTarget='';
let dpCalYear=new Date().getFullYear();
let dpCalMonth=new Date().getMonth();

/* ═══════════════════════════════════════
   VISIT PASS (#14-22)
   ═══════════════════════════════════════ */
export let vpState = {
  format: 'default',
  paper: 'receipt',
  orientation: 'portrait',
  /* 내용 선택 — 영구 저장(ec_vp_content). 저장값을 기본값 위에 병합해 새 키는 기본값 유지. 재시작/업데이트 후에도 보존 (사용자 지시 2026-06-15) */
  content: (function(){ var def={date:true, timeIn:true, timeOut:true, symptoms:true, treatment:true, bodymap:true, vs:true, teacherSig:true}; try{ var v=JSON.parse(localStorage.getItem('ec_vp_content')||'null'); if(v&&typeof v==='object') return Object.assign(def, v); }catch(_){} return def; })(),   /* teacherSig·bodymap 기본 ON (사용자 결정 2026-06-11 / 부위 2026-06-16) */
  /* 필요/이유 행 − 삭제 상태 — 영구 저장. '초기 상태로 되돌리기'로만 복귀 (사용자 결정 2026-06-11) */
  reasonRemoved: (function(){ try{ const v=JSON.parse(localStorage.getItem('ec_vp_reason_removed')||'{}'); return {meal:!!v.meal, referral:!!v.referral}; }catch(_){ return {meal:false, referral:false}; } })(),
  customInput: false,
  sigMode: (function(){const s=localStorage.getItem('ec_vp_sigMode');return (s==='stamp'||s==='sign')?s:'sign';})(),
  sigImage: '',
  stampImage: localStorage.getItem('ec_vp_stamp_image') || '',
  signImage: localStorage.getItem('ec_vp_sign_image') || '',
  selectedRecord: null,
  selectedStudent: null
};
S.vpCustomFormats = JSON.parse(localStorage.getItem('ec_vp_custom_formats')) || {};
function _vpPersistCommonState(key,value){
  localStorage.setItem(key,JSON.stringify(value));
  if(appData&&appData.canUseBackend())appData.saveCommon(key.replace('ec_',''),value,{legacyJsonKey:key.replace('ec_','')}).catch(function(){});
}

/* 공유 가변 상태 — diary-print-view.js 등에서도 직접 접근 */
dpCalTarget=dpCalTarget||'';
dpCalYear=dpCalYear||new Date().getFullYear();
dpCalMonth=dpCalMonth!=null?dpCalMonth:new Date().getMonth();

/* 커스텀 탭 이름/슬롯/라벨 관리 (2026-05-20 재활성화 — 7개 고정 슬롯) */
export function vpGetCustomNames(){return JSON.parse(localStorage.getItem('ec_vp_custom_names')||'{}');}
function vpSaveCustomNames(obj){_vpPersistCommonState('ec_vp_custom_names',obj);}
/* 고정 7개 슬롯 — 추가/삭제 없음 */
function vpGetCustomSlots(){return ['custom1','custom2','custom3','custom4','custom5','custom6','custom7'];}
/* 슬롯별 라벨 사용자정의: { custom1: {입실시간:'In', 처치내용:'처치'}, ... } — 영구 저장. */
export function vpGetCustomLabels(){return JSON.parse(localStorage.getItem('ec_vp_custom_labels')||'{}');}
export function vpSaveCustomLabel(slot, defaultLabel, newLabel){
  const all=vpGetCustomLabels();
  if(!all[slot])all[slot]={};
  if(!newLabel || newLabel===defaultLabel){
    delete all[slot][defaultLabel];
    if(Object.keys(all[slot]).length===0)delete all[slot];
  } else {
    all[slot][defaultLabel]=newLabel;
  }
  _vpPersistCommonState('ec_vp_custom_labels',all);
}
/* 슬롯별 사용자추가 행(처치내용 아래): { custom1: ['항목1','메모',...] } — 라벨만 영구 저장, 값은 휘발 */
export function vpGetCustomRows(){return JSON.parse(localStorage.getItem('ec_vp_custom_rows')||'{}');}
export function vpSaveCustomRows(slot, arr){
  const all=vpGetCustomRows();
  if(!arr || !arr.length) delete all[slot];
  else all[slot]=arr;
  _vpPersistCommonState('ec_vp_custom_rows',all);
}
/* 슬롯별 블록(확인문/푸터) 사용자정의: { custom1: {confirm:'...', footer:'...'}, ... } */
export function vpGetCustomBlocks(){return JSON.parse(localStorage.getItem('ec_vp_custom_blocks')||'{}');}
export function vpSaveCustomBlock(slot, blockKey, htmlOrEmpty){
  const all=vpGetCustomBlocks();
  if(!all[slot])all[slot]={};
  if(!htmlOrEmpty){
    delete all[slot][blockKey];
    if(Object.keys(all[slot]).length===0)delete all[slot];
  } else {
    all[slot][blockKey]=htmlOrEmpty;
  }
  _vpPersistCommonState('ec_vp_custom_blocks',all);
}
/* 필요/이유 행 삭제 상태 영구 저장 — localStorage + DB common 동기화 (2026-06-11) */
export function vpSaveReasonRemoved(obj){ _vpPersistCommonState('ec_vp_reason_removed', obj); }
/* 제목 저장 (좌측 양식 버튼·미리보기 헤더 동기화 진입점). 빈 값/default 와 동일 → 제거 */
export function vpSaveCustomTitle(slot, newTitle){
  const num=slot.replace('custom','');
  const def='커스텀 양식 '+num;
  const names=vpGetCustomNames();
  if(!newTitle || newTitle===def){
    delete names[slot];
  } else {
    names[slot]=newTitle;
  }
  vpSaveCustomNames(names);
  /* 좌측 버튼 라벨 갱신 */
  const labelEl=document.getElementById('vpCLabel'+num);
  if(labelEl) labelEl.textContent = (newTitle && newTitle!==def) ? newTitle : def;
}
function vpRenderCustomButtons(){
  const bar=document.getElementById('vpFormatBar');if(!bar)return;
  /* 기존에 렌더된 커스텀 버튼 모두 제거 후 재렌더 */
  bar.querySelectorAll('.vp-fmt-btn[data-fmt^="custom"]').forEach(function(el){el.remove();});
  const slots=vpGetCustomSlots();
  const names=vpGetCustomNames();
  slots.forEach(function(slot){
    const num=slot.replace('custom','');
    const label=names[slot]||('커스텀 양식 '+num);
    const btn=document.createElement('button');
    btn.className='vp-fmt-btn';
    btn.dataset.fmt=slot;
    btn.style.cssText='position:relative;text-align:left;width:100%';
    /* 연필 아이콘만 — 호버 시에만 표시 (CSS .vp-fmt-btn:hover .vp-edit-icon). 삭제 아이콘 제거(고정 7개) */
    btn.innerHTML='<span class="vp-custom-label" id="vpCLabel'+num+'">'+escHtml(label)+'</span>'
      +'<span class="vp-edit-icon" title="제목 변경">✏️</span>';
    btn.addEventListener('click',function(e){
      if(e.target.classList.contains('vp-edit-icon')){e.stopPropagation();vpRenameCustom(slot);return;}
      vpSelectFormat(slot,btn);
    });
    bar.appendChild(btn);
  });
  /* 현재 선택된 포맷 active 표시 */
  bar.querySelectorAll('.vp-fmt-btn').forEach(function(b){b.classList.toggle('active',b.dataset.fmt===vpState.format);});
}
function vpLoadCustomNames(){vpRenderCustomButtons();}
function vpRenameCustom(slot){
  const names=vpGetCustomNames();
  const cur=names[slot]||slot.replace('custom','커스텀 ');
  const num=slot.replace('custom','');
  const label=document.getElementById('vpCLabel'+num);
  if(!label)return;
  const inp=document.createElement('input');
  inp.type='text';inp.value=cur;
  inp.style.cssText='width:80px;font-size:11px;font-weight:600;border:1.5px solid var(--cyan);border-radius:4px;padding:2px 6px;outline:none;background:var(--bg);color:var(--t1);font-family:var(--f)';
  label.textContent='';label.appendChild(inp);
  inp.focus();inp.select();
  let saved=false;
  function _vpRenameSaveInd(){
    let ind=document.getElementById('vpRenameSaveInd');
    if(!ind){ind=document.createElement('div');ind.id='vpRenameSaveInd';ind.className='ec-save-indicator';ind.style.zIndex='10001';document.body.appendChild(ind);}
    return ind;
  }
  function showSaveToast(){
    const ind=_vpRenameSaveInd();
    ind.textContent='저장 중…';ind.className='ec-save-indicator saving';ind.style.zIndex='10001';
    setTimeout(function(){ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';ind.style.zIndex='10001';setTimeout(function(){ind.className='ec-save-indicator hide';},3000);},300);
  }
  function save(){
    if(saved)return;saved=true;
    const v=inp.value.trim()||cur;
    names[slot]=v;
    vpSaveCustomNames(names);
    label.textContent=v;
    showSaveToast();
  }
  let _vpRenameTimer=null;
  inp.addEventListener('input',function(){
    const v=inp.value.trim()||cur;
    names[slot]=v;vpSaveCustomNames(names);
    const ind=_vpRenameSaveInd();
    ind.textContent='저장 중…';ind.className='ec-save-indicator saving';ind.style.zIndex='10001';
    clearTimeout(_vpRenameTimer);
    _vpRenameTimer=setTimeout(function(){ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';ind.style.zIndex='10001';setTimeout(function(){ind.className='ec-save-indicator hide';},3000);},400);
  });
  inp.addEventListener('blur',save);
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();save();inp.blur();}
    if(e.key==='Escape'){label.textContent=cur;}
  });
  /* 버튼 바깥 클릭 시 즉시 반영 */
  setTimeout(function(){
    document.addEventListener('mousedown',function vpOutside(e){
      if(e.target===inp)return;
      save();inp.blur();
      document.removeEventListener('mousedown',vpOutside);
    });
  },10);
}
export function vpAddCustomSlot(){
  const slots=vpGetCustomSlots();
  if(slots.length>=15){alert('커스텀 형식은 최대 15개까지 추가할 수 있습니다.');return;}
  let maxNum=0;
  slots.forEach(function(s){const n=parseInt(s.replace('custom',''))||0;if(n>maxNum)maxNum=n;});
  const newSlot='custom'+(maxNum+1);
  slots.push(newSlot);
  vpSaveCustomSlots(slots);
  vpRenderCustomButtons();
  /* 새로 만든 형식 자동 선택 */
  const btn=document.querySelector('.vp-fmt-btn[data-fmt="'+newSlot+'"]');
  if(btn) vpSelectFormat(newSlot,btn);
}
setTimeout(vpLoadCustomNames,100);

export function openVisitPass(recId){
  /* v3 (사용자 결정 2026-05-21) — 행 선택 안 한 상태에서는 인적 정보 빈 칸으로.
   *   UI 에서 실제로 행이 선택(.daily-selected 클래스) 상태인지 검사 — 옛 dailySelectedRecId 가 session 에 남아도 무시.
   *   사용자가 명시적으로 행을 클릭한 상태에서만 stu 채움.
   * 2026-06-11 — 명시적 recId 인자 추가: 이름 클릭 팝업의 '커스텀 양식 출력' 처럼 호출측이 방문자를
   *   특정해 여는 경로는 DOM 선택 검사 없이 그 레코드로 인적사항을 채운다 (회귀 수정 — 팝업 경로 빈 양식). */
  vpResetPrintExtra();   /* 인쇄 여백 — 방문증 열 때마다 0 에서 시작 (저장 안 함, 필요할 때만 조절) */
  const dayRecs = recsByDate(S.selectedDate);
  let targetRec=null;
  if(recId!=null){
    targetRec = dayRecs.find(function(r){return r.id===recId;}) || (S.records||[]).find(function(r){return r.id===recId;}) || null;
  }
  const _selectedTr = document.querySelector('tr.daily-selected[data-rec-id]');
  if(!targetRec && dayRecs.length && _selectedTr){
    const _selRid = parseInt(_selectedTr.dataset.recId, 10);
    if(!isNaN(_selRid)) targetRec = dayRecs.find(function(r){return r.id===_selRid;});
  }
  const stu = targetRec ? getStu(targetRec.studentId) : null;
  vpState.selectedRecord = targetRec || null;
  vpState.selectedStudent = stu || null;
  document.getElementById('vpOverlay').classList.add('show');
  /* 아코디언(미리보기·내용 선택·서명 방식)은 열 때 항상 기본 닫힘 — 형식 선택이 잘 보이게 (사용자 요청 2026-06-10) */
  document.querySelectorAll('#vpOverlay .vp-sel-bar.open').forEach(function(b){b.classList.remove('open');});
  /* 커스텀 슬롯 버튼은 매번 다이얼로그 열릴 때 갱신 — 다른 곳/시점에 추가/이름변경/삭제된 슬롯 즉시 반영 */
  vpRenderCustomButtons();
  /* 현재 vpState.format 에 해당하는 버튼이 사라졌으면 default 로 폴백 */
  let _vpInitBtn=document.querySelector('.vp-fmt-btn[data-fmt="'+vpState.format+'"]');
  if(!_vpInitBtn){vpState.format='default';_vpInitBtn=document.querySelector('.vp-fmt-btn[data-fmt="default"]');}
  vpSelectFormat(vpState.format,_vpInitBtn);
  /* 저장된 서명/도장 모드 복원 — DOM 렌더 후 실행 */
  setTimeout(function(){
    let savedMode=localStorage.getItem('ec_vp_sigMode');
    if(savedMode!=='stamp'&&savedMode!=='sign'){
      /* 저장 없으면 슬롯에 이미지가 있는 모드 자동 선택, 없으면 'sign' 기본 */
      const stamps=JSON.parse(localStorage.getItem('ec_vp_stamps')||'[]');
      const signs=JSON.parse(localStorage.getItem('ec_vp_signs')||'[]');
      if(signs.length)savedMode='sign';
      else if(stamps.length)savedMode='stamp';
      else savedMode='sign';
    }
    const sigBtn=document.querySelector('.vp-sig-opt[data-sig="'+savedMode+'"]');
    if(sigBtn){
      vpSetSigMode(savedMode,sigBtn);
      /* 서명 드롭다운 자동 열기 제거 — 아코디언은 기본 닫힘 (사용자 요청 2026-06-10) */
    }
  },100);
}

export function closeVisitPass(){
  if(vpState.format.startsWith('custom') && vpeState.slot) vpeEditorAutoSave(true);
  const overlay = document.getElementById('vpOverlay');
  overlay.classList.add('closing');
  setTimeout(function(){ overlay.classList.remove('show','closing'); }, 250);
}

export let vpeState = {
  slot: null,
  objects: [],
  selectedId: null,
  selectedIds: [],
  nextId: 1,
  isDragging: false,
  isResizing: false,
  dragData: null,
  resizeData: null,
  pdfBgUrl: null,
  pdfBgFileName: null,
  bgScale: 100,
  bgOffsetY: 0,
  bgOffsetX: 0,
  marginTop: 7,
  marginBottom: 7,
  marginLeft: 7,
  marginRight: 7
};

/* ── 초기 상태로 되돌리기 — 현재 양식의 모든 사용자 수정(제목·라벨·문구·추가 행·서명 위치)을 공장 상태로 (사용자 요청 2026-06-11) ──
 *  · 빌트인: 확인 문구 템플릿(ec_vp_tpl_*) + 서명 위치(ec_vp_sig_pos_*) 제거
 *  · 커스텀: 제목/라벨/블록(확인문·푸터)/사용자추가 행에서 그 슬롯만 제거 (다른 슬롯·다른 양식은 무접촉) + DB 동기화
 *  · 휘발 편집(contenteditable)은 재렌더로 함께 초기화 */
async function vpFactoryReset(){
  const fmt=vpState.format||'default';
  const ok=await appConfirmModal(
    '이 양식을 처음 상태로 되돌리시겠습니까?<br><br><span style="font-size:11px;color:var(--t3)">제목·라벨·문구·추가 행·서명(도장) 위치 등 이 양식의 모든 사용자 수정이 초기화됩니다. 다른 양식에는 영향이 없습니다.</span>',
    '초기 상태로 되돌리기',
    { okLabel:'예', cancelLabel:'아니오' }
  );
  if(!ok)return;
  try{ localStorage.removeItem('ec_vp_sig_pos_'+fmt); }catch(_){}
  if(/^custom\d+$/.test(fmt)){
    const names=vpGetCustomNames(); if(names[fmt]!==undefined){ delete names[fmt]; vpSaveCustomNames(names); }
    const labels=vpGetCustomLabels(); if(labels[fmt]!==undefined){ delete labels[fmt]; _vpPersistCommonState('ec_vp_custom_labels',labels); }
    const rows=vpGetCustomRows(); if(rows[fmt]!==undefined){ delete rows[fmt]; _vpPersistCommonState('ec_vp_custom_rows',rows); }
    const blocks=vpGetCustomBlocks(); if(blocks[fmt]!==undefined){ delete blocks[fmt]; _vpPersistCommonState('ec_vp_custom_blocks',blocks); }
    /* 좌측 버튼 라벨 원복 + active 유지 */
    vpRenderCustomButtons();
    const btn=document.querySelector('.vp-fmt-btn[data-fmt="'+fmt+'"]');
    if(btn)btn.classList.add('active');
  } else {
    const tplKey={default:'visitPass', rest_referral:'restReferral', meal_request:'meal', referral:'referral'}[fmt];
    if(tplKey){ try{ localStorage.removeItem('ec_vp_tpl_'+tplKey); }catch(_){} }
    /* 필요/이유 행 삭제 상태도 초기화로만 복귀 (사용자 결정 2026-06-11) */
    if(fmt==='meal_request'||fmt==='referral'){
      const rk=fmt==='meal_request'?'meal':'referral';
      if(vpState.reasonRemoved&&vpState.reasonRemoved[rk]){ vpState.reasonRemoved[rk]=false; vpSaveReasonRemoved(vpState.reasonRemoved); }
    }
  }
  vpUpdatePreview();
  bus.emit('toast:show',{text:'양식이 초기 상태로 복원되었습니다.'});
}
/* 버튼 위임 — 모듈 로드 시 1회 */
document.addEventListener('click',function(e){
  if(e.target&&e.target.id==='vpFactoryResetBtn')vpFactoryReset();
});

export function vpSelectFormat(fmt, btn){
  if(vpState.format.startsWith('custom') && vpeState.slot) vpeEditorAutoSave(true);
  vpState.format = fmt;
  vpSetExtraDefault(fmt.startsWith('custom'));   /* 양식 바꾸면 인쇄 여백을 그 양식 기본값으로 (커스텀=15mm, 그 외=0). (2026-06-01) */
  document.querySelectorAll('.vp-fmt-btn').forEach(b => b.classList.toggle('active', b === btn));
  const bar=document.getElementById('vpCustomBar');
  const cbar=document.getElementById('vpContentBar');
  const defWrap=document.getElementById('vpDefaultPreviewWrap');
  const editorWrap=document.getElementById('vpEditorWrap');
  const bgPanel=document.getElementById('vpeBgMarginPanel');
  const isCustom=fmt.startsWith('custom');
  const sigBar=document.getElementById('vpSigBar');
  /* 2026-05-20 — 커스텀 양식 7종(custom1~7)은 보건실 방문 확인증 표 구조를 HTML 로 복제해 그리는 방식.
   * 옛 에디터 캔버스(editorWrap) 는 사용하지 않으며 default/meal_request/referral 과 동일한 vpPreview 영역에 렌더한다. */
  if(isCustom){
    if(bar) bar.style.display='none';        /* 옛 커스텀 편집 도구바 숨김 */
    if(cbar) cbar.style.display='';          /* 내용 선택 — 커스텀에서도 표시 (2026-05-26) */
    if(defWrap) defWrap.style.display='';    /* 미리보기 영역 사용 */
    if(editorWrap) editorWrap.classList.remove('show'); /* 옛 에디터 비활성 */
    if(bgPanel) bgPanel.style.display='none';
    if(sigBar) sigBar.style.display='';
    vpeState.slot = null;
  } else {
    if(bar) bar.style.display='none';
    if(cbar) cbar.style.display = '';        /* 내용 선택 — meal_request/referral 에서도 표시 (2026-05-26) */
    if(sigBar) sigBar.style.display='';
    if(defWrap) defWrap.style.display='';
    if(editorWrap) editorWrap.classList.remove('show');
    if(bgPanel) bgPanel.style.display='none';
    vpeState.slot = null;
  }
  /* PDF/PNG 버튼: 커스텀 포맷에서만 표시 */
  document.querySelectorAll('.vp-export-only').forEach(function(b){b.style.display=isCustom?'flex':'none';});
  vpUpdatePreview();
  /* 커스텀 양식 안내 보조 모달 — 커스텀 슬롯 선택 시에만 표시. X 닫기 핸들러 1회 등록.
   * 위치: vp-modal 의 우측 상단 외부에 딱 붙도록 JS 로 계산. */
  const tipEl = document.getElementById('vpCustomFormTip');
  if(tipEl){
    if(isCustom){
      tipEl.style.display = 'block';
      _vpPositionTipModal();
    } else {
      tipEl.style.display = 'none';
    }
    const closeBtn = document.getElementById('vpCustomFormTipClose');
    if(closeBtn && !closeBtn._cfTipBound){
      closeBtn._cfTipBound = true;
      closeBtn.addEventListener('click', function(){ tipEl.style.display = 'none'; });
    }
    /* resize 시 위치 재계산 — 1회만 등록 */
    if(!window._vpTipResizeBound){
      window._vpTipResizeBound = true;
      window.addEventListener('resize', function(){
        const tip = document.getElementById('vpCustomFormTip');
        if(tip && tip.style.display !== 'none') _vpPositionTipModal();
      });
    }
  }
}

/* 보조 안내 모달 위치 계산 — vp-modal 우측 상단에 딱 붙임. 화면 우측 공간 부족 시 메인 모달 위에 겹쳐 표시(상단 정렬). */
function _vpPositionTipModal(){
  const tip = document.getElementById('vpCustomFormTip');
  const modal = document.querySelector('#vpOverlay .vp-modal');
  if(!tip || !modal) return;
  const r = modal.getBoundingClientRect();
  const tipW = tip.offsetWidth || 280;
  const gap = 10;
  let left = r.right + gap;
  if(left + tipW > window.innerWidth - 6){
    /* 화면 우측 공간 부족 — 메인 모달 우측 모서리에 겹쳐 표시 */
    left = Math.max(6, r.right - tipW - 6);
  }
  tip.style.left = left + 'px';
  tip.style.right = 'auto';
  tip.style.top = r.top + 'px';
  tip.style.transform = 'none';
}


