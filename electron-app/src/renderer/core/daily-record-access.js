/* Daily editors share an identity-safe lookup without mixing other school years into S.records. */
import { S } from './app-state.js';

const periodEdits = new Map();
export function getDailyRecord(id) {
  if (id == null || id === '') return null;
  const record=(S.records || []).find(record => String(record.id) === String(id)) || periodEdits.get(String(id));
  return record&&!record._deleted?record:null;
}

export function preparePeriodRecord(record) {
  if (!record || record._deleted || !record._dbId || String(record.id) !== String(record._dbId)) return null;
  const live = (S.records || []).find(item => String(item.id) === String(record.id));
  if (live) {
    // A temporary local id must never open a different persisted visit.
    if (live._deleted || String(live._dbId || '') !== String(record._dbId) || live.date !== record.date) return null;
    return live;
  }
  const old = periodEdits.get(String(record.id));
  if (old && (old._dirty || old._pendingUpdate || Date.now()-Number(old._savedAt)<7000)) return old;
  const editable = structuredClone(record);
  editable.studentId = editable.personUid || editable.studentId || '';
  periodEdits.set(String(record.id), editable);
  return editable;
}

export function getPeriodEditRecords() { return Array.from(periodEdits.values()); }
