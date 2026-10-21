/* Focused workspace controls: DOM only; edits use the existing change/input handlers. */
let nextPickerId = 0;

function installControlStyles() {
  if (document.getElementById('symFocusControlStyles')) return;
  const style = document.createElement('style');
  style.id = 'symFocusControlStyles';
  style.textContent = `
    #symCatBox.sym-focused-workspace .sym-focus-browse-pane { position:relative; isolation:isolate; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-trigger { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-width:0; min-height:36px; padding:7px 9px; border:1px solid var(--bdr); border-radius:7px; background:var(--card); color:var(--t1); text-align:left; font:12px/1.45 var(--f); cursor:pointer; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-trigger>span:first-child { min-width:0; overflow-wrap:anywhere; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-trigger[aria-expanded="true"] { border-color:var(--cyan); color:var(--cyan); }
    #symCatBox.sym-focused-workspace .sym-focus-filter-panel { position:absolute; box-sizing:border-box; z-index:5; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border:1px solid var(--bdr); border-radius:10px; background:var(--card); color:var(--t1); box-shadow:0 6px 18px rgba(0,0,0,.12); }
    #symCatBox.sym-focused-workspace .sym-focus-filter-panel[hidden],
    #symCatBox.sym-focused-workspace .sym-focus-inline-unit-editor[hidden] { display:none!important; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; flex:0 0 auto; background:var(--bg2); border-bottom:1px solid var(--bdr); }
    #symCatBox.sym-focused-workspace .sym-focus-filter-heading strong { font-size:14px; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-panel[data-compact="true"] .sym-focus-filter-heading { padding:6px 8px; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-panel[data-compact="true"] .sym-focus-filter-search { padding:6px 8px; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-panel[data-compact="true"] .sym-focus-filter-search input { min-height:32px; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-search { display:block; flex:0 0 auto; padding:10px 12px; font-size:12px; color:var(--t2); }
    #symCatBox.sym-focused-workspace .sym-focus-filter-search input { box-sizing:border-box; display:block; width:100%; min-width:0; margin-top:5px; min-height:36px; font-size:14px; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-options { flex:1 1 0; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:0 8px 8px; scrollbar-width:thin; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-group { padding:9px 6px 5px; font-size:12px; font-weight:700; color:var(--t2); }
    #symCatBox.sym-focused-workspace .sym-focus-filter-option { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-height:38px; margin:3px 0; padding:8px; border:1px solid transparent; border-radius:7px; background:var(--card); color:var(--t1); text-align:left; white-space:normal; overflow-wrap:anywhere; font:13px/1.5 var(--f); cursor:pointer; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-option:hover { background:var(--bg2); }
    #symCatBox.sym-focused-workspace .sym-focus-filter-option[aria-pressed="true"] { background:color-mix(in srgb,var(--cyan) 9%,var(--card)); border-color:var(--cyan); color:var(--cyan); font-weight:700; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-empty { padding:14px 8px; font-size:12px; color:var(--t2); }
    #symCatBox.sym-focused-workspace .sym-focus-inline-unit-editor { flex:0 0 100%; width:100%; min-width:0; box-sizing:border-box; padding:10px 0 0; margin-top:4px; border-top:1px solid var(--bdr); display:grid; gap:9px; }
    #symCatBox.sym-focused-workspace .sym-focus-unit-presets { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; min-width:0; }
    #symCatBox.sym-focused-workspace .sym-focus-unit-presets button { width:100%; min-width:0; min-height:32px; padding:5px 3px; white-space:normal; overflow-wrap:anywhere; font-size:12px; }
    #symCatBox.sym-focused-workspace .sym-focus-unit-custom-label { display:grid; gap:5px; min-width:0; color:var(--t2); font-size:12px; }
    #symCatBox.sym-focused-workspace .sym-focus-unit-custom-label input { box-sizing:border-box; width:100%; min-width:0; min-height:36px; padding:7px 8px; font-size:14px; }
    #symCatBox.sym-focused-workspace .sym-focus-unit-actions { display:flex; flex-wrap:wrap; gap:6px; }
    #symCatBox.sym-focused-workspace .sym-focus-unit-error { margin:0; color:var(--rs); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
    #symCatBox.sym-focused-workspace .sym-focus-filter-panel button:focus-visible,
    #symCatBox.sym-focused-workspace .sym-focus-filter-trigger:focus-visible,
    #symCatBox.sym-focused-workspace .sym-focus-inline-unit-editor :is(input,button):focus-visible { outline:2px solid var(--cyan); outline-offset:-2px; }
  `;
  document.head.appendChild(style);
}

function makeButton(text, className = 'btn btn-sm') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = text;
  return button;
}

function createFilterPicker(pop, select) {
  const pane = pop.querySelector('.sym-focus-browse-pane');
  if (!pane) return null;
  const title = select.dataset.medBrowseField === 'category' ? '약품 분류' : '등록 구분';
  const trigger = makeButton('', 'sym-focus-filter-trigger');
  trigger.dataset.symFocusNative = '1';
  trigger.setAttribute('aria-label',title + ' 선택');
  trigger.setAttribute('aria-expanded','false');
  const caption = document.createElement('span');
  const arrow = document.createElement('span'); arrow.textContent = '▾'; arrow.setAttribute('aria-hidden','true');
  trigger.append(caption,arrow);
  const panel = document.createElement('section');
  panel.className = 'sym-focus-filter-panel'; panel.hidden = true;
  panel.id = 'symFocusFilterPicker-' + (++nextPickerId);
  panel.dataset.symFocusLocalEditor = '1'; panel.dataset.symFocusNative = '1';
  panel.setAttribute('aria-label',title + ' 선택 목록'); trigger.setAttribute('aria-controls',panel.id);
  const heading = document.createElement('div'); heading.className = 'sym-focus-filter-heading';
  const name = document.createElement('strong'); name.textContent = title;
  const dismiss = makeButton('닫기'); heading.append(name,dismiss);
  const searchLabel = document.createElement('label'); searchLabel.className = 'sym-focus-filter-search'; searchLabel.textContent = title + ' 찾기';
  const search = document.createElement('input'); search.className = 'form-input'; search.type = 'text'; search.autocomplete = 'off'; search.placeholder = title + ' 이름 검색';
  searchLabel.appendChild(search);
  const options = document.createElement('div'); options.className = 'sym-focus-filter-options'; options.setAttribute('role','group'); options.setAttribute('aria-label',title);
  panel.append(heading,searchLabel,options); pane.appendChild(panel);
  select.hidden = true; select.style.setProperty('display','none','important'); select.after(trigger);
  let positionFrame = 0;
  let stopPositioning = null;
  function positionPanel() {
    if (panel.hidden || !panel.isConnected || !pane.isConnected) return false;
    const viewport = window.visualViewport;
    let left = viewport?.offsetLeft || 0;
    let top = viewport?.offsetTop || 0;
    let right = left + (viewport?.width || window.innerWidth);
    let bottom = top + (viewport?.height || window.innerHeight);
    const clips = value => /^(auto|scroll|hidden|clip)$/.test(value);
    // Intersect client areas, not scroll-content bounds. Each ancestor can clip one axis.
    for (let node = pane; node instanceof HTMLElement; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (node === pane || clips(style.overflowX)) {
        left = Math.max(left, rect.left + node.clientLeft);
        right = Math.min(right, rect.left + node.clientLeft + node.clientWidth);
      }
      if (node === pane || clips(style.overflowY)) {
        top = Math.max(top, rect.top + node.clientTop);
        bottom = Math.min(bottom, rect.top + node.clientTop + node.clientHeight);
      }
    }
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return false;
    const inset = Math.min(8, width / 8, height / 8);
    const origin = pane.getBoundingClientRect();
    panel.style.left = (left + inset - origin.left - pane.clientLeft + pane.scrollLeft) + 'px';
    panel.style.top = (top + inset - origin.top - pane.clientTop + pane.scrollTop) + 'px';
    panel.style.width = (width - inset * 2) + 'px';
    panel.style.height = (height - inset * 2) + 'px';
    panel.dataset.compact = String(height - inset * 2 < 240);
    return true;
  }
  function trackPosition() {
    stopPositioning?.();
    let revealOnResize = false;
    const schedule = (event, reveal = false) => {
      if (event?.target instanceof Node && panel.contains(event.target)) return;
      revealOnResize = revealOnResize || reveal;
      if (positionFrame) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = 0;
        if (revealOnResize) pane.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
        revealOnResize = false;
        if (!positionPanel()) close(false);
      });
    };
    const onResize = () => schedule(null, true);
    const resizeObserver = new ResizeObserver(onResize);
    for (let node = pane; node instanceof HTMLElement; node = node.parentElement) resizeObserver.observe(node);
    const removalObserver = new MutationObserver(() => {
      if (!panel.isConnected) close(false);
    });
    removalObserver.observe(document.body, {childList:true, subtree:true});
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', schedule);
    stopPositioning = () => {
      resizeObserver.disconnect(); removalObserver.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', schedule);
      if (positionFrame) cancelAnimationFrame(positionFrame);
      positionFrame = 0; stopPositioning = null;
    };
  }
  function close(restoreFocus = true) {
    stopPositioning?.();
    panel.hidden = true; trigger.setAttribute('aria-expanded','false');
    if (restoreFocus && trigger.isConnected) trigger.focus({preventScroll:true});
  }
  function renderOptions() {
    const query = search.value.trim().normalize('NFC').toLocaleLowerCase('ko');
    options.replaceChildren();
    let lastGroup = '', count = 0;
    Array.from(select.options).forEach(option => {
      const parent = option.parentElement;
      if (option.hidden || option.disabled || (parent.tagName === 'OPTGROUP' && parent.disabled)) return;
      const group = parent.tagName === 'OPTGROUP' ? parent.label : '';
      if (query && !(group + ' ' + option.textContent).normalize('NFC').toLocaleLowerCase('ko').includes(query)) return;
      if (group && group !== lastGroup) {
        const label = document.createElement('div'); label.className = 'sym-focus-filter-group'; label.textContent = group; options.appendChild(label);
      }
      lastGroup = group;
      const choice = makeButton(option.textContent,'sym-focus-filter-option');
      choice.setAttribute('aria-pressed',String(select.value === option.value));
      choice.addEventListener('click',event => {
        event.preventDefault(); event.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        close();
      });
      options.appendChild(choice); count++;
    });
    if (!count) { const empty = document.createElement('div'); empty.className = 'sym-focus-filter-empty'; empty.textContent = '일치하는 분류가 없습니다.'; options.appendChild(empty); }
  }
  function refresh() {
    caption.textContent = select.selectedOptions[0]?.textContent || '선택하세요';
    if (!panel.hidden) renderOptions();
  }
  trigger.addEventListener('click',event => {
    event.preventDefault(); event.stopPropagation();
    if (!panel.hidden) { close(); return; }
    pop.querySelectorAll('[data-med-browse-field]').forEach(other => { if (other !== select) other._focusPicker?.close(false); });
    // Make the browse pane reachable before measuring its visible intersection.
    // This only scrolls existing containers; selected drugs and doses are untouched.
    pane.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    panel.hidden = false; trigger.setAttribute('aria-expanded','true'); search.value = ''; renderOptions();
    if (!positionPanel()) { close(); return; }
    trackPosition(); search.focus({preventScroll:true});
  });
  dismiss.addEventListener('click',event => { event.stopPropagation(); close(); });
  search.addEventListener('input',renderOptions);
  panel.addEventListener('keydown',event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target !== search && !options.contains(event.target)) return;
    const choices = Array.from(options.querySelectorAll('button'));
    if (!choices.length) return;
    event.preventDefault();
    const index = choices.indexOf(document.activeElement);
    choices[index < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length].focus();
  });
  pop.addEventListener('mousedown',event => { if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(false); });
  const picker = {refresh,close}; select._focusPicker = picker; refresh(); return picker;
}

export function refreshFocusedMedicationControls(pop) {
  if (!pop || pop.dataset.symFocusDock !== '1') return;
  installControlStyles();
  pop.querySelectorAll('[data-med-browse-field]').forEach(select => {
    if (select.tagName !== 'SELECT') return;
    const picker = select._focusPicker || createFilterPicker(pop,select);
    picker?.refresh();
  });
}

export function attachFocusedMedicationUnits(root, readUnit, replaceUnit) {
  installControlStyles();
  root.querySelectorAll('.sym-med-dose-wrap').forEach(wrap => {
    if (wrap._focusedUnitsBound) return;
    const input = wrap.querySelector('[data-action="medDoseInput"]');
    const oldTrigger = wrap.querySelector('.sym-med-unit-trigger');
    if (!input || !oldTrigger) return;
    wrap._focusedUnitsBound = true; wrap._unitHoverBound = true;
    wrap.querySelector('.sym-med-unit-menu')?.remove();
    const trigger = makeButton('단위 선택', 'btn btn-sm sym-med-unit-trigger');
    trigger.dataset.med = input.dataset.med; trigger.dataset.symFocusNative = '1'; trigger.setAttribute('aria-expanded','false');
    oldTrigger.replaceWith(trigger);
    const editor = document.createElement('div'); editor.className = 'sym-focus-inline-unit-editor'; editor.hidden = true;
    editor.dataset.symFocusLocalEditor = '1'; editor.dataset.symFocusNative = '1';
    editor.setAttribute('role','group'); editor.setAttribute('aria-label','약품 단위 선택 및 직접 입력');
    const presets = document.createElement('div'); presets.className = 'sym-focus-unit-presets';
    const customLabel = document.createElement('label'); customLabel.className = 'sym-focus-unit-custom-label'; customLabel.textContent = '단위 직접 입력';
    const custom = document.createElement('input'); custom.type = 'text'; custom.className = 'form-input'; custom.maxLength = 12; custom.autocomplete = 'off'; custom.placeholder = '예: 정, 캡슐, 매';
    customLabel.appendChild(custom);
    const actions = document.createElement('div'); actions.className = 'sym-focus-unit-actions';
    const apply = makeButton('적용'); const cancel = makeButton('취소'); actions.append(apply,cancel);
    const message = document.createElement('div'); message.className = 'sym-focus-unit-error'; message.setAttribute('role','alert');
    editor.append(presets,customLabel,actions,message); wrap.appendChild(editor);
    function close(restoreInput = false) {
      editor.hidden = true; message.textContent = ''; trigger.setAttribute('aria-expanded','false'); trigger.textContent = '단위 선택';
      (restoreInput ? input : trigger).focus({preventScroll:true});
    }
    function applyUnit(unit) {
      try {
        const value = replaceUnit(input.value,unit);
        input.value = value;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        close(true);
      } catch (error) { message.textContent = error.message; custom.focus({preventScroll:true}); }
    }
    ['T','C','g','cc','ml','mg','gtt','포','개','병'].forEach(unit => {
      const button = makeButton(unit === 'gtt' ? 'gtt(방울)' : unit);
      button.addEventListener('click',event => { event.stopPropagation(); applyUnit(unit); }); presets.appendChild(button);
    });
    trigger.addEventListener('click',event => {
      event.preventDefault(); event.stopPropagation();
      if (!editor.hidden) { close(); return; }
      editor.hidden = false; message.textContent = ''; custom.value = readUnit(input.value) || '';
      trigger.setAttribute('aria-expanded','true'); trigger.textContent = '단위 접기';
      presets.firstElementChild?.focus({preventScroll:true});
      editor.scrollIntoView({block:'nearest'});
    });
    apply.addEventListener('click',event => { event.stopPropagation(); applyUnit(custom.value); });
    cancel.addEventListener('click',event => { event.stopPropagation(); close(); });
    editor.addEventListener('keydown',event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Enter' && event.target === custom) { event.preventDefault(); applyUnit(custom.value); }
    });
  });
}
