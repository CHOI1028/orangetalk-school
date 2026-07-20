/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * StatisticsDBService — 대시보드 통계 집계 (정규화 DB 기반)
 * 렌더러는 기간(from, to)만 전달하고, 집계 결과를 받습니다.
 */
class StatisticsDBService {
  /* 진료과 14개 카테고리 → 증상 목록 매핑 (대시보드 _dashDeptCats14과 동일) */
  static DEPT_CATS = {
    '외상': ['넘어짐','부딪힘','찰과상','열상','베임','찔림','타박상','접질림','화상','골절 의심','물림','긁힘','까짐','멍','부종','벌쏘임','동물 물림'],
    '호흡기': ['기침','가래','콧물','코막힘','재채기','인후통','호흡곤란','천식 증상','발열','코피'],
    '소화기': ['복통','구토','구역질','설사','변비','속쓰림','소화불량','식욕부진'],
    '순환기': ['어지러움','실신','가슴 두근거림','가슴 통증','저혈압','고혈압','빈혈 증상'],
    '피부': ['발진','두드러기','가려움','습진','여드름','피부건조','수포','벌레 물림','알레르기 반응','이/빈대'],
    /* 1:1 정리 (2026-06-14) — 한 증상은 한 상분류에만. 어지러움→순환기, 이명→두통/신경, 코막힘·코피→호흡기 로 단일화해 이중집계 제거 */
    '두통/신경': ['두통','편두통','이명','손발 저림','경련'],
    '근골격': ['근육통','관절통','요통','목 통증','어깨 통증','손목 통증','무릎 통증','발목 염좌','근육 경련'],
    '이비인후': ['귀 통증','난청','편도 부종','목 이물감','성대 이상'],
    '구강/치아': ['치통','잇몸 출혈','구내염','입술 갈라짐','턱 통증','혀 통증'],
    '안과': ['안구건조','눈 통증','충혈','눈 이물감','시력 저하','눈꺼풀 부종','결막염','눈물','눈 가려움'],
    '비뇨/생식': ['배뇨통','빈뇨','혈뇨','생리통','생리불순','하복부 통증'],
    '정신/심리': ['불안','스트레스','우울','공황','과호흡','불면','식욕 이상','자해 충동'],
    '감염': ['독감 의심','코로나 의심','수두','유행성이하선염','장염','식중독','수족구'],
    '기타': ['피로','수면부족','성장통','기타'],
    '상담': ['성','건강','학업','수업','동아리','친구관계','가족관계','흡연예방','생활습관','폭력/학대','위생/청결','성장/발달','영양/식습관','요보호 대상자'],
  };

  /* 상분류 catId(medical-data.json) ↔ 통계 기본 라벨(축약) 매핑 — 사용자 이름변경(renamed_sym_cats)이 라벨을 덮어쓴다 (2026-06-12) */
  static CAT_ID_TO_LABEL = {
    trauma:'외상', resp:'호흡기', digest:'소화기', circ:'순환기', skin:'피부', head:'두통/신경',
    muscle:'근골격', ent:'이비인후', oral:'구강/치아', eye:'안과', uro:'비뇨/생식', mental:'정신/심리',
    infect:'감염', etc:'기타', counsel:'상담',
  };

  constructor(healthDB, appDataStore) {
    this._db = healthDB;
    this._appDataStore = appDataStore || null;
  }

  /* blob store common 키 안전 읽기 — {exists,data} 래퍼/직접값 모두 수용.
   * ※ 기존 _storeGet(scope,key) (휴일 캐시용) 와 별개 — 이름 충돌 금지. */
  _catStoreGet(key, fallback) {
    if (!this._appDataStore) return fallback;
    try {
      const r = this._appDataStore.get('common', key);
      const v = (r && typeof r === 'object' && ('exists' in r) && ('data' in r)) ? r.data : r;
      return (v == null) ? fallback : v;
    } catch (e) { return fallback; }
  }

  /** 유효 진료과 매핑 — 기본 DEPT_CATS + 사용자 상분류 편집(이름변경·추가 분류·순서) + 사용자 추가 증상 반영.
   *  · 이름변경: catId 기준이라 옛 기록 집계 연속성 유지 (라벨만 교체)
   *  · 가린 분류: 통계에는 계속 포함 (선택 화면에서만 숨김 — 데이터 보존 원칙)
   *  · 사용자 추가 분류(ucat_*): 그 분류의 사용자 증상(user_symptoms[id])으로 집계
   *  반환 형태는 DEPT_CATS 와 동일한 {라벨:[증상...]} — stats-db-dept-cats IPC·_aggregate 공용. (2026-06-12) */
  getEffectiveDeptCats() {
    const renamed = this._catStoreGet('renamed_sym_cats', {}) || {};
    const userCats = Array.isArray(this._catStoreGet('user_sym_cats', [])) ? this._catStoreGet('user_sym_cats', []) : [];
    const order = Array.isArray(this._catStoreGet('sym_cat_order', [])) ? this._catStoreGet('sym_cat_order', []) : [];
    const userSyms = this._catStoreGet('user_symptoms', {}) || {};
    const idMap = StatisticsDBService.CAT_ID_TO_LABEL;
    /* catId 순서 목록 — 저장 순서 우선, 누락분은 기본 순서 */
    const defaultIds = Object.keys(idMap);
    const allIds = defaultIds.concat(userCats.map(c => c && c.id).filter(Boolean));
    const ordered = [];
    order.forEach(id => { if (allIds.indexOf(id) !== -1 && ordered.indexOf(id) === -1) ordered.push(id); });
    allIds.forEach(id => { if (ordered.indexOf(id) === -1) ordered.push(id); });
    const out = {};
    ordered.forEach(id => {
      let label, syms;
      if (idMap[id]) {
        label = (renamed && renamed[id]) || idMap[id];
        syms = (StatisticsDBService.DEPT_CATS[idMap[id]] || []).slice();
      } else {
        const uc = userCats.find(c => c && c.id === id);
        if (!uc) return;
        label = uc.name || '(이름 없음)';
        syms = [];
      }
      /* 사용자 추가 증상 합류 — 기존엔 진료과별 통계에 안 잡히던 구멍 해소 */
      (Array.isArray(userSyms[id]) ? userSyms[id] : []).forEach(s => { if (s && syms.indexOf(s) === -1) syms.push(s); });
      if (out[label]) { syms.forEach(s => { if (out[label].indexOf(s) === -1) out[label].push(s); }); }
      else out[label] = syms;
    });
    return out;
  }

  /* 증상 별칭 번역 — 사용자가 중분류 이름을 바꾼 경우(ec_sym_renames {옛:새}) 옛 기록 증상을
   * 새 이름으로 번역해 통계가 한 항목으로 합산되게 한다. "두통 (어지러움 동반)" 같은 괄호 메모는 보존. (2026-06-12) */
  _symAlias(s, aliases) {
    if (!s || !aliases) return s;
    const str = String(s);
    const m = str.match(/^(.+?)\s*\((.*)\)\s*$/);
    const base = (m ? m[1] : str).trim();
    const nb = aliases[base];
    if (!nb || nb === base) return s;
    return m ? (nb + ' (' + m[2] + ')') : nb;
  }

  /* 기본 축약 라벨 → 유효 라벨 변환표 (이름변경 반영) — _guessDepts 키워드 fallback 결과 번역용 */
  _defaultLabelToEffective() {
    const renamed = this._catStoreGet('renamed_sym_cats', {}) || {};
    const map = {};
    Object.keys(StatisticsDBService.CAT_ID_TO_LABEL).forEach(id => {
      const def = StatisticsDBService.CAT_ID_TO_LABEL[id];
      map[def] = (renamed && renamed[id]) || def;
    });
    return map;
  }

  /* 증상 텍스트 → 키워드 기반 기본 라벨 배열 (없으면 빈 배열). 외부 이관 데이터 등 사전·base 에 없는 증상용.
   * _aggregate 와 미분류 탐지(getUncategorizedSymptoms)가 공유 — '진짜 미분류'(키워드도 0개) 판별에 사용. */
  _keywordGuessLabels(sym) {
    const s = String(sym || '');
    const hits = [];
    if (/눈|안구|결막|시력|다래끼|눈꺼풀|충혈|안약/.test(s)) hits.push('안과');
    if (/편도|인후|성대|귀|이명|난청|중이|외이|(^|[^두])목|목감기|목아/.test(s)) hits.push('이비인후');
    if (/치아|치통|잇몸|구내염|입술|혀\s*(통|아|상처|깨물|물)|턱|이빨|어금니|앞니|송곳니|사랑니|충치|치석|이가\s*(아|흔들|빠)|이\s*아파|이\s*시큰|구강|입\s*안|입천장|입.*헐|입술\s*(갈|터|부르|물)/.test(s)) hits.push('구강/치아');
    if (/기침|가래|콧물|코막힘|재채기|호흡곤란|천식|감기|독감.*의심|코피|콧속|코속|숨\s*막|목감기|인후염|편도염|비염|축농증|부비동|목.*아|목\s*따|목\s*쉼|목\s*칼칼|목.*붓|쌕쌕|쇳소리/.test(s)) hits.push('호흡기');
    if (/두통|편두통|어지럼|어지러|현기|손발.*저림|저린|경련|의식.*소실|마비|손.*떨림|머리.*아|머리.*통/.test(s)) hits.push('두통/신경');
    if (/복통|구토|구역|설사|변비|속쓰림|소화불량|식욕부진|배아|배탈|배.*아|배.*아픔|속\s*(더부|메스|울렁)|울렁|토할|토함|헛구역|명치|위\s*(통|아)/.test(s)) hits.push('소화기');
    if (/가슴.*(두근|통증|답답|조)|두근|저혈압|고혈압|빈혈|심계|심장|심박|숨.*(가|차)|맥박|어지러움|핑\s*돔|어지러움증|기립성/.test(s)) hits.push('순환기');
    if (/근육통|근육경련|관절|요통|허리|어깨|손목|무릎|발목.*염좌|염좌|손가락.*통|발가락.*통|팔.*통|다리.*통|다친|삐|뼈|근육.*아|근육.*뭉|담|쥐\s*남|발\s*아|다리\s*아|허벅지|종아리|엉덩이.*통|척추/.test(s)) hits.push('근골격');
    if (/발진|두드러기|가려|습진|여드름|피부|수포|물린|물림|물려|알레르기|아토피|홍반|따갑|피부염|발적|각질|비듬|땀띠|사마귀|티눈|무좀|진물|부스럼|뾰루지|뾰로지|쓸림|접촉.*피부|벌레|모기|벌\s*쏘|벌쏘/.test(s)) hits.push('피부');
    if (/넘어짐|부딪|찰과|열상|베임|찔림|타박|접질|화상|골절|긁힘|까짐|^멍$|^멍\s|\s멍$|멍\s*듦|부종|벌쏘|출혈|상처|외상|찢어|까진|부어|부음|삠|삔|긁혀|쓸려|찢|찢김|꼬집|밟힘|넘어져|깁스|부러|탈골|코뼈/.test(s)) hits.push('외상');
    if (/배뇨|빈뇨|혈뇨|생리|하복부|방광|소변|월경|생리통|질.*염|요도|요실금|탈수|부정기.*출혈/.test(s)) hits.push('비뇨/생식');
    if (/불안|스트레스|우울|공황|과호흡|불면|자해|식욕.*이상|긴장|두려움|걱정|초조|무기력|공포|짜증|분노|자살|우울감|울음|울고|정신|심리|공황장애|대인공포|공포증|따돌림|왕따|자존감|트라우마/.test(s)) hits.push('정신/심리');
    if (/코로나|수두|이하선염|장염|식중독|수족구|감염|유행성|독감|인플루엔자|홍역|풍진|수족구병|결핵|옴|머릿니|노로|로타|A형간염|감염\s*의심|유행/.test(s)) hits.push('감염');
    if (/상담/.test(s)) hits.push('상담');
    if (/피로|수면부족|성장통/.test(s)) hits.push('기타');
    return hits;
  }

  /** 미분류(기타 폴백) 증상 목록 — 사전·base·키워드 어디에도 안 잡혀 '기타'로만 집계되는 자유기입 증상.
   *  사용자가 대분류를 직접 지정하는 정리 도구용. (사용자 요청 2026-06-17)
   *  반환: [{ symptom, count, recordIds:[...] }] (건수 내림차순). 이미 sym_free_text_by_cat 으로 지정된 건 제외. */
  getUncategorizedSymptoms(opts) {
    opts = opts || {};
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const deptCats = this.getEffectiveDeptCats();
    const symToDepts = new Map();
    Object.keys(deptCats).forEach(dk => (deptCats[dk] || []).forEach(s => { if (!symToDepts.has(s)) symToDepts.set(s, dk); }));
    const _defToEff = this._defaultLabelToEffective();
    const _etc = _defToEff['기타'] || '기타';   /* 유효 '기타' 라벨 */
    /* catId → 유효 라벨 (자유기입/사용자 지정 반영) */
    const _catIdToEff = {};
    {
      const _renamed = this._catStoreGet('renamed_sym_cats', {}) || {};
      const _userCats = Array.isArray(this._catStoreGet('user_sym_cats', [])) ? this._catStoreGet('user_sym_cats', []) : [];
      Object.keys(StatisticsDBService.CAT_ID_TO_LABEL).forEach(id => { _catIdToEff[id] = (_renamed && _renamed[id]) || StatisticsDBService.CAT_ID_TO_LABEL[id]; });
      _userCats.forEach(c => { if (c && c.id) _catIdToEff[c.id] = c.name || c.id; });
    }
    const _baseOf = (s) => { const m = String(s).match(/^(.+?)\s*\(/); return m ? m[1].trim() : String(s).trim(); };
    /* _aggregate 와 동일한 진료과 해석 — 자유기입 catId 우선 → 사전 → base → 키워드 → 기타 */
    const _deptOf = (sym, freeMap) => {
      const t = String(sym).trim();
      let d = freeMap.get(t) || freeMap.get(_baseOf(t));
      if (d) return d;
      if (symToDepts.has(t)) return symToDepts.get(t);
      if (symToDepts.has(_baseOf(t))) return symToDepts.get(_baseOf(t));
      const kw = this._keywordGuessLabels(t);
      return kw.length ? (_defToEff[kw[0]] || kw[0]) : _etc;
    };
    /* '기타'로 집계되는 모든 증상 — 진짜 미분류뿐 아니라 기타 대분류로 잡히는 것까지 포함해
     *  사용자가 버튼으로 다른 진료과로 재지정할 수 있게. (사용자 요청 2026-06-17)
     *  재지정하면 sym_free_text_by_cat 에 catId 가 들어가 _aggregate 의 자유기입 우선 규칙으로 그 진료과에 집계됨. */
    const agg = {};
    records.forEach(r => {
      let syms = [];
      try { syms = JSON.parse(r.symptoms || '[]'); } catch (_) {}
      if (!Array.isArray(syms)) syms = syms ? [syms] : [];
      const freeMap = new Map();
      try {
        const ej = JSON.parse(r.extra_json || '{}');
        const fbc = ej && ej.sym_free_text_by_cat;
        if (fbc && typeof fbc === 'object' && !Array.isArray(fbc)) {
          Object.keys(fbc).forEach(cid => { const lbl = _catIdToEff[cid]; if (!lbl) return; const v = fbc[cid]; (Array.isArray(v) ? v : [v]).forEach(x => { const s = String(x || '').trim(); if (s) { freeMap.set(s, lbl); freeMap.set(_baseOf(s), lbl); } }); });
        }
      } catch (_) {}
      syms.forEach(sym => {
        const t = String(sym).trim();
        if (!t) return;
        if (_deptOf(t, freeMap) !== _etc) return;     /* 현재 '기타'로 집계되는 증상만 */
        if (!agg[t]) agg[t] = { symptom: t, count: 0, recordIds: [], dates: [], currentDept: _etc };
        agg[t].count++;
        agg[t].recordIds.push(r.id);
        if (r.visit_date) agg[t].dates.push(r.visit_date);
      });
    });
    const out = Object.values(agg);
    out.forEach(a => { a.dates = Array.from(new Set(a.dates)).sort().reverse(); });   /* 중복 제거·최신순 */
    return out.sort((a, b) => b.count - a.count);
  }

  /** 미분류 증상에 사용자가 고른 대분류(catId)를 일괄 적용 — 각 레코드 extra_json.sym_free_text_by_cat[catId]=symptom.
   *  payload: { assignments: [{ symptom, catId, recordIds:[...] }] }. 반환 { success, updated }. (사용자 요청 2026-06-17) */
  assignSymptomCategory(payload) {
    const list = (payload && Array.isArray(payload.assignments)) ? payload.assignments
      : (payload && payload.symptom ? [payload] : []);
    if (!list.length) return { success: true, updated: 0 };
    const getStmt = this._db.db.prepare('SELECT extra_json FROM daily_records WHERE id = ?');
    const setStmt = this._db.db.prepare('UPDATE daily_records SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    let updated = 0;
    const tx = this._db.db.transaction((items) => {
      items.forEach(a => {
        if (!a || !a.symptom || !a.catId || !Array.isArray(a.recordIds)) return;
        a.recordIds.forEach(rid => {
          const row = getStmt.get(rid);
          if (!row) return;
          let ej = {};
          try { ej = JSON.parse(row.extra_json || '{}'); } catch (_) { ej = {}; }
          if (!ej.sym_free_text_by_cat || typeof ej.sym_free_text_by_cat !== 'object' || Array.isArray(ej.sym_free_text_by_cat)) ej.sym_free_text_by_cat = {};
          ej.sym_free_text_by_cat[a.catId] = a.symptom;
          setStmt.run(JSON.stringify(ej), rid);
          updated++;
        });
      });
    });
    tx(list);
    return { success: true, updated };
  }

  /** semester_info blob 에서 사용자 지정 1학기/2학기 시작일을 읽어옴 (없으면 null) */
  _getSemesterInfo() {
    if (!this._appDataStore) return null;
    try {
      const v = this._appDataStore.get('common', 'semester_info');
      if (v && typeof v === 'object' && v.s2Start) return v;
    } catch (e) {}
    return null;
  }

  /**
   * 기간별 진료과·학년·성별 통계 (대시보드 핵심 집계)
   * @param {object} opts - { year, from, to }
   * @returns {object} { deptCounts, gradeCounts, genderCounts, total, studentTotal, staffTotal }
   */
  getDeptGradeStats(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const people = this._getStudents(year);
    return this._aggregate(records, people);
  }

  /**
   * 전년 동기 통계 (YoY 비교용)
   * @param {object} opts - { year, from, to } — from/to를 작년으로 변환하여 조회
   */
  getDeptGradeStatsYoY(opts) {
    const year = String(Number(opts.year || new Date().getFullYear()) - 1);
    const from = opts.from ? opts.from.replace(/^\d{4}/, year) : undefined;
    const to = opts.to ? opts.to.replace(/^\d{4}/, year) : undefined;
    const records = this._getRecords(year, from, to);
    const people = this._getStudents(year);
    return this._aggregate(records, people);
  }

  /**
   * 상담 통계 — 기간 내 상담록(주제) 건수를 주제(중분류)별·학년별·학생/교직원별 집계.
   * 보건일지 출력 "상담 통계 표지" 용. 진료과 통계와 같은 형태(topicCounts·gradeByTopic) 반환. (2026-06-25)
   */
  getCounselStats(opts) {
    const year = String((opts && opts.year) || new Date().getFullYear());
    const records = this._getRecords(year, opts && opts.from, opts && opts.to);
    const people = this._getStudents(year);
    return this._aggregateCounsel(records, people);
  }

  /**
   * 요약 통계 (방문 건수, 시간대별, 상위 증상, 일별 방문 수)
   */
  getSummary(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const people = this._getStudents(year);
    const _symAliases = this._catStoreGet('sym_renames', {}) || {};

    const hourly = {};
    const daily = {};
    const symptomCounts = {};

    records.forEach(r => {
      /* 시간대 */
      if (r.time_in) {
        const h = r.time_in.substring(0, 2);
        hourly[h] = (hourly[h] || 0) + 1;
      }
      /* 일별 */
      if (r.visit_date) daily[r.visit_date] = (daily[r.visit_date] || 0) + 1;
      /* 증상 */
      let syms = [];
      try { syms = JSON.parse(r.symptoms || '[]'); } catch (_) {}
      if (!Array.isArray(syms) && typeof syms === 'string') syms = [syms];
      syms.forEach(s => {
        if (!s) return;
        /* v3 — 증상 라벨도 괄호 앞 base 로 카운트 (사용자 결정 2026-05-21).
         * 예: "찰과상 (오른쪽 무릎)" 과 "찰과상 (왼쪽 무릎)" 은 "찰과상" 으로 통합. */
        const _str = String(s);
        const _m = _str.match(/^(.+?)\s*\(/);
        let base = _m ? _m[1].trim() : _str.trim();
        /* 별칭 승계 — 사용자가 이름을 바꾼 증상은 새 이름으로 합산 (2026-06-12) */
        base = (_symAliases[base] || base);
        if (base) symptomCounts[base] = (symptomCounts[base] || 0) + 1;
      });
    });

    const topSymptoms = Object.entries(symptomCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([symptom, count]) => ({ symptom, count }));

    return {
      total: records.length,
      studentCount: records.filter(r => {
        const s = people.get(r.person_uid);
        return s && s.type !== 'staff';
      }).length,
      hourly,
      daily,
      topSymptoms,
    };
  }

  /**
   * 처치/투약 빈도 + 요일별 분포
   */
  getTreatmentStats(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);

    const treatCount = {};
    const medCount = {};
    const dowCount = { '월': 0, '화': 0, '수': 0, '목': 0, '금': 0 };
    const dowNames = ['일', '월', '화', '수', '목', '금', '토'];

    records.forEach(r => {
      /* 처치 */
      let treats = [];
      try { treats = JSON.parse(r.treatments || '[]'); } catch (_) {}
      if (!Array.isArray(treats) && typeof treats === 'string') treats = treats ? [treats] : [];
      treats.forEach(t => { if (t) treatCount[t] = (treatCount[t] || 0) + 1; });

      /* 투약 */
      let meds = [];
      try { meds = JSON.parse(r.medications || '[]'); } catch (_) {}
      if (!Array.isArray(meds) && typeof meds === 'string') meds = meds ? [meds] : [];
      meds.forEach(m => { if (m) medCount[m] = (medCount[m] || 0) + 1; });

      /* 요일 */
      if (r.visit_date) {
        const dow = new Date(r.visit_date).getDay();
        const name = dowNames[dow];
        if (name in dowCount) dowCount[name]++;
      }
    });

    const topTreatments = Object.entries(treatCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([name, count]) => ({ name, count }));
    const topMedications = Object.entries(medCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    return { topTreatments, topMedications, dowCount };
  }

  /**
   * 시간대×요일 히트맵 데이터
   */
  getHourlyHeatmap(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
    /* heatmap[요일인덱스0~6][시간0~23] = count */
    const heatmap = {};
    for (let d = 0; d < 7; d++) {
      heatmap[d] = {};
      for (let h = 0; h < 24; h++) heatmap[d][h] = 0;
    }
    records.forEach(r => {
      if (!r.visit_date || !r.time_in) return;
      const dow = new Date(r.visit_date).getDay();
      const hour = parseInt(r.time_in.substring(0, 2)) || 0;
      heatmap[dow][hour]++;
    });
    return { heatmap, dowNames };
  }

  /**
   * 반별 방문 분포 (학년×반 → count, male, female)
   */
  getClassDistribution(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const people = this._getStudents(year);
    const classCounts = {};

    records.forEach(r => {
      const stu = r.person_uid ? people.get(r.person_uid) : null;
      if (!stu || stu.type === 'staff') return;
      const key = (stu.grade || '?') + '_' + (stu.cls || '?');
      if (!classCounts[key]) classCounts[key] = { grade: stu.grade, cls: stu.cls, total: 0, male: 0, female: 0 };
      classCounts[key].total++;
      if (stu.gender === '남') classCounts[key].male++;
      else if (stu.gender === '여') classCounts[key].female++;
    });

    return { classCounts };
  }

  /**
   * 재방문자 목록 (minVisits 이상 방문한 학생)
   */
  getRepeatVisitors(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const people = this._getStudents(year);
    const minVisits = opts.minVisits || 2;
    const visitMap = {};

    records.forEach(r => {
      if (!r.person_uid) return;
      const stu = people.get(r.person_uid);
      if (!stu || stu.type === 'staff') return;
      if (!visitMap[r.person_uid]) visitMap[r.person_uid] = { student: stu, count: 0, symptoms: {} };
      visitMap[r.person_uid].count++;
      let syms = [];
      try { syms = JSON.parse(r.symptoms || '[]'); } catch (_) {}
      if (!Array.isArray(syms) && typeof syms === 'string') syms = syms ? [syms] : [];
      syms.forEach(s => { if (s) visitMap[r.person_uid].symptoms[s] = (visitMap[r.person_uid].symptoms[s] || 0) + 1; });
    });

    const result = Object.values(visitMap)
      .filter(v => v.count >= minVisits)
      .sort((a, b) => b.count - a.count)
      .map(v => ({
        studentId: v.student.id,
        name: v.student.name,
        grade: v.student.grade,
        cls: v.student.cls,
        count: v.count,
        topSymptoms: Object.entries(v.symptoms).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, c]) => ({ symptom: s, count: c }))
      }));
    return { visitors: result };
  }

  /**
   * 성별 증상 비교
   */
  getGenderSymptomComparison(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const people = this._getStudents(year);
    const male = {}, female = {};
    const _al = this._catStoreGet('sym_renames', {}) || {};

    records.forEach(r => {
      const stu = r.person_uid ? people.get(r.person_uid) : null;
      if (!stu || stu.type === 'staff') return;
      let syms = [];
      try { syms = JSON.parse(r.symptoms || '[]'); } catch (_) {}
      if (!Array.isArray(syms) && typeof syms === 'string') syms = syms ? [syms] : [];
      const target = stu.gender === '남' ? male : stu.gender === '여' ? female : null;
      /* 별칭 승계 — 이름 바뀐 증상은 새 이름으로 합산 (2026-06-12) */
      if (target) syms.forEach(s => { const t = this._symAlias(s, _al); if (t) target[t] = (target[t] || 0) + 1; });
    });

    return {
      male: Object.entries(male).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, c]) => ({ symptom: s, count: c })),
      female: Object.entries(female).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, c]) => ({ symptom: s, count: c })),
    };
  }

  /* ──────────── private helpers ──────────── */

  _getRecords(year, from, to) {
    /* 통계는 외부 가져온 기록(is_imported=1)도 포함 — 전체 방문 통계에 반영 */
    const stmt = this._db.stmt.dailyGetByYear;
    let rows;
    if (from && to) {
      rows = this._db.stmt.dailyGetByYearDateRange
        ? this._db.stmt.dailyGetByYearDateRange.all(year, from, to)
        : stmt.all(year).filter(r => r.visit_date >= from && r.visit_date <= to);
    } else if (from) {
      rows = stmt.all(year).filter(r => r.visit_date >= from);
    } else if (to) {
      rows = stmt.all(year).filter(r => r.visit_date <= to);
    } else {
      rows = stmt.all(year);
    }
    return rows;
  }

  _getStudents(year) {
    const map = new Map();
    // v9: students + students_info JOIN
    try {
      const stuRows = this._db.stmt.siGetByYear.all(year);
      stuRows.forEach(s => { s.type = 'student'; map.set(s.uid, s); });
    } catch (_) {}
    // v9: staff
    try {
      const staffRows = this._db.stmt.staffGetByYear.all(year);
      staffRows.forEach(s => { s.type = 'staff'; s.grade = null; s.class_num = null; s.student_num = null; s.level = ''; map.set(s.uid, s); });
    } catch (_) {}
    return map;
  }

  _aggregate(records, studentMap) {
    /* 유효 진료과 매핑 — 사용자 상분류 편집(이름변경·추가·순서)과 사용자 추가 증상 반영 (2026-06-12) */
    const deptCats = this.getEffectiveDeptCats();
    const deptKeys = Object.keys(deptCats);
    const _defToEff = this._defaultLabelToEffective();   /* 키워드 fallback 라벨 번역표 */
    /* catId → 유효 진료과 라벨 — 자유기입 증상은 텍스트가 아니라 '선택한 대분류(catId)' 로만 집계 (사용자 보고 2026-06-17) */
    const _catIdToEff = {};
    {
      const _renamed = this._catStoreGet('renamed_sym_cats', {}) || {};
      const _userCats = Array.isArray(this._catStoreGet('user_sym_cats', [])) ? this._catStoreGet('user_sym_cats', []) : [];
      Object.keys(StatisticsDBService.CAT_ID_TO_LABEL).forEach(id => { _catIdToEff[id] = (_renamed && _renamed[id]) || StatisticsDBService.CAT_ID_TO_LABEL[id]; });
      _userCats.forEach(c => { if (c && c.id) _catIdToEff[c.id] = c.name || c.id; });
    }

    /* symptom → depts 역매핑 — 한 증상이 여러 카테고리에 속할 수 있음 (중복 허용) */
    const symToDepts = new Map();
    deptKeys.forEach(dk => {
      deptCats[dk].forEach(sym => {
        if (!symToDepts.has(sym)) symToDepts.set(sym, []);
        symToDepts.get(sym).push(dk);
      });
    });
    /* 외부 import 등 사전에 없는 증상을 위한 키워드 기반 fallback (배열 반환) */
    const _guessDepts = (sym) => {
      const direct = symToDepts.get(sym);
      if (direct && direct.length) return direct;
      /* 괄호(부위/메모) 떼고 base 증상명으로 사전 재매칭 — 연필 메모 "복통(운동 후)" 등이 키워드 오인 없이
       *  자기 대분류(소화기)로 정확히 잡히게. 키워드 폴백보다 우선. (사용자 보고 2026-06-17) */
      const _bm = String(sym).match(/^(.+?)\s*\(/);
      if (_bm) { const _bd = symToDepts.get(_bm[1].trim()); if (_bd && _bd.length) return _bd; }
      /* 키워드 fallback 은 기본 축약 라벨 기준 — 사용자 이름변경(renamed_sym_cats) 라벨로 번역 (2026-06-12) */
      const hits = this._keywordGuessLabels(sym);
      const fallback = hits.length ? hits : ['기타'];
      return fallback.map(d => _defToEff[d] || d);
    };
    /* 한 증상 → 자기 상분류 "1곳"만 (deptKeys 순서상 첫 매칭). 사용자 결정 2026-06-14:
     *  코막힘이 호흡기·이비인후 둘 다에 등록돼 한 방문이 두 진료과로 잡히던 이중집계 제거 → 상분류 1곳 기준.
     *  · 사전 등록 증상: symToDepts 의 첫 항목(=deptKeys 순서, 호흡기가 이비인후보다 앞 → 코막힘=호흡기)
     *  · 사전 밖(외부 import 등): 키워드 fallback 의 첫 매칭, 그래도 없으면 기타 */
    const _guessDeptOne = (sym) => {
      const direct = symToDepts.get(sym);
      if (direct && direct.length) return direct[0];
      const arr = _guessDepts(sym);
      return (arr && arr.length) ? arr[0] : (_defToEff['기타'] || '기타');
    };

    const deptCounts = {};
    deptKeys.forEach(dk => { deptCounts[dk] = { total: 0, student: 0, staff: 0 }; });
    const gradeCounts = {};
    const genderCounts = { male: 0, female: 0, unknown: 0 };
    /* gradeByDept[학년문자열][진료과키] = { total, male, female } */
    const gradeByDept = {};
    let studentTotal = 0, staffTotal = 0;

    records.forEach(r => {
      const stu = r.person_uid ? studentMap.get(r.person_uid) : null;
      const isStaff = stu && stu.type === 'staff';
      if (isStaff) staffTotal++;
      else studentTotal++;

      /* 학년 카운트 — level(유/초/중/고/대) 있으면 포함 키 사용 */
      const rawGrade = (!isStaff && stu && stu.grade != null) ? String(stu.grade) : null;
      const grade = (!isStaff && stu && stu.level && rawGrade)
        ? (stu.level + '_' + rawGrade) : rawGrade;
      if (!isStaff && stu) {
        const g = grade || '미상';
        gradeCounts[g] = (gradeCounts[g] || 0) + 1;
        if (stu.gender === '남') genderCounts.male++;
        else if (stu.gender === '여') genderCounts.female++;
        else genderCounts.unknown++;
        if (!gradeByDept[g]) gradeByDept[g] = {};
      }

      /* 진료과(상분류) 카운트 — 한 증상은 자기 상분류 1곳에만 집계 (사용자 결정 2026-06-14).
       *  코막힘이 호흡기·이비인후 둘 다로 잡히던 이중집계 제거 → DEPT_CATS 매핑을 1:1 로 정리해서
       *  _guessDepts(sym) 가 1곳만 돌려준다(코막힘=호흡기). 그래서 forEach 여도 증상당 1회. */
      let syms = [];
      try { syms = JSON.parse(r.symptoms || '[]'); } catch (_) {}
      if (!Array.isArray(syms) && typeof syms === 'string') syms = syms ? [syms] : [];
      /* 앱 내 자유기입 증상 → '선택한 대분류(catId)' 로만 집계. 텍스트 추측 금지 (사용자 보고 2026-06-17).
       *  extra_json.sym_free_text_by_cat = { catId: 자유기입텍스트 } 가 있으면 그 텍스트는 catId 진료과로 고정.
       *  ※ 이 매핑이 없는 외부 이관 데이터는 기존대로 _guessDeptOne 키워드 매칭(의도된 설계) 유지. */
      const _freeTextToDept = new Map();
      let _scm = {};   /* extra_json.sym_cat_map: { 증상base: 선택한 상분류 catId } (사용자 요청 2026-06-25) */
      try {
        const _ej = JSON.parse(r.extra_json || '{}');
        const _fbc = (_ej && _ej.sym_free_text_by_cat && typeof _ej.sym_free_text_by_cat === 'object' && !Array.isArray(_ej.sym_free_text_by_cat)) ? _ej.sym_free_text_by_cat : null;
        if (_fbc) Object.keys(_fbc).forEach(catId => {
          const lbl = _catIdToEff[catId];
          if (!lbl) return;
          const vv = _fbc[catId];
          (Array.isArray(vv) ? vv : [vv]).forEach(v => { const t = String(v || '').trim(); if (t) _freeTextToDept.set(t, lbl); });
        });
        if (_ej && _ej.sym_cat_map && typeof _ej.sym_cat_map === 'object' && !Array.isArray(_ej.sym_cat_map)) _scm = _ej.sym_cat_map;
      } catch (_) {}
      syms.forEach(sym => {
        /* 자유기입(catId 보유)이면 그 대분류로 고정, 아니면 기존 사전/키워드 매칭(이관 데이터 포함) */
        let dk = _freeTextToDept.get(String(sym).trim());
        if (!dk) { const _mm = String(sym).match(/^(.+?)\s*\(/); if (_mm) dk = _freeTextToDept.get(_mm[1].trim()); }
        /* 선택 시 기록한 상분류(sym_cat_map) 우선 — 같은 증상명(두통)이 호흡기·두통신경 양쪽에 등록돼 있어도
         *  방문자가 고른 상분류로 집계. catId→유효 라벨 변환 후 dk 고정 (사용자 요청 2026-06-25).
         *  sym_cat_map 없는 옛 기록은 아래 _guessDeptOne 첫 매칭 폴백(기존 동작 유지). */
        if (!dk) {
          const _bm = String(sym).match(/^(.+?)\s*\(/);
          const _bk = _bm ? _bm[1].trim() : String(sym).trim();
          const _cid = _scm[_bk];
          if (_cid && _catIdToEff[_cid]) dk = _catIdToEff[_cid];
        }
        if (!dk) dk = _guessDeptOne(sym);   /* 증상당 상분류 1곳 (코막힘=호흡기) */
        if (!deptCounts[dk]) return;
        deptCounts[dk].total++;
        if (isStaff) {
          deptCounts[dk].staff++;
        } else {
          deptCounts[dk].student++;
          if (stu && grade != null) {
            const g = grade;
            if (!gradeByDept[g][dk]) gradeByDept[g][dk] = { total: 0, male: 0, female: 0 };
            gradeByDept[g][dk].total++;
            if (stu.gender === '남') gradeByDept[g][dk].male++;
            else if (stu.gender === '여') gradeByDept[g][dk].female++;
          }
        }
      });
    });

    return {
      total: records.length,
      studentTotal,
      staffTotal,
      deptCounts,
      gradeCounts,
      genderCounts,
      gradeByDept,
    };
  }

  /* ──────────── 상담 통계 집계 (보건일지 출력 표지용, 2026-06-25) ──────────── */
  /* 상담 주제(중분류) 목록 — 기본(DEPT_CATS['상담']) + 사용자 추가(user_symptoms['counsel']) */
  _counselTopicList() {
    const base = (StatisticsDBService.DEPT_CATS['상담'] || []).slice();
    const userSyms = this._catStoreGet('user_symptoms', {}) || {};
    (Array.isArray(userSyms['counsel']) ? userSyms['counsel'] : []).forEach(s => { if (s && base.indexOf(s) === -1) base.push(s); });
    return base;
  }
  /* 한 기록의 상담 주제 추출 — counsel_log.topics 우선, 없으면 symptoms 의 "상담[X 관련 상담]" 파싱.
   *  중분류 이름변경(sym_renames)도 반영. 상담 기록이 아니면 빈 배열. */
  _recordCounselTopics(r, aliases) {
    let raw = [];
    try {
      const ej = JSON.parse(r.extra_json || '{}');
      const cl = ej && ej.counsel_log;
      if (cl && Array.isArray(cl.topics) && cl.topics.length) raw = cl.topics.slice();
    } catch (_) {}
    if (!raw.length) {
      let syms = [];
      try { syms = JSON.parse(r.symptoms || '[]'); } catch (_) {}
      if (!Array.isArray(syms)) syms = syms ? [syms] : [];
      syms.forEach(s => { const m = String(s).match(/^상담\[(.+?)\s*관련 상담\]$/); if (m) raw.push(m[1].trim()); });
    }
    const out = [];
    raw.forEach(t => {
      let v = String(t || '').trim();
      if (!v) return;
      if (aliases && aliases[v]) v = aliases[v];   /* 중분류 이름변경 반영 */
      if (out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }
  _aggregateCounsel(records, studentMap) {
    const aliases = this._catStoreGet('sym_renames', {}) || {};
    const topicKeys = this._counselTopicList().map(t => (aliases[t] || t));
    const topicCounts = {};
    const _ensure = (t) => { if (!topicCounts[t]) topicCounts[t] = { total: 0, student: 0, staff: 0 }; };
    topicKeys.forEach(_ensure);
    const gradeByTopic = {};
    let studentTotal = 0, staffTotal = 0, recordTotal = 0;
    records.forEach(r => {
      const topics = this._recordCounselTopics(r, aliases);
      if (!topics.length) return;
      recordTotal++;
      const stu = r.person_uid ? studentMap.get(r.person_uid) : null;
      const isStaff = stu && stu.type === 'staff';
      if (isStaff) staffTotal++; else studentTotal++;
      const rawGrade = (!isStaff && stu && stu.grade != null) ? String(stu.grade) : null;
      const grade = (!isStaff && stu && stu.level && rawGrade) ? (stu.level + '_' + rawGrade) : rawGrade;
      topics.forEach(t => {
        _ensure(t);
        if (topicKeys.indexOf(t) === -1) topicKeys.push(t);   /* 미등록 주제 동적 합류 */
        topicCounts[t].total++;
        if (isStaff) { topicCounts[t].staff++; }
        else {
          topicCounts[t].student++;
          if (grade != null) {
            if (!gradeByTopic[grade]) gradeByTopic[grade] = {};
            if (!gradeByTopic[grade][t]) gradeByTopic[grade][t] = { total: 0, male: 0, female: 0 };
            gradeByTopic[grade][t].total++;
            if (stu.gender === '남') gradeByTopic[grade][t].male++;
            else if (stu.gender === '여') gradeByTopic[grade][t].female++;
          }
        }
      });
    });
    return { topicKeys, topicCounts, gradeByTopic, studentTotal, staffTotal, recordTotal };
  }

  /* ──────────── 간편 통계 (stats-view용) ──────────── */

  /**
   * 기간별 간편 통계를 반환합니다.
   * 총방문, 일평균, 증상 Top5, 학년 분포, 처치 비율을 한번에 계산합니다.
   */
  getQuickStats(year, from, to) {
    const yr = year || String(new Date().getFullYear());
    const _stmt = this._db.stmt.dailyGetByYearExcludeImported || this._db.stmt.dailyGetByYear;
    const records = _stmt.all(yr);

    /* 기간 필터링 */
    const filtered = (from && to)
      ? records.filter(r => r.visit_date >= from && r.visit_date <= to)
      : records;

    const total = filtered.length;
    const uniqueDays = new Set(filtered.map(r => r.visit_date)).size;
    const avg = uniqueDays ? +(total / uniqueDays).toFixed(1) : 0;

    /* 증상 빈도 Top5 */
    const symCount = {};
    filtered.forEach(r => {
      let syms = r.symptoms;
      try { if (typeof syms === 'string') syms = JSON.parse(syms); } catch (e) { syms = []; }
      (syms || []).forEach(s => { symCount[s] = (symCount[s] || 0) + 1; });
    });
    const topSymptoms = Object.entries(symCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    /* 학년 분포 */
    const studentMap = {};
    try { this._db.stmt.siGetByYear.all(yr).forEach(s => { s.type = 'student'; studentMap[s.uid] = s; }); } catch (_) {}
    try { this._db.stmt.staffGetByYear.all(yr).forEach(s => { s.type = 'staff'; studentMap[s.uid] = s; }); } catch (_) {}
    const gradeCount = {};
    filtered.forEach(r => {
      const stu = studentMap[r.person_uid];
      if (stu && stu.grade) {
        gradeCount[stu.grade] = (gradeCount[stu.grade] || 0) + 1;
      }
    });
    const gradeDistribution = Object.entries(gradeCount)
      .sort((a, b) => +a[0] - +b[0])
      .map(([grade, count]) => ({ grade, count }));

    /* 처치 비율 */
    const treatCount = {};
    filtered.forEach(r => {
      let _tl = r.treatment || [];
      if (typeof _tl === 'string') { if (_tl.charAt(0) === '[') { try { const _p = JSON.parse(_tl); _tl = Array.isArray(_p) ? _p : _tl.split(','); } catch (_) { _tl = _tl.split(','); } } else { _tl = _tl.split(','); } }
      if (!Array.isArray(_tl)) _tl = [];
      _tl.filter(Boolean).forEach(t => {
        const trimmed = t.trim();
        if (!trimmed) return;
        /* v3 — 메모 부착 라벨은 괄호 앞 base 로 카운트 (사용자 결정 2026-05-21).
         * 예: "소독 (5분간)" → "소독" 으로 카운트. */
        const _m = trimmed.match(/^(.+?)\s*\(/);
        const base = _m ? _m[1].trim() : trimmed;
        if (base) treatCount[base] = (treatCount[base] || 0) + 1;
      });
    });
    const treatTotal = Object.values(treatCount).reduce((s, c) => s + c, 0) || 1;
    const treatmentSummary = Object.entries(treatCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: +(count / treatTotal * 100).toFixed(1) }));

    return {
      total,
      uniqueDays,
      avg,
      topSymptoms,
      gradeDistribution,
      treatmentSummary,
    };
  }

  /* ──────────── 학기/학년도 날짜 범위 계산 ──────────── */

  /**
   * 학기/학년도/주간/월간 기간의 시작·끝 날짜를 반환합니다.
   * 교육과정 규칙: 1학기=3~7월, 2학기=8~다음2월, 학년도=3월~다음2월
   */
  static getAcademicDateRange(period, year, options) {
    const yr = parseInt(year, 10);
    /* 사용자 지정 학기 정보가 options.semesterInfo 로 전달되면 우선 적용 */
    const si = options && options.semesterInfo ? options.semesterInfo : null;
    function _sub1(ymd) {
      const p = ymd.split('-');
      const d = new Date(+p[0], +p[1] - 1, +p[2]);
      d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    switch (period) {
      case 'semester1': {
        if (si && si.s1Start && si.s2Start) return { from: si.s1Start, to: _sub1(si.s2Start) };
        return { from: `${yr}-03-01`, to: `${yr}-08-31` };
      }
      case 'semester2': {
        if (si && si.s2Start) {
          const nextYr = yr + 1;
          const isLeap = (nextYr % 4 === 0 && nextYr % 100 !== 0) || nextYr % 400 === 0;
          return { from: si.s2Start, to: `${nextYr}-02-${isLeap ? '29' : '28'}` };
        }
        return { from: `${yr}-09-01`, to: `${yr + 1}-02-28` };
      }
      case 'academicYear':
        return { from: `${yr}-03-01`, to: `${yr + 1}-02-28` };
      case 'month': {
        const m = options && options.month != null ? options.month : new Date().getMonth();
        const first = new Date(yr, m, 1);
        const last = new Date(yr, m + 1, 0);
        return {
          from: first.toISOString().slice(0, 10),
          to: last.toISOString().slice(0, 10),
        };
      }
      case 'week': {
        const base = options && options.date ? new Date(options.date) : new Date();
        const day = base.getDay();
        const mon = new Date(base);
        mon.setDate(mon.getDate() - day + (day === 0 ? -6 : 1));
        const fri = new Date(mon);
        fri.setDate(fri.getDate() + 4);
        return {
          from: mon.toISOString().slice(0, 10),
          to: fri.toISOString().slice(0, 10),
        };
      }
      default:
        return { from: `${yr}-01-01`, to: `${yr}-12-31` };
    }
  }

  /* ──────────── 공휴일 관리 ────────────
     · 2026 은 하드코딩 fallback (키 미입력 사용자도 무조건 표시).
     · 2026 외 모든 연도(과거·미래) 는 사용자가 설정에서 '특일정보 API 키' 를 입력하면
       data.go.kr 의 KASI 특일정보 API 에서 받아 AppDataStore blob (common, holiday_cache_YYYY) 에 캐시.
     · 키 미입력 + 캐시 없음 = 그 연도 휴일은 평일처럼 표시 (오류 없이 동작). */

  /** 한국 공휴일 데이터 — 2026 fallback (1년치만 유지, 그 외 연도는 API 캐시). */
  /* 공휴일 하드코딩 전면 제거 — 모든 연도(올해 포함)를 KASI 특일정보 API 에서 받아온다.
   * (API 키 미입력 시 공휴일이 표시되지 않음 — 사용자 결정 2026-06-04) */
  static HOLIDAYS = {};

  /** AppDataStore.get() 의 {exists,data} 래퍼를 풀어 raw value 만 반환 (없으면 null). */
  _storeGet(scope, key) {
    if (!this._appDataStore) return null;
    try {
      const res = this._appDataStore.get(scope, key);
      if (res && res.exists && res.data != null) return res.data;
    } catch (_) {}
    return null;
  }

  /** 공휴일 목록 반환 — 캐시된 모든 연도 통합(하드코딩 없음, 전부 API).
   *  연도 인덱스(holiday_cache_years 배열) 를 통해 캐시된 연도만 효율적으로 누적 병합. */
  getHolidays() {
    const out = {};
    const idx = this._storeGet('common', 'holiday_cache_years');
    if (Array.isArray(idx)) {
      for (const yr of idx) {
        if (!/^\d{4}$/.test(String(yr))) continue;
        const cached = this._storeGet('common', 'holiday_cache_' + yr);
        if (cached && typeof cached === 'object') Object.assign(out, cached);
      }
    }
    return out;
  }

  /** 특정 연도 공휴일만 반환 (캐시 — 하드코딩 없이 전부 API). */
  getHolidaysFor(year) {
    const yr = String(year || new Date().getFullYear());
    const cached = this._storeGet('common', 'holiday_cache_' + yr);
    return (cached && typeof cached === 'object') ? cached : {};
  }

  /** 특일정보 API 응답을 연도별 캐시에 저장 + 인덱스 업데이트. */
  cacheHolidays(year, data) {
    if (!this._appDataStore) return false;
    const yr = String(year || '').trim();
    if (!/^\d{4}$/.test(yr)) return false;
    try {
      this._appDataStore.set('common', 'holiday_cache_' + yr, data || {});
      /* 인덱스 갱신 — 중복 제거 후 정렬 */
      const idxRaw = this._storeGet('common', 'holiday_cache_years');
      const idx = Array.isArray(idxRaw) ? idxRaw.slice() : [];
      if (!idx.includes(yr)) {
        idx.push(yr);
        idx.sort();
        this._appDataStore.set('common', 'holiday_cache_years', idx);
      }
      return true;
    } catch (e) {
      console.warn('[holidays] 캐시 저장 실패:', e.message);
      return false;
    }
  }

  /** 캐시된 연도 목록 반환 (인덱스 기반). */
  getCachedHolidayYears() {
    const idx = this._storeGet('common', 'holiday_cache_years');
    return Array.isArray(idx) ? idx.slice() : [];
  }

  /** 특정 연도 캐시 삭제 (인덱스에서도 제거). 모든 연도 캐시 비우려면 year='*'. */
  clearHolidayCache(year) {
    if (!this._appDataStore) return false;
    try {
      if (year === '*' || year === 'all') {
        const idx = this.getCachedHolidayYears();
        for (const yr of idx) {
          this._appDataStore.set('common', 'holiday_cache_' + yr, null);
        }
        this._appDataStore.set('common', 'holiday_cache_years', null);
        return true;
      }
      const yr = String(year || '').trim();
      if (!/^\d{4}$/.test(yr)) return false;
      this._appDataStore.set('common', 'holiday_cache_' + yr, null);
      const idx = this.getCachedHolidayYears().filter(y => y !== yr);
      this._appDataStore.set('common', 'holiday_cache_years', idx);
      return true;
    } catch (e) {
      console.warn('[holidays] 캐시 삭제 실패:', e.message);
      return false;
    }
  }

  /** 주어진 날짜가 공휴일인지 확인 (하드코딩 2026 한정 — 인스턴스 메서드 isHolidayDate 가 캐시까지 본다). */
  static isHoliday(dateStr) {
    return dateStr in StatisticsDBService.HOLIDAYS;
  }

  /** 주어진 날짜가 주말인지 확인 */
  static isWeekend(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  /* ──────────── 서브탭 생성 (학사력 기반) ──────────── */

  /**
   * 통계 기간별 서브탭 목록을 반환합니다.
   * 렌더러가 직접 계산하지 않고 백엔드에서 일관되게 생성합니다.
   * @param {string} period - today|week|month|semester|year|custom
   * @param {string} [baseDate] - 기준 날짜 (YYYY-MM-DD), 기본값 오늘
   * @returns {Array<{label, from, to, year?, half?, month?}>}
   */
  static getSubTabs(period, baseDate, opts) {
    const semInfo = opts && opts.semesterInfo ? opts.semesterInfo : null;
    const now = baseDate ? new Date(baseDate + 'T00:00:00') : new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    function pad2(n) { return String(n).padStart(2, '0'); }
    function toStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function weekMonday(d) {
      const dd = new Date(d);
      dd.setDate(dd.getDate() - (dd.getDay() || 7) + 1);
      dd.setHours(0, 0, 0, 0);
      return dd;
    }

    if (period === 'today' || period === 'custom') return [];

    if (period === 'week') {
      /* 이번 주 + 과거 9주 = 총 10주 */
      const tabs = [];
      const curMon = weekMonday(now);
      const w = new Date(curMon);
      for (let i = 0; i < 10; i++) {
        const wEnd = new Date(w); wEnd.setDate(wEnd.getDate() + 4);
        const label = i === 0 ? '이번 주' :
          ((w.getMonth() + 1) + '/' + w.getDate() + '~' + (wEnd.getMonth() + 1) + '/' + wEnd.getDate());
        /* 학년도 계산 (3월~다음해 2월) */
        const ay = w.getMonth() >= 2 ? w.getFullYear() : w.getFullYear() - 1;
        tabs.push({ label, year: ay, from: toStr(w), to: toStr(wEnd) });
        w.setDate(w.getDate() - 7);
      }
      return tabs;
    }

    if (period === 'month') {
      /* 이번 달 + 과거 11개월 = 총 12개월 */
      const tabs = [];
      let y2 = year, m2 = month;
      for (let i = 0; i < 12; i++) {
        const label = i === 0 ? '이번 달' : (y2 + '년 ' + (m2 + 1) + '월');
        const first = new Date(y2, m2, 1);
        const last = new Date(y2, m2 + 1, 0);
        tabs.push({ label, year: y2, month: m2, from: toStr(first), to: toStr(last) });
        m2--; if (m2 < 0) { m2 = 11; y2--; }
      }
      return tabs;
    }

    if (period === 'semester') {
      /* 이번 학기 + 과거 9개 = 총 10개 학기 — 사용자 지정 학기 정보 적용 */
      const tabs = [];
      /* 현재 날짜가 1학기 범위에 있으면 half=1, 아니면 half=2 */
      const todayStr = toStr(now);
      let curY, curHalf;
      function _sub1(ymd){const p=ymd.split('-');const d=new Date(+p[0],+p[1]-1,+p[2]);d.setDate(d.getDate()-1);return toStr(d);}
      if (semInfo && semInfo.s1Start && semInfo.s2Start) {
        const ay = month >= 2 ? year : year - 1;
        const s1Start = (semInfo.academicYear === ay) ? semInfo.s1Start : `${ay}-${semInfo.s1Start.slice(5)}`;
        const s2Start = (semInfo.academicYear === ay) ? semInfo.s2Start : `${ay}-${semInfo.s2Start.slice(5)}`;
        const s1End = _sub1(s2Start);
        if (todayStr >= s1Start && todayStr <= s1End) { curHalf = 1; curY = ay; }
        else { curHalf = 2; curY = ay; }
      } else {
        curHalf = (month >= 2 && month <= 7) ? 1 : 2;
        curY = curHalf === 1 ? (month >= 2 ? year : year - 1) : (month >= 8 ? year : year - 1);
      }
      for (let i = 0; i < 10; i++) {
        const label = i === 0 ? '이번 학기' : (curY + '년 ' + (curHalf === 1 ? '1학기' : '2학기'));
        const range = StatisticsDBService.getAcademicDateRange(
          curHalf === 1 ? 'semester1' : 'semester2', curY, { semesterInfo: semInfo }
        );
        tabs.push({ label, year: curY, half: curHalf, from: range.from, to: range.to });
        if (curHalf === 1) { curHalf = 2; curY--; } else { curHalf = 1; }
      }
      return tabs;
    }

    if (period === 'year') {
      const tabs = [];
      for (let i = 0; i < 6; i++) {
        const y = year - i;
        const label = i === 0 ? '이번 연도' : (y + '년');
        tabs.push({ label, year: y, from: `${y}-03-01`, to: `${y + 1}-02-28` });
      }
      return tabs;
    }

    return [];
  }

  /**
   * 트렌드 차트용 시계열 집계 데이터를 반환합니다.
   * @param {object} opts - { year, from, to, period, selectedDate }
   * @returns {object} { labels: string[], values: number[] }
   */
  getTrendData(opts) {
    const year = String(opts.year || new Date().getFullYear());
    const records = this._getRecords(year, opts.from, opts.to);
    const period = opts.period || 'week';
    const selectedDate = opts.selectedDate || new Date().toISOString().slice(0, 10);
    const labels = [];
    const values = [];

    /* 날짜별 레코드 수 맵 */
    const dateCountMap = {};
    records.forEach(r => {
      if (r.visit_date) dateCountMap[r.visit_date] = (dateCountMap[r.visit_date] || 0) + 1;
    });

    if (period === 'week') {
      const dayNames = ['월', '화', '수', '목', '금'];
      const base = new Date(selectedDate);
      const dayOfWeek = base.getDay();
      const start = new Date(base);
      start.setDate(base.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
      for (let i = 0; i < 5; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const ds = d.toISOString().slice(0, 10);
        labels.push(dayNames[i]);
        values.push(dateCountMap[ds] || 0);
      }
    } else if (period === 'month') {
      const prefix = selectedDate.substring(0, 7);
      const parts = prefix.split('-');
      const daysInMonth = new Date(+parts[0], +parts[1], 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = prefix + '-' + String(d).padStart(2, '0');
        if (!StatisticsDBService.isWeekend(ds) && !StatisticsDBService.isHoliday(ds)) {
          labels.push(String(d));
          values.push(dateCountMap[ds] || 0);
        }
      }
    } else if (period === 'semester') {
      const semYear = opts.semesterYear || +selectedDate.split('-')[0];
      const half = opts.semesterHalf || 1;
      const months = half === 1 ? [3, 4, 5, 6, 7] : [8, 9, 10, 11, 12];
      const monthNames = half === 1 ? ['3월', '4월', '5월', '6월', '7월'] : ['8월', '9월', '10월', '11월', '12월'];
      months.forEach((m, i) => {
        const mo = String(m).padStart(2, '0');
        const prefix = semYear + '-' + mo;
        let cnt = 0;
        records.forEach(r => {
          if (r.visit_date && r.visit_date.startsWith(prefix)) cnt++;
        });
        labels.push(monthNames[i]);
        values.push(cnt);
      });
    } else {
      /* year period */
      const calYear = opts.calYear || +selectedDate.split('-')[0];
      for (let m = 3; m <= 12; m++) {
        const mo = String(m).padStart(2, '0');
        const prefix = calYear + '-' + mo;
        let cnt = 0;
        records.forEach(r => {
          if (r.visit_date && r.visit_date.startsWith(prefix)) cnt++;
        });
        if (cnt > 0 || m <= +selectedDate.split('-')[1]) {
          labels.push(m + '월');
          values.push(cnt);
        }
      }
    }

    return { labels, values };
  }
}

module.exports = { StatisticsDBService };
