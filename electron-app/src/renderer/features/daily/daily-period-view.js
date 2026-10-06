/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 기간 조회는 S.records를 교체하지 않는다. 클릭한 과거 기록만 별도 편집 캐시에 연결한다. */
import { S } from '../../core/app-state.js';
import { bus } from '../../core/event-bus.js';
import { escHtml, toDateStr } from '../../core/format-utils.js';
import { renderDailyPeriodTable } from './daily-view.js';
import { preparePeriodRecord, getPeriodEditRecords } from '../../core/daily-record-access.js';
import { validatePeriodRange, reconcilePeriodRecords, summarizePeriodRecords, periodRecordText } from './daily-period-data.js';

const PAGE_SIZE=100;
const EDIT_CONTROLS=['dailySearchInput','dailyAdvSearchBtn','dailyColSelectorBtn','dailySortAscBtn','dailySortDescBtn','dailyDiaryPrintBtn','dailyVisitPassBtn','dailyTodayMemoBtn'];
let _active=false, _panel=null, _request=0, _range=null, _rows=[], _loading=false, _error='', _page=0, _kind='all';
let _refreshTimer=null, _refreshAfterLoad=false;
const _disabled=new Map();
const el=id=>document.getElementById(id);

export function isDailyPeriodSearchActive(){return _active;}

export function initDailyPeriodSearch(){
  const panel=el('dailyPeriodPanel'), button=el('dailyPeriodSearchBtn');
  if(!panel||!button||panel===_panel)return;
  if(_active)closeDailyPeriodSearch(false);
  _panel=panel;
  button.setAttribute('aria-controls','dailyPeriodPanel');
  button.setAttribute('aria-expanded','false');
  panel.innerHTML='<form class="daily-period-form" novalidate>'
    +'<label>시작일<input id="dailyPeriodFrom" type="date" data-no-auto-save required></label>'
    +'<span class="daily-period-separator">~</span>'
    +'<label>종료일<input id="dailyPeriodTo" type="date" data-no-auto-save required></label>'
    +'<button type="submit" class="btn btn-primary">조회</button>'
    +'<button type="button" data-period-action="month" class="btn">이번 달</button>'
    +'<button type="button" data-period-action="year" class="btn">이번 학년도</button>'
    +'<button type="button" data-period-action="close" class="btn daily-period-close">기간검색 해제</button>'
    +'</form>'
    +'<div id="dailyPeriodStatus" class="daily-period-status" role="status" aria-live="polite"></div>'
    +'<div id="dailyPeriodSummary" class="daily-period-summary"></div>'
    +'<div class="daily-period-tools"><label>표시할 기록 <select id="dailyPeriodKind" data-no-auto-save>'
    +'<option value="all">전체 방문</option><option value="counsel">상담 기록</option><option value="treatment">처치 기록</option>'
    +'</select></label><span>증상·처치·입퇴실 시간은 기존 보건일지처럼 클릭하여 수정할 수 있습니다.</span></div>'
    +'<div id="dailyPeriodResults" class="daily-period-results"></div>'
    +'<div id="dailyPeriodPages" class="daily-period-pages"></div>';
  button.addEventListener('click',function(){if(_active)closeDailyPeriodSearch();else openDailyPeriodSearch();});
  panel.querySelector('form').addEventListener('submit',function(event){event.preventDefault();_submitRange();});
  panel.addEventListener('click',function(event){
    const target=event.target.closest('[data-period-action]');
    if(!target||!panel.contains(target))return;
    const action=target.dataset.periodAction;
    if(action==='close'){closeDailyPeriodSearch();return;}
    if(action==='month'||action==='year'){
      const today=new Date(), to=toDateStr(today);
      const year=action==='year'&&today.getMonth()<2?today.getFullYear()-1:today.getFullYear();
      el('dailyPeriodFrom').value=action==='month'?to.slice(0,7)+'-01':year+'-03-01';
      el('dailyPeriodTo').value=to;
      _submitRange();return;
    }
    if(action==='prev'&&_page>0){_page--;_renderResults();el('dailyPeriodResults').scrollTop=0;}
    if(action==='next'){_page++;_renderResults();el('dailyPeriodResults').scrollTop=0;}
  });
  el('dailyPeriodKind').addEventListener('change',function(){
    _kind=this.value;_page=0;_renderResults();el('dailyPeriodResults').scrollTop=0;
  });
}

export function openDailyPeriodSearch(){
  initDailyPeriodSearch();
  if(!_panel||_active)return;
  _active=true;_rows=[];_range=null;_error='';_page=0;_kind='all';
  const selected=validatePeriodRange(S.selectedDate,S.selectedDate)?toDateStr(new Date()):S.selectedDate;
  el('dailyPeriodFrom').value=selected.slice(0,7)+'-01';
  el('dailyPeriodTo').value=selected;
  el('dailyPeriodKind').value='all';
  _panel.hidden=false;
  el('dailyCat-general').classList.add('daily-period-active');
  el('dailyPeriodSearchBtn').setAttribute('aria-expanded','true');
  EDIT_CONTROLS.forEach(function(id){const control=el(id);if(control){_disabled.set(control,control.disabled);control.disabled=true;}});
  const suggestions=el('dailyACList');if(suggestions)suggestions.innerHTML='';
  bus.emit('daily:period-open');
  _renderResults();
  el('dailyPeriodFrom').focus();
}

export function closeDailyPeriodSearch(notify=true){
  if(!_active)return false;
  _active=false;_request++;_range=null;_rows=[];_loading=false;_error='';_refreshAfterLoad=false;
  if(_refreshTimer!==null){clearTimeout(_refreshTimer);_refreshTimer=null;}
  if(_panel)_panel.hidden=true;
  const general=el('dailyCat-general');if(general)general.classList.remove('daily-period-active');
  const button=el('dailyPeriodSearchBtn');if(button)button.setAttribute('aria-expanded','false');
  _disabled.forEach(function(value,control){control.disabled=value;});_disabled.clear();
  if(notify){bus.emit('render:daily');if(button)button.focus();}
  return true;
}

function _submitRange(){
  const from=el('dailyPeriodFrom').value, to=el('dailyPeriodTo').value;
  const error=validatePeriodRange(from,to);
  if(error){
    /* 잘못된 새 입력을 이전 기간 결과인 것처럼 표시하지 않는다. */
    _request++;_loading=false;_range=null;_rows=[];_error=error;_renderResults();return;
  }
  _range={from,to};_page=0;_rows=[];_loadRange();
}

async function _loadRange(){
  if(!_active||!_range)return;
  if(_refreshTimer!==null){clearTimeout(_refreshTimer);_refreshTimer=null;}
  const range={..._range}, request=++_request;
  _loading=true;_error='';_refreshAfterLoad=false;_renderResults();
  try{
    const api=window.electronAPI;
    if(!api||typeof api.recordsDailyByDateRange!=='function')throw new Error('조회 연결 없음');
    const response=await api.recordsDailyByDateRange(range.from,range.to);
    if(!_active||request!==_request)return;
    if(!response||response.success!==true||!Array.isArray(response.data))throw new Error('기간 조회 실패');
    _rows=reconcilePeriodRecords(response.data,[...(S.records||[]),...getPeriodEditRecords()],range.from,range.to);
  }catch(error){
    if(!_active||request!==_request)return;
    _rows=[];
    _error='기록을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요. 기존 기록은 변경되지 않았습니다.';
  }finally{
    if(_active&&request===_request){
      _loading=false;_renderResults();
      if(_refreshAfterLoad){_refreshAfterLoad=false;refreshDailyPeriodSearch();}
    }
  }
}

/* 협업 갱신·저장 후 render:daily에서도 재조회. 조회 결과를 전역 편집 배열에 섞지 않는다. */
export function refreshDailyPeriodSearch(){
  if(!_active)return;
  _renderResults();
  if(!_range)return;
  if(_loading){_refreshAfterLoad=true;return;}
  if(_refreshTimer!==null)clearTimeout(_refreshTimer);
  _refreshTimer=setTimeout(function(){_refreshTimer=null;_loadRange();},200);
}

function _beforeRecordAction(event){
  if(event.target.closest('[data-action="dailyDeleteRecord"]'))return false;
  if(!event.target.closest('[data-action],td[data-col-index="6"],td[data-col-index="8"]'))return false;
  const row=event.target.closest('tr[data-rec-id]');
  if(!row)return false;
  let privacy=false;try{privacy=localStorage.getItem('ec_privacy_mode')==='1';}catch(_){}
  if(privacy)return false;
  const record=_rows.find(item=>String(item.id)===row.dataset.recId);
  if(!record||!preparePeriodRecord(record)){
    bus.emit('toast:show',{text:'기록을 편집할 수 없습니다. 저장이 끝난 뒤 다시 조회해 주세요.'});
    return false;
  }
  return true;
}

function _renderResults(){
  if(!_active||!_panel)return;
  const status=el('dailyPeriodStatus'), summary=el('dailyPeriodSummary'), results=el('dailyPeriodResults'), pages=el('dailyPeriodPages');
  const submit=_panel.querySelector('button[type="submit"]');
  submit.textContent=_loading?'다시 조회':'조회';
  _panel.setAttribute('aria-busy',String(_loading));
  status.classList.toggle('is-error',!!_error);
  status.textContent=_error||(_loading?'선택한 기간의 기록을 불러오는 중입니다…':_range?_range.from+' ~ '+_range.to:'시작일과 종료일을 선택한 뒤 조회를 눌러 주세요.');
  if(_loading||_error||!_range){summary.innerHTML='';results.innerHTML='';pages.innerHTML='';return;}
  const totals=summarizePeriodRecords(_rows);
  summary.innerHTML=[['전체 방문',totals.visits,'건'],['상담 기록',totals.counsel,'건'],['처치 기록',totals.treatment,'건'],['이용 인원',totals.people,'명']]
    .map(function(item){return '<span>'+item[0]+' <strong>'+item[1]+'</strong>'+item[2]+'</span>';}).join('')
    +'<small>방문 1회는 1건이며, 같은 사람의 재방문은 별도 건수입니다. 상담·처치는 해당 내용이 있는 기록을 각각 1건으로 세며 서로 중복될 수 있습니다. 미등록 인원은 기록별로 계산합니다.</small>';
  const rows=_rows.filter(function(record){
    if(_kind==='all')return true;
    const texts=periodRecordText(record);
    return _kind==='counsel'?!!texts.counsel:!!(texts.treatment||texts.medication);
  });
  let privacy=false;try{privacy=localStorage.getItem('ec_privacy_mode')==='1';}catch(_){}
  if(privacy)status.textContent+=' · 개인정보 보호 모드: 이름과 상세 내용 숨김';
  if(!rows.length){results.innerHTML='<div class="daily-period-empty">선택한 기간과 조건에 해당하는 기록이 없습니다.</div>';pages.innerHTML='';return;}
  const pageCount=Math.ceil(rows.length/PAGE_SIZE);
  _page=Math.max(0,Math.min(_page,pageCount-1));
  const start=_page*PAGE_SIZE, shown=rows.slice(start,start+PAGE_SIZE);
  renderDailyPeriodTable(results,shown,privacy,_beforeRecordAction);
  pages.innerHTML='<span>'+rows.length+'건 중 '+(start+1)+'–'+(start+shown.length)+'건 · 최신 날짜순</span>'
    +'<button type="button" class="btn" data-period-action="prev" '+(_page===0?'disabled':'')+'>이전</button>'
    +'<span>'+(_page+1)+' / '+pageCount+'</span>'
    +'<button type="button" class="btn" data-period-action="next" '+(_page===pageCount-1?'disabled':'')+'>다음</button>';
}
