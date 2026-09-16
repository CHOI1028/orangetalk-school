'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../src/renderer');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport (?=(?:async )?function|const|let)/g,'');
const state=read('core/public-data-settings.js');
const connection=read('core/public-data-connection.js');
const ui=read('features/settings/settings-public-data.js');
function harness(values={},api={}){
  const store=new Map(Object.entries(values));
  const storage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const context=vm.createContext({URL,localStorage:storage,window:{electronAPI:api},confirm:()=>true});
  vm.runInContext(state+'\n'+connection+'\n'+ui,context);
  return {store,storage,context,run:code=>vm.runInContext(code,context)};
}
const ok={success:true,status:200,data:{response:{header:{resultCode:'00'},body:{items:[],totalCount:0}}}};
const key='SYNTHETIC+SHARED/KEY=';
for(const [label,reply,success] of [
  ['JSON success',ok,true],
  ['JSON string',{...ok,data:JSON.stringify(ok.data)},true],
  ['XML success',{...ok,data:'<response><header><resultCode>00</resultCode></header><body><items/></body></response>'},true],
  ['XML unapproved',{...ok,data:'<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'},false],
  ['JSON unapproved',{...ok,data:{header:{resultCode:'20'},body:{}}},false],
  ['HTTP error',{...ok,status:403},false],
  ['HTML login',{...ok,data:'<html>LOGIN '+key+'</html>'},false],
  ['success wrapper without API header',{...ok,data:{body:{items:[]}}},false],
  ['unknown code',{...ok,data:{header:{resultCode:key},body:{}}},false],
  ['transport failure',{success:false,error:'https://example.com/?key='+key},false],
  ['no body',{...ok,data:{header:{resultCode:'00'}}},false]
])test('connection inspection: '+label,()=>{
  const h=harness();h.context.reply=reply;
  const result=h.run('inspectPublicDataResponse(reply)');
  assert.equal(result.success,success);assert.ok(!result.message.includes(key));
});
for(const service of ['kma','uv','airkorea','drug','hira','emergency','kdca','holiday']){
  test('connection check uses only official endpoint and single encoding: '+service,async()=>{
    const calls=[];
    const h=harness({}, {externalFetchJson:async url=>{calls.push(new URL(url));return ok;}});
    h.context.service=service;h.context.key=encodeURIComponent(key);
    const response=await h.run("checkPublicDataConnection(service,key,window.electronAPI,new Date('2026-09-15T16:20:00Z'))");
    assert.equal(response.success,true);
    assert.equal(calls.length,['airkorea','hira'].includes(service)?2:1);
    for(const url of calls){
      assert.equal(url.origin,'https://apis.data.go.kr');
      assert.equal(url.searchParams.get(service==='holiday'?'ServiceKey':'serviceKey'),key);
      assert.equal(url.searchParams.get('numOfRows'),'1');
    }
    if(service==='kma'){assert.equal(calls[0].searchParams.get('base_date'),'20260915');assert.equal(calls[0].searchParams.get('base_time'),'2330');}
  });
}
test('HIRA requires pharmacy success too; a successful hospital does not hide failure',async()=>{
  let calls=0;
  const h=harness({}, {externalFetchJson:async()=>++calls===1?ok:{...ok,data:{response:{header:{resultCode:'30'}}}}});
  const r=await h.run("checkPublicDataConnection('hira','SYNTHETIC',window.electronAPI)");
  assert.equal(r.success,false);assert.match(r.message,/약국정보/);assert.equal(calls,2);
});
test('UV tries supported alternative after first endpoint fails',async()=>{
  let calls=0;const h=harness({}, {externalFetchJson:async()=>++calls===1?{...ok,status:403}:ok});
  assert.equal((await h.run("checkPublicDataConnection('uv','SYNTHETIC',window.electronAPI)")).success,true);
  assert.equal(calls,2);
});
test('missing key performs no network calls',async()=>{
  const h=harness({}, {externalFetchJson:async()=>{throw Error('must not call');}});
  assert.equal((await h.run("checkPublicDataConnection('kma','',window.electronAPI)")).success,false);
});
test('common UI renders one masked input, not service-specific key inputs',()=>{
  const h=harness({ec_public_data_api_key:key});
  const html=h.run('renderPublicDataSettings()');
  assert.equal((html.match(/<input\b/g)||[]).length,1);assert.match(html,/type="password"/);assert.doesNotMatch(html,/data-save-key/);
  for(const service of ['kma','uv','airkorea','drug','hira','emergency','kdca','holiday']){
    h.context.card={lsKey:'ec_'+service+'_api_key',title:'Test',icon:'',desc:'Description',link:'https://www.data.go.kr/'};
    const card=h.run('renderPublicDataService(card)');
    assert.doesNotMatch(card,/<input/);assert.match(card,/공통 키 사용/);assert.doesNotMatch(card,/연결 확인 완료|반영 완료/);
  }
  assert.equal(h.run("publicDataServiceForKey('ec_neis_api_key')"),'');
  assert.equal(h.run("publicDataServiceForKey('ec_kakao_rest_api_key')"),'');
});
test('legacy equal keys offer opt-in migration, conflicting keys are never guessed',()=>{
  const a=harness({ec_kma_api_key:key,ec_drug_api_key:encodeURIComponent(key)});
  assert.match(a.run('renderPublicDataSettings()'),/publicDataUseExistingKey/);
  assert.equal(a.store.has('ec_public_data_api_key'),false);
  const b=harness({ec_kma_api_key:key,ec_drug_api_key:'DIFFERENT'});
  assert.match(b.run('renderPublicDataSettings()'),/서로 다른 기존 인증키/);
  assert.doesNotMatch(b.run('renderPublicDataSettings()'),/publicDataUseExistingKey/);
});
function elements(){
  const make=()=>({value:'',type:'password',disabled:false,textContent:'',dataset:{},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},setAttribute(){},focus(){}});
  const input=make(),save=make(),toggle=make(),status=make();
  const nodes={'#publicDataCommonKey':input,'#publicDataKeySave':save,'#publicDataKeyToggle':toggle,'#publicDataKeyStatus':status};
  return {input,save,status,container:{querySelector:selector=>nodes[selector]||null,querySelectorAll:()=>[]}};
}
test('typing is not saved; rejected DB save does not mark completion or refresh',async()=>{
  let writes=0,changed=0,rendered=0;
  const h=harness({ec_public_data_api_key:'OLD'}, {dbSet:async()=>{writes++;return {success:false,error:key};}});
  const e=elements();h.context.container=e.container;
  h.context.callbacks={onChanged:()=>changed++,onRender:()=>rendered++};
  h.run('bindPublicDataSettings(container,callbacks)');e.input.value=key;e.input.handlers.input();
  assert.equal(writes,0);assert.equal(h.store.get('ec_public_data_api_key'),'OLD');
  await e.save.handlers.click();
  assert.equal(writes,1);assert.equal(changed,0);assert.equal(rendered,0);
  assert.match(e.status.textContent,/저장하지 못/);assert.ok(!e.status.textContent.includes(key));
  assert.equal(e.save.disabled,false);assert.equal(e.input.disabled,false);
});
test('common save waits for acknowledged persistence then refreshes all service consumers',async()=>{
  let accept,changed=0,rendered=0;
  const h=harness({}, {dbSet:()=>new Promise(resolve=>accept=resolve)});
  const e=elements();h.context.container=e.container;h.context.callbacks={onChanged:()=>changed++,onRender:()=>rendered++};
  h.run('bindPublicDataSettings(container,callbacks)');e.input.value=key;
  const pending=e.save.handlers.click();
  assert.equal(h.store.has('ec_public_data_api_key'),false);assert.equal(e.save.disabled,true);assert.equal(changed,0);
  accept({success:true});await pending;
  assert.equal(h.store.get('ec_public_data_api_key'),key);assert.equal(changed,1);assert.equal(rendered,1);
});
test('clearing common key preserves old registrations but prevents their reuse',async()=>{
  const h=harness({ec_public_data_api_key:key,ec_drug_api_key:'OLD'}, {dbSet:async()=>({success:true})});
  const e=elements();h.context.container=e.container;h.run('bindPublicDataSettings(container)');
  e.input.value='';await e.save.handlers.click();
  assert.equal(h.store.get('ec_drug_api_key'),'OLD');assert.equal(h.run("getPublicDataApiKey('drug')"),'');
});
test('production wiring uses dedicated load, never generic empty-value recovery for the common key',()=>{
  const loader=fs.readFileSync(path.join(root,'core/data-loader.js'),'utf8');
  const settings=fs.readFileSync(path.join(root,'features/settings/settings-view.js'),'utf8');
  assert.match(loader,/function _doBackendLoad\(yr\)\{\s*_refreshPublicDataKey\(\)/);
  assert.match(loader,/_fullRefreshFn=function\(\)\{\s*if\(!window.electronAPI\)return;\s*_refreshPublicDataKey\(\)/);
  assert.doesNotMatch(loader,/commonMappings\.push\(\{dbKey:'public_data_api_key'/);
  assert.match(settings,/h\+=renderPublicDataSettings\(\)/);
  assert.ok(settings.includes('if(publicDataServiceForKey(o.lsKey))return renderPublicDataService(o)'));
});
