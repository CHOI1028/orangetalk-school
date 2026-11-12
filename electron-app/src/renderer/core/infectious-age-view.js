import { escHtml as esc } from './format-utils.js';
import { cleanDiseaseLabel } from './infectious-labels.js';
import { searchDiseases, normalizeDiseaseText } from './infectious-guide.js';

export function groupAgeRows(rows) {
  const diseases=new Map();
  for(const row of rows){
    const name=cleanDiseaseLabel(row.icdNm),age=String(row.ageRange||'').trim();
    if(!name||!age||['계','합계','전체','총계'].includes(age))continue;
    if(!diseases.has(name))diseases.set(name,new Map());
    const ages=diseases.get(name),value=Number.isSafeInteger(row.val)&&row.val>=0?row.val:null;
    ages.set(age,ages.has(age)?(ages.get(age)==null||value==null?null:ages.get(age)+value):value);
  }
  return Array.from(diseases,([name,ages])=>{
    const values=Array.from(ages,([age,value])=>({age,value})).sort((a,b)=>ageOrder(a.age)-ageOrder(b.age)||a.age.localeCompare(b.age,'ko',{numeric:true}));
    const known=values.filter(x=>x.value!=null),total=known.reduce((s,x)=>s+x.value,0);
    const max=Math.max(0,...known.map(x=>x.value));
    return {name,values,total,max,missing:values.length-known.length,peaks:max>0?known.filter(x=>x.value===max).map(x=>x.age):[]};
  }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ko'));
}
function ageOrder(label){
  if(/미만/.test(label))return Math.max(-1,Number(label.match(/\d+/)?.[0]||0)-1);
  const number=label.match(/\d+/);return number?Number(number[0]):Infinity;
}

export function renderAgeDistribution(body,rows,state,options){
  const diseases=groupAgeRows(rows);
  if(state.query==null)state.query=cleanDiseaseLabel(options.initialQuery);
  body.innerHTML='<div class="if-context"><div><span class="if-eyebrow">질병관리청 발생 통계</span><h3>전국 · '+esc(options.year)+'년 · '+esc(options.unit)+'세 단위</h3></div></div>'
    +'<div class="if-age-layout"><aside class="if-age-picker"><label>질병 찾기<input id="ifAgeQuery" autocomplete="off" placeholder="질병명·별칭·KCD" value="'+esc(state.query)+'"></label><label>질병 선택<select id="ifAgeDisease"></select></label><p id="ifAgeCount" class="if-muted" role="status"></p></aside>'
    +'<section id="ifAgeChart" aria-label="선택 질병의 연령별 발생 분포"></section></div>';
  const input=body.querySelector('#ifAgeQuery'),select=body.querySelector('#ifAgeDisease'),chart=body.querySelector('#ifAgeChart');
  function draw(){
    state.selected=select.value;
    const d=diseases.find(x=>x.name===state.selected);
    if(!d){chart.innerHTML='<div class="if-empty">일치하는 연령별 자료가 없습니다.</div>';return;}
    const complete=!d.missing,allMissing=d.missing===d.values.length;
    const peak=d.peaks.length===1?d.peaks[0]:d.peaks.length>1?'공동 '+d.peaks.length+'개 연령대':allMissing?'자료 없음':'해당 없음';
    chart.innerHTML='<div class="if-chart-heading"><h3>'+esc(d.name)+'</h3><button type="button" id="ifAgeGuide">질병 안내 보기 ↗</button></div>'
      +'<div class="if-metrics"><div><span>'+(complete?'연령별 합계':'확인된 발생수')+'</span><strong>'+(allMissing?'자료 없음':d.total.toLocaleString()+'<small> 명</small>')+'</strong></div>'
      +'<div><span>'+(complete?'발생수가 가장 많은 연령':'확인된 자료 중 최다 연령')+'</span><strong>'+esc(peak)+'</strong></div><div><span>집계 연령 구간</span><strong>'+d.values.length+'<small>개</small></strong></div></div>'
      +(d.missing?'<p class="if-note">'+d.missing+'개 구간 미제공 · 합계 일부 · 비율 제외</p>':d.total===0?'<p class="if-note">모든 연령 구간 0명</p>':'')
      +'<div class="if-chart-legend"><span>연령</span><span>발생수'+(complete&&d.total>0?' · 해당 질병 내 비율':'')+'</span></div>'
      +'<div class="if-bars" role="list" aria-label="연령별 발생수">'+d.values.map(x=>{
        const percent=complete&&d.total>0&&x.value!=null?(100*x.value/d.total).toFixed(1)+'%':'';
        return '<div class="if-bar-row'+(x.value===d.max&&d.max>0?' is-peak':'')+'" role="listitem"><span class="if-bar-label">'+esc(x.age)+'</span><div class="if-bar-track" aria-hidden="true"><i style="width:'+(d.max&&x.value!=null?100*x.value/d.max:0)+'%"></i></div><span class="if-bar-value">'+(x.value==null?'자료 없음':x.value.toLocaleString()+'명')+(percent?'<small>'+percent+'</small>':'')+'</span></div>';
      }).join('')+'</div>'
      +'<details class="if-source-note"><summary>표로 자세히 보기</summary><table class="if-age-table"><thead><tr><th>연령</th><th>발생수(명)</th></tr></thead><tbody>'+d.values.map(x=>'<tr><td>'+esc(x.age)+'</td><td>'+(x.value==null?'자료 없음':x.value.toLocaleString())+'</td></tr>').join('')+'</tbody></table></details>';
    chart.querySelector('#ifAgeGuide').addEventListener('click',()=>options.onGuide(d.name));
  }
  function filter(){
    state.query=input.value;
    const q=normalizeDiseaseText(state.query),matches=new Set(searchDiseases(q).map(d=>normalizeDiseaseText(d.name)));
    const filtered=diseases.filter(d=>!q||normalizeDiseaseText(d.name).includes(q)||matches.has(normalizeDiseaseText(d.name)));
    select.innerHTML=filtered.map(d=>'<option value="'+esc(d.name)+'">'+esc(d.name)+'</option>').join('');
    select.disabled=!filtered.length;
    const chosen=filtered.find(d=>d.name===state.selected)||filtered.find(d=>d.name==='수두'&&d.total>0)||filtered[0];
    if(chosen)select.value=chosen.name;
    body.querySelector('#ifAgeCount').textContent=filtered.length+'개 질병 · 발생수 많은 순';
    draw();
  }
  input.addEventListener('input',filter);select.addEventListener('change',draw);filter();
}
