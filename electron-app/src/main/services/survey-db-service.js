/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');

/**
 * survey-db-service.js — 설문 관련 DB 서비스 모음
 *
 * SurveyFormService — 설문 양식 CRUD (DB 메타 + JSON 파일)
 * SurveyResponseService — 설문 응답 CRUD (DB JSON 텍스트)
 * SurveyDefinitionService — 설문 기본 템플릿 생성 (stateless)
 */

/* ══════════ SurveyFormService ══════════ */

class SurveyFormService {
  constructor(healthDB, folders) {
    this._db = healthDB;
    this._folders = folders;
  }

  list() {
    return this._db.stmt.surveyFormGetAll.all();
  }

  get(formId) {
    const meta = this._db.stmt.surveyFormGetById.get(formId);
    if (!meta) return null;
    const filePath = this._folders.surveyFormPath(meta.file_name);
    const content = this._folders.readJson(filePath);
    return { meta, content };
  }

  save(form, content) {
    const now = this._db.now();
    this._db.stmt.surveyFormUpsert.run({
      id: form.id,
      parent_id: form.parent_id || null,
      title: form.title || '',
      version: form.version || 1,
      file_name: form.file_name,
      is_default: form.is_default ? 1 : 0,
      created_at: form.created_at || now,
      updated_at: now,
    });
    if (content) {
      this._folders.writeJson(this._folders.surveyFormPath(form.file_name), content);
    }
    return { success: true };
  }

  copy(sourceFormId, newId, newTitle) {
    const source = this._db.stmt.surveyFormGetById.get(sourceFormId);
    if (!source) return null;

    const now = this._db.now();
    const newFileName = newId + '.json';
    const sourceContent = this._folders.readJson(this._folders.surveyFormPath(source.file_name));

    if (sourceContent) {
      sourceContent.formId = newId;
      sourceContent.formVersion = newId + '-v1';
      if (newTitle) sourceContent.formTitle = newTitle;
      this._folders.writeJson(this._folders.surveyFormPath(newFileName), sourceContent);
    }

    this._db.stmt.surveyFormUpsert.run({
      id: newId,
      parent_id: sourceFormId,
      title: newTitle || source.title + ' (복사본)',
      version: 1,
      file_name: newFileName,
      is_default: 0,
      created_at: now,
      updated_at: now,
    });

    return { success: true, newId, newFileName };
  }

  delete(formId) {
    const meta = this._db.stmt.surveyFormGetById.get(formId);
    if (meta) {
      const filePath = this._folders.surveyFormPath(meta.file_name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    this._db.stmt.surveyFormDelete.run(formId);
    return { success: true };
  }
}

/* ══════════ SurveyResponseService ══════════ */

class SurveyResponseService {
  constructor(healthDB) {
    this._db = healthDB;
  }

  getByStudent(persistentId) {
    return this._db.stmt.surveyRespGetByStudent.all(persistentId);
  }

  getByForm(year, formId) {
    const yr = year || String(new Date().getFullYear());
    return this._db.stmt.surveyRespGetByForm.all(yr, formId);
  }

  getAllWithData(year, formId) {
    const yr = year || String(new Date().getFullYear());
    const rows = this._db.stmt.surveyRespGetAllWithData.all(yr, formId);
    return rows.map(r => {
      try { return { ...r, response_data: JSON.parse(r.response_data || '{}') }; }
      catch (_) { return { ...r, response_data: {} }; }
    });
  }

  getData(id) {
    const row = this._db.stmt.surveyRespGetDataById.get(id);
    if (!row) return null;
    try { row.response_data = JSON.parse(row.response_data || '{}'); }
    catch (_) { row.response_data = {}; }
    return row;
  }

  _assertSafeObject(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('유효하지 않은 객체');
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of Object.keys(obj)) {
      if (dangerousKeys.includes(key)) {
        throw new Error('허용되지 않은 키: ' + key);
      }
    }
  }

  save(response, content) {
    if (!response || typeof response !== 'object') {
      throw new Error('응답 객체가 유효하지 않습니다');
    }
    this._assertSafeObject(response);
    const now = this._db.now();
    const r = response;
    if (!r.form_id) throw new Error('form_id는 필수입니다');
    if (!r.student_name || String(r.student_name).trim() === '') {
      throw new Error('학생 이름은 필수입니다');
    }
    const yr = r.school_year || String(new Date().getFullYear());
    const responseJson = content ? JSON.stringify(content) : (r.response_data || '{}');
    this._db.stmt.surveyRespUpsert.run({
      school_year: yr,
      form_id: r.form_id,
      form_version: r.form_version || 1,
      /* 스키마 컬럼명은 person_uid — 옛 student_id 키로 넘기면 named param 불일치로 예외 (2026-08-27 수정) */
      person_uid: r.person_uid || r.student_id || null,
      student_persistent_id: r.student_persistent_id || (r.student_name + '_' + (r.birth_date || '')),
      student_name: r.student_name,
      birth_date: r.birth_date || '',
      grade: r.grade || null,
      class_num: r.class_num || null,
      student_num: r.student_num || null,
      responded_at: r.responded_at || now,
      response_data: responseJson,
      status: r.status || 'completed',
      created_at: now,
    });
    return { success: true };
  }

  importBatch(year, formId, responses) {
    const now = this._db.now();
    const yr = year || String(new Date().getFullYear());
    const upsert = this._db.stmt.surveyRespUpsert;

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const importTx = this._db.db.transaction((items) => {
      let count = 0;
      for (const r of items) {
        if (!r || typeof r !== 'object') continue;
        if (Object.keys(r).some(k => dangerousKeys.includes(k))) continue;
        const pid = r.student_persistent_id
          || r.persistentId
          || ((r.student_name || r.name || '') + '_' + (r.birth_date || r.birthDate || ''));
        const name = r.student_name || r.name || '';
        if (!name || !pid) continue;
        upsert.run({
          school_year: yr,
          form_id: formId,
          form_version: r.form_version || 1,
          /* 스키마 컬럼명은 person_uid — 옛 student_id 키로 넘기면 named param 불일치로 예외 (2026-08-27 수정) */
          person_uid: r.person_uid || r.personUid || r.student_id || null,
          student_persistent_id: pid,
          student_name: name,
          birth_date: r.birth_date || r.birthDate || '',
          grade: r.grade || null,
          class_num: r.class_num || r.classNum || null,
          student_num: r.student_num || r.studentNum || null,
          responded_at: r.responded_at || r.submittedAt || now,
          response_data: JSON.stringify(r.responses || r.data || r),
          status: r.status || 'completed',
          created_at: now,
        });
        count++;
      }
      return count;
    });

    const arr = Array.isArray(responses) ? responses : [responses];
    const count = importTx(arr);
    return { success: true, count };
  }

  delete(id) {
    this._db.stmt.surveyRespDelete.run(id);
    return { success: true };
  }

  getResponseStats(year, formId) {
    const yr = year || String(new Date().getFullYear());
    const people = this._db.stmt.siGetByYear.all(yr);
    const responses = this._db.stmt.surveyRespByForm.all(yr, formId);

    const respondedSet = new Set(responses.map(r => r.student_persistent_id || r.student_id));

    const gradeGroups = {};
    people.forEach(s => {
      if (s.type !== 'student' && s.type !== undefined) return;
      const g = s.grade || '?';
      if (!gradeGroups[g]) gradeGroups[g] = { grade: g, total: 0, responded: 0 };
      gradeGroups[g].total++;
      if (respondedSet.has(s.uid)) gradeGroups[g].responded++;
    });
    const gradeSummaries = Object.keys(gradeGroups).sort((a, b) => a - b).map(g => {
      const gd = gradeGroups[g];
      return { grade: g, total: gd.total, responded: gd.responded, rate: gd.total ? Math.round(gd.responded / gd.total * 100) : 0 };
    });

    const classMap = {};
    people.forEach(s => {
      if (s.type !== 'student' && s.type !== undefined) return;
      const k = (s.grade || '?') + '-' + (s.class_num || '?');
      if (!classMap[k]) classMap[k] = { grade: s.grade, cls: s.class_num, total: 0, responded: 0 };
      classMap[k].total++;
      if (respondedSet.has(s.uid)) classMap[k].responded++;
    });
    const classGroups = Object.keys(classMap).sort().map(k => {
      const c = classMap[k];
      return { key: k, grade: c.grade, cls: c.cls, total: c.total, responded: c.responded, rate: c.total ? Math.round(c.responded / c.total * 100) : 0 };
    });

    return { gradeSummaries, classGroups };
  }

  getMissingStudentsMessage(year, formId, grade, cls, position, name) {
    const yr = year || String(new Date().getFullYear());
    const people = this._db.stmt.siGetByYear.all(yr);
    const responses = this._db.stmt.surveyRespByForm.all(yr, formId);
    const respondedSet = new Set(responses.map(r => r.student_persistent_id || r.student_id));

    const missing = people
      .filter(s => {
        const isStudent = s.type === 'student' || s.type === undefined;
        const matchGrade = Number(s.grade) === Number(grade);
        /* 반: 한글 학급명(가람·나래) 지원 — Number 비교 시 NaN 으로 매칭 실패하므로 문자열 비교 (사용자 요청 2026-05-28). */
        const matchCls = String(s.class_num) === String(cls);
        const notResponded = !respondedSet.has(s.persistent_id) && !respondedSet.has(s.id);
        return isStudent && matchGrade && matchCls && notResponded;
      })
      .sort((a, b) => (a.student_num || 0) - (b.student_num || 0));

    let msg = '안녕하세요. ' + (position || '보건교사') + ' ' + (name || '') + '입니다.\n\n';
    msg += '며칠 전 실시한 「학생 건강 조사 설문」에 대한 응답을 아직 제출하지 않은 학생이 있습니다:\n\n';
    missing.forEach(s => { msg += (s.student_num || '') + '번 ' + (s.name || '') + '\n'; });
    msg += '\n학기 초에 바쁘시겠지만 위 학생들이 건강 조사를 조속히 할 수 있도록 한 번 상기시켜주시기 부탁드립니다.\n감사합니다.';

    return { missing: missing.map(s => ({ id: s.id, name: s.name, num: s.student_num })), message: msg };
  }
}

/* ══════════ SurveyDefinitionService ══════════ */

class SurveyDefinitionService {
  createDefaultDraft(input) {
    const schoolName = (input && input.schoolName) || 'OO고등학교';
    const year = Number((input && input.year) || new Date().getFullYear());
    const nextYear = year + 1;
    const retentionDate = nextYear + '-02-' + new Date(nextYear, 2, 0).getDate();

    const personalInfoDesc = schoolName + '는 『개인정보보호법』 제15조, 제17조, 제23조 및 제24조에 근거하여 개인정보를 수집·이용하거나 제3자에게 제공하고자 하는 경우에는 본인의 동의를 받고 있습니다. 학생건강관리 및 생활지도를 위한 목적으로 활용하기 위하여 본교는 최소한의 정보만을 수집하며 해당 목적 외로 이용하지 않으며 『학교보건법』 제7조, 『응급의료에 관한 법률 제3조』에 의거 비밀을 절대 보장합니다. 또한 법령에서 구체적으로 주민등록번호의 처리를 요구하거나 허용한 경우가 아닌 경우에는 주민등록번호를 처리하지 않습니다. 정보 주체가 되는 귀하께서는 아래 내용을 자세히 읽어보시고 모든 내용을 이해하신 후에 동의여부를 결정하여 주시기 바랍니다.\n\n가. 개인정보 수집·이용 목적\n - 성장기 학생들의 건강생활습관 및 신체적·정신적 건강상태를 파악\n - 조기 발견 · 치료 등 건강한 삶 도모에 기여\n - 응급 처치, 학부모 인계 및 119 구조대 이송\n - 건강문제 등 유소견 학생에 대해서 교육 및 건강 상담, 치료 및 보호 등 적절한 대책 강구\n\n나. 수집하는 개인정보 항목\n - 학생 학반·번호·성명·성별·연락처, 보호자 성명·연락처·학생과 관계\n\n다. 보유기간: ' + retentionDate + ' (보유 기간 이후 지체없이 파기)\n\n라. 개인정보 수집 동의 거부의 권리\n - 귀하께서는 개인정보 수집·이용에 동의하지 않으실 수 있습니다. 동의 거부시에도 학생이 학교 생활은 가능하나 미동의로 인해 건강상 적절한 보호와 대처를 받는데 지장이 초래될 수 있습니다.';
    const sensitiveInfoDesc = '가. 민감정보 수집·이용 목적\n - 위와 동일\n\n나. 수집하는 민감정보 항목\n - 건강 등에 관한 정보 (개인 병력, 가족력, 예방접종력, 신체적 정신적 건강 상태, 건강생활습관 등)\n\n다. 보유기간: ' + retentionDate + ' (보유 기간 이후 지체없이 파기)\n\n라. 개인정보 수집 동의 거부의 권리\n - 귀하께서는 민감정보 수집·이용에 동의하지 않으실 수 있습니다. 동의 거부시에도 학생이 학교 생활은 가능하나 미동의로 인해 건강상 적절한 보호와 대처를 받는데 지장이 초래될 수 있습니다.';
    const emergencyDesc = '학교내에서 귀하의 자녀에게 응급상황이 발생 시, 병원 의뢰가 필요한 경우 <응급증상 및 이에 준하는 증상> 등으로 위급하거나 위독할 때를 제외하고는 보호자께 연락하여 인계함을 원칙으로 합니다. 단, 응급상황이거나 연락이 안될 경우 인근 병원으로 119 구조대를 통해 이송함에 동의합니다. 응급처치동의의 경우 자필 서명이 필요한 관계로 별도로 수집하겠습니다.';

    return {
      title: year + ' ' + schoolName + ' 건강정보 조사',
      desc: '',
      nextId: 60,
      sections: [
        { id: 's1', title: '개인정보 수집·이용 동의', desc: personalInfoDesc, questions: [
          { id: 1, text: '위와 같이 개인정보를 수집·이용하는데 동의하십니까?', type: 'radio', required: true, options: ['동의함', '동의하지 않음'], sectionJump: true, jumpMap: { 0: '', 1: 'end' }, shortLabel: '개인정보 동의' }
        ] },
        { id: 's2', title: '민감정보 수집·이용 동의', desc: sensitiveInfoDesc, questions: [
          { id: 3, text: '위와 같이 민감정보를 수집·이용하는데 동의하십니까?', type: 'radio', required: true, options: ['동의함', '동의하지 않음'], sectionJump: true, jumpMap: { 0: '', 1: 'end' }, shortLabel: '민감정보 동의' }
        ] },
        { id: 's3', title: '응급처치 동의', desc: emergencyDesc, questions: [
          { id: 15, text: '위 내용에 동의하십니까?', type: 'radio', required: true, options: ['예', '아니오'], shortLabel: '응급처치 동의' }
        ] },
        { id: 's3b', title: '미세먼지/오존', desc: '▪ 학생이 미세먼지 또는 오존 관련 기저질환(천식, 알레르기, 아토피, 호흡기질환, 심혈관질환 등)이 있는 경우, 학부모님께서는 해당 질환에 대한 의사의 진단서 또는 의견서(의사소견서, 진료확인서 등)를 보건실로 제출해주시기 바랍니다.\n※ 미세먼지 또는 오존과 유관성이 드러나는 기저질환명, 의사 소견 또는 향후 치료의견 명시 필수\n\n▪ 해당 의사소견서 및 진단서를 사전제출한 경우, 우리지역의 미세먼지·오존 농도가 \'나쁨\' 이상인 경우, 당일 수업 시작 30분 전에 학부모의 사전연락(담임선생님께 전화·문자연락)만으로 질병 결석 (출석 인정 X)이 인정됩니다.\n※ 사전 제출 이전에 해당 질병으로 결석한 경우에 질병 결석으로 인정받고자 한다면 결석한 날로부터 5일 이내에 결석계와 진단서를 제출하여야 함 (기저질환명 포함 필수)\n※ 학생의 각 학년과정의 수료에 필요한 출석일수는 해당학년 수업일수의 3분의2 이상이 되어야 함', questions: [
          { id: 16, text: '학생은 미세먼지, 오존 관련 기저질환으로 진단받은 적이 있나요?', type: 'radio', required: true, options: ['예', '아니요'], shortLabel: '미세먼지 기저질환' }
        ] },
        { id: 's3c', title: '당뇨 학생 파악', desc: '해당 없으면 \'아니요\'를 선택바랍니다. 진단 받은 학생에 한해서 추후 부가적인 상담을 실시할 예정입니다. 소아당뇨 학생 보호에 대한 사회적 요구, 국무조정실 소아당뇨 학생 보호대책 세부 시행계획, 학교보건법 제15조의2(응급처치 등)에 의거하여 당뇨 학생을 파악하고 있습니다.', questions: [
          { id: 18, text: '학생은 당뇨로 진단을 받았습니까?', type: 'radio', required: true, options: ['아니요', '1형 당뇨', '2형 당뇨'], shortLabel: '당뇨 진단' }
        ] },
        { id: 's4', title: '병력-1', questions: [
          { id: 19, text: '동거 가족 구성원 중에 질환으로 치료받거나 진단받은 사람이 있다면 학생과의 관계와 질환명을 적어주세요.', type: 'short_text', required: false, options: [], shortLabel: '가족의 질환', desc: '예> 누나: 1형 당뇨병 / 할머니: 알츠하이머<br>선택 문항입니다.' },
          { id: 20, text: '학생에게 선천적인 건강 이상이 있다면 그 내용과 진단 시기를 적어주세요.', type: 'short_text', required: false, options: [], shortLabel: '선천적 건강 이상', desc: '예> OOOO년 O월 출생 후 심실중격결손을 진단 받고 동년 O월에 수술을 함<br>선택 문항입니다.' },
          { id: 21, text: '과거에 학생이 사고를 당하거나 후천적인 문제로 수술, 입원을 한 내역이 있다면 그 내용과 시기를 적어주시기 바랍니다.', type: 'short_text', required: false, options: [], shortLabel: '과거 사고 또는 치료', desc: '예> OOOO년 O월 경 학교 인근에서 오토바이에 치여 넘어지면서 손목 골절로 OO병원에서 수술을 하였고 O주일 간 입원을 함<br>선택 문항입니다.' },
          { id: 22, text: '지난 1년 동안 감염병 예방접종을 받은 적이 있다면 선택해주세요.', type: 'checkbox', required: false, options: ['일본뇌염', '인플루엔자', '독감', '코로나19감염병', '모름'], shortLabel: '예방접종', desc: '선택 문항입니다. 중복 선택 가능합니다.', hasOther: true },
          { id: 23, text: '학생이 지난 1년간 질병을 앓았거나 병원 진료를 받은 경우 (진단을 받은 경우도 해당) 표시해주길 바랍니다.', type: 'grid_radio', required: false, gridRows: ['알레르기성 피부염', '아토피성 피부염', '천식', '결핵', '발작(경기 포함)', '암', '당뇨병(1형 및 2형)', '치과 질환', '우울감이나 스트레스 등 정서적 어려움', '조현병', '뇌전증', '(여학생) 생리통'], gridCols: ['해당없음', '완치', '치료 중'], options: [], shortLabel: '치료 진행 여부', desc: '선택 문항입니다. 각 질병에 대해 해당하는 상태를 선택해주세요.<br>※ 생리통 항목은 여학생에게만 제시됩니다.' },
          { id: 24, text: '위 5번 문항에서 하나 이상의 항목에 체크한 경우 내용을 자세히 적어주세요.', type: 'paragraph', required: false, options: [], shortLabel: '복용중인 약', desc: '예> 불안한 환경에서 천식 증상이 나타나며 경구 스테로이드 약물로 치료중임<br>예2> 1형 당뇨병으로 주기적인 혈당 체크와 인슐린 약물 치료중임<br>예3> 결핵 치료 후 6개월 전 완치 판정을 받았습니다.<br>선택 문항입니다.' }
        ] },
        { id: 's4b', title: '병력-2', questions: [
          { id: 25, text: '알러지 증상을 유발하는 약물, 물질, 음식을 모두 적어주시기 바랍니다.', type: 'short_text', required: false, options: [], shortLabel: '알러지', desc: '예> 땅콩, 이부프로펜, 고양이털…<br>선택 문항입니다.' },
          { id: 26, text: '아나필락시스를 경험한 적이 있나요?', type: 'radio', required: true, options: ['예', '아니요'], shortLabel: '아나필락시스', desc: '아나필락시스(아나필락틱 쇼크)란 특정 물질에 대해 몸에서 과민반응을 일으키는 것으로 극소량만 접촉해도 전신에 걸쳐 증상이 발생하는 심각한 알레르기 반응으로, 과민반응 물질에 접촉한 직후부터 대부분 1시간 안에 기침, 흉통, 입과 손발에 저린 감각, 빠른맥, 가려움증을 동반한 발진, 구토 등의 증상이 나타납니다.' },
          { id: 27, text: '치료 목적으로 학생이 계속 투여하는 약이 있으면 적어주세요.', type: 'short_text', required: false, options: [], shortLabel: '치료 약', desc: '선택 문항입니다.' },
          { id: 28, text: '현재 치료 받고 있는 병원이 있다면 어느 병원인지 적어주세요.', type: 'short_text', required: false, options: [], shortLabel: '다니는 병원', desc: '선택 문항입니다.' },
          { id: 29, text: '학생의 건강상의 이유로 학교에서 특별히 배려해야 할 점, 교직원이 인지하길 바라는 사항 등이 있다면 자세히 적어주시기 바랍니다.', type: 'paragraph', required: false, options: [], shortLabel: '배려해야할 점', desc: '예> 고혈당 증상을 보이면 학부모에게 연락주세요.<br>선택 문항입니다.' }
        ] }
      ]
    };
  }
}

module.exports = { SurveyFormService, SurveyResponseService, SurveyDefinitionService };
