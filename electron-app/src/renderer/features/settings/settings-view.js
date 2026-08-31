/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { getStu, escHtml, toDateStr, getGrades, saveStudents, isKinder, closeModalGracefully } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { closeModalWithAnim } from '../daily/daily-autocomplete.js';
import { S } from '../../core/app-state.js';
import { magicCalendarManager, googleSheetsManager, driveSyncManager } from './drive-sync-manager.js';
import { getTopMenuVisibility, initTopMenuDnD } from './settings-menu-dnd.js';
import { _renderAccountTab, _bindAccountTab } from './settings-tab-account.js';
import { _renderDiaryTab, _renderPrivacyTab, _bindDiaryTabEvents, loadTreatmentTable, loadMedicationTable, _setSymInit, _setMedInitInput, _setMedRenderCards, _testDrugApiKey, _setMedBulkFetchStart, renderSidebarPosPanel, bindSidebarPosPanel, renderSchoolYearPanel, bindSchoolYearPanel, renderMealAcadPanel, bindMealAcadPanel } from './settings-tab-diary.js';
import { _renderHelpTab, _bindHelpTab } from './settings-tab-help.js';
import { _renderPeopleTab, initPeopleUploadPaste, setCareFileName, downloadOptimizedStaffTemplate, downloadOptimizedStudentTemplate, downloadOptimizedCareTemplate } from './settings-tab-people.js';
import { _renderRetentionTab, _bindRetentionTabEvents } from './settings-tab-retention.js';
import { _renderCustomBackupTab, _bindCustomBackupTabEvents } from './settings-tab-custom-backup.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';   /* 증상 화면과 동일한 미니 팝업 툴팁 */
import { verifyCdkey } from '../../core/cdkey-license.js';
import { _renderImportTab, _bindImportTabEvents, _loadAmbiguousStandalone } from './settings-tab-import.js';
import { setBgMode, selectBgImage, selectSolidImage, deleteBgCustom, toggleBgRandomDaily, toggleBgRandomWeekly, handleBgCustomUpload, BG_IMAGES, SOLID_IMAGES_DARK, SOLID_IMAGES_LIGHT, getSolidImages, getCustomBgDataUrl, reapplyBgCustom } from './settings-bg-theme.js';
import { setHeaderGlass, setFooterGlass, applyFontScale, toggleTheme } from '../shell/theme-manager.js';
import { _saveFooterMsgs, _resetFooterMsgs, getBannerTutorials, getLockedHeaderMsgs, loadUserHeaderMsgs, saveUserHeaderMsgs, getCurrentCustomHeaderMsgs, getDefaultCustomHeaderMsgs } from '../shell/header-widget.js';
import { _bindKioskCmsEvents } from '../kiosk/kiosk-cms-view.js';
import { collabGenerateKey, collabCopyKey } from '../daily/daily-view.js';
import { openPersonSearch } from '../../core/person-search-ui.js';
/* ═══════════════════════════════════════
   SETTINGS — Thin Dispatcher
   Tab-specific code extracted to:
     settings-tab-account.js
     settings-tab-diary.js
     settings-tab-people.js
     settings-tab-retention.js
     settings-tab-import.js
   ═══════════════════════════════════════ */
S.settingsLocked=null;
S.magicLayoutItems=JSON.parse(localStorage.getItem('ec_magic_layout_order')||'null')||[
  {id:'quickmemo',label:'📌 빠른 메모'},
  {id:'memolist',label:'📋 메모 리스트'},

  {id:'images',label:'🖼 이미지'},
{id:'links',label:'🔗 자주 방문하는 웹 링크 리스트'}
];
S.magicLayoutItems=S.magicLayoutItems.filter(function(it){return it&&it.id!=='calendar';});


/* ═══════════════════════════════════════════════════════════════
   이모지 선택기 — 회전문구·헤더·기타 이모지 입력 필드에서 공용으로 사용.
   클릭하면 카테고리 탭 + 그리드 팝업이 열린다.
   Windows 와 Mac 의 Segoe UI Emoji / Apple Color Emoji 렌더 차이는 여전히
   있지만 적어도 "선택 경험" 은 통일되고, 사용자가 자기 취향의 이모지를 고를 수 있다.
   ═══════════════════════════════════════════════════════════════ */
const EMOJI_CATEGORIES = [
  { name:'표정', icon:'😊', list:['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩'] },
  { name:'사람', icon:'👶', list:['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👨‍⚕️','👩‍⚕️','👨‍🎓','👩‍🎓','👨‍🏫','👩‍🏫','👨‍⚖️','👩‍⚖️','🕵️','💂','👷','🫅','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🫃','🫄','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','👯','🧖','🧗','🤺','🏇','⛷️','🏂','🏌️','🏄','🚣','🏊','⛹️','🏋️','🚴','🚵','🤸','🤼','🤽','🤾','🤹','🧘','🛀','🛌','🤝','👫','👭','👬','💏','💑','👪'] },
  { name:'신체', icon:'👁', list:['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁','👅','👄','🫦','💋'] },
  { name:'동물', icon:'🐶', list:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🦗','🕷','🕸','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿','🦔'] },
  { name:'음식', icon:'🍎', list:['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽','🥣','🥡','🥢','🧂'] },
  { name:'활동', icon:'⚽', list:['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸','🥌','🎿','⛷','🏂','🪂','🏋️','🤸','🤼','🤽','🤾','🏊','🚴','🚵','⛹️','🤺','🤹','🧘','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🎸','🪕','🎻','🎲','♟','🎯','🎳','🎮','🎰','🧩'] },
  { name:'자연', icon:'🌞', list:['🌸','💮','🏵','🌹','🥀','🌺','🌻','🌼','🌷','🌱','🪴','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🪨','🪵','🌍','🌎','🌏','🌐','🗺','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','⛲','🌅','🌄','🌠','🎆','🎇','🌇','🌆','🏙','🌃','🌌','🌉','🌁','⭐','🌟','✨','⚡','☄','💥','🔥','🌪','🌈','☀','🌤','⛅','🌥','☁','🌦','🌧','⛈','🌩','🌨','❄','☃','⛄','💨','💧','💦','☔','☂','🌊','🌫','🌙','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌝','🌞','🪐','💫'] },
  { name:'의료', icon:'🏥', list:['🏥','⚕️','💊','💉','🩸','🩹','🩺','🧬','🧪','🧫','🧴','🧻','🧼','🪥','🪒','🧽','🧹','🩻','🩼','🩷','🩶','🫧','🦠','🌡','🧯','⚰️','⚱️','🕯','🔬','🔭','📡','🩰'] },
  { name:'사물', icon:'📱', list:['💡','🔦','🏮','🪔','📔','📕','📖','📗','📘','📙','📚','📓','📒','📃','📜','📄','📰','🗞','📑','🔖','🏷','💰','🪙','💴','💵','💶','💷','💸','💳','🧾','✉️','📧','📨','📩','📤','📥','📦','📫','📪','📬','📭','📮','🗳','✏️','✒️','🖋','🖊','🖌','🖍','📝','💼','📁','📂','🗂','📅','📆','🗒','🗓','📇','📈','📉','📊','📋','📌','📍','📎','🖇','📏','📐','✂️','🗃','🗄','🗑','🔒','🔓','🔏','🔐','🔑','🗝','🔨','🪓','⛏','⚒','🛠','🗡','⚔','🔫','🪃','🏹','🛡','🪚','🔧','🪛','🔩','⚙','🗜','⚖','🦯','🔗','⛓','🧰','🧲','🪜','📱','📲','💻','⌨','🖥','🖨','🖱','🖲','🕹','🗜','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽','🎞','📞','☎','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🪫','🔌'] },
  { name:'기호', icon:'✅', list:['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮','✝','☪','🕉','☸','✡','🔯','🕎','☯','☦','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛','🉑','☢','☣','📴','📳','🈶','🈚','🈸','🈺','🈷','✴','🆚','💮','🉐','㊙','㊗','🈴','🈵','🈹','🈲','🅰','🅱','🆎','🆑','🅾','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽','⚠','🚸','🔱','⚜','🔰','♻','✅','🈯','💹','❇','✳','❎','🌐','💠','Ⓜ','🌀','💤','🏧','🚾','♿','🅿','🈳','🈂','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏','▶','⏸','⏯','⏹','⏺','⏭','⏮','⏩','⏪','⏫','⏬','◀','🔼','🔽','➡','⬅','⬆','⬇','↗','↘','↙','↖','↕','↔','↪','↩','⤴','⤵','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖','🟰','♾','💲','💱','™','©','®','〰','➰','➿','🔚','🔙','🔛','🔝','🔜','✔','☑','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪','▫','◾','◽','◼','◻','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯','♠','♣','♥','♦','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'] }
];
/* 현재 선택 중인 이모지 카테고리 인덱스 (세션 내 유지) */
let _emojiPickerCatIdx = 0;
/* 이모지 입력칸에서 선택기를 열 때 대상 input 참조 */
let _emojiPickerTargetInput = null;

function _openEmojiPicker(targetInput){
  /* 이전 팝업이 남아있다면 제거 */
  const _old = document.getElementById('emojiPickerOverlay');
  if(_old) _old.remove();
  _emojiPickerTargetInput = targetInput;
  const ov = document.createElement('div');
  ov.id = 'emojiPickerOverlay';
  ov.className = 'modal-overlay show';
  ov.style.zIndex = '9500';
  const inner = _renderEmojiPickerContent();
  ov.innerHTML = '<div class="modal-content" style="width:480px;max-height:560px;padding:0;display:flex;flex-direction:column;overflow:hidden">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bdr);background:var(--popup-head)">'
    +   '<span style="font-size:13px;font-weight:800;color:var(--t1)">😀 이모지 선택</span>'
    +   '<button class="modal-close" data-action="closeEmojiPicker" style="border:none;background:none;font-size:16px;cursor:pointer;color:var(--t3);padding:2px 6px">✕</button>'
    + '</div>'
    + inner
    + '</div>';
  ov.addEventListener('click', function(e){ if(e.target===ov) _closeEmojiPicker(); });
  const closeBtn = ov.querySelector('[data-action="closeEmojiPicker"]');
  if(closeBtn) closeBtn.addEventListener('click', _closeEmojiPicker);
  document.body.appendChild(ov);
  _bindEmojiPickerEvents(ov);
}

function _renderEmojiPickerContent(){
  let h = '';
  /* 카테고리 탭 */
  h += '<div id="emojiCatTabs" style="display:flex;gap:2px;padding:6px 8px;border-bottom:1px solid var(--bdr);background:var(--bg2);overflow-x:auto;scrollbar-width:thin">';
  EMOJI_CATEGORIES.forEach(function(c,i){
    const active = (i===_emojiPickerCatIdx);
    h += '<button class="emoji-cat-tab" data-cat-idx="'+i+'" title="'+escHtml(c.name)+'" style="flex:0 0 auto;padding:6px 10px;border:none;border-radius:6px;cursor:pointer;font-size:18px;line-height:1;background:'+(active?'rgba(6,182,212,0.18)':'transparent')+';transition:background .12s">'
      + c.icon + '</button>';
  });
  h += '</div>';
  /* 그리드 */
  const cur = EMOJI_CATEGORIES[_emojiPickerCatIdx];
  h += '<div id="emojiGridBody" style="flex:1;overflow-y:auto;padding:10px 12px;scrollbar-width:thin">';
  h += '<div style="font-size:10px;color:var(--t3);margin-bottom:6px;font-weight:700">'+escHtml(cur.name)+' ('+cur.list.length+')</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:2px">';
  cur.list.forEach(function(emoji){
    h += '<button class="emoji-pick-btn" data-emoji="'+escHtml(emoji)+'" style="padding:6px;border:none;border-radius:6px;cursor:pointer;font-size:20px;line-height:1;background:transparent;transition:background .1s" title="'+escHtml(emoji)+'">'+emoji+'</button>';
  });
  h += '</div></div>';
  return h;
}

function _bindEmojiPickerEvents(ov){
  ov.querySelectorAll('.emoji-cat-tab').forEach(function(btn){
    btn.addEventListener('click', function(){
      _emojiPickerCatIdx = parseInt(btn.dataset.catIdx, 10) || 0;
      /* 탭·그리드만 다시 렌더 */
      const header = ov.querySelector('.modal-content > div:first-child');
      ov.querySelector('.modal-content').innerHTML = (header?header.outerHTML:'') + _renderEmojiPickerContent();
      const closeBtn2 = ov.querySelector('[data-action="closeEmojiPicker"]');
      if(closeBtn2) closeBtn2.addEventListener('click', _closeEmojiPicker);
      _bindEmojiPickerEvents(ov);
    });
  });
  ov.querySelectorAll('.emoji-pick-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      const emoji = btn.dataset.emoji || '';
      if(_emojiPickerTargetInput){
        _emojiPickerTargetInput.value = emoji;
        /* 변경 이벤트 발화 — 입력 감지 로직과 호환 */
        _emojiPickerTargetInput.dispatchEvent(new Event('input', { bubbles:true }));
        _emojiPickerTargetInput.dispatchEvent(new Event('change', { bubbles:true }));
      }
      _closeEmojiPicker();
    });
    btn.addEventListener('mouseenter', function(){ btn.style.background='var(--hover)'; });
    btn.addEventListener('mouseleave', function(){ btn.style.background='transparent'; });
  });
}

function _closeEmojiPicker(){
  const ov = document.getElementById('emojiPickerOverlay');
  if(ov) ov.remove();
  _emojiPickerTargetInput = null;
}

/* 이모지 입력 필드에서 클릭/포커스 시 선택기 열기 — 전역 위임 */
document.addEventListener('click', function(e){
  const inp = e.target && e.target.closest && e.target.closest('input.hdr-msg-emoji');
  if(inp){
    e.preventDefault();
    _openEmojiPicker(inp);
  }
}, true);

/* 회전문구 행(.hdr-msg-row) 내 모든 입력 변경 시 자동 저장 — 전역 위임.
   대상: 텍스트·색상·시간 input. 이모지는 _openEmojiPicker 가 change 이벤트 발화. */
document.addEventListener('input', function(e){
  const row = e.target && e.target.closest && e.target.closest('.hdr-msg-row');
  if(row){ _hdrMsgAutoSave(); return; }
  /* 하단 회전문구 — text 또는 time 입력 모두 감지 */
  const frow = e.target && e.target.closest && e.target.closest('.footer-msg-row');
  if(frow){ _footerMsgAutoSave(); return; }
  /* footer-msg-input 자체만 있어도 (레거시) */
  const finp = e.target && e.target.closest && e.target.closest('input.footer-msg-input');
  if(finp){ _footerMsgAutoSave(); }
});
document.addEventListener('change', function(e){
  const row = e.target && e.target.closest && e.target.closest('.hdr-msg-row');
  if(row){ _hdrMsgAutoSave(); return; }
  const frow = e.target && e.target.closest && e.target.closest('.footer-msg-row');
  if(frow){ _footerMsgAutoSave(); return; }
  const finp = e.target && e.target.closest && e.target.closest('input.footer-msg-input');
  if(finp){ _footerMsgAutoSave(); }
});

/* #cyclingBrand 클릭 핸들러 제거 (오렌지팜 요청 2026-05-27) — 회전문구 자체가 없어졌으므로
 *  헤더 영역 클릭으로 설정 열 필요 없음. 회전 데이터·panel 함수는 그대로 유지(안전판). */

/* 하단 회전문구 자동 저장 — 디바운스 저장 + 토스트.
   데이터 구조: [{text, time}, ...]  time 은 ms. 슬롯별 전환 시간을 지원하므로 객체 저장. */
let _footerAutoSaveTimer=null;
function _footerMsgAutoSave(){
  _showSaveToast('saving');
  clearTimeout(_footerAutoSaveTimer);
  _footerAutoSaveTimer=setTimeout(function(){
    try{
      const rows=document.querySelectorAll('#settingsPanel .footer-msg-row');
      /* 패널이 사라진 뒤 타이머가 발사되면 rows.length === 0 → 빈 list → 사용자의 기존 문구가
       * 모두 빈 배열로 덮어써져 "다시 들어가면 사라져 있음" 회귀 발생. 패널 살아 있을 때만 저장. */
      if(!rows.length) return;
      const list=[];
      rows.forEach(function(row){
        const inp=row.querySelector('input.footer-msg-input');
        const tInp=row.querySelector('input.footer-msg-time');
        const text=inp?String(inp.value||'').trim():'';
        let sec=tInp?parseInt(tInp.value,10):30;
        if(isNaN(sec)||sec<3)sec=3; if(sec>300)sec=300;
        if(text) list.push({text:text, time:sec*1000});
      });
      localStorage.setItem('ec_footer_msgs', JSON.stringify(list));
      if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','footer_msgs',list);
      if(typeof window._reloadFooterMsgs==='function') window._reloadFooterMsgs();
      _showSaveToast('saved');
    }catch(e){ console.warn('[footerMsg] auto-save failed', e); }
  }, 250);
}

/* ═══ 회전문구 슬롯의 눈알 SVG (열 헤더 설정과 동일 디자인) ═══ */
const _msgEyeOnSvg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>';
const _msgEyeOffSvg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 20.5 20.5"/><path d="M9.8 6.8A10.8 10.8 0 0 1 12 6.5c4 0 7.3 1.9 9.5 5a14.7 14.7 0 0 1-3.2 3.4"/><path d="M6.2 9A14.8 14.8 0 0 0 2.5 12c2.2 3.1 5.5 5 9.5 5 1 0 1.9-.1 2.7-.4"/></svg>';
function _msgEyeBtnHtml(action,extraData,title){
  return '<span class="msg-eye-btn" data-action="'+action+'"'+(extraData||'')+' style="cursor:pointer;width:22px;height:22px;color:var(--t3);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;user-select:none" title="'+(title||'슬롯 비우기')+'">'
    +'<span class="eye-on" style="display:inline-flex;align-items:center;justify-content:center">'+_msgEyeOnSvg+'</span>'
    +'<span class="eye-off" style="display:none;align-items:center;justify-content:center">'+_msgEyeOffSvg+'</span>'
    +'</span>';
}
/* 입력 변경 시 눈알 on/off 즉시 동기화 (CSS :has() 폴백)
 * - hdr-msg-row (상단 회전문구): 눈알은 "가리기/보이기" 토글 → data-hidden 기준.
 *   사용자가 텍스트 타이핑 중에 눈알 상태가 깜빡이지 않도록 텍스트 비어있어도 동기화 건드리지 않음.
 * - footer-msg-row (하단 회전문구): 기존대로 텍스트 비어있으면 눈 감음(off). */
function _msgRowSyncEye(row){
  if(!row)return;
  const on=row.querySelector('.msg-eye-btn .eye-on');
  const off=row.querySelector('.msg-eye-btn .eye-off');
  if(!on&&!off)return;
  if(row.classList.contains('hdr-msg-row')){
    const hidden=row.dataset.hidden==='1';
    if(on)on.style.display=hidden?'none':'inline-flex';
    if(off)off.style.display=hidden?'inline-flex':'none';
    return;
  }
  const inp=row.querySelector('input.footer-msg-input,input.hdr-msg-text');
  if(!inp)return;
  const empty=!inp.value||!inp.value.trim();
  if(on)on.style.display=empty?'none':'inline-flex';
  if(off)off.style.display=empty?'inline-flex':'none';
}
function _msgRowsBindEyeSync(container){
  if(!container)return;
  container.querySelectorAll('.msg-row').forEach(function(r){
    _msgRowSyncEye(r);
    const inp=r.querySelector('input.footer-msg-input,input.hdr-msg-text');
    if(inp){
      inp.addEventListener('input',function(){_msgRowSyncEye(r);});
    }
  });
}

/* ═══ Event delegation helper ═══ */
function _bindDelegatedEvents(container){
  if(!container)return;
  /* 중복 바인딩 방지 — 매 렌더마다 추가되면 toggle 이 짝수 번 실행되어 원복됨 */
  if(container._delegatedBound)return;
  container._delegatedBound=true;
  container.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');
    if(!el||!container.contains(el))return;
    const action=el.dataset.action;
    const arg=el.dataset.arg;
    const arg2=el.dataset.arg2;
    const handlers={
      'cdkey-open-mypage':function(){
        e.preventDefault();
        const _url='https://school114.org/mypage/member_edit.asp';
        try{
          if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(_url);
          else window.open(_url,'_blank');
        }catch(_){window.open(_url,'_blank');}
      },
      'cdkey-verify':function(){_cdkeyVerify();},
      fbSwitchTab:function(){_fbSwitchTab(arg);},
      fbSubmit:function(){_fbSubmit();},
      fbLike:function(){_fbLike(parseInt(arg));},
      setBgMode:function(){setBgMode(arg);},
      selectBgImage:function(){selectBgImage(arg);},
      selectSolidImage:function(){selectSolidImage(arg);},
      deleteBgCustom:function(){deleteBgCustom();},
      bgResetPreview:function(){e.stopPropagation();deleteBgCustom();setBgMode('selected');selectBgImage('jeju_by-monet.webp');renderSettingsPanel('background');},
      toggleBgRandomDaily:function(){toggleBgRandomDaily();},
      toggleBgRandomWeekly:function(){toggleBgRandomWeekly();},
      bgCustomClick:function(){const fi=document.getElementById('bgCustomFileInput');if(fi)fi.click();},
      reapplyBgCustom:function(){reapplyBgCustom();},
      setHeaderGlass:function(){setHeaderGlass(arg);renderSettingsPanel(arg2||'background');},
      setFooterGlass:function(){setFooterGlass(arg);renderSettingsPanel(arg2||'background');},
      saveFooterMsgs:function(){_saveFooterMsgs();},
      resetFooterMsgs:function(){_resetFooterMsgs();},
      hdrMsgClear:function(){
        /* 사용자 정정: 눈알은 "가리기/보이기" 토글이지 "비우기" 가 아님.
         * 텍스트·이모지·색상은 그대로 두고 hidden 플래그만 뒤집는다.
         * 가려진 슬롯은 cycleBrand 가 회전 시 skip → 나머지 슬롯들로 정상 회전. */
        let idx=parseInt(arg,10);
        if(isNaN(idx)){const row=el.closest('.hdr-msg-row');if(row)idx=parseInt(row.dataset.idx,10);}
        if(isNaN(idx))return;
        const row=document.querySelector('.hdr-msg-row[data-idx="'+idx+'"]');
        if(!row)return;
        const nowHidden=row.dataset.hidden==='1';
        const next=!nowHidden;
        row.dataset.hidden=next?'1':'0';
        /* 흐림(opacity) 만 적용 — 빗금/줄긋기는 사용자 요청으로 제외. */
        row.style.opacity=next?'0.45':'';
        /* 눈알 아이콘 토글 + 툴팁 갱신 */
        const eyeBtn=row.querySelector('.msg-eye-btn');
        if(eyeBtn){
          const on=eyeBtn.querySelector('.eye-on');
          const off=eyeBtn.querySelector('.eye-off');
          if(on)on.style.display=next?'none':'inline-flex';
          if(off)off.style.display=next?'inline-flex':'none';
          eyeBtn.title=next?'이 슬롯 보이기 (회전 포함)':'이 슬롯 가리기 (회전에서 제외, 문구는 보존)';
        }
        _hdrMsgAutoSave();
      },
      hdrMsgReset:function(){
        if(!confirm('내 문구를 모두 기본값으로 되돌리시겠습니까? (잠금 문구는 항상 유지됩니다)'))return;
        try{saveUserHeaderMsgs([]);}catch(e){}
        renderSettingsPanel('headermsg');
        _showSaveToast('saved');
      },
      clearInput:function(){
        const row=el.closest('.msg-row');
        const inp=row?row.querySelector('input.footer-msg-input,input.hdr-msg-text'):el.previousElementSibling;
        if(inp){inp.value='';inp.dispatchEvent(new Event('input'));inp.focus();}
        if(row)_msgRowSyncEye(row);
      },
      applyFontScale:function(){const v=parseInt(arg);applyFontScale(v);const s=document.getElementById('fontScaleSlider');if(s)s.value=v;_fontScaleOnInput(v);},
      toggleAccordion:function(){
        const b=el.nextElementSibling;
        if(!b)return;
        const cs=window.getComputedStyle(b);
        const hidden=(b.style.display==='none')||(cs.display==='none');
        b.style.display=hidden?'block':'none';
        const arrow=el.querySelector('.acc-arrow');
        if(arrow)arrow.textContent=hidden?'\u25BC':'\u25B6';
      },
      toggleAccordionMaxH:function(){const b=el.nextElementSibling;const a=el.querySelector('.acc-arrow');if(b){const isClosed=(b.style.maxHeight===''||b.style.maxHeight==='0px');if(isClosed){b.style.maxHeight='2000px';if(a)a.textContent='\u25BC';}else{b.style.maxHeight='0px';if(a)a.textContent='\u25B6';}}},
      toggleNextBlock:function(){const b=el.nextElementSibling;if(b)b.style.display=b.style.display==='none'?'block':'none';},
      openExternal:function(){if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(arg);},
      testDrugApiKey:function(){_testDrugApiKey();},
      collabGenerateKey:function(){collabGenerateKey();},
      collabCopyKey:function(){collabCopyKey();},
      toggleTheme:function(){toggleTheme();},
      tiSwitch:function(){_tiSwitch(arg);},
      advSwitchTab:function(){advSwitchTab(arg);},
      advSelectGrade:function(){advSelectGrade(parseInt(arg));},
      advSelectClass:function(){advSelectClass(parseInt(arg),arg2);},
      advSelectPerson:function(){advSelectPerson(arg);},
      showDeleteConfirmPopup:function(){showDeleteConfirmPopup(arg);const ov=document.getElementById('delPersonSearchOverlay');if(ov)closeModalGracefully(ov);},
      confirmDeletePerson:function(){confirmDeletePerson(arg);},
      closeDeleteOverlay:function(){closeModalGracefully('deletePersonOverlay');},
      advBackToGrade:function(){advSelectGrade(parseInt(arg));},
      updaterCheck:function(){
        const box=document.getElementById('updStatusBox');
        const btn=document.getElementById('updCheckBtn');
        if(box) box.textContent='업데이트 확인 중…';
        if(btn){ btn.disabled=true; btn.style.opacity='0.6'; }
        if(window.electronAPI && window.electronAPI.updaterCheckNow){
          window.electronAPI.updaterCheckNow().then(function(r){
            if(!r || !r.success){ if(box) box.textContent='확인 실패: '+((r&&r.error)||'알 수 없는 오류'); }
          }).catch(function(e){ if(box) box.textContent='확인 실패: '+(e&&e.message||'오류'); })
          .finally(function(){ if(btn){ btn.disabled=false; btn.style.opacity='1'; } });
        }
      },
      updaterInstall:function(){ _showUpdateInstallConfirm(); }
    };
    if(handlers[action])handlers[action]();
  });
  /* Hover effects via delegation — mouseenter/mouseleave with data-hover */
  container.addEventListener('mouseover',function(e){
    const el=e.target.closest('[data-hover-in]');
    if(!el||!container.contains(el))return;
    _applyHoverStyle(el,el.dataset.hoverIn);
  });
  container.addEventListener('mouseout',function(e){
    const el=e.target.closest('[data-hover-out]');
    if(!el||!container.contains(el))return;
    _applyHoverStyle(el,el.dataset.hoverOut);
  });
}
function _applyHoverStyle(el,styleStr){
  if(!styleStr)return;
  styleStr.split(';').forEach(function(pair){
    const parts=pair.split(':');if(parts.length<2)return;
    const prop=parts[0].trim();const val=parts.slice(1).join(':').trim();
    if(prop&&val)el.style[prop]=val;
  });
}
function _bindInputEvents(container){
  if(!container)return;
  /* textarea focus/blur for border color */
  container.querySelectorAll('textarea[data-focus-border]').forEach(function(ta){
    ta.addEventListener('focus',function(){ta.style.borderColor=ta.dataset.focusBorder;});
    ta.addEventListener('blur',function(){ta.style.borderColor=ta.dataset.blurBorder||'var(--bdr)';});
  });
  /* oninput for collabMyKey */
  const collabKey=container.querySelector('#collabMyKey');
  if(collabKey){collabKey.addEventListener('input',function(){this.value=this.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,5);});}
  /* API 키 입력 저장 — input(타이핑/붙여넣기 즉시 localStorage) + change(블러 시 DB 동기화·리렌더) */
  container.querySelectorAll('input[data-save-key]').forEach(function(inp){
    /* 타이핑/붙여넣기 즉시 localStorage 저장 — 키 붙여넣고 바로 다른 버튼 눌러도 반영되도록 */
    inp.addEventListener('input',function(){
      const key=inp.dataset.saveKey;
      const val=this.value.trim();
      localStorage.setItem(key,val);
    });
    /* blur 시 DB 동기화 + 리렌더 + 날씨 자동 새로고침 */
    inp.addEventListener('change',function(){
      const key=inp.dataset.saveKey;const val=this.value.trim();
      localStorage.setItem(key,val);
      if(window.electronAPI&&window.electronAPI.dbSet){
        const dbKey=inp.dataset.dbKey;
        if(dbKey)window.electronAPI.dbSet('common',dbKey,val);
      }
      /* API 키 입력 시 날씨 소스 자동 전환 + settings.weather 동기화 */
      if(key==='ec_kma_api_key'||key==='ec_airkorea_api_key'){
        const kma=localStorage.getItem('ec_kma_api_key')||'';
        const newSrc=kma?'kma':'openmeteo';
        localStorage.setItem('ec_weather_source',newSrc);
        /* settings.weather에도 반영 (재시작 시 복원용) */
        try{
          const s=JSON.parse(localStorage.getItem('ec_settings')||'{}');
          if(!s.weather)s.weather={};
          s.weather.source=newSrc;
          s.weather.kmaApiKey=localStorage.getItem('ec_kma_api_key')||'';
          s.weather.airkoreaApiKey=localStorage.getItem('ec_airkorea_api_key')||'';
          localStorage.setItem('ec_settings',JSON.stringify(s));
          if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','settings',s);
        }catch(e){}
        /* 날씨 관련 API 키가 채워졌으면 즉시 재호출 (복붙 후 자동 반영) */
        if(val&&window.fetchWeather)setTimeout(window.fetchWeather,150);
      }
      if(inp.dataset.rerender)renderSettingsPanel(inp.dataset.rerender);
    });
  });
  /* 반영 버튼 — fetchWeather 호출 + "✓ 완료" 유지 (입력 수정 시 "반영"으로 리셋) */
  container.querySelectorAll('button[data-weather-apply]').forEach(function(btn){
    const kind=btn.dataset.weatherApply; /* 'region' or 'station' */
    const inputId=kind==='region'?'wsRegionInput':'wsStationInput';
    const lsKey=kind==='region'?'ec_user_region':'ec_airkorea_station';
    const pairedInput=document.getElementById(inputId);
    function _resetBtn(){btn.textContent='반영';btn.style.background='var(--cyan)';btn.disabled=false;}
    /* 입력 수정 시 버튼 상태 리셋 */
    if(pairedInput){
      pairedInput.addEventListener('input',function(){
        if(btn.textContent==='✓ 완료')_resetBtn();
      });
    }
    btn.addEventListener('click',function(){
      const inp=document.getElementById(inputId);
      const val=inp?inp.value.trim():'';
      /* 빈 값 방어 */
      if(!val){
        if(inp)inp.focus();
        const orig=btn.textContent;
        btn.disabled=true;btn.textContent=(kind==='region'?'지역명':'측정소명')+' 입력';btn.style.background='#dc2626';
        setTimeout(function(){
          btn.textContent=orig||'반영';btn.style.background='var(--cyan)';btn.disabled=false;
        },1200);
        return;
      }
      localStorage.setItem(lsKey,val);
      /* "반영됨" 플래그 기록 — 재시작 후에도 ✓ 완료 표시 유지 */
      localStorage.setItem(lsKey+'_applied',val);
      const dbKey=kind==='region'?'user_region':'airkorea_station';
      if(window.electronAPI&&window.electronAPI.dbSet){
        window.electronAPI.dbSet('common',dbKey,val).catch(function(){});
        window.electronAPI.dbSet('common',dbKey+'_applied',val).catch(function(){});
      }
      btn.disabled=true;btn.textContent='반영 중...';btn.style.background='var(--cyan)';
      const airKey=(localStorage.getItem('ec_airkorea_api_key')||'').trim();
      /* 측정소명 반영 시 주소→시·군 자동 추출 (지역명 입력 자동 채움) */
      const regionPromise=(kind==='station'&&val&&airKey&&window.electronAPI&&window.electronAPI.externalFetchAirkoreaStationInfo)
        ? window.electronAPI.externalFetchAirkoreaStationInfo(airKey,val).then(function(r){
            if(r&&r.success&&r.data&&r.data.region){
              localStorage.setItem('ec_user_region',r.data.region);
              localStorage.setItem('ec_user_region_applied',r.data.region);
              const ri=document.getElementById('wsRegionInput');
              if(ri)ri.value=r.data.region;
              if(window.electronAPI&&window.electronAPI.dbSet){
                window.electronAPI.dbSet('common','user_region',r.data.region).catch(function(){});
                window.electronAPI.dbSet('common','user_region_applied',r.data.region).catch(function(){});
              }
            }
          }).catch(function(){})
        : Promise.resolve();
      regionPromise.then(function(){
        if(window.persistWeatherToSettings)window.persistWeatherToSettings();
        if(window.fetchWeather)window.fetchWeather();
        setTimeout(function(){
          btn.textContent='✓ 완료';btn.style.background='#16a34a';btn.disabled=false;
          /* 배지(⚠ 반영 필요 → ✓ 반영 완료) 즉시 갱신 — 패널 재렌더 */
          setTimeout(function(){renderSettingsPanel('apikeys');},600);
        },500);
      });
    });
  });
  /* 학교 주소 자동완성 — 마우스 클릭 + 방향키(↑↓) + Enter/Tab 선택 지원 */
  var _addrInp=container.querySelector('#settingsSchoolAddr');
  var _addrDrop=container.querySelector('#settingsAddrDrop');
  if(_addrInp&&_addrDrop){
    var _at=null;
    var _addrActiveIdx=-1; /* 현재 키보드 하이라이트된 인덱스 */

    function _addrApplyPick(el){
      if(!el||!el.dataset||!el.dataset.addr) return;
      var addr=el.dataset.addr, lat=el.dataset.lat||'', lng=el.dataset.lng||'';
      _addrInp.value=addr;
      _addrDrop.style.display='none';
      _addrActiveIdx=-1;
      /* 기준위치 주소는 DB 저장 X — 주소·날씨·의료기관 검색 보조용 localStorage 전용.
         DB 에 들어가는 학교명은 사용자 프로필(users 테이블)의 school_name 이며 별개. */
      localStorage.setItem('ec_school_address',addr);
      if(lat) localStorage.setItem('ec_school_lat',lat);
      if(lng) localStorage.setItem('ec_school_lng',lng);
      /* 좌표를 함께 저장한 주소를 기록 — 반영 버튼 시 재지오코딩 회피 */
      if(lat&&lng) localStorage.setItem('ec_school_address_for_coord',addr);
      renderSettingsPanel('apikeys');
    }
    function _addrHighlight(idx){
      var items=_addrDrop.querySelectorAll('[data-addr]');
      if(!items.length){ _addrActiveIdx=-1; return; }
      if(idx<0) idx=items.length-1;
      if(idx>=items.length) idx=0;
      _addrActiveIdx=idx;
      items.forEach(function(it,i){
        it.style.background = (i===idx) ? 'var(--cyan-soft, rgba(6,182,212,0.12))' : '';
      });
      var sel=items[idx];
      if(sel&&sel.scrollIntoView) sel.scrollIntoView({block:'nearest'});
    }

    _addrInp.addEventListener('input',function(){
      var q=this.value.trim();
      _addrActiveIdx=-1;
      if(q.length<2||!window.electronAPI||!window.electronAPI.kakaoKeywordSearch){_addrDrop.style.display='none';return;}
      var kakaoRestKey=localStorage.getItem('ec_kakao_rest_api_key')||'';
      if(!kakaoRestKey){
        _addrDrop.innerHTML='<div style="padding:14px 16px;font-size:11px;color:var(--t2);line-height:1.7;text-align:center"><div style="font-size:20px;margin-bottom:4px">🗺</div><b style="color:#dc2626">카카오 REST API 키 미등록</b><br><span style="font-size:10px;color:var(--t3)">주소 자동완성을 쓰려면 아래 <b>카카오 개발자 API</b> 카드에 REST API 키를 먼저 등록하세요.<br>등록 전에는 주소를 <b>직접 전체 입력</b> 하셔도 됩니다.</span></div>';
        _addrDrop.style.display='block';
        return;
      }
      clearTimeout(_at);
      _at=setTimeout(function(){
        window.electronAPI.kakaoKeywordSearch(q,undefined,undefined,undefined,undefined,kakaoRestKey).then(function(r){
          if(!r||!r.success||!r.data||!r.data.length){
            _addrDrop.innerHTML='<div style="padding:12px 14px;font-size:11px;color:var(--t3);text-align:center">검색 결과가 없습니다. 다른 키워드로 검색해 보세요.</div>';
            _addrDrop.style.display='block';
            return;
          }
          var h='';
          r.data.slice(0,8).forEach(function(d){
            h+='<div class="addr-pick-item" style="padding:10px 14px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--bdr);transition:background .1s" data-addr="'+escHtml(d.road_address_name||d.address_name||d.place_name)+'" data-lat="'+escHtml(d.y||'')+'" data-lng="'+escHtml(d.x||'')+'">';
            h+='<div style="font-weight:700;color:var(--t1)">📍 '+escHtml(d.place_name||d.address_name)+'</div>';
            h+='<div style="font-size:9px;color:var(--t3)">'+escHtml(d.road_address_name||d.address_name||'')+'</div></div>';
          });
          _addrDrop.innerHTML=h;_addrDrop.style.display='block';
          _addrActiveIdx=-1;
          /* mousedown 으로 선택 — input 의 blur 가 click 보다 먼저 발화하여 드롭다운이 사라지는 문제 방지.
             또한 mousedown 의 preventDefault 로 input 포커스 유지 → blur→hide 사이클 자체를 차단. */
          _addrDrop.querySelectorAll('[data-addr]').forEach(function(el,i){
            el.addEventListener('mouseenter',function(){_addrHighlight(i);});
            el.addEventListener('mousedown',function(ev){
              ev.preventDefault();
              _addrApplyPick(el);
            });
          });
        });
      },300);
    });
    /* 방향키(↑/↓) 로 항목 이동, Enter/Tab 으로 선택, Esc 로 닫기 */
    _addrInp.addEventListener('keydown',function(e){
      if(_addrDrop.style.display==='none') return;
      var items=_addrDrop.querySelectorAll('[data-addr]');
      if(!items.length) return;
      if(e.key==='ArrowDown'){ e.preventDefault(); _addrHighlight(_addrActiveIdx+1); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); _addrHighlight(_addrActiveIdx-1); }
      else if(e.key==='Enter'||e.key==='Tab'){
        if(_addrActiveIdx<0) return; /* 하이라이트 안 됐으면 기본 동작 */
        e.preventDefault();
        _addrApplyPick(items[_addrActiveIdx]);
      } else if(e.key==='Escape'){
        e.preventDefault();
        _addrDrop.style.display='none';
        _addrActiveIdx=-1;
      }
    });
    /* blur — 드롭다운 안쪽 mousedown 은 preventDefault 로 blur 안 발생하니 안전.
       그 외 영역 클릭 시에만 닫힘. */
    _addrInp.addEventListener('blur',function(){setTimeout(function(){_addrDrop.style.display='none';},150);});
  }
  /* 카드별 반영 버튼 — 해당 입력의 값을 저장하고 관련 기능을 즉시 갱신
   * + "반영됨" 상태를 localStorage 에 기록 (재시작 후에도 ✓ 완료 표시 유지) */
  container.querySelectorAll('button[data-api-apply]').forEach(function(btn){
    const lsKey=btn.dataset.apiApply;
    const inp=container.querySelector('input[data-save-key="'+lsKey+'"]');
    function _resetBtn(){btn.textContent='반영';btn.style.background='var(--cyan)';btn.disabled=false;}
    if(inp){
      inp.addEventListener('input',function(){
        /* 입력 수정 시 "완료" 상태 해제 */
        if(btn.textContent==='✓ 완료')_resetBtn();
      });
    }
    /* 반영 버튼 mousedown 에서 preventDefault — 입력창의 focus 를 뺏지 않음.
     * 이렇게 안 하면: 사용자가 입력창에 키 입력 후 반영 클릭 → 입력창 blur → change 이벤트로
     *               renderSettingsPanel() 가 발화 → 버튼이 새 DOM 으로 교체 → 클릭 이벤트 분실 →
     *               첫 클릭은 무효, 두 번째 클릭에서야 반영되는 race condition 발생.
     * preventDefault 로 blur 자체를 막으면 첫 클릭에 정상 동작. */
    btn.addEventListener('mousedown',function(e){ e.preventDefault(); });
    btn.addEventListener('click',function(){
      /* 마스킹 입력(data-save-key 없음)인 경우 localStorage 에서 직접 읽음 — 식약처 API 등 */
      const val=(inp&&inp.dataset.saveKey)?inp.value.trim():(localStorage.getItem(lsKey)||'').trim();
      const prev=(localStorage.getItem(lsKey)||'').trim();
      const dbKey=(inp&&inp.dataset.dbKey)||(lsKey.indexOf('ec_')===0?lsKey.substring(3):lsKey);
      /* 빈 값 처리 — 이전 값 있으면 사용자가 명시적으로 지운 것 → 즉시 삭제 (confirm 없음) */
      if(!val){
        if(prev){
          localStorage.setItem(lsKey,'');
          localStorage.setItem(lsKey+'_applied','');
          /* 학교 주소 삭제 시 저장된 좌표도 함께 초기화 — DB 저장 경로 없음 (주소 검색 보조용) */
          if(lsKey==='ec_school_address'){
            localStorage.removeItem('ec_school_lat');
            localStorage.removeItem('ec_school_lng');
          } else {
            /* 기준위치 주소 외 API 키 등은 DB + 레거시 JSON 도 함께 비워 재하이드레이션 복원 방지.
               IPC 시그니처: dbSet(scope, key, value, year) / jsonSaveCommon(key, data) — 위치 인자 */
            if(window.electronAPI&&window.electronAPI.dbSet){
              window.electronAPI.dbSet('common', dbKey, '').catch(function(){});
              window.electronAPI.dbSet('common', dbKey+'_applied', '').catch(function(){});
            }
            if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
              window.electronAPI.jsonSaveCommon(dbKey, '').catch(function(){});
              window.electronAPI.jsonSaveCommon(dbKey+'_applied', '').catch(function(){});
            }
          }
          btn.disabled=true;btn.textContent='🗑 삭제됨';btn.style.background='#94a3b8';
          setTimeout(function(){ renderSettingsPanel('apikeys'); },600);
          return;
        } else {
          /* 기존 값도 없고 새 값도 없음 → 입력 요청 */
          if(inp)inp.focus();
          const orig=btn.textContent;
          btn.disabled=true;btn.textContent='값을 먼저 입력';btn.style.background='#dc2626';
          setTimeout(function(){
            btn.textContent=orig||'반영';btn.style.background='var(--cyan)';btn.disabled=false;
          },1200);
          return;
        }
      }
      /* 1) localStorage 저장 + "반영됨" 플래그 기록 */
      localStorage.setItem(lsKey,val);
      localStorage.setItem(lsKey+'_applied',val);
      /* 1-1) 학교 주소 반영 시 — 저장된 좌표가 없거나 주소가 바뀌었으면 카카오 지오코더로 자동 변환 + 저장.
         사용자가 드롭다운 선택 없이 직접 입력해도 의료기관 캐시 시작이 가능하도록 보강. */
      if(lsKey==='ec_school_address'){
        try{
          const _curAddr=localStorage.getItem('ec_school_address_for_coord')||'';
          const _hasLat=parseFloat(localStorage.getItem('ec_school_lat')||'0');
          const _hasLng=parseFloat(localStorage.getItem('ec_school_lng')||'0');
          if((!_hasLat||!_hasLng)||_curAddr!==val){
            const _kkKey=localStorage.getItem('ec_kakao_rest_api_key')||'';
            if(_kkKey&&window.electronAPI&&window.electronAPI.kakaoKeywordSearch){
              window.electronAPI.kakaoKeywordSearch(val,undefined,undefined,undefined,undefined,_kkKey).then(function(r){
                if(r&&r.success&&r.data&&r.data.length){
                  const d=r.data[0];
                  if(d.x&&d.y){
                    localStorage.setItem('ec_school_lat',String(d.y));
                    localStorage.setItem('ec_school_lng',String(d.x));
                    localStorage.setItem('ec_school_address_for_coord',val);
                    /* 좌표 즉시 영구 저장 — 재시작 후에도 의료기관 탐색에서 재사용 */
                    if(window.electronAPI){
                      if(window.electronAPI.dbSet){
                        window.electronAPI.dbSet('common','school_lat',String(d.y)).catch(function(){});
                        window.electronAPI.dbSet('common','school_lng',String(d.x)).catch(function(){});
                      }
                      if(window.electronAPI.jsonSaveCommon){
                        window.electronAPI.jsonSaveCommon('school_lat',String(d.y)).catch(function(){});
                        window.electronAPI.jsonSaveCommon('school_lng',String(d.x)).catch(function(){});
                      }
                    }
                  }
                } else if(window.electronAPI.kakaoAddressSearch){
                  /* keyword 미스 → address 검색 폴백 */
                  window.electronAPI.kakaoAddressSearch(val,_kkKey).then(function(r2){
                    if(r2&&r2.success&&r2.data&&r2.data.length){
                      const d2=r2.data[0];
                      if(d2.x&&d2.y){
                        localStorage.setItem('ec_school_lat',String(d2.y));
                        localStorage.setItem('ec_school_lng',String(d2.x));
                        localStorage.setItem('ec_school_address_for_coord',val);
                      }
                    }
                  }).catch(function(){});
                }
              }).catch(function(){});
            }
          }
        }catch(e){}
      }
      /* DB + JSON 저장 — 학교 주소도 함께 영구 저장 (사용자 PC localStorage 만 의존하면 사라질 수 있음).
         IPC 시그니처: dbSet(scope, key, value, year) — 위치 인자. */
      if(window.electronAPI&&window.electronAPI.dbSet){
        window.electronAPI.dbSet('common', dbKey, val).catch(function(){});
        window.electronAPI.dbSet('common', dbKey+'_applied', val).catch(function(){});
        if(window.electronAPI.jsonSaveCommon){
          window.electronAPI.jsonSaveCommon(dbKey, val).catch(function(){});
          window.electronAPI.jsonSaveCommon(dbKey+'_applied', val).catch(function(){});
        }
        /* 학교 주소 반영 시 — 좌표(lat/lng)도 DB+JSON 에 함께 저장 (의료기관 탐색에서 재사용) */
        if(lsKey==='ec_school_address'){
          const _lat=localStorage.getItem('ec_school_lat')||'';
          const _lng=localStorage.getItem('ec_school_lng')||'';
          if(_lat) window.electronAPI.dbSet('common','school_lat',_lat).catch(function(){});
          if(_lng) window.electronAPI.dbSet('common','school_lng',_lng).catch(function(){});
          if(window.electronAPI.jsonSaveCommon){
            if(_lat) window.electronAPI.jsonSaveCommon('school_lat',_lat).catch(function(){});
            if(_lng) window.electronAPI.jsonSaveCommon('school_lng',_lng).catch(function(){});
          }
        }
      }
      btn.disabled=true;btn.textContent='반영 중...';btn.style.background='var(--cyan)';
      /* 2) 키별 연관 기능 즉시 갱신 */
      if(lsKey==='ec_kma_api_key'||lsKey==='ec_airkorea_api_key'){
        try{
          const kma=localStorage.getItem('ec_kma_api_key')||'';
          const newSrc=kma?'kma':'openmeteo';
          localStorage.setItem('ec_weather_source',newSrc);
          if(window.persistWeatherToSettings)window.persistWeatherToSettings();
        }catch(e){}
        if(window.fetchWeather)setTimeout(window.fetchWeather,100);
      } else if(lsKey==='ec_kakao_rest_api_key'||lsKey==='ec_kakao_js_api_key'||lsKey==='ec_hira_api_key'||lsKey==='ec_emergency_api_key'){
        try{global._medFacCache=null;}catch(e){}
      } else if(lsKey==='ec_holiday_api_key'){
        /* 특일정보 키 반영 직후 — 현재 연도 ± 1 (총 3년치, 올해 포함) 즉시 fetch + S.koreanHolidays 누적.
         * 하드코딩 폐지로 올해도 fetch. 응답 후 달력 다시 그리기 위해 bus.emit('render:calendar'). */
        try{
          if(window.electronAPI&&window.electronAPI.statsDbHolidaysFetch){
            const _curYr=new Date().getFullYear();
            const _yrs=[String(_curYr-1), String(_curYr), String(_curYr+1)];
            _yrs.forEach(function(yr){
              window.electronAPI.statsDbHolidaysFetch(val, yr).then(function(r){
                if(r&&r.success&&r.data){
                  if(!S.koreanHolidays) S.koreanHolidays={};
                  Object.assign(S.koreanHolidays, r.data);
                  try{ bus.emit('render:calendar'); bus.emit('holidays:updated'); }catch(_){}
                }
              }).catch(function(){});
            });
          }
        }catch(e){}
      }
      setTimeout(function(){
        btn.textContent='✓ 완료';btn.style.background='#16a34a';btn.disabled=false;
        /* 카드 배지(⚠ 반영 필요 → ✓ 반영 완료) 즉시 갱신 — 패널 재렌더 */
        setTimeout(function(){renderSettingsPanel('apikeys');},600);
      },400);
    });
  });
  /* ═══ 의료기관 반경 대량 캐시 버튼 바인딩 ═══ */
  const medfacBulkBtn=container.querySelector('#medfacBulkFetchBtn');
  const medfacClearBtn=container.querySelector('#medfacClearCacheBtn');
  const medfacBadge=container.querySelector('#medfacCacheBadge');
  const medfacStatus=container.querySelector('#medfacBulkStatus');
  const medfacProgWrap=container.querySelector('#medfacBulkProgressWrap');
  const medfacProgBar=container.querySelector('#medfacBulkProgressBar');
  const medfacRadiusSel=container.querySelector('#medfacRadiusSelect');

  /* 캐시 상태 로드 → 배지 갱신 + 노후도(30일 경과) 시 경고 + 업데이트 버튼 노출 */
  const medfacUpdateBtn=container.querySelector('#medfacUpdateBtn');
  /* 진행 중 상태가 있으면 그것을 먼저 표시 (설정창 재오픈 시 "불러오기 전" 으로 잘못 돌아가는 문제 해결) */
  const _bs = window._medfacBulkState;
  if(_bs && _bs.running){
    if(medfacBadge){
      medfacBadge.textContent='⏳ 진행 중 · '+(_bs.pct||0)+'%';
      medfacBadge.style.background='rgba(234,179,8,0.12)';
      medfacBadge.style.color='#ca8a04';
    }
    if(medfacStatus) medfacStatus.textContent='⏳ '+(_bs.pct||0)+'% · ['+(_bs.phase||'')+'] '+(_bs.msg||'');
    if(medfacProgWrap) medfacProgWrap.style.display='block';
    if(medfacProgBar) medfacProgBar.style.width=(_bs.pct||0)+'%';
    if(medfacBulkBtn){ medfacBulkBtn.disabled=true; medfacBulkBtn.textContent='⏳ 조회 중…'; medfacBulkBtn.style.display='inline-flex'; }
    if(medfacUpdateBtn){ medfacUpdateBtn.style.display='none'; }
  } else if(medfacBadge && window.electronAPI && window.electronAPI.medfacLoadCache){
    window.electronAPI.medfacLoadCache().then(function(r){
      if(r&&r.success&&r.exists&&r.data){
        const d=r.data, st=d.stats||{};
        const fetchedAt=d.fetchedAt?new Date(d.fetchedAt):null;
        const fetched=fetchedAt?fetchedAt.toLocaleDateString('ko-KR'):'?';
        const ageDays=fetchedAt?Math.floor((Date.now()-fetchedAt.getTime())/(86400000)):0;
        const stale=ageDays>=30;
        medfacBadge.textContent=(stale?'⚠ 업데이트 권장':'✅ 불러오기 완료')+' · '+fetched+(ageDays?' ('+ageDays+'일 전)':'');
        medfacBadge.style.background=stale?'rgba(234,179,8,0.1)':'rgba(34,197,94,0.1)';
        medfacBadge.style.color=stale?'#ca8a04':'#16a34a';
        if(medfacStatus) medfacStatus.textContent='병원 '+(st.hospitals||0)+'건 · 약국 '+(st.pharmacies||0)+'건 · 응급실 '+(st.emergency||0)+'건';
        if(medfacBulkBtn) medfacBulkBtn.style.display='none';
        if(medfacUpdateBtn) medfacUpdateBtn.style.display='inline-flex';
      } else {
        medfacBadge.textContent='불러오기 전';
        medfacBadge.style.background='rgba(156,163,175,0.1)';
        medfacBadge.style.color='#94a3b8';
        if(medfacBulkBtn) medfacBulkBtn.style.display='inline-flex';
        if(medfacUpdateBtn) medfacUpdateBtn.style.display='none';
      }
    }).catch(function(){ medfacBadge.textContent='확인 실패'; });
  }
  /* 업데이트 버튼 — 기존 캐시를 최신 정보로 덮어씀 (동일 fetch 함수, 확인 문구만 차이) */
  if(medfacUpdateBtn && !medfacUpdateBtn._bound){
    medfacUpdateBtn._bound=true;
    medfacUpdateBtn.addEventListener('click',function(){
      if(!confirm('기존 의료기관 캐시를 최신 정보로 업데이트합니다.\n최대 20분 소요 (공공 API 특성상 응답 속도가 느릴 수 있습니다) · 진행 중에도 설정창을 닫고 일지 작성·검색 등 다른 기능을 자유롭게 사용하셔도 됩니다.\n\n진행하시겠습니까?')) return;
      /* 확인 대화상자는 이미 표시 — 내부 confirm 스킵 */
      medfacUpdateBtn.dataset.noConfirm='1';
      _runMedfacBulkFetch(medfacUpdateBtn);
    });
  }

  /* 실제 fetch 실행 함수 — 불러오기·업데이트 공용 */
  async function _runMedfacBulkFetch(trigBtn){
      const hiraKey=localStorage.getItem('ec_hira_api_key')||'';
      const emgKey=localStorage.getItem('ec_emergency_api_key')||'';
      if(!hiraKey){ alert('심평원 API 키가 등록·반영되지 않았습니다.\n위의 "건강보험심사평가원 API" 카드에서 먼저 키를 입력하고 반영 버튼을 누르세요.'); return; }
      const schAddr=localStorage.getItem('ec_school_address')||'';
      if(!schAddr){ alert('기준위치(학교) 주소가 입력되지 않은 상태입니다.\n위 기준위치(학교) 주소를 먼저 입력해주세요.'); return; }
      /* 학교 주소 → 좌표 (kakao geocoder) 로 변환해야 하는데, 현재 ec_school_address 근처에 좌표가 저장돼 있을 수 있음 */
      let schLat=parseFloat(localStorage.getItem('ec_school_lat')||'0');
      let schLng=parseFloat(localStorage.getItem('ec_school_lng')||'0');
      if(!schLat||!schLng){
        /* kakao 주소 검색으로 좌표 얻기 */
        const kkKey=localStorage.getItem('ec_kakao_rest_api_key')||'';
        if(kkKey && window.electronAPI && window.electronAPI.kakaoAddressSearch){
          medfacStatus.textContent='학교 주소 → 좌표 변환 중…';
          try{
            const r=await window.electronAPI.kakaoAddressSearch(schAddr, kkKey);
            if(r&&r.success&&r.data&&r.data.length){
              schLat=parseFloat(r.data[0].y); schLng=parseFloat(r.data[0].x);
              localStorage.setItem('ec_school_lat',String(schLat));
              localStorage.setItem('ec_school_lng',String(schLng));
            }
          }catch(e){}
        }
      }
      if(!schLat||!schLng){
        alert('학교 주소의 좌표를 확인할 수 없습니다.\n\n해결 방법:\n1) 위 "기준위치(학교) 주소" 입력란을 지우고 다시 주소를 검색·선택해 주세요 (선택 시 좌표가 함께 저장됩니다).\n2) 카카오 REST API 키를 등록하면 자동 좌표 변환이 가능합니다.');
        return;
      }
      const radiusKm=30;
      const btnRef=trigBtn||medfacBulkBtn;
      if(!btnRef.dataset.noConfirm){
        if(!confirm('반경 30km 의료기관을 수집합니다. 병원(18개 진료과 + 전체) · 약국 · 응급실'+(emgKey?'':' (API 키 없음 — 건너뜀)')+'.\n최대 20분 소요 (공공 API 특성상 응답 속도가 느릴 수 있습니다). 설정창을 닫아도 백그라운드로 계속 진행되며 완료 시 알림이 뜹니다.\n\n시작하시겠습니까?')) return;
      }
      delete btnRef.dataset.noConfirm;

      btnRef.disabled=true;
      const origText=btnRef.textContent;
      btnRef.textContent='⏳ 조회 중…';
      if(medfacProgWrap) medfacProgWrap.style.display='block';
      if(medfacProgBar) medfacProgBar.style.width='0%';

      /* 전역 진행 상태 초기화 — 설정창을 닫았다 다시 열어도 현재 진행률이 유지되도록 */
      window._medfacBulkState = { running: true, pct: 0, phase: '', msg: '시작 중…' };

      /* 진행률 이벤트 리스너 — % + 모래시계 + 전역 상태 갱신 + DOM 업데이트 */
      if(window.electronAPI&&window.electronAPI.medfacOnProgress){
        window.electronAPI.medfacOnProgress(function(p){
          const pct = p.total ? Math.round((p.done/p.total)*100) : 0;
          /* 전역 상태 최신화 — 창이 닫혀 있어도 재오픈 시 복원용 */
          window._medfacBulkState = { running: true, pct: pct, phase: p.phase||'', msg: p.msg||'' };
          /* 현재 열려있는 설정창이 있으면 DOM 즉시 갱신 */
          const _badge=document.getElementById('medfacCacheBadge');
          const _stat=document.getElementById('medfacBulkStatus');
          const _bar=document.getElementById('medfacBulkProgressBar');
          if(_badge){ _badge.textContent='⏳ 진행 중 · '+pct+'%'; _badge.style.background='rgba(234,179,8,0.12)'; _badge.style.color='#ca8a04'; }
          if(_stat) _stat.textContent='⏳ '+pct+'% · ['+p.phase+'] '+p.msg;
          if(_bar && p.total) _bar.style.width=pct+'%';
        });
      }

      try{
        const res=await window.electronAPI.medfacBulkFetch(hiraKey, emgKey, {
          lat: schLat, lng: schLng, address: schAddr, radiusKm: radiusKm
        });
        if(res&&res.success){
          if(medfacProgBar) medfacProgBar.style.width='100%';
          if(medfacStatus) medfacStatus.textContent='✅ 완료 — 병원 '+res.stats.hospitals+' · 약국 '+res.stats.pharmacies+' · 응급실 '+res.stats.emergency+' (API '+res.stats.apiCalls+'회)';
          alert('의료기관 캐싱 완료!\n\n병원 '+res.stats.hospitals+'건\n약국 '+res.stats.pharmacies+'건\n응급실 '+res.stats.emergency+'건\n\n이제 의료기관 탐색과 증상처방이 즉시 동작합니다.');
        } else {
          if(medfacStatus) medfacStatus.textContent='❌ 실패: '+(res&&res.error||'알 수 없는 오류');
          alert('캐싱 실패: '+(res&&res.error||'알 수 없는 오류'));
        }
      } catch(err){
        console.error('[medfac-bulk]',err);
        if(medfacStatus) medfacStatus.textContent='❌ 오류: '+err.message;
      } finally {
        btnRef.disabled=false;
        btnRef.textContent=origText;
        if(window.electronAPI&&window.electronAPI.medfacOnProgress) window.electronAPI.medfacOnProgress(null);
        /* 전역 진행 상태 해제 — 설정창 재오픈 시 "불러오기 완료" 배지로 전환됨 */
        window._medfacBulkState = { running: false };
        setTimeout(function(){ renderSettingsPanel('apikeys'); }, 500);
      }
  }
  if(medfacBulkBtn&&!medfacBulkBtn._bound){
    medfacBulkBtn._bound=true;
    medfacBulkBtn.addEventListener('click',function(){ _runMedfacBulkFetch(medfacBulkBtn); });
  }
  if(medfacClearBtn&&!medfacClearBtn._bound){
    medfacClearBtn._bound=true;
    medfacClearBtn.addEventListener('click',async function(){
      if(!confirm('의료기관 캐시를 삭제하시겠습니까?\n(학생·보건일지 데이터는 영향받지 않습니다)')) return;
      if(window.electronAPI&&window.electronAPI.medfacClearCache){
        await window.electronAPI.medfacClearCache();
        renderSettingsPanel('apikeys');
      }
    });
  }

  /* ═══ 식약처 API 카드 옆 — 약품 정보 업데이트 버튼 ═══ */
  const medApiBulkBtn=container.querySelector('#setMedApiBulkBtn');
  const medApiUpdateBtn=container.querySelector('#setMedApiUpdateBtn');
  const medApiBadge=container.querySelector('#setMedCacheBadgeApi');
  const medApiStatus=container.querySelector('#setMedApiStatus');
  /* 배지 로드 */
  if(medApiBadge && window.electronAPI && window.electronAPI.jsonLoadCommon){
    window.electronAPI.jsonLoadCommon({key:'medications_list'}).then(function(r){
      const cache=(r&&r.success&&r.data&&typeof r.data==='object')?r.data:null;
      const count = cache&&cache.items ? Object.keys(cache.items).length : 0;
      if(!cache || count===0){
        medApiBadge.textContent='불러오기 전';
        medApiBadge.style.background='rgba(156,163,175,0.1)';
        medApiBadge.style.color='#94a3b8';
      } else {
        const cachedAt = cache.cachedAt ? new Date(cache.cachedAt) : null;
        const fetched = cachedAt ? cachedAt.toLocaleDateString('ko-KR') : '날짜 미상';
        const ageDays = cachedAt ? Math.floor((Date.now()-cachedAt.getTime())/86400000) : 999;
        const stale = ageDays >= 30;
        medApiBadge.textContent = (stale?'⚠ 업데이트 권장':'✅ 불러오기 완료')+' · '+count+'건 · '+fetched+(ageDays?' ('+ageDays+'일 전)':'');
        medApiBadge.style.background = stale?'rgba(234,179,8,0.1)':'rgba(34,197,94,0.1)';
        medApiBadge.style.color = stale?'#ca8a04':'#16a34a';
        if(medApiStatus) medApiStatus.textContent = fetched + (ageDays?' ('+ageDays+'일 전)':'');
      }
    }).catch(function(){ medApiBadge.textContent='확인 실패'; });
  }
  if(medApiBulkBtn && !medApiBulkBtn._bound){
    medApiBulkBtn._bound=true;
    medApiBulkBtn.addEventListener('click',function(){
      if(typeof _setMedBulkFetchStart==='function') _setMedBulkFetchStart(false);
    });
  }
  if(medApiUpdateBtn && !medApiUpdateBtn._bound){
    medApiUpdateBtn._bound=true;
    medApiUpdateBtn.addEventListener('click',function(){
      if(typeof _setMedBulkFetchStart==='function') _setMedBulkFetchStart(true);
    });
    /* 호버 툴팁은 renderSettingsPanel 의 전역 위임 핸들러가 처리 (data-tooltip → 미니 팝업) */
  }

  const resetAllBtn=container.querySelector('#apiKeysResetAllBtn');
  if(resetAllBtn){
    resetAllBtn.addEventListener('click',function(){
      if(!confirm('모든 API 키를 초기화하시겠습니까?\n\n지워지는 항목:\n· 기상청·에어코리아 키\n· 식약처 의약품 키\n· 카카오 REST·JavaScript 키\n· 심사평가원·응급의료 키\n· 특일정보 키 (공휴일 캐시 포함)\n· 학교 주소·지역명·측정소명\n\n(API 키 외의 보건일지 데이터는 영향받지 않습니다)')) return;
      const baseKeys=[
        'kma_api_key','airkorea_api_key','drug_api_key',
        'kakao_rest_api_key','kakao_js_api_key',
        'hira_api_key','emergency_api_key',
        'holiday_api_key','neis_api_key','kdca_api_key',
        'school_address','user_region','airkorea_station'
      ];
      const keysToReset=[];
      baseKeys.forEach(function(k){
        keysToReset.push('ec_'+k);
        keysToReset.push('ec_'+k+'_applied'); /* 반영 플래그도 초기화 */
      });
      keysToReset.push('ec_weatherRegion');
      const dbKeysToReset=[];
      baseKeys.forEach(function(k){
        dbKeysToReset.push(k);
        dbKeysToReset.push(k+'_applied');
      });
      keysToReset.forEach(function(k){localStorage.removeItem(k);});
      if(window.electronAPI&&window.electronAPI.dbSet){
        dbKeysToReset.forEach(function(k){window.electronAPI.dbSet('common',k,'').catch(function(){});});
      }
      /* 공휴일 캐시도 함께 비움 (학교 이동 시 옛 학교 PC 의 캐시가 따라가지 않도록).
         하드코딩 폐지로 전부 비움 — 키 재입력·반영 시 API 에서 다시 받음. */
      if(window.electronAPI&&window.electronAPI.statsDbHolidaysClear){
        window.electronAPI.statsDbHolidaysClear('*').catch(function(){});
        try{ S.koreanHolidays={}; bus&&bus.emit&&bus.emit('render:calendar'); bus&&bus.emit&&bus.emit('holidays:updated'); }catch(_){}
      }
      if(window.persistWeatherToSettings)window.persistWeatherToSettings();
      renderSettingsPanel('apikeys');
      bus&&bus.emit&&bus.emit('toast:show',{text:'모든 API 키가 초기화되었습니다'});
    });
  }

  /* ─── 공휴일 캐시 새로고침 버튼 ───
     · 현재 캐시된 모든 연도를 비우고 (2026 은 항상 표시)
     · 입력된 키가 있으면 현재 ± 1년치 즉시 재 fetch */
  const holClearBtn=container.querySelector('#holidayCacheClearBtn');
  const holStatusEl=container.querySelector('#holidayCacheStatus');
  if(holClearBtn&&!holClearBtn._bound){
    holClearBtn._bound=true;
    holClearBtn.addEventListener('click',async function(){
      if(!confirm('캐시된 공휴일 데이터를 비우고 다시 받습니다.\n\n위에 입력된 특일정보 API 키로 현재 연도 전후(올해±1)를 즉시 재호출하고,\n그 외 연도는 달력에서 해당 연도를 열 때 자동으로 받아옵니다.\n계속하시겠습니까?')) return;
      holClearBtn.disabled=true; holClearBtn.textContent='비우는 중…';
      if(holStatusEl) holStatusEl.textContent='';
      try{
        if(window.electronAPI&&window.electronAPI.statsDbHolidaysClear){
          await window.electronAPI.statsDbHolidaysClear('*');
        }
        /* 하드코딩 폐지 — S.koreanHolidays 전체 비움(전부 API 재호출) */
        try{ S.koreanHolidays={}; bus&&bus.emit&&bus.emit('render:calendar'); bus&&bus.emit&&bus.emit('holidays:updated'); }catch(_){}
        const key=(localStorage.getItem('ec_holiday_api_key')||'').trim();
        if(!key){
          if(holStatusEl) holStatusEl.textContent='✓ 캐시 비움 — 키가 없어 재호출 생략 (공휴일 표시 안 됨)';
          holClearBtn.disabled=false; holClearBtn.textContent='🗑 캐시 비우기';
          return;
        }
        const _curYr=new Date().getFullYear();
        const _yrs=[String(_curYr-1), String(_curYr), String(_curYr+1)];
        let okCnt=0, errCnt=0;
        for(const yr of _yrs){
          if(holStatusEl) holStatusEl.textContent=yr+' 받는 중…';
          try{
            const r=await window.electronAPI.statsDbHolidaysFetch(key, yr);
            if(r&&r.success&&r.data){
              if(!S.koreanHolidays) S.koreanHolidays={};
              Object.assign(S.koreanHolidays, r.data);
              okCnt++;
            } else { errCnt++; }
          }catch(_){ errCnt++; }
        }
        try{ bus.emit('render:calendar'); bus.emit('holidays:updated'); }catch(_){}
        if(holStatusEl) holStatusEl.textContent='✓ 완료 — 성공 '+okCnt+'/'+_yrs.length+(errCnt?' (실패 '+errCnt+')':'');
      }catch(e){
        if(holStatusEl) holStatusEl.textContent='⚠ 오류: '+(e.message||String(e));
      }
      holClearBtn.disabled=false; holClearBtn.textContent='🗑 캐시 비우기';
    });
  }
  /* onchange for radio buttons */
  container.querySelectorAll('input[data-save-radio]').forEach(function(inp){
    inp.addEventListener('change',function(){localStorage.setItem(inp.dataset.saveRadio,inp.value);});
  });
  /* onchange for checkboxes with data-action */
  container.querySelectorAll('input[type="checkbox"][data-action]').forEach(function(inp){
    inp.addEventListener('change',function(){
      const action=inp.dataset.action;
      if(action==='toggleBgRandomDaily')toggleBgRandomDaily();
      if(action==='toggleBgRandomWeekly')toggleBgRandomWeekly();
    });
  });
  /* fontScaleSlider */
  const slider=container.querySelector('#fontScaleSlider');
  if(slider){
    slider.addEventListener('input',function(){_fontScaleOnInput(this.value);});
    slider.addEventListener('change',function(){applyFontScale(parseInt(this.value));});
  }
  /* bgCustomFileInput */
  const bgInput=container.querySelector('#bgCustomFileInput');
  if(bgInput){bgInput.addEventListener('change',function(){if(this.files.length)handleBgCustomUpload(this.files[0]);});}
  /* bgCustomDropArea drag events */
  const dropArea=container.querySelector('#bgCustomDropArea');
  if(dropArea){
    dropArea.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='var(--cyan)';});
    dropArea.addEventListener('dragleave',function(){this.style.borderColor='var(--bdr)';});
    dropArea.addEventListener('drop',function(e){e.preventDefault();this.style.borderColor='var(--bdr)';if(e.dataTransfer.files.length)handleBgCustomUpload(e.dataTransfer.files[0]);});
  }
  /* drug API key — masked 옵션 제거됨, 다른 키들과 동일하게 generic blur listener 로 처리 */
  /* nurseName oninput */
  container.querySelectorAll('input[data-nurse-save]').forEach(function(inp){
    inp.addEventListener('input',function(){saveSettings();});
  });
  /* onerror for images */
  container.querySelectorAll('img[data-fallback]').forEach(function(img){
    img.addEventListener('error',function(){this.style.display='none';});
  });
  /* bg preview hover — show/hide X button */
  container.querySelectorAll('.bg-prev-x').forEach(function(x){
    const parent=x.parentElement;
    if(parent){
      parent.addEventListener('mouseenter',function(){x.style.display='flex';});
      parent.addEventListener('mouseleave',function(){x.style.display='none';});
    }
  });
}
export function switchStorySub(tab){
  /* "intro" 는 설정 → 버전·업데이트 의 "개발 이야기" 아코디언으로 이동되어 더 이상 view-story 에 없음. */
  const panels={tutorial:'storySubTutorial',feedback:'storySubFeedback'};
  const tabs={tutorial:'storySubTab2',feedback:'storySubTab4'};
  Object.keys(panels).forEach(function(k){
    const p=document.getElementById(panels[k]), t=document.getElementById(tabs[k]);
    if(p){p.style.display=(k===tab)?'block':'none';p.classList.toggle('active',k===tab);}
    if(t)t.classList.toggle('active',k===tab);
  });
  if(tab==='tutorial') renderStoryTutorialGrid();
  if(tab==='feedback') renderFeedbackPage();
}

/* 오렌지팜 하위 인덱스 탭 전환.
   탭: 오렌지몰(mall) / 함께하는 보건일지(together) / Q&A(qna) / 업데이트 자료실(download) / 개발이야기(intro).
   모든 탭이 in-app 패널 전환. 사이트 이동은 각 패널 내부 버튼 클릭 시에만. */
export function switchOrangeSub(tab){
  const panels={mall:'orangeSubMall',together:'orangeSubTogether',qna:'orangeSubQna',download:'orangeSubDownload'};
  const tabs={mall:'orangeSubTab1',together:'orangeSubTabTutorial',qna:'orangeSubTabQna',download:'orangeSubTabDownload'};
  /* 패널은 in-app 탭만 토글 */
  Object.keys(panels).forEach(function(k){
    const p=document.getElementById(panels[k]);
    if(p){p.style.display=(k===tab)?'block':'none';p.classList.toggle('active',k===tab);}
  });
  /* 탭 active 상태는 모든 탭에 적용 */
  Object.keys(tabs).forEach(function(k){
    const t=document.getElementById(tabs[k]);
    if(t)t.classList.toggle('active',k===tab);
  });
}

/* ── 의견 & 제보 페이지 ── */
S._fbData=JSON.parse(localStorage.getItem('ec_feedback')||'[]');
function _fbSave(){
  localStorage.setItem('ec_feedback',JSON.stringify(S._fbData));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','feedback_data',S._fbData);
}
function renderFeedbackPage(){
  const wrap=document.getElementById('feedbackContent');if(!wrap)return;
  const isLight=document.body.classList.contains('light');
  const cardBg=isLight?'#ffffff':'var(--card)';
  const subtleBg=isLight?'#f8fafc':'rgba(255,255,255,0.02)';
  const _fbTab=_fbSelectedType||'feature';
  const tabNames={feature:'기능 제안',improve:'개선 요청',bug:'버그 신고'};
  let h='<div style="padding:8px 0">';
  h+='<div style="display:flex;justify-content:center;margin-bottom:14px"><div class="tr-sub-tab-wrap">';
  [{id:'feature',label:'✨ 기능 제안'},{id:'improve',label:'🔧 개선 요청'},{id:'bug',label:'🐛 버그 신고'}].forEach(function(t){
    h+='<button class="tr-sub-tab" id="fbTab_'+t.id+'" data-action="fbSwitchTab" data-arg="'+t.id+'" style="'+(_fbTab===t.id?'color:#fff;background:linear-gradient(135deg,#06b6d4,#0891b2);box-shadow:0 2px 10px rgba(6,182,212,0.3)':'')+'">'+t.label+'</button>';
  });
  h+='</div></div>';
  h+='<div style="display:flex;gap:16px;height:calc(100vh - 200px)">';
  h+='<div style="width:340px;flex-shrink:0;overflow-y:auto;scrollbar-width:thin">';
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:4px">💬 의견을 들려주세요</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.6">보내주신 의견은 업데이트에 적극 반영됩니다.</div>';
  h+='<div style="background:'+cardBg+';border:1px solid var(--bdr);border-radius:14px;padding:16px">'
    +'<div style="margin-bottom:10px"><label style="font-size:11px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">제목</label>'
    +'<input class="form-input" id="fbTitle" placeholder="간단히 요약해 주세요" style="font-size:12px;width:100%;border-radius:8px;padding:8px 12px"></div>'
    +'<div><label style="font-size:11px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">상세 내용</label>'
    +'<textarea id="fbDesc" placeholder="자세히 설명해 주시면 더 빠르게 반영할 수 있어요" style="width:100%;min-height:120px;border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;font-size:12px;font-family:var(--f);color:var(--t1);background:var(--bg);resize:vertical;line-height:1.7;outline:none;box-sizing:border-box" data-focus-border="var(--cyan)" data-blur-border="var(--bdr)"></textarea></div>'
    +'<button data-action="fbSubmit" style="width:100%;margin-top:12px;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f);transition:all .2s" data-hover-in="transform:translateY(-1px)" data-hover-out="transform:none">보내기</button>'
    +'</div>';
  h+='</div>';
  h+='<div style="flex:1;min-width:0;overflow-y:auto;scrollbar-width:thin;border-left:1px solid var(--bdr);padding-left:16px">';
  const tabItems=S._fbData.filter(function(fb){return fb.type===_fbTab;});
  h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px">'+tabNames[_fbTab]+' <span style="color:var(--t3);font-weight:600">'+tabItems.length+'건</span></div>';
  if(tabItems.length){
    tabItems.slice().reverse().forEach(function(fb){
      const origIdx=S._fbData.indexOf(fb);
      const likes=fb.likes||0;
      h+='<div style="background:'+subtleBg+';border:1px solid var(--bdr);border-radius:10px;padding:12px 14px;margin-bottom:6px;transition:all .15s" data-hover-in="borderColor:rgba(6,182,212,0.3)" data-hover-out="borderColor:var(--bdr)">'
        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        +'<span style="font-size:11px;font-weight:700;color:var(--t1)">'+escHtml(fb.title)+'</span>'
        +'<span style="font-size:9px;color:var(--t3);margin-left:auto">'+escHtml(fb.date)+'</span>'
        +'</div>'
        +'<div style="font-size:11px;color:var(--t2);line-height:1.5;white-space:pre-wrap;margin-bottom:6px">'+escHtml(fb.desc)+'</div>'
        +'<button data-action="fbLike" data-arg="'+origIdx+'" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--bdr);border-radius:14px;background:'+(fb._liked?'rgba(6,182,212,0.1)':'transparent')+';cursor:pointer;transition:all .15s;font-family:var(--f)" data-hover-in="borderColor:var(--cyan)" data-hover-out="borderColor:var(--bdr)">'
        +'<span style="font-size:12px">👍</span>'
        +'<span style="font-size:10px;font-weight:700;color:'+(fb._liked?'var(--cyan)':'var(--t3)')+'">'+likes+'</span>'
        +'</button>'
        +'</div>';
    });
  } else {
    h+='<div style="text-align:center;padding:40px 0;color:var(--t3)">'
      +'<div style="font-size:36px;margin-bottom:8px;opacity:0.4">📮</div>'
      +'<div style="font-size:12px;font-weight:600">아직 올라온 의견이 없습니다</div>'
      +'<div style="font-size:10px;margin-top:4px">왼쪽에서 첫 번째 의견을 작성해 보세요</div></div>';
  }
  h+='</div>';
  h+='</div>';
  h+='</div>';
  wrap.innerHTML=h;
  _bindDelegatedEvents(wrap);
  _bindInputEvents(wrap);
}
function _fbLike(idx){
  if(!S._fbData[idx])return;
  if(S._fbData[idx]._liked)return;
  S._fbData[idx].likes=(S._fbData[idx].likes||0)+1;
  S._fbData[idx]._liked=true;
  _fbSave();
  renderFeedbackPage();
}
function _fbSwitchTab(type){
  _fbSelectedType=type;
  renderFeedbackPage();
}
let _fbSelectedType='feature';
function _fbSubmit(){
  if(!_fbSelectedType){bus.emit('toast:show',{text:'카테고리를 선택해 주세요'});return;}
  const title=(document.getElementById('fbTitle')||{}).value||'';
  const desc=(document.getElementById('fbDesc')||{}).value||'';
  if(!title.trim()){bus.emit('toast:show',{text:'제목을 입력해 주세요'});return;}
  S._fbData.push({type:_fbSelectedType,title:title.trim(),desc:desc.trim(),date:toDateStr(new Date()),likes:0});
  _fbSave();
  bus.emit('toast:show',{text:'의견이 저장되었습니다. 감사합니다!'});
  renderFeedbackPage();
}

/* ── 튜토리얼 영상 4x10 그리드 ── */
function _ytThumb(url){
  if(!url)return '';
  const m=url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m?'https://img.youtube.com/vi/'+m[1]+'/mqdefault.jpg':'';
}
function renderStoryTutorialGrid(){
  const wrap=document.getElementById('storyTutorialGrid');if(!wrap)return;
  const slots=getBannerTutorials();
  const minSlots=40;
  const total=Math.max(minSlots, slots.length);
  let h='';
  for(let i=0;i<total;i++){
    const s=slots[i]||null;
    if(s&&s.url){
      const thumb=_ytThumb(s.url);
      h+='<div data-tutorial-url="'+escHtml(s.url)+'" style="border:1px solid var(--bdr);border-radius:8px;overflow:hidden;cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s" data-hover-in="borderColor:var(--cyan);boxShadow:0 4px 12px rgba(6,182,212,0.15)" data-hover-out="borderColor:var(--bdr);boxShadow:none">'
        +(thumb
          ?'<div style="height:100px;background:var(--bg2);position:relative;overflow:hidden"><img src="'+escHtml(thumb)+'" style="width:100%;height:100%;object-fit:cover" loading="lazy"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25)"><div style="width:36px;height:36px;border-radius:50%;background:rgba(255,0,0,0.85);display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-size:16px;margin-left:2px">&#9654;</span></div></div></div>'
          :'<div style="height:100px;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:36px">▶️</div>')
        +'<div style="padding:8px;font-size:11px;font-weight:600">'+escHtml(s.title||'영상 '+(i+1))+'</div>'
        +'<div style="padding:0 8px 8px;font-size:10px;color:var(--t3)">'+escHtml(s.desc||'')+'</div></div>';
    } else if(s&&s.title){
      /* URL 미등록 슬롯 (제목만 있음) */
      h+='<div style="border:1px dashed var(--bdr);border-radius:8px;overflow:hidden;opacity:0.6">'
        +'<div style="height:100px;background:var(--bg2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px">'
        +'<div style="font-size:20px;color:var(--t3)">🎬</div>'
        +'<div style="font-size:10px;color:var(--t3)">'+(i+1)+'</div></div>'
        +'<div style="padding:8px;font-size:11px;font-weight:600">'+escHtml(s.title)+'</div>'
        +'<div style="padding:0 8px 8px;font-size:10px;color:var(--t3)">'+escHtml(s.desc||'준비 중입니다')+'</div></div>';
    } else {
      h+='<div style="border:1px dashed var(--bdr);border-radius:8px;overflow:hidden;opacity:0.4">'
        +'<div style="height:100px;background:var(--bg2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px">'
        +'<div style="font-size:20px;color:var(--t3)">🎬</div>'
        +'<div style="font-size:10px;color:var(--t3)">'+(i+1)+'</div></div>'
        +'<div style="padding:8px;font-size:10px;color:var(--t3);text-align:center">나중에 삽입됩니다</div></div>';
    }
  }
  wrap.innerHTML=h;
  _bindDelegatedEvents(wrap);
  /* 튜토리얼 카드 클릭 → URL 열기 */
  wrap.addEventListener('click',function(e){
    const card=e.target.closest('[data-tutorial-url]');
    if(card&&window.electronAPI&&window.electronAPI.openExternal){
      window.electronAPI.openExternal(card.getAttribute('data-tutorial-url'));
    }
  });
}

const magicCalendarState = magicCalendarManager ? magicCalendarManager.state : { connected:false, calendars:[] };
function magicSetGcalStatus(text, isError){ if(magicCalendarManager)magicCalendarManager.setStatus(text, isError); }
function magicToggleGcalForm(show){ if(magicCalendarManager)magicCalendarManager.toggleForm(show); }
function magicRenderCalendarOptions(items){ if(magicCalendarManager)magicCalendarManager.renderCalendarOptions(items); }
async function magicConnectGoogleCalendar(){ if(magicCalendarManager)return magicCalendarManager.connect(); }
async function magicCreateGoogleCalendarEvent(){ if(magicCalendarManager)return magicCalendarManager.createEvent(); }
let _gsheets=googleSheetsManager?googleSheetsManager.getItems():JSON.parse(localStorage.getItem('ec_gsheets')||'[]');
function saveGoogleSheets(){ if(googleSheetsManager){ _gsheets=googleSheetsManager.getItems(); return; } localStorage.setItem('ec_gsheets',JSON.stringify(_gsheets)); }
function addGoogleSheet(){
  const input=document.getElementById('gsheetUrlInput');
  if(!input||!input.value.trim())return;
  const title=prompt('시트 이름을 입력하세요','시트 '+ ((googleSheetsManager?googleSheetsManager.getItems().length:_gsheets.length)+1));
  if(title===null)return;
  const result=googleSheetsManager?googleSheetsManager.addSheet(input.value.trim(),title||''):null;
  if(result&&result.success===false){alert(result.error);return;}
  _gsheets=googleSheetsManager?googleSheetsManager.getItems():_gsheets;
  input.value='';
  loadGoogleSheets();
}
function loadGoogleSheets(){
  const list=document.getElementById('gsheetList');
  if(!list)return;
  if(googleSheetsManager){
    _gsheets=googleSheetsManager.getItems();
    googleSheetsManager.render(list);
    return;
  }
}
function resizeGSheet(idx,val){
  if(googleSheetsManager){
    googleSheetsManager.resizeSheet(idx,val);
    _gsheets=googleSheetsManager.getItems();
  }
  const label=document.getElementById('gshH'+idx);
  if(label)label.textContent=val+'px';
  const iframes=document.querySelectorAll('#gsheetList iframe');
  if(iframes[idx])iframes[idx].style.height=val+'px';
}

export function openSettings(){
  const m=document.getElementById('settingsModal');
  m.classList.add('show');
  S.settingsLocked='version';
  renderSettingsPanel('version');
  document.querySelectorAll('.settings-sidebar-item').forEach(function(el){el.classList.toggle('active',el.dataset.cat==='version');});
  const _pi=document.getElementById('settingsPeopleItem');
  if(_pi&&typeof isKinder==='function'&&isKinder())_pi.textContent='👥 원아/교직원 데이터 관리';
  /* 사용자 정책 (2026-05-22): 모달 backdrop 영역(모달 컨텐츠 외부) 에서 휠 발생 시 일반일지(#dailyTableWrap) 로 위임.
   *  사용자가 설정창 띄운 채 일반일지 위 아래 내용을 볼 수 있도록. 모달 컨텐츠 내부 휠은 기본 동작 유지. 한 번만 등록 (플래그 보호). */
  if(!m._wheelDelegateBound){
    m._wheelDelegateBound = true;
    m.addEventListener('wheel', function(e){
      const content = m.querySelector('.modal-content');
      if(content && content.contains(e.target)) return;
      const wrap = document.getElementById('dailyTableWrap');
      if(wrap){
        wrap.scrollTop += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }
}
export function closeSettings(){
  const m=document.getElementById('settingsModal');if(!m)return;
  const c=m.querySelector('.modal-content');
  /* theme-transitioning이 활성이면 제거 (닫기 애니메이션과 충돌 방지) */
  document.body.classList.remove('theme-transitioning');
  m.style.setProperty('animation','none','important');
  if(c)c.style.setProperty('animation','none','important');
  requestAnimationFrame(function(){
    m.style.setProperty('transition','opacity 0.3s ease');
    m.style.setProperty('opacity','0');
    if(c){c.style.setProperty('transition','opacity 0.3s ease, transform 0.3s cubic-bezier(.4,0,.2,1)');c.style.setProperty('opacity','0');c.style.setProperty('transform','scale(0.95) translateY(8px)');}
    setTimeout(function(){
      m.classList.remove('show');
      m.removeAttribute('style');
      if(c)c.style.cssText='width:900px;max-width:95vw;padding:0;overflow:hidden';
      S.settingsLocked=null;
      bus.emit('kiosk:sidebar-refresh');
    },320);
  });
}
function _settingsUpdateOverlay(cat){
  const ov=document.getElementById('settingsModal');if(!ov)return;
  if(cat==='background'){ov.style.transition='background 0.4s ease';ov.style.background='transparent';}
  else{ov.style.transition='background 0.4s ease';ov.style.background='';}
}
export function switchSettingsCat(cat,el){S.settingsLocked=cat;document.querySelectorAll('.settings-sidebar-item').forEach(function(s){s.classList.toggle('active',s===el);});_settingsUpdateOverlay(cat);renderSettingsPanel(cat);const p=document.getElementById('settingsPanel');if(p){p.style.transition='none';p.style.opacity='0';p.style.transform='translateX(12px)';requestAnimationFrame(function(){requestAnimationFrame(function(){p.style.transition='opacity 0.22s ease,transform 0.22s ease';p.style.opacity='1';p.style.transform='translateX(0)';setTimeout(function(){p.style.transition='';},250);});});}}
export function hoverSettingsCat(cat,el){if(S.settingsLocked)return;_settingsUpdateOverlay(cat);renderSettingsPanel(cat);document.querySelectorAll('.settings-sidebar-item').forEach(function(s){s.classList.toggle('active',s===el);});}

/* ═══ SETTINGS ACCORDION ═══ */
let _accCloseListener=null;
function closeAllAccordions(){
  document.querySelectorAll('.set-accordion.open').forEach(function(el){el.classList.remove('open');});
  document.querySelectorAll('.set-accordion-body.open').forEach(function(el){el.classList.remove('open');});
  if(_accCloseListener){document.removeEventListener('click',_accCloseListener);_accCloseListener=null;}
}
export function openAccordion(headerEl){
  const body=headerEl.nextElementSibling;
  /* 토글: 이미 열려있으면 닫기 */
  if(headerEl.classList.contains('open')){closeAllAccordions();return;}
  closeAllAccordions();
  headerEl.classList.add('open');
  if(body&&body.classList.contains('set-accordion-body'))body.classList.add('open');
  _accCloseListener=function(e){
    /* 포털로 렌더된 팝업(달력/모달/이모지 선택기) 내부 클릭은 아코디언 닫기 대상 제외.
       이전 버그: 학기 정보 달력 오버레이(#setSemCalOv) 에서 날짜 클릭/외부 클릭 시
       아코디언까지 닫히던 문제. */
    if(e.target && e.target.closest){
      if(e.target.closest('#setSemCalOv')) return;
      if(e.target.closest('.modal-overlay')) return;
      if(e.target.closest('#emojiPickerOverlay')) return;
    }
    if(!headerEl.contains(e.target)&&!(body&&body.contains(e.target))){closeAllAccordions();}
  };
  setTimeout(function(){document.addEventListener('click',_accCloseListener);},10);
}

/* ═══ renderSettingsPanel — DISPATCHER ═══ */
export function renderSettingsPanel(cat){
  const p=document.getElementById('settingsPanel');if(!p)return;
  /* 설정 패널 전역 미니 팝업 툴팁 (2026-06-08) — 1회 위임 바인딩.
   * 안쪽 모든 [data-tooltip]·[title] 요소에 증상 화면과 동일한 미니 팝업(showHeaderTooltip)을 띄움.
   * 네이티브 title 은 OS 기본 툴팁이 함께 뜨지 않도록 data-tooltip 으로 옮긴 뒤 제거한다.
   * → 의료기관 캐싱·약품 숨김/추가 연필·커스텀 백업 등 설정 내 모든 버튼이 개별 수정 없이 통일됨. */
  if(!p._tipDelegated){
    p._tipDelegated=true;
    p.addEventListener('mouseover',function(e){
      const el=e.target.closest('[data-tooltip],[title]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      let txt=el.getAttribute('data-tooltip');
      if(txt==null){ txt=el.getAttribute('title'); if(!txt)return; el.setAttribute('data-tooltip',txt); el.removeAttribute('title'); }
      if(!txt)return;
      try{ showHeaderTooltip(e, txt, false, true); }catch(_){}
    });
    p.addEventListener('mouseout',function(e){
      const el=e.target.closest('[data-tooltip]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      try{ hideHeaderTooltip(); }catch(_){}
    });
  }
  const user=JSON.parse(localStorage.getItem('ec_user')||'{}');
  let html='';

  if(cat==='version'){
    html=_renderVersionTab();
  } else if(cat==='cdkey'){
    html=_renderCdkeyTab();
  } else if(cat==='copyright'){
    html=_renderCopyrightTab();
  } else if(cat==='account'){
    html=_renderAccountTab(user);
  } else if(cat==='topmenu'){
    html=_renderTopmenuTabInline();
  } else if(cat==='datasync'){
    html=_renderDatasyncTabInline();
  } else if(cat==='kiosk'){
    html=typeof S.kioskSettingsHtml==='function'?S.kioskSettingsHtml():'';
  } else if(cat==='privacy'){
    html=_renderPrivacyTab();
  } else if(cat==='diary'){
    html=_renderDiaryTab();
  } else if(cat==='people'){
    html=_renderPeopleTab();
  } else if(cat==='retention'){
    html=_renderRetentionTab();
  } else if(cat==='custombackup'){
    html=_renderCustomBackupTab();
  } else if(cat==='import'){
    html=_renderImportTab();
  } else if(cat==='background'){
    html=_renderBackgroundTabInline('bg');
  } else if(cat==='glass'){
    html=_renderBackgroundTabInline('glass');
  } else if(cat==='headermsg'){
    html=_renderHeaderMsgSection();
  } else if(cat==='footer'){
    html=_renderBackgroundTabInline('footer');
  } else if(cat==='fontsize'){
    html=_renderBackgroundTabInline('fontsize');
  } else if(cat==='update'){
    /* 통합됨 — 버전 탭으로 리다이렉트 (외부 링크/스테일 핸들러 호환) */
    html=_renderVersionTab();
  } else if(cat==='help'){
    html=_renderHelpTab();
  } else if(cat==='themeinfo'){
    html=_renderThemeInfoTab();
  } else if(cat==='apikeys'){
    html=_renderApiKeysTab();
  } else if(cat==='zoomscale'){
    html=_renderZoomScaleTabInline();
  } else if(cat==='sidebarpos'){
    html=renderSidebarPosPanel();
  } else if(cat==='mealacad'){
    html=renderMealAcadPanel();
  } else if(cat==='schoolyear'){
    html=renderSchoolYearPanel();
  }

  p.innerHTML=html;
  _bindDelegatedEvents(p);
  _bindInputEvents(p);
  /* 회전문구 슬롯 눈알 입력 동기화 */
  if(cat==='headermsg'||cat==='footer'||cat==='background')_msgRowsBindEyeSync(p);
  /* post-render hooks */
  if(cat==='cdkey')setTimeout(_bindCdkeyTab,0);
  if(cat==='account')setTimeout(_bindAccountTab,0);
  if(cat==='help')setTimeout(_bindHelpTab,0);
  if(cat==='update'||cat==='version')setTimeout(_bindUpdateTab,0);
  if(cat==='people')setTimeout(function(){
    /* 아코디언 + 템플릿 다운로드 + 업로드 영역 이벤트 바인딩 */
    document.querySelectorAll('#settingsPanel [data-action="accordion"]').forEach(function(el){
      if(el._accBound)return;el._accBound=true;
      el.addEventListener('click',function(){openAccordion(this);});
    });
    const dlStaff=document.querySelector('#settingsPanel [data-action="dl-staff-template"]');
    if(dlStaff&&!dlStaff._bound){dlStaff._bound=true;dlStaff.addEventListener('click',function(){if(typeof downloadOptimizedStaffTemplate==='function')downloadOptimizedStaffTemplate();});}
    const dlStudent=document.querySelector('#settingsPanel [data-action="dl-student-template"]');
    if(dlStudent&&!dlStudent._bound){dlStudent._bound=true;dlStudent.addEventListener('click',function(){if(typeof downloadOptimizedStudentTemplate==='function')downloadOptimizedStudentTemplate();});}
    const dlCare=document.querySelector('#settingsPanel [data-action="dl-care-template"]');
    if(dlCare&&!dlCare._bound){dlCare._bound=true;dlCare.addEventListener('click',function(){if(typeof downloadOptimizedCareTemplate==='function')downloadOptimizedCareTemplate();});}
  },0);
  if(cat==='datasync')setTimeout(function(){
    /* 동료와 협업 아코디언 — 직접 바인딩 (delegation fallback) */
    document.querySelectorAll('#settingsPanel [data-action="toggleAccordion"]').forEach(function(el){
      if(el._accBound2)return;el._accBound2=true;
      el.addEventListener('click',function(ev){
        ev.stopPropagation();
        const b=el.nextElementSibling;if(!b)return;
        const cs=window.getComputedStyle(b);
        const hidden=(b.style.display==='none')||(cs.display==='none');
        b.style.display=hidden?'block':'none';
        const arrow=el.querySelector('.acc-arrow');
        if(arrow)arrow.textContent=hidden?'\u25BC':'\u25B6';
      });
    });
  },0);
  if(cat==='diary'){_bindDiaryTabEvents();loadTreatmentTable();loadMedicationTable();setTimeout(function(){_setSymInit();_setMedInitInput();_setMedRenderCards();},0);}
  if(cat==='care')setCareFileName(window.careSelectedFileName||'');
  if(cat==='people')setTimeout(function(){initPeopleUploadPaste();},0);
  if(cat==='import'){_bindImportTabEvents();setTimeout(function(){_loadAmbiguousStandalone();},300);}
  if(cat==='retention'){_bindRetentionTabEvents();setTimeout(function(){_driveSyncInitAccountInfo();},0);}
  if(cat==='custombackup'){_bindCustomBackupTabEvents();}
  if(cat==='topmenu')setTimeout(function(){initTopMenuDnD();},0);
  if(cat==='zoomscale')setTimeout(function(){_bindZoomScaleTab();},0);
  if(cat==='sidebarpos')setTimeout(bindSidebarPosPanel,0);
  if(cat==='mealacad')setTimeout(bindMealAcadPanel,0);
  if(cat==='schoolyear')setTimeout(bindSchoolYearPanel,0);
  if(cat==='kiosk')_bindKioskCmsEvents(p);
  if(cat==='themeinfo')_bindThemeInfoEvents(p);
}

/* ═══ INLINE SMALL TABS ═══ */
/* 상단 메뉴 캐노니컬 정의 — 설정 패널·loadTabOrder 양쪽이 공유 (단일 소스) */
const TOPMENU_DEFAULT_TABS=[
  {name:'🏠 대시보드',color:'#06b6d4',view:'home'},
  {name:'📋 보건일지',color:'#3b82f6',view:'daily'},
  {name:'📈 방문 통계',color:'#f97316',view:'dashboard'},
  {name:'<img src="src/orangefarm/orangefarm_logo.png" style="height:14px;width:auto;object-fit:contain;vertical-align:-3px;display:inline-block">',color:'#fb923c',view:'orange'},
  {name:'📒 매직 스테이션',color:'#22c55e',view:'magic'}
];
/* localStorage 의 저장된 순서를 우선하되 누락된 default 뷰는 끝에 보강 + 오렌지팜은 항상 마지막.
 * 설정 패널 DnD 와 실제 nav-link 정렬이 항상 같은 결과를 반환하도록 단일 소스로 통일. */
export function getCanonicalTabOrder(){
  const saved=JSON.parse(localStorage.getItem('ec_tab_order')||'null');
  const defViews=TOPMENU_DEFAULT_TABS.map(function(t){return t.view;});
  let order;
  if(saved && saved.length){
    order=saved.filter(function(v){return defViews.indexOf(v)!==-1;});
    defViews.forEach(function(v){ if(order.indexOf(v)===-1) order.push(v); });
  } else {
    order=defViews.slice();
  }
  order=order.filter(function(v){return v!=='orange';});
  order.push('orange');
  return order;
}
function _renderTopmenuTabInline(){
  let html='<div class="settings-panel-title">📑 상단 메뉴 설정</div>';
  html+='<div class="settings-panel-desc">버튼을 드래그하여 상단 메뉴 순서를 원하는 대로 변경할 수 있습니다.</div>';
  const defaultTabs=TOPMENU_DEFAULT_TABS;
  const topVis=getTopMenuVisibility();
  const order=getCanonicalTabOrder();
  const tabs=order.map(function(v){return defaultTabs.find(function(t){return t.view===v;});}).filter(Boolean);
  html+='<div class="cc" style="padding:14px"><div style="font-size:10px;color:var(--t3);margin-bottom:8px">☰ 클릭 &amp; 드래그하여 순서 변경 <span style="color:var(--t3);font-weight:500">(오렌지팜은 맨 오른쪽 고정)</span></div><div id="dragTabList" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:4px">';
  tabs.forEach(function(t,i){
    const isFixed=t.view==='orange';
    /* 켜고 끌 수 있는 건 대시보드(home)만 (사용자 요청 2026-05-28). 나머지 탭은 눈알 없음 — 항상 표시. */
    const isToggleable = (t.view==='home');
    const isVisible = topVis[t.view] !== false;
    const cursor=isFixed?'default':'grab';
    const handle=isFixed?'':'<span style="font-size:9px;color:var(--t3);cursor:grab">☰</span>';
    const lockBadge=isFixed?'<span title="고정" style="font-size:9px;color:var(--t3);margin-left:2px">🔒</span>':'';
    /* 눈알 토글 — 일반 일지 열필드 설정의 눈알 SVG 와 동일 (표시=눈, 숨김=빗금눈). 클릭 시 toggleTopMenuVisibility(view). */
    const _eyeSvg = isVisible
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"></path><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 3.5 20.5 20.5"></path><path d="M9.8 6.8A10.8 10.8 0 0 1 12 6.5c4 0 7.3 1.9 9.5 5a14.7 14.7 0 0 1-3.2 3.4"></path><path d="M6.2 9A14.8 14.8 0 0 0 2.5 12c2.2 3.1 5.5 5 9.5 5 1 0 1.9-.1 2.7-.4"></path></svg>';
    const eyeBtn = isToggleable
      ? '<span data-tm-eye="'+t.view+'" title="'+(isVisible?'숨기기':'표시하기')+'" style="cursor:pointer;margin-left:3px;line-height:1;user-select:none;display:inline-flex;align-items:center;color:'+(isVisible?'var(--t3)':'#dc2626')+'">'+_eyeSvg+'</span>'
      : '';
    /* 가로 폭 축소 — 항목 늘어남 대비. padding 4px 7px → 3px 6px, gap 3px → 2px. */
    html+='<div class="drag-tab-item gy-layout-item" data-view="'+t.view+'" data-tab-color="'+t.color+'"'+(isFixed?' data-fixed="1"':'')+' style="display:flex;align-items:center;gap:2px;padding:3px 6px;border:1px solid var(--bdr);border-radius:6px;background:var(--card);opacity:'+(isVisible?'0.7':'0.35')+';cursor:'+cursor+';user-select:none;-webkit-user-drag:none;transition:all .2s ease;color:var(--t3);flex:1;min-width:0;justify-content:center" data-hover-in="opacity:1;color:'+t.color+';borderColor:color-mix(in srgb,'+t.color+' 35%,transparent);background:color-mix(in srgb,'+t.color+' 12%,var(--card));boxShadow:0 2px 8px rgba(0,0,0,0.12);transform:translateY(-1px)" data-hover-out="opacity:'+(isVisible?'0.7':'0.35')+';color:var(--t3);borderColor:var(--bdr);background:var(--card);boxShadow:none;transform:none">'
      +handle
      +'<span style="font-size:10px;font-weight:600;white-space:nowrap">'+t.name+'</span>'
      +eyeBtn
      +lockBadge
      +'</div>';
  });
  html+='</div></div>';
  return html;
}

/* ═══ 화면 배율(글자크기) 설정 — Radial Gauge Premium ═══ */
function _renderZoomScaleTabInline(){
  const z = window.ecZoom || { get:function(){return 1.0;}, enabled:function(){return true;}, MIN:1.0, MAX:1.6 };
  const cur = z.get();
  const on  = z.enabled();
  const pct = Math.round(cur*100);
  const C   = 2 * Math.PI * 60;                                /* 원주 ≈ 376.99 */
  const off = (C * (1 - (pct-100)/60)).toFixed(2);             /* 100→C, 160→0 (상한 160%) */

  let html = '<div class="settings-panel-title">🔍 배율(글자크기) 설정</div>';
  html += '<div class="settings-panel-desc">화면 전체(헤더·메인·하단·팝업)를 100% ~ 160% 범위에서 동일 비율로 확대합니다. 확대 후 화면 밖 영역은 좌우·상하 스크롤로 이동합니다.</div>';

  /* ── 메인 카드 ── */
  html += '<div id="zoomCard" class="cc" style="padding:24px;margin-bottom:14px;background:linear-gradient(135deg,#fafbff 0%,#fff 100%);border:1px solid #e8eaf6">';

  /* 헤더 + 토글 */
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">'
    +   '<div>'
    +     '<div style="font-size:14px;font-weight:700;color:#1a1a2e">🔍 화면 배율</div>'
    +     '<div id="zoomEnableHint" style="font-size:11px;color:#8a8aa0;margin-top:2px">'+(on?'100 — 160 % · Ctrl+마우스휠로도 조절':'비활성화 — 항상 100%로 표시')+'</div>'
    +   '</div>'
    +   '<label class="switch" style="position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0">'
    +     '<input type="checkbox" id="zoomEnableToggle" data-no-auto-save '+(on?'checked':'')+' style="opacity:0;width:0;height:0">'
    +     '<span id="zoomEnableSlider" style="position:absolute;cursor:pointer;inset:0;background:'+(on?'linear-gradient(135deg,#a78bfa,#7c3aed)':'#d4d4dc')+';border-radius:24px;transition:.25s;box-shadow:'+(on?'0 2px 8px rgba(124,58,237,0.3)':'inset 0 1px 2px rgba(0,0,0,0.08)')+'">'
    +       '<span id="zoomEnableKnob" style="position:absolute;height:20px;width:20px;left:'+(on?'20':'2')+'px;top:2px;background:#fff;border-radius:50%;transition:.25s cubic-bezier(.34,1.56,.64,1);box-shadow:0 2px 4px rgba(0,0,0,0.15)"></span>'
    +     '</span>'
    +   '</label>'
    + '</div>';

  /* 본문 (게이지 + 컨트롤) */
  html += '<div id="zoomBody" style="'+(on?'':'opacity:0.42;pointer-events:none;filter:saturate(0.3);')+'transition:opacity .25s,filter .25s">';

  /* 원형 게이지 */
  html += '<div style="display:flex;justify-content:center;margin-bottom:16px">'
    +   '<div style="position:relative;width:140px;height:140px">'
    +     '<svg viewBox="0 0 140 140" style="position:absolute;inset:0">'
    +       '<circle cx="70" cy="70" r="60" fill="none" stroke="#eef0f9" stroke-width="10"/>'
    +       '<circle id="zoomGaugeArc" cx="70" cy="70" r="60" fill="none" stroke="url(#zoomGaugeGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="'+C.toFixed(2)+'" stroke-dashoffset="'+off+'" transform="rotate(-90 70 70)" style="transition:stroke-dashoffset .25s ease"/>'
    +       '<defs><linearGradient id="zoomGaugeGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#7c3aed"/></linearGradient></defs>'
    +     '</svg>'
    +     '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">'
    +       '<div id="zoomBigPct" style="font-size:32px;font-weight:800;color:#1a1a2e;font-variant-numeric:tabular-nums;letter-spacing:-1px;line-height:1">'+pct+'</div>'
    +       '<div style="font-size:11px;color:#8a8aa0;margin-top:2px">%</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';

  /* − [presets] + */
  html += '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;align-items:center">'
    +   '<button class="zoom-stepper-btn" data-no-auto-save data-step="-1" aria-label="축소" style="width:36px;height:36px;border-radius:50%;border:1px solid #e8eaf6;background:#fff;color:#7c3aed;font-size:16px;font-weight:300;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:all .15s;display:flex;align-items:center;justify-content:center">−</button>';
  [100,120,140,160].forEach(function(p){
    const active = p===pct;
    html += '<button class="zoom-preset-btn" data-no-auto-save data-pct="'+p+'"'+(active?' data-active="1"':'')+' style="padding:0 14px;height:36px;border-radius:18px;border:1px solid '+(active?'#7c3aed':'#e8eaf6')+';background:'+(active?'linear-gradient(135deg,#a78bfa,#7c3aed)':'#fff')+';color:'+(active?'#fff':'#1a1a2e')+';font-size:11px;font-weight:'+(active?'700':'600')+';cursor:pointer;'+(active?'box-shadow:0 2px 8px rgba(124,58,237,0.3);':'')+'transition:all .15s;font-variant-numeric:tabular-nums">'+p+'</button>';
  });
  html += '<button class="zoom-stepper-btn" data-no-auto-save data-step="1" aria-label="확대" style="width:36px;height:36px;border-radius:50%;border:1px solid #e8eaf6;background:#fff;color:#7c3aed;font-size:16px;font-weight:300;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:all .15s;display:flex;align-items:center;justify-content:center">+</button>';
  html += '</div>';

  html += '</div></div>'; /* /zoomBody /zoomCard */

  /* 안내 */
  html += '<div class="cc" style="padding:11px 14px;background:rgba(124,58,237,0.04);border:1px dashed rgba(124,58,237,0.22);font-size:11px;color:var(--t2);line-height:1.75">'
    + '⌨ <b>Ctrl + 마우스휠</b>로 즉시 확대/축소 · 범위 100% ~ 160% (5% 단위)<br>'
    + '🖱 헤더·메인·팝업 모두 동일 비율로 확대되며, 화면을 벗어난 영역은 좌우·상하 스크롤로 이동'
    + '</div>';

  /* hover/active 효과 */
  html += '<style>'
    + '.zoom-stepper-btn:hover{background:#f5f3ff!important;border-color:#a78bfa!important;box-shadow:0 2px 8px rgba(124,58,237,0.18)!important;transform:scale(1.06)}'
    + '.zoom-stepper-btn:active{transform:scale(0.94)}'
    + '.zoom-preset-btn:not([data-active="1"]):hover{background:#f5f3ff!important;border-color:#a78bfa!important;color:#7c3aed!important}'
    + '.zoom-preset-btn[data-active="1"]:hover{filter:brightness(1.08)}'
    + '</style>';

  return html;
}

function _bindZoomScaleTab(){
  const z = window.ecZoom; if(!z) return;
  const toggle = document.getElementById('zoomEnableToggle');
  const slider = document.getElementById('zoomEnableSlider');
  const knob   = document.getElementById('zoomEnableKnob');
  const big    = document.getElementById('zoomBigPct');
  const arc    = document.getElementById('zoomGaugeArc');
  const body   = document.getElementById('zoomBody');
  const hint   = document.getElementById('zoomEnableHint');
  const C      = 2 * Math.PI * 60;
  function _refreshDisabled(on){
    if(body){ body.style.opacity = on?'1':'0.42'; body.style.pointerEvents = on?'auto':'none'; body.style.filter = on?'none':'saturate(0.3)'; }
    if(slider){
      slider.style.background = on?'linear-gradient(135deg,#a78bfa,#7c3aed)':'#d4d4dc';
      slider.style.boxShadow  = on?'0 2px 8px rgba(124,58,237,0.3)':'inset 0 1px 2px rgba(0,0,0,0.08)';
    }
    if(knob){ knob.style.left = on?'20px':'2px'; }
    if(hint){ hint.textContent = on?'100 — 160 % · Ctrl+마우스휠로도 조절':'비활성화 — 항상 100%로 표시'; }
  }
  function _refreshActive(pct){
    document.querySelectorAll('.zoom-preset-btn').forEach(function(b){
      const p = Number(b.getAttribute('data-pct'));
      const active = p===pct;
      if(active){ b.setAttribute('data-active','1'); }
      else      { b.removeAttribute('data-active'); }
      b.style.borderColor = active?'#7c3aed':'#e8eaf6';
      b.style.background  = active?'linear-gradient(135deg,#a78bfa,#7c3aed)':'#fff';
      b.style.color       = active?'#fff':'#1a1a2e';
      b.style.fontWeight  = active?'700':'600';
      b.style.boxShadow   = active?'0 2px 8px rgba(124,58,237,0.3)':'';
    });
  }
  function _sync(pct){
    if(big) big.textContent = pct;
    if(arc) arc.setAttribute('stroke-dashoffset', (C * (1 - (pct-100)/60)).toFixed(2));
    _refreshActive(pct);
  }
  if(toggle && !toggle._bound){
    toggle._bound = true;
    toggle.addEventListener('change', function(){
      z.setEnabled(this.checked);
      _refreshDisabled(this.checked);
    });
    if(slider) slider.addEventListener('click', function(ev){
      if(ev.target===toggle) return;
      ev.preventDefault(); toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change'));
    });
  }
  document.querySelectorAll('.zoom-preset-btn').forEach(function(b){
    if(b._bound) return; b._bound = true;
    b.addEventListener('click', function(){
      const pct = Number(this.getAttribute('data-pct'));
      z.set(pct/100);
      _sync(pct);
    });
  });
  document.querySelectorAll('.zoom-stepper-btn').forEach(function(b){
    if(b._bound) return; b._bound = true;
    b.addEventListener('click', function(){
      const dir = Number(this.getAttribute('data-step'))||0;
      const cur = Math.round(z.get()*100);
      const next = Math.max(100, Math.min(160, cur + dir*5));
      z.set(next/100);
      _sync(next);
    });
  });
  window.addEventListener('ec:zoom-changed', function(ev){
    const f = (ev.detail && ev.detail.factor) || 1.0;
    _sync(Math.round(f*100));
  });
}

function _renderDatasyncTabInline(){
  const isWeb=!!window.__isWebBrowser;
  const peer=S._collabPeer;
  const peers=Array.isArray(S._collabPeers)?S._collabPeers:[];
  const connected=!!(peer&&peer.name);
  let html='<div class="settings-panel-title" style="display:flex;justify-content:space-between;align-items:center">🤝 동료와 협업</div>';
  html+='<div class="settings-panel-desc">같은 보건실에서 근무하는 동료가 브라우저로 접속하여 일지를 함께 사용할 수 있습니다.</div>';
  /* ── 웹 서버 On/Off 토글 (Electron 전용) ── */
  if(!isWeb){
    html+='<div class="cc" style="padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:14px">'
      +'<div style="flex:1">'
      +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">🟢 웹 서버 구동</div>'
      +'<div id="webServerStatusText" style="font-size:11px;color:var(--t3);line-height:1.5">상태 확인 중...</div>'
      +'</div>'
      +'<label class="switch" style="position:relative;display:inline-block;width:50px;height:26px;flex-shrink:0">'
      +'<input type="checkbox" id="webServerToggle" data-no-auto-save style="opacity:0;width:0;height:0">'
      +'<span id="webServerSlider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#ccc;transition:.25s;border-radius:26px">'
      +'<span style="position:absolute;content:\'\';height:20px;width:20px;left:3px;bottom:3px;background:#fff;transition:.25s;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.15)" id="webServerKnob"></span>'
      +'</span>'
      +'</label>'
      +'</div>';
  }
  /* ── 동료와 협업 개념 안내 (아코디언) ── */
  html+='<div class="cc" style="padding:0;margin-bottom:12px;overflow:hidden">'
    +'<div data-action="toggleAccordion" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:12px 16px;background:var(--bg2);user-select:none">'
    +'<span class="acc-arrow" style="font-size:10px;color:var(--t3)">\u25B6</span>'
    +'<span style="font-size:12px;font-weight:700;color:var(--t1)">📖 <span style="color:#9333ea">[클릭해서 읽어주세요!]</span> 어떻게 작동하나요? — 처음이라면 꼭 읽어주세요.</span>'
    +'</div>'
    +'<div style="display:none;padding:16px 18px;font-size:11.5px;color:var(--t2);line-height:1.8">'
    +'<div style="background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;padding:10px 12px;border-radius:6px;margin-bottom:12px">'
    +'<b style="color:var(--t1)">⚠️ 별도의 서버를 설치·구축하는 것이 아닙니다.</b><br>'
    +'오렌지톡은 <b>이 프로그램 자체를</b> 동료가 잠깐 함께 사용할 수 있도록 통로만 열어 둘 뿐입니다. 오렌지톡을 <b>종료하면 그 통로도 함께 닫힙니다.</b> 별도의 하드웨어, 별도의 서비스 가입, 별도의 IP 부여 — 어느 것도 필요 없고 발생하지도 않습니다.<br><br>'
    +'동료가 접속하더라도 <b>오렌지톡 화면 외에는</b> 이 PC의 그 어떤 폴더·파일·프로그램에도 접근할 수 없습니다. 보건일지 프로그램만 함께 쓰는 개념입니다.'
    +'</div>'
    +'<div style="margin-bottom:12px"><b style="color:var(--t1)">📡 어떻게 동료가 접속하나요?</b><br>'
    +'같은 학교 <b>유선 LAN</b>(같은 허브 또는 같은 공유기에 랜선으로 연결)에 있는 동료가 별도 프로그램 설치 없이, <b>웹브라우저(크롬·엣지·사파리 등)</b>로 위 IP 주소를 입력하면 오렌지톡을 함께 사용할 수 있습니다.</div>'
    +'<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);padding:10px 12px;border-radius:6px;margin-bottom:12px">'
    +'<b style="color:var(--t1)">💡 추천 구성: 보건교사 두 분 이상이라면 "전용 호스트 PC" 한 대를 두세요</b><br>'
    +'선생님 두 분의 컴퓨터 중 한 대를 호스트로 쓰셔도 되지만, 그 선생님이 <b>출장·연가·병가·연수</b> 등으로 학교에 안 계시거나 PC를 끄고 가시면 다른 한 분도 못 쓰게 됩니다. 그래서 <b>남는 저사양 PC 한 대(전용 호스트)</b>를 보건실 한쪽에 두고 늘 켜둔 채 오렌지톡만 띄워 두면, 모든 보건교사가 자신의 PC에서 브라우저로 접속해 함께 쓸 수 있습니다.<br><br>'
    +'· 호스트 PC: 오렌지톡만 실행, 항상 ON<br>'
    +'· 보건교사 A: 자기 PC 브라우저로 호스트 IP 접속<br>'
    +'· 보건교사 B: 자기 PC 브라우저로 호스트 IP 접속<br><br>'
    +'이렇게 <b>3대 구성(호스트 1 + 사용자 N)</b>이 가장 안정적입니다. 한 분이 안 계셔도 다른 분이 그대로 사용할 수 있고, 데이터는 호스트 PC 한 곳에 모입니다.'
    +'</div>'
    +'<div style="margin-bottom:12px"><b style="color:var(--t1)">📍 데이터는 어디에 있나요?</b><br>'
    +'모든 데이터는 <b>호스트 PC 안에서만</b> 오갑니다. 외부 클라우드·외부 서버·인터넷 어디로도 전송되지 않으며, 학교 네트워크 밖으로 한 글자도 나가지 않습니다. 인터넷이 끊겨도 <b>유선 LAN만 살아 있으면</b> 협업이 가능합니다.</div>'
    +'<div style="margin-bottom:12px"><b style="color:var(--t1)">🖥 누가 무엇을 봅니까?</b><br>'
    +'· <b>호스트(이 PC)</b>: 보건일지 본체. 모든 데이터의 원본을 보관합니다.<br>'
    +'· <b>동료(브라우저)</b>: 호스트와 동일한 보건일지를 사용. 학생 검색·기록·수정이 가능하며, 변경 내용은 즉시 호스트 DB에 반영됩니다.</div>'
    +'<div style="margin-bottom:12px"><b style="color:var(--t1)">🔒 방화벽 — 한 번만 허용해 주세요</b><br>'
    +'처음 실행할 때 Windows가 "이 앱이 네트워크 통신을 허용하시겠습니까?" 팝업을 띄웁니다. <b>"허용"</b>을 눌러주시면 그 이후로는 신경 쓸 필요가 없습니다. 같은 유선 LAN 환경에서는 학교 네트워크 정책으로 차단되는 일이 사실상 없습니다.</div>'
    +'<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.18);padding:10px 12px;border-radius:6px">'
    +'<b style="color:var(--t1)">⚠️ 알아두실 점</b><br>'
    +'· 호스트 PC가 켜져 있고 오렌지톡이 실행 중일 때만 접속할 수 있습니다.<br>'
    +'· 호스트와 동료가 다른 네트워크 망에 있으면 연결되지 않습니다.'
    +'</div>'
    +'</div></div>';
  /* 접속 주소 + 포트 상태 통합 카드 (한 표에 주소·포트 가용성·복사 버튼 모두 포함) */
  html+='<div class="cc" style="padding:16px;margin-bottom:12px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">🌐 접속 주소 · 포트 상태</div>'
    +'<div style="font-size:11px;color:var(--t3);line-height:1.7;margin-bottom:12px">'
    +'동료의 컴퓨터·태블릿·스마트폰 브라우저 주소창에 아래 주소를 입력하면 접속할 수 있습니다. 각 주소의 통로(포트) 사용 가능 여부를 함께 표시합니다.'
    +'</div>'
    +'<div id="collabAddressArea" style="padding:8px 0">'
    +'<div style="font-size:10px;color:var(--t3);text-align:center">주소를 불러오는 중...</div>'
    +'</div></div>';
  /* ── 포트 사용 현황 (Phase 3-3) — 통합 표에 흡수, 별도 카드는 도움말만 유지 ── */
  if(!isWeb){
    html+='<div class="cc" style="padding:16px;margin-bottom:12px">'
      +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">🔌 포트 사용 현황 (상세 도움말)</div>'
      +'<div style="font-size:11px;color:var(--t3);line-height:1.6;margin-bottom:10px">학교 인터넷 정책에 따라 어떤 통로(포트)는 막혀있을 수 있어요. 어느 통로(포트)가 열려 있는지는 아래와 같습니다.</div>'
      +'<div id="collabPortScanArea" style="font-size:11px;color:var(--t3)">검사 결과를 불러오는 중...</div>'
      +'<div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">'
      +'<button id="collabPortScanBtn" class="btn btn-sm" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;padding:7px 14px;font-size:11px;font-weight:700;border-radius:6px">🔄 다시 검사하기</button>'
      +'<span id="collabPortScanMeta" style="margin-left:auto;font-size:10px;color:var(--t3);font-family:var(--fm)"></span>'
      +'</div>'
      +'<div id="collabPortScanConclusion" style="margin-top:14px"></div>'
      +'<div style="margin-top:10px;padding:12px 14px;background:rgba(6,182,212,0.04);border:1px dashed rgba(6,182,212,0.25);border-radius:8px;font-size:11.5px;line-height:1.85;color:var(--t2)">'
      +'<div><b style="color:var(--t1)">💡 표가 어렵게 보이세요? 이렇게 이해하시면 됩니다.</b></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:4px"><span style="flex-shrink:0">📌</span><span><span style="color:var(--cyan);font-weight:700">"이 컴퓨터에서 쓸 수 있나요?"</span> — 보건실 컴퓨터(이 PC)에서 그 통로를 우리 프로그램이 쓸 수 있는지 알려줍니다. 다른 프로그램이 그 통로를 이미 점유하고 있다면 ⚠ 표시가 나오며 쓸 수 없습니다.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:4px"><span style="flex-shrink:0">📌</span><span><span style="color:var(--cyan);font-weight:700">"동료 컴퓨터에서 들어올 수 있나요?"</span> — 그 통로를 통해 동료가 접속하는 것을 학교 방화벽 등이 막지 않는지 알려줍니다. ❌ 차단이면 학교 정책상 막혀 있다는 뜻입니다.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:4px"><span style="flex-shrink:0">📌</span><span><span style="color:#a855f7;font-weight:700">✅ / ❌ 결과는 프로그램이 자동으로 검사</span>해서 채웁니다. 사용자가 별도로 뭘 누르거나 알려줄 필요 없어요.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:8px"><span style="flex-shrink:0">🎯</span><span><b>가장 쉬운 사용법:</b> 위 <b>접속 주소</b>를 동료에게 알려주고, 동료가 접속되면 끝입니다. 표는 <b>안 될 때만 참고</b>하시면 됩니다.</span></div>'
      +'</div>'
      +'</div>';
    /* ── 자동 재연결 작동 방식 (Phase 3-4) ── */
    html+='<div class="cc" style="padding:16px;margin-bottom:12px">'
      +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">🔄 자동 재연결 작동 방식</div>'
      +'<div style="font-size:11px;color:var(--t3);line-height:1.6;margin-bottom:10px">동료 선생님과 연결이 갑자기 끊겼을 때 프로그램은 자동으로 연결을 시도합니다.</div>'
      +'<div style="padding:12px 14px;background:rgba(168,85,247,0.05);border:1px solid rgba(168,85,247,0.25);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--t2)">'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:0"><span style="color:#a855f7;font-weight:800;font-family:var(--fm);flex-shrink:0;min-width:18px">1.</span><span>끊김을 감지하면 화면 상에 "🔄 연결이 끊겼습니다. 같은 통로(8080포트)로 자동 재연결 중... (2/5회 시도)" 와 같은 식의 안내가 표시됩니다.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px"><span style="color:#a855f7;font-weight:800;font-family:var(--fm);flex-shrink:0;min-width:18px">2.</span><span>처음에 선택한 통로(예. 8080포트)로 약 20초간 자동으로 다시 시도합니다.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px"><span style="color:#a855f7;font-weight:800;font-family:var(--fm);flex-shrink:0;min-width:18px">3.</span><span>그래도 안 되면 다른 통로(예. 80포트 등)로 자동으로 옮겨갑니다.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px"><span style="color:#a855f7;font-weight:800;font-family:var(--fm);flex-shrink:0;min-width:18px">4.</span><span>끊긴 동안 입력하신 내용은 자동 보관됐다가 복구되면 자동으로 저장됩니다.</span></div>'
      +'<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px"><span style="color:#a855f7;font-weight:800;font-family:var(--fm);flex-shrink:0;min-width:18px">5.</span><span>모두 안 되면 학교 컴퓨터 담당 선생님께 보낼 안내문을 아래를 클릭해서 보내시기 바랍니다.</span></div>'
      +'</div>'
      +'</div>';
    /* ── IT 담당자 안내문 (Phase 4-1) ── */
    html+='<div class="cc" style="padding:16px;margin-bottom:12px">'
      +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">📞 그래도 안 될 때</div>'
      +'<div style="font-size:11px;color:var(--t3);line-height:1.6;margin-bottom:10px">학교 컴퓨터 담당 선생님께 보낼 안내문을 자동으로 만들어드립니다.</div>'
      +'<button id="collabItHelpCopyBtn" class="btn btn-sm" style="padding:8px 14px;font-size:11px;font-weight:700;border-radius:6px;background:var(--bg2);color:var(--t1);border:1px solid var(--bdr);cursor:pointer">📋 학교 컴퓨터 담당자 안내문 복사하기</button>'
      +'<span id="collabItHelpCopiedMsg" style="display:none;margin-left:10px;font-size:11px;color:var(--gs);font-weight:700">✅ 복사되었습니다</span>'
      +'</div>';
  }
  /* 접속 현황 카드는 제거 — 동료 정보는 아래 *웹 동료 접속* 카드 한 곳에 표시. */

  /* 동료 접속 상태 — A안: 모든 접속 동료를 N장 카드로. host/client 라벨 분기. */
  if(connected){
    /* peers 배열이 있으면 그것 사용, 없으면(LAN 단일 협업 등) peer 단일을 1장으로 fallback */
    const list = peers.length ? peers : [{
      _source: peer._source||'lan',
      name: (peer.name||'').replace(/\s*외\s*\d+명$/,''),
      school: peer.school||'',
      position: peer.position||'',
      type: peer.type||'client',
      stuCount: peer.stuCount,
      staffCount: peer.staffCount
    }];
    html+='<div class="cc" style="padding:16px;margin-bottom:12px">';
    html+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">🤝 접속 동료 ('+list.length+'명)</div>';
    html+='<div style="display:flex;flex-direction:column;gap:8px">';
    list.forEach(function(p){
      const isHost=p.type==='host';
      const isWebPeer=p._source==='web';
      const icon=isHost?'🖥':'🌐';
      const label=isHost?'PC 프로그램 (호스트)':'웹 브라우저 접속';
      const nameLine=[p.school,p.position,p.name].filter(Boolean).join(' ')||'접속자';
      /* 호스트=청록, 웹 클라이언트=보라 그라데이션, LAN=초록 */
      const boxCls=isWebPeer&&!isHost?'collab-web-peer-card':'';
      let boxStyle;
      if(isHost){
        boxStyle='padding:14px;background:linear-gradient(135deg,rgba(6,182,212,0.18),rgba(8,145,178,0.10));border:1px solid rgba(6,182,212,0.35);border-radius:12px;box-shadow:0 2px 12px rgba(6,182,212,0.12)';
      } else if(isWebPeer){
        boxStyle='padding:14px;border-radius:12px;position:relative;overflow:hidden;box-shadow:0 2px 12px rgba(139,92,246,0.15)';
      } else {
        boxStyle='padding:12px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:10px';
      }
      const avatarStyle=(isHost||isWebPeer)
        ? 'width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.22);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;animation:collabPulse 2.4s ease-in-out infinite'
        : 'width:36px;height:36px;border-radius:50%;background:rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0';
      const nameColor=(isHost||isWebPeer)?'#fff':'var(--t1)';
      const subColor=(isHost||isWebPeer)?'rgba(255,255,255,0.85)':'var(--t3)';
      const nameShadow=(isHost||isWebPeer)?';text-shadow:0 1px 2px rgba(0,0,0,0.25)':'';
      html+='<div class="'+boxCls+'" style="display:flex;align-items:center;gap:12px;'+boxStyle+'">'
        +'<div style="'+avatarStyle+'">'+icon+'</div>'
        +'<div style="flex:1;position:relative;z-index:1">'
        +'<div style="font-size:10px;font-weight:700;color:'+subColor+';letter-spacing:0.3px'+nameShadow+'">'+label+'</div>'
        +'<div style="font-size:13px;font-weight:700;color:'+nameColor+';margin-top:2px'+nameShadow+'">'+escHtml(nameLine)+'</div>'
        +'</div></div>';
    });
    html+='</div></div>';
  }

  /* 비동기 데이터 로드 */
  setTimeout(function(){
    /* 접속 주소 — 웹 브라우저 모드(서버가 이미 떠 있음)일 때만 직접 감지.
       Electron 모드에서는 _bindWebServerToggle 이 서버 상태 확인 후 주소를 렌더. */
    if(isWeb) _loadCollabAddress(isWeb);
    /* 웹 서버 On/Off 토글 */
    if(!isWeb)_bindWebServerToggle();
  },100);
  return html;
}

/* 웹 서버 On/Off 토글 바인딩 + 상태 표시 */
function _bindWebServerToggle(){
  const toggle=document.getElementById('webServerToggle');
  const slider=document.getElementById('webServerSlider');
  const knob=document.getElementById('webServerKnob');
  const status=document.getElementById('webServerStatusText');
  if(!toggle||!slider||!status)return;
  function _setUI(running){
    toggle.checked=!!running;
    slider.style.background=running?'#22c55e':'#ccc';
    if(knob)knob.style.transform=running?'translateX(24px)':'translateX(0)';
    status.innerHTML=running
      ? '<span style="color:#22c55e;font-weight:700">● 실행 중</span> — 같은 네트워크의 동료가 브라우저로 접속 가능합니다.'
      : '<span style="color:#94a3b8;font-weight:700">● 중지됨</span> — 혼자 쓰는 중. 동료와 협업하려면 토글을 켜세요.';
    /* 접속 주소·세션·포트 검사 — 서버 실행 중일 때만 감지 시도 */
    const addrArea=document.getElementById('collabAddressArea');
    if(running){
      /* 서버가 막 시작됐을 수 있으므로 800ms 뒤 주소·세션·포트 조회 */
      setTimeout(function(){_loadCollabAddress(false);_loadCollabSessions();_loadCollabPortScan();},800);
    } else if(addrArea){
      /* 꺼진 상태 — 자주색 안내 박스만 노출 (주소 없음) */
      addrArea.innerHTML='<div style="font-size:13px;font-weight:700;color:#9333ea;padding:14px 24px;background:rgba(147,51,234,0.08);border:2px solid rgba(147,51,234,0.35);border-radius:12px;display:inline-block;line-height:1.5">웹 서버 구동 시 IP 주소와 포트 번호가 표시됩니다.</div>'
        +'<div style="font-size:12px;color:var(--t2);margin-top:10px;line-height:1.7;max-width:680px">⚠️ <b>접속하는 동료와 호스트 PC 는 반드시 같은 학교 네트워크(같은 유선 LAN 회선·같은 공유기/허브)에</b><br>연결되어 있어야 합니다.<br>서로 다른 와이파이/회선이면 접속되지 않습니다.</div>';
      const sessArea=document.getElementById('collabSessionsArea');
      if(sessArea)sessArea.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">웹 서버가 꺼져 있습니다.</div>';
    }
  }
  /* 초기 상태 조회 */
  if(window.electronAPI&&window.electronAPI.webServerStatus){
    window.electronAPI.webServerStatus().then(function(r){_setUI(r&&r.running);});
  }
  /* 연결 상태 변화 시 세션 카드 자동 새로고침 — Phase 3-2 */
  if(!toggle._connEventsBound){
    toggle._connEventsBound=true;
    var _refreshSess=function(){if(typeof _loadCollabSessions==='function')_loadCollabSessions();};
    window.addEventListener('conn:lost',_refreshSess);
    window.addEventListener('conn:retrying',_refreshSess);
    window.addEventListener('conn:restored',_refreshSess);
    window.addEventListener('conn:exhausted',_refreshSess);
    window.addEventListener('conn:all_failed',_refreshSess);
    window.addEventListener('conn:falling_back',_refreshSess);
  }
  /* "다시 검사하기" 버튼 — Phase 3-3 */
  var _rescanBtn=document.getElementById('collabPortScanBtn');
  if(_rescanBtn && !_rescanBtn._bound){
    _rescanBtn._bound=true;
    _rescanBtn.addEventListener('click',function(){
      if(typeof _loadCollabPortScan==='function')_loadCollabPortScan();
    });
  }
  /* IT 담당자 안내문 복사 — Phase 4-1 */
  var _itHelpBtn=document.getElementById('collabItHelpCopyBtn');
  if(_itHelpBtn && !_itHelpBtn._bound){
    _itHelpBtn._bound=true;
    _itHelpBtn.addEventListener('click',async function(){
      var u=(typeof S!=='undefined'&&S._userProfile)?S._userProfile:{};
      var settings=(typeof S!=='undefined'&&S.settings)?S.settings:{};
      var schoolName=(u.school||settings.schoolName||'우리 학교').toString().trim();
      var teacherName=(u.name||settings.nurse1||'').toString().trim();
      var teacherPos=(u.position||'보건교사').toString().trim();
      /* 진단 정보 — server-info 호출하여 IP, 활성 포트 가져오기 (실패 시 폴백) */
      var info={ips:[],activePorts:[],port:''};
      try{
        var base=window.__isWebBrowser?'':'http://localhost:3000';
        var r=await fetch(base+'/api/server-info',{cache:'no-store'});
        if(r.ok){var j=await r.json();if(j&&j.success)info=j;}
      }catch(_e){}
      var ipStr=(info.ips&&info.ips[0])?info.ips[0]:'(자동 감지 실패)';
      var portsStr=(info.activePorts&&info.activePorts.length)?info.activePorts.join(', '):'80, 8080, 8000, 8888, 9000, 3000';
      var now=new Date();
      var nowStr=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
      var msg=
        '[보건교사 업무 프로그램 — 학교 인터넷 방화벽 협조 요청]\n\n'+
        '안녕하세요, '+(schoolName?schoolName+' ':'')+(teacherPos?teacherPos+' ':'')+(teacherName?teacherName+' ':'')+'입니다.\n\n'+
        '보건실 컴퓨터에서 다른 보건교사 컴퓨터로 보건일지 프로그램을\n'+
        '함께 사용하려고 하는데, 학교 인터넷 방화벽 때문에 연결이\n'+
        '되지 않는 것 같습니다.\n\n'+
        '▪ 사용 프로그램: 오렌지톡 (웹브라우저로 접속하여 사용)\n'+
        '▪ 서버 컴퓨터(보건실 PC) IP: '+ipStr+'\n'+
        '▪ 시도한 통로(포트): '+portsStr+'\n'+
        '▪ 동료 컴퓨터에서 접근이 차단된 상태입니다.\n\n'+
        '요청드립니다:\n'+
        '보건실 컴퓨터('+ipStr+')의 80번 또는 8080번 포트로\n'+
        '같은 학교 내부망의 다른 컴퓨터에서 접근할 수 있도록\n'+
        '방화벽 인바운드 규칙을 허용해 주시면 감사하겠습니다.\n\n'+
        '학생 보건업무에 꼭 필요한 프로그램이라 도움 부탁드립니다.\n\n'+
        '감사합니다.\n\n'+
        '— 진단 시각: '+nowStr;
      try{
        await navigator.clipboard.writeText(msg);
        var msgEl=document.getElementById('collabItHelpCopiedMsg');
        if(msgEl){msgEl.style.display='inline';setTimeout(function(){msgEl.style.display='none';},3000);}
        bus.emit('toast:show',{text:'안내문이 복사되었습니다.'});
      }catch(_e){
        /* execCommand 폴백 */
        try{
          var ta=document.createElement('textarea');
          ta.value=msg;
          ta.style.position='fixed';
          ta.style.left='-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          bus.emit('toast:show',{text:'안내문이 복사되었습니다.'});
        }catch(__e){
          alert('복사 실패. 수동으로 복사해주세요.');
        }
      }
    });
  }
  /* 토글 클릭 */
  toggle.addEventListener('change',function(){
    const wantOn=this.checked;
    status.innerHTML='<span style="color:var(--t3)">처리 중...</span>';
    if(!window.electronAPI)return;
    const action=wantOn?window.electronAPI.webServerStart:window.electronAPI.webServerStop;
    if(!action){_setUI(!wantOn);return;}
    action().then(function(r){
      if(r&&r.success){
        _setUI(wantOn);
        bus.emit('toast:show',{text:wantOn?'웹 서버 시작됨':'웹 서버 중지됨'});
      } else {
        _setUI(!wantOn);
        bus.emit('toast:show',{text:'오류: '+((r&&r.error)||'')});
      }
    }).catch(function(err){
      _setUI(!wantOn);
      bus.emit('toast:show',{text:'오류: '+err.message});
    });
  });
}
/* 접속 주소 렌더 — 서버 실행 중일 때만 호출됨 (OFF 상태는 _bindWebServerToggle 에서 직접 렌더).
   activePorts: server-info 가 반환한 모든 활성 포트 배열 (Phase 1-1) */
function _renderCollabAddressPanel(addr,allAddrs,activePorts){
  var area=document.getElementById('collabAddressArea');
  if(!area)return;
  allAddrs=allAddrs||[];
  activePorts=Array.isArray(activePorts)?activePorts:[];
  var accent={color:'#16a34a',bg:'rgba(22,163,74,0.08)',bd:'rgba(22,163,74,0.35)'};

  /* 모든 IP × 모든 활성 포트 조합 생성 — 사용자가 어떤 주소든 시도해볼 수 있도록.
     포트 번호 가시성을 위해 80 포트도 :80 명시 (사용자 요청). */
  function _buildAddr(ip,p){
    var port=parseInt(p,10)||80;
    return 'http://'+ip+':'+port;
  }
  /* 주 IP 추출 */
  var primaryIp=addr.replace(/^https?:\/\//,'').replace(/:\d+$/,'');
  var ipList=[];
  /* 주 주소를 첫 번째로, 나머지 IP 들 (allAddrs 에서 IP 추출) */
  var seenIps={};
  if(primaryIp){ ipList.push(primaryIp); seenIps[primaryIp]=1; }
  allAddrs.forEach(function(a){
    var ip=String(a).replace(/^https?:\/\//,'').replace(/:\d+$/,'');
    if(ip&&!seenIps[ip]){ ipList.push(ip); seenIps[ip]=1; }
  });
  /* 포트 — 활성 포트 우선, 없으면 주 주소 포트 */
  var portList=activePorts.length?activePorts.slice():[];
  if(!portList.length){
    var pm=addr.match(/:(\d+)$/);
    portList.push(pm?parseInt(pm[1],10):80);
  }
  /* 모든 조합 */
  var addrPairs=[];  /* {url, ip, port, primary} */
  ipList.forEach(function(ip){
    portList.forEach(function(p){
      addrPairs.push({url:_buildAddr(ip,p),ip:ip,port:p,primary:(ip===primaryIp&&String(p)===String(portList[0]))});
    });
  });

  var h='';
  /* 주 주소 — 큰 배지 (가장 추천). 위에 "추천하는 접속 주소" 라벨 표시. */
  h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px;letter-spacing:0.3px">⭐ 추천하는 접속 주소</div>';
  h+='<div style="font-size:22px;font-weight:800;font-family:var(--fm);color:'+accent.color+';padding:14px 24px;background:'+accent.bg+';border-radius:12px;letter-spacing:1px;user-select:all;display:inline-block;border:2px solid '+accent.bd+';line-height:1.5">'+escHtml(addr)+'</div>';

  /* 모든 IP × 포트 조합 — 주소 + 포트 상태 통합 표 */
  if(addrPairs.length){
    h+='<div style="margin-top:14px;padding:12px 14px;background:rgba(0,0,0,0.04);border:1px solid var(--bdrl);border-radius:10px">';
    h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px">🔁 접속 가능한 주소</div>';
    h+='<table style="width:100%;border-collapse:collapse;font-size:11.5px">';
    h+='<thead><tr>'
      +'<th style="padding:6px 8px;background:var(--bg2);text-align:left;font-size:10px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--bdr)">주소</th>'
      +'<th style="padding:6px 4px;background:var(--bg2);text-align:center;font-size:10px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--bdr);width:130px;white-space:nowrap">현재 동료 접속 가능 여부</th>'
      +'<th style="padding:6px 4px;background:var(--bg2);text-align:center;font-size:10px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--bdr);width:120px;white-space:nowrap">클립보드에 복사</th>'
      +'</tr></thead><tbody>';
    addrPairs.forEach(function(pair){
      h+='<tr data-collab-port="'+escHtml(String(pair.port))+'" style="border-bottom:1px solid var(--bdrl)">'
        +'<td style="padding:7px 12px;vertical-align:middle"><code style="font-size:13px;font-family:var(--fm);color:var(--t1);user-select:all">'+escHtml(pair.url)+'</code></td>'
        +'<td class="collab-ext-cell" style="padding:7px 4px;vertical-align:middle;font-size:10.5px;color:var(--t3);text-align:center">검사 중...</td>'
        +'<td style="padding:7px 4px;vertical-align:middle;text-align:center">'
        +'<button class="btn btn-sm collab-copy-row-btn" data-collab-url="'+escHtml(pair.url)+'" data-collab-tip="주소를 클립보드에 복사합니다." style="background:#16a34a;color:#fff;border:none;padding:5px 10px;font-size:10.5px;font-weight:700;border-radius:5px;cursor:pointer;margin-right:4px">📋</button>'
        +'<button class="btn btn-sm collab-copy-invite-btn" data-collab-url="'+escHtml(pair.url)+'" data-collab-tip="동료에게 보낼 메시지 내용이 포함된 주소를 클립보드에 복사합니다." style="background:#8b5cf6;color:#fff;border:none;padding:5px 10px;font-size:10.5px;font-weight:700;border-radius:5px;cursor:pointer">✉️</button>'
        +'</td></tr>';
    });
    h+='</tbody></table></div>';
  }

  /* IP/포트 메타 정보 */
  if(primaryIp){
    h+='<div style="font-size:10px;color:var(--t3);margin-top:8px">기본 IP: <b style="color:var(--t1);font-family:var(--fm)">'+escHtml(primaryIp)+'</b>'+(activePorts.length?(' · 활성 포트: '+activePorts.map(function(p){return '<b style="color:var(--t1);font-family:var(--fm)">'+escHtml(String(p))+'</b>';}).join(', ')):'')+'</div>';
  }

  /* 네트워크 안내 — 글자 크기 확대 + 상세 설명 */
  h+='<div style="font-size:12px;color:var(--t2);margin-top:12px;line-height:1.7;max-width:680px">⚠️ <b>접속하는 동료와 호스트 PC 는 반드시 같은 학교 네트워크(같은 유선 LAN 회선·같은 공유기/허브)에</b><br>연결되어 있어야 합니다.<br>서로 다른 와이파이/회선이면 접속되지 않습니다.</div>';
  area.innerHTML=h;
  _bindCollabCopyButtons(addr);
}
function _loadCollabAddress(isWeb){
  var area=document.getElementById('collabAddressArea');
  if(!area)return;
  /* 활성 포트 우선 — server-info 의 recommendedPort 사용 (Phase 1-1 도입).
     포트 가시성을 위해 80 포트도 :80 명시. */
  function _buildAddr(ip,port){
    var p=parseInt(port,10)||80;
    return 'http://'+ip+':'+p;
  }
  function _fromInfo(info){
    if(!info||!info.success)return null;
    var port=info.recommendedPort || (info.activePorts&&info.activePorts[0]) || info.port;
    var ips=info.ips||[];
    return {
      port:port,
      ips:ips,
      addr:ips[0]?_buildAddr(ips[0],port):('http://localhost:'+(parseInt(port,10)||80)),
      all:ips.map(function(ip){return _buildAddr(ip,port);}),
      activePorts:info.activePorts||[]
    };
  }
  if(isWeb){
    /* 웹 브라우저: 자기 자신이 접속 중인 서버 정보 조회 */
    fetch('/api/server-info',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(info){
      var x=_fromInfo(info);
      if(!x){area.innerHTML='<div style="font-size:11px;color:var(--t3)">주소를 불러올 수 없습니다.</div>';return;}
      _renderCollabAddressPanel(x.addr,x.all,x.activePorts);
    }).catch(function(){ area.innerHTML='<div style="font-size:11px;color:var(--t3)">주소를 불러올 수 없습니다.</div>'; });
    return;
  }
  /* Electron 모드: 서버가 켜져 있을 때만 호출됨 → 실제 실행 중인 포트 감지. 한 번만 시도.
     PREFERRED_PORTS 와 호환 — server-info 가 활성 포트 배열 반환 */
  var _candidatePorts=[3000,80,8080,8000,8888,9000,7330];
  var _done=false;
  function _tryPort(idx){
    if(_done)return;
    if(idx>=_candidatePorts.length)return;
    var port=_candidatePorts[idx];
    fetch('http://localhost:'+port+'/api/server-info',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(info){
      if(_done)return;
      var x=_fromInfo(info);
      if(x){_done=true;_renderCollabAddressPanel(x.addr,x.all,x.activePorts);}
      else _tryPort(idx+1);
    }).catch(function(){ if(!_done)_tryPort(idx+1); });
  }
  _tryPort(0);
}
function _bindCollabCopyButtons(addr){
  /* 초대 메시지 빌드 — 입력 주소(targetAddr) 기준 */
  function _buildInvite(targetAddr){
    var u=(typeof S!=='undefined'&&S._userProfile)?S._userProfile:{};
    var settings=(typeof S!=='undefined'&&S.settings)?S.settings:{};
    var schoolName=(u.school||settings.schoolName||'').toString().trim();
    var teacherName=(u.name||settings.nurse1||'').toString().trim();
    var teacherPos=(u.position||'보건교사').toString().trim();
    var senderLine='';
    if(schoolName||teacherName){
      var bracket='[';
      if(schoolName)bracket+=schoolName+' ';
      if(teacherPos)bracket+=teacherPos+' ';
      if(teacherName)bracket+=teacherName;
      bracket+=']';
      senderLine=bracket+' 선생님이 보건일지를 함께 사용하려고 합니다.\n\n';
    }
    return '📚 오렌지톡 협업 초대\n\n'+
      senderLine+
      '아래 주소를 크롬·엣지 등 웹브라우저에 입력해주세요.\n👉 '+targetAddr+'\n\n'+
      '같은 학교 인터넷망에서만 접속됩니다.\n'+
      '별도 프로그램 설치 없이 브라우저로 바로 사용 가능합니다.';
  }
  /* 주 주소 복사 버튼 */
  var addrBtn=document.getElementById('collabCopyAddrBtn');
  if(addrBtn)addrBtn.addEventListener('click',function(){
    var url=this.dataset.collabUrl||addr;
    navigator.clipboard.writeText(url).then(function(){ bus.emit('toast:show',{text:'주소가 복사되었습니다.'}); });
  });
  /* 행마다 [복사] — 보조 주소 */
  document.querySelectorAll('.collab-copy-row-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var url=this.dataset.collabUrl||addr;
      navigator.clipboard.writeText(url).then(function(){ bus.emit('toast:show',{text:'주소가 복사되었습니다: '+url}); });
    });
  });
  /* 행마다 [초대 메시지 복사] */
  document.querySelectorAll('.collab-copy-invite-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var url=this.dataset.collabUrl||addr;
      navigator.clipboard.writeText(_buildInvite(url)).then(function(){ bus.emit('toast:show',{text:'초대 메시지가 복사되었습니다.'}); });
    });
  });
  /* 마우스 호버 시 미니 팝업 — data-collab-tip 안내 */
  let _tipEl=null;
  function _showTip(anchor,text){
    _hideTip();
    const tip=document.createElement('div');
    tip.style.cssText='position:fixed;z-index:15000;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:6px 10px;font-size:10.5px;font-weight:600;color:var(--t1);white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.2);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s ease, transform .15s ease';
    tip.textContent=text;
    document.body.appendChild(tip);
    const r=anchor.getBoundingClientRect();
    const tw=tip.offsetWidth, th=tip.offsetHeight;
    let left=r.left+r.width/2-tw/2;
    if(left<4)left=4;if(left+tw>window.innerWidth-4)left=window.innerWidth-tw-4;
    let top=r.bottom+6;
    if(top+th>window.innerHeight-4)top=r.top-th-6;
    tip.style.left=left+'px';tip.style.top=top+'px';
    _tipEl=tip;
    requestAnimationFrame(function(){tip.style.opacity='1';tip.style.transform='translateY(0)';});
  }
  function _hideTip(){
    if(_tipEl){const el=_tipEl;_tipEl=null;el.style.opacity='0';el.style.transform='translateY(4px)';setTimeout(function(){if(el.parentNode)el.remove();},150);}
  }
  document.querySelectorAll('[data-collab-tip]').forEach(function(btn){
    btn.addEventListener('mouseenter',function(){_showTip(this,this.getAttribute('data-collab-tip'));});
    btn.addEventListener('mouseleave',_hideTip);
    btn.addEventListener('click',_hideTip);
  });
}

/* ════════════════════════════════════════════════════════════
 *  포트 사용 현황 표 로더 (Phase 3-3)
 *  GET /api/port-scan 호출 → 결과를 표 + 결론 박스로 렌더.
 *  활성 포트 / 점유 / 차단 / 외부 접근 자동 추적 결과를 한 화면에 보여준다.
 * ════════════════════════════════════════════════════════════ */
function _loadCollabPortScan(){
  var area=document.getElementById('collabPortScanArea');
  var concl=document.getElementById('collabPortScanConclusion');
  var meta=document.getElementById('collabPortScanMeta');
  if(!area)return;
  area.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">검사 중...</div>';
  if(concl)concl.innerHTML='';
  /* Electron 환경: localhost:3000 직접 호출. 웹: 자기 origin */
  var base=window.__isWebBrowser?'':'http://localhost:3000';
  fetch(base+'/api/port-scan',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.success){area.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">검사 결과를 불러올 수 없습니다.</div>';return;}
    var results=d.results||[];
    if(meta)meta.textContent='마지막 검사: '+new Date().toLocaleTimeString();
    /* 표 렌더 — 호스트 점유 + 외부 접근 두 컬럼 */
    var h='<table style="width:100%;border-collapse:collapse;font-size:11.5px">';
    h+='<thead><tr>'
      +'<th style="padding:8px 16px;background:var(--bg2);text-align:left;font-size:10.5px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--bdr);width:140px">포트</th>'
      +'<th style="padding:8px 10px;background:var(--bg2);text-align:left;font-size:10.5px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--bdr)">이 컴퓨터에서 쓸 수 있나요?</th>'
      +'<th style="padding:8px 10px;background:var(--bg2);text-align:left;font-size:10.5px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--bdr)">동료 컴퓨터에서 들어올 수 있나요?</th>'
      +'</tr></thead><tbody>';
    var anyExternalPass=false;
    var activePortLabel='';
    results.forEach(function(it){
      var rowBg=(it.status==='active')?'background:rgba(6,182,212,0.05);':'';
      h+='<tr style="'+rowBg+'border-bottom:1px solid var(--bdrl)">';
      /* 포트 셀 — 활성 포트는 청록 배지 */
      var badge=(it.status==='active')?'<span style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:9px;font-weight:800;background:rgba(6,182,212,0.18);color:var(--cyan);border-radius:4px;letter-spacing:0.5px;vertical-align:1px">활성</span>':'';
      h+='<td style="padding:10px 16px;vertical-align:middle"><span style="font-family:var(--fm);font-size:13px;font-weight:800;color:var(--t1)">'+escHtml(String(it.port))+'</span>'+badge+'</td>';
      /* 호스트 점유 셀 */
      var hostHtml='';
      if(it.status==='active'){hostHtml='<span style="color:var(--gs);font-weight:600">✅ 현재 사용 가능</span>';activePortLabel=String(it.port);}
      else if(it.status==='available'){hostHtml='<span style="color:var(--gs);font-weight:600">✅ 사용 가능</span>';}
      else if(it.status==='occupied'){
        var ownerName=it.owner&&it.owner.processName?it.owner.processName.replace(/\.exe$/i,''):'';
        hostHtml='<span style="color:var(--yl);font-weight:600">⚠ 다른 프로그램이 쓰는 중</span>'+(ownerName?(' <span style="color:var(--t3);font-size:10.5px;font-family:var(--fm);margin-left:4px">'+escHtml(ownerName)+'</span>'):'');
      }
      else if(it.status==='denied'){hostHtml='<span style="color:var(--rs);font-weight:600">❌ 권한 부족</span> <span style="color:var(--t3);font-size:10.5px;margin-left:4px">관리자 권한 필요</span>';}
      else {hostHtml='<span style="color:var(--rs);font-weight:600">❌ 오류</span>'+(it.errorCode?(' <span style="color:var(--t3);font-size:10.5px;margin-left:4px">'+escHtml(it.errorCode)+'</span>'):'');}
      h+='<td style="padding:10px;vertical-align:middle">'+hostHtml+'</td>';
      /* 외부 접근 셀 */
      var ext=it.external||{state:'pending'};
      var extHtml='';
      /* 단순화 — 가능/불가능 두 상태로만 표시 (사용자 요청) */
      if(ext.state==='pass'){
        anyExternalPass=true;
        extHtml='<span style="color:var(--gs);font-weight:700">✅ 가능</span>';
      }
      else if(ext.state==='stale'){extHtml='<span style="color:var(--gs);font-weight:700">✅ 가능</span>';}
      else if(it.status==='active'){extHtml='<span style="color:var(--gs);font-weight:700">✅ 가능</span>';}
      else {extHtml='<span style="color:var(--rs);font-weight:700">❌ 불가능</span>';}
      h+='<td style="padding:10px;vertical-align:middle">'+extHtml+'</td>';
      h+='</tr>';
      /* 동시에 접속 주소 표(통합 카드)의 해당 포트 행에도 상태 주입 — 두 표가 함께 갱신.
       * IP 가 여러 개(예: LAN 192.168.x + Tailscale 100.x)면 같은 포트 행이 여러 개 생기므로
       * querySelectorAll 로 그 포트의 모든 행을 갱신해야 한다. 안 그러면 첫 행만 채워지고
       * 나머지 IP 행은 "검사 중..."에 영영 멈춤. (2026-06-07) */
      try{
        const _addrRows=document.querySelectorAll('#collabAddressArea tr[data-collab-port="'+String(it.port)+'"]');
        _addrRows.forEach(function(_addrRow){
          const _h=_addrRow.querySelector('.collab-host-cell');
          const _e=_addrRow.querySelector('.collab-ext-cell');
          if(_h)_h.innerHTML=hostHtml;
          if(_e)_e.innerHTML=extHtml;
        });
      }catch(_e){}
    });
    h+='</tbody></table>';
    area.innerHTML=h;
    /* 결론 박스 */
    if(concl){
      var conclHtml='';
      if(activePortLabel&&anyExternalPass){
        conclHtml='<div style="padding:12px 14px;border-radius:8px;font-size:12px;line-height:1.7;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.3);color:var(--gs)"><b style="color:var(--t1)">📌 권장:</b> 현재 진단 결과 활성 포트 <b style="color:var(--t1)">'+escHtml(activePortLabel)+'</b> 으로 정상 작동합니다. 동료에게 위쪽 접속 주소를 안내하세요.</div>';
      } else if(activePortLabel){
        conclHtml='<div style="padding:12px 14px;border-radius:8px;font-size:12px;line-height:1.7;background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.3);color:var(--yl)"><b style="color:var(--t1)">⚠ 동료 접속 대기 중:</b> 활성 포트 <b style="color:var(--t1)">'+escHtml(activePortLabel)+'</b> 가 열려 있지만 아직 동료 접속 기록이 없습니다. 동료가 접속하면 자동으로 ✅ 표시됩니다.</div>';
      } else {
        conclHtml='<div style="padding:12px 14px;border-radius:8px;font-size:12px;line-height:1.7;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.3);color:var(--rs)"><b style="color:var(--t1)">❌ 활성 포트 없음:</b> 웹 서버가 꺼져 있거나 모든 포트가 점유되어 있습니다.</div>';
      }
      concl.innerHTML=conclHtml;
    }
  }).catch(function(){
    area.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">검사 결과를 불러올 수 없습니다.</div>';
  });
}

function _loadCollabSessions(){
  var area=document.getElementById('collabSessionsArea');
  if(!area)return;
  /* 연결 상태 인디케이터 — _connState 기반 (data-loader.js).
     Phase 2-1/2-2 가 'lost'/'restored'/'all_failed' 등 이벤트를 발행하지만,
     세션 패널 갱신 시점에는 현재 상태값을 직접 읽는다. */
  function _statusBadgeHtml(){
    var s=(window._connState&&window._connState.status)||'idle';
    var pulse=' style="animation:connPulse 1.6s infinite"';
    if(s==='reconnecting'){
      return '<span class="conn-badge reconnecting"'+pulse+'><span class="conn-dot"></span>재연결 시도 중...</span>';
    } else if(s==='failed'){
      return '<span class="conn-badge failed"><span class="conn-dot"></span>연결 실패</span>';
    } else if(s==='connected'||s==='idle'){
      return '<span class="conn-badge connected"'+pulse+'><span class="conn-dot"></span>연결됨</span>';
    }
    return '';
  }
  /* Electron 호스트와 웹 클라이언트 모두에서 동작.
     Electron 환경: localhost:3000 직접 fetch. 웹 환경: 상대 경로 (자기 서버). */
  var base=window.__isWebBrowser?'':'http://localhost:3000';
  fetch(base+'/api/sessions').then(function(r){return r.json();}).then(function(data){
    if(!data||!data.success){area.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px">불러오기 실패</div>';return;}
    var statusBadge=_statusBadgeHtml();
    if(data.count===0){
      area.innerHTML=
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
        +'<span style="font-size:10px;color:var(--t3)">현재 <b style="color:var(--cyan);font-size:13px">0</b>명 접속 중</span>'
        +statusBadge
        +'</div>'
        +'<div style="text-align:center;padding:18px 14px;color:var(--t3);font-size:11px;line-height:1.7">접속된 사용자가 없습니다.<br><span style="font-size:10px;color:var(--t3)">동료가 웹 브라우저로 접속해 사용자를 선택하면 칩으로 표시됩니다.</span></div>';
      return;
    }
    var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
      +'<span style="font-size:10px;color:var(--t3)">현재 <b style="color:var(--cyan);font-size:13px">'+data.count+'</b>명 접속 중</span>'
      +statusBadge
      +'</div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:8px">';
    data.sessions.forEach(function(s){
      /* 칩 표시 — 학교 · 직위 · 이름. 사용자가 미선택이면 "사용자 선택 전" 옅은 칩. */
      var school=(s.userSchool||'').trim();
      var pos=(s.userPosition||'').trim();
      var name=(s.userName||'').trim();
      var hasIdentity=!!(school||pos||name);
      var dotColor=hasIdentity?'#22c55e':'#94a3b8';
      var dotShadow=hasIdentity?'0 0 6px rgba(34,197,94,0.6)':'none';
      var chipBg=hasIdentity?'linear-gradient(180deg,rgba(34,197,94,0.08),rgba(34,197,94,0.02))':'rgba(148,163,184,0.06)';
      var chipBdr=hasIdentity?'rgba(34,197,94,0.3)':'rgba(148,163,184,0.25)';
      h+='<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;background:'+chipBg+';border:1px solid '+chipBdr+';border-radius:99px;font-size:11px;line-height:1.5">';
      h+='<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+dotColor+';box-shadow:'+dotShadow+';flex-shrink:0"></span>';
      if(hasIdentity){
        if(school) h+='<span style="font-weight:600;color:var(--t2)">'+escHtml(school)+'</span>';
        if(pos)    h+='<span style="font-weight:600;color:var(--t2)">'+escHtml(pos)+'</span>';
        if(name)   h+='<span style="font-weight:800;color:var(--t1)">'+escHtml(name)+'</span>';
      } else {
        h+='<span style="font-weight:600;color:var(--t3)">사용자 선택 전</span>';
        h+='<span style="font-size:9.5px;color:var(--t3)">'+escHtml(s.ip||'')+'</span>';
      }
      h+='</div>';
    });
    h+='</div>';
    area.innerHTML=h;
  }).catch(function(){
    area.innerHTML='<div style="text-align:center;padding:16px;color:var(--t3);font-size:11px;line-height:1.7">접속 현황을 불러올 수 없습니다.<br><span style="font-size:10px">웹 서버를 먼저 켜주세요.</span></div>';
  });
}

function _renderBackgroundTabInline(section){
  section=section||'bg';
  const bgMode=localStorage.getItem('ec_bg_mode')||'selected';
  const bgSelected=localStorage.getItem('ec_bg_selected')||'jeju_by-monet.webp';
  /* 사용자 업로드 이미지 URL — settings-bg-theme.js 의 dataURL 캐시와 동일 소스 사용.
   * 과거 file:// 직접 참조는 Electron webSecurity/CSP 에 막혀 미리보기가 검게 나오던 문제 해결. */
  const bgCustom = getCustomBgDataUrl();
  const bgRandomDaily=localStorage.getItem('ec_bg_random_daily')==='true';
  const bgRandomWeekly=localStorage.getItem('ec_bg_random_weekly')==='true';
  const _isLightMode=document.body.classList.contains('light');
  const _solidGallery=getSolidImages();
  const _bgSolidKey=_isLightMode?'ec_bg_solid_selected_light':'ec_bg_solid_selected_dark';
  const bgSolidSelected=localStorage.getItem(_bgSolidKey)||(_solidGallery[0]&&_solidGallery[0].file)||'';
  let previewUrl='';
  if(bgMode==='custom'&&bgCustom) previewUrl=bgCustom;
  else if(bgMode==='random'){const rf=localStorage.getItem('ec_bg_random_file');previewUrl=rf?'assets/backgrounds/'+encodeURIComponent(rf):'assets/backgrounds/'+encodeURIComponent(bgSelected);}
  else if(bgMode==='solid') previewUrl=_solidGallery.length?('assets/backgrounds/'+encodeURIComponent(bgSolidSelected)):'';
  else previewUrl='assets/backgrounds/'+encodeURIComponent(bgSelected);
  let html='';
  const titles={bg:'🖼 배경 이미지 설정',glass:'🪟 글래스모피즘 설정',footer:'💬 하단 회전문구 설정',fontsize:'🔠 글자 크기 설정'};
  html+='<div class="settings-panel-title">'+(titles[section]||'🖥 디스플레이 설정')+'</div>';
  if(section!=='bg'){/* bg가 아닌 섹션은 아래에서 해당 부분만 렌더 */}
  if(section==='glass')return html+_renderGlassSection();
  if(section==='footer')return html+_renderFooterSection();
  if(section==='fontsize')return html+_renderFontsizeSection();
  /* section==='bg': 배경 이미지 설정 */
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:18px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan);display:flex;align-items:center;gap:6px">🖼 배경 이미지 설정</div>';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px;text-align:center">🖼 현재 배경 미리보기</div>';
  html+='<div style="position:relative;width:240px;height:135px;margin:0 auto;border-radius:8px;overflow:hidden;border:2px solid var(--bdr);background:#000">'
    +'<img src="'+previewUrl+'" style="width:100%;height:100%;object-fit:cover" data-fallback="1">'
    +'<div class="bg-prev-x" data-action="bgResetPreview" style="display:none;position:absolute;top:4px;right:4px;width:20px;height:20px;background:rgba(239,68,68,0.85);color:#fff;border-radius:50%;font-size:11px;cursor:pointer;align-items:center;justify-content:center;font-weight:700" title="배경 초기화">✕</div>'
    +'</div></div>';
  /* 모드 선택 — 시안 5: 글래스 패널 + 원형 아이콘 + 라벨. 활성은 청록 그라데이션 원 + glow.
     라이트/다크 모드에 따라 패널·아이콘 배경 톤을 분기. */
  const _isLightTheme=document.body.classList.contains('light');
  const _panelBg=_isLightTheme?'rgba(241,245,249,0.55)':'rgba(15,23,42,0.6)';
  const _panelBdr=_isLightTheme?'rgba(15,23,42,0.06)':'rgba(255,255,255,0.06)';
  const _iconBgIdle=_isLightTheme?'rgba(15,23,42,0.05)':'rgba(255,255,255,0.04)';
  const _activeWrapBg=_isLightTheme
    ?'background:linear-gradient(180deg,rgba(6,182,212,0.10),rgba(6,182,212,0.02));'
    :'background:linear-gradient(180deg,rgba(6,182,212,0.12),rgba(6,182,212,0.04));';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">모드 선택</div>';
  html+='<div class="bg-mode-row" style="display:flex;gap:14px;padding:8px;background:'+_panelBg+';border-radius:16px;border:1px solid '+_panelBdr+'">';
  const _modes=[
    {key:'solid', icon:'🎨', label:'단색 이미지'},
    {key:'selected', icon:'🖼', label:'그림 이미지'},
    {key:'random', icon:'🎲', label:'그림 랜덤'},
    {key:'custom', icon:'📤', label:'사용자 업로드'}
  ];
  _modes.forEach(function(m){
    const act=bgMode===m.key;
    const wrapBg=act?_activeWrapBg:'';
    const wrapBdr=act?'border-color:rgba(6,182,212,0.4);':'border-color:transparent;';
    const iconBg=act
      ?'background:linear-gradient(135deg,#06B6D4,#0891B2);box-shadow:0 6px 16px -4px rgba(6,182,212,0.55);'
      :'background:'+_iconBgIdle+';';
    const labelStyle=act?'color:var(--t1);font-weight:700;':'color:var(--t2);font-weight:600;';
    html+='<div class="bg-mode-cell'+(act?' active':'')+'" data-action="setBgMode" data-arg="'+m.key+'" style="flex:1;padding:14px 8px 10px;border-radius:12px;cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);text-align:center;border:1.5px solid;display:flex;flex-direction:column;align-items:center;gap:6px;'+wrapBg+wrapBdr+'">';
    html+='<div class="bg-mode-icon" style="width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;transition:all .2s;'+iconBg+'">'+m.icon+'</div>';
    html+='<div style="font-size:11px;'+labelStyle+'">'+m.label+'</div>';
    html+='</div>';
  });
  html+='</div></div>';
  if(bgMode==='solid'){
    const _solidLabel=_isLightMode?'☀️ 라이트 모드 단색':'🌙 다크 모드 단색';
    html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px;display:flex;align-items:center;gap:6px">'+_solidLabel+' 갤러리 <span style="color:var(--t3);font-weight:500;font-size:10px">— 현재 모드 전용</span></div>';
    if(_solidGallery.length){
      html+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">';
      _solidGallery.forEach(function(img){
        const isSelected=bgSolidSelected===img.file;
        html+='<div title="'+img.title+'" data-action="selectSolidImage" data-arg="'+img.file.replace(/"/g,'&quot;')+'" style="cursor:pointer;border-radius:8px;overflow:hidden;border:2.5px solid '+(isSelected?'var(--cyan)':'transparent')+';transition:border 0.15s;background:var(--card)">';
        html+='<div style="width:100%;aspect-ratio:16/9;overflow:hidden;background:#111"><img src="assets/backgrounds/'+encodeURIComponent(img.file)+'" style="width:100%;height:100%;object-fit:cover;display:block" data-fallback="1"></div>';
        html+='<div style="padding:5px 6px;font-size:10px;color:var(--t2);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+img.title+'">'+img.title+'</div>';
        html+='</div>';
      });
      html+='</div>';
    } else {
      html+='<div style="padding:24px 16px;text-align:center;color:var(--t3);font-size:12px;line-height:1.8;background:var(--bg2);border-radius:8px">'
        +'<div style="font-size:20px;margin-bottom:6px">📭</div>'
        +(_isLightMode?'라이트 모드용 단색 이미지가 아직 등록되지 않았습니다.':'다크 모드용 단색 이미지가 아직 등록되지 않았습니다.')
        +'<div style="font-size:10.5px;margin-top:6px;color:var(--t3)">PNG 단색 이미지를 만들어 <code style="background:var(--card);padding:1px 4px;border-radius:3px">assets/backgrounds/</code> 폴더에 추가하시면 자동으로 표시됩니다.</div>'
        +'</div>';
    }
    html+='</div>';
  } else if(bgMode==='selected'){
    html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">그림 이미지 갤러리</div>';
    html+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">';
    BG_IMAGES.forEach(function(img){
      const isSelected=bgSelected===img.file;
      html+='<div title="'+img.title+'" data-action="selectBgImage" data-arg="'+img.file.replace(/"/g,'&quot;')+'" style="cursor:pointer;border-radius:8px;overflow:hidden;border:2.5px solid '+(isSelected?'var(--cyan)':'transparent')+';transition:border 0.15s;background:var(--card)">';
      html+='<div style="width:100%;aspect-ratio:16/9;overflow:hidden;background:#111"><img src="assets/backgrounds/'+encodeURIComponent(img.file)+'" style="width:100%;height:100%;object-fit:cover;display:block" data-fallback="1"></div>';
      html+='<div style="padding:5px 6px;font-size:10px;color:var(--t2);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+img.title+'">'+img.title+'</div>';
      html+='</div>';
    });
    html+='</div></div>';
  } else if(bgMode==='random'){
    html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">🎲 랜덤 배경 설정</div>';
    html+='<p style="font-size:12px;color:var(--t2);margin-bottom:10px">앱 실행 시 랜덤으로 배경이 변경됩니다.</p>';
    html+='<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t2);cursor:pointer;margin-bottom:8px"><input type="checkbox" '+(bgRandomDaily?'checked':'')+' data-action="toggleBgRandomDaily" style="accent-color:var(--cyan)"> 하루 단위로 변경</label>';
    html+='<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t2);cursor:pointer"><input type="checkbox" '+(bgRandomWeekly?'checked':'')+' data-action="toggleBgRandomWeekly" style="accent-color:var(--cyan)"> 한 주 단위로 변경</label>';
    html+='</div>';
  } else if(bgMode==='custom'){
    html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">📤 사용자 이미지 업로드</div>';
    html+='<div id="bgCustomDropArea" data-action="bgCustomClick" style="border:2px dashed var(--bdr);border-radius:10px;padding:30px 20px;text-align:center;cursor:pointer;transition:border-color 0.15s;background:var(--card)">';
    html+='<div style="font-size:28px;margin-bottom:6px">📁</div>';
    html+='<div style="font-size:12px;color:var(--t2)">이미지를 드래그하거나 클릭하여 업로드</div>';
    html+='<div style="font-size:10px;color:var(--t3);margin-top:4px">권장 비율: 16:9 (PNG, JPG, WebP)</div>';
    html+='</div>';
    html+='<input type="file" id="bgCustomFileInput" accept="image/*" style="display:none">';
    if(bgCustom){
      html+='<div style="margin-top:12px"><div style="font-size:11px;color:var(--t3);margin-bottom:6px">현재 업로드된 이미지 (클릭하면 이 이미지를 배경으로 적용):</div>';
      html+='<div style="display:flex;align-items:center;gap:10px"><div data-action="reapplyBgCustom" title="클릭하면 이 이미지를 배경으로 적용" style="width:120px;height:67px;border-radius:6px;overflow:hidden;border:2px solid var(--cyan);background:#000;cursor:pointer;transition:transform .12s,box-shadow .12s" onmouseover="this.style.transform=\'scale(1.04)\';this.style.boxShadow=\'0 4px 12px rgba(6,182,212,0.30)\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'"><img src="'+bgCustom+'" style="width:100%;height:100%;object-fit:cover;pointer-events:none"></div>';
      html+='<button data-action="deleteBgCustom" style="padding:5px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#ef4444;cursor:pointer;font-size:11px;font-family:var(--f)">🗑 삭제</button></div></div>';
    }
    html+='</div>';
  }
  if(section==='bg') return html; /* 배경 이미지 탭일 때 여기서 반환 */
  /* Glass + font scale sections use same code from original — kept inline */
  html+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:28px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan);display:flex;align-items:center;gap:6px">✨ 글래스모피즘 설정</div>';
  html+='<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.7">상단 헤더 · 로그인 화면과 하단 푸터에 적용할 글래스모피즘 스타일을 선택하세요.</div>';
  const _glassOptions=[
    {key:'none',name:'없음',preview:'transparent',blur:'0',desc:'효과 없음'},
    {key:'frost',name:'서리 크리스탈',preview:'rgba(255,255,255,0.55)',blur:'24px',desc:'맑은 서리 유리'},
    {key:'sunset',name:'선셋 앰버',preview:'linear-gradient(135deg,rgba(251,146,60,0.15),rgba(239,68,68,0.08))',blur:'18px',desc:'따뜻한 석양빛'},
    {key:'ocean',name:'오션 블루',preview:'linear-gradient(135deg,rgba(6,182,212,0.12),rgba(59,130,246,0.08))',blur:'20px',desc:'시원한 바다빛'},
    {key:'aurora',name:'오로라 미스트',preview:'linear-gradient(135deg,rgba(168,85,247,0.12),rgba(56,189,248,0.12),rgba(52,211,153,0.10))',blur:'20px',desc:'은은한 오로라'},
    {key:'smoke',name:'스모크 다크',preview:'rgba(15,20,30,0.65)',blur:'22px',desc:'깊은 다크 스모크'},
    {key:'rose',name:'로즈 골드',preview:'linear-gradient(135deg,rgba(251,191,178,0.18),rgba(236,72,153,0.08))',blur:'20px',desc:'우아한 로즈골드'},
    {key:'mint',name:'민트 브리즈',preview:'linear-gradient(135deg,rgba(52,211,153,0.15),rgba(6,182,212,0.10))',blur:'20px',desc:'상쾌한 민트향'},
    {key:'lavender',name:'라벤더',preview:'linear-gradient(135deg,rgba(196,181,253,0.2),rgba(219,234,254,0.15))',blur:'22px',desc:'차가운 보랏빛'},
    {key:'amber',name:'샴페인 골드',preview:'linear-gradient(135deg,rgba(255,223,153,0.18),rgba(218,185,107,0.12))',blur:'18px',desc:'은은한 금빛'},
    {key:'slate',name:'실버 스모크',preview:'linear-gradient(135deg,rgba(148,163,184,0.25),rgba(203,213,225,0.15))',blur:'22px',desc:'은빛 메탈릭'},
    {key:'ruby',name:'루비 레드',preview:'linear-gradient(135deg,rgba(220,38,38,0.1),rgba(239,68,68,0.06))',blur:'18px',desc:'깊은 루비빛'},
    {key:'emerald',name:'에메랄드',preview:'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(52,211,153,0.08))',blur:'20px',desc:'청록빛 보석'}
  ];
  const _curHeader=localStorage.getItem('ec_glass_header')||'frost';
  const _curFooter=localStorage.getItem('ec_glass_footer')||'sunset';
  function _glassGrid(target,curVal,rerenderTab){
    const actionName=target==='header'?'setHeaderGlass':'setFooterGlass';
    let g='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">';
    _glassOptions.forEach(function(opt){
      const sel=opt.key===curVal;
      const isDark=opt.key==='smoke';
      g+='<div data-action="'+actionName+'" data-arg="'+opt.key+'" data-arg2="'+(rerenderTab||'background')+'" style="cursor:pointer;border-radius:8px;border:2px solid '+(sel?'var(--cyan)':'var(--bdr)')+';overflow:hidden;transition:all .2s;background:var(--card)">';
      g+='<div style="height:36px;background:'+opt.preview+';backdrop-filter:blur('+opt.blur+');-webkit-backdrop-filter:blur('+opt.blur+');position:relative">';
      g+='<div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:8px;color:'+(isDark?'rgba(255,255,255,0.6)':'rgba(0,0,0,0.3)')+';font-weight:600">'+(target==='header'?'Header':'Footer')+'</div></div>';
      g+='<div style="padding:4px;text-align:center"><div style="font-size:9.5px;font-weight:700;color:'+(sel?'var(--cyan)':'var(--t1)')+';margin-bottom:1px">'+opt.name+'</div>';
      g+='<div style="font-size:8px;color:var(--t3)">'+opt.desc+'</div></div></div>';
    });
    g+='</div>';return g;
  }
  html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">💎 상단 헤더 · 로그인 화면</div>';
  html+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px">선택한 스타일이 상단 헤더와 로그인 분할화면에 동시 적용됩니다.</div>';
  html+=_glassGrid('header',_curHeader,'background');
  html+='</div>';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">💠 하단 푸터</div>';
  html+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px">하단 푸터 영역에 적용할 스타일을 선택하세요.</div>';
  html+=_glassGrid('footer',_curFooter,'background');
  html+='</div>';
  /* 하단 회전 문구 설정 제거됨 (사용자 요청 2026-05-18) — banner.json 의 footer 배열을 단일 소스로. */

  /* 글자 크기 설정 제거됨 — 100% 고정 */

  return html;
}

/* ── _fontScaleOnInput은 settings-tab-help.js에서 사용 — 전역 노출 ── */
function _fontScaleOnInput(val){
  let v=parseInt(val);if(isNaN(v))v=115;
  if(v<100)v=100;if(v>130)v=130;
  const lbl=document.getElementById('fontScaleLabel');if(lbl)lbl.textContent=v+'%';
  const prev=document.getElementById('fontScalePreview');if(prev)prev.style.fontSize=(12*v/100).toFixed(1)+'px';
  /* 실시간 반영 — 슬라이드 중에도 부드럽게 + 모달 상한 동기화 */
  const fs=v/100;
  document.documentElement.style.setProperty('--fs',fs);
  document.documentElement.style.setProperty('--fs-modal',Math.min(1.10,fs));
}

/* ═══ 디스플레이 분리 탭 함수 ═══ */
function _renderGlassSection(){
  const _glassOptions=[
    {key:'none',name:'없음',preview:'transparent',blur:'0',desc:'효과 없음'},
    {key:'frost',name:'서리 크리스탈',preview:'rgba(255,255,255,0.55)',blur:'24px',desc:'맑은 서리 유리'},
    {key:'sunset',name:'선셋 앰버',preview:'linear-gradient(135deg,rgba(251,146,60,0.15),rgba(239,68,68,0.08))',blur:'18px',desc:'따뜻한 석양빛'},
    {key:'ocean',name:'오션 블루',preview:'linear-gradient(135deg,rgba(6,182,212,0.12),rgba(59,130,246,0.08))',blur:'20px',desc:'시원한 바다빛'},
    {key:'aurora',name:'오로라 미스트',preview:'linear-gradient(135deg,rgba(168,85,247,0.12),rgba(56,189,248,0.12),rgba(52,211,153,0.10))',blur:'20px',desc:'은은한 오로라'},
    {key:'smoke',name:'스모크 다크',preview:'rgba(15,20,30,0.65)',blur:'22px',desc:'깊은 다크 스모크'},
    {key:'rose',name:'로즈 골드',preview:'linear-gradient(135deg,rgba(251,191,178,0.18),rgba(236,72,153,0.08))',blur:'20px',desc:'우아한 로즈골드'},
    {key:'mint',name:'민트 브리즈',preview:'linear-gradient(135deg,rgba(52,211,153,0.15),rgba(6,182,212,0.10))',blur:'20px',desc:'상쾌한 민트향'},
    {key:'lavender',name:'라벤더',preview:'linear-gradient(135deg,rgba(196,181,253,0.2),rgba(219,234,254,0.15))',blur:'22px',desc:'차가운 보랏빛'},
    {key:'amber',name:'샴페인 골드',preview:'linear-gradient(135deg,rgba(255,223,153,0.18),rgba(218,185,107,0.12))',blur:'18px',desc:'은은한 금빛'},
    {key:'slate',name:'실버 스모크',preview:'linear-gradient(135deg,rgba(148,163,184,0.25),rgba(203,213,225,0.15))',blur:'22px',desc:'은빛 메탈릭'},
    {key:'ruby',name:'루비 레드',preview:'linear-gradient(135deg,rgba(220,38,38,0.1),rgba(239,68,68,0.06))',blur:'18px',desc:'깊은 루비빛'},
    {key:'emerald',name:'에메랄드',preview:'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(52,211,153,0.08))',blur:'20px',desc:'청록빛 보석'}
  ];
  const _curHeader=localStorage.getItem('ec_glass_header')||'frost';
  const _curFooter=localStorage.getItem('ec_glass_footer')||'sunset';
  function _gg(target,curVal){
    const actionName=target==='header'?'setHeaderGlass':'setFooterGlass';
    let g='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">';
    _glassOptions.forEach(function(opt){
      const sel=opt.key===curVal;const isDark=opt.key==='smoke';
      g+='<div data-action="'+actionName+'" data-arg="'+opt.key+'" data-arg2="glass" style="cursor:pointer;border-radius:8px;border:2px solid '+(sel?'var(--cyan)':'var(--bdr)')+';overflow:hidden;transition:all .2s;background:var(--card)">';
      g+='<div style="height:36px;background:'+opt.preview+';backdrop-filter:blur('+opt.blur+');-webkit-backdrop-filter:blur('+opt.blur+');position:relative">';
      g+='<div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:9.5px;color:'+(isDark?'rgba(255,255,255,0.7)':'rgba(0,0,0,0.45)')+';font-weight:700">'+(target==='header'?'Header':'Footer')+'</div></div>';
      g+='<div style="padding:4px;text-align:center"><div style="font-size:11px;font-weight:700;color:'+(sel?'var(--cyan)':'var(--t1)')+'">'+opt.name+'</div>';
      g+='<div style="font-size:10.5px;font-weight:600;color:var(--t3);margin-top:2px">'+opt.desc+'</div></div></div>';
    });
    g+='</div>';return g;
  }
  let h='<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.7">상단 헤더 · 로그인 화면과 하단 푸터에 적용할 글래스모피즘 스타일을 선택하세요.</div>';
  h+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">💎 상단 헤더 · 로그인 화면</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px">선택한 스타일이 상단 헤더와 로그인 분할화면에 동시 적용됩니다.</div>';
  h+=_gg('header',_curHeader)+'</div>';
  h+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">💠 하단 푸터</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px">하단 푸터 영역에 적용할 스타일을 선택하세요.</div>';
  h+=_gg('footer',_curFooter)+'</div>';
  return h;
}

/* 사용자 커스텀 문구 로드 (text 문자열 배열, 없으면 banner.json 캐시에서 기본값) */
/* 하단 문구 원본 객체 로드 — text + time 포함. 문자열 배열도 backward compat 로 처리.
   우선순위: ec_footer_msgs(사용자 저장) → ec_banner_cache(원격/번들 캐시) → 번들 templates/banner.json 즉시 읽기. */
function _loadFooterMsgsRawObjects(){
  let raw=[];
  try{const _fm=JSON.parse(localStorage.getItem('ec_footer_msgs')||'null');if(Array.isArray(_fm))raw=_fm;}catch(e){}
  /* 사용자 저장값이 비어있으면 banner cache 에서 기본 문구 꺼내오기 */
  if(!raw.length){
    try{
      const bc=JSON.parse(localStorage.getItem('ec_banner_cache')||'null');
      if(bc&&typeof bc==='object'&&Array.isArray(bc.footer)) raw=bc.footer.slice();
    }catch(e){}
  }
  /* 배너 캐시도 없으면 번들된 templates/banner.json 을 즉시 읽어 캐시하고 다시 렌더 */
  if(!raw.length && window.electronAPI && window.electronAPI.readFile){
    try{
      window.electronAPI.readFile('__app__/templates/banner.json').then(function(res){
        if(!res||!res.success||!res.content)return;
        try{
          const j=JSON.parse(res.content);
          if(j&&Array.isArray(j.footer)){
            /* 캐시 갱신 */
            const prev=JSON.parse(localStorage.getItem('ec_banner_cache')||'{}');
            prev.footer=j.footer; if(j.header)prev.header=j.header;
            localStorage.setItem('ec_banner_cache',JSON.stringify(prev));
            if(S.settingsLocked==='background'||S.settingsLocked==='headermsg') renderSettingsPanel(S.settingsLocked);
          }
        }catch(e){}
      }).catch(function(){});
    }catch(e){}
  }
  const out=[];
  raw.forEach(function(item){
    if(typeof item==='string'){ if(item.trim()) out.push({text:item.trim(), time:15000}); }
    else if(item&&typeof item==='object'&&item.text){
      const t=(typeof item.time==='number'&&item.time>=3000)?item.time:15000;
      out.push({text:String(item.text).trim(), time:t});
    }
  });
  return out;
}

/* ═══ 상단 회전문구 (헤더 브랜드) 섹션 ═══ */
const HDR_MSG_MAX = 10;

function _renderHeaderMsgSection(){
  const _locked=getLockedHeaderMsgs();
  /* 지금 들어간 문구를 기본 제시 — 사용자 저장값 우선, 없으면 기본 커스텀 */
  let _user=[];
  try{_user=(getCurrentCustomHeaderMsgs()||[]).slice(0,HDR_MSG_MAX);}catch(e){}

  let h='<div class="settings-panel-title">✨ 상단 회전문구 설정</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.7">상단 중앙에서 번갈아 회전하는 헤더 문구를 편집합니다. 각 문구에 이모지·텍스트·색상을 지정할 수 있습니다.<br><span style="color:var(--t2)">· 잠금 🔒 표시된 문구(오렌지톡)는 편집·삭제할 수 없으며 프로그램 로고가 표시됩니다.</span></div>';

  /* 잠금 메시지 카드 — 로고 이미지 사용. 전환 시간(초) 도 참고용으로 표시 (disabled). */
  h+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">🔒 고정 문구 (편집 불가)</div>';
  _locked.forEach(function(m){
    const _icon=m.useLogo?'<img src="assets/logo/logo_big.png" style="width:20px;height:20px;object-fit:contain;display:inline-block">':('<span style="font-size:20px">'+escHtml(m.emoji||'')+'</span>');
    const _lockSec=Math.max(3,Math.round((m.time||30000)/1000));
    h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;background:var(--bg2);border:1px dashed var(--bdr);border-radius:8px;opacity:0.9">';
    h+='<span style="width:28px;text-align:center;display:inline-flex;align-items:center;justify-content:center">'+_icon+'</span>';
    h+='<span style="flex:1;font-size:12px;font-weight:700;color:'+escHtml(m.color||'#888')+'">'+escHtml(m.text||'')+'</span>';
    /* 잠금 문구도 전환 시간 표시 — 조정 불가 (disabled readonly) */
    h+='<span style="display:inline-flex;align-items:center;gap:3px;opacity:0.6"><input type="number" value="'+_lockSec+'" disabled readonly title="잠금 문구의 전환 시간 (조정 불가)" style="width:40px;font-size:10px;padding:3px 4px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t3);text-align:center;cursor:not-allowed"><span style="font-size:9px;color:var(--t3)">초</span></span>';
    h+='<span style="font-size:9px;color:var(--t3)">🔒 잠김</span>';
    h+='</div>';
  });
  h+='</div>';

  /* 사용자 편집 가능한 문구 — 8슬롯 고정, 하단 회전문구 GUI 스타일 */
  h+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">✏ 내 문구 편집 (최대 '+HDR_MSG_MAX+'개) — 빈 칸으로 두면 해당 슬롯은 회전에서 제외됩니다</div>';
  h+='<div id="hdrMsgEditList">';
  for(let i=0;i<HDR_MSG_MAX;i++){
    const m=i<_user.length?_user[i]:null;
    h+=_hdrMsgRowHtml(i,m);
  }
  h+='</div>';
  /* 저장 버튼 제거 — 이모지 선택/문구 입력/시간 변경 시 자동 저장 + 우하단 토스트.
     초기화 버튼만 유지. */
  h+='<div style="display:flex;justify-content:flex-end;margin-top:10px">';
  h+='<button class="btn btn-sm" data-action="hdrMsgReset" style="font-size:10px" title="기본 문구로 초기화">↺ 초기화</button>';
  h+='</div>';
  h+='</div>';
  return h;
}

function _hdrMsgRowHtml(idx,m){
  const emoji=m&&m.emoji?m.emoji:'';
  const text=m&&m.text?m.text:'';
  const color=m&&m.color?m.color:'#3b82f6';
  const lightColor=m&&m.lightColor?m.lightColor:color;
  const hidden=!!(m&&m.hidden);
  /* 슬롯별 전환 시간 (초) — 기존 m.time 은 ms. 없으면 전역 기본값 또는 30초. */
  const _globSec=parseInt(localStorage.getItem('ec_hdr_msg_interval')||'30',10);
  const timeMs=m&&typeof m.time==='number'?m.time:(_globSec*1000);
  const timeSec=Math.max(3,Math.min(300,Math.round(timeMs/1000)));
  /* 가려진 슬롯은 row 전체를 흐리게(opacity) 표시만. 빗금/줄긋기는 사용자 요청으로 제외. */
  const _rowDim=hidden?'opacity:0.45;':'';
  let h='<div class="hdr-msg-row msg-row" data-idx="'+idx+'" data-hidden="'+(hidden?'1':'0')+'" style="display:flex;align-items:center;gap:5px;padding:6px 8px;margin-bottom:4px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;'+_rowDim+'">';
  h+='<span style="font-size:9px;color:var(--t3);min-width:20px;text-align:right">'+(idx+1)+'.</span>';
  h+='<input class="form-input hdr-msg-emoji" data-role="emoji" value="'+escHtml(emoji)+'" placeholder="🍎" maxlength="4" style="width:42px;text-align:center;font-size:16px;padding:4px;cursor:pointer" title="클릭하여 이모지 선택기 열기">';
  h+='<input class="form-input hdr-msg-text" data-role="text" value="'+escHtml(text)+'" placeholder="빈 슬롯" style="flex:1;font-size:11px;padding:4px 8px">';
  h+='<label style="display:flex;align-items:center;gap:3px"><span style="font-size:9px;color:var(--t3)">다크</span><input type="color" class="hdr-msg-color" data-role="color" value="'+escHtml(color)+'" title="다크 모드 글자색" style="width:24px;height:22px;cursor:pointer;border:1px solid var(--bdr);border-radius:4px;background:transparent;padding:1px"></label>';
  h+='<label style="display:flex;align-items:center;gap:3px"><span style="font-size:9px;color:var(--t3)">라이트</span><input type="color" class="hdr-msg-lightcolor" data-role="lightColor" value="'+escHtml(lightColor)+'" title="라이트 모드 글자색" style="width:24px;height:22px;cursor:pointer;border:1px solid var(--bdr);border-radius:4px;background:transparent;padding:1px"></label>';
  /* 슬롯별 전환 시간 — 3~300초. 하단 전역 전환 시간 input 은 제거됨. */
  h+='<label style="display:flex;align-items:center;gap:2px"><input type="number" class="hdr-msg-time" data-role="time" min="3" max="300" value="'+timeSec+'" title="이 슬롯 전환 시간 (초)" style="width:42px;font-size:10px;padding:3px 4px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);text-align:center"><span style="font-size:9px;color:var(--t3)">초</span></label>';
  h+=_msgEyeBtnHtml('hdrMsgClear',' data-idx="'+idx+'"',hidden?'이 슬롯 보이기 (회전 포함)':'이 슬롯 가리기 (회전에서 제외, 문구는 보존)');
  h+='</div>';
  return h;
}

function _hdrMsgCollect(){
  const rows=document.querySelectorAll('#hdrMsgEditList .hdr-msg-row');
  const list=[];
  rows.forEach(function(row){
    const emoji=(row.querySelector('[data-role="emoji"]')||{}).value||'';
    const text=(row.querySelector('[data-role="text"]')||{}).value||'';
    const color=(row.querySelector('[data-role="color"]')||{}).value||'#3b82f6';
    const lightColor=(row.querySelector('[data-role="lightColor"]')||{}).value||color;
    /* 슬롯별 전환 시간 — 3~300초 범위로 clamp, 없으면 30초. */
    const rawT=(row.querySelector('[data-role="time"]')||{}).value||'30';
    let sec=parseInt(rawT,10); if(isNaN(sec)||sec<3)sec=3; if(sec>300)sec=300;
    /* hidden 플래그 — 눈알 토글로 설정. 가려져도 텍스트·이모지·색상은 보존된 채로 저장.
     * (header-widget 의 cycleBrand 가 회전 시 hidden===true 인 슬롯을 skip 한다.) */
    const hidden=row.dataset.hidden==='1';
    if(String(text).trim())list.push({emoji:String(emoji).trim()||'✨',text:String(text).trim(),color:color,lightColor:lightColor,time:sec*1000,hidden:hidden});
  });
  return list;
}

/* ═══ 자동 저장 토스트 — 우하단에 "저장 중..." → "모든 내용이 저장되었습니다" ═══ */
function _showSaveToast(stage){
  let t=document.getElementById('globalSaveToast');
  if(!t){
    t=document.createElement('div');
    t.id='globalSaveToast';
    t.className='global-save-toast';
    document.body.appendChild(t);
  }
  if(stage==='saving'){
    t.textContent='저장 중…';
    t.className='global-save-toast show saving';
  } else {
    t.textContent='모든 내용이 저장되었습니다.';
    t.className='global-save-toast show';
    clearTimeout(t._hideTimer);
    t._hideTimer=setTimeout(function(){ t.className='global-save-toast'; }, 3000);
  }
}

/* ═══ 헤더 회전문구 자동 저장 — debounce 로 연속 입력 병합 ═══
 * 이전 버그: localStorage.setItem('ec_hdr_msgs', ...) 로 잘못된 키에 저장 →
 *           header-widget.js 는 'ec_header_msgs_user' 를 읽으므로 사용자 입력이 화면에 반영도 안 되고
 *           다시 설정 탭 들어오면 입력값 사라진 것처럼 보였음.
 * 수정: header-widget.js 의 saveUserHeaderMsgs 호출 — 올바른 키 + DB 동기화 + 위젯 즉시 재빌드. */
let _hdrAutoSaveTimer=null;
function _hdrMsgAutoSave(){
  _showSaveToast('saving');
  clearTimeout(_hdrAutoSaveTimer);
  _hdrAutoSaveTimer=setTimeout(function(){
    try{
      /* 패널이 사라진 뒤(다른 탭 전환) 타이머가 발사되면 querySelectorAll 결과가 0 → 빈 list →
       * 사용자의 기존 저장값이 빈 배열로 덮어써져 "새 문구가 사라진다"는 회귀 발생.
       * → 패널이 살아 있을 때만 저장. 없으면 silently skip. */
      if(!document.getElementById('hdrMsgEditList')) return;
      const list=_hdrMsgCollect();
      saveUserHeaderMsgs(list);
      _showSaveToast('saved');
    } catch(e){
      console.warn('[hdrMsg] auto-save failed', e);
    }
  }, 250);
}

/* 업데이트 설치 확인 — OS confirm 대신 프로그램 커스텀 모달(2026-06-08).
 *  실제 동작은 종료 후 설치(재시작 안 함)이므로 "종료" 로 표기. 자동저장이라 "저장 안 한 작업" 경고는 제거. */
function _showUpdateInstallConfirm(){
  if(document.getElementById('updInstallConfirmOv')) return;
  const ov=document.createElement('div');
  ov.id='updInstallConfirmOv';
  ov.style.cssText='position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:400px;max-width:92vw;box-shadow:0 24px 60px rgba(0,0,0,0.42);overflow:hidden">'
    +'<div style="padding:16px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));display:flex;align-items:center;gap:10px">'
    +'<span style="font-size:18px">↻</span><div style="font-size:14.5px;font-weight:800;color:var(--t1)">업데이트 설치</div></div>'
    +'<div style="padding:20px;font-size:13px;color:var(--t1);line-height:1.8;font-weight:500">지금 업데이트를 설치할까요?<br>설치가 끝나면 <b style="font-weight:800">새 버전으로 자동으로 다시 열립니다.</b><br><span style="color:var(--t2);font-size:12px">직접 켜지 마시고 잠시만 기다려 주세요.</span></div>'
    +'<div style="padding:0 20px 18px;display:flex;gap:8px;justify-content:flex-end">'
    +'<button id="updInstCancel" style="padding:9px 18px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);border-radius:9px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:var(--f)">취소</button>'
    +'<button id="updInstGo" style="padding:9px 20px;border:none;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border-radius:9px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:var(--f)">지금 설치</button>'
    +'</div></div>';
  document.body.appendChild(ov);
  const _close=function(){ const o=document.getElementById('updInstallConfirmOv'); if(o)o.remove(); };
  ov.addEventListener('click', function(e){ if(e.target===ov) _close(); });
  const _c=document.getElementById('updInstCancel'); if(_c) _c.addEventListener('click', _close);
  const _go=document.getElementById('updInstGo');
  if(_go) _go.addEventListener('click', function(){
    _close();
    try{ if(window.electronAPI && window.electronAPI.updaterQuitAndInstall) window.electronAPI.updaterQuitAndInstall(); }catch(_){}
  });
}

function _renderFooterSection(){
  let h='<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.7">하단 푸터에 7초 간격으로 회전 표시할 문구를 편집할 수 있습니다.</div>';
  const _footerMsgsRaw=_loadFooterMsgsRawObjects();
  h+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">문구 편집 (최대 40개, 현재 '+_footerMsgsRaw.length+'개)</div>';
  for(let fi=0;fi<40;fi++){
    const obj=fi<_footerMsgsRaw.length?_footerMsgsRaw[fi]:null;
    const fval=obj?obj.text:'';
    /* 하단 회전문구도 상단 회전문구와 동일한 결 — 단, 이모지·색상은 없고 초 단위만 조정. */
    const timeSec=(obj&&typeof obj.time==='number')?Math.max(3,Math.min(300,Math.round(obj.time/1000))):15;
    h+='<div class="msg-row footer-msg-row" data-idx="'+fi+'" style="display:flex;align-items:center;gap:5px;padding:4px 6px;margin-bottom:4px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px">';
    h+='<span style="font-size:9px;color:var(--t3);min-width:20px;text-align:right">'+(fi+1)+'.</span>';
    h+='<input class="form-input footer-msg-input" data-idx="'+fi+'" value="'+escHtml(fval)+'" placeholder="빈 슬롯" style="flex:1;font-size:11px;padding:4px 8px">';
    h+='<label style="display:flex;align-items:center;gap:2px"><input type="number" class="footer-msg-time" data-role="time" min="3" max="300" value="'+timeSec+'" title="이 슬롯 전환 시간 (초)" style="width:42px;font-size:10px;padding:3px 4px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);text-align:center"><span style="font-size:9px;color:var(--t3)">초</span></label>';
    h+=_msgEyeBtnHtml('clearInput','','이 슬롯 비우기');
    h+='</div>';
  }
  /* 저장 버튼 제거 — 입력 즉시 자동 저장 + 우하단 토스트. 초기화만 유지. */
  h+='<div style="display:flex;justify-content:flex-end;margin-top:8px">';
  h+='<button class="btn btn-sm" data-action="resetFooterMsgs" style="font-size:10px">↺ 초기화</button>';
  h+='</div></div>';
  return h;
}

function _renderFontsizeSection(){
  let _curFs=parseInt(localStorage.getItem('ec_fontScale')||'115');
  if(isNaN(_curFs)||_curFs<100)_curFs=100;if(_curFs>130)_curFs=130;
  let h='<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.7">메인 영역의 글자와 여백을 일괄 확대합니다. 사이드바·캔버스·인쇄물은 영향받지 않습니다.</div>';
  h+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
  h+='<span style="font-size:10px;color:var(--t3);min-width:32px">100%</span>';
  h+='<input type="range" id="fontScaleSlider" min="100" max="130" step="5" value="'+_curFs+'" style="flex:1;accent-color:var(--cyan);cursor:pointer">';
  h+='<span style="font-size:10px;color:var(--t3);min-width:32px;text-align:right">130%</span>';
  h+='<span id="fontScaleLabel" style="font-size:12px;font-weight:700;color:var(--cyan);min-width:44px;text-align:center">'+_curFs+'%</span>';
  h+='</div>';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">';
  [100,105,110,115,120,125,130].forEach(function(p){
    const sel=(p===_curFs);
    h+='<button class="btn btn-sm" data-action="applyFontScale" data-arg="'+p+'" style="font-size:10px'+(sel?';background:var(--cyan);color:#fff;border-color:var(--cyan)':'')+'">'+p+'%'+(p===115?' \u00B7 기본':'')+'</button>';
  });
  h+='</div>';
  h+='<div style="margin-top:10px;padding:10px 12px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr)"><span style="font-size:10px;color:var(--t3)">미리보기</span><div id="fontScalePreview" style="margin-top:4px;font-size:'+(12*_curFs/100).toFixed(1)+'px;color:var(--t1);line-height:1.6">보건일지 방문 기록 · 학생 이름 · 증상과 처치 내용</div></div>';
  h+='</div>';
  return h;
}

/* ═══ 🍏 버전·업데이트 통합 탭 ═══
   - 히어로: package.json 의 실제 버전 (id="appVerHero")
   - 로드맵: package.json 메이저.마이너로 자동 매칭. 3단(released / current / planned)
   - 업데이트 카드: 기존 _renderUpdateTabInline 로직 통합
   - 로고 이야기: 기존 그대로 */
function _renderVersionTab(){
  const VERSIONS=[
    {ver:'1.0',name:'Roma'},
    {ver:'1.1',name:'Firenze'},
    {ver:'1.2',name:'Bologna'},
    {ver:'1.3',name:'Venezia'},
    {ver:'1.4',name:'Ljubljana'},
    {ver:'1.5',name:'Bled'},
    {ver:'1.6',name:'Zagreb'},
    {ver:'1.7',name:'Milano'},
    {ver:'1.8',name:'Vienna'},
    {ver:'1.9',name:'Nha Trang'},
    {ver:'2.0',name:'Helsinki'},
    {ver:'2.1',name:'Reykjavik'},
    {ver:'2.2',name:'Myvatn'},
    {ver:'2.3',name:'Akureyri'}
  ];
  /* 히어로 배너 — 버전·코드명·업데이트 상태 단일 표시 (배지 텍스트는 _bindVersionTab 에서 채움) */
  let h='<div style="background:linear-gradient(135deg,#fef0f5,#fce4ec,#fef0f5);border-radius:16px;padding:32px 24px;text-align:center;margin-bottom:20px;position:relative;overflow:hidden">';
  h+='<div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,0.3),transparent 60%),radial-gradient(circle at 80% 80%,rgba(255,255,255,0.2),transparent 50%)"></div>';
  h+='<div style="position:relative;z-index:1">';
  h+='<div style="margin-bottom:8px;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.1))"><img src="assets/logo/logo_big.png" alt="로고" style="width:64px;height:64px;object-fit:contain"></div>';
  h+='<div style="font-size:22px;font-weight:900;color:#1a1a1a;letter-spacing:-0.5px">오렌지톡</div>';
  h+='<div id="appVerHero" style="display:inline-block;margin-top:8px;padding:4px 16px;background:rgba(0,0,0,0.06);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:20px;border:1px solid rgba(0,0,0,0.08)">'
    +'<span style="font-size:13px;font-weight:700;color:#333">v—</span>'
    +'</div>';
  /* 새 버전 안내 배지 — onUpdaterEvent 에서 동적 노출 */
  h+='<div id="appVerUpdateBadge" style="display:none;margin-top:8px"><span style="display:inline-block;padding:4px 14px;background:rgba(6,182,212,0.18);color:#0e7490;border:1px solid rgba(6,182,212,0.45);border-radius:20px;font-size:11px;font-weight:700">● 새 버전 사용 가능</span></div>';
  h+='</div></div>';

  /* "개발 이야기" 콘텐츠는 오렌지팜 → 튜토리얼 → 개발 이야기 하위 탭으로 이동했습니다. */

  /* 로드맵 — 3단(released / current / planned) */
  h+='<style>.rm-tile{aspect-ratio:1/1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;font-weight:700;transition:transform .2s,box-shadow .2s,border-color .2s;cursor:default;border:1px solid var(--bdr)}'
    +'.rm-tile:hover{transform:translateY(-3px) scale(1.05);box-shadow:0 6px 16px rgba(0,0,0,0.15);border-color:var(--cyan)}'
    +'.rm-released{background:rgba(6,182,212,0.08);color:var(--cyan);border-color:rgba(6,182,212,0.4)}'
    +'.rm-cur{background:linear-gradient(135deg,#db2777,#ec4899);color:#fff;box-shadow:0 2px 10px rgba(219,39,119,0.35);border:2px solid rgba(255,255,255,0.3)}'
    +'.rm-cur:hover{transform:translateY(-3px) scale(1.05);box-shadow:0 6px 20px rgba(219,39,119,0.5)}'
    +'.rm-planned{background:var(--bg2);color:var(--t3);opacity:0.7}'
    +'</style>';
  h+='<div style="padding:0 4px;margin-bottom:28px">';
  h+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px;display:flex;align-items:center;gap:6px"><span style="font-size:16px">🗺</span> 버전 로드맵</div>';
  /* 범례 */
  h+='<div style="display:flex;gap:12px;margin-bottom:12px;font-size:10px;color:var(--t3)">'
    +'<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(6,182,212,0.4);vertical-align:-1px;margin-right:4px"></span>출시 완료</span>'
    +'<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#db2777,#ec4899);vertical-align:-1px;margin-right:4px"></span>사용 중</span>'
    +'<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--bg2);border:1px solid var(--bdr);vertical-align:-1px;margin-right:4px"></span>계획</span>'
    +'</div>';
  h+='<div id="rmGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
  VERSIONS.forEach(function(v){
    /* 초기엔 모두 planned, _bindVersionTab 에서 실제 버전 받아 클래스 갱신 */
    h+='<div class="rm-tile rm-planned" data-rm-ver="'+v.ver+'">';
    h+='<div style="font-size:12px;font-weight:800;line-height:1.2">'+v.ver+'</div>';
    h+='<div style="font-size:9px;margin-top:2px;opacity:0.85">'+v.name+'</div>';
    h+='</div>';
  });
  h+='</div></div>';

  /* ═══ 업데이트 카드 — 기존 _renderUpdateTabInline 통합 ═══ */
  h+='<div style="padding:0 4px;margin-bottom:28px">';
  h+='<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:14px;display:flex;align-items:center;gap:6px"><span style="font-size:16px">🔄</span> 업데이트</div>';
  h+='<div style="background:var(--bg2);border-radius:14px;padding:20px;border:1px solid var(--bdr);margin-bottom:14px">';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">';
  h+='<div><div style="font-size:11px;color:var(--t3);margin-bottom:2px">설치된 버전</div>';
  h+='<div id="updCurrentVersion" style="font-size:16px;font-weight:800;color:var(--t1)">—</div></div>';
  h+='<button data-action="updaterCheck" id="updCheckBtn" style="padding:10px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f);transition:all .2s" data-hover-in="transform:translateY(-1px)" data-hover-out="transform:none">지금 확인</button>';
  h+='</div>';
  h+='<div id="updStatusBox" style="padding:12px 14px;background:var(--bg1);border:1px solid var(--bdr);border-radius:10px;font-size:11px;color:var(--t2);line-height:1.7">시작 시 자동으로 확인합니다.</div>';
  h+='<div id="updProgressWrap" style="display:none;margin-top:10px">';
  h+='<div style="height:8px;background:var(--bg1);border-radius:4px;overflow:hidden"><div id="updProgressBar" style="width:0;height:100%;background:linear-gradient(90deg,#06b6d4,#0891b2);transition:width .3s"></div></div>';
  h+='<div id="updProgressText" style="font-size:10px;color:var(--t3);margin-top:4px;text-align:right">0%</div>';
  h+='</div>';
  h+='<div id="updInstallWrap" style="display:none;margin-top:12px">';
  h+='<button data-action="updaterInstall" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#db2777,#ec4899);color:#fff;font-size:13px;font-weight:800;cursor:pointer;font-family:var(--f)">지금 설치</button>';
  h+='<div style="font-size:10px;color:var(--t3);margin-top:6px;text-align:center">지금 설치하지 않아도 앱을 종료할 때 자동으로 설치됩니다.</div>';
  h+='</div>';
  h+='</div>';
  if(window.__isWebBrowser){
    /* 웹 클라이언트(동료 PC) 에서는 자동 업데이트 자체가 호스트 Electron 만의 기능이므로
       위 카드의 "지금 확인" 버튼·진행률·설치 영역이 모두 의미가 없다.
       회색 박스 자리에 그 사실을 명시적으로 안내해 사용자가 혼란을 겪지 않게 한다. */
    h+='<div style="background:var(--bg2);border-radius:14px;padding:14px 18px;border:1px solid var(--bdr);font-size:10.5px;color:var(--t3);line-height:1.8">'
      +'<div>• 이 영역은 호스트 PC에서 표시되며 클라이언트의 웹브라우저에서는 표시되지 않습니다.</div>'
    +'</div>';
  }
  h+='</div>';

  h+='</div>';

  return h;
}

/* ═══ 🔐 오렌지톡 인증코드 탭 ═══
 * 1 PC = 1 인증코드. 사용자가 오렌지팜 마이페이지에서 본인 코드 확인 후 입력 → 1회 검증.
 * 검증 통과 시 userData/license.dat 에 토큰 저장 → 다음 실행부터 통신 0.
 * 재발급은 유선(1588-3711) + 사유 설명 후 1회 가능. */
function _renderCdkeyTab(){
  /* 현재 인증 상태 — license.dat 또는 localStorage 로컬 마커 (구현 전 기본 = 미인증) */
  let _licInfo=null;
  try{
    const _raw=localStorage.getItem('ec_cdkey_license');
    if(_raw)_licInfo=JSON.parse(_raw);
  }catch(_){}
  const _isVerified=!!(_licInfo && _licInfo.key && _licInfo.verifiedAt);

  let h='<div style="padding:0 4px;max-width:980px">';

  /* ── 헤더 (그라데이션 배경 + 자물쇠 아이콘) ── */
  h+='<div style="position:relative;overflow:hidden;background:linear-gradient(135deg,rgba(6,182,212,0.05) 0%,rgba(14,116,144,0.08) 50%,rgba(8,145,178,0.04) 100%);border:1px solid var(--bdr);border-radius:16px 16px 0 0;padding:28px 32px 26px;display:flex;align-items:center;gap:18px;border-bottom:none">';
  h+='<div style="width:58px;height:58px;border-radius:16px;background:linear-gradient(135deg,#0891b2,#0e7490);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;box-shadow:0 8px 20px rgba(6,182,212,0.30),inset 0 1px 0 rgba(255,255,255,0.20);position:relative;z-index:1">🔐</div>';
  h+='<div style="flex:1;position:relative;z-index:1">';
  h+='<div style="margin:0;font-size:21px;font-weight:800;color:var(--t1);letter-spacing:-0.3px">오렌지톡 인증코드</div>';
  h+='<div style="margin:5px 0 0;font-size:12px;color:var(--t3);font-weight:600;line-height:1.6">이 PC 에서 단 1회만 인증하시면 됩니다. 한 PC 당 하나의 인증코드 (1 PC = 1 코드).</div>';
  h+='</div></div>';

  /* ── 본문 ── */
  h+='<div style="background:var(--card);border:1px solid var(--bdr);border-top:none;border-radius:0 0 16px 16px;padding:28px 32px 32px;display:grid;gap:22px">';

  /* 정책 웰컴 박스 */
  h+='<div style="background:linear-gradient(135deg,rgba(6,182,212,0.04) 0%,rgba(34,197,94,0.04) 100%);border:1px solid rgba(6,182,212,0.18);border-radius:13px;padding:20px 24px;display:flex;gap:16px;align-items:flex-start">';
  h+='<div style="font-size:26px;flex-shrink:0;margin-top:1px;filter:drop-shadow(0 2px 4px rgba(6,182,212,0.20))">🤝</div>';
  h+='<div style="flex:1;font-size:12px;color:var(--t2);line-height:1.85;font-weight:600">';
  h+='<strong style="color:var(--t1);font-weight:800">오렌지팜 주식회사</strong>에서는 보건선생님들께 선의로 <strong style="color:var(--t1);font-weight:800">김재웅 선생님</strong>과 함께 구매 금액에 따른 일체의 차등 없이 <span style="color:var(--cyan);font-weight:800">무료로 사용</span>할 수 있도록 프로그램을 개발하였습니다. 다만, 다른 목적으로 누군가에 의한 <strong style="color:var(--t1);font-weight:800">코드 분해 또는 비정상적 사용</strong>을 철저히 막고자 부득이 <span style="color:var(--cyan);font-weight:800">1인 1PC 인증코드</span> 를 통한 유효성 검증을 실시하게 된 점을 양해 부탁드립니다.';
  h+='</div></div>';

  /* ── 인증 상태 카드 ── */
  if(_isVerified){
    const _dt=new Date(_licInfo.verifiedAt);
    const _dtStr=_dt.getFullYear()+'년 '+(_dt.getMonth()+1)+'월 '+_dt.getDate()+'일 ('+'일월화수목금토'[_dt.getDay()]+') '+String(_dt.getHours()).padStart(2,'0')+':'+String(_dt.getMinutes()).padStart(2,'0');
    h+='<div style="border-radius:14px;padding:22px 26px;display:flex;align-items:center;gap:18px;border:1.5px solid rgba(34,197,94,0.40);background:linear-gradient(135deg,rgba(34,197,94,0.10) 0%,rgba(34,197,94,0.04) 100%)">';
    h+='<div style="width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;flex-shrink:0;color:#fff;background:linear-gradient(135deg,#16a34a,#15803d);box-shadow:0 4px 12px rgba(0,0,0,0.10)">✓</div>';
    h+='<div style="flex:1;min-width:0">';
    h+='<div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#16a34a">Verified</div>';
    h+='<div style="font-size:16px;font-weight:800;margin:5px 0 4px;color:var(--t1)">이 PC 는 인증되었습니다</div>';
    h+='<div style="font-size:12px;color:var(--t2);line-height:1.6;font-weight:600">인증 일시: <strong style="color:var(--t1)">'+escHtml(_dtStr)+'</strong></div>';
    h+='</div>';
    h+='<div style="font-family:var(--fm);font-size:15px;font-weight:800;padding:10px 16px;background:var(--card);border:1.5px solid #16a34a;border-radius:10px;letter-spacing:2px;color:var(--t1);flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.04)">'+escHtml(_licInfo.key)+'</div>';
    h+='</div>';
  } else {
    h+='<div style="border-radius:14px;padding:22px 26px;display:flex;align-items:center;gap:18px;border:1.5px solid rgba(245,158,11,0.40);background:linear-gradient(135deg,rgba(245,158,11,0.10) 0%,rgba(251,191,36,0.04) 100%)">';
    h+='<div style="width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;flex-shrink:0;color:#fff;background:linear-gradient(135deg,#f59e0b,#b45309);box-shadow:0 4px 12px rgba(0,0,0,0.10)">!</div>';
    h+='<div style="flex:1;min-width:0">';
    h+='<div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#d97706">Authentication Required</div>';
    h+='<div style="font-size:16px;font-weight:800;margin:5px 0 4px;color:var(--t1)">아직 인증되지 않았습니다</div>';
    h+='<div style="font-size:12px;color:var(--t2);line-height:1.6;font-weight:600">프로그램을 시작할 때 나타나는 인증 화면에서 인증코드를 입력해 인증을 완료해 주세요.</div>';
    h+='</div></div>';
  }

  /* ── 정책 카드 3개 ── */
  h+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">';
  /* 카드 1: 1 PC = 1 코드 */
  h+='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:13px;padding:20px 20px 18px;box-shadow:0 2px 6px rgba(15,23,42,0.03)">';
  h+='<div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:12px;background:rgba(6,182,212,0.10);color:var(--cyan)">🖥️</div>';
  h+='<div style="font-size:12.5px;font-weight:800;margin-bottom:7px;color:var(--t1)">1 PC = 1 인증코드</div>';
  h+='<div style="font-size:11px;line-height:1.7;color:var(--t2);font-weight:600">하나의 인증코드는 한 대의 PC 에서만 사용할 수 있습니다. 다른 컴퓨터에 설치하시려면 별도의 인증코드가 필요합니다.</div>';
  h+='</div>';
  /* 카드 2: 1회 유효성 검사 */
  h+='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:13px;padding:20px 20px 18px;box-shadow:0 2px 6px rgba(15,23,42,0.03)">';
  h+='<div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:12px;background:rgba(34,197,94,0.10);color:#16a34a">🔄</div>';
  h+='<div style="font-size:12.5px;font-weight:800;margin-bottom:7px;color:var(--t1)">1회 유효성 검사</div>';
  h+='<div style="font-size:11px;line-height:1.7;color:var(--t2);font-weight:600">이 PC 에서 단 한 번만 인증하시면 됩니다. 같은 PC 에서의 업데이트·재설치 시에는 자동으로 통과됩니다.</div>';
  h+='</div>';
  /* 카드 3: 재발급 = 유선 + 사유 */
  h+='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:13px;padding:20px 20px 18px;box-shadow:0 2px 6px rgba(15,23,42,0.03)">';
  h+='<div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:12px;background:rgba(220,38,38,0.08);color:#dc2626">📞</div>';
  h+='<div style="font-size:12.5px;font-weight:800;margin-bottom:7px;color:var(--t1)">재발급 = 유선 + 사유 설명</div>';
  h+='<div style="font-size:11px;line-height:1.7;color:var(--t2);font-weight:600">포맷·PC 교체 등으로 인증코드 재발급이 필요하시면, 오렌지팜에 유선 연락 후 <strong style="color:#dc2626;font-weight:800">사유를 설명</strong> 하셔야 합니다.</div>';
  h+='</div>';
  h+='</div>';

  /* ── 고객센터 박스 ── */
  h+='<div style="background:linear-gradient(135deg,rgba(245,158,11,0.05) 0%,rgba(217,119,6,0.04) 100%);border:1px solid rgba(245,158,11,0.22);border-radius:13px;padding:20px 26px;display:flex;gap:20px;align-items:center">';
  h+='<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 4px 12px rgba(245,158,11,0.30)">☎</div>';
  h+='<div style="flex:1">';
  h+='<div style="font-size:11px;font-weight:800;color:var(--t3);letter-spacing:1px;text-transform:uppercase">오렌지팜 고객센터</div>';
  h+='<div style="font-family:var(--fm);font-size:22px;font-weight:800;color:var(--t1);letter-spacing:1.5px;margin:2px 0 4px">1588-3711</div>';
  h+='<div style="font-size:11.5px;color:var(--t2);font-weight:600">평일 <strong style="color:var(--t1);font-weight:800">09:00 ~ 18:00</strong> · 점심시간 <strong style="color:var(--t1);font-weight:800">12:00 ~ 13:00</strong></div>';
  h+='</div></div>';

  h+='</div>'; /* 본문 카드 */
  h+='</div>'; /* 외곽 */
  return h;
}

/* 인증코드 탭 — post-render 이벤트 바인딩. 자동 하이픈(_4자리 입력 시 -) 부착. */
function _bindCdkeyTab(){
  const inp=document.getElementById('cdkeyInput');
  if(inp && !inp._cdkeyBound){
    inp._cdkeyBound=true;
    inp.addEventListener('input',function(){
      let v=String(this.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(v.length>4) v=v.slice(0,4)+'-'+v.slice(4,8);
      this.value=v;
      const _msg=document.getElementById('cdkeyMsg');
      if(_msg)_msg.style.display='none';
    });
    inp.addEventListener('keydown',function(ev){
      if(ev.key==='Enter'){ev.preventDefault();_cdkeyVerify();}
    });
    inp.focus();
  }
}

/* 인증코드 검증 — 형식 검사 후 https://api.school114.org/verify 호출.
 * 성공 시 ec_cdkey_license (json) + ec_cdkey + DB common 에 영구 저장. 같은 PC 에서는 재검증 X.
 * 정책: 검증 통과 = 그 즉시 서버에서 해당 키 "사용됨" 마킹 (원자적). 재발급은 오렌지팜 유선. */
async function _cdkeyVerify(){
  const inp=document.getElementById('cdkeyInput');
  const msg=document.getElementById('cdkeyMsg');
  if(!inp||!msg)return;
  const key=String(inp.value||'').trim().toUpperCase();
  msg.style.display='';
  /* 버튼 비활성화 — 중복 클릭 시 같은 키를 두 번 사용해버리는 사고 방지 */
  const btn=document.querySelector('[data-action="cdkey-verify"]');
  if(btn){btn.disabled=true; btn.style.opacity='0.6'; btn.style.cursor='wait';}
  msg.style.color='#0891b2';
  msg.textContent='⏳ 인증 서버에 확인 중입니다…';

  let res;
  try{ res=await verifyCdkey(key); }
  catch(_){ res={ valid:false, message:'인증 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' }; }

  /* 성공 → 1.2초 후 "인증됨" 상태로 재렌더 */
  if(res.valid){
    msg.style.color='#16a34a';
    msg.textContent='✓ '+res.message;
    setTimeout(function(){
      try{
        if(typeof renderSettingsPanel==='function') renderSettingsPanel('cdkey');
        else if(typeof window.renderSettingsPanel==='function') window.renderSettingsPanel('cdkey');
      }catch(_){}
    }, 1200);
    return;
  }

  /* 실패(형식·네트워크·rate limit·유효하지않음) → 버튼 복구 + 메시지 */
  if(btn){btn.disabled=false; btn.style.opacity=''; btn.style.cursor='';}
  msg.style.color='#dc2626';
  msg.textContent='⚠ '+res.message;
}

/* ═══ 📜 저작권 탭 ═══ */
function _renderCopyrightTab(){
  let h='<div style="padding:0 4px">';
  /* 영문 */
  h+='<div style="background:var(--bg2);border-radius:14px;padding:24px;border:1px solid var(--bdr);margin-bottom:16px">';
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:16px;display:flex;align-items:center;gap:6px"><span style="font-size:16px">📜</span> Copyright</div>';
  h+='<div style="font-size:12px;color:var(--t2);line-height:1.9">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:8px">Copyright (c) 2026 OrangePharm Co., Ltd. All rights reserved.</div>';
  h+='<div style="margin-bottom:12px">This software is proprietary. It is <b>not</b> open source. Your use of this software is governed by the End-User License Agreement (EULA).</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">Non-commercial internal use (free)</div>';
  h+='<div>You may install and use this software, free of charge, solely for non-commercial health-office work at a school or similar institution where you are employed or which you manage.</div>';
  h+='</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">Prohibited</div>';
  h+='<div>Redistribution, resale, reverse engineering, decompilation, source extraction, derivative works, and any commercial use (including enterprise deployment, paid services, or advertising/promotional use) without a separate written license.</div>';
  h+='</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">Commercial license — contact required</div>';
  h+='<div>Enterprise deployment, bundled distribution, inclusion in paid services, advertising partnerships, sponsorships and similar commercial arrangements require a separate written license agreement with OrangePharm Co., Ltd.</div>';
  h+='</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">Reserved rights</div>';
  h+='<div>OrangePharm Co., Ltd. reserves the right to sell commercial licenses, release paid or enterprise editions, and place advertising, sponsored content, or partner links inside the software or its distribution channel.</div>';
  h+='</div>';
  h+='<div style="font-size:11px;color:var(--t3)">Inquiries: please contact OrangePharm Co., Ltd.</div>';
  h+='</div></div>';

  /* 한글 */
  h+='<div style="background:var(--bg2);border-radius:14px;padding:24px;border:1px solid var(--bdr)">';
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin-bottom:16px;display:flex;align-items:center;gap:6px"><span style="font-size:16px">📜</span> 저작권</div>';
  h+='<div style="font-size:12px;color:var(--t2);line-height:1.9">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:8px">저작권 (c) 2026 오렌지팜 주식회사. All rights reserved.</div>';
  h+='<div style="margin-bottom:12px">본 소프트웨어는 <b>독점(비오픈소스) 소프트웨어</b>이며, 최종 사용자 사용권 계약(EULA) 에 따라 사용할 수 있습니다.</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">비상업적 내부 사용 (무상)</div>';
  h+='<div>본인 또는 소속 기관의 내부 보건 업무 수행 목적으로 무상 사용할 수 있습니다. 사용자는 본인이 근무·관리하는 기관 내에서 자유롭게 설치·사용할 수 있습니다.</div>';
  h+='</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">금지 행위</div>';
  h+='<div>재배포·재판매, 역공학·디컴파일·소스코드 추출, 파생 저작물 작성, 경쟁 제품 개발 활용, 그리고 사전 서면 동의 없는 일체의 상업적 이용(기업 납품, 유료 서비스, 광고·홍보 수단 활용 등) 은 금지됩니다.</div>';
  h+='</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">상업 라이선스 — 사전 문의 필수</div>';
  h+='<div>기업·법인의 도입, 다수 기관 일괄 배포, 유상 서비스에의 포함, 광고·스폰서십·파트너십 제휴 등 상업적 이용을 원하는 경우, 사전에 오렌지팜에 문의해 별도의 상업 라이선스 계약을 체결해야 합니다.</div>';
  h+='</div>';
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">권리 유보</div>';
  h+='<div>오렌지팜 주식회사는 본 사용권에 명시적으로 부여되지 아니한 모든 권리를 유보합니다. 특히 유상 라이선스의 제3자 판매, 유료·기업용 버전 출시, 소프트웨어 또는 배포 채널 내 광고·스폰서 콘텐츠·파트너 링크 게재 권리가 포함됩니다.</div>';
  h+='</div>';
  /* 📦 오픈소스 구성요소 고지 — LICENSE/LICENSE-KO 제8조 및 동봉 NOTICE 파일과 일치 (2026-07-03) */
  h+='<div style="background:var(--bg1);border-radius:10px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--bdr)">';
  h+='<div style="font-weight:700;color:var(--t1);margin-bottom:6px">📦 오픈소스 구성요소</div>';
  h+='<div style="margin-bottom:8px">본 소프트웨어는 독점이나, 다음 제3자 오픈소스 구성요소를 포함하며 각 라이선스를 준수합니다. 아래 라이선스는 해당 구성요소에 한해 적용됩니다.</div>';
  h+='<div style="font-size:11px;color:var(--t2);line-height:1.95">';
  h+='<b style="color:var(--t1)">Apache-2.0</b> — SheetJS(xlsx), pdf.js, googleapis<br>';
  h+='<b style="color:var(--t1)">MIT</b> — Electron, better-sqlite3, jsPDF, html2canvas, ExcelJS, Express, ws, multer, compression, electron-updater, qrcode-generator, Twemoji(국기)<br>';
  h+='<b style="color:var(--t1)">BSD-3-Clause</b> — Chromium (Electron 내장)<br>';
  h+='<b style="color:var(--t1)">SIL OFL 1.1</b> — Pretendard 글꼴<br>';
  h+='<b style="color:var(--t1)">외부 데이터</b> — 공공데이터포털(기상청·에어코리아·심평원·응급의료), 나이스(NEIS), Kakao Maps, Open-Meteo';
  h+='</div>';
  h+='<div style="font-size:10.5px;color:var(--t3);margin-top:8px">상세 라이선스 전문은 배포물의 NOTICE 파일 및 각 프로젝트 웹사이트에서 확인할 수 있습니다.</div>';
  h+='</div>';
  h+='<div style="font-size:11px;color:var(--t3)">문의는 오렌지팜을 통해 주시기 바랍니다.</div>';
  /* 고객센터 박스 — 인증코드 탭과 동일 (사용자 요청 2026-05-20) */
  h+='<div style="background:linear-gradient(135deg,rgba(245,158,11,0.05) 0%,rgba(217,119,6,0.04) 100%);border:1px solid rgba(245,158,11,0.22);border-radius:13px;padding:20px 26px;display:flex;gap:20px;align-items:center;margin-top:14px">';
  h+='<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 4px 12px rgba(245,158,11,0.30)">☎</div>';
  h+='<div style="flex:1">';
  h+='<div style="font-size:11px;font-weight:800;color:var(--t3);letter-spacing:1px;text-transform:uppercase">오렌지팜 고객센터</div>';
  h+='<div style="font-family:var(--fm);font-size:22px;font-weight:800;color:var(--t1);letter-spacing:1.5px;margin:2px 0 4px">1588-3711</div>';
  h+='<div style="font-size:11.5px;color:var(--t2);font-weight:600">평일 <strong style="color:var(--t1);font-weight:800">09:00 ~ 18:00</strong> · 점심시간 <strong style="color:var(--t1);font-weight:800">12:00 ~ 13:00</strong></div>';
  h+='</div></div>';
  h+='</div></div>';

  h+='</div>';
  return h;
}

/* ═══ 🔑 API 키 관리 탭 ═══ */
function _renderApiKeysTab(){
  let h='<div class="settings-panel-title">🔑 API Key 관리</div>';
  h+='<div class="settings-panel-desc">공공데이터포털에서 발급받은 API 키를 한곳에서 관리합니다.</div>';


  /* API 키란 무엇인가 — 아코디언 */
  h+='<div class="cc" style="padding:0;margin-bottom:14px;overflow:hidden">';
  h+='<div data-action="toggleAccordion" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;user-select:none;background:var(--bg2);border-radius:12px 12px 0 0" data-hover-in="background:var(--hover)" data-hover-out="background:var(--bg2)">';
  h+='<span style="font-size:16px">\u2753</span><span style="font-size:13px;font-weight:700;color:var(--t1);flex:1">API 키란 무엇인가요? (처음이시면 꼭 읽어주세요)</span><span class="acc-arrow" style="font-size:10px;color:var(--t3)">\u25B6</span></div>';
  h+='<div style="display:none">';
  h+='<div style="padding:0 16px 16px;font-size:11px;color:var(--t2);line-height:1.9">';
  h+='<p style="margin-bottom:10px"><b style="color:var(--t1)">API 키가 뭔가요?</b><br>API 키는 외부 서비스(기상청, 에어코리아, 식약처 등)에서 데이터를 가져오기 위한 <b>본인 전용 인증 번호</b>입니다.<br>마치 도서관 회원증처럼, 이 번호가 있어야 해당 서비스의 데이터를 이용할 수 있습니다.</p>';
  h+='<p style="margin-bottom:10px"><b style="color:var(--t1)">왜 각자 발급받아야 하나요?</b><br>공공데이터는 무료이지만, 너무 많은 요청이 한꺼번에 몰리지 않도록 <b>개인별 인증키</b>를 발급합니다.<br>하나의 키로 하루 약 10,000번 요청할 수 있어 학교 1곳에서 사용하기엔 충분합니다.</p>';
  h+='<p style="margin-bottom:10px"><b style="color:var(--t1)">발급 방법 (3분이면 됩니다)</b></p>';
  h+='<div style="padding:10px 14px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr);margin-bottom:10px">';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="font-size:16px;flex-shrink:0">1\uFE0F\u20E3</span><span><b>data.go.kr 가입</b><br><a style="color:var(--cyan);cursor:pointer" data-action="openExternal" data-arg="https://www.data.go.kr/">공공데이터포털 (data.go.kr)</a>에 접속하여 회원가입합니다.</span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="font-size:16px;flex-shrink:0">2️⃣</span><span><b>원하는 API 검색 → "활용 신청"</b><br>예: "기상청 단기예보" 검색 → 해당 API 페이지 → <b>활용 신청</b> 버튼 클릭</span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="font-size:16px;flex-shrink:0">3️⃣</span><span><b>활용 목적 작성</b><br>"보건교사용 보건일지 프로그램에서 날씨/미세먼지/약품 정보 조회" 등으로 간단히 적으면 됩니다.</span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px"><span style="font-size:16px;flex-shrink:0">4️⃣</span><span><b>승인 → 인증키 복사</b><br>대부분 <b>자동 승인</b> (즉시). 마이페이지 → 활용 신청 현황에서 "일반 인증키"를 복사하여 아래에 붙여넣으면 끝!</span></div>';
  h+='</div>';
  h+='<p style="font-size:10px;color:var(--t3)">💡 발급받지 않아도 프로그램의 다른 기능은 모두 정상 동작합니다. API 키는 날씨·미세먼지·약품 정보 등 부가 기능에만 필요합니다.</p>';
  h+='</div></div></div>';

  /* ── 공공데이터포털 API 키 카드들 — 입력 + 반영 버튼 일체형 ── */
  /* 반영 상태 판별 — 현재 값과 이전에 "반영"했을 때 저장한 값이 일치하면 ✓ 완료 */
  function _isApplied(lsKey){
    const cur=localStorage.getItem(lsKey)||'';
    const applied=localStorage.getItem(lsKey+'_applied')||'';
    return cur!==''&&cur===applied;
  }
  function _applyBtnHtml(lsKey){
    const done=_isApplied(lsKey);
    const bg=done?'#16a34a':'var(--cyan)';
    const label=done?'✓ 완료':'반영';
    return '<button type="button" data-api-apply="'+escHtml(lsKey)+'" style="padding:0 14px;border:none;border-radius:6px;background:'+bg+';color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s">'+label+'</button>';
  }
  function _apiCard(o){
    const key=localStorage.getItem(o.lsKey)||'';
    const applied=_isApplied(o.lsKey);
    const badgeLabel=applied?'✓ 반영 완료':(key?'⚠ 반영 필요':'미등록');
    const badgeBg=applied?'rgba(34,197,94,0.1)':(key?'rgba(245,158,11,0.1)':'rgba(156,163,175,0.1)');
    const badgeColor=applied?'#16a34a':(key?'#d97706':'#94a3b8');
    let c='<div class="cc" style="padding:16px;margin-bottom:12px">';
    c+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:18px">'+o.icon+'</span><div><div style="font-size:13px;font-weight:700;color:var(--t1)">'+o.title+'</div><div style="font-size:10px;color:var(--t3)">'+o.desc+'</div></div><span style="margin-left:auto;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:'+badgeBg+';color:'+badgeColor+'">'+badgeLabel+'</span></div>';
    if(o.masked&&key){
      /* 마스킹된 상태 — readonly 제거: focus 시 원본 키 표시 → 수정/삭제 가능. data-save-key/data-db-key 도 추가해 generic blur listener 가 동작하도록 한다.
         이전에 readonly 가 박혀있어 식약처 키를 사용자가 단독 삭제할 수 없던 버그를 해결. */
      c+='<div style="display:flex;gap:6px;margin-bottom:6px">';
      c+='<input class="form-input" type="text" value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'+escHtml(key.slice(-8))+'" placeholder="'+o.placeholder+'" style="flex:1;font-size:11px" data-save-key="'+o.lsKey+'" data-db-key="'+o.dbKey+'" data-rerender="apikeys" data-masked-key="1">';
      c+=_applyBtnHtml(o.lsKey);
      c+='</div>';
    } else {
      /* 입력 + 반영 버튼 한 줄 */
      c+='<div style="display:flex;gap:6px;margin-bottom:6px">';
      c+='<input class="form-input" type="text" value="'+escHtml(key)+'" placeholder="'+o.placeholder+'" style="flex:1;font-size:11px" data-save-key="'+o.lsKey+'" data-db-key="'+o.dbKey+'" data-rerender="apikeys">';
      c+=_applyBtnHtml(o.lsKey);
      c+='</div>';
    }
    c+='<div style="font-size:10px;color:var(--t2);line-height:1.7;margin-top:4px">';
    c+='<a style="color:var(--cyan);cursor:pointer;font-weight:600" data-action="openExternal" data-arg="'+o.link+'">👉 '+o.linkLabel+'</a>';
    if(o.howTo)c+='<br><span style="color:var(--t3)">'+o.howTo+'</span>';
    c+='</div>';
    c+='</div>';
    return c;
  }

  /* ── 날씨/미세먼지 알림 설정 (최상단) ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:0 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">🌡 날씨 / 미세먼지 알림 설정</div>';
  const weatherSource=localStorage.getItem('ec_weather_source')||'auto';
  const userRegion=localStorage.getItem('ec_user_region')||'';
  const airStation=localStorage.getItem('ec_airkorea_station')||'';
  h+='<div class="cc" style="padding:16px;margin-bottom:12px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">날씨 데이터 소스</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:14px">';
  h+='<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="weatherSrc" value="auto" '+(weatherSource==='auto'?'checked':'')+' data-save-radio="ec_weather_source" style="accent-color:var(--cyan)">자동 (IP 기반)</label>';
  h+='<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="weatherSrc" value="kma" '+(weatherSource==='kma'?'checked':'')+' data-save-radio="ec_weather_source" style="accent-color:var(--cyan)">기상청 API</label>';
  h+='</div>';
  /* 지역명 (헤더 우측 상단 표시용) */
  const regionApplied=_isApplied('ec_user_region');
  const regionBadge=regionApplied?'<span style="margin-left:6px;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(34,197,94,0.1);color:#16a34a;font-weight:700">✓ 반영 완료</span>':(userRegion?'<span style="margin-left:6px;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(245,158,11,0.1);color:#d97706;font-weight:700">⚠ 반영 필요</span>':'<span style="margin-left:6px;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(156,163,175,0.1);color:#94a3b8;font-weight:700">미등록</span>');
  const regionBtnBg=regionApplied?'#16a34a':'var(--cyan)';
  const regionBtnLabel=regionApplied?'✓ 완료':'반영';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px;display:flex;align-items:center">지역명 <span style="color:var(--t3);font-weight:500;font-size:10px;margin-left:4px">(헤더 우측 상단 표시)</span>'+regionBadge+'</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:6px">';
  h+='<input id="wsRegionInput" class="form-input" value="'+escHtml(userRegion)+'" placeholder="예: 서울특별시, 부여군, 수원시" style="flex:1;font-size:11px" data-save-key="ec_user_region">';
  h+='<button id="wsRegionApply" type="button" data-weather-apply="region" style="padding:0 16px;border:none;border-radius:6px;background:'+regionBtnBg+';color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s">'+regionBtnLabel+'</button>';
  h+='</div>';
  h+='<div style="font-size:10px;color:var(--t3);margin-bottom:14px;line-height:1.6">직접 입력하거나, 측정소명 반영 시 자동으로 채워집니다.</div>';
  /* 미세먼지 측정소명 */
  const stationApplied=_isApplied('ec_airkorea_station');
  const stationBadge=stationApplied?'<span style="margin-left:6px;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(34,197,94,0.1);color:#16a34a;font-weight:700">✓ 반영 완료</span>':(airStation?'<span style="margin-left:6px;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(245,158,11,0.1);color:#d97706;font-weight:700">⚠ 반영 필요</span>':'<span style="margin-left:6px;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(156,163,175,0.1);color:#94a3b8;font-weight:700">미등록</span>');
  const stationBtnBg=stationApplied?'#16a34a':'var(--cyan)';
  const stationBtnLabel=stationApplied?'✓ 완료':'반영';
  h+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px;display:flex;align-items:center">미세먼지 측정소명'+stationBadge+'</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:6px">';
  h+='<input id="wsStationInput" class="form-input" value="'+escHtml(airStation)+'" placeholder="예: 만촌동, 당진시청사" style="flex:1;font-size:11px" data-save-key="ec_airkorea_station">';
  h+='<button id="wsStationApply" type="button" data-weather-apply="station" style="padding:0 16px;border:none;border-radius:6px;background:'+stationBtnBg+';color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s">'+stationBtnLabel+'</button>';
  h+='</div>';
  h+='<div style="font-size:11px;color:var(--t2);line-height:1.7;margin-top:2px">측정소명을 입력하면 미세먼지 정보가 표시되고, 위 지역명도 자동으로 시·군 단위로 채워집니다.</div>';
  h+='<a href="#" data-action="openExternal" data-arg="https://www.airkorea.or.kr/web/stationInfo" style="display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:10px 14px;border:1.5px solid var(--cyan);border-radius:8px;background:rgba(6,182,212,0.08);color:var(--cyan);font-size:12px;font-weight:700;text-decoration:none;transition:all .15s;cursor:pointer">🔍 측정소명을 모르시나요? 여기를 눌러 확인<span style="margin-left:auto;font-size:13px">↗</span></a>';
  h+='<div style="font-size:10px;color:var(--t3);margin-top:8px;line-height:1.6">시·도 → 시·군·구 선택 후 가까운 측정소명을 입력하세요</div>';
  h+='</div>';

  /* ── 날씨/미세먼지 API ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">🌤 날씨 / 미세먼지 API</div>';
  h+=_apiCard({icon:'🌤',title:'기상청 단기예보 API',desc:'상단 헤더 날씨 정보 표시',lsKey:'ec_kma_api_key',dbKey:'kma_api_key',placeholder:'기상청 API 인증키 입력',link:'https://www.data.go.kr/data/15084084/openapi.do',linkLabel:'data.go.kr에서 "기상청_단기예보" 발급받기',howTo:'data.go.kr 가입 → "기상청 단기예보" 검색 → 활용 신청 → 마이페이지에서 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'});
  h+=_apiCard({icon:'🏭',title:'에어코리아 미세먼지 API',desc:'상단 헤더 미세먼지 농도 표시',lsKey:'ec_airkorea_api_key',dbKey:'airkorea_api_key',placeholder:'에어코리아 API 인증키 입력',link:'https://www.data.go.kr/data/15073861/openapi.do',linkLabel:'data.go.kr에서 "에어코리아_미세먼지" 발급받기',howTo:'data.go.kr → "에어코리아 대기오염정보" 검색 → 활용 신청 → 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'});
  /* 자외선지수(생활기상지수) — 별도 서비스 활용신청 필요. 비워두면 단기예보 키를 그대로 사용. (사용자 요청 2026-06-17) */
  h+=_apiCard({icon:'🌞',title:'기상청 자외선지수 API (생활기상지수)',desc:'상단 헤더 회전문구 자외선지수 표시 (비우면 위 단기예보 키 사용)',lsKey:'ec_uv_api_key',dbKey:'uv_api_key',placeholder:'자외선(생활기상지수) 인증키 — 단기예보 키와 같아도 됩니다',link:'https://www.data.go.kr/data/15085288/openapi.do',linkLabel:'data.go.kr에서 "기상청_생활기상지수 조회서비스(자외선지수)" 발급',howTo:'위 링크 → 활용 신청 → 마이페이지에서 일반 인증키 복사.<br>※ 단기예보와 <b>별도 서비스</b>라, 같은 키라도 이 서비스에 활용신청을 따로 해야 자외선이 표시됩니다.<br>활용목적 \'기타\'+\'업무\' → 동의 → \'활용신청\'. (좌표→지역 변환은 의료기관용 카카오 키 재사용)'});

  /* ── 식약처 ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">💊 식약처 API</div>';
  h+=_apiCard({icon:'💊',title:'식약처 의약품정보 API (e약은요)',desc:'투약 시 약품 효능·용법·주의사항 조회',lsKey:'ec_drug_api_key',dbKey:'drug_api_key',placeholder:'식약처 API 인증키 입력',link:'https://www.data.go.kr/data/15075057/openapi.do',linkLabel:'data.go.kr에서 "의약품개요정보(e약은요)" 발급받기',howTo:'data.go.kr → "의약품개요정보" 검색 → 활용 신청 → 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'});

  /* 약품 정보 전체 업데이트 — 식약처 API 카드 바로 아래. 보건일지 설정에도 동일한 버튼 있음. */
  h+='<div class="cc" style="padding:14px 16px;margin-bottom:12px;border:1.5px dashed rgba(6,182,212,0.35);background:rgba(6,182,212,0.04)">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      +'<span style="font-size:18px">🔄</span>'
      +'<div style="flex:1">'
        +'<div style="font-size:13px;font-weight:700;color:var(--t1)">약품 정보 캐시 관리</div>'
        +'<div style="font-size:10px;color:var(--t3)">시스템 약품 전체를 식약처 e약은요 API 로 (재)조회해 JSON 에 저장. 빠진 건 채우고 있는 건 최신화하며, <b>수동 추가한 약품은 보존</b>됩니다.</div>'
      +'</div>'
      +'<span id="setMedCacheBadgeApi" style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:rgba(156,163,175,0.1);color:#94a3b8">확인 중…</span>'
    +'</div>'
    +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      +'<button id="setMedApiUpdateBtn" style="padding:6px 14px;font-size:11px;font-weight:700;border:1px solid var(--cyan);border-radius:6px;background:rgba(6,182,212,0.08);color:var(--cyan);cursor:pointer;font-family:var(--f)" data-tooltip="시스템 약품 전체를 e약은요 API로 (재)조회·최신화합니다. 빠진 건 채우고 있는 건 갱신하며, 수동 추가한 약품은 보존됩니다." data-tooltip-instant="1">📥 약품정보 전체 불러오기 · 업데이트</button>'
      +'<div id="setMedApiStatus" style="flex:1;min-width:160px;font-size:10px;color:var(--t3);font-family:var(--fm)"></div>'
    +'</div>'
  +'</div>';

  /* ── 나이스(NEIS) — 급식·학사일정·시간표 공용 인증키. 의료기관과 무관, 독립 섹션 (2026-06-17) ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">🍽️ 나이스(NEIS) — 급식·학사일정·시간표</div>';
  h+=_apiCard({icon:'🍽️',title:'나이스(NEIS) Open API',desc:'학교 급식(조·중·석) 팝업 + 학사일정 캘린더 + 시간표 검색',lsKey:'ec_neis_api_key',dbKey:'neis_api_key',placeholder:'나이스 Open API 인증키 입력',link:'https://open.neis.go.kr',linkLabel:'open.neis.go.kr 에서 인증키 발급받기',howTo:"open.neis.go.kr 가입 → 인증키 신청서 작성. 권장 입력값:<br>· 소속: <b>본인 학교명</b> &nbsp;· 사용자구분: <b>교사/교수</b><br>· <b>E-mail 수신여부: 체크</b> &nbsp;· 기관여부: <b>N</b><br>· 활용용도: <b>업무 활용</b> &nbsp;· 신청유형: <b>개발계정</b><br>· 서비스명: <b>없음</b> &nbsp;· <b>서비스URL: 비워둠</b><br>→ 신청 후 발급된 인증키를 마이페이지에서 복사 → 여기에 붙여넣기.<br>이 키 하나로 급식·학사일정·시간표가 모두 동작합니다(시간표는 초·중·고 학교급에 맞는 서비스가 자동 적용)."});

  /* ── 감염병 현황 (질병관리청, data.go.kr) — 2026-06-17 ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">🦠 감염병 현황 (질병관리청)</div>';
  h+=_apiCard({icon:'🦠',title:'질병관리청 전수신고 감염병 발생현황 API',desc:'대시보드 감염병 유행 현황 위젯 (지역별·기간별·연령별)',lsKey:'ec_kdca_api_key',dbKey:'kdca_api_key',placeholder:'질병관리청 감염병 API 인증키 입력',link:'https://www.data.go.kr/data/15139178/openapi.do',linkLabel:'data.go.kr에서 "전수신고 감염병 발생현황" 발급받기',howTo:'data.go.kr → "전수신고 감염병 발생현황" 검색 → 활용 신청 → 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'});

  /* ── 의료기관 ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">🏥 의료기관</div>';

  /* ── 카카오 개발자 API (REST + JavaScript 두 키) — 학교 주소가 카카오에 의존하므로 카카오를 먼저 ── */
  const kakaoRest=localStorage.getItem('ec_kakao_rest_api_key')||'';
  const kakaoJs=localStorage.getItem('ec_kakao_js_api_key')||'';
  const restApplied=_isApplied('ec_kakao_rest_api_key');
  const jsApplied=_isApplied('ec_kakao_js_api_key');
  const bothApplied=restApplied&&jsApplied;
  const anyApplied=restApplied||jsApplied;
  const hasAny=kakaoRest||kakaoJs;
  const statusLabel=bothApplied?'✓ 반영 완료':anyApplied?'⚠ 일부만 반영':hasAny?'⚠ 반영 필요':'미등록';
  const statusBg=bothApplied?'rgba(34,197,94,0.1)':(anyApplied||hasAny)?'rgba(245,158,11,0.1)':'rgba(156,163,175,0.1)';
  const statusColor=bothApplied?'#16a34a':(anyApplied||hasAny)?'#d97706':'#94a3b8';
  h+='<div class="cc" style="padding:16px;margin-bottom:12px">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:18px">🗺</span><div><div style="font-size:13px;font-weight:700;color:var(--t1)">카카오 개발자 API <span style="font-size:10px;color:var(--t3);font-weight:500">(REST + JavaScript 두 키 필요)</span></div><div style="font-size:10px;color:var(--t3)">의료기관 탐색 지도 · 주소 자동완성 · 병원/약국 키워드 검색</div></div><span style="margin-left:auto;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:'+statusBg+';color:'+statusColor+'">'+statusLabel+'</span></div>';
  /* REST API 키 입력 + 반영 버튼 */
  h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin:10px 0 3px">REST API 키</div>';
  h+='<div style="display:flex;gap:6px;margin-bottom:6px">';
  h+='<input class="form-input" type="text" value="'+escHtml(kakaoRest)+'" placeholder="카카오 REST API 키 입력 (32자리)" style="flex:1;font-size:11px" data-save-key="ec_kakao_rest_api_key" data-db-key="kakao_rest_api_key" data-rerender="apikeys">';
  h+=_applyBtnHtml('ec_kakao_rest_api_key');
  h+='</div>';
  /* JavaScript 키 입력 + 반영 버튼 */
  h+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin:10px 0 3px">JavaScript 키</div>';
  h+='<div style="display:flex;gap:6px;margin-bottom:6px">';
  h+='<input class="form-input" type="text" value="'+escHtml(kakaoJs)+'" placeholder="카카오 JavaScript 키 입력 (32자리)" style="flex:1;font-size:11px" data-save-key="ec_kakao_js_api_key" data-db-key="kakao_js_api_key" data-rerender="apikeys">';
  h+=_applyBtnHtml('ec_kakao_js_api_key');
  h+='</div>';
  /* 발급 안내 */
  h+='<div style="margin-top:12px;padding:12px 14px;background:linear-gradient(135deg,rgba(250,204,21,0.08),rgba(250,204,21,0.04));border:1px solid rgba(250,204,21,0.3);border-radius:8px">';
  h+='<div style="font-size:12px;font-weight:700;color:#ca8a04;margin-bottom:8px">🔑 카카오 API 키 발급 방법 (약 3분)</div>';
  h+='<div style="font-size:12px;color:var(--t2);line-height:1.7">';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="flex-shrink:0;font-weight:700">①</span><span><b>카카오 계정으로 로그인</b> — <a style="color:var(--cyan);cursor:pointer;font-weight:700" data-action="openExternal" data-arg="https://developers.kakao.com">https://developers.kakao.com</a> 접속 후 로그인</span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="flex-shrink:0;font-weight:700">②</span><span><b>앱 생성</b> — 좌측 상단 <b>"앱"</b> 클릭 → 우측 상단 <b>[+ 앱 생성]</b> 클릭 → 다음 정보 입력 후 [저장]<br><span style="display:inline-block;margin-top:4px;padding:8px 12px;background:rgba(0,0,0,0.04);border-radius:4px;line-height:1.8;font-size:11.5px">· <b>앱 이름</b>: 자유롭게 입력 <span style="color:var(--t3)">(아무 이름 가능)</span><br>· <b>회사명</b>: <b>"개인"</b>이라 입력 <span style="color:var(--t3)">(학교명이나 본인 이름은 전보내신 때 깜빡 잊고 안 바꿀 수 있어 비추천)</span><br>· <b>카테고리</b>: <b style="color:#0d9488">교육</b> 선택 <span style="color:var(--t3)">(드롭다운)</span><br>· <b>사업자등록번호</b>: 비워두거나 "개인" 선택 가능</span></span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="flex-shrink:0;font-weight:700">③</span><span><b>플랫폼 등록 — Web 대표 도메인 추가</b> <span style="color:#dc2626;font-weight:700">(필수)</span> — 좌측 사이드바 <b>"앱 → 플랫폼"</b> 클릭 → <b>Web 플랫폼 등록</b> → <b style="color:var(--cyan)">사이트 도메인</b>에 <b>학교 홈페이지 URL</b>(예: <code style="background:rgba(0,0,0,0.05);padding:1px 5px;border-radius:3px">https://○○.school.kr</code>) 입력 → [저장]<br><span style="display:inline-block;margin-top:4px;padding:8px 12px;background:rgba(220,38,38,0.06);border-radius:4px;line-height:1.7;font-size:11.5px;color:#b91c1c;font-weight:600">⚠ 도메인 미등록 시 학교 주소 자동완성·의료기관 탐색이 결과 0건으로 표시됩니다.</span></span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="flex-shrink:0;font-weight:700">④</span><span><b>앱 키 복사</b> — 좌측 사이드바 <b>"앱 → 앱 키"</b> 클릭 → <b style="color:var(--cyan)">REST API 키</b>와 <b style="color:var(--cyan)">JavaScript 키</b>를 각각 복사</span></div>';
  h+='<div style="display:flex;align-items:flex-start;gap:8px"><span style="flex-shrink:0;font-weight:700">⑤</span><span><b>위에 두 키 붙여넣기</b> — 위 두 입력칸에 복사한 값을 각각 붙여넣으면 끝!</span></div>';
  h+='</div>';
  h+='<div style="margin-top:10px;padding:10px 12px;background:rgba(0,0,0,0.04);border-radius:6px;font-size:11.5px;color:var(--t2);line-height:1.7"><b style="color:var(--t1)">💡 참고:</b> 카카오 계정 1개당 앱 10개까지 무료, 각 API 하루 100,000건 무료. 보건교사 업무용으로는 충분합니다.</div>';
  h+='</div>';
  h+='</div>';

  /* 학교 주소 입력 — 카카오 API 아래에 배치 (자동완성·좌표 변환에 카카오 키 필요) */
  const schoolAddr=localStorage.getItem('ec_school_address')||'';
  const addrLabel=schoolAddr?'✓ 입력됨':'미입력';
  const addrBg=schoolAddr?'rgba(34,197,94,0.1)':'rgba(156,163,175,0.1)';
  const addrColor=schoolAddr?'#16a34a':'#94a3b8';
  h+='<div class="cc" style="padding:16px;margin-bottom:12px">';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:18px">📍</span><div><div style="font-size:13px;font-weight:700;color:var(--t1)">기준위치(학교) 주소</div><div style="font-size:10px;color:var(--t3)">의료기관 탐색의 기준 위치로 사용됩니다 (자동완성·좌표 변환은 위 카카오 API 키 필요)</div></div><span style="margin-left:auto;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:'+addrBg+';color:'+addrColor+'">'+addrLabel+'</span></div>';
  h+='<div style="position:relative">';
  h+='<div style="display:flex;gap:6px;margin-bottom:6px">';
  h+='<input class="form-input" id="settingsSchoolAddr" type="text" value="'+escHtml(schoolAddr)+'" placeholder="예: 대구광역시 북구 칠곡중앙대로 0000" style="flex:1;font-size:11px" data-save-key="ec_school_address" data-db-key="school_address" data-rerender="apikeys">';
  h+=_applyBtnHtml('ec_school_address');
  h+='</div>';
  h+='<div id="settingsAddrDrop" style="position:absolute;left:0;right:0;top:calc(100% - 4px);background:var(--card);border:1px solid var(--bdr);border-radius:12px;max-height:200px;overflow-y:auto;z-index:100;display:none;box-shadow:0 8px 24px rgba(0,0,0,0.12)"></div>';
  h+='</div>';
  h+='<div style="font-size:10px;color:var(--t3)">도로명 주소, 지번 주소, 학교명 모두 입력 가능합니다. 입력 시 자동완성됩니다.</div>';
  h+='</div>';

  h+=_apiCard({icon:'⚕',title:'건강보험심사평가원 병원/약국 정보 API',desc:'의료기관 탐색 — 병원·약국 검색',lsKey:'ec_hira_api_key',dbKey:'hira_api_key',placeholder:'심사평가원 API 인증키 입력',link:'https://www.data.go.kr/data/15001698/openapi.do',linkLabel:'data.go.kr에서 "병원정보서비스" 발급받기',howTo:'data.go.kr → "건강보험심사평가원 병원정보" 검색 → 활용 신청 → 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'});
  h+=_apiCard({icon:'🚑',title:'국립중앙의료원 응급의료정보 API',desc:'의료기관 탐색 — 응급실 검색',lsKey:'ec_emergency_api_key',dbKey:'emergency_api_key',placeholder:'응급의료 API 인증키 입력',link:'https://www.data.go.kr/data/15000563/openapi.do',linkLabel:'data.go.kr에서 "응급의료정보조회서비스" 발급받기',howTo:'data.go.kr → "응급의료정보" 검색 → 활용 신청 → 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'});

  /* ── 의료기관 반경 기반 대량 캐싱 — 병원/약국/응급실 한 번에 미리 받아 저장 ── */
  h+='<div class="cc" style="padding:16px;margin-bottom:12px;border:1.5px dashed rgba(6,182,212,0.35);background:rgba(6,182,212,0.04)">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      +'<span style="font-size:18px">📥</span>'
      +'<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--t1)">반경 30km 의료기관 미리 불러오기 (캐싱)</div>'
        +'<div style="font-size:10px;color:var(--t3)">한 번 불러와 두면 의료기관 탐색·증상처방 병원 검색이 <b>즉시 반응</b> (인터넷 없이 동작)</div></div>'
      +'<span id="medfacCacheBadge" style="font-size:9px;padding:2px 8px;border-radius:10px;font-weight:700;background:rgba(156,163,175,0.1);color:#94a3b8">확인 중…</span>'
    +'</div>'
    +'<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
      +'<span style="font-size:11px;color:var(--t2);font-weight:600">반경 30km 고정 · 진료과 18개 + 약국 + 응급실</span>'
      +'<button id="medfacBulkFetchBtn" style="padding:6px 14px;font-size:11px;font-weight:700;border:1px solid var(--cyan);border-radius:6px;background:rgba(6,182,212,0.08);color:var(--cyan);cursor:pointer;font-family:var(--f)">📥 불러오기 시작</button>'
      +'<button id="medfacUpdateBtn" style="display:none;padding:6px 14px;font-size:11px;font-weight:700;border:1px solid #16a34a;border-radius:6px;background:rgba(34,197,94,0.08);color:#16a34a;cursor:pointer;font-family:var(--f)" title="기존 캐시를 최신 정보로 교체">🔄 업데이트</button>'
      +'<button id="medfacClearCacheBtn" style="padding:6px 14px;font-size:11px;font-weight:700;border:1px solid var(--rs);border-radius:6px;background:transparent;color:var(--rs);cursor:pointer;font-family:var(--f)" title="캐시 삭제">🗑 캐시 삭제</button>'
      +'<div id="medfacBulkStatus" style="flex:1;min-width:160px;font-size:10px;color:var(--t3);font-family:var(--fm)"></div>'
    +'</div>'
    +'<div id="medfacBulkProgressWrap" style="display:none;height:4px;background:var(--bg2);border-radius:2px;overflow:hidden">'
      +'<div id="medfacBulkProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--cyan),#22c55e);transition:width .3s ease"></div>'
    +'</div>'
    +'<div style="font-size:9.5px;color:var(--t3);margin-top:8px;line-height:1.6">'
      +'• 이 버튼은 <b>건강보험심사평가원·국립중앙의료원 API 키가 반영된 상태</b>에서만 동작합니다.<br>'
      +'• 진료과 18개(내과·정형외과·소아청소년과·안과·이비인후과·치과·응급의학과 등) × 병원 다중 페이지 + 약국 + 응급실 순차 조회 — <b>최대 20분</b> 소요 (공공 API 특성상 응답 속도가 느릴 수 있습니다).<br>'
      +'• 한 번 완료하면 인터넷 없이도 <b>전체보기·진료과별·약국·응급실</b> 모두 즉시 렌더됩니다.<br>'
      +'• <b>주기적으로 이 버튼을 다시 눌러 최신 정보로 갱신</b>할 수 있습니다 (기존 캐시는 완전 대체, 누적되지 않음).<br>'
      +'• 진행 중 <b>설정창을 닫거나 다른 기능(일지 작성·검색 등)을 계속 사용해도 무방</b>합니다. 백그라운드로 진행되며 완료 시 알림이 표시됩니다.<br>'
      +'• 30km 밖으로 지도를 확대·이동할 경우에는 기존처럼 실시간 API 조회로 자동 전환됩니다.'
    +'</div>'
  +'</div>';

  /* ── 공휴일 정보 — KASI 특일정보 API ── */
  h+='<div style="font-size:14px;font-weight:800;color:var(--t1);margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--cyan)">📅 공휴일 정보</div>';
  h+=_apiCard({
    icon:'📅',
    title:'한국천문연구원 특일정보 API',
    desc:'전국 달력의 공휴일·대체공휴일을 자동 갱신 (모든 연도)<br>이 프로그램에서 발견할 수 있는 모든 달력에 공휴일·대체공휴일을 표시합니다.',
    lsKey:'ec_holiday_api_key',
    dbKey:'holiday_api_key',
    placeholder:'특일정보 API 인증키 입력',
    link:'https://www.data.go.kr/data/15012690/openapi.do',
    linkLabel:'data.go.kr에서 "특일정보" 발급받기',
    howTo:'data.go.kr → "한국천문연구원 특일정보" 검색 → 활용 신청 → 일반 인증키 복사<br>활용목적은 \'기타\' 선택 후 \'업무\' 기입 → 첨부파일은 생략 → 이용허락범위 \'동의합니다\' 체크 → \'활용신청\' 클릭.'
  });
  /* 캐시 비우기 버튼 (한 줄, 점선 카드) — 임시공휴일이 갑자기 발표된 경우 강제 재호출용. */
  h+='<div class="cc" style="padding:12px 16px;margin-bottom:12px;border:1.5px dashed rgba(6,182,212,0.35);background:rgba(6,182,212,0.04)">'
    +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
      +'<span style="font-size:16px">🔄</span>'
      +'<div style="flex:1;min-width:160px">'
        +'<div style="font-size:12px;font-weight:700;color:var(--t1)">공휴일 캐시 새로고침</div>'
        +'<div style="font-size:10px;color:var(--t3)">임시공휴일·대체공휴일이 갑자기 발표되었을 때 캐시를 비우고 API에서 다시 받습니다.</div>'
      +'</div>'
      +'<button id="holidayCacheClearBtn" type="button" style="padding:6px 14px;font-size:11px;font-weight:700;border:1px solid var(--rs);border-radius:6px;background:transparent;color:var(--rs);cursor:pointer;font-family:var(--f);white-space:nowrap">🗑 캐시 비우기</button>'
      +'<div id="holidayCacheStatus" style="font-size:10px;color:var(--t3);font-family:var(--fm);flex-basis:100%"></div>'
    +'</div>'
  +'</div>';

  /* 하단 — 학교 이동 시 API 키 일괄 초기화 */
  h+='<div style="margin-top:24px;padding:16px;border:1px dashed rgba(239,68,68,0.35);border-radius:10px;background:rgba(239,68,68,0.03)">';
  h+='<div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px">🗑 API 키 전체 초기화</div>';
  h+='<div style="font-size:10px;color:var(--t3);line-height:1.7;margin-bottom:10px">학교 이동(전보) 등으로 이 PC의 모든 API 키를 초기화할 때 사용합니다. 보건일지 데이터(학생·기록 등)는 영향받지 않습니다.</div>';
  h+='<button id="apiKeysResetAllBtn" type="button" style="padding:8px 14px;border:1px solid rgba(239,68,68,0.4);border-radius:6px;background:#fff;color:#dc2626;font-size:11px;font-weight:700;cursor:pointer;transition:background .15s">모든 API 키 초기화</button>';
  h+='</div>';

  return h;
}

function _bindUpdateTab(){
  try {
    /* 현재 버전 표시 — 통합 탭의 히어로 + 업데이트 카드 + 로드맵 동시 갱신 */
    if (window.electronAPI && window.electronAPI.updaterGetVersion){
      window.electronAPI.updaterGetVersion().then(function(r){
        const ver=(r&&r.version)||'';
        /* 업데이트 카드 — 설치된 버전 */
        const el=document.getElementById('updCurrentVersion');
        if(el) el.textContent=ver?'v'+ver:'—';
        /* 히어로 배너 */
        const hero=document.getElementById('appVerHero');
        if(hero){
          /* "1.0.0-beta.5" → 메이저.마이너 = "1.0" → 코드명 매칭 */
          const mm=(ver.match(/^(\d+)\.(\d+)/)||[]).slice(1,3).join('.');
          const VERSIONS=[
            {ver:'1.0',name:'Roma'},{ver:'1.1',name:'Firenze'},{ver:'1.2',name:'Bologna'},
            {ver:'1.3',name:'Venezia'},{ver:'1.4',name:'Ljubljana'},{ver:'1.5',name:'Bled'},
            {ver:'1.6',name:'Zagreb'},{ver:'1.7',name:'Milano'},{ver:'1.8',name:'Vienna'},
            {ver:'1.9',name:'Nha Trang'},{ver:'2.0',name:'Helsinki'},{ver:'2.1',name:'Reykjavik'},
            {ver:'2.2',name:'Myvatn'},{ver:'2.3',name:'Akureyri'}
          ];
          const found=VERSIONS.find(function(v){return v.ver===mm;});
          const cn=found?found.name:'';
          hero.innerHTML='<span style="font-size:13px;font-weight:700;color:#333">v'+ver+'</span>'
            + (cn?'<span style="font-size:13px;color:#666;margin-left:6px">'+cn+'</span>':'');
          /* 로드맵 타일 상태 자동 적용 — released / current / planned */
          const tiles=document.querySelectorAll('[data-rm-ver]');
          /* 단순 비교를 위해 메이저·마이너 → 정수 인덱스 사용 */
          const _mmNum=function(v){const p=v.split('.');return parseInt(p[0],10)*100+parseInt(p[1],10);};
          const curNum=mm?_mmNum(mm):-1;
          tiles.forEach(function(t){
            const tv=t.dataset.rmVer; const tn=_mmNum(tv);
            t.classList.remove('rm-released','rm-cur','rm-planned');
            /* NOW 라벨 정리 */
            const oldNow=t.querySelector('[data-rm-now]'); if(oldNow) oldNow.remove();
            if(tn===curNum){
              t.classList.add('rm-cur');
              const now=document.createElement('div');
              now.setAttribute('data-rm-now','1');
              now.style.cssText='font-size:7px;margin-top:3px;padding:1px 6px;background:rgba(255,255,255,0.25);border-radius:8px;letter-spacing:0.5px';
              now.textContent='NOW';
              t.appendChild(now);
            } else if(tn<curNum){
              t.classList.add('rm-released');
            } else {
              t.classList.add('rm-planned');
            }
          });
        }
      }).catch(function(){});
    }
    /* 이벤트 구독 (중복 방지) */
    if (window._updUnsubscribe) { try { window._updUnsubscribe(); } catch(_){} }
    if (window.electronAPI && window.electronAPI.onUpdaterEvent){
      window._updUnsubscribe = window.electronAPI.onUpdaterEvent(function(kind, payload){
        const box=document.getElementById('updStatusBox');
        const progWrap=document.getElementById('updProgressWrap');
        const progBar=document.getElementById('updProgressBar');
        const progText=document.getElementById('updProgressText');
        const installWrap=document.getElementById('updInstallWrap');
        if(!box) return;
        const heroBadge=document.getElementById('appVerUpdateBadge');
        if (kind==='checking'){ box.textContent='업데이트 확인 중…'; }
        else if (kind==='available'){
          box.textContent='새 버전 v'+(payload&&payload.version||'?')+' 확인. 내려받는 중…';
          if(progWrap) progWrap.style.display='block';
          if(heroBadge){heroBadge.style.display='block';heroBadge.querySelector('span').textContent='● 새 버전 v'+(payload&&payload.version||'?')+' 사용 가능';}
        }
        else if (kind==='not-available'){
          box.textContent='현재 최신 버전을 사용 중입니다.';
          if(progWrap) progWrap.style.display='none';
          if(heroBadge) heroBadge.style.display='none';
        }
        else if (kind==='progress'){ if(progBar) progBar.style.width=(payload&&payload.percent||0)+'%'; if(progText) progText.textContent=(payload&&payload.percent||0)+'%'; }
        else if (kind==='downloaded'){
          box.textContent='새 버전 v'+(payload&&payload.version||'?')+' 내려받기 완료. 종료 시 설치됩니다.';
          /* 진행률 막대를 100% 로 채워 "완료" 를 잠깐 보인 뒤 설치 버튼으로 전환 — 차등 다운로드로
           *  막대가 중간에서 갑자기 사라져 보이던 현상 제거(2026-06-08). */
          if(progBar) progBar.style.width='100%';
          if(progText) progText.textContent='100%';
          setTimeout(function(){ if(progWrap) progWrap.style.display='none'; if(installWrap) installWrap.style.display='block'; }, 900);
          if(heroBadge){heroBadge.style.display='block';heroBadge.querySelector('span').textContent='✅ v'+(payload&&payload.version||'?')+' 내려받기 완료 · 종료 시 설치';heroBadge.querySelector('span').style.background='rgba(219,39,119,0.18)';heroBadge.querySelector('span').style.color='#9d174d';heroBadge.querySelector('span').style.borderColor='rgba(219,39,119,0.45)';}
        }
        else if (kind==='error'){ box.textContent='업데이트 확인 실패: '+(payload&&payload.message||'알 수 없는 오류'); }
      });
    }
  } catch(err){ console.warn('update tab bind 실패:', err && err.message); }
}


/* ═══ SHARED FUNCTIONS (kept in dispatcher) ═══ */

/* ── Image → PDF ── */

function setFontSize(size,el){document.documentElement.style.fontSize=size;localStorage.setItem('ec_fontsize',size);document.querySelectorAll('.font-size-opt').forEach(function(o){o.classList.remove('active');});if(el)el.classList.add('active');const pct=parseFloat(size)/100;if(pct>1){document.body.style.transformOrigin='top left';document.body.style.transform='scale('+pct+')';document.body.style.width=(100/pct)+'%';document.documentElement.style.overflowX='auto';document.documentElement.style.overflowY='auto';}else{document.body.style.transform='none';document.body.style.width='';document.documentElement.style.overflowX='';document.documentElement.style.overflowY='';}}
const _savedFontSize=localStorage.getItem('ec_fontsize');
if(_savedFontSize)document.documentElement.style.fontSize=_savedFontSize;


function saveSettings(){
  const sn=document.getElementById('setSchoolName');if(sn)S.settings.schoolName=sn.value;
  const n1=document.getElementById('nurseName1');if(n1)S.settings.nurse1=n1.value;
  if(S.settings.nurseCount>=2){const n2=document.getElementById('nurseName2');if(n2)S.settings.nurse2=n2.value;}
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
    window.electronAPI.jsonSaveCommon('settings',S.settings).catch(function(err){console.error('[DB] settings 저장 실패:',err);});
}



/* ═══ XLSX parser (shared) ═══ */
function parseXLSX(data){
  const wb=XLSX.read(data,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{defval:''});
}
export function triggerLocalTemplateDownload(relPath,downloadName){
  /* 사용자 요청(2026-05-18) — 양식 파일명에 타임스탬프 안 붙임. past_health_records.xlsx 같은 깔끔한 이름 그대로.
   *  (동일 파일명 충돌 시 OS 의 교체/유지 다이얼로그는 발생할 수 있음 — 의도된 UX) */
  const uniqueName = downloadName || '';
  const appPath='__app__/'+relPath;
  if(window.electronAPI&&window.electronAPI.readFile){
    window.electronAPI.readFile(appPath).then(function(res){
      if(res&&res.success&&res.data){
        const bin=atob(res.data);const arr=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
        const blob=new Blob([arr],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        const link=document.createElement('a');link.download=uniqueName;link.href=URL.createObjectURL(blob);link.click();
        return;
      }
      const a=document.createElement('a');a.href=relPath;a.download=uniqueName;document.body.appendChild(a);a.click();a.remove();
    }).catch(function(){
      const a=document.createElement('a');a.href=relPath;a.download=uniqueName;document.body.appendChild(a);a.click();a.remove();
    });
  } else {
    const a=document.createElement('a');a.href=relPath;a.download=uniqueName;document.body.appendChild(a);a.click();a.remove();
  }
}

/* ═══ ADVANCED SEARCH ═══ */
let _advSearchCallback=null;
/* 새 MacOS 스타일 상세 검색 UI 로 위임 (core/person-search-ui.js).
   기존 콜백 시그니처 callback(id) 유지 — 모든 호출 지점(일반일지·응급·감염·대여대장·커맨드팔레트) 그대로 동작.
   구 구현(advSwitchTab 등 헬퍼)은 dead code 로 남아있지만 제거는 후행 작업으로 미룸 (리스크 최소화). */
export function openAdvancedSearch(callback){
  _advSearchCallback=callback;
  openPersonSearch({
    title: '🔎 학생 또는 교직원 상세 검색',
    type: 'student',
    allowStaff: true,
    overlayId: 'advSearchOverlay',
    closeOnPick: true,
    showRegister: true,
    onPick: function(id){
      if(typeof callback === 'function'){ try{ callback(id); }catch(e){ console.warn('[advSearch cb]', e); } }
      _advSearchCallback = null;
    }
  });
}
function advSwitchTab(type){
  const tabStu=document.getElementById('advTabStu');
  const tabStaff=document.getElementById('advTabStaff');
  if(tabStu)tabStu.classList.toggle('active',type==='student');
  if(tabStaff)tabStaff.classList.toggle('active',type==='staff');
  const body=document.getElementById('advSearchBody');
  if(!body)return;
  if(type==='staff'){
    const staffList=sortStaffList(S.people.filter(function(s){return s.type==='staff';}));
    let html='<div style="display:flex;flex-wrap:wrap;gap:6px">';
    staffList.forEach(function(s){
      html+='<span data-action="advSelectPerson" data-arg="'+s.id+'" style="padding:6px 12px;border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--t1);background:var(--bg2);transition:all .15s" data-hover-in="borderColor:var(--cyan);background:var(--hover)" data-hover-out="borderColor:var(--bdr);background:var(--bg2)">'+(s.position||'교직원')+' '+s.name+'</span>';
    });
    html+='</div>';
    body.innerHTML=html;
    _bindDelegatedEvents(body);
  } else {
    /* 학교급/학과 위계: 학생 데이터에서 존재하는 level/department 수집 */
    const stuAll=S.people.filter(function(s){return s.type==='student'&&s.grade>0;});
    const hasLevel=stuAll.some(function(s){return s.level&&String(s.level).trim();});
    const hasDept=stuAll.some(function(s){return s.department&&String(s.department).trim();});
    if(hasLevel||hasDept){
      _advFilter={level:'',department:'',grade:null};
      _renderAdvHierarchy(body,stuAll,hasLevel,hasDept);
    } else {
      _renderAdvGradeList(body,stuAll);
    }
  }
}
let _advFilter={level:'',department:'',grade:null};
function _renderAdvHierarchy(body,stuAll,hasLevel,hasDept){
  const _LV={elementary:'초',middle:'중',high:'고',kindergarten:'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
  /* 라벨 열을 고정 너비로 정렬 — 버튼 행이 같은 좌측 기준선에서 시작 */
  const _labelCss='font-size:11px;color:var(--t2);font-weight:700;align-self:center;padding-right:4px';
  const _rowCss='display:flex;gap:6px;flex-wrap:wrap;align-items:center';
  let html='<div style="display:grid;grid-template-columns:60px 1fr;row-gap:8px;column-gap:8px;margin-bottom:10px">';
  /* 학교급 선택 — 유 → 초 → 중 → 고 → 대 순서로 정렬 */
  if(hasLevel){
    const levels=[];const seen={};
    stuAll.forEach(function(s){const l=s.level||'';if(l&&!seen[l]){seen[l]=1;levels.push(l);}});
    /* 한국어 약어로 매핑 후 정렬 우선순위 계산 */
    const _lvOrder={'유':0,'초':1,'중':2,'고':3,'대':4,'kindergarten':0,'elementary':1,'middle':2,'high':3};
    levels.sort(function(a,b){
      const oa=_lvOrder[a]!==undefined?_lvOrder[a]:(_lvOrder[_LV[a]]!==undefined?_lvOrder[_LV[a]]:99);
      const ob=_lvOrder[b]!==undefined?_lvOrder[b]:(_lvOrder[_LV[b]]!==undefined?_lvOrder[_LV[b]]:99);
      return oa-ob;
    });
    html+='<div style="'+_labelCss+'">학교급</div>';
    html+='<div style="'+_rowCss+'">';
    html+='<button class="btn btn-outline btn-sm" data-action="advPickLevel" data-arg="" style="font-weight:600;'+(_advFilter.level===''?'background:var(--cyan);color:#fff':'')+'">전체</button>';
    levels.forEach(function(l){
      const label=_LV[l]||l;
      html+='<button class="btn btn-outline btn-sm" data-action="advPickLevel" data-arg="'+l+'" style="font-weight:600;'+(_advFilter.level===l?'background:var(--cyan);color:#fff':'')+'">'+label+'</button>';
    });
    html+='</div>';
  }
  /* 학과 선택 (해당 학교급 내) */
  if(hasDept){
    const filtered=_advFilter.level?stuAll.filter(function(s){return s.level===_advFilter.level;}):stuAll;
    const depts=[];const seenD={};
    filtered.forEach(function(s){const d=s.department||'';if(d&&!seenD[d]){seenD[d]=1;depts.push(d);}});
    if(depts.length){
      html+='<div style="'+_labelCss+'">학과</div>';
      html+='<div style="'+_rowCss+'">';
      html+='<button class="btn btn-outline btn-sm" data-action="advPickDept" data-arg="" style="font-weight:600;'+(_advFilter.department===''?'background:var(--cyan);color:#fff':'')+'">전체</button>';
      depts.forEach(function(d){
        html+='<button class="btn btn-outline btn-sm" data-action="advPickDept" data-arg="'+escHtml(d)+'" style="font-weight:600;'+(_advFilter.department===d?'background:var(--cyan);color:#fff':'')+'">'+escHtml(d)+'</button>';
      });
      html+='</div>';
    }
  }
  /* 학년 (필터 반영) */
  const filtered=stuAll.filter(function(s){
    if(_advFilter.level&&s.level!==_advFilter.level)return false;
    if(_advFilter.department&&s.department!==_advFilter.department)return false;
    return true;
  });
  const stuGrades=filtered.map(function(s){return s.grade;});
  const unique=stuGrades.filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
  html+='<div style="'+_labelCss+'">학년</div>';
  html+='<div style="'+_rowCss+'">';
  const _gSel=_advFilter.grade;
  html+='<button class="btn btn-outline btn-sm" data-action="advSelectGrade" data-arg="0" style="font-weight:600;'+(_gSel===0?'background:var(--cyan);color:#fff':'')+'">전체</button>';
  unique.forEach(function(g){
    html+='<button class="btn btn-outline btn-sm" data-action="advSelectGrade" data-arg="'+g+'" style="font-weight:600;'+(_gSel===g?'background:var(--cyan);color:#fff':'')+'">'+g+'학년</button>';
  });
  html+='</div>';
  html+='</div><div id="advGradeBody"></div>';
  body.innerHTML=html;
  _bindDelegatedEvents(body);
  body.querySelectorAll('[data-action="advPickLevel"]').forEach(function(btn){
    btn.addEventListener('click',function(){_advFilter.level=btn.dataset.arg;_advFilter.department='';_advFilter.grade=null;_renderAdvHierarchy(body,stuAll,hasLevel,hasDept);});
  });
  body.querySelectorAll('[data-action="advPickDept"]').forEach(function(btn){
    btn.addEventListener('click',function(){_advFilter.department=btn.dataset.arg;_advFilter.grade=null;_renderAdvHierarchy(body,stuAll,hasLevel,hasDept);});
  });
}
function _renderAdvGradeList(body,stuAll){
  let grades=[];
  const sl=S.settings.schoolLevel||'elementary';
  if(sl==='kindergarten'){grades=[{v:3,l:'3세'},{v:4,l:'4세'},{v:5,l:'5세'},{v:6,l:'6세'}];}
  else if(sl==='special'){for(let g=1;g<=12;g++)grades.push({v:g,l:g+'학년'});}
  else{
    const stuGrades=stuAll.map(function(s){return s.grade;});
    const unique=stuGrades.filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
    unique.forEach(function(g){grades.push({v:g,l:g+'학년'});});
  }
  const _gSel=_advFilter.grade;
  let html='<div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap">';
  html+='<button class="btn btn-outline btn-sm" data-action="advSelectGrade" data-arg="0" style="font-weight:600;'+(_gSel===0?'background:var(--cyan);color:#fff':'')+'">전체</button>';
  grades.forEach(function(g){
    html+='<button class="btn btn-outline btn-sm" data-action="advSelectGrade" data-arg="'+g.v+'" style="font-weight:600;'+(_gSel===g.v?'background:var(--cyan);color:#fff':'')+'">'+g.l+'</button>';
  });
  html+='</div><div id="advGradeBody"></div>';
  body.innerHTML=html;
}
function advSelectGrade(grade){
  const body=document.getElementById('advGradeBody');if(!body)return;
  const gN=Number(grade);
  const isAllGrade=gN===0;
  /* 선택 상태 저장 + 버튼 하이라이트 */
  _advFilter.grade=gN;
  const searchBody=document.getElementById('advSearchBody');
  if(searchBody){
    searchBody.querySelectorAll('[data-action="advSelectGrade"]').forEach(function(btn){
      const bg=Number(btn.dataset.arg);
      if(bg===gN){btn.style.background='var(--cyan)';btn.style.color='#fff';}
      else{btn.style.background='';btn.style.color='';}
    });
  }
  /* 학년 비교는 느슨하게 + level/department 필터 반영, grade=0이면 전체 학년 */
  const stuByGrade=S.people.filter(function(s){
    if(s.type!=='student')return false;
    if(!isAllGrade&&Number(s.grade)!==gN)return false;
    if(_advFilter&&_advFilter.level&&s.level!==_advFilter.level)return false;
    if(_advFilter&&_advFilter.department&&s.department!==_advFilter.department)return false;
    return true;
  });
  if(!stuByGrade.length){
    body.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3);font-size:12px">해당 학년에 등록된 학생이 없습니다.</div>';
    return;
  }
  const classes={};
  /* 전체 학년: 학년-반 복합키로 그룹화 */
  stuByGrade.forEach(function(s){
    const ck=isAllGrade?(String(s.grade||'')+'-'+String(s.cls||'')):String(s.cls||'');
    if(!classes[ck])classes[ck]=[];classes[ck].push(s);
  });
  const clsKeys=Object.keys(classes).sort(function(a,b){
    if(isAllGrade){
      const pa=a.split('-'),pb=b.split('-');
      if(Number(pa[0])!==Number(pb[0]))return Number(pa[0])-Number(pb[0]);
      return Number(pa[1])-Number(pb[1]);
    }
    return Number(a)-Number(b);
  });
  /* 학과 전체 보기 + 다수 학과 섞여있으면 칩에 학과 약칭 prefix */
  const deptSet={};stuByGrade.forEach(function(s){if(s.department)deptSet[s.department]=1;});
  const showDeptPrefix=!(_advFilter&&_advFilter.department)&&Object.keys(deptSet).length>1;
  function _deptShort(d){const t=String(d||'').trim();return t?t.slice(0,3):'';}
  let html='<div id="advClassPanels" class="sv-class-list" style="display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 340px);overflow-y:auto;padding-right:4px;padding-bottom:16px;scrollbar-width:thin;scrollbar-color:rgba(6,182,212,0.4) transparent">';
  clsKeys.forEach(function(c){
    const sts=classes[c].sort(function(a,b){return a.num-b.num;});
    const gradePart=isAllGrade?c.split('-')[0]:String(grade);
    const clsPart=isAllGrade?c.split('-')[1]:c;
    html+='<div class="adv-cls-panel" data-cls="'+clsPart+'" data-grade-actual="'+gradePart+'" data-action="advSelectClass" data-grade="'+grade+'" style="border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;background:var(--bg2);cursor:pointer;transition:all .15s">';
    html+='<div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:6px">'+gradePart+'학년 '+clsPart+'반 ('+sts.length+'명)</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    sts.forEach(function(s){
      const prefix=showDeptPrefix&&s.department?(escHtml(_deptShort(s.department))+'-'):'';
      html+='<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--card);border:1px solid var(--bdrl);color:var(--t2)">'+prefix+s.num+'번 '+escHtml(s.name||'')+'</span>';
    });
    html+='</div></div>';
  });
  html+='</div>';
  body.innerHTML=html;
  body.querySelectorAll('[data-action="advSelectClass"]').forEach(function(el){
    el.addEventListener('click',function(){advSelectClass(Number(el.dataset.gradeActual||grade),el.dataset.cls);});
  });
}
function advSelectClass(grade,cls){
  const body=document.getElementById('advGradeBody');if(!body)return;
  const gN=Number(grade);
  /* 반: 한글 학급명(가람·나래) 지원 — 문자열 비교 (사용자 요청 2026-05-28). */
  const sts=S.people.filter(function(s){
    if(s.type!=='student'||Number(s.grade)!==gN||String(s.cls)!==String(cls))return false;
    if(_advFilter&&_advFilter.level&&s.level!==_advFilter.level)return false;
    if(_advFilter&&_advFilter.department&&s.department!==_advFilter.department)return false;
    return true;
  }).sort(function(a,b){return Number(a.num)-Number(b.num);});
  const deptSet={};sts.forEach(function(s){if(s.department)deptSet[s.department]=1;});
  const showDeptPrefix=!(_advFilter&&_advFilter.department)&&Object.keys(deptSet).length>1;
  function _deptShort(d){const t=String(d||'').trim();return t?t.slice(0,3):'';}
  let html='<div style="border:1px solid var(--cyan);border-radius:8px;padding:14px;background:var(--bg2)">';
  html+='<div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px">'+grade+'학년 '+cls+'반 ('+sts.length+'명) <span data-action="backToGrade" style="font-size:10px;color:var(--t3);cursor:pointer;margin-left:8px">← 반 목록으로</span></div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  sts.forEach(function(s){
    const isCare=s.status==='caution'||s.status==='watch';
    const prefix=showDeptPrefix&&s.department?(escHtml(_deptShort(s.department))+'-'):'';
    html+='<span data-action="advSelectPerson" data-id="'+s.id+'" data-care="'+(isCare?'1':'')+'" style="padding:6px 12px;border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--t1);background:var(--card);transition:all .15s'+(isCare?';border-color:var(--yl)':'')+'">'
      +prefix+s.num+'번 '+escHtml(s.name||'')+(isCare?' <span style="font-size:9px;color:var(--yl)">*요보호*</span>':'')+'</span>';
  });
  html+='</div></div>';
  body.innerHTML=html;
  const backBtn=body.querySelector('[data-action="backToGrade"]');
  if(backBtn)backBtn.addEventListener('click',function(){advSelectGrade(grade);});
  body.querySelectorAll('[data-action="advSelectPerson"]').forEach(function(el){
    el.addEventListener('click',function(e){e.stopPropagation();advSelectPerson(el.dataset.id);});
    const isCareEl=el.dataset.care==='1';
    el.addEventListener('mouseenter',function(){el.style.borderColor='var(--cyan)';el.style.background='var(--hover)';});
    el.addEventListener('mouseleave',function(){el.style.borderColor=isCareEl?'var(--yl)':'var(--bdr)';el.style.background='var(--card)';});
  });
}
function advSelectPerson(id){
  const ov=document.getElementById('advSearchOverlay');
  if(ov)closeModalGracefully(ov);
  if(_advSearchCallback)_advSearchCallback(id);
}

const _staffPriorityOrder=['교장','교감','행정실장','행정과장'];
export function sortStaffList(list){
  return list.slice().sort(function(a,b){
    const pa=_staffPriorityOrder.indexOf(a.position||'');
    const pb=_staffPriorityOrder.indexOf(b.position||'');
    if(pa>=0&&pb>=0) return pa-pb;
    if(pa>=0) return -1;
    if(pb>=0) return 1;
    return (a.name||'').localeCompare(b.name||'','ko');
  });
}
function showDeleteConfirmPopup(id){
  const s=getStu(id);
  if(!s)return;
  const label=s.type==='staff'
    ?(s.position||'교직원')+' '+escHtml(s.name)
    :escHtml(s.grade+'학년 '+s.cls+'반 '+s.num+'번 '+s.name);
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='deletePersonOverlay';
  ov.innerHTML='<div class="modal-content" style="width:360px;max-width:92vw;padding:28px 24px;text-align:center">'
    +'<div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:10px">👤 인원 삭제</div>'
    +'<div style="font-size:13px;color:var(--t2);margin-bottom:22px"><b style="color:var(--t1)">'+label+'</b><br><span style="color:var(--t3);font-size:12px">이 인원을 삭제하시겠습니까?</span></div>'
    +'<div style="display:flex;gap:10px;justify-content:center">'
    +'<button class="btn btn-sm" data-action="confirmDel" style="padding:8px 28px;background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.3);font-weight:700">예</button>'
    +'<button class="btn btn-outline btn-sm" data-action="cancelDel" style="padding:8px 28px">아니오</button>'
    +'</div></div>';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  function _escDel(e){if(e.key==='Escape'){const o=document.getElementById('deletePersonOverlay');if(o)closeModalGracefully(o);document.removeEventListener('keydown',_escDel);}}
  document.addEventListener('keydown',_escDel);
  document.body.appendChild(ov);
  ov.querySelector('[data-action="confirmDel"]').addEventListener('click',function(){confirmDeletePerson(id);});
  ov.querySelector('[data-action="cancelDel"]').addEventListener('click',function(){closeModalGracefully('deletePersonOverlay');});
}
function confirmDeletePerson(id){
  S.people=S.people.filter(function(x){return x.id!==id;});
  saveStudents();
  const ov=document.getElementById('deletePersonOverlay');
  if(ov){
    ov.querySelector('.modal-content').innerHTML='<div style="font-size:14px;font-weight:700;color:#16a34a;padding:20px 8px">✓ 해당 인원이 삭제되었습니다.</div>';
    setTimeout(function(){if(ov.parentNode)closeModalGracefully(ov);},1400);
  }
  bus.emit('render:daily');bus.emit('render:calendar');bus.emit('render:sidebar');
}

export function loadTabOrder(){
  const row=document.querySelector('.header-row2');
  if(!row)return;
  /* 앵커: 버전 배지 > nav-spacer. 배지가 항상 탭들의 오른쪽 끝에 위치하도록 버튼을 배지 앞에 삽입 */
  const anchor=row.querySelector('#appVersionBadge')||row.querySelector('.nav-spacer');
  /* 설정 패널과 동일한 캐노니컬 순서를 사용해 양쪽이 항상 일치 */
  const order=getCanonicalTabOrder();
  const vis=getTopMenuVisibility();
  order.forEach(function(view){
    const btn=row.querySelector('.nav-link[data-view="'+view+'"]');
    if(btn){
      btn.style.display=vis[view]===false?'none':'';
      if(anchor)row.insertBefore(btn,anchor);
    }
  });
}

function setSyncMode(mode,el){
  S.settings.syncMode=mode;
  el.closest('.form-group').querySelectorAll('.form-radio-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  saveSettings();
  const mb=document.getElementById('syncManualBtn');
  if(mb)mb.style.display=mode==='manual'?'block':'none';
  startSyncTimer();
}
let _syncTimer=null;
function startSyncTimer(){
  if(_syncTimer){clearInterval(_syncTimer);_syncTimer=null;}
  const mode=S.settings.syncMode||'1s';
  if(mode==='1s'){_syncTimer=setInterval(doSync,1000);}
  else if(mode==='3m'){_syncTimer=setInterval(doSync,180000);}
}
function doSync(){
  const mode=S.settings.syncMode||'1s';
  const now=new Date();
  const ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
  const el=document.getElementById('syncLastMsg');
  if(el)el.textContent='마지막 동기화: '+ts;
  if(mode!=='1s'){showSyncToast(ts);}
}
function doManualSync(){doSync();}
function showSyncToast(ts){
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:20px;right:20px;background:var(--card);border:1px solid var(--cyan);border-radius:8px;padding:10px 16px;font-size:11px;color:var(--t1);z-index:9999;box-shadow:var(--sh);animation:fadeIn .3s ease';
  t.innerHTML='☁️ 동기화 완료 <span style="color:var(--t3);margin-left:6px">'+escHtml(ts)+'</span>';
  document.body.appendChild(t);
  setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .4s';setTimeout(function(){t.remove();},400);},3000);
}

// Export
export function exportDiary(format){
  /* 보건일지 출력 팝업 열기 (diary-print-view.js의 openDiaryPrint) */
  if(typeof openDiaryPrint==='function') openDiaryPrint();
  else alert('보건일지 출력 기능을 불러오지 못했습니다.');
}
export function importData(){
  /* 설정 → 외부 데이터 가져오기로 이동 */
  if(typeof openSettings==='function') openSettings();
  setTimeout(function(){
    if(typeof switchSettingsCat==='function'){
      const item=document.querySelector('.settings-sidebar-item[data-cat="import"]');
      if(item) switchSettingsCat('import',item);
    }
  },200);
}

/* ═══ Google Drive 동기화 함수들 ═══ */
function _driveSyncBrowse(){
  return driveSyncManager.browse();
}
function _driveSyncFolderSelect(){
  return driveSyncManager.selectCurrentFolder();
}
function _driveSyncReset(){
  return driveSyncManager.reset();
}
function _driveSyncGetBackupData(){
  return null;
}
function _driveSyncUploadAll(){
  driveSyncManager.confirmAndUpload();
}
function _driveSyncDownloadAll(){
  driveSyncManager.confirmAndDownload();
}
async function _driveSyncInitAccountInfo(){
  const el=document.getElementById('driveSyncAccountInfo');
  if(!el)return;
  try{
    const sheetsUser=await window.electronAPI.sheetsGetUser();
    if(sheetsUser&&sheetsUser.email){
      el.innerHTML='<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#34a853;flex-shrink:0"></span>'
        +'<div><strong style="font-size:11px">'+escHtml(sheetsUser.email)+'</strong>'
        +'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(52,168,83,0.12);color:#34a853;margin-left:4px">연결됨</span>'
        +'<div style="font-size:9px;color:var(--t3);margin-top:1px">이 계정의 Google Drive에 저장됩니다</div></div></div>';
      return;
    }
    const mainUser=await window.electronAPI.getUserInfo();
    if(mainUser&&mainUser.email){
      el.innerHTML='<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--cyan);flex-shrink:0"></span>'
        +'<div><strong style="font-size:11px">'+escHtml(mainUser.email)+'</strong>'
        +'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(6,182,212,0.12);color:var(--cyan);margin-left:4px">기본 계정</span>'
        +'<div style="font-size:9px;color:var(--t3);margin-top:1px">이 계정의 Google Drive에 저장됩니다</div></div></div>';
      return;
    }
  }catch(e){}
  el.innerHTML='<span style="color:var(--red);font-size:10px">⚠ Google 계정이 연결되지 않았습니다. 아래 버튼으로 연결하세요.</span>';
}
async function _driveSyncConnectGoogle(){
  const el=document.getElementById('driveSyncAccountInfo');
  if(el)el.innerHTML='<span style="color:var(--t3)">Google 로그인 창을 확인하세요...</span>';
  try{
    const res=await window.electronAPI.googleLogin();
    if(res&&res.success&&res.user){
      bus.emit('toast:show',{text:'✅ Google 계정 연결 완료: '+res.user.email});
      _driveSyncInitAccountInfo();
    } else {
      bus.emit('toast:show',{text:'Google 로그인 실패: '+(res&&res.error||'취소됨')});
      _driveSyncInitAccountInfo();
    }
  }catch(e){
    bus.emit('toast:show',{text:'연결 오류: '+e.message});
    _driveSyncInitAccountInfo();
  }
}
async function _driveSyncSwitchGoogle(){
  const el=document.getElementById('driveSyncAccountInfo');
  if(el)el.innerHTML='<span style="color:var(--t3)">Google 로그인 창을 확인하세요...</span>';
  try{
    const res=await window.electronAPI.sheetsLogin();
    if(res&&res.success&&res.user){
      bus.emit('toast:show',{text:'✅ Drive 계정 변경: '+res.user.email});
      _driveSyncInitAccountInfo();
    } else {
      bus.emit('toast:show',{text:'계정 변경 실패: '+(res&&res.error||'취소됨')});
      _driveSyncInitAccountInfo();
    }
  }catch(e){
    bus.emit('toast:show',{text:'연결 오류: '+e.message});
    _driveSyncInitAccountInfo();
  }
}

/* ═══ Expose to global scope ═══ */

/* S.settingsLocked → S 객체 사용 */

/* ═══ 🌓 다크/라이트 모드 안내 탭 ═══ */
function _renderThemeInfoTab(){
  const isLight=document.body.classList.contains('light');
  let h='<div class="settings-panel-title">🌓 다크/라이트 모드</div>';
  h+='<div class="settings-panel-desc">현재 모드: <b style="color:var(--cyan)">'+(isLight?'☀️ 라이트 모드':'🌙 다크 모드')+'</b> · 종료 시 모드가 저장되어 다음 실행 때도 유지됩니다.</div>';

  /* 토글 버튼 */
  h+='<div class="cc" style="padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:14px">';
  h+='<button class="btn btn-primary" data-action="toggleTheme" style="padding:10px 24px;font-size:13px;font-weight:700">'+(isLight?'🌙 다크 모드로 전환':'☀️ 라이트 모드로 전환')+'</button>';
  h+='<span style="font-size:11px;color:var(--t3)">전환 시 0.3초 부드러운 애니메이션으로 전환됩니다.</span>';
  h+='</div>';

  /* ── 다크 모드 | 라이트 모드 탭 전환 ── */
  const _tDark=!isLight;
  const _tS='padding:10px 20px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--bdr);border-bottom:none;border-radius:8px 8px 0 0;transition:all .2s;user-select:none;';
  h+='<div style="display:flex;gap:0;margin-top:16px">';
  h+='<div id="_tiDark" data-action="tiSwitch" data-mode="dark" style="'+_tS+(_tDark?'background:var(--card);color:var(--t1);border-color:var(--bdr);position:relative;top:1px;z-index:1':'background:transparent;color:var(--t3);opacity:0.6')+'">🌙 다크 모드</div>';
  h+='<div id="_tiLight" data-action="tiSwitch" data-mode="light" style="'+_tS+(!_tDark?'background:var(--card);color:var(--t1);border-color:var(--bdr);position:relative;top:1px;z-index:1':'background:transparent;color:var(--t3);opacity:0.6')+'">☀️ 라이트 모드</div>';
  h+='</div>';

  /* 다크 설명 패널 */
  h+='<div id="_tiDarkPanel" style="border:1px solid var(--bdr);border-radius:0 8px 8px 8px;margin-top:-1px;display:'+(_tDark?'block':'none')+'">';
  h+='<div class="cc" style="padding:16px;margin:0;border:none;border-radius:0 8px 8px 8px;line-height:1.9">';
  h+='<p style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:10px">🌙 Midnight Navy</p>';
  h+='<p style="font-size:12px;color:var(--t1);margin-bottom:12px">오렌지톡의 다크 모드는 <b style="color:var(--cyan)">Midnight Navy</b> 스타일을 채택하고 있습니다. 의료·건강 분야에서 블루 톤은 신뢰감과 전문성을 상징하며, 장시간 보건실 업무 중에도 눈의 피로를 줄여줍니다.</p>';
  h+='<div style="padding:12px;border-radius:8px;background:#0c1220;border:1px solid #2a3a52;margin-bottom:14px">';
  h+='<div style="font-size:10px;font-weight:700;color:#b0bec5;margin-bottom:8px">색상 견본</div>';
  h+='<div style="display:flex;flex-direction:column;gap:4px">';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#0c1220;border:1px solid #2a3a52;flex-shrink:0"></span><span style="font-size:10px;color:#8ea4b8">배경 #0c1220</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#172135;border:1px solid #2a3a52;flex-shrink:0"></span><span style="font-size:10px;color:#8ea4b8">카드 #172135</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#f1f5f9;flex-shrink:0"></span><span style="font-size:10px;color:#f1f5f9">주 텍스트 #f1f5f9</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#b0bec5;flex-shrink:0"></span><span style="font-size:10px;color:#b0bec5">보조 텍스트 #b0bec5</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#8ea4b8;flex-shrink:0"></span><span style="font-size:10px;color:#8ea4b8">약한 텍스트 #8ea4b8</span></div>';
  h+='</div></div>';
  h+='<div style="font-size:11px;color:var(--t2);line-height:1.9">';
  h+='<p style="margin-bottom:8px"><b style="color:var(--t1)">💡 디자인 철학</b></p>';
  h+='<ul style="padding-left:18px;margin-bottom:0">';
  h+='<li><b>높은 대비율</b> — 보조 텍스트(#b0bec5)도 WCAG AA 기준(4.5:1)을 충족하여 고연령 보건교사분들도 편안하게 읽을 수 있습니다.</li>';
  h+='<li><b>네이비 톤 아이덴티티</b> — 의료·건강 분야에서 블루 계열은 차분함과 신뢰를 전달합니다. 시안(cyan) 액센트 컬러와 자연스러운 조화를 이룹니다.</li>';
  h+='<li><b>눈 피로 경감</b> — 순수 검정(#000) 대신 짙은 네이비(#0c1220)를 사용하여 LCD 모니터에서도 눈이 편합니다.</li>';
  h+='<li><b>인쇄 영역 보호</b> — 방문증·가정통신문 편집 캔버스는 항상 흰색을 유지하여 "보이는 그대로 인쇄"됩니다.</li>';
  h+='</ul></div></div></div>';

  /* 라이트 설명 패널 */
  h+='<div id="_tiLightPanel" style="border:1px solid var(--bdr);border-radius:0 8px 8px 8px;margin-top:-1px;display:'+(!_tDark?'block':'none')+'">';
  h+='<div class="cc" style="padding:16px;margin:0;border:none;border-radius:0 8px 8px 8px;line-height:1.9">';
  h+='<p style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:10px">☀️ Clean Daylight</p>';
  h+='<p style="font-size:12px;color:var(--t1);margin-bottom:12px">라이트 모드는 밝은 보건실 환경에서 <b style="color:#f59e0b">최적의 가독성</b>을 제공합니다. 순백 카드와 연한 회색 배경의 대비로 콘텐츠 영역이 자연스럽게 구분되며, 장시간 데이터 입력 시에도 시각적 피로를 줄입니다.</p>';
  h+='<div style="padding:12px;border-radius:8px;background:#f5f7fa;border:1px solid #d1d5db;margin-bottom:14px">';
  h+='<div style="font-size:10px;font-weight:700;color:#4a5568;margin-bottom:8px">색상 견본</div>';
  h+='<div style="display:flex;flex-direction:column;gap:4px">';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#f5f7fa;border:1px solid #d1d5db;flex-shrink:0"></span><span style="font-size:10px;color:#718096">배경 #f5f7fa</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#ffffff;border:1px solid #d1d5db;flex-shrink:0"></span><span style="font-size:10px;color:#718096">카드 #ffffff</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#1a1a2e;flex-shrink:0"></span><span style="font-size:10px;color:#1a1a2e">주 텍스트 #1a1a2e</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#4a5568;flex-shrink:0"></span><span style="font-size:10px;color:#4a5568">보조 텍스트 #4a5568</span></div>';
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:3px;background:#718096;flex-shrink:0"></span><span style="font-size:10px;color:#718096">약한 텍스트 #718096</span></div>';
  h+='</div></div>';
  h+='<div style="font-size:11px;color:var(--t2);line-height:1.9">';
  h+='<p style="margin-bottom:8px"><b style="color:var(--t1)">💡 디자인 철학</b></p>';
  h+='<ul style="padding-left:18px;margin-bottom:0">';
  h+='<li><b>순백 카드 + 연회색 배경</b> — 배경(#f5f7fa)과 카드(#ffffff)의 부드러운 대비로 콘텐츠 영역이 자연스럽게 떠오릅니다. 눈부심 없이 깨끗한 화면.</li>';
  h+='<li><b>진한 텍스트 대비</b> — 주 텍스트(#1a1a2e)와 보조 텍스트(#4a5568) 모두 WCAG AAA 기준을 초과 달성. 어떤 조명 환경에서도 선명하게 읽힙니다.</li>';
  h+='<li><b>투명 유리 상단 탭</b> — 상단 탭 버튼에 투명 유리 질감(backdrop-filter)을 적용하여 배경화면과 조화를 이루는 세련된 외관을 제공합니다.</li>';
  h+='<li><b>부드러운 그림자와 깊이감</b> — 카드와 패널에 미세한 그림자(box-shadow)를 적용해 평면적이지 않은 입체적 UI를 구현합니다.</li>';
  h+='<li><b>색상 발광 효과</b> — 선택된 상단 탭은 해당 색상의 은은한 글로우(glow)가 사방으로 퍼져 현재 위치를 우아하게 알려줍니다.</li>';
  h+='<li><b>인쇄 친화</b> — 밝은 배경이므로 화면 캡처 시에도 자연스럽고, 편집 캔버스는 항상 흰색으로 "보이는 그대로 인쇄"됩니다.</li>';
  h+='</ul></div></div></div>';

  /* 기타 안내 */
  h+='<div class="cc" style="padding:14px;margin-bottom:12px">';
  h+='<div style="font-size:11px;color:var(--t2);line-height:1.8">';
  h+='<p><b style="color:var(--t1)">⚡ 전환 방법</b></p>';
  h+='<ul style="padding-left:18px;margin-top:4px">';
  h+='<li>상단 우측 <b>🌙 다크모드 / ☀️ 라이트모드</b> 버튼 클릭</li>';
  h+='<li>또는 위의 전환 버튼 클릭</li>';
  h+='<li>종료 시 선택한 모드가 자동 저장되어 다음 실행 때도 유지됩니다.</li>';
  h+='</ul></div></div>';

  return h;
}

/* 다크/라이트 설명 탭 전환 */
function _tiSwitch(mode){
  const dTab=document.getElementById('_tiDark');
  const lTab=document.getElementById('_tiLight');
  const dP=document.getElementById('_tiDarkPanel');
  const lP=document.getElementById('_tiLightPanel');
  if(!dTab||!lTab||!dP||!lP)return;
  const isDark=mode==='dark';
  /* 탭 스타일 전환 */
  const activeS='background:var(--card);color:var(--t1);border-color:var(--bdr);position:relative;top:1px;z-index:1;opacity:1';
  const inactiveS='background:transparent;color:var(--t3);opacity:0.6';
  [dTab,lTab].forEach(function(t){t.style.transition='all 0.25s ease';});
  dTab.style.cssText+=';'+(isDark?activeS:inactiveS);
  lTab.style.cssText+=';'+(!isDark?activeS:inactiveS);
  /* 패널 페이드 전환 */
  const showing=isDark?dP:lP;
  const hiding=isDark?lP:dP;
  hiding.style.transition='opacity 0.2s ease';
  hiding.style.opacity='0';
  setTimeout(function(){
    hiding.style.display='none';hiding.style.opacity='';hiding.style.transition='';
    showing.style.display='block';showing.style.opacity='0';showing.style.transition='opacity 0.25s ease, transform 0.25s ease';showing.style.transform='translateY(6px)';
    requestAnimationFrame(function(){showing.style.opacity='1';showing.style.transform='translateY(0)';});
  },200);
}
function _bindThemeInfoEvents(container){
  const btn=container.querySelector('[data-action="toggleTheme"]');
  if(btn)btn.addEventListener('click',function(){if(typeof toggleTheme==='function')toggleTheme();});
  container.querySelectorAll('[data-action="tiSwitch"]').forEach(function(el){
    el.addEventListener('click',function(){_tiSwitch(el.dataset.mode);});
  });
}


/* 동료 접속 정보 변경 시 *동료와 협업* 탭이 열려있으면 자동 재렌더해 카드와 전광판이 어긋나지 않도록 함. */
bus.on('collab:peer-changed', function(){
  if(S.settingsLocked==='datasync'){
    try{ renderSettingsPanel('datasync'); }catch(e){}
  }
});
