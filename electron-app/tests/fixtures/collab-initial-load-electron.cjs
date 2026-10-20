(function(){
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');const {app,BrowserWindow,ipcMain,session}=require('electron');
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8'));
const express=require(path.join(cfg.root,'node_modules/express'));
const {createSharedWebAccess}=require(path.join(cfg.root,'src/main/services/shared-web-access'));
const {registerCollabHostHandlers}=require(path.join(cfg.root,'src/main/services/collab-host-query'));
app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
const report={engine:process.versions.electron,cases:[],copied:[],externalRequests:0,pageErrors:0,realDataAccessed:false,realClipboardAccessed:false};
let win,mode='good',running=true,ports=[],readyPorts=[],requests=[],servers=[],statusReject=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hardLimit=setTimeout(()=>{report.cases.push({name:'bounded fixture execution',pass:false});finish(1);},85000);
function finish(code){clearTimeout(hardLimit);for(const s of servers){s.closeAllConnections();s.close();}if(win&&!win.isDestroyed())win.destroy();fs.writeFileSync(path.join(cfg.out,'initial-load-electron.json'),JSON.stringify(report,null,2));app.exit(code);}
const js=code=>win.webContents.executeJavaScript(code,true);
async function until(code,ms=7000){const end=Date.now()+ms;while(Date.now()<end){if(await js(code))return;await delay(30);}throw Error('Expected fixture state timed out');}
async function check(name,run){try{await run();report.cases.push({name,pass:true});}catch(e){report.cases.push({name,pass:false,detail:String(e.message).replaceAll(cfg.key,'[synthetic-key]').slice(0,350)});}}
async function openScanPanel(){
 await js('(()=>{const help=document.querySelector("#collabTroubleshoot");if(!help)throw Error("Troubleshooting panel missing");if(!help.open)help.querySelector(":scope > summary").click();const scan=help.querySelector(".collab-port-details");if(!scan)throw Error("Scan details missing");if(!scan.open)scan.querySelector(":scope > summary").click();})()');
 await until('document.querySelector("#collabTroubleshoot").open && document.querySelector(".collab-port-details").open && document.querySelector("#collabPortScanArea").getBoundingClientRect().height > 0');
}
async function mount(next='good'){mode=next;running=true;readyPorts=ports.slice();statusReject=false;requests=[];await js('window.__mount()');await openScanPanel();}
async function ready(){await until('!!document.querySelector("#collabCopyAddrBtn:not(:disabled)")');await until('!!document.querySelector("#collabPortScanArea table")');}
app.whenReady().then(async()=>{
 const access=createSharedWebAccess({linkKey:cfg.key,hostToken:cfg.host,gateHtml:'synthetic gate'});const api=express();
 api.use((req,res,next)=>{requests.push({path:req.path,authorized:req.headers['x-orangetalk-host']===cfg.host});if(mode==='auth'||mode==='forbidden'){res.status(mode==='auth'?401:403).send('synthetic error '+cfg.key);return;}if(mode==='hang')return;next();});
 api.use(access.middleware);
 api.get('/api/server-info',(req,res)=>{if(mode==='bad-json'){res.type('text').send('private '+cfg.key);return;}const data={success:true,ips:mode==='no-lan'?[]:['192.0.2.10'],activePorts:ports,recommendedPort:ports[0],inviteKey:mode==='key-missing'?'':access.inviteKeyFor(req)};if(mode==='delay'){setTimeout(()=>res.json(data),300);return;}res.json(data);});
 api.get('/api/port-scan',(req,res)=>{if(mode==='scan-fail'){res.status(503).end();return;}res.json({success:true,results:ports.map(port=>({port,status:'active',external:{state:'pending'}}))});});
 for(let i=0;i<2;i++){const server=api.listen(0,'127.0.0.1');servers.push(server);await new Promise(r=>server.once('listening',r));ports.push(server.address().port);}readyPorts=ports.slice();
 win=new BrowserWindow({show:false,width:1080,height:1000,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const allowed=new URL(details.url).protocol==='file:';if(!allowed)report.externalRequests++;callback({cancel:!allowed});});
 ipcMain.handle('web-server:status',()=>{if(statusReject)throw Error('synthetic status rejection');return {success:true,running,port:readyPorts[0]||null,activePorts:readyPorts};});
 ipcMain.handle('fixture:start',()=>{running=true;return {success:true};});ipcMain.handle('fixture:stop',()=>{running=false;return {success:true};});
 registerCollabHostHandlers(ipcMain,{getWindow:()=>win,getState:()=>({running,token:cfg.host,ports:readyPorts})});
 await win.loadFile(path.join(__dirname,'fixture.html'));
 await check('first settings entry loads address through real Electron IPC',async()=>{await mount();await ready();assert.ok(requests.some(r=>r.path==='/api/server-info'));assert.ok(requests.every(r=>r.authorized));assert.equal(await js('document.body.innerText.includes('+JSON.stringify(cfg.key)+')'),false);assert.equal(await js('document.querySelector("#collabAddressArea").innerText.includes("불러오는 중")'),false);});
 await check('all four first-load copy controls retain the key',async()=>{await js('window.__writes=[];document.querySelector("#collabTroubleshoot").open=true;');const n=await js('document.querySelectorAll("button[data-collab-url]").length');assert.equal(n,4);for(let i=0;i<n;i++){await js('document.querySelectorAll("button[data-collab-url]")['+i+'].click()');await until('window.__writes.length==='+String(i+1));}report.copied=await js('window.__writes');assert.ok(report.copied.every(text=>text.includes('#ot-share='+cfg.key)));});
 await check('active port is not falsely marked as a verified colleague connection',async()=>{assert.ok((await js('document.querySelector("#collabPortScanArea").innerText')).includes('동료 접속 미확인'));});
 await check('initial-load screen desktop snapshot',async()=>{await js('window.scrollTo(0,0)');fs.writeFileSync(path.join(cfg.out,'initial-load-desktop.png'),(await win.webContents.capturePage()).toPNG());});
 for(const [scenario,code] of [['auth','host-auth-failed'],['forbidden','host-auth-failed'],['bad-json','invalid-response'],['key-missing','invite-key-missing'],['no-lan','lan-address-missing'],['hang','timeout']]){
  await check(scenario+' reaches an explicit failure with no copy button',async()=>{await mount(scenario);await until('!!document.querySelector("[data-collab-load-error='+code+']")',9000);assert.equal(await js('document.querySelectorAll("button[data-collab-url]:not(:disabled)").length'),0);assert.equal(await js('document.body.innerText.includes('+JSON.stringify(cfg.key)+')'),false);if(scenario==='auth'){fs.writeFileSync(path.join(cfg.out,'initial-load-failure.png'),(await win.webContents.capturePage()).toPNG());}});
  // Wait for the scan associated with this entry so no scenario leaks into the next case.
  await until('!document.querySelector("#collabPortScanArea").innerText.includes("확인하는 중")',23000);
 }
 await check('retry after a failed load restores address and scan',async()=>{await mount('auth');await until('!!document.querySelector("#collabAddressRetryBtn")');await until('!document.querySelector("#collabPortScanArea").innerText.includes("확인하는 중")');mode='good';await js('document.querySelector("#collabAddressRetryBtn").click()');await ready();});
 await check('server startup delay is retried without guessing another port',async()=>{mode='good';running=true;readyPorts=[];await js('window.__mount()');await openScanPanel();setTimeout(()=>{readyPorts=ports.slice();},700);await ready();});
 await check('stopped server does not leave address or scan loading',async()=>{mode='good';running=false;await js('window.__mount()');await openScanPanel();await until('document.querySelector("#collabPortScanArea").innerText.includes("꺼져")');assert.equal(await js('document.querySelectorAll("button[data-collab-url]").length'),0);});
 await check('status IPC failure ends both loading indicators',async()=>{statusReject=true;await js('window.__mount()');await openScanPanel();await until('!!document.querySelector("[data-collab-load-error=ipc-failed]")');assert.ok((await js('document.querySelector("#collabPortScanArea").innerText')).includes('시작하지 않았습니다'));statusReject=false;});
 await check('late response cannot write into a closed settings panel',async()=>{await mount('delay');await until('document.querySelector("#collabAddressArea").innerText.includes("확인하는 중")');await js('document.querySelector("main").innerHTML="<div id=another-panel>Other panel</div>"');await delay(500);assert.equal(await js('!!document.querySelector("#another-panel")'),true);assert.equal(await js('document.querySelectorAll("button[data-collab-url]").length'),0);});
 await check('reopening settings gets fresh controls after a closed request',async()=>{await mount();await ready();});
 await check('stopping while a query is pending cannot restore stale keys',async()=>{await mount('delay');await until('document.querySelector("#collabAddressArea").innerText.includes("확인하는 중")');await js('const b=document.querySelector("#webServerToggle");b.checked=false;b.dispatchEvent(new Event("change"));');await delay(600);assert.equal(await js('document.querySelectorAll("button[data-collab-url]").length'),0);assert.ok((await js('document.querySelector("#collabPortScanArea").innerText')).includes('꺼져'));});
 await check('scan failure and manual recheck use the same owned server',async()=>{await mount('scan-fail');await until('!!document.querySelector("#collabCopyAddrBtn:not(:disabled)")');await until('document.querySelector("#collabPortScanArea").innerText.includes("정상 응답")');mode='good';await js('document.querySelector("#collabPortScanBtn").click()');await ready();assert.ok(requests.some(r=>r.path==='/api/port-scan'));});
 await check('duplicate binding cannot duplicate startup or clipboard handlers',async()=>{await js('_bindWebServerToggle();_bindWebServerToggle();window.__writes=[];document.querySelector("#collabCopyAddrBtn").click()');await until('window.__writes.length===1');});
 report.pageErrors=await js('window.__errors.length');
 await check('no renderer network access and no uncaught page errors',async()=>{assert.equal(report.externalRequests,0);assert.equal(report.pageErrors,0);});
 finish(report.cases.every(c=>c.pass)?0:1);
}).catch(error=>{report.cases.push({name:'fixture infrastructure',pass:false,detail:String(error.message).replaceAll(cfg.key,'[synthetic-key]').slice(0,400)});finish(1);});
})();
