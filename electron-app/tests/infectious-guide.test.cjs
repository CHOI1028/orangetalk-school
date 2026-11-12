const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=path.resolve(__dirname,'../src/renderer/core');
const source=['infectious-labels.js','infectious-catalog-data.js','infectious-guide.js'].map(f=>fs.readFileSync(path.join(core,f),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\};\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const ctx=vm.createContext({});
vm.runInContext(source+'\nthis.api={searchDiseases,matchesKcd,getDiseaseGuide,diseaseNameChange,INFECTIOUS_CATALOG};',ctx);
const {searchDiseases:search,matchesKcd:matches,getDiseaseGuide:guide,diseaseNameChange:change,INFECTIOUS_CATALOG:catalog}=ctx.api;
test('official snapshot has unique entries across all four grades',()=>{
  assert.equal(catalog.length,133);assert.equal(new Set(catalog.map(d=>d.name)).size,133);
  assert.deepEqual([1,2,3,4].map(g=>catalog.filter(d=>d.grade===g).length),[18,22,32,61]);
});
test('aliases, spaces, lowercase and dotless KCD find the same disease',()=>{
  for(const q of ['@니파바이러스감염증','＠니파바이러스감염증',' @ @니파바이러스감염증'])assert.equal(search(q)[0].name,'니파바이러스감염증');
  for(const q of ['독감','A형 독감','flu'])assert.equal(search(q)[0].name,'인플루엔자');
  for(const q of ['B01.9','b019','Ｂ０１．９'])assert.equal(search(q)[0].name,'수두');
  assert.equal(search('RSV')[0].name,'호흡기세포융합바이러스 감염증');
  assert.equal(search('COVID-19')[0].name,'코로나바이러스감염증-19');
});
test('code ranges respect boundaries and do not confuse prefix categories',()=>{
  assert(matches('A00.0~A00.9','A00.5'));assert(!matches('A00.0~A00.9','A01'));
  assert(matches('J10.0~J11.8','J11.8'));assert(!matches('J10.0~J11.8','J11.9'));
  assert(matches('B37~37.9','B37.4'));assert(matches('B01.0~B01.9','B01'));
  assert(!matches('B01.0~B01.9','B1'));assert(!matches('B01.0~B01.9','B01000x'));
});
test('shared and combination codes return candidates instead of picking a diagnosis',()=>{
  assert(search('J02.8').length>3);assert(search('U83.7').length>1);
  assert.equal(search('수두',4).length,0);assert.equal(search('unknown diagnosis').length,0);
});
test('reviewed common diseases have official guidance; unknown durations remain unknown',()=>{
  for(const name of ['수두','백일해','유행성이하선염','홍역','성홍열','인플루엔자','수족구병','노로바이러스 감염증']){
    const d=catalog.find(d=>d.name===name);assert(d,name);const g=guide(d);
    assert(!g.unavailable,name);assert(new URL(g.source).hostname.endsWith('kdca.go.kr'));
  }
  assert(guide(catalog.find(d=>d.name==='탄저')).unavailable);
});
test('blank values can be filled; nonempty differing values require explicit consent',()=>{
  assert.equal(change('','','수두').value,'수두');
  assert(change('독감','독감','인플루엔자').error);
  assert.equal(change('독감','독감','인플루엔자',true).value,'인플루엔자');
  assert.equal(change('수두','수두','수두').changed,false);
});
test('stale previews, detached records and uncatalogued values cannot be applied',()=>{
  assert(change('현재 수정','이전 입력','수두',true).error);
  assert(change(null,'','수두',true).error);
  assert(change('','','invented',true).error);
});
