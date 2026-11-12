const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs');
test('Electron: real detail view and existing record form preserve manual inputs', {timeout:60000},async()=>{
  const electron=require('electron');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(electron,[path.join(__dirname,'fixtures/infectious-ui-electron.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timeout=setTimeout(()=>{child.kill();reject(Error('Electron fixture timed out'));},55000);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);resolve({code,output});});
  });
  assert.equal(result.code,0,result.output);
  const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../_preview/infectious-ui/report.json'),'utf8'));
  assert(report.checks>=15);assert.equal(report.externalRequests,0);
});
