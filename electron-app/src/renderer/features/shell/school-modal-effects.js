/* School modal presentation only: never change dialog actions or stored data. */
const knownOverlays = '.modal-overlay,.qm-overlay,.vp-overlay,.ec-form-overlay,.ems-overlay,.sv-modal-overlay,.nl-overlay,.magic-link-popup-overlay,.memo-popup-overlay,.school-confirm-overlay';
const candidateSelector = knownOverlays + ',[id$="Overlay"],[id$="Modal"],[id$="OverlayRoot"],[class*="-overlay"],[data-ec-zoom-rebound="overlay"],[style*="position" i]';
const excludedSurfaces = '#splash,#cdkeyGateOverlay,#cpDragOverlay,.school-context-backdrop,.modal-content,.ec-form-modal,.vp-modal,.ems-modal,.sv-modal,.qm-container,.school-confirm-dialog,.popup-box,.modal-box,.top-header,footer,.app,#schoolMain,#schoolSidebar';
const candidates = new Set();
const managed = new Set();
let frame = 0;

function collect(node) {
  if (!(node instanceof HTMLElement)) return false;
  let found = false;
  if (node.matches(candidateSelector)) {
    candidates.add(node);
    found = true;
  }
  node.querySelectorAll(candidateSelector).forEach(element => {
    if (element instanceof HTMLElement) {
      candidates.add(element);
      found = true;
    }
  });
  return found;
}

function isVisibleOverlay(element) {
  if (!element.isConnected || element.matches(excludedSurfaces)) return false;
  if (element.closest('#splash,#cdkeyGateOverlay,[data-print-document],[data-school-modal-effects="off"],[hidden],[aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  if (!['fixed', 'absolute'].includes(style.position)) return false;
  if (style.display === 'none' || style.visibility !== 'visible') return false;
  if (Number(style.opacity) === 0 && style.pointerEvents === 'none') return false;
  if (!element.childElementCount) return false;
  const named = element.matches(knownOverlays) || /(?:Overlay|Modal|OverlayRoot)$/.test(element.id) || element.className.includes('-overlay');
  if (!named && Number.parseInt(style.zIndex, 10) < 1000) return false;
  if (!named && !Number.isFinite(Number.parseInt(style.zIndex, 10))) return false;
  const rect = element.getBoundingClientRect();
  // Only full-window backdrops, never an editor surface or a small floating picker.
  return rect.width > 0 && rect.height > 0 && rect.left <= 24 && rect.top <= 24 &&
    rect.right >= window.innerWidth - 24 && rect.bottom >= window.innerHeight - 24;
}

function stackingPath(element) {
  const path = [];
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const z = Number.parseInt(style.zIndex, 10);
    const context = node === element || Number.isFinite(z) || style.transform !== 'none' ||
      style.filter !== 'none' || style.perspective !== 'none' || style.isolation === 'isolate' ||
      Number(style.opacity) < 1 || (style.backdropFilter && style.backdropFilter !== 'none');
    if (context) path.unshift({ node, z: Number.isFinite(z) ? z : 0 });
  }
  return path;
}

function compareLayers(a, b) {
  const length = Math.min(a.path.length, b.path.length);
  for (let index = 0; index < length; index++) {
    const left = a.path[index], right = b.path[index];
    if (left.node === right.node) continue;
    if (left.z !== right.z) return left.z - right.z;
    return left.node.compareDocumentPosition(right.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function syncEffects() {
  frame = 0;
  if (!document.body.classList.contains('school-interface')) return;
  const visible = [];
  candidates.forEach(element => {
    if (!element.isConnected) candidates.delete(element);
    else if (isVisibleOverlay(element)) visible.push({ element, path: stackingPath(element) });
  });
  visible.sort(compareLayers);
  // Native dialogs already have a top-layer ::backdrop; avoid a second effect below it.
  const nativeModal = document.querySelector('dialog:modal');
  const top = nativeModal ? null : visible[visible.length - 1]?.element;
  const active = new Set(visible.map(item => item.element));
  managed.forEach(element => {
    if (!active.has(element)) {
      element.removeAttribute('data-school-modal-layer');
      managed.delete(element);
    }
  });
  visible.forEach(({ element }) => {
    const layer = element === top ? 'top' : 'under';
    if (element.getAttribute('data-school-modal-layer') !== layer) {
      element.setAttribute('data-school-modal-layer', layer);
    }
    managed.add(element);
  });
}

function scheduleEffects() {
  if (!frame) frame = requestAnimationFrame(syncEffects);
}

function startEffects() {
  collect(document.body);
  new MutationObserver(records => {
    let changed = false;
    records.forEach(record => {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => { if (collect(node)) changed = true; });
        if (record.removedNodes.length) changed = true;
      } else {
        const target = record.target;
        if (target === document.body || target.tagName === 'DIALOG' || candidates.has(target)) {
          changed = true;
        } else if (target instanceof HTMLElement && target.matches(candidateSelector)) {
          candidates.add(target);
          changed = true;
        } else if (target instanceof HTMLElement && target.querySelector(candidateSelector)) {
          changed = true;
        }
      }
    });
    if (changed) scheduleEffects();
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open', 'data-ec-zoom-rebound']
  });
  // Finish removal of effects when a closing transition has actually completed.
  ['animationend', 'animationcancel', 'transitionend', 'transitioncancel'].forEach(type => {
    document.addEventListener(type, event => {
      if (candidates.has(event.target)) scheduleEffects();
    }, true);
  });
  window.addEventListener('resize', scheduleEffects, { passive: true });
  window.addEventListener('ec:zoom-changed', scheduleEffects);
  scheduleEffects();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startEffects, { once: true });
} else {
  startEffects();
}
