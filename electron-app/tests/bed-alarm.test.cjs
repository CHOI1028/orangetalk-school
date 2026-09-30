/* Execute the production alarm lifecycle without renderer startup, real audio,
 * user records, storage, or network access. Audio promises and observer/timer
 * delivery are controlled to reproduce dismiss/play races deterministically. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/features/newsletter/bed-management-view.js'), 'utf8');
function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'Production boundaries must exist: ' + startMarker);
  return source.slice(start, end);
}
const alarmSource = section('function _bedShowAlarm(usage){', '/* ── Bed Manager Modal');
const syntheticSource = section('function _bedPlaySyntheticAlarm(', 'function _bedTogglePreview(');
const flushPromises = async () => { await Promise.resolve(); await Promise.resolve(); };
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const decodeHtml = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    const list = this.listeners.get(type) || [];
    if(!list.some(item => item.callback === callback && item.capture === capture)) {
      list.push({ callback, capture, once: !!options.once });
    }
    this.listeners.set(type, list);
  }
  removeEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback || item.capture !== capture));
  }
  dispatchEvent(event) {
    event.target ||= this;
    for(const item of [...(this.listeners.get(event.type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if(event.immediateStopped) break;
      if(item.once) this.removeEventListener(event.type, item.callback, item.capture);
      item.callback.call(this, event);
    }
  }
  count(type) { return (this.listeners.get(type) || []).length; }
}

function event(type, properties = {}) {
  return { type, ...properties, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediateStopped = this.propagationStopped = true; }
  };
}

function harness({ rejectOnPause = true, audioConstructorError = null } = {}) {
  const observers = [], audio = [], synth = [], timers = new Map();
  const state = { saves: 0, renders: 0, previewStops: 0 };
  let nextTimer = 1;
  function mutate(target, type, attributeName) {
    for(const observer of observers) {
      if(observer.targets.some(({ node, options }) => (node === target || (options.subtree && node.contains(target))) &&
        (type === 'childList' ? options.childList : options.attributes && (!options.attributeFilter || options.attributeFilter.includes(attributeName))))) {
        observer.records.push({ target, type, attributeName });
      }
    }
  }
  class Element extends Events {
    constructor(tagName) {
      super();
      this.tagName = tagName.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {};
      this.id = ''; this._text = ''; this._className = ''; this._hidden = false;
      this.style = new Proxy({}, { set: (styles, key, value) => { styles[key] = value; mutate(this, 'attributes', 'style'); return true; } });
      this.classList = {
        contains: token => this.className.split(/\s+/).includes(token),
        add: token => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), token])].join(' '); },
        remove: token => { this.className = this.className.split(/\s+/).filter(item => item !== token).join(' '); }
      };
    }
    get className() { return this._className; }
    set className(value) { this._className = value; mutate(this, 'attributes', 'class'); }
    get hidden() { return this._hidden; }
    set hidden(value) { this._hidden = value; mutate(this, 'attributes', 'hidden'); }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    get parentElement() { return this.parentNode; }
    get childElementCount() { return this.children.length; }
    appendChild(child) { child.parentNode = this; this.children.push(child); mutate(this, 'childList'); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; mutate(this, 'childList'); return child; }
    remove() { this.parentNode?.removeChild(this); }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    setAttribute(key, value = '') {
      this.attributes[key] = String(value);
      if(key === 'class') this.className = String(value);
      if(key === 'id') this.id = String(value);
      if(key === 'hidden') this.hidden = true;
      if(key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
      mutate(this, 'attributes', key);
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    matches(selector) {
      if(selector.startsWith('#')) return this.id === selector.slice(1);
      if(selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const attr = /^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);
      if(attr) return Object.hasOwn(this.attributes, attr[1]) && (attr[2] === undefined || this.attributes[attr[1]] === attr[2]);
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    set innerHTML(html) {
      this.textContent = '';
      const stack = [this];
      for(const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
        if(token.startsWith('</')) { if(stack.length > 1) stack.pop(); continue; }
        if(token.startsWith('<')) {
          const tag = /^<([a-z][\w-]*)/i.exec(token);
          if(!tag) continue;
          const child = new Element(tag[1]);
          for(const attr of token.slice(tag[0].length).matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) child.setAttribute(attr[1], decodeHtml(attr[2] ?? attr[3] ?? ''));
          stack.at(-1).appendChild(child);
          if(!/\/$/.test(token.slice(0, -1)) && !/^(br|hr|img|input)$/i.test(tag[1])) stack.push(child);
        } else stack.at(-1)._text += decodeHtml(token);
      }
    }
  }
  const document = new Events();
  document.body = new Element('body');
  document.documentElement = document.body;
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.body.querySelector('#' + id);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  const window = new Events();
  // The app's author .modal-overlay.show { display:flex } rule wins over the
  // browser's default [hidden] rule, so hidden must also be checked explicitly.
  const getComputedStyle = node => ({ display: node.style.display || (node.classList.contains('modal-overlay') ? (node.classList.contains('show') ? 'flex' : 'none') : (node.hidden ? 'none' : 'block')), visibility: node.style.visibility || 'visible', opacity: node.style.opacity || '1' });
  window.getComputedStyle = getComputedStyle;
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; this.records = []; observers.push(this); }
    observe(node, options) { this.targets.push({ node, options }); }
    disconnect() { this.targets = []; this.records = []; }
  }
  class Audio extends Events {
    constructor(src) {
      if(audioConstructorError) throw audioConstructorError;
      super(); this.src = src; this.loop = false; this.volume = 0; this.currentTime = 7; this.pauseCalls = 0; this.playing = false; this.pending = false; audio.push(this);
    }
    play() {
      this.pending = true;
      return new Promise((resolve, reject) => {
        this.resolve = () => { this.pending = false; this.playing = true; resolve(); };
        this.reject = error => { this.pending = false; this.playing = false; reject(error); };
      });
    }
    pause() {
      this.pauseCalls++; this.playing = false;
      if(this.pending && rejectOnPause) this.reject(Object.assign(new Error('play() was interrupted by pause()'), { name: 'AbortError' }));
    }
    removeAttribute(name) { if(name === 'src') this.src = ''; }
    load() {}
  }
  const context = vm.createContext({ document, window, Audio, MutationObserver, getComputedStyle, console,
    S: { _bedConfig: { beds: [{ id: 1 }, { id: 2 }, { id: 3 }] }, _bedUsage: [] },
    escHtml: escapeHtml, _bedLabel: (_, index) => '침상 ' + (index + 1),
    _bedAlarmSrc: index => './assets/sounds/alarm_' + index + (String(index) === '4' ? '.wav' : '.mp3'),
    _saveBedUsage() { state.saves++; }, _bedRenderBody() { state.renders++; },
    _bedAudioStopFn() { state.previewStops++; },
    _bedPlaySyntheticAlarm(preset, onEnd, trackPreview) {
      const playback = { preset, trackPreview, stopCalls: 0, finish: () => onEnd?.() };
      playback.stop = () => { playback.stopCalls++; };
      synth.push(playback);
      return playback.stop;
    },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext('let _bedAlarmAudio = null; let _bedAlarmSession = null;\n' + alarmSource + '\nglobalThis.show = _bedShowAlarm; globalThis.dismiss = _bedDismissAlarm;', context);
  return { document, window, audio, synth, timers, observers, state, context,
    show: context.show, dismiss: context.dismiss,
    overlay: () => document.getElementById('bedAlarmOverlay'),
    click(target) { const ev = event('click', { target }); for(let node = target; node && !ev.propagationStopped; node = node.parentNode) node.dispatchEvent(ev); return ev; },
    flushMutations() { for(const observer of observers) { const records = observer.records.splice(0); if(records.length) observer.callback(records, observer); } },
    nextTimer() { const [id, timer] = [...timers][0] || []; assert(timer, 'A fallback replay must be scheduled'); timers.delete(id); timer.callback(); }
  };
}

function usage(bedId = 1, studentName = '김하늘') { return { bedId, studentName, endTime: 1000 + bedId, alarm: true, alarmSound: '2' }; }
function assertClean(h) {
  assert.equal(h.overlay(), null, 'The alert must be removed');
  assert.equal(h.audio.some(item => item.playing), false, 'No file audio may remain playing');
  assert.equal(h.timers.size, 0, 'No fallback replay may remain scheduled');
  assert.equal(h.document.count('keydown'), 0, 'The alarm keyboard listener must be removed');
  assert.equal(h.window.count('beforeunload'), 0, 'The session unload listener must be removed');
  assert.equal(h.observers.some(observer => observer.targets.length), false, 'Observers must be disconnected');
}

for(const method of ['button', 'outside', 'Escape', 'modal-close']) {
  test('ready looping audio is stopped by ' + method, async () => {
    const h = harness(); h.show(usage());
    const sound = h.audio[0]; sound.resolve(); await flushPromises();
    assert.equal(sound.loop, true); assert.equal(sound.playing, true);
    if(method === 'button') h.click(h.overlay().querySelector('[data-action="dismissAlarm"]'));
    if(method === 'outside') h.click(h.overlay());
    if(method === 'Escape') {
      assert(h.document.listeners.get('keydown').some(item => item.capture), 'Alarm Escape must run during capture');
      const ev = event('keydown', { key: 'Escape' }); h.document.dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, true); assert.equal(ev.immediateStopped, true);
    }
    if(method === 'modal-close') { assert.equal(typeof h.overlay()._onModalClose, 'function'); h.overlay()._onModalClose(); }
    await flushPromises(); assert.equal(sound.pauseCalls, 1); assert.equal(sound.currentTime, 0);
    assert.equal(h.synth.length, 0); assertClean(h);
    h.dismiss(); assert.equal(sound.pauseCalls, 1, 'Repeated dismissal is harmless');
  });
}

test('Escape capture consumes the alarm without closing a background modal', async () => {
  const h = harness(); let backgroundClosed = 0;
  h.document.addEventListener('keydown', () => { backgroundClosed++; });
  h.show(usage()); h.audio[0].resolve(); await flushPromises();
  h.document.dispatchEvent(event('keydown', { key: 'Escape' }));
  assert.equal(backgroundClosed, 0); assert.equal(h.overlay(), null); assert.equal(h.audio[0].playing, false);
  assert.equal(h.document.count('keydown'), 1, 'Only the pre-existing listener remains');
});

test('pause while play is pending rejects with AbortError without resurrecting fallback', async () => {
  const h = harness(); h.show(usage()); h.dismiss(); await flushPromises();
  assert.equal(h.audio[0].pauseCalls, 1); assert.equal(h.synth.length, 0); assertClean(h);
});

test('an active play AbortError does not start synthetic fallback', async () => {
  const h = harness(); h.show(usage());
  h.audio[0].reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })); await flushPromises();
  assert.equal(h.synth.length, 0); assert(h.overlay()); h.dismiss(); assertClean(h);
});

test('a delayed unsupported-file rejection after dismissal cannot start audio', async () => {
  const h = harness({ rejectOnPause: false }); h.show(usage()); h.dismiss();
  h.audio[0].reject(new Error('unsupported audio')); await flushPromises();
  assert.equal(h.synth.length, 0); assertClean(h);
});

test('overlapping expirations share one popup and sound and retain every student', async () => {
  const h = harness(); const first = usage(1, '김하늘'); const second = usage(2, '이바다'); const active = { ...usage(3), endTime: 9000 };
  h.context.S._bedUsage = [first, second, active];
  h.show(first); h.show(second);
  assert.equal(h.document.querySelectorAll('#bedAlarmOverlay').length, 1);
  assert.equal(h.audio.length, 1); assert.equal(h.audio[0].pauseCalls, 0);
  const rows = h.overlay().querySelector('[data-bed-alarm-list]'); assert(rows, 'Alert rows must have a stable container');
  assert.match(rows.textContent, /김하늘/); assert.match(rows.textContent, /이바다/);
  assert.match(rows.textContent, /침상 1/); assert.match(rows.textContent, /침상 2/);
  assert.equal(rows.children.length, 2);
  assert.equal(h.context.S._bedUsage.length, 1); assert.equal(h.context.S._bedUsage[0], active); assert.equal(h.state.saves, 2);
  h.audio[0].resolve(); await flushPromises(); h.dismiss(); assertClean(h);
});

test('a rejected old play request cannot replace or stop the next alarm', async () => {
  const h = harness({ rejectOnPause: false }); h.show(usage(1)); h.dismiss(); h.show(usage(2, '새 학생'));
  const current = h.overlay(); h.audio[1].resolve(); await flushPromises();
  h.audio[0].reject(new Error('old request failed late')); await flushPromises();
  assert.equal(h.synth.length, 0); assert.equal(h.overlay(), current); assert.equal(h.audio[1].playing, true);
  h.dismiss(); assert.equal(h.audio[1].pauseCalls, 1); assertClean(h);
});

test('fallback repeats while visible and closes only its own synthetic playback', async () => {
  const h = harness(); h.show(usage()); h.audio[0].reject(new Error('decode failed')); await flushPromises();
  assert.equal(h.synth.length, 1); assert.equal(h.synth[0].trackPreview, false);
  h.synth[0].finish(); assert.equal(h.timers.size, 1); h.nextTimer(); assert.equal(h.synth.length, 2);
  h.synth[1].finish(); h.nextTimer(); assert.equal(h.synth.length, 3);
  h.dismiss(); assert.equal(h.synth[2].stopCalls, 1); assert.equal(h.state.previewStops, 0); assertClean(h);
  h.synth[2].finish(); assert.equal(h.timers.size, 0, 'A late oscillator ended callback must not schedule a replay');
});

test('a synchronous Audio constructor failure starts a stoppable synthetic alarm', () => {
  const h = harness({ audioConstructorError: new Error('Audio initialization unavailable') });
  h.show(usage()); assert(h.overlay()); assert.equal(h.audio.length, 0); assert.equal(h.synth.length, 1);
  h.synth[0].finish(); h.nextTimer(); assert.equal(h.synth.length, 2);
  h.dismiss(); assert.equal(h.synth[1].stopCalls, 1); assert.equal(h.state.previewStops, 0); assertClean(h);
});

test('dismissal cancels a fallback replay already waiting on its timer', async () => {
  const h = harness(); h.show(usage()); h.audio[0].reject(new Error('decode failed')); await flushPromises();
  h.synth[0].finish(); assert.equal(h.timers.size, 1); h.dismiss(); assertClean(h);
});

test('a late synthetic ended callback cannot interfere with a new session', async () => {
  const h = harness(); h.show(usage()); h.audio[0].reject(new Error('decode failed')); await flushPromises();
  h.dismiss(); h.show(usage(2)); h.audio[1].resolve(); await flushPromises();
  h.synth[0].finish(); assert.equal(h.timers.size, 0); assert.equal(h.audio[1].playing, true);
  h.dismiss(); assertClean(h);
});

for(const change of ['remove', 'display', 'visibility', 'class', 'hidden']) {
  test('external overlay ' + change + ' closes audio through its observer', async () => {
    const h = harness(); h.show(usage()); h.audio[0].resolve(); await flushPromises();
    const overlay = h.overlay();
    if(change === 'remove') overlay.remove();
    if(change === 'display') overlay.style.display = 'none';
    if(change === 'visibility') overlay.style.visibility = 'hidden';
    if(change === 'class') overlay.classList.remove('show');
    if(change === 'hidden') overlay.hidden = true;
    h.flushMutations(); assert.equal(h.audio[0].pauseCalls, 1); assertClean(h);
  });
}

test('beforeunload stops sound and releases the complete alarm session', async () => {
  const h = harness(); h.show(usage()); h.audio[0].resolve(); await flushPromises();
  h.window.dispatchEvent(event('beforeunload')); assert.equal(h.audio[0].pauseCalls, 1); assertClean(h);
});

test('student names are rendered as text, including markup-like names', async () => {
  const h = harness(); h.show(usage(1, '<img src=x onerror=bad()> & 학생'));
  const rows = h.overlay().querySelector('[data-bed-alarm-list]');
  assert(rows); assert.match(rows.textContent, /<img src=x onerror=bad\(\)> & 학생/); assert.equal(rows.querySelectorAll('img').length, 0);
  h.dismiss(); await flushPromises(); assertClean(h);
});

function syntheticHarness() {
  const oscillators = [];
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  class AudioContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createOscillator() {
      const oscillator = { frequency: param(), stops: [], disconnected: false, connect() {}, disconnect() { this.disconnected = true; }, start() {}, stop(at) { this.stops.push(at); } };
      oscillators.push(oscillator); return oscillator;
    }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
  }
  const context = vm.createContext({ window: { AudioContext }, bus: { emit() {} }, console });
  vm.runInContext('let _bedAudioCtx = null; let _bedAudioStopFn = null;\n' + syntheticSource + '\nglobalThis.play = _bedPlaySyntheticAlarm; globalThis.previewStop = () => _bedAudioStopFn;', context);
  return { context, oscillators };
}

test('production synthetic alarms return an independent stop handle without taking preview ownership', () => {
  const h = syntheticHarness(); let previewEnded = 0, alarmEnded = 0;
  h.context.play('1', () => { previewEnded++; }); const previewStop = h.context.previewStop();
  assert.equal(typeof previewStop, 'function');
  const alarmStop = h.context.play('2', () => { alarmEnded++; }, false);
  assert.equal(typeof alarmStop, 'function', 'Each actual alarm must own its stop function');
  assert.equal(h.context.previewStop(), previewStop, 'Starting an alarm must preserve preview ownership');
  alarmStop(); assert.equal(h.oscillators[1].stops.at(-1), 0); assert.equal(h.oscillators[0].stops.length, 1);
  h.oscillators[1].onended(); assert.equal(h.context.previewStop(), previewStop); assert.equal(previewEnded, 0);
  assert.equal(alarmEnded, 1); previewStop(); assert.equal(h.oscillators[0].stops.at(-1), 0);
});

test('an old synthetic preview ending does not clear the next preview stop handle', () => {
  const h = syntheticHarness(); h.context.play('1', () => {}); h.context.play('3', () => {});
  const latestStop = h.context.previewStop(); h.oscillators[0].onended();
  assert.equal(h.context.previewStop(), latestStop); latestStop(); assert.equal(h.oscillators[1].stops.at(-1), 0);
});
