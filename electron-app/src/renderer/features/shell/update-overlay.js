/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* update-overlay.js — 업데이트 설치 안내 오버레이 (v2, 2026-05-27 재설계).
   두 시나리오:
     CASE A (mode='quit'): 사용자가 종료 버튼 클릭 → main.js close 핸들러가 e.preventDefault + IPC 발송
       → 본 모듈이 모달 표시 ("컴퓨터를 종료하지 마시고…") + 8초 진행 → confirmQuitAfterUpdate IPC
       → autoInstallOnAppQuit 로 자동 설치 + isForceRunAfter 로 자동 재시작
     CASE B (mode='startup'): 부팅 직후 cache 의 보류 update 감지 → IPC 발송
       → 본 모듈이 모달 표시 ("잠시만 기다려주세요…") + 짧은 안내 후 confirmQuitAfterUpdate
       → 자동 설치 + 재시작 */

(function _initUpdateOverlay(){
  if(!window.electronAPI || !window.electronAPI.onShowUpdateOverlay) return;
  if(window._updateOverlayInited) return;
  window._updateOverlayInited = true;

  const PROGRESS_MS = 8000;  /* 진행률 0→100% 시뮬레이션 시간 */
  const POST_WAIT_MS = 1500; /* 100% 도달 후 자동 종료까지 대기 */

  function _injectStyles(){
    if(document.getElementById('updateOverlayStyles')) return;
    const s = document.createElement('style');
    s.id = 'updateOverlayStyles';
    s.textContent =
      '@keyframes uoFadeIn{0%{opacity:0}100%{opacity:1}}'+
      '@keyframes uoPopIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}'+
      '@keyframes uoShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}'+
      '#updateOverlayRoot{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px;animation:uoFadeIn .25s ease}'+
      '#updateOverlayRoot .uo-card{background:var(--card,#fff);border:1px solid var(--bdr,rgba(15,23,42,0.10));border-radius:16px;width:480px;max-width:92vw;box-shadow:0 28px 70px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.10);overflow:hidden;animation:uoPopIn .22s cubic-bezier(.2,.9,.3,1.1);font-family:"Malgun Gothic","맑은 고딕",-apple-system,"Apple SD Gothic Neo",sans-serif}'+
      '#updateOverlayRoot .uo-head{padding:20px 24px 16px;border-bottom:1px solid var(--bdr,rgba(15,23,42,0.10));display:flex;align-items:center;gap:14px;background:rgba(6,182,212,0.07)}'+
      '#updateOverlayRoot .uo-icon{width:36px;height:36px;border-radius:10px;flex-shrink:0;background:#0891b2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;line-height:1;box-shadow:0 4px 12px rgba(6,182,212,0.30)}'+
      '#updateOverlayRoot .uo-title{font-size:16px;font-weight:800;color:var(--t1,#0f172a);letter-spacing:-0.2px}'+
      '#updateOverlayRoot .uo-body{padding:22px 26px 14px;font-size:13.5px;color:var(--t1,#0f172a);line-height:1.85;font-weight:500}'+
      '#updateOverlayRoot .uo-body b{font-weight:800}'+
      '#updateOverlayRoot .uo-warn{color:#dc2626;font-weight:800}'+
      '#updateOverlayRoot .uo-restart-info{margin:4px 26px 16px;padding:10px 14px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.25);border-left:3px solid #06b6d4;border-radius:8px;font-size:12px;color:#0891b2;font-weight:700;display:flex;align-items:center;gap:8px}'+
      '#updateOverlayRoot .uo-progress-wrap{padding:6px 26px 24px}'+
      '#updateOverlayRoot .uo-progress-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11.5px;font-weight:700;color:var(--t2,#475569)}'+
      '#updateOverlayRoot .uo-progress-percent{font-family:"JetBrains Mono","SF Mono",Consolas,monospace;font-weight:800;color:#0891b2;font-size:13px}'+
      '#updateOverlayRoot .uo-progress-track{height:10px;background:rgba(6,182,212,0.10);border:1px solid rgba(6,182,212,0.20);border-radius:8px;overflow:hidden;position:relative}'+
      '#updateOverlayRoot .uo-progress-fill{height:100%;background:#0891b2;border-radius:7px;transition:width 0.25s linear;position:relative;width:0%;box-shadow:0 0 8px rgba(6,182,212,0.35)}'+
      '#updateOverlayRoot .uo-progress-fill::after{content:"";position:absolute;inset:0;background:transparent;animation:uoShimmer 1.5s linear infinite}';
    document.head.appendChild(s);
  }

  function _escHtml(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];}); }
  function _fallbackCopy(t){ try{ var ta=document.createElement('textarea'); ta.value=t; ta.style.cssText='position:fixed;opacity:0;left:-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); return true; }catch(_){ return false; } }

  /* ── 업데이트 자동 복구·진단 모달 (mode='diagnostic') — 키오스크 오류 진단 모달과 동일 톤.
   *  반복 실패를 앱이 감지해 캐시를 자동 정리한 뒤, 진단 정보 + [복사] + 오렌지팜 전달 안내 + 다시 시작. */
  function _showDiagnostic(payload){
    if(document.getElementById('uoDiagRoot')) return;
    const text = (payload && payload.text) || '(진단 정보 없음)';
    const head = '🔔 업데이트 점검 안내';
    /* 사용자에게 "고쳤다"고 하지 않음 — 문제를 확인했고 다음 버전 업데이트에서 개선됨을 안내 + 진단 전달 요청.
     *  (캐시 정리는 루프를 멈춰 지금 계속 쓰시게 하려는 것이며, '복구 완료'라고 광고하지 않음.) (사용자 지시 2026-06-18) */
    const msg = '업데이트 과정에서 문제가 감지되었습니다.<br>'
      + '오렌지톡은 <b>지금 그대로 사용하실 수 있고</b>, 이 문제는 <b>다음 버전 업데이트에서 개선</b>됩니다.<br>'
      + '아래 진단 정보를 <b>[📋 진단 정보 복사]</b>로 복사해 <b>오렌지팜에 전달</b>해 주시면 더 빠르게 반영하겠습니다. (붙여넣기 Ctrl+V)';
    const ov=document.createElement('div');
    ov.id='uoDiagRoot';
    ov.style.cssText='position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);padding:24px;font-family:"Malgun Gothic","맑은 고딕",-apple-system,sans-serif';
    ov.innerHTML='<div style="background:var(--card,#fff);border:1px solid var(--bdr,rgba(15,23,42,0.12));border-radius:14px;width:500px;max-width:94vw;max-height:88vh;box-shadow:0 24px 60px rgba(0,0,0,0.45);overflow:hidden;display:flex;flex-direction:column">'
      +'<div style="padding:16px 20px;border-bottom:1px solid var(--bdr,#e5e7eb);background:rgba(6,182,212,0.08);font-size:15px;font-weight:800;color:var(--t1,#0f172a);flex-shrink:0">'+head+'</div>'
      +'<div style="padding:16px 20px 8px;font-size:13px;color:var(--t1,#0f172a);line-height:1.8;flex-shrink:0">'+msg+'</div>'
      +'<div style="margin:0 20px 12px;padding:11px 13px;background:var(--bg2,#f1f5f9);border:1px solid var(--bdr,#e5e7eb);border-radius:8px;font-family:Consolas,monospace;font-size:11px;color:var(--t2,#475569);line-height:1.6;white-space:pre-wrap;word-break:break-all;overflow-y:auto;flex:1 1 auto;min-height:0">'+_escHtml(text)+'</div>'
      +'<div style="display:flex;gap:7px;justify-content:flex-end;padding:11px 18px;border-top:1px solid var(--bdr,#e5e7eb);flex-shrink:0">'
      +'<button data-act="copy" style="padding:8px 16px;font-size:12px;font-weight:700;border-radius:7px;border:1px solid var(--cyan,#06b6d4);background:rgba(6,182,212,0.10);color:#0891b2;cursor:pointer;font-family:inherit">📋 진단 정보 복사</button>'
      +'<button data-act="restart" style="padding:8px 16px;font-size:12px;font-weight:700;border-radius:7px;border:1px solid var(--bdr,#cbd5e1);background:var(--bg2,#f1f5f9);color:var(--t2,#475569);cursor:pointer;font-family:inherit">↻ 다시 시작</button>'
      +'<button data-act="close" style="padding:8px 16px;font-size:12px;font-weight:800;border-radius:7px;border:none;background:#0891b2;color:#fff;cursor:pointer;font-family:inherit">닫고 계속 사용</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    const close=function(){ ov.remove(); };
    ov.querySelector('[data-act="close"]').addEventListener('click',close);
    ov.querySelector('[data-act="copy"]').addEventListener('click',function(){
      const btn=this;
      const done=function(){ btn.textContent='✓ 복사됨 — 오렌지팜에 붙여넣기(Ctrl+V)'; setTimeout(function(){ btn.textContent='📋 진단 정보 복사'; },2500); };
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done,function(){ _fallbackCopy(text); done(); });
        else if(window.electronAPI&&window.electronAPI.clipboardWriteHtml){ window.electronAPI.clipboardWriteHtml('',text); done(); }
        else { _fallbackCopy(text); done(); }
      }catch(_){ _fallbackCopy(text); done(); }
    });
    ov.querySelector('[data-act="restart"]').addEventListener('click',function(){
      try{ if(window.electronAPI&&window.electronAPI.appRelaunch) window.electronAPI.appRelaunch(); else if(window.electronAPI&&window.electronAPI.appQuit) window.electronAPI.appQuit(); }catch(_){}
    });
  }

  function _showOverlay(payload){
    _injectStyles();
    const mode = (payload && payload.mode) || 'quit';  /* quit (CASE A) | startup (CASE B) | diagnostic */
    if(mode === 'diagnostic'){ _showDiagnostic(payload || {}); return; }
    if(document.getElementById('updateOverlayRoot')) return;
    /* 본문 문구 — 설치 후 "새 버전으로 자동으로 다시 열림" 을 분명히(2026-06-10 자동 재시작 결정). */
    const bodyHtml = (mode === 'startup')
      ? '현재 <b>업데이트를 설치하고 있습니다.</b><br>설치가 끝나면 <b>새 버전으로 자동으로 다시 열립니다.</b><br>잠시만 기다려 주세요.'
      : '현재 <b>업데이트를 설치하고 있습니다.</b><br><span class="uo-warn">컴퓨터를 끄지 마시고</span> 잠시만 기다려 주세요.<br>설치가 끝나면 <b>새 버전으로 자동으로 다시 열립니다.</b>';
    const root = document.createElement('div');
    root.id = 'updateOverlayRoot';
    root.innerHTML =
      '<div class="uo-card">'+
        '<div class="uo-head">'+
          '<div class="uo-icon">↻</div>'+
          '<div class="uo-title">업데이트 설치 중</div>'+
        '</div>'+
        '<div class="uo-body">'+ bodyHtml +'</div>'+
        '<div class="uo-restart-info">'+
          '<span style="font-size:14px">↻</span>'+
          '<span>설치가 끝나면 <b>새 버전으로 자동으로 다시 열립니다.</b><br>직접 켜지 마시고 잠시만 기다려 주세요.</span>'+
        '</div>'+
        '<div class="uo-progress-wrap">'+
          '<div class="uo-progress-label">'+
            '<span>설치 진행 중…</span>'+
            '<span class="uo-progress-percent" id="uoPercent">0 %</span>'+
          '</div>'+
          '<div class="uo-progress-track">'+
            '<div class="uo-progress-fill" id="uoFill"></div>'+
          '</div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(root);

    /* 진행률 시뮬레이션 — 실제 설치는 quit 후 백그라운드에서 진행되므로 UX 용 */
    const fill = document.getElementById('uoFill');
    const pctEl = document.getElementById('uoPercent');
    const startAt = Date.now();
    const tick = setInterval(function(){
      const elapsed = Date.now() - startAt;
      const pct = Math.min(100, Math.round(elapsed / PROGRESS_MS * 100));
      if(fill) fill.style.width = pct + '%';
      if(pctEl) pctEl.textContent = pct + ' %';
      if(elapsed >= PROGRESS_MS){
        clearInterval(tick);
        /* 100% 도달 → 짧은 안내 후 자동 종료 (설치 + 재시작) */
        setTimeout(_triggerQuit, POST_WAIT_MS);
      }
    }, 100);
  }

  function _triggerQuit(){
    if(window.electronAPI && window.electronAPI.confirmQuitAfterUpdate){
      window.electronAPI.confirmQuitAfterUpdate().catch(function(){});
    }
  }

  /* IPC 리스너 — main 의 close 핸들러 (CASE A) 또는 부팅 시 보류 감지 (CASE B) 에서 보내옴 */
  window.electronAPI.onShowUpdateOverlay(function(payload){
    _showOverlay(payload || {});
  });
})();