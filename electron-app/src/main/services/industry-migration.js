'use strict';
const { createHash } = require('node:crypto');
const SchoolTreatment = require('./school-treatment');
const TABLES = ['subjects', 'journals', 'counselings', 'emergencies', 'infections', 'medicines', 'medicineLogs', 'memos', 'todos', 'links', 'trash'];
const text = value => value == null ? '' : String(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const joined = (...values) => values.filter(Boolean).map(text).join('\n');
function readable(value) {
  if (!value) return '';
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(text).join(', ') : text(value); }
  catch (_) { return text(value); }
}
function birthValue(value) {
  const raw = text(value).trim();
  const dotted = /^([1-9]\d{3})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?$/.exec(raw);
  const birth = dotted
    ? `${dotted[1]}-${dotted[2].padStart(2, '0')}-${dotted[3].padStart(2, '0')}`
    : /^\d{8}$/.test(raw) ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}` : raw;
  if (/^[1-9]\d{3}$/.test(birth) && Number(birth) <= new Date().getFullYear()) return birth;
  const m = /^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(birth);
  if (!m) return '';
  const d = new Date(`${birth}T00:00:00Z`);
  return Number(m[1]) <= new Date().getFullYear() && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === birth ? birth : '';
}

// Pure conversion; the caller supplies a consistent snapshot of the normalized DB.
function convert(snapshot, origin, audience = 'all') {
  if (!/^[a-f0-9-]{36}$/.test(origin) || !['all', 'student', 'staff'].includes(audience)) throw new Error('이관 대상 설정을 확인해 주세요.');
  const data = Object.fromEntries(TABLES.map(key => [key, []]));
  let seq = 1;
  const people = new Map();
  const histories = new Map();
  for (const info of snapshot.students_info) {
    if (!histories.has(info.uid)) histories.set(info.uid, []);
    histories.get(info.uid).push(info);
  }
  const sourceFields = (table, row, identity = row.id) => ({
    migrationSource: 'school', migrationKey: hash([origin, table, identity]),
    migrationRevision: hash(row), schoolOriginal: JSON.stringify(row)
  });
  for (const type of ['student', 'staff']) {
    if (audience !== 'all' && audience !== type) continue;
    for (const row of snapshot[type === 'student' ? 'students' : 'staff']) {
      const key = `${type}:${row.uid}`;
      if (!row.uid || !text(row.name).trim() || people.has(key)) throw new Error('명단의 이름 또는 고유번호를 확인해 주세요.');
      const history = type === 'student' ? histories.get(row.uid) || [] : [];
      const latest = [...history].sort((a,b) => text(b.school_year).localeCompare(text(a.school_year)))[0] || {};
      const birth = birthValue(row.birth_date);
      const person = {
        id: seq++, name: text(row.name).trim(), birth,
        birthMissing: !birth, birthSource: birth ? 'school-export' : 'school-export-missing', needsReview: !birth,
        gender: ['남','남자','M'].includes(row.gender) ? '남' : ['여','여자','F'].includes(row.gender) ? '여' : '',
        company: '', memberType: '', dept: text(latest.department), empno: '', residentNumber: '', phone: '',
        job: type === 'staff' ? text(row.position) : '', officeType: '', employmentStatus: '', examdate: '', specialExamTarget: '', risks: [],
        note: joined('학교용에서 이관 · ' + (type === 'student' ? '학생' : '교직원'), latest.care_reason, latest.care_memo),
        etc: type === 'student' ? history.map(info => `${info.school_year}학년도 ${info.grade || ''}학년 ${info.class_num || ''}반 ${info.student_num || ''}번`).join('\n') : '',
        ...sourceFields(type, { ...row, schoolHistory: history }, row.uid)
      };
      people.set(key, person); data.subjects.push(person);
    }
  }
  const mappings = [ ['daily_records','journals'], ['counseling_records','counselings'], ['emergency_records','emergencies'], ['infection_records','infections'] ];
  let unlinked = 0;
  for (const [source, target] of mappings) for (const row of snapshot[source]) {
    if (audience !== 'all' && row.person_type !== audience) continue;
    const person = people.get(`${row.person_type}:${row.person_uid}`);
    if (!person) { unlinked++; continue; }
    const base = { id: seq++, ...sourceFields(source, row) };
    if (target === 'journals') data[target].push({ ...base, subjectId: person.id, name: person.name,
      date: text(row.visit_date), visitTime: text(row.time_in), type: '처치', method: '방문',
      symptom: SchoolTreatment.history(row).symptom,
      treatment: SchoolTreatment.format(row),
      status: text(row.result_code) || '이관 기록', recheck: '', medications: [] });
    if (target === 'counselings') data[target].push({ ...base, subjectId: person.id, date: text(row.counsel_date), visitTime: text(row.counsel_time),
      type: '상담', method: '', content: joined(row.counsel_type, row.counsel_reason, row.content, row.memo), action: text(row.follow_up), status: '이관 기록', recheck: '' });
    if (target === 'emergencies') data[target].push({ ...base, name: person.name, time: joined(row.accident_date, row.accident_time).replace('\n','T'),
      situation: joined(row.location, row.situation, row.summary, row.patient_status), aid: text(row.treatment), hospital: text(row.transport_dest), progress: joined(row.memo, row.transport_method) });
    if (target === 'infections') data[target].push({ ...base, name: person.name, disease: text(row.disease_name), date: text(row.onset_date || row.diag_date),
      symptom: joined(row.main_symptoms, row.other_symptoms), isolation: text(row.is_isolated), returnDate: text(row.actual_return || row.expected_return),
      progress: joined(row.situation_memo, row.additional_actions, row.additional_memo, row.memo, readable(row.progress_json)) });
  }
  if (unlinked) throw new Error(`명단과 연결되지 않은 기록이 ${unlinked}건 있습니다. 학교용에서 대상자를 연결한 후 다시 내보내 주세요.`);
  if (!data.subjects.length) throw new Error('선택한 대상의 명단이 없습니다.');
  data.seq = seq;
  return { app: 'orange-talk-healthlog', formatVersion: 1, exportedAt: new Date().toISOString(),
    migration: { source: 'school', version: 1, audience, missingBirth: data.subjects.filter(p => p.birthMissing).length,
      notice: '명단·보건일지·상담·응급·감염병 기록을 이관합니다. 약품 재고·설문·검진·첨부파일·환경설정은 포함하지 않습니다. 원본 세부 항목은 각 기록에 보존됩니다.' }, data };
}

function snapshotDatabase(db) {
  return db.transaction(() => Object.fromEntries(
    ['students','students_info','staff','daily_records','counseling_records','emergency_records','infection_records']
      .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
  ))();
}
module.exports = { convert, snapshotDatabase, birthValue };
