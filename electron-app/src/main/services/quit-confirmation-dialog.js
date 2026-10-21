'use strict';

const path=require('path');
const {randomUUID}=require('crypto');
const responseChannel='orangetalk:quit-dialog-response';
const themeChannel='orangetalk:quit-dialog-theme';

/* Only computed presentation values are read; no application data or settings. */
function readTheme(parent) {
  return parent.webContents.executeJavaScript(`(() => {
    const style=getComputedStyle(document.body||document.documentElement);
    const names=['--card','--t1','--t2','--bdr','--bg2','--cyan','--school-card-heading-bg','--school-action-primary','--school-menu-strong'];
    const result={};
    for(const name of names)result[name]=style.getPropertyValue(name).trim();
    result['--quit-font']=style.fontFamily;
    return result;
  })()`).catch(()=>({}));
}

function createQuitConfirmationDialog(parent) {
  const {BrowserWindow,ipcMain,screen}=require('electron');
  const id=randomUUID(), parentBounds=parent.getBounds();
  const area=screen.getDisplayMatching(parentBounds).workArea;
  const width=Math.max(200,Math.min(460,area.width-32));
  const height=Math.max(220,Math.min(340,area.height-32));
  const child=new BrowserWindow({
    parent,modal:true,show:false,frame:false,resizable:false,minimizable:false,maximizable:false,
    fullscreenable:false,skipTaskbar:true,autoHideMenuBar:true,title:'오렌지톡 종료',
    backgroundColor:'#ffffff',width,height,
    x:Math.round(Math.max(area.x,Math.min(parentBounds.x+(parentBounds.width-width)/2,area.x+area.width-width))),
    y:Math.round(Math.max(area.y,Math.min(parentBounds.y+(parentBounds.height-height)/2,area.y+area.height-height))),
    webPreferences:{
      preload:path.join(__dirname,'quit-confirmation-dialog-preload.js'),
      nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
      partition:'orangetalk-quit-dialog',additionalArguments:['--orangetalk-quit-dialog='+id]
    }
  });
  let settled=false, resolveResult, rejectResult, startupTimer, themeTimer;
  const promise=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
  const finish=(accepted,error)=>{
    if(settled)return;settled=true;
    clearTimeout(startupTimer);clearTimeout(themeTimer);
    ipcMain.removeListener(responseChannel,onResponse);
    parent.removeListener('closed',parentClosed);
    if(!child.isDestroyed())child.destroy();
    if(error)rejectResult(error);else resolveResult(accepted===true);
  };
  const onResponse=(event,message)=>{
    if(settled||child.isDestroyed()||event.sender!==child.webContents||message?.id!==id||typeof message.confirmed!=='boolean')return;
    finish(message.confirmed);
  };
  const parentClosed=()=>finish(false);
  ipcMain.on(responseChannel,onResponse);parent.once('closed',parentClosed);
  child.on('close',event=>{event.preventDefault();finish(false);});
  child.once('closed',()=>finish(false));
  let theme={};
  try{
    child.setMenu(null);
    child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    child.webContents.on('will-navigate',event=>event.preventDefault());
    child.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    child.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
    child.webContents.once('did-finish-load',()=>{
      if(settled)return;
      clearTimeout(startupTimer);
      child.webContents.send(themeChannel,theme);
      child.show();child.focus();
    });
    startupTimer=setTimeout(()=>finish(false,new Error('Quit confirmation UI could not be displayed')),5000);
    Promise.race([
      readTheme(parent),
      new Promise(resolve=>{themeTimer=setTimeout(()=>resolve({}),300);})
    ]).then(value=>{
      clearTimeout(themeTimer);if(settled)return;
      theme=value;
      return child.loadFile(path.join(__dirname,'quit-confirmation-dialog.html'));
    }).catch(error=>finish(false,error));
  }catch(error){finish(false,error);}
  return {promise,cancel:()=>finish(false),focus:()=>{if(!settled&&!child.isDestroyed()&&child.isVisible())child.focus();}};
}

module.exports={createQuitConfirmationDialog};
