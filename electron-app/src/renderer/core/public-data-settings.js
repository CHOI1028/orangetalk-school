/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* Public-data credentials deliberately use a dedicated persistence path:
 * an existing empty value means disabled, not missing. Generic app-data
 * recovery treats empty values as missing and would revive a removed key. */
export const PUBLIC_DATA_DB_KEY = 'public_data_api_key';
export const PUBLIC_DATA_LS_KEY = 'ec_public_data_api_key';
const SERVICES = ['kma', 'uv', 'airkorea', 'drug', 'hira', 'emergency', 'kdca', 'holiday'];
const revisions = new WeakMap();
const pendingSaves = new WeakMap();
const pendingLoads = new WeakMap();

function defaultStorage() {
  try { return globalThis.localStorage; } catch (_) { return null; }
}
function defaultApi() {
  return typeof window !== 'undefined' ? window.electronAPI : null;
}
function read(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch (_) { return null; }
}
function rawKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function comparableKey(value) {
  const key = rawKey(value);
  if (!/%[0-9a-f]{2}/i.test(key)) return key;
  try { return decodeURIComponent(key).trim(); } catch (_) { return key; }
}
function revisionOwner(storage, api) {
  return storage && typeof storage === 'object' ? storage
    : api && typeof api === 'object' ? api : null;
}
function beginRevision(owner) {
  if (!owner) return 0;
  const revision = (revisions.get(owner) || 0) + 1;
  revisions.set(owner, revision);
  return revision;
}
function currentRevision(owner, revision) {
  return !owner || revisions.get(owner) === revision;
}
function cache(storage, exists, key) {
  try {
    if (!storage) return false;
    if (exists) storage.setItem(PUBLIC_DATA_LS_KEY, key);
    else storage.removeItem(PUBLIC_DATA_LS_KEY);
    return true;
  } catch (_) { return false; }
}

export function hasPublicDataApiKeySetting(storage = defaultStorage()) {
  return read(storage, PUBLIC_DATA_LS_KEY) !== null;
}

export function getPublicDataApiKey(service, storage = defaultStorage()) {
  // Do not accidentally send this credential to NEIS, Kakao, or unknown APIs.
  if (!SERVICES.includes(service)) return '';
  const common = read(storage, PUBLIC_DATA_LS_KEY);
  if (common !== null) return rawKey(common);
  const legacy = rawKey(read(storage, 'ec_' + service + '_api_key'));
  return legacy || (service === 'uv' ? rawKey(read(storage, 'ec_kma_api_key')) : '');
}

export function getPublicDataMigrationCandidate(storage = defaultStorage()) {
  const keys = SERVICES.map(service => rawKey(read(storage, 'ec_' + service + '_api_key'))).filter(Boolean);
  const unique = new Set(keys.map(comparableKey));
  return { key: unique.size === 1 ? keys[0] : '', conflict: unique.size > 1, count: keys.length };
}

export async function savePublicDataApiKey(value, { api = defaultApi(), storage = defaultStorage() } = {}) {
  if (typeof value !== 'string') return { success: false, error: '인증키 입력값을 확인해 주세요.' };
  if (!api || typeof api.dbSet !== 'function') {
    return { success: false, error: '저장소에 연결할 수 없습니다. 연결 상태를 확인해 주세요.' };
  }
  // Keep the entered representation. Actual API transport normalizes exactly
  // once; decoding here as well could turn a literal percent escape into data.
  const key = rawKey(value);
  const owner = revisionOwner(storage, api);
  const revision = beginRevision(owner);
  const previous = owner ? pendingSaves.get(owner) : null;
  const save = async function() {
    if (previous) await previous;
    return persistKey(key, api, storage, owner, revision);
  };
  const pending = save();
  if (owner) pendingSaves.set(owner, pending);
  try { return await pending; }
  finally {
    if (owner && pendingSaves.get(owner) === pending) pendingSaves.delete(owner);
  }
}

async function persistKey(key, api, storage, owner, revision) {
  let result;
  try { result = await api.dbSet('common', PUBLIC_DATA_DB_KEY, key); }
  catch (_) { return { success: false, error: '인증키를 저장하지 못했습니다. 다시 시도해 주세요.' }; }
  if (!result || result.success !== true) {
    return { success: false, error: '인증키를 저장하지 못했습니다. 다시 시도해 주세요.' };
  }
  const cacheSaved = currentRevision(owner, revision) && cache(storage, true, key);
  let backupSaved = null;
  if (typeof api.jsonSaveCommon === 'function') {
    try {
      const backup = await api.jsonSaveCommon(PUBLIC_DATA_DB_KEY, key);
      // The web bridge returns a path string; Electron returns {success,path}.
      backupSaved = typeof backup === 'string' ? !!backup : !!(backup && backup.success === true);
    } catch (_) { backupSaved = false; }
  }
  const saved = { success: true, key, cacheSaved, backupSaved };
  if (!currentRevision(owner, revision)) {
    saved.stale = true;
    saved.warning = '다른 인증키 설정 작업이 진행되었습니다. 현재 설정을 다시 확인해 주세요.';
  } else if (!cacheSaved) saved.warning = '인증키는 저장되었으나 화면에 적용하지 못했습니다. 프로그램을 다시 실행해 주세요.';
  else if (backupSaved === false) saved.warning = '인증키는 저장되었으나 보조 백업 저장에 실패했습니다. 다시 저장해 주세요.';
  return saved;
}

export async function loadPublicDataApiKey({ api = defaultApi(), storage = defaultStorage() } = {}) {
  if (!api || typeof api.dbGet !== 'function') {
    return { success: false, error: '인증키 저장소에 연결할 수 없습니다.' };
  }
  const owner = revisionOwner(storage, api);
  const active = owner ? pendingLoads.get(owner) : null;
  // Boot hydration, a connection check, and the server's own save echo may
  // request the same read together. Share it unless a newer save superseded it.
  if (active && active.api === api && currentRevision(owner, active.revision)) {
    return active.promise;
  }
  const entry = { api, revision: owner ? (revisions.get(owner) || 0) : 0, promise: null };
  entry.promise = loadKey(api, storage, owner, entry);
  if (owner) pendingLoads.set(owner, entry);
  try { return await entry.promise; }
  finally {
    if (owner && pendingLoads.get(owner) === entry) pendingLoads.delete(owner);
  }
}

async function loadKey(api, storage, owner, entry) {
  // A read is not an edit. Wait for the latest queued save (including JSON)
  // before assigning its revision, so a DB/SSE echo cannot invalidate the save
  // that caused it. A later save still supersedes an already-running slow read.
  let pending;
  while (owner && (pending = pendingSaves.get(owner))) await pending;
  const revision = beginRevision(owner);
  entry.revision = revision;
  let result;
  try { result = await api.dbGet('common', PUBLIC_DATA_DB_KEY); }
  catch (_) { return { success: false, error: '저장된 인증키를 불러오지 못했습니다.' }; }
  // A database error is not an absent key. Never revive an older JSON copy.
  if (!result || result.success !== true || typeof result.exists !== 'boolean') {
    return { success: false, error: '저장된 인증키를 불러오지 못했습니다.' };
  }
  let source = result.exists ? 'db' : 'absent';
  if (!result.exists && typeof api.jsonLoadCommon === 'function') {
    try { result = await api.jsonLoadCommon(PUBLIC_DATA_DB_KEY); }
    catch (_) { return { success: false, error: '인증키 보조 백업을 불러오지 못했습니다.' }; }
    // JSON service responses have exists/data but may omit success.
    if (!result || result.success === false || typeof result.exists !== 'boolean') {
      return { success: false, error: '인증키 보조 백업을 불러오지 못했습니다.' };
    }
    source = result.exists ? 'json' : 'absent';
  }
  if (result.exists && typeof result.data !== 'string') {
    return { success: false, error: '저장된 인증키 형식을 확인해 주세요.' };
  }
  // A boot-time read must never overwrite an explicitly saved key while it
  // was awaiting IPC. A newer read also supersedes an older connection.
  if (!currentRevision(owner, revision)) {
    return { success: false, stale: true, error: '다른 인증키 설정 작업이 진행되었습니다.' };
  }
  const exists = result.exists;
  const key = exists ? rawKey(result.data) : '';
  if (source === 'json') {
    // Backend services resolve keys from DB, not renderer localStorage. Restore
    // the canonical value (including a disabled empty key) before exposing it
    // locally, or host-side legacy fallback could disagree with the renderer.
    if (typeof api.dbSet !== 'function') {
      return { success: false, error: '인증키 보조 백업을 저장소에 복원하지 못했습니다.' };
    }
    const previous = owner ? pendingSaves.get(owner) : null;
    const restore = async function() {
      if (previous) await previous;
      if (!currentRevision(owner, revision)) return { success: false, stale: true };
      try {
        const restored = await api.dbSet('common', PUBLIC_DATA_DB_KEY, key);
        return { success: !!(restored && restored.success === true) };
      } catch (_) { return { success: false }; }
    };
    const restoring = restore();
    if (owner) pendingSaves.set(owner, restoring);
    let restored;
    try { restored = await restoring; }
    finally {
      if (owner && pendingSaves.get(owner) === restoring) pendingSaves.delete(owner);
    }
    if (!restored.success) {
      return { success: false, stale: !!restored.stale, error: '인증키 보조 백업을 저장소에 복원하지 못했습니다.' };
    }
    if (!currentRevision(owner, revision)) {
      return { success: false, stale: true, error: '다른 인증키 설정 작업이 진행되었습니다.' };
    }
  }
  const cacheSaved = cache(storage, exists, key);
  return { success: true, exists, key, source, cacheSaved };
}
