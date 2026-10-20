(function(){
'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=path.resolve(__dirname,'..');const {createCollabHostQuery,isTrustedCollabSender}=require('../src/main/services/collab-host-query');
const KEY='ac'.repeat(32),HOST='bd'.repeat(32);
const controlSource=fs.readFileSync(path.join(root,'src/renderer/features/settings/collab-control-query.js'),'utf8');
const control=import('data:text/javascript;base64,'+Buffer.from(controlSource).toString('base64'));
const good=ports=>({success:true,ips:['192.0.2.10'],activePorts:ports,recommendedPort:ports[0],inviteKey:KEY,dbPath:'private-must-not-leave-main'});
test('owned-server query, authorization, deadlines and safe results',async t=>{
 let mode='good',received=[],state,release;
 const server=http.createServer((req,res)=>{received.push({path:req.url,host:req.headers['x-orangetalk-host']===HOST});
  if(mode==='hang')return;
  if(mode==='delay'){release=()=>res.end(JSON.stringify(good([server.address().port])));return;}
  if(mode==='auth'){res.writeHead(403);res.end(KEY);return;}
  if(mode==='redirect'){res.writeHead(302,{Location:'https://never-request.invalid/?key='+KEY});res.end();return;}
  if(mode==='large'){res.end('x'.repeat(66000));return;}
  if(mode==='bad-json'){res.end('private '+KEY);return;}
  let data=good([server.address().port]);
  if(mode==='key-missing')delete data.inviteKey;
  if(mode==='no-lan')data.ips=['127.0.0.1'];
  if(mode==='scan')data={success:true,results:[{port:server.address().port,status:'active',external:{state:'pending'},secret:KEY}]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
 });server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const port=server.address().port;
 t.after(()=>{server.closeAllConnections();server.close();});
 const reset=()=>{state={running:true,token:HOST,ports:[port]};mode='good';received=[];return createCollabHostQuery({getState:()=>state,infoTimeoutMs:150,scanTimeoutMs:150});};
 let query=reset();
 await t.test('only owned dynamic port is queried and db path is omitted',async()=>{const r=await query('info');assert.equal(r.success,true);assert.equal(r.inviteKey,KEY);assert.equal('dbPath' in r,false);assert.deepEqual(received,[{path:'/api/server-info',host:true}]);});
 for(const [m,code] of [['auth','host-auth-failed'],['redirect','http-error'],['large','invalid-response'],['bad-json','invalid-response'],['key-missing','invite-key-missing'],['no-lan','lan-address-missing'],['hang','timeout']])await t.test(m+' produces a safe terminal failure',async()=>{query=reset();mode=m;const r=await query('info');assert.equal(r.code,code);assert.equal(JSON.stringify(r).includes(KEY),false);});
 for(const [name,patch,code] of [['off',{running:false},'server-stopped'],['starting',{ports:[]},'server-starting'],['missing host token',{token:''},'host-auth-unavailable']])await t.test(name+' sends no network request',async()=>{query=reset();Object.assign(state,patch);assert.equal((await query('info')).code,code);assert.equal(received.length,0);});
 await t.test('arbitrary query cannot access any endpoint',async()=>{query=reset();assert.equal((await query('https://never-request.invalid')).code,'invalid-request');assert.equal(received.length,0);});
 await t.test('concurrent readers share one owned request',async()=>{query=reset();const results=await Promise.all([query('info'),query('info')]);assert.ok(results.every(r=>r.success));assert.equal(received.length,1);});
 await t.test('server replacement rejects the old response',async()=>{query=reset();mode='delay';const p=query('info');const end=Date.now()+1000;while(!release&&Date.now()<end)await new Promise(r=>setTimeout(r,2));assert.ok(release);state={...state,token:'ef'.repeat(32)};release();assert.equal((await p).code,'server-changed');});
 await t.test('scan retains only the display fields',async()=>{query=reset();mode='scan';const r=await query('scan');assert.equal(r.success,true);assert.equal(r.results[0].external.state,'pending');assert.equal(JSON.stringify(r).includes(KEY),false);});
 await t.test('failed first owned port may use a second owned port',async()=>{let calls=[];const q=createCollabHostQuery({getState:()=>({running:true,token:HOST,ports:[41001,41002]}),request:async(p)=>{calls.push(p);return p===41001?{success:false,code:'connection-refused'}:{success:true,data:good([41002])};}});assert.equal((await q('info')).success,true);assert.deepEqual(calls,[41001,41002]);});
 await t.test('renderer sender must be the exact file main frame',()=>{const frame={url:'file:///fixture/app.html'},wc={isDestroyed:()=>false,getURL:()=>frame.url,mainFrame:frame};const win={isDestroyed:()=>false,webContents:wc};assert.equal(isTrustedCollabSender({sender:wc,senderFrame:frame},win),true);assert.equal(isTrustedCollabSender({sender:{},senderFrame:frame},win),false);assert.equal(isTrustedCollabSender({sender:wc,senderFrame:{...frame}},win),false);frame.url='https://never-request.invalid';assert.equal(isTrustedCollabSender({sender:wc,senderFrame:frame},win),false);});
});
test('renderer control-query failures are bounded and secret-free',async t=>{
 const c=await control;
 await t.test('missing preload API requires restart without HTTP fallback',async()=>{let calls=0;const r=await c.readCollabControl('info',{api:{},fetchImpl:()=>{calls++;}});assert.equal(r.code,'runtime-restart');assert.equal(calls,0);});
 await t.test('IPC rejection never displays its raw key-bearing message',async()=>{const r=await c.readCollabControl('info',{api:{webServerConnectionInfo:async()=>{throw Error(KEY);}}});assert.equal(r.code,'ipc-failed');assert.equal(JSON.stringify(r).includes(KEY),false);assert.equal(c.collabControlMessage(KEY).includes(KEY),false);});
 await t.test('hanging IPC has a finite deadline',async()=>{const r=await c.readCollabControl('info',{api:{webServerConnectionInfo:()=>new Promise(()=>{})},timeoutMs:25});assert.equal(r.code,'timeout');});
 await t.test('malformed IPC payload is rejected',async()=>{assert.equal((await c.readCollabControl('info',{api:{webServerConnectionInfo:async()=>null}})).code,'invalid-response');});
 await t.test('web guest only uses its own origin',async()=>{let urls=[];const r=await c.readCollabControl('info',{isWeb:true,fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>({success:true,inviteKey:''})};}});assert.equal(r.inviteKey,'');assert.deepEqual(urls,['/api/server-info']);assert.equal((await c.readCollabControl('scan',{isWeb:true})).code,'host-only');});
 await t.test('web fetch is aborted on timeout',async()=>{let signal;const r=await c.readCollabControl('info',{isWeb:true,timeoutMs:25,fetchImpl:(_,opts)=>{signal=opts.signal;return new Promise(()=>{});}});assert.equal(r.code,'timeout');assert.equal(signal.aborted,true);});
});
test('first settings entry through real Electron IPC to full address copy and browser access',{timeout:180000},async t=>{
 const {spawn}=require('node:child_process');const acorn=require('acorn');const {chromium}=require('playwright');
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'orangetalk-collab-load-'));
 const out=process.env.COLLAB_LOAD_OUTPUT||work;fs.mkdirSync(out,{recursive:true});
 const view=fs.readFileSync(path.join(root,'src/renderer/features/settings/settings-view.js'),'utf8');
 const names=['_renderDatasyncTabInline','_bindWebServerToggle','_renderCollabAddressPanel','_loadCollabAddress','_showCollabLoadFailure','_bindCollabCopyButtons','_loadCollabPortScan','_loadCollabSessions'];
 const nodes=acorn.parse(view,{ecmaVersion:'latest',sourceType:'module'}).body;
 const funcs=names.map(name=>{const n=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n,name);return view.slice(n.start,n.end);}).join('\n');
 const helper=fs.readFileSync(path.join(root,'src/renderer/features/settings/collab-connection-address.js'),'utf8');
 const boot=String.raw`window.S={settings:{schoolName:'Synthetic school'},_collabPeers:[]};window.bus={emit:(n,v)=>window.__toasts.push(v.text)};window.__toasts=[];window.__writes=[];window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.error&&e.error.name||'error'));window.addEventListener('unhandledrejection',()=>window.__errors.push('unhandledrejection'));
window.escHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__writes.push(text);}},configurable:true});
window.__mount=()=>{document.querySelector('main').innerHTML=_renderDatasyncTabInline();};`;
 const style='*{box-sizing:border-box}body{margin:0;padding:20px;background:#f4f7f8;color:#243348;font:13px "Malgun Gothic",sans-serif;--bg2:#f1f5f7;--bdr:#ccd8df;--bdrl:#e0e7ec;--t1:#243348;--t2:#4a6072;--t3:#657b8c;--cyan:#0e7490;--fm:monospace;--gs:#188650;--yl:#a06912;--rs:#bd4545}.cc{background:#fff;border:1px solid var(--bdr);border-radius:14px}.btn{background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:7px 11px;color:inherit;cursor:pointer}.btn:disabled{opacity:.5}.settings-panel-title{font-size:18px;font-weight:700;margin-bottom:10px}.settings-panel-desc{margin-bottom:16px}main{max-width:900px;margin:auto}';
 fs.writeFileSync(path.join(work,'fixture.html'),'<!doctype html><meta charset="utf-8"><style>'+style+'</style><main></main><script>'+boot+'\n'+helper.replace(/\bexport\s+/g,'')+'\n'+controlSource.replace(/\bexport\s+/g,'')+'\n'+funcs+'</script>');
 const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
 const entries=['webServerStatus','webServerConnectionInfo','webServerPortScan'].map(name=>{const match=preload.match(new RegExp('  '+name+':[^\\r\\n]+'));assert.ok(match,name);return match[0];}).join('\n');
 fs.writeFileSync(path.join(work,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{\n"+entries+"\nwebServerStart:()=>ipcRenderer.invoke('fixture:start'),webServerStop:()=>ipcRenderer.invoke('fixture:stop')});");
 fs.writeFileSync(path.join(work,'config.json'),JSON.stringify({root,out,key:KEY,host:HOST}));
 fs.copyFileSync(path.join(__dirname,'fixtures/collab-initial-load-electron.cjs'),path.join(work,'run.cjs'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[path.join(work,'run.cjs')],{cwd:work,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',()=>{});child.stdout.on('data',()=>{});
 const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Isolated Electron timed out'));},100000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
 const report=JSON.parse(fs.readFileSync(path.join(out,'initial-load-electron.json'),'utf8'));
 for(const item of report.cases)await t.test(item.name,()=>assert.equal(item.pass,true,item.detail||item.name));
 assert.equal(exit,0,'isolated Electron exit');assert.equal(report.externalRequests,0);assert.equal(report.pageErrors,0);
 let browser;const requests=[];const express=require('express');const {createSharedWebAccess}=require('../src/main/services/shared-web-access');
 const access=createSharedWebAccess({linkKey:KEY,hostToken:HOST});const api=express();api.use((req,res,next)=>{requests.push(req.url);next();});api.use(access.middleware);api.get('/',(req,res)=>res.type('html').send('<main id="authorized">Synthetic shared application</main>'));
 const server=api.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.COLLAB_TEST_BROWSER,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
  const copied=report.copied;assert.equal(copied.length,4);
  for(let i=0;i<copied.length;i++)await t.test('initial-load copy '+i+' authenticates and survives reload',async()=>{
   const url=copied[i].match(/https?:\/\/[^\s]+/)[0];assert.equal(new URL(url).hash,'#ot-share='+KEY);
   const ctx=await browser.newContext({serviceWorkers:'block'});
   await ctx.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.hostname!=='192.0.2.10'){await route.abort();return;}
    const headers={...r.headers(),host:u.host};delete headers['content-length'];
    const response=await ctx.request.fetch('http://127.0.0.1:'+server.address().port+u.pathname+u.search,{method:r.method(),headers,data:r.postDataBuffer()||undefined,maxRedirects:0});
    await route.fulfill({response});
   });
   try{const page=await ctx.newPage();await page.goto(url);await page.waitForSelector('#authorized',{timeout:5000});assert.equal(new URL(page.url()).hash,'');await page.reload();await page.waitForSelector('#authorized',{timeout:5000});}finally{await ctx.close();}
  });
  await t.test('key never appears in HTTP request URLs',()=>assert.equal(requests.some(url=>url.includes(KEY)),false));
 }finally{if(browser)await browser.close();server.closeAllConnections();server.close();}
});
})();
