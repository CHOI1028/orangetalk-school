(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SchoolTreatment = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  const text = value => value == null ? "" : String(value);
  const isPlainObject = value => value && typeof value === "object" && !Array.isArray(value);
  const join = (...values) => values.filter(Boolean).map(value => text(value).trim()).filter(Boolean).join("\n");

  function parse(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }

  function readable(value) {
    const data = parse(value);
    if (Array.isArray(data)) {
      return data.map(readable).filter(Boolean).map(item => text(item).trim()).filter(Boolean).join(", ");
    }
    if (isPlainObject(data)) {
      return Object.entries(data)
        .map(([key, item]) => {
          const body = readable(item);
          return body ? `${text(key)}: ${body}` : "";
        })
        .filter(Boolean)
        .join(", ");
    }
    return text(data).trim();
  }

  function toLines(value) {
    const data = parse(value);
    if (Array.isArray(data)) return data.flatMap(toLines).filter(Boolean);
    if (isPlainObject(data)) {
      return Object.entries(data)
        .flatMap(([key, item]) => {
          const rendered = toLines(item);
          return rendered.length ? rendered.map(line => `${text(key)}: ${line}`) : [text(key).trim()];
        })
        .filter(Boolean);
    }
    return text(data).trim() ? [text(data).trim()] : [];
  }

  function legacy(row) {
    const oldReadable = value => {
      if (!value) return "";
      const data = parse(value);
      return Array.isArray(data) ? data.map(item => text(item)).join(", ") : text(value);
    };
    return join(
      oldReadable(row.treatment),
      row.medication && `투약 기록: ${row.medication}`,
      row.memo,
      row.extra_json && row.extra_json !== "{}" && `학교용 추가 기록: ${row.extra_json}`,
      row.treatment_by_sym && `증상별 처치: ${row.treatment_by_sym}`,
      row.physical_assessment && `신체사정: ${row.physical_assessment}`
    );
  }

  function addLine(lines, seen, label, value) {
    const body = readable(value);
    if (!body) return;
    const key = `${label}::${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`${label}: ${body}`);
  }

  function previousFormat(row) {
    const extra = parse(row.extra_json);
    const info = isPlainObject(extra) ? extra : {};
    const treatmentBySymptom = parse(row.treatment_by_sym);
    const lines = [];
    const seen = new Set();
    const usedMedications = new Set();

    if (isPlainObject(treatmentBySymptom)) {
      for (const [symptom, value] of Object.entries(treatmentBySymptom)) {
        const rendered = join(...toLines(value));
        addLine(lines, seen, symptom === "__flat__" ? "처치" : `${symptom} 처치`, rendered);
      }
    }

    addLine(lines, seen, "처치", row.treatment);

    const medicationsBySymptom = isPlainObject(info.meds_by_sym) ? info.meds_by_sym : {};
    const dosesBySymptom = isPlainObject(info.med_doses_by_sym) ? info.med_doses_by_sym : {};
    for (const [symptom, values] of Object.entries(medicationsBySymptom)) {
      const itemList = Array.isArray(values) ? values : [values];
      const doses = isPlainObject(dosesBySymptom[symptom]) ? dosesBySymptom[symptom] : {};
      const merged = itemList
        .flatMap(item => toLines(item))
        .filter(Boolean)
        .map(item => {
          const medName = text(item).trim();
          if (!medName) return "";
          usedMedications.add(medName);
          const dose = doses[medName] || doses[text(item)] || "";
          return join(medName, dose ? `(${readable(dose)})` : "");
        })
        .filter(Boolean);

      if (merged.length) {
        addLine(lines, seen, symptom === "__flat__" ? "투약" : `${symptom} 투약`, merged);
      }
    }

    const legacyMedication = text(row.medication).trim();
    if (legacyMedication) {
      const legacyList = toLines(legacyMedication);
      const hasUnknown = legacyList.some(med => !usedMedications.has(text(med).trim()));
      if (hasUnknown) {
        addLine(lines, seen, "투약 기록", legacyMedication);
      }
    }

    addLine(lines, seen, "처치 메모", info.treatment_memo);
    addLine(lines, seen, "메모", row.memo);
    addLine(lines, seen, "신체사정", row.physical_assessment);
    return lines.join("\n");
  }

  // Keep previousFormat to recognize untouched records exported by earlier versions.
  function summaryFormat(row) {
    const extra = parse(row.extra_json);
    const info = isPlainObject(extra) ? extra : {};
    const lines = [];
    const seen = new Set();
    const normalize = value => text(value).replace(/\s+/g, '').trim();
    const treatments = parse(row.treatment_by_sym);
    const coveredTreatments = new Set();
    const list = value => {
      const data = parse(value);
      if (Array.isArray(data)) return data.map(readable).filter(Boolean);
      // Commas inside parentheses belong to the text, not list separators.
      const result = [];
      let depth = 0, part = '';
      for (const char of readable(data)) {
        if ('(（['.includes(char)) depth++;
        if (')）]'.includes(char)) depth = Math.max(0, depth - 1);
        if ((char === ',' || char === '\n') && depth === 0) {
          if (part.trim()) result.push(part.trim());
          part = '';
        } else part += char;
      }
      if (part.trim()) result.push(part.trim());
      return result;
    };
    if (isPlainObject(treatments)) {
      for (const [symptom, value] of Object.entries(treatments)) {
        if (symptom === '__flat__') continue;
        const items = list(value);
        items.forEach(item => coveredTreatments.add(normalize(item)));
        addLine(lines, seen, `${symptom} 처치`, [...new Set(items)]);
      }
    }
    const remaining = [...list(isPlainObject(treatments) ? treatments.__flat__ : ''), ...list(row.treatment)]
      .filter(item => !coveredTreatments.has(normalize(item)));
    addLine(lines, seen, '처치', [...new Set(remaining)]);

    const meds = parse(info.meds_by_sym);
    const doses = parse(info.med_doses_by_sym);
    const coveredMeds = new Set();
    if (isPlainObject(meds)) {
      for (const [symptom, values] of Object.entries(meds)) {
        if (symptom === '__flat__') continue;
        const rendered = list(values).map(name => {
          const dose = isPlainObject(doses?.[symptom]) ? readable(doses[symptom][name]) : '';
          const item = dose ? `${name} (${dose})` : name;
          coveredMeds.add(normalize(name));
          coveredMeds.add(normalize(item));
          return item;
        });
        addLine(lines, seen, `${symptom} 투약`, [...new Set(rendered)]);
      }
    }
    const remainingMeds = [...list(isPlainObject(meds) ? meds.__flat__ : ''), ...list(row.medication)]
      .filter(item => !coveredMeds.has(normalize(item)));
    addLine(lines, seen, '투약 기록', [...new Set(remainingMeds)]);
    addLine(lines, seen, '처치 메모', info.treatment_memo);
    addLine(lines, seen, '메모', row.memo);
    addLine(lines, seen, '신체사정', row.physical_assessment);
    return lines.join('\n');
  }

  // Plain-text equivalents of the school's visit-history left/right columns.
  // Respect active symptoms and flat/branched mode: old map keys can be stale.
  function history(row) {
    const extra = parse(row.extra_json);
    const info = isPlainObject(extra) ? extra : {};
    const array = value => {
      const data = parse(value);
      return Array.isArray(data) ? data.map(text) : data ? [text(data)] : [];
    };
    const symptoms = array(row.symptoms);
    const parsedTreatments = parse(row.treatment);
    const common = Array.isArray(parsedTreatments) ? parsedTreatments.map(text)
      : text(row.treatment).split(',').filter(Boolean);
    const parsedMap = parse(row.treatment_by_sym);
    const map = isPlainObject(parsedMap) ? parsedMap : {};
    const meds = isPlainObject(info.meds_by_sym) ? info.meds_by_sym : {};
    const doses = isPlainObject(info.med_doses_by_sym) ? info.med_doses_by_sym : {};
    const branched = !row.is_imported && info.treatment_branched !== false && symptoms.length >= 2
      && (Object.keys(map).length > 0 || common.length === 0);
    const symptomLabel = value => {
      const match = text(value).match(/^(.+?)\s*\((.*)\)\s*$/);
      return match ? `${match[1].trim()}[${match[2]}]` : text(value);
    };
    const medDisplay = value => {
      if (!text(value).trim()) return '';
      const items = text(value).split(',').map(item => item.trim()).filter(Boolean).map(item => {
        const match = item.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        return match && /^[\d.]/.test(match[2].trim()) ? `${match[1].trim()} (${match[2].trim()})` : item;
      });
      return `투약[${items.join(', ')}]`;
    };
    const vitals = [['body_temp', 'T'], ['blood_pressure', 'BP'], ['pulse', 'P'],
      ['respiration', 'R'], ['spo2', 'SpO₂'], ['bst', 'BST']]
      .filter(([key]) => row[key]).map(([key, label]) => `${label}: ${row[key]}`).join(', ');
    const labelTreatment = (item, medication, useBase) => {
      const match = useBase && item.match(/^(.+?)\s*\((.*)\)\s*$/);
      const base = match ? match[1].trim() : item;
      if (base === '투약' && medication) return medication;
      if (base === 'V/S 측정' && vitals) return `V/S 측정 (${vitals})`;
      return item;
    };
    const memo = text(info.treatment_memo);
    if (!branched) {
      const body = common.map(item => labelTreatment(item, medDisplay(row.medication), false)).join(', ');
      return { symptom: symptoms.map(symptomLabel).join(', ') || '-',
        treatment: (body + (memo ? (body ? ' / ' : '') + memo : '')) || '-' };
    }
    const counsel = text(info.counsel_log?.treatmentText).trim();
    const counselIndex = counsel ? symptoms.findIndex(symptom => text(symptom).split('[')[0].split('(')[0].trim() === '상담') : -1;
    const right = symptoms.map((symptom, index) => {
      const medication = medDisplay(array(meds[symptom]).map(name => {
        const dose = doses[symptom]?.[name] || '';
        return dose ? `${name}(${dose})` : name;
      }).join(', '));
      const items = array(map[symptom]).map(item => labelTreatment(item, medication, true));
      if (index === counselIndex && !items.includes(counsel)) items.push(counsel);
      return items.join(', ') || '-';
    });
    if (memo) right.push(memo);
    return { symptom: symptoms.map(symptomLabel).join('\n'), treatment: right.join('\n') };
  }

  function format(row) { return history(row).treatment; }

  function displaySymptom(record) {
    const current = text(record.symptom);
    if (record.migrationSource !== 'school' || !record.schoolOriginal) return current;
    const row = parse(record.schoolOriginal);
    if (!isPlainObject(row)) return current;
    const old = join(readable(row.symptoms), row.body_temp && '체온: ' + row.body_temp,
      row.blood_pressure && '혈압: ' + row.blood_pressure, row.pulse && '맥박: ' + row.pulse,
      row.respiration && '호흡: ' + row.respiration, row.spo2 && '산소포화도: ' + row.spo2, row.bst && '혈당: ' + row.bst);
    return current === old ? history(row).symptom : current;
  }

  function display(record) {
    const current = text(record.treatment);
    if (record.migrationSource !== "school" || !record.schoolOriginal) return current;
    const original = parse(record.schoolOriginal);
    if (!original || typeof original !== "object") return current;
    // Only reformat exact generated versions; preserve any locally edited text.
    return current === legacy(original) || current === previousFormat(original) || current === summaryFormat(original)
      ? format(original) : current;
  }

  return { format, history, legacy, display, displaySymptom };
});
