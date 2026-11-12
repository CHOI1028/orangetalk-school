// Only window coordinates are persisted; no conversation or credentials.
export function bindAiPosition(launcher, panel, handle) {
  const key = 'school-ai-position-v1';
  let saved = {}, suppressUntil = 0;
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    for (const name of ['launcher', 'panel']) {
      const point = value?.[name];
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) saved[name] = { x: point.x, y: point.y };
    }
  } catch (_) {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(saved)); } catch (_) {} };
  function place(node, point) {
    const rect = node.getBoundingClientRect();
    const x = Math.max(8, Math.min(point.x, innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(point.y, innerHeight - rect.height - 8));
    Object.assign(node.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    return { x, y };
  }
  function refresh() {
    const rect = launcher.getBoundingClientRect();
    place(launcher, saved.launcher || { x: innerWidth - rect.width - 22, y: innerHeight - rect.height - 22 });
    if (!panel.hidden) {
      const anchor = launcher.getBoundingClientRect(), box = panel.getBoundingClientRect();
      place(panel, saved.panel || { x: anchor.right - box.width, y: anchor.top - box.height - 12 });
    }
  }
  function draggable(node, grip, name) {
    let drag;
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || (grip !== launcher && event.target.closest('button,a,input'))) return;
      const rect = node.getBoundingClientRect();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      grip.setPointerCapture(event.pointerId);
    });
    window.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true; event.preventDefault(); grip.classList.add('is-dragging');
      saved[name] = place(node, { x: drag.left + dx, y: drag.top + dy });
      if (name === 'launcher') { delete saved.panel; refresh(); }
    });
    const finish = event => {
      if (!drag || (event.pointerId !== undefined && drag.pointer !== event.pointerId)) return;
      if (drag.moved) { suppressUntil = performance.now() + 500; save(); }
      drag = null; grip.classList.remove('is-dragging');
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    grip.addEventListener('lostpointercapture', finish);
  }
  // Capture runs before the launcher's ordinary click handler.
  launcher.addEventListener('click', event => {
    if (performance.now() < suppressUntil && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  launcher.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const rect = launcher.getBoundingClientRect();
    saved.launcher = place(launcher, { x: rect.left + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0),
      y: rect.top + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0) });
    delete saved.panel; save(); refresh();
  });
  draggable(launcher, launcher, 'launcher'); draggable(panel, handle, 'panel');
  window.addEventListener('resize', refresh);
  // The stylesheet may still be loading when the module mounts.
  const observer = new ResizeObserver(refresh); observer.observe(launcher); observer.observe(panel);
  refresh();
  return { refresh, reset() { saved = {}; save(); refresh(); } };
}
