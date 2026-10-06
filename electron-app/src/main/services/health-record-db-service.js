/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const { HealthDiaryDB } = require('./database');

/**
 * HealthRecordDBService — 보건일지 레코드 CRUD (Schema v9)
 * daily_records, emergency_records, infection_records 관리
 * person_uid + person_type으로 학생/교직원 구분
 */
class HealthRecordDBService {
  constructor(healthDB) {
    this._db = healthDB;
  }

  _yr(year) { return year || HealthDiaryDB.academicYear(); }

  /* ──────────── Daily: 행 변환 ──────────── */

  _toDailyRecord(r) {
    let syms = r.symptoms;
    try { if (typeof syms === 'string') syms = JSON.parse(syms); } catch (_) { syms = syms ? [syms] : []; }
    let bm = r.bodymap_json;
    try { if (typeof bm === 'string') bm = JSON.parse(bm); } catch (_) { bm = []; }
    let vipTags = r.vip_tags;
    try { if (typeof vipTags === 'string') vipTags = JSON.parse(vipTags); } catch (_) { vipTags = []; }
    /* treatment_by_sym (v3+) — 증상별 처치 매핑. 옛 record/오류 시 빈 객체로 폴백.
     *  포맷: { "찰과상 (오른쪽 무릎, 범위 2cm)": ["소독", "밴드"], "두통": ["타이레놀 1t"] } */
    let tbs = r.treatment_by_sym;
    try {
      if (typeof tbs === 'string' && tbs.trim()) tbs = JSON.parse(tbs);
      else if (tbs && typeof tbs === 'object') { /* already parsed */ }
      else tbs = {};
    } catch (_) { tbs = {}; }
    if (!tbs || typeof tbs !== 'object' || Array.isArray(tbs)) tbs = {};
    /* physical_assessment (v5) — 신체사정 { items:["시진",…], details:{"시진":"…"} }. 옛 record/오류 시 null 폴백. */
    let pa = r.physical_assessment;
    try {
      if (typeof pa === 'string' && pa.trim()) pa = JSON.parse(pa);
      else if (pa && typeof pa === 'object') { /* already parsed */ }
      else pa = null;
    } catch (_) { pa = null; }
    if (pa && (typeof pa !== 'object' || Array.isArray(pa))) pa = null;
    if (pa) { if (!Array.isArray(pa.items)) pa.items = []; if (!pa.details || typeof pa.details !== 'object' || Array.isArray(pa.details)) pa.details = {}; }
    /* extra_json 에서 treatment_memo (자유 서술형 처치) + 미매칭 placeholder 식별정보 + v3 증상별 약품 매핑 추출 */
    let _ej = {};
    try { if (typeof r.extra_json === 'string') _ej = JSON.parse(r.extra_json) || {}; else if (r.extra_json) _ej = r.extra_json; } catch (_) { _ej = {}; }
    /* 명단 미등록 placeholder — person_uid IS NULL + extra_json.unmatched_identity 동시 충족 */
    const _placeheld = (!r.person_uid && _ej && _ej.unmatched_identity) ? _ej.unmatched_identity : null;
    /* v3 — 증상별 약품/도즈 매핑 (사용자 결정 2026-05-21).
     *  · meds_by_sym: {"증상라벨":["약명",...]} — 각 블록의 약품 리스트
     *  · med_doses_by_sym: {"증상라벨":{"약명":"도즈"}} — 증상-약품 쌍의 도즈
     *  · 옛 record 는 없으면 빈 객체로 폴백 → 렌더러가 옛 일지 모드로 표시. */
    const _mbs = (_ej.meds_by_sym && typeof _ej.meds_by_sym === 'object' && !Array.isArray(_ej.meds_by_sym)) ? _ej.meds_by_sym : {};
    const _mdbs = (_ej.med_doses_by_sym && typeof _ej.med_doses_by_sym === 'object' && !Array.isArray(_ej.med_doses_by_sym)) ? _ej.med_doses_by_sym : {};
    const _scm = (_ej.sym_cat_map && typeof _ej.sym_cat_map === 'object' && !Array.isArray(_ej.sym_cat_map)) ? _ej.sym_cat_map : {};

    /* treatment 평탄 목록 — JSON 배열로 저장된 새 포맷이면 파싱(합성칩 콤마 보존), 옛 콤마 문자열이면 split 폴백 (2026-05-28). */
    let _treatArr = r.treatment;
    if (Array.isArray(_treatArr)) { /* 이미 배열 */ }
    else if (typeof _treatArr === 'string' && _treatArr) {
      let _tp = null;
      if (_treatArr.charAt(0) === '[') { try { _tp = JSON.parse(_treatArr); } catch (_) {} }
      _treatArr = Array.isArray(_tp) ? _tp : _treatArr.split(',');
    } else { _treatArr = []; }

    return {
      id: r.id,
      date: r.visit_date,
      timeIn: r.time_in || '',
      timeOut: r.time_out || '',
      personUid: r.person_uid || '',
      personType: r.person_type || 'student',
      symptoms: syms || [],
      treatment: _treatArr,
      treatmentBySym: tbs,
      /* 신체사정 (v5) — {items,details} 또는 null. 옛 record 는 null → 렌더러가 '신체사정 없음' 으로 표시. */
      physicalAssessment: pa,
      treatmentMemo: _ej.treatment_memo || '',
      medsBySym: _mbs,
      medDosesBySym: _mdbs,
      symCatMap: _scm,
      /* 분기/미분기 모드 (2026-06-09) — boolean 이면 복원, 없으면 undefined → 렌더러 기존 추론. */
      treatmentBranched: (typeof _ej.treatment_branched === 'boolean') ? _ej.treatment_branched : undefined,
      /* 사용자 보고 2026-05-22 — 자유 기입 증상의 카테고리 매핑 (catId → text).
       *  모달 재진입·앱 재시작 후에도 카테고리 카운트 배지가 정확히 복원되도록. */
      symFreeTextByCat: (_ej.sym_free_text_by_cat && typeof _ej.sym_free_text_by_cat==='object' && !Array.isArray(_ej.sym_free_text_by_cat))
        ? _ej.sym_free_text_by_cat : {},
      /* V/S 시간대별 측정 이력 — extra_json.vs_history 복원. 옛 record 는 빈 배열. */
      vsHistory: Array.isArray(_ej.vs_history) ? _ej.vs_history : [],
      /* 상담록 — extra_json.counsel_log 복원 (2026-06-12). 없으면 null. */
      counselLog: (_ej.counsel_log && typeof _ej.counsel_log==='object' && !Array.isArray(_ej.counsel_log)) ? _ej.counsel_log : null,
      unmatchedIdentity: _placeheld,
      isPlaceholder: !!_placeheld,
      medication: r.medication || '',
      temp: r.body_temp || '',
      bp: r.blood_pressure || '',
      pulse: r.pulse || '',
      respiration: r.respiration || '',
      spo2: r.spo2 || '',
      bst: r.bst || '',
      result: r.result_code || '',
      nurse: r.nurse_name || '',
      dept: r.department || '',
      memo: r.memo || '',
      bodymapData: bm || [],
      vipTags: vipTags || [],
      bed: r.bed || '',
      isImported: !!r.is_imported,
      // JOIN 데이터
      personName: r.person_name || '',
      studentGrade: r.student_grade || 0,
      studentClass: r.student_class || 0,
      studentNum: r.student_num2 || 0,
      studentGender: r.student_gender || '',
      studentLevel: r.student_level || '',
      studentDepartment: r.student_department || '',
      isCare: !!r.is_care,
      careReason: r.care_reason || '',
      staffPosition: r.staff_position || '',
      _dbId: r.id,
    };
  }

  /* ──────────── Daily: 조회 ──────────── */

  getDailyByYear(year) {
    return this._db.stmt.dailyGetByYear.all(this._yr(year)).map(r => this._toDailyRecord(r));
  }

  getDailyByDate(year, date) {
    return this._db.stmt.dailyGetByYearDate.all(this._yr(year), date).map(r => this._toDailyRecord(r));
  }

  getDailyByDateRange(from, to) {
    return this._db.stmt.dailyGetByDateRange.all(from, to).map(r => this._toDailyRecord(r));
  }

  getNurseStatsByDateRange(from, to) {
    const rows = this._db.stmt.dailyGetByDateRange.all(from, to);
    const counts = {};
    rows.forEach(r => { const n = r.nurse_name || '미지정'; counts[n] = (counts[n] || 0) + 1; });
    return counts;
  }

  getDailyByPerson(personUid) {
    return this._db.stmt.dailyGetByPerson.all(personUid).map(r => this._toDailyRecord(r));
  }

  getDailyYears() {
    const years = this._db.stmt.dailyYears.all().map(r => r.school_year);
    const counts = this._db.stmt.dailyCountByYear.all();
    return { years, counts };
  }

  /* 보존 정리 탭 — 일반/응급/감염 모든 연도 카운트 한 번에 (현재 학년도 외 데이터 표시용) */
  getYearSummary() {
    const toMap = (rows) => {
      const m = {};
      rows.forEach(r => { m[String(r.school_year || '')] = r.cnt; });
      return m;
    };
    return {
      daily:     toMap(this._db.stmt.dailyCountByYear.all()),
      emergency: toMap(this._db.stmt.emergencyCountByAllYears.all()),
      infection: toMap(this._db.stmt.infectionCountByAllYears.all()),
    };
  }

  /* ──────────── Daily: 저장 ──────────── */

  insertDaily(record) {
    const v = HealthDiaryDB.validateDailyRecord(record);
    if (!v.valid) return { success: false, error: v.errors.join('; ') };
    const r = record;
    const _doInsert = () => {
      const now = this._db.now();
      const info = this._db.stmt.dailyInsert.run({
        school_year: r.school_year || this._yr(),
        person_uid: r.person_uid || r.personUid || null,
        person_type: r.person_type || r.personType || 'student',
        visit_date: r.visit_date || r.date || '',
        time_in: r.time_in || r.timeIn || '',
        time_out: r.time_out || r.timeOut || '',
        symptoms: typeof r.symptoms === 'string' ? r.symptoms : JSON.stringify(r.symptoms || []),
        treatment: Array.isArray(r.treatment) ? JSON.stringify(r.treatment) : (r.treatment || ''),
        /* v3+ 증상별 처치 매핑. 빈 객체/없으면 빈 문자열 (옛 record 호환). */
        treatment_by_sym: typeof r.treatment_by_sym === 'string'
          ? r.treatment_by_sym
          : (r.treatmentBySym && Object.keys(r.treatmentBySym).length ? JSON.stringify(r.treatmentBySym) : ''),
        /* v5 신체사정 — {items,details}. 빈 항목이면 빈 문자열(옛 record 호환). */
        physical_assessment: typeof r.physical_assessment === 'string'
          ? r.physical_assessment
          : (r.physicalAssessment && typeof r.physicalAssessment === 'object' && !Array.isArray(r.physicalAssessment) && (
              (Array.isArray(r.physicalAssessment.items) && r.physicalAssessment.items.length) ||
              (r.physicalAssessment.details && typeof r.physicalAssessment.details === 'object' && Object.keys(r.physicalAssessment.details).length)
            ) ? JSON.stringify(r.physicalAssessment) : ''),
        medication: r.medication || '',
        department: r.department || r.dept || '',
        body_temp: r.body_temp || r.bodyTemp || r.temp || '',
        blood_pressure: r.blood_pressure || r.bp || '',
        pulse: r.pulse || '',
        respiration: r.respiration || '',
        spo2: r.spo2 || '',
        bst: r.bst || '',
        result_code: r.result_code || r.resultCode || r.result || '',
        nurse_name: r.nurse_name || r.nurseName || r.nurse || '',
        nurse_id: r.nurse_id != null ? r.nurse_id : null,
        memo: r.memo || '',
        bodymap_json: typeof r.bodymap_json === 'string' ? r.bodymap_json : JSON.stringify(r.bodymapData || r.bodymap_json || []),
        vip_tags: typeof r.vip_tags === 'string' ? r.vip_tags : JSON.stringify(r.vipTags || r.vip_tags || []),
        bed: r.bed != null ? String(r.bed) : '',
        is_imported: r.is_imported ? 1 : 0,
        /* 사용자 보고 2026-05-22 — r.symFreeTextByCat (자유 기입 증상 카테고리 매핑) 을 extra_json 에 합쳐 저장.
         *  로드 측 _toDailyRecord 가 _ej.sym_free_text_by_cat 키로 복원. */
        extra_json: (function(){
          let _ej = {};
          try { if(typeof r.extra_json === 'string') _ej = JSON.parse(r.extra_json) || {}; else if(r.extra_json) _ej = r.extra_json; } catch(_){ _ej = {}; }
          if(r.symFreeTextByCat && typeof r.symFreeTextByCat==='object' && !Array.isArray(r.symFreeTextByCat)){
            _ej.sym_free_text_by_cat = r.symFreeTextByCat;
          }
          return JSON.stringify(_ej);
        })(),
        created_at: now,
        updated_at: now,
      });
      return Number(info.lastInsertRowid);
    };
    /* 키오스크 접수 멱등성 — 두 보건교사가 같은 호출 카드를 거의 동시에 "일지 등록"하면
       receptionId가 동일한 INSERT가 두 번 들어옴. Electron 메인과 웹서버(fork 자식)가 별도 프로세스라
       단순 SELECT-then-INSERT 는 두 프로세스 사이 race 가 가능 → BEGIN IMMEDIATE 트랜잭션으로
       RESERVED 락을 잡고 SELECT-INSERT 를 원자적으로 수행. 한쪽 프로세스가 락을 잡고 있으면
       다른 쪽은 락 해제까지 대기 후 SELECT 시점에 기존 레코드를 발견하여 already_handled 반환. */
    let _receptionId = null;
    try {
      const _ej = (r.extra_json && typeof r.extra_json === 'string') ? JSON.parse(r.extra_json) : (r.extra_json || {});
      if (_ej && _ej.fromKiosk && _ej.receptionId) _receptionId = String(_ej.receptionId);
    } catch (_) {}
    if (_receptionId) {
      const _sy = r.school_year || this._yr();
      const _findStmt = this._db.db.prepare(
        "SELECT id, nurse_name FROM daily_records WHERE school_year = ? AND " +
        "CASE WHEN json_valid(extra_json) THEN CAST(json_extract(extra_json, '$.receptionId') AS TEXT) ELSE NULL END = ? LIMIT 1"
      );
      const _txn = this._db.db.transaction(() => {
        const existing = _findStmt.get(_sy, _receptionId);
        if (existing) return { duplicate: true, id: existing.id, handler: existing.nurse_name || '' };
        return { duplicate: false, id: _doInsert() };
      });
      const result = _txn.immediate();
      if (result.duplicate) {
        return { success: false, reason: 'already_handled', id: result.id, handler: result.handler };
      }
      return { success: true, id: result.id };
    }
    return { success: true, id: _doInsert() };
  }

  updateDaily(record) {
    const v = HealthDiaryDB.validateDailyRecord(record);
    if (!v.valid) return { success: false, error: v.errors.join('; ') };
    const now = this._db.now();
    const r = record;
    const info = this._db.stmt.dailyUpdate.run({
      id: r.id || r._dbId,
      person_uid: r.person_uid || r.personUid || null,
      person_type: r.person_type || r.personType || 'student',
      visit_date: r.visit_date || r.date || '',
      time_in: r.time_in || r.timeIn || '',
      time_out: r.time_out || r.timeOut || '',
      symptoms: typeof r.symptoms === 'string' ? r.symptoms : JSON.stringify(r.symptoms || []),
      treatment: Array.isArray(r.treatment) ? JSON.stringify(r.treatment) : (r.treatment || ''),
      /* v3+ 증상별 처치 매핑. 빈 객체/없으면 빈 문자열 (옛 record 호환). */
      treatment_by_sym: typeof r.treatment_by_sym === 'string'
        ? r.treatment_by_sym
        : (r.treatmentBySym && Object.keys(r.treatmentBySym).length ? JSON.stringify(r.treatmentBySym) : ''),
      /* v5 신체사정 — {items,details}. 빈 항목이면 빈 문자열(옛 record 호환). */
      physical_assessment: typeof r.physical_assessment === 'string'
        ? r.physical_assessment
        : (r.physicalAssessment && typeof r.physicalAssessment === 'object' && !Array.isArray(r.physicalAssessment) && (
            (Array.isArray(r.physicalAssessment.items) && r.physicalAssessment.items.length) ||
            (r.physicalAssessment.details && typeof r.physicalAssessment.details === 'object' && Object.keys(r.physicalAssessment.details).length)
          ) ? JSON.stringify(r.physicalAssessment) : ''),
      medication: r.medication || '',
      department: r.department || r.dept || '',
      body_temp: r.body_temp || r.bodyTemp || r.temp || '',
      blood_pressure: r.blood_pressure || r.bp || '',
      pulse: r.pulse || '',
      respiration: r.respiration || '',
      spo2: r.spo2 || '',
      bst: r.bst || '',
      result_code: r.result_code || r.resultCode || r.result || '',
      nurse_name: r.nurse_name || r.nurseName || r.nurse || '',
      nurse_id: r.nurse_id != null ? r.nurse_id : null,
      memo: r.memo || '',
      bodymap_json: typeof r.bodymap_json === 'string' ? r.bodymap_json : JSON.stringify(r.bodymapData || r.bodymap_json || []),
      vip_tags: typeof r.vip_tags === 'string' ? r.vip_tags : JSON.stringify(r.vipTags || r.vip_tags || []),
      bed: r.bed != null ? String(r.bed) : '',
      /* 사용자 보고 2026-05-22 — 자유 기입 증상 카테고리 매핑을 extra_json 에 합쳐 저장 (updateDaily). */
      extra_json: (function(){
        let _ej = {};
        try { if(typeof r.extra_json === 'string') _ej = JSON.parse(r.extra_json) || {}; else if(r.extra_json) _ej = r.extra_json; } catch(_){ _ej = {}; }
        if(r.symFreeTextByCat && typeof r.symFreeTextByCat==='object' && !Array.isArray(r.symFreeTextByCat)){
          _ej.sym_free_text_by_cat = r.symFreeTextByCat;
        }
        return JSON.stringify(_ej);
      })(),
      updated_at: now,
    });
    /* 0행 변경 시 경고 — ID 불일치로 UPDATE가 아무 행에도 적용되지 않음을 감지 */
    if (info && info.changes === 0) {
      console.warn('[updateDaily] 0 rows affected! id=', r.id || r._dbId, 'visit_date=', r.visit_date || r.date);
      /* 실제 DB에서 해당 id 존재 여부 확인 */
      try {
        const row = this._db.stmt.dailyGetById.get(r.id || r._dbId);
        console.warn('[updateDaily] DB lookup by id → ', row ? ('FOUND visit_date='+row.visit_date) : 'NOT FOUND');
      } catch(_){}
      return { success: false, changes: 0, error: 'no_rows_updated' };
    }
    return { success: true, changes: info ? info.changes : 1 };
  }

  /**
   * nurse_name이 직위(보건교사 등)로 저장된 기존 레코드를 실제 이름으로 일괄 변경
   */
  fixNurseName(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return { success: true, changed: 0 };
    const stmt = this._db.db.prepare('UPDATE daily_records SET nurse_name = ? WHERE nurse_name = ?');
    const info = stmt.run(newName, oldName);
    return { success: true, changed: info.changes };
  }

  deleteDaily(id) {
    this._db.stmt.dailyDelete.run(id);
    return { success: true };
  }

  deleteDailyByYear(year) {
    this._db.stmt.dailyDeleteByYear.run(year);
    return { success: true };
  }

  /* ──────────── Emergency: 행 변환 ──────────── */

  _toEmergencyRecord(r) {
    let _extra = {};
    try { if (r.extra_json) _extra = JSON.parse(r.extra_json) || {}; } catch (e) {}
    return {
      id: r.id,
      personUid: r.person_uid || '',
      personType: r.person_type || 'student',
      /* 교직원 전용 편집 필드 — extra_json 에 저장 */
      displayGrade: _extra.displayGrade,
      displayNum: _extra.displayNum,
      displayGender: _extra.displayGender,
      photoData: _extra.photoData || '',
      vitalsList: Array.isArray(_extra.vitalsList) ? _extra.vitalsList : null,
      recConsciousness: _extra.recConsciousness || '',
      consciousnessEtc: _extra.consciousnessEtc || '',
      recConsciousnessEtc: _extra.recConsciousnessEtc || '',
      // JOIN 데이터
      personName: r.person_name || '',
      studentGrade: r.student_grade || 0,
      studentClass: r.student_class || 0,
      studentNum: r.student_num2 || 0,
      studentGender: r.student_gender || '',
      isCare: !!r.is_care,
      // 사고 발생 정보
      accidentDate: r.accident_date || '',
      accidentTime: r.accident_time || '',
      location: r.location || '',
      situation: r.situation || '',
      // 환자 상태
      patientStatus: r.patient_status || '',
      consciousness: r.consciousness || '명료',
      // 생체 징후
      vitals: {
        temp: r.vital_temp || '',
        pulse: r.vital_pulse || '',
        bp: r.vital_bp || '',
        resp: r.vital_resp || '',
        spo2: r.vital_spo2 || '',
        bst: r.vital_bst || '',
      },
      // 개요/처치
      summary: r.summary || '',
      treatment: r.treatment || '',
      // 이송
      isTransported: !!r.is_transported,
      transportMethod: r.transport_method || '',
      transportDest: r.transport_dest || '',
      // 작성 정보
      authorDate: r.author_date || '',
      authorName: r.author_name || '',
      // 추가 정보
      guardianContact: r.guardian_contact || '',
      homeroomTeacher: r.homeroom_teacher || '',
      memo: r.memo || '',
      _dbId: r.id,
    };
  }

  /* ──────────── Emergency: 조회 ──────────── */

  getEmergencyByYear(year) {
    return this._db.stmt.emergencyGetByYear.all(this._yr(year)).map(r => this._toEmergencyRecord(r));
  }

  getEmergencyById(id) {
    const r = this._db.stmt.emergencyGetById.get(id);
    return r ? this._toEmergencyRecord(r) : null;
  }

  /* ──────────── Emergency: 저장 ──────────── */

  insertEmergency(record) {
    const now = this._db.now();
    const r = record;
    const info = this._db.stmt.emergencyInsert.run({
      school_year: r.school_year || this._yr(),
      person_uid: r.person_uid || r.personUid || null,
      person_type: r.person_type || r.personType || 'student',
      accident_date: r.accident_date || r.accidentDate || '',
      accident_time: r.accident_time || r.accidentTime || '',
      location: r.location || '',
      situation: r.situation || '',
      patient_status: r.patient_status || r.patientStatus || '',
      consciousness: r.consciousness || '명료',
      vital_temp: r.vital_temp || (r.vitals && r.vitals.temp) || '',
      vital_pulse: r.vital_pulse || (r.vitals && r.vitals.pulse) || '',
      vital_bp: r.vital_bp || (r.vitals && r.vitals.bp) || '',
      vital_resp: r.vital_resp || (r.vitals && r.vitals.resp) || '',
      vital_spo2: r.vital_spo2 || (r.vitals && r.vitals.spo2) || '',
      vital_bst: r.vital_bst || (r.vitals && r.vitals.bst) || '',
      summary: r.summary || '',
      treatment: r.treatment || '',
      is_transported: r.is_transported || r.isTransported ? 1 : 0,
      transport_method: r.transport_method || r.transportMethod || '',
      transport_dest: r.transport_dest || r.transportDest || '',
      author_date: r.author_date || r.authorDate || '',
      author_name: r.author_name || r.authorName || '',
      guardian_contact: r.guardian_contact || r.guardianContact || '',
      homeroom_teacher: r.homeroom_teacher || r.homeroomTeacher || '',
      memo: r.memo || '',
      extra_json: r.extra_json || '{}',
      created_at: now,
      updated_at: now,
    });
    return { success: true, id: Number(info.lastInsertRowid) };
  }

  updateEmergency(record) {
    const now = this._db.now();
    const r = record;
    const info = this._db.stmt.emergencyUpdate.run({
      id: r.id || r._dbId,
      person_uid: r.person_uid || r.personUid || null,
      person_type: r.person_type || r.personType || 'student',
      accident_date: r.accident_date || r.accidentDate || '',
      accident_time: r.accident_time || r.accidentTime || '',
      location: r.location || '',
      situation: r.situation || '',
      patient_status: r.patient_status || r.patientStatus || '',
      consciousness: r.consciousness || '명료',
      vital_temp: r.vital_temp || (r.vitals && r.vitals.temp) || '',
      vital_pulse: r.vital_pulse || (r.vitals && r.vitals.pulse) || '',
      vital_bp: r.vital_bp || (r.vitals && r.vitals.bp) || '',
      vital_resp: r.vital_resp || (r.vitals && r.vitals.resp) || '',
      vital_spo2: r.vital_spo2 || (r.vitals && r.vitals.spo2) || '',
      vital_bst: r.vital_bst || (r.vitals && r.vitals.bst) || '',
      summary: r.summary || '',
      treatment: r.treatment || '',
      is_transported: r.is_transported || r.isTransported ? 1 : 0,
      transport_method: r.transport_method || r.transportMethod || '',
      transport_dest: r.transport_dest || r.transportDest || '',
      author_date: r.author_date || r.authorDate || '',
      author_name: r.author_name || r.authorName || '',
      guardian_contact: r.guardian_contact || r.guardianContact || '',
      homeroom_teacher: r.homeroom_teacher || r.homeroomTeacher || '',
      memo: r.memo || '',
      extra_json: r.extra_json || '{}',
      updated_at: now,
    });
    if (!info.changes) return { success: false, changes: 0, error: 'no_rows_updated' };
    return { success: true, changes: info.changes };
  }

  deleteEmergency(id) {
    this._db.stmt.emergencyDelete.run(id);
    return { success: true };
  }

  /* ──────────── Infection: 행 변환 ──────────── */

  _toInfectionRecord(r) {
    let progress = r.progress_json;
    try { if (typeof progress === 'string') progress = JSON.parse(progress); } catch (_) { progress = []; }
    let _extra = {};
    try { if (r.extra_json) _extra = JSON.parse(r.extra_json) || {}; } catch (e) {}

    return {
      id: r.id,
      personUid: r.person_uid || '',
      personType: r.person_type || 'student',
      /* 교직원 전용 편집 필드 */
      displayGrade: _extra.displayGrade,
      displayNum: _extra.displayNum,
      displayGender: _extra.displayGender,
      // JOIN 데이터
      personName: r.person_name || '',
      studentGrade: r.student_grade || 0,
      studentClass: r.student_class || 0,
      studentNum: r.student_num2 || 0,
      studentGender: r.student_gender || '',
      isCare: !!r.is_care,
      // 기본 정보
      diseaseName: r.disease_name || '',
      hospital: r.hospital || '',
      diagDate: r.diag_date || '',
      onsetDate: r.onset_date || '',
      reportDate: r.report_date || '',
      // 관리 현황
      isSuspended: !!r.is_suspended,
      suspendStart: r.suspend_start || '',
      expectedReturn: r.expected_return || '',
      actualReturn: r.actual_return || '',
      // 증상
      mainSymptoms: r.main_symptoms || '',
      hasFever: r.has_fever || '아니오',
      hasCough: r.has_cough || '아니오',
      hasThroat: r.has_throat || '아니오',
      otherSymptoms: r.other_symptoms || '',
      // 감염 경로
      infectionRoute: r.infection_route || '',
      schoolContact: r.school_contact || '아니오',
      classContact: r.class_contact || '아니오',
      situationMemo: r.situation_memo || '',
      // 조치
      parentNotified: r.parent_notified || '아니오',
      notifyTime: r.notify_time || '',
      hospitalVisit: r.hospital_visit || '아니오',
      isIsolated: r.is_isolated || '아니오',
      additionalActions: r.additional_actions || '',
      // 경과 관찰
      progress: progress || [],
      additionalMemo: r.additional_memo || '',
      // 작성 정보
      authorDate: r.author_date || '',
      authorName: r.author_name || '',
      memo: r.memo || '',
      _dbId: r.id,
    };
  }

  /* ──────────── Infection: 조회 ──────────── */

  getInfectionByYear(year) {
    return this._db.stmt.infectionGetByYear.all(this._yr(year)).map(r => this._toInfectionRecord(r));
  }

  getInfectionById(id) {
    const r = this._db.stmt.infectionGetById.get(id);
    return r ? this._toInfectionRecord(r) : null;
  }

  /* ──────────── Infection: 저장 ──────────── */

  insertInfection(record) {
    const now = this._db.now();
    const r = record;
    const info = this._db.stmt.infectionInsert.run({
      school_year: r.school_year || this._yr(),
      person_uid: r.person_uid || r.personUid || null,
      person_type: r.person_type || r.personType || 'student',
      disease_name: r.disease_name || r.diseaseName || '',
      hospital: r.hospital || '',
      diag_date: r.diag_date || r.diagDate || '',
      onset_date: r.onset_date || r.onsetDate || '',
      report_date: r.report_date || r.reportDate || '',
      is_suspended: r.is_suspended || r.isSuspended ? 1 : 0,
      suspend_start: r.suspend_start || r.suspendStart || '',
      expected_return: r.expected_return || r.expectedReturn || '',
      actual_return: r.actual_return || r.actualReturn || '',
      main_symptoms: r.main_symptoms || r.mainSymptoms || '',
      has_fever: r.has_fever || r.hasFever || '아니오',
      has_cough: r.has_cough || r.hasCough || '아니오',
      has_throat: r.has_throat || r.hasThroat || '아니오',
      other_symptoms: r.other_symptoms || r.otherSymptoms || '',
      infection_route: r.infection_route || r.infectionRoute || '',
      school_contact: r.school_contact || r.schoolContact || '아니오',
      class_contact: r.class_contact || r.classContact || '아니오',
      situation_memo: r.situation_memo || r.situationMemo || '',
      parent_notified: r.parent_notified || r.parentNotified || '아니오',
      notify_time: r.notify_time || r.notifyTime || '',
      hospital_visit: r.hospital_visit || r.hospitalVisit || '아니오',
      is_isolated: r.is_isolated || r.isIsolated || '아니오',
      additional_actions: r.additional_actions || r.additionalActions || '',
      progress_json: typeof r.progress_json === 'string' ? r.progress_json : JSON.stringify(r.progress || []),
      additional_memo: r.additional_memo || r.additionalMemo || '',
      author_date: r.author_date || r.authorDate || '',
      author_name: r.author_name || r.authorName || '',
      memo: r.memo || '',
      extra_json: r.extra_json || '{}',
      created_at: now,
      updated_at: now,
    });
    return { success: true, id: Number(info.lastInsertRowid) };
  }

  updateInfection(record) {
    const now = this._db.now();
    const r = record;
    const info = this._db.stmt.infectionUpdate.run({
      id: r.id || r._dbId,
      person_uid: r.person_uid || r.personUid || null,
      person_type: r.person_type || r.personType || 'student',
      disease_name: r.disease_name || r.diseaseName || '',
      hospital: r.hospital || '',
      diag_date: r.diag_date || r.diagDate || '',
      onset_date: r.onset_date || r.onsetDate || '',
      report_date: r.report_date || r.reportDate || '',
      is_suspended: r.is_suspended || r.isSuspended ? 1 : 0,
      suspend_start: r.suspend_start || r.suspendStart || '',
      expected_return: r.expected_return || r.expectedReturn || '',
      actual_return: r.actual_return || r.actualReturn || '',
      main_symptoms: r.main_symptoms || r.mainSymptoms || '',
      has_fever: r.has_fever || r.hasFever || '아니오',
      has_cough: r.has_cough || r.hasCough || '아니오',
      has_throat: r.has_throat || r.hasThroat || '아니오',
      other_symptoms: r.other_symptoms || r.otherSymptoms || '',
      infection_route: r.infection_route || r.infectionRoute || '',
      school_contact: r.school_contact || r.schoolContact || '아니오',
      class_contact: r.class_contact || r.classContact || '아니오',
      situation_memo: r.situation_memo || r.situationMemo || '',
      parent_notified: r.parent_notified || r.parentNotified || '아니오',
      notify_time: r.notify_time || r.notifyTime || '',
      hospital_visit: r.hospital_visit || r.hospitalVisit || '아니오',
      is_isolated: r.is_isolated || r.isIsolated || '아니오',
      additional_actions: r.additional_actions || r.additionalActions || '',
      progress_json: typeof r.progress_json === 'string' ? r.progress_json : JSON.stringify(r.progress || []),
      additional_memo: r.additional_memo || r.additionalMemo || '',
      author_date: r.author_date || r.authorDate || '',
      author_name: r.author_name || r.authorName || '',
      memo: r.memo || '',
      extra_json: r.extra_json || '{}',
      updated_at: now,
    });
    if (!info.changes) return { success: false, changes: 0, error: 'no_rows_updated' };
    return { success: true, changes: info.changes };
  }

  deleteInfection(id) {
    this._db.stmt.infectionDelete.run(id);
    return { success: true };
  }

  /* ──────────── 보존기간 기반 일괄 삭제 ──────────── */

  countBeforeDate(cutoffDate) {
    return {
      daily: this._db.stmt.dailyCountBeforeDate.get(cutoffDate).cnt,
      emergency: this._db.stmt.emergencyCountBeforeDate.get(cutoffDate).cnt,
      infection: this._db.stmt.infectionCountBeforeDate.get(cutoffDate).cnt,
    };
  }

  deleteBeforeDate(cutoffDate) {
    if (!cutoffDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
      throw new Error('유효하지 않은 날짜 형식: ' + cutoffDate);
    }
    const counts = this.countBeforeDate(cutoffDate);
    const tx = this._db.db.transaction(() => {
      this._db.stmt.dailyDeleteBeforeDate.run(cutoffDate);
      this._db.stmt.emergencyDeleteBeforeDate.run(cutoffDate);
      this._db.stmt.infectionDeleteBeforeDate.run(cutoffDate);
    });
    tx();
    return { success: true, deleted: counts };
  }

  countByYear(year) {
    const yr = String(year);
    return {
      daily: this._db.stmt.dailyCountForYear.get(yr).cnt,
      emergency: this._db.stmt.emergencyCountByYear.get(yr).cnt,
      infection: this._db.stmt.infectionCountByYear.get(yr).cnt,
    };
  }

  deleteByYear(year) {
    const yr = String(year);
    if (!/^\d{4}$/.test(yr)) throw new Error('유효하지 않은 연도: ' + yr);
    const counts = this.countByYear(yr);
    const tx = this._db.db.transaction(() => {
      this._db.stmt.dailyDeleteByYear.run(yr);
      this._db.stmt.emergencyDeleteByYear.run(yr);
      this._db.stmt.infectionDeleteByYear.run(yr);
    });
    tx();
    return { success: true, deleted: counts };
  }
}

module.exports = { HealthRecordDBService };
