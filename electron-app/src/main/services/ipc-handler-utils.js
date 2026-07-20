/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * IPC 핸들러 유틸리티 — 반복되는 try-catch 패턴을 래퍼로 추출
 */

/**
 * 동기 IPC 핸들러 래퍼 (ipcMain.handle용)
 * @param {Function} fn - (event, args) => result
 * @returns {Function} wrapped handler
 */
function wrapSync(fn) {
  return function (event, args) {
    try {
      const result = fn(event, args);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };
}

/**
 * 비동기 IPC 핸들러 래퍼 (ipcMain.handle용, async)
 * @param {Function} fn - async (event, args) => result
 * @returns {Function} wrapped handler
 */
function wrapAsync(fn) {
  return async function (event, args) {
    try {
      const result = await fn(event, args);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };
}

/**
 * 데이터 반환 전용 동기 래퍼 — { data: ... } 형태
 * @param {Function} fn - (event, args) => data
 * @returns {Function} wrapped handler
 */
function wrapData(fn) {
  return function (event, args) {
    try {
      return { success: true, data: fn(event, args) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };
}

/**
 * 데이터 반환 전용 비동기 래퍼 — { data: ... } 형태
 * @param {Function} fn - async (event, args) => data
 * @returns {Function} wrapped handler
 */
function wrapAsyncData(fn) {
  return async function (event, args) {
    try {
      return { success: true, data: await fn(event, args) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };
}

module.exports = { wrapSync, wrapAsync, wrapData, wrapAsyncData };
