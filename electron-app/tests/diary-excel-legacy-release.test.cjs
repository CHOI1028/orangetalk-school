'use strict';
// Synthetic data and isolated function execution only. Never start Electron,
// load the application, access a database, or invoke a real save/network API.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const acorn=require('acorn'),ExcelJS=require('exceljs'),JSZip=require('jszip');
const root=process.env.DIARY_RELEASE_APP||path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'src/renderer/features/daily/diary-print-view.js'),'utf8');
const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
const notes=fs.readFileSync(path.join(root,'src/renderer/features/shell/school-release-notes.js'),'utf8');
const pure=fs.readFileSync(path.join(root,'src/renderer/features/daily/diary-export-data.js'),'utf8');
const parse=source=>acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declarations=parse(renderer).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(Boolean);
const functions=declarations.filter(n=>n.type==='FunctionDeclaration');
const functionCode=functions.map(n=>renderer.slice(n.start,n.end)).join('\n');
const pureCode=parse(pure).body.map(n=>n.type==='ExportNamedDeclaration'?pure.slice(n.declaration.start,n.declaration.end):pure.slice(n.start,n.end)).join('\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};

function handlerFrom(source){
  let found;
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='ipcMain'&&node.callee.property.name==='handle'&&node.arguments[0]?.value==='xlsx-build-diary')found=node.arguments[1];
    for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  }
  walk(parse(source));assert(found,'Missing production Excel handler');
  // ExcelJS and the main-process callback share a realm in production. Clone
  // renderer payloads at the simulated IPC boundary instead of passing VM arrays.
  const callback=new Function('require','console','return ('+source.slice(found.start,found.end)+');')(
    name=>{assert.equal(name,'exceljs','Optional layouts and all other dependencies are blocked');return ExcelJS;},
    {error(){}}
  );
  return (event,payload)=>callback(event,clone(payload));
}
const handler=handlerFrom(main);
const baselineRoot=process.env.DIARY_RELEASE_BASELINE;
const baselineMain=baselineRoot?fs.readFileSync(path.join(baselineRoot,'main.js'),'utf8'):null;
const baselineHandler=baselineMain?handlerFrom(baselineMain):null;
function make(){
  const events={toasts:[],errors:[],saves:[],hidden:0,builds:[],pending:[]};
  const controls={dpFrom:{value:'2026-09-01'},dpTo:{value:'2027-02-28'},dpOptCover:{checked:false},dpOptTodayMemo:{checked:true},dpDailyOmitEmptyMemo:{checked:false},dpDailyStatsScope:{value:'legacy'}};
  const ctx={
    console:{log(){},warn(){}},Date,Promise,setTimeout,clearTimeout,Uint8Array,Blob,
    S:{settings:{schoolName:'SYNTHETIC SCHOOL'},records:[],students:[],staff:[],beds:[]},
    window:{_bmData:{},electronAPI:{}},
    document:{getElementById:id=>controls[id]||null,createElement(){throw Error('Unexpected layout dialog or browser download');}},
    bus:{emit:(name,data)=>events.toasts.push({name,data})},alert:value=>events.errors.push(String(value)),
    getStu:()=>null,getStuGradeCol:s=>`${s.grade||''}-${s.cls||''}`,getDailyRecord:()=>null,
    formatMedicationDisplay:value=>value,counselTreatText:r=>r.counselMemo||'',isCounselSymLabel:s=>s==='상담',
    tmEnsureLoaded:async()=>{},tmGetMemoForExport:()=>null,buildDeptStatsSections:async()=>null,
    dpColOrder:[],dpColVis:{},dpColWidthsUser:{},_dpCache:{filteredRecs:[],records:[]},_dpFormat:'daily',_dpSelectedStudentId:null
  };
  vm.createContext(ctx);vm.runInContext(pureCode+'\n'+functionCode,ctx);
  for(const name of ['DP_COLS','DP_PRINT_LABELS']){
    const d=declarations.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).find(d=>d.id.name===name);
    assert(d?.init);ctx[name]=vm.runInContext('('+renderer.slice(d.init.start,d.init.end)+')',ctx);
  }
  ctx.dpColOrder=ctx.DP_COLS.map(c=>c.col);
  ctx._dpShowExportProgress=()=>{};ctx._dpHideExportProgress=()=>{events.hidden++;};
  ctx._dpFinishExportProgress=async()=>{};ctx._dpExportRecCount=()=>1;ctx._dpSaveBaseName=()=> 'SYNTHETIC-ONLY';
  ctx._dpExportFailModal=(title,text)=>events.errors.push({title,text});
  ctx.window.electronAPI.saveBytesDialog=async(...args)=>{events.saves.push(args);return {success:true};};
  ctx.window.electronAPI.xlsxBuildDiary=p=>{
    events.builds.push(clone(p));const promise=handler(null,p);events.pending.push(promise);return promise;
  };
  return {ctx,events,controls,flush:async()=>{await Promise.all(events.pending);await settle();}};
}
function record(extra={}){
  return {id:'FAKE-001',date:'2026-09-01',timeIn:'09:00',timeOut:'09:30',personName:'SYNTHETIC STUDENT',personType:'student',studentGrade:3,studentClass:2,studentNum:1,studentLevel:'elementary',studentGender:'F',symptoms:['두통'],treatment:['보건교육','투약'],medication:'가상약A(0.5정), 가상약B(2.5ml)',treatmentMemo:'가상 경과 기록',...extra};
}
async function workbookFrom(response){
  assert(response?.success,response?.error||'Workbook build failed');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Uint8Array.from(response.bytes));return workbook;
}
function workbookText(workbook){
  const text=[];for(const sheet of workbook.worksheets)sheet.eachRow(row=>row.eachCell(cell=>{if(!cell.isMerged||cell.master.address===cell.address)text.push(cell.text);}));
  return text.join('\n');
}
async function normalizedPackage(response){
  assert(response.success,response.error);const zip=await JSZip.loadAsync(Uint8Array.from(response.bytes));const files={};
  for(const name of Object.keys(zip.files).sort())if(!zip.files[name].dir&&/^(xl\/|_rels\/|\[Content_Types\])/.test(name))files[name]=await zip.file(name).async('string');
  return files;
}
function dailyPayload(rows=[record()]){
  const {ctx}=make();
  const dates=[...new Set(rows.map(r=>r.date))].sort();
  const days=dates.map(date=>({...ctx._dpBuildDailyDayPayload(date,rows.filter(r=>r.date===date),'SYNTHETIC SCHOOL',null),date}));
  return {...days[0],mainSheetTitle:'보건일지',titleText:'일일 보건일지',schoolText:'SYNTHETIC SCHOOL',periodText:'SYNTHETIC PERIOD',continuousDays:days};
}

test('release removes the chooser and optional backend dependency',()=>{
  assert(!functions.some(node=>node.id.name==='_dpShowExcelGuide'));
  assert(!renderer.includes('dpExcelGuideOverlay'));assert(!renderer.includes('dpExcelTemplate'));
  assert(!main.includes("require('./src/main/diary-excel-layout.cjs')"));
});
test('1.1.16 keeps four release notes without a new-template claim',()=>{
  const decl=parse(notes).body.find(n=>n.type==='ExportNamedDeclaration')?.declaration;
  const all=vm.runInNewContext('('+notes.slice(decl.declarations[0].init.start,decl.declarations[0].init.end)+')');
  const release=all.find(item=>item.version==='1.1.16');assert(release);assert.equal(release.changes.length,4);
  const value=release.changes.join(' ');assert(!/공문서형|결재 문서형|양식 선택/.test(value));assert(value.includes('V/S'));assert(value.includes('처치'));assert(value.includes('조회 실패'));
});
if(baselineRoot)test('all unrelated renderer functions and prior release entries stay unchanged',()=>{
  const old=fs.readFileSync(path.join(baselineRoot,'renderer.js'),'utf8');
  const oldFns=parse(old).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(n=>n?.type==='FunctionDeclaration');
  for(const fn of oldFns){
    if(['_dpShowExcelGuide','exportDiaryExcel','_exportDailyExcel'].includes(fn.id.name))continue;
    const current=functions.find(n=>n.id.name===fn.id.name);assert(current,fn.id.name);
    assert.equal(renderer.slice(current.start,current.end),old.slice(fn.start,fn.end),fn.id.name+' was changed');
  }
  const oldNotes=fs.readFileSync(path.join(baselineRoot,'release-notes.js'),'utf8');
  const expected=oldNotes.replace('보건일지 출력 개선: V/S 수치가 출력되지 않던 오류를 수정하고, 공문서형·결재 문서형 엑셀 양식 선택 기능을 추가했습니다.','보건일지 출력 개선: V/S 수치·처치 내용의 출력 누락을 보완하고, 기간 기록 조회 실패 시 불완전한 파일이 저장되지 않도록 수정했습니다.');
  assert.equal(notes,expected);
});

for(const template of [undefined,'legacy','official','approval','unknown'])for(const daily of [false,true]){
  test(`actual IPC always uses legacy layout: ${template}/${daily}`,async()=>{
    const base=dailyPayload([record({bst:0,temp:37.4,bp:'110/70'}),record({id:'FAKE-LAST',date:'2027-02-28',personName:'LAST SYNTHETIC'})]);
    if(!daily){delete base.continuousDays;base.titleText='보건실 방문자 현황';}
    const input={...base,diaryExcelOptions:template?{template,roles:['FAKE A','FAKE B','FAKE C']}:undefined};
    const original=JSON.stringify(input);const output=await handler(null,input);const book=await workbookFrom(output);
    assert.equal(JSON.stringify(input),original);assert.equal(book.worksheets.length,1);
    const text=workbookText(book);for(const token of ['가상약A','0.5정','37.4','110/70','BST 0'])assert(text.includes(token),token);
    if(daily)assert(text.includes('LAST SYNTHETIC'));
    if(baselineHandler)assert.deepEqual(await normalizedPackage(output),await normalizedPackage(await baselineHandler(null,{...base,diaryExcelOptions:{template:'legacy'}})),'Existing worksheet XML/style/print settings changed');
  });
}
const scenarios=[
  ['flat V/S',{temp:37.4,bp:'110/70',pulse:80,resp:18,spo2:98,bst:120},['37.4','110/70','80','18','98','120']],
  ['single V/S history',{vsHistory:[{t:'09:05',temp:37.4,bp:'110/70',respiration:18,spo2:98,bst:0}]},['09:05','37.4','110/70','BST 0']],
  ['multiple V/S histories',{vsHistory:[{t:'09:30',temp:37.2,bp:'105/65'},{t:'09:00',temp:37.4,bp:'110/70',bst:0}]},['09:00','09:30','37.4','37.2','110/70','105/65','BST 0']],
  ['map-only medication',{treatment:[],medication:'',treatmentBySym:{'두통':['투약','추적 관찰']},medsBySym:{'두통':['가상약C']},medDosesBySym:{'두통':{'가상약C':'1/2정'}}},['추적 관찰','가상약C','1/2정']],
  ['branched and common treatment',{symptoms:['두통','찰과상'],treatment:['보건교육','추적 관찰'],medication:'가상약D(3방울)',treatmentBySym:{'두통':['투약'],'찰과상':['소독'],'이전 증상':['냉찜질']},medsBySym:{'두통':['가상약A']},medDosesBySym:{'두통':{'가상약A':'0.5정'}}},['보건교육','추적 관찰','소독','냉찜질','가상약A','0.5정','가상약D','3방울']]
];
for(const [name,extra,tokens]of scenarios)test('daily save without chooser preserves '+name,async()=>{
  const {ctx,events,flush}=make(),rows=[record(extra)],original=JSON.stringify(rows),settings=JSON.stringify(ctx.S.settings);
  ctx.window.electronAPI.recordsDailyByDateRange=async()=>({success:true,data:rows});
  await ctx.exportDiaryExcel();await flush();assert.equal(events.saves.length,1);assert.equal(events.errors.length,0);
  assert.equal(events.builds[0].diaryExcelOptions.template,'legacy');
  const book=await workbookFrom({success:true,bytes:events.saves[0][1]});const text=workbookText(book);
  for(const token of tokens)assert(text.includes(token),'Missing '+token);
  assert.equal(JSON.stringify(rows),original);assert.equal(JSON.stringify(ctx.S.settings),settings);
});
for(const template of ['official','approval'])test('stale daily option is ignored: '+template,async()=>{
  const {ctx,events,flush}=make();ctx.window.electronAPI.recordsDailyByDateRange=async()=>({success:true,data:[record()]});
  await ctx._exportDailyExcel({template});await flush();assert.equal(events.builds[0].diaryExcelOptions.template,'legacy');assert.equal(events.saves.length,1);
});
test('flat export bypasses chooser and merges V/S into treatment, not nurse',async()=>{
  const {ctx,controls,events,flush}=make();ctx._dpFormat='list';ctx._dpIsCounselIndividual=()=>false;
  const labels=['순','이름','처치자','증상','처치 내용'];const raw=['1','SYNTHETIC STUDENT','SYNTHETIC NURSE','두통','보건교육 / 가상약A(0.5정)'];
  ctx._dpCache.filteredRecs=[record({vsHistory:[{t:'09:05',temp:37.4,bp:'110/70',bst:0}]})];
  ctx._dpBuildExportTable=()=>({colCount:labels.length,colWidths:[40,100,100,200,300],headerLabels:labels,titleText:'보건실 방문자 현황',schoolName:'SYNTHETIC SCHOOL'});
  const table={querySelectorAll:()=>[{classList:{contains:()=>false},querySelectorAll:()=>raw.map(textContent=>({textContent}))}]};
  controls.dpPreviewArea={querySelectorAll:()=>[table],querySelector:()=>table};
  await ctx.exportDiaryExcel();await flush();assert.equal(events.saves.length,1);assert.equal(events.errors.length,0);
  const data=events.builds[0];assert.equal(data.diaryExcelOptions.template,'legacy');assert.equal(data.dataRows[0][2],'SYNTHETIC NURSE');
  for(const token of ['37.4','110/70','BST 0','0.5정'])assert(data.dataRows[0][4].includes(token),token);
});
test('individual counsel export keeps its existing dedicated route',async()=>{
  const {ctx,events}=make();ctx._dpFormat='counsel';ctx._dpIsCounselIndividual=()=>true;let calls=0;
  ctx._dpExportCounselExcel=async()=>{calls++;};await ctx.exportDiaryExcel();assert.equal(calls,1);assert.equal(events.builds.length,0);
});
for(const failure of ['reject','false','null','missingData','invalidData','missingAPI'])test('period query '+failure+' blocks partial-cache export',async()=>{
  const {ctx,events,flush}=make();ctx.S.records=[record({id:'PARTIAL-CACHE',date:'2026-10-23'})];
  ctx.window.electronAPI.recordsDailyByDateRange=async()=>{
    if(failure==='reject')throw Error('SYNTHETIC QUERY ERROR');
    return failure==='false'?{success:false,data:ctx.S.records}:failure==='null'?null:failure==='missingData'?{success:true}:{success:true,data:{}};
  };
  if(failure==='missingAPI')delete ctx.window.electronAPI.recordsDailyByDateRange;
  await ctx.exportDiaryExcel();await flush();assert.equal(events.builds.length,0);assert.equal(events.saves.length,0);assert.equal(events.errors.length,1);assert(events.hidden>0);
  assert(!events.toasts.some(value=>value.data.text.includes('저장되었습니다')));
});
test('empty period has no workbook or save dialog',async()=>{
  const {ctx,events,flush}=make();ctx.window.electronAPI.recordsDailyByDateRange=async()=>({success:true,data:[]});
  await ctx.exportDiaryExcel();await flush();assert.equal(events.builds.length,0);assert.equal(events.saves.length,0);assert.equal(events.errors.length,0);assert(events.toasts.some(value=>value.data.text.includes('기록이 없습니다')));
});
test('181-day period preserves first/last records in the saved legacy workbook',async()=>{
  const {ctx,events,flush}=make();const rows=Array.from({length:181},(_,i)=>record({id:'FAKE-'+i,date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),personName:'SYNTHETIC-'+String(i).padStart(3,'0')}));
  const before=JSON.stringify(rows);ctx.window.electronAPI.recordsDailyByDateRange=async()=>({success:true,data:rows});
  await ctx.exportDiaryExcel();await flush();assert.equal(events.saves.length,1);assert.equal(events.builds[0].continuousDays.length,181);
  const days=events.builds[0].continuousDays;assert.equal(days[0].date,'2026-09-01');assert.equal(days.at(-1).date,'2027-02-28');assert.equal(days.reduce((sum,d)=>sum+d.dataRows.length,0),181);
  const text=workbookText(await workbookFrom({success:true,bytes:events.saves[0][1]}));
  for(let i=0;i<181;i++)assert(text.includes('SYNTHETIC-'+String(i).padStart(3,'0')),'Missing record '+i);
  assert.equal(JSON.stringify(rows),before);
});
const stats={colCount:3,sections:[
  {title:'students',header:['학년','호흡기','계'],rows:[['3학년',2,2]],totalsRow:['학생 소계',2,2]},
  {title:'staff',header:['구분','호흡기','계'],rows:[['교직원',1,1]]},
  {title:'all',header:['구분','호흡기','계'],rows:[['전체',3,3]]}
]};
for(const scope of ['legacy','all','students'])for(const omit of [false,true])test('legacy summary/memo options '+scope+'/'+omit,async()=>{
  const {ctx,controls,events,flush}=make();controls.dpDailyStatsScope.value=scope;controls.dpDailyOmitEmptyMemo.checked=omit;
  ctx.buildDeptStatsSections=async()=>clone(stats);const calls=[];
  ctx.tmGetMemoForExport=(date,options)=>{calls.push({date,options});return options.omitEmpty?null:{titles:['SYNTHETIC MEMO'],cells:['']};};
  ctx.window.electronAPI.recordsDailyByDateRange=async()=>({success:true,data:[record()]});
  await ctx.exportDiaryExcel();await flush();assert.equal(events.saves.length,1);assert.equal(calls[0].options.omitEmpty,omit);
  const day=events.builds[0].continuousDays[0];assert.equal(day.preambleSections.sections.length,scope==='legacy'?3:1);assert.equal(!!day.todayMemo,!omit);
  const text=workbookText(await workbookFrom({success:true,bytes:events.saves[0][1]}));assert.equal(text.includes('SYNTHETIC MEMO'),!omit);
});
test('optional cover keeps its separate legacy worksheet',async()=>{
  const {ctx,controls,events,flush}=make();controls.dpOptCover.checked=true;ctx.buildDeptStatsSections=async()=>clone(stats);
  ctx.window.electronAPI.recordsDailyByDateRange=async()=>({success:true,data:[record()]});await ctx.exportDiaryExcel();await flush();
  const book=await workbookFrom({success:true,bytes:events.saves[0][1]});assert.equal(book.worksheets.length,2);assert.equal(book.worksheets[0].name,'진료과별 통계');
});
for(const mode of ['success','cancel','failure','reject','buildFailure'])test('save completion/cancellation/failure: '+mode,async()=>{
  const {ctx,events}=make();ctx.window.electronAPI.saveBytesDialog=async(...args)=>{
    events.saves.push(args);if(mode==='reject')throw Error('SYNTHETIC SAVE ERROR');
    return mode==='success'?{success:true}:mode==='cancel'?{success:false,canceled:true}:{success:false,error:'SYNTHETIC DISK ERROR'};
  };
  ctx._dpDeliverXlsx(mode==='buildFailure'?{success:false,error:'SYNTHETIC BUILD ERROR'}:{success:true,bytes:[1,2,3]},'SYNTHETIC.xlsx');await settle();
  assert.equal(events.saves.length,mode==='buildFailure'?0:1);assert.equal(events.toasts.length,mode==='success'?1:0);assert.equal(events.errors.length,['failure','reject','buildFailure'].includes(mode)?1:0);assert(events.hidden>0);
});
