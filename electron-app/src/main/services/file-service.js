/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * file-service.js — 파일 I/O 통합 서비스
 *
 * FolderService — 데이터 폴더 구조 관리 + 범용 파일 I/O
 * JsonFileService — JSON 파일 Atomic Write / Load / Recovery
 */

/* ══════════ FolderService ══════════ */

/**
 * FolderService — 데이터 폴더 구조 관리
 *
 * userData/
 * ├── app-config.json                    # 인증/학교 정보 (AppConfigService)
 * ├── data/
 * │   ├── my_health_diary.sqlite3         # 메인 DB
 * │   ├── templates/                     # 양식 데이터
 * │   │   └── survey-forms/              #   설문 양식 JSON
 * │   ├── surveys/                       # 설문 응답 (연도별)
 * │   │   ├── 2026/
 * │   │   └── ...
 * │   ├── user-assets/                   # 사용자 에셋
 * │   │   ├── visit-pass/                #   방문증 서명/도장
 * │   │   └── newsletter/                #   가정통신문
 * │   ├── exports/                       # 내보내기 임시
 * │   └── backups/                       # 백업
 */
class FolderService {
  constructor(userDataPath) {
    this._root = userDataPath;
    this._dataDir = path.join(userDataPath, 'data');
  }

  /** 앱 시작 시 모든 필수 폴더를 생성합니다 */
  ensureAll() {
    const dirs = [
      this.data(),
      this.templates(),
      this.surveyForms(),
      this.surveys(),
      this.userAssets(),
      this.visitPass(),
      this.newsletter(),
      this.exports(),
      this.backups(),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    return { success: true };
  }

  /* ──────────── 경로 조회 ──────────── */

  /** userData/data/ */
  data() { return this._dataDir; }

  /** userData/data/templates/ */
  templates() { return path.join(this._dataDir, 'templates'); }

  /** userData/data/templates/survey-forms/ */
  surveyForms() { return path.join(this._dataDir, 'templates', 'survey-forms'); }

  /** userData/data/surveys/ */
  surveys() { return path.join(this._dataDir, 'surveys'); }

  /** userData/data/surveys/{year}/ — 연도별 설문 응답 폴더 */
  surveysYear(year) {
    const yr = String(year || new Date().getFullYear());
    const dir = path.join(this.surveys(), yr);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** userData/data/user-assets/ */
  userAssets() { return path.join(this._dataDir, 'user-assets'); }

  /** userData/data/user-assets/visit-pass/ */
  visitPass() { return path.join(this._dataDir, 'user-assets', 'visit-pass'); }

  /** userData/data/user-assets/newsletter/ */
  newsletter() { return path.join(this._dataDir, 'user-assets', 'newsletter'); }

  /** userData/data/exports/ */
  exports() { return path.join(this._dataDir, 'exports'); }

  /** userData/data/backups/ */
  backups() { return path.join(this._dataDir, 'backups'); }

  /** DB 파일 경로 */
  dbFile() { return path.join(this._dataDir, 'my_health_diary.sqlite3'); }

  /* ──────────── 설문 파일 경로 생성 ──────────── */

  /**
   * 설문 응답 JSON 파일명 생성
   * 형식: resp_{formId}_{학년}_{반}_{이름}_{응답일시}.json
   */
  buildSurveyResponseFileName(formId, student, respondedAt) {
    const ts = (respondedAt || new Date().toISOString()).replace(/[-:T]/g, '').substring(0, 14);
    const grade = student.grade || 0;
    const cls = student.class_num || student.classNum || 0;
    const name = (student.name || 'unknown').replace(/[\/\\?%*:|"<>]/g, '_');
    return `resp_${formId}_${grade}_${cls}_${name}_${ts}.json`;
  }

  /** 설문 양식 파일 전체 경로 */
  surveyFormPath(fileName) {
    return path.join(this.surveyForms(), fileName);
  }

  /** 설문 응답 파일 전체 경로 */
  surveyResponsePath(year, fileName) {
    return path.join(this.surveysYear(year), fileName);
  }

  /* ──────────── 파일 I/O 헬퍼 ──────────── */

  readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error('[Folder] JSON 읽기 실패:', filePath, err.message);
      return null;
    }
  }

  writeJson(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  }

  /** 폴더 내 파일 목록 (확장자 필터) */
  listFiles(dirPath, ext) {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter(f => !ext || f.endsWith(ext))
      .map(f => ({
        name: f,
        path: path.join(dirPath, f),
        stat: fs.statSync(path.join(dirPath, f)),
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  }
  /* ──────────── 경로 보안 검증 ──────────── */

  /**
   * 해석된 경로가 허용된 디렉토리 내부에 있는지 검증합니다.
   * 경로 순회 공격(../../)을 방지합니다.
   */
  _assertSafePath(filePath, allowedRoots) {
    const resolved = path.resolve(filePath);
    const roots = Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots];
    const inside = roots.some(root => {
      const normalizedRoot = path.resolve(root) + path.sep;
      return resolved === path.resolve(root) || resolved.startsWith(normalizedRoot);
    });
    if (!inside) {
      throw new Error(`허용되지 않은 경로: ${resolved}`);
    }
    return resolved;
  }

  /* ──────────── 범용 파일 I/O ──────────── */

  /** 파일 저장 (디렉토리 자동 생성, 경로 검증) */
  saveFile(filePath, data) {
    const resolved = this._assertSafePath(filePath, [this._root, this._dataDir]);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, data, 'utf-8');
    return { success: true, filePath: resolved };
  }

  /**
   * 파일 읽기 (__app__/ 접두사 → 앱 디렉토리 변환)
   * 바이너리 파일은 base64로 반환, 경로 검증 포함
   */
  readFile(filePath, appDir) {
    let resolvedPath = filePath;
    if (filePath.startsWith('__app__/')) {
      resolvedPath = path.join(appDir, filePath.replace('__app__/', ''));
    }
    this._assertSafePath(resolvedPath, [this._root, this._dataDir, appDir]);
    if (!fs.existsSync(resolvedPath)) return { success: false, error: 'File not found' };
    const ext = path.extname(resolvedPath).toLowerCase();
    if (['.xlsx','.xls','.pdf','.png','.jpg','.zip'].includes(ext)) {
      const data = fs.readFileSync(resolvedPath).toString('base64');
      return { success: true, data, binary: true };
    }
    const data = fs.readFileSync(resolvedPath, 'utf-8');
    return { success: true, data };
  }

  /** 경로를 열기 (없으면 생성 후 열기, 경로 검증) */
  openPath(folderPath, homePath) {
    const resolved = folderPath.replace('~', homePath);
    this._assertSafePath(resolved, [this._root, homePath]);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  /** 연도별 데이터 폴더 자동 생성 */
  ensureYearFolders() {
    const year = new Date().getFullYear().toString();
    const baseDir = path.join(this._root, 'data', year);
    const yearDirs = [
      'daily_records', 'emergency_care', 'infection_mgmt',
      'survey/health_checkup', 'survey/smoking', 'survey/gender_awareness'
    ];
    yearDirs.forEach(f => {
      const fullPath = path.join(baseDir, f);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });
  }
}

/* ══════════ JsonFileService ══════════ */

/**
 * JsonFileService — JSON 파일 Atomic Write / Load / Recovery
 *
 * - Atomic write: .tmp → 검증 → .bak 보관 → rename
 * - Load with recovery: .bak 자동 복구
 * - 고아 .tmp 파일 정리
 */
class JsonFileService {
  constructor(userDataPath) {
    this._dataDir = path.join(userDataPath, 'data');
  }

  /* ──────────── Atomic Write ──────────── */

  /**
   * JSON 데이터를 안전하게 파일에 기록합니다.
   * .tmp 작성 → 크기/파싱 검증 → .bak 백업 → rename
   * @returns {boolean} 성공 여부
   */
  atomicWrite(filePath, data) {
    const tmp = filePath + '.tmp';
    let json;
    try {
      json = JSON.stringify(data, null, 2);
    } catch (e) {
      console.error('[JSON] 직렬화 실패 (circular reference?):', filePath, e.message);
      return false;
    }
    if (!json || json === 'null' || json === 'undefined') {
      console.error('[JSON] 빈 데이터 저장 거부:', filePath);
      return false;
    }
    fs.writeFileSync(tmp, json, 'utf8');
    /* 쓰기 완료 검증 */
    const written = fs.readFileSync(tmp, 'utf8');
    if (written.length !== json.length) {
      console.error('[JSON] 쓰기 검증 실패 (크기 불일치):', filePath);
      fs.unlinkSync(tmp);
      return false;
    }
    /* JSON 파싱 검증 */
    try { JSON.parse(written); } catch (e) {
      console.error('[JSON] 쓰기 검증 실패 (파싱 불가):', filePath, e.message);
      fs.unlinkSync(tmp);
      return false;
    }
    /* 백업 */
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, filePath + '.bak'); } catch (e) {
        console.error('[JSON] 백업 생성 실패:', filePath, e.message);
      }
    }
    fs.renameSync(tmp, filePath);
    return true;
  }

  /* ──────────── Load with Recovery ──────────── */

  /**
   * JSON 파일을 읽되, 없거나 손상된 경우 .bak에서 자동 복구합니다.
   * @returns {{ data, exists, path, recovered }}
   */
  load(filePath) {
    const bakPath = filePath + '.bak';

    /* 파일 없음 → .bak 복구 시도 */
    if (!fs.existsSync(filePath)) {
      return this._tryRecoverFromBak(filePath, bakPath);
    }

    /* 파일 읽기 */
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) {
      console.error('[JSON] 빈 파일 감지:', filePath);
      return this._tryRecoverFromBak(filePath, bakPath);
    }

    /* JSON 파싱 */
    try {
      return { data: JSON.parse(raw), exists: true, path: filePath, recovered: false };
    } catch (e) {
      console.error('[JSON] 파싱 실패:', filePath, e.message);
      return this._tryRecoverFromBak(filePath, bakPath);
    }
  }

  /* ──────────── 연도별 / 공통 경로 헬퍼 ──────────── */

  yearDir(year) {
    const yr = year || new Date().getFullYear().toString();
    return path.join(this._dataDir, yr);
  }

  yearPath(key, year) {
    return path.join(this.yearDir(year), key + '.json');
  }

  commonPath(key) {
    return path.join(this._dataDir, key + '.json');
  }

  save(key, data, year) {
    const dir = year ? this.yearDir(year) : this.yearDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, key + '.json');
    this.atomicWrite(filePath, data);
    return filePath;
  }

  saveCommon(key, data) {
    if (!fs.existsSync(this._dataDir)) fs.mkdirSync(this._dataDir, { recursive: true });
    const filePath = this.commonPath(key);
    this.atomicWrite(filePath, data);
    return filePath;
  }

  loadByKey(key, year) {
    const filePath = this.yearPath(key, year);
    return this.load(filePath);
  }

  loadCommon(key) {
    const filePath = this.commonPath(key);
    return this.load(filePath);
  }

  flush(items) {
    const year = new Date().getFullYear().toString();
    items.forEach(({ key, data, common }) => {
      if (common) {
        this.saveCommon(key, data);
      } else {
        this.save(key, data, year);
      }
    });
  }

  /* ──────────── 고아 .tmp 파일 정리 ──────────── */

  cleanOrphanedTmpFiles() {
    try {
      if (!fs.existsSync(this._dataDir)) return;
      this._cleanDir(this._dataDir);
    } catch (e) {
      console.error('[JSON] .tmp 정리 실패:', e.message);
    }
  }

  /* ──────────── Private ──────────── */

  _tryRecoverFromBak(filePath, bakPath) {
    if (fs.existsSync(bakPath)) {
      const bakRaw = fs.readFileSync(bakPath, 'utf8');
      if (!bakRaw || !bakRaw.trim()) {
        return { data: null, exists: false, path: filePath, recovered: false };
      }
      const parsed = JSON.parse(bakRaw);
      fs.writeFileSync(filePath, bakRaw, 'utf8');
      console.log('[JSON] .bak에서 복구:', filePath);
      return { data: parsed, exists: true, path: filePath, recovered: true };
    }
    return { data: null, exists: false, path: filePath, recovered: false };
  }

  _cleanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return; }
    entries.forEach(f => {
      const full = path.join(dir, f);
      let stat;
      try { stat = fs.lstatSync(full); } catch (e) { return; }
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) { this._cleanDir(full); return; }
      if (f.endsWith('.tmp')) {
        const orig = full.replace(/\.tmp$/, '');
        if (fs.existsSync(orig)) {
          fs.unlinkSync(full);
          console.log('[JSON] 고아 .tmp 삭제:', f);
        } else {
          fs.renameSync(full, orig);
          console.log('[JSON] .tmp → 원본 복구:', f);
        }
      }
    });
  }
}

module.exports = { FolderService, JsonFileService };
