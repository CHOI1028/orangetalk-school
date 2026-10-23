'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const layout = require(process.env.DIARY_LAYOUT_MODULE || '../src/main/diary-excel-layout.cjs');
const headers = ['순','학교급','학과','학년반','번호','이름','시간','성별','증상','처치 내용','침상 이용'];
const categories = ['외상','호흡기','소화기','순환기','피부','두통/신경','근골격','이비인후','구강/치아','안과','비뇨/생식','정신/심리','감염','기타','상담'];
const norm = value => String(value ?? '').replace(/\r\n?/g,'\n').replace(/\n/g,'');

function statistics(count, grades = 1) {
  const header = ['구분',...categories,'계'];
  const values = label => [label,count,...Array(categories.length-1).fill(0),count];
  return {sections:[
    {title:'학생 학년별 진료과 통계',header,rows:Array.from({length:grades},(_,i)=>values((i+1)+'학년')),totalsRow:values('학생 소계')},
    {title:'교직원 진료과 통계',header,rows:[['교직원',...Array(categories.length+1).fill(0)]]},
    {title:'전체 학생 및 교직원',header,rows:[values('합계')]}
  ]};
}

function day(date,count,{long=false,grades=1,memo=false,short=false,longRepeats=50}={}) {
  const treatment='가상약A 0.5정 / 가상약B 2.5mL / 보건교육 / [V/S] 체온 37.4, 혈압 110/70, 맥박 80, 호흡 18, SpO2 98, BST 0';
  const rows = Array.from({length:count},(_,i)=>[
    i+1,'초','-', '6-1',i+1,'가상학생'+String(i+1).padStart(3,'0'),'09:10 ~ 09:20','-',
    '가상 증상 '+(i+1),
    short ? '보건교육' : treatment,
    '-'
  ]);
  if(long && rows.length) rows[0][9] = treatment+'\n\n'+'긴 가상 처치 기록 / 관찰 내용 LONGWORD0123456789 '.repeat(longRepeats)+'\n마지막 투여량 3방울';
  return {date,schoolText:'가상검사학교 (실제 자료 아님)',headerLabels:headers,colWidths:[36,52,80,70,44,90,110,46,170,230,56],dataRows:rows,
    preambleSections:statistics(count,grades),...(memo?{todayMemo:{titles:['검사 메모'],cells:['가상 메모 '.repeat(120)+'메모 끝']}}:{})};
}

function payload(template,orientation,margins,days) {
  return {titleText:'일일 보건일지',schoolText:'가상검사학교 (실제 자료 아님)',periodText:'기간: 2026. 09. 01. ~ 2027. 02. 28.',
    continuousDays:days,diaryExcelOptions:{template,orientation,margins,roles:['작성','검토','결재']}};
}

function placeholderDay() {
  const value=day('2026-10-22',1,{short:true});
  value.dataRows[0][8]='두통\n편두통\n이명\n손발 저림\n경련\n어지러움';
  value.dataRows[0][9]='→ 보건교육, 가상약A 0.5정\r\n→\r\n  →  \r\n→ →\r\n[V/S]\r\n체온 37.4, 혈압 110/70, 맥박 80\r\n호흡 20, SpO2 98, BST 0\r\n\r\n→ 0 / 가상약B 2.5mL\r\n관찰 → 재확인';
  value.expectedOutputRows=value.dataRows.map(row=>[...row]);
  value.expectedOutputRows[0][9]='→ 보건교육, 가상약A 0.5정\n[V/S]\n체온 37.4, 혈압 110/70, 맥박 80\n호흡 20, SpO2 98, BST 0\n\n→ 0 / 가상약B 2.5mL\n관찰 → 재확인';
  return value;
}

async function audit(input,{roundTrip=true}={}) {
  const original = JSON.stringify(input);
  const book = layout.buildWorkbook(ExcelJS,input);
  assert.equal(JSON.stringify(input),original,'Input records/options must not be mutated');
  assert.equal(book.worksheets.length,1,'Whole period remains in one sheet');
  const sheet = book.worksheets[0];
  assert.equal(sheet.pageSetup.fitToPage,false);
  assert.equal(sheet.pageSetup.scale,100);
  const breaks = sheet.rowBreaks.map(value=>value.id);
  assert.equal(new Set(breaks).size,breaks.length);
  assert(breaks.every((row,i)=>row>0 && row<sheet.rowCount && (!i || row>breaks[i-1])));
  const pageOf = row => breaks.filter(value=>value<row).length;
  const bounds = [0,...breaks,sheet.rowCount];
  const paperHeight = input.diaryExcelOptions.orientation==='portrait'?841.89:595.28;
  const margins = sheet.pageSetup.margins;
  for(let i=1;i<bounds.length;i++) {
    let height=0;
    for(let r=bounds[i-1]+1;r<=bounds[i];r++) {
      const row=sheet.getRow(r); assert(row.height>0 && row.height<=409);
      height += Math.ceil(row.height/.75)*.75;
      row.eachCell(cell=>assert(!cell.formula,'Synthetic literal text must not become a formula'));
    }
    assert(height<=paperHeight-(margins.top+margins.bottom)*72-18,'Each page fits independent physical-height calculation');
  }
  const docs = input.continuousDays?.length ? input.continuousDays : [input,...(input.dailySheets || []).map(value=>value.payload)];
  const logs = book.diaryLayout.filter(value=>value.rows);
  assert.equal(logs.length,docs.length);
  logs.forEach((log,index)=>{
    const doc=docs[index];
    assert.equal(log.records,doc.dataRows.length);
    const startPage=pageOf(log.heading.first);
    assert.equal(pageOf(log.heading.last),startPage,'Title and entire approval box stay together');
    assert.equal(log.heading.first,bounds[startPage]+1,'Each date starts at a page top');
    const firstTable=log.tables[0];
    assert.equal(pageOf(firstTable.header.first),startPage);
    assert.equal(pageOf(firstTable.header.last),startPage);
    if(firstTable.units.length) assert.equal(pageOf(firstTable.units[0].first),startPage,'Heading and first table data must not separate');
    for(const table of log.tables) {
      assert.equal(pageOf(table.header.first),pageOf(table.header.last),'Table label/header must not split');
      if(table.units.length) assert.equal(pageOf(table.header.last),pageOf(table.units[0].first),'No orphan table header');
    }
    log.rows.forEach((range,ri)=>doc.headerLabels.forEach((header,ci)=>{
      const parts=range.printedRows.filter((row,i)=>!(ci===0 && /^순(?:번)?$/.test(header) && i>0)).map(row=>sheet.getCell(row,log.columns[ci][0]).value ?? '');
      assert.equal(norm(parts.join('')),norm((doc.expectedOutputRows || doc.dataRows)[ri][ci]),'All meaningful V/S, medication, dose and treatment text survives');
    }));
    log.rows.forEach((range,ri)=>{
      const printed=range.printedRows;
      for(let i=1;i<printed.length;i++) {
        const previous=printed[i-1],current=printed[i];
        if(pageOf(previous)===pageOf(current)) {
          assert(sheet.getRow(previous).height>=396,'Only Excel row-height limit may split a visit within one page');
          if(/^순(?:번)?$/.test(doc.headerLabels[0])) assert(!sheet.getCell(current,log.columns[0][0]).text.includes('(계속)'),'No same-page continuation label');
        } else {
          let used=0;
          const pageIndex=pageOf(previous);
          for(let r=bounds[pageIndex]+1;r<=bounds[pageIndex+1];r++) used+=Math.ceil(sheet.getRow(r).height/.75)*.75+.75;
          const room=paperHeight-(margins.top+margins.bottom)*72-18-used;
          if(sheet.getRow(previous).height<396) assert(room<16,'A split visit must fill remaining line capacity before continuing');
        }
      }
      if(ri>0 && pageOf(log.rows[ri-1].last)<pageOf(range.first)) {
        const pageIndex=pageOf(log.rows[ri-1].last);
        let used=0;
        for(let r=bounds[pageIndex]+1;r<=bounds[pageIndex+1];r++) used+=Math.ceil(sheet.getRow(r).height/.75)*.75+.75;
        assert(paperHeight-(margins.top+margins.bottom)*72-18-used<24.75,'Do not push a whole new visit past usable space');
      }
    });
    for(let page=startPage+1;page<=pageOf(log.sectionRows.last);page++) {
      const first=bounds[page]+1;
      assert(sheet.getCell(first,1).text.includes('(계속)'));
      if(doc.date) assert(norm(sheet.getCell(first,1).text).includes(doc.date.replace(/-/g,'. ')+'.'),'Continuation has the same date');
    }
  });
  const bytes=await book.xlsx.writeBuffer();
  const zip=await JSZip.loadAsync(bytes);
  const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  const workbookXml=await zip.file('xl/workbook.xml').async('string');
  assert(!/fitToPage="1"/.test(xml),'Saved XML must not reactivate Fit to Page');
  assert(/scale="100"/.test(xml));
  const xmlBreaks=[...xml.matchAll(/<brk\s[^>]*id="(\d+)"[^>]*\/>/g)].map(match=>Number(match[1]));
  assert.deepEqual(xmlBreaks,breaks,'Manual boundaries are actually serialized');
  assert.equal((workbookXml.match(/name="_xlnm.Print_Area"/g)||[]).length,1);
  assert.equal((workbookXml.match(/<sheet /g)||[]).length,1);
  assert(sheet.pageSetup.printArea.endsWith(String(sheet.rowCount)),'Print area includes final record');
  if(roundTrip) {
    const loaded=new ExcelJS.Workbook(); await loaded.xlsx.load(bytes);
    assert.equal(loaded.worksheets.length,1);
    const restored=loaded.worksheets[0];
    assert.equal(restored.pageSetup.fitToPage,false); assert.equal(restored.pageSetup.scale,100);
    sheet.eachRow(row=>row.eachCell(cell=>assert.equal(restored.getCell(cell.address).text,cell.text)));
  }
  return {book,bytes,pages:bounds.length-1,logs};
}

for(const template of ['official','approval']) for(const orientation of ['landscape','portrait']) for(const margins of ['narrow','normal']) {
  test(`${template}/${orientation}/${margins}: three dates, small first tables and 40 visits`,async()=>{
    const input=payload(template,orientation,margins,[day('2026-09-01',1,{short:true}),day('2026-09-09',40),day('2026-10-23',1,{short:true})]);
    const {book,pages,logs}=await audit(input);
    assert(pages>3,'Busy day must flow onto following pages');
    const sheet=book.worksheets[0],pageOf=r=>sheet.rowBreaks.filter(b=>b.id<r).length;
    for(const log of logs) {
      assert.equal(pageOf(log.tables[0].first),pageOf(log.tables[0].last),'Small first summary table stays intact');
    }
    assert.equal(pageOf(logs[0].sectionRows.first),pageOf(logs[0].sectionRows.last),'Single short visit fits one page');
    assert.equal(pageOf(logs[2].sectionRows.first),pageOf(logs[2].sectionRows.last));
  });
  test(`${template}/${orientation}/${margins}: long treatment, memo and six-grade summary`,async()=>{
    const result=await audit(payload(template,orientation,margins,[day('2026-09-01',6,{long:true,memo:true,grades:6}),day('2026-10-23',2)]));
    assert(result.logs[0].rows[0].chunks>1);
  });
  test(`${template}/${orientation}/${margins}: zero visits and optional period cover`,async()=>{
    const input=payload(template,orientation,margins,[day('2026-09-01',0),day('2026-10-23',1)]);
    input.coverSections=statistics(1).sections;
    const result=await audit(input);
    assert.equal(result.book.diaryLayout[0].type,'statistics');
  });
  test(`${template}/${orientation}/${margins}: use remaining space before a long visit continues`,async()=>{
    const record=day('2026-10-21',3,{short:true});
    record.dataRows[2][9]=Array.from({length:18},(_,i)=>'L'+String(i+1).padStart(2,'0')).join('\n');
    await audit(payload(template,orientation,margins,[record,placeholderDay()]));
  });
  test(`${template}/${orientation}/${margins}: twelve lines stay in one visit row`,async()=>{
    const record=day('2026-10-23',1,{short:true});
    delete record.preambleSections;
    record.dataRows[0][9]=Array.from({length:12},(_,i)=>'L'+String(i+1).padStart(2,'0')).join('\n');
    const result=await audit(payload(template,orientation,margins,[record]));
    assert.equal(result.logs[0].rows[0].printedRows.length,1,'No arbitrary eight-line split');
    assert.equal(result.pages,1);
  });
}

for(const template of ['official','approval']) {
  test(`${template}: full 181-day period, first/last dates and visit totals`,async()=>{
    const days=Array.from({length:181},(_,i)=>day(new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),i%5===0?2:1));
    const {logs}=await audit(payload(template,'landscape','narrow',days),{roundTrip:false});
    assert.equal(logs[0].date,'2026-09-01'); assert.equal(logs.at(-1).date,'2027-02-28');
    assert.equal(logs.reduce((sum,log)=>sum+log.records,0),days.reduce((sum,value)=>sum+value.dataRows.length,0));
  });
  test(`${template}: one displayed column and long custom approval labels`,async()=>{
    const single={date:'2026-10-23',schoolText:'가상검사학교',headerLabels:['처치 내용'],dataRows:[['가상약A 0.5정 / V/S 37.4'],[0]],colWidths:[200]};
    const input=payload(template,'portrait','normal',[single]);
    input.diaryExcelOptions.roles=['보건 업무 작성 담당자','보건 업무 검토 담당자','보건 업무 결재 담당자'];
    await audit(input);
  });
  test(`${template}: mixed columns, duplicate dates and literal formulas`,async()=>{
    const first=day('2026-10-23',1),second={date:'2026-10-23',schoolText:'가상검사학교',headerLabels:['처치 내용','순'],dataRows:[['=1+1\n가상약B 2.5mL',0]],colWidths:[300,30]};
    await audit(payload(template,'landscape','narrow',[first,second]));
  });
  if(process.env.DIARY_SAMPLE_DIR) test(`${template}: export user preview sample`,async()=>{
    const three=day('2026-10-21',3,{short:true});
    three.dataRows[2][8]='두통\n손발 저림\n경련';
    three.dataRows[2][9]='→ 가상약A 0.5정\n→\n→';
    three.expectedOutputRows=three.dataRows.map(row=>[...row]);
    three.expectedOutputRows[2][9]='→ 가상약A 0.5정';
    const days=[day('2026-09-01',1,{short:true}),three,placeholderDay(),day('2026-10-23',40,{short:true,long:true,longRepeats:12})];
    days.at(-1).dataRows.at(-1)[9]+=' / 마지막 날짜의 마지막 기록';
    const input=payload(template,'landscape','narrow',days);
    input.periodText='기간: 2026. 09. 01. ~ 2026. 10. 23.';
    const result=await audit(input);
    fs.mkdirSync(process.env.DIARY_SAMPLE_DIR,{recursive:true});
    const file=template==='official'?'01_공문서형_페이지나눔_가상검사.xlsx':'02_결재문서형_페이지나눔_가상검사.xlsx';
    fs.writeFileSync(path.join(process.env.DIARY_SAMPLE_DIR,file),result.bytes);
    console.log(JSON.stringify({sample:file,dates:days.map(value=>value.date),records:days.reduce((sum,value)=>sum+value.dataRows.length,0),calculatedPages:result.pages,actualExcelVerified:false}));
  });
}
