/* Copyright (c) 2026 OrangeFarm. All rights reserved. */
import { soundPreferences } from '../../core/sound-preferences.js';

const categories = [
  ['confirm', '날짜 확인·주의 알림', '지난 날짜 등록 등 확인창이 열릴 때 나는 소리'],
  ['interface', '팝업·빠른 메뉴', '이름 클릭, 빠른 작업, 다중 선택 팝업의 효과음'],
  ['schedule', '수업·급식·일정 안내', '수업과 급식 팝업, 일정 알림 소리'],
  ['updates', '업데이트 안내', '새 소식과 업데이트 안내 소리'],
  ['bed', '침상 종료 알림', '침상 이용 시간이 끝났을 때 나는 알림과 미리 듣기'],
  ['reception', '키오스크 접수 알림', '이 기기로 새 접수가 들어왔을 때 나는 소리'],
  ['kioskChime', '키오스크 호출 알림음', '이 기기에서 재생하는 호출 알림음과 미리 듣기'],
  ['kioskVoice', '키오스크 이름 안내', '이 기기에서 읽어 주는 학생 이름과 안내 문구']
];
const speaker = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Z"/><g data-sound-waves><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></g><path data-sound-slash d="m16 9 5 6m0-6-5 6" hidden/></svg>';

export function renderSoundSettings() {
  const groups = [
    ['일반 안내', categories.slice(0, 4)],
    ['침상·키오스크 알림', categories.slice(4)]
  ];
  return '<section class="sound-settings" aria-labelledby="soundSettingsTitle">'
    + '<div class="settings-panel-title" id="soundSettingsTitle">🔊 소리 설정</div>'
    + '<div class="settings-panel-desc">듣고 싶은 소리만 켜 두세요. 소리를 꺼도 확인창과 알림 화면은 그대로 표시됩니다.</div>'
    + '<label class="sound-master"><input type="checkbox" role="switch" data-sound-master aria-label="전체 음소거"><span><strong>전체 음소거</strong><small>종류별 선택은 그대로 유지합니다.</small></span></label>'
    + '<p class="sound-notice" data-sound-summary></p>'
    + '<div class="sound-options">' + groups.map(([title, items]) =>
      '<section class="sound-group" aria-label="' + title + '"><h3>' + title + '</h3>'
      + items.map(([key, label, description]) =>
        '<label class="sound-option"><input type="checkbox" role="switch" data-sound-category="' + key + '" aria-label="' + label + '"><span class="sound-option-copy"><strong>' + label + '</strong><small>' + description + '</small></span></label>').join('')
      + '</section>').join('') + '</div>'
    + '<p class="sound-scope">변경한 설정은 이 기기에 자동 저장됩니다.<br>다른 PC·태블릿의 소리는 바뀌지 않습니다.</p>'
    + '<p class="sound-save-status" data-sound-save-status role="status" aria-live="polite"></p></section>';
}

function updateControls() {
  const value = soundPreferences.getSettings();
  const disabled = categories.filter(([key]) => !value.categories[key]).length;
  const silent = value.muted || disabled === categories.length;
  const header = document.getElementById('headerSoundBtn');
  if (header) {
    header.dataset.soundState = silent ? 'muted' : disabled ? 'partial' : 'on';
    header.setAttribute('aria-pressed', String(value.muted));
    const label = value.muted ? '전체 음소거 해제' : '전체 음소거';
    header.setAttribute('aria-label', label);
    header.title = label + (disabled ? ' · 종류별 소리 설정 유지' : '');
    header.querySelector('[data-sound-waves]')?.toggleAttribute('hidden', silent);
    header.querySelector('[data-sound-slash]')?.toggleAttribute('hidden', !silent);
  }
  const panel = document.querySelector('.sound-settings');
  if (!panel) return;
  const master = panel.querySelector('[data-sound-master]');
  if (master) master.checked = value.muted;
  panel.querySelectorAll('[data-sound-category]').forEach(input => { input.checked = value.categories[input.dataset.soundCategory]; });
  const message = value.muted
    ? '전체 음소거 중입니다. 침상·접수·호출을 포함한 모든 알림은 화면으로 확인해 주세요.'
    : disabled === categories.length ? '모든 종류의 소리가 꺼져 있습니다. 필요한 소리를 아래에서 켜 주세요.'
    : value.categories.bed ? '켜 둔 종류의 소리만 재생합니다.'
    : '침상 종료 소리가 꺼져 있습니다. 종료 알림창을 확인해 주세요.';
  panel.querySelector('[data-sound-summary]').textContent = message;
  panel.querySelector('[data-sound-summary]').classList.toggle('sound-notice-warning', value.muted || !value.categories.bed);
}
function save(patch) {
  const saved = soundPreferences.update(patch);
  updateControls();
  const status = document.querySelector('[data-sound-save-status]');
  if (status) status.textContent = saved ? '소리 설정을 저장했습니다.' : '설정을 저장하지 못했습니다. 기존 설정을 유지합니다.';
  if (!saved && !status) window.alert('소리 설정을 저장하지 못했습니다. 기존 설정을 유지합니다.');
}
export function bindSoundSettings(container) {
  const panel = container.querySelector('.sound-settings');
  if (!panel) return;
  panel.addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-sound-master]')) save({ muted: input.checked });
    else if (input.matches('[data-sound-category]')) save({ categories: { [input.dataset.soundCategory]: input.checked } });
  });
  updateControls();
}
function initialize() {
  const header = document.getElementById('headerSoundBtn');
  if (header && !header.dataset.soundBound) {
    header.dataset.soundBound = 'true';
    header.innerHTML = speaker;
    header.addEventListener('click', () => save({ muted: !soundPreferences.getSettings().muted }));
  }
  updateControls();
}
soundPreferences.subscribe(updateControls);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
