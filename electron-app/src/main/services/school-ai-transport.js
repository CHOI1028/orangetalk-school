/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. */
'use strict';

const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
function aiError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, safeAiError: true, ...extra });
}
async function readJson(response, maxBytes = 1024 * 1024) {
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw aiError('RESPONSE_SIZE', '응답이 너무 큽니다. 질문 범위를 좁혀 주세요.');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
function requestBody(input, system, schema, outputTokens = 1600) {
  return { model: MODEL, input, system_instruction: system, store: false, stream: false,
    generation_config: { max_output_tokens: outputTokens, thinking_summaries: 'none' },
    ...(schema ? { response_format: { type: 'text', mime_type: 'application/json', schema } } : {}) };
}
function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || '';
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const raw = found ? found[1] : '';
  return Array.isArray(raw) ? String(raw[0] || '') : String(raw || '');
}
async function peekJson(response) {
  try {
    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = typeof response.text === 'function' ? await response.text() : '';
      try { return JSON.parse(text); } catch (_) { return null; }
    }
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        chunks.push(Buffer.from(value));
        if (length > 16384) break;
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) { return null; }
}
function parseRetryAfter(payload, headers, now = Date.now()) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const delays = [];
  for (const detail of details) {
    if (detail?.['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo') continue;
    const duration = detail.retryDelay;
    if (typeof duration === 'string' && /^\d+(?:\.\d+)?s$/.test(duration)) delays.push(Math.ceil(parseFloat(duration) * 1000));
    if (duration && typeof duration === 'object') {
      const seconds = Number(duration.seconds || 0);
      const nanos = Number(duration.nanos || 0);
      if (Number.isFinite(seconds) && Number.isFinite(nanos) && seconds >= 0 && nanos >= 0 && nanos < 1e9) delays.push(Math.ceil(seconds * 1000 + nanos / 1e6));
    }
  }
  const raw = headerValue(headers, 'retry-after').trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) delays.push(Math.ceil(Number(raw) * 1000));
  else if (raw && Number.isFinite(Date.parse(raw))) delays.push(Math.max(0, Date.parse(raw) - now));
  const valid = delays.filter(value => Number.isSafeInteger(value) && value >= 0);
  return valid.length ? Math.max(...valid) : undefined;
}
function quotaPeriod(payload) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const ids = details.filter(detail => detail?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure')
    .flatMap(detail => Array.isArray(detail.violations) ? detail.violations : [])
    .map(item => `${typeof item.quotaId === 'string' ? item.quotaId : ''} ${typeof item.quotaMetric === 'string' ? item.quotaMetric : ''}`);
  if (ids.some(id => /per[_ -]?day|daily/i.test(id))) return 'day';
  if (ids.some(id => /per[_ -]?minute/i.test(id))) return 'minute';
  return 'unknown';
}
function quotaMessage(period, retryAfterMs) {
  const seconds = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : 0;
  if (period === 'day') return 'Gemini 하루 사용량 한도입니다. 내일 다시 이용해 주세요. 분당 제한이 아닙니다.';
  if (period === 'minute') return seconds
    ? `Gemini 분당 요청 한도입니다. 약 ${seconds}초 후 다시 보낼 수 있습니다. 하루 사용량이 끝난 것은 아닙니다.`
    : 'Gemini 분당 요청 한도입니다. 1분 정도 뒤에 다시 보내 주세요. 하루 사용량이 끝난 것은 아닙니다.';
  return seconds
    ? `Gemini 요청 한도입니다. 약 ${seconds}초 후 다시 시도해 주세요. 분당 제한인지 하루 한도인지는 확인하지 못했습니다.`
    : 'Gemini 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요. 분당 제한인지 하루 한도인지는 확인하지 못했습니다.';
}
function quotaError(payload, headers) {
  const delay = parseRetryAfter(payload, headers);
  const period = quotaPeriod(payload);
  const retryAfterMs = delay > 0 ? Math.min(delay, 900000) : undefined;
  return aiError('QUOTA', quotaMessage(period, retryAfterMs), { ...(retryAfterMs ? { retryAfterMs } : {}), quotaPeriod: period });
}
const RETRY_STATUS = new Set([500, 502, 503, 504]);
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function requestGemini(fetchImpl, apiKey, body, signal) {
  const timeout = AbortSignal.timeout(60000);
  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, timeout]) });
    if (!response.ok) {
      if (response.status === 429) throw quotaError(await peekJson(response), response.headers);
      await response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw aiError('KEY', 'API 키와 Gemini 사용 권한을 확인해 주세요.');
      if ([400, 404].includes(response.status)) throw aiError('MODEL', '현재 모델 또는 API 요청을 사용할 수 없습니다. API 키의 모델 접근 권한과 앱 업데이트를 확인해 주세요.');
      if ([500, 502, 503, 504].includes(response.status)) throw aiError('SERVICE', 'Gemini 서비스가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.', { statusCode: response.status, retryable: true });
      throw aiError('SERVICE', 'Gemini 서비스가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.');
    }
    const payload = await readJson(response);
    const usage = payload.usage;
    const tokens = Number.isSafeInteger(usage?.total_tokens) && usage.total_tokens >= 0 ? usage.total_tokens : null;
    if (payload.status !== 'completed') throw aiError('INCOMPLETE', '답변을 끝까지 생성하지 못했습니다. 질문을 나누거나 범위를 좁혀 주세요.', { tokens });
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const text = steps.filter(s => s.type === 'model_output').flatMap(s => Array.isArray(s.content) ? s.content : [])
      .filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n').trim();
    if (!text) throw aiError('EMPTY', '답변을 받지 못했습니다. 질문을 바꾸어 다시 시도해 주세요.', { tokens });
    return { text, tokens, steps };
  } catch (error) {
    if (error.safeAiError) {
      if (!attempt && error.retryable && RETRY_STATUS.has(error.statusCode)) { await wait(1800); continue; }
      throw error;
    }
    if (signal.aborted) throw aiError('CANCELLED', '답변 생성을 중지했습니다.');
    if (timeout.aborted) throw aiError('TIMEOUT', '응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
    throw aiError('NETWORK', 'AI 연결을 완료하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  }
  }
}
module.exports = { MODEL, aiError, readJson, requestBody, requestGemini, parseRetryAfter, quotaPeriod, quotaMessage };
