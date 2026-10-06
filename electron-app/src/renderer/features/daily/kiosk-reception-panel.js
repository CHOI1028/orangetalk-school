/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * kiosk-reception-panel.js — 일반일지 좌상단 키오스크 수신 패널
 *
 * 역할:
 *  - 릴레이 서버에 보건교사(nurse) 역할로 WebSocket 연결
 *  - 대기 중인 방문 접수 목록을 표시
 *  - [호출] 버튼 — 키오스크에 "들어오세요" 알림 브로드캐스트
 *  - [일지 등록] 버튼 — 호출 + daily_records INSERT
 *
 * 의존:
 *  - window.electronAPI.recordsDailyInsert
 *  - localStorage('ec_kiosk_settings').relayUrl / nurseToken / channelId
 *  - S.people (명단), S.records (일반일지)
 */
/* ES Module */
import { escHtml, createEmptyState, getStu } from '../../core/helpers.js';
import { openSymptomCategoryPopup } from '../symptom/symptom-view.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { S, DEFAULT_RELAY_URL, addRecord, saveKioskSettings, refreshSharedKioskSettings } from '../../core/app-state.js';
import { bus } from '../../core/event-bus.js';
import { rentalAddFromKiosk, rentalMarkReturnedFromKiosk } from './rental-ledger-view.js';
import { deriveRosterKey, encryptJson } from '../../core/kiosk-roster-crypto.js';
import { buildRosterReply } from '../../core/kiosk-roster-source.js';

function _toast(text){ bus.emit('toast:show',{text}); }
let _kioskLanListenerSet=false;

/* 온디맨드 명단 — 파생 키 캐시 (rosterSecret+channelId 가 바뀌면 재파생) */
let _rosterKey=null, _rosterKeySig='';
async function _getRosterKey(cfg){
  const sig=(cfg.rosterSecret||'')+'|'+(cfg.channelId||'');
  if(!cfg.rosterSecret||!cfg.channelId) return null;
  if(_rosterKey&&_rosterKeySig===sig) return _rosterKey;
  _rosterKey=await deriveRosterKey(cfg.rosterSecret, cfg.channelId);
  _rosterKeySig=sig;
  return _rosterKey;
}

/* 키오스크 roster_request 처리 — DB(S.people)에서 요청분만 추려 (이름 응답은) 암호화해 그 기기에만 회신.
 *  ★ 릴레이엔 암호문만 흐른다. 평문 이름은 절대 서버로 안 감. (2026-06-14) */
async function _handleRosterRequest(payload){
  if(!_ws || _ws.readyState!==1) return;
  const p=payload||{};
  const cfg=_getCfg();
  const kind=(p.kind==='class'||p.kind==='staff'||p.kind==='search'||p.kind==='byuids')?p.kind:'structure';
  const reply=buildRosterReply(S.people||[], kind, p.query||{});
  const out={ type:'roster_response', toDevice:p.fromDevice||'', reqId:p.reqId||'', kind:kind };
  try {
    if(reply.enc){
      const key=await _getRosterKey(cfg);
      if(!key){ /* 키 없음 — 키오스크 URL 재생성 필요. 빈 암호 응답 대신 무응답(키오스크가 타임아웃 처리) */ return; }
      const { iv, ct }=await encryptJson(key, reply.data);
      out.enc=true; out.iv=iv; out.ct=ct;
    } else {
      out.enc=false; out.data=reply.data;
    }
    _ws.send(JSON.stringify(out));
  } catch(e){ console.warn('[KIOSK-PANEL] roster_request 처리 실패:', e&&e.message); }
}

/* 명단 변동 → 연결된 키오스크에 캐시 무효화 신호(이름 없음). 데이터 로더/인원관리 저장 시 호출. */
export function kioskBroadcastRosterChanged(){
  try { if(_ws && _ws.readyState===1) _ws.send(JSON.stringify({ type:'roster_changed' })); } catch(_){}
}

/* _receptions → ec_kiosk_today localStorage 동기화 + 사이드바 갱신 */
function _syncToSidebar(){
  const today = _receptions.map(function(rec){
    const p = rec.person || {};
    const opts = (rec.options||[]).map(function(o,i){return (i===0&&o.tag)?o.tag:(o.label||'');}).filter(Boolean);
    const visitType = rec.type==='counseling'?'counsel':rec.type==='supply'?'supply':'nurse';
    /* NRS 통증 점수 추출 (바디맵 데이터에서) */
    let painScore = 0;
    if(rec.bodymap && rec.bodymap.length){
      rec.bodymap.forEach(function(b){ if(b.nrs && b.nrs > painScore) painScore = b.nrs; });
    }
    return {
      uid: p.uid || p.name || '',
      name: p.name || '방문자',
      grade: p.grade || '',
      cls: p.cls || '',
      num: p.num || '',
      status: 'waiting',
      visitType: visitType,
      painScore: painScore || 0,
      symptoms: (rec.symptoms||[]).join(', '),
      purpose: opts.join(' › '),
      time: rec.created_at ? new Date(rec.created_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}) : '',
      receptionId: rec.id
    };
  });
  localStorage.setItem('ec_kiosk_today', JSON.stringify(today));
  bus.emit('kiosk:sidebar-refresh');
}

let _ws = null;
let _receptions = []; /* [{id, person, options, symptoms, treatments, bodymap, type, created_at}] */
/* 호출 누른 횟수 — receptionId 기준 별도 맵. _receptions 는 queue_snapshot 마다 통째로 교체되므로(rec 객체에 두면 날아감)
 *  여기 보관해 스냅샷 갱신에도 유지. 접수 완료/삭제 시 해당 키 제거. (사용자 보고 "호출 숫자 안변한다" 2026-06-14) */
let _callCounts = {};
let _connected = false;
let _kioskClientCount = 0; /* 현재 접속 중인 키오스크 HTML 수 — 서버 kiosk_count push (2026-06-11) */
let _reconnectTimer = null;
let _connectionKey='', _queueChannel='', _rejectedConnectionKey='';
let _connectionGeneration=0, _queueRevision=0;
let _queueRequest=null, _reconcileTimer=null;
const _completingReceptions=new Set();

function _cfgKey(cfg){return JSON.stringify([cfg.relayUrl,cfg.channelId,cfg.nurseToken]);}

/* Support structured WS rows and the older flat HTTP queue format. */
function _normalizeReception(row){
  if(!row || (typeof row.id!=='string' && typeof row.id!=='number') || String(row.id)==='') return null;
  const old=_receptions.find(function(r){return String(r.id)===String(row.id);});
  const rec=Object.assign({},old||{},row,{id:String(row.id),_fromLan:false});
  try{
    let person=row.person;
    if(typeof person==='string') person=JSON.parse(person);
    if(!person || typeof person!=='object' || Array.isArray(person)){
      person=(old && old.person) || {uid:row.uid||row.student_uid||'',name:row.student_name||row.name||'',
        grade:row.grade||0,cls:row.class_num||0,num:row.student_num||0};
    }
    rec.person=person;
    ['options','symptoms','treatments','bodymap'].forEach(function(key){
      if(typeof rec[key]==='string') rec[key]=JSON.parse(rec[key]);
      if(rec[key]==null) rec[key]=[];
      if(!Array.isArray(rec[key])) throw new Error('Invalid reception');
    });
    return _enrichPersonByUid(rec);
  }catch(_){return null;}
}

function _replaceRelayQueue(rows){
  if(!Array.isArray(rows)) return false;
  const next=new Map();
  for(const row of rows){
    const rec=_normalizeReception(row);
    if(!rec) return false;
    if(!_completingReceptions.has(rec.id)) next.set(rec.id,rec);
  }
  _receptions=_receptions.filter(function(r){return r._fromLan;}).concat(Array.from(next.values()));
  const ids=new Set(_receptions.map(function(r){return String(r.id);}));
  Object.keys(_callCounts).forEach(function(id){if(!ids.has(id)) delete _callCounts[id];});
  _queueRevision++;
  _syncToSidebar();_render();
  return true;
}

/* Bounded, disposable queue reads recover missed socket messages. */
async function _pollRelayQueue(){
  if(_queueRequest || !S.kioskSettings.active || (window.__isWebBrowser && !S._kioskSharedLoaded)) return;
  const cfg=_getCfg(), key=_cfgKey(cfg);
  if(!cfg.relayUrl || !cfg.channelId || !cfg.nurseToken || key===_rejectedConnectionKey) return;
  const generation=_connectionGeneration, revision=_queueRevision;
  const controller=new AbortController();
  _queueRequest=controller;
  const timeout=setTimeout(function(){controller.abort();},8000);
  try{
    const response=window.__isWebBrowser
      ? await fetch('/api/ipc/kiosk-get-receptions',{
          method:'POST',headers:{'Content-Type':'application/json','X-Session-Id':sessionStorage.getItem('_webSessionId')||''},
          body:JSON.stringify({relayUrl:cfg.relayUrl,channelId:cfg.channelId,nurseToken:cfg.nurseToken}),
          signal:controller.signal,cache:'no-store'})
      : await fetch(cfg.relayUrl+'/api/v1/nurse/receptions/'+encodeURIComponent(cfg.channelId),{
          headers:{'Authorization':'Bearer '+cfg.nurseToken},signal:controller.signal,cache:'no-store'});
    if(!response.ok) return;
    const result=await response.json();
    if(controller.signal.aborted || generation!==_connectionGeneration || revision!==_queueRevision ||
       key!==_cfgKey(_getCfg()) || !S.kioskSettings.active) return;
    if(result && result.success===true && Array.isArray(result.receptions)) _replaceRelayQueue(result.receptions);
  }catch(_){ /* Keep the last known queue while offline. */ }
  finally{
    clearTimeout(timeout);
    if(_queueRequest===controller) _queueRequest=null;
  }
}

async function _reconcileKiosk(){
  if(window.__isWebBrowser) await refreshSharedKioskSettings();
  if(!S.kioskSettings.active){_disconnectQuiet();_render();return;}
  _connect();
  await _pollRelayQueue();
}

function _getCfg(){
  const ks = S.kioskSettings || {};
  return {
    relayUrl: ks.relayUrl || DEFAULT_RELAY_URL,
    nurseToken: ks.nurseToken || ks.authToken || '',
    channelId: ks.channelId || '',
    rosterSecret: ks.rosterSecret || ''   /* 온디맨드 명단 암호화 키 — URL #rk= fragment 로 키오스크와 공유 (2026-06-14) */
  };
}

/* 릴레이는 UID 만 보냄 (개인정보 보호 — PII 0). 받은 후 자기 DB 에서 풀네임 등 인적사항 보강.
 *  getStu 가 현재 명단(S.people) → 졸업·전학·전근 등 명단에서 빠진 leavers(S.leavers) → placeholder
 *  순으로 resolve 하므로, 활성 명단에 없지만 보건일지 이력이 남은 인원도 "(소속 미상)" 대신 정상 표시된다.
 *  (이전 버그: S.people 만 뒤져 leaver·비활성 인원이 모두 "(미식별)/(소속 미상)" 으로 떨어졌다 — 2026-06-13 수정)
 *  그래도 못 찾으면(키오스크 스냅샷이 현재 DB 와 불일치) 릴레이가 실어보낸 잔여 정보라도 살려서 표시한다. */
function _enrichPersonByUid(rec){
  if(!rec) return rec;
  const inc = rec.person || {};
  const uid = inc.uid || inc.id || '';
  let p = null;
  if(uid){
    try { const g = getStu(uid); if(g && !g._notFound) p = g; } catch(_){}
  }
  rec.person = p
    ? { uid: p.uid || p.id || uid,
        name: p.name || inc.name || '(이름없음)',
        type: p.type || inc.type || 'student',
        grade: p.grade || 0, cls: p.cls || 0, num: p.num || 0,
        gender: p.gender || '',
        position: p.position || '', level: p.level || '', department: p.department || '' }
    /* 매칭 실패 — 릴레이가 전달한 잔여 인적정보가 있으면 살리고, uid·이름 모두 없으면 익명 방문자 */
    : { uid: uid,
        name: inc.name || (uid ? '(미식별 사용자)' : '방문자'),
        type: inc.type || 'student',
        grade: inc.grade || 0, cls: inc.cls || 0, num: inc.num || 0,
        gender: inc.gender || '',
        position: inc.position || '', level: inc.level || '', department: inc.department || '' };
  return rec;
}

function _ensurePanel(){
  let el = document.getElementById('kioskReceptionPanel');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'kioskReceptionPanel';
  /* data-tooltip 미니 팝업 위임 — 패널은 innerHTML 재렌더라 패널 레벨 위임 1회 부착 (프로그램 공용 GUI, 2026-06-12) */
  el.addEventListener('mouseover', function(e){
    const t=e.target.closest?e.target.closest('[data-tooltip]'):null;
    if(!t||!el.contains(t))return;
    try{ showHeaderTooltip(e, t.getAttribute('data-tooltip'), false, t.getAttribute('data-tooltip-instant')==='1'); }catch(_){}
  });
  el.addEventListener('mouseout', function(e){
    const t=e.target.closest?e.target.closest('[data-tooltip]'):null;
    if(!t)return;
    try{ hideHeaderTooltip(); }catch(_){}
  });
  /* 기본 위치 — 상단부(top 고정, 아래로 펼쳐짐). 좌/우는 사이드바 위치에 맞춰 반대편으로:
   *  사이드바가 오른쪽이면 키오스크 수신 패널은 왼쪽에 떠야 겹치지 않음 (사용자 결정 2026-06-12). */
  const _sbRight = (localStorage.getItem('ec_sidebar_position') === 'right');
  const _sideCss = _sbRight ? 'left:16px' : 'right:16px';
  el.style.cssText = 'position:fixed;top:15vh;'+_sideCss+';z-index:900;width:360px;max-height:calc(100vh - 120px);background:var(--card);border:1.5px solid rgba(6,182,212,0.35);border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.2);overflow:hidden;display:none;flex-direction:column;font-family:var(--f)';
  document.body.appendChild(el);

  /* 드래그 이동 */
  let _dragging=false, _dx=0, _dy=0, _dragShield=null;
  el.addEventListener('mousedown', function(e){
    const hdr=el.querySelector('[data-action="toggleCollapse"]');
    if(!hdr||!hdr.contains(e.target))return;
    _dragging=true;
    const rect=el.getBoundingClientRect();
    _dx=e.clientX-rect.left; _dy=e.clientY-rect.top;
    el.style.cursor='grabbing';
    /* 드래그 차폐막 — 드래그 중 마우스가 일반일지 표 위를 지나도 행 hover/선택/클릭이 발생하지 않도록
     *  전체 화면 투명 레이어가 이벤트를 가로챈다 (사용자 보고 2026-06-12) */
    _dragShield=document.createElement('div');
    _dragShield.style.cssText='position:fixed;inset:0;z-index:99999;cursor:grabbing;background:transparent';
    document.body.appendChild(_dragShield);
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!_dragging)return;
    el.style.left=(e.clientX-_dx)+'px';
    el.style.top=(e.clientY-_dy)+'px';
    el.style.bottom='auto';
    el.style.right='auto';
  });
  document.addEventListener('mouseup', function(){
    if(_dragging){
      _dragging=false;el.style.cursor='';
      if(_dragShield){_dragShield.remove();_dragShield=null;}
      /* top 고정 유지 — 패널은 아래로 펼쳐지는 게 맞음 (사용자 결정 2026-06-12) */
    }
  });

  return el;
}

function _connStatusHtml(){
  /* "연결됨" = 서버 연결 + 키오스크 HTML 이 실제 접속 중일 때만. 키오스크를 끄거나 지우면 "키오스크 미연결". (사용자 결정 2026-06-11) */
  if(_connected && _kioskClientCount>0) return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#16a34a"><span style="width:6px;height:6px;border-radius:50%;background:#16a34a"></span>연결됨</span>';
  if(_connected) return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#d97706"><span style="width:6px;height:6px;border-radius:50%;background:#f59e0b"></span>키오스크 미연결</span>';
  /* LAN WS 활성이면 "LAN 대기" 표시 */
  const hasLanWs=!!(window.electronAPI&&window.electronAPI.onKioskWsMessage);
  const cfg = _getCfg();
  if(!cfg.relayUrl&&hasLanWs) return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#0891b2"><span style="width:6px;height:6px;border-radius:50%;background:#06b6d4"></span>LAN 대기</span>';
  if(!cfg.relayUrl||!cfg.channelId||!cfg.nurseToken) return '<span style="font-size:9px;color:#94a3b8">릴레이 미설정</span>';
  return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#ef4444"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444"></span>재연결 중…</span>';
}

function _render(){
  const panel = _ensurePanel();
  const collapsed = localStorage.getItem('ec_kiosk_panel_collapsed')==='1';
  if(!S.kioskSettings.active || _receptions.length===0){
    /* Waiting visitors remain visible even when the kiosk disconnects. */
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'flex';

  const waitCountBadge = _receptions.length>0
    ? '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;background:#ef4444;color:#fff;border-radius:10px;font-size:10px;font-weight:800">'+_receptions.length+'</span>'
    : '';

  let html = '<div data-action="toggleCollapse" style="padding:10px 12px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px;cursor:grab;user-select:none">';
  html += '<span style="font-size:14px">🏥</span>';
  html += '<span style="font-size:12px;font-weight:800;color:var(--t1)">키오스크 수신</span>';
  html += waitCountBadge;
  html += '<span style="flex:1"></span>';
  html += _connStatusHtml();
  html += '<span style="font-size:11px;color:var(--t3);transition:transform .2s;transform:rotate('+(collapsed?'180':'0')+'deg)">▼</span>'; /* 최소화 시 위로 뾰족 ▲ (사용자 요청 2026-06-11 — 예전 -90 은 오른쪽 뾰족) */
  html += '</div>';

  if(!collapsed){
    html += '<div style="flex:1;overflow-y:auto;padding:8px">';
    if(_receptions.length===0){
      const emptyHtml = (typeof createEmptyState==='function')
        ? createEmptyState({
            icon:'😌',
            title:'대기 중인 방문자가 없습니다',
            desc:_connected ? '키오스크에서 새 접수가 들어오면 이곳에 표시됩니다.' : '릴레이 서버 연결 후 자동으로 수신됩니다.'
          })
        : '<div style="padding:20px;text-align:center;color:var(--t3);font-size:11px">현재 대기 중인 방문자가 없습니다.</div>';
      html += emptyHtml;
    } else {
      _receptions.forEach(function(rec, idx){
        html += _renderReceptionCard(rec, idx);
      });
    }
    html += '</div>';
  }

  panel.innerHTML = html;

  /* Bind event listeners (replacing inline onclick handlers) */
  const hdr = panel.querySelector('[data-action="toggleCollapse"]');
  if(hdr) hdr.addEventListener('click', function(){ _toggleCollapse(); });

  panel.querySelectorAll('[data-action="call"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _call(btn.getAttribute('data-id')); });
  });
  panel.querySelectorAll('[data-action="register"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _register(btn.getAttribute('data-id')); });
  });
  /* 태그별 주 동작 (사용자 결정 2026-06-12) — 대여 등록 / 반납 처리 / 기록 없이 확인 */
  panel.querySelectorAll('[data-action="register-rental"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _registerRental(btn.getAttribute('data-id')); });
  });
  panel.querySelectorAll('[data-action="register-return"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _registerReturn(btn.getAttribute('data-id')); });
  });
  panel.querySelectorAll('[data-action="ack"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _ack(btn.getAttribute('data-id')); });
  });
  panel.querySelectorAll('[data-action="dismiss"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _complete(btn.getAttribute('data-id')); });
  });
}

const _escHtml = escHtml;

function _renderReceptionCard(rec, idx){
  const p = rec.person || {};
  /* 인적 표기 — 학교급은 본교에 둘 이상일 때만 접두(초/중/고/대), 학과 입력 시 학과명 표시.
   *  예: "고 지형공간디자인과 1학년 1반 2번" (사용자 요청 2026-06-12) */
  const _lvMap={'elementary':'초','middle':'중','high':'고','kindergarten':'유','college':'대','초':'초','중':'중','고':'고','유':'유','대':'대','special':'특수'};
  let _multiLv=false;
  try{
    const _s=new Set();
    (S.people||[]).forEach(function(x){ if(x&&x.type==='student'&&x.level){ _s.add(x.level); } });
    _multiLv=_s.size>1;
  }catch(_){}
  const _lvPfx=(_multiLv&&p.level)?((_lvMap[p.level]||p.level)+' '):'';
  const _deptPfx=p.department?(p.department+' '):'';
  const gradeClass = p.type==='staff'
    ? (p.position || '교직원')
    : (p.grade ? (_lvPfx+_deptPfx+p.grade+'학년 '+(p.cls||0)+'반 '+(p.num||0)+'번') : '(소속 미상)');
  const name = p.name || '방문자';
  const symptoms = (rec.symptoms||[]).join(', ') || '-';
  const treatments = (rec.treatments||[]).join(', ') || '-';
  const _opts = rec.options||[];
  /* tag가 있는 최상위 항목 찾기 + 마지막 선택 항목 */
  const _tagOpt = _opts.find(function(o){return o.tag;});
  const _rootTag = _tagOpt ? _tagOpt.tag : '';
  const _lastLabel = _opts.length>0 ? (_opts[_opts.length-1].label||'') : '';
  /* "진료/처치" 접두는 표시 생략 — 칸이 모자라고, 척도까지 붙으면 너무 길어진다 (사용자 요청 2026-06-14).
   *  예: "보건 선생님의 처치가 필요합니다 > 오른쪽 옆구리 (NRS: 9)" */
  let purposeLabels;
  if(_rootTag==='진료/처치'){
    purposeLabels = _lastLabel;
  } else {
    purposeLabels = _rootTag&&_lastLabel&&_rootTag!==_lastLabel ? (_rootTag+' > '+_lastLabel) : (_rootTag||_lastLabel);
  }
  /* 바디맵 입력 부위 + 통증 척도(NRS)도 경로에 표시 — "오른쪽 옆구리 (NRS: 9)" (사용자 요청 2026-06-14).
   *  NRS 0 은 '통증 없음 체크'이므로 점수 표기 생략, 1~10 만 "(NRS: N)" 부착. */
  const _bmLabels=(rec.bodymap||[]).map(function(m){
    if(!m||!m.label)return '';
    return (m.nrs)?(m.label+' (NRS: '+m.nrs+')'):m.label;
  }).filter(Boolean);
  if(_bmLabels.length) purposeLabels = (purposeLabels?purposeLabels+' > ':'')+_bmLabels.join(', ');
  /* 물품 대여 — 지정 물품명(rentalItem)을 경로에 표시 (사용자 보고 2026-06-14: 수신에 물품명이 안 나옴) */
  const _rentalItem=(_opts.find(function(o){return o&&o.rentalItem;})||{}).rentalItem||'';
  if(_rentalItem && (''+purposeLabels).indexOf(_rentalItem)<0) purposeLabels=(purposeLabels?purposeLabels+' · ':'')+'🛒 '+_rentalItem;
  const timeStr = rec.created_at ? new Date(rec.created_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}) : '';
  /* 접수 유형별 시각 구분 */
  const _typeStyles={
    nurse:{border:'rgba(239,68,68,0.3)',bg:'rgba(239,68,68,0.04)',badge:'🚨 보건교사',badgeColor:'#ef4444',badgeBg:'rgba(239,68,68,0.1)'},
    supply:{border:'rgba(34,197,94,0.3)',bg:'rgba(34,197,94,0.04)',badge:'🛒 물품수령',badgeColor:'#16a34a',badgeBg:'rgba(34,197,94,0.1)'},
    counseling:{border:'rgba(139,92,246,0.3)',bg:'rgba(139,92,246,0.04)',badge:'💬 상담',badgeColor:'#7c3aed',badgeBg:'rgba(139,92,246,0.1)'},
    guide:{border:'rgba(245,158,11,0.3)',bg:'rgba(245,158,11,0.04)',badge:'🩹 자가처치',badgeColor:'#d97706',badgeBg:'rgba(245,158,11,0.1)'}
  };
  const _ts=_typeStyles[rec.type]||{border:'var(--bdr)',bg:'var(--card)',badge:'',badgeColor:'var(--t3)',badgeBg:'transparent'};

  /* 인적사항·내용은 맑은 고딕 (사용자 요청 2026-06-12) */
  const _mg="'맑은 고딕','Malgun Gothic',sans-serif";
  let h = '<div style="margin-bottom:6px;padding:10px 12px;border:1px solid '+_ts.border+';border-radius:10px;background:'+_ts.bg+';font-size:11px;font-family:'+_mg+'">';
  h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
  h += '<span style="font-weight:800;color:var(--t1);font-size:12px;font-family:'+_mg+'">'+_escHtml(name)+'</span>';
  h += '<span style="font-size:9px;color:var(--t3);font-family:'+_mg+'">'+_escHtml(gradeClass)+'</span>';
  if(_ts.badge) h += '<span style="font-size:9px;color:'+_ts.badgeColor+';background:'+_ts.badgeBg+';padding:1px 6px;border-radius:4px;font-weight:700">'+_ts.badge+'</span>';
  h += '<span style="flex:1"></span>';
  h += '<span style="font-size:9px;color:var(--t3);font-family:'+_mg+'">'+_escHtml(timeStr)+'</span>';
  h += '</div>';
  if(purposeLabels){
    h += '<div style="font-size:10px;color:var(--t2);margin-bottom:4px;line-height:1.4">📋 '+_escHtml(purposeLabels)+'</div>';
  }
  if(rec.symptoms && rec.symptoms.length){
    h += '<div style="font-size:10px;color:#6366f1;margin-bottom:2px">증상: '+_escHtml(symptoms)+'</div>';
  }
  if(rec.treatments && rec.treatments.length){
    h += '<div style="font-size:10px;color:#0891b2;margin-bottom:4px">처치: '+_escHtml(treatments)+'</div>';
  }
  /* 버튼 안내는 프로그램 공용 미니 팝업(data-tooltip) — 네이티브 title 금지 (사용자 요청 2026-06-12) */
  /* 태그·하위 항목 메타별 주 동작 버튼 분기 (사용자 설계 2026-06-13, 상담록은 일지 등록 후 증상 팝업에서):
   *  · 진료/처치: diaryRegister=false 항목이면 [✔ 확인](기록 없음), 아니면 [✅ 일지 등록]
   *  · 물품 대여: 선택 항목 returnNeeded=true → [🛒 대여 등록](지정 물품), false → [✔ 확인]
   *  · 물품 반납 → [📦 반납 처리] (지정 물품으로 대장 반납)
   *  · 상담 → [✅ 일지 등록] (counselTopic 이 증상으로 들어가 상담록 연결)
   *  · 기타 → [✔ 확인]. 옛 태그(반납 필요/불필요 분리형)도 하위호환. */
  const _metaOpt=(function(){
    for(let i=_opts.length-1;i>=0;i--){
      const o=_opts[i];
      if(o&&(o.returnNeeded!==undefined||o.rentalItem||o.diaryRegister!==undefined||o.counselTopic))return o;
    }
    return null;
  })();
  const _btnAck=function(tip){return '<button data-action="ack" data-id="'+_escHtml(rec.id)+'" data-tooltip="'+_escHtml(tip)+'" data-tooltip-instant="1" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--f)">✔ 확인</button>';};
  const _btnRental='<button data-action="register-rental" data-id="'+_escHtml(rec.id)+'" data-tooltip="보건실 물품 대여 대장에 대여로 기록합니다" data-tooltip-instant="1" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid #16a34a;background:rgba(34,197,94,0.08);color:#16a34a;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--f)">🛒 대여 등록</button>';
  const _btnReturn='<button data-action="register-return" data-id="'+_escHtml(rec.id)+'" data-tooltip="물품 대여 대장에서 이 방문자의 물품을 반납 완료로 표시합니다" data-tooltip-instant="1" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid #f59e0b;background:rgba(245,158,11,0.08);color:#b45309;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--f)">📦 반납 처리</button>';
  const _btnDiary='<button data-action="register" data-id="'+_escHtml(rec.id)+'" data-tooltip="일반일지 표에 자동 등록 (호출 알림 없음)" data-tooltip-instant="1" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid #16a34a;background:rgba(34,197,94,0.08);color:#16a34a;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--f)">✅ 일지 등록</button>';
  let _mainBtn;
  if(_rootTag==='물품 대여'){
    const _need=!!(_metaOpt&&_metaOpt.returnNeeded===true);
    _mainBtn=_need?_btnRental:_btnAck('반납이 불필요한 대여이므로 기록 없이 접수를 완료합니다');
  } else if(_rootTag==='물품 대여(반납 필요)'){      /* 옛 태그 하위호환 */
    _mainBtn=_btnRental;
  } else if(_rootTag==='물품 반납'){
    _mainBtn=_btnReturn;
  } else if(_rootTag==='물품 대여(반납 불필요)'){    /* 옛 태그 하위호환 */
    _mainBtn=_btnAck('반납이 불필요한 대여이므로 기록 없이 접수를 완료합니다');
  } else if(_rootTag==='기타'){
    _mainBtn=_btnAck('방문 내역을 남기지 않고 접수를 완료합니다');
  } else if(_rootTag==='진료/처치'&&_metaOpt&&_metaOpt.diaryRegister===false){
    _mainBtn=_btnAck('보건일지에 미등록으로 지정된 항목이라 기록 없이 접수를 완료합니다');
  } else {
    _mainBtn=_btnDiary;   /* 진료/처치(등록)·상담·태그없음 */
  }
  /* 바로 들어오게 하기(waitMode=direct)로 지정된 접수는 호출 대상이 아님 → 호출 버튼 비활성화 (사용자 요청 2026-06-14).
   *  대기 모드는 선택 경로에서 waitMode 가 지정된 마지막 항목 기준 — 키오스크 _activeWaitMeta 와 동일 규칙. 미지정이면 대기(호출 활성). */
  const _isDirectEntry=(function(){for(let i=_opts.length-1;i>=0;i--){const o=_opts[i];if(o&&o.waitMode)return o.waitMode==='direct';}return false;})();
  h += '<div style="display:flex;gap:4px;margin-top:6px">';
  /* 📢 호출 — 누른 횟수(rec._callCount)를 오른쪽 동그라미 배지로 표시. 한 번=①, 두 번=②… (사용자 요청 2026-06-14) */
  if(_isDirectEntry){
    /* data-action="call-blocked" 는 바인딩되는 핸들러가 없어 클릭해도 무동작. disabled 안 걸어 hover 툴팁은 뜬다. */
    h += '<button data-action="call-blocked" data-tooltip="보건실로 바로 들어오는 경우 또는 물건만 가져가는 경우이므로 호출은 비활성화 되었습니다." data-tooltip-instant="1" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t3);font-size:10px;font-weight:700;cursor:not-allowed;opacity:0.55;font-family:var(--f)">📢 호출</button>';
  } else {
    h += '<button data-action="call" data-id="'+_escHtml(rec.id)+'" data-tooltip="방문자에게 들어오라는 알림 전송 (호출 횟수만큼 숫자가 올라갑니다.)" data-tooltip-instant="1" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid #06b6d4;background:rgba(6,182,212,0.08);color:#0891b2;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--f)">📢 호출'+_callBadgeHtml(_callCounts[rec.id])+'</button>';
  }
  h += _mainBtn;
  h += '<button data-action="dismiss" data-id="'+_escHtml(rec.id)+'" data-tooltip="삭제" data-tooltip-instant="1" style="padding:5px 8px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t3);font-size:10px;cursor:pointer;font-family:var(--f)">✕</button>';
  h += '</div>';
  h += '</div>';
  return h;
}

function _toggleCollapse(){
  const cur = localStorage.getItem('ec_kiosk_panel_collapsed')==='1';
  localStorage.setItem('ec_kiosk_panel_collapsed', cur?'0':'1');
  _render();
}

/* 호출 횟수 동그라미 배지 — count 1 이상일 때만. "📢 호출" 오른쪽에 붙는다 (사용자 요청 2026-06-14). */
function _callBadgeHtml(count){
  const n = count||0;
  if(n<1) return '';
  return '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;margin-left:5px;border-radius:8px;background:#0891b2;color:#fff;font-size:9px;font-weight:800;line-height:1;vertical-align:middle">'+n+'</span>';
}
/* 해당 호출 버튼의 배지만 즉시 갱신 — 전체 재렌더 없이 (툴팁/포커스 유지). data-id 특수문자 회피 위해 forEach 비교. */
function _updateCallBadge(receptionId, count){
  try{
    document.querySelectorAll('[data-action="call"]').forEach(function(btn){
      if(btn.getAttribute('data-id')===receptionId) btn.innerHTML='📢 호출'+_callBadgeHtml(count);
    });
  }catch(_){}
}

function _callLabel(rec){
  if(!rec||!rec.person)return '방문자';
  var p=rec.person, name=p.name||'방문자';
  if(p.type==='staff') return (p.position||'교직원')+' '+name;
  var parts=[];
  if(p.cls) parts.push(p.cls);
  if(p.num) parts.push(p.num+'번');
  return parts.length ? parts.join('-')+' '+name : name;
}

function _call(receptionId){
  const rec=_receptions.find(function(r){return r.id===receptionId;});
  const label=_callLabel(rec);
  /* 누른 횟수 누적 + 배지 즉시 갱신 (_callCounts 맵에 보존 → queue_snapshot 재렌더에도 유지, 접수 완료/삭제 시 제거) */
  _callCounts[receptionId]=(_callCounts[receptionId]||0)+1;
  _updateCallBadge(receptionId, _callCounts[receptionId]);
  /* LAN WS broadcast (우선) */
  if(rec&&rec._fromLan&&window.electronAPI&&window.electronAPI.kioskWsBroadcast){
    window.electronAPI.kioskWsBroadcast({type:'call',message:'보건 선생님이 호출합니다. 보건실로 들어오세요!'});
    _toast('📢 '+label+' 호출 전송됨 (LAN)');
    return;
  }
  /* 릴레이 서버 폴백 */
  const cfg = _getCfg();
  if(!cfg.relayUrl||!cfg.nurseToken||!cfg.channelId){
    _toast('릴레이 서버가 설정되지 않았습니다');
    return;
  }
  /* 협업 켜둔 상태(동료 접속 중 or 본인이 웹 클라이언트)면 호출한 보건교사 이름을 실어 보냄 →
   *  키오스크가 "(○○○ 선생님에게로 가기)" 표시. 솔로면 빈 이름 → 키오스크가 그 줄 숨김. (사용자 요청 2026-06-14) */
  const _isCollab = (window.__isWebBrowser || !!S._collabServerConnected);
  const _nurseName = ((S._currentUser&&S._currentUser.name)||(S.settings&&S.settings.nurse1)||'');
  fetch(cfg.relayUrl+'/api/v1/nurse/receptions/'+encodeURIComponent(cfg.channelId)+'/'+encodeURIComponent(receptionId)+'/call',{
    method:'POST',
    headers:{'Authorization':'Bearer '+cfg.nurseToken,'Content-Type':'application/json'},
    body:JSON.stringify({ name: _isCollab ? _nurseName : '' })
  }).then(function(r){return r.json();}).then(function(res){
    if(res&&res.success){
      _toast('📢 '+label+' 호출 전송됨');
    } else {
      _toast('호출 실패: '+(res&&res.error||'알 수 없는 오류'));
    }
  }).catch(function(err){
    _toast('호출 실패: 릴레이 서버 연결 오류');
  });
}

function _register(receptionId){
  const rec = _receptions.find(function(r){return r.id===receptionId;});
  if(!rec){_toast('접수 데이터를 찾을 수 없습니다');return;}
  const p = rec.person || {};
  if(!p.uid && !p.name){
    _toast('방문자 인적사항이 없어 일지 등록 불가');
    return;
  }
  /* 접수 시각 기준으로 daily_records에 INSERT */
  if(!window.electronAPI||!window.electronAPI.recordsDailyInsert){
    _toast('일지 등록 기능을 사용할 수 없습니다 (DB 연결 없음)');
    return;
  }
  const pad = function(n){return String(n).padStart(2,'0');};
  /* 접수 시각(created_at 또는 time)이 있으면 사용, 없으면 현재 시각 */
  const recTime = rec.created_at || rec.time || '';
  const recDate = recTime ? new Date(recTime) : new Date();
  const now = isNaN(recDate.getTime()) ? new Date() : recDate;
  const today = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  const timeIn = pad(now.getHours())+':'+pad(now.getMinutes());
  /* 퇴실 시간 — 보건일지 설정의 "퇴실 N분 후"(ec_daily_auto_time_out_after, 기본 4) 만큼 입실 시각에서 더해 자동 기입.
   *  수기 등록과 동일 규칙. 협업(웹)·Electron 동일 코드 경로라 양쪽 모두 적용 (사용자 요청 2026-06-15). */
  const _outAfter = parseInt(localStorage.getItem('ec_daily_auto_time_out_after')||'4',10);
  const _outDate = new Date(now.getTime() + (isNaN(_outAfter)?4:_outAfter)*60000);
  const timeOut = pad(_outDate.getHours())+':'+pad(_outDate.getMinutes());
  /* school_year: 학년도 (3월 기준) */
  const sy = String(now.getMonth()>=2 ? now.getFullYear() : now.getFullYear()-1);
  /* 상담 접수 — 지정된 상담 주제(증상 사전 상담 분류의 중분류)를 증상으로 등록 →
   *  증상 팝업을 열면 상담록 블록이 바로 떠서 작성 가능 (사용자 설계 2026-06-13) */
  const _symList=(rec.symptoms||[]).slice();
  const _topic=_kioskCounselTopic(rec);
  /* 상담 주제는 "상담[X 관련 상담]" 장식 형태로 저장 — 일지·증상팝업이 상담(counsel)으로 인식해 상담록이 뜨고,
   *  일지 테이블 표기·상담실적이 수기 입력분(symptom-view _symToSavedSymptom)과 일치. counselTopic 은 상담 중분류로만 지정됨. (2026-06-14) */
  const _topicSaved = _topic ? '상담['+_topic+' 관련 상담]' : '';
  if(_topicSaved && _symList.indexOf(_topicSaved)===-1) _symList.unshift(_topicSaved);
  const record = {
    school_year: sy,
    person_uid: p.uid||'',
    person_type: p.type||'student',
    visit_date: today,
    time_in: timeIn,
    time_out: timeOut,
    symptoms: JSON.stringify(_symList),
    treatment: JSON.stringify(rec.treatments||[]), /* ★ JSON 배열 — 합성칩 "투약[약A, 약B]" 콤마가 reload split 으로 깨지던 버그 방지 (일반 기록과 동일 포맷, 2026-06-11) */
    medication: '',
    department: '',
    body_temp: '',
    blood_pressure: '',
    pulse: '',
    respiration: '',
    spo2: '',
    result_code: '',
    nurse_name: ((S._currentUser&&S._currentUser.name)||((S.settings&&S.settings.nurse1)||'')),
    nurse_id: null,
    memo: '키오스크 접수 자동 등록',
    bodymap_json: JSON.stringify(rec.bodymap||[]),
    vip_tags: JSON.stringify([]),
    extra_json: JSON.stringify({fromKiosk:true, receptionId:receptionId, options:(rec.options||[]).map(function(o){return o.label;})}),
  };
  window.electronAPI.recordsDailyInsert(record).then(function(res){
    if(res&&res.success){
      _toast('✅ 일지에 자동 등록되었습니다');
      /* 접수 완료 처리 — 대기 목록에서 제거 */
      _complete(receptionId);
      /* 렌더러 형식(camelCase + 배열)으로 변환하여 메모리에 추가 */
      var newRec = {
        id: res.id,
        _dbId: res.id,   /* ★ DB 삽입 완료 표식 — 없으면 증상 팝업 저장 시 saveRecordNow 가 새 INSERT 를 또 해 이중 등록 (사용자 보고 2026-06-13) */
        _savedAt: Date.now(),
        studentId: p.uid||'',
        personType: p.type||'student',
        date: today,
        timeIn: timeIn,
        timeOut: timeOut,
        symptoms: _symList,
        treatment: rec.treatments||[],
        medication: '',
        dept: '',
        temp: '',
        bp: '',
        pulse: '',
        resp: '',
        spo2: '',
        result: '',
        nurse: record.nurse_name,
        memo: '키오스크 접수 자동 등록',
        bodymapData: rec.bodymap||[],
        vipTags: [],
        isImported: false
      };
      /* 바디맵 데이터를 _bmData에도 동기화 */
      if(rec.bodymap&&rec.bodymap.length>0){
        if(!window._bmData)window._bmData={};
        window._bmData[res.id]=rec.bodymap;
      }
      addRecord(newRec);
      /* 증상처치입력이 켜진 항목으로 접수됐는지 — 방문자가 이미 증상·처치를 입력한 경우엔 증상/처치 팝업을 자동으로 띄우지 않는다
       *  (수정은 보건교사가 일반일지 표의 증상·처치 칸을 클릭해서 연다). 미체크 접수(처치 없음, 상담 등)는 현행대로 팝업 오픈. (사용자 요청 2026-06-15)
       *  신호: 처치(treatments)가 있거나, 선택 옵션에 보건교사 지정 symptomTreat 가 담겨 있으면 = 증상처치입력 사용. */
      var _symTreatDone = (Array.isArray(rec.treatments) && rec.treatments.length>0)
        || (Array.isArray(rec.options) && rec.options.some(function(o){ return o && o.symptomTreat && (((o.symptomTreat.symptoms||[]).length)||((o.symptomTreat.treatments||[]).length)); }));
      /* 일지 등록 직후 증상 선택 및 처치 팝업 자동 오픈 — 표 렌더 한 박자 뒤 (사용자 요청 2026-06-11). 단, 증상처치입력으로 이미 입력된 경우엔 생략.
       *  "불편한 부위 알림" 팝업(바디맵 위치 안내)은 증상처치입력 여부와 무관하게 띄움 (버튼 없음, 클릭/타임아웃 닫힘). */
      setTimeout(function(){ if(!_symTreatDone){ try{ openSymptomCategoryPopup(res.id); }catch(_e){} } try{ _showBodyPartAlert(rec); }catch(_e2){} }, 250);
    } else if(res && res.reason === 'already_handled'){
      /* 멱등성 — 다른 보건교사가 같은 호출을 먼저 처리했음. 카드만 정리. */
      _toast('이미 '+(res.handler||'다른')+' 선생님이 처리한 호출입니다');
      _complete(receptionId);
    } else {
      _toast('일지 등록 실패: '+(res&&res.error||'알 수 없는 오류'));
    }
  }).catch(function(err){
    _toast('일지 등록 오류: '+err.message);
  });
}

/* 키오스크 접수 일지등록 직후 "불편한 부위 알림" 팝업 (사용자 요청 2026-06-14) —
 *  증상 선택 및 처치 팝업 위에 떠서, 바디맵 이력을 안 눌러도 부위·통증척도를 즉시 보여준다.
 *  버튼(확인/닫기) 없음 — 아무 데나 클릭하거나 8초 지나면 자동으로 닫힌다. */
function _showBodyPartAlert(rec){
  try{
    const markers=(rec&&rec.bodymap)||[];
    const _seen={}; const lines=[];
    markers.forEach(function(m){
      const l=(m&&m.label||'').trim();
      if(l&&!_seen[l]){ _seen[l]=1; lines.push(_escHtml(l)+' 부분이 불편해서 왔습니다.'+(m.nrs?' (통증척도 NRS: '+m.nrs+')':'')); }
    });
    if(!lines.length) return;
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center';
    ov.innerHTML='<div style="background:var(--card,#fff);border:1.5px solid rgba(6,182,212,0.5);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.35);padding:22px 30px;max-width:90vw;text-align:center;font-family:var(--f)">'
      +'<div style="font-size:15px;font-weight:800;color:var(--t1,#1e293b);margin-bottom:12px">🩹 불편한 부위 알림</div>'
      +'<div style="font-size:14px;color:var(--t1,#334155);line-height:1.9">'+lines.join('<br>')+'</div>'
      +'</div>';
    const close=function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', close);
    setTimeout(close, 8000);
    document.body.appendChild(ov);
  }catch(_){}
}

/* ── 태그별 주 동작 (사용자 결정 2026-06-12, 상담 제외 — 작업 중) ── */
/* 접수 선택 경로에서 물품명 추출 — 편집기에서 지정한 rentalItem 메타 우선 (2026-06-13),
 *  없으면 마지막 선택 라벨에서 "대여"/"반납" 꼬리 제거 (예: "아이스팩 반납" → "아이스팩") */
function _kioskItemLabel(rec){
  const opts=rec.options||[];
  for(let i=opts.length-1;i>=0;i--){
    if(opts[i]&&opts[i].rentalItem)return String(opts[i].rentalItem);
  }
  if(opts.length<2) return '';
  const last=String(opts[opts.length-1].label||'');
  return last.replace(/\s*(대여|반납)\s*$/,'').trim();
}
/* 접수 선택 경로에서 상담 주제(counselTopic) 추출 — 일지 등록 시 증상으로 들어가 상담록과 연결 (2026-06-13) */
function _kioskCounselTopic(rec){
  const opts=rec.options||[];
  for(let i=opts.length-1;i>=0;i--){
    if(opts[i]&&opts[i].counselTopic)return String(opts[i].counselTopic);
  }
  return '';
}
/* 접수 경로에서 반납 일수(returnDays, 평일) 추출 — 대여 등록 시 반납 예정일 계산용 (2026-06-13) */
function _kioskReturnDays(rec){
  const opts=rec.options||[];
  for(let i=opts.length-1;i>=0;i--){
    if(opts[i]&&opts[i].returnDays)return parseInt(opts[i].returnDays,10)||0;
  }
  return 0;
}
/* 물품 대여(반납 필요) → 보건실 물품 대여 대장에 INSERT (반납 예정일 = 평일 N일 후 12:00) */
function _registerRental(receptionId){
  const rec=_receptions.find(function(r){return r.id===receptionId;});
  if(!rec){_toast('접수 데이터를 찾을 수 없습니다');return;}
  const p=rec.person||{};
  if(!p.uid){_toast('방문자 인적사항이 없어 대여 등록 불가');return;}
  const item=_kioskItemLabel(rec);
  const days=_kioskReturnDays(rec);
  try{
    rentalAddFromKiosk(p.uid, item, days);
    _toast('🛒 물품 대여 대장에 등록되었습니다'+(item?' — '+item:''));
    _complete(receptionId);
  }catch(err){ _toast('대여 등록 오류: '+err.message); }
}
/* 물품 반납 → 대장에서 이 방문자의 미반납 기록을 반납 완료로 표시 */
function _registerReturn(receptionId){
  const rec=_receptions.find(function(r){return r.id===receptionId;});
  if(!rec){_toast('접수 데이터를 찾을 수 없습니다');return;}
  const p=rec.person||{};
  if(!p.uid){_toast('방문자 인적사항이 없어 반납 처리 불가');return;}
  const item=_kioskItemLabel(rec);
  try{
    const ok=rentalMarkReturnedFromKiosk(p.uid, item);
    if(ok){ _toast('📦 반납 처리되었습니다'+(item?' — '+item:'')); }
    else { _toast('⚠ 대여 대장에 이 방문자의 미반납 기록이 없습니다'); }
    _complete(receptionId);
  }catch(err){ _toast('반납 처리 오류: '+err.message); }
}
/* 물품 대여(반납 불필요)·기타 → 기록 없이 접수 완료 */
function _ack(receptionId){
  _complete(receptionId);
  _toast('접수를 확인했습니다 (기록 없음)');
}

function _complete(receptionId){
  receptionId=String(receptionId);
  const rec=_receptions.find(function(r){return String(r.id)===receptionId;});
  /* LAN 접수는 로컬만 제거 (릴레이 서버 호출 불필요) */
  if(!(rec&&rec._fromLan)){
    const cfg = _getCfg();
    if(cfg.relayUrl&&cfg.nurseToken&&cfg.channelId){
      _completingReceptions.add(receptionId);
      fetch(cfg.relayUrl+'/api/v1/nurse/receptions/'+encodeURIComponent(cfg.channelId)+'/'+encodeURIComponent(receptionId)+'/complete',{
        method:'POST',signal:AbortSignal.timeout(8000),
        headers:{'Authorization':'Bearer '+cfg.nurseToken,'Content-Type':'application/json'}
      }).then(function(response){if(!response.ok) throw new Error('Completion failed');})
        .catch(function(){_toast('접수 완료를 전송하지 못했습니다. 연결이 복구되면 대기 목록을 다시 확인합니다.');})
        .finally(function(){_completingReceptions.delete(receptionId);_queueRevision++;});
    }
  }
  _queueRevision++;
  _receptions = _receptions.filter(function(r){return r.id!==receptionId;});
  delete _callCounts[receptionId];
  _syncToSidebar();
  _render();
}

/* Reconnect on channel/credential changes, ignoring callbacks from older sockets. */
function _connect(){
  if(!S.kioskSettings.active || (window.__isWebBrowser && !S._kioskSharedLoaded)) return;
  const cfg=_getCfg(), key=_cfgKey(cfg);
  if(!cfg.relayUrl || !cfg.nurseToken || !cfg.channelId){_disconnectQuiet();return;}
  if(key===_rejectedConnectionKey) return;
  if(_ws && _connectionKey===key && (_ws.readyState===WebSocket.CONNECTING || _ws.readyState===WebSocket.OPEN)) return;
  _disconnectQuiet();
  const channel=JSON.stringify([cfg.relayUrl,cfg.channelId]);
  const channelChanged=!!_queueChannel && _queueChannel!==channel;
  _queueChannel=channel;
  _connectionKey=key;
  if(channelChanged){
    _receptions=_receptions.filter(function(r){return r._fromLan;});
    _callCounts={};_queueRevision++;
  }
  const wsUrl=cfg.relayUrl.replace(/^http/,'ws')+'/ws?role=nurse&token='+encodeURIComponent(cfg.nurseToken);
  let socket;
  try{socket=new WebSocket(wsUrl);_ws=socket;}
  catch(_){_reconnectTimer=setTimeout(_connect,5000);return;}
  if(channelChanged){_syncToSidebar();_render();}
  socket.onopen=function(){
    if(_ws!==socket) return;
    _connected=true;
    _kioskClientCount=0;window._kioskClientCnt=0;
    bus.emit('kiosk:relay-status',true);
    _render();_pollRelayQueue();
  };
  socket.onmessage=function(ev){
    if(_ws!==socket) return;
    try{
      const msg=JSON.parse(ev.data);
      if(msg.type==='queue_snapshot'){
        _replaceRelayQueue(msg.payload && msg.payload.receptions);
      }else if(msg.type==='reception_new'){
        const rec=_normalizeReception(msg.payload);
        if(!rec || _completingReceptions.has(rec.id)) return;
        const index=_receptions.findIndex(function(r){return String(r.id)===rec.id;});
        if(index<0) _receptions.push(rec); else _receptions[index]=rec;
        _queueRevision++;_syncToSidebar();
        if(index<0){
          try{new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play();}catch(_){}
          _toast('키오스크 접수: '+((rec.person && rec.person.name)||'방문자'));
        }
        _render();
      }else if(msg.type==='reception_complete' && msg.payload && msg.payload.id!=null){
        const id=String(msg.payload.id);
        _receptions=_receptions.filter(function(r){return String(r.id)!==id;});
        delete _callCounts[id];_queueRevision++;
        _syncToSidebar();_render();
      }else if(msg.type==='roster_request'){
        _handleRosterRequest(msg.payload);
      }else if(msg.type==='kiosk_count'){
        _kioskClientCount=Math.max(0,Number(msg.payload && msg.payload.count)||0);
        window._kioskClientCnt=_kioskClientCount;
        bus.emit('kiosk:client-count',_kioskClientCount);
        _render();
      }
    }catch(_){console.warn('[KIOSK-PANEL] Invalid relay message');}
  };
  socket.onclose=function(ev){
    if(_ws!==socket) return;
    _ws=null;_connectionGeneration++;
    _connected=false;_kioskClientCount=0;window._kioskClientCnt=0;
    bus.emit('kiosk:relay-status',false);
    _render();
    if(ev.code===4001){
      _rejectedConnectionKey=key;
      if(window.__isWebBrowser){
        // A stale browser token must not disable the host's shared kiosk.
        refreshSharedKioskSettings();
        return;
      }
      S.kioskSettings.channelId='';
      S.kioskSettings.authToken='';
      S.kioskSettings.nurseToken='';
      S.kioskSettings.active=false;
      saveKioskSettings();
      _toast('릴레이 채널이 만료되었습니다. 키오스크를 다시 활성화해 주세요.');
      bus.emit('kiosk:sidebar-refresh');
      return;
    }
    if(_reconnectTimer) clearTimeout(_reconnectTimer);
    if(S.kioskSettings.active) _reconnectTimer=setTimeout(_connect,5000);
  };
  socket.onerror=function(){ /* onclose and periodic reconciliation recover. */ };
}

function _disconnectQuiet(){
  if(_reconnectTimer){clearTimeout(_reconnectTimer);_reconnectTimer=null;}
  _connectionGeneration++;
  if(_queueRequest){_queueRequest.abort();_queueRequest=null;}
  if(_ws){
    const socket=_ws;_ws=null;
    socket.onopen=null;socket.onmessage=null;socket.onclose=null;socket.onerror=null;
    try{socket.close();}catch(_){}
  }
  _connectionKey='';_connected=false;
  _kioskClientCount=0;window._kioskClientCnt=0;
}
let _rosterChangedListenerSet=false;
function _init(){
  /* 명단 변동 시 → 연결된 키오스크에 캐시 무효화 신호(이름 없음) 발사 (2026-06-14) */
  if(!_rosterChangedListenerSet){ _rosterChangedListenerSet=true; bus.on('kiosk:roster-changed', kioskBroadcastRosterChanged); }
  /* active일 때만 릴레이 연결 */
  if(!_reconcileTimer){
    _reconcileTimer=setInterval(_reconcileKiosk,15000);
    window.addEventListener('online',_reconcileKiosk);
    document.addEventListener('visibilitychange',function(){if(!document.hidden) _reconcileKiosk();});
  }
  _reconcileKiosk();
  if(S.kioskSettings.active){
    var cfg = _getCfg();
    if(cfg.relayUrl && cfg.channelId && cfg.nurseToken){
      _connect();
    }
  }
  /* LAN WebSocket 메시지 수신 (kiosk-ws-service → main → renderer) */
  if(window.electronAPI&&window.electronAPI.onKioskWsMessage&&!_kioskLanListenerSet){
    _kioskLanListenerSet=true;
    window.electronAPI.onKioskWsMessage(function(msg){
      if(!msg)return;
      if(msg.type==='reception'){
        const payload=msg.payload||{};
        const recId='lan_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
        /* 증상/아이템 데이터 매핑 */
        const syms=[];
        if(payload.type==='nurse'&&payload.label) syms.push(payload.label);
        if(payload.type==='supply'&&payload.item) syms.push(payload.item);
        _receptions.push({
          id:recId,
          person:payload.personal||{},
          options:[{label:payload.type==='supply'?'물품 수령':payload.type==='counseling'?'상담 요청':'보건교사 만남'}],
          symptoms:syms,
          treatments:[],
          bodymap:payload.zone?[{zone:payload.zone,label:payload.label}]:[],
          type:payload.type||'nurse',
          created_at:payload.time||new Date().toISOString(),
          _fromLan:true
        });
        try{new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play();}catch(e){}
        const nm=(payload.personal&&payload.personal.name)||'방문자';
        _toast('🏥 LAN 키오스크 접수: '+nm);
        _connected=true;
        _syncToSidebar();
        _render();
      } else if(msg.type==='collab_hello'){
        /* 동료 접속 — 전광판+설정 반영 */
        S._collabPeer={name:msg.name||'',school:msg.school||'',position:msg.position||'',stuCount:msg.stuCount||0,staffCount:msg.staffCount||0};
        S._collabServerConnected=true;
        bus.emit('collab:peer-changed');
        _toast('👩‍⚕️ 동료 접속: '+(msg.name||'사용자'));
      } else if(msg.type==='client-disconnect'){
        /* 연결된 클라이언트가 0이면 연결 상태 리셋 */
        if(window.electronAPI&&window.electronAPI.kioskWsStatus){
          window.electronAPI.kioskWsStatus().then(function(s){
            if(s&&s.clients===0){
              _connected=false;
              S._collabPeer=null;
              S._collabServerConnected=false;
              bus.emit('collab:peer-changed');
            }
            _render();
          });
        } else { _render(); }
      }
    });
  }
  _render();
}

/* DOMContentLoaded 이후 자동 초기화 */
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(_init, 500); });
} else {
  setTimeout(_init, 500);
}

/* ══════════════════════════════════════════
   접속자 상호 표시 — /api/sessions 폴링
   Electron 호스트 + 웹 브라우저 양쪽 모두 자기 자신을 세션으로 등록하고,
   /api/sessions 를 15초마다 조회해 본인을 제외한 다른 접속자를 전광판(S._collabPeer)에 반영.
   ══════════════════════════════════════════ */
function _getCollabSessionId(){
  if(window.__isWebBrowser){
    return sessionStorage.getItem('_webSessionId')||'';
  }
  /* Electron 호스트 — 고정 세션 ID (실행 동안 유지) */
  if(!window.__hostSessionId){
    window.__hostSessionId='host-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  }
  return window.__hostSessionId;
}
function _getCollabApiBase(){
  /* 웹 브라우저는 상대경로, Electron은 로컬 3000 */
  return window.__isWebBrowser?'':'http://localhost:3000';
}
function _registerSelfSession(){
  const u=S._currentUser||{};
  const up=(function(){try{return JSON.parse(localStorage.getItem('ec_user')||'{}');}catch(e){return {};}})();
  const hs=(function(){try{return JSON.parse(localStorage.getItem('ec_settings')||'{}');}catch(e){return {};}})();
  const payload={
    name:u.name||up.name||hs.nurse1||'',
    school:u.school_name||up.school||hs.schoolName||'',
    position:u.position||up.position||'',
    /* host = Electron 본체, client = 웹 브라우저 접속자 */
    type: window.__isWebBrowser?'client':'host'
  };
  if(!payload.name&&!payload.school&&!payload.position)return;
  const sid=_getCollabSessionId();
  if(!sid)return;
  fetch(_getCollabApiBase()+'/api/session-identity',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Session-Id':sid},
    body:JSON.stringify(payload)
  }).catch(function(){});
}
function _pollWebSessions(){
  const mySid=_getCollabSessionId();
  const mySidShort=(mySid||'').substring(0,8);
  /* 자기 세션도 계속 등록 유지 (호스트/웹 공통) */
  _registerSelfSession();
  fetch(_getCollabApiBase()+'/api/sessions',{
    cache:'no-store',
    headers:{'X-Session-Id':mySid}
  })
    .then(function(r){return r.ok?r.json():null;})
    .then(function(data){
      if(!data||!data.success)return;
      const prevHadWeb=!!(S._collabPeer&&S._collabPeer._source==='web');
      /* 자기 자신은 제외 */
      const others=(data.sessions||[]).filter(function(s){return s.id!==mySidShort;});
      const othersWithIdentity=others.filter(function(s){return s.userName||s.userSchool||s.userPosition;});
      if(othersWithIdentity.length>0){
        /* 첫 번째 동료를 _collabPeer 단일 변수로 (전광판 호환). 나머지는 외 N명 suffix. */
        const sess=othersWithIdentity[0];
        const suffix=othersWithIdentity.length>1?' 외 '+(othersWithIdentity.length-1)+'명':'';
        S._collabPeer={
          _source:'web',
          name:(sess.userName||sess.ip||'접속자')+suffix,
          school:sess.userSchool||'',
          position:sess.userPosition||'',
          type:sess.type||'client',
          stuCount:undefined,
          staffCount:undefined
        };
        /* 동료 전체 목록 — A안 N장 카드 렌더용. type/이름/학교/직위까지 보존. */
        S._collabPeers=othersWithIdentity.map(function(s){
          return {
            _source:'web',
            id:s.id,
            name:s.userName||s.ip||'접속자',
            school:s.userSchool||'',
            position:s.userPosition||'',
            type:s.type||'client'
          };
        });
        S._collabServerConnected=true;
        bus.emit('collab:peer-changed');
      } else if(prevHadWeb){
        S._collabPeer=null;
        S._collabPeers=[];
        S._collabServerConnected=false;
        bus.emit('collab:peer-changed');
      }
    })
    .catch(function(){
      if(S._collabPeer&&S._collabPeer._source==='web'){
        S._collabPeer=null;
        bus.emit('collab:peer-changed');
      }
    });
}
/* 웹서버 폴링 — 무조건 시작하지 않고 web-server-started 이벤트 시점에만 활성화.
 * 그 전엔 localhost:3000 폴링이 ERR_CONNECTION_REFUSED 로 콘솔을 시끄럽게 함.
 * Web 브라우저(window.__isWebBrowser)는 자기 호스트로 항상 폴링. */
let _wsPollTimer=null;
function _startWebSessionPolling(){
  if(_wsPollTimer)return;
  setTimeout(_pollWebSessions,2000);
  _wsPollTimer=setInterval(_pollWebSessions,15000);
}
function _stopWebSessionPolling(){
  if(_wsPollTimer){clearInterval(_wsPollTimer);_wsPollTimer=null;}
}
if(window.__isWebBrowser){
  _startWebSessionPolling();
} else if(window.electronAPI){
  if(window.electronAPI.onWebServerStarted)window.electronAPI.onWebServerStarted(_startWebSessionPolling);
  if(window.electronAPI.onWebServerStopped)window.electronAPI.onWebServerStopped(_stopWebSessionPolling);
  /* 회귀 fix (2026-05-15): 호스트 Electron 이 부팅될 때 이미 web-server 자식이 'listening' 까지
   * 도달했으면 'web-server-started' 이벤트는 mainWindow 준비 전에 발화되어 손실된다.
   * 그 결과 호스트가 자기 세션을 /api/session-identity 에 등록하지 못해 클라이언트의
   * 전광판 오른편 호스트 표시가 비어 있던 회귀. 부팅 직후 상태를 직접 조회해
   * running 이면 즉시 폴링 시작 — _wsPollTimer 가드로 중복 시작은 방지된다. */
  if(window.electronAPI.webServerStatus){
    window.electronAPI.webServerStatus().then(function(s){
      if(s&&s.running) _startWebSessionPolling();
    }).catch(function(){});
  }
}

/* 외부에서 재초기화할 수 있도록 */

/* 키오스크 활성화/채널 생성 후 재연결 트리거 */
bus.on('kiosk:sidebar-refresh', function(){
  if(!S.kioskSettings.active){
    _disconnectQuiet();
    _render();
    return;
  }
  var cfg = _getCfg();
  if(cfg.relayUrl && cfg.channelId && cfg.nurseToken){
    _connect();
  }
  _render();
});
