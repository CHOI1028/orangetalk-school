/* Diary writes are acknowledged, serialized per record and retryable without losing edits. */
import { S } from './app-state.js';
import { bus } from './event-bus.js';
import { _recToDbRow } from './record-utils.js';

const dailyWrites = new WeakMap();
const dailyDeletes = new WeakMap();
const dailyUnsaved = new Set();
let dailySaveToastTimer = null;

function dailySaveStatus() {
  bus.emit('daily:save-state-changed');
  if (typeof document === 'undefined' || !document.getElementById) return;
  const toast = document.getElementById('globalSaveToast');
  if (!toast) return;
  if (dailySaveToastTimer != null && typeof clearTimeout === 'function') clearTimeout(dailySaveToastTimer);
  dailySaveToastTimer = null;
  const pending = Array.from(dailyUnsaved).filter(r => !r._deleted);
  const failed = pending.filter(r => r._saveError && !r._saving);
  toast.className = 'global-save-toast show' + (pending.length && !failed.length ? ' saving' : '');
  toast.textContent = failed.length
    ? '일지를 저장하지 못했습니다. 입력 내용은 유지됩니다. '
    : pending.length ? '일지 저장 중…' : '모든 내용이 저장되었습니다.';
  if (failed.length && typeof document.createElement === 'function' && typeof toast.appendChild === 'function') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-sm';
    retry.textContent = '다시 저장';
    retry.onclick = () => failed.forEach(rec => { if (!rec._deleted) saveDailyRecord(rec); });
    toast.appendChild(retry);
  }
  if (!pending.length && typeof setTimeout === 'function') {
    dailySaveToastTimer = setTimeout(() => { toast.className = 'global-save-toast'; }, 3000);
  }
}

function dailyAdoptId(rec, id) {
  const oldId = rec.id;
  if (String(oldId) !== String(id)) {
    rec._localIds = Array.from(new Set([...(rec._localIds || []), oldId].map(String)));
  }
  rec._dbId = id;
  rec.id = id;
  if (S._lastRegisteredRecId === oldId) S._lastRegisteredRecId = id;
  if (S.dailySelectedRecId === oldId) S.dailySelectedRecId = id;
  if (S._symPopupRecId === oldId) S._symPopupRecId = id;
  if (window._bmData && window._bmData[oldId]) window._bmData[id] = window._bmData[oldId];
  if (rec._deleting) {
    if (!window._pendingDailyDeletes) window._pendingDailyDeletes = {};
    window._pendingDailyDeletes[id] = true;
  }
  if (String(oldId) !== String(id)) {
    bus.emit('daily:record-id-changed', { oldId, id });
  }
}

export function saveDailyRecord(rec) {
  if (!rec || rec._deleted) return Promise.resolve({ success: false, reason: 'deleted' });
  rec._dirty = true;
  rec._saveError = null;
  dailyUnsaved.add(rec);
  if (dailyWrites.has(rec)) {
    rec._pendingUpdate = true;
    return dailyWrites.get(rec);
  }
  // Older registration callers finish their INSERT and then call saveRecordNow.
  if (rec._inserting) {
    rec._pendingUpdate = true;
    dailySaveStatus();
    return Promise.resolve({ success: false, reason: 'pending_insert' });
  }
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  dailyWrites.set(rec, completion);
  rec._saving = true;
  dailySaveStatus();
  (async () => {
    let result = { success: false }, inserting = false, responded = false;
    try {
      do {
        rec._pendingUpdate = false;
        inserting = !rec._dbId;
        responded = false;
        rec._inserting = inserting;
        const api = window.electronAPI;
        const method = inserting ? 'recordsDailyInsert' : 'recordsDailyUpdate';
        if (!api || typeof api[method] !== 'function') throw new Error('save_unavailable');
        const row = _recToDbRow(rec);
        if (inserting) {
          if (!rec._insertRequestId) {
            rec._insertRequestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
          }
          const extra = JSON.parse(row.extra_json || '{}');
          extra.diary_request_id = rec._insertRequestId;
          row.extra_json = JSON.stringify(extra);
        }
        result = await api[method](row);
        responded = true;
        if (!result || result.success !== true || (inserting && !result.id)) throw new Error('save_rejected');
        if (inserting) {
          dailyAdoptId(rec, result.id);
          rec._insertUncertain = false;
          // A retry may find an earlier successful INSERT whose reply was lost.
          if (result.duplicate) rec._pendingUpdate = true;
        }
        rec._inserting = false;
        rec._savedAt = Date.now();
        if (!rec._pendingUpdate || rec._deleted) rec._dirty = false;
      } while (rec._pendingUpdate && !rec._deleted);
      rec._saveError = null;
    } catch (_) {
      rec._dirty = true;
      rec._saveError = 'save_failed';
      if (inserting && !responded && rec._insertRequestId) rec._insertUncertain = true;
      result = { success: false, error: 'save_failed' };
    } finally {
      rec._inserting = false;
      rec._saving = false;
      dailyWrites.delete(rec);
      if (!rec._dirty || rec._deleted) dailyUnsaved.delete(rec);
      if (!rec._deleted) dailySaveStatus();
      finish(result);
    }
  })();
  return completion;
}

export function deletePersistedDailyRecord(rec) {
  if (!rec) return Promise.resolve({ success: false });
  if (dailyDeletes.has(rec)) return dailyDeletes.get(rec);
  rec._deleted = true;
  rec._deleting = true;
  if (!window._pendingDailyDeletes) window._pendingDailyDeletes = {};
  if (!window._recentlyDeletedRecs) window._recentlyDeletedRecs = {};
  const initialIds = [rec.id, rec._dbId, ...(rec._localIds || [])].filter(id => id != null);
  initialIds.forEach(id => { window._pendingDailyDeletes[id] = true; });
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  dailyDeletes.set(rec, completion);
  (async () => {
    let result;
    try {
      const writing = dailyWrites.get(rec);
      if (writing) await writing;
      if (rec._inserting || rec._insertUncertain) throw new Error('insert_status_unknown');
      if (rec._dbId != null) {
        const api = window.electronAPI;
        if (!api || typeof api.recordsDailyDelete !== 'function') throw new Error('delete_unavailable');
        result = await api.recordsDailyDelete(rec._dbId);
        if (!result || result.success !== true) throw new Error('delete_rejected');
      }
      result = { success: true };
      rec._dirty = false;
      rec._pendingUpdate = false;
      dailyUnsaved.delete(rec);
    } catch (_) {
      rec._deleted = false;
      if (rec._dirty) dailyUnsaved.add(rec);
      result = { success: false, error: 'delete_failed' };
    } finally {
      const ids = [...initialIds, rec.id, rec._dbId].filter(id => id != null);
      ids.forEach(id => {
        delete window._pendingDailyDeletes[id];
        if (result.success) window._recentlyDeletedRecs[id] = Date.now();
        else delete window._recentlyDeletedRecs[id];
      });
      rec._deleting = false;
      dailyDeletes.delete(rec);
      dailySaveStatus();
      finish(result);
    }
  })();
  return completion;
}
