/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * import-service.js — 데이터 가져오기 통합 서비스
 *
 * TbTestService — 잠복결핵 검사 영구 누적
 * PastHistoryService — 과거 보건기록 XLSX→SQLite 변환 및 검색
 */

/* 반(학급) 값 정규화 — 순수 숫자는 정수로, 한글/혼합 텍스트(가람·나래·다솜)는 trim 문자열 그대로 보존.
 *  사용자 요청 2026-05-28: 일부 초등학교가 한글 학급명을 쓰므로, parseInt(replace(/[^0-9]/)) 로 0 이 되어
 *  데이터가 손실되던 것을 막는다. 빈 값은 '' 반환. */
function _normClassValue(raw){
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/\s*반$/, '');   /* 끝의 '반' 접미사 제거 — "나래반"→"나래" (표시 시 '반' 자동 부착, 중복 방지). 사용자 요청 2026-05-28. */
  if (s === '') return '';
  return /^\d+$/.test(s) ? parseInt(s, 10) : s;
}
/* 반 값이 "있음"인지 — 숫자(>0 포함 모든 숫자)·한글 문자열은 true, 빈 값('')만 false.
 *  기존 매칭 로직의 `recCls > 0` 가정이 한글 반에서 깨지므로 존재 판정을 분리 (사용자 요청 2026-05-28). */
function _clsPresent(v){ return v !== '' && v != null; }

/* ══════════ 공통 날짜 정규화 유틸리티 ══════════ */

/**
 * 다양한 한국식 날짜 입력을 YYYY.MM.DD로 정규화합니다.
 *
 * 지원 형식:
 *   구분자: 2023.4.1  2023/10/2/  2023-04-01  2023 4 1  2023,4,1
 *   한국어: 2020년1월2일  2020년 1월 2일  23년7월2일
 *   압축:   20230601  230702  202371  23071
 *   엑셀:   45000 (시리얼 넘버)  2023-04-01T00:00:00 (ISO)
 *   기타:   (2023.04.01)  2023.04.01(토)  전각숫자
 *   월일만: 4.1  4/1 → 현재 연도 적용
 *   연도만: 2023 → YYYY (월일 없이 반환)
 */
function _normalizeDate(raw) {
  if (!raw && raw !== 0) return '';
  var s = String(raw).trim();
  if (!s) return '';

  /* ① Excel 시리얼 넘버 (순수 4~5자리 숫자, 25569~73050 범위) */
  if (/^\d{4,5}$/.test(s)) {
    var serial = parseInt(s, 10);
    if (serial >= 25569 && serial <= 73050) {
      var epoch = new Date((serial - 25569) * 86400000);
      if (!isNaN(epoch.getTime())) {
        return epoch.getFullYear() + '-' + String(epoch.getMonth() + 1).padStart(2, '0') + '-' + String(epoch.getDate()).padStart(2, '0');
      }
    }
  }

  /* ② ISO / 타임스탬프: 2023-04-01T00:00:00 또는 2023-04-01 14:30 */
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    s = s.slice(0, 10); /* YYYY-MM-DD 부분만 */
  }

  /* ③ 전각 → 반각 변환 */
  s = s.replace(/[\uFF10-\uFF19]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  s = s.replace(/[\uFF0E]/g, '.').replace(/[\uFF0F]/g, '/').replace(/[\uFF0D]/g, '-');

  /* ④ 괄호/브라켓/요일 제거 */
  s = s.replace(/[\(\)\[\]]/g, '');
  s = s.replace(/[월화수목금토일]요일?/g, '').trim();

  /* ⑤ 한국어 연/월/일 → 구분자 */
  s = s.replace(/\s*년\s*/g, '.').replace(/\s*월\s*/g, '.').replace(/\s*일\s*/g, '');

  /* ⑥ 모든 구분자를 점으로 통일 (/, -, 콤마, 공백) */
  s = s.replace(/[\/\-,\s]+/g, '.');

  /* ⑦ 연속 점, 끝자리 점 제거 */
  s = s.replace(/\.{2,}/g, '.').replace(/\.+$/, '').replace(/^\.+/, '').trim();

  if (!s) return '';

  var y, m, d;
  var parts = s.split('.').filter(function(p) { return p !== ''; });

  if (parts.length >= 3) {
    /* 구분자 있는 형식: Y.M.D */
    y = parts[0]; m = parts[1]; d = parts[2];
  } else if (parts.length === 2) {
    /* 월.일만 (연도 생략) → 현재 연도 적용 */
    var mi2 = parseInt(parts[0], 10), di2 = parseInt(parts[1], 10);
    if (mi2 >= 1 && mi2 <= 12 && di2 >= 1 && di2 <= 31) {
      y = String(new Date().getFullYear()); m = parts[0]; d = parts[1];
    } else {
      return s;
    }
  } else if (parts.length === 1) {
    /* 구분자 없는 숫자열 */
    var n = parts[0];
    if (n.length === 8) {        /* 20230601 */
      y = n.slice(0, 4); m = n.slice(4, 6); d = n.slice(6, 8);
    } else if (n.length === 6) { /* 230702 */
      y = n.slice(0, 2); m = n.slice(2, 4); d = n.slice(4, 6);
    } else if (n.length === 7) { /* 2023071 → YYYY + 3자리 */
      y = n.slice(0, 4);
      var r7 = n.slice(4);
      var r7m2 = parseInt(r7.slice(0, 2), 10);
      if (r7m2 >= 1 && r7m2 <= 12) { m = r7.slice(0, 2); d = r7.slice(2); }
      else { m = r7.slice(0, 1); d = r7.slice(1); }
    } else if (n.length === 5) { /* 23071 → YY + 3자리 */
      y = n.slice(0, 2);
      var r5 = n.slice(2);
      var r5m2 = parseInt(r5.slice(0, 2), 10);
      if (r5m2 >= 1 && r5m2 <= 12 && r5.length > 2) { m = r5.slice(0, 2); d = r5.slice(2); }
      else { m = r5.slice(0, 1); d = r5.slice(1); }
    } else if (n.length === 4) {
      /* 4자리: 연도만(2023) 또는 MMDD(0401) */
      var yi4 = parseInt(n, 10);
      if (yi4 >= 1900 && yi4 <= 2100) return n; /* 연도만 */
      m = n.slice(0, 2); d = n.slice(2, 4);
      y = String(new Date().getFullYear());
    } else {
      return s;
    }
  } else {
    return s;
  }

  /* 2자리 연도 → 4자리 변환 */
  var yi = parseInt(y, 10);
  if (String(y).length <= 2) {
    yi = yi >= 0 && yi <= 49 ? 2000 + yi : 1900 + yi;
  }
  var mi = parseInt(m, 10);
  var di = parseInt(d, 10);

  /* 범위 검증 */
  if (isNaN(yi) || isNaN(mi) || isNaN(di)) return s;
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return s;
  if (yi < 1900 || yi > 2100) return s;

  /* YYYY-MM-DD (대시) 로 통일 — 프로젝트 전역 convention */
  return yi + '-' + String(mi).padStart(2, '0') + '-' + String(di).padStart(2, '0');
}

/**
 * 날짜+시간 문자열을 { date: 'YYYY.MM.DD', time: 'HH:MM' } 으로 정규화합니다.
 *
 * 지원 형식:
 *   20260305 11:03          → { date: '2026.03.05', time: '11:03' }
 *   2026.7.11. 11:27        → { date: '2026.07.11', time: '11:27' }
 *   2025-7-1 11:24          → { date: '2025.07.01', time: '11:24' }
 *   2026년6월1일 11시10분   → { date: '2026.06.01', time: '11:10' }
 *   2026년 2월 3일 15시10분 → { date: '2026.02.03', time: '15:10' }
 *   11:03                   → { date: '', time: '11:03' }
 *   오후 3:42               → { date: '', time: '15:42' }
 *   오전 11:30              → { date: '', time: '11:30' }
 */
/** Levenshtein 편집 거리 — 한글 음절 단위 문자열 거리.
 *  과거 보건기록 업로드 시 이름 오탈자(예: "양동하" 입력 → 명단은 "양동하"
 *  vs "앙동하") 를 자동으로 같은 학년·반의 학생에게 매핑하기 위한 유사도 측정.
 *  거리 1 = 1글자 교체/삽입/삭제. 두 글자 이상 다르면 후보 제외. */
function _levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) dp[j] = prev;
      else dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
      prev = tmp;
    }
  }
  return dp[bl];
}

function _normalizeDatetime(raw) {
  if (!raw && raw !== 0) return { date: '', time: '' };
  var s = String(raw).trim();
  if (!s) return { date: '', time: '' };

  /* ⓪ Excel 시간 분수: 0 <= n < 1 의 순수 소수 ("0.4576...") → 시:분 변환.
   * 엑셀에서 시간 셀은 표시상 "10:59" 이지만 내부적으로 하루의 분수(0.4576...)로 저장되며,
   * XLSX 라이브러리가 기본값으로 분수를 반환한다. 0.5 = 12:00 noon. */
  if (/^0?\.\d+$/.test(s)) {
    var nFrac = parseFloat(s);
    if (!isNaN(nFrac) && nFrac >= 0 && nFrac < 1) {
      var totalMin = Math.round(nFrac * 1440); /* 24 * 60 */
      var fh = Math.floor(totalMin / 60) % 24;
      var fm = totalMin % 60;
      return { date: '', time: String(fh).padStart(2, '0') + ':' + String(fm).padStart(2, '0') };
    }
  }

  /* ⓪-2 Excel 날짜+시간 합성 시리얼 (정수 + 분수, 예: 45234.4576...) → 날짜 YYYY-MM-DD + 시간 HH:MM */
  if (/^\d{4,5}\.\d+$/.test(s)) {
    var nDT = parseFloat(s);
    var intPart = Math.floor(nDT);
    var fracPart = nDT - intPart;
    if (intPart >= 25569 && intPart <= 73050) {
      var epochDT = new Date((intPart - 25569) * 86400000);
      if (!isNaN(epochDT.getTime())) {
        var dStr = epochDT.getFullYear() + '-' + String(epochDT.getMonth() + 1).padStart(2, '0') + '-' + String(epochDT.getDate()).padStart(2, '0');
        var dtMin = Math.round(fracPart * 1440);
        var dh = Math.floor(dtMin / 60) % 24;
        var dm = dtMin % 60;
        return { date: dStr, time: String(dh).padStart(2, '0') + ':' + String(dm).padStart(2, '0') };
      }
    }
  }

  var datePart = '';
  var timePart = '';

  /* ① 한국어 시분 형식: 11시10분, 15시10분 */
  var korTimeMatch = s.match(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/);
  if (korTimeMatch) {
    var kh = parseInt(korTimeMatch[1], 10);
    var km = parseInt(korTimeMatch[2], 10);
    timePart = String(kh).padStart(2, '0') + ':' + String(km).padStart(2, '0');
    datePart = s.slice(0, korTimeMatch.index).trim();
  } else {
    /* ② 오전/오후 + HH:MM */
    var ampmMatch = s.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
    if (ampmMatch) {
      var ah = parseInt(ampmMatch[2], 10);
      var am = parseInt(ampmMatch[3], 10);
      if (ampmMatch[1] === '오후' && ah < 12) ah += 12;
      if (ampmMatch[1] === '오전' && ah === 12) ah = 0;
      timePart = String(ah).padStart(2, '0') + ':' + String(am).padStart(2, '0');
      datePart = s.slice(0, ampmMatch.index).trim();
    } else {
      /* ③ HH:MM 패턴 (마지막 매치를 사용하여 날짜 내 콜론과 충돌 방지) */
      var colonMatch = s.match(/(\d{1,2}):(\d{2})(?!.*\d{1,2}:\d{2})/);
      if (colonMatch) {
        var ch = parseInt(colonMatch[1], 10);
        var cm = parseInt(colonMatch[2], 10);
        if (ch >= 0 && ch <= 23 && cm >= 0 && cm <= 59) {
          timePart = String(ch).padStart(2, '0') + ':' + String(cm).padStart(2, '0');
          datePart = s.slice(0, colonMatch.index).trim();
        }
      }
    }
  }

  /* 시간 패턴이 없으면 입력 전체를 날짜로 간주 (날짜만 있는 케이스: 2026.3.3, 2026-03-03 등) */
  if (!datePart && !timePart) {
    datePart = s;
  }
  /* 시간만 있고 날짜 부분이 없으면 시간만 반환 */
  if (!datePart) {
    return { date: '', time: timePart };
  }

  /* 날짜 부분을 _normalizeDate로 정규화 */
  var normalizedDate = _normalizeDate(datePart);

  return { date: normalizedDate, time: timePart };
}

/* ══════════ TbTestService ══════════ */

/**
 * TbTestService — 잠복결핵 검사 영구 누적
 *
 * 메인 DB(HealthDiaryDB)의 tb_tests 테이블에 저장됩니다.
 * 삭제되지 않고 10년, 20년 이상 영구 누적됩니다.
 * 5년 경과 데이터 삭제 대상에서 제외됩니다.
 */
class TbTestService {
  constructor(healthDB) {
    this._healthDB = healthDB;
  }

  _open() {
    return this._healthDB.db;
  }

  _ensureSchema() {
    /* 메인 DB의 CREATE TABLE에서 이미 생성됨 — 별도 호출 불필요 */
  }

  /** 개별 등록 — 같은 이름+검사일 있으면 UPDATE, 없으면 INSERT */
  addOne(data) {
    const db = this._open();
    const now = new Date();
    const uploadedAt = now.getFullYear()+'.'+String(now.getMonth()+1).padStart(2,'0')+'.'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const inst = data.institution || data.inst || data.memo || '';
    const memo = data.memo_text || data.memo || '';
    const norm = {
      test_year: data.test_year || String(new Date().getFullYear()),
      name: data.name || '',
      position: data.position || '',
      birth_date: _normalizeDate(data.birth_date || ''),
      gender: data.gender || '',
      test_date: _normalizeDate(data.test_date || ''),
      test_type: data.test_type || '',
      institution: inst,
      memo: memo,
      uploaded_at: uploadedAt
    };
    /* 기존 레코드 검사 (이름+검사일) */
    const existing = db.prepare('SELECT id FROM tb_tests WHERE name=? AND test_date=? LIMIT 1').get(norm.name, norm.test_date);
    if (existing) {
      db.prepare(`UPDATE tb_tests SET position=@position, birth_date=@birth_date, gender=@gender, test_type=@test_type, institution=@institution, memo=@memo, uploaded_at=@uploaded_at WHERE id=@id`).run({...norm, id: existing.id});
      return { id: existing.id, updated: true };
    }
    const stmt = db.prepare(`
      INSERT INTO tb_tests (test_year, name, position, birth_date, gender, test_date, test_type, institution, memo, uploaded_at)
      VALUES (@test_year, @name, @position, @birth_date, @gender, @test_date, @test_type, @institution, @memo, @uploaded_at)
    `);
    const info = stmt.run(norm);
    return { id: info.lastInsertRowid, inserted: true };
  }

  /** 일괄 등록 (XLSX 파싱 후) — UPSERT */
  addBulk(rows) {
    const db = this._open();
    const now = new Date();
    const uploadedAt = now.getFullYear()+'.'+String(now.getMonth()+1).padStart(2,'0')+'.'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const findStmt = db.prepare('SELECT id FROM tb_tests WHERE name=? AND test_date=? LIMIT 1');
    const updStmt = db.prepare('UPDATE tb_tests SET position=@position, birth_date=@birth_date, gender=@gender, test_type=@test_type, institution=@institution, memo=@memo, uploaded_at=@uploaded_at WHERE id=@id');
    const insStmt = db.prepare(`
      INSERT INTO tb_tests (test_year, name, position, birth_date, gender, test_date, test_type, institution, memo, uploaded_at)
      VALUES (@test_year, @name, @position, @birth_date, @gender, @test_date, @test_type, @institution, @memo, @uploaded_at)
    `);
    let updated = 0, inserted = 0;
    const upsertMany = db.transaction((data) => {
      for (const r of data) {
        const existing = findStmt.get(r.name, r.test_date);
        if (existing) { updStmt.run({...r, id: existing.id}); updated++; }
        else { insStmt.run(r); inserted++; }
      }
    });
    const mapped = rows.map(r => ({
      test_year: r.test_year || r['검사년도'] || String(new Date().getFullYear()),
      name: r.name || r['이름'] || '',
      position: r.position || r['직위'] || '',
      birth_date: _normalizeDate(r.birth_date || r['생년월일'] || ''),
      gender: r.gender || r['성별'] || '',
      test_date: _normalizeDate(r.test_date || r['검사일'] || ''),
      test_type: r.test_type || r['검사종류'] || '',
      institution: r.institution || r['검진기관명 (선택)'] || r['검진기관명'] || r['기관'] || '',
      memo: r.memo || r['메모'] || r['주의사항'] || '',
      uploaded_at: uploadedAt
    })).filter(r => r.name);
    upsertMany(mapped);
    return { count: mapped.length, inserted, updated };
  }

  /** XLSX 파일에서 일괄 등록 */
  importFromXlsx(filePath) {
    let XLSX;
    try { XLSX = require('xlsx'); } catch (_) {
      throw new Error('XLSX 라이브러리를 찾을 수 없습니다.');
    }
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return this.addBulk(rows);
  }

  /** 검색 */
  search(params) {
    const db = this._open();
    let sql = 'SELECT * FROM tb_tests WHERE 1=1';
    const binds = {};
    if (params.name) { sql += ' AND name LIKE @name'; binds.name = '%' + params.name + '%'; }
    if (params.year) { sql += ' AND test_year = @year'; binds.year = params.year; }
    sql += ' ORDER BY test_year DESC, registered_at DESC LIMIT 500';
    return db.prepare(sql).all(binds);
  }

  /** 전체 목록 */
  getAll() {
    const db = this._open();
    return db.prepare('SELECT * FROM tb_tests ORDER BY test_year DESC, name ASC').all();
  }

  /** 통계 */
  getStats() {
    const db = this._open();
    const total = db.prepare('SELECT COUNT(*) as cnt FROM tb_tests').get();
    const years = db.prepare('SELECT DISTINCT test_year FROM tb_tests ORDER BY test_year DESC').all();
    return { totalCount: total.cnt, years: years.map(y => y.test_year) };
  }

  /** 삭제 (개별) */
  deleteOne(id) {
    const db = this._open();
    db.prepare('DELETE FROM tb_tests WHERE id = ?').run(id);
  }

  /** 수정 (개별) — id 기준 제자리 수정 (이름·직위·검사일·검진기관). DB 에 그대로 반영. */
  updateOne(id, data) {
    const db = this._open();
    const test_date = _normalizeDate((data && data.test_date) || '');
    const test_year = (String(test_date).match(/\d{4}/) || [String(new Date().getFullYear())])[0];
    db.prepare('UPDATE tb_tests SET name=@name, position=@position, test_date=@test_date, test_year=@test_year, institution=@institution WHERE id=@id').run({
      id: id,
      name: ((data && data.name) || '').trim(),
      position: (data && data.position) || '',
      test_date: test_date,
      test_year: test_year,
      institution: (data && data.institution) || ''
    });
    return { id: id, updated: true };
  }

  close() {
    /* 메인 DB를 사용하므로 별도 close 불필요 */
  }
}

// Export date utilities for reuse by other services
TbTestService._normalizeDate = _normalizeDate;
TbTestService._normalizeDatetime = _normalizeDatetime;

/* ══════════ PastHistoryService ══════════ */

/**
 * PastHistoryService — 과거 보건기록 XLSX→SQLite 변환 및 검색
 *
 * 메인 정규화 DB(HealthDiaryDB)의 import_staging 테이블을 사용합니다.
 * 이전 보건일지 프로그램에서 이관한 데이터를 검색할 수 있습니다.
 */
class PastHistoryService {
  constructor(healthDB) {
    this._healthDB = healthDB;
  }

  /** 스테이징 데이터 존재 여부 */
  exists() {
    try {
      const row = this._healthDB.db.prepare('SELECT COUNT(*) as cnt FROM import_staging').get();
      return row && row.cnt > 0;
    } catch (_) { return false; }
  }

  /** XLSX 파일에서 가져오기 */
  importFromXlsx(filePath) {
    let XLSX;
    try { XLSX = require('xlsx'); } catch (_) {
      throw new Error('XLSX 라이브러리를 찾을 수 없습니다.');
    }

    const wb = XLSX.readFile(filePath);
    /* 🔍 데이터 시트 자동 탐지: "보건일지" 이름 우선, 없으면 헤더에 "방문일/날짜/일자"가 있는 첫 시트.
     * 양식 파일의 1번째 시트가 "설명"(안내 문구)이어서 데이터가 비어 보이는 문제 방지. */
    let sheetName = wb.SheetNames.find(n => /보건일지|daily|record/i.test(n));
    if (!sheetName) {
      sheetName = wb.SheetNames.find(n => {
        const s = wb.Sheets[n];
        if (!s) return false;
        const raw = XLSX.utils.sheet_to_json(s, { header: 1, defval: '' });
        const first = raw[0] || [];
        return first.some(h => /방문일|날짜|일자|date/i.test(String(h || '').trim()));
      });
    }
    if (!sheetName) sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    console.log('[import] 사용 시트:', sheetName, '| 행 수:', rows.length);

    if (!rows.length) throw new Error('데이터가 없습니다. (시트: ' + sheetName + ')');

    const db = this._healthDB.db;
    /* 이전 import 데이터 초기화 — 중복 누적 방지 */
    db.prepare('DELETE FROM import_staging').run();

    /* 헤더 매핑 (한글 → 컬럼) — 괄호 제거 후 매칭 */
    const colMap = {
      '방문일': 'visit_date', '날짜': 'visit_date', '일자': 'visit_date',
      '입실시간': 'time_in', '입실': 'time_in',
      '퇴실시간': 'time_out', '퇴실': 'time_out',
      '학년': 'grade',
      '반': 'class_num', '학급': 'class_num',
      '번호': 'student_num',
      '이름': 'student_name', '성명': 'student_name', '학생명': 'student_name',
      '성별': 'gender',
      '증상': 'symptoms',
      '나의 처치': 'treatment', '처치': 'treatment', '처치내용': 'treatment',
      '투약': 'medication', '투약내용': 'medication',
      '처치자': 'nurse_name', '담당자': 'nurse_name',
      '학교급': 'level', '구분': 'level',
      '학과': 'department', '과': 'department', '전공': 'department', '진료과': 'department',
      '만 나이': 'grade', '나이': 'grade',
      '결과': 'result_code',
      '비고': 'memo', '메모': 'memo',
    };

    const insert = db.prepare(`
      INSERT INTO import_staging (visit_date, grade, class_num, student_num, student_name, gender, symptoms, treatment, medication, department, result_code, memo, time_in, time_out, nurse_name, level)
      VALUES (@visit_date, @grade, @class_num, @student_num, @student_name, @gender, @symptoms, @treatment, @medication, @department, @result_code, @memo, @time_in, @time_out, @nurse_name, @level)
    `);

    const insertMany = db.transaction((data) => {
      for (const row of data) insert.run(row);
    });

    /* 헤더 자동 인식: 정규식으로 유사 헤더 매칭
     * visit_date 패턴은 보건일지 변형 헤더(내원/내방/내원일자 등)도 폭넓게 잡도록 확장 */
    const headerPatterns = {
      visit_date: /방문|내원|내방|진료일|발생일|등교일|날짜|일자|년월일|date/i,
      grade: /학년|나이|grade|age/i,
      class_num: /^반$|학급|class/i,
      student_num: /번호|num/i,
      student_name: /이름|성명|학생명|name/i,
      gender: /성별|gender|sex/i,
      symptoms: /증상|symptom/i,
      treatment: /처치|나의.*처치|treatment/i,
      medication: /투약|약물|medication|drug/i,
      department: /진료과|department/i,
      result_code: /결과|result/i,
      memo: /비고|메모|주의|memo|note/i,
      time_in: /입실|시작|time.*in/i,
      time_out: /퇴실|종료|time.*out/i,
      nurse_name: /처치자|담당|nurse/i,
      level: /^학교급$|^구분$/i,
    };

    /* ─── 우리 양식 표준 컬럼 순서 (templates/forms/past_health_records.xlsx 의 "보건일지" 시트) ───
     * 베타 테스터가 양식 헤더를 예시 문구("소독, 바스포연고 도포, 밴드 부착")로 덮어써도
     * 표준 순서로 인식되도록 위치 기반 폴백 제공.
     * 9열 양식: A 방문일 / B 입실시간 / C 학년 / D 반 / E 번호 / F 이름 / G 증상 / H 처치 / I 처치자 */
    const STD_POS = ['visit_date','time_in','grade','class_num','student_num','student_name','symptoms','treatment','nurse_name'];

    /* 헤더 → 컬럼 결정. row 안의 키들이 어느 컬럼인지 1회만 계산 (rows 전체에 재사용) */
    const headerKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
    const headerToCol = {}; /* { rawHeader: 'treatment', ... } */
    let stdMatched = 0;
    headerKeys.forEach((k, idx) => {
      const cleanKey = k.trim().replace(/\s*\(.*?\)\s*/g, '').trim();
      let col = colMap[k.trim()] || colMap[cleanKey];
      if (!col) {
        for (const [field, regex] of Object.entries(headerPatterns)) {
          if (regex.test(k.trim())) { col = field; break; }
        }
      }
      if (col) {
        headerToCol[k] = col;
        if (STD_POS[idx] === col) stdMatched++;
      }
    });
    /* 표준 순서에 ≥6개 컬럼이 일치하면 "우리 양식 변형" 으로 간주.
     * 헤더가 매칭 안 된 위치들에 STD_POS 기본값을 강제 할당. */
    if (stdMatched >= 6) {
      headerKeys.forEach((k, idx) => {
        if (!headerToCol[k] && STD_POS[idx]) {
          /* 다만 같은 컬럼이 이미 다른 헤더에 할당돼 있으면 덮어쓰지 않음 */
          const dup = Object.values(headerToCol).indexOf(STD_POS[idx]);
          if (dup === -1) headerToCol[k] = STD_POS[idx];
        }
      });
    }

    const mapped = rows.map((row, idx) => {
      const r = { visit_date: '', grade: '', class_num: '', student_num: '', student_name: '', gender: '', symptoms: '', treatment: '', medication: '', department: '', result_code: '', memo: '', time_in: '', time_out: '', nurse_name: '', level: '', _excelRow: idx + 2 /* 1행=헤더, 데이터는 2행부터 */ };
      Object.keys(row).forEach(k => {
        const col = headerToCol[k];
        if (col) r[col] = String(row[k] || '').trim();
      });
      /* 퇴실/입실 시간 '-' 또는 '–' 등 비어있음 표기 → 빈 값 */
      if (r.time_out && /^[-–—−_\s.]+$/.test(r.time_out)) r.time_out = '';
      if (r.time_in && /^[-–—−_\s.]+$/.test(r.time_in)) r.time_in = '';
      /* 날짜 정규화 */
      if (r.visit_date) {
        const dt = _normalizeDatetime(r.visit_date);
        r.visit_date = dt.date;
        if (!r.time_in && dt.time) r.time_in = dt.time;
      }
      if (r.time_in && !/^\d{1,2}:\d{2}$/.test(r.time_in)) {
        const t = _normalizeDatetime(r.time_in); r.time_in = t.time || r.time_in;
      }
      if (r.time_out && !/^\d{1,2}:\d{2}$/.test(r.time_out)) {
        const t = _normalizeDatetime(r.time_out); r.time_out = t.time || r.time_out;
      }
      /* DB 검증은 ^\d{2}:\d{2}$ 만 통과 — 단일자리 시간 ("9:30") 은 "09:30" 으로 패딩 */
      const _padHHMM = (v) => {
        const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return v;
        return String(parseInt(m[1], 10)).padStart(2, '0') + ':' + m[2];
      };
      if (r.time_in) r.time_in = _padHHMM(r.time_in);
      if (r.time_out) r.time_out = _padHHMM(r.time_out);
      /* 성별 정규화 (남자→남, 여자→여, 녀자→여, 녀→여 등) */
      if (r.gender) {
        const gMap = {'남자':'남','여자':'여','녀자':'여','녀':'여','남성':'남','여성':'여','M':'남','F':'여','m':'남','f':'여','male':'남','female':'여','Male':'남','Female':'여'};
        r.gender = gMap[r.gender.trim()] || r.gender.trim();
      }
      /* 학교급 정규화 (한국어 단축형으로 통일) */
      if (r.level) {
        const lvMap = {'유':'유','초':'초','중':'중','고':'고','전공':'대','대':'대','유치원':'유','초등':'초','중등':'중','고등':'고','elementary':'초','middle':'중','high':'고','kindergarten':'유'};
        r.level = lvMap[r.level.trim()] || r.level.trim();
      }
      return r;
    });

    /* ─── 필수 컬럼 사전 검증 (옵션 1 — 파싱 단계에서 행별 누락 검사) ───
     * 양식 명세: A 방문일 / C 학년 / D 반 / F 이름 / G 증상 / H 처치 가 필수.
     *  - 완전 빈 행(어떤 필드에도 값 없음): 조용히 제외 (엑셀 하단 빈 줄)
     *  - 필수 누락 행: staging 에서 제외하고 invalidRows 에 모아 사용자에게 안내
     *  - 교직원 행 예외: 학년(C) 칸이 텍스트(교원/직원/교장/교감/행정실장 등 직위) 인 경우
     *    반(D)·번호(E) 누락 허용 (교직원 매칭은 이름만 사용). autoMatch 의 isStaffRec 판정과 일치. */
    const REQUIRED_FIELDS = [
      { field: 'visit_date',   label: '방문일' },
      { field: 'grade',        label: '학년' },
      { field: 'class_num',    label: '반' },
      { field: 'student_name', label: '이름' },
      { field: 'symptoms',     label: '증상' },
      { field: 'treatment',    label: '처치' },
    ];
    const validRows = [];
    const invalidRows = [];
    for (const r of mapped) {
      /* 완전 빈 행 — 어떤 컬럼에도 값 없음 → 안내 없이 제외 */
      const hasAny = !!(r.visit_date || r.grade || r.class_num || r.student_num
                     || r.student_name || r.symptoms || r.treatment || r.time_in
                     || r.medication || r.nurse_name || r.gender || r.level
                     || r.department || r.memo);
      if (!hasAny) continue;

      /* 교직원 행 감지: 학년(C) 칸이 숫자가 아닌 텍스트 → 반(D) 누락 허용 */
      const gradeRaw = String(r.grade || '').trim();
      const isStaffRec = gradeRaw !== '' && !/^\d+$/.test(gradeRaw);

      const missing = REQUIRED_FIELDS
        .filter(req => {
          if (isStaffRec && req.field === 'class_num') return false; /* 교직원은 반 누락 허용 */
          return !String(r[req.field] || '').trim();
        })
        .map(req => req.label);
      if (missing.length === 0) {
        validRows.push(r);
      } else {
        invalidRows.push({
          excelRow: r._excelRow,
          missing,
          visit_date: r.visit_date || '',
          grade: r.grade || '',
          class_num: r.class_num || '',
          student_name: r.student_name || '',
          isStaff: isStaffRec,
        });
      }
    }

    /* 임시 필드 제거 후 staging 삽입 (스키마에 _excelRow 없음) */
    validRows.forEach(r => { delete r._excelRow; });
    insertMany(validRows);

    return { recordCount: validRows.length, invalidRows };
  }

  /** 검색 */
  search(params) {
    const db = this._healthDB.db;
    let sql = 'SELECT * FROM import_staging WHERE 1=1';
    const binds = {};

    if (params.name) {
      sql += ' AND student_name LIKE @name';
      binds.name = '%' + params.name + '%';
    }
    if (params.from) {
      sql += ' AND visit_date >= @from';
      binds.from = params.from;
    }
    if (params.to) {
      sql += ' AND visit_date <= @to';
      binds.to = params.to;
    }
    if (params.keyword) {
      sql += ' AND (symptoms LIKE @kw OR treatment LIKE @kw OR medication LIKE @kw OR memo LIKE @kw)';
      binds.kw = '%' + params.keyword + '%';
    }

    sql += ' ORDER BY visit_date DESC LIMIT 200';
    return db.prepare(sql).all(binds);
  }

  /** 통계 */
  getStats() {
    try {
      const db = this._healthDB.db;
      const row = db.prepare('SELECT COUNT(*) as cnt FROM import_staging').get();
      return { recordCount: row.cnt };
    } catch (_) { return { recordCount: 0 }; }
  }

  /**
   * 과거 기록 ↔ 현재 학생 자동 매칭
   *  명단(currentPeople) 에 정확히 일치하는 학생/교직원이 1명이면 자동 matched 처리.
   *  일치 후보 다수 → ambiguous, 0건 → unmatched.
   *  applyToDaily 는 'matched' 만 일반일지에 삽입하므로, 미매칭은 일반일지에 절대 들어가지 않음.
   */
  autoMatch(currentPeople, currentYear, schoolLevel) {
    const db = this._healthDB.db;
    const pending = db.prepare("SELECT * FROM import_staging WHERE match_status = 'pending'").all();
    if (!pending.length) return { matched: 0, graduated: 0, ambiguous: 0, unmatched: 0, ambiguousList: [] };

    const yr = Number(currentYear);
    const isSpecial = schoolLevel === 'special';

    const maxGradeByLevel = {};
    currentPeople.forEach(s => {
      if (s.type !== 'student') return;
      const lv = s.level || '';
      const g = Number(s.grade) || 0;
      if (lv && (!maxGradeByLevel[lv] || g > maxGradeByLevel[lv])) maxGradeByLevel[lv] = g;
    });
    const globalMaxGrade = Math.max(0, ...Object.values(maxGradeByLevel));

    /* ── DB 원본 레코드 필드명 정규화 — DB는 class_num/student_num, 코드는 cls/num을 사용 ──
     * currentPeople 에는 학생과 교직원이 섞여 들어올 수 있으므로 판별:
     *  - students_info 기반 레코드: uid·grade·class_num·student_num 보유 → 학생
     *  - staff 기반 레코드: position·school_year 보유, class_num 없음 → 교직원
     * 없는 경우 name+uid 만으로 staff 로 처리. */
    const _allPeople = (currentPeople || []).map(p => {
      const isStu = Number(p.grade) > 0 || p.class_num !== undefined;
      return Object.assign({}, p, {
        type: isStu ? 'student' : 'staff',
        /* 반 정규화 — 숫자는 정수, 한글(나래반→나래)은 문자열. 외부 recCls 와 동일 기준으로 매칭 (사용자 요청 2026-05-28). */
        cls: _normClassValue(p.cls != null ? p.cls : p.class_num),
        num: Number(p.num || p.student_num || 0) || 0,
        grade: Number(p.grade || 0) || 0,
        /* ★ 렌더러와 통합된 personUid 로 저장되어야 하므로 반드시 문자열 uid 사용 (s0289, t0001 등)
         * students_info.id(숫자)가 아닌 students.uid(문자열)를 기준으로 매칭·저장. */
        id: p.uid || p.id,
        name: p.name || '',
        level: p.level || '',
        department: p.department || '',
        position: p.position || '',
        gender: p.gender || '',
      });
    });

    /* ── 성능: 인덱스 해시맵 구성 — O(N·M) → O(N) ── */
    const studentsByGradeClsNum = new Map();
    const studentsByName = new Map();
    const staffByName = new Map();
    _allPeople.forEach(s => {
      if (s.type === 'staff') {
        const arr = staffByName.get(s.name) || [];
        arr.push(s); staffByName.set(s.name, arr);
        return;
      }
      const g = s.grade, c = s.cls, n = s.num;
      const lv = s.level || '';
      if (g && c && n) {
        const k = lv + '|' + g + '|' + c + '|' + n;
        const arr = studentsByGradeClsNum.get(k) || [];
        arr.push(s); studentsByGradeClsNum.set(k, arr);
      }
      const nm = s.name;
      if (nm) {
        const arr = studentsByName.get(nm) || [];
        arr.push(s); studentsByName.set(nm, arr);
      }
    });
    /* 참조를 정규화된 리스트로 교체 — 이후 filter 로직도 cls/num/type 을 사용 */
    currentPeople = _allPeople;

    const updateMatch = db.prepare('UPDATE import_staging SET matched_person_uid = ?, match_status = ? WHERE id = ?');
    let matched = 0, graduated = 0, ambiguous = 0, unmatched = 0;
    const ambiguousList = [];

    /* 성능: 모든 UPDATE 를 단일 트랜잭션으로 묶음 (수십 배 빠름) */
    const runUpdates = db.transaction(() => {
    for (const rec of pending) {
      const gradeRaw = String(rec.grade || '').trim();
      const recGrade = parseInt(gradeRaw.replace(/[^0-9]/g, ''), 10) || 0;
      /* 외부 방문기록의 반 — 숫자/한글(나래·나래반) 모두 학생 인덱스와 동일 기준으로 정규화 (사용자 요청 2026-05-28). */
      const recCls = _normClassValue(rec.class_num);
      const recNum = parseInt(String(rec.student_num || '').replace(/[^0-9]/g, ''), 10) || 0;
      const recYear = parseInt(rec.visit_date.slice(0, 4), 10) || yr;
      const yearDiff = yr - recYear;
      const expectedGrade = recGrade + yearDiff;
      const recLevel = rec.level || '';
      const recDept = String(rec.department || '').trim();
      const name = (rec.student_name || '').trim();
      const gender = (rec.gender || '').trim();

      /* ── 교직원 레코드 감지 ──
       * 원본 학년 셀이 숫자가 아닌 텍스트(직위)여야 교직원으로 간주.
       * 학년이 아예 비어 있고 반·번호도 비었으면 "이름만 남은 익명화 학생"일 수도 있으므로
       * 교직원으로 단정하지 않고 학생 분기로 보낸다. */
      const isStaffRec = gradeRaw !== '' && !/^\d+$/.test(gradeRaw) && !recCls && !recNum;

      if (isStaffRec) {
        /* 교직원 매칭: 이름만으로 비교 — 동명이인 가능성 높음 → 그때는 수동 해결 */
        const staffMatches = (staffByName.get(name) || []).slice();
        if (staffMatches.length === 1) {
          updateMatch.run(staffMatches[0].id, 'matched', rec.id);
          matched++;
        } else if (staffMatches.length > 1) {
          updateMatch.run(null, 'ambiguous', rec.id);
          ambiguous++;
          if (!ambiguousList.find(a => a.name === name && a.isStaff)) {
            ambiguousList.push({ name, isStaff: true, candidates: staffMatches.map(c => ({ id: c.id, name: c.name, position: c.position || '', type: 'staff' })) });
          }
        } else {
          updateMatch.run(null, 'unmatched', rec.id);
          unmatched++;
        }
        continue;
      }

      /* ── 학생 매칭 ── */

      /* 이름 없음 + 학년·반·번호 중 하나라도 없음 → 매칭 불가 (unmatched) */
      if (!name && (!recGrade || !recCls || !recNum)) {
        updateMatch.run(null, 'unmatched', rec.id);
        unmatched++;
        continue;
      }

      /* 졸업생 판정 제거 — 당해 연도 기록만 가져오므로 불필요 (미매칭이면 그냥 unmatched) */

      let candidates;
      if (!name) {
        /* ── 이름 없음 시나리오 — O(1) 해시맵 조회 ── */
        if (yearDiff === 0 && recGrade > 0 && _clsPresent(recCls) && recNum > 0) {
          /* 1) 학교급 지정된 경우: level|grade|cls|num 키로 직접 조회 (cls 는 정규화값이라 한글 반도 동일 키) */
          let hit = [];
          if (recLevel) {
            hit = studentsByGradeClsNum.get(recLevel + '|' + recGrade + '|' + recCls + '|' + recNum) || [];
          }
          /* 2) 학교급 미지정: 학년+반+번호만으로 조회 (모든 level 중 일치 학생) — 한 번 순회로 모음 */
          if (!hit.length) {
            hit = [];
            studentsByGradeClsNum.forEach((arr, key) => {
              const parts = key.split('|');
              if (Number(parts[1]) === recGrade && String(parts[2]) === String(recCls) && Number(parts[3]) === recNum) {
                arr.forEach(s => hit.push(s));
              }
            });
          }
          /* 성별·학과 제약 필터 */
          candidates = hit.filter(s => {
            if (gender && s.gender && s.gender !== gender) return false;
            if (recDept) {
              const sDept = String(s.department || '').trim();
              if (sDept && sDept !== recDept) return false;
            }
            return true;
          });
        } else {
          candidates = [];
        }
      } else {
        /* 사용자 정책 (2026-05-21): 외부 데이터 매칭 1차 키 = (학년 + 반 + 이름).
         *  외부 데이터는 당해 학년도만 다루므로 진급(yearDiff/expectedGrade) 계산은 적용하지 않음.
         *  학년·반이 정확히 일치하고 이름이 같은 학생만 후보. 학년·반이 비어 있으면 매칭 불가 → unmatched.
         *  성별·학교급·학과는 오탈자 가능성이 있어 매칭 키에서 제외 (사용자 확인). */
        if (recGrade > 0 && _clsPresent(recCls)) {
          const byName = studentsByName.get(name) || [];
          candidates = byName.filter(s => {
            const sGrade = Number(s.grade) || 0;
            /* s.cls 는 인덱스에서 _normClassValue 정규화됨 — 한글 반도 String 비교로 매칭 (사용자 요청 2026-05-28). */
            return sGrade === recGrade && String(s.cls) === String(recCls);
          });
          /* 2차 키: 같은 (학년·반·이름) 후보가 2명 이상이면 번호로 좁힘 (번호가 있을 때만).
           *  번호도 같거나 비어 있어 못 좁히면 candidates 그대로 두어 ambiguous 분기로 보냄. */
          if (candidates.length > 1 && recNum > 0) {
            const byNum = candidates.filter(s => Number(s.num) === recNum);
            if (byNum.length >= 1) candidates = byNum;
          }
        } else {
          /* 학년 또는 반이 없으면 매칭 키 부족 → 미매칭 처리 (사용자가 직접 매칭하거나 전학·자퇴 처리). */
          candidates = [];
        }
      }

      if (candidates.length === 1) {
        updateMatch.run(candidates[0].id, 'matched', rec.id);
        matched++;
      } else if (candidates.length > 1) {
        updateMatch.run(null, 'ambiguous', rec.id);
        ambiguous++;
        if (!ambiguousList.find(a => a.name === name && a.expectedGrade === expectedGrade)) {
          ambiguousList.push({ name, gender, recGrade, recCls, recNum, expectedGrade, candidates: candidates.map(c => ({ id: c.id, grade: c.grade, cls: c.cls, num: c.num, name: c.name })) });
        }
      } else {
        /* 후보 0건 — 명단에 일치 학생이 없으므로 미매칭 처리.
         * (유사 이름 추천 로직은 ambiguous 로 잘못 분류된 사례가 있어 제거.
         *  사용자가 미매칭 모달에서 직접 같은 학년·반을 보고 선택하는 방식으로 통일.) */
        updateMatch.run(null, 'unmatched', rec.id);
        unmatched++;
      }
    }
    });
    runUpdates();

    return { matched, graduated, ambiguous, unmatched, ambiguousList };
  }

  /** 동명이인 수동 매칭 해결 */
  resolveAmbiguous(recordIds, studentId) {
    const db = this._healthDB.db;
    const stmt = db.prepare('UPDATE import_staging SET matched_person_uid = ?, match_status = ? WHERE id = ?');
    let changes = 0;
    const tx = db.transaction(() => {
      for (const id of recordIds) {
        const info = stmt.run(studentId, 'matched', id);
        if (info && typeof info.changes === 'number') changes += info.changes;
      }
    });
    tx();
    return { changes };
  }

  /** 동명이인 미해결 목록 조회 — raw staging 행 반환.
   *  렌더러(_loadAmbiguousStandalone) 가 r.student_name/r.grade 기반으로 직접 그룹화하고
   *  후보 학생 리스트는 S.people 에서 이름 매칭으로 가져온다. */
  getAmbiguous() {
    const db = this._healthDB.db;
    return db.prepare("SELECT * FROM import_staging WHERE match_status = 'ambiguous' ORDER BY student_name, visit_date").all();
  }

  /** 미매칭(자동 매칭 실패) 목록 — 이름별로 그룹화하여 반환.
   *  반환 형식: [{name, gender, grade, class_num, student_num, level, department, records: [{id,visit_date,symptoms,...}]}]
   *  records 는 같은 (이름·성별·학년·반·번호) 조합의 모든 staging 행 */
  getUnmatched() {
    const db = this._healthDB.db;
    const rows = db.prepare("SELECT * FROM import_staging WHERE match_status = 'unmatched' ORDER BY student_name, grade, class_num, student_num, visit_date").all();
    /* (이름·성별·학년·반·번호) 키로 그룹화 */
    const groups = {};
    for (const r of rows) {
      const key = (r.student_name||'') + '|' + (r.gender||'') + '|' + (r.grade||'') + '|' + (r.class_num||'') + '|' + (r.student_num||'') + '|' + (r.level||'');
      if (!groups[key]) {
        groups[key] = {
          name: r.student_name || '',
          gender: r.gender || '',
          grade: r.grade || '',
          class_num: r.class_num || '',
          student_num: r.student_num || '',
          level: r.level || '',
          department: r.department || '',
          records: []
        };
      }
      groups[key].records.push({
        id: r.id,
        visit_date: r.visit_date,
        symptoms: r.symptoms,
        treatments: r.treatments,
        medications: r.medications
      });
    }
    return Object.values(groups);
  }

  /** 미매칭 수동 매칭 해결 — resolveAmbiguous 와 동일 로직 (record_ids 의 staging 행을 특정 학생에 매칭) */
  resolveUnmatched(recordIds, studentId) {
    return this.resolveAmbiguous(recordIds, studentId);
  }

  /**
   * unmatched 기록에서 students/students_info/staff 자동 생성
   * — 이름+성별+학년+반+번호 기준으로 중복 제거 후 DB에 삽입
   */
  autoCreatePeople() {
    const db = this._healthDB.db;
    const unmatched = db.prepare("SELECT * FROM import_staging WHERE match_status = 'unmatched'").all();
    if (!unmatched.length) return { students: 0, staff: 0 };

    const now = this._healthDB.now();
    let stuCreated = 0, staffCreated = 0;

    /* 고유한 인원 추출 (이름+성별+학년+반+번호 기준) */
    const stuMap = {}; /* key → {name,gender,grade,class_num,student_num,...} */
    const staffMap = {};

    for (const rec of unmatched) {
      const name = (rec.student_name || '').trim();
      if (!name) continue;
      const gender = (rec.gender || '').trim();
      const grade = (rec.grade || '').trim();
      const cls = (rec.class_num || '').trim();
      const num = (rec.student_num || '').trim();
      const level = (rec.level || '').trim();
      const dept = (rec.department || '').trim();

      const isStaff = !grade && !cls && !num; /* 학년/반/번호 없으면 교직원 */
      const visitMonth = parseInt((rec.visit_date || '').slice(5, 7), 10) || 3;
      const visitYear = (rec.visit_date || '').slice(0, 4);
      const schoolYear = visitMonth < 3 ? String(Number(visitYear) - 1) : visitYear;

      if (isStaff) {
        const key = name + '|' + gender;
        if (!staffMap[key]) staffMap[key] = { name, gender, position: dept || '', schoolYear };
      } else {
        const key = name + '|' + gender + '|' + grade + '|' + cls + '|' + num + '|' + schoolYear;
        if (!stuMap[key]) stuMap[key] = { name, gender, grade, class_num: cls, student_num: num, level, department: dept, schoolYear };
      }
    }

    const HealthDiaryDB = this._healthDB.constructor;
    const skippedStudents = [];
    const skippedStaff = [];

    /* students + students_info 생성 */
    for (const stu of Object.values(stuMap)) {
      /* 검증 */
      const v = HealthDiaryDB.validateStudent(stu);
      if (!v.valid) { skippedStudents.push({ name: stu.name, error: v.errors.join('; ') }); continue; }

      /* 기존 students 테이블에서 이름+성별로 찾기 */
      let existing = db.prepare('SELECT uid FROM students WHERE name = ? AND gender = ?').get(stu.name, stu.gender);
      let uid;
      if (existing) {
        uid = existing.uid;
      } else {
        uid = HealthDiaryDB.generateStudentUid(db);
        db.prepare('INSERT INTO students (uid, name, gender, birth_date, memo_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(uid, stu.name, stu.gender, '', '{}', now, now);
        stuCreated++;
      }
      /* students_info 중복 체크 후 삽입 */
      const infoExists = db.prepare('SELECT id FROM students_info WHERE uid = ? AND school_year = ?').get(uid, stu.schoolYear);
      if (!infoExists) {
        db.prepare('INSERT INTO students_info (uid, school_year, grade, class_num, student_num, level, department, is_enrolled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
          .run(uid, stu.schoolYear, stu.grade, stu.class_num, stu.student_num, stu.level, stu.department, now, now);
      }
      /* staging 업데이트: unmatched → matched */
      db.prepare("UPDATE import_staging SET matched_person_uid = ?, match_status = 'matched' WHERE match_status = 'unmatched' AND student_name = ? AND gender = ? AND grade = ? AND class_num = ? AND student_num = ?")
        .run(uid, stu.name, stu.gender, stu.grade, stu.class_num, stu.student_num);
    }

    /* staff 생성 */
    for (const stf of Object.values(staffMap)) {
      /* 검증 */
      const v = HealthDiaryDB.validateStaff(stf);
      if (!v.valid) { skippedStaff.push({ name: stf.name, error: v.errors.join('; ') }); continue; }

      let existing = db.prepare('SELECT uid FROM staff WHERE name = ? AND gender = ? AND school_year = ?').get(stf.name, stf.gender, stf.schoolYear);
      let uid;
      if (existing) {
        uid = existing.uid;
      } else {
        uid = HealthDiaryDB.generateStaffUid(db);
        db.prepare('INSERT INTO staff (uid, school_year, position, name, gender, family_relation, family_phone, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
          .run(uid, stf.schoolYear, stf.position, stf.name, stf.gender, '', '', now, now);
        staffCreated++;
      }
      db.prepare("UPDATE import_staging SET matched_person_uid = ?, match_status = 'matched', person_type = 'staff' WHERE match_status = 'unmatched' AND student_name = ? AND gender = ? AND (grade IS NULL OR grade = '')")
        .run(uid, stf.name, stf.gender);
    }

    return { students: stuCreated, staff: staffCreated, skippedStudents, skippedStaff };
  }

  /** 매칭 완료된 기록을 daily_records로 반영 + 스테이징에서 삭제.
   *
   *  2026-05-18: unmatched 도 placeholder 로 함께 삽입.
   *  - person_uid = NULL, is_imported = 1
   *  - extra_json.unmatched_identity 에 엑셀 원본 식별정보(name, grade, class_num, student_num,
   *    level, department, gender, person_type) 보관
   *  - 일반일지 렌더 시 NULL person_uid 는 "현재 등록된 정보가 없습니다." 로 표시
   *  - 사용자가 매칭 처리 내역에서 사후 매칭 / 삭제 가능
   *
   *  학생 자동 생성(autoCreatePeople)은 여전히 호출하지 않음 — phantom 학생 유발 금지. */
  applyToDaily() {
    const db = this._healthDB.db;
    /* 사용자 정책 (2026-05-21, 재정의):
     *  미매칭 인원은 일반일지 DB 에 절대 자동 삽입하지 않는다 (보류 상태로 staging 에 유지).
     *  매칭(수동 매칭 or "전근·전학·자퇴" chip) 을 거쳐야만 일반일지에 들어간다.
     *  → applyToDaily 는 match_status='matched' 만 처리. */
    const matchedRecords = db.prepare("SELECT * FROM import_staging WHERE match_status = 'matched' AND matched_person_uid IS NOT NULL").all();
    if (!matchedRecords.length) {
      return { applied: 0, duplicates: 0, placeheld: 0, placeheldDuplicates: 0, skipped: 0, skipSamples: [], insertedIds: [], duplicateDetails: [] };
    }

    let applied = 0, duplicates = 0, skipped = 0, placeheld = 0, placeheldDuplicates = 0;
    /* 진단용: 검증 실패 사유 샘플 수집 (최대 5건) — UI 에 노출되어 사용자가 원인을 즉시 파악 */
    const skipSamples = [];
    /* 새로 삽입된 daily_records ID 목록 — UI 에서 "방금 삽입 되돌리기" 에 사용 */
    const insertedIds = [];
    /* 중복으로 스킵된 항목 상세 — UI 에 1행씩 표시 (날짜·학교급·학과·학년·반·번호·이름) */
    const duplicateDetails = [];
    const now = this._healthDB.now();
    const HealthDiaryDB = this._healthDB.constructor;

    /* 중복 검사: 모든 식별 필드가 완전히 일치하는 행만 중복으로 판정.
     * - 다회 방문(같은 날 두 번 이상): 시간·처치·메모 중 하나라도 다르면 별개로 인정 → 보존.
     * - 같은 엑셀 재업로드: 모든 필드가 bit-for-bit 동일 → 자동 스킵.
     * 사용자 명시 요청: "완전 똑같은 것이라면 안되야 한다" (2026-05-11). */
    const dupExactStmt = db.prepare(
      'SELECT id FROM daily_records WHERE school_year=? AND person_uid=? AND visit_date=? ' +
      'AND time_in=? AND time_out=? AND symptoms=? AND treatment=? AND medication=? ' +
      'AND memo=? AND nurse_name=? AND department=? AND result_code=? LIMIT 1'
    );
    /* placeholder(미매칭) 중복 검사 — person_uid IS NULL 행만, 식별정보 + 증상 + 시각 모두 동일 시 스킵.
     *  같은 엑셀을 반복 업로드해도 중복 placeholder 가 쌓이지 않도록 차단. */
    const dupPlaceholderStmt = db.prepare(
      "SELECT id FROM daily_records WHERE person_uid IS NULL AND is_imported=1 AND school_year=? AND visit_date=? " +
      "AND time_in=? AND time_out=? AND symptoms=? AND treatment=? AND medication=? AND memo=? " +
      "AND IFNULL(json_extract(extra_json, '$.unmatched_identity.name'),'')=? " +
      "AND IFNULL(json_extract(extra_json, '$.unmatched_identity.grade'),'')=? " +
      "AND IFNULL(json_extract(extra_json, '$.unmatched_identity.class_num'),'')=? " +
      "AND IFNULL(json_extract(extra_json, '$.unmatched_identity.student_num'),'')=? " +
      "LIMIT 1"
    );
    const markApplied = db.prepare("UPDATE import_staging SET match_status = 'applied' WHERE id = ?");
    /* 실제 삽입 완료된 레코드만 삭제 (검증 실패/중복 레코드는 staging에 남아있어 재시도 가능) */
    const deleteStaging = db.prepare("DELETE FROM import_staging WHERE match_status = 'applied'");
    const runApply = db.transaction(() => {
      for (const rec of matchedRecords) {
        /* 방어선: visit_date 가 빈 문자열이거나 비표준 형식이면 한 번 더 재정규화 시도 */
        let normVisitDate = String(rec.visit_date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normVisitDate)) {
          try { normVisitDate = _normalizeDate(normVisitDate); } catch (_) {}
        }
        rec.visit_date = normVisitDate;
        const visitYear = (rec.visit_date || '').slice(0, 4);
        const visitMonth = parseInt((rec.visit_date || '').slice(5, 7), 10) || 3;
        const schoolYear = visitMonth < 3 ? String(Number(visitYear) - 1) : visitYear;

        /* 원본 텍스트를 그대로 1항 JSON 배열로 감쌈 (외부 데이터는 문장·서술형일 수 있어 임의 분리 금지) */
        const _wrapJsonArr = (s) => {
          const raw = String(s || '').trim();
          if (!raw) return '[]';
          return JSON.stringify([raw]);
        };
        const symptomsJson = _wrapJsonArr(rec.symptoms);

        const personType = (rec.matched_person_uid && String(rec.matched_person_uid).startsWith('t')) ? 'staff' : 'student';
        const dailyData = {
          school_year: schoolYear,
          person_type: personType,
          visit_date: rec.visit_date,
          time_in: rec.time_in || '',
          time_out: rec.time_out || '',
          symptoms: symptomsJson,
        };
        const v = HealthDiaryDB.validateDailyRecord(dailyData);
        if (!v.valid) {
          console.warn('[applyToDaily] validation fail id=' + rec.id + ':', v.errors);
          /* 진단용: 첫 5건의 실패 사유와 문제 필드 값을 응답에 담아 UI 노출 */
          if (skipSamples.length < 5) {
            skipSamples.push({
              name: rec.student_name || '',
              visit_date: rec.visit_date || '(빈값)',
              time_in: rec.time_in || '',
              time_out: rec.time_out || '',
              errors: v.errors,
            });
          }
          skipped++;
          continue;
        }

        /* 완전 동일 중복 검사 — 모든 식별 필드가 비트 단위로 일치하는 행이 이미 있으면 스킵 */
        const _t_in = rec.time_in || '';
        const _t_out = rec.time_out || '';
        const _treat = rec.treatment || '';
        const _med = rec.medication || '';
        const _memo = rec.memo || '';
        const _nurse = rec.nurse_name || '';
        const _dept = rec.department || '';
        const _result = rec.result_code || '';
        const exactDup = dupExactStmt.get(
          schoolYear, rec.matched_person_uid, rec.visit_date,
          _t_in, _t_out, symptomsJson, _treat, _med,
          _memo, _nurse, _dept, _result
        );
        if (exactDup) {
          duplicates++;
          duplicateDetails.push({
            visit_date: rec.visit_date || '',
            level: rec.level || '',
            department: rec.department || '',
            grade: rec.grade || '',
            class_num: rec.class_num || '',
            student_num: rec.student_num || '',
            name: rec.student_name || '',
            symptoms: rec.symptoms || '',
          });
          markApplied.run(rec.id); /* staging 에서도 정리 (재삽입 시도 방지) */
          continue;
        }

        const _insRes = this._healthDB.stmt.dailyInsert.run({
          school_year: schoolYear,
          person_uid: rec.matched_person_uid,
          person_type: personType,
          visit_date: rec.visit_date,
          time_in: _t_in,
          time_out: _t_out,
          symptoms: symptomsJson,
          treatment: _treat,
          treatment_by_sym: '',  /* 임포트 데이터엔 증상↔처치 매핑 없음 → 옛 record 폴백 */
          medication: _med,
          department: _dept,
          body_temp: '',
          blood_pressure: '',
          pulse: '',
          respiration: '',
          spo2: '',
          bst: '',
          result_code: _result,
          nurse_name: _nurse,
          nurse_id: null,
          memo: _memo,
          bodymap_json: '[]',
          vip_tags: '[]',
          bed: '',
          is_imported: 1,
          extra_json: '{}',
          created_at: now,
          updated_at: now,
        });
        if(_insRes && _insRes.lastInsertRowid){
          insertedIds.push(Number(_insRes.lastInsertRowid));
        }
        markApplied.run(rec.id);
        applied++;
      }

      /* 미매칭(match_status='unmatched') 은 일반일지에 절대 자동 삽입하지 않는다.
       *  staging 에 그대로 남겨 사용자가 수동 매칭 또는 "전근·전학·자퇴" chip 으로 처리해야 함. */

      deleteStaging.run();
    });
    runApply();

    return { applied, duplicates, skipped, skipSamples, insertedIds, duplicateDetails, placeheld, placeheldDuplicates };
  }

  /** staging 행 1건 삭제 — 같은 식별정보(이름·학년·반·번호) 의 모든 unmatched/ambiguous 행을 함께 제거.
   *  사용자 정책 (2026-05-22): 매칭 처리 내역의 [🗑 삭제] 버튼은 한 사람 묶음을 한 번에 정리. */
  deleteStagingRow(stagingId){
    if (!stagingId) return { deleted: 0 };
    const db = this._healthDB.db;
    const row = db.prepare("SELECT * FROM import_staging WHERE id = ?").get(stagingId);
    if (!row) return { deleted: 0 };
    /* 같은 식별정보 행 모두 삭제 — 한 인원의 여러 방문 기록이 한 번에 사라지도록 */
    const info = db.prepare(
      "DELETE FROM import_staging " +
      "WHERE student_name = ? AND IFNULL(grade,'') = ? AND IFNULL(class_num,'') = ? AND IFNULL(student_num,'') = ? AND match_status IN ('ambiguous','unmatched','pending')"
    ).run(row.student_name||'', String(row.grade||''), String(row.class_num||''), String(row.student_num||''));
    return { deleted: info.changes };
  }

  /** 매칭(matched) 상태인 staging 행을 다시 unmatched 로 되돌림.
   *  사용자 정책 (2026-05-22): 삽입 취소 버튼은 staging 을 비우지 않고 매칭만 되돌려
   *  매칭 처리 내역에 다시 미매칭 인원으로 표시되도록 함. */
  revertMatchedToUnmatched(){
    const db = this._healthDB.db;
    const info = db.prepare(
      "UPDATE import_staging SET matched_person_uid = NULL, match_status = 'unmatched' " +
      "WHERE match_status = 'matched'"
    ).run();
    return { reverted: info.changes };
  }

  /** 명단 미등록(placeholder) 기록 목록 — daily_records 중 person_uid IS NULL AND is_imported=1.
   *  extra_json.unmatched_identity 의 원본 식별정보까지 파싱해서 반환. */
  listPlaceholderImports(){
    const db = this._healthDB.db;
    const rows = db.prepare(
      "SELECT id, school_year, visit_date, time_in, time_out, symptoms, treatment, medication, " +
      "memo, department, person_type, extra_json " +
      "FROM daily_records WHERE person_uid IS NULL AND is_imported = 1 " +
      "ORDER BY visit_date DESC, id DESC"
    ).all();
    return rows.map(r => {
      let identity = {};
      try {
        const ex = JSON.parse(r.extra_json || '{}');
        if (ex && ex.unmatched_identity) identity = ex.unmatched_identity;
      } catch (_) {}
      let symptomsText = '';
      try {
        const arr = JSON.parse(r.symptoms || '[]');
        if (Array.isArray(arr)) symptomsText = arr.join(' / ');
      } catch (_) { symptomsText = String(r.symptoms || ''); }
      return {
        id: r.id,
        school_year: r.school_year,
        visit_date: r.visit_date,
        time_in: r.time_in || '',
        time_out: r.time_out || '',
        symptoms: symptomsText,
        treatment: r.treatment || '',
        medication: r.medication || '',
        memo: r.memo || '',
        department: r.department || '',
        person_type: r.person_type || 'student',
        identity: {
          name: identity.name || '',
          gender: identity.gender || '',
          grade: identity.grade || '',
          class_num: identity.class_num || '',
          student_num: identity.student_num || '',
          level: identity.level || '',
          department: identity.department || '',
          person_type: identity.person_type || (r.person_type || 'student'),
        },
      };
    });
  }

  /** placeholder 기록을 특정 학생(또는 교직원) uid 로 매칭 — person_uid 설정 + extra_json 의
   *  unmatched_identity 키 제거. 호출 후엔 일반 일지 행처럼 보이게 됨. */
  matchPlaceholderToPerson(recordId, personUid){
    if (!recordId || !personUid) return { matched: false, error: 'missing args' };
    const db = this._healthDB.db;
    const row = db.prepare('SELECT extra_json, person_type FROM daily_records WHERE id = ? AND person_uid IS NULL').get(recordId);
    if (!row) return { matched: false, error: 'placeholder not found' };
    let ex = {};
    try { ex = JSON.parse(row.extra_json || '{}'); } catch (_) { ex = {}; }
    if (ex && ex.unmatched_identity) delete ex.unmatched_identity;
    /* person_type 도 uid 접두사로 보정 (s0001 → student, t0001 → staff) */
    const personType = (String(personUid).startsWith('t')) ? 'staff' : 'student';
    const now = this._healthDB.now();
    db.prepare('UPDATE daily_records SET person_uid = ?, person_type = ?, extra_json = ?, updated_at = ? WHERE id = ?')
      .run(personUid, personType, JSON.stringify(ex), now, recordId);
    return { matched: true };
  }

  /** placeholder 기록 1건 삭제. */
  deletePlaceholderImport(recordId){
    if (!recordId) return { deleted: 0 };
    const db = this._healthDB.db;
    const res = db.prepare('DELETE FROM daily_records WHERE id = ? AND person_uid IS NULL AND is_imported = 1').run(recordId);
    return { deleted: res.changes };
  }

  /** staging 행 1건을 "전학·자퇴·전근으로 학교에 없는 사람" 으로 자동 등록 + 같은 식별정보의 모든 staging 행 matched 처리.
   *  사용자 정책 (2026-05-21): 수동 매칭 모달의 [🚌 전학·자퇴·전근] 칩에서 호출.
   *  학년 칸이 숫자면 학생, 아니면 교직원으로 판단. 한 트랜잭션. */
  stagingRowAsLeaver(stagingId){
    if (!stagingId) return { success: false, error: 'no stagingId' };
    const db = this._healthDB.db;
    const row = db.prepare("SELECT * FROM import_staging WHERE id = ? AND match_status IN ('ambiguous','unmatched','pending')").get(stagingId);
    if (!row) return { success: false, error: 'staging row not found' };
    const name = String(row.student_name || '').trim();
    if (!name) return { success: false, error: '이름 정보가 없어 자동 등록할 수 없습니다.' };

    const gradeStr = String(row.grade || '').trim();
    const gradeNum = parseInt(gradeStr.replace(/[^0-9]/g, ''), 10) || 0;
    const isStudent = gradeNum > 0;
    const gender = String(row.gender || '').trim();
    const yr = String(row.visit_date ? row.visit_date.slice(0, 4) : new Date().getFullYear());
    const now = this._healthDB.now();
    const HealthDiaryDB = this._healthDB.constructor;
    let newUid = null;

    const tx = db.transaction(() => {
      if (isStudent) {
        newUid = HealthDiaryDB.generateStudentUid(db);
        const cls = _normClassValue(row.class_num);
        const num = parseInt(String(row.student_num || '').replace(/[^0-9]/g, ''), 10) || 0;
        const level = String(row.level || '').trim();
        const department = String(row.department || '').trim();
        db.prepare('INSERT INTO students (uid, name, gender, birth_date, memo_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(newUid, name, gender, '', '{}', now, now);
        db.prepare('INSERT INTO students_info (uid, school_year, grade, class_num, student_num, level, department, is_enrolled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)')
          .run(newUid, yr, gradeNum, cls, num, level, department, now, now);
      } else {
        newUid = HealthDiaryDB.generateStaffUid(db);
        const position = (gradeNum > 0 ? '' : gradeStr).trim();
        db.prepare('INSERT INTO staff (uid, school_year, position, name, gender, birth_date, family_relation, family_phone, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)')
          .run(newUid, yr, position, name, gender, '', '', '', now, now);
      }
      /* 같은 (이름·학년·반·번호) 의 다른 staging 행들도 같은 사람의 일지로 보고 함께 matched 처리 */
      db.prepare(
        "UPDATE import_staging SET matched_person_uid = ?, match_status = 'matched' " +
        "WHERE student_name = ? AND IFNULL(grade,'') = ? AND IFNULL(class_num,'') = ? AND IFNULL(student_num,'') = ? AND match_status IN ('ambiguous','unmatched','pending')"
      ).run(newUid, row.student_name||'', String(row.grade||''), String(row.class_num||''), String(row.student_num||''));
    });

    try {
      tx();
      return { success: true, uid: newUid, personType: isStudent ? 'student' : 'staff', name };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /** placeholder 1건을 "전학·자퇴·전근으로 학교에 없는 사람" 으로 자동 등록 + person_uid 연결.
   *  사용자 정책 (2026-05-21): 외부 데이터의 학년 칸이 숫자면 학생, 아니면 교직원으로 판단.
   *  학생은 students + students_info(is_enrolled=0) 에, 교직원은 staff(is_active=0) 에 등록.
   *  5년 보존 정책 안에서 placeholder daily_records 의 참조가 유지되도록 person_uid 까지 한 트랜잭션. */
  placeholderAsLeaver(recordId){
    if (!recordId) return { success: false, error: 'no recordId' };
    const db = this._healthDB.db;
    const row = db.prepare('SELECT id, person_type, school_year, visit_date, extra_json FROM daily_records WHERE id = ? AND person_uid IS NULL AND is_imported = 1').get(recordId);
    if (!row) return { success: false, error: 'placeholder not found' };
    let ex = {};
    try { ex = JSON.parse(row.extra_json || '{}'); } catch (_) { ex = {}; }
    const ident = (ex && ex.unmatched_identity) || {};
    const name = String(ident.name || '').trim();
    if (!name) return { success: false, error: '이름 정보가 없어 자동 등록할 수 없습니다.' };

    const gradeStr = String(ident.grade || '').trim();
    const gradeNum = parseInt(gradeStr.replace(/[^0-9]/g, ''), 10) || 0;
    /* 외부 엑셀의 학년 칸 — 숫자가 있으면 학생, 비어 있거나 직위 텍스트면 교직원.
     *  ident.person_type 이 명시되어 있으면 그것을 우선. */
    const declaredType = String(ident.person_type || '').toLowerCase();
    const isStudent = declaredType ? (declaredType !== 'staff') : (gradeNum > 0);
    const yr = String(row.school_year || (row.visit_date ? row.visit_date.slice(0, 4) : new Date().getFullYear()));
    const now = this._healthDB.now();
    const gender = String(ident.gender || '').trim();
    /* HealthDiaryDB 는 require 가 아니라 인스턴스의 constructor 로 참조 (이 파일 다른 메소드들의 관행). */
    const HealthDiaryDB = this._healthDB.constructor;
    let newUid = null;

    const tx = db.transaction(() => {
      if (isStudent) {
        newUid = HealthDiaryDB.generateStudentUid(db);
        const cls = _normClassValue(ident.class_num);
        const num = parseInt(String(ident.student_num || '').replace(/[^0-9]/g, ''), 10) || 0;
        const level = String(ident.level || '').trim();
        const department = String(ident.department || '').trim();
        db.prepare('INSERT INTO students (uid, name, gender, birth_date, memo_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(newUid, name, gender, '', '{}', now, now);
        db.prepare('INSERT INTO students_info (uid, school_year, grade, class_num, student_num, level, department, is_enrolled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)')
          .run(newUid, yr, gradeNum, cls, num, level, department, now, now);
      } else {
        newUid = HealthDiaryDB.generateStaffUid(db);
        /* 학년 칸이 직위 텍스트(예: 교원·행정실장)인 경우 position 으로 보존. ident.position 우선. */
        const position = String(ident.position || (gradeNum > 0 ? '' : gradeStr) || '').trim();
        db.prepare('INSERT INTO staff (uid, school_year, position, name, gender, birth_date, family_relation, family_phone, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)')
          .run(newUid, yr, position, name, gender, '', '', '', now, now);
      }
      /* placeholder daily_records 의 person_uid 연결 + extra_json 의 unmatched_identity 제거 */
      if (ex && ex.unmatched_identity) delete ex.unmatched_identity;
      const personType = isStudent ? 'student' : 'staff';
      db.prepare('UPDATE daily_records SET person_uid = ?, person_type = ?, extra_json = ?, updated_at = ? WHERE id = ?')
        .run(newUid, personType, JSON.stringify(ex), now, recordId);
    });

    try {
      tx();
      return { success: true, uid: newUid, personType: isStudent ? 'student' : 'staff', name };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /** 모든 기존 placeholder(person_uid IS NULL + extra_json.unmatched_identity 존재) 를
   *  일괄로 ghost 등록 (students/staff is_enrolled=0/is_active=0) 하고 person_uid 연결.
   *  사용자 정책 (2026-05-21): "id 부여하고 등록시키고 끝".
   *  applyToDaily 진입 시 자동으로 한 번 호출되어 옛 placeholder 도 정리됨.
   *  이름이 비어 있는 행은 등록할 수 없으므로 placeholder 로 유지. */
  migratePlaceholdersToGhosts(){
    const db = this._healthDB.db;
    const rows = db.prepare(
      "SELECT id, person_type, school_year, visit_date, extra_json FROM daily_records " +
      "WHERE person_uid IS NULL AND is_imported = 1"
    ).all();
    if (!rows.length) return { migrated: 0, skipped: 0 };

    const HealthDiaryDB = this._healthDB.constructor;
    const now = this._healthDB.now();
    let migrated = 0, skipped = 0;

    const tx = db.transaction(() => {
      for (const row of rows) {
        let ex = {};
        try { ex = JSON.parse(row.extra_json || '{}'); } catch (_) { ex = {}; }
        const ident = (ex && ex.unmatched_identity) || null;
        const name = ident && String(ident.name || '').trim();
        if (!name) { skipped++; continue; }

        const gradeStr = String(ident.grade || '').trim();
        const gradeNum = parseInt(gradeStr.replace(/[^0-9]/g, ''), 10) || 0;
        const declaredType = String(ident.person_type || '').toLowerCase();
        const isStudent = declaredType ? (declaredType !== 'staff') : (gradeNum > 0);
        const yr = String(row.school_year || (row.visit_date ? row.visit_date.slice(0, 4) : new Date().getFullYear()));

        try {
          let newUid;
          if (isStudent) {
            newUid = HealthDiaryDB.generateStudentUid(db);
            const cls = _normClassValue(ident.class_num);
            const num = parseInt(String(ident.student_num || '').replace(/[^0-9]/g, ''), 10) || 0;
            db.prepare('INSERT INTO students (uid, name, gender, birth_date, memo_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
              .run(newUid, name, ident.gender || '', '', '{}', now, now);
            db.prepare('INSERT INTO students_info (uid, school_year, grade, class_num, student_num, level, department, is_enrolled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)')
              .run(newUid, yr, gradeNum, cls, num, ident.level || '', ident.department || '', now, now);
          } else {
            newUid = HealthDiaryDB.generateStaffUid(db);
            const position = String(ident.position || (gradeNum > 0 ? '' : gradeStr) || '').trim();
            db.prepare('INSERT INTO staff (uid, school_year, position, name, gender, birth_date, family_relation, family_phone, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)')
              .run(newUid, yr, position, name, ident.gender || '', '', '', '', now, now);
          }
          if (ex && ex.unmatched_identity) delete ex.unmatched_identity;
          const pType = isStudent ? 'student' : 'staff';
          db.prepare('UPDATE daily_records SET person_uid = ?, person_type = ?, extra_json = ?, updated_at = ? WHERE id = ?')
            .run(newUid, pType, JSON.stringify(ex), now, row.id);
          migrated++;
        } catch (e) {
          console.warn('[migratePlaceholdersToGhosts] id=' + row.id + ' 실패:', e.message);
          skipped++;
        }
      }
    });
    try { tx(); } catch (e) {
      console.warn('[migratePlaceholdersToGhosts] tx 실패:', e.message);
    }
    return { migrated, skipped };
  }

  /** 방금 삽입된 daily_records 되돌리기 — applyToDaily 가 반환한 insertedIds 만 정확히 삭제. */
  revertJustInserted(ids){
    if(!Array.isArray(ids) || !ids.length) return { reverted: 0 };
    const db = this._healthDB.db;
    /* 사용자가 그 사이 직접 편집한 행도 같이 지워질 수 있어 is_imported=1 조건도 함께 — 안전망 */
    const placeholders = ids.map(()=>'?').join(',');
    const stmt = db.prepare('DELETE FROM daily_records WHERE id IN ('+placeholders+') AND is_imported = 1');
    const res = stmt.run.apply(stmt, ids);
    return { reverted: res.changes };
  }

  /** 매칭 상태별 건수 */
  getMatchStats() {
    try {
      const db = this._healthDB.db;
      const rows = db.prepare("SELECT match_status, COUNT(*) as cnt FROM import_staging GROUP BY match_status").all();
      const stats = { total: 0, matched: 0, graduated: 0, ambiguous: 0, unmatched: 0, applied: 0, pending: 0 };
      rows.forEach(r => { stats[r.match_status] = r.cnt; stats.total += r.cnt; });
      return stats;
    } catch (_) { return { total: 0, matched: 0, graduated: 0, ambiguous: 0, unmatched: 0, applied: 0, pending: 0 }; }
  }

  /** 특정 날짜의 과거 기록 조회 (일반일지 통합 표시용) — 이제 daily_records에서 직접 조회 */
  getByDate(date) {
    try {
      return this._healthDB.db.prepare(
        "SELECT * FROM daily_records WHERE visit_date = ? AND is_imported = 1"
      ).all(date);
    } catch (_) { return []; }
  }

  /** 스테이징 데이터 전체 삭제 (초기화) */
  clearStaging() {
    this._healthDB.db.prepare('DELETE FROM import_staging').run();
    return { success: true };
  }

  /** 과거에 업로드되어 daily_records에 들어간 기록 전체 삭제 (is_imported=1) */
  deleteImported() {
    const db = this._healthDB.db;
    const countBefore = db.prepare('SELECT COUNT(*) as c FROM daily_records WHERE is_imported = 1').get().c;
    db.prepare('DELETE FROM daily_records WHERE is_imported = 1').run();
    return { success: true, deleted: countBefore };
  }

  /** 올해 import된 기록 개수 (is_imported=1 + 현재 학년도 기준) */
  getImportedCountThisYear() {
    const db = this._healthDB.db;
    const now = new Date();
    const year = String(now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1);
    const row = db.prepare("SELECT COUNT(*) as c FROM daily_records WHERE is_imported = 1 AND school_year = ?").get(year);
    return { count: row.c, year };
  }
}

module.exports = { TbTestService, PastHistoryService, _normalizeDate, _normalizeDatetime };
