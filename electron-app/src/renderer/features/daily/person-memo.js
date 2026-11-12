import { S } from '../../core/app-state.js';
import { escHtml } from '../../core/format-utils.js';
import { getStu } from '../../core/student-utils.js';
import { findTopOpenModal } from '../../core/ui-utils.js';

// Read legacy notes without rewriting data. Preserve text and slot order.
export function memoText(raw){
  if(typeof raw==='string')return raw;
  if(!Array.isArray(raw))return '';
  return raw.map(x=>typeof x==='string'?x:(x&&typeof x.text==='string'?x.text:''))
    .filter(x=>x.trim()).join('\n\n');
}
export function memoCellHtml(id,rid){
  const text=memoText(S.memoData[id]);
  return '<div class="person-memo-cell'+(text.trim()?' has-memo':'')+'" data-person-memo="'+escHtml(String(id))+'">'
    +(text.trim()?'<div class="person-memo-preview" style="white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;text-align:left;line-height:1.5">'+escHtml(text)+'</div>':'')
    +'<button type="button" class="person-memo-open" data-action="toggleMemo" data-sid="'+escHtml(String(id))+'" data-rid="'+escHtml(String(rid))+'" aria-label="주의사항 '+(text.trim()?'전체 보기 및 수정':'입력')+'">'+(text.trim()?'보기·수정':'+ 메모')+'</button></div>';
}
let active=null;
let writes=Promise.resolve();
export function hasInlineMemoEditor(){return !!(active&&active.inline);}
// Keep unsaved input alive without blocking date/range navigation and list refreshes.
export function expandInlineMemoEditor(){if(active&&active.inline)active.expand();}
export function openPersonMemo(id,button,refresh=()=>{}){
  if(active){active.input.focus();return;}
  const cell=button&&button.closest('.person-memo-cell');
  const original=cell?cell.innerHTML:'';
  const host=document.createElement('div');
  host.className='person-memo-editor';host.setAttribute('data-no-drag','');
  host.style.cssText='text-align:left;min-width:0;padding:6px;';
  const input=document.createElement('textarea');
  input.value=memoText(S.memoData[id]);input.placeholder='주의사항 입력';input.setAttribute('aria-label','주의사항 입력');
  input.style.cssText='box-sizing:border-box;width:100%;min-height:96px;max-height:260px;resize:vertical;overflow:auto;font:inherit;line-height:1.6;padding:8px;border:1px solid var(--bdr,#b8c9d0);border-radius:6px;background:var(--bg,#fff);color:var(--t1,#222)';
  const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.fontSize='11px';
  const save=document.createElement('button');save.type='button';save.textContent='저장 후 닫기';save.className='person-memo-save';
  const expand=document.createElement('button');expand.type='button';expand.textContent='넓게 보기';
  [save,expand].forEach(b=>{b.style.cssText='border:1px solid var(--bdr,#b8c9d0);border-radius:6px;padding:5px 8px;background:var(--bg,#fff);color:var(--t1,#222);font:inherit;cursor:pointer;white-space:nowrap;flex-shrink:0';});
  const bar=document.createElement('div');bar.className='person-memo-actions';bar.append(status,expand,save);
  host.append(input,bar);
  let saved=input.value,timer=null,closed=false,overlay=null,pending=0,finishing=false;
  active={input,inline:!!cell,expand:modal};
  function modal(){
    if(overlay)return;
    if(cell)cell.innerHTML=original;
    overlay=document.createElement('div');overlay.id='memoOverlay';overlay.className='modal-overlay show';overlay.style.cssText='z-index:10000;background:rgba(0,0,0,.25)';
    const box=document.createElement('div');box.className='modal-content';box.style.cssText='width:640px;max-width:94vw;max-height:90vh;overflow:auto;padding:14px';
    const title=document.createElement('div');title.className='person-memo-heading';
    const heading=document.createElement('h2');heading.id='personMemoHeading';heading.textContent='주의사항 · '+(getStu(id).name||'');
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='person-memo-dismiss';dismiss.textContent='×';dismiss.setAttribute('aria-label','메모 닫기');dismiss.addEventListener('click',finish);
    title.append(heading,dismiss);box.append(title,host);overlay.append(box);
    box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby',heading.id);document.body.append(overlay);
    overlay._onModalClose=finish;overlay.addEventListener('click',e=>{if(e.target===overlay)finish();});
    active.inline=false;expand.hidden=true;input.style.minHeight='240px';input.focus();
  }
  async function persist(){
    clearTimeout(timer);
    const value=input.value;
    if(value===saved&&pending===0)return true;
    pending++;
    status.textContent='저장 중…';save.disabled=finishing;
    const task=writes.catch(()=>{}).then(async()=>{
      if(value===saved){status.textContent='저장됨';return true;}
      const slots=value.trim()?[{text:value,ts:new Date().toISOString()}]:[];
      const snapshot={...S.memoData,[id]:slots};
      const api=window.electronAPI;
      if(!api||!api.dbSet)throw Error('저장 연결 없음');
      // Keep the individual mirror and shared store compatible with prior versions.
      if(getStu(id).type!=='staff'){
        if(!api.studentsUpdateMemo)throw Error('저장 연결 없음');
        const person=await api.studentsUpdateMemo(id,JSON.stringify(slots));
        if(!person||person.success!==true)throw Error('개인 메모 저장 실패');
      }
      const result=await api.dbSet('common','memos',snapshot);
      if(!result||result.success!==true)throw Error('메모 저장 실패');
      S.memoData[id]=slots;saved=value;
      try{localStorage.setItem('ec_memos',JSON.stringify(S.memoData));}
      catch(_){status.textContent='저장됨 · 로컬 임시 보관 실패';return true;}
      status.textContent=input.value===saved?'저장됨':'변경 내용 저장 대기';return true;
    });
    writes=task;
    try{return await task;}catch(_){status.textContent='저장 실패 · 다시 시도해 주세요';save.textContent='재시도';return false;}
    finally{pending--;save.disabled=finishing;}
  }
  async function finish(){
    if(closed||finishing)return;
    finishing=true;
    const ok=await persist();finishing=false;save.disabled=false;
    if(!ok||input.value!==saved)return;
    closed=true;clearTimeout(timer);observer.disconnect();document.removeEventListener('keydown',key,true);window.removeEventListener('beforeunload',unload);
    active=null;
    if(overlay)overlay.remove();
    else if(cell.isConnected)cell.outerHTML=memoCellHtml(id,button.dataset.rid);
    document.querySelectorAll('.person-memo-cell').forEach(node=>{if(node.dataset.personMemo===String(id)){const b=node.querySelector('[data-rid]');node.outerHTML=memoCellHtml(id,b?b.dataset.rid:'');}});
    refresh();
    requestAnimationFrame(()=>{
      const candidates=Array.from(document.querySelectorAll('.person-memo-open'));
      const target=candidates.find(b=>b.dataset.sid===String(id)&&b.dataset.rid===(button&&button.dataset.rid)&&b.getClientRects().length);
      if(target)target.focus({preventScroll:true});
    });
  }
  function key(e){
    const top=findTopOpenModal();if(top&&top!==overlay)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish();}
    if(e.key==='Tab'&&overlay){
      const buttons=Array.from(overlay.querySelectorAll('button,textarea')).filter(node=>!node.disabled&&!node.hidden&&node.getClientRects().length);
      const first=buttons[0],last=buttons[buttons.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  function unload(e){if(input.value!==saved){e.preventDefault();e.returnValue='';}}
  input.addEventListener('input',()=>{status.textContent='저장 대기';save.textContent='저장 후 닫기';clearTimeout(timer);timer=setTimeout(persist,500);input.style.height=Math.min(260,Math.max(96,input.scrollHeight))+'px';});
  input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();finish();}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();finish();}});
  save.addEventListener('click',finish);expand.addEventListener('click',modal);
  // If navigation replaces the table, retain the live editor in a dialog.
  const observer=new MutationObserver(()=>{if(!closed&&!host.isConnected)modal();});
  // A compact memo column is a preview, not enough room for an editing toolbar.
  if(cell&&cell.getBoundingClientRect().width>=280){cell.replaceChildren(host);host.scrollIntoView({block:'nearest'});input.focus({preventScroll:true});}else modal();
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('keydown',key,true);window.addEventListener('beforeunload',unload);
}
