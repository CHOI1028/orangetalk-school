'use strict';

const {ipcRenderer}=require('electron');
const prefix='--orangetalk-quit-dialog=';
const id=(process.argv.find(argument=>argument.startsWith(prefix))||'').slice(prefix.length);
const colorNames=new Set(['--card','--t1','--t2','--bdr','--bg2','--cyan','--school-card-heading-bg','--school-action-primary','--school-menu-strong']);
ipcRenderer.on('orangetalk:quit-dialog-theme',(_event,theme)=>{
  if(!theme||typeof theme!=='object')return;
  for(const [name,value]of Object.entries(theme)){
    if(typeof value!=='string'||value.length>300)continue;
    if(colorNames.has(name)&&CSS.supports('color',value))document.documentElement.style.setProperty(name,value);
    if(name==='--quit-font'&&CSS.supports('font-family',value))document.documentElement.style.setProperty(name,value);
  }
});
window.addEventListener('DOMContentLoaded',()=>{
  const keep=document.getElementById('quitKeep');
  const leave=document.getElementById('quitLeave');
  const close=document.getElementById('quitClose');
  const buttons=[close,keep,leave];let answered=false;
  const answer=confirmed=>{
    if(answered||!id)return;answered=true;
    for(const button of buttons)button.disabled=true;
    ipcRenderer.send('orangetalk:quit-dialog-response',{id,confirmed});
  };
  keep.addEventListener('click',()=>answer(false));
  close.addEventListener('click',()=>answer(false));
  leave.addEventListener('click',()=>answer(true));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();answer(false);return;}
    if(event.key!=='Tab')return;
    const index=buttons.indexOf(document.activeElement);
    if(event.shiftKey&&index<=0){event.preventDefault();leave.focus();}
    else if(!event.shiftKey&&(index===buttons.length-1||index<0)){event.preventDefault();close.focus();}
  });
  keep.focus({preventScroll:true});
});
