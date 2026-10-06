'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/core/event-bindings.js'),'utf8').replace(/\r\n/g,'\n');
const anchor="  on($id('advSearchSidebarBtn'), 'click', function(){";
const start=source.indexOf(anchor),end=source.indexOf('\n  });',start);
assert(start>=0&&end>start,'Sidebar advanced-search handler must exist');
const handler=source.slice(start,end+6);
function run(category,visible=true,hasView=true){
  let click,pick;const calls=[];
  const view={querySelector(selector){assert.equal(selector,':scope > .school-subnav > .magic-index-tab.active');return category===null?null:{dataset:{cat:category}};}};
  const context=vm.createContext({
    $id:()=>({}),on:(_element,event,fn)=>{assert.equal(event,'click');click=fn;},
    document:{getElementById(id){assert.equal(id,'view-daily');return hasView?view:null;}},
    getComputedStyle:()=>({display:visible?'block':'none'}),
    openAdvancedSearch:callback=>{pick=callback;},
    selectStudent:id=>calls.push(['general',id]),
    ecSelectStudent:id=>calls.push(['emergency',id]),
    infSelectStudent:id=>calls.push(['infection',id])
  });
  vm.runInContext(handler,context);click();assert.equal(typeof pick,'function');pick('synthetic-student-id');return calls;
}
for(const category of ['general','emergency','infection']){
  test('sidebar advanced search selects the active '+category+' workflow',()=>assert.deepEqual(run(category),[[category,'synthetic-student-id']]));
  test('hidden '+category+' tab cannot redirect home sidebar search',()=>assert.deepEqual(run(category,false),[['general','synthetic-student-id']]));
}
test('missing active tab falls back to general safely',()=>assert.deepEqual(run(null),[['general','synthetic-student-id']]));
test('missing daily view falls back to general safely',()=>assert.deepEqual(run(null,true,false),[['general','synthetic-student-id']]));
test('unknown tab never dispatches to an unrelated specialist form',()=>assert.deepEqual(run('unknown'),[['general','synthetic-student-id']]));
