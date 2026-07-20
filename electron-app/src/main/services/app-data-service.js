/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');
const path = require('path');

/* 연도별 데이터(보건일지·응급·감염·연도별 설정)의 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님).
   예) 2025-02-26 → 2024학년도. year 가 명시되면 그대로, 없을 때만 현재 학년도로 폴백. (사용자 지시 2026-06-20) */
function _academicYr(year) {
  if (year) return String(year);
  const n = new Date();
  return String(n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1);
}

/**
 * app-data-service.js — 앱 데이터 통합 서비스 (SQLiteAppDataStore 기반)
 *
 * SettingsService — 앱 설정 관리
 * HealthRecordService — 보건일지 레코드 CRUD
 * MedicalDataService — 의료 데이터 관리 (진료과 매핑, 처치, 투약)
 */

/* ══════════ SettingsService ══════════ */

// UI 환경설정 외 백엔드 관리 설정 키 목록
// (이 목록에 없는 키도 저장 가능하지만, 권장 키 목록)
const KNOWN_KEYS = [
  'schoolName', 'schoolLevel', 'nurseNames', 'totalStudents',
  'treatmentMap', 'medicationMap', 'deptMapping',
  'vipTags', 'customSymptoms', 'symMeds', 'symOintments', 'symPatches',
  'settings', 'grantedUsers', 'drive_sync_config',
  'memos', 'weightMgmt', 'tbTestData',
  'bedConfig', 'bedUsage',
  'collabConfig', 'collabDates',
];

/**
 * SettingsService — 앱 설정 관리 (SQLite 백엔드)
 */
class SettingsService {
  constructor(store) {
    this._store = store;
  }

  /** 단일 설정 값 조회 */
  get(key, defaultValue) {
    const res = this._store.get('common', 'cfg:' + key);
    return res.exists ? res.data : (defaultValue !== undefined ? defaultValue : null);
  }

  /** 단일 설정 값 저장 */
  set(key, value) {
    if (value === null || value === undefined) {
      this._store.set('common', 'cfg:' + key, null); // delete
    } else {
      this._store.set('common', 'cfg:' + key, value);
    }
    return { success: true };
  }

  /** 여러 설정 동시 조회 */
  getMultiple(keys) {
    const out = {};
    (keys || []).forEach(k => { out[k] = this.get(k); });
    return out;
  }

  /** 여러 설정 동시 저장 */
  setMultiple(entries) {
    // entries: { key: value, ... }
    const items = Object.entries(entries || {}).map(([key, value]) => ({
      scope: 'common',
      key: 'cfg:' + key,
      value: value
    }));
    if (!items.length) return { success: true, count: 0 };
    this._store.batchSet(items);
    return { success: true, count: items.length };
  }

  /** 연도별 설정 조회 */
  getYearly(key, year, defaultValue) {
    const yr = _academicYr(year);
    const res = this._store.get('year', 'cfg:' + key, yr);
    return res.exists ? res.data : (defaultValue !== undefined ? defaultValue : null);
  }

  /** 연도별 설정 저장 */
  setYearly(key, value, year) {
    const yr = _academicYr(year);
    this._store.set('year', 'cfg:' + key, value, yr);
    return { success: true };
  }
}

/* ══════════ HealthRecordService ══════════ */

/**
 * HealthRecordService — 보건일지 레코드 CRUD (SQLite 백엔드)
 * 일반 일지, 응급처치, 감염병 레코드를 관리합니다.
 */
class HealthRecordService {
  constructor(store) {
    this._store = store;
  }

  _year(year) { return _academicYr(year); }

  /* ──────────── 일반 보건일지 ──────────── */

  getDailyRecords(year) {
    const res = this._store.get('year', 'records', this._year(year));
    return res.exists && Array.isArray(res.data) ? res.data : [];
  }

  saveDailyRecords(year, records) {
    if (!Array.isArray(records)) throw new Error('records must be an array');
    const yr = this._year(year);
    const clean = records.filter(r => !r._isDummy);
    this._store.set('year', 'records', clean, yr);
    return { success: true, year: yr, count: clean.length };
  }

  /** 단일 레코드 추가 */
  addDailyRecord(year, record) {
    const all = this.getDailyRecords(year);
    all.push(record);
    return this.saveDailyRecords(year, all);
  }

  /** 단일 레코드 수정 (id 기준) */
  updateDailyRecord(year, record) {
    const all = this.getDailyRecords(year);
    const idx = all.findIndex(r => r.id === record.id);
    if (idx < 0) return { success: false, error: 'record not found' };
    all[idx] = Object.assign({}, all[idx], record);
    return this.saveDailyRecords(year, all);
  }

  /** 단일 레코드 삭제 */
  deleteDailyRecord(year, id) {
    const all = this.getDailyRecords(year);
    const next = all.filter(r => r.id !== id);
    return this.saveDailyRecords(year, next);
  }

  /* ──────────── 응급처치 기록 ──────────── */

  getEmergencyRecords(year) {
    const res = this._store.get('year', 'emergency_records', this._year(year));
    return res.exists && Array.isArray(res.data) ? res.data : [];
  }

  saveEmergencyRecords(year, records) {
    const yr = this._year(year);
    const clean = (records || []).filter(r => !r._isDummy);
    this._store.set('year', 'emergency_records', clean, yr);
    return { success: true, year: yr, count: clean.length };
  }

  /* ──────────── 감염병 기록 ──────────── */

  getInfectionRecords(year) {
    const res = this._store.get('year', 'infection_records', this._year(year));
    return res.exists && Array.isArray(res.data) ? res.data : [];
  }

  saveInfectionRecords(year, records) {
    const yr = this._year(year);
    const clean = (records || []).filter(r => !r._isDummy);
    this._store.set('year', 'infection_records', clean, yr);
    return { success: true, year: yr, count: clean.length };
  }

  getInfectionNotes(year) {
    const res = this._store.get('year', 'infection_notes', this._year(year));
    return res.exists ? (res.data || {}) : {};
  }

  saveInfectionNotes(year, notes) {
    this._store.set('year', 'infection_notes', notes || {}, this._year(year));
    return { success: true };
  }

  /* ──────────── ID 생성 유틸 ──────────── */

  /**
   * 레코드 배열에서 다음 사용 가능한 ID를 계산합니다.
   * max(기존ID) + 1 과 Date.now() 중 큰 값을 반환하여 충돌을 방지합니다.
   */
  static calcNextId(records) {
    if (!records || !records.length) return Date.now();
    const maxId = Math.max(...records.map(r => r.id || 0));
    return Math.max(maxId + 1, Date.now());
  }

  /* ──────────── 일괄 저장 (앱 종료 시 flush용) ──────────── */

  saveAllCollections(year, payload) {
    const yr = this._year(year);
    const items = [];
    if (payload.records !== undefined) {
      items.push({ scope: 'year', key: 'records', year: yr, value: (payload.records || []).filter(r => !r._isDummy) });
    }
    if (payload.emergencyRecords !== undefined) {
      items.push({ scope: 'year', key: 'emergency_records', year: yr, value: (payload.emergencyRecords || []).filter(r => !r._isDummy) });
    }
    if (payload.infectionRecords !== undefined) {
      items.push({ scope: 'year', key: 'infection_records', year: yr, value: (payload.infectionRecords || []).filter(r => !r._isDummy) });
    }
    if (payload.infectionNotes !== undefined) {
      items.push({ scope: 'year', key: 'infection_notes', year: yr, value: payload.infectionNotes || {} });
    }
    if (!items.length) return { success: true, count: 0 };
    this._store.batchSet(items);
    return { success: true, count: items.length };
  }
}

/* ══════════ MedicalDataService ══════════ */

const DEFAULT_DEPT_MAPPING = `넘어짐 → 외과
부딪힘 → 외과
찰과상 → 외과
열상 → 외과
타박상 → 외과
골절 → 외과
염좌 → 외과
발목 → 외과
두통 → 내과
복통 → 내과
메스꺼움 → 내과
구토 → 내과
발열 → 내과
어지럼증 → 내과
감기 → 내과
식중독 → 내과
수족구 → 내과
피로 → 내과
수면부족 → 내과
성장통 → 정형외과`;

/**
 * MedicalDataService — 의료 데이터 관리 (진료과 매핑, 처치, 투약)
 */
class MedicalDataService {
  constructor(store) {
    this._store = store;
  }

  /* ──────────── 진료과 매핑 ──────────── */

  getDeptMappingText() {
    const res = this._store.get('common', 'deptMapping');
    return (res.exists && res.data) ? res.data : DEFAULT_DEPT_MAPPING;
  }

  setDeptMappingText(text) {
    this._store.set('common', 'deptMapping', String(text || ''));
    return { success: true };
  }

  /** 증상 → 진료과 추론 */
  getDeptForSymptom(symptom) {
    if (!symptom) return '';
    const text = this.getDeptMappingText();
    const lines = text.split('\n');
    for (const line of lines) {
      const arrowIdx = line.indexOf('→');
      if (arrowIdx < 0) continue;
      const sym = line.substring(0, arrowIdx).trim();
      const dept = line.substring(arrowIdx + 1).trim();
      if (sym && dept && (symptom.includes(sym) || sym.includes(symptom))) {
        return dept;
      }
    }
    return '';
  }

  /** 여러 증상 → 진료과 (첫 번째 매칭) */
  getDeptForSymptoms(symptoms) {
    const arr = Array.isArray(symptoms) ? symptoms : [symptoms];
    for (const sym of arr) {
      const dept = this.getDeptForSymptom(sym);
      if (dept) return dept;
    }
    return '';
  }

  /* ──────────── 처치 매핑 ──────────── */

  getTreatmentMap() {
    const res = this._store.get('common', 'treatmentMap');
    return res.exists && Array.isArray(res.data) ? res.data : [];
  }

  setTreatmentMap(map) {
    this._store.set('common', 'treatmentMap', Array.isArray(map) ? map : []);
    return { success: true };
  }

  getTreatmentForSymptom(symptom) {
    const map = this.getTreatmentMap();
    const entry = map.find(e => e && e.symptom === symptom);
    return entry ? (entry.treatment || '') : '';
  }

  /* ──────────── 투약 매핑 ──────────── */

  getMedicationMap() {
    const res = this._store.get('common', 'medicationMap');
    return res.exists && Array.isArray(res.data) ? res.data : [];
  }

  setMedicationMap(map) {
    this._store.set('common', 'medicationMap', Array.isArray(map) ? map : []);
    return { success: true };
  }

  getMedsForSymptom(symptom) {
    const map = this.getMedicationMap();
    const entry = map.find(e => e && e.symptom === symptom);
    return entry ? (entry.meds || '') : '';
  }

  /* ──────────── 증상별 연고/파스 매핑 ──────────── */

  getSymMeds() {
    const res = this._store.get('common', 'symMeds');
    return res.exists ? res.data : {};
  }

  setSymMeds(data) {
    this._store.set('common', 'symMeds', data || {});
    return { success: true };
  }

  getSymOintments() {
    const res = this._store.get('common', 'symOintments');
    const val = res.exists ? res.data : [];
    return Array.isArray(val) ? val : [];
  }

  setSymOintments(data) {
    this._store.set('common', 'symOintments', Array.isArray(data) ? data : []);
    return { success: true };
  }

  getSymPatches() {
    const res = this._store.get('common', 'symPatches');
    const val = res.exists ? res.data : [];
    return Array.isArray(val) ? val : [];
  }

  setSymPatches(data) {
    this._store.set('common', 'symPatches', Array.isArray(data) ? data : []);
    return { success: true };
  }
  /* ──────────── 활력징후 임계값 ──────────── */

  /**
   * 활력징후 경고 임계값을 반환합니다.
   * 의료 기준: 체온≥37.8℃, 수축기≥140 or 이완기≥90, 맥박≥100, 호흡≥22
   */
  getVitalThresholds() {
    const custom = this._store.get('common', 'vitalThresholds');
    if (custom.exists) return custom.data;
    return {
      temp: 37.8,
      bpSystolic: 140,
      bpDiastolic: 90,
      pulse: 100,
      resp: 22,
    };
  }

  setVitalThresholds(thresholds) {
    this._store.set('common', 'vitalThresholds', thresholds);
    return { success: true };
  }

  /* ──────────── BMI 계산 ──────────── */

  /**
   * 체격 기록 배열에 BMI 및 변화량을 계산하여 추가합니다.
   * @param {Array<{height:number, weight:number, date:string}>} entries
   * @returns {Array<{...entry, bmi:number, bmiChange:number|null}>}
   */
  static computeBmi(entries) {
    if (!entries || !entries.length) return [];
    const sorted = entries.slice().sort((a, b) => (a.date > b.date ? 1 : -1));
    return sorted.map((e, i) => {
      const heightM = e.height / 100;
      const bmi = heightM > 0 ? +(e.weight / (heightM * heightM)).toFixed(1) : 0;
      let bmiChange = null;
      if (i > 0) {
        const prevH = sorted[i - 1].height / 100;
        const prevBmi = prevH > 0 ? sorted[i - 1].weight / (prevH * prevH) : 0;
        bmiChange = +(bmi - prevBmi).toFixed(1);
      }
      return { ...e, bmi, bmiChange };
    });
  }
}

module.exports = { SettingsService, HealthRecordService, MedicalDataService };
