/* Remember each diary list visibility across navigation and app restarts. */
const lists = new Map();
const VISIBILITY_KEY = 'ec_diary_list_visibility';
let savedVisibility = {};
try {
  const value = JSON.parse(localStorage.getItem(VISIBILITY_KEY) || '{}');
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['daily', 'period', 'history']) {
      if (value[key] === true) savedVisibility[key] = true;
    }
  }
} catch (_) {}

function saveVisibility() {
  lists.forEach((list, key) => { savedVisibility[key] = list.show === true; });
  try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(savedVisibility)); }
  catch (_) {}
}
const boundRoots = new WeakSet();
const ROW = '[data-diary-private-row]';
const EYE_ICON = '<svg class="daily-privacy-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
const HIDE_ICON = '<svg class="daily-privacy-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 3 18 18M10.6 7.1c.5-.1.9-.1 1.4-.1 4 0 7.3 1.9 9.5 5a14.5 14.5 0 0 1-3.1 3.1M6.4 8.5A15 15 0 0 0 2.5 12c2.2 3.1 5.5 5 9.5 5 1.3 0 2.6-.2 3.7-.6M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6"/></svg>';

function enabled() {
  try { return localStorage.getItem('ec_privacy_mode') === '1'; }
  catch (_) { return false; }
}

function installStyles() {
  if (document.getElementById('dailyPrivacyStyles')) return;
  const style = document.createElement('style');
  style.id = 'dailyPrivacyStyles';
  style.textContent = [
    '.daily-privacy-tools{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin:4px 0 6px;flex:0 0 auto;min-width:0;font-family:var(--f);color:var(--t2)}',
    '.daily-privacy-tools[hidden]{display:none!important}',
    '.daily-period-active [data-privacy-list="daily"]{display:none!important}',
    '.daily-privacy-tools .daily-privacy-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:0;box-sizing:border-box;width:44px;height:44px;min-width:44px;min-height:44px;margin:0;padding:6px;font:inherit;font-size:12px;font-weight:600;line-height:1.4;white-space:nowrap;--daily-privacy-accent:#5a8446;color:var(--t2);color:color-mix(in srgb,var(--daily-privacy-accent) 70%,var(--t1));background:transparent;border:0;border-radius:12px;box-shadow:none;cursor:pointer;flex:0 0 auto}',
    '.daily-privacy-tools .daily-privacy-button[aria-pressed="true"]{--daily-privacy-accent:#e47729;background:transparent}',
    '@media(hover:hover){.daily-privacy-tools .daily-privacy-button:hover{background:transparent}}',
    '.daily-privacy-tools .daily-privacy-icon{display:block;width:20px;height:20px;flex:none;pointer-events:none}',
    '.daily-privacy-tools .daily-privacy-button:focus-visible{outline:2px solid var(--daily-privacy-accent);outline-offset:2px}',
    '.daily-private-list '+ROW+'{transition:filter .12s ease}',
    '.daily-private-list:not(.daily-private-list-open) '+ROW+'{filter:blur(3px);user-select:none}',
    '.daily-private-list:not(.daily-private-list-open) '+ROW+':focus-within{filter:none;user-select:text}',
    '@media(hover:hover){.daily-private-list:not(.daily-private-list-open) '+ROW+':hover{filter:none;user-select:text}}',
    '.daily-private-list '+ROW+':focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}',
    '.daily-privacy-inactive .daily-private-list:not(.daily-private-list-open) '+ROW+'{filter:blur(3px)!important;user-select:none!important}',
    '.date-visitors-panel .dv-edit-item{width:100%;min-width:0;text-align:left;font:inherit;color:var(--t1);cursor:pointer;background:transparent;border:0;border-bottom:1px solid var(--bdr);border-radius:0}',
    '.date-visitors-panel .dv-edit-item:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}',
    '.date-visitors-panel .daily-privacy-tools{padding:4px 8px;margin:0;border-bottom:1px solid var(--bdr)}',
    '.daily-period-tools .daily-privacy-tools{margin:0 0 0 auto}',
    '@media(prefers-reduced-motion:reduce){.daily-private-list '+ROW+'{transition:none}}'
  ].join('\n');
  document.head.appendChild(style);
}

function paint(list) {
  const protect = enabled();
  list.root.classList.toggle('daily-private-list', protect);
  list.root.classList.toggle('daily-private-list-open', protect && list.show);
  const rows = list.root.querySelectorAll(list.options.rowSelector || 'tr[data-rec-id]');
  rows.forEach(row => {
    row.setAttribute('data-diary-private-row', '');
    // Remove the old per-row filter so the same rules apply in both tables.
    row.style.filter = '';
    row.style.userSelect = '';
    row.onmouseenter = null;
    row.onmouseleave = null;
    if (row.tagName === 'TR' && !row.hasAttribute('tabindex')) row.tabIndex = 0;
  });
  list.toolbar.hidden = !protect || rows.length === 0;
  const label = list.show ? '\uac1c\uc778\uc815\ubcf4 \uac00\ub9ac\uae30' : '\uac1c\uc778\uc815\ubcf4 \ud45c\uc2dc';
  list.button.innerHTML = list.show ? HIDE_ICON : EYE_ICON;
  list.button.setAttribute('aria-label', label);
  list.button.setAttribute('aria-pressed', String(protect && list.show));
  list.button.title = label;
}

function bindRoot(root) {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);
  root.addEventListener('pointerdown', event => {
    const list = root._diaryPrivacyList;
    const row = event.target.closest(ROW);
    list.touchReveal = event.pointerType === 'touch' && enabled() && !list.show
      && row && root.contains(row) && !row.contains(document.activeElement) ? row : null;
  }, true);
  root.addEventListener('click', event => {
    const list = root._diaryPrivacyList;
    const row = event.target.closest(ROW);
    const reveal = list.touchReveal;
    list.touchReveal = null;
    if (reveal && row === reveal && enabled() && !list.show) {
      event.preventDefault();
      event.stopImmediatePropagation();
      row.focus({preventScroll:true});
    }
  }, true);
  root.addEventListener('keydown', event => {
    const list = root._diaryPrivacyList;
    const row = event.target.closest(ROW);
    if (!row || !root.contains(row) || event.target !== row) return;
    if (event.key === 'Escape' && enabled()) {
      event.preventDefault();
      list.show = false;
      saveVisibility();
      paint(list);
      list.button.focus({preventScroll:true});
    } else if (row.tagName === 'TR' && (event.key === 'Enter' || event.key === ' ')) {
      if (typeof list.options.onOpen !== 'function') return;
      event.preventDefault();
      event.stopPropagation();
      list.options.onOpen(row);
    }
  });
}

export function bindDiaryPrivacy(root, options) {
  if (!root) return;
  installStyles();
  let list = lists.get(options.key);
  if (!list) {
    list = {show:savedVisibility[options.key] === true, scope:options.scope};
    lists.set(options.key, list);
  }
  list.scope = options.scope;
  list.root = root;
  list.options = options;
  list.touchReveal = null;
  root._diaryPrivacyList = list;
  if (!list.toolbar || !list.toolbar.isConnected) {
    const bar = document.createElement('div');
    bar.className = 'daily-privacy-tools';
    bar.dataset.privacyList = options.key;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'daily-privacy-button';
    button.addEventListener('click', () => {
      if (!enabled()) return;
      list.show = !list.show;
      saveVisibility();
      paint(list);
    });
    bar.appendChild(button);
    list.toolbar = bar;
    list.button = button;
  }
  if (options.before && options.before.parentNode) {
    options.before.parentNode.insertBefore(list.toolbar, options.before);
  } else if (options.toolbarHost) {
    options.toolbarHost.appendChild(list.toolbar);
  }
  bindRoot(root);
  paint(list);
}

export function resetDiaryPrivacy(key) {
  if (key) savedVisibility[key] = false;
  else savedVisibility = {};
  lists.forEach((list, id) => {
    if (key && key !== id) return;
    list.show = false;
    list.touchReveal = null;
    paint(list);
  });
  saveVisibility();
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    document.documentElement.classList.add('daily-privacy-inactive');
  });
  window.addEventListener('focus', () => {
    if (!document.hidden) document.documentElement.classList.remove('daily-privacy-inactive');
  });
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('daily-privacy-inactive', document.hidden);
  });
}
