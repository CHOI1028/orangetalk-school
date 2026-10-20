'use strict';

const DRUG_SEARCH_ORIGIN = 'https://apis.data.go.kr';
const DRUG_SEARCH_PATH = '/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList';
const REQUEST_TIMEOUT_MS = 6000;
const FALLBACK_PARTITION = 'orangetalk-public-api-fallback';

// 연결 실패만 재시도한다. API 오류, HTTP 응답, 본문 해석 오류는 재시도하지 않는다.
const CONNECTION_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_UNTRUSTED', 'CERT_REVOKED',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED', 'UND_ERR_PRX_TLS'
]);
const CHROMIUM_CODES = new Set([
  'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_ABORTED', 'ERR_INTERNET_DISCONNECTED',
  'ERR_ADDRESS_UNREACHABLE', 'ERR_NETWORK_CHANGED', 'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_INVALID', 'ERR_SSL_PROTOCOL_ERROR',
  'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_AUTH_UNSUPPORTED', 'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED'
]);
const SAFE_CODES = new Set([
  ...CONNECTION_CODES, ...CHROMIUM_CODES, 'EACCES', 'EPERM',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH'
]);

function errorCodes(error) {
  const queue = [error], seen = new Set(), codes = new Set();
  for (let count = 0; queue.length && count < 32; count++) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (SAFE_CODES.has(item.code)) codes.add(item.code);
    // Electron은 코드 대신 net::ERR_* 메시지를 반환할 수 있다. 알려진 코드만 추출한다.
    if (typeof item.message === 'string') {
      const match = /^net::(ERR_[A-Z0-9_]+)(?=$|\s)/.exec(item.message);
      if (match && CHROMIUM_CODES.has(match[1])) codes.add(match[1]);
    }
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 16));
  }
  return Array.from(codes);
}

function safeError(error, timedOut) {
  const result = new Error(timedOut ? 'External API request timeout' : 'External API transport failed');
  result.name = timedOut ? 'TimeoutError'
    : (error && ['TypeError', 'AbortError', 'TimeoutError'].includes(error.name) ? error.name : 'Error');
  const codes = errorCodes(error);
  if (timedOut && !codes.includes('ETIMEDOUT')) codes.unshift('ETIMEDOUT');
  if (codes.length) result.code = codes[0];
  result.errors = codes.slice(1).map(code => ({ code }));
  return result;
}

function canRetry(error, timedOut) {
  if (timedOut) return true;
  if (!error || error.name === 'AbortError') return false;
  const codes = errorCodes(error);
  // 접근 정책에 따른 거부나 프로그래밍 오류를 통신 호환성 문제로 취급하지 않는다.
  if (codes.some(code => code === 'EACCES' || code === 'EPERM')) return false;
  return codes.some(code => CONNECTION_CODES.has(code))
    || (error.name === 'TypeError' && error.message === 'fetch failed');
}

function isDrugSearchUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === DRUG_SEARCH_ORIGIN && url.pathname === DRUG_SEARCH_PATH
      && !url.username && !url.password && !url.hash;
  } catch (_) { return false; }
}

function chromiumFetch() {
  try {
    const { app, session } = require('electron');
    if (!app || !app.isReady() || !session || typeof session.fromPartition !== 'function') return null;
    // persist: 없는 전용 세션이다. 기존 세션의 저장 데이터나 프록시·인증서 설정은 바꾸지 않는다.
    const temporarySession = session.fromPartition(FALLBACK_PARTITION, { cache: false });
    if (!temporarySession || typeof temporarySession.fetch !== 'function') return null;
    return (url, options) => temporarySession.fetch(url, options);
  } catch (_) { return null; }
}

async function requestText(fetcher, url, chromium) {
  const controller = new AbortController();
  let timer = null, timedOut = false, stage = 'request', httpStatus = null;
  try {
    // 각 시도에 새 신호를 사용하고, 본문 수신까지 제한 시간을 적용한다.
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('Request timeout'));
      }, REQUEST_TIMEOUT_MS);
    });
    const operation = (async () => {
      const options = chromium
        ? { signal: controller.signal, method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' }
        : { signal: controller.signal };
      const response = await fetcher(url, options);
      if (controller.signal.aborted) throw new Error('Request timeout');
      httpStatus = response.status;
      stage = 'body';
      const text = await response.text();
      return { ok: true, text, httpStatus, stage: 'parse', timedOut: false };
    })();
    return await Promise.race([operation, deadline]);
  } catch (error) {
    return {
      ok: false, error: safeError(error, timedOut), httpStatus, stage, timedOut,
      retryable: stage === 'request' && canRetry(error, timedOut)
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function fetchDrugSearchText(url) {
  if (!isDrugSearchUrl(url)) {
    return {
      ok: false, error: new Error('Unsupported API endpoint'), stage: 'prepare',
      httpStatus: null, timedOut: false, transport: 'node', fallbackAttempted: false
    };
  }
  // 정상 사용자는 기존 Node fetch 한 번으로 끝난다. 다른 API에는 아직 적용하지 않는다.
  const primary = await requestText((input, options) => fetch(input, options), url, false);
  if (primary.ok || !primary.retryable) {
    return { ...primary, transport: 'node', fallbackAttempted: false };
  }
  const alternate = chromiumFetch();
  if (!alternate) return { ...primary, transport: 'node', fallbackAttempted: false };
  const secondary = await requestText(alternate, url, true);
  return { ...secondary, transport: 'chromium', fallbackAttempted: true };
}

// 실제 조회 코드에서 사용하는 경로만 허용한다. 인증·업데이트·임의 URL은 제외한다.
const PUBLIC_API_ROUTES = new Map([
  ['apis.data.go.kr', new Set([
    DRUG_SEARCH_PATH,
    '/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty',
    '/B552584/MsrstnInfoInqireSvc/getMsrstnList',
    '/B090041/openapi/service/SpcdeInfoService/getRestDeInfo',
    '/B551182/pharmacyInfoService/getParmacyBasisList',
    '/B551182/hospInfoServicev2/getHospBasisList',
    '/B552657/ErmctInfoInqireService/getEgytBassInfoInqire',
    '/B552657/ErmctInfoInqireService/getEgytListInfoInqire',
    '/1360000/LivingWthrIdxServiceV3/getUVIdxV3',
    '/1360000/LivingWthrIdxServiceV4/getUVIdxV4',
    '/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst',
    '/1360000/VilageFcstInfoService_2.0/getVilageFcst',
    '/1790387/EIDAPIService/Region', '/1790387/EIDAPIService/PeriodBasic', '/1790387/EIDAPIService/Age'
  ])],
  ['open.neis.go.kr', new Set([
    '/hub/schoolInfo', '/hub/mealServiceDietInfo', '/hub/SchoolSchedule', '/hub/schoolAptInfo',
    '/hub/elsTimetable', '/hub/misTimetable', '/hub/hisTimetable', '/hub/spsTimetable'
  ])],
  ['dportal.kdca.go.kr', new Set(['/pot/is/summaryRgin.do'])],
  ['api.frankfurter.app', new Set(['/latest'])],
  ['query1.finance.yahoo.com', /^\/v8\/finance\/chart\/[A-Za-z0-9^=._%-]+$/],
  ['docs.google.com', /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/gviz\/tq$/],
  ['ipwho.is', new Set(['/'])],
  ['nominatim.openstreetmap.org', new Set(['/reverse'])],
  ['api.open-meteo.com', new Set(['/v1/forecast'])],
  ['air-quality-api.open-meteo.com', new Set(['/v1/air-quality'])],
  ['dapi.kakao.com', new Set(['/v2/local/geo/coord2regioncode.json'])]
]);

function fallbackRequest(input, options) {
  try {
    if (typeof input !== 'string') return null;
    const url = new URL(input);
    const route = PUBLIC_API_ROUTES.get(url.hostname);
    const allowed = route && (route instanceof Set ? route.has(url.pathname) : route.test(url.pathname));
    if (!allowed || url.username || url.password || url.hash || url.port) return null;
    // 기존 HTTP 주소는 원래 요청에서만 유지한다. 추가 요청은 공공데이터 HTTPS로만 보낸다.
    if (url.protocol === 'http:' && url.hostname === 'apis.data.go.kr') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    const method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) || options.body != null) return null;
    const headers = new Headers(options.headers || {});
    for (const [name, value] of headers) {
      if (['accept', 'accept-language', 'user-agent'].includes(name)) continue;
      if (name === 'authorization' && url.hostname === 'dapi.kakao.com' && /^KakaoAK\s+\S+$/.test(value)) continue;
      return null;
    }
    return {
      url: url.href,
      options: { method, headers, redirect: 'manual', credentials: 'omit', cache: 'no-store' }
    };
  } catch (_) { return null; }
}

async function openApiResponse(fetcher, url, options, timeoutMs) {
  const controller = new AbortController();
  const callerSignal = options.signal;
  let timer = null, timedOut = false, rejectAbort;
  const interrupted = new Promise((resolve, reject) => { rejectAbort = reject; });
  const cancel = () => controller.abort();
  const cleanup = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (callerSignal) callerSignal.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    const error = new Error('Request interrupted');
    error.name = timedOut ? 'TimeoutError' : 'AbortError';
    rejectAbort(error);
    cleanup();
  };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (callerSignal) {
    callerSignal.addEventListener('abort', cancel, { once: true });
    if (callerSignal.aborted) cancel();
  }
  if (!controller.signal.aborted && timeoutMs > 0) {
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  }
  try {
    // 기존에 제한 시간이 없는 요청에는 Node 경로의 제한 시간을 새로 강제하지 않는다.
    const requestOptions = (timeoutMs > 0 || callerSignal)
      ? { ...options, signal: controller.signal } : options;
    const operation = (async () => {
      if (controller.signal.aborted) {
        const error = new Error('Request interrupted'); error.name = 'AbortError'; throw error;
      }
      const response = await fetcher(url, requestOptions);
      if (controller.signal.aborted) throw new Error('Request interrupted');
      return response;
    })();
    const response = await Promise.race([operation, interrupted]);
    // 본문 오류는 재시도하지 않는다. 키가 섞일 수 있는 원문 오류만 정리한다.
    const protectedResponse = new Proxy(response, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (['text', 'json', 'arrayBuffer', 'blob', 'formData'].includes(property) && typeof value === 'function') {
          return async (...args) => {
            try { return await Promise.race([value.apply(target, args), interrupted]); }
            catch (error) { throw safeError(error, timedOut); }
            finally { cleanup(); }
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    return { ok: true, response: protectedResponse };
  } catch (error) {
    cleanup();
    return {
      ok: false, error: safeError(error, timedOut),
      retryable: !(callerSignal && callerSignal.aborted) && canRetry(error, timedOut)
    };
  }
}

async function fetchExternalApi(input, options = {}) {
  const { timeoutMs: requestedTimeout, ...nodeOptions } = options;
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 0;
  const primary = await openApiResponse((url, init) => fetch(url, init), input, nodeOptions, timeoutMs);
  if (primary.ok) return primary.response;
  if (!primary.retryable) throw primary.error;
  if (nodeOptions.signal && nodeOptions.signal.aborted) throw primary.error;
  const request = fallbackRequest(input, nodeOptions);
  if (!request) throw primary.error;
  const alternate = chromiumFetch();
  if (!alternate) throw primary.error;
  const secondary = await openApiResponse(alternate, request.url,
    { ...request.options, ...(nodeOptions.signal ? { signal: nodeOptions.signal } : {}) },
    timeoutMs || REQUEST_TIMEOUT_MS);
  if (!secondary.ok) throw secondary.error;
  return secondary.response;
}

module.exports = { fetchDrugSearchText, fetchExternalApi };
