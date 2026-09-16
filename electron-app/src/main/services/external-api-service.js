/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const { normalizePublicDataApiKey, encodePublicDataApiKey } = require('../../shared/public-data-api-key');

/**
 * external-api-service.js — 외부 API 통합 서비스
 *
 * ExternalApiService — 환율/주식/에어코리아/웹스크랩/공개시트/식약처 API
 * WeatherService — 날씨/공기질/위치 API
 */

/* ══════════ ExternalApiService ══════════ */

/**
 * ExternalApiService — 외부 API 호출 (메인 프로세스)
 *
 * - 환율 (Frankfurter API)
 * - 주식 (Yahoo Finance)
 * - 에어코리아 미세먼지 (공공데이터포털)
 * - 웹 스크랩 메타데이터 추출
 * - Google Sheets 공개 CSV
 */
class ExternalApiService {

  /* ──────────── 환율 ──────────── */

  async fetchExchangeRates() {
    const response = await fetch(
      'https://api.frankfurter.app/latest?from=KRW&to=USD,EUR,JPY,CNY'
    );
    const data = await response.json();
    if (!data || !data.rates) {
      return { success: false, error: '환율 데이터 조회 실패' };
    }
    return {
      success: true,
      data: {
        usd: data.rates.USD ? (1 / data.rates.USD).toFixed(2) : null,
        eur: data.rates.EUR ? (1 / data.rates.EUR).toFixed(2) : null,
        jpy: data.rates.JPY ? (100 / data.rates.JPY).toFixed(2) : null,
        cny: data.rates.CNY ? (1 / data.rates.CNY).toFixed(2) : null,
        date: data.date || ''
      }
    };
  }

  /* ──────────── 주식 ──────────── */

  async fetchStockPrice(ticker) {
    if (!ticker) return { success: false, error: '종목코드를 입력해 주세요' };
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
      + encodeURIComponent(ticker) + '?interval=1d&range=1d';
    const response = await fetch(url);
    const data = await response.json();
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) {
      return { success: false, error: '종목을 찾을 수 없습니다' };
    }
    const meta = result.meta;
    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
    const change = prevClose ? ((price - prevClose) / prevClose * 100).toFixed(2) : '0';
    return {
      success: true,
      data: {
        ticker: (meta.symbol || ticker).toUpperCase(),
        name: meta.shortName || meta.symbol || ticker,
        currency: meta.currency || '',
        price: price,
        change: parseFloat(change),
        up: parseFloat(change) >= 0
      }
    };
  }

  /* ──────────── 에어코리아 미세먼지 ──────────── */

  async fetchAirkorea(serviceKey, stationName) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: 'API 키를 입력해 주세요' };
    if (!stationName) return { success: false, error: '측정소명을 입력해 주세요' };
    /* 공공데이터 인증키는 공통 규칙으로 정규화한 뒤 한 번만 인코딩한다. */
    const keyForUrl = encodePublicDataApiKey(serviceKey);
    const stn = String(stationName).trim();
    const buildUrl = (scheme) => scheme
      + '://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty'
      + '?serviceKey=' + keyForUrl
      + '&returnType=json&numOfRows=1&pageNo=1'
      + '&stationName=' + encodeURIComponent(stn)
      + '&dataTerm=DAILY&ver=1.0';
    const tryUrls = [buildUrl('https'), buildUrl('http')];
    let lastErr = '';
    for (const url of tryUrls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
        const text = await response.text();
        /* XML 에러 응답 (data.go.kr 공통 에러 포맷) */
        if (text.trim().startsWith('<')) {
          const errMatch = text.match(/<errMsg>([^<]*)<\/errMsg>/) || text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/);
          const reasonMatch = text.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/);
          lastErr = (errMatch && errMatch[1] || 'XML 에러') + (reasonMatch ? ' (코드 ' + reasonMatch[1] + ')' : '');
          console.warn('[airkorea] XML 에러 응답:', text.substring(0, 400));
          continue; /* http 폴백 시도 */
        }
        let data;
        try { data = JSON.parse(text); }
        catch (e) { lastErr = 'JSON 파싱 실패'; console.warn('[airkorea] JSON 파싱 실패:', text.substring(0, 200)); continue; }
        /* data.go.kr 표준 에러 래퍼 */
        if (data && data.OpenAPI_ServiceResponse) {
          const h = data.OpenAPI_ServiceResponse.cmmMsgHeader || {};
          lastErr = (h.errMsg || h.returnAuthMsg || '에어코리아 API 에러') + (h.returnReasonCode ? ' (코드 ' + h.returnReasonCode + ')' : '');
          console.warn('[airkorea] API 에러:', lastErr);
          continue;
        }
        const items = data && data.response && data.response.body && data.response.body.items;
        if (!items || !items.length) {
          lastErr = '측정소 "' + stn + '" 데이터를 찾을 수 없습니다 (측정소명을 다시 확인해 주세요)';
          continue;
        }
        const item = items[0];
        return {
          success: true,
          data: {
            pm10: item.pm10Value || '-',
            pm25: item.pm25Value || '-',
            pm10Grade: item.pm10Grade1h || '',
            pm25Grade: item.pm25Grade1h || '',
            o3: item.o3Value || '-',          /* 오존 (ppm) */
            o3Grade: item.o3Grade || '',      /* 오존 등급 (1좋음~4매우나쁨) */
            station: stn,
            dataTime: item.dataTime || ''
          }
        };
      } catch (err) {
        lastErr = err.message || String(err);
        console.warn('[airkorea] fetch 오류:', lastErr);
      }
    }
    return { success: false, error: lastErr || '에어코리아 API 호출 실패' };
  }

  /* ──────────── 에어코리아 측정소 정보 (주소·지역 추출) ──────────── */
  async fetchAirkoreaStationInfo(serviceKey, stationName) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: 'API 키를 입력해 주세요' };
    if (!stationName) return { success: false, error: '측정소명을 입력해 주세요' };
    const keyForUrl = encodePublicDataApiKey(serviceKey);
    const stn = String(stationName).trim();
    const buildUrl = (scheme) => scheme
      + '://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList'
      + '?serviceKey=' + keyForUrl
      + '&returnType=json&numOfRows=5&pageNo=1'
      + '&stationName=' + encodeURIComponent(stn);
    const tryUrls = [buildUrl('https'), buildUrl('http')];
    let lastErr = '';
    for (const url of tryUrls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
        const text = await response.text();
        if (text.trim().startsWith('<')) { lastErr = 'XML 에러 응답'; continue; }
        let data;
        try { data = JSON.parse(text); } catch (e) { lastErr = 'JSON 파싱 실패'; continue; }
        if (data && data.OpenAPI_ServiceResponse) { lastErr = '에어코리아 API 에러'; continue; }
        const items = data && data.response && data.response.body && data.response.body.items;
        if (!items || !items.length) { lastErr = '측정소 "' + stn + '" 정보를 찾을 수 없습니다'; continue; }
        /* 측정소명이 정확히 일치하는 것 우선, 없으면 첫 번째 */
        const exact = items.find(it => (it.stationName || '') === stn);
        const item = exact || items[0];
        const addr = item.addr || '';
        const region = this._extractRegionFromAddr(addr);
        return {
          success: true,
          data: {
            stationName: item.stationName || stn,
            addr,
            region,
            dmX: item.dmX || '',
            dmY: item.dmY || ''
          }
        };
      } catch (err) { lastErr = err.message || String(err); }
    }
    return { success: false, error: lastErr || '측정소 정보 조회 실패' };
  }

  _extractRegionFromAddr(addr) {
    if (!addr) return '';
    const parts = String(addr).trim().split(/\s+/);
    const sido = parts[0] || '';
    /* 광역시·특별시·특별자치시: 시·도 그대로 */
    if (/(특별시|광역시|특별자치시)$/.test(sido)) return sido;
    /* 일반 도: 시·군·구 반환 */
    if (/도$/.test(sido)) return parts[1] || sido;
    return sido;
  }

  /* ──────────── 웹 스크랩 (URL → title) ──────────── */

  async fetchUrlTitle(url) {
    if (!url) return { success: false, error: 'URL이 없습니다' };
    /* ── SSRF 방어: HTTPS만 허용, 사설IP/localhost 차단 ── */
    let parsed;
    try { parsed = new URL(url); } catch { return { success: false, error: '유효하지 않은 URL' }; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { success: false, error: 'HTTP(S) 프로토콜만 허용됩니다' };
    }
    const host = parsed.hostname.toLowerCase();
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
    if (blocked.includes(host) || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) {
      return { success: false, error: '내부 네트워크 접근이 차단되었습니다' };
    }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OrangePharmDiary/1.0' },
      signal: AbortSignal.timeout(8000),
      redirect: 'manual'
    });
    const html = await response.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      success: true,
      data: { title: match ? match[1].trim() : url }
    };
  }

  /* ──────────── 범용 JSON fetch (배너 등 원격 JSON 로드) ──────────── */

  async fetchJson(url, options = {}) {
    if (!url) return { success: false, error: 'URL이 없습니다' };
    let parsed;
    try { parsed = new URL(url); } catch { return { success: false, error: '유효하지 않은 URL' }; }
    if (parsed.protocol !== 'https:') {
      return { success: false, error: 'HTTPS 프로토콜만 허용됩니다' };
    }
    const host = parsed.hostname.toLowerCase();
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
    if (blocked.includes(host) || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) {
      return { success: false, error: '내부 네트워크 접근이 차단되었습니다' };
    }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OrangePharmDiary/1.0' },
        signal: AbortSignal.timeout(8000),
        ...(options.redirect === 'manual' ? { redirect: 'manual' } : {})
      });
      const text = await response.text();
      /* 기존 success/data 계약 유지. HTTP 오류도 본문을 보존해 호출부에서 판별한다. */
      return { success: true, data: text, status: response.status, contentType: response.headers.get('content-type') || '' };
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      /* 오류 원문에는 인증키가 포함된 URL이 있을 수 있으므로 전달하지 않는다. */
      return {
        success: false,
        error: timedOut ? '외부 데이터 요청 시간이 초과되었습니다.' : '외부 데이터 서버에 연결하지 못했습니다.',
        errorKind: timedOut ? 'timeout' : 'network'
      };
    }
  }

  /* ──────────── 한국천문연구원 특일정보 (공휴일·대체공휴일·임시공휴일) ────────────
     · 엔드포인트: getRestDeInfo (연도별 공휴일 일괄 조회)
     · 응답: response.body.items.item[]  (단건이면 item 이 객체, 다건이면 배열)
     · 각 item: { locdate(YYYYMMDD number), dateName, isHoliday("Y"/"N"), dateKind }
     · dateKind '01' = 공휴일(법정·대체·임시). 기념일/절기/잡절은 우리 달력 표시 대상 아님.
     · 우리 앱 결과 포맷: { "YYYY-MM-DD": "휴일명", ... } — 기존 HOLIDAYS 와 동일 */
  async fetchHolidays(serviceKey, year) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: '특일정보 API 키를 입력해 주세요' };
    const yr = String(year || new Date().getFullYear()).trim();
    if (!/^\d{4}$/.test(yr)) return { success: false, error: '연도 형식 오류 (YYYY)' };
    const keyForUrl = encodePublicDataApiKey(serviceKey);
    const buildUrl = (scheme) => scheme
      + '://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
      + '?ServiceKey=' + keyForUrl
      + '&solYear=' + yr
      + '&numOfRows=100&pageNo=1&_type=json';
    const tryUrls = [buildUrl('https'), buildUrl('http')];
    let lastErr = '';
    for (const url of tryUrls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const text = await response.text();
        /* XML 에러 응답 (data.go.kr 공통 에러 포맷) */
        if (text.trim().startsWith('<')) {
          const errMatch = text.match(/<errMsg>([^<]*)<\/errMsg>/) || text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/);
          const reasonMatch = text.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/);
          lastErr = (errMatch && errMatch[1] || 'XML 에러') + (reasonMatch ? ' (코드 ' + reasonMatch[1] + ')' : '');
          console.warn('[holidays] XML 에러 응답:', text.substring(0, 400));
          continue;
        }
        let data;
        try { data = JSON.parse(text); }
        catch (e) { lastErr = 'JSON 파싱 실패'; console.warn('[holidays] JSON 파싱 실패:', text.substring(0, 200)); continue; }
        if (data && data.OpenAPI_ServiceResponse) {
          const h = data.OpenAPI_ServiceResponse.cmmMsgHeader || {};
          lastErr = (h.errMsg || h.returnAuthMsg || '특일정보 API 에러') + (h.returnReasonCode ? ' (코드 ' + h.returnReasonCode + ')' : '');
          console.warn('[holidays] API 에러:', lastErr);
          continue;
        }
        const body = data && data.response && data.response.body;
        if (!body) { lastErr = '응답 형식 오류 (body 없음)'; continue; }
        /* totalCount = 0 인 정상 응답 — 빈 객체 반환 (해당 연도 공휴일 등록 전일 수 있음) */
        const total = Number(body.totalCount || 0);
        if (total === 0) return { success: true, data: {}, year: yr, total: 0 };
        let itemNode = body.items && body.items.item;
        if (!itemNode) { lastErr = '응답 형식 오류 (items.item 없음)'; continue; }
        const arr = Array.isArray(itemNode) ? itemNode : [itemNode];
        const out = {};
        for (const it of arr) {
          /* isHoliday "Y" 가 아니면 우리 달력 표시 대상 아님 (절기/잡절 제외) */
          if (it.isHoliday && String(it.isHoliday).toUpperCase() !== 'Y') continue;
          const ld = String(it.locdate || '');
          if (!/^\d{8}$/.test(ld)) continue;
          const ds = ld.slice(0, 4) + '-' + ld.slice(4, 6) + '-' + ld.slice(6, 8);
          const name = String(it.dateName || '').trim() || '공휴일';
          /* 같은 날짜에 여러 휴일이 겹치면 슬래시로 합침 (어린이날/석가탄신일 케이스) */
          out[ds] = out[ds] ? (out[ds] + '/' + name) : name;
        }
        return { success: true, data: out, year: yr, total };
      } catch (err) {
        lastErr = err.message || String(err);
        console.warn('[holidays] fetch 오류:', lastErr);
      }
    }
    return { success: false, error: lastErr || '특일정보 API 호출 실패' };
  }

  /* ──────────── 식약처 의약품개요정보 (e약은요) ──────────── */

  /* 약품 검색용 — 입력 한 단어로 e약은요에서 매칭되는 후보 리스트 반환 (최대 50개)
     팝업 자동완성에서 사용. 짧은 입력(2글자)도 그대로 위임. */
  async searchDrugList(serviceKey, query) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: '식약처 API 키를 입력해 주세요' };
    if (!query || query.length < 1) return { success: true, items: [] };
    const baseUrl = 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList';
    const keyForUrl = encodePublicDataApiKey(serviceKey);
    const url = baseUrl + '?serviceKey=' + keyForUrl + '&itemName=' + encodeURIComponent(query) + '&type=json&numOfRows=50&pageNo=1';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const text = await resp.text();
      if (text.trim().startsWith('<')) {
        return { success: false, error: 'API 에러 응답 (XML)', raw: text.substring(0, 200) };
      }
      let data;
      try { data = JSON.parse(text); } catch (e) { return { success: false, error: 'JSON 파싱 실패' }; }
      if (data && data.OpenAPI_ServiceResponse) {
        const h = data.OpenAPI_ServiceResponse.cmmMsgHeader || {};
        return { success: false, error: (h.errMsg || h.returnAuthMsg || '') + (h.returnReasonCode ? ' (코드 ' + h.returnReasonCode + ')' : '') };
      }
      const body = (data && data.body) || (data && data.response && data.response.body);
      const rawItems = body && body.items;
      const items = Array.isArray(rawItems) ? rawItems : (rawItems && rawItems.item) ? (Array.isArray(rawItems.item) ? rawItems.item : [rawItems.item]) : [];
      const slim = items.map(it => ({
        itemName: it.itemName || '',
        entpName: it.entpName || '',
        itemSeq: it.itemSeq || ''
      }));
      return { success: true, items: slim };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  async fetchDrugInfo(serviceKey, drugName) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: '식약처 API 키를 입력해 주세요' };
    if (!drugName) return { success: false, error: '약품명을 입력해 주세요' };
    const strip = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const baseUrl = 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList';

    /* 서비스 키 처리 — 공통 규칙으로 정규화하고 한 번만 URL 인코딩 */
    const keyTrim = String(serviceKey).trim();
    const keyForUrl = encodePublicDataApiKey(serviceKey);
    console.log('[drug-info] 쿼리:', drugName, '| 키 길이:', keyTrim.length, '| 인코딩 여부:', keyTrim.indexOf('%') !== -1);

    /* ── 검색 변형 생성 (퍼지 매칭) ── */
    const variants = [drugName];
    /* 1. 괄호 제거: "테라플루(나이트타임)" → "테라플루나이트타임" */
    const noParen = drugName.replace(/[()（）]/g, '');
    if (noParen !== drugName) variants.push(noParen);
    /* 2. 괄호 앞 부분만: "테라플건조시(나이트타임)" → "테라플건조시" */
    const parenIdx = drugName.search(/[(\uFF08]/);
    if (parenIdx > 1) {
      const beforeParen = drugName.substring(0, parenIdx).trim();
      if (beforeParen.length >= 2) variants.push(beforeParen);
      /* 괄호 안 내용: "(나이트타임)" → "나이트타임" */
      const inParen = drugName.match(/[(\uFF08]([^)\uFF09]+)[)\uFF09]/);
      if (inParen && inParen[1].length >= 2) variants.push(inParen[1]);
    }
    /* 3. 접미사 제거: "정","캡슐","건조시럽" 등 */
    const noSuffix = drugName.replace(/(정|캡슐|액|시럽|산|겔|크림|연질캡슐|건조시럽|과립|필름코팅정|분말|스프레이|연고|패치|좌제|주사|환)$/,'');
    if (noSuffix !== drugName && noSuffix.length >= 2) variants.push(noSuffix);
    /* 4. 용량 제거: "500mg", "0.05%" 등 */
    const noDose = drugName.replace(/\d+(\.\d+)?\s*(mg|g|ml|%|mcg)/gi,'').trim();
    if (noDose !== drugName && noDose.length >= 2) variants.push(noDose);
    /* 5. 괄호+접미사+용량 모두 제거 — 핵심 브랜드명 추출 */
    const brand = drugName
      .replace(/[(\uFF08][^)\uFF09]*[)\uFF09]/g, '')
      .replace(/\d+(\.\d+)?\s*(mg|g|ml|%|mcg)/gi, '')
      .replace(/(정|캡슐|액|시럽|산|겔|크림|연질캡슐|건조시럽|건조시|과립|필름코팅정|분말|스프레이|연고|패치|좌제|주사|환)/g, '')
      .trim();
    if (brand.length >= 2 && brand !== drugName) variants.push(brand);
    /* 6. 공백/하이픈/슬래시 기준 토큰 분해 — 부분 매칭 강화 */
    const tokens = drugName.split(/[\s\-\/·,]+/).filter(t => t.length >= 2);
    tokens.forEach(t => {
      if (!variants.includes(t)) variants.push(t);
      /* 토큰 자체에서도 용량/접미사 제거 */
      const tClean = t.replace(/[(\uFF08][^)\uFF09]*[)\uFF09]/g, '')
        .replace(/\d+(\.\d+)?\s*(mg|g|ml|%|mcg)/gi, '')
        .replace(/(정|캡슐|액|시럽|산|겔|크림|연질캡슐|건조시럽|건조시|과립|필름코팅정|분말|스프레이|연고|패치|좌제|주사|환)$/, '')
        .trim();
      if (tClean.length >= 2 && !variants.includes(tClean)) variants.push(tClean);
    });
    /* 7. 용량/괄호 제거 후 앞 2~5글자 (짧은 브랜드 검색) */
    const shortBrand = brand.replace(/\s/g, '');
    if (shortBrand.length >= 3) {
      for (let len = Math.min(5, shortBrand.length); len >= 2; len--) {
        variants.push(shortBrand.substring(0, len));
      }
    }
    /* 8. 한 글자 오타 대응 */
    if (shortBrand.length >= 4) {
      for (let i = 0; i < shortBrand.length; i++) {
        const dropped = shortBrand.substring(0, i) + shortBrand.substring(i + 1);
        if (dropped.length >= 3) variants.push(dropped);
      }
    }
    /* 9. 키워드 매칭용 — 2~3글자 모든 부분 문자열 (가운데·뒤쪽 포함)
       예: "타이레놀ER서방정" → "타이", "이레", "레놀", "놀ER", "ER서", ... → API가 LIKE 매칭 */
    if (shortBrand.length >= 3) {
      for (let len = 3; len >= 2; len--) {
        for (let start = 0; start + len <= shortBrand.length; start++) {
          const sub = shortBrand.substring(start, start + len);
          if (sub && !variants.includes(sub)) variants.push(sub);
        }
      }
    }
    /* 중복 제거 + 짧은 것부터 탐색하지 않도록 원래 순서 유지 */
    const searches = [...new Set(variants)].filter(v => v && v.length >= 2);

    /* ── 유사도 점수 함수 — LCS 비율 ── */
    const _similarity = (a, b) => {
      const s1 = a.replace(/[()（）\s\d.mg%]/gi, '').toLowerCase();
      const s2 = b.replace(/[()（）\s\d.mg%]/gi, '').toLowerCase();
      if (!s1.length || !s2.length) return 0;
      /* LCS (Longest Common Subsequence) 길이 */
      const m = s1.length, n = s2.length;
      let prev = new Array(n + 1).fill(0);
      for (let i = 1; i <= m; i++) {
        const curr = new Array(n + 1).fill(0);
        for (let j = 1; j <= n; j++) {
          curr[j] = s1[i - 1] === s2[j - 1] ? prev[j - 1] + 1 : Math.max(curr[j - 1], prev[j]);
        }
        prev = curr;
      }
      return prev[n] / Math.max(m, n);
    };

    /* ── 전체 후보 수집 후 최적 매칭 — https 우선 실패 시 http 폴백 ── */
    const allCandidates = [];
    const triedQueries = [];
    let lastErrorMsg = '';
    /* 우선순위 재정렬: 고유한 브랜드명이 앞으로 오도록
       1) 원본 → 2) 괄호 제거 → 3) 접미사/용량 제거 → 4) 브랜드명(shortBrand prefix) → 5) 키워드(부분 문자열) */
    const _priorityOrder = [];
    const _push = (v) => { if (v && v.length >= 2 && !_priorityOrder.includes(v)) _priorityOrder.push(v); };
    /* 1) 원본 그대로 — 완전 일치 우선 */
    _push(drugName);
    /* 2) 기본 정제 — 괄호/접미사/용량 제거 */
    _push(noParen);
    if (parenIdx > 1) _push(drugName.substring(0, parenIdx).trim());
    _push(noSuffix);
    _push(noDose);
    _push(brand);
    /* 3) 공백/하이픈 토큰 */
    tokens.forEach(t => _push(t));
    /* 4) 핵심: 2~3글자 부분 문자열(슬라이딩 윈도) — 한 번에 들어맞지 않아도 키워드 매칭으로 찾기
       예: "타이레놀ER서방정" shortBrand="타이레놀ER서방"
           → "타이레", "이레놀", "레놀E", "놀ER", ... 길이3
           → "타이", "이레", "레놀", ... 길이2
       3글자부터(더 정확) 시도 후 2글자 순 */
    if (shortBrand.length >= 3) {
      for (let start = 0; start + 3 <= shortBrand.length; start++) {
        _push(shortBrand.substring(start, start + 3));
      }
    }
    if (shortBrand.length >= 2) {
      for (let start = 0; start + 2 <= shortBrand.length; start++) {
        _push(shortBrand.substring(start, start + 2));
      }
    }
    /* 5) 한 글자 오타 대응 (마지막 순위) */
    if (shortBrand.length >= 4) {
      for (let i = 0; i < shortBrand.length; i++) {
        const dropped = shortBrand.substring(0, i) + shortBrand.substring(i + 1);
        if (dropped.length >= 3) _push(dropped);
      }
    }
    /* 변형 최대 15개 — 부분 문자열 시도 여유 확보 */
    const limitedSearches = _priorityOrder.slice(0, 15);
    console.log('[drug-info] 시도할 변형 목록:', limitedSearches);
    /* fetch 타임아웃 유틸 — data.go.kr 응답이 느릴 때 무한 대기 방지 */
    const _fetchWithTimeout = (url, ms) => {
      return new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => { ctrl.abort(); reject(new Error('timeout ' + ms + 'ms')); }, ms);
        fetch(url, { signal: ctrl.signal })
          .then(r => { clearTimeout(t); resolve(r); })
          .catch(e => { clearTimeout(t); reject(e); });
      });
    };
    const fetchVariant = async (query, timeoutMs) => {
      triedQueries.push(query);
      /* HTTPS 만 시도 — HTTP 폴백 제거로 변형당 요청 수 절반 축소 */
      /* numOfRows=50 — 부분 매칭으로 후보를 충분히 모아 유사도 정렬 */
      const url = baseUrl + '?serviceKey=' + keyForUrl + '&itemName=' + encodeURIComponent(query) + '&type=json&numOfRows=50&pageNo=1';
      const tryUrls = [url];
      for (const url of tryUrls) {
        try {
          const response = await _fetchWithTimeout(url, timeoutMs || 6000);
          const text = await response.text();
          /* 응답이 XML이면 (에러 응답) 에러 메시지 추출 */
          if (text.trim().startsWith('<')) {
            const errMatch = text.match(/<errMsg>([^<]*)<\/errMsg>/) || text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/);
            const reasonMatch = text.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/);
            lastErrorMsg = (errMatch && errMatch[1] || '') + (reasonMatch ? ' (코드 ' + reasonMatch[1] + ')' : '');
            console.warn('[drug-info] XML 에러 응답 [' + query + ']:', text.substring(0, 400));
            continue;
          }
          let data;
          try { data = JSON.parse(text); }
          catch (e) { console.warn('[drug-info] JSON 파싱 실패 [' + query + ']:', text.substring(0, 200)); continue; }
          /* 에러 응답 (OpenAPI_ServiceResponse) */
          if (data && data.OpenAPI_ServiceResponse) {
            const h = data.OpenAPI_ServiceResponse.cmmMsgHeader || {};
            lastErrorMsg = (h.errMsg || h.returnAuthMsg || '') + (h.returnReasonCode ? ' (코드 ' + h.returnReasonCode + ')' : '');
            console.warn('[drug-info] API 에러 [' + query + ']:', lastErrorMsg);
            continue;
          }
          const body = (data && data.body) || (data && data.response && data.response.body);
          const rawItems = body && body.items;
          const items = Array.isArray(rawItems) ? rawItems : (rawItems && rawItems.item) ? (Array.isArray(rawItems.item) ? rawItems.item : [rawItems.item]) : [];
          if (items.length) {
            for (const it of items) {
              const dup = allCandidates.find(c => c.itemName === it.itemName);
              if (!dup) allCandidates.push(it);
            }
            return true;
          }
        } catch (err) {
          lastErrorMsg = err.message || String(err);
          console.warn('[drug-info] fetch 오류 [' + query + ']:', lastErrorMsg);
        }
      }
      return false;
    };
    /* 순차 폴백: 원본 → 결과 없으면 변형1 → 변형2 ... 결과 나오면 즉시 종료
       (기존: 1단계 후 유사도 낮으면 나머지 4개 병렬 → 과도한 API 호출) */
    const _simScore = (a, b) => {
      const s1 = String(a || '').replace(/[()（）\s\d.mg%]/gi, '').toLowerCase();
      const s2 = String(b || '').replace(/[()（）\s\d.mg%]/gi, '').toLowerCase();
      if (!s1.length || !s2.length) return 0;
      if (s1 === s2) return 1;
      if (s2.includes(s1) || s1.includes(s2)) return 0.85;
      return 0;
    };
    /* 원본(i=0) 시도 → 후보 있든 없든 유사도 확인
       - 고유사도(0.85↑) 발견 시 즉시 종료
       - 낮은 유사도만 나왔으면 변형 시도를 계속해 더 나은 매칭 탐색
       - 아예 후보 없으면 변형 시도 계속
       최대 8 변형까지 순차 시도 */
    /* 첫 변형은 여유롭게 6초, 이후는 3.5초 */
    let _timeoutStreak = 0;
    for (let i = 0; i < limitedSearches.length; i++) {
      const _ms = i === 0 ? 6000 : 3500;
      await fetchVariant(limitedSearches[i], _ms);
      /* 연속 타임아웃/실패 3회 이상이면 네트워크 문제로 판단, 조기 중단 */
      if (/timeout/i.test(lastErrorMsg || '')) {
        _timeoutStreak++;
        if (_timeoutStreak >= 3) break;
      } else {
        _timeoutStreak = 0;
      }
      /* 완전 일치급(0.95↑) 발견 시만 즉시 종료 — 부분 일치만 있으면 더 좋은 매칭을 계속 탐색 */
      const hasExactMatch = allCandidates.some(it => _simScore(drugName, it.itemName) >= 0.95);
      if (hasExactMatch) break;
      /* 후보가 충분히 누적되었으면(20+) 더 시도하지 않음 */
      if (allCandidates.length >= 20) break;
    }
    console.log('[drug-info] 누적 후보 수:', allCandidates.length, '| 시도한 쿼리:', triedQueries);
    if (!allCandidates.length) {
      console.warn('[drug-info] 후보 없음 — 시도한 쿼리:', triedQueries);
      let msg;
      if (/timeout/i.test(lastErrorMsg || '')) {
        msg = '식약처 API 응답이 지연되고 있습니다. 네트워크를 확인하거나 잠시 후 다시 시도해 주세요.';
      } else if (lastErrorMsg) {
        msg = '약품 정보 조회 실패: ' + lastErrorMsg;
      } else {
        msg = '약품 정보를 찾을 수 없습니다: ' + drugName;
      }
      return { success: false, error: msg };
    }
    /* 유사도 점수로 최적 후보 선택 — LCS 비율 + 부분 문자열 보너스 결합 */
    const _scoreItem = (it) => {
      const lcs = _similarity(drugName, it.itemName || '');
      const sub = _simScore(drugName, it.itemName || '');
      return Math.max(lcs, sub * 0.9); /* 부분 문자열 매칭에도 가중치 */
    };
    const scored = allCandidates.map(it => ({it, score: _scoreItem(it)}));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].it;
    /* 디버그: 상위 5개 후보 로그 */
    console.log('[drug-info] 상위 후보:', scored.slice(0, 5).map(s => ({name: s.it.itemName, score: s.score.toFixed(2)})));
    /* 다른 후보(상위 5개)도 함께 반환 → 사용자가 다른 약품 선택 가능 */
    const alternatives = scored.slice(1, 6).map(s => ({
      itemName: s.it.itemName || '',
      entpName: s.it.entpName || '',
      score: Number(s.score.toFixed(2))
    }));
    return {
      success: true,
      data: {
        itemName: best.itemName || drugName,
        entpName: best.entpName || '',
        efcyQesitm: strip(best.efcyQesitm),
        useMethodQesitm: strip(best.useMethodQesitm),
        atpnWarnQesitm: strip(best.atpnWarnQesitm),
        atpnQesitm: strip(best.atpnQesitm),
        intrcQesitm: strip(best.intrcQesitm),
        seQesitm: strip(best.seQesitm),
        depositMethodQesitm: strip(best.depositMethodQesitm),
        itemImage: best.itemImage || '',
        alternatives
      }
    };
  }

  /* ──────────── 건강보험심사평가원 병원/약국 정보 ──────────── */

  async fetchMedFacilities(serviceKey, params) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: '건강보험심사평가원 API 키를 입력해 주세요' };
    const { type, sidoCd, sgguCd, pageNo, numOfRows } = params || {};
    /* type: hospital(병원), pharmacy(약국), emergency(응급실)
     * 좌표/반경 기반 검색 지원:
     *   xPos (경도), yPos (위도), radius (미터, 0~50000)
     * 기관 분류 vs 진료과목 구분:
     *   clCd     = 요양기관 분류코드 (01=상급종합, 11=종합병원, 21=병원, 31=의원, 41=치과병원,
     *              51=치과의원, 61=한방병원, 71=한의원, 81=약국, 91=요양병원 등)
     *   dgsbjtCd = 진료과목 코드 (01=내과, 02=신경과, 03=정신건강의학과, 04=외과, 05=정형외과 등)
     */
    let apiUrl = '';
    if (type === 'pharmacy') {
      apiUrl = 'http://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList';
    } else if (type === 'emergency') {
      apiUrl = 'http://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytBassInfoInqire';
    } else {
      apiUrl = 'http://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList';
    }
    let qs = '?serviceKey=' + encodePublicDataApiKey(serviceKey) + '&numOfRows=' + (numOfRows || 30) + '&pageNo=' + (pageNo || 1) + '&_type=json';
    if (sidoCd) qs += '&sidoCd=' + encodeURIComponent(sidoCd);
    if (sgguCd) qs += '&sgguCd=' + encodeURIComponent(sgguCd);
    if (type !== 'emergency' && params.yadmNm) qs += '&yadmNm=' + encodeURIComponent(params.yadmNm);
    if (type !== 'emergency' && params.clCd) qs += '&clCd=' + encodeURIComponent(params.clCd);
    if (type === 'hospital' && params.dgsbjtCd) qs += '&dgsbjtCd=' + encodeURIComponent(params.dgsbjtCd);
    /* 좌표·반경 (병원·약국만 지원) */
    if (type !== 'emergency' && params.xPos) qs += '&xPos=' + encodeURIComponent(params.xPos);
    if (type !== 'emergency' && params.yPos) qs += '&yPos=' + encodeURIComponent(params.yPos);
    if (type !== 'emergency' && params.radius) qs += '&radius=' + encodeURIComponent(params.radius);
    try {
      const response = await fetch(apiUrl + qs);
      const data = await response.json();
      const body = data && data.response && data.response.body;
      const items = body && body.items && body.items.item;
      if (!items) return { success: true, data: [], totalCount: 0 };
      const list = Array.isArray(items) ? items : [items];
      return { success: true, data: list, totalCount: body.totalCount || list.length };
    } catch (err) {
      return { success: false, error: 'API 호출 실패: ' + err.message };
    }
  }

  /* ──────────── 의료기관 대량 캐싱 (반경 기반) ────────────
     사용자가 API 키 설정 후 "미리 불러오기" 버튼 클릭 시 호출.
     26개 진료과 × 5페이지(병원) + 약국(1페이지) + 응급실(5페이지 전국) 순차 조회.
     각 요청 사이 rate-limit 지연, 진행률을 progressCb 로 실시간 전달. */
  async bulkFetchMedFacilitiesInRadius(serviceKey, emergencyKey, params, progressCb) {
    const result = {
      success: false,
      baseLocation: { lat: params.lat, lng: params.lng, address: params.address||'' },
      radiusKm: params.radiusKm || 30,
      fetchedAt: new Date().toISOString(),
      hospitals: [], pharmacies: [], emergency: [],
      stats: { hospitals:0, pharmacies:0, emergency:0, apiCalls:0, errors:0 }
    };
    if (!normalizePublicDataApiKey(serviceKey)) { result.error = '심평원 API 키가 없습니다.'; return result; }
    const xPos = params.lng, yPos = params.lat, radius = (params.radiusKm||60)*1000;
    const _delay = (ms) => new Promise(r => setTimeout(r, ms));
    const _emit = (phase, done, total, msg) => {
      if (typeof progressCb === 'function') progressCb({ phase, done, total, msg });
    };

    /* ── 병원 (진료과 26개 × 5페이지) ── */
    const DEPT_CODES = ['01','02','03','04','05','06','08','09','10','11','12','13','14','15','21','23','24','49'];
    /* 진료과가 없는 일반 병원도 포함 — clCd 기준 병원/의원/종합병원 전체 1회 (dgsbjtCd 없이) */
    const hospSeen = {};
    const phases = DEPT_CODES.length + 1; /* +1 = 진료과 무관 전체 */
    let phaseDone = 0;
    _emit('hospitals', 0, phases, '병원 기본 목록 수집 시작');

    /* 전체 (진료과 무관) — 2페이지 */
    for (let pg=1; pg<=2; pg++) {
      try {
        const r = await this.fetchMedFacilities(serviceKey, { type:'hospital', xPos, yPos, radius, numOfRows:100, pageNo:pg });
        result.stats.apiCalls++;
        if (r && r.success && Array.isArray(r.data)) {
          r.data.forEach(d => { const k = d.ykiho||d.yadmNm; if (k && !hospSeen[k]) { hospSeen[k]=1; result.hospitals.push(d); } });
        }
      } catch(e){ result.stats.errors++; }
      await _delay(300);
    }
    phaseDone++;
    _emit('hospitals', phaseDone, phases, '전체 병원 '+result.hospitals.length+'건');

    /* 진료과별 — 각 과 최대 3페이지 */
    for (const cd of DEPT_CODES) {
      for (let pg=1; pg<=3; pg++) {
        try {
          const r = await this.fetchMedFacilities(serviceKey, { type:'hospital', xPos, yPos, radius, numOfRows:100, pageNo:pg, dgsbjtCd:cd });
          result.stats.apiCalls++;
          if (r && r.success && Array.isArray(r.data) && r.data.length) {
            r.data.forEach(d => {
              const k = d.ykiho||d.yadmNm;
              if (k) {
                if (!hospSeen[k]) { hospSeen[k]=1; d._depts=[cd]; result.hospitals.push(d); }
                else {
                  /* 이미 있는 병원 → 진료과 코드만 추가 */
                  const existing = result.hospitals.find(h => (h.ykiho||h.yadmNm)===k);
                  if (existing) { existing._depts = existing._depts||[]; if(existing._depts.indexOf(cd)===-1) existing._depts.push(cd); }
                }
              }
            });
            if (r.data.length < 100) break; /* 페이지 끝 */
          } else {
            break;
          }
        } catch(e){ result.stats.errors++; }
        await _delay(300);
      }
      phaseDone++;
      _emit('hospitals', phaseDone, phases, '진료과 '+cd+' 조회 완료 · 누적 '+result.hospitals.length+'건');
    }

    /* ── 약국 — 3페이지 ── */
    _emit('pharmacies', 0, 1, '약국 목록 수집');
    const pharmSeen = {};
    for (let pg=1; pg<=3; pg++) {
      try {
        const r = await this.fetchMedFacilities(serviceKey, { type:'pharmacy', xPos, yPos, radius, numOfRows:100, pageNo:pg });
        result.stats.apiCalls++;
        if (r && r.success && Array.isArray(r.data) && r.data.length) {
          r.data.forEach(d => { const k=d.ykiho||d.yadmNm; if (k && !pharmSeen[k]) { pharmSeen[k]=1; result.pharmacies.push(d); } });
          if (r.data.length < 100) break;
        } else break;
      } catch(e){ result.stats.errors++; }
      await _delay(300);
    }
    _emit('pharmacies', 1, 1, '약국 '+result.pharmacies.length+'건');

    /* ── 응급실 — 국립중앙의료원 응급의료 API 는 좌표·반경 필터 미지원, 전국 리스트 페이지 단위 반환 ──
       전국 ≈ 600~700개 → 20페이지(≈1000건) 로 전국 전체 커버 확실히 확보 후
       기준지 좌표 기준 거리 계산 → 반경 내(응급실은 80km로 넉넉히)만 남기고 가까운 순 정렬하여 저장. */
    if (emergencyKey) {
      _emit('emergency', 0, 1, '응급실 목록 수집 (전국 스캔)');
      const emgSeen = {};
      const emgRawPool = [];
      for (let pg=1; pg<=20; pg++) {
        try {
          const r = await this.fetchEmergencyInfo(emergencyKey, { lat:yPos, lng:xPos, pageNo:pg });
          result.stats.apiCalls++;
          if (r && r.success && Array.isArray(r.data) && r.data.length) {
            r.data.forEach(d => { const k=d.hpid||d.dutyName; if (k && !emgSeen[k]) { emgSeen[k]=1; emgRawPool.push(d); } });
            if (r.data.length < 50) break;
          } else break;
        } catch(e){ result.stats.errors++; }
        await _delay(300);
      }
      _emit('emergency', 0.5, 1, '응급실 전국 '+emgRawPool.length+'건 수집 → 기준지 반경 내 필터링');
      /* 거리 계산 + 80km 필터 + 거리 오름차순 정렬 */
      const EMG_RADIUS_KM = 80;
      const _d = (a,b,c,d) => { const R=6371, r=Math.PI/180, dL=(c-a)*r, dG=(d-b)*r;
        const x=Math.sin(dL/2)**2 + Math.cos(a*r)*Math.cos(c*r)*Math.sin(dG/2)**2;
        return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
      const enriched = emgRawPool
        .map(d => {
          const lat = parseFloat(d.wgs84Lat || 0);
          const lng = parseFloat(d.wgs84Lon || 0);
          const dist = (lat && lng) ? _d(yPos, xPos, lat, lng) : 9999;
          d._distKm = dist;
          return d;
        })
        .filter(d => d._distKm <= EMG_RADIUS_KM)
        .sort((a,b) => a._distKm - b._distKm);
      result.emergency = enriched;
      _emit('emergency', 1, 1, '응급실 기준지 '+EMG_RADIUS_KM+'km 이내 '+enriched.length+'건 (가까운 순 정렬)');
    }

    result.stats.hospitals = result.hospitals.length;
    result.stats.pharmacies = result.pharmacies.length;
    result.stats.emergency = result.emergency.length;
    result.success = true;
    return result;
  }

  /* ──────────── 국립중앙의료원 응급의료정보 ──────────── */

  async fetchEmergencyInfo(serviceKey, params) {
    if (!normalizePublicDataApiKey(serviceKey)) return { success: false, error: '응급의료 API 키를 입력해 주세요' };
    const { lat, lng, pageNo } = params || {};
    /* 좌표 기반 응급실 목록+실시간 정보 조회 */
    let url = 'http://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire'
      + '?serviceKey=' + encodePublicDataApiKey(serviceKey)
      + '&WGS84_LON=' + (lng || 127)
      + '&WGS84_LAT=' + (lat || 36.5)
      + '&numOfRows=50&pageNo=' + (pageNo || 1)
      + '&_type=json';
    try {
      const response = await fetch(url);
      const data = await response.json();
      const body = data && data.response && data.response.body;
      const items = body && body.items && body.items.item;
      if (!items) return { success: true, data: [], totalCount: 0 };
      const list = Array.isArray(items) ? items : [items];
      return { success: true, data: list, totalCount: body.totalCount || list.length };
    } catch (err) {
      return { success: false, error: 'API 호출 실패: ' + err.message };
    }
  }

  /* ──────────── 국립중앙의료원 응급실 상세정보 (HPID 기반) ──────────── */

  async fetchEmergencyDetail(serviceKey, hpid) {
    if (!normalizePublicDataApiKey(serviceKey) || !hpid) return null;
    const url = 'http://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytBassInfoInqire'
      + '?serviceKey=' + encodePublicDataApiKey(serviceKey) + '&HPID=' + hpid + '&pageNo=1&numOfRows=1&_type=json';
    try {
      const response = await fetch(url);
      const data = await response.json();
      const items = data && data.response && data.response.body && data.response.body.items && data.response.body.items.item;
      if (!items) return null;
      return Array.isArray(items) ? items[0] : items;
    } catch { return null; }
  }

  /* ──────────── 질병관리청 감염병 발생현황 (웹 스크래핑) ──────────── */

  async fetchInfectiousDisease() {
    try {
      /* 질병관리청 감염병포털에서 주간 발생현황 가져오기 */
      const url = 'https://dportal.kdca.go.kr/pot/is/summaryRgin.do';
      const response = await fetch(url);
      const html = await response.text();
      /* HTML에서 데이터 추출 — 테이블이 있으면 파싱 */
      return { success: true, data: html, source: 'kdca' };
    } catch (err) {
      return { success: false, error: '질병관리청 데이터 가져오기 실패: ' + err.message };
    }
  }

  /* ──────────── Google Sheets 공개 CSV ──────────── */

  async fetchPublicSheetCsv(spreadsheetId) {
    if (!spreadsheetId) return { success: false, error: '스프레드시트 ID가 없습니다' };
    const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId
      + '/gviz/tq?tqx=out:csv&sheet=Sheet1&range=A:B';
    const response = await fetch(url);
    const csv = await response.text();
    return { success: true, data: { csv } };
  }
}

/* ══════════ WeatherService ══════════ */

/**
 * WeatherService — 날씨/공기질/위치 API 래퍼
 * 모든 메서드는 순수 비동기 함수입니다 (내부 상태 없음).
 */
class WeatherService {
  async getIpLocation() {
    try {
      const response = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      return {
        latitude: data.latitude || 37.5665,
        longitude: data.longitude || 126.9780,
        city: data.city || ''
      };
    } catch (e) {
      console.warn('[weather] ipwho.is 실패:', e.message);
      return { latitude: 37.5665, longitude: 126.9780, city: '' };
    }
  }

  async reverseGeocode(lat, lon) {
    try {
      const url = 'https://nominatim.openstreetmap.org/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&format=json&accept-language=ko&zoom=10';
      const response = await fetch(url, { headers: { 'User-Agent': 'OrangePharmDiary/1.0' }, signal: AbortSignal.timeout(5000) });
      const geo = await response.json();
      const addr = geo.address || {};
      return { city: addr.city || addr.town || addr.county || addr.state || '' };
    } catch (e) {
      console.warn('[weather] reverseGeocode 실패:', e.message);
      return { city: '' };
    }
  }

  async getOpenMeteoWeather(lat, lon) {
    const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min,uv_index_max&timezone=Asia%2FSeoul&forecast_days=1';
    const airUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&current=pm10,pm2_5&hourly=pm10,pm2_5&timezone=Asia%2FSeoul&forecast_days=1';
    const results = await Promise.all([
      fetch(weatherUrl, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(e => { console.warn('[weather] open-meteo 날씨 실패:', e.message); return null; }),
      fetch(airUrl, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(e => { console.warn('[weather] open-meteo 대기 실패:', e.message); return null; })
    ]);
    return { weather: results[0], airQuality: results[1] };
  }

  /* 기상청 생활기상지수 — 자외선지수 (data.go.kr, 학교망에서 작동). open-meteo 차단 환경 대체. (사용자 요청 2026-06-17)
   *  카카오 좌표→법정동코드(b_code)를 areaNo 로 사용. 발표시각 06/18 KST 중 최신.
   *  ※ KMA 키는 '생활기상지수(LivingWthrIdxServiceV4)' 활용신청이 별도로 되어 있어야 함. */
  async getKmaUvByCoord(kmaKey, kakaoRestKey, lat, lon) {
    if (!normalizePublicDataApiKey(kmaKey)) throw new Error('기상청 인증키 없음');
    if (!kakaoRestKey) throw new Error('카카오 REST 키 없음');
    /* 1) 카카오 좌표→법정동코드(areaNo) */
    let areaNo = '';
    const kr = await fetch('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=' + encodeURIComponent(lon) + '&y=' + encodeURIComponent(lat), { headers: { Authorization: 'KakaoAK ' + kakaoRestKey }, signal: AbortSignal.timeout(6000) });
    const ktext = await kr.text();
    let kj; try { kj = JSON.parse(ktext); } catch (_) { throw new Error('카카오 좌표변환 응답 오류(' + kr.status + '): ' + ktext.slice(0, 100)); }
    const docs = (kj && kj.documents) || [];
    const b = docs.find(d => d.region_type === 'B') || docs[0];
    if (b && b.code) areaNo = String(b.code);
    if (!areaNo) throw new Error('카카오 지역코드 변환 실패: ' + JSON.stringify(kj).slice(0, 220));
    /* 2) 기상청 자외선지수 — 발표시각(06/18 KST) 최신 */
    const now = new Date();
    const hh = now.getHours();
    const base = new Date(now);
    let baseHour;
    if (hh >= 18) baseHour = 18; else if (hh >= 6) baseHour = 6; else { baseHour = 18; base.setDate(base.getDate() - 1); }
    const time = base.getFullYear() + String(base.getMonth() + 1).padStart(2, '0') + String(base.getDate()).padStart(2, '0') + String(baseHour).padStart(2, '0');
    /* 공공데이터 인증키는 공통 규칙으로 한 번만 인코딩한다. */
    const _sk = encodePublicDataApiKey(kmaKey);
    /* 생활기상지수 자외선 — 승인 서비스가 V3("3.0") 인지 V4 인지 계정마다 달라, 둘 다 시도해 먼저 되는 쪽 사용.
     *  (사용자 승인 = "생활기상지수 조회서비스(3.0)" = V3. V4 미승인 시 Forbidden, V3 활성화 지연 시 500.) (2026-06-17) */
    const baseTs = new Date(base.getFullYear(), base.getMonth(), base.getDate(), baseHour).getTime();
    let off0 = Math.round(Math.max(0, (now.getTime() - baseTs) / 3600000) / 3) * 3; if (off0 > 24) off0 = 24;
    const _pickUv = function (item) {
      let uv = '';
      for (let o = off0; o >= 0; o -= 3) { const k = 'h' + o; if (item[k] != null && String(item[k]).trim() !== '') { uv = item[k]; break; } }
      if (uv === '') { ['h0', 'h3', 'h6', 'h9'].forEach(function (k) { if (uv === '' && item[k] != null && String(item[k]).trim() !== '') uv = item[k]; }); }
      return uv;
    };
    const eps = ['LivingWthrIdxServiceV3/getUVIdxV3', 'LivingWthrIdxServiceV4/getUVIdxV4'];
    let lastErr = '';
    for (let i = 0; i < eps.length; i++) {
      const url = 'https://apis.data.go.kr/1360000/' + eps[i] + '?serviceKey=' + _sk + '&areaNo=' + encodeURIComponent(areaNo) + '&time=' + time + '&dataType=JSON&numOfRows=10&pageNo=1';
      let rtext = '', st = 0;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        st = r.status; rtext = await r.text();
        const j = JSON.parse(rtext);
        const item = j && j.response && j.response.body && j.response.body.items && j.response.body.items.item && j.response.body.items.item[0];
        if (item) { const uv = _pickUv(item); return { areaNo: areaNo, time: time, uv: (uv === '' ? null : Number(uv)), via: eps[i] }; }
        lastErr = eps[i] + ': ' + ((j && j.response && j.response.header && j.response.header.resultMsg) || 'NODATA');
      } catch (_) { lastErr = eps[i] + '(' + st + '): ' + (rtext ? rtext.slice(0, 50) : 'fetch실패'); }
    }
    throw new Error('기상청 자외선 응답 없음 [' + lastErr + '] — data.go.kr "생활기상지수 조회서비스" 활용신청 승인 직후엔 활성화까지 1~2시간 걸릴 수 있습니다');
  }

  async getKmaWeather(apiKey, lat, lon) {
    const keyForUrl = encodePublicDataApiKey(apiKey);
    if (!keyForUrl) throw new Error('기상청 인증키 없음');
    const g = this._latLonToGrid(lat, lon);
    const now = new Date();
    const baseDate = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');

    /* 초단기예보: 현재 기온, 하늘, 강수 */
    const ultraHours = [2, 5, 8, 11, 14, 17, 20, 23];
    const currentHour = now.getHours();
    let ultraBaseTime = '0200';
    for (let i = ultraHours.length - 1; i >= 0; i--) {
      if (currentHour >= ultraHours[i]) { ultraBaseTime = String(ultraHours[i]).padStart(2, '0') + '00'; break; }
    }
    const ultraUrl = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst?serviceKey=' + keyForUrl + '&numOfRows=60&pageNo=1&dataType=JSON&base_date=' + baseDate + '&base_time=' + ultraBaseTime + '&nx=' + g.nx + '&ny=' + g.ny;

    /* 단기예보: TMN(최저, baseTime=0200) + TMX(최고, baseTime=0500) 둘 다 호출 */
    const vilagBase = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=' + keyForUrl + '&numOfRows=300&pageNo=1&dataType=JSON&nx=' + g.nx + '&ny=' + g.ny;
    const vilagUrl0200 = vilagBase + '&base_date=' + baseDate + '&base_time=0200';
    const vilagUrl0500 = vilagBase + '&base_date=' + baseDate + '&base_time=0500';

    const [ultraRes, vilag0200, vilag0500] = await Promise.all([
      fetch(ultraUrl).then(r => r.json()).catch(() => null),
      fetch(vilagUrl0200).then(r => r.json()).catch(() => null),
      currentHour >= 5 ? fetch(vilagUrl0500).then(r => r.json()).catch(() => null) : Promise.resolve(null),
    ]);

    return { ultra: ultraRes, vilag0200, vilag0500 };
  }

  /* ──────────── private helpers ──────────── */

  _latLonToGrid(lat, lon) {
    const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0;
    const OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
    const DEGRAD = Math.PI / 180.0;
    const re = RE / GRID;
    const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
    const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
    let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
    let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
    let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
    ro = re * sf / Math.pow(ro, sn);
    let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
    ra = re * sf / Math.pow(ra, sn);
    let theta = lon * DEGRAD - olon;
    if (theta > Math.PI) theta -= 2 * Math.PI;
    if (theta < -Math.PI) theta += 2 * Math.PI;
    theta *= sn;
    return {
      nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
      ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5)
    };
  }
}

module.exports = { ExternalApiService, WeatherService };
