/* Copyright (c) 2026 OrangeFarm. All rights reserved. */

import { KIOSK_CHIME_RECORDINGS } from './kiosk-chime-recordings-v2.js';

const KIOSK_CHIME_OPTIONS=[
  {
    "key": "classic",
    "label": "기존 알림음",
    "description": "기존에 사용하던 호출 알림음입니다."
  },
  {
    "key": "soft",
    "label": "포근한 피아노",
    "description": "부드러운 피아노 음색의 짧은 선율과 자연스러운 여운입니다."
  },
  {
    "key": "short",
    "label": "맑은 유리 차임",
    "description": "가볍고 맑은 유리 음색이 짧게 반짝인 뒤 잦아듭니다."
  },
  {
    "key": "clear",
    "label": "안내 방송 차임",
    "description": "학교 안내 방송처럼 또렷한 네 음으로 차분하게 호출합니다."
  },
  {
    "key": "bell",
    "label": "은은한 벨",
    "description": "종을 한 번 울린 듯한 풍부한 배음과 부드러운 잔향입니다."
  },
  {
    "key": "calm",
    "label": "차분한 하프",
    "description": "현을 차례로 튕기는 듯한 네 음이 편안하게 이어집니다."
  },
  {
    "key": "low",
    "label": "따뜻한 마림바",
    "description": "짧고 작았던 나무 두드림 대신, 선명한 타격감과 따뜻한 울림을 담았습니다."
  }
];

function kioskSettingsVoiceKey(voice){return JSON.stringify([voice.voiceURI||'',voice.name||'',voice.lang||'']);}
function refreshKioskSettingsVoices(container,settings){
  let voices=[];
  try{voices=(window.speechSynthesis?.getVoices()||[]).filter(voice=>voice.localService===true&&/^ko(?:[-_]|$)/i.test(voice.lang||''));}catch(_){}
  const voice=voices.find(item=>item.default)||voices[0]||null;
  const info=container.querySelector('[data-kiosk-audio-voices-info]');
  if(info)info.textContent=voice?'이 기기의 기본 한국어 음성으로 안내합니다. 사용 음성: '+voice.name+'.':'한국어 음성을 준비하고 있습니다. 준비되지 않으면 알림음과 화면으로 안내합니다.';
}

export function normalizeKioskCallAudio(settings={}) {
  const value=settings.callAudio||{};
  const level=(input,fallback)=>{
    if(input==null||input==='')return fallback;
    const number=Number(input);
    return Number.isFinite(number)?Math.max(0,Math.min(1,number)):fallback;
  };
  const legacyVolume=level(value.volume,1);
  // Preserve existing speech volume and silence; reduce the legacy chime level.
  const chimeVolume=level(value.chimeVolume,legacyVolume===0?0:Math.max(.05,Math.round(legacyVolume*.45*20)/20));
  const voiceVolume=level(value.voiceVolume,legacyVolume);
  const mode=['both','voice','chime'].includes(value.mode)?value.mode:(settings.callNameEnabled===false?'chime':'both');
  const requestedRate=Number(value.rate);
  const legacyRates={0.8:0.7,0.9:1,1.1:1.4};
  const rate=[0.7,1,1.4].includes(requestedRate)?requestedRate:(legacyRates[requestedRate]||1);
  return {
    mode,
    chime:KIOSK_CHIME_OPTIONS.some(option=>option.key===value.chime)?value.chime:'classic',
    rate,
    chimeVolume,
    voiceVolume,
    // Retain a derived value for callers that still inspect the legacy field.
    volume:mode==='chime'?chimeVolume:mode==='voice'?voiceVolume:Math.max(chimeVolume,voiceVolume),
    voice:''
  };
}

export function kioskCallSettingsHtml(settings) {
  const config=normalizeKioskCallAudio(settings);
  const options=(items,current)=>items.map(([value,label])=>'<option value="'+value+'"'+(String(value)===String(current)?' selected':'')+'>'+label+'</option>').join('');
  const select=(key,label,items,hint='')=>'<label class="ka-settings-field"><span class="ka-settings-label">'+label+'</span><select data-kiosk-audio="'+key+'">'+options(items,config[key])+'</select>'+hint+'</label>';
  const volumeControl=(key,label,hint)=>'<label class="ka-volume-box"><span class="ka-volume-heading"><span class="ka-settings-label">'+label+'</span><span data-kiosk-audio-volume="'+key+'" class="ka-volume-value">'+Math.round(config[key]*100)+'%</span></span><input type="range" aria-label="'+label+'" data-kiosk-audio="'+key+'" min="0" max="100" step="5" value="'+Math.round(config[key]*100)+'"><span class="ka-field-hint">'+hint+'</span></label>';
  const styles=`
    .kiosk-call-card.cc{padding:0;margin-bottom:14px;border:2px solid rgba(6,182,212,.28);border-radius:14px;background:var(--card,#fff);overflow:hidden;min-width:0}
    .kiosk-call-card,.kiosk-call-card *{box-sizing:border-box}
    .kiosk-call-heading{display:flex;align-items:flex-start;gap:11px;padding:18px 20px 16px;border-bottom:1px solid rgba(6,182,212,.14)}
    .kiosk-call-heading-icon{display:grid;place-items:center;flex:0 0 38px;width:38px;height:38px;border:1px solid rgba(6,182,212,.2);border-radius:12px;background:rgba(6,182,212,.075);font-size:21px}
    .kiosk-call-heading-copy{flex:1;min-width:0}
    .kiosk-call-heading h3{font-size:15px;font-weight:800;color:var(--cyan,#0e7490);line-height:1.55;margin:0}
    .kiosk-call-heading p{font-size:12px;line-height:1.8;color:var(--t2,#526675);margin:5px 0 0;overflow-wrap:anywhere}
    .kiosk-audio-settings{padding:18px 20px;color:var(--t1,#213747);min-width:0}
    .kiosk-audio-settings *{box-sizing:border-box}
    .ka-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));align-items:start;gap:15px 16px}
    .kiosk-audio-settings .ka-settings-field{display:grid;gap:8px;min-width:0;margin:0;font:inherit;color:inherit}
    .ka-settings-label{font-size:12px;font-weight:700;line-height:1.5;color:var(--t1,#213747)}
    .kiosk-audio-settings select{display:block;width:100%;max-width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--bdr,#d3dfe5);border-radius:10px;background:var(--card,#fff);color:var(--t1,#213747);font-family:inherit;font-size:13px;line-height:1.5;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(15,55,70,.035)}
    .kiosk-audio-settings select:hover{border-color:rgba(6,182,212,.55)}
    .ka-field-hint{font-size:11.5px;line-height:1.7;color:var(--t3,var(--t2,#657b87));font-weight:400;overflow-wrap:anywhere}
    .kiosk-audio-settings .ka-voices-info{margin:13px 0 0;padding:10px 12px;border:1px dashed rgba(6,182,212,.22);border-radius:10px;background:rgba(6,182,212,.03);font-size:11.5px;line-height:1.8;color:var(--t2,#526675);overflow-wrap:anywhere}
    .ka-volume-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;margin-top:14px}
    .ka-volume-box{display:block;min-width:0;margin:0;padding:12px 14px;border:1px solid var(--bdr,#d3dfe5);border-radius:12px;background:var(--card,#fff)}
    .ka-volume-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
    .ka-volume-value{display:inline-flex;align-items:center;justify-content:center;min-width:54px;padding:3px 9px;border-radius:999px;background:rgba(6,182,212,.1);color:var(--cyan,#0e7490);font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
    .kiosk-audio-settings input[type=range]{display:block;width:100%;max-width:100%;min-width:0;min-height:32px;margin:3px 0;accent-color:var(--cyan,#0891b2);cursor:pointer;padding:0;box-shadow:none}
    .ka-preview-box{display:grid;gap:12px;margin-top:16px;padding:15px;border:1px solid rgba(6,182,212,.3);border-radius:13px;background:var(--card,#fff)}
    .ka-preview-heading{display:flex;align-items:center;gap:8px;color:var(--cyan,#0e7490);font-size:13px;font-weight:800;line-height:1.5}
    .ka-preview-heading>span:first-child{font-size:18px}
    .ka-sample{min-width:0;padding:12px 14px;border:1px solid var(--bdr,#d3dfe5);border-radius:11px;background:var(--card,#fff)}
    .ka-sample-caption{display:block;margin:0 0 5px;font-size:11px;font-weight:700;line-height:1.5;color:var(--t3,var(--t2,#657b87))}
    .ka-sample-message{display:block;font-size:14px;font-weight:700;line-height:1.8;color:var(--t1,#213747);word-break:keep-all;overflow-wrap:anywhere}
    .ka-preview-actions{display:flex;align-items:stretch;flex-wrap:wrap;gap:8px;min-width:0}
    .kiosk-audio-settings .ka-preview-actions .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;max-width:100%;padding:10px 13px;border-radius:10px;font-family:inherit;font-size:12px;line-height:1.55;font-weight:700;white-space:normal;word-break:keep-all;overflow-wrap:anywhere;touch-action:manipulation;cursor:pointer}
    .kiosk-audio-settings .ka-preview-tone{flex:1 1 130px;border:1px solid rgba(6,182,212,.35);background:var(--card,#fff);color:var(--cyan,#0e7490)}
    .kiosk-audio-settings .ka-preview-primary{flex:1.5 1 200px;border:1px solid transparent;background:var(--cyan,#0891b2);color:#fff;box-shadow:0 2px 8px rgba(6,182,212,.18)}
    .kiosk-audio-settings .ka-preview-stop{flex:0 1 72px;border:1px solid var(--bdr,#d3dfe5);background:var(--card,#fff);color:var(--t2,#526675);font-weight:500}
    .kiosk-audio-settings .ka-preview-actions .btn:hover:not(:disabled){filter:brightness(.97)}
    .kiosk-audio-settings .ka-preview-actions .btn:disabled{opacity:.45;cursor:default;box-shadow:none}
    .kiosk-audio-settings .ka-preview-status{min-height:21px;margin:0;font-size:11.5px;line-height:1.8;color:var(--t2,#526675);overflow-wrap:anywhere}
    .kiosk-audio-settings .ka-save-status{margin:12px 0 0;font-size:11.5px;line-height:1.8;color:var(--t2,#526675);overflow-wrap:anywhere}
    .ka-apply-help{margin-top:11px;padding-top:11px;border-top:1px dashed rgba(6,182,212,.25)}
    .ka-apply-help summary{width:fit-content;max-width:100%;min-height:36px;padding:7px 0;color:var(--cyan,#0e7490);font-size:12px;font-weight:700;line-height:1.8;cursor:pointer;overflow-wrap:anywhere}
    .ka-apply-help p{margin:5px 0 0;font-size:11.5px;line-height:1.9;color:var(--t2,#526675);overflow-wrap:anywhere}
    .kiosk-call-guide{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:15px 20px;border-top:1px solid rgba(6,182,212,.16);background:rgba(6,182,212,.025)}
    .kiosk-call-guide-copy{flex:1 1 220px;min-width:0}
    .kiosk-call-guide-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;line-height:1.6;color:var(--t1,#213747)}
    .kiosk-call-guide-copy p{margin:4px 0 0;font-size:11.5px;line-height:1.8;color:var(--t2,#526675);overflow-wrap:anywhere}
    .kiosk-call-card .kiosk-call-guide-toggle{min-height:42px;max-width:100%;padding:9px 14px;border-radius:10px;font-family:inherit;font-size:12px;line-height:1.6;font-weight:700;white-space:normal}
    .kiosk-call-card .kiosk-call-guide-toggle[aria-pressed=true]{border-color:rgba(6,182,212,.35);background:rgba(6,182,212,.08);color:var(--cyan,#0e7490)}
    .kiosk-call-card :is(button,select,input,summary):focus-visible,.kiosk-audio-settings :is(button,select,input,summary):focus-visible{outline:2px solid var(--cyan,#0891b2);outline-offset:3px}
    @media(max-width:480px){.kiosk-call-heading{padding:15px}.kiosk-audio-settings{padding:15px}.ka-preview-box{padding:12px}.kiosk-call-guide{padding:14px 15px}.ka-preview-actions .ka-preview-stop{flex-grow:1}}
  `;
  return '<style>'+styles+'</style><div data-kiosk-audio-form class="kiosk-audio-settings">'
    +'<div class="ka-settings-grid">'
    +select('mode','호출 방식',[['both','이름 + 알림음'],['voice','이름만'],['chime','알림음만']])
    +select('chime','알림음 종류',KIOSK_CHIME_OPTIONS.map(option=>[option.key,option.label]))
    +select('rate','이름 읽기 속도',[[0.7,'느리게'],[1,'보통'],[1.4,'빠르게']],'<span class="ka-field-hint">이름을 읽는 속도입니다. 아래 미리 듣기에서 알림음과 함께 확인해 주세요.</span>')
    +'</div><p data-kiosk-audio-voices-info class="ka-voices-info">한국어 목소리 목록을 확인하고 있습니다.</p>'
    +'<div class="ka-volume-grid">'
    +volumeControl('chimeVolume','알림음 음량','알림음이 목소리보다 크게 들리면 낮춰 주세요. 0%에서는 알림음이 나오지 않습니다.')
    +volumeControl('voiceVolume','안내 목소리 음량','이름 안내의 음량입니다. 0%에서는 목소리가 나오지 않습니다. 기기의 시스템 음량도 함께 확인해 주세요.')
    +'</div>'
    +'<section class="ka-preview-box" aria-label="소리 미리 듣기"><div class="ka-preview-heading"><span aria-hidden="true">🎧</span><span>설정한 소리 미리 듣기</span></div>'
    +'<div data-kiosk-audio-sample class="ka-sample"><span class="ka-sample-caption">가상 학생 안내 샘플</span><span class="ka-sample-message">3학년 1반 홍길동 학생, 보건실로 들어오세요.</span></div>'
    +'<div class="ka-preview-actions"><button type="button" class="btn btn-primary ka-preview-primary" data-kiosk-audio-preview="all"><span aria-hidden="true">🔊</span>선택한 설정으로 미리 듣기</button><button type="button" class="btn btn-outline ka-preview-stop" data-kiosk-audio-preview="stop" disabled>중지</button></div>'
    +'<p data-kiosk-audio-preview-status role="status" aria-live="polite" class="ka-preview-status">위에서 설정한 호출 방식·알림음·읽기 속도·음량을 한 번에 들어보세요.</p></section>'
    +'<p data-kiosk-audio-save role="status" aria-live="polite" class="ka-save-status">'+(config.volume===0?'현재 호출 방식의 음량이 0%로, 화면 안내만 표시됩니다.':'설정은 변경할 때 자동으로 저장됩니다. 기기의 시스템 음량도 함께 확인해 주세요.')+'</p>'
    +'<details class="ka-apply-help"><summary>적용 방법과 기기별 목소리 안내</summary><p><strong>설정 변경 → 키오스크 다시 생성 → 기기에서 새로고침</strong> 순서로 적용해 주세요.</p><p>목소리는 각 기기의 기본 한국어 음성을 자동으로 사용합니다. 기기의 <strong>관리 → 호출 소리 확인</strong>에서 전체 호출을 들어볼 수 있습니다. 한국어 음성을 사용할 수 없으면 화면으로 안내하며, 알림음은 설정한 음량에 따라 재생됩니다.</p></details></div>';
}

export function bindKioskCallSettings(container,settings,save) {
  refreshKioskSettingsVoices(container,settings);
  if(container._kioskCallAudioBound)return;
  container._kioskCallAudioBound=true;
  bindKioskSettingsAudioPreview(container,settings);
  if(window.speechSynthesis){
    const refresh=()=>{
      if(!container.isConnected){window.speechSynthesis.removeEventListener('voiceschanged',refresh);return;}
      refreshKioskSettingsVoices(container,settings);
    };
    window.speechSynthesis.addEventListener('voiceschanged',refresh);
  }
  container.addEventListener('input',event=>{
    const input=event.target.closest('[data-kiosk-audio="chimeVolume"],[data-kiosk-audio="voiceVolume"]');if(!input)return;
    const label=input.closest('[data-kiosk-audio-form]')?.querySelector('[data-kiosk-audio-volume="'+input.dataset.kioskAudio+'"]');
    if(label)label.textContent=input.value+'%';
  });
  container.addEventListener('change',event=>{
    const input=event.target.closest('[data-kiosk-audio]');if(!input)return;
    const key=input.dataset.kioskAudio;if(!['mode','chime','rate','chimeVolume','voiceVolume'].includes(key))return;
    const isVolume=key==='chimeVolume'||key==='voiceVolume';
    const previous=settings.callAudio,previousEnabled=settings.callNameEnabled;
    const value=isVolume?Number(input.value)/100:key==='rate'?Number(input.value):input.value;
    settings.callAudio=normalizeKioskCallAudio({callAudio:{...normalizeKioskCallAudio(settings),[key]:value}});
    settings.callNameEnabled=settings.callAudio.mode!=='chime';
    const notice=input.closest('[data-kiosk-audio-form]')?.querySelector('[data-kiosk-audio-save]');
    try {
      save();
      if(notice)notice.textContent=(settings.callAudio.volume===0?'현재 호출 방식의 음량 0%: 화면 안내만 표시됩니다. ':'')+'저장했습니다. 키오스크를 다시 생성하고 기기에서 새로고침하면 적용됩니다.';
    } catch(_) {
      settings.callAudio=previous;settings.callNameEnabled=previousEnabled;
      const old=normalizeKioskCallAudio(settings);input.value=String(isVolume?Math.round(old[key]*100):old[key]);
      if(isVolume){const label=input.closest('[data-kiosk-audio-form]')?.querySelector('[data-kiosk-audio-volume="'+key+'"]');if(label)label.textContent=Math.round(old[key]*100)+'%';}
      if(notice)notice.textContent='소리 설정을 저장하지 못했습니다. 다시 선택해 주세요.';
    }
  });
}


function bindKioskSettingsAudioPreview(container,settings) {
  let active=null;
  const notice=()=>container.querySelector('[data-kiosk-audio-preview-status]');
  function say(message){const element=notice();if(element)element.textContent=message;}
  function stop(message){
    const current=active;active=null;
    if(current){clearInterval(current.watch);current.player?.stop();}
    const button=container.querySelector('[data-kiosk-audio-preview="stop"]');if(button)button.disabled=true;
    if(message)say(message);
  }
  try{window.speechSynthesis?.getVoices();}catch(_){}
  for(const type of ['input','change'])container.addEventListener(type,event=>{
    if(!event.target.closest('[data-kiosk-audio]'))return;
    if(active)stop('설정이 변경되어 재생을 멈췄습니다. 미리 듣기를 다시 눌러 확인해 주세요.');
    else say('선택한 설정으로 미리 듣기를 눌러 소리를 확인해 주세요.');
  });
  container.addEventListener('click',event=>{
    const button=event.target.closest('[data-kiosk-audio-preview]');if(!button)return;
    if(button.dataset.kioskAudioPreview==='stop'){stop('미리 듣기를 중지했습니다.');return;}
    if(button.dataset.kioskAudioPreview!=='all')return;
    stop();
    const config=normalizeKioskCallAudio(settings);
    if(config.volume===0){say('현재 호출 방식의 음량이 0%입니다. 해당 알림음 또는 안내 목소리 음량을 높여 주세요.');return;}
    const current={player:null,watch:null};active=current;
    const stopButton=container.querySelector('[data-kiosk-audio-preview="stop"]');if(stopButton)stopButton.disabled=false;
    try{
      current.player=createKioskSettingsPreview({callAudio:config,channelId:'settings-audio-preview'},message=>{
        if(active===current)say(message);
      },result=>{
        if(active!==current)return;
        stop(result.message);
        container.dispatchEvent(new CustomEvent('kiosk-audio-preview-complete',{detail:result}));
      });
      current.watch=setInterval(()=>{if(!container.isConnected||!button.isConnected||button.getClientRects().length===0)stop();},400);
      current.player.start();
    }catch(_){stop('미리 듣기를 시작하지 못했습니다. 설정 화면을 다시 열고 시도해 주세요.');}
  });
}

/* Use the production engine in the current window, not in a short-lived iframe. */
function createKioskSettingsPreview(settings,onStatus,onDone){
  const config=kioskCallRuntimeConfig(settings);
  let stopped=false,completed=false,watchdog=null,timing=null;
  const utterances=[],listeners=[];
  const status={value:'',get textContent(){return this.value;},set textContent(value){this.value=String(value||'');if(!stopped&&this.value)onStatus(this.value);}};
  function listen(target,type,handler,options){target.addEventListener(type,handler,options);listeners.push({target,type,handler,options});}
  const scope={
    document:{
      addEventListener:(type,handler,options)=>listen(document,type,handler,options),
      removeEventListener:(type,handler,options)=>document.removeEventListener(type,handler,options),
      querySelector:()=>status
    },
    speechSynthesis:window.speechSynthesis,
    SpeechSynthesisUtterance:window.SpeechSynthesisUtterance?function(text){
      const value=new window.SpeechSynthesisUtterance(text);utterances.push(value);
      listen(value,'start',()=>{
        timing={started:performance.now(),seconds:null,rate:config.rate,engineRate:value.rate,voice:value.voice?.name||'기본 음성'};
        onStatus('가상 학생의 이름 안내를 읽고 있습니다.');
      });
      listen(value,'end',()=>{if(timing&&timing.seconds===null)timing.seconds=(performance.now()-timing.started)/1000;});
      return value;
    }:undefined,
    _fdCallAudio:new Audio(new URL('assets/sounds/dingdong.mp3',document.baseURI).href),
    _fdCallBusy:false,_fdPresentCall(){},fdShowNurseCall(){},
    addEventListener:(type,handler,options)=>listen(window,type,handler,options),
    removeEventListener:(type,handler,options)=>window.removeEventListener(type,handler,options)
  };
  function stop(){
    if(stopped)return;stopped=true;clearTimeout(watchdog);
    scope.fdDisposeCallAudio?.();
    utterances.forEach(value=>{value.onend=null;value.onerror=null;});
    try{scope._fdCallAudio.pause();}catch(_){}
    listeners.forEach(({target,type,handler,options})=>target.removeEventListener(type,handler,options));
  }
  function finish(message){
    if(stopped||completed)return;completed=true;clearTimeout(watchdog);
    const result=timing&&timing.seconds!==null?{seconds:timing.seconds,rate:timing.rate,engineRate:timing.engineRate,voice:timing.voice}:null;
    if(result)message+=' 이름 읽기 '+result.seconds.toFixed(2)+'초 · '+(config.rate<1?'느리게':config.rate>1?'빠르게':'보통')+' · '+result.voice;
    onDone({message,timing:result});
  }
  installKioskCallAudio(config,scope);
  return {stop,start(){
    watchdog=setTimeout(()=>{if(stopped)return;stop();onDone({message:'재생이 지연되어 중지했습니다. 기기의 소리 설정을 확인해 주세요.',timing:null});},65000);
    const hasChime=config.mode!=='voice'&&config.chimeVolume>0;
    const hasVoice=config.mode!=='chime'&&config.voiceVolume>0;
    onStatus(hasChime?'선택한 알림음을 재생합니다.':hasVoice?'이름 안내를 준비하고 있습니다.':'설정한 호출 음량이 0%입니다.');
    scope._fdCallChime(()=>{
      if(stopped)return;
      if(hasVoice)onStatus(hasChime?'알림음 재생이 끝났습니다. 이름 안내를 준비하고 있습니다.':'이름 안내를 준비하고 있습니다.');
      scope._fdSpeakName('3학년 1반 홍길동 학생, 보건실로 들어오세요.',status,()=>{
        if(stopped)return;
        finish(status.textContent||'미리 듣기를 마쳤습니다.');
      });
    });
  }};
}

function kioskCallRuntimeConfig(settings) {
  const normalized=normalizeKioskCallAudio(settings);
  const chime=KIOSK_CHIME_OPTIONS.find(option=>option.key===normalized.chime);
  return {...normalized,namespace:String(settings.channelId||'preview'),chimeLabel:chime.label,chimeRecording:KIOSK_CHIME_RECORDINGS[normalized.chime]||null};
}

export function kioskCallRuntimeSource(settings) {
  const config=kioskCallRuntimeConfig(settings);
  return '\n('+installKioskCallAudio.toString()+')('+JSON.stringify(config).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')+');\n';
}

/* Serialized into the standalone kiosk; do not reference module imports here. */
function installKioskCallAudio(config,previewScope) {
  var window=previewScope||globalThis.window,document=window.document,SpeechSynthesisUtterance=window.SpeechSynthesisUtterance;
  var voiceKey=config.voice||'',activeVoiceKey='',chimeStop=null,speechStop=null,disposed=false;
  var originalChimeUrl=window._fdCallAudio?(window._fdCallAudio.currentSrc||window._fdCallAudio.src):'';
  activeVoiceKey=voiceKey;
  function voices(){
    try{return window.speechSynthesis?window.speechSynthesis.getVoices().filter(function(v){return v.localService===true&&/^ko(?:[-_]|$)/i.test(v.lang||'');}):[];}catch(_){return [];}
  }
  function keyOf(voice){return JSON.stringify([voice.voiceURI||'',voice.name||'',voice.lang||'']);}
  function chooseVoice(key){var list=voices();return list.find(function(v){return keyOf(v)===key;})||list.find(function(v){return v.default;})||list[0]||null;}

  function waitForVoice(status,ready){
    var found=chooseVoice(activeVoiceKey),speech=window.speechSynthesis;
    if(found||!speech||!window.SpeechSynthesisUtterance){ready(found);return function(){};}
    var settled=false,pollTimer,deadline;
    var previous=status.textContent,loading='한국어 목소리를 준비하고 있습니다. 잠시만 기다려 주세요.';
    status.textContent=loading;
    function clear(){clearTimeout(pollTimer);clearTimeout(deadline);try{speech.removeEventListener('voiceschanged',check);}catch(_){}}
    function finish(voice){if(settled)return;settled=true;clear();if(voice&&status.textContent===loading)status.textContent=previous;ready(voice);}
    function check(){if(settled)return;var voice=chooseVoice(activeVoiceKey);if(voice)finish(voice);}
    function poll(){check();if(!settled)pollTimer=setTimeout(poll,100);}
    try{speech.addEventListener('voiceschanged',check);}catch(_){}
    deadline=setTimeout(function(){finish(chooseVoice(activeVoiceKey));},3000);
    poll();
    return function(){if(settled)return;settled=true;clear();};
  }
  function callStatus(message){var el=document.querySelector('#fdNurseCallModal .fd-call-status');if(el)el.textContent=message;}
  // Reuse the kiosk's existing media element, including its audio-unlock flow.
  function primeAudio(){
    if(disposed||config.chime==='classic'||config.chimeVolume===0||chimeStop)return;
    try{
      if(window._fdCallAudio&&config.chimeRecording&&window._fdCallAudio.getAttribute('src')!==config.chimeRecording.data){
        window._fdCallAudio.src=config.chimeRecording.data;window._fdCallAudio.preload='auto';
      }
    }catch(_){}
  }
  document.addEventListener('pointerdown',primeAudio,{passive:true});
  document.addEventListener('keydown',primeAudio);
  primeAudio();
  window.KIOSK_CALL_NAME=config.mode!=='chime';
  window._fdLocalKoreanVoice=function(){return chooseVoice(activeVoiceKey||voiceKey);};

  function playRecording(url,isFallback,done){
    if(disposed)return;
    if(chimeStop)chimeStop();
    var audio=window._fdCallAudio,finished=false,timer;
    function finish(reason){
      if(finished)return;finished=true;clearTimeout(timer);
      if(audio){audio.removeEventListener('ended',ended);audio.removeEventListener('error',failed);try{audio.pause();}catch(_){}}
      if(chimeStop===cancel)chimeStop=null;
      if(reason==='cancel'||disposed)return;
      if(reason==='error'&&!isFallback){
        callStatus('선택한 알림음을 재생할 수 없어 기존 알림음으로 안내합니다.');
        playRecording(originalChimeUrl,true,done);return;
      }
      if(reason==='error')callStatus('알림음을 재생하지 못했습니다. 기기 음량과 소리 재생 허용 상태를 확인해 주세요.');
      done();
    }
    function ended(){finish('ended');}
    function failed(){finish('error');}
    function cancel(){finish('cancel');}
    chimeStop=cancel;
    if(!audio||!url){failed();return;}
    var duration=!isFallback&&config.chimeRecording?config.chimeRecording.duration:2.5;
    timer=setTimeout(failed,Math.max(5000,Math.ceil(duration*1000)+2500));
    try{
      if(audio.getAttribute('src')!==url)audio.src=url;
      audio.addEventListener('ended',ended);audio.addEventListener('error',failed);
      audio.currentTime=0;audio.volume=config.chimeVolume;
      var result=audio.play();if(result&&result.catch)result.catch(failed);
    }catch(_){failed();}
  }
  window.fdStopCallChime=function(){if(chimeStop)chimeStop();};
  function playChime(done){
    if(config.chimeVolume===0){if(config.volume===0)callStatus('현재 호출 방식의 음량이 0%로 설정되어 화면으로만 안내합니다.');done();return;}
    if(config.chime==='classic'){playRecording(originalChimeUrl,true,done);return;}
    playRecording(config.chimeRecording&&config.chimeRecording.data,false,done);
  }
  window._fdCallChime=function(done){if(config.mode==='voice'){done();return;}playChime(done);};
  window._fdSpeakName=function(text,status,done){
    if(disposed)return;
    if(speechStop)speechStop();
    if(config.mode==='chime'){done();return;}
    if(config.voiceVolume===0){status.textContent=config.volume===0?'현재 호출 방식의 음량이 0%로 설정되어 화면으로만 안내합니다.':'안내 목소리 음량이 0%여서 알림음과 화면으로 안내합니다.';done();return;}
    var utterance=null,finished=false,failing=false,timer,cancelVoiceWait=null;
    function finish(){if(finished)return;finished=true;clearTimeout(timer);if(cancelVoiceWait)cancelVoiceWait();if(speechStop===cancelSpeech)speechStop=null;done();}
    function cancelSpeech(){
      if(finished)return;finished=true;failing=true;clearTimeout(timer);
      if(cancelVoiceWait)cancelVoiceWait();
      if(utterance){utterance.onend=null;utterance.onerror=null;try{window.speechSynthesis.cancel();}catch(_){}}
      if(speechStop===cancelSpeech)speechStop=null;
    }
    function failed(message){
      if(finished||failing)return;failing=true;clearTimeout(timer);if(cancelVoiceWait)cancelVoiceWait();
      if(utterance){utterance.onend=null;utterance.onerror=null;}
      status.textContent=message;
      if(config.mode==='voice')playChime(finish);else finish();
    }
    function speak(voice){
      if(disposed||finished||failing)return;
      if(!voice||!window.SpeechSynthesisUtterance){failed('한국어 목소리를 확인하지 못해 '+(config.chimeVolume>0?'알림음과 화면':'화면')+'으로 안내합니다. 잠시 후 다시 듣기를 누르거나 기기의 한국어 음성 설정을 확인해 주세요.');return;}
      if(activeVoiceKey&&keyOf(voice)!==activeVoiceKey)status.textContent='선택했던 목소리를 사용할 수 없어 기기의 기본 한국어 음성으로 안내합니다.';
      utterance=new SpeechSynthesisUtterance(String(text));
      utterance.voice=voice;utterance.lang=voice.lang||'ko-KR';
      // Heami's response was shallow at 0.7/1.0/1.4. Use wider engine
      // settings for this voice only; retain the saved semantic speed setting.
      var heami=/\bheami\b/i.test(String(voice.name||'')+' '+String(voice.voiceURI||''));
      utterance.rate=heami?(config.rate<1?.55:config.rate>1?2.4:1):config.rate;
      utterance.volume=config.voiceVolume;
      utterance.onend=finish;
      utterance.onerror=function(){failed('음성을 재생하지 못했습니다. 키오스크 관리에서 호출 소리를 확인해 주세요.');};
      timer=setTimeout(function(){
        if(finished)return;
        utterance.onerror=null;utterance.onend=null;
        try{window.speechSynthesis.cancel();}catch(_){}
        failed('음성 안내가 지연되어 다음 호출을 준비합니다.');
      },Math.min(45000,Math.max(15000,String(text).length*130/Math.min(config.rate,utterance.rate)+5000)));
      try{window.speechSynthesis.speak(utterance);}catch(_){failed('음성을 재생하지 못했습니다. 키오스크 관리에서 호출 소리를 확인해 주세요.');}
    }
    speechStop=cancelSpeech;
    cancelVoiceWait=waitForVoice(status,speak);
  };
  var present=window._fdPresentCall;
  window._fdPresentCall=function(payload,person){
    activeVoiceKey='';
    window.KIOSK_CALL_NAME=config.mode!=='chime';present(payload,person);
  };

  window.fdOpenCallSettings=function(){
    if(document.getElementById('kioskCallAudioOverlay'))return;
    var previous=document.activeElement,overlay=document.createElement('div');overlay.id='kioskCallAudioOverlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:50000;padding:12px;display:flex;align-items:center;justify-content:center;background:rgba(25,45,55,.4)';
    overlay.innerHTML='<style>#kioskCallAudioOverlay *{box-sizing:border-box}#kioskCallAudioDialog{width:540px;max-width:100%;max-height:100%;display:flex;flex-direction:column;border:1px solid #cbdde2;border-radius:20px;background:#fff;color:#243746;font-family:inherit;box-shadow:0 16px 45px #163c4f33;overflow:hidden}#kioskCallAudioDialog h2{font-size:21px;margin:0}#kioskCallAudioDialog p{font-size:14px;line-height:1.7;margin:10px 0}#kioskCallAudioDialog button{font:inherit;min-height:44px;border:1px solid #bfd6df;border-radius:10px;background:white;color:#244552;padding:9px 14px;max-width:100%;cursor:pointer}#kioskCallAudioDialog button:disabled{opacity:.5;cursor:default}#kioskCallAudioDialog :focus-visible{outline:3px solid #12a2c2;outline-offset:2px}#kioskCallAudioDialog .ka-body{padding:16px 20px;overflow:auto;min-height:0}#kioskCallAudioDialog .ka-actions{padding:12px 20px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #dfebef}#kioskCallAudioDialog .ka-primary{background:#0c839e;color:white;border-color:#0c839e}</style>'
      +'<section id="kioskCallAudioDialog" role="dialog" aria-modal="true" aria-labelledby="kioskCallAudioTitle"><header style="padding:18px 20px;background:#f1fbfd"><h2 id="kioskCallAudioTitle">호출 소리 확인</h2></header><div class="ka-body"><p data-ka-summary></p><p data-ka-voices></p><p>호출 방식·알림음·속도·음량은 오렌지톡의 키오스크 설정에서 변경합니다. 이름 안내는 이 기기의 기본 한국어 음성을 자동으로 사용합니다.</p><p>가상 학생으로 미리 듣습니다.<br><strong>3학년 1반 홍길동 학생, 보건실로 들어오세요.</strong></p><p data-ka-status role="status" aria-live="polite"></p></div><footer class="ka-actions"><button type="button" data-ka-test class="ka-primary">선택한 설정으로 미리 듣기</button><button type="button" data-ka-close>닫기</button></footer></section>';
    document.body.appendChild(overlay);
    var notice=overlay.querySelector('[data-ka-status]'),test=overlay.querySelector('[data-ka-test]');
    var modes={both:'이름 + 알림음',voice:'이름만',chime:'알림음만'};
    overlay.querySelector('[data-ka-summary]').textContent='현재 설정: '+modes[config.mode]+' / '+(config.chimeLabel||'기존 알림음')+' / '+(config.rate<1?'느리게':config.rate>1?'빠르게':'보통')+' / 알림음 '+Math.round(config.chimeVolume*100)+'% / 안내 목소리 '+Math.round(config.voiceVolume*100)+'%';
    function refresh(){var voice=chooseVoice('');overlay.querySelector('[data-ka-voices]').textContent=voice?'사용 음성: '+voice.name:'한국어 음성이 준비되지 않으면 화면과 설정한 음량의 알림음으로 안내합니다.';test.disabled=window._fdCallBusy;}
    test.addEventListener('click',function(){if(window._fdCallBusy)return;primeAudio();notice.textContent=config.volume===0?'현재 호출 방식의 음량이 0%여서 소리는 재생하지 않습니다.':'선택한 설정으로 가상 학생을 호출합니다.';window.fdShowNurseCall({test:true,person:{name:'홍길동',type:'student',grade:3,cls:1,num:1}});refresh();});
    var interval=setInterval(refresh,400);
    function close(){clearInterval(interval);document.removeEventListener('keydown',keys,true);overlay.remove();if(previous&&previous.isConnected)previous.focus();}
    function keys(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}if(event.key!=='Tab')return;var buttons=Array.prototype.slice.call(overlay.querySelectorAll('button:not(:disabled)')),first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&(document.activeElement===first||!overlay.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    overlay.querySelector('[data-ka-close]').addEventListener('click',close);document.addEventListener('keydown',keys,true);refresh();overlay.querySelector('[data-ka-close]').focus();
  };
  window.fdDisposeCallAudio=function(){
    disposed=true;window.fdStopCallChime();
    if(speechStop)speechStop();
    document.removeEventListener('pointerdown',primeAudio);document.removeEventListener('keydown',primeAudio);
  };
  window.addEventListener('pagehide',window.fdDisposeCallAudio);
}
