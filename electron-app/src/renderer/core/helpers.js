/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * helpers.js — Barrel re-export (하위 호환)
 *
 * 기존 코드의 `import { ... } from './helpers.js'` 경로를 유지합니다.
 * 새 코드는 각 모듈에서 직접 import하세요:
 *   format-utils.js  — escHtml, escJs, toDateStr, dateObj, getDow, isHoliday, isWeekend, getSymClass, getResultClass, getResultLabel
 *   student-utils.js — getStu, isCareStudent, getCareLabel, getStuGradeCol, isKinder, ...
 *   record-utils.js  — recsByDate, getRecordDates, getGrades, getDeptForSymptom, _recToDbRow, ...
 *   ui-utils.js      — closeModalGracefully, createEmptyState, showLoading, hideLoading, showNameHoverPop, ...
 *   data-loader.js   — saveData, saveRecordNow, saveStudents, _syncAllToJson, _eduOfficeList, ...
 *   kiosk-roster.js  — _pushRosterToRelay, _checkKioskRosterStale, _scheduleDailyRosterCheck, ...
 *   view-fragment-loader.js — ViewFragmentLoader, viewFragmentLoader
 */

/* 순수 포맷 유틸 */
export * from './format-utils.js';

/* 학생/교직원 조회·변환 */
export * from './student-utils.js';

/* 보건일지 레코드 조회·변환 */
export * from './record-utils.js';

/* DOM 유틸 */
export * from './ui-utils.js';

/* 부팅·저장·동기화 (사이드 이펙트 포함) */
export { _eduOfficeList, _schoolLevelList, _syncAllToJson, _removeDummyData, saveData, saveRecordNow, saveStudents } from './data-loader.js';

/* 키오스크 명단 동기화 */
export { _pushRosterToRelay, _showKioskRestartNotice, _checkKioskRosterStale, _scheduleDailyRosterCheck } from './kiosk-roster.js';

/* HTML 프래그먼트 로더 */
export { ViewFragmentLoader, viewFragmentLoader } from './view-fragment-loader.js';
