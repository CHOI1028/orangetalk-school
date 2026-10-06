import './school-modal-effects.js';
/* School UI shell: presentation sizing only. No data or preference writes. */
const root = document.documentElement;
let frame = 0;
let lastView = null;
let contextTrigger = null;
let contextLayout = null;
let dockedContextOpen = true;
let observedMain = null;
let mainObserver = null;

function setSize(el, name, value) {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}


// Preserve draggable pixel positions while keeping resized dialogs on screen.
// Only presentation coordinates change; transforms and data remain untouched.
const popupSurfaces = '.modal-content,.ec-form-modal,.vp-modal,.sv-modal,.qm-container,#addPersonModal > div,#symCatBox,#drugSearchPopup,#rvBrowserBox,#vlogBox,.vsts-box';
function keepPopupsInView(zoom) {
  if (window.matchMedia('print').matches) return;
  const margin = 12 * zoom;
  document.querySelectorAll(popupSurfaces).forEach(box => {
    const style = getComputedStyle(box);
    if (style.position !== 'fixed' && style.position !== 'absolute') return;
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return;
    const left = Number.parseFloat(style.left), top = Number.parseFloat(style.top);
    const nextLeft = Math.max(margin, Math.min(rect.left, window.innerWidth - margin - rect.width));
    const nextTop = Math.max(margin, Math.min(rect.top, window.innerHeight - margin - rect.height));
    if (Number.isFinite(left) && Math.abs(nextLeft - rect.left) > 1) box.style.left = (left + (nextLeft - rect.left) / zoom) + 'px';
    if (Number.isFinite(top) && Math.abs(nextTop - rect.top) > 1) box.style.top = (top + (nextTop - rect.top) / zoom) + 'px';
  });
}

function syncLayout() {
  frame = 0;
  if (!document.body.classList.contains('school-interface')) return;
  const parsed = Number.parseFloat(root.style.zoom || '1');
  const zoom = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  setSize(root, '--school-viewport-width', window.innerWidth / zoom + 'px');
  setSize(root, '--school-viewport-height', window.innerHeight / zoom + 'px');
  const logicalWidth = window.innerWidth / zoom;
  const logicalHeight = window.innerHeight / zoom;
  document.body.classList.toggle('school-short', logicalHeight < 600);
  document.body.classList.toggle('school-compact', logicalWidth < 1100);
  document.body.classList.toggle('school-narrow', logicalWidth < 800);
  const nextContextLayout = logicalWidth < 1100 ? 'drawer' : 'docked';
  document.body.classList.toggle('school-context-drawer', nextContextLayout === 'drawer');
  installShellControls();
  // Start docked history open, but never cover a small window on startup.
  // Remember the user's desktop choice while temporarily using the drawer.
  if (contextLayout !== nextContextLayout) {
    if (contextLayout === 'docked') {
      dockedContextOpen = document.body.classList.contains('school-context-open');
    }
    document.body.classList.toggle('school-context-open',
      nextContextLayout === 'docked' && dockedContextOpen && !document.body.classList.contains('sidebar-off'));
    contextLayout = nextContextLayout;
  }
  const view = document.body.dataset.activeView || '';
  if (lastView !== null && lastView !== view) {
    const main = document.getElementById('schoolMain');
    if (main) main.scrollTop = 0;
  }
  lastView = view;
  if (document.body.classList.contains('sidebar-off')) closeContext(false);
  syncContextAccessibility();
  keepPopupsInView(zoom);
  refineSchoolActions();
}

function scheduleLayout() {
  if (!frame) frame = requestAnimationFrame(syncLayout);
}


function installShellControls() {
  const main = document.getElementById('schoolMain');
  if (main && main !== observedMain) {
    if (mainObserver) mainObserver.disconnect();
    observedMain = main;
    mainObserver = new MutationObserver(scheduleLayout);
    mainObserver.observe(main, { childList: true, subtree: true });
  }
  const sidebar = document.getElementById('schoolSidebar');
  if (sidebar && !sidebar.querySelector('.school-context-heading')) {
    const heading = document.createElement('div');
    heading.className = 'school-context-heading';
    heading.innerHTML = '<h2 id="schoolContextTitle">날짜·방문 이력</h2><button type="button" class="school-context-close" data-school-action="close-context" aria-label="날짜·방문 이력 닫기">×</button>';
    sidebar.prepend(heading);
    sidebar.tabIndex = -1;
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'school-context-backdrop';
    backdrop.dataset.schoolAction = 'close-context';
    backdrop.setAttribute('aria-label', '날짜·방문 이력 닫기');
    backdrop.tabIndex = -1;
    sidebar.parentElement.appendChild(backdrop);
  }
  const settingsHeader = document.querySelector('#settingsModal .modal-header');
  if (settingsHeader && !settingsHeader.querySelector('[data-school-action="close-settings"]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'school-context-close';
    button.dataset.schoolAction = 'close-settings';
    button.setAttribute('aria-label', '설정 닫기');
    button.textContent = '×';
    settingsHeader.appendChild(button);
  }
  const home = document.querySelector('.nav-link[data-view="home"]');
  if (home && home.textContent.trim() === '🏠 대시보드') home.textContent = '🏠 보건실 홈';
  document.querySelectorAll('.header-row2 .nav-link').forEach(button => {
    if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function syncContextAccessibility() {
  const open = document.body.classList.contains('school-context-open');
  const narrow = document.body.classList.contains('school-context-drawer');
  const sidebar = document.getElementById('schoolSidebar');
  const main = document.getElementById('schoolMain');
  if (sidebar) {
    sidebar.inert = !open;
    sidebar.setAttribute('role', open && narrow ? 'dialog' : 'complementary');
    sidebar.setAttribute('aria-labelledby', 'schoolContextTitle');
    if (open && narrow) sidebar.setAttribute('aria-modal', 'true');
    else sidebar.removeAttribute('aria-modal');
  }
  if (main) main.inert = open && narrow;
  document.querySelectorAll('.school-context-toggle').forEach(button => {
    button.setAttribute('aria-expanded', String(open));
  });
}

function closeContext(restoreFocus = true) {
  if (!document.body.classList.contains('school-context-open')) return;
  document.body.classList.remove('school-context-open');
  syncContextAccessibility();
  if (restoreFocus) {
    if (contextTrigger && contextTrigger.isConnected && contextTrigger.getClientRects().length) contextTrigger.focus();
    else document.querySelector('.header-row2 .nav-link.active')?.focus();
  }
  scheduleLayout();
}

document.addEventListener('click', event => {
  const button = event.target.closest && event.target.closest('[data-school-action]');
  if (!button) return;
  const action = button.dataset.schoolAction;
  if (action === 'toggle-context') {
    if (document.body.classList.contains('school-context-open')) closeContext();
    else {
      contextTrigger = button;
      document.body.classList.add('school-context-open');
      syncContextAccessibility();
      scheduleLayout();
      requestAnimationFrame(() => {
        const input = document.getElementById('sideSearch');
        const sidebar = document.getElementById('schoolSidebar');
        if (input && input.offsetParent !== null) input.focus();
        else if (sidebar) sidebar.focus();
      });
    }
  } else if (action === 'close-context') closeContext();
  else if (action === 'close-settings') {
    import('../settings/settings-view.js').then(module => module.closeSettings());
  }
});
document.addEventListener('keydown', event => {
  const sidebar = document.getElementById('schoolSidebar');
  if (!sidebar || !document.body.classList.contains('school-context-open')) return;
  const inside = sidebar.contains(document.activeElement);
  if (event.key === 'Escape' && inside) {
    event.preventDefault();
    closeContext();
  } else if (event.key === 'Tab' && inside && document.body.classList.contains('school-context-drawer')) {
    const focusable = Array.from(sidebar.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')).filter(el => el.offsetParent !== null);
    if (!focusable.length) { event.preventDefault(); sidebar.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
window.addEventListener('resize', scheduleLayout, { passive: true });
window.addEventListener('ec:zoom-changed', scheduleLayout);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleLayout, { once: true });
} else {
  scheduleLayout();
}
window.addEventListener('load', scheduleLayout, { once: true });
new MutationObserver(scheduleLayout).observe(document.body, { attributes: true, attributeFilter: ['data-active-view', 'class'] });

const brandHeader = document.querySelector('.top-header');
if (brandHeader) new MutationObserver(scheduleLayout).observe(brandHeader, { attributes: true, attributeFilter: ['style'] });

const familyNavigation = document.querySelector('.header-row2');
if (familyNavigation) new MutationObserver(scheduleLayout).observe(familyNavigation, {
  childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled']
});

// Newly opened dialogs can finish their entrance animation after the first frame.
let popupSettleTimer = 0;
new MutationObserver(mutations => {
  if (!mutations.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches(popupSurfaces) || n.querySelector(popupSurfaces))))) return;
  scheduleLayout();
  clearTimeout(popupSettleTimer);
  popupSettleTimer = setTimeout(scheduleLayout, 280);
}).observe(document.body, { childList: true });

// Decorate existing controls; their event handlers, data and emoji skins stay intact.
function refineSchoolActions(){
  document.querySelectorAll('button').forEach(button=>{
    if(button.closest('.school-confirm-dialog,[data-print-document]'))return;
    const label=button.textContent.replace(/[^\p{L}\p{N}\s]/gu,'').trim().replace(/\s+/g,' ');
    let emphasis='';
    if(/^(저장|등록|적용|수정 완료|저장 후 닫기|인증코드 등록)$/.test(label))emphasis='primary';
    else if(/^(취소|닫기|돌아가기|다시 선택)$/.test(label))emphasis='secondary';
    else if(/^(삭제|선택 삭제|전체 삭제|사용자 삭제|기록 삭제|비우기)$/.test(label))emphasis='danger';
    if(emphasis){if(button.dataset.schoolEmphasis!==emphasis)button.dataset.schoolEmphasis=emphasis;}
    else if(button.dataset.schoolEmphasis)delete button.dataset.schoolEmphasis;
    if(!button.hasAttribute('aria-label') && button.title && !label)button.setAttribute('aria-label',button.title);
    if(!button.hasAttribute('aria-label') && button.matches('.modal-close,.ec-form-close,.vp-close,.school-context-close'))button.setAttribute('aria-label','닫기');
  });
}
new MutationObserver(records=>{
  if(records.some(record=>record.type==='childList' && (record.addedNodes.length||record.removedNodes.length)))scheduleLayout();
}).observe(document.body,{childList:true,subtree:true});
