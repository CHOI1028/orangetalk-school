'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const express=require('express');
const {createSurveyRouter}=require('../survey-server/router');
const {SurveyPublishingService}=require('../src/main/services/survey-publishing-service');
const draft=()=>({formId:'resilience',title:'복구 테스트',sections:[{title:'의견',questions:[{id:1,type:'short_text',text:'내용',required:true}]}]});
function store(){const data=new Map();return {get:(s,k)=>({exists:data.has(s+k),data:structuredClone(data.get(s+k))}),set:(s,k,v)=>{data.set(s+k,structuredClone(v));return{success:true};}};}
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'survey-resilience-'));let time=new Date('2026-11-11T09:00:00+09:00');
  const app=express();app.use(createSurveyRouter({dataDir:dir,authenticate:(c,k)=>c==='school'&&k==='test-token',now:()=>time}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,connection={relayUrl:base,channelId:'school',authToken:'test-token'},rows=new Map(),storage=store();
  const service=new SurveyPublishingService(storage,{save(meta,answers){rows.set(meta.student_persistent_id,{meta,answers});return{success:true};}});
  const published=await service.publish({connection,draft:draft(),recipients:[],year:2026});
  const id=published.url.split('/').pop(),url=base+'/api/v1/surveys/public/'+id;
  const body=n=>({submissionId:'submission_identifier_'+n,version:1,student:{name:'가상학생'+n,grade:1,cls:1,num:n},answers:{1:'의견'+n}});
  const submit=b=>fetch(url+'/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  return {base,connection,rows,storage,service,dir,id,url,body,submit,setTime:v=>{time=new Date(v);}};
}

test('125 students behind one school IP can open and submit, then sync across pages without loss',async t=>{
  const f=await fixture(t);
  const results=await Promise.all(Array.from({length:125},async(_,i)=>{
    const opened=await fetch(f.url);assert.equal(opened.status,200,'school shared IP must support a class');
    return (await f.submit(f.body(i+1))).status;
  }));
  assert(results.every(s=>s===201),JSON.stringify(results));
  const a=f.service.sync('resilience'),b=f.service.sync('resilience');assert.equal(a,b,'overlapping sync requests share one task');
  const result=await a;assert.equal(result.count,125);assert.equal(result.unmatched,125);assert.equal(f.rows.size,125);
  assert.equal((await f.service.sync('resilience')).count,0);
  const saved=JSON.parse(fs.readFileSync(path.join(f.dir,f.id+'.json'),'utf8'));assert.equal(saved.responses.length,0);assert.equal(saved.receipts.length,125);
});

test('ack failure leaves responses recoverable and retry upserts instead of duplicating',async t=>{
  const f=await fixture(t);assert.equal((await f.submit(f.body(1))).status,201);let failAck=true;
  const actualFetch=f.service.fetch;f.service.fetch=(url,options)=>{if(failAck&&url.endsWith('/ack')){failAck=false;throw Error('simulated connection lost');}return actualFetch(url,options);};
  await assert.rejects(f.service.sync('resilience'),/connection lost/);assert.equal(f.rows.size,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,f.id+'.json'),'utf8')).responses.length,1);
  assert.equal((await f.service.sync('resilience')).count,1);assert.equal(f.rows.size,1);
  assert.equal((await (await f.submit(f.body(1))).json()).duplicate,true);assert.equal((await f.service.sync('resilience')).count,0);
});

test('Korean start and end time boundaries, closed retries, and same definition republication',async t=>{
  const f=await fixture(t),d={...draft(),startDate:'2026-11-11',endDate:'2026-11-11',endTime:'09:00'};
  await f.service.publish({connection:f.connection,draft:d,year:2026});
  f.setTime('2026-11-10T23:59:59+09:00');assert.equal((await fetch(f.url)).status,410);
  f.setTime('2026-11-11T00:00:00+09:00');assert.equal((await fetch(f.url)).status,200);
  f.setTime('2026-11-11T09:00:59+09:00');assert.equal((await f.submit({...f.body(1),version:2})).status,201);
  f.setTime('2026-11-11T09:01:00+09:00');assert.equal((await f.submit({...f.body(2),version:2})).status,410);
  assert.equal((await (await f.submit({...f.body(1),version:2})).json()).duplicate,true);
  assert.equal((await f.service.sync('resilience')).count,1);
  const republished=await f.service.publish({connection:f.connection,draft:d,year:2026});assert.equal(republished.version,2);
});

test('public API rejects malformed, oversized, internal-index and traversal requests',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.url+'/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
  assert.equal((await f.submit({...f.body(1),answers:{1:'x'.repeat(140000)}})).status,413);
  assert.equal((await f.submit({...f.body(1),student:{name:'학생',grade:0,cls:1,num:1}})).status,400);
  const index='index_'+crypto.createHash('sha256').update('school\0resilience').digest('hex');
  assert.equal((await fetch(f.base+'/api/v1/surveys/public/'+index)).status,404);
  assert.equal((await fetch(f.base+'/s/'+index)).status,404);
  assert.equal((await fetch(f.base+'/api/v1/surveys/public/%2e%2e%2fsecret')).status,404);
});

test('publication reports local metadata storage failures and rejects absent form IDs',async()=>{
  const storage=store();storage.set=()=>({success:false,error:'disk full'});
  const service=new SurveyPublishingService(storage,{}, {fetchImpl:async()=>({ok:true,status:200,json:async()=>({success:true,path:'/s/abcdefghijklmnopqrstuvwx',version:1})})});
  await assert.rejects(service.publish({connection:{relayUrl:'https://test.invalid',channelId:'school',authToken:'test-token'},draft:draft(),year:2026}),/disk full|저장/);
  for(const id of [undefined,null,{},'../bad'])assert.throws(()=>service.key(id),/ID/);
});

test('public request throttling remains bounded and resets after a minute',async t=>{
  const f=await fixture(t);for(let i=0;i<600;i++)assert.equal((await fetch(f.url)).status,200);
  assert.equal((await fetch(f.url)).status,429);f.setTime('2026-11-11T09:01:00+09:00');assert.equal((await fetch(f.url)).status,200);
});
