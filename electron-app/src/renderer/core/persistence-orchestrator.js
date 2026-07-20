/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
import { S } from './app-state.js';
/**
 * persistence-orchestrator.js — ES Module
 * 앱 종료 시 일괄 저장 조율
 */
import { appData } from './app-data-bridge.js';

/* 연도별 데이터(보건일지 등)의 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님). 폴백 방어용. (사용자 지시 2026-06-20) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

function PersistenceOrchestrator(api, bridge){
  this.api = api || null;
  this.appData = bridge || null;
}

PersistenceOrchestrator.prototype._isNonEmpty = function(data){
  if(data == null) return false;
  if(Array.isArray(data)) return data.length > 0;
  if(typeof data === 'object') return Object.keys(data).length > 0;
  if(typeof data === 'string') return data.length > 0;
  return true;
};

PersistenceOrchestrator.prototype._setLs = function(lsKey, data){
  if(typeof data === 'string') localStorage.setItem(lsKey, data);
  else localStorage.setItem(lsKey, JSON.stringify(data));
};

/* ── IPC 안전성 가드 (사용자 보고 2026-05-27 contextBridge recursion depth exceeded 대응) ──
 *  Electron contextBridge 는 1000 단계 nested 객체를 거부. 사용자 PC 의 localStorage 값이
 *  어떤 이유로든 손상되어 깊이가 비정상으로 늘어났을 때 (예: ec_col_widths depth 51+ 보고),
 *  syncBatch 전체가 실패하여 다른 정상 키들도 동기화 안 됨.
 *
 *  이 가드는 각 value 가 IPC 전송 가능한지 검사 — 안전한 키만 통과시키고,
 *  문제 있는 키는 skip + console.warn (어느 키가 문제인지 자동 진단 가능).
 *  보수적 cap: 100 단계 (Electron 1000 한도보다 한참 아래). */
function _depthCheck(o, d){
  if(!o || typeof o !== 'object' || d > 100) return d;
  let max = d;
  for(const k in o){
    if(!Object.prototype.hasOwnProperty.call(o, k)) continue;
    const child = _depthCheck(o[k], d + 1);
    if(child > max) max = child;
    if(max > 100) return max;
  }
  return max;
}
function _isSafeForIpc(value){
  if(value == null || typeof value !== 'object') return true;
  try { JSON.stringify(value); } catch(_) { return false; } /* circular ref 검사 */
  if(_depthCheck(value, 0) > 100) return false;             /* depth 검사 */
  return true;
}

PersistenceOrchestrator.prototype._parseLsForStorage = function(lsKey){
  const raw = localStorage.getItem(lsKey);
  if(raw == null) return null;
  try { return JSON.parse(raw); } catch(e) { return raw; }
};

PersistenceOrchestrator.prototype.loadMappings = function(options){
  const self = this;
  if(!this.api || !this.api.jsonLoad) return;
  const year = String((options && options.year) || _academicYear());
  const commonMappings = (options && options.commonMappings) || [];
  const yearMappings = (options && options.yearMappings) || [];
  const editorSlots = (options && options.editorSlots) || [];

  commonMappings.forEach(function(mapping){
    if(self.appData && self.appData.canUseBackend()){
      self.appData.loadCommon({ dbKey:mapping.dbKey, legacyJsonKey:mapping.dbKey, lsKey:mapping.lsKey, onLoaded:mapping.onLoaded }).catch(function(err){ console.error('[DB] '+mapping.dbKey+' 로드 실패:', err); });
      return;
    }
    self.api.jsonLoadCommon(mapping.dbKey).then(function(res){
      if(res && res.exists && res.data != null){
        if(!self._isNonEmpty(res.data)){
          const existing = localStorage.getItem(mapping.lsKey);
          if(existing && existing !== 'null' && existing !== '[]' && existing !== '{}'){
            try{ self.api.jsonSaveCommon(mapping.dbKey, self._parseLsForStorage(mapping.lsKey)); }catch(e){}
            return;
          }
        }
        if(mapping.onLoaded){
          mapping.onLoaded(res.data);
        } else {
          self._setLs(mapping.lsKey, res.data);
        }
      } else {
        const parsed = self._parseLsForStorage(mapping.lsKey);
        if(parsed != null){ try{ self.api.jsonSaveCommon(mapping.dbKey, parsed); }catch(e){} }
      }
    }).catch(function(err){ console.error('[JSON] '+mapping.dbKey+' 로드 실패:', err); });
  });

  yearMappings.forEach(function(mapping){
    if(self.appData && self.appData.canUseBackend()){
      self.appData.loadYear({ dbKey:mapping.dbKey, legacyJsonKey:mapping.dbKey, lsKey:mapping.lsKey, year:year, onLoaded:mapping.onLoaded }).catch(function(err){ console.error('[DB] '+mapping.dbKey+' 로드 실패:', err); });
      return;
    }
    self.api.jsonLoad(mapping.dbKey, year).then(function(res){
      if(res && res.exists && res.data != null){
        if(!self._isNonEmpty(res.data)){
          const existing = localStorage.getItem(mapping.lsKey);
          if(existing && existing !== 'null' && existing !== '[]' && existing !== '{}'){
            try{ self.api.jsonSave(mapping.dbKey, self._parseLsForStorage(mapping.lsKey)); }catch(e){}
            return;
          }
        }
        if(mapping.onLoaded){
          mapping.onLoaded(res.data);
        } else {
          self._setLs(mapping.lsKey, res.data);
        }
      } else {
        const parsed = self._parseLsForStorage(mapping.lsKey);
        if(parsed != null){ try{ self.api.jsonSave(mapping.dbKey, parsed); }catch(e){} }
      }
    }).catch(function(err){ console.error('[JSON] '+mapping.dbKey+' 로드 실패:', err); });
  });

  if(this.api.jsonLoadCommon){
    editorSlots.forEach(function(slot){
      self.api.jsonLoadCommon('vp_editor_' + slot).then(function(res){
        if(res && res.exists && res.data != null){
          localStorage.setItem('ec_vp_editor_' + slot, typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
        }
      }).catch(function(){});
    });
  }
};

PersistenceOrchestrator.prototype.syncAll = function(options){
  if(!this.api || !this.api.jsonSaveCommon) return;
  const appDataRef = this.appData;
  const year = String((options && options.year) || _academicYear());
  const commonKeys = (options && options.commonKeys) || [];
  const yearKeys = (options && options.yearKeys) || [];
  const _records = options && options.records;
  const _people = options && options.people;
  const editorPrefix = (options && options.editorPrefix) || 'ec_vp_editor_';

  commonKeys.forEach(function(pair){
    const raw = localStorage.getItem(pair[1]);
    if(raw != null){
      try {
        const parsed = JSON.parse(raw);
        if(!_isSafeForIpc(parsed)){
          console.warn('[DB] 동기화 skip — 비정상 객체(깊이/circular):', pair[0]);
        } else {
          window.electronAPI.jsonSaveCommon(pair[0], parsed);
        }
      }
      catch(e) { window.electronAPI.jsonSaveCommon(pair[0], raw); }
    }
  });

  yearKeys.forEach(function(pair){
    const raw = localStorage.getItem(pair[1]);
    if(raw != null){
      try {
        const parsed = JSON.parse(raw);
        if(!_isSafeForIpc(parsed)){
          console.warn('[DB] 연도 동기화 skip — 비정상 객체:', pair[0]);
          return;
        }
        window.electronAPI.jsonSave(pair[0], parsed);
      } catch(e){}
    }
  });

  if(appDataRef && appDataRef.canUseBackend()){
    const commonItems = [];
    commonKeys.forEach(function(pair){
      const raw = localStorage.getItem(pair[1]);
      if(raw != null){
        try {
          const parsed = JSON.parse(raw);
          if(!_isSafeForIpc(parsed)){
            console.warn('[DB] 배치 동기화 skip — 비정상 객체(깊이/circular):', pair[0]);
            return;
          }
          commonItems.push({ dbKey:pair[0], value:parsed });
        }
        catch(e) { commonItems.push({ dbKey:pair[0], value:raw }); }
      }
    });
    const yearItems = [];
    yearKeys.forEach(function(pair){
      const raw = localStorage.getItem(pair[1]);
      if(raw != null){
        try {
          const parsed = JSON.parse(raw);
          if(!_isSafeForIpc(parsed)){
            console.warn('[DB] 배치 동기화 skip(연도) — 비정상 객체:', pair[0]);
            return;
          }
          yearItems.push({ dbKey:pair[0], value:parsed });
        } catch(e){}
      }
    });
    appDataRef.syncBatch(commonItems, yearItems, year).catch(function(err){ console.error('[DB] 배치 동기화 실패:', err); });
  }

  if(Array.isArray(S.records)){
    const cleanRecords = S.records.filter(function(r){ return !r._isDummy; });
    if(appDataRef && appDataRef.canUseBackend()) appDataRef.saveYear('records', cleanRecords, { legacyJsonKey:'records', year:year }).catch(function(err){ console.error('[DB] records 저장 실패:', err); });
    else window.electronAPI.jsonSave('records', cleanRecords);
  }

  if(Array.isArray(S.people)){
    const cleanPeople = S.people.map(function(s){
      if(s && s._wasDummy){ const clone = Object.assign({}, s); delete clone._wasDummy; return clone; }
      return s;
    });
    if(appDataRef && appDataRef.canUseBackend()) appDataRef.saveCommon('students', cleanPeople, { legacyJsonKey:'students' }).catch(function(err){ console.error('[DB] people 저장 실패:', err); });
    else window.electronAPI.jsonSaveCommon('students', cleanPeople);
  }

  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(key && key.indexOf(editorPrefix) === 0){
      const value = localStorage.getItem(key);
      if(value != null){
        const jsonKey = 'vp_editor_' + key.replace(editorPrefix, '');
        try { window.electronAPI.jsonSaveCommon(jsonKey, JSON.parse(value)); }
        catch(e) { window.electronAPI.jsonSaveCommon(jsonKey, value); }
      }
    }
  }
};

export { PersistenceOrchestrator };
export const persistenceOrchestrator = new PersistenceOrchestrator(window.electronAPI || null, appData);
