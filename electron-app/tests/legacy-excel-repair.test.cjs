'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs'),JSZip=require('jszip');
const {createLegacyPrintLayout}=require('../src/main/legacy-excel-print.cjs');
function fixture({count=45,width=34,micro=false}={}){
 const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('가상 검사',{pageSetup:{paperSize:9,orientation:'landscape',margins:{left:.3,right:.16,top:.4,bottom:.4}}}),layout=createLegacyPrintLayout();
 ws.columns=micro?Array.from({length:49},()=>({width:1})):[{width:8},{width:20},{width}];
 const samples=Array.from({length:count},(_,i)=>`[09:${String(i).padStart(2,'0')}] 체온 37.4, 혈압 110/70, 맥박 80, 호흡 18, SpO₂ 98, BST ${100+i}\n`);
 const values=[['가상 기록'],['순','이름','처치 내용'],[1,'가상 대상',samples.join('')]];
 values.forEach((v,i)=>{
  const row=ws.addRow([]);row.height=20;
  v.forEach((value,j)=>{
   const c=row.getCell(micro?[1,8,22][j]:j+1);
   if(micro)ws.mergeCells(row.number,c.col,row.number,[7,21,49][j]);
   c.value=value;c.font={name:'맑은 고딕',size:10};c.alignment={wrapText:true,vertical:'top'};
   c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};
  });
 });
 layout.table(ws,{start:1,headerEnd:2,end:3,sequenceColumn:1});
 return {wb,ws,layout,samples,col:micro?22:3};
}
test('serialized merged table borders cover every constituent cell',async()=>{
 const f=fixture({count:2,micro:true}),[trace]=f.layout.finish(f.wb);
 const zip=await JSZip.loadAsync(await f.layout.writeBuffer(f.wb));
 const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 const styles=await zip.file('xl/styles.xml').async('string');
 const xfs=Array.from(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b([^>]*)>/g),m=>m[1]);
 const borders=Array.from(styles.match(/<borders[^>]*>([\s\S]*?)<\/borders>/)[1].matchAll(/<border\b[^>]*>[\s\S]*?<\/border>/g),m=>m[0]);
 const row=trace.mapping.findIndex(m=>m.source===3&&!m.repeat)+1;
 for(let col=22;col<=49;col++){
  const address=f.ws.getColumn(col).letter+row;
  const cell=xml.match(new RegExp('<c\\b([^>]*\\br="'+address+'"[^>]*)>'));
  assert(cell,'Missing merged cell '+address);
  const style=Number(cell[1].match(/\bs="(\d+)"/)?.[1]||0);
  const border=Number(xfs[style].match(/\bborderId="(\d+)"/)?.[1]||0);
  assert.match(borders[border],/<top style="thin"/,'Top border missing '+address);
  assert.match(borders[border],/<bottom style="thin"/,'Bottom border missing '+address);
 }
});
for(const width of [18,34,60])test('each V/S measurement stays in one physical row: '+width,()=>{
 const f=fixture({width}),[trace]=f.layout.finish(f.wb);
 const parts=trace.mapping.map((m,i)=>({m,value:f.ws.getRow(i+1).getCell(f.col).text})).filter(p=>p.m.source===3&&!p.m.repeat);
 assert.equal(parts.map(p=>p.value).join(''),f.samples.join(''));
 for(const sample of f.samples)assert.equal(parts.filter(p=>p.value.includes(sample)).length,1,'Measurement split: '+sample);
});
test('width fitting is stored without conflicting fixed percentage',async()=>{
 const f=fixture(),[trace]=f.layout.finish(f.wb);
 const zip=await JSZip.loadAsync(await f.layout.writeBuffer(f.wb)),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 assert.match(xml,/<pageSetUpPr[^>]*fitToPage="1"/);
 assert.match(xml,/<pageSetup[^>]*fitToWidth="1"/);
 assert.match(xml,/<pageSetup[^>]*fitToHeight="0"/);
 assert.doesNotMatch(xml,/<pageSetup[^>]*\bscale="/);
 assert.equal(trace.pages.length>1,true);
 const workbook=await zip.file('xl/workbook.xml').async('string');
 const printArea=workbook.match(/<definedName[^>]*name="_xlnm.Print_Area"[^>]*>([^<]*)<\/definedName>/)?.[1];
 assert(printArea,'Saved print areas absent');
 const ranges=Array.from(printArea.matchAll(/\$A\$(\d+):\$C\$(\d+)/g),m=>[Number(m[1]),Number(m[2])]);
 assert.deepEqual(ranges,trace.pages.map(p=>[p.rows[0],p.rows.at(-1)]));
});

test('multiple sheets keep one local print-area union each and escape names',async()=>{
 const f=fixture();f.ws.name="가상 '학교' & 검사";
 const other=f.wb.addWorksheet('가상 별도 표');other.columns=[{width:25}];
 const r=other.addRow(['별도 가상 기록']);r.getCell(1).font={name:'맑은 고딕',size:10};
 f.wb.definedNames.add("'가상 별도 표'!$A$1",'PreservedName');
 const traces=f.layout.finish(f.wb);
 const zip=await JSZip.loadAsync(await f.layout.writeBuffer(f.wb)),xml=await zip.file('xl/workbook.xml').async('string');
 const defs=Array.from(xml.matchAll(/<definedName name="_xlnm.Print_Area" localSheetId="(\d+)">([^<]*)<\/definedName>/g));
 assert.equal(defs.length,2);assert.deepEqual(defs.map(m=>+m[1]),[0,1]);
 assert.equal((defs[0][2].match(/!\$A\$/g)||[]).length,traces[0].pages.length);
 assert(defs[0][2].includes('&apos;&apos;학교&apos;&apos; &amp; 검사'));
 assert.match(xml,/name="PreservedName"/);
});

test('final serialization preserves worksheet values, styles and relationships',async()=>{
 const f=fixture({micro:true});f.layout.finish(f.wb);
 const raw=await JSZip.loadAsync(await f.wb.xlsx.writeBuffer()),fixed=await JSZip.loadAsync(await f.layout.writeBuffer(f.wb));
 assert.deepEqual(Object.keys(raw.files).sort(),Object.keys(fixed.files).sort());
 for(const key of Object.keys(raw.files))if(!raw.files[key].dir && key!=='xl/workbook.xml')
  assert.deepEqual(await raw.file(key).async('nodebuffer'),await fixed.file(key).async('nodebuffer'),key);
});
