/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * app-data-bridge.js — ES Module
 * IPC <-> 렌더러 데이터 변환 브리지 (SQLite blob store + JSON 파일)
 */

/* 연도별 blob(보건일지·응급·감염·연도별 설정)의 연도는 언제나 '학년도' — 3월 1일 시작(달력 연도 아님). 폴백 방어용. (사용자 지시 2026-06-20) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

function MyAppDataBridge(api){
  this.api = api || null;
}

MyAppDataBridge.prototype.canUseBackend = function(){
  return !!(this.api && this.api.dbGet && this.api.dbSet);
};

MyAppDataBridge.prototype._isNonEmpty = function(data){
  if(data == null) return false;
  if(Array.isArray(data)) return data.length > 0;
  if(typeof data === 'object') return Object.keys(data).length > 0;
  if(typeof data === 'string') return data.length > 0;
  return true;
};

MyAppDataBridge.prototype._setLs = function(lsKey, data){
  if(typeof data === 'string') localStorage.setItem(lsKey, data);
  else localStorage.setItem(lsKey, JSON.stringify(data));
};

MyAppDataBridge.prototype._parseLsForStorage = function(lsKey){
  const raw = localStorage.getItem(lsKey);
  if(raw == null) return null;
  try { return JSON.parse(raw); } catch(e) { return raw; }
};

MyAppDataBridge.prototype.loadCommon = async function(opts){
  const dbRes = await this.api.dbGet('common', opts.dbKey);
  if(dbRes && dbRes.success && dbRes.exists){
    if(!this._isNonEmpty(dbRes.data)){
      const existing = localStorage.getItem(opts.lsKey);
      if(existing && existing !== 'null' && existing !== '[]' && existing !== '{}'){
        await this.saveCommon(opts.dbKey, this._parseLsForStorage(opts.lsKey), { legacyJsonKey: opts.legacyJsonKey, skipLegacy: false });
        return;
      }
    }
    this._setLs(opts.lsKey, dbRes.data);
    if(opts.onLoaded) opts.onLoaded(dbRes.data);
    return;
  }

  if(this.api.jsonLoadCommon){
    const legacy = await this.api.jsonLoadCommon(opts.legacyJsonKey || opts.dbKey);
    if(legacy && legacy.exists && legacy.data != null){
      this._setLs(opts.lsKey, legacy.data);
      if(opts.onLoaded) opts.onLoaded(legacy.data);
      await this.saveCommon(opts.dbKey, legacy.data, { legacyJsonKey: opts.legacyJsonKey, skipLegacy: true });
      return;
    }
  }

  const parsed = this._parseLsForStorage(opts.lsKey);
  if(parsed != null){
    await this.saveCommon(opts.dbKey, parsed, { legacyJsonKey: opts.legacyJsonKey, skipLegacy: false });
  }
};

MyAppDataBridge.prototype.loadYear = async function(opts){
  const year = String(opts.year || _academicYear());
  const dbRes = await this.api.dbGet('year', opts.dbKey, year);
  if(dbRes && dbRes.success && dbRes.exists){
    if(!this._isNonEmpty(dbRes.data)){
      const existing = localStorage.getItem(opts.lsKey);
      if(existing && existing !== 'null' && existing !== '[]' && existing !== '{}'){
        await this.saveYear(opts.dbKey, this._parseLsForStorage(opts.lsKey), { year: year, legacyJsonKey: opts.legacyJsonKey, skipLegacy: false });
        return;
      }
    }
    this._setLs(opts.lsKey, dbRes.data);
    if(opts.onLoaded) opts.onLoaded(dbRes.data);
    return;
  }

  if(this.api.jsonLoad){
    const legacy = await this.api.jsonLoad(opts.legacyJsonKey || opts.dbKey, year);
    if(legacy && legacy.exists && legacy.data != null){
      this._setLs(opts.lsKey, legacy.data);
      if(opts.onLoaded) opts.onLoaded(legacy.data);
      await this.saveYear(opts.dbKey, legacy.data, { year: year, legacyJsonKey: opts.legacyJsonKey, skipLegacy: true });
      return;
    }
  }

  const parsed = this._parseLsForStorage(opts.lsKey);
  if(parsed != null){
    await this.saveYear(opts.dbKey, parsed, { year: year, legacyJsonKey: opts.legacyJsonKey, skipLegacy: false });
  }
};

MyAppDataBridge.prototype.saveCommon = async function(dbKey, value, opts){
  opts = opts || {};
  if(!this.canUseBackend()) return null;
  const out = [];
  out.push(this.api.dbSet('common', dbKey, value));
  if(!opts.skipLegacy && this.api.jsonSaveCommon){
    out.push(this.api.jsonSaveCommon(opts.legacyJsonKey || dbKey, value));
  }
  return Promise.allSettled(out);
};

MyAppDataBridge.prototype.saveYear = async function(dbKey, value, opts){
  opts = opts || {};
  if(!this.canUseBackend()) return null;
  const year = String(opts.year || _academicYear());
  const out = [];
  out.push(this.api.dbSet('year', dbKey, value, year));
  if(!opts.skipLegacy && this.api.jsonSave){
    out.push(this.api.jsonSave(opts.legacyJsonKey || dbKey, value));
  }
  return Promise.allSettled(out);
};

MyAppDataBridge.prototype.syncBatch = async function(commonItems, yearItems, year){
  if(!this.canUseBackend()) return null;
  const items = [];
  (commonItems || []).forEach(function(item){
    items.push({ scope:'common', key:item.dbKey, value:item.value });
  });
  (yearItems || []).forEach(function(item){
    items.push({ scope:'year', key:item.dbKey, year:String(year || _academicYear()), value:item.value });
  });
  if(!items.length) return null;
  return this.api.dbBatchSet(items);
};

export { MyAppDataBridge };
export const appData = new MyAppDataBridge(window.electronAPI || null);
