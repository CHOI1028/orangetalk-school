import { escHtml as esc } from './format-utils.js';
import { searchDiseases, getDiseaseGuide, CATALOG_CHECKED_AT, CATALOG_SOURCE } from './infectious-guide.js';
import { cleanDiseaseLabel } from './infectious-labels.js';

// State belongs to one open detail window. No student information is sent to an API.
export function renderDiseaseGuide(body, state, options = {}) {
  state.query=cleanDiseaseLabel(state.query);
  body.innerHTML = '<div class="if-search"><label>질병명 또는 KCD 코드<input id="ifGuideQuery" placeholder="예: 수두, 독감, B01.9" autocomplete="off" value="'+esc(state.query || '')+'"></label>'
    + '<label>법정감염병 분류<select id="ifGuideGrade"><option value="">전체</option>'+[1,2,3,4].map(g=>'<option value="'+g+'"'+(String(state.grade)===String(g)?' selected':'')+'>'+g+'급</option>').join('')+'</select></label></div>'
    + '<p id="ifGuideCount" role="status" class="if-muted"></p><div class="if-guide-grid"><div class="if-guide-sidebar"><div id="ifGuideResults" class="if-results" aria-label="질병 검색 결과"></div><div id="ifGuideApply"></div></div>'
    + '<section id="ifGuideDetail" aria-label="선택한 질병 안내"></section></div>'
    + '<p class="if-source-title"><a href="'+CATALOG_SOURCE+'" target="_blank" rel="noopener noreferrer">질병관리청 분류·KCD</a> · '+CATALOG_CHECKED_AT+' 기준</p>';
  const query=body.querySelector('#ifGuideQuery'), grade=body.querySelector('#ifGuideGrade');
  const list=body.querySelector('#ifGuideResults'), detail=body.querySelector('#ifGuideDetail');
  const applyHost=body.querySelector('#ifGuideApply');
  function select(disease) {
    state.selected=disease.id;
    list.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.disease===disease.id)));
    const guide=getDiseaseGuide(disease);
    const expected=options.readDiseaseName ? options.readDiseaseName() : null;
    const replacing=expected!=null && String(expected).trim() && expected!==disease.name;
    detail.innerHTML='<div class="if-detail-card"><div class="if-disease-heading"><div><div class="if-disease-meta"><span class="if-badge">법정감염병 · '+disease.grade+'급'+(disease.group?' · '+esc(disease.group):'')+'</span><span class="if-report">신고 '+esc(guide.reportLabel)+'</span></div><h3>'+esc(disease.name)+'</h3><p class="if-code">KCD '+esc(disease.kcd || '원문 확인')+'</p></div></div>'
      +'<div class="if-guide-sections'+(guide.unavailable?' is-unavailable':'')+'"><section><h4>간략 안내</h4><p class="if-guidance">'+esc(guide.brief)+'</p></section>'
      +(guide.unavailable?'':'<section><h4>등교중지·복귀 참고 기준</h4><p class="if-guidance">'+esc(guide.summary)+'</p><h4 class="if-subhead">기록 전 확인</h4><ul class="if-checklist">'+guide.checks.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></section>')+'</div>'
      +'<p class="if-muted if-disclaimer">간략 안내는 보건 업무용 참고입니다. 학생의 진단·격리·등교는 공식 지침과 진료 결과를 확인합니다.</p>'
      +'<div class="if-guide-actions"><a class="if-more" href="'+esc(guide.detailUrl)+'" target="_blank" rel="noopener noreferrer" title="질병관리청 통합검색">자세히 보기 ↗</a>'
      +(guide.unavailable?'':'<a class="if-quiet" href="'+esc(guide.source)+'" target="_blank" rel="noopener noreferrer" title="'+esc(guide.title)+'">지침 원문 ↗</a>')
      +'<button type="button" id="ifGuideStats">발생 통계 보기</button></div></div>';
    applyHost.innerHTML=options.onApply ? '<div class="if-apply"><h4>기록지 적용 미리보기</h4><p>현재 감염병명: <strong>'+esc(expected==null?'기록지 확인 필요':expected||'(비어 있음)')+'</strong><br>적용할 감염병명: <strong>'+esc(disease.name)+'</strong></p>'
        +(replacing?'<label class="if-replace"><input type="checkbox" id="ifAllowReplace"> 기존 감염병명을 위 이름으로 변경하겠습니다.</label>':'')
        +'<button type="button" id="ifApplyDisease" class="if-primary"'+(replacing||expected==null?' disabled':'')+'>감염병명 적용</button><p id="ifApplyStatus" role="status"></p></div>':'';
    detail.querySelector('#ifGuideStats').addEventListener('click',()=>options.onStatistics?.(disease.name));
    const apply=applyHost.querySelector('#ifApplyDisease'), consent=applyHost.querySelector('#ifAllowReplace');
    if(consent) consent.addEventListener('change',()=>{ apply.disabled=!consent.checked; });
    if(apply) apply.addEventListener('click',()=>{
      const result=options.onApply(disease.name,expected,!!consent?.checked);
      applyHost.querySelector('#ifApplyStatus').textContent=result.error || (result.changed?'감염병명을 적용했습니다.':'현재와 같은 감염병명입니다.');
      if(!result.error) { apply.disabled=true; if(consent)consent.disabled=true; }
    });
  }
  function search() {
    state.query=query.value; state.grade=grade.value;
    const results=searchDiseases(state.query,state.grade);
    const single=results.length===1&&!options.onApply;
    body.querySelector('.if-guide-grid').classList.toggle('is-single',single);
    body.querySelector('.if-guide-sidebar').hidden=single;
    const codeNote=results.length>1&&/^[a-z]\d/i.test(cleanDiseaseLabel(state.query))?' · 동일 코드의 진단명을 확인해 주세요.':'';
    body.querySelector('#ifGuideCount').textContent=single?'찾은 질병 1개':(results.length+'개 검색 결과'+codeNote);
    list.innerHTML=results.length ? results.map(d=>'<button type="button" data-disease="'+d.id+'" aria-pressed="false"><strong>'+esc(d.name)+'</strong><span>'+d.grade+'급 · '+esc(d.kcd || '코드 원문 확인')+'</span></button>').join('') : '<p>검색 결과 없음</p>';
    list.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>select(results.find(d=>d.id===b.dataset.disease))));
    const selected=results.find(d=>d.id===state.selected) || (results.length===1?results[0]:null);
    if(selected)select(selected);
    else { state.selected=null; applyHost.innerHTML=''; detail.innerHTML='<div class="if-detail-card if-empty">'+(results.length?'질병을 선택해 주세요.':'목록에서 찾을 수 없습니다.<br>공식 분류를 확인해 주세요.')+'</div>'; }
  }
  query.addEventListener('input',search); grade.addEventListener('change',search);
  body.addEventListener('click',openGuideSource);
  search();
  return ()=>body.removeEventListener('click',openGuideSource);
}
function openGuideSource(event) {
  const link=event.target.closest('a[href]');
  if(link && window.electronAPI?.openExternal) { event.preventDefault(); window.electronAPI.openExternal(link.href); }
}
