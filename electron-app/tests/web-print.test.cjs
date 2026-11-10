'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../web-server/web-api-bridge.js'), 'utf8');
const body = acorn.parse(source, {ecmaVersion:'latest'}).body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression').expression.callee.body.body;
const helper = body.find(n => n.type === 'FunctionDeclaration' && n.id.name === '_printWebDocument');
const api = body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.property?.name === 'electronAPI').expression.right;
const method = api.properties.find(n => n.key.name === 'printWindowWithSize').value;
const production = source.slice(helper.start, helper.end) + '\nthis.printWeb = ' + source.slice(method.start, method.end) + ';';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };

function harness(options={}) {
  const listeners = new Map(), timers = new Map();
  let nextId=0, prints=0, closes=0, written;
  const win = {
    closed:false,
    document:{readyState:options.loading?'loading':'complete', body:{offsetHeight:100}, fonts:{ready:options.fonts || Promise.resolve()}, images:options.images || [],
      open(){}, close(){}, write(html){if(options.writeError)throw Error('write failed'); written=html;}},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
    focus(){}, close(){closes++;this.closed=true;},
    print(){prints++;if(options.printError)throw Error('driver detail');if(options.afterPrint)emit('afterprint');}
  };
  const emit = name => {for(const fn of [...(listeners.get(name)||[])])fn();};
  function timer(fn,ms,repeat){const id=++nextId;timers.set(id,{fn,ms,repeat});return id;}
  const context = vm.createContext({window:{open(){if(options.openError)throw Error('blocked');return options.blocked?null:win;}},
    setTimeout:(fn,ms)=>timer(fn,ms,false),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>timer(fn,ms,true),clearInterval:id=>timers.delete(id)});
  vm.runInContext(production,context);
  return {win,emit,print:context.printWeb,timers,
    fire(ms){for(const [id,t] of [...timers])if(t.ms===ms){if(!t.repeat)timers.delete(id);t.fn();}},
    get prints(){return prints;},get closes(){return closes;},get written(){return written;}};
}

test('blocked or rejected popups report failure instead of success', async () => {
  for(const options of [{blocked:true},{openError:true}]) {
    const h=harness(options), result=await h.print('<p>test</p>');
    assert.equal(result.success,false); assert.equal(result.reason,'popup-blocked');
    assert.equal(h.prints,0); assert.equal(h.timers.size,0);
  }
});

test('waits for load, fonts and image decoding, and requests print only once', async () => {
  const fonts=deferred(), image=deferred();
  const h=harness({loading:true,fonts:fonts.promise,images:[{decode:()=>image.promise}]});
  const result=h.print('<p>synthetic stamp</p>');
  await flush(); assert.equal(h.prints,0);
  h.emit('load'); h.emit('load'); await flush(); assert.equal(h.prints,0);
  fonts.resolve(); await flush(); assert.equal(h.prints,0);
  image.resolve(); const r=await result;
  assert.equal(h.prints,1); assert.equal(r.success,true);
  assert.equal(r.status,'dialog-requested'); assert.equal(r.printed,null);
  assert.equal(h.timers.size,0);
});

test('A4 and receipt HTML, margins, signatures and page dimensions are preserved verbatim', async () => {
  for(const size of ['A4','72mm 119mm','72mm 210mm','72mm 297mm']) {
    const html='<!doctype html><html><head><style>@page{size:'+size+';margin:0}body{padding:6mm 3mm 2mm 5mm}</style></head><body><p>가상 확인증</p><img id="stamp" src="data:image/png;base64,AA=="></body></html>';
    const h=harness();
    assert.equal((await h.print(html,{width:72000,height:119000},{marginType:'custom'},undefined,true,'SEWOO')).success,true);
    assert.equal(h.written,html); assert.equal(h.prints,1);
  }
});

test('already loaded documents and broken optional images still print', async () => {
  const h=harness({images:[{decode:()=>Promise.reject(Error('broken image'))},{}]});
  assert.equal((await h.print('<p>body</p>')).success,true);
  assert.equal(h.prints,1);
});

test('hung resources time out, clean up and cannot print after late completion', async () => {
  const fonts=deferred(),h=harness({fonts:fonts.promise});
  const p=h.print('<p>test</p>');h.fire(15000);
  const result=await p; assert.equal(result.reason,'prepare-timeout');assert.equal(result.success,false);
  fonts.resolve();await flush();assert.equal(h.prints,0);assert.equal(h.closes,1);assert.equal(h.timers.size,0);
});

test('closing the popup during preparation cancels without a later print', async () => {
  const fonts=deferred(),h=harness({fonts:fonts.promise});
  const p=h.print('<p>test</p>');h.win.closed=true;h.fire(250);
  const result=await p;assert.equal(result.success,false);assert.equal(result.cancelled,true);
  fonts.resolve();await flush();assert.equal(h.prints,0);assert.equal(h.timers.size,0);
});

test('document and synchronous print failures are returned and cleaned up', async () => {
  for(const [options,reason] of [[{writeError:true},'prepare-failed'],[{printError:true},'print-failed']]) {
    const h=harness(options),result=await h.print('<p>test</p>');
    assert.equal(result.success,false);assert.equal(result.reason,reason);
    assert.equal(result.error.includes('driver detail'),false);
    assert.equal(h.closes,1);assert.equal(h.timers.size,0);
  }
});

test('afterprint closes asynchronously without claiming physical output success', async () => {
  const h=harness({afterPrint:true}), result=await h.print('<p>test</p>');
  assert.equal(result.printed,null);assert.equal(h.closes,0);
  h.fire(0);assert.equal(h.closes,1);assert.equal(h.timers.size,0);
  h.emit('afterprint');h.fire(0);assert.equal(h.closes,1);
});

test('independent print requests do not share lifecycle state', async () => {
  const font=deferred(),slow=harness({fonts:font.promise}),fast=harness();
  const pending=slow.print('slow');await fast.print('fast');
  assert.equal(slow.prints,0);assert.equal(fast.prints,1);
  font.resolve();await pending;assert.equal(slow.prints,1);
});
