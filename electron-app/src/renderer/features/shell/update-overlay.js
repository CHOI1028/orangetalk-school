/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 설치 준비와 실제 설치 완료를 구분하고, 종료·요청 실패는 다시 시도할 수 있게 안내한다. */

(function _initUpdateOverlay(){
  if(!window.electronAPI || !window.electronAPI.onShowUpdateOverlay) return;
  if(window._updateOverlayInited) return;
  window._updateOverlayInited = true;

  const PREPARE_DELAY_MS = 600;
  let autoInstallTimer = null;
  let requestPending = false;
  let overlayGeneration = 0;
  function clearAutoInstall() {
    if (autoInstallTimer !== null) clearTimeout(autoInstallTimer);
    autoInstallTimer = null;
  }

  function _injectStyles(){
    if(document.getElementById('updateOverlayStyles')) return;
    const s = document.createElement('style');
    s.id = 'updateOverlayStyles';
    s.textContent =
      '@keyframes uoFadeIn{0%{opacity:0}100%{opacity:1}}'+
      '@keyframes uoPopIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}'+
      '@keyframes uoShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}'+
      '#updateOverlayRoot{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.55);backdrop-filter:blur(1.2px);display:flex;align-items:center;justify-content:center;padding:24px;animation:uoFadeIn .25s ease}'+
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
      '#updateOverlayRoot .uo-progress-fill{height:100%;background:#0891b2;border-radius:7px;position:relative;width:35%;animation:uoShimmer 1.5s ease-in-out infinite;box-shadow:0 0 8px rgba(6,182,212,0.35)}'+
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
    /* 캐시 정리와 설치 성공은 다르며, 원인이나 다음 버전의 해결 여부를 단정하지 않는다. */
    const msg = '업데이트가 정상적으로 적용되었는지 확인이 필요합니다.<br>'
      + '진단 분류는 오류 메시지와 실행 상태를 바탕으로 한 참고 정보이며, <b>실제 원인을 확정하는 것은 아닙니다.</b><br>'
      + '캐시 정리 완료도 설치 성공을 의미하지 않습니다. <b>작성 중인 내용은 먼저 저장</b>해 주세요.<br>'
      + ((payload && payload.advice) ? '<br><b>조치 안내</b><br>' + _escHtml(payload.advice) + '<br>' : '')
      + '<br>다시 시도한 뒤 실행 버전을 확인해 주세요. 반복되면 아래 <b>[진단 정보 복사]</b>로 내용을 복사해 <b>오렌지팜에 전달</b>해 주세요. (붙여넣기 Ctrl+V)';
    const ov=document.createElement('div');
    ov.id='uoDiagRoot';
    ov.style.cssText='position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(1.2px);padding:24px;font-family:"Malgun Gothic","맑은 고딕",-apple-system,sans-serif';
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

  function _showInstallFailure(message){
    clearAutoInstall();
    overlayGeneration++;
    requestPending = false;
    const previous = document.getElementById('updateOverlayRoot');
    if(previous) previous.remove();
    const root = document.createElement('div');
    root.id = 'updateOverlayRoot';
    root.innerHTML = '<div class="uo-card">'
      + '<div class="uo-head"><div class="uo-title">업데이트 설치를 진행하지 못했습니다</div></div>'
      + '<div class="uo-body" role="alert">' + _escHtml(message || '설치 요청 결과를 확인하지 못했습니다.')
      + '<br>설치 완료로 처리하지 않았으며, 프로그램은 계속 사용할 수 있습니다.<br>계속 반복되면 문의전화로 연락해 주세요.</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 24px 24px">'
      + '<button data-act="retry" style="padding:9px 14px;border-radius:8px;border:1px solid var(--bdr,#cbd5e1);background:var(--bg2,#f1f5f9);color:var(--t1,#0f172a);cursor:pointer">다시 시도</button>'
      + '<button data-act="continue" style="padding:9px 14px;border-radius:8px;border:0;background:#0891b2;color:#fff;cursor:pointer">닫고 계속 사용</button>'
      + '</div></div>';
    document.body.appendChild(root);
    root.querySelector('[data-act="continue"]').addEventListener('click', function(){
      overlayGeneration++; root.remove();
    });
    root.querySelector('[data-act="retry"]').addEventListener('click', function(){
      root.remove(); _showOverlay({ mode: 'quit' });
    });
  }

  function _showOverlay(payload){
    _injectStyles();
    const mode = (payload && payload.mode) || 'quit';
    if(mode === 'install-error'){ _showInstallFailure(payload && payload.error); return; }
    if(mode === 'diagnostic'){
      clearAutoInstall(); overlayGeneration++; requestPending = false;
      const previous = document.getElementById('updateOverlayRoot');
      if(previous) previous.remove();
      _showDiagnostic(payload || {}); return;
    }
    if(document.getElementById('updateOverlayRoot')) return;
    overlayGeneration++;
    const root = document.createElement('div');
    root.id = 'updateOverlayRoot';
    root.innerHTML = '<div class="uo-card">'
      + '<div class="uo-head"><div class="uo-icon">↻</div><div class="uo-title">업데이트 설치 준비</div></div>'
      + '<div class="uo-body">업데이트 다운로드가 완료되었습니다.<br>협업 연결을 종료한 뒤 설치를 요청합니다.<br><span class="uo-warn">컴퓨터를 끄지 마시고</span> 잠시만 기다려 주세요.</div>'
      + '<div class="uo-restart-info">설치가 정상적으로 끝나면 새 버전으로 다시 열립니다.<br>아래 표시는 실제 설치 진행률이 아닙니다.</div>'
      + '<div class="uo-progress-wrap" role="status" aria-live="polite">'
      + '<div class="uo-progress-label"><span id="uoStatus">설치 준비 중...</span></div>'
      + '<div class="uo-progress-track" aria-hidden="true"><div class="uo-progress-fill"></div></div></div></div>';
    document.body.appendChild(root);
    autoInstallTimer = setTimeout(function(){ autoInstallTimer = null; _triggerQuit(); }, PREPARE_DELAY_MS);
  }

  async function _triggerQuit(){
    if(requestPending) return;
    const generation = overlayGeneration;
    requestPending = true;
    try {
      if(!window.electronAPI || !window.electronAPI.confirmQuitAfterUpdate) throw new Error('설치 요청 기능 없음');
      const status = document.getElementById('uoStatus');
      if(status) status.textContent = '협업 연결 종료 및 설치 요청 중...';
      const result = await window.electronAPI.confirmQuitAfterUpdate();
      if(generation !== overlayGeneration) return;
      if(!result || result.success !== true){
        _showInstallFailure(result && result.error); return;
      }
      if(status) status.textContent = '설치 요청을 전달했습니다. 프로그램이 닫힐 때까지 기다려 주세요.';
    } catch (_) {
      if(generation === overlayGeneration) _showInstallFailure('설치 요청 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      if(generation === overlayGeneration) requestPending = false;
    }
  }

  /* IPC 리스너 — main 의 close 핸들러 (CASE A) 또는 부팅 시 보류 감지 (CASE B) 에서 보내옴 */
  window.electronAPI.onShowUpdateOverlay(function(payload){
    _showOverlay(payload || {});
  });
})();
