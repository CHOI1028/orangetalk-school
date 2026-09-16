/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * app-state.js — 중앙 상태 관리 (Proxy 기반 변경 추적)
 *
 * 읽기: import { S } from './app-state.js';  console.log(S.people);
 * 쓰기: S.records = [...];  ← 여전히 동작 (Proxy가 변경 추적)
 * 권장: setRecords([...]);  ← 뮤테이션 헬퍼 사용 시 bus 이벤트 자동 발행
 *
 * DevTools:
 *   window.myState         — 현재 상태 조회
 *   window._stateLog()     — 최근 변경 이력 조회
 */
import { bus } from './event-bus.js';
import { getPublicDataApiKey } from './public-data-settings.js';

/* ═══ CONSTANTS ═══ */
export const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
export const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export const symptomTagClass = {
  '두통': 'tag-head', '복통': 'tag-stomach', '발열': 'tag-fever', '찰과상': 'tag-wound',
  '어지러움': 'tag-dizzy', '기침': 'tag-cough', '피부발진': 'tag-skin', '코피': 'tag-head',
  '흉통': 'tag-fever', '저혈당': 'tag-stomach', '발목염좌': 'tag-wound', '구토': 'tag-dizzy',
  '인후통': 'tag-cough', '눈 통증': 'tag-skin', '생리통': 'tag-stomach', '설사': 'tag-stomach',
  '타박상': 'tag-wound'
};

export const DEFAULT_RELAY_URL = 'https://relay.school114.org';
export const resultLabels = { return: '귀가', early: '조퇴', hospital: '병원이송', observe: '경과관찰' };
export const chartColors = ['#06b6d4', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#f97316', '#ec4899', '#3b82f6'];

/* ═══ MUTABLE STATE (내부 원본) ═══ */
const _today = new Date();

const _state = {
  koreanHolidays: {},

  settings: { schoolName: '', nurseCount: 1, nurse1: '', nurse2: '', usageType: 1, schoolLevel: 'elementary' },
  treatmentMap: [],
  medicationMap: [],
  deptMappingText: '\uB118\uC5B4\uC9D0 \u2192 \uC678\uACFC\n\uBD80\uB52A\uD790 \u2192 \uC678\uACFC\n\uCC30\uACFC\uC0C1 \u2192 \uC678\uACFC\n\uC5F4\uC0C1 \u2192 \uC678\uACFC\n\uBCA0\uC784 \u2192 \uC678\uACFC\n\uCC14\uB9BC \u2192 \uC678\uACFC\n\uD0C0\uBC15\uC0C1 \u2192 \uC815\uD615\uC678\uACFC\n\uC811\uC9C8\uB9BC \u2192 \uC815\uD615\uC678\uACFC\n\uD654\uC0C1 \u2192 \uC678\uACFC\n\uACE8\uC808 \uC758\uC2EC \u2192 \uC815\uD615\uC678\uACFC\n\uBB3C\uB9BC \u2192 \uC678\uACFC\n\uAE41\uD790 \u2192 \uC678\uACFC\n\uAE4C\uC9D0 \u2192 \uC678\uACFC\n\uBA4D \u2192 \uC678\uACFC\n\uBD80\uC885 \u2192 \uC678\uACFC\n\uBC8C\uC3D8\uC784 \u2192 \uC678\uACFC\n\uB3D9\uBB3C \uBB3C\uB9BC \u2192 \uC678\uACFC\n\uAE30\uCE68 \u2192 \uB0B4\uACFC\n\uAC00\uB798 \u2192 \uB0B4\uACFC\n\uCF67\uBB3C \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uCF54\uB9C9\uD790 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uC7AC\uCC44\uAE30 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uC778\uD6C4\uD1B5 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uD638\uD761\uACE4\uB780 \u2192 \uB0B4\uACFC\n\uCC9C\uC2DD \uC99D\uC0C1 \u2192 \uB0B4\uACFC\n\uBC1C\uC5F4 \u2192 \uB0B4\uACFC\n\uCF54\uD53C \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uBCF5\uD1B5 \u2192 \uB0B4\uACFC\n\uAD6C\uD1A0 \u2192 \uB0B4\uACFC\n\uAD6C\uC5ED\uC9C8 \u2192 \uB0B4\uACFC\n\uC124\uC0AC \u2192 \uB0B4\uACFC\n\uBCC0\uBE44 \u2192 \uB0B4\uACFC\n\uC18D\uC4F0\uB9BC \u2192 \uB0B4\uACFC\n\uC18C\uD654\uBD88\uB7C9 \u2192 \uB0B4\uACFC\n\uC2DD\uC695\uBD80\uC9C4 \u2192 \uB0B4\uACFC\n\uC5B4\uC9C0\uB7EC\uC6C0 \u2192 \uC2E0\uACBD\uACFC\n\uC2E4\uC2E0 \u2192 \uC2E0\uACBD\uACFC\n\uAC00\uC2B4 \uB450\uADFC\uAC70\uB9BC \u2192 \uB0B4\uACFC\n\uAC00\uC2B4 \uD1B5\uC99D \u2192 \uB0B4\uACFC\n\uC800\uD608\uC555 \u2192 \uB0B4\uACFC\n\uACE0\uD608\uC555 \u2192 \uB0B4\uACFC\n\uBE48\uD608 \uC99D\uC0C1 \u2192 \uB0B4\uACFC\n\uBC1C\uC9C4 \u2192 \uD53C\uBD80\uACFC\n\uB450\uB4DC\uB7EC\uAE30 \u2192 \uD53C\uBD80\uACFC\n\uAC00\uB824\uC6C0 \u2192 \uD53C\uBD80\uACFC\n\uC2B5\uC9C4 \u2192 \uD53C\uBD80\uACFC\n\uC5EC\uB4DC\uB984 \u2192 \uD53C\uBD80\uACFC\n\uD53C\uBD80\uAC74\uC870 \u2192 \uD53C\uBD80\uACFC\n\uC218\uD3EC \u2192 \uD53C\uBD80\uACFC\n\uBC8C\uB808 \uBB3C\uB9BC \u2192 \uD53C\uBD80\uACFC\n\uC54C\uB808\uB974\uAE30 \uBC18\uC751 \u2192 \uB0B4\uACFC\n\uB450\uD1B5 \u2192 \uC2E0\uACBD\uACFC\n\uD3B8\uB450\uD1B5 \u2192 \uC2E0\uACBD\uACFC\n\uC774\uBA85 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uC190\uBC1C \uC800\uB9BC \u2192 \uC2E0\uACBD\uACFC\n\uACBD\uB828 \u2192 \uC2E0\uACBD\uACFC\n\uADFC\uC721\uD1B5 \u2192 \uC815\uD615\uC678\uACFC\n\uAD00\uC808\uD1B5 \u2192 \uC815\uD615\uC678\uACFC\n\uC694\uD1B5 \u2192 \uC815\uD615\uC678\uACFC\n\uBAA9 \uD1B5\uC99D \u2192 \uC815\uD615\uC678\uACFC\n\uC5B4\uAE68 \uD1B5\uC99D \u2192 \uC815\uD615\uC678\uACFC\n\uC190\uBAA9 \uD1B5\uC99D \u2192 \uC815\uD615\uC678\uACFC\n\uBB34\uB98E \uD1B5\uC99D \u2192 \uC815\uD615\uC678\uACFC\n\uBC1C\uBAA9 \uC5FC\uC88C \u2192 \uC815\uD615\uC678\uACFC\n\uADFC\uC721 \uACBD\uB828 \u2192 \uC815\uD615\uC678\uACFC\n\uADC0 \uD1B5\uC99D \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uB09C\uCCAD \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uD3B8\uB3C4 \uBD80\uC885 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uBAA9 \uC774\uBB3C\uAC10 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uC131\uB300 \uC774\uC0C1 \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uCE58\uD1B5 \u2192 \uCE58\uACFC\n\uC787\uBAB8 \uCD9C\uD608 \u2192 \uCE58\uACFC\n\uAD6C\uB0B4\uC5FC \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uC785\uC220 \uAC08\uB77C\uC9D0 \u2192 \uD53C\uBD80\uACFC\n\uD131 \uD1B5\uC99D \u2192 \uCE58\uACFC\n\uD600 \uD1B5\uC99D \u2192 \uCE58\uACFC\n\uB208 \uD1B5\uC99D \u2192 \uC548\uACFC\n\uCDA9\uD608 \u2192 \uC548\uACFC\n\uB208 \uC774\uBB3C\uAC10 \u2192 \uC548\uACFC\n\uC2DC\uB825 \uC800\uD558 \u2192 \uC548\uACFC\n\uB208\uAEBC\uD480 \uBD80\uC885 \u2192 \uC548\uACFC\n\uACB0\uB9C9\uC5FC \u2192 \uC548\uACFC\n\uB208\uBB3C \u2192 \uC548\uACFC\n\uB208 \uAC00\uB824\uC6C0 \u2192 \uC548\uACFC\n\uBC30\uB728\uD1B5 \u2192 \uBE44\uB1E8\uAE30\uACFC\n\uBE48\uB1E8 \u2192 \uBE44\uB1E8\uAE30\uACFC\n\uD608\uB1E8 \u2192 \uBE44\uB1E8\uAE30\uACFC\n\uC0DD\uB9AC\uD1B5 \u2192 \uC0B0\uBD80\uC778\uACFC\n\uC0DD\uB9AC\uBD88\uC21C \u2192 \uC0B0\uBD80\uC778\uACFC\n\uD558\uBCF5\uBD80 \uD1B5\uC99D \u2192 \uC0B0\uBD80\uC778\uACFC\n\uBD88\uC548 \u2192 \uC815\uC2E0\uACFC\n\uC2A4\uD2B8\uB808\uC2A4 \u2192 \uC815\uC2E0\uACFC\n\uC6B0\uC6B8 \u2192 \uC815\uC2E0\uACFC\n\uACF5\uD669 \u2192 \uC815\uC2E0\uACFC\n\uACFC\uD638\uD761 \u2192 \uC815\uC2E0\uACFC\n\uBD88\uBA74 \u2192 \uC815\uC2E0\uACFC\n\uC2DD\uC695 \uC774\uC0C1 \u2192 \uC815\uC2E0\uACFC\n\uC790\uD574 \uCDA9\uB3D9 \u2192 \uC815\uC2E0\uACFC\n\uB3C5\uAC10 \uC758\uC2EC \u2192 \uB0B4\uACFC\n\uCF54\uB85C\uB098 \uC758\uC2EC \u2192 \uB0B4\uACFC\n\uC218\uB450 \u2192 \uB0B4\uACFC\n\uC720\uD589\uC131\uC774\uD558\uC120\uC5FC \u2192 \uC774\uBE44\uC778\uD6C4\uACFC\n\uC7A5\uC5FC \u2192 \uB0B4\uACFC\n\uC2DD\uC911\uB3C5 \u2192 \uB0B4\uACFC\n\uC218\uC871\uAD6C \u2192 \uB0B4\uACFC\n\uD53C\uB85C \u2192 \uB0B4\uACFC\n\uC218\uBA74\uBD80\uC871 \u2192 \uB0B4\uACFC\n\uC131\uC7A5\uD1B5 \u2192 \uC815\uD615\uC678\uACFC',

  people: [],
  /* 명단에서 빠진(전출·자퇴·졸업·전근·퇴직) 학생/교직원 — students 행은 보존되어 있고
   * 보건일지·응급·감염 기록의 person_uid 가 여전히 참조 중. 명단 UI 에는 안 보이지만
   * 일지 행 렌더 시 이름·식별정보 resolve 에 사용 (getStu 의 fallback). 2026-05-18. */
  leavers: [],
  records: [],
  nextId: 1013,

  selectedDate: _today.getFullYear() + '-' + String(_today.getMonth() + 1).padStart(2, '0') + '-' + String(_today.getDate()).padStart(2, '0'),
  calYear: _today.getFullYear(),
  calMonth: _today.getMonth(),
  currentView: 'daily',
  statsPeriod: 'today',
  acHighlight: -1,
  sideChartsOpen: false,

  ecRecords: [],
  ecNextId: 1,
  infRecords: [],
  infNextId: 1,
  infNotes: {},

  _userProfile: null,
  _currentUser: null,
  _grantedUsers: [],

  _symMeds: {},
  _symOintments: [],
  _symPatches: [],
  _medDbUser: {},

  kioskSettings: JSON.parse(localStorage.getItem('ec_kiosk')||'{}'),
  memoData: {},
  _vipTags: {},
  _apTbSearchData: [],
  _wtData: null,

  _driveBrowseStack: [],
  _driveBrowseCurrent: null,
  _driveSyncSelectMode: false,

  _bedConfigRaw: {},
  _bedConfig: { beds: [{ id: 1 }], placement: 'left' },
  _bedUsage: [],
  _colWidths: {},
  _dailySortCol: 'timeIn',
  _dailySortDir: 'desc',
  _fbData: [],
  _peData: null,
  weatherData: {},
  magicLayoutItems: [],
  magicLinks: [],
  magicMemos: [],
  vpCustomFormats: {},
  svCustomSurveys: [],

  /* cross-module 상태 */
  _visitHistoryLocked: false,
  _symPopupRecId: null,
  _existingSchoolGroup: null,
  _existingSchoolLevel: null,
  _collabServerConnected: false,
  _collabConfig: null,
  _collabPeer: null, /* {name,school,position,type,stuCount,staffCount} — 첫 동료 (전광판 호환) */
  _collabPeers: [], /* [{id,name,school,position,type}] — 모든 접속 동료 (A안 N장 카드용) */
  _lastRegisteredRecId: null,
  dailySelectedRecId: null,
  dailyLockedStudentId: null,
  _dragSelectedRecIds: [],
  dailySortOrder: null,
  _medHidden: [],
  _skipSettingsAnim: false,
  _hdrRendering: false,
  /* 일반일지 초기 DB 로딩 중 플래그 — 초기값 true, recordsGetDaily 응답 도착(성공·실패 무관) 시 false.
   * renderDaily()의 빈 상태 분기에서 "로딩 중입니다. 잠시만 기다려주세요." 안내에 사용. */
  _dailyLoading: true,
  settingsLocked: false,
  _dashSubIdx: 0,
  _dashCustomStart: '',
  _dashCustomEnd: '',
};

/* ═══ Proxy — 변경 추적 (DevTools 디버깅용) ═══ */
let _changeLog = [];

export const S = new Proxy(_state, {
  set(target, prop, value) {
    target[prop] = value;
    _changeLog.push({ prop: String(prop), t: Date.now() });
    if (_changeLog.length > 300) _changeLog = _changeLog.slice(-150);
    return true;
  }
});

/* ═══ 공휴일 비동기 로드 ═══
   1) 하드코딩 2026 + 캐시된 모든 연도(과거·미래) 를 S.koreanHolidays 로 적재.
   2) 특일정보 API 키가 있으면 현재 연도 ± 1 (총 3개) 중 캐시에 없는 연도를 백그라운드 fetch → 캐시·병합.
      · 2026 은 하드코딩이라 fetch 대상에서 자동 제외.
      · 사용자가 달력에서 더 먼 과거/미래로 이동하면 ensureHolidayYear(year) 를 호출해 lazy fetch. */
if (window.electronAPI && window.electronAPI.statsDbHolidays) {
  window.electronAPI.statsDbHolidays().then(function (res) {
    if (res && res.success && res.data) {
      S.koreanHolidays = res.data;
      bus.emit('render:calendar'); /* 사이드·홈·일지 달력 등 갱신 */
      bus.emit('holidays:updated'); /* 공휴일 캐시 전용 — 홈/학기 picker 등 비구독 달력 갱신용 */
    }
  }).catch(function () {});
}

/* 특정 연도의 공휴일이 S.koreanHolidays 에 들어있도록 보장.
   · 2026 / 캐시 보유 / 키 미입력 → 조용히 즉시 반환.
   · 키 입력됨 + 캐시 없음 → 백그라운드 fetch → 성공 시 S.koreanHolidays 누적 병합 + render:calendar.
   달력 코드에서 연도 이동 직후 호출하면 됨 (await 불필요, 캐시되면 다음 렌더부터 표시). */
const _holidayInflight = new Set();
export function ensureHolidayYear(year) {
  const yr = String(year || '').trim();
  if (!/^\d{4}$/.test(yr)) return;
  /* (2026 특례 제거 — 하드코딩 폐지로 올해 포함 모든 연도를 API 로 받아온다. 2026-06-04) */
  /* 이미 어떤 키든 그 연도로 시작하는 항목이 있으면 캐시 hit 으로 간주 */
  for (const k of Object.keys(S.koreanHolidays || {})) {
    if (k.startsWith(yr + '-')) return;
  }
  if (_holidayInflight.has(yr)) return;
  let key = '';
  try { key = getPublicDataApiKey('holiday'); } catch (_) {}
  if (!key) return; /* 키 없으면 조용히 종료 — 그 연도 휴일은 표시 안 함 */
  if (!window.electronAPI || !window.electronAPI.statsDbHolidaysFetch) return;
  _holidayInflight.add(yr);
  window.electronAPI.statsDbHolidaysFetch(key, yr).then(function (r) {
    _holidayInflight.delete(yr);
    if (r && r.success && r.data && typeof r.data === 'object') {
      Object.assign(S.koreanHolidays, r.data);
      bus.emit('render:calendar');
      bus.emit('holidays:updated');
    }
  }).catch(function () { _holidayInflight.delete(yr); });
}

/* 미래 연도(현재·내년) 강제 재호출 — 격주(마지막 실행 후 14일 경과) 갱신용.
   · 과거 연도는 변하지 않으므로 대상 아님. 임시공휴일·대체공휴일 변동은 보통 당해/내년에만 발생.
   · 캐시에 있어도 다시 받아 연도 단위로 교체(삭제된 휴일까지 반영) — 호스트가 갱신하면
     호스트 DB(브라우저 동료가 읽는 그 DB)도 cacheHolidays 로 함께 교체된다.
   · 성공한 경우에만 true 반환 → 호출부에서 그때만 타임스탬프 기록(네트워크 실패 시 다음 부팅 재시도). */
async function _refreshFutureHolidays() {
  let key = '';
  try { key = getPublicDataApiKey('holiday'); } catch (_) {}
  if (!key) return false;
  if (!window.electronAPI || !window.electronAPI.statsDbHolidaysFetch) return false;
  const curYr = new Date().getFullYear();
  const years = [String(curYr), String(curYr + 1)];
  let anyOk = false;
  for (const yr of years) {
    try {
      const r = await window.electronAPI.statsDbHolidaysFetch(key, yr);
      if (r && r.success && r.data && typeof r.data === 'object') {
        /* 연도 단위 교체 — 기존 yr- 키 제거 후 병합 (드문 휴일 삭제/변경 반영) */
        for (const k of Object.keys(S.koreanHolidays || {})) {
          if (k.startsWith(yr + '-')) delete S.koreanHolidays[k];
        }
        Object.assign(S.koreanHolidays, r.data);
        anyOk = true;
      }
    } catch (_) {}
  }
  if (anyOk) { bus.emit('render:calendar'); bus.emit('holidays:updated'); }
  return anyOk;
}

/* 부팅 직후 — ① 지정 범위(현재-6 ~ 현재+1, 8개 연도) 중 캐시에 없는 연도 prefetch.
   호스트가 미리 다 받아두면 브라우저(동료) 클라이언트도 호스트 캐시에서 모든 연도 휴일을 본다
   (브라우저는 statsDbHolidaysFetch 가 없어 스스로 못 받으므로 호스트 prefetch 가 빈틈을 막는다).
   ② 마지막 실행 후 14일 경과 시 미래 연도(현재·내년)만 강제 재호출해 변동 반영(≈격주).
   키 미입력 사용자에겐 모두 조용히 no-op. */
try {
  const _curYr = new Date().getFullYear();
  setTimeout(function () {
    for (let y = _curYr - 6; y <= _curYr + 1; y++) ensureHolidayYear(String(y));
    try {
      const _RKEY = 'ec_holiday_last_refresh_at';
      const _last = parseInt(localStorage.getItem(_RKEY) || '0', 10) || 0;
      const _FORTNIGHT = 14 * 24 * 60 * 60 * 1000;
      if (Date.now() - _last >= _FORTNIGHT) {
        _refreshFutureHolidays().then(function (ok) {
          if (ok) { try { localStorage.setItem(_RKEY, String(Date.now())); } catch (_) {} }
        });
      }
    } catch (_) {}
  }, 1500); /* statsDbHolidays() 응답이 먼저 적재되도록 살짝 지연 */
} catch (_) {}

/* ═══ 도메인 뮤테이션 헬퍼 (bus 이벤트 자동 발행) ═══ */

/* records (일반일지) */
export function setRecords(arr) { _state.records = arr; bus.emit('render:daily'); bus.emit('render:calendar'); }
export function addRecord(rec) { _state.records.push(rec); bus.emit('render:daily'); bus.emit('render:calendar'); bus.emit('render:sidebar'); }

/* people (학생/교직원) */
export function addPerson(p) { _state.people.push(p); }

/* ecRecords (응급처치) */
export function addEcRecord(rec) { _state.ecRecords.push(rec); bus.emit('render:ecList'); }

/* infRecords (감염병) */
export function addInfRecord(rec) { _state.infRecords.push(rec); bus.emit('render:infList'); }

/* settings */

/* kiosk settings save */
export function saveKioskSettings() {
  localStorage.setItem('ec_kiosk', JSON.stringify(_state.kioskSettings));
  if (window.electronAPI && window.electronAPI.jsonSaveCommon) window.electronAPI.jsonSaveCommon('kiosk_settings', _state.kioskSettings);
}

/* ═══ DevTools ═══ */
window.myState = S;
window._stateLog = function(last) {
  const n = last || 20;
  return _changeLog.slice(-n).map(function(e){
    return new Date(e.t).toLocaleTimeString() + ' ' + e.prop;
  });
};
