/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { escHtml, createEmptyState, showLoading, hideLoading } from '../../core/helpers.js';
import { renderSettingsPanel } from './settings-view.js';
import { bus } from '../../core/event-bus.js';
import { S } from '../../core/app-state.js';
import { makeSlideToDelete } from '../../core/ui-utils.js';

/* ═══════════════════════════════════════
   SETTINGS TAB: RETENTION (데이터 백업과 삭제)
   Extracted from settings-view.js
   ═══════════════════════════════════════ */
/* 사용자 데이터 경로 캐시 — IPC 로 한 번만 조회 후 재사용.
   window._cachedUserDataPath 는 공유 변수로 쓰이며, 첫 렌더 시 IPC 호출 → 수신 후 패널 재렌더링. */
let _rtCachedUserDataPath = (typeof window!=='undefined' && window._cachedUserDataPath) ? window._cachedUserDataPath : '';

/* 우리 로고가 들어간 인앱 confirm/alert — 네이티브 dialog 회피 (dev 의 Electron 아이콘 회피) */
function _appModal({title, body, okText='확인', cancelText='취소', danger=false, hideCancel=false}){
  return new Promise(function(resolve){
    const old=document.getElementById('appModalOverlay'); if(old)old.remove();
    const ov=document.createElement('div');
    ov.id='appModalOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);z-index:9900;display:flex;align-items:center;justify-content:center';
    const okStyle=danger
      ? 'background:rgba(239,68,68,0.15);color:#dc2626;border:1px solid rgba(239,68,68,0.4)'
      : 'background:rgba(6,182,212,0.12);color:var(--cyan);border:1px solid rgba(6,182,212,0.4)';
    ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:460px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.45)">'
      + '<div style="padding:16px 18px 12px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,var(--bg2),transparent)">'
      +   '<img src="assets/logo/logo_big.png" alt="" style="width:28px;height:28px;border-radius:6px;flex-shrink:0;object-fit:cover">'
      +   '<div style="font-size:14px;font-weight:800;color:var(--t1);flex:1">'+escHtml(title||'알림')+'</div>'
      + '</div>'
      + '<div style="padding:16px 20px;font-size:12.5px;color:var(--t1);line-height:1.7;white-space:pre-wrap;overflow:auto;flex:1">'+(body||'')+'</div>'
      + '<div style="padding:12px 18px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;gap:8px;justify-content:flex-end">'
      +   (hideCancel?'':'<button id="appModalCancel" class="btn btn-outline btn-sm" style="font-size:11px;padding:6px 14px">'+escHtml(cancelText)+'</button>')
      +   '<button id="appModalOk" class="btn btn-sm" style="font-size:11px;padding:6px 14px;font-weight:700;'+okStyle+'">'+escHtml(okText)+'</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    const _close=function(v){const e=document.getElementById('appModalOverlay');if(e)e.remove();resolve(v);};
    document.getElementById('appModalOk').addEventListener('click',function(){_close(true);});
    const cancelBtn=document.getElementById('appModalCancel');
    if(cancelBtn)cancelBtn.addEventListener('click',function(){_close(false);});
    ov.addEventListener('click',function(e){if(e.target===ov)_close(false);});
    /* Esc 닫기 / Enter 확인 */
    const onKey=function(e){
      if(e.key==='Escape'){document.removeEventListener('keydown',onKey);_close(false);}
      else if(e.key==='Enter'){document.removeEventListener('keydown',onKey);_close(true);}
    };
    document.addEventListener('keydown',onKey);
    setTimeout(function(){document.getElementById('appModalOk').focus();},10);
  });
}
function _appAlert(title, body){return _appModal({title:title, body:body, hideCancel:true, okText:'확인'});}

/* 연도별 카운트 서버 요약 — S 메모리 배열은 현재 학년도만 들고 있으므로
   보존 정리 탭은 DB 전체 연도 집계를 별도 IPC 로 가져온다. */
let _rtYearSummary = null;        /* { daily:{yr:cnt}, emergency:{yr:cnt}, infection:{yr:cnt} } */
let _rtYearSummaryLoading = false;
function _rtFetchYearSummary(){
  if(_rtYearSummaryLoading) return;
  if(!window.electronAPI || !window.electronAPI.recordsYearSummary) return;
  _rtYearSummaryLoading = true;
  window.electronAPI.recordsYearSummary().then(function(r){
    _rtYearSummaryLoading = false;
    if(r && r.success && r.summary){
      _rtYearSummary = r.summary;
      if(S.settingsLocked === 'retention') renderSettingsPanel('retention');
    }
  }).catch(function(){ _rtYearSummaryLoading = false; });
}

/* 바이트 → 사람 읽는 포맷 */
function _rtFormatSize(bytes){
  if(!bytes || bytes<=0) return '0 B';
  const k=1024;
  const units=['B','KB','MB','GB'];
  const i=Math.min(units.length-1, Math.floor(Math.log(bytes)/Math.log(k)));
  const val=(bytes/Math.pow(k,i));
  return (val>=10?val.toFixed(0):val.toFixed(1))+' '+units[i];
}

/* 각 섹션의 파일 크기를 비동기 조회 후 배지에 채워넣음 — UI 렌더 직후 setTimeout 으로 호출됨. */
function _rtFetchFileSizes(sections){
  if(!window.electronAPI||!window.electronAPI.getFileSize) return;
  sections.forEach(function(sec){
    window.electronAPI.getFileSize(sec.relPath||sec.path).then(function(r){
      const el=document.querySelector('.rt-file-size[data-rt-size-key="'+sec.key+'"]');
      if(!el) return;
      if(r&&r.success){
        if(!r.exists){
          el.textContent='없음';
          el.style.color='var(--t3)';
          el.style.background='var(--bg2)';
          el.style.border='1px solid var(--bdr)';
        } else {
          el.textContent=_rtFormatSize(r.size);
        }
      } else {
        el.textContent='?';
      }
    }).catch(function(){
      const el=document.querySelector('.rt-file-size[data-rt-size-key="'+sec.key+'"]');
      if(el) el.textContent='?';
    });
  });
}

export function _renderRetentionTab(){
  let html='<div class="settings-panel-title">🛡 데이터 백업과 삭제</div>';
  // 보건 기록 로컬 저장 위치
  const _rtYear=new Date().getFullYear();
  /* fallback 경로 — IPC 응답 오기 전까지 잠깐 보여줄 자리지킴이.
     실제 앱 이름은 package.json 의 "name" (my-health-diary) 이라
     Mac 실제 경로는 '~/Library/Application Support/my-health-diary',
     Windows 는 '%APPDATA%\\my-health-diary' (Roaming). */
  const _isWin = navigator.platform && navigator.platform.indexOf('Win')>=0;
  const _sep = _isWin ? '\\' : '/';
  const _rtBasePath = _rtCachedUserDataPath
    || (_isWin ? 'C:\\Users\\<사용자>\\AppData\\Roaming\\my-health-diary' : '~/Library/Application Support/my-health-diary');
  /* 캐시 미설정 시 IPC 로 실제 경로 요청 후 수신하면 이 탭만 다시 렌더 */
  if(!_rtCachedUserDataPath && window.electronAPI && window.electronAPI.getUserDataPath){
    window.electronAPI.getUserDataPath().then(function(p){
      _rtCachedUserDataPath = p;
      window._cachedUserDataPath = p;
      if(S.settingsLocked==='retention') renderSettingsPanel('retention');
    }).catch(function(){});
  }
  /* OS 별 경로 구분자 통일 — Windows: 백슬래시, macOS/Linux: 슬래시 */
  const _joinPath = function(parts){return parts.join(_sep);};
  const _rtSections=[
    {icon:'💾',title:'메인 데이터베이스',desc:'일반일지, 응급처치, 감염병, 설문, 인원(학생·교직원), 요보호·미세먼지 기저질환 이력, 교직원 잠복결핵 누적 등록표, 앱 설정',path:_joinPath([_rtBasePath,'data','my_health_diary.sqlite3']),relPath:'data/my_health_diary.sqlite3',key:'daily'},
    {icon:'💊',title:'약품 상세정보 캐시',desc:'식약처 e약은요와 제약사 의약품 첨부문서에서 수집한 약품 상세(효능·용법·주의) 정보',path:_joinPath([_rtBasePath,'data','medications_list.json']),relPath:'data/medications_list.json',key:'medications_list'}
  ];
  html+='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:10px">📂 보건 기록 로컬 저장 위치</div>';
  html+='<div style="display:flex;flex-direction:column;gap:6px">';
  _rtSections.forEach(function(sec,idx){
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2)">'
      +'<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">'
      +'<span style="font-size:14px;flex-shrink:0">'+sec.icon+'</span>'
      +'<div style="min-width:0"><div style="font-size:11px;font-weight:700;color:var(--t1);display:flex;align-items:center;gap:6px">'
        +'<span>'+sec.title+'</span>'
        /* 파일 크기 — IPC 로 조회 후 채워짐. 초기값 "…" → 조회 완료 후 실제 값 교체. */
        +'<span class="rt-file-size" data-rt-size-key="'+sec.key+'" style="font-size:9px;font-weight:600;color:var(--cyan);padding:1px 7px;border-radius:4px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.25);font-family:var(--fm)">…</span>'
      +'</div>'
      +(sec.desc?'<div style="font-size:10px;color:var(--t2);margin-bottom:2px">'+sec.desc+'</div>':'')
      +'<div style="font-size:9px;color:var(--t3);word-break:break-all;font-family:var(--fm)">'+sec.path+'</div></div></div>'
      +'</div>';
  });
  html+='</div></div>';
  /* 렌더 직후 각 파일 크기를 IPC 로 조회해서 배지에 반영 — 비동기, UI 블로킹 없음 */
  setTimeout(function(){ _rtFetchFileSizes(_rtSections); }, 0);
  // 데이터 백업 섹션 — 서버 전체 연도 집계 사용 (S 메모리는 현재 학년도만 보유)
  if(!_rtYearSummary) _rtFetchYearSummary();
  const _bkSummary = _rtYearSummary || { daily:{}, emergency:{}, infection:{} };
  const _bkD=_bkSummary.daily||{}, _bkE=_bkSummary.emergency||{}, _bkI=_bkSummary.infection||{};
  const _bkYearSet={};
  Object.keys(_bkD).forEach(function(y){if(y)_bkYearSet[y]=1;});
  Object.keys(_bkE).forEach(function(y){if(y)_bkYearSet[y]=1;});
  Object.keys(_bkI).forEach(function(y){if(y)_bkYearSet[y]=1;});
  const _bkYears=Object.keys(_bkYearSet).map(function(y){return parseInt(y,10);}).filter(function(y){return !isNaN(y);}).sort(function(a,b){return b-a;});
  html+='<div style="padding:14px;margin-bottom:12px" class="cc">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">💾 데이터 백업</div>';
  html+='<p style="font-size:10.5px;color:var(--t3);margin-bottom:10px">컴퓨터 고장·포맷·재설치에 대비해 정기적으로 백업해두세요. 복원 시 백업 시점 상태로 되돌아갑니다.</p>';
  // 연도별 백업 현황
  if(_bkYears.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px">📊 백업 대상 현황</div>';
    _bkYears.forEach(function(yr){
      const yk=String(yr);
      const dc=_bkD[yk]||0;
      const ec=_bkE[yk]||0;
      const ic=_bkI[yk]||0;
      const svData=typeof _svGetHistory==='function'?_svGetHistory():null;
      const sc=svData?svData.filter(function(s){return s.date&&s.date.substring(0,4)===yk;}).length:0;
      html+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;border-radius:6px;background:var(--bg2);font-size:11px;flex-wrap:wrap">'
        +'<span style="font-weight:700;color:var(--t1);min-width:44px">'+yr+'년</span>'
        +'<span style="color:var(--t2)">📋 일반일지 <b>'+dc+'</b>건</span>'
        +'<span style="color:var(--t2)">🚨 응급처치 <b>'+ec+'</b>건</span>'
        +'<span style="color:var(--t2)">🦠 감염병 <b>'+ic+'</b>건</span>'
        +(sc>0?'<span style="color:var(--t2)">📝 건강설문 응답 <b>'+sc+'</b>건</span>':'')
        +'</div>';
    });
  } else {
    html+='<div style="font-size:11px;color:var(--t3);margin-bottom:8px">저장된 기록 데이터가 없습니다.</div>';
  }
  /* 공통 데이터 현황 */
  const _stuCount=S.people.filter(function(s){return s.type==='student';}).length;
  const _staffCount=S.people.filter(function(s){return s.type==='staff';}).length;
  const _careCount=S.people.filter(function(s){return s.status==='caution'||s.status==='watch';}).length;
  let _medCount=0;
  try{
    const _sm=S._symMeds||{};const _medSet={};
    Object.keys(_sm).forEach(function(k){if(Array.isArray(_sm[k]))_sm[k].forEach(function(m){_medSet[m]=true;});});
    const _mu=JSON.parse(localStorage.getItem('ec_meddb_user')||'{}');
    if(_mu.categories)_mu.categories.forEach(function(c){if(c.items)c.items.forEach(function(m){_medSet[m.name||m]=true;});});
    _medCount=Object.keys(_medSet).length;
  }catch(e){}
  let _svCustomCount=0;try{_svCustomCount=(JSON.parse(localStorage.getItem('ec_sv_custom')||'[]')).length;}catch(e){}
  html+='<div style="font-size:11px;font-weight:700;color:var(--t2);margin:10px 0 6px">📦 공통 데이터 현황</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">';
  html+='<span style="font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;background:var(--bg2)">👥 학생 <b>'+_stuCount+'</b>명</span>';
  html+='<span style="font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;background:var(--bg2)">🏫 교직원 <b>'+_staffCount+'</b>명</span>';
  html+='<span style="font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;background:var(--bg2)">🛡 요보호 학생 <b>'+_careCount+'</b>명</span>';
  html+='<span style="font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;background:var(--bg2)">💊 약품 정보 <b>'+_medCount+'</b>종</span>';
  if(_svCustomCount>0)html+='<span style="font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;background:var(--bg2)">📝 커스텀 설문 <b>'+_svCustomCount+'</b>개</span>';
  html+='</div>';

  html+='<div style="display:flex;gap:8px;margin-top:10px">'
    +'<button class="btn btn-primary btn-sm" id="retBackupBtn">📥 데이터베이스 파일 백업하기</button>'
    +'<button class="btn btn-sm" id="retRestoreBtn">📤 백업 파일에서 복원하기</button>'
    +'</div>';
  html+='</div>';
  html+='<div class="settings-panel-desc">「공공기록물 관리에 관한 법률 시행령」 및 각 시·도교육청의 기록관리기준표에 따라, 보건일지는 보존기간 경과 후 폐기할 수 있습니다. 학교보건일지는 건강기록부와 별도로 관리되며, 소속 교육청의 기록관리기준표에 따라 보존기간이 결정됩니다. 일반적으로 보건실 방문 기록(일일 보건일지)은 <b>5년</b> 보존 후 폐기가 가능합니다.</div>';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px;border-left:3px solid var(--cyan)">'
    +'<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">📌 관련 법령 안내</div>'
    +'<ul style="font-size:11px;color:var(--t2);line-height:2;padding-left:18px;margin:0">'
    +'<li><b>학교보건법 시행령 제23조제4항</b> — 보건교사의 직무(보건일지 작성 등)</li>'
    +'<li><b>공공기록물 관리에 관한 법률 시행령 제26조</b> — 기록물의 보존기간은 기록관리기준표에 따른다.</li>'
    +'<li><b>학교 공통업무 보존기간 준칙</b> — 보건일지(일일 기록): 5년, 보건관리 종합 기록: 준영구 ※소속 교육청 기준 확인 필요</li>'
    +'<li>각 시·도교육청별로 보존기간이 다를 수 있으므로 소속 교육청의 기준을 반드시 확인하세요.</li>'
    +'</ul></div>';
  // 연도별 5년 경과 데이터 — DB 전체 집계(서버) 사용. 메모리 S.* 는 현재 학년도만 보유.
  const currentYear=new Date().getFullYear();
  const cutoffYear=currentYear-5;
  if(!_rtYearSummary) _rtFetchYearSummary();
  const _summary = _rtYearSummary || { daily:{}, emergency:{}, infection:{} };
  const _ydaily=_summary.daily||{}, _yec=_summary.emergency||{}, _yinf=_summary.infection||{};
  const _yearSet={};
  Object.keys(_ydaily).forEach(function(y){if(y)_yearSet[y]=1;});
  Object.keys(_yec  ).forEach(function(y){if(y)_yearSet[y]=1;});
  Object.keys(_yinf ).forEach(function(y){if(y)_yearSet[y]=1;});
  const allYears=Object.keys(_yearSet).map(function(y){return parseInt(y,10);}).filter(function(y){return !isNaN(y);}).sort(function(a,b){return b-a;});
  const expiredYears=allYears.filter(function(y){return y<=cutoffYear;});
  const safeYears=allYears.filter(function(y){return y>cutoffYear;});
  function countByYear(_arr,yr){return 0;} /* 호환 더미 — 아래 cardCount 사용 */
  function _dailyCnt(yr){ return _ydaily[String(yr)]||0; }
  function _ecCnt   (yr){ return _yec  [String(yr)]||0; }
  function _infCnt  (yr){ return _yinf [String(yr)]||0; }
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">🗓 연도별 보존 기간 및 삭제</div>'
    +'<div style="font-size:11px;color:var(--t2);margin-bottom:10px">보존기간 기준: <b>5년</b> · 삭제 대상: <b>'+cutoffYear+'년</b> 이전</div>';
  /* 연도 칩: 전체 연도 표시 (최근→오래된 순) */
  if(allYears.length>0){
    html+='<div style="font-size:11px;color:var(--t2);margin-bottom:6px">📅 보관 중인 연도 — 연도 칩을 클릭해 해당 연도만 보기</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px" id="retentionYearChips">';
    let _totalYrDaily=0, _totalYrEc=0, _totalYrInf=0;
    allYears.forEach(function(yr){_totalYrDaily+=_dailyCnt(yr);_totalYrEc+=_ecCnt(yr);_totalYrInf+=_infCnt(yr);});
    const _totalAll=_totalYrDaily+_totalYrEc+_totalYrInf;
    /* "전체" 칩 */
    html+='<span class="ret-yr-chip" data-ret-chip="all" style="cursor:pointer;padding:5px 12px;border-radius:14px;font-size:11px;font-weight:700;border:1.5px solid var(--cyan);background:rgba(6,182,212,0.1);color:var(--cyan);white-space:nowrap">전체 ('+_totalAll+'건)</span>';
    allYears.forEach(function(yr){
      const expired=yr<=cutoffYear;
      const dc=_dailyCnt(yr);
      const ec=_ecCnt(yr);
      const ic=_infCnt(yr);
      const total=dc+ec+ic;
      const chipStyle=expired
        ?'cursor:pointer;padding:5px 12px;border-radius:14px;font-size:11px;font-weight:700;border:1.5px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.08);color:var(--rs);white-space:nowrap'
        :'cursor:pointer;padding:5px 12px;border-radius:14px;font-size:11px;font-weight:600;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);white-space:nowrap';
      html+='<span class="ret-yr-chip" data-ret-chip="'+yr+'" style="'+chipStyle+'">'+(expired?'⚠ ':'')+yr+'년 ('+total+'건)</span>';
    });
    html+='</div>';
  }
  html+='<div id="retentionYearCards">';
  if(!allYears.length){
    html += (typeof createEmptyState==='function')
      ? createEmptyState({icon:'🗂',title:'저장된 기록이 없습니다',desc:'일반일지·응급처치·감염병 등 데이터 입력 후 자동으로 표시됩니다.'})
      : '<div style="text-align:center;padding:16px;color:var(--t3);font-size:12px">저장된 기록이 없습니다.</div>';
  } else {
    /* 전체 연도 카드 렌더링 — 최근 연도부터 */
    allYears.forEach(function(yr){
      const expired=yr<=cutoffYear;
      const elapsed=currentYear-yr;
      const remaining=expired?0:5-elapsed;
      const dailyCnt=_dailyCnt(yr);
      const ecCnt=_ecCnt(yr);
      const infCnt=_infCnt(yr);
      const borderCol=expired?'rgba(239,68,68,0.3)':'var(--bdr)';
      const bgCol=expired?'rgba(239,68,68,0.03)':'var(--bg2)';
      const titleCol=expired?'var(--rs)':'var(--t1)';
      const badgeBg=expired?'rgba(239,68,68,0.12)':'var(--gbg)';
      const badgeCol=expired?'var(--rs)':'var(--gs)';
      const badgeText=expired?(elapsed+'년 경과 · 삭제 대상'):('잔여 '+remaining+'년 · 보존 중');
      html+='<div data-ret-year="'+yr+'" style="border:1px solid '+borderCol+';border-radius:10px;padding:12px;margin-bottom:8px;background:'+bgCol+'">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
        +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:15px;font-weight:900;color:'+titleCol+'">'+yr+'년</span><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:'+badgeBg+';color:'+badgeCol+';font-weight:700">'+badgeText+'</span></div>'
        +(expired?'<div style="display:flex;gap:6px;align-items:center"><button class="btn btn-sm" data-action="delete-year" data-year="'+yr+'" data-early="false" style="font-size:10px;padding:2px 8px;background:rgba(239,68,68,0.15);color:#dc2626;border:1px solid rgba(239,68,68,0.4);cursor:pointer">🗑 삭제하기</button></div>':'')
        +'</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'
        +'<div style="padding:8px;border:1px solid '+(expired?'rgba(239,68,68,0.2)':'var(--bdr)')+';border-radius:6px;text-align:center'+(expired?';background:var(--bg2)':'')+'"><div style="font-size:16px;font-weight:800;color:'+titleCol+'">'+dailyCnt+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">일반일지<br>방문자 수</div></div>'
        +'<div style="padding:8px;border:1px solid '+(expired?'rgba(239,68,68,0.2)':'var(--bdr)')+';border-radius:6px;text-align:center'+(expired?';background:var(--bg2)':'')+'"><div style="font-size:16px;font-weight:800;color:'+titleCol+'">'+ecCnt+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">응급처치<br>기록 건수</div></div>'
        +'<div style="padding:8px;border:1px solid '+(expired?'rgba(239,68,68,0.2)':'var(--bdr)')+';border-radius:6px;text-align:center'+(expired?';background:var(--bg2)':'')+'"><div style="font-size:16px;font-weight:800;color:'+titleCol+'">'+infCnt+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">감염병<br>기록 건수</div></div>'
        +'</div></div>';
    });
  }
  html+='</div>'; /* retentionYearCards 닫기 */
  if(allYears.length && expiredYears.length===0){
    html+='<div style="text-align:center;padding:12px;color:var(--gs);font-size:12px;font-weight:700;margin-top:12px">✅ 5년이 경과한 삭제 대상 데이터가 없습니다.</div>';
  }
  html+='</div>';

  /* ── 학생/교직원 명단 정리 (완전 고아 — 보건일지·응급·감염 어디에도 참조 없는 대상 + DB 등록 5년 경과) ── */
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">👥 학생/교직원 명단 정리</div>'
    +'<div style="font-size:11px;color:var(--t2);margin-bottom:10px;line-height:1.7">다음 두 조건을 <b>모두</b> 만족하는 명단만 정리 대상으로 표시됩니다.<br>① 보건일지·응급처치·감염병 기록에 <b>단 한 건도 등장하지 않음</b><br>② 명단 등록일이 <b>5년 이상</b> 경과<br>버튼을 누르면 대상 명단이 표시되며, 직접 확인 후 일괄 삭제 여부를 결정합니다.</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +'<button class="btn btn-sm" data-action="retention-cleanup-students" style="font-size:11px;padding:6px 14px;background:rgba(234,179,8,0.08);color:#ca8a04;border:1px solid rgba(234,179,8,0.3);font-weight:700">📋 참조 없는 학생 명단 정리</button>'
    +'<button class="btn btn-sm" data-action="retention-cleanup-staff" style="font-size:11px;padding:6px 14px;background:rgba(234,179,8,0.08);color:#ca8a04;border:1px solid rgba(234,179,8,0.3);font-weight:700">📋 참조 없는 교직원 명단 정리</button>'
    +'</div></div>';

  /* 현재 학년도 계산 (3월 이후는 해당 연도, 1~2월은 전년도) — 아래 렌탈 대장 섹션에서 사용 */
  const _scNow=new Date();
  const _scSchoolYear=_scNow.getMonth()>=2?_scNow.getFullYear():_scNow.getFullYear()-1;

  /* ── 보건실 물품 대여 대장 정리 (학년도별 연도 칩) ── */
  const _rlRecs=JSON.parse(localStorage.getItem('ec_rental_records')||'[]');
  /* 레코드를 학년도별로 그룹화 (3/1~다음해 2/28 = 해당 학년도) */
  function _rlAcademicYear(dateStr){
    if(!dateStr)return null;
    /* 날짜 포맷: YYYY.MM.DD 또는 YYYY-MM-DD */
    const norm=String(dateStr).replace(/-/g,'.');
    const parts=norm.split('.');
    if(parts.length<2)return null;
    const y=parseInt(parts[0],10), m=parseInt(parts[1],10);
    if(isNaN(y)||isNaN(m))return null;
    return m>=3?y:y-1;
  }
  const _rlByYear={};
  _rlRecs.forEach(function(r){
    const ay=_rlAcademicYear(r.borrowDate);
    if(ay===null)return;
    if(!_rlByYear[ay])_rlByYear[ay]=0;
    _rlByYear[ay]++;
  });
  const _rlYears=Object.keys(_rlByYear).map(function(y){return parseInt(y,10);}).sort(function(a,b){return b-a;});
  html+='<div class="cc" style="padding:14px;margin-bottom:12px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">📦 보건실 물품 대여 대장 정리</div>'
    +'<p style="font-size:10.5px;color:var(--t3);margin-bottom:8px;line-height:1.7">대여 대장은 자동 삭제되지 않고 학년도별로 누적됩니다. 학년도 칩을 선택하면 해당 학년도의 기록만 직접 삭제할 수 있습니다.</p>'
    +'<div style="font-size:11px;color:var(--t2);margin-bottom:10px">현재 학년도: <b>'+_scSchoolYear+'</b> · 전체 기록: <b>'+_rlRecs.length+'</b>건</div>';
  if(_rlYears.length===0){
    html += (typeof createEmptyState==='function')
      ? createEmptyState({icon:'📦',title:'저장된 대여 기록이 없습니다',desc:'대여 물품 대장에서 대여 기록을 추가하면 표시됩니다.'})
      : '<div style="text-align:center;padding:14px;color:var(--t3);font-size:11px">저장된 대여 기록이 없습니다.</div>';
  } else {
    html+='<div style="font-size:11px;color:var(--t2);margin-bottom:6px">📅 학년도 선택</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px" id="rentalYearChips">';
    _rlYears.forEach(function(yr){
      const cnt=_rlByYear[yr]||0;
      const isCurrent=yr===_scSchoolYear;
      const chipStyle=isCurrent
        ?'cursor:pointer;padding:5px 12px;border-radius:14px;font-size:11px;font-weight:700;border:1.5px solid var(--cyan);background:rgba(6,182,212,0.08);color:var(--cyan);white-space:nowrap'
        :'cursor:pointer;padding:5px 12px;border-radius:14px;font-size:11px;font-weight:600;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);white-space:nowrap';
      html+='<span class="rental-yr-chip" data-rental-year="'+yr+'" style="'+chipStyle+'">'+yr+'학년도 ('+cnt+'건)'+(isCurrent?' · 현재':'')+'</span>';
    });
    html+='</div><div id="rentalYearDetail" style="padding:10px 12px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2);font-size:11px;color:var(--t2);margin-bottom:8px">학년도 칩을 클릭하면 상세 정보와 삭제 버튼이 표시됩니다.</div>';
  }
  html+='<div style="display:flex;gap:8px;align-items:center;margin-top:10px">'
    +'<button class="btn btn-sm" id="rentalClearAllBtn" style="font-size:11px;background:rgba(239,68,68,0.05);color:var(--t3);border:1px solid var(--bdr)">전체 초기화 ('+_rlRecs.length+'건)</button>'
    +'</div></div>';

  /* ── ⚠️ 공장 초기화 (실험/리셋용) ── */
  html+='<div class="cc" style="padding:14px;margin-bottom:12px;border:2px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.02)">'
    +'<div style="font-size:12px;font-weight:800;color:#dc2626;margin-bottom:8px">⚠️ 데이터베이스 공장 초기화</div>'
    +'<p style="font-size:10.5px;color:var(--t3);margin-bottom:10px;line-height:1.7">두 가지 옵션이 있습니다. 실행 직전 자동으로 백업 파일이 생성됩니다.</p>'
    /* 옵션 1 — 전체 초기화 */
    +'<div style="border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(239,68,68,0.04)">'
    +'<div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:6px">① 전체 초기화 — 모든 것을 삭제</div>'
    +'<p style="font-size:10.5px;color:var(--t3);margin-bottom:8px;line-height:1.7"><b style="color:#dc2626">학생·교직원 명단, 보건일지·응급처치·감염병 기록, 설문, 침상, 물품 대여 기록</b> 모두 삭제됩니다. 로그인 사용자 계정과 데이터베이스 구조는 유지됩니다.</p>'
    +'<button class="btn btn-sm" id="dbFactoryResetBtn" style="font-size:11px;background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.35);font-weight:700">🗑 전체 초기화 실행</button>'
    +'</div>'
    /* 옵션 2 — 보건일지만 초기화 */
    +'<div style="border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px;background:rgba(245,158,11,0.04)">'
    +'<div style="font-size:11px;font-weight:700;color:#b45309;margin-bottom:6px">② 보건일지만 초기화 — 인원 데이터는 보존</div>'
    +'<p style="font-size:10.5px;color:var(--t3);margin-bottom:8px;line-height:1.7">학생·교직원 명단·잠복결핵 검사 등 <b style="color:#16a34a">인원 데이터는 그대로 유지</b>됩니다. '
    +'<b style="color:#b45309">일반 보건일지·응급처치·감염병 기록·상담·설문 응답·외부 데이터 임시 항목</b>만 삭제됩니다. 침상 구성·시간표·설정·API 키 등 UI 설정은 모두 유지.</p>'
    +'<button class="btn btn-sm" id="dbFactoryResetHealthBtn" style="font-size:11px;background:rgba(245,158,11,0.12);color:#b45309;border:1px solid rgba(245,158,11,0.35);font-weight:700">🗑 보건일지만 초기화 실행</button>'
    +'</div>'
    +'<div id="dbFactoryResetResult" style="margin-top:10px;font-size:11px;color:var(--t2)"></div>'
    +'</div>';

  return html;
}

/* ── Bind retention tab event listeners after innerHTML ── */
export function _bindRetentionTabEvents(){
  /* delegated click on the whole retention panel for data-action buttons */
  const panel=document.getElementById('settingsPanel');
  if(!panel)return;
  /* settingsPanel 은 재사용 노드 — 이전 바인딩 해제 후 재등록 (중복 발화 방지) */
  if(panel._retDelegatedHandler){
    panel.removeEventListener('click', panel._retDelegatedHandler);
    panel._retDelegatedHandler = null;
  }
  const _retDelegated=function(e){
    const btn=e.target.closest('[data-action]');
    if(!btn)return;
    const action=btn.dataset.action;
    if(action==='delete-year'){deleteYearData(parseInt(btn.dataset.year,10),btn.dataset.early==='true');}
    else if(action==='retention-cleanup-students'){_openRetentionCleanupDialog('students');}
    else if(action==='retention-cleanup-staff'){_openRetentionCleanupDialog('staff');}
  };
  panel.addEventListener('click', _retDelegated);
  panel._retDelegatedHandler = _retDelegated;
  /* retention year chips — delegated */
  const retChips=document.getElementById('retentionYearChips');
  if(retChips)retChips.addEventListener('click',function(e){
    const chip=e.target.closest('.ret-yr-chip');
    if(!chip)return;
    _retSelectYearChip(chip.dataset.retChip==='all'?'all':chip.dataset.retChip);
  });
  /* 공장 초기화 버튼 — 슬라이드 투 삭제 + 두 단계 확인 후 API 호출 */
  const _fbBtn=document.getElementById('dbFactoryResetBtn');
  if(_fbBtn){
    if(!_fbBtn._slider){
      _fbBtn._slider = makeSlideToDelete(_fbBtn, { label: '클릭하여 우측으로 밀어서 삭제' });
    }
    _fbBtn.addEventListener('click',async function(){
      const body1='<div style="font-weight:700;color:#dc2626;margin-bottom:8px">⚠️ 경고</div>'
        +'<div style="font-size:11.5px;color:var(--t1);margin-bottom:8px">다음 데이터가 모두 삭제됩니다:</div>'
        +'<ul style="font-size:11.5px;color:var(--t2);line-height:1.8;padding-left:18px;margin:0 0 10px"><li>학생·교직원 명단</li><li>보건일지·응급처치·감염병 기록</li><li>설문 양식·응답</li><li>잠복결핵 검사·물품 대여 기록</li></ul>'
        +'<div style="font-size:11px;color:var(--t2);line-height:1.7">로그인 사용자 계정과 데이터베이스 구조는 유지됩니다.<br>실행 직전에 자동 백업 파일이 생성됩니다.</div>';
      /* 슬라이드 + 단일 경고 모달이면 충분 — 사용자 정책 2026-05-21 */
      const ok1=await _appModal({title:'데이터베이스 공장 초기화', body:body1+'<div style="margin-top:8px;color:#dc2626;font-weight:600">이 작업은 되돌릴 수 없습니다.</div>', okText:'실행', cancelText:'취소', danger:true});
      if(!ok1)return;
      const _res=document.getElementById('dbFactoryResetResult');
      if(_res)_res.innerHTML='<span style="color:var(--t3)">초기화 진행 중...</span>';
      if(window.electronAPI&&window.electronAPI.dbFactoryReset){
        window.electronAPI.dbFactoryReset().then(function(r){
          if(r&&r.success){
            const bp=r.backupPath||'';
            const bpDisplay=bp?'<div style="margin-top:6px;font-size:10px;color:var(--t3);word-break:break-all">💾 백업 위치: <code style="background:var(--bg2);padding:2px 4px;border-radius:3px;font-family:var(--fm);font-size:9px">'+escHtml(bp)+'</code></div>':'';
            /* ═════ 전체 캐시 초기화 — 메모리 + localStorage + sessionStorage ═════ */
            try{
              /* 1) 메모리 상태(S.*) 배열·객체 초기화 */
              const _arrKeys=['records','people','ecRecords','infRecords','surveyForms','surveyResponses','trainings','weightMgmtData','selectedStudents','_grantedUsers'];
              _arrKeys.forEach(function(k){if(Array.isArray(S[k]))S[k].length=0;});
              const _objKeys=['memoData','_vipTags','_bmData','kioskBackup','_apTbSearchData'];
              _objKeys.forEach(function(k){if(S[k]&&typeof S[k]==='object'&&!Array.isArray(S[k]))Object.keys(S[k]).forEach(function(kk){delete S[k][kk];});});

              /* 2) localStorage — 업무/일지 관련 캐시 키 전부 제거 (UI 설정·사용자 프로필·CD키는 보존) */
              const _preserveKeys=[
                'ec_user',           /* 현재 로그인 사용자 프로필 */
                'ec_settings',       /* 학교 기본 설정 */
                /* 인증코드(라이선스) — 공장초기화·DB 교체 후에도 절대 재인증 요구 X. 옛 'ec_cd_key' 는 죽은 이름. (사용자 보고 2026-05-31 — 락아웃 사고 방지) */
                'ec_cdkey_license', 'ec_cdkey', 'ec_cdkey_activated', 'ec_cdkey_notify',
                'ec_theme','ec_bg_mode','ec_bg_selected','ec_bg_custom','ec_bg_random_daily','ec_bg_random_weekly', /* 배경·테마 UI */
                'ec_header_glass','ec_footer_glass','ec_font_scale','ec_hdr_msg_interval','ec_hdr_msg_list','ec_header_msgs_user','ec_footer_msgs', /* 헤더·푸터·폰트 UI */
                'ec_weather_source','ec_kma_api_key','ec_airkorea_api_key','ec_drug_api_key','ec_hira_api_key','ec_emergency_api_key','ec_kakao_js_api_key','ec_kakao_rest_api_key','ec_neis_api_key','ec_kdca_api_key', /* API 키 */
                'ec_meal_popup_on','ec_meal_popup_time','ec_neis_school_code','ec_neis_office_code','ec_neis_school_name','ec_neis_school_kind', /* 급식 자동 팝업 설정·학교코드·학교급 캐시 (2026-06-17) */
                'ec_academic_color','ec_acad_popup_on','ec_acad_popup_when','ec_acad_popup_time', /* 학사일정 색상·자동 팝업 설정 (2026-06-17) */
                'ec_class_popups','ec_class_popup_on', /* 수업 자동 팝업 — 선택한 수업·켜짐 상태 (2026-06-17) */
                'ec_user_region','ec_weatherRegion','ec_weather_rotate',
                'ec_airkorea_station','gp2_airkorea_station','ec_kma_station', /* 미세먼지·기상 측정소명 — 절대 보존 */
                'ec_locale','ec_nurse_onboarded','ec_first_run_done',
                /* ── 사용자 요청 보존 항목 ── */
                'dailyColOrder','dailyColVisibility',           /* 일반 일지 열 순서·표시 여부 */
                'ec_col_widths','ec_col_widths_u',              /* 일반 일지 열 너비 */
                'ecColOrder','ecColVisibility','ec_ec_col_widths',/* 응급처치 열 설정 */
                'infColOrder','infColVisibility','ec_inf_col_widths',/* 감염병 열 설정 */
                'ec_quickMsgs',                                 /* 상용 메시지 */
                'tr_msg_template',                              /* 연수/교육 메시지 */
                'ec_vp_custom_formats','ec_vp_custom_names','ec_vp_custom_slots', /* 커스텀 양식 출력 */
                /* ★ 커스텀 양식 사용자 수정 보존 보강 (2026-06-11 감사) — 라벨·확인문/푸터·추가 행·필요/이유 삭제·도장/서명 */
                'ec_vp_custom_labels','ec_vp_custom_blocks','ec_vp_custom_rows','ec_vp_reason_removed',
                'ec_vp_stamps','ec_vp_signs','ec_vp_stamp_image','ec_vp_sign_image','ec_vp_sigMode','ec_vpe_margin',
                /* ── 증상/처치/약품 커스터마이징 ── */
                'ec_user_fav_treatments',     /* 승격된 자주 쓰는 처치 */
                'ec_user_sym_fav',            /* ★ 증상별 자주 쓰는 처치(사용자 등록분) — 공장초기화 보존 누락 수정(2026-06-09). 안 넣으면 등록분 전체 소실 */
                'ec_user_sym_removed',        /* ★ 증상별 기본 처치 삭제 목록 — 안 넣으면 삭제한 기본 처치가 되살아남 */
                'ec_user_demoted_treatments', /* 강등된 처치 */
                'ec_user_symptoms',           /* 사용자 추가 증상 */
                'ec_hidden_symptoms',         /* 숨긴 증상 */
                'ec_med_hidden',              /* 숨긴 약품 */
                'ec_sym_order',               /* 증상 순서 */
                'ec_user_med_syms',           /* 증상→약품 매핑 (사용자 추가) */
                /* ★ 사용자 추가 약품·이름 변경 — 공장초기화 보존 누락 수정 (2026-08-27 검수).
                 *  안 넣으면 직접 등록한 약품·약품 이름 변경이 전체 초기화 때 소실됨 */
                'ec_user_added_meds',         /* 사용자가 직접 추가한 약품 */
                'ec_meddb_user',              /* 사용자 약품 상세정보 */
                'ec_med_renames',             /* 약품 이름 변경 */
                'ec_user_med_syms_prefilled', /* 기본 매핑 선반영 완료 플래그 — 지워지면 삭제한 기본 매핑이 재생성됨 */
                /* ── 기타 보존 ── */
                'ec_bed_config',              /* 침상 구성 */
                'ec_timetable','gp2_timetable'/* 주간 시간표 */
              ];
              /* 접두사로 시작하는 것 중 보존 대상 — 슬롯별 에디터 상태 등 */
              const _preservePrefixes=[
                'ec_vp_editor_',    /* 커스텀 양식 에디터 슬롯 */
                'ec_vp_tpl_',       /* 빌트인 양식 확인 문구 사용자 수정 (2026-06-11 감사) */
                'ec_vp_sig_pos_',   /* 양식별 도장/서명 위치 (2026-06-11 감사) */
                /* 일반 일지 열 설정 — 실제 읽기는 사용자 키(…_u<uid>)라 정확명만으론 미보존이던 구멍 (2026-06-12) */
                'dailyColOrder','dailyColVisibility','ec_col_widths'
              ];
              const _preserveSet=new Set(_preserveKeys);
              /* API 키 / 반영됨 플래그 / 날씨·미세먼지 사용자 설정 — 패턴으로 모두 보존.
                 (DB 공장초기화는 보건일지 데이터만 비우는 작업이지 외부 인증·UI 설정과 무관.) */
              const _preservePatterns=[
                /_api_key(_applied)?$/,                /* ec_*_api_key, ec_*_api_key_applied */
                /_applied$/,                            /* ec_*_applied 모든 변형 */
                /_station(_applied)?$/,                 /* 측정소명 + 반영 플래그 */
                /^(ec|gp2)_(kma|airkorea|drug|hira|emergency|kakao|infectious)_/, /* 외부 API 관련 키 일괄 */
                /^ec_(weather|user_region|weatherRegion|school_address|school_lat|school_lng)/,
                /^ec_kiosk/ /* 키오스크 채널ID·토큰·설정 — 지워지면 활성화 시 새 채널 자동 발급 → 배포된 키오스크 HTML 과 어긋나 연결 끊김 (2026-06-11) */
              ];
              const _shouldPreserve=function(k){
                if(_preserveSet.has(k))return true;
                for(let p=0;p<_preservePrefixes.length;p++){if(k.indexOf(_preservePrefixes[p])===0)return true;}
                for(let p=0;p<_preservePatterns.length;p++){if(_preservePatterns[p].test(k))return true;}
                return false;
              };
              const _toRemove=[];
              for(let i=0;i<localStorage.length;i++){
                const k=localStorage.key(i);
                if(!k)continue;
                if(!_shouldPreserve(k)&&(k.indexOf('ec_')===0||k.indexOf('gp2_')===0||k.indexOf('daily')===0||k.indexOf('dash_')===0||k.indexOf('web_session_id')===0||k.indexOf('inf')===0)){
                  _toRemove.push(k);
                }
              }
              _toRemove.forEach(function(k){try{localStorage.removeItem(k);}catch(e){}});
              console.log('[factory-reset] localStorage '+_toRemove.length+'개 키 삭제:', _toRemove);

              /* 3) sessionStorage 전체 제거 (웹 세션·임시 상태) */
              try{sessionStorage.clear();}catch(e){}

              /* 4) 메모리 캐시(모듈 내부) — home-dashboard 등 */
              try{if(window._homeCapCache)window._homeCapCache=null;}catch(e){}
              try{if(window._hostListCache)Object.keys(window._hostListCache).forEach(function(k){window._hostListCache[k]=null;});}catch(e){}
              try{if(window._bmData)window._bmData={};}catch(e){}

              /* 5) UI 재렌더 */
              if(typeof bus!=='undefined'&&bus.emit){
                bus.emit('render:daily');
                bus.emit('render:calendar');
                bus.emit('render:sidebar');
                bus.emit('render:dashboard');
                bus.emit('render:home');
              }
              /* 6) 백업·삭제 탭 자체 재렌더 — "백업 대상 현황", "공통 데이터 현황", 연도별 카드 모두 0 으로 갱신 */
              _rtYearSummary=null;  /* 서버 집계 캐시 무효화 → 다음 렌더 시 빈 상태로 받아옴 */
            }catch(e){console.error('[factory-reset] 캐시 정리 실패:',e);}
            if(_res)_res.innerHTML='<span style="color:#16a34a;font-weight:700">✅ 공장 초기화 완료</span>'+bpDisplay+'<div style="color:var(--t3);font-size:10px;margin-top:4px">변경 사항을 완전히 반영하려면 프로그램을 재시작하세요.</div>';
            /* 보존 탭 재렌더 — 결과 메시지가 사라지지 않도록 짧은 지연 후 */
            setTimeout(function(){
              if(typeof renderSettingsPanel==='function' && S.settingsLocked==='retention'){
                renderSettingsPanel('retention');
              }
            },1500);
          } else {
            if(_res)_res.innerHTML='<span style="color:#dc2626">❌ 실패: '+((r&&r.error)||'알 수 없음')+'</span>';
          }
        }).catch(function(e){
          if(_res)_res.innerHTML='<span style="color:#dc2626">❌ 오류: '+(e.message||'')+'</span>';
        });
      } else {
        if(_res)_res.innerHTML='<span style="color:#dc2626">❌ API 사용 불가 (dbFactoryReset)</span>';
      }
    });
  }
  /* 보건일지만 초기화 — 슬라이드 투 삭제 + 두 단계 확인 후 API 호출. 주황(주의) 톤. */
  const _fbHealthBtn=document.getElementById('dbFactoryResetHealthBtn');
  if(_fbHealthBtn){
    if(!_fbHealthBtn._slider){
      _fbHealthBtn._slider = makeSlideToDelete(_fbHealthBtn, {
        label: '클릭하여 우측으로 밀어서 삭제',
        color: '#b45309',
        bg: 'rgba(245,158,11,0.07)',
        borderRGBA: 'rgba(245,158,11,0.40)',
        knobBg: '#d97706',
      });
    }
    _fbHealthBtn.addEventListener('click',async function(){
      const body1='<div style="font-weight:700;color:#b45309;margin-bottom:8px">⚠ 보건일지·기록 초기화</div>'
        +'<div style="font-size:11.5px;color:var(--t1);margin-bottom:8px">다음 데이터가 삭제됩니다:</div>'
        +'<ul style="font-size:11.5px;color:var(--t2);line-height:1.8;padding-left:18px;margin:0 0 10px"><li>일반 보건일지 (방문 기록)</li><li>응급처치 기록</li><li>감염병 기록</li><li>상담 기록</li><li>설문 응답</li><li>외부 데이터 가져오기 임시 항목</li></ul>'
        +'<div style="font-size:11.5px;color:#16a34a;margin-bottom:8px;line-height:1.6">✅ 다음은 그대로 유지됩니다:</div>'
        +'<ul style="font-size:11.5px;color:var(--t2);line-height:1.8;padding-left:18px;margin:0 0 10px"><li>학생·교직원 명단</li><li>잠복결핵 검사 누적 기록</li><li>침상 구성·시간표·열 설정 등 UI 설정</li><li>API 키, 카카오·날씨·미세먼지 사용자 설정</li><li>로그인 사용자 계정</li></ul>'
        +'<div style="font-size:11px;color:var(--t2);line-height:1.7">실행 직전에 자동 백업이 생성됩니다.</div>';
      /* 슬라이드 + 단일 경고 모달이면 충분 */
      const ok1=await _appModal({title:'보건일지만 초기화', body:body1+'<div style="margin-top:8px;color:#dc2626;font-weight:600">인원 명단은 보존됩니다. 이 작업은 되돌릴 수 없습니다.</div>', okText:'실행', cancelText:'취소', danger:true});
      if(!ok1)return;
      const _res=document.getElementById('dbFactoryResetResult');
      if(_res)_res.innerHTML='<span style="color:var(--t3)">초기화 진행 중...</span>';
      if(window.electronAPI&&window.electronAPI.dbFactoryResetHealthOnly){
        window.electronAPI.dbFactoryResetHealthOnly().then(function(r){
          if(r&&r.success){
            const bp=r.backupPath||'';
            const bpDisplay=bp?'<div style="margin-top:6px;font-size:10px;color:var(--t3);word-break:break-all">💾 백업 위치: <code style="background:var(--bg2);padding:2px 4px;border-radius:3px;font-family:var(--fm);font-size:9px">'+escHtml(bp)+'</code></div>':'';
            /* 메모리 상태 및 캐시 정리 — 인원(S.people) 은 보존, 일지/응급/감염만 비움 */
            try{
              const _arrKeys=['records','ecRecords','infRecords','surveyResponses'];
              _arrKeys.forEach(function(k){if(Array.isArray(S[k]))S[k].length=0;});
              const _objKeys=['memoData','_vipTags','_bmData'];
              _objKeys.forEach(function(k){if(S[k]&&typeof S[k]==='object'&&!Array.isArray(S[k]))Object.keys(S[k]).forEach(function(kk){delete S[k][kk];});});
              if(typeof bus!=='undefined'&&bus.emit){
                bus.emit('render:daily');
                bus.emit('render:calendar');
                bus.emit('render:sidebar');
                bus.emit('render:dashboard');
                bus.emit('render:home');
              }
              _rtYearSummary=null;
            }catch(e){console.error('[health-only-reset] 캐시 정리 실패:',e);}
            if(_res)_res.innerHTML='<span style="color:#16a34a;font-weight:700">✅ 보건일지 초기화 완료</span>'
              +'<div style="margin-top:4px;font-size:10.5px;color:var(--t2)">삭제된 테이블: '+escHtml((r.tables||[]).join(', ')||'(없음)')+'</div>'
              +bpDisplay
              +'<div style="color:var(--t3);font-size:10px;margin-top:4px">변경 사항을 완전히 반영하려면 프로그램을 재시작하세요.</div>';
            setTimeout(function(){
              if(typeof renderSettingsPanel==='function' && S.settingsLocked==='retention'){
                renderSettingsPanel('retention');
              }
            },1500);
          } else {
            if(_res)_res.innerHTML='<span style="color:#dc2626">❌ 실패: '+escHtml((r&&r.error)||'알 수 없음')+'</span>';
          }
        }).catch(function(e){
          if(_res)_res.innerHTML='<span style="color:#dc2626">❌ 오류: '+escHtml(e.message||'')+'</span>';
        });
      } else {
        if(_res)_res.innerHTML='<span style="color:#dc2626">❌ API 사용 불가 (dbFactoryResetHealthOnly)</span>';
      }
    });
  }
  /* rental year chips — delegated */
  const rentalChips=document.getElementById('rentalYearChips');
  if(rentalChips)rentalChips.addEventListener('click',function(e){
    const chip=e.target.closest('.rental-yr-chip');
    if(!chip)return;
    _rentalSelectYearChip(parseInt(chip.dataset.rentalYear,10));
  });
  /* backup / restore */
  const bkBtn=document.getElementById('retBackupBtn');
  if(bkBtn)bkBtn.addEventListener('click',function(){backupDataToFile();});
  const rsBtn=document.getElementById('retRestoreBtn');
  if(rsBtn)rsBtn.addEventListener('click',function(){restoreDataFromFile();});
  /* rental clear all */
  const rcBtn=document.getElementById('rentalClearAllBtn');
  if(rcBtn)rcBtn.addEventListener('click',function(){_confirmRentalClearAll();});
}

/* ── 참조 없는 학생/교직원 명단 정리 다이얼로그 ──
   kind: 'students' | 'staff' */
async function _openRetentionCleanupDialog(kind){
  if(!window.electronAPI)return;
  const isStu=kind==='students';
  const fetchFn = isStu ? window.electronAPI.retentionFindOrphanStudents : window.electronAPI.retentionFindOrphanStaff;
  const deleteFn = isStu ? window.electronAPI.retentionBulkDeleteOrphanStudents : window.electronAPI.retentionBulkDeleteOrphanStaff;
  if(!fetchFn||!deleteFn)return;
  /* 보존 기간 5년: DB 등록일 기준 5년 이상 경과 + 참조 0건 */
  const r = await fetchFn(5);
  if(!r||!r.success){await _appAlert('대상 조회 실패', escHtml(r&&r.error||''));return;}
  const list = r.data || [];
  const labelKind = isStu ? '학생' : '교직원';

  /* 모달 오버레이 */
  const old=document.getElementById('retentionCleanupOverlay');if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='retentionCleanupOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);z-index:9800;display:flex;align-items:center;justify-content:center';
  function _fmtDate(s){if(!s)return '-';return String(s).slice(0,10);}
  function _esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  let bodyHtml;
  if(list.length===0){
    bodyHtml='<div style="padding:30px;text-align:center;color:var(--gs);font-size:13px;font-weight:700">✅ 5년 이상 경과 + 참조 없는 '+labelKind+'이 없습니다.</div>';
  } else {
    let rows='';
    list.forEach(function(p,i){
      if(isStu){
        rows+='<tr><td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center"><input type="checkbox" data-orphan-uid="'+_esc(p.uid)+'" checked></td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-size:10px;color:var(--t3)">'+(i+1)+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);font-weight:600">'+_esc(p.name)+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center">'+_esc(p.gender||'-')+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-family:var(--fm);font-size:11px">'+_esc(p.birth_date||'-')+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-family:var(--fm);font-size:11px">'+_fmtDate(p.created_at)+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-family:var(--fm);font-size:10px;color:var(--t3)">'+_esc(p.uid)+'</td></tr>';
      } else {
        rows+='<tr><td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center"><input type="checkbox" data-orphan-uid="'+_esc(p.uid)+'" checked></td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-size:10px;color:var(--t3)">'+(i+1)+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);font-weight:600">'+_esc(p.name)+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center">'+_esc(p.position||'-')+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center">'+_esc(p.gender||'-')+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-family:var(--fm);font-size:11px">'+_esc(p.birth_date||'-')+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-family:var(--fm);font-size:11px">'+_fmtDate(p.created_at)+'</td>'
          +'<td style="padding:6px;border-bottom:1px solid var(--bdr);text-align:center;font-family:var(--fm);font-size:10px;color:var(--t3)">'+_esc(p.uid)+'</td></tr>';
      }
    });
    const th = isStu
      ? '<th style="width:40px"><input type="checkbox" id="retCleanupAll" checked title="전체 선택/해제"></th><th style="width:36px">#</th><th>이름</th><th>성별</th><th>생년월일</th><th>등록일</th><th>식별번호</th>'
      : '<th style="width:40px"><input type="checkbox" id="retCleanupAll" checked title="전체 선택/해제"></th><th style="width:36px">#</th><th>이름</th><th>직위</th><th>성별</th><th>생년월일</th><th>등록일</th><th>식별번호</th>';
    bodyHtml = '<div style="padding:12px 16px;border-bottom:1px solid var(--bdr);background:var(--bg2);font-size:11px;color:var(--t2);line-height:1.6">'
      + '대상 <b style="color:var(--t1)">'+list.length+'명</b> — 명단 등록 5년 이상 경과 + 보건일지·응급·감염 기록 참조 0건<br>'
      + '체크된 항목만 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.'
      + '</div>'
      + '<div style="flex:1;overflow:auto;padding:0">'
      + '<table style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr style="background:var(--bg2);position:sticky;top:0;z-index:1">'+th+'</tr></thead><tbody>'+rows+'</tbody></table>'
      + '</div>';
  }

  ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:14px;width:760px;max-width:94vw;max-height:84vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.45)">'
    + '<div style="padding:14px 18px;border-bottom:1px solid var(--bdr);background:linear-gradient(180deg,rgba(234,179,8,0.06),transparent);display:flex;align-items:center;gap:10px">'
    +   '<span style="font-size:15px;font-weight:800;color:var(--t1);flex:1">📋 참조 없는 '+labelKind+' 명단 정리</span>'
    +   '<button id="retCleanupClose" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);cursor:pointer;font-size:14px">✕</button>'
    + '</div>'
    + bodyHtml
    + '<div style="padding:12px 18px;border-top:1px solid var(--bdr);display:flex;gap:8px;justify-content:flex-end;background:var(--bg2)">'
    +   '<button id="retCleanupCancel" class="btn btn-outline btn-sm" style="font-size:11px;padding:6px 14px">취소</button>'
    +   (list.length>0?'<button id="retCleanupConfirm" class="btn btn-sm" style="font-size:11px;padding:6px 14px;background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.4);font-weight:700">선택 항목 삭제</button>':'')
    + '</div>'
    + '</div>';
  document.body.appendChild(ov);

  const _close=function(){const e=document.getElementById('retentionCleanupOverlay');if(e)e.remove();};
  ov.addEventListener('click',function(e){if(e.target===ov)_close();});
  const closeBtn=document.getElementById('retCleanupClose');if(closeBtn)closeBtn.addEventListener('click',_close);
  const cancelBtn=document.getElementById('retCleanupCancel');if(cancelBtn)cancelBtn.addEventListener('click',_close);
  const allChk=document.getElementById('retCleanupAll');
  if(allChk)allChk.addEventListener('change',function(){
    document.querySelectorAll('input[data-orphan-uid]').forEach(function(c){c.checked=allChk.checked;});
  });
  const confirmBtn=document.getElementById('retCleanupConfirm');
  if(confirmBtn)confirmBtn.addEventListener('click',async function(){
    const checked=Array.from(document.querySelectorAll('input[data-orphan-uid]:checked')).map(function(c){return c.dataset.orphanUid;});
    if(checked.length===0){await _appAlert('선택 없음','삭제할 항목이 없습니다.');return;}
    const ok=await _appModal({title:labelKind+' 명단 삭제', body:'<div style="margin-bottom:8px"><b>'+checked.length+'</b>명을 삭제합니다.</div><div style="font-size:11px;color:var(--t2)">삭제 후에는 되돌릴 수 없습니다.</div>', okText:'삭제하기', cancelText:'취소', danger:true});
    if(!ok)return;
    confirmBtn.disabled=true;confirmBtn.textContent='삭제 중…';
    const dr = await deleteFn(checked);
    if(dr&&dr.success){
      bus.emit('toast:show',{text:'✅ '+labelKind+' '+(dr.count||0)+'명 삭제 완료'});
      _close();
      if(typeof bus!=='undefined')bus.emit('render:daily');
      if(typeof renderSettingsPanel==='function')renderSettingsPanel('retention');
    } else {
      await _appAlert('삭제 실패', escHtml(dr&&dr.error||'알 수 없는 오류'));
      confirmBtn.disabled=false;confirmBtn.textContent='선택 항목 삭제';
    }
  });
}

async function deleteYearData(yr,early){
  const yrStr=String(yr);
  const countRes=await window.electronAPI.recordsCountByYear(yrStr);
  if(!countRes||!countRes.success){await _appAlert('건수 조회 실패','연도별 데이터를 조회하지 못했습니다.');return;}
  const c=countRes.data;
  const total=c.daily+c.emergency+c.infection;
  if(total===0){await _appAlert(yr+'년 데이터 없음', yr+'년에 저장된 기록이 없습니다.');return;}
  const earlyWarn=early
    ? '<div style="margin-top:10px;padding:8px 10px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.3);border-radius:6px;color:#ca8a04;font-size:11.5px">⚠ 보존 기간(5년) 미경과 데이터입니다. 조기 삭제는 신중히 판단하세요.</div>'
    : '';
  const body=
    '<div style="margin-bottom:10px"><b>'+yr+'</b>년 기록을 삭제합니다.</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11.5px">'
    +   '<div style="padding:8px;border:1px solid var(--bdr);border-radius:6px;text-align:center;background:var(--bg2)"><div style="font-size:14px;font-weight:800">'+c.daily+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">일반일지</div></div>'
    +   '<div style="padding:8px;border:1px solid var(--bdr);border-radius:6px;text-align:center;background:var(--bg2)"><div style="font-size:14px;font-weight:800">'+c.emergency+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">응급처치</div></div>'
    +   '<div style="padding:8px;border:1px solid var(--bdr);border-radius:6px;text-align:center;background:var(--bg2)"><div style="font-size:14px;font-weight:800">'+c.infection+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">감염병</div></div>'
    + '</div>'
    + '<div style="margin-top:10px;font-size:11px;color:var(--t2)">삭제 후 되돌릴 수 없습니다.</div>'
    + earlyWarn;
  const ok=await _appModal({title:yr+'년 데이터 삭제', body:body, okText:'삭제하기', cancelText:'취소', danger:true});
  if(!ok)return;
  const delRes=await window.electronAPI.recordsDeleteByYear(yrStr);
  if(!delRes||!delRes.success){await _appAlert('삭제 실패', escHtml(delRes?delRes.error:'알 수 없는 오류'));return;}
  const d=delRes.deleted;
  S.records=S.records.filter(function(r){return !r.date||r.date.substring(0,4)!==yrStr;});
  if(typeof S.ecRecords!=='undefined')S.ecRecords=S.ecRecords.filter(function(r){return !r.date||r.date.substring(0,4)!==yrStr;});
  if(typeof S.infRecords!=='undefined')S.infRecords=S.infRecords.filter(function(r){return !r.date||r.date.substring(0,4)!==yrStr;});
  bus.emit('toast:show',{text:'✅ '+yr+'년 '+(d.daily+d.emergency+d.infection)+'건 삭제 완료'});
  _rtYearSummary=null; /* 캐시 무효화 — 재렌더 시 서버에서 새로 받아옴 */
  renderSettingsPanel('retention');
  bus.emit('render:daily');bus.emit('render:calendar');bus.emit('render:sidebar');bus.emit('render:dashboard');
}

/* ── Backup/Restore data ── */
async function backupDataToFile(){
  const panel = document.getElementById('settingsPanel');
  if(panel) showLoading(panel, '데이터베이스 백업 중…');
  try {
    const res=await window.electronAPI.dbBackupSqlite();
    if(!res)return;
    if(res.canceled)return;
    if(!res.success){await _appAlert('백업 실패', escHtml(res.error||''));return;}
    const body='<div style="margin-bottom:8px">백업이 완료되었습니다.</div>'
      +'<div style="font-size:11px;color:var(--t2);margin-bottom:8px">저장 위치<br><code style="display:inline-block;margin-top:4px;padding:4px 8px;border-radius:4px;background:var(--bg2);border:1px solid var(--bdr);font-family:var(--fm);font-size:10.5px;word-break:break-all">'+escHtml(res.filePath||'')+'</code></div>'
      +'<div style="font-size:11px;color:var(--t2);line-height:1.7">학생·교직원 명단, 일반일지·응급처치·감염병 기록, 설문, 앱 설정 등 모든 데이터가 한 파일(<code>.sqlite3</code>)에 포함됩니다.</div>';
    await _appModal({title:'백업 완료', body:body, hideCancel:true, okText:'확인'});
  }catch(err){await _appAlert('백업 중 오류', escHtml(err.message));}
  finally { if(panel) hideLoading(panel); }
}

async function restoreDataFromFile(){
  let res;
  try{
    res = await window.electronAPI.dbRestoreSqlite();
  }catch(err){
    await _appAlert('복원 중 오류', escHtml(err.message));
    return;
  }
  if(!res) return;
  if(res.canceled) return;
  if(!res.success){ await _appAlert('복원 실패', escHtml(res.error||'')); return; }

  /* SQLite 백업 복원 완료 — 확인 모달 (닫기 버튼 없음, 확인 누르면 reload). */
  const usersCnt = (typeof res.usersCnt==='number') ? res.usersCnt : 0;
  const userWarn = (usersCnt===0)
    ? '<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:6px;font-size:11px;color:#dc2626;line-height:1.7">⚠ 백업 파일에 등록된 <b>사용자(보건교사) 정보가 없습니다</b>.<br>새로고침 후 사용자 등록 화면이 표시됩니다.</div>'
    : '';
  const body='<div style="margin-bottom:10px">백업 복원 완료</div>'
    +'<div style="font-size:11.5px;color:var(--t2);line-height:1.8;margin-bottom:10px">· 사용자 <b>'+usersCnt+'</b>명<br>· 인원 <b>'+res.peopleCnt+'</b>명<br>· 보건일지 <b>'+res.dailyCnt+'</b>건</div>'
    +userWarn
    +'<div style="font-size:11px;color:var(--t2);margin-top:10px">확인을 누르면 자동으로 새로고침됩니다.</div>';
  await _appModal({title:'복원 완료', body:body, okText:'확인 → 새로고침', hideCancel:true});
  location.reload();
}

/* ── 물품 대여 대장 학년도 칩 선택 ── */
function _rentalAcademicYear(dateStr){
  if(!dateStr)return null;
  const norm=String(dateStr).replace(/-/g,'.');
  const parts=norm.split('.');
  if(parts.length<2)return null;
  const y=parseInt(parts[0],10), m=parseInt(parts[1],10);
  if(isNaN(y)||isNaN(m))return null;
  return m>=3?y:y-1;
}
function _rentalSelectYearChip(yr){
  const chips=document.querySelectorAll('#rentalYearChips .rental-yr-chip');
  chips.forEach(function(c){
    const sel=parseInt(c.dataset.rentalYear,10)===yr;
    if(sel){
      c.style.borderWidth='1.5px';
      c.style.borderColor='var(--cyan)';
      c.style.background='rgba(6,182,212,0.18)';
      c.style.color='var(--cyan)';
      c.style.fontWeight='700';
    } else {
      c.style.borderWidth='1px';
      c.style.borderColor='var(--bdr)';
      c.style.background='var(--bg2)';
      c.style.color='var(--t2)';
      c.style.fontWeight='600';
    }
  });
  const detail=document.getElementById('rentalYearDetail');
  if(!detail)return;
  const recs=JSON.parse(localStorage.getItem('ec_rental_records')||'[]');
  const matched=recs.filter(function(r){return _rentalAcademicYear(r.borrowDate)===yr;});
  const unreturned=matched.filter(function(r){return !r.returned;}).length;
  const now=new Date();
  const curYr=now.getMonth()>=2?now.getFullYear():now.getFullYear()-1;
  const isCurrent=yr===curYr;
  const h='<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
    +'<div style="flex:1;min-width:0">'
    +'<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:4px">'+yr+'학년도'+(isCurrent?' (현재)':'')+'</div>'
    +'<div style="font-size:11px;color:var(--t2);line-height:1.8">총 <b>'+matched.length+'</b>건 · 미반납 <b style="color:#dc2626">'+unreturned+'</b>건</div>'
    +'</div>'
    +'<button class="btn btn-sm" data-action="delete-rental-year" data-year="'+yr+'" style="font-size:11px;background:rgba(239,68,68,0.1);color:#dc2626;border:1px solid rgba(239,68,68,0.3);padding:5px 12px"'+(isCurrent?' title="현재 학년도는 신중히 삭제하세요"':'')+'>🗑 '+yr+'학년도 기록 삭제</button>'
    +'</div>';
  detail.innerHTML=h;
  const delBtn=detail.querySelector('[data-action="delete-rental-year"]');
  if(delBtn)delBtn.addEventListener('click',function(){_deleteRentalByYear(parseInt(this.dataset.year,10));});
}
async function _deleteRentalByYear(yr){
  const recs=JSON.parse(localStorage.getItem('ec_rental_records')||'[]');
  const matched=recs.filter(function(r){return _rentalAcademicYear(r.borrowDate)===yr;});
  if(!matched.length){await _appAlert('대여 기록 없음', yr+'학년도 대여 기록이 없습니다.');return;}
  const now=new Date();
  const curYr=now.getMonth()>=2?now.getFullYear():now.getFullYear()-1;
  const warn=(yr===curYr)
    ? '<div style="margin-top:10px;padding:8px 10px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.3);border-radius:6px;color:#ca8a04;font-size:11.5px">⚠ 현재 학년도 데이터입니다. 정말 삭제하시겠습니까?</div>'
    : '';
  const body='<div style="margin-bottom:8px"><b>'+yr+'</b>학년도 대여 기록 <b>'+matched.length+'</b>건을 삭제합니다.</div>'
    +'<div style="font-size:11px;color:var(--t2)">삭제 후 되돌릴 수 없습니다.</div>'+warn;
  const ok=await _appModal({title:yr+'학년도 대여 기록 삭제', body:body, okText:'삭제하기', cancelText:'취소', danger:true});
  if(!ok)return;
  const kept=recs.filter(function(r){return _rentalAcademicYear(r.borrowDate)!==yr;});
  localStorage.setItem('ec_rental_records',JSON.stringify(kept));
  bus.emit('toast:show',{text:'✅ '+yr+'학년도 대여 기록 '+matched.length+'건 삭제 완료'});
  renderSettingsPanel('retention');
}
async function _confirmRentalClearAll(){
  const recs=JSON.parse(localStorage.getItem('ec_rental_records')||'[]');
  if(!recs.length){await _appAlert('대여 기록 없음', '대여 기록이 없습니다.');return;}
  const body='<div style="margin-bottom:8px">물품 대여 대장의 모든 기록 <b>'+recs.length+'</b>건을 삭제합니다.</div>'
    +'<div style="font-size:11px;color:var(--t2)">삭제 후 되돌릴 수 없습니다.</div>';
  const ok=await _appModal({title:'대여 대장 전체 초기화', body:body, okText:'삭제하기', cancelText:'취소', danger:true});
  if(!ok)return;
  localStorage.setItem('ec_rental_records','[]');
  bus.emit('toast:show',{text:'✅ 대여 대장 초기화 완료 ('+recs.length+'건 삭제)'});
  renderSettingsPanel('retention');
}
function _retSelectYearChip(val){
  /* 칩 하이라이트 */
  document.querySelectorAll('#retentionYearChips .ret-yr-chip').forEach(function(c){
    const sel=c.dataset.retChip===String(val);
    const isAll=c.dataset.retChip==='all';
    const yrNum=parseInt(c.dataset.retChip,10);
    const cutoff=new Date().getFullYear()-5;
    const expired=!isNaN(yrNum)&&yrNum<=cutoff;
    if(sel){
      c.style.borderWidth='1.5px';
      c.style.borderColor=isAll?'var(--cyan)':(expired?'#dc2626':'var(--cyan)');
      c.style.background=isAll?'rgba(6,182,212,0.18)':(expired?'rgba(239,68,68,0.15)':'rgba(6,182,212,0.12)');
      c.style.fontWeight='700';
    } else {
      c.style.borderWidth=isAll?'1.5px':(expired?'1.5px':'1px');
      c.style.borderColor=isAll?'var(--cyan)':(expired?'rgba(239,68,68,0.4)':'var(--bdr)');
      c.style.background=isAll?'rgba(6,182,212,0.1)':(expired?'rgba(239,68,68,0.08)':'var(--bg2)');
      c.style.fontWeight=isAll?'700':(expired?'700':'600');
    }
  });
  /* 카드 표시/숨김 */
  const cards=document.querySelectorAll('#retentionYearCards [data-ret-year]');
  if(val==='all'){
    cards.forEach(function(c){c.style.display='';});
  } else {
    cards.forEach(function(c){c.style.display=c.dataset.retYear===String(val)?'':'none';});
  }
}


