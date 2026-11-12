/* Shared by the survey editor, response page and server. No student data belongs in a definition. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrangeSurvey = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const TYPES = ['short_text','paragraph','radio','dropdown','checkbox','grid_radio','grid_text','star','scale','date_cal','date_text','time_clock','time_text'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = o => o && typeof o === 'object' && !Array.isArray(o);
  const blank = v => v == null || v === '' || (Array.isArray(v) && !v.length);
  function questions(d) { return (d.preQuestions || []).concat(...d.sections.map(s => s.questions)); }
  function validateDefinition(d) {
    if (!object(d) || typeof d.title !== 'string' || !d.title.trim()) throw new Error('설문 제목을 입력하세요.');
    if (!Array.isArray(d.sections) || !d.sections.length || d.sections.length > 100) throw new Error('설문 섹션을 확인하세요.');
    if (d.preQuestions != null && !Array.isArray(d.preQuestions)) throw new Error('서두 문항을 확인하세요.');
    for (const s of d.sections) if (!object(s) || !Array.isArray(s.questions)) throw new Error('섹션 문항을 확인하세요.');
    const all = questions(d), ids = new Set();
    if (!all.length || all.length > 500) throw new Error('문항은 1~500개로 구성해 주세요.');
    for (const q of all) {
      if (!object(q) || !(typeof q.id==='string'||(Number.isSafeInteger(q.id)&&q.id>=0)) || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(q.id)) || ['__proto__','constructor','prototype'].includes(String(q.id)) || ids.has(String(q.id))) throw new Error('문항 ID가 잘못되었거나 중복됩니다.');
      ids.add(String(q.id));
      if (typeof q.text !== 'string' || !q.text.trim() || !TYPES.includes(q.type)) throw new Error('질문 내용과 문항 형식을 확인하세요.');
      if (['radio','dropdown','checkbox','star','scale'].includes(q.type)) {
        if (!Array.isArray(q.options) || !q.options.length || q.options.length > 100 || q.options.some(x => typeof x !== 'string' || !x.trim()) || new Set(q.options).size !== q.options.length) throw new Error('빈 선택지 또는 중복 선택지를 수정하세요.');
      }
      if (q.type.startsWith('grid_')) {
        for (const key of ['gridRows','gridCols']) if (!Array.isArray(q[key]) || !q[key].length || q[key].length > 50 || q[key].some(x => typeof x !== 'string' || !x.trim())) throw new Error('표의 행과 열을 확인하세요.');
      }
    }
    for (const key of ['startDate','endDate']) if (d[key] && !validDate(d[key])) throw new Error('설문 기간을 확인하세요.');
    if(d.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.endTime)) throw new Error('마감 시간을 확인하세요.');
    if (d.startDate && d.endDate && d.startDate > d.endDate) throw new Error('마감일은 시작일 이후여야 합니다.');
    d.sections.forEach((s, si) => s.questions.forEach(q => {
      if (!q.sectionJump) return;
      if (!['radio','dropdown'].includes(q.type)) throw new Error('섹션 이동은 단일 선택 문항에서만 사용할 수 있습니다.');
      for (const [key,value] of Object.entries(q.jumpMap || {})) {
        if(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=q.options.length) throw new Error('섹션 이동의 선택지를 확인하세요.');
        if (value === '' || value === 'end') continue;
        const n = Number(value);
        if (!Number.isInteger(n) || n <= si || n >= d.sections.length) throw new Error('섹션 이동은 뒤쪽 섹션 또는 설문 제출로 설정하세요.');
      }
    }));
    return d;
  }
  function validDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const date = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === v;
  }
  function nextSection(d, index, answers) {
    for (const q of d.sections[index].questions) {
      if (!q.sectionJump) continue;
      const oi = (q.options || []).indexOf(answers[String(q.id)]);
      if(oi<0)continue;
      const jump = (q.jumpMap || {})[oi];
      if (jump === 'end') return d.sections.length;
      if (jump !== undefined && jump !== '') return Number(jump);
    }
    return index + 1;
  }
  function visibleQuestions(d, answers) {
    const out = (d.preQuestions || []).slice(), visited = new Set();
    for (let i = 0; i < d.sections.length;) {
      if (!Number.isInteger(i) || i < 0 || visited.has(i)) throw new Error('설문 섹션 이동 설정을 확인하세요.');
      visited.add(i); out.push(...d.sections[i].questions); i = nextSection(d, i, answers);
    }
    return out;
  }
  function validateAnswer(q, v) {
    if (blank(v)) { if(q.required) throw new Error(q.text + ': 필수 응답입니다.'); return; }
    const invalid = () => { throw new Error(q.text + ': 응답 형식을 확인하세요.'); };
    const text = x => typeof x === 'string' && x.length <= 10000;
    const choice = x => text(x) && (q.options.includes(x) || (q.hasOther && x.startsWith('기타: ') && x.slice(4).trim()));
    if (['radio','dropdown','star','scale'].includes(q.type)) { if(!choice(v)) invalid(); }
    else if (q.type === 'checkbox') { if(!Array.isArray(v) || v.length > q.options.length + 1 || new Set(v).size !== v.length || !v.every(choice)) invalid(); }
    else if (q.type === 'grid_radio') {
      if (!object(v) || Object.keys(v).some(k => !/^\d+$/.test(k) || Number(k) >= q.gridRows.length)) invalid();
      q.gridRows.forEach((_, i) => { if(blank(v[i])) { if(q.required) invalid(); } else if(!q.gridCols.includes(v[i])) invalid(); });
    } else if (q.type === 'grid_text') {
      if (!object(v)) invalid();
      for(const k of Object.keys(v)) { const parts = k.split(':').map(Number); if(!/^\d+:\d+$/.test(k) || parts[0] >= q.gridRows.length || parts[1] >= q.gridCols.length || !text(v[k])) invalid(); }
      if(q.required) q.gridRows.forEach((_, ri) => q.gridCols.forEach((__, ci) => { if(!v[ri+':'+ci] || !v[ri+':'+ci].trim()) invalid(); }));
    } else if (!text(v)) invalid();
    else if (q.type.startsWith('date_') && !validDate(v)) invalid();
    else if (q.type.startsWith('time_') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) invalid();
    else if (q.required && !v.trim()) invalid();
  }
  function validateResponses(d, answers) {
    validateDefinition(d);
    if (!object(answers)) throw new Error('응답을 확인하세요.');
    const result = {};
    for (const q of visibleQuestions(d, answers)) {
      const v = own(answers, String(q.id)) ? answers[String(q.id)] : undefined;
      validateAnswer(q, v);
      if (!blank(v)) result[String(q.id)] = v;
    }
    return result;
  }
  return { TYPES, questions, validateDefinition, validateAnswer, validateResponses, visibleQuestions, nextSection, validDate };
});
