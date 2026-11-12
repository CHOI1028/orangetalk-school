import { escHtml as esc } from './format-utils.js';
import { cleanDiseaseLabel } from './infectious-labels.js';
import { searchDiseases, normalizeDiseaseText } from './infectious-guide.js';

// Canonicalize the API's full date labels and separate year/period fields.
// Unrecognized labels remain visible; absent periods are never invented as zero.
export function periodLabel(row,type) {
  const year=String(row.year||'').trim(),period=String(row.period||'').trim();
  if(['계','합계','전체','총계'].includes(period))return '';
  const full=period&&(!year||period.includes(year.replace(/년$/,'')))?period:[year,period].filter(Boolean).join(' ');
  const y=full.match(/\b((?:19|20)\d{2})/);
  if(!y)return full||'기간 미상';
  if(String(type)==='1'&&/^\d{4}년?$/.test(full))return y[1]+'년';
  const tail=full.slice(y.index+y[1].length).replace(/^년/,'').trim();
  const n=tail.match(/^(?:[-/.]\s*)?(\d{1,2})(?:\s*[월주])?$/);
  const unit=String(type)==='2'?'월':String(type)==='3'?'주':'';
  if(n&&unit&&Number(n[1])>=1&&Number(n[1])<=(unit==='월'?12:53))return y[1]+'년 '+n[1].padStart(2,'0')+unit;
  return full||'기간 미상';
}
export function groupPeriodRows(rows,type) {
  const diseases=new Map();
  for(const row of rows){
    const name=cleanDiseaseLabel(row.icdNm),period=periodLabel(row,type);
    if(!name||!period)continue;
    if(!diseases.has(name))diseases.set(name,new Map());
    const periods=diseases.get(name),value=Number.isSafeInteger(row.val)&&row.val>=0?row.val:null;
    periods.set(period,periods.has(period)?(periods.get(period)==null||value==null?null:periods.get(period)+value):value);
  }
  return Array.from(diseases,([name,periods])=>{
    const values=Array.from(periods,([period,value])=>({period,value})).sort((a,b)=>a.period.localeCompare(b.period,'ko',{numeric:true}));
    const known=values.filter(x=>x.value!=null),total=known.reduce((s,x)=>s+x.value,0),max=Math.max(0,...known.map(x=>x.value));
    return {name,values,total,max,missing:values.length-known.length,peaks:max>0?known.filter(x=>x.value===max).map(x=>x.period):[]};
  }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ko'));
}

export function renderPeriodTrend(body,rows,state,options) {
  const diseases=groupPeriodRows(rows,options.type),unit={1:'연도별',2:'월별',3:'주별'}[options.type]||'';
  const range=String(options.startYear)===String(options.endYear)?options.startYear+'년':options.startYear+'~'+options.endYear+'년';
  if(state.query==null)state.query=cleanDiseaseLabel(options.initialQuery);
  body.innerHTML='<div class="if-context"><div><span class="if-eyebrow">질병관리청 발생 통계</span><h3>전국 · '+esc(range)+' · '+unit+'</h3></div></div>'
    +'<div class="if-age-layout"><aside class="if-age-picker"><label>질병 찾기<input id="ifPeriodQuery" autocomplete="off" placeholder="질병명·별칭·KCD" value="'+esc(state.query)+'"></label><label>질병 선택<select id="ifPeriodDisease"></select></label><p id="ifPeriodCount" class="if-muted" role="status"></p></aside>'
    +'<section id="ifPeriodChart" aria-label="선택 질병의 기간별 발생 추이"></section></div>';
  const input=body.querySelector('#ifPeriodQuery'),select=body.querySelector('#ifPeriodDisease'),chart=body.querySelector('#ifPeriodChart');
  function draw(){
    state.selected=select.value;
    const d=diseases.find(x=>x.name===state.selected);
    if(!d){chart.innerHTML='<div class="if-empty">일치하는 기간별 자료가 없습니다.</div>';return;}
    const allMissing=d.missing===d.values.length;
    const peak=d.peaks.length===1?d.peaks[0]:d.peaks.length>1?'공동 '+d.peaks.length+'개 기간':allMissing?'자료 없음':'해당 없음';
    chart.innerHTML='<div class="if-chart-heading"><h3>'+esc(d.name)+'</h3><button type="button" id="ifPeriodGuide">질병 안내 보기 ↗</button></div>'
      +'<div class="if-metrics"><div><span>'+(d.missing?'확인된 발생수':'조회 기간 합계')+'</span><strong>'+(allMissing?'자료 없음':d.total.toLocaleString()+'<small> 명</small>')+'</strong></div>'
      +'<div><span>'+(d.missing?'확인된 자료 중 최다 기간':'발생수가 가장 많은 기간')+'</span><strong>'+esc(peak)+'</strong></div><div><span>집계 기간</span><strong>'+d.values.length+'<small>개</small></strong></div></div>'
      +(d.missing?'<p class="if-note">'+d.missing+'개 기간 미제공 · 합계 일부</p>':d.total===0?'<p class="if-note">조회된 모든 기간 0명</p>':'')
      +'<div class="if-chart-legend"><span>기간 · 시간순</span><span>발생수(명)</span></div><div class="if-period-bars" role="list" aria-label="기간별 발생수">'
      +d.values.map(x=>'<div class="if-bar-row'+(x.value===d.max&&d.max>0?' is-peak':'')+'" role="listitem"><span class="if-bar-label">'+esc(x.period)+'</span><div class="if-bar-track" aria-hidden="true"><i style="width:'+(d.max&&x.value!=null?100*x.value/d.max:0)+'%"></i></div><span class="if-bar-value">'+(x.value==null?'자료 없음':x.value.toLocaleString()+'명')+'</span></div>').join('')+'</div>'
      +'<details class="if-source-note"><summary>표로 자세히 보기</summary><table class="if-age-table"><thead><tr><th>기간</th><th>발생수(명)</th></tr></thead><tbody>'
      +d.values.map(x=>'<tr><td>'+esc(x.period)+'</td><td>'+(x.value==null?'자료 없음':x.value.toLocaleString())+'</td></tr>').join('')+'</tbody></table></details>';
    chart.querySelector('#ifPeriodGuide').addEventListener('click',()=>options.onGuide(d.name));
  }
  function filter(){
    state.query=input.value;
    const q=normalizeDiseaseText(state.query),matches=new Set(searchDiseases(q).map(d=>normalizeDiseaseText(d.name)));
    const filtered=diseases.filter(d=>!q||normalizeDiseaseText(d.name).includes(q)||matches.has(normalizeDiseaseText(d.name)));
    select.innerHTML=filtered.map(d=>'<option value="'+esc(d.name)+'">'+esc(d.name)+'</option>').join('');
    select.disabled=!filtered.length;
    const chosen=filtered.find(d=>d.name===state.selected)||filtered.find(d=>d.name==='수두'&&d.total>0)||filtered[0];
    if(chosen)select.value=chosen.name;
    body.querySelector('#ifPeriodCount').textContent=filtered.length+'개 질병 · 발생수 많은 순';
    draw();
  }
  input.addEventListener('input',filter);select.addEventListener('change',draw);filter();
}
