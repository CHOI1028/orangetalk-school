const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/renderer/core/medication-settings.js'),'utf8');
const diary=fs.readFileSync(path.join(root,'src/renderer/features/settings/settings-tab-diary.js'),'utf8');
const nodes=acorn.parse(diary,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'&&n.declaration?n.declaration:n);
const copy=x=>JSON.parse(JSON.stringify(x));
const medA='TEST_MED_A',medB='TEST_MED_B',medC='TEST_MED_C';
const oldMeds={[medA]:['TEST_SYM_A'],[medB]:['TEST_SYM_B']};
function storage(initial={}){
  const data=new Map(Object.entries(initial).map(([k,v])=>[k,JSON.stringify(v)]));
  return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
}
function harness(options={}){
  const ls=storage(options.local||{}),db=copy(options.db||{}),calls=[],messages=[],card={innerHTML:'',addEventListener(){}};
  const api={
    async dbGet(scope,key){if(options.beforeRead)await options.beforeRead(key);if(options.readFail)return {success:false};return {success:true,exists:Object.hasOwn(db,key),data:Object.hasOwn(db,key)?copy(db[key]):null};},
    async dbSet(scope,key,value){calls.push({key,value:copy(value)});if(options.saveFail)return {success:false};db[key]=copy(value);if(options.merge)options.merge(key,db);return {success:true,exists:true,data:copy(db[key])};},
    async medicationSettingsWriteMany(items){
      if(options.saveFail)return {success:false};
      for(const item of items){
        if(Object.hasOwn(db,item.key)!==item.baseExists||JSON.stringify(Object.hasOwn(db,item.key)?db[item.key]:null)!==JSON.stringify(item.base))return {success:false,conflict:true};
      }
      const entries={};
      for(const item of items){calls.push({key:item.key,value:copy(item.value)});db[item.key]=copy(item.value);}
      for(const item of items){if(options.merge)options.merge(item.key,db);entries[item.key]={success:true,exists:true,data:copy(db[item.key])};}
      return {success:true,entries};
    },
    async jsonLoadCommon(){return {success:true,exists:false};}
  };
  const context=vm.createContext({window:{electronAPI:api,__isWebBrowser:!!options.web},localStorage:ls,Date});
  vm.runInContext(source.replace(/^export /gm,'')+'\nglobalThis.medStore=medicationSettings;',context);
  const store=context.medStore;
  Object.assign(context,{medicationSettings:store,document:{getElementById:id=>id==='setMedCardList'?card:null,querySelector:()=>null},S:{},escHtml:String,getSymData:()=>({medDb:{}}),bus:{emit:(...args)=>messages.push(args)},refreshMedHidden(){},_setMedSearchRender(){},_fetchAndCacheDrugFromEyakey(){},_eyakeyQueueRemove(){},_setMedGetSysSyms:()=>['TEST_SYS_SYM'],setTimeout(){},CSS:{escape:String}});
  const names=['_setMedAssertUniqueName','_setMedIsSystem','_medBulkBusy','_medRemovalBusy','_medEditTail','_medLoadState','_setMedEditTarget','_setMedSaveWarning','_setRunMedEdit','_setGetUserAddedMeds','_setMarkUserAddedMed','_setUnmarkUserAddedMed','_setMedAddDirect','_setMedRemove','_setMedRemoveSym','_setMedSymPick','_setMedEnsurePrefilled','_setMedCollectPool','_setMedRenderCards','_setMedEditPopupRenderSlots'];
  const pieces=names.map(name=>{const n=nodes.find(n=>n.id?.name===name||n.declarations?.some(d=>d.id.name===name));assert.ok(n,'함수 연결 누락: '+name);return diary.slice(n.start,n.end);});
  vm.runInContext(pieces.join('\n'),context);
  return {ls,db,calls,messages,card,context,store,run:code=>vm.runInContext(code,context)};
}
function seeded(extra={}){return harness({db:{user_med_syms:oldMeds,user_added_meds:{[medA]:true,[medB]:true}},...extra});}
function localMap(h,key){return JSON.parse(h.ls.getItem('ec_'+key)||'{}');}

test('빈 시작 캐시를 복원하면 실제 카드와 검색에 기존 약품이 표시된다',async()=>{
  const h=seeded();await h.store.load();h.run('_setMedRenderCards()');
  assert.ok(h.card.innerHTML.includes(medA));assert.ok(h.card.innerHTML.includes(medB));
  assert.deepEqual(copy(h.run('_setMedCollectPool()')).sort(),[medA,medB]);assert.equal(h.calls.length,0);
});
test('빈 시작 캐시에서 새 약품을 등록해도 기존 약품과 증상 연결을 보존한다',async()=>{
  const h=seeded();assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),true);
  assert.deepEqual(h.db.user_med_syms,{...oldMeds,[medC]:[]});assert.deepEqual(localMap(h,'user_med_syms'),h.db.user_med_syms);
  assert.equal(h.db.user_added_meds[medA],true);assert.equal(h.db.user_added_meds[medB],true);assert.equal(h.db.user_added_meds[medC],true);
});
test('캐시가 정상인 기존 사용자도 새 약품 추가 시 자료를 보존한다',async()=>{
  const h=seeded({local:{ec_user_med_syms:oldMeds}});await h.run('_setMedAddDirect("TEST_MED_C")');assert.deepEqual(h.db.user_med_syms,{...oldMeds,[medC]:[]});
});
test('수정 직전 저장소를 다시 읽어 다른 PC에서 추가한 약품도 보존한다',async()=>{
  const h=seeded();await h.store.load();h.db.user_med_syms.TEST_REMOTE=[];await h.run('_setMedAddDirect("TEST_MED_C")');assert.ok(Object.hasOwn(h.db.user_med_syms,'TEST_REMOTE'));
});
test('늦은 불러오기가 끝나기 전에는 기존 목록에 쓰지 않는다',async()=>{
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let once=true;
  const h=seeded({beforeRead:async key=>{if(key==='user_med_syms'&&once){once=false;entered();await gate;}}});
  const pending=h.run('_setMedAddDirect("TEST_MED_C")');await started;assert.equal(h.calls.length,0);release();assert.equal(await pending,true);assert.equal(Object.keys(h.db.user_med_syms).length,3);
});
test('빠르게 연속 추가해도 순서대로 저장하여 앞선 약품을 잃지 않는다',async()=>{
  const h=seeded();await Promise.all([h.run('_setMedAddDirect("TEST_MED_C")'),h.run('_setMedAddDirect("TEST_MED_D")')]);assert.equal(Object.keys(h.db.user_med_syms).length,4);
});
test('약품 하나 삭제 시 다른 약품과 매칭은 보존한다',async()=>{
  const h=seeded();await h.run('_setMedRemove("TEST_MED_A")');assert.deepEqual(h.db.user_med_syms,{[medB]:oldMeds[medB]});assert.equal(h.db.user_added_meds[medB],true);
});
test('사용자가 마지막 약품을 명시적으로 삭제하는 것은 허용한다',async()=>{
  const h=harness({db:{user_med_syms:{[medA]:[]},user_added_meds:{[medA]:true}}});await h.run('_setMedRemove("TEST_MED_A")');assert.deepEqual(h.db.user_med_syms,{});assert.deepEqual(h.db.user_added_meds,{});
});
test('증상 연결 변경은 다른 약품의 증상 연결을 보존한다',async()=>{
  const h=seeded();await h.run('_setMedRemoveSym("TEST_MED_A","TEST_SYM_A")');assert.deepEqual(h.db.user_med_syms,{[medA]:[],[medB]:['TEST_SYM_B']});
  h.run('_setMedEditTarget="TEST_MED_A"');await h.run('_setMedSymPick("TEST_NEW_SYM")');assert.deepEqual(h.db.user_med_syms[medB],['TEST_SYM_B']);assert.deepEqual(h.db.user_med_syms[medA],['TEST_NEW_SYM']);
});
test('시스템 매칭 자동 채우기도 기존 상용 약품을 지우지 않는다',async()=>{
  const h=seeded();await h.run('_setRunMedEdit(()=>_setMedEnsurePrefilled("TEST_SYSTEM"),false)');assert.deepEqual(h.db.user_med_syms[medA],oldMeds[medA]);assert.deepEqual(h.db.user_med_syms.TEST_SYSTEM,['TEST_SYS_SYM']);assert.equal(h.db.user_med_syms_prefilled.TEST_SYSTEM,true);
});
test('저장 실패 때 기존 캐시를 바꾸거나 저장 완료를 알리지 않는다',async()=>{
  const h=seeded({saveFail:true});assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.deepEqual(h.db.user_med_syms,oldMeds);assert.deepEqual(localMap(h,'user_med_syms'),oldMeds);assert.equal(h.messages.some(x=>x[0]==='toast:save'),false);assert.ok(h.messages.some(x=>x[0]==='toast:show'));
});
test('불러오기 실패 때 빈 목록을 저장하지 않는다',async()=>{
  const h=seeded({readFail:true});assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.equal(h.calls.length,0);assert.deepEqual(h.db.user_med_syms,oldMeds);
});
test('손상된 저장소 값은 빈 객체로 간주하지 않고 편집을 차단한다',async()=>{
  const h=harness({db:{user_med_syms:[]}});assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.equal(h.calls.length,0);
});
test('손상된 약품 매칭 배열도 저장 전에 차단한다',async()=>{
  const h=harness({db:{user_med_syms:{[medA]:null}}});assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.equal(h.calls.length,0);
});
test('설치형의 저장소에 없는 옛 로컬 약품을 신규 등록 시 보존한다',async()=>{
  const h=harness({local:{ec_user_med_syms:oldMeds}});await h.run('_setMedAddDirect("TEST_MED_C")');assert.deepEqual(h.db.user_med_syms,{...oldMeds,[medC]:[]});
});
test('브라우저에서는 다른 메인 PC의 낡은 로컬 약품을 가져오지 않는다',async()=>{
  const h=harness({web:true,local:{ec_user_med_syms:oldMeds}});await h.run('_setMedAddDirect("TEST_MED_C")');assert.deepEqual(h.db.user_med_syms,{[medC]:[]});
});
test('저장 응답에 병합된 다른 PC의 변경을 캐시에도 반영한다',async()=>{
  const h=seeded({merge:(key,db)=>{if(key==='user_med_syms')db[key].TEST_REMOTE=[];}});await h.store.update('user_med_syms',m=>{m[medC]=[];});assert.ok(Object.hasOwn(localMap(h,'user_med_syms'),'TEST_REMOTE'));
});
test('변경 전 복구용 사본을 보존하고 빈 값으로 지우지 않는다',async()=>{
  const h=seeded();await h.run('_setMedAddDirect("TEST_MED_C")');const backup=JSON.parse(h.ls.getItem('ec_medication_settings_recovery_v1'));assert.deepEqual(backup.user_med_syms.first.value,oldMeds);
  await h.run('_setMedRemove("TEST_MED_A")');assert.deepEqual(JSON.parse(h.ls.getItem('ec_medication_settings_recovery_v1')).user_med_syms.first.value,oldMeds);
});
test('복구용 사본 보존에 실패하면 기존 자료를 덮어쓰지 않는다',async()=>{
  const h=seeded();const set=h.ls.setItem;h.ls.setItem=(key,value)=>{if(key==='ec_medication_settings_recovery_v1')throw Error('Quota');set(key,value);};assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.equal(h.calls.length,0);assert.deepEqual(h.db.user_med_syms,oldMeds);
});
test('재실행을 모사한 새 화면에서도 추가한 약품과 기존 약품이 표시된다',async()=>{
  const h=seeded();await h.run('_setMedAddDirect("TEST_MED_C")');const again=harness({db:h.db});await again.store.load();again.run('_setMedRenderCards()');for(const name of [medA,medB,medC])assert.ok(again.card.innerHTML.includes(name));
});
test('설정 화면을 이미 열어 둔 상태에서도 복원된 최신 목록을 렌더링한다',async()=>{
  const h=seeded();h.run('_setMedRenderCards()');assert.ok(h.card.innerHTML.includes('등록된 약품이 없습니다'));await h.store.load();h.run('_setMedRenderCards()');assert.ok(h.card.innerHTML.includes(medA));
});
test('기존 약품 이름 변경은 다른 이름 변경 설정을 보존한다',async()=>{
  const h=harness({db:{med_renames:{[medB]:'TEST_ALIAS_B'}}});await h.store.update('med_renames',map=>{map[medA]='TEST_ALIAS_A';});assert.deepEqual(h.db.med_renames,{[medB]:'TEST_ALIAS_B',[medA]:'TEST_ALIAS_A'});
});
test('성공하지 않은 약품 등록에서는 검색 입력을 지우지 않는다',()=>{
  assert.match(diary,/if\(!await _setMedAddDirect\(name\)\)return;/);assert.match(diary,/if\(!await _setMedAddDirect\(v\)\)return;/);
});


test('불러오기 실패 뒤 같은 화면에서 재시도하면 오류 표시가 남지 않는다',async()=>{
  const h=seeded(),api=h.context.window.electronAPI,read=api.dbGet;
  api.dbGet=async()=>({success:false});assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.equal(h.run('_medLoadState'),'error');
  api.dbGet=read;assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),true);assert.equal(h.run('_medLoadState'),'ready');assert.ok(h.card.innerHTML.includes(medA));assert.ok(h.card.innerHTML.includes(medC));
});
test('저장 충돌 응답은 완료로 처리하지 않고 기존 목록을 보존한다',async()=>{
  const h=seeded();h.context.window.electronAPI.medicationSettingsWriteMany=async()=>({success:false,conflict:true,exists:true,data:oldMeds});
  assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.deepEqual(h.db.user_med_syms,oldMeds);assert.deepEqual(localMap(h,'user_med_syms'),oldMeds);assert.equal(h.messages.some(x=>x[0]==='toast:save'),false);
});
test('연결 문제로 저장이 대기 중이면 완료 표시와 빈 목록 덮어쓰기를 하지 않는다',async()=>{
  const h=seeded();h.context.window.electronAPI.medicationSettingsWriteMany=async()=>({success:false,pending:true});
  assert.equal(await h.run('_setMedAddDirect("TEST_MED_C")'),false);assert.deepEqual(h.db.user_med_syms,oldMeds);assert.deepEqual(localMap(h,'user_med_syms'),oldMeds);
});
