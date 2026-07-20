/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * 공통 유틸리티 — 서비스 레이어에서 반복되는 패턴 추출
 */

/**
 * JSON 문자열을 안전하게 파싱합니다. 실패 시 기본값을 반환합니다.
 * @param {string} json - JSON 문자열
 * @param {*} [fallback={}] - 파싱 실패 시 반환할 기본값
 * @returns {*}
 */
function safeParse(json, fallback) {
  if (fallback === undefined) fallback = {};
  try { return JSON.parse(json || '{}'); }
  catch (_) { return fallback; }
}

/**
 * 연도 문자열을 정규화합니다.
 * @param {string|number} year - 연도
 * @returns {string}
 */
function normalizeYear(year) {
  return String(year || new Date().getFullYear());
}

/**
 * 프로토타입 오염 키를 검사합니다.
 * @param {object} obj - 검사할 객체
 * @returns {boolean} 안전하면 true
 */
function isSafeObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  /* Object.keys는 __proto__를 열거하지 않으므로 hasOwnProperty 사용 */
  return !dangerous.some(k => Object.prototype.hasOwnProperty.call(obj, k));
}

/**
 * 현재 시각을 ISO 문자열로 반환합니다.
 * @returns {string}
 */
function nowISO() {
  return new Date().toISOString();
}

module.exports = { safeParse, normalizeYear, isSafeObject, nowISO };
