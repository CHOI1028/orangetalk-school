/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module — MacOS 스타일 인원(학생/교직원) 상세 검색 공용 UI.
   Phase 3C/D/E/4F 설계에 따른 재사용 컴포넌트.

   기능 요약:
   - 상단 제목 (회색 배경) + X 버튼 없음 (바깥 클릭으로만 닫힘)
   - 탭 (학생/교직원) — allowStaff 옵션 시 표시
   - 세그먼트 학교급·학과 (cyan active, 한 종류뿐이면 dimmed)
   - "학년" 레이블 + 학년 칩 (cyan active)
   - 반별 카드 — 제목 "학교급-학과-학년-반" 고정 순서
   - 학생 카드: 번호 + 이름 (유치원은 이름만)
   - 교직원 카드: 이름 + 직위 (교장/교감/행정실장 있으면 "학교 관리자" 섹션, 나머지 가나다)
   - hover 미니 팝업: 풀네임·소속·성별·생년월일·과거 방문·상태 플래그
   - 4종 상태 세로 도트 (요보호·미세먼지·응급처치비동의·일반의약품비동의)

   사용법:
     import { openPersonSearch } from '.../core/person-search-ui.js';
     openPersonSearch({
       title: '🛡 요보호 대상 학생 등록/변경',
       type: 'student',              // 'student' | 'staff'
       allowStaff: false,            // true 면 상단에 학생/교직원 탭
       onPick: function(id){ ... },  // 선택 콜백 (학생/교직원 id)
       overlayId: 'careSearchOverlay',
       closeOnPick: true,            // pick 후 자동 닫기 (기본 true)
     });

   다중 선택 모드 (연수/교육 대상 선택 등 — 2026-08-25):
     openPersonSearch({
       title:'📋 연수/교육 대상 선택', type:'staff', allowStaff:true,
       multiSelect: true,                       // 카드 1클릭 토글 다중 선택
       initialSelected: [id, ...],              // 재오픈 시 기존 선택 복원
       onComplete: function(ids, typeTab){...}, // 완료 버튼·바깥 클릭 시 호출 (둘 다 반영 후 닫힘)
     });
     · 교직원 탭: 학교급·학과·학년 행이 비활성(회색) 표시, 전체 선택 체크박스, 최초 진입 시 전체 선택
     · 학생 탭: 학교급 하나 선택, 학과·학년은 하나 이상 토글 선택 — 범위 변경 시 그 범위 전체 선택 상태로 시작
     · 모든 선택/해제는 반드시 1클릭 토글. 바깥 클릭도 완료와 동일하게 반영(자동 저장 철학, 사용자 요청 2026-08-25) */

import { escHtml, closeModalGracefully, compareClass } from './helpers.js';
import { S } from './app-state.js';
import { appConfirmModal } from './ui-utils.js';

const LEADER_ORDER = ['교장','교감','행정실장'];

function _lvLabel(lv){
  if(lv==='kindergarten') return '유';
  if(lv==='elementary') return '초';
  if(lv==='middle') return '중';
  if(lv==='high') return '고';
  if(lv==='college') return '대';
  if(lv==='special') return '특수';
  return lv||'';
}
function _lvEmoji(lv){
  if(lv==='kindergarten') return '🌸';
  if(lv==='elementary') return '🌱';
  if(lv==='middle') return '📘';
  if(lv==='high') return '🎓';
  if(lv==='college') return '🎓';
  return '🏫';
}
function _fmtBirth(birth){
  if(!birth) return '';
  try{ const d=new Date(birth); if(!isNaN(d.getTime())) return d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일'; }catch(e){}
  return birth;
}

/* ── 이름·초성 검색 매처 ────────────────────────────────────────────────
 * daily-view.js 의 초성 검색 로직을 이 core 모듈에 로컬 이식(core→feature import 계층 역전 회피).
 * 이름 부분일치 + (쿼리가 초성만이면) 초성 부분일치. Jamo(0x1100)·호환자모(0x3131) 모두 대응. */
const _PS_CHO=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const _PS_JAMO={0x1100:'ㄱ',0x1101:'ㄲ',0x1102:'ㄴ',0x1103:'ㄷ',0x1104:'ㄸ',0x1105:'ㄹ',0x1106:'ㅁ',0x1107:'ㅂ',0x1108:'ㅃ',0x1109:'ㅅ',0x110A:'ㅆ',0x110B:'ㅇ',0x110C:'ㅈ',0x110D:'ㅉ',0x110E:'ㅊ',0x110F:'ㅋ',0x1110:'ㅌ',0x1111:'ㅍ',0x1112:'ㅎ'};
function _psNorm(s){
  let r=String(s==null?'':s); try{ r=r.normalize('NFC'); }catch(_){}
  let o=''; for(let i=0;i<r.length;i++){ const c=r.charCodeAt(i); o+=(_PS_JAMO[c]||r[i]); }
  return o;
}
function _psChosung(str){
  let r=''; for(let i=0;i<str.length;i++){ const c=str.charCodeAt(i);
    if(c>=0xAC00&&c<=0xD7A3) r+=_PS_CHO[Math.floor((c-0xAC00)/588)];
    else if(c>=0x3131&&c<=0x314E) r+=str[i];
    else if(_PS_JAMO[c]) r+=_PS_JAMO[c];
    else r+=str[i];
  }
  return r;
}
function _psIsChosung(q){
  if(!q) return false;
  for(let i=0;i<q.length;i++){ const c=q.charCodeAt(i);
    if(!((c>=0x3131&&c<=0x314E)||_PS_JAMO[c])) return false; }
  return true;
}
function _psNameMatch(name, query){
  const q=_psNorm(query).trim(); if(!q) return true;
  const n=_psNorm(name);
  if(n.toLowerCase().indexOf(q.toLowerCase())!==-1) return true;
  if(_psIsChosung(q) && _psChosung(n).indexOf(q)!==-1) return true;
  return false;
}

export function openPersonSearch(opts){
  opts = opts || {};
  const overlayId = opts.overlayId || 'personSearchOverlay';
  const old=document.getElementById(overlayId);
  if(old) old.remove();

  /* ── 학년도 전환 가드 — 현재 학년도 인원 데이터가 없으면 검색창 대신 안내 (사용자 요청 2026-06-13) ──
     3/1 이후 새 학년도가 되면 직전 학년도 명단은 과거 데이터가 되고 현재 학년도는 빈 상태가 된다.
     이때 검색해도 결과가 없으므로 "이번 학년도 인원 데이터 입력 필요" 안내를 띄운다. */
  const _ppl = S.people || [];
  const _hasStu = _ppl.some(function(p){ return p && p.type === 'student'; });
  const _hasStaff = _ppl.some(function(p){ return p && p.type === 'staff'; });
  let _rosterEmpty;
  if (opts.type === 'staff' && !opts.allowStaff) _rosterEmpty = !_hasStaff;
  else if (opts.type === 'student' && !opts.allowStaff) _rosterEmpty = !_hasStu;
  else _rosterEmpty = !_hasStu && !_hasStaff;   /* 학생/교직원 탭 모두 — 둘 다 없을 때만 */
  if (_rosterEmpty) {
    const _what = (opts.type === 'staff' && !opts.allowStaff) ? '교직원'
                : (opts.type === 'student' && !opts.allowStaff) ? '학생' : '인원';
    appConfirmModal(
      '이번 학년도에 등록된 ' + _what + ' 데이터가 없습니다.<br>상단 <b>인원 데이터 관리</b>에서 ' + _what + ' 명단을 먼저 등록해 주세요.<br><span style="font-size:11px;color:var(--t3)">(매년 3월 1일 새 학년도가 시작되면 인원 명단을 새로 등록합니다. 지난 학년도 기록은 그대로 보존됩니다.)</span>',
      '📋 이번 학년도 인원 데이터 입력이 필요합니다',
      { okOnly: true, okLabel: '확인', okBg: 'rgba(6,182,212,0.12)', okBorder: 'rgba(6,182,212,0.35)', okColor: '#0891b2' }
    );
    return;
  }

  const state = {
    typeTab: opts.type || 'student',    /* student | staff */
    schoolLevel: null,
    department: 'all',
    grade: null,
    nameQuery: ''                       /* 이름·초성 검색어 — 있으면 학교급·학년 없이 바로 결과 */
  };

  /* ── 다중 선택 모드 상태 (multiSelect, 2026-08-25) ──
   * _selSet: 선택된 인원 id(String) 집합 — 완료/바깥 클릭 시 onComplete(ids, typeTab) 로 커밋.
   * gradesSel/deptsSel: 학생 탭의 다중 학년·학과 토글 (deptsSel 비면 '전체'). */
  const multi = !!opts.multiSelect;
  const _selSet = new Set();
  if(multi){
    state.gradesSel = new Set();
    state.deptsSel = new Set();
    if(Array.isArray(opts.initialSelected)){
      opts.initialSelected.forEach(function(id){ _selSet.add(String(id)); });
    }
    if(state.typeTab==='student' && _selSet.size){
      /* 재오픈 — 기존 선택 학생들의 학년을 학년 칩 선택 상태로 복원 */
      (S.people||[]).forEach(function(p){ if(p.type==='student' && _selSet.has(String(p.id)) && p.grade>0) state.gradesSel.add(p.grade); });
    }
    if(state.typeTab==='staff' && _selSet.size===0){
      /* 최초 진입 — 교직원 전체 선택 기본값 */
      (S.people||[]).forEach(function(p){ if(p.type==='staff') _selSet.add(String(p.id)); });
    }
  }

  /* 초기 학교급 — 하나뿐이면 자동 선택 */
  const levels = _getSchoolLevels();
  state.schoolLevel = levels.length===1 ? levels[0] : 'all';

  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id=overlayId;
  ov.style.background='rgba(0,0,0,0.25)';
  /* 부모 팝업(인원 데이터 관리·요보호 등록 등)이 z-index 9000~10100 대를 사용하므로
     이 검색 팝업이 그 위에 뜨도록 11000 으로 올림. (기본 .modal-overlay 는 2000) */
  ov.style.zIndex = (opts.zIndex && opts.zIndex>11000) ? String(opts.zIndex) : '11000';
  ov.innerHTML =
    '<div class="modal-content ps-modal" style="width:860px;max-width:96vw;padding:0;height:74vh;max-height:74vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(255,255,255,0.08);box-shadow:0 32px 80px rgba(0,0,0,0.45),0 12px 32px rgba(0,0,0,0.25)">'
    /* 제목 행 — 회색 배경, X 버튼 없음. opts.showRegister 면 우측에 "+ 인원 등록" 초록 칩 (개별 등록 바로가기) */
    +'<div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--bdrl);background:var(--popup-head)">'
      +'<span style="font-size:14px;font-weight:700;color:var(--t2)">'+escHtml(opts.title||'🔍 학생/교직원 검색')+'</span>'
      +(opts.showRegister ? '<button data-ps="register" title="명단에 없는 인원을 바로 등록" style="padding:6px 12px;font-size:11px;font-weight:700;border-radius:7px;cursor:pointer;border:1px dashed #16a34a;background:transparent;color:#16a34a;font-family:var(--f);white-space:nowrap;transition:all .15s" onmouseover="this.style.background=\'rgba(22,163,74,0.08)\'" onmouseout="this.style.background=\'transparent\'">＋ 학생 또는 교직원 등록</button>' : '')
    +'</div>'
    /* 탭 (옵션) */
    +(opts.allowStaff ? '<div data-ps="tabs" style="padding:0 16px;display:flex;gap:2px;border-bottom:1px solid var(--bdrl)"></div>' : '')
    /* 이름 검색란 — 학교급 바로 위. 입력 시 학교급·학년 선택 없이 곧바로 결과 표시 (사용자 요청 2026-07-16) */
    +'<div data-ps="search" style="padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl)">'
      +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">검색</span>'
      +'<div style="position:relative;flex:1">'
        +'<input data-ps-search-input type="text" autocomplete="off" placeholder="🔍 이름 또는 초성으로 바로 찾기 (선택) — 예: 홍길동, ㅎㄱㄷ" style="width:100%;font-size:12px;padding:7px 30px 7px 11px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);color:var(--t1);font-family:var(--f);box-sizing:border-box">'
        +'<button data-ps-search-clear type="button" title="지우기" style="display:none;position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:13px;padding:2px 6px;font-family:var(--f)">✕</button>'
      +'</div>'
    +'</div>'
    /* 세그먼트 */
    +'<div data-ps="segments" style="padding:10px 16px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--bdrl)"></div>'
    /* 학년 */
    +'<div data-ps="grades" style="padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl);min-height:54px;flex-wrap:wrap">'
      +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학년</span>'
      +'<div data-ps="grade-chips" style="display:flex;gap:6px;flex-wrap:wrap;flex:1"></div>'
    +'</div>'
    /* 본문 — cyan 테마 스크롤바 */
    +'<div data-ps="body" data-ps-scroll="1" style="flex:1 1 0;min-height:0;padding:16px;overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:rgba(6,182,212,0.45) transparent"></div>'
    /* 범례 */
    +'<div style="padding:8px 16px;border-top:1px solid var(--bdrl);display:flex;gap:14px;font-size:9.5px;color:var(--t3);flex-wrap:wrap">'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f97316;box-shadow:0 0 4px #f97316;margin-right:4px"></span>요보호</span>'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#eab308;box-shadow:0 0 4px #eab308;margin-right:4px"></span>미세먼지 기저질환</span>'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;box-shadow:0 0 4px #dc2626;margin-right:4px"></span>응급처치 비동의</span>'
      +'<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a855f7;box-shadow:0 0 4px #a855f7;margin-right:4px"></span>일반의약품 비동의</span>'
      +'<span style="opacity:0.6">· 전학/자퇴 — 회색 취소선</span>'
    +'</div>'
    /* 다중 선택 푸터 — 선택 인원 수 + 완료 버튼 (multiSelect 전용) */
    +(multi ? '<div data-ps="footer" style="padding:10px 16px;border-top:1px solid var(--bdrl);display:flex;align-items:center;justify-content:space-between;background:var(--bg2)">'
      +'<span data-ps-count style="font-size:11.5px;font-weight:700;color:var(--cyan)"></span>'
      +'<button data-ps-complete style="padding:8px 28px;font-size:12px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f)">완료</button>'
    +'</div>' : '')
    +'</div>';

  /* 바깥 클릭 — 다중 선택 모드는 완료 버튼과 동일하게 "선택 반영 후 닫힘"
   * (앱 전반의 자동 저장 철학, 사용자 요청 2026-08-25). 단일 선택 모드는 기존대로 그냥 닫기. */
  ov.addEventListener('click', function(e){
    if(e.target!==ov) return;
    if(multi){ _commitAndClose(); }
    else { _hidePop(); closeModalGracefully(ov); }
  });
  document.body.appendChild(ov);
  /* "+ 학생 또는 교직원 등록" 칩 → 검색 팝업 닫고 인원 데이터 관리 개별 등록 폼으로 직행 */
  const _regBtn = ov.querySelector('[data-ps="register"]');
  if(_regBtn) _regBtn.addEventListener('click', function(e){
    e.stopPropagation();
    _hidePop(); closeModalGracefully(ov);
    import('../features/person-manager/person-manager-view.js').then(function(m){ if(m.openPersonTypeChooser) m.openPersonTypeChooser(); }).catch(function(err){ console.error('[quick-register]', err); });
  });

  /* 모달 컨텐츠 높이를 실제 가용 viewport 에 맞게 동적 조정 — CSS zoom 활성 시
     `max-height:92vh` 가 zoom 배율만큼 부풀어 올라 윈도우 작업표시줄 아래로 잘리는 현상 해결.
     window.innerHeight 는 zoom 스케일 적용된 CSS 픽셀이므로 그대로 사용 가능. */
  const _modalContent = ov.querySelector('.ps-modal');
  function _adjustModalHeight(){
    if(!_modalContent) return;
    const vh = window.innerHeight;
    const zoom = parseFloat(document.documentElement.style.zoom || '1') || 1;
    /* 74vh 기본 + 충분한 여유. 작업표시줄·여유 공간 확보. */
    const topGap = 90, bottomGap = 110;
    const maxH = Math.max(380, Math.floor((vh - topGap - bottomGap) / zoom));
    _modalContent.style.height = maxH + 'px';
    _modalContent.style.maxHeight = maxH + 'px';
  }
  _adjustModalHeight();
  window.addEventListener('resize', _adjustModalHeight);
  /* 모달 닫힐 때 리스너 제거 */
  const _origRemove = ov.remove.bind(ov);
  ov.remove = function(){
    window.removeEventListener('resize', _adjustModalHeight);
    return _origRemove();
  };

  /* 이름 검색란 바인딩 — 본문(body)만 재렌더하므로 입력창 포커스·한글 조합(IME) 유지 */
  const _searchInput = ov.querySelector('[data-ps-search-input]');
  const _searchClear = ov.querySelector('[data-ps-search-clear]');
  if(_searchInput){
    _searchInput.addEventListener('input', function(){
      state.nameQuery = this.value || '';
      if(_searchClear) _searchClear.style.display = state.nameQuery ? 'block' : 'none';
      _renderBody();
    });
  }
  if(_searchClear){
    _searchClear.addEventListener('click', function(){
      state.nameQuery = '';
      if(_searchInput){ _searchInput.value=''; _searchInput.focus(); }
      this.style.display = 'none';
      _renderBody();
    });
  }
  /* 팝업 오픈 즉시 검색창 자동 포커스 — 커서가 깜빡여 바로 이름 입력 가능 (사용자 요청 2026-08-25).
   * 모달 삽입 애니메이션 직후에 걸어야 포커스가 안정적으로 잡힘. 모든 호출자(상세 검색 포함) 공통. */
  if(_searchInput){ setTimeout(function(){ try{ _searchInput.focus(); }catch(_){ } }, 80); }

  /* ── 다중 선택 헬퍼 (multiSelect 전용) ── */
  function _multiScopeStudents(){
    /* 현재 클릭 흐름 범위(학교급 + 학과 토글 + 학년 토글)의 학생들 — 검색어 무관 */
    return (S.people||[]).filter(function(s){
      if(s.type!=='student') return false;
      if(state.schoolLevel && state.schoolLevel!=='all' && s.level && s.level!==state.schoolLevel) return false;
      if(state.deptsSel.size && !state.deptsSel.has(s.department||'__unassigned__')) return false;
      if(!state.gradesSel.size) return false;
      return state.gradesSel.has(s.grade);
    });
  }
  function _recomputeStudentSel(){
    /* 범위(학교급/학과/학년) 변경 → 학생 선택을 "새 범위 전체 선택" 상태로 재설정 (교직원 선택은 유지) */
    (S.people||[]).forEach(function(p){ if(p.type==='student') _selSet.delete(String(p.id)); });
    _multiScopeStudents().forEach(function(p){ _selSet.add(String(p.id)); });
  }
  function _selCountOfTab(){
    let n=0;
    (S.people||[]).forEach(function(p){ if(p.type===state.typeTab && _selSet.has(String(p.id))) n++; });
    return n;
  }
  function _updateFooter(){
    if(!multi) return;
    const el=ov.querySelector('[data-ps-count]');
    if(el) el.textContent='선택된 '+(state.typeTab==='staff'?'교직원':'학생')+' '+_selCountOfTab()+'명';
  }
  function _applyOnStyle(el,on){
    el.style.borderColor = on ? 'var(--cyan)' : 'var(--bdr)';
    el.style.background = on ? 'rgba(6,182,212,0.13)' : (el.dataset.psBg||'var(--card)');
    el.style.boxShadow = on ? '0 0 10px rgba(6,182,212,0.18)' : '';
    if(on) el.setAttribute('data-ps-on','1'); else el.removeAttribute('data-ps-on');
  }
  function _chipOn(id){ return multi && _selSet.has(String(id)); }
  /* 다중 모드 카드 공통 — 선택 상태 인라인 스타일 조각 (렌더 시점 반영) */
  function _chipCss(id, baseBg){
    if(!multi) return 'background:'+baseBg+';border:1.5px solid var(--bdr)';
    return _chipOn(id)
      ? 'background:rgba(6,182,212,0.13);border:1.5px solid var(--cyan);box-shadow:0 0 10px rgba(6,182,212,0.18)'
      : 'background:'+baseBg+';border:1.5px solid var(--bdr)';
  }
  /* 다중 모드 — 본문 상단 전체 선택 체크박스 행 (해제 시 표시된 전원 해제, 사용자 요청 2026-08-25) */
  function _masterRowHtml(){
    if(!multi) return '';
    return '<div style="display:flex;align-items:center;gap:6px;padding:0 2px 2px">'
      +'<label style="display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;color:var(--t2);cursor:pointer;user-select:none">'
      +'<input type="checkbox" data-ps-master style="accent-color:#0891b2;width:15px;height:15px;cursor:pointer"> 전체 선택</label>'
      +'</div>';
  }
  function _bindMaster(body){
    const cb=body.querySelector('[data-ps-master]');
    if(!cb) return;
    cb.addEventListener('change',function(){
      const on=this.checked;
      body.querySelectorAll('[data-ps-pick]').forEach(function(el){
        const id=String(el.dataset.psPick);
        if(on) _selSet.add(id); else _selSet.delete(id);
        _applyOnStyle(el,on);
      });
      _updateFooter();
    });
    _syncMaster();
  }
  function _syncMaster(){
    const cb=ov.querySelector('[data-ps-master]');
    if(!cb) return;
    const listed=ov.querySelectorAll('[data-ps="body"] [data-ps-pick]');
    let all=listed.length>0;
    listed.forEach(function(el){ if(!_selSet.has(String(el.dataset.psPick))) all=false; });
    cb.checked=all;
  }
  function _commitAndClose(){
    const ids=[];
    (S.people||[]).forEach(function(p){ if(p.type===state.typeTab && _selSet.has(String(p.id))) ids.push(p.id); });
    _hidePop();
    closeModalGracefully(ov);
    if(typeof opts.onComplete==='function'){
      try{ opts.onComplete(ids, state.typeTab); }catch(e){ console.warn('[personSearch onComplete]', e); }
    }
  }
  const _completeBtn=ov.querySelector('[data-ps-complete]');
  if(_completeBtn) _completeBtn.addEventListener('click', function(){ _commitAndClose(); });

  /* 기본 렌더 */
  _renderAll();
  _updateFooter();

  /* 바운스 스크롤 — 끝에 닿으면 부드럽게 튕김 (크로스 플랫폼 JS 구현) */
  (function attachBounceScroll(){
    const body=ov.querySelector('[data-ps-scroll="1"]');
    if(!body)return;
    let bouncing=false;
    body.style.transition='transform 0s';
    body.addEventListener('wheel',function(e){
      const atTop=body.scrollTop<=0;
      const atBottom=body.scrollTop+body.clientHeight>=body.scrollHeight-1;
      const overscroll=(atTop&&e.deltaY<0)||(atBottom&&e.deltaY>0);
      if(!overscroll||bouncing)return;
      bouncing=true;
      const dir=e.deltaY<0?1:-1;
      const amount=Math.min(24,Math.abs(e.deltaY)*0.4)*dir;
      body.style.transition='transform 0.12s cubic-bezier(0.22,1,0.36,1)';
      body.style.transform='translateY('+amount+'px)';
      setTimeout(function(){
        body.style.transition='transform 0.38s cubic-bezier(0.34,1.56,0.64,1)';
        body.style.transform='translateY(0)';
        setTimeout(function(){ bouncing=false; body.style.transition='transform 0s'; },380);
      },120);
    },{passive:true});
  })();

  /* ───────────── 내부 유틸 ───────────── */
  function _getSchoolLevels(){
    const set=new Set();
    (S.people||[]).forEach(function(s){ if(s.type==='student' && s.level) set.add(s.level); });
    /* 정렬: 유 → 초 → 중 → 고 → 대 (한국 학제 흐름) */
    const _LV_ORDER={'유':0,'kindergarten':0,'초':1,'elementary':1,'중':2,'middle':2,'고':3,'high':3,'대':4};
    return Array.from(set).sort(function(a,b){
      const oa=_LV_ORDER[a]!=null?_LV_ORDER[a]:99;
      const ob=_LV_ORDER[b]!=null?_LV_ORDER[b]:99;
      if(oa!==ob)return oa-ob;
      return String(a).localeCompare(String(b),'ko');
    });
  }
  function _getDepartments(){
    const set=new Set();
    (S.people||[]).forEach(function(s){
      if(s.type!=='student') return;
      if(state.schoolLevel && state.schoolLevel!=='all' && s.level && s.level!==state.schoolLevel) return;
      if(s.department) set.add(s.department);
    });
    return Array.from(set);
  }
  function _hasUnassignedDept(){
    return (S.people||[]).some(function(s){
      if(s.type!=='student') return false;
      if(state.schoolLevel && state.schoolLevel!=='all' && s.level && s.level!==state.schoolLevel) return false;
      return !s.department;
    });
  }
  function _filterStudents(){
    return (S.people||[]).filter(function(s){
      if(state.typeTab==='student' && s.type!=='student') return false;
      if(state.typeTab==='staff' && s.type!=='staff') return false;
      if(s.type==='student'){
        /* 다중 모드 + 검색 중 — 학교급·학과·학년 토글을 전부 무시하고 탭 전체에서 찾음.
         * 검색은 클릭 흐름의 대안 경로라 범위 밖 인원도 찾아서 바로 선택할 수 있어야 함 (사용자 요청 2026-08-25). */
        const _multiSearching = multi && !!state.nameQuery && !state._ignoreGrades;
        if(!_multiSearching && state.schoolLevel && state.schoolLevel!=='all' && s.level && s.level!==state.schoolLevel) return false;
        if(multi){
          /* 다중 모드 — 학과·학년은 토글 집합 기준 (deptsSel 비면 전체).
           * 학년 미선택 + 검색어 없음 → 빈 목록 (본문에서 안내문 처리).
           * _ignoreGrades: _getGrades 의 학년 칩 산출용 임시 플래그 — 학년 조건 전체 무시. */
          if(_multiSearching){ /* 검색 중 — 범위 조건 전체 통과 */ }
          else if(state._ignoreGrades){
            if(state.deptsSel.size && !state.deptsSel.has(s.department||'__unassigned__')) return false;
          }
          else {
            if(state.deptsSel.size && !state.deptsSel.has(s.department||'__unassigned__')) return false;
            if(state.gradesSel.size){ if(!state.gradesSel.has(s.grade)) return false; }
            else return false;
          }
        } else {
          if(state.department && state.department!=='all'){
            if(state.department==='__unassigned__'){ if(s.department) return false; }
            else if(s.department !== state.department) return false;
          }
          if(state.grade && s.grade !== state.grade) return false;
        }
      }
      /* 이름·초성 검색 — 학생/교직원 공통 */
      if(state.nameQuery && !_psNameMatch(s.name, state.nameQuery)) return false;
      return true;
    });
  }
  function _getGrades(){
    /* 학년 칩은 학교급·학과 기준으로만 산출 — 이름 검색어는 무시(검색 중에도 학년 칩이 흔들리지 않게).
     * 다중 모드의 교직원 탭에서도 비활성 표시용으로 학생 학년 칩이 필요 → typeTab 을 잠시 student 로 강제. */
    const prev=state.grade, prevQ=state.nameQuery, prevTab=state.typeTab;
    state.grade=null; state.nameQuery=''; state.typeTab='student';
    if(multi) state._ignoreGrades=true;   /* 학년 조건 무시하고 전 학년 산출 */
    const byLv=_filterStudents();
    state.grade=prev; state.nameQuery=prevQ; state.typeTab=prevTab;
    if(multi) state._ignoreGrades=false;
    const set=new Set();
    byLv.forEach(function(s){ if(s.grade>0) set.add(s.grade); });
    return Array.from(set).sort(function(a,b){return a-b;});
  }
  function _pastVisitCount(id){
    if(!S.records) return 0;
    return S.records.filter(function(r){return String(r.studentId)===String(id);}).length;
  }

  /* ───────────── 렌더 ───────────── */
  function _renderAll(){ _renderTabs(); _renderSegments(); _renderGrades(); _renderBody(); }

  function _renderTabs(){
    if(!opts.allowStaff) return;
    const wrap=ov.querySelector('[data-ps="tabs"]');
    if(!wrap) return;
    function _mk(key,label){
      const act=state.typeTab===key;
      return '<button data-ps-tab="'+key+'" style="padding:10px 16px;font-size:12px;font-weight:700;color:'+(act?'var(--t1)':'var(--t3)')+';background:transparent;border:none;cursor:pointer;border-bottom:2px solid '+(act?'var(--cyan)':'transparent')+';font-family:var(--f);transition:all .12s">'+label+'</button>';
    }
    wrap.innerHTML=_mk('student','👨‍🎓 학생')+_mk('staff','👨‍🏫 교직원');
    wrap.querySelectorAll('[data-ps-tab]').forEach(function(btn){
      btn.addEventListener('click',function(){
        state.typeTab=this.dataset.psTab; state.grade=null;
        if(multi){
          /* 등록부는 단일 유형 — 탭 전환 시 떠난 유형의 선택 초기화 (연수 등록부 기존 정책) */
          (S.people||[]).forEach(function(p){ if(p.type!==state.typeTab) _selSet.delete(String(p.id)); });
          if(state.typeTab==='staff'){
            if(_selCountOfTab()===0)(S.people||[]).forEach(function(p){ if(p.type==='staff') _selSet.add(String(p.id)); });
          } else {
            /* 학생 탭 재진입 — 학년 칩이 남아있고 선택이 비었으면 범위 전체 선택으로 복원 */
            if(state.gradesSel.size && _selCountOfTab()===0) _recomputeStudentSel();
          }
        }
        _renderAll(); _updateFooter();
      });
    });
  }

  function _renderSegments(){
    const wrap=ov.querySelector('[data-ps="segments"]');
    if(!wrap) return;
    /* 교직원 탭 — 단일 모드는 기존대로 숨김. 다중 모드는 행을 남기되 비활성(회색) 표시
     * (사용자 요청 2026-08-25: "교직원 선택 시 학교급·학과·학년 비활성화"). */
    const _staffDisabled = state.typeTab==='staff';
    if(_staffDisabled && !multi){ wrap.innerHTML=''; wrap.style.display='none'; return; }
    wrap.style.display='flex';
    const levels=_getSchoolLevels();
    const singleLevel=levels.length<=1;
    const _dis=_staffDisabled;   /* multi + 교직원 탭 → 전체 비활성 */
    let h='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap'+(_dis?';opacity:0.4;pointer-events:none':'')+'">'
      +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학교급</span>'
      +'<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px;flex-wrap:wrap'+((singleLevel&&!_dis)?';opacity:0.5;pointer-events:none':'')+'">';
    const allAct=state.schoolLevel==='all';
    h+=_segBtn('level','all','전체',allAct, singleLevel||_dis);
    levels.forEach(function(lv){ h+=_segBtn('level',lv,_lvLabel(lv), state.schoolLevel===lv, singleLevel||_dis); });
    h+='</div>';
    if(singleLevel&&!_dis) h+='<span style="font-size:9.5px;color:var(--t3);font-style:italic">· 등록된 학교급이 하나뿐이라 자동 선택됨</span>';
    if(_dis) h+='<span style="font-size:9.5px;color:var(--t3);font-style:italic">· 교직원은 학교급·학과·학년 구분이 없습니다</span>';
    h+='</div>';

    /* 학과 섹션 — 등록된 학생 중 단 한 명이라도 학과명을 입력한 경우에만 활성화.
       유치원/초/중/일반계고처럼 학과 데이터가 전혀 없으면 섹션 자체를 숨김.
       특성화고/마이스터고 등 학과가 있는 학교에서만 표시됨.
       다중 모드: 학과는 하나 이상 토글 선택(deptsSel 비면 '전체') — 여러 학과 동시 포함 (사용자 요청 2026-08-25). */
    const deps=_getDepartments();
    if(deps.length>=1){
      const _hasUnassigned=_hasUnassignedDept();
      const _dActive=function(v){ return multi ? (v==='all' ? state.deptsSel.size===0 : state.deptsSel.has(v)) : (state.department===v); };
      h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap'+(_dis?';opacity:0.4;pointer-events:none':'')+'">'
        +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학과</span>'
        +'<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px;flex-wrap:wrap">';
      h+=_segBtn('dept','all','전체', _dActive('all'), _dis);
      deps.forEach(function(dp){ h+=_segBtn('dept',dp,dp, _dActive(dp), _dis); });
      if(_hasUnassigned) h+=_segBtn('dept','__unassigned__','학과 미지정', _dActive('__unassigned__'), _dis);
      h+='</div></div>';
    }
    wrap.innerHTML=h;
    if(_dis) return;   /* 교직원 탭(다중) — 비활성 표시만, 바인딩 없음 */
    wrap.querySelectorAll('[data-ps-seg]').forEach(function(btn){
      btn.addEventListener('click',function(){
        const kind=this.dataset.psSeg, val=this.dataset.psSegVal;
        if(kind==='level'){
          state.schoolLevel=val; state.department='all'; state.grade=null;
          if(multi){ state.deptsSel.clear(); state.gradesSel.clear(); _recomputeStudentSel(); }
        }
        else if(kind==='dept'){
          if(multi){
            /* '전체' = deptsSel 비움 / 개별 학과 = 1클릭 토글 (하나 이상 선택 가능) */
            if(val==='all') state.deptsSel.clear();
            else if(state.deptsSel.has(val)) state.deptsSel.delete(val);
            else state.deptsSel.add(val);
            _recomputeStudentSel();
          } else {
            state.department=val; state.grade=null;
          }
        }
        _renderAll(); _updateFooter();
      });
    });
  }
  function _segBtn(kind,val,label,act,disabled){
    const bg = act ? 'var(--cyan)' : 'transparent';
    const fg = act ? '#fff' : 'var(--t2)';
    const shadow = act ? ';box-shadow:0 0 12px rgba(6,182,212,0.35)' : '';
    return '<button data-ps-seg="'+kind+'" data-ps-seg-val="'+escHtml(val)+'"'+(disabled?' disabled':'')+' style="padding:5px 14px;font-size:11px;font-weight:'+(act?'700':'600')+';border:none;background:'+bg+';color:'+fg+';border-radius:6px;cursor:'+(disabled?'not-allowed':'pointer')+';font-family:var(--f)'+shadow+'">'+escHtml(label)+'</button>';
  }

  function _renderGrades(){
    const row=ov.querySelector('[data-ps="grades"]');
    const chips=ov.querySelector('[data-ps="grade-chips"]');
    if(!chips) return;
    const _staffDisabled = state.typeTab==='staff';
    /* 교직원 탭 — 단일 모드는 숨김(기존), 다중 모드는 비활성(회색) 표시 (사용자 요청 2026-08-25) */
    if(_staffDisabled && !multi){ if(row) row.style.display='none'; return; }
    if(row){ row.style.display='flex'; row.style.opacity=_staffDisabled?'0.4':''; row.style.pointerEvents=_staffDisabled?'none':''; }
    const grades=_getGrades();
    if(!grades.length){ chips.innerHTML='<span style="font-size:11px;color:var(--t3)">선택된 조건에 해당하는 학년이 없습니다.</span>'; return; }
    /* 유치원 선택 시 "5세/6세" 형태로 표시 (학년 대신 만 나이) */
    const _isKinderSel=(state.schoolLevel==='유'||state.schoolLevel==='kindergarten');
    let h='';
    grades.forEach(function(g){
      /* 다중 모드: 학년은 하나 이상 토글 선택 — 여러 학년 동시 포함 (사용자 요청 2026-08-25) */
      const act=multi ? state.gradesSel.has(g) : state.grade===g;
      const _label=_isKinderSel?(g+'세'):(g+'학년');
      h+='<button data-ps-grade="'+g+'" style="padding:6px 14px;border-radius:8px;border:1.5px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--bg2)')+';color:'+(act?'#fff':'var(--t2)')+';font-size:11px;font-weight:700;cursor:pointer;transition:all .14s;font-family:var(--f);min-width:62px;text-align:center'+(act?';box-shadow:0 0 16px rgba(6,182,212,0.25)':'')+'">'+_label+'</button>';
    });
    chips.innerHTML=h;
    if(_staffDisabled) return;   /* 비활성 표시만 — 바인딩 없음 */
    chips.querySelectorAll('[data-ps-grade]').forEach(function(btn){
      btn.addEventListener('click',function(){
        const g=parseInt(this.dataset.psGrade,10);
        if(multi){
          if(state.gradesSel.has(g)) state.gradesSel.delete(g); else state.gradesSel.add(g);
          _recomputeStudentSel();
          _renderGrades(); _renderBody(); _updateFooter();
        } else {
          state.grade=g; _renderGrades(); _renderBody();
        }
      });
    });
  }

  function _renderBody(){
    const body=ov.querySelector('[data-ps="body"]');
    if(!body) return;
    const q = state.nameQuery ? state.nameQuery.trim() : '';
    const _noGradeYet = multi ? !state.gradesSel.size : !state.grade;
    if(state.typeTab==='student' && _noGradeYet && !q){
      body.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:12px;line-height:1.8">위에서 <b style="color:var(--t2)">학년</b>을 '+(multi?'하나 이상 ':'')+'선택하거나<br>위 <b style="color:var(--t2)">검색란</b>에 이름·초성을 입력하면 학생이 표시됩니다.'+(multi?'<br><span style="font-size:10.5px">학년을 선택하면 그 범위의 학생이 모두 선택된 상태로 시작합니다.</span>':'')+'</div>';
      return;
    }
    const list=_filterStudents();
    if(!list.length){
      body.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:12px">'+(q?'"'+escHtml(q)+'"(으)로 검색된 '+(state.typeTab==='staff'?'교직원':'학생')+'이 없습니다.':'이 조건에 해당하는 '+(state.typeTab==='staff'?'교직원':'학생')+'이 없습니다.')+'</div>';
      return;
    }
    if(state.typeTab==='staff'){
      _renderStaffBody(body, list);
    } else if(q){
      _renderSearchResults(body, list);
    } else {
      _renderStudentBody(body, list);
    }
  }

  /* 이름·초성 검색 결과 — 학년/반 그룹 없이 평면 목록, 각자 소속(학교급·학년·반·번호) 표기.
     결과가 많으면 렌더 부담·가독성 위해 상위 CAP 명만 표시(더 정확히 입력하면 좁혀짐). */
  function _renderSearchResults(body, list){
    const _LV_ORDER={'유':0,'kindergarten':0,'초':1,'elementary':1,'중':2,'middle':2,'고':3,'high':3,'대':4};
    const sorted=list.slice().sort(function(a,b){
      const la=_LV_ORDER[a.level]!=null?_LV_ORDER[a.level]:99, lb=_LV_ORDER[b.level]!=null?_LV_ORDER[b.level]:99;
      if(la!==lb) return la-lb;
      if((a.grade||0)!==(b.grade||0)) return (a.grade||0)-(b.grade||0);
      const cc=compareClass(a.cls||'', b.cls||''); if(cc!==0) return cc;
      return (a.num||0)-(b.num||0);
    });
    const CAP=40;
    const shown=sorted.slice(0,CAP);
    let h='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:2px">🔍 검색 결과 '+sorted.length+'명</div>';
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px">';
    shown.forEach(function(s){
      const isAbsent=s.status==='transferred'||s.status==='dropout';
      const dots=_dotStrip(s);
      const lv=_lvLabel(s.level||'');
      const loc=(lv?lv+' ':'')+(s.grade?s.grade+'학년 ':'')+(s.cls?s.cls+'반 ':'')+(s.num?s.num+'번':'');
      h+='<button data-ps-pick="'+s.id+'" data-ps-hover="1" data-ps-bg="var(--card)" style="position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:7px 12px;border-radius:10px;'+_chipCss(s.id,'var(--card)')+';cursor:pointer;transition:all .14s;font-family:var(--f);text-align:left'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'
        +'<span style="font-size:12px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">'+escHtml(s.name||'-')+'</span>'
        +'<span style="font-size:9.5px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">'+escHtml(loc||'소속 미상')+'</span>'
        +dots
        +'</button>';
    });
    h+='</div>';
    if(sorted.length>CAP) h+='<div style="text-align:center;padding:10px;color:var(--t3);font-size:10.5px">이름을 더 정확히 입력하면 좁혀집니다 · 상위 '+CAP+'명만 표시</div>';
    body.innerHTML=h;
    _bindPickAndHover(body);
  }

  function _renderStaffBody(body, list){
    /* 교장·교감·행정실장 있으면 "🏛 학교 관리자" 섹션, 이후 가나다. 없으면 바로 가나다. */
    const leaders = LEADER_ORDER
      .map(function(pos){ return list.find(function(s){return s.position===pos;}); })
      .filter(Boolean);
    const others = list.filter(function(s){ return LEADER_ORDER.indexOf(s.position)===-1; })
      .sort(function(a,b){return (a.name||'').localeCompare(b.name||'','ko');});

    function _staffCard(s, isLeader){
      const pos = s.position || '교직원';
      return '<button data-ps-pick="'+s.id+'" data-ps-hover="1" data-ps-bg="var(--bg2)" style="padding:10px 12px;border-radius:10px;'+_chipCss(s.id,'var(--bg2)')+';color:var(--t1);font-size:12px;font-weight:600;cursor:pointer;transition:all .14s;font-family:var(--f);text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:2px;position:relative">'
        +'<span style="font-weight:700">'+escHtml(s.name||'')+'</span>'
        +'<span style="font-size:9.5px;color:'+(isLeader?'var(--cyan)':'var(--t3)')+';font-weight:'+(isLeader?'700':'600')+'">'+escHtml(pos)+'</span>'
        +'</button>';
    }

    let h=_masterRowHtml();
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">';
    if(leaders.length){
      h+='<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--t3);padding:4px 2px;border-bottom:1px dashed var(--bdr);letter-spacing:0.3px;text-transform:uppercase">🏛 학교 관리자</div>';
      leaders.forEach(function(s){ h+=_staffCard(s, true); });
      h+='<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--t3);padding:8px 2px 4px;border-bottom:1px dashed var(--bdr);letter-spacing:0.3px;text-transform:uppercase">가나다순 (교원·직원 통합)</div>';
    }
    others.forEach(function(s){ h+=_staffCard(s, false); });
    h+='</div>';
    body.innerHTML=h;
    _bindPickAndHover(body);
    if(multi) _bindMaster(body);
  }

  function _renderStudentBody(body, list){
    /* (학과, 학년, 반) 조합으로 그룹핑 — "전체" 학과 선택 시 학과별로 분리됨.
     * 학년을 그룹 키에 포함 (2026-08-25) — 다중 모드에서 여러 학년을 동시에 표시하기 위함.
     * 단일 모드는 학년이 하나뿐이라 그룹 결과가 기존과 동일. */
    const groupByDept = multi ? true : (state.department==='all' || !state.department);
    const groups=[];
    const keys=new Set();
    list.forEach(function(s){ keys.add((groupByDept?(s.department||'__none__'):'__x__')+'||'+(s.grade||0)+'||'+(s.cls||0)); });
    [...keys].sort(function(a,b){
      const pa=a.split('||'), pb=b.split('||');
      if(pa[0]!==pb[0]) return (pa[0]==='__none__'?'zz':pa[0]).localeCompare(pb[0]==='__none__'?'zz':pb[0],'ko');
      if(+pa[1]!==+pb[1]) return (+pa[1])-(+pb[1]);
      return compareClass(pa[2],pb[2]);
    }).forEach(function(k){
      const parts=k.split('||'); const dep=parts[0], gr=parts[1], cls=parts[2];
      const sts=list.filter(function(s){ return (groupByDept?(s.department||'__none__'):'__x__')===dep && String(s.grade||0)===gr && (s.cls||0)==cls; });
      if(sts.length) groups.push({ dept:(dep==='__none__'||dep==='__x__'?'':dep), grade:+gr, cls:cls, sts:sts });
    });

    let h=_masterRowHtml();
    groups.forEach(function(g){
      const c=g.cls;
      /* 유치원 모드 — 모두 유치원 level 이거나 번호가 전혀 없는 경우 */
      const isKinder = g.sts.every(function(s){return s.level==='kindergarten';}) || g.sts.every(function(s){return !s.num || s.num==='0';});
      const sts = isKinder
        ? g.sts.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'','ko');})
        : g.sts.slice().sort(function(a,b){return (a.num||0)-(b.num||0);});
      const lv=sts[0]&&sts[0].level||'';
      const clsLabel = isKinder ? (isNaN(+c)?c:c+'반') : c+'반';
      /* 상위 카테고리 순서: 학교급 → 학과 → 학년 → 반 */
      let deptPart=''; if(g.dept) deptPart=g.dept+'-'; else if(lv==='college') deptPart='학과 미지정-';
      const lvLabel=_lvLabel(lv);
      const title = (lvLabel?lvLabel+'-':'') + deptPart + (g.grade||state.grade||'') + '학년-' + clsLabel;

      h+='<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:14px;padding:14px 16px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
          +'<div style="font-size:13px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:8px"><span style="font-size:16px">'+_lvEmoji(lv)+'</span>'+escHtml(title)+'</div>'
          +'<span style="font-size:10px;color:var(--t3);font-weight:600;padding:2px 8px;border-radius:10px;background:var(--card);border:1px solid var(--bdrl)">'+sts.length+'명</span>'
        +'</div>';
      if(isKinder){
        h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:6px">';
        sts.forEach(function(s){
          const isAbsent=s.status==='transferred'||s.status==='dropout';
          const dots=_dotStrip(s);
          h+='<button data-ps-pick="'+s.id+'" data-ps-hover="1" data-ps-bg="var(--card)" style="padding:4px 10px;min-height:28px;position:relative;border-radius:10px;'+_chipCss(s.id,'var(--card)')+';font-size:12px;font-weight:700;color:var(--t1);cursor:pointer;transition:all .14s;font-family:var(--f);text-align:center'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'+escHtml(s.name||'-')+dots+'</button>';
        });
      } else {
        h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:6px">';
        sts.forEach(function(s){
          const isAbsent=s.status==='transferred'||s.status==='dropout';
          const dots=_dotStrip(s);
          h+='<button data-ps-pick="'+s.id+'" data-ps-hover="1" data-ps-bg="var(--card)" style="position:relative;display:flex;align-items:center;gap:6px;padding:3px 14px 3px 8px;min-height:28px;border-radius:10px;'+_chipCss(s.id,'var(--card)')+';font-size:12px;font-weight:700;color:var(--t1);cursor:pointer;transition:all .14s;font-family:var(--f)'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'
            +'<span style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:6px;background:rgba(6,182,212,0.12);color:var(--cyan);font-size:11px;font-weight:800">'+(s.num||'-')+'</span>'
            +'<span style="flex:1;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(s.name||'')+'</span>'
            +dots
            +'</button>';
        });
      }
      h+='</div></div>';
    });
    body.innerHTML=h;
    _bindPickAndHover(body);
    if(multi) _bindMaster(body);
  }

  function _dotStrip(s){
    const flags=[];
    if(s.status==='caution') flags.push('#f97316');
    if(s.status==='watch')   flags.push('#eab308');
    if(s.emergencyConsent==='N') flags.push('#dc2626');
    if(s.medConsent==='N')       flags.push('#a855f7');
    if(!flags.length) return '';
    let h='<span style="position:absolute;top:3px;right:3px;display:flex;flex-direction:column;gap:1px">';
    flags.forEach(function(c){ h+='<span style="width:5px;height:5px;border-radius:50%;background:'+c+';box-shadow:0 0 4px '+c+'"></span>'; });
    h+='</span>';
    return h;
  }

  function _bindPickAndHover(body){
    body.querySelectorAll('[data-ps-pick]').forEach(function(el){
      el.addEventListener('click',function(){
        const id=this.dataset.psPick;
        if(multi){
          /* 다중 모드 — 반드시 1클릭 토글 (선택↔해제). 팝업은 닫지 않음.
           * 카드는 innerHTML 재생성 후 새 요소에만 바인딩되므로 리스너 중복(1클릭/2클릭 비일관) 없음. */
          const k=String(id);
          if(_selSet.has(k)) _selSet.delete(k); else _selSet.add(k);
          _applyOnStyle(this,_selSet.has(k));
          _syncMaster(); _updateFooter();
          return;
        }
        _hidePop();
        if(typeof opts.onPick==='function') opts.onPick(id);
        if(opts.closeOnPick!==false) closeModalGracefully(ov);
      });
      if(el.dataset.psHover==='1'){
        el.addEventListener('mouseenter',function(){
          this.style.borderColor='var(--cyan)';
          this.style.transform='translateY(-1px)';
          this.style.boxShadow='0 4px 12px rgba(6,182,212,0.18)';
          /* hover 미니 팝업 */
          const id=this.dataset.psPick;
          const stu=(S.people||[]).find(function(p){return String(p.id)===String(id);});
          if(stu) _showPop(this, stu);
        });
        el.addEventListener('mouseleave',function(){
          /* 다중 모드 — 선택된 카드는 cyan 테두리·글로우 유지 (호버 복원이 선택 표시를 지우지 않게) */
          const on=_chipOn(this.dataset.psPick);
          this.style.borderColor=on?'var(--cyan)':'var(--bdr)';
          this.style.transform='';
          this.style.boxShadow=on?'0 0 10px rgba(6,182,212,0.18)':'';
          _hidePop();
        });
      }
    });
  }

  /* ───────────── Hover 미니 팝업 ───────────── */
  let _popEl=null;
  function _showPop(anchor, s){
    _hidePop();
    if(!s) return;
    const flags=[];
    if(s.status==='caution') flags.push({color:'#f97316', label:'요보호'});
    if(s.status==='watch')   flags.push({color:'#eab308', label:'미세먼지 기저질환'});
    if(s.emergencyConsent==='N') flags.push({color:'#dc2626', label:'응급처치 비동의'});
    if(s.medConsent==='N')       flags.push({color:'#a855f7', label:'일반의약품 비동의'});
    const birth = s.birth || s.birth_date || s.birthDate || '';
    const birthFmt = _fmtBirth(birth);
    const visits = _pastVisitCount(s.id);

    const pop=document.createElement('div');
    /* Windows 환경에서 transform 애니메이션이 텍스트 노드를 일시 클립하는 현상 방지 →
       transform 제거, opacity 페이드만 사용. min-height/min-width 명시로 레이아웃 안정. */
    pop.style.cssText='position:fixed;z-index:14000;background:var(--card);border:1px solid var(--bdr);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);padding:12px 14px;font-family:var(--f);pointer-events:none;min-width:220px;max-width:300px;font-size:11px;color:var(--t1);opacity:0;transition:opacity .12s ease;box-sizing:border-box;display:block';
    /* 각 행 = 24px 고정 높이 block + 4px 간격 — 어떤 인라인 상속도 무시되도록 height 명시 */
    const ROW_CSS='display:block;height:22px;line-height:22px;margin:0 0 4px 0;padding:0;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const NAME_CSS='display:block;height:24px;line-height:24px;margin:0 0 6px 0;padding:0;font-size:13px;font-weight:800;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const SUB_CSS='display:block;height:18px;line-height:18px;margin:0 0 8px 0;padding:0;font-size:10px;color:var(--t3);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    const nameEl=document.createElement('div');
    nameEl.style.cssText=NAME_CSS;
    nameEl.textContent=String(s.name||'-');
    pop.appendChild(nameEl);
    if(s.type==='student' && s.grade){
      const lv=_lvLabel(s.level||'');
      const deptStr = s.department ? '·'+s.department : '';
      const lvStr = lv ? lv+'·' : '';
      const subEl=document.createElement('div');
      subEl.style.cssText=SUB_CSS;
      subEl.textContent=lvStr+(s.grade||'-')+'학년 '+(s.cls||'-')+'반'+(s.num?' '+s.num+'번':'')+deptStr;
      pop.appendChild(subEl);
    } else if(s.type==='staff' && s.position){
      const subEl=document.createElement('div');
      subEl.style.cssText=SUB_CSS;
      subEl.textContent=String(s.position);
      pop.appendChild(subEl);
    }
    if(s.gender){
      const g=document.createElement('div');g.style.cssText=ROW_CSS;
      g.innerHTML='성별: <b style="color:var(--t1)">'+escHtml(s.gender)+'</b>';
      pop.appendChild(g);
    }
    if(birthFmt){
      const b=document.createElement('div');b.style.cssText=ROW_CSS;
      b.innerHTML='생년월일: <b style="color:var(--t1)">'+escHtml(birthFmt)+'</b>';
      pop.appendChild(b);
    }
    const v=document.createElement('div');v.style.cssText=ROW_CSS;
    v.innerHTML='과거 방문: <b style="color:var(--cyan)">'+visits+'</b>건';
    pop.appendChild(v);
    if(flags.length){
      const fbox=document.createElement('div');
      fbox.style.cssText='margin-top:6px;padding-top:6px;border-top:1px dashed var(--bdrl);display:flex;flex-wrap:wrap;gap:4px';
      flags.forEach(function(f){
        const span=document.createElement('span');
        span.style.cssText='display:inline-flex;align-items:center;gap:3px;font-size:9.5px;color:'+f.color+';background:rgba(255,255,255,0.05);border:1px solid '+f.color+'44;border-radius:10px;padding:2px 7px;font-weight:700';
        span.innerHTML='<span style="width:6px;height:6px;border-radius:50%;background:'+f.color+';box-shadow:0 0 4px '+f.color+'"></span>'+escHtml(f.label);
        fbox.appendChild(span);
      });
      pop.appendChild(fbox);
    }
    document.body.appendChild(pop);
    _popEl=pop;
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
    requestAnimationFrame(function(){ pop.style.opacity='1'; });
  }
  function _hidePop(){
    if(_popEl){ _popEl.remove(); _popEl=null; }
  }

  return ov;
}
