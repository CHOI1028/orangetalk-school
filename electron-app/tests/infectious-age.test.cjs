const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=path.resolve(__dirname,'../src/renderer/core');
const src=['infectious-labels.js','infectious-age-view.js'].map(f=>fs.readFileSync(path.join(core,f),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const context=vm.createContext({});vm.runInContext(src+'\nthis.group=groupAgeRows;',context);
const plain=x=>JSON.parse(JSON.stringify(x));
test('age distribution groups one disease, sorts numerically and excludes total rows',()=>{
  const rows=[['@수두','계',999],['수두','10~19세',2],['@수두','0~9세',0],['수두','100세 이상',3],['수두','10~19세',4]].map(([icdNm,ageRange,val])=>({icdNm,ageRange,val}));
  const [d]=plain(context.group(rows));
  assert.equal(d.name,'수두');assert.equal(d.total,9);assert.equal(d.max,6);
  assert.deepEqual(d.values.map(x=>x.age),['0~9세','10~19세','100세 이상']);
  assert.deepEqual(d.peaks,['10~19세']);
});
test('unknown ages retain missingness while true zeros and tied peaks remain explicit',()=>{
  const rows=[['0~9세',null],['10~19세',2],['10~19세',null],['20~29세',4],['30~39세',4],['40~49세',0]].map(([ageRange,val])=>({icdNm:'백일해',ageRange,val}));
  const [d]=plain(context.group(rows));assert.equal(d.missing,2);assert.equal(d.total,8);
  assert.deepEqual(d.peaks,['20~29세','30~39세']);assert.equal(d.values.at(-1).value,0);
});
test('under-one, unknown and all-zero groups do not produce invented peak ages',()=>{
  const [d]=plain(context.group(['미상','1세','1세 미만'].map(ageRange=>({icdNm:'홍역',ageRange,val:0}))));
  assert.deepEqual(d.values.map(x=>x.age),['1세 미만','1세','미상']);assert.equal(d.max,0);assert.deepEqual(d.peaks,[]);
});
