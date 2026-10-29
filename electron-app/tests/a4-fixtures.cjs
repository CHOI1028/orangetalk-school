// Synthetic inputs only. Extract actual print builders without booting the app.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function buildFixtures(root){
 const acorn=require(path.join(root,'node_modules/acorn'));
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const diary=read('src/renderer/features/daily/diary-print-view.js');
 const emergency=read('src/renderer/features/emergency/emergency-view.js');
 const rental=read('src/renderer/features/daily/rental-ledger-view.js');
 function functions(src,names){
  const tree=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'});
  return names.map(name=>{const n=tree.body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).find(n=>n?.type==='FunctionDeclaration'&&n.id.name===name);if(!n)throw Error(name);return src.slice(n.start,n.end);}).join('\n');
 }
 const escape=`function escHtml(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}`;
 const cssStart=diary.indexOf('const _DPX_CSS='),cssEnd=diary.indexOf('function _dpVsTsTableHtml(',cssStart);
 const dailyProgram=escape+`
 const S={settings:{schoolName:'가상 검사 학교'}};let _dpFormat='daily',_dpPrintLandscape=false,_dpDailyDataCache,_dpCache,_dpSelectedStudentId='fake';
 const _dpIsCounselIndividual=()=>false,_dpRowTitleText=()=> '보건실 방문자 현황';
 const tmEnsureLoaded=async()=>{},tmGetPrintBlock=()=>window.qaMemo||'',_dpOmitEmptyMemo=()=>true;
 const _dpDailySummary=s=>s,getStu=()=>null,_dpGradeCol=s=>'2-1',_dpIsBedUsed=()=>false;
 const formatMedicationDisplay=s=>s,counselTreatText=()=>'',isCounselSymLabel=()=>false;
 let dpColOrder=['seq','schoolLevel','gradeClass','num','name','gender','nurse','symptoms','treatment'];
 const dpColVis={},DP_PRINT_LABELS={};
 const labels=['순','학교급','학년반','번호','이름','성별','처치자','증상','처치 내용'];
 const DP_COLS=dpColOrder.map((col,i)=>({col,label:labels[i]}));
 const _dpEffW=c=>({seq:36,schoolLevel:52,gradeClass:70,num:44,name:80,gender:44,nurse:70,symptoms:230,treatment:300}[c]);
 `+read('src/renderer/features/daily/diary-export-data.js').replace(/^export /gm,'')+diary.slice(cssStart,cssEnd)+functions(diary,['_dpVsTsTableHtml','_dpPaTableHtml','dpShowDailyPreview','dpShowPreview','_dpBuildPrintDocHtml']);
 const seq=(prefix,count)=>Array.from({length:count},(_,i)=>prefix+String(i+1).padStart(4,'0'));
 function records(count,lines=1,days=1){return Array.from({length:count},(_,i)=>({id:i+1,date:'2026-10-'+String(26+i%days),timeIn:'09:00',timeOut:'09:05',personName:'가상'+String(i+1).padStart(3,'0'),studentGrade:2,studentClass:1,studentNum:i+1,studentGender:'남',nurse:'담당',symptoms:['증상'],treatment:[],treatmentMemo:seq('R'+String(i+1).padStart(3,'0')+'L',lines).map(m=>m+' 가상 처치 기록').join('\n')}));}
 function daily(name,rs,extra={}){
  const stats=Object.fromEntries([...new Set(rs.map(r=>r.date))].map(date=>[date,{sections:['학생','교직원','전체'].map(title=>({title,header:['구분','외상','호흡기','소화기','계'],rows:[['가상',0,0,rs.length,rs.length]],totalsRow:['합계',0,0,rs.length,rs.length]}))}]));
  return {name,kind:'daily',data:{from:'2026-10-26',to:'2026-10-28',filtered:rs,dayStatsMap:stats},markers:JSON.stringify(rs).match(/(?:R\d+L\d+|VS\d+|PA\d+|MED\d+|DOSE\d+|SYM\d+)/g)||[],...extra};
 }
 const cases=[];
 for(const landscape of [false,true]){
  for(const lines of [1,5,12])cases.push(daily(`daily-${landscape?'landscape':'portrait'}-${lines}`,records(24,lines),{landscape}));
  cases.push(daily(`daily-multiple-days-${landscape}`,records(60,4,3),{landscape}));
  cases.push(daily(`daily-very-long-${landscape}`,records(3,100),{landscape}));
  const both=records(3,90);both[0].symptoms=[seq('SYM',95).map(s=>s+' 가상 증상').join('\n')];
  cases.push(daily(`daily-two-long-cells-${landscape}`,both,{landscape}));
  const measured=records(12,4,2);
  measured.forEach((r,i)=>{r.vsHistory=[{t:'09:00',temp:'37.1',bp:'110/70',pulse:'80',resp:'20',spo2:'98',bst:'VS'+String(i+1).padStart(4,'0')}];r.physicalAssessment={items:['시진'],details:{시진:'PA'+String(i+1).padStart(4,'0')+' 가상 소견'}};r.medication='MED'+String(i+1).padStart(4,'0')+'(DOSE'+String(i+1).padStart(4,'0')+' 1정)';});
  cases.push(daily(`daily-vitals-medications-${landscape}`,measured,{landscape}));
  const serial=records(1,6);serial[0].vsHistory=seq('VS',45).map((m,i)=>({t:'09:'+String(i).padStart(2,'0'),bst:m}));
  cases.push(daily(`daily-many-vitals-${landscape}`,serial,{landscape}));
  cases.push(daily(`daily-memo-${landscape}`,records(30,3),{landscape,memo:'<div style="margin:18px 0 14px;white-space:pre-wrap">'+seq('MEMO',30).join('\n')+'</div>',extraMarkers:seq('MEMO',30)}));
  for(const format of ['row','student']){
   const rs=records(40,8);rs.forEach(r=>r.studentId='fake');
   cases.push(daily(`diary-${format}-${landscape}`,rs,{landscape,format}));
  }
  const unspaced=records(1);unspaced[0].treatmentMemo=seq('R001L',50).map(m=>m+'가상장문기록'.repeat(18)).join('');
  cases.push(daily(`daily-unspaced-${landscape}`,unspaced,{landscape}));
 }
 // Emergency and infectious print builders run with a synthetic person only.
 const ctx=vm.createContext({getStu:()=>({name:'가상학생',grade:2,cls:1,num:1,gender:'남'}),isKinder:()=>false,_ecHydrate:r=>structuredClone(r),_ecPrintFileName:()=> '가상 응급기록',_infPrintFileName:()=> '가상 감염기록'});
 vm.runInContext(escape+functions(emergency,['_ecPrintGradeStr','_ecBuildPrintHtml','_infBuildPrintHtml']),ctx);
 for(const long of [false,true]){
  const em=seq('EM',long?140:3),vs=seq('EV',long?30:1),inf=seq('INF',long?70:2);
  const r={studentId:'fake',accidentInfo:{datetime:'2026-10-28 09:00',location:'가상 장소',situation:'가상 사고'},consciousness:'명료',treatment:em.map(x=>x+' 가상 기록').join('\n'),vitalsList:vs.map(x=>({time:'09:00',temp:'37',bp:'110/70',pulse:'80',resp:'20',spo2:'98',bst:x})),transfer:{},authorDate:'2026-10-28',authorName:'가상작성자',notes:'EMEND'};
  cases.push({name:'emergency-'+long,kind:'html',html:ctx._ecBuildPrintHtml(r),markers:[...em,...vs,'EMEND'],margins:20,saveApi:true});
  cases.push({name:'infectious-'+long,kind:'html',html:ctx._infBuildPrintHtml({studentId:'fake',diseaseName:'가상 질환',progress:inf.map(x=>({date:'2026-10-28',status:x,notes:'가상 경과'})),additionalMemo:'INFEND'}),markers:[...inf,'INFEND'],margins:20,saveApi:true});
 }
 const {harness,record}=require(path.join(root,'tests/helpers/counsel-harness.cjs'));
 for(const long of [false,true]){
  const markers=seq('COUNSEL',long?140:3),r=record({content:markers.map(m=>m+' 가상 상담 기록').join('\n'),opinion:'COUNSELEND'});
  cases.push({name:'counsel-single-'+long,kind:'html',html:harness([r]).single().html,markers:[...markers,'COUNSELEND'],margins:20,saveApi:true});
  cases.push({name:'counsel-batch-'+long,kind:'html',html:harness([r,record({action:'SECONDCOUNSEL'},{id:102})]).batch()[0].html,markers:[...markers,'COUNSELEND','SECONDCOUNSEL'],margins:20});
 }
 const rctx=vm.createContext({getStu:()=>({name:'가상',grade:2,cls:1}),_academicYear:()=>2026,_rlRecords:[],_rlHeaders:{seq:'순',belong:'학년반',name:'이름',item:'물품',borrow:'대여',returnDue:'반납예정',done:'반납',returnAt:'반납일'},_rlBelong:()=> '2-1',_rlName:()=> '가상',_rlFmtDt:(d,t)=>(d||'')+' '+(t||''),_rlIsOverdue:()=>false,_rlClearRowSelection:()=>{}});
 vm.runInContext(escape+functions(rental,['_rlRenderA4Html','_rlFullHtml']),rctx);
 for(const count of [1,65]){
  const marks=seq('RENT',count);rctx._rlRecords=marks.map((m,i)=>({id:i+1,item:m,borrowDate:'2026-10-28',borrowTime:'09:00'}));
  cases.push({name:'rental-'+count,kind:'html',html:rctx._rlFullHtml(),markers:marks,margins:0});
 }
 return {dailyProgram,cases};
}
module.exports={buildFixtures};
