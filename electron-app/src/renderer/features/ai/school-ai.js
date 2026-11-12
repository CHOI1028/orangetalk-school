/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. */
import { bindAiPosition } from './school-ai-position.js';
import { renderAiText } from './school-ai-rich-text.js';
import { appendSearchSuggestions } from './school-ai-search-view.js';
const api = () => window.electronAPI;
const wordmarkUrl = new URL('../../../../assets/icons/otalk_logo.png', import.meta.url).href;
const headerLogoUrl = new URL('../../../../assets/icons/orangetalk_logo.png', import.meta.url).href;
let panel, launcher, positioning, settingsRoot, busy = false, generation = 0, lastFocus;
let configured = false;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(text, handler, className = '') {
  const b = element('button', className, text); b.type = 'button'; b.addEventListener('click', handler); return b;
}
function wordmark(alt = '') {
  const img = document.createElement('img');
  img.className = 'school-ai-wordmark'; img.src = wordmarkUrl; img.alt = alt; img.draggable = false;
  return img;
}
const get = selector => panel.querySelector(selector);
function notice(text, error = false) {
  const node = get('[data-ai-status]'); node.textContent = text; node.classList.toggle('is-error', error);
}
function showStatus(status) {
  if (!status?.success) { notice(status?.message || 'AI 설정을 읽지 못했습니다.', true); return; }
  configured = status.configured;
  if (!status.encryptionAvailable) notice('이 PC에서 키 암호화 저장소를 사용할 수 없습니다.', true);
}
async function refresh() {
  try { showStatus(await api().schoolAiStatus()); }
  catch (_) { notice('AI 설정에 연결하지 못했습니다. 앱을 다시 실행해 주세요.', true); }
}
function setBusy(value) {
  busy = value;
  panel.setAttribute('aria-busy', String(value));
  panel.querySelectorAll('[data-ai-idle]').forEach(node => { node.disabled = value; });
  settingsRoot?.querySelectorAll('[data-ai-idle]').forEach(node => { node.disabled = value; });
  get('[data-ai-stop]').hidden = !value;
  get('[data-ai-send]').hidden = value;
}
function message(role, text, extra) {
  const entry = element('article', 'school-ai-message is-' + role + (extra ? ' ' + extra : ''));
  entry.append(element('div', 'school-ai-role', role === 'user' ? '나' : extra === 'is-notice' ? '안내' : '오렌지톡 AI'));
  const body = element('div', 'school-ai-text');
  if (role === 'assistant' && extra !== 'is-notice') renderAiText(body, text); else body.textContent = text;
  entry.append(body);
  get('[data-ai-messages]').append(entry);
  get('[data-ai-messages]').scrollTop = get('[data-ai-messages]').scrollHeight;
  return entry;
}
function openExternal(url) {
  if (/^https:\/\//.test(url)) api().openExternal(url);
}
const QUICK = [
  ['프로그램 사용법', '이 프로그램의 주요 기능을 쉽게 설명해 줘'],
  ['설문 만들기', '설문을 만들어 QR로 배포하는 방법을 알려 줘'],
  ['교육자료 작성', '초등학생 손 씻기 보건교육 안내문을 작성해 줘']
];
function holdRetry(node, retryAfterMs) {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0 || retryAfterMs > 180000) return;
  const until = Date.now() + retryAfterMs;
  const tick = () => {
    if (!node.isConnected) return;
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) { node.disabled = false; node.textContent = '다시 시도'; return; }
    node.disabled = true;
    node.textContent = left + '초 후 다시 시도';
    setTimeout(tick, 250);
  };
  tick();
}
function ask(text) {
  const input = get('[data-ai-input]');
  input.value = text; resizeInput(); send();
}
function welcome() {
  const log = get('[data-ai-messages]'); log.replaceChildren();
  const hero = element('div', 'school-ai-welcome');
  hero.append(element('span', 'school-ai-mark', '✦'), element('strong', '', '무엇을 도와드릴까요?'),
    element('span', '', '궁금한 점이나 도움이 필요한 일을 이야기해 주세요.'));
  log.append(hero);
}
function resizeInput() {
  const input = get('[data-ai-input]'); input.style.height = 'auto';
  input.style.height = Math.min(150, Math.max(48, input.scrollHeight)) + 'px';
}
async function clearChat() {
  generation++; setBusy(false);
  try { await api().schoolAiReset(); } catch (_) {}
  welcome(); notice(''); refresh();
}
async function stop() {
  generation++;
  try { await api().schoolAiReset(); } catch (_) {}
  setBusy(false); notice('답변 생성을 중지했습니다.'); refresh();
  get('[data-ai-messages]').querySelectorAll('.is-pending').forEach(n => n.remove());
}
async function send(options = {}) {
  if (busy) return;
  const input = get('[data-ai-input]'); const text = input.value.trim();
  if (!text) return;
  if (!configured) { notice('환경설정 → API Key 관리에서 개인 Gemini 키를 등록해 주세요.', true); openApiSettings(); return; }
  if (text.length > 2000) { notice('질문은 2,000자까지 입력할 수 있습니다.', true); return; }
  get('.school-ai-welcome')?.remove();
  if (!options.keep) message('user', text);
  input.value = ''; resizeInput();
  const pending = message('assistant', '답변을 준비하고 있어요'); pending.classList.add('is-pending');
  const current = generation; setBusy(true); notice('');
  try {
    const result = await api().schoolAiChat({ message: text });
    if (current !== generation) return;
    pending.remove();
    if (!result?.success) {
      const failed = text;
      const entry = message('assistant', result?.message || '답변을 받지 못했습니다.', 'is-notice');
      const again = button('다시 시도', () => { entry.remove(); input.value = failed; send({ keep: true }); }, 'school-ai-retry');
      entry.append(again);
      input.value = text;
      if (result.code === 'QUOTA' && result.quotaPeriod === 'minute') {
        notice(result.message, true);
        holdRetry(again, result.retryAfterMs);
      } else notice('질문을 입력칸에 남겨두었습니다. 확인 후 다시 전송할 수 있습니다.', true);
      return;
    }
    const reply = message('assistant', result.answer);
    const sources = element('div', 'school-ai-sources');
    for (const source of result.sources || []) {
      const label = (source.kind === 'program' ? '프로그램 안내 · ' : '') + source.title;
      const node = source.url ? button(label, () => openExternal(source.url)) : element('span', '', label);
      if (source.asOf) node.title = '조회 시각: ' + new Date(source.asOf).toLocaleString('ko-KR');
      sources.append(node);
    }
    if (sources.childNodes.length) {
      const details = element('details', 'school-ai-references');
      details.append(element('summary', '', '참고자료 ' + sources.childNodes.length), sources); reply.append(details);
      if (result.searchSuggestions?.length) details.open = true;
    }
    appendSearchSuggestions(reply, result.searchSuggestions, openExternal);
    if (result.contextOmitted) reply.append(element('p', 'school-ai-context-note', '이전 대화 일부가 길어 이번 질문에는 포함하지 않았습니다.'));
    const copy = button('답변 복사', async () => {
      try { await navigator.clipboard.writeText(result.answer); copy.textContent = '복사됨'; }
      catch (_) { notice('복사하지 못했습니다. 답변을 선택해 복사해 주세요.', true); }
    }, 'school-ai-copy');
    reply.append(copy);
    notice(result.redacted ? '감지된 개인정보를 가린 후 전송했습니다.' : '');
    reply.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (_) {
    if (current === generation) {
      pending.remove(); input.value = text;
      const entry = message('assistant', 'AI 연결에 실패했습니다. 다시 시도해 주세요.', 'is-notice');
      entry.append(button('다시 시도', () => { entry.remove(); input.value = text; send({ keep: true }); }, 'school-ai-retry'));
      notice('질문을 입력칸에 남겨두었습니다. 확인 후 다시 전송할 수 있습니다.', true);
    }
  } finally {
    if (current === generation) { setBusy(false); await refresh(); resizeInput(); input.focus({ preventScroll: true }); }
  }
}
function settingsNotice(root, text, error = false) {
  const node = root.querySelector('[data-ai-settings-status]');
  node.textContent = text; node.classList.toggle('is-error', error);
}
function settingsStatus(root, status) {
  if (!root.isConnected) return;
  if (!status?.success) { settingsNotice(root, status?.message || 'AI 설정을 읽지 못했습니다.', true); return; }
  showStatus(status);
  const badge = root.querySelector('[data-ai-key-state]');
  badge.textContent = configured ? '✓ 반영 완료' : '미등록';
  badge.dataset.state = configured ? 'saved' : 'empty';
  root.querySelector('[data-ai-key]').placeholder = configured ? '새 Gemini API 키 입력' : 'Gemini API 키 입력';
  if (status.storageError) settingsNotice(root, '설정 파일을 읽지 못했습니다. 키를 다시 등록해 주세요.', true);
  if (!status.encryptionAvailable) settingsNotice(root, '이 PC에서 키 암호화 저장소를 사용할 수 없습니다.', true);
}
async function settingsAction(kind, root) {
  if (busy) return;
  if (kind === 'test' && root.querySelector('[data-ai-key]').value.trim()) { settingsNotice(root, '입력한 키를 먼저 반영해 주세요.', true); return; }
  let current = generation;
  setBusy(true);
  try {
    let result;
    if (kind === 'save') result = await api().schoolAiSave({ apiKey: root.querySelector('[data-ai-key]').value.trim() });
    if (kind === 'remove') result = await api().schoolAiRemove();
    if (kind === 'test') result = await api().schoolAiTest();
    if (current !== generation) return;
    if (!result?.success) { settingsNotice(root, result?.message || '설정을 처리하지 못했습니다.', true); return; }
    root.querySelector('[data-ai-key]').value = ''; settingsStatus(root, result);
    if (kind !== 'test') { generation++; current = generation; welcome(); notice(''); }
    settingsNotice(root, kind === 'test' ? 'Gemini 연결을 확인했습니다.' : '');
  } catch (_) { if (current === generation) settingsNotice(root, 'AI 설정을 처리하지 못했습니다.', true); }
  finally { if (current === generation) { setBusy(false); refresh(); } }
}
function close() {
  panel.hidden = true; launcher?.classList.remove('is-open'); launcher?.setAttribute('aria-expanded', 'false');
  lastFocus?.focus();
}
function openApiSettings() {
  close();
  document.dispatchEvent(new CustomEvent('school-ai:open-settings'));
}
export function openSchoolAi() {
  if (!api()?.schoolAiChat) return;
  if (!panel) mount();
  lastFocus = document.activeElement;
  panel.hidden = false; launcher?.classList.add('is-open'); launcher?.setAttribute('aria-expanded', 'true');
  positioning?.refresh();
  refresh(); get('[data-ai-input]').focus();
}
export function schoolAiSettingsCard() {
  if (!api()?.schoolAiChat) return '<div class="cc" style="padding:16px;margin-bottom:14px">✦ AI 도우미는 설치된 교사용 오렌지톡에서 개인 키로 사용할 수 있습니다.</div>';
  return `<div class="school-ai-api-heading">✦ 오렌지톡 AI 도우미</div>
  <section class="cc school-ai-settings-card" data-school-ai-settings>
    <div class="school-ai-settings-title"><span class="school-ai-api-icon">✦</span><div><strong>Gemini API</strong><div class="school-ai-api-description">프로그램 사용법 · 의약품 정보 · 보건업무 문서 작성</div></div><span class="school-ai-key-badge" data-ai-key-state>불러오는 중</span></div>
    <div class="school-ai-key-row"><input class="form-input" type="password" aria-label="Gemini API 키" data-ai-key autocomplete="off" spellcheck="false" maxlength="300" placeholder="Gemini API 키 입력" data-ai-idle disabled><button type="button" data-ai-action="save" data-ai-idle disabled>반영</button></div>
    <div class="school-ai-setting-actions"><button type="button" data-ai-action="test" data-ai-idle disabled>연결 확인</button><button type="button" data-ai-action="remove" data-ai-idle disabled>키 삭제</button><button class="school-ai-key-link" type="button" data-ai-link="key">키 발급 ↗</button></div>
    <div class="school-ai-key-help">
      <div class="school-ai-key-help-title">Gemini API 키 발급·등록</div>
      <ol>
        <li><b>키 발급</b>을 눌러 Google AI Studio를 연다. Google 계정으로 로그인한다.</li>
        <li><b>API 키 만들기</b>를 누른다. 프로젝트가 없으면 기본 프로젝트가 생긴다. 화면에 나온 키를 복사한다.</li>
        <li>위 칸에 붙여넣고 <b>반영</b>을 누른다. 키는 이 PC에만 암호화되어 저장되고, 저장 뒤에는 입력칸이 비워진다.</li>
        <li><b>연결 확인</b>이 되면 우측 하단 AI 도우미에서 바로 쓸 수 있다.</li>
      </ol>
      <p>무료로 쓰려면 결제 설정을 누르지 않는다. 결제를 연결하면 무료 등급을 벗어나며, 선불 크레딧 잔액이 없으면 연결 확인이 되지 않는다. 이미 연결했다면 Google Cloud 결제에서 그 프로젝트의 결제 사용을 중지하면 무료 등급으로 돌아간다. 학생 이름과 건강기록은 입력하지 않는다.</p>
    </div>
    <div class="school-ai-status" data-ai-settings-status role="status"></div>
  </section>`;
}
export function bindSchoolAiSettings(root) {
  const card = root.querySelector('[data-school-ai-settings]');
  if (!card || !api()?.schoolAiChat) return;
  settingsRoot = card;
  card.querySelector('[data-ai-key]').addEventListener('input', event => {
    const badge = card.querySelector('[data-ai-key-state]');
    const dirty = !!event.target.value.trim();
    badge.textContent = dirty ? '반영 필요' : configured ? '✓ 반영 완료' : '미등록';
    badge.dataset.state = dirty ? 'dirty' : configured ? 'saved' : 'empty';
    settingsNotice(card, '');
  });
  card.querySelectorAll('[data-ai-action]').forEach(b => b.addEventListener('click', () => settingsAction(b.dataset.aiAction, card)));
  const links = { key: 'https://aistudio.google.com/apikey' };
  card.querySelectorAll('[data-ai-link]').forEach(b => b.addEventListener('click', () => openExternal(links[b.dataset.aiLink])));
  api().schoolAiStatus().then(status => settingsStatus(card, status))
    .catch(() => settingsNotice(card, 'AI 설정을 읽지 못했습니다.', true))
    .finally(() => card.querySelectorAll('[data-ai-idle]').forEach(node => { node.disabled = busy; }));
}
function mount() {
  if (panel || !api()?.schoolAiChat) return;
  const style = document.createElement('link'); style.rel = 'stylesheet';
  style.href = new URL('../../styles/school-ai.css', import.meta.url).href; document.head.append(style);
  panel = element('section', 'school-ai-panel'); panel.id = 'schoolAiPanel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'schoolAiTitle');
  panel.innerHTML = `<header class="school-ai-header"><div class="school-ai-title"><span class="school-ai-brand-mark" aria-hidden="true">✦</span><div><h2 id="schoolAiTitle"><span class="school-ai-heading"><img class="school-ai-header-logo" src="${headerLogoUrl}" alt="오렌지톡"><span class="school-ai-name">AI 도우미</span></span><span class="school-ai-model">Gemini 3.5 Flash-Lite</span></h2><small>사용법부터 일상 이야기까지 함께하는 도우미</small></div></div><div class="school-ai-header-actions"></div></header>
    <div class="school-ai-notice"><span class="school-ai-notice-mark" aria-hidden="true">✓</span><span>질문과 최근 대화가 Google Gemini로 전송됩니다. 개인정보는 입력하지 마세요. AI는 자료를 변경하지 않습니다.</span></div>
    <div class="school-ai-quick" aria-label="빠른 질문"></div>
    <div class="school-ai-messages" data-ai-messages role="log" aria-live="polite" aria-relevant="additions text"></div>
    <div class="school-ai-status" data-ai-status role="status"></div>
    <form class="school-ai-composer"><div class="school-ai-composer-shell"><span class="school-ai-composer-mark" aria-hidden="true">✦</span><label class="school-ai-input-label" for="schoolAiInput">메시지</label><textarea id="schoolAiInput" data-ai-input data-ai-idle rows="1" maxlength="2000" placeholder="무엇이든 편하게 물어보세요"></textarea><button type="button" data-ai-stop aria-label="답변 생성 중지" hidden>■</button><button type="submit" data-ai-send data-ai-idle aria-label="메시지 보내기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18V6m0 0-5 5m5-5 5 5"/></svg></button></div><div class="school-ai-compose-footer"><button type="button" data-ai-reset-position>기본 위치</button><span>Enter 전송 · Shift+Enter 줄바꿈</span></div></form>`;
  const quick = get('.school-ai-quick');
  QUICK.forEach(([label, text]) => { const chip = button(label, () => ask(text)); chip.dataset.aiIdle = ''; quick.append(chip); });
  const actions = get('.school-ai-header-actions');
  const settings = button('⚙', openApiSettings);
  settings.setAttribute('aria-label', '환경설정 API Key 관리 열기');
  const fresh = button('↺', clearChat); fresh.dataset.aiIdle = ''; fresh.setAttribute('aria-label', '새 대화');
  const expand = button('⤢', () => { const wide = panel.classList.toggle('is-wide'); expand.setAttribute('aria-pressed', String(wide)); positioning.refresh(); });
  expand.setAttribute('aria-label', '대화창 넓게 보기'); expand.setAttribute('aria-pressed', 'false');
  const dismiss = button('✕', close); dismiss.setAttribute('aria-label', 'AI 도우미 닫기');
  actions.append(settings, fresh, expand, dismiss);
  get('[data-ai-input]').addEventListener('input', resizeInput);
  get('[data-ai-stop]').onclick = stop;
  get('form').onsubmit = event => { event.preventDefault(); send(); };
  get('[data-ai-input]').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
  });
  panel.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } });
  document.body.append(panel); welcome();
  launcher = button('', () => panel.hidden ? openSchoolAi() : close(), 'school-ai-launcher');
  launcher.setAttribute('aria-label', '오렌지톡 AI 도우미');
  launcher.append(element('span', 'school-ai-launcher-mark', '✦'), wordmark(), element('span', 'school-ai-launcher-label', 'AI 도우미'));
  launcher.setAttribute('aria-controls', 'schoolAiPanel'); launcher.setAttribute('aria-expanded', 'false');
  launcher.title = '클릭하여 대화 · 마우스로 끌어 이동 · Alt+방향키로 이동';
  document.body.append(launcher);
  const handle = get('.school-ai-header'); handle.setAttribute('aria-label', '제목을 끌어 대화창 이동');
  positioning = bindAiPosition(launcher, panel, handle);
  get('[data-ai-reset-position]').onclick = () => positioning.reset();
  document.getElementById('headerLockBtn')?.addEventListener('click', () => {
    close(); clearChat();
    get('[data-ai-input]').value = '';
  });
  // A reloaded window must not inherit invisible conversation turns from the main process.
  api().schoolAiReset().then(refresh).catch(() => notice('AI 대화를 초기화하지 못했습니다.', true));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
