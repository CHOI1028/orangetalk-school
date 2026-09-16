/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 요보호 등록의 학생 매칭·저장 확인. DOM/저장소에 의존하지 않는다. */
const pendingCareSaves = new Set();
const careTextFields = ['care_reason', 'dust_disease', 'care_memo'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizedText(value) {
  return String(value == null ? '' : value).trim().normalize('NFC');
}

function normalizedSeat(value, suffix) {
  let text = normalizedText(value);
  if (suffix) text = text.replace(suffix, '').trim();
  if (/^\d+(?:\.0+)?$/.test(text)) {
    text = text.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
  }
  return text === '0' ? '' : text;
}

export function normalizeCareSchoolLevel(value) {
  const text = normalizedText(value);
  const aliases = {
    '초': '초', '초등': '초', '초등학교': '초', 'elementary': '초',
    '중': '중', '중등': '중', '중학교': '중', 'middle': '중',
    '고': '고', '고등': '고', '고등학교': '고', 'high': '고',
    '유': '유', '유치원': '유', 'kindergarten': '유',
    '특수': '특수', '특수학교': '특수', 'special': '특수'
  };
  const key = text.toLowerCase();
  return own(aliases, key) ? aliases[key] : text;
}

/** 제공된 식별 정보만 비교하되, 후보가 여러 명이면 자동으로 선택하지 않는다. */
export function matchCareStudent(people, row) {
  const input = row && typeof row === 'object' ? row : {};
  const name = normalizedText(input.name);
  if (!name) return { student: null, reason: 'invalid-name' };
  const grade = normalizedSeat(input.grade, /\s*학년$/);
  const cls = normalizedSeat(input.cls, /\s*반$/);
  const num = normalizedSeat(input.num, /\s*번$/);
  const level = normalizeCareSchoolLevel(input.level);
  const department = normalizedText(input.department);
  const candidates = (Array.isArray(people) ? people : []).filter(student => {
    if (!student || student.type !== 'student' || student._notFound || student._isLeaver || student._unenrolled) return false;
    if (student.is_enrolled != null && Number(student.is_enrolled) === 0) return false;
    if (normalizedText(student.name) !== name) return false;
    if (grade && normalizedSeat(student.grade, /\s*학년$/) !== grade) return false;
    if (cls && normalizedSeat(student.cls != null ? student.cls : student.class_num, /\s*반$/) !== cls) return false;
    if (num && normalizedSeat(student.num != null ? student.num : student.student_num, /\s*번$/) !== num) return false;
    if (level && normalizeCareSchoolLevel(student.level) !== level) return false;
    if (department && normalizedText(student.department) !== department) return false;
    return true;
  });
  if (candidates.length === 1) return { student: candidates[0], reason: 'matched' };
  if (candidates.length > 1) return { student: null, reason: 'ambiguous', candidates };
  return { student: null, reason: 'not-found' };
}

function failedCareSave(code) {
  const errors = {
    'invalid-student': '학생 정보를 다시 불러온 뒤 등록해 주세요.',
    'unavailable': '저장 연결을 확인할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
    'invalid-year': '학년도 정보를 확인한 뒤 다시 시도해 주세요.',
    'invalid-changes': '저장할 요보호 정보를 확인해 주세요.',
    'pending': '이 학생의 정보를 저장 중입니다. 완료된 뒤 다시 시도해 주세요.',
    'save-failed': '요보호 정보를 저장하지 못했습니다. 입력 내용은 유지되며, 연결 상태를 확인한 뒤 다시 시도해 주세요.',
    'invalid-response': '저장 완료를 확인하지 못했습니다. 명단을 다시 불러와 확인해 주세요.'
  };
  return { success: false, code, error: errors[code] };
}

function validCareAcknowledgement(result, uid) {
  if (!result || result.success !== true || result.uid == null || String(result.uid) !== uid) return false;
  const care = result.care;
  if (!care || typeof care !== 'object' || Array.isArray(care)) return false;
  if (!own(care, 'is_care') || (care.is_care !== 0 && care.is_care !== 1)) return false;
  return careTextFields.every(field => own(care, field) && typeof care[field] === 'string');
}

/** 저장 중 명단을 다시 불러왔더라도 DB 확인이 끝난 값만 동일하게 반영한다. */
export function applyCareResult(student, care, year) {
  if (!student || typeof student !== 'object' || !validCareAcknowledgement({ success: true, uid: '', care }, '')
    || !/^\d{4}$/.test(normalizedText(year))) return false;
  student.is_care = care.is_care;
  student.care_reason = care.care_reason;
  student.condition = care.care_reason;
  student.status = care.is_care ? 'caution' : 'normal';
  student.dust_disease = care.dust_disease;
  student.dustDisease = care.dust_disease;
  student.care_memo = care.care_memo;
  student.careMemo = care.care_memo;
  if (care.is_care || care.dust_disease || care.care_memo) student.careYear = Number(year);
  else delete student.careYear;
  return true;
}

/** 요보호 필드만 갱신한다. 성공 응답을 받기 전에는 화면 학생 객체를 변경하지 않는다. */
export async function persistCareRegistration(student, changes, options = {}) {
  if (!student || student.type !== 'student' || student._notFound || student._isLeaver || student._unenrolled
    || (student.is_enrolled != null && Number(student.is_enrolled) === 0)) return failedCareSave('invalid-student');
  const rawUid = student.uid || student.id;
  if ((typeof rawUid !== 'string' && typeof rawUid !== 'number')
    || !normalizedText(rawUid) || (typeof rawUid === 'number' && !Number.isFinite(rawUid))) return failedCareSave('invalid-student');
  const uid = String(rawUid);
  const api = options && options.api;
  if (!api || typeof api.studentsUpsert !== 'function') return failedCareSave('unavailable');
  const year = normalizedText(options.year);
  if (!/^\d{4}$/.test(year)) return failedCareSave('invalid-year');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return failedCareSave('invalid-changes');
  const payload = { uid, _careOnly: true };
  for (const field of careTextFields) {
    if (!own(changes, field)) continue;
    if (typeof changes[field] !== 'string') return failedCareSave('invalid-changes');
    payload[field] = changes[field];
  }
  if (own(changes, '_clearCare')) {
    if (typeof changes._clearCare !== 'boolean') return failedCareSave('invalid-changes');
    if (changes._clearCare) payload._clearCare = true;
  }
  if (!payload._clearCare && !careTextFields.some(field => own(payload, field))) return failedCareSave('invalid-changes');
  const pendingKey = JSON.stringify([uid, year]);
  if (pendingCareSaves.has(pendingKey)) return failedCareSave('pending');
  pendingCareSaves.add(pendingKey);
  try {
    let result;
    try { result = await api.studentsUpsert(payload, year); }
    catch (_) { return failedCareSave('save-failed'); }
    if (!result || result.success !== true) return failedCareSave('save-failed');
    if (!validCareAcknowledgement(result, uid)) return failedCareSave('invalid-response');
    const care = result.care;
    applyCareResult(student, care, year);
    return { success: true, uid, care: {
      is_care: care.is_care, care_reason: care.care_reason,
      dust_disease: care.dust_disease, care_memo: care.care_memo
    } };
  } finally {
    pendingCareSaves.delete(pendingKey);
  }
}
