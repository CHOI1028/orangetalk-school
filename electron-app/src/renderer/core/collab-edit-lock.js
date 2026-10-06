/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* collab-edit-lock.js — 협업 부드러운 잠금(soft lock)
 *
 * 목적: 두 사람이 같은 방문 레코드를 동시에 열어 수정하다 충돌하는 것을 "경고"로 예방.
 *   · 강제 차단 아님 — 사용자가 "그래도 열기" 가능 (충돌 시 규칙은 last-write-wins).
 *   · 서버(web-server) 의 /api/edit-lock 엔드포인트와 짝. heartbeat(5초)로 유지, 서버 TTL(12초)로 비정상 종료 시 자동 해제.
 *   · 협업(웹 서버)이 꺼져 있으면 모든 fetch 가 실패 → 조용히 무시(잠금/경고 없음). 단독 사용엔 무영향.
 */
import { S } from './app-state.js';
import { escHtml } from './helpers.js';
import { getActiveBaseUrl } from './data-loader.js';

function _base(){
  try { if(typeof getActiveBaseUrl === 'function') return getActiveBaseUrl(); } catch(_){}
  try { if(typeof window._getActiveBaseUrl === 'function') return window._getActiveBaseUrl(); } catch(_){}
  return window.__isWebBrowser ? window.location.origin : 'http://localhost:3000';
}
/* 세션 식별자 — 웹은 web-api-bridge 가 심은 _webSessionId, Electron 호스트는 없으면 생성해 저장. */
function _sid(){
  try {
    let s = sessionStorage.getItem('_webSessionId');
    if(!s){ s = 'host-' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); sessionStorage.setItem('_webSessionId', s); }
    return s;
  } catch(_){ return ''; }
}
function _myName(){
  try {
    const u = (S && S._currentUser) || {};
    return u.name || (S && S.settings && S.settings.nurse1) || '';
  } catch(_){ return ''; }
}

/* 특정 레코드가 "다른 사람"에 의해 편집 중인지 조회. 실패(협업 꺼짐 등) 시 {locked:false}. */
export function checkEditLock(recId){
  const rid = String(recId);
  return fetch(_base() + '/api/edit-lock?recordId=' + encodeURIComponent(rid), {
    headers: { 'X-Session-Id': _sid() }, cache: 'no-store'
  })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){ return (d && d.success) ? { locked: !!d.locked, name: d.name || '' } : { locked: false }; })
    .catch(function(){ return { locked: false }; });
}

let _heldRecId = null;
let _hbTimer = null;
function _hbSend(){
  if(!_heldRecId) return;
  fetch(_base() + '/api/edit-lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': _sid() },
    body: JSON.stringify({ recordId: _heldRecId, name: _myName() })
  }).catch(function(){});
}
/* 편집 잠금 획득 + heartbeat 시작. 다른 레코드를 잡고 있었으면 먼저 해제(팝업 학생 교체 대응). */
export function acquireEditLock(recId){
  const rid = String(recId);
  if(_heldRecId && _heldRecId !== rid) releaseEditLock();
  _heldRecId = rid;
  _hbSend();
  if(_hbTimer) clearInterval(_hbTimer);
  _hbTimer = setInterval(_hbSend, 5000); /* 5초 < 서버 TTL 12초 */
}
/* 편집 잠금 해제 + heartbeat 중지. (팝업 닫힐 때 호출. 탭 강제종료 등은 서버 TTL 이 정리.) */
export function releaseEditLock(){
  if(_hbTimer){ clearInterval(_hbTimer); _hbTimer = null; }
  const rid = _heldRecId;
  _heldRecId = null;
  if(!rid) return;
  fetch(_base() + '/api/edit-unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': _sid() },
    body: JSON.stringify({ recordId: rid })
  }).catch(function(){});
}

/* 중앙 경고 모달 — "○○ 선생님이 수정 중입니다 [그래도 열기][닫기]".
 * Promise<boolean> 반환: true=그래도 열기, false=닫기/취소. */
export function showEditLockWarning(name){
  return new Promise(function(resolve){
    const _prev = document.getElementById('collabLockWarn');
    if(_prev) _prev.remove();
    let _settled = false;
    const _done = function(v){ if(_settled) return; _settled = true; document.removeEventListener('keydown', _onKey, true); if(ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); };
    const ov = document.createElement('div');
    ov.id = 'collabLockWarn';
    ov.style.cssText = 'position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);opacity:0;transition:opacity .18s ease';
    const who = (name && String(name).trim()) ? (escHtml(String(name).trim()) + ' 선생님') : '다른 선생님';
    ov.innerHTML =
      '<div class="modal-content" style="width:380px;max-width:92vw;padding:0;border-radius:14px;overflow:hidden;transform:scale(0.94);opacity:0;transition:transform .22s cubic-bezier(0.34,1.56,0.64,1),opacity .2s ease;box-shadow:0 14px 50px rgba(0,0,0,0.3)">'
      + '<div style="padding:14px 20px;background:rgba(6,182,212,0.10);border-bottom:1px solid var(--bdr);color:var(--t1);font-size:14px;font-weight:800">⚠️ 동시 수정 주의</div>'
      + '<div style="padding:22px 24px;text-align:center;background:var(--card)">'
      +   '<div style="font-size:34px;margin-bottom:10px">✏️</div>'
      +   '<div style="font-size:13px;color:var(--t1);line-height:1.7">지금 <b style="color:var(--cyan)">' + who + '</b>이 이 학생을 수정 중입니다.<br><span style="font-size:11.5px;color:var(--t3)">그래도 열면 마지막에 저장한 내용이 우선됩니다.</span></div>'
      +   '<div style="display:flex;gap:8px;margin-top:18px;justify-content:center">'
      +     '<button data-act="cancel" style="padding:8px 18px;border-radius:8px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t1);font-size:12.5px;font-weight:700;cursor:pointer;font-family:var(--f)">닫기</button>'
      +     '<button data-act="open" style="padding:8px 18px;border-radius:8px;border:1px solid #d97706;background:rgba(217,119,6,0.12);color:#d97706;font-size:12.5px;font-weight:800;cursor:pointer;font-family:var(--f)">그래도 열기</button>'
      +   '</div>'
      + '</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.style.opacity = '1'; const c = ov.querySelector('.modal-content'); if(c){ c.style.transform = 'scale(1)'; c.style.opacity = '1'; } });
    ov.addEventListener('click', function(e){
      const btn = e.target.closest('[data-act]');
      if(btn){ _done(btn.getAttribute('data-act') === 'open'); return; }
      if(e.target === ov) _done(false); /* 바깥 클릭 = 닫기 */
    });
    function _onKey(e){ if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); _done(false); } else if(e.key === 'Enter'){ e.preventDefault(); _done(true); } }
    document.addEventListener('keydown', _onKey, true);
  });
}
