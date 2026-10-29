'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs'),JSZip=require('jszip');
const {createLegacyPrintLayout,wrapSegments,MAX_ROW_HEIGHT}=require('../src/main/legacy-excel-print.cjs');
const lines=(prefix,n)=>Array.from({length:n},(_,i)=>`${prefix}${String(i+1).padStart(4,'0')} 가상 기록`).join('\n');

function fixture({landscape=true,widths=[8,20,30],count=1,text=lines('처치',1),memo=false}={}){
 const wb=new ExcelJS.Workbook(),layout=createLegacyPrintLayout();
 const ws=wb.addWorksheet('가상 검사',{pageSetup:{paperSize:9,orientation:landscape?'landscape':'portrait',margins:{left:.4,right:.4,top:.4,bottom:.4}}});
 ws.columns=widths.map(width=>({width}));
 function row(values,{bold=false,height=20,merged=false}={}){
  const r=ws.addRow(values);r.height=height;
  if(merged)ws.mergeCells(r.number,1,r.number,widths.length);
  r.eachCell(c=>{if(!c.isMerged||c.master.address===c.address){c.font={name:'맑은 고딕',size:10,bold};c.alignment={wrapText:true,vertical:'top'};c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};}});
  return r;
 }
 row(['2026-10-29 가상 기록'],{merged:true,bold:true});
 row(['순','이름','처치 내용'],{bold:true});
 for(let n=1;n<=count;n++)row([n,'가상 대상 '+n,typeof text==='function'?text(n):text]);
 layout.table(ws,{start:1,headerEnd:2,end:ws.rowCount,sequenceColumn:1});
 if(memo){const t=row(['오늘의 메모'],{merged:true,bold:true});row([lines('메모',40)],{merged:true,height:52});layout.table(ws,{start:t.number,headerEnd:t.number,end:ws.rowCount,context:[1]});}
 return {wb,ws,layout,row};
}

async function verify(f){
 const original=[];
 f.ws.eachRow({includeEmpty:true},r=>{const cells=[];r.eachCell(c=>{if(!c.isMerged||c.master.address===c.address)cells.push({col:c.col,text:c.text,value:c.value,font:structuredClone(c.font)});});original.push(cells);});
 const [report]=f.layout.finish(f.wb),bytes=await f.layout.writeBuffer(f.wb);
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.worksheets[0];
 assert.equal(sheet.rowCount,report.outputRows,'No original rows left behind or appended twice');
 for(let ri=0;ri<original.length;ri++)for(let ci=0;ci<original[ri].length;ci++){
  const cell=original[ri][ci];
  const pieces=report.mapping.map((m,i)=>({m,i})).filter(({m})=>!m.repeat&&m.source===ri+1&&!m.generated.includes(ci));
  // XML parsers normalize literal CRLF to LF; require the same line boundaries.
  assert.equal(pieces.map(({i})=>sheet.getRow(i+1).getCell(cell.col).text).join('').replace(/\r\n?/g,'\n'),cell.text.replace(/\r\n?/g,'\n'),`source row ${ri+1}, col ${cell.col}`);
  for(const {i} of pieces)assert.equal(sheet.getRow(i+1).getCell(cell.col).font?.size,cell.font?.size);
 }
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 const breaks=Array.from(xml.matchAll(/<brk id="(\d+)" max="(\d+)" man="1"/g),m=>({id:+m[1],max:+m[2]}));
 assert.deepEqual(breaks.map(b=>b.id),report.pages.slice(0,-1).map(p=>p.rows.at(-1)));
 assert(breaks.every(b=>b.max===16383));assert.match(xml,/<pageSetup[^>]*fitToWidth="1"/);assert(!/<pageSetup[^>]*scale="/.test(xml));assert(!/fitToHeight="1"/.test(xml));
 let all=[];
 for(const page of report.pages){
  assert(page.rows.length);all.push(...page.rows);
  const actual=page.rows.reduce((n,r)=>n+sheet.getRow(r).height,0);
  assert(actual<=report.pageHeight+.01);
  assert(page.rows.every(r=>sheet.getRow(r).height>0&&sheet.getRow(r).height<=MAX_ROW_HEIGHT));
  assert(page.rows.some(r=>!report.mapping[r-1].repeat),'No header-only page');
  const first=report.mapping[page.rows[0]-1];
  if(first.page>1)assert.equal(first.source,1,'Date/title repeated on continuation pages');
 }
 assert.deepEqual(all,Array.from({length:sheet.rowCount},(_,i)=>i+1));
 return {report,sheet,xml};
}

for(const text of ['가나다라마바사'.repeat(80),'A very long medicine name 0.5 tablet '.repeat(60),'  가상\r\n\r\n기록\t처치  \n','e\u0301👨‍👩‍👧‍👦🙂가나다'.repeat(40)]){
 test('wrapping preserves original Unicode/whitespace: '+text.slice(0,10),()=>{
  const parts=wrapSegments(text,90,10);assert(parts.length>1);assert.equal(parts.join(''),text);
  assert(parts.every(p=>!/^\p{M}/u.test(p)),'Do not detach combining marks');
 });
}
for(const landscape of [true,false])for(const count of [1,28,120])test(`row bounds and exact serialized content: ${landscape}/${count} lines`,async()=>{
 const f=fixture({landscape,text:lines('경과',count)});const {report}=await verify(f);
 assert.equal(report.mapping.filter(m=>m.source===3&&!m.repeat).length>1,count>1);
});
for(const width of [8,14,34,70])test('narrow/wide multiline columns: '+width,async()=>{await verify(fixture({widths:[8,20,width],text:lines('가상V/S 37.4 110/70 0.5정',35),memo:true}));});
test('80 visits keep their order across many pages',async()=>{
 const {report,sheet}=await verify(fixture({count:80,text:n=>lines('ROW'+n+'VS',3)}));
 assert(report.pages.length>2);
 const numbers=[];sheet.eachRow(r=>{if(typeof r.getCell(1).value==='number')numbers.push(r.getCell(1).value);});
 assert.deepEqual(numbers,Array.from({length:80},(_,i)=>i+1));
});
test('large multi-cell record keeps every cell, CRLF and trailing newline',async()=>{
 const f=fixture();f.ws.getRow(3).getCell(2).value=lines('이름대신 긴 가상문자',80)+'\r\n';f.ws.getRow(3).getCell(3).value=lines('처치',120)+'\n';await verify(f);
});
test('cell text over 32767 characters is split without truncation',async()=>{await verify(fixture({text:'가상투여량0.5정 '.repeat(4000)}));});
test('one short visit stays on one page',async()=>{assert.equal((await verify(fixture())).report.pages.length,1);});
test('a normal row moves intact when it fits the next page',async()=>{
 const f=fixture({count:20,text:n=>n===20?lines('마지막',5):'가상 단문'});
 const {report}=await verify(f);assert.equal(report.mapping.filter(m=>m.source===22&&!m.repeat).length,1);
});
test('a visit above the Excel row limit stays together when it fits a fresh page',async()=>{
 const f=fixture({count:4,text:n=>n===4?lines('마지막',30):'가상 단문'});
 const {report}=await verify(f);
 const fragments=report.mapping.filter(m=>m.source===6&&!m.repeat);
 assert(fragments.length>1);assert.equal(new Set(fragments.map(m=>m.page)).size,1);
 assert(fragments[0].page>report.mapping.find(m=>m.source===5&&!m.repeat).page);
});
test('headings cannot become the last lines of a page',async()=>{
 const f=fixture({count:17});const start=f.ws.rowCount+1;f.row(['추가 표'],{bold:true,merged:true});f.row(['순','이름','처치'],{bold:true});f.row([18,'가상',lines('이어지는 내용',5)]);
 f.layout.table(f.ws,{start,headerEnd:start+1,end:start+2,context:[1]});const {report}=await verify(f);
 const page=n=>report.mapping.find(m=>m.source===n&&!m.repeat).page;
 assert.equal(page(start),page(start+1));assert.equal(page(start),page(start+2));
});
test('continuation sequence appears only at a real page boundary',async()=>{
 const {report}=await verify(fixture({text:lines('초장문',160)}));
 assert(report.mapping.some(m=>m.generated.length));
 report.mapping.forEach((m,i)=>{if(m.generated.length){assert(report.pages[m.page-1].rows.filter(n=>n<i+1).every(n=>report.mapping[n-1].repeat));}});
});
test('a narrow sequence cell reserves two lines for its continuation marker',()=>{
 let checked=0;
 for(let length=30;length<90;length++){
  const f=fixture({text:lines('장문',length)}),[report]=f.layout.finish(f.wb);
  for(const row of report.mapping)if(row.generated.length){checked++;assert(row.height>=34,'Continuation marker clipped');}
 }
 assert(checked>0);
});
test('the cover fits by reducing empty space without shrinking title font',async()=>{
 const f=fixture({widths:[8,12,16]});f.ws.getRow(1).height=80;
 f.ws.getRow(2).eachCell(c=>c.value=null);f.ws.getRow(2).height=390;
 f.ws.getRow(3).eachCell(c=>c.value=null);f.ws.getRow(3).height=390;
 f.layout.cover(f.ws,3);await verify(f);
});
test('invalid column width blocks export instead of hiding characters',()=>{
 const f=fixture({widths:[.1,.1,.1]});assert.throws(()=>f.layout.finish(f.wb),/너비/);
});
test('unexpected vertical merges fail closed',()=>{
 const f=fixture();f.ws.mergeCells('A4:A5');assert.throws(()=>f.layout.finish(f.wb),/세로 병합/);
});
