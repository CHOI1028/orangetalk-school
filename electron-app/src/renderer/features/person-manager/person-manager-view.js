/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { getStu, escHtml, _reloadStudentsFromDB, saveStudents, saveData, isKinder, closeModalGracefully, createEmptyState, compareClass, normalizeClassInput, hasMultipleSchoolLevels, hasAnyDepartment, getLevelShort } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { triggerLocalTemplateDownload } from '../settings/settings-view.js';
import { downloadOptimizedStudentTemplate, downloadOptimizedStaffTemplate, downloadOptimizedCareTemplate, handleStudentFile, handleStaffFile, handleStudentUploadPaste, _careListPanelHtml, reshowStaffPending, reshowStudentPending } from '../settings/settings-tab-people.js';
import { _makeDraggable } from '../symptom/symptom-view.js';
import { _commonCalRender } from '../daily/diary-print-view.js';
import { openPersonSearch } from '../../core/person-search-ui.js';
import { resetAddPersonModal, matchKorean } from '../daily/daily-autocomplete.js';
import { S, ensureHolidayYear } from '../../core/app-state.js';
import { appConfirmModal } from '../../core/ui-utils.js';
import { _sheetsAccountHtml, _sheetsAccountInit } from '../dashboard/dashboard-view.js';
import { matchCareStudent, persistCareRegistration, applyCareResult, normalizeCareSchoolLevel } from '../../core/care-registration.js';

/* 명단 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님). 예) 2025-02-26 → 2024학년도. (사용자 지시 2026-06-19)
   ※ 기존 typeof _academicYear 가드들이 이 로컬 정의로 해석돼 달력연도 폴백을 막는다. */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

/* ═══ 전화번호 입력 자동 포맷 헬퍼 ═══
 * 사용자 요청: 숫자만 입력해도 010-XXXX-XXXX 형태로 자동 하이픈 삽입.
 * 다른 기호(공백·괄호·점 등) 입력 차단. 하이픈은 허용하되 내부적으로 재정규화.
 * 지원 형식:
 *   02-XXX-XXXX, 02-XXXX-XXXX (서울)
 *   0XX-XXX-XXXX, 0XX-XXXX-XXXX (010·070·031 등) */
function _apFormatPhone(raw){
  const d = String(raw||'').replace(/\D/g, '');
  if(!d) return '';
  if(d.startsWith('02')){
    if(d.length <= 2) return d;
    if(d.length <= 5) return d.slice(0,2)+'-'+d.slice(2);
    if(d.length <= 9) return d.slice(0,2)+'-'+d.slice(2,5)+'-'+d.slice(5);
    return d.slice(0,2)+'-'+d.slice(2,6)+'-'+d.slice(6,10);
  }
  if(d.length <= 3) return d;
  if(d.length <= 7) return d.slice(0,3)+'-'+d.slice(3);
  if(d.length <= 10) return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
  return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7,11);
}
function _apAttachPhoneInput(inp){
  if(!inp || inp._apPhoneAttached) return;
  inp._apPhoneAttached = true;
  inp.setAttribute('inputmode','tel');
  inp.setAttribute('maxlength','13');
  /* 초기값이 있으면 한 번 포맷팅 */
  if(inp.value) inp.value = _apFormatPhone(inp.value);
  inp.addEventListener('input', function(e){
    /* 캐럿 위치 보존 — 포맷 전 숫자만 카운트 */
    const before = inp.value;
    const caret = inp.selectionStart || before.length;
    const digitsBeforeCaret = before.slice(0, caret).replace(/\D/g,'').length;
    const formatted = _apFormatPhone(before);
    inp.value = formatted;
    /* 캐럿 복원 — 동일한 digits 개수까지 진행한 위치 */
    let newCaret = 0, seen = 0;
    while(newCaret < formatted.length && seen < digitsBeforeCaret){
      if(/\d/.test(formatted[newCaret])) seen++;
      newCaret++;
    }
    try{ inp.setSelectionRange(newCaret, newCaret); }catch(_){}
  });
  /* 다른 기호(공백·괄호·점·* 등) 붙여넣기 차단 — paste 시 normalize */
  inp.addEventListener('paste', function(e){
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    inp.value = _apFormatPhone(text);
    inp.dispatchEvent(new Event('input'));
  });
}

/* 전화번호 input 자동 부착 — 매번 innerHTML 렌더 후 호출할 필요 없이 focus 시점에 일괄 처리. */
document.addEventListener('focusin', function(e){
  const t = e.target;
  if(!t || t.tagName !== 'INPUT') return;
  const id = t.id || '';
  if(id === 'apGuardianContact' || id === 'apEditGuardianContact'
     || id === 'apStaffFamilyPhone' || id === 'apEditStaffFamilyPhone'){
    _apAttachPhoneInput(t);
  }
});

/* ═══ 공용 Sheets 폴더 선택 헬퍼 (인원 데이터 관리용) ═══ */
let _pmSheetsFolder=null;
/* XLSX 파일 파싱 헬퍼 (settings-view.js와 동일) */
function parseXLSX(data){
  if(typeof XLSX==='undefined')throw new Error('XLSX 라이브러리를 찾을 수 없습니다');
  const wb=XLSX.read(data,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{defval:''});
}
/* 헤더 정규화 — "(필수)/(선택)" 등 괄호 주석·공백 제거. "반 (필수)"→"반", NEIS "성 명"→"성명". */
function _normHeader(h){ return String(h==null?'':h).replace(/\([^)]*\)/g,'').replace(/\s+/g,'').trim(); }
/* 워크북 1번 시트에서 헤더 행을 자동 탐색해 {headers, rows} 반환.
 *  · sheet_to_json 의 "무조건 1행=헤더" 가정 대신, 이름류 헤더가 있는 행을 헤더로 잡는다.
 *    (NEIS 원본·엑셀 재저장으로 제목/안내 행이 위에 끼어 헤더가 2~3행으로 밀린 파일도 처리 →
 *     "이름 열을 찾을 수 없습니다" 오작동 방지.)
 *  · rows: 헤더 행 아래의 비어있지 않은 데이터 행들을, 원본 헤더 문자열을 key 로 하는 객체 배열. */
function parseXLSXTable(data){
  if(typeof XLSX==='undefined')throw new Error('XLSX 라이브러리를 찾을 수 없습니다');
  const wb=XLSX.read(data,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  if(!aoa.length)return {headers:[],rows:[]};
  let hr=0;
  for(let i=0;i<Math.min(aoa.length,20);i++){
    const row=aoa[i]||[];
    if(row.some(function(c){return /이름|성\s*명|name/i.test(String(c==null?'':c));})){ hr=i; break; }
  }
  const headers=(aoa[hr]||[]).map(function(c){return String(c==null?'':c).trim();});
  const rows=[];
  for(let i=hr+1;i<aoa.length;i++){
    const row=aoa[i]||[];
    const obj={}; let any=false;
    for(let c=0;c<headers.length;c++){
      const key=headers[c]; if(!key)continue;
      const v=(row[c]==null)?'':row[c];
      obj[key]=v;
      if(String(v).trim()!=='')any=true;
    }
    if(any)rows.push(obj);
  }
  return {headers:headers, rows:rows};
}

async function _pmSheetsBrowse(){
  const cur=_pmSheetsFolder||{id:null,path:[]};
  const parentId=cur.id||null;
  const ex=document.getElementById('pmDriveFolderPicker');if(ex)ex.remove();
  const pk=document.createElement('div');pk.id='pmDriveFolderPicker';
  pk.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9800;display:flex;align-items:center;justify-content:center';
  pk.innerHTML='<div style="background:var(--card);border-radius:12px;width:400px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.3);overflow:hidden">'
    +'<div style="padding:12px 16px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">📂 폴더 선택</div>'
    +'<div id="pmDriveFolderList" style="padding:12px 16px;max-height:300px;overflow-y:auto;min-height:60px"><div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">불러오는 중...</div></div>'
    +'<div style="padding:10px 16px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;justify-content:space-between">'
    +'<button data-pmdrv="new" style="padding:5px 12px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer">+ 새 폴더</button>'
    +'<button data-pmdrv="select" style="padding:5px 14px;font-size:10px;font-weight:700;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer">이 폴더 선택</button>'
    +'</div></div>';
  pk.addEventListener('click',function(e){
    if(e.target===pk){pk.remove();return;}
    const el=e.target.closest('[data-pmdrv]');if(!el)return;
    const act=el.dataset.pmdrv;
    if(act==='new')_pmDriveFolderNew();
    else if(act==='select')_pmDriveFolderSelect();
    else if(act==='up')_pmDriveFolderUp();
    else if(act==='enter')_pmDriveFolderEnter(el.dataset.id,el.dataset.name);
  });
  document.body.appendChild(pk);
  S._pmDriveStack=cur.path?cur.path.slice():[];
  S._pmDriveCur=parentId;
  _pmDriveFolderLoad(parentId);
}
async function _pmDriveFolderLoad(parentId){
  const list=document.getElementById('pmDriveFolderList');if(!list)return;
  list.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">불러오는 중...</div>';
  try{
    const res=await window.electronAPI.driveListFolders(parentId);
    if(!res.success)throw new Error(res.error);
    const folders=res.folders||[];
    let h='';
    if(S._pmDriveStack&&S._pmDriveStack.length>0){
      h+='<div data-pmdrv="up" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;color:var(--t2);font-weight:600;border:1px solid var(--bdr);margin-bottom:4px">⬆️ 상위 폴더</div>';
    }
    if(!folders.length) h+='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">하위 폴더가 없습니다</div>';
    folders.forEach(function(f){
      h+='<div data-pmdrv="enter" data-id="'+f.id+'" data-name="'+escHtml(f.name).replace(/"/g,'&quot;')+'" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;color:var(--t1);font-weight:600;border:1px solid transparent;margin-bottom:2px"><span style="font-size:16px">📁</span>'+escHtml(f.name)+'</div>';
    });
    list.innerHTML=h;
  }catch(err){
    if(err.message&&(err.message.indexOf('Not authenticated')>=0||err.message.indexOf('insufficient authentication')>=0)){
      list.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">Google 로그인 필요...</div>';
      try{const r=await window.electronAPI.googleLogin();if(r&&r.success){_pmDriveFolderLoad(parentId);return;}}catch(_){}
      list.innerHTML='<div style="text-align:center;padding:16px;color:#ef4444;font-size:11px">로그인 실패</div>';
    } else {
      list.innerHTML='<div style="text-align:center;padding:16px;color:#ef4444;font-size:11px">오류: '+escHtml(err.message||'')+'</div>';
    }
  }
}
function _pmDriveFolderEnter(id,name){
  S._pmDriveStack=S._pmDriveStack||[];
  S._pmDriveStack.push({id:S._pmDriveCur,name:name});
  S._pmDriveCur=id;
  _pmDriveFolderLoad(id);
}
function _pmDriveFolderUp(){
  const stack=S._pmDriveStack||[];
  if(!stack.length)return;
  const parent=stack.pop();
  S._pmDriveCur=parent.id||null;
  _pmDriveFolderLoad(S._pmDriveCur);
}
async function _pmDriveFolderNew(){
  const name=prompt('새 폴더 이름을 입력하세요:','오렌지톡');
  if(!name||!name.trim())return;
  try{
    const parentId=S._pmDriveCur||null;
    const res=await window.electronAPI.driveCreateFolder(name.trim(),parentId);
    if(!res.success)throw new Error(res.error);
    _pmDriveFolderLoad(parentId);
  }catch(err){alert('폴더 생성 실패: '+err.message);}
}
function _pmDriveFolderSelect(){
  const id=S._pmDriveCur;
  const stack=S._pmDriveStack||[];
  const pk=document.getElementById('pmDriveFolderPicker');
  if(!id){
    _pmSheetsFolder={id:null,name:'내 드라이브 (루트)',path:[]};
    localStorage.removeItem('pm_sheets_export_folder');
    const fp=document.getElementById('pmSheetsFolderPath');if(fp)fp.textContent='내 드라이브 (루트)';
    if(pk)pk.remove();return;
  }
  const name=stack.length?stack[stack.length-1].name:'내 드라이브';
  const pathNames=stack.map(function(s){return s.name;}).filter(Boolean);
  const folderData={id:id,name:pathNames.join(' / ')||name,path:stack.slice()};
  _pmSheetsFolder=folderData;
  localStorage.setItem('pm_sheets_export_folder',JSON.stringify(folderData));
  const fp=document.getElementById('pmSheetsFolderPath');if(fp)fp.textContent='📂 '+folderData.name;
  if(pk)pk.remove();
}
function _pmSheetsFolderUiHtml(){
  /* localStorage 복원 */
  try{const f=JSON.parse(localStorage.getItem('pm_sheets_export_folder')||'null');if(f&&f.id)_pmSheetsFolder=f;}catch(_){}
  const label=(_pmSheetsFolder&&_pmSheetsFolder.id)?('📂 '+_pmSheetsFolder.name):'내 드라이브 (루트)';
  return '<div style="margin-top:12px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:10px 12px">'
    +'<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">📂 저장 위치</div>'
    +'<div id="pmSheetsFolderPath" style="font-size:10px;color:var(--t2);margin-bottom:6px">'+escHtml(label)+'</div>'
    +'<div style="display:flex;gap:6px">'
    +'<button data-pm-sheet-act="browse" style="padding:4px 10px;font-size:10px;font-weight:600;background:var(--bg);color:var(--t2);border:1px solid var(--bdr);border-radius:5px;cursor:pointer;font-family:var(--f)">📁 폴더 선택</button>'
    +'</div></div>';
}
function _pmBindSheetsFolderUi(ov){
  ov.addEventListener('click',function(e){
    const el=e.target.closest('[data-pm-sheet-act]');if(!el)return;
    if(el.dataset.pmSheetAct==='browse')_pmSheetsBrowse();
    else if(el.dataset.pmSheetAct==='sheets-switch'){
      import('../dashboard/dashboard-view.js').then(m=>{if(m._sheetsAccountSwitch)m._sheetsAccountSwitch(el.dataset.container);});
    }
  });
  /* 계정 UI 위임 (dashboard의 sheets-switch / sheets-use-main data-action 사용) */
  ov.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const act=el.dataset.action;
    if(act==='sheets-switch'||act==='sheets-use-main'){
      const container=el.dataset.container;
      window.electronAPI[act==='sheets-switch'?'sheetsLogin':'sheetsUseMain']().then(function(){
        _sheetsAccountInit(container);
      });
    }
  });
}

let _apConsentStudents=null;

/* ── Central event delegation dispatcher ── */
const _pmActions={};
function _pmDelegate(container){
  if(!container||container._pmDelegated)return;
  container._pmDelegated=true;
  container.addEventListener('click',function(e){
    /* 중첩된 _pmDelegate 컨테이너가 모두 동일 click 을 잡아 같은 action 이 2회 이상 호출되는 문제
     *  (예: 삭제 confirm 두 번 뜸) 차단 — 이벤트에 처리 마커를 찍어 안쪽 핸들러가 한 번 처리하면
     *  바깥쪽 핸들러는 스킵. */
    if(e._pmActionHandled) return;
    const el=e.target.closest('[data-action]');
    if(!el||!container.contains(el))return;
    e._pmActionHandled = true;
    const action=el.dataset.action;const arg=el.dataset.arg;const arg2=el.dataset.arg2;
    const fn=_pmActions[action]||window[action];
    if(typeof fn==='function'){
      if(arg2!==undefined) fn(arg,arg2);
      else if(arg!==undefined) fn(arg);
      else fn();
    }
  });
  /* hover delegation for cards/chips */
  container.addEventListener('mouseenter',function(e){
    const el=e.target.closest('[data-hover="card"]');
    if(el&&container.contains(el)){el.style.borderColor='var(--cyan)';el.style.boxShadow='0 2px 12px rgba(14,116,144,0.08)';}
    const el2=e.target.closest('[data-hover="chip"]');
    if(el2&&container.contains(el2)){el2.style.borderColor='var(--cyan)';el2.style.background='var(--hover)';}
    const el3=e.target.closest('[data-hover="del-chip"]');
    if(el3&&container.contains(el3)){el3.style.borderColor='var(--rs)';el3.style.background='rgba(239,68,68,0.06)';}
    const el4=e.target.closest('[data-hover="cls"]');
    if(el4&&container.contains(el4)){el4.style.borderColor='var(--cyan)';}
    const el5=e.target.closest('[data-hover="ac"]');
    if(el5&&container.contains(el5)){el5.style.background='var(--hover)';}
    const el6=e.target.closest('[data-hover="del-btn"]');
    if(el6&&container.contains(el6)){el6.style.color='#ef4444';}
  },true);
  container.addEventListener('mouseleave',function(e){
    const el=e.target.closest('[data-hover="card"]');
    if(el&&container.contains(el)){el.style.borderColor='var(--bdr)';el.style.boxShadow='none';}
    const el2=e.target.closest('[data-hover="chip"]');
    if(el2&&container.contains(el2)){el2.style.borderColor=el2.dataset.hoverRestore||'var(--bdr)';el2.style.background=el2.dataset.hoverBgRestore||'var(--card)';}
    const el3=e.target.closest('[data-hover="del-chip"]');
    if(el3&&container.contains(el3)){el3.style.borderColor='var(--bdr)';el3.style.background='var(--card)';}
    const el4=e.target.closest('[data-hover="cls"]');
    if(el4&&container.contains(el4)){el4.style.borderColor='var(--bdr)';}
    const el5=e.target.closest('[data-hover="ac"]');
    if(el5&&container.contains(el5)){el5.style.background='';}
    const el6=e.target.closest('[data-hover="del-btn"]');
    if(el6&&container.contains(el6)){el6.style.color='var(--t3)';}
  },true);
}
/* Attach delegation + file handlers after innerHTML set */
function _pmBindUpload(container){
  if(!container)return;
  container.querySelectorAll('.pm-upload-area').forEach(function(area){
    const targetId=area.dataset.fileTarget;
    /* 한 번 클릭으로 파일 선택 다이얼로그 열기 */
    area.style.cursor='pointer';
    area.addEventListener('click',function(){const fi=document.getElementById(targetId);if(fi){fi.value='';fi.click();}});
    area.addEventListener('dragover',function(e){e.preventDefault();this.classList.add('dragover');});
    area.addEventListener('dragleave',function(){this.classList.remove('dragover');});
    area.addEventListener('drop',function(e){
      e.preventDefault();this.classList.remove('dragover');
      const handler=area.dataset.dropHandler;
      if(handler&&_pmActions[handler]&&e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0])
        _pmActions[handler](e.dataTransfer.files[0]);
    });
    if(area.dataset.pasteHandler){
      area.addEventListener('paste',function(e){
        const handler=area.dataset.pasteHandler;
        if(handler&&_pmActions[handler])_pmActions[handler](e);
      });
    }
  });
  container.querySelectorAll('.pm-file-input').forEach(function(fi){
    fi.addEventListener('change',function(){
      const handler=fi.dataset.changeHandler;
      if(handler&&_pmActions[handler]&&this.files&&this.files[0])_pmActions[handler](this.files[0]);
      /* 같은 파일을 다시 선택해도 change 가 재발생하도록 입력값 초기화 (2026-06-07).
         (File 객체는 이미 핸들러에 전달됨 — 초기화해도 처리에는 영향 없음) */
      this.value='';
    });
  });
  container.querySelectorAll('.pm-oninput').forEach(function(inp){
    const handler=inp.dataset.inputHandler;
    if(handler&&_pmActions[handler]){
      inp.addEventListener('input',function(e){_pmActions[handler](this,e);});
    }
  });
}

/* ═══════════════════════════════════════
   ADD PERSON (Req 28)
   ═══════════════════════════════════════ */
export function toggleAddPerson(){
  const existing=document.getElementById('addPersonModal');
  if(existing){_closeApModal(existing);return;}
  const ov=document.createElement('div');ov.id='addPersonModal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0);z-index:9000;display:flex;align-items:center;justify-content:center;transition:background .25s ease';

  const _k=typeof isKinder==='function'&&isKinder();
  const _sl=_k?'원아':'학생';
  const menuItems=[
    {id:'staff',icon:'👔',label:'교직원 등록/변경',sub:'직위, 성별, 가족 연락처'},
    {id:'student',icon:'🎒',label:_sl+' 등록/변경',sub:'주 보호자 연락처 포함'},
    {id:'care',icon:'🛡',label:'요보호 & 미세먼지 기저질환 '+_sl+' 등록/변경',sub:'명단/내용 관리, 인쇄, PDF'},
    {id:'medConsent',icon:'💊',label:'응급처치 & 일반의약품 투여 비동의 등록/변경',sub:'비동의 '+_sl+' 등록'},
    {id:'tb',icon:'💉',label:'잠복결핵 검사 등록/검색',sub:'개별, 일괄 등록 및 검색'}
  ];

  /* Left panel */
  let left='<div style="width:340px;min-width:340px;border-right:1px solid var(--glass-border);display:flex;flex-direction:column;background:var(--panel-grad);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)">'
    +'<div style="padding:16px 18px 12px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))">'
    +'<div style="font-size:15px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:6px">👥 인원 데이터 관리</div>'
    +'<div style="font-size:11px;color:var(--t3);margin-top:4px">항목 위에 마우스를 올려보세요</div>'
    +'</div>'
    +'<div style="flex:1;overflow-y:auto;padding:8px">';
  menuItems.forEach(function(m){
    const dangerStyle=m.danger?';color:#dc2626':'';
    left+='<div class="ap-menu-item" data-ap-menu="'+m.id+'" data-action="activatePanel" data-arg="'+m.id+'" style="padding:10px 14px;border-radius:10px;cursor:pointer;transition:all .12s;display:flex;align-items:center;gap:10px;margin-bottom:2px'+dangerStyle+'">'
      +'<span style="font-size:18px;width:28px;text-align:center;flex-shrink:0">'+m.icon+'</span>'
      +'<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:inherit">'+m.label+'</div>'
      +'<div style="font-size:10px;color:var(--t3);margin-top:1px">'+m.sub+'</div></div></div>';
  });
  left+='</div></div>';

  /* Right panel */
  const right='<div style="flex:1;display:flex;flex-direction:column;min-width:0;position:relative">'
    +'<div id="apRightContent" style="flex:1;overflow-y:auto;scroll-behavior:smooth;padding:24px 20px;display:flex;align-items:center;justify-content:center;scrollbar-width:thin">'
    +'<div style="text-align:center;color:var(--t3)"><div style="font-size:36px;margin-bottom:8px">👈</div><div style="font-size:13px;font-weight:600">왼쪽 메뉴에서 항목을 선택하세요</div></div>'
    +'</div></div>';

  ov.innerHTML='<div style="display:flex;background:var(--card);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.35);overflow:hidden;max-width:920px;width:96vw;height:580px;transform:scale(0.95) translateY(8px);transition:transform .25s cubic-bezier(.4,0,.2,1),opacity .25s;opacity:0">'
    +left+right+'</div>';

  ov.addEventListener('click',function(e){if(e.target===ov)_closeApModal(ov);});
  function _escAP(e){if(e.key==='Escape'){const o=document.getElementById('addPersonModal');if(o)_closeApModal(o);document.removeEventListener('keydown',_escAP);}}
  document.addEventListener('keydown',_escAP);
  /* Enter/Arrow 키 네비게이션 */
  ov.addEventListener('keydown',function(e){
    const el=e.target;if(!el.classList.contains('ap-nav-field'))return;
    const order=parseInt(el.dataset.apOrder,10);
    if(e.key==='ArrowDown'||e.key==='ArrowRight'){
      e.preventDefault();
      const next=ov.querySelector('.ap-nav-field[data-ap-order="'+(order+1)+'"]');if(next)next.focus();
    } else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){
      e.preventDefault();
      const prev=ov.querySelector('.ap-nav-field[data-ap-order="'+(order-1)+'"]');if(prev)prev.focus();
    } else if(e.key==='Enter'){
      e.preventDefault();
      if(order>=4&&document.getElementById('apGrade')&&document.getElementById('apGrade').value&&document.getElementById('apName')&&document.getElementById('apName').value){addPerson();}
      else{const nxt=ov.querySelector('.ap-nav-field[data-ap-order="'+(order+1)+'"]');if(nxt)nxt.focus();}
    }
  });
  document.body.appendChild(ov);
  _pmDelegate(ov);
  _makeDraggable(ov.firstElementChild);
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    ov.style.background='rgba(0,0,0,0.35)';
    const c=ov.firstChild;if(c){c.style.transform='scale(1) translateY(0)';c.style.opacity='1';}
  });});
}

/* 학생/교직원 선택 모달 — 일반일지 무결과·상세검색 "+ 등록" 클릭 시 먼저 띄움.
 * GUI 는 일반일지 삭제 확인 모달(_dailyConfirm)과 동일 톤(헤더/바디/푸터).
 * 학생 → 학생 개별 등록, 교직원 → 교직원 개별 등록 폼으로 직행. */
export function openPersonTypeChooser(prefillName){
  const _k = (typeof isKinder==='function') && isKinder();
  const _sl = _k ? '원아' : '학생';
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:50000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:360px;max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden">'
    +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">＋ 인원 등록</div>'
    +'<div style="padding:16px 20px;font-size:12.5px;color:var(--t1);line-height:1.7;background:var(--card)">등록할 인원이 <b>'+_sl+'</b>인가요, <b>교직원</b>인가요?</div>'
    +'<div style="display:flex;gap:8px;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)">'
    +'<button data-t="student" style="flex:1;padding:10px 14px;font-size:12.5px;font-weight:700;border-radius:7px;border:1px solid var(--cyan);background:rgba(6,182,212,0.10);color:var(--cyan);cursor:pointer;outline:none;font-family:var(--f)">🎒 '+_sl+'</button>'
    +'<button data-t="staff" style="flex:1;padding:10px 14px;font-size:12.5px;font-weight:700;border-radius:7px;border:1px solid #16a34a;background:rgba(22,163,74,0.10);color:#16a34a;cursor:pointer;outline:none;font-family:var(--f)">👔 교직원</button>'
    +'</div></div>';
  document.body.appendChild(ov);
  const close=function(){ try{document.removeEventListener('keydown',onKey,true);}catch(_){} ov.remove(); };
  ov.querySelector('[data-t="student"]').addEventListener('click',function(){ close(); openQuickPersonRegister('student', prefillName); });
  ov.querySelector('[data-t="staff"]').addEventListener('click',function(){ close(); openQuickPersonRegister('staff', prefillName); });
  ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
  const onKey=function(e){ if(e.key==='Escape'){ e.preventDefault(); close(); } };
  document.addEventListener('keydown',onKey,true);
}

/* 미등록 인원 빠른 등록 바로가기 — 인원 데이터 관리 모달을 열고
 * "학생/교직원 등록·변경 > 이번 학년도 개별 등록" 폼으로 직행. */
export function openQuickPersonRegister(type, prefillName){
  const _t = (type==='staff') ? 'staff' : 'student';
  if(!document.getElementById('addPersonModal')) toggleAddPerson();
  /* 모달 DOM 준비 후 패널 활성화 → 개별 등록 폼 (apStuBody/apStaffBody 생성 대기) */
  setTimeout(function(){
    try{
      _apActivatePanel(_t);
      setTimeout(function(){
        if(_t==='staff') _apStaffAction('add');
        else _apStuAction('add');
        /* 검색했던 이름을 등록 폼 이름란에 미리 채움 (교직원 apStaffName / 학생 apName). (사용자 요청 2026-06-25) */
        if(prefillName){
          setTimeout(function(){
            const _nm=document.getElementById(_t==='staff'?'apStaffName':'apName');
            if(_nm){ _nm.value=prefillName; try{ _nm.focus(); }catch(_){} }
          }, 40);
        }
      }, 40);
    }catch(e){ console.error('[quick-register]', e); }
  }, 60);
}

let _apActivePanel=null;
/* 동료(웹)가 인원을 원격 변경 → 인원관리 화면이 열려 있으면 현재 패널을 다시 그려 명단 즉시 반영. (2026-06-14)
 *  안전 가드: 모달(#apRightContent) 안의 input/textarea/select 에 포커스가 있거나(입력 중) 값이 들어있으면(작성 중)
 *  이번 사이클은 건너뛴다 — 인라인 등록 폼·검색어를 절대 날리지 않음. ('개별 수정'은 openPersonSearch 별도 오버레이라 무관) */
bus.on('people:remote-changed', function(){
  try{
    const rc=document.getElementById('apRightContent');
    if(!rc||!_apActivePanel)return;
    const ae=document.activeElement;
    if(ae&&rc.contains(ae)&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT'||ae.isContentEditable))return;
    const fields=rc.querySelectorAll('input,textarea');
    for(let i=0;i<fields.length;i++){ if(String(fields[i].value||'').trim()!=='')return; }
    _apRenderPanel(_apActivePanel);
  }catch(_e){}
});
function _apHighlightMenu(id){
  const ov=document.getElementById('addPersonModal');if(!ov)return;
  ov.querySelectorAll('.ap-menu-item').forEach(function(el){
    const isActive=el.dataset.apMenu===id;
    const isDanger=el.dataset.apMenu==='delete';
    if(isActive){
      el.style.background=isDanger?'rgba(220,38,38,0.1)':'rgba(14,116,144,0.12)';
      el.style.color=isDanger?'#dc2626':'var(--cyan)';
    } else {
      el.style.background='';
      el.style.color=isDanger?'#dc2626':'';
    }
  });
}
function _apActivatePanel(id){
  _apActivePanel=id;
  _apRenderPanel(id);
  _apHighlightMenu(id);
}
/* 개별 등록/수정·삭제 시 — 지정 요소를 우측 스크롤 영역(apRightContent) 최상단으로 올려 입력폼·버튼이 바로 보이게.
   (사용자 요청 2026-06-08) 레이아웃 완료 후(rAF 2회) 측정해 안전하게 스크롤. 요소 없으면 조용히 무시. */
function _apScrollToTop(elId){
  try{
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      try{
        const el=document.getElementById(elId);
        const rc=document.getElementById('apRightContent');
        if(!el||!rc)return;
        const elTop=el.getBoundingClientRect().top, rcTop=rc.getBoundingClientRect().top;
        rc.scrollTop += (elTop - rcTop);
      }catch(_){}
    }); });
  }catch(_){}
}
function _apRenderPanel(id){
  const rc=document.getElementById('apRightContent');if(!rc)return;
  rc.style.alignItems='flex-start';
  /* medConsent 패널: 오른쪽 영역 스크롤 끄고 내부 테이블만 스크롤 */
  if(id==='medConsent'){rc.style.overflowY='hidden';rc.style.padding='24px 20px 0';}
  else{rc.style.overflowY='auto';rc.style.padding='24px 20px';}
  const _k=typeof isKinder==='function'&&isKinder();
  const _sl=_k?'원아':'학생';
  let h='';
  if(id==='student'){
    h='<div style="width:100%">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:12px">🎒 '+_sl+' 등록/변경</div>'
      +'<div id="apStuNameDupAlert"></div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap">'
      +_apCard('📥','이번 학년도<br>전체 일괄 등록','최적화 양식으로 전체 '+_sl+' 일괄 업로드','_apStuAction(\'bulk\')')
      +_apCard('🗑️','이번 학년도<br>전체 일괄 삭제','이번 학년도 명단을 전부 비웁니다 (보건일지·증상·처치 기록은 보존)','_apStuAction(\'deleteAll\')')
      +_apCard('➕','이번 학년도<br>개별 등록','학년, 반, 번호, 이름, 보호자 정보 입력','_apStuAction(\'add\')')
      +_apCard('✏️','이번 학년도<br>개별 수정/삭제','학생을 찾아서 정보를 수정 또는 삭제','_apStuAction(\'edit\')')
      +'</div>'
      +'<div style="font-size:10px;color:var(--t3);margin-top:8px">데이터베이스 로딩으로 인한 약간의 시간 지체가 있을 수 있습니다.</div>'
      +'<div id="apStuLeaveWarn" style="font-size:10px;color:#dc2626;margin-top:4px;font-weight:600;scroll-margin-top:0">⚠ 올해 이미 등록된 학생 중 전학·자퇴 등으로 학교를 떠난 학생에 대해서는 「이번 학년도 개별 수정/삭제」에서 직접 삭제해야 합니다.</div>'
      /* 미매칭 배너 — 패널 진입 즉시 보이도록 패널 레벨에 배치(일괄 등록 안 눌러도 노출). 사용자 요청 2026-06-09 */
      +'<div id="apStuUnmatched"></div>'
      /* 업로드 비교 GUI 보류 재표시용 — 확인/취소 안 한 경우 다시 표시 (사용자 요청 2026-06-09) */
      +'<div id="studentPendingCompare"></div>'
      /* 동명이인 처리 — 기존 회색 버튼은 폐지되고 상단의 ⚠ 알림 카드(apStuNameDupAlert)로 통합됨 */
      +'<div id="apStuBody" style="margin-top:14px"></div>'
      +'<div id="apStuInline"></div>'
      +'</div>';
  } else if(id==='staff'){
    h='<div style="width:100%">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:12px">👔 교직원 등록/변경</div>'
      +'<div id="apStaffNameDupAlert"></div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap">'
      +_apCard('📥','이번 학년도<br>전체 일괄 등록','최적화 양식으로 전체 교직원 일괄 업로드','_apStaffAction(\'bulk\')')
      +_apCard('🗑️','이번 학년도<br>전체 일괄 삭제','이번 학년도 교직원 명단을 전부 비웁니다 (보건일지·기록은 보존)','_apStaffAction(\'deleteAll\')')
      +_apCard('➕','이번 학년도<br>개별 등록','직위, 이름, 성별 입력','_apStaffAction(\'add\')')
      +_apCard('✏️','이번 학년도<br>개별 수정/삭제','교직원을 찾아서 정보를 수정 또는 삭제','_apStaffAction(\'edit\')')
      +'</div>'
      +'<div id="staffPendingMatch"></div>'
      +'<div style="font-size:10px;color:var(--t3);margin-top:8px">데이터베이스 로딩으로 인한 약간의 시간 지체가 있을 수 있습니다.</div>'
      +'<div id="apStaffBody" style="margin-top:14px"></div>'
      +'<div id="apStaffInline"></div>'
      +'</div>';
  } else if(id==='care'){
    h='<div style="width:100%">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:4px">🛡 요보호 & 미세먼지 기저질환 '+_sl+' 등록/변경 (올해)</div>'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:4px;line-height:1.7">보건일지에 먼저 등록된 학생이어야 합니다.<br>데이터베이스 로딩으로 인한 약간의 시간 지체가 있을 수 있습니다.</div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">'
      +_apCard('📥','이번 학년도<br>전체 일괄 등록','최적화 양식으로 요보호·미세먼지 기저질환 학생 일괄 업로드','_apCareBulk()')
      +_apCard('➕','이번 학년도<br>개별 등록','학생을 찾아 요보호·미세먼지 기저질환 내용 등록','_apCareAction(\'add\')')
      +_apCard('✏️','이번 학년도<br>개별 수정/삭제','등록된 학생을 찾아 내용 수정 또는 해제','_apCareAction(\'edit\')')
      +'</div>'
      +'<div id="apCareUnmatched"></div>'
      +'<div id="apCareBody" style="margin-top:4px"></div>'
      +'<div id="apCareInline"></div>'
      +'</div>';
  } else if(id==='medConsent'){
    const _k=isKinder();
    const _stuAll=S.people.filter(function(s){return s.type==='student'&&s.grade>0;});
    _apStuSort(_stuAll);
    const _grades=[];const _gSet={};_stuAll.forEach(function(s){if(!_gSet[s.grade]){_gSet[s.grade]=true;_grades.push(s.grade);}});
    _grades.sort(function(a,b){return a-b;});
    const _hasLevel=_stuAll.some(function(s){return s.level&&String(s.level).trim();});
    const _hasDept=_stuAll.some(function(s){return s.department&&String(s.department).trim();});
    _apConsentHasLevel=_hasLevel;_apConsentHasDept=_hasDept;
    h='<div style="width:100%;display:flex;flex-direction:column;height:100%;overflow:hidden">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:4px">💊 응급처치 & 일반의약품 투여 비동의 등록/변경</div>'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.7">비동의 학생이 있다면 동의를 비동의로 변경하면 됩니다.<br>모두 동의함이 디폴트 값입니다.<br>데이터베이스 로딩으로 인한 약간의 시간 지체가 있을 수 있습니다.</div>'
      +'<div style="margin-bottom:8px;position:relative"><input class="form-input pm-oninput" id="apConsentSearch" placeholder="이름·학년·반·번호·초성으로 검색" style="font-size:11px;width:100%;padding:7px 32px 7px 10px" autocomplete="off" data-input-handler="_apConsentSearch"><span data-action="_apConsentClearSearch" id="apConsentClear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;cursor:pointer;user-select:none">✕</span></div>'
      +'<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">'
      +'<button class="btn-add" data-action="_apConsentFilter" data-arg="0" id="apConGrAll" style="font-size:10px;height:26px;padding:0 10px;font-weight:700">전체</button>';
    /* 학교급-학년 조합 버튼 (유→초→중→고→대 순) — 다중 학교급이면 학교급 prefix 표기 */
    const _apConCombos=_apLvGradeCombos(_stuAll);
    const _apConLvSet={};_apConCombos.forEach(function(c){if(c.level)_apConLvSet[c.level]=true;});
    const _apConMulti=Object.keys(_apConLvSet).length>=2;
    if(_apConCombos.length>0){
      _apConCombos.forEach(function(c){
        const key=c.level+'|'+c.grade;
        h+='<button class="btn-add" data-action="_apConsentFilter" data-arg="'+key+'" style="font-size:10px;height:26px;padding:0 10px;font-weight:600">'+_apLvGradeLabel(c.level,c.grade,{multiLevel:_apConMulti,isKinder:_k})+'</button>';
      });
    } else {
      _grades.forEach(function(g){
        h+='<button class="btn-add" data-action="_apConsentFilter" data-arg="'+g+'" style="font-size:10px;height:26px;padding:0 10px;font-weight:600">'+(_k?('만'+g+'세'):(g+'학년'))+'</button>';
      });
    }
    h+='</div>'
      +'<div id="apConsentTableWrap" style="flex:1;overflow-y:auto;scrollbar-width:thin;min-height:0">'
      +'<table id="apConsentTable" style="width:100%;border-collapse:collapse;font-size:11px">'
      +'<thead style="position:sticky;top:0;z-index:5;background:var(--bg2)"><tr style="background:var(--bg2)">'
      +'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:36px">순</th>'
      +(_hasLevel?'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:52px">학교급</th>':'')
      +(_hasDept?'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:96px">학과</th>':'')
      +'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:70px">'+(_k?'나이':'학년반')+'</th>'
      +'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:40px">'+(_k?'반':'번호')+'</th>'
      +'<th style="padding:8px 14px;text-align:left;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);min-width:140px">이름</th>'
      +'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:100px">응급처치</th>'
      +'<th style="padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);width:100px">일반의약품</th>'
      +'</tr></thead><tbody id="apConsentBody">';
    _stuAll.forEach(function(s,i){
      h+=_apConsentRow(s,i);
    });
    h+='</tbody></table></div></div>';
    _apConsentStudents=_stuAll;
  } else if(id==='tb'){
    h='<div style="width:100%">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:12px">💉 잠복결핵 검사 등록/검색</div>'
      +'<div style="display:flex;gap:10px">'+_apCard('📥','일괄 누적 등록','엑셀 파일을 업로드하여 일괄 등록합니다','_apTbBulk()')+_apCard('➕','개별 등록','검사한 교직원의 이름을 적으세요','_apTbIndiv()')+_apCard('📋','누적 인원 보기','등록된 전체 수검자 명단(검색·수정·삭제 가능)','_apTbShowList()')+'</div>'
      +'<div style="font-size:10px;color:var(--t3);margin-top:8px">데이터베이스 로딩으로 인한 약간의 시간 지체가 있을 수 있습니다.</div>'
      +'<div style="margin-top:14px;font-size:12px;color:var(--t1);text-align:center;font-weight:600">※ 교육부의 잠복결핵 데이터 관리 시스템 도입을 이제는 부탁드립니다.</div>'
      +'<div style="margin-top:6px;font-size:12px;color:#dc2626;text-align:center;font-weight:700">수정이나 삭제가 필요한 경우 아래 입력란에서 검색 또는 스크롤을 내려서 선택해주세요.</div>'
      +'<div id="apTbBody" style="margin-top:14px"></div></div>';
  } else if(id==='weight'){
    h='<div style="width:100%">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:8px">⚖️ 체중 조절 희망 학생 관리</div>'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:12px">교육청 비만 예방 사업 대상 학생의 체중·키·BMI 변화를 추적합니다.</div>'
      +'<div style="display:flex;gap:8px;margin-bottom:12px">'
      +'<div style="flex:1;position:relative"><input class="form-input pm-oninput" data-input-handler="_apWtDoSearch" id="apWtSearch" placeholder="학생 이름 검색" style="font-size:11px;width:100%" autocomplete="off"><div id="apWtACList" style="position:absolute;top:100%;left:0;right:0;z-index:600;background:var(--card);border:1px solid var(--bdr);border-radius:6px;box-shadow:var(--sh);max-height:160px;overflow-y:auto;display:none"></div></div>'
      +'<button class="btn btn-sm" data-action="_apWtDetailSearch" style="font-size:10px;font-weight:600;white-space:nowrap">상세 검색</button>'
      +'<button class="btn btn-sm" data-action="_apWtAllCharts" style="font-size:10px;font-weight:700;white-space:nowrap;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none">📊 전체 학생 차트 보기</button>'
      +'</div>'
      +'<div id="apWtBody"></div></div>';
  } else if(id==='delete'){
    h='<div style="width:100%">'
      +'<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:12px">🗑 인원 삭제</div>'
      +'<div style="display:flex;gap:10px;margin-bottom:14px">'+_apCard('👔','교직원','교직원 목록에서<br>삭제할 사람 선택','_apDelType(\'staff\')')+_apCard('🎒','학생','학년/반 선택 후<br>삭제할 학생 선택','_apDelType(\'student\')')+'</div>'
      +'<div id="apDelBody"></div></div>';
  }
  rc.innerHTML=h;
  _pmDelegate(rc);
  _pmBindUpload(rc);
  if(id==='student'||id==='staff'||id==='care')_apInlineBootstrap(id);
  if(id==='tb'&&typeof _apTbShowList==='function')_apTbShowList();
  /* 학생 패널 진입 시 동명이인 처리 버튼 상태 갱신 + 미매칭 배너 렌더(일괄 등록 안 눌러도 보이게) */
  if(id==='student'){ _apStuRenderUnmatched(); if(typeof reshowStudentPending==='function') reshowStudentPending(document.getElementById('studentPendingCompare')); if(typeof window._refreshAmbBtn === 'function') setTimeout(window._refreshAmbBtn, 50); }
  /* 교직원 패널 진입 시 — 업로드 진행/취소 안 한 보류 매칭이 있으면 다시 표시 (사용자 요청 2026-06-09) */
  if(id==='staff' && typeof reshowStaffPending==='function') reshowStaffPending(document.getElementById('staffPendingMatch'));
  /* 학생/교직원 패널 진입 시 — "같은 학년 동명이인 매칭" 미해결 그룹이 있으면 ⚠ 카드로 노출 */
  if(id==='student' || id==='staff') _apRenderNameDupAlert(id);
}

/* 동명이인 (같은 학교급+학년+이름+성별) 미해결 그룹 알림 카드. 학생/교직원 패널에 동적 삽입. */
function _apRenderNameDupAlert(panelId){
  const alertEl = document.getElementById(panelId==='student' ? 'apStuNameDupAlert' : 'apStaffNameDupAlert');
  if(!alertEl) return;
  import('./name-dup-matcher.js').then(function(mod){
    if(!mod || typeof mod.getNameDupGroupCount !== 'function') return;
    mod.getNameDupGroupCount().then(function(count){
      if(!count || count <= 0){ alertEl.innerHTML = ''; return; }
      alertEl.innerHTML = ''
        + '<div id="apNameDupAlertCard" style="margin-bottom:12px;padding:12px 14px;background:linear-gradient(180deg,#fff7ed,#ffedd5);border:1.5px solid rgba(234,88,12,0.30);border-radius:11px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:transform .12s,box-shadow .12s">'
        +   '<span style="font-size:22px;line-height:1">⚠</span>'
        +   '<div style="flex:1">'
        +     '<div style="font-size:13px;font-weight:800;color:#9a3412">같은 학년 동명이인 매칭 필요 — <b>'+count+'건</b></div>'
        +     '<div style="font-size:11px;color:#b45309;margin-top:3px;line-height:1.6">학년이 같으면서 이름이 같은 학생/교직원이 있습니다. 작년 누가 누구인지 매칭하면 보건일지가 연결됩니다.</div>'
        +     '<div style="font-size:11px;color:#9a3412;margin-top:6px;font-weight:700;line-height:1.6">💡 매칭 작업은 추후에 할 수 있으나 가급적 빨리 완료하는 것을 권합니다.</div>'
        +   '</div>'
        +   '<button id="apNameDupOpenBtn" style="padding:9px 16px;font-size:12px;font-weight:800;background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;border:none;border-radius:9px;cursor:pointer;box-shadow:0 3px 9px rgba(234,88,12,0.30);white-space:nowrap">🔀 매칭 시작</button>'
        + '</div>';
      const card = document.getElementById('apNameDupAlertCard');
      const btn  = document.getElementById('apNameDupOpenBtn');
      function _open(){
        mod.openNameDupMatcher({ onDone: function(){ _apRenderNameDupAlert(panelId); } });
      }
      if(card){
        card.addEventListener('click', function(e){
          if(e.target && (e.target.id === 'apNameDupOpenBtn' || e.target.closest('#apNameDupOpenBtn'))) return;
          _open();
        });
        card.addEventListener('mouseover', function(){ this.style.boxShadow='0 4px 12px rgba(234,88,12,0.15)'; this.style.transform='translateY(-1px)'; });
        card.addEventListener('mouseout',  function(){ this.style.boxShadow=''; this.style.transform=''; });
      }
      if(btn) btn.addEventListener('click', function(e){ e.stopPropagation(); _open(); });
    }).catch(function(){});
  }).catch(function(){});
}
/* 공용 카드 빌더 — actionStr: "fnName" or "fnName('arg')" */
function _apCard(icon,title,sub,actionStr){
  /* Parse actionStr into data-action + data-arg */
  const m=actionStr.match(/^(\w+)\((?:'([^']*)')?\)$/);
  const actName=m?m[1]:actionStr;
  const actArg=m?m[2]:'';
  return '<div data-action="'+actName+'"'+(actArg?' data-arg="'+actArg+'"':'')+' data-hover="card" style="flex:1;min-width:120px;padding:20px 16px;border:1.5px solid var(--bdr);border-radius:12px;cursor:pointer;transition:all .15s;text-align:center;word-break:keep-all">'
    +'<div style="font-size:28px;margin-bottom:8px">'+icon+'</div>'
    +'<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:4px;word-break:keep-all">'+title+'</div>'
    +'<div style="font-size:10px;color:var(--t3);line-height:1.5;word-break:keep-all">'+sub+'</div></div>';
}
function _apGradeLabel(g,sl,stuLv){
  const abbrev={'초':'초','중':'중','고':'고','대':'대','유':'유','elementary':'초','middle':'중','high':'고','kindergarten':'유'};
  if(sl==='kindergarten') return '유'+g;
  if(sl==='special'&&stuLv){const a=abbrev[stuLv]||stuLv.substring(0,1);return a+g;}
  /* 일반 학교: grade만 표시 */
  return g+'학년';
}
function _apGradeCards(fn){
  const sl=S.settings.schoolLevel||'elementary';
  const isSpecial=(sl==='special');
  const cardData=[];
  if(isSpecial){
    /* 특수학교: level별로 그룹화 */
    const seen={};
    S.people.forEach(function(s){
      if(s.type!=='student'||!s.grade)return;
      const lv=s.level||'초';
      const key=lv+'_'+s.grade;
      if(!seen[key]){seen[key]=true;cardData.push({grade:s.grade,level:lv,label:_apGradeLabel(s.grade,sl,lv),sortKey:({'유':0,'초':1,'중':2,'고':3,'대':4}[lv]||1)*100+s.grade});}
    });
    cardData.sort(function(a,b){return a.sortKey-b.sortKey;});
  } else {
    const grades=S.people.filter(function(s){return s.type==='student'&&s.grade>0;}).map(function(s){return s.grade;});
    const unique=grades.filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
    unique.forEach(function(g){cardData.push({grade:g,level:'',label:_apGradeLabel(g,sl,'')});});
  }
  let h='<div style="display:flex;gap:8px;flex-wrap:wrap">';
  cardData.forEach(function(cd){
    h+='<div data-action="'+fn+'" data-arg="'+cd.grade+'" data-hover="card" style="flex:1;min-width:55px;padding:12px 8px;border:1.5px solid var(--bdr);border-radius:10px;cursor:pointer;text-align:center;transition:all .15s">'
      +'<div style="font-size:16px;font-weight:800;color:var(--cyan)">'+escHtml(cd.label)+'</div></div>';
  });
  return h+'</div>';
}
function _apClassDiagram(grade,clsFn,backLabel,backFn){
  /* grade 는 dataset.arg 에서 오면 문자열, 학생 데이터는 숫자 → 느슨 비교 */
  const gN=Number(grade);
  const stuByGrade=S.people.filter(function(s){return s.type==='student'&&Number(s.grade)===gN;});
  const classes={};stuByGrade.forEach(function(s){const ck=String(s.cls||'');if(!classes[ck])classes[ck]=[];classes[ck].push(s);});
  const clsKeys=Object.keys(classes).sort(compareClass);
  /* Parse backFn — e.g. "_apRenderPanel('care')" or "_apStuAction('edit')" */
  const bm=backFn.match(/^(\w+)\((?:'([^']*)')?\)$/);
  const backAction=bm?bm[1]:backFn;const backArg=bm?(bm[2]||''):'';
  let h='<div style="margin-bottom:10px"><span data-action="'+backAction+'"'+(backArg?' data-arg="'+backArg+'"':'')+' style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← '+backLabel+'</span></div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+grade+'학년 — 반을 선택하세요</div>';
  h+='<div style="display:flex;flex-direction:column;gap:6px">';
  clsKeys.forEach(function(c){
    const sts=classes[c].sort(function(a,b){return a.num-b.num;});
    h+='<div data-action="'+clsFn+'" data-arg="'+grade+'" data-arg2="'+c+'" data-hover="cls" style="border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;background:var(--bg2);cursor:pointer;transition:all .15s">';
    h+='<div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:4px">'+c+'반 <span style="font-size:10px;color:var(--t3)">('+sts.length+'명)</span></div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:3px">';
    sts.forEach(function(s){h+='<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--card);border:1px solid var(--bdrl);color:var(--t2)">'+s.num+' '+s.name+'</span>';});
    h+='</div></div>';
  });
  return h+'</div>';
}
function _apCareGrade(grade){
  const body=document.getElementById('apCareBody');if(!body)return;
  body.innerHTML=_apClassDiagram(grade,'_apCareClass','학년 선택','_apRenderPanel(\'care\')');
}
function _apCareClass(grade,cls){
  const body=document.getElementById('apCareBody');if(!body)return;
  const sts=S.people.filter(function(s){return s.type==='student'&&String(s.grade)===String(grade)&&String(s.cls)===String(cls);}).sort(function(a,b){return a.num-b.num;});
  let h='<div style="margin-bottom:10px"><span data-action="_apCareGrade" data-arg="'+grade+'" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← '+grade+'학년 반 목록</span></div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+grade+'학년 '+cls+'반 — 학생을 선택하세요</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  sts.forEach(function(s){
    const isCare=s.status==='caution'||s.status==='watch';
    h+='<span data-action="_apCarePickStudent" data-arg="'+s.id+'" data-hover="chip" data-hover-restore="'+(isCare?'var(--yl)':'var(--bdr)')+'" data-hover-bg-restore="var(--card)" style="padding:5px 10px;border:1px solid '+(isCare?'var(--yl)':'var(--bdr)')+';border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t1);background:var(--card);transition:all .15s">'
      +s.num+'번 '+s.name+(isCare?' <span style="font-size:9px;color:var(--yl)">*요보호*</span>':'')+'</span>';
  });
  h+='</div>';
  body.innerHTML=h;
}
function _apCarePickStudent(id){
  const s=getStu(id);if(!s)return;
  const body=document.getElementById('apCareBody')||document.getElementById('apCareIndivList');if(!body)return;
  body.dataset.careStudentId=String(id);
  /* 학교급(여러 학교급일 때만) + 학과(있으면) 접두 — 선택 학생 식별 명확화 (사용자 요청 2026-06-24) */
  const _multiLv=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const _lvShort=_multiLv?(getLevelShort(s)||''):'';
  const _deptStr=String(s.department||'').trim();
  const _pfx=(_lvShort?_lvShort+' ':'')+(_deptStr?_deptStr+' ':'');
  const info=_pfx+(s.grade||'-')+'학년 '+(s.cls||'-')+'반 '+(s.num||'-')+'번 '+s.name;
  const existReason=(s.condition&&s.condition!=='요보호')?s.condition:(s.care_reason||'');
  const existDust=s.dust_disease||s.dustDisease||'';
  const existMemo=s.care_memo||s.careMemo||'';
  let h='<div style="padding:8px 12px;border:1px solid var(--cyan);border-radius:8px;background:var(--cbg);margin-bottom:12px"><span style="font-size:12px;font-weight:700;color:var(--cyan)">✓ '+escHtml(info)+'</span></div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:8px">'
    +'<input id="apCareReason" class="form-input" placeholder="요보호 질환명" value="'+escHtml(existReason)+'" style="font-size:11px;flex:1">'
    +'<input id="apCareDust" class="form-input" placeholder="미세먼지 기저질환명" value="'+escHtml(existDust)+'" style="font-size:11px;flex:1"></div>';
  h+='<div style="margin-bottom:8px"><input id="apCareMemo" class="form-input" placeholder="메모 / 주의사항 (선택)" value="'+escHtml(existMemo)+'" style="font-size:11px;width:100%"></div>';
  if(_apCareMode==='add'){
    h+='<button class="btn btn-primary btn-sm" data-action="_apCareSave" data-arg="'+id+'" style="width:100%">등록</button>';
    /* 등록 단계 — 삭제 비활성(빨간색 톤 유지) */
    h+='<button disabled title="등록 단계에서는 삭제할 수 없습니다" style="width:100%;margin-top:6px;background:rgba(239,68,68,0.04);color:rgba(220,38,38,0.45);border:1px solid rgba(239,68,68,0.18);border-radius:8px;font-weight:700;cursor:not-allowed;padding:7px">🗑 삭제</button>';
  } else {
    h+='<button class="btn btn-primary btn-sm" data-action="_apCareSave" data-arg="'+id+'" style="width:100%">수정</button>';
    h+='<button data-action="_apCareDelete" data-arg="'+id+'" style="width:100%;margin-top:6px;background:rgba(239,68,68,0.08);color:#dc2626;border:1px solid rgba(239,68,68,0.4);border-radius:8px;font-weight:700;cursor:pointer;padding:7px">🗑 삭제 (요보호 / 미세먼지 기저질환 해제)</button>';
  }
  body.innerHTML=h;
}
/* 아래 명단 표에서 행 클릭 → 수정/해제 폼 (편집 모드 고정) + 폼 위치로 스크롤 (사용자 요청 2026-06-02) */
function _apCareEditFromList(id){
  _apCareMode='edit';
  _apCarePickStudent(id);
  const b=document.getElementById('apCareBody');
  if(b&&b.scrollIntoView){try{b.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(_){}}
}
/* 일반 일지표의 '요보호' 칩 클릭 진입점 — 인원관리 모달을 열고 요보호 패널에서 해당 학생 편집폼을
 * 바로 띄운 뒤, 강조(시안 글로우) 애니메이션으로 위치를 알려준다. (사용자 요청 2026-06-24)
 * 모달이 닫혀 있을 때만 연다(이미 열려 있으면 toggle 로 닫히지 않도록 가드). */
export function openCareEditForStudent(id){
  const s=getStu(id); if(!s) return;
  if(!document.getElementById('addPersonModal')) toggleAddPerson();
  _apActivatePanel('care');
  _apCareMode='edit';
  /* 패널 innerHTML·진입 애니메이션이 안정된 뒤(rAF 2회) 편집폼 로드 + 스크롤 + 강조 */
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    _apCarePickStudent(id);
    const body=document.getElementById('apCareBody');
    if(body){
      /* 스크롤을 맨 위로 유지 — 상단 카드(일괄/개별 등록·수정)가 가려지지 않게. 편집폼은 카드 바로 아래에 보임. (사용자 요청 2026-06-24) */
      const rc=document.getElementById('apRightContent');
      if(rc) rc.scrollTop=0;
      _apPulseHighlight(body);
    }
  }); });
}
/* 시안 글로우 펄스 — 방금 로드된 편집폼이 어디인지 시선을 끌어준다 (WAAPI, 미지원 환경은 조용히 무시). */
function _apPulseHighlight(el){
  if(!el||!el.animate)return;
  try{
    el.animate([
      { boxShadow:'0 0 0 0 rgba(6,182,212,0)',    backgroundColor:'rgba(6,182,212,0.14)', borderRadius:'10px' },
      { boxShadow:'0 0 0 6px rgba(6,182,212,0.22)', backgroundColor:'rgba(6,182,212,0.05)', borderRadius:'10px', offset:0.35 },
      { boxShadow:'0 0 0 0 rgba(6,182,212,0)',    backgroundColor:'transparent',          borderRadius:'10px' }
    ], { duration:1500, easing:'ease-out' });
  }catch(_){}
}
/* DB 응답을 확인한 뒤에만 메모리와 화면에 반영한다. SSE가 학생 객체를 교체한 경우도 동기화. */
async function _persistCare(s,changes){
  const year=String(_academicYear());
  const result=await persistCareRegistration(s,changes,{api:window.electronAPI,year:year});
  if(result.success){
    const current=getStu(s.uid||s.id);
    if(current&&!current._notFound&&current!==s)applyCareResult(current,result.care,year);
  }
  return result;
}
function _careSaveNotice(message,failed){
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent=message;toast.className='global-save-toast show';}
  bus.emit('toast:show',{text:message});
}
function _careRefreshSaved(){
  bus.emit('render:daily');bus.emit('render:dashboard');bus.emit('render:sidebar');
  _apCareRefreshLists();
}
async function _apCareSave(id){
  const s=getStu(id);if(!s){bus.emit('toast:show', {text: '학생 정보를 찾을 수 없습니다'});return;}
  const reason=((document.getElementById('apCareReason')||{}).value||'').trim();
  const dust=((document.getElementById('apCareDust')||{}).value||'').trim();
  const memo=((document.getElementById('apCareMemo')||{}).value||'').trim();
  if(!reason&&!dust){bus.emit('toast:show', {text: '요보호 질환명 또는 미세먼지 기저질환명을 입력하세요'});return;}
  const addMode=_apCareMode==='add';
  const result=await _persistCare(s,{care_reason:reason,dust_disease:dust,care_memo:memo});
  if(!result.success){_careSaveNotice(result.error,true);return result;}
  _careSaveNotice('요보호 / 미세먼지 기저질환이 저장되었습니다.');
  _careRefreshSaved();
  /* 개별 등록(add) 완료 안내 모달 (사용자 요청 2026-06-02) */
  if(addMode){
    _apConfirm({ title:'🛡 등록 완료', message:'<b style="color:var(--t1)">'+escHtml(s.name)+'</b> 학생을 요보호 / 미세먼지 기저질환으로 등록했습니다.', confirmText:'확인', noCancel:true });
  }
  return result;
}
/* 요보호 명단 화면(인라인 표·명단 팝업·수정 선택 모달)을 현재 S.people 기준으로 즉시 재렌더 */
function _apCareRefreshLists(){
  if(document.getElementById('apCareInline')&&typeof _apCareInlineRender==='function')_apCareInlineRender();
  if(document.getElementById('apCareListPopup')&&typeof _apCareListPopup==='function')_apCareListPopup();
  if(document.getElementById('apCareEditListOverlay')&&typeof _apCareRenderEditList==='function')_apCareRenderEditList();
  if(document.getElementById('apCareUnmatched')&&typeof _apCareRenderUnmatched==='function')_apCareRenderUnmatched();
}
/* 프로그램 표준 확인 모달 (네이티브 confirm 대체) — 시안+보라 헤더 그라데이션, 열기/닫기 애니메이션. */
function _apConfirm(opts){
  opts=opts||{};
  const id='_apConfirmOverlay';
  const old=document.getElementById(id); if(old&&old.parentNode)old.parentNode.removeChild(old);
  const ov=document.createElement('div'); ov.id=id;
  ov.style.cssText='position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.32);opacity:0;transition:opacity 0.15s ease';
  const danger=!!opts.danger;
  const confirmBg=danger?'linear-gradient(135deg,#ef4444,#dc2626)':'var(--cyan)';
  ov.innerHTML='<div id="_apConfirmBox" style="background:var(--card);border-radius:14px;width:420px;max-width:92vw;box-shadow:0 14px 40px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.18s ease,transform 0.18s ease">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));font-size:15px;font-weight:800;color:var(--t1)">'+escHtml(opts.title||'확인')+'</div>'
    +'<div style="padding:18px 22px 14px"><div style="font-size:12.5px;color:var(--t2);line-height:1.7">'+(opts.message||'')+'</div>'
    +'<div style="height:1px;background:var(--bdr);margin:16px -22px 14px"></div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end">'
    +(opts.noCancel?'':'<button id="_apConfirmNo" type="button" style="padding:8px 16px;font-size:12px;font-weight:700;border-radius:8px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">'+escHtml(opts.cancelText||'취소')+'</button>')
    +'<button id="_apConfirmYes" type="button" style="padding:8px 18px;font-size:12px;font-weight:700;border-radius:8px;border:none;background:'+confirmBg+';color:#fff;cursor:pointer;font-family:var(--f)">'+escHtml(opts.confirmText||'확인')+'</button>'
    +'</div></div></div>';
  document.body.appendChild(ov);
  const box=ov.querySelector('#_apConfirmBox');
  requestAnimationFrame(function(){ ov.style.opacity='1'; if(box){box.style.opacity='1';box.style.transform='scale(1)';} });
  function close(cb){
    ov.style.opacity='0'; if(box){box.style.opacity='0';box.style.transform='scale(0.96)';}
    document.removeEventListener('keydown',onKey,true);
    setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); if(typeof cb==='function')cb(); },180);
  }
  function onKey(e){ if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();} else if(e.key==='Enter'){e.preventDefault();close(opts.onConfirm);} }
  document.addEventListener('keydown',onKey,true);
  ov.addEventListener('mousedown',function(e){ if(e.target===ov) close(); });
  const _noBtn=ov.querySelector('#_apConfirmNo'); if(_noBtn)_noBtn.addEventListener('click',function(){ close(); });
  ov.querySelector('#_apConfirmYes').addEventListener('click',function(){ close(opts.onConfirm); });
}
function _apCareDelete(id){
  const s=getStu(id);if(!s)return;
  _apConfirm({
    title:'🛡 요보호 / 미세먼지 기저질환 해제',
    message:'<b style="color:var(--t1)">'+escHtml(s.name)+'</b> 학생의 요보호 / 미세먼지 기저질환 등록을 해제하시겠습니까?<br><span style="font-size:11px;color:var(--t3)">해제하면 아래 명단에서 제외됩니다.</span>',
    confirmText:'해제', cancelText:'취소', danger:true,
    onConfirm:function(){ _apCareDeleteConfirmed(id); }
  });
}
async function _apCareDeleteConfirmed(id){
  const s=getStu(id);if(!s)return;
  const result=await _persistCare(s,{_clearCare:true});
  if(!result.success){_careSaveNotice(result.error,true);return result;}
  bus.emit('toast:show', {text: s.name+' 요보호 / 미세먼지 기저질환 해제 완료'});
  bus.emit('render:daily');
  bus.emit('render:dashboard');
  /* 해제 후 편집 폼을 초기 안내로 되돌리고 아래 명단 즉시 반영 */
  const _cbody=document.getElementById('apCareBody');
  if(_cbody&&_cbody.dataset.careStudentId===String(id))_cbody.innerHTML='<div style="padding:16px;border:1px dashed var(--bdr);border-radius:10px;background:var(--bg2);text-align:center;font-size:11px;color:var(--t3)">해제되었습니다. 아래 명단에서 다른 학생을 선택하세요.</div>';
  _apCareRefreshLists();
  return result;
}
/* ── 요보호 개별 등록: 학년 필터 → 학생 목록 ── */
function _apCareFilterGrade(grade){
  const list=document.getElementById('apCareIndivList');if(!list)return;
  const _k=isKinder();
  const sts=S.people.filter(function(s){
    if(s.type!=='student'||!s.grade)return false;
    return grade===0||s.grade===grade;
  });
  sts.sort(function(a,b){if(a.grade!==b.grade)return a.grade-b.grade;var _c=compareClass(a.cls,b.cls);if(_c)return _c;return(a.num||0)-(b.num||0);});
  let h='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
  sts.forEach(function(s){
    const isCare=(s.status==='caution'||s.status==='watch'||Number(s.is_care)===1);
    const hasDust=!!(s.dust_disease);
    const chipColor=isCare?'var(--yl)':hasDust?'#60a5fa':'var(--bdr)';
    let tag=isCare?' <span style="font-size:8px;color:var(--yl)">요보호</span>':'';
    tag+=hasDust?' <span style="font-size:8px;color:#60a5fa">미세먼지</span>':'';
    h+='<span data-action="_apCarePickStudent" data-arg="'+s.id+'" data-hover="chip" data-hover-restore="'+chipColor+'" data-hover-bg-restore="var(--card)" style="padding:5px 10px;border:1px solid '+chipColor+';border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t1);background:var(--card);transition:all .15s">'
      +(_k?('만'+s.grade+'세 '):(s.grade+'-'+s.cls+' '))+s.num+'번 '+escHtml(s.name)+tag+'</span>';
  });
  h+='</div>';
  list.innerHTML=h;
}
/* ══════════ 학생 등록·수정 폼 — 캐스케이드 드롭다운 헬퍼 ══════════
 * 학교급 → 학과 → 학년 → 반 순으로 좁혀지는 드롭다운.
 * 옵션은 S.people 학생 데이터에서 distinct 추출 — 신규 학교급/학과/학년/반은 일괄 업로드 후에만 가능.
 * 등록 모드 (initial=null): 모든 드롭다운 빈 상태에서 시작
 * 수정 모드 (initial={level,dept,grade,cls,num,...}): 해당 학생 값으로 prefill, 번호는 readonly
 */
/* 학교급 표준 옵션 — 단일 한글 글자 5종 (유·초·중·고·대). 특수학교는 표시·등록 정책상 표준에서 제외. */
const _STU_STD_LEVELS=['유','초','중','고','대'];
const _STU_STD_GRADES={
  '유':[3,4,5],
  '초':[1,2,3,4,5,6],
  '중':[1,2,3],
  '고':[1,2,3],
  '대':[1,2,3,4],
};
/* 영문 키 → 단일 한글 키 매핑. 옛 데이터(school_level='elementary' 등) 와 한글 표준 옵션이
 *  같은 학교급으로 인식되도록 정규화에 사용한다. */
const _LEVEL_TO_KO={
  kindergarten:'유',
  elementary:'초',
  middle:'중',
  high:'고',
  university:'대',
  special:'특',
};
function _normLv(lv){return _LEVEL_TO_KO[lv]||lv||'';}

function _apStuLevels(){
  /* 사용자 결정 2026-05-31: 표준 5종 자동 노출 폐지. 등록된 학생의 학교급만 옵션으로 노출.
   *  · 고등학교 인원만 일괄 등록 → 옵션 = "고등학교" 1개
   *  · 특수학교(유·초·중·고 다) → 4개
   *  · 병설유치원 있는 초등학교 → 유치원·초등학교 2개
   *  데이터 0건일 때만 S.settings.schoolLevel 을 1개 fallback 으로 노출(완전 빈 select 방지). */
  const set={};
  S.people.forEach(function(s){if(s.type==='student'&&s.level){set[_normLv(s.level)]=true;}});
  if(Object.keys(set).length===0){
    const sl=S.settings && S.settings.schoolLevel;
    if(sl) set[_normLv(sl)]=true;
  }
  /* 표준 순서대로(유→초→중→고→대) 정렬, 표준 외(예: '특')는 뒤에 가나다순. */
  const std=_STU_STD_LEVELS.filter(function(lv){return set[lv];});
  const extra=Object.keys(set).filter(function(lv){return _STU_STD_LEVELS.indexOf(lv)===-1;}).sort();
  return std.concat(extra);
}
function _apStuDepts(level){
  const set={};
  const lvN=_normLv(level);
  S.people.forEach(function(s){
    if(s.type!=='student')return;
    if(level!=null && _normLv(s.level||'')!==lvN)return;
    set[s.department||'']=true;
  });
  return Object.keys(set).sort();
}
function _apStuGrades(level, dept){
  const set={};
  const lvN=_normLv(level);
  /* 1) 학교급별 표준 학년 */
  if(lvN && _STU_STD_GRADES[lvN]){
    _STU_STD_GRADES[lvN].forEach(function(g){set[String(g)]=true;});
  }
  /* 2) 기존 학생 데이터의 distinct 학년 (학교급 영문↔한글 정규화 비교) */
  S.people.forEach(function(s){
    if(s.type!=='student'||!s.grade)return;
    if(level!=null && _normLv(s.level||'')!==lvN)return;
    if(dept!=null && (s.department||'')!==dept)return;
    set[String(s.grade)]=true;
  });
  return Object.keys(set).map(Number).sort(function(a,b){return a-b;});
}
function _apStuClasses(level, dept, grade){
  const set={};
  const lvN=_normLv(level);
  /* 표준 1~15반 (학교급+학년 선택 시) */
  if(lvN && grade){
    for(let c=1;c<=15;c++) set[String(c)]=true;
  }
  /* 기존 학생 데이터의 distinct 반 */
  S.people.forEach(function(s){
    if(s.type!=='student'||!s.cls)return;
    if(level!=null && _normLv(s.level||'')!==lvN)return;
    if(dept!=null && (s.department||'')!==dept)return;
    if(grade!=null && Number(s.grade)!==Number(grade))return;
    set[String(s.cls)]=true;
  });
  /* 한글 학급명(가람·나래) 지원 — Number 변환 시 NaN 으로 손실되던 것을 compareClass 정렬로 보존 (사용자 요청 2026-05-28). */
  return Object.keys(set).sort(compareClass);
}
function _apStuLevelLabel(lv){
  /* 사용자 결정 2026-05-31: 풀네임으로 통일. "~등"으로 끝나는 약식 라벨 폐기. */
  const m={
    kindergarten:'유치원','유':'유치원',
    elementary:'초등학교','초':'초등학교',
    middle:'중학교','중':'중학교',
    high:'고등학교','고':'고등학교',
    university:'대학교','대':'대학교',
    special:'특수학교','특':'특수학교'
  };
  return m[lv]||lv||'(미지정)';
}
function _apStuFormCascadeHtml(initial){
  /* initial: null 이면 등록 모드, 객체면 수정 모드 */
  const isEdit=!!initial;
  let initLevel=isEdit?(initial.level||''):'';
  /* 신규 등록 시 실제 학생이 있는 학교급이 1종뿐이면 자동 선택 → 학과·학년이 바로 채워짐.
   * (학과가 있는 단일 학교급 학교에서 초기 학교급 미선택이라 "학과 없음"으로 뜨던 문제 해결) */
  if(!isEdit && !initLevel){
    const _ul={};
    S.people.forEach(function(s){ if(s.type==='student'&&s.level) _ul[_normLv(s.level)]=true; });
    const _ulKeys=Object.keys(_ul);
    if(_ulKeys.length===1) initLevel=_ulKeys[0];
  }
  const initDept=isEdit?(initial.department||''):'';
  const initGrade=isEdit?String(initial.grade||''):'';
  const initCls=isEdit?String(initial.cls||''):'';

  const levels=_apStuLevels();
  const depts=_apStuDepts(initLevel);
  const grades=_apStuGrades(initLevel||null, initDept||null);
  const classes=_apStuClasses(initLevel||null, initDept||null, initGrade||null);
  /* 학과가 1개 이상(빈 문자열 제외)이면 활성, 아니면 disabled */
  const hasDept=depts.some(function(d){return d!=='';});

  function _opt(val, label, selected){
    const sel=String(val)===String(selected||'')?' selected':'';
    return '<option value="'+escHtml(String(val))+'"'+sel+'>'+escHtml(String(label))+'</option>';
  }

  let h='';
  /* 학교급 + 학과 */
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">';
  h+='<select class="form-input ap-cascade" id="apLevel" data-cascade="level" data-ap-order="0" style="font-size:11px">';
  h+=_opt('','학교급','');
  levels.forEach(function(lv){h+=_opt(lv,_apStuLevelLabel(lv),initLevel);});
  h+='</select>';
  h+='<select class="form-input ap-cascade" id="apDept" data-cascade="dept" data-ap-order="1" style="font-size:11px"'+(hasDept?'':' disabled')+'>';
  h+=_opt('',hasDept?'학과':'(학과 없음)','');
  depts.forEach(function(d){if(d)h+=_opt(d,d,initDept);});
  h+='</select>';
  h+='</div>';
  /* 학년 + 반 */
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">';
  h+='<select class="form-input ap-cascade" id="apGrade" data-cascade="grade" data-ap-order="2" style="font-size:11px">';
  h+=_opt('','학년','');
  grades.forEach(function(g){h+=_opt(g,String(g),initGrade);});
  h+='</select>';
  /* 반 — 학년·성별과 동일한 select 드롭다운으로 통일 (사용자 요청 2026-05-28: datalist 자동완성 박스가 select 와 GUI 가 달라서).
   *  기존 명단에 등록된 반(숫자·한글)은 모두 옵션으로 노출. 새 반은 일괄 업로드로 추가. */
  h+='<select class="form-input ap-cascade" id="apClass" data-cascade="cls" data-ap-order="3" style="font-size:11px">';
  h+=_opt('','반','');
  classes.forEach(function(c){h+=_opt(c,String(c),initCls);});
  h+='</select>';
  h+='</div>';
  return h;
}
function _apStuFormBindCascade(rootId, initial){
  const root=document.getElementById(rootId);
  if(!root)return;
  function _rebuild(){
    const lv=(root.querySelector('#apLevel')||{}).value||'';
    const dept=(root.querySelector('#apDept')||{}).value||'';
    const grade=(root.querySelector('#apGrade')||{}).value||'';

    /* 학과 재구성 — 학교급에 따라 */
    const deptSel=root.querySelector('#apDept');
    if(deptSel){
      const depts=_apStuDepts(lv||null);
      const hasDept=depts.some(function(d){return d!=='';});
      const cur=deptSel.value;
      deptSel.innerHTML='<option value="">'+(hasDept?'학과':'(학과 없음)')+'</option>'+
        depts.filter(function(d){return d;}).map(function(d){return '<option value="'+escHtml(d)+'"'+(d===cur?' selected':'')+'>'+escHtml(d)+'</option>';}).join('');
      deptSel.disabled=!hasDept;
      if(!hasDept) deptSel.value='';
    }
    /* 학년 재구성 */
    const gradeSel=root.querySelector('#apGrade');
    if(gradeSel){
      const grades=_apStuGrades(lv||null, dept||null);
      const cur=gradeSel.value;
      gradeSel.innerHTML='<option value="">학년</option>'+
        grades.map(function(g){return '<option value="'+g+'"'+(String(g)===cur?' selected':'')+'>'+g+'</option>';}).join('');
    }
    /* 반 select 재구성 — 학교급/학과/학년에 맞는 반 옵션 갱신 (선택값 보존). */
    const clsSel=root.querySelector('#apClass');
    if(clsSel){
      const newGrade=(root.querySelector('#apGrade')||{}).value||'';
      const classes=_apStuClasses(lv||null, dept||null, newGrade||null);
      const cur=clsSel.value;
      clsSel.innerHTML='<option value="">반</option>'+
        classes.map(function(c){return '<option value="'+escHtml(String(c))+'"'+(String(c)===cur?' selected':'')+'>'+escHtml(String(c))+'</option>';}).join('');
    }
  }
  root.addEventListener('change', function(e){
    const tgt=e.target;
    if(!tgt||!tgt.classList||!tgt.classList.contains('ap-cascade'))return;
    _rebuild();
  });
}

/* ── 학생 등록/변경 서브패널 ── */
/* ── 인원 데이터 DB 작업 진단 모달 — 키오스크 오류 진단과 동형(상세 정보 + 클립보드 복사). 사용자 요청 2026-06-18.
 *  DB 삭제·등록 등이 안 될 때 원인 추적용. 복사해 오렌지팜에 보내면 버전·IPC 유무·사유가 한눈에 보인다. */
function _pmErrFallbackCopy(t){ try{ var ta=document.createElement('textarea'); ta.value=t; ta.style.cssText='position:fixed;opacity:0;left:-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); return true; }catch(_){ return false; } }
function _pmBuildDiag(o){
  o = o || {};
  var ua = navigator.userAgent || '';
  var verM = ua.match(/my-health-diary\/([\d.]+)/);
  var fnLine = (o.fnName!=null) ? ('해당 IPC(' + o.fnName + '): ' + ((window.electronAPI && window.electronAPI[o.fnName]) ? '있음' : '없음 → 구버전(앱 업데이트 필요)')) : '';
  return [
    '[인원 데이터 ' + (o.kind || '오류') + ' 정보]',
    '시각: ' + new Date().toISOString(),
    '작업: ' + (o.op || '(미상)'),
    '사유: ' + (o.error || '알 수 없는 오류'),
    fnLine,
    'electronAPI: ' + (window.electronAPI ? '있음' : '없음'),
    '학년도: ' + (o.year != null ? o.year : '(미상)'),
    '앱버전: ' + (verM ? verM[1] : '(UA에서 못 읽음)'),
    '학교: ' + ((S.settings && S.settings.schoolName) || '(미설정)'),
    '플랫폼: ' + (navigator.platform || '') + ' / ' + ua
  ].filter(function(x){ return x !== ''; }).join('\n');
}
function _pmShowDiagModal(title, msgHtml, diagText){
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:50001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
  ov.innerHTML = '<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:480px;max-width:94vw;max-height:88vh;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden;display:flex;flex-direction:column">'
    + '<div style="padding:12px 18px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(124,58,237,0.06));border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1);flex-shrink:0">' + title + '</div>'
    + '<div style="padding:16px 18px 8px;font-size:12.5px;color:var(--t1);line-height:1.7;flex-shrink:0">' + msgHtml + '</div>'
    + '<div style="margin:0 18px 12px;padding:10px 12px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;font-family:var(--fm,monospace);font-size:10.5px;color:var(--t2);line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow-y:auto;flex:1 1 auto;min-height:0">' + escHtml(diagText) + '</div>'
    + '<div style="display:flex;gap:6px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);flex-shrink:0">'
    +   '<button data-act="copy" style="padding:7px 16px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--cyan);background:rgba(6,182,212,0.10);color:#0891b2;cursor:pointer;font-family:var(--f)">📋 오류 정보 복사</button>'
    +   '<button data-act="ok" style="padding:7px 16px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">확인</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  var onKey;
  var close = function(){ try{document.removeEventListener('keydown',onKey,true);}catch(_){} ov.remove(); };
  ov.querySelector('[data-act="ok"]').addEventListener('click', close);
  ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
  ov.querySelector('[data-act="copy"]').addEventListener('click', function(){
    var ok = function(){ bus.emit('toast:show',{text:'✅ 오류 정보가 복사되었습니다. 오렌지팜에 붙여넣기(Ctrl+V)로 보내주세요.'}); };
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(diagText).then(ok, function(){ _pmErrFallbackCopy(diagText); ok(); }); } else { _pmErrFallbackCopy(diagText); ok(); } }catch(_){ _pmErrFallbackCopy(diagText); ok(); }
  });
  onKey = function(e){ if(e.key==='Escape'){ e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
}

/* 이번 학년도 전체 일괄 삭제 (학생) — soft-delete. 보건일지·증상·처치 기록은 보존(고아 안 됨). 2026-06-12 */
function _apStuDeleteAll(){
  const yr = (typeof _academicYear==='function')?_academicYear():new Date().getFullYear();
  appConfirmModal(
    '<b>'+yr+'학년도 학생 전체 명단</b>을 삭제할까요?<br><span style="color:var(--t3);font-size:11px;font-weight:500">명단에서만 비워지며, 보건일지·증상·처치 기록은 그대로 보존됩니다. 명단이 잘못 올라갔을 때 초기화용으로 쓰세요.</span>',
    yr+'학년도 학생 전체 삭제',
    { okLabel:'전체 삭제', cancelLabel:'취소' }
  ).then(function(ok){
    if(!ok) return;
    if(!(window.electronAPI && window.electronAPI.studentsDeleteAllYear)){
      _pmShowDiagModal('⚠️ 학생 전체 삭제 실패',
        '삭제 기능을 사용할 수 없습니다. 현재 설치된 버전에 <b>일괄 삭제 기능이 없는 것으로 보입니다(구버전)</b>.<br><b>오렌지톡을 최신 버전으로 업데이트</b>한 뒤 다시 시도해 주세요.<br>그래도 안 되면 아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주세요.',
        _pmBuildDiag({ kind:'일괄삭제 오류', op:'학생 전체 일괄 삭제', error:'studentsDeleteAllYear IPC 미연결(구버전 추정)', fnName:'studentsDeleteAllYear', year:yr }));
      return;
    }
    window.electronAPI.studentsDeleteAllYear(yr).then(function(res){
      if(res && res.success!==false){
        bus.emit('toast:show',{ text:(res.count!=null?res.count+'명 ':'')+'학생 명단을 비웠습니다. (기록은 보존)' });
        /* 명단을 비웠으므로 '확인이 필요한 미매칭 학생' 보관함도 함께 비움 — 대상 명단 자체가 사라져 무의미 (사용자 요청 2026-06-12) */
        try{ _stuUnmatchedSet([]); }catch(_){}
        try{ localStorage.removeItem('ec_student_pending_upload_'+String(yr)); }catch(_){}
        const reloadFn=(typeof _reloadStudentsFromDB==='function')?_reloadStudentsFromDB():Promise.resolve();
        reloadFn.then(function(){ _apRenderPanel('student'); bus.emit('render:daily'); bus.emit('render:dashboard'); });
      } else {
        _pmShowDiagModal('⚠️ 학생 전체 삭제 실패',
          '삭제가 완료되지 않았습니다.<br>아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주시면 원인 추적이 빠릅니다.',
          _pmBuildDiag({ kind:'일괄삭제 오류', op:'학생 전체 일괄 삭제', error:(res&&res.error)||'(원인 불명 — success=false)', fnName:'studentsDeleteAllYear', year:yr }));
      }
    }).catch(function(e){
      _pmShowDiagModal('⚠️ 학생 전체 삭제 오류',
        '삭제 중 오류가 발생했습니다.<br>아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주세요.',
        _pmBuildDiag({ kind:'일괄삭제 예외', op:'학생 전체 일괄 삭제', error:(e&&e.message)||String(e), fnName:'studentsDeleteAllYear', year:yr }));
    });
  });
}

/* 이번 학년도 전체 일괄 삭제 (교직원) — soft-delete. 2026-06-12 */
function _apStaffDeleteAll(){
  const yr = (typeof _academicYear==='function')?_academicYear():new Date().getFullYear();
  appConfirmModal(
    '<b>'+yr+'학년도 교직원 전체 명단</b>을 삭제할까요?<br><span style="color:var(--t3);font-size:11px;font-weight:500">명단에서만 비워지며, 보건일지·기록은 그대로 보존됩니다.</span>',
    yr+'학년도 교직원 전체 삭제',
    { okLabel:'전체 삭제', cancelLabel:'취소' }
  ).then(function(ok){
    if(!ok) return;
    if(!(window.electronAPI && window.electronAPI.staffDeleteAllYear)){
      _pmShowDiagModal('⚠️ 교직원 전체 삭제 실패',
        '삭제 기능을 사용할 수 없습니다. 현재 설치된 버전에 <b>일괄 삭제 기능이 없는 것으로 보입니다(구버전)</b>.<br><b>오렌지톡을 최신 버전으로 업데이트</b>한 뒤 다시 시도해 주세요.<br>그래도 안 되면 아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주세요.',
        _pmBuildDiag({ kind:'일괄삭제 오류', op:'교직원 전체 일괄 삭제', error:'staffDeleteAllYear IPC 미연결(구버전 추정)', fnName:'staffDeleteAllYear', year:yr }));
      return;
    }
    window.electronAPI.staffDeleteAllYear(yr).then(function(res){
      if(res && res.success!==false){
        bus.emit('toast:show',{ text:(res.count!=null?res.count+'명 ':'')+'교직원 명단을 비웠습니다. (기록은 보존)' });
        /* 메모리(S.people) 재로딩 후 패널 재렌더 — 학생 삭제 경로와 동일. 빠뜨리면 DB는 비었는데
         * 전체 명단·검색 자동완성에 교직원이 그대로 남는 버그 (사용자 보고 2026-06-12) */
        const reloadFn=(typeof _reloadStudentsFromDB==='function')?_reloadStudentsFromDB():Promise.resolve();
        reloadFn.then(function(){ _apRenderPanel('staff'); bus.emit('render:daily'); bus.emit('render:dashboard'); });
      } else {
        _pmShowDiagModal('⚠️ 교직원 전체 삭제 실패',
          '삭제가 완료되지 않았습니다.<br>아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주시면 원인 추적이 빠릅니다.',
          _pmBuildDiag({ kind:'일괄삭제 오류', op:'교직원 전체 일괄 삭제', error:(res&&res.error)||'(원인 불명 — success=false)', fnName:'staffDeleteAllYear', year:yr }));
      }
    }).catch(function(e){
      _pmShowDiagModal('⚠️ 교직원 전체 삭제 오류',
        '삭제 중 오류가 발생했습니다.<br>아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주세요.',
        _pmBuildDiag({ kind:'일괄삭제 예외', op:'교직원 전체 일괄 삭제', error:(e&&e.message)||String(e), fnName:'staffDeleteAllYear', year:yr }));
    });
  });
}

/* 학생 등록/변경 필수 입력 안내 — 명단에 들어간 데이터에 따라 동적 (사용자 요청 2026-06-14).
 *  · 학교급이 여러 개면 '학교급' 포함, 학과가 등록돼 있으면 '학과' 포함.
 *  · 항상: 학년, 반, 번호, 이름, 성별. (마지막이 '성별'이라 조사 '은' 고정) */
function _apRequiredFieldsNotice(){
  const fields=[];
  try{ if(hasMultipleSchoolLevels())fields.push('학교급'); }catch(_){}
  try{ if(hasAnyDepartment())fields.push('학과'); }catch(_){}
  fields.push('학년','반','번호','이름','성별');
  return '<div style="font-size:11px;color:var(--t2);font-weight:600;margin-bottom:10px;line-height:1.6">'
    +escHtml(fields.join(', '))+'은 필수적으로 기입해야 합니다.</div>';
}
function _apStuAction(mode){
  _apActivePanel='student';
  const body=document.getElementById('apStuBody');if(!body)return;
  const backBtn='<div style="margin-bottom:10px"><span data-action="_apBack" data-arg="student" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← 뒤로</span></div>';
  if(mode==='bulk'){_apStuBulk();return;}
  if(mode==='deleteAll'){_apStuDeleteAll();return;}
  if(mode==='add'){
    body.innerHTML=backBtn+'<div id="apStuAddRoot">'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:6px;line-height:1.6">학교급은 <b>기존 등록된 인원의 학교급</b>만 옵션으로 노출됩니다. (예: 특수학교 → 유치원·초등학교·중학교·고등학교, 병설유치원 있는 초등학교 → 유치원·초등학교) 학년·반은 학교급별 표준 범위 + 기존 명단에서 자동 노출.<br>학과는 기존 명단에 학과가 등록된 학교급에서만 활성화 — 새 학과는 일괄 업로드로 추가하세요.</div>'
      +_apRequiredFieldsNotice()
      +_apStuFormCascadeHtml(null)
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px"><input class="form-input ap-nav-field" data-ap-order="4" id="apNumber" placeholder="번호 (숫자만. 예: 24)" style="font-size:11px"><input class="form-input ap-nav-field" data-ap-order="5" id="apName" placeholder="이름 (예. 김샛별)" style="font-size:11px"></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px"><select class="form-input" id="apGender" data-ap-order="6" style="font-size:11px"><option value="">성별</option><option value="남">남</option><option value="여">여</option></select><input class="form-input ap-nav-field pm-oninput" data-input-handler="apBirthFormat" data-ap-order="7" id="apBirth" placeholder="생년월일 (예: 2012.03.15.)" style="font-size:11px" maxlength="11"></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px"><input class="form-input ap-nav-field" data-ap-order="8" id="apGuardianType" placeholder="주 보호자 (예: 모)" style="font-size:11px"><input class="form-input ap-nav-field" data-ap-order="9" id="apGuardianContact" placeholder="보호자 연락처" style="font-size:11px"></div>'
      +'<button class="btn btn-primary btn-sm" data-action="addPerson" style="width:100%">추가</button></div>';
    _apStuFormBindCascade('apStuAddRoot', null);
    _apScrollToTop('apStuLeaveWarn'); /* 입력폼이 바로 보이도록 경고문구를 맨 위로 (사용자 요청 2026-06-08) */
  } else {
    /* 편집·삭제 — 학년/반/학생 단계별 드릴다운 대신 통합 상세 검색 팝업(openPersonSearch) 사용 */
    body.innerHTML = backBtn
      + '<div style="padding:16px;border:1px dashed var(--bdr);border-radius:10px;background:var(--bg2);text-align:center">'
      + '<div style="font-size:11px;color:var(--t2);margin-bottom:8px">🔎 편집하거나 삭제할 학생을 검색하세요</div>'
      + '<button class="btn btn-primary btn-sm" data-action="_apStuOpenSearch" style="padding:8px 18px">학생 선택</button>'
      + '<div style="font-size:10px;color:var(--t3);margin-top:8px;line-height:1.6">학교급·학과·학년별로 필터링하고 학생 카드를 클릭하면 정보 수정·삭제 화면으로 이동합니다.</div>'
      + '</div>';
    /* 자동으로 팝업 열기 — 즉시 상세 검색 노출 */
    setTimeout(function(){ _apStuOpenSearch(); }, 100);
  }
  _pmBindUpload(body);
}
/* openPersonSearch 로 학생 선택 — 선택 시 _apStuEditPick 호출 */
function _apStuOpenSearch(){
  openPersonSearch({
    title: '🔎 편집·삭제할 학생 선택',
    type: 'student', allowStaff: false,
    overlayId: 'apStuSearchOverlay', closeOnPick: true,
    onPick: function(id){ _apStuEditPick(id); }
  });
}
function _apStuEditGrade(grade){
  const body=document.getElementById('apStuBody');if(!body)return;
  body.innerHTML=_apClassDiagram(grade,'_apStuEditClass','학년 선택','_apStuAction(\'edit\')');
}
function _apStuEditClass(grade,cls){
  const body=document.getElementById('apStuBody');if(!body)return;
  const sts=S.people.filter(function(s){return s.type==='student'&&String(s.grade)===String(grade)&&String(s.cls)===String(cls);}).sort(function(a,b){return Number(a.num)-Number(b.num);});
  let h='<div style="margin-bottom:10px"><span data-action="_apStuEditGrade" data-arg="'+grade+'" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← '+grade+'학년 반 목록</span></div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+grade+'학년 '+cls+'반 — 학생을 선택하세요</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  sts.forEach(function(s){
    h+='<span data-action="_apStuEditPick" data-arg="'+s.id+'" data-hover="chip" style="padding:6px 12px;border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t1);background:var(--card);transition:all .15s">'
      +s.num+'번 '+s.name+'</span>';
  });
  body.innerHTML=h+'</div>';
}
function _apStuEditPick(id){
  const s=getStu(id);if(!s)return;
  const body=document.getElementById('apStuBody');if(!body)return;
  /* 유치원: 학년 → "N세", 반은 자체 이름(꽃반 등)이므로 "반" 자동 추가 X */
  const _isKinder=(s.level==='kindergarten'||s.level==='유')||(S.settings.schoolLevel==='kindergarten'&&!s.level);
  const _gradeLabel=_isKinder?((s.grade||'')+'세'):((s.grade||'')+'학년');
  const _classLabel=_isKinder?(s.cls||''):((s.cls||'')+'반');
  /* 학교급(여러 학교급일 때만) + 학과(있으면) 접두 — 선택 학생 식별이 명확하도록 (사용자 요청 2026-06-24) */
  const _multiLv=(typeof hasMultipleSchoolLevels==='function')?hasMultipleSchoolLevels():false;
  const _lvShort=_multiLv?(getLevelShort(s)||''):'';
  const _deptStr=String(s.department||'').trim();
  const _pfx=(_lvShort?_lvShort+' ':'')+(_deptStr?_deptStr+' ':'');

  let h='<div style="margin-bottom:10px"><span data-action="_apStuEditClass" data-arg="'+s.grade+'" data-arg2="'+s.cls+'" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← '+_pfx+_gradeLabel+' '+_classLabel+' 학생 목록</span></div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+_pfx+_gradeLabel+' '+_classLabel+' '+s.num+'번 '+s.name+' 정보 수정</div>';
  h+='<div id="apStuEditRoot">';
  /* 캐스케이드 (학교급/학과/학년/반) — 기존 값으로 prefill, 변경 시 옵션 재구성 */
  h+=_apStuFormCascadeHtml({level:s.level||'',department:s.department||'',grade:s.grade||'',cls:s.cls||''});
  /* 번호 + 이름 (번호도 수정 가능 — 사용자 요청 2026-06-07: 학교급 외 전부 수정 가능) */
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">'
    +'<input class="form-input" id="apEditNum" placeholder="번호 (숫자만)" value="'+(s.num||'')+'" style="font-size:11px">'
    +'<input class="form-input" id="apEditName" placeholder="이름" value="'+escHtml(s.name||'')+'" style="font-size:11px"></div>';
  /* 성별 + 생년월일 */
  const _gM=s.gender==='남'?' selected':'';
  const _gF=s.gender==='여'?' selected':'';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">'
    +'<select class="form-input" id="apEditGender" style="font-size:11px"><option value="">성별</option><option value="남"'+_gM+'>남</option><option value="여"'+_gF+'>여</option></select>'
    +'<input class="form-input pm-oninput" data-input-handler="apBirthFormat" id="apEditBirth" placeholder="생년월일 (예: 2012.03.15.)" value="'+escHtml(s.birth||'')+'" style="font-size:11px" maxlength="11"></div>';
  /* 보호자 */
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">'
    +'<input class="form-input" id="apEditGuardianType" placeholder="주 보호자 (예: 모)" value="'+escHtml(s.guardianType||'')+'" style="font-size:11px">'
    +'<input class="form-input" id="apEditGuardianContact" placeholder="보호자 연락처" value="'+escHtml(s.guardianContact||'')+'" style="font-size:11px"></div>';
  h+='</div>';
  h+='<div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-primary btn-sm" data-action="_apStuEditSave" data-arg="'+id+'" style="flex:1">수정 저장</button>'
    +'<button class="btn btn-sm" data-action="_apStuDelete" data-arg="'+id+'" style="padding:6px 14px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.45);color:#ef4444;font-weight:700;border-radius:6px;cursor:pointer">🗑 삭제</button></div>';
  body.innerHTML=h;
  _apStuFormBindCascade('apStuEditRoot', {level:s.level||'',department:s.department||'',grade:s.grade||'',cls:s.cls||''});
  _pmBindUpload(body);
  _apScrollToTop('apStuLeaveWarn'); /* 수정/삭제 대상 특정 후 입력폼·버튼이 바로 보이도록 (사용자 요청 2026-06-08) */
}
function _apStuEditSave(id){
  const s=getStu(id);if(!s){bus.emit('toast:show', {text: '학생 정보를 찾을 수 없습니다'});return;}
  const nm=document.getElementById('apEditName');
  if(!nm||!nm.value.trim()){bus.emit('toast:show', {text: '이름을 입력하세요'});return;}
  /* 캐스케이드 드롭다운에서 학교급/학과/학년/반 읽기 — 번호는 잠금이라 기존 값 유지 */
  const lv=(document.getElementById('apLevel')||{}).value;
  const dep=(document.getElementById('apDept')||{}).value;
  const grd=(document.getElementById('apGrade')||{}).value;
  const cls=(document.getElementById('apClass')||{}).value;
  if(lv!=null) s.level=lv;
  if(dep!=null) s.department=dep;
  if(grd) s.grade=+grd||s.grade;
  /* 반: 한글 학급명(가람·나래) 지원 + 끝 '반' 접미사 제거 ("나래반"→"나래") (사용자 요청 2026-05-28). */
  if(cls!=null && String(cls).trim()!==''){ s.cls = normalizeClassInput(cls); }
  /* 번호 수정 반영 (숫자만) — 빈칸이면 기존 값 유지 */
  const _numEl=document.getElementById('apEditNum');
  if(_numEl){ const _nv=String(_numEl.value||'').trim(); s.num = _nv===''?s.num : (parseInt(_nv,10)||s.num); }
  s.name=nm.value.trim();
  const gen=document.getElementById('apEditGender');if(gen)s.gender=gen.value||s.gender||'';
  const b=document.getElementById('apEditBirth');if(b)s.birth=b.value.trim();
  const gt=document.getElementById('apEditGuardianType');if(gt)s.guardianType=gt.value.trim();
  const gc=document.getElementById('apEditGuardianContact');if(gc)s.guardianContact=gc.value.trim();
  /* DB 에 바로 반영 — saveData() 의 debounce 와 별도로 확실히 저장 */
  if(window.electronAPI&&window.electronAPI.studentsUpsert){
    /* ★ 요보호·기저질환·동의·VIP 보존 함께 전달 — 생략 시 학생 기본정보 수정만으로 지워짐 (사용자 보고 2026-07-23) */
    window.electronAPI.studentsUpsert(Object.assign({
      uid:s.uid||id,
      name:s.name,
      grade:s.grade,
      class_num:s.cls,
      student_num:s.num,
      gender:s.gender||'',
      birth_date:s.birth||'',
      guardian_type:s.guardianType||'',
      guardian_contact:s.guardianContact||'',
      level:s.level||'',
      department:s.department||'',
    }, _apPreserveCareConsent(s))).catch(function(err){console.error('[DB] student 저장 실패:',err);});
  }
  saveData();bus.emit('render:daily');bus.emit('render:dashboard');
  bus.emit('toast:show', {text: s.name+' 학생 정보가 변경되었습니다'});
  _apStuEditClass(s.grade,s.cls);
  if(document.getElementById('apStuInline'))_apStuInlineRender();
  if(document.getElementById('apCareInline'))_apCareInlineRender();
}
/* ── 교직원 등록/변경 ── */
function _apStaffAction(mode){
  _apActivePanel='staff';
  const body=document.getElementById('apStaffBody');if(!body)return;
  const backBtn='<div style="margin-bottom:10px"><span data-action="_apBack" data-arg="staff" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← 뒤로</span></div>';
  if(mode==='bulk'){_apStaffBulk();return;}
  if(mode==='deleteAll'){_apStaffDeleteAll();return;}
  if(mode==='add'){
    body.innerHTML=backBtn+'<div>'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.6">직위, 이름, 성별을 입력해주세요. 가족 관계, 가족 연락처는 필수 항목은 아닙니다.</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px"><input class="form-input" id="apPosition" placeholder="직위" style="font-size:11px"><input class="form-input" id="apStaffName" placeholder="이름 (예. 김샛별)" style="font-size:11px"></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px"><select class="form-input" id="apStaffGender" style="font-size:11px"><option value="">성별</option><option value="남">남</option><option value="여">여</option></select><input class="form-input" id="apStaffFamily" placeholder="가족 관계 (선택)" style="font-size:11px"><input class="form-input" id="apStaffFamilyPhone" placeholder="가족 연락처 (선택)" style="font-size:11px"></div>'
      +'<button class="btn btn-primary btn-sm" data-action="addPerson" style="width:100%">추가</button></div>';
    _apScrollToTop('apStaffBody'); /* 입력폼이 바로 보이도록 위로 스크롤 (사용자 요청 2026-06-08) */
  } else {
    /* 편집·삭제 — 학생과 동일하게 통합 상세 검색 팝업(openPersonSearch) 사용, 교직원만 노출(학생 제외). */
    body.innerHTML = backBtn
      + '<div style="padding:16px;border:1px dashed var(--bdr);border-radius:10px;background:var(--bg2);text-align:center">'
      + '<div style="font-size:11px;color:var(--t2);margin-bottom:8px">🔎 편집하거나 삭제할 교직원을 검색하세요</div>'
      + '<button class="btn btn-primary btn-sm" data-action="_apStaffOpenSearch" style="padding:8px 18px">교직원 선택</button>'
      + '<div style="font-size:10px;color:var(--t3);margin-top:8px;line-height:1.6">이름·초성으로 검색하고 교직원을 클릭하면 정보 수정·삭제 화면으로 이동합니다.</div>'
      + '</div>';
    /* 자동으로 팝업 열기 — 즉시 상세 검색 노출 (교직원만) */
    setTimeout(function(){ _apStaffOpenSearch(); }, 100);
  }
}
/* openPersonSearch 로 교직원 선택 — 학생 안 나오게 type:'staff' + allowStaff:false. 선택 시 _apStaffEditPick 호출 */
function _apStaffOpenSearch(){
  openPersonSearch({
    title: '🔎 편집·삭제할 교직원 선택',
    type: 'staff', allowStaff: false,
    overlayId: 'apStaffSearchOverlay', closeOnPick: true,
    onPick: function(id){ _apStaffEditPick(id); }
  });
}
function _apStaffEditPick(id){
  const s=getStu(id);if(!s)return;
  const body=document.getElementById('apStaffBody');if(!body)return;
  /* 폼 렌더링 — 일단 S.people 데이터로 */
  const _render=function(staff){
    let h='<div style="margin-bottom:10px"><span data-action="_apStaffAction" data-arg="edit" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← 교직원 목록</span></div>';
    h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+(staff.position||'교직원')+' '+staff.name+' 정보 수정</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px"><input class="form-input" id="apEditStaffPos" placeholder="직위" value="'+escHtml(staff.position||'')+'" style="font-size:11px"><input class="form-input" id="apEditStaffName" placeholder="이름" value="'+escHtml(staff.name||'')+'" style="font-size:11px"></div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px"><select class="form-input" id="apEditStaffGender" style="font-size:11px"><option value="">성별</option><option value="남"'+(staff.gender==='남'||staff.gender==='M'?' selected':'')+'>남</option><option value="여"'+(staff.gender==='여'||staff.gender==='F'?' selected':'')+'>여</option></select><input class="form-input" id="apEditStaffFamily" placeholder="가족 관계 (선택)" value="'+escHtml(staff.familyRelation||staff.familyContact||'')+'" style="font-size:11px"><input class="form-input" id="apEditStaffFamilyPhone" placeholder="가족 연락처 (선택)" value="'+escHtml(staff.familyPhone||'')+'" style="font-size:11px"></div>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-primary btn-sm" data-action="_apStaffEditSave" data-arg="'+id+'" style="flex:1">수정 저장</button>'
      +'<button class="btn btn-sm" data-action="_apStaffEditDelete" data-arg="'+id+'" style="padding:6px 14px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.45);color:#ef4444;font-weight:700;border-radius:6px;cursor:pointer">🗑 삭제</button></div>';
    body.innerHTML=h;
    _apScrollToTop('apStaffBody'); /* 수정/삭제 대상 특정 후 입력폼·버튼이 바로 보이도록 (사용자 요청 2026-06-08) */
  };
  _render(s);
  /* 백엔드에서 최신 데이터 fetch — 메모리 state 와 다를 수 있으므로 확실히 동기화 */
  if(window.electronAPI&&window.electronAPI.staffGetAll){
    window.electronAPI.staffGetAll().then(function(res){
      if(!res||!res.success||!Array.isArray(res.data))return;
      const fresh=res.data.find(function(r){return r.uid===id||String(r.uid)===String(id);});
      if(!fresh)return;
      /* DB row → 렌더러 형식 변환 */
      const staff={
        uid:fresh.uid,id:fresh.uid,name:fresh.name||'',type:'staff',
        position:fresh.position||'',
        gender:(fresh.gender==='M'?'남':(fresh.gender==='F'?'여':(fresh.gender||''))),
        familyRelation:fresh.family_relation||'',familyPhone:fresh.family_phone||'',
      };
      /* S.people 도 동기화 — 이후 다른 곳에서 참조 시 최신 값 사용 */
      const _s=getStu(id);
      if(_s&&!_s._notFound){
        _s.position=staff.position;
        _s.name=staff.name;
        _s.gender=staff.gender;
        _s.familyRelation=staff.familyRelation;
        _s.familyPhone=staff.familyPhone;
      }
      _render(staff);
    }).catch(function(){});
  }
}
/* 교직원 삭제 — DB + S.people 동시 제거 + 목록으로 복귀 */
function _apStaffEditDelete(id){
  const s=getStu(id);if(!s){bus.emit('toast:show', {text: '교직원 정보를 찾을 수 없습니다'});return;}
  _apConfirm({
    title:'🗑 교직원 삭제',
    message:'<b style="color:var(--t1)">'+escHtml((s.position||'교직원')+' '+(s.name||''))+'</b> 정보를 삭제하시겠습니까?<br><span style="font-size:11px;color:var(--t3)">복구할 수 없습니다. 보건일지 기록은 유지됩니다.</span>',
    confirmText:'삭제', cancelText:'취소', danger:true,
    onConfirm:function(){ _apStaffEditDeleteConfirmed(id, s); }
  });
}
function _apStaffEditDeleteConfirmed(id, s){
  if(window.electronAPI&&window.electronAPI.staffDelete){
    window.electronAPI.staffDelete(s.uid||id).then(function(r){
      if(!r||!r.success){
        bus.emit('toast:show', {text: '교직원 삭제 실패: '+((r&&r.error)||'알 수 없음')});
        return;
      }
      /* DB 재조회 — S.people(활성) 에서 빠지고 S.leavers(전근·퇴직) 로 이동되어야
       * 보건일지 행 렌더 시 이름이 그대로 표시됨. */
      const _doReload = (typeof _reloadStudentsFromDB==='function') ? _reloadStudentsFromDB() : Promise.resolve();
      _doReload.then(function(){
        bus.emit('render:daily');
        bus.emit('render:calendar');
        bus.emit('render:sidebar');
        bus.emit('render:dashboard');
        bus.emit('toast:show', {text: '교직원 정보가 삭제되었습니다'});
        /* 삭제 후 랜딩으로 복귀 — 학생 삭제와 동일하게 검색 팝업을 다시 띄우지 않는다
           (기존 _apStaffAction('edit') 는 검색 팝업을 자동으로 열어버림. 2026-06-07) */
        _apRenderPanel('staff');
        if(document.getElementById('apStaffInline'))_apStaffInlineRender();
      });
    }).catch(function(err){
      console.error('[DB] staff 삭제 실패:',err);
      bus.emit('toast:show', {text: '교직원 삭제 중 오류 발생'});
    });
  } else {
    bus.emit('toast:show', {text: 'DB 연결을 확인할 수 없습니다'});
  }
}
function _apStaffEditSave(id){
  const s=getStu(id);if(!s){bus.emit('toast:show', {text: '교직원 정보를 찾을 수 없습니다'});return;}
  const nm=document.getElementById('apEditStaffName');
  if(!nm||!nm.value.trim()){bus.emit('toast:show', {text: '이름을 입력하세요'});return;}
  s.position=(document.getElementById('apEditStaffPos')||{}).value||s.position;
  s.name=nm.value.trim();
  s.gender=(document.getElementById('apEditStaffGender')||{}).value||'';
  const _famV=(document.getElementById('apEditStaffFamily')||{}).value||'';
  s.familyRelation=_famV;s.familyContact=_famV;  /* 두 필드명 모두 업데이트 (백엔드 호환성) */
  s.familyPhone=(document.getElementById('apEditStaffFamilyPhone')||{}).value||'';
  /* 교직원은 staffUpsert 로 직접 저장 (peopleSaveAll 은 students 테이블만 갱신하므로 staff 편집이 반영 안 됨) */
  if(window.electronAPI&&window.electronAPI.staffUpsert){
    window.electronAPI.staffUpsert({
      uid:s.uid||id,
      name:s.name,
      position:s.position||'',
      gender:s.gender||'',
      familyRelation:s.familyRelation||'',
      familyPhone:s.familyPhone||'',
      is_active:1,
    }).catch(function(err){console.error('[DB] staff 저장 실패:',err);});
  }
  saveData();bus.emit('render:daily');bus.emit('render:dashboard');
  bus.emit('toast:show', {text: s.name+' 교직원 정보가 변경되었습니다'});
  _apStaffAction('edit');
  if(document.getElementById('apStaffInline'))_apStaffInlineRender();
}
/* ── 잠복결핵 개별 등록 (인라인) ── */
let _apTbCalYear=new Date().getFullYear(), _apTbCalMonth=new Date().getMonth();
function _apTbIndiv(){
  _apActivePanel='tb';
  const body=document.getElementById('apTbBody');if(!body)return;
  body.innerHTML='<div>'
    +'<div style="font-size:11px;color:var(--t3);margin-bottom:4px">검사한 교직원의 직위와 이름을 적으세요.</div>'
    +'<div style="font-size:10px;color:var(--t2);margin-bottom:10px;line-height:1.6">검사한 교원의 직위는 <b>교원, 직원, 행정실장, 교감, 교장</b> 중 하나를 선택하는 것이 데이터베이스 관리 상 가장 좋습니다.</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:6px;margin-bottom:6px"><input class="form-input" id="apTbPos" placeholder="직위 (예: 교원, 직원)" style="font-size:11px"><input class="form-input" id="apTbName" placeholder="이름 (예. 김샛별)" style="font-size:11px"></div>'
    +'<div style="margin-bottom:6px;position:relative"><label style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:4px;display:block">검사일</label><div style="display:flex;gap:6px;align-items:center"><input class="form-input" id="apTbDate" placeholder="날짜를 선택하세요" style="font-size:11px;flex:1;cursor:pointer" readonly><button class="btn btn-sm" data-action="_apTbOpenCal" style="font-size:11px">📅</button></div>'
    +'<div id="apTbCalWrap" style="display:none;position:fixed;z-index:9500"></div></div>'
    +'<div style="margin-bottom:12px"><input class="form-input" id="apTbInst" placeholder="검진 기관명" style="font-size:11px;width:100%"></div>'
    +'<button class="btn btn-primary btn-sm" data-action="_apTbIndivSave" style="width:100%">등록</button></div>';
  /* input 클릭 시 달력 열기 — 이전엔 data-action 위임 + click 리스너 + focus 리스너 3중 등록으로
   * 토글 함수가 여러 번 호출돼 열리자마자 닫히는 race. click 한 곳만 남겨 idempotent 보장. */
  const _dInp=document.getElementById('apTbDate');
  if(_dInp&&!_dInp._capBound){
    _dInp._capBound=true;
    _dInp.addEventListener('click',function(e){e.stopPropagation();_apTbOpenCal();});
  }
}
/* 달력 팝업 — training-view.js trOpenCal 과 동일 패턴 (자체 렌더 + 이벤트 위임, 문자열 콜백 X).
   이전에 _commonCalRender 에 문자열 넘겨 이전/다음달 · 날짜 선택 전부 미작동하던 문제 수정. */
function _apTbOpenCal(){
  const existing=document.getElementById('apTbCalFloat');
  if(existing){existing.remove();document.removeEventListener('click',_apTbCalOutside);return;}
  const inp=document.getElementById('apTbDate');if(!inp)return;
  /* 기존 입력값이 있으면 그 달을 보여주고, 없으면 현재 달 */
  const cur=(inp.value||'').trim();
  if(cur){const d=new Date(cur);if(!isNaN(d)){_apTbCalYear=d.getFullYear();_apTbCalMonth=d.getMonth();}}
  else{_apTbCalYear=new Date().getFullYear();_apTbCalMonth=new Date().getMonth();}
  const fl=document.createElement('div');fl.id='apTbCalFloat';
  fl.style.cssText='position:fixed;z-index:9500';
  document.body.appendChild(fl);
  _apTbRenderCal();
  /* 위치 조정 — 렌더 후 실제 높이 기반 */
  const rect=inp.getBoundingClientRect();
  const fh=fl.offsetHeight||340;
  fl.style.left=Math.min(rect.left,window.innerWidth-280)+'px';
  fl.style.top=(rect.bottom+fh+8>window.innerHeight?Math.max(4,rect.top-fh-4):rect.bottom+4)+'px';
  /* 바깥 클릭 시 닫기 */
  setTimeout(function(){document.addEventListener('click',_apTbCalOutside);},10);
  /* 달력 내부 클릭 위임 */
  fl.addEventListener('click',function(e){
    const el=e.target.closest('[data-cal-action]');if(!el)return;
    e.stopPropagation();
    const act=el.dataset.calAction;
    if(act==='prevMonth'){_apTbCalMonth--;if(_apTbCalMonth<0){_apTbCalMonth=11;_apTbCalYear--;}_apTbRenderCal();}
    else if(act==='nextMonth'){_apTbCalMonth++;if(_apTbCalMonth>11){_apTbCalMonth=0;_apTbCalYear++;}_apTbRenderCal();}
    else if(act==='setYear'){_apTbCalYear=parseInt(el.dataset.year);_apTbRenderCal();}
    else if(act==='setMonth'){_apTbCalMonth=parseInt(el.dataset.month);_apTbRenderCal();}
    else if(act==='selectDate'){_apTbCalSelect(el.dataset.date);}
  });
}
function _apTbCalOutside(e){
  const fl=document.getElementById('apTbCalFloat');if(!fl)return;
  if(fl.contains(e.target))return;
  if(e.target===document.getElementById('apTbDate'))return;
  if(e.target.closest('[data-action="_apTbOpenCal"]'))return;
  fl.remove();document.removeEventListener('click',_apTbCalOutside);
}
function _apTbRenderCal(){
  const fl=document.getElementById('apTbCalFloat');if(!fl)return;
  const holidays={};
  ensureHolidayYear(String(_apTbCalYear)); if(S.koreanHolidays)Object.keys(S.koreanHolidays).forEach(function(d){if(d.startsWith(String(_apTbCalYear)))holidays[d]=S.koreanHolidays[d];});
  const now=new Date();const thisY=now.getFullYear();
  const first=new Date(_apTbCalYear,_apTbCalMonth,1);const dow=first.getDay();
  const dim=new Date(_apTbCalYear,_apTbCalMonth+1,0).getDate();
  const todayStr=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  let h='<div style="border:1px solid var(--bdr);border-radius:8px;padding:10px;background:var(--card);min-width:260px;box-shadow:var(--sh)">';
  /* 헤더: ◀ 연도/월 ▶ */
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h+='<button data-cal-action="prevMonth" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2);padding:4px 10px">◀</button>';
  /* 연/월 호버 미니팝업 — 사이드바 달력(renderCalendar)과 동일 패턴(.mcal-year/.mcal-month/.mcal-popup).
   *  CSS :hover 로 표시되고 영역 벗어나면 사라짐(::before 로 호버 끊김 방지). 연=최근 10년, 월=12개월.
   *  클릭은 기존 _apTbOpenCal 의 data-cal-action(setYear/setMonth) 위임이 처리 → 해당 연/월로 이동. */
  const _nowY=new Date().getFullYear();
  let _yp='<div class="mcal-popup">';
  for(let y=_nowY-9;y<=_nowY;y++)_yp+='<div class="mcal-popup-item'+(y===_apTbCalYear?' active':'')+'" data-cal-action="setYear" data-year="'+y+'">'+y+'</div>';
  _yp+='</div>';
  const _mn=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let _mp='<div class="mcal-popup" style="min-width:140px;display:none;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
  for(let m=0;m<12;m++)_mp+='<div class="mcal-popup-item'+(m===_apTbCalMonth?' active':'')+'" data-cal-action="setMonth" data-month="'+m+'" style="width:45px">'+_mn[m]+'</div>';
  _mp+='</div>';
  h+='<div style="display:flex;gap:6px;align-items:baseline">';
  h+='<span class="mcal-year" style="font-size:13px;font-weight:800;color:var(--t1)">'+_apTbCalYear+'년'+_yp+'</span>';
  h+='<span class="mcal-month" style="font-size:13px;font-weight:800;color:var(--t1)">'+(_apTbCalMonth+1)+'월'+_mp+'</span>';
  h+='</div>';
  h+='<button data-cal-action="nextMonth" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2);padding:4px 10px">▶</button>';
  h+='</div>';
  /* 요일 */
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){h+='<span style="padding:4px;color:'+(i===0?'var(--rs)':i===6?'#3b82f6':'var(--t3)')+'">'+d+'</span>';});
  h+='</div>';
  /* 날짜 그리드 */
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:11px">';
  for(let e=0;e<dow;e++) h+='<span></span>';
  for(let dd=1;dd<=dim;dd++){
    const ds=_apTbCalYear+'-'+String(_apTbCalMonth+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
    const isT=(ds===todayStr);
    const ddow=(dow+dd-1)%7;
    const isH=!!holidays[ds];
    const col=(ddow===0||isH)?'var(--rs)':ddow===6?'#3b82f6':'var(--t1)';
    h+='<span data-cal-action="selectDate" data-date="'+ds+'" title="'+(holidays[ds]||'')+'" style="padding:6px;cursor:pointer;border-radius:4px;color:'+col+';font-weight:'+(isH||isT?'700':'400')+';'+(isT?'background:var(--cyan);color:#fff;':'')+'transition:background 0.1s" onmouseenter="this.style.background=\''+(isT?'var(--cyan)':'var(--hover)')+'\'" onmouseleave="this.style.background=\''+(isT?'var(--cyan)':'transparent')+'\'">'+dd+'</span>';
  }
  h+='</div></div>';
  fl.innerHTML=h;
  /* 월 팝업 inline display:none 해제 → CSS :hover(.mcal-month:hover .mcal-popup{display:flex})로 제어 (사이드바 달력 동일). */
  fl.querySelectorAll('.mcal-month .mcal-popup').forEach(function(p){p.style.display='';p.style.flexWrap='wrap';p.style.gap='2px';});
}
function _apTbCalSelect(ds){
  const inp=document.getElementById('apTbDate');if(inp)inp.value=ds;
  const fl=document.getElementById('apTbCalFloat');if(fl)fl.remove();
  document.removeEventListener('click',_apTbCalOutside);
}
function _apTbIndivSave(){
  const name=(document.getElementById('apTbName')||{}).value;
  const pos=(document.getElementById('apTbPos')||{}).value;
  const date=(document.getElementById('apTbDate')||{}).value;
  const inst=(document.getElementById('apTbInst')||{}).value;
  if(!name||!name.trim()){bus.emit('toast:show', {text: '이름을 입력하세요'});return;}
  if(!date){bus.emit('toast:show', {text: '검사일을 선택하세요'});return;}
  const entry={name:name.trim(),pos:(pos||'').trim(),date:_apTbNormalizeDate(date),inst:(inst||'').trim()};
  /* SQLite DB에 저장 */
  if(window.electronAPI&&window.electronAPI.tbTestAdd){
    window.electronAPI.tbTestAdd({name:entry.name,position:entry.pos,test_date:entry.date,institution:entry.inst}).then(function(r){
      if(r&&r.success){bus.emit('toast:show', {text: '잠복결핵 검사가 등록되었습니다 (DB 저장)'});}
      else{bus.emit('toast:show', {text: 'DB 저장 실패: '+(r&&r.error||'')});}
    });
  }
  /* 기존 메모리/JSON에도 유지 (호환) */
  S._apTbSearchData.push(entry);
  _apTbSearchSaveData();
  _apTbShowSaveToast();
  _apTbIndiv();
}
/* ── 잠복결핵 일괄 등록 (인라인) ── */
function _apTbBulk(){
  _apActivePanel='tb';
  const body=document.getElementById('apTbBody');if(!body)return;
  body.innerHTML='<div>'
    +'<button class="btn btn-primary btn-sm" data-action="_apTbDownloadTemplate" style="margin-bottom:8px">📥 최적화 양식 다운로드</button>'
    +'<div class="upload-area pm-upload-area" id="apTbUploadArea" tabindex="0" style="min-height:82px;outline:none" data-file-target="apTbFileInput" data-drop-handler="_apTbHandleFile" data-paste-handler="_apTbHandlePaste">📁 파일을 여기로 드래그하거나 클릭하여 선택</div>'
    +'<input type="file" id="apTbFileInput" accept=".xlsx,.xls" style="display:none" class="pm-file-input" data-change-handler="_apTbHandleFile">'
    +'<div id="apTbPreview" style="margin-top:10px"><div style="border:1px solid var(--bdr);border-radius:6px;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr style="background:var(--bg2)"><th style="padding:4px 6px;border-bottom:1px solid var(--bdr);text-align:center">순</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">직위</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">이름</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">검사일</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">검진기관명</th></tr></thead><tbody><tr><td colspan="5" style="padding:16px;text-align:center;color:var(--t3);font-size:11px">파일을 업로드하면 해당 파일에서 불러온 명단이 표시됩니다.</td></tr></tbody></table></div></div>'
    +'<div id="apTbBulkStatus" style="margin-top:6px"></div></div>';
  _pmBindUpload(body);
}
function _apTbDownloadTemplate(){
  /* igra.xlsx를 앱 리소스에서 직접 다운로드 — getUserDataPath 의존 제거 */
  if(!(window.electronAPI&&window.electronAPI.readFile)){
    console.warn('[TB] readFile IPC 미지원 → fallback');
    _apTbDownloadTemplateFallback();return;
  }
  window.electronAPI.readFile('__app__/templates/forms/igra.xlsx').then(function(res){
    if(res&&res.success&&res.data){
      const bin=atob(res.data);const arr=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      const blob=new Blob([arr],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const link=document.createElement('a');
      link.download='igra.xlsx';
      link.href=URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      setTimeout(function(){URL.revokeObjectURL(link.href);link.remove();},100);
      console.log('[TB] igra.xlsx 다운로드 완료 ('+arr.length+' bytes)');
    } else {
      console.warn('[TB] readFile 실패:',res&&res.error,'→ fallback');
      _apTbDownloadTemplateFallback();
    }
  }).catch(function(err){
    console.warn('[TB] readFile 예외:',err,'→ fallback');
    _apTbDownloadTemplateFallback();
  });
}
function _apTbDownloadTemplateFallback(){
  if(typeof XLSX==='undefined'){bus.emit('toast:show', {text: 'XLSX 라이브러리를 찾을 수 없습니다'});return;}
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([['직위','이름','검진일자','검진기관'],['','','',''],['','','검진일자를 0000.00.00. 형태로 적어주세요.',''],['','','예. 2026.03.23.','']]);
  ws['!cols']=[{wch:10},{wch:10},{wch:14},{wch:16}];
  XLSX.utils.book_append_sheet(wb,ws,'잠복결핵검사');
  XLSX.writeFile(wb,'잠복결핵검사_양식.xlsx');
}
function _apTbNormalizeDate(val){
  if(val==null||val==='')return'';
  /* Date 객체 직접 전달 */
  if(val instanceof Date&&!isNaN(val.getTime())){
    return val.getFullYear()+'.'+String(val.getMonth()+1).padStart(2,'0')+'.'+String(val.getDate()).padStart(2,'0')+'.';
  }
  /* 숫자(엑셀 시리얼) */
  if(typeof val==='number'){
    if(typeof XLSX!=='undefined'&&val>0&&val<60000){
      try{const dd=XLSX.SSF.parse_date_code(val);
        if(dd&&dd.y)return dd.y+'.'+String(dd.m).padStart(2,'0')+'.'+String(dd.d).padStart(2,'0')+'.';
      }catch(_){}
    }
    val=String(val);
  }
  const raw=String(val).trim();
  if(!raw)return'';
  /* 구어체 */
  const _todayFmt=function(d){return d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0')+'.';};
  if(/^(오늘|today)$/i.test(raw))return _todayFmt(new Date());
  if(/^(어제|yesterday)$/i.test(raw)){const d=new Date();d.setDate(d.getDate()-1);return _todayFmt(d);}
  if(/^(내일|tomorrow)$/i.test(raw)){const d=new Date();d.setDate(d.getDate()+1);return _todayFmt(d);}
  /* 명시적 단축 포맷 우선 처리 — YY.MM.DD(.), YY-MM-DD, YY/MM/DD */
  const mYy=raw.match(/^(\d{2})[.\-/\s](\d{1,2})[.\-/\s](\d{1,2})\.?$/);
  if(mYy){
    const yy=parseInt(mYy[1],10);
    const century=(yy<=50?'20':'19');
    return century+mYy[1]+'.'+String(mYy[2]).padStart(2,'0')+'.'+String(mYy[3]).padStart(2,'0')+'.';
  }
  /* 명시적 순수 숫자 — YYYYMMDD / YYMMDD */
  if(/^\d{8}$/.test(raw)){
    const y=parseInt(raw.slice(0,4),10);
    if(y>=1900&&y<=2099)return raw.slice(0,4)+'.'+raw.slice(4,6)+'.'+raw.slice(6,8)+'.';
  }
  if(/^\d{6}$/.test(raw)){
    const yy=parseInt(raw.slice(0,2),10);
    const century=(yy<=50?'20':'19');
    return century+raw.slice(0,2)+'.'+raw.slice(2,4)+'.'+raw.slice(4,6)+'.';
  }
  /* 한글 "2026년 4월 20일" 또는 "2026 년 4 월 20 일" */
  const mKor=raw.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if(mKor)return mKor[1]+'.'+String(mKor[2]).padStart(2,'0')+'.'+String(mKor[3]).padStart(2,'0')+'.';
  /* 영문 월명: "April 20, 2026" / "Apr 20 2026" / "20 April 2026" */
  const _enMon={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const mEnYmd=raw.match(/([a-z]{3,9})\s+(\d{1,2})(?:,|\s)\s*(\d{4})/i);
  if(mEnYmd){const mo=_enMon[mEnYmd[1].toLowerCase().slice(0,4)]||_enMon[mEnYmd[1].toLowerCase().slice(0,3)];if(mo)return mEnYmd[3]+'.'+String(mo).padStart(2,'0')+'.'+String(mEnYmd[2]).padStart(2,'0')+'.';}
  const mDmy=raw.match(/(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})/i);
  if(mDmy){const mo=_enMon[mDmy[2].toLowerCase().slice(0,4)]||_enMon[mDmy[2].toLowerCase().slice(0,3)];if(mo)return mDmy[3]+'.'+String(mo).padStart(2,'0')+'.'+String(mDmy[1]).padStart(2,'0')+'.';}
  /* ISO datetime: 2026-04-20T00:00:00 */
  const mIso=raw.match(/(\d{4})-(\d{2})-(\d{2})[T\s]/);
  if(mIso)return mIso[1]+'.'+mIso[2]+'.'+mIso[3]+'.';
  /* YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD, YYYY MM DD, YYYY_MM_DD 등 모든 구분자 */
  const m4=raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if(m4)return m4[1]+'.'+String(m4[2]).padStart(2,'0')+'.'+String(m4[3]).padStart(2,'0')+'.';
  /* MM/DD/YYYY (미국식) 또는 DD/MM/YYYY (유럽식) — 뒤 숫자가 4자리면 연도 */
  const mMdYy=raw.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})$/);
  if(mMdYy){
    /* 첫 숫자 >12 면 DD/MM/YYYY, 두 번째 >12 면 MM/DD/YYYY. 둘 다 <=12 면 한국식 가정해서 M/D/Y 로 처리 */
    const a=parseInt(mMdYy[1],10), b=parseInt(mMdYy[2],10);
    if(a>12&&b<=12)return mMdYy[3]+'.'+String(b).padStart(2,'0')+'.'+String(a).padStart(2,'0')+'.';
    return mMdYy[3]+'.'+String(a).padStart(2,'0')+'.'+String(b).padStart(2,'0')+'.';
  }
  /* YY-MM-DD, YY.MM.DD, YY/MM/DD */
  const m2=raw.match(/(\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  if(m2){const yy=parseInt(m2[1],10);return (yy<=50?'20':'19')+m2[1]+'.'+String(m2[2]).padStart(2,'0')+'.'+String(m2[3]).padStart(2,'0')+'.';}
  /* 구분자 없는 순수 숫자 */
  const s=raw.replace(/[^0-9]/g,'');
  if(s.length===8){
    /* YYYYMMDD 또는 DDMMYYYY 판별 — 앞 4자리가 그럴듯한 연도(1900~2099)면 YYYYMMDD */
    const front=parseInt(s.slice(0,4),10);
    if(front>=1900&&front<=2099)return s.slice(0,4)+'.'+s.slice(4,6)+'.'+s.slice(6,8)+'.';
    const back=parseInt(s.slice(4,8),10);
    if(back>=1900&&back<=2099)return s.slice(4,8)+'.'+s.slice(2,4)+'.'+s.slice(0,2)+'.';
    return s.slice(0,4)+'.'+s.slice(4,6)+'.'+s.slice(6,8)+'.';
  }
  if(s.length===6){
    const y6=parseInt(s.slice(0,2),10);
    if(y6>=0&&y6<=50)return '20'+s.slice(0,2)+'.'+s.slice(2,4)+'.'+s.slice(4,6)+'.';
    if(y6>50&&y6<=99)return '19'+s.slice(0,2)+'.'+s.slice(2,4)+'.'+s.slice(4,6)+'.';
  }
  if(s.length===5)return '20'+s.slice(0,2).padStart(2,'0')+'.'+s.slice(2,4)+'.'+s.slice(4,5).padStart(2,'0')+'.';
  if(s.length===4){
    /* M/D 만 입력한 경우 — 현재 연도 적용 */
    const yr=new Date().getFullYear();
    return yr+'.'+s.slice(0,2)+'.'+s.slice(2,4)+'.';
  }
  if(s.length>=9)return s.slice(0,4)+'.'+s.slice(4,6)+'.'+s.slice(6,8)+'.';
  /* 마지막 시도 — Date.parse */
  const parsed=Date.parse(raw);
  if(!isNaN(parsed)){const d=new Date(parsed);return _todayFmt(d);}
  return raw;
}
function _apTbHandlePaste(e){if(e.clipboardData&&e.clipboardData.files&&e.clipboardData.files[0]){e.preventDefault();_apTbHandleFile(e.clipboardData.files[0]);}}
let _apTbRows=[];
function _apTbHandleFile(file){
  if(!file)return;
  const area=document.getElementById('apTbUploadArea');if(area)area.textContent='📁 업로드된 파일: '+file.name;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const rows=parseXLSX(new Uint8Array(e.target.result));
      if(!rows.length){bus.emit('toast:show', {text: '데이터가 없습니다'});return;}
      const headers=Object.keys(rows[0]);
      const hPos=headers.find(function(h){return h.match(/직위|position/i);})||'';
      const hName=headers.find(function(h){return h.match(/성명|이름|name/i);});
      /* 검진일자 신규 헤더 매칭 추가(검진일). "검진" 단독을 기관 정규식에서 제거 — "검진일자"가 기관으로 오인되던 버그 방지 (사용자 양식 개편 2026-05-28). */
      const hDate=headers.find(function(h){return h.match(/검사일|검진일|날짜|date/i);})||'';
      const hInst=headers.find(function(h){return h.match(/기관|병원/i);})||'';
      if(!hName){
        const _det=(headers||[]).filter(function(h){return String(h==null?'':h).trim();}).join(', ')||'(머리글을 못 읽음)';
        alert('이름(성명) 열을 찾을 수 없어 등록을 진행할 수 없습니다.\n\n· 첫 번째 시트 1행에서 읽은 머리글: '+_det+'\n\n→ 다운로드한 양식의 1행(머리글)은 절대 변경하면 안 됩니다.\n   처음 제시된 1행을 그대로 둔 채, 아래에 데이터만 채워 다시 올려주세요.\n   (1행을 지우거나 글자를 바꾸거나 셀을 병합하면 이름 열을 인식하지 못합니다.)');
        return;
      }
      _apTbRows=[];
      rows.forEach(function(r,i){
        if(!r[hName])return;
        let dateVal=hDate?r[hDate]:'';
        if(typeof dateVal==='number'&&typeof XLSX!=='undefined'){const dd=XLSX.SSF.parse_date_code(dateVal);dateVal=dd.y+String(dd.m).padStart(2,'0')+String(dd.d).padStart(2,'0');}
        _apTbRows.push({seq:i+1,pos:String(hPos?r[hPos]||'':'').trim(),name:String(r[hName]).trim(),date:_apTbNormalizeDate(dateVal),inst:String(hInst?r[hInst]||'':'').trim()});
      });
      const prev=document.getElementById('apTbPreview');if(!prev)return;
      let t='<div style="max-height:200px;overflow-y:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;border:1px solid var(--bdr);border-radius:6px"><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr style="background:var(--bg2);position:sticky;top:0"><th style="padding:4px 6px;border-bottom:1px solid var(--bdr);text-align:center">순</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">직위</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">이름</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">검사일</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">검진기관명</th></tr></thead><tbody>';
      _apTbRows.forEach(function(r){t+='<tr><td style="padding:3px 6px;text-align:center;border-bottom:1px solid var(--bdr)">'+r.seq+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--bdr)">'+escHtml(r.pos)+'</td><td style="padding:3px 6px;font-weight:600;border-bottom:1px solid var(--bdr)">'+escHtml(r.name)+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--bdr)">'+escHtml(r.date)+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--bdr)">'+escHtml(r.inst)+'</td></tr>';});
      t+='</tbody></table></div>';prev.innerHTML=t;
      /* 자동 저장 — 같은 이름+검사일은 업데이트, 신규만 추가 */
      if(!Array.isArray(S._apTbSearchData))S._apTbSearchData=[];
      const _idxMap={};
      S._apTbSearchData.forEach(function(d,i){_idxMap[(d.name||'')+'|'+(d.date||'')]=i;});
      let _addedCount=0,_updatedCount=0;
      const _uploadedAt=new Date();
      const _uploadStamp=_uploadedAt.getFullYear()+'.'+String(_uploadedAt.getMonth()+1).padStart(2,'0')+'.'+String(_uploadedAt.getDate()).padStart(2,'0')+' '+String(_uploadedAt.getHours()).padStart(2,'0')+':'+String(_uploadedAt.getMinutes()).padStart(2,'0');
      _apTbRows.forEach(function(r){
        const key=(r.name||'')+'|'+(r.date||'');
        const newRow={name:r.name,pos:r.pos,date:r.date,inst:r.inst,uploadedAt:_uploadStamp};
        if(_idxMap[key]!==undefined){
          /* 기존 행 업데이트 — 빈 필드는 기존 값 유지 */
          const old=S._apTbSearchData[_idxMap[key]];
          S._apTbSearchData[_idxMap[key]]={
            name:r.name,
            pos:r.pos||old.pos||'',
            date:r.date,
            inst:r.inst||old.inst||'',
            uploadedAt:_uploadStamp
          };
          _updatedCount++;
        } else {
          S._apTbSearchData.push(newRow);
          _idxMap[key]=S._apTbSearchData.length-1;
          _addedCount++;
        }
      });
      _apTbSearchSaveData();
      bus.emit('toast:show',{text:'신규 '+_addedCount+'건 추가, 기존 '+_updatedCount+'건 업데이트'});
      /* DB tb_tests 테이블에도 단 한 번만 저장 — 중복 방지 위해 tbTestImportXlsx 와 tbTestAdd 동시 호출하지 않음 */
      if(window.electronAPI&&window.electronAPI.tbTestAdd){
        _apTbRows.forEach(function(r){
          window.electronAPI.tbTestAdd({name:r.name,position:r.pos,test_date:r.date,institution:r.inst});
        });
      }
      const statusEl=document.getElementById('apTbBulkStatus');
      if(statusEl){
        statusEl.innerHTML='<div style="text-align:center;font-size:11px;font-weight:700;color:#ca8a04">저장 중…</div>';
        setTimeout(function(){
          if(statusEl)statusEl.innerHTML='<div style="text-align:center;font-size:11px;font-weight:700;color:#22c55e">✅ '+_apTbRows.length+'건 업로드 완료</div>';
          _apTbRows=[];
        },300);
      }
      _apTbShowSaveToast();
    }catch(ex){bus.emit('toast:show', {text: '파일 읽기 오류: '+ex.message});}
  };reader.readAsArrayBuffer(file);
}
/* ── 잠복결핵 검색 (인라인) ── */
/* S._apTbSearchData: helpers.js _initJsonLoad → DB → S._apTbSearchData 로 비동기 로드됩니다.
 * localStorage.getItem('ec_tbTestData')는 더 이상 사용하지 않습니다. */
S._apTbSearchData=Array.isArray(S._apTbSearchData)?S._apTbSearchData:[];
let _apTbSortOrder='desc';
function _apTbSearchSaveData(){
  /* S._apTbSearchData가 이미 캐노니컬 store — 별도 동기화 불필요 (이전 _apTbSearchData 참조는 ReferenceError 유발) */
  if(!Array.isArray(S._apTbSearchData))S._apTbSearchData=[];
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
    window.electronAPI.jsonSaveCommon('tbTestData',S._apTbSearchData).then(function(r){
      if(r&&!r.success)console.error('[JSON] tbTestData 저장 실패:',r.error);
    });
  _apTbRenderListTable();
}
function _apTbShowSaveToast(){
  const toast=document.getElementById('globalSaveToast');
  if(toast){
    toast.textContent='저장 중…';
    toast.className='global-save-toast show saving';
    setTimeout(function(){
      toast.textContent='모든 내용이 저장되었습니다.';
      toast.className='global-save-toast show';
      setTimeout(function(){toast.className='global-save-toast';},3000);
    },300);
  }
}
/* 검사일 정규화 — 비교용 키 (모든 구분자 제거: "2024.02.18." → "20240218", "2024-02-18" → "20240218") */
function _apTbDateKey(d){return String(d||'').replace(/\D/g,'');}

function _apTbShowList(){
  _apActivePanel='tb';
  /* 목록 열 때 검색어 초기화 — 빈 검색창인데 '0/N + ✕' stuck 방지 (2026-06-07, 학생/교직원과 동일) */
  _apTbListQuery='';
  const body=document.getElementById('apTbBody');if(!body)return;
  body.innerHTML='<div id="apTbListArea"><div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">데이터 로딩 중...</div></div>';
  /* DB에서 우선 로드 — DB가 단일 진실의 원천. 레거시 JSON 캐시는 DB에 없는 항목만 보존 */
  if(window.electronAPI&&window.electronAPI.tbTestGetAll){
    window.electronAPI.tbTestGetAll().then(function(r){
      if(r&&r.success&&r.data){
        const dbItems=(r.data||[]).map(function(d){return{id:d.id,name:d.name,pos:d.position||'',date:d.test_date||'',inst:d.institution||d.memo||''};});
        /* 1단계: DB 결과를 가장 신뢰. 정규화된 (이름|YYYYMMDD) 키로 dedup. */
        const seen={};
        const merged=[];
        dbItems.forEach(function(d){
          const key=d.name+'|'+_apTbDateKey(d.date);
          if(!seen[key]){seen[key]=true;merged.push(d);}
        });
        /* 2단계: 레거시 JSON(S._apTbSearchData) 항목 중 DB에 없는 것만 추가 — 정규화 키로 비교 */
        (S._apTbSearchData||[]).forEach(function(d){
          const key=d.name+'|'+_apTbDateKey(d.date);
          if(!seen[key]){seen[key]=true;merged.push(d);}
        });
        /* 결과로 교체 → 레거시 dotted-date 와 DB dashed-date 가 동일인이면 1건만 남음 */
        S._apTbSearchData=merged;
      }
      _apTbRenderListTable();
    });
  } else {
    _apTbRenderListTable();
  }
}
let _apTbListQuery='';
/* 정렬·필터 적용된 결과 반환 */
function _apTbListComputeRows(){
  const _q=String(_apTbListQuery||'').trim();
  const filtered=_q
    ? S._apTbSearchData.filter(function(r){return _apTbNameMatch(r.name||'', _q);})
    : S._apTbSearchData.slice();
  filtered.sort(function(a,b){
    const da=(a.date||'').replace(/\./g,''), db=(b.date||'').replace(/\./g,'');
    return _apTbSortOrder==='asc'?da.localeCompare(db):db.localeCompare(da);
  });
  return {q:_q, rows:filtered, total:S._apTbSearchData.length};
}
function _apTbRenderListTable(){
  const area=document.getElementById('apTbListArea');if(!area)return;
  /* 1단계: 정적 셸 (검색창·툴바·테이블 헤더·tbody/스탯 컨테이너) — 입력창은 한 번만 그려서 IME 조합이 끊기지 않게. */
  const _TH='padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2);background:var(--bg2);position:sticky;top:0;z-index:5';
  let h='<div style="position:relative;margin-bottom:8px"><input class="form-input pm-oninput" data-input-handler="_apTbListSearchInput" id="apTbListSearch" placeholder="🔍 이름·초성으로 검색" style="font-size:12px;width:100%;padding:8px 10px" autocomplete="off">'
    +'<span id="apTbListSearchClear" data-action="_apTbListSearchClear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);font-size:10px;font-weight:700;align-items:center;justify-content:center;cursor:pointer;user-select:none">✕</span>'
    +'</div>';
  h+='<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;flex-wrap:wrap">';
  h+='<span id="apTbListCount" style="font-size:11px;font-weight:700;color:var(--t1)"></span>';
  h+='<button data-action="_apTbSort" data-arg="asc" id="apTbSortAsc" style="padding:3px 8px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;cursor:pointer;background:transparent;color:var(--t2);font-family:var(--f)">검사일 오름차순</button>';
  h+='<button data-action="_apTbSort" data-arg="desc" id="apTbSortDesc" style="padding:3px 8px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;cursor:pointer;background:transparent;color:var(--t2);font-family:var(--f)">검사일 내림차순</button>';
  h+='<button data-action="_apTbExportExcel" style="margin-left:auto;padding:4px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none">📗 Excel 다운로드</button>';
  h+='<button data-action="_apTbExportSheets" style="padding:4px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:linear-gradient(135deg,#16a34a,#059669);color:#fff;border:none">📊 Google Sheets로 보내기</button>';
  h+='</div>';
  h+='<div style="border:1px solid var(--bdr);border-radius:8px;overflow:auto;background:var(--card);max-height:500px">';
  h+='<table style="width:100%;border-collapse:collapse;font-size:11px">';
  h+='<thead><tr>';
  h+='<th style="'+_TH+';width:44px">순</th>';
  h+='<th style="'+_TH+';width:120px">직위</th>';
  h+='<th style="'+_TH+'">이름</th>';
  h+='<th style="'+_TH+';width:120px">검사일</th>';
  h+='<th style="'+_TH.replace('text-align:center','text-align:left')+'">검진기관명</th>';
  h+='</tr></thead><tbody id="apTbListTbody"></tbody>';
  h+='</table></div>';
  area.innerHTML=h;
  _pmDelegate(area);
  _pmBindUpload(area);
  /* 2단계: tbody·카운트·정렬 강조·입력값을 분리해서 채움 */
  _apTbApplyListBody();
}
/* tbody·카운트·정렬 버튼 강조 갱신 — DOM 보존하며 부분 업데이트 (입력창 IME 보존) */
function _apTbApplyListBody(){
  const tbody=document.getElementById('apTbListTbody'); if(!tbody) return;
  const data=_apTbListComputeRows();
  const _TD='padding:6px 6px;text-align:center;border-bottom:1px solid var(--bdrl);font-size:11px;color:var(--t1)';
  let body='';
  if(!data.rows.length){
    const _emptyMsg=data.q?'검색 결과가 없습니다.':'등록된 수검자가 없습니다. 위의 카드에서 개별/일괄 등록을 진행하세요.';
    body='<tr><td colspan="5" style="padding:32px 16px;text-align:center;color:var(--t3);font-size:11px">'+_emptyMsg+'</td></tr>';
  } else {
    data.rows.forEach(function(r,i){
      body+='<tr data-action="_apTbRowPick" data-arg="'+i+'" data-hover="ac" style="cursor:pointer" title="클릭하여 수정·삭제">'
        +'<td style="'+_TD+';color:var(--t3);font-size:10px">'+(i+1)+'</td>'
        +'<td style="'+_TD+';color:var(--t2)">'+escHtml(r.pos||'')+'</td>'
        +'<td style="'+_TD+';font-weight:600">'+escHtml(r.name||'')+'</td>'
        +'<td style="'+_TD+';font-size:10px;color:var(--t2)">'+escHtml(r.date||'')+'</td>'
        +'<td style="'+_TD.replace('text-align:center','text-align:left')+';font-size:10px;color:var(--t2)">'+escHtml(r.inst||'')+'</td>'
        +'</tr>';
    });
  }
  tbody.innerHTML=body;
  /* 카운트 갱신 */
  const cnt=document.getElementById('apTbListCount');
  if(cnt) cnt.textContent=(data.q?(data.rows.length+'/'+data.total):('총 '+data.total))+'명';
  /* clear (✕) 버튼 표시/숨김 */
  const clr=document.getElementById('apTbListSearchClear');
  if(clr) clr.style.display=data.q?'inline-flex':'none';
  /* 정렬 버튼 강조 갱신 */
  const sa=document.getElementById('apTbSortAsc'), sd=document.getElementById('apTbSortDesc');
  if(sa){
    const on=_apTbSortOrder==='asc';
    sa.style.fontWeight=on?'800':'600';
    sa.style.borderColor=on?'var(--cyan)':'var(--bdr)';
    sa.style.background=on?'rgba(6,182,212,0.1)':'transparent';
    sa.style.color=on?'var(--cyan)':'var(--t2)';
  }
  if(sd){
    const on=_apTbSortOrder==='desc';
    sd.style.fontWeight=on?'800':'600';
    sd.style.borderColor=on?'var(--cyan)':'var(--bdr)';
    sd.style.background=on?'rgba(6,182,212,0.1)':'transparent';
    sd.style.color=on?'var(--cyan)':'var(--t2)';
  }
}
function _apTbListSearchInput(el){
  _apTbListQuery=String(el && el.value || '');
  /* tbody·카운트만 부분 업데이트 — 입력창은 그대로 두어 한글 IME 조합이 유지됨 */
  _apTbApplyListBody();
}
function _apTbListSearchClear(){
  _apTbListQuery='';
  const inp=document.getElementById('apTbListSearch');
  if(inp){inp.value='';inp.focus();}
  _apTbApplyListBody();
}
/* ── 누적 인원 보기: 행 클릭 → 수정/삭제 (DB 반영) ── */
let _apTbEditing=null;   /* 현재 수정 중인 레코드 (S._apTbSearchData 내 참조) */
function _apTbRowPick(idx){
  const rows=_apTbListComputeRows().rows;
  const rec=rows[parseInt(idx,10)];
  if(!rec)return;
  _apTbEditing=rec;
  _apTbRenderEditForm(rec);
}
function _apTbRenderEditForm(rec){
  const area=document.getElementById('apTbListArea');if(!area)return;
  let h='<div style="margin-bottom:10px"><span data-action="_apTbShowList" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← 명단으로</span></div>';
  h+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:10px">💉 검사 기록 수정 / 삭제</div>';
  h+='<div style="margin-bottom:6px"><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:3px">이름</label><input class="form-input" id="apTbEditName" value="'+escHtml(rec.name||'')+'" style="font-size:11px;width:100%"></div>';
  h+='<div style="margin-bottom:6px"><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:3px">직위</label><input class="form-input" id="apTbEditPos" value="'+escHtml(rec.pos||'')+'" style="font-size:11px;width:100%"></div>';
  h+='<div style="margin-bottom:6px;position:relative"><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:3px">검사일</label><div style="display:flex;gap:6px;align-items:center"><input class="form-input" id="apTbDate" value="'+escHtml(rec.date||'')+'" placeholder="날짜를 선택하세요" style="font-size:11px;flex:1;cursor:pointer" readonly><button class="btn btn-sm" data-action="_apTbOpenCal" style="font-size:11px">📅</button></div>'
    +'<div id="apTbCalWrap" style="display:none;position:fixed;z-index:9500"></div></div>';
  h+='<div style="margin-bottom:12px"><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:3px">검진 기관명</label><input class="form-input" id="apTbEditInst" value="'+escHtml(rec.inst||'')+'" style="font-size:11px;width:100%"></div>';
  h+='<div style="display:flex;gap:6px"><button class="btn btn-primary btn-sm" data-action="_apTbEditSave" style="flex:1">수정 저장</button>'
    +'<button class="btn btn-sm" data-action="_apTbEditDelete" style="flex:0 0 auto;background:rgba(239,68,68,0.07);color:#dc2626;border:1px solid rgba(239,68,68,0.3)">🗑 삭제</button></div>';
  area.innerHTML=h;
  _pmDelegate(area);
  const _dInp=document.getElementById('apTbDate');
  if(_dInp&&!_dInp._capBound){_dInp._capBound=true;_dInp.addEventListener('click',function(e){e.stopPropagation();_apTbOpenCal();});}
}
function _apTbEditSave(){
  const rec=_apTbEditing;if(!rec){_apTbShowList();return;}
  const name=((document.getElementById('apTbEditName')||{}).value)||'';
  const pos=((document.getElementById('apTbEditPos')||{}).value)||'';
  const date=((document.getElementById('apTbDate')||{}).value)||'';
  const inst=((document.getElementById('apTbEditInst')||{}).value)||'';
  if(!name.trim()){bus.emit('toast:show',{text:'이름을 입력하세요'});return;}
  if(!date){bus.emit('toast:show',{text:'검사일을 선택하세요'});return;}
  const ndate=_apTbNormalizeDate(date);
  const data={name:name.trim(),position:pos.trim(),test_date:ndate,institution:inst.trim()};
  const _after=function(){
    /* 메모리/JSON 도 제자리 갱신 → 재로드 시 DB 키와 일치해 중복 방지 */
    rec.name=data.name; rec.pos=data.position; rec.date=ndate; rec.inst=data.institution;
    _apTbSearchSaveData();
    _apTbShowSaveToast();
    _apTbShowList();              /* DB에서 다시 읽어 갱신 */
  };
  if(rec.id!=null && window.electronAPI && window.electronAPI.tbTestUpdate){
    window.electronAPI.tbTestUpdate(rec.id, data).then(function(r){
      if(!r||!r.success){bus.emit('toast:show',{text:'DB 수정 실패: '+((r&&r.error)||'')});}
      _after();
    }).catch(function(e){bus.emit('toast:show',{text:'DB 수정 오류: '+(e&&e.message||'')});_after();});
  } else {
    _after();   /* DB id 없는 레거시 항목 — 메모리/JSON 만 갱신 */
  }
}
function _apTbEditDelete(){
  const rec=_apTbEditing;if(!rec){_apTbShowList();return;}
  if(!window.confirm('이 검사 기록을 삭제할까요?\n\n'+(rec.name||'')+(rec.date?(' ('+rec.date+')'):'')))return;
  const _after=function(){
    S._apTbSearchData=(S._apTbSearchData||[]).filter(function(x){return x!==rec;});
    _apTbEditing=null;
    _apTbSearchSaveData();
    _apTbShowSaveToast();
    _apTbShowList();
  };
  if(rec.id!=null && window.electronAPI && window.electronAPI.tbTestDelete){
    window.electronAPI.tbTestDelete(rec.id).then(function(r){
      if(!r||!r.success){bus.emit('toast:show',{text:'DB 삭제 실패: '+((r&&r.error)||'')});}
      _after();
    }).catch(function(e){bus.emit('toast:show',{text:'DB 삭제 오류: '+(e&&e.message||'')});_after();});
  } else {
    _after();
  }
}
function _apTbKorDecompose(ch){
  let code=ch.charCodeAt(0);
  if(code<0xAC00||code>0xD7A3)return null;
  code-=0xAC00;
  const cho=Math.floor(code/588);
  const jung=Math.floor((code%588)/28);
  const jong=code%28;
  return{cho:cho,jung:jung,jong:jong};
}
/* 자모(U+3131..U+314E)를 초성 인덱스로 변환. 자모가 아니면 -1.
   초성 19종에 일부 겹치는 자음(ㄳ ㄵ 등 종성 전용)은 무시. */
const _AP_JAMO_TO_CHO={
  'ㄱ':0,'ㄲ':1,'ㄴ':2,'ㄷ':3,'ㄸ':4,'ㄹ':5,'ㅁ':6,'ㅂ':7,'ㅃ':8,'ㅅ':9,
  'ㅆ':10,'ㅇ':11,'ㅈ':12,'ㅉ':13,'ㅊ':14,'ㅋ':15,'ㅌ':16,'ㅍ':17,'ㅎ':18
};
function _apTbJamoCho(ch){return Object.prototype.hasOwnProperty.call(_AP_JAMO_TO_CHO,ch)?_AP_JAMO_TO_CHO[ch]:-1;}
function _apTbNameMatch(name,query){
  if(!query)return false;
  const q=query.toLowerCase(), n=name.toLowerCase();
  if(n.indexOf(q)>=0)return true;
  /* 한글 자모/완성형 매칭.
     • 자모 단독('ㄱ', 'ㅈ' 등) → 이름 글자의 초성만 비교
     • 완성형 + 종성 없음('이') → 초성+중성 비교 (받침 자유)
     • 완성형 + 종성('임') → 초성+중성+종성 모두 일치 */
  if(query.length<=name.length){
    for(let i=0;i<=name.length-query.length;i++){
      let match=true;
      for(let j=0;j<query.length;j++){
        const qChar=query[j], nChar=name[i+j];
        const nd=_apTbKorDecompose(nChar);
        const qJamoCho=_apTbJamoCho(qChar);
        if(qJamoCho>=0){
          /* 쿼리가 자모 단독 — 이름 글자가 한글 완성형이어야 초성 비교 가능 */
          if(!nd){match=false;break;}
          if(nd.cho!==qJamoCho){match=false;break;}
          continue;
        }
        const qd=_apTbKorDecompose(qChar);
        if(!qd||!nd){if(qChar.toLowerCase()!==nChar.toLowerCase()){match=false;break;}continue;}
        if(qd.cho!==nd.cho){match=false;break;}
        if(qd.jung!==0&&qd.jung!==nd.jung){match=false;break;}
        if(qd.jong!==0&&qd.jong!==nd.jong){match=false;break;}
      }
      if(match)return true;
    }
  }
  return false;
}
function _apTbDoSearch(){
  const inp=document.getElementById('apTbSearchInput');
  const res=document.getElementById('apTbSearchResults');
  if(!inp||!res)return;
  const q=inp.value.trim();
  /* DB에서도 검색하여 메모리 데이터와 병합 */
  if(window.electronAPI&&window.electronAPI.tbTestSearch&&q){
    window.electronAPI.tbTestSearch({name:q}).then(function(r){
      if(r&&r.success&&r.data){
        const seen={};S._apTbSearchData.forEach(function(d){seen[d.name+'|'+d.date]=true;});
        r.data.forEach(function(d){const key=d.name+'|'+(d.test_date||'');if(!seen[key]){S._apTbSearchData.push({name:d.name,pos:d.position||'',date:d.test_date||'',inst:d.institution||d.memo||''});seen[key]=true;}});
      }
      _apTbDoSearchRender(q,res);
    });
    return;
  }
  _apTbDoSearchRender(q,res);
}
function _apTbDoSearchRender(q,res){
  let results;
  if(!q){
    results=S._apTbSearchData.slice();
  } else {
    const firstCharMatches=[];const otherMatches=[];
    S._apTbSearchData.forEach(function(r){
      if(_apTbNameMatch(r.name,q)){
        if(r.name.length>0&&q.length>0&&r.name[0]===q[0])firstCharMatches.push(r);
        else otherMatches.push(r);
      }
    });
    results=firstCharMatches.concat(otherMatches);
  }
  if(!results.length){res.innerHTML='<div style="font-size:11px;color:var(--t3);text-align:center;padding:12px">'+(q?'검색 결과가 없습니다':'등록된 검사 대상자가 없습니다')+'</div>';return;}
  let h='<div style="max-height:240px;overflow-y:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;border:1px solid var(--bdr);border-radius:6px">';
  h+='<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr style="background:var(--bg2);position:sticky;top:0"><th style="padding:4px 6px;border-bottom:1px solid var(--bdr);text-align:center">대상자</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">직위</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">이름</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">검사일</th><th style="padding:4px 6px;border-bottom:1px solid var(--bdr)">검사기관</th></tr></thead><tbody>';
  results.forEach(function(r,i){
    h+='<tr style="cursor:default"><td style="padding:4px 6px;text-align:center;border-bottom:1px solid var(--bdr)">'+(i+1)+'</td><td style="padding:4px 6px;border-bottom:1px solid var(--bdr)">'+escHtml(r.pos||'')+'</td><td style="padding:4px 6px;font-weight:600;border-bottom:1px solid var(--bdr)">'+escHtml(r.name)+'</td><td style="padding:4px 6px;border-bottom:1px solid var(--bdr)">'+escHtml(r.date||'')+'</td><td style="padding:4px 6px;border-bottom:1px solid var(--bdr)">'+escHtml(r.inst||'')+'</td></tr>';
  });
  h+='</tbody></table></div>';
  res.innerHTML=h;
}
/* ── 체중 조절 희망 학생 관리 ── */
S._wtData=[];
function _wtSave(){
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
    window.electronAPI.jsonSaveCommon('weightMgmt',S._wtData).catch(function(err){console.error('[DB] weightMgmt 저장 실패:',err);});
}
function _wtLoadFromDB(){
  /* S._wtData: helpers.js _initJsonLoad → DB → S._wtData 로 비동기 로드됩니다.
   * IPC 로드가 완료된 시점이면 S._wtData 사용, 아니면 IPC를 직접 호출합니다. */
  if(Array.isArray(S._wtData)&&S._wtData.length){
    S._wtData=S._wtData;
    return;
  }
  if(window.electronAPI&&window.electronAPI.jsonLoadCommon){
    window.electronAPI.jsonLoadCommon('weightMgmt').then(function(res){
      if(res&&res.success&&res.exists&&Array.isArray(res.data)&&res.data.length){
        S._wtData=res.data;
        S._wtData=res.data;
      }
    }).catch(function(e){
      console.error('[weightMgmt] 로드 실패:', e && e.message ? e.message : e);
    });
  }
}
document.addEventListener('DOMContentLoaded',function(){_wtLoadFromDB();});
function _apWtDoSearch(){
  const inp=document.getElementById('apWtSearch');if(!inp)return;
  const acl=document.getElementById('apWtACList');if(!acl)return;
  const q=inp.value.trim();
  if(!q){acl.style.display='none';return;}
  const results=S.people.filter(function(s){return s.type==='student'&&s.name.indexOf(q)>=0;}).slice(0,10);
  if(!results.length){acl.style.display='none';return;}
  let h='';
  results.forEach(function(s){
    h+='<div data-action="_apWtSelectStudent" data-arg="'+s.id+'" data-hover="ac" style="padding:6px 10px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t1);border-bottom:1px solid var(--bdr)">'+s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+escHtml(s.name)+'</div>';
  });
  acl.innerHTML=h;acl.style.display='block';
  _pmDelegate(acl);
}
function _apWtDetailSearch(){
  const body=document.getElementById('apWtBody');if(!body)return;
  body.innerHTML=_apGradeCards('_apWtGrade');
}
function _apWtGrade(grade){
  const body=document.getElementById('apWtBody');if(!body)return;
  body.innerHTML=_apClassDiagram(grade,'_apWtClass','학년 선택','_apWtDetailSearch()');
}
function _apWtClass(grade,cls){
  const body=document.getElementById('apWtBody');if(!body)return;
  const sts=S.people.filter(function(s){return s.type==='student'&&String(s.grade)===String(grade)&&String(s.cls)===String(cls);}).sort(function(a,b){return a.num-b.num;});
  let h='<div style="margin-bottom:10px"><span data-action="_apWtGrade" data-arg="'+grade+'" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← '+grade+'학년 반 목록</span></div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+grade+'학년 '+cls+'반 — 학생을 선택하세요</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  sts.forEach(function(s){
    const enrolled=S._wtData.some(function(w){return w.studentId===s.id;});
    h+='<span data-action="_apWtSelectStudent" data-arg="'+s.id+'" data-hover="chip" data-hover-bg-restore="'+(enrolled?'rgba(6,182,212,0.08)':'var(--card)')+'" style="padding:5px 10px;border:1px solid '+(enrolled?'var(--cyan)':'var(--bdr)')+';border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:'+(enrolled?'var(--cyan)':'var(--t1)')+';background:'+(enrolled?'rgba(6,182,212,0.08)':'var(--card)')+';transition:all .15s">'+s.num+'번 '+s.name+(enrolled?' ✓':'')+'</span>';
  });
  body.innerHTML=h+'</div>';
}
function _apWtSelectStudent(id){
  const acl=document.getElementById('apWtACList');if(acl)acl.style.display='none';
  const inp=document.getElementById('apWtSearch');if(inp)inp.value='';
  const s=getStu(id);if(!s)return;
  let rec=S._wtData.find(function(w){return w.studentId===id;});
  if(!rec){rec={studentId:id,entries:[]};S._wtData.push(rec);_wtSave();}
  _apWtShowInline(id);
}
function _apWtShowInline(id){
  const body=document.getElementById('apWtBody');if(!body)return;
  const s=getStu(id);if(!s)return;
  let rec=S._wtData.find(function(w){return w.studentId===id;});
  if(!rec){rec={studentId:id,entries:[]};S._wtData.push(rec);}
  const entries=rec.entries||[];
  let h='<div style="margin-bottom:10px;display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:13px;font-weight:800;color:var(--t1)">'+s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+escHtml(s.name)+'</span>';
  if(entries.length) h+='<button data-action="_apWtOpenPopup" data-arg="'+id+'" style="padding:3px 10px;font-size:10px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">상세 보기</button>';
  h+='<button data-action="_apWtRemoveStudent" data-arg="'+id+'" style="font-size:9px;padding:2px 6px;border:1px solid var(--bdr);border-radius:4px;background:transparent;color:var(--t3);cursor:pointer;font-family:var(--f)">관리 해제</button>';
  h+='</div>';
  /* 측정 기록 입력 */
  h+='<div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:10px;flex-wrap:wrap">';
  h+='<div><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:2px">측정일</label><div style="display:flex;gap:4px;align-items:center"><input class="form-input" id="apWtDate" placeholder="날짜를 선택하세요." style="font-size:11px;width:120px;cursor:pointer" readonly data-action="_apWtOpenCal"><button class="btn btn-sm" data-action="_apWtOpenCal" style="font-size:10px">📅</button></div></div>';
  h+='<div><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:2px">키 (cm)</label><input class="form-input" id="apWtHeight" placeholder="예. 165.5" style="font-size:11px;width:80px" type="number" step="0.1"></div>';
  h+='<div><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:2px">체중 (kg)</label><input class="form-input" id="apWtWeight" placeholder="예. 72.3" style="font-size:11px;width:80px" type="number" step="0.1"></div>';
  h+='<button class="btn btn-primary btn-sm" data-action="_apWtAddEntry" data-arg="'+id+'" style="font-size:10px;height:30px">기록 추가</button>';
  h+='</div>';
  if(entries.length){
    h+='<div style="font-size:10px;color:var(--t3)">측정 '+entries.length+'회 기록됨. 상세 보기를 클릭하면 테이블과 그래프를 확인할 수 있습니다.</div>';
  } else {
    h+='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">측정 기록이 없습니다. 위에서 기록을 추가하세요.</div>';
  }
  body.innerHTML=h;
}
let _apWtCalYear=new Date().getFullYear(), _apWtCalMonth=new Date().getMonth();
function _apWtOpenPopup(id){
  const s=getStu(id);if(!s)return;
  const existing=document.getElementById('apWtPopupOv');if(existing)closeModalGracefully(existing);
  const ov=document.createElement('div');ov.id='apWtPopupOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9600;display:flex;align-items:center;justify-content:center';
  let h='<div style="background:var(--card);border-radius:12px;width:640px;max-width:94vw;max-height:90vh;box-shadow:0 8px 30px rgba(0,0,0,0.25);overflow:hidden;display:flex;flex-direction:column">';
  /* 헤더 */
  h+='<div style="padding:14px 20px;background:var(--popup-head);border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between">';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="font-size:15px;font-weight:800;color:var(--t1)">⚖️ '+s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+escHtml(s.name)+'</span>';
  h+='<button data-action="_apWtRemoveStudent" data-arg="'+id+'" style="font-size:9px;padding:2px 8px;border:1px solid var(--bdr);border-radius:4px;background:transparent;color:var(--t3);cursor:pointer;font-family:var(--f)">관리 해제</button></div>';
  h+='<button data-action="closeWtPopup" style="background:none;border:none;font-size:18px;color:var(--t3);cursor:pointer">✕</button>';
  h+='</div>';
  /* 본문 */
  h+='<div style="padding:20px;overflow-y:auto;flex:1" id="apWtPopupBody"></div>';
  h+='</div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  _pmDelegate(ov);
  _apWtRenderPopupBody(id);
}
function _apWtRenderPopupBody(id){
  const body=document.getElementById('apWtPopupBody');if(!body)return;
  const s=getStu(id);if(!s)return;
  let rec=S._wtData.find(function(w){return w.studentId===id;});
  if(!rec){rec={studentId:id,entries:[]};S._wtData.push(rec);}
  const entries=rec.entries||[];
  /* 측정 기록 입력 */
  let h='<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">';
  h+='<div><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:2px">측정일</label><div style="display:flex;gap:4px;align-items:center"><input class="form-input" id="apWtDate" placeholder="날짜를 선택하세요." style="font-size:11px;width:120px;cursor:pointer" readonly data-action="_apWtOpenCal"><button class="btn btn-sm" data-action="_apWtOpenCal" style="font-size:10px">📅</button></div></div>';
  h+='<div><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:2px">키 (cm)</label><input class="form-input" id="apWtHeight" placeholder="예. 165.5" style="font-size:11px;width:90px" type="number" step="0.1"></div>';
  h+='<div><label style="font-size:10px;font-weight:600;color:var(--t2);display:block;margin-bottom:2px">체중 (kg)</label><input class="form-input" id="apWtWeight" placeholder="예. 72.3" style="font-size:11px;width:90px" type="number" step="0.1"></div>';
  h+='<button class="btn btn-primary btn-sm" data-action="_apWtAddEntry" data-arg="'+id+'" style="font-size:10px;height:30px">기록 추가</button>';
  h+='</div>';
  /* 기록 테이블 */
  if(entries.length){
    entries.sort(function(a,b){return a.date>b.date?1:-1;});
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">측정 기록 ('+entries.length+'회)</div>';
    h+='<div style="border:1px solid var(--bdr);border-radius:8px;overflow:hidden;margin-bottom:16px"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg2)"><th style="padding:6px 10px;border-bottom:1px solid var(--bdr);text-align:center">날짜</th><th style="padding:6px 10px;border-bottom:1px solid var(--bdr);text-align:center">키(cm)</th><th style="padding:6px 10px;border-bottom:1px solid var(--bdr);text-align:center">체중(kg)</th><th style="padding:6px 10px;border-bottom:1px solid var(--bdr);text-align:center">BMI</th><th style="padding:6px 10px;border-bottom:1px solid var(--bdr);text-align:center">BMI 변화</th><th style="padding:6px 10px;border-bottom:1px solid var(--bdr);text-align:center"></th></tr></thead><tbody>';
    entries.forEach(function(e,i){
      const bmi=(e.weight/((e.height/100)*(e.height/100))).toFixed(1);
      let diff='';
      if(i>0){const prevBmi=(entries[i-1].weight/((entries[i-1].height/100)*(entries[i-1].height/100)));const change=parseFloat(bmi)-prevBmi;diff='<span style="color:'+(change<0?'#22c55e':'#ef4444')+';font-weight:700">'+(change>0?'+':'')+change.toFixed(1)+'</span>';}
      h+='<tr><td style="padding:5px 10px;border-bottom:1px solid var(--bdr);text-align:center">'+escHtml(e.date)+'</td><td style="padding:5px 10px;border-bottom:1px solid var(--bdr);text-align:center">'+e.height+'</td><td style="padding:5px 10px;border-bottom:1px solid var(--bdr);text-align:center">'+e.weight+'</td><td style="padding:5px 10px;border-bottom:1px solid var(--bdr);text-align:center;font-weight:700">'+bmi+'</td><td style="padding:5px 10px;border-bottom:1px solid var(--bdr);text-align:center">'+diff+'</td><td style="padding:5px 10px;border-bottom:1px solid var(--bdr);text-align:center"><button data-action="_apWtDelEntry" data-arg="'+id+'" data-arg2="'+i+'" data-hover="del-btn" style="font-size:10px;border:none;background:none;color:var(--t3);cursor:pointer">✕</button></td></tr>';
    });
    h+='</tbody></table></div>';
    /* BMI 추이 그래프 */
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">📊 BMI 추이 그래프</div>';
    h+='<canvas id="apWtChart" width="580" height="200" style="width:100%;max-width:580px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg)"></canvas>';
  } else {
    h+='<div style="text-align:center;padding:30px;color:var(--t3);font-size:12px">측정 기록이 없습니다. 위에서 날짜, 키, 체중을 입력하고 기록을 추가하세요.</div>';
  }
  body.innerHTML=h;
  if(entries.length>=2)_apWtDrawChart(entries);
}
function _apWtOpenCal(){
  const existing=document.getElementById('apWtCalFloat');
  if(existing){existing.remove();return;}
  const inp=document.getElementById('apWtDate');if(!inp)return;
  const rect=inp.getBoundingClientRect();
  const calH=340;
  const fl=document.createElement('div');fl.id='apWtCalFloat';
  fl.style.cssText='position:fixed;z-index:9500;';
  if(rect.bottom+calH>window.innerHeight){
    fl.style.top=Math.max(4,rect.top-calH-4)+'px';
  } else {
    fl.style.top=(rect.bottom+4)+'px';
  }
  fl.style.left=rect.left+'px';
  document.body.appendChild(fl);
  _commonCalRender(fl,_apWtCalYear,_apWtCalMonth,'_apWtCalSelect','_apWtCalNav');
  setTimeout(function(){document.addEventListener('click',_apWtCalOutside);},10);
}
function _apWtCalOutside(e){
  const fl=document.getElementById('apWtCalFloat');if(!fl)return;
  if(fl.contains(e.target))return;
  if(e.target===document.getElementById('apWtDate'))return;
  if(e.target.closest('[data-action="_apWtOpenCal"]'))return;
  fl.remove();document.removeEventListener('click',_apWtCalOutside);
}
function _apWtCalNav(delta,setMonth){
  if(setMonth!==undefined){_apWtCalMonth=setMonth;}
  else{_apWtCalMonth+=delta;if(_apWtCalMonth<0){_apWtCalMonth=11;_apWtCalYear--;}if(_apWtCalMonth>11){_apWtCalMonth=0;_apWtCalYear++;}}
  const fl=document.getElementById('apWtCalFloat');if(!fl)return;
  _commonCalRender(fl,_apWtCalYear,_apWtCalMonth,'_apWtCalSelect','_apWtCalNav');
}
function _apWtCalSelect(ds){
  document.getElementById('apWtDate').value=ds;
  const fl=document.getElementById('apWtCalFloat');if(fl)fl.remove();
  document.removeEventListener('click',_apWtCalOutside);
}
function _apWtAddEntry(id){
  const date=(document.getElementById('apWtDate')||{}).value;
  const height=parseFloat((document.getElementById('apWtHeight')||{}).value);
  const weight=parseFloat((document.getElementById('apWtWeight')||{}).value);
  if(!date){bus.emit('toast:show', {text: '측정일을 선택하세요'});return;}
  if(!height||height<50||height>250){bus.emit('toast:show', {text: '키를 올바르게 입력하세요'});return;}
  if(!weight||weight<10||weight>200){bus.emit('toast:show', {text: '체중을 올바르게 입력하세요'});return;}
  let rec=S._wtData.find(function(w){return w.studentId===id;});
  if(!rec){rec={studentId:id,entries:[]};S._wtData.push(rec);}
  rec.entries.push({date:date,height:height,weight:weight});
  _wtSave();
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='저장 중…';toast.className='global-save-toast show saving';
    setTimeout(function(){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);},300);}
  bus.emit('toast:show', {text: '측정 기록이 추가되었습니다'});
  /* 팝업이 열려있으면 팝업 갱신, 아니면 인라인 갱신 */
  if(document.getElementById('apWtPopupOv'))_apWtRenderPopupBody(id);
  else _apWtShowInline(id);
}
function _apWtDelEntry(id,idx){
  _apConfirm({ title:'🗑 측정 기록 삭제', message:'이 측정 기록을 삭제하시겠습니까?', confirmText:'삭제', cancelText:'취소', danger:true, onConfirm:function(){
    const rec=S._wtData.find(function(w){return w.studentId===id;});
    if(rec)rec.entries.splice(idx,1);
    _wtSave();
    if(document.getElementById('apWtPopupOv'))_apWtRenderPopupBody(id);
    else _apWtShowInline(id);
  }});
}
function _apWtRemoveStudent(id){
  const s=getStu(id);
  _apConfirm({ title:'체중 관리 해제', message:'<b style="color:var(--t1)">'+escHtml(s?s.name:'학생')+'</b>의 체중 관리를 해제하시겠습니까?<br><span style="font-size:11px;color:var(--t3)">측정 기록도 삭제됩니다.</span>', confirmText:'해제', cancelText:'취소', danger:true, onConfirm:function(){
    S._wtData=S._wtData.filter(function(w){return w.studentId!==id;});
    _wtSave();
    const popup=document.getElementById('apWtPopupOv');if(popup)closeModalGracefully(popup);
    const body=document.getElementById('apWtBody');if(body)body.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">학생을 검색하여 선택하세요.</div>';
    bus.emit('toast:show', {text: '관리 해제됨'});
  }});
}
function _apWtDrawChart(entries){
  const canvas=document.getElementById('apWtChart');if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const bmis=entries.map(function(e){return e.weight/((e.height/100)*(e.height/100));});
  const labels=entries.map(function(e){return e.date.slice(5);});
  let minB=Math.floor(Math.min.apply(null,bmis))-1, maxB=Math.ceil(Math.max.apply(null,bmis))+1;
  if(maxB-minB<4){minB-=1;maxB+=1;}
  const padL=40, padR=10, padT=15, padB=30;
  const gW=W-padL-padR, gH=H-padT-padB;
  /* 그리드 */
  ctx.strokeStyle='rgba(150,150,150,0.15)';ctx.lineWidth=0.5;
  for(let v=minB;v<=maxB;v++){
    const y=padT+gH-(v-minB)/(maxB-minB)*gH;
    ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
    ctx.fillStyle='rgba(150,150,150,0.6)';ctx.font='9px sans-serif';ctx.textAlign='right';
    ctx.fillText(v,padL-4,y+3);
  }
  /* 라벨 */
  ctx.fillStyle='rgba(150,150,150,0.6)';ctx.font='8px sans-serif';ctx.textAlign='center';
  bmis.forEach(function(_,i){
    const x=padL+(i/(bmis.length-1||1))*gW;
    ctx.fillText(labels[i],x,H-5);
  });
  /* 선 + 점 */
  ctx.strokeStyle='#06b6d4';ctx.lineWidth=2;ctx.beginPath();
  bmis.forEach(function(b,i){
    const x=padL+(i/(bmis.length-1||1))*gW;
    const y=padT+gH-(b-minB)/(maxB-minB)*gH;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  ctx.stroke();
  bmis.forEach(function(b,i){
    const x=padL+(i/(bmis.length-1||1))*gW;
    const y=padT+gH-(b-minB)/(maxB-minB)*gH;
    ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fillStyle='#06b6d4';ctx.fill();
    ctx.fillStyle='var(--t1,#333)';ctx.font='bold 9px sans-serif';ctx.textAlign='center';
    ctx.fillText(b.toFixed(1),x,y-8);
  });
}
function _apWtDrawChartOn(canvasId,entries,color){
  const canvas=document.getElementById(canvasId);if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  if(entries.length<2)return;
  entries.sort(function(a,b){return a.date>b.date?1:-1;});
  const bmis=entries.map(function(e){return e.weight/((e.height/100)*(e.height/100));});
  const labels=entries.map(function(e){return e.date.slice(5);});
  let minB=Math.floor(Math.min.apply(null,bmis))-1, maxB=Math.ceil(Math.max.apply(null,bmis))+1;
  if(maxB-minB<4){minB-=1;maxB+=1;}
  const padL=40, padR=10, padT=15, padB=25;
  const gW=W-padL-padR, gH=H-padT-padB;
  ctx.strokeStyle='rgba(150,150,150,0.15)';ctx.lineWidth=0.5;
  for(let v=minB;v<=maxB;v++){
    const y=padT+gH-(v-minB)/(maxB-minB)*gH;
    ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
    ctx.fillStyle='rgba(150,150,150,0.6)';ctx.font='9px sans-serif';ctx.textAlign='right';
    ctx.fillText(v,padL-4,y+3);
  }
  ctx.fillStyle='rgba(150,150,150,0.6)';ctx.font='8px sans-serif';ctx.textAlign='center';
  bmis.forEach(function(_,i){const x=padL+(i/(bmis.length-1||1))*gW;ctx.fillText(labels[i],x,H-4);});
  ctx.strokeStyle=color||'#06b6d4';ctx.lineWidth=2;ctx.beginPath();
  bmis.forEach(function(b,i){const x=padL+(i/(bmis.length-1||1))*gW;const y=padT+gH-(b-minB)/(maxB-minB)*gH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
  ctx.stroke();
  bmis.forEach(function(b,i){const x=padL+(i/(bmis.length-1||1))*gW;const y=padT+gH-(b-minB)/(maxB-minB)*gH;
    ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=color||'#06b6d4';ctx.fill();
    ctx.fillStyle='#333';ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.fillText(b.toFixed(1),x,y-7);
  });
}
function _apWtAllCharts(){
  const enrolled=S._wtData.filter(function(w){return w.entries&&w.entries.length>0;});
  if(!enrolled.length){bus.emit('toast:show', {text: '등록된 학생이 없거나 측정 기록이 없습니다'});return;}
  const existing=document.getElementById('apWtAllOv');if(existing)closeModalGracefully(existing);
  const ov=document.createElement('div');ov.id='apWtAllOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9600;display:flex;align-items:center;justify-content:center';
  const colors=['#06b6d4','#8b5cf6','#f59e0b','#ef4444','#22c55e','#ec4899','#3b82f6','#14b8a6','#f97316','#6366f1'];
  let h='<div style="background:var(--card);border-radius:12px;width:800px;max-width:96vw;max-height:90vh;box-shadow:0 8px 30px rgba(0,0,0,0.25);overflow:hidden;display:flex;flex-direction:column">';
  h+='<div style="padding:14px 20px;background:var(--popup-head);border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between">';
  h+='<span style="font-size:15px;font-weight:800;color:var(--t1)">📊 전체 학생 BMI 추이 차트</span>';
  h+='<div style="display:flex;gap:6px;align-items:center">';
  h+='<button data-action="_apWtDownloadAllCharts" style="padding:4px 12px;font-size:10px;font-weight:700;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">📥 이미지 다운로드</button>';
  h+='<button data-action="closeWtAllOv" style="background:none;border:none;font-size:18px;color:var(--t3);cursor:pointer">✕</button>';
  h+='</div></div>';
  h+='<div style="padding:20px;overflow-y:auto;flex:1" id="apWtAllBody">';
  enrolled.forEach(function(rec,ri){
    const s=getStu(rec.studentId);if(!s)return;
    const entries=rec.entries.slice().sort(function(a,b){return a.date>b.date?1:-1;});
    const lastBmi=(entries[entries.length-1].weight/((entries[entries.length-1].height/100)*(entries[entries.length-1].height/100))).toFixed(1);
    const firstBmi=(entries[0].weight/((entries[0].height/100)*(entries[0].height/100))).toFixed(1);
    const change=(parseFloat(lastBmi)-parseFloat(firstBmi)).toFixed(1);
    const col=colors[ri%colors.length];
    h+='<div style="margin-bottom:16px;padding:12px;border:1px solid var(--bdr);border-radius:8px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
    h+='<span style="width:10px;height:10px;border-radius:50%;background:'+col+';flex-shrink:0"></span>';
    h+='<span style="font-size:12px;font-weight:800;color:var(--t1)">'+s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+escHtml(s.name)+'</span>';
    h+='<span style="font-size:10px;color:var(--t3)">측정 '+entries.length+'회</span>';
    h+='<span style="font-size:10px;font-weight:700;color:'+(parseFloat(change)<=0?'#22c55e':'#ef4444')+'">BMI '+firstBmi+' → '+lastBmi+' ('+(parseFloat(change)>0?'+':'')+change+')</span>';
    h+='</div>';
    h+='<canvas id="apWtAllChart'+ri+'" width="740" height="140" style="width:100%;max-width:740px;border:1px solid var(--bdr);border-radius:6px;background:#fff"></canvas>';
    h+='</div>';
  });
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  _pmDelegate(ov);
  /* 차트 그리기 */
  enrolled.forEach(function(rec,ri){
    const entries=rec.entries.slice().sort(function(a,b){return a.date>b.date?1:-1;});
    _apWtDrawChartOn('apWtAllChart'+ri,entries,colors[ri%colors.length]);
  });
}
function _apWtDownloadAllCharts(){
  const body=document.getElementById('apWtAllBody');if(!body)return;
  const canvases=body.querySelectorAll('canvas');
  /* 모든 차트를 하나의 큰 캔버스로 합침 */
  let totalH=0;canvases.forEach(function(c){totalH+=c.height+60;});
  const mergeCanvas=document.createElement('canvas');
  mergeCanvas.width=740;mergeCanvas.height=totalH+40;
  const mctx=mergeCanvas.getContext('2d');
  mctx.fillStyle='#ffffff';mctx.fillRect(0,0,mergeCanvas.width,mergeCanvas.height);
  mctx.fillStyle='#333';mctx.font='bold 14px sans-serif';mctx.textAlign='center';
  mctx.fillText('체중 조절 희망 학생 BMI 추이 차트',370,24);
  let yOff=40;
  const enrolled=S._wtData.filter(function(w){return w.entries&&w.entries.length>0;});
  enrolled.forEach(function(rec,ri){
    const s=getStu(rec.studentId);
    if(s){
      mctx.fillStyle='#333';mctx.font='bold 11px sans-serif';mctx.textAlign='left';
      mctx.fillText(s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+s.name,10,yOff+12);
      yOff+=20;
    }
    if(canvases[ri]){mctx.drawImage(canvases[ri],0,yOff);yOff+=canvases[ri].height+40;}
  });
  const link=document.createElement('a');
  link.download='체중조절_BMI추이.png';
  link.href=mergeCanvas.toDataURL('image/png');
  link.click();
}
/* ── 인원 삭제 (인라인) ── */
function _apDelType(type){
  _apActivePanel='delete';
  const body=document.getElementById('apDelBody');if(!body)return;
  if(type==='staff'){
    const staffList=S.people.filter(function(s){return s.type==='staff';});
    if(!staffList.length){body.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:20px">등록된 교직원이 없습니다.</div>';return;}
    let h='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">삭제할 교직원을 선택하세요</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    staffList.forEach(function(s){
      h+='<span data-action="_apDelConfirm" data-arg="'+s.id+'" data-hover="del-chip" style="padding:5px 10px;border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t1);background:var(--card);transition:all .15s">'+(s.position||'교직원')+' '+s.name+'</span>';
    });body.innerHTML=h+'</div>';
  } else {
    body.innerHTML=_apGradeCards('_apDelGrade');
  }
}
function _apDelGrade(grade){
  const body=document.getElementById('apDelBody');if(!body)return;
  body.innerHTML=_apClassDiagram(grade,'_apDelClass','학년 선택','_apDelType(\'student\')');
}
function _apDelClass(grade,cls){
  const body=document.getElementById('apDelBody');if(!body)return;
  const sts=S.people.filter(function(s){return s.type==='student'&&String(s.grade)===String(grade)&&String(s.cls)===String(cls);}).sort(function(a,b){return a.num-b.num;});
  let h='<div style="margin-bottom:10px"><span data-action="_apDelGrade" data-arg="'+grade+'" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← '+grade+'학년 반 목록</span></div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">'+grade+'학년 '+cls+'반 — 삭제할 학생을 선택하세요</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  sts.forEach(function(s){
    h+='<span data-action="_apDelConfirm" data-arg="'+s.id+'" data-hover="del-chip" style="padding:5px 10px;border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:var(--t1);background:var(--card);transition:all .15s">'
      +s.num+'번 '+s.name+'</span>';
  });body.innerHTML=h+'</div>';
}
function _apDelConfirm(id){
  const s=getStu(id);if(!s)return;
  const desc=s.type==='staff'?((s.position||'교직원')+' '+s.name):(s.grade+'-'+s.cls+' '+s.num+'번 '+s.name);
  _apConfirm({ title:'🗑 삭제', message:'<b style="color:var(--t1)">'+escHtml(desc)+'</b> 을(를) 삭제하시겠습니까?', confirmText:'삭제', cancelText:'취소', danger:true, onConfirm:function(){
    S.people=S.people.filter(function(x){return x.id!==id;});
    saveStudents();
    saveData();bus.emit('render:daily');bus.emit('render:dashboard');
    bus.emit('toast:show', {text: desc+' 삭제 완료'});
    if(s.type==='staff')_apDelType('staff');else _apDelType('student');
  }});
}
function _closeApModal(ov){
  if(!ov)return;
  _apActivePanel=null;
  ov.style.background='rgba(0,0,0,0)';
  const c=ov.firstChild;if(c){c.style.transform='scale(0.92) translateY(16px)';c.style.opacity='0';}
  setTimeout(function(){if(ov.parentNode)ov.remove();resetAddPersonModal();},300);
}
function setPersonType(type){
  const sf=document.getElementById('apStudentFields');
  const stf=document.getElementById('apStaffFields');
  const cf=document.getElementById('apCareFields');
  if(sf)sf.style.display=type==='student'?'block':'none';
  if(stf)stf.style.display=type==='staff'?'block':'none';
  if(cf)cf.style.display=type==='care'?'block':'none';
  const hint=document.getElementById('apStudentHint');
  if(hint)hint.style.display=type==='student'?'block':'none';
  if(type==='care')resetCareSelection();
  const btnBase='text-align:left;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr)';
  const btnActive='text-align:left;background:var(--cbg);color:var(--cyan);border:1px solid var(--cyan)';
  const bs=document.getElementById('apStudent');const bst=document.getElementById('apStaff');const bc=document.getElementById('apCare');
  if(bs)bs.style.cssText=type==='student'?btnActive:btnBase;
  if(bst)bst.style.cssText=type==='staff'?btnActive:btnBase;
  if(bc)bc.style.cssText=type==='care'?btnActive:btnBase;
}
/* 입력 자동 포맷팅 — NEIS 표준 형식 YYYY.MM.DD. 로 변환 */
function apBirthFormat(input, e){
  /* 삭제(백스페이스/Delete) 중에는 끝 점 자동삽입을 생략 — 완성된 날짜(YYYY.MM.DD.)의 끝 점이
   *  매번 재삽입돼 백스페이스가 안 먹던 문제 해결. 타이핑으로 8자리 완성 시에만 끝 점 부착. (사용자 보고 2026-06-17) */
  const _del = !!(e && (e.inputType==='deleteContentBackward'||e.inputType==='deleteContentForward'));
  const digits=input.value.replace(/\D/g,'').substr(0,8);
  if(digits.length<=4){input.value=digits;}
  else if(digits.length<=6){input.value=digits.substr(0,4)+'.'+digits.substr(4);}
  else if(digits.length<8){input.value=digits.substr(0,4)+'.'+digits.substr(4,2)+'.'+digits.substr(6);}
  else{input.value=digits.substr(0,4)+'.'+digits.substr(4,2)+'.'+digits.substr(6,2)+(_del?'':'.');}
}
let _addPersonLastAt=0;
function addPerson(){
  /* 중복 호출 방어 — 같은 사람 데이터가 짧은 시간 내 두 번 등록되어 토스트도 두 번 뜨는 현상 차단 */
  const _now=Date.now();
  if(_now-_addPersonLastAt<600)return;
  _addPersonLastAt=_now;
  const isStaff=_apActivePanel==='staff'||(document.getElementById('apStaffFields')&&document.getElementById('apStaffFields').style.display!=='none');
  const isCare=_apActivePanel==='care'||(document.getElementById('apCareFields')&&document.getElementById('apCareFields').style.display!=='none');
  const isStudent=_apActivePanel==='student'||(document.getElementById('apStudentFields')&&document.getElementById('apStudentFields').style.display!=='none');
  if(!isStudent&&!isStaff&&!isCare){alert('유형 버튼을 먼저 선택하세요.');return;}
  if(isCare){
    if(!apCareStudentId){alert('학생 검색으로 학생을 먼저 선택하세요.');return;}
    const stu=getStu(apCareStudentId);
    if(!stu||stu.type!=='student'){alert('학생을 다시 선택하세요.');return;}
    return _apCareSave(apCareStudentId);
  } else if(isStaff){
    const pos=document.getElementById('apPosition').value.trim();
    const name=document.getElementById('apStaffName').value.trim();
    if(!name){bus.emit('toast:show',{text:'이름을 입력하세요.'});return;}
    if(!pos){bus.emit('toast:show',{text:'직위는 필수 항목입니다. 직위를 입력하세요.'});return;}
    const gender=(document.getElementById('apStaffGender')||{}).value||'';
    const familyContact=(document.getElementById('apStaffFamily')||{}).value.trim()||'';
    const familyPhone=(document.getElementById('apStaffFamilyPhone')||{}).value.trim()||'';
    const _newStaff={id:S.people.length+100,uid:S.people.length+100,name,grade:0,cls:0,num:0,gender:gender,status:'normal',condition:'',type:'staff',position:pos,familyContact:familyContact,familyPhone:familyPhone};
    S.people.push(_newStaff);
    /* ★ DB(staff 테이블) 저장 — 빠지면 재시작 후 교직원이 사라져 일지에서 "현재 재학 중인 정보가 없습니다"로 뜬다.
       기존 버그: 개별 추가 교직원은 S.people(메모리)에만 있고 staffUpsert 미호출이라 DB 미저장.
       (명단 업로드·교직원 편집은 정상이라 등록 방법에 따라 증상이 갈렸음.) 학생 분기와 대칭으로 수정. (2026-06-25) */
    if(window.electronAPI&&window.electronAPI.staffUpsert){
      window.electronAPI.staffUpsert({
        name:name, position:pos, gender:gender,
        familyRelation:familyContact, familyPhone:familyPhone, is_active:1,
      }, String(_academicYear())).then(function(r){
        if(r&&r.success&&r.uid){
          _newStaff.uid=r.uid; _newStaff.id=r.uid;
          bus.emit('render:daily'); bus.emit('render:dashboard');
          if(document.getElementById('apStaffInline'))_apStaffInlineRender();
        } else if(r&&!r.success){
          const idx=S.people.findIndex(function(p){return p===_newStaff;});
          if(idx>=0)S.people.splice(idx,1);
          bus.emit('toast:show',{text:'교직원 저장 실패: '+((r&&r.error)||'알 수 없는 오류')});
        }
      }).catch(function(e){ console.error('[DB] staff 개별 추가 저장 실패:',e); });
    }
  } else {
    /* 학생 개별 등록 — 캐스케이드 드롭다운(학교급/학과/학년/반) + 번호/이름/성별/생년월일/보호자 */
    const level=(document.getElementById('apLevel')||{}).value||'';
    const dept=(document.getElementById('apDept')||{}).value||'';
    const g=+(document.getElementById('apGrade')||{}).value;
    /* 반: 한글 학급명(가람·나래) 지원 + 끝 '반' 접미사 제거 ("나래반"→"나래") (사용자 요청 2026-05-28). */
    const c=normalizeClassInput((document.getElementById('apClass')||{}).value);
    const n=+(document.getElementById('apNumber')||{}).value;
    const name=((document.getElementById('apName')||{}).value||'').trim();
    const gender=(document.getElementById('apGender')||{}).value||'';
    const birth=((document.getElementById('apBirth')||{}).value||'').trim();
    const guardianType=((document.getElementById('apGuardianType')||{}).value||'').trim();
    const guardianContact=((document.getElementById('apGuardianContact')||{}).value||'').trim();
    /* ── 자리 점유 검사를 먼저 (사용자 요청 2026-06-14) ──
       자리(학교급+학과+학년+반+번호)는 당해년도 고유값이라 성별 없이 학년·반·번호(+학교급·학과)만으로
       등록 가능 여부가 결정된다. 성별까지 입력하게 만들지 말고, 자리 정보가 갖춰지면 즉시 점유 여부를 판정한다.
       같은 자리에 다른 이름을 넣는 것은 실수로 보고 거부. 같은 이름이면 동일인 재입력이므로 통과. */
    if(g && c && n){
      const _seatTaken=S.people.find(function(p){ return p && p.type==='student' && p.is_enrolled!==0
        && String(p.level||'')===String(level) && String(p.department||'')===String(dept)
        && Number(p.grade)===g && compareClass(p.cls,c)===0 && Number(p.num)===n; });
      if(_seatTaken && (_seatTaken.name||'').trim()!==name){
        /* 학과 등록 학교(select 활성)면 '학과·학년·반·번호', 아니면 '학년·반·번호'로 메시지·고유키 표기 (사용자 확정 2026-06-15) */
        const _ds=document.getElementById('apDept');
        const _deptSchool=!!(_ds && !_ds.disabled);
        const _loc=(_deptSchool&&dept?dept+' ':'')+g+'학년 '+c+'반 '+n+'번';
        const _keyDesc=_deptSchool?'같은 학과·학년·반·번호':'같은 학년·반·번호';
        const _titleKey=_deptSchool?'학과·학년·반·번호':'학년·반·번호';
        appConfirmModal(
          _loc+' <b>'+escHtml(_seatTaken.name)+'</b> 학생이 이미 있습니다.<br><span style="font-size:11px;color:var(--t3)">'+_keyDesc+'는 한 학생에게만 부여됩니다. 입력 내용을 확인해 주세요.</span>',
          '<span style="color:#f59e0b">⚠️</span> 이 학생의 '+_titleKey+'는 이미 점유중입니다!',
          { okOnly:true, okLabel:'확인', okBg:'rgba(245,158,11,0.12)', okBorder:'rgba(245,158,11,0.4)', okColor:'#d97706' }
        );
        return;
      }
    }
    /* 필수 입력 검증 — 학교급·학년·반·번호·이름 (항상). 학과는 학과 등록 학교만. (사용자 확정 2026-06-15)
       ·학교급: 항상 필수. 단일 학교급 학교는 위에서 자동 선택되므로 통과. 고를 옵션이 있을 때만 검사.
       ·학과: select 가 활성(학과 등록 학교)일 때만 필수. disabled(학과 없는 학교)면 비필수 — 옛 버그:
              학과 없는 학교도 select 가 화면에 보여(offsetParent) 학과 필수로 막히던 문제 수정.
       ·성별: 시스템상 비필수(사용자 안내엔 '필수'로 표기). 검증에서 제외.
       유치원(원아)은 번호 제외. ※ 점유 검사를 먼저 통과한 뒤 실행. */
    {
      const _miss=[];
      const _lvSel=document.getElementById('apLevel');
      if(_lvSel && _lvSel.options.length>1 && !level) _miss.push('학교급');
      const _deptSel=document.getElementById('apDept');
      if(_deptSel && !_deptSel.disabled && !dept) _miss.push('학과');
      if(!g) _miss.push(isKinder()?'나이':'학년');
      if(!c) _miss.push('반');
      if(!isKinder() && !n) _miss.push('번호');
      if(!name) _miss.push('이름');
      if(_miss.length){
        appConfirmModal('필수 입력 항목이 누락되었습니다.<br>누락 항목: <b style="color:#d97706">'+escHtml(_miss.join(', '))+'</b>','필수 항목 누락',{okOnly:true,okLabel:'확인',okBg:'rgba(245,158,11,0.12)',okBorder:'rgba(245,158,11,0.4)',okColor:'#d97706'});
        return;
      }
    }
    /* DB 우선 저장 — studentsUpsert 가 있으면 즉시 DB 에 반영, 그 다음 S.people 동기화.
     * 학년도(S.calYear) 두 번째 인자 필수 — 누락 시 학년도별 students_info 행이 잘못된 학년으로
     * 들어가 다음 조회에서 누락될 수 있음. */
    const _newId=S.people.length+100;
    const _newStu={id:_newId,uid:_newId,name:name,grade:g,cls:c,num:n,gender:gender,birth:birth,status:'normal',condition:'',type:'student',level:level,department:dept,guardianType:guardianType,guardianContact:guardianContact};
    if(window.electronAPI&&window.electronAPI.studentsUpsert){
      window.electronAPI.studentsUpsert({
        name:name, grade:g, class_num:c, student_num:n,
        gender:gender, birth_date:birth,
        guardian_type:guardianType, guardian_contact:guardianContact,
        level:level, department:dept,
      }, String(_academicYear())).then(function(r){
        if(r&&r.success&&r.uid){
          _newStu.uid=r.uid;_newStu.id=r.uid;
          /* DB 정상 반영 — 화면 재렌더링으로 새 학생 즉시 가시화 */
          bus.emit('render:daily');bus.emit('render:dashboard');
          /* 아래쪽 전체 명단도 갱신 — 실제 uid 가 행 data-arg 에 박히도록 성공 콜백에서 재렌더 */
          if(document.getElementById('apStuInline'))_apStuInlineRender();
        } else if(r&&!r.success){
          /* DB 저장 실패 — S.people 에 추가된 임시 객체 롤백 + 사용자 알림 */
          const idx=S.people.findIndex(function(p){return p===_newStu;});
          if(idx>=0)S.people.splice(idx,1);
          alert('DB 저장 실패: '+(r.error||'알 수 없는 오류'));
        }
      }).catch(function(err){
        console.error('[DB] student 저장 실패:',err);
        const idx=S.people.findIndex(function(p){return p===_newStu;});
        if(idx>=0)S.people.splice(idx,1);
        alert('DB 저장 오류: '+err.message);
      });
    }
    S.people.push(_newStu);
  }
  saveData();
  bus.emit('render:daily');
  bus.emit('render:dashboard');
  /* 인원 데이터 관리 팝업 자체는 닫지 않음 — 연속 등록 가능하도록 폼만 초기화.
   * 사용자 요청: 한 명 등록 후 다음 사람 바로 등록할 수 있어야 함. */
  if(isStaff){
    ['apPosition','apStaffName','apStaffGender','apStaffFamily','apStaffFamilyPhone'].forEach(function(id){
      const el=document.getElementById(id);if(el)el.value='';
    });
    /* 아래쪽 전체 명단 즉시 반영 (수정/삭제와 동일하게 add 도 갱신) */
    if(document.getElementById('apStaffInline'))_apStaffInlineRender();
    const _focus=document.getElementById('apPosition');if(_focus)_focus.focus();
  } else if(isStudent){
    /* 학년/반/학교급/학과는 유지(연속 등록 시 같은 반인 경우가 많음), 번호·이름·생년월일·보호자만 초기화 */
    ['apNumber','apName','apGender','apBirth','apGuardianType','apGuardianContact'].forEach(function(id){
      const el=document.getElementById(id);if(el)el.value='';
    });
    /* 번호 자동 증가 — 직전 번호 + 1 */
    const _numEl=document.getElementById('apNumber');
    if(_numEl){
      const _g=+(document.getElementById('apGrade')||{}).value;
      /* 반: 숫자/한글 모두 — 문자열 기준 비교로 한글 반(가람)도 같은 반 학생 번호 자동 제안 (사용자 요청 2026-05-28). */
      const _cRaw=((document.getElementById('apClass')||{}).value||'').trim();
      if(_g&&_cRaw){
        const _maxNum=S.people.filter(function(p){return p.type==='student'&&+p.grade===_g&&String(p.cls)===_cRaw;})
          .reduce(function(m,p){return Math.max(m,+p.num||0);},0);
        _numEl.value=_maxNum+1;
      }
    }
    /* 아래쪽 전체 명단 즉시 반영 — DB 비동기 콜백과 별개로 동기 push 분도 바로 그려줌
     * (성공 콜백에서 실제 uid 로 한 번 더 재렌더되어 data-arg 보정됨) */
    if(document.getElementById('apStuInline'))_apStuInlineRender();
    const _focus=document.getElementById('apName');if(_focus)_focus.focus();
  } else if(isCare){
    /* 요보호는 학생 검색부터 다시 — 입력 필드만 비우면 됨 */
    ['apCareReason','apCareMemo'].forEach(function(id){
      const el=document.getElementById(id);if(el)el.value='';
    });
    /* 요보호 등록 시 아래쪽 요보호 명단 즉시 반영 */
    if(document.getElementById('apCareInline'))_apCareInlineRender();
  }
  resetAddPersonModal();
  bus.emit('toast:show', {text: '추가되었습니다.'});
}

/* ── 학생 개별 삭제 ── */
function _apStuDelete(id){
  const s=getStu(id);if(!s)return;
  _apConfirm({
    title:'🗑 학생 삭제',
    message:'<b style="color:var(--t1)">'+escHtml(s.name||'')+'</b> 학생을 삭제하시겠습니까?<br><span style="font-size:11px;color:var(--t3)">보건일지 기록은 그대로 유지됩니다.</span>',
    confirmText:'삭제', cancelText:'취소', danger:true,
    onConfirm:function(){ _apStuDeleteConfirmed(id, s); }
  });
}
function _apStuDeleteConfirmed(id, s){
  if(window.electronAPI&&window.electronAPI.studentsDelete){
    window.electronAPI.studentsDelete(id).then(function(r){
      if(r&&r.success){
        /* DB 재조회 — S.people(활성) 에서 빠지고 S.leavers(명단 이탈) 로 옮겨져야
         * 보건일지 행 렌더 시 이름이 계속 보임 (getStu 의 leavers fallback 작동). */
        const _doReload = (typeof _reloadStudentsFromDB==='function') ? _reloadStudentsFromDB() : Promise.resolve();
        _doReload.then(function(){
          bus.emit('toast:show', {text: s.name+' 학생이 삭제되었습니다'});
          bus.emit('render:daily');
          bus.emit('render:calendar');
          bus.emit('render:sidebar');
          bus.emit('render:dashboard');
          _apRenderPanel('student');
        });
      } else {bus.emit('toast:show', {text: '삭제 실패: '+(r&&r.error||'')});}
    });
  } else {
    /* 프론트엔드 전용 삭제 */
    const idx=S.people.findIndex(function(st){return st.id===id;});
    if(idx!==-1)S.people.splice(idx,1);
    saveData();bus.emit('render:daily');
    bus.emit('toast:show', {text: s.name+' 학생이 삭제되었습니다'});
    _apRenderPanel('student');
  }
}

/* ── 명단 삭제 (보건기록은 유지) ── */
function _apBulkDeleteStudents(){
  const cnt=S.people.filter(function(s){return s.type==='student';}).length;
  if(!cnt){bus.emit('toast:show', {text: '삭제할 학생이 없습니다'});return;}
  /* 확인은 openBulkDeleteConfirm 자체 모달이 담당 — 네이티브 confirm() 제거(Electron 포커스 버그 회피, 2026-06-08) */
  if(typeof openBulkDeleteConfirm==='function'){openBulkDeleteConfirm('student');return;}
  if(!confirm('학생 명단 '+cnt+'명을 삭제하시겠습니까?\n\n※ 보건일지 방문 기록, 응급처치, 감염병 기록은 삭제되지 않습니다.'))return;
  /* 폴백: 프론트엔드에서 직접 삭제 */
  S.people=S.people.filter(function(s){return s.type!=='student';});
  S.people=S.people;
  saveData();
  bus.emit('toast:show', {text: '학생 명단이 삭제되었습니다.'});
  _apStuBulk();/* 업로드 영역 활성화하여 다시 렌더 */
}
function _apBulkDeleteStaff(){
  const cnt=S.people.filter(function(s){return s.type==='staff';}).length;
  if(!cnt){bus.emit('toast:show', {text: '삭제할 교직원이 없습니다'});return;}
  /* 확인은 openBulkDeleteConfirm 자체 모달이 담당 — 네이티브 confirm() 제거(Electron 포커스 버그 회피, 2026-06-08) */
  if(typeof openBulkDeleteConfirm==='function'){openBulkDeleteConfirm('staff');return;}
  if(!confirm('교직원 명단 '+cnt+'명을 삭제하시겠습니까?\n\n※ 보건일지 방문 기록은 삭제되지 않습니다.'))return;
  S.people=S.people.filter(function(s){return s.type!=='staff';});
  S.people=S.people;
  saveData();
  bus.emit('toast:show', {text: '교직원 명단이 삭제되었습니다.'});
  _apStaffBulk();
}

/* ── 교직원 전체 일괄 등록 ── */
function _apStaffBulk(){
  const body=document.getElementById('apStaffBody');if(!body)return;
  let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">📥 교직원 전체 일괄 등록</div>';
  h+='<div style="margin-bottom:8px"><button class="btn btn-primary btn-sm" data-action="downloadOptimizedStaffTemplate">📥 최적화 양식 다운로드</button></div>';
  h+='<p style="font-size:10px;color:var(--t3);margin-bottom:8px">파일을 드래그앤드랍하거나 영역을 더블클릭하여 업로드하세요. <b>기존 명단은 유지</b>되며, 같은 인원은 갱신·새 인원은 추가됩니다(변동 건만 올려도 됩니다). <b>삭제는 별도로 해야 합니다.</b> 직위는 다음 년도가 되었을 때 전년도 보건실 방문 기록 매칭을 용이하게 하기 위해 <b>교장, 교감, 행정실장, 교원, 직원</b> 이렇게 다섯 가지로 단순화하시기 바랍니다.</p>';
  h+='<div class="upload-area pm-upload-area" tabindex="0" style="min-height:82px;outline:none;cursor:pointer" data-file-target="apStaffBulkFile" data-drop-handler="handleStaffFile">📁 파일을 여기로 드래그하거나 클릭하여 선택</div>';
  h+='<input type="file" id="apStaffBulkFile" accept=".xlsx,.xls" style="display:none" class="pm-file-input" data-change-handler="handleStaffFile">';
  h+='<div id="staffUploadMsg" style="display:none;margin-top:6px;font-size:11px;padding:6px 10px;border-radius:5px"></div>';
  h+='<div id="staffValidationArea" style="display:none;margin-top:8px"></div>';
  body.innerHTML=h;
  _pmBindUpload(body);
}

/* ── 학생 전체 일괄 등록 ── */
function _apStuBulk(){
  const body=document.getElementById('apStuBody');if(!body)return;
  let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">📥 학생 전체 일괄 등록</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">';
  h+='<button class="btn btn-primary btn-sm" data-action="downloadOptimizedStudentTemplate">📥 최적화 양식 다운로드</button>';
  h+='</div>';
  h+='<p style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:4px">반드시 위의 최적화 양식을 다운로드하여 사용해 주세요. 임의로 만든 파일은 업로드할 수 없습니다.</p>';
  h+='<p style="font-size:10px;color:var(--t3);margin-bottom:8px">파일을 드래그앤드랍하거나 영역을 더블클릭하여 업로드하세요. <b>기존 명단은 유지</b>되며, 같은 인원은 갱신·새 인원은 추가됩니다(변동 건만 올려도 됩니다). 파일에 없는 기존 인원은 보존되며, 명단을 완전히 새로 시작할 때만 별도로 \'기존 명단 삭제\'를 사용하세요.</p>';
  h+='<div class="upload-area pm-upload-area" id="apStuBulkUpload" tabindex="0" style="min-height:82px;outline:none;cursor:pointer" data-file-target="apStuBulkFile" data-drop-handler="handleStudentFile" data-paste-handler="handleStudentUploadPaste">📁 파일을 여기로 드래그하거나 클릭하여 선택</div>';
  h+='<input type="file" id="apStuBulkFile" accept=".xlsx,.xls" style="display:none" class="pm-file-input" data-change-handler="handleStudentFile">';
  h+='<div id="studentUploadMsg" style="display:none;margin-top:6px;font-size:11px;padding:6px 10px;border-radius:5px"></div>';
  /* 미매칭 배너 host 는 패널 레벨(apStuUnmatched, _apRenderPanel)로 옮김 — 여기선 중복 ID 방지 위해 두지 않음 */
  h+='<div id="studentValidationArea" style="display:none;margin-top:8px;border:1px solid var(--bdr);border-radius:8px;padding:12px;max-height:300px;overflow-y:auto;scrollbar-width:thin;background:var(--bg2)"></div>';
  body.innerHTML=h;
  _pmBindUpload(body);
  _apStuRenderUnmatched();
}

/* ── 요보호 전체 일괄 등록 ── */
function _apCareBulk(){
  const body=document.getElementById('apCareBody');if(!body)return;
  let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">📥 요보호 & 미세먼지 기저질환 학생 전체 일괄 등록</div>';
  h+='<p style="font-size:10.5px;color:var(--t3);margin-bottom:8px;line-height:1.7">양식의 <b>학년·반·번호·이름</b> 열에 학생 정보를 채우고, 해당하는 열에 요보호 질환명·미세먼지 기저질환명을 기입하세요.<br><b>학년+반+번호+이름</b>으로 학생을 매칭합니다.<br><b style="color:#dc2626">⚠ 다운로드한 양식의 1행(머리글)은 절대로 변경하면 안 됩니다.</b></p>';
  h+='<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
  h+='<button class="btn btn-primary btn-sm" data-action="downloadOptimizedCareTemplate">📥 최적화 양식 다운로드</button>';
  h+='</div>';
  h+='<div class="upload-area pm-upload-area" id="apCareBulkUpload" tabindex="0" style="min-height:82px;outline:none" data-file-target="apCareBulkFile" data-drop-handler="_apCareBulkProcess">📁 요보호·미세먼지 기저질환 학생 명단 파일을 드래그하거나 클릭하여 업로드</div>';
  h+='<input type="file" id="apCareBulkFile" accept=".xlsx,.xls,.csv" style="display:none" class="pm-file-input" data-change-handler="_apCareBulkProcess">';
  h+='<div id="apCareBulkMsg" style="margin-top:8px"></div>';
  h+='<div id="careValidationArea" style="display:none;margin-top:8px;border:1px solid var(--bdr);border-radius:8px;padding:12px;max-height:320px;overflow-y:auto;scrollbar-width:thin;background:var(--bg2)"></div>';
  body.innerHTML=h;
  _pmBindUpload(body);
}

/* 요보호 & 미세먼지 기저질환 학생 명단 데이터 수집 (export용 공용) */
function _apCareCollectRows(){
  const yr=(function(){const n=new Date();return(n.getMonth()>=2?n.getFullYear():n.getFullYear()-1);})();
  const schoolName=S.settings.schoolName||'○○학교';
  const careList=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch'||(s.dustDisease&&s.dustDisease.trim()));});
  _apStuSort(careList);
  const hasLevel=careList.some(function(s){return s.level&&String(s.level).trim();});
  const hasDept=careList.some(function(s){return s.department&&String(s.department).trim();});
  const header=['순'];
  if(hasLevel)header.push('학교급');
  if(hasDept)header.push('학과');
  header.push('학년','반','번호','이름','요보호 질환명','미세먼지 기저질환명');
  const dataRows=careList.map(function(s,i){
    const lvLabel=s.level?(_AP_LV_MAP[s.level]||s.level):'';
    const careText=[s.condition||'',s.careMemo||''].filter(function(x){return x&&x.trim();}).join(' / ');
    const dustText=s.dustDisease||'';
    const row=[i+1];
    if(hasLevel)row.push(lvLabel);
    if(hasDept)row.push(s.department||'');
    row.push(s.grade||'',s.cls||'',s.num||'',s.name||'',careText,dustText);
    return row;
  });
  return{header,dataRows,allRows:[header].concat(dataRows),careList,yr,schoolName,hasLevel,hasDept};
}

/* 요보호 명단 Excel 저장 — 잠복결핵/진료과 통계와 동일한 색상바·제목·외곽선·Freeze 스타일 */
function _apCareExportExcel(){
  if(!(window.electronAPI&&window.electronAPI.xlsxBuildDiary)){
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 빌드 IPC 미구성'});
    return;
  }
  const D=_apCareCollectRows();
  /* 열 너비: 순=50, (학교급=70)?, (학과=120)?, 학년=70, 반=70, 번호=70, 이름=110, 요보호=240, 미세먼지=260 */
  const colWidths=[50];
  if(D.hasLevel)colWidths.push(70);
  if(D.hasDept)colWidths.push(120);
  colWidths.push(70,70,70,110,240,260);
  const colCount=D.header.length;
  const titleText=D.yr+'학년도 '+D.schoolName+' 요보호 & 미세먼지 기저질환 학생 명단';
  const periodText='기준: '+D.yr+'학년도';
  /* 색상바 pixel-based split */
  const total=colWidths.reduce(function(a,b){return a+b;},0);
  const threshold30=total*0.3;
  let acc=0,top2=0;
  for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=threshold30)break;}
  acc=0;let bot1=0;
  for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=threshold30)break;}
  const top1=Math.max(1,colCount-top2);
  if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 생성 중…'});
  window.electronAPI.xlsxBuildDiary({
    colCount:colCount,
    colWidths:colWidths,
    headerLabels:D.header,
    dataRows:D.dataRows,
    titleText:titleText,
    schoolText:'학교: '+D.schoolName,
    periodText:periodText,
    top1:top1,
    bot1:bot1
  }).then(function(res){
    if(!res||!res.success){
      if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 생성 실패: '+(res&&res.error||'')});
      return;
    }
    const buf=new Uint8Array(res.bytes);
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=titleText+'.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
  }).catch(function(e){
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 오류: '+(e&&e.message||e)});
  });
}

/* 요보호 명단 Google Sheets 내보내기 (잠복결핵과 동일한 흐름) */
function _apCareExportSheets(){
  const D=_apCareCollectRows();
  const titleText=D.yr+'학년도 '+D.schoolName+' 요보호 & 미세먼지 기저질환 학생 명단';
  const existing=document.getElementById('careSheetsOv2');if(existing)existing.remove();
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='careSheetsOv2';
  ov.style.background='rgba(0,0,0,0.35)';
  ov.style.zIndex='9700';
  function _careSheetsClose(){if(typeof closeModalGracefully==='function')closeModalGracefully(ov);else ov.remove();}
  let html='<div class="modal-content" style="width:440px;max-width:94vw;padding:0">';
  html+='<div style="background:var(--popup-head);padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 내보내기</div></div>';
  html+='<div style="padding:18px">';
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    +'<div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#34a853,#1e8e3e);display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg></div>'
    +'<div><div style="font-size:13px;font-weight:700;color:var(--t1)">내 Google 드라이브에 저장</div>'
    +'<div style="font-size:10px;color:var(--t3)">새 스프레드시트가 자동으로 생성됩니다</div></div></div>';
  html+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11px;color:var(--t2)">';
  html+='<div style="margin-bottom:6px"><strong>파일명:</strong> '+escHtml(titleText)+'</div>';
  html+='<div style="margin-bottom:6px"><strong>대상:</strong> '+D.dataRows.length+'명</div>';
  html+='<div><strong>총 행:</strong> '+D.allRows.length+'행 (헤더 포함)</div>';
  html+='</div>';
  html+=_sheetsAccountHtml('careSheetsAcct');
  html+=_pmSheetsFolderUiHtml();
  html+='</div>';
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
  html+='<button id="careSheetsSendBtn2" style="padding:7px 22px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
  _pmBindSheetsFolderUi(ov);
  document.body.appendChild(ov);
  _sheetsAccountInit('careSheetsAcct');

  document.getElementById('careSheetsSendBtn2').addEventListener('click',async function(){
    const btn=this;btn.disabled=true;
    btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';
    try{
      if(!(window.electronAPI&&window.sheetsExportWithConsent))throw new Error('Google Sheets 연동 미구성');
      const sheetId=0;
      const colCount=D.header.length;
      const totalRows=D.allRows.length;
      const fmtReqs=[];
      fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{bold:true,fontSize:11},backgroundColor:{red:0.91,green:0.96,blue:0.97}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'}});
      if(totalRows>1){
        fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:totalRows,startColumnIndex:0,endColumnIndex:colCount},cell:{userEnteredFormat:{textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},bottom:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},left:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},right:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}}}}},fields:'userEnteredFormat(textFormat,borders)'}});
      }
      /* 열 너비: 순=40 / (학교급=52) / (학과=100) / 학년=50 / 반=50 / 번호=50 / 이름=90 / 요보호=200 / 미세먼지=200 */
      const baseW=[40];
      if(D.hasLevel)baseW.push(52);
      if(D.hasDept)baseW.push(100);
      baseW.push(50,50,50,90,200,200);
      baseW.forEach(function(w,i){
        fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});
      });
      /* 데이터 영역 밖의 빈 셀 제거 (기본 26cols × 1000rows → 사용 범위로 축소) */
      const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
      if(colCount<DEFAULT_COLS){
        fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:colCount,endIndex:DEFAULT_COLS}}});
      }
      if(totalRows<DEFAULT_ROWS){
        fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:totalRows,endIndex:DEFAULT_ROWS}}});
      }
      const createRes=await window.sheetsExportWithConsent({
        title:titleText,
        sheetTitle:'요보호명단',
        range:'요보호명단!A1',
        values:D.allRows,
        requests:fmtReqs,
        targetFolderId:(_pmSheetsFolder&&_pmSheetsFolder.id)||null
      });
      if(!createRes||!createRes.success)throw new Error((createRes&&createRes.error)||'스프레드시트 생성 실패');
      const ssUrl=createRes.spreadsheetUrl||'';
      if(ssUrl&&window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(ssUrl);
      _careSheetsClose();
    }catch(err){
      const msg=String(err&&err.message||err||'');
      btn.disabled=false;
      btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg> 생성 및 보내기';
      const needAuth=/not authenticated|Sheets account|authenticate|no.*token|unauthorized|401/i.test(msg);
      const body=ov.querySelector('.modal-content > div:nth-child(2)');
      if(body){
        if(needAuth){
          body.innerHTML='<div style="text-align:center;padding:10px 0">'
            +'<div style="font-size:40px;margin-bottom:10px">🔐</div>'
            +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">Google 계정 로그인이 필요합니다</div>'
            +'<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.6">1단계: <b>로그인</b> → 새 창에서 Google 인증<br>2단계: <b>내보내기 재시도</b></div>'
            +'<div style="display:flex;gap:8px;justify-content:center">'
            +'<a href="/auth/google/start?account=sheets" target="_blank" style="padding:10px 20px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f);text-decoration:none">1️⃣ Google 로그인</a>'
            +'<button id="careSheetsRetryBtn" style="padding:10px 20px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#3b82f6,#1e40af);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f)">2️⃣ 내보내기 재시도</button>'
            +'</div></div>';
          setTimeout(function(){
            const rb=document.getElementById('careSheetsRetryBtn');
            if(rb)rb.addEventListener('click',function(){_careSheetsClose();setTimeout(function(){_apCareExportSheets();},260);});
          },50);
        } else {
          body.innerHTML='<div style="text-align:center;padding:10px 0">'
            +'<div style="font-size:40px;margin-bottom:10px">⚠️</div>'
            +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">내보내기 실패</div>'
            +'<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.6">'+escHtml(msg||'알 수 없는 오류')+'</div>'
            +'</div>';
        }
      }
    }
  });
}
/* ══ 미매칭(명단에 없어 매칭 안 된) 요보호 일괄 등록 행 — 영속 보관 + 수동 매칭 (사용자 요청 2026-06-02) ══
 *  · localStorage 에 학년도별 보관 → 인원관리 팝업을 닫거나 앱을 재시작해도 유지되어 나중에 매칭 가능.
 *  · 수동 매칭: 명단의 실제 학생을 골라 그 학생에게 요보호/미세먼지 내용 적용 후 목록에서 제거.
 *  · 잘못 올라온 항목은 삭제. */
function _careUnmatchedKey(){ return 'ec_care_unmatched_'+String(_academicYear()); }
function _careUnmatchedGet(){ try{ const a=JSON.parse(localStorage.getItem(_careUnmatchedKey())||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } }
function _careUnmatchedSet(arr){ try{ localStorage.setItem(_careUnmatchedKey(), JSON.stringify(arr||[])); return true; }catch(_){ return false; } }
function _careUnmatchedRowKey(e){ return JSON.stringify([String(e.name||'').trim(),e.level||'',e.department||'',e.grade||'',String(e.cls||''),e.num||'',e.careReason||'',e.dustDisease||'',e.memo||'']); }
function _careUnmatchedAdd(entries){
  const cur=_careUnmatchedGet(); const seen={};
  cur.forEach(function(e){seen[_careUnmatchedRowKey(e)]=true;});
  (entries||[]).forEach(function(e){ const k=_careUnmatchedRowKey(e); if(!seen[k]){ cur.push(e); seen[k]=true; } });
  return _careUnmatchedSet(cur);
}
function _careUnmatchedRemove(key){ _careUnmatchedSet(_careUnmatchedGet().filter(function(e){return _careUnmatchedRowKey(e)!==key;})); }
/* 케어 패널 미매칭 배너 — 미매칭 있으면 "🔗 수동 매칭" 버튼 노출(인원관리 재진입 시에도 유지) */
function _apCareRenderUnmatched(){
  const host=document.getElementById('apCareUnmatched'); if(!host)return;
  const list=_careUnmatchedGet();
  if(!list.length){ host.innerHTML=''; return; }
  host.innerHTML='<div style="margin:8px 0;padding:10px 14px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.06);border-radius:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
    +'<span style="font-size:12px;font-weight:700;color:#d97706">⚠ 매칭 / 저장 확인이 필요한 항목 '+list.length+'건</span>'
    +'<span style="font-size:10.5px;color:var(--t3);flex:1;min-width:120px">명단에 등록된 학생에게 수동으로 연결하거나 삭제할 수 있습니다.</span>'
    +'<button data-action="_apCareUnmatchedModal" style="padding:6px 12px;font-size:11px;font-weight:700;border-radius:7px;border:1px solid rgba(6,182,212,0.4);background:rgba(6,182,212,0.1);color:var(--cyan);cursor:pointer;font-family:var(--f)">🔗 수동 매칭</button>'
    +'</div>';
}
/* ── 미매칭 수동 매칭 모달 — 설정 '외부 데이터 수동 매칭'(_umRenderModal)과 동일 GUI ──
 *  회색 드래그 헤더 · 진행막대 · ◀▶ 항목 이동 · 학교급/학년 칩 · 3열 색상 반 카드 그리드(카드별 학생 리스트, 동일이름 ⭐추천) · 푸터.
 *  학생 클릭 → 그 학생에게 요보호/미세먼지 내용 적용 + 미매칭 목록에서 제거 + 다음 항목으로. (사용자 요청 2026-06-02) */
let _apCmState=null, _apCmDrag=null, _apCmDragGlobalBound=false;
/* 수동 매칭 모달 공용 오프너 — 요보호/학생 등 모드별 cfg(title·subtitle·metaFn·onMatch·onRemove·refreshBanner·deleteLabel) 주입. */
function _apCmOpen(list, cfg){
  const _actStu=(S.people||[]).filter(function(p){return p.type==='student'&&(cfg.activeOnly?String(p.grade==null?'':p.grade).trim()!==''&&Number(p.is_enrolled)!==0:p.grade>0);});
  /* 미등록(일괄 삭제·전출 보관) 학생도 매칭 후보에 포함 — 미매칭 상대가 미등록 상태면 후보 목록에
   * 아예 안 보여 같은 사람으로 연결할 방법이 없던 문제 (사용자 보고 2026-06-12: 1-1-21 한경호가 후보에 없음).
   * 매칭(uid upsert) 시 is_enrolled=1 로 자동 복귀. */
  const _uidSeen={}; _actStu.forEach(function(s){_uidSeen[String(s.uid||s.id)]=true;});
  const _leftStu=(S.leavers||[]).filter(function(p){return p&&p.type==='student'&&p.grade>0&&!_uidSeen[String(p.uid||p.id)];})
    .map(function(p){return Object.assign({},p,{_unenrolled:true});});
  const students=cfg.activeOnly?_actStu:_actStu.concat(_leftStu);
  const levelSet={}; students.forEach(function(s){if(s.level)levelSet[s.level]=true;});
  const levels=Object.keys(levelSet);
  const start=list[0];
  _apCmState={ items:list.slice(), idx:0, students:students,
    selectedLevel:levels[0]||'',
    selectedGrade:'',
    selectedDept:'',
    levels:levels,
    title:cfg.title, subtitle:cfg.subtitle, metaFn:cfg.metaFn, onMatch:cfg.onMatch,
    onRemove:cfg.onRemove, refreshBanner:cfg.refreshBanner, deleteLabel:cfg.deleteLabel||'🗑 이 미매칭 삭제',
    waitForSave:cfg.waitForSave===true,
    onNew:cfg.onNew||null,   /* 신규 인원으로 등록 (새 uid) — 제공 시 푸터에 버튼 노출 (2026-06-12) */
    matchToast:cfg.matchToast };
  /* 엑셀 학교급 별칭과 명단 내부값을 맞추고, 실제 후보가 있는 필터로 시작한다. */
  _apCmSyncFiltersToItem(start||{});
  _apCmRender();
}
function _careImportChanges(row){
  /* 엑셀의 빈 셀은 기존값 보존. 삭제는 개별 수정/해제에서 명시적으로 한다. */
  const changes={};
  if(String(row.careReason||'').trim())changes.care_reason=String(row.careReason).trim();
  if(String(row.dustDisease||'').trim())changes.dust_disease=String(row.dustDisease).trim();
  if(String(row.memo||'').trim())changes.care_memo=String(row.memo).trim();
  return changes;
}
async function _careApplyToStudent(s,cur){
  const changes=_careImportChanges(cur);
  if(!Object.keys(changes).length)return {success:false,error:'적용할 질환명이나 메모가 없습니다.'};
  const result=await _persistCare(s,changes);
  if(result.success)_careRefreshSaved();
  return result;
}
function _apCareUnmatchedModal(){
  const list=_careUnmatchedGet();
  if(!list.length){ bus.emit('toast:show',{text:'미매칭 학생이 없습니다.'}); return; }
  _apCmOpen(list,{
    title:'🔗 요보호 · 미세먼지 미매칭 수동 매칭',
    subtitle:'명단에 등록된 학생에게 연결하면 그 학생에게 요보호/미세먼지 내용이 적용됩니다.',
    deleteLabel:'🗑 이 미매칭 삭제',
    activeOnly:true, waitForSave:true,
    metaFn:function(cur){ const t=[cur.careReason,cur.dustDisease].filter(Boolean).join(' / ')||'(내용 없음)'; return t+(cur.memo?' · 메모: '+cur.memo:''); },
    onMatch:_careApplyToStudent,
    onRemove:function(cur){ _careUnmatchedRemove(_careUnmatchedRowKey(cur)); },
    refreshBanner:_apCareRenderUnmatched,
    matchToast:function(s){ return s.name+' 에 매칭 완료'; }
  });
}
function _apCmRender(){
  const st=_apCmState; if(!st)return;
  const old=document.getElementById('apCareUnmatchedOverlay'); if(old)old.remove();
  const ov=document.createElement('div'); ov.id='apCareUnmatchedOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:11000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.30)';
  ov.innerHTML=_apCmBuildHtml();
  document.body.appendChild(ov);
  _apCmBindEvents(ov);
  _apCmRenderClassGrid();
}
/* 수동매칭 모달 현재 항목 메타 — 학교급(여러개일 때만)·학과(있을 때) + 학년·반·번호.
 *  예: "항공기계과 1학년 2반 1번", 학교급 2종 이상이면 "고등학교 항공기계과 1학년 2반 1번". */
function _apCmItemMeta(cur){
  const st=_apCmState; if(!cur)return '';
  const lvLabel={elementary:'초등학교',middle:'중학교',high:'고등학교',kindergarten:'유치원',special:'특수학교','초':'초등학교','중':'중학교','고':'고등학교','유':'유치원','대':'대학교'};
  let s='';
  if(st && st.levels && st.levels.length>=2 && cur.level) s+=(lvLabel[cur.level]||cur.level)+' ';
  if(cur.department && String(cur.department).trim()) s+=String(cur.department).trim()+' ';
  s+=(cur.grade?cur.grade+'학년 ':'')+(cur.cls?cur.cls+'반 ':'')+(cur.num?cur.num+'번':'');
  return s.trim();
}
function _apCmBuildHtml(){
  const st=_apCmState; const cur=st.items[st.idx]; const total=st.items.length;
  const pct=((st.idx+1)/total*100).toFixed(1);
  const meta=_apCmItemMeta(cur);
  const careTxt=(st.metaFn?st.metaFn(cur):'')||'(내용 없음)';
  let h='<div class="modal-content" id="apCmBox" style="width:840px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(0,0,0,0.08);box-shadow:0 24px 60px rgba(0,0,0,0.30);position:relative;padding:0">';
  h+='<div class="acm-head" id="apCmDragHandle" style="padding:12px 16px;display:flex;gap:10px;align-items:center;background:linear-gradient(180deg,#eef2f6,#e5e9ee);border-bottom:1px solid var(--bdr);cursor:grab;user-select:none">'
    +'<span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0.5"><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span></span>'
    +'<div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0">'
      +'<span style="font-size:13px;font-weight:700;color:var(--t1)">'+escHtml(st.title||'🔗 미매칭 수동 매칭')+'</span>'
      +'<span style="font-size:10.5px;color:var(--t2);line-height:1.4">'+escHtml(st.subtitle||'')+'</span>'
    +'</div>'
    +'<span id="apCmCounter" style="font-size:10.5px;padding:3px 9px;background:rgba(6,182,212,0.10);color:var(--cyan);border-radius:10px;font-weight:700;flex-shrink:0">'+(st.idx+1)+' / '+total+'</span>'
    +'</div>';
  h+='<div style="height:3px;background:var(--bdrl);position:relative;overflow:hidden"><div id="apCmProgress" style="height:100%;background:linear-gradient(90deg,#06b6d4,#0891b2);width:'+pct+'%;transition:width .25s ease"></div></div>';
  h+='<div style="padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl);background:linear-gradient(180deg,rgba(6,182,212,0.04),transparent)">'
    +'<button class="acm-nav" data-acm-nav="prev" '+(st.idx===0?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx===0?';opacity:0.35;cursor:not-allowed':'')+'">◀</button>'
    +'<div style="flex:1;padding:8px 14px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:9px;display:flex;align-items:center;gap:10px">'
      +'<span style="font-size:16px">⚠</span>'
      +'<div style="min-width:0"><div id="apCmCurName" style="font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(cur.name||'(이름 없음)')+'</div>'
      +'<div id="apCmCurMeta" style="font-size:10.5px;color:var(--t2)">'+escHtml(meta||'학번 누락')+' · '+escHtml(careTxt)+'</div></div>'
      +'<span style="flex:1"></span>'
      +'<span style="font-size:9.5px;font-weight:700;color:#d97706;background:rgba(245,158,11,0.12);padding:3px 8px;border-radius:8px">미매칭</span>'
    +'</div>'
    +'<button class="acm-nav" data-acm-nav="next" '+(st.idx>=total-1?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx>=total-1?';opacity:0.35;cursor:not-allowed':'')+'">▶</button>'
    +'</div>';
  h+='<div id="apCmLvRow" style="padding:10px 16px;display:'+(st.levels.length>=2?'flex':'none')+';align-items:center;gap:10px;border-bottom:1px solid var(--bdrl)">'+_apCmLvRowInner()+'</div>';
  const grInner=_apCmGrRowInner();
  h+='<div id="apCmGrRow" style="padding:10px 16px;display:'+(grInner?'flex':'none')+';gap:10px;align-items:center;border-bottom:1px solid var(--bdrl);flex-wrap:wrap">'+grInner+'</div>';
  const deptInner=_apCmDeptRowInner();
  h+='<div id="apCmDeptRow" style="padding:10px 16px;display:'+(deptInner?'flex':'none')+';gap:10px;align-items:center;border-bottom:1px solid var(--bdrl);flex-wrap:wrap">'+deptInner+'</div>';
  h+='<div id="apCmClassGrid" style="flex:1;padding:14px 16px;overflow-y:auto"></div>';
  h+='<div style="padding:9px 16px;border-top:1px solid var(--bdrl);display:flex;align-items:center;gap:10px;background:#fafbfc">'
    +'<span style="font-size:9.5px;color:var(--t3);flex:1">← / →: 이전·다음 / Esc: 닫기 / 제목 행 드래그로 창 이동</span>'
    +'<button class="acm-skip" style="padding:7px 14px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--bdr);background:#fff;color:var(--t2)">⏭ 건너뛰기</button>'
    /* 신규 등록 — 기존 누구와도 다른 사람일 때 새 uid 로 바로 등록 (사용자 요청 2026-06-12: 미매칭인데 신규 선택지가 없음) */
    +(st.onNew?'<button class="acm-new" data-tooltip="기존 명단의 누구와도 다른 사람(진짜 신규)일 때 새 인원으로 등록합니다." style="padding:7px 14px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(37,99,235,0.40);background:rgba(59,130,246,0.06);color:#2563eb">➕ 신규 인원으로 등록</button>':'')
    +'<button class="acm-delete" style="padding:7px 14px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(220,38,38,0.40);background:rgba(220,38,38,0.06);color:#dc2626">'+escHtml(st.deleteLabel||'🗑 이 미매칭 삭제')+'</button>'
    +'</div>';
  h+='</div>';
  return h;
}
function _apCmLvRowInner(){
  const st=_apCmState; if(!st||st.levels.length<2)return '';
  const lvLabel={elementary:'초등학교',middle:'중학교',high:'고등학교',kindergarten:'유치원',special:'특수학교'};
  let h='<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px">학교급</span>'
    +'<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px">';
  st.levels.forEach(function(lv){
    const act=st.selectedLevel===lv;
    h+='<button class="acm-lv" data-acm-lv="'+escHtml(lv)+'" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(act?'var(--card)':'transparent')+';color:'+(act?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer'+(act?';box-shadow:0 1px 3px rgba(0,0,0,0.08)':'')+'">'+(lvLabel[lv]||lv)+'</button>';
  });
  return h+'</div>';
}
function _apCmGetGrades(level){
  const set={};
  (_apCmState.students||[]).forEach(function(s){
    if(level&&s.level&&s.level!==level)return;
    if(s.grade!==undefined&&s.grade!==null&&s.grade!=='')set[String(s.grade)]=true;
  });
  return Object.keys(set).sort(function(a,b){const na=parseInt(a,10),nb=parseInt(b,10);if(!isNaN(na)&&!isNaN(nb))return na-nb;return a.localeCompare(b);});
}
function _apCmGrRowInner(){
  const st=_apCmState; if(!st)return '';
  const grades=_apCmGetGrades(st.selectedLevel); if(!grades.length)return '';
  let h='<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px">학년</span>';
  grades.forEach(function(g){
    const act=String(st.selectedGrade)===String(g);
    h+='<button class="acm-gr" data-acm-gr="'+escHtml(g)+'" style="padding:5px 12px;font-size:11px;font-weight:600;border:1px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--card)')+';color:'+(act?'#fff':'var(--t2)')+';border-radius:14px;cursor:pointer'+(act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'')+'">'+escHtml(g)+'학년</button>';
  });
  return h;
}
/* 학과(department) — 선택한 학교급에 등록된 학과 종류. 학과 등록 학교에서만 노출 (사용자 요청 2026-06-02) */
function _apCmGetDepartments(level){
  const set={};
  (_apCmState.students||[]).forEach(function(s){
    if(level&&s.level&&s.level!==level)return;
    const d=(s.department||'').trim();
    if(d)set[d]=true;
  });
  return Object.keys(set).sort(function(a,b){return a.localeCompare(b);});
}
function _apCmDeptRowInner(){
  const st=_apCmState; if(!st)return '';
  const deps=_apCmGetDepartments(st.selectedLevel); if(!deps.length)return '';
  let h='<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px">학과</span>';
  deps.forEach(function(d){
    const act=String(st.selectedDept)===String(d);
    h+='<button class="acm-dept" data-acm-dept="'+escHtml(d)+'" style="padding:5px 12px;font-size:11px;font-weight:600;border:1px solid '+(act?'#8b5cf6':'var(--bdr)')+';background:'+(act?'#8b5cf6':'var(--card)')+';color:'+(act?'#fff':'var(--t2)')+';border-radius:14px;cursor:pointer'+(act?';box-shadow:0 0 12px rgba(139,92,246,0.35)':'')+'">'+escHtml(d)+'</button>';
  });
  return h;
}
function _apCmClsHead(clsName,count,colorClass){
  const colorMap={c1:'#06b6d4,#0891b2',c2:'#8b5cf6,#6d28d9',c3:'#f59e0b,#d97706',c4:'#10b981,#047857',c5:'#ef4444,#b91c1c',c6:'#ec4899,#be185d'};
  const c=colorMap[colorClass]||colorMap.c1;
  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-radius:8px;color:#fff;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,0.10);background:linear-gradient(135deg,'+c+')">'
    +'<span style="font-size:12px;font-weight:800">'+escHtml(clsName)+'반</span>'
    +'<span style="font-size:9px;font-weight:700;opacity:0.92;background:rgba(255,255,255,0.20);padding:1px 6px;border-radius:6px">'+count+'명</span>'
    +'</div>';
}
function _apCmRenderClassGrid(){
  const st=_apCmState; const grid=document.getElementById('apCmClassGrid'); if(!grid||!st)return;
  const cur=st.items[st.idx]; const recName=(cur.name||'').trim();
  const filtered=st.students.filter(function(s){
    if(st.selectedLevel&&s.level&&s.level!==st.selectedLevel)return false;
    if(st.selectedGrade!==''&&String(st.selectedGrade)!==String(s.grade))return false;
    if(st.selectedDept&&String((s.department||'').trim())!==String(st.selectedDept))return false;
    return true;
  });
  if(!filtered.length){ grid.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">선택한 학년에 해당하는 학생이 없습니다. 다른 학년을 선택하세요.</div>'; return; }
  const byCls={};
  filtered.forEach(function(s){const c=(s.cls===undefined||s.cls===null||s.cls==='')?'(반없음)':String(s.cls);if(!byCls[c])byCls[c]=[];byCls[c].push(s);});
  const clsKeys=Object.keys(byCls).sort(function(a,b){return compareClass(a,b);});
  const colors=['c1','c2','c3','c4','c5','c6'];
  let h='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
  clsKeys.forEach(function(c,ci){
    const stus=byCls[c].sort(function(a,b){const na=parseInt(a.num,10),nb=parseInt(b.num,10);if(!isNaN(na)&&!isNaN(nb))return na-nb;return String(a.num||'').localeCompare(String(b.num||''));});
    const cls=colors[ci%colors.length];
    const cur_cls=(cur.cls&&String(cur.cls)===String(c));
    h+='<div style="position:relative;border-radius:12px;padding:10px;display:flex;flex-direction:column;background:var(--card);border:1.5px solid var(--bdr);overflow:hidden;min-height:180px;max-height:240px'+(cur_cls?';box-shadow:0 0 0 2.5px rgba(6,182,212,0.30),0 4px 10px rgba(0,0,0,0.08)':'')+'">';
    h+=_apCmClsHead(c,stus.length,cls);
    h+='<div style="flex:1;overflow-y:auto;padding:0 1px;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px">';
    stus.forEach(function(s){
      const recommend=recName&&s.name===recName;
      const isCare=s.status==='caution'||s.status==='watch';
      h+='<div class="acm-stu" data-acm-pick="'+s.id+'" style="display:grid;grid-template-columns:32px 1fr;gap:6px;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;transition:background .12s'+(recommend?';background:rgba(245,158,11,0.10);font-weight:700':'')+(s._unenrolled?';opacity:0.75':'')+'">'
        +'<span style="text-align:right;color:var(--t3);font-size:10px">'+(s.num?escHtml(String(s.num))+'번':'')+'</span>'
        +'<span style="color:var(--t1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(s.name||'')+(recommend?' ⭐':'')+(isCare?' <span style="font-size:8px;color:var(--yl)">*요보호*</span>':'')+(s._unenrolled?' <span style="font-size:8px;color:var(--t3);border:1px solid var(--bdr);border-radius:3px;padding:0 3px">미등록</span>':'')+'</span>'
        +'</div>';
    });
    h+='</div></div>';
  });
  h+='</div>';
  grid.innerHTML=h;
  grid.querySelectorAll('[data-acm-pick]').forEach(function(el){
    el.addEventListener('mouseover',function(){this.style.background='rgba(6,182,212,0.10)';});
    el.addEventListener('mouseout',function(){ this.style.background=this.textContent.indexOf('⭐')>=0?'rgba(245,158,11,0.10)':''; });
    el.addEventListener('click',function(){ _apCmMatchToStudent(this.dataset.acmPick); });
  });
}
async function _apCmMatchToStudent(stuId){
  const st=_apCmState; if(!st||st.saving)return;
  const cur=st.items[st.idx]; const s=getStu(stuId);
  if(!cur||!s){bus.emit('toast:show',{text:'적용할 학생을 찾을 수 없습니다'});return;}
  if(st.waitForSave){
    st.saving=true;
    let result;
    try{result=await st.onMatch(s,cur);}
    catch(_){result={success:false,error:'저장에 실패했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'};}
    finally{st.saving=false;}
    if(!result||!result.success){bus.emit('toast:show',{text:(result&&result.error)||'저장을 확인하지 못했습니다.'});return;}
  }else if(st.onMatch)st.onMatch(s,cur);
  if(st.onRemove)st.onRemove(cur);
  /* 비교 팝업이 열려 있으면 미매칭 칩·안내 박스·카운트 즉시 동기화 (2026-06-12) */
  try{ if(window._smartCompareSyncUnmatched)window._smartCompareSyncUnmatched(); }catch(_){}
  bus.emit('toast:show',{text:(st.matchToast?st.matchToast(s,cur):(s.name+' 에 매칭 완료'))});
  const index=st.items.indexOf(cur);if(index>=0)st.items.splice(index,1);
  if(st.refreshBanner)st.refreshBanner();
  if(_apCmState===st)_apCmAdvanceOrClose();
}
function _apCmAdvanceOrClose(){
  const st=_apCmState; if(!st)return;
  if(!st.items.length){ _apCmClose(); return; }
  if(st.idx>=st.items.length)st.idx=st.items.length-1;
  _apCmSyncFiltersToItem(st.items[st.idx]);
  _apCmApplyItemChange();
}
/* 항목으로 필터(학교급/학년/학과) 동기화 — 그 항목의 값이 있고 옵션에 존재하면 선택 */
function _apCmSyncFiltersToItem(it){
  const st=_apCmState; if(!st||!it)return;
  const levels=st.levels||[];
  const wantedLevel=normalizeCareSchoolLevel(it.level);
  const actualLevel=wantedLevel?levels.find(function(lv){return normalizeCareSchoolLevel(lv)===wantedLevel;}):null;
  st.selectedLevel=actualLevel||(levels.indexOf(st.selectedLevel)!==-1?st.selectedLevel:(levels[0]||''));
  const grades=_apCmGetGrades(st.selectedLevel);
  const gradeKey=function(value){
    const text=String(value==null?'':value).trim().normalize('NFC').replace(/\s*학년$/,'').trim();
    return /^\d+(?:\.0+)?$/.test(text)?text.replace(/\.0+$/,'').replace(/^0+(?=\d)/,''):text;
  };
  const wantedGrade=gradeKey(it.grade);
  const actualGrade=wantedGrade?grades.find(function(g){return gradeKey(g)===wantedGrade;}):null;
  st.selectedGrade=actualGrade!=null?String(actualGrade):(grades.indexOf(String(st.selectedGrade))!==-1?String(st.selectedGrade):(grades[0]||''));
  /* 학과는 선택 학년에 실제 학생이 있는 값으로 제한해 빈 조합에 갇히지 않는다. */
  const deps=_apCmGetDepartments(st.selectedLevel).filter(function(dept){
    return st.students.some(function(s){
      return (!st.selectedLevel||!s.level||s.level===st.selectedLevel)
        && (st.selectedGrade===''||String(s.grade)===st.selectedGrade)
        && String(s.department||'').trim()===dept;
    });
  });
  const itDept=(it.department||'').trim();
  st.selectedDept = deps.length ? (deps.indexOf(itDept)!==-1?itDept:(deps.indexOf(st.selectedDept)!==-1?st.selectedDept:deps[0])) : '';
}
function _apCmSkip(){
  const st=_apCmState; if(!st||st.saving)return;
  if(st.idx>=st.items.length-1){ _apCmClose(); return; }
  st.idx++;
  _apCmSyncFiltersToItem(st.items[st.idx]);
  _apCmApplyItemChange();
}
function _apCmDeleteCurrent(){
  const st=_apCmState; if(!st||st.saving)return;
  const cur=st.items[st.idx];
  _apConfirm({ title:'미매칭 항목 삭제', message:'<b style="color:var(--t1)">'+escHtml(cur.name||'')+'</b> 미매칭 항목을 삭제하시겠습니까?', confirmText:'삭제', cancelText:'취소', danger:true,
    onConfirm:function(){
      const st2=_apCmState; if(!st2||st2!==st||st2.saving)return;
      if(st2.onRemove)st2.onRemove(cur);
      if(st2.refreshBanner)st2.refreshBanner();
      try{ if(window._smartCompareSyncUnmatched)window._smartCompareSyncUnmatched(); }catch(_){}
      const index=st2.items.indexOf(cur);if(index>=0)st2.items.splice(index,1); _apCmAdvanceOrClose();
    }});
}
function _apCmNav(dir){
  const st=_apCmState; if(!st||st.saving)return;
  if(dir==='prev'&&st.idx>0)st.idx--;
  else if(dir==='next'&&st.idx<st.items.length-1)st.idx++;
  else return;
  _apCmSyncFiltersToItem(st.items[st.idx]);
  _apCmApplyItemChange();
}
/* 칩(학교급/학년/학과) 영역 + 반 그리드만 부분 갱신 — 모달 전체 재생성 없이 (깜빡임 방지, 외부데이터 모달과 동일) */
function _apCmApplyFilterChange(){
  const st=_apCmState; if(!st)return;
  const lvRow=document.getElementById('apCmLvRow');
  if(lvRow){
    lvRow.innerHTML=_apCmLvRowInner();
    lvRow.style.display=(st.levels.length>=2)?'flex':'none';
    lvRow.querySelectorAll('[data-acm-lv]').forEach(function(el){el.addEventListener('click',_apCmOnLvClick);});
  }
  const grRow=document.getElementById('apCmGrRow');
  if(grRow){
    const inner=_apCmGrRowInner();
    grRow.innerHTML=inner; grRow.style.display=inner?'flex':'none';
    grRow.querySelectorAll('[data-acm-gr]').forEach(function(el){el.addEventListener('click',_apCmOnGrClick);});
  }
  const deptRow=document.getElementById('apCmDeptRow');
  if(deptRow){
    const dinner=_apCmDeptRowInner();
    deptRow.innerHTML=dinner; deptRow.style.display=dinner?'flex':'none';
    deptRow.querySelectorAll('[data-acm-dept]').forEach(function(el){el.addEventListener('click',_apCmOnDeptClick);});
  }
  _apCmRenderClassGrid();
}
/* 항목 변경(◀▶, 매칭/삭제 후 다음) 시 헤더 정보·진행막대·네비버튼 + 필터 부분 갱신 */
function _apCmApplyItemChange(){
  const st=_apCmState; if(!st)return;
  const total=st.items.length;
  const cur=st.items[st.idx]; if(!cur){ _apCmClose(); return; }
  const counter=document.getElementById('apCmCounter'); if(counter)counter.textContent=(st.idx+1)+' / '+total;
  const prog=document.getElementById('apCmProgress'); if(prog)prog.style.width=((st.idx+1)/total*100).toFixed(1)+'%';
  const meta=_apCmItemMeta(cur);
  const careTxt=(st.metaFn?st.metaFn(cur):'')||'(내용 없음)';
  const nm=document.getElementById('apCmCurName'); if(nm)nm.textContent=cur.name||'(이름 없음)';
  const mt=document.getElementById('apCmCurMeta'); if(mt)mt.textContent=(meta||'학번 누락')+' · '+careTxt;
  const prevBtn=document.querySelector('#apCareUnmatchedOverlay [data-acm-nav="prev"]');
  if(prevBtn){ if(st.idx===0){prevBtn.setAttribute('disabled','');prevBtn.style.opacity='0.35';prevBtn.style.cursor='not-allowed';} else {prevBtn.removeAttribute('disabled');prevBtn.style.opacity='';prevBtn.style.cursor='pointer';} }
  const nextBtn=document.querySelector('#apCareUnmatchedOverlay [data-acm-nav="next"]');
  if(nextBtn){ if(st.idx>=total-1){nextBtn.setAttribute('disabled','');nextBtn.style.opacity='0.35';nextBtn.style.cursor='not-allowed';} else {nextBtn.removeAttribute('disabled');nextBtn.style.opacity='';nextBtn.style.cursor='pointer';} }
  _apCmApplyFilterChange();
}
function _apCmOnLvClick(){
  _apCmState.selectedLevel=this.dataset.acmLv;
  const g=_apCmGetGrades(_apCmState.selectedLevel); if(g.length&&g.indexOf(_apCmState.selectedGrade)===-1)_apCmState.selectedGrade=g[0];
  /* 학교급 바뀌면 학과도 재계산 — 새 학교급에 그 학과 없으면 첫 학과(또는 없음)로 */
  const deps=_apCmGetDepartments(_apCmState.selectedLevel);
  _apCmState.selectedDept = deps.length ? (deps.indexOf(_apCmState.selectedDept)!==-1?_apCmState.selectedDept:deps[0]) : '';
  _apCmApplyFilterChange();
}
function _apCmOnGrClick(){ _apCmState.selectedGrade=this.dataset.acmGr; _apCmApplyFilterChange(); }
function _apCmOnDeptClick(){ _apCmState.selectedDept=this.dataset.acmDept; _apCmApplyFilterChange(); }
function _apCmKeyHandler(e){
  if(!_apCmState||!document.getElementById('apCareUnmatchedOverlay'))return;
  if(e.key==='Escape'){ e.preventDefault(); _apCmClose(); }
  else if(e.key==='ArrowLeft'){ _apCmNav('prev'); }
  else if(e.key==='ArrowRight'){ _apCmNav('next'); }
}
function _apCmClose(){
  const ov=document.getElementById('apCareUnmatchedOverlay'); if(ov)ov.remove();
  document.removeEventListener('keydown',_apCmKeyHandler);
  const rb=_apCmState&&_apCmState.refreshBanner;
  _apCmState=null; _apCmDrag=null;
  if(rb)rb();
}
function _apCmBindEvents(ov){
  document.removeEventListener('keydown',_apCmKeyHandler);
  document.addEventListener('keydown',_apCmKeyHandler);
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)_apCmClose(); });
  ov.querySelectorAll('[data-acm-nav]').forEach(function(el){ el.addEventListener('click',function(){ if(this.disabled)return; _apCmNav(this.dataset.acmNav); }); });
  ov.querySelectorAll('[data-acm-lv]').forEach(function(el){ el.addEventListener('click',_apCmOnLvClick); });
  ov.querySelectorAll('[data-acm-dept]').forEach(function(el){ el.addEventListener('click',_apCmOnDeptClick); });
  ov.querySelectorAll('[data-acm-gr]').forEach(function(el){ el.addEventListener('click',_apCmOnGrClick); });
  const skip=ov.querySelector('.acm-skip'); if(skip)skip.addEventListener('click',_apCmSkip);
  const del=ov.querySelector('.acm-delete'); if(del)del.addEventListener('click',_apCmDeleteCurrent);
  /* 신규 인원으로 등록 — 새 uid 등록 후 이 미매칭 항목 제거·다음으로 (2026-06-12) */
  const newB=ov.querySelector('.acm-new');
  if(newB)newB.addEventListener('click',function(){
    const st=_apCmState; if(!st||!st.onNew)return;
    const cur=st.items[st.idx]; if(!cur)return;
    st.onNew(cur);
    if(st.onRemove)st.onRemove(cur);
    try{ if(window._smartCompareSyncUnmatched)window._smartCompareSyncUnmatched(); }catch(_){}
    bus.emit('toast:show',{text:(cur.name||'')+' 신규 인원으로 등록했습니다.'});
    st.items.splice(st.idx,1);
    _apCmAdvanceOrClose();
  });
  _apCmBindDrag(ov);
}
function _apCmBindDrag(ov){
  const handle=ov.querySelector('#apCmDragHandle'), box=ov.querySelector('#apCmBox');
  if(!handle||!box)return;
  handle.addEventListener('mousedown',function(e){
    let ox=0,oy=0; const tr=window.getComputedStyle(box).transform;
    if(tr&&tr!=='none'){const m=tr.match(/matrix\(([^)]+)\)/);if(m){const p=m[1].split(',');ox=parseFloat(p[4])||0;oy=parseFloat(p[5])||0;}}
    _apCmDrag={box:box,sx:e.clientX,sy:e.clientY,ox:ox,oy:oy}; handle.style.cursor='grabbing'; e.preventDefault();
  });
  if(!_apCmDragGlobalBound){
    _apCmDragGlobalBound=true;
    document.addEventListener('mousemove',function(e){ if(_apCmDrag){_apCmDrag.box.style.transform='translate('+(_apCmDrag.ox+e.clientX-_apCmDrag.sx)+'px,'+(_apCmDrag.oy+e.clientY-_apCmDrag.sy)+'px)';} });
    document.addEventListener('mouseup',function(){ if(_apCmDrag){const hd=document.getElementById('apCmDragHandle'); if(hd)hd.style.cursor='grab'; _apCmDrag=null;} });
  }
}

/* ══ 학생 일괄 등록 미매칭 — 영속 보관 + 수동 매칭 (요보호 모달 재사용, 2026-06-05) ══
 *  · 미매칭 = 학년+반+번호는 기존 명단에 있는데 이름이 다른 경우(개명/실수) + 동명이인 자동특정 불가.
 *  · settings-tab-people.js 비교 팝업이 검출 후 여기에 적재 → 배너 '🔗 수동 매칭' 버튼/모달로 처리. */
function _stuUnmatchedKey(){ return 'ec_student_unmatched_'+String(_academicYear()); }
function _stuUnmatchedGet(){ try{ const a=JSON.parse(localStorage.getItem(_stuUnmatchedKey())||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } }
function _stuUnmatchedSet(arr){ try{ localStorage.setItem(_stuUnmatchedKey(), JSON.stringify(arr||[])); }catch(_){} }
function _stuUnmatchedRowKey(e){ return [String(e.name||'').trim(), e.grade||'', String(e.cls||''), e.num||''].join('|'); }
function _stuUnmatchedAdd(entries){
  const cur=_stuUnmatchedGet(); const seen={};
  cur.forEach(function(e){seen[_stuUnmatchedRowKey(e)]=true;});
  (entries||[]).forEach(function(e){ const k=_stuUnmatchedRowKey(e); if(!seen[k]){ cur.push(e); seen[k]=true; } });
  _stuUnmatchedSet(cur);
}
function _stuUnmatchedRemove(key){ _stuUnmatchedSet(_stuUnmatchedGet().filter(function(e){return _stuUnmatchedRowKey(e)!==key;})); }
/* 미매칭 항목 자동 재검증 — '해결된' 항목만 제거하고, 미해결은 유지(확인 업로드·재진입·재시작 후에도 배너 유지).
 *  미매칭(같은 자리·다른 이름)은 그 엑셀 이름+성별 학생이 '그 자리(학년+반+번호)'에 실제로 등록되면 해결된 것으로 보고 제거.
 *  (옛 '이름이 명단에 없으면 제거' 규칙은 새 미매칭에선 항상 참이 되어 배너를 즉시 지워버리므로 폐기 — 사용자 요청 2026-06-09) */
function _stuUnmatchedRevalidate(){
  const list=_stuUnmatchedGet();
  if(!list.length)return list;
  const students=(S.people||[]).filter(function(p){return p&&p.type==='student';});
  const _ng=function(g){g=String(g||'').trim().toUpperCase();if(['M','남','남자','MALE','남성'].indexOf(g)>=0)return'M';if(['F','여','여자','FEMALE','여성'].indexOf(g)>=0)return'F';return g;};
  const _s=function(v){return String(v==null?'':v).trim();};
  const valid=list.filter(function(e){
    const en=_s(e.name), eg=_ng(e.gender);
    const resolved=students.some(function(s){
      return _s(s.name)===en && _ng(s.gender)===eg
        && _s(s.grade)===_s(e.grade)
        && _s(s.cls!=null?s.cls:s.class_num)===_s(e.cls)
        && _s(s.num!=null?s.num:s.student_num)===_s(e.num);
    });
    return !resolved; /* 해결된 항목만 제거, 나머지는 유지 */
  });
  if(valid.length!==list.length)_stuUnmatchedSet(valid);
  return valid;
}
/* 학생 일괄 등록 패널 미매칭 배너 — 미매칭 있으면 '🔗 수동 매칭' 버튼 노출(재진입 시에도 유지) */
function _apStuRenderUnmatched(){
  const host=document.getElementById('apStuUnmatched'); if(!host)return;
  const list=_stuUnmatchedRevalidate();
  if(!list.length){ host.innerHTML=''; return; }
  host.innerHTML='<div style="margin:8px 0;padding:10px 14px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.06);border-radius:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
    +'<span style="font-size:12px;font-weight:700;color:#d97706">⚠ 확인이 필요한 미매칭 학생 '+list.length+'명</span>'
    +'<span style="font-size:10.5px;color:var(--t3);flex:1;min-width:120px">반·번호는 같으나 이름이 다른 경우 등으로 자동 매칭이 안 됐습니다. 실제 학생에게 수동 연결하거나 삭제하세요.</span>'
    +'<button data-action="_apStuUnmatchedModal" style="padding:6px 12px;font-size:11px;font-weight:700;border-radius:7px;border:1px solid rgba(6,182,212,0.4);background:rgba(6,182,212,0.1);color:var(--cyan);cursor:pointer;font-family:var(--f)">🔗 수동 매칭</button>'
    +'</div>';
}
function _stuApplyToStudent(s,cur){
  /* s = 사용자가 고른 기존 DB 학생(uid 유지) ← cur(엑셀 행) 정보로 갱신(개명/정정). 보건일지 기록은 uid 로 보존. */
  if(!(window.electronAPI&&window.electronAPI.studentsUpsert))return;
  const _v=function(a,b){return (a!=null&&a!=='')?a:b;};
  window.electronAPI.studentsUpsert({
    uid:s.uid||s.id,
    name:cur.name||s.name,
    grade:_v(cur.grade,s.grade),
    class_num:_v(cur.cls,(s.cls!=null?s.cls:s.class_num)),
    student_num:_v(cur.num,(s.num!=null?s.num:s.student_num)),
    gender:_v(cur.gender,s.gender),
    birth_date:_v(cur.birth,(s.birth||s.birth_date||'')),
    type:'student',
    level:_v(cur.level,s.level||''),
    department:_v(cur.department,s.department||''),
    is_care:s.is_care||0, care_reason:s.care_reason||s.condition||'', dust_disease:s.dust_disease||'', care_memo:s.care_memo||'',
    med_consent:s.med_consent||s.medConsent||'Y', emergency_consent:s.emergency_consent||s.emergencyConsent||'Y'
  },String(_academicYear())).then(function(){
    if(typeof _reloadStudentsFromDB==='function')_reloadStudentsFromDB().then(function(){ bus.emit('render:daily'); bus.emit('render:dashboard'); });
  }).catch(function(e){console.warn('[stu-match] upsert 실패:',e);});
}
function _apStuUnmatchedModal(){
  const list=_stuUnmatchedRevalidate();
  if(!list.length){ bus.emit('toast:show',{text:'미매칭 학생이 없습니다.'}); return; }
  _apCmOpen(list,{
    title:'🔗 학생 미매칭 수동 매칭',
    subtitle:'아래는 올해 등록된 적이 있던 명단입니다. 이들과 비교했을 때 반과 번호는 같으나 이름이 다른 경우 등으로 자동 매칭이 되지 않았습니다. 실제 학생을 고르면 그 학생 정보가 엑셀 내용으로 갱신됩니다.',
    deleteLabel:'🗑 이 미매칭 삭제',
    metaFn:function(cur){ return cur.conflict||'이름 다름'; },
    onMatch:_stuApplyToStudent,
    onRemove:function(cur){ _stuUnmatchedRemove(_stuUnmatchedRowKey(cur)); },
    /* 신규 인원으로 등록 — 자리 점유자(다른 이름)와 다른 사람일 때 새 uid 발급 등록 (사용자 요청 2026-06-12).
     * uid 없이 upsert → 백엔드 자리 매칭이 "같은 자리 다른 이름 = 새 uid" 규칙으로 처리. */
    onNew:function(cur){
      if(!(window.electronAPI&&window.electronAPI.studentsUpsert))return;
      window.electronAPI.studentsUpsert({
        name:cur.name||'', grade:cur.grade, class_num:cur.cls, student_num:cur.num,
        gender:cur.gender||'', birth_date:cur.birth||'', level:cur.level||'', department:cur.department||''
      }, String(_academicYear())).then(function(){
        if(typeof _reloadStudentsFromDB==='function')_reloadStudentsFromDB().then(function(){ bus.emit('render:daily'); bus.emit('render:dashboard'); });
      }).catch(function(e){ bus.emit('toast:show',{text:'신규 등록 실패: '+e.message}); });
    },
    refreshBanner:_apStuRenderUnmatched,
    matchToast:function(s,cur){ return (cur.name||'')+' → '+s.name+' 매칭 완료'; }
  });
}
/* settings-tab-people.js(비교 팝업)에서 호출할 수 있도록 전역 노출 */
if(typeof window!=='undefined'){
  window._stuUnmatchedAdd=_stuUnmatchedAdd;
  window._apStuRenderUnmatched=_apStuRenderUnmatched;
  window._apStuUnmatchedModal=_apStuUnmatchedModal;
}
function _apCareBulkProcess(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      /* 헤더 행 자동 탐색(제목/안내 행이 위에 끼어도 OK) + 헤더 정규화 매칭("반 (필수)"·"성 명" 견고). */
      const _tbl=parseXLSXTable(new Uint8Array(e.target.result));
      const headers=_tbl.headers, rows=_tbl.rows;
      if(!rows.length){bus.emit('toast:show', {text: '데이터가 없습니다'});return;}
      const _find=function(re){return headers.find(function(h){return re.test(_normHeader(h));});};
      const hGrade=_find(/학년/);
      const hCls=_find(/^반$|반/);
      const hNum=_find(/번호|^번$/);
      const hName=_find(/이름|성명|name/i);
      const hCare=_find(/요보호/);
      const hDust=_find(/미세먼지|기저질환/);
      const hMemo=_find(/메모|주의/);
      const hLevel=_find(/학교급|학교구분/);
      const hDept=_find(/학과|계열/);
      if(!hName){
        const _det=(headers||[]).filter(function(h){return String(h==null?'':h).trim();}).join(', ')||'(머리글을 못 읽음)';
        alert('이름(성명) 열을 찾을 수 없어 등록을 진행할 수 없습니다.\n\n· 첫 번째 시트에서 읽은 머리글: '+_det+'\n\n→ 다운로드한 양식의 1행(머리글)은 절대 변경하면 안 됩니다.\n   처음 제시된 1행을 그대로 둔 채, 아래에 데이터만 채워 다시 올려주세요.\n   (1행을 지우거나 글자를 바꾸거나 셀을 병합하면 이름 열을 인식하지 못합니다.)');
        return;
      }
      /* 파싱만 하고, 학생/교직원과 동일하게 '지능 비교 결과' 팝업으로 적용/미매칭을 보여준 뒤 [확인]으로 반영
         (사용자 요청 2026-06-07). 미매칭(명단에 없는 학생)은 [🔗 수동 매칭]으로 처리. */
      const parsed=[];
      rows.forEach(function(r){
        const name=String(r[hName]||'').trim();if(!name)return;
        const grade=hGrade?String(r[hGrade]==null?'':r[hGrade]).trim():'';
        const cls=hCls?normalizeClassInput(r[hCls]):'';
        const num=hNum?String(r[hNum]==null?'':r[hNum]).trim():'';
        const careReason=hCare?String(r[hCare]||'').trim():'';
        const dustDisease=hDust?String(r[hDust]||'').trim():'';
        const memo=hMemo?String(r[hMemo]||'').trim():'';
        const row={name:name,grade:grade,cls:cls,num:num,level:hLevel?String(r[hLevel]||'').trim():'',department:hDept?String(r[hDept]||'').trim():'',careReason:careReason,dustDisease:dustDisease,memo:memo};
        const match=matchCareStudent(S.people,row);
        row.found=match.student;row.matchReason=match.reason;parsed.push(row);
      });
      /* 한 파일에서 같은 학생을 여러 번 덮어쓰지 않는다. 중복 행은 사람이 확인한다. */
      const counts=new Map();
      parsed.forEach(function(p){if(p.found){const uid=String(p.found.uid||p.found.id);counts.set(uid,(counts.get(uid)||0)+1);}});
      parsed.forEach(function(p){if(p.found&&counts.get(String(p.found.uid||p.found.id))>1){p.found=null;p.matchReason='duplicate-row';}});
      if(!parsed.length){bus.emit('toast:show',{text:'등록할 데이터가 없습니다'});return;}
      const _modal=document.getElementById('addPersonModal');
      const vArea=(_modal&&_modal.querySelector('#careValidationArea'))||document.getElementById('careValidationArea');
      _showCareCompareGUI(vArea, parsed);
    }catch(ex){bus.emit('toast:show', {text: '파일 읽기 오류: '+ex.message});}
  };reader.readAsArrayBuffer(file);
}
/* ── 요보호·미세먼지 DB/엑셀 지능 비교 결과 GUI (학생/교직원과 동일 톤) ──
 *  적용대상(동일/변경)과 미매칭(명단에 없는 학생)을 보여주고 [확인]으로 적용.
 *  미매칭은 [🔗 수동 매칭](확인 오른편, 미매칭 있을 때만 활성)으로 처리. (사용자 요청 2026-06-07) */
function _carePendingRow(p){
  return {name:p.name,grade:p.grade,cls:p.cls,num:p.num,level:p.level||'',department:p.department||'',careReason:p.careReason,dustDisease:p.dustDisease,memo:p.memo,matchReason:p.matchReason||''};
}
let _careBulkSaving=false;
async function _applyCareRows(parsed){
  if(_careBulkSaving)return {success:false,busy:true,matched:0,failed:0,unmatched:0,skipped:0};
  _careBulkSaving=true;
  let matched=0,failed=0,skipped=0;const pending=[];
  try{
    for(const p of parsed){
      if(p._applied){matched++;continue;}
      if(!p.found){pending.push(_carePendingRow(p));continue;}
      const current=matchCareStudent(S.people,p);
      if(!current.student||String(current.student.uid||current.student.id)!==String(p.found.uid||p.found.id)){
        p.matchReason='roster-changed';pending.push(_carePendingRow(p));continue;
      }
      const changes=_careImportChanges(p);
      if(!Object.keys(changes).length){skipped++;continue;}
      const result=await _persistCare(current.student,changes);
      if(result.success){p._applied=true;matched++;_careUnmatchedRemove(_careUnmatchedRowKey(p));}
      else{failed++;p.matchReason='save-failed';pending.push(_carePendingRow(p));}
    }
    const pendingSaved=!pending.length||_careUnmatchedAdd(pending)!==false;
    _apCareRenderUnmatched();_careRefreshSaved();
    const unmatched=pending.length-failed;
    const text=matched+'명 저장 완료'+(failed?' · '+failed+'명 저장 실패 (다시 시도해 주세요)':'')+(unmatched?' · '+unmatched+'명 매칭 확인 필요':'')+(skipped?' · 빈 내용 '+skipped+'건 건너뜀':'')+(!pendingSaved?' · 확인 필요 항목을 임시 보관하지 못했습니다. 원본 엑셀을 보관하고 다시 시도해 주세요.':'');
    const msg=document.getElementById('apCareBulkMsg');if(msg)msg.textContent=text;
    bus.emit('toast:show',{text:text});
    return {success:failed===0&&pendingSaved,pendingSaved:pendingSaved,matched:matched,failed:failed,unmatched:unmatched,skipped:skipped};
  }finally{_careBulkSaving=false;}
}
function _showCareCompareGUI(vArea, parsed){
  const _applyAll=function(){return _applyCareRows(parsed);};
  if(!vArea)return _applyAll();
  const _cv=function(v){return String(v==null?'':v).trim();};
  const identical=[], updated=[], unmatched=[];
  parsed.forEach(function(p){
    if(!p.found){ unmatched.push(p); return; }
    const f=p.found;
    const wouldChange=(p.careReason && _cv(p.careReason)!==_cv(f.condition||f.care_reason))
      || (p.dustDisease && _cv(p.dustDisease)!==_cv(f.dust_disease||f.dustDisease))
      || (p.memo && _cv(p.memo)!==_cv(f.care_memo||f.careMemo));
    (wouldChange?updated:identical).push(p);
  });
  const _CAT={'동일':{c:'#16a34a',bg:'rgba(34,197,94,0.12)'},'변경':{c:'#0d9488',bg:'rgba(20,184,166,0.12)'},'미매칭':{c:'#e11d48',bg:'rgba(244,63,94,0.12)'}};
  const _roster=[];
  identical.forEach(function(p){_roster.push({p:p,cat:'동일'});});
  updated.forEach(function(p){_roster.push({p:p,cat:'변경'});});
  unmatched.forEach(function(p){_roster.push({p:p,cat:'미매칭'});});
  const _act=updated.length+unmatched.length;       /* [확인] 활성 조건 */
  const _hasUnmatched=unmatched.length>0;            /* [수동 매칭] 활성 조건 */

  let h='<div style="padding:14px;border:2px solid rgba(245,158,11,0.3);border-radius:10px;background:rgba(245,158,11,0.04);margin-top:10px;max-height:70vh;overflow-y:auto">';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:3;background:var(--bg2);border-bottom:1px solid var(--bdr);padding:2px 0 8px;margin-bottom:12px">'
    +'<div style="font-size:13px;font-weight:800;color:#f59e0b">⚠ DB/엑셀 지능 비교 결과 (요보호·미세먼지)</div>'
    +'<div style="display:flex;gap:8px;flex-shrink:0">'
    +'<button class="btn btn-outline btn-sm" data-care-cmp="cancel" style="font-size:11px">'+(_act===0?'닫기':'취소')+'</button>'
    +'<button class="btn btn-primary btn-sm" data-care-cmp="confirm"'+(_act===0?' data-noact="1"':'')+' style="font-size:11px'+(_act===0?';opacity:0.45;cursor:not-allowed':'')+'">확인 (업로드 진행)</button>'
    +'<button class="btn btn-sm" data-care-cmp="match" style="font-size:11px;font-weight:700;border-radius:7px;border:1px solid rgba(6,182,212,0.4);background:rgba(6,182,212,0.1);color:var(--cyan)'+(_hasUnmatched?'':';opacity:0.45;cursor:not-allowed')+'">🔗 수동 매칭'+(_hasUnmatched?' ('+unmatched.length+')':'')+'</button>'
    +'</div></div>';
  h+='<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">'
    +'<span style="padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(34,197,94,0.1);color:#16a34a;font-weight:700">동일 '+identical.length+'명</span>'
    +'<span style="padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(20,184,166,0.1);color:#0d9488;font-weight:700">변경 '+updated.length+'명</span>'
    +'<span style="padding:3px 10px;font-size:10px;border-radius:10px;background:rgba(244,63,94,0.1);color:#e11d48;font-weight:700">미매칭 '+unmatched.length+'명</span>'
    +'</div>';
  if(_hasUnmatched){
    h+='<div style="margin-bottom:12px;padding:10px 12px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.06);border-radius:8px">';
    h+='<div style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:4px">🔗 확인 필요 '+unmatched.length+'명 — 학생을 한 명으로 확정하지 못했습니다</div>';
    h+='<div style="font-size:10px;color:var(--t3);margin-bottom:6px;line-height:1.6">학년·반·번호·이름과 학교급·학과를 확인해 주세요. 동명이인이나 파일 내 중복 행은 자동 적용하지 않습니다. [🔗 수동 매칭]에서 실제 학생을 선택하세요.</div>';
    h+='<div style="display:flex;flex-direction:column;gap:3px">';
    unmatched.forEach(function(p){
      const _pos=(p.grade?p.grade+'학년 ':'')+(String(p.cls)!==''?p.cls+'반 ':'')+(p.num?p.num+'번':'');
      h+='<div style="font-size:10px;color:var(--t2)">• <b>'+escHtml(p.name||'')+'</b> '+escHtml(_pos)+'</div>';
    });
    h+='</div></div>';
  }
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:8px">엑셀의 빈 질환명·메모는 기존 내용을 지우지 않습니다. 삭제하려면 개별 수정 또는 해제를 이용해 주세요.</div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:6px">📋 확인한 명단 <span style="font-size:10px;color:var(--t3);font-weight:600">('+_roster.length+'명)</span></div>';
  h+='<div style="max-height:300px;overflow-y:auto;border:1px solid var(--bdr);border-radius:6px"><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr style="background:var(--bg2);position:sticky;top:0">'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">구분</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">학년</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">반</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">번호</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">이름</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">요보호 질환명</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">미세먼지 기저질환</th>'
    +'<th style="border-bottom:1px solid var(--bdr);padding:5px">메모</th>'
    +'</tr></thead><tbody>';
  _roster.forEach(function(row){
    const p=row.p; const cc=_CAT[row.cat]||{c:'#64748b',bg:'rgba(100,116,139,0.12)'};
    h+='<tr>'
      +'<td style="padding:4px;text-align:center"><span style="display:inline-block;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;color:'+cc.c+';background:'+cc.bg+'">'+row.cat+'</span></td>'
      +'<td style="padding:4px;text-align:center">'+escHtml(p.grade||'-')+'</td>'
      +'<td style="padding:4px;text-align:center">'+escHtml(String(p.cls)!==''?p.cls:'-')+'</td>'
      +'<td style="padding:4px;text-align:center">'+escHtml(p.num||'-')+'</td>'
      +'<td style="padding:4px;font-weight:600">'+escHtml(p.name||'')+'</td>'
      +'<td style="padding:4px">'+escHtml(p.careReason||'')+'</td>'
      +'<td style="padding:4px">'+escHtml(p.dustDisease||'')+'</td>'
      +'<td style="padding:4px">'+escHtml(p.memo||'')+'</td>'
      +'</tr>';
  });
  h+='</tbody></table></div></div>';
  vArea.innerHTML='<div class="compare-panel">'+h+'</div>';
  vArea.style.display='block';
  const _close=function(){ _ambHideTip(); vArea.style.display='none'; vArea.innerHTML=''; };
  const cancelB=vArea.querySelector('[data-care-cmp="cancel"]');
  if(cancelB)cancelB.addEventListener('click',_close);
  const confirmB=vArea.querySelector('[data-care-cmp="confirm"]');
  if(confirmB){
    if(_act>0){ confirmB.addEventListener('click',function(){return _runApply(false);}); }
    else { confirmB.addEventListener('mouseenter',function(){_ambShowTip(this,'적용하거나 변경할 내용이 없습니다');}); confirmB.addEventListener('mouseleave',_ambHideTip); }
  }
  const matchB=vArea.querySelector('[data-care-cmp="match"]');
  if(matchB){
    if(_hasUnmatched){ matchB.addEventListener('click',function(){return _runApply(true);}); }
    else { matchB.addEventListener('mouseenter',function(){_ambShowTip(this,'수동 매칭할 미매칭 인원이 없습니다');}); matchB.addEventListener('mouseleave',_ambHideTip); }
  }
  async function _runApply(openMatching){
    if(_careBulkSaving)return;
    [confirmB,matchB,cancelB].forEach(function(b){if(b)b.disabled=true;});
    if(confirmB)confirmB.textContent='저장 중…';
    try{
      const result=await _applyAll();
      if(result.success||(openMatching&&result.pendingSaved))_close();
      else if(confirmB)confirmB.textContent='실패 항목 다시 시도';
      if(openMatching&&result.pendingSaved)_apCareUnmatchedModal();
    }catch(_){bus.emit('toast:show',{text:'일괄 저장을 완료하지 못했습니다. 다시 시도해 주세요.'});}
    finally{[confirmB,matchB,cancelB].forEach(function(b){if(b)b.disabled=false;});}
  }
}

/* ── 요보호 & 미세먼지 기저질환 개별 등록/수정/삭제 ──
   학년별 필터 + 학생 칩 열거 방식 대신 통합 상세 검색 팝업(openPersonSearch) 사용 */
let _apCareMode='edit';   /* 'add' = 개별 등록, 'edit' = 개별 수정/삭제 */
function _apCareAction(mode){
  _apCareMode=(mode==='add')?'add':'edit';
  const _isAdd=_apCareMode==='add';
  const body=document.getElementById('apCareBody');if(!body)return;
  if(!_isAdd){
    /* 수정/삭제: 전체 학생 검색 대신 '등록된 명단' 팝업 모달에서 선택 (사용자 요청 2026-06-02) */
    body.innerHTML='<div style="margin-bottom:10px"><span data-action="_apBack" data-arg="care" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← 뒤로</span></div>'
      +'<div style="padding:16px;border:1px dashed var(--bdr);border-radius:10px;background:var(--bg2);text-align:center;font-size:11px;color:var(--t3)">명단 팝업 또는 아래 표에서 <b style="color:var(--t1)">수정 / 해제</b>할 학생을 선택하세요.</div>';
    _apCareOpenEditList();
    return;
  }
  body.innerHTML = '<div style="margin-bottom:10px"><span data-action="_apBack" data-arg="care" style="font-size:11px;color:var(--cyan);cursor:pointer;font-weight:600">← 뒤로</span></div>'
    + '<div style="padding:16px;border:1px dashed var(--bdr);border-radius:10px;background:var(--bg2);text-align:center">'
    + '<div style="font-size:11px;color:var(--t2);margin-bottom:8px">🔎 요보호 / 미세먼지 기저질환을 <b>등록</b>할 학생을 검색하세요</div>'
    + '<button class="btn btn-primary btn-sm" data-action="_apCareOpenSearch" style="padding:8px 18px">학생 선택</button>'
    + '<div style="font-size:10px;color:var(--t3);margin-top:8px;line-height:1.6">요보호·미세먼지 상태가 아이콘(🟠/🟡) 으로 표시됩니다. 학생 카드 클릭 시 등록 화면으로 이동합니다.</div>'
    + '</div>'
    + '<div id="apCareIndivList" style="margin-top:12px"></div>';
  /* 진입 즉시 팝업 열기 */
  setTimeout(function(){ _apCareOpenSearch(); }, 100);
}
function _apCareIndiv(){ _apCareAction('edit'); }   /* 하위호환 */
function _apCareOpenSearch(){
  openPersonSearch({
    title: '🔎 요보호 · 미세먼지 기저질환 대상 학생 선택',
    type: 'student', allowStaff: false,
    overlayId: 'apCareSearchOverlay', closeOnPick: true,
    onPick: function(id){ _apCarePickStudent(id); }
  });
}
/* ── 개별 수정/삭제: 등록된 요보호·미세먼지 명단 팝업 모달 (사용자 요청 2026-06-02) ──
 *  · 전체 학생 검색 대신, 실제 등록된 학생만 표로 띄워 선택.
 *  · 행 클릭 → 모달(애니메이션) 닫고 → 편집 폼(_apCarePickStudent).
 *  · 수정/해제로 명단 변하면 _apCareRefreshLists 가 _apCareRenderEditList 로 즉시 갱신. */
let _apCareEditListQuery='';
function _apCareOpenEditList(){
  const old=document.getElementById('apCareEditListOverlay');
  if(old){ if(old.parentNode)old.parentNode.removeChild(old); }
  _apCareEditListQuery='';
  const ov=document.createElement('div'); ov.id='apCareEditListOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:11000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.40);opacity:0;transition:opacity 0.18s ease';
  ov.innerHTML='<div id="apCareEditListBox" style="background:var(--card);border-radius:14px;width:720px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.18s ease,transform 0.18s ease">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;justify-content:space-between">'
      +'<span style="font-size:15px;font-weight:800;color:var(--t1)">🛡 요보호 & 미세먼지 기저질환 명단 <span id="apCareEditListCount" style="font-size:11px;color:var(--t3);font-weight:600"></span></span>'
      +'<span data-action="_apCareEditListClose" style="cursor:pointer;font-size:18px;color:var(--t3);padding:2px 6px">✕</span>'
    +'</div>'
    +'<div style="padding:12px 18px 6px;flex-shrink:0">'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:8px">수정 또는 해제할 학생을 클릭하세요.</div>'
      +'<input class="form-input pm-oninput" data-input-handler="_apCareEditListSearchInput" id="apCareEditListSearch" placeholder="🔍 이름·초성으로 검색" style="font-size:12px;width:100%;padding:8px 10px" autocomplete="off">'
    +'</div>'
    +'<div id="apCareEditListBody" style="flex:1;overflow:auto;padding:0 18px 18px"></div>'
    +'</div>';
  document.body.appendChild(ov);
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)_apCareEditListClose(); });
  _pmDelegate(ov);          /* data-action 디스패치 (모달이 body 직속이라 명시 부착 필요) */
  _pmBindUpload(ov);        /* data-input-handler 검색 바인딩 */
  const box=ov.querySelector('#apCareEditListBox');
  requestAnimationFrame(function(){ ov.style.opacity='1'; if(box){box.style.opacity='1';box.style.transform='scale(1)';} });
  _apCareRenderEditList();
  setTimeout(function(){ const inp=document.getElementById('apCareEditListSearch'); if(inp){try{inp.focus();}catch(_){}} },80);
}
function _apCareEditListClose(){
  const ov=document.getElementById('apCareEditListOverlay'); if(!ov)return;
  const box=ov.querySelector('#apCareEditListBox');
  ov.style.opacity='0'; if(box){box.style.opacity='0';box.style.transform='scale(0.96)';}
  setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },180);
}
function _apCareEditListSearchInput(el){ _apCareEditListQuery=String(el&&el.value||''); _apCareRenderEditList(); }
function _apCareRenderEditList(){
  const host=document.getElementById('apCareEditListBody'); if(!host)return;
  const _k=isKinder();
  const careAll=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch'||(s.dustDisease&&s.dustDisease.trim()));});
  const _q=String(_apCareEditListQuery||'').trim();
  const filtered=_q?careAll.filter(function(s){return _apTbNameMatch(s.name||'',_q);}):careAll.slice();
  _apStuSort(filtered);
  const cnt=document.getElementById('apCareEditListCount');
  if(cnt)cnt.textContent='('+(_q?(filtered.length+'/'+careAll.length):('총 '+careAll.length))+'명)';
  if(!filtered.length){
    host.innerHTML='<div style="padding:30px;text-align:center;color:var(--t3);font-size:12px">'+(_q?'검색 결과가 없습니다.':'등록된 요보호 / 미세먼지 기저질환 학생이 없습니다.')+'</div>';
    return;
  }
  let h='<style>#apCareEditListTable .apcare-erow:hover{background:rgba(6,182,212,0.08)}</style>';
  h+='<table id="apCareEditListTable" style="width:100%;border-collapse:collapse;font-size:11px">';
  h+='<thead style="position:sticky;top:0;background:var(--bg2);z-index:1"><tr>';
  h+='<th style="'+_AP_TH+';width:32px">순</th>';
  h+='<th style="'+_AP_TH+';width:64px">'+(_k?'나이':'학년반')+'</th>';
  h+='<th style="'+_AP_TH+';width:40px">'+(_k?'반':'번')+'</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';width:80px">이름</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+'">요보호 질환명</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+'">미세먼지 기저질환명</th>';
  h+='</tr></thead><tbody>';
  filtered.forEach(function(s,i){
    const careText=s.condition||s.care_reason||'';
    const dustText=s.dustDisease||s.dust_disease||'';
    h+='<tr class="apcare-erow" data-action="_apCareEditListPick" data-arg="'+s.id+'" title="클릭하여 수정 / 해제" style="border-bottom:1px solid var(--bdrl);cursor:pointer">';
    h+='<td style="'+_AP_TD+';text-align:center;color:var(--t3);font-size:10px">'+(i+1)+'</td>';
    h+='<td style="'+_AP_TD+';text-align:center">'+(_k?('만'+s.grade+'세'):(s.grade+'-'+s.cls))+'</td>';
    h+='<td style="'+_AP_TD+';text-align:center">'+(_k?(s.cls||''):(s.num||''))+'</td>';
    h+='<td style="'+_AP_TD+';font-weight:600;white-space:nowrap">'+escHtml(s.name||'')+'</td>';
    h+='<td style="'+_AP_TD+';font-size:10px;color:var(--t2)">'+escHtml(careText)+'</td>';
    h+='<td style="'+_AP_TD+';font-size:10px;color:var(--t2)">'+escHtml(dustText)+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table>';
  host.innerHTML=h;
}
function _apCareEditListPick(id){
  _apCareEditListClose();
  _apCareMode='edit';
  setTimeout(function(){
    _apCarePickStudent(id);
    const b=document.getElementById('apCareBody');
    if(b&&b.scrollIntoView){try{b.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(_){}}
  },200);
}

/* ── 의약품 비동의 개별 등록 ── */
function _apMcIndiv(){
  const body=document.getElementById('apMcBody');if(!body)return;
  body.innerHTML=_apGradeCards('_apMcGrade');
}
function _apMcGrade(grade){
  const body=document.getElementById('apMcBody');if(!body)return;
  body.innerHTML=_apClassDiagram(grade,'_apMcClass','학년 선택','_apMcIndiv()');
}
function _apMcClass(grade,cls){
  const body=document.getElementById('apMcBody');if(!body)return;
  const stuList=S.people.filter(function(s){return s.type==='student'&&String(s.grade)===String(grade)&&String(s.cls)===String(cls);});
  stuList.sort(function(a,b){return(a.num||0)-(b.num||0);});
  let h='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px">'+grade+'학년 '+cls+'반 — 일반의약품 투여 비동의 설정</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">';
  stuList.forEach(function(s){
    const isN=(s.med_consent==='N'||s.medConsent==='N');   /* 로드 학생은 medConsent(카멜)만 있음 — 양쪽 읽기 (2026-07-23) */
    h+='<div id="mcStu_'+s.id+'" data-action="mc-toggle-stu" data-stu-id="'+s.id+'" style="cursor:pointer;padding:8px 12px;border:2px solid '+(isN?'#8B5CF6':'var(--bdr)')+';border-radius:10px;background:'+(isN?'rgba(139,92,246,0.08)':'var(--card)')+';transition:all 0.15s;text-align:center;min-width:60px">';
    h+='<div style="font-size:11px;font-weight:700;color:var(--t1)">'+escHtml(s.name)+'</div>';
    h+='<div style="font-size:9px;color:var(--t3)">'+s.num+'번</div>';
    if(isN)h+='<div class="mc-badge" style="font-size:9px;font-weight:700;color:#dc2626;margin-top:2px">비동의</div>';
    h+='</div>';
  });
  h+='</div>';
  h+='<button class="btn btn-primary btn-sm" data-action="mc-save-all" style="width:100%">저장</button>';
  h+='<div style="margin-top:4px;font-size:10px;color:var(--t3);text-align:center">학생을 클릭하여 지정한 후 확인 버튼을 누르면 일반의약품 투여에 비동의한 것으로 처리됩니다.</div>';
  body.innerHTML=h;
  /* addEventListener 바인딩 — 학생 토글 + 저장 */
  body.querySelectorAll('[data-action="mc-toggle-stu"]').forEach(function(el){
    el.addEventListener('click',function(){_apMcToggleStu(this.dataset.stuId);});
  });
  const _saveBtn=body.querySelector('[data-action="mc-save-all"]');
  if(_saveBtn)_saveBtn.addEventListener('click',function(){_apMcSaveAll(grade,cls);});
}
function _apMcToggleStu(id){
  const s=getStu(id);if(!s)return;
  /* 현재값을 스네이크·카멜 양쪽에서 읽고, 새 값을 양쪽에 써서 표시·저장이 일치하게 함 (2026-07-23) */
  const _cur=(s.med_consent==='N'||s.medConsent==='N')?'N':'Y';
  const _new=_cur==='N'?'Y':'N';
  s.med_consent=_new; s.medConsent=_new;
  const el=document.getElementById('mcStu_'+id);
  if(el){
    const isN=s.med_consent==='N';
    el.style.borderColor=isN?'#8B5CF6':'var(--bdr)';
    el.style.background=isN?'rgba(139,92,246,0.08)':'var(--card)';
    const nameDiv=el.querySelector('div:first-child');
    const existBadge=el.querySelector('.mc-badge');
    if(isN&&!existBadge){el.insertAdjacentHTML('beforeend','<div class="mc-badge" style="font-size:9px;font-weight:700;color:#dc2626;margin-top:2px">비동의</div>');}
    if(!isN&&existBadge)existBadge.remove();
  }
}
function _apMcSaveAll(grade,cls){
  const stuList=S.people.filter(function(s){return s.type==='student'&&String(s.grade)===String(grade)&&String(s.cls)===String(cls);});
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='저장 중\u2026';toast.className='global-save-toast show saving';}
  stuList.forEach(function(s){
    if(window.electronAPI&&window.electronAPI.studentsUpsert){
      /* care·emergency_consent 보존 함께 전달 — 생략 시 학급 전체의 요보호·기저질환·응급동의가 지워짐 (사용자 보고 2026-07-23) */
      window.electronAPI.studentsUpsert(Object.assign({name:s.name,grade:s.grade,class_num:s.cls,student_num:s.num,gender:s.gender,birth_date:s.birth,type:s.type,level:s.level||'',department:s.department||''}, _apPreserveCareConsent(s)),String(_academicYear()));
    }
  });
  setTimeout(function(){
    if(toast){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);}
    bus.emit('render:daily');
  },300);
}

/* _apStuAction에 'bulk' 분기 추가 */
const _origApStuAction=typeof _apStuAction==='function'?_apStuAction:null;

/* ── 요보호 명단 팝업 ── */
function _apCareListPopup(){
  const careList=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch'||(s.dustDisease&&s.dustDisease.trim()));});
  _apStuSort(careList);
  const existing=document.getElementById('apCareListPopup');if(existing)closeModalGracefully(existing);
  const ov=document.createElement('div');ov.id='apCareListPopup';
  ov.style.cssText='position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)';
  ov.innerHTML='<div style="background:var(--card);border-radius:14px;width:760px;max-width:95vw;max-height:88vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.3);padding:0;position:relative">'
    +'<div style="padding:16px 20px;border-bottom:1px solid var(--glass-border);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:1;border-radius:14px 14px 0 0">'
    +'<span style="font-size:15px;font-weight:800;color:var(--t1)">🛡 '+(function(){const n=new Date();return(n.getMonth()>=2?n.getFullYear():n.getFullYear()-1);})()+'학년도 요보호 & 미세먼지 기저질환 학생 명단</span></div>'
    +'<div style="padding:16px 20px">'+_careListPanelHtml(careList,'')+'</div></div>';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  /* 행 선택 패턴 부착 — 학생/교직원과 동일 */
  setTimeout(function(){
    if(typeof _apAttachRowSelection==='function')_apAttachRowSelection('apCareListPopup','student',careList);
  },50);
}

/* ── 비동의 명단 팝업 ── */
function _apMcListPopup(){
  const mcList=S.people.filter(function(s){return s.type==='student'&&s.med_consent==='N';});
  mcList.sort(function(a,b){if(a.grade!==b.grade)return a.grade-b.grade;var _c=compareClass(a.cls,b.cls);if(_c)return _c;return(a.num||0)-(b.num||0);});
  const rows=mcList.map(function(s,i){return[(i+1),s.grade,s.cls,(s.num||'-'),'<b>'+escHtml(s.name)+'</b>'];});
  const _mcAy=(function(){const n=new Date();return(n.getMonth()>=2?n.getFullYear():n.getFullYear()-1);})();
  _apSheetPopup('apMcListPopup','💊',_mcAy+'학년도 일반의약품 투여 비동의 학생 명단',_mcAy+'학년도 일반의약품 투여 비동의 학생 명단',['순','학년','반','번호','이름'],rows,'apMcListTable');
  /* 행 선택 패턴 부착 */
  setTimeout(function(){
    if(typeof _apAttachRowSelection==='function')_apAttachRowSelection('apMcListPopup','student',mcList);
  },50);
}

/* ── 공통 엑셀 형식 시트 팝업 빌더 ── */
function _apSheetPopup(popupId,icon,titleText,sheetTitle,colHeaders,rows,copyId){
  const existing=document.getElementById(popupId);if(existing)closeModalGracefully(existing);
  const yr=new Date().getFullYear();
  const schoolName=S.settings.schoolName||'○○학교';
  const ov=document.createElement('div');ov.id=popupId;
  ov.style.cssText='position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)';
  const colLetters=[];for(let ci=0;ci<colHeaders.length;ci++)colLetters.push(String.fromCharCode(65+ci));
  const bd='border:1px solid #c0c0c0;', pd='padding:3px 5px;', ctr='text-align:center;';
  const _btnS='padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;';
  let h='<div style="background:var(--card);border-radius:14px;width:800px;max-width:96vw;height:85vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.3);overflow:hidden">';
  h+='<div style="padding:16px 20px;border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-shrink:0"><span style="font-size:15px;font-weight:800;color:var(--t1)">'+icon+' '+titleText+'</span><span data-action="sheet-close" style="cursor:pointer;font-size:18px;color:var(--t3);padding:4px">✕</span></div>';
  h+='<div style="padding:12px 20px;flex-shrink:0">';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:6px">총 '+rows.length+'명</div>';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">';
  h+='<button data-action="sheet-copy" style="'+_btnS+'background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none">📋 클립보드 복사</button>';
  h+='<button data-action="sheet-excel" style="'+_btnS+'background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none">📗 Excel 저장</button>';
  h+='<button class="btn-print" data-action="sheet-print">🖨 인쇄</button>';
  h+='</div></div>';
  h+='<div style="flex:1;overflow:auto;padding:0 20px 20px">';
  h+='<div id="'+copyId+'" style="background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:12px;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000">';
  const totalC=colHeaders.length;const halfC=Math.ceil(totalC/2);
  h+='<table style="width:100%;border-collapse:collapse;font-size:10px">';
  h+='<thead>';
  /* 색상바 + 제목 + 색상바 (물품 대여 대장 스타일) */
  h+='<tr><td colspan="'+totalC+'" style="padding:0;border:none"><table style="width:100%;border-collapse:collapse"><tbody>'
    +'<tr><td colspan="'+halfC+'" style="background:#2855A0;height:12px;padding:0;border:none"></td><td colspan="'+(totalC-halfC)+'" style="background:#D4A843;height:12px;padding:0;border:none"></td></tr>'
    +'<tr><td colspan="'+totalC+'" style="background:#F7F7F7;text-align:center;padding:10px 16px;border:none;font-size:16px;font-weight:700;color:#000;letter-spacing:3px">'+yr+'학년도 '+escHtml(schoolName)+' '+sheetTitle+'</td></tr>'
    +'<tr><td colspan="'+Math.ceil(totalC*3/10)+'" style="background:#2E8B57;height:12px;padding:0;border:none"></td><td colspan="'+(totalC-Math.ceil(totalC*3/10))+'" style="background:#C0392B;height:12px;padding:0;border:none"></td></tr>'
    +'</tbody></table></td></tr>';
  h+='<tr><td colspan="'+totalC+'" style="border:none;padding:0;height:12px"></td></tr>';
  /* 컬럼 헤더 */
  h+='<tr style="background:#F7F7F7">';
  colHeaders.forEach(function(ch,ci){
    const bdrExtra=(ci===0?'border-left:2px solid #333;':'')+(ci===colHeaders.length-1?'border-right:2px solid #333;':'');
    h+='<th style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333;'+bdrExtra+'">'+ch+'</th>';
  });
  h+='</tr></thead><tbody>';
  /* 데이터 행 */
  rows.forEach(function(cells,ri){
    const isLast=ri===rows.length-1;
    const btm=isLast?'border-bottom:2px solid #333;':'';
    h+='<tr>';
    cells.forEach(function(cell,ci){
      const bdrExtra=(ci===0?'border-left:2px solid #333;':'')+(ci===cells.length-1?'border-right:2px solid #333;':'');
      h+='<td style="'+bd+pd+ctr+btm+bdrExtra+'">'+cell+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table></div></div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  /* addEventListener 바인딩 — close/copy/print */
  const _closeSpan=ov.querySelector('[data-action="sheet-close"]');
  if(_closeSpan)_closeSpan.addEventListener('click',function(){closeModalGracefully(popupId);});
  const _copyBtn=ov.querySelector('[data-action="sheet-copy"]');
  if(_copyBtn)_copyBtn.addEventListener('click',function(){_apListCopy(copyId);});
  const _excelBtn=ov.querySelector('[data-action="sheet-excel"]');
  if(_excelBtn)_excelBtn.addEventListener('click',function(){_apSheetPopupExcel(titleText,sheetTitle,colHeaders,rows);});
  const _printBtn=ov.querySelector('[data-action="sheet-print"]');
  if(_printBtn)_printBtn.addEventListener('click',function(){_apListPrint(copyId,titleText);});
  document.body.appendChild(ov);
}

/* _apSheetPopup 에서 공용 Excel 저장 — xlsxBuildDiary IPC 재사용, 색상바+제목+헤더+외곽선+Freeze */
function _apSheetPopupExcel(titleText,sheetTitle,colHeaders,rows){
  if(!(window.electronAPI&&window.electronAPI.xlsxBuildDiary)){
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 빌드 IPC 미구성'});
    return;
  }
  const yr=new Date().getFullYear();
  const schoolName=S.settings.schoolName||'○○학교';
  const fullTitle=yr+'학년도 '+schoolName+' '+sheetTitle;
  /* HTML 태그 제거 — <b> 등 포함된 셀을 plain text 로 변환 */
  function _stripHtml(v){return String(v==null?'':v).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();}
  const dataRows=rows.map(function(r){return r.map(_stripHtml);});
  /* 컬럼 너비 기본값 — 헤더 라벨 기반으로 합리적 추정 */
  const colWidths=colHeaders.map(function(lab){
    const L=String(lab||'');
    if(/^순$/.test(L))return 50;
    if(/이름|성명/.test(L))return 120;
    if(/학년|반|번호/.test(L))return 70;
    if(/학교급|직위/.test(L))return 90;
    if(/성별|나이/.test(L))return 70;
    if(/생년월일|날짜|검사일/.test(L))return 120;
    if(/기관|보호자|메모|질환|내용/.test(L))return 180;
    return 100;
  });
  const colCount=colHeaders.length;
  const today=new Date();
  const todayStr=today.getFullYear()+'.'+(today.getMonth()+1)+'.'+today.getDate();
  const periodText='기준일: '+todayStr;
  /* 색상바 pixel-based split */
  const total=colWidths.reduce(function(a,b){return a+b;},0);
  const threshold30=total*0.3;
  let acc=0,top2=0;
  for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=threshold30)break;}
  acc=0;let bot1=0;
  for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=threshold30)break;}
  const top1=Math.max(1,colCount-top2);
  if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 생성 중…'});
  window.electronAPI.xlsxBuildDiary({
    colCount:colCount,
    colWidths:colWidths,
    headerLabels:colHeaders,
    dataRows:dataRows,
    titleText:fullTitle,
    schoolText:'학교: '+schoolName,
    periodText:periodText,
    top1:top1,
    bot1:bot1
  }).then(function(res){
    if(!res||!res.success){
      if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 생성 실패: '+(res&&res.error||'')});
      return;
    }
    const buf=new Uint8Array(res.bytes);
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=fullTitle+'.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
  }).catch(function(e){
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 오류: '+(e&&e.message||e)});
  });
}

/* ── 동의/비동의 칩 HTML ── */
function _apConsentChip(isY){
  return isY
    ?'<span style="display:inline-block;padding:2px 10px;font-size:10px;font-weight:700;border-radius:10px;background:rgba(34,197,94,0.12);color:#16a34a;border:1px solid rgba(34,197,94,0.25);cursor:pointer;user-select:none">✔ 동의</span>'
    :'<span style="display:inline-block;padding:2px 10px;font-size:10px;font-weight:700;border-radius:10px;background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.2);cursor:pointer;user-select:none">✖ 비동의</span>';
}
/* ── 행 HTML ── */
let _apConsentHasLevel=false;
let _apConsentHasDept=false;
function _apConsentRow(s,i){
  const _k=isKinder();
  const ecY=!(s.emergency_consent==='N'||s.emergencyConsent==='N');
  const mcY=!(s.med_consent==='N'||s.medConsent==='N');
  const _lvMap={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  const _lvLabel=s.level?(_lvMap[s.level]||s.level):'';
  /* 학년반 표기: 학교급=유 → "N세 반이름", 나머지 → "학년-반" */
  const _gradeLabel=(_lvLabel==='유')?(s.grade+'세'+(s.cls?' '+s.cls:'')):(s.grade+'-'+s.cls);
  return '<tr data-sid="'+s.id+'" data-grade="'+s.grade+'" data-level="'+escHtml(_lvLabel)+'" style="border-bottom:1px solid var(--bdrl)">'
    +'<td style="padding:5px 6px;text-align:center;color:var(--t3);font-size:10px">'+(i+1)+'</td>'
    +(_apConsentHasLevel?'<td style="padding:5px 6px;text-align:center;font-size:11px;color:var(--t2)">'+escHtml(_lvLabel)+'</td>':'')
    +(_apConsentHasDept?'<td style="padding:5px 6px;text-align:center;font-size:10px;color:var(--t2)">'+escHtml(s.department||'')+'</td>':'')
    +'<td style="padding:5px 6px;text-align:center;font-size:11px">'+escHtml(_gradeLabel)+'</td>'
    +'<td style="padding:5px 6px;text-align:center;font-size:11px">'+(_k?(s.cls||''):(s.num||''))+'</td>'
    +'<td style="padding:5px 14px;font-size:11px;font-weight:600">'+escHtml(s.name)+'</td>'
    +'<td style="padding:5px 6px;text-align:center;cursor:pointer" data-action="_apToggleConsent" data-arg="'+s.id+'" data-arg2="emergency">'+_apConsentChip(ecY)+'</td>'
    +'<td style="padding:5px 6px;text-align:center;cursor:pointer" data-action="_apToggleConsent" data-arg="'+s.id+'" data-arg2="med">'+_apConsentChip(mcY)+'</td>'
    +'</tr>';
}
/* ── 학년 필터 ── */
let _apConsentGradeFilter=0;
function _apConsentFilter(grade){
  _apConsentGradeFilter=grade;
  _apConsentApplyFilters();
}
/* ── 이름/학년반/번호/초성 검색 ── */
function _apConsentSearch(){
  _apConsentApplyFilters();
}
function _apConsentClearSearch(){
  const inp=document.getElementById('apConsentSearch');if(inp)inp.value='';
  const x=document.getElementById('apConsentClear');if(x)x.style.display='none';
  _apConsentApplyFilters();
}
function _apConsentApplyFilters(){
  const inp=document.getElementById('apConsentSearch');
  const q=((inp&&inp.value)||'').trim();
  const xBtn=document.getElementById('apConsentClear');
  if(xBtn)xBtn.style.display=q?'flex':'none';
  const rows=document.querySelectorAll('#apConsentBody tr');
  /* _apConsentGradeFilter 가 "유|5" 같은 문자열이면 학교급+학년 둘 다 매칭, 숫자(0/N)면 학년만 */
  const rawFilter=_apConsentGradeFilter;
  let filterLevel='', filterGrade=0;
  const rfStr=String(rawFilter==null?'':rawFilter);
  if(rfStr==='0'||rfStr===''){filterGrade=0;}
  else if(rfStr.indexOf('|')>=0){const parts=rfStr.split('|');filterLevel=parts[0]||'';filterGrade=Number(parts[1])||0;}
  else {filterGrade=Number(rfStr)||0;}
  let seq=0;
  rows.forEach(function(tr){
    const g=parseInt(tr.dataset.grade,10);
    const lv=(tr.dataset.level||'').trim();
    const passGrade=(filterGrade===0||g===filterGrade);
    const passLevel=(!filterLevel||lv===filterLevel);
    const passLevelGrade=passGrade&&passLevel;
    let passText=true;
    if(q){
      const s=_apConsentStudents&&_apConsentStudents.find(function(p){return String(p.id)===String(tr.dataset.sid);});
      if(s){
        const isStf=s.type==='staff';
        const base=(s.name||'')+' '+(isStf?(s.position||'교직원'):(s.grade+'학년 '+s.cls+'반 '+s.num+'번'));
        const qL=q.toLowerCase();
        passText=base.toLowerCase().indexOf(qL)>=0;
        if(!passText){
          try{
            if(typeof matchKorean==='function'&&matchKorean(s.name||'',q))passText=true;
          }catch(e){}
        }
      } else {
        passText=(tr.textContent||'').toLowerCase().indexOf(q.toLowerCase())>=0;
      }
    }
    if(passLevelGrade&&passText){tr.style.display='';seq++;const firstTd=tr.querySelector('td');if(firstTd)firstTd.textContent=seq;}
    else tr.style.display='none';
  });
}
/* studentsUpsert 는 siUpsert(ON CONFLICT DO UPDATE)로 전 컬럼을 excluded 값으로 덮어쓴다.
 *  → 일부 필드만 담아 저장하면 나머지(요보호·기저질환·동의·VIP)가 지워진다. 그래서 "이 저장으로 바꾸지 않는"
 *  기존 값을 payload 에 반드시 함께 실어 보존해야 한다. 로드된 학생 객체는 카멜케이스(status/condition/
 *  dustDisease/careMemo/medConsent/emergencyConsent/vip)라 스네이크·카멜 양쪽을 폴백으로 읽는다. (사용자 보고 2026-07-23) */
function _apPreserveCareConsent(s){
  return {
    is_care: ((s.status==='caution'||s.status==='watch')||s.is_care===1||s.is_care==='1')?1:0,
    care_reason: s.care_reason||s.condition||'',
    dust_disease: s.dust_disease||s.dustDisease||'',
    care_memo: s.care_memo||s.careMemo||'',
    med_consent: s.med_consent||s.medConsent||'Y',
    emergency_consent: s.emergency_consent||s.emergencyConsent||'Y',
    vip: (s.vip!=null?String(s.vip):'')
  };
}
/* ── 동의/비동의 토글 ── */
function _apToggleConsent(id,type){
  const s=S.people.find(function(x){return x.id===id;});
  if(!s)return;
  const field=type==='emergency'?'emergency_consent':'med_consent';
  const camelField=type==='emergency'?'emergencyConsent':'medConsent';
  const newVal=(s[field]==='N'||s[camelField]==='N')?'Y':'N';
  s[field]=newVal;
  s[camelField]=newVal;
  /* 즉시 DB 저장 */
  if(window.electronAPI&&window.electronAPI.studentsUpsert){
    /* 토글한 동의값(s.med_consent/s.emergency_consent 은 위에서 갱신됨) + 나머지 보존값 함께 전달 */
    const payload=Object.assign({name:s.name,grade:s.grade,class_num:s.cls,student_num:s.num,gender:s.gender,birth_date:s.birth,type:s.type,level:s.level||'',department:s.department||''}, _apPreserveCareConsent(s));
    window.electronAPI.studentsUpsert(payload,String(_academicYear()));
  }
  /* 클릭한 셀 칩 UI 즉시 갱신 */
  const td=document.querySelector('td[data-action="_apToggleConsent"][data-arg="'+id+'"][data-arg2="'+type+'"]');
  if(td) td.innerHTML=_apConsentChip(newVal==='Y');
  /* 시스템 표준 토스트 */
  const toast=document.getElementById('globalSaveToast');
  if(toast){
    toast.textContent='저장 중\u2026';toast.className='global-save-toast show saving';
    setTimeout(function(){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);},300);
  }
}

/* ══════════════════════════════════════════════════════
   학생 명단 팝업 — 컬럼 가시성/순서 변경 (눈알 ON/OFF)
   emergency-view.js의 DAILY_COLS 패턴 적용
   ══════════════════════════════════════════════════════ */
const PM_COLS=[
  {idx:0,key:'seq',label:'순'},
  {idx:1,key:'level',label:'학교급'},
  {idx:2,key:'department',label:'학과'},
  {idx:3,key:'grade',label:'학년'},
  {idx:4,key:'cls',label:'반'},
  {idx:5,key:'num',label:'번호'},
  {idx:6,key:'name',label:'이름'},
  {idx:7,key:'gender',label:'성별'},
  {idx:8,key:'birth',label:'생년월일'},
  {idx:9,key:'guardian',label:'보호자연락처'},
  {idx:10,key:'care',label:'요보호'},
  {idx:11,key:'memo',label:'메모'}
];
const _PM_MANDATORY=[0,6]; /* 순, 이름은 항상 표시 */
function _getPmColOrder(){
  let saved=JSON.parse(localStorage.getItem('pmColOrder')||'null');
  const def=PM_COLS.map(function(c){return c.idx;});
  if(!Array.isArray(saved)) return def;
  saved=saved.map(function(v){return parseInt(v,10);}).filter(function(v){return !isNaN(v);});
  def.forEach(function(v){if(saved.indexOf(v)===-1)saved.push(v);});
  return saved.filter(function(v,i,a){return a.indexOf(v)===i;});
}
function _savePmColOrder(o){localStorage.setItem('pmColOrder',JSON.stringify(o));}
function _getPmColVis(){
  let v=JSON.parse(localStorage.getItem('pmColVisibility')||'null');
  if(!v){
    const sl=S.settings.schoolLevel||'elementary';
    v={};
    /* 기본: 학교급/학과는 특수학교·고등학교만 표시, 나머지는 숨김 */
    v[1]=(sl==='special'||sl==='high');
    v[2]=(sl==='special'||sl==='high');
    v[10]=false; v[11]=false;
  }
  return v;
}
function _savePmColVis(s){localStorage.setItem('pmColVisibility',JSON.stringify(s));}
const _pmColHistory=[];
function _pushPmColHistory(){_pmColHistory.push({order:_getPmColOrder().slice(),vis:Object.assign({},_getPmColVis())});if(_pmColHistory.length>30)_pmColHistory.shift();}
function _undoPmCol(){
  if(!_pmColHistory.length)return;
  const prev=_pmColHistory.pop();
  _savePmColOrder(prev.order);_savePmColVis(prev.vis);
  const chips=document.getElementById('pmColChips');if(chips)_renderPmColCards(chips);
  _apStuListRefresh();
}
function _pmColEyeIcon(active){
  return active
    ?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"></path><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle></svg>'
    :'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 20.5 20.5"></path><path d="M9.8 6.8A10.8 10.8 0 0 1 12 6.5c4 0 7.3 1.9 9.5 5a14.7 14.7 0 0 1-3.2 3.4"></path><path d="M6.2 9A14.8 14.8 0 0 0 2.5 12c2.2 3.1 5.5 5 9.5 5 1 0 1.9-.1 2.7-.4"></path></svg>';
}
function _renderPmColCards(container){
  container.innerHTML='';
  const order=_getPmColOrder();const vis=_getPmColVis();let dragIdx=null;
  order.forEach(function(idx){
    const col=PM_COLS.find(function(c){return c.idx===idx;});if(!col)return;
    const active=vis[idx]!==false;
    const card=document.createElement('div');
    card.draggable=true;
    card.className='col-setting-card'+(active?' active':'');
    card.dataset.colIndex=idx;
    card.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1.5px solid '+(active?'var(--cyan)':'var(--bdr)')+';border-radius:8px;cursor:grab;font-size:11px;font-weight:600;color:'+(active?'var(--t1)':'var(--t3)')+';opacity:'+(active?'1':'0.5')+';user-select:none;transition:all .15s;margin:3px';
    card.innerHTML='<span style="cursor:grab;color:var(--t3);font-size:10px">☰</span><span style="max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+col.label+'</span><button type="button" class="col-toggle-btn" style="background:none;border:none;cursor:pointer;padding:2px;display:flex;align-items:center;color:'+(active?'var(--cyan)':'var(--t3)')+'" title="'+(active?'필드 숨기기':'필드 표시')+'">'+_pmColEyeIcon(active)+'</button>';
    card.querySelector('.col-toggle-btn').addEventListener('pointerdown',function(e){e.stopPropagation();});
    card.querySelector('.col-toggle-btn').addEventListener('click',function(e){
      e.stopPropagation();
      if(_PM_MANDATORY.indexOf(idx)!==-1)return;
      _pushPmColHistory();
      const state=_getPmColVis();state[idx]=!(state[idx]!==false);_savePmColVis(state);
      _renderPmColCards(container);_apStuListRefresh();
    });
    card.addEventListener('dragstart',function(e){
      if(e.target.closest('.col-toggle-btn')){e.preventDefault();return;}
      dragIdx=idx;card.style.opacity='0.45';
      if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(idx));}
    });
    card.addEventListener('dragend',function(){card.style.opacity=active?'1':'0.5';dragIdx=null;});
    card.addEventListener('dragover',function(e){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';card.style.borderColor='#f59e0b';});
    card.addEventListener('dragleave',function(){card.style.borderColor=active?'var(--cyan)':'var(--bdr)';});
    card.addEventListener('drop',function(e){
      e.preventDefault();card.style.borderColor=active?'var(--cyan)':'var(--bdr)';
      if(dragIdx===null||dragIdx===idx)return;
      _pushPmColHistory();
      const next=_getPmColOrder().slice();const from=next.indexOf(dragIdx), to=next.indexOf(idx);
      if(from===-1||to===-1)return;
      next.splice(to,0,next.splice(from,1)[0]);
      _savePmColOrder(next);_renderPmColCards(container);_apStuListRefresh();
    });
    container.appendChild(card);
  });
}
/* ══ 명단 팝업 공통 행 선택 헬퍼 ══
 * popupId — 부착할 팝업 DOM id
 * listType — 'student' | 'staff' (현재 deletePeople은 동일 처리)
 * dataList — 표시 중인 사람 객체 배열 (uid·id·name 보유) */
const _apRowSelections = {};
function _apAttachRowSelection(popupId, listType, dataList){
  const popup = document.getElementById(popupId);
  if(!popup || popup._rowSelAttached) return;
  popup._rowSelAttached = true;
  /* 선택 상태 (popup 별로) */
  if(!_apRowSelections[popupId]) _apRowSelections[popupId] = new Set();
  const selSet = _apRowSelections[popupId];

  /* 모든 데이터 행 찾기 — _apSheetPopup 헤더 5행 이후가 데이터, _apStuListRefresh도 동일 */
  function _findDataRows(){
    const table = popup.querySelector('table');
    if(!table) return [];
    const allRows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    /* 헤더 6행 건너뛰기 (열번호·색상선·제목·색상선·여백·헤더) */
    return allRows.filter(function(tr, i){
      /* 데이터 행은 인덱스 6부터 시작, 첫 셀이 행번호인지 확인 */
      const firstTd = tr.querySelector('td');
      if(!firstTd) return false;
      const firstTxt = firstTd.textContent.trim();
      /* 첫 셀이 숫자 6 이상인 경우 데이터 행 */
      const n = parseInt(firstTxt, 10);
      return !isNaN(n) && n >= 6;
    });
  }

  function _applyVisualSelection(){
    const rows = _findDataRows();
    rows.forEach(function(tr, idx){
      const person = dataList[idx];
      if(!person) return;
      const uid = person.uid || person.id;
      const sel = selSet.has(uid);
      if(sel){
        tr.style.backgroundColor = 'rgba(6,182,212,0.18)';
        tr.style.boxShadow = 'inset 3px 0 0 #06b6d4';
      } else {
        tr.style.backgroundColor = '';
        tr.style.boxShadow = '';
      }
      tr.style.cursor = 'pointer';
      tr.style.transition = 'background-color .12s';
      /* dataset에 uid 저장 (재바인딩 시 사용) */
      tr.dataset.apUid = uid;
    });
    _renderSelBar();
  }

  function _renderSelBar(){
    let existing = popup.querySelector('.ap-sel-bar');
    const n = selSet.size;
    if(n===0){ if(existing)existing.remove(); return; }
    if(!existing){
      const bar = document.createElement('div');
      bar.className = 'ap-sel-bar';
      bar.style.cssText = 'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:var(--card);border:1.5px solid var(--cyan);border-radius:12px;padding:10px 18px;box-shadow:0 8px 32px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.05) inset;display:flex;align-items:center;gap:14px;z-index:100;backdrop-filter:saturate(180%) blur(20px);font-size:12px';
      const inner = popup.querySelector('div[style*="background:var(--card)"]') || popup;
      inner.appendChild(bar);
      existing = bar;
    }
    const _isMac = /Mac/i.test(navigator.platform);
    const _modKey = _isMac ? '⌘' : 'Ctrl';
    const _typeLabel = listType==='staff' ? '교직원' : '학생';
    existing.innerHTML = '<span style="color:var(--t1);font-weight:700"><span style="color:var(--cyan);font-size:14px">'+n+'</span>명 선택됨</span>'
      + '<button data-action="sel-clear" style="padding:6px 12px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);font-size:11px;cursor:pointer;font-weight:600">선택 해제 (Esc)</button>'
      + '<button data-action="sel-delete" style="padding:6px 14px;border-radius:6px;border:1px solid #ef4444;background:rgba(239,68,68,0.1);color:#ef4444;font-size:11px;cursor:pointer;font-weight:700">🗑 '+_typeLabel+' 삭제 (Delete)</button>'
      + '<span style="font-size:9px;color:var(--t3);margin-left:4px">'+_modKey+'+클릭 복수 · '+_modKey+'+A 전체</span>';
    const _clearBtn=existing.querySelector('[data-action="sel-clear"]');
    if(_clearBtn)_clearBtn.addEventListener('click',function(){window._apClearRowSelection(popupId);});
    const _delBtn=existing.querySelector('[data-action="sel-delete"]');
    if(_delBtn)_delBtn.addEventListener('click',function(){window._apDeleteRowSelection(popupId,listType);});
  }

  /* 클릭 바인딩 */
  function _bindClicks(){
    _findDataRows().forEach(function(tr, idx){
      tr.addEventListener('click', function(e){
        const person = dataList[idx];
        if(!person) return;
        const uid = person.uid || person.id;
        const multi = e.metaKey || e.ctrlKey;
        if(multi){
          if(selSet.has(uid)) selSet.delete(uid); else selSet.add(uid);
        } else {
          if(selSet.size===1 && selSet.has(uid)) selSet.clear();
          else { selSet.clear(); selSet.add(uid); }
        }
        _applyVisualSelection();
      });
    });
  }

  /* 키보드 단축키 — 이 popup 열려 있을 때만 동작 */
  function _onKey(e){
    if(!document.getElementById(popupId)) return;
    const ae = document.activeElement;
    if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.contentEditable==='true')) return;
    if(e.key==='Escape' && selSet.size>0){
      e.preventDefault(); e.stopPropagation();
      window._apClearRowSelection(popupId);
      return;
    }
    if((e.key==='Delete'||e.key==='Backspace') && selSet.size>0){
      e.preventDefault();
      window._apDeleteRowSelection(popupId, listType);
      return;
    }
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='a'){
      e.preventDefault();
      dataList.forEach(function(p){ selSet.add(p.uid||p.id); });
      _applyVisualSelection();
    }
  }
  document.addEventListener('keydown', _onKey, true);
  /* popup 닫힐 때 리스너 제거 + 선택 초기화 */
  const observer = new MutationObserver(function(){
    if(!document.getElementById(popupId)){
      document.removeEventListener('keydown', _onKey, true);
      delete _apRowSelections[popupId];
      observer.disconnect();
    }
  });
  observer.observe(document.body, {childList:true});

  _bindClicks();
  _applyVisualSelection();
}
/* _apAttachRowSelection — IIFE 내부 전용 */
function _apClearRowSelection(popupId){
  if(_apRowSelections && _apRowSelections[popupId]){
    _apRowSelections[popupId].clear();
  }
  /* 시각 갱신: 모든 행 스타일 초기화 */
  const popup = document.getElementById(popupId);
  if(!popup) return;
  popup.querySelectorAll('tr[data-ap-uid]').forEach(function(tr){
    tr.style.backgroundColor = '';
    tr.style.boxShadow = '';
  });
  const bar = popup.querySelector('.ap-sel-bar');
  if(bar) bar.remove();
};
function _apDeleteRowSelection(popupId, listType){
  const sel = _apRowSelections && _apRowSelections[popupId];
  if(!sel || sel.size===0) return;
  const n = sel.size;
  const typeLabel = listType==='staff' ? '교직원' : '학생';
  _apConfirm({ title:'🗑 선택 삭제', message:'선택한 '+typeLabel+' <b style="color:var(--t1)">'+n+'명</b>을 삭제하시겠습니까?<br><span style="font-size:11px;color:var(--t3)">관련된 보건일지 기록은 유지됩니다.</span>', confirmText:'삭제', cancelText:'취소', danger:true, onConfirm:function(){
    const uids = Array.from(sel);
    const typeFilter = listType==='staff' ? 'staff' : 'student';
    S.people = S.people.filter(function(p){
      if(p.type!==typeFilter) return true;
      return uids.indexOf(p.uid||p.id) < 0;
    });
    sel.clear();
    if(typeof saveData==='function')saveData();
    if(typeof _reloadStudentsFromDB==='function'){
      _reloadStudentsFromDB().then(function(){
        const popup = document.getElementById(popupId);
        if(popup){ closeModalGracefully(popup); /* 닫고 새로 열기 */ }
        if(listType==='staff' && typeof _apStaffListPopup==='function') _apStaffListPopup();
        else if(typeof _apStuListPopup==='function') _apStuListPopup();
      });
    }
    bus.emit('toast:show', {text: typeLabel+' '+n+'명 삭제됨'});
  }});
};

/* ══════════════════════════════════════════════════════
   인라인 명단 — 학생 / 교직원 / 요보호
   ══════════════════════════════════════════════════════ */
const _AP_LV_MAP={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
/* _AP_LV_ORDER 는 아래(_apStuSortKey 위쪽)에서 선언됨 — 중복 선언 방지 */
/* 학생 목록에서 (학교급, 학년) 고유 조합 반환 — 학교급 유→초→중→고→대 순 */
function _apLvGradeCombos(students){
  const set={};
  students.forEach(function(s){
    if(!s||s.type==='staff')return;
    const g=Number(s.grade);
    if(!g||g<=0)return;
    const lv=_AP_LV_MAP[s.level]||s.level||'';
    set[lv+'|'+g]={level:lv,grade:g};
  });
  return Object.keys(set).map(function(k){return set[k];}).sort(function(a,b){
    const la=_AP_LV_ORDER[a.level]!=null?_AP_LV_ORDER[a.level]:99;
    const lb=_AP_LV_ORDER[b.level]!=null?_AP_LV_ORDER[b.level]:99;
    if(la!==lb)return la-lb;
    return a.grade-b.grade;
  });
}
/* 칩 라벨 규칙:
   - 학교급=유: "N세" (학년 아님. 예: "5세")
   - 다중 학교급(혼재): "초1", "중2" 등 (학교급=유만 예외)
   - 단일 유치원: "만N세"
   - 기타 단일: "N학년" */
function _apLvGradeLabel(level,grade,opts){
  opts=opts||{};
  if(level==='유')return grade+'세';
  if(opts.multiLevel)return (level||'')+grade;
  if(opts.isKinder)return '만'+grade+'세';
  return grade+'학년';
}
const _AP_LV_ORDER={'유':0,'kindergarten':0,'초':1,'elementary':1,'중':2,'middle':2,'고':3,'high':3,'대':4};
function _apStuSortKey(s){
  const lv=_AP_LV_ORDER[s.level]!=null?_AP_LV_ORDER[s.level]:99;
  const dep=(s.department||'').toString();
  const g=Number(s.grade)||0;
  /* 반: 한글 학급명 보존 — Number 강제 시 NaN→0 으로 정렬이 뭉치므로 원본값 유지, 정렬은 compareClass (사용자 요청 2026-05-28). */
  const c=(s.cls==null?'':s.cls);
  const n=Number(s.num)||0;
  return[lv,dep,g,c,n];
}
function _apStuSort(arr){
  arr.sort(function(a,b){
    const ka=_apStuSortKey(a),kb=_apStuSortKey(b);
    if(ka[0]!==kb[0])return ka[0]-kb[0];
    if(ka[1]!==kb[1])return ka[1].localeCompare(kb[1],'ko');
    if(ka[2]!==kb[2])return ka[2]-kb[2];
    var _cc=compareClass(ka[3],kb[3]);if(_cc)return _cc;
    return ka[4]-kb[4];
  });
  return arr;
}
const _AP_TH='padding:8px 6px;text-align:center;border-bottom:1px solid var(--bdr);font-size:10px;font-weight:700;color:var(--t2)';
const _AP_TD='padding:5px 6px;font-size:11px';
function _apInlineBootstrap(kind){
  _apInlineRender(kind);
  if(typeof _reloadStudentsFromDB==='function'){
    _reloadStudentsFromDB().then(function(){_apInlineRender(kind);});
  }
}
function _apInlineRender(kind){
  if(kind==='student')_apStuInlineRender();
  else if(kind==='staff')_apStaffInlineRender();
  else if(kind==='care'){_apCareInlineRender(); if(typeof _apCareRenderUnmatched==='function')_apCareRenderUnmatched();}
}
let _apStuInlineQuery='';
function _apStuInlineRender(){
  const host=document.getElementById('apStuInline');if(!host)return;
  /* 전체 렌더 시 검색어 초기화 — 입력창은 빈칸으로 새로 그려지므로 stale 검색어가 남아
     '빈 검색창인데 0/224 + ✕' 가 되던 문제 방지 (2026-06-07) */
  _apStuInlineQuery='';
  const _k=isKinder();
  const stuAll=S.people.filter(function(s){return s.type==='student'&&s.grade>0;});
  _apStuSort(stuAll);
  const gSet={};const grades=[];
  stuAll.forEach(function(s){if(!gSet[s.grade]){gSet[s.grade]=true;grades.push(s.grade);}});
  grades.sort(function(a,b){return a-b;});
  const hasLevel=stuAll.some(function(s){return s.level&&String(s.level).trim();});
  const hasDept=stuAll.some(function(s){return s.department&&String(s.department).trim();});
  /* 학교급-학년 조합 (유5, 초1 등) — 다중 학교급 혼재 시 학교급별 버튼 제공 */
  const _combos=_apLvGradeCombos(stuAll);
  const _levelSet={};_combos.forEach(function(c){if(c.level)_levelSet[c.level]=true;});
  const _multiLevel=Object.keys(_levelSet).length>=2;
  /* 검색 입력창 — 한 번만 그려서 IME 조합 보존 */
  let h='<div style="position:relative;margin-top:18px;margin-bottom:8px"><input class="form-input pm-oninput" data-input-handler="_apStuInlineSearchInput" id="apStuInlineSearch" placeholder="🔍 이름·초성으로 검색 (행을 클릭하면 수정·삭제 가능)" style="font-size:12px;width:100%;padding:8px 10px" autocomplete="off">'
    +'<span id="apStuInlineSearchClear" data-action="_apStuInlineSearchClear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);font-size:10px;font-weight:700;align-items:center;justify-content:center;cursor:pointer;user-select:none">✕</span>'
    +'</div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:6px">📋 전체 명단 <span id="apStuInlineCount" style="font-size:10px;color:var(--t3);font-weight:600"></span></div>';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">';
  h+='<button class="btn-add" data-action="_apStuInlineFilter" data-arg="0" style="font-size:10px;height:26px;padding:0 10px;font-weight:700">전체</button>';
  if(_multiLevel){
    _combos.forEach(function(c){
      const key=c.level+'|'+c.grade;
      h+='<button class="btn-add" data-action="_apStuInlineFilter" data-arg="'+key+'" style="font-size:10px;height:26px;padding:0 10px;font-weight:600">'+_apLvGradeLabel(c.level,c.grade,{multiLevel:true})+'</button>';
    });
  } else {
    grades.forEach(function(g){h+='<button class="btn-add" data-action="_apStuInlineFilter" data-arg="'+g+'" style="font-size:10px;height:26px;padding:0 10px;font-weight:600">'+(_k?('만'+g+'세'):(g+'학년'))+'</button>';});
  }
  h+='</div>';
  h+='<div style="overflow:auto;border:1px solid var(--bdr);border-radius:8px;max-height:420px">';
  h+='<table id="apStuInlineTable" style="width:100%;border-collapse:collapse;font-size:11px">';
  h+='<thead style="position:sticky;top:0;z-index:5;background:var(--bg2)"><tr style="background:var(--bg2)">';
  h+='<th style="'+_AP_TH+';width:36px">순</th>';
  if(hasLevel)h+='<th style="'+_AP_TH+';width:52px">학교급</th>';
  if(hasDept)h+='<th style="'+_AP_TH+';width:110px">학과</th>';
  h+='<th style="'+_AP_TH+';width:70px">'+(_k?'나이':'학년반')+'</th>';
  h+='<th style="'+_AP_TH+';width:40px">'+(_k?'반':'번호')+'</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';min-width:96px;white-space:nowrap">이름</th>';
  h+='<th style="'+_AP_TH+';width:50px">성별</th>';
  h+='<th style="'+_AP_TH+';width:92px">생년월일</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';width:140px">보호자 연락처</th>';
  h+='</tr></thead><tbody id="apStuInlineTbody"></tbody>';
  h+='</table></div>';
  host.innerHTML=h;
  _pmBindUpload(host);
  host._apStuMeta={hasLevel:hasLevel, hasDept:hasDept, isKinder:_k};
  _apStuApplyInlineBody();
}
function _apStuApplyInlineBody(){
  const host=document.getElementById('apStuInline'); if(!host) return;
  const tbody=document.getElementById('apStuInlineTbody'); if(!tbody) return;
  const meta=host._apStuMeta||{};
  const stuAll=S.people.filter(function(s){return s.type==='student'&&s.grade>0;});
  const _q=String(_apStuInlineQuery||'').trim();
  const filtered=_q?stuAll.filter(function(s){return _apTbNameMatch(s.name||'', _q);}):stuAll.slice();
  _apStuSort(filtered);
  let body='';
  if(filtered.length===0){
    const colspan=5+(meta.hasLevel?1:0)+(meta.hasDept?1:0)+3;
    const msg=_q?'검색 결과가 없습니다.':'등록된 '+(meta.isKinder?'원아':'학생')+'이 없습니다. 위의 카드에서 일괄/개별 등록을 진행하세요.';
    body='<tr><td colspan="'+colspan+'" style="padding:28px;text-align:center;color:var(--t3);font-size:11px">'+msg+'</td></tr>';
  } else {
    filtered.forEach(function(s,i){
      const lvLabel=s.level?(_AP_LV_MAP[s.level]||s.level):'';
      body+='<tr data-action="_apStuEditPick" data-arg="'+s.id+'" data-grade="'+s.grade+'" data-level="'+escHtml(lvLabel)+'" style="border-bottom:1px solid var(--bdrl);cursor:pointer" data-hover="ac">';
      body+='<td style="'+_AP_TD+';text-align:center;color:var(--t3);font-size:10px">'+(i+1)+'</td>';
      if(meta.hasLevel)body+='<td style="'+_AP_TD+';text-align:center;color:var(--t2)">'+escHtml(lvLabel)+'</td>';
      if(meta.hasDept)body+='<td style="'+_AP_TD+';text-align:center;font-size:10px;color:var(--t2)">'+escHtml(s.department||'')+'</td>';
      const _gradeLabel=(lvLabel==='유')?(s.grade+'세 '+(s.cls||'')):(s.grade+'-'+s.cls);
      body+='<td style="'+_AP_TD+';text-align:center">'+escHtml(_gradeLabel)+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center">'+(meta.isKinder?(s.cls||''):(s.num||''))+'</td>';
      body+='<td style="'+_AP_TD+';font-weight:600;white-space:nowrap;min-width:96px">'+escHtml(s.name||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;color:var(--t2)">'+escHtml(s.gender||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;font-size:10px;color:var(--t2)">'+escHtml(s.birth||'')+'</td>';
      body+='<td style="'+_AP_TD+';font-size:10px;color:var(--t2)">'+escHtml(s.guardianContact||'')+'</td>';
      body+='</tr>';
    });
  }
  tbody.innerHTML=body;
  const cnt=document.getElementById('apStuInlineCount');
  if(cnt) cnt.textContent='('+(_q?(filtered.length+'/'+stuAll.length):('총 '+filtered.length))+'명)';
  const clr=document.getElementById('apStuInlineSearchClear');
  if(clr) clr.style.display=_q?'inline-flex':'none';
}
function _apStuInlineSearchInput(el){
  _apStuInlineQuery=String(el && el.value || '');
  _apStuApplyInlineBody();
}
function _apStuInlineSearchClear(){
  _apStuInlineQuery='';
  const inp=document.getElementById('apStuInlineSearch');
  if(inp){inp.value='';inp.focus();}
  _apStuApplyInlineBody();
}
function _apStuInlineFilter(arg){
  const tbl=document.getElementById('apStuInlineTable');if(!tbl)return;
  /* arg 형식: "0" = 전체, "유|5" = 학교급+학년, "5" = 학년만 */
  const s=String(arg);
  let filterLevel='', filterGrade=0;
  if(s==='0'||s==='')filterGrade=0;
  else if(s.indexOf('|')>=0){const p=s.split('|');filterLevel=p[0]||'';filterGrade=Number(p[1])||0;}
  else filterGrade=Number(s)||0;
  let seq=0;
  tbl.querySelectorAll('tbody tr').forEach(function(tr){
    const tg=Number(tr.dataset.grade);
    const tl=tr.dataset.level||'';
    if(isNaN(tg))return;
    const gradeMatch=(filterGrade===0||tg===filterGrade);
    const levelMatch=(!filterLevel||tl===filterLevel);
    const show=gradeMatch&&levelMatch;
    tr.style.display=show?'':'none';
    if(show){seq++;const firstTd=tr.querySelector('td');if(firstTd)firstTd.textContent=seq;}
  });
  return;
  /* legacy branch — 사용 안됨 */
  const g=Number(arg);if(isNaN(g))return;
  tbl.querySelectorAll('tbody tr').forEach(function(tr){
    const tg=Number(tr.dataset.grade);
    if(isNaN(tg))return;
    tr.style.display=(g===0||tg===g)?'':'none';
  });
}
/* 교직원 직위 정렬 우선순위 — 교장 > 교감 > 행정실장 > 행정과장 > 나머지(가나다 이름순) */
function _apStaffPositionRank(pos){
  const p=String(pos||'').trim();
  if(/교장/.test(p)&&!/교장대리/.test(p))return 0;
  if(/교감/.test(p))return 1;
  if(/행정실장/.test(p))return 2;
  if(/행정과장/.test(p))return 3;
  /* 교원 군: 부장교사/수석교사/담임/교사/보건교사/영양교사/상담교사 등 */
  if(/교사|교원|수석/.test(p))return 10;
  /* 직원 군: 행정·조리·기능·주무관·실무사 등 나머지 */
  return 20;
}
/* 직위 그룹: 필터용 */
const _AP_STAFF_GROUPS=[
  {key:'leader',label:'교장·교감',match:function(p){return /교장|교감/.test(p)&&!/교장대리/.test(p);}},
  {key:'admin',label:'행정실장·과장',match:function(p){return /행정실장|행정과장/.test(p);}},
  {key:'teacher',label:'교원',match:function(p){return /교사|교원|수석/.test(p)&&!/교장|교감/.test(p);}},
  {key:'staff',label:'직원',match:function(p){return !/교장|교감|행정실장|행정과장|교사|교원|수석/.test(p);}}
];
let _apStaffInlineQuery='';
function _apStaffInlineRender(){
  const host=document.getElementById('apStaffInline');if(!host)return;
  /* 전체 렌더 시 검색어 초기화 — 빈 검색창인데 '0/N + ✕' 로 stuck 되던 문제 방지 (2026-06-07, 학생과 동일) */
  _apStaffInlineQuery='';
  /* 검색창 — 한 번만 그려서 IME 조합 보존 */
  let h='<div style="position:relative;margin-top:18px;margin-bottom:8px"><input class="form-input pm-oninput" data-input-handler="_apStaffInlineSearchInput" id="apStaffInlineSearch" placeholder="🔍 이름·초성으로 검색 (행을 클릭하면 수정·삭제 가능)" style="font-size:12px;width:100%;padding:8px 10px" autocomplete="off">'
    +'<span id="apStaffInlineSearchClear" data-action="_apStaffInlineSearchClear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);font-size:10px;font-weight:700;align-items:center;justify-content:center;cursor:pointer;user-select:none">✕</span>'
    +'</div>';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:6px">📋 전체 명단 <span id="apStaffInlineCount" style="font-size:10px;color:var(--t3);font-weight:600"></span></div>';
  h+='<div style="overflow:auto;border:1px solid var(--bdr);border-radius:8px;max-height:420px">';
  h+='<table id="apStaffInlineTable" style="width:100%;border-collapse:collapse;font-size:11px">';
  h+='<thead style="position:sticky;top:0;z-index:5;background:var(--bg2)"><tr style="background:var(--bg2)">';
  h+='<th style="'+_AP_TH+';width:44px">순</th>';
  h+='<th style="'+_AP_TH+';width:140px">직위</th>';
  h+='<th style="'+_AP_TH+';width:110px">이름</th>';
  h+='<th style="'+_AP_TH+';width:54px">성별</th>';
  h+='<th style="'+_AP_TH+';width:100px">가족관계</th>';
  h+='<th style="'+_AP_TH+';min-width:180px">가족 연락처</th>';
  h+='</tr></thead><tbody id="apStaffInlineTbody"></tbody>';
  h+='</table></div>';
  host.innerHTML=h;
  _pmBindUpload(host);
  _apStaffApplyInlineBody();
}
function _apStaffApplyInlineBody(){
  const tbody=document.getElementById('apStaffInlineTbody'); if(!tbody) return;
  const stfAll=S.people.filter(function(s){return s.type==='staff';});
  stfAll.sort(function(a,b){
    const ra=_apStaffPositionRank(a.position), rb=_apStaffPositionRank(b.position);
    if(ra!==rb)return ra-rb;
    return (a.name||'').localeCompare(b.name||'','ko');
  });
  const _q=String(_apStaffInlineQuery||'').trim();
  const filtered=_q?stfAll.filter(function(s){return _apTbNameMatch(s.name||'', _q);}):stfAll.slice();
  let body='';
  if(filtered.length===0){
    const msg=_q?'검색 결과가 없습니다.':'등록된 교직원이 없습니다. 위의 카드에서 일괄/개별 등록을 진행하세요.';
    body+='<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--t3);font-size:11px">'+msg+'</td></tr>';
  } else {
    filtered.forEach(function(s,i){
      body+='<tr data-action="_apStaffEditPick" data-arg="'+s.id+'" style="border-bottom:1px solid var(--bdrl);cursor:pointer" data-hover="ac">';
      body+='<td style="'+_AP_TD+';text-align:center;color:var(--t3);font-size:10px">'+(i+1)+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;color:var(--t2)">'+escHtml(s.position||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;font-weight:600">'+escHtml(s.name||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;color:var(--t2)">'+escHtml(s.gender||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;font-size:10px;color:var(--t2)">'+escHtml(s.familyRelation||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center;font-size:10px;color:var(--t2)">'+escHtml(s.familyPhone||s.familyContact||'')+'</td>';
      body+='</tr>';
    });
  }
  tbody.innerHTML=body;
  const cnt=document.getElementById('apStaffInlineCount');
  if(cnt) cnt.textContent='('+(_q?(filtered.length+'/'+stfAll.length):('총 '+stfAll.length))+'명)';
  const clr=document.getElementById('apStaffInlineSearchClear');
  if(clr) clr.style.display=_q?'inline-flex':'none';
}
function _apStaffInlineSearchInput(el){
  _apStaffInlineQuery=String(el && el.value || '');
  _apStaffApplyInlineBody();
}
function _apStaffInlineSearchClear(){
  _apStaffInlineQuery='';
  const inp=document.getElementById('apStaffInlineSearch');
  if(inp){inp.value='';inp.focus();}
  _apStaffApplyInlineBody();
}
function _apStaffInlineFilter(key){
  const tbl=document.getElementById('apStaffInlineTable');if(!tbl)return;
  let seq=0;
  tbl.querySelectorAll('tbody tr').forEach(function(tr){
    const tg=tr.dataset.grp;
    const show=(key==='all'||tg===key);
    tr.style.display=show?'':'none';
    if(show){seq++;const seqCell=tr.querySelector('td');if(seqCell)seqCell.textContent=seq;}
  });
}
let _apCareInlineQuery='';
function _apCareInlineRender(){
  const host=document.getElementById('apCareInline');if(!host)return;
  const _k=isKinder();
  const careAll=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch'||(s.dustDisease&&s.dustDisease.trim()));});
  /* 셸 렌더링 시점에는 항상 전체 기준 grade 칩을 만들고, 행 표시는 _apCareApplyInlineFilter 가 처리.
     입력창 IME 조합 보존 위해 _apCareInlineSearchInput 은 본 함수가 아닌 _apCareApplyInlineFilter 만 호출. */
  const baseSorted=careAll.slice();_apStuSort(baseSorted);
  const hasLevel=baseSorted.some(function(s){return s.level&&String(s.level).trim();});
  const hasDept=baseSorted.some(function(s){return s.department&&String(s.department).trim();});
  const gSet={};const grades=[];
  baseSorted.forEach(function(s){if(!gSet[s.grade]){gSet[s.grade]=true;grades.push(s.grade);}});
  grades.sort(function(a,b){return a-b;});
  /* 검색 입력창 — 한 번만 그려서 IME 조합 끊기지 않게 */
  let h='<style>#apCareInlineTable .apcare-row:hover{background:rgba(6,182,212,0.06)}</style>';
  h+='<div style="position:relative;margin-top:14px;margin-bottom:8px"><input class="form-input pm-oninput" data-input-handler="_apCareInlineSearchInput" id="apCareInlineSearch" placeholder="🔍 이름·초성으로 검색" style="font-size:12px;width:100%;padding:8px 10px" autocomplete="off">'
    +'<span id="apCareInlineSearchClear" data-action="_apCareInlineSearchClear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);font-size:10px;font-weight:700;align-items:center;justify-content:center;cursor:pointer;user-select:none">✕</span>'
    +'</div>';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:8px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t1)">📋 요보호 & 미세먼지 기저질환 명단 <span id="apCareInlineCount" style="font-size:10px;color:var(--t3);font-weight:600"></span></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  h+='<button data-action="_apCareExportExcel" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none">📗 Excel 다운로드</button>';
  h+='<button data-action="_apCareExportSheets" style="padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:linear-gradient(135deg,#16a34a,#059669);color:#fff;border:none">📊 Google Sheets로 보내기</button>';
  h+='</div></div>';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">';
  h+='<button class="btn-add" data-action="_apCareInlineFilter" data-arg="0" style="font-size:10px;height:26px;padding:0 10px;font-weight:700">전체</button>';
  grades.forEach(function(g){h+='<button class="btn-add" data-action="_apCareInlineFilter" data-arg="'+g+'" style="font-size:10px;height:26px;padding:0 10px;font-weight:600">'+(_k?('만'+g+'세'):(g+'학년'))+'</button>';});
  h+='</div>';
  h+='<div style="overflow-x:auto;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;max-height:420px">';
  h+='<table id="apCareInlineTable" style="min-width:780px;width:max-content;border-collapse:collapse;font-size:11px">';
  h+='<thead style="position:sticky;top:0;z-index:5;background:var(--bg2)"><tr style="background:var(--bg2)">';
  h+='<th style="'+_AP_TH+';width:32px;min-width:32px">순</th>';
  if(hasLevel)h+='<th style="'+_AP_TH+';width:48px;min-width:48px">학교급</th>';
  if(hasDept)h+='<th style="'+_AP_TH+';width:90px;min-width:90px">학과</th>';
  h+='<th style="'+_AP_TH+';width:60px;min-width:60px">'+(_k?'나이':'학년반')+'</th>';
  h+='<th style="'+_AP_TH+';width:36px;min-width:36px">'+(_k?'반':'번')+'</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';width:72px;min-width:72px">이름</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';width:120px;min-width:120px">요보호 질환명</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';width:130px;min-width:130px">미세먼지 기저질환명</th>';
  h+='<th style="'+_AP_TH.replace('text-align:center','text-align:left')+';width:200px;min-width:200px">주의사항(메모)</th>';
  h+='</tr></thead><tbody id="apCareInlineTbody"></tbody>';
  h+='</table></div>';
  host.innerHTML=h;
  _pmBindUpload(host); /* pm-oninput 리스너 부착 (한 번만 — 입력창 IME 보존) */
  /* 메타 보관 — 부분 갱신 시 hasLevel/hasDept 재사용 */
  host._apCareMeta={hasLevel:hasLevel, hasDept:hasDept, isKinder:_k};
  _apCareApplyInlineFilter();
}
/* tbody·카운트만 업데이트 — 입력창 IME 조합 보존 */
function _apCareApplyInlineFilter(){
  const host=document.getElementById('apCareInline'); if(!host) return;
  const tbody=document.getElementById('apCareInlineTbody'); if(!tbody) return;
  const meta=host._apCareMeta||{};
  const careAll=S.people.filter(function(s){return s.type==='student'&&(s.status==='caution'||s.status==='watch'||(s.dustDisease&&s.dustDisease.trim()));});
  const _q=String(_apCareInlineQuery||'').trim();
  const filtered=_q?careAll.filter(function(s){return _apTbNameMatch(s.name||'', _q);}):careAll.slice();
  _apStuSort(filtered);
  let body='';
  if(filtered.length===0){
    const colspan=7+(meta.hasLevel?1:0)+(meta.hasDept?1:0);
    const msg=_q?'검색 결과가 없습니다.':'등록된 요보호/미세먼지 기저질환 학생이 없습니다.';
    body='<tr><td colspan="'+colspan+'" style="padding:28px;text-align:center;color:var(--t3);font-size:11px">'+msg+'</td></tr>';
  } else {
    filtered.forEach(function(s,i){
      const lvLabel=s.level?(_AP_LV_MAP[s.level]||s.level):'';
      const careText=s.condition||s.care_reason||'';
      const dustText=s.dustDisease||s.dust_disease||'';
      const memoText=s.careMemo||s.care_memo||'';
      body+='<tr class="apcare-row" data-grade="'+s.grade+'" data-action="_apCareEditFromList" data-arg="'+s.id+'" title="클릭하여 수정 / 해제" style="border-bottom:1px solid var(--bdrl);cursor:pointer">';
      body+='<td style="'+_AP_TD+';text-align:center;color:var(--t3);font-size:10px">'+(i+1)+'</td>';
      if(meta.hasLevel)body+='<td style="'+_AP_TD+';text-align:center;color:var(--t2)">'+escHtml(lvLabel)+'</td>';
      if(meta.hasDept)body+='<td style="'+_AP_TD+';text-align:center;font-size:10px;color:var(--t2)">'+escHtml(s.department||'')+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center">'+(meta.isKinder?('만'+s.grade+'세'):(s.grade+'-'+s.cls))+'</td>';
      body+='<td style="'+_AP_TD+';text-align:center">'+(meta.isKinder?(s.cls||''):(s.num||''))+'</td>';
      body+='<td style="'+_AP_TD+';font-weight:600;white-space:nowrap">'+escHtml(s.name||'')+'</td>';
      body+='<td style="'+_AP_TD+';font-size:10px;color:var(--t2);white-space:normal;word-break:break-word;line-height:1.4">'+escHtml(careText)+'</td>';
      body+='<td style="'+_AP_TD+';font-size:10px;color:var(--t2);white-space:normal;word-break:break-word;line-height:1.4">'+escHtml(dustText)+'</td>';
      body+='<td style="'+_AP_TD+';font-size:10px;color:var(--t2);white-space:normal;word-break:break-word;line-height:1.4">'+escHtml(memoText)+'</td>';
      body+='</tr>';
    });
  }
  tbody.innerHTML=body;
  /* 카운트 갱신 */
  const cnt=document.getElementById('apCareInlineCount');
  if(cnt) cnt.textContent='('+(_q?(filtered.length+'/'+careAll.length):('총 '+filtered.length))+'명)';
  /* clear (✕) 표시/숨김 */
  const clr=document.getElementById('apCareInlineSearchClear');
  if(clr) clr.style.display=_q?'inline-flex':'none';
}
function _apCareInlineSearchInput(el){
  _apCareInlineQuery=String(el && el.value || '');
  _apCareApplyInlineFilter();
}
function _apCareInlineSearchClear(){
  _apCareInlineQuery='';
  const inp=document.getElementById('apCareInlineSearch');
  if(inp){inp.value='';inp.focus();}
  _apCareApplyInlineFilter();
}
function _apCareInlineFilter(grade){
  const g=Number(grade);
  const tbl=document.getElementById('apCareInlineTable');if(!tbl)return;
  tbl.querySelectorAll('tbody tr').forEach(function(tr){
    const tg=Number(tr.dataset.grade);
    if(isNaN(tg))return;
    tr.style.display=(g===0||tg===g)?'':'none';
  });
}

/* 학생 명단 팝업 — 선택된 학생 uid 집합 (popup 열려 있을 때만 사용) */
let _apStuSelectedUids = new Set();
function _apStuListRefresh(){
  /* 인라인 명단이 화면에 있으면 같이 갱신 — 팝업 없어진 후 대체 경로 */
  if(document.getElementById('apStuInline'))_apStuInlineRender();
  if(document.getElementById('apStaffInline'))_apStaffInlineRender();
  if(document.getElementById('apCareInline'))_apCareInlineRender();
  const popup=document.getElementById('apStuListPopup');if(!popup)return;
  const tableWrap=popup.querySelector('#apStuListTable');if(!tableWrap)return;
  /* 데이터는 _apStuListPopup() 에서 이미 DB 로 동기화됨. 여기선 S.people 을 바로 읽어서 렌더만 담당. */
  let stuList=S.people.filter(function(s){return s.type==='student';});
  console.log('[학생명단 렌더] S.people 학생 수:',stuList.length,'/ 전체 S.people:',S.people.length);
  stuList.sort(function(a,b){if(a.grade!==b.grade)return a.grade-b.grade;var _c=compareClass(a.cls,b.cls);if(_c)return _c;return(a.num||0)-(b.num||0);});
  /* 빈 상태 — 학생 없음 */
  if(stuList.length===0){
    tableWrap.innerHTML = (typeof createEmptyState==='function')
      ? createEmptyState({icon:'🎒',title:'등록된 학생이 없습니다',desc:'설정 → 학생 데이터 관리에서 엑셀 양식으로 일괄 업로드하세요.'})
      : '<div style="padding:40px;text-align:center;color:#666">등록된 학생이 없습니다.</div>';
    const cntEl=popup.querySelector('.pm-total-count');if(cntEl)cntEl.textContent='총 0명';
    return;
  }
  const order=_getPmColOrder();const vis=_getPmColVis();
  const visibleCols=order.filter(function(idx){return vis[idx]!==false;});
  const colHeaders=visibleCols.map(function(idx){const c=PM_COLS.find(function(x){return x.idx===idx;});return c?c.label:'';});
  const bd='border:1px solid #c0c0c0;', pd='padding:4px 6px;', ctr='text-align:center;';
  const yr=new Date().getFullYear();const schoolName=S.settings.schoolName||'○○학교';
  const totalC=colHeaders.length;const halfC=Math.ceil(totalC/2);
  let h='<table style="width:100%;border-collapse:collapse;font-size:10px">';
  h+='<thead>';
  /* 색상바 + 제목 + 색상바 (물품 대여 대장 스타일) */
  h+='<tr><td colspan="'+totalC+'" style="padding:0;border:none"><table style="width:100%;border-collapse:collapse"><tbody>'
    +'<tr><td colspan="'+halfC+'" style="background:#2855A0;height:12px;padding:0;border:none"></td><td colspan="'+(totalC-halfC)+'" style="background:#D4A843;height:12px;padding:0;border:none"></td></tr>'
    +'<tr><td colspan="'+totalC+'" style="background:#F7F7F7;text-align:center;padding:10px 16px;border:none;font-size:16px;font-weight:700;color:#000;letter-spacing:3px">'+yr+'학년도 '+escHtml(schoolName)+' 학생 명단</td></tr>'
    +'<tr><td colspan="'+Math.ceil(totalC*3/10)+'" style="background:#2E8B57;height:12px;padding:0;border:none"></td><td colspan="'+(totalC-Math.ceil(totalC*3/10))+'" style="background:#C0392B;height:12px;padding:0;border:none"></td></tr>'
    +'</tbody></table></td></tr>';
  /* 간격 */
  h+='<tr><td colspan="'+totalC+'" style="border:none;padding:0;height:12px"></td></tr>';
  /* 컬럼 헤더 */
  h+='<tr style="background:#F7F7F7">';
  colHeaders.forEach(function(ch,ci){
    const bdrExtra=(ci===0?'border-left:2px solid #333;':'')+(ci===colHeaders.length-1?'border-right:2px solid #333;':'');
    h+='<td style="'+bd+pd+ctr+'font-weight:700;border-top:2px solid #333;'+bdrExtra+'">'+ch+'</td>';
  });
  h+='</tr></thead><tbody>';
  stuList.forEach(function(s,ri){
    const isLast=ri===stuList.length-1;const btm=isLast?'border-bottom:2px solid #333;':'';
    const cellMap={0:(ri+1),1:(s.level||''),2:(s.department||''),3:s.grade,4:s.cls,5:(s.num||'-'),6:'<b>'+escHtml(s.name)+'</b>',7:(s.gender||'-'),8:(s.birth||'-'),9:(s.guardianContact||''),10:(s.is_care?'요보호':''),11:(s.memo||'')};
    const _isSel = _apStuSelectedUids && _apStuSelectedUids.has(s.uid||s.id);
    const _selStyle = _isSel ? 'background-color:rgba(6,182,212,0.18);box-shadow:inset 3px 0 0 #06b6d4;' : '';
    h+='<tr class="aps-stu-row" data-stu-uid="'+(s.uid||s.id||'')+'" style="cursor:pointer;'+_selStyle+'transition:background .12s">';
    visibleCols.forEach(function(idx,ci){
      const bdrExtra=(ci===0?'border-left:2px solid #333;':'')+(ci===visibleCols.length-1?'border-right:2px solid #333;':'');
      h+='<td style="'+bd+pd+ctr+btm+bdrExtra+'">'+(cellMap[idx]!=null?cellMap[idx]:'')+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  tableWrap.innerHTML=h;
  /* 행 클릭 — 단일/복수 선택 */
  tableWrap.querySelectorAll('.aps-stu-row').forEach(function(tr){
    tr.addEventListener('click', function(e){
      const uid = this.dataset.stuUid;
      const multi = e.metaKey || e.ctrlKey;
      if(!_apStuSelectedUids) _apStuSelectedUids = new Set();
      if(multi){
        if(_apStuSelectedUids.has(uid)) _apStuSelectedUids.delete(uid);
        else _apStuSelectedUids.add(uid);
      } else {
        if(_apStuSelectedUids.size===1 && _apStuSelectedUids.has(uid)){
          _apStuSelectedUids.clear();
        } else {
          _apStuSelectedUids.clear();
          _apStuSelectedUids.add(uid);
        }
      }
      _apStuListRefresh();
      _apStuRenderSelectionBar();
    });
  });
  /* 총 인원 + 선택 개수 표시 */
  const selCnt = (_apStuSelectedUids && _apStuSelectedUids.size) || 0;
  const cntEl=popup.querySelector('.pm-total-count');
  if(cntEl){
    cntEl.innerHTML = '총 <b>'+stuList.length+'명</b>'
      + (selCnt>0 ? ' · <span style="color:var(--cyan);font-weight:700">'+selCnt+'명 선택됨</span>' : '');
  }
  _apStuRenderSelectionBar();
}

/* 선택된 학생용 액션 바 — 팝업 하단 floating */
function _apStuRenderSelectionBar(){
  const popup=document.getElementById('apStuListPopup');if(!popup)return;
  let existing=popup.querySelector('#apStuSelBar');
  const selCnt=(_apStuSelectedUids&&_apStuSelectedUids.size)||0;
  if(selCnt===0){if(existing)existing.remove();return;}
  if(!existing){
    const bar=document.createElement('div');
    bar.id='apStuSelBar';
    bar.style.cssText='position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:var(--card);border:1.5px solid var(--cyan);border-radius:12px;padding:10px 18px;box-shadow:0 8px 32px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.05) inset;display:flex;align-items:center;gap:14px;z-index:100;backdrop-filter:saturate(180%) blur(20px);font-size:12px';
    popup.querySelector('.modal-content,div[style*="background:var(--card)"]')?.appendChild?.(bar) || popup.appendChild(bar);
    existing=bar;
  }
  const _isMac = /Mac/i.test(navigator.platform);
  const _modKey = _isMac ? '⌘' : 'Ctrl';
  existing.innerHTML='<span style="color:var(--t1);font-weight:700"><span style="color:var(--cyan);font-size:14px">'+selCnt+'</span>명 선택됨</span>'
    +'<button data-action="stu-sel-clear" style="padding:6px 12px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);font-size:11px;cursor:pointer;font-weight:600">선택 해제 (Esc)</button>'
    +'<button data-action="stu-sel-delete" style="padding:6px 14px;border-radius:6px;border:1px solid #ef4444;background:rgba(239,68,68,0.1);color:#ef4444;font-size:11px;cursor:pointer;font-weight:700">🗑 삭제 (Delete)</button>'
    +'<span style="font-size:9px;color:var(--t3);margin-left:4px">'+_modKey+'+클릭 복수 선택 · '+_modKey+'+A 전체</span>';
  const _scBtn=existing.querySelector('[data-action="stu-sel-clear"]');
  if(_scBtn)_scBtn.addEventListener('click',function(){window._apStuClearSelection();});
  const _sdBtn=existing.querySelector('[data-action="stu-sel-delete"]');
  if(_sdBtn)_sdBtn.addEventListener('click',function(){window._apStuDeleteSelection();});
}
function _apStuClearSelection(){
  if(_apStuSelectedUids) _apStuSelectedUids.clear();
  _apStuListRefresh();
};
function _apStuDeleteSelection(){
  const sel = _apStuSelectedUids;
  if(!sel || sel.size===0) return;
  const n = sel.size;
  _apConfirm({ title:'🗑 선택 삭제', message:'선택한 학생 <b style="color:var(--t1)">'+n+'명</b>을 삭제하시겠습니까?<br><span style="font-size:11px;color:var(--t3)">관련된 보건일지 기록은 유지됩니다.</span>', confirmText:'삭제', cancelText:'취소', danger:true, onConfirm:function(){
    const uids = Array.from(sel);
    /* people에서 제거 */
    S.people = S.people.filter(function(p){
      if(p.type!=='student') return true;
      return uids.indexOf(p.uid||p.id) < 0;
    });
    sel.clear();
    if(typeof saveData==='function')saveData();
    if(typeof _reloadStudentsFromDB==='function')_reloadStudentsFromDB().then(_apStuListRefresh);
    else _apStuListRefresh();
    bus.emit('toast:show', {text: '학생 '+n+'명 삭제됨'});
  }});
};

/* 팝업 내부 키보드 단축키 — Esc 해제, Delete 삭제, ⌘A 전체 선택 */
let _apStuShortcutsAttached = false;
/* _attachApStuShortcuts */
if(!_apStuShortcutsAttached){
  _apStuShortcutsAttached = true;
  document.addEventListener('keydown', function(e){
    const popup = document.getElementById('apStuListPopup');
    if(!popup) return;
    const ae = document.activeElement;
    if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.contentEditable==='true')) return;
    const sel = _apStuSelectedUids || new Set();
    if(e.key==='Escape' && sel.size>0){
      e.preventDefault(); e.stopPropagation();
      window._apStuClearSelection();
      return;
    }
    if((e.key==='Delete'||e.key==='Backspace') && sel.size>0){
      e.preventDefault();
      window._apStuDeleteSelection();
      return;
    }
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='a'){
      e.preventDefault();
      const stuList = S.people.filter(function(s){return s.type==='student';});
      _apStuSelectedUids = new Set(stuList.map(function(s){return s.uid||s.id;}));
      _apStuListRefresh();
    }
  }, true);
}
function _apStuListPopup(){
  /* DB 에서 먼저 학생 데이터를 동기화한 후 팝업 오픈 — 타이밍/캐싱 이슈 제거 */
  if(window.electronAPI&&window.electronAPI.studentsGetAll){
    bus&&bus.emit&&bus.emit('toast:show',{text:'DB 에서 학생 명단 로딩 중...'});
    window.electronAPI.studentsGetAll().then(function(res){
      console.log('[학생명단] DB fetch 결과 - success:',res&&res.success,'| rows:',res&&res.data?res.data.length:0);
      if(res&&res.success&&Array.isArray(res.data)){
        const _b=function(v){if(!v)return '';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[1]+'.'+m[2]+'.'+m[3]+'.':String(v);};
        const fresh=res.data.map(function(r){return{uid:r.uid,id:r.uid,name:r.name,grade:r.grade,cls:r.class_num,num:r.student_num,gender:r.gender,birth:_b(r.birth_date),type:'student',level:r.level||'',department:r.department||'',guardianType:r.guardian_type||'',guardianContact:r.guardian_contact||'',status:r.is_care?'caution':'normal',condition:r.care_reason||'',careMemo:r.care_memo||'',dustDisease:r.dust_disease||'',medConsent:r.med_consent||'Y',emergencyConsent:r.emergency_consent||'Y',vip:r.vip||'',memoJson:r.memo_json||'{}',is_enrolled:r.is_enrolled};});
        const staffOnly=S.people.filter(function(s){return s.type==='staff';});
        S.people=fresh.concat(staffOnly);
      }
      _apStuListPopupRender();
    }).catch(function(e){
      console.error('[학생명단] DB fetch 오류:',e);
      alert('학생 명단 로딩 오류: '+(e&&e.message||''));
      _apStuListPopupRender();
    });
    return;
  }
  _apStuListPopupRender();
}
function _apStuListPopupRender(){
  const existing=document.getElementById('apStuListPopup');if(existing)closeModalGracefully(existing);
  const ov=document.createElement('div');ov.id='apStuListPopup';
  ov.style.cssText='position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)';
  const _btnS='padding:6px 12px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:4px;';
  const _spNow=new Date();const _spAy=_spNow.getMonth()>=2?_spNow.getFullYear():_spNow.getFullYear()-1;
  const _spLbl=(typeof isKinder==='function'&&isKinder())?'원아':'학생';
  let h='<div style="background:var(--card);border-radius:14px;width:900px;max-width:96vw;height:90vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.3);overflow:hidden">';
  h+='<div style="padding:16px 20px;border-bottom:1px solid var(--glass-border);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-radius:14px 14px 0 0"><span style="font-size:15px;font-weight:800;color:var(--t1)">🎒 '+_spAy+'학년도 '+_spLbl+' 명단</span></div>';
  /* 컬럼 설정 영역 */
  h+='<div style="padding:10px 20px;border-bottom:1px solid var(--bdr);flex-shrink:0">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:var(--t2)">🔧 열 필드 설정</span><span style="font-size:9px;color:var(--t3)">드래그로 순서 변경, 눈 아이콘으로 표시/숨김</span><button data-action="stu-undo-col" style="'+_btnS+'background:var(--bg2);color:var(--t2);border:1px solid var(--bdr);font-size:9px;padding:3px 8px" title="되돌리기 (Ctrl+Z)">↩ 되돌리기</button></div>';
  h+='<div id="pmColChips" style="display:flex;flex-wrap:wrap;gap:2px"></div>';
  h+='</div>';
  /* 버튼 영역 */
  h+='<div style="padding:8px 20px;flex-shrink:0">';
  h+='<div class="pm-total-count" style="font-size:11px;color:var(--t3);margin-bottom:4px">총 0명</div>';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap">';
  h+='<button data-action="stu-copy" style="'+_btnS+'background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none">📋 클립보드 복사</button>';
  h+='<button class="btn-print" data-action="stu-print">🖨 인쇄</button>';
  h+='</div></div>';
  /* 테이블 영역 */
  h+='<div style="flex:1;overflow:auto;padding:0 20px 20px">';
  h+='<div id="apStuListTable" style="background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:12px;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000"></div>';
  h+='</div></div>';
  ov.innerHTML=h;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  /* Ctrl+Z 단축키 */
  ov.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();_undoPmCol();}});
  ov.tabIndex=-1;
  /* addEventListener 바인딩 — undo/copy/print */
  const _undoBtn=ov.querySelector('[data-action="stu-undo-col"]');
  if(_undoBtn)_undoBtn.addEventListener('click',function(){_undoPmCol();});
  const _stuCopyBtn=ov.querySelector('[data-action="stu-copy"]');
  if(_stuCopyBtn)_stuCopyBtn.addEventListener('click',function(){_apListCopy('apStuListTable');});
  const _stuPrintBtn=ov.querySelector('[data-action="stu-print"]');
  if(_stuPrintBtn)_stuPrintBtn.addEventListener('click',function(){_apListPrint('apStuListTable','학생 명단');});
  document.body.appendChild(ov);
  ov.focus();
  /* 컬럼 카드 렌더링 */
  const chips=document.getElementById('pmColChips');if(chips)_renderPmColCards(chips);
  /* 테이블 렌더링 */
  _apStuListRefresh();
}
/* ── 교직원 명단 팝업 ── */
function _apStaffListPopup(){
  let staffList=S.people.filter(function(s){return s.type==='staff';});
  /* 비어있으면 DB 에서 직접 fetch — 초기 로딩 타이밍 이슈 방지 */
  if(staffList.length===0&&window.electronAPI&&window.electronAPI.staffGetAll){
    window.electronAPI.staffGetAll().then(function(res){
      if(res&&res.success&&Array.isArray(res.data)&&res.data.length){
        const fresh=res.data.map(function(r){return{uid:r.uid,id:r.uid,name:r.name,type:'staff',position:r.position||'',gender:(r.gender==='M'?'남':(r.gender==='F'?'여':(r.gender||''))),familyRelation:r.family_relation||'',familyPhone:r.family_phone||'',grade:0,cls:0,num:0,status:'normal'};});
        const stuOnly=S.people.filter(function(s){return s.type!=='staff';});
        S.people=stuOnly.concat(fresh);
      }
      _apStaffListPopup(); /* 재호출 */
    }).catch(function(){_apStaffListPopup();});
    return;
  }
  const rows=staffList.map(function(s,i){return[(i+1),escHtml(s.position||'-'),'<b>'+escHtml(s.name)+'</b>',(s.gender||'-')];});
  const _stNow=new Date();const _stAy=_stNow.getMonth()>=2?_stNow.getFullYear():_stNow.getFullYear()-1;
  _apSheetPopup('apStaffListPopup','👔',_stAy+'학년도 교직원 명단',_stAy+'학년도 교직원 명단',['순','직위','이름','성별'],rows,'apStaffListTable');
  /* 빈 상태 — 교직원 0명 시 친근한 안내 */
  setTimeout(function(){
    if(staffList.length===0){
      const popup=document.getElementById('apStaffListPopup');
      const tableEl=popup&&popup.querySelector('#apStaffListTable');
      if(tableEl && typeof createEmptyState==='function'){
        tableEl.innerHTML = createEmptyState({
          icon:'👔',
          title:'등록된 교직원이 없습니다',
          desc:'설정 → 학생/교직원 데이터 관리에서 엑셀 양식으로 일괄 업로드하세요.'
        });
      }
      return;
    }
    /* 행 선택 인터랙션 부착 (학생 명단과 동일 패턴) */
    _apAttachRowSelection('apStaffListPopup','staff',staffList);
  },50);
}
/* ── 공통 복사/인쇄 ── */
function _apListCopy(tableId){
  const el=document.getElementById(tableId);if(!el)return;
  const range=document.createRange();range.selectNodeContents(el);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  document.execCommand('copy');sel.removeAllRanges();
  bus.emit('toast:show', {text: '명단이 복사되었습니다.'});
}
function _apListPrint(tableId,title){
  const el=document.getElementById(tableId);if(!el)return;
  const w=window.open('','_blank','width=800,height=600');
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+title+'</title><style>@page{size:A4;margin:15mm}body{font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',\'맑은 고딕\',sans-serif;color:#000;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px 8px}</style></head><body>'+el.innerHTML+'</body></html>');
  w.document.close();w.print();
}

/* DB에서 잠복결핵 데이터 로드 (S._apTbSearchData 가 비어있으면) — 누적 보기를 먼저 실행하지 않아도 내보낼 수 있게 */
function _apTbEnsureData(callback,opts){
  /* opts.allowEmpty === true 면 데이터 0건이어도 콜백 호출 */
  const allowEmpty=!!(opts&&opts.allowEmpty);
  if(S._apTbSearchData&&S._apTbSearchData.length){callback(S._apTbSearchData);return;}
  if(!(window.electronAPI&&window.electronAPI.tbTestGetAll)){
    if(allowEmpty){callback([]);return;}
    return;
  }
  window.electronAPI.tbTestGetAll().then(function(r){
    if(r&&r.success&&r.data){
      const dbItems=r.data.map(function(d){return{name:d.name,pos:d.position||'',date:d.test_date||'',inst:d.institution||d.memo||''};});
      const seen={};
      S._apTbSearchData.forEach(function(d){seen[d.name+'|'+d.date]=true;});
      dbItems.forEach(function(d){if(!seen[d.name+'|'+d.date]){S._apTbSearchData.push(d);seen[d.name+'|'+d.date]=true;}});
    }
    if(!S._apTbSearchData.length){
      if(allowEmpty){callback([]);return;}
      return;
    }
    callback(S._apTbSearchData);
  }).catch(function(e){
    if(allowEmpty){callback([]);return;}
    console.error('[TB] 데이터 로드 오류:',e);
  });
}

/* 잠복결핵 명단 Excel 저장 — 보건일지/진료과 통계와 동일한 색상바·제목·외곽선·Freeze 스타일 */
function _apTbExportExcel(){
  _apTbEnsureData(function(records){
    if(!(window.electronAPI&&window.electronAPI.xlsxBuildDiary)){
      if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 빌드 IPC 미구성'});
      return;
    }
    const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)?S.settings.schoolName:'○○학교';
    records=records||[];
    const sorted=records.slice();
    sorted.sort(function(a,b){
      const da=(a.date||'').replace(/\./g,''), db=(b.date||'').replace(/\./g,'');
      return _apTbSortOrder==='asc'?da.localeCompare(db):db.localeCompare(da);
    });
    const headerLabels=['순','직위','이름','검사일','검진기관명'];
    const colWidths=[50,110,110,130,260];
    const colCount=headerLabels.length;
    const dataRows=sorted.map(function(r,i){return [i+1,r.pos||'',r.name||'',r.date||'',r.inst||''];});
    const titleText=schoolName+' 잠복결핵검사 누적 명단';
    /* 누적 명단 — 기간은 "누적(~오늘)" 표기 */
    const today=new Date();
    const todayStr=today.getFullYear()+'.'+(today.getMonth()+1)+'.'+today.getDate();
    const periodText='기간: 누적 (~ '+todayStr+')';
    /* 색상바 pixel-based split (노란/초록 30%) */
    const total=colWidths.reduce(function(a,b){return a+b;},0);
    const threshold30=total*0.3;
    let acc=0,top2=0;
    for(let i=colWidths.length-1;i>=0;i--){acc+=colWidths[i];top2++;if(acc>=threshold30)break;}
    acc=0;let bot1=0;
    for(let i=0;i<colWidths.length;i++){acc+=colWidths[i];bot1++;if(acc>=threshold30)break;}
    const top1=Math.max(1,colCount-top2);
    if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 생성 중…'});
    window.electronAPI.xlsxBuildDiary({
      colCount:colCount,
      colWidths:colWidths,
      headerLabels:headerLabels,
      dataRows:dataRows,
      titleText:titleText,
      schoolText:'학교: '+schoolName,
      periodText:periodText,
      top1:top1,
      bot1:bot1
    }).then(function(res){
      if(!res||!res.success){
        if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 생성 실패: '+(res&&res.error||'')});
        return;
      }
      const buf=new Uint8Array(res.bytes);
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;
      a.download=titleText+'.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 파일이 저장되었습니다.'});
    }).catch(function(e){
      if(typeof bus!=='undefined')bus.emit('toast:show',{text:'Excel 오류: '+(e&&e.message||e)});
    });
  },{allowEmpty:true});
}

/* 잠복결핵 명단 Google Sheets 내보내기 — 누적 보기 없이도 자동 로드, 확인 팝업으로 사용자에게 생성 확인.
 * 데이터 0건이어도 헤더만 포함한 스프레드시트 생성 (사용자 요구) */
function _apTbExportSheets(){
  _apTbEnsureData(function(records){
    const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)?S.settings.schoolName:'○○학교';
    /* records 가 비어있어도 헤더만으로 시트 생성 */
    records=records||[];
    const yr=typeof _academicYear==='function'?_academicYear():new Date().getFullYear();
    const sorted=records.slice();
    sorted.sort(function(a,b){
      const da=(a.date||'').replace(/\./g,''), db=(b.date||'').replace(/\./g,'');
      return _apTbSortOrder==='asc'?da.localeCompare(db):db.localeCompare(da);
    });
    const header=['순','직위','이름','검사일','검진기관명'];
    const dataRows=sorted.map(function(r,i){return [i+1,r.pos||'',r.name||'',r.date||'',r.inst||''];});
    const allRows=[header].concat(dataRows);
    /* 잠복결핵 검사는 영구 누적 데이터이므로 학년도 표기 없음 */
    const titleText=schoolName+' 잠복결핵검사 누적 명단';

    /* 연수/교육 등록부와 동일한 확인 팝업 — 사용자가 내 Google 드라이브로 전송 확인 */
    const existing=document.getElementById('tbSheetsOverlay');if(existing)existing.remove();
    const ov=document.createElement('div');
    ov.className='modal-overlay show';
    ov.id='tbSheetsOverlay';
    /* z-index 9700 — 인원 데이터 관리 모달(9000) 위에 뜨도록 */
    ov.style.background='rgba(0,0,0,0.35)';
    ov.style.zIndex='9700';
    /* fade-out 애니메이션 지원: remove 대신 closeModalGracefully 호출 */
    function _tbSheetsClose(){if(typeof closeModalGracefully==='function')closeModalGracefully(ov);else ov.remove();}
    let html='<div class="modal-content" style="width:440px;max-width:94vw;padding:0">';
    html+='<div style="background:var(--popup-head);padding:14px 18px;border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0">';
    html+='<div style="font-size:14px;font-weight:800;color:var(--t1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Google Sheets로 내보내기</div></div>';
    html+='<div style="padding:18px">';
    html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
      +'<div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#34a853,#1e8e3e);display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg></div>'
      +'<div><div style="font-size:13px;font-weight:700;color:var(--t1)">내 Google 드라이브에 저장</div>'
      +'<div style="font-size:10px;color:var(--t3)">새 스프레드시트가 자동으로 생성됩니다</div></div></div>';
    html+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11px;color:var(--t2)">';
    html+='<div style="margin-bottom:6px"><strong>파일명:</strong> '+escHtml(titleText)+'</div>';
    html+='<div style="margin-bottom:6px"><strong>수검자:</strong> '+sorted.length+'명</div>';
    html+='<div><strong>총 행:</strong> '+(allRows.length)+'행 (헤더 포함)</div>';
    html+='</div>';
    html+=_sheetsAccountHtml('tbSheetsAcct');
    html+=_pmSheetsFolderUiHtml();
    html+='</div>';
    html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 10px 10px">';
    html+='<button id="tbSheetsSendBtn" style="padding:7px 22px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>생성 및 보내기</button>';
    html+='</div></div>';
    ov.innerHTML=html;
    ov.addEventListener('click',function(e){
      if(e.target===ov){ov.remove();return;}
      const el=e.target.closest('[data-tb-act]');
      if(el&&el.dataset.tbAct==='cancel')_tbSheetsClose();
    });
    _pmBindSheetsFolderUi(ov);
    document.body.appendChild(ov);
    _sheetsAccountInit('tbSheetsAcct');

    document.getElementById('tbSheetsSendBtn').addEventListener('click',async function(){
      const btn=this;btn.disabled=true;
      btn.innerHTML='<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 생성 중...';
      try{
        if(!(window.electronAPI&&window.sheetsExportWithConsent))throw new Error('Google Sheets 연동 미구성');
        /* 서식: 제목 병합 + 색상 바 + 헤더 강조 + 데이터 테두리 */
        const sheetId=0;
        const totalRows=allRows.length;
        const fmtReqs=[];
        /* 헤더행(인덱스 0) 굵게 + 배경 */
        fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:header.length},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{bold:true,fontSize:11},backgroundColor:{red:0.91,green:0.96,blue:0.97}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'}});
        /* 데이터 영역 가운데 정렬 + 테두리 */
        if(totalRows>1){
          fmtReqs.push({repeatCell:{range:{sheetId:sheetId,startRowIndex:0,endRowIndex:totalRows,startColumnIndex:0,endColumnIndex:header.length},cell:{userEnteredFormat:{horizontalAlignment:'CENTER',textFormat:{fontSize:10},borders:{top:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},bottom:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},left:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}},right:{style:'SOLID',color:{red:0.73,green:0.73,blue:0.73}}}}},fields:'userEnteredFormat(horizontalAlignment,textFormat,borders)'}});
        }
        /* 열 너비 */
        const colWidths=[40,90,90,110,180];
        colWidths.forEach(function(w,i){
          fmtReqs.push({updateDimensionProperties:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}});
        });
        /* 데이터 영역 밖의 빈 셀 제거 (기본 26cols × 1000rows → 사용 범위로 축소) */
        const DEFAULT_COLS=26, DEFAULT_ROWS=1000;
        const _colCountTb=header.length;
        if(_colCountTb<DEFAULT_COLS){
          fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'COLUMNS',startIndex:_colCountTb,endIndex:DEFAULT_COLS}}});
        }
        if(totalRows<DEFAULT_ROWS){
          fmtReqs.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:totalRows,endIndex:DEFAULT_ROWS}}});
        }
        const createRes=await window.sheetsExportWithConsent({
          title:titleText,
          sheetTitle:'잠복결핵명단',
          range:'잠복결핵명단!A1',
          values:allRows,
          requests:fmtReqs,
          targetFolderId:(_pmSheetsFolder&&_pmSheetsFolder.id)||null
        });
        if(!createRes||!createRes.success)throw new Error((createRes&&createRes.error)||'스프레드시트 생성 실패');
        const ssUrl=createRes.spreadsheetUrl||'';
        /* 성공 시 중간 단계 없이 즉시 스프레드시트 열고 팝업 닫음 */
        if(ssUrl&&window.electronAPI&&window.electronAPI.openExternal){
          window.electronAPI.openExternal(ssUrl);
        }
        _tbSheetsClose();
      }catch(err){
        const msg=String(err&&err.message||err||'');
        btn.disabled=false;
        btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg> 생성 및 보내기';
        /* Not authenticated / Sheets 계정 미인증 → 인라인으로 로그인 링크 제공 */
        const needAuth=/not authenticated|Sheets account|authenticate|no.*token|unauthorized|401/i.test(msg);
        const body=ov.querySelector('.modal-content > div:nth-child(2)');
        if(body){
          if(needAuth){
            body.innerHTML='<div style="text-align:center;padding:10px 0">'
              +'<div style="font-size:40px;margin-bottom:10px">🔐</div>'
              +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">Google 계정 로그인이 필요합니다</div>'
              +'<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.6">1단계: 아래 <b>로그인</b> 버튼 클릭 → 새 창에서 Google 계정 인증<br>2단계: 인증 완료되면 <b>내보내기 재시도</b> 버튼 클릭</div>'
              +'<div style="display:flex;gap:8px;justify-content:center">'
              +'<a href="/auth/google/start?account=sheets" target="_blank" style="padding:10px 20px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#34a853,#1e8e3e);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f);text-decoration:none">1️⃣ Google 로그인</a>'
              +'<button id="tbSheetsRetryBtn" style="padding:10px 20px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#3b82f6,#1e40af);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f)">2️⃣ 내보내기 재시도</button>'
              +'</div></div>';
            /* 재시도 버튼 바인딩 — 팝업 닫고 재실행 */
            setTimeout(function(){
              const rb=document.getElementById('tbSheetsRetryBtn');
              if(rb)rb.addEventListener('click',function(){
                _tbSheetsClose();
                setTimeout(function(){_apTbExportSheets();},260);
              });
            },50);
          } else {
            body.innerHTML='<div style="text-align:center;padding:10px 0">'
              +'<div style="font-size:40px;margin-bottom:10px">⚠️</div>'
              +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">내보내기 실패</div>'
              +'<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.6">'+escHtml(msg||'알 수 없는 오류')+'</div>'
              +'</div>';
          }
        }
      }
    });
  },{allowEmpty:true});
}

function _apTbSort(order){
  _apTbSortOrder=order;
  /* tbody·카운트만 갱신 — 검색 입력창 IME 조합 보존 */
  if(typeof _apTbApplyListBody==='function') _apTbApplyListBody();
  else _apTbRenderListTable();
}

function _closeWtPopup(){
  const ov=document.getElementById('apWtPopupOv');if(ov)closeModalGracefully(ov);
}
function _closeWtAllOv(){
  const ov=document.getElementById('apWtAllOv');if(ov)closeModalGracefully(ov);
}

/* ══════════════════════════════════════════
   data-action 이벤트 위임 등록
   ESM 모듈 함수는 window에 노출되지 않으므로
   _pmActions 맵에 명시적으로 등록해야 합니다.
   ══════════════════════════════════════════ */
/* 좌측 메뉴 */
_pmActions['activatePanel']=_apActivatePanel;
/* 학생 */
_pmActions['_apStuAction']=_apStuAction;
_pmActions['_apStuOpenSearch']=_apStuOpenSearch;
_pmActions['_apStaffOpenSearch']=_apStaffOpenSearch;
_pmActions['_apStuEditGrade']=_apStuEditGrade;
_pmActions['_apStuEditClass']=_apStuEditClass;
_pmActions['_apStuEditPick']=_apStuEditPick;
_pmActions['_apStuEditSave']=_apStuEditSave;
_pmActions['_apStuDelete']=_apStuDelete;
_pmActions['_apStuBulk']=_apStuBulk;
_pmActions['_apStuListPopup']=_apStuListPopup;
_pmActions['_apBulkDeleteStudents']=_apBulkDeleteStudents;
_pmActions['addPerson']=addPerson;
_pmActions['downloadOptimizedStudentTemplate']=downloadOptimizedStudentTemplate;
/* 교직원 */
_pmActions['_apStaffAction']=_apStaffAction;
/* 외부(settings-tab-people.js) 에서 업로드 성공 후 UI 새로고침 용도 */
window._apStaffAction=_apStaffAction;
window._apStuAction=_apStuAction;
window._apStaffInlineRender=typeof _apStaffInlineRender==='function'?_apStaffInlineRender:null;
window._apStuInlineRender=typeof _apStuInlineRender==='function'?_apStuInlineRender:null;
window._apCareInlineRender=typeof _apCareInlineRender==='function'?_apCareInlineRender:null;
_pmActions['_apStaffEditPick']=_apStaffEditPick;
_pmActions['_apStaffEditSave']=_apStaffEditSave;
_pmActions['_apStaffEditDelete']=_apStaffEditDelete;
_pmActions['_apStaffBulk']=_apStaffBulk;
_pmActions['_apStaffListPopup']=_apStaffListPopup;
_pmActions['_apBulkDeleteStaff']=_apBulkDeleteStaff;
_pmActions['downloadOptimizedStaffTemplate']=downloadOptimizedStaffTemplate;
/* 요보호 */
_pmActions['_apCareGrade']=_apCareGrade;
_pmActions['_apCareClass']=_apCareClass;
_pmActions['_apCarePickStudent']=_apCarePickStudent;
_pmActions['_apCareEditFromList']=_apCareEditFromList;
_pmActions['_apCareOpenEditList']=_apCareOpenEditList;
_pmActions['_apCareEditListClose']=_apCareEditListClose;
_pmActions['_apCareEditListPick']=_apCareEditListPick;
_pmActions['_apCareEditListSearchInput']=_apCareEditListSearchInput;
_pmActions['_apCareUnmatchedModal']=_apCareUnmatchedModal;
_pmActions['_apStuUnmatchedModal']=_apStuUnmatchedModal;
_pmActions['_apCareSave']=_apCareSave;
_pmActions['_apCareDelete']=_apCareDelete;
_pmActions['_apCareFilterGrade']=_apCareFilterGrade;
_pmActions['_apCareBulk']=_apCareBulk;
_pmActions['_apCareExportSheets']=_apCareExportSheets;
_pmActions['_apCareExportExcel']=_apCareExportExcel;
_pmActions['_apCareIndiv']=_apCareIndiv;
_pmActions['_apCareAction']=_apCareAction;
_pmActions['_apCareOpenSearch']=_apCareOpenSearch;
/* 뒤로 버튼 — 등록/수정 패널에서 카드 메뉴로 복귀 */
_pmActions['_apBack']=function(panelId){
  if(panelId==='student'){const b=document.getElementById('apStuBody');if(b)b.innerHTML='';}
  else if(panelId==='staff'){const b=document.getElementById('apStaffBody');if(b)b.innerHTML='';}
  else if(panelId==='care'){const b=document.getElementById('apCareBody');if(b)b.innerHTML='';}
  else if(panelId==='tb'){const b=document.getElementById('apTbBody');if(b)b.innerHTML='';}
};
_pmActions['_apCareListPopup']=_apCareListPopup;
_pmActions['downloadOptimizedCareTemplate']=downloadOptimizedCareTemplate;
/* 동의 관리 */
_pmActions['_apConsentFilter']=_apConsentFilter;
_pmActions['_apConsentSearch']=_apConsentSearch;
_pmActions['_apConsentClearSearch']=_apConsentClearSearch;
_pmActions['_apStuInlineFilter']=_apStuInlineFilter;
_pmActions['_apCareInlineFilter']=_apCareInlineFilter;
_pmActions['_apStaffInlineFilter']=_apStaffInlineFilter;
_pmActions['_apToggleConsent']=_apToggleConsent;
_pmActions['_apMcIndiv']=_apMcIndiv;
_pmActions['_apMcGrade']=_apMcGrade;
_pmActions['_apMcClass']=_apMcClass;
_pmActions['_apMcListPopup']=_apMcListPopup;
/* 잠복결핵 */
_pmActions['_apTbIndiv']=_apTbIndiv;
_pmActions['_apTbOpenCal']=_apTbOpenCal;
_pmActions['_apTbIndivSave']=_apTbIndivSave;
_pmActions['_apTbBulk']=_apTbBulk;
_pmActions['_apTbDownloadTemplate']=_apTbDownloadTemplate;
_pmActions['_apTbHandleFile']=_apTbHandleFile;
_pmActions['_apTbShowList']=_apTbShowList;
_pmActions['_apTbSort']=_apTbSort;
_pmActions['_apTbExportExcel']=_apTbExportExcel;
_pmActions['_apTbExportSheets']=_apTbExportSheets;
_pmActions['_apTbListSearchInput']=_apTbListSearchInput;
_pmActions['_apTbListSearchClear']=_apTbListSearchClear;
_pmActions['_apTbRowPick']=_apTbRowPick;
_pmActions['_apTbEditSave']=_apTbEditSave;
_pmActions['_apTbEditDelete']=_apTbEditDelete;
_pmActions['_apCareInlineSearchInput']=_apCareInlineSearchInput;
_pmActions['_apCareInlineSearchClear']=_apCareInlineSearchClear;
_pmActions['_apStuInlineSearchInput']=_apStuInlineSearchInput;
_pmActions['_apStuInlineSearchClear']=_apStuInlineSearchClear;
_pmActions['_apStaffInlineSearchInput']=_apStaffInlineSearchInput;
_pmActions['_apStaffInlineSearchClear']=_apStaffInlineSearchClear;
/* 체중 관리 */
_pmActions['_apWtDetailSearch']=_apWtDetailSearch;
_pmActions['_apWtAllCharts']=_apWtAllCharts;
_pmActions['_apWtGrade']=_apWtGrade;
_pmActions['_apWtClass']=_apWtClass;
_pmActions['_apWtSelectStudent']=_apWtSelectStudent;
_pmActions['_apWtOpenPopup']=_apWtOpenPopup;
_pmActions['_apWtRemoveStudent']=_apWtRemoveStudent;
_pmActions['_apWtOpenCal']=_apWtOpenCal;
_pmActions['_apWtAddEntry']=_apWtAddEntry;
_pmActions['_apWtDownloadAllCharts']=_apWtDownloadAllCharts;
_pmActions['closeWtPopup']=_closeWtPopup;
_pmActions['closeWtAllOv']=_closeWtAllOv;
/* 삭제 */
_pmActions['_apDelType']=_apDelType;
_pmActions['_apDelGrade']=_apDelGrade;
_pmActions['_apDelClass']=_apDelClass;
_pmActions['_apDelConfirm']=_apDelConfirm;
/* input/file 핸들러 */
_pmActions['_apWtDoSearch']=_apWtDoSearch;
_pmActions['_apTbDoSearchProxy']=_apTbDoSearch;
_pmActions['apBirthFormat']=apBirthFormat;
_pmActions['handleStudentFile']=handleStudentFile;
_pmActions['handleStaffFile']=handleStaffFile;
_pmActions['_apTbHandleFile']=_apTbHandleFile;
_pmActions['_apCareBulkProcess']=_apCareBulkProcess;
_pmActions['_apTbHandlePaste']=_apTbHandlePaste;
_pmActions['handleStudentUploadPaste']=handleStudentUploadPaste;
_pmActions['_apWtDelEntry']=_apWtDelEntry;


/* ════════════════════════════════════════════════════════════
   동명이인 매칭 모달 — 일괄 등록 후 보류된 학생 처리
   디자인 참고: ~/Desktop/manual_match_mockup_v6.html
   설계: 회색 헤더(드래그) · 1/N 페이저 · ◀▶ 좌우 네비 · 학교급/학년 칩 ·
        반 그리드(번호+이름) · 건너뛰기 없음 · ⚠ 빨간 안내
   ════════════════════════════════════════════════════════════ */
let _ambState = null;
let _ambKeyHandler = null;

function _ambGetCurYear(){
  const d = new Date();
  return String(d.getMonth()+1 >= 3 ? d.getFullYear() : d.getFullYear()-1);
}
function _ambEsc(s){ return escHtml(s == null ? '' : String(s)); }

export async function openAmbiguousMatchModal(){
  if(!window.electronAPI || !window.electronAPI.studentsPendingAmbiguousList) return;
  const yr = _ambGetCurYear();
  const res = await window.electronAPI.studentsPendingAmbiguousList(yr);
  if(!res || !res.success){ alert('동명이인 목록 조회 실패'); return; }
  const items = res.items || [];
  if(!items.length){ alert('처리할 동명이인이 없습니다.'); return; }
  const students = (S.people || []).filter(p => p.type === 'student' && p.is_active !== false && p.is_active !== 0);
  const levelSet = {}; students.forEach(s => { if(s.level) levelSet[s.level] = true; });
  const levels = Object.keys(levelSet);
  if(!levels.length) levels.push('elementary');
  _ambState = {
    items: items, idx: 0, students: students,
    selectedLevel: items[0].level || levels[0],
    selectedGrade: (items[0].excelGrade != null ? String(items[0].excelGrade) : ''),
    selectedDept: (items[0].department != null ? String(items[0].department) : ''),
    levels: levels, year: yr,
  };
  _ambRenderModal();
}

function _ambBuildHtml(){
  const st = _ambState;
  const cur = st.items[st.idx];
  const total = st.items.length;
  const pct = ((st.idx+1)/total*100).toFixed(1);
  const meta = (cur.department != null && String(cur.department).trim() ? String(cur.department).trim()+' ':'')
              +(cur.excelGrade != null ? cur.excelGrade+'학년 ':'')
              +(cur.excelClass != null ? cur.excelClass+'반 ':'')
              +(cur.excelNum != null ? cur.excelNum+'번':'');
  let h = '<div class="modal-content amb-modal" id="ambModalBox" style="width:840px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(0,0,0,0.08);box-shadow:0 24px 60px rgba(0,0,0,0.30);position:relative">';
  /* 헤더 (회색 + 드래그) */
  h += '<div class="amb-head" id="ambDragHandle" style="padding:12px 16px;display:flex;gap:10px;align-items:center;background:linear-gradient(180deg,#eef2f6,#e5e9ee);border-bottom:1px solid var(--bdr);cursor:grab;user-select:none">'
    + '<span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0.5"><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span></span>'
    + '<span style="font-size:13px;font-weight:700;color:var(--t1);flex:1">🔗 신학기 명단 동명이인 매칭</span>'
    + '<span id="ambCounter" style="font-size:10.5px;padding:3px 9px;background:rgba(6,182,212,0.10);color:var(--cyan);border-radius:10px;font-weight:700">'+(st.idx+1)+' / '+total+'</span>'
    + '</div>';
  /* 진행 막대 */
  h += '<div style="height:3px;background:var(--bdrl);position:relative;overflow:hidden"><div id="ambProgress" style="height:100%;background:linear-gradient(90deg,#06b6d4,#0891b2);width:'+pct+'%;transition:width .25s ease"></div></div>';
  /* 좌우 네비 + 미매칭 정보 */
  h += '<div style="padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl);background:linear-gradient(180deg,rgba(6,182,212,0.04),transparent)">'
    + '<button class="amb-nav" data-amb-nav="prev" '+(st.idx===0?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx===0?';opacity:0.35;cursor:not-allowed':'')+'">◀</button>'
    + '<div style="flex:1;padding:8px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.20);border-radius:9px;display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:16px">⚠</span>'
      + '<div><div id="ambCurName" style="font-size:13px;font-weight:800;color:var(--t1)">'+_ambEsc(cur.name||'(이름 없음)')+'</div>'
      + '<div id="ambCurMeta" style="font-size:10.5px;color:var(--t2)">올해 명단: '+_ambEsc(meta||'학번 누락')+(cur.gender?' · '+_ambEsc(cur.gender):'')+(cur.birth_date?' · '+_ambEsc(cur.birth_date):' · 생년월일 미입력')+'</div></div>'
      + '<span style="flex:1"></span>'
      + '<span style="font-size:9.5px;font-weight:700;color:#dc2626;background:rgba(239,68,68,0.10);padding:3px 8px;border-radius:8px">동명이인</span>'
    + '</div>'
    + '<button class="amb-nav" data-amb-nav="next" '+(st.idx>=total-1?'disabled':'')+' style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center'+(st.idx>=total-1?';opacity:0.35;cursor:not-allowed':'')+'">▶</button>'
    + '</div>';
  /* 학교급 — 항상 wrapper 렌더링하여 부분 갱신 가능 */
  h += '<div id="ambLvRow" style="padding:10px 16px;display:'+(st.levels.length>=2?'flex':'none')+';align-items:center;gap:10px;border-bottom:1px solid var(--bdrl)">'+_ambLvRowInner()+'</div>';
  /* 학과 칩 — 학과가 입력된 학교(고교 등)에서만 노출 (사용자 요청 2026-06-09) */
  const _dpInner = _ambDeptRowInner();
  h += '<div id="ambDeptRow" style="padding:10px 16px;display:'+(_dpInner?'flex':'none')+';gap:10px;align-items:center;border-bottom:1px solid var(--bdrl);flex-wrap:wrap">'+_dpInner+'</div>';
  /* 학년 칩 — 항상 wrapper 렌더링 */
  const _grInner = _ambGrRowInner();
  h += '<div id="ambGrRow" style="padding:10px 16px;display:'+(_grInner?'flex':'none')+';gap:10px;align-items:center;border-bottom:1px solid var(--bdrl);flex-wrap:wrap">'+_grInner+'</div>';
  /* 작년(직전연도) 동일 이름 후보 직접 선택 — 진급 케이스: 후보가 올해 명단에 아직 없으므로 보류 후보로 고른다 */
  h += '<div id="ambCandidates"></div>';
  /* 반 그리드 */
  h += '<div class="amb-body" id="ambClassGrid" style="flex:1;padding:14px 16px;overflow-y:auto"></div>';
  /* 푸터 — 건너뛰기 없음 + 빨간 경고 */
  h += '<div style="padding:9px 16px;border-top:1px solid var(--bdrl);display:flex;align-items:center;gap:10px;background:#fafbfc">'
    + '<span style="font-size:9.5px;color:var(--t3);flex:1">← / →: 이전·다음 / 제목 행 드래그로 창 이동</span>'
    + '<span style="font-size:10.5px;font-weight:700;color:#dc2626;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.30);padding:5px 12px;border-radius:8px">⚠ 정확한 입력을 위해 동명이인 매칭 작업을 반드시 완료해주세요.</span>'
    + '</div>';
  h += '</div>';
  return h;
}

/* 학교급 칩 inner HTML — wrapper 제외 */
function _ambLvRowInner(){
  const st = _ambState;
  if(!st || st.levels.length < 2) return '';
  const lvLabel = {elementary:'초등학교',middle:'중학교',high:'고등학교',kindergarten:'유치원',special:'특수학교'};
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학교급</span>'
    + '<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px">';
  st.levels.forEach(function(lv){
    const act = st.selectedLevel === lv;
    h += '<button class="amb-lv" data-amb-lv="'+_ambEsc(lv)+'" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(act?'var(--card)':'transparent')+';color:'+(act?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer'+(act?';box-shadow:0 1px 3px rgba(0,0,0,0.08)':'')+'">'+(lvLabel[lv]||lv)+'</button>';
  });
  h += '</div>';
  return h;
}

/* 학년 칩 inner HTML — wrapper 제외 */
function _ambGrRowInner(){
  const st = _ambState;
  if(!st) return '';
  const grades = _ambGetGrades(st.selectedLevel, st.selectedDept);
  if(!grades.length) return '';
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학년</span>';
  grades.forEach(function(g){
    const act = String(st.selectedGrade) === String(g);
    h += '<button class="amb-gr" data-amb-gr="'+_ambEsc(g)+'" style="padding:5px 12px;font-size:11px;font-weight:600;border:1px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--card)')+';color:'+(act?'#fff':'var(--t2)')+';border-radius:14px;cursor:pointer'+(act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'')+'">'+_ambEsc(g)+'학년</button>';
  });
  return h;
}

/* 항목 변경(◀▶, 키보드, 매칭 후 자동 이동) 시 부분 갱신 — 모달 자체는 유지하고 안의 정보만 갱신 */
function _ambApplyItemChange(){
  const ov = document.getElementById('ambModal');
  if(!ov || !_ambState) return;
  const st = _ambState;
  const cur = st.items[st.idx];
  const total = st.items.length;
  /* 현재 항목의 학과를 올해 명단 탐색 기준에 반영 */
  if(cur && cur.department != null && String(cur.department).trim()) st.selectedDept = String(cur.department).trim();
  /* 카운터 (1 / N) */
  const counter = ov.querySelector('#ambCounter');
  if(counter) counter.textContent = (st.idx+1)+' / '+total;
  /* 진행 막대 */
  const prog = ov.querySelector('#ambProgress');
  if(prog) prog.style.width = ((st.idx+1)/total*100).toFixed(1)+'%';
  /* 현재 항목 정보 (학과 입력된 경우 학과도 표시) */
  const meta = (cur.department != null && String(cur.department).trim() ? String(cur.department).trim()+' ':'')
              +(cur.excelGrade != null ? cur.excelGrade+'학년 ':'')
              +(cur.excelClass != null ? cur.excelClass+'반 ':'')
              +(cur.excelNum != null ? cur.excelNum+'번':'');
  const nameEl = ov.querySelector('#ambCurName');
  if(nameEl) nameEl.textContent = cur.name || '(이름 없음)';
  const metaEl = ov.querySelector('#ambCurMeta');
  if(metaEl) metaEl.textContent = '올해 명단: '+(meta||'학번 누락')+(cur.gender?' · '+cur.gender:'')+(cur.birth_date?' · '+cur.birth_date:' · 생년월일 미입력');
  /* 이전/다음 버튼 활성화 상태 */
  const prevBtn = ov.querySelector('[data-amb-nav="prev"]');
  if(prevBtn){
    if(st.idx===0){ prevBtn.setAttribute('disabled',''); prevBtn.style.opacity='0.35'; prevBtn.style.cursor='not-allowed'; }
    else{ prevBtn.removeAttribute('disabled'); prevBtn.style.opacity=''; prevBtn.style.cursor='pointer'; }
  }
  const nextBtn = ov.querySelector('[data-amb-nav="next"]');
  if(nextBtn){
    if(st.idx>=total-1){ nextBtn.setAttribute('disabled',''); nextBtn.style.opacity='0.35'; nextBtn.style.cursor='not-allowed'; }
    else{ nextBtn.removeAttribute('disabled'); nextBtn.style.opacity=''; nextBtn.style.cursor='pointer'; }
  }
  /* 작년 후보 섹션(진급) + 학교급/학과/학년 칩 + 반 그리드 갱신 */
  _ambRenderCandidates();
  _ambApplyFilterChange();
}

/* 학교급/학년 칩 + 반 그리드만 부분 갱신 (모달 전체 재생성 없이) */
function _ambApplyFilterChange(){
  const ov = document.getElementById('ambModal');
  if(!ov || !_ambState) return;
  const lvRow = ov.querySelector('#ambLvRow');
  if(lvRow){
    lvRow.innerHTML = _ambLvRowInner();
    lvRow.style.display = (_ambState.levels.length >= 2) ? 'flex' : 'none';
    lvRow.querySelectorAll('[data-amb-lv]').forEach(function(el){
      el.addEventListener('click', _ambOnLvClick);
    });
  }
  const dpRow = ov.querySelector('#ambDeptRow');
  if(dpRow){
    const dpInner = _ambDeptRowInner();
    dpRow.innerHTML = dpInner;
    dpRow.style.display = dpInner ? 'flex' : 'none';
    dpRow.querySelectorAll('[data-amb-dept]').forEach(function(el){
      el.addEventListener('click', _ambOnDeptClick);
    });
  }
  const grRow = ov.querySelector('#ambGrRow');
  if(grRow){
    const inner = _ambGrRowInner();
    grRow.innerHTML = inner;
    grRow.style.display = inner ? 'flex' : 'none';
    grRow.querySelectorAll('[data-amb-gr]').forEach(function(el){
      el.addEventListener('click', _ambOnGrClick);
    });
  }
  _ambRenderClassGrid();
}

function _ambOnLvClick(){
  _ambState.selectedLevel = this.dataset.ambLv;
  /* 학교급 바뀌면 학과·학년을 그 학교급 기준으로 보정 */
  const depts = _ambGetDepts(_ambState.selectedLevel);
  if(!depts.length) _ambState.selectedDept = '';
  else if(depts.indexOf(_ambState.selectedDept) === -1) _ambState.selectedDept = depts[0];
  const grades = _ambGetGrades(_ambState.selectedLevel, _ambState.selectedDept);
  if(grades.length && grades.indexOf(_ambState.selectedGrade) === -1) _ambState.selectedGrade = grades[0];
  _ambApplyFilterChange();
}

function _ambOnDeptClick(){
  _ambState.selectedDept = this.dataset.ambDept;
  /* 학과 바뀌면 학년을 그 학과 기준으로 보정 */
  const grades = _ambGetGrades(_ambState.selectedLevel, _ambState.selectedDept);
  if(grades.length && grades.indexOf(_ambState.selectedGrade) === -1) _ambState.selectedGrade = grades[0];
  _ambApplyFilterChange();
}

function _ambOnGrClick(){
  _ambState.selectedGrade = this.dataset.ambGr;
  _ambApplyFilterChange();
}

/* 선택된 학교급의 학과 목록 (학과가 입력된 학생이 있을 때만). 사용자 요청 2026-06-09 */
function _ambGetDepts(level){
  const set = {};
  (_ambState.students || []).forEach(function(s){
    if(level && s.level && s.level !== level) return;
    if(s.department && String(s.department).trim()) set[String(s.department).trim()] = true;
  });
  return Object.keys(set).sort();
}

function _ambGetGrades(level, dept){
  const set = {};
  (_ambState.students || []).forEach(function(s){
    if(level && s.level && s.level !== level) return;
    if(dept && s.department && String(s.department).trim() !== String(dept)) return;
    if(s.grade !== undefined && s.grade !== null && s.grade !== '') set[String(s.grade)] = true;
  });
  return Object.keys(set).sort(function(a,b){
    const na = parseInt(a,10), nb = parseInt(b,10);
    if(!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

/* 학과 칩 inner HTML — wrapper 제외 */
function _ambDeptRowInner(){
  const st = _ambState;
  if(!st) return '';
  const depts = _ambGetDepts(st.selectedLevel);
  if(!depts.length) return '';
  let h = '<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학과</span>';
  depts.forEach(function(d){
    const act = String(st.selectedDept) === String(d);
    h += '<button class="amb-dept" data-amb-dept="'+_ambEsc(d)+'" style="padding:5px 12px;font-size:11px;font-weight:600;border:1px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--card)')+';color:'+(act?'#fff':'var(--t2)')+';border-radius:14px;cursor:pointer'+(act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'')+'">'+_ambEsc(d)+'</button>';
  });
  return h;
}

function _ambRenderModal(){
  const st = _ambState; if(!st) return;
  const old = document.getElementById('ambModal'); if(old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay show';
  ov.id = 'ambModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;z-index:9999';
  ov.innerHTML = _ambBuildHtml();
  document.body.appendChild(ov);
  _ambBindEvents(ov);
  _ambRenderCandidates();
  _ambRenderClassGrid();
}

/* 작년(직전연도) 동일 이름 후보를 직접 고르는 섹션 (사용자 요청 2026-06-09).
 *  진급 케이스: 예) 올해 2학년1반3번 김재웅 ← 작년 1학년1반3번 김재웅 / 1학년1반4번 김재웅 중 선택.
 *  후보는 백엔드 보류 candidates(작년 학년·반·번호 priorGrade/priorClass/priorNum 포함).
 *  작년 정보가 없으면(올해 첫 해 이관 케이스) 올해 명단에서 uid로 조회해 표시. */
function _ambRenderCandidates(){
  const st = _ambState;
  const host = document.getElementById('ambCandidates');
  if(!host || !st) return;
  const cur = st.items[st.idx];
  const cands = (cur && cur.candidates) || [];
  if(!cands.length){ host.style.display='none'; host.innerHTML=''; return; }
  /* 작년 정보(priorGrade/priorClass/priorNum)가 있어야 '진급' 케이스 — 이때만 작년 후보 섹션을 띄운다.
     외부 이관(올해, 작년 없음)은 후보 섹션을 숨기고 아래 '올해 명단' 반 그리드로 고르게 한다 (사용자 요청 2026-06-09). */
  const hasPrior = cands.some(function(c){ return c.priorGrade!=null || c.priorClass!=null || c.priorNum!=null || (c.priorDepartment!=null && String(c.priorDepartment).trim()); });
  if(!hasPrior){ host.style.display='none'; host.innerHTML=''; return; }
  const _multiLv = (st.levels||[]).length >= 2;
  const _lvLabel = {elementary:'초',middle:'중',high:'고',kindergarten:'유',special:'특수'};
  const _seat = function(c){
    if(c.priorGrade!=null || c.priorClass!=null || c.priorNum!=null || (c.priorDepartment!=null && String(c.priorDepartment).trim())){
      /* 작년 정보: 학교급(여러개면)·학과(입력시)·학년(=올해-1)·반·번호 (사용자 요청 2026-06-09) */
      return '작년 '
        + (_multiLv && c.priorLevel ? (_lvLabel[c.priorLevel]||c.priorLevel)+' ' : '')
        + (c.priorDepartment!=null && String(c.priorDepartment).trim() ? String(c.priorDepartment).trim()+' ' : '')
        + (c.priorGrade!=null?c.priorGrade+'학년 ':'')
        + (c.priorClass!=null?c.priorClass+'반 ':'')
        + (c.priorNum!=null?c.priorNum+'번':'');
    }
    const inCur = (st.students||[]).find(function(s){return (s.uid||s.id)===c.uid;});
    if(inCur){ return '올해 '
        + (_multiLv && inCur.level ? (_lvLabel[inCur.level]||inCur.level)+' ' : '')
        + (inCur.department!=null && String(inCur.department).trim() ? String(inCur.department).trim()+' ' : '')
        + (inCur.grade!=null?inCur.grade+'학년 ':'')
        + (inCur.cls!=null&&inCur.cls!==''?inCur.cls+'반 ':'')
        + (inCur.num?inCur.num+'번':''); }
    return '';
  };
  let h = '<div style="padding:10px 16px;border-bottom:1px solid var(--bdrl);background:rgba(245,158,11,0.05)">';
  h += '<div style="font-size:10.5px;font-weight:800;color:#d97706;margin-bottom:6px">🔗 같은 이름 후보 — 이 학생이 작년의 누구였는지 선택하세요</div>';
  h += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
  cands.forEach(function(c){
    const seat=_seat(c);
    h += '<button class="amb-cand" data-amb-cand="'+_ambEsc(c.uid)+'" style="text-align:left;padding:7px 12px;border:1.5px solid var(--cyan);background:rgba(6,182,212,0.08);border-radius:9px;cursor:pointer;font-family:var(--f)">'
      + '<span style="font-size:12px;font-weight:800;color:var(--t1)">'+_ambEsc(c.name||'')+'</span>'
      + (seat?' <span style="font-size:10px;color:var(--t2)">'+_ambEsc(seat)+'</span>':'')
      + (c.birth_date?' <span style="font-size:9.5px;color:var(--t3)">'+_ambEsc(c.birth_date)+'</span>':'')
      + '</button>';
  });
  h += '</div>';
  h += '<button class="amb-cand-new" data-amb-cand-new="1" style="margin-top:8px;padding:6px 12px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--f)">+ 새 학생으로 등록 (작년 기록 연결 안 함)</button>';
  h += '<span style="font-size:9.5px;color:var(--t3);margin-left:8px">위 후보가 아니면 아래 반 명단에서 직접 골라도 됩니다.</span>';
  h += '</div>';
  host.style.display='block';
  host.innerHTML = h;
  host.querySelectorAll('[data-amb-cand]').forEach(function(el){
    el.addEventListener('click', function(){ _ambMatchTo(this.dataset.ambCand); });
  });
  const nb = host.querySelector('[data-amb-cand-new]');
  if(nb) nb.addEventListener('click', function(){ _ambMatchTo(null); });
}
function _ambRenderClassGrid(){
  const st = _ambState;
  const grid = document.getElementById('ambClassGrid');
  if(!grid || !st) return;
  const cur = st.items[st.idx];
  const recName = (cur.name || '').trim();
  const filtered = st.students.filter(function(s){
    if(st.selectedLevel && s.level && s.level !== st.selectedLevel) return false;
    if(st.selectedDept && s.department && String(s.department).trim() !== String(st.selectedDept)) return false;
    if(st.selectedGrade !== '' && String(st.selectedGrade) !== String(s.grade)) return false;
    return true;
  });
  if(!filtered.length){
    grid.innerHTML = '<div style="padding:30px;text-align:center;color:var(--t3);font-size:11px">선택한 학년에 해당하는 학생이 없습니다. 다른 학년을 선택하세요.</div>';
    return;
  }
  const byCls = {};
  filtered.forEach(function(s){
    const c = (s.cls === undefined || s.cls === null || s.cls === '') ? '(반없음)' : String(s.cls);
    if(!byCls[c]) byCls[c] = [];
    byCls[c].push(s);
  });
  const clsKeys = Object.keys(byCls).sort(function(a,b){
    const na = parseInt(a,10), nb = parseInt(b,10);
    if(!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const colors = ['c1','c2','c3','c4','c5','c6'];
  const colorMap = {c1:'#06b6d4,#0891b2',c2:'#8b5cf6,#6d28d9',c3:'#f59e0b,#d97706',c4:'#10b981,#047857',c5:'#ef4444,#b91c1c',c6:'#ec4899,#be185d'};
  let h = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
  clsKeys.forEach(function(c, ci){
    const stus = byCls[c].sort(function(a,b){
      const na = parseInt(a.num,10), nb = parseInt(b.num,10);
      if(!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.num || '').localeCompare(b.num || '');
    });
    const cls = colors[ci % colors.length];
    const cc = colorMap[cls];
    const cur_cls = (cur.excelClass != null && String(cur.excelClass) === String(c));
    h += '<div class="amb-cls-card" style="position:relative;border-radius:12px;padding:10px;display:flex;flex-direction:column;background:var(--card);border:1.5px solid var(--bdr);overflow:hidden;min-height:180px;max-height:240px'+(cur_cls?';box-shadow:0 0 0 2.5px rgba(6,182,212,0.30),0 4px 10px rgba(0,0,0,0.08)':'')+'">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-radius:8px;color:#fff;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,0.10);background:linear-gradient(135deg,'+cc+')">'
       + '<span style="font-size:12px;font-weight:800">'+_ambEsc(c)+'반</span>'
       + '<span style="font-size:9px;font-weight:700;opacity:0.92;background:rgba(255,255,255,0.20);padding:1px 6px;border-radius:6px">'+stus.length+'명</span>'
       + '</div>';
    h += '<div class="amb-stus" style="flex:1;overflow-y:auto;padding:0 1px;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px">';
    stus.forEach(function(s){
      const recommend = recName && s.name === recName;
      h += '<div class="amb-stu" data-amb-pick="'+_ambEsc(s.id)+'" style="display:grid;grid-template-columns:32px 1fr;gap:6px;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;transition:background .12s'+(recommend?';background:rgba(245,158,11,0.10);font-weight:700':'')+'">'
        + '<span style="text-align:right;color:var(--t3);font-family:var(--fm);font-size:10px">'+(s.num?_ambEsc(s.num)+'번':'')+'</span>'
        + '<span style="color:var(--t1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+_ambEsc(s.name || '')+(recommend?' ⭐':'')+'</span>'
        + '</div>';
    });
    h += '</div></div>';
  });
  h += '</div>';
  grid.innerHTML = h;
  grid.querySelectorAll('[data-amb-pick]').forEach(function(el){
    el.addEventListener('mouseover', function(){ if(!this.style.background.includes('245,158,11')) this.style.background = 'rgba(6,182,212,0.10)'; });
    el.addEventListener('mouseout', function(){
      const recName = (_ambState.items[_ambState.idx].name || '').trim();
      const isRec = recName && this.textContent.trim().indexOf(recName) >= 0;
      this.style.background = isRec ? 'rgba(245,158,11,0.10)' : '';
    });
    el.addEventListener('click', function(){
      const stuId = this.dataset.ambPick;
      _ambMatchTo(stuId);
    });
  });
}

async function _ambMatchTo(chosenUid){
  const st = _ambState; if(!st) return;
  const cur = st.items[st.idx];
  if(!cur) return;
  try{
    const res = await window.electronAPI.studentsPendingAmbiguousResolve(st.year, cur.excelRow, chosenUid);
    if(!res || !res.success){ alert('매칭 실패: '+((res && res.error) || '')); return; }
  }catch(e){ alert('오류: '+e.message); return; }
  /* 처리한 항목 제거 후 다음으로 */
  st.items.splice(st.idx, 1);
  if(st.items.length === 0){
    _ambCloseModal();
    bus.emit('toast:show', { text: '✅ 모든 동명이인 매칭이 완료되었습니다.' });
    if(typeof _reloadStudentsFromDB === 'function') _reloadStudentsFromDB().then(function(){ if(typeof window._refreshAmbBtn === 'function') window._refreshAmbBtn(); });
    else if(typeof window._refreshAmbBtn === 'function') window._refreshAmbBtn();
    return;
  }
  if(st.idx >= st.items.length) st.idx = st.items.length - 1;
  const nx = st.items[st.idx];
  if(nx.level) st.selectedLevel = nx.level;
  if(nx.excelGrade != null) st.selectedGrade = String(nx.excelGrade);
  _ambApplyItemChange();
}

function _ambCloseModal(){
  const ov = document.getElementById('ambModal');
  if(ov) ov.remove();
  if(_ambKeyHandler){ document.removeEventListener('keydown', _ambKeyHandler); _ambKeyHandler = null; }
  _ambState = null;
  if(typeof window._refreshAmbBtn === 'function') window._refreshAmbBtn();
}

function _ambBindEvents(ov){
  /* 기존 키보드 핸들러 제거 후 재등록 — 누적 누수 방지 */
  if(_ambKeyHandler) document.removeEventListener('keydown', _ambKeyHandler);
  _ambKeyHandler = function(e){
    if(!_ambState) return;
    if(e.key === 'Escape'){ e.preventDefault(); _ambCloseModal(); }
    else if(e.key === 'ArrowLeft'){ if(_ambState.idx > 0){ _ambState.idx--; const p = _ambState.items[_ambState.idx]; if(p.level) _ambState.selectedLevel = p.level; if(p.excelGrade != null) _ambState.selectedGrade = String(p.excelGrade); _ambApplyItemChange(); } }
    else if(e.key === 'ArrowRight'){ if(_ambState.idx < _ambState.items.length - 1){ _ambState.idx++; const p = _ambState.items[_ambState.idx]; if(p.level) _ambState.selectedLevel = p.level; if(p.excelGrade != null) _ambState.selectedGrade = String(p.excelGrade); _ambApplyItemChange(); } }
  };
  document.addEventListener('keydown', _ambKeyHandler);
  /* 외부 클릭은 무시 (실수 닫힘 방지). Esc 또는 모든 매칭 완료 시 자동 닫힘 */
  ov.querySelectorAll('[data-amb-nav]').forEach(function(el){
    el.addEventListener('click', function(){
      if(this.disabled) return;
      const dir = this.dataset.ambNav;
      if(dir === 'prev' && _ambState.idx > 0){ _ambState.idx--; }
      else if(dir === 'next' && _ambState.idx < _ambState.items.length - 1){ _ambState.idx++; }
      const p = _ambState.items[_ambState.idx];
      if(p.level) _ambState.selectedLevel = p.level;
      if(p.excelGrade != null) _ambState.selectedGrade = String(p.excelGrade);
      _ambApplyItemChange();
    });
  });
  /* 학교급 — 부분 갱신 (모달 재생성 없음, 깜빡임 방지) */
  ov.querySelectorAll('[data-amb-lv]').forEach(function(el){
    el.addEventListener('click', _ambOnLvClick);
  });
  /* 학년 — 부분 갱신 */
  ov.querySelectorAll('[data-amb-gr]').forEach(function(el){
    el.addEventListener('click', _ambOnGrClick);
  });
  /* 헤더 드래그 */
  try {
    const handle = ov.querySelector('#ambDragHandle');
    const box = ov.querySelector('#ambModalBox');
    if(handle && box && typeof _makeDraggable === 'function') _makeDraggable(box, handle);
  } catch(_){}
}

/* 동명이인 처리 버튼 활성화/비활성화 갱신 */
/* 일반일지 버튼들과 동일한 .ems-mini-popup 스타일 — hover 즉시 노출 (browser default title delay 우회) */
let _ambTipEl = null;
function _ambShowTip(anchor, msg){
  _ambHideTip();
  if(!anchor) return;
  const pop = document.createElement('div');
  pop.className = 'ems-mini-popup';
  pop.style.padding = '8px 12px';
  pop.style.fontSize = '11.5px';
  pop.style.fontWeight = '600';
  pop.style.color = 'var(--t1)';
  pop.style.lineHeight = '1.5';
  pop.style.maxWidth = '280px';
  pop.style.whiteSpace = 'normal';
  pop.style.pointerEvents = 'none';
  pop.textContent = msg;
  document.body.appendChild(pop);
  _ambTipEl = pop;
  const r = anchor.getBoundingClientRect();
  /* 기본 위치: 버튼 아래 */
  let top = r.bottom + 6;
  let left = r.left;
  /* 화면 우측·하단 넘어가면 보정 */
  const pw = pop.offsetWidth || 200;
  const ph = pop.offsetHeight || 40;
  if(left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if(top + ph > window.innerHeight - 8) top = r.top - ph - 6;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}
function _ambHideTip(){
  if(_ambTipEl){ try{ _ambTipEl.remove(); }catch(_){ } _ambTipEl = null; }
}

/* 버튼 hover/click 핸들러 — 패널이 새로 렌더될 때마다 *DOM 새 버튼*에 다시 바인딩.
   disabled 속성을 쓰면 비활성 상태에서 mouseenter 이벤트가 안 들어와 미니팝업이 뜨지 않음 →
   data-amb-active 로 상태 관리하고 click 만 차단. */
function _ambBindButtonEvents(){
  const btn = document.getElementById('ambBtn');
  if(!btn || btn._ambTipBound) return;
  btn._ambTipBound = true;
  btn.addEventListener('mouseenter', function(){
    const msg = (this.dataset.ambActive === '1')
      ? '동명이인 매칭이 필요하므로 클릭해서 진행해주세요.'
      : '동명이인 매칭이 필요하지 않습니다.';
    _ambShowTip(this, msg);
  });
  btn.addEventListener('mouseleave', _ambHideTip);
  btn.addEventListener('click', function(e){
    _ambHideTip();
    if(this.dataset.ambActive !== '1'){ e.preventDefault(); e.stopPropagation(); return; }
    /* 활성 상태일 때만 모달 발동 (data-action 위임이 처리하지만 안전하게 직접 호출) */
    if(typeof openAmbiguousMatchModal === 'function') openAmbiguousMatchModal();
  });
}

window._refreshAmbBtn = async function(){
  const btn = document.getElementById('ambBtn');
  if(!btn || !window.electronAPI || !window.electronAPI.studentsPendingAmbiguousCount) return;
  /* 패널 새로 렌더되면 _ambTipBound 플래그가 사라진 새 DOM 노드라 매번 바인딩 시도 */
  _ambBindButtonEvents();
  try{
    const res = await window.electronAPI.studentsPendingAmbiguousCount();
    const cnt = (res && res.count) || 0;
    btn.removeAttribute('title');
    btn.removeAttribute('disabled');
    if(cnt > 0){
      btn.dataset.ambActive = '1';
      btn.style.cursor = 'pointer';
      btn.style.background = 'rgba(239,68,68,0.08)';
      btn.style.color = '#dc2626';
      btn.style.border = '1px solid rgba(239,68,68,0.40)';
      btn.style.fontWeight = '700';
      btn.innerHTML = '👥 동명이인 처리 ('+cnt+')';
    } else {
      btn.dataset.ambActive = '0';
      btn.style.cursor = 'not-allowed';
      btn.style.background = 'var(--bg2)';
      btn.style.color = 'var(--t3)';
      btn.style.border = '1px solid var(--bdr)';
      btn.style.fontWeight = '700';
      btn.style.opacity = '0.7';
      btn.innerHTML = '👥 동명이인 처리';
    }
  } catch(e){ /* 무시 */ }
};

_pmActions['openAmbModal'] = function(){ openAmbiguousMatchModal(); };
