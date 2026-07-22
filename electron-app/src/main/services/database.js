/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 4;

/**
 * HealthDiaryDB — 오렌지톡 메인 데이터베이스 (Schema v1 — 초기 배포 베이스라인)
 *
 * 설계 원칙:
 *  - 학생 정체성(students): 불변 정보 (uid, 이름, 성별, 생년월일, 메모)
 *  - 학생 연도별 정보(students_info): 학년도별 재학 정보 (학년/반/번호/학교급 등)
 *  - 교직원(staff): 단일 테이블 (uid 기반)
 *  - 일반 일지 / 응급처치 / 감염병: person_uid + person_type으로 학생/교직원 구분
 *  - 설문 응답: DB에 직렬화 저장 (response_data TEXT)
 *  - 앱 설정: key-value
 */
class HealthDiaryDB {
  constructor(dbPath) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    this.dbPath = dbPath;
    this.db = this._openDb(dbPath);
    this._initSchema();
    this._validateSchema();
    this._prepareStatements();
  }

  _openDb(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    return db;
  }

  /** 스키마 초기화 + 마이그레이션
   *
   *  흐름:
   *    1) _runInitSchema — CREATE TABLE IF NOT EXISTS … (신규 설치자가 v1 베이스라인을 갖게 함)
   *    2) _migrate       — 기존 사용자의 DB 를 SCHEMA_VERSION 까지 끌어올림 (idempotent ALTER 만 사용)
   *
   *  ⚠ 정식 v1.0 출시 후에는 이 함수의 catch 안에서 *DB 통째로 밀어버리는* 동작을 절대 하지 않는다.
   *     마이그레이션이 실패하면 throw 해서 앱이 안 뜨게 두고, 사용자에게 백업 파일 보존을 안내한다.
   */
  _initSchema() {
    /* 신규 설치자 — 빈 DB 에 v1 베이스라인 테이블 생성 */
    this._runInitSchema();
    /* 기존 사용자 — schema_meta.schema_version 을 보고 단계별 ALTER */
    this._migrate();
  }

  /* ═══════════════════════════════════════════
   *  마이그레이션 골격 (정식 v1.0 출시 시점에 도입)
   *
   *  사용 규칙:
   *    · v1.1 출시 = SCHEMA_VERSION 을 2 로 올리고 아래에 `if (cur < 2) { … cur = 2; }` 분기 추가
   *    · 그 분기 안에서는 _ensureColumn / _ensureTable 만 사용 (DROP / RENAME 금지 또는 별도 함수로)
   *    · _runInitSchema 본문은 v1 스키마 그대로 두고 절대 수정하지 않는다
   *      (수정하면 신규 설치자와 마이그레이션 결과가 달라짐 → 데이터 분기)
   * ═══════════════════════════════════════════ */
  _migrate() {
    const row = this.db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get();
    let cur = row ? parseInt(row.value, 10) : 0;
    if (!Number.isFinite(cur) || cur < 1) cur = 1;   /* schema_meta 행이 없거나 손상이면 v1 로 간주 */

    /* ── v1 → v2 ──
     *  V/S 에 BST(혈당) 컬럼 추가. SpO2 는 v1 _runInitSchema 에 이미 포함되어 있어 추가 불요.
     *  daily_records · emergency_records 양쪽 모두 ALTER 로 추가 (idempotent: 이미 있으면 무해 return). */
    if (cur < 2) {
      console.log('[DB-MIG] v1 → v2  +bst');
      cur = 2;
    }
    /* ── v2 → v3 ──
     *  treatment_by_sym 추가: 다중 증상 시 어느 처치가 어느 증상의 것인지 매핑 (사용자 결정 2026-05-20).
     *  포맷: JSON object — { "증상라벨": ["처치1", "처치2"], ... }.
     *  옛 record 는 NULL/빈 문자열 → 렌더러가 "선택 증상에 대한 처치" 단일 블록으로 폴백.
     *  통계·출력·엑셀은 기존 treatment 평탄 배열을 그대로 읽으므로 무영향. */
    if (cur < 3) {
      console.log('[DB-MIG] v2 → v3  +treatment_by_sym');
      cur = 3;
    }
    /* ── v3 → v4 ──
     *  today_memos 테이블 추가: "오늘의 메모" (일반 일지 상단 토글의 날짜별 2행 N칸 표, 2026-06-10).
     *  이름 충돌 감사 완료: 기존 13개 테이블에 memo 계열 없음 / daily_records.memo(주의사항)·
     *  students.memo_json(스티커 메모)·ec_home_lesson_memos(수업 메모) 등과 전부 별개 차원.
     *  실제 CREATE 는 아래 self-healing _ensureTable 이 수행 (매 부팅 idempotent — 버전 모순 상태도 자동 복구). */
    if (cur < 4) {
      console.log('[DB-MIG] v3 → v4  +today_memos');
      cur = 4;
    }
    /* Self-healing — schema_meta 가 어떤 값이든 매번 idempotent 검사.
     * 옛 코드에서 schema_version 만 올리고 ALTER 가 누락된 모순 상태(=현재 사용자 DB)도
     * 다음 실행 한 번이면 자동 복구됨. _ensureColumn 자체가 PRAGMA 로 컬럼 존재 확인 후
     * 없을 때만 ALTER 라서 안전. */
    this._ensureColumn('daily_records', 'bst', 'bst TEXT DEFAULT ""');
    this._ensureColumn('emergency_records', 'vital_bst', 'vital_bst TEXT DEFAULT ""');
    this._ensureColumn('daily_records', 'treatment_by_sym', 'treatment_by_sym TEXT DEFAULT ""');
    /* v1 베이스라인에 포함되지만 옛 빌드(베타 초기) 로 설치된 사용자 DB 에는
     * 누락돼 있을 수 있는 컬럼들 — _prepareStatements 가 참조하므로 self-heal 필수.
     * 보고 케이스: 2026-05-14 SqliteError "table students_info has no column named vip" */
    this._ensureColumn('students_info', 'vip', "vip TEXT DEFAULT ''");
    this._ensureColumn('staff', 'vip', "vip TEXT DEFAULT ''");
    /* v4 — 오늘의 메모 (날짜별 칸 내용). CREATE TABLE IF NOT EXISTS 라 매 부팅 무해. */
    this._ensureTable(`
      CREATE TABLE IF NOT EXISTS today_memos (
        visit_date  TEXT PRIMARY KEY,        -- 'YYYY-MM-DD'
        cells_json  TEXT NOT NULL DEFAULT '[]',  -- 칸 내용 배열 JSON (최대 5칸)
        updated_at  TEXT
      )
    `);

    /* schema_meta 갱신 — 마이그레이션이 끝났든 말든 항상 현재 코드 버전으로 맞춘다 */
    if (cur !== SCHEMA_VERSION) {
      console.log('[DB-MIG] schema_version', cur, '→', SCHEMA_VERSION);
    }
    this.db.prepare(`
      INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(SCHEMA_VERSION));
  }

  /** 컬럼이 없으면 ALTER TABLE ADD COLUMN — idempotent.
   *  ddl 은 컬럼 정의 전체 (예: 'phone_number TEXT DEFAULT ""'). */
  _ensureColumn(table, column, ddl) {
    let cols = [];
    try { cols = this.db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name); }
    catch (e) { console.warn('[DB-MIG] _ensureColumn: table_info 실패', table, e.message); return; }
    if (cols.includes(column)) return;
    this.db.exec(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`);
    console.log('[DB-MIG] +column', table + '.' + column);
  }

  /** 테이블이 없으면 CREATE TABLE — idempotent.
   *  createSql 은 'CREATE TABLE IF NOT EXISTS …' 본문 통째로 받는다. */
  _ensureTable(createSql) {
    this.db.exec(createSql);
  }

  /* ═══════════════════════════════════════════
   *  스키마 초기화 (v1 — fresh DB)
   * ═══════════════════════════════════════════ */

  _runInitSchema() {
    this.db.exec(`
      /* ── 스키마 버전 관리 ── */
      CREATE TABLE IF NOT EXISTS schema_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      /* ══════════════════════════════════════
       *  사용자 (보건교사/처치자)
       *  — daily_records.nurse_id 참조를 위해 먼저 생성
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        position      TEXT    DEFAULT '보건교사',
        school_name   TEXT    DEFAULT '',
        school_level  TEXT    DEFAULT 'elementary',
        edu_office    TEXT    DEFAULT '',
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );

      /* ══════════════════════════════════════
       *  학생 (불변 정체성)
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS students (
        uid         TEXT PRIMARY KEY,              -- s0001, s0002, ...
        name        TEXT NOT NULL,
        gender      TEXT DEFAULT '',
        birth_date  TEXT DEFAULT '',
        memo_json   TEXT DEFAULT '{}',             -- JSON: 10개 스티커 메모
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_students_name_birth
        ON students(name, birth_date);

      /* ══════════════════════════════════════
       *  학생 연도별 정보 (학년도별 재학 정보)
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS students_info (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        uid               TEXT    NOT NULL REFERENCES students(uid),
        school_year       TEXT    NOT NULL,          -- e.g. '2026' (3/1 시작 학년도)
        grade             INTEGER,
        class_num         INTEGER,
        student_num       INTEGER,
        level             TEXT    DEFAULT '',        -- 학교급: 유/초/중/고/대
        department        TEXT    DEFAULT '',        -- 학과
        guardian_type     TEXT    DEFAULT '',
        guardian_contact  TEXT    DEFAULT '',
        homeroom_teacher  TEXT    DEFAULT '',
        is_enrolled       INTEGER NOT NULL DEFAULT 1,
        is_care           INTEGER NOT NULL DEFAULT 0,
        care_reason       TEXT    DEFAULT '',
        dust_disease      TEXT    DEFAULT '',
        care_memo         TEXT    DEFAULT '',
        med_consent       TEXT    DEFAULT 'Y',
        emergency_consent TEXT    DEFAULT 'Y',
        vip               TEXT    DEFAULT '',          -- VIP 표시: 빈 문자열=OFF, 텍스트=ON
        extra_json        TEXT    DEFAULT '{}',
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL,
        UNIQUE(uid, school_year)
      );

      CREATE INDEX IF NOT EXISTS idx_si_year_enrolled
        ON students_info(school_year, is_enrolled);
      CREATE INDEX IF NOT EXISTS idx_si_uid
        ON students_info(uid);

      /* ══════════════════════════════════════
       *  교직원
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS staff (
        uid             TEXT PRIMARY KEY,            -- t0001, t0002, ...
        school_year     TEXT NOT NULL,               -- 등록/활동 학년도
        position        TEXT DEFAULT '',
        name            TEXT NOT NULL,
        gender          TEXT DEFAULT '',
        birth_date      TEXT DEFAULT '',               -- 생년월일: 동명이인 tiebreaker 용
        family_relation TEXT DEFAULT '',
        family_phone    TEXT DEFAULT '',
        is_active       INTEGER NOT NULL DEFAULT 1,
        vip             TEXT    DEFAULT '',             -- VIP 표시: 빈 문자열=OFF, 텍스트=ON
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_year
        ON staff(school_year);
      CREATE INDEX IF NOT EXISTS idx_staff_name
        ON staff(name);

      /* ══════════════════════════════════════
       *  일반 보건일지 (5년 보관)
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS daily_records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year     TEXT    NOT NULL,
        person_uid      TEXT,                        -- FK to students.uid or staff.uid
        person_type     TEXT    DEFAULT 'student',   -- 'student' or 'staff'
        visit_date      TEXT    NOT NULL,
        time_in         TEXT,
        time_out        TEXT,
        symptoms        TEXT    DEFAULT '[]',
        treatment       TEXT    DEFAULT '',
        medication      TEXT    DEFAULT '',
        department      TEXT    DEFAULT '',
        body_temp       TEXT    DEFAULT '',
        blood_pressure  TEXT    DEFAULT '',
        pulse           TEXT    DEFAULT '',
        respiration     TEXT    DEFAULT '',
        spo2            TEXT    DEFAULT '',
        result_code     TEXT    DEFAULT '',
        nurse_name      TEXT    DEFAULT '',
        nurse_id        INTEGER REFERENCES users(id),
        memo            TEXT    DEFAULT '',
        bodymap_json    TEXT    DEFAULT '[]',
        vip_tags        TEXT    DEFAULT '[]',
        bed             TEXT    DEFAULT '',             -- 사용 침상 번호/라벨 (통계용)
        is_imported     INTEGER DEFAULT 0,
        extra_json      TEXT    DEFAULT '{}',
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_daily_year_date
        ON daily_records(school_year, visit_date);
      CREATE INDEX IF NOT EXISTS idx_daily_person
        ON daily_records(person_uid);

      /* ══════════════════════════════════════
       *  응급처치 기록
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS emergency_records (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year       TEXT    NOT NULL,
        person_uid        TEXT,
        person_type       TEXT    DEFAULT 'student',
        -- 사고 발생 정보
        accident_date     TEXT    DEFAULT '',
        accident_time     TEXT    DEFAULT '',
        location          TEXT    DEFAULT '',
        situation         TEXT    DEFAULT '',
        -- 환자 상태
        patient_status    TEXT    DEFAULT '',
        consciousness     TEXT    DEFAULT '명료',     -- 명료/혼미/반혼수/혼수
        -- 생체 징후
        vital_temp        TEXT    DEFAULT '',
        vital_pulse       TEXT    DEFAULT '',
        vital_bp          TEXT    DEFAULT '',
        vital_resp        TEXT    DEFAULT '',
        vital_spo2        TEXT    DEFAULT '',
        -- 사고 개요
        summary           TEXT    DEFAULT '',
        -- 응급처치 기록
        treatment         TEXT    DEFAULT '',
        -- 이송 정보
        is_transported    INTEGER DEFAULT 0,
        transport_method  TEXT    DEFAULT '',
        transport_dest    TEXT    DEFAULT '',
        -- 작성 정보
        author_date       TEXT    DEFAULT '',
        author_name       TEXT    DEFAULT '',
        -- 추가 정보
        guardian_contact  TEXT    DEFAULT '',
        homeroom_teacher  TEXT    DEFAULT '',
        memo              TEXT    DEFAULT '',
        extra_json        TEXT    DEFAULT '{}',
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_emergency_year
        ON emergency_records(school_year);
      CREATE INDEX IF NOT EXISTS idx_emergency_person
        ON emergency_records(person_uid);

      /* ══════════════════════════════════════
       *  감염병 기록
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS infection_records (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year         TEXT    NOT NULL,
        person_uid          TEXT,
        person_type         TEXT    DEFAULT 'student',
        -- 감염병 기본 정보
        disease_name        TEXT    DEFAULT '',
        hospital            TEXT    DEFAULT '',
        diag_date           TEXT    DEFAULT '',
        onset_date          TEXT    DEFAULT '',
        report_date         TEXT    DEFAULT '',
        -- 관리 현황
        is_suspended        INTEGER DEFAULT 0,
        suspend_start       TEXT    DEFAULT '',
        expected_return     TEXT    DEFAULT '',
        actual_return       TEXT    DEFAULT '',
        -- 증상
        main_symptoms       TEXT    DEFAULT '',
        has_fever           TEXT    DEFAULT '아니오',
        has_cough           TEXT    DEFAULT '아니오',
        has_throat          TEXT    DEFAULT '아니오',
        other_symptoms      TEXT    DEFAULT '',
        -- 감염 경로
        infection_route     TEXT    DEFAULT '',
        school_contact      TEXT    DEFAULT '아니오',
        class_contact       TEXT    DEFAULT '아니오',
        situation_memo      TEXT    DEFAULT '',
        -- 조치 사항
        parent_notified     TEXT    DEFAULT '아니오',
        notify_time         TEXT    DEFAULT '',
        hospital_visit      TEXT    DEFAULT '아니오',
        is_isolated         TEXT    DEFAULT '아니오',
        additional_actions  TEXT    DEFAULT '',
        -- 경과 관찰 (JSON array of {date, status, temp, notes, recorder})
        progress_json       TEXT    DEFAULT '[]',
        -- 추가 메모
        additional_memo     TEXT    DEFAULT '',
        -- 작성 정보
        author_date         TEXT    DEFAULT '',
        author_name         TEXT    DEFAULT '',
        memo                TEXT    DEFAULT '',
        extra_json          TEXT    DEFAULT '{}',
        created_at          TEXT    NOT NULL,
        updated_at          TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_infection_year
        ON infection_records(school_year);
      CREATE INDEX IF NOT EXISTS idx_infection_person
        ON infection_records(person_uid);

      /* ══════════════════════════════════════
       *  건강상담 기록 (counseling_records)
       *  — 요양호 대상자 또는 건강 추적을 위한 상담 내역
       *  — 학년별 · 개인별 타임라인 형태로 누적 관리
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS counseling_records (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year       TEXT    NOT NULL,
        person_uid        TEXT,                  -- s000001 / t000001
        person_type       TEXT    DEFAULT 'student',
        -- 상담 기본 정보
        counsel_date      TEXT    DEFAULT '',    -- YYYY-MM-DD
        counsel_time      TEXT    DEFAULT '',    -- HH:MM
        counsel_type      TEXT    DEFAULT '',    -- 정기/요청/위기 등
        counsel_reason    TEXT    DEFAULT '',    -- 상담 주제·사유
        -- 상담 내용 (핵심 텍스트)
        content           TEXT    DEFAULT '',    -- 상담 내용 본문
        follow_up         TEXT    DEFAULT '',    -- 추후 조치·계획
        -- 작성 정보
        author_date       TEXT    DEFAULT '',
        author_name       TEXT    DEFAULT '',
        memo              TEXT    DEFAULT '',
        extra_json        TEXT    DEFAULT '{}',
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_counseling_year
        ON counseling_records(school_year);
      CREATE INDEX IF NOT EXISTS idx_counseling_person
        ON counseling_records(person_uid);

      /* ══════════════════════════════════════
       *  [REMOVED] survey_forms 테이블 삭제됨 — 설문 양식은 JSON 파일로 관리
       *  추후 건강설문 재삽입 시 필요하면 복원
       * ══════════════════════════════════════ */

      /* ══════════════════════════════════════
       *  설문 응답 (응답 JSON을 DB에 직접 저장)
       *  — survey_forms 참조 없이 독립 운용
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS survey_responses (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year           TEXT    NOT NULL,
        form_id               TEXT    NOT NULL, -- JSON 파일 기반 양식 ID
        form_version          INTEGER NOT NULL DEFAULT 1,
        person_uid            TEXT,                  -- FK to students.uid
        student_persistent_id TEXT    NOT NULL,      -- 레거시 호환 유지
        student_name          TEXT    NOT NULL,
        birth_date            TEXT,
        grade                 INTEGER,
        class_num             INTEGER,
        student_num           INTEGER,
        responded_at          TEXT    NOT NULL,
        response_data         TEXT    NOT NULL DEFAULT '{}',
        status                TEXT    DEFAULT 'completed',
        created_at            TEXT    NOT NULL,
        UNIQUE(school_year, form_id, student_persistent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_survey_resp_student
        ON survey_responses(student_persistent_id);
      CREATE INDEX IF NOT EXISTS idx_survey_resp_year_form
        ON survey_responses(school_year, form_id);

      /* ══════════════════════════════════════
       *  앱 설정 (key-value)
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      /* ══════════════════════════════════════
       *  외부 데이터 가져오기 스테이징
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS import_staging (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        visit_date          TEXT    NOT NULL DEFAULT '',
        grade               TEXT    DEFAULT '',
        class_num           TEXT    DEFAULT '',
        student_num         TEXT    DEFAULT '',
        student_name        TEXT    DEFAULT '',
        gender              TEXT    DEFAULT '',
        symptoms            TEXT    DEFAULT '',
        treatment           TEXT    DEFAULT '',
        medication          TEXT    DEFAULT '',
        department          TEXT    DEFAULT '',
        result_code         TEXT    DEFAULT '',
        memo                TEXT    DEFAULT '',
        time_in             TEXT    DEFAULT '',
        time_out            TEXT    DEFAULT '',
        nurse_name          TEXT    DEFAULT '',
        level               TEXT    DEFAULT '',
        matched_person_uid  TEXT    DEFAULT NULL,
        match_status        TEXT    DEFAULT 'pending',
        imported_at         TEXT    DEFAULT (datetime('now','localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_import_staging_date ON import_staging(visit_date);
      CREATE INDEX IF NOT EXISTS idx_import_staging_name ON import_staging(student_name);

      /* ══════════════════════════════════════
       *  교직원 잠복결핵 검사 기록 (영구 보관 — 5년 삭제 대상 아님)
       * ══════════════════════════════════════ */
      CREATE TABLE IF NOT EXISTS tb_tests (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        test_year     TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        position      TEXT    DEFAULT '',
        birth_date    TEXT    DEFAULT '',
        gender        TEXT    DEFAULT '',
        test_date     TEXT    DEFAULT '',
        test_type     TEXT    DEFAULT '',
        institution   TEXT    DEFAULT '',
        memo          TEXT    DEFAULT '',
        uploaded_at   TEXT    DEFAULT '',
        registered_at TEXT    DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_tb_name ON tb_tests(name);
      CREATE INDEX IF NOT EXISTS idx_tb_year ON tb_tests(test_year);
    `);

    /* 스키마 버전 기록 — 신규 설치자 전용. 기존 사용자(이미 schema_version 행이 있음)는
       건드리지 않아야 _migrate() 가 정확한 cur 값을 읽을 수 있다.
       (ON CONFLICT DO UPDATE 로 덮어쓰면 마이그레이션 전에 신버전으로 박혀 ALTER 분기가 통과되지 않는다.) */
    this.db.prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO NOTHING
    `).run(String(SCHEMA_VERSION));
  }

  /** 필수 테이블 존재 여부 검증 */
  _validateSchema() {
    const requiredTables = [
      'schema_meta', 'users',
      'students', 'students_info', 'staff',
      'daily_records', 'emergency_records', 'infection_records',
      'counseling_records',
      'survey_responses',
      'app_settings', 'import_staging',
      'tb_tests',
    ];
    const existingTables = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    const missing = requiredTables.filter(t => !existingTables.includes(t));
    if (missing.length > 0) {
      throw new Error('스키마 검증 실패 — 필수 테이블 누락: ' + missing.join(', '));
    }
  }

  /* ═══════════════════════════════════════════
   *  Prepared Statements
   * ═══════════════════════════════════════════ */

  _prepareStatements() {
    const db = this.db;

    this.stmt = {

      /* ════════════════════════════════════
       *  students (불변 정체성)
       * ════════════════════════════════════ */
      studentsGetAll: db.prepare(`
        SELECT * FROM students ORDER BY name
      `),
      studentsGetByUid: db.prepare(`
        SELECT * FROM students WHERE uid = ?
      `),
      studentsGetByName: db.prepare(`
        SELECT * FROM students WHERE name = ?
      `),
      studentsGetByNameBirth: db.prepare(`
        SELECT * FROM students WHERE name = ? AND birth_date = ?
      `),
      studentsGetByNameGender: db.prepare(`
        SELECT * FROM students WHERE name = ? AND gender = ?
      `),
      studentsUpsert: db.prepare(`
        INSERT INTO students (uid, name, gender, birth_date, memo_json, created_at, updated_at)
        VALUES (@uid, @name, @gender, @birth_date, @memo_json, @created_at, @updated_at)
        ON CONFLICT(uid) DO UPDATE SET
          name=excluded.name,
          gender=excluded.gender,
          birth_date=excluded.birth_date,
          memo_json=excluded.memo_json,
          updated_at=excluded.updated_at
      `),
      studentsDelete: db.prepare(`DELETE FROM students WHERE uid = ?`),

      /* ════════════════════════════════════
       *  students_info (연도별 재학 정보)
       * ════════════════════════════════════ */
      siGetByYear: db.prepare(`
        SELECT si.*, s.name, s.gender, s.birth_date, s.memo_json
        FROM students_info si
        JOIN students s ON si.uid = s.uid
        WHERE si.school_year = ? AND si.is_enrolled = 1
        ORDER BY si.grade, si.class_num, si.student_num
      `),
      siGetByYearAll: db.prepare(`
        SELECT si.*, s.name, s.gender, s.birth_date, s.memo_json
        FROM students_info si
        JOIN students s ON si.uid = s.uid
        WHERE si.school_year = ?
        ORDER BY si.grade, si.class_num, si.student_num
      `),
      /* 모든 학생 통합 조회 — 학년도 무관, 가장 최근 students_info 행을 LEFT JOIN.
       *  보건일지 행의 person_uid 가 가리키는 학생이 현재 학년도 등록 정보가 없어도(과거 등록자)
       *  이름·학년·반·번호·학과 등을 resolve 할 수 있게 함. (S.leavers 적재용) */
      siGetAllPeopleWithLatestInfo: db.prepare(`
        SELECT s.uid, s.name, s.gender, s.birth_date, s.memo_json,
               si.school_year, si.grade, si.class_num, si.student_num,
               si.level, si.department, si.is_enrolled,
               si.guardian_type, si.guardian_contact, si.homeroom_teacher,
               si.is_care, si.care_reason, si.dust_disease, si.care_memo,
               si.med_consent, si.emergency_consent, si.vip
        FROM students s
        LEFT JOIN students_info si ON si.uid = s.uid
          AND si.school_year = (SELECT MAX(school_year) FROM students_info WHERE uid = s.uid)
        ORDER BY s.name
      `),
      siGetByUid: db.prepare(`
        SELECT si.*, s.name, s.gender, s.birth_date, s.memo_json
        FROM students_info si
        JOIN students s ON si.uid = s.uid
        WHERE si.uid = ?
        ORDER BY si.school_year DESC
      `),
      siGetByUidYear: db.prepare(`
        SELECT si.*, s.name, s.gender, s.birth_date, s.memo_json
        FROM students_info si
        JOIN students s ON si.uid = s.uid
        WHERE si.uid = ? AND si.school_year = ?
      `),
      /* 자리(학년·반·번호)로 올해 그 자리의 학생 조회 — upsert 의 자리 우선 매칭용 (2026-06-12).
         is_enrolled 무관(빈 자리 판정은 재학 여부 아닌 자리 점유 기준). 같은 자리 다른 이름 덮어쓰기 방지. */
      siGetByYearPosition: db.prepare(`
        SELECT si.uid, s.name, s.gender, si.is_enrolled
        FROM students_info si
        JOIN students s ON si.uid = s.uid
        WHERE si.school_year = @yr AND si.grade IS @grade
          AND si.class_num IS @class_num AND si.student_num IS @student_num
          AND IFNULL(si.level,'') = @level
          AND IFNULL(si.department,'') = @department
        ORDER BY si.is_enrolled DESC
        LIMIT 1
      `),
      siGetCare: db.prepare(`
        SELECT si.*, s.name, s.gender, s.birth_date, s.memo_json
        FROM students_info si
        JOIN students s ON si.uid = s.uid
        WHERE si.school_year = ? AND si.is_enrolled = 1 AND si.is_care = 1
        ORDER BY si.grade, si.class_num, si.student_num
      `),
      siUpsert: db.prepare(`
        INSERT INTO students_info (
          uid, school_year, grade, class_num, student_num,
          level, department, guardian_type, guardian_contact, homeroom_teacher,
          is_enrolled, is_care, care_reason, dust_disease, care_memo,
          med_consent, emergency_consent, vip, extra_json, created_at, updated_at
        ) VALUES (
          @uid, @school_year, @grade, @class_num, @student_num,
          @level, @department, @guardian_type, @guardian_contact, @homeroom_teacher,
          @is_enrolled, @is_care, @care_reason, @dust_disease, @care_memo,
          @med_consent, @emergency_consent, @vip, @extra_json, @created_at, @updated_at
        ) ON CONFLICT(uid, school_year) DO UPDATE SET
          grade=excluded.grade,
          class_num=excluded.class_num,
          student_num=excluded.student_num,
          level=excluded.level,
          department=excluded.department,
          guardian_type=excluded.guardian_type,
          guardian_contact=excluded.guardian_contact,
          homeroom_teacher=excluded.homeroom_teacher,
          is_enrolled=excluded.is_enrolled,
          is_care=excluded.is_care,
          care_reason=excluded.care_reason,
          dust_disease=excluded.dust_disease,
          care_memo=excluded.care_memo,
          med_consent=excluded.med_consent,
          emergency_consent=excluded.emergency_consent,
          vip=excluded.vip,
          extra_json=excluded.extra_json,
          updated_at=excluded.updated_at
      `),
      siDelete: db.prepare(`DELETE FROM students_info WHERE uid = ? AND school_year = ?`),
      siDeleteByUid: db.prepare(`DELETE FROM students_info WHERE uid = ?`),
      siSetEnrolled: db.prepare(`UPDATE students_info SET is_enrolled = ?, updated_at = ? WHERE uid = ? AND school_year = ?`),
      /* uid 의 모든 학년도 등록 상태를 0(졸업/전출/퇴학) 으로 일괄 변경 — students 행은 보존 */
      siUnenrollAllByUid: db.prepare(`UPDATE students_info SET is_enrolled = 0, updated_at = ? WHERE uid = ?`),
      /* 이번 학년도 전체 명단 일괄 삭제(soft) — 행은 보존, is_enrolled 만 0 (보건일지 참조 끊김 없음). 2026-06-12 */
      siUnenrollAllForYear: db.prepare(`UPDATE students_info SET is_enrolled = 0, updated_at = @now WHERE school_year = @yr AND is_enrolled = 1`),
      siCountByYear: db.prepare(`SELECT COUNT(*) AS cnt FROM students_info WHERE school_year = ? AND is_enrolled = 1`),
      siYears: db.prepare(`SELECT DISTINCT school_year FROM students_info ORDER BY school_year DESC`),

      /* ════════════════════════════════════
       *  staff (교직원)
       * ════════════════════════════════════ */
      staffGetByYear: db.prepare(`
        SELECT * FROM staff WHERE school_year = ? AND is_active = 1 ORDER BY name
      `),
      staffGetByYearAll: db.prepare(`
        SELECT * FROM staff WHERE school_year = ? ORDER BY name
      `),
      /* 모든 교직원 통합 조회 — 학년도·재직 상태 무관. 보건일지 행의 person_uid 가
       *  과거 교직원을 가리키더라도 이름 resolve 할 수 있게 함. (S.leavers 적재용) */
      staffGetAllRaw: db.prepare(`SELECT * FROM staff ORDER BY name`),
      staffGetByUid: db.prepare(`
        SELECT * FROM staff WHERE uid = ?
      `),
      staffGetByNameGender: db.prepare(`
        SELECT * FROM staff WHERE name = ? AND gender = ? ORDER BY school_year DESC
      `),
      staffGetAll: db.prepare(`
        SELECT * FROM staff ORDER BY school_year DESC, name
      `),
      staffUpsert: db.prepare(`
        INSERT INTO staff (
          uid, school_year, position, name, gender, birth_date,
          family_relation, family_phone, is_active, vip, created_at, updated_at
        ) VALUES (
          @uid, @school_year, @position, @name, @gender, @birth_date,
          @family_relation, @family_phone, @is_active, @vip, @created_at, @updated_at
        ) ON CONFLICT(uid) DO UPDATE SET
          school_year=excluded.school_year,
          position=excluded.position,
          name=excluded.name,
          gender=excluded.gender,
          birth_date=excluded.birth_date,
          family_relation=excluded.family_relation,
          family_phone=excluded.family_phone,
          is_active=excluded.is_active,
          vip=excluded.vip,
          updated_at=excluded.updated_at
      `),
      staffDelete: db.prepare(`DELETE FROM staff WHERE uid = ?`),
      staffDeactivate: db.prepare(`UPDATE staff SET is_active = 0, updated_at = ? WHERE uid = ?`),
      /* 이번 학년도 교직원 전체 명단 일괄 삭제(soft) — 행 보존, is_active 만 0. 2026-06-12 */
      staffDeactivateAllForYear: db.prepare(`UPDATE staff SET is_active = 0, updated_at = @now WHERE school_year = @yr AND is_active = 1`),

      /* ════════════════════════════════════
       *  daily_records (일반 보건일지)
       * ════════════════════════════════════ */
      dailyGetByYearDate: db.prepare(`
        SELECT d.*,
               CASE d.person_type
                 WHEN 'student' THEN s.name
                 WHEN 'staff'   THEN st.name
               END AS person_name,
               si.grade  AS student_grade,
               si.class_num AS student_class,
               si.student_num AS student_num2,
               si.is_care,
               si.care_reason,
               si.level  AS student_level,
               si.department AS student_department,
               s.gender  AS student_gender,
               st.position AS staff_position
        FROM daily_records d
        LEFT JOIN students s  ON d.person_type = 'student' AND d.person_uid = s.uid
        LEFT JOIN students_info si ON d.person_type = 'student' AND d.person_uid = si.uid AND si.school_year = d.school_year
        LEFT JOIN staff st    ON d.person_type = 'staff'   AND d.person_uid = st.uid
        WHERE d.school_year = ? AND d.visit_date = ?
        ORDER BY d.time_in
      `),
      dailyGetByYear: db.prepare(`
        SELECT * FROM daily_records WHERE school_year = ? ORDER BY visit_date DESC, time_in DESC
      `),
      dailyGetByYearExcludeImported: db.prepare(`
        SELECT * FROM daily_records
        WHERE school_year = ? AND (is_imported IS NULL OR is_imported = 0)
        ORDER BY visit_date DESC, time_in DESC
      `),
      dailyGetByDateRange: db.prepare(`
        SELECT d.*,
               CASE d.person_type
                 WHEN 'student' THEN s.name
                 WHEN 'staff'   THEN st.name
               END AS person_name,
               si.grade AS student_grade,
               si.class_num AS student_class,
               si.student_num AS student_num2,
               si.is_care,
               si.care_reason,
               si.level AS student_level,
               si.department AS student_department,
               s.gender AS student_gender,
               st.position AS staff_position
        FROM daily_records d
        LEFT JOIN students s  ON d.person_type = 'student' AND d.person_uid = s.uid
        LEFT JOIN students_info si ON d.person_type = 'student' AND d.person_uid = si.uid AND si.school_year = d.school_year
        LEFT JOIN staff st    ON d.person_type = 'staff'   AND d.person_uid = st.uid
        WHERE d.visit_date >= ? AND d.visit_date <= ?
        ORDER BY d.visit_date ASC, d.time_in ASC
      `),
      dailyGetByPerson: db.prepare(`
        SELECT * FROM daily_records WHERE person_uid = ? ORDER BY visit_date DESC, time_in DESC
      `),
      dailyGetById: db.prepare(`SELECT * FROM daily_records WHERE id = ?`),
      dailyInsert: db.prepare(`
        INSERT INTO daily_records (
          school_year, person_uid, person_type,
          visit_date, time_in, time_out,
          symptoms, treatment, treatment_by_sym, medication, department,
          body_temp, blood_pressure, pulse, respiration, spo2, bst,
          result_code, nurse_name, nurse_id,
          memo, bodymap_json, vip_tags, bed,
          is_imported, extra_json, created_at, updated_at
        ) VALUES (
          @school_year, @person_uid, @person_type,
          @visit_date, @time_in, @time_out,
          @symptoms, @treatment, @treatment_by_sym, @medication, @department,
          @body_temp, @blood_pressure, @pulse, @respiration, @spo2, @bst,
          @result_code, @nurse_name, @nurse_id,
          @memo, @bodymap_json, @vip_tags, @bed,
          @is_imported, @extra_json, @created_at, @updated_at
        )
      `),
      dailyUpdate: db.prepare(`
        UPDATE daily_records SET
          person_uid=@person_uid, person_type=@person_type,
          visit_date=@visit_date, time_in=@time_in, time_out=@time_out,
          symptoms=@symptoms, treatment=@treatment, treatment_by_sym=@treatment_by_sym,
          medication=@medication, department=@department,
          body_temp=@body_temp, blood_pressure=@blood_pressure,
          pulse=@pulse, respiration=@respiration, spo2=@spo2, bst=@bst,
          result_code=@result_code, nurse_name=@nurse_name, nurse_id=@nurse_id,
          memo=@memo, bodymap_json=@bodymap_json, vip_tags=@vip_tags, bed=@bed,
          extra_json=@extra_json, updated_at=@updated_at
        WHERE id = @id
      `),
      dailyDelete: db.prepare(`DELETE FROM daily_records WHERE id = ?`),
      dailyDeleteByYear: db.prepare(`DELETE FROM daily_records WHERE school_year = ?`),
      dailyDeleteBeforeDate: db.prepare(`DELETE FROM daily_records WHERE visit_date <= ?`),
      dailyCountBeforeDate: db.prepare(`SELECT COUNT(*) AS cnt FROM daily_records WHERE visit_date <= ?`),
      dailyCountByYear: db.prepare(`SELECT school_year, COUNT(*) AS cnt FROM daily_records GROUP BY school_year`),
      dailyCountForYear: db.prepare(`SELECT COUNT(*) AS cnt FROM daily_records WHERE school_year = ?`),
      dailyYears: db.prepare(`SELECT DISTINCT school_year FROM daily_records ORDER BY school_year`),

      /* ════════════════════════════════════
       *  emergency_records (응급처치)
       * ════════════════════════════════════ */
      emergencyGetByYear: db.prepare(`
        SELECT e.*,
               CASE e.person_type
                 WHEN 'student' THEN s.name
                 WHEN 'staff'   THEN st.name
               END AS person_name,
               si.grade AS student_grade,
               si.class_num AS student_class,
               si.student_num AS student_num2,
               si.is_care,
               s.gender AS student_gender
        FROM emergency_records e
        LEFT JOIN students s  ON e.person_type = 'student' AND e.person_uid = s.uid
        LEFT JOIN students_info si ON e.person_type = 'student' AND e.person_uid = si.uid AND si.school_year = e.school_year
        LEFT JOIN staff st    ON e.person_type = 'staff'   AND e.person_uid = st.uid
        WHERE e.school_year = ?
        ORDER BY e.accident_date DESC, e.accident_time DESC
      `),
      emergencyGetById: db.prepare(`SELECT * FROM emergency_records WHERE id = ?`),
      emergencyInsert: db.prepare(`
        INSERT INTO emergency_records (
          school_year, person_uid, person_type,
          accident_date, accident_time, location, situation,
          patient_status, consciousness,
          vital_temp, vital_pulse, vital_bp, vital_resp, vital_spo2, vital_bst,
          summary, treatment,
          is_transported, transport_method, transport_dest,
          author_date, author_name,
          guardian_contact, homeroom_teacher,
          memo, extra_json, created_at, updated_at
        ) VALUES (
          @school_year, @person_uid, @person_type,
          @accident_date, @accident_time, @location, @situation,
          @patient_status, @consciousness,
          @vital_temp, @vital_pulse, @vital_bp, @vital_resp, @vital_spo2, @vital_bst,
          @summary, @treatment,
          @is_transported, @transport_method, @transport_dest,
          @author_date, @author_name,
          @guardian_contact, @homeroom_teacher,
          @memo, @extra_json, @created_at, @updated_at
        )
      `),
      emergencyUpdate: db.prepare(`
        UPDATE emergency_records SET
          person_uid=@person_uid, person_type=@person_type,
          accident_date=@accident_date, accident_time=@accident_time,
          location=@location, situation=@situation,
          patient_status=@patient_status, consciousness=@consciousness,
          vital_temp=@vital_temp, vital_pulse=@vital_pulse,
          vital_bp=@vital_bp, vital_resp=@vital_resp, vital_spo2=@vital_spo2, vital_bst=@vital_bst,
          summary=@summary, treatment=@treatment,
          is_transported=@is_transported, transport_method=@transport_method,
          transport_dest=@transport_dest,
          author_date=@author_date, author_name=@author_name,
          guardian_contact=@guardian_contact, homeroom_teacher=@homeroom_teacher,
          memo=@memo, extra_json=@extra_json, updated_at=@updated_at
        WHERE id = @id
      `),
      emergencyDelete: db.prepare(`DELETE FROM emergency_records WHERE id = ?`),
      emergencyDeleteByYear: db.prepare(`DELETE FROM emergency_records WHERE school_year = ?`),
      emergencyDeleteBeforeDate: db.prepare(`DELETE FROM emergency_records WHERE accident_date <= ?`),
      emergencyCountByYear: db.prepare(`SELECT COUNT(*) AS cnt FROM emergency_records WHERE school_year = ?`),
      emergencyCountByAllYears: db.prepare(`SELECT school_year, COUNT(*) AS cnt FROM emergency_records GROUP BY school_year`),
      emergencyCountBeforeDate: db.prepare(`SELECT COUNT(*) AS cnt FROM emergency_records WHERE accident_date <= ?`),

      /* ════════════════════════════════════
       *  infection_records (감염병)
       * ════════════════════════════════════ */
      infectionGetByYear: db.prepare(`
        SELECT i.*,
               CASE i.person_type
                 WHEN 'student' THEN s.name
                 WHEN 'staff'   THEN st.name
               END AS person_name,
               si.grade AS student_grade,
               si.class_num AS student_class,
               si.student_num AS student_num2,
               si.is_care,
               s.gender AS student_gender
        FROM infection_records i
        LEFT JOIN students s  ON i.person_type = 'student' AND i.person_uid = s.uid
        LEFT JOIN students_info si ON i.person_type = 'student' AND i.person_uid = si.uid AND si.school_year = i.school_year
        LEFT JOIN staff st    ON i.person_type = 'staff'   AND i.person_uid = st.uid
        WHERE i.school_year = ?
        ORDER BY i.onset_date DESC
      `),
      infectionGetById: db.prepare(`SELECT * FROM infection_records WHERE id = ?`),
      infectionInsert: db.prepare(`
        INSERT INTO infection_records (
          school_year, person_uid, person_type,
          disease_name, hospital, diag_date, onset_date, report_date,
          is_suspended, suspend_start, expected_return, actual_return,
          main_symptoms, has_fever, has_cough, has_throat, other_symptoms,
          infection_route, school_contact, class_contact, situation_memo,
          parent_notified, notify_time, hospital_visit, is_isolated, additional_actions,
          progress_json, additional_memo,
          author_date, author_name,
          memo, extra_json, created_at, updated_at
        ) VALUES (
          @school_year, @person_uid, @person_type,
          @disease_name, @hospital, @diag_date, @onset_date, @report_date,
          @is_suspended, @suspend_start, @expected_return, @actual_return,
          @main_symptoms, @has_fever, @has_cough, @has_throat, @other_symptoms,
          @infection_route, @school_contact, @class_contact, @situation_memo,
          @parent_notified, @notify_time, @hospital_visit, @is_isolated, @additional_actions,
          @progress_json, @additional_memo,
          @author_date, @author_name,
          @memo, @extra_json, @created_at, @updated_at
        )
      `),
      infectionUpdate: db.prepare(`
        UPDATE infection_records SET
          person_uid=@person_uid, person_type=@person_type,
          disease_name=@disease_name, hospital=@hospital,
          diag_date=@diag_date, onset_date=@onset_date, report_date=@report_date,
          is_suspended=@is_suspended, suspend_start=@suspend_start,
          expected_return=@expected_return, actual_return=@actual_return,
          main_symptoms=@main_symptoms, has_fever=@has_fever,
          has_cough=@has_cough, has_throat=@has_throat, other_symptoms=@other_symptoms,
          infection_route=@infection_route, school_contact=@school_contact,
          class_contact=@class_contact, situation_memo=@situation_memo,
          parent_notified=@parent_notified, notify_time=@notify_time,
          hospital_visit=@hospital_visit, is_isolated=@is_isolated,
          additional_actions=@additional_actions,
          progress_json=@progress_json, additional_memo=@additional_memo,
          author_date=@author_date, author_name=@author_name,
          memo=@memo, extra_json=@extra_json, updated_at=@updated_at
        WHERE id = @id
      `),
      infectionDelete: db.prepare(`DELETE FROM infection_records WHERE id = ?`),
      infectionDeleteByYear: db.prepare(`DELETE FROM infection_records WHERE school_year = ?`),
      infectionDeleteBeforeDate: db.prepare(`DELETE FROM infection_records WHERE onset_date <= ?`),
      infectionCountByYear: db.prepare(`SELECT COUNT(*) AS cnt FROM infection_records WHERE school_year = ?`),
      infectionCountByAllYears: db.prepare(`SELECT school_year, COUNT(*) AS cnt FROM infection_records GROUP BY school_year`),
      infectionCountBeforeDate: db.prepare(`SELECT COUNT(*) AS cnt FROM infection_records WHERE onset_date <= ?`),

      /* [REMOVED] survey_forms prepared statements 삭제 — 테이블 제거됨 */

      /* ════════════════════════════════════
       *  survey_responses
       * ════════════════════════════════════ */
      surveyRespGetByStudent: db.prepare(`
        SELECT id, school_year, form_id, form_version, person_uid, student_persistent_id,
               student_name, birth_date, grade, class_num, student_num,
               responded_at, status, created_at
        FROM survey_responses WHERE student_persistent_id = ? ORDER BY responded_at DESC
      `),
      surveyRespGetByForm: db.prepare(`
        SELECT id, school_year, form_id, form_version, person_uid, student_persistent_id,
               student_name, birth_date, grade, class_num, student_num,
               responded_at, status, created_at
        FROM survey_responses WHERE school_year = ? AND form_id = ? ORDER BY grade, class_num, student_num
      `),
      surveyRespGetDataById: db.prepare(`
        SELECT id, response_data FROM survey_responses WHERE id = ?
      `),
      surveyRespGetDataByStudent: db.prepare(`
        SELECT id, school_year, form_id, student_persistent_id, response_data
        FROM survey_responses WHERE school_year = ? AND form_id = ? AND student_persistent_id = ?
      `),
      surveyRespGetAllWithData: db.prepare(`
        SELECT * FROM survey_responses WHERE school_year = ? AND form_id = ? ORDER BY grade, class_num, student_num
      `),
      surveyRespUpsert: db.prepare(`
        INSERT INTO survey_responses (
          school_year, form_id, form_version, person_uid, student_persistent_id,
          student_name, birth_date, grade, class_num, student_num,
          responded_at, response_data, status, created_at
        ) VALUES (
          @school_year, @form_id, @form_version, @person_uid, @student_persistent_id,
          @student_name, @birth_date, @grade, @class_num, @student_num,
          @responded_at, @response_data, @status, @created_at
        ) ON CONFLICT(school_year, form_id, student_persistent_id) DO UPDATE SET
          form_version=excluded.form_version,
          person_uid=excluded.person_uid,
          student_name=excluded.student_name,
          grade=excluded.grade,
          class_num=excluded.class_num,
          student_num=excluded.student_num,
          responded_at=excluded.responded_at,
          response_data=excluded.response_data,
          status=excluded.status
      `),
      surveyRespDelete: db.prepare(`DELETE FROM survey_responses WHERE id = ?`),
      surveyRespDeleteByForm: db.prepare(`DELETE FROM survey_responses WHERE school_year = ? AND form_id = ?`),

      /* ════════════════════════════════════
       *  app_settings
       * ════════════════════════════════════ */
      settingGet: db.prepare(`SELECT value_json FROM app_settings WHERE key = ?`),
      settingSet: db.prepare(`
        INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
      `),
      settingDelete: db.prepare(`DELETE FROM app_settings WHERE key = ?`),
      settingGetAll: db.prepare(`SELECT key, value_json FROM app_settings`),

      /* ════════════════════════════════════
       *  users (보건교사/처치자)
       * ════════════════════════════════════ */
      userGetAll: db.prepare(`SELECT * FROM users ORDER BY is_active DESC, name`),
      userGetActive: db.prepare(`SELECT * FROM users WHERE is_active = 1 ORDER BY name`),
      userGetById: db.prepare(`SELECT * FROM users WHERE id = ?`),
      userInsert: db.prepare(`
        INSERT INTO users (name, position, school_name, school_level, edu_office, is_active, created_at, updated_at)
        VALUES (@name, @position, @school_name, @school_level, @edu_office, 1, @created_at, @updated_at)
      `),
      userUpdate: db.prepare(`
        UPDATE users SET
          name=@name, position=@position, school_name=@school_name,
          school_level=@school_level, edu_office=@edu_office, updated_at=@updated_at
        WHERE id = @id
      `),
      userDeactivate: db.prepare(`UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?`),
      userDelete: db.prepare(`DELETE FROM users WHERE id = ?`),
      userHasRecords: db.prepare(`SELECT COUNT(*) AS cnt FROM daily_records WHERE nurse_id = ?`),

    };

    /* ── 트랜잭션 ── */
    this.tx = {
      studentImportBatch: db.transaction((students, infos) => {
        for (const s of students) this.stmt.studentsUpsert.run(s);
        for (const si of infos) this.stmt.siUpsert.run(si);
      }),
      staffImportBatch: db.transaction((rows) => {
        for (const row of rows) this.stmt.staffUpsert.run(row);
      }),
    };
  }

  /* ═══════════════════════════════════════════
   *  유틸리티
   * ═══════════════════════════════════════════ */

  /** students UID 자동 생성: s000001, s000002, ... (6자리 고정, 숫자 정렬) */
  static generateStudentUid(db) {
    const row = db.prepare('SELECT uid FROM students ORDER BY CAST(SUBSTR(uid, 2) AS INTEGER) DESC LIMIT 1').get();
    if (!row) return 's000001';
    const num = parseInt(row.uid.substring(1), 10) + 1;
    return 's' + String(num).padStart(6, '0');
  }

  /** staff UID 자동 생성: t000001, t000002, ... (6자리 고정, 숫자 정렬) */
  static generateStaffUid(db) {
    const row = db.prepare('SELECT uid FROM staff ORDER BY CAST(SUBSTR(uid, 2) AS INTEGER) DESC LIMIT 1').get();
    if (!row) return 't000001';
    const num = parseInt(row.uid.substring(1), 10) + 1;
    return 't' + String(num).padStart(6, '0');
  }

  /* ══════════ 입력 검증 (Validation) ══════════ */

  /**
   * 일반일지 레코드 검증
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validateDailyRecord(r) {
    const errors = [];
    /* school_year: 4자리 숫자 문자열 */
    const sy = r.school_year || '';
    if (!sy || !/^\d{4}$/.test(String(sy))) errors.push('학년도(school_year)가 올바르지 않습니다: ' + sy);
    /* visit_date: YYYY-MM-DD */
    const vd = r.visit_date || r.date || '';
    if (!vd || !/^\d{4}-\d{2}-\d{2}$/.test(vd)) errors.push('방문일(visit_date)이 올바르지 않습니다: ' + vd);
    /* person_type */
    const pt = r.person_type || r.personType || 'student';
    if (pt !== 'student' && pt !== 'staff') errors.push('인원 유형(person_type)은 student 또는 staff만 가능합니다: ' + pt);
    /* time_in / time_out: HH:MM 또는 빈 문자열 */
    const ti = r.time_in || r.timeIn || '';
    if (ti && !/^\d{2}:\d{2}$/.test(ti)) errors.push('내원 시각(time_in)이 올바르지 않습니다 (HH:MM): ' + ti);
    const to = r.time_out || r.timeOut || '';
    if (to && !/^\d{2}:\d{2}$/.test(to)) errors.push('퇴실 시각(time_out)이 올바르지 않습니다 (HH:MM): ' + to);
    /* symptoms: JSON 배열 문자열이면 파싱 확인 */
    const syms = r.symptoms;
    if (typeof syms === 'string' && syms) {
      try { const p = JSON.parse(syms); if (!Array.isArray(p)) errors.push('증상(symptoms)은 JSON 배열이어야 합니다'); }
      catch (_) { errors.push('증상(symptoms) JSON 파싱 실패: ' + syms.substring(0, 50)); }
    }
    /* bodymap_json */
    const bm = r.bodymap_json;
    if (typeof bm === 'string' && bm && bm !== '[]') {
      try { const p = JSON.parse(bm); if (!Array.isArray(p)) errors.push('바디맵(bodymap_json)은 JSON 배열이어야 합니다'); }
      catch (_) { errors.push('바디맵(bodymap_json) JSON 파싱 실패'); }
    }
    /* vip_tags */
    const vt = r.vip_tags;
    if (typeof vt === 'string' && vt && vt !== '[]') {
      try { const p = JSON.parse(vt); if (!Array.isArray(p)) errors.push('VIP 태그(vip_tags)은 JSON 배열이어야 합니다'); }
      catch (_) { errors.push('VIP 태그(vip_tags) JSON 파싱 실패'); }
    }
    /* extra_json */
    const ej = r.extra_json;
    if (typeof ej === 'string' && ej && ej !== '{}') {
      try { JSON.parse(ej); }
      catch (_) { errors.push('추가 정보(extra_json) JSON 파싱 실패'); }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * 학생 데이터 검증
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  static validateStudent(data) {
    const errors = [];
    const warnings = [];
    /* 이름: 필수 */
    const name = (data.name || '').trim();
    if (!name) errors.push('이름은 필수입니다');
    /* 성별: 남/여만 허용 (정규화 후) */
    const _gMap = { '남자': '남', '여자': '여', '녀자': '여', '녀': '여', '남성': '남', '여성': '여', 'M': '남', 'F': '여', 'm': '남', 'f': '여', 'male': '남', 'female': '여', 'Male': '남', 'Female': '여' };
    const rawGender = (data.gender || '').trim();
    const normGender = _gMap[rawGender] || rawGender;
    if (normGender && normGender !== '남' && normGender !== '여') errors.push('성별은 남 또는 여만 가능합니다: ' + rawGender);
    /* 학년·반·번호: 모두 선택 사항. 숫자면 ≥1 정수, 텍스트면 허용, 비어있음/0/undefined 도 허용
       - 유치원: 학년에 "만3세"/"만4세" 같은 텍스트, 반에 "꽃잎"/"햇살", 번호 공란 가능
       - 초·중·고: 일반 숫자
       - 대안 학급: "열매마을반" 같은 텍스트 반 이름 */
    const _isEmpty = (v) => v == null || v === '' || v === 0 || v === '0' || String(v).trim() === '' || String(v).trim().toLowerCase() === 'undefined';
    const _validateGCN = (rawAny, labelKr) => {
      if (_isEmpty(rawAny)) return; /* 비어있으면 OK */
      const s = String(rawAny).trim();
      if (/^-?\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1) errors.push(labelKr + ' 은(는) 1 이상의 정수이거나 텍스트여야 합니다: ' + rawAny);
      }
      /* 순수 숫자가 아닌 텍스트 — 허용 */
    };
    _validateGCN(data.grade, '학년');
    _validateGCN(data.class_num != null ? data.class_num : data.cls, '반');
    _validateGCN(data.student_num != null ? data.student_num : data.num, '번호');
    /* 생년월일: YYYY-MM-DD 형식 (있을 때만) */
    const birth = data.birth_date || data.birthDate || data.birth || '';
    if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) warnings.push('생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD): ' + birth);
    /* memo_json */
    const memo = data.memo_json || data.memoJson;
    if (typeof memo === 'string' && memo && memo !== '{}') {
      try { JSON.parse(memo); } catch (_) { errors.push('메모(memo_json) JSON 파싱 실패'); }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 교직원 데이터 검증
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validateStaff(data) {
    const errors = [];
    /* 이름: 필수 */
    const name = (data.name || '').trim();
    if (!name) errors.push('이름은 필수입니다');
    /* 직위: 필수 (사용자 확정 2026-06-13: 교직원 직위는 의무 — 이름+직위로 동일인을 식별하므로 직위가 비면 매칭이 불가) */
    const position = (data.position || '').trim();
    if (!position) errors.push('직위는 필수입니다');
    /* 성별: 남/여만 허용 (정규화 후) */
    const _gMap = { '남자': '남', '여자': '여', '녀자': '여', '녀': '여', '남성': '남', '여성': '여', 'M': '남', 'F': '여', 'm': '남', 'f': '여', 'male': '남', 'female': '여', 'Male': '남', 'Female': '여' };
    const rawGender = (data.gender || '').trim();
    const normGender = _gMap[rawGender] || rawGender;
    if (normGender && normGender !== '남' && normGender !== '여') errors.push('성별은 남 또는 여만 가능합니다: ' + rawGender);
    return { valid: errors.length === 0, errors };
  }

  /**
   * 학년도 계산: 3월 이후는 해당 연도, 1~2월은 전년도
   * @param {Date|string} date
   * @returns {string} e.g. '2026'
   */
  static academicYear(date) {
    const d = date ? (date instanceof Date ? date : new Date(date)) : new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1-based
    return String(month >= 3 ? year : year - 1);
  }

  now() {
    return new Date().toISOString();
  }

  getInfo() {
    return { dbPath: this.dbPath, exists: fs.existsSync(this.dbPath), schemaVersion: SCHEMA_VERSION };
  }

  /**
   * 공장 초기화 — 흔적없이 데이터 제거.
   *  - SQLite 메인 DB (이 DB): 테이블 데이터 삭제 (스키마/users 유지)
   *  - SQLite blob store (app_data_store.sqlite3): 전체 레코드 삭제
   *  - 데이터 JSON 파일 (userData/data/**.json, 연도 폴더 포함): 삭제
   *  - 백업 파일: 이번 초기화 백업 1개만 남기고 이전 .bak/.factory-reset 삭제
   * 보존: 시스템 테이블(schema_meta, sqlite_sequence, users), API 키 파일(api_key.json)
   * @returns {{ success: boolean, tables: string[], deletedFiles: number, error?: string }}
   */
  factoryReset() {
    const KEEP = new Set(['schema_meta', 'sqlite_sequence', 'users']);
    const KEEP_FILES = new Set([
      /* 사용자(보건교사) 정보 — 공장초기화에도 절대 보존 */
      'users_backup.json', 'users_backup.json.bak',
      /* 약품/의료 템플릿 */
      'medical-data.json', 'medical-data.json.bak',   /* 증상·처치·약품 매핑 (사용자 편집 반영) */
      'medications_list.json', 'medications_list.json.bak',   /* 약품 상세정보 캐시 */
      /* 날씨·미세먼지 사용자 설정 (지역명·소스) — DB 공장초기화와 무관 */
      'user_region.json', 'user_region.json.bak',
      'weather_source.json', 'weather_source.json.bak',
      /* 열 너비·침상·시간표·설정 UI */
      'col_widths.json', 'col_widths.json.bak',
      'bed_config.json', 'bed_config.json.bak',
      'bg_mode.json', 'bg_mode.json.bak', 'bg_selected.json', 'bg_selected.json.bak', 'font_scale.json', 'font_scale.json.bak',
      /* 부서/교육청 매핑 */
      'deptMapping.json', 'deptMapping.json.bak',
      /* 키오스크 UI 설정 */
      'kiosk_settings.json', 'kiosk_settings.json.bak'
    ]);
    let backupPath = '';
    let deletedFiles = 0;
    try {
      /* 백업 먼저 생성 */
      backupPath = this.dbPath + '.factory-reset.' + Date.now() + '.bak';
      try { fs.copyFileSync(this.dbPath, backupPath); console.log('[DB] 공장초기화 백업:', backupPath); }
      catch (e) { console.warn('[DB] 공장초기화 백업 실패 (계속 진행):', e.message); backupPath = ''; }

      /* 1) 메인 DB 테이블 비우기 */
      const rows = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
      const deleted = [];
      this.db.pragma('foreign_keys = OFF');
      try {
        const tx = this.db.transaction(() => {
          for (const row of rows) {
            if (KEEP.has(row.name)) continue;
            this.db.exec(`DELETE FROM "${row.name}"`);
            deleted.push(row.name);
          }
          try { this.db.exec(`DELETE FROM sqlite_sequence`); } catch (_) { }
        });
        tx();
      } finally {
        this.db.pragma('foreign_keys = ON');
      }

      /* 2) app_data_store.sqlite3 (blob store) 정리 — 단, API 키 / 반영됨 / 측정소 / 지역 / 날씨 키는 보존.
            DB 공장초기화는 보건일지 데이터만 비우는 작업이지 외부 인증·날씨·미세먼지 설정과 무관. */
      const dataDir = path.dirname(this.dbPath);
      const appDataStorePath = path.join(dataDir, 'app_data_store.sqlite3');
      if (fs.existsSync(appDataStorePath)) {
        try {
          const Database = require('better-sqlite3');
          const ads = new Database(appDataStorePath);
          try {
            const t = ads.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
            const _isProtectedKey = (k) => {
              if (!k) return false;
              return /_api_key(_applied)?$/.test(k)
                || /_applied$/.test(k)
                || /_station(_applied)?$/.test(k)
                || /^(kma|airkorea|drug|hira|emergency|kakao|infectious)_/.test(k)
                || /^(weather|user_region|weatherRegion|school_address|school_lat|school_lng)/.test(k)
                /* 인증코드(라이선스) — 공장초기화·DB 교체 후에도 절대 재인증 요구 X. (사용자 보고 2026-05-31 — 락아웃 사고 방지) */
                || /^cdkey_/.test(k);
            };
            for (const tbl of t) {
              try {
                /* common 테이블만 키 단위 보존, 나머지 blob 테이블은 전체 삭제 */
                if (tbl.name === 'common') {
                  let cols = [];
                  try { cols = ads.prepare(`PRAGMA table_info("${tbl.name}")`).all().map(c => c.name); } catch (_) { }
                  if (cols.includes('key')) {
                    const rows = ads.prepare(`SELECT key FROM "${tbl.name}"`).all();
                    const delStmt = ads.prepare(`DELETE FROM "${tbl.name}" WHERE key = ?`);
                    let kept = 0, dropped = 0;
                    for (const r of rows) {
                      if (_isProtectedKey(r.key)) { kept++; continue; }
                      try { delStmt.run(r.key); dropped++; } catch (_) { }
                    }
                    deleted.push('blob:' + tbl.name + '(' + dropped + '/' + (kept + dropped) + ' 삭제, ' + kept + ' 보존)');
                    continue;
                  }
                }
                ads.exec(`DELETE FROM "${tbl.name}"`);
                deleted.push('blob:' + tbl.name);
              } catch (_) { }
            }
          } finally { ads.close(); }
        } catch (e) { console.warn('[DB] app_data_store 초기화 실패:', e.message); }
      }

      /* 3) JSON 파일 삭제 — 재귀적으로 data/ 하위 모든 *.json, *.bak 제거 (보존 목록 제외) */
      const _rmJsonFiles = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              if (e.name === 'backups' || e.name === 'exports') continue;  /* 백업/내보내기 폴더는 사용자가 관리 */
              _rmJsonFiles(full);
              /* 빈 디렉터리(연도 폴더 등) 정리 */
              try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch (_) { }
            } else if (e.isFile()) {
              if (KEEP_FILES.has(e.name)) continue;
              /* API 키 파일은 변형(.bak / _applied.json / kakao_js_api_key 등)도 모두 보존 —
                 공장초기화는 보건일지 데이터만 비우는 작업이지 외부 API 인증과 무관하다. */
              if (/_api_key(\.|$)/.test(e.name) || e.name.indexOf('api_key') >= 0) continue;
              /* 날씨/미세먼지 사용자 설정도 보존 — 지역·소스·측정소 변형 모두 */
              if (/^(user_region|weather_source|airkorea_station|kma_station)(\.|$)/.test(e.name)) continue;
              if (e.name.endsWith('.json') || e.name.endsWith('.json.bak')) {
                try { fs.unlinkSync(full); deletedFiles++; } catch (_) { }
              }
            }
          }
        } catch (e) { console.warn('[DB] JSON 파일 정리 오류:', dir, e.message); }
      };
      _rmJsonFiles(dataDir);

      console.log('[DB] 공장 초기화 완료. 테이블 ' + deleted.length + '개, 파일 ' + deletedFiles + '개 제거.');
      return { success: true, tables: deleted, deletedFiles: deletedFiles, backupPath: backupPath };
    } catch (err) {
      console.error('[DB] 공장 초기화 실패:', err.message);
      return { success: false, error: err.message, backupPath: backupPath };
    }
  }

  /**
   * 보건일지·기록만 초기화 (인원 명단·시스템·UI 설정은 보존).
   * 사용자 요청: "인원 데이터는 남기고 보건일지 모두 삭제" (2026-05-11).
   *
   * 삭제 대상 테이블: daily_records, emergency_records, infection_records,
   *                   counseling_records, survey_responses, import_staging
   * 보존 대상 테이블: students, students_info, staff, users, app_settings,
   *                   tb_tests, hearing_tests, schema_meta, sqlite_sequence
   * 보존 영역: app_data_store(blob), JSON 파일 일체 — 일지 데이터와 무관
   *
   * @returns {{ success: boolean, tables: string[], backupPath: string, error?: string }}
   */
  factoryResetHealthRecordsOnly() {
    /* 삭제 대상 — 명시적 화이트리스트 방식 (안전).
     * 이 목록에 없는 테이블은 절대 건들지 않음. */
    const DELETE_TABLES = [
      'daily_records',
      'emergency_records',
      'infection_records',
      'counseling_records',
      'survey_responses',
      'import_staging',
      'today_memos',   /* 오늘의 메모 — 일지 데이터이므로 공장초기화 시 함께 비움 (2026-06-10) */
    ];

    let backupPath = '';
    try {
      /* 백업 먼저 */
      backupPath = this.dbPath + '.health-only-reset.' + Date.now() + '.bak';
      try { fs.copyFileSync(this.dbPath, backupPath); console.log('[DB] 보건일지 초기화 백업:', backupPath); }
      catch (e) { console.warn('[DB] 보건일지 초기화 백업 실패 (계속 진행):', e.message); backupPath = ''; }

      /* 실제 존재하는 테이블만 추려서 삭제 (스키마 변경 호환) */
      const existingTables = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name);
      const toDelete = DELETE_TABLES.filter(t => existingTables.indexOf(t) !== -1);
      const deleted = [];

      this.db.pragma('foreign_keys = OFF');
      try {
        const tx = this.db.transaction(() => {
          for (const tblName of toDelete) {
            this.db.exec(`DELETE FROM "${tblName}"`);
            deleted.push(tblName);
          }
          /* AUTOINCREMENT 카운터는 일부 테이블만 리셋 — 다른 테이블의 시퀀스는 건들지 않기 위해 개별 처리 */
          for (const tblName of toDelete) {
            try { this.db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(tblName); } catch (_) { }
          }
        });
        tx();
      } finally {
        this.db.pragma('foreign_keys = ON');
      }

      console.log('[DB] 보건일지 초기화 완료. 테이블 ' + deleted.length + '개 비움.');
      return { success: true, tables: deleted, backupPath: backupPath };
    } catch (err) {
      console.error('[DB] 보건일지 초기화 실패:', err.message);
      return { success: false, error: err.message, backupPath: backupPath };
    }
  }

  /* ═══ 오늘의 메모 (today_memos, v4) ═══
   *  renderer today-memo.js 전용. cells 는 문자열 배열(최대 5칸).
   *  빈 배열(모든 칸 공백) 저장 요청은 행 삭제로 처리 — 테이블 무한 성장 방지.
   *  self-heal: 옛 백업(v1~v3) 복원 직후엔 테이블이 없을 수 있어, no such table 이면
   *  즉석 CREATE 후 1회 재시도 — 재시작 없이도 무오류. */
  _ensureTodayMemosTable() {
    this._ensureTable(`
      CREATE TABLE IF NOT EXISTS today_memos (
        visit_date  TEXT PRIMARY KEY,
        cells_json  TEXT NOT NULL DEFAULT '[]',
        updated_at  TEXT
      )
    `);
  }

  _withTodayMemosHeal(fn) {
    try { return fn(); }
    catch (e) {
      if (/no such table.*today_memos/i.test(e.message || '')) {
        this._ensureTodayMemosTable();
        return fn();
      }
      throw e;
    }
  }

  getTodayMemosAll() {
    return this._withTodayMemosHeal(() => this._getTodayMemosAllRaw());
  }

  _getTodayMemosAllRaw() {
    const rows = this.db.prepare(`SELECT visit_date, cells_json FROM today_memos`).all();
    const out = {};
    rows.forEach(r => {
      try {
        const a = JSON.parse(r.cells_json || '[]');
        if (Array.isArray(a)) out[r.visit_date] = a.map(v => String(v == null ? '' : v));
      } catch (_) { /* 손상 행은 건너뜀 — 다른 날짜에 영향 없음 */ }
    });
    return out;
  }

  setTodayMemo(visitDate, cells) {
    const date = String(visitDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('잘못된 날짜 형식: ' + visitDate);
    const arr = Array.isArray(cells) ? cells.slice(0, 5).map(v => String(v == null ? '' : v)) : [];
    return this._withTodayMemosHeal(() => {
      const isEmpty = arr.every(v => !v.trim());
      if (isEmpty) {
        this.db.prepare(`DELETE FROM today_memos WHERE visit_date = ?`).run(date);
        return { deleted: true };
      }
      this.db.prepare(`
        INSERT INTO today_memos (visit_date, cells_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(visit_date) DO UPDATE SET cells_json = excluded.cells_json, updated_at = excluded.updated_at
      `).run(date, JSON.stringify(arr), this.now());
      return { saved: true };
    });
  }

  close() {
    if (this.db) this.db.close();
  }
}

function createHealthDiaryDB(app) {
  const dbPath = path.join(app.getPath('userData'), 'data', 'my_health_diary.sqlite3');
  return new HealthDiaryDB(dbPath);
}

module.exports = { HealthDiaryDB, createHealthDiaryDB, SCHEMA_VERSION };
