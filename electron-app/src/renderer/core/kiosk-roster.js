/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* kiosk-roster.js — 키오스크 명단 동기화 */
import { S, DEFAULT_RELAY_URL } from './app-state.js';
import { _reloadStudentsFromDB } from './student-utils.js';
import { bus } from './event-bus.js';

let _rosterPushTimer=null;
let _kioskDailyRosterTimer=null;

/* 명단(이름·학년·반·성별 등 개인정보) 의 릴레이 서버 업로드는 폐지 — 개인정보 보호 정책 변경.
 * 새 명단은 키오스크 HTML 재생성·재배포 흐름으로 반영한다. (이름 등 PII 는 절대 서버를 거치지 않음)
 * 이 함수는 호환을 위해 시그니처 유지하되 서버 PUT 은 하지 않고 재시작 안내만 띄운다. */
export function _pushRosterToRelay(){
  if(_rosterPushTimer)clearTimeout(_rosterPushTimer);
  _rosterPushTimer=setTimeout(function(){
    /* 온디맨드 명단(rosterSecret 있는 릴레이 채널)이면 — 키오스크에 변동 신호만 쏜다(이름 없음).
     *  키오스크가 캐시를 비우고 다음 조회 때 최신 명단을 받아간다 → 재시작/재생성 불필요. (2026-06-14)
     *  임베드/다운로드 키오스크(rosterSecret 없음)는 옛 방식대로 재시작 안내. */
    try {
      const ks=(S&&S.kioskSettings)||JSON.parse(localStorage.getItem('ec_kiosk_settings')||'{}');
      if(ks && ks.rosterSecret && ks.channelId){ bus.emit('kiosk:roster-changed'); return; }
    } catch(_){}
    _showKioskRestartNotice();
  },30000);
}

export function _showKioskRestartNotice(){
  try {
    const ks=JSON.parse(localStorage.getItem('ec_kiosk_settings')||'{}');
    const relayUrl=ks.relayUrl||DEFAULT_RELAY_URL;const channelId=ks.channelId||'';
    if(!relayUrl||!channelId)return;
    const ex=document.getElementById('kioskRestartNotice');if(ex)ex.remove();
    const ov=document.createElement('div');
    ov.id='kioskRestartNotice';
    ov.style.cssText='position:fixed;inset:0;z-index:15000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s ease';
    ov.innerHTML='<div class="modal-content" style="width:420px;max-width:92vw;padding:0;overflow:hidden;transform:scale(0.92);opacity:0;transition:transform .3s cubic-bezier(0.34,1.56,0.64,1),opacity .3s ease;border-radius:14px">'
      +'<div style="padding:14px 20px;background:#e2e8f0;border-bottom:1px solid #cbd5e1;color:#334155;font-size:14px;font-weight:800">키오스크 재시작 안내</div>'
      +'<div style="padding:22px 26px;text-align:center;background:var(--card)">'
      +'<div style="font-size:42px;margin-bottom:12px">🔄</div>'
      +'<div style="font-size:13px;color:var(--t1);line-height:1.8">학생 또는 교직원 명단이 변경되었습니다.<br><b style="color:var(--cyan)">키오스크를 재시작하세요.</b><br>태블릿·노트북의 브라우저를 종료 후 다시 열면 최신 명단이 자동으로 반영됩니다.</div>'
      +'</div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function(){
      ov.style.opacity='1';
      const c=ov.querySelector('.modal-content');
      if(c){c.style.transform='scale(1)';c.style.opacity='1';}
    });
    setTimeout(function(){
      const c=ov.querySelector('.modal-content');
      if(c){c.style.transform='scale(0.92)';c.style.opacity='0';}
      ov.style.opacity='0';
      setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},320);
    },4200);
  } catch(e){}
}

export function _checkKioskRosterStale(){
  try {
    const expCount=parseInt(localStorage.getItem('ec_kiosk_html_export_count')||'0',10);
    const expHash=localStorage.getItem('ec_kiosk_html_export_hash')||'';
    if(expCount<=0)return;
    if(!Array.isArray(S.people))return;
    const cur=S.people.filter(function(p){return p&&p.name&&(!p.status||p.status==='normal'||p.status==='active');});
    const curHash=String(cur.reduce(function(a,p){return a+(p.name.length)+(String(p.uid||p.id||'').length);},0));
    const dateStr=new Date().toISOString().slice(0,10);
    localStorage.setItem('ec_kiosk_roster_last_check',dateStr);
    if(curHash!==expHash){
      if(localStorage.getItem('ec_kiosk_html_roster_stale')!=='1'){
        console.log('[KIOSK] 명단 변동 감지 — 키오스크 HTML 재다운로드 권장 (exp:'+expCount+' / cur:'+cur.length+')');
      }
      localStorage.setItem('ec_kiosk_html_roster_stale','1');
    } else {
      localStorage.removeItem('ec_kiosk_html_roster_stale');
    }
  } catch(e){}
}

export function _scheduleDailyRosterCheck(){
  if(_kioskDailyRosterTimer)return;
  function _tick(){
    try {
      const today=new Date().toISOString().slice(0,10);
      const lastDate=localStorage.getItem('ec_kiosk_roster_last_check')||'';
      if(lastDate!==today){
        _reloadStudentsFromDB().then(function(){_checkKioskRosterStale();}).catch(function(){});
      }
    } catch(e){}
  }
  _kioskDailyRosterTimer = setInterval(_tick, 60*60*1000);
}
