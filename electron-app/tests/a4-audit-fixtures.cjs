const {buildFixtures:base}=require('./a4-fixtures.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function buildFixtures(root){
 const built=base(root),copy=x=>JSON.parse(JSON.stringify(x));
 const acorn=require(path.join(root,'node_modules/acorn'));
 function fn(file,name){const source=fs.readFileSync(path.join(root,file),'utf8');const node=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(node.start,node.end);}
 const memoCtx=vm.createContext({_data:{},_settings:()=>({on:true,cols:2,titles:['업무 메모','전달 사항']}),DEFAULT_TITLES:[],_esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')});
 vm.runInContext(fn('src/renderer/features/daily/today-memo.js','tmGetPrintBlock'),memoCtx);
 built.dailyProgram+='\n'+fn('src/renderer/features/daily/diary-print-view.js','_dpCounselSheetsParts')+'\nfunction _symBuildCounselPrintHtml(r){return {html:r.html};}';
 built.dailyProgram=built.dailyProgram.replace('const _dpEffW=c=>({','const _dpEffW=c=>window.qaWidths?.[c]??({');
 for(const landscape of [false,true]){
  const seed=built.cases.find(c=>c.name===`daily-vitals-medications-${landscape}`);
  for(const format of ['daily','row','student'])for(const shape of ['wide','few']){
   const c=copy(seed);c.name=`audit-${format}-${shape}-${landscape}`;c.format=format;
   c.data.filtered.forEach(r=>r.studentId='fake');
   c.data.filtered.sort((a,b)=>a.date.localeCompare(b.date)); // Production range query returns ascending date/time.
   if(shape==='wide'){c.widths={symptoms:480,treatment:700,name:130,nurse:95};c.allColumns=true;}
   else c.hidden=['schoolLevel','gender','nurse','num'];
   built.cases.push(c);
  }
  const full=copy(built.cases.find(c=>c.name===`daily-${landscape?'landscape':'portrait'}-5`));
  full.name=`audit-full-stats-${landscape}`;
  const header=['구분','외상','호흡기','소화기','순환기','피부','두통/신경','근골격','이비인후','구강/치아','안과','비뇨/생식','정신/심리','감염','기타','상담','계'];
  for(const stat of Object.values(full.data.dayStatsMap))for(const section of stat.sections){
   section.header=header;section.rows=Array.from({length:6},(_,i)=>[`${i+1}학년`,...Array(15).fill(1),15]);section.totalsRow=['합계',...Array(15).fill(6),90];
  }
  built.cases.push(full);
  const margin=copy(seed);margin.name=`audit-margins-${landscape}`;margin.margins=25;built.cases.push(margin);
  const memo=copy(built.cases.find(c=>c.name===`daily-memo-${landscape}`));memo.name=`audit-tall-memo-${landscape}`;
  memo.extraMarkers=Array.from({length:120},(_,i)=>'MEMO'+String(i+1).padStart(4,'0'));
  memoCtx._data['2026-10-26']=[memo.extraMarkers.map(m=>m+' 긴 가상 메모').join('\n'),'추가 전달 사항'];
  memo.memo=memoCtx.tmGetPrintBlock('2026-10-26');built.cases.push(memo);
  const empty=copy(seed);empty.name=`audit-empty-row-${landscape}`;empty.format='row';empty.data.filtered=[];empty.markers=[];built.cases.push(empty);
 }
 for(const long of [false,true]){const c=copy(built.cases.find(c=>c.name===`counsel-single-${long}`));c.name=`audit-counsel-sheets-${long}`;c.sheets=true;built.cases.push(c);}
 return built;
}
module.exports={buildFixtures};
