const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../src/renderer');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const ui=read('core/ui-utils.js');
const shared=ui.slice(ui.indexOf('export function findTopOpenModal('),ui.indexOf('export function createEmptyState(')).replace(/^export /gm,'');
const bindings=read('core/event-bindings.js');
const begin=bindings.indexOf("  document.addEventListener('keydown', function(e){\n    if(e.key !== 'Escape') return;");
const escape=bindings.slice(begin,bindings.indexOf('  }, false);',begin)+12);
function node(id,options={}){
  const classes=new Set(options.classes||['modal-overlay','show']);
  const handlers=new Map();
  return {id,isConnected:true,parentNode:{},parentElement:options.parent||null,removed:0,
    style:{display:'flex',visibility:'visible',opacity:'1',pointerEvents:'auto',zIndex:'1',...options.style},
    classList:{contains:k=>classes.has(k),add:(...ks)=>ks.forEach(k=>classes.add(k)),remove:(...ks)=>ks.forEach(k=>classes.delete(k))},
    querySelector:()=>null,contains(e){return e?.parentElement===this;},
    addEventListener:(k,f)=>handlers.set(k,f),removeEventListener:k=>handlers.delete(k),
    remove(){this.isConnected=false;this.parentNode=null;this.removed++;},
    emit(k,e){handlers.get(k)?.(e||{target:this});}
  };
}
function fixture(nodes){
  const listeners=[],timers=[];
  const document={activeElement:null,querySelectorAll:()=>nodes,getElementById:id=>nodes.find(n=>n.id===id&&n.isConnected),addEventListener:(type,fn)=>listeners.push(fn)};
  const context=vm.createContext({document,getComputedStyle:e=>e.style,setTimeout:(fn,ms)=>timers.push({fn,ms})});
  vm.runInContext(shared+'\nconst findKeyboardModal=findTopOpenModal; const closeKeyboardModal=closeModalGracefully;\n'+escape,context);
  return {context,document,timers,key(overrides={}){const e={key:'Escape',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...overrides};listeners.forEach(fn=>fn(e));return e;}};
}
test('hidden quick-message root cannot intercept Escape from an emergency form',()=>{
  const quick=node('qmOverlay',{classes:['qm-overlay'],style:{opacity:'0',pointerEvents:'none',zIndex:'9000'}});
  const emergency=node('ecFormOverlay',{style:{zIndex:'2500'}});let closes=0;
  emergency._onModalClose=()=>closes++;
  fixture([emergency,quick]).key();assert.equal(closes,1);assert.equal(quick.removed,0);
});
for(const style of [{display:'none'},{visibility:'hidden'},{visibility:'collapse'},{opacity:'0'},{pointerEvents:'none'}]){
  test('inactive modal is excluded: '+JSON.stringify(style),()=>{
    const lower=node('openOverlay'),hidden=node('hiddenOverlay',{style:{zIndex:'999',...style}});
    assert.equal(fixture([lower,hidden]).context.findTopOpenModal(),lower);
  });
}
test('hidden ancestor excludes its modal',()=>{
  const parent=node('section',{style:{display:'none'}}),hidden=node('nestedOverlay',{parent}),visible=node('visibleOverlay');
  assert.equal(fixture([hidden,visible]).context.findTopOpenModal(),visible);
});
test('last DOM modal wins equal z-index',()=>{
  const first=node('firstOverlay'),last=node('lastOverlay');assert.equal(fixture([first,last]).context.findTopOpenModal(),last);
});
test('handled Escape does not close another modal',()=>{
  const n=node('keepOverlay');let calls=0;n._onModalClose=()=>calls++;
  fixture([n]).key({defaultPrevented:true});assert.equal(calls,0);
});
for(const id of ['qmOverlay','settingsModal','emsOverlay','vpOverlay','ecFormOverlay','infFormOverlay']){
  test('persistent root survives fallback close: '+id,()=>{
    const n=node(id,{classes:['modal-overlay','show','active']});const h=fixture([n]);
    h.context.closeModalGracefully(n);assert.equal(n.removed,0);assert.equal(n.classList.contains('show'),false);assert.equal(n.classList.contains('active'),false);
    n.classList.add('show');assert.equal(n.isConnected,true);
  });
}
for(const id of ['colSelectorOverlay','ecColSelectorOverlay','infColSelectorOverlay','rentalLedgerOverlay','addPersonModal']){
  test('temporary overlay is removed rather than left hidden: '+id,()=>{
    const n=node(id);const h=fixture([n]);h.key();assert.equal(h.timers.length,1);h.timers[0].fn();assert.equal(n.removed,1);
    assert.equal(h.context.findTopOpenModal(),null);
  });
}
test('one key targets only the highest modal and preserves its close hook receiver',()=>{
  const lower=node('lowerOverlay'),upper=node('upperOverlay',{style:{zIndex:'20'}});let calls=0;
  upper._onModalClose=function(){assert.equal(this,upper);calls++;};
  fixture([lower,upper]).key();assert.equal(calls,1);assert.equal(lower.removed,0);
});
test('quick-message opening installs its own reusable close routine',()=>{
  const source=read('features/newsletter/newsletter-misc-view.js');
  const start=source.indexOf('export function openQuickMsg(){'),end=source.indexOf("document.addEventListener('click'",start);
  const n=node('qmOverlay',{classes:['qm-overlay']});const h=fixture([n]);
  Object.assign(h.context,{cancelCloseAnimIfPending(){},qmRenderCats(){},qmRenderMsgs(){},qmLoad:()=>[],closeModalWithAnim:el=>el.classList.remove('active')});
  vm.runInContext('let qmEditingId=null,qmActiveCat=null;\n'+source.slice(start,end).replace(/^export /gm,''),h.context);
  for(let i=0;i<3;i++){h.context.openQuickMsg();assert.equal(n.classList.contains('active'),true);h.context.closeModalGracefully(n);assert.equal(n.classList.contains('active'),false);assert.equal(n.removed,0);}
});

test('focused input consumes Escape without discarding its modal',()=>{
  const n=node('editOverlay'),h=fixture([n]);let blurs=0;
  h.document.activeElement={tagName:'INPUT',parentElement:n,blur(){blurs++;}};
  assert.equal(h.key().defaultPrevented,true);assert.equal(blurs,1);assert.equal(h.timers.length,0);assert.equal(n.removed,0);
});
