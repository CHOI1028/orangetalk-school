/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const { createAppDataStore } = require('./sqlite-app-data-store');
const { SettingsService, HealthRecordService, MedicalDataService } = require('./app-data-service');
const { PlannerStoreService, SurveyStoreService, EditorStateStoreService, NewsletterStoreService } = require('./blob-store-services');
const { StudentsDBService, StaffDBService, UserService } = require('./people-db-service');
const { HealthRecordDBService } = require('./health-record-db-service');
const { SurveyFormService, SurveyResponseService, SurveyDefinitionService } = require('./survey-db-service');
const { StatisticsDBService } = require('./statistics-db-service');
const { ExternalApiService, WeatherService } = require('./external-api-service');
const { DriveSyncService, GoogleWorkspaceExportService, PlannerCalendarService } = require('./google-integration-service');
const { FolderService, JsonFileService } = require('./file-service');
const { AppConfigService, CredentialStore } = require('./infra-config-service');
const { NewsletterRenderService, ScreenCaptureService } = require('./rendering-service');
const { PastHistoryService, TbTestService } = require('./import-service');
const { KioskWsService } = require('./kiosk-ws-service');
const { CustomBackupService } = require('./custom-backup-service');

/**
 * ServiceContainer — 의존성 주입 컨��이너
 * 모든 백엔드 서비스 인스턴스를 중앙에서 관리합니다.
 * 지연 초기화(lazy instantiation)로 필요할 때 생성합니다.
 *
 * @param {object} deps - 외부 의��성
 * @param {object} deps.app - Electron app
 * @param {object} deps.healthDB - HealthDiaryDB 인스턴스
 * @param {string} deps.userDataPath - app.getPath('userData')
 * @param {object} deps.googleApi - Google API 함수들
 * @param {object} deps.electronModules - Electron 모듈 (BrowserWindow, dialog, clipboard)
 * @param {Function} deps.getMainWindow - mainWindow getter
 */
class ServiceContainer {
  constructor(deps) {
    this._deps = deps;
    this._svc = {};
  }

  /* ──────────── 인프라 서비스 ──────────── */

  /** HealthDiaryDB 원본 인스턴스 반환 (공장 초기화 등 관리 작업용)
   *  복원 직후처럼 핸들이 닫혀 있으면 자동으로 재오픈한다 — 어떤 경우에도 영영 못 쓰는 상태를 막는다.
   */
  healthDb() {
    const cur = this._deps.healthDB;
    let needsReopen = false;
    try {
      if (!cur || !cur.db) needsReopen = true;
      else if (typeof cur.db.open === 'boolean' && cur.db.open === false) needsReopen = true;
    } catch (_) { needsReopen = true; }
    if (needsReopen) {
      try {
        const { createHealthDiaryDB } = require('./database');
        console.warn('[ServiceContainer] healthDB 닫힘 감지 → 재오픈');
        const fresh = createHealthDiaryDB(this._deps.app);
        this.replaceHealthDB(fresh);
      } catch (e) {
        console.error('[ServiceContainer] healthDB 재오픈 실패:', e.message);
      }
    }
    return this._deps.healthDB;
  }

  store() {
    if (!this._svc.store) {
      this._svc.store = createAppDataStore(this._deps.app);
    }
    return this._svc.store;
  }

  /** 학교 이동용 커스텀 설정 백업/반영 서비스 (사용자 정책 2026-05-22).
   *  · 등록부(custom-backup-keys.js) 기반으로 localStorage·AppDataStore·파일을 한 폴더에 백업.
   *  · 압축 없이 폴더 그대로 복사·이전 (컴맹 사용자 친화). */
  customBackup() {
    if (!this._svc.customBackup) {
      this._svc.customBackup = new CustomBackupService(this.store(), this._deps.userDataPath);
    }
    return this._svc.customBackup;
  }

  folders() {
    if (!this._svc.folders) {
      this._svc.folders = new FolderService(this._deps.userDataPath);
      this._svc.folders.ensureAll();
    }
    return this._svc.folders;
  }

  appConfig() {
    if (!this._svc.appConfig) {
      this._svc.appConfig = new AppConfigService(this._deps.userDataPath);
    }
    return this._svc.appConfig;
  }

  jsonFile() {
    if (!this._svc.jsonFile) {
      this._svc.jsonFile = new JsonFileService(this._deps.userDataPath);
      this._svc.jsonFile.cleanOrphanedTmpFiles();
    }
    return this._svc.jsonFile;
  }

  screenCapture() {
    if (!this._svc.screenCapture) {
      this._svc.screenCapture = new ScreenCaptureService(
        this._deps.electronModules,
        this._deps.app.getPath('temp'),
        this._deps.getMainWindow
      );
    }
    return this._svc.screenCapture;
  }

  credentialStore() {
    if (!this._svc.credentialStore) {
      this._svc.credentialStore = new CredentialStore(this._deps.userDataPath);
    }
    return this._svc.credentialStore;
  }

  /* ──────────── 도메인 서비스 (Blob Store) ──────────── */

  records() {
    if (!this._svc.records) {
      this._svc.records = new HealthRecordService(this.store());
    }
    return this._svc.records;
  }

  settings() {
    if (!this._svc.settings) {
      this._svc.settings = new SettingsService(this.store());
    }
    return this._svc.settings;
  }

  medical() {
    if (!this._svc.medical) {
      this._svc.medical = new MedicalDataService(this.store());
    }
    return this._svc.medical;
  }

  users() {
    if (!this._svc.users) {
      this._svc.users = new UserService(this.healthDb());
    }
    return this._svc.users;
  }

  plannerStore() {
    if (!this._svc.plannerStore) {
      this._svc.plannerStore = new PlannerStoreService(this.store());
    }
    return this._svc.plannerStore;
  }

  plannerCalendar() {
    if (!this._svc.plannerCalendar) {
      this._svc.plannerCalendar = new PlannerCalendarService(this._deps.googleApi);
    }
    return this._svc.plannerCalendar;
  }

  surveyStore() {
    if (!this._svc.surveyStore) {
      this._svc.surveyStore = new SurveyStoreService(this.store());
    }
    return this._svc.surveyStore;
  }

  editorStateStore() {
    if (!this._svc.editorStateStore) {
      this._svc.editorStateStore = new EditorStateStoreService(this.store());
    }
    return this._svc.editorStateStore;
  }

  newsletterStore() {
    if (!this._svc.newsletterStore) {
      this._svc.newsletterStore = new NewsletterStoreService(this.store());
    }
    return this._svc.newsletterStore;
  }

  newsletterRender() {
    if (!this._svc.newsletterRender) {
      this._svc.newsletterRender = new NewsletterRenderService();
    }
    return this._svc.newsletterRender;
  }

  surveyDefinition() {
    if (!this._svc.surveyDefinition) {
      this._svc.surveyDefinition = new SurveyDefinitionService();
    }
    return this._svc.surveyDefinition;
  }

  /* ──────────── 정규화 DB 서비스 (HealthDiaryDB 기반) ──────────── */

  studentsDB() {
    if (!this._svc.studentsDB) {
      this._svc.studentsDB = new StudentsDBService(this.healthDb());
    }
    return this._svc.studentsDB;
  }

  staffDB() {
    if (!this._svc.staffDB) {
      this._svc.staffDB = new StaffDBService(this.healthDb());
    }
    return this._svc.staffDB;
  }

  /* 하위호환 alias */
  peopleDB() { return this.studentsDB(); }

  recordsDB() {
    if (!this._svc.recordsDB) {
      this._svc.recordsDB = new HealthRecordDBService(this.healthDb());
    }
    return this._svc.recordsDB;
  }

  surveyForms() {
    if (!this._svc.surveyForms) {
      this._svc.surveyForms = new SurveyFormService(this.healthDb(), this.folders());
    }
    return this._svc.surveyForms;
  }

  surveyResponses() {
    if (!this._svc.surveyResponses) {
      this._svc.surveyResponses = new SurveyResponseService(this.healthDb());
    }
    return this._svc.surveyResponses;
  }

  statsDB() {
    if (!this._svc.statsDB) {
      /* AppDataStore 주입 → semester_info / holiday_cache_* blob 참조 */
      this._svc.statsDB = new StatisticsDBService(this.healthDb(), this.store());
    }
    return this._svc.statsDB;
  }

  /* ─���────────── 외부 API / 유틸리티 ──────��───── */

  externalApi() {
    if (!this._svc.externalApi) {
      this._svc.externalApi = new ExternalApiService();
    }
    return this._svc.externalApi;
  }

  weather() {
    if (!this._svc.weather) {
      this._svc.weather = new WeatherService();
    }
    return this._svc.weather;
  }

  driveSync() {
    if (!this._svc.driveSync) {
      this._svc.driveSync = new DriveSyncService(this._deps.googleApi);
    }
    return this._svc.driveSync;
  }

  workspaceExport() {
    if (!this._svc.workspaceExport) {
      this._svc.workspaceExport = new GoogleWorkspaceExportService(this._deps.googleApi);
    }
    return this._svc.workspaceExport;
  }

  tbTest() {
    if (!this._svc.tbTest) {
      this._svc.tbTest = new TbTestService(this.healthDb());
    }
    return this._svc.tbTest;
  }

  pastHistory() {
    if (!this._svc.pastHistory) {
      this._svc.pastHistory = new PastHistoryService(this.healthDb());
    }
    return this._svc.pastHistory;
  }

  kioskWs() {
    if (!this._svc.kioskWs) {
      this._svc.kioskWs = new KioskWsService();
    }
    return this._svc.kioskWs;
  }

  /* ──────────── Lifecycle ──────────── */

  /**
   * 백업 복원 등으로 healthDB 인스턴스를 교체할 때 사용.
   * 기존 healthDB 를 참조하던 캐시 서비스들을 모두 폐기 → 다음 호출 시 새 DB 로 재생성.
   */
  replaceHealthDB(newDb) {
    this._deps.healthDB = newDb;
    this._svc.users = null;
    this._svc.studentsDB = null;
    this._svc.staffDB = null;
    this._svc.recordsDB = null;
    this._svc.surveyForms = null;
    this._svc.surveyResponses = null;
    this._svc.statsDB = null;
    this._svc.tbTest = null;
    this._svc.pastHistory = null;
  }

  close() {
    if (this._svc.kioskWs) {
      this._svc.kioskWs.stop();
      this._svc.kioskWs = null;
    }
    if (this._svc.store) {
      this._svc.store.close();
      this._svc.store = null;
    }
  }
}

module.exports = { ServiceContainer };
