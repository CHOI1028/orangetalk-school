/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/* data.go.kr 전용. 저장값은 바꾸지 않고 전송 시 Encoding/Decoding 키를 통일한다.
 * Kakao/NEIS 등 별도 인증 체계에는 적용하지 않는다.
 * 반복 디코딩은 하지 않으며, 잘못된 % 이스케이프는 원문으로 보존한다. */
function normalizePublicDataApiKey(value) {
  const key = String(value == null ? '' : value).trim();
  try { return /%[0-9a-f]{2}/i.test(key) ? decodeURIComponent(key).trim() : key; }
  catch (_) { return key; }
}

/* URLSearchParams.set에는 normalize를, 문자열 쿼리 조립에는 encode를 사용한다.
 * encode 결과를 다시 encodeURIComponent/URLSearchParams에 넣지 않는다. */
function encodePublicDataApiKey(value) {
  return encodeURIComponent(normalizePublicDataApiKey(value));
}

module.exports = { normalizePublicDataApiKey, encodePublicDataApiKey };
