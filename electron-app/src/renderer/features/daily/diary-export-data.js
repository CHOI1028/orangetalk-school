/* Pure print serializers: never change a saved record or assign legacy data to a symptom. */
const text = value => value == null ? '' : String(value);
const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : (text(value) ? [text(value)] : []);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function diaryVitalsHistory(record) {
  const r = record || {};
  const normalize = row => ({...row, resp:text(row.resp).trim() ? row.resp : row.respiration});
  const hasValues = row => ['temp','bp','pulse','resp','spo2','bst'].some(key => text(row[key]).trim());
  let history = (Array.isArray(r.vsHistory) ? r.vsHistory : [])
    .filter(row => row && typeof row === 'object' && !Array.isArray(row)).map(normalize).filter(hasValues);
  const single = normalize({...r, t:r.timeIn || ''});
  if (!history.length && hasValues(single)) history = [single];
  const minutes = row => {
    const m = text(row.t).match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : Infinity;
  };
  return history.sort((a,b) => minutes(a)-minutes(b));
}

export function diaryVitalsText(record) {
  const labels = [['temp','체온'],['bp','혈압'],['pulse','맥박'],['resp','호흡'],['spo2','SpO₂'],['bst','BST']];
  const values = row => labels.map(([key, label]) => {
    const value = text(row[key]).trim();
    return value ? label + ' ' + value : '';
  }).filter(Boolean);
  const lines = diaryVitalsHistory(record)
    .map(row => '[' + (text(row.t) || '-') + '] ' + values(row).join(', '));
  return lines.length ? (lines.length > 1 ? '[시간대별 V/S]' : '[V/S]') + '\n' + lines.join('\n') : '';
}

export function diaryTreatmentText(record, helpers) {
  const r = record || {};
  const format = helpers.formatMedicationDisplay;
  const treatments = list(r.treatment);
  const symptoms = list(r.symptoms);
  const bySym = object(r.treatmentBySym);
  const medsBySym = object(r.medsBySym);
  const doseBySym = object(r.medDosesBySym);
  const memo = text(r.treatmentMemo);
  const medication = r.medication ? format(text(r.medication)) : '';
  const base = value => text(value).replace(/\s*\(.*\)\s*$/, '').trim();
  const mappedTreatments = new Set();
  const mappedMedication = [];
  const symptomText = symptom => {
    const items = list(bySym[symptom]);
    items.forEach(value => mappedTreatments.add(value));
    const doses = object(doseBySym[symptom]);
    const meds = list(medsBySym[symptom]).map(name => {
      const dose = text(doses[name]);
      return dose ? name + '(' + dose + ')' : name;
    });
    const med = meds.length ? format(meds.join(', ')) : '';
    if (med) mappedMedication.push(med);
    const result = items.map(value => base(value) === '투약' && med ? med : value);
    if (med && !items.some(value => base(value) === '투약')) result.push(med);
    return result;
  };
  const keys = Object.keys(bySym);
  const hasMapping = keys.length || Object.keys(medsBySym).length;
  if (symptoms.length > 1 && hasMapping && r.treatmentBranched !== false) {
    const counsel = helpers.counselTreatText(r);
    const counselIndex = counsel ? symptoms.findIndex(helpers.isCounselSymLabel) : -1;
    const lines = symptoms.map((symptom, index) => {
      const items = symptomText(symptom);
      if (index === counselIndex && !items.includes(counsel)) items.push(counsel);
      return '→ ' + items.join(', ');
    });
    // Preserve records whose old flat fields are only partially represented by the symptom map.
    const other = treatments.filter(value => !mappedTreatments.has(value) && value !== counsel
      && !(base(value) === '투약' && mappedMedication.length));
    const orphanKeys = [...new Set([...keys, ...Object.keys(medsBySym)])].filter(key => !symptoms.includes(key));
    orphanKeys.forEach(key => other.push(...symptomText(key)));
    if (medication && !mappedMedication.includes(medication) && mappedMedication.join(', ') !== medication) other.push(medication);
    if (memo) other.push(memo);
    if (other.length) lines.push('공통·이전 기록: ' + [...new Set(other)].join(' / '));
    return lines.join('\n');
  }
  const result = treatments.map(value => base(value) === '투약' && medication ? medication : value);
  if (medication && !treatments.some(value => base(value) === '투약')) result.push(medication);
  // Map-only records also occur in imported/older diaries. Keep their contents without mutating the record.
  [...new Set([...keys, ...Object.keys(medsBySym)])].forEach(key => {
    symptomText(key).forEach(value => { if (!result.includes(value)) result.push(value); });
  });
  if (memo) result.push(memo);
  return result.join(' / ');
}

export function diarySummary(stats, scope = 'legacy') {
  if (!stats || !Array.isArray(stats.sections) || !stats.sections.length) return null;
  if (scope !== 'all' && scope !== 'students') return stats;
  const [students, staff, all] = stats.sections;
  if (!students || !Array.isArray(students.header)) return null;
  const header = students.header.slice();
  header[0] = '구분';
  const rows = (students.rows || []).map(row => row.slice());
  let totals = students.totalsRow && students.totalsRow.slice();
  if (scope !== 'students') {
    (staff && staff.rows || []).forEach(row => rows.push(row.slice()));
    const totalRow = all && all.rows && all.rows[0];
    totals = totalRow ? totalRow.slice() : header.map((_, i) => i ? rows.reduce((n, row) => n + (Number(row[i]) || 0), 0) : '합계');
  }
  if (totals) totals[0] = '합계';
  return {colCount:header.length, sections:[{
    title:scope === 'students' ? '학생 방문 집계' : '학생·교직원 방문 집계',
    header, rows, ...(totals ? {totalsRow:totals} : {})
  }]};
}
