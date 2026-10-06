/* Confirm reception before showing success. No automatic replay after an uncertain POST. */
export function kioskReceptionRuntimeSource(options = {}) {
  return '(' + installKioskReception.toString() + ')(' + JSON.stringify({ preview: options.preview === true }) + ');\n';
}

function installKioskReception(config) {
  var phase = 'idle', active = null, sequence = 0;
  var popup = document.getElementById('reception-popup');
  function tr(text) { return typeof window._t === 'function' ? window._t(text) : text; }
  function escape(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clearPopup() {
    if (!popup) return;
    if (popup._pauseAutoClose) popup._pauseAutoClose();
    popup._pauseAutoClose = null;
    popup.onclick = popup.onpointerdown = popup.ontouchstart = popup.onwheel = popup.onfocusin = null;
    popup.style.display = 'none';
    popup.removeAttribute('aria-busy');
  }
  function showStatus(kind, title, detail, retry) {
    if (!popup) return;
    clearPopup();
    document.body.appendChild(popup);
    var panel = popup.querySelector('.popup-content');
    popup.dataset.receptionState = kind;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-label', tr(title));
    popup.setAttribute('aria-busy', kind === 'pending' ? 'true' : 'false');
    panel.setAttribute('tabindex', '-1');
    panel.innerHTML = '<div class="reception-body"><div class="reception-status" role="status" aria-live="polite"><div class="reception-title">' + escape(tr(title)) + '</div><div class="reception-detail">' + escape(tr(detail)) + '</div></div></div>' +
      (kind === 'pending' ? '' : '<div class="reception-actions">' +
      (retry ? '<button type="button" class="confirm-btn" data-reception-retry>' + escape(tr('다시 시도')) + '</button>' : '') +
      '<button type="button" class="back-btn" data-reception-home>' + escape(tr('처음으로')) + '</button></div>');
    popup.style.display = 'flex';
    if (typeof window._fitReceptionPopup === 'function') window._fitReceptionPopup();
    var button = panel.querySelector('[data-reception-retry]');
    if (button) button.onclick = function () { if (active && phase === 'failed') start(active); };
    var home = panel.querySelector('[data-reception-home]');
    if (home) home.onclick = function () { window._kioskResetReception(); window.resetToPersonal(); };
    (button || home || panel).focus({ preventScroll: true });
  }
  function fail(attempt, safeToRetry) {
    if (active !== attempt) return;
    phase = safeToRetry ? 'failed' : 'uncertain';
    showStatus(phase,
      safeToRetry ? '접수를 보내지 못했어요' : '접수 여부를 확인할 수 없어요',
      safeToRetry ? '선택한 내용은 그대로 남아 있어요. 인터넷 연결과 키오스크 설정을 확인한 뒤 다시 시도해 주세요.' :
        '서버에 접수되었을 수도 있어요. 중복 접수를 피하려면 보건 선생님께 접수 여부를 먼저 확인해 주세요.',
      safeToRetry);
  }
  function complete(attempt) {
    if (active !== attempt || phase !== 'pending') return;
    phase = 'success';
    clearPopup();
    if (popup) popup.dataset.receptionState = 'success';
    window.showReceptionPopup({
      preview: config.preview,
      updateQueue: config.preview || attempt.queueRevision === Number(window._kioskQueueRevision || 0)
    });
  }
  function post(attempt) {
    return new Promise(function (resolve, reject) {
      var finished = false, controller = typeof AbortController === 'function' ? new AbortController() : null;
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      }
      var timer = setTimeout(function () {
        finish({ safeToRetry: false });
        if (controller) controller.abort();
      }, 10000);
      var settings = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.body };
      if (controller) settings.signal = controller.signal;
      Promise.resolve().then(function () {
        return fetch(attempt.url, settings);
      }).then(function (response) {
        if (!response.ok) {
          // A timeout, conflict or server error may follow an already stored reception.
          finish({ safeToRetry: [400, 401, 403, 404, 405, 413, 415, 422, 429].indexOf(response.status) !== -1 });
          return;
        }
        if (response.status === 204) { finish(); return; }
        return response.text().then(function (body) {
          var data;
          try { data = JSON.parse(body); } catch (_) { finish({ safeToRetry: false }); return; }
          if (!data || typeof data !== 'object' || Array.isArray(data)) { finish({ safeToRetry: false }); return; }
          if (data.ok === false || data.success === false || data.error) { finish({ safeToRetry: false }); return; }
          if (data.ok === true || data.success === true || data.id || data.reception_id ||
              (data.reception && (data.reception.id || data.reception.reception_id))) { finish(); return; }
          finish({ safeToRetry: false });
        });
      }).catch(function () { finish({ safeToRetry: false }); });
    });
  }
  function start(attempt) {
    if (active !== attempt || phase === 'pending' || phase === 'success' || phase === 'uncertain') return;
    phase = 'pending';
    showStatus('pending', '접수하고 있어요', '접수 결과를 확인할 때까지 잠시 기다려 주세요.', false);
    attempt.queueRevision = Number(window._kioskQueueRevision || 0);
    if (config.preview) { complete(attempt); return; }
    if (!window.RELAY_URL || !window.RELAY_CHANNEL || navigator.onLine === false) {
      fail(attempt, true);
      return;
    }
    attempt.url = String(window.RELAY_URL).replace(/\/$/, '') + '/api/v1/kiosk/reception/' + encodeURIComponent(window.RELAY_CHANNEL);
    post(attempt).then(function () { complete(attempt); }, function (error) { fail(attempt, !!error.safeToRetry); });
  }
  window._kioskReceptionLocked = function () { return phase !== 'idle'; };
  window._kioskResetReception = function () {
    if (phase === 'pending') return false;
    phase = 'idle';
    active = null;
    clearPopup();
    return true;
  };
  window.sendReception = function (payload) {
    if (phase !== 'idle') return;
    var person = payload && payload.person;
    if (!person || !(person.uid || person.id)) return;
    var safe = Object.assign({}, payload, { person: { uid: person.uid || person.id } });
    active = { sequence: ++sequence, body: JSON.stringify(safe), queueRevision: 0 };
    start(active);
  };
  // Stop background selection and keyboard activation while a transaction is displayed.
  function blockBackground(event) {
    if (phase === 'idle' || !popup || popup.style.display === 'none') return;
    if (!popup.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  document.addEventListener('click', blockBackground, true);
  document.addEventListener('keydown', function (event) {
    if (phase === 'idle' || !popup || popup.style.display === 'none') return;
    if (event.key === 'Tab') {
      var buttons = Array.prototype.filter.call(popup.querySelectorAll('button:not(:disabled)'), function (button) { return button.getClientRects().length; });
      if (!buttons.length) { event.preventDefault(); return; }
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      return;
    }
    blockBackground(event);
  }, true);
}
