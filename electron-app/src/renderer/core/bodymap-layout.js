/* Shared display geometry only. Anatomical hit regions and saved markers are unchanged. */
export const BODYMAP_GUIDES = {
  body: {title:'몸 전체', labels:[['오른쪽',12.5],['왼쪽',37.5],['왼쪽',62.5],['오른쪽',87.5]]},
  face: {title:'얼굴', labels:[['오른쪽',20],['왼쪽',80]]},
  teeth: {title:'입안', labels:[['오른쪽',20],['왼쪽',80]]},
  handTop: {title:'손등', labels:[['왼쪽',25],['오른쪽',75]]},
  palm: {title:'손바닥', labels:[['왼쪽',25],['오른쪽',75]]},
  footTop: {title:'발등', labels:[['왼쪽',25],['오른쪽',75]]},
  footBottom: {title:'발바닥', labels:[['왼쪽',25],['오른쪽',75]]}
};

export const BODYMAP_LAYOUT_CSS = `
.bm-layout{--bm-paper:var(--card,#fff);--bm-ink:var(--t1,#243b46);--bm-muted:var(--t2,#526871);--bm-line:var(--bdr,#d7e3e7);--bm-accent:#087e87;--bm-tint:rgba(8,126,135,.09)}
.bm-layout .bm-inner,.bm-layout>.modal-content{background:var(--bm-paper)!important;color:var(--bm-ink);max-height:calc(100dvh - 16px);box-sizing:border-box}
.bm-layout .bm-body{display:flex!important;flex:1;min-height:0;overflow:auto!important;padding:8px;gap:8px}
.bm-layout .bm-left{width:auto!important;flex:44 1 0!important;min-width:0;max-width:none!important;padding:0!important;border:0!important;display:flex;flex-direction:column;gap:8px!important}
.bm-layout .bm-right{flex:56 1 0!important;min-width:0;padding:0!important;display:flex;align-items:stretch!important}
.bm-layout .bm-pair{gap:8px!important;min-height:150px;flex:1!important}
.bm-layout .bm-zone{position:relative!important;display:block!important;min-width:0;min-height:150px;box-sizing:border-box;border:1px solid var(--bm-line);border-radius:10px;background:var(--bm-paper)!important}
.bm-layout .bm-right>.bm-zone{width:100%!important;height:100%!important;min-height:466px}
.bm-layout .bm-zone>img{display:block!important;width:calc(100% - 16px)!important;height:calc(100% - 60px)!important;max-width:none!important;max-height:none!important;margin:52px 8px 8px!important;object-fit:contain!important;border:0!important;padding:0!important;transform:none!important;background:#fff!important;border-radius:6px;pointer-events:none}
.bm-layout .bm-zone-title{position:absolute;top:7px;left:8px;right:8px;text-align:center;color:var(--bm-ink);font-size:14px;font-weight:700;line-height:1.4;pointer-events:none;z-index:2}
.bm-layout .bm-guide-layer{position:absolute;inset:0;pointer-events:none;z-index:2}
.bm-layout .bm-side-label{position:absolute;transform:translate(-50%,-50%);box-sizing:border-box;width:4em;padding:2px 0;border:0;border-radius:5px;background:var(--bm-paper);color:var(--bm-muted);font-size:14px;line-height:1.25;font-weight:700;text-align:center;white-space:nowrap;pointer-events:none;user-select:none}
.bm-layout .bm-zone-title small{font-size:12px;font-weight:400;color:var(--bm-muted);margin-left:8px}
.bm-layout .bm-region-picker{display:none;flex-shrink:0;padding:10px 12px;gap:6px;border-bottom:1px solid var(--bm-line);background:var(--bm-paper)}
.bm-layout .bm-region-picker button{font-family:inherit;font-size:16px;line-height:1.3;font-weight:700;min-height:44px;padding:9px 8px;border:1px solid var(--bm-line);border-radius:9px;background:var(--bm-paper);color:var(--bm-ink);white-space:nowrap}
.bm-layout .bm-region-picker button[aria-pressed=true]{background:var(--bm-accent);border-color:var(--bm-accent);color:#fff}
.bm-layout .bm-region-picker button:focus-visible{outline:2px solid var(--bm-accent);outline-offset:2px}
.bm-layout .bm-header{gap:12px;align-items:center;background:var(--bm-paper);border-color:var(--bm-line)}
.bm-layout .bm-header-title{font-size:20px;line-height:1.4;color:var(--bm-ink)}
.bm-layout .bm-header-sub{font-size:14px;line-height:1.5;color:var(--bm-muted);margin-top:4px}
.bm-layout .bm-header-right{flex-shrink:0;gap:8px}
.bm-layout .bm-header-right button,#bmOverlay.bm-layout .bm-header-right [data-bm-close]{min-height:44px!important;min-width:76px;padding:10px 14px;font-size:16px!important;line-height:1.3;white-space:nowrap;word-break:keep-all}
.bm-layout .bm-confirm-btn{background:var(--bm-accent);color:#fff}
.bm-layout .bm-close-btn{background:var(--bm-paper);color:var(--bm-ink);border:1px solid var(--bm-line)}
.bm-layout.bm-compact .bm-region-picker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.bm-layout.bm-compact .bm-body{display:block!important;overflow:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.bm-layout.bm-compact .bm-left,.bm-layout.bm-compact .bm-right,.bm-layout.bm-compact .bm-pair{display:contents!important}
.bm-layout.bm-compact .bm-zone{width:100%!important;height:100%!important;min-height:420px!important}
.bm-layout.bm-compact .bm-zone[data-bm-hidden=true]{display:none!important}
.bm-layout.bm-compact .bm-side-label{font-size:16px}
@media(max-width:560px){
 .bm-layout .bm-inner,.bm-layout>.modal-content{width:100vw!important;max-width:100vw!important;height:100dvh!important;max-height:100dvh!important;border-radius:0!important}
 .bm-layout .bm-header{padding:14px 12px;align-items:flex-start;flex-wrap:wrap}
 .bm-layout .bm-header-right{width:100%;justify-content:flex-end}
 .bm-layout .bm-header-right button{flex:1}
 .bm-layout .bm-region-picker{padding:8px;gap:6px}
 .bm-layout .bm-body{padding:8px}
 .bm-layout .bm-header-sub{font-size:14px}
}
`;

export function bodymapImageRect(img){
  const r=img.getBoundingClientRect();
  const w=img.naturalWidth,h=img.naturalHeight;
  if(!w||!h||!r.width||!r.height)return {left:r.left,top:r.top,width:0,height:0};
  const scale=Math.min(r.width/w,r.height/h);
  return {left:r.left+(r.width-w*scale)/2,top:r.top+(r.height-h*scale)/2,width:w*scale,height:h*scale};
}

export function drawBodymapGuides(zone){
  const spec=BODYMAP_GUIDES[zone.dataset.bmKey],img=zone.querySelector('img');
  if(!spec||!img||!img.complete||!img.naturalWidth||!zone.offsetWidth||!zone.offsetHeight)return;
  let title=zone.querySelector('.bm-zone-title');
  if(!title){title=document.createElement('div');title.className='bm-zone-title';title.textContent=spec.title;
    if(zone.dataset.bmKey==='body'){const hint=document.createElement('small');hint.textContent='앞모습 / 뒷모습';title.appendChild(hint);}
    zone.appendChild(title);
  }
  let layer=zone.querySelector('.bm-guide-layer');
  if(!layer){layer=document.createElement('div');layer.className='bm-guide-layer';zone.appendChild(layer);}
  if(layer.children.length!==spec.labels.length){layer.replaceChildren();spec.labels.forEach(([label,pct])=>{const span=document.createElement('span');span.className='bm-side-label';span.textContent=label;span.dataset.center=String(pct);layer.appendChild(span);});}
  const zr=zone.getBoundingClientRect(),ir=bodymapImageRect(img);
  const sx=zr.width/zone.offsetWidth,sy=zr.height/zone.offsetHeight;
  if(!sx||!sy||!ir.width||!ir.height)return;
  const top=Math.max(34,(ir.top-zr.top)/sy-zone.clientTop-15);
  Array.from(layer.children).forEach(span=>{
    span.style.left=((ir.left-zr.left+ir.width*Number(span.dataset.center)/100)/sx-zone.clientLeft)+'px';
    span.style.top=top+'px';
  });
}

export function mountBodymapLayout(root,onLayout){
  if(!root||root._bodymapLayout)return;
  if(!document.getElementById('bodymap-layout-styles')){const style=document.createElement('style');style.id='bodymap-layout-styles';style.textContent=BODYMAP_LAYOUT_CSS;document.head.appendChild(style);}
  root.classList.add('bm-layout');
  const area=root.querySelector('.bm-body');
  if(!area)return;
  const zones=Array.from(root.querySelectorAll('.bm-zone'));
  const picker=document.createElement('nav');picker.className='bm-region-picker';picker.setAttribute('aria-label','불편한 곳 찾기');
  let selected='body',frame=0,disposed=false;
  function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(update);}
  function update(){
    frame=0;if(disposed||!root.isConnected)return;
    const compact=root.getBoundingClientRect().width<=1050;
    root.classList.toggle('bm-compact',compact);
    zones.forEach(zone=>{zone.dataset.bmHidden=String(compact&&zone.dataset.bmKey!==selected);});
    picker.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.bmTarget===selected)));
    zones.forEach(drawBodymapGuides);
    if(typeof onLayout==='function')onLayout();
  }
  Object.keys(BODYMAP_GUIDES).forEach(key=>{
    if(!zones.some(zone=>zone.dataset.bmKey===key))return;
    const button=document.createElement('button');button.type='button';button.dataset.bmTarget=key;button.textContent=BODYMAP_GUIDES[key].title;
    button.addEventListener('click',()=>{selected=key;area.scrollTop=0;update();});picker.appendChild(button);
  });
  area.before(picker);
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
  if(resize){resize.observe(root);zones.forEach(zone=>resize.observe(zone));}
  const images=zones.map(zone=>zone.querySelector('img')).filter(Boolean);
  images.forEach(img=>img.addEventListener('load',schedule));
  window.addEventListener('resize',schedule);
  area.addEventListener('scroll',schedule,{passive:true});
  const surface=root.querySelector('.bm-inner,.modal-content');
  function onTransition(event){if(event.target===root||event.target===surface)schedule();}
  root.addEventListener('transitionend',onTransition);
  const removed=new MutationObserver(()=>{if(!root.isConnected)dispose();});removed.observe(document.body,{childList:true});
  function dispose(){disposed=true;cancelAnimationFrame(frame);if(resize)resize.disconnect();removed.disconnect();window.removeEventListener('resize',schedule);area.removeEventListener('scroll',schedule);root.removeEventListener('transitionend',onTransition);images.forEach(img=>img.removeEventListener('load',schedule));}
  root._bodymapLayout={refresh:schedule,dispose};update();
}
