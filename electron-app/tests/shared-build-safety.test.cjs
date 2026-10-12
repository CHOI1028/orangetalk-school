(function buildSafetyTests111(){
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),{obfuscateJs}=require('../scripts/obfuscate');
test('shared browser module does not expose obfuscator globals',()=>{
const code=fs.readFileSync(path.join(root,'src/shared/shared-settings.js'),'utf8'),ctx={};
vm.runInNewContext(obfuscateJs(code,'src/shared/shared-settings.js'),ctx);
assert.deepEqual(Object.keys(ctx),['OrangeSharedSettings']);
assert.equal(ctx.OrangeSharedSettings.isShared('kiosk_settings'),true);
assert.equal(ctx.OrangeSharedSettings.isShared('not-a-shared-setting'),false);
});
test('isolated shared module remains compatible with CommonJS',()=>{
const code=fs.readFileSync(path.join(root,'src/shared/shared-settings.js'),'utf8'),ctx={module:{exports:{}}};
vm.runInNewContext(obfuscateJs(code,'src/shared/shared-settings.js'),ctx);
const original=require('../src/shared/shared-settings');
assert.deepEqual(Object.keys(ctx.module.exports),Object.keys(original));
for(const k of original.KEYS){assert.equal(ctx.module.exports.isShared(k),true);assert.equal(ctx.module.exports.lsKey(k),original.lsKey(k));}
});
test('obfuscated bodymap functions work after standalone serialization',async()=>{
const code=fs.readFileSync(path.join(root,'src/renderer/core/bodymap-layout.js'),'utf8');
const built=obfuscateJs(code,'src/renderer/core/bodymap-layout.js');
const mod=await import('data:text/javascript;base64,'+Buffer.from(built).toString('base64'));
const ctx={BODYMAP_GUIDES:{},img:{naturalWidth:100,naturalHeight:100,getBoundingClientRect:()=>({left:10,top:20,width:200,height:100})},zone:{dataset:{bmKey:'absent'},querySelector:()=>null}};
vm.runInNewContext(mod.bodymapImageRect.toString()+'\n'+mod.drawBodymapGuides.toString()+'\n'+mod.mountBodymapLayout.toString()+'\nresult=bodymapImageRect(img);drawBodymapGuides(zone);mountBodymapLayout(null);',ctx);
assert.deepEqual(JSON.parse(JSON.stringify(ctx.result)),{left:60,top:20,width:100,height:100});
});
})();
