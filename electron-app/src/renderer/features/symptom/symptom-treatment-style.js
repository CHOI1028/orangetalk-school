/* Shared presentation for the integrated and separated school care editors. */
export function installSymptomTreatmentStyles() {
  if (document.getElementById('symptomTreatmentCardStyles')) return;

  const icon = (paths, color = '#267b80') => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  };
  const check = icon('<path d="m6 12 4 4 8-8"/>', '#ffffff');
  const plus = icon('<path d="M12 5v14M5 12h14"/>');
  const treatments = [
    {
      selector: '[data-treat="\uD22C\uC57D"]',
      color: '#168c9c',
      image: icon('<path d="m8 16 8-8M7 17a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7l-7 7Z" transform="translate(4 2) scale(.8)"/>')
    },
    {
      selector: '[data-action="bedRest"]',
      color: '#4a9b7b',
      image: icon('<path d="M3 18V7m18 11V9M3 14h18M3 11h18M6 11V8h4v3M10 9h8a3 3 0 0 1 3 3"/>', '#347e61')
    },
    {
      selector: '[data-action="openVs"]',
      color: '#548fc4',
      image: icon('<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M6 11h3l2-4 3 8 2-4h2M9 21h6m-3-3v3"/>', '#416f9e')
    },
    {
      selector: '[data-action="openPhysAssess"]',
      color: '#58a49c',
      image: icon('<path d="M5 3v5a4 4 0 0 0 8 0V3M5 4H3m10 0h2M9 12v3a5 5 0 0 0 10 0v-2"/><circle cx="19" cy="10" r="3"/>', '#337e78')
    },
    {
      selector: '[data-treat="\uBCF4\uAC74\uAD50\uC721"]',
      color: '#ca9950',
      image: icon('<path d="M12 6v15M3 4h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v14h-5a4 4 0 0 0-4 3 4 4 0 0 0-4-3H3Z"/>', '#9a742e')
    },
    {
      selector: '[data-treat="\uBCD1\uC6D0\uC9C4\uB8CC \uAD8C\uC720"]',
      color: '#cb8e87',
      image: icon('<path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M10 21v-5h4v5M12 6v6M9 9h6"/>', '#a66b65')
    },
    {
      selector: '[data-treat="\uCD94\uC801 \uAD00\uCC30"]',
      color: '#7899bc',
      image: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', '#526f94')
    }
  ];

  const style = document.createElement('style');
  style.id = 'symptomTreatmentCardStyles';
  style.textContent = `
    #symCatBox.sym-shared-workspace {
      --sym-card-line: color-mix(in srgb, var(--cyan) 12%, var(--bdr));
      --sym-card-tint: color-mix(in srgb, var(--cyan) 7%, var(--card));
    }

    /* Category typography stays above symptom typography in both views. */
    #symCatBox.sym-shared-workspace #symCatList {
      padding:8px 6px;box-sizing:border-box;
      background:color-mix(in srgb,var(--cyan) 3%,var(--card))!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item {
      min-height:48px;margin:0 0 5px;padding:9px 8px!important;
      gap:7px!important;border-radius:11px;font-size:16px!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item>span:first-child {
      display:inline-flex;align-items:center;justify-content:center;
      flex:0 0 28px;width:28px;height:30px;border-radius:9px;
      background:color-mix(in srgb,var(--card) 78%,transparent);font-size:18px!important;
    }
    #symCatBox.sym-shared-workspace #symCatList .sym-cat-item>span:nth-child(2) {
      font-size:16px!important;letter-spacing:-.025em;line-height:1.4!important;
    }
    #symCatBox.sym-shared-workspace .sym-focus-heading {
      font-size:15px!important;font-weight:750;letter-spacing:-.02em;
    }
    #symCatBox.sym-shared-workspace .sym-focus-category {
      gap:7px;color:var(--t2);font-weight:600;
    }
    #symCatBox.sym-shared-workspace .sym-category-trigger {
      border-radius:11px;border-color:var(--sym-card-line);
      background:var(--card);color:var(--t1);font-family:var(--f);
    }
    #symCatBox.sym-shared-workspace .sym-category-trigger>span:first-child {
      font-size:16px!important;font-weight:750;letter-spacing:-.025em;
    }
    #symCatBox.sym-shared-workspace .sym-category-choice {
      font-size:16px!important;font-weight:650;
    }

    /* A quiet selection marker leaves the existing action icons intact. */
    #symCatBox.sym-shared-workspace #symSymList {
      background:linear-gradient(180deg,color-mix(in srgb,var(--cyan) 2%,var(--card)),var(--card));
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"] {
      gap:6px;min-height:46px;margin:0 4px 7px!important;padding:9px 10px!important;
      border:1px solid var(--sym-card-line)!important;border-radius:12px!important;
      background:var(--card)!important;color:var(--t1)!important;
      font-size:15px!important;font-weight:550;line-height:1.45;
      box-shadow:0 2px 5px rgb(15 55 70 / 3%);
      transition:background-color .15s,border-color .15s,box-shadow .15s;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]::before {
      content:"";display:block;flex:0 0 15px;width:15px;height:15px;
      box-sizing:border-box;border:1.5px solid color-mix(in srgb,var(--cyan) 28%,var(--bdr));
      border-radius:5px;background:var(--card);pointer-events:none;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:is(.is-sel,[data-sel="1"]) {
      border-color:color-mix(in srgb,var(--cyan) 65%,var(--bdr))!important;
      background:var(--sym-card-tint)!important;color:var(--cyan)!important;
      box-shadow:0 2px 6px color-mix(in srgb,var(--cyan) 9%,transparent);
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:is(.is-sel,[data-sel="1"])::before {
      border-color:var(--cyan);background:var(--cyan) ${check} center/13px 13px no-repeat;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]>span:first-child {
      min-width:0;letter-spacing:-.02em;font-weight:550;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:is(.is-sel,[data-sel="1"])>span:first-child {
      font-weight:750;
    }
    #symCatBox.sym-shared-workspace #symSymList [data-action="toggleSym"] :is(.sym-bm-mark,.sym-chip-pen) {
      border-radius:7px;flex:0 0 24px;width:24px;height:26px;min-height:26px;
      font-size:13px!important;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-cat-add-wrap {
      padding-top:12px!important;gap:8px!important;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-cat-add-wrap [data-action="addUserSym"] {
      min-height:32px;padding:5px 12px!important;border-radius:9px!important;
      border:1px solid color-mix(in srgb,var(--cyan) 28%,var(--bdr))!important;
      background:var(--card)!important;color:var(--cyan)!important;font-size:13px!important;font-weight:650!important;
    }
    #symCatBox.sym-shared-workspace #symSymList .sym-cat-add-wrap [data-action="openSymFreeText"] {
      border-radius:10px!important;font-size:13px!important;
    }

    /* Treatment actions use compact, wrapping cards rather than a flat chip strip. */
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-pair {
      border-color:color-mix(in srgb,var(--cyan) 14%,var(--bdr));
      border-radius:16px;
      background:linear-gradient(145deg,var(--card),color-mix(in srgb,#73bfa5 5%,var(--card)));
      box-shadow:0 3px 12px rgb(15 55 70 / 3%);
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-block-label {
      font-size:13px;font-weight:750;color:var(--t2);
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-breadcrumb {
      font-size:14px;line-height:1.5;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-breadcrumb b {
      font-size:16px;font-weight:750;
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
      margin-left:auto;border-radius:7px;padding:2px 7px;
      background:var(--sym-card-tint);color:var(--cyan);font-size:11px;font-weight:700;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-hint {
      font-size:12px;color:var(--t3);margin-bottom:10px;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc-body {
      display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(168px,100%),1fr));
      align-items:stretch;gap:8px;padding:3px 2px!important;min-width:0;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip {
      --sym-action-color:#58a29d;--sym-action-icon:${plus};
      display:flex!important;align-items:center;justify-content:flex-start;gap:9px;
      min-width:0;min-height:54px;max-width:100%;margin:0!important;padding:10px 11px!important;
      border:1px solid color-mix(in srgb,var(--sym-action-color) 24%,var(--bdr))!important;
      border-radius:12px!important;color:var(--t1)!important;
      background:linear-gradient(125deg,color-mix(in srgb,var(--sym-action-color) 6%,var(--card)),var(--card))!important;
      font-size:14px!important;font-weight:650;line-height:1.45;text-align:left;
      white-space:normal;word-break:keep-all;overflow-wrap:anywhere;
      box-shadow:0 2px 4px rgb(15 55 70 / 3%);
      transition:border-color .15s,box-shadow .15s,background-color .15s;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip::before {
      content:"";display:block;flex:0 0 30px;width:30px;height:30px;border-radius:9px;
      background:color-mix(in srgb,var(--sym-action-color) 13%,var(--card)) var(--sym-action-icon) center/19px 19px no-repeat;
      pointer-events:none;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip:has(>.sym-chip-del) {
      padding-right:30px!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip>.sym-chip-del {
      position:absolute!important;top:7px;right:6px;bottom:auto;left:auto;margin:0;width:18px;height:18px;
      border-radius:6px;font-size:11px;line-height:18px;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip:is(.is-sel,[data-sel="1"]) {
      border-color:var(--cyan)!important;background:var(--sym-card-tint)!important;color:var(--cyan)!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools {
      gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid var(--sym-card-line);
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools>.sym-sel-chip {
      border-color:var(--sym-card-line)!important;background:var(--card)!important;
      color:var(--t2)!important;border-radius:9px!important;min-height:33px;padding:5px 10px!important;
      box-shadow:none;font-size:12px!important;font-weight:600!important;
    }
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools>[data-action="addUserTreat"] {
      color:var(--cyan)!important;
    }

    #symCatBox.sym-shared-workspace :is(.sym-category-trigger,.sym-category-choice):focus-visible,
    #symCatBox.sym-shared-workspace #symSymList [data-action]:focus-visible,
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc [data-action]:focus-visible {
      outline:2px solid var(--cyan)!important;outline-offset:2px;
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
    #symCatBox.sym-shared-workspace .sym-chip-del.sym-card-action {
      display:inline-flex!important;align-items:center;justify-content:center;
      visibility:visible!important;opacity:.65;
    }
    #symCatBox.sym-shared-workspace :is(.symptom-row-choice,.sym-treatment-choice,.sym-card-action):focus-visible {
      outline:2px solid var(--cyan)!important;outline-offset:2px;opacity:1!important;
    }
    @media(hover:hover) {
      #symCatBox.sym-shared-workspace #symCatList .sym-cat-item:not(.sym-cat-locked):hover {
        box-shadow:inset 0 0 0 1px var(--sym-card-line);
      }
      #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"]:hover {
        border-color:color-mix(in srgb,var(--cyan) 52%,var(--bdr))!important;
        box-shadow:0 3px 8px color-mix(in srgb,var(--cyan) 8%,transparent);
      }
      #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip:hover {
        border-color:color-mix(in srgb,var(--sym-action-color) 65%,var(--bdr))!important;
        box-shadow:0 3px 9px color-mix(in srgb,var(--sym-action-color) 12%,transparent);
        background:color-mix(in srgb,var(--sym-action-color) 9%,var(--card))!important;
      }
      #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-tools>.sym-sel-chip:hover {
        background:var(--sym-card-tint)!important;border-color:var(--cyan)!important;
      }
    }
    @media(prefers-reduced-motion:reduce) {
      #symCatBox.sym-shared-workspace #symSymList .sym-sel-chip[data-action="toggleSym"],
      #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip {
        transition:none!important;
      }
    }
  ` + treatments.map(({selector,color,image}) => `
    #symCatBox.sym-shared-workspace #symTreatPanel .sym-fav-acc .sym-fav-chip${selector} {
      --sym-action-color:${color};--sym-action-icon:${image};
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
