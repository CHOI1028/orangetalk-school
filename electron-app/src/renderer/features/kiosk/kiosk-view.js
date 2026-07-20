/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   KIOSK MODULE — Core (Home + Sidebar + Save)
   ═══════════════════════════════════════ */
/* ES Module */
import { escHtml, isKinder } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { S, saveKioskSettings } from '../../core/app-state.js';
import { svCopyToClipboard } from '../survey/survey-view.js';
import { renderSettingsPanel, openSettings, switchSettingsCat } from '../settings/settings-view.js';
'use strict';

  /* kioskSettings는 app-state.js에서 localStorage 로드 완료 */

  /* 릴레이 WebSocket 연결 상태 추적 */
  let _relayConnected = false;
  let _kioskClientCount = 0;
  bus.on('kiosk:relay-status', function(connected){
    _relayConnected = !!connected;
    if(!connected) _kioskClientCount = 0;
    kioskUpdateSidebar();
  });
  bus.on('kiosk:client-count', function(count){
    _kioskClientCount = count || 0;
    kioskUpdateSidebar();
  });

  /* 10초마다 사이드바 상태 갱신 */
  setInterval(function(){
    if(S.kioskSettings.active) kioskUpdateSidebar();
  }, 10000);

  /* 설정 모달 닫힐 때 사이드바 동기화 (순환 의존성 우회) */
  bus.on('kiosk:sidebar-refresh', function(){ kioskUpdateSidebar(); });

  /* ── 공유 저장 함수 ── */
  export function _kioskSave(){
    saveKioskSettings();
    if(window._kioskPushToRelay) window._kioskPushToRelay();
  }

  /* ── 홈 탭 렌더링 ── */
  export function kioskRenderHome(){
    const el=document.getElementById('kiosk-home');if(!el)return;
    const school=S.settings.schoolName||'OO학교';
    const isActive=S.kioskSettings.active||false;
    const kioskUrl=S.kioskSettings.url||'';
    let h='<div class="sv-header"><div><div class="sv-title">키오스크 관리</div><div class="sv-subtitle">보건실 방문 학생이 직접 입력할 수 있는 키오스크 화면을 관리합니다.</div></div></div>';

    /* 상태 카드 */
    h+='<div class="cc" style="padding:16px;margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center">'
      +'<div style="display:flex;align-items:center;gap:12px">'
      +'<div style="width:12px;height:12px;border-radius:50%;background:'+(isActive?'var(--gs)':'var(--t3)')+';flex-shrink:0;box-shadow:0 0 6px '+(isActive?'rgba(34,197,94,0.5)':'transparent')+'"></div>'
      +'<div><div style="font-size:13px;font-weight:700;color:var(--t1)">'+(isActive?'키오스크 활성화 중':'키오스크 비활성')+'</div>'
      +'<div style="font-size:10px;color:var(--t3)">'+(isActive?'학생이 태블릿/PC에서 직접 입력 가능':'활성화하면 학생 자가 입력이 가능합니다')+'</div></div></div>'
      +'</div></div>';

    /* 키오스크 설정 */
    h+='<div style="display:flex;gap:14px">';

    /* 좌측: 설정 */
    h+='<div style="flex:1"><div class="sv-section-title">키오스크 설정</div>';
    h+='<div class="cc" style="padding:14px;margin-bottom:12px">'
      +'<div class="form-group" style="margin-bottom:10px"><label class="form-label">키오스크 접속 URL</label>'
      +'<div style="display:flex;gap:6px"><input class="form-input" id="kioskUrlInput" value="'+escHtml(kioskUrl||'https://example.com/kiosk/'+school)+'" style="flex:1;font-size:11px;font-family:var(--fm)" readonly>'
      +'<button class="sv-btn" data-action="kiosk-copy-url">📋 복사</button></div></div>'
      +'<div class="form-group"><label class="form-label">키오스크 화면 표시 항목</label>'
      +'<div style="display:flex;flex-direction:column;gap:6px">'
      +'<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer"><input type="checkbox" checked data-kiosk-field="showGrade"> 학년/반/번호 입력</label>'
      +'<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer"><input type="checkbox" checked data-kiosk-field="showSymptoms"> 증상 선택</label>'
      +'<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer"><input type="checkbox" data-kiosk-field="showTemp"> 체온 입력</label>'
      +'<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer"><input type="checkbox" data-kiosk-field="showMemo"> 메모/추가 사항</label>'
      +'</div></div></div>';

    h+='</div>';

    /* 우측: 미리보기 + 통계 */
    h+='<div style="flex:1"><div class="sv-section-title">키오스크 화면 미리보기</div>';
    h+='<div class="cc" style="padding:0;overflow:hidden;margin-bottom:12px">'
      +'<div style="background:linear-gradient(135deg,#0e7490,#06b6d4);padding:16px 20px;color:#fff">'
      +'<div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:4px">🏥 '+escHtml(school)+' 보건실</div>'
      +'<div style="font-size:11px;text-align:center;opacity:0.8">방문 학생 자가 입력</div></div>'
      +'<div style="padding:16px 20px;background:var(--card)">'
      +'<div style="display:flex;gap:8px;margin-bottom:10px"><input class="form-input" placeholder="학년" disabled style="flex:1;text-align:center;font-size:12px"><input class="form-input" placeholder="반" disabled style="flex:1;text-align:center;font-size:12px"><input class="form-input" placeholder="번호" disabled style="flex:1;text-align:center;font-size:12px"></div>'
      +'<input class="form-input" placeholder="이름" disabled style="width:100%;margin-bottom:10px;text-align:center;font-size:13px;font-weight:700;box-sizing:border-box">'
      +'<div style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:6px">증상 선택</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">'
      +'<span style="padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:10px;color:var(--t2);background:var(--bg2)">두통</span>'
      +'<span style="padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:10px;color:var(--t2);background:var(--bg2)">복통</span>'
      +'<span style="padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:10px;color:var(--t2);background:var(--bg2)">발열</span>'
      +'<span style="padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:10px;color:var(--t2);background:var(--bg2)">어지러움</span>'
      +'<span style="padding:4px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:10px;color:var(--t2);background:var(--bg2)">기타</span></div>'
      +'<button class="sv-btn-primary" disabled style="width:100%;padding:10px;font-size:13px">입실 등록</button>'
      +'</div></div>';

    /* 오늘 키오스크 입력 현황 */
    h+='<div class="sv-section-title">오늘 키오스크 입력 현황</div>';
    const kioskToday=JSON.parse(localStorage.getItem('ec_kiosk_today')||'[]');
    if(!kioskToday.length){
      h+='<div class="cc" style="padding:16px;text-align:center;color:var(--t3);font-size:12px">오늘 키오스크를 통한 입력이 없습니다.</div>';
    } else {
      h+='<div class="cc" style="padding:10px;overflow-x:auto"><table class="rec-table"><thead><tr><th>시간</th><th>학년반</th><th>이름</th><th>증상</th><th>상태</th></tr></thead><tbody>';
      kioskToday.forEach(function(k){h+='<tr><td>'+k.time+'</td><td>'+k.grade+'-'+k.cls+'</td><td style="font-weight:600">'+k.name+'</td><td>'+k.symptoms+'</td><td><span class="sv-stat-badge active">입실</span></td></tr>';});
      h+='</tbody></table></div>';
    }
    h+='</div>';
    h+='</div>';
    el.innerHTML=h;

    /* addEventListener 바인딩 */
    const copyBtn=el.querySelector('[data-action="kiosk-copy-url"]');
    if(copyBtn)copyBtn.addEventListener('click',function(){
      const urlInput=document.getElementById('kioskUrlInput');
      if(urlInput)svCopyToClipboard(urlInput.value);
    });
    el.querySelectorAll('[data-kiosk-field]').forEach(function(cb){
      cb.addEventListener('change',function(){kioskUpdateField(this.dataset.kioskField,this.checked);});
    });
  }

  function kioskUpdateField(field,val){
    S.kioskSettings[field]=val;
    _kioskSave();
  }

  /* ── 사이드바 위젯 ── */
  export function kioskUpdateSidebar(){
    if(typeof S.kioskSettings==='undefined') return;
    const isActive=S.kioskSettings.active||false;
    console.log('[KIOSK-SIDEBAR] active='+isActive+' channelId='+(S.kioskSettings.channelId||'(none)')+' relayConn='+_relayConnected+' kioskClients='+_kioskClientCount);
    const sidePanel=document.getElementById('kioskSidePanel');
    const mainCal=document.getElementById('mainCalendar');
    if(!sidePanel||!mainCal)return;
    /* 유치원용: 키오스크 사이드 패널 숨기고 달력을 바로 표시 */
    const _isK=typeof isKinder==='function'&&isKinder();
    if(_isK){
      sidePanel.style.display='none';
      mainCal.style.display='';
      mainCal.style.marginTop='';
      /* 키오스크 패널이 없으므로 방문이력 카드가 더 많은 공간 사용 */
      const rc=document.getElementById('recentCompact');
      if(rc)rc.style.maxHeight='260px';
      const vhb=document.getElementById('visitHistoryBody');
      if(vhb)vhb.style.maxHeight='calc(100vh - 520px)';
      return;
    }
    if(!isActive){
      sidePanel.style.display='none';
      mainCal.style.display='';
      mainCal.style.marginTop='';
      return;
    }
    sidePanel.style.display='block';
    mainCal.style.display='';
    mainCal.style.marginTop='';
    const statusDot=sidePanel.querySelector('[data-kiosk-dot]');
    const statusLabel=sidePanel.querySelector('[data-kiosk-label]');
    /* 상태 라벨 클릭 → 설정의 키오스크 설정 바로 열기 (사용자 요청 2026-06-14) */
    if(statusLabel&&!statusLabel._kvNavBound){
      statusLabel._kvNavBound=true;
      statusLabel.style.cursor='pointer';
      statusLabel.setAttribute('data-tooltip','클릭하면 키오스크 설정이 열립니다');
      statusLabel.setAttribute('data-tooltip-instant','1');
      statusLabel.addEventListener('click',function(){
        try{ if(typeof openSettings==='function') openSettings(); }catch(e){}
        setTimeout(function(){
          try{
            const el=document.querySelector('.settings-sidebar-item[data-cat="kiosk"]');
            if(el&&typeof switchSettingsCat==='function') switchSettingsCat('kiosk',el);
            else if(typeof renderSettingsPanel==='function') renderSettingsPanel('kiosk');
          }catch(e){}
        },70);
      });
    }
    if(statusDot&&statusLabel){
      if(_relayConnected&&_kioskClientCount>0){
        /* 키오스크 HTML 연결됨 — 초록색 */
        statusDot.style.background='var(--gs)';statusDot.style.boxShadow='0 0 4px rgba(34,197,94,0.5)';statusDot.style.opacity='1';
        statusLabel.textContent='키오스크 활성(연결됨)';statusLabel.style.color='var(--gs)';
      } else if(_relayConnected){
        /* 릴레이 연결됨, 키오스크 HTML 미접속 — 노란색 */
        statusDot.style.background='#eab308';statusDot.style.boxShadow='0 0 4px rgba(234,179,8,0.5)';statusDot.style.opacity='1';
        statusLabel.textContent='키오스크 활성(대기 중)';statusLabel.style.color='#eab308';
      } else {
        /* 릴레이 미연결 — 빨간색 */
        statusDot.style.background='#ef4444';statusDot.style.boxShadow='0 0 4px rgba(239,68,68,0.5)';statusDot.style.opacity='1';
        statusLabel.textContent='키오스크 활성(미연결)';statusLabel.style.color='#ef4444';
      }
    }
    /* 사이드바는 상태 표시만 (대기 목록/처리는 수신 패널에서) */
  }

  setTimeout(function(){kioskUpdateSidebar();},500);


