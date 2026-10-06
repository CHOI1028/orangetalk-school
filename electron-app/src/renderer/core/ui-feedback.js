/* Presentation-only states. Never render raw server errors or authentication keys. */
import { escHtml } from './format-utils.js';

export function feedbackHtml(options = {}) {
  const kind = ['loading','empty','error','info'].includes(options.kind) ? options.kind : 'info';
  const defaults = {
    loading: ['조회 중입니다', '잠시만 기다려 주세요.'],
    empty: ['표시할 자료가 없습니다', '선택한 날짜와 조회 조건을 확인해 주세요.'],
    error: ['자료를 불러오지 못했습니다', '연결 상태를 확인한 뒤 다시 시도해 주세요.'],
    info: ['확인이 필요합니다', '']
  };
  return '<div class="school-feedback" data-ui-state="'+kind+'" role="status" aria-live="polite" aria-atomic="true">'
    +'<span class="school-feedback-symbol" aria-hidden="true">'+({loading:'…',empty:'📭',error:'⚠️',info:'💡'}[kind])+'</span>'
    +'<div class="school-feedback-copy"><strong>'+escHtml(options.title || defaults[kind][0])+'</strong>'
    +'<p>'+escHtml(options.description == null ? defaults[kind][1] : options.description)+'</p></div>'
    +(options.actionLabel ? '<button type="button" class="btn school-feedback-action" data-feedback-action>'+escHtml(options.actionLabel)+'</button>' : '')
    +'</div>';
}

export function showFeedback(container, options = {}) {
  const element = typeof container === 'string' ? document.getElementById(container) : container;
  if (!element) return;
  element.setAttribute('aria-busy', String(options.kind === 'loading'));
  element.innerHTML = feedbackHtml(options);
  const button = element.querySelector('[data-feedback-action]');
  if (button && typeof options.onAction === 'function') {
    button.addEventListener('click', options.onAction, { once: true });
  }
}
