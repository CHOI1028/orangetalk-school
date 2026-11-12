import { showFeedback } from './ui-feedback.js';
/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════════════════════════════
 *  감염병 유행 현황 (질병관리청_전수신고 감염병 발생현황, data.go.kr 15139178) — 2026-06-17
 *  ───────────────────────────────────────────────────────────────
 *  · 인증키: 설정 → API 관리 → 공공데이터포털 공통 인증키 (기존 개별 키도 호환)
 *  · Base: apis.data.go.kr/1790387/EIDAPIService
 *  · 사용 기능 3종:
 *      /Region     지역별 — searchType(1발생수/2 10만명당), searchYear, searchSidoCd
 *      /PeriodBasic 기간별 — searchPeriodType(1연도/2월/3주), searchStartYear, searchEndYear
 *      /Age        연령별 — searchType(1/5/10 세단위), searchYear
 *    공통: serviceKey, resType(2=json), pageNo, numOfRows
 *  · 응답: { header:{resultCode,resultMsg}, body:{ items:{ item:{}|[] }, totalCount } }
 *  · 모든 외부 호출은 메인 프로세스(externalFetchJson) 경유 → CORS/CSP 무관
 * ═══════════════════════════════════════════════════════════════ */

import { getPublicDataApiKey } from './public-data-settings.js';
import { renderDiseaseGuide } from './infectious-guide-view.js';
import { searchDiseases, normalizeDiseaseText } from './infectious-guide.js';
import { infectiousDetailStyles } from './infectious-detail-style.js';
import { cleanDiseaseLabel } from './infectious-labels.js';
import { renderAgeDistribution } from './infectious-age-view.js';
import { renderPeriodTrend } from './infectious-period-view.js';

const BASE = 'https://apis.data.go.kr/1790387/EIDAPIService';

/* 저장된 설정은 변경하지 않고 요청할 때만 Encoding/Decoding 키를 통일한다.
 * 브라우저 ESM용: shared/public-data-api-key의 서버 규칙과 동일하며 회귀 테스트로 동등성을 검증한다. */
export function normalizeInfectiousApiKey(value){
  const key=String(value==null?'':value).trim();
  try{ return /%[0-9a-f]{2}/i.test(key)?decodeURIComponent(key).trim():key; }
  catch(_){ return key; }
}
function _key(){ return normalizeInfectiousApiKey(getPublicDataApiKey('kdca')); }
function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

/* 시도코드 (정의서 기준) */
export const SIDO = [
  {cd:'00',nm:'전국'},{cd:'01',nm:'서울'},{cd:'02',nm:'부산'},{cd:'03',nm:'대구'},{cd:'04',nm:'인천'},
  {cd:'05',nm:'광주'},{cd:'06',nm:'대전'},{cd:'07',nm:'울산'},{cd:'08',nm:'경기'},{cd:'09',nm:'강원'},
  {cd:'10',nm:'충북'},{cd:'11',nm:'충남'},{cd:'12',nm:'전북'},{cd:'13',nm:'전남'},{cd:'14',nm:'경북'},
  {cd:'15',nm:'경남'},{cd:'16',nm:'제주'},{cd:'17',nm:'세종'}
];
export function sidoName(cd){ const m=SIDO.find(function(s){return s.cd===cd;}); return m?m.nm:'전국'; }

/* 설정 지역/학교주소에서 시도코드 추정 (없으면 전국 00) */
export function userSidoCd(){
  const addr=(localStorage.getItem('ec_school_address')||'');
  const region=(localStorage.getItem('ec_user_region')||localStorage.getItem('ec_weatherRegion')||'');
  const hay=addr+' '+region;
  const map=[['서울','01'],['부산','02'],['대구','03'],['인천','04'],['광주','05'],['대전','06'],['울산','07'],
    ['경기','08'],['강원','09'],['충청북도','10'],['충북','10'],['충청남도','11'],['충남','11'],
    ['전라북도','12'],['전북','12'],['전라남도','13'],['전남','13'],['경상북도','14'],['경북','14'],
    ['경상남도','15'],['경남','15'],['제주','16'],['세종','17']];
  for(let i=0;i<map.length;i++){ if(hay.indexOf(map[i][0])!==-1) return map[i][1]; }
  return '00';
}

export const INFECTIOUS_CACHE_TTL_MS=5*60*1000;

/* 오류 본문에는 인증키/URL이 포함될 수 있으므로 원문을 화면·로그에 노출하지 않는다. */
export function getInfectiousErrorMessage(result){
  const r=result||{}, code=/^\d{1,5}$/.test(String(r.code||''))?String(r.code):'';
  if(r.error==='no-key') return '설정 → API 관리에서 감염병 현황 인증키를 등록해 주세요.';
  if(r.error==='timeout'||code==='05') return '질병관리청 응답 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요.';
  if(r.error==='api'){
    if(['20','30','31','102'].includes(code)) return '질병관리청에서 인증을 거부했습니다. 등록한 인증키와 해당 서비스의 활용승인·사용기간을 확인해 주세요. (오류 '+code+')';
    if(code==='22'||code==='23') return '질병관리청 API 호출 허용량을 초과했습니다. 잠시 후 다시 조회해 주세요. (오류 '+code+')';
    return '질병관리청 API가 오류를 반환했습니다.'+(code?' (오류 '+code+')':'')+' 잠시 후 다시 조회해 주세요.';
  }
  if(r.error==='http') return '질병관리청 서버 요청이 실패했습니다.'+(Number.isInteger(r.status)?' (HTTP '+r.status+')':'')+' 잠시 후 다시 조회해 주세요.';
  if(r.error==='format') return '질병관리청 응답 형식을 확인할 수 없습니다. 잠시 후 다시 조회해 주세요.';
  if(r.error==='incomplete') return '조회 결과를 모두 받지 못했습니다. 조회 기간을 줄이거나 다시 조회해 주세요.';
  return '질병관리청에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 조회해 주세요.';
}
function _networkError(r){
  const timeout=r&&(r.errorKind==='timeout'||r.name==='TimeoutError'||r.name==='AbortError'||/timeout|timed out|시간.*초과/i.test(String(r.error||r.message||'')));
  return {error:timeout?'timeout':'fetch'};
}
function _header(j){ return (j&&j.header)||(j&&j.response&&j.response.header)||null; }
function _resultCode(j){ const h=_header(j); return h&&h.resultCode!=null?String(h.resultCode).trim():''; }
function _xmlErrorCode(text){
  const match=text.match(/<(?:[\w.-]+:)?(?:returnReasonCode|resultCode)\b[^>]*>\s*(\d{1,5})\s*<\//i);
  return match?match[1]:'';
}
/* 메인·공유웹의 기존 {success,data} 응답과 새 HTTP 메타데이터를 모두 지원한다. */
async function _fetchJson(url){
  if(!(window.electronAPI&&window.electronAPI.externalFetchJson)) return {error:'fetch'};
  try{
    const res=await window.electronAPI.externalFetchJson(url);
    const status=res&&Number.isInteger(res.status)?res.status:0;
    let data=res&&Object.prototype.hasOwnProperty.call(res,'data')?res.data:res;
    if(typeof data==='string'){
      const xmlCode=_xmlErrorCode(data);
      if(xmlCode&&xmlCode!=='00'&&xmlCode!=='0') return {error:'api',code:xmlCode};
      try{ data=JSON.parse(data); }
      catch(_){
        if(status>=400) return {error:'http',status:status};
        if(res&&res.success===false) return _networkError(res);
        return {error:'format'};
      }
    }
    const code=_resultCode(data);
    if(code&&code!=='00'&&code!=='0') return {error:'api',code:/^\d{1,5}$/.test(code)?code:''};
    if(status>=400) return {error:'http',status:status};
    if(res&&res.success===false) return _networkError(res);
    if(!data||typeof data!=='object'||!_body(data)) return {error:'format'};
    return {data:data};
  }catch(e){ return _networkError(e); }
}
function _body(j){ return (j&&j.body) || (j&&j.response&&j.response.body) || null; }
function _items(j){
  const b=_body(j); if(!b) return [];
  let it=b.items&&(b.items.item!=null?b.items.item:b.items);
  if(it==null) it=b.item;
  if(it==null||it==='') return [];
  return Array.isArray(it)?it:[it];
}
function _count(value){
  const s=String(value==null?'':value).trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) return null;
  const n=Number(s.replace(/,/g,''));
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function _mapRow(r){
  return {
    icdGroupNm:String(r.icdGroupNm||'').trim(), icdNm:cleanDiseaseLabel(r.icdNm),
    val:_count(r.resultVal),
    year:String(r.year||r.period||'').trim(), sidoNm:String(r.sidoNm||'').trim(),
    sidoCd:r.sidoCd==null?'':String(r.sidoCd).trim().padStart(2,'0'),
    ageRange:String(r.ageRange||'').trim(), period:String(r.period||'').trim()
  };
}

const _cache=new Map(), _pending=new Map();
let _cacheCredential='', _cacheEpoch=0;
export function clearInfectiousCache(){ _cache.clear(); _pending.clear(); _cacheEpoch++; }
/* 이 식별자는 메모리에서만 사용한다. DOM, 로그, 영구 저장소에 기록하지 않는다. */
export function getInfectiousRequestKey(year,sidoCd){ return JSON.stringify([_key(),String(year),String(sidoCd||'00').padStart(2,'0')]); }
async function _call(op, params, rows, options){
  const key=_key();
  if(key!==_cacheCredential){ clearInfectiousCache(); _cacheCredential=key; }
  if(!key) return {error:'no-key'};
  const cacheKey=JSON.stringify([op,params]), force=!!(options&&options.force);
  const cached=_cache.get(cacheKey);
  if(!force&&cached&&Date.now()-cached.at<INFECTIOUS_CACHE_TTL_MS) return cached.result;
  if(!force&&_pending.has(cacheKey)) return _pending.get(cacheKey);
  if(force) _cache.delete(cacheKey);
  const epoch=_cacheEpoch;
  const task=(async function(){
    const all=[], seenPages=new Set();
    for(let page=1;page<=20;page++){
      let url=BASE+op+'?serviceKey='+encodeURIComponent(key)+'&resType=2&pageNo='+page+'&numOfRows='+(rows||200);
      Object.keys(params).forEach(function(k){ if(params[k]!=null&&params[k]!=='') url+='&'+k+'='+encodeURIComponent(params[k]); });
      const response=await _fetchJson(url);
      if(response.error) return response;
      const j=response.data, items=_items(j), body=_body(j);
      if(items.some(function(r){return !r||typeof r!=='object'||Array.isArray(r);} )) return {error:'format'};
      const total=body.totalCount==null?null:_count(body.totalCount);
      if(items.length){
        const signature=JSON.stringify(items);
        if(seenPages.has(signature)) return {error:'incomplete'};
        seenPages.add(signature);
        all.push.apply(all,items.map(_mapRow));
      }
      if((total!=null&&all.length>=total)||(total==null&&items.length<(rows||200))) return {rows:all};
      if(!items.length) return {error:'incomplete'};
    }
    return {error:'incomplete'};
  })();
  _pending.set(cacheKey,task);
  try{
    const result=await task;
    if(!result.error&&epoch===_cacheEpoch&&key===_key()&&_pending.get(cacheKey)===task){
      _cache.set(cacheKey,{at:Date.now(),result:result});
      if(_cache.size>24) _cache.delete(_cache.keys().next().value);
    }
    return result;
  }finally{ if(_pending.get(cacheKey)===task) _pending.delete(cacheKey); }
}

function _sidoCode(row){
  if(SIDO.some(function(s){return s.cd===row.sidoCd;})) return row.sidoCd;
  const aliases={'서울특별시':'01','부산광역시':'02','대구광역시':'03','인천광역시':'04','광주광역시':'05','대전광역시':'06','울산광역시':'07','경기도':'08','강원도':'09','강원특별자치도':'09','충청북도':'10','충청남도':'11','전라북도':'12','전북특별자치도':'12','전라남도':'13','경상북도':'14','경상남도':'15','제주특별자치도':'16','세종특별자치시':'17'};
  const name=String(row.sidoNm||'').trim();
  const found=SIDO.find(function(s){return s.nm===name;});
  return found?found.cd:aliases[name]||'';
}

/* 공개 fetchers */
export async function fetchRegion(year, sidoCd, options){
  const code=String(sidoCd||'00').padStart(2,'0');
  const result=await _call('/Region', {searchType:1, searchYear:year, searchSidoCd:code}, 300, options);
  if(result.error) return result;
  /* 지역 조회에도 전국 합계가 함께 오므로 선택 지역만 남겨 중복 합산을 막는다. */
  return {rows:result.rows.filter(function(r){return _sidoCode(r)===code;})};
}
export async function fetchPeriod(startYear, endYear, periodType, options){ return _call('/PeriodBasic', {searchPeriodType:periodType, searchStartYear:startYear, searchEndYear:endYear}, 500, options); }
export async function fetchAge(year, unit, options){ return _call('/Age', {searchType:unit, searchYear:year}, 1500, options); }

/* 위젯용 — 설정 지역의 올해(또는 지정연도) 상위 감염병 발생수 */
export async function getRegionTop(year, sidoCd, topN, options){
  const r=await fetchRegion(year, sidoCd, options);
  if(r.error) return r;
  const seen=Object.create(null), list=[];
  r.rows.forEach(function(x){
    if(!x.icdNm || x.val<=0) return;
    if(seen[x.icdNm]!=null){ list[seen[x.icdNm]].val+=x.val; return; }   /* 같은 병명(급 다른 경우) 합산 */
    seen[x.icdNm]=list.length; list.push({icdNm:x.icdNm, val:x.val, grp:x.icdGroupNm});
  });
  list.sort(function(a,b){ return b.val-a.val; });
  return {rows:list.slice(0, topN||5), sidoNm:sidoName(sidoCd), year:year};
}

/* 자세히 보기: dashboard layout and API transport stay unchanged. */
let _tab='region';
let _queryEpoch=0;
let _closeModal=null, _guideCleanup=null, _modalOptions={}, _guideState={}, _filters={}, _statQuery='';
let _ageState={}, _periodState={};
function _curYear(){ return new Date().getFullYear(); }

export function showInfectiousModal(options={}){
  if(_closeModal)_closeModal();
  _tab=options.initialTab==='guide'?'guide':'region';
  _modalOptions=options; _guideState={query:cleanDiseaseLabel(options.query)}; _filters={}; _statQuery=''; _ageState={}; _periodState={};
  const previousFocus=document.activeElement;
  const ov=document.createElement('div');
  ov.id='infectOverlay';
  ov.innerHTML='<style>'+infectiousDetailStyles+'</style><div id="infectBox" role="dialog" aria-modal="true" aria-labelledby="infectTitle" tabindex="-1">'
    +'<header><h2 id="infectTitle">감염병 현황 · 질병 안내</h2><button type="button" id="infectClose" aria-label="감염병 상세 닫기">닫기</button></header>'
    +'<div class="if-tabs" aria-label="감염병 조회 종류">'
    +['region','period','age','guide'].map(t=>'<button type="button" data-itab="'+t+'" aria-pressed="false">'+({region:'지역별 발생',period:'기간별 추이',age:'연령별 분포',guide:'질병 검색·안내'}[t])+'</button>').join('')+'</div>'
    +'<div id="infectCtrl"></div><div id="infectBody"></div></div>';
  document.body.appendChild(ov);
  const close=function(){
    ++_queryEpoch; if(_guideCleanup){_guideCleanup();_guideCleanup=null;}
    document.removeEventListener('keydown',onKey,true); ov.remove(); _closeModal=null;
    _modalOptions={}; if(previousFocus?.isConnected)previousFocus.focus();
  };
  const onKey=function(e){
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}
    else if(e.key==='Tab'){
      const focusables=Array.from(ov.querySelectorAll('button:not([disabled]),input:not([disabled]),select,a[href]')).filter(el=>el.getClientRects().length);
      const first=focusables[0],last=focusables[focusables.length-1];
      if(e.shiftKey&&(document.activeElement===first||!focusables.includes(document.activeElement))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!focusables.includes(document.activeElement))){e.preventDefault();first?.focus();}
    }
  };
  _closeModal=close; document.addEventListener('keydown',onKey,true);
  ov._onModalClose=close;
  // Keep table shortcuts in the underlying workspace from consuming dialog keys.
  ov.addEventListener('keydown',e=>e.stopPropagation());
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  document.getElementById('infectClose').addEventListener('click',close);
  ov.querySelectorAll('[data-itab]').forEach(b=>b.addEventListener('click',()=>_switchTab(b.dataset.itab)));
  _renderTab(); document.getElementById('infectBox').focus();
}

function _switchTab(tab){
  const ctrl=document.getElementById('infectCtrl');
  if(ctrl)ctrl.querySelectorAll('select').forEach(el=>{_filters[el.id]=el.value;});
  _tab=tab; _renderTab();
}

function _selCss(){ return 'font-size:12px;padding:5px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1);font-family:var(--f)'; }
function _yearOpts(sel){ let o=''; const cy=_curYear(); for(let y=cy;y>=cy-3;y--){ o+='<option value="'+y+'"'+(y===sel?' selected':'')+'>'+y+'년</option>'; } return o; }

function _renderTab(){
  const ctrl=document.getElementById('infectCtrl'), body=document.getElementById('infectBody');
  if(!ctrl||!body) return;
  ++_queryEpoch; if(_guideCleanup){_guideCleanup();_guideCleanup=null;}
  body.setAttribute('aria-busy','false'); body.scrollTop=0;
  document.getElementById('infectBox').dataset.view=_tab;
  document.querySelectorAll('#infectOverlay [data-itab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.itab===_tab)));
  ctrl.hidden=_tab==='guide';
  if(_tab==='guide'){
    ctrl.innerHTML='';
    _guideCleanup=renderDiseaseGuide(body,_guideState,{..._modalOptions,onStatistics:name=>{_statQuery=name;_switchTab('region');}});
    return;
  }
  if(!_key()){ ctrl.innerHTML=''; body.innerHTML='<div class="if-note">발생 통계를 조회하려면 설정 → API 관리에 기존 공공데이터 인증키를 등록해 주세요.<br>질병 검색·안내는 인증키 없이 사용할 수 있습니다.</div><button type="button" id="ifOfflineGuide">질병 검색·안내 열기</button>'; body.querySelector('#ifOfflineGuide').addEventListener('click',()=>_switchTab('guide')); return; }
  if(_tab==='region'){
    let sidoOpts=''; const us=userSidoCd();
    SIDO.forEach(function(s){ sidoOpts+='<option value="'+s.cd+'"'+(s.cd===us?' selected':'')+'>'+s.nm+'</option>'; });
    ctrl.innerHTML='<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">연도<select id="ifYear" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">지역(시도)<select id="ifSido" style="'+_selCss()+'">'+sidoOpts+'</select></label>'
      +'<button id="ifGo" style="padding:7px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">조회</button>';
    document.getElementById('ifGo').addEventListener('click',function(){ _runRegion(true); });
  } else if(_tab==='period'){
    ctrl.innerHTML='<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">기간분류<select id="ifPt" style="'+_selCss()+'"><option value="1">연도별</option><option value="2" selected>월별</option><option value="3">주별</option></select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">시작연도<select id="ifSy" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">종료연도<select id="ifEy" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<button id="ifGo" style="padding:7px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">조회</button>';
    document.getElementById('ifGo').addEventListener('click',function(){ _runPeriod(true); });
  } else {
    ctrl.innerHTML='<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">연도<select id="ifYear" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">연령단위<select id="ifUnit" style="'+_selCss()+'"><option value="10" selected>10세</option><option value="5">5세</option><option value="1">1세</option></select></label>'
      +'<button id="ifGo" style="padding:7px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">조회</button>';
    document.getElementById('ifGo').addEventListener('click',function(){ _runAge(true); });
  }
  ctrl.querySelectorAll('select').forEach(el=>{if(_filters[el.id]!=null)el.value=_filters[el.id];});
  ctrl.querySelectorAll('label,select').forEach(el=>el.removeAttribute('style'));
  const go=document.getElementById('ifGo'); go.removeAttribute('style');go.className='if-primary';go.type='button';go.textContent='조회';
  ({region:_runRegion,period:_runPeriod,age:_runAge}[_tab])();
}

function _tableHtml(headers, rows){
  let h='<table class="if-data-table"><thead><tr>';
  headers.forEach(function(hd){ h+='<th>'+_esc(hd)+'</th>'; });
  h+='</tr></thead><tbody>';
  rows.forEach(function(r){ h+='<tr>'+r.map(function(c){ return '<td>'+_esc(c)+'</td>'; }).join('')+'</tr>'; });
  h+='</tbody></table>';
  return h;
}
function _loading(){showFeedback('infectBody',{kind:'loading',title:'감염병 현황을 조회하고 있습니다'});}
function _infectFeedback(body,result){
  showFeedback(body,result ? {kind:'error',title:'감염병 현황을 불러오지 못했습니다',description:getInfectiousErrorMessage(result),actionLabel:'다시 조회',onAction:()=>{const button=document.getElementById('ifGo');if(button)button.click();}}
    : {kind:'empty',title:'해당 조건의 발생 자료가 없습니다',description:'연도·지역·조회 기간을 바꿔 다시 조회해 주세요.'});
}
function _beginQuery(){
  const query={epoch:++_queryEpoch,body:document.getElementById('infectBody'),key:_key()};
  _loading();
  return query;
}
function _queryBody(query){
  const current=query.epoch===_queryEpoch&&query.key===_key()&&document.getElementById('infectBody')===query.body?query.body:null;
  if(current)current.setAttribute('aria-busy','false');
  return current;
}

async function _runRegion(force){
  const query=_beginQuery();
  const y=(document.getElementById('ifYear')||{}).value||_curYear();
  const sido=(document.getElementById('ifSido')||{}).value||'00';
  const r=await fetchRegion(y, sido, {force:force===true});
  const body=_queryBody(query); if(!body) return;
  if(r.error){ _infectFeedback(body,r); return; }
  const agg=Object.create(null);
  r.rows.forEach(function(x){
    if(!x.icdNm)return;
    if(!Object.prototype.hasOwnProperty.call(agg,x.icdNm))agg[x.icdNm]=x.val;
    else agg[x.icdNm]=agg[x.icdNm]==null||x.val==null?null:agg[x.icdNm]+x.val;
  });
  const list=Object.keys(agg).map(function(k){return [k,agg[k]];}).sort(function(a,b){return (b[1]??-1)-(a[1]??-1)||a[0].localeCompare(b[0],'ko');});
  if(!list.length){ _infectFeedback(body,null); return; }
  _renderStatistics(body, list.map(x=>({name:x[0],value:x[1],cells:[x[0],_formatCount(x[1])]})),
    ['감염병명','발생수(명)'],sidoName(sido)+' · '+y+'년 · 발생수 많은 순');
}
async function _runPeriod(force){
  const query=_beginQuery();
  const pt=(document.getElementById('ifPt')||{}).value||'2';
  const sy=(document.getElementById('ifSy')||{}).value||_curYear();
  const ey=(document.getElementById('ifEy')||{}).value||_curYear();
  if(Number(sy)>Number(ey)){
    const body=_queryBody(query); if(body) body.textContent='시작연도는 종료연도보다 늦을 수 없습니다.';
    return;
  }
  const r=await fetchPeriod(sy, ey, pt, {force:force===true});
  const body=_queryBody(query); if(!body) return;
  if(r.error){ _infectFeedback(body,r); return; }
  const rows=r.rows.filter(x=>x.icdNm);
  if(!rows.length){ _infectFeedback(body,null); return; }
  renderPeriodTrend(body,rows,_periodState,{startYear:sy,endYear:ey,type:pt,initialQuery:_statQuery,onGuide:name=>{
    _guideState.query=cleanDiseaseLabel(name);_guideState.grade='';_guideState.selected=null;_switchTab('guide');
  }});
}
async function _runAge(force){
  const query=_beginQuery();
  const y=(document.getElementById('ifYear')||{}).value||_curYear();
  const unit=(document.getElementById('ifUnit')||{}).value||'10';
  const r=await fetchAge(y, unit, {force:force===true});
  const body=_queryBody(query); if(!body) return;
  if(r.error){ _infectFeedback(body,r); return; }
  const rows=r.rows.filter(x=>x.icdNm&&x.ageRange&&!['계','합계','전체'].includes(x.ageRange))
    .sort((a,b)=>a.icdNm.localeCompare(b.icdNm,'ko')||a.ageRange.localeCompare(b.ageRange,'ko',{numeric:true}));
  if(!rows.length){_infectFeedback(body,null);return;}
  renderAgeDistribution(body,rows,_ageState,{year:y,unit,initialQuery:_statQuery,onGuide:name=>{
    _guideState.query=cleanDiseaseLabel(name);_guideState.grade='';_guideState.selected=null;_switchTab('guide');
  }});
}

function _formatCount(value){return value==null?'자료 없음':value.toLocaleString();}
function _renderStatistics(body,rows,headers,context){
  const note='<div class="if-context"><div><span class="if-eyebrow">질병관리청 발생 통계</span><h3>'+_esc(context)+'</h3></div></div>';
  body.innerHTML=note+'<div class="if-age-layout"><aside class="if-age-picker"><label>질병 찾기<input id="ifStatQuery" placeholder="질병명·별칭·KCD 코드" value="'+_esc(_statQuery)+'"></label>'
    +'<button type="button" id="ifStatGuide">질병 안내 보기 ↗</button></aside><section id="ifStatResults" aria-label="질병별 발생수"></section></div>';
  const input=body.querySelector('#ifStatQuery'), results=body.querySelector('#ifStatResults');
  // Also supports text-only renderers used by the transport regression tests.
  if(!input||!results){body.innerHTML=note+_tableHtml(headers,rows.map(x=>x.cells));return;}
  let page=0;
  function draw(){
    const q=normalizeDiseaseText(_statQuery), names=new Set(searchDiseases(_statQuery).map(d=>normalizeDiseaseText(d.name)));
    const filtered=rows.filter(r=>!q||normalizeDiseaseText(r.name).includes(q)||names.has(normalizeDiseaseText(r.name)));
    const pages=Math.max(1,Math.ceil(filtered.length/15)); page=Math.min(page,pages-1);
    const visible=filtered.slice(page*15,(page+1)*15),max=Math.max(0,...filtered.map(r=>r.value??0));
    results.innerHTML='<div class="if-metrics" role="status"><div><span>조회 질병</span><strong>'+filtered.length+'<small>개</small></strong></div><div><span>발생 기록 있음</span><strong>'+filtered.filter(r=>r.value>0).length+'<small>개 질병</small></strong></div><div><span>자료 없음</span><strong>'+filtered.filter(r=>r.value==null).length+'<small>개</small></strong></div></div>'
      +(visible.length?'<div class="if-chart-legend"><span>질병 · 발생수 많은 순</span><span>발생수(명)</span></div><div class="if-region-bars" role="list">'+visible.map((r,i)=>'<div class="if-bar-row'+(r.value===max&&max>0?' is-peak':'')+'" role="listitem"><button type="button" data-region-guide="'+i+'">'+_esc(cleanDiseaseLabel(r.name))+'</button><div class="if-bar-track" aria-hidden="true"><i style="width:'+(max&&r.value!=null?100*r.value/max:0)+'%"></i></div><span class="if-bar-value">'+_formatCount(r.value)+(r.value==null?'':'명')+'</span></div>').join('')+'</div>':'<p class="if-empty">일치하는 발생 자료가 없습니다.</p>')
      +(pages>1?'<div class="if-pager"><button type="button" data-page="-1"'+(page===0?' disabled':'')+'>이전</button><span>'+(page+1)+' / '+pages+'</span><button type="button" data-page="1"'+(page+1>=pages?' disabled':'')+'>다음</button></div>':'')
      +(visible.length?'<details class="if-source-note"><summary>표로 자세히 보기</summary><div class="if-table-wrap">'+_tableHtml(headers,visible.map(r=>r.cells))+'</div></details>':'');
    results.querySelectorAll('[data-region-guide]').forEach(button=>button.addEventListener('click',()=>{
      _guideState.query=cleanDiseaseLabel(visible[Number(button.dataset.regionGuide)].name);_guideState.grade='';_guideState.selected=null;_switchTab('guide');
    }));
    results.querySelectorAll('tbody tr').forEach((tr,i)=>{
      const index=headers.indexOf('감염병명'), td=tr.children[index];
      if(!td)return;
      const button=document.createElement('button'); button.type='button'; button.textContent=cleanDiseaseLabel(visible[i].name);
      button.addEventListener('click',()=>{_guideState.query=cleanDiseaseLabel(visible[i].name);_guideState.grade='';_guideState.selected=null;_switchTab('guide');});
      td.replaceChildren(button);
    });
    results.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page+=Number(b.dataset.page);draw();}));
  }
  input.addEventListener('input',()=>{_statQuery=input.value;page=0;draw();});
  body.querySelector('#ifStatGuide').addEventListener('click',()=>{_guideState.query=cleanDiseaseLabel(input.value);_guideState.grade='';_guideState.selected=null;_switchTab('guide');});
  draw();
}
