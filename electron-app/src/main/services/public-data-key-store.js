/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const { normalizePublicDataApiKey } = require('../../shared/public-data-api-key');

/* Only the public-data endpoints used by this app may receive a host credential.
 * A generic JSON URL (including NEIS, other data.go.kr paths, ports or lookalike
 * hosts) must never become a way to export the common key. */
const PUBLIC_DATA_PROXY_PATHS = new Set([
  '/1790387/EIDAPIService/Region',
  '/1790387/EIDAPIService/PeriodBasic',
  '/1790387/EIDAPIService/Age',
  '/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst',
  '/1360000/VilageFcstInfoService_2.0/getVilageFcst',
  '/1360000/LivingWthrIdxServiceV3/getUVIdxV3',
  '/1360000/LivingWthrIdxServiceV4/getUVIdxV4',
  '/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty',
  '/B552584/MsrstnInfoInqireSvc/getMsrstnList',
  '/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList',
  '/B551182/hospInfoServicev2/getHospBasisList',
  '/B551182/pharmacyInfoService/getParmacyBasisList',
  '/B552657/ErmctInfoInqireService/getEgytListInfoInqire',
  '/B552657/ErmctInfoInqireService/getEgytBassInfoInqire',
  '/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
]);

function preparePublicDataProxyRequest(store, inputUrl) {
  const unchanged = { success: true, url: inputUrl, usesStoredKey: false };
  let url;
  try { url = new URL(inputUrl); } catch (_) { return unchanged; }
  if (url.protocol !== 'https:' || url.hostname !== 'apis.data.go.kr' || url.port
      || url.username || url.password || !PUBLIC_DATA_PROXY_PATHS.has(url.pathname)
      || !(url.searchParams.has('serviceKey') || url.searchParams.has('ServiceKey'))) {
    return unchanged;
  }
  let common;
  try { common = store.get('common', 'public_data_api_key'); }
  catch (_) {
    return { success: false, error: '공공데이터 인증키 설정을 확인하지 못했습니다. 다시 시도해 주세요.', errorKind: 'settings' };
  }
  const exists = typeof common === 'string' || !!(common && common.exists);
  if (!exists) return unchanged; // Preserve legacy request bytes, without decoding again.
  const stored = typeof common === 'string' ? common : common.data;
  const key = typeof stored === 'string' ? normalizePublicDataApiKey(stored) : '';
  if (!key) {
    return { success: false, error: '공공데이터 API 연결이 중지되었습니다. 설정에서 공통 인증키를 저장해 주세요.', errorKind: 'disabled' };
  }
  /* Remove all duplicate/case variants, so no upstream parser can select the
   * stale client value. URLSearchParams performs exactly one URL encoding. */
  for (const name of [...url.searchParams.keys()]) {
    if (name.toLowerCase() === 'servicekey') url.searchParams.delete(name);
  }
  url.searchParams.set(url.pathname.startsWith('/B090041/') ? 'ServiceKey' : 'serviceKey', key);
  return { success: true, url: url.href, usesStoredKey: true };
}

/* 공공데이터포털 전용 저장키 선택. 인코딩은 각 API 전송 경계에서만 처리한다.
 * common 키가 없던 이전 버전의 개별 키는 유지하고, 명시적으로 공통 키를
 * 비운 경우에는 예전 키를 다시 활성화하지 않는다. Kakao/NEIS에는 사용하지 않는다. */
function resolveStoredPublicDataApiKey(store, clientValue, legacyKeys) {
  function read(key) {
    try {
      const entry = store.get('common', key);
      if (typeof entry === 'string') return { exists: true, value: entry.trim() };
      if (entry && entry.exists) {
        return { exists: true, value: typeof entry.data === 'string' ? entry.data.trim() : '' };
      }
    } catch (_) {}
    return { exists: false, value: '' };
  }

  const common = read('public_data_api_key');
  if (common.exists) return common.value;
  const provided = typeof clientValue === 'string' ? clientValue.trim() : '';
  if (provided) return provided;
  for (const key of (Array.isArray(legacyKeys) ? legacyKeys : [legacyKeys])) {
    if (!key) continue;
    const legacy = read(key);
    if (legacy.value) return legacy.value;
  }
  return '';
}

module.exports = { resolveStoredPublicDataApiKey, preparePublicDataProxyRequest };
