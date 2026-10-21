/* Presentation only: retain the original select/change path for category selection. */
export function mountSymptomCategoryPicker(select, box) {
  if (!select || !box) return null;
  const rowHeight = 40, maxRows = 8, padding = 10, gap = 4;
  if (!document.getElementById('symptomCategoryPickerStyles')) {
    const style = document.createElement('style');
    style.id = 'symptomCategoryPickerStyles';
    style.textContent = `
      #symCatBox .sym-category-trigger { display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--card);color:var(--t1);font:inherit;text-align:left;cursor:pointer; }
      #symCatBox .sym-category-trigger span:first-child { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      #symCatBox .sym-category-picker { position:absolute;z-index:60;box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:0;max-height:330px;overflow:hidden;border:1px solid var(--bdr);border-radius:8px;background:var(--card);color:var(--t1);box-shadow:0 5px 16px rgba(0,0,0,.12); }
      #symCatBox .sym-category-picker[hidden] { display:none!important; }
      #symCatBox .sym-category-picker-list { flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:auto!important;overflow-anchor:none;padding:4px;scrollbar-width:thin;scrollbar-gutter:stable; }
      #symCatBox .sym-category-choice { box-sizing:border-box;width:100%;height:40px;min-height:40px;max-height:40px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;padding:6px 8px;border:1px solid transparent;border-radius:6px;margin:0;background:var(--card);color:var(--t1);font:13px/1.5 var(--f);cursor:pointer; }
      #symCatBox .sym-category-choice:hover { background:var(--bg2); }
      #symCatBox .sym-category-choice[aria-selected="true"] { border-color:var(--cyan);color:var(--cyan);background:color-mix(in srgb,var(--cyan) 9%,var(--card));font-weight:700; }
      #symCatBox :is(.sym-category-trigger,.sym-category-choice):focus-visible { outline:2px solid var(--cyan);outline-offset:-2px; }
    `;
    document.head.appendChild(style);
  }
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'sym-category-trigger';
  trigger.dataset.symFocusNative = '1';
  trigger.setAttribute('aria-label','증상 분류 선택');
  trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-haspopup','listbox');
  const caption = document.createElement('span');
  const arrow = document.createElement('span'); arrow.textContent = '▾'; arrow.setAttribute('aria-hidden','true');
  trigger.append(caption,arrow);
  select.hidden = true; select.style.setProperty('display','none','important'); select.after(trigger);
  const panel = document.createElement('div'); panel.className = 'sym-category-picker'; panel.hidden = true;
  panel.id = 'symptomCategoryPicker'; panel.setAttribute('role','listbox'); panel.setAttribute('aria-label','증상 분류');
  panel.dataset.symFocusLocalEditor = '1'; panel.dataset.symFocusNative = '1';
  trigger.setAttribute('aria-controls',panel.id);
  const list = document.createElement('div'); list.className='sym-category-picker-list'; list.setAttribute('role','presentation');
  panel.appendChild(list); box.appendChild(panel);
  let frame=0, tracking=false, needsRoom=false;
  const observer = new ResizeObserver(() => schedule());
  const options = () => Array.from(select.options).filter(option=>option.value && !option.disabled && !option.hidden);
  const desiredHeight = () => Math.min(maxRows,list.children.length)*rowHeight+padding;
  function bounds() {
    const r=box.getBoundingClientRect(), v=window.visualViewport;
    return {r,left:Math.max(r.left+box.clientLeft,v?.offsetLeft||0)+8,
      top:Math.max(r.top+box.clientTop,v?.offsetTop||0)+8,
      right:Math.min(r.left+box.clientLeft+box.clientWidth,(v?.offsetLeft||0)+(v?.width||innerWidth))-8,
      bottom:Math.min(r.top+box.clientTop+box.clientHeight,(v?.offsetTop||0)+(v?.height||innerHeight))-8};
  }
  function reserveSpace() {
    for(let parent=trigger.parentElement; parent && parent!==box; parent=parent.parentElement) {
      const b=bounds(), t=trigger.getBoundingClientRect();
      const needed=desiredHeight()-(b.bottom-t.bottom-gap);
      if(needed<=0)break;
      if(!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY))continue;
      const top=Math.max(b.top,parent.getBoundingClientRect().top+parent.clientTop);
      const amount=Math.min(needed,Math.max(0,parent.scrollHeight-parent.clientHeight-parent.scrollTop),Math.max(0,t.top-top));
      if(amount>0)parent.scrollTo({top:parent.scrollTop+amount,behavior:'instant'});
    }
  }
  function position() {
    if(panel.hidden || !trigger.isConnected || !box.isConnected)return;
    const b=bounds(), t=trigger.getBoundingClientRect(), y=t.bottom+gap;
    const rows=Math.min(maxRows,list.children.length,Math.floor((b.bottom-y-padding)/rowHeight));
    if(b.right<=b.left || t.top<b.top-1 || t.right<=b.left || t.left>=b.right || rows<1) { close(false); return; }
    const width=Math.min(t.width,b.right-b.left);
    panel.style.left=(Math.max(b.left,Math.min(t.left,b.right-width))-b.r.left-box.clientLeft+box.scrollLeft)+'px';
    panel.style.top=(y-b.r.top-box.clientTop+box.scrollTop)+'px';
    panel.style.width=width+'px'; panel.style.height=(rows*rowHeight+padding)+'px';
    revealChoice(list.contains(document.activeElement)?document.activeElement:list.querySelector('[aria-selected="true"]'));
  }
  function schedule(event) {
    if(panel.hidden || (event?.target instanceof Node && panel.contains(event.target)))return;
    needsRoom=needsRoom || !event || event.type==='resize';
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;if(needsRoom)reserveSpace();needsRoom=false;position();});
  }
  function track() {
    if(tracking)return; tracking=true;
    observer.observe(box); observer.observe(trigger);
    document.addEventListener('scroll',schedule,true); window.addEventListener('resize',schedule);
    window.visualViewport?.addEventListener('resize',schedule);
  }
  function close(restore=true) {
    panel.hidden=true; trigger.setAttribute('aria-expanded','false');
    observer.disconnect(); tracking=false; needsRoom=false;
    document.removeEventListener('scroll',schedule,true); window.removeEventListener('resize',schedule);
    window.visualViewport?.removeEventListener('resize',schedule);
    if(frame)cancelAnimationFrame(frame); frame=0;
    if(restore && trigger.isConnected)trigger.focus({preventScroll:true});
  }
  function revealChoice(button) {
    if(!button || panel.hidden)return;
    const item=button.getBoundingClientRect(), area=list.getBoundingClientRect();
    let top=list.scrollTop;
    if(item.top<area.top+4)top-=area.top+4-item.top;
    else if(item.bottom>area.bottom-4)top+=item.bottom-area.bottom+4;
    list.scrollTo({top,behavior:'instant'});
  }
  function focusChoice(button) {
    if(!button)return;
    for(const item of list.children)item.tabIndex=item===button?0:-1;
    button.focus({preventScroll:true});
    revealChoice(button);
  }
  function choices() {
    list.replaceChildren();
    options().forEach(option=>{
      const button=document.createElement('button'); button.type='button'; button.className='sym-category-choice'; button.tabIndex=-1;
      button.textContent=option.textContent; button.title=option.textContent;
      button.setAttribute('role','option'); button.setAttribute('aria-selected',String(option.value===select.value));
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));refresh();close();});
      list.appendChild(button);
    });
  }
  function refresh() {
    caption.textContent=select.selectedOptions[0]?.textContent||'분류를 선택하세요'; caption.title=caption.textContent;
    trigger.disabled=select.disabled || !options().length;
    if(!panel.hidden){choices();position();}
  }
  function open() {
    if(trigger.disabled)return;
    choices(); panel.hidden=false; trigger.setAttribute('aria-expanded','true');
    reserveSpace(); position();
    if(panel.hidden)return;
    track(); focusChoice(list.querySelector('[aria-selected="true"]')||list.firstElementChild);
  }
  trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(panel.hidden)open();else close();});
  trigger.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();open();}
  });
  panel.addEventListener('keydown',event=>{
    event.stopPropagation(); if(event.isComposing || event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Tab'){close();return;}
    const items=Array.from(list.children), index=items.indexOf(document.activeElement);
    if(!items.length)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();const step=event.key==='ArrowDown'?1:-1;
      focusChoice(items[index<0?(step>0?0:items.length-1):(index+step+items.length)%items.length]);
    }else if(event.key==='Home'||event.key==='End'){
      event.preventDefault();focusChoice(items[event.key==='Home'?0:items.length-1]);
    }
  });
  const outside=event=>{if(!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target))close(false);};
  box.addEventListener('mousedown',outside,true);
  refresh();
  return {refresh,close,destroy(){close(false);box.removeEventListener('mousedown',outside,true);panel.remove();trigger.remove();}};
}
