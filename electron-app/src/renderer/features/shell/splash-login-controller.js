/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { escHtml, closeModalGracefully } from '../../core/helpers.js';
import { S } from '../../core/app-state.js';
import { bus } from '../../core/event-bus.js';
import { maybeSendHeartbeat } from '../../core/heartbeat.js';
import { _dailyResetEntryOverlay } from '../daily/daily-view.js';
import { showOrangefarmNotice } from './orangefarm-notice.js';

/* ═══ 사용자 선택 로그인 ═══ */
S._currentUser = null;

export function showLoginScreen() {
  const s = document.getElementById('splash');
  const center = document.getElementById('spCenter');
  const left = document.getElementById('spLeft');
  const right = document.getElementById('spRight');
  if (center) center.style.display = 'none';
  if (s) { s.classList.add('phase2'); s.style.transition = 'none'; s.style.opacity = '1'; s.style.display = 'flex'; }
  if (left) left.style.display = 'flex';
  if (right) right.style.display = 'flex';
  document.getElementById('spLogin').classList.add('show');
  document.getElementById('spSetup').classList.remove('show');
  loadUserList();
}

function hideSplash() {
  localStorage.setItem('ec_session', 'active');
  const s = document.getElementById('splash');
  if (s) { s.style.opacity = '0'; s.style.transition = 'opacity 0.4s ease'; setTimeout(function () { s.style.display = 'none'; }, 400); }
  document.body.classList.add('loaded');
  /* 메인 노출 '즉시' 보건일지 안내 오버레이부터 띄움 — 표·스크롤이 잠깐 보이던 잔상 제거.
   *  (예전엔 아래 +300ms 에서 띄워 그 사이 표가 노출됐음. switchView 안 거치는 로그인 직행 경로.)
   *  아래 setTimeout 의 render:daily 가 이어받아 1초 타이머로 자연스럽게 닫음. (2026-06-09) */
  if (typeof _dailyResetEntryOverlay === 'function') _dailyResetEntryOverlay();
  if (typeof fetchWeather === 'function') { fetchWeather(); setInterval(fetchWeather, 1800000); }
  if (typeof showStoryNewBadge === 'function') showStoryNewBadge('1.0.0');
  setTimeout(function () { if (typeof renderHeader === 'function') renderHeader(); }, 500);
  /* 로그인 후 데이터가 이미 로드된 경우를 대비해 명시적 렌더링 */
  setTimeout(function () {
    bus.emit('render:calendar');
    bus.emit('render:daily');
    bus.emit('render:sidebar');
    bus.emit('render:dashboard');
  }, 300);
  /* 오렌지팜 안내 팝업 — 메인 진입 후 1.5초, 소식별 1회(표시 즉시 자동 기록 → 정확히 1회만). (사용자 요청 2026-06-10)
     v1.0.11 소식으로 재가동 (사용자 요청 2026-06-16, NOTICE.id = v1011-...). 다음 릴리스 때 NOTICE.id 만 갱신하면 다시 1회 표시. */
  /* 이번 빌드에서는 안내 팝업을 띄우지 않음 (사용자 요청 2026-06-24). 다시 켜려면 아래 한 줄의 주석을 해제. */
  /* setTimeout(function(){ try{ showOrangefarmNotice(); }catch(_){} }, 1500); */
}

/* ── 스플래시 → 로그인 전환 ── */
(function () {
  const center = document.getElementById('spCenter');
  const left = document.getElementById('spLeft');
  const right = document.getElementById('spRight');
  const splash = document.getElementById('splash');
  const isElectron = !!(window.electronAPI);
  /* Electron 은 별도 투명 스플래시 창이 로고를 담당 → health_diary 진입 즉시 로그인 화면으로(0). 웹은 3초 로고. */
  const splashDelay = isElectron ? 0 : 3000;
  setTimeout(function () {
    if (center) { center.style.transition = 'opacity 0.5s ease'; center.style.opacity = '0'; }
    setTimeout(function () {
      if (center) center.style.display = 'none';
      if (splash) splash.classList.add('phase2');
      if (left) left.style.display = 'flex';
      if (right) right.style.display = 'flex';
      document.getElementById('spLogin').classList.add('show');
      loadUserList();
      /* 로그인 화면이 실제로 그려진 뒤(rAF 2회) 메인 표시 신호 → 메인이 '로그인 화면 상태'로 나타나
         흰 화면(빈 #splash) 단계가 보이지 않는다. (2026-06-24) */
      if (isElectron && window.electronAPI && window.electronAPI.splashReady) {
        requestAnimationFrame(function () { requestAnimationFrame(function () { try { window.electronAPI.splashReady(); } catch (_) { } }); });
      }
    }, 500);   /* 페이드아웃(0.5s) 끝난 뒤 전환 — Electron 도 동일 적용 */
  }, splashDelay);
})();

/* ── 사용자 0명일 때: 항상 로그인 화면에서 등록 유도 ── */
function _renderEmptyUserList(isFirstRun, container, title, msg) {
  title.textContent = '사용자를 등록해 주세요';
  container.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--t3);font-size:12px">등록된 사용자가 없습니다.<br>아래 "사용자 등록" 버튼을 눌러 주세요.</div>';
  if (msg) msg.textContent = '';
}

/* ── 사용자 목록 로드 & 렌더링 ── */
function loadUserList() {
  const container = document.getElementById('spUserList');
  const msg = document.getElementById('spPinMsg');
  const title = document.getElementById('spLoginTitle');
  if (!container) return;

  if (!window.electronAPI || !window.electronAPI.userGetActive) {
    /* electronAPI 없는 환경 (웹 테스트 등) — 바로 진입 */
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">Electron 환경이 아닙니다.</div>';
    setTimeout(hideSplash, 1000);
    return;
  }

  window.electronAPI.userGetActive().then(function (res) {
    if (!res || !res.success) { container.innerHTML = ''; return; }
    const users = res.data || [];

    if (users.length === 0) {
      _renderEmptyUserList(true, container, title, msg);
      return;
    }

    title.textContent = '사용자를 선택하세요';
    if (msg) msg.textContent = '';
    /* 아바타 로드 후 렌더 */
    const avatarPromises = users.map(function (u) {
      if (!window.electronAPI || !window.electronAPI.dbGet) return Promise.resolve(null);
      return window.electronAPI.dbGet('common', 'user_avatar_' + u.id).then(function (r) { return r && r.success ? r.data : null; }).catch(function () { return null; });
    });
    Promise.all(avatarPromises).then(function (avatars) {
      container.innerHTML = users.map(function (u, i) {
        const initials = (u.name || '?').substring(0, 1);
        const av = avatars[i];
        const circleContent = av
          ? '<img src="' + av + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
          : initials;
        return '<div class="sp-user-card" data-uid="' + u.id + '" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border:1.5px solid var(--bdr);border-radius:10px;cursor:pointer;transition:all .15s">'
          + '<div class="sp-avatar" data-uid="' + u.id + '" style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#06b6d4,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden;cursor:pointer">' + circleContent + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;font-weight:700;color:var(--t1)">' + escHtml(u.name) + '</div>'
          + '<div style="font-size:10px;color:var(--t3);margin-top:2px">' + escHtml(u.position || '보건교사') + (u.school_name ? ' · ' + escHtml(u.school_name) : '') + '</div>'
          + '</div>'
          + '<div style="font-size:16px;color:var(--t3)">→</div>'
          + '</div>';
      }).join('');
      /* addEventListener for user cards */
      container.querySelectorAll('.sp-user-card').forEach(function (card) {
        const uid = parseInt(card.getAttribute('data-uid'), 10);
        card.addEventListener('click', function () { _loginAsUser(uid); });
        card.addEventListener('mouseenter', function () { this.style.borderColor = 'var(--cyan)'; this.style.background = 'rgba(6,182,212,0.06)'; });
        card.addEventListener('mouseleave', function () { this.style.borderColor = 'var(--bdr)'; this.style.background = ''; });
        const avatar = card.querySelector('.sp-avatar');
        if (avatar) avatar.addEventListener('click', function (e) { e.stopPropagation(); _showAvatarPopup(this, uid); });
      });
    });
  }).catch(function (err) {
    console.error('[LOGIN] 사용자 목록 로드 실패:', err);
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;font-size:11px">사용자 목록을 불러올 수 없습니다.</div>';
  });
}

/* ── 소속유형 (5종: elementary, middle, high, kindergarten, special) ── */
function _levelGroup(level) { return level || 'elementary'; }
const _levelNames = { elementary: '초등학교', middle: '중학교', high: '고등학교', kindergarten: '유치원', special: '특수학교' };

/* ── 사용자 선택 → 로그인 ── */
function _loginAsUser(userId) {
  if (!window.electronAPI) return;
  window.electronAPI.userGetById(userId).then(function (res) {
    if (!res || !res.success || !res.data) { alert('사용자 정보를 찾을 수 없습니다.'); return; }
    const user = res.data;

    S._currentUser = { id: user.id, name: user.name, position: user.position, school_name: user.school_name, school_level: user.school_level, edu_office: user.edu_office };
    /* _userProfile 동기화 — 설정 탭에서 참조 */
    S._userProfile = S._userProfile || {};
    S._userProfile.name = user.name;
    S._userProfile.position = user.position || '';
    S._userProfile.school = user.school_name || '';
    S._userProfile.eduOffice = user.edu_office || '';
    try { localStorage.setItem('ec_user', JSON.stringify(S._userProfile)); } catch (e) { }
    /* 개인 키 격리 — 이전 사용자의 stale localStorage 제거 (vp 도장·서명 등).
     * 다중 사용자 협업 환경에서 다른 보건교사가 같은 브라우저로 로그인 했을 때
     * 이전 사용자의 도장이 잠시 보이는 것을 막는다.
     * 직후 data-loader 가 현재 사용자의 suffixed 키로부터 다시 채움. */
    try {
      ['ec_vp_stamps', 'ec_vp_signs', 'ec_vp_lastSlot_stamp', 'ec_vp_lastSlot_sign'].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (_) { }
      });
    } catch (_) { }
    /* 헤더 1층 phase 0 (교육청·학교·직위·이름) 즉시 갱신 — 첫 설치 후 "보건교사" 만 단독 표시되던 버그 fix */
    try { bus.emit('header:refresh-user'); } catch (e) { }
    if (typeof S.settings !== 'undefined') {
      S.settings.schoolName = user.school_name || S.settings.schoolName;
      S.settings.nurse1 = user.name;
      S.settings.schoolLevel = user.school_level || S.settings.schoolLevel;
      S.settings.eduOffice = user.edu_office || S.settings.eduOffice;
      try {
        localStorage.setItem('ec_settings', JSON.stringify(S.settings));
        if (window.electronAPI && window.electronAPI.dbSet) window.electronAPI.dbSet('common', 'settings', S.settings);
      } catch (e) { }
    }
    window.electronAPI.userSetCurrent(userId).then(function () {
      /* userSetCurrent 가 main/server 측 마이그레이션을 트리거한 직후 — 사용자별 suffixed 키로
       * 개인 데이터(vp_stamps 등) 가 자리잡았다. localStorage 를 그 데이터로 다시 채운다. */
      try {
        import('../../core/data-loader.js').then(function (m) {
          if (m && typeof m.reloadPersonalKeysFromDB === 'function') m.reloadPersonalKeysFromDB();
        });
      } catch (e) { }
    }).catch(function () { });
    /* 동료 협업 세션에 학교·직위·이름 등록 → 상대방 전광판에 표시됨 */
    try {
      import('../../core/data-loader.js').then(function (m) {
        if (m && typeof m.registerCollabIdentity === 'function') m.registerCollabIdentity();
      });
    } catch (e) { }
    /* 기존 레코드의 nurse_name이 직위(보건교사 등)로 저장된 경우 실제 이름으로 일괄 변경 */
    if (user.name && user.position && user.name !== user.position && window.electronAPI.recordsDailyFixNurse) {
      window.electronAPI.recordsDailyFixNurse(user.position, user.name).catch(function () { });
    }
    /* 온보딩 마법사 제거됨 — 최초 설치자는 설정/인원 데이터 관리에서 직접 세팅 */
    hideSplash();
    /* 1.0.4 학교 정보 heartbeat — 첫 부팅 시 1회만, 실패해도 사용자 영향 X. */
    try { maybeSendHeartbeat(); } catch (_) { }
    /* 🍚 급식 자동 팝업 스케줄러 시작 (설정 ON 일 때만 실제 동작) — 2026-06-17 */
    try { import('../../core/school-meal.js').then(function (m) { if (m.maybeStartMealScheduler) m.maybeStartMealScheduler(); }); } catch (_) { }
    /* 📅 학사일정 자동 팝업 스케줄러 시작 (설정 ON 일 때만) — 2026-06-17 */
    try { import('../../core/academic-schedule.js').then(function (m) { if (m.maybeStartAcademicScheduler) m.maybeStartAcademicScheduler(); }); } catch (_) { }
    /* 📚 수업 자동 팝업 스케줄러 시작 (설정 ON 일 때만) — 2026-06-17 */
    try { import('../../core/class-popup.js').then(function (m) { if (m.maybeStartClassScheduler) m.maybeStartClassScheduler(); }); } catch (_) { }
  }).catch(function (err) { alert('로그인 실패: ' + err.message); });
}

localStorage.setItem('ec_usage_mode', 'full');

/* ── 아바타 팝업 + 사진 변경 ── */
let _avatarPop = null;
function _closeAvatarPop() { if (_avatarPop) { _avatarPop.remove(); _avatarPop = null; } }
function _showAvatarPopup(circleEl, userId) {
  _closeAvatarPop();
  const rect = circleEl.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'ems-mini-popup';
  pop.style.zIndex = '10001';
  pop.innerHTML = '<div class="ems-msg-link" style="cursor:pointer">📷 사진 변경</div>';
  pop.querySelector('.ems-msg-link').addEventListener('click', function (e) { e.stopPropagation(); _changeAvatar(userId); });
  pop.style.left = (rect.right + 8) + 'px';
  pop.style.top = rect.top + 'px';
  pop.style.visibility = 'hidden';
  document.body.appendChild(pop);
  /* 화면 밖 방지 */
  if (rect.right + 8 + pop.offsetWidth > window.innerWidth - 8) pop.style.left = Math.max(4, rect.left - pop.offsetWidth - 8) + 'px';
  pop.style.visibility = '';
  _avatarPop = pop;
  setTimeout(function () {
    document.addEventListener('click', function _avOutClick(e) {
      if (_avatarPop && !_avatarPop.contains(e.target)) { _closeAvatarPop(); document.removeEventListener('click', _avOutClick, true); }
    }, true);
  }, 0);
}
function _changeAvatar(userId) {
  _closeAvatarPop();
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const img = new Image();
      img.onload = function () {
        /* 1:1 정사각형 중앙 크롭 후 128x128 리사이즈 */
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        /* DB에 저장 */
        if (window.electronAPI && window.electronAPI.dbSet) {
          window.electronAPI.dbSet('common', 'user_avatar_' + userId, dataUrl).then(function () {
            /* 동그라미 즉시 업데이트 */
            const circle = document.querySelector('.sp-avatar[data-uid="' + userId + '"]');
            if (circle) circle.innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
          });
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

/* ── Setup form: 소속 유형/교육청 선택 로직 (기존 유지) ── */
let _setupSelectedLevel = '';
const _eduOfficeList = (window._eduOfficeList && window._eduOfficeList.length) ? window._eduOfficeList : ['서울특별시교육청', '부산광역시교육청', '대구광역시교육청', '인천광역시교육청', '광주광역시교육청', '대전광역시교육청', '울산광역시교육청', '경기도교육청', '충청남도교육청', '충청북도교육청', '경상남도교육청', '경상북도교육청', '전라남도교육청', '전북특별자치도교육청', '강원특별자치도교육청', '제주특별자치도교육청', '세종특별자치시교육청'];
const _regionList = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '경기도', '충청남도', '충청북도', '경상남도', '경상북도', '전라남도', '전북특별자치도', '강원특별자치도', '제주특별자치도', '세종특별자치시'];

export function _setupSelectLevel(level, btn) {
  _setupSelectedLevel = level;
  const levelLabel = document.getElementById('setupSchoolLevelRow').previousElementSibling;
  if (levelLabel) levelLabel.style.display = 'none';
  document.getElementById('setupSchoolLevelRow').style.display = 'none';
  document.getElementById('setupStep1Back').style.display = 'none';
  const step2 = document.getElementById('setupStep2');
  const step3 = document.getElementById('setupStep3');
  const sel = document.getElementById('setupEduOffice');
  const label2 = document.getElementById('setupStep2Label');
  const schoolLabel = document.getElementById('setupSchoolLabel');
  step2.style.display = 'flex';
  step3.style.display = 'flex';
  sel.innerHTML = '<option value="">-- 선택하세요 --</option>';
  if (level === 'kindergarten') {
    label2.textContent = '선생님의 기관이 위치한 지역을 선택해 주세요';
    _regionList.forEach(function (r) { sel.innerHTML += '<option>' + r + '</option>'; });
    schoolLabel.textContent = '유치원 이름';
    document.getElementById('setupSchool').placeholder = '예: 해맑은유치원';
  } else {
    label2.textContent = ' 교육청을 선택해 주세요';
    _eduOfficeList.forEach(function (r) { sel.innerHTML += '<option>' + r + '</option>'; });
    const placeholderMap = { high: '예: 행복고등학교', middle: '예: 행복중학교', elementary: '예: 행복초등학교', special: '예: 서울행복학교' };
    schoolLabel.textContent = '학교 이름';
    document.getElementById('setupSchool').placeholder = placeholderMap[level] || '예: 행복학교';
  }
}

function _setupReset() {
  _setupSelectedLevel = '';
  document.querySelectorAll('.sp-level-btn').forEach(function (b) { b.classList.remove('selected'); });
  const levelLabel = document.getElementById('setupSchoolLevelRow').previousElementSibling;
  if (levelLabel) levelLabel.style.display = '';
  document.getElementById('setupSchoolLevelRow').style.display = 'flex';
  document.getElementById('setupStep1Back').style.display = '';
  document.getElementById('setupStep2').style.display = 'none';
  document.getElementById('setupStep3').style.display = 'none';
}

/* ── 버튼 이벤트 ── */
document.getElementById('btnSetup').addEventListener('click', function () {
  document.getElementById('spLogin').classList.remove('show');
  document.getElementById('spSetup').classList.add('show');
  _setupReset();
  /* 기존 사용자가 있으면 다른 학교급 버튼 비활성화 */
  if (window.electronAPI && window.electronAPI.userGetActive) {
    window.electronAPI.userGetActive().then(function (res) {
      if (!res || !res.success || !(res.data || []).length) return;
      const existingLevel = res.data[0].school_level || 'elementary';
      const existingGroup = _levelGroup(existingLevel);
      /* 다른 학교급 선택 시 경고할 수 있도록 기존 그룹 기억 */
      S._existingSchoolGroup = existingGroup;
      S._existingSchoolLevel = existingLevel;
    });
  }
});

document.getElementById('btnSetupBack').addEventListener('click', function () {
  _setupReset();
  document.getElementById('spSetup').classList.remove('show');
  document.getElementById('spLogin').classList.add('show');
});
document.getElementById('setupStep1Back').addEventListener('click', function () {
  _setupReset();
  document.getElementById('spSetup').classList.remove('show');
  document.getElementById('spLogin').classList.add('show');
});

document.getElementById('setupPosition').addEventListener('change', function () {
  document.getElementById('setupPositionCustom').style.display = this.value === '' ? 'block' : 'none';
  if (this.value !== '') document.getElementById('setupPositionCustom').value = '';
});

/* ── 사용자 등록 완료 ── */
document.getElementById('btnSetupDone').addEventListener('click', function () {
  if (!_setupSelectedLevel) { alert('소속 유형을 선택해 주세요.'); return; }
  const eduOffice = document.getElementById('setupEduOffice').value;
  const school = document.getElementById('setupSchool').value.trim();
  const name = document.getElementById('setupName').value.trim();
  const pos = document.getElementById('setupPosition').value;
  const customPos = document.getElementById('setupPositionCustom').value.trim();
  const finalPos = pos || customPos || '보건교사';
  const isSchool = (_setupSelectedLevel !== 'kindergarten');
  if (!eduOffice) { alert(isSchool ? '소속 교육청을 선택해 주세요.' : '기관이 위치한 지역을 선택해 주세요.'); return; }
  if (!school) { alert('기관 이름을 입력하세요.'); return; }
  if (!name) { alert('사용자 이름을 입력하세요.'); return; }

  const slMap = { elementary: 'elementary', middle: 'middle', high: 'high', kindergarten: 'kindergarten', special: 'special' };
  const schoolLevel = slMap[_setupSelectedLevel] || 'elementary';

  if (!window.electronAPI || !window.electronAPI.userCreate) {
    alert('사용자 등록 기능을 사용할 수 없습니다.'); return;
  }

  window.electronAPI.userCreate({
    name: name,
    position: finalPos,
    school_name: school,
    school_level: schoolLevel,
    edu_office: eduOffice
  }).then(function (res) {
    if (!res || !res.success) { alert('등록 실패: ' + (res && res.error || '알 수 없는 오류')); return; }
    /* 설정 동기화 */
    try {
      const s = JSON.parse(localStorage.getItem('ec_settings') || '{}');
      s.schoolName = school; s.nurse1 = name; s.eduOffice = eduOffice; s.schoolLevel = schoolLevel;
      localStorage.setItem('ec_settings', JSON.stringify(s));
      if (window.electronAPI && window.electronAPI.dbSet) window.electronAPI.dbSet('common', 'settings', s);
      if (typeof S.settings !== 'undefined') Object.assign(S.settings, s);
    } catch (e) { }
    /* 등록 후: 로그인 (DB에 데이터 없으면 _loginAsUser 내에서 온보딩 표시) */
    const _userId = res.data.id;
    _loginAsUser(_userId);
  }).catch(function (err) { alert('등록 실패: ' + err.message); });
});

/* ── 사용자 삭제 (커스텀 팝업) ── */
document.getElementById('btnDeleteUser').addEventListener('click', function () {
  if (!window.electronAPI || !window.electronAPI.userGetActive) return;
  window.electronAPI.userGetActive().then(function (res) {
    if (!res || !res.success) return;
    const users = res.data || [];
    if (users.length === 0) { return; }
    /* 커스텀 선택 팝업 */
    const existing = document.getElementById('userDeletePopup'); if (existing) closeModalGracefully(existing);
    const ov = document.createElement('div'); ov.id = 'userDeletePopup';
    ov.style.cssText = 'position:fixed;inset:0;z-index:60000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
    let h = '<div style="background:var(--card);border-radius:14px;padding:20px 24px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3)">';
    h += '<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:14px;text-align:center">삭제할 사용자를 선택하세요</div>';
    users.forEach(function (u) {
      h += '<div data-deluid="' + u.id + '" data-delname="' + escHtml(u.name) + '" style="cursor:pointer;padding:12px 14px;border:1.5px solid var(--bdr);border-radius:10px;margin-bottom:8px;display:flex;align-items:center;gap:10px;transition:all .15s">';
      h += '<span style="font-size:20px">👤</span>';
      h += '<div><div style="font-size:13px;font-weight:700;color:var(--t1)">' + escHtml(u.name) + '</div><div style="font-size:10px;color:var(--t3)">' + escHtml(u.position) + ' · ' + escHtml(u.school_name) + '</div></div>';
      h += '</div>';
    });
    h += '<div style="text-align:center;margin-top:8px"><button data-action="cancel-delete" style="padding:6px 20px;font-size:11px;font-weight:600;background:transparent;color:var(--t3);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button></div>';
    h += '</div>';
    ov.innerHTML = h;
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModalGracefully(ov); });
    /* 삭제 항목 이벤트 위임 */
    ov.querySelectorAll('[data-deluid]').forEach(function (item) {
      const uid = parseInt(item.getAttribute('data-deluid'), 10);
      const uname = item.getAttribute('data-delname');
      item.addEventListener('click', function () { _userDeleteConfirm(uid, uname); });
      item.addEventListener('mouseenter', function () { this.style.borderColor = '#dc2626'; this.style.background = 'rgba(239,68,68,0.04)'; });
      item.addEventListener('mouseleave', function () { this.style.borderColor = 'var(--bdr)'; this.style.background = ''; });
    });
    const cancelBtn = ov.querySelector('[data-action="cancel-delete"]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { closeModalGracefully('userDeletePopup'); });
    document.body.appendChild(ov);
  });
});
function _userDeleteConfirm(uid, name) {
  const pop = document.getElementById('userDeletePopup'); if (pop) closeModalGracefully(pop);
  /* 네이티브 confirm() 사용 시 Windows Electron 에서 다이얼로그 닫힌 후 렌더러 입력 포커스가
   * 풀려 setupSchool 등 input 에 키보드 입력이 안 들어가는 현상이 있어 커스텀 모달로 대체. */
  _showCustomConfirm(
    name + ' 사용자를 삭제하시겠습니까?',
    '해당 사용자가 기존에 입력한 일지 내용은 그대로 보존됩니다.',
    function (ok) {
      if (!ok) return;
      window.electronAPI.userDelete(uid).then(function (r) {
        if (r && r.success) {
          loadUserList();
        } else {
          alert('삭제 실패: ' + (r && r.error || ''));
        }
      });
    }
  );
}

/* 커스텀 confirm 모달 — 네이티브 다이얼로그의 포커스 손실 문제 우회 */
function _showCustomConfirm(title, desc, cb) {
  const existing = document.getElementById('customConfirmOverlay');
  if (existing) existing.remove();
  const ov = document.createElement('div');
  ov.id = 'customConfirmOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:65000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);transition:background .15s ease';
  /* 페이드인 - 다음 프레임에 배경을 진하게 */
  setTimeout(function () { ov.style.background = 'rgba(0,0,0,0.5)'; }, 0);
  ov.innerHTML = '<div style="background:var(--card);border-radius:14px;padding:22px 26px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.30);border:1px solid var(--bdr)">'
    + '<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:8px;text-align:center">' + escHtml(title) + '</div>'
    + (desc ? '<div style="font-size:11.5px;color:var(--t2);margin-bottom:16px;text-align:center;line-height:1.6">' + escHtml(desc) + '</div>' : '')
    + '<div style="display:flex;gap:8px;justify-content:center">'
    + '<button data-cc="cancel" style="padding:8px 22px;font-size:12px;font-weight:600;background:transparent;color:var(--t2);border:1px solid var(--bdr);border-radius:8px;cursor:pointer;font-family:var(--f)">취소</button>'
    + '<button data-cc="ok" style="padding:8px 22px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f)">삭제</button>'
    + '</div></div>';
  function _done(ok) {
    ov.style.background = 'rgba(0,0,0,0)';
    setTimeout(function () { if (ov.parentElement) ov.remove(); }, 130);
    document.removeEventListener('keydown', _esc);
    try { cb(ok); } catch (_) { }
  }
  const _esc = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); _done(false); }
    else if (e.key === 'Enter') { e.preventDefault(); _done(true); }
  };
  ov.querySelector('[data-cc="ok"]').addEventListener('click', function () { _done(true); });
  ov.querySelector('[data-cc="cancel"]').addEventListener('click', function () { _done(false); });
  ov.addEventListener('mousedown', function (e) { if (e.target === ov) _done(false); });
  document.addEventListener('keydown', _esc);
  document.body.appendChild(ov);
  /* 기본 포커스 — 삭제 버튼 (Enter 즉시 진행) */
  setTimeout(function () { const okBtn = ov.querySelector('[data-cc="ok"]'); if (okBtn) okBtn.focus(); }, 20);
}

