/* Run with Electron, never npm start. Isolated synthetic PDF regression, no DB/network/printer.
 * ORANGETALK_TEST_ROOT: electron-app directory; ORANGETALK_A4_SOURCE: optional candidate.
 * ORANGETALK_LAYOUT_REPORT_DIR: new report/output directory. */
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=process.env.ORANGETALK_TEST_ROOT||path.resolve(__dirname,'..');
const out=process.env.ORANGETALK_LAYOUT_REPORT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'orangetalk-a4-regression-'));
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orangetalk-a4-profile-'));
app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'session'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');
const {buildFixtures}=require('./a4-audit-fixtures.cjs');
const {dailyProgram,cases}=buildFixtures(root);
const sourcePath=process.env.ORANGETALK_A4_SOURCE||path.join(root,'src/renderer/core/a4-print-dialog.js');
const core=fs.readFileSync(sourcePath,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export function /g,'function ');
const report={syntheticOnly:true,realPrinterUsed:false,electron:process.versions.electron,sourcePath,cases:[]};
let win;
async function run(){
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:|^wss?:/i.test(d.url)}));
 win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><input id="dpFrom" value="2026-10-26"><input id="dpTo" value="2026-10-28"><div id="dpPreviewArea"></div>'));
 await win.webContents.executeJavaScript(dailyProgram+core);
 const baseline=process.env.ORANGETALK_A4_BASELINE==='1';
 for(const c of cases.filter(c=>(!process.env.ORANGETALK_A4_CASE||new RegExp(process.env.ORANGETALK_A4_CASE).test(c.name))&&(!baseline||['daily-landscape-5','daily-portrait-1'].includes(c.name)))){
  try{
   const options={landscape:!!c.landscape,marginsMm:{top:c.margins??12,bottom:c.margins??12,left:c.margins===0?0:12,right:c.margins===0?0:12}};
   const data=await win.webContents.executeJavaScript(`(async()=>{
    const c=${JSON.stringify(c)},opts=${JSON.stringify(options)};let raw=c.html;
    if(c.sheets){const parts=_dpCounselSheetsParts([{html:raw}]);raw='<html><head><meta charset="utf-8"><style>'+parts.globalCss+'</style></head><body>'+parts.bodyHtml+'</body></html>';}
    if(c.kind==='daily'){
     _dpFormat=c.format||'daily';_dpDailyDataCache=c.data;window.qaMemo=c.memo||'';window.qaWidths=c.widths||{};
     dpColOrder=['seq','schoolLevel','gradeClass','num','name','gender','nurse','symptoms','treatment'];
     for(const key of Object.keys(dpColVis))delete dpColVis[key];
     for(const key of c.hidden||[])dpColVis[key]=false;
     if(c.allColumns){for(const col of ['department','date','time','bodymap','bedUsage']){dpColOrder.push(col);if(!DP_COLS.some(d=>d.col===col))DP_COLS.push({col,label:{department:'학과',date:'날짜',time:'시간',bodymap:'부위',bedUsage:'침상 이용'}[col]});}}
     const snapshot=JSON.stringify(c.data);
     if(_dpFormat==='daily')await dpShowDailyPreview({reuse:true});
     else{_dpCache={...c.data,records:c.data.filtered};await dpShowPreview();}
     raw=_dpBuildPrintDocHtml(opts.landscape);
     if(snapshot!==JSON.stringify(c.data))throw Error('Input records mutated');
    }
    const prepared=await prepareA4PrintDocument(raw,opts);
    if(c.saveApi){
     let captured;window.electronAPI={printToPDF:async html=>{captured=html;return {success:true};}};
     window.alert=msg=>{throw Error(msg);};
     await saveA4Pdf({html:raw,title:'가상 검사',cssMargins:true,marginsMm:opts.marginsMm});
     if(captured!==prepared.html)throw Error('Save API and prepared preview differ');
    }
    window.qaLast={raw,opts,prepared};
    if(c.name==='daily-landscape-5')window.qaDiary=window.qaLast;
    if(['daily-landscape-5','daily-portrait-5'].includes(c.name)){window.qaDirections=window.qaDirections||{};window.qaDirections[opts.landscape?'landscape':'portrait']=window.qaLast;}
    return {raw,html:prepared.html,pages:prepared.pages.length};
   })()`);
   fs.writeFileSync(path.join(out,c.name+'.html'),data.html);
   const render=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
   try{
    await render.loadFile(path.join(out,c.name+'.html'));
    await render.webContents.executeJavaScript('document.fonts.ready');
    const bytes=await render.webContents.printToPDF({pageSize:'A4',marginsType:1,printBackground:true,landscape:options.landscape,preferCSSPageSize:true});
    fs.writeFileSync(path.join(out,c.name+'.pdf'),bytes);
   }finally{render.destroy();}
   const visitOrder=c.kind==='daily'?c.data.filtered.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(r=>r.treatmentMemo.match(/R\d+L\d+/)?.[0]).filter(Boolean):[];
   report.cases.push({name:c.name,passed:true,pages:data.pages,pdf:c.name+'.pdf',markers:[...new Set([...c.markers,...(c.extraMarkers||[])])],visitOrder});
   console.log('PASS '+c.name+' pages='+data.pages);
  }catch(e){report.cases.push({name:c.name,passed:false,error:e.message});console.log('FAIL '+c.name+' '+e.message);}
 }
 if(baseline){report.passed=report.cases.every(c=>c.passed);report.baseline=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));win.destroy();app.exit(report.passed?0:1);return;}
 // Negative test: confirm bounds protection rejects content, not silently clips it.
 try{
  const rejected=await win.webContents.executeJavaScript(`_validateA4PrintDocument('<html><body><div class="a4pp" style="position:relative;width:400px;height:200px;overflow:hidden"><div style="height:400px">UNSAFE</div><div class="a4pf" style="position:absolute;bottom:0">1/1</div></div></body></html>',400).then(()=>false,()=>true)`);
  assert.equal(rejected,true);report.boundsGuard=true;
 }catch(e){report.boundsGuard=false;report.boundsError=e.message;}
 try{
  const rejected=await win.webContents.executeJavaScript(`_validateA4PrintDocument('<html><body><div class="a4pp" style="position:relative;width:400px;height:200px;overflow:hidden"><div data-a4-slice style="height:10px;overflow:hidden"><div style="font:20px/26px sans-serif">CLIPPED LINE</div></div><div class="a4pf" style="position:absolute;bottom:0">1/1</div></div></body></html>',400).then(()=>false,()=>true)`);
  assert.equal(rejected,true);report.slicedGlyphGuard=true;
 }catch(e){report.slicedGlyphGuard=false;report.slicedGlyphError=e.message;}
 try{
  const stopped=await win.webContents.executeJavaScript(`(async()=>{
   let calls=0,alerts=0;window.electronAPI={printToPDF:async()=>{calls++;return {success:true};}};window.alert=()=>alerts++;
   const result=await saveA4Pdf({cssMargins:true,html:'<html><body><table><tbody><tr><th style="height:5000px">OVERSIZED</th></tr></tbody></table></body></html>'});
   return result?.success===false&&calls===0&&alerts===1;
  })()`);
  assert.equal(stopped,true);report.noPartialSave=true;
 }catch(e){report.noPartialSave=false;report.noPartialSaveError=e.message;}
 // Exercise actual dialog buttons with IPC stubs; no printer or filesystem IPC.
 try{
  const result=await win.webContents.executeJavaScript(`(async()=>{
   let calls=[];window.electronAPI={printToPDF:async html=>{calls.push(['pdf',html]);return {success:true};},printWindowWithSize:async html=>{calls.push(['print',html]);return {success:true};}};
   openA4PrintDialog({...qaDiary.opts,html:qaDiary.raw,title:'가상 검사'});
   const until=async test=>{for(let i=0;i<300;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error('Dialog timeout');};
   await until(()=>document.querySelector('#a4PvCard')?.dataset.pageCount);
   for(const action of ['pdf','go']){document.querySelector('#a4PvCard [data-act='+action+']').click();await until(()=>!document.querySelector('#a4PvCard [data-act=close]').disabled);}
   document.querySelector('#a4PvCard [data-act=close]').click();
   return {actions:calls.map(x=>x[0]),same:calls.every(x=>x[1]===qaDiary.prepared.html),cleanup:document.querySelectorAll('iframe[aria-hidden=true]').length===0};
  })()`);
  assert.deepEqual(result.actions,['pdf','print']);assert(result.same&&result.cleanup);report.outputPathParity=true;
 }catch(e){report.outputPathParity=false;report.parityError=e.message;}
 try{
  const ui=await win.webContents.executeJavaScript(`(async()=>{
   const until=async test=>{for(let i=0;i<500;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI timeout');};
   const check=(ok,msg)=>{if(!ok)throw Error(msg);};
   let response={success:true},calls=[],alerts=[];window.alert=m=>alerts.push(m);
   const invoke=async(html,options)=>{calls.push({html,options});if(response==='reject')throw Error('SYNTHETIC FAILURE');return response;};
   window.electronAPI={printToPDF:invoke,printWindowWithSize:invoke};
   const origin=document.querySelector('#dpFrom');origin.focus();
   openA4PrintDialog({...qaDiary.opts,html:qaDiary.raw,buildHtml:async landscape=>{await new Promise(r=>setTimeout(r,20));return qaDirections[landscape?'landscape':'portrait'].raw;}});
   await until(()=>document.querySelector('#a4PvCard')?.dataset.pageCount);
   const card=document.querySelector('#a4PvCard'),orientation=card.querySelector('[data-role=orientation]');
   for(const value of ['portrait','landscape','portrait','landscape']){orientation.value=value;orientation.dispatchEvent(new Event('change'));await until(()=>card.dataset.orientation===value&&card.dataset.pageCount);}
   card.querySelector('[data-act=next]').click();check(card.dataset.page==='2','Next page');
   card.querySelector('[data-act=prev]').click();check(card.dataset.page==='1','Previous page');
   for(const result of [{cancelled:true},{success:false,error:'SYNTHETIC FAILURE'},'reject',{success:true}]){
    response=result;card.querySelector('[data-act=pdf]').click();await until(()=>!card.querySelector('[data-act=close]').disabled);
    check(!card.querySelector('[data-act=pdf]').disabled,'PDF retry blocked');
   }
   check(calls.length===4&&calls.every(c=>c.html===qaDirections.landscape.prepared.html),'Wrong rotated output');
   card.querySelector('[data-act=close]').click();check(document.activeElement===origin,'Focus not restored');
   for(let i=0;i<4;i++){openA4PrintDialog({...qaDiary.opts,html:qaDiary.raw});document.querySelector('#a4PvCard [data-act=close]').click();}
   await until(()=>document.querySelectorAll('iframe[aria-hidden=true]').length===0);
   check(!document.querySelector('#a4PvCard')&&!document.querySelector('#a4PvBd'),'Closed preview returned');
   calls=[];openA4PrintDialog({html:'<html><body><table><tr><th style="height:5000px">OVERSIZED</th></tr></table></body></html>'});
   await until(()=>document.querySelector('#a4PvCard .a4-stage').textContent.includes('못했습니다'));
   check(document.querySelector('#a4PvCard [data-act=pdf]').disabled&&document.querySelector('#a4PvCard [data-act=go]').disabled,'Unsafe output enabled');
   document.querySelector('#a4PvCard [data-act=close]').click();check(calls.length===0,'Unsafe IPC sent');
   return {orientation:true,navigation:true,cancelRetry:true,errorRetry:true,focusRestoration:true,closeDuringPrepare:true,failedPreviewBlocked:true};
  })()`);
  report.uiStress=ui;
 }catch(e){report.uiStress={passed:false,error:e.message};}
 report.passed=report.cases.every(c=>c.passed)&&report.boundsGuard&&report.slicedGlyphGuard&&report.outputPathParity&&report.noPartialSave&&report.uiStress.passed!==false;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,boundsGuard:report.boundsGuard,outputPathParity:report.outputPathParity,parityError:report.parityError}));
 win.destroy();app.exit(report.passed?0:1);
}
app.whenReady().then(run).catch(e=>{console.error(e.stack);app.exit(1);});
