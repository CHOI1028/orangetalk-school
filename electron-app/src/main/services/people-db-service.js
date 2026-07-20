/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const { HealthDiaryDB } = require('./database');

/**
 * people-db-service.js — 사람 관련 DB 서비스 모음
 *
 * StudentsDBService — 학생 CRUD (students + students_info 테이블)
 * StaffDBService — 교직원 CRUD (staff 테이블)
 * UserService — 사용자(보건교사/처치자) 관리
 */

/* 성별 정규화 맵 (upsert에서 공유) */
const GENDER_MAP = {'남자':'남','여자':'여','녀자':'여','녀':'여','남성':'남','여성':'여','M':'남','F':'여','m':'남','f':'여','male':'남','female':'여','Male':'남','Female':'여'};

/* ══════════ StudentsDBService ══════════ */

class StudentsDBService {
  constructor(healthDB) {
    this._db = healthDB;
  }

  /* 학년도는 항상 문자열 — school_year 컬럼이 TEXT 라 숫자가 섞이면 ===/SQL 비교가 전부 깨진다 (2026-06-12) */
  _yr(year) { return String(year || HealthDiaryDB.academicYear()); }

  /* ──────────── 조회 ──────────── */

  getAll(year) {
    return this._db.stmt.siGetByYear.all(this._yr(year));
  }

  getAllIncludeLeft(year) {
    return this._db.stmt.siGetByYearAll.all(this._yr(year));
  }

  /** 모든 학생 통합 조회 — 학년도 무관. 가장 최근 students_info 행으로 학년·반·번호 등 표시.
   *  보건일지에서 과거 학년도 person_uid 도 이름/학년/반/번호로 resolve 하기 위해 (S.leavers 적재). */
  getAllHistorical() {
    return this._db.stmt.siGetAllPeopleWithLatestInfo.all();
  }

  getCare(year) {
    return this._db.stmt.siGetCare.all(this._yr(year));
  }

  getByUid(uid) {
    return this._db.stmt.studentsGetByUid.get(uid) || null;
  }

  getHistory(uid) {
    return this._db.stmt.siGetByUid.all(uid);
  }

  getByUidYear(uid, year) {
    return this._db.stmt.siGetByUidYear.get(uid, this._yr(year)) || null;
  }

  findByNameBirth(name, birthDate) {
    return this._db.stmt.studentsGetByNameBirth.all(name, birthDate || '');
  }

  findByName(name) {
    return this._db.stmt.studentsGetByName.all(name);
  }

  /* ──────────── 저장 ──────────── */

  upsert(year, data) {
    /* 입력 검증 */
    const v = HealthDiaryDB.validateStudent(data);
    if (!v.valid) return { success: false, error: v.errors.join('; ') };

    const yr = this._yr(year);
    const now = this._db.now();

    /* class_num / student_num / grade — 텍스트(유치원 "꽃잎", "만3세" 등)도 허용. 자리 매칭·저장 공통. */
    const _toNumOrText = function (val) {
      if (val == null || val === '') return null;
      const s = String(val).trim();
      if (s === '' || s.toLowerCase() === 'undefined') return null;
      if (/^-?\d+$/.test(s)) return parseInt(s, 10);
      if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
      return s;
    };
    const _g = _toNumOrText(data.grade);
    const _c = _toNumOrText(data.class_num != null ? data.class_num : data.cls);
    const _n = _toNumOrText(data.student_num != null ? data.student_num : data.num);

    let uid = data.uid;
    if (!uid) {
      /* ─── 자리(학교급·학과·학년·반·번호) 우선 매칭 (2026-06-12 사용자 결정, 2026-06-13 성별 제외) ───
       *  · 이름·성별로는 매칭하지 않는다 — '다른 자리 동명이인을 이름만 보고 덮어쓰던' 버그 제거.
       *  · 같은 자리(학년·반·번호)에 같은 이름·성별이 이미 있으면 → 그 학생(갱신). 같은 명단 재업로드 시 중복 방지.
       *  · 같은 자리·다른 이름 → 새 uid (기존 학생 절대 안 건드림. 위치충돌 미매칭은 프론트가 가려서 여기로 잘 안 옴).
       *  · 빈 자리 / 자리가 다른 동명이인 → 새 uid (신규로 별개 등록).
       *  · 진급(학년 바뀜)은 분류 단계가 uid 를 실어 보내므로 이 분기(uid 없음)로 오지 않는다 → 학년 간 연결 유지. */
      /* 자리매칭은 '진짜 번호(1번 이상)' 가 있을 때만. 번호 없음/0 → 자리 불완전 →
         무조건 새 사람(덮어쓰기 0). 번호 없는 동명이인끼리 (학년,반,0) 으로 묶여 사라지는 것 방지. */
      const _hasSeat = _g != null && _n != null && _n !== 0 && String(_n).trim() !== '0';
      let seatRow = null;
      if (_hasSeat) {
        /* 자리 키 = 학년·반·번호 + 학교급(level) + 학과(department). 학교급·학과가 다르면 다른 자리 →
           같은 이름이라도 별개 인물로 등록 (사용자 확정 2026-06-13: 항공기계과 1-1-4 ≠ 항공정보과 1-1-4). */
        seatRow = this._db.stmt.siGetByYearPosition.get({ yr, grade: _g, class_num: _c, student_num: _n, level: (data.level || ''), department: (data.department || '') });
      }
      if (seatRow) {
        /* 같은 자리에 이름이 같으면 동일인(재입력/부활). 성별은 매칭에 쓰지 않음 (사용자 확정 2026-06-13). */
        const sameName = (seatRow.name || '').trim() === (data.name || '').trim();
        if (sameName) {
          uid = seatRow.uid;
        } else if (Number(seatRow.is_enrolled) === 1) {
          /* 같은 자리(학교급+학과+학년+반+번호)에 다른 이름 = 당해년도 자리 고유성 위반 → 실수로 보고 거부.
             (사용자 확정 2026-06-13: 개별·일괄 공통. 다른 학과의 같은 학년·반·번호는 자리가 달라 정상 등록됨.) */
          const _seatLoc = (data.department ? data.department + ' ' : '') + _g + '학년 ' + _c + '반 ' + _n + '번';
          return { success: false, code: 'SEAT_TAKEN', seatName: (seatRow.name || ''),
                   error: _seatLoc + ' ' + (seatRow.name || '') + ' 학생이 이미 있습니다. (같은 자리에 다른 이름은 등록할 수 없습니다)' };
        } else {
          /* 그 자리의 기존 학생이 전출(is_enrolled=0)된 상태 → 자리가 비었으므로 새 학생 등록 허용 */
          uid = HealthDiaryDB.generateStudentUid(this._db.db);
        }
      } else {
        uid = HealthDiaryDB.generateStudentUid(this._db.db);
      }
    }

    const _normGender = GENDER_MAP[(data.gender||'').trim()] || (data.gender||'').trim();

    /* 생년월일·메모 보존 정책: 입력이 비어있으면 DB 기존 값 유지 (덮어쓰기 방지) */
    const existingStu = this._db.stmt.studentsGetByUid.get(uid);
    const incomingBirth = (data.birth_date || data.birthDate || data.birth || '').trim();
    const finalBirth = incomingBirth || (existingStu && existingStu.birth_date) || '';
    const incomingMemo = data.memo_json || data.memoJson || '';
    const finalMemo = incomingMemo || (existingStu && existingStu.memo_json) || '{}';

    this._db.stmt.studentsUpsert.run({
      uid,
      name: data.name || '',
      gender: _normGender,
      birth_date: finalBirth,
      memo_json: finalMemo,
      created_at: existingStu ? existingStu.created_at : now,
      updated_at: now,
    });

    /* 신년도 승계 — 이 uid 의 (yr) students_info 행이 아직 없을 때만(=신규 행), 직전 학년도의 요보호·기저질환·동의·VIP 를 그대로 이어받는다.
       · uid 동일성으로만 매칭 → 다른 학생에게 절대 섞이지 않음.  · 기존 행(같은 해 편집/재업로드)은 _inh=null 이라 동작 불변.
       · 업로드가 해당 플래그를 명시하면 명시값 우선. (사용자 지시 2026-06-16: 3/1 신학년도 업로드 시 작년 데이터 연결) */
    let _inh = null;
    try {
      const _existSI = this._db.db.prepare('SELECT 1 FROM students_info WHERE uid = ? AND school_year = ?').get(uid, yr);
      if (!_existSI) {
        _inh = this._db.db.prepare(
          'SELECT is_care, care_reason, dust_disease, care_memo, med_consent, emergency_consent, vip ' +
          'FROM students_info WHERE uid = ? AND school_year < ? ORDER BY school_year DESC LIMIT 1'
        ).get(uid, yr) || null;
      }
    } catch (_e) { _inh = null; }

    /* class_num / student_num / grade 는 위에서 _toNumOrText 로 정규화한 _g/_c/_n 을 그대로 사용
       (자리 매칭과 저장값이 반드시 일치해야 자리 우선 매칭이 정확) */
    this._db.stmt.siUpsert.run({
      uid,
      school_year: yr,
      grade: _g,
      class_num: _c,
      student_num: _n,
      level: data.level || '',
      department: data.department || '',
      guardian_type: data.guardian_type || data.guardianType || '',
      guardian_contact: data.guardian_contact || data.guardianContact || '',
      homeroom_teacher: data.homeroom_teacher || data.homeroomTeacher || '',
      is_enrolled: data.is_enrolled != null ? Number(data.is_enrolled) : 1,
      is_care: data.is_care != null ? Number(data.is_care) : (_inh && _inh.is_care != null ? Number(_inh.is_care) : (data.status === 'caution' || data.status === 'watch' ? 1 : 0)),
      care_reason: data.care_reason || data.condition || (_inh && _inh.care_reason) || '',
      dust_disease: data.dust_disease || data.dustDisease || (_inh && _inh.dust_disease) || '',
      care_memo: data.care_memo || data.careMemo || (_inh && _inh.care_memo) || '',
      med_consent: data.med_consent || data.medConsent || (_inh && _inh.med_consent) || 'Y',
      emergency_consent: data.emergency_consent || data.emergencyConsent || (_inh && _inh.emergency_consent) || 'Y',
      vip: data.vip != null ? String(data.vip) : ((_inh && _inh.vip) ? String(_inh.vip) : ''),
      extra_json: data.extra_json || JSON.stringify(data.extra || {}),
      created_at: now,
      updated_at: now,
    });

    return { success: true, uid };
  }

  saveAll(year, studentList) {
    const yr = this._yr(year);
    const results = [];
    const validationErrors = [];
    const tx = this._db.db.transaction(() => {
      for (let i = 0; i < (studentList || []).length; i++) {
        const s = studentList[i];
        const r = this.upsert(yr, s);
        results.push(r);
        if (!r.success) validationErrors.push({ index: i + 1, name: s.name || '(이름 없음)', error: r.error });
      }
    });
    tx();
    if (validationErrors.length > 0) {
      return { success: false, count: results.length, errors: validationErrors,
        error: validationErrors.map(e => e.index + '번 ' + e.name + ': ' + e.error).join('\n') };
    }
    return { success: true, count: results.length };
  }

  /* ──────────── 일괄 등록 + 동명이인 감지 + 보류 분리 ────────────
     동명이인 후보가 2명 이상이고 자동 결정 불가하면 그 학생만 등록 *보류*하고 결과에 ambiguous 로 반환.
     사용자가 모달에서 후보 결정 후 resolveAmbiguousImport() 로 등록 확정.
     자동 매칭 우선순위:
       1) 이름+성별 후보 1명 → 생년월일 정합성 검사 후 자동 매칭
       2) 후보 2명+ 생년월일 정확 일치 1명 → 자동 매칭
       3) 후보 2명+ 학년-1 일치 1명 → 자동 매칭
       4) 그 외 → ambiguous 보류 (모든 후보 정보 + 작년 학급 반환) */
  saveAllWithAmbiguousDetection(year, studentList) {
    const yr = this._yr(year);
    const ambiguous = [];
    const safeList = [];
    const list = studentList || [];
    /* 동명이인 후보는 이름만으로 찾는다 — 성별은 매칭에서 제외 (사용자 지시 2026-06-13/06-21).
       성별 다른 동명이인도 같은 후보군에 들어와 작년 학급으로 사용자가 구분한다. (gender 컬럼은 표시용으로만 SELECT) */
    const findByName = this._db.db.prepare(
      "SELECT uid, name, gender, birth_date FROM students WHERE name = @name"
    );

    /* 이번 업로드에서 uid 로 특정된 학생(렌더러 자리매칭) + 이미 올해 명단에 있는 학생은
       '다른 사람'이므로, 번호만 다른 신규/이름 겹치는 전입 행이 그쪽으로 잘못 연결되지 않게 후보에서 제외한다.
       (사용자 요청 2026-06-09: 번호만 다르고 그 자리가 비어 있으면 신규. 전체 명단 통째 업로드에서 전입 동명이인 유실 방지.)
       신학년 진급은 '올해' 기록이 아직 없으므로 제외되지 않아 직전연도 비교로 정상 연결된다. */
    const claimedUids = new Set();
    for (let j = 0; j < list.length; j++) { const u = list[j] && list[j].uid; if (u) claimedUids.add(String(u)); }
    const _enrolledThisYear = (uid) => { try { return !!this._db.stmt.siGetByUidYear.get(uid, yr); } catch (_) { return false; } };

    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      if (!s.name) { safeList.push(s); continue; }
      /* 렌더러가 자리(학과+학년+반+번호)로 이미 특정해 uid 를 실어 보낸 경우 → 그대로 신뢰.
         이름만으로 재매칭해 불필요한 동명이인 보류가 뜨지 않게 함 (사용자 요청 2026-06-09).
         신학년 첫 업로드(올해 비어 uid 없음)는 이 분기를 안 타고 아래 직전연도 비교 매칭으로 감. */
      if (s.uid) { safeList.push(s); continue; }
      const incomingBirth = (s.birth_date || s.birthDate || s.birth || '').trim();
      const normGender = GENDER_MAP[(s.gender||'').trim()] || (s.gender||'').trim();
      /* 번호가 있는 행(전입·번호변경 등 자리가 명확) → 이미 올해 명단에 있는 동명이인은 '다른 사람'이므로 제외(=신규/전입 보존).
         번호가 없는 행(외부 이관) → 제외하지 않음 → 같은 반 동명이인을 매칭(보류)할 수 있게 함 (사용자 요청 2026-06-09). */
      const hasNum = (s.student_num != null && String(s.student_num).trim() !== '' && String(s.student_num).trim() !== '0')
                  || (s.num != null && String(s.num).trim() !== '' && String(s.num).trim() !== '0');
      const matches = (findByName.all({ name: s.name }) || [])
        .filter(m => !claimedUids.has(String(m.uid)) && !(hasNum && _enrolledThisYear(m.uid)));

      if (matches.length === 0) { safeList.push(s); continue; }

      if (matches.length === 1) {
        const dbBirth = (matches[0].birth_date || '').trim();
        if (dbBirth && incomingBirth && dbBirth !== incomingBirth) {
          safeList.push(s);
        } else {
          claimedUids.add(String(matches[0].uid));
          safeList.push(Object.assign({}, s, { uid: matches[0].uid }));
        }
        continue;
      }

      /* 후보 2건+ — 생년월일 정확 매칭 1명이면 자동 */
      if (incomingBirth) {
        const exact = matches.filter(m => (m.birth_date || '').trim() === incomingBirth);
        if (exact.length === 1) { claimedUids.add(String(exact[0].uid)); safeList.push(Object.assign({}, s, { uid: exact[0].uid })); continue; }
      }

      /* 학년-1 일치 후보가 정확히 1명이면 자동 매칭 */
      const incomingGrade = parseInt(s.grade, 10);
      if (!isNaN(incomingGrade) && incomingGrade > 0) {
        const priorYr = String(parseInt(yr, 10) - 1);
        const priorMatches = matches.filter(m => {
          const si = this._db.stmt.siGetByUidYear.get(m.uid, priorYr);
          return si && Number(si.grade) === incomingGrade - 1;
        });
        if (priorMatches.length === 1) { claimedUids.add(String(priorMatches[0].uid)); safeList.push(Object.assign({}, s, { uid: priorMatches[0].uid })); continue; }
      }

      /* 그 외 — ambiguous 보류 */
      const priorYr = String(parseInt(yr, 10) - 1);
      const candidates = matches.map(m => {
        const si = this._db.stmt.siGetByUidYear.get(m.uid, priorYr) || null;
        return {
          uid: m.uid,
          name: m.name,
          gender: m.gender,
          birth_date: m.birth_date || '',
          priorGrade: si ? si.grade : null,
          priorClass: si ? si.class_num : null,
          priorNum: si ? si.student_num : null,
          priorLevel: si ? si.level : null,
          priorDepartment: si ? (si.department || null) : null,
        };
      });
      ambiguous.push({
        excelRow: i + 1,
        name: s.name,
        gender: normGender,
        excelGrade: s.grade != null ? s.grade : null,
        excelClass: (s.class_num != null ? s.class_num : s.cls) || null,
        excelNum: (s.student_num != null ? s.student_num : s.num) || null,
        level: s.level || null,
        department: s.department || null,
        birth_date: incomingBirth,
        candidates: candidates,
        rawData: s,
      });
    }

    const saveResult = this.saveAll(yr, safeList);
    return {
      success: !!(saveResult && saveResult.success),
      count: (saveResult && saveResult.count) || 0,
      ambiguous: ambiguous,
      ambiguousCount: ambiguous.length,
      year: yr,
      saveError: (saveResult && !saveResult.success) ? saveResult.error : null,
    };
  }

  /* 사용자가 동명이인 모달에서 후보 결정 → 해당 학생 등록 확정 (chosenUid=null이면 신규 uid) */
  resolveAmbiguousImport(year, item, chosenUid) {
    const yr = this._yr(year);
    const data = Object.assign({}, (item && item.rawData) || {}, {
      uid: chosenUid || undefined,
      name: item ? item.name : '',
      gender: item ? item.gender : '',
    });
    return this.upsert(yr, data);
  }

  /**
   *  학생 "삭제" — 명단에서만 제외(soft-delete).
   *
   *  이 프로젝트의 DB 설계 원칙:
   *   • students 행(uid·이름·생년월일) 은 immutable. 보건일지·응급·감염 기록이 person_uid 로
   *     계속 참조하므로 행을 지우면 과거 기록의 이름·식별정보가 끊김.
   *   • students_info 의 is_enrolled = 0 이 "전출·자퇴·졸업으로 명단에서 빠짐" 의 표시.
   *   • 진짜 행 삭제는 "DB 등록 5년 경과 + 모든 기록 참조 0건" 의 orphan cleanup 에서만 수행.
   *
   *  따라서 사용자의 "삭제" 동작은 모든 학년도의 is_enrolled 를 0 으로 내리는 것으로 충분.
   *  과거 학년도의 학년·반·번호 정보는 그대로 남아 보건일지 행 렌더 시 식별에 쓰임.
   */
  delete(uid) {
    if (!uid) return { success: false, error: 'no uid' };
    this._db.stmt.siUnenrollAllByUid.run(this._db.now(), uid);
    return { success: true };
  }

  /* 이번 학년도 전체 명단 일괄 삭제 (soft-delete) — 행 보존, is_enrolled 만 0.
     보건일지·응급·감염 기록의 person_uid 참조는 그대로 유지(고아 안 됨). 2026-06-12 */
  deleteAllForYear(year) {
    /* school_year 컬럼은 TEXT — 렌더러가 숫자(2026)를 넘기면 'WHERE school_year=2026' 이
       타입 불일치로 0건 매칭되던 버그. 반드시 문자열로 강제 (사용자 보고 2026-06-12) */
    const yr = String(this._yr(year));
    const r = this._db.stmt.siUnenrollAllForYear.run({ now: this._db.now(), yr });
    return { success: true, count: (r && r.changes) || 0 };
  }

  /** ────────────────────────────────────────────────────────────
   *  동명이인(같은 학교급+학년+이름+성별) 탐지 — 새 학년도 명단 업로드 직후 호출.
   *
   *  배경: 새 학년도 업로드 시 byNameGender 가 2+ 매칭 + 생년월일 tiebreaker 실패 →
   *        새 uid 가 생성됨 → 결과적으로 같은 학년에 같은 이름 학생 2명 이상 + 작년 기록과 단절.
   *  사용자가 어떤 학생이 작년 어느 학생인지 매칭해야 보건일지 연속성이 유지됨.
   *
   *  반환 구조 (각 그룹마다):
   *    { level, grade, name, gender,
   *      currentMembers: [{uid, class_num, student_num, ...}],
   *      prevCandidates: [{uid, class_num, student_num, prev_visit_count, ...}] }
   *
   *  prevCandidates 가 비어 있는 그룹(작년에 같은 이름 학생이 없던 경우 = 정말 신규 전학 등) 은
   *  반환에서 제외. UI 에서 매칭할 게 없는 그룹은 표시할 필요 없음. */
  findNameDuplicates(year) {
    const db = this._db.db;
    const yr = this._yr(year);
    const prevYr = String(Number(yr) - 1);
    /* 현재 학년도 active 명단 — students_info + students JOIN */
    const rows = db.prepare(
      `SELECT s.uid, s.name, s.gender, s.birth_date,
              si.level, si.grade, si.class_num, si.student_num, si.department
       FROM students_info si
       JOIN students s ON s.uid = si.uid
       WHERE si.school_year = ? AND si.is_enrolled = 1
       ORDER BY si.level, si.department, si.grade, s.name`
    ).all(yr);
    /* 같은 (학교급, 학과, 학년, 이름) 그룹화 — 동명이인 후보. 성별은 매칭에 쓰지 않음 (사용자 확정 2026-06-13).
       학과가 입력된 고등학교는 같은 학과 안에서만 동명이인으로 묶는다. */
    const groups = {};
    rows.forEach(r => {
      const key = (r.level||'') + '|' + (r.department||'') + '|' + (r.grade||'') + '|' + (r.name||'');
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    const result = [];
    Object.values(groups).forEach(g => {
      if (g.length < 2) return; /* 동명이인 아님 */
      const head = g[0];
      const prevGrade = Number(head.grade) - 1;
      if (prevGrade < 1) {
        /* 1학년이 작년에는 존재하지 않음 — 매칭 대상 없음. UI 에서 안 띄움. */
        return;
      }
      /* 작년 (year-1) 같은 학교급+학과+(학년-1)+이름 학생 — 매칭 후보. 성별 무관. 현재 그룹 멤버는 제외. */
      const newUids = g.map(m => m.uid);
      const placeholders = newUids.map(() => '?').join(',');
      const sql =
        `SELECT s.uid, s.name, s.gender, s.birth_date,
                si.school_year, si.level, si.grade, si.class_num, si.student_num, si.department,
                (SELECT COUNT(*) FROM daily_records dr WHERE dr.person_uid = s.uid) AS visit_count
         FROM students_info si
         JOIN students s ON s.uid = si.uid
         WHERE si.school_year = ?
           AND IFNULL(si.level,'') = ?
           AND IFNULL(si.department,'') = ?
           AND si.grade = ?
           AND s.name = ?
           AND s.uid NOT IN (${placeholders})
         ORDER BY si.class_num, si.student_num`;
      const candidates = db.prepare(sql).all(prevYr, head.level||'', head.department||'', prevGrade, head.name, ...newUids);
      if (!candidates.length) return; /* 작년 후보 없음 — 매칭할 게 없으니 그룹 제외 */
      result.push({
        type: 'student',
        level: head.level,
        grade: head.grade,
        prevGrade: prevGrade,
        name: head.name,
        gender: head.gender,
        currentMembers: g.map(m => ({
          uid: m.uid, name: m.name, gender: m.gender, birth_date: m.birth_date,
          level: m.level, grade: m.grade, class_num: m.class_num, student_num: m.student_num,
          department: m.department,
        })),
        prevCandidates: candidates.map(c => ({
          uid: c.uid, name: c.name, gender: c.gender, birth_date: c.birth_date,
          level: c.level, grade: c.grade, class_num: c.class_num, student_num: c.student_num,
          department: c.department, school_year: c.school_year,
          visit_count: c.visit_count || 0,
        })),
      });
    });
    return result;
  }

  /** ────────────────────────────────────────────────────────────
   *  동명이인 매칭 해결 — 현재 학년도 uid 를 작년 uid 로 병합.
   *
   *  병합 절차 (트랜잭션):
   *    1. 현재 uid 의 daily_records / emergency_records / infection_records 의 person_uid 를 prev uid 로 갱신
   *    2. 현재 uid 의 students_info 행을 임시 변수에 보관 후 삭제
   *    3. prev uid 에 같은 school_year 의 students_info 가 이미 있으면 UPDATE, 아니면 INSERT
   *    4. 현재 uid 의 students 행 삭제
   *
   *  반환: { success, mergedTo: prevUid, autoResolved: [...] }  자동 캐스케이드는 호출 측에서 다시 detect 후 처리.
   */
  resolveNameDuplicate(currentUid, prevUid) {
    if (!currentUid || !prevUid) return { success: false, error: 'missing uids' };
    if (currentUid === prevUid) return { success: false, error: 'same uid' };
    const db = this._db.db;
    const now = this._db.now();
    const tx = db.transaction(() => {
      /* 1. 기록 person_uid 재지정 — person_uid 컬럼을 가진 모든 테이블을 빠짐없이 갱신.
       *    학년이 바뀌어도 가장 오래된 기록까지 전부 prevUid 로 연결되어 보건일지·응급·감염·상담·설문 응답이 끊김없이 유지됨. */
      db.prepare('UPDATE daily_records     SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      db.prepare('UPDATE emergency_records SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      db.prepare('UPDATE infection_records SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      db.prepare('UPDATE counseling_records SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      /* import_staging — 외부 데이터 가져오기 중간 상태(매칭만 됨, daily_records 반영 전) 의 안전망 */
      try { db.prepare('UPDATE import_staging SET matched_person_uid = ? WHERE matched_person_uid = ?').run(prevUid, currentUid); } catch(_){}
      /* survey_responses 는 UNIQUE(school_year, form_id, student_persistent_id) 제약이 있음 —
       *  prev uid 행이 이미 같은 (year, form) 으로 있는 경우 currentUid 행을 삭제 (prev 의 응답 보존).
       *  그렇지 않으면 person_uid + student_persistent_id 둘 다 갱신. */
      const surveyRows = db.prepare('SELECT id, school_year, form_id FROM survey_responses WHERE person_uid = ?').all(currentUid);
      const checkSurvey = db.prepare('SELECT id FROM survey_responses WHERE person_uid = ? AND school_year = ? AND form_id = ?');
      const delSurvey = db.prepare('DELETE FROM survey_responses WHERE id = ?');
      const updSurvey = db.prepare('UPDATE survey_responses SET person_uid = ?, student_persistent_id = ? WHERE id = ?');
      for (const sr of surveyRows){
        const dup = checkSurvey.get(prevUid, sr.school_year, sr.form_id);
        if (dup){ delSurvey.run(sr.id); }
        else    { updSurvey.run(prevUid, prevUid, sr.id); }
      }
      /* student_persistent_id 가 currentUid 였던 잔여 행도 일관성 위해 갱신 (person_uid 가 NULL 인 옛 행 대비) */
      try {
        db.prepare('UPDATE survey_responses SET student_persistent_id = ? WHERE student_persistent_id = ? AND person_uid IS NULL').run(prevUid, currentUid);
      } catch(_){}
      /* 2. 현재 uid 의 모든 students_info 행 → prev uid 로 이관 (school_year 충돌 시 prev 의 행 우선) */
      const infoRows = db.prepare('SELECT * FROM students_info WHERE uid = ?').all(currentUid);
      const checkExist = db.prepare('SELECT id FROM students_info WHERE uid = ? AND school_year = ?');
      const updateInfo = db.prepare(
        `UPDATE students_info
            SET grade=?, class_num=?, student_num=?, level=?, department=?,
                guardian_type=?, guardian_contact=?, homeroom_teacher=?,
                is_enrolled=?, is_care=?, care_reason=?, dust_disease=?, care_memo=?,
                med_consent=?, emergency_consent=?, vip=?, extra_json=?, updated_at=?
          WHERE uid=? AND school_year=?`
      );
      const insertInfo = db.prepare(
        `INSERT INTO students_info
           (uid, school_year, grade, class_num, student_num, level, department,
            guardian_type, guardian_contact, homeroom_teacher,
            is_enrolled, is_care, care_reason, dust_disease, care_memo,
            med_consent, emergency_consent, vip, extra_json, created_at, updated_at)
         VALUES
           (?,?,?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?,?,?)`
      );
      for (const r of infoRows) {
        const exists = checkExist.get(prevUid, r.school_year);
        if (exists) {
          updateInfo.run(
            r.grade, r.class_num, r.student_num, r.level||'', r.department||'',
            r.guardian_type||'', r.guardian_contact||'', r.homeroom_teacher||'',
            r.is_enrolled, r.is_care, r.care_reason||'', r.dust_disease||'', r.care_memo||'',
            r.med_consent||'Y', r.emergency_consent||'Y', r.vip||'', r.extra_json||'{}',
            now, prevUid, r.school_year
          );
        } else {
          insertInfo.run(
            prevUid, r.school_year, r.grade, r.class_num, r.student_num,
            r.level||'', r.department||'', r.guardian_type||'', r.guardian_contact||'',
            r.homeroom_teacher||'', r.is_enrolled, r.is_care, r.care_reason||'',
            r.dust_disease||'', r.care_memo||'', r.med_consent||'Y',
            r.emergency_consent||'Y', r.vip||'', r.extra_json||'{}', now, now
          );
        }
      }
      db.prepare('DELETE FROM students_info WHERE uid = ?').run(currentUid);
      /* 3. 현재 uid 의 students 행 삭제 (작년 행으로 통합됨) */
      db.prepare('DELETE FROM students WHERE uid = ?').run(currentUid);
    });
    try {
      tx();
      return { success: true, mergedTo: prevUid };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /** 특정 학년도 등록 정보만 제거 — 다른 학년도에 등록되어 있다면 그대로 유지. */
  deleteInfo(uid, year) {
    this._db.stmt.siDelete.run(uid, this._yr(year));
    return { success: true };
  }

  /* ──────────── 완전 고아 학생 정리 대상 조회 (5년 보존 정리) ────────────
     기준 (모두 만족):
       - 현재 활성 등록 0건 (is_enrolled=1 인 students_info 행 없음)  ← 2026-05-18: soft-delete 도입 반영
       - daily_records 참조 0건
       - emergency_records 참조 0건
       - infection_records 참조 0건
       - DB 등록일(s.created_at) 이 5년(cutoffYears) 이상 경과
     반환: uid·이름·성별·생년월일·등록일 (DB 등록일자만 표시).
     이 조건 충족 시에만 진짜 hard-delete (students 행 + 잔존 students_info 행) 수행. */
  findOrphanStudents(cutoffYears) {
    const cy = parseInt(cutoffYears, 10) || 5;
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - cy);
    const cutoffIso = cutoffDate.toISOString();
    const sql = `
      SELECT s.uid, s.name, s.gender, s.birth_date, s.created_at
      FROM students s
      WHERE s.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM students_info     WHERE uid = s.uid AND is_enrolled = 1)
        AND NOT EXISTS (SELECT 1 FROM daily_records     WHERE person_uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM emergency_records WHERE person_uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM infection_records WHERE person_uid = s.uid)
      ORDER BY s.created_at ASC
    `;
    return this._db.db.prepare(sql).all(cutoffIso).map(r => ({
      uid: r.uid, name: r.name, gender: r.gender,
      birth_date: r.birth_date, created_at: r.created_at,
    }));
  }

  /* 고아 학생만 일괄 삭제 — 안전 가드: 호출 시점에도 다시 한번 참조 0건 확인.
   *  soft-delete 후 잔존 students_info(is_enrolled=0) 도 함께 제거. */
  bulkDeleteOrphanStudents(uids) {
    if (!Array.isArray(uids) || uids.length === 0) return { success: true, count: 0 };
    const tx = this._db.db.transaction(() => {
      let deleted = 0;
      for (const uid of uids) {
        const checks = [
          this._db.db.prepare('SELECT 1 FROM students_info WHERE uid=? AND is_enrolled = 1 LIMIT 1').get(uid),
          this._db.db.prepare('SELECT 1 FROM daily_records WHERE person_uid=? LIMIT 1').get(uid),
          this._db.db.prepare('SELECT 1 FROM emergency_records WHERE person_uid=? LIMIT 1').get(uid),
          this._db.db.prepare('SELECT 1 FROM infection_records WHERE person_uid=? LIMIT 1').get(uid),
        ];
        if (checks.some(c => c)) continue; /* 활성 등록 / 참조가 한 건이라도 있으면 안전 차원에서 스킵 */
        this._db.db.prepare('DELETE FROM students_info WHERE uid=?').run(uid);
        this._db.db.prepare('DELETE FROM students WHERE uid=?').run(uid);
        deleted++;
      }
      return deleted;
    });
    const count = tx();
    return { success: true, count };
  }

  setEnrolled(uid, year, enrolled) {
    this._db.stmt.siSetEnrolled.run(enrolled ? 1 : 0, this._db.now(), uid, this._yr(year));
    return { success: true };
  }

  updateMemo(uid, memoJson) {
    const stu = this._db.stmt.studentsGetByUid.get(uid);
    if (!stu) return { success: false, error: 'Student not found' };
    this._db.stmt.studentsUpsert.run({
      uid,
      name: stu.name,
      gender: stu.gender,
      birth_date: stu.birth_date,
      memo_json: typeof memoJson === 'string' ? memoJson : JSON.stringify(memoJson),
      created_at: stu.created_at,
      updated_at: this._db.now(),
    });
    return { success: true };
  }

  updateMedConsent(uid, consent) {
    const stu = this._db.stmt.studentsGetByUid.get(uid);
    if (!stu) return { success: false, error: 'Student not found: ' + uid };
    this._db.stmt.studentsUpsert.run({
      uid,
      name: stu.name,
      gender: stu.gender,
      birth_date: stu.birth_date,
      memo_json: stu.memo_json || '{}',
      created_at: stu.created_at,
      updated_at: this._db.now(),
    });
    const yr = String(this._yr());
    this._db.db.prepare('UPDATE students_info SET med_consent = ? WHERE uid = ? AND school_year = ?').run(consent, uid, yr);
    return { success: true };
  }

  /* ──────────── 그룹핑 ──────────── */

  getGradeSummary(year) {
    const yr = this._yr(year);
    const rows = this._db.stmt.siGetByYear.all(yr);
    const gradeMap = {};
    rows.forEach(s => {
      const g = Number(s.grade) || 0;
      if (!g) return;
      gradeMap[g] = (gradeMap[g] || 0) + 1;
    });
    return Object.keys(gradeMap).map(Number).sort((a, b) => a - b).map(g => ({ grade: g, count: gradeMap[g] }));
  }

  getClassGroups(year, grades) {
    const yr = this._yr(year);
    const all = this._db.stmt.siGetByYear.all(yr);
    const gradeSet = grades ? new Set(grades.map(Number)) : null;
    const groups = {};
    all.forEach(s => {
      const g = Number(s.grade) || 0;
      if (!g) return;
      if (gradeSet && !gradeSet.has(g)) return;
      /* class_num/student_num 이 텍스트일 수 있음 — 원본 그대로 사용 */
      const cRaw = s.class_num;
      const c = (cRaw != null && /^-?\d+$/.test(String(cRaw))) ? parseInt(cRaw, 10) : (cRaw || '');
      const key = g + '_' + String(c);
      if (!groups[key]) groups[key] = { grade: g, cls: c, people: [] };
      const nRaw = s.student_num;
      const numVal = (nRaw != null && /^-?\d+$/.test(String(nRaw))) ? parseInt(nRaw, 10) : (nRaw || 0);
      groups[key].people.push({
        uid: s.uid,
        name: s.name || '',
        num: numVal,
        gender: s.gender || '',
        isCare: Number(s.is_care) === 1,
      });
    });
    return Object.keys(groups).sort().map(k => {
      groups[k].people.sort((a, b) => a.num - b.num);
      return groups[k];
    });
  }

  countByYear(year) {
    const row = this._db.stmt.siCountByYear.get(this._yr(year));
    return row ? row.cnt : 0;
  }

  getYears() {
    return this._db.stmt.siYears.all().map(r => r.school_year);
  }
}

/* ══════════ StaffDBService ══════════ */

class StaffDBService {
  constructor(healthDB) {
    this._db = healthDB;
  }

  /* 학년도는 항상 문자열 — school_year 컬럼이 TEXT 라 숫자가 섞이면 ===/SQL 비교가 전부 깨진다 (2026-06-12) */
  _yr(year) { return String(year || HealthDiaryDB.academicYear()); }

  getAll(year) {
    return this._db.stmt.staffGetByYear.all(this._yr(year));
  }

  getAllIncludeInactive(year) {
    return this._db.stmt.staffGetByYearAll.all(this._yr(year));
  }

  /** 모든 교직원 통합 조회 — 학년도·재직 상태 무관 (S.leavers 적재용). */
  getAllHistorical() {
    return this._db.stmt.staffGetAllRaw.all();
  }

  /** 동명이인 탐지 — 현재 학년도 active 교직원 중 같은 이름+직위 그룹 + 작년 inactive 후보.
   *  성별은 매칭에 쓰지 않음 (사용자 확정 2026-06-13: 교직원은 이름+직위로만 식별). */
  findNameDuplicates(year) {
    const db = this._db.db;
    const yr = this._yr(year);
    /* 현재 학년도 + is_active=1 교직원 목록 */
    const rows = db.prepare('SELECT * FROM staff WHERE school_year = ? AND is_active = 1 ORDER BY name, position').all(yr);
    const groups = {};
    rows.forEach(r => {
      const key = (r.name||'') + '|' + (r.position||'');
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    const result = [];
    Object.values(groups).forEach(g => {
      if (g.length < 2) return;
      const head = g[0];
      const newUids = g.map(m => m.uid);
      const placeholders = newUids.map(() => '?').join(',');
      const sql =
        `SELECT s.uid, s.name, s.gender, s.position, s.birth_date, s.school_year, s.is_active,
                (SELECT COUNT(*) FROM daily_records dr WHERE dr.person_uid = s.uid) AS visit_count
         FROM staff s
         WHERE s.name = ?
           AND IFNULL(s.position,'') = ?
           AND s.uid NOT IN (${placeholders})
         ORDER BY s.school_year DESC`;
      const candidates = db.prepare(sql).all(head.name, head.position||'', ...newUids);
      if (!candidates.length) return;
      result.push({
        type: 'staff',
        name: head.name,
        gender: head.gender,
        currentMembers: g.map(m => ({
          uid: m.uid, name: m.name, gender: m.gender, position: m.position,
          birth_date: m.birth_date, school_year: m.school_year, is_active: m.is_active,
        })),
        prevCandidates: candidates.map(c => ({
          uid: c.uid, name: c.name, gender: c.gender, position: c.position,
          birth_date: c.birth_date, school_year: c.school_year, is_active: c.is_active,
          visit_count: c.visit_count || 0,
        })),
      });
    });
    return result;
  }

  /** 교직원 동명이인 매칭 해결 — 현재 uid 의 기록을 prev uid 로 옮기고 현재 staff 행 삭제.
   *  staff 는 학년도별 students_info 같은 분리 테이블이 없으므로 단순. */
  resolveNameDuplicate(currentUid, prevUid) {
    if (!currentUid || !prevUid) return { success: false, error: 'missing uids' };
    if (currentUid === prevUid) return { success: false, error: 'same uid' };
    const db = this._db.db;
    const now = this._db.now();
    const tx = db.transaction(() => {
      /* person_uid 를 가진 모든 테이블 — staff 도 학생과 동일하게 보건일지/응급/감염/상담/설문 전부 갱신.
       *  (counseling 은 person_type='staff' 도 있을 수 있으니 일괄 갱신) */
      db.prepare('UPDATE daily_records     SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      db.prepare('UPDATE emergency_records SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      db.prepare('UPDATE infection_records SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      db.prepare('UPDATE counseling_records SET person_uid = ?, updated_at = ? WHERE person_uid = ?').run(prevUid, now, currentUid);
      try { db.prepare('UPDATE import_staging SET matched_person_uid = ? WHERE matched_person_uid = ?').run(prevUid, currentUid); } catch(_){}
      const surveyRows = db.prepare('SELECT id, school_year, form_id FROM survey_responses WHERE person_uid = ?').all(currentUid);
      const checkSurvey = db.prepare('SELECT id FROM survey_responses WHERE person_uid = ? AND school_year = ? AND form_id = ?');
      const delSurvey = db.prepare('DELETE FROM survey_responses WHERE id = ?');
      const updSurvey = db.prepare('UPDATE survey_responses SET person_uid = ?, student_persistent_id = ? WHERE id = ?');
      for (const sr of surveyRows){
        const dup = checkSurvey.get(prevUid, sr.school_year, sr.form_id);
        if (dup){ delSurvey.run(sr.id); }
        else    { updSurvey.run(prevUid, prevUid, sr.id); }
      }
      try {
        db.prepare('UPDATE survey_responses SET student_persistent_id = ? WHERE student_persistent_id = ? AND person_uid IS NULL').run(prevUid, currentUid);
      } catch(_){}
      /* 현재 uid 의 staff 행 → prev uid 의 staff 행으로 정보 갱신 (직위·학년도 최신화 + is_active=1) */
      const cur = db.prepare('SELECT * FROM staff WHERE uid = ?').get(currentUid);
      if (cur) {
        db.prepare(
          `UPDATE staff SET school_year=?, position=?, gender=?, birth_date=?,
                            family_relation=?, family_phone=?, is_active=1, updated_at=?
            WHERE uid = ?`
        ).run(cur.school_year, cur.position||'', cur.gender||'', cur.birth_date||'',
              cur.family_relation||'', cur.family_phone||'', now, prevUid);
        db.prepare('DELETE FROM staff WHERE uid = ?').run(currentUid);
      }
    });
    try {
      tx();
      return { success: true, mergedTo: prevUid };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  getByUid(uid) {
    return this._db.stmt.staffGetByUid.get(uid) || null;
  }

  getAllYears() {
    return this._db.stmt.staffGetAll.all();
  }

  upsert(year, data) {
    /* 입력 검증 */
    const v = HealthDiaryDB.validateStaff(data);
    if (!v.valid) return { success: false, error: v.errors.join('; ') };

    const yr = this._yr(year);
    const now = this._db.now();
    const rawGender = (data.gender || '').trim();
    const normGender = GENDER_MAP[rawGender] || rawGender;
    const birth = (data.birth_date || data.birthDate || data.birth || '').trim();

    let uid = data.uid;
    /* forceNew: 렌더러가 '신규 인원/다른 사람'으로 판정 → 이름이 같아도 작년 인원과 연결하지 않고 새 uid 부여
       (사용자 요청 2026-06-09: 같은 이름의 다른 사람이 새로 온 경우 등) */
    if (!uid && data.forceNew) { uid = HealthDiaryDB.generateStaffUid(this._db.db); }
    if (!uid) {
      /* 교직원 고유 식별 기준: 이름 + 직위(position) 조합.
       * 둘 중 하나라도 다르면 다른 사람으로 간주 (사용자 확정 방침 2026-06-13).
       * 성별·생년월일은 식별자가 아니라 보조 정보 — tiebreak 에만 사용. */
      const inName = (data.name || '').trim();
      const inPos  = (data.position || '').trim();
      const byNamePos = this._db.db.prepare(
        'SELECT * FROM staff WHERE name = ? AND position = ? ORDER BY school_year DESC'
      ).all(inName, inPos);

      if (byNamePos.length === 0) {
        /* 이름+직위 조합 없음 → 신규 인원 */
        uid = HealthDiaryDB.generateStaffUid(this._db.db);
      } else if (byNamePos.length === 1) {
        uid = byNamePos[0].uid;
      } else {
        /* 이름+직위가 같은 행이 여럿 (드문 상황) — 생년월일 일치 → 가장 최근 학년도 순 tiebreak.
         * 성별은 매칭에 쓰지 않음 (사용자 확정 2026-06-13: 교직원 성별은 대부분 미입력). */
        let matched = null;
        if (birth) matched = byNamePos.find(e => (e.birth_date || '').trim() === birth);
        uid = (matched || byNamePos[0]).uid;
      }
    }

    /* 생년월일 보존 정책: 입력이 비어있으면 DB 기존 값 유지 (덮어쓰기 방지) */
    const existingStaff = this._db.stmt.staffGetByUid.get(uid);
    const finalBirth = birth || (existingStaff && existingStaff.birth_date) || '';

    this._db.stmt.staffUpsert.run({
      uid,
      school_year: yr,
      position: data.position || '',
      name: data.name || '',
      gender: normGender,
      birth_date: finalBirth,
      family_relation: data.family_relation || data.familyRelation || data.familyContact || '',
      family_phone: data.family_phone || data.familyPhone || '',
      is_active: data.is_active != null ? Number(data.is_active) : 1,
      /* VIP 승계 — 교직원은 uid 단일 영속 행이므로, 신년도 명단 재업로드(이름+직위로 작년 uid 연결) 시
         업로드가 vip 를 명시하지 않으면 기존 vip 를 그대로 유지한다. uid 기준이라 다른 교직원에게 섞이지 않음. (2026-06-16) */
      vip: data.vip != null ? String(data.vip) : ((existingStaff && existingStaff.vip) ? String(existingStaff.vip) : ''),
      created_at: existingStaff ? existingStaff.created_at : now,
      updated_at: now,
    });

    return { success: true, uid };
  }

  saveAll(year, staffList) {
    const yr = this._yr(year);
    const results = [];
    const validationErrors = [];
    const tx = this._db.db.transaction(() => {
      for (let i = 0; i < (staffList || []).length; i++) {
        const s = staffList[i];
        const r = this.upsert(yr, s);
        results.push(r);
        if (!r.success) validationErrors.push({ index: i + 1, name: s.name || '(이름 없음)', error: r.error });
      }
    });
    tx();
    if (validationErrors.length > 0) {
      return { success: false, count: results.length, errors: validationErrors,
        error: validationErrors.map(e => e.index + '번 ' + e.name + ': ' + e.error).join('\n') };
    }
    return { success: true, count: results.length };
  }

  /**
   *  교직원 "삭제" — 명단에서만 제외(soft-delete).
   *  staff 행은 보존하고 is_active 만 0 으로 내려서 보건일지·응급·감염 기록의 person_uid 참조가
   *  끊기지 않게 함. 진짜 행 삭제는 orphan cleanup 만. (학생 delete 와 동일 원칙)
   */
  delete(uid) {
    if (!uid) return { success: false, error: 'no uid' };
    this._db.stmt.staffDeactivate.run(this._db.now(), uid);
    return { success: true };
  }

  /* 이번 학년도 교직원 전체 명단 일괄 삭제 (soft-delete) — 행 보존, is_active 만 0. 2026-06-12 */
  deleteAllForYear(year) {
    /* school_year 컬럼은 TEXT — 숫자 학년도가 오면 0건 매칭되던 버그. 문자열 강제 (사용자 보고 2026-06-12) */
    const yr = String(this._yr(year));
    const r = this._db.stmt.staffDeactivateAllForYear.run({ now: this._db.now(), yr });
    return { success: true, count: (r && r.changes) || 0 };
  }

  deactivate(uid) {
    this._db.stmt.staffDeactivate.run(this._db.now(), uid);
    return { success: true };
  }

  /* 완전 고아 교직원 — 보건일지/응급/감염 어디에도 참조 0건 + DB 등록일 5년 이상 경과 */
  findOrphanStaff(cutoffYears) {
    const cy = parseInt(cutoffYears, 10) || 5;
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - cy);
    const cutoffIso = cutoffDate.toISOString();
    /* is_active=0 (전근·퇴직 처리됨) + 5년 + 모든 기록 참조 0건 일 때만 hard-delete 후보.
     * 현직(is_active=1) 인 교직원은 어떤 경우에도 cleanup 후보가 되지 않게 차단 (2026-05-18). */
    const sql = `
      SELECT uid, name, position, gender, birth_date, created_at, updated_at, is_active
      FROM staff s
      WHERE s.created_at < ?
        AND s.is_active = 0
        AND NOT EXISTS (SELECT 1 FROM daily_records     WHERE person_uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM emergency_records WHERE person_uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM infection_records WHERE person_uid = s.uid)
      ORDER BY created_at ASC
    `;
    return this._db.db.prepare(sql).all(cutoffIso);
  }

  /* 고아 교직원 일괄 삭제 — 호출 시점 가드 (is_active=0 재확인 + 참조 0건 재확인) */
  bulkDeleteOrphanStaff(uids) {
    if (!Array.isArray(uids) || uids.length === 0) return { success: true, count: 0 };
    const tx = this._db.db.transaction(() => {
      let deleted = 0;
      for (const uid of uids) {
        const active = this._db.db.prepare('SELECT is_active FROM staff WHERE uid=?').get(uid);
        if (!active || active.is_active === 1) continue; /* 현직이면 절대 삭제 안 함 */
        const checks = [
          this._db.db.prepare('SELECT 1 FROM daily_records WHERE person_uid=? LIMIT 1').get(uid),
          this._db.db.prepare('SELECT 1 FROM emergency_records WHERE person_uid=? LIMIT 1').get(uid),
          this._db.db.prepare('SELECT 1 FROM infection_records WHERE person_uid=? LIMIT 1').get(uid),
        ];
        if (checks.some(c => c)) continue;
        this._db.db.prepare('DELETE FROM staff WHERE uid=?').run(uid);
        deleted++;
      }
      return deleted;
    });
    const count = tx();
    return { success: true, count };
  }
}

/* ══════════ UserService ══════════ */

class UserService {
  constructor(db) {
    this._db = db;
  }

  getAll() {
    return this._db.stmt.userGetAll.all();
  }

  getActive() {
    return this._db.stmt.userGetActive.all();
  }

  getById(id) {
    return this._db.stmt.userGetById.get(id) || null;
  }

  static _levelGroup(level) {
    return level || 'elementary';
  }

  create(data) {
    const active = this.getActive();
    if (active.length >= 3) {
      throw new Error('사용자는 최대 3명까지 등록할 수 있습니다.');
    }
    const now = this._db.now();
    const info = this._db.stmt.userInsert.run({
      name: data.name || '',
      position: data.position || '보건교사',
      school_name: data.school_name || '',
      school_level: data.school_level || 'elementary',
      edu_office: data.edu_office || '',
      created_at: now,
      updated_at: now,
    });
    return this.getById(info.lastInsertRowid);
  }

  update(id, data) {
    const existing = this.getById(id);
    if (!existing) return null;
    this._db.stmt.userUpdate.run({
      id,
      name: data.name ?? existing.name,
      position: data.position ?? existing.position,
      school_name: data.school_name ?? existing.school_name,
      school_level: data.school_level ?? existing.school_level,
      edu_office: data.edu_office ?? existing.edu_office,
      updated_at: this._db.now(),
    });
    return this.getById(id);
  }

  remove(id) {
    const hasRecords = this._db.stmt.userHasRecords.get(id);
    if (hasRecords && hasRecords.cnt > 0) {
      this._db.stmt.userDeactivate.run(this._db.now(), id);
      return { action: 'deactivated' };
    }
    this._db.stmt.userDelete.run(id);
    return { action: 'deleted' };
  }
}

module.exports = { StudentsDBService, StaffDBService, UserService };
