/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* conn-toast.js — 연결 상태(끊김/재연결/복구/실패) 우하단 토스트
 *
 * data-loader.js 와 web-api-bridge.js 가 발행하는 'conn:*' 이벤트를 구독하여
 * 기존 .global-save-toast 와 동일한 색감 톤·위치(.right:24px;bottom:48px)·padding 으로 표시.
 *
 * 사용자 경험:
 *   - 끊김 즉시: 노란 토스트 "🔄 연결이 끊겼습니다. 같은 통로(8080포트)로 자동 재연결 중... (1/5회 시도)"
 *   - 재시도 중: 시도 횟수 갱신
 *   - 복구: 녹색 토스트 "✅ 연결이 복구되었습니다."
 *   - 폴백 시작: 노란 토스트 "🔄 다른 통로 시도 중..."
 *   - 폴백 성공: 녹색 토스트 "✅ 통로 8080 → 80 자동 전환됨"
 *   - 모두 실패: 빨간 토스트 (자동으로 사라지지 않음, 직접 닫기 가능) */

(function _initConnToast(){
  if(window._connToastInited)return;
  window._connToastInited=true;

  let _toastEl=null;
  let _autoHideTimer=null;
  let _criticalLock=false; /* 빨간 토스트는 사용자 닫기 전까지 유지 */
  /* 우선순위: failed(3) > restored(2) > reconnecting(1). 낮은 게 높은 것 덮어쓰지 못함. */
  const _PRIORITY={'reconnecting':1,'restored':2,'failed':3};
  let _currentPriority=0;

  function _ensureToast(){
    if(_toastEl)return _toastEl;
    const t=document.createElement('div');
    t.id='connToast';
    /* 기본 .global-save-toast 와 동일한 위치/모양 — 단, 상태에 따라 색을 바꿈 */
    t.style.cssText='position:fixed;right:24px;bottom:48px;z-index:99999;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;line-height:1.5;display:none;opacity:0;transform:translateY(8px);transition:all .2s ease;max-width:360px;pointer-events:auto;cursor:default';
    t.innerHTML='';
    document.body.appendChild(t);
    _toastEl=t;
    /* 클릭 시 critical 토스트 닫기 */
    t.addEventListener('click',function(){
      if(_criticalLock){_hide();_criticalLock=false;}
    });
    return t;
  }

  function _setStyle(kind){
    const t=_ensureToast();
    /* 다크/라이트 색감 — global-save-toast 와 동일 패턴 */
    const isLight=document.body.classList.contains('light');
    if(kind==='reconnecting'){
      t.style.background=isLight?'rgba(234,179,8,0.12)':'rgba(234,179,8,0.20)';
      t.style.color=isLight?'#ca8a04':'#fbbf24';
      t.style.border=(isLight?'1px solid rgba(234,179,8,0.28)':'1px solid rgba(234,179,8,0.45)');
    } else if(kind==='restored'){
      t.style.background=isLight?'rgba(34,197,94,0.12)':'rgba(34,197,94,0.20)';
      t.style.color=isLight?'#22c55e':'#4ade80';
      t.style.border=(isLight?'1px solid rgba(34,197,94,0.28)':'1px solid rgba(34,197,94,0.45)');
    } else if(kind==='failed'){
      t.style.background=isLight?'rgba(239,68,68,0.12)':'rgba(239,68,68,0.20)';
      t.style.color=isLight?'#dc2626':'#f87171';
      t.style.border=(isLight?'1px solid rgba(239,68,68,0.28)':'1px solid rgba(239,68,68,0.45)');
    }
  }

  function _show(html,kind,opts){
    opts=opts||{};
    const newPri=_PRIORITY[kind]||0;
    /* critical lock 상태에선 같은 또는 더 높은 우선순위만 갱신 허용 */
    if(_criticalLock && newPri < _PRIORITY['failed']) return;
    /* 일반 상태: 더 낮은 우선순위가 더 높은 것을 즉시 덮지 못함.
       단, 'restored' 는 'reconnecting' 을 덮어야 하므로 같은 우선순위 비교는 가능. */
    if(_currentPriority > newPri && t_visible()) {
      /* 더 높은 우선순위가 표시 중이면 큐에 잠시 보관, 자동 숨김 후 표시 */
      setTimeout(function(){_show(html,kind,opts);},800);
      return;
    }
    const t=_ensureToast();
    if(_autoHideTimer){clearTimeout(_autoHideTimer);_autoHideTimer=null;}
    _setStyle(kind);
    t.innerHTML=html;
    t.style.display='block';
    _currentPriority=newPri;
    /* 다음 frame 에 fade-in */
    requestAnimationFrame(function(){
      t.style.opacity='1';
      t.style.transform='translateY(0)';
    });
    if(opts.critical){
      _criticalLock=true;
    } else if(opts.autoHideMs){
      _criticalLock=false;
      _autoHideTimer=setTimeout(_hide,opts.autoHideMs);
    }
  }
  function t_visible(){
    return _toastEl && _toastEl.style.display==='block' && _toastEl.style.opacity!=='0';
  }

  function _hide(){
    if(_criticalLock)return;
    if(!_toastEl)return;
    _toastEl.style.opacity='0';
    _toastEl.style.transform='translateY(8px)';
    _currentPriority=0;
    setTimeout(function(){
      if(_toastEl && _toastEl.style.opacity==='0') _toastEl.style.display='none';
    },220);
  }

  function _portLabel(p){
    if(p==null)return '';
    return '('+p+'포트)';
  }

  /* ── 이벤트 구독 ── */

  /* 끊김 처음 발생 — 'lost' */
  window.addEventListener('conn:lost',function(e){
    const d=e.detail||{};
    const tries=d.failCount||1;
    const max=d.maxAttempts||5;
    const port=(window._connState&&window._connState.lastPort)||(window.location&&window.location.port)||'';
    _show('🔄 연결이 끊겼습니다. 같은 통로'+(port?'('+port+'포트)':'')+'로 자동 재연결 중... <span style="opacity:0.85">('+tries+'/'+max+'회 시도)</span>','reconnecting');
  });

  /* 재시도 중 — 'retrying' (failCount 갱신) */
  window.addEventListener('conn:retrying',function(e){
    const d=e.detail||{};
    const tries=d.failCount||1;
    const max=d.maxAttempts||5;
    const port=(window._connState&&window._connState.lastPort)||(window.location&&window.location.port)||'';
    _show('🔄 연결이 끊겼습니다. 같은 통로'+(port?'('+port+'포트)':'')+'로 자동 재연결 중... <span style="opacity:0.85">('+tries+'/'+max+'회 시도)</span>','reconnecting');
  });

  /* 폴백 시작 — 'falling_back' */
  window.addEventListener('conn:falling_back',function(e){
    const d=e.detail||{};
    const cur=d.currentPort?'('+d.currentPort+'포트)':'';
    _show('🔄 같은 통로'+cur+'가 응답하지 않습니다. 다른 통로로 시도 중...','reconnecting');
  });

  /* 복구됨 — 'restored' */
  window.addEventListener('conn:restored',function(e){
    const d=e.detail||{};
    let msg='✅ 연결이 복구되었습니다.';
    if(d.viaFallback && d.fromPort && d.toPort){
      msg='✅ 연결이 복구되었습니다. <span style="opacity:0.85">(통로 '+d.fromPort+'포트 → '+d.toPort+'포트 자동 전환됨)</span>';
    }
    _show(msg,'restored',{autoHideMs:3000});
  });

  /* 큐 flush 완료 — 'queue-flushed' (web-api-bridge.js 에서 발행) */
  window.addEventListener('conn:queue-flushed',function(){
    _show('✅ 미저장 항목이 모두 전송되었습니다.','restored',{autoHideMs:2500});
  });

  /* 페이지 로드 시 LS 큐 복원 — 'queue-restored' */
  window.addEventListener('conn:queue-restored',function(e){
    const d=e.detail||{};
    const cnt=d.count||0;
    if(cnt>0){
      _show('🔄 이전에 저장 못 한 항목 '+cnt+'건을 자동으로 전송합니다...','reconnecting',{autoHideMs:4000});
    }
  });

  /* 모두 실패 — 'all_failed' */
  window.addEventListener('conn:all_failed',function(e){
    const d=e.detail||{};
    const tried=Array.isArray(d.triedPorts)?d.triedPorts.join(', '):'';
    _show('❌ 연결 실패 — 학교 인터넷에서 모든 통로가 막혀 있습니다.<br><span style="opacity:0.85;font-weight:600;font-size:11px">시도한 통로: '+tried+'</span>','failed',{critical:true});
  });

  /* exhausted — 같은 포트 5회 실패. 폴백이 곧 시작되니 별도 토스트 없음 (falling_back 이 곧 표시됨).
     단, Electron 환경에서는 폴백 없으므로 exhausted = 최종 실패 */
  window.addEventListener('conn:exhausted',function(e){
    const d=e.detail||{};
    if(d.reason==='electron_no_fallback'){
      _show('❌ 연결 실패 — 호스트 연결이 응답하지 않습니다.','failed',{critical:true});
    }
    /* 웹 환경은 falling_back 으로 이어짐 */
  });

  /* 폴링 정지 — 'stopped' (사용자가 웹 서버 끔 / 웹 서버 자식 종료).
     진행 중이던 끊김·실패 토스트가 남아 있으면 정리. */
  window.addEventListener('conn:stopped',function(){
    _criticalLock=false;
    _hide();
  });

})();
