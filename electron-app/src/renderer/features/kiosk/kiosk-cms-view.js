/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   KIOSK CMS — Settings Tab + Customization
   ═══════════════════════════════════════ */
/* ES Module */
import { escHtml, closeModalGracefully } from '../../core/helpers.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { bus } from '../../core/event-bus.js';
import { renderSettingsPanel } from '../settings/settings-view.js';
import { _makeDraggable } from '../symptom/symptom-view.js';
import { openEmojiPicker } from './kiosk-emoji-picker.js';
import { S, DEFAULT_RELAY_URL, saveKioskSettings } from '../../core/app-state.js';
import { _fdDownloadKioskHtml, _fdGenerateKioskUrl, getFdSelectedOpts, clearFdSelectedOpts, _fdOpenKioskPreview, _fdReloadKioskPreview, kioskFlowDesignerHtml, _fdAttachEvents, setFdCallbacks, getDefaultFlowTemplate, getBasicFlowTemplate, fdMigrateFlow, fdEnsureDefaultTemplates, _fdFlushSave } from './kiosk-flow-designer.js';
import { downloadKioskHtml, openKioskPreview, openKioskGalleryPreview, FLAG_SVGS, generateKioskUrl, showKioskUrlPopup } from './kiosk-html-builder.js';
import { appConfirmModal } from '../../core/ui-utils.js';
import { kioskLangs, KIOSK_LANG_ALL, kioskToggleLang, kioskSetTrans, kioskGetTrans, kioskBuildTransContent, kioskOpenTransPrompt, kioskOpenPasteTranslation, kioskEnsureDefaultLangs, kioskEditorToggleLang, kioskGetForeignLangs, kioskBuildTransPhrases } from './kiosk-translation.js';
import { kioskUpdateSidebar } from './kiosk-view.js';

let _skipSettingsAnim=false;
let _relayOk=false;
/* 이번 프로그램 실행에서 실제로 [QR & URL 생성]을 눌러 생성했는지 — 재시작하면 false 로 시작.
 *  ks.urlReady 는 저장값이라 재시작해도 true 가 남아 "완료"로 떴다 → 이번 실행 생성 여부로만 초록 "완료" 판정 (사용자 요청 2026-06-14). */
let _kioskGenDoneThisRun=false;
/* 키오스크 활성 라벨 — 연결 상태 실시간 + "(연결 시도중...)" 점 애니메이션. 렌더 타이밍 무관하게 항상 동작(예전 렌더 시점 1회 갱신은 미작동). 2026-06-11.
 *  · 활성 ON = "키오스크 활성"(초록). 뒤 괄호: 키오스크 HTML 실연결(window._kioskClientCnt>0)이면 "(연결됨)"(초록), 아니면 "(연결 시도중...)"(주황·점 애니메이션). */
(function(){
  var _cFrames=['...','..','.','..'], _cfi=0;
  setInterval(function(){
    try{
      var label=document.getElementById('kioskActiveLabel');
      if(!label)return;
      if(!(S.kioskSettings&&S.kioskSettings.active)){ label.textContent='키오스크 비활성'; label.style.color='var(--t1)'; return; }
      label.style.color='var(--gs)';
      var cnt=(window._kioskClientCnt|0);
      if(cnt>0){ label.innerHTML='키오스크 활성 <span style="color:#16a34a">(연결됨)</span>'; }
      else { label.innerHTML='키오스크 활성 <span style="color:#ea580c">(연결 시도중'+_cFrames[_cfi%_cFrames.length]+')</span>'; _cfi++; }
    }catch(_e){}
  },350);
})();
'use strict';

/* 순환 의존성 해소: flow-designer에 콜백 주입 (지연 등록) */
setTimeout(function(){
  setFdCallbacks({
    refreshFlowPopup: _kioskRefreshFlowPopup,
    refreshPreview: function(){
      var preview=document.getElementById('_kcFlowPreview');
      if(preview) preview.innerHTML=_kioskFlowSummaryTreeHtml();
    }
  });
}, 0);

  /* 공유 참조 */
  const ks=S.kioskSettings;
  /* 레거시 'custom' → 'extended' 마이그레이션 */
  if(ks.kioskType==='custom'){ks.kioskType='extended';}

  /* ── 오류 진단 모달 — 전체 정보를 바로 표시(스크롤) + [오류 정보 복사] (사용자 요청 2026-06-15) ── */
  function _kErrFallbackCopy(t){ try{ var ta=document.createElement('textarea'); ta.value=t; ta.style.cssText='position:fixed;opacity:0;left:-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); return true; }catch(_){ return false; } }
  function _showKioskErrModal(title, msgHtml, diagText){
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:50001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
    ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:460px;max-width:94vw;max-height:88vh;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden;display:flex;flex-direction:column">'
      +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1);flex-shrink:0">'+title+'</div>'
      +'<div style="padding:16px 18px 8px;font-size:12.5px;color:var(--t1);line-height:1.7;flex-shrink:0">'+msgHtml+'</div>'
      +'<div style="margin:0 18px 12px;padding:10px 12px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;font-family:var(--fm,monospace);font-size:10.5px;color:var(--t2);line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow-y:auto;flex:1 1 auto;min-height:0">'+escHtml(diagText)+'</div>'
      +'<div style="display:flex;gap:6px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);flex-shrink:0">'
      +'<button data-act="copy" style="padding:7px 16px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--cyan);background:rgba(6,182,212,0.10);color:#0891b2;cursor:pointer;font-family:var(--f)">📋 오류 정보 복사</button>'
      +'<button data-act="ok" style="padding:7px 16px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid var(--bdr);background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">확인</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    var close=function(){ try{document.removeEventListener('keydown',onKey,true);}catch(_){} ov.remove(); };
    ov.querySelector('[data-act="ok"]').addEventListener('click',close);
    ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
    ov.querySelector('[data-act="copy"]').addEventListener('click',function(){
      var ok=function(){ bus.emit('toast:show',{text:'✅ 오류 정보가 복사되었습니다. 오렌지팜에 붙여넣기(Ctrl+V)로 보내주세요.'}); };
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(diagText).then(ok,function(){ _kErrFallbackCopy(diagText); ok(); }); }
        else { _kErrFallbackCopy(diagText); ok(); }
      }catch(_){ _kErrFallbackCopy(diagText); ok(); }
    });
    var onKey=function(e){ if(e.key==='Escape'){ e.preventDefault(); close(); } };
    document.addEventListener('keydown',onKey,true);
  }
  /* [생성] 실패 진단 텍스트 — 채널 생성 실패·업로드 실패 등 모든 실패 경로가 같은 형식으로 복사되게 공유 (사용자 결정 2026-06-15) */
  function _kioskBuildDiag(o){
    o=o||{};
    var _ch=o.channelId||ks.channelId||'(없음)';
    var _ru=o.relayUrl||ks.relayUrl||DEFAULT_RELAY_URL||'(없음)';
    var _stCode=(typeof o.status!=='undefined'&&o.status!==null)?o.status:null;
    var _st=(_stCode!==null)?('HTTP '+_stCode):'(상태코드 없음)';
    var _url=o.url||(_ru+'/api/v1/kiosk/html/'+_ch);
    var _body=(typeof o.body!=='undefined'&&o.body!==null&&String(o.body)!=='')?String(o.body).slice(0,500):'(없음)';
    var _net=o.netCode?(' / netCode: '+o.netCode):'';
    return [
      '['+(o.kind||'키오스크 오류')+' 정보]',
      '시각: '+new Date().toISOString(),
      '단계: '+(o.stage||'(미상)'),
      '사유: '+(o.error||'알 수 없는 오류')+' / '+_st+_net,
      '서버응답: '+_body,
      '온라인: '+(navigator.onLine?'예':'아니오(오프라인)'),
      '대상URL: '+_url,
      'relayUrl: '+_ru,
      'channelId: '+_ch,
      'authToken: '+(ks.authToken?('있음('+String(ks.authToken).slice(0,8)+'…, len '+String(ks.authToken).length+')'):'없음'),
      'urlReady: '+ks.urlReady,
      'active: '+ks.active,
      'kioskType: '+(ks.kioskType||'(미설정)')+' / kioskOrientation: '+(ks.kioskOrientation||'(미설정)'),
      'genType: '+(ks.genType||'(없음)')+' / genOrient: '+(ks.genOrient||'(없음)'),
      '재시도: '+(o.retried?'예(자가치유 후)':'아니오'),
      '학교: '+((S.settings&&S.settings.schoolName)||'(미설정)'),
      '플랫폼: '+(navigator.platform||'')+' / '+navigator.userAgent
    ].join('\n');
  }

  /* 생성 후 방향/유형을 바꿨는데 재생성을 안 했으면 stale — 미리보기·QR 비활성 + 재생성 안내 (사용자 결정 2026-06-14).
   *  genOrient/genType 은 업로드 성공 시점에 기록(kiosk-html-builder _buildAndUpload). 옛 데이터(없음)는 stale 아님. */
  function _kioskGenStale(){
    const k=S.kioskSettings||{};
    if(!(k.urlReady && k.channelId)) return false;
    /* genOrient/genType 가 없으면(옛 채널) 서버에 뭐가 올라가 있는지 모름 → 재생성 필요로 간주 (사용자 요청 2026-06-14) */
    if(!k.genOrient || !k.genType) return true;
    const curOrient=(k.kioskOrientation==='portrait')?'portrait':'landscape';
    const curType=k.kioskType||'basic';
    return (k.genOrient!==curOrient) || (k.genType!==curType);
  }
  function _save(){ saveKioskSettings(); }

  /* ═══════════════════════════════════════
     플로우 헬퍼
     ═══════════════════════════════════════ */
  /* 레거시 flowSteps 폴백 — 빌더에서 ks.flowDesigner를 우선 사용 */
  function _kioskGetFlow(){
    /* customRules/ruleMeta가 없으면 JSON 기본값으로 초기화 (미리보기 시 편집 데이터와 일치) */
    if(!ks.customRules){ks.customRules=_kioskGetDefaultRules();_save();}
    if(!ks.ruleMeta){ks.ruleMeta=_kioskGetDefaultRuleMeta();_save();}
    if(ks.flowDesigner){
      /* 저장 흐름도 빌드/미리보기 전 반드시 마이그레이션 — 편집기 안 열고 QR 생성 시 옛 구조가 그대로 나가던 버그 수정 (2026-06-13) */
      try{ fdMigrateFlow(ks.flowDesigner); }catch(_){}
      return ks.flowDesigner;
    }
    /* 편집기를 열지 않아도 JSON 기본값에서 플로우 로드 — 타입별 분기 */
    var kType=ks.kioskType||'basic';
    var tpl=(kType==='extended') ? getDefaultFlowTemplate() : getBasicFlowTemplate();
    if(!tpl) tpl=getDefaultFlowTemplate(); /* 폴백 */
    if(tpl){ks.flowDesigner=JSON.parse(JSON.stringify(tpl));_save();return ks.flowDesigner;}
    return {sections:[]};
  }


  /* (레거시 함수 삭제됨 — kiosk-html-builder.js로 대체) */

  /* ═══════════════════════════════════════
     릴레이 서버 + 인증키 + 행선지
     ═══════════════════════════════════════ */
  function _kioskPushToRelay(){
    if(!ks.relayUrl||!ks.channelId||!ks.authToken)return;
    const cfg={customRules:ks.customRules||null,destination:ks.activeDest||'',
      supply_items:(ks.supplyItems||[]).map(function(it,i){return{id:'i'+(i+1),name:it.name||it,icon:it.icon||'📦',order:i+1,enabled:it.enabled!==false};}),
      self_treatment_guides:(ks.selfCareGuides||[]).map(function(g,i){return{id:'g'+(i+1),description:g.description||g.text||'',order:i+1,enabled:g.enabled!==false};}),
      alert_settings:{severe_pain_threshold:ks.alertOnSeverePain?7:10,alert_sound:ks.alertSound||false}};
    if(window.electronAPI&&window.electronAPI.kioskPushConfig){
      window.electronAPI.kioskPushConfig(ks.relayUrl,ks.channelId,ks.authToken||'',cfg).then(function(res){
        if(res&&res.success)bus.emit('toast:show', {text: '릴레이 서버에 설정을 동기화했습니다.'});
        else bus.emit('toast:show', {text: '동기화 실패: '+(res&&res.error||'서버 오류')});
      }).catch(function(err){bus.emit('toast:show', {text: '동기화 실패: '+err.message});});
    }
  }
  function _kioskCreateChannel(){
    const url=ks.relayUrl||DEFAULT_RELAY_URL;
    if(!url){bus.emit('toast:show',{text:'릴레이 서버 URL이 없습니다.'});return;}
    bus.emit('toast:show',{text:'채널 생성 중...'});
    if(window.electronAPI&&window.electronAPI.kioskCreateChannel){
      const schoolName=(S.schoolInfo&&S.schoolInfo.school_name)||'';
      const eduOffice=(S.schoolInfo&&S.schoolInfo.education_office)||'';
      window.electronAPI.kioskCreateChannel(url,schoolName,eduOffice).then(function(res){
        /* ★ 서버 응답 키는 camelCase(channelId/nurseToken) — 옛 snake_case 만 읽어서 undefined 가 저장되던 치명 버그 수정 (2026-06-11 물증: 채널 33개 생성·미보존·429).
         *  양쪽 키 수용 + 키가 비면 성공 처리 금지(빈 저장 방지). */
        var _chId=res&&(res.channelId||res.channel_id);
        var _tk=res&&(res.nurseToken||res.nurse_token);
        if(res&&res.success&&_chId&&_tk){
          ks.relayUrl=url;
          ks.channelId=_chId;
          ks.authToken=_tk;
          ks.urlReady=false;   /* 새 채널엔 HTML 미업로드 — [QR & URL 보기] 비활성 (2026-06-13) */
          _save();
          bus.emit('toast:show',{text:'✅ 채널 생성 완료! [화면 편집]의 [🔗 키오스크 생성 & 접속용 QR 코드와 URL 보기]를 누르면 접속 주소가 만들어집니다.'});
          renderSettingsPanel('kiosk');
        } else {
          var _em=(res&&res.error)||'서버 응답 형식 오류';
          bus.emit('toast:show',{text:'채널 생성 실패: '+_em});
          _showKioskErrModal('⚠️ 키오스크 채널 생성 실패',
            '연결 채널 생성에 실패했습니다.<br>아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주시면 원인 추적이 빠릅니다.',
            _kioskBuildDiag({kind:'키오스크 채널 생성 오류',stage:'채널 생성',error:_em,status:res&&res._httpStatus,body:res&&res._rawBody,netCode:res&&res._netCode,relayUrl:url,url:url+'/api/v1/admin/channel'}));
        }
      }).catch(function(err){
        bus.emit('toast:show',{text:'채널 생성 실패: '+err.message});
        _showKioskErrModal('⚠️ 키오스크 채널 생성 실패','연결 채널 생성 중 오류가 발생했습니다.<br><b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주세요.',_kioskBuildDiag({kind:'키오스크 채널 생성 오류',stage:'채널 생성(IPC 예외)',error:err&&err.message,relayUrl:url,url:url+'/api/v1/admin/channel'}));
      });
    } else {
      bus.emit('toast:show',{text:'이 기능은 앱 업데이트가 필요합니다.'});
    }
  }
  function _kioskTestRelay(){
    const url=(document.getElementById('kioskRelayUrl')||{}).value||ks.relayUrl||DEFAULT_RELAY_URL;
    const token=(document.getElementById('kioskNurseToken')||{}).value||ks.authToken||'';
    const channel=(document.getElementById('kioskChannelId')||{}).value||ks.channelId||'';
    if(!url){bus.emit('toast:show', {text: '서버 URL을 입력하세요.'});return;}
    bus.emit('toast:show', {text: '연결 테스트 중...'});
    if(window.electronAPI&&window.electronAPI.kioskTestRelay){
      window.electronAPI.kioskTestRelay(url,channel,token).then(function(res){
        if(res&&res.ok){ks._relayConnected=true;_save();bus.emit('toast:show', {text: '✅ 릴레이 서버 연결 성공!'});renderSettingsPanel('kiosk');}
        else{ks._relayConnected=false;_save();bus.emit('toast:show', {text: '❌ 연결 실패: '+(res&&res.error||'서버 응답 없음')});renderSettingsPanel('kiosk');}
      }).catch(function(err){bus.emit('toast:show', {text: '❌ 연결 오류: '+err.message});});
    }
  }
  function _kioskOpenMonitor(){
    if(!ks.relayUrl||!ks.channelId||!ks.authToken){bus.emit('toast:show', {text: '릴레이 서버 설정을 먼저 완료하세요.'});return;}
    let ov=document.getElementById('kioskMonitorOverlay');if(ov)closeModalGracefully(ov);
    ov=document.createElement('div');ov.id='kioskMonitorOverlay';
    ov.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    ov.innerHTML='<div style="background:var(--bg);border-radius:16px;width:600px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.2)">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--bdr);background:var(--bg2)">'
      +'<span style="font-size:15px;font-weight:800;color:var(--t1)">📋 키오스크 대기 명단</span>'
      +'<div style="display:flex;gap:8px"><button data-action="monitor-refresh" class="btn btn-primary btn-sm" style="font-size:11px">🔄 새로고침</button>'
      +'<button data-action="close-monitor" class="modal-close">✕</button></div></div>'
      +'<div id="kioskMonitorBody" style="padding:16px;overflow-y:auto;flex:1"><div style="text-align:center;color:var(--t3);padding:40px">로딩 중...</div></div></div>';
    const _monRefresh=ov.querySelector('[data-action="monitor-refresh"]');
    if(_monRefresh)_monRefresh.addEventListener('click',function(){_kioskMonitorRefresh();});
    const _monClose=ov.querySelector('[data-action="close-monitor"]');
    if(_monClose)_monClose.addEventListener('click',function(){closeModalGracefully(ov);});
    document.body.appendChild(ov);
    ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
    _kioskMonitorRefresh();
  }
  function _kioskMonitorRefresh(){
    const body=document.getElementById('kioskMonitorBody');if(!body)return;
    if(window.electronAPI&&window.electronAPI.kioskGetReceptions){
      window.electronAPI.kioskGetReceptions(ks.relayUrl,ks.channelId,ks.authToken).then(function(res){
        if(!body)return;
        if(!res||!res.success){body.innerHTML='<div style="text-align:center;color:var(--rs);padding:40px">조회 실패: '+(res&&res.error||'서버 오류')+'</div>';return;}
        const list=res.receptions||[];
        if(!list.length){body.innerHTML='<div style="text-align:center;color:var(--t3);padding:40px;font-size:13px">현재 대기 중인 학생이 없습니다</div>';return;}
        body.innerHTML='<div style="font-size:11px;color:var(--t3);margin-bottom:10px">대기 '+list.length+'명</div>'
          +list.map(function(r,i){
            const p=r.student_name||r.name||'이름 미기재';
            const grade=r.grade||'';const cls=r.class_num||'';const num=r.student_num||'';
            const sym=Array.isArray(r.symptoms)?r.symptoms.join(', '):(r.symptom||'');
            const t=r.created_at?new Date(r.created_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
            return '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--bdr);border-radius:10px;margin-bottom:8px;background:var(--bg2)">'
              +'<span style="width:24px;height:24px;border-radius:50%;background:var(--cyan);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">'+(i+1)+'</span>'
              +'<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--t1)">'+escHtml(p)+(grade?' <span style="font-size:10px;color:var(--t3);font-weight:400">'+grade+'학년 '+cls+'반 '+num+'번</span>':'')+'</div>'
              +'<div style="font-size:11px;color:var(--t2);margin-top:2px">'+escHtml(sym)+(t?' · '+t:'')+'</div></div>'
              +'<button data-action="monitor-complete" data-reception-id="'+escHtml(r.id)+'" class="btn btn-outline btn-sm" style="font-size:10px;color:var(--gs);border-color:rgba(34,197,94,0.3)">✓ 처리완료</button></div>';
          }).join('');
        body.querySelectorAll('[data-action="monitor-complete"]').forEach(function(btn){btn.addEventListener('click',function(){_kioskMonitorComplete(this.dataset.receptionId);});});
      }).catch(function(){if(body)body.innerHTML='<div style="text-align:center;color:var(--rs);padding:40px">서버 연결 오류</div>';});
    }
  }
  function _kioskMonitorComplete(receptionId){
    if(window.electronAPI&&window.electronAPI.kioskCompleteReception){
      window.electronAPI.kioskCompleteReception(ks.relayUrl,ks.channelId,ks.authToken,receptionId).then(function(){_kioskMonitorRefresh();}).catch(function(){});
    }
  }
  function _kioskGenerateKey(){
    const letters='ABCDEFGHJKLMNPQRSTUVWXYZ', nums='0123456789';
    let key='';
    key+=letters[Math.floor(Math.random()*letters.length)];key+=nums[Math.floor(Math.random()*nums.length)];
    key+=letters[Math.floor(Math.random()*letters.length)];key+=nums[Math.floor(Math.random()*nums.length)];
    key+=letters[Math.floor(Math.random()*letters.length)];
    ks.authKey=key;
    const now=new Date();ks.authKeyExpiry=new Date(now.getTime()+30*24*60*60*1000).toISOString().slice(0,10);
    _save();_skipSettingsAnim=true;renderSettingsPanel('kiosk');
  }
  function _kioskRevokeKey(){
    if(!confirm('인증키를 폐기하시겠습니까? 현재 연결된 키오스크는 접속이 해제됩니다.'))return;
    delete ks.authKey;delete ks.authKeyExpiry;_save();renderSettingsPanel('kiosk');bus.emit('toast:show', {text: '인증키가 폐기되었습니다.'});
  }

  /* ── 행선지 팝업 ── */
  function _kioskOpenDestPopup(){
    const destList=ks.destOptions||['보건 선생님은 퇴근하셨습니다.','보건 선생님은 현재 학교 외부로 출장가셨습니다.','보건 선생님은 현재 식사 중입니다.','보건 선생님은 현재 수업 중으로 쉬는 시간에 만나요.','보건 선생님은 현재 교내에서 회의에 참여하고 계십니다.'];
    const curDest=ks.activeDest||'';
    const ov=document.createElement('div');ov.id='kioskDestOverlay';
    ov.style.cssText='position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:transparent;pointer-events:none';
    const box=document.createElement('div');
    box.style.cssText='width:520px;max-width:94vw;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1px solid var(--bdr);background:var(--card);pointer-events:auto;transform:scale(0.92) translateY(10px);opacity:0;transition:transform .25s ease,opacity .25s ease';
    let h='<div style="background:var(--bg2);padding:14px 20px;border-bottom:1px solid var(--bdr);border-radius:12px 12px 0 0"><div style="font-size:14px;font-weight:800;color:var(--t1)">🚪 보건교사 행선지 설정</div><div style="font-size:10px;color:var(--t3);margin-top:2px">선택하면 키오스크에 즉시 반영됩니다. 버튼은 자동으로 비활성화됩니다.</div></div>';
    h+='<div style="padding:16px 20px;max-height:400px;overflow-y:auto">';
    destList.forEach(function(d,i){
      const isActive=curDest===d;
      h+='<div data-action="select-dest" data-dest-idx="'+i+'" data-dest-active="'+isActive+'" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:6px;border-radius:10px;border:1.5px solid '+(isActive?'var(--cyan)':'var(--bdr)')+';background:'+(isActive?'rgba(6,182,212,0.06)':'var(--card)')+';cursor:pointer;transition:all 0.15s">'
        +'<div style="width:20px;height:20px;border-radius:50%;border:2px solid '+(isActive?'var(--cyan)':'var(--bdr)')+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(isActive?'<div style="width:10px;height:10px;border-radius:50%;background:var(--cyan)"></div>':'')+'</div>'
        +'<div style="flex:1;font-size:12px;font-weight:'+(isActive?'700':'500')+';color:var(--t1)">'+escHtml(d)+'</div>'
        +'<span data-action="remove-dest" data-dest-idx="'+i+'" style="cursor:pointer;color:var(--red);font-size:9px;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(239,68,68,0.1);opacity:0.5" title="목록에서 삭제">✕</span></div>';
    });
    h+='<div style="border:1px dashed var(--bdr);border-radius:10px;padding:10px 14px;margin-top:8px"><div style="display:flex;gap:8px"><input class="form-input" id="kioskNewDest" placeholder="직접 입력 (예: 보건 선생님은 현재 연수 중입니다.)" style="flex:1;font-size:11px">'
      +'<button data-action="add-dest" class="btn btn-outline btn-sm" style="font-size:10px;white-space:nowrap">+ 추가</button></div></div>';
    h+='</div>';
    h+='<div style="display:flex;justify-content:flex-start;gap:8px;padding:12px 20px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 12px 12px">';
    h+='<button data-action="clear-dest" class="btn btn-outline btn-sm" style="font-size:11px;color:var(--red);border-color:rgba(239,68,68,0.3)"'+(curDest?'':' disabled')+'>행선지 해제</button>';
    h+='</div>';
    box.innerHTML=h;
    ov.appendChild(box);
    function _closeDest(){
      box.style.transform='scale(0.92) translateY(10px)';box.style.opacity='0';
      setTimeout(function(){if(ov.parentNode)ov.remove();},250);
    }
    /* 행선지 이벤트 위임 */
    box.querySelectorAll('[data-action="select-dest"]').forEach(function(el){
      el.addEventListener('click',function(){_kioskSelectDest(parseInt(this.dataset.destIdx));});
      el.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';});
      el.addEventListener('mouseleave',function(){if(this.dataset.destActive!=='true')this.style.borderColor='var(--bdr)';});
    });
    box.querySelectorAll('[data-action="remove-dest"]').forEach(function(el){
      el.addEventListener('click',function(e){e.stopPropagation();_kioskRemoveDestOption(parseInt(this.dataset.destIdx));});
      el.addEventListener('mouseenter',function(){this.style.opacity='1';});
      el.addEventListener('mouseleave',function(){this.style.opacity='0.5';});
    });
    const _addDestBtn=box.querySelector('[data-action="add-dest"]');
    if(_addDestBtn)_addDestBtn.addEventListener('click',function(){_kioskAddDestOption();});
    const _clearDestBtn=box.querySelector('[data-action="clear-dest"]');
    if(_clearDestBtn)_clearDestBtn.addEventListener('click',function(){_kioskClearDestFromPopup();});
    document.body.appendChild(ov);
    /* 열기 애니메이션 */
    requestAnimationFrame(function(){requestAnimationFrame(function(){box.style.transform='scale(1) translateY(0)';box.style.opacity='1';});});
    /* 팝업 밖 클릭 시 닫기 (애니메이션) */
    ov.style.pointerEvents='auto';
    ov.addEventListener('click',function(e){if(e.target===ov)_closeDest();});
  }
  function _kioskSelectDest(idx){
    const destList=ks.destOptions||['보건 선생님은 퇴근하셨습니다.','보건 선생님은 현재 학교 외부로 출장가셨습니다.','보건 선생님은 현재 식사 중입니다.','보건 선생님은 현재 수업 중으로 쉬는 시간에 만나요.','보건 선생님은 현재 교내에서 회의에 참여하고 계십니다.'];
    const chosen=destList[idx]||'';
    ks.activeDest=chosen;
    /* 출장 선택 시 자동 꺼짐 시각 입력 옵션 — 예상 복귀 시각 이후 자동 해제 */
    if(/출장/.test(chosen)){
      const ret=prompt('예상 복귀 시각을 입력하세요 (예: 15:30)\n\n복귀 시각 이후 자동으로 행선지가 해제됩니다.\n\n비워두면 수동 해제만 가능합니다.', '');
      if(ret && /^([01]?\d|2[0-3]):[0-5]\d$/.test(ret.trim())){
        const parts=ret.trim().split(':');
        const now=new Date();
        const expiry=new Date(now.getFullYear(),now.getMonth(),now.getDate(),parseInt(parts[0],10),parseInt(parts[1],10));
        /* 이미 지난 시각이면 다음 날로 */
        if(expiry.getTime()<now.getTime()) expiry.setDate(expiry.getDate()+1);
        ks.activeDestExpiry=expiry.getTime();
      } else {
        delete ks.activeDestExpiry;
      }
    } else {
      delete ks.activeDestExpiry;
    }
    _save();
    const ov=document.getElementById('kioskDestOverlay');if(ov)closeModalGracefully(ov);
    renderSettingsPanel('kiosk');
    let msg='행선지가 설정되었습니다: '+ks.activeDest;
    if(ks.activeDestExpiry){
      const ed=new Date(ks.activeDestExpiry);
      msg+=' (자동 해제: '+String(ed.getHours()).padStart(2,'0')+':'+String(ed.getMinutes()).padStart(2,'0')+')';
    }
    bus.emit('toast:show', {text: msg});
    _kioskScheduleDestAutoClear();
  }
  function _kioskClearDestFromPopup(){ks.activeDest='';delete ks.activeDestExpiry;_save();const ov=document.getElementById('kioskDestOverlay');if(ov)closeModalGracefully(ov);const p=document.getElementById('settingsPanel');if(p&&p.offsetParent)renderSettingsPanel('kiosk');bus.emit('toast:show', {text: '행선지가 해제되었습니다.'});}

  /* 예상 복귀 시각 이후 자동 해제 — 1분마다 확인 */
  let _destAutoClearTimer=null;
  function _kioskScheduleDestAutoClear(){
    if(_destAutoClearTimer)return;
    _destAutoClearTimer=setInterval(function(){
      if(!ks.activeDest||!ks.activeDestExpiry)return;
      if(Date.now()>=ks.activeDestExpiry){
        ks.activeDest='';delete ks.activeDestExpiry;_save();
        if(typeof renderSettingsPanel==='function'){
          const panel=document.getElementById('settingsPanel');
          if(panel&&panel.offsetParent)renderSettingsPanel('kiosk');
        }
        bus.emit('toast:show', {text: '예상 복귀 시각이 지나 보건교사 행선지가 자동 해제되었습니다.'});
      }
    },60*1000);
  }
  /* 앱 시작 시 스케줄러 기동 (저장된 expiry가 있으면) */
  try { if(ks.activeDestExpiry) _kioskScheduleDestAutoClear(); } catch(e){}
  function _kioskAddDestOption(){
    const inp=document.getElementById('kioskNewDest');if(!inp||!inp.value.trim())return;
    if(!ks.destOptions)ks.destOptions=['보건 선생님은 퇴근하셨습니다.','보건 선생님은 현재 학교 외부로 출장가셨습니다.','보건 선생님은 현재 식사 중입니다.','보건 선생님은 현재 수업 중으로 쉬는 시간에 만나요.','보건 선생님은 현재 교내에서 회의에 참여하고 계십니다.'];
    ks.destOptions.push(inp.value.trim());_save();
    const ov=document.getElementById('kioskDestOverlay');if(ov)closeModalGracefully(ov);_kioskOpenDestPopup();
  }
  function _kioskRemoveDestOption(idx){
    if(!ks.destOptions)return;ks.destOptions.splice(idx,1);_save();
    const ov=document.getElementById('kioskDestOverlay');if(ov)closeModalGracefully(ov);_kioskOpenDestPopup();
  }

  /* ── CMS 아이템 관리 ── */
  function _kioskGetDefaultRules(){
    var tpl=getDefaultFlowTemplate();
    if(tpl&&tpl.defaultRules) return JSON.parse(JSON.stringify(tpl.defaultRules));
    /* 폴백 — JSON 로드 실패 시 최소 구조 */
    return {title:'보건실 이용 수칙 안내',time:['월~금요일 08:30 ~ 16:30'],manners:[{text:'들어갈 때: 노크 후 문 열기'}]};
  }
  function _kioskGetDefaultRuleMeta(){
    var tpl=getDefaultFlowTemplate();
    if(tpl&&tpl.defaultRuleMeta) return JSON.parse(JSON.stringify(tpl.defaultRuleMeta));
    return {titleIcon:'🩺',timeIcon:'①',mannerIcon:'②'};
  }
  function _kioskGetRules(){
    if(!ks.customRules){
      ks.customRules=_kioskGetDefaultRules();
      _save();
    }
    if(!ks.customRules.time||!ks.customRules.manners){
      var def=_kioskGetDefaultRules();
      if(!ks.customRules.time)ks.customRules.time=def.time;
      if(!ks.customRules.manners)ks.customRules.manners=def.manners;
      if(!ks.customRules.title)ks.customRules.title=def.title;
    }
    /* ruleMeta도 JSON 기본값으로 초기화 */
    if(!ks.ruleMeta){
      ks.ruleMeta=_kioskGetDefaultRuleMeta();
      _save();
    }
    return ks.customRules;
  }
  /* extra_N 섹션 포함 배열 접근 헬퍼 */
  function _getRuleArr(sec){
    if(!ks.customRules)return null;
    if(sec==='time')return ks.customRules.time;
    if(sec==='manners')return ks.customRules.manners;
    if(sec&&sec.startsWith('extra_')){
      var si=parseInt(sec.split('_')[1]);
      var extras=ks.customRules.extraSections;
      return (extras&&extras[si])?extras[si].items:null;
    }
    return null;
  }
  /* 사용 기기 / 표시 모드 */
  /* 미리보기 실시간 갱신 */
  function _kioskRulePreviewRefresh(){const el=document.getElementById('_kcRulePreview');if(el)el.innerHTML=_kioskRulePreviewHtml();}
  /* 태블릿용 수칙 축약 — 중요한 상위 항목만 유지 */
  function _kioskCompactRules(r){
    const t=(r.time||[]).slice(0,2); /* 운영시간: 상위 2개만 */
    const m=[];
    const mSrc=r.manners||[];
    let mainCount=0;
    for(let i=0;i<mSrc.length&&mainCount<3;i++){
      const item=mSrc[i];
      const isSub=typeof item==='object'&&item.sub;
      if(!isSub){m.push(item);mainCount++;}
      else if(mainCount>0&&m.length<4){m.push(item);} /* 직전 상위 항목의 하위는 1개까지 허용 */
    }
    return {time:t,manners:m};
  }
  function _kioskRulePreviewHtml(opts){
    opts=opts||{};
    const r=_kioskGetRules();
    const ruleTitle=r.title||'보건실 이용 수칙 안내';
    const timeTitle=r.timeTitle||'운영 시간';
    const mannerTitle=r.mannerTitle||'지켜야 할 예절과 절차';
    const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)||'OO학교';
    const deviceType=ks.deviceType||'laptop';
    const displayMode=ks.displayMode||'rules';
    const alternateSec=ks.alternateSec||10;
    const isTablet=(deviceType==='tablet');
    /* 태블릿은 중요 항목만 축약 표시 */
    const dispRules=isTablet?_kioskCompactRules(r):r;
    const panelW=isTablet?'320px':'340px';
    let out='<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">';
    /* 모드 안내 라벨 */
    const modeLabel=displayMode==='rules'?'📋 수칙만 표시':displayMode==='queue'?'👥 순번만 안내':('🔁 '+alternateSec+'초 번갈아 표시');
    const deviceLabel=isTablet?'📱 태블릿 PC (세로, 중요 항목만 축약)':'💻 노트북 PC (가로 16:9, 전체 표시)';
    out+='<div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:8px;flex-wrap:wrap">'
      +'<div style="font-size:10px;color:var(--t3)">'+modeLabel+' · '+deviceLabel+'</div>'
      +'<button data-action="open-preview-popup" class="btn btn-outline btn-sm" style="font-size:10px;padding:4px 10px">🔍 확대 미리보기</button>'
      +'</div>';
    /* 수칙 패널 or 순번 패널 */
    function _rulesPanelHtml(){
      const tRules=dispRules.time||[];
      const mRules=dispRules.manners||[];
      let p='<div style="background:rgba(255,255,255,0.95);border-radius:12px;border:1px solid #e2e8f0;padding:18px 16px;width:'+panelW+';font-family:\'Pretendard\',-apple-system,\'Noto Sans KR\',sans-serif;color:#000;box-sizing:border-box">'
        +'<div style="font-size:'+(isTablet?'14px':'16px')+';font-weight:800;text-align:center;margin-bottom:12px;color:#0e7490">🏫 '+escHtml(schoolName)+' 보건실</div>'
        +'<div style="font-size:'+(isTablet?'12px':'14px')+';font-weight:800;text-align:center;margin-bottom:10px;color:#0e7490">'+escHtml(ruleTitle)+'</div>'
        +'<h3 style="font-size:'+(isTablet?'12px':'13px')+';font-weight:700;color:#334155;margin:10px 0 4px">🕐 '+escHtml(timeTitle)+'</h3><ul style="padding-left:18px;font-size:'+(isTablet?'11px':'12px')+';color:#475569;line-height:1.8;margin:0;list-style:disc">';
      tRules.forEach(function(t){p+='<li>'+escHtml(t)+'</li>';});
      p+='</ul><h3 style="font-size:'+(isTablet?'12px':'13px')+';font-weight:700;color:#334155;margin:10px 0 4px">📋 '+escHtml(mannerTitle)+'</h3><ul style="padding-left:18px;font-size:'+(isTablet?'11px':'12px')+';color:#475569;line-height:1.8;margin:0;list-style:disc">';
      mRules.forEach(function(m){
        const txt=typeof m==='string'?m:(m.text||'');
        const isSub=typeof m==='object'&&m.sub;
        if(isSub){
          p+='</ul><ul style="padding-left:36px;font-size:'+(isTablet?'10px':'11px')+';color:#94a3b8;line-height:1.8;margin:0;list-style:disc"><li>'+escHtml(txt)+'</li></ul><ul style="padding-left:18px;font-size:'+(isTablet?'11px':'12px')+';color:#475569;line-height:1.8;margin:0;list-style:disc">';
        } else {
          p+='<li>'+escHtml(txt)+'</li>';
        }
      });
      p+='</ul></div>';
      return p;
    }
    function _queuePanelHtml(){
      return '<div style="background:rgba(255,255,255,0.95);border-radius:12px;border:1px solid #e2e8f0;padding:24px 20px;width:'+panelW+';min-height:240px;font-family:\'Pretendard\',-apple-system,\'Noto Sans KR\',sans-serif;color:#000;text-align:center;box-sizing:border-box">'
        +'<div style="font-size:'+(isTablet?'13px':'14px')+';font-weight:700;color:#0e7490;margin-bottom:6px">👥 방문자 순번 안내</div>'
        +'<div style="font-size:12px;color:#475569;margin-bottom:14px">현재 대기 중인 학생</div>'
        +'<div style="font-size:'+(isTablet?'40px':'48px')+';font-weight:900;color:#0891b2;margin-bottom:4px">3</div>'
        +'<div style="font-size:11px;color:#94a3b8;margin-bottom:16px">명</div>'
        +'<div style="display:flex;flex-direction:column;gap:5px">'
        +'<div style="padding:7px 10px;background:rgba(8,145,178,0.08);border-radius:7px;font-size:11px;color:#334155;text-align:left">1. 홍길동 · 3학년 1반</div>'
        +'<div style="padding:7px 10px;background:rgba(8,145,178,0.05);border-radius:7px;font-size:11px;color:#64748b;text-align:left">2. 김철수 · 3학년 2반</div>'
        +'<div style="padding:7px 10px;background:rgba(8,145,178,0.03);border-radius:7px;font-size:11px;color:#94a3b8;text-align:left">3. 이영희 · 2학년 1반</div>'
        +'</div></div>';
    }
    let panelContent='';
    if(displayMode==='rules')panelContent=_rulesPanelHtml();
    else if(displayMode==='queue')panelContent=_queuePanelHtml();
    else panelContent='<div style="display:flex;gap:10px;align-items:stretch">'+_rulesPanelHtml()+_queuePanelHtml()+'</div>';
    out+='<div style="background:#f5f7fa;border-radius:14px;padding:10px;border:1px solid #d1d9e0">'+panelContent+'</div>';
    out+='</div>';
    return out;
  }
  /* ── 플로우 요약 트리 (편집기 오른쪽 패널) ── */
  function _kioskFlowSummaryTreeHtml(){
    const flow=ks.flowDesigner;
    if(!flow||!flow.sections)return '<div style="padding:20px;color:var(--t3);font-size:11px">플로우가 설정되지 않았습니다.</div>';
    function _findSec(id){return flow.sections.find(function(s){return s.id===id;});}
    /* 트리 연결선 CSS (왼쪽과 동일) */
    let h='<style>'
      +'.fds-wrap{position:relative;padding-left:22px}'
      +'.fds-wrap::before{content:"";position:absolute;left:10px;top:0;bottom:0;width:0;border-left:1.5px solid var(--bdr)}'
      +'.fds-wrap.fds-last::before{bottom:50%}'
      +'.fds-item{position:relative;display:flex;align-items:center;gap:6px;padding:5px 8px;margin-bottom:2px;border-radius:6px;font-size:11px}'
      +'.fds-item::before{content:"";position:absolute;left:-12px;top:50%;width:12px;height:0;border-top:1.5px solid var(--bdr)}'
      +'</style>';
    /* 고정 항목 */
    h+='<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;font-weight:700;color:var(--t1)"><span>👤</span>인적사항 입력</div>';
    h+='<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;font-weight:700;color:var(--t1)"><span>🎯</span>방문 목적 선택</div>';
    /* 재귀 렌더 */
    function renderSummaryTree(secId,depth){
      var sec=_findSec(secId);
      if(!sec||!sec.options)return '';
      /* 터미널 확인 옵션만 있는 guide 섹션은 숨김 */
      var visOpts=sec.options.filter(function(o){
        var isTerm=!o.target||o.target.indexOf('__')===0;
        return !(isTerm&&sec.options.length===1&&sec.type==='guide');
      });
      if(!visOpts.length&&sec.type==='guide')return '';
      var out='';
      visOpts.forEach(function(opt,vi){
        var oi=sec.options.indexOf(opt);
        var childSecId=(opt.target&&opt.target.indexOf('__')!==0)?opt.target:null;
        var childSec=childSecId?_findSec(childSecId):null;
        var hasKids=!!(childSec&&childSec.options&&childSec.options.length>0);
        var isLast=(vi===visOpts.length-1)&&!hasKids;
        var colors=['#06b6d4','#8b5cf6','#22c55e','#f59e0b','#ef4444'];
        var col=colors[depth%colors.length];
        var canUp=(vi>0);
        var canDown=(vi<visOpts.length-1);
        out+='<div class="fds-wrap'+(isLast?' fds-last':'')+'">';
        out+='<div class="fds-item" style="background:'+(col+'0d')+';border:1px solid '+(col+'30')+'">';
        out+='<span style="font-size:14px;flex-shrink:0">'+(opt.emoji||'📌')+'</span>';
        out+='<span style="flex:1;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(opt.label||'')+'</span>';
        if(opt.hasBodymapInsert)out+='<span style="font-size:9px;color:var(--t3);flex-shrink:0">🧍</span>';
        if(hasKids)out+='<span style="font-size:8px;color:var(--t3)">▼</span>';
        /* ▲▼ 이동 버튼 */
        out+='<span style="display:flex;flex-direction:column;gap:1px;flex-shrink:0">';
        out+='<button data-action="fds-move-up" data-sec-id="'+secId+'" data-opt-idx="'+oi+'" style="width:16px;height:12px;border:none;background:transparent;color:'+(canUp?'var(--t2)':'transparent')+';cursor:'+(canUp?'pointer':'default')+';font-size:8px;padding:0;line-height:1;display:flex;align-items:center;justify-content:center" '+(canUp?'':'disabled')+'>▲</button>';
        out+='<button data-action="fds-move-down" data-sec-id="'+secId+'" data-opt-idx="'+oi+'" style="width:16px;height:12px;border:none;background:transparent;color:'+(canDown?'var(--t2)':'transparent')+';cursor:'+(canDown?'pointer':'default')+';font-size:8px;padding:0;line-height:1;display:flex;align-items:center;justify-content:center" '+(canDown?'':'disabled')+'>▼</button>';
        out+='</span>';
        out+='</div>';
        if(hasKids)out+=renderSummaryTree(childSecId,depth+1);
        out+='</div>';
      });
      return out;
    }
    h+=renderSummaryTree('s_purpose',0);
    return h;
  }

  /* ── 요약 패널 이벤트 (▲▼ 이동) ── */
  function _kioskAttachSummaryEvents(){
    const panel=document.getElementById('_kcFlowPreviewPanel');
    if(!panel||panel._fdsEventsAttached)return;
    panel._fdsEventsAttached=true;
    panel.addEventListener('click',function(e){
      const btn=e.target.closest('[data-action="fds-move-up"],[data-action="fds-move-down"]');
      if(!btn||btn.disabled)return;
      const secId=btn.dataset.secId;
      const optIdx=parseInt(btn.dataset.optIdx,10);
      const dir=btn.dataset.action==='fds-move-up'?-1:1;
      const flow=ks.flowDesigner;
      if(!flow)return;
      const sec=flow.sections.find(function(s){return s.id===secId;});
      if(!sec||!sec.options)return;
      const toIdx=optIdx+dir;
      if(toIdx<0||toIdx>=sec.options.length)return;
      /* 스왑 */
      const tmp=sec.options[optIdx];
      sec.options[optIdx]=sec.options[toIdx];
      sec.options[toIdx]=tmp;
      saveKioskSettings();
      /* 양쪽 패널 모두 갱신 */
      _kioskRefreshFlowPopup();
    });
  }

  /* ── 이용 수칙 & 순번 안내 편집기 팝업 ── */
  function _kioskOpenRulesEditorPopup(){
    const existing=document.getElementById('_kcRulesOverlay');
    if(existing)return;
    const ov=document.createElement('div');
    ov.id='_kcRulesOverlay';
    ov.className='modal-overlay show';
    ov.style.zIndex='12000';
    ov.innerHTML=_kioskRulesEditorHtml();
    _bindKioskCmsEvents(ov);
    const mc=ov.querySelector('.modal-content');
    if(mc){mc.style.transition='transform .25s ease,opacity .25s ease';mc.style.transform='scale(0.95)';mc.style.opacity='0';}
    ov.addEventListener('mousedown',function(e){
      if(e.target===ov){
        if(mc){mc.style.transform='scale(0.95)';mc.style.opacity='0';}
        ov.style.transition='opacity .2s';ov.style.opacity='0';
        setTimeout(function(){if(ov.parentNode)ov.remove();},250);
      }
    });
    document.body.appendChild(ov);
    requestAnimationFrame(function(){requestAnimationFrame(function(){if(mc){mc.style.transform='scale(1)';mc.style.opacity='1';}});});
    if(typeof _makeDraggable==='function')_makeDraggable(mc);
  }
  function _kioskRulesEditorRefresh(){
    const ov=document.getElementById('_kcRulesOverlay');
    if(!ov)return;
    const content=ov.querySelector('.modal-content');
    if(content){
      /* innerHTML로 내부만 교체 — DOM 노드 유지로 깜빡임 방지, 이벤트 위임은 overlay에 유지됨 */
      const newHtml=_kioskRulesEditorHtml();
      const m=newHtml.match(/<div class="modal-content"[^>]*>([\s\S]*)<\/div>\s*$/);
      if(m)content.innerHTML=m[1];
    }
    if(typeof _makeDraggable==='function')_makeDraggable(ov.querySelector('.modal-content'));
  }
  function _kioskRulesEditorHtml(){
    const r=_kioskGetRules();
    const ruleTitle=r.title||'보건실 이용 수칙 안내';
    const timeTitle=r.timeTitle||'운영 시간';
    const mannerTitle=r.mannerTitle||'지켜야 할 예절과 절차';
    const timeRules=r.time||[];
    const mannerRules=r.manners||[];
    const deviceType=ks.deviceType||'laptop';
    const displayMode=ks.displayMode||'rules';
    const alternateSec=ks.alternateSec||10;
    /* 편집기 */
    let edit='<div style="display:flex;flex-direction:column;gap:14px">';
    /* 기기 + 표시 모드 — 칩만 in-place 업데이트되도록 data-kc-*-chip 속성 부여 */
    edit+='<div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg2)">'
      +'<div style="display:flex;align-items:center;gap:5px"><span style="font-size:10px;font-weight:700;color:var(--t2)">📱 기기:</span>'
      +'<span data-kc-dev-chip="tablet" data-action="set-device" data-device="tablet" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(deviceType==='tablet'?'var(--cyan)':'var(--bdr)')+';background:'+(deviceType==='tablet'?'rgba(6,182,212,0.12)':'var(--bg2)')+';color:'+(deviceType==='tablet'?'var(--cyan)':'var(--t2)')+'">📱 태블릿</span>'
      +'<span data-kc-dev-chip="laptop" data-action="set-device" data-device="laptop" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(deviceType==='laptop'?'var(--cyan)':'var(--bdr)')+';background:'+(deviceType==='laptop'?'rgba(6,182,212,0.12)':'var(--bg2)')+';color:'+(deviceType==='laptop'?'var(--cyan)':'var(--t2)')+'">💻 노트북</span>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:5px"><span style="font-size:10px;font-weight:700;color:var(--t2)">🖥 표시:</span>';
    const modeOpts=[{k:'rules',l:'📋 수칙만'},{k:'queue',l:'👥 순번만'},{k:'alternate',l:'🔁 번갈아'}];
    const _altActive=displayMode==='alternate';
    modeOpts.forEach(function(o){
      const on=displayMode===o.k;
      if(o.k==='alternate'){
        /* 번갈아 칩 + 초 간격 input을 하나의 nowrap 그룹으로 묶어 절대 줄바꿈되지 않도록 */
        edit+='<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex-wrap:nowrap">'
          +'<span data-kc-mode-chip="'+o.k+'" data-action="set-display-mode" data-mode="'+o.k+'" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.12)':'var(--bg2)')+';color:'+(on?'var(--cyan)':'var(--t2)')+';flex-shrink:0">'+o.l+'</span>'
          +'<span id="_kcAltSecWrapInRules" style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0;opacity:'+(_altActive?'1':'0.35')+';pointer-events:'+(_altActive?'auto':'none')+';transition:opacity .15s"><input type="number" min="3" max="60" value="'+alternateSec+'"'+(_altActive?'':' disabled')+' data-action="set-alt-sec" style="width:42px;font-size:10px;padding:2px 5px;border:1px solid var(--bdr);border-radius:5px;background:var(--bg2);color:var(--t1)"><span style="font-size:10px;color:var(--t2)">초 간격</span></span>'
          +'</span>';
      } else {
        edit+='<span data-kc-mode-chip="'+o.k+'" data-action="set-display-mode" data-mode="'+o.k+'" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.12)':'var(--bg2)')+';color:'+(on?'var(--cyan)':'var(--t2)')+';flex-shrink:0">'+o.l+'</span>';
      }
    });
    edit+='</div></div>';
    /* 수칙 제목 */
    edit+='<div><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:12px;font-weight:700;color:var(--cyan)">📋</span>'
      +'<input class="form-input" data-action="rule-meta" data-meta-key="title" value="'+escHtml(ruleTitle)+'" style="font-size:13px;font-weight:700;color:var(--cyan);border:1px dashed var(--bdr);background:transparent;padding:4px 8px;flex:1;border-radius:6px" placeholder="수칙 제목"></div></div>';
    /* 섹션 1 */
    const _meta=ks.ruleMeta||{};
    const _timeIcon=_meta.timeIcon||'1';
    edit+='<div><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span data-action="emoji-pick-meta" data-meta-key="timeIcon" style="font-size:16px;cursor:pointer;transition:transform .15s" title="아이콘 변경">'+_timeIcon+'</span>'
      +'<input class="form-input" data-action="rule-meta" data-meta-key="timeTitle" value="'+escHtml(timeTitle)+'" style="font-size:12px;font-weight:700;color:var(--t1);border:1px dashed var(--bdr);background:transparent;padding:3px 6px;flex:1;border-radius:5px" placeholder="섹션 제목"></div>';
    timeRules.forEach(function(t,i){
      const txt=typeof t==='string'?t:(t.text||'');
      const isSub=typeof t==='object'&&t.sub;
      edit+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;'+(isSub?'padding-left:20px':'')+'">'+(isSub?'<span style="color:var(--cyan);font-size:9px;flex-shrink:0">▶</span>':'')+'<input class="form-input" data-action="update-rule" data-rule-section="time" data-rule-idx="'+i+'" value="'+escHtml(txt)+'" style="flex:1;font-size:11px;'+(isSub?'color:var(--t3);font-style:italic':'')+'">'
        +'<div data-action="toggle-sub-time" data-rule-idx="'+i+'" data-is-sub="'+(isSub?'true':'false')+'" style="cursor:pointer;width:22px;height:14px;border-radius:7px;background:'+(isSub?'var(--cyan)':'var(--bdr)')+';position:relative;flex-shrink:0;transition:background .15s" title="하위 항목 토글"><div style="width:10px;height:10px;border-radius:50%;background:#fff;position:absolute;top:2px;'+(isSub?'right:2px':'left:2px')+';transition:all .15s;box-shadow:0 1px 2px rgba(0,0,0,0.2)"></div></div>'
        +'<span data-action="remove-rule" data-rule-section="time" data-rule-idx="'+i+'" style="cursor:pointer;color:var(--red);font-size:10px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(239,68,68,0.1)">✕</span></div>';
    });
    edit+='<button data-action="add-rule" data-rule-section="time" class="btn btn-outline btn-sm" style="font-size:10px;margin-top:4px">+ 항목 추가</button></div>';
    /* 섹션 2 */
    const _mannerIcon=_meta.mannerIcon||'2';
    edit+='<div><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span data-action="emoji-pick-meta" data-meta-key="mannerIcon" style="font-size:16px;cursor:pointer;transition:transform .15s" title="아이콘 변경">'+_mannerIcon+'</span>'
      +'<input class="form-input" data-action="rule-meta" data-meta-key="mannerTitle" value="'+escHtml(mannerTitle)+'" style="font-size:12px;font-weight:700;color:var(--t1);border:1px dashed var(--bdr);background:transparent;padding:3px 6px;flex:1;border-radius:5px" placeholder="섹션 제목"></div>';
    mannerRules.forEach(function(m,i){
      const txt=typeof m==='string'?m:(m.text||'');
      const isSub=typeof m==='object'&&m.sub;
      edit+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;'+(isSub?'padding-left:20px':'')+'">'+(isSub?'<span style="color:var(--cyan);font-size:9px;flex-shrink:0">▶</span>':'')+'<input class="form-input" data-action="update-rule" data-rule-section="manners" data-rule-idx="'+i+'" value="'+escHtml(txt)+'" style="flex:1;font-size:11px;'+(isSub?'color:var(--t3);font-style:italic':'')+'">'
        +'<div data-action="toggle-sub" data-rule-idx="'+i+'" data-is-sub="'+(isSub?'true':'false')+'" style="cursor:pointer;width:22px;height:14px;border-radius:7px;background:'+(isSub?'var(--cyan)':'var(--bdr)')+';position:relative;flex-shrink:0;transition:background .15s" title="하위 항목 (들여쓰기) 토글"><div style="width:10px;height:10px;border-radius:50%;background:#fff;position:absolute;top:2px;'+(isSub?'right:2px':'left:2px')+';transition:all .15s;box-shadow:0 1px 2px rgba(0,0,0,0.2)"></div></div>'
        +'<span data-action="remove-rule" data-rule-section="manners" data-rule-idx="'+i+'" style="cursor:pointer;color:var(--red);font-size:10px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(239,68,68,0.1)">✕</span></div>';
    });
    edit+='<button data-action="add-rule" data-rule-section="manners" class="btn btn-outline btn-sm" style="font-size:10px;margin-top:4px">+ 항목 추가</button></div>';
    edit+='</div>';
    /* 미리보기 */
    const preview='<div id="_kcRulePreview" style="position:sticky;top:0">'+_kioskRulePreviewHtml()+'</div>';
    return '<div class="modal-content" style="width:1180px;max-width:98vw;max-height:94vh;padding:0;overflow:hidden;display:flex;flex-direction:column">'
      +'<div style="padding:14px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;cursor:grab">'
      +'<span style="font-size:14px;font-weight:800;color:var(--t1)">📋 이용 수칙 & 순번 안내 편집기</span>'
      +'<div style="display:flex;align-items:center;gap:10px"><span style="font-size:10px;color:var(--t3)">변경 사항은 자동 저장됩니다.</span>'
      +'<button data-action="reset-rules" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);color:#ef4444;font-size:10px;cursor:pointer;font-family:var(--f);font-weight:600">🔄 초기화</button></div>'
      +'</div>'
      +'<div style="flex:1;overflow-y:auto;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px">'
      +'<div>'+edit+'</div>'
      +'<div>'+preview+'</div>'
      +'</div>'
      +'</div>';
  }
  /* ══════════════════════════════════════════
     이용수칙 편집 트리 HTML 생성 (VS Code 스타일)
     ══════════════════════════════════════════ */
  function _ruleItemHtml(sec,item,idx){
    const txt=typeof item==='string'?item:(item.text||'');
    const isSub=typeof item==='object'&&item.sub;
    const marker=(typeof item==='object'&&item.marker)||(isSub?'▸':'●');
    const indent=isSub?'padding-left:22px;':'';
    return '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;'+indent+'">'
      +'<span data-action="pick-marker" data-rule-section="'+sec+'" data-rule-idx="'+idx+'" style="cursor:pointer;font-size:11px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid var(--bdr);background:var(--card);color:var(--cyan);flex-shrink:0;transition:all .12s" title="마커 변경 (클릭)">'+escHtml(marker)+'</span>'
      +'<input class="form-input" data-action="update-rule" data-rule-section="'+sec+'" data-rule-idx="'+idx+'" value="'+escHtml(txt)+'" style="flex:1;font-size:11px;padding:3px 6px;'+(isSub?'color:var(--t3);font-style:italic':'')+'">'
      +'<span data-action="indent-rule" data-rule-section="'+sec+'" data-rule-idx="'+idx+'" data-is-sub="'+(isSub?'1':'0')+'" style="cursor:pointer;font-size:9px;width:20px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid var(--bdr);background:var(--card);color:var(--t3);flex-shrink:0" title="'+(isSub?'내어쓰기':'들여쓰기')+'">'+(isSub?'⇤':'⇥')+'</span>'
      +'<span data-action="remove-rule" data-rule-section="'+sec+'" data-rule-idx="'+idx+'" style="cursor:pointer;color:var(--red);font-size:9px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(239,68,68,0.08);flex-shrink:0">✕</span>'
      +'</div>';
  }

  function _buildRulesTreeHtml(){
    const r=_kioskGetRules();
    const ruleTitle=r.title||'보건실 이용 수칙 안내';
    const meta=ks.ruleMeta||{};
    const _titleIcon=meta.titleIcon||'🩺';
    const timeTitle=r.timeTitle||'운영 시간';
    const mannerTitle=r.mannerTitle||'지켜야 할 예절과 절차';
    const timeRules=r.time||[];
    const mannerRules=r.manners||[];
    const _timeIcon=meta.timeIcon||'1';
    const _mannerIcon=meta.mannerIcon||'2';

    let h='<div style="display:flex;flex-direction:column;gap:0;font-family:var(--f)">';
    /* 루트: 수칙 제목 */
    h+='<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--bdr);margin-bottom:8px">'
      +'<span data-action="emoji-pick-meta" data-meta-key="titleIcon" style="font-size:16px;cursor:pointer" title="아이콘 변경">'+_titleIcon+'</span>'
      +'<input class="form-input" data-action="rule-meta" data-meta-key="title" value="'+escHtml(ruleTitle)+'" style="font-size:13px;font-weight:800;color:var(--cyan);border:none;background:transparent;padding:2px 4px;flex:1" placeholder="수칙 제목">'
      +'</div>';
    /* 섹션 1: 운영 시간 */
    h+='<div style="margin-bottom:10px">'
      +'<div style="display:flex;align-items:center;gap:6px;padding:4px 0;margin-bottom:4px">'
      +'<span style="color:var(--bdr);font-size:10px">├──</span>'
      +'<span data-action="emoji-pick-meta" data-meta-key="timeIcon" style="font-size:14px;cursor:pointer" title="아이콘 변경">'+_timeIcon+'</span>'
      +'<input class="form-input" data-action="rule-meta" data-meta-key="timeTitle" value="'+escHtml(timeTitle)+'" style="font-size:12px;font-weight:700;color:var(--t1);border:1px dashed var(--bdr);background:transparent;padding:2px 6px;flex:1;border-radius:4px" placeholder="섹션 제목">'
      +'</div>';
    h+='<div style="padding-left:28px;border-left:1px solid var(--bdr);margin-left:6px">';
    timeRules.forEach(function(t,i){ h+=_ruleItemHtml('time',t,i); });
    h+='<button data-action="add-rule" data-rule-section="time" style="font-size:10px;color:var(--cyan);background:none;border:1px dashed var(--bdr);border-radius:4px;padding:2px 10px;cursor:pointer;margin-top:2px;font-family:var(--f)">+ 항목 추가</button>';
    h+='</div></div>';
    /* 섹션 2: 예절 */
    h+='<div style="margin-bottom:10px">'
      +'<div style="display:flex;align-items:center;gap:6px;padding:4px 0;margin-bottom:4px">'
      +'<span style="color:var(--bdr);font-size:10px">└──</span>'
      +'<span data-action="emoji-pick-meta" data-meta-key="mannerIcon" style="font-size:14px;cursor:pointer" title="아이콘 변경">'+_mannerIcon+'</span>'
      +'<input class="form-input" data-action="rule-meta" data-meta-key="mannerTitle" value="'+escHtml(mannerTitle)+'" style="font-size:12px;font-weight:700;color:var(--t1);border:1px dashed var(--bdr);background:transparent;padding:2px 6px;flex:1;border-radius:4px" placeholder="섹션 제목">'
      +'</div>';
    h+='<div style="padding-left:28px;border-left:1px solid var(--bdr);margin-left:6px">';
    mannerRules.forEach(function(m,i){ h+=_ruleItemHtml('manners',m,i); });
    h+='<button data-action="add-rule" data-rule-section="manners" style="font-size:10px;color:var(--cyan);background:none;border:1px dashed var(--bdr);border-radius:4px;padding:2px 10px;cursor:pointer;margin-top:2px;font-family:var(--f)">+ 항목 추가</button>';
    h+='</div></div>';
    /* 추가 섹션들 (③, ④, ...) */
    var extras=r.extraSections||[];
    var circled=['③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    extras.forEach(function(sec,si){
      var secIcon=sec.icon||circled[si]||('('+(si+3)+')');
      var secTitle=sec.title||'';
      var items=sec.items||[];
      var isLast=(si===extras.length-1);
      h+='<div style="margin-bottom:10px">'
        +'<div style="display:flex;align-items:center;gap:6px;padding:4px 0;margin-bottom:4px">'
        +'<span style="color:var(--bdr);font-size:10px">'+(isLast?'└──':'├──')+'</span>'
        +'<span data-action="pick-extra-icon" data-extra-idx="'+si+'" style="font-size:14px;cursor:pointer" title="아이콘 변경">'+escHtml(secIcon)+'</span>'
        +'<input class="form-input" data-action="update-extra-title" data-extra-idx="'+si+'" value="'+escHtml(secTitle)+'" style="font-size:12px;font-weight:700;color:var(--t1);border:1px dashed var(--bdr);background:transparent;padding:2px 6px;flex:1;border-radius:4px" placeholder="섹션 제목">'
        +'<span data-action="remove-extra-section" data-extra-idx="'+si+'" style="cursor:pointer;color:var(--red);font-size:9px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(239,68,68,0.15);background:rgba(239,68,68,0.08);flex-shrink:0" title="섹션 삭제">✕</span>'
        +'</div>';
      h+='<div style="padding-left:28px;border-left:1px solid var(--bdr);margin-left:6px">';
      items.forEach(function(item,ii){ h+=_ruleItemHtml('extra_'+si,item,ii); });
      h+='<button data-action="add-rule" data-rule-section="extra_'+si+'" style="font-size:10px;color:var(--cyan);background:none;border:1px dashed var(--bdr);border-radius:4px;padding:2px 10px;cursor:pointer;margin-top:2px;font-family:var(--f)">+ 항목 추가</button>';
      h+='</div></div>';
    });
    /* 섹션 추가 버튼 */
    h+='<button data-action="add-extra-section" style="font-size:10px;color:var(--cyan);background:none;border:1px dashed var(--bdr);border-radius:6px;padding:4px 12px;cursor:pointer;margin-top:6px;font-family:var(--f)">+ 섹션 추가</button>';
    h+='</div>';
    return h;
  }

  function _refreshEditorRulesPanel(){
    const el=document.getElementById('_kcEditorRules');
    if(el) el.innerHTML=_buildRulesTreeHtml();
  }

  /* ══════════════════════════════════════════
     언어 토글 행 — 편집 팝업 액션바 아래
     ══════════════════════════════════════════
     ks.languages = ['ko', ...selected_foreign_codes] 단일 출처.
     - ko 는 잠금 (항상 선택)
     - 선택된 외국어는 좌측으로 정렬, 미선택은 우측
     - 좌우 그룹 사이에 회색 구분선
     - 우측에 프롬프트 복사 / 결과 붙여넣기 버튼 (외국어 0개면 비활성) */
  function _kcRenderLangBarHtml(){
    const langs = KIOSK_LANG_ALL;
    const sel = new Set(ks.languages || ['ko']);
    const ko     = langs.filter(l => l.code === 'ko');
    const selFor = langs.filter(l => l.code !== 'ko' && sel.has(l.code));
    const unsel  = langs.filter(l => l.code !== 'ko' && !sel.has(l.code));
    const ordered = [...ko, ...selFor, ...unsel];
    const foreignCount = selFor.length;

    let chipsHtml = '';
    ordered.forEach((l, i) => {
      const isSel = sel.has(l.code);
      const isLocked = l.code === 'ko';
      /* 선택/미선택 경계 구분선 1개 */
      if(i === ko.length + selFor.length && selFor.length > 0 && unsel.length > 0){
        chipsHtml += '<span style="width:1px;height:32px;background:var(--bdr);margin:0 4px;flex-shrink:0"></span>';
      }
      chipsHtml += '<div '
        + (isLocked ? '' : 'data-action="kc-toggle-lang" data-lang="' + l.code + '" ')
        + 'title="' + escHtml(l.name) + (isLocked ? ' (기본 · 잠금)' : '') + '" '
        + 'style="position:relative;width:42px;height:42px;border:2px solid '
        +   (isSel ? 'var(--cyan)' : 'var(--bdr)') + ';border-radius:9px;background:var(--card);'
        +   'cursor:' + (isLocked ? 'default' : 'pointer') + ';transition:all .15s ease;'
        +   'display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;'
        +   (isSel ? 'box-shadow:0 0 0 3px rgba(6,182,212,0.18);' : '') + '">'
        + '<span style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;'
        +   (isSel ? '' : 'filter:grayscale(1) opacity(0.4);') + 'transition:filter .15s ease">'
        +   (FLAG_SVGS[l.code] || '<span style="font-size:24px">🌐</span>')
        + '</span>'
        + (isSel ? '<span style="position:absolute;left:50%;bottom:2px;transform:translateX(-50%);width:22px;height:3px;border-radius:2px;background:#0891b2"></span>' : '')
        + '</div>';
    });

    const promptBtnAttrs = (foreignCount===0)
      ? 'disabled style="opacity:0.4;cursor:not-allowed;font-size:11px;padding:6px 14px"'
      : 'style="font-size:11px;padding:6px 14px"';
    const pasteBtnAttrs = (foreignCount===0)
      ? 'disabled style="opacity:0.4;cursor:not-allowed;font-size:11px;padding:6px 14px;border:1px solid var(--bdr);color:var(--t3);background:var(--card)"'
      : 'style="font-size:11px;padding:6px 14px;border:1px solid var(--cyan);color:var(--cyan);background:rgba(6,182,212,0.06)"';

    return '<div id="_kcLangBar" style="flex-shrink:0;padding:10px 16px;border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr);background:linear-gradient(180deg,rgba(6,182,212,0.04),rgba(6,182,212,0.01))">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap">'
      +   '<span style="font-size:11px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:6px">🌐 다국어 지원'
      +   '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(6,182,212,0.12);color:var(--cyan);font-weight:700">' + sel.size + '개 언어 (외국어 ' + foreignCount + ')</span></span>'
      +   '<span style="font-size:10px;color:var(--t3);flex:1;min-width:160px">기본 한국어 + 클릭한 국기 = 키오스크에 표시될 언어. 한국 국기는 잠금.</span>'
      +   '<button data-action="kc-open-prompt" class="btn btn-primary btn-sm" ' + promptBtnAttrs + '>📋 AI 번역 프롬프트 복사</button>'
      +   '<button data-action="kc-open-paste" class="btn btn-sm" ' + pasteBtnAttrs + '>📥 AI 번역 결과 붙여넣기 (번역문 넣기)</button>'
      + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' + chipsHtml + '</div>'
      + '<div style="margin-top:8px;font-size:11px;line-height:1.55;color:var(--t3);background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.18);border-radius:8px;padding:8px 11px">⏱ 방문자가 외국어를 선택해도 <b style="color:var(--t2)">1분간 사용이 없거나 접수가 끝나면 자동으로 한국어로 돌아갑니다.</b> (다음 방문자를 위해)</div>'
      + '</div>';
  }

  /* 토글 후 lang bar 만 재렌더 (다른 영역 영향 없음) */
  function _kcRefreshLangBar(){
    const el = document.getElementById('_kcLangBar');
    if(!el) return;
    /* outerHTML 교체 — innerHTML 만 바꾸면 wrapper 의 padding 등이 중복되므로 */
    const tmp = document.createElement('div');
    tmp.innerHTML = _kcRenderLangBarHtml();
    const newEl = tmp.firstChild;
    if(newEl && el.parentNode) el.parentNode.replaceChild(newEl, el);
  }

  /* 표준 전역 저장 토스트 — "저장 중…" → "모든 내용이 저장되었습니다." (data-loader.saveData 와 동일 톤) */
  let _kcSaveToastTimer = null;
  function _kcShowSaveToast(){
    const t = document.getElementById('globalSaveToast');
    if(!t) return;
    t.textContent = '저장 중…';
    t.className = 'global-save-toast show saving';
    if(_kcSaveToastTimer) clearTimeout(_kcSaveToastTimer);
    _kcSaveToastTimer = setTimeout(function(){
      t.textContent = '모든 내용이 저장되었습니다.';
      t.className = 'global-save-toast show';
      setTimeout(function(){ t.className = 'global-save-toast'; }, 2000);
    }, 250);
  }

  /* ══════════════════════════════════════════
     [🎨 키오스크 작동 플로우 설계] 진입 모달
     방향(Step1)·유형(Step2)을 먼저 고르고 [설계 시작] → 편집기 오픈.
     (Step1/Step2 를 메인 패널에서 떼어 모달로 이동 — 사용자 결정 2026-06-15.
      방향만 바꾸고 멈추던 "생성 필요" 혼란을 없애고, 선택→바로 설계→[생성] 흐름으로 통일.)
     ══════════════════════════════════════════ */
  function _kioskStartDesign(){
    if(!ks.channelId||!ks.authToken)_kioskCreateNewChannel(); /* 편집 진입 시 채널 자동 생성 (2026-06-11) */
    /* 화면 편집 중에는 라이브 아님 — 활성 토글 끔 (사용자 요청 2026-06-11). 편집·재다운로드 후 다시 켜는 흐름. */
    if(ks.active){ ks.active=false; _relayOk=false; _save(); bus.emit('kiosk:sidebar-refresh'); renderSettingsPanel('kiosk'); }
    _kioskOpenEditorPopup();
  }
  function _kioskSetupModalInner(){
    const kO=ks.kioskOrientation||'landscape';
    const kT=ks.kioskType||'basic';
    const base='display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;border:2px solid var(--bdr);background:var(--card);cursor:pointer;transition:all .15s;flex:1;min-width:200px';
    const on='border-color:var(--cyan);background:rgba(6,182,212,0.08);box-shadow:0 0 0 3px rgba(6,182,212,0.12)';
    let h='';
    h+='<div style="background:var(--bg2);padding:16px 22px;border-bottom:1px solid var(--bdr)"><div style="font-size:15px;font-weight:800;color:var(--t1)">🎨 키오스크 작동 플로우 설계</div><div style="font-size:10.5px;color:var(--t3);margin-top:3px">먼저 화면 방향과 유형을 고른 뒤 [설계 시작]을 누르면 편집 화면이 열립니다.</div></div>';
    h+='<div style="padding:18px 22px">';
    /* Step 1 */
    h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">Step 1. 화면을 어떻게 배치할 것인지 선택하세요</div>';
    h+='<div style="font-size:10px;color:var(--t3);margin-bottom:6px">키오스크 화면의 방향을 선택합니다.</div>';
    h+='<div style="font-size:11px;font-weight:600;color:var(--cyan);margin-bottom:10px;line-height:1.5">🖥️ 가로 디스플레이에서는 보건실 이용 안내 등의 별도 안내가 상시 표시됩니다.</div>';
    h+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">';
    h+='<div data-action="setup-orient" data-kiosk-orient="landscape" style="'+base+';'+(kO==='landscape'?on:'')+'"><span style="font-size:22px">🖥️</span><div><div style="font-size:12px;font-weight:700;color:'+(kO==='landscape'?'var(--cyan)':'var(--t1)')+'">가로로 디스플레이</div><div style="font-size:9px;color:var(--t3);margin-top:1px">일반적인 모니터/노트북/태블릿 가로 배치</div></div></div>';
    h+='<div data-action="setup-orient" data-kiosk-orient="portrait" style="'+base+';'+(kO==='portrait'?on:'')+'"><span style="font-size:22px">📲</span><div><div style="font-size:12px;font-weight:700;color:'+(kO==='portrait'?'var(--cyan)':'var(--t1)')+'">세로로 디스플레이</div><div style="font-size:9px;color:var(--t3);margin-top:1px">태블릿 세로 또는 세로 모니터</div></div></div>';
    h+='</div>';
    /* Step 2 */
    h+='<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">Step 2. 희망하는 키오스크 유형을 선택하세요</div>';
    h+='<div style="font-size:10px;color:var(--t3);margin-bottom:10px">기본형은 기본 문항 포함, 확장형은 세부 분기가 포함된 플로우입니다.</div>';
    h+='<div style="display:flex;gap:10px;flex-wrap:wrap">';
    h+='<div data-action="setup-type" data-kiosk-type="basic" style="'+base+';'+(kT==='basic'?on:'')+'"><span style="font-size:22px">📋</span><div><div style="font-size:12px;font-weight:700;color:'+(kT==='basic'?'var(--cyan)':'var(--t1)')+'">기본형</div><div style="font-size:9px;color:var(--t3);margin-top:1px">간단한 기본 문항 포함</div></div></div>';
    h+='<div data-action="setup-type" data-kiosk-type="extended" style="'+base+';'+(kT==='extended'?on:'')+'"><span style="font-size:22px">🔀</span><div><div style="font-size:12px;font-weight:700;color:'+(kT==='extended'?'var(--cyan)':'var(--t1)')+'">확장형</div><div style="font-size:9px;color:var(--t3);margin-top:1px">물품 대여·반납, 문의, 상담 등 세부 분기 포함</div></div></div>';
    h+='</div>';
    h+='</div>';
    h+='<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid var(--bdr);background:var(--bg2)">';
    h+='<button data-action="setup-start" class="btn btn-primary btn-sm" style="font-size:12px;padding:9px 22px;font-weight:700">설계 시작 →</button>';
    h+='</div>';
    return h;
  }
  function _kioskSetupModalRefresh(box){ if(box) box.innerHTML=_kioskSetupModalInner(); }
  function _kioskOpenSetupModal(){
    if(document.getElementById('_kcSetupOverlay'))return;
    const ov=document.createElement('div');ov.id='_kcSetupOverlay';
    ov.style.cssText='position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.28);pointer-events:auto';
    const box=document.createElement('div');
    box.style.cssText='width:580px;max-width:94vw;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,0.28);border:1px solid var(--bdr);background:var(--card);transform:scale(0.94) translateY(10px);opacity:0;transition:transform .22s ease,opacity .22s ease;overflow:hidden';
    box.innerHTML=_kioskSetupModalInner();
    ov.appendChild(box);
    function _close(){ box.style.transform='scale(0.94) translateY(10px)';box.style.opacity='0';setTimeout(function(){if(ov.parentNode)ov.remove();},230);document.removeEventListener('keydown',onKey,true); }
    function onKey(ev){ if(ev.key==='Escape'){ ev.preventDefault(); _close(); } }
    box.addEventListener('click',function(e){
      const el=e.target.closest('[data-action]');if(!el||!box.contains(el))return;
      const act=el.dataset.action;
      if(act==='setup-orient'){ const o=el.dataset.kioskOrient;if(o){ ks.kioskOrientation=o;_save();_kioskSetupModalRefresh(box); } }
      else if(act==='setup-type'){
        const t=el.dataset.kioskType;
        if(t && ks.kioskType!==t){
          /* 타입이 바뀌면 현재 데이터를 타입별 슬롯에 저장하고, 새 타입 슬롯에서 복원 (Step2 와 동일 로직) */
          var oldType=ks.kioskType||'basic';
          if(!ks._typeSlots) ks._typeSlots={};
          ks._typeSlots[oldType]={flow:ks.flowDesigner,rules:ks.customRules,meta:ks.ruleMeta};
          var slot=(ks._typeSlots[t])||{};
          ks.flowDesigner=slot.flow||null;
          ks.customRules=slot.rules||null;
          ks.ruleMeta=slot.meta||null;
          ks.kioskType=t;_save();
        }
        _kioskSetupModalRefresh(box);
      }
      else if(act==='setup-start'){ _close(); renderSettingsPanel('kiosk'); _kioskStartDesign(); }
      else if(act==='setup-cancel'){ _close(); }
    });
    document.body.appendChild(ov);
    requestAnimationFrame(function(){requestAnimationFrame(function(){box.style.transform='scale(1) translateY(0)';box.style.opacity='1';});});
    ov.addEventListener('click',function(e){if(e.target===ov)_close();});
    document.addEventListener('keydown',onKey,true);
  }

  /* ══════════════════════════════════════════
     통합 키오스크 편집 팝업
     가로형: 왼쪽 이용수칙 + 오른쪽 플로우
     세로형: 플로우만
     ══════════════════════════════════════════ */
  function _kioskOpenEditorPopup(){
    const existing=document.getElementById('_kcEditorOverlay');
    if(existing)return;
    /* 언어 기본값 보장 — ks.languages 가 비어있으면 ['ko'] 로 초기화 */
    kioskEnsureDefaultLangs();
    const kOrient=ks.kioskOrientation||'landscape';
    const kType=ks.kioskType||'basic';
    const isPortrait=(kOrient==='portrait');
    const orientLabel=isPortrait?'📲 세로형':'🖥️ 가로형';
    const typeLabel=kType==='basic'?'📋 기본형':'🔀 확장형';

    /* 플로우 편집기 HTML */
    const designerHtml=kioskFlowDesignerHtml();

    /* 이용수칙 편집기 HTML — 재사용 가능한 함수로 분리 */
    let rulesEditHtml='';
    if(!isPortrait){ rulesEditHtml=_buildRulesTreeHtml(); }

    /* 본문 레이아웃 */
    let bodyLayout;
    if(isPortrait){
      /* 세로형: 플로우만 전체 폭 */
      bodyLayout='<div id="_kcFlowBody" style="flex:1;overflow-y:auto;padding:18px">'+designerHtml+'</div>';
    } else {
      /* 가로형: 왼쪽 이용수칙 + 오른쪽 플로우 */
      bodyLayout='<div style="flex:1;display:flex;overflow:hidden;min-height:0">'
        +'<div id="_kcEditorRules" style="flex:0 0 38%;max-width:38%;overflow-y:auto;padding:16px;border-right:1px solid var(--bdr)">'+rulesEditHtml+'</div>'
        +'<div id="_kcFlowBody" style="flex:1;overflow-y:auto;padding:18px">'+designerHtml+'</div>'
        +'</div>';
    }

    const ov=document.createElement('div');
    ov.id='_kcEditorOverlay';
    ov.className='modal-overlay show';
    ov.style.zIndex='12000';
    ov.innerHTML='<div class="modal-content" style="width:1600px;max-width:94vw;max-height:92vh;padding:0;overflow:hidden;display:flex;flex-direction:column">'
      /* 헤더 */
      +'<div style="padding:12px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;cursor:grab">'
      +'<div style="display:flex;align-items:center;gap:10px">'
      +'<span style="font-size:16px">🎨</span>'
      +'<span style="font-size:14px;font-weight:800;color:var(--t1)">키오스크 작동 플로우 설계</span>'
      +'<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(6,182,212,0.1);color:var(--cyan);font-weight:600">'+orientLabel+'</span>'
      +'<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(6,182,212,0.1);color:var(--cyan);font-weight:600">'+typeLabel+'</span>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<button data-action="editor-preview" class="btn btn-outline btn-sm" style="font-size:10px;padding:4px 12px">👁 현재 기준으로 생성되는 키오스크 미리보기</button>'
      +'<button data-action="editor-download" class="btn btn-primary btn-sm" data-tooltip="키오스크 화면을 서버에 올리고 접속 QR·URL·인증키를 만듭니다. (시간이 다소 소요될 수 있습니다)" data-tooltip-instant="1" style="font-size:10px;padding:4px 12px">🔗 키오스크 생성 &amp; 접속용 QR 코드와 URL 보기</button>'
      +''
      +'</div>'
      +'</div>'
      /* URL 재생성 필요 안내 — 편집만 하면 자동 반영되는 줄 착각 방지 (URL 접속 방식 전환 2026-06-12) */
      +'<div style="padding:7px 20px;background:rgba(245,158,11,0.10);border-bottom:1px solid rgba(245,158,11,0.3);font-size:11px;font-weight:700;color:#b45309;flex-shrink:0;line-height:1.6">⚠️ 여기서 수정한 내용은 키오스크에 자동 반영되지 않습니다. 편집을 마치면 <b>[🔗 키오스크 생성 &amp; 접속용 QR 코드와 URL 보기]</b>으로 서버에 반영한 뒤, 키오스크 기기에서 <b>새로고침</b>해 주세요. (접속 주소는 그대로 유지됩니다)</div>'
      /* 액션바 (플로우 디자이너 메뉴가 이동됨) */
      +'<div id="_kcFlowActionBar" style="flex-shrink:0"></div>'
      /* 다국어 토글 행 */
      +_kcRenderLangBarHtml()
      /* 본문 */
      +bodyLayout
      +'</div>';

    const _mc=ov.querySelector('.modal-content');
    ov.addEventListener('mousedown',function(e){ if(e.target===ov) closeModalGracefully(ov); });

    /* 이벤트 바인딩 */
    _bindKioskCmsEvents(ov);
    document.body.appendChild(ov);
    if(typeof _makeDraggable==='function')_makeDraggable(_mc);
    /* data-tooltip 미니팝업 위임 — 편집 오버레이는 설정패널 밖이라 별도 부착 (바디맵·접수·증상처치입력 체크박스 안내). 프로그램과 동일 showHeaderTooltip. (2026-06-11) */
    ov.addEventListener('mouseover',function(e){
      const el=e.target.closest&&e.target.closest('[data-tooltip]'); if(!el)return;
      const txt=el.getAttribute('data-tooltip'); if(!txt)return;
      try{ showHeaderTooltip(e, txt, false, true); }catch(_){}
    });
    ov.addEventListener('mouseout',function(e){
      const el=e.target.closest&&e.target.closest('[data-tooltip]'); if(!el)return;
      if(el.contains(e.relatedTarget))return;
      try{ hideHeaderTooltip(); }catch(_){}
    });

    /* 플로우 디자이너 메뉴바를 actionBar로 이동 */
    setTimeout(function(){
      const ab=document.getElementById('_kcFlowActionBar');
      const fb=document.getElementById('_kcFlowBody');
      if(ab&&fb){const tb=fb.querySelector('[style*="position:sticky"]');if(tb){ab.innerHTML='';ab.appendChild(tb);tb.style.position='static';tb.style.borderRadius='0';tb.style.margin='0';}}
    },0);

    /* 플로우 본문 이벤트 바인딩 */
    const _fb=document.getElementById('_kcFlowBody');
    if(_fb)_fdAttachEvents(_fb);
  }

  /* ── 플로우 디자이너 팝업 ── */
  function _kioskOpenFlowDesignerPopup(){
    const existing=document.getElementById('_kcFlowOverlay');
    if(existing)return; /* 토글 아님 */
    const ov=document.createElement('div');
    ov.id='_kcFlowOverlay';
    ov.className='modal-overlay show';
    ov.style.zIndex='12000';
    let designerHtml='';
    designerHtml=kioskFlowDesignerHtml();
    const deviceType=ks.deviceType||'laptop';
    const displayMode=ks.displayMode||'rules';
    const alternateSec=ks.alternateSec||10;
    /* 기기 + 표시 모드 선택 바 — 칩 in-place 업데이트용 data 속성 */
    let topBar='<div style="display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-bottom:1px solid var(--bdr);background:var(--bg2)">'
      +'<div style="display:flex;align-items:center;gap:5px"><span style="font-size:10px;font-weight:700;color:var(--t2)">📱 기기:</span>'
      +'<span data-kc-dev-chip="tablet" data-action="set-device" data-device="tablet" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(deviceType==='tablet'?'var(--cyan)':'var(--bdr)')+';background:'+(deviceType==='tablet'?'rgba(6,182,212,0.12)':'var(--card)')+';color:'+(deviceType==='tablet'?'var(--cyan)':'var(--t2)')+'">📱 태블릿</span>'
      +'<span data-kc-dev-chip="laptop" data-action="set-device" data-device="laptop" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(deviceType==='laptop'?'var(--cyan)':'var(--bdr)')+';background:'+(deviceType==='laptop'?'rgba(6,182,212,0.12)':'var(--card)')+';color:'+(deviceType==='laptop'?'var(--cyan)':'var(--t2)')+'">💻 노트북</span>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:5px"><span style="font-size:10px;font-weight:700;color:var(--t2)">🖥 표시:</span>';
    const modeOpts=[{k:'rules',l:'📋 수칙만'},{k:'queue',l:'👥 순번만'},{k:'alternate',l:'🔁 번갈아'}];
    const _altActiveF=displayMode==='alternate';
    modeOpts.forEach(function(o){
      const on=displayMode===o.k;
      if(o.k==='alternate'){
        /* 번갈아 칩 + 초 간격 input을 하나의 nowrap 그룹으로 묶음 (줄바꿈 방지) */
        topBar+='<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex-wrap:nowrap">'
          +'<span data-kc-mode-chip="'+o.k+'" data-action="set-display-mode" data-mode="'+o.k+'" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.12)':'var(--card)')+';color:'+(on?'var(--cyan)':'var(--t2)')+';flex-shrink:0">'+o.l+'</span>'
          +'<span id="_kcAltSecWrapInFlow" style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0;opacity:'+(_altActiveF?'1':'0.35')+';pointer-events:'+(_altActiveF?'auto':'none')+';transition:opacity .15s"><input type="number" min="3" max="60" value="'+alternateSec+'"'+(_altActiveF?'':' disabled')+' data-action="set-alt-sec" style="width:42px;font-size:10px;padding:2px 5px;border:1px solid var(--bdr);border-radius:5px;background:var(--card);color:var(--t1)"><span style="font-size:10px;color:var(--t2)">초 간격</span></span>'
          +'</span>';
      } else {
        topBar+='<span data-kc-mode-chip="'+o.k+'" data-action="set-display-mode" data-mode="'+o.k+'" style="cursor:pointer;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.12)':'var(--card)')+';color:'+(on?'var(--cyan)':'var(--t2)')+';flex-shrink:0">'+o.l+'</span>';
      }
    });
    topBar+='</div></div>';
    /* 우측 미리보기 패널 — 접기 상태 + 드래그 리사이즈 (폭 저장) */
    const previewHtml = _kioskFlowSummaryTreeHtml();
    const previewCollapsed = localStorage.getItem('ec_kiosk_fd_preview_collapsed')==='1';
    let previewWidth = parseInt(localStorage.getItem('ec_kiosk_fd_preview_width')||'420',10);
    if(isNaN(previewWidth)||previewWidth<300)previewWidth=300;
    if(previewWidth>700)previewWidth=700;
    ov.innerHTML='<div class="modal-content" style="width:1600px;max-width:90vw;max-height:90vh;padding:0;overflow:hidden;display:flex;flex-direction:column">'
      +'<div style="padding:14px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;cursor:grab">'
      +'<span style="font-size:14px;font-weight:800;color:var(--t1)">🔀 버튼 플로우 편집기</span>'
      +'<div style="display:flex;align-items:center;gap:12px">'
      +'<span style="font-size:10px;color:var(--t3)">바깥을 클릭해 닫을 수 있습니다</span>'
      +'<button id="_kcFlowCloseBtn" style="font-size:18px;width:32px;height:32px;border-radius:8px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--f);transition:background .15s,color .15s" title="닫기">&times;</button>'
      +'</div></div>'
      +topBar
      +'<div id="_kcFlowActionBar" style="flex-shrink:0"></div>'
      +'<div style="flex:1;display:flex;overflow:hidden;min-height:0;position:relative">'
      +  '<div id="_kcFlowBody" style="flex:1;overflow-y:auto;padding:18px;min-width:0">'+designerHtml+'</div>'
      /* 리사이즈 핸들 — 패널 왼쪽 경계 */
      +  '<div id="_kcFlowPreviewResizer" style="width:5px;flex-shrink:0;cursor:col-resize;background:transparent;position:relative;'+(previewCollapsed?'display:none':'')+'" title="드래그해 패널 폭 조절"></div>'
      +  '<div id="_kcFlowPreviewPanel" style="width:'+(previewCollapsed?'32':previewWidth)+'px;flex-shrink:0;border-left:1px solid var(--bdr);background:var(--bg2);overflow:hidden;display:flex;flex-direction:column;transition:'+(previewCollapsed?'width .25s ease':'none')+'">'
      +    '<div style="padding:10px 14px;border-bottom:1px solid var(--bdr);background:var(--card);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:6px">'
      +      '<span id="_kcFlowPreviewTitle" style="font-size:11px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;'+(previewCollapsed?'display:none':'')+'">📋 플로우 요약</span>'
      +      '<div style="display:flex;gap:4px">'
      +        '<button data-action="toggle-preview-panel" style="font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--bdr);background:var(--card);color:var(--t2);cursor:pointer;font-family:var(--f);white-space:nowrap" title="'+(previewCollapsed?'요약 펼치기':'요약 접기')+'">'+(previewCollapsed?'◀':'▶')+'</button>'
      +      '</div>'
      +    '</div>'
      +    '<div id="_kcFlowPreview" style="flex:1;overflow-y:auto;padding:14px;'+(previewCollapsed?'display:none':'')+'">'+previewHtml+'</div>'
      +  '</div>'
      +'</div>'
      +'</div>';
    const _flowMc=ov.querySelector('.modal-content');
    if(_flowMc){_flowMc.style.transition='transform .25s ease,opacity .25s ease';_flowMc.style.transform='scale(0.95)';_flowMc.style.opacity='0';}
    ov.addEventListener('mousedown',function(e){
      if(e.target===ov){
        try{ _fdFlushSave(); }catch(_){}  /* 외부 클릭 닫기 시 대기 중 자동저장 즉시 반영(손실 방지) */
        if(_flowMc){_flowMc.style.transform='scale(0.95)';_flowMc.style.opacity='0';}
        ov.style.transition='opacity .2s';ov.style.opacity='0';
        setTimeout(function(){if(ov.parentNode)ov.remove();},250);
      }
    });
    /* 닫기 버튼 */
    const _closeBtn=ov.querySelector('#_kcFlowCloseBtn');
    if(_closeBtn)_closeBtn.addEventListener('click',function(){
      try{ _fdFlushSave(); }catch(_){}  /* ✕ 닫기 시 대기 중 자동저장 즉시 반영(손실 방지) */
      if(_flowMc){_flowMc.style.transform='scale(0.95)';_flowMc.style.opacity='0';}
      ov.style.transition='opacity .2s';ov.style.opacity='0';
      setTimeout(function(){if(ov.parentNode)ov.remove();},250);
    });
    /* 이벤트 바인딩 */
    _bindKioskCmsEvents(ov);
    /* resizer hover */
    const _resizer=ov.querySelector('#_kcFlowPreviewResizer');
    if(_resizer){_resizer.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.25)';});_resizer.addEventListener('mouseleave',function(){this.style.background='transparent';});}
    /* preview toggle */
    const _fdToggle=ov.querySelector('[data-action="toggle-preview-panel"]');
    if(_fdToggle)_fdToggle.addEventListener('click',function(){_kioskTogglePreviewPanel();});
    document.body.appendChild(ov);
    requestAnimationFrame(function(){requestAnimationFrame(function(){if(_flowMc){_flowMc.style.transform='scale(1)';_flowMc.style.opacity='1';}});});
    if(typeof _makeDraggable==='function')_makeDraggable(ov.querySelector('.modal-content'));
    /* 메뉴바를 actionBar로 이동 — 항상 보이도록 */
    setTimeout(function(){
      const ab=document.getElementById('_kcFlowActionBar');
      const fb=document.getElementById('_kcFlowBody');
      if(ab&&fb){const tb=fb.querySelector('[style*="position:sticky"]');if(tb){ab.innerHTML='';ab.appendChild(tb);tb.style.position='static';tb.style.borderRadius='0';tb.style.margin='0';}}
    },0);
    /* 플로우 본문 이벤트 바인딩 */
    const _fb=document.getElementById('_kcFlowBody');
    if(_fb)_fdAttachEvents(_fb);
    /* 툴바(actionBar로 이동됨)에도 이벤트 바인딩 */
    setTimeout(function(){const _ab=document.getElementById('_kcFlowActionBar');if(_ab)_fdAttachEvents(_ab);},10);
    /* 오른쪽 요약 패널 이벤트 — ▲▼ 이동 */
    _kioskAttachSummaryEvents();
    /* 보기 외부 클릭 시 선택 해제 리스너 부착 */
    _kioskAttachFlowOutsideDeselect();
    /* 미리보기 패널 드래그 리사이즈 */
    _kioskAttachPreviewResize();
    /* 편집기 스크롤 ↔ 미리보기 스크롤 비율 연동 */
    _kioskAttachScrollSync();
  }

  /* 편집기 스크롤 위치 비율을 미리보기에 반영 (폭주 방지 플래그) */
  function _kioskAttachScrollSync(){
    const body=document.getElementById('_kcFlowBody');
    const preview=document.getElementById('_kcFlowPreview');
    if(!body||!preview||body._scrollSyncAttached)return;
    body._scrollSyncAttached=true;
    let syncing=false;
    body.addEventListener('scroll',function(){
      if(syncing)return;
      syncing=true;
      const bodyMax=body.scrollHeight-body.clientHeight;
      const previewMax=preview.scrollHeight-preview.clientHeight;
      if(bodyMax>0 && previewMax>0){
        const ratio=body.scrollTop/bodyMax;
        preview.scrollTop=ratio*previewMax;
      }
      setTimeout(function(){syncing=false;},50);
    });
    preview.addEventListener('scroll',function(){
      if(syncing)return;
      syncing=true;
      const bodyMax=body.scrollHeight-body.clientHeight;
      const previewMax=preview.scrollHeight-preview.clientHeight;
      if(bodyMax>0 && previewMax>0){
        const ratio=preview.scrollTop/previewMax;
        body.scrollTop=ratio*bodyMax;
      }
      setTimeout(function(){syncing=false;},50);
    });
  }

  /* 미리보기 패널 폭 드래그 리사이즈 (300~700px) */
  function _kioskAttachPreviewResize(){
    const resizer=document.getElementById('_kcFlowPreviewResizer');
    const panel=document.getElementById('_kcFlowPreviewPanel');
    if(!resizer||!panel||resizer._attached)return;
    resizer._attached=true;
    let startX=0, startW=0, dragging=false;
    resizer.addEventListener('mousedown',function(e){
      dragging=true;startX=e.clientX;startW=panel.offsetWidth;
      document.body.style.cursor='col-resize';
      document.body.style.userSelect='none';
      panel.style.transition='none';
      e.preventDefault();
    });
    document.addEventListener('mousemove',function(e){
      if(!dragging)return;
      const newW=Math.max(300,Math.min(700,startW-(e.clientX-startX)));
      panel.style.width=newW+'px';
    });
    document.addEventListener('mouseup',function(){
      if(!dragging)return;
      dragging=false;
      document.body.style.cursor='';
      document.body.style.userSelect='';
      localStorage.setItem('ec_kiosk_fd_preview_width',String(panel.offsetWidth));
    });
  }

  /* 플로우 디자이너 팝업 본문만 재렌더 (renderSettingsPanel 대신 사용 → 팝업 유지)
   * 편집 후에는 우측 미리보기 패널도 함께 갱신 */
  export function _kioskRefreshFlowPopup(){
    const body=document.getElementById('_kcFlowBody');
    if(!body)return false;
    if(typeof kioskFlowDesignerHtml==='function'){
      body.innerHTML=kioskFlowDesignerHtml();
    }
    /* 메뉴바를 _kcFlowBody 밖(actionBar)으로 이동 — 항상 보이도록 */
    const actionBar=document.getElementById('_kcFlowActionBar');
    if(actionBar){
      const toolbar=body.querySelector('[style*="position:sticky"]');
      if(toolbar){actionBar.innerHTML='';actionBar.appendChild(toolbar);toolbar.style.position='static';toolbar.style.borderRadius='0';toolbar.style.margin='0';}
    }
    /* 플로우 본문 이벤트 바인딩 (body 유지 — 최초 1회) */
    _fdAttachEvents(body);
    /* 툴바는 actionBar 안에 교체되지만, 이벤트 위임은 1회만 등록 */
    if(actionBar && !actionBar._fdEventsAttached){_fdAttachEvents(actionBar);}
    _kioskAttachFlowOutsideDeselect();
    /* 우측 플로우 요약 동기화 */
    const preview=document.getElementById('_kcFlowPreview');
    if(preview){
      preview.innerHTML=_kioskFlowSummaryTreeHtml();
    }
    return true;
  }

  /* 보기 선택 해제 — 옵션 행 바깥 클릭 시 전체 선택 해제 */
  function _kioskAttachFlowOutsideDeselect(){
    const body=document.getElementById('_kcFlowBody');
    if(!body||body._deselectAttached)return;
    body._deselectAttached=true;
    body.addEventListener('click',function(e){
      /* 옵션 행·트리거·삽입 배지 클릭은 제외. 나머지 영역 클릭 시 전체 선택 해제 */
      if(e.target.closest('.fd-opt-row,.fd-target-trigger,.fd-target-dropdown'))return;
      const _sel=getFdSelectedOpts();
      if(_sel){
        let had=false;
        Object.keys(_sel).forEach(function(k){if((_sel[k]||[]).length)had=true;});
        if(had){
          clearFdSelectedOpts();
          _kioskRefreshFlowPopup();
        }
      }
    });
  }

  /* 미리보기 패널 접기/펼치기 토글 */
  function _kioskTogglePreviewPanel(){
    const panel=document.getElementById('_kcFlowPreviewPanel');
    if(!panel)return;
    const currentlyCollapsed=panel.offsetWidth<100;
    const willCollapse=!currentlyCollapsed;
    panel.style.width=willCollapse?'32px':'420px';
    const title=document.getElementById('_kcFlowPreviewTitle');
    const body=document.getElementById('_kcFlowPreview');
    if(title)title.style.display=willCollapse?'none':'';
    if(body)body.style.display=willCollapse?'none':'';
    /* 토글 버튼 방향 */
    const btn=panel.querySelector('button[title*="요약"]');
    if(btn){btn.textContent=willCollapse?'◀':'▶';btn.title=willCollapse?'요약 펼치기':'요약 접기';}
    localStorage.setItem('ec_kiosk_fd_preview_collapsed',willCollapse?'1':'0');
  }
  /* ── 확대 미리보기 팝업 (태블릿이면 실제 기기 비율 + 인적사항 레이어) ── */
  function _kioskOpenPreviewPopup(){
    const existing=document.getElementById('_kcPreviewOverlay');
    if(existing){closeModalGracefully(existing);return;}
    const ov=document.createElement('div');
    ov.id='_kcPreviewOverlay';
    ov.className='modal-overlay show';
    ov.style.zIndex='13000';
    const deviceType=ks.deviceType||'laptop';
    const isTablet=(deviceType==='tablet');
    const frameW=isTablet?'820px':'1100px';
    const frameH=isTablet?'620px':'620px';
    const r=_kioskGetRules();
    const dispRules=isTablet?_kioskCompactRules(r):r;
    const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)||'OO학교';
    const ruleTitle=r.title||'보건실 이용 수칙 안내';
    const timeTitle=r.timeTitle||'운영 시간';
    const mannerTitle=r.mannerTitle||'지켜야 할 예절과 절차';
    let rulesBody='<div style="font-size:18px;font-weight:800;text-align:center;margin-bottom:14px;color:#0e7490">🏫 '+escHtml(schoolName)+' 보건실</div>'
      +'<div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:12px;color:#0e7490">'+escHtml(ruleTitle)+'</div>'
      +'<h3 style="font-size:14px;font-weight:700;color:#334155;margin:10px 0 4px">🕐 '+escHtml(timeTitle)+'</h3><ul style="padding-left:22px;font-size:13px;color:#475569;line-height:1.9;margin:0;list-style:disc">';
    (dispRules.time||[]).forEach(function(t){rulesBody+='<li>'+escHtml(t)+'</li>';});
    rulesBody+='</ul><h3 style="font-size:14px;font-weight:700;color:#334155;margin:10px 0 4px">📋 '+escHtml(mannerTitle)+'</h3><ul style="padding-left:22px;font-size:13px;color:#475569;line-height:1.9;margin:0;list-style:disc">';
    (dispRules.manners||[]).forEach(function(m){
      const txt=typeof m==='string'?m:(m.text||'');
      const isSub=typeof m==='object'&&m.sub;
      if(isSub){
        rulesBody+='</ul><div style="padding-left:40px;font-size:12px;color:#94a3b8;line-height:1.9;margin:2px 0"><span style="color:#0891b2;font-size:8px;margin-right:4px">▶</span>'+escHtml(txt)+'</div><ul style="padding-left:22px;font-size:13px;color:#475569;line-height:1.9;margin:0;list-style:disc">';
      } else {rulesBody+='<li>'+escHtml(txt)+'</li>';}
    });
    rulesBody+='</ul>';
    const tabletLayout=''
      +'<div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;padding:24px;box-sizing:border-box;background:linear-gradient(135deg,rgba(8,145,178,0.05),rgba(14,116,144,0.03))">'
      +'<div style="flex:1;background:rgba(255,255,255,0.96);border-radius:16px;padding:24px;overflow-y:auto;box-shadow:0 2px 12px rgba(0,0,0,0.06)">'+rulesBody+'</div>'
      +'<div style="margin-top:16px;background:rgba(255,255,255,0.92);border-radius:16px;padding:18px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">'
      +'<div style="font-size:12px;font-weight:700;color:#0e7490;margin-bottom:10px;text-align:center">👤 인적사항 선택 후 등록</div>'
      +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">'
      +'<div style="padding:12px 8px;border-radius:10px;background:#f8fafc;font-size:12px;font-weight:700;color:#334155;border:1px solid #e2e8f0;text-align:center">학년</div>'
      +'<div style="padding:12px 8px;border-radius:10px;background:#f8fafc;font-size:12px;font-weight:700;color:#334155;border:1px solid #e2e8f0;text-align:center">반</div>'
      +'<div style="padding:12px 8px;border-radius:10px;background:#f8fafc;font-size:12px;font-weight:700;color:#334155;border:1px solid #e2e8f0;text-align:center">번호</div>'
      +'<div style="padding:12px 8px;border-radius:10px;background:#f8fafc;font-size:12px;font-weight:700;color:#334155;border:1px solid #e2e8f0;text-align:center">이름</div>'
      +'</div>'
      +'<button style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#0891b2,#065f78);color:#fff;font-size:14px;font-weight:800;cursor:default">등록 시작 →</button>'
      +'</div></div>';
    const laptopLayout=''
      +'<div style="position:relative;width:100%;height:100%;display:flex;padding:24px;gap:20px;box-sizing:border-box;background:linear-gradient(135deg,rgba(8,145,178,0.05),rgba(14,116,144,0.03))">'
      +'<div style="flex:0 0 42%;background:rgba(255,255,255,0.96);border-radius:16px;padding:24px;overflow-y:auto;box-shadow:0 2px 12px rgba(0,0,0,0.06)">'+rulesBody+'</div>'
      +'<div style="flex:1;background:rgba(255,255,255,0.92);border-radius:16px;padding:28px;display:flex;flex-direction:column;gap:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">'
      +'<div style="font-size:15px;font-weight:800;color:#0e7490;text-align:center;margin-bottom:12px">🏥 방문 목적을 선택하세요</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1">'
      +'<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;border:1.5px solid #e2e8f0;border-radius:16px;background:#fff"><div style="font-size:40px">🤒</div><div style="font-size:13px;font-weight:800;margin-top:6px">건강 불편</div></div>'
      +'<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;border:1.5px solid #e2e8f0;border-radius:16px;background:#fff"><div style="font-size:40px">🩹</div><div style="font-size:13px;font-weight:800;margin-top:6px">상비약/물품</div></div>'
      +'<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;border:1.5px solid #e2e8f0;border-radius:16px;background:#fff"><div style="font-size:40px">💬</div><div style="font-size:13px;font-weight:800;margin-top:6px">상담 요청</div></div>'
      +'<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;border:1.5px solid #e2e8f0;border-radius:16px;background:#fff"><div style="font-size:40px">📋</div><div style="font-size:13px;font-weight:800;margin-top:6px">안내 보기</div></div>'
      +'</div>'
      +'</div></div>';
    const content='<div class="modal-content" style="width:'+frameW+';max-width:96vw;padding:0;overflow:hidden">'
      +'<div style="padding:14px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center">'
      +'<span style="font-size:14px;font-weight:800;color:var(--t1)">🔍 확대 미리보기 ('+(isTablet?'📱 태블릿 · 세로':'💻 노트북 · 16:9')+')</span>'
      +'<span data-action="close-preview" style="cursor:pointer;font-size:18px;color:var(--t3);padding:0 6px">✕</span>'
      +'</div>'
      +'<div style="width:100%;height:'+frameH+';background:#e2e8f0">'+(isTablet?tabletLayout:laptopLayout)+'</div>'
      +'</div>';
    ov.innerHTML=content;
    const _prevMc=ov.querySelector('.modal-content');
    if(_prevMc){_prevMc.style.transition='transform .2s ease,opacity .2s ease';_prevMc.style.transform='scale(0.95)';_prevMc.style.opacity='0';}
    function _closePreview(){
      if(_prevMc){_prevMc.style.transform='scale(0.95)';_prevMc.style.opacity='0';}
      ov.style.transition='opacity .2s';ov.style.opacity='0';
      setTimeout(function(){if(ov.parentNode)ov.remove();},220);
    }
    const _prevClose=ov.querySelector('[data-action="close-preview"]');
    if(_prevClose)_prevClose.addEventListener('click',function(e){e.stopPropagation();_closePreview();});
    ov.addEventListener('mousedown',function(e){if(e.target===ov)_closePreview();});
    document.body.appendChild(ov);
    requestAnimationFrame(function(){requestAnimationFrame(function(){if(_prevMc){_prevMc.style.transform='scale(1)';_prevMc.style.opacity='1';}});});
  }

  /* ═══════════════════════════════════════
     kioskSettingsHtml() — 설정 탭 전체 렌더링
     ═══════════════════════════════════════ */
  function kioskSettingsHtml(){
    const school=S.settings.schoolName||'OO학교';
    const eduOffice=S.settings.eduOffice||'';
    const isActive=ks.active||false;
    const authKey=ks.authKey||'';
    const authKeyExpiry=ks.authKeyExpiry||'';
    const kioskEduOffice=ks.eduOffice||eduOffice;
    const kioskSchool=ks.schoolName||school;

    const cdkey=localStorage.getItem('ec_cdkey')||'';
    const cdkeyAct=localStorage.getItem('ec_cdkey_activated')||'';
    let cdkExpiry='';let cdkRemainDays=Infinity;
    if(cdkey&&cdkeyAct){const actD=new Date(cdkeyAct);const expD=new Date(actD.getTime()+365*24*60*60*1000);cdkExpiry=expD.toISOString().slice(0,10);cdkRemainDays=Math.ceil((expD.getTime()-Date.now())/(24*60*60*1000));}

    /* 방향·유형은 [🎨 플로우 설계] 모달에서 고른다 — 메인 패널 표시는 기본값(가로/기본형)으로 폴백해 상태 칩·버튼이 항상 뜨게 한다 (사용자 결정 2026-06-15) */
    const kOrient=ks.kioskOrientation||'landscape';
    const kType=ks.kioskType||'basic';

    let h='<div class="settings-panel-title">📱 키오스크 설정</div>';
    h+='<div class="settings-panel-desc">보건실 방문자가 직접 입력하고 데이터가 보건일지에 들어가도록 하는 키오스크를 컨트롤합니다.<br>🔗 QR 코드 또는 URL 링크를 생성하여 태블릿 PC 또는 노트북 컴퓨터 등으로 키오스크에 접속할 수 있습니다.</div>';

    /* ── 🧭 키오스크 사용 안내 — 항상 표시 (아코디언 제거, 사용자 요청 2026-06-15) ── */
    h+='<div class="cc" style="padding:0;margin-top:12px;margin-bottom:16px;background:linear-gradient(135deg,rgba(6,182,212,0.04),var(--card));border:1px dashed rgba(6,182,212,0.3);overflow:hidden">'
      +'<div style="display:flex;align-items:center;gap:8px;padding:14px 16px 4px">'
      +'<span style="font-size:18px">🧭</span><div style="font-size:13px;font-weight:800;color:var(--cyan)">키오스크 사용 안내</div>'
      +'</div>'
      +'<div style="padding:0 16px">'
      +'<div style="font-size:11px;color:var(--t2);line-height:1.9;padding:0 0 16px">'
      +'<b style="color:var(--t1)">① 키오스크 작동 플로우 설계</b><br>&nbsp;&nbsp;[🎨 키오스크 작동 플로우 설계]를 누르면 먼저 디스플레이 방향(가로/세로)과 유형(기본형/확장형)을 고른 뒤 편집 화면이 열립니다.<br><br>'
      +'<b style="color:var(--t1)">② 화면 편집 또는 미리보기</b><br>&nbsp;&nbsp;선택한 유형에 맞는 편집 화면에서 이용 수칙, 플로우, 언어를 설정합니다.<br>&nbsp;&nbsp;미리보기로 실제 화면을 확인할 수 있습니다.<br><br>'
      +'<b style="color:var(--t1)">③ 키오스크 생성 → 기기에서 열기</b><br>&nbsp;&nbsp;편집 화면 안의 [🔗 키오스크 생성 &amp; 접속용 QR 코드와 URL 보기]을 누르면 QR 코드와 주소가 표시됩니다.<br>&nbsp;&nbsp;태블릿·노트북의 카메라로 QR을 찍거나 브라우저(Safari·Chrome) 주소창에 입력해 여세요.<br><br>'
      +'<b style="color:var(--t1)">④ 화면(수칙·플로우·언어·방향·유형) 변경 시</b><br>&nbsp;&nbsp;[🎨 키오스크 작동 플로우 설계] 안의 [🔗 키오스크 생성 &amp; 접속용 QR 코드와 URL 보기]을 다시 누른 뒤 키오스크에서 새로고침하세요. 접속 주소는 그대로 유지됩니다.<br><br>'
      +'<b style="color:var(--t1)">⑤ 명단(학생·교직원) 변경 시</b><br>&nbsp;&nbsp;명단은 이 프로그램(보건교사 PC)에서 실시간으로 업데이트되어 키오스크로 전달되므로, <b style="color:var(--cyan)">새로 생성할 필요가 없습니다.</b><br>&nbsp;&nbsp;프로그램이 켜져 있으면 키오스크에 최신 명단이 반영됩니다. (키오스크를 새로고침하면 즉시 반영)'
      +'</div></div></div>';

    /* (활성/비활성 토글 카드는 [QR & URL 보기] 팝업 안으로 이동 — 사용자 결정 2026-06-13) */

    /* ════ Step 1·Step 2(방향·유형 선택)는 [🎨 키오스크 작동 플로우 설계] 모달로 이동 — _kioskOpenSetupModal (사용자 결정 2026-06-15) ════ */

    /* ════ 상태 칩 + 버튼 3개 (플로우 설계 · 미리보기 · QR & URL) — 항상 표시 ════ */
    {
      var _generated=!!(ks.urlReady && ks.channelId);
      var _stale=_kioskGenStale();
      /* 표시 라벨 — 생성된 값(genOrient/genType)이 있으면 그것, 없으면 현재 선택값 */
      var _go=(ks.genOrient)|| (kOrient==='portrait'?'portrait':'landscape');
      var _gt=ks.genType||kType||'basic';
      var _genOrientLabel=_go==='portrait'?'📲 세로형':'🖥️ 가로형';
      var _genTypeLabel=_gt==='basic'?'📋 기본형':'🔀 확장형';
      var _curOrientLabel=kOrient==='portrait'?'📲 세로형':'🖥️ 가로형';
      var _curTypeLabel=kType==='basic'?'📋 기본형':'🔀 확장형';
      var _genGuide='[키오스크 작동 플로우 설계]를 연 뒤, 우측 최상단의 [🔗 키오스크 생성 &amp; 접속용 QR 코드와 URL 보기] 버튼을 다시 눌러주세요.';
      var _previewOk=true;       /* 미리보기는 항상 현재 설정 기준 — 비활성 불필요 */
      var _qrOk=_generated;       /* 생성된 키오스크가 있으면 활성 — stale 이면 누를 때 자동으로 최신 재생성 후 표시 (사용자 요청 2026-06-14) */
      /* 시안 D — 좌우 분할: 왼쪽 상태·칩, 오른쪽 버튼 세로 스택(라벨이 길어 세로가 적합, 사용자 결정 2026-06-14) */
      /* 상태 4분류 (사용자 요청 2026-06-16) —
       *  complete : 이번 실행에서 생성 + 최신          → 초록 "생성 완료"
       *  usable   : 채널 있음 + 최신, 재시작 후(이번 실행 생성 안 함) → 주황 "사용 가능"(QR 버튼 안내)
       *  stale    : 채널 있음 + 설정 변경              → 주황 "생성 필요"(QR 버튼 재생성)
       *  needgen  : 채널 자체가 없음(진짜 생성 필요)    → 핫핑크 "생성 필요"(플로우 설계 안내)
       *  옛 버그: usable 도 needgen 과 똑같이 주황+"플로우 설계에서 생성" 으로 떠서, 이미 생성된 키오스크인데
       *           "생성 필요"라 안내해 혼란. QR 버튼은 활성인데 색·문구가 채널 없음과 동일했음. */
      var _completeNow=(_kioskGenDoneThisRun && _generated && !_stale);
      var _kState = _completeNow ? 'complete' : (_generated ? (_stale ? 'stale' : 'usable') : 'needgen');
      var _isComplete=(_kState==='complete');
      var _needGen=(_kState==='needgen');   /* 핫핑크 — 채널 없음만 */
      var _green=(_isComplete||_kState==='usable');   /* 완료·사용가능 = 초록 (사용자 요청 2026-06-16) */
      var _frameColor=_green?'rgba(6,182,212,0.3)':(_needGen?'rgba(255,20,147,0.55)':'rgba(245,158,11,0.55)');   /* needgen = 핫핑크 */
      var _frameBg=_green?'rgba(6,182,212,0.05)':(_needGen?'rgba(255,20,147,0.08)':'rgba(245,158,11,0.08)');
      var _chip=function(bg,col,txt){return '<div style="display:inline-flex;align-items:center;gap:7px;background:'+bg+';color:'+col+';font-size:12.5px;font-weight:800;padding:6px 13px;border-radius:999px;margin-bottom:10px">'+txt+'</div>';};
      h+='<div class="cc" style="padding:18px 20px;margin-bottom:12px;border:2px solid '+_frameColor+';background:linear-gradient(135deg,'+_frameBg+',var(--card));display:flex;gap:20px;align-items:center;flex-wrap:wrap">'
        /* ── 왼쪽: 상태 + 칩 ── */
        +'<div style="flex:1;min-width:190px">'
        +( _isComplete
           ? '<div style="display:inline-flex;align-items:center;gap:7px;background:rgba(22,163,74,0.12);color:var(--gs);font-size:13px;font-weight:800;padding:6px 14px;border-radius:999px;margin-bottom:12px">✅ 키오스크 생성 완료</div>'
               +'<div style="display:flex;gap:9px;flex-wrap:wrap">'
               +'<span style="font-size:14.5px;padding:6px 16px;border-radius:999px;background:rgba(6,182,212,0.12);color:var(--cyan);font-weight:800">'+_genOrientLabel+'</span>'
               +'<span style="font-size:14.5px;padding:6px 16px;border-radius:999px;background:rgba(6,182,212,0.12);color:var(--cyan);font-weight:800">'+_genTypeLabel+'</span></div>'
           : _kState==='usable'
             ? _chip('rgba(245,158,11,0.16)','#b45309','🟠 키오스크 사용 가능')
               +'<div style="font-size:11.5px;color:var(--t3);line-height:1.6">아래 <b style="color:var(--t2)">[📱 QR &amp; URL 확인 및 키오스크 사용하기]</b><br>버튼을 눌러 키오스크를 시작하세요</div>'
           : _kState==='stale'
             ? _chip('rgba(245,158,11,0.16)','#b45309','🟠 키오스크 생성 필요')
               +'<div style="font-size:11.5px;color:var(--t3);line-height:1.6">설정이 바뀌었습니다 — <b style="color:var(--t2)">[📱 QR &amp; URL 확인 및 키오스크 사용하기]</b>를<br>누르면 최신 설정으로 다시 생성됩니다</div>'
             : _chip('rgba(255,20,147,0.16)','#db2777','🩷 키오스크 생성 필요')
               +'<div style="font-size:11.5px;color:var(--t3);line-height:1.6"><b style="color:var(--t2)">[🎨 키오스크 작동 플로우 설계]</b> 안에서<br>[🔗 키오스크 생성 &amp; 접속용 QR 코드와 URL 보기]을 눌러주세요</div>')
        +'</div>'
        /* ── 오른쪽: 버튼 세로 스택 (긴 라벼) ── */
        +'<div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0">'
        +'<button data-action="kiosk-preview-inline" class="btn btn-outline" data-tooltip="키오스크로 어떻게 사용 가능한지 예시를 보여줍니다." data-tooltip-instant="1" style="justify-content:flex-start;min-width:236px;font-size:12px;padding:11px 16px;border-radius:10px;display:inline-flex;align-items:center;gap:9px;font-weight:700"><span style="font-size:17px">🔎</span> 팝업으로 키오스크 형태 미리보기</button>'
        +'<button data-action="kiosk-open-setup" class="btn btn-primary" data-tooltip="방향·유형을 고른 뒤 이용 수칙·플로우·언어 등 키오스크 작동을 설계합니다." data-tooltip-instant="1" style="justify-content:flex-start;min-width:236px;font-size:12px;padding:11px 16px;border-radius:10px;display:inline-flex;align-items:center;gap:9px;font-weight:700;box-shadow:0 2px 10px rgba(6,182,212,0.25)"><span style="font-size:17px">🎨</span> 키오스크 작동 플로우 설계</button>'
        +'<button data-action="kiosk-url-view" class="btn btn-outline" data-tooltip="'+(_qrOk?(_stale?'설정이 바뀌었습니다 — 누르면 최신으로 다시 생성한 뒤 QR 코드·URL·인증키를 보여줍니다.':'생성된 키오스크 접속 QR 코드, URL 링크, 인증키를 보고 실제 사용을 합니다.'):'먼저 [🎨 키오스크 작동 플로우 설계]에서 생성해야 활성화됩니다.')+'" data-tooltip-instant="1" style="justify-content:flex-start;min-width:236px;font-size:12px;padding:11px 16px;border-radius:10px;display:inline-flex;align-items:center;gap:9px;font-weight:700'+(_qrOk?'':';opacity:0.45;cursor:not-allowed')+'"><span style="font-size:17px">📱</span> QR &amp; URL 확인 및 키오스크 사용하기</button>'
        +'</div>'
      +'</div>';

      /* 인증키 카드는 [QR & URL 보기] 팝업 안으로 이동 (사용자 결정 2026-06-13) — 여기선 제거. */
    }

    return h;
  }

  /* QR & URL 생성 완료 시(화면 편집에서 업로드 성공) → 설정 패널 리렌더 → 인라인 [QR & URL 보기] 활성화.
   *  모듈 1회 등록 (container 마다 중복 구독 방지). (2026-06-13) */
  /* ── 매일 첫 실행 시 키오스크 토글 자동 OFF (사용자 결정 2026-06-13) ──
   *  활성화한 날짜(ks.activeDate)와 오늘이 다르면 비활성으로 시작 — 매일 [QR & URL 보기]에서 토글을 켜는 절차. */
  function _kioskTodayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function _kioskDailyActiveReset(){
    try{
      if(ks.active && ks.activeDate!==_kioskTodayStr()){
        ks.active=false; _save();
        bus.emit('kiosk:sidebar-refresh');
      }
    }catch(_){}
  }
  /* 부팅 직후에도 1회 — 어제 켜둔 채 종료했어도 오늘은 꺼진 상태로 시작 */
  setTimeout(_kioskDailyActiveReset, 2500);

  let _urlReadyBound=false;
  function _bindUrlReadyOnce(){
    if(_urlReadyBound)return; _urlReadyBound=true;
    bus.on('kiosk:url-ready',function(){ _kioskGenDoneThisRun=true; try{ renderSettingsPanel('kiosk'); }catch(_){} });
    /* QR & URL 생성 성공 → 키오스크 자동 활성화 (사용자 결정 2026-06-13).
     *  생성·업로드까지 진행했으면 릴레이 사용에 동의한 것 — 동의 팝업 생략하고 바로 연결. */
    bus.on('kiosk:auto-activate',function(){
      try{
        if(ks.active)return;
        ks.active=true; _relayOk=false; ks.activeDate=_kioskTodayStr();
        try{ localStorage.setItem('ec_kiosk_relay_agreed','1'); }catch(_){}
        _save();
        renderSettingsPanel('kiosk'); kioskUpdateSidebar();
        bus.emit('kiosk:sidebar-refresh');
        bus.emit('toast:show',{text:'✅ 키오스크가 활성화되어 접속 대기를 시작합니다.'});
      }catch(_){}
    });
    /* QR & URL 팝업의 활성 토글 (사용자 설계 2026-06-13) — 켜기: 동의 모달 → 동의 시 활성화 + 팝업 갱신(QR 표시) */
    bus.on('kiosk:activate-with-consent',function(){
      try{
        if(ks.active){ showKioskUrlPopup(); return; }
        _showKioskRelayConsent(function(){
          ks.active=true; _relayOk=false; ks.activeDate=_kioskTodayStr();
          try{ localStorage.setItem('ec_kiosk_relay_agreed','1'); }catch(_){}
          _save();
          renderSettingsPanel('kiosk'); kioskUpdateSidebar();
          bus.emit('kiosk:sidebar-refresh');
          showKioskUrlPopup();   /* 동의 완료 → 팝업 다시 그려 QR·URL 표시 */
        });
      }catch(_){}
    });
    bus.on('kiosk:deactivate',function(){
      try{
        ks.active=false; _relayOk=false; _save();
        renderSettingsPanel('kiosk'); kioskUpdateSidebar();
        bus.emit('kiosk:sidebar-refresh');
        showKioskUrlPopup();   /* 팝업 갱신 — QR·URL 가림 */
      }catch(_){}
    });
    /* ★ 죽은 채널 자가 치유 — 업로드가 채널 만료(401/403/404)로 실패하면 새 채널을 만들어 1회 자동 재시도.
     *  릴레이 재배포 등으로 저장된 옛 채널/토큰이 무효가 된 PC 가 "아무것도 안 뜸" 되던 문제 해결 (사용자 보고 2026-06-15). */
    bus.on('kiosk:channel-stale-retry',function(p){
      try{
        _kioskCreateNewChannel(function(ok, errMsg){
          if(ok && p && typeof p.redo==='function'){ p.redo(); }
          else { appConfirmModal('새 접속 채널을 만들지 못했습니다.<br>잠시 후 다시 시도해 주세요.'+(errMsg?('<br><br><span style="font-size:11px;color:var(--t3)">사유: '+escHtml(String(errMsg))+'</span>'):''),'⚠️ 채널 재생성 실패',{okOnly:true,okLabel:'확인'}); }
        });
      }catch(e){ appConfirmModal('채널 재생성 중 오류가 발생했습니다.<br><br><span style="font-size:11px;color:var(--t3)">사유: '+escHtml(String(e&&e.message||e))+'</span>','⚠️ 오류',{okOnly:true}); }
    });
    /* ★ 업로드 실패 안내 모달 — 실패 사실 + 사유만 명확히 (토스트는 놓치기 쉬움). 사용자 요청 2026-06-15. */
    bus.on('kiosk:upload-failed',function(p){
      /* 실패 사실 + 전체 진단 정보를 바로 보여주고(스크롤 가능), [오류 정보 복사] 버튼으로 통째 복사 (사용자 요청 2026-06-15).
       *  사용자가 파일은 못 보내니, 복사→붙여넣기로 원인 추적이 가능하게 모든 상태를 담는다. */
      p=p||{};
      var _diag=_kioskBuildDiag({kind:'키오스크 업로드 오류',stage:'서버 업로드',error:p.error,status:p.status,channelId:p.channelId,relayUrl:p.relayUrl,retried:p.retried,body:p.body,netCode:p.netCode,url:(p.relayUrl||DEFAULT_RELAY_URL)+'/api/v1/kiosk/html/'+(p.channelId||'')});
      var _msg='키오스크 화면을 서버에 올리지 못했습니다.<br>아래 정보가 원인 추적에 필요합니다 — <b>[📋 오류 정보 복사]</b>를 누른 뒤 오렌지팜에 붙여넣기(Ctrl+V)로 보내주세요.';
      _showKioskErrModal('⚠️ 키오스크 업로드 실패', _msg, _diag);
    });
  }

  /* ═══════════════════════════════════════
     _bindKioskCmsEvents — 키오스크 설정 탭 이벤트 바인딩
     kioskSettingsHtml() 반환 HTML이 DOM에 삽입된 후 호출
     ═══════════════════════════════════════ */
  export function _bindKioskCmsEvents(container){
    if(!container)return;
    _bindUrlReadyOnce();
    /* 중복 바인딩 방지: 이미 바인딩된 컨테이너는 skip */
    if(container._kioskCmsBound){return;}
    container._kioskCmsBound=true;
    /* "🎨 화면 편집" 버튼 미니 팝업 — 증상 선택 및 처치 모달의 자유 기입 칩과 동일 GUI (showHeaderTooltip) */
    container.querySelectorAll('[data-tooltip][data-tooltip-instant="1"]').forEach(function(el){
      if(el._tipBound) return;
      el._tipBound = true;
      el.addEventListener('mouseenter', function(){
        const txt = this.getAttribute('data-tooltip');
        if(txt) showHeaderTooltip({currentTarget:this, target:this}, txt, false, true);
      });
      el.addEventListener('mouseleave', function(){ hideHeaderTooltip(); });
    });
    /* 팝업인지 설정 패널인지 감지 — 팝업이면 팝업 갱신, 아니면 설정 패널 갱신 */
    function _refresh(){
      if(container.id==='_kcRulesOverlay'){_kioskRulesEditorRefresh();}
      else if(container.id==='_kcFlowOverlay'){
        const dev=ks.deviceType||'laptop';const dm=ks.displayMode||'rules';
        container.querySelectorAll('[data-kc-dev-chip]').forEach(function(c){const on=c.dataset.kcDevChip===dev;c.style.borderColor=on?'var(--cyan)':'var(--bdr)';c.style.background=on?'rgba(6,182,212,0.12)':'var(--card)';c.style.color=on?'var(--cyan)':'var(--t2)';});
        container.querySelectorAll('[data-kc-mode-chip]').forEach(function(c){const on=c.dataset.kcModeChip===dm;c.style.borderColor=on?'var(--cyan)':'var(--bdr)';c.style.background=on?'rgba(6,182,212,0.12)':'var(--card)';c.style.color=on?'var(--cyan)':'var(--t2)';});
        _kioskRulePreviewRefresh();
      }
      else if(container.id==='_kcEditorOverlay'){
        /* 통합 편집 팝업: 이용수칙 패널만 re-render */
        _refreshEditorRulesPanel();
      }
      else{renderSettingsPanel('kiosk');}
    }
    container.addEventListener('click',function(e){
      const el=e.target.closest('[data-action]');
      if(!el||!container.contains(el))return;
      const action=el.dataset.action;
      /* 팝업 안에서 클릭 시 뒤쪽 스크롤 방지 */
      if(container.classList.contains('modal-overlay'))e.stopPropagation();
      if(action==='kiosk-open-setup'){
        /* [🎨 키오스크 작동 플로우 설계] — 방향·유형 선택 모달 먼저 띄우고, [설계 시작] 시 편집기 오픈 (사용자 결정 2026-06-15) */
        _kioskOpenSetupModal();
      } else if(action==='open-basic-kiosk-editor' || action==='open-kiosk-editor'){
        /* (구 진입점 — 안전망. 현재는 설계 모달의 [설계 시작]이 _kioskStartDesign 을 직접 호출) */
        _kioskStartDesign();
      } else if(action==='editor-preview'){
        openKioskPreview(_kioskGetFlow);
      } else if(action==='editor-download'){
        /* [생성] = 기존 채널이 살아있으면 재사용(접속 주소·QR 그대로 유지), 없거나 10일+ 미사용으로 폐기됐으면 그때만 새로 발급.
         *  _kioskEnsureChannelThen 가 채널 보장(있으면 재사용·없으면 생성), 죽은 채널이면 업로드 404→자가치유로 새 발급.
         *  매번 새로 만들지 않음 — 평소 편집·재배포엔 같은 주소 유지 → 기기는 새로고침만 (사용자 결정 2026-06-15). */
        try {
          _kioskEnsureChannelThen(function(){
            generateKioskUrl(_kioskGetFlow, function(){
              const _edOv=document.getElementById('_kcEditorOverlay');
              if(_edOv)closeModalGracefully(_edOv);
            });
          });
        } catch(_edErr){
          /* [생성] 클릭이 조용히 죽지 않도록 — 동기 예외도 진단 모달로 (필드 사용자 "반응 없음" 보고 2026-06-15) */
          try{ bus.emit('kiosk:upload-failed', { error:'[생성] 처리 중 오류: '+((_edErr&&_edErr.message)||_edErr), channelId:ks.channelId, relayUrl:(ks.relayUrl||DEFAULT_RELAY_URL) }); }catch(_e2){}
        }
      } else if(action==='kiosk-preview-inline'){
        /* 메인 [🔎 미리보기] = 예시 갤러리(기본형·확장형 × 가로·세로). 항상 JSON 기본값 플로우 + 사용자 실제 명단.
           편집기 [미리보기]와 달리 내 편집을 반영하지 않는 '예시'다. 생성 여부 무관, 차단 없이 바로 (사용자 결정 2026-06-15) */
        fdEnsureDefaultTemplates().then(function(){
          openKioskGalleryPreview(getBasicFlowTemplate(), getDefaultFlowTemplate());
        }).catch(function(){
          openKioskGalleryPreview(getBasicFlowTemplate(), getDefaultFlowTemplate());
        });
      } else if(action==='kiosk-url-view'){
        /* [확인 및 사용] = 이미 생성된(채널+토큰+urlReady) 게 있으면 재업로드 없이 기존 QR·URL 을 바로 표시(빠름).
           아직 생성 전이면 그때만 채널보장→빌드·업로드. 매번 서버에 올리고 내리면 느려서 분리 (사용자 결정 2026-06-15). */
        _kioskDailyActiveReset();   /* 매일 첫 진입 시 토글 OFF 보장 */
        if(ks.channelId && ks.authToken && ks.urlReady){
          showKioskUrlPopup();
        } else {
          _kioskEnsureChannelThen(function(){
            generateKioskUrl(_kioskGetFlow, function(){
              const _edOv=document.getElementById('_kcEditorOverlay');
              if(_edOv)closeModalGracefully(_edOv);   /* (편집 모달이 떠 있던 경우에만) 닫기 — 카드에서 누르면 no-op */
            });
          });
        }
      } else if(action==='gen-access-key'){
        _kioskGenAccessKey();
      } else if(action==='clear-access-key'){
        _kioskClearAccessKey();
      } else if(action==='toggle-active'){
        _kioskCmsToggleActive();
      } else if(action==='ws-toggle'){
        _kioskWsToggle();
      } else if(action==='ws-refresh'){
        _kioskWsRefreshStatus();
      } else if(action==='generate-key'){
        _kioskGenerateKey();
      } else if(action==='revoke-key'){
        _kioskRevokeKey();
      } else if(action==='kiosk-tab'){
        const tab=el.dataset.tab;
        if(tab==='flow'){_kioskOpenFlowDesignerPopup();return;}
        if(tab==='rules'){_kioskOpenRulesEditorPopup();return;}
        if(tab){ks._settingsTab=tab;_save();renderSettingsPanel('kiosk');}
      } else if(action==='toggle-tts'){
        ks.ttsEnabled=!ks.ttsEnabled;_save();_refresh();
      } else if(action==='tts-test'){
        const rate=parseFloat(el.dataset.ttsRate||'0.9');
        if(window.speechSynthesis){const u=new SpeechSynthesisUtterance('안녕하세요, 보건실에 오신 것을 환영합니다.');u.lang='ko-KR';u.rate=rate;window.speechSynthesis.speak(u);}
      } else if(action==='open-dest-popup'){
        _kioskOpenDestPopup();
      } else if(action==='clear-dest-inline'){
        ks.activeDest='';delete ks.activeDestExpiry;_save();_refresh();
        if(window._kioskPushToRelay)window._kioskPushToRelay();
      } else if(action==='toggle-lang'){
        const lang=el.dataset.lang;if(lang){if(!ks.languages)ks.languages=[];const idx=ks.languages.indexOf(lang);if(idx>=0)ks.languages.splice(idx,1);else ks.languages.push(lang);_save();_refresh();}
      } else if(action==='kc-toggle-lang'){
        /* 편집 팝업의 lang bar 토글 — ks.languages 갱신 + lang bar 만 재렌더 + 저장 안내 토스트 */
        const lang=el.dataset.lang;
        if(lang){ kioskEditorToggleLang(lang); _kcRefreshLangBar(); _kcShowSaveToast(); }
      } else if(action==='kc-open-prompt'){
        kioskOpenTransPrompt(_kioskGetFlow, _kioskGetRules);
      } else if(action==='kc-open-paste'){
        kioskOpenPasteTranslation(_kioskGetFlow, _kioskGetRules);
      } else if(action==='copy-trans-prompt'){
        kioskOpenTransPrompt(_kioskGetFlow, _kioskGetRules);
      } else if(action==='open-paste-trans'){
        kioskOpenPasteTranslation(_kioskGetFlow, _kioskGetRules);
      } else if(action==='toggle-trans-accordion'){
        const b=el.nextElementSibling;if(b)b.style.display=b.style.display==='none'?'block':'none';
      } else if(action==='open-flow-designer'){
        /* 화면 편집 진입 시 채널이 없으면 백그라운드로 자동 생성 — "활성 먼저" 순서 의존 제거 (사용자 결정 2026-06-11).
         *  활성 토글은 이 채널로 '연결(수신 시작)'만 한다. */
        if(!ks.channelId||!ks.authToken)_kioskCreateNewChannel();
        _kioskOpenEditorPopup();
      } else if(action==='download-kiosk-html'){
        _kioskEnsureChannelThen(_fdGenerateKioskUrl); /* URL 접속 방식 (2026-06-12) */
      } else if(action==='create-channel'||action==='reset-channel'){
        _kioskCreateChannel();
      } else if(action==='test-relay'){
        _kioskTestRelay();
      } else if(action==='push-relay'){
        _kioskPushToRelay();
      } else if(action==='open-monitor'){
        _kioskOpenMonitor();
      } else if(action==='set-device'){
        const dev=el.dataset.device;if(dev){ks.deviceType=dev;_save();_refresh();}
      } else if(action==='set-display-mode'){
        const mode=el.dataset.mode;if(mode){ks.displayMode=mode;_save();_refresh();}
      } else if(action==='set-alt-sec'){
        const v=parseInt(el.value);if(!isNaN(v)&&v>=3&&v<=60){ks.alternateSec=v;_save();}
      } else if(action==='open-preview-popup'){
        _kioskOpenPreviewPopup();
      } else if(action==='rule-meta'){
        const key=el.dataset.metaKey;if(key){if(!ks.ruleMeta)ks.ruleMeta={};ks.ruleMeta[key]=el.value;_save();_kioskRulePreviewRefresh();}
      } else if(action==='update-rule'){
        const sec=el.dataset.ruleSection;const idx=parseInt(el.dataset.ruleIdx);
        if(sec&&!isNaN(idx)){const arr=_getRuleArr(sec);if(arr&&arr[idx]!==undefined){if(typeof arr[idx]==='string')arr[idx]=el.value;else arr[idx].text=el.value;_save();_kioskRulePreviewRefresh();}}
      } else if(action==='remove-rule'){
        const sec=el.dataset.ruleSection;const idx=parseInt(el.dataset.ruleIdx);
        if(sec&&!isNaN(idx)){const arr=_getRuleArr(sec);if(arr){arr.splice(idx,1);_save();_refresh();}}
      } else if(action==='add-rule'){
        const sec=el.dataset.ruleSection;
        if(sec){
          if(sec.startsWith('extra_')){const si=parseInt(sec.split('_')[1]);const extras=ks.customRules&&ks.customRules.extraSections;if(extras&&extras[si]){if(!extras[si].items)extras[si].items=[];extras[si].items.push('');_save();_refresh();}}
          else{if(!ks.customRules)ks.customRules={};if(!ks.customRules[sec])ks.customRules[sec]=[];ks.customRules[sec].push('');_save();_refresh();}
        }
      } else if(action==='add-extra-section'){
        if(!ks.customRules)ks.customRules={};
        if(!ks.customRules.extraSections)ks.customRules.extraSections=[];
        var circled=['③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
        var ni=ks.customRules.extraSections.length;
        ks.customRules.extraSections.push({icon:circled[ni]||('('+(ni+3)+')'),title:'',items:[]});
        _save();_refresh();
      } else if(action==='remove-extra-section'){
        const si=parseInt(el.dataset.extraIdx);
        if(!isNaN(si)&&ks.customRules&&ks.customRules.extraSections){ks.customRules.extraSections.splice(si,1);_save();_refresh();}
      } else if(action==='update-extra-title'){
        const si=parseInt(el.dataset.extraIdx);
        if(!isNaN(si)&&ks.customRules&&ks.customRules.extraSections&&ks.customRules.extraSections[si]){ks.customRules.extraSections[si].title=el.value;_save();}
      } else if(action==='pick-extra-icon'){
        const si=parseInt(el.dataset.extraIdx);
        if(!isNaN(si)&&ks.customRules&&ks.customRules.extraSections&&ks.customRules.extraSections[si]){
          openEmojiPicker(ks.customRules.extraSections[si].icon||'③',function(emoji){ks.customRules.extraSections[si].icon=emoji;_save();_refresh();});
        }
      } else if(action==='indent-rule'){
        const sec=el.dataset.ruleSection;
        const idx=parseInt(el.dataset.ruleIdx);
        const arr=_getRuleArr(sec);
        if(!isNaN(idx)&&arr&&arr[idx]!==undefined){
          const cur=arr[idx];
          if(typeof cur==='string'){arr[idx]={text:cur,sub:true,marker:'▸'};}
          else{cur.sub=!cur.sub; if(!cur.sub)cur.marker=cur.marker==='▸'?'●':cur.marker;}
          _save();_refresh();
        }
      } else if(action==='pick-marker'){
        const sec=el.dataset.ruleSection;
        const idx=parseInt(el.dataset.ruleIdx);
        const arr=_getRuleArr(sec);
        if(isNaN(idx)||!arr)return;
        /* 마커 선택 미니 팝업 */
        const _markers=['●','▸','※','✓','◆','○','▪','➤'];
        const rect=el.getBoundingClientRect();
        const pop=document.createElement('div');
        pop.style.cssText='position:fixed;left:'+rect.left+'px;top:'+(rect.bottom+4)+'px;background:var(--bg1);border:1px solid var(--bdr);border-radius:8px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:15000;display:flex;gap:3px;flex-wrap:wrap;width:160px';
        _markers.forEach(function(mk){
          pop.innerHTML+='<span data-mk="'+mk+'" style="cursor:pointer;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid var(--bdr);font-size:12px;transition:all .1s;background:var(--card)">'+mk+'</span>';
        });
        pop.addEventListener('click',function(ev){
          const mkEl=ev.target.closest('[data-mk]');
          if(!mkEl)return;
          const mk=mkEl.dataset.mk;
          const cur=arr[idx];
          const isSub=(mk==='▸'||mk==='※');
          if(typeof cur==='string'){arr[idx]={text:cur,sub:isSub,marker:mk};}
          else{cur.marker=mk;cur.sub=isSub;}
          _save();pop.remove();_refresh();
        });
        document.body.appendChild(pop);
        setTimeout(function(){document.addEventListener('click',function _closePop(ev){if(!pop.contains(ev.target)){pop.remove();document.removeEventListener('click',_closePop);}});},0);
      } else if(action==='toggle-sub'){
        /* 레거시 호환 */
        const idx=parseInt(el.dataset.ruleIdx);
        if(!isNaN(idx)&&ks.customRules&&ks.customRules.manners&&ks.customRules.manners[idx]!==undefined){
          const cur=ks.customRules.manners[idx];
          if(typeof cur==='string'){ks.customRules.manners[idx]={text:cur,sub:true};}
          else{cur.sub=!cur.sub;}
          _save();_refresh();
        }
      } else if(action==='reset-rules'){
        if(!confirm('이용 수칙을 기본값으로 초기화하시겠습니까?'))return;
        delete ks.customRules;
        delete ks.ruleMeta;
        _save();_refresh();
      } else if(action==='emoji-pick-meta'){
        const key=el.dataset.metaKey;if(key)openEmojiPicker(el.textContent.trim(),function(emoji){if(!ks.ruleMeta)ks.ruleMeta={};ks.ruleMeta[key]=emoji;_save();_refresh();});
      }
    });
    /* change 이벤트 위임 (번역 입력 + 릴레이 설정 + TTS) */
    container.addEventListener('change',function(e){
      const inp=e.target.closest('.kiosk-trans-input');
      if(inp&&container.contains(inp)){
        const lang=inp.dataset.transLang;const key=inp.dataset.transKey;
        if(lang&&key)kioskSetTrans(lang,key,inp.value);
        return;
      }
      const el=e.target.closest('[data-action]');
      if(!el||!container.contains(el))return;
      const action=el.dataset.action;
      if(action==='relay-url'){ks.relayUrl=el.value.trim();_save();}
      else if(action==='relay-channel'){ks.channelId=el.value.trim();_save();}
      else if(action==='relay-token'){ks.nurseToken=el.value.trim();_save();}
      else if(action==='tts-rate'){ks.ttsRate=parseFloat(el.value);_save();}
      else if(action==='set-alt-sec'){const v=parseInt(el.value);if(!isNaN(v)&&v>=3&&v<=60){ks.alternateSec=v;_save();}}
    });
    /* input 이벤트 (릴레이 URL 등 실시간 반영) */
    container.addEventListener('input',function(e){
      const el=e.target.closest('[data-action]');
      if(!el||!container.contains(el))return;
      const action=el.dataset.action;
      if(action==='relay-url'){ks.relayUrl=el.value.trim();_save();}
      else if(action==='relay-channel'){ks.channelId=el.value.trim();_save();}
      else if(action==='relay-token'){ks.nurseToken=el.value.trim();_save();}
      else if(action==='tts-rate'){ks.ttsRate=parseFloat(el.value);_save();const label=el.parentElement&&el.parentElement.querySelector('span:last-child');if(label)label.textContent=el.value+'x';}
      else if(action==='set-alt-sec'){const v=parseInt(el.value);if(!isNaN(v)&&v>=3&&v<=60){ks.alternateSec=v;_save();}}
      else if(action==='update-rule'){
        const sec=el.dataset.ruleSection;const idx=parseInt(el.dataset.ruleIdx);
        if(sec&&!isNaN(idx)){const arr=_getRuleArr(sec);if(arr&&arr[idx]!==undefined){if(typeof arr[idx]==='string')arr[idx]=el.value;else arr[idx].text=el.value;_save();try{bus.emit('toast:saveLater');}catch(_){}}}
      }
      else if(action==='update-extra-title'){
        const si=parseInt(el.dataset.extraIdx);
        if(!isNaN(si)&&ks.customRules&&ks.customRules.extraSections&&ks.customRules.extraSections[si]){ks.customRules.extraSections[si].title=el.value;_save();try{bus.emit('toast:saveLater');}catch(_){}}
      }
      else if(action==='rule-meta'){
        const key=el.dataset.metaKey;if(key){if(key==='title'||key==='timeTitle'||key==='mannerTitle'){if(!ks.customRules)ks.customRules={};ks.customRules[key]=el.value;}else{if(!ks.ruleMeta)ks.ruleMeta={};ks.ruleMeta[key]=el.value;}_save();try{bus.emit('toast:saveLater');}catch(_){}}
      }
    });
    /* 바인딩 후 WS 상태 갱신 */
    setTimeout(function(){_kioskWsRefreshStatus();},100);
    /* 서버에 채널이 아직 살아있는지 1회 확인 — 평일 10일+ 미사용으로 폐기됐으면 "확인 및 사용" 비활성화 + 재생성 유도 (사용자 요청 2026-06-15) */
    setTimeout(function(){_kioskVerifyChannelLive();},150);
  }

  /* 채널 생존 확인 — 서버가 폐기(평일 10일+ 미접속)했으면 urlReady=false 로 만들어 버튼 비활성화 + 안내.
   *  네트워크/체크 실패(ok=false)일 땐 건드리지 않는다(오탐으로 멀쩡한 버튼을 끄지 않게). */
  let _chLiveBusy=false;
  function _kioskVerifyChannelLive(){
    if(_chLiveBusy) return;
    if(!ks.channelId||!ks.authToken||!ks.urlReady) return;
    if(!window.electronAPI||!window.electronAPI.kioskChannelStatus) return;
    _chLiveBusy=true;
    const url=ks.relayUrl||DEFAULT_RELAY_URL;
    window.electronAPI.kioskChannelStatus(url, ks.channelId).then(function(r){
      _chLiveBusy=false;
      if(r&&r.ok&&r.exists===false){
        ks.urlReady=false; try{ saveKioskSettings(); }catch(_){}
        bus.emit('kiosk:sidebar-refresh');
        const p=document.getElementById('settingsPanel');
        if(p&&p.offsetParent) renderSettingsPanel('kiosk');
        bus.emit('toast:show',{text:'ℹ️ 미사용으로 접속 채널이 만료되어, 다시 생성이 필요합니다.'});
      }
    }).catch(function(){ _chLiveBusy=false; });
  }

  // ── Expose to global scope ──
  S.kioskSettingsHtml = kioskSettingsHtml;

  /* ── 키오스크 활성/비활성 토글 (설정 탭) ── */
  bus.on('kiosk:relay-status',function(connected){
    _relayOk=!!connected;
  });

  /* (_kioskDownloadWithNotice — 파일 다운로드 방식의 "옛 파일 삭제" 안내 모달은
   *  URL 접속 방식 전환(2026-06-12)으로 폐기. 진입은 _kioskEnsureChannelThen 직행.) */

  /* ── 키오스크 접속 인증키 생성/해제 (2026-06-12, 2026-06-13 영문숫자 5자리로 변경) ──
   *  영문 3 + 숫자 3 = 6자리 (혼동 문자 I·L·O·0·1 제외, 위치 셔플, 예: A2B4Q9). 서버 push 성공 후에만 로컬 저장. */
  function _kioskGenAccessKey(){
    var key='';
    /* 영문 3 + 숫자 3 = 6자리, 위치 셔플 (사용자 결정 2026-06-13) */
    var _akL='ABCDEFGHJKMNPQRSTUVWXYZ',_akD='23456789',_akArr=[];
    var _akRnd=function(n){ try{ var b=new Uint32Array(1);crypto.getRandomValues(b);return b[0]%n; }catch(_){ return Math.floor(Math.random()*n); } };
    for(var i=0;i<3;i++)_akArr.push(_akL.charAt(_akRnd(_akL.length)));
    for(var j=0;j<3;j++)_akArr.push(_akD.charAt(_akRnd(_akD.length)));
    for(var k=_akArr.length-1;k>0;k--){ var m=_akRnd(k+1),t=_akArr[k];_akArr[k]=_akArr[m];_akArr[m]=t; }
    key=_akArr.join('');
    var apply=function(){
      if(!window.electronAPI||!window.electronAPI.kioskPushAccessKey){bus.emit('toast:show',{text:'이 기능은 앱 업데이트가 필요합니다.'});return;}
      window.electronAPI.kioskPushAccessKey(ks.relayUrl||DEFAULT_RELAY_URL,ks.channelId,ks.authToken,key).then(function(res){
        if(res&&res.success){
          ks.accessKey=key;_save();
          renderSettingsPanel('kiosk');
          bus.emit('toast:show',{text:'✅ 접속 인증키가 설정되었습니다: '+key});
        } else {
          bus.emit('toast:show',{text:'인증키 설정 실패: '+(res&&res.error||'서버 오류')});
        }
      }).catch(function(err){bus.emit('toast:show',{text:'인증키 설정 실패: '+err.message});});
    };
    _kioskEnsureChannelThen(apply);
  }
  function _kioskClearAccessKey(){
    appConfirmModal(
      '접속 인증키를 해제하면 URL 만으로 누구나 키오스크에 접속할 수 있게 됩니다.<br>해제할까요?',
      '🔑 접속 인증키 해제'
    ).then(function(ok){
      if(!ok)return;
      if(!window.electronAPI||!window.electronAPI.kioskPushAccessKey)return;
      window.electronAPI.kioskPushAccessKey(ks.relayUrl||DEFAULT_RELAY_URL,ks.channelId,ks.authToken,'').then(function(res){
        if(res&&res.success){
          ks.accessKey='';_save();
          renderSettingsPanel('kiosk');
          bus.emit('toast:show',{text:'접속 인증키가 해제되었습니다.'});
        } else {
          bus.emit('toast:show',{text:'인증키 해제 실패: '+(res&&res.error||'서버 오류')});
        }
      }).catch(function(err){bus.emit('toast:show',{text:'인증키 해제 실패: '+err.message});});
    });
  }

  /* 채널 보장 후 실행 — 생성이 '성공으로 끝난 뒤에만' 진행. 연결정보 빈 HTML 이 절대 안 나가게. (2026-06-11)
   *  · 이미 생성 진행 중(편집 진입의 백그라운드 생성 등)이면 완료를 최대 10초 대기 후 진행 — 레이스로 빈 채널 다운로드되던 문제 수정.
   *  · 실패(오프라인 등) 시 다운로드 중단 + 안내. */
  function _kioskEnsureChannelThen(run){
    if(ks.channelId&&ks.authToken){run();return;}
    /* 실패는 토스트가 아니라 진단 모달로 — 사용자가 "왜 생성이 안 되는지" 반드시 보고, [오류 정보 복사]로 통째 보낼 수 있게
       (모든 [생성] 실패 경로를 동일 진단 모달로 통일, 사용자 결정 2026-06-15) */
    var _fail=function(reason, res){
      var _r=String(reason||'');
      var _isLimit=(_r.indexOf('제한')!==-1)||(_r.indexOf('429')!==-1)||(res&&res._httpStatus===429)||(/limit|too\s*many/i.test(_r));
      var _msg=_isLimit
        ? '서버의 채널 생성 제한(시간당 10회)에 걸려 있습니다.<br>약 1시간 후 다시 시도하시거나, PC 인터넷을 휴대폰 핫스팟으로 잠시 바꾸면 즉시 가능합니다.'
        : '연결 채널 생성에 실패해 [생성]을 중단했습니다.<br>인터넷 연결 확인 후 다시 시도해주세요.';
      _msg+='<br><br>아래 정보를 <b>[📋 오류 정보 복사]</b>로 복사해 오렌지팜에 보내주시면 원인 추적이 빠릅니다.';
      var _diag=_kioskBuildDiag({kind:'키오스크 채널 생성 오류',stage:'채널 생성',error:_r||'채널 생성 실패',status:res&&res._httpStatus,body:res&&res._rawBody,netCode:res&&res._netCode,relayUrl:(ks.relayUrl||DEFAULT_RELAY_URL),url:(ks.relayUrl||DEFAULT_RELAY_URL)+'/api/v1/admin/channel'});
      _showKioskErrModal('⚠️ 키오스크 채널 생성 실패', _msg, _diag);
    };
    if(_creatingChannel){
      var _waited=0;
      var t=setInterval(function(){
        _waited+=300;
        if(ks.channelId&&ks.authToken){clearInterval(t);run();return;}
        if(!_creatingChannel||_waited>=10000){clearInterval(t);if(ks.channelId&&ks.authToken)run();else _fail();}
      },300);
      return;
    }
    _kioskCreateNewChannel(function(okc, errMsg, res){
      if(okc&&ks.channelId&&ks.authToken)run(); else _fail(errMsg, res);
    });
  }

  var _creatingChannel=false;
  function _kioskCreateNewChannel(cb){
    if(_creatingChannel) { if(cb)cb(false); return; }
    _creatingChannel=true;
    var url=ks.relayUrl||DEFAULT_RELAY_URL;
    var schoolName=(S.schoolInfo&&S.schoolInfo.school_name)||(S.settings&&S.settings.schoolName)||'';
    var eduOffice=(S.schoolInfo&&S.schoolInfo.education_office)||(S.settings&&S.settings.eduOffice)||'';
    if(!window.electronAPI||!window.electronAPI.kioskCreateChannel){_creatingChannel=false;if(cb)cb(false);return;}
    window.electronAPI.kioskCreateChannel(url,schoolName,eduOffice).then(function(res){
      _creatingChannel=false;
      /* ★ 서버 응답 키 camelCase — snake_case 만 읽어 undefined 저장되던 치명 버그 수정 (2026-06-11, 위 _kioskCreateChannel 과 동일) */
      var _chId=res&&(res.channelId||res.channel_id);
      var _tk=res&&(res.nurseToken||res.nurse_token);
      var _ok=!!(res&&res.success&&_chId&&_tk);
      if(_ok){
        ks.relayUrl=url;ks.channelId=_chId;ks.authToken=_tk;ks.urlReady=false;_save();
        bus.emit('toast:show',{text:'✅ 채널 생성 완료!'});
        bus.emit('kiosk:sidebar-refresh');
      } else {
        bus.emit('toast:show',{text:'채널 생성 실패: '+(res&&res.error||'서버 응답 형식 오류')});
      }
      kioskUpdateSidebar();
      if(cb)cb(_ok, res&&res.error, res);
    }).catch(function(err){
      _creatingChannel=false;
      if(cb)cb(false, err.message, {_netCode:(err&&err.message)});
      bus.emit('toast:show',{text:'채널 생성 실패: '+err.message});
      kioskUpdateSidebar();
    });
  }

  function _kioskCmsToggleActive(){
    if(!ks.active){
      /* 비활성→활성: 항상 동의 팝업 표시 */
      _showKioskRelayConsent(function(){
        ks.active=true;_relayOk=false;ks.activeDate=_kioskTodayStr();_save();
        renderSettingsPanel('kiosk');kioskUpdateSidebar();
        if(ks.channelId&&ks.authToken){
          bus.emit('kiosk:sidebar-refresh');
        } else {
          _kioskCreateNewChannel();
        }
      });
      return;
    } else {
      ks.active=false;_relayOk=false;
    }
    _save();renderSettingsPanel('kiosk');
    bus.emit('kiosk:sidebar-refresh');
  }

  /* ── LAN WebSocket 서버 관리 ── */
  let _wsRunning=false;
  function _kioskWsToggle(){
    if(!window.electronAPI)return;
    if(_wsRunning){
      window.electronAPI.kioskWsStop().then(function(){_wsRunning=false;localStorage.setItem('ec_kiosk_ws_auto','0');_kioskWsRefreshStatus();});
    } else {
      /* 릴레이 서버 개인정보 동의 확인 */
      if(localStorage.getItem('ec_kiosk_relay_agreed')!=='1'){
        _showKioskRelayConsent(function(){
          localStorage.setItem('ec_kiosk_relay_agreed','1');
          _doKioskWsStart();
        });
        return;
      }
      _doKioskWsStart();
    }
  }
  function _doKioskWsStart(){
    window.electronAPI.kioskWsStart(7329).then(function(res){
      if(res&&res.success){_wsRunning=true;localStorage.setItem('ec_kiosk_ws_auto','1');_kioskWsRefreshStatus();}
      else bus.emit('toast:show', {text: 'WS 서버 시작 실패: '+(res&&res.error||'')});
    });
  }
  export function _showKioskRelayConsent(onAgree){
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)';
    const box=document.createElement('div');
    box.style.cssText='background:var(--card);border-radius:16px;padding:28px 24px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.3);border:1px solid var(--bdr)';
    box.innerHTML=
      '<div style="font-size:16px;font-weight:800;color:var(--t3);margin-bottom:16px;display:flex;align-items:center;gap:8px">🔒 키오스크 릴레이 서버 안내</div>'
      +'<div style="font-size:11px;color:var(--t2);line-height:1.8;margin-bottom:16px">'
      +'키오스크 기능은 학생/교직원 접수 데이터를 <b>릴레이 서버</b>를 통해 중계합니다.'
      +'</div>'
      +'<div style="background:var(--bg2);border-radius:10px;padding:14px;margin-bottom:14px;border:1px solid var(--bdr)">'
      +'<table style="width:100%;font-size:11px;border-collapse:collapse">'
      +'<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">Oracle Cloud 이용약관</td><td style="padding:8px 6px;color:var(--gs)">✅ 개인/민감정보를 저장하지 않음</td></tr>'
      +'<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">Oracle 춘천 리전</td><td style="padding:8px 6px;color:var(--gs)">✅ 데이터센터가 강원도 춘천에 위치</td></tr>'
      +'<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">개인정보보호법</td><td style="padding:8px 6px;color:var(--yl)">⚠️ 개인정보 처리 책임은 학교 기관 (서버에 저장되는 개인정보가 없으므로 오렌지팜은 개인정보위탁 관리를 하지 않습니다.)</td></tr>'
      +'<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">전송 구간 암호화</td><td style="padding:8px 6px;color:var(--gs)">✅ HTTPS(TLS)를 통한 데이터 전송 (기본 적용)</td></tr>'
      +'<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">서버 저장 최소화</td><td style="padding:8px 6px;color:var(--gs)">✅ 서버는 접수 데이터를 전달하기 위해 사용 · 키오스크 화면(명단 포함)은 사용자의 시스템에서 불러와서 표시</td></tr>'
      +'<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">접근 통제</td><td style="padding:8px 6px;color:var(--gs)">✅ 인증된 채널만 접속 가능 (JWT 인증 적용)</td></tr>'
      +'<tr><td style="padding:8px 6px;font-weight:700;color:var(--t1);white-space:nowrap">개인정보 처리방침</td><td style="padding:8px 6px;color:var(--yl)">⚠️ 릴레이 서버에 전송되는 데이터 범위를 학교 자체 안내 권장</td></tr>'
      +'</table></div>'
      +'<div style="font-size:10px;color:var(--t3);line-height:1.7;padding:10px 12px;background:var(--bg2);border-radius:8px;margin-bottom:18px;border:1px solid var(--bdr)">'
      +'💡 소속 기관의 결재 후 사용하시는 것이 안전합니다.'
      +'</div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end">'
      +'<button class="btn btn-outline btn-sm" data-consent="cancel" style="padding:8px 18px;font-size:12px">취소</button>'
      +'<button class="btn btn-primary btn-sm" data-consent="agree" style="padding:8px 18px;font-size:12px">확인하고 활성화</button>'
      +'</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    function _close(){if(ov.parentNode)ov.remove();}
    box.querySelector('[data-consent="cancel"]').addEventListener('click',function(e){e.stopPropagation();_close();});
    box.querySelector('[data-consent="agree"]').addEventListener('click',function(e){e.stopPropagation();_close();if(onAgree)onAgree();});
    ov.addEventListener('click',function(e){if(e.target===ov)_close();});
  }
  function _kioskWsRefreshStatus(){
    if(!window.electronAPI||!window.electronAPI.kioskWsStatus)return;
    window.electronAPI.kioskWsStatus().then(function(s){
      _wsRunning=!!(s&&s.running);
      const area=document.getElementById('kioskWsStatusArea');
      const btn=document.getElementById('kioskWsStartBtn');
      const qrArea=document.getElementById('kioskWsQrArea');
      if(area){
        if(_wsRunning){
          area.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:10px">'
            +'<div style="width:10px;height:10px;border-radius:50%;background:var(--gs);box-shadow:0 0 6px rgba(34,197,94,0.5)"></div>'
            +'<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--gs)">서버 실행 중</div>'
            +'<div style="font-size:10px;color:var(--t2)">IP: <b style="font-family:var(--fm)">'+s.ip+'</b> · 포트: <b style="font-family:var(--fm)">'+s.port+'</b> · 연결된 기기: <b>'+s.clients+'</b>대</div></div></div>';
        } else {
          area.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg2);border:1px solid var(--bdr);border-radius:10px">'
            +'<div style="width:10px;height:10px;border-radius:50%;background:var(--t3)"></div>'
            +'<div style="font-size:12px;color:var(--t3)">서버 꺼짐 — 시작 버튼을 눌러 태블릿 연결을 활성화하세요.</div></div>';
        }
      }
      if(btn){
        btn.textContent=_wsRunning?'⏹ 서버 종료':'📡 서버 시작';
        btn.className=_wsRunning?'btn btn-outline btn-sm':'btn btn-primary btn-sm';
      }
      if(qrArea){
        if(_wsRunning&&s.ip){
          const wsUrl='ws://'+s.ip+':'+s.port;
          /* QR 코드 — 간단한 텍스트 기반 (외부 라이브러리 없이) */
          qrArea.style.display='block';
          qrArea.innerHTML='<div style="padding:14px;background:#fff;border-radius:12px;display:inline-block;border:2px solid var(--cyan);margin-bottom:8px">'
            +'<div style="font-size:11px;font-weight:700;color:#0e7490;margin-bottom:8px">태블릿에서 접속</div>'
            +'<div style="font-size:18px;font-weight:800;font-family:var(--fm);color:#1e293b;padding:8px 16px;background:#f0f9ff;border-radius:8px;letter-spacing:1px;user-select:all">'+wsUrl+'</div>'
            +'<div style="font-size:9px;color:#64748b;margin-top:6px">태블릿 브라우저에서 이 주소로 접속하세요</div></div>'
            +'<div><button class="btn btn-sm" data-action="copy-ws-url" data-url="'+wsUrl+'" style="font-size:10px">📋 주소 복사</button></div>';
          const _copyBtn=qrArea.querySelector('[data-action="copy-ws-url"]');
          if(_copyBtn)_copyBtn.addEventListener('click',function(){navigator.clipboard.writeText(this.dataset.url).then(function(){bus.emit('toast:show', {text: '주소가 복사되었습니다.'});});});
        } else {qrArea.style.display='none';qrArea.innerHTML='';}
      }
    });
  }

  /* WS 서버 자동 시작 제거 (2026-05-15).
   *
   * 이전 동작: 사용자가 한 번이라도 키오스크 LAN WS 를 켰으면 다음 부팅 시 자동 기동.
   * 회귀 보고: 빌드 후 설치한 사용자가 첫 실행에 Windows Defender 의 "공용/프라이빗 네트워크
   *           접근 허용" 팝업을 보게 됨 — 7329 가 0.0.0.0 으로 열리기 때문.
   *           키오스크 LAN 직결을 안 쓰는 사용자에게도 매번 묻는 게 부담.
   *
   * 변경: 자동 기동 IIFE 제거. 사용자가 설정 → 키오스크 탭에서 명시적으로 "서버 시작" 누를 때만
   *       포트 열림. 그 시점에 방화벽 팝업이 한 번 뜨고 사용자가 의식적으로 허용/차단 선택.
   *       (ec_kiosk_ws_auto localStorage 플래그는 무해해서 그대로 둠 — 미참조.) */

