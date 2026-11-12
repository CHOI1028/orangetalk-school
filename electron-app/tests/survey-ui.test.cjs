'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
test('real editor saves distinct drafts, publishes, and imports a mobile response into targeted statistics',{timeout:65000},async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[path.join(__dirname,'fixtures/survey-ui-electron.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>{child.kill();reject(Error('UI test timed out'));},60000);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
  });
  assert.equal(result.code,0,result.output);
});
