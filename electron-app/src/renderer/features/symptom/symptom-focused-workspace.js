/* Presentation-only workspace. Never reads or writes application settings or records. */
export { attachFocusedMedicationUnits, refreshFocusedMedicationControls } from './symptom-focus-controls.js';

import { mountSymptomCategoryPicker } from './symptom-category-picker.js';
import { installSymptomTreatmentStyles } from './symptom-treatment-style.js';

let preferFocusedWorkspace = true;

function installStyles() {
  if (document.getElementById('symFocusedWorkspaceStyles')) return;
  const style = document.createElement('style');
  style.id = 'symFocusedWorkspaceStyles';
  style.textContent = `

    #symCatBox.sym-shared-workspace { border-radius:16px; width:min(1200px,calc(var(--school-viewport-width,100vw) - 32px))!important; max-width:calc(var(--school-viewport-width,100vw) - 32px)!important; height:min(860px,calc(var(--school-viewport-height,100dvh) - 32px))!important; max-height:calc(var(--school-viewport-height,100dvh) - 32px)!important; left:max(16px,calc((var(--school-viewport-width,100vw) - 1200px)/2))!important; top:max(16px,calc((var(--school-viewport-height,100dvh) - 860px)/2))!important; }
    #symCatBox.sym-shared-workspace .sym-workspace-body { min-width:0;min-height:0; }
    #symCatBox.sym-shared-workspace:not(.sym-focused-workspace) #symCatList { width:clamp(132px,18vw,180px)!important;min-width:0; }
    #symCatBox.sym-shared-workspace:not(.sym-focused-workspace) #symSymList { width:clamp(180px,23vw,260px)!important;min-width:0; }
    #symCatBox.sym-shared-workspace:not(.sym-focused-workspace) #symTreatPanel { min-width:0;overflow-wrap:anywhere; }
    @media(max-width:760px){
      #symCatBox.sym-shared-workspace:not(.sym-focused-workspace)>.sym-workspace-body { display:grid!important;grid-template-columns:minmax(120px,1fr) minmax(0,1.7fr);grid-template-rows:minmax(240px,auto) minmax(240px,auto);overflow:auto!important; }
      #symCatBox.sym-shared-workspace:not(.sym-focused-workspace) #symCatList,
      #symCatBox.sym-shared-workspace:not(.sym-focused-workspace) #symSymList { width:100%!important;max-height:300px;box-sizing:border-box; }
      #symCatBox.sym-shared-workspace:not(.sym-focused-workspace) #symTreatPanel { grid-column:1/-1;min-height:240px; }
      #symCatBox.sym-shared-workspace .sym-editor-header { max-height:42%;overflow:auto; }
    }
    #symCatBox.sym-focused-workspace .sym-editor-header { padding:14px 20px 10px; }
    #symCatBox.sym-focused-workspace .sym-editor-title { font-size:15px; color:var(--t1); }
    #symCatBox .sym-focus-toggle { font-size:12px; min-height:32px; }
    #symCatBox.sym-focused-workspace .sym-editor-name { font-size:22px; }
    #symCatBox.sym-focused-workspace .sym-focus-tools { margin-top:8px; }
    #symCatBox.sym-focused-workspace .sym-focus-tools>summary { cursor:pointer; padding:6px 0; color:var(--t2); font:600 12px/1.5 var(--f); }
    #symCatBox.sym-focused-workspace .sym-focus-body { display:grid!important; grid-template-columns:minmax(250px,29%) minmax(0,1fr); gap:0; flex:1 1 auto!important; min-height:0; overflow:hidden!important; }
    #symCatBox.sym-focused-workspace .sym-focus-left { display:flex; flex-direction:column; min-width:0; min-height:0; overflow-y:auto; overscroll-behavior:contain; background:color-mix(in srgb,var(--cyan) 3%,var(--card)); border-right:1px solid var(--bdr); }
    #symCatBox.sym-focused-workspace .sym-focus-heading { flex:0 0 auto; padding:14px 16px 8px; font-size:14px; font-weight:700; color:var(--t1); }
    #symCatBox.sym-focused-workspace #symQuickSearchRow { margin:0!important; padding:0 14px 10px; flex:0 0 auto; }
    #symCatBox.sym-focused-workspace #symQuickSearchInput { min-height:40px; font-size:14px!important; background:var(--card); }
    #symCatBox.sym-focused-workspace #symQuickSearchList { left:14px!important; right:14px!important; }
    #symCatBox.sym-focused-workspace .sym-focus-category { display:grid; flex:0 0 auto; gap:5px; padding:0 14px 10px; color:var(--t2); font-size:12px; }
    #symCatBox.sym-focused-workspace .sym-focus-category select { width:100%; min-width:0; min-height:40px; font-size:14px; }
    #symCatBox.sym-focused-workspace #symCatList { display:none!important; }
    #symCatBox.sym-focused-workspace #symSymList { width:100%!important; height:auto!important; flex:1 1 auto!important; min-height:120px; border-right:0!important; padding:4px 10px 14px!important; overflow-y:auto!important; }
    #symCatBox.sym-focused-workspace #symSymList .sym-sel-chip[data-action="toggleSym"] { min-height:44px; margin-bottom:7px!important; font-size:16px!important; background:var(--card); }
    #symCatBox.sym-focused-workspace #symSymList .sym-sel-chip.is-sel { background:color-mix(in srgb,var(--cyan) 10%,var(--card))!important; }
    #symCatBox.sym-focused-workspace .sym-focus-work { display:flex; flex-direction:column; min-width:0; min-height:0; overflow-y:auto; padding:0 16px 14px; gap:12px; }
    #symCatBox.sym-focused-workspace .sym-focus-work>.sym-focus-heading { padding-left:0; padding-bottom:0; }
    #symCatBox.sym-focused-workspace #symTreatPanel { flex:1 0 180px!important; min-width:0; min-height:180px; padding:0!important; overflow-y:auto!important; }
    #symCatBox.sym-focused-workspace .sym-focus-work.has-medication #symTreatPanel { flex:0 0 180px!important; max-height:220px; }
    #symCatBox.sym-focused-workspace #symTreatPanel .sym-fav-chip { font-size:15px!important; min-height:38px; }
    #symCatBox.sym-focused-workspace #symTreatPanel .sym-block-pair { margin-bottom:10px; padding:14px; }
    #symCatBox.sym-focused-workspace #symFocusMedicationDock { min-width:0; flex:0 0 auto; }
    #symCatBox.sym-focused-workspace .sym-focus-work.has-medication #symFocusMedicationDock { flex:1 0 540px; display:flex; min-height:540px; }
    #symCatBox.sym-focused-workspace .sym-focus-med-hint { border:1px dashed var(--bdr); border-radius:12px; padding:14px; color:var(--t2); font-size:13px; background:var(--bg2); }
    #symCatBox.sym-focused-workspace #symFocusMedicationDock:has(#symMedPopup)>.sym-focus-med-hint { display:none; }
    #symCatBox.sym-focused-workspace #symMedPopup[data-sym-focus-dock="1"] { position:relative!important; top:auto!important; left:auto!important; transform:none!important; opacity:1!important; width:100%!important; height:auto!important; max-height:none!important; min-width:0; flex:1 1 auto; border:1px solid var(--bdr)!important; box-shadow:none!important; border-radius:12px!important; overflow:hidden!important; z-index:auto!important; transition:none!important; }
    #symCatBox.sym-focused-workspace #symMedPopup>.sym-focus-med-head { padding:10px 14px!important; border-radius:12px 12px 0 0; background:color-mix(in srgb,var(--cyan) 8%,var(--card))!important; flex-wrap:wrap; }
    #symCatBox.sym-focused-workspace .sym-focus-med-context { color:var(--cyan); font-size:12px; font-weight:600; overflow-wrap:anywhere; padding:8px 14px 0; }
    #symCatBox.sym-focused-workspace #symMedPopup>.sym-focus-med-grid { display:grid; grid-template-columns:minmax(185px,.8fr) minmax(0,1.25fr); grid-template-rows:minmax(0,1fr); flex:1 1 0!important; min-height:0; overflow:hidden; }
    #symCatBox.sym-focused-workspace .sym-focus-selected-pane { min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; padding:12px; border-right:1px solid var(--bdr); background:color-mix(in srgb,var(--cyan) 3%,var(--card)); }
    #symCatBox.sym-focused-workspace .sym-focus-selected-title { flex:0 0 auto; font-size:13px; font-weight:700; color:var(--t1); margin-bottom:8px; }
    #symCatBox.sym-focused-workspace #symMedSelectedChips { display:block!important; min-height:0; max-height:none!important; flex:1 1 0; overflow-y:auto; overscroll-behavior:contain; padding:0!important; border:0!important; scrollbar-width:thin; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-card { padding:10px; margin-bottom:9px; border:1px solid var(--bdr); border-radius:9px; background:var(--card); }
    #symCatBox.sym-focused-workspace .sym-focus-dose-head { display:flex; align-items:start; justify-content:space-between; gap:6px; margin-bottom:10px; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-name { font-size:14px; line-height:1.5; font-weight:700; overflow-wrap:anywhere; color:var(--t1); }
    #symCatBox.sym-focused-workspace .sym-focus-dose-head button { flex:0 0 auto; min-height:28px; font-size:11px; padding:3px 6px; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-label { display:block; color:var(--t2); font-size:12px; margin-bottom:5px; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-card .sym-med-dose-wrap { display:flex!important; flex-wrap:wrap; gap:6px!important; width:100%; min-width:0; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-card [data-action="medDoseInput"] { width:100%!important; min-width:0; min-height:40px; padding:8px!important; font-size:15px!important; text-align:left!important; border-radius:7px!important; box-sizing:border-box; background:var(--bg2)!important; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-card [data-action="medDoseInput"]:focus-visible { outline:2px solid var(--cyan)!important; outline-offset:1px; }
    #symCatBox.sym-focused-workspace .sym-focus-dose-card .sym-med-unit-trigger { min-height:28px; font-size:12px!important; padding:4px 8px!important; }
    #symCatBox.sym-focused-workspace .sym-focus-browse-pane { min-width:0; display:flex; flex-direction:column; min-height:0; overflow:hidden; }
    #symCatBox.sym-focused-workspace .sym-focus-browse-pane>.sym-med-search-wrap,
    #symCatBox.sym-focused-workspace .sym-focus-browse-pane>.sym-med-browse-tools,
    #symCatBox.sym-focused-workspace #symMedPopup>.sym-focus-med-head,
    #symCatBox.sym-focused-workspace #symMedPopup>.sym-focus-med-context { flex:0 0 auto; }
    #symCatBox.sym-focused-workspace #symMedPopup .sym-med-search-wrap { padding:12px 12px 8px!important; }
    #symCatBox.sym-focused-workspace #symMedSearch { min-height:38px; font-size:14px!important; }
    #symCatBox.sym-focused-workspace #symMedPopup .sym-med-browse-tools { padding:0 12px 8px!important; }
    #symCatBox.sym-focused-workspace #symMedPopup .sym-med-browse-tabs { margin-bottom:8px; }
    #symCatBox.sym-focused-workspace #symMedPopup .sym-med-browse-tab { font-size:12px; min-height:32px; flex-basis:auto; }
    #symCatBox.sym-focused-workspace #symMedPopup .med-browser-filter-row { gap:7px; }
    #symCatBox.sym-focused-workspace #symMedPopup .med-browser-filter-row select { font-size:12px; min-height:34px; }
    #symCatBox.sym-focused-workspace #symMedPopup .med-browser-note { font-size:11px; }
    #symCatBox.sym-focused-workspace #symMedList { min-height:0!important; max-height:none; flex:1 1 0!important; overflow:auto!important; overscroll-behavior:contain; padding:6px 12px!important; }
    #symCatBox.sym-focused-workspace #symMedList [data-action="selectMed"] { font-size:14px!important; min-height:42px!important; padding:8px!important; }
    #symCatBox.sym-focused-workspace #symMedPopup .sym-med-footer { flex:0 0 auto; min-width:0; background:var(--card); padding:9px 12px; gap:8px; flex-wrap:wrap; border-top:1px solid var(--bdr); font-size:11px; }
    #symCatBox.sym-focused-workspace .sym-focus-empty-selection { font-size:12px; line-height:1.7; color:var(--t2); padding:8px 0; }
    @media(max-width:1000px) {
      #symCatBox.sym-focused-workspace .sym-focus-body { grid-template-columns:260px minmax(0,1fr); }
      #symCatBox.sym-focused-workspace #symMedPopup>.sym-focus-med-grid { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(90px,150px) minmax(0,1fr); }
      #symCatBox.sym-focused-workspace .sym-focus-work.has-medication #symFocusMedicationDock { flex-basis:640px; min-height:640px; }
      #symCatBox.sym-focused-workspace .sym-focus-selected-pane { border-right:0; border-bottom:1px solid var(--bdr); }
      #symCatBox.sym-focused-workspace #symMedSelectedChips { max-height:190px!important; }
    }
    @media(max-width:760px) {
      body.school-interface #symCatBox.sym-focused-workspace>.sym-focus-body { display:flex!important; flex-direction:column; overflow:auto!important; flex:1 1 auto!important; }
      #symCatBox.sym-focused-workspace .sym-focus-left { flex:0 0 auto; border-right:0; border-bottom:1px solid var(--bdr); }
      #symCatBox.sym-focused-workspace #symSymList { flex:0 0 auto!important; max-height:240px; }
      #symCatBox.sym-focused-workspace .sym-focus-work { overflow:visible; flex:0 0 auto; }
      #symCatBox.sym-focused-workspace #symTreatPanel { flex:0 0 auto!important; max-height:none!important; overflow:visible!important; }
      #symCatBox.sym-focused-workspace .sym-focus-work.has-medication #symFocusMedicationDock { flex:0 0 640px; height:640px; min-height:640px; }
      #symCatBox.sym-focused-workspace .sym-editor-header { padding:10px 12px; max-height:42%; overflow:auto; }
    }
  `;
  document.head.appendChild(style);
}

export function isFocusedMedication(pop) {
  return !!pop && pop.dataset.symFocusDock === '1';
}

export function mountSymptomFocusLayout(overlay, closeMedication) {
  const box = overlay.querySelector('#symCatBox');
  const categories = overlay.querySelector('#symCatList');
  const symptoms = overlay.querySelector('#symSymList');
  const treatments = overlay.querySelector('#symTreatPanel');
  const actions = overlay.querySelector('.sym-editor-actions');
  if (!box || !categories || !symptoms || !treatments || !actions || box._focusedWorkspace) return;
  installStyles();
  installSymptomTreatmentStyles();
  const body = categories.parentElement;
  const header = box.querySelector('.sym-editor-header');
  const search = box.querySelector('#symQuickSearchRow');
  const history = box.querySelector('[aria-label="학생 이력"]');
  const tools = box.querySelector('#symChipRow2');
  const moved = [];

  const sharedGeometry = {
    width:'min(1200px, calc(var(--school-viewport-width, 100vw) - 32px))',
    maxWidth:'calc(var(--school-viewport-width, 100vw) - 32px)',
    height:'min(860px, calc(var(--school-viewport-height, 100dvh) - 32px))',
    left:'max(16px, calc((var(--school-viewport-width, 100vw) - 1200px) / 2))',
    top:'max(16px, calc((var(--school-viewport-height, 100dvh) - 860px) / 2))'
  };
  box.classList.add('sym-shared-workspace');body.classList.add('sym-workspace-body');
  Object.entries(sharedGeometry).forEach(([key,value]) => { box.style[key]=value; });
  const left = document.createElement('section'); left.className = 'sym-focus-left'; left.setAttribute('aria-label','증상 선택');
  left.innerHTML = '<div class="sym-focus-heading">증상 선택</div>';
  const categoryLabel = document.createElement('label'); categoryLabel.className = 'sym-focus-category'; categoryLabel.textContent = '증상 분류';
  const select = document.createElement('select'); select.className = 'form-input'; select.setAttribute('aria-label','증상 분류'); select.dataset.symFocusNative = '1';
  select.add(new Option('분류를 선택하세요',''));
  categories.querySelectorAll('.sym-cat-item').forEach(item => {
    const text = Array.from(item.children).slice(0,2).map(el => el.textContent.trim()).join(' ');
    const option = new Option(text,item.dataset.cat); option.disabled = item.classList.contains('sym-cat-locked'); select.add(option);
  });
  categoryLabel.appendChild(select);
  const categoryPicker=mountSymptomCategoryPicker(select,box);
  const work = document.createElement('section'); work.className = 'sym-focus-work'; work.setAttribute('aria-label','처치 및 투약 입력');
  work.innerHTML = '<div class="sym-focus-heading">처치 · 투약</div>';
  const dock = document.createElement('section'); dock.id = 'symFocusMedicationDock'; dock.setAttribute('aria-label','투약 입력 영역');
  dock.innerHTML = '<div class="sym-focus-med-hint">처치에서 투약을 선택하면 이곳에서 약품과 투여량을 함께 입력합니다.</div>';
  const secondary = document.createElement('details'); secondary.className = 'sym-focus-tools'; secondary.dataset.symFocusNative = '1';
  secondary.open = true;
  secondary.innerHTML = '<summary aria-expanded="true">이력 · 업무 도구 접기</summary>';
  secondary.addEventListener('toggle', () => {
    const summary = secondary.querySelector('summary');
    summary.textContent = '이력 · 업무 도구 ' + (secondary.open ? '접기' : '펼치기');
    summary.setAttribute('aria-expanded',String(secondary.open));
  });
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn btn-sm sym-focus-toggle'; toggle.dataset.symFocusNative = '1';
  actions.insertBefore(toggle,actions.querySelector('[data-action="closeSymptomPopup"]'));
  let active = false;
  function move(node,parent) {
    if (!node) return;
    const marker = document.createComment('focused-workspace-original-position');
    node.before(marker); moved.push({node,marker}); parent.appendChild(node);
  }
  function syncCategory() {
    const selected = Array.from(categories.querySelectorAll('.sym-cat-item')).find(item => item.querySelector('.sym-cat-arrow')?.style.visibility === 'visible');
    select.value = selected ? selected.dataset.cat : '';
    categoryPicker?.refresh();
  }
  select.addEventListener('change', () => {
    const item = Array.from(categories.querySelectorAll('[data-action="selectCat"]')).find(el => el.dataset.cat === select.value);
    if (item) item.click(); else syncCategory();
  });
  function setMode(focused) {
    if (focused === active) return;
    categoryPicker?.close(false);
    closeMedication();
    active = focused; preferFocusedWorkspace = focused;
    if (active) {
      body.classList.add('sym-focus-body'); box.classList.add('sym-focused-workspace');
      body.append(left,work);
      move(search,left); left.appendChild(categoryLabel); move(categories,left); move(symptoms,left);
      move(treatments,work); work.appendChild(dock);
      if (header) { header.appendChild(secondary); move(history,secondary); move(tools,secondary); }
      box.style.width = 'min(1200px, calc(var(--school-viewport-width, 100vw) - 32px))';
      box.style.maxWidth = 'calc(var(--school-viewport-width, 100vw) - 32px)';
      box.style.height = 'min(860px, calc(var(--school-viewport-height, 100dvh) - 32px))';
      box.style.left = 'max(16px, calc((var(--school-viewport-width, 100vw) - 1200px) / 2))';
      box.style.top = 'max(16px, calc((var(--school-viewport-height, 100dvh) - 860px) / 2))';
      syncCategory();
    } else {
      moved.splice(0).reverse().forEach(({node,marker}) => { marker.replaceWith(node); });
      left.remove(); work.remove(); secondary.remove();
      body.classList.remove('sym-focus-body'); box.classList.remove('sym-focused-workspace');
      Object.entries(sharedGeometry).forEach(([key,value]) => { box.style[key] = value; });
    }
    toggle.textContent = active ? '분리 보기로 전환' : '통합 보기로 전환';
    toggle.setAttribute('aria-pressed',String(active));
    toggle.title = active ? '현재 통합 보기: 투약을 같은 창에서 입력합니다. 분류 목록을 펼쳐 보는 화면으로 전환합니다.' : '현재 분리 보기: 분류·증상·처치를 나란히 봅니다. 투약을 같은 창에서 입력하는 화면으로 전환합니다.';
  }
  toggle.addEventListener('click', event => { event.stopPropagation(); setMode(!active); });
  toggle.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
  const categoryWatcher = new MutationObserver(syncCategory);
  categoryWatcher.observe(categories,{attributes:true,subtree:true,attributeFilter:['style'],childList:true});
  const dockWatcher = new MutationObserver(() => work.classList.toggle('has-medication',!!dock.querySelector('#symMedPopup')));
  dockWatcher.observe(dock,{childList:true});
  const lifetime = new MutationObserver(() => {
    if (overlay.isConnected) return;
    categoryPicker?.destroy(); categoryWatcher.disconnect(); dockWatcher.disconnect(); lifetime.disconnect();
  });
  lifetime.observe(document.body,{childList:true});
  box._focusedWorkspace = {setMode};
  toggle.textContent = '통합 보기로 전환'; toggle.setAttribute('aria-pressed','false');
  if (preferFocusedWorkspace) setMode(true);
}

export function mountFocusedMedication(pop, context) {
  const box = document.getElementById('symCatBox');
  const dock = box?.querySelector('#symFocusMedicationDock');
  if (!box?.classList.contains('sym-focused-workspace') || !dock || !pop._medBrowse) return false;
  pop.dataset.symFocusDock = '1'; pop.dataset.schoolModalEffects = 'off';
  pop.setAttribute('role','region'); pop.setAttribute('aria-label','투약 입력');
  const header = pop.firstElementChild;
  const search = pop.querySelector('.sym-med-search-wrap');
  const tools = pop.querySelector('.sym-med-browse-tools');
  const chips = pop.querySelector('#symMedSelectedChips');
  const list = pop.querySelector('#symMedList');
  const footer = pop.querySelector('.sym-med-footer');
  header.classList.add('sym-focus-med-head');
  const contextLabel = document.createElement('div'); contextLabel.className = 'sym-focus-med-context';
  contextLabel.textContent = '입력 대상: ' + (context === '__legacy__' || context === '__flat__' || !context ? '현재 방문 기록' : context);
  header.after(contextLabel);
  const grid = document.createElement('div'); grid.className = 'sym-focus-med-grid';
  const selected = document.createElement('section'); selected.className = 'sym-focus-selected-pane'; selected.setAttribute('aria-label','선택한 약품 및 투여량');
  selected.innerHTML = '<div class="sym-focus-selected-title">선택한 약품 · 투여량</div>';
  selected.appendChild(chips);
  const browse = document.createElement('section'); browse.className = 'sym-focus-browse-pane'; browse.setAttribute('aria-label','약품 검색 및 목록');
  browse.append(search,tools,list); grid.append(selected,browse); pop.insertBefore(grid,footer);
  const done = footer.querySelector('[data-med-popup-close]'); if (done) done.textContent = '투약 입력 완료';
  dock.appendChild(pop); dock.parentElement.classList.add('has-medication');
  return true;
}

export function renderFocusedMedicationSelection(pop, names, doses, renames, buildInput) {
  const chips = pop.querySelector('#symMedSelectedChips');
  const signature = JSON.stringify(names.map(name => [name,renames[name] || name]));
  if (chips._focusSelectionSignature !== signature) {
    chips._focusSelectionSignature = signature; chips.replaceChildren();
    if (!names.length) {
      const empty = document.createElement('div'); empty.className = 'sym-focus-empty-selection';
      empty.textContent = '목록에서 약품을 선택하세요. 검색 조건을 바꿔도 선택한 약품과 투여량은 이곳에 유지됩니다.'; chips.appendChild(empty);
    }
    names.forEach(name => {
      const card = document.createElement('div'); card.className = 'sym-focus-dose-card';
      const head = document.createElement('div'); head.className = 'sym-focus-dose-head';
      const title = document.createElement('span'); title.className = 'sym-focus-dose-name'; title.textContent = renames[name] || name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-sm';
      remove.dataset.action = 'deselectMedChip'; remove.dataset.med = name; remove.dataset.medType = 'med';
      remove.textContent = '해제'; remove.setAttribute('aria-label',(renames[name] || name) + ' 선택 해제');
      head.append(title,remove);
      const label = document.createElement('span'); label.className = 'sym-focus-dose-label'; label.textContent = '투여량 · 단위';
      const controls = document.createElement('div'); controls.innerHTML = buildInput(name);
      card.append(head,label,controls); chips.appendChild(card);
    });
  }
  chips.querySelectorAll('[data-action="medDoseInput"]').forEach(input => {
    if (document.activeElement !== input) input.value = doses[input.dataset.med] || '';
    input.setAttribute('aria-label',(renames[input.dataset.med] || input.dataset.med) + ' 투여량과 단위');
  });
}
