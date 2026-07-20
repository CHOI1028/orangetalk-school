/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * custom-backup-keys.js — 학교 이동용 "커스텀 백업과 반영" 대상 키 등록부.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  ★★★ 새 커스텀 기능 추가 시 반드시 이 파일의 해당 카테고리에 등록 ★★★
 * ════════════════════════════════════════════════════════════════════════════
 *  학교 이동 시 옮겨가야 하는 사용자 커스텀이라면 → 알맞은 카테고리에 키 추가.
 *  학교/사용자 의존 데이터 (학생 명단, 보건일지, 학교 주소, 침상 설정 등) 는 절대 추가 X.
 *
 *  ▸ 단일 출처는 categories. flat 리스트(localStorageKeys 등)는 categories 에서 자동 파생되어
 *    기존 서비스·자동발견 로직과 그대로 호환된다. (사용자 요청 2026-05-30 — 백업 대상 체크박스 선택)
 *  ▸ 백업 실행 시 selectedIds 로 선택된 카테고리만 백업할 수 있다. (미지정 시 전체 백업 — 하위호환)
 *
 *  누락 안전망: 백업 실행 시 localStorage 의 모든 키를 스캔해서, 등록부에 없는
 *  ec_user_* / ec_custom_* / ec_my_* 접두사 키가 발견되면 콘솔/사용자 알림.
 *  단 안전망은 보조일 뿐 — 명시적 등록이 원칙.
 */

/** 백업 대상 카테고리 — UI 체크박스 단위. 각 카테고리:
 *  { id, label, localStorageKeys?, localStoragePrefixes?, appDataCommonKeys?, files?, defaultOn? } */
const categories = [
  {
    id: 'symptom', label: '증상·처치',
    localStorageKeys: [
      'ec_user_symptoms', 'ec_sym_order', 'ec_hidden_symptoms',
      'ec_user_sym_fav', 'ec_user_sym_removed', 'ec_user_fav_treatments',
      'ec_treat_renames', 'ec_user_demoted_treatments',
      'ec_symFreeTextByCat',           // 증상 자유 기입 카테고리 매핑 (record::catId → text)
      'ec_renamed_sym_cats', 'ec_user_sym_cats', 'ec_hidden_sym_cats', 'ec_sym_cat_order',   // 상분류 편집 4종 (2026-06-12)
      'ec_sym_cat_icons', 'ec_sym_renames',   // 상분류 아이콘 + 중분류 별칭(통계 승계) (2026-06-12)
    ],
    appDataCommonKeys: ['user_symptoms', 'sym_order', 'hidden_symptoms', 'renamed_sym_cats', 'user_sym_cats', 'hidden_sym_cats', 'sym_cat_order', 'sym_cat_icons', 'sym_renames'],
  },
  {
    id: 'medication', label: '약품 (매칭·추가·이름변경·숨김·약품DB)',
    localStorageKeys: [
      'ec_user_med_syms', 'ec_user_added_meds', 'ec_user_med_syms_prefilled',
      'ec_med_hidden', 'ec_med_renames', 'ec_meddb_user', 'ec_medications',
      'ec_xlsx_med_syms',          // 엑셀 import 로 사용자가 매칭한 약품-증상 (감사 2026-05-30 추가)
    ],
    appDataCommonKeys: [
      'user_med_syms', 'user_added_meds', 'user_med_syms_prefilled',
      'med_renames', 'med_hidden', 'meddb_user', 'medications_list',
    ],
  },
  {
    id: 'apikeys', label: 'API 키 (카카오·HIRA·식약처·응급의료·기상청·에어코리아·특일정보·NEIS·질병관리청)',
    localStorageKeys: [
      'ec_airkorea_api_key', 'ec_drug_api_key', 'ec_emergency_api_key',
      'ec_hira_api_key', 'ec_kakao_js_api_key', 'ec_kakao_rest_api_key',
      'ec_holiday_api_key',          /* KASI 특일정보 (공휴일 자동 갱신) — 2026-06-02 추가 */
      'ec_neis_api_key',             /* NEIS 학교급식·학사일정·시간표 (2026-06-17 추가) */
      'ec_kdca_api_key',             /* 질병관리청 감염병 발생현황 (2026-06-17 추가) */
    ],
    appDataCommonKeys: [
      'holiday_api_key', 'neis_api_key', 'kdca_api_key',
      /* 캐시 자체는 학교 이동 시 따라갈 필요 없음 — 같은 키만 옮기면 새 PC 에서 즉시 재 fetch.
       * (캐시 키 holiday_cache_YYYY, holiday_cache_years 는 의도적으로 제외) */
    ],
  },
  {
    id: 'mealpopup', label: '급식·학사일정 설정 (NEIS)',
    localStorageKeys: [
      'ec_meal_popup_on', 'ec_meal_popup_time',   /* 급식 자동 팝업 on/off + 시각 */
      'ec_neis_school_code', 'ec_neis_office_code', 'ec_neis_school_name', 'ec_neis_school_kind',/* 학교 표준코드·교육청코드·학교명·학교급 캐시 (재조회 생략용) */
      'ec_academic_color',                        /* 학사일정 막대 색상 */
      'ec_acad_popup_on', 'ec_acad_popup_when', 'ec_acad_popup_time', /* 학사일정 자동 팝업 on/off · 당일/전날 · 시각 */
    ],
  },
  {
    id: 'colwidths', label: '열 필드 설정 (보건일지 열 너비·표시·순서)',
    /* 사용자 요청 2026-05-30 — UI·테마에서 분리해 별도 체크박스로 선택 가능하게 함. */
    localStorageKeys: [
      'ec_col_widths', 'ec_dp_col_widths', /* 일지 출력 열 너비 (2026-06-11) */
      'dailyColOrder', 'dailyColVisibility', /* 일반 일지 열 순서·표시(바디맵 ON 등) (2026-06-12) */
    ],
    /* 사용자별 변형 키(_u<uid>)까지 함께 — 실제 읽기 우선순위가 사용자 키라 빠지면 이동 후 미적용 */
    localStoragePrefixes: ['ec_col_widths_u', 'dailyColOrder_u', 'dailyColVisibility_u'],
    appDataCommonKeys: ['col_widths', 'dp_col_widths', 'daily_col_order', 'daily_col_visibility'],
  },
  {
    id: 'uitheme', label: 'UI·테마 (탭·폰트·배경·테마·자동시간)',
    /* 헤더·푸터 회전 메시지 기능은 제거됨 — 관련 키(ec_hdr_msgs·ec_footer_msgs·ec_header_msgs_user·header_msgs_user·footer_msgs) 백업 대상에서 제외 (사용자 결정 2026-05-30). */
    localStorageKeys: [
      'ec_tab_order', 'ec_tab_visibility', 'ec_fontsize', 'ec_fontScale',
      'ec_sidebar_position',   /* 사이드바 위치(왼쪽/오른쪽/끄기) — 학교 이동 시 함께 (2026-06-12) */
      'ec_bg_mode', 'ec_bg_selected', 'ec_bg_custom', 'ec_bg_custom_path', 'ec_bg_custom_ver',
      'ec_bg_random_daily', 'ec_bg_random_date', 'ec_bg_random_file', 'ec_bg_random_week', 'ec_bg_random_weekly',
      'ec_bgStretchPx',
      'ec_glass_footer', 'ec_glass_header',
      'ec_theme', 'ec_privacy_mode',
      'ec_daily_auto_time_in_before', 'ec_daily_auto_time_out_after',
      'ec_daily_bedrest_minutes', 'ec_daily_birthcontact_popup',
      'ec_today_memo_settings',    /* 오늘의 메모 — on/칸수/제목 (2026-06-10). 칸 내용(today_memo)은 일지 데이터라 이동 제외 */
    ],
    files: ['data/bg/custom.webp', 'data/bg/custom.png', 'data/bg/custom.jpg', 'data/bg/custom.jpeg'],
  },
  {
    id: 'dashboard', label: '홈 대시보드 (위젯 배치·진행률·사이트·연락처·품의·루틴·TO-DO·메모)',
    localStorageKeys: [
      'ec_home_widgets', 'ec_home_widget_caps', 'ec_home_widget_vis',
      'ec_home_widget_order', 'ec_home_widget_col',
      'ec_home_progress_vis', 'ec_home_progress_order', 'ec_home_progress_period',
      'ec_home_quicklinks', 'ec_home_phonebook', 'ec_home_procurement', 'ec_home_routine',
      'ec_home_todolist', 'ec_home_todolist_lastDate', 'ec_home_memos', 'ec_home_cal_cellH',
    ],
    appDataCommonKeys: ['ec_home_widget_caps'],
  },
  {
    id: 'customforms', label: '커스텀 양식 출력 (방문확인증 슬롯·서명·도장)',
    localStorageKeys: [
      'ec_vp_custom_blocks', 'ec_vp_custom_formats', 'ec_vp_custom_labels', 'ec_vp_custom_names',
      'ec_vp_custom_rows', 'ec_vp_custom_slots',
      'ec_vp_reason_removed',   /* 필요/이유 행 − 삭제 상태 (2026-06-11) */
      'ec_vp_symtreat_mode',    /* 증상·처치 분리/합침 모드 — 양식별 (2026-06-16) */
      'ec_vp_content_by_format', /* 내용 선택 — 양식별 독립 (2026-06-19) */
      'ec_vp_teacher_mode',     /* 교사 확인 — 보건·교과·담임 독립 on/off + 켠 순서 — 양식별 (2026-06-20) */
      'ec_vp_sign_image', 'ec_vp_signs', 'ec_vp_stamp_image', 'ec_vp_stamps', 'ec_vpe_margin',
    ],
    localStoragePrefixes: ['ec_vp_editor_', 'ec_vp_tpl_', 'ec_vp_sig_pos_'],   /* sig_pos: 양식별 도장/서명 위치 (2026-06-11 감사 보강) */
    appDataCommonKeys: ['vp_custom_formats', 'vp_signs', 'vp_stamps'],
  },
  {
    id: 'etc', label: '설문·키오스크·수업메모',
    /* 시간표(ec_timetable)는 매 학기 바뀌어 백업 불필요 — 제외 (사용자 결정 2026-05-30). */
    localStorageKeys: [
      'ec_sv_custom',
      'ec_home_lesson_memos', 'ec_home_lesson_semester',
    ],
    localStoragePrefixes: ['ec_kiosk'],   // ec_kiosk, ec_kiosk_definitions, ec_kioskMode 등 일괄
  },
  {
    id: 'calendar', label: '캘린더 일정 (로컬 — Google 캘린더 OFF 시 저장분)',
    /* 홈 캘린더 로컬 일정 (개인 일정). 기존엔 백업 제외였으나 사용자 요청(2026-05-30)으로 선택형 백업 대상 전환.
     *  단일 일정 home_local_events + 기간 일정 home_local_ranges (기말고사 등, 2026-06-22). */
    appDataCommonKeys: ['home_local_events', 'home_local_ranges'],
  },
];

/** categories 의 특정 필드를 평탄화해 중복 없는 배열로 반환. */
function _collect(field, ids) {
  const out = [];
  categories.forEach(function (c) {
    if (ids && ids.indexOf(c.id) === -1) return;
    (c[field] || []).forEach(function (k) { if (out.indexOf(k) === -1) out.push(k); });
  });
  return out;
}

module.exports = {
  categories,

  /** 선택된 카테고리(ids)의 각 대상 키를 모은다. ids 미지정 시 전체. */
  collect(field, ids) { return _collect(field, ids); },

  /* ── 아래 flat 리스트는 categories 에서 자동 파생 (전체 대상) — 기존 코드 하위호환 ── */
  /** Electron localStorage 의 키들 (renderer 의 window.localStorage). */
  localStorageKeys: _collect('localStorageKeys'),
  /** localStorage prefix 키들 — 그 prefix 로 시작하는 모든 키 백업. */
  localStoragePrefixes: _collect('localStoragePrefixes'),
  /** AppDataStore (sqlite app_data_entries 의 common namespace) 의 키들. */
  appDataCommonKeys: _collect('appDataCommonKeys'),
  /** 단일 파일 (userData/ 하위 상대경로). 존재할 때만 백업. */
  files: _collect('files'),

  /** 백업 시점 자동 발견 알림 설정. */
  autoDiscoveryHints: {
    localStoragePrefixes: ['ec_user_', 'ec_custom_', 'ec_my_'],
    excludeKeys: [
      'ec_user',                  // 단순 사용자 마커
      'ec_user_region',           // 사용자 지역 — 학교 의존
      'ec_user_region_applied',
    ],
  },

  /** 명백히 학교/사용자 의존이라 절대 백업 안 함 (블랙리스트 — 사용자 안내용). */
  excludedByDesign: {
    localStorageKeys: [
      'ec_cdkey', 'ec_cdkey_activated', 'ec_cdkey_license', 'ec_cdkey_notify',
      'ec_emergency_records', 'ec_infection_records',
      'ec_bed_config', 'ec_bed_usage',
      'ec_amb_notify_date',
      'ec_session', 'ec_settings', 'ec_user',
      'ec_timetable',             // 시간표 — 매 학기 바뀜, 백업 불필요 (사용자 결정 2026-05-30)
      'ec_home_timetable',        // 주간 시간표(과목·시간) — 학교마다 다름, 학교 이동 시 새로 입력
    ],
    appDataCommonKeys: [
      'bed_config', 'bed_usage',
      'cdkey_activated', 'cdkey_data', 'cdkey_license',
      'ems_saved',
      'school_lat', 'school_lng',
      'semester_info',
      'settings',                 // 학교 설정 (학교명·교사명·인원수 등)
      'memos',
      'feedback_data',
      'user_avatar_',             // 사용자 아바타 prefix
      'user_profile',
      'user_region', 'user_region_applied',
    ],
  },
};
