/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module — 키오스크 다국어 번역 로직 */
import { escHtml, closeModalGracefully } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { renderSettingsPanel } from '../settings/settings-view.js';
import { S, saveKioskSettings } from '../../core/app-state.js';
import { kioskGetDefaultTrans, kioskGetTrans, kioskBuildTransPhrases } from './kiosk-default-translations.js';
/* 외부(kiosk-cms-view 등) 호환용 re-export — 정의는 kiosk-default-translations.js 로 이전됨(순환참조 차단) */
export { kioskGetTrans, kioskBuildTransPhrases };

const ks = S.kioskSettings;
function _save(){ saveKioskSettings(); }

/* ═══════════════════════════════════════
   언어 데이터 — 단일 출처
   ═══════════════════════════════════════
   KIOSK_LANG_ALL : 토글 UI 가 사용하는 15개 (한국 + 14 외국)
   kioskLangs     : 기존 호환을 위한 외국어만 (ko 제외) */
export const KIOSK_LANG_ALL=[
  {code:'ko',name:'한국어',                 flag:'🇰🇷'},
  {code:'en',name:'영어 (English)',         flag:'🇺🇸'},
  {code:'zh',name:'중국어 (中文)',           flag:'🇨🇳'},
  {code:'ja',name:'일본어 (日本語)',         flag:'🇯🇵'},
  {code:'vi',name:'베트남어 (Tiếng Việt)',   flag:'🇻🇳'},
  {code:'th',name:'태국어 (ภาษาไทย)',       flag:'🇹🇭'},
  {code:'tl',name:'필리핀어 (Filipino)',     flag:'🇵🇭'},
  {code:'km',name:'캄보디아어 (ខ្មែរ)',      flag:'🇰🇭'},
  {code:'mn',name:'몽골어 (Монгол)',        flag:'🇲🇳'},
  {code:'ru',name:'러시아어 (Русский)',     flag:'🇷🇺'},
  {code:'ne',name:'네팔어 (नेपाली)',         flag:'🇳🇵'},
  {code:'id',name:'인도네시아어 (Bahasa)',   flag:'🇮🇩'},
  {code:'ar',name:'아랍어 (العربية)',        flag:'🇸🇦'},
  {code:'ur',name:'우르두어 (اردو)',         flag:'🇵🇰'},
  {code:'es',name:'스페인어 (Español)',     flag:'🇪🇸'}
];
export const kioskLangs = KIOSK_LANG_ALL.filter(l => l.code !== 'ko');

/* ═══════════════════════════════════════
   언어 선택 — ks.languages 가 단일 출처 (비주얼 키오스크와 공유)
   ═══════════════════════════════════════ */
/* ks.languages 가 비어있으면 ['ko'] 로 초기화. 호출자가 직접 부르지 않으면
   _kioskOpenEditorPopup 진입 시 1회 호출. */
export function kioskEnsureDefaultLangs(){
  if(!Array.isArray(ks.languages) || !ks.languages.length){
    ks.languages = ['ko'];
    _save();
    return;
  }
  /* ko 가 빠져있으면 맨 앞에 강제 추가 */
  if(ks.languages.indexOf('ko') === -1){
    ks.languages.unshift('ko');
    _save();
  }
}

/* 토글 — ko 는 잠금. 나머지는 추가/제거. UI 재렌더는 호출자 책임. */
export function kioskEditorToggleLang(code){
  if(code === 'ko') return; // locked
  if(!Array.isArray(ks.languages)) ks.languages = ['ko'];
  const idx = ks.languages.indexOf(code);
  if(idx === -1) ks.languages.push(code);
  else ks.languages.splice(idx, 1);
  _save();
}

/* ks.languages 기반 외국어(KIOSK_LANG_ALL 항목) 목록 */
export function kioskGetForeignLangs(){
  const codes = (ks.languages || ['ko']).filter(c => c !== 'ko');
  return codes.map(c => KIOSK_LANG_ALL.find(l => l.code === c)).filter(Boolean);
}

/* ═══════════════════════════════════════
   번역 기능 함수들
   ═══════════════════════════════════════ */

/* DEPRECATED — 새 코드에서는 kioskEditorToggleLang 사용. 외부 호출자가 있어 유지. */
export function kioskToggleLang(code){
  if(!ks.selectedLangs)ks.selectedLangs=[];
  const idx=ks.selectedLangs.indexOf(code);
  if(idx===-1)ks.selectedLangs.push(code);
  else ks.selectedLangs.splice(idx,1);
  _save();renderSettingsPanel('kiosk');
}

/* 사용자 번역 저장. 키는 "한국어 원문"(trim). 원문이 바뀌면 새 키로 저장되고 옛 키는 더 이상 조회되지 않는다. */
export function kioskSetTrans(langCode,key,val){
  if(!ks.translations)ks.translations={};
  if(!ks.translations[langCode])ks.translations[langCode]={};
  const k=(key||'').trim();
  if(!k)return;
  ks.translations[langCode][k]=val;
  _save();
}


/* ── 번역 대상 텍스트 빌드 ── */
export function kioskBuildTransContent(getFlowFn, getRulesFn){
  const flow=getFlowFn();
  const items=ks.supplyItems||['생리대','면봉','마스크','대역 밴드','손 소독제'];
  const guides=ks.selfCareGuides||[{title:'가벼운 찰과상',guide:'소독 후 밴드 붙이기'}];
  const r=getRulesFn();
  const lines=[];
  lines.push('[이용 수칙 제목]');
  lines.push('- '+(r.title||'보건실 이용 수칙'));
  lines.push('');
  lines.push('[이용 수칙 > '+(r.timeTitle||'운영 시간')+']');
  (r.time||[]).forEach(function(t){if(t&&t.trim())lines.push('- '+t);});
  lines.push('');
  lines.push('[이용 수칙 > '+(r.mannerTitle||'지켜야 할 예절과 절차')+']');
  (r.manners||[]).forEach(function(m){
    const txt=typeof m==='string'?m:(m.text||'');
    const isSub=typeof m==='object'&&m.sub;
    if(txt&&txt.trim())lines.push((isSub?'  · ':'- ')+txt);
  });
  lines.push('');
  lines.push('[플로우 — 단계 제목]');
  flow.forEach(function(step){if(step._disabled)return;if(step.label)lines.push('- '+step.label);});
  lines.push('');
  lines.push('[플로우 — 버튼 라벨]');
  flow.forEach(function(step){
    if(step._disabled)return;
    (step.buttons||[]).forEach(function(btn){if(btn.label)lines.push('- '+btn.label);});
  });
  lines.push('');
  lines.push('[상비약 · 물품 리스트]');
  items.forEach(function(it){const nm=typeof it==='string'?it:(it.name||'');if(nm)lines.push('- '+nm);});
  lines.push('');
  lines.push('[자가 처치 안내]');
  guides.forEach(function(g){if(g.title)lines.push('- 제목: '+g.title);if(g.guide||g.description)lines.push('  안내: '+(g.guide||g.description||''));});
  lines.push('');
  lines.push('[방문자 순번 안내]');
  lines.push('- 방문자 순번 안내');
  lines.push('- 현재 대기 중인 학생');
  lines.push('- 명');
  lines.push('- 등록 시작');
  lines.push('');
  try {
    const fd = (ks.flowDesigner && ks.flowDesigner.sections) || null;
    if(fd && fd.length){
      lines.push('[플로우 디자이너 — 섹션명]');
      fd.forEach(function(s){ if(s.headerName) lines.push('- '+s.headerName); });
      lines.push('');
      lines.push('[플로우 디자이너 — 보기(옵션) 라벨]');
      fd.forEach(function(s){
        (s.options||[]).forEach(function(o){ if(o.label) lines.push('- '+o.label); });
      });
      lines.push('');
      const guideSections = fd.filter(function(s){ return s.type==='guide' && s.guideText && s.guideText.trim(); });
      if(guideSections.length){
        lines.push('[플로우 디자이너 — 안내형 절차·문구]');
        guideSections.forEach(function(s){
          lines.push('- 섹션: '+s.headerName);
          lines.push('  내용: '+s.guideText.replace(/\n/g,' | '));
        });
        lines.push('');
      }
    }
  } catch(e){}
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

/* ═══════════════════════════════════════
   프롬프트 빌더 — 한국어 라벨 + per-phrase 출력 형식
   ═══════════════════════════════════════ */
function _buildPromptText(foreigns, phrases){
  const names = foreigns.map(l => l.name.split('(')[0].trim()).join(', ');
  let txt = '당신은 유능한 한국어-다국어 동시 통역·번역 전문가입니다. 20년 이상의 경력으로 학교 보건·교육 분야의 전문 용어에 정통합니다.\n\n';
  txt += '아래 학교 보건실 키오스크의 한국어 문구를 ' + names + '로 자연스럽게 번역해 주세요.\n\n';
  txt += '[중요 지침]\n';
  txt += '• 직역이 아닌, 해당 언어 원어민이 일상적으로 사용하는 표현과 어순으로 번역해 주세요.\n';
  txt += '• 초·중·고 학생이 이해할 수 있도록 공손하고 명확하게 작성해 주세요.\n\n';
  txt += '[출력 형식 — 반드시 준수]\n';
  txt += '각 한국어 문장 바로 아래에 선택한 모든 언어의 번역을 다음과 같이 정렬해서 출력하세요.\n\n';
  /* 형식 예시 */
  txt += '운영 시간\n';
  foreigns.forEach(l => { txt += '- ' + l.name.split('(')[0].trim() + ': (해당 언어 번역)\n'; });
  txt += '\n지켜야 할 예절과 절차\n';
  foreigns.forEach(l => { txt += '- ' + l.name.split('(')[0].trim() + ': (해당 언어 번역)\n'; });
  txt += '\n---\n\n[번역할 한국어 문장 목록]\n';
  phrases.forEach(sec => {
    txt += '\n# ' + sec.section + '\n';
    sec.items.forEach((it, i) => { txt += (i+1) + '. ' + it.ko + '\n'; });
  });
  return txt;
}

/* ═══════════════════════════════════════
   프롬프트 모달 — 단일 텍스트 영역 (복사 전 검토·수정 가능)
   ═══════════════════════════════════════ */
export function kioskOpenTransPrompt(getFlowFn, getRulesFn){
  kioskEnsureDefaultLangs();
  const foreigns = kioskGetForeignLangs();
  if(!foreigns.length){ bus.emit('toast:show', {text:'먼저 외국어를 1개 이상 선택하세요.'}); return; }
  const existing = document.getElementById('kioskTransOverlay');
  if(existing){ closeModalGracefully(existing); return; }

  const flow = getFlowFn ? getFlowFn() : (ks.flowDesigner||{});
  const rules = getRulesFn ? getRulesFn() : (ks.customRules||{});
  const phrases = kioskBuildTransPhrases(flow, rules);
  const promptTxt = _buildPromptText(foreigns, phrases);
  const langSummary = foreigns.map(l => l.flag + ' ' + l.name.split('(')[0].trim()).join(' · ');

  const ov = document.createElement('div');
  ov.id = 'kioskTransOverlay';
  ov.className = 'modal-overlay show';
  ov.style.zIndex = '13000'; // 편집 팝업(12000) 위
  ov.innerHTML =
    '<div class="modal-content" style="width:920px;max-width:96vw;max-height:88vh;padding:0;display:flex;flex-direction:column;overflow:hidden">'
    + '<div style="padding:14px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center">'
    +   '<div style="display:flex;align-items:center;gap:10px">'
    +     '<span style="font-size:18px">📋</span>'
    +     '<div><div style="font-size:14px;font-weight:800;color:var(--t1)">AI 번역 프롬프트</div>'
    +     '<div style="font-size:10px;color:var(--t3);margin-top:1px">' + escHtml(langSummary) + '</div></div>'
    +   '</div>'
    +   '<button data-action="close-prompt" style="background:none;border:none;color:var(--t3);font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px">✕</button>'
    + '</div>'
    + '<div style="padding:14px 20px;overflow-y:auto;flex:1;min-height:0">'
    +   '<div style="font-size:11px;color:var(--t2);line-height:1.7;margin-bottom:10px">'
    +     '이 프롬프트 전체를 ChatGPT · Claude · Gemini 등에 붙여넣으면 한국어 문장마다 선택한 언어의 번역이 정렬되어 나옵니다. '
    +     '결과를 받은 뒤 <b style="color:var(--cyan)">📥 AI 번역 결과 붙여넣기</b> 버튼을 눌러 입력 칸에 채우세요.'
    +   '</div>'
    +   '<textarea id="_kcPromptTA" style="width:100%;height:50vh;min-height:280px;border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:11.5px;font-family:\'SF Mono\',Consolas,monospace;color:var(--t1);background:var(--bg2);resize:vertical;line-height:1.7;box-sizing:border-box;outline:none">' + escHtml(promptTxt) + '</textarea>'
    + '</div>'
    + '<div style="padding:12px 20px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;gap:8px;justify-content:flex-end">'
    +   '<button data-action="close-prompt" class="btn btn-outline btn-sm" style="padding:8px 16px;font-size:11px">닫기</button>'
    +   '<button data-action="copy-prompt" class="btn btn-primary btn-sm" style="padding:8px 18px;font-size:12px">📋 클립보드에 복사하고 닫기</button>'
    + '</div>'
    + '</div>';

  ov.addEventListener('mousedown', function(e){ if(e.target===ov) closeModalGracefully(ov); });
  ov.querySelectorAll('[data-action="close-prompt"]').forEach(function(b){ b.addEventListener('click', function(){ closeModalGracefully(ov); }); });
  const _copyBtn = ov.querySelector('[data-action="copy-prompt"]');
  if(_copyBtn) _copyBtn.addEventListener('click', function(){
    const ta = document.getElementById('_kcPromptTA');
    if(!ta) return;
    navigator.clipboard.writeText(ta.value).then(function(){
      bus.emit('toast:show', {text:'AI 번역 프롬프트가 클립보드에 복사되었습니다.'});
      closeModalGracefully(ov);
    }).catch(function(err){ console.error('[ERROR] clipboard.writeText', err); bus.emit('toast:show', {text:'복사 실패. 텍스트를 직접 선택해 복사해 주세요.'}); });
  });
  document.body.appendChild(ov);
}

/* ═══════════════════════════════════════
   붙여넣기 모달 — 한국어 문장별 N개 언어 입력 박스
   ═══════════════════════════════════════
   각 한국어 문장 아래에 선택된 외국어 수만큼 입력 칸이 나타나고,
   사용자가 AI 결과를 보면서 칸에 직접 채워 넣습니다.
   - 입력 디바운스 후 ks.translations[langCode][phraseKey] 에 저장
   - 빈 칸 행은 노란 테두리 강조
   - 진행률 바 (입력 N/총M) */
let _pasteSaveTimer = null;

/* 페이지 구성 — 섹션명을 페이지에 매핑.
 * Page 1: 인적사항 + 이용 수칙 (방문자 진입·안내 정보)
 * Page 2: 플로우 + 상비약·자가처치·순번 (방문 인터랙션) */
const _KC_PASTE_PAGES = [
  { label:'보건실 이용 수칙 안내', sections:['인적사항 화면', '이용 수칙'] },
  { label:'키오스크 플로우',       sections:['플로우 — 단계·버튼·안내', '상비약·물품', '자가 처치 안내', '방문자 순번·대기 안내', '키오스크 고정 문구·버튼'] }
];

function _kcPasteFilterPage(phrases, pageIdx){
  const sections = (_KC_PASTE_PAGES[pageIdx] || _KC_PASTE_PAGES[0]).sections;
  return phrases.filter(function(sec){ return sections.indexOf(sec.section) !== -1; });
}

/* 페이지 한 장 분의 본문 HTML — 외부에서 page 인덱스 바꿔 다시 렌더 */
function _kcBuildPasteBodyHtml(phrases, foreigns, pageIdx){
  const pagePhrases = _kcPasteFilterPage(phrases, pageIdx);
  let html = '';
  pagePhrases.forEach(function(sec){
    html += '<div style="margin-bottom:18px">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 12px;background:linear-gradient(90deg,rgba(6,182,212,0.08),transparent);border-left:3px solid var(--cyan);border-radius:0 8px 8px 0">'
      +   '<span style="font-size:12px;font-weight:800;color:var(--cyan);letter-spacing:0.3px">▸ ' + escHtml(sec.section) + '</span>'
      +   '<span style="font-size:10px;color:var(--t3);margin-left:auto">' + sec.items.length + '개 문장 × ' + foreigns.length + '개 언어</span>'
      + '</div>';
    sec.items.forEach(function(it){
      let langsHtml = '';
      let hasEmpty = false;
      /* 여러 줄 문구(절차 안내문 등)는 줄바꿈 보존을 위해 textarea, 한 줄 문구는 input */
      const isMulti = (it.ko.indexOf('\n') >= 0);
      foreigns.forEach(function(l){
        /* 사용자 저장값 우선(한국어 원문 키), 없으면 기본 제공 번역. 원문을 수정하면 둘 다 빗나가 빈칸이 된다. */
        const val = kioskGetTrans(l.code, it.ko) || kioskGetDefaultTrans(l.code, it.ko);
        if(!val) hasEmpty = true;
        const filledCls = val ? 'background:rgba(34,197,94,0.04);color:var(--gs);font-weight:600' : '';
        const field = isMulti
          ? '<textarea class="_kc-paste-input" data-ko="' + escHtml(it.ko) + '" data-lang="' + l.code + '" rows="4" '
            +   'placeholder="번역된 문장을 복사 후 붙여넣으세요." '
            +   'style="flex:1;min-width:0;border:none;background:none;outline:none;font-family:var(--f);font-size:12px;color:var(--t1);padding:2px 0;line-height:1.6;resize:vertical;white-space:pre-wrap;' + filledCls + '">' + escHtml(val) + '</textarea>'
          : '<input class="_kc-paste-input" data-ko="' + escHtml(it.ko) + '" data-lang="' + l.code + '" '
            +   'placeholder="번역된 문장을 복사 후 붙여넣으세요." value="' + escHtml(val) + '" '
            +   'style="flex:1;min-width:0;border:none;background:none;outline:none;font-family:var(--f);font-size:12px;color:var(--t1);padding:2px 0;' + filledCls + '">';
        langsHtml +=
          '<div style="display:flex;align-items:' + (isMulti?'flex-start':'center') + ';gap:8px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:8px 10px">'
          + '<span style="width:22px;height:22px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;border-radius:3px' + (isMulti?';margin-top:2px':'') + '">'
          +   (l.flag||'🌐')
          + '</span>'
          + '<span style="font-size:10px;color:var(--t2);font-weight:700;min-width:48px;flex-shrink:0' + (isMulti?';margin-top:3px':'') + '">' + escHtml(l.name.split('(')[0].trim()) + '</span>'
          + field
          + '</div>';
      });
      const rowBorder = hasEmpty ? 'border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.02)' : 'border:1px solid var(--bdr);background:var(--card)';
      html += '<div class="_kc-paste-row" data-key="' + escHtml(it.key) + '" style="' + rowBorder + ';border-radius:10px;padding:12px 14px;margin-bottom:8px">'
        + '<div style="display:flex;align-items:flex-start;gap:8px;padding-bottom:8px;margin-bottom:8px;border-bottom:1px dashed var(--bdr)">'
        +   '<span style="width:22px;height:22px;flex-shrink:0;margin-top:2px;overflow:hidden;display:inline-flex;align-items:center;justify-content:center">🇰🇷</span>'
        +   '<span style="font-size:13px;font-weight:700;color:var(--t1);line-height:1.5;flex:1;white-space:pre-line">' + escHtml(it.ko) + '</span>'
        +   '<span style="font-size:9px;color:var(--t3);background:var(--bg2);padding:2px 6px;border-radius:4px;font-weight:600;margin-top:3px;flex-shrink:0">' + escHtml(it.key) + '</span>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px">' + langsHtml + '</div>'
        + '</div>';
    });
    html += '</div>';
  });
  return html;
}

/* 전체 페이지 합산 진행률 (페이지 전환과 무관). 기본 제공 번역도 채워진 것으로 계산. */
function _kcCalcOverallProgress(phrases, foreigns){
  let total = 0, filled = 0;
  phrases.forEach(function(sec){
    sec.items.forEach(function(it){
      foreigns.forEach(function(l){
        total++;
        if(kioskGetTrans(l.code, it.ko) || kioskGetDefaultTrans(l.code, it.ko)) filled++;
      });
    });
  });
  return { total: total, filled: filled };
}

/* 현재 페이지만의 진행률 */
function _kcCalcPageProgress(phrases, foreigns, pageIdx){
  return _kcCalcOverallProgress(_kcPasteFilterPage(phrases, pageIdx), foreigns);
}

export function kioskOpenPasteTranslation(getFlowFn, getRulesFn){
  kioskEnsureDefaultLangs();
  const foreigns = kioskGetForeignLangs();
  if(!foreigns.length){ bus.emit('toast:show', {text:'먼저 외국어를 1개 이상 선택하세요.'}); return; }
  const existing = document.getElementById('kioskPasteTransOverlay');
  if(existing){ closeModalGracefully(existing); return; }

  const flow = getFlowFn ? getFlowFn() : (ks.flowDesigner||{});
  const rules = getRulesFn ? getRulesFn() : (ks.customRules||{});
  const phrases = kioskBuildTransPhrases(flow, rules);
  const langSummary = foreigns.map(l => l.flag + ' ' + l.name.split('(')[0].trim()).join(' · ');

  let currentPage = 0;
  const totalPages = _KC_PASTE_PAGES.length;

  /* 초기 본문 + 진행률 (페이지·전체 둘 다) */
  const initialBody = _kcBuildPasteBodyHtml(phrases, foreigns, currentPage);
  const progAll  = _kcCalcOverallProgress(phrases, foreigns);
  const progPage = _kcCalcPageProgress(phrases, foreigns, currentPage);

  const ov = document.createElement('div');
  ov.id = 'kioskPasteTransOverlay';
  ov.className = 'modal-overlay show';
  ov.style.zIndex = '13000';
  ov.innerHTML =
    '<div class="modal-content" style="width:1100px;max-width:96vw;max-height:92vh;padding:0;display:flex;flex-direction:column;overflow:hidden">'
    /* 헤더 — ✕ 버튼 제거. 자동 저장이므로 모달 바깥 클릭으로만 닫음 */
    + '<div style="padding:14px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px">'
    +   '<span style="font-size:18px">📥</span>'
    +   '<div><div style="font-size:14px;font-weight:800;color:var(--t1)">다국어 번역 입력 — <span id="_kcPastePageLabel" style="color:var(--cyan)">' + escHtml(_KC_PASTE_PAGES[currentPage].label) + '</span></div>'
    +   '<div style="font-size:10px;color:var(--cyan);margin-top:1px;font-weight:600">' + escHtml(langSummary) + '</div></div>'
    + '</div>'
    /* 안내 문구 — 자동저장 문구·빈칸 표시 변경 */
    + '<div style="padding:14px 20px 8px;background:rgba(6,182,212,0.04);border-bottom:1px solid var(--bdr)">'
    +   '<div style="font-size:11px;color:var(--t2);line-height:1.7">'
    +     '🤖 AI 결과를 보고 <b style="color:var(--cyan)">한국어 문장 아래의 각 언어 칸</b>에 그 문장의 번역을 입력하세요.<br>'
    +     '빈칸으로 남겨두시면 키오스크의 한국어 원문이 그대로 표시됩니다.'
    +   '</div>'
    + '</div>'
    + '<div id="_kcPasteBody" style="padding:18px 20px;overflow-y:auto;flex:1;min-height:0">' + initialBody + '</div>'
    /* 푸터 — 좌측 두 줄 진행률 + 자동저장 표시 + 우측 페이지 네비 */
    + '<div style="padding:10px 20px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;align-items:center;gap:12px">'
    +   '<div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--t2);font-weight:600">'
    /* 1행 — 현재 페이지 */
    +     '<div style="display:flex;align-items:center;gap:10px">'
    +       '<span style="color:var(--cyan);font-weight:700;min-width:120px">현재 페이지 입력 완료</span>'
    +       '<span style="display:inline-block;min-width:92px;text-align:center"><span id="_kcPasteFilledPage">' + progPage.filled + '</span> / <span id="_kcPasteTotalPage">' + progPage.total + '</span></span>'
    +       '<div style="width:140px;height:5px;background:var(--bdr);border-radius:3px;overflow:hidden">'
    +         '<div id="_kcPasteBarPage" style="height:100%;background:var(--cyan);border-radius:3px;width:' + (progPage.total?Math.round(progPage.filled/progPage.total*100):0) + '%;transition:width .25s"></div>'
    +       '</div>'
    +     '</div>'
    /* 2행 — 전체 */
    +     '<div style="display:flex;align-items:center;gap:10px">'
    +       '<span style="color:var(--t1);font-weight:700;min-width:120px">전체 입력 완료</span>'
    +       '<span style="display:inline-block;min-width:92px;text-align:center"><span id="_kcPasteFilled">' + progAll.filled + '</span> / <span id="_kcPasteTotal">' + progAll.total + '</span></span>'
    +       '<div style="width:140px;height:5px;background:var(--bdr);border-radius:3px;overflow:hidden">'
    +         '<div id="_kcPasteBar" style="height:100%;background:linear-gradient(90deg,var(--cyan),#22c55e);border-radius:3px;width:' + (progAll.total?Math.round(progAll.filled/progAll.total*100):0) + '%;transition:width .25s"></div>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    +   '<span id="_kcPasteSaveInd" style="font-size:11px;color:var(--gs);opacity:0;transition:opacity .3s;font-weight:600;margin-left:auto">모든 내용이 저장되었습니다</span>'
    /* 페이지 네비 */
    +   '<div style="display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:4px 6px">'
    +     '<button data-action="kc-paste-prev" id="_kcPastePrev" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--t1);padding:4px 8px;border-radius:4px" title="이전 페이지">◀</button>'
    +     '<span style="font-size:12px;font-weight:700;color:var(--t1);min-width:32px;text-align:center"><span id="_kcPastePageNum">' + (currentPage+1) + '</span>/<span>' + totalPages + '</span></span>'
    +     '<button data-action="kc-paste-next" id="_kcPasteNext" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--t1);padding:4px 8px;border-radius:4px" title="다음 페이지">▶</button>'
    +   '</div>'
    + '</div>'
    + '</div>';

  ov.addEventListener('mousedown', function(e){ if(e.target===ov) closeModalGracefully(ov); });

  /* 페이지 네비 + 자동저장 입력 이벤트 — 위임 */
  function _renderPage(idx){
    if(idx < 0 || idx >= totalPages) return;
    currentPage = idx;
    document.getElementById('_kcPasteBody').innerHTML = _kcBuildPasteBodyHtml(phrases, foreigns, idx);
    document.getElementById('_kcPastePageNum').textContent = (idx+1);
    document.getElementById('_kcPastePageLabel').textContent = _KC_PASTE_PAGES[idx].label;
    /* 페이지 진행률 — 새 페이지 기준 */
    const pageP = _kcCalcPageProgress(phrases, foreigns, idx);
    const pFEl = document.getElementById('_kcPasteFilledPage');
    const pTEl = document.getElementById('_kcPasteTotalPage');
    const pBar = document.getElementById('_kcPasteBarPage');
    if(pFEl) pFEl.textContent = pageP.filled;
    if(pTEl) pTEl.textContent = pageP.total;
    if(pBar) pBar.style.width = pageP.total ? Math.round(pageP.filled/pageP.total*100) + '%' : '0%';
    _kcUpdatePageNavState(currentPage, totalPages);
    /* 페이지 전환 시 본문 맨 위로 */
    const body = document.getElementById('_kcPasteBody');
    if(body) body.scrollTop = 0;
  }
  _kcUpdatePageNavState(currentPage, totalPages);

  ov.addEventListener('click', function(e){
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const action = el.dataset.action;
    if(action === 'kc-paste-prev'){ _renderPage(currentPage - 1); }
    else if(action === 'kc-paste-next'){ _renderPage(currentPage + 1); }
  });

  /* 입력 이벤트 — 디바운스 저장 + 진행률 + row 강조 */
  ov.addEventListener('input', function(e){
    const inp = e.target.closest('._kc-paste-input');
    if(!inp) return;
    const ko = inp.dataset.ko, lang = inp.dataset.lang;
    if(!ko || !lang) return;
    /* 즉시 시각 상태만 갱신 */
    const has = !!inp.value.trim();
    inp.style.background = has ? 'rgba(34,197,94,0.04)' : 'transparent';
    inp.style.color = has ? 'var(--gs)' : 'var(--t1)';
    inp.style.fontWeight = has ? '600' : '400';
    /* row 빈칸 강조 갱신 */
    const row = inp.closest('._kc-paste-row');
    if(row){
      const inputs = row.querySelectorAll('._kc-paste-input');
      const rowEmpty = Array.from(inputs).some(i => !i.value.trim());
      row.style.border = rowEmpty ? '1px solid rgba(245,158,11,0.4)' : '1px solid var(--bdr)';
      row.style.background = rowEmpty ? 'rgba(245,158,11,0.02)' : 'var(--card)';
    }
    /* 디바운스 저장 — 저장 후 전체 진행률 갱신 + "모든 내용이 저장되었습니다" 표시 */
    clearTimeout(_pasteSaveTimer);
    _pasteSaveTimer = setTimeout(function(){
      kioskSetTrans(lang, ko, inp.value);
      /* 전체 진행률 + 현재 페이지 진행률 둘 다 갱신 — phrases·foreigns·currentPage 는 closure */
      const all  = _kcCalcOverallProgress(phrases, foreigns);
      const page = _kcCalcPageProgress(phrases, foreigns, currentPage);
      const fEl  = document.getElementById('_kcPasteFilled');
      const bar  = document.getElementById('_kcPasteBar');
      const pFEl = document.getElementById('_kcPasteFilledPage');
      const pBar = document.getElementById('_kcPasteBarPage');
      if(fEl)  fEl.textContent  = all.filled;
      if(bar)  bar.style.width  = all.total  ? Math.round(all.filled / all.total * 100)   + '%' : '0%';
      if(pFEl) pFEl.textContent = page.filled;
      if(pBar) pBar.style.width = page.total ? Math.round(page.filled / page.total * 100) + '%' : '0%';
      /* 저장 표시 — 1.8초 후 페이드아웃 */
      const ind = document.getElementById('_kcPasteSaveInd');
      if(ind){
        ind.style.opacity = '1';
        clearTimeout(ind._fadeT);
        ind._fadeT = setTimeout(function(){ if(ind) ind.style.opacity = '0'; }, 1800);
      }
    }, 500);
  });

  document.body.appendChild(ov);
}

/* 페이지 네비 prev/next 비활성화 토글 */
function _kcUpdatePageNavState(curr, total){
  const prev = document.getElementById('_kcPastePrev');
  const next = document.getElementById('_kcPasteNext');
  if(prev){ prev.disabled = (curr === 0); prev.style.opacity = (curr === 0) ? '0.3' : '1'; prev.style.cursor = (curr === 0) ? 'not-allowed' : 'pointer'; }
  if(next){ next.disabled = (curr === total - 1); next.style.opacity = (curr === total - 1) ? '0.3' : '1'; next.style.cursor = (curr === total - 1) ? 'not-allowed' : 'pointer'; }
}
