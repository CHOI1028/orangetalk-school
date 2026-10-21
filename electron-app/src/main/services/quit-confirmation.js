'use strict';

const {createQuitConfirmationDialog} = require('./quit-confirmation-dialog');

/* A UI gate only; resume the existing close/quit path after explicit approval. */
function createQuitConfirmation({dialog,getWindow,getUpdateState,createDialog=createQuitConfirmationDialog,requestQuit=()=>require('electron').app.quit()}) {
  let approved=false, systemEnding=false, pending=null;
  function dismissPending() {
    const attempt=pending; pending=null;
    try{attempt?.handle?.cancel();}catch(_){}
  }
  function showUpdate(win,update) {
    try{win.webContents.send('show-update-overlay',{version:update.version||'',mode:'quit'});}catch(_){}
  }
  function fallback(win) {
    try{
      return dialog.showMessageBoxSync(win,{
        type:'question',title:'오렌지톡 종료',message:'오렌지톡을 종료하시겠습니까?',
        detail:'진행 중인 입력과 저장 상태를 확인한 뒤 종료해 주세요.',
        buttons:['계속 사용','종료'],defaultId:0,cancelId:0,noLink:true
      })===1;
    }catch(_){return false;}
  }
  function confirm(event,target) {
    if(event.defaultPrevented)return false;
    const win=target||getWindow();
    if(!win||win.isDestroyed()||systemEnding){dismissPending();return true;}
    const update=getUpdateState();
    if(update.confirmed||update.installing){dismissPending();return true;}
    if(update.ready){event.preventDefault();dismissPending();showUpdate(win,update);return false;}
    if(approved)return true;
    event.preventDefault();
    if(pending){
      if(!target)pending.quit=true;
      try{pending.handle?.focus();}catch(_){}
      return false;
    }
    const attempt={win,quit:!target,handle:null}; pending=attempt;
    let response;
    try{attempt.handle=createDialog(win);response=attempt.handle.promise;}
    catch(error){response=Promise.reject(error);}
    Promise.resolve(response).catch(()=>{
      if(pending!==attempt||win.isDestroyed()||systemEnding)return false;
      return fallback(win);
    }).then(accepted=>{
      if(pending!==attempt)return;
      pending=null;
      if(accepted!==true||win.isDestroyed()||systemEnding)return;
      const current=getUpdateState();
      if(current.ready&&!current.confirmed&&!current.installing){showUpdate(win,current);return;}
      approved=true;
      if(attempt.quit)requestQuit();else win.close();
    }).catch(()=>{approved=false;if(pending===attempt)pending=null;});
    return false;
  }
  function attach(win) {
    win.on('close',event=>confirm(event,win));
    win.webContents.on('will-prevent-unload',()=>{approved=false;});
    win.on('closed',()=>{approved=false;if(pending?.win===win)dismissPending();});
    win.on('session-end',()=>{systemEnding=true;dismissPending();});
  }
  return {confirm,attach};
}

module.exports={createQuitConfirmation};
