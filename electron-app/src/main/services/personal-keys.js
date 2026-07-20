/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 개인 데이터 키 격리 — common scope 에 저장되는 키 중 사용자별로 분리해야 하는 항목.
 *
 * 배경: 웹 변형(web-server)에서 여러 보건교사가 한 서버에 접속하면 공용 'common' scope 의
 *   vp_stamps 등 개인 자료가 서로 섞임. storage 단에서 자동으로 `<key>__u<userId>` 로 격리한다.
 *
 *   Electron 호스트(단독 사용자) 도 같은 DB 를 웹 클라이언트들과 공유하므로 동일 규칙 따름.
 *
 *   visit-pass-editor.js 는 _vpPersistVpState 에서 lsKey(ec_*) 형식으로 dbSet 을 호출하지만
 *   data-loader.js 는 dbKey(prefix 없음) 형식으로 dbGet 을 호출한다. 양쪽 호출이 다 들어오므로
 *   PERSONAL_COMMON_KEYS 에 두 형태를 모두 포함한다.
 *
 *   격리 대상 (2026-06-04 확장) — 협업 시 클라이언트가 호스트와 섞이면 안 되는 개인 데이터:
 *     · 도장·서명 이미지 슬롯(visit-pass 출력용)
 *     · 개인 화면 설정(테마·글자크기·배경)
 *     · 개인 UI 레이아웃(탭 순서·표시·열 너비·위젯 정렬)
 *     · 플래너 개인 콘텐츠(루틴·할일·링크·메모·슬라이드·개인 일정)
 *   주의: 학생 보건 메모(memos/ec_memos)·관심학생 태그(vip_tags) 등 건강 데이터는 협업 공유 대상이라
 *         여기 넣으면 안 된다. dbKey(접두사 없음)·ec_(localStorage) 두 형태를 모두 포함한다.
 *   Electron 호스트(main.js)는 스코프를 적용하지 않으므로(접두사 없는 키 그대로) 영향 없음 — 웹 클라이언트만 격리. */

'use strict';

const fs = require('fs');

const PERSONAL_COMMON_KEYS = new Set([
  /* 도장·서명 이미지 슬롯(visit-pass 출력용) */
  'vp_stamps',
  'vp_signs',
  'ec_vp_stamps',
  'ec_vp_signs',
  /* ── 개인 화면 설정(테마·글자크기·배경) ── */
  'bg_mode',          'ec_bg_mode',
  'bg_selected',      'ec_bg_selected',
  'bg_random_daily',  'ec_bg_random_daily',
  'bg_random_weekly', 'ec_bg_random_weekly',
  'theme',            'ec_theme',
  'font_scale',       'ec_fontScale',
  /* ── 개인 UI 레이아웃(탭 순서·표시·열 너비·위젯 정렬) ── */
  'tab_order',         'ec_tab_order',
  'tab_visibility',    'ec_tab_visibility',
  'col_widths',        'ec_col_widths',
  'magic_layout_order','ec_magic_layout_order',
  /* ── 플래너 개인 콘텐츠(루틴·할일·링크·메모·슬라이드·개인 일정) ── */
  'magic_slides',     'ec_magic_slides',
  'magic_memolist',   'ec_magic_memolist',
  'magic_memos',      'ec_magic_memos',
  'magic_routines',   'ec_magic_routines',
  'magic_todos',      'ec_magic_todos',
  'magic_links',      'ec_magic_links',
  'magic_links2',     'ec_magic_links2',
  'gp2_routines',     'ec_gp2_routines',
  'gp2_gtodos',       'ec_gp2_gtodos',
  'home_local_events','ec_home_local_events',
]);

/** common scope 의 키를 userId 로 격리.
 *  - scope 가 'common' 이 아니면 그대로 반환 (year scope 은 격리 불필요).
 *  - PERSONAL_COMMON_KEYS 에 없는 키도 그대로 반환.
 *  - userId 가 비어있으면 그대로 반환 (호출자가 거부 여부를 결정 — 웹 클라이언트는 거부, 호스트는 허용). */
function scopeKey(scope, key, userId) {
  if (scope !== 'common') return key;
  if (!PERSONAL_COMMON_KEYS.has(key)) return key;
  if (userId == null || userId === '') return key;
  return key + '__u' + userId;
}

/** 격리 대상 키 여부 확인. */
function isPersonalKey(scope, key) {
  if (scope !== 'common') return false;
  return PERSONAL_COMMON_KEYS.has(key);
}

/** PERSONAL_COMMON_KEYS 의 모든 키 배열. */
function listPersonalKeys() {
  return Array.from(PERSONAL_COMMON_KEYS);
}

/** 호스트 첫 로그인 시 — common scope 의 legacy unsuffixed 개인 키들을 현재 userId 의 suffixed
 *  키로 이전 (1회성, idempotent). 이미 suffixed 키가 존재하면 skip.
 *
 *  store     : SQLiteAppDataStore 인스턴스 (필수)
 *  jsonFile  : JsonFileService 인스턴스 (선택 — null 이면 JSON 파일 마이그레이션 skip)
 *  userId    : 현재 호스트 사용자 ID (필수)
 *
 *  반환: { migrated: [{key, hadSQLite, hadJSON}], skipped: number }
 *
 *  주의: 호스트 로컬 DB 의 legacy 데이터만 호스트 사용자에게 귀속시킨다.
 *        웹 클라이언트는 마이그레이션을 트리거하지 않는다 (legacy 데이터는 호스트 소유로 간주). */
function migrateLegacyPersonalKeys(store, jsonFile, userId) {
  const result = { migrated: [], skipped: 0 };
  if (!userId) return result;
  if (!store) return result;

  for (const key of PERSONAL_COMMON_KEYS) {
    const suffixed = key + '__u' + userId;

    /* 이미 suffixed 가 SQLite 에 있으면 마이그레이션 됐다고 판단 — skip */
    let alreadyMigrated = false;
    try {
      const r = store.get('common', suffixed);
      if (r && r.exists) alreadyMigrated = true;
    } catch (e) {
      console.error('[migrate-personal-keys] get 확인 실패', key, e.message);
    }

    /* JSON 파일도 확인 — SQLite 에 없어도 JSON 에 있으면 마이그레이션 진행 */
    let alreadyMigratedJson = false;
    if (jsonFile && typeof jsonFile.commonPath === 'function') {
      try {
        const suffixedPath = jsonFile.commonPath(suffixed);
        if (fs.existsSync(suffixedPath)) alreadyMigratedJson = true;
      } catch (e) {}
    }

    if (alreadyMigrated && alreadyMigratedJson) {
      result.skipped++;
      continue;
    }

    const out = { key, hadSQLite: false, hadJSON: false };

    /* SQLite legacy → suffixed */
    if (!alreadyMigrated) {
      try {
        const legacy = store.get('common', key);
        if (legacy && legacy.exists) {
          store.set('common', suffixed, legacy.data);
          store.set('common', key, null); /* legacy 삭제 (deleteStmt 동작) */
          out.hadSQLite = true;
        }
      } catch (e) {
        console.error('[migrate-personal-keys] SQLite 마이그레이션 실패', key, e.message);
      }
    }

    /* JSON 파일 legacy → suffixed */
    if (!alreadyMigratedJson && jsonFile && typeof jsonFile.commonPath === 'function') {
      try {
        const legacyPath = jsonFile.commonPath(key);
        const suffixedPath = jsonFile.commonPath(suffixed);
        const legacyBak = legacyPath + '.bak';
        const suffixedBak = suffixedPath + '.bak';

        if (fs.existsSync(legacyPath)) {
          if (!fs.existsSync(suffixedPath)) {
            fs.renameSync(legacyPath, suffixedPath);
          } else {
            /* suffixed 가 이미 있으면 (이번 함수 안의 SQLite 분기에서 만들어졌을 수 있음) legacy 만 삭제 */
            try { fs.unlinkSync(legacyPath); } catch (e) {}
          }
          out.hadJSON = true;
        }

        /* .bak 도 동일 처리 — 데이터 무결성을 위해 짝을 맞춤 */
        if (fs.existsSync(legacyBak)) {
          if (!fs.existsSync(suffixedBak)) {
            try { fs.renameSync(legacyBak, suffixedBak); } catch (e) {}
          } else {
            try { fs.unlinkSync(legacyBak); } catch (e) {}
          }
        }
      } catch (e) {
        console.error('[migrate-personal-keys] JSON 마이그레이션 실패', key, e.message);
      }
    }

    if (out.hadSQLite || out.hadJSON) result.migrated.push(out);
  }

  return result;
}

module.exports = {
  PERSONAL_COMMON_KEYS,
  scopeKey,
  isPersonalKey,
  listPersonalKeys,
  migrateLegacyPersonalKeys,
};
