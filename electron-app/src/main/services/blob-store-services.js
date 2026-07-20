/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * blob-store-services.js — Blob Store 기반 서비스 모음
 *
 * BaseStoreService (공통 베이스)
 * EditorStateStoreService — 에디터 UI 상태
 * SurveyStoreService — 설문 workspace
 * PlannerStoreService — 플래너 데이터
 * NewsletterStoreService — 가정통신문 문서
 */

/* ══════════ BaseStoreService ══════════ */

class BaseStoreService {
  constructor(appDataStore) {
    this._store = appDataStore;
  }

  _getArray(scope, key) {
    const result = this._store.get(scope, key);
    return result.exists && Array.isArray(result.data) ? result.data : [];
  }

  _getValue(scope, key, fallback) {
    const result = this._store.get(scope, key);
    return result.exists ? result.data : (fallback !== undefined ? fallback : null);
  }

  _getObject(scope, key) {
    const result = this._store.get(scope, key);
    return result.exists && result.data && typeof result.data === 'object' ? result.data : {};
  }

  _set(scope, key, value) {
    return this._store.set(scope, key, value);
  }

  _batchSet(items) {
    return this._store.batchSet(items);
  }
}

/* ══════════ EditorStateStoreService ══════════ */

class EditorStateStoreService extends BaseStoreService {
  constructor(appDataStore) {
    super(appDataStore);
  }

  _key(namespace, slot) {
    return namespace + ':' + String(slot || 'default');
  }

  getState(namespace, slot) {
    return this._getValue('common', this._key(namespace, slot));
  }

  saveState(namespace, slot, data) {
    return this._set('common', this._key(namespace, slot), data || null);
  }

  deleteState(namespace, slot) {
    return this._set('common', this._key(namespace, slot), undefined);
  }
}

/* ══════════ SurveyStoreService ══════════ */

class SurveyStoreService extends BaseStoreService {
  constructor(appDataStore) {
    super(appDataStore);
  }

  getWorkspace() {
    return {
      customSurveys: this._getArray('common', 'sv_custom'),
      activeSurveys: this._getArray('common', 'sv_active'),
      activities: this._getArray('common', 'sv_activities'),
      history: this._getArray('common', 'sv_history'),
      savePath: this._getValue('common', 'sv_save_path', ''),
      draft: this._getValue('common', 'sv_survey_draft')
    };
  }

  saveWorkspace(patch) {
    const current = this.getWorkspace();
    const next = Object.assign({}, current, patch || {});
    this._batchSet([
      { scope: 'common', key: 'sv_custom', value: next.customSurveys || [] },
      { scope: 'common', key: 'sv_active', value: next.activeSurveys || [] },
      { scope: 'common', key: 'sv_activities', value: next.activities || [] },
      { scope: 'common', key: 'sv_history', value: next.history || [] },
      { scope: 'common', key: 'sv_save_path', value: next.savePath || '' },
      { scope: 'common', key: 'sv_survey_draft', value: next.draft || null }
    ]);
    return { success: true, workspace: next };
  }

  saveDraft(draft) {
    return this._set('common', 'sv_survey_draft', draft || null);
  }

  savePath(path) {
    return this._set('common', 'sv_save_path', path || '');
  }
}

/* ══════════ PlannerStoreService ══════════ */

class PlannerStoreService extends BaseStoreService {
  constructor(appDataStore) {
    super(appDataStore);
  }

  _dayKey(date) {
    return 'planner2_day_' + String(date);
  }

  loadDay(date) {
    const data = this._getValue('common', this._dayKey(date));
    return data || { date, todos: [], memo: '', images: [] };
  }

  saveDay(date, data) {
    const safe = data || { date, todos: [], memo: '', images: [] };
    if (!safe.todos.length && !safe.memo && !safe.images.length) {
      this._set('common', this._dayKey(date), undefined);
      return { success: true, deleted: true };
    }
    return this._set('common', this._dayKey(date), safe);
  }

  hasDay(date) {
    return this._store.get('common', this._dayKey(date)).exists;
  }

  getLinks() {
    return this._getArray('common', 'magic_links2');
  }

  saveLinks(items) {
    return this._set('common', 'magic_links2', items || []);
  }

  getRoutines() {
    return this._getArray('common', 'gp2_routines');
  }

  saveRoutines(items) {
    return this._set('common', 'gp2_routines', items || []);
  }

  getGlobalTodos() {
    return this._getArray('common', 'gp2_gtodos');
  }

  saveGlobalTodos(items) {
    return this._set('common', 'gp2_gtodos', items || []);
  }

  getDateSettings() {
    return {
      semesterEnd: this._getValue('common', 'gp2_semester_end', ''),
      schoolYearEnd: this._getValue('common', 'gp2_school_year_end', '')
    };
  }

  saveDateSettings(settings) {
    const current = this.getDateSettings();
    const next = Object.assign({}, current, settings || {});
    this._batchSet([
      { scope: 'common', key: 'gp2_semester_end', value: next.semesterEnd || '' },
      { scope: 'common', key: 'gp2_school_year_end', value: next.schoolYearEnd || '' }
    ]);
    return { success: true, settings: next };
  }
}

/* ══════════ NewsletterStoreService ══════════ */

class NewsletterStoreService extends BaseStoreService {
  constructor(appDataStore) {
    super(appDataStore);
  }

  _listKey() {
    return 'newsletter_saved_list';
  }

  _docKey(id) {
    return 'newsletter_saved_doc:' + String(id);
  }

  getList() {
    return this._getArray('common', this._listKey());
  }

  _saveList(list) {
    this._set('common', this._listKey(), list || []);
  }

  create(name, data) {
    const list = this.getList();
    const now = new Date().toISOString();
    const item = { id: Date.now(), name, created: now, updated: now };
    list.unshift(item);
    this._saveList(list);
    this._set('common', this._docKey(item.id), data || {});
    return { item, list };
  }

  update(id, data) {
    const list = this.getList();
    const idx = list.findIndex((it) => it.id === id);
    if (idx === -1) return { found: false };
    list[idx].updated = new Date().toISOString();
    this._saveList(list);
    this._set('common', this._docKey(id), data || {});
    return { found: true, item: list[idx], list };
  }

  rename(id, name) {
    const list = this.getList();
    const idx = list.findIndex((it) => it.id === id);
    if (idx === -1) return { found: false };
    list[idx].name = name;
    list[idx].updated = new Date().toISOString();
    this._saveList(list);
    return { found: true, item: list[idx], list };
  }

  duplicate(id) {
    const list = this.getList();
    const item = list.find((it) => it.id === id);
    if (!item) return { found: false };
    const doc = this.getDocument(id);
    return this.create(item.name + ' (사본)', JSON.parse(JSON.stringify(doc || {})));
  }

  remove(id) {
    const list = this.getList().filter((it) => it.id !== id);
    this._saveList(list);
    this._set('common', this._docKey(id), undefined);
    return { success: true, list };
  }

  getDocument(id) {
    return this._getValue('common', this._docKey(id));
  }
}

module.exports = {
  BaseStoreService,
  EditorStateStoreService,
  SurveyStoreService,
  PlannerStoreService,
  NewsletterStoreService
};
