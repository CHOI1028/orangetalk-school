/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * kiosk-roster-source.js — 온디맨드 명단 응답 데이터 빌더 (순수함수, PC=교사 측, 2026-06-14)
 *
 * 키오스크가 요청한 만큼만 추려 반환한다. 이름이 들어가는 응답(class/staff/search)은
 * 호출 측에서 반드시 AES-GCM 암호화해 전송한다(kiosk-roster-crypto). 여기선 데이터만 만든다.
 *
 *  - structure: 드릴다운 뼈대 (학년·반 목록·인원수). 이름 없음 → 평문 전송 가능(비PII).
 *  - class:     특정 (학교급·학과·학년·반) 학생 [{uid,num,name}] — 암호화 대상.
 *  - staff:     교직원 [{uid,name,position}] — 암호화 대상.
 *  - search:    이름 부분일치 매칭 — 암호화 대상.
 *
 * 입력 people 은 활성 명단(S.people) — is_enrolled/is_active 필터는 로딩 단계에서 끝났다고 가정.
 * 키오스크 임베드/검색 그룹핑(level|department|cls)과 동일 규칙으로 묶어 화면이 그대로 동작하게 한다.
 */

function _isStudent(p) { return p && p.type === 'student' && p.name; }
function _isStaff(p)   { return p && p.type === 'staff' && p.name; }
function _uid(p)       { return p.uid || p.id || ''; }

/** 드릴다운 뼈대 — 이름 없음(비PII). grades + (학교급·학과·학년·반) 그룹 + 인원수 + 교직원 유무. */
export function buildRosterStructure(people) {
  const arr = Array.isArray(people) ? people : [];
  const gradeSet = new Set();
  const groupMap = new Map();              // "level|department|grade|cls" → count
  let staffCount = 0;
  arr.forEach((p) => {
    if (_isStaff(p)) { staffCount++; return; }
    if (!_isStudent(p)) return;
    const g = Number(p.grade) || 0;
    if (g) gradeSet.add(g);
    const key = (p.level || '') + '|' + (p.department || '') + '|' + g + '|' + (p.cls != null ? p.cls : '');
    groupMap.set(key, (groupMap.get(key) || 0) + 1);
  });
  const classes = [];
  groupMap.forEach((count, key) => {
    const parts = key.split('|');
    classes.push({ level: parts[0], department: parts[1], grade: Number(parts[2]) || 0, cls: parts[3], count });
  });
  const grades = Array.from(gradeSet).sort((a, b) => a - b);
  return { grades, classes, staff: { exists: staffCount > 0, count: staffCount } };
}

/** 특정 반 학생 [{uid,num,name}] — 번호순. (암호화 대상) */
export function buildClassRoster(people, query) {
  const arr = Array.isArray(people) ? people : [];
  const q = query || {};
  const level = String(q.level || ''), dept = String(q.department || '');
  const grade = Number(q.grade) || 0, cls = String(q.cls != null ? q.cls : '');
  const list = arr.filter((p) =>
    _isStudent(p) &&
    (Number(p.grade) || 0) === grade &&
    String(p.cls != null ? p.cls : '') === cls &&
    String(p.department || '') === dept &&
    String(p.level || '') === level
  ).sort((a, b) => (Number(a.num) || 0) - (Number(b.num) || 0))
    .map((p) => ({ uid: _uid(p), num: p.num != null ? p.num : 0, name: p.name || '' }));
  return { people: list };
}

/** 교직원 [{uid,name,position}] — 이름 가나다순. (암호화 대상) */
export function buildStaffRoster(people) {
  const arr = Array.isArray(people) ? people : [];
  const list = arr.filter(_isStaff)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
    .map((p) => ({ uid: _uid(p), name: p.name || '', position: p.position || '' }));
  return { people: list };
}

/** 이름 부분일치 검색 — type 'student'|'staff'|'' (전체). 최대 50명. (암호화 대상) */
export function searchRoster(people, qstr, type) {
  const arr = Array.isArray(people) ? people : [];
  const q = String(qstr || '').trim().toLowerCase();
  if (!q) return { people: [] };
  const list = arr.filter((p) => {
    if (!p || !p.name) return false;
    if (type === 'student' && p.type !== 'student') return false;
    if (type === 'staff' && p.type !== 'staff') return false;
    return String(p.name).toLowerCase().indexOf(q) !== -1;
  }).slice(0, 50).map((p) => ({
    uid: _uid(p), name: p.name || '',
    grade: p.grade || 0, cls: p.cls != null ? p.cls : '', num: p.num != null ? p.num : 0,
    level: p.level || '', department: p.department || '', position: p.position || '',
    type: p.type || 'student',
  }));
  return { people: list };
}

/** UID 목록 → 해당 인원 [{uid,name,grade,cls,num,level,department,position,type}] — 대기 명단 복원용. (암호화 대상) */
export function buildByUids(people, uids) {
  const arr = Array.isArray(people) ? people : [];
  const want = {};
  (uids || []).forEach((u) => { if (u) want[String(u)] = 1; });
  const list = arr.filter((p) => p && p.name && want[String(_uid(p))]).map((p) => ({
    uid: _uid(p), name: p.name || '', type: p.type || 'student',
    grade: p.grade || 0, cls: p.cls != null ? p.cls : '', num: p.num != null ? p.num : 0,
    level: p.level || '', department: p.department || '', position: p.position || '',
  }));
  return { people: list };
}

/** 키오스크 요청(kind/query) → 응답 {kind, enc, payloadData}. enc=true 면 호출측이 payloadData 를 암호화. */
export function buildRosterReply(people, kind, query) {
  if (kind === 'structure') return { enc: false, data: buildRosterStructure(people) };
  if (kind === 'class')     return { enc: true,  data: buildClassRoster(people, query) };
  if (kind === 'staff')     return { enc: true,  data: buildStaffRoster(people) };
  if (kind === 'search')    return { enc: true,  data: searchRoster(people, query && query.q, query && query.type) };
  if (kind === 'byuids')    return { enc: true,  data: buildByUids(people, query && query.uids) };
  return { enc: false, data: null };
}
