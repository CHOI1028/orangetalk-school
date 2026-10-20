'use strict';

// 진단에는 허용한 코드와 고정 문구만 담는다. 오류 메시지, URL, 키, 응답 원문은 반환하지 않는다.
const NETWORK_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_HANDSHAKE_TIMEOUT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED', 'CERT_REVOKED', 'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED',
  'UND_ERR_PRX_TLS', 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
  'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_ABORTED', 'ERR_INTERNET_DISCONNECTED',
  'ERR_ADDRESS_UNREACHABLE', 'ERR_NETWORK_CHANGED', 'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_INVALID', 'ERR_SSL_PROTOCOL_ERROR',
  'ERR_PROXY_AUTH_UNSUPPORTED', 'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED'
]);
const API_NAMES = new Set([
  'APPLICATION_ERROR', 'HTTP_ERROR', 'SERVICETIMEOUT_ERROR',
  'INVALID_REQUEST_PARAMETER_ERROR', 'NO_OPENAPI_SERVICE_ERROR',
  'SERVICE_KEY_IS_NULL', 'PERMISSION_DENIED', 'SERVICE_ACCESS_DENIED_ERROR',
  'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', 'DEADLINE_HAS_EXPIRED_ERROR',
  'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
  'LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR',
  'BLACKLIST_IP_ACCESS_ERROR'
]);
const API_CODES = new Set(['00', '01', '04', '05', '10', '12', '20', '22', '23', '29', '30', '31']);
const LABELS = {
  success: ['정상 응답', '외부 API 조회가 정상 처리되었습니다.', '이번 요청의 정상 응답이며 다른 기능이나 다른 PC의 정상 동작을 보증하지 않습니다.'],
  missing_key: ['인증키 미설정', '약품 검색에 사용할 인증키가 설정되어 있지 않습니다.', 'API Key 관리에서 기존 키의 저장 상태를 확인하세요. 키 원문은 전달하지 마세요.'],
  no_query: ['요청 전', '검색어가 없어 API 요청을 보내지 않았습니다.', '완성된 글자가 포함된 약품명을 두 글자 이상 입력하세요.'],
  invalid_input: ['요청 구성 실패', '약품 검색 요청을 구성하지 못했습니다.', '키나 검색어 원문을 공유하지 말고 프로그램의 요청 구성을 점검하세요.'],
  dns: ['서버 주소 조회 실패', 'API 서버 주소를 찾는 과정에서 오류가 발생했습니다.', '이 오류만으로 학교망 차단을 단정하지 마세요. 해당 PC의 DNS와 프록시 경로를 확인하세요.'],
  tls: ['보안 연결 오류', 'API 서버와 보안 연결을 완료하지 못했습니다.', 'PC 시각과 인증서 신뢰 설정을 확인하세요. 인증서 검증을 끄거나 보안 경고를 무시하지 마세요.'],
  timeout: ['응답 대기 시간 초과', '정해진 시간 안에 API 요청을 완료하지 못했습니다.', '서버 지연, 연결 경로 또는 프록시 상태를 구분해 확인하세요. 키 오류로 단정하지 마세요.'],
  proxy: ['프록시 연결 오류', '프록시를 통한 연결에서 오류가 발생했습니다.', '학교 전산 담당자와 프록시 설정을 확인하세요. 프록시 주소나 계정은 진단에 포함하지 않습니다.'],
  network: ['연결 오류', 'API 서버와의 연결을 완료하지 못했습니다.', '브라우저 결과와 비교하고 앱별 통신 허용 및 연결 경로를 점검하세요.'],
  aborted: ['요청 중단', 'API 요청이 중단되었습니다.', '중단 원인을 별도로 확인하세요. 인증키 문제를 뜻하지 않습니다.'],
  http: ['HTTP 오류 응답', 'API 요청에 정상 범위 밖의 HTTP 응답이 반환되었습니다.', 'HTTP 상태와 API 오류 코드를 함께 확인하세요.'],
  api: ['API 오류 응답', 'API에서 오류 응답을 반환했습니다.', '아래 API 코드와 오류명을 함께 확인하세요. 코드 20만으로 키 누락과 권한 문제를 구분할 수 없습니다.'],
  response: ['예상하지 못한 응답 형식', 'API 응답을 약품 조회 결과로 해석하지 못했습니다.', '응답 원문은 수집하지 않습니다. API 또는 중간 연결 장비의 응답인지 확인하세요.'],
  unknown: ['통신 오류 미분류', '약품 조회 중 분류되지 않은 오류가 발생했습니다.', '원문 오류는 키 보호를 위해 제외했습니다. 이 진단만으로 원인을 확정하지 마세요.']
};
const STAGES = {
  prepare: '요청 구성', request: '연결 및 응답 헤더 수신',
  body: '응답 본문 수신', parse: '응답 해석', service: 'API 처리 결과 확인', complete: '완료'
};

function collectCodes(error) {
  const queue = [error], seen = new Set(), codes = new Set();
  for (let n = 0; queue.length && n < 32; n++) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (typeof item.code === 'string' && NETWORK_CODES.has(item.code)) codes.add(item.code);
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 16));
  }
  return Array.from(codes);
}

function readPublicDataError(payload) {
  let message = '', alternate = '', code = '', errorEnvelope = false;
  if (typeof payload === 'string') {
    const tag = name => {
      const match = payload.match(new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([^<]{0,256})</(?:[\\w.-]+:)?' + name + '>', 'i'));
      return match ? match[1].trim() : '';
    };
    message = tag('errMsg') || tag('resultMsg');
    alternate = tag('returnAuthMsg');
    code = tag('returnReasonCode') || tag('resultCode');
    errorEnvelope = /<(?:[\w.-]+:)?(?:OpenAPI_ServiceResponse|cmmMsgHeader)\b/i.test(payload);
  } else if (payload && typeof payload === 'object') {
    const wrapper = payload.OpenAPI_ServiceResponse;
    errorEnvelope = !!wrapper;
    const header = (wrapper && wrapper.cmmMsgHeader) || payload.header || (payload.response && payload.response.header) || {};
    message = typeof header.errMsg === 'string' ? header.errMsg : (typeof header.resultMsg === 'string' ? header.resultMsg : '');
    alternate = typeof header.returnAuthMsg === 'string' ? header.returnAuthMsg : '';
    const value = header.returnReasonCode == null ? header.resultCode : header.returnReasonCode;
    code = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  }
  const name = [message.trim(), alternate.trim()].find(value => API_NAMES.has(value));
  if (!errorEnvelope && !name && (!code || code === '00' || code === '0')) return null;
  return { name: name || 'UNKNOWN', code: API_CODES.has(code) ? code : 'UNKNOWN' };
}

function safeVersion(value) {
  return typeof value === 'string' && /^\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]{1,40})?$/.test(value) ? value : '확인 불가';
}

function createDrugSearchDiagnostic(options = {}) {
  const codes = collectCodes(options.error);
  let kind = Object.prototype.hasOwnProperty.call(LABELS, options.kind) ? options.kind : '';
  if (!kind) {
    if (options.timedOut || codes.some(code => code.includes('TIMEOUT') || code.includes('TIMED_OUT') || code === 'ETIMEDOUT')) kind = 'timeout';
    else if (codes.some(code => /CERT|ISSUER|SELF_SIGNED|SIGNATURE|ERR_SSL|ERR_TLS/.test(code))) kind = 'tls';
    else if (codes.some(code => code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ERR_NAME_NOT_RESOLVED')) kind = 'dns';
    else if (codes.some(code => /PROXY|TUNNEL|PRX/.test(code))) kind = 'proxy';
    else if (options.error && options.error.name === 'AbortError') kind = 'aborted';
    else if (codes.length || (options.error && options.error.name === 'TypeError' && options.stage !== 'prepare')) kind = 'network';
    else kind = options.stage === 'prepare' ? 'invalid_input' : 'unknown';
  }
  const api = options.api || {};
  const apiCode = API_CODES.has(api.code) ? api.code : null;
  const apiName = API_NAMES.has(api.name) ? api.name : null;
  let summary = LABELS[kind][1];
  if (kind === 'api' && apiName === 'SERVICE_KEY_IS_NULL') summary = 'API에서 요청에 인증키가 없다는 응답을 반환했습니다.';
  else if (kind === 'api' && ['SERVICE_ACCESS_DENIED_ERROR', 'PERMISSION_DENIED'].includes(apiName)) summary = 'API에서 이용 권한이 확인되지 않는다는 응답을 반환했습니다.';
  else if (kind === 'api' && apiName === 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR') summary = 'API에서 등록되지 않은 인증키라는 응답을 반환했습니다.';
  else if (kind === 'api' && apiName === 'DEADLINE_HAS_EXPIRED_ERROR') summary = 'API에서 사용 기한이 만료되었다는 응답을 반환했습니다.';
  const now = Date.now();
  const started = Number.isFinite(options.started) ? options.started : now;
  const elapsed = Math.max(0, Math.min(86400000, Math.round(now - started)));
  const timestamp = new Date(now + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
  let version = '확인 불가';
  try {
    const electron = require('electron');
    if (electron.app && typeof electron.app.getVersion === 'function') version = safeVersion(electron.app.getVersion());
  } catch (_) { /* 테스트 또는 비 Electron 환경에서는 버전 확인을 생략한다. */ }
  const status = Number.isInteger(options.httpStatus) && options.httpStatus >= 100 && options.httpStatus <= 599 ? options.httpStatus : null;
  const stage = STAGES[options.stage] || '확인 불가';
  const format = ['JSON', 'XML', '기타'].includes(options.format) ? options.format : '미확인';
  const platform = ['win32', 'darwin', 'linux'].includes(process.platform) ? process.platform : '기타';
  const arch = ['x64', 'arm64', 'ia32', 'arm'].includes(process.arch) ? process.arch : '기타';
  const lines = [
    '[오렌지톡 약품 검색 API 연결 진단]',
    '진단 형식: 1', '시각: ' + timestamp,
    '대상: apis.data.go.kr / e약은요 약품 검색',
    '요청 방식: ' + (options.transport === 'chromium' ? 'Node fetch 실패 후 Chromium fetch / HTTPS' : 'Node fetch / HTTPS'),
    '대체 통신 시도: ' + (options.fallbackAttempted === true ? '1회' : '없음'), '프로그램 버전: ' + version,
    '실행 환경: ' + platform + ' ' + arch,
    'Electron: ' + safeVersion(process.versions.electron) + ' / Node: ' + safeVersion(process.versions.node),
    '인증키 설정 여부: ' + (options.keyPresent === true ? '설정됨 (값 제외)' : '없음'),
    '분류 (원인 확정 아님): ' + LABELS[kind][0],
    '결과: ' + summary, '확인 단계: ' + stage,
    '소요 시간: ' + elapsed + ' ms / 요청당 제한: 6000 ms',
    'HTTP 상태: ' + (status == null ? '응답 상태 미수신' : status),
    '응답 형식: ' + format,
    '통신 오류 코드: ' + (codes.length ? codes.join(', ') : '허용된 코드 없음'),
    'API 오류 코드: ' + (apiCode || '없음 또는 미분류'),
    'API 오류명: ' + (apiName || '없음 또는 미분류'),
    '다음 확인: ' + LABELS[kind][2],
    '비교 참고: 브라우저 정상 조회만으로 앱의 연결 경로가 정상이라고 판단할 수 없습니다.',
    '보호: 인증키, 검색어, 전체 URL, 응답 원문, 원문 오류, IP, 계정, 학생 자료는 포함하지 않습니다.',
    '저장/전송: 이 진단은 파일·서버에 자동 저장하거나 전송하지 않습니다.'
  ];
  return { schema: 1, kind, summary, codes, httpStatus: status, apiCode, apiName, report: lines.join('\n') };
}

module.exports = { createDrugSearchDiagnostic, readPublicDataError };
