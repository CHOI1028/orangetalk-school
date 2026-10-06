/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
import { S } from '../../core/app-state.js';
/* ES Module — 체격검사 마법사 (통합) */
import { escHtml, closeModalGracefully, compareClass } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { setNlMerge } from '../newsletter/newsletter-misc-view.js';
import { appData } from '../../core/app-data-bridge.js';

/* ═══════════════════════════════════════
   Store — IPC + localStorage 영속화
   ═══════════════════════════════════════ */
const _peAppData = appData;

function _peStoreLoad(){
  if(window.electronAPI && window.electronAPI.jsonLoadCommon){
    return window.electronAPI.jsonLoadCommon('physical_exam').then(function(res){
      if(res && res.exists && res.data) return res.data;
      try{ return JSON.parse(localStorage.getItem('ec_physical_exam')||'null'); }catch(e){ return null; }
    });
  }
  try{ return Promise.resolve(JSON.parse(localStorage.getItem('ec_physical_exam')||'null')); }catch(e){ return Promise.resolve(null); }
}

function _peStoreSave(data){
  if(window.electronAPI && window.electronAPI.jsonSaveCommon){
    return window.electronAPI.jsonSaveCommon('physical_exam', data);
  }
  try{ localStorage.setItem('ec_physical_exam', JSON.stringify(data)); }catch(e){}
  return Promise.resolve(null);
}

/* ═══════════════════════════════════════
   Model — 데이터 변환
   ═══════════════════════════════════════ */
function _peEnsureData(data){
  return data || { date:'', classes:{}, relayUrl:'', channelId:'' };
}

function _peModelSetDate(data, val){
  const next = _peEnsureData(data);
  next.date = val;
  return next;
}

function _peModelGenerate(data, people, selectedIds){
  const next = _peEnsureData(data);
  next.classes = {};
  (people || []).forEach(function(s){
    if(!selectedIds.has(String(s.id))) return;
    /* 반: 한글 학급명(가람·나래) 지원 — parseInt 강제 시 NaN 으로 그룹 key 가 깨지므로 문자열 그대로 (사용자 요청 2026-05-28). */
    const g = parseInt(s.grade, 10), c = String(s.cls == null ? '' : s.cls);
    const tk = g + '_' + c;
    if(!next.classes[tk]) next.classes[tk] = { people: [] };
    next.classes[tk].people.push({
      id:s.id, num:parseInt(s.num,10)||0, name:s.name||'',
      height:'',weight:'',visionNakedL:'',visionNakedR:'',visionCorrL:'',visionCorrR:''
    });
  });
  Object.keys(next.classes).forEach(function(tk){
    next.classes[tk].people.sort(function(a,b){ return a.num - b.num; });
  });
  if(!next.channelId) next.channelId = 'pe_' + Date.now().toString(36);
  return next;
}

function _peModelUpdateCell(data, tk, si, field, val){
  if(!data || !data.classes || !data.classes[tk] || !data.classes[tk].people[si]) return false;
  data.classes[tk].people[si][field] = val;
  return true;
}

/* ═══════════════════════════════════════
   Selection — 학년/반 선택 로직
   ═══════════════════════════════════════ */
function _peSelGetGrades(people){
  const stuList = (people||[]).filter(function(s){return s.type==='student'&&s.grade;});
  return Array.from(new Set(stuList.map(function(s){return parseInt(s.grade,10);}))).sort(function(a,b){return a-b;});
}

function _peSelCountByGrade(people, grade){
  return (people||[]).filter(function(s){return s.type==='student'&&parseInt(s.grade,10)===grade;}).length;
}

function _peSelCollectGrades(nodeList){
  const grades=[];
  (nodeList||[]).forEach(function(cb){grades.push(parseInt(cb.value,10));});
  return grades;
}

function _peSelBuildGroups(people, grades, schoolLevel){
  const stuList = (people||[]).filter(function(s){return s.type==='student'&&grades.indexOf(parseInt(s.grade,10))>=0;});
  const byGrade = {};
  stuList.forEach(function(s){
    const g=parseInt(s.grade,10);
    if(!byGrade[g])byGrade[g]={};
    /* 반: 한글 학급명 지원 — 문자열 그대로 그룹 key (사용자 요청 2026-05-28). */
    const c=String(s.cls==null?'':s.cls);
    if(!byGrade[g][c])byGrade[g][c]=[];
    byGrade[g][c].push(s);
  });
  const out=[];
  grades.slice().sort(function(a,b){return a-b;}).forEach(function(g){
    const classes=byGrade[g]||{};
    Object.keys(classes).sort(compareClass).forEach(function(c){
      const sts=classes[c]||[];
      sts.sort(function(a,b){return (parseInt(a.num,10)||0)-(parseInt(b.num,10)||0);});
      out.push({ grade:g, classNo:c, key:g+'-'+c, gradeLabel:schoolLevel==='kindergarten'?g+'세':g+'학년', people:sts });
    });
  });
  return out;
}

/* ═══════════════════════════════════════
   ViewModel — 탭/시트 표현
   ═══════════════════════════════════════ */
function _peVmHasData(data){
  return !!(data && data.date && data.classes && Object.keys(data.classes).length);
}

function _peVmResolveTab(data, activeTab){
  const tabKeys = Object.keys((data && data.classes) || {}).sort();
  if(!tabKeys.length) return null;
  if(activeTab && data.classes && data.classes[activeTab]) return activeTab;
  return tabKeys[0] || null;
}

function _peVmTabSummaries(data, activeTab){
  const classes = (data && data.classes) || {};
  return Object.keys(classes).sort().map(function(tk){
    const parts = tk.split('_');
    const clsData = classes[tk] || { people: [] };
    const filled = (clsData.people || []).filter(function(s){ return s.height || s.weight; }).length;
    const total = (clsData.people || []).length;
    return { key:tk, grade:parts[0], classNo:parts[1], isActive:tk===activeTab, filled:filled, total:total, done:!!(filled===total&&total) };
  });
}

/* ═══════════════════════════════════════
   TableView — 입력 테이블 행 생성
   ═══════════════════════════════════════ */
function _peRenderRows(activeTab, people){
  let h='';
  (people||[]).forEach(function(s,si){
    const tk=activeTab;
    h+='<tr>';
    h+='<td style="padding:4px 8px;border:1px solid var(--bdr);text-align:center;color:var(--t2);font-weight:600">'+s.num+'</td>';
    h+='<td style="padding:4px 8px;border:1px solid var(--bdr);text-align:center;color:var(--t1);font-weight:700">'+escHtml(s.name)+'</td>';
    const fields=['height','weight','visionNakedL','visionNakedR','visionCorrL','visionCorrR'];
    const bgs=['','','rgba(59,130,246,0.02)','rgba(59,130,246,0.02)','rgba(139,92,246,0.02)','rgba(139,92,246,0.02)'];
    fields.forEach(function(f,fi){
      h+='<td style="padding:0;border:1px solid var(--bdr);'+(bgs[fi]?'background:'+bgs[fi]:'')+'"><input class="form-input" data-pe-tk="'+tk+'" data-pe-si="'+si+'" data-pe-field="'+f+'" value="'+(s[f]||'')+'" style="width:100%;border:none;text-align:center;font-size:11px;padding:4px;font-family:var(--fm)" placeholder="—"></td>';
    });
    h+='</tr>';
  });
  return h;
}

/* ═══════════════════════════════════════
   Export — 엑셀/메일머지 내보내기
   ═══════════════════════════════════════ */
function _peExportMergeRows(data){
  if(!data || !data.classes) return [];
  const mergeRows = [];
  Object.keys(data.classes).sort().forEach(function(tk){
    const parts = tk.split('_');
    const g = parts[0], c = parts[1];
    const cls = data.classes[tk];
    (cls.people || []).forEach(function(s){
      mergeRows.push({
        '학년': g + '학년', '반': c + '반', '번호': s.num, '이름': s.name,
        '키(cm)': s.height || '', '몸무게(kg)': s.weight || '',
        '나안시력(좌)': s.visionNakedL || '', '나안시력(우)': s.visionNakedR || '',
        '교정시력(좌)': s.visionCorrL || '', '교정시력(우)': s.visionCorrR || ''
      });
    });
  });
  return mergeRows;
}

function _peExportWorkbook(data){
  if(!data || !data.classes) return [];
  return Object.keys(data.classes).sort().map(function(tk){
    const parts = tk.split('_');
    const g = parts[0], c = parts[1];
    const cls = data.classes[tk];
    const rows = [['번호','이름','키(cm)','몸무게(kg)','나안시력(좌)','나안시력(우)','교정시력(좌)','교정시력(우)']];
    (cls.people || []).forEach(function(s){
      rows.push([s.num,s.name,s.height?parseFloat(s.height):'',s.weight?parseFloat(s.weight):'',s.visionNakedL||'',s.visionNakedR||'',s.visionCorrL||'',s.visionCorrR||'']);
    });
    return { sheetName: g + '학년' + c + '반', rows: rows };
  });
}

/* ═══════════════════════════════════════
   View — 메인 렌더링 + 이벤트
   ═══════════════════════════════════════ */
S._peData=null;
let _peActiveTab=null;

function _peLoad(callback){
  _peStoreLoad().then(function(d){if(d)S._peData=d;if(callback)callback();}).catch(function(){if(callback)callback();});
}
function _peSave(){
  _peStoreSave(S._peData).catch(function(err){console.error('[DB] physical_exam 저장 실패:',err);});
}

function peRenderMain(){
  _peLoad(function(){
  const area=document.getElementById('peArea');if(!area)return;
  S._peData=_peEnsureData(S._peData);

  let h='';
  /* 좌측 설정 패널 */
  h+='<div style="width:280px;flex-shrink:0;border-right:1px solid var(--bdr);padding:16px;overflow-y:auto;background:var(--bg2)">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><span style="font-size:22px">🏋️</span><div><div style="font-size:14px;font-weight:800;color:var(--t1)">체격 검사 마법사</div><div style="font-size:10px;color:var(--t3)">담임교사 분산 입력 시스템</div></div></div>';

  /* 검사일 선택 */
  h+='<div style="margin-bottom:14px"><label class="form-label" style="font-size:11px">검사일</label>';
  h+='<div style="display:flex;align-items:center;gap:6px">';
  h+='<div id="peCalInput" data-action="open-cal" style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg);cursor:pointer;transition:border-color .15s">';
  h+='<span id="peCalLabel" style="font-size:12px;color:'+(S._peData.date?'var(--t1)':'var(--t3)')+';font-weight:'+(S._peData.date?'700':'400')+'">'+(S._peData.date||'날짜를 선택하세요')+'</span>';
  h+='</div>';
  h+='<span data-action="open-cal" style="cursor:pointer;font-size:18px" title="달력에서 선택">📅</span>';
  h+='</div></div>';

  /* 검사 시트 생성 */
  h+='<div style="margin-bottom:14px">';
  h+='<button class="btn btn-primary btn-sm" data-action="open-grade-select" style="width:100%;padding:10px;font-size:11px;font-weight:700">🔗 검사 시트 생성</button>';
  h+='</div>';

  /* 내보내기 + 가정통신문 */
  if(_peVmHasData(S._peData)){
    h+='<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">';
    h+='<button class="btn btn-sm" data-action="export-xlsx" style="width:100%;padding:10px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:4px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg> 나이스 양식에 맞춰 엑셀 다운로드</button>';
    h+='<button class="btn btn-sm" data-action="open-newsletter" style="width:100%;padding:10px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:4px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer">📄 메일머지 적용 가정통신문 바로 만들기</button>';
    h+='</div>';
  }
  h+='</div>';

  /* 우측 시트 영역 */
  h+='<div style="flex:1;display:flex;flex-direction:column;min-width:0">';
  if(S._peData.date&&Object.keys(S._peData.classes).length){
    _peActiveTab=_peVmResolveTab(S._peData,_peActiveTab);
    h+='<div style="display:flex;gap:0;border-bottom:1px solid var(--bdr);overflow-x:auto;flex-shrink:0;background:var(--bg2);padding:0 8px">';
    _peVmTabSummaries(S._peData,_peActiveTab).forEach(function(tab){
      h+='<div data-tab-key="'+tab.key+'" style="padding:8px 14px;font-size:11px;font-weight:'+(tab.isActive?'700':'500')+';color:'+(tab.isActive?'var(--cyan)':'var(--t3)')+';border-bottom:2px solid '+(tab.isActive?'var(--cyan)':'transparent')+';cursor:pointer;white-space:nowrap;transition:all .15s">'+tab.grade+'학년 '+tab.classNo+'반 <span style="font-size:9px;color:'+(tab.done?'#22c55e':'var(--t3)')+'">'+tab.filled+'/'+tab.total+'</span></div>';
    });
    h+='</div>';

    if(_peActiveTab&&S._peData.classes[_peActiveTab]){
      const cls=S._peData.classes[_peActiveTab];
      h+='<div style="flex:1;overflow:auto;padding:8px">';
      h+='<table style="width:100%;border-collapse:collapse;font-size:11px">';
      h+='<thead><tr style="background:var(--bg2);position:sticky;top:0;z-index:1">';
      h+='<th style="padding:6px 8px;border:1px solid var(--bdr);font-weight:700;color:var(--t1);width:30px;text-align:center">번호</th>';
      h+='<th style="padding:6px 8px;border:1px solid var(--bdr);font-weight:700;color:var(--t1);width:70px;text-align:center">이름</th>';
      h+='<th style="padding:6px 8px;border:1px solid var(--bdr);font-weight:700;color:var(--t1);width:70px;text-align:center">키(cm)</th>';
      h+='<th style="padding:6px 8px;border:1px solid var(--bdr);font-weight:700;color:var(--t1);width:70px;text-align:center">몸무게(kg)</th>';
      h+='<th colspan="2" style="padding:6px 8px;border:1px solid var(--bdr);font-weight:700;color:var(--t1);text-align:center;background:rgba(59,130,246,0.06)">나안 시력</th>';
      h+='<th colspan="2" style="padding:6px 8px;border:1px solid var(--bdr);font-weight:700;color:var(--t1);text-align:center;background:rgba(139,92,246,0.06)">교정 시력</th>';
      h+='</tr>';
      h+='<tr style="background:var(--bg2);position:sticky;top:29px;z-index:1">';
      h+='<th style="border:1px solid var(--bdr)"></th><th style="border:1px solid var(--bdr)"></th>';
      h+='<th style="border:1px solid var(--bdr)"></th><th style="border:1px solid var(--bdr)"></th>';
      h+='<th style="padding:4px;border:1px solid var(--bdr);font-size:10px;color:#3b82f6;text-align:center;font-weight:600;background:rgba(59,130,246,0.06)">좌</th>';
      h+='<th style="padding:4px;border:1px solid var(--bdr);font-size:10px;color:#3b82f6;text-align:center;font-weight:600;background:rgba(59,130,246,0.06)">우</th>';
      h+='<th style="padding:4px;border:1px solid var(--bdr);font-size:10px;color:#8b5cf6;text-align:center;font-weight:600;background:rgba(139,92,246,0.06)">좌</th>';
      h+='<th style="padding:4px;border:1px solid var(--bdr);font-size:10px;color:#8b5cf6;text-align:center;font-weight:600;background:rgba(139,92,246,0.06)">우</th>';
      h+='</tr></thead><tbody>';
      h+=_peRenderRows(_peActiveTab,cls.people);
      h+='</tbody></table>';
      h+='</div>';
    }
  } else {
    h+='<div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:var(--t3)">';
    h+='<span style="font-size:48px">📋</span>';
    h+='<div style="font-size:14px;font-weight:700;color:var(--t1)">검사 시트가 없습니다</div>';
    h+='<div style="font-size:11px">검사일을 선택하고 "검사 시트 생성" 버튼을 눌러주세요.</div>';
    h+='</div>';
  }
  h+='</div>';

  area.innerHTML=h;
  _peBindMainEvents(area);
  });
}

function _peBindMainEvents(area){
  area.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');
    if(el){
      const action=el.dataset.action;
      if(action==='open-cal')_peOpenCal();
      else if(action==='open-grade-select')_peOpenGradeSelect();
      else if(action==='export-xlsx')_peExportXlsx();
      else if(action==='open-newsletter')_peOpenNewsletter();
      return;
    }
    const tab=e.target.closest('[data-tab-key]');
    if(tab){_peActiveTab=tab.dataset.tabKey;peRenderMain();}
  });
  /* 셀 변경 이벤트 — addEventListener (innerHTML onclick 제거) */
  area.addEventListener('change',function(e){
    const inp=e.target.closest('input[data-pe-tk]');
    if(!inp)return;
    _peUpdateCell(inp.dataset.peTk, parseInt(inp.dataset.peSi,10), inp.dataset.peField, inp.value);
  });
  const calInput=area.querySelector('#peCalInput');
  if(calInput){
    calInput.addEventListener('mouseenter',function(){calInput.style.borderColor='var(--cyan)';});
    calInput.addEventListener('mouseleave',function(){calInput.style.borderColor='var(--bdr)';});
  }
}

function _peSetDate(val){
  S._peData=_peModelSetDate(S._peData,val);
  _peSave();peRenderMain();
}

let _peCalYear=new Date().getFullYear();
let _peCalMonth=new Date().getMonth();
function _peOpenCal(){
  const existing=document.getElementById('peCalFloat');
  if(existing){existing.remove();return;}
  if(S._peData&&S._peData.date){const d=new Date(S._peData.date);if(!isNaN(d)){_peCalYear=d.getFullYear();_peCalMonth=d.getMonth();}}
  const inp=document.getElementById('peCalInput');if(!inp)return;
  const rect=inp.getBoundingClientRect();
  const fl=document.createElement('div');fl.id='peCalFloat';
  fl.style.cssText='position:fixed;z-index:9500;';
  if(rect.bottom+340>window.innerHeight){fl.style.top=Math.max(4,rect.top-344)+'px';}
  else{fl.style.top=(rect.bottom+4)+'px';}
  fl.style.left=rect.left+'px';
  document.body.appendChild(fl);
  _commonCalRender(fl,_peCalYear,_peCalMonth,_peSelectDate,_peCalNav,{yearPopup:false});
  setTimeout(function(){document.addEventListener('click',_peCalOutside);},10);
}
function _peCalOutside(e){
  const fl=document.getElementById('peCalFloat');if(!fl)return;
  if(fl.contains(e.target))return;
  if(e.target.closest('#peCalInput'))return;
  fl.remove();document.removeEventListener('click',_peCalOutside);
}
function _peCalNav(delta,setMonth,setYear){
  if(setMonth!==undefined)_peCalMonth=setMonth;
  else{_peCalMonth+=delta;if(_peCalMonth<0){_peCalMonth=11;_peCalYear--;}if(_peCalMonth>11){_peCalMonth=0;_peCalYear++;}}
  const fl=document.getElementById('peCalFloat');if(!fl)return;
  _commonCalRender(fl,_peCalYear,_peCalMonth,_peSelectDate,_peCalNav,{yearPopup:false});
}
function _peSelectDate(dateStr){
  _peSetDate(dateStr);
  const fl=document.getElementById('peCalFloat');if(fl)fl.remove();
  document.removeEventListener('click',_peCalOutside);
}

/* ── 학년/반 선택 팝업 ── */
let _peSelStep='grade';
let _peSelGrades=[];
function _peOpenGradeSelect(){
  if(!S._peData.date){alert('검사일을 먼저 선택하세요.');return;}
  _peSelStep='grade';_peSelGrades=[];
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='peGradeOverlay';ov.style.background='rgba(0,0,0,0.35)';
  let html='<div class="modal-content" style="width:700px;max-width:96vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;padding:0">';
  html+='<div style="background:rgba(6,182,212,0.10);padding:14px 18px;border-bottom:1px solid var(--bdr)">';
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1)">📋 검사 시트 생성</div>';
  html+='<div style="font-size:11px;color:var(--t3);margin-top:3px">검사 대상 학년과 반을 선택하세요</div>';
  html+='</div>';
  html+='<div id="peSelBody" style="flex:1;overflow-y:auto;padding:14px 18px;scrollbar-width:thin"></div>';
  html+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--bdr);background:var(--bg2)">';
  html+='<button class="btn btn-outline btn-sm" id="peSelBackBtn" data-action="sel-back" style="display:none">← 뒤로</button>';
  html+='<button id="peSelNextBtn" data-action="sel-next" disabled style="opacity:0.5;padding:7px 22px;font-size:12px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f)">다음</button>';
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const actionEl=e.target.closest('[data-action]');
    if(actionEl){
      if(actionEl.dataset.action==='sel-back')_peSelBack();
      else if(actionEl.dataset.action==='sel-next')_peSelNext();
    }
  });
  document.body.appendChild(ov);
  _peRenderGradeStep();
}
function _peRenderGradeStep(){
  const body=document.getElementById('peSelBody');if(!body)return;
  const grades=_peSelGetGrades(S.people);
  const sl=S.settings.schoolLevel||'elementary';
  let h='<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:14px">학년을 선택하세요</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  h+='<label style="display:flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--cyan);border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;color:var(--t1);background:rgba(6,182,212,0.06);margin-right:12px"><input type="checkbox" id="peGradeAll"> 전체 선택</label>';
  grades.forEach(function(g){
    const cnt=_peSelCountByGrade(S.people,g);
    const label=(sl==='kindergarten')?g+'세':g+'학년';
    h+='<label class="pe-grade-label" style="display:flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--bdr);border-radius:8px;cursor:pointer;font-size:12px;color:var(--t2);background:var(--bg2);transition:all .15s">'
      +'<input type="checkbox" class="pe-grade-cb" value="'+g+'"> '+label+'<span style="font-size:10px;color:var(--t3)">('+cnt+'명)</span></label>';
  });
  h+='</div>';
  body.innerHTML=h;
  const btn=document.getElementById('peSelNextBtn');if(btn){btn.disabled=true;btn.style.opacity='0.5';btn.textContent='다음';}
  const back=document.getElementById('peSelBackBtn');if(back)back.style.display='none';
  const gradeAll=body.querySelector('#peGradeAll');
  if(gradeAll)gradeAll.addEventListener('change',function(){_peToggleAllGrades(gradeAll);});
  body.querySelectorAll('.pe-grade-cb').forEach(function(cb){
    cb.addEventListener('change',function(){_peUpdateGradeSel();});
  });
  body.querySelectorAll('.pe-grade-label').forEach(function(lbl){
    lbl.addEventListener('mouseenter',function(){lbl.style.borderColor='var(--cyan)';});
    lbl.addEventListener('mouseleave',function(){lbl.style.borderColor='var(--bdr)';});
  });
}
function _peToggleAllGrades(el){
  document.querySelectorAll('.pe-grade-cb').forEach(function(cb){cb.checked=el.checked;});
  const btn=document.getElementById('peSelNextBtn');
  const cnt=document.querySelectorAll('.pe-grade-cb:checked').length;
  if(btn){btn.disabled=cnt===0;btn.style.opacity=cnt?'1':'0.5';}
  if(el.checked&&cnt>0)setTimeout(function(){if(_peSelStep==='grade')_peSelNext();},300);
}
function _peUpdateGradeSel(){
  const cbs=document.querySelectorAll('.pe-grade-cb:checked');
  const total=document.querySelectorAll('.pe-grade-cb').length;
  const btn=document.getElementById('peSelNextBtn');
  if(btn){btn.disabled=cbs.length===0;btn.style.opacity=cbs.length?'1':'0.5';}
  const all=document.getElementById('peGradeAll');
  if(all)all.checked=cbs.length===total;
}
function _peSelNext(){
  if(_peSelStep==='grade'){
    _peSelGrades=_peSelCollectGrades(document.querySelectorAll('.pe-grade-cb:checked'));
    if(!_peSelGrades.length)return;
    _peSelStep='class';
    _peRenderClassStep();
  } else {
    _peGenerateFromSelection();
  }
}
function _peSelBack(){
  _peSelStep='grade';_peRenderGradeStep();
}
function _peRenderClassStep(){
  const body=document.getElementById('peSelBody');if(!body)return;
  const btn=document.getElementById('peSelNextBtn');if(btn){btn.textContent='완료';btn.disabled=false;btn.style.opacity='1';}
  const back=document.getElementById('peSelBackBtn');if(back)back.style.display='inline-flex';
  let h='<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:14px">반/학생을 선택하세요</div>';
  h+='<label style="display:flex;align-items:center;gap:6px;margin-bottom:12px;font-size:12px;font-weight:700;color:var(--t1);cursor:pointer"><input type="checkbox" id="peClsAllAll" checked> 전체 선택/해제</label>';
  const sl=S.settings.schoolLevel||'elementary';
  const groups=_peSelBuildGroups(S.people,_peSelGrades,sl);
  groups.forEach(function(group){
    h+='<div style="margin-bottom:10px;border:1px solid var(--bdr);border-radius:8px;padding:8px 12px">';
    h+='<label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--t1);margin-bottom:6px;cursor:pointer"><input type="checkbox" class="pe-cls-all" data-key="'+group.key+'" checked> '+group.gradeLabel+' '+group.classNo+'반 <span style="font-size:10px;color:var(--t3)">('+group.people.length+'명)</span></label>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    group.people.forEach(function(s){
      h+='<div class="sv-student-chip checked" data-sid="'+s.id+'" data-cls="'+group.key+'" style="padding:4px 8px;border-radius:5px;font-size:10px;cursor:pointer">'+(s.num||'')+'번 '+escHtml(s.name)+'</div>';
    });
    h+='</div></div>';
  });
  body.innerHTML=h;
  const allAll=body.querySelector('#peClsAllAll');
  if(allAll)allAll.addEventListener('change',function(){_peToggleAllCls(allAll);});
  body.querySelectorAll('.pe-cls-all').forEach(function(cb){
    cb.addEventListener('change',function(){_peToggleCls(cb.dataset.key,cb);});
  });
  body.addEventListener('click',function(e){
    const chip=e.target.closest('.sv-student-chip');
    if(chip)_peToggleStu(chip.dataset.sid,chip);
  });
}
function _peToggleAllCls(el){
  document.querySelectorAll('.pe-cls-all').forEach(function(cb){cb.checked=el.checked;});
  const chips=document.querySelectorAll('#peSelBody .sv-student-chip');
  chips.forEach(function(ch){if(el.checked)ch.classList.add('checked');else ch.classList.remove('checked');});
}
function _peToggleCls(key,el){
  const chips=document.querySelectorAll('#peSelBody .sv-student-chip[data-cls="'+key+'"]');
  chips.forEach(function(ch){if(el.checked)ch.classList.add('checked');else ch.classList.remove('checked');});
}
function _peToggleStu(id,chip){
  chip.classList.toggle('checked');
  const key=chip.dataset.cls;
  const all=document.querySelectorAll('#peSelBody .sv-student-chip[data-cls="'+key+'"]');
  const checked=document.querySelectorAll('#peSelBody .sv-student-chip[data-cls="'+key+'"].checked');
  const cb=document.querySelector('.pe-cls-all[data-key="'+key+'"]');
  if(cb)cb.checked=all.length===checked.length;
}
function _peGenerateFromSelection(){
  const ov=document.getElementById('peGradeOverlay');
  const selectedIds=new Set();
  document.querySelectorAll('#peSelBody .sv-student-chip.checked').forEach(function(ch){selectedIds.add(String(ch.dataset.sid));});
  if(!selectedIds.size){alert('학생을 선택해 주세요.');return;}
  if(Object.keys(S._peData.classes).length&&!confirm('기존 시트를 새로 생성하면 입력된 데이터가 초기화됩니다.\n계속하시겠습니까?'))return;
  S._peData=_peModelGenerate(S._peData,S.people,selectedIds);
  _peSave();_peActiveTab=null;
  if(ov)closeModalGracefully(ov);
  peRenderMain();
  bus.emit('toast:show', {text: '검사 시트 생성 완료 ('+Object.keys(S._peData.classes).length+'개 학급, '+selectedIds.size+'명)'});
}

function _peOpenNewsletter(){
  if(!S._peData||!Object.keys(S._peData.classes).length){alert('검사 시트 데이터가 없습니다.');return;}
  const mergeRows=_peExportMergeRows(S._peData);
  if(!mergeRows.length){alert('학생 데이터가 없습니다.');return;}
  setNlMerge({data:mergeRows,fields:Object.keys(mergeRows[0]),idx:0,preview:false});
  svOpenNewsletterModal('체격 검사 결과');
  setTimeout(function(){
    nlMergeUpdateUI();
    nlMergeUpdateNav();
  },300);
}

function _peUpdateCell(tk,si,field,val){
  if(!_peModelUpdateCell(S._peData,tk,si,field,val))return;
  _peSave();
}


function _peExportXlsx(){
  if(!S._peData||!Object.keys(S._peData.classes).length){alert('시트 데이터가 없습니다.');return;}
  if(typeof XLSX==='undefined'){alert('SheetJS(xlsx.js)가 로드되지 않았습니다.');return;}
  const wb=XLSX.utils.book_new();
  const sheets=_peExportWorkbook(S._peData);
  sheets.forEach(function(sheet){
    const rows=sheet.rows;
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:6},{wch:10},{wch:8},{wch:10},{wch:12},{wch:12},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb,ws,sheet.sheetName);
  });
  const fileName='체격검사_'+(S.settings.schoolName||'학교')+'_'+(S._peData.date||'')+'.xlsx';
  XLSX.writeFile(wb,fileName);
  bus.emit('toast:show', {text: '나이스 양식 엑셀 다운로드 완료'});
}

/* 전역 노출 — event-bindings에서 참조 */

export { peRenderMain };
