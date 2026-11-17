/* 기간검색의 실제 호버 연결을 가상 DOM으로 검사한다. 사용자 자료와 DB는 사용하지 않는다. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const daily=fs.readFileSync(path.join(__dirname,'../src/renderer/features/daily/daily-view.js'),'utf8');
const layout=fs.readFileSync(path.join(__dirname,'../src/renderer/features/shell/sibling-layout.js'),'utf8');
function named(name,source=daily){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);assert(start>=0&&end>start,name);return source.slice(start,end+2);}
function node(){
 const classes=new Set(),listeners={},values=new Map();
 return {dataset:{},listeners,isConnected:true,scrollTop:37,
  classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},
  style:{display:'',setProperty(k,v,p){values.set(k,[v,p||'']);this[k]=v;},getPropertyValue:k=>values.get(k)?.[0]||'',getPropertyPriority:k=>values.get(k)?.[1]||'',removeProperty(k){values.delete(k);this[k]='';}},
  addEventListener(type,callback){(listeners[type]??=[]).push(callback);},
  dispatch(type,event){for(const callback of listeners[type]||[])callback(event);}
 };
}
function harness(){
 const history=node(),date=node(),normal=node(),emergency=node(),infection=node();date.dataset.contextHistory='true';
 date.querySelector=()=>date;
 date.scrollTo=({top})=>{date.scrollTop=top;};
 const visits=[],calls={actions:0,privacy:0};let period=null,popup=null;
 const ids={recBody:normal,ecListBody:emergency,infListBody:infection,sideVisitHistory:history,dateVisitorsPanel:date};
 const context=vm.createContext({S:{records:[{id:1,studentId:'alpha'}]},_lastHoverStuId:null,
  document:{getElementById:id=>id==='symCatOverlay'?popup:ids[id]||null,querySelector:selector=>selector==='#dailyPeriodTable tbody'?period:selector==='#recTable thead'?head:null},
  clearTimeout(){},setTimeout:callback=>{callback();return 1;},requestAnimationFrame:callback=>callback(),
  showVisitHistory(id){visits.push(id);context._showVisitHistory();},_closeDateVisitors(){throw Error('날짜 목록을 삭제하면 안 됨');},
  renderDailyRecordRows:()=>'<tr></tr>',applyDailyColLayout(){},
  expandInlineMemoEditor(){},
  bindDailyRecordActions(){calls.actions++;},bindDiaryPrivacy(){calls.privacy++;}
 });
 const head={cloneNode(){return {outerHTML:'<thead><tr><th></th></tr></thead>',querySelectorAll:()=>[],querySelector:()=>({textContent:''})};}};
 const container={set innerHTML(value){period=node();},querySelector:()=>({querySelectorAll:()=>[],querySelector:()=>period})};
 for(const name of ['_onNameHover','_onTbodyLeave','_bindNameHoverVisitHistory','_setDateVisitorsHistoryPreview','_showVisitHistory','_hideVisitHistory','renderDailyPeriodTable'])vm.runInContext(named(name),context);
 const render=()=>context.renderDailyPeriodTable(container,[],false,()=>true,'가상 기간');
 const hover=id=>period.dispatch('mouseover',{target:{closest:selector=>selector==='tr[data-stu-id]'?{dataset:{stuId:id}}:null}});
 return {context,history,date,normal,emergency,infection,visits,calls,render,hover,get period(){return period;},setPopup(value){popup=value;}};
}
test('기간검색 표를 그릴 때 실제 호버와 해제 핸들러를 연결한다',()=>{
 const h=harness();h.render();assert.equal(h.period.listeners.mouseover.length,1);assert.equal(h.period.listeners.mouseleave.length,1);assert.deepEqual(h.calls,{actions:1,privacy:1});
});
test('기존 일반일지·응급처치·감염병의 연결을 유지한다',()=>{
 const h=harness();h.render();for(const body of [h.normal,h.emergency,h.infection])assert.equal(body.listeners.mouseover.length,1);
});
test('재연결을 요청해도 같은 표에 이벤트를 중복 등록하지 않는다',()=>{
 const h=harness();h.render();h.context._bindNameHoverVisitHistory();h.context._bindNameHoverVisitHistory();assert.equal(h.period.listeners.mouseover.length,1);assert.equal(h.history.listeners.mouseleave.length,1);
});
test('재조회·쪽 이동으로 교체된 새 표에도 호버를 연결한다',()=>{
 const h=harness();h.render();const previous=h.period;h.render();assert.notEqual(h.period,previous);h.hover('alpha');assert.deepEqual(h.visits,['alpha']);
});
test('인원을 옮겨 가리키면 해당 인원의 이력으로 전환한다',()=>{
 const h=harness();h.render();h.hover('alpha');h.hover('alpha');h.hover('beta');assert.deepEqual(h.visits,['alpha','beta']);
});
test('이력 미리보기 동안 날짜 목록을 삭제하지 않고 임시 숨김한다',()=>{
 const h=harness();h.render();h.hover('alpha');assert.equal(h.date.style.display,'none');assert.equal(h.date.scrollTop,37);assert(h.history.classList.contains('vh-show'));
});
test('결과 목록에서 이력 카드로 이동해도 이력을 유지한다',()=>{
 const h=harness();h.render();h.hover('alpha');h.period.dispatch('mouseleave',{relatedTarget:{closest:selector=>selector.includes('#sideVisitHistory')?h.history:null}});assert(h.history.classList.contains('vh-show'));
});
test('이력 카드에서 기간검색 결과로 돌아올 때도 불필요하게 숨기지 않는다',()=>{
 const h=harness();h.render();h.hover('alpha');h.history.dispatch('mouseleave',{relatedTarget:{closest:selector=>selector.includes('#dailyPeriodTable tr[data-stu-id]')?{}:null}});assert(h.history.classList.contains('vh-show'));assert.equal(h.date.style.display,'none');
});
test('목록과 이력을 벗어나면 원래 날짜 목록과 스크롤을 복원한다',()=>{
 const h=harness();h.render();h.hover('alpha');h.period.dispatch('mouseleave',{relatedTarget:{closest:()=>null}});assert.equal(h.date.style.display,'');assert.equal(h.date.scrollTop,37);assert.equal(h.history.classList.contains('vh-show'),false);
});
test('커서를 뗀 뒤 같은 인원을 다시 가리켜도 이력이 열린다',()=>{
 const h=harness();h.render();h.hover('alpha');h.period.dispatch('mouseleave',{relatedTarget:null});h.hover('alpha');assert.deepEqual(h.visits,['alpha','alpha']);assert(h.history.classList.contains('vh-show'));
});
test('증상·처치 작성 중 잠긴 인원의 이력을 다른 인원으로 바꾸지 않는다',()=>{
 const h=harness();h.render();h.hover('alpha');h.context.S._visitHistoryLocked=true;h.hover('beta');assert.deepEqual(h.visits,['alpha']);
});
test('증상·처치 창이 열려 있으면 커서를 떼도 이력을 유지한다',()=>{
 const h=harness();h.render();h.hover('alpha');h.setPopup({});h.period.dispatch('mouseleave',{relatedTarget:null});assert(h.history.classList.contains('vh-show'));
});
test('증상·처치 창을 열 때 이름 호버로 가려진 날짜 목록과 스크롤을 복원한다',()=>{
 const h=harness();h.render();h.hover('alpha');
 h.date.scrollTop=0;
 h.context._hideVisitHistory(true);h.setPopup({});
 assert.equal(h.date.style.display,'');assert.equal(h.date.scrollTop,37);assert.equal(h.history.style.display,'none');
});
test('증상·처치 저장으로 최근 이력이 갱신되어도 같은 날짜 목록을 유지한다',()=>{
 const h=harness();h.setPopup({});
 h.context._showVisitHistory();
 assert.equal(h.date.style.display,'');assert.equal(h.date.scrollTop,37);assert(!h.history.classList.contains('vh-show'));
 h.setPopup(null);h.context._showVisitHistory();assert(h.history.classList.contains('vh-show'));
});
test('날짜 목록이 없으면 증상·처치 창에서도 최근 이력이 표시된다',()=>{
 const h=harness();delete h.date.dataset.contextHistory;h.setPopup({});h.context._showVisitHistory();
 assert(h.history.classList.contains('vh-show'));
});
test('증상·처치와 날짜 목록을 함께 보는 중에는 작은 창으로 바꿔도 사이드바가 열린 상태를 유지한다',()=>{
 for(const [editing,selectedDate] of [[true,true],[true,false],[false,true]]){
  const classes=new Set(['school-interface','school-context-open']);
  const classList={contains:key=>classes.has(key),toggle(key,on){if(on)classes.add(key);else classes.delete(key);}};
  const document={body:{dataset:{activeView:'daily'},classList},
   getElementById:id=>id==='symCatOverlay'&&editing?{}:null,
   querySelector:()=>selectedDate?{}:null};
  const noop=()=>{};
  const context=vm.createContext({document,window:{innerWidth:1000,innerHeight:800},root:{style:{}},frame:0,
   contextLayout:'docked',dockedContextOpen:true,lastView:'daily',setSize:noop,installShellControls:noop,
   syncContextAccessibility:noop,keepPopupsInView:noop,refineSchoolActions:noop});
  vm.runInContext(named('isReadingDateHistory',layout)+'\n'+named('syncLayout',layout)+'\nsyncLayout();',context);
  assert(classes.has('school-context-drawer'));
  assert.equal(classes.has('school-context-open'),editing&&selectedDate);
 }
});
for(const id of ['', 'undefined', 'null'])test('연결할 인원 번호가 없으면 안전하게 건너뛴다: '+id,()=>{
 const h=harness();h.render();h.hover(id);assert.deepEqual(h.visits,[]);
});
test('이력 조회와 전환은 원래 기록 배열을 변경하지 않는다',()=>{
 const h=harness();const before=JSON.stringify(h.context.S.records);h.render();h.hover('alpha');h.hover('beta');h.period.dispatch('mouseleave',{relatedTarget:null});assert.equal(JSON.stringify(h.context.S.records),before);
});
test('기간검색 내부 클릭을 방문 이력 바깥 클릭으로 처리하지 않는다',()=>{
 assert(daily.includes("if(e.target.closest('#recBody,#dailyPeriodTable,#ecListBody,#infListBody'))return;"));
});
