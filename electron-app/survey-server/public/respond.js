'use strict';
(async function() {
  const $ = id => document.getElementById(id), model = window.OrangeSurvey;
  const id = location.pathname.split('/').filter(Boolean).pop();
  const endpoint = '/api/v1/surveys/public/' + encodeURIComponent(id);
  const answers = {}, history = [];
  let definition, version, index = -1, language = 'ko', busy = false;
  // Only the random retry identifier is kept. Health answers remain in memory.
  let submissionId, completed=false;
  try { completed=sessionStorage.getItem('survey-completed:'+id)==='true'; } catch(_) {}
  try { submissionId = sessionStorage.getItem('survey-retry:'+id); } catch(_) {}
  if(!submissionId) { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); submissionId = Array.from(bytes, x => x.toString(16).padStart(2,'0')).join(''); }
  try { sessionStorage.setItem('survey-retry:'+id,submissionId); } catch(_) {}
  function showCompleted(){
    $('survey').hidden=true; $('description').textContent=''; $('message').textContent='응답이 제출되었습니다. 참여해 주셔서 감사합니다.';
    Object.keys(answers).forEach(k=>delete answers[k]); $('survey').reset(); $('questions').replaceChildren();
    let restart=$('restart');
    if(!restart){restart=el('button','다른 학생 응답하기',$('message').parentElement);restart.id='restart';restart.type='button';restart.addEventListener('click',()=>{
      try{sessionStorage.removeItem('survey-retry:'+id);sessionStorage.removeItem('survey-completed:'+id);}catch(_){}
      location.reload();
    });}
  }
  function el(tag, text, parent) { const node = document.createElement(tag); if(text != null) node.textContent = text; if(parent) parent.append(node); return node; }
  function plain(value) { const template=document.createElement('template');template.innerHTML=String(value||'');return template.content.textContent||''; }
  function translated(item, key) { const value=(item[key+'Translations'] || {})[language] || (key==='text' && (item.translations || {})[language]) || item[key] || '';return typeof value==='object'?value.text||item[key]||'':value; }
  function question(q, parent) {
    const field = el('fieldset', null, parent), legend = el('legend', translated(q,'text'), field);
    if(q.required) el('span',' *',legend).className='required';
    const desc = translated(q,'desc'); if(desc) el('p',plain(desc),field).className='description';
    const val = answers[String(q.id)];
    const save = value => { answers[String(q.id)] = value; };
    const input = (type,label,value,checked,change) => {
      const row = el('label',null,field), node = el('input',null,row); node.type=type; node.name='q'+q.id; node.value=value; node.checked=checked; el('span',label,row); node.addEventListener('change',change); return node;
    };
    const options = q.options || [], labels = options.map((o,i)=>(q.optionTranslations||{})[i]?.[language]||((q.translations||{})[language]?.options||[])[i]||o);
    if(['radio','checkbox','star','scale','dropdown'].includes(q.type)) {
      if(q.type==='dropdown') {
        const select = el('select',null,field); select.setAttribute('aria-label',translated(q,'text'));
        const empty = el('option','선택해 주세요',select); empty.value='';
        options.forEach((o,i) => { const opt = el('option',labels[i] || o,select); opt.value=o; });
        if(q.hasOther) { const opt=el('option','기타',select); opt.value='__other'; }
        select.value = typeof val==='string' && val.startsWith('기타: ') ? '__other' : val || '';
        select.addEventListener('change',() => save(select.value==='__other' ? '기타: '+(field.querySelector('.other-text')?.value || '') : select.value));
      } else options.forEach((o,i) => input(q.type==='checkbox'?'checkbox':'radio', (labels[i]||o)+(q.type==='star'?' ★':''), o, q.type==='checkbox' ? Array.isArray(val)&&val.includes(o) : val===o, e => {
        if(q.type==='checkbox') { const list=Array.isArray(answers[q.id])?answers[q.id].slice():[]; save(e.target.checked ? list.concat(o) : list.filter(x=>x!==o)); } else save(o);
      }));
      if(q.hasOther) {
        const current = Array.isArray(val) ? val.find(x => x.startsWith('기타: ')) : typeof val==='string' && val.startsWith('기타: ') ? val : '';
        if(q.type!=='dropdown') input(q.type==='checkbox'?'checkbox':'radio','기타','__other',!!current,e => {
          const other='기타: '+field.querySelector('.other-text').value;
          if(q.type==='checkbox') { const list=(answers[q.id]||[]).filter(x=>!x.startsWith('기타: ')); save(e.target.checked?list.concat(other):list); } else save(other);
        });
        const other=el('input',null,field); other.className='other-text'; other.setAttribute('aria-label','기타 응답'); other.placeholder='기타 내용을 입력하세요'; other.maxLength=10000; other.value=current?current.slice(4):'';
        other.addEventListener('input',() => {
          if(q.type==='checkbox') { const list=answers[q.id]||[]; if(list.some(x=>x.startsWith('기타: '))) save(list.filter(x=>!x.startsWith('기타: ')).concat('기타: '+other.value)); }
          else if(typeof answers[q.id]==='string' && answers[q.id].startsWith('기타: ')) save('기타: '+other.value);
        });
      }
    } else if(q.type.startsWith('grid_')) {
      const wrap=el('div',null,field); wrap.className='grid-wrap'; const table=el('table',null,wrap), head=el('tr',null,el('thead',null,table));
      el('th','',head); q.gridCols.forEach((c,ci)=>el('th',(q.gridColTranslations||{})[ci]?.[language]||c,head)); const body=el('tbody',null,table);
      q.gridRows.forEach((r,ri)=>{ const row=el('tr',null,body); el('th',(q.gridRowTranslations||{})[ri]?.[language]||r,row);
        q.gridCols.forEach((c,ci)=>{ const cell=el('td',null,row), node=el('input',null,cell); node.setAttribute('aria-label',r+' · '+c);
          const key=q.type==='grid_radio'?String(ri):ri+':'+ci;
          if(q.type==='grid_radio') { node.type='radio'; node.name='q'+q.id+'r'+ri; node.checked=!!val&&val[key]===c; }
          else { node.type='text'; node.maxLength=10000; node.value=val&&val[key]||''; }
          node.addEventListener(q.type==='grid_radio'?'change':'input',()=>save(Object.assign({},answers[q.id]||{}, {[key]:q.type==='grid_radio'?c:node.value})));
        });
      });
    } else {
      const node=el(q.type==='paragraph'?'textarea':'input',null,field); node.setAttribute('aria-label',translated(q,'text')); node.maxLength=10000;
      if(q.type.startsWith('date_')) node.type='date'; else if(q.type.startsWith('time_')) node.type='time'; else if(node.tagName==='INPUT') node.type='text';
      node.value=val||''; node.addEventListener('input',()=>save(node.value));
    }
  }
  function render() {
    $('message').textContent=''; $('title').textContent=translated(definition,'title'); $('description').textContent=plain(translated(definition,'desc'));
    $('identity').hidden=index!==-1; $('languageLabel').hidden=index!==-1; $('questions').replaceChildren();
    if(index===-1) (definition.preQuestions||[]).forEach(q=>question(q,$('questions')));
    else { const section=definition.sections[index];if(section.title||section.desc){const intro=el('section',null,$('questions'));if(section.title)el('h2',translated(section,'title'),intro);if(section.desc)el('p',plain(translated(section,'desc')),intro);}section.questions.forEach(q=>question(q,$('questions'))); }
    $('back').hidden=!history.length; $('next').textContent=index>=0&&model.nextSection(definition,index,answers)>=definition.sections.length?'제출하기':'다음';
    $('progress').textContent=index===-1?'학생 정보':(index+1)+' / '+definition.sections.length;
  }
  $('language').addEventListener('change',e=>{language=e.target.value;render();});
  $('back').addEventListener('click',()=>{if(!busy&&history.length){index=history.pop();render();}});
  $('survey').addEventListener('change',()=>{if(index>=0)$('next').textContent=model.nextSection(definition,index,answers)>=definition.sections.length?'제출하기':'다음';});
  $('survey').addEventListener('submit',async e=>{
    e.preventDefault(); if(busy)return;
    try {
      const qs=index===-1?definition.preQuestions||[]:definition.sections[index].questions;
      qs.forEach(q=>model.validateAnswer(q,answers[q.id]));
      const next=index===-1?0:model.nextSection(definition,index,answers);
      if(next<definition.sections.length) { history.push(index); index=next; render(); window.scrollTo(0,0); return; }
      const cleaned=model.validateResponses(definition,answers);
      busy=true; $('next').disabled=true; $('back').disabled=true; $('message').textContent='제출 중입니다…';
      const response=await fetch(endpoint+'/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submissionId,version,student:{name:$('name').value,grade:Number($('grade').value),cls:Number($('cls').value),num:Number($('num').value)},answers:cleaned})});
      const result=await response.json(); if(!response.ok||!result.success)throw new Error(result.error||'제출하지 못했습니다. 다시 시도해 주세요.');
      completed=true;
      try{sessionStorage.setItem('survey-completed:'+id,'true');}catch(_){}
      showCompleted();
    } catch(err) { $('message').textContent=err.message||'연결하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.'; }
    finally { busy=false; $('next').disabled=false; $('back').disabled=false; }
  });
  try {
    const response=await fetch(endpoint), result=await response.json(); if(!response.ok||!result.success)throw new Error(result.error||'설문을 불러오지 못했습니다.');
    definition=result.definition; version=result.version; model.validateDefinition(definition);
    const langs=Array.from(new Set(['ko'].concat(definition.languages||[])));
    langs.forEach(code=>{const opt=el('option',code==='ko'?'한국어':code,$('language'));opt.value=code;});
    $('survey').hidden=false;render();if(completed)showCompleted();
  } catch(err) { $('title').textContent='설문 안내'; $('message').textContent=err.message; }
})();
