/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { getStu, escHtml, isBirthdayToday, fireConfetti, saveData, saveRecordNow, closeModalGracefully, getStuAutoLine, hasMultipleSchoolLevels } from '../../core/helpers.js';
import { renderDaily, renderCalendar, renderSidebarRecent, _normName, _isChosungQuery, _getChosung } from './daily-view.js';
import { openSymptomCategoryPopup } from '../symptom/symptom-view.js';
import { bus } from '../../core/event-bus.js';
import { S, addRecord } from '../../core/app-state.js';
import { playCautionSound } from '../../core/ui-utils.js';

/* 학년도는 3월 1일 시작(달력 연도 아님). 요보호 플래그 연도도 학년도 기준. (사용자 지시 2026-06-19) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

/* ═══════════════════════════════════════
   DAILY AUTOCOMPLETE (Req 26)
   ═══════════════════════════════════════ */

/* ── 한글 초성 검색 유틸리티 ── */
const CHO=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const HANGUL_BASE=0xAC00, CHO_COUNT=588; /* 21*28 = 588 */
function isChosung(ch){ return CHO.indexOf(ch)>=0; }
function getChosung(ch){
  const code=ch.charCodeAt(0);
  if(code>=HANGUL_BASE&&code<=0xD7A3) return CHO[Math.floor((code-HANGUL_BASE)/CHO_COUNT)];
  return null;
}
/**
 * 한글 초성 포함 검색 (이름 처음부터 순서대로 매치). 예:
 *  matchKorean('김재웅','ㄱ') → true (초성 매치)
 *  matchKorean('김재웅','김') → true (일반 매치)
 *  matchKorean('김재웅','김ㅈ') → true (김+ㅈ 초성 매치)
 *  matchKorean('김재웅','김재') → true (일반 매치)
 *  matchKorean('김재웅','ㄱㅈ') → true (초성 연속 매치)
 */
export function matchKorean(name,query){
  if(!name||!query) return false;
  /* 일반 포함 검색 (대소문자 무시) */
  if(name.toLowerCase().indexOf(query.toLowerCase())>=0) return true;
  /* 초성 검색: 이름의 어디서든 시작할 수 있음 */
  for(let start=0;start<name.length;start++){
    if(_matchKoreanSeq(name,query,start)) return true;
  }
  return false;
}
function _matchKoreanSeq(name,query,startIdx){
  let ni=startIdx;
  for(let qi=0;qi<query.length;qi++){
    if(ni>=name.length) return false;
    const qch=query[qi];
    const nch=name[ni];
    if(isChosung(qch)){
      /* 쿼리 문자가 초성이면, 이름 문자의 초성과 비교 */
      if(getChosung(nch)===qch){ ni++; continue; }
      return false;
    } else {
      const qCode=qch.charCodeAt(0);
      if(qCode>=HANGUL_BASE&&qCode<=0xD7A3){
        /* 완성 한글: 정확히 일치 */
        if(nch===qch){ ni++; continue; }
        return false;
      } else {
        /* 영문/숫자: 대소문자 무시 일치 */
        if(nch.toLowerCase()===qch.toLowerCase()){ ni++; continue; }
        return false;
      }
    }
  }
  return true;
}
/** 이름의 첫 글자부터 매칭하는지 (검색 결과 상단 우선 배치용) */
export function matchKoreanFromStart(name,query){
  if(!name||!query) return false;
  if(name.toLowerCase().indexOf(query.toLowerCase())===0) return true;
  return _matchKoreanSeq(name,query,0);
}

export function dailyAutoComplete(){
  const input=document.getElementById('dailySearchInput');
  const qRaw=input.value;
  const q=_normName(qRaw);
  const list=document.getElementById('dailyACList');
  S.acHighlight=-1;
  if(!q){list.classList.remove('show');return;}
  /* 사이드바 검색과 동일한 로직: NFC+Jamo 정규화 + 초성 매칭 + 부가정보 검색 */
  const isChosung=_isChosungQuery(q);
  const _filterPerson=function(s){
    if(!s.name)return false;
    const n=_normName(s.name);
    if(n.indexOf(q)>=0)return true;
    if(isChosung&&_getChosung(n).indexOf(q)>=0)return true;
    /* 부가 정보(학년·반·번호·직위) 포함 검색 */
    const isStf=s.type==='staff';
    const extra=_normName(isStf?(s.position||'교직원'):(s.grade+'학년'+s.cls+'반'+s.num+'번'));
    return extra.indexOf(q)>=0;
  };
  const matched=S.people.filter(_filterPerson);
  /* 이름 시작 일치 우선, 그 다음 방문 빈도, 마지막 이름 가나다순 */
  /* 방문수 사전 계산 (2026-07-01 성능) — 정렬 비교자 안에서 매 비교마다 S.records 전체를 훑던 것을
   *  1회 순회 맵으로 대체. O(N log N × M) → O(M + N log N). 결과·정렬순서 불변(값 동일). */
  const _visitCountMap={};
  (S.records||[]).forEach(function(r){ if(r&&r.studentId!=null) _visitCountMap[r.studentId]=(_visitCountMap[r.studentId]||0)+1; });
  const _visitCount=function(sid){return _visitCountMap[sid]||0;};
  matched.sort(function(a,b){
    const na=_normName(a.name), nb=_normName(b.name);
    const aStart=na.indexOf(q)===0?0:1;
    const bStart=nb.indexOf(q)===0?0:1;
    if(aStart!==bStart)return aStart-bStart;
    const vc=_visitCount(b.id)-_visitCount(a.id);
    if(vc!==0)return vc;
    return (a.name||'').localeCompare(b.name||'','ko');
  });
  /* 상위 20명까지만 렌더 — 렌더 부담 감소(2026-07-01). 더 있으면 이름을 더 입력해 좁힌다(아래 hint 안내). */
  const limited=matched.slice(0,20);
  console.log('[일반일지 검색] q="'+qRaw+'" | 총 '+matched.length+'명 매칭 (상위 '+limited.length+'명 표시)');
  if(!limited.length){
    list.innerHTML='<div style="padding:14px 16px;text-align:center;color:var(--t3);font-size:11px;line-height:1.6"><div style="font-size:18px;margin-bottom:4px;opacity:0.5">🔍</div>"<b style="color:var(--t2)">'+escHtml(qRaw)+'</b>"에 일치하는 사람이 없습니다<br><span style="font-size:9px;color:var(--t3)">학년반·번호·이름 일부·초성 모두 검색 지원</span>'
      +'<div style="margin-top:11px"><button class="ac-quick-reg" data-q="'+escHtml(qRaw)+'" style="padding:6px 13px;font-size:11px;font-weight:700;border-radius:7px;cursor:pointer;border:1px dashed #16a34a;background:transparent;color:#16a34a;font-family:var(--f);transition:all .15s" onmouseover="this.style.background=\'rgba(22,163,74,0.08)\'" onmouseout="this.style.background=\'transparent\'">＋ 이 인원을 등록</button></div>'
      +'</div>';
    list.classList.add('show');
    const _qr=list.querySelector('.ac-quick-reg');
    if(_qr)_qr.addEventListener('click',function(){
      const _pre=(this.dataset.q||'').trim();   /* 검색했던 이름 → 등록 폼 이름란에 미리 채움 */
      import('../person-manager/person-manager-view.js').then(function(m){ if(m.openPersonTypeChooser)m.openPersonTypeChooser(_pre); }).catch(function(e){console.error('[quick-register import]',e);});
    });
    return;
  }
  /* 전체 매칭 개수 > 표시 개수면 상단에 힌트 표시 */
  const hint=matched.length>limited.length?'<div style="padding:4px 10px;font-size:10px;color:var(--t3);background:var(--bg2);border-bottom:1px solid var(--bdrl)">총 '+matched.length+'명 중 상위 '+limited.length+'명 · 이름을 더 입력하면 좁혀집니다</div>':'';
  const _multiLv=hasMultipleSchoolLevels();
  list.innerHTML=hint+limited.map(function(s,i){
    const isCare=s.status==='caution'||s.status==='watch';
    const isStf=s.type==='staff';
    const info=isStf
      ? '['+(s.position||'교직원')+(isCare?' *요보호*':'')+']'
      : '['+getStuAutoLine(s,{multiLevel:_multiLv})+(isCare?' *요보호*':'')+']';
    return '<div class="ac-item" data-idx="'+i+'" data-stu-id="'+s.id+'"><span class="ac-name">'+escHtml(s.name)+'</span><span class="ac-info">'+escHtml(info)+'</span></div>';
  }).join('');
  list.querySelectorAll('.ac-item').forEach(function(el){
    el.addEventListener('click',function(){selectStudent(this.dataset.stuId);});
    el.addEventListener('mouseenter',function(){S.acHighlight=parseInt(this.dataset.idx);highlightAC();});
  });
  list.classList.add('show');
}

function highlightAC(){
  document.querySelectorAll('#dailyACList .ac-item').forEach((el,i)=>el.classList.toggle('highlighted',i===S.acHighlight));
}

export function dailySearchKeydown(e){
  const items=document.querySelectorAll('#dailyACList .ac-item');
  if(e.key==='ArrowDown'){e.preventDefault();S.acHighlight=Math.min(S.acHighlight+1,items.length-1);highlightAC();}
  else if(e.key==='ArrowUp'){e.preventDefault();S.acHighlight=Math.max(S.acHighlight-1,0);highlightAC();}
  else if(e.key==='Enter'){e.preventDefault();if(S.acHighlight>=0&&items[S.acHighlight])items[S.acHighlight].click();else if(items.length)items[0].click();}
  else if(e.key==='Escape'){document.getElementById('dailyACList').classList.remove('show');const _ei=document.getElementById('dailySearchInput');_ei.value='';_ei.blur();}
}

let apCareStudentId=null;
export function resetAddPersonModal(){
  apCareStudentId=null;
}
/* ═══ MacOS 스타일 상세 검색 UI (Phase 3C/D/E) ═══
   세그먼트 컨트롤(학교급·학과) + 학년 필 + 반별 번호 그리드.
   학교급/학과가 하나뿐이면 자동 비활성(dimmed).
   학생 번호 클릭 시 careSearchPickStudent(id) 호출 — 기존 데이터 흐름 그대로. */
let _careSearchSelectedId=null;
let _careSearchState = {
  schoolLevel: null,   /* 'elementary' | 'middle' | 'high' | 'kindergarten' | 'all' */
  department: null,    /* 학과명 | 'all' */
  grade: null,         /* 숫자 */
  query: ''            /* 검색어 */
};

/* 등록된 학교급 목록 (학생만, 중복 제거) */
function _careGetSchoolLevels(){
  const set=new Set();
  S.people.forEach(function(s){ if(s.type==='student' && s.level) set.add(s.level); });
  return Array.from(set);
}
/* 등록된 학과 목록 */
function _careGetDepartments(levelFilter){
  const set=new Set();
  S.people.forEach(function(s){
    if(s.type!=='student') return;
    if(levelFilter && levelFilter!=='all' && s.level && s.level!==levelFilter) return;
    if(s.department) set.add(s.department);
  });
  return Array.from(set);
}
/* 필터 조건에 맞는 학생 목록 */
function _careFilterStudents(){
  return S.people.filter(function(s){
    if(s.type!=='student') return false;
    if(_careSearchState.schoolLevel && _careSearchState.schoolLevel!=='all'){
      if(s.level !== _careSearchState.schoolLevel) return false;
    }
    if(_careSearchState.department && _careSearchState.department!=='all'){
      if(_careSearchState.department==='__unassigned__'){
        /* 학과 미지정만 보기 */
        if(s.department) return false;
      } else if(s.department !== _careSearchState.department){
        return false;
      }
    }
    if(_careSearchState.grade && s.grade !== _careSearchState.grade) return false;
    if(_careSearchState.query){
      const q=_careSearchState.query.trim().toLowerCase();
      if(q){
        const nm=(s.name||'').toLowerCase();
        const full=(s.grade||'')+''+(s.cls||'')+''+(s.num||'')+nm;
        if(nm.indexOf(q)===-1 && full.indexOf(q)===-1) return false;
      }
    }
    return true;
  });
}
function _careGetGrades(){
  const filtered=_careFilterStudents();
  const set=new Set();
  /* 주의: grade 필터를 풀고 level/dept 기준 grade 만 모아야 함 */
  const prevGrade=_careSearchState.grade; _careSearchState.grade=null;
  const byLv=_careFilterStudents();
  _careSearchState.grade=prevGrade;
  byLv.forEach(function(s){ if(s.grade>0) set.add(s.grade); });
  return Array.from(set).sort(function(a,b){return a-b;});
}

function _careEmoji(lv){
  if(lv==='kindergarten') return '🌸';
  if(lv==='elementary') return '🌱';
  if(lv==='middle') return '📘';
  if(lv==='high') return '🎓';
  return '🏫';
}
function _careLvLabel(lv){
  if(lv==='kindergarten') return '유';
  if(lv==='elementary') return '초';
  if(lv==='middle') return '중';
  if(lv==='high') return '고';
  return lv||'';
}

/* ─── 상세 검색 hover 미니 팝업 ───
   학생/교직원 카드에 마우스 올리면 풀네임·성별·생년월일·범례·과거 방문 횟수 표시.
   카드 아래/위에 위치 자동 계산. */
let _careHoverPopEl=null;
function _careShowHoverPop(anchor, s){
  _careHideHoverPop();
  if(!s) return;
  const pastVisits = (S.records||[]).filter(function(r){return r.studentId===s.id;}).length;
  /* 현재 상태 범례 (status 종합) */
  const flags=[];
  if(s.status==='caution') flags.push({color:'#f97316', label:'요보호'});
  if(s.status==='watch')   flags.push({color:'#eab308', label:'미세먼지 기저질환'});
  if(s.emergencyConsent==='N') flags.push({color:'#dc2626', label:'응급처치 비동의'});
  if(s.medConsent==='N')       flags.push({color:'#a855f7', label:'일반의약품 비동의'});

  const birth = s.birth || s.birth_date || s.birthDate || '';
  let birthFmt = birth;
  try{
    if(birth){ const d=new Date(birth); if(!isNaN(d.getTime())) birthFmt=d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일'; }
  }catch(e){}

  const pop=document.createElement('div');
  pop.className='care-hover-pop';
  pop.style.cssText='position:fixed;z-index:14000;background:var(--card);border:1px solid var(--bdr);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);padding:10px 12px;font-family:var(--f);pointer-events:none;min-width:200px;max-width:260px;font-size:11px;color:var(--t1);line-height:1.7';
  let h='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px;display:flex;align-items:center;gap:6px">'
    +'<span>'+escHtml(s.name||'')+'</span>';
  if(s.type==='student' && s.grade){
    /* getStuAutoLine: 학과·다중학교급·특수학교 prefix 자동 처리 */
    h+='<span style="font-size:10px;color:var(--t3);font-weight:600">'+escHtml(getStuAutoLine(s))+'</span>';
  } else if(s.type==='staff' && s.position){
    h+='<span style="font-size:10px;color:var(--t3);font-weight:600">'+escHtml(s.position)+'</span>';
  }
  h+='</div>';
  if(s.gender) h+='<div style="color:var(--t2)">성별: <b style="color:var(--t1)">'+escHtml(s.gender)+'</b></div>';
  if(birthFmt) h+='<div style="color:var(--t2)">생년월일: <b style="color:var(--t1)">'+escHtml(birthFmt)+'</b></div>';
  h+='<div style="color:var(--t2)">과거 방문: <b style="color:var(--cyan)">'+pastVisits+'</b>건</div>';
  if(flags.length){
    h+='<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--bdrl);display:flex;flex-wrap:wrap;gap:4px">';
    flags.forEach(function(f){
      h+='<span style="display:inline-flex;align-items:center;gap:3px;font-size:9.5px;color:'+f.color+';background:rgba(255,255,255,0.05);border:1px solid '+f.color+'44;border-radius:10px;padding:2px 7px;font-weight:700"><span style="width:6px;height:6px;border-radius:50%;background:'+f.color+';box-shadow:0 0 4px '+f.color+'"></span>'+f.label+'</span>';
    });
    h+='</div>';
  }
  pop.innerHTML=h;
  document.body.appendChild(pop);
  _careHoverPopEl=pop;
  /* 위치 계산 */
  const r=anchor.getBoundingClientRect();
  const pw=pop.offsetWidth||220, ph=pop.offsetHeight||80;
  const vw=window.innerWidth, vh=window.innerHeight;
  let left=r.left + r.width/2 - pw/2;
  if(left<8) left=8;
  if(left+pw>vw-8) left=vw-pw-8;
  let top=r.bottom+6;
  if(top+ph>vh-8) top=r.top-ph-6;
  if(top<8) top=8;
  pop.style.left=left+'px';
  pop.style.top=top+'px';
}
function _careHideHoverPop(){
  if(_careHoverPopEl){ _careHoverPopEl.remove(); _careHoverPopEl=null; }
}

/* ─── 상태 도트 4종: 요보호·미세먼지·응급처치비동의·일반의약품비동의 ───
   카드 우상단에 세로 스트립으로 최대 4개 도트 표시.
   도트 색/의미:
     🟠 #f97316 요보호
     🟡 #eab308 미세먼지 기저질환
     🔴 #dc2626 응급처치 비동의 (emergencyConsent==='N')
     🟣 #a855f7 일반의약품 비동의 (medConsent==='N')  */
function _careDotStrip(s){
  const flags=[];
  if(s.status==='caution') flags.push({color:'#f97316', title:'요보호'});
  if(s.status==='watch')   flags.push({color:'#eab308', title:'미세먼지 기저질환'});
  if(s.emergencyConsent==='N') flags.push({color:'#dc2626', title:'응급처치 비동의'});
  if(s.medConsent==='N')       flags.push({color:'#a855f7', title:'일반의약품 비동의'});
  if(!flags.length) return '';
  let h='<span style="position:absolute;top:3px;right:3px;display:flex;flex-direction:column;gap:2px">';
  flags.forEach(function(f){
    h+='<span title="'+f.title+'" style="width:6px;height:6px;border-radius:50%;background:'+f.color+';box-shadow:0 0 4px '+f.color+'"></span>';
  });
  h+='</span>';
  return h;
}
function _careTipTail(s){
  const parts=[];
  if(s.status==='caution') parts.push('요보호');
  if(s.status==='watch')   parts.push('미세먼지');
  if(s.emergencyConsent==='N') parts.push('응급처치 비동의');
  if(s.medConsent==='N')       parts.push('일반의약품 비동의');
  return parts.length ? ' · '+parts.join(', ') : '';
}

function openCareStudentSearch(){
  const _apm=document.getElementById('addPersonModal');if(_apm)_closeApModal(_apm);
  _careSearchSelectedId=null;
  /* 초기 state 결정 — 학교급이 하나뿐이면 자동 선택 */
  const levels=_careGetSchoolLevels();
  _careSearchState = {
    schoolLevel: levels.length===1 ? levels[0] : 'all',
    department: 'all',
    grade: null,
    query: ''
  };
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='careSearchOverlay';
  ov.style.background='rgba(0,0,0,0.25)';
  /* 인원데이터 관리·요보호 등록 등 부모 모달(z 9000~10100) 위에 떠야 함 */
  ov.style.zIndex='11000';
  ov.innerHTML='<div class="modal-content sh-modal" style="width:840px;max-width:96vw;padding:0;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(255,255,255,0.08)">'
    +'<div class="sh-head" style="padding:14px 16px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--bdrl)">'
      +'<span class="sh-title" style="font-size:13px;font-weight:700;color:var(--t1);flex:1">🛡 요보호 대상 학생 등록/변경</span>'
      +'<button class="sh-close" data-care-close style="width:28px;height:28px;border-radius:50%;border:none;background:var(--bg2);color:var(--t2);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s">✕</button>'
    +'</div>'
    +'<div id="careSegmentsWrap" style="padding:10px 16px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--bdrl)"></div>'
    +'<div id="careGradeWrap" style="padding:10px 16px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--bdrl);min-height:40px;align-items:center"><span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학년</span><div id="careGradeChips" style="display:flex;gap:6px;flex-wrap:wrap;flex:1"></div></div>'
    +'<div id="careBodyWrap" style="flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:12px"></div>'
    +'<div style="padding:8px 16px;border-top:1px solid var(--bdrl);display:flex;gap:14px;font-size:9.5px;color:var(--t3);flex-wrap:wrap">'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f97316;box-shadow:0 0 4px #f97316;margin-right:4px"></span>요보호</span>'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#eab308;box-shadow:0 0 4px #eab308;margin-right:4px"></span>미세먼지 기저질환</span>'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;box-shadow:0 0 4px #dc2626;margin-right:4px"></span>응급처치 비동의</span>'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a855f7;box-shadow:0 0 4px #a855f7;margin-right:4px"></span>일반의약품 비동의</span>'
      +'<span style="opacity:0.6">· 전학/자퇴 — 회색 취소선</span>'
    +'</div>'
    +'</div>';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);

  /* 이벤트 바인딩 — 검색창은 제거됨 (외부 사이드바 검색창 사용) */
  const closeBtn=ov.querySelector('[data-care-close]');
  if(closeBtn) closeBtn.addEventListener('click',function(){closeModalGracefully(ov);});

  _careRenderAll();
}

/* ─── 전체 렌더 ─── */
function _careRenderAll(){
  _careRenderSegments();
  _careRenderGrades();
  _careRenderBody();
}

/* ─── 세그먼트 컨트롤 (학교급 + 학과) ─── */
function _careRenderSegments(){
  const wrap=document.getElementById('careSegmentsWrap');
  if(!wrap) return;
  const levels=_careGetSchoolLevels();
  const singleLevel = levels.length<=1;
  /* 학교급 */
  let h='<div style="display:flex;align-items:center;gap:10px">'
    +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학교급</span>'
    +'<div class="sh-seg'+(singleLevel?' sh-seg-disabled':'')+'" style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px'+(singleLevel?';opacity:0.5;pointer-events:none':'')+'">';
  /* 전체 버튼 */
  const allActive=_careSearchState.schoolLevel==='all';
  h+='<button class="sh-seg-btn'+(allActive?' active':'')+'" data-care-seg="level" data-care-seg-val="all" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(allActive?'var(--card)':'transparent')+';color:'+(allActive?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer;font-family:var(--f);box-shadow:'+(allActive?'0 1px 3px rgba(0,0,0,0.08)':'none')+'"'+(singleLevel?' disabled':'')+'>전체</button>';
  /* 개별 학교급 버튼 */
  levels.forEach(function(lv){
    const act=_careSearchState.schoolLevel===lv;
    h+='<button class="sh-seg-btn'+(act?' active':'')+'" data-care-seg="level" data-care-seg-val="'+escHtml(lv)+'" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(act?'var(--card)':'transparent')+';color:'+(act?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer;font-family:var(--f);box-shadow:'+(act?'0 1px 3px rgba(0,0,0,0.08)':'none')+'"'+(singleLevel?' disabled':'')+'>'+_careLvLabel(lv)+'</button>';
  });
  h+='</div>';
  if(singleLevel) h+='<span style="font-size:9.5px;color:var(--t3);font-style:italic">· 등록된 학교급이 하나뿐이라 자동 선택됨</span>';
  h+='</div>';

  /* 학과 — 현재 선택된 학교급 내에서. 특정 학과 선택 시 cyan 강조(학년 칩과 동일 톤). */
  const deps=_careGetDepartments(_careSearchState.schoolLevel);
  if(deps.length>=2){
    h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
      +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학과</span>'
      +'<div class="sh-seg" style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px;flex-wrap:wrap">';
    const allDep=_careSearchState.department==='all';
    /* "전체" 는 기본 칩 (선택 강조 약함) */
    h+='<button class="sh-seg-btn'+(allDep?' active':'')+'" data-care-seg="dept" data-care-seg-val="all" style="padding:5px 14px;font-size:11px;font-weight:600;border:none;background:'+(allDep?'var(--card)':'transparent')+';color:'+(allDep?'var(--t1)':'var(--t2)')+';border-radius:6px;cursor:pointer;font-family:var(--f)">전체</button>';
    deps.forEach(function(dp){
      const act=_careSearchState.department===dp;
      /* 특정 학과 선택 시 학년 칩처럼 cyan 채움 + glow */
      const bg = act?'var(--cyan)':'transparent';
      const fg = act?'#fff':'var(--t2)';
      const shadow = act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'';
      h+='<button class="sh-seg-btn'+(act?' active':'')+'" data-care-seg="dept" data-care-seg-val="'+escHtml(dp)+'" style="padding:5px 14px;font-size:11px;font-weight:700;border:none;background:'+bg+';color:'+fg+';border-radius:6px;cursor:pointer;font-family:var(--f)'+shadow+'">'+escHtml(dp)+'</button>';
    });
    /* "학과 미지정" — 전공과/일부 학생만 학과 비어있을 때 필터 */
    const lvFilter=_careSearchState.schoolLevel;
    const hasUnassigned=S.people.some(function(s){
      if(s.type!=='student')return false;
      if(lvFilter&&lvFilter!=='all'&&s.level!==lvFilter)return false;
      return !s.department;
    });
    if(hasUnassigned){
      const act=_careSearchState.department==='__unassigned__';
      const bg = act?'var(--cyan)':'transparent';
      const fg = act?'#fff':'var(--t2)';
      const shadow = act?';box-shadow:0 0 12px rgba(6,182,212,0.35)':'';
      h+='<button class="sh-seg-btn'+(act?' active':'')+'" data-care-seg="dept" data-care-seg-val="__unassigned__" style="padding:5px 14px;font-size:11px;font-weight:700;border:none;background:'+bg+';color:'+fg+';border-radius:6px;cursor:pointer;font-family:var(--f)'+shadow+'" title="학과 비어있는 학생만">학과 미지정</button>';
    }
    h+='</div></div>';
  }
  wrap.innerHTML=h;

  /* 바인딩 */
  wrap.querySelectorAll('[data-care-seg]').forEach(function(btn){
    btn.addEventListener('click',function(){
      const kind=this.dataset.careSeg;
      const val=this.dataset.careSegVal;
      if(kind==='level'){ _careSearchState.schoolLevel=val; _careSearchState.department='all'; _careSearchState.grade=null; }
      else if(kind==='dept'){ _careSearchState.department=val; _careSearchState.grade=null; }
      _careRenderAll();
    });
  });
}

/* ─── 학년 필 ─── */
function _careRenderGrades(){
  /* 라벨 + 칩 컨테이너 분리 — careGradeChips 에 칩만 렌더 */
  const wrap=document.getElementById('careGradeChips') || document.getElementById('careGradeWrap');
  if(!wrap) return;
  const grades=_careGetGrades();
  if(!grades.length){ wrap.innerHTML='<span style="font-size:11px;color:var(--t3)">선택된 조건에 해당하는 학년이 없습니다.</span>'; return; }
  let h='';
  grades.forEach(function(g){
    const act=_careSearchState.grade===g;
    h+='<button class="sh-grade'+(act?' active':'')+'" data-care-grade="'+g+'" style="padding:6px 14px;border-radius:8px;border:1.5px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--bg2)')+';color:'+(act?'#fff':'var(--t2)')+';font-size:11px;font-weight:700;cursor:pointer;transition:all .14s;font-family:var(--f);min-width:62px;text-align:center'+(act?';box-shadow:0 0 16px rgba(6,182,212,0.25)':'')+'">'+g+'학년</button>';
  });
  wrap.innerHTML=h;
  wrap.querySelectorAll('[data-care-grade]').forEach(function(btn){
    btn.addEventListener('click',function(){ _careSearchState.grade=parseInt(this.dataset.careGrade,10); _careRenderBody(); _careRenderGrades(); });
  });
}

/* ─── 반별 학생 번호/이름 그리드 (벤다이어그램 스타일) ───
   학교급이 유치원이거나 반 내 학생이 전부 num==0 이면 "이름 카드" 모드로 대체.
   (원아는 번호 체계가 없음 — 이름으로만 구분) */
function _careIsKinderClass(sts){
  if(!sts||!sts.length) return false;
  /* 모두 유치원 OR 아무도 num 없음 */
  const allKinder = sts.every(function(s){return s.level==='kindergarten';});
  const noNums   = sts.every(function(s){return !s.num || s.num==='0';});
  return allKinder || noNums;
}
function _careRenderBody(){
  const body=document.getElementById('careBodyWrap');
  if(!body) return;
  if(!_careSearchState.grade){
    body.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:12px;line-height:1.8">위에서 학년을 선택하면<br>반별 학생이 표시됩니다.</div>';
    return;
  }
  const students=_careFilterStudents();
  if(!students.length){
    body.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:12px">이 조건에 해당하는 학생이 없습니다.</div>';
    return;
  }
  /* 반별 그룹핑 */
  const byCls={};
  students.forEach(function(s){
    const c=s.cls||0;
    if(!byCls[c]) byCls[c]=[];
    byCls[c].push(s);
  });
  /* 전문계 고등학교 등에서 "전체 학과" 선택 시:
     같은 학년·반 안에 학과가 뒤섞일 수 있으므로 (학과,반) 조합으로 재그룹핑.
     → "항공전자-2학년-1반" / "항공기계-2학년-1반" 이 각각 별도 카드로 나옴. */
  const groupByDept = (_careSearchState.department==='all'||!_careSearchState.department);
  const groups = [];  /* {label, sts} */
  if(groupByDept){
    /* 학과-반 조합 키 생성 */
    const deptClsKeys = new Set();
    students.forEach(function(s){
      const dep=s.department||'__none__';
      const cls=s.cls||0;
      deptClsKeys.add(dep+'||'+cls);
    });
    const arr=[...deptClsKeys].sort(function(a,b){
      const [da,ca]=a.split('||'), [db,cb]=b.split('||');
      if(da!==db) return (da==='__none__'?'zz':da).localeCompare(db==='__none__'?'zz':db,'ko');
      return (+ca)-(+cb);
    });
    arr.forEach(function(k){
      const [dep,cls]=k.split('||');
      const sts=students.filter(function(s){
        return (s.department||'__none__')===dep && (s.cls||0)==cls;
      });
      if(!sts.length)return;
      groups.push({ dept:(dep==='__none__'?'':dep), cls:cls, sts:sts });
    });
  } else {
    clsKeys.forEach(function(c){ groups.push({ dept:'', cls:c, sts:byCls[c] }); });
  }
  let h='';
  groups.forEach(function(g){
    const c = g.cls;
    /* 번호 있는 경우 번호순, 없는 경우 가나다순 */
    const kinderMode = _careIsKinderClass(g.sts);
    const sts = kinderMode
      ? g.sts.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'','ko');})
      : g.sts.slice().sort(function(a,b){return (a.num||0)-(b.num||0);});
    const emoji=_careEmoji(sts[0]&&sts[0].level);
    /* 반 제목 — 유치원은 반 이름(c) 그대로, 일반 학급은 'N반' */
    const clsLabel = kinderMode
      ? (isNaN(+c) ? c : c+'반')
      : c+'반';
    /* 상위 카테고리 순서: 학교급 → 학과 → 학년 → 반.
       예: "대-바리스타-1학년-1반", "고-항공전자-2학년-1반", "초-3학년-1반". */
    const lvLabel = _careLvLabel(sts[0] && sts[0].level || '');
    let deptPart = '';
    if(g.dept) deptPart = g.dept + '-';
    else if(sts[0] && sts[0].level==='college') deptPart = '학과 미지정-';
    const titleText = (lvLabel ? lvLabel + '-' : '') + deptPart + _careSearchState.grade + '학년-' + clsLabel;
    h+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:14px;padding:14px 16px;transition:all .15s">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
        +'<div style="font-size:13px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px">'
          +'<span style="font-size:16px">'+emoji+'</span>'+escHtml(titleText)
        +'</div>'
        +'<span style="font-size:10px;color:var(--t3);font-weight:600;padding:2px 8px;border-radius:10px;background:var(--card);border:1px solid var(--bdrl)">'+sts.length+'명</span>'
      +'</div>';
    if(kinderMode){
      /* 유치원 — 이름 카드 (번호 없음) */
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px">';
      sts.forEach(function(s){
        const isAbsent=s.status==='transferred'||s.status==='dropout';
        const dots=_careDotStrip(s);
        h+='<button data-care-pick="'+s.id+'" title="'+escHtml(s.name||'')+_careTipTail(s)+'" style="padding:8px 10px;position:relative;display:flex;align-items:center;justify-content:center;border-radius:10px;background:var(--card);border:1.5px solid var(--bdr);font-size:12px;font-weight:700;color:var(--t1);cursor:pointer;transition:all .14s;font-family:var(--f);text-align:center'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'+escHtml(s.name||'-')+dots+'</button>';
      });
    } else {
      /* 일반 학교 — 번호 정사각형 그리드 */
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:6px">';
      sts.forEach(function(s){
        const isAbsent=s.status==='transferred'||s.status==='dropout';
        const dots=_careDotStrip(s);
        h+='<button data-care-pick="'+s.id+'" title="'+escHtml(s.name||'')+_careTipTail(s)+'" style="aspect-ratio:1;position:relative;display:flex;align-items:center;justify-content:center;border-radius:10px;background:var(--card);border:1.5px solid var(--bdr);font-size:13px;font-weight:700;color:var(--t1);cursor:pointer;transition:all .14s;font-family:var(--f)'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'+(s.num||'-')+dots+'</button>';
      });
    }
    h+='</div></div>';
  });
  body.innerHTML=h;
  body.querySelectorAll('[data-care-pick]').forEach(function(el){
    el.addEventListener('click',function(){ _careHideHoverPop(); careSearchPickStudent(this.dataset.carePick); });
    el.addEventListener('mouseenter',function(){
      this.style.borderColor='var(--cyan)';
      this.style.transform='translateY(-1px)';
      this.style.boxShadow='0 4px 12px rgba(6,182,212,0.18)';
      this.style.background='rgba(6,182,212,0.08)';
      /* 미니 팝업: 풀네임·성별·생년월일·범례·과거 방문 횟수 */
      const sid=this.dataset.carePick;
      const stu=(S.people||[]).find(function(p){return String(p.id)===String(sid);});
      if(stu) _careShowHoverPop(this, stu);
    });
    el.addEventListener('mouseleave',function(){
      this.style.borderColor='var(--bdr)';
      this.style.transform='';
      this.style.boxShadow='';
      this.style.background='var(--card)';
      _careHideHoverPop();
    });
  });
}

/* ─── 기존 호출 호환 래퍼 ─── */
function openCareForStudent(id){
  openCareStudentSearch();
  setTimeout(function(){careSearchPickStudent(id);},0);
}
function careSearchPickStudent(id){
  const s=getStu(id);
  if(!s||s.type!=='student'){alert('학생만 선택할 수 있습니다.');return;}
  _careSearchSelectedId=id;
  /* getStuAutoLine: 학과·다중학교급·특수학교 prefix 자동 처리 */
  const info=getStuAutoLine(s)+' '+s.name;
  const existReason=(s.condition&&s.condition!=='요보호')?s.condition:'';
  const existMemo=s.careMemo||'';
  const body=document.getElementById('careSearchBody');if(body)body.innerHTML='';
  const wrap=document.getElementById('careSearchGradeWrap');if(!wrap)return;
  const titleEl=document.getElementById('careSearchTitle');if(titleEl)titleEl.textContent='요보호 대상 학생 등록/변경';
  const subtitleEl=document.getElementById('careSearchSubtitle');if(subtitleEl)subtitleEl.textContent='';
  wrap.innerHTML='<div style="padding:8px 12px;border:1px solid var(--cyan);border-radius:8px;background:var(--cbg);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">'
    +'<span style="font-size:12px;font-weight:700;color:var(--cyan)">✓ '+escHtml(info)+'</span>'
    +'<span class="care-reselect-link" style="font-size:10px;color:var(--t3);cursor:pointer">← 다시 선택</span>'
    +'</div>'
    +'<div style="display:flex;gap:8px;margin-bottom:8px">'
    +'<input id="careSearchReason" class="form-input" placeholder="요보호 질환명" value="'+escHtml(existReason)+'" style="font-size:11px;flex:1">'
    +'<input id="careSearchMemo" class="form-input" placeholder="메모 / 주의사항 (선택)" value="'+escHtml(existMemo)+'" style="font-size:11px;flex:1">'
    +'</div>'
    +'<button id="careApplyBtn" class="btn btn-primary btn-sm" style="width:100%"'+(existReason?'':' disabled')+'>변경</button>'
    +(existReason?'<button id="careDeleteBtn" class="btn btn-sm" style="width:100%;margin-top:6px;background:rgba(239,68,68,0.07);color:#dc2626;border:1px solid rgba(239,68,68,0.25)">🗑 요보호 해제</button>':'');
  /* bind events */
  const _reselect=wrap.querySelector('.care-reselect-link');
  if(_reselect) _reselect.addEventListener('click',function(){openCareStudentSearch();});
  const _reasonInput=wrap.querySelector('#careSearchReason');
  const _memoInput=wrap.querySelector('#careSearchMemo');
  const _applyBtn=wrap.querySelector('#careApplyBtn');
  const _deleteBtn=wrap.querySelector('#careDeleteBtn');
  if(_reasonInput){
    _reasonInput.addEventListener('input',function(){if(_applyBtn)_applyBtn.disabled=!this.value.trim();});
    _reasonInput.addEventListener('keydown',function(e){if(e.key==='Enter'&&this.value.trim())saveCareFromPopup();});
  }
  if(_memoInput) _memoInput.addEventListener('keydown',function(e){if(e.key==='Enter'&&_reasonInput&&_reasonInput.value.trim())saveCareFromPopup();});
  if(_applyBtn) _applyBtn.addEventListener('click',function(){saveCareFromPopup();});
  if(_deleteBtn) _deleteBtn.addEventListener('click',function(){deleteCareFromPopup();});
}
function saveCareFromPopup(){
  if(!_careSearchSelectedId){alert('학생을 먼저 선택하세요.');return;}
  const stu=getStu(_careSearchSelectedId);
  if(!stu||stu.type!=='student'){alert('학생을 다시 선택하세요.');return;}
  const reason=((document.getElementById('careSearchReason')||{}).value||'').trim();
  const memo=((document.getElementById('careSearchMemo')||{}).value||'').trim();
  if(!reason){alert('요보호 질환명을 입력하세요.');return;}
  stu.status='caution';stu.condition=reason;stu.careMemo=memo;stu.careYear=_academicYear();
  if(!stu.guardianType)stu.guardianType='부';
  /* 보호자 연락처는 입력된 값이 있을 때만 저장 — 가짜 010-0000-0000 자동 채움 금지 */
  saveData();renderDaily();bus.emit('render:dashboard');
  const ov=document.getElementById('careSearchOverlay');if(ov)closeModalGracefully(ov);
  const modal=document.getElementById('addPersonModal');if(modal)closeModalGracefully(modal);
  resetAddPersonModal();
  alert('요보호 학생으로 등록되었습니다.');
}

function deleteCareFromPopup(){
  if(!_careSearchSelectedId){alert('학생을 먼저 선택하세요.');return;}
  const stu=getStu(_careSearchSelectedId);
  if(!stu||stu.type!=='student'){alert('학생을 다시 선택하세요.');return;}
  if(!confirm(stu.name+'의 요보호 등록을 해제하시겠습니까?'))return;
  stu.status='';stu.condition='';stu.careMemo='';delete stu.careYear;
  saveData();renderDaily();bus.emit('render:dashboard');
  const ov=document.getElementById('careSearchOverlay');if(ov)closeModalGracefully(ov);
  const modal=document.getElementById('addPersonModal');if(modal)closeModalGracefully(modal);
  resetAddPersonModal();
}
const _bdayFiredToday={};
/* 날짜 가드: 사이드바 달력이 오늘이 아닌 날짜에 둔 상태에서 신규 방문자 추가 시 확인 모달.
 *  예='selected'(달력 선택일에 등록) / 아니오='today'(오늘 날짜에 등록) / 취소='cancel'(ESC·바깥 클릭).
 *  사용자 결정 2026-05-28(가드 도입) → 2026-06-16(아니오=오늘 등록으로 변경, '더 이상 묻지 않음' 체크박스 제거). */
export function _todayLocalStr(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _formatKoreanDate(dateStr){
  const m=String(dateStr||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return dateStr;
  const dow=['일','월','화','수','목','금','토'][new Date(+m[1],+m[2]-1,+m[3]).getDay()];
  return (+m[1])+'년 '+(+m[2])+'월 '+(+m[3])+'일 '+dow+'요일';
}
/* 버튼 라벨용 짧은 형식 — "M월 D일" */
function _formatKoreanDateShort(dateStr){
  const m=String(dateStr||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return dateStr;
  return (+m[2])+'월 '+(+m[3])+'일';
}
export function _dailyDateGuard(){
  const today=_todayLocalStr();
  if(!S.selectedDate || S.selectedDate===today) return Promise.resolve('selected');
  return _showDateGuardModal(S.selectedDate, today);
}
function _showDateGuardModal(targetDate, todayStr){
  return new Promise(function(resolve){
    const _dateKo=_formatKoreanDate(targetDate);
    const _todayShort=_formatKoreanDateShort(todayStr);
    const _selShort=_formatKoreanDateShort(targetDate);
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:50000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
    ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:460px;max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden">'
      +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">날짜 확인</div>'
      +'<div style="padding:18px 20px;font-size:12.5px;color:var(--t1);line-height:1.7;background:var(--card)">'
        +'<div style="font-weight:700;font-size:13.5px;color:var(--cyan);margin-bottom:8px">'+escHtml(_dateKo)+'</div>'
        +'<div>날짜로 등록하시겠습니까?</div>'
      +'</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)">'
        +'<button data-act="no" style="padding:7px 13px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;outline:none;font-family:var(--f);white-space:nowrap">아니오 (오늘 '+escHtml(_todayShort)+'에 등록)</button>'
        +'<button data-act="yes" style="padding:7px 13px;font-size:11px;font-weight:700;border-radius:6px;border:1px solid rgba(6,182,212,0.35);background:rgba(6,182,212,0.12);color:var(--cyan);cursor:pointer;outline:none;font-family:var(--f);white-space:nowrap">예 (지난 '+escHtml(_selShort)+'에 등록)</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    try{ playCautionSound(); }catch(_){}   /* 비-오늘 날짜 등록 경고 팝업 효과음 (사용자 요청 2026-06-18) */
    const close=function(r){
      try{document.removeEventListener('keydown', onKey, true);}catch(_){}
      ov.remove();
      resolve(r);
    };
    ov.querySelector('[data-act="yes"]').addEventListener('click',function(){close('selected');});
    ov.querySelector('[data-act="no"]').addEventListener('click',function(){close('today');});
    ov.addEventListener('click',function(e){ if(e.target===ov) close('cancel'); });
    const onKey=function(e){
      if(e.key==='Escape'){ e.preventDefault(); close('cancel'); }
      else if(e.key==='Enter'){ e.preventDefault(); close('selected'); }
    };
    document.addEventListener('keydown', onKey, true);
  });
}
export async function selectStudent(id, _preDate){
  /* 가드: 사이드바 달력이 오늘이 아닌 날짜에서 신규 등록 시 확인.
     예='selected'(달력 선택일에 등록) / 아니오='today'(오늘 날짜에 등록) / 취소='cancel'(ESC·바깥 클릭). (사용자 요청 2026-06-16)
     _preDate: 호출측에서 이미 날짜 가드를 거쳐 등록 날짜를 정한 경우(빠른작업 방문자 검색) → 가드 생략. (2026-06-18) */
  let _regDate;
  if(_preDate){
    _regDate = _preDate;
  } else {
    const _dateChoice = await _dailyDateGuard();
    if(_dateChoice==='cancel') return;
    _regDate = (_dateChoice==='today') ? _todayLocalStr() : S.selectedDate;
  }
  const s=getStu(id);
  const _dsi=document.getElementById('dailySearchInput');
  if(_dsi){ _dsi.value=''; _dsi.blur(); }   /* 일반탭이 아닐 때(검색창 없음)도 안전 — 빠른작업 방문자 검색 경유 (2026-06-18) */
  const _acl=document.getElementById('dailyACList'); if(_acl) _acl.classList.remove('show');
  const now=new Date();
  let timeIn, timeOut;
  /* 입실 = 현재 시각 N분 전, 퇴실 = 현재 시각 M분 후. N/M 은 설정에서 커스텀 가능 (기본 4분, 0~60 범위). */
  let _minBefore=parseInt(localStorage.getItem('ec_daily_auto_time_in_before')||'4',10);
  let _minAfter=parseInt(localStorage.getItem('ec_daily_auto_time_out_after')||'4',10);
  if(isNaN(_minBefore)||_minBefore<0)_minBefore=4; else if(_minBefore>60)_minBefore=60;
  if(isNaN(_minAfter)||_minAfter<0)_minAfter=4; else if(_minAfter>60)_minAfter=60;
  const _ago=new Date(now.getTime()-_minBefore*60000);
  const _later=new Date(now.getTime()+_minAfter*60000);
  timeIn=String(_ago.getHours()).padStart(2,'0')+':'+String(_ago.getMinutes()).padStart(2,'0');
  timeOut=String(_later.getHours()).padStart(2,'0')+':'+String(_later.getMinutes()).padStart(2,'0');
  const _curUser=S._currentUser||JSON.parse(localStorage.getItem('ec_user')||'{}');
  const _pType=(s&&s.type==='staff')?'staff':'student';
  /* v9: personUid/personType. studentId は backwards-compat alias */
  const newRec={id:S.nextId++,date:_regDate,timeIn:timeIn,timeOut:timeOut,personUid:id,personType:_pType,studentId:id,symptoms:[],treatment:[],medication:'',temp:'',bp:'',result:'return',nurse:_curUser.name||S.settings.nurse1||'',nursePosition:_curUser.position||'',nurseId:_curUser.id||null,dept:'',vipTags:[],_autoCreated:true};
  S._lastRegisteredRecId=newRec.id;
  S.dailySortOrder='desc';
  S._dailySortCol='timeIn';
  S._dailySortDir='desc';
  /* 새 DB에 개별 insert (백그라운드) — _inserting 플래그로 동시성 보호 */
  if(window.electronAPI&&window.electronAPI.recordsDailyInsert){
    newRec._inserting=true;
    window.electronAPI.recordsDailyInsert({
      school_year:(function(){const _rd=new Date(_regDate+'T00:00:00');return String(_rd.getMonth()>=2?_rd.getFullYear():_rd.getFullYear()-1);})(), person_uid:id, person_type:_pType,
      visit_date:_regDate, time_in:timeIn, time_out:timeOut,
      symptoms:'[]', treatment:'', medication:'', department:'',
      body_temp:'', blood_pressure:'', result_code:'return',
      nurse_name:_curUser.name||S.settings.nurse1||'', nurse_id:_curUser.id||null, vip_tags:'[]', memo:''
    }).then(function(res){
      newRec._inserting=false;
      if(res&&res.success&&res.id){
        const _oldLocalId=newRec.id;   /* 스왑 전 로컬 id */
        newRec._dbId=res.id; newRec.id=res.id;
        /* ★ "마지막 등록자 맨 위 고정"(recsByDate) 은 S._lastRegisteredRecId 로 매칭한다.
         *  등록 시엔 로컬 id 를 넣지만 여기서 id 가 DB id 로 바뀌므로, 옛 로컬 id 를 가리키던
         *  경우 함께 DB id 로 갱신해야 한다. 안 그러면 로컬 id 와 DB id 가 어긋난 환경(레코드 삭제로
         *  autoincrement 선행 / 협업·키오스크의 병행 insert)에서 옛 로컬 id 가 '먼저 온 다른 레코드'의
         *  id 와 우연히 겹쳐 그 레코드를 맨 위에 잘못 고정한다. (사용자 보고 2026-07-16) */
        if(S._lastRegisteredRecId===_oldLocalId) S._lastRegisteredRecId=res.id;
      }
      else if(res&&!res.success){ console.error('[DB] daily insert 검증 실패:',res.error); bus.emit('toast:show',{text:'⚠️ 일지 등록 실패: '+(res.error||'알 수 없는 오류')}); }
      if(newRec._pendingUpdate){newRec._pendingUpdate=false;if(typeof saveRecordNow==='function')saveRecordNow(newRec);}
    }).catch(function(err){newRec._inserting=false;console.error('[DB] daily insert 실패:',err);});
  }
  saveData({silent:true});
  addRecord(newRec);
  /* 생일 폭죽: 오늘 처음 등록된 생일 학생만 */
  if(s&&isBirthdayToday(s)&&!_bdayFiredToday[id]){
    _bdayFiredToday[id]=true;
    setTimeout(function(){fireConfetti(id);},300);
  }
  /* 증상 입력 팝업 자동 열기 */
  setTimeout(function(){openSymptomCategoryPopup(newRec.id);},300);
}

export function closeModalWithAnim(el,cb){
  if(!el)return;
  /* 이전에 닫기 애니메이션이 예약돼 있으면 먼저 취소.
   * (사용자가 빠르게 닫기→다시 닫기 누르는 케이스 보호) */
  if(el._closeAnimTimeout){
    clearTimeout(el._closeAnimTimeout);
    el._closeAnimTimeout=null;
  }
  if(el.classList.contains('qm-overlay')){
    el.style.transition='background 0.3s ease';
    el.style.background='transparent';
    el.classList.add('hiding');
    /* timeout 핸들을 element 에 저장 — 320ms 안에 다시 열면 open 함수가 cancelOpenForReopen() 으로 취소.
     * 이게 없으면 "빨리 닫고 다시 열기" 가 race 로 active 클래스를 잃어 모달 미표시 (버튼 무반응 증상) 발생. */
    el._closeAnimTimeout=setTimeout(function(){
      el._closeAnimTimeout=null;
      el.classList.remove('active','hiding');
      el.style.transition='';
      el.style.background='';
      if(cb)cb();
    },320);
  } else {
    el.style.transition='background 0.3s ease';
    el.style.background='transparent';
    el.classList.add('hiding');
    el._closeAnimTimeout=setTimeout(function(){
      el._closeAnimTimeout=null;
      el.remove();
      if(cb)cb();
    },340);
  }
}

/* open 함수에서 호출 — 닫기 애니메이션이 진행 중이면 cancel 해서 즉시 다시 열림. */
export function cancelCloseAnimIfPending(el){
  if(!el)return;
  if(el._closeAnimTimeout){
    clearTimeout(el._closeAnimTimeout);
    el._closeAnimTimeout=null;
    el.classList.remove('hiding');
    el.style.transition='';
    el.style.background='';
  }
}

/* 외부 클릭 시 모든 자동완성 팝업 닫기 */
document.addEventListener('mousedown',function(e){
  const acIds=['dailyACList','ecACList','infACList','rlACList'];
  acIds.forEach(function(id){
    const list=document.getElementById(id);
    if(!list||!list.classList.contains('show'))return;
    const wrap=list.closest('.autocomplete-wrap');
    if(wrap&&wrap.contains(e.target))return;
    list.classList.remove('show');
  });
});

