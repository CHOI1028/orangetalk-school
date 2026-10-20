'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const helperSource=fs.readFileSync(path.join(root,'src/renderer/features/settings/collab-connection-address.js'),'utf8');
const viewSource=fs.readFileSync(path.join(root,'src/renderer/features/settings/settings-view.js'),'utf8');
const helper=import('data:text/javascript;base64,'+Buffer.from(helperSource).toString('base64'));
const KEY='ab'.repeat(32),OTHER='cd'.repeat(32);
function viewFunctions(source){
  const names=['_renderCollabAddressPanel','_bindCollabCopyButtons'];
  const nodes=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body;
  return names.map(name=>{const node=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,'missing '+name);return source.slice(node.start,node.end);}).join('\n');
}
const actualFunctions=viewFunctions(viewSource);
test('connection address validation and clipboard fail-closed behavior',async t=>{
  const h=await helper;
  for(const base of ['http://192.0.2.10:80','http://192.0.2.10:8080/','https://school.example:8443','http://[::1]:3000']){
    await t.test('valid endpoint '+base,()=>{const full=h.buildSharedConnectionAddress(base,KEY);assert.ok(h.isSharedConnectionAddress(full));assert.equal(new URL(full).hash,'#ot-share='+KEY);});
  }
  for(const [i,key] of [undefined,null,'','a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'g'.repeat(64),KEY+'\n',KEY+' ',123].entries()){
    await t.test('missing or malformed key '+i,()=>{assert.equal(h.buildSharedConnectionAddress('http://192.0.2.10:80',key),'');});
  }
  for(const [i,base] of ['192.0.2.10:80','javascript:alert(1)','file:///tmp','http://user:pass@192.0.2.10','http://192.0.2.10/app','http://192.0.2.10/?key=x','http://192.0.2.10/#old','http://192.0.2.10:70000',' http://192.0.2.10','http://192.0.2.10\n','http://192.0.2.10/../'].entries()){
    await t.test('reject unsafe endpoint '+i,()=>{assert.equal(h.buildSharedConnectionAddress(base,KEY),'');});
  }
  const good=h.buildSharedConnectionAddress('http://192.0.2.10:8080',KEY);
  for(const [i,address] of ['',undefined,'http://192.0.2.10:8080',good.replace(KEY,'a'.repeat(63)),good+'\n',good+'&extra=x',good.replace('#ot-share=','#other='),good.replace(KEY,KEY.toUpperCase())].entries()){
    await t.test('invalid address never reaches clipboard '+i,async()=>{let calls=0;const r=await h.copySharedConnectionAddress(address,{clipboard:{writeText:async()=>{calls++;}}});assert.equal(r.success,false);assert.equal(calls,0);});
  }
  await t.test('invitation must retain the complete address',async()=>{let calls=0;const r=await h.copySharedConnectionAddress(good,{clipboard:{writeText:async()=>{calls++;}},format:()=>new URL(good).origin});assert.equal(r.success,false);assert.equal(calls,0);});
  await t.test('unavailable clipboard is not success',async()=>{assert.equal((await h.copySharedConnectionAddress(good,{})).reason,'clipboard-unavailable');});
  await t.test('clipboard rejection exposes no raw error or key',async()=>{const r=await h.copySharedConnectionAddress(good,{clipboard:{writeText:async()=>{throw Error('private '+KEY);}}});assert.deepEqual(r,{success:false,reason:'clipboard-failed'});assert.equal(JSON.stringify(r).includes(KEY),false);});
  await t.test('copy waits for clipboard completion',async()=>{let finish,settled=false;const p=h.copySharedConnectionAddress(good,{clipboard:{writeText:()=>new Promise(resolve=>{finish=resolve;})}}).then(r=>{settled=true;return r;});await Promise.resolve();assert.equal(settled,false);finish();assert.equal((await p).success,true);});
});

test('isolated UI copy through real connection middleware', {timeout:150000}, async t=>{
  const express=require('express');
  const {chromium}=require('playwright');
  const {createSharedWebAccess}=require('../src/main/services/shared-web-access');
  const h=await helper;
  const requests=[],unexpected=[],pageErrors=[];
  let authPosts=0,base,ports,browser;
  const baseline=process.env.COLLAB_BASELINE_FUNCTIONS?fs.readFileSync(process.env.COLLAB_BASELINE_FUNCTIONS,'utf8'):null;
  const access=createSharedWebAccess({linkKey:KEY,hostToken:'ef'.repeat(32)});
  function html(legacy){
    const bootstrap='('+function(){
      window.__writes=[];window.__toasts=[];window.__clipMode='success';
      window.S={settings:{schoolName:'Test school',nurse1:'Test nurse'}};
      window.bus={emit:function(name,value){window.__toasts.push(value.text);}};
      window.escHtml=function(value){return String(value??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
      window.mockClipboard=function(){Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async function(text){
        if(window.__clipMode==='reject')throw new Error('private '+window.__fixtureKey);
        if(window.__clipMode==='delay')await new Promise(function(resolve){window.__finishCopy=resolve;});
        window.__writes.push(text);
      }}});};
      window.mockClipboard();
    }.toString()+')();';
    const start='window.__fixtureKey='+JSON.stringify(KEY)+';window.__render=function(key){_renderCollabAddressPanel('+JSON.stringify(base)+',[],'+JSON.stringify(ports)+',key);};window.__render(window.__fixtureKey);';
    const script=bootstrap+'\n'+helperSource.replace(/\bexport\s+/g,'')+'\n'+(legacy?baseline:actualFunctions)+'\n'+start;
    return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#f3f7f8;color:#243348;font-family:"Malgun Gothic",sans-serif;--card:#fff;--bg2:#f2f6f8;--bdr:#ccd8df;--bdrl:#e0e7ec;--t1:#243348;--t2:#4a6072;--t3:#657b8c;--cyan:#0e7490;--fm:monospace}.btn{border:1px solid var(--bdr);border-radius:8px;background:var(--card);color:var(--t1);padding:7px 11px;font:inherit;font-size:12px;cursor:pointer}.btn:disabled{opacity:.55;cursor:not-allowed}.btn:focus-visible,summary:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}main{max-width:850px;margin:auto;padding:18px;border:1px solid var(--bdr);border-radius:14px;background:var(--card)}</style><main class="collab-settings"><h2 style="font-size:16px">동료와 협업</h2><div id="collabAddressArea"></div><details id="collabTroubleshoot"><summary>연결이 안 되나요?</summary><div id="collabAlternateArea"></div></details></main><script>'+script+'</script></html>';
  }
  const app=express();
  app.use((req,res,next)=>{requests.push({url:req.originalUrl,referer:req.headers.referer||''});if(req.path==='/api/shared-access')authPosts++;next();});
  app.get('/fixture',(req,res)=>res.type('html').send(html(req.query.baseline==='1'&&!!baseline)));
  app.use(access.middleware);
  app.get('/',(req,res)=>res.type('html').send('<!doctype html><title>Synthetic shared app</title><main id="fixture-authorized">Synthetic connection completed</main>'));
  app.get('/api/server-info',(req,res)=>res.json({success:true,inviteKey:access.inviteKeyFor(req)}));
  const servers=[];
  for(let i=0;i<2;i++){const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});}
  ports=servers.map(s=>s.address().port);base='http://127.0.0.1:'+ports[0];
  const allowed=new Set(ports.map(p=>'http://127.0.0.1:'+p));
  const launch={headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']};
  if(process.env.COLLAB_TEST_BROWSER)launch.executablePath=process.env.COLLAB_TEST_BROWSER;
  async function context(){
    const ctx=await browser.newContext({viewport:{width:1080,height:900},serviceWorkers:'block'});
    await ctx.route('**/*',route=>{const url=new URL(route.request().url());if(allowed.has(url.origin))return route.continue();unexpected.push(url.origin);return route.abort();});
    ctx.on('page',p=>p.on('pageerror',e=>pageErrors.push(e.name)));
    return ctx;
  }
  async function reset(page,key=KEY){await page.evaluate(key=>{window.__writes=[];window.__toasts=[];window.__clipMode='success';mockClipboard();window.__render(key);document.querySelector("#collabTroubleshoot").open=false;},key);}
  async function waitToast(page){await page.waitForFunction(()=>window.__toasts.length>0,{},{timeout:5000});}
  try{
    browser=await chromium.launch(launch);
    const host=await context(),page=await host.newPage();page.setDefaultTimeout(5000);
    await page.goto(base+'/fixture');await page.waitForSelector('#collabCopyAddrBtn');
    if(baseline)await t.test('before-change handler accepted a URL with its key removed',async()=>{
      const old=await host.newPage();await old.goto(base+'/fixture?baseline=1');
      await old.locator('.collab-copy-row-btn').first().evaluate((btn,url)=>{btn.dataset.collabUrl=url;btn.click();},base);
      await old.waitForFunction(()=>window.__writes.length===1,{},{timeout:5000});
      assert.equal(await old.evaluate(()=>window.__writes[0]),base);await old.close();
    });
    await t.test('IP is reference-only and key is absent from visible UI',async()=>{
      const text=await page.locator('body').innerText();assert.equal(text.includes('메인 PC 주소 · 확인용'),false);assert.equal(await page.locator('#collabTroubleshoot').getAttribute('open'),null);assert.ok(text.includes('접속용 키 자동 포함'));assert.equal(text.includes(KEY),false);assert.equal(await page.locator('a').count(),0);assert.equal(await page.locator('#collabCopyAddrBtn').isEnabled(),true);
    });
    const buttonCount=await page.locator('button[data-collab-url]').count();assert.equal(buttonCount,4);
    for(let i=0;i<buttonCount;i++)await t.test('copy button '+i+' authenticates a fresh browser and survives reload',async()=>{
      await reset(page);await page.locator('summary').click();await page.locator('button[data-collab-url]').nth(i).click();await waitToast(page);
      const writes=await page.evaluate(()=>window.__writes);assert.equal(writes.length,1);
      const copied=writes[0].match(/https?:\/\/[^\s]+/)[0];assert.ok(h.isSharedConnectionAddress(copied));assert.equal(new URL(copied).hash,'#ot-share='+KEY);
      const toast=await page.evaluate(()=>window.__toasts[0]);assert.ok(toast.includes('접속용 키가 포함된'));assert.equal(toast.includes(KEY),false);
      const guest=await context();try{const gp=await guest.newPage();await gp.goto(copied);await gp.waitForSelector('#fixture-authorized',{timeout:5000});assert.equal(new URL(gp.url()).hash,'');await gp.reload();await gp.waitForSelector('#fixture-authorized');assert.equal(JSON.stringify(await guest.cookies()).includes(KEY),false);}finally{await guest.close();}
    });
    await t.test('every alternate selection copies the full key-bearing endpoint',async()=>{
      await reset(page);await page.locator('#collabTroubleshoot > summary').click();
      const n=await page.locator('#collabAltAddressSelect option').count();assert.equal(n,ports.length);
      for(let i=0;i<n;i++){
        await page.locator('#collabAltAddressSelect').selectOption(String(i));
        for(const selector of ['.collab-copy-row-btn','.collab-copy-invite-btn']){
          const before=await page.evaluate(()=>window.__writes.length);
          await page.locator('#collabAlternateArea '+selector).click();
          await page.waitForFunction(n=>window.__writes.length===n+1,before);
          const copied=await page.evaluate(()=>window.__writes.at(-1));const url=copied.split(/\s+/).find(word=>word.startsWith('http://'));
          assert.equal(new URL(url).port,String(ports[i]));assert.equal(new URL(url).hash,'#ot-share='+KEY);
        }
      }
      await page.locator('#collabAltAddressSelect').evaluate(select=>{select.value='invalid';select.dispatchEvent(new Event('change'));});
      assert.equal(await page.locator('#collabAlternateArea button:enabled').count(),0);
    });
    for(const [i,key] of ['',null,'a'.repeat(63),'A'.repeat(64),KEY+'\n'].entries())await t.test('all copy controls disabled for invalid key '+i,async()=>{
      await reset(page,key);assert.equal(await page.locator('button[data-collab-url]:enabled').count(),0);assert.ok((await page.locator('[data-collab-copy-status]').innerText()).includes('복사를 막았습니다'));
      await page.locator('#collabCopyAddrBtn').dispatchEvent('click');await waitToast(page);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
    });
    for(const [i,bad] of [null,base,base+'/#ot-share=short',base+'/#ot-share='+KEY+'\n'].entries())await t.test('missing or malformed per-button URL has no primary-address fallback '+i,async()=>{
      await reset(page);await page.locator('#collabCopyAddrBtn').evaluate((btn,value)=>{if(value===null)delete btn.dataset.collabUrl;else btn.dataset.collabUrl=value;},bad);
      await page.locator('#collabCopyAddrBtn').click();await waitToast(page);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);assert.ok((await page.locator('[data-collab-copy-status]').innerText()).includes('복사하지 않았습니다'));
    });
    await t.test('invitation with missing key cannot copy',async()=>{await reset(page);await page.locator('summary').click();const btn=page.locator('.collab-copy-invite-btn').first();await btn.evaluate((b,v)=>{b.dataset.collabUrl=v;},base);await btn.click();await waitToast(page);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);});
    await t.test('duplicate binding and keyboard activation produce only one copy',async()=>{await reset(page);await page.evaluate(()=>{_bindCollabCopyButtons();_bindCollabCopyButtons();});await page.locator('#collabCopyAddrBtn').focus();await page.keyboard.press('Enter');await waitToast(page);assert.equal(await page.evaluate(()=>window.__writes.length),1);});
    await t.test('clipboard rejection is visible and does not announce success or raw errors',async()=>{await reset(page);await page.evaluate(()=>{window.__clipMode='reject';});await page.locator('#collabCopyAddrBtn').click();await waitToast(page);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);const text=await page.locator('[data-collab-copy-status]').innerText();assert.ok(text.includes('복사하지 못했습니다'));assert.equal(text.includes(KEY),false);assert.equal(text.includes('private'),false);assert.equal(await page.locator('#collabCopyAddrBtn').isEnabled(),true);});
    await t.test('clipboard unavailable fails without changing clipboard',async()=>{await reset(page);await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));await page.locator('#collabCopyAddrBtn').click();await waitToast(page);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);assert.ok((await page.locator('[data-collab-copy-status]').innerText()).includes('복사하지 못했습니다'));});
    await t.test('pending clipboard write cannot announce success or duplicate writes',async()=>{
      await reset(page);await page.evaluate(()=>{window.__clipMode='delay';});await page.locator('#collabCopyAddrBtn').click();await page.waitForFunction(()=>typeof window.__finishCopy==='function');assert.equal(await page.locator('#collabCopyAddrBtn').isDisabled(),true);assert.equal(await page.evaluate(()=>window.__toasts.length),0);await page.locator('#collabCopyAddrBtn').dispatchEvent('click');await page.evaluate(()=>window.__finishCopy());await waitToast(page);assert.equal(await page.evaluate(()=>window.__writes.length),1);
    });
    await t.test('web guest cannot generate a new host invitation',async()=>{await page.evaluate(()=>{window.__isWebBrowser=true;});await reset(page,'');assert.equal(await page.locator('button:enabled').count(),0);assert.ok((await page.locator('[data-collab-copy-status]').innerText()).includes('메인 PC'));await page.evaluate(()=>{window.__isWebBrowser=false;});});
    for(const width of [1080,768,360])await t.test('layout and key secrecy at width '+width,async()=>{
      await reset(page);await page.setViewportSize({width,height:920});await page.locator('summary').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal((await page.locator('body').innerText()).includes(KEY),false);
      if(process.env.COLLAB_TEST_OUTPUT){fs.mkdirSync(process.env.COLLAB_TEST_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.COLLAB_TEST_OUTPUT,'collaboration-'+width+'.png'),fullPage:true});}
    });
    await t.test('bare URL and malformed key cannot bypass gate; manual full-address paste connects',async()=>{
      const guest=await context();try{const gp=await guest.newPage();const r=await gp.goto(base);assert.equal(r.status(),401);assert.equal(await gp.locator('#fixture-authorized').count(),0);const before=authPosts;await gp.locator('#address').fill(base);await gp.locator('#submit').click();await gp.waitForFunction(()=>document.getElementById('status').textContent.includes('주소를 확인'));assert.equal(authPosts,before);assert.equal((await guest.cookies()).length,0);await gp.locator('#address').fill(h.buildSharedConnectionAddress(base,KEY));await gp.locator('#submit').click();await gp.waitForSelector('#fixture-authorized',{timeout:5000});}finally{await guest.close();}
    });
    await t.test('well-formed but wrong key does not authenticate',async()=>{
      const guest=await context();try{const gp=await guest.newPage();await gp.goto(h.buildSharedConnectionAddress(base,OTHER));await gp.waitForFunction(()=>document.getElementById('status').textContent.includes('다시 복사'));assert.equal(await gp.locator('#fixture-authorized').count(),0);assert.equal((await guest.cookies()).length,0);}finally{await guest.close();}
    });
    await t.test('no key leaks to URLs/referrers and no external requests or script errors',()=>{assert.equal(requests.some(r=>r.url.includes(KEY)||r.referer.includes(KEY)),false);assert.deepEqual(unexpected,[]);assert.deepEqual(pageErrors,[]);});
    if(process.env.COLLAB_TEST_OUTPUT)fs.writeFileSync(path.join(process.env.COLLAB_TEST_OUTPUT,'isolation.json'),JSON.stringify({network:'loopback-only',userDataAccessed:false,applicationSettingsChanged:false,osClipboardAccessed:false,syntheticClipboard:true,authPosts,externalRequests:unexpected.length,pageErrors:pageErrors.length},null,2));
    await host.close();
  }finally{if(browser)await browser.close();for(const server of servers){server.closeAllConnections();server.close();}}
});
