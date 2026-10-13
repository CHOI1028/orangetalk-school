/* Copyright (c) 2026 OrangeFarm. All rights reserved. */

/* Self-contained so the standalone kiosk can use the identical local policy. */
export function installSoundPreferences(host) {
  if (host.OrangeTalkSound) return host.OrangeTalkSound;
  const storageKey = 'orangetalk.sound-preferences.v1';
  const categories = ['confirm', 'interface', 'schedule', 'updates', 'bed', 'reception', 'kioskChime', 'kioskVoice'];
  const listeners = new Set();
  const playing = new Set();
  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    const result = { muted: input.muted === true, categories: {} };
    categories.forEach(key => { result.categories[key] = !(input.categories && input.categories[key] === false); });
    return result;
  }
  function read() {
    try { return normalize(JSON.parse(host.localStorage.getItem(storageKey) || 'null')); }
    catch (_) { return normalize(null); }
  }
  let settings = read();
  const copy = () => ({ muted: settings.muted, categories: { ...settings.categories } });
  const isEnabled = key => !settings.muted && settings.categories[key] !== false;
  function changed() {
    Array.from(playing).forEach(entry => {
      if (!isEnabled(entry.key)) {
        playing.delete(entry);
        try { entry.stop(); } catch (_) {}
      }
    });
    listeners.forEach(listener => { try { listener(copy()); } catch (_) {} });
  }
  function update(patch) {
    const next = normalize({
      muted: typeof patch.muted === 'boolean' ? patch.muted : settings.muted,
      categories: { ...settings.categories, ...(patch.categories || {}) }
    });
    try { host.localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch (_) { return false; }
    settings = next;
    changed();
    return true;
  }
  function registerStop(key, stop) {
    const entry = { key, stop };
    playing.add(entry);
    return () => playing.delete(entry);
  }
  function playMedia(audio, key) {
    if (!isEnabled(key)) return Promise.resolve(false);
    let release = () => {};
    function clean() {
      release();
      audio.removeEventListener('ended', clean);
      audio.removeEventListener('error', clean);
      audio.removeEventListener('pause', clean);
    }
    release = registerStop(key, () => {
      clean();
      try { audio.pause(); audio.currentTime = 0; } catch (_) {}
    });
    audio.addEventListener('ended', clean);
    audio.addEventListener('error', clean);
    audio.addEventListener('pause', clean);
    try {
      return Promise.resolve(audio.play()).then(() => true, error => { clean(); throw error; });
    } catch (error) { clean(); return Promise.reject(error); }
  }
  const api = {
    storageKey, getSettings: copy, isEnabled, update, registerStop, playMedia,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
  host.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    settings = read();
    changed();
  });
  host.OrangeTalkSound = api;
  return api;
}

export const soundPreferences = installSoundPreferences(window);
export const isSoundEnabled = key => soundPreferences.isEnabled(key);
export const playSoundMedia = (audio, key) => soundPreferences.playMedia(audio, key);
export const registerSoundStop = (key, stop) => soundPreferences.registerStop(key, stop);
export const soundCategoryForFile = file => ({
  'caution.wav': 'confirm',
  'quickmenu.wav': 'interface',
  'happybell.wav': 'schedule',
  'updatenotification.wav': 'updates'
}[String(file).split('/').pop()] || 'interface');
