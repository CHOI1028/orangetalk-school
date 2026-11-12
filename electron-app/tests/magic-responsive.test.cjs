'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path');
test('Magic Station resizes without inaccessible controls or clipped previews',{timeout:255000},async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[path.join(__dirname,'fixtures/survey-ui-electron.cjs'),'--responsive',...(process.env.MAGIC_RECORD_LAYOUT?['--record-layout']:[])],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>{child.kill();reject(Error('responsive fixture timed out'));},250000);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
  });assert.equal(result.code,0,result.output);
});
