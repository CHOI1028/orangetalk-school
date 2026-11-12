'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSurveyRouter } = require('../survey-server/router');
const { SurveyPublishingService } = require('../src/main/services/survey-publishing-service');
const { SurveyStoreService } = require('../src/main/services/blob-store-services');
const { SurveyDefinitionService, SurveyFormService } = require('../src/main/services/survey-db-service');
const model = require('../src/shared/survey-model');
const draft = () => ({ formId:'sv_test',title:'테스트 설문',sections:[{title:'첫 질문',questions:[{id:1,type:'radio',text:'참여하시겠습니까?',required:true,options:['예','아니오'],sectionJump:true,jumpMap:{1:'end'}}]},{title:'추가 질문',questions:[{id:2,type:'short_text',text:'의견',required:true}]}] });
function memoryStore() {
  const data=new Map();return {get:(s,k)=>({exists:data.has(s+k),data:data.get(s+k)}),set:(s,k,v)=>{data.set(s+k,structuredClone(v));return{success:true};},batchSet(items){items.forEach(i=>this.set(i.scope,i.key,i.value));return{success:true};}};
}
test('health template and all supported answer types; branching discards skipped sensitive answers',()=>{
  const health = new SurveyDefinitionService().createDefaultDraft({schoolName:'테스트학교',year:2026});
  assert.equal(model.validateDefinition(health),health);
  assert.deepEqual(model.validateResponses(draft(),{1:'아니오',2:'must not be saved'}),{1:'아니오'});
  assert.throws(()=>model.validateResponses(draft(),{1:'예'}),/필수/);
  assert.throws(()=>model.validateResponses(draft(),{1:'invalid'}),/형식/);
  const good={short_text:'텍스트',paragraph:'긴 글',radio:'A',dropdown:'A',checkbox:['A'],grid_radio:{0:'A'},grid_text:{'0:0':'내용'},star:'1',scale:'1',date_cal:'2026-11-11',date_text:'2026-11-11',time_clock:'09:30',time_text:'09:30'};
  for(const type of model.TYPES) model.validateAnswer({id:1,type,text:'test',required:true,options:type==='star'||type==='scale'?['1','2']:['A','B'],gridRows:['행'],gridCols:['A']},good[type]);
  assert.throws(()=>model.validateAnswer({type:'date_text',text:'날짜'},'2026-02-30'));
  const bad=draft();bad.sections[1].questions[0]={...bad.sections[0].questions[0],id:3,jumpMap:{0:'0'}};
  assert.throws(()=>model.validateDefinition(bad),/뒤쪽/);
});
test('created survey definitions survive store reload',()=>{
  const store=memoryStore();const service=new SurveyStoreService(store);
  service.saveWorkspace({createdSurveys:[{formId:'a',draft:draft()}]});service.saveDraft({title:'other draft'});
  assert.equal(new SurveyStoreService(store).getWorkspace().createdSurveys[0].draft.title,'테스트 설문');
});
test('form storage keeps separate drafts and frees deleted slots without relying on removed SQL tables',()=>{
  const store=memoryStore(),db={now:()=>new Date().toISOString()},service=new SurveyFormService(db,null,store);
  service.save({id:'first',title:'첫 설문'},draft());service.copy('first','second','두 번째');
  assert.equal(service.get('second').content.formId,'second');assert.equal(service.get('first').content.title,'테스트 설문');
  assert.throws(()=>service.copy('first','second','중복'),/존재/);
  assert.throws(()=>service.save({id:'../escape'},draft()),/ID/);
  service.delete('first');assert.equal(new SurveyFormService(db,null,store).list().length,1);
});

test('form limit allows existing edits and failed deletion does not report success',()=>{
  const store=memoryStore(),service=new SurveyFormService({now:()=>new Date().toISOString()},null,store);
  for(let i=0;i<50;i++)service.save({id:'form_'+i,title:'설문'},draft());
  assert.throws(()=>service.save({id:'form_50'},draft()),/50/);
  service.save({id:'form_0',title:'수정'},draft());assert.equal(service.get('form_0').meta.title,'수정');
  const set=store.set;store.set=()=>({success:false});assert.throws(()=>service.delete('form_0'),/삭제/);assert(service.get('form_0'));
  store.set=set;service.delete('form_0');service.save({id:'form_50'},draft());assert.equal(service.list().length,50);
});
test('publish → public response → restart → sync/ack → close, with isolated channel authorization',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orangetalk-survey-test-'));
  let server;
  const start=async()=>{
    const app=express(); app.use(createSurveyRouter({dataDir:dir,authenticate:async(channel,token)=>token==='test-'+channel}));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return 'http://127.0.0.1:'+server.address().port;
  };
  const stop=()=>new Promise(resolve=>server.close(resolve));
  t.after(async()=>{if(server?.listening)await stop();fs.rmSync(dir,{recursive:true,force:true});});
  let base=await start();const store=memoryStore(), rows=new Map();let failWrite=false;
  const responses={save(meta,content){if(failWrite)throw Error('disk full');rows.set(meta.student_persistent_id,{meta,content});return{success:true};}};
  const service=new SurveyPublishingService(store,responses);
  const conn={relayUrl:base,channelId:'schoolA',authToken:'test-schoolA'};
  const published=await service.publish({connection:conn,draft:draft(),recipients:[{uid:'student-1',name:'가상학생',grade:1,cls:2,num:3}],year:2026});
  const id=published.url.split('/').pop();
  const publicUrl=base+'/api/v1/surveys/public/'+id;
  const publicData=await (await fetch(publicUrl)).json();
  assert.equal(publicData.definition.selectedStudents,undefined);assert.equal(JSON.stringify(publicData).includes('가상학생'),false);
  const wrong=await fetch(base+'/api/v1/surveys/channels/schoolA/forms/sv_test/responses',{headers:{Authorization:'Bearer test-schoolB'}});assert.equal(wrong.status,403);
  const missing=await fetch(base+'/api/v1/surveys/channels/schoolA/forms/sv_test/responses');assert.equal(missing.status,401);
  const other=await fetch(base+'/api/v1/surveys/channels/schoolB/forms/sv_test/responses',{headers:{Authorization:'Bearer test-schoolB'}});assert.equal(other.status,404);
  const body={submissionId:'retry_identifier_123456789',version:1,student:{name:'가상학생',grade:1,cls:2,num:3},answers:{1:'예',2:'학교 생활 의견'}};
  const submit=payload=>fetch(publicUrl+'/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal((await submit({...body,answers:{1:'예'}})).status,400);
  assert.equal((await submit({...body,version:999})).status,409);
  assert.equal((await submit(body)).status,201);assert.equal((await (await submit(body)).json()).duplicate,true);
  const changed=draft();changed.title='변경';await assert.rejects(service.publish({connection:conn,draft:changed,year:2026}),/변경/);
  failWrite=true;await assert.rejects(service.sync('sv_test'),/disk full/);
  failWrite=false;
  await stop();base=await start();const stored=service.get('sv_test');stored.connection.relayUrl=base;service.set('sv_test',stored);
  const synced=await service.sync('sv_test');assert.equal(synced.count,1);assert.equal(synced.unmatched,0);assert.equal(rows.size,1);assert.equal(rows.get('student-1').content[2],'학교 생활 의견');
  assert.equal((await service.sync('sv_test')).count,0);
  const disk=fs.readFileSync(path.join(dir,id+'.json'),'utf8');assert.equal(disk.includes('학교 생활 의견'),false);
  await service.close('sv_test');assert.equal((await fetch(base+'/api/v1/surveys/public/'+id)).status,410);
  const expired=draft();expired.formId='expired';expired.startDate='2020-01-01';expired.endDate='2020-01-02';
  const expiredPub=await service.publish({connection:{...conn,relayUrl:base},draft:expired,year:2026});
  assert.equal((await fetch(base+'/api/v1/surveys/public/'+expiredPub.url.split('/').pop())).status,410);
});
