'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const express=require('express');
const {createSharedWebAccess,attachHostAuthorization,loadLinkKey}=require('../src/main/services/shared-web-access');
const KEY='a'.repeat(64),HOST='b'.repeat(64);
test('shared access protects HTTP routes and preserves trusted connections',async t=>{
 let clock=Date.now(),writes=0;
 const access=createSharedWebAccess({linkKey:KEY,hostToken:HOST,now:()=>clock});
 const app=express();app.use(access.middleware);app.use(express.json());
 app.get('/',(req,res)=>res.send('authorized application'));
 app.get('/api/server-info',(req,res)=>res.json({success:true,inviteKey:access.inviteKeyFor(req),sid:req.headers['x-session-id']}));
 app.get('/api/events',(req,res)=>res.json({sid:req.headers['x-session-id']}));
 app.post('/api/records',(req,res)=>{writes++;res.json({success:true});});
 app.all('/api/port-add',(req,res)=>res.json({success:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(route,options={})=>fetch(base+route,options);
 const post=(route,body,headers={})=>call(route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 let cookie,secondCookie;
 await t.test('bare address shows only the connection gate',async()=>{const r=await call('/');assert.equal(r.status,401);assert.match(await r.text(),/보안 연결 주소/);assert.equal(r.headers.get('cache-control'),'no-store');});
 for(const route of ['/api/server-info','/api/events','/api/download?path=private','/src/main/services/infra-config-service.js','/web-server/server.js'])await t.test('unauthenticated request blocked: '+route,async()=>{const r=await call(route);assert.equal(r.status,401);assert.doesNotMatch(await r.text(),new RegExp(KEY));});
 await t.test('session ID alone cannot write',async()=>{assert.equal((await post('/api/records',{value:1},{'X-Session-Id':'known-id'})).status,401);assert.equal(writes,0);});
 await t.test('wrong connection key cannot create a session',async()=>{const r=await post('/api/shared-access',{key:'c'.repeat(64)});assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);});
 await t.test('correct key issues a persistent HttpOnly same-site cookie',async()=>{const r=await post('/api/shared-access',{key:KEY});assert.equal(r.status,200);const raw=r.headers.get('set-cookie');assert.match(raw,/HttpOnly/);assert.match(raw,/SameSite=Lax/);assert.match(raw,/Max-Age=2592000/);cookie=raw.split(';')[0];assert.doesNotMatch(cookie,new RegExp(KEY));});
 await t.test('browser reload remains authorized without a fragment',async()=>{const r=await call('/',{headers:{Cookie:cookie}});assert.equal(await r.text(),'authorized application');});
 await t.test('authenticated browser can save a record',async()=>{assert.equal((await post('/api/records',{value:1},{Cookie:cookie})).status,200);assert.equal(writes,1);});
 await t.test('browser does not receive the invitation secret',async()=>{const r=await call('/api/server-info',{headers:{Cookie:cookie}});const data=await r.json();assert.equal(data.inviteKey,'');assert.match(data.sid,/^web_[a-f0-9]{64}$/);});
 await t.test('host IPC-derived header can retrieve the invitation',async()=>{const r=await call('/api/server-info',{headers:{'X-Orangetalk-Host':HOST,Origin:'null'}});assert.equal(r.status,200);assert.equal((await r.json()).inviteKey,KEY);});
 await t.test('forged host token is rejected',async()=>{assert.equal((await call('/api/server-info',{headers:{'X-Orangetalk-Host':'c'.repeat(64)}})).status,401);});
 await t.test('external Origin cannot read or write even with a cookie',async()=>{const r=await post('/api/records',{}, {Cookie:cookie,Origin:'https://attacker.invalid'});assert.equal(r.status,403);assert.equal(writes,1);assert.equal(r.headers.get('access-control-allow-origin'),null);});
 await t.test('opaque Origin cannot borrow a browser cookie',async()=>{assert.equal((await call('/api/server-info',{headers:{Cookie:cookie,Origin:'null'}})).status,403);});
 await t.test('same-host alternate ports retain credentialed CORS',async()=>{const origin='http://127.0.0.1:49123';const r=await call('/api/server-info',{headers:{Cookie:cookie,Origin:origin}});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('access-control-allow-credentials'),'true');});
 await t.test('preflight grants no data or session',async()=>{const r=await call('/api/records',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:49123'}});assert.equal(r.status,204);assert.equal(r.headers.get('set-cookie'),null);});
 await t.test('server management remains host-only',async()=>{assert.equal((await post('/api/port-add',{port:1},{Cookie:cookie})).status,403);assert.equal((await post('/api/port-add',{port:1},{'X-Orangetalk-Host':HOST})).status,200);});
 await t.test('different browsers cannot impersonate the same session ID',async()=>{const r=await post('/api/shared-access',{key:KEY});secondCookie=r.headers.get('set-cookie').split(';')[0];const a=await(await call('/api/server-info',{headers:{Cookie:cookie,'X-Session-Id':'same'}})).json();const b=await(await call('/api/server-info',{headers:{Cookie:secondCookie,'X-Session-Id':'same'}})).json();assert.notEqual(a.sid,b.sid);});
 await t.test('SSE and IPC resolve to the same per-tab identity',async()=>{const a=await(await call('/api/server-info',{headers:{Cookie:cookie,'X-Session-Id':'tab1'}})).json();const b=await(await call('/api/events?sid=tab1',{headers:{Cookie:cookie}})).json();assert.equal(a.sid,b.sid);});
 await t.test('prototype-like session identifiers are mapped safely',async()=>{const r=await call('/api/server-info',{headers:{Cookie:cookie,'X-Session-Id':'__proto__'}});assert.match((await r.json()).sid,/^web_[a-f0-9]{64}$/);assert.equal({}.userId,undefined);});
 await t.test('modified session signatures are rejected',async()=>{const forged=cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0');assert.equal((await call('/api/server-info',{headers:{Cookie:forged}})).status,401);});
 await t.test('expired session is rejected without changing records',async()=>{clock+=31*24*60*60*1000;const r=await post('/api/records',{},{Cookie:cookie});assert.equal(r.status,401);assert.equal((await r.json()).authRequired,true);assert.equal(writes,1);});
});
test('invitation keys persist only in the selected isolated data directory',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orangetalk-111-access-'));
 try{const a=loadLinkKey(dir),b=loadLinkKey(dir);assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,b);assert.deepEqual(fs.readdirSync(dir),['.shared-web-access.json']);}
 finally{fs.unlinkSync(path.join(dir,'.shared-web-access.json'));fs.rmdirSync(dir);}
});
test('host headers are restricted to the owned local server and application window',()=>{
 const state={token:HOST,ports:new Set([49123]),webContentsId:7,pageUrl:'file:///app/health_diary.html'};
 const make=()=>({url:'http://localhost:49123/api/data-version',webContentsId:7,frame:{url:'file:///app/health_diary.html'},requestHeaders:{}});
 const good=make();attachHostAuthorization(good,state);assert.equal(good.requestHeaders['X-Orangetalk-Host'],HOST);
 for(const change of [{url:'http://attacker.invalid:49123/api/data-version'},{url:'http://localhost:49124/api/data-version'},{url:'http://localhost:49123/assets/logo.png'},{webContentsId:8},{frame:{url:'https://attacker.invalid/'}}]){const d={...make(),...change};attachHostAuthorization(d,state);assert.deepEqual(d.requestHeaders,{});}
});
