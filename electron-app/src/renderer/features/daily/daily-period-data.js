/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* Read-only period-search helpers. No renderer state, database or DOM access. */

const LOCAL_SAVE_GRACE_MS = 7000;
const COUNSEL_FIELDS = ['content', 'action', 'plan', 'opinion'];
const JOIN_IDENTITY_FIELDS = ['personName', 'studentGrade', 'studentClass', 'studentNum', 'studentGender', 'studentLevel', 'studentDepartment', 'staffPosition', 'isCare', 'careReason'];

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function validatePeriodRange(from, to) {
  if (!from || !to) return '시작일과 종료일을 모두 선택해 주세요.';
  if (!validDate(from)) return '시작일을 올바른 날짜(YYYY-MM-DD)로 입력해 주세요.';
  if (!validDate(to)) return '종료일을 올바른 날짜(YYYY-MM-DD)로 입력해 주세요.';
  if (from > to) return '종료일을 시작일과 같거나 이후 날짜로 선택해 주세요.';
  return '';
}

function personKey(record) {
  return text(record.personUid) || text(record.studentId) || text(record.person_uid);
}

function recordKey(record) {
  return text(record._dbId) || text(record.id);
}

function compositeKey(record) {
  const person = personKey(record);
  // Unknown people must never be collapsed merely because visit times match.
  return person && record.date && record.timeIn
    ? JSON.stringify([person, record.date, record.timeIn]) : '';
}

function copyRecord(record) {
  const copy = structuredClone(record);
  const person = personKey(copy);
  if (person) {
    if (!text(copy.personUid)) copy.personUid = person;
    if (!text(copy.studentId)) copy.studentId = person;
  }
  return copy;
}

function localChangePending(record, now) {
  const savedAt = Number(record._savedAt);
  const recent = Number.isFinite(savedAt) && savedAt > 0 && now >= savedAt && now - savedAt < LOCAL_SAVE_GRACE_MS;
  return !!(record._dirty || record._inserting || record._pendingUpdate || recent);
}

function overlayLocalRecord(dbRecord, localRecord) {
  const merged = { ...dbRecord, ...localRecord };
  const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
  const hasLocalIdentity = ['personUid', 'studentId', 'person_uid'].some(key => own(localRecord, key));
  const samePerson = !hasLocalIdentity || personKey(dbRecord) === personKey(localRecord);
  for (const key of JOIN_IDENTITY_FIELDS) {
    if (samePerson) {
      // Year-only local loads contain empty JOIN defaults; the period DB row is authoritative.
      if (own(dbRecord, key)) merged[key] = dbRecord[key];
    } else {
      // A changed visitor must never inherit the former visitor's identity or care data.
      const value = localRecord[key];
      if (!own(localRecord, key) || value == null || value === '' || value === 0 || value === '0') delete merged[key];
    }
  }
  if (!samePerson) {
    // Do not retain the former person's compatibility alias or unmatched identity either.
    const person = personKey(localRecord);
    merged.personUid = person;
    merged.studentId = person;
    if (!own(localRecord, 'person_uid')) delete merged.person_uid;
    if (!own(localRecord, 'personType')) delete merged.personType;
    if (!own(localRecord, 'unmatchedIdentity')) delete merged.unmatchedIdentity;
    if (!own(localRecord, 'isPlaceholder')) delete merged.isPlaceholder;
  }
  return merged;
}

/** DB rows are authoritative. Only explicitly pending/recent local edits override them.
 * The optional clock makes the seven-second save grace deterministic in tests.
 * Returned records (including nested data) are detached from both input arrays.
 */
export function reconcilePeriodRecords(dbRecords, memoryRecords, from, to, now = Date.now()) {
  if (validatePeriodRange(from, to)) return [];
  const usable = record => record && typeof record === 'object' && !Array.isArray(record)
    && !record._deleted && !record._isDummy;
  const inRange = record => validDate(record.date) && record.date >= from && record.date <= to;
  const rows = [];
  const byId = new Map();
  const dbComposite = new Set();
  for (const record of Array.isArray(dbRecords) ? dbRecords : []) {
    if (!usable(record) || !inRange(record)) continue;
    const key = recordKey(record);
    if (key && byId.has(key)) continue;
    if (key) byId.set(key, rows.length);
    const composite = compositeKey(record);
    if (composite) dbComposite.add(composite);
    rows.push(record);
  }
  for (const record of Array.isArray(memoryRecords) ? memoryRecords : []) {
    if (!usable(record) || !localChangePending(record, now)) continue;
    // A newly inserted visit's temporary id can coincide with an unrelated DB row.
    const temporary = !text(record._dbId) && (record._inserting || record._autoCreated);
    const key = temporary ? '' : recordKey(record);
    if (key && byId.has(key)) {
      // Date edits may move a matching DB row outside the requested interval.
      const index = byId.get(key);
      rows[index] = overlayLocalRecord(rows[index], record);
      continue;
    }
    if (!inRange(record)) continue;
    // An insert can reach the DB before its assigned id reaches renderer memory.
    const composite = compositeKey(record);
    if (!text(record._dbId) && composite && dbComposite.has(composite)) continue;
    if (key) byId.set(key, rows.length);
    if (composite) dbComposite.add(composite);
    rows.push(record);
  }
  return rows.filter(inRange).map(copyRecord).sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
    || String(b.timeIn || '').localeCompare(String(a.timeIn || ''))
    || recordKey(a).localeCompare(recordKey(b), undefined, { numeric: true })
  );
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const valueText = text(value);
  if (valueText.startsWith('[')) {
    try { const parsed = JSON.parse(valueText); if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean); } catch (_) { /* legacy free text */ }
  }
  return valueText ? [valueText] : [];
}

function mapping(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

/** Plain text only; callers must escape these four strings when creating HTML. */
export function periodRecordText(record) {
  const rec = record || {};
  const symptoms = list(rec.symptoms);
  const treatment = list(rec.treatment);
  const counselLog = mapping(rec.counselLog);
  const treatmentMap = mapping(rec.treatmentBySym);
  const medicineMap = mapping(rec.medsBySym);
  const dosesMap = mapping(rec.medDosesBySym);
  const treatmentLines = [];
  const medicineLines = [];
  const mappedTreatments = new Set();
  const mappedMedicines = new Set();
  // Unbranched/imported visits use their common text; stale symptom maps are hidden.
  const branched = rec.treatmentBranched !== false && !rec.isImported;
  if (branched) {
    const keys = unique([...symptoms, ...Object.keys(treatmentMap), ...Object.keys(medicineMap)]);
    for (const symptom of keys) {
      const treatments = unique(list(treatmentMap[symptom]));
      treatments.forEach(item => mappedTreatments.add(item));
      const label = symptom === '__flat__' ? '' : symptom + ': ';
      if (treatments.length) treatmentLines.push(label + treatments.join(', '));
      const doses = mapping(dosesMap[symptom]);
      const medicines = unique(list(medicineMap[symptom]).map(name => {
        const dose = text(doses[name]);
        return dose ? name + ' (' + dose + ')' : name;
      }));
      medicines.forEach(item => mappedMedicines.add(item));
      if (medicines.length) medicineLines.push(label + medicines.join(', '));
    }
  }
  const commonTreatments = treatment.filter(item => !mappedTreatments.has(item));
  const counselTreatment = text(counselLog.treatmentText);
  if (counselTreatment && !mappedTreatments.has(counselTreatment)) commonTreatments.push(counselTreatment);
  if (commonTreatments.length) treatmentLines.push(unique(commonTreatments).join(', '));
  if (text(rec.treatmentMemo)) treatmentLines.push(text(rec.treatmentMemo));
  const commonMedicines = list(rec.medication).filter(item => !mappedMedicines.has(item));
  if (commonMedicines.length) medicineLines.push(commonMedicines.join(', '));
  const counselLabels = { content: '상담 내용', action: '조치', plan: '계획', opinion: '의견' };
  const counsel = COUNSEL_FIELDS.filter(key => text(counselLog[key]))
    .map(key => counselLabels[key] + ': ' + text(counselLog[key])).join('\n');
  return {
    symptom: unique([...symptoms, ...list(counselLog.topics)]).join(', '),
    treatment: unique(treatmentLines).join('\n'),
    medication: unique(medicineLines).join('\n'),
    counsel
  };
}

export function summarizePeriodRecords(records) {
  const people = new Set();
  let visits = 0, unknownPeople = 0, counsel = 0, treatment = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || record._deleted || record._isDummy) continue;
    visits++;
    const person = personKey(record);
    if (person) people.add(person); else unknownPeople++;
    const details = periodRecordText(record);
    if (details.counsel) counsel++;
    if (details.treatment || details.medication) treatment++;
  }
  return { visits, people: people.size + unknownPeople, counsel, treatment };
}
