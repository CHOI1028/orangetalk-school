'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {BrowserWindow}=require('electron');
module.exports=async function({editor,base,publishing,out,js,delay,errors}){
  const results=[];
  const sizes=[[1920,1080,1],[1366,768,1],[1280,720,1],[1024,768,1],[1024,600,1],[844,390,1],[800,600,1],[768,1024,1],[600,800,1],[390,844,1],[1280,720,1.25],[1024,768,1.5],[1920,1080,2]];
  const evaluate=`(async()=>{
    const issues=[],seen=new Set();
    const label=e=>e.id||e.dataset.svClick||e.dataset.action||e.className||e.tagName;
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
    const main=document.getElementById('schoolMain')||document.documentElement;
    if(main.scrollWidth>main.clientWidth+3)issues.push({kind:'workspace-overflow',extra:main.scrollWidth-main.clientWidth});
    const scope=document.querySelector('#svPreviewOverlay,#trMsgOverlay')||document.getElementById('view-magic')||document.querySelector('main');
    for(const e of [...scope.querySelectorAll('button,input:not([type=hidden]),select,textarea,[data-magic-sub],.sv-step')].filter(visible)){
      e.scrollIntoView({block:'center',inline:'nearest'});
      const r=e.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;
      for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|auto|scroll|clip/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
      const clipped=r.left<left-3||r.right>right+3||r.top<top-3||r.bottom>bottom+3;
      if(clipped&&!seen.has(label(e))){seen.add(label(e));issues.push({kind:'clipped-control',target:label(e),text:(e.textContent||'').trim().slice(0,35),rect:[r.x,r.y,r.width,r.height],bounds:[left,top,right,bottom]});}
      if(!clipped&&e.matches('button,input,select,textarea')){
        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        if(hit&&!e.contains(hit)&&!hit.contains(e)&&!seen.has(label(e))){seen.add(label(e));issues.push({kind:'covered-control',target:label(e),coveredBy:label(hit)});}
      }
    }
    for(const [sid,pid] of [['trPreviewScroll','trPreviewA4Wrap'],['trsPreviewScroll','trsPreviewA4Wrap']]){
      const scroll=document.getElementById(sid),paper=document.getElementById(pid);if(!scroll||!paper||!visible(paper))continue;
      scroll.scrollLeft=0;const a=scroll.getBoundingClientRect(),b=paper.getBoundingClientRect();
      if(b.width<100||b.left<a.left-2||b.right>a.right+2)issues.push({kind:'paper-clipped',target:pid,paper:[b.x,b.width],viewport:[a.x,a.width]});
    }
    main.scrollTop=0;scope.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0;if(e.scrollLeft)e.scrollLeft=0;});
    return {viewport:[innerWidth,innerHeight],issues};
  })()`;
  async function inspect(win,name,w,h,z=1){
    win.setContentSize(w,h);await js(win,`document.documentElement.style.zoom=${z};window.dispatchEvent(new Event('resize'));`);await delay(220);
    const result=await js(win,evaluate);result.screen=name;result.size=[w,h,z];results.push(result);
    if(result.issues.length||[1366,600,390,320,844].includes(w)||z>1){
      const file=name+'-'+w+'x'+h+'-'+z+'.png';await delay(60);fs.writeFileSync(path.join(out,file),(await win.webContents.capturePage()).toPNG());result.screenshot=file;
    }
  }
  async function matrix(name){
    const state="JSON.stringify({draft:surveyTest.getDraft(),training:trainingTest.state()})";
    const before=await js(editor,state);
    for(const [w,h,z] of sizes)await inspect(editor,name,w,h,z);
    assert.equal(await js(editor,state),before,name+' must retain entered values across resizing');
  }
  await matrix('survey-home');
  await js(editor,"surveyTest.open('wizard',{});surveyTest.select();");
  await matrix('survey-target');
  await js(editor,"surveyTest.step(2)");await matrix('survey-students');
  await js(editor,"surveyTest.step(3)");await matrix('survey-languages');
  await js(editor,"surveyTest.getDraft().title='긴 제목으로 확인하는 학생 건강 및 보건실 이용 만족도 설문';surveyTest.getDraft().sections[0].questions[0].text='보건실에서 받은 안내가 학교생활과 건강관리에 도움이 되었나요?';surveyTest.step(4)");
  await matrix('survey-editor');
  await js(editor,'surveyTest.preview()');await matrix('survey-preview');
  await js(editor,"document.getElementById('svPreviewOverlay').remove();surveyTest.finalize(true)");
  await matrix('survey-complete');
  const record=await js(editor,'surveyTest.getRecords()[0]');
  await js(editor,"surveyTest.sub('active')");await matrix('survey-list');
  await js(editor,'surveyTest.open("stats",'+JSON.stringify({formId:record.formId,title:record.title})+')');await delay(250);await matrix('survey-statistics');
  await js(editor,"surveyTest.open('wizard',{templateType:'health'})");await delay(250);await js(editor,'surveyTest.select();surveyTest.step(4)');await matrix('health-editor');
  await js(editor,"document.getElementById('magicSubTabTraining').click();trainingTest.state().selectedIds={'student-one':true,'student-two':true};trainingTest.state().name='교직원 및 학생 대상 학교 안전교육';trainingTest.home();");
  await matrix('training-register');
  await js(editor,"document.querySelector('[data-action=showMessage]').click()");await matrix('training-message');
  await js(editor,"document.getElementById('trMsgOverlay').remove();trainingTest.sub('status')");await matrix('training-status');
  const long='abcdefghijklmnopqrstuvwxyz'.repeat(4);
  const d={formId:'responsive_phone',title:long,languages:['ko','en'],sections:[{title:'질문',questions:[{id:1,type:'radio',text:long,required:true,options:[long,'아니요']},{id:2,type:'grid_text',text:'표 응답',gridRows:['첫 행','둘째 행'],gridCols:['첫째 열','둘째 열','셋째 열','넷째 열']},{id:3,type:'date_cal',text:'날짜'},{id:4,type:'time_clock',text:'시간'}]}]};
  const published=await publishing.publish({connection:{relayUrl:base,channelId:'ui_school',authToken:'test-ui-token'},draft:d,year:2026});
  const mobile=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
  mobile.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await mobile.loadURL(published.url);await delay(200);
  const mobileSizes=[[320,568],[360,640],[390,844],[430,932],[768,1024],[844,390]];
  for(const [w,h] of mobileSizes)await inspect(mobile,'phone-identity',w,h);
  await js(mobile,"document.getElementById('name').value='가상학생';document.getElementById('grade').value=1;document.getElementById('cls').value=2;document.getElementById('num').value=3;document.getElementById('next').click();");
  for(const [w,h] of mobileSizes)await inspect(mobile,'phone-questions',w,h);
  mobile.destroy();
  fs.writeFileSync(path.join(out,'responsive-report.json'),JSON.stringify({scenarios:results.length,failures:results.filter(r=>r.issues.length).length,errors,results},null,2));
  console.log(JSON.stringify(results.filter(r=>r.issues.length).map(r=>({screen:r.screen,size:r.size,issues:r.issues.slice(0,5)})),null,2));
  assert.equal(errors.length,0,errors.join('\n'));
  if(!process.argv.includes('--record-layout'))assert.equal(results.filter(r=>r.issues.length).length,0,'See _preview/magic-responsive/responsive-report.json');
};
