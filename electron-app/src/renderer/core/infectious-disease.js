/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════════════════════════════
 *  감염병 유행 현황 (질병관리청_전수신고 감염병 발생현황, data.go.kr 15139178) — 2026-06-17
 *  ───────────────────────────────────────────────────────────────
 *  · 인증키: localStorage ec_kdca_api_key (설정 → API 관리 → 🦠 감염병 현황(질병관리청))
 *  · Base: apis.data.go.kr/1790387/EIDAPIService
 *  · 사용 기능 3종:
 *      /Region     지역별 — searchType(1발생수/2 10만명당), searchYear, searchSidoCd
 *      /PeriodBasic 기간별 — searchPeriodType(1연도/2월/3주), searchStartYear, searchEndYear
 *      /Age        연령별 — searchType(1/5/10 세단위), searchYear
 *    공통: serviceKey, resType(2=json), pageNo, numOfRows
 *  · 응답: { header:{resultCode,resultMsg}, body:{ items:{ item:{}|[] }, totalCount } }
 *  · 모든 외부 호출은 메인 프로세스(externalFetchJson) 경유 → CORS/CSP 무관
 * ═══════════════════════════════════════════════════════════════ */

const BASE = 'https://apis.data.go.kr/1790387/EIDAPIService';

/* 저장된 설정은 변경하지 않고 요청할 때만 Encoding/Decoding 키를 통일한다.
 * 브라우저 ESM용: shared/public-data-api-key의 서버 규칙과 동일하며 회귀 테스트로 동등성을 검증한다. */
export function normalizeInfectiousApiKey(value){
  const key=String(value==null?'':value).trim();
  try{ return /%[0-9a-f]{2}/i.test(key)?decodeURIComponent(key).trim():key; }
  catch(_){ return key; }
}
function _key(){ return normalizeInfectiousApiKey(localStorage.getItem('ec_kdca_api_key')); }
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
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) return 0;
  const n=Number(s.replace(/,/g,''));
  return Number.isSafeInteger(n)&&n>=0?n:0;
}
function _mapRow(r){
  return {
    icdGroupNm:String(r.icdGroupNm||'').trim(), icdNm:String(r.icdNm||'').trim(),
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

/* ════════════ 자세히 모달 (지역별/기간별/연령별 3탭) ════════════ */
let _tab='region';
let _queryEpoch=0;
function _curYear(){ return new Date().getFullYear(); }

export function showInfectiousModal(){
  const old=document.getElementById('infectOverlay'); if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='infectOverlay';
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.34);z-index:13050;opacity:0;transition:opacity 0.15s';
  ov.innerHTML='<div id="infectBox" style="background:var(--card);border-radius:14px;width:580px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.34);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.97);transition:opacity 0.18s,transform 0.18s">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(239,68,68,0.10),rgba(168,85,247,0.06));display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:18px">🦠</span><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">감염병 유행 현황</div><div style="font-size:10.5px;color:var(--t3)">질병관리청 전수신고 감염병 발생현황</div></div>'
      +'</div>'   /* X 닫기 제거 — 바깥 클릭으로 닫음 (사용자 요청 2026-06-17) */
    +'<div style="display:flex;border-bottom:1px solid var(--bdr)">'
      +['region','period','age'].map(function(t){ const nm={region:'지역별',period:'기간별',age:'연령별'}[t]; return '<button data-itab="'+t+'" type="button" style="flex:1;padding:10px 0;border:none;background:'+(t===_tab?'rgba(239,68,68,0.08)':'var(--card)')+';color:'+(t===_tab?'#ef4444':'var(--t2)')+';font-weight:'+(t===_tab?'800':'600')+';cursor:pointer;font-size:12px;font-family:var(--f);border-bottom:2px solid '+(t===_tab?'#ef4444':'transparent')+'">'+nm+'</button>'; }).join('')
    +'</div>'
    +'<div id="infectCtrl" style="padding:12px 18px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;border-bottom:1px solid var(--bdr)"></div>'
    +'<div id="infectBody" style="padding:14px 18px;overflow-y:auto;flex:1 1 auto;font-size:12px;color:var(--t2)"></div>'
    +'</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function(){ ov.style.opacity='1'; const b=document.getElementById('infectBox'); if(b){b.style.opacity='1';b.style.transform='scale(1)';} });
  const close=function(){ ov.style.opacity='0'; const b=document.getElementById('infectBox'); if(b){b.style.opacity='0';b.style.transform='scale(0.97)';} setTimeout(function(){ if(ov.parentNode)ov.parentNode.removeChild(ov); },180); };
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)close(); });
  { const _ic=document.getElementById('infectClose'); if(_ic)_ic.addEventListener('click',close); }
  ov.querySelectorAll('[data-itab]').forEach(function(b){ b.addEventListener('click',function(){ _tab=b.getAttribute('data-itab'); showInfectiousModal(); }); });
  _renderTab();
}

function _selCss(){ return 'font-size:12px;padding:5px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1);font-family:var(--f)'; }
function _yearOpts(sel){ let o=''; const cy=_curYear(); for(let y=cy;y>=cy-3;y--){ o+='<option value="'+y+'"'+(y===sel?' selected':'')+'>'+y+'년</option>'; } return o; }

function _renderTab(){
  const ctrl=document.getElementById('infectCtrl'), body=document.getElementById('infectBody');
  if(!ctrl||!body) return;
  if(!_key()){ ctrl.innerHTML=''; body.innerHTML='<div style="color:var(--t2);line-height:1.9">질병관리청 인증키가 없습니다.<br><b>설정 → API 관리 → 🦠 감염병 현황(질병관리청)</b> 에 인증키를 등록해 주세요.</div>'; return; }
  if(_tab==='region'){
    let sidoOpts=''; const us=userSidoCd();
    SIDO.forEach(function(s){ sidoOpts+='<option value="'+s.cd+'"'+(s.cd===us?' selected':'')+'>'+s.nm+'</option>'; });
    ctrl.innerHTML='<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">연도<select id="ifYear" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">지역(시도)<select id="ifSido" style="'+_selCss()+'">'+sidoOpts+'</select></label>'
      +'<button id="ifGo" style="padding:7px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">조회</button>';
    document.getElementById('ifGo').addEventListener('click',function(){ _runRegion(true); });
    _runRegion();
  } else if(_tab==='period'){
    ctrl.innerHTML='<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">기간분류<select id="ifPt" style="'+_selCss()+'"><option value="1">연도별</option><option value="2" selected>월별</option><option value="3">주별</option></select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">시작연도<select id="ifSy" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">종료연도<select id="ifEy" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<button id="ifGo" style="padding:7px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">조회</button>';
    document.getElementById('ifGo').addEventListener('click',function(){ _runPeriod(true); });
    _runPeriod();
  } else {
    ctrl.innerHTML='<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">연도<select id="ifYear" style="'+_selCss()+'">'+_yearOpts(_curYear())+'</select></label>'
      +'<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--t3)">연령단위<select id="ifUnit" style="'+_selCss()+'"><option value="10" selected>10세</option><option value="5">5세</option><option value="1">1세</option></select></label>'
      +'<button id="ifGo" style="padding:7px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)">조회</button>';
    document.getElementById('ifGo').addEventListener('click',function(){ _runAge(true); });
    _runAge();
  }
}

function _tableHtml(headers, rows){
  let h='<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--bg2)">';
  headers.forEach(function(hd,i){ h+='<th style="padding:7px 8px;border:1px solid var(--bdr);text-align:'+(i===headers.length-1?'right':'left')+'">'+_esc(hd)+'</th>'; });
  h+='</tr></thead><tbody>';
  rows.forEach(function(r){ h+='<tr>'+r.map(function(c,i){ return '<td style="padding:6px 8px;border:1px solid var(--bdr);text-align:'+(i===r.length-1?'right':'left')+';color:var(--t1)">'+_esc(c)+'</td>'; }).join('')+'</tr>'; });
  h+='</tbody></table>';
  return h;
}
function _loading(){ const b=document.getElementById('infectBody'); if(b)b.innerHTML='<div style="text-align:center;color:var(--t3);padding:16px 0">조회 중…</div>'; }
function _errMsg(r){ return _esc(getInfectiousErrorMessage(r)); }
function _beginQuery(){
  const query={epoch:++_queryEpoch,body:document.getElementById('infectBody'),key:_key()};
  _loading();
  return query;
}
function _queryBody(query){
  return query.epoch===_queryEpoch&&query.key===_key()&&document.getElementById('infectBody')===query.body?query.body:null;
}

async function _runRegion(force){
  const query=_beginQuery();
  const y=(document.getElementById('ifYear')||{}).value||_curYear();
  const sido=(document.getElementById('ifSido')||{}).value||'00';
  const r=await fetchRegion(y, sido, {force:force===true});
  const body=_queryBody(query); if(!body) return;
  if(r.error){ body.innerHTML='<div style="color:var(--t2)">'+_errMsg(r)+'</div>'; return; }
  const agg=Object.create(null);
  r.rows.forEach(function(x){ if(!x.icdNm||x.val<=0)return; agg[x.icdNm]=(agg[x.icdNm]||0)+x.val; });
  const list=Object.keys(agg).map(function(k){return [k,agg[k]];}).sort(function(a,b){return b[1]-a[1];});
  if(!list.length){ body.innerHTML='<div style="color:var(--t2);text-align:center;padding:12px 0">해당 조건의 발생 데이터가 없습니다. (연도를 바꿔보세요)</div>'; return; }
  body.innerHTML='<div style="font-size:11px;color:var(--t3);margin-bottom:8px">'+_esc(sidoName(sido))+' · '+_esc(String(y))+'년 · 발생수 많은 순</div>'
    +_tableHtml(['감염병명','발생수(명)'], list.map(function(x){return [x[0], x[1].toLocaleString()];}));
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
  if(r.error){ body.innerHTML='<div style="color:var(--t2)">'+_errMsg(r)+'</div>'; return; }
  const rows=r.rows.filter(function(x){return x.icdNm&&x.val>0;}).sort(function(a,b){return b.val-a.val;}).slice(0,100);
  if(!rows.length){ body.innerHTML='<div style="color:var(--t2);text-align:center;padding:12px 0">해당 조건의 발생 데이터가 없습니다.</div>'; return; }
  body.innerHTML='<div style="font-size:11px;color:var(--t3);margin-bottom:8px">'+_esc(sy)+'~'+_esc(ey)+' · '+({1:'연도별',2:'월별',3:'주별'}[pt]||'')+' · 발생수 많은 순(상위 100)</div>'
    +_tableHtml(['기간','감염병명','발생수(명)'], rows.map(function(x){return [x.period||x.year, x.icdNm, x.val.toLocaleString()];}));
}
async function _runAge(force){
  const query=_beginQuery();
  const y=(document.getElementById('ifYear')||{}).value||_curYear();
  const unit=(document.getElementById('ifUnit')||{}).value||'10';
  const r=await fetchAge(y, unit, {force:force===true});
  const body=_queryBody(query); if(!body) return;
  if(r.error){ body.innerHTML='<div style="color:var(--t2)">'+_errMsg(r)+'</div>'; return; }
  /* 감염병별 합계 → 발생 많은 병 선택 드롭다운 + 그 병의 연령분포 */
  const byDis=Object.create(null);
  r.rows.forEach(function(x){ if(!x.icdNm)return; byDis[x.icdNm]=(byDis[x.icdNm]||0)+(x.ageRange==='계'?0:x.val); });
  const dises=Object.keys(byDis).filter(function(k){return byDis[k]>0;}).sort(function(a,b){return byDis[b]-byDis[a];});
  if(!dises.length){ body.innerHTML='<div style="color:var(--t2);text-align:center;padding:12px 0">해당 조건의 발생 데이터가 없습니다.</div>'; return; }
  const sel=dises[0];
  let dopt=''; dises.slice(0,60).forEach(function(d){ dopt+='<option value="'+_esc(d)+'">'+_esc(d)+'</option>'; });
  const ageRows=r.rows.filter(function(x){return x.icdNm===sel&&x.ageRange&&x.ageRange!=='계'&&x.val>0;});
  body.innerHTML='<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:11px;color:var(--t3)">감염병 선택</span><select id="ifDis" style="'+_selCss()+';max-width:240px">'+dopt+'</select></div>'
    +'<div id="ifAgeTbl">'+(ageRows.length?_tableHtml([sel+' — 연령','발생수(명)'], ageRows.map(function(x){return [x.ageRange, x.val.toLocaleString()];})):'<div style="color:var(--t2)">연령 분포 데이터가 없습니다.</div>')+'</div>';
  const dsel=document.getElementById('ifDis');
  if(dsel)dsel.addEventListener('change',function(){
    const dv=dsel.value;
    const rows2=r.rows.filter(function(x){return x.icdNm===dv&&x.ageRange&&x.ageRange!=='계'&&x.val>0;});
    const t=document.getElementById('ifAgeTbl');
    if(t)t.innerHTML=rows2.length?_tableHtml([dv+' — 연령','발생수(명)'], rows2.map(function(x){return [x.ageRange, x.val.toLocaleString()];})):'<div style="color:var(--t2)">연령 분포 데이터가 없습니다.</div>';
  });
}
