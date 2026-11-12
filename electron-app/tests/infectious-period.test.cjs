const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=path.resolve(__dirname,'../src/renderer/core');
const src=['infectious-labels.js','infectious-period-view.js'].map(f=>fs.readFileSync(path.join(core,f),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const context=vm.createContext({});vm.runInContext(src+'\nthis.api={groupPeriodRows,periodLabel};',context);
const plain=x=>JSON.parse(JSON.stringify(x)),group=(rows,type='2')=>plain(context.api.groupPeriodRows(rows,type));
test('month labels normalize full and separate fields, group duplicates and sort across years',()=>{
  const [d]=group([
    {icdNm:'@수두',year:'2026',period:'2월',val:3},
    {icdNm:'수두',year:'2025',period:'12월',val:4},
    {icdNm:'수두',period:'2026년 01월',val:2},
    {icdNm:'수두',period:'2026-01',val:1},
    {icdNm:'수두',period:'계',val:999}
  ]);
  assert.deepEqual(d.values,[{period:'2025년 12월',value:4},{period:'2026년 01월',value:3},{period:'2026년 02월',value:3}]);
  assert.equal(d.total,10);assert.deepEqual(d.peaks,['2025년 12월']);
});
test('weekly data is neither truncated to 100 nor sorted by counts',()=>{
  const rows=Array.from({length:125},(_,i)=>({icdNm:'수두',year:String(2024+Math.floor(i/52)),period:(i%52+1)+'주',val:125-i})).reverse();
  const [d]=group(rows,'3');assert.equal(d.values.length,125);
  assert.equal(d.values[0].period,'2024년 01주');assert.equal(d.values.at(-1).period,'2026년 21주');
  assert.equal(d.total,7875);
});
test('year labels and missing periods remain explicit, zeros do not become missing',()=>{
  const [d]=group([{icdNm:'홍역',year:'2026',val:0},{icdNm:'홍역',year:'2025년',val:null}],'1');
  assert.deepEqual(d.values,[{period:'2025년',value:null},{period:'2026년',value:0}]);
  assert.equal(d.missing,1);assert.equal(d.total,0);assert.deepEqual(d.peaks,[]);
});
test('absent months are not invented and missing duplicate values do not become complete sums',()=>{
  const [d]=group([{icdNm:'수두',period:'2026-01',val:4},{icdNm:'수두',period:'2026-01',val:null},{icdNm:'수두',period:'2026-03',val:5}]);
  assert.equal(d.values.length,2);assert.equal(d.values[0].value,null);assert.equal(d.total,5);assert.equal(d.missing,1);
});
