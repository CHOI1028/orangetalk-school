/* Shared presentation for the integrated and separated school care editors. */
export function installSymptomTreatmentStyles() {
  if (document.getElementById('symptomTreatmentCardStyles')) return;

  const icon = (paths, color = '#5e7f93') => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  };
  const check = icon('<path d="m6 12 4 4 8-8"/>', '#ffffff');
  const treatments = [
    { selector: '[data-treat="\uD22C\uC57D"]', emoji: '\u{1F48A}' },
    { selector: ':is([data-action="bedRest"],[data-treat="\uCE68\uC0C1 \uC774\uC6A9"],[data-treat="\uCE68\uC0C1 \uC548\uC815"])', emoji: '\u{1F6CF}\uFE0F' },
    { selector: ':is([data-action="openVs"],[data-treat="V/S \uCE21\uC815"])', emoji: '\u{1F321}\uFE0F' },
    { selector: ':is([data-action="openPhysAssess"],[data-treat="\uC2E0\uCCB4\uC0AC\uC815"])', emoji: '\u{1FA7A}' },
    { selector: '[data-treat="\uBCF4\uAC74\uAD50\uC721"]', emoji: '\u{1F4D6}' },
    { selector: '[data-treat="\uBCD1\uC6D0\uC9C4\uB8CC \uAD8C\uC720"]', emoji: '\u{1F3E5}' },
    { selector: '[data-treat="\uCD94\uC801 \uAD00\uCC30"]', emoji: '\u{1F552}' }
  ];

  const style = document.createElement('style');
  style.id = 'symptomTreatmentCardStyles';
  style.textContent=`
    /* Keep the medication picker unchanged; these tokens belong to its surrounding editor. */
    #symCatBox.sym-shared-workspace {
      --sym-card-line:color-mix(in srgb,var(--bdr) 82%,var(--card));
      --sym-card-tint:color-mix(in srgb,#a9bdcc 10%,var(--card));
      --sym-badge-radius:12px;
      --sym-badge-line:var(--bdr);
      --sym-symptom-accent:color-mix(in srgb,#517c97 80%,var(--t1));
      --sym-symptom-tint:color-mix(in srgb,#a3c4db 19%,var(--card));
      --sym-symptom-line:color-mix(in srgb,#91b2cc 55%,var(--bdr));
      --sym-treatment-accent:var(--cyan);
      --sym-treatment-tint:rgba(6,182,212,0.16);
      --sym-treatment-line:rgba(6,182,212,0.28);
    }
    #symCatBox.sym-shared-workspace #symCatList {
      padding:8px 6px;box-sizing:border-box;background:var(--card)!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item {
      min-height:36px;margin:0 0 6px;padding:6px 8px!important;gap:6px!important;
      border:1px solid var(--sym-badge-line)!important;border-radius:var(--sym-badge-radius);
      background:var(--card)!important;color:var(--t1)!important;
      font-size:12.8px!important;box-shadow:none;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item>span:first-child {
      display:inline-flex;align-items:center;justify-content:center;flex:0 0 20px;
      width:20px;height:22px;border-radius:6px;background:transparent;font-size:16px!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item>span:nth-child(2) {
      min-width:0;font-size:12.8px!important;letter-spacing:-.025em;line-height:1.4!important;
      color:inherit!important;
    }
    /* Counts are presentation-only. Preserve category labels, icons and the active arrow. */
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item>span:not(:first-child):not(:nth-child(2)):not(.sym-cat-arrow),
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item>span:nth-child(2)>span {
      display:none!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-arrow {
      color:var(--sym-symptom-accent)!important;
    }
    #symCatBox.sym-shared-workspace .sym-focus-heading {
      font-size:15px!important;font-weight:750;letter-spacing:-.02em;
    }
    #symCatBox.sym-shared-workspace .sym-focus-category {
      gap:7px;color:var(--t2);font-weight:600;
    }
    #symCatBox.sym-shared-workspace .sym-category-trigger {
      border-radius:var(--sym-badge-radius);border-color:var(--sym-symptom-line);
      background:color-mix(in srgb,#a3c4db 9%,var(--card));color:var(--t1);font-family:var(--f);
    }
    #symCatBox.sym-shared-workspace .sym-category-trigger>span:first-child {
      font-size:12.8px!important;font-weight:750;letter-spacing:-.025em;
    }
    #symCatBox.sym-shared-workspace .sym-category-choice {
      font-size:12.8px!important;font-weight:650;border-radius:var(--sym-badge-radius);
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item:has(.sym-cat-arrow[style*="visibility: visible"]),
    #symCatBox.sym-shared-workspace .sym-category-choice[aria-selected="true"] {
      border-color:var(--sym-symptom-line)!important;background:var(--sym-symptom-tint)!important;
      color:var(--sym-symptom-accent)!important;
    }
    #symCatBox.sym-shared-workspace .sym-category-choice:hover {
      background:var(--sym-symptom-tint);
    }
    #symCatBox.sym-shared-workspace #symSymList { background:var(--card); }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"] {
      gap:6px;min-height:36px;margin:0 4px 6px!important;padding:5px 8px!important;
      border:1px solid var(--sym-badge-line)!important;border-radius:var(--sym-badge-radius)!important;
      background:var(--card)!important;color:var(--t1)!important;
      font-size:12px!important;font-weight:550;line-height:1.45;box-shadow:none;
      transition:background-color .15s,border-color .15s;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]::before {
      content:"";display:block;flex:0 0 12px;width:12px;height:12px;box-sizing:border-box;
      border:1px solid var(--sym-symptom-line);border-radius:50%;background:var(--card);pointer-events:none;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:is(.is-sel,[data-sel="1"]) {
      border-color:var(--sym-symptom-line)!important;background:var(--sym-symptom-tint)!important;
      color:var(--sym-symptom-accent)!important;box-shadow:none;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:is(.is-sel,[data-sel="1"])::before {
      border-color:var(--sym-symptom-accent);
      background:var(--sym-symptom-accent) ${check} center/10px 10px no-repeat;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]>span:first-child {
      min-width:0;letter-spacing:-.02em;font-weight:550;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:is(.is-sel,[data-sel="1"])>span:first-child {
      font-weight:750;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"] :is(.sym-bm-mark,.sym-chip-pen) {
      border-radius:7px;flex:0 0 24px;width:24px;height:26px;min-height:26px;font-size:13px!important;
    }
    #symCatBox.sym-shared-workspace .sym-cat-add-wrap {
      padding-top:12px!important;gap:8px!important;
    }
    #symCatBox.sym-shared-workspace :is([data-action="addUserSym"],[data-action="openSymFreeText"]) {
      min-height:32px;padding:5px 12px!important;border-radius:10px!important;
      border:1px solid var(--sym-symptom-line)!important;background:var(--card)!important;
      color:var(--sym-symptom-accent)!important;font-size:13px!important;font-weight:650!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-pair {
      border-color:var(--sym-card-line);border-radius:14px;background:var(--card);box-shadow:none;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-label {
      font-size:13px;font-weight:750;color:var(--t2);
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-breadcrumb {
      font-size:16.8px;line-height:1.5;color:var(--t2);
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-breadcrumb b {
      font-size:19.2px;font-weight:750;color:var(--sym-symptom-accent)!important;
    }
    /* The breadcrumb is the heading; keep legacy blocks without a symptom heading unchanged. */
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-pair:has(.sym-treatment-heading-suffix) .sym-block-label {
      display:none;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-pair:has(.sym-treatment-heading-suffix) .sym-block-head {
      margin-top:0;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-treatment-heading-suffix {
      margin-inline-start:0.5px;color:var(--t1);font-size:16.8px;font-weight:750;white-space:nowrap;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-sub-title {
      font-size:12px;color:var(--t2);margin-bottom:8px;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc-head {
      align-items:center;gap:6px 8px;margin-bottom:5px;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc-head .title {
      color:var(--t1);font-size:14px;font-weight:750;letter-spacing:-.02em;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc-head .cat {
      max-width:100%;font-size:12px;font-weight:500;color:var(--t2);overflow-wrap:anywhere;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc-head .count {
      margin-left:auto;border-radius:7px;padding:2px 7px;background:var(--sym-card-tint);
      color:var(--t2);font-size:11px;font-weight:700;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-hint {
      font-size:12px;color:var(--t3);margin-bottom:10px;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc-body {
      display:flex!important;flex-wrap:wrap;align-items:center;align-content:flex-start;
      gap:6px;padding:3px 2px!important;min-width:0;
    }
    /* Selected and frequently used treatments share the same badge geometry and palette. */
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-sum-wrap>.sym-sel-chip.sym-treat-chip,
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip {
      --sym-action-emoji:"🔖";
      display:inline-flex!important;align-items:center;gap:6px;
      box-sizing:border-box;min-height:32px;max-width:100%;padding:3px 10px!important;
      border:1px solid var(--sym-treatment-line)!important;border-radius:12px!important;
      background:var(--sym-treatment-tint)!important;color:var(--sym-treatment-accent)!important;
      font-family:var(--f);font-size:14px!important;font-weight:800!important;line-height:1.5;
      box-shadow:none;white-space:normal;word-break:keep-all;overflow-wrap:anywhere;
    }
    /* Medication summaries share treatment colors; the medication picker itself stays unchanged. */
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-sum-wrap>.sym-sel-chip.sym-treat-chip[data-action="openMedFromChip"] {
      border-color:var(--sym-treatment-line)!important;
      background:var(--sym-treatment-tint)!important;
      color:var(--sym-treatment-accent)!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip {
      --sym-action-emoji:"🔖";font-weight:800!important;
      position:relative;display:inline-flex!important;align-items:center;justify-content:flex-start;
      flex:0 1 auto;gap:6px;width:auto;min-width:0;margin:0!important;text-align:left;
      transition:border-color .15s,background-color .15s;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-sum-wrap>.sym-sel-chip.sym-treat-chip:not([data-action="openMedFromChip"])::before,
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip::before {
      content:var(--sym-action-emoji);display:inline-flex;align-items:center;justify-content:center;
      flex:0 0 16px;width:16px;height:16px;font-size:15px;font-weight:400;line-height:1;
      font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;pointer-events:none;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip>.sym-chip-del {
      position:static!important;top:auto;right:auto;bottom:auto;left:auto;transform:none;
      flex:0 0 12px;width:12px;height:12px;margin:0 0 0 4px;padding:0;
      border-radius:50%;background:rgba(239,68,68,.15);color:#dc5252;font-size:8px;line-height:1;
      visibility:visible!important;opacity:0!important;pointer-events:none;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip:is(:hover,:focus-within)>.sym-chip-del {
      opacity:1!important;pointer-events:auto;
    }
    /* Only available treatments remain below; selected badges keep the shared mint palette above. */
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip {
      background:rgba(6,182,212,0.045)!important;border-color:rgba(6,182,212,0.20)!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip:hover {
      background:rgba(6,182,212,0.08)!important;border-color:var(--sym-treatment-accent)!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools {
      gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid var(--sym-card-line);
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools>.sym-sel-chip {
      border-color:var(--sym-treatment-line)!important;background:var(--card)!important;
      color:var(--sym-treatment-accent)!important;border-radius:10px!important;
      min-height:33px;padding:5px 10px!important;box-shadow:none;font-size:12px!important;font-weight:600!important;
    }
    #symCatBox.sym-shared-workspace .symptom-row-choice,
    #symCatBox.sym-shared-workspace .sym-treatment-choice {
      appearance:none;display:block;box-sizing:border-box;width:100%;min-width:0;
      margin:0!important;padding:0!important;border:0!important;border-radius:4px!important;
      background:transparent!important;box-shadow:none!important;color:inherit!important;
      font:inherit!important;line-height:1.45!important;text-align:left;
      white-space:normal;word-break:keep-all;overflow-wrap:anywhere;cursor:pointer;
    }
    #symCatBox.sym-shared-workspace .sym-treatment-name {
      display:block;flex:1 1 auto;min-width:0;
    }
    /* Apply the same type weight to the actual label buttons, not just their badge wrapper. */
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip :is(.sym-treatment-name,.sym-treatment-choice) {
      font-family:inherit!important;font-size:inherit!important;font-weight:800!important;line-height:1.5!important;
    }
    #symCatBox.sym-shared-workspace .sym-chip-del.sym-card-action {
      display:inline-flex!important;align-items:center;justify-content:center;
      visibility:visible!important;opacity:.65;
    }
    #symCatBox.sym-shared-workspace :is(.symptom-row-choice,.sym-treatment-choice,.sym-card-action):focus-visible {
      outline:2px solid var(--cyan)!important;outline-offset:2px;opacity:1!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item:not(.sym-cat-locked):hover {
      border-color:var(--sym-symptom-line)!important;background:var(--sym-symptom-tint)!important;box-shadow:none;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:hover {
      border-color:var(--sym-symptom-line)!important;background:var(--sym-symptom-tint)!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip:hover {
      border-color:var(--sym-treatment-accent)!important;box-shadow:none;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools>.sym-sel-chip:hover {
      background:var(--sym-treatment-tint)!important;
    }
    @media(hover:none) {
      #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip>.sym-chip-del {
        opacity:.65!important;pointer-events:auto;
      }
    }
    @media(prefers-reduced-motion:reduce) {
      #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"],
      #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-sel-chip.sym-fav-chip { transition:none; }
    }
` + treatments.map(({ selector, emoji }) => `
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip${selector},
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-sum-wrap>.sym-sel-chip.sym-treat-chip${selector} {
      --sym-action-emoji:"${emoji}";
    }
  `).join('');
  document.head.appendChild(style);
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const control = document.activeElement;
    if (!control || !control.closest('#symCatBox') || !control.matches('.symptom-row-choice,.sym-treatment-choice,.sym-card-action[role="button"]')) return;
    if (control.disabled || control.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const row = control.closest('[data-action="toggleSym"]');
    const symptom = row && row.dataset.sym;
    const restore = control.matches('.symptom-row-choice,[data-action="cancelSym"]');
    control.click();
    if (restore && symptom) requestAnimationFrame(() => {
      if (document.contains(control) || document.activeElement !== document.body) return;
      const next = Array.from(document.querySelectorAll('#symSymList [data-action="toggleSym"]')).find(item => item.dataset.sym === symptom);
      const label = next && next.querySelector('.symptom-row-choice');
      if (label) label.focus({preventScroll:true});
    });
  }, true);
}
