/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');
const path = require('path');
const KEYS = require('./custom-backup-keys');

/**
 * CustomBackupService — 학교 이동용 "커스텀 설정 백업과 반영" 핵심 로직.
 *
 *  · exportTo(folderPath, localStorageData) : 폴더에 OrangePharm-커스텀-{ts}/ 만들고 모두 저장.
 *  · importFrom(folderPath)                  : 폴더에서 데이터 읽어 AppDataStore + 파일 복원.
 *                                              localStorage 데이터는 결과로 반환 → renderer 가 직접 적용.
 *  · getKeys()                               : renderer 가 localStorage 모을 때 사용할 등록부 노출.
 *
 *  ※ 압축 없음. 사용자가 폴더 그대로 USB 에 복사해서 가져갈 수 있도록 (사용자 정책 2026-05-22).
 *  ※ localStorage 는 renderer 영역이라 main 에서 직접 접근 불가 → renderer 가 모아서 전달.
 */
class CustomBackupService {
  /**
   * @param {Object} appDataStore  - get/set 메소드를 가진 AppDataStore
   * @param {string} userDataPath  - userData 절대경로 (예: %APPDATA%\MyHealthDiary\)
   */
  constructor(appDataStore, userDataPath) {
    this._store = appDataStore;
    this._userDataPath = userDataPath;
  }

  /** 등록부 + 자동발견 hint 를 renderer 에 제공 (deep copy). */
  getKeys() {
    return JSON.parse(JSON.stringify({
      categories: KEYS.categories,
      localStorageKeys: KEYS.localStorageKeys,
      localStoragePrefixes: KEYS.localStoragePrefixes,
      appDataCommonKeys: KEYS.appDataCommonKeys,
      autoDiscoveryHints: KEYS.autoDiscoveryHints,
    }));
  }

  /**
   * 백업 실행.
   * @param {string} folderPath        - 사용자가 선택한 부모 폴더 (예: D:\백업\)
   * @param {Object} localStorageData  - renderer 에서 모은 { key: value } 객체 (선택된 카테고리 분만 전달됨)
   * @param {string[]} [selectedIds]   - 백업할 카테고리 id 배열. 미지정 시 전체 백업 (하위호환).
   * @returns {Object}  { success, path, localStorageCount, appDataCommonCount, fileCount, undiscoveredKeys }
   */
  exportTo(folderPath, localStorageData, selectedIds) {
    if (!folderPath) throw new Error('folderPath 가 필요합니다.');
    if (!fs.existsSync(folderPath)) throw new Error('선택한 폴더가 존재하지 않습니다: ' + folderPath);

    /* 백업 폴더 이름: OrangePharm-커스텀-YYYY-MM-DD-HHMM */
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
             + '-' + pad(now.getHours()) + pad(now.getMinutes());
    const backupDir = path.join(folderPath, 'OrangePharm-커스텀-' + ts);
    fs.mkdirSync(backupDir, { recursive: true });

    /* 1) localStorage.json — renderer 가 모은 데이터 그대로 저장 */
    const lsObj = (localStorageData && typeof localStorageData === 'object') ? localStorageData : {};
    fs.writeFileSync(
      path.join(backupDir, 'localStorage.json'),
      JSON.stringify(lsObj, null, 2),
      'utf8'
    );

    /* 2) app-data-common.json — AppDataStore 의 common namespace 에서 등록 키들 추출 */
    const cdObj = {};
    KEYS.collect('appDataCommonKeys', selectedIds).forEach(key => {
      try {
        const val = this._store.get('common', key);
        if (key === 'public_data_api_key') {
          /* 공통 키는 미등록/명시적 비움 상태가 다르므로 wrapper 자체를 저장하지 않는다. */
          if (typeof val === 'string') cdObj[key] = val;
          else if (val && val.exists && typeof val.data === 'string') cdObj[key] = val.data;
          return;
        }
        if (val !== undefined && val !== null) cdObj[key] = val;
      } catch (e) { /* 키 없으면 skip */ }
    });
    fs.writeFileSync(
      path.join(backupDir, 'app-data-common.json'),
      JSON.stringify(cdObj, null, 2),
      'utf8'
    );

    /* 3) files/ — userData 의 단일 파일들 복사 (존재할 때만) */
    let copiedFiles = 0;
    const filesDir = path.join(backupDir, 'files');
    KEYS.collect('files', selectedIds).forEach(rel => {
      const src = path.join(this._userDataPath, rel);
      if (fs.existsSync(src)) {
        const dest = path.join(filesDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copiedFiles++;
      }
    });

    /* 4) MANIFEST.json — 백업 메타 정보 (검증·진단용) */
    const manifest = {
      app: 'OrangePharmDiary',
      kind: 'custom-backup',
      version: '1',
      exportedAt: now.toISOString(),
      counts: {
        localStorage: Object.keys(lsObj).length,
        appDataCommon: Object.keys(cdObj).length,
        files: copiedFiles,
      },
    };
    fs.writeFileSync(
      path.join(backupDir, 'MANIFEST.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    /* 5) README.txt — 컴맹 선생님도 알아볼 수 있는 한글 안내 */
    const readme =
      '오렌지톡 — 커스텀 설정 백업\n' +
      '======================================\n' +
      '백업 일시: ' + now.toLocaleString('ko-KR') + '\n' +
      '\n' +
      '이 폴더에는 학교 이동 시 옮겨갈 모든 사용자 커스텀 설정이 들어 있습니다:\n' +
      '  · 자주 쓰는 처치 (증상별)\n' +
      '  · 사용자 추가 중분류 증상\n' +
      '  · 중분류 증상 순서 / 숨김\n' +
      '  · 약품 매칭·이름 변경·숨김\n' +
      '  · API 키 (Kakao·HIRA·기상청·식약처·응급의료 등)\n' +
      '  · 열필드 너비, 탭 순서·숨김\n' +
      '  · 배경 / 테마 / 폰트 / 글래스\n' +
      '  · 홈 위젯 배치\n' +
      '  · 커스텀 양식 출력 (방문확인증 슬롯·서명·도장 이미지)\n' +
      '  · 키오스크 정의 / 커스텀 설문\n' +
      '\n' +
      '──────────────────────────────────────\n' +
      '새 학교 PC 에서 적용하는 방법\n' +
      '──────────────────────────────────────\n' +
      '  1. 오렌지톡 실행\n' +
      '  2. 설정 → 데이터 백업과 삭제 → "📤 커스텀 설정 파일 적용하기" 클릭\n' +
      '  3. 이 폴더 (OrangePharm-커스텀-' + ts + ') 를 선택\n' +
      '  4. 자동 적용 완료 → 앱 자동 재시작\n' +
      '\n' +
      '※ 학생/교직원 명단, 보건일지 기록, 학교 위치, 침상 설정은 이 백업에\n' +
      '   포함되지 않으니, 새 학교에서 별도로 등록하세요.\n';
    fs.writeFileSync(path.join(backupDir, 'README.txt'), readme, 'utf8');

    return {
      success: true,
      path: backupDir,
      localStorageCount: Object.keys(lsObj).length,
      appDataCommonCount: Object.keys(cdObj).length,
      fileCount: copiedFiles,
    };
  }

  /**
   * 복원 실행.
   * @param {string} folderPath  - 사용자가 선택한 OrangePharm-커스텀-XXX 폴더
   * @returns {Object}  { success, localStorageData, localStorageCount, appDataCommonCount, fileCount }
   *                    localStorageData 는 renderer 가 적용할 { key: value } 객체.
   */
  importFrom(folderPath) {
    if (!folderPath) throw new Error('folderPath 가 필요합니다.');
    if (!fs.existsSync(folderPath)) throw new Error('선택한 폴더가 존재하지 않습니다: ' + folderPath);

    /* 폴더 검증 — MANIFEST.json 또는 localStorage.json 이 있어야 유효한 백업 */
    const manifestPath = path.join(folderPath, 'MANIFEST.json');
    const lsPath = path.join(folderPath, 'localStorage.json');
    if (!fs.existsSync(manifestPath) && !fs.existsSync(lsPath)) {
      throw new Error('이 폴더는 오렌지팜 커스텀 백업 폴더가 아닙니다.\n(MANIFEST.json 또는 localStorage.json 파일을 찾을 수 없습니다.)');
    }

    /* 1) localStorage.json 읽음 (renderer 가 적용할 데이터) */
    let lsObj = {};
    if (fs.existsSync(lsPath)) {
      try {
        const raw = fs.readFileSync(lsPath, 'utf8');
        lsObj = JSON.parse(raw);
        if (!lsObj || typeof lsObj !== 'object' || Array.isArray(lsObj)) lsObj = {};
      } catch (e) {
        throw new Error('localStorage.json 파싱 실패: ' + e.message);
      }
    }

    /* 2) app-data-common.json 읽어 AppDataStore.set 으로 복원 */
    const cdPath = path.join(folderPath, 'app-data-common.json');
    let cdCount = 0;
    if (fs.existsSync(cdPath)) {
      let cdObj = {};
      try {
        cdObj = JSON.parse(fs.readFileSync(cdPath, 'utf8'));
        if (!cdObj || typeof cdObj !== 'object' || Array.isArray(cdObj)) cdObj = {};
      } catch (e) {
        throw new Error('app-data-common.json 파싱 실패: ' + e.message);
      }
      Object.keys(cdObj).forEach(key => {
        try {
          let value = cdObj[key];
          if (key === 'public_data_api_key') {
            if (value && typeof value === 'object') {
              if (!value.exists) return;
              value = value.data;
            }
            if (typeof value !== 'string') return;
          }
          this._store.set('common', key, value);
          cdCount++;
        } catch (e) {
          console.warn('[custom-backup-import] app-data set 실패:', key, e.message);
        }
      });
    }

    /* 3) files/ 안의 모든 파일을 userData/ 의 같은 상대경로로 복사 */
    let fileCount = 0;
    const filesDir = path.join(folderPath, 'files');
    if (fs.existsSync(filesDir) && fs.statSync(filesDir).isDirectory()) {
      const walk = (dir) => {
        fs.readdirSync(dir).forEach(name => {
          const full = path.join(dir, name);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) walk(full);
          else {
            const rel = path.relative(filesDir, full);
            const dest = path.join(this._userDataPath, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(full, dest);
            fileCount++;
          }
        });
      };
      walk(filesDir);
    }

    return {
      success: true,
      localStorageData: lsObj,
      localStorageCount: Object.keys(lsObj).length,
      appDataCommonCount: cdCount,
      fileCount,
    };
  }
}

module.exports = { CustomBackupService };
