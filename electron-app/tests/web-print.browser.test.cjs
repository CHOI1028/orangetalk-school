'use strict';
// Run with Playwright available, or set WEB_PRINT_PLAYWRIGHT to its module path.
// Only synthetic documents are used; window.print is intercepted, so no printer is used.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.WEB_PRINT_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

test('shared web print lifecycle in a real browser', {timeout:60000}, async t => {
  const options={headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']};
  if(process.env.WEB_PRINT_BROWSER) options.executablePath=process.env.WEB_PRINT_BROWSER;
  const browser=await chromium.launch(options);
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    const errors=[];
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://web-print.test')return route.abort();
      return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic print test</title><button id="print">Print</button>'});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto('http://web-print.test/');
    await page.addScriptTag({path:path.join(root,'src/shared/shared-settings.js')});
    await page.addScriptTag({path:path.join(root,'web-server/web-api-bridge.js')});
    await page.evaluate(()=>{
      const realOpen=window.open.bind(window);
      window.prints=[];window.printMode='success';
      window.open=function(...args){
        if(window.printMode==='blocked')return null;
        const win=realOpen(...args);window.lastPrintWindow=win;
        const decode=win.HTMLImageElement.prototype.decode;
        win.HTMLImageElement.prototype.decode=function(){
          return decode.call(this).then(()=>new Promise(resolve=>{window.releaseImage=resolve;window.imageDecodeStarted=true;}));
        };
        win.print=function(){
          if(window.printMode==='throw')throw Error('synthetic failure');
          window.prints.push({html:win.document.documentElement.outerHTML,
            text:win.document.body.textContent,
            imageReady:Array.from(win.document.images).every(img=>img.complete&&img.naturalWidth>0),
            size:Array.from(win.document.styleSheets[0].cssRules).find(r=>r.type===CSSRule.PAGE_RULE).style.getPropertyValue('size')});
        };
        return win;
      };
      document.querySelector('#print').onclick=()=>{
        window.result=null;
        window.electronAPI.printWindowWithSize(window.fixtureHtml,'A4',{marginType:'none'}).then(r=>{window.result=r;});
      };
    });
    async function start(html,mode='success') {
      await page.evaluate(({html,mode})=>{window.fixtureHtml=html;window.printMode=mode;}, {html,mode});
      await page.click('#print');
    }
    async function result(){await page.waitForFunction(()=>window.result!==null);return page.evaluate(()=>window.result);}
    async function closePrint(){await page.evaluate(()=>window.lastPrintWindow.dispatchEvent(new window.lastPrintWindow.Event('afterprint')));await page.waitForFunction(()=>window.lastPrintWindow.closed);}
    function documentHtml(size,content){return '<!doctype html><html><head><style>@page{size:'+size+';margin:0}body{margin:0;padding:6mm 3mm 2mm 5mm}</style></head><body>'+content+'</body></html>';}

    await t.test('slow stamp decoding completes before print; receipt CSS and content survive',async()=>{
      const stamp='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="10" fill="red"/></svg>').toString('base64');
      await start(documentHtml('72mm 119mm','<p>가상 방문확인증</p><img src="'+stamp+'">'));
      await page.waitForFunction(()=>window.imageDecodeStarted===true);
      assert.equal(await page.evaluate(()=>window.prints.length),0);
      assert.equal(await page.evaluate(()=>window.result),null);
      await page.evaluate(()=>window.releaseImage());
      assert.equal((await result()).status,'dialog-requested');
      const printed=await page.evaluate(()=>window.prints[0]);
      assert.equal(printed.imageReady,true);assert.equal(printed.size,'72mm 119mm');
      assert.equal(printed.text,'가상 방문확인증');assert(!printed.html.includes('window.print'));
      await closePrint();
    });
    await t.test('A4 still prints once and closes after afterprint',async()=>{
      await start(documentHtml('A4','<p>가상 A4 문서</p>'));
      const r=await result();assert.equal(r.success,true);assert.equal(r.printed,null);
      const prints=await page.evaluate(()=>window.prints);
      assert.equal(prints.length,2);assert.equal(prints[1].size,'a4');
      assert.equal(prints[1].text,'가상 A4 문서');await closePrint();
    });
    await t.test('popup blocking is returned through the public web API',async()=>{
      await start(documentHtml('A4','blocked'),'blocked');
      const r=await result();assert.equal(r.success,false);assert.equal(r.reason,'popup-blocked');
    });
    await t.test('synchronous print failure closes the new window',async()=>{
      await start(documentHtml('A4','failure'),'throw');
      const r=await result();assert.equal(r.success,false);assert.equal(r.reason,'print-failed');
      assert.equal(await page.evaluate(()=>window.lastPrintWindow.closed),true);
    });
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
