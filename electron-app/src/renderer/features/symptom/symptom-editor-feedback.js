/* Observe acknowledged record state; never infer save success from a click. */
import { bus } from '../../core/event-bus.js';

export function mountSymptomEditorFeedback(overlay, getRecord, retrySave) {
  const box=overlay.querySelector('#symCatBox');
  if(!box || box._saveFeedbackMounted)return;
  box._saveFeedbackMounted=true;
  if(!document.getElementById('symptomEditorFeedbackStyles')){
    const style=document.createElement('style');style.id='symptomEditorFeedbackStyles';
    style.textContent=`
      #symCatBox .sym-editor-save-footer { flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:9px 14px;border-top:1px solid var(--bdr);background:var(--card);font-size:12px;line-height:1.5; }
      #symCatBox .sym-editor-save-copy { min-width:0;overflow-wrap:anywhere; }
      #symCatBox .sym-editor-save-status { color:var(--cyan);font-weight:700; }
      #symCatBox .sym-editor-save-hint { color:var(--t2);font-size:11px; }
      #symCatBox [data-editor-save-state="error"] .sym-editor-save-status { color:var(--rs,#b42318); }
      #symCatBox .sym-editor-save-footer button { flex:0 0 auto;min-height:32px; }
      #symCatBox .sym-editor-save-footer [hidden] { display:none!important; }
      #symMedPopup .sym-med-footer [data-med-popup-close] { flex:0 0 auto;min-height:32px; }
      @media(max-height:620px){#symCatBox .sym-editor-save-footer{padding:5px 10px;}#symCatBox .sym-editor-save-hint{display:none;}}
    `;
    document.head.appendChild(style);
  }
  const footer=document.createElement('section');footer.className='sym-editor-save-footer';
  const copy=document.createElement('div');copy.className='sym-editor-save-copy';
  const status=document.createElement('div');status.className='sym-editor-save-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const hint=document.createElement('div');hint.className='sym-editor-save-hint';hint.textContent='증상·처치·투약은 선택하거나 변경하면 자동 저장됩니다.';
  const retry=document.createElement('button');retry.type='button';retry.className='btn btn-sm';retry.dataset.symFocusNative='1';retry.textContent='다시 저장';retry.hidden=true;
  retry.addEventListener('click',event=>{event.stopPropagation();retrySave();});
  retry.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
  copy.append(status,hint);footer.append(copy,retry);box.appendChild(footer);
  const finish=box.querySelector('[data-action="closeSymptomPopup"]');
  if(finish){finish.textContent='입력 마치기';finish.setAttribute('aria-label','입력을 마치고 증상·처치 창 닫기');finish.title='변경 내용은 자동 저장됩니다. 저장 상태를 확인한 뒤 닫습니다.';}
  function render(){
    const rec=getRecord();
    const state=!rec||rec._deleted?'unavailable':rec._saving||rec._inserting?'saving':rec._saveError?'error':rec._dirty?'pending':rec._savedAt?'saved':'ready';
    const messages={unavailable:'기록 상태를 확인할 수 없습니다.',saving:'저장 중…',error:'저장하지 못했습니다. 입력 내용은 유지됩니다.',pending:'변경 내용 저장 대기 중…',saved:'자동 저장 완료',ready:'선택·변경하면 자동 저장됩니다.'};
    footer.dataset.editorSaveState=state;
    if(status.textContent!==messages[state])status.textContent=messages[state];
    retry.hidden=state!=='error';retry.disabled=state==='saving';
    const pop=document.getElementById('symMedPopup');
    if(!pop)return;
    const medFooter=pop.querySelector('.sym-med-footer');
    const done=medFooter?.querySelector('[data-med-popup-close]');
    if(done && done.textContent!=='투약 입력 완료')done.textContent='투약 입력 완료';
    if(done)done.title='선택한 약품과 투여량을 유지하고 투약 입력 영역을 닫습니다.';
    const text=medFooter?.querySelector('span');
    if(text){
      const count=new Set(Array.from(pop.querySelectorAll('[data-action="medDoseInput"]')).map(input=>input.dataset.med)).size;
      const message=(count?'선택 약품 '+count+'개 · ':'')+messages[state];
      if(text.textContent!==message)text.textContent=message;
    }
  }
  bus.on('daily:save-state-changed',render);bus.on('daily:record-id-changed',render);bus.on('render:daily',render);
  const medicationObserver=new MutationObserver(changes=>{
    if(changes.some(change=>Array.from(change.addedNodes).some(node=>node instanceof Element && (node.matches('#symMedPopup,.sym-med-footer,.sym-focus-dose-card')||node.querySelector('#symMedPopup,.sym-med-footer,.sym-focus-dose-card')))))render();
  });
  medicationObserver.observe(document.body,{childList:true,subtree:true});
  const lifetime=new MutationObserver(()=>{
    if(overlay.isConnected)return;
    bus.off('daily:save-state-changed',render);bus.off('daily:record-id-changed',render);bus.off('render:daily',render);
    medicationObserver.disconnect();lifetime.disconnect();
  });
  lifetime.observe(document.body,{childList:true});render();
}
