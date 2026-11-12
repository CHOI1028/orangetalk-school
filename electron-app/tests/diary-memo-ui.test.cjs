const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');

test('Electron: date navigation, memo layout and immediate save across diary lists', {timeout:60000}, async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[path.join(__dirname,'fixtures/diary-memo-ui-electron.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>{child.kill();reject(Error('UI fixture timed out'));},55000);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
  });
  assert.equal(result.code,0,result.output);
});
