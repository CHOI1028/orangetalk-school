/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * infra-config-service.js — 인프라 설정 통합 서비스
 *
 * AppConfigService — 앱 환경 설정 파일 관리
 * CredentialStore — OAuth 토큰 암호화 저장
 */

/* ══════════ AppConfigService ══════════ */

const CONFIG_FILE = 'app-config.json';

/**
 * AppConfigService — 앱 환경 설정 파일 관리
 *
 * 저장 위치: {userData}/app-config.json
 * 내용: 학교 정보, 최초 실행 여부
 *
 * 이 파일은 SQLite DB와 별도로 관리됩니다.
 * - DB는 업무 데이터 (학생, 일지, 설문 등)
 * - config는 학교 메타 정보
 */
class AppConfigService {
  constructor(userDataPath) {
    this._configPath = path.join(userDataPath, CONFIG_FILE);
    this._config = this._load();
  }

  /* ──────────── 파일 I/O ──────────── */

  _load() {
    if (!fs.existsSync(this._configPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this._configPath, 'utf8'));
    } catch (err) {
      console.error('[AppConfig] 설정 파일 읽기 실패:', err.message);
      return null;
    }
  }

  _save() {
    const dir = path.dirname(this._configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._configPath, JSON.stringify(this._config, null, 2), 'utf8');
  }

  /* ──────────── 최초 실행 판별 ──────────── */

  /** 설정 파일이 존재하면 false */
  isFirstRun() {
    return !this._config || !this._config.school;
  }

  /* ──────────── 초기 설정 (최초 실행 시) ──────────── */

  /**
   * 최초 설정을 완료합니다.
   * @param {object} opts
   * @param {string} opts.schoolName - 학교명
   * @param {string} opts.schoolLevel - 'elementary'|'middle'|'high'
   * @param {string} opts.region - 지역 (예: '충청남도')
   * @param {string} opts.teacherName - 보건교사 이름
   */
  setupInitial(opts) {
    this._config = {
      version: 1,
      school: {
        name: opts.schoolName || '',
        level: opts.schoolLevel || 'high',
        region: opts.region || '',
        code: opts.schoolCode || '',
      },
      teacher: {
        name: opts.teacherName || '',
        position: '보건교사',
      },
    };

    this._save();
    return { success: true };
  }

  /* ──────────── 학교/교사 정보 조회·수정 ──────────── */

  getSchoolInfo() {
    if (!this._config) return null;
    return {
      school: this._config.school || {},
      teacher: this._config.teacher || {},
    };
  }

  updateSchoolInfo(school, teacher) {
    if (!this._config) return { success: false, error: '초기 설정이 필요합니다.' };
    if (school) Object.assign(this._config.school, school);
    if (teacher) Object.assign(this._config.teacher, teacher);
    this._save();
    return { success: true };
  }

  /* ──────────── 현재 사용자 ──────────── */

  setCurrentUser(userId) {
    if (!this._config) return;
    this._config.currentUserId = userId || null;
    this._save();
  }

  getCurrentUserId() {
    return this._config ? (this._config.currentUserId || null) : null;
  }

  /* ──────────── 전체 설정 ──────────── */

  getAll() {
    if (!this._config) return null;
    return JSON.parse(JSON.stringify(this._config));
  }

  getConfigPath() {
    return this._configPath;
  }
}

/* ══════════ CredentialStore ══════════ */

const AUTH_DIR_NAME = 'auth';

/**
 * CredentialStore
 *
 * OAuth 토큰을 OS 보안 저장소(macOS Keychain / Windows DPAPI / Linux libsecret)로
 * 암호화해서 userData/auth/ 에 저장합니다.
 *
 * - safeStorage.isEncryptionAvailable() === true  → OS 키체인 암호화
 * - safeStorage.isEncryptionAvailable() === false → Base64 인코딩 (폴백)
 *   → 이 경우 보안 경고 로그 출력
 */
class CredentialStore {
  /**
   * @param {string} userDataPath - app.getPath('userData')
   */
  constructor(userDataPath) {
    this._safeStorage = require('electron').safeStorage;
    this._dir = path.join(userDataPath, AUTH_DIR_NAME);
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this._dir)) {
      fs.mkdirSync(this._dir, { recursive: true });
    }
  }

  _tokenPath(name) {
    return path.join(this._dir, name + '.enc');
  }

  /** 토큰 객체를 암호화해서 저장 */
  saveToken(name, data) {
    try {
      const json = JSON.stringify(data);
      let content;
      if (this._safeStorage.isEncryptionAvailable()) {
        content = this._safeStorage.encryptString(json).toString('base64');
      } else {
        console.warn('[CredentialStore] OS 암호화를 사용할 수 없습니다. 토큰이 Base64로만 저장됩니다.');
        content = Buffer.from(json).toString('base64');
      }
      fs.writeFileSync(this._tokenPath(name), content, 'utf8');
    } catch (err) {
      console.error('[CredentialStore] 토큰 저장 실패:', name, err.message);
    }
  }

  /** 토큰 파일을 복호화해서 반환. 없거나 실패하면 null */
  loadToken(name) {
    try {
      const filePath = this._tokenPath(name);
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!content) return null;

      let json;
      if (this._safeStorage.isEncryptionAvailable()) {
        json = this._safeStorage.decryptString(Buffer.from(content, 'base64'));
      } else {
        json = Buffer.from(content, 'base64').toString('utf8');
      }
      return JSON.parse(json);
    } catch (err) {
      console.warn('[CredentialStore] 토큰 로드 실패:', name, err.message);
      return null;
    }
  }

  /** 토큰 파일 삭제 */
  deleteToken(name) {
    try {
      const filePath = this._tokenPath(name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.warn('[CredentialStore] 토큰 삭제 실패:', name, err.message);
    }
  }

  /**
   * 평문 토큰 파일(oldPath)이 있으면 암호화 저장소로 이전 후 원본 삭제.
   * @returns {boolean} 이전 성공 여부
   */
  migrateFromPlaintext(name, oldPath) {
    try {
      if (!fs.existsSync(oldPath)) return false;
      const raw = fs.readFileSync(oldPath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || !data.refreshToken) return false;

      this.saveToken(name, data);
      fs.unlinkSync(oldPath);
      console.log('[CredentialStore] 평문 토큰 암호화 이전 완료:', path.basename(oldPath));
      return true;
    } catch (err) {
      console.warn('[CredentialStore] 토큰 이전 실패:', name, err.message);
      return false;
    }
  }
}

module.exports = { AppConfigService, CredentialStore };
