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
     }); */

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
    grade: null
  };

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
    +'</div>';

  /* 바깥 클릭 → 닫기 */
  ov.addEventListener('click', function(e){ if(e.target===ov){ _hidePop(); closeModalGracefully(ov); } });
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

  /* 기본 렌더 */
  _renderAll();

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
        if(state.schoolLevel && state.schoolLevel!=='all' && s.level && s.level!==state.schoolLevel) return false;
        if(state.department && state.department!=='all'){
          if(state.department==='__unassigned__'){ if(s.department) return false; }
          else if(s.department !== state.department) return false;
        }
        if(state.grade && s.grade !== state.grade) return false;
      }
      return true;
    });
  }
  function _getGrades(){
    const prev=state.grade; state.grade=null;
    const byLv=_filterStudents();
    state.grade=prev;
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
      btn.addEventListener('click',function(){ state.typeTab=this.dataset.psTab; state.grade=null; _renderAll(); });
    });
  }

  function _renderSegments(){
    const wrap=ov.querySelector('[data-ps="segments"]');
    if(!wrap) return;
    if(state.typeTab==='staff'){ wrap.innerHTML=''; wrap.style.display='none'; return; }
    wrap.style.display='flex';
    const levels=_getSchoolLevels();
    const singleLevel=levels.length<=1;
    let h='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
      +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학교급</span>'
      +'<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px;flex-wrap:wrap'+(singleLevel?';opacity:0.5;pointer-events:none':'')+'">';
    const allAct=state.schoolLevel==='all';
    h+=_segBtn('level','all','전체',allAct, singleLevel);
    levels.forEach(function(lv){ h+=_segBtn('level',lv,_lvLabel(lv), state.schoolLevel===lv, singleLevel); });
    h+='</div>';
    if(singleLevel) h+='<span style="font-size:9.5px;color:var(--t3);font-style:italic">· 등록된 학교급이 하나뿐이라 자동 선택됨</span>';
    h+='</div>';

    /* 학과 섹션 — 등록된 학생 중 단 한 명이라도 학과명을 입력한 경우에만 활성화.
       유치원/초/중/일반계고처럼 학과 데이터가 전혀 없으면 섹션 자체를 숨김.
       특성화고/마이스터고 등 학과가 있는 학교에서만 표시됨. */
    const deps=_getDepartments();
    if(deps.length>=1){
      const _hasUnassigned=_hasUnassignedDept();
      h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<span style="font-size:10px;font-weight:700;color:var(--t3);min-width:50px;letter-spacing:0.3px;text-transform:uppercase">학과</span>'
        +'<div style="display:inline-flex;padding:3px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);gap:2px;flex-wrap:wrap">';
      h+=_segBtn('dept','all','전체', state.department==='all', false);
      deps.forEach(function(dp){ h+=_segBtn('dept',dp,dp, state.department===dp, false); });
      if(_hasUnassigned) h+=_segBtn('dept','__unassigned__','학과 미지정', state.department==='__unassigned__', false);
      h+='</div></div>';
    }
    wrap.innerHTML=h;
    wrap.querySelectorAll('[data-ps-seg]').forEach(function(btn){
      btn.addEventListener('click',function(){
        const kind=this.dataset.psSeg, val=this.dataset.psSegVal;
        if(kind==='level'){ state.schoolLevel=val; state.department='all'; state.grade=null; }
        else if(kind==='dept'){ state.department=val; state.grade=null; }
        _renderAll();
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
    if(state.typeTab==='staff'){ if(row) row.style.display='none'; return; }
    if(row) row.style.display='flex';
    const grades=_getGrades();
    if(!grades.length){ chips.innerHTML='<span style="font-size:11px;color:var(--t3)">선택된 조건에 해당하는 학년이 없습니다.</span>'; return; }
    /* 유치원 선택 시 "5세/6세" 형태로 표시 (학년 대신 만 나이) */
    const _isKinderSel=(state.schoolLevel==='유'||state.schoolLevel==='kindergarten');
    let h='';
    grades.forEach(function(g){
      const act=state.grade===g;
      const _label=_isKinderSel?(g+'세'):(g+'학년');
      h+='<button data-ps-grade="'+g+'" style="padding:6px 14px;border-radius:8px;border:1.5px solid '+(act?'var(--cyan)':'var(--bdr)')+';background:'+(act?'var(--cyan)':'var(--bg2)')+';color:'+(act?'#fff':'var(--t2)')+';font-size:11px;font-weight:700;cursor:pointer;transition:all .14s;font-family:var(--f);min-width:62px;text-align:center'+(act?';box-shadow:0 0 16px rgba(6,182,212,0.25)':'')+'">'+_label+'</button>';
    });
    chips.innerHTML=h;
    chips.querySelectorAll('[data-ps-grade]').forEach(function(btn){
      btn.addEventListener('click',function(){ state.grade=parseInt(this.dataset.psGrade,10); _renderGrades(); _renderBody(); });
    });
  }

  function _renderBody(){
    const body=ov.querySelector('[data-ps="body"]');
    if(!body) return;
    if(state.typeTab==='student' && !state.grade){
      body.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:12px;line-height:1.8">위에서 학년을 선택하면<br>반별 학생이 표시됩니다.</div>';
      return;
    }
    const list=_filterStudents();
    if(!list.length){
      body.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:12px">이 조건에 해당하는 '+(state.typeTab==='staff'?'교직원':'학생')+'이 없습니다.</div>';
      return;
    }
    if(state.typeTab==='staff'){
      _renderStaffBody(body, list);
    } else {
      _renderStudentBody(body, list);
    }
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
      return '<button data-ps-pick="'+s.id+'" data-ps-hover="1" style="padding:10px 12px;border-radius:10px;border:1.5px solid var(--bdr);background:var(--bg2);color:var(--t1);font-size:12px;font-weight:600;cursor:pointer;transition:all .14s;font-family:var(--f);text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:2px;position:relative">'
        +'<span style="font-weight:700">'+escHtml(s.name||'')+'</span>'
        +'<span style="font-size:9.5px;color:'+(isLeader?'var(--cyan)':'var(--t3)')+';font-weight:'+(isLeader?'700':'600')+'">'+escHtml(pos)+'</span>'
        +'</button>';
    }

    let h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">';
    if(leaders.length){
      h+='<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--t3);padding:4px 2px;border-bottom:1px dashed var(--bdr);letter-spacing:0.3px;text-transform:uppercase">🏛 학교 관리자</div>';
      leaders.forEach(function(s){ h+=_staffCard(s, true); });
      h+='<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--t3);padding:8px 2px 4px;border-bottom:1px dashed var(--bdr);letter-spacing:0.3px;text-transform:uppercase">가나다순 (교원·직원 통합)</div>';
    }
    others.forEach(function(s){ h+=_staffCard(s, false); });
    h+='</div>';
    body.innerHTML=h;
    _bindPickAndHover(body);
  }

  function _renderStudentBody(body, list){
    /* (학과, 반) 조합으로 그룹핑 — "전체" 학과 선택 시 학과별로 분리됨 */
    const groupByDept = (state.department==='all' || !state.department);
    const groups=[];
    if(groupByDept){
      const keys=new Set();
      list.forEach(function(s){ keys.add((s.department||'__none__')+'||'+(s.cls||0)); });
      [...keys].sort(function(a,b){
        const [da,ca]=a.split('||'), [db,cb]=b.split('||');
        if(da!==db) return (da==='__none__'?'zz':da).localeCompare(db==='__none__'?'zz':db,'ko');
        return compareClass(ca,cb);
      }).forEach(function(k){
        const [dep,cls]=k.split('||');
        const sts=list.filter(function(s){ return (s.department||'__none__')===dep && (s.cls||0)==cls; });
        if(sts.length) groups.push({ dept:(dep==='__none__'?'':dep), cls:cls, sts:sts });
      });
    } else {
      const byCls={};
      list.forEach(function(s){ const c=s.cls||0; if(!byCls[c]) byCls[c]=[]; byCls[c].push(s); });
      Object.keys(byCls).sort(function(a,b){return compareClass(a,b);}).forEach(function(c){
        groups.push({ dept:'', cls:c, sts:byCls[c] });
      });
    }

    let h='';
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
      const title = (lvLabel?lvLabel+'-':'') + deptPart + (state.grade||'') + '학년-' + clsLabel;

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
          h+='<button data-ps-pick="'+s.id+'" data-ps-hover="1" style="padding:4px 10px;min-height:28px;position:relative;border-radius:10px;background:var(--card);border:1.5px solid var(--bdr);font-size:12px;font-weight:700;color:var(--t1);cursor:pointer;transition:all .14s;font-family:var(--f);text-align:center'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'+escHtml(s.name||'-')+dots+'</button>';
        });
      } else {
        h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:6px">';
        sts.forEach(function(s){
          const isAbsent=s.status==='transferred'||s.status==='dropout';
          const dots=_dotStrip(s);
          h+='<button data-ps-pick="'+s.id+'" data-ps-hover="1" style="position:relative;display:flex;align-items:center;gap:6px;padding:3px 14px 3px 8px;min-height:28px;border-radius:10px;background:var(--card);border:1.5px solid var(--bdr);font-size:12px;font-weight:700;color:var(--t1);cursor:pointer;transition:all .14s;font-family:var(--f)'+(isAbsent?';opacity:0.4;text-decoration:line-through':'')+'">'
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
        _hidePop();
        const id=this.dataset.psPick;
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
          this.style.borderColor='var(--bdr)';
          this.style.transform='';
          this.style.boxShadow='';
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
