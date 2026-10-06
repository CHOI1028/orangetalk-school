/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/*
 * name-dup-matcher.js — 동명이인 매칭 모달 + 담임 메시지 팝업
 *
 * 시나리오:
 *  • 3월 1일 새 학년도 명단 업로드 직후, 같은 학교급+학년+이름+성별 학생이 2명 이상이고
 *    작년에 같은 이름의 학생이 있을 때 자동 호출.
 *  • 인원 데이터 관리 진입 시 미해결 그룹이 있으면 ⚠ 카드로 노출.
 *  • 보건실 방문 시 해당 학생을 선택하면 증상 팝업 직전에 confirm → 매칭 모달로 진입.
 *
 * UX:
 *  • 모달 헤더 회색·드래그 이동·1/N 카운터·진행 막대 (기존 외부데이터 매칭 모달과 동일 톤).
 *  • 우상단 주황색 [📋 담임 선생님께 메시지 보기] 버튼.
 *  • 작년 후보 카드는 (반·번호·이름·작년 방문 N건) 표기로 어느 쪽이 동일 인물일지 판단 보조.
 *  • 자동 캐스케이드: 그룹의 마지막-1명을 매칭하면 남은 1명은 서버에서 자동 처리되어 다시 안 나옴.
 *
 * 사용:
 *   import { openNameDupMatcher } from '.../name-dup-matcher.js';
 *   openNameDupMatcher({
 *     onDone: function(stats){ ... },  // 모달 완전 종료 시(또는 0건일 때)
 *     focusUid: 's0123',               // 옵션: 이 uid 가 포함된 그룹부터 먼저 보이기 (보건실 진입 트리거용)
 *   });
 */

import { S } from '../../core/app-state.js';
import { escHtml, _reloadStudentsFromDB } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { dailyShowToast } from '../daily/daily-view.js';

/* 명단 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님). 예) 2025-02-26 → 2024학년도. (사용자 지시 2026-06-19) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

/* 한글 숫자 (2~10) — 메시지 본문의 "두 명/세 명/…" 자연스러운 한국어. */
const _KO_NUM = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
function _koNum(n){ return _KO_NUM[n] || String(n); }

/* 학교급 코드 → 한글 1글자 (메시지·뱃지용) */
const _LV_SHORT = { elementary:'초', middle:'중', high:'고', kindergarten:'유', special:'특', college:'대', '초':'초','중':'중','고':'고','유':'유' };

/* 학교급 정렬용 우선순위 (낮은 학교급 먼저) */
const _LV_ORDER = { kindergarten:1, '유':1, elementary:2, '초':2, middle:3, '중':3, high:4, '고':4, special:5, '특':5, college:6, '대':6 };

let _state = null;       /* { groups, idx, mode } */
let _keyHandler = null;

/* ─────────────────────────────────────────────────────────────
   진입점 — 학생/교직원 그룹을 IPC 로 가져와 모달 띄움.
   focusUid 가 주어지면 그 uid 가 포함된 그룹을 첫 화면에 띄움.
   ───────────────────────────────────────────────────────────── */
export async function openNameDupMatcher(opts){
  opts = opts || {};
  const yr = String(_academicYear());
  const stuGroups = await _fetchStudentGroups(yr);
  const stfGroups = await _fetchStaffGroups(yr);
  const groups = stuGroups.concat(stfGroups);
  if (!groups.length){
    if (typeof opts.onDone === 'function') opts.onDone({ resolved: 0, remaining: 0 });
    return;
  }
  /* focusUid 가 있으면 그 그룹을 맨 앞으로 */
  let startIdx = 0;
  if (opts.focusUid){
    const i = groups.findIndex(g => (g.currentMembers||[]).some(m => String(m.uid) === String(opts.focusUid)));
    if (i >= 0) startIdx = i;
  }
  _state = { groups, idx: startIdx, opts };
  _injectStyles();
  _renderModal();
}

async function _fetchStudentGroups(year){
  try {
    if (!window.electronAPI || !window.electronAPI.studentsFindNameDuplicates) return [];
    const res = await window.electronAPI.studentsFindNameDuplicates(year);
    return (res && res.success && Array.isArray(res.data)) ? res.data : [];
  } catch (e){
    console.error('[name-dup] student fetch error:', e);
    return [];
  }
}
async function _fetchStaffGroups(year){
  try {
    if (!window.electronAPI || !window.electronAPI.staffFindNameDuplicates) return [];
    const res = await window.electronAPI.staffFindNameDuplicates(year);
    return (res && res.success && Array.isArray(res.data)) ? res.data : [];
  } catch (e){
    console.error('[name-dup] staff fetch error:', e);
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────
   미해결 그룹 카운트 — 인원관리 진입 시 ⚠ 배지 노출용.
   ───────────────────────────────────────────────────────────── */
export async function getNameDupGroupCount(year){
  const yr = String(year || _academicYear());
  const stu = await _fetchStudentGroups(yr);
  const stf = await _fetchStaffGroups(yr);
  return (stu.length + stf.length);
}

/* ─────────────────────────────────────────────────────────────
   특정 학생/교직원이 동명이인 미해결 그룹에 속하는지 확인 —
   보건실 방문 시 증상 팝업 직전 confirm 트리거에 사용.
   ───────────────────────────────────────────────────────────── */
export async function isPersonInNameDupGroup(uid){
  if (!uid) return false;
  const yr = String(_academicYear());
  const groups = (await _fetchStudentGroups(yr)).concat(await _fetchStaffGroups(yr));
  return groups.some(g => (g.currentMembers||[]).some(m => String(m.uid) === String(uid)));
}

/* ─────────────────────────────────────────────────────────────
   모달 렌더링
   ───────────────────────────────────────────────────────────── */
function _renderModal(){
  if (!_state) return;
  const old = document.getElementById('ndmModal');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'ndmModal';
  ov.className = 'modal-overlay show';
  ov.style.background = 'rgba(0,0,0,0.30)';
  ov.style.display = 'flex';
  ov.style.alignItems = 'center';
  ov.style.justifyContent = 'center';
  ov.style.zIndex = '12000';
  ov.innerHTML = _buildHtml();
  document.body.appendChild(ov);
  _bindEvents(ov);
  _renderBody();
}

function _buildHtml(){
  const st = _state;
  const g = st.groups[st.idx];
  const total = st.groups.length;
  const pct = ((st.idx+1) / total * 100).toFixed(1);
  let h = '<div class="modal-content ndm-box" id="ndmBox" style="width:920px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--card);border:1px solid rgba(0,0,0,0.08);box-shadow:0 28px 60px rgba(0,0,0,0.32);position:relative">';
  /* 헤더 (회색 + 드래그) */
  h += '<div class="ndm-head" id="ndmDragHandle" style="padding:12px 16px;display:flex;gap:10px;align-items:center;background:#eef2f6;border-bottom:1px solid var(--bdr);cursor:grab;user-select:none">'
    + '<span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0.5"><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span><span style="width:14px;height:2px;background:var(--t3);border-radius:1px"></span></span>'
    + '<span style="font-size:13px;font-weight:700;color:var(--t1);flex:1">🔀 동명이인 매칭 — 작년 기록 연결</span>'
    + '<span id="ndmCounter" style="font-size:10.5px;padding:3px 9px;background:rgba(245,158,11,0.12);color:#b45309;border-radius:10px;font-weight:700">'+(st.idx+1)+' / '+total+'</span>'
    + '</div>';
  /* 진행 막대 */
  h += '<div style="height:3px;background:var(--bdrl);position:relative;overflow:hidden"><div id="ndmProgress" style="height:100%;background:#0891b2;width:'+pct+'%;transition:width .25s ease"></div></div>';
  /* 현재 그룹 카드 + 우상단 주황 메시지 버튼 */
  h += '<div style="padding:12px 16px;display:flex;align-items:flex-start;gap:12px;border-bottom:1px solid var(--bdrl);background:rgba(245,158,11,0.04)">'
    + '<div id="ndmHeadInfo" style="flex:1"></div>'
    + '<button id="ndmMsgBtn" class="ndm-msg-btn" style="padding:9px 16px;font-size:11.5px;font-weight:800;background:#d97706;color:#fff;border:none;border-radius:9px;cursor:pointer;box-shadow:0 3px 9px rgba(234,88,12,0.30);white-space:nowrap;align-self:flex-start">📋 담임 선생님에게 물어보는 메시지 복사하기</button>'
    + '</div>';
  /* 네비 + 본문 */
  h += '<div style="padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bdrl)">'
    + '<button class="ndm-nav" data-ndm-nav="prev" style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer">◀</button>'
    + '<div style="flex:1;font-size:11px;color:var(--t2)">작년 후보 카드를 클릭하면 매칭 완료 + 작년 보건일지가 연결됩니다</div>'
    + '<button class="ndm-nav" data-ndm-nav="next" style="width:34px;height:34px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);font-size:14px;font-weight:700;cursor:pointer">▶</button>'
    + '</div>';
  h += '<div id="ndmBody" style="flex:1;padding:16px;overflow-y:auto"></div>';
  /* 푸터 */
  h += '<div style="padding:9px 16px;border-top:1px solid var(--bdrl);display:flex;align-items:center;gap:10px;background:#fafbfc">'
    + '<span style="font-size:9.5px;color:var(--t3);flex:1">← / →: 이전·다음   Esc: 닫기   제목 행 드래그로 창 이동</span>'
    + '<button class="ndm-skip" style="padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--bdr);background:#fff;color:var(--t2)">⏭ 건너뛰기</button>'
    + '</div>';
  h += '</div>';
  return h;
}

function _renderBody(){
  const ov = document.getElementById('ndmModal');
  if (!ov || !_state) return;
  const g = _state.groups[_state.idx];
  /* 상단 헤드 정보 */
  const isStaff = g.type === 'staff';
  const headEl = ov.querySelector('#ndmHeadInfo');
  if (headEl){
    let info = '';
    if (isStaff){
      info = '<div style="font-size:14px;font-weight:800;color:var(--t1)">'+escHtml(g.name)+' <span style="font-size:11px;color:var(--t2);font-weight:600">('+(g.gender==='M'?'남':g.gender==='F'?'여':escHtml(g.gender||''))+')</span></div>'
        + '<div style="font-size:11px;color:var(--t2);margin-top:3px">현재 재직 교직원 동명이인 <b style="color:#dc2626">'+g.currentMembers.length+'명</b> — 작년에 같은 이름 교직원과 동일 인물 매칭</div>';
    } else {
      const lv = (_LV_SHORT[g.level] || g.level || '');
      info = '<div style="font-size:14px;font-weight:800;color:var(--t1)">'+escHtml(g.name)+' <span style="font-size:11px;color:var(--t2);font-weight:600">('+(g.gender==='M'?'남':g.gender==='F'?'여':escHtml(g.gender||''))+')</span></div>'
        + '<div style="font-size:11px;color:var(--t2);margin-top:3px">'+(lv?'<b>'+escHtml(lv)+'</b> ':'')+g.grade+'학년 동명이인 <b style="color:#dc2626">'+g.currentMembers.length+'명</b> — 작년 '+g.prevGrade+'학년 후보와 동일 인물 매칭</div>';
    }
    headEl.innerHTML = info;
  }
  /* 카운터/진행 */
  const counter = ov.querySelector('#ndmCounter');
  if (counter) counter.textContent = (_state.idx+1)+' / '+_state.groups.length;
  const prog = ov.querySelector('#ndmProgress');
  if (prog) prog.style.width = ((_state.idx+1)/_state.groups.length*100).toFixed(1)+'%';
  /* 본문 — 그룹 내 currentMember 별 sub-card + 그 옆에 prevCandidates 그리드 */
  const body = ov.querySelector('#ndmBody');
  if (!body) return;
  let bh = '';
  g.currentMembers.forEach(function(cur, ci){
    bh += '<div data-ndm-cur="'+escHtml(cur.uid)+'" style="margin-bottom:14px;padding:12px;background:var(--card);border:1.5px solid rgba(245,158,11,0.30);border-radius:12px;box-shadow:0 1px 4px rgba(245,158,11,0.05)">';
    bh += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
    bh += '<span style="font-size:10.5px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,0.12);padding:3px 9px;border-radius:9px">올해 #'+(ci+1)+'</span>';
    if (isStaff){
      bh += '<span style="font-size:12.5px;font-weight:700;color:var(--t1)">'+escHtml(cur.position||'(직위 미입력)')+' '+escHtml(cur.name)+'</span>';
    } else {
      const lvS = _LV_SHORT[cur.level] || cur.level || '';
      const dept = cur.department ? (escHtml(cur.department)+' ') : '';
      bh += '<span style="font-size:12.5px;font-weight:700;color:var(--t1)">'+(lvS?'<span style="color:var(--t3);font-weight:600">'+escHtml(lvS)+'</span> ':'')+dept+cur.grade+'학년 '+cur.class_num+'반 '+cur.student_num+'번 '+escHtml(cur.name)+'</span>';
    }
    bh += '<span style="flex:1"></span>';
    bh += '<span style="font-size:9.5px;color:var(--t3)">uid: '+escHtml(String(cur.uid))+'</span>';
    bh += '</div>';
    /* 작년 후보 카드 그리드 */
    bh += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">';
    g.prevCandidates.forEach(function(prev){
      const lvS = _LV_SHORT[prev.level] || prev.level || '';
      bh += '<div class="ndm-prev-card" data-ndm-cur="'+escHtml(cur.uid)+'" data-ndm-prev="'+escHtml(prev.uid)+'" style="padding:10px 12px;border:1.5px solid var(--bdr);border-radius:10px;background:var(--card);cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s">';
      /* 후보 연도 라벨 — 교직원은 uid 당 단일 행이라 재직 연도가 갱신되고, 비활성 처리된 올해 행도
         후보로 잡힐 수 있다. 실제 직전 학년도일 때만 '작년' 이라고 부른다 (오표기 수정 2026-08-26). */
      const _pyr = String(prev.school_year || '');
      const _yrLabel = (_pyr && _pyr === String(_academicYear() - 1))
        ? ('작년 (' + escHtml(_pyr) + '학년도)')
        : (_pyr ? (escHtml(_pyr) + '학년도 기록') : '이전 기록');
      bh += '<div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px">'+_yrLabel+'</div>';
      if (isStaff){
        bh += '<div style="font-size:12.5px;font-weight:700;color:var(--t1);margin-bottom:3px">'+escHtml(prev.position||'(직위 미입력)')+' '+escHtml(prev.name)+'</div>';
      } else {
        const dept = prev.department ? (escHtml(prev.department)+' ') : '';
        bh += '<div style="font-size:12.5px;font-weight:700;color:var(--t1);margin-bottom:3px">'+(lvS?'<span style="color:var(--t3);font-weight:600">'+escHtml(lvS)+'</span> ':'')+dept+prev.grade+'학년 '+prev.class_num+'반 '+prev.student_num+'번</div>';
      }
      bh += '<div style="font-size:10px;color:var(--t2)">방문 기록 <b style="color:'+(prev.visit_count>0?'#16a34a':'var(--t3)')+'">'+prev.visit_count+'건</b></div>';
      bh += '</div>';
    });
    bh += '</div>';
    bh += '</div>';
  });
  body.innerHTML = bh;
  /* 클릭 핸들러 */
  body.querySelectorAll('.ndm-prev-card').forEach(function(card){
    card.addEventListener('click', function(){
      const cur = this.dataset.ndmCur;
      const prev = this.dataset.ndmPrev;
      _resolveMatch(cur, prev);
    });
    card.addEventListener('mouseover', function(){
      this.style.borderColor = 'var(--cyan)';
      this.style.boxShadow = '0 4px 12px rgba(6,182,212,0.18)';
      this.style.transform = 'translateY(-1px)';
    });
    card.addEventListener('mouseout', function(){
      this.style.borderColor = 'var(--bdr)';
      this.style.boxShadow = '';
      this.style.transform = '';
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   매칭 실행 — IPC 호출 + S.people 재로드 + 그룹 갱신.
   자동 캐스케이드: 남은 currentMembers 1명 + 남은 candidates 1명 인 그룹은 자동 처리 (서버 재호출).
   ───────────────────────────────────────────────────────────── */
async function _resolveMatch(currentUid, prevUid){
  const g = _state.groups[_state.idx];
  const isStaff = g.type === 'staff';
  const api = isStaff ? (window.electronAPI && window.electronAPI.staffResolveNameDuplicate)
                       : (window.electronAPI && window.electronAPI.studentsResolveNameDuplicate);
  if (!api){ alert('이 기능은 새 버전에서 사용 가능합니다.'); return; }
  try {
    const res = await api(currentUid, prevUid);
    if (!res || !res.success){
      alert('매칭 실패: '+((res && res.error)||'알 수 없음'));
      return;
    }
  } catch (e){ alert('오류: '+e.message); return; }
  /* 재로드 + 그룹 새로 가져오기 — 매칭 시 daily_records.person_uid 도 prev uid 로 갱신되므로
   *  S.records 역시 새로 가져와야 기존 보건일지의 학생 매핑이 즉시 올바르게 표시됨. */
  try { if (typeof _reloadStudentsFromDB === 'function') await _reloadStudentsFromDB(); } catch(_){}
  try {
    if(window.electronAPI && window.electronAPI.recordsGetDaily){
      const yr2 = String(_academicYear());
      const dRes = await window.electronAPI.recordsGetDaily(yr2);
      if(dRes && dRes.success && Array.isArray(dRes.data)){
        S.records = dRes.data.map(function(r){
          if(r.personUid !== undefined && r.studentId === undefined) r.studentId = r.personUid;
          return r;
        });
      }
    }
  } catch(_){}
  try { bus.emit('render:daily'); bus.emit('render:sidebar'); bus.emit('render:dashboard'); bus.emit('render:calendar'); } catch(_){}
  const yr = String(_academicYear());
  const stu = await _fetchStudentGroups(yr);
  const stf = await _fetchStaffGroups(yr);
  let groups = stu.concat(stf);
  /* 자동 캐스케이드 — 그룹 안의 currentMembers 와 prevCandidates 가 둘 다 1개 남으면 자동 매칭 */
  let cascadeCount = 0;
  let didCascade = true;
  while (didCascade){
    didCascade = false;
    for (const cg of groups){
      if (cg.currentMembers.length === 1 && cg.prevCandidates.length === 1){
        const cgIsStaff = cg.type === 'staff';
        const cgApi = cgIsStaff ? window.electronAPI.staffResolveNameDuplicate : window.electronAPI.studentsResolveNameDuplicate;
        try {
          const r2 = await cgApi(cg.currentMembers[0].uid, cg.prevCandidates[0].uid);
          if (r2 && r2.success){
            cascadeCount++;
            didCascade = true;
          }
        } catch(e){ console.error('[name-dup cascade]', e); }
      }
    }
    if (didCascade){
      try { if (typeof _reloadStudentsFromDB === 'function') await _reloadStudentsFromDB(); } catch(_){}
      const stu2 = await _fetchStudentGroups(yr);
      const stf2 = await _fetchStaffGroups(yr);
      groups = stu2.concat(stf2);
    }
  }
  if (cascadeCount > 0){
    try { dailyShowToast('✅ 매칭 완료 — 동명이인 '+(1+cascadeCount)+'건 처리됨'); } catch(_){}
  } else {
    try { dailyShowToast('✅ 매칭 완료'); } catch(_){}
  }
  /* 모달 갱신 */
  if (!groups.length){
    _closeModal();
    if (_state && _state.opts && typeof _state.opts.onDone === 'function'){
      _state.opts.onDone({ resolved: 1+cascadeCount, remaining: 0 });
    }
    return;
  }
  _state.groups = groups;
  if (_state.idx >= groups.length) _state.idx = groups.length - 1;
  _renderBody();
  /* 카운터/진행 갱신 */
  const ov = document.getElementById('ndmModal');
  if (ov){
    const c = ov.querySelector('#ndmCounter'); if (c) c.textContent = (_state.idx+1)+' / '+groups.length;
    const p = ov.querySelector('#ndmProgress'); if (p) p.style.width = ((_state.idx+1)/groups.length*100).toFixed(1)+'%';
  }
}

/* ─────────────────────────────────────────────────────────────
   담임 선생님께 메시지 팝업 — 우상단 주황 버튼 클릭 시.
   ───────────────────────────────────────────────────────────── */
function _openMessagePopup(){
  if (!_state) return;
  const g = _state.groups[_state.idx];
  const isStaff = g.type === 'staff';
  const name = g.name || '';
  const cnt = (g.currentMembers || []).length;
  let body = '';
  if (isStaff){
    body = '안녕하세요 선생님, 보건교사입니다.\n'
      + name+' 선생님과 같은 이름의 교직원이 ' + _koNum(cnt) + ' 명이라서 여쭙습니다.\n'
      + '혹시 작년에 함께 근무하셨던 ' + name + ' 선생님이 누구이신지 알려주시면 감사하겠습니다^^';
  } else {
    const prevGrade = g.prevGrade;
    body = '안녕하세요 선생님, 보건교사입니다.\n'
      + name + ' 학생의 이름이 같은 학년에 ' + _koNum(cnt) + ' 명이라서 여쭙습니다.\n'
      + '선생님 반의 ' + name + ' 학생은 작년도에 ' + prevGrade + '학년 몇 반이었나요? 알려주시면 감사하겠습니다^^';
  }
  const old = document.getElementById('ndmMsgPopup');
  if (old) old.remove();
  /* 침상 이용 등록 의 "📋 담임/교과 교사 전송 메시지" 팝업과 동일 GUI 패턴 통일.
   *  회색 헤더(bg2) + ✕ 닫기 + 작은 안내 텍스트 + textarea + 단일 [📋 클립보드에 복사] 버튼 */
  const ov = document.createElement('div');
  ov.className = 'modal-overlay show';
  ov.id = 'ndmMsgPopup';
  ov.style.zIndex = '13000';
  ov.innerHTML = ''
    + '<div class="modal-content" style="width:520px;max-width:94vw;padding:0">'
    +   '<div style="padding:14px 20px;background:rgba(6,182,212,0.10);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center">'
    +     '<span style="font-size:14px;font-weight:800;color:var(--t1)">📋 담임 선생님께 보낼 메시지</span>'
    +     '<span id="ndmMsgClose" style="cursor:pointer;font-size:18px;color:var(--t3);padding:0 6px">✕</span>'
    +   '</div>'
    +   '<div style="padding:16px 20px">'
    +     '<div style="font-size:11px;color:var(--t3);margin-bottom:6px">아래 메시지를 복사해서 담임 선생님께 전달하세요. 필요 시 수정 가능합니다.</div>'
    +     '<textarea id="ndmMsgText" style="width:100%;min-height:160px;font-size:12px;padding:12px;border:1px solid var(--bdr);border-radius:8px;background:var(--card);color:var(--t1);resize:vertical;line-height:1.7;box-sizing:border-box;outline:none;font-family:var(--f)">'+escHtml(body)+'</textarea>'
    +     '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">'
    +       '<button id="ndmMsgCopy" class="btn btn-primary btn-sm" style="font-size:11px">📋 클립보드에 복사</button>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(ov);
  /* 오버레이 바깥 클릭 = 닫기 (침상 팝업과 동일) */
  ov.addEventListener('mousedown', function(e){ if (e.target === ov) ov.remove(); });
  document.getElementById('ndmMsgClose').addEventListener('click', function(){ ov.remove(); });
  document.getElementById('ndmMsgCopy').addEventListener('click', function(){
    const t = document.getElementById('ndmMsgText');
    const finalText = t ? t.value : body;
    _copyToClipboard(finalText);
    ov.remove();
  });
  /* ESC 닫기 */
  const _onKey = function(e){
    if (e.key === 'Escape'){ ov.remove(); document.removeEventListener('keydown', _onKey); }
  };
  document.addEventListener('keydown', _onKey);
}

function _copyToClipboard(text){
  const fallbackCopy = function(){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(_){}
    document.body.removeChild(ta);
  };
  /* 토스트는 증상 선택 및 처치에서 쓰는 흰 카드 + 시안 테두리 중앙 토스트(dailyShowToast)로 통일. */
  const _onSuccess = function(){
    try { dailyShowToast('클립보드에 복사되었습니다.'); } catch(_){}
  };
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(_onSuccess).catch(function(){
      fallbackCopy(); _onSuccess();
    });
  } else {
    fallbackCopy(); _onSuccess();
  }
}

/* ─────────────────────────────────────────────────────────────
   이벤트 바인딩 + 드래그
   ───────────────────────────────────────────────────────────── */
function _bindEvents(ov){
  /* 키보드 */
  _keyHandler = function(e){
    if (!_state) return;
    if (e.key === 'Escape'){ e.preventDefault(); _closeModal(); }
    else if (e.key === 'ArrowLeft'){ _navigate(-1); }
    else if (e.key === 'ArrowRight'){ _navigate(1); }
  };
  document.addEventListener('keydown', _keyHandler);
  /* 네비 */
  ov.querySelectorAll('[data-ndm-nav]').forEach(function(b){
    b.addEventListener('click', function(){
      const dir = this.dataset.ndmNav;
      _navigate(dir === 'prev' ? -1 : 1);
    });
  });
  /* 메시지 버튼 */
  const msgBtn = ov.querySelector('#ndmMsgBtn');
  if (msgBtn) msgBtn.addEventListener('click', _openMessagePopup);
  /* 건너뛰기 */
  const skip = ov.querySelector('.ndm-skip');
  if (skip) skip.addEventListener('click', function(){ _navigate(1, true); });
  /* 드래그 */
  _bindDrag(ov);
}

function _navigate(delta, allowEnd){
  if (!_state) return;
  const next = _state.idx + delta;
  if (next < 0) return;
  if (next >= _state.groups.length){
    if (allowEnd){ _closeModal(); }
    return;
  }
  _state.idx = next;
  _renderBody();
  const ov = document.getElementById('ndmModal');
  if (ov){
    const c = ov.querySelector('#ndmCounter'); if (c) c.textContent = (_state.idx+1)+' / '+_state.groups.length;
    const p = ov.querySelector('#ndmProgress'); if (p) p.style.width = ((_state.idx+1)/_state.groups.length*100).toFixed(1)+'%';
  }
}

function _bindDrag(ov){
  const handle = document.getElementById('ndmDragHandle');
  const box = document.getElementById('ndmBox');
  if (!handle || !box) return;
  let dragging = false, sx=0, sy=0, mx=0, my=0, initialized = false;
  function initPos(){
    if (initialized) return;
    const rect = box.getBoundingClientRect();
    box.style.position = 'fixed';
    box.style.left = rect.left+'px';
    box.style.top = rect.top+'px';
    box.style.margin = '0';
    initialized = true;
  }
  handle.addEventListener('mousedown', function(e){
    initPos();
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = box.getBoundingClientRect();
    mx = r.left; my = r.top;
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    box.style.left = (mx + dx)+'px';
    box.style.top = (my + dy)+'px';
  });
  document.addEventListener('mouseup', function(){
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
  });
}

function _closeModal(){
  const ov = document.getElementById('ndmModal');
  if (ov) ov.remove();
  if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
  _keyHandler = null;
  /* 미해결 그룹이 남은 상태에서 사용자가 닫기(ESC·바깥 클릭·건너뛰기 끝) — 권장 메시지 토스트.
   *  증상 선택 및 처치 GUI 와 동일한 흰 카드 + 시안 테두리 중앙 토스트.
   *  인원 데이터 관리 화면에 ⚠ 알림 카드가 그대로 남아 있어 언제든 다시 진입 가능. */
  const remaining = (_state && _state.groups) ? _state.groups.length : 0;
  if (remaining > 0){
    try {
      dailyShowToast('⚠ ' + remaining + '건의 동명이인 매칭이 남아있습니다.\n매칭 작업은 추후에 할 수 있으나 가급적 빨리 완료하는 것을 권합니다.');
    } catch(_){}
  }
  if (_state && _state.opts && typeof _state.opts.onDone === 'function'){
    _state.opts.onDone({ resolved: 0, remaining: remaining });
  }
  _state = null;
}

function _injectStyles(){
  if (document.getElementById('ndmStyles')) return;
  const s = document.createElement('style');
  s.id = 'ndmStyles';
  s.textContent = ''
    + '@keyframes ndmIn{0%{opacity:0;transform:scale(0.94) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}'
    + '#ndmModal .modal-content.ndm-box{animation:ndmIn .22s cubic-bezier(0.4,0,0.2,1)}'
    + '#ndmModal .ndm-msg-btn:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 5px 14px rgba(234,88,12,0.42)}'
    + '#ndmModal .ndm-msg-btn:active{transform:translateY(0);box-shadow:0 2px 6px rgba(234,88,12,0.30)}'
    + '#ndmModal .ndm-head:active{cursor:grabbing}'
    + '#ndmModal .ndm-nav:hover{background:var(--hover)}'
    + '#ndmMsgPopup .modal-content{animation:ndmIn .18s cubic-bezier(0.4,0,0.2,1)}';
  document.head.appendChild(s);
}
