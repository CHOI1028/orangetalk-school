/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { S } from '../../core/app-state.js';
import { getStu, escHtml, closeModalGracefully, createEmptyState, saveRecordNow, toDateStr } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { _makeDraggable, _symRenderTreatPanel } from '../symptom/symptom-view.js';
import { getStuAutoLine } from '../../core/student-utils.js';
import { showVisitHistory, _hideVisitHistory } from '../daily/daily-view.js';

/* ═══════════════════════════════════════════════════════════════
   침상 관리 (Bed Management)
   ═══════════════════════════════════════════════════════════════ */

/* ── Config & State ── */
/* 침상 설정 로드 및 형식 정규화 */
S._bedConfigRaw = JSON.parse(localStorage.getItem('ec_bed_config')) || {beds:[{id:1}],placement:'left'};
if(S._bedConfigRaw.layout && !S._bedConfigRaw.placement){
  S._bedConfigRaw.placement='left';
  delete S._bedConfigRaw.layout;
  S._bedConfigRaw.beds.forEach(function(b){ delete b.label; });
  localStorage.setItem('ec_bed_config',JSON.stringify(S._bedConfigRaw));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','bed_config',S._bedConfigRaw);
}
S._bedConfig = S._bedConfigRaw;
S._bedUsage = JSON.parse(localStorage.getItem('ec_bed_usage')) || [];
let _bedAlarmInterval = null;
const _bedCountdownInterval = null;
let _bedAlarmAudio = null;

function _bedLabel(bed,idx){
  /* 자동 이름: "침상 1", "침상 2", ... */
  const i=typeof idx==='number'?idx:S._bedConfig.beds.indexOf(bed);
  return '침상 '+(i+1);
}
function _saveBedConfig(){
  localStorage.setItem('ec_bed_config',JSON.stringify(S._bedConfig));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','bed_config',S._bedConfig);
}
function _loadBedConfig(){
  const raw=JSON.parse(localStorage.getItem('ec_bed_config'))||{beds:[{id:1}],placement:'left'};
  S._bedConfig=raw;
}
function _saveBedUsage(){
  localStorage.setItem('ec_bed_usage',JSON.stringify(S._bedUsage));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','bed_usage',S._bedUsage);
  try{renderBedSidebarCard();}catch(e){}
}
function _loadBedUsage(){ S._bedUsage=JSON.parse(localStorage.getItem('ec_bed_usage'))||[]; }

/* 기록 삭제 시 그 기록에 연결된 침상 이용도 '삭제' (사라짐 아님). 사용자 요청 2026-06-10.
 *  daily-view 삭제 경로에서 bus.emit('bed:recordsDeleted',{ids:[...]}). usage.recordId 로 매칭. */
bus.on('bed:recordsDeleted', function(payload){
  try{
    const ids=(payload&&Array.isArray(payload.ids))?payload.ids:(payload&&payload.id!=null?[payload.id]:[]);
    if(!ids.length||!Array.isArray(S._bedUsage)||!S._bedUsage.length)return;
    const before=S._bedUsage.length;
    S._bedUsage=S._bedUsage.filter(function(u){ return !u || u.recordId==null || ids.indexOf(u.recordId)===-1; });
    if(S._bedUsage.length!==before) _saveBedUsage(); /* localStorage+dbSet+renderBedSidebarCard 까지 */
  }catch(_){}
});

/* 일반일지표에서 퇴실 시간(timeOut)을 수정하면 → 그 기록에 연결된 침상 이용의 종료 시각·남은 시간도 연동.
 *  (반대 방향 — 침상 picker → rec.timeOut — 은 _bedUpdateEndTimePreview 가 담당. 그쪽은 time-changed 를
 *   쏘지 않으므로 루프 없음.) diary-print-view 의 openTimePicker 가 bus.emit('record:time-changed',{recId}). 2026-06-15 */
bus.on('record:time-changed', function(payload){
  try{
    const recId=payload&&payload.recId;
    if(recId==null||!Array.isArray(S.records))return;
    _loadBedUsage();
    if(!Array.isArray(S._bedUsage)||!S._bedUsage.length)return;
    /* 침상 이용 매칭 — recordId 우선, 없으면 같은 학생·같은 날 시작분으로 폴백(release 핸들러와 동일) */
    const rec=S.records.find(function(r){return r.id===recId;});
    if(!rec||!rec.timeOut)return;
    let u=S._bedUsage.find(function(x){return x.recordId===recId;});
    if(!u && rec.studentId!=null){
      u=S._bedUsage.find(function(x){
        if(String(x.studentId)!==String(rec.studentId)||!x.startTime)return false;
        const _ds=new Date(x.startTime);
        const _ymd=_ds.getFullYear()+'-'+String(_ds.getMonth()+1).padStart(2,'0')+'-'+String(_ds.getDate()).padStart(2,'0');
        return _ymd===rec.date;
      });
    }
    if(!u)return;
    const m=/^(\d{1,2}):(\d{2})$/.exec(rec.timeOut);
    if(!m)return;
    const hh=parseInt(m[1],10), mm=parseInt(m[2],10);
    /* 침상 시작일(startTime) 기준 날짜에 HH:MM → 종료 timestamp. startTime 없으면 오늘. */
    const base=u.startTime?new Date(u.startTime):new Date();
    let endMs=new Date(base.getFullYear(),base.getMonth(),base.getDate(),hh,mm,0,0).getTime();
    /* 종료가 시작보다 이르면 자정 넘김으로 보고 +1일 */
    if(u.startTime && endMs<=u.startTime) endMs+=24*60*60*1000;
    if(endMs===u.endTime)return;
    u.endTime=endMs;
    u.alarmed=false;
    u.timerMode='endtime';
    _saveBedUsage(); /* localStorage+dbSet+renderBedSidebarCard 포함 */
    if(document.getElementById('bedManagerOverlay')&&typeof _bedRenderBody==='function')_bedRenderBody();
  }catch(e){console.warn('[bed] 퇴실시간→종료시각 연동 실패:',e);}
});

/* Remove expired usages on load and start alarm checker */
_bedCleanExpired();
_bedStartAlarmChecker();
/* 앱 시작 후 사이드바 카드 초기 렌더 (DOM 준비 후) */
if(typeof document!=='undefined'){
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){try{renderBedSidebarCard();}catch(e){}});
  }else{
    setTimeout(function(){try{renderBedSidebarCard();}catch(e){}},100);
  }
}

function _bedCleanExpired(){
  const now=Date.now();
  S._bedUsage=S._bedUsage.filter(function(u){ return u.endTime>now; });
  _saveBedUsage();
}

/* ── Alarm System (1-second interval for countdown + alarm check) ── */
function _bedStartAlarmChecker(){
  if(_bedAlarmInterval) clearInterval(_bedAlarmInterval);
  _bedAlarmInterval=setInterval(function(){
    const now=Date.now();
    const expired=S._bedUsage.filter(function(u){ return u.endTime<=now && !u.alarmed; });
    expired.forEach(function(u){
      u.alarmed=true;
      if(u.alarm) _bedShowAlarm(u);
    });
    if(expired.length>0) _saveBedUsage();
    /* 카운트다운 표시 갱신 (모달이 열려 있을 때) */
    const modal=document.getElementById('bedManagerOverlay');
    if(modal) _bedUpdateCountdowns();
  },1000);
}

/* 카운트다운 표시만 갱신 (전체 re-render 없이) */
function _bedUpdateCountdowns(){
  const isLight=document.body.classList.contains('light');
  const colonColor=isLight?'#0e7490':'#22d3ee';
  let needRerender=false;
  S._bedConfig.beds.forEach(function(bed,i){
    const usage=S._bedUsage.find(function(u){ return u.bedId===bed.id; });
    const cdEl=document.getElementById('bedCountdown_'+bed.id);
    if(!cdEl) return;
    if(!usage){
      /* bed is empty — leave gray 00:00 as is */
      return;
    }
    const diff=Math.max(0,usage.endTime-Date.now());
    if(diff<=0) { needRerender=true; return; }
    const tMode=usage.timerMode||'countdown';
    const mm=Math.floor(diff/60000);
    const ss=Math.floor((diff%60000)/1000);
    const mmStr=String(mm).padStart(2,'0');
    const ssStr=String(ss).padStart(2,'0');
    {
      /* 남은 시간 H:MM:SS 업데이트 */
      const _cdInner=cdEl.querySelector('.bed-cd-remain');
      const _rh=Math.floor(mm/60);const _rm=mm%60;
      const _rhStr=String(_rh);const _rmStr=String(_rm).padStart(2,'0');
      const newStr=_rhStr+_rmStr+ssStr;
      if(!_cdInner){
        _bedRenderBody();return;
      } else {
        const oldDigits=_cdInner.querySelectorAll('.flip-digit');
        let oldStr='';oldDigits.forEach(function(d){const sp=d.querySelector('span');if(sp)oldStr+=sp.textContent;});
        if(oldStr!==newStr){
          _cdInner.innerHTML=_bedFlipDigits(_rhStr,'cyan')+' <span style="font-size:16px;font-weight:900;color:'+colonColor+';margin:0 2px">:</span> '+_bedFlipDigits(_rmStr,'cyan')+' <span style="font-size:16px;font-weight:900;color:'+colonColor+';margin:0 2px">:</span> '+_bedFlipDigits(ssStr,'cyan');
          /* trigger flip animation on changed digits */
          const newDigitEls=_cdInner.querySelectorAll('.flip-digit');
          for(let di=0;di<Math.min(newStr.length,oldStr.length,newDigitEls.length);di++){
            if(oldStr[di]!==newStr[di]){
              const el=newDigitEls[di];
              el.classList.remove('flipping');
              void el.offsetWidth;
              el.classList.add('flipping');
            }
          }
        }
      }
    }
    /* 점유 정보 패널의 남은 시간 텍스트 갱신 */
    const remainEl=document.getElementById('bedRemainText_'+bed.id);
    if(remainEl) remainEl.textContent='\uB0A8\uC740 \uC2DC\uAC04: '+mm+'\uBD84 '+ss+'\uCD08';
    /* ── 잔여 시간 5분 이내 — 시계에 빨간 펄스 강조 ── */
    const totalSec = mm*60 + ss;
    if(totalSec > 0 && totalSec <= 300){
      cdEl.classList.add('bed-time-critical');
    } else {
      cdEl.classList.remove('bed-time-critical');
    }
  });
  if(needRerender) _bedRenderBody();
}

/* 플립 디짓 HTML 생성 (.flip-digit CSS 클래스 사용) */
function _bedFlipDigits(str,cls){
  return str.split('').map(function(d){
    return '<div class="flip-digit '+(cls||'')+'" style="width:20px;height:26px"><span style="font-size:16px">'+d+'</span></div>';
  }).join('');
}

function _bedShowAlarm(usage){
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='bedAlarmOverlay';
  ov.style.zIndex='10100';
  ov.style.background='rgba(0,0,0,0.5)';
  let bedLabel='침상';
  S._bedConfig.beds.forEach(function(b,i){ if(b.id===usage.bedId) bedLabel=_bedLabel(b,i); });
  ov.innerHTML='<div class="modal-content" style="width:380px;max-width:90vw;padding:0;text-align:center;overflow:hidden">'
    +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-radius:12px 12px 0 0;font-weight:800;font-size:15px;color:var(--t1)">⏰ 침상 이용 시간 종료</div>'
    +'<div style="padding:30px 20px">'
    +'<div style="font-size:40px;margin-bottom:12px">🔔</div>'
    +'<div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:8px">'+usage.studentName+' 학생</div>'
    +'<div style="font-size:13px;color:var(--t2);margin-bottom:6px">'+bedLabel+'</div>'
    +'<div style="font-size:13px;color:var(--t2)">침상 이용 시간이 종료되었습니다.</div>'
    +'</div>'
    +'<div style="padding:0 20px 20px"><button class="btn btn-primary btn-sm" data-action="dismissAlarm" style="width:100%">확인</button></div>'
    +'</div>';
  ov.addEventListener('click',function(e){ if(e.target===ov) _bedDismissAlarm(); });
  document.body.appendChild(ov);
  ov.querySelector('[data-action="dismissAlarm"]').addEventListener('click',function(){_bedDismissAlarm();});
  document.addEventListener('keydown',_bedAlarmEscHandler);
  /* play alarm audio based on per-bed selection */
  try{
    const alarmSel=usage.alarmSound||'random';
    let idx;
    if(alarmSel==='random') idx=Math.floor(Math.random()*4)+1;
    else idx=parseInt(alarmSel,10)||1;
    /* 실제 파일 재생 (1~3=mp3, 4=wav) */
    const audio=new Audio(_bedAlarmSrc(idx));
    audio.loop=true;
    audio.volume=1.0;
    _bedAlarmAudio=audio;
    audio.play().catch(function(){
      /* mp3 재생 실패 시 Web Audio 합성음 폴백 */
      let _alarmLoopActive=true;
      _bedAlarmAudio={stop:function(){_alarmLoopActive=false;if(_bedAudioStopFn){try{_bedAudioStopFn();}catch(e){}}}};
      function _playLoop(){
        if(!_alarmLoopActive)return;
        _bedPlaySyntheticAlarm(String(idx),function(){
          if(_alarmLoopActive)setTimeout(_playLoop,500);
        });
      }
      _playLoop();
    });
  }catch(e){}
  /* Auto-remove usage */
  S._bedUsage=S._bedUsage.filter(function(u){ return u.bedId!==usage.bedId||u.endTime!==usage.endTime; });
  _saveBedUsage();
}

function _bedAlarmEscHandler(e){
  if(e.key==='Escape') _bedDismissAlarm();
}
function _bedDismissAlarm(){
  if(_bedAlarmAudio){
    try{
      if(typeof _bedAlarmAudio.stop==='function')_bedAlarmAudio.stop();
      if(typeof _bedAlarmAudio.pause==='function'){_bedAlarmAudio.pause();_bedAlarmAudio.currentTime=0;}
    }catch(e){}
    _bedAlarmAudio=null;
  }
  const ov=document.getElementById('bedAlarmOverlay');
  if(ov) ov.remove();
  document.removeEventListener('keydown',_bedAlarmEscHandler);
  /* refresh bed manager if open */
  if(document.getElementById('bedManagerOverlay')) _bedRenderBody();
}

/* ── Bed Manager Modal ── */
let _bedCurrentStuId=null;

function openBedManager(stuId){
  _bedCurrentStuId=stuId;
  _loadBedConfig();
  _loadBedUsage();
  _bedCleanExpired();
  const existing=document.getElementById('bedManagerOverlay');
  if(existing) existing.remove();
  const stu=getStu(stuId);
  const stuName=stu?stu.name:'';
  let stuDesc='';
  if(stu){
    /* 표준 소속 표기 (사용자 요청 2026-06-11) — 학과 있으면 "항공기계과 3학년 2반 14번",
     *  다중 학교급이면 "고 3학년 2반 14번", 단일이면 "3학년 2반 14번". getStuAutoLine 공용. */
    stuDesc=getStuAutoLine(stu)+' '+stu.name;
  }
  const direction=S._bedConfig.direction||'row';
  const modalW=direction==='col'?'700px':'600px';
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='bedManagerOverlay';
  ov.style.zIndex='10050';
  /* 중앙 정렬 시 콘텐츠가 길어지면 아래 확인 버튼이 화면 밖으로 밀려나는 문제가 있어 상단에서 내려 배치 */
  ov.style.alignItems='flex-start';
  ov.style.paddingTop='13vh';
  ov.innerHTML='<div class="modal-content" style="width:'+modalW+';max-width:94vw;max-height:92vh;padding:0;overflow-y:auto;scrollbar-width:thin">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-radius:12px 12px 0 0;position:sticky;top:0;z-index:1">'
    +'<span style="font-size:15px;font-weight:800;color:var(--t1)">🛏 침상 이용 등록</span>'
    +'<span style="font-size:12px;color:var(--t3)">'+stuDesc+'</span>'
    +'</div>'
    +'<div id="bedManagerBody" style="padding:20px"></div>'
    +'<div id="bedConfigBtnWrap" style="padding:0 20px 16px;display:flex;justify-content:flex-end">'
    +'<button class="btn btn-sm" data-action="openBedConfig" style="font-size:11px;color:#f97316;background:rgba(249,115,22,0.10);border:1px solid rgba(249,115,22,0.4);font-weight:700">⚙ 침상 구성 (개수 설정)</button>'
    +'</div></div>';
  ov.addEventListener('click',function(e){
    /* 침상 구성 팝업이 열려 있으면 그것이 먼저 닫히도록 — bedManager 유지 */
    if(document.getElementById('bedConfigOverlay'))return;
    if(e.target===ov) _bedCloseManager();
  });
  document.body.appendChild(ov);
  ov.querySelector('[data-action="openBedConfig"]').addEventListener('click',function(){openBedConfig();});
  _makeDraggable(ov.querySelector('.modal-content'));
  /* 기본 선택을 '점유 안 된 첫 침상'으로 — 기존 사용 중(맨 위) 침상이 아니라 빈 침상에 테두리·picker 가도록. 사용자 요청 2026-06-10.
   *  빈 침상이 없으면(전부 점유) 종전대로 그냥 렌더. */
  {
    const _beds=(S._bedConfig&&Array.isArray(S._bedConfig.beds))?S._bedConfig.beds:[];
    const _free=_beds.find(function(b){ return !S._bedUsage.find(function(u){return u.bedId===b.id;}); });
    if(_free) _bedAssign(_free.id); else _bedRenderBody();
  }
  /* 바깥 클릭 닫기 — modal-content 드래그로 옮긴 뒤에도 작동하도록 document 캡처 리스너 추가 */
  setTimeout(function(){
    function _mgrOutsideClose(e){
      const curOv=document.getElementById('bedManagerOverlay');
      if(!curOv){document.removeEventListener('mousedown',_mgrOutsideClose,true);return;}
      /* 침상 구성 / 담임·교과 메시지 팝업이 열려 있으면 그것이 먼저 처리 — bedManager 유지 */
      if(document.getElementById('bedConfigOverlay'))return;
      if(document.getElementById('bedTeacherMsgOverlay'))return;
      const modal=curOv.querySelector('.modal-content');
      if(!modal)return;
      if(modal.contains(e.target))return; /* 팝업 안 클릭은 무시 */
      _bedCloseManager();
      document.removeEventListener('mousedown',_mgrOutsideClose,true);
    }
    document.addEventListener('mousedown',_mgrOutsideClose,true);
  },50);
}

/* 침상 이용 등록 팝업 닫기 — 부드러운 애니메이션 */
function _bedCloseManager(){
  const ov=document.getElementById('bedManagerOverlay');
  if(!ov||ov._closing)return;
  /* 확인 없이(취소·바깥클릭) 닫으면 = 침상 등록 안 함 → symptom-view 가 추가했던 '침상 안정' 칩과
   *  미리보기로 +N분 바뀐 퇴실시간을 원복하도록 신호. (확인 시엔 _bedConfirmAssign 가 pending 을
   *  미리 null 로 비워 여기 안 걸림.) 사용자 보고 2026-06-15: 취소해도 칩이 남고 퇴실시간이 +30분으로 잡힘. */
  if(S._pendingBedRestRecId!=null){
    const _cancelRecId=S._pendingBedRestRecId;
    S._pendingBedRestRecId=null;
    try{ bus.emit('bed:addCancelled',{recId:_cancelRecId}); }catch(_){}
  }
  ov._closing=true;
  const modal=ov.querySelector('.modal-content');
  if(modal){
    modal.style.transition='opacity 0.22s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)';
    modal.style.opacity='0';
    modal.style.transform='scale(0.94) translateY(8px)';
  }
  ov.style.transition='opacity 0.22s ease';
  ov.style.opacity='0';
  setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},230);
}

function _bedFormatStuInfo(usage){
  /* Format student info: staff → "직위 이름", student → "학년-반 번호번 이름" */
  if(usage && usage.studentId){
    const s=getStu(usage.studentId);
    if(s && s.type==='staff') return (s.position||'교직원')+' '+s.name;
    if(s && s.grade) return s.grade+'-'+s.cls+' '+s.num+'번 '+s.name;
  }
  return usage?usage.studentName:'';
}

function _bedFlipClockHtml(bedId,mmStr,ssStr,occupied,isLight,timerMode,endTime){
  /* Build flip clock for a single bed */
  const colonColor=isLight?'#0e7490':'#22d3ee';
  let html='<div id="bedCountdown_'+bedId+'" data-timer-mode="'+(timerMode||'countdown')+'" data-end-time="'+(endTime||0)+'" style="text-align:center">';
  const _col2=isLight?'#94a3b8':'#475569';
  if(occupied){
    /* 남은 시간: H:MM:SS */
    const _rh=Math.floor(parseInt(mmStr)/60);const _rm=parseInt(mmStr)%60;const _rs=parseInt(ssStr);
    const _rmStr=String(_rm).padStart(2,'0');const _rsStr=String(_rs).padStart(2,'0');
    html+='<div style="display:flex;align-items:flex-end;gap:24px">';
    /* 남은 시간 */
    html+='<div style="text-align:center"><div style="font-size:7px;color:var(--t3);margin-bottom:1px">남은 시간</div>';
    html+='<div class="bed-cd-remain" style="display:flex;align-items:center;justify-content:center;gap:1px">'+_bedFlipDigits(String(_rh),'cyan')+' <span style="font-size:14px;font-weight:900;color:'+colonColor+';margin:0 1px">:</span> '+_bedFlipDigits(_rmStr,'cyan')+' <span style="font-size:14px;font-weight:900;color:'+colonColor+';margin:0 1px">:</span> '+_bedFlipDigits(_rsStr,'cyan')+'</div></div>';
    /* 종료 시간 */
    if(endTime){
      const ed=new Date(endTime);
      const hh=String(ed.getHours()).padStart(2,'0');
      const mi=String(ed.getMinutes()).padStart(2,'0');
      html+='<div style="text-align:center"><div style="font-size:7px;color:var(--t3);margin-bottom:1px">종료 시각</div>';
      html+='<div style="display:flex;align-items:center;justify-content:center;gap:1px">'+_bedFlipDigits(hh,'purple')+' <span style="font-size:10px;font-weight:900;color:'+colonColor+';margin:0 1px">:</span> '+_bedFlipDigits(mi,'purple')+'</div></div>';
    }
    /* 퇴실 */
    html+='<button data-action="bedRelease" data-bed-id="'+bedId+'" style="padding:0 8px;font-size:9px;font-weight:700;background:rgba(239,68,68,0.08);color:#dc2626;border:1px solid rgba(239,68,68,0.25);border-radius:5px;cursor:pointer;font-family:var(--f);transition:all .15s;flex-shrink:0;height:26px;display:flex;align-items:center">퇴실</button>';
    html+='</div>';
  } else {
    /* 빈 침상: 0:00:00 + 종료 시간 0:00 (보라색) */
    const _purpleCol=isLight?'#7c3aed':'#c084fc';
    html+='<div style="display:flex;align-items:flex-end;gap:24px">';
    html+='<div style="text-align:center"><div style="font-size:7px;color:var(--t3);margin-bottom:1px">남은 시간</div><div style="display:flex;align-items:center;justify-content:center;gap:1px">'+_bedFlipDigits('0','')+' <span style="font-size:14px;font-weight:900;color:'+_col2+';margin:0 1px">:</span> '+_bedFlipDigits('00','')+' <span style="font-size:14px;font-weight:900;color:'+_col2+';margin:0 1px">:</span> '+_bedFlipDigits('00','')+'</div></div>';
    html+='<div style="text-align:center"><div style="font-size:7px;color:'+_purpleCol+';margin-bottom:1px">종료 시각</div><div style="display:flex;align-items:center;justify-content:center;gap:1px">'+_bedFlipDigits('00','purple')+' <span style="font-size:10px;font-weight:900;color:'+_purpleCol+';margin:0 1px">:</span> '+_bedFlipDigits('00','purple')+'</div></div>';
    html+='<button disabled style="padding:0 8px;font-size:9px;font-weight:700;background:var(--bg2);color:var(--t3);border:1px solid var(--bdr);border-radius:5px;cursor:default;opacity:0.5;flex-shrink:0;height:26px;display:flex;align-items:center">퇴실</button>';
    html+='</div>';
  }
  html+='</div>';
  return html;
}

function _bedRenderBody(){
  /* 좌측 사이드바 침상 이용 카드도 함께 갱신 */
  try{renderBedSidebarCard();}catch(e){}
  const body=document.getElementById('bedManagerBody');
  if(!body) return;
  const placement=S._bedConfig.placement||'left';
  const isLight=document.body.classList.contains('light');
  const direction=S._bedConfig.direction||'row'; /* row=가로, col=세로 */
  /* Dynamically adjust modal width based on direction */
  const modalContent=body.closest('.modal-content');
  if(modalContent) modalContent.style.width=direction==='col'?'700px':'95vw';
  if(modalContent&&direction==='row') modalContent.style.maxWidth='1400px';
  let html='';
  /* 빈 상태 — 침상 0개 시 안내 */
  if(!S._bedConfig.beds || S._bedConfig.beds.length===0){
    body.innerHTML = createEmptyState({
          icon:'🛏',
          title:'설정된 침상이 없습니다',
          desc:'아래 [침상 구성] 버튼을 눌러 침상을 추가해 주세요.',
          actionLabel:'⚙ 침상 구성',
          actionFn:'openBedConfig()'
        });
    return;
  }

  /* 현재 선택된 학생이 이미 다른 침상 이용 중인가? — 빈 침상 비활성화 조건 */
  const _curStuOnBed=_bedCurrentStuId ? !!S._bedUsage.find(function(u){return u.studentId===_bedCurrentStuId;}) : false;

  if(direction==='col'){
    /* ── 세로 배치: beds stacked vertically, each bed+clock side by side ── */
    html+='<div style="display:flex;flex-direction:column;gap:8px">';
    S._bedConfig.beds.forEach(function(bed,i){
      const usage=S._bedUsage.find(function(u){ return u.bedId===bed.id; });
      const occupied=!!usage;
      const label=_bedLabel(bed,i);
      const stuInfo=occupied?_bedFormatStuInfo(usage):'';
      const diff=occupied?Math.max(0,usage.endTime-Date.now()):0;
      const mm=Math.floor(diff/60000);
      const ss=Math.floor((diff%60000)/1000);
      const mmStr=String(mm).padStart(2,'0');
      const ssStr=String(ss).padStart(2,'0');

      /* Row: bed card + flip clock, order depends on placement */
      const bedSide=placement==='right'?'row-reverse':'row';
      html+='<div style="display:flex;flex-direction:'+bedSide+';align-items:center;justify-content:space-evenly;width:100%">';

      /* Bed card — rectangular, wide */
      const _isSelCol=_bedCurrentBedId===bed.id;
      const _selStyleCol=_isSelCol?'border:2.5px solid var(--cyan);background:rgba(6,182,212,0.08);box-shadow:0 0 0 3px rgba(6,182,212,0.15);':'';
      const _bedDisabledCol=!occupied&&_curStuOnBed;
      const _disStyleCol=_bedDisabledCol?'border:2px dashed var(--bdr);background:var(--card);opacity:0.45;cursor:not-allowed;filter:grayscale(0.4);':'';
      html+='<div data-action="bedCard" data-bed-id="'+bed.id+'" data-occupied="'+(occupied?'1':'0')+'" data-disabled="'+(_bedDisabledCol?'1':'0')+'" style="'
        +'width:250px;height:55px;display:flex;align-items:center;padding:0 16px;border-radius:10px;cursor:pointer;transition:all 0.15s;flex-shrink:0;'
        +(_isSelCol
          ?_selStyleCol
          :(occupied
            ?'border:2px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.04);'
            :(_bedDisabledCol
              ?_disStyleCol
              :'border:2px dashed var(--bdr);background:var(--card);')))
        +'">'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:2px">'+label+'</div>';
      if(occupied){
        html+='<div style="font-size:12px;color:var(--t1);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+stuInfo+'</div>';
      } else {
        html+='<div style="font-size:11px;color:var(--t2)">비어있음</div>';
      }
      html+='</div></div>';

      /* Flip clock next to this bed */
      const bedTimerMode=occupied&&usage.timerMode?usage.timerMode:'countdown';
      html+='<div style="flex-shrink:0;text-align:center">';
      html+=_bedFlipClockHtml(bed.id,mmStr,ssStr,occupied,isLight,bedTimerMode,occupied?usage.endTime:0);

      html+='</div>';

      html+='</div>';
    });
    html+='</div>';
  } else {
    /* ── 가로 배치: beds in a horizontal row, each bed is a rectangle ── */
    html+='<div style="display:flex;flex-wrap:nowrap;justify-content:space-evenly;overflow-x:auto;width:100%">';
    S._bedConfig.beds.forEach(function(bed,i){
      const usage=S._bedUsage.find(function(u){ return u.bedId===bed.id; });
      const occupied=!!usage;
      const label=_bedLabel(bed,i);
      const stuInfo=occupied?_bedFormatStuInfo(usage):'';
      const diff=occupied?Math.max(0,usage.endTime-Date.now()):0;
      const mm=Math.floor(diff/60000);
      const ss=Math.floor((diff%60000)/1000);
      const mmStr=String(mm).padStart(2,'0');
      const ssStr=String(ss).padStart(2,'0');

      /* Each bed: card with clock below */
      html+='<div style="display:flex;flex-direction:column;align-items:center;gap:10px">';

      /* Bed card — horizontal rectangle */
      const _isSelRow=_bedCurrentBedId===bed.id;
      const _selStyleRow=_isSelRow?'border:2.5px solid var(--cyan);background:rgba(6,182,212,0.08);box-shadow:0 0 0 3px rgba(6,182,212,0.15);':'';
      const _bedDisabledRow=!occupied&&_curStuOnBed;
      const _disStyleRow=_bedDisabledRow?'border:2px dashed var(--bdr);background:var(--card);opacity:0.45;cursor:not-allowed;filter:grayscale(0.4);':'';
      html+='<div data-action="bedCard" data-bed-id="'+bed.id+'" data-occupied="'+(occupied?'1':'0')+'" data-disabled="'+(_bedDisabledRow?'1':'0')+'" style="'
        +'width:140px;height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 10px;border-radius:10px;cursor:pointer;transition:all 0.15s;'
        +(_isSelRow
          ?_selStyleRow
          :(occupied
            ?'border:2px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.04);'
            :(_bedDisabledRow
              ?_disStyleRow
              :'border:2px dashed var(--bdr);background:var(--card);')))
        +'">'
        +'<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:2px">'+label+'</div>';
      if(occupied){
        html+='<div style="font-size:11px;color:var(--t1);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">'+stuInfo+'</div>';
      } else {
        html+='<div style="font-size:10px;color:var(--t2)">비어있음</div>';
      }
      html+='</div>';

      /* Flip clock below bed */
      const bedTimerMode=occupied&&usage.timerMode?usage.timerMode:'countdown';
      html+=_bedFlipClockHtml(bed.id,mmStr,ssStr,occupied,isLight,bedTimerMode,occupied?usage.endTime:0);
      /* 아래 라벨 제거됨 */

      html+='</div>';
    });
    html+='</div>';
  }

  /* Timer mode toggle removed from main view — mode is per-bed now */

  /* inline time picker area */
  html+='<div id="bedTimePicker" style="display:none;margin-top:16px;padding:16px;border:1px solid var(--bdr);border-radius:10px;background:var(--bg2)"></div>';
  body.innerHTML=html;
  /* event delegation for bed body */
  body.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const action=el.dataset.action;
    const bedId=parseInt(el.dataset.bedId,10);
    if(action==='bedCard'){
      e.stopPropagation();
      /* 학생이 이미 다른 침상 이용 중이면 빈 침상 클릭 차단 + 안내 토스트 */
      if(el.dataset.disabled==='1'){
        const stu=getStu(_bedCurrentStuId);
        const stuOnBed=S._bedUsage.find(function(u){return u.studentId===_bedCurrentStuId;});
        let bl='';
        if(stuOnBed) S._bedConfig.beds.forEach(function(b,i){if(b.id===stuOnBed.bedId) bl=_bedLabel(b,i);});
        bus.emit('toast:show', {text:(stu?stu.name:'해당 학생')+'은(는) 이미 '+bl+' 이용 중입니다'});
        return;
      }
      if(el.dataset.occupied==='1')_bedShowOccupied(bedId);
      else _bedAssign(bedId);
    } else if(action==='bedRelease'){
      e.stopPropagation();
      _bedRelease(bedId);
    }
  });
  /* hover effect for release buttons */
  body.querySelectorAll('[data-action="bedRelease"]').forEach(function(btn){
    btn.addEventListener('mouseenter',function(){this.style.background='rgba(239,68,68,0.15)';});
    btn.addEventListener('mouseleave',function(){this.style.background='rgba(239,68,68,0.08)';});
  });
}

/* _bedToggleTimerMode removed — timer mode is now per-bed, set in the assign picker */

/* ── Assign student to bed (duration picker with scroll wheels + analog clock) ── */
let _bedPickerHour=0, _bedPickerMin=30;
let _bedPickerTimerMode='countdown';
let _bedPickerAlarmSound='random';
let _bedAnalogDragging=null; /* 'hour' or 'minute' or null */
let _bedEditingBedId=null; /* non-null when editing an occupied bed */
let _bedCurrentBedId=null; /* 현재 선택 중인 침상 ID */

/* Attach event listeners to picker after innerHTML is set */
function _bedAttachPickerEvents(picker){
  picker.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const action=el.dataset.action;
    const bedId=parseInt(el.dataset.bedId,10);
    if(action==='wheelClickToType'){_bedWheelClickToType(el,el.dataset.wheelId,el.dataset.suffix);}
    else if(action==='timerMode'){_bedSetPickerTimerMode(el.dataset.mode,bedId);}
    else if(action==='togglePreview'){_bedTogglePreview(el.dataset.num,el);}
    else if(action==='confirmEdit'){_bedConfirmEdit(bedId);}
    else if(action==='pickerRelease'){_bedRelease(bedId);}
    else if(action==='cancelPicker'){_bedCancelPicker();}
    else if(action==='confirmAssign'){_bedConfirmAssign(bedId);}
    else if(action==='teacherMsg'){_bedTeacherMsgFromPicker();}
  });
  picker.querySelectorAll('[data-action="alarmSound"]').forEach(function(radio){
    radio.addEventListener('change',function(){_bedSetAlarmSound(this.value);});
  });
}

function _bedAssign(bedId){
  const body=document.getElementById('bedManagerBody');
  if(!body) return;
  /* 기본 — 현재 시각 +30분 의 종료 시각 기준으로 초기화 (사용자 요청 2026-05-18) */
  _bedPickerTimerMode='endtime';
  {
    const _n=new Date(); _n.setMinutes(_n.getMinutes()+30);
    _bedPickerHour=_n.getHours(); _bedPickerMin=_n.getMinutes();
  }
  _bedPickerAlarmSound='random';
  _bedEditingBedId=null;
  _bedCurrentBedId=bedId;
  let label='';
  S._bedConfig.beds.forEach(function(b,i){ if(b.id===bedId) label=_bedLabel(b,i); });
  const stu=getStu(_bedCurrentStuId);
  let stuDesc='';
  if(stu){
    stuDesc=getStuAutoLine(stu)+' '+stu.name; /* \uD45C\uC900 \uC18C\uC18D \uD45C\uAE30 \u2014 \uD5E4\uB354\uC640 \uB3D9\uC77C (2026-06-11) */
  }
  /* 1) 침상 테두리부터 업데이트 (picker 요소를 포함해서 body 전체 재렌더) */
  _bedRenderBody();
  /* 2) 재렌더 이후의 picker 요소를 다시 조회 (이전 참조는 무효화됨) */
  const picker=document.getElementById('bedTimePicker');
  if(!picker) return;
  /* 침상 구성(개수 설정) 버튼은 picker 중에도 계속 보이게 — 침상 흐름에서 '뒤로'는 확인 모달로 가므로
   *  그리드를 안 거쳐도 침상 개수 설정이 항상 가능해야 함 (사용자 요청 2026-06-24) */
  const cfgBtn=document.getElementById('bedConfigBtnWrap');if(cfgBtn)cfgBtn.style.display='';
  _bedPreviewInitDone=false;
  picker.innerHTML=_bedBuildDurationPicker(bedId,label,stuDesc,false);
  picker.style.display='block';
  _bedAttachPickerEvents(picker);
  _bedUpdateEndTimePreview();
  setTimeout(function(){_bedPreviewInitDone=true;},100);
  _bedAttachWheelEvents();
  _bedDrawAnalogClock();
  _bedAttachAnalogDrag();
  picker.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function _bedSetPickerTimerMode(mode,bedId){
  const prevMode=_bedPickerTimerMode;
  _bedPickerTimerMode=mode;
  /* 모드 전환 시 값 변환 */
  if(prevMode==='countdown'&&mode==='endtime'){
    const _n=new Date();const _e=new Date(_n.getTime()+(_bedPickerHour*60+_bedPickerMin)*60000);
    _bedPickerHour=_e.getHours();_bedPickerMin=_e.getMinutes();
  } else if(prevMode==='endtime'&&mode==='countdown'){
    const _n2=new Date();let _diff=(_bedPickerHour*60+_bedPickerMin)-(_n2.getHours()*60+_n2.getMinutes());
    if(_diff<0)_diff+=24*60;
    _bedPickerHour=Math.floor(_diff/60);_bedPickerMin=_diff%60;
  }
  /* 버튼 스타일 업데이트 */
  const cdBtn=document.getElementById('bedTimerModeCD');
  const etBtn=document.getElementById('bedTimerModeET');
  if(cdBtn&&etBtn){
    const onStyle='background:var(--cyan);color:#fff';
    const offStyle='background:transparent;color:var(--t1)';
    cdBtn.setAttribute('style','padding:4px 12px;cursor:pointer;font-size:10px;font-weight:600;transition:all 0.2s;border:none;border-radius:0;'+(mode==='countdown'?onStyle:offStyle));
    etBtn.setAttribute('style','padding:4px 12px;cursor:pointer;font-size:10px;font-weight:600;transition:all 0.2s;border:none;border-radius:0;'+(mode==='endtime'?onStyle:offStyle));
  }
  /* 스크롤 휠 전체 리렌더 (시+분 모두) */
  const hWheel=document.getElementById('bedWheelH');
  if(hWheel){
    const suffix=mode==='endtime'?'시':'시간';
    const maxVal=mode==='endtime'?23:5;
    const newItems=[];for(let v=0;v<=maxVal;v++)newItems.push(v);
    hWheel.dataset.items=JSON.stringify(newItems);
    let ci=newItems.indexOf(_bedPickerHour);if(ci<0)ci=0;
    hWheel.dataset.index=ci;
    _bedRerenderWheel(hWheel,newItems,ci,suffix);
  }
  const mWheel=document.getElementById('bedWheelM');
  if(mWheel){
    const mItems=JSON.parse(mWheel.dataset.items);
    let mci=mItems.indexOf(_bedPickerMin);if(mci<0)mci=0;
    mWheel.dataset.index=mci;
    _bedRerenderWheel(mWheel,mItems,mci,'분');
  }
  /* 아날로그 시계 + 미리보기 갱신 */
  _bedDrawAnalogClock();
  _bedUpdateEndTimePreview();
}

function _bedSetAlarmSound(val){
  _bedPickerAlarmSound=val;
  const radios=document.querySelectorAll('input[name="bedAlarmSound"]');
  radios.forEach(function(r){ r.checked=(r.value===val); });
}
let _bedPreviewAudio=null;
let _bedPreviewPlaying=null; /* 현재 재생 중인 버튼 */
/* 알람음 파일 경로 — 1~3 은 .mp3, 4 는 .wav (사용자 추가 2026-06-18) */
function _bedAlarmSrc(idx){ const n=String(idx); return './assets/sounds/alarm_'+n+(n==='4'?'.wav':'.mp3'); }
/* Web Audio API 기반 합성 알람음 — mp3 파일 없이 작동 */
let _bedAudioCtx=null;
let _bedAudioStopFn=null;
function _bedPlaySyntheticAlarm(preset,onEnd){
  try{
    if(!_bedAudioCtx){_bedAudioCtx=new (window.AudioContext||window.webkitAudioContext)();}
    const ctx=_bedAudioCtx;
    if(ctx.state==='suspended')ctx.resume();
    /* preset: 1=부드러운 차임, 2=긴급 비프, 3=3톤 멜로디 */
    const presets={
      '1':{freqs:[880,1108,1318],pattern:[0.2,0.1,0.2,0.1,0.4],type:'sine'},  /* A5-C#6-E6 */
      '2':{freqs:[1400,900,1400],pattern:[0.15,0.08,0.15,0.08,0.15,0.08,0.15],type:'square'},  /* 긴급 */
      '3':{freqs:[659,784,987,784],pattern:[0.25,0.25,0.25,0.25,0.5],type:'triangle'},  /* E5-G5-B5-G5 */
      '4':{freqs:[523,659,784,1046],pattern:[0.22,0.22,0.22,0.34,0.5],type:'sine'}  /* C5-E5-G5-C6 상승 차임 */
    };
    const p=presets[preset]||presets['1'];
    const now=ctx.currentTime;
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type=p.type;
    osc.connect(gain);gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0,now);
    let t=now;
    let fi=0;
    p.pattern.forEach(function(dur,i){
      const f=p.freqs[fi%p.freqs.length];fi++;
      osc.frequency.setValueAtTime(f,t);
      if(i%2===0){
        gain.gain.linearRampToValueAtTime(0.25,t+0.01);
        gain.gain.setValueAtTime(0.25,t+dur-0.02);
        gain.gain.linearRampToValueAtTime(0,t+dur);
      }
      t+=dur;
    });
    osc.start(now);
    osc.stop(t+0.05);
    _bedAudioStopFn=function(){try{osc.stop(ctx.currentTime);}catch(e){}};
    osc.onended=function(){_bedAudioStopFn=null;if(onEnd)onEnd();};
  }catch(e){
    bus.emit('toast:show', {text: '오디오 재생을 지원하지 않는 환경입니다.'});
    if(onEnd)onEnd();
  }
}
function _bedTogglePreview(num,btn){
  /* 이미 이 버튼이 재생 중이면 정지 */
  if(_bedPreviewPlaying===btn){
    _bedStopPreview();
    return;
  }
  _bedStopPreview();
  /* 미리보기 클릭 시 해당 알람음을 자동 선택 (라디오도 같이 갱신) */
  _bedPickerAlarmSound=String(num);
  const radios=document.querySelectorAll('input[name="bedAlarmSound"]');
  radios.forEach(function(r){r.checked=(r.value===String(num));});
  const preset=num==='random'?String(Math.floor(Math.random()*4)+1):String(num);
  _bedPreviewPlaying=btn;
  btn.textContent=num==='random'?'⏹ 랜덤':'⏹ '+num;
  btn.style.background='var(--cyan)';btn.style.color='#fff';btn.style.borderColor='var(--cyan)';
  /* 파일 우선 재생 (1~3=mp3, 4=wav) */
  const audio=new Audio(_bedAlarmSrc(preset));
  audio.volume=1.0;
  _bedPreviewAudio=audio;
  audio.addEventListener('ended',function(){
    _bedResetPreviewBtn(btn,num);
    _bedPreviewPlaying=null;
    _bedPreviewAudio=null;
  });
  audio.play().catch(function(){
    /* mp3 실패 시 합성음 폴백 */
    _bedPreviewAudio=null;
    _bedPlaySyntheticAlarm(preset,function(){
      _bedResetPreviewBtn(btn,num);
      _bedPreviewPlaying=null;
    });
  });
}
function _bedStopPreview(){
  if(_bedAudioStopFn){try{_bedAudioStopFn();}catch(e){}_bedAudioStopFn=null;}
  if(_bedPreviewAudio){try{_bedPreviewAudio.pause();_bedPreviewAudio.currentTime=0;}catch(e){}}
  if(_bedPreviewPlaying){
    const btn=_bedPreviewPlaying;
    const num=btn.textContent.replace('⏹ ','').replace('▶ ','');
    if(btn.textContent.indexOf('랜덤')>=0) _bedResetPreviewBtn(btn,'random');
    else _bedResetPreviewBtn(btn,num);
  }
  _bedPreviewAudio=null;_bedPreviewPlaying=null;
}
function _bedResetPreviewBtn(btn,num){
  btn.textContent=num==='random'?'🎲 랜덤':'▶ '+num;
  btn.style.background='var(--bg)';btn.style.color='var(--t2)';btn.style.borderColor='var(--bdr)';
}

function _bedBuildDurationPicker(bedId,label,stuDesc,isEdit){
  const isLight=document.body.classList.contains('light');
  const bgColor=isLight?'#f1f5f9':'#1e293b';
  const textColor=isLight?'#0e7490':'#22d3ee';
  const dimColor=isLight?'rgba(0,0,0,0.15)':'rgba(255,255,255,0.2)';
  const activeColor=isLight?'#0e7490':'#fff';
  const dimText=isLight?'rgba(0,0,0,0.25)':'rgba(255,255,255,0.35)';
  const midText=isLight?'rgba(0,0,0,0.4)':'rgba(255,255,255,0.6)';

  function wheelHtml(id,val,max,step,suffix){
    const items=[];for(let v=0;v<=max;v+=step)items.push(v);
    let ci=items.indexOf(val);if(ci<0)ci=0;
    const prev2=ci>=2?items[ci-2]:null;
    const prev1=ci>=1?items[ci-1]:null;
    const next1=ci<items.length-1?items[ci+1]:null;
    const next2=ci<items.length-2?items[ci+2]:null;
    let h='<div id="'+id+'" data-items="'+JSON.stringify(items).replace(/"/g,'&quot;')+'" data-index="'+ci+'" style="display:flex;flex-direction:column;align-items:center;width:80px;user-select:none;cursor:ns-resize;padding:4px 0">';
    h+='<div style="font-size:11px;color:'+dimText+';line-height:2;height:22px;white-space:nowrap">'+(prev2!==null?prev2+suffix:'')+'</div>';
    h+='<div style="font-size:14px;color:'+midText+';line-height:2;height:28px;white-space:nowrap">'+(prev1!==null?prev1+suffix:'')+'</div>';
    h+='<div class="bedWheelCenter" data-action="wheelClickToType" data-wheel-id="'+id+'" data-suffix="'+suffix+'" style="font-size:22px;font-weight:800;color:'+activeColor+';line-height:1.4;border-top:1px solid '+dimColor+';border-bottom:1px solid '+dimColor+';padding:4px 0;min-width:60px;text-align:center;cursor:pointer;white-space:nowrap">'+val+suffix+'</div>';
    h+='<div style="font-size:14px;color:'+midText+';line-height:2;height:28px;white-space:nowrap">'+(next1!==null?next1+suffix:'')+'</div>';
    h+='<div style="font-size:11px;color:'+dimText+';line-height:2;height:22px;white-space:nowrap">'+(next2!==null?next2+suffix:'')+'</div>';
    h+='</div>';
    return h;
  }

  /* Header: title left, pill-style timer mode toggle right */
  const cdOn=_bedPickerTimerMode==='countdown';
  let html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
    +'<div>'
    +'<div style="font-size:14px;font-weight:700;color:var(--t1)">'+(isEdit?'\uC774\uC6A9 \uC2DC\uAC04 \uBCC0\uACBD':'이용 시간 설정')+' '+label+'</div>'
    +'<div style="font-size:11px;color:var(--t3);margin-top:2px">'+stuDesc+'</div>'
    +'</div>'
    +'<div style="display:inline-flex;border:1px solid var(--bdr);border-radius:20px;overflow:hidden;font-size:10px">'
    +'<span id="bedTimerModeCD" data-action="timerMode" data-mode="countdown" data-bed-id="'+bedId+'" style="padding:4px 12px;cursor:pointer;font-size:10px;font-weight:600;transition:all 0.2s;border:none;border-radius:0;'+(cdOn?'background:var(--cyan);color:#fff':'background:transparent;color:var(--t1)')+'">남은 시간 기준</span>'
    +'<span id="bedTimerModeET" data-action="timerMode" data-mode="endtime" data-bed-id="'+bedId+'" style="padding:4px 12px;cursor:pointer;font-size:10px;font-weight:600;transition:all 0.2s;border:none;border-radius:0;'+(!cdOn?'background:var(--cyan);color:#fff':'background:transparent;color:var(--t1)')+'">종료 시각 기준</span>'
    +'</div>'
    +'</div>';

  /* Main content: scroll wheels on left, analog clock on right */
  html+='<div style="display:flex;align-items:center;justify-content:center;gap:20px;padding:16px;border-radius:10px;background:'+bgColor+';margin-bottom:12px">';

  /* Left: scroll wheels — 모드에 따라 시간/시각 전환 */
  const _isEndtime=_bedPickerTimerMode==='endtime';
  html+='<div style="display:flex;flex-direction:column;align-items:center">'
    +'<div style="font-size:9px;color:var(--t1);margin-bottom:4px">'+(_isEndtime?'종료 시각 설정':'스크롤 / 숫자 입력으로 설정')+'</div>'
    +'<div style="display:flex;align-items:center;gap:4px">'
    +wheelHtml('bedWheelH',_bedPickerHour,(_isEndtime?17:5),1,(_isEndtime?'시':'시간'))
    +'<div style="font-size:24px;font-weight:900;color:'+textColor+'">:</div>'
    +wheelHtml('bedWheelM',_bedPickerMin,59,1,'분')
    +'</div></div>';

  /* Right: analog clock SVG */
  html+='<div style="display:flex;flex-direction:column;align-items:center">'
    +'<div style="font-size:9px;color:var(--t1);margin-bottom:4px">바늘 드래그·휠로 설정</div>'
    +'<div id="bedAnalogClock" style="flex-shrink:0;width:150px;height:150px;position:relative;cursor:default"></div>'
    +'</div>';

  html+='</div>';

  /* End time preview */
  html+='<div id="bedEndTimePreview" style="text-align:center;font-size:12px;color:var(--t2);margin-bottom:12px"></div>';

  /* Alarm toggle + alarm sound selection */
  html+='<div style="display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-radius:10px;border:1px solid var(--bdr);background:var(--card);margin-bottom:14px">';
  html+='<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);cursor:pointer">'
    +'<input type="checkbox" id="bedAlarmToggle" checked style="accent-color:var(--cyan);width:16px;height:16px"> \uC885\uB8CC \uC54C\uB78C'
    +'</label>';
  /* Alarm sound radios */
  const asCur=_bedPickerAlarmSound;
  html+='<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center">'
    /* 1행: 알람음 선택 */
    +'<span style="font-size:11px;color:var(--t1);font-weight:600;white-space:nowrap">🔔 알람음 선택</span>'
    +'<div style="display:flex;gap:10px;align-items:center">'
    +'<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="bedAlarmSound" value="1" '+(asCur==='1'?'checked':'')+' data-action="alarmSound" style="accent-color:var(--cyan)"> 알람 1</label>'
    +'<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="bedAlarmSound" value="2" '+(asCur==='2'?'checked':'')+' data-action="alarmSound" style="accent-color:var(--cyan)"> 알람 2</label>'
    +'<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="bedAlarmSound" value="3" '+(asCur==='3'?'checked':'')+' data-action="alarmSound" style="accent-color:var(--cyan)"> 알람 3</label>'
    +'<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="bedAlarmSound" value="4" '+(asCur==='4'?'checked':'')+' data-action="alarmSound" style="accent-color:var(--cyan)"> 알람 4</label>'
    +'<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t2);cursor:pointer"><input type="radio" name="bedAlarmSound" value="random" '+(asCur==='random'?'checked':'')+' data-action="alarmSound" style="accent-color:var(--cyan)"> 랜덤</label>'
    +'</div>'
    /* 2행: 알람음 재생 */
    +'<span style="font-size:11px;color:var(--t1);font-weight:600;white-space:nowrap">🎵 알람음 재생</span>'
    +'<div style="display:flex;gap:10px;align-items:center">'
    +'<button data-action="togglePreview" data-num="1" style="font-size:10px;padding:3px 14px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);cursor:pointer">▶ 1</button>'
    +'<button data-action="togglePreview" data-num="2" style="font-size:10px;padding:3px 14px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);cursor:pointer">▶ 2</button>'
    +'<button data-action="togglePreview" data-num="3" style="font-size:10px;padding:3px 14px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);cursor:pointer">▶ 3</button>'
    +'<button data-action="togglePreview" data-num="4" style="font-size:10px;padding:3px 14px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);cursor:pointer">▶ 4</button>'
    +'<button data-action="togglePreview" data-num="random" style="font-size:10px;padding:3px 14px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);cursor:pointer">🎲 랜덤</button>'
    +'</div>'
    +'</div>';
  html+='</div>';

  /* Buttons */
  html+='<div style="display:flex;gap:8px">';
  if(isEdit){
    html+='<button class="btn btn-primary btn-sm" data-action="confirmEdit" data-bed-id="'+bedId+'" style="flex:1;height:36px;font-size:13px">\uD655\uC778</button>'
      +'<button class="btn btn-sm" data-action="pickerRelease" data-bed-id="'+bedId+'" style="flex:1;height:36px;font-size:13px;background:rgba(239,68,68,0.08);color:#dc2626;border:1px solid rgba(239,68,68,0.25)">\uD1F4\uC2E4</button>'
      +'<button class="btn btn-sm" data-action="cancelPicker" style="height:36px;font-size:13px;background:transparent;border:1px solid var(--bdr);color:var(--t2);padding:0 14px">← 뒤로</button>';
  } else {
    const _bedStu=getStu(_bedCurrentStuId);
    const _isStaff=_bedStu&&_bedStu.type==='staff';
    html+='<button class="btn btn-primary btn-sm" data-action="confirmAssign" data-bed-id="'+bedId+'" style="flex:1;height:36px;font-size:13px">확인</button>';
    if(!_isStaff)html+='<button class="btn btn-outline btn-sm" data-action="teacherMsg" style="flex:1;height:36px;font-size:13px">📋 담임/교과 교사 전송 메시지</button>';
    html+='<button class="btn btn-sm" data-action="cancelPicker" style="flex:1;height:36px;font-size:13px;background:transparent;border:1px solid var(--bdr);color:var(--t2)">← 뒤로</button>';
  }
  html+='</div>';
  return html;
}

/* Click-to-type on wheel center value */
function _bedWheelClickToType(el,wheelId,suffix){
  const parent=document.getElementById(wheelId);
  if(!parent) return;
  const items=JSON.parse(parent.getAttribute('data-items'));
  const ci=parseInt(parent.getAttribute('data-index'),10);
  const curVal=items[ci];
  const input=document.createElement('input');
  input.type='number';
  input.value=curVal;
  input.style.cssText='width:50px;text-align:center;font-size:20px;font-weight:800;border:1px solid var(--cyan);border-radius:4px;background:var(--bg1);color:var(--t1);outline:none;padding:2px';
  input.min=items[0];
  input.max=items[items.length-1];
  el.textContent='';
  el.appendChild(input);
  input.focus();
  input.select();
  function commit(){
    let v=parseInt(input.value,10);
    if(isNaN(v)) v=curVal;
    /* snap to nearest valid item */
    let best=0, bestDiff=9999;
    for(let i=0;i<items.length;i++){
      if(Math.abs(items[i]-v)<bestDiff){bestDiff=Math.abs(items[i]-v);best=i;}
    }
    parent.setAttribute('data-index',best);
    if(wheelId==='bedWheelH') _bedPickerHour=items[best];
    else _bedPickerMin=items[best];
    _bedRerenderWheel(parent,items,best,suffix);
    _bedClampEndTime17();
    _bedUpdateEndTimePreview();
    _bedSyncAnalogFromPicker();
  }
  input.addEventListener('blur',commit);
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();input.blur();}
    else if(e.key==='Tab'){
      /* 탭 = 다른 휠(시↔분)로 이동 + 값 선택(블록). 먼저 blur 로 현재 값 확정·클램프(분 휠 재렌더 포함)를
       *  끝낸 뒤 다른 휠 입력칸을 열어, 클램프가 새 입력칸을 지우는 레이스를 피한다.
       *  사용자 요청 2026-06-15: 시각 블록 상태에서 Tab 누르면 분으로 이동·블록. */
      e.preventDefault();
      input.blur();
      _bedFocusOtherWheel(wheelId);
    }
  });
  /* v3 (사용자 결정 2026-05-21) — 엔터/blur 안 누르고 숫자 입력 즉시 아날로그 시계 바늘 동기.
   * commit() 은 wheel rerender 까지 하므로 input 박스가 사라져 입력 중단됨 → 시계만 동기화하는 가벼운 함수 별도.
   * 최종 commit (wheel rerender + clamp) 은 blur/Enter 시에만 호출. */
  input.addEventListener('input', function(){
    let v=parseInt(input.value,10);
    if(isNaN(v)) return;
    let best=0, bestDiff=9999;
    for(let i=0;i<items.length;i++){
      if(Math.abs(items[i]-v)<bestDiff){bestDiff=Math.abs(items[i]-v);best=i;}
    }
    if(wheelId==='bedWheelH') _bedPickerHour=items[best];
    else _bedPickerMin=items[best];
    _bedUpdateEndTimePreview();
    _bedSyncAnalogFromPicker();
  });
}

/* 시↔분 입력칸 전환 — 한쪽 클릭-입력칸에서 Tab 시 다른 휠의 클릭-입력칸을 열고 값 선택(블록). (2026-06-15) */
function _bedFocusOtherWheel(curWheelId){
  const otherId=(curWheelId==='bedWheelH')?'bedWheelM':'bedWheelH';
  const center=document.querySelector('.bedWheelCenter[data-wheel-id="'+otherId+'"]');
  if(!center)return;
  const suffix=center.getAttribute('data-suffix')||(otherId==='bedWheelH'?(_bedPickerTimerMode==='endtime'?'시':'시간'):'분');
  _bedWheelClickToType(center,otherId,suffix);
}

/* 종료 시각 기준에서 17시 선택 시 분은 0으로 고정 (최대 17:00까지만 허용) */
function _bedClampEndTime17(){
  if(_bedPickerTimerMode!=='endtime')return;
  if(_bedPickerHour===17&&_bedPickerMin>0){
    _bedPickerMin=0;
    const mEl=document.getElementById('bedWheelM');
    if(mEl){
      const items=JSON.parse(mEl.getAttribute('data-items'));
      let idx=items.indexOf(0);if(idx<0)idx=0;
      mEl.setAttribute('data-index',idx);
      _bedRerenderWheel(mEl,items,idx,'분');
    }
  }
}
/* 시(시간) 한 칸 가감 — 숫자 휠과 시계 시침 휠이 공용 (2026-06-15).
 *  위로 굴리면(deltaY<0) 숫자 증가, 아래로 굴리면(deltaY>0) 감소 (사용자 요청 2026-06-15).
 *  items 는 오름차순이므로 증가=ci+1. bedWheelH 의 data-items/index 기준. */
function _bedStepHourWheel(deltaY){
  const el=document.getElementById('bedWheelH');
  if(!el) return;
  const items=JSON.parse(el.getAttribute('data-items'));
  let ci=parseInt(el.getAttribute('data-index'),10);
  ci=deltaY<0?Math.min(ci+1,items.length-1):Math.max(ci-1,0);
  el.setAttribute('data-index',ci);
  _bedPickerHour=items[ci];
  const hSuffix=_bedPickerTimerMode==='endtime'?'시':'시간';
  _bedRerenderWheel(el,items,ci,hSuffix);
  _bedClampEndTime17();
  _bedUpdateEndTimePreview();
  _bedSyncAnalogFromPicker();
}
/* 분 한 칸 가감 — 숫자 휠과 시계 분침 휠이 공용 (2026-06-15).
 *  위로 굴리면(deltaY<0) 증가, 아래로 굴리면(deltaY>0) 감소. */
function _bedStepMinWheel(deltaY){
  const el=document.getElementById('bedWheelM');
  if(!el) return;
  const items=JSON.parse(el.getAttribute('data-items'));
  let ci=parseInt(el.getAttribute('data-index'),10);
  ci=deltaY<0?Math.min(ci+1,items.length-1):Math.max(ci-1,0);
  /* 17시인 상태에서 분을 0보다 크게 돌리려 하면 차단 */
  if(_bedPickerTimerMode==='endtime'&&_bedPickerHour===17&&items[ci]>0){
    ci=items.indexOf(0);if(ci<0)ci=0;
  }
  el.setAttribute('data-index',ci);
  _bedPickerMin=items[ci];
  _bedRerenderWheel(el,items,ci,'분');
  _bedUpdateEndTimePreview();
  _bedSyncAnalogFromPicker();
}
function _bedAttachWheelEvents(){
  const hEl=document.getElementById('bedWheelH');
  const mEl=document.getElementById('bedWheelM');
  if(hEl){
    hEl.addEventListener('wheel',function(e){ e.preventDefault(); _bedStepHourWheel(e.deltaY); },{passive:false});
  }
  if(mEl){
    mEl.addEventListener('wheel',function(e){ e.preventDefault(); _bedStepMinWheel(e.deltaY); },{passive:false});
  }
}

function _bedRerenderWheel(el,items,ci,suffix){
  const isLight=document.body.classList.contains('light');
  const dimColor=isLight?'rgba(0,0,0,0.15)':'rgba(255,255,255,0.2)';
  const activeColor=isLight?'#0e7490':'#fff';
  const dimText=isLight?'rgba(0,0,0,0.25)':'rgba(255,255,255,0.35)';
  const midText=isLight?'rgba(0,0,0,0.4)':'rgba(255,255,255,0.6)';
  const prev2=ci>=2?items[ci-2]:null;
  const prev1=ci>=1?items[ci-1]:null;
  const next1=ci<items.length-1?items[ci+1]:null;
  const next2=ci<items.length-2?items[ci+2]:null;
  const ch=el.children;
  ch[0].textContent=prev2!==null?prev2+suffix:'';
  ch[1].textContent=prev1!==null?prev1+suffix:'';
  ch[2].textContent=items[ci]+suffix;
  ch[3].textContent=next1!==null?next1+suffix:'';
  ch[4].textContent=next2!==null?next2+suffix:'';
}

let _bedPreviewInitDone=false;
let _bedTimeOutSyncTimer=null;
function _bedUpdateEndTimePreview(){
  if(_bedPreviewInitDone)bus.emit('toast:saveLater');
  const el=document.getElementById('bedEndTimePreview');
  if(!el) return;
  const now=new Date();
  let endH, endM, diffMin;
  if(_bedPickerTimerMode==='endtime'){
    if(_bedPickerHour===0&&_bedPickerMin===0){el.textContent='종료 시각을 설정해주세요';return;}
    endH=_bedPickerHour;endM=_bedPickerMin;
    diffMin=(endH*60+endM)-(now.getHours()*60+now.getMinutes());
    if(diffMin<0)diffMin+=24*60;
  } else {
    if(_bedPickerHour===0&&_bedPickerMin===0){el.textContent='시간을 설정해주세요';return;}
    const endDate=new Date(now.getTime()+(_bedPickerHour*60+_bedPickerMin)*60000);
    endH=endDate.getHours();endM=endDate.getMinutes();
    diffMin=_bedPickerHour*60+_bedPickerMin;
  }
  const dH=Math.floor(diffMin/60);const dM=diffMin%60;
  const timeStr=endH+'시'+(endM>0?' '+endM+'분':'');
  const durStr=dH>0?dH+'시간 '+dM+'분':dM+'분';
  el.textContent='종료 예정: '+timeStr+' (남은 시간: '+durStr+')';
  /* 실시간 연동 — 시계 회전/스크롤 시 보건일지 표 퇴실시간 칸 즉시 갱신.
     S._pendingBedRestRecId 가 가리키는 레코드를 찾아서 timeOut 을 endH:endM 으로 설정.
     디바운스(120ms) 로 빈번한 변경 부하 완화. */
  if(_bedTimeOutSyncTimer)clearTimeout(_bedTimeOutSyncTimer);
  _bedTimeOutSyncTimer=setTimeout(function(){
    try{
      const recId=S._pendingBedRestRecId;
      if(recId==null||!Array.isArray(S.records))return;
      const rec=S.records.find(function(r){return r.id===recId;});
      if(!rec)return;
      const _hh=String(endH).padStart(2,'0');
      const _mm=String(endM).padStart(2,'0');
      const _newOut=_hh+':'+_mm;
      if(rec.timeOut===_newOut)return;
      rec.timeOut=_newOut;
      rec._dirty=true;
      try{ if(typeof saveRecordNow==='function')saveRecordNow(rec); }catch(e){}
      bus.emit('render:daily');
    }catch(e){}
  },120);
}

/* ── Analog Clock SVG ── */
function _bedDrawAnalogClock(){
  const container=document.getElementById('bedAnalogClock');
  if(!container) return;
  const isLight=document.body.classList.contains('light');
  const cx=75, cy=75, r=60;
  const faceColor=isLight?'#f8fafc':'#0f172a';
  const borderColor=isLight?'#cbd5e1':'#334155';
  const markerColor=isLight?'#64748b':'#e2e8f0';
  const hourHandColor=isLight?'#0e7490':'#22d3ee';
  const minHandColor=isLight?'#0369a1':'#38bdf8';
  const centerDotColor=isLight?'#0e7490':'#22d3ee';

  /* 아날로그 시계: 모드에 따라 시침/분침 결정 */
  let endH, endM;
  if(_bedPickerTimerMode==='endtime'){
    /* 종료 시각 모드: 직접 설정한 시/분 표시 */
    endH=_bedPickerHour%12;endM=_bedPickerMin;
  } else {
    /* 카운트다운 모드: 현재 시각 + 설정 시간 */
    const now=new Date();
    const endDate=new Date(now.getTime()+(_bedPickerHour*60+_bedPickerMin)*60000);
    endH=endDate.getHours()%12;endM=endDate.getMinutes();
  }
  const hAngle=endH*30+endM*0.5-90; /* 시침: 시간*30 + 분*0.5 */
  const mAngle=endM*6-90; /* 분침: 분*6 */

  const hRad=hAngle*Math.PI/180;
  const mRad=mAngle*Math.PI/180;

  const hLen=30; /* hour hand length */
  const mLen=44; /* minute hand length */

  const hx=cx+hLen*Math.cos(hRad);
  const hy=cy+hLen*Math.sin(hRad);
  const mx=cx+mLen*Math.cos(mRad);
  const my=cy+mLen*Math.sin(mRad);

  let svg='<svg width="150" height="150" viewBox="0 0 150 150" style="display:block">';
  /* Clock face */
  svg+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+faceColor+'" stroke="'+borderColor+'" stroke-width="2"/>';

  /* Hour markers at radius 50 */
  for(let h=0;h<12;h++){
    const angle=(h*30-90)*Math.PI/180;
    const x1=cx+50*Math.cos(angle);
    const y1=cy+50*Math.sin(angle);
    const x2=cx+(r-2)*Math.cos(angle);
    const y2=cy+(r-2)*Math.sin(angle);
    const lw=h%3===0?2.5:1;
    svg+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+markerColor+'" stroke-width="'+lw+'" stroke-linecap="round"/>';
  }

  /* Hour numbers */
  for(let n=1;n<=12;n++){
    const na=(n*30-90)*Math.PI/180;
    const nx=cx+40*Math.cos(na);
    const ny=cy+40*Math.sin(na);
    svg+='<text x="'+nx+'" y="'+ny+'" text-anchor="middle" dominant-baseline="central" fill="'+markerColor+'" font-size="9" font-weight="600">'+n+'</text>';
  }

  /* ── 힌트 영역(hit area) 및 바늘 순서 — 시침이 분침보다 위에 있어야 함 ──
   * SVG는 나중에 그려지는 요소가 위에 표시됨.
   * 분침 = 길음(44px). 시침 = 짧음(30px). 겹치는 내부(0~30) 영역에서는 시침 우선.
   * 바깥(30~44)에서는 분침만 존재하므로 자연스레 분침 선택됨. */
  /* 1) 분침 hit area + 바늘 (아래) */
  svg+='<line id="bedClockMinHit" x1="'+cx+'" y1="'+cy+'" x2="'+mx+'" y2="'+my+'" stroke="transparent" stroke-width="14" stroke-linecap="round" style="cursor:grab"/>';
  svg+='<line id="bedClockMinHand" x1="'+cx+'" y1="'+cy+'" x2="'+mx+'" y2="'+my+'" stroke="'+minHandColor+'" stroke-width="2.5" stroke-linecap="round" style="cursor:grab;pointer-events:none"/>';
  /* 2) 시침 hit area + 바늘 (위) — 분침/시침 모두 드래그 가능 */
  svg+='<line id="bedClockHourHit" x1="'+cx+'" y1="'+cy+'" x2="'+hx+'" y2="'+hy+'" stroke="transparent" stroke-width="16" stroke-linecap="round" style="cursor:grab"/>';
  svg+='<line id="bedClockHourHand" x1="'+cx+'" y1="'+cy+'" x2="'+hx+'" y2="'+hy+'" stroke="'+hourHandColor+'" stroke-width="4" stroke-linecap="round" style="cursor:grab;pointer-events:none"/>';

  /* Center dot */
  svg+='<circle cx="'+cx+'" cy="'+cy+'" r="4" fill="'+centerDotColor+'"/>';

  svg+='</svg>';
  container.innerHTML=svg;
  _bedAttachAnalogDrag();
}

function _bedSyncAnalogFromPicker(){
  _bedDrawAnalogClock();
}
/* 드래그 누적 각도 (드래그 시작 시 초기화) */
let _bedHourDragAccum=0;
let _bedMinDragAccum=0;
function _bedUpdateClockHands(){
  const cx=75, cy=75;
  let endH, endM;
  if(_bedPickerTimerMode==='endtime'){
    endH=_bedPickerHour%12;endM=_bedPickerMin;
  } else {
    const now=new Date();
    const endDate=new Date(now.getTime()+(_bedPickerHour*60+_bedPickerMin)*60000);
    endH=endDate.getHours()%12;endM=endDate.getMinutes();
  }
  const hAngle=endH*30+endM*0.5-90;
  const mAngle=endM*6-90;
  const hRad=hAngle*Math.PI/180, mRad=mAngle*Math.PI/180;
  const hx=cx+30*Math.cos(hRad), hy=cy+30*Math.sin(hRad);
  const mx=cx+44*Math.cos(mRad), my=cy+44*Math.sin(mRad);
  const hHand=document.getElementById('bedClockHourHand');
  const hHit=document.getElementById('bedClockHourHit');
  const mHand=document.getElementById('bedClockMinHand');
  const mHit=document.getElementById('bedClockMinHit');
  if(hHand){hHand.setAttribute('x2',hx);hHand.setAttribute('y2',hy);}
  if(hHit){hHit.setAttribute('x2',hx);hHit.setAttribute('y2',hy);}
  if(mHand){mHand.setAttribute('x2',mx);mHand.setAttribute('y2',my);}
  if(mHit){mHit.setAttribute('x2',mx);mHit.setAttribute('y2',my);}
}

function _bedAttachAnalogDrag(){
  const container=document.getElementById('bedAnalogClock');
  if(!container) return;
  const svg=container.querySelector('svg');
  if(!svg) return;
  const hourHit=document.getElementById('bedClockHourHit');
  const minHit=document.getElementById('bedClockMinHit');
  const cx=75, cy=75;

  function getAngle(e){
    let clientX=e.clientX, clientY=e.clientY;
    if(e.touches&&e.touches.length>0){clientX=e.touches[0].clientX;clientY=e.touches[0].clientY;}
    const rect=svg.getBoundingClientRect();
    const scaleX=rect.width/150, scaleY=rect.height/150;
    const x=clientX-rect.left-cx*scaleX;
    const y=clientY-rect.top-cy*scaleY;
    let angle=Math.atan2(y,x)*180/Math.PI+90;
    if(angle<0) angle+=360;
    return angle;
  }

  function onStart(e,type){
    e.preventDefault();
    e.stopPropagation();
    _bedAnalogDragging=type;
    _bedHourDragAccum=0;
    _bedMinDragAccum=0;
    _prevDragAngle=null;
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onEnd);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('touchend',onEnd);
  }

  let _prevDragAngle=null;

  function onMove(e){
    if(!_bedAnalogDragging) return;
    e.preventDefault();
    const angle=getAngle(e);
    const isEndtime=_bedPickerTimerMode==='endtime';

    if(isEndtime){
      /* ── 종료 시각 모드: 분침 드래그만 활성 ──
       * 종료 시각 = 현재+5분 ~ 오늘 17:00 범위 clamp */
      const _nowD=new Date();
      const nowMinE=_nowD.getHours()*60+_nowD.getMinutes();
      const maxEndMin=Math.max(nowMinE+5, 17*60); /* 오늘 17:00, 단 이미 17시 이후면 +5분만 */
      if(_prevDragAngle!==null){
        let delta=angle-_prevDragAngle;
        if(delta>180) delta-=360;
        if(delta<-180) delta+=360;
        if(_bedAnalogDragging==='minute'){
          _bedMinDragAccum=(_bedMinDragAccum||0)+delta;
          let minSteps=0;
          while(_bedMinDragAccum>=6){minSteps++;_bedMinDragAccum-=6;}
          while(_bedMinDragAccum<=-6){minSteps--;_bedMinDragAccum+=6;}
          if(minSteps!==0){
            let newEndTotalM=_bedPickerHour*60+_bedPickerMin+minSteps;
            if(newEndTotalM<nowMinE+5)newEndTotalM=nowMinE+5;
            if(newEndTotalM>maxEndMin)newEndTotalM=maxEndMin;
            _bedPickerHour=Math.floor(newEndTotalM/60)%24;if(_bedPickerHour<0)_bedPickerHour+=24;
            _bedPickerMin=newEndTotalM%60;
          }
        } else if(_bedAnalogDragging==='hour'){
          _bedHourDragAccum=(_bedHourDragAccum||0)+delta;
          let hourSteps=0;
          while(_bedHourDragAccum>=30){hourSteps++;_bedHourDragAccum-=30;}
          while(_bedHourDragAccum<=-30){hourSteps--;_bedHourDragAccum+=30;}
          if(hourSteps!==0){
            let newEndTotalM2=(_bedPickerHour+hourSteps)*60+_bedPickerMin;
            if(newEndTotalM2<nowMinE+5)newEndTotalM2=nowMinE+5;
            if(newEndTotalM2>maxEndMin)newEndTotalM2=maxEndMin;
            _bedPickerHour=Math.floor(newEndTotalM2/60)%24;if(_bedPickerHour<0)_bedPickerHour+=24;
            _bedPickerMin=newEndTotalM2%60;
          }
        }
      }
    } else {
      /* ── 카운트다운(남은 시간 기준) 모드 ──
       * 분침 드래그만 활성. 6°당 1분. 한 바퀴=60분 → 시침 자동 진행
       * 시작=현재 시각, 최소=5분, 최대=오늘 오후 5시(17:00)까지 */
      const _nowCD=new Date();
      const nowMinCD=_nowCD.getHours()*60+_nowCD.getMinutes();
      const maxCDmin=Math.max(5, 17*60 - nowMinCD); /* 오늘 17:00까지 남은 분 */
      if(_prevDragAngle!==null){
        let delta=angle-_prevDragAngle;
        if(delta>180) delta-=360;
        if(delta<-180) delta+=360;
        if(_bedAnalogDragging==='minute'){
          _bedMinDragAccum+=delta;
          let minSteps=0;
          while(_bedMinDragAccum>=6){minSteps++;_bedMinDragAccum-=6;}
          while(_bedMinDragAccum<=-6){minSteps--;_bedMinDragAccum+=6;}
          if(minSteps!==0){
            let newTotalM=_bedPickerHour*60+_bedPickerMin+minSteps;
            if(newTotalM<5)newTotalM=5;
            if(newTotalM>maxCDmin)newTotalM=maxCDmin;
            _bedPickerHour=Math.floor(newTotalM/60);
            _bedPickerMin=newTotalM%60;
          }
        } else if(_bedAnalogDragging==='hour'){
          _bedHourDragAccum+=delta;
          let hourSteps=0;
          while(_bedHourDragAccum>=30){hourSteps++;_bedHourDragAccum-=30;}
          while(_bedHourDragAccum<=-30){hourSteps--;_bedHourDragAccum+=30;}
          if(hourSteps!==0){
            let newTotalM2=(_bedPickerHour+hourSteps)*60+_bedPickerMin;
            if(newTotalM2<5)newTotalM2=5;
            if(newTotalM2>maxCDmin)newTotalM2=maxCDmin;
            _bedPickerHour=Math.floor(newTotalM2/60);
            _bedPickerMin=newTotalM2%60;
          }
        }
      }
    }

    /* 양쪽 휠 동기화 */
    const hEl=document.getElementById('bedWheelH');
    if(hEl){
      const hItems=JSON.parse(hEl.getAttribute('data-items'));
      let hci=hItems.indexOf(_bedPickerHour);if(hci<0)hci=0;
      hEl.setAttribute('data-index',hci);
      _bedRerenderWheel(hEl,hItems,hci,isEndtime?'시':'시간');
    }
    const mEl=document.getElementById('bedWheelM');
    if(mEl){
      const mItems=JSON.parse(mEl.getAttribute('data-items'));
      let mci=mItems.indexOf(_bedPickerMin);if(mci<0)mci=0;
      mEl.setAttribute('data-index',mci);
      _bedRerenderWheel(mEl,mItems,mci,'분');
    }

    _prevDragAngle=angle;
    _bedUpdateEndTimePreview();
    _bedUpdateClockHands();
  }

  function onEnd(){
    _bedAnalogDragging=null;
    _prevDragAngle=null;
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onEnd);
    document.removeEventListener('touchmove',onMove);
    document.removeEventListener('touchend',onEnd);
    /* 드래그 종료 후 전체 동기화 */
    _bedDrawAnalogClock();
  }

  /* 분침 드래그 */
  if(minHit){
    minHit.addEventListener('mousedown',function(e){ onStart(e,'minute'); });
    minHit.addEventListener('touchstart',function(e){ onStart(e,'minute'); },{passive:false});
  }
  /* 시침 드래그 — 30°당 1시간 변경 */
  if(hourHit){
    hourHit.addEventListener('mousedown',function(e){ onStart(e,'hour'); });
    hourHit.addEventListener('touchstart',function(e){ onStart(e,'hour'); },{passive:false});
  }
  /* 시계 바늘 위에서 휠 스크롤 — 숫자 휠과 동일하게 시/분 가감 (사용자 요청 2026-06-15).
   *  컨테이너(#bedAnalogClock)는 SVG 재렌더에도 유지되므로 여기서 1회만 부착(멱등 가드).
   *  e.target 의 hit id 로 시침/분침 구분 — 드래그와 동일한 우선순위(내부 겹침=시침, 외곽=분침). */
  if(container && !container._bedWheelBound){
    container._bedWheelBound=true;
    container.addEventListener('wheel',function(e){
      const id=e.target&&e.target.id;
      if(id==='bedClockHourHit'){ e.preventDefault(); _bedStepHourWheel(e.deltaY); }
      else if(id==='bedClockMinHit'){ e.preventDefault(); _bedStepMinWheel(e.deltaY); }
    },{passive:false});
  }
}

function _bedCancelPicker(){
  /* 침상 안정 등록 흐름(확인 모달 '예'로 진입)에서 '← 뒤로' = 바로 이전 확인 모달로 복귀.
   *  그리드로 접지 않고 침상 모달을 닫은 뒤 확인 모달을 다시 띄운다. 침상 칩은 유지(확인 모달에서 재선택).
   *  (사용자 요청 2026-06-24) */
  if(S._pendingBedRestRecId != null){
    const _rid = S._pendingBedRestRecId;
    S._pendingBedRestRecId = null;   /* addCancelled(원복) 트리거 방지 — 칩 유지 */
    _bedCloseManager();
    try{ bus.emit('bed:backToConfirm', {recId:_rid}); }catch(_){}
    return;
  }
  const picker=document.getElementById('bedTimePicker');
  if(!picker) return;
  picker.style.transition='opacity 0.2s ease, transform 0.2s ease';
  picker.style.opacity='0';picker.style.transform='translateY(-8px)';
  setTimeout(function(){picker.style.display='none';picker.style.opacity='';picker.style.transform='';picker.style.transition='';},200);
  const cfgBtn=document.getElementById('bedConfigBtnWrap');if(cfgBtn)cfgBtn.style.display='';
  /* 선택 해제 + 침상 테두리 복원 */
  _bedCurrentBedId=null;
  _bedRenderBody();
}

function _bedConfirmAssign(bedId){
  const h=_bedPickerHour;
  const m=_bedPickerMin;
  if(h===0&&m===0){ bus.emit('toast:show', {text: '이용 시간을 설정해주세요'}); return; }
  const alarm=document.getElementById('bedAlarmToggle').checked;
  const stu=getStu(_bedCurrentStuId);
  if(!stu){ bus.emit('toast:show', {text: '학생 정보를 찾을 수 없습니다'}); return; }
  /* 과거 날짜 침상 등록 — 침상 이용 현황 사이드 카드/알람은 오늘 기록에만 의미.
     S.selectedDate 가 오늘이 아니면 _bedUsage 에 등록하지 않고 처치 칩만 기록 (단순 이력). */
  /* 로컬 날짜 사용(2026-08-12) — toISOString() 은 UTC 라 KST 자정~오전 9시 사이 '오늘' 등록이
     과거 날짜로 오판되어 침상 이용 현황에 등록되지 않던 버그 수정 */
  const _todayStr=toDateStr(new Date());
  const _isPast=typeof S.selectedDate==='string'&&S.selectedDate&&S.selectedDate!==_todayStr;
  if(!_isPast){
    /* check if bed already occupied — 오늘 등록일 때만 적용 */
    const existing=S._bedUsage.find(function(u){ return u.bedId===bedId; });
    if(existing){ bus.emit('toast:show', {text: '이미 사용 중인 침상입니다'}); return; }
    /* check if student already on another bed */
    const stuOnBed=S._bedUsage.find(function(u){ return u.studentId===_bedCurrentStuId; });
    if(stuOnBed){
      let bl='';S._bedConfig.beds.forEach(function(b,i){if(b.id===stuOnBed.bedId) bl=_bedLabel(b,i);});
      bus.emit('toast:show', {text: stu.name+' 학생은 이미 '+bl+'을(를) 이용 중입니다'});
      return;
    }
  }
  const now=Date.now();
  let duration;
  if(_bedPickerTimerMode==='endtime'){
    /* 종료 시각 모드: h시 m분까지 */
    const _nowD=new Date();
    let _endMs=new Date(_nowD.getFullYear(),_nowD.getMonth(),_nowD.getDate(),h,m,0).getTime();
    if(_endMs<=now)_endMs+=24*60*60*1000; /* 다음날 */
    duration=_endMs-now;
  } else {
    duration=(h*60+m)*60000;
  }
  /* Format display name based on student type */
  let displayName='';
  if(stu.type==='staff') displayName=(stu.position||'교직원')+' '+stu.name;
  else displayName=stu.grade+'-'+stu.cls+' '+stu.num+'번 '+stu.name;
  /* 과거 날짜는 _bedUsage 미등록 (사이드 카드·알람 차단) — 처치 칩 기록만 진행 */
  if(!_isPast){
    S._bedUsage.push({
      bedId:bedId,
      studentId:_bedCurrentStuId,
      studentName:displayName,
      startTime:now,
      endTime:now+duration,
      /* 퇴실 버튼으로 일반 일지 record 의 timeOut 을 갱신하기 위한 연결 정보 (사용자 요청 2026-05-19). */
      recordId:S._pendingBedRestRecId||null,
      alarm:alarm,
      alarmed:false,
      timerMode:_bedPickerTimerMode||'countdown',
      alarmSound:_bedPickerAlarmSound||'random'
    });
    _saveBedUsage();
  }
  /* 침상 배정 확정 — 해당 학생 일반 일지 레코드에 bed 라벨 + 침상안정 처치 저장 */
  try{
    const _bedObj=S._bedConfig.beds.find(function(b){return b.id===bedId;});
    const _bedIdx=S._bedConfig.beds.indexOf(_bedObj);
    const _bedLab=_bedObj?_bedLabel(_bedObj,_bedIdx):'침상';
    const _today=typeof S.selectedDate==='string'?S.selectedDate:toDateStr(new Date());
    let _targetRec=null;
    /* 1) 증상 팝업에서 열린 pending 레코드 우선 */
    if(S._pendingBedRestRecId&&Array.isArray(S.records)){
      _targetRec=S.records.find(function(r){return r.id===S._pendingBedRestRecId;});
    }
    /* 2) 없으면 오늘자 해당 학생의 가장 최근 레코드 */
    if(!_targetRec&&Array.isArray(S.records)){
      _targetRec=S.records.filter(function(r){return r.studentId===_bedCurrentStuId&&r.date===_today;}).pop();
    }
    if(_targetRec){
      _targetRec.bed=_bedLab;
      const _treat=Array.isArray(_targetRec.treatment)?_targetRec.treatment.slice():[];
      /* 구 버전 "침상안정" 제거 후 신 버전 "침상 이용"으로 통일 */
      const _idxOld=_treat.indexOf('침상안정');
      if(_idxOld!==-1)_treat.splice(_idxOld,1);
      if(_treat.indexOf('침상 이용')===-1)_treat.push('침상 이용');
      _targetRec.treatment=_treat;
      /* 종료 시각 모드 — 설정한 마감 시간을 퇴실시간(timeOut)으로 자동 입력 */
      if(_bedPickerTimerMode==='endtime'){
        const _hh=String(h).padStart(2,'0');
        const _mm=String(m).padStart(2,'0');
        _targetRec.timeOut=_hh+':'+_mm;
      }
      _targetRec._dirty=true;
      /* 백엔드 저장 — saveRecordNow 직접 호출 (saveData 미임포트로 인한 silent skip 방지) */
      try{ if(typeof saveRecordNow==='function')saveRecordNow(_targetRec); }catch(e){console.warn('[bed] saveRecordNow 실패:',e);}
      /* 증상 팝업이 열려있으면 처치 패널 재렌더로 ✓ 침상 이용 표시 반영 */
      if(typeof _symRenderTreatPanel==='function'){
        try{_symRenderTreatPanel(_targetRec.id);}catch(_){}
      }
    }
    /* 확정됐으므로 pending 해제 — 이후 닫기로 취소되지 않음 */
    S._pendingBedRestRecId=null;
    bus.emit('render:daily');
  }catch(e){console.warn('[bed] daily_records.bed 업데이트 실패:',e);}
  _bedRenderBody();
  bus.emit('toast:show', {text: stu.name+' 학생이 침상에 등록되었습니다'});
  /* 침상 관리 모달 자동 닫기 (증상 팝업에서 열린 경우 원래 화면으로 복귀) */
  try{
    const ov=document.getElementById('bedManagerOverlay');
    if(ov&&typeof closeModalGracefully==='function')closeModalGracefully(ov);
    else if(ov&&ov.parentNode)ov.remove();
  }catch(_){}
}

/* ── Show occupied bed info (editable, same picker as assign) ── */
function _bedShowOccupied(bedId){
  const usage=S._bedUsage.find(function(u){ return u.bedId===bedId; });
  if(!usage) return;
  let bedLabel='';
  S._bedConfig.beds.forEach(function(b,i){ if(b.id===bedId) bedLabel=_bedLabel(b,i); });

  /* Pre-fill picker with current values */
  const remaining=Math.max(0,usage.endTime-Date.now());
  const totalMin=Math.ceil(remaining/60000);
  _bedPickerHour=Math.floor(totalMin/60);
  _bedPickerMin=Math.round((totalMin%60)/5)*5;
  if(_bedPickerMin>=60){_bedPickerMin=0;_bedPickerHour++;}
  if(_bedPickerHour>5) _bedPickerHour=5;
  _bedPickerTimerMode=usage.timerMode||'countdown';
  _bedPickerAlarmSound=usage.alarmSound||'random';
  _bedEditingBedId=bedId;
  _bedCurrentBedId=bedId;

  /* 1) 선택된 침상 테두리 업데이트 (body 재렌더) */
  _bedRenderBody();
  /* 2) 재렌더 후 picker 요소 재조회 */
  const picker=document.getElementById('bedTimePicker');
  if(!picker) return;

  const stuInfo=_bedFormatStuInfo(usage);
  _bedPreviewInitDone=false;
  picker.innerHTML=_bedBuildDurationPicker(bedId,bedLabel,stuInfo,true);
  picker.style.display='block';
  _bedAttachPickerEvents(picker);

  /* Set alarm toggle to match current */
  const alarmToggle=document.getElementById('bedAlarmToggle');
  if(alarmToggle) alarmToggle.checked=!!usage.alarm;

  _bedUpdateEndTimePreview();
  setTimeout(function(){_bedPreviewInitDone=true;},100);
  _bedAttachWheelEvents();
  _bedDrawAnalogClock();
  _bedAttachAnalogDrag();
  picker.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* ── 좌측 사이드 카드 클릭 → 침상 관리 모달을 띄우고 그 침상의 시간 편집 picker 를 연다 (2026-06-15) ── */
function _bedEditFromSidebar(bedId){
  _loadBedUsage();
  const u=S._bedUsage.find(function(x){return x.bedId===bedId;});
  if(!u){ if(typeof renderBedSidebarCard==='function')renderBedSidebarCard(); return; }
  openBedManager(u.studentId!=null?u.studentId:null);
  /* openBedManager 가 기본으로 빈 침상 picker 를 열므로, 모달 렌더 직후 점유 침상 편집 picker 로 전환 */
  setTimeout(function(){ try{ _bedShowOccupied(bedId); }catch(e){ console.warn('[bed] 사이드 카드 편집 열기 실패:',e); } },30);
}

/* Confirm edit of an occupied bed's time */
function _bedConfirmEdit(bedId){
  const h=_bedPickerHour;
  const m=_bedPickerMin;
  if(h===0&&m===0){ bus.emit('toast:show', {text: '\uC774\uC6A9 \uC2DC\uAC04\uC744 \uC124\uC815\uD574\uC8FC\uC138\uC694'}); return; }
  const usage=S._bedUsage.find(function(u){ return u.bedId===bedId; });
  if(!usage){ bus.emit('toast:show', {text: '\uCE68\uC0C1 \uC815\uBCF4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4'}); return; }
  const alarm=document.getElementById('bedAlarmToggle')?document.getElementById('bedAlarmToggle').checked:usage.alarm;
  const now=Date.now();
  let newDuration;
  if(_bedPickerTimerMode==='endtime'){
    const _nowD=new Date();
    let _endMs=new Date(_nowD.getFullYear(),_nowD.getMonth(),_nowD.getDate(),h,m,0).getTime();
    if(_endMs<=now)_endMs+=24*60*60*1000;
    newDuration=_endMs-now;
  } else {
    newDuration=(h*60+m)*60000;
  }
  usage.endTime=now+newDuration;
  usage.alarm=alarm;
  usage.alarmed=false;
  usage.timerMode=_bedPickerTimerMode||'countdown';
  usage.alarmSound=_bedPickerAlarmSound||'random';
  _saveBedUsage();
  _bedEditingBedId=null;
  const picker=document.getElementById('bedTimePicker');
  if(picker){
    picker.style.transition='opacity 0.2s ease, transform 0.2s ease';
    picker.style.opacity='0';picker.style.transform='translateY(-8px)';
    setTimeout(function(){_bedRenderBody();},200);
  } else { _bedRenderBody(); }
  bus.emit('toast:show', {text: '\uCE68\uC0C1 \uC774\uC6A9 \uC2DC\uAC04\uC774 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4'});
}

function _bedRelease(bedId){
  const usage=S._bedUsage.find(function(u){return u.bedId===bedId;});
  /* v9: usage.studentId 로 조회 (과거 usage.stuId 오타 수정). 미재학자는 usage에 저장된 displayName 사용. */
  let stu=null;
  if(usage){
    {
      const _s=getStu(usage.studentId);
      if(_s&&!_s._notFound)stu=_s;
    }
    if(!stu){
      /* 재학정보 없을 때 등록 시 저장된 studentName(예: "3-2 14번 홍길동")을 그대로 사용 */
      stu={name:usage.studentName||'',_displayOnly:true,type:'student',grade:0,cls:0,num:0};
    }
  }
  S._bedUsage=S._bedUsage.filter(function(u){ return u.bedId!==bedId; });
  _saveBedUsage();
  /* 편집 picker가 열려있으면 닫기 */
  const picker=document.getElementById('bedPickerOverlay');
  if(picker)picker.remove();
  _bedRenderBody();
  /* 애니메이션 팝업으로 퇴실 처리 완료 안내 (확인/X 버튼 없음, 자동 닫힘) */
  if(stu)_bedShowReleaseToast(stu);
}

/* ── Bed Configuration Modal ── */
function openBedConfig(){
  const existing=document.getElementById('bedConfigOverlay');
  if(existing) existing.remove();
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='bedConfigOverlay';
  ov.style.zIndex='10060';
  /* 오버레이 배경 투명 — 뒤 침상 이용 등록 팝업이 보이도록 */
  ov.style.background='transparent';ov.style.pointerEvents='none';
  ov.innerHTML='<div class="modal-content bed-config-modal" style="width:400px;max-width:92vw;padding:0;overflow:hidden;pointer-events:auto;transition:opacity 0.22s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)">'
    +'<div class="bed-config-header" style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-radius:12px 12px 0 0;font-size:15px;font-weight:800;color:var(--t1);cursor:grab;user-select:none">⚙ 침상 구성</div>'
    +'<div id="bedConfigBody" style="padding:20px"></div>'
    +'</div>';
  ov.addEventListener('click',function(e){ if(e.target===ov) _bedCloseConfig(); });
  document.body.appendChild(ov);
  /* 침상 이용 등록 팝업이 있으면 좌우 나란히 배치 */
  const mgrOv=document.getElementById('bedManagerOverlay');
  const cfgBox=ov.querySelector('.bed-config-modal');
  if(mgrOv && cfgBox){
    const mgrBox=mgrOv.querySelector('.modal-content');
    if(mgrBox){
      /* 두 팝업의 총 폭 기준 좌우 배치 */
      const mgrRect=mgrBox.getBoundingClientRect();
      const cfgW=400, gap=16;
      const totalW=mgrRect.width+gap+cfgW;
      const startX=Math.max(20,(window.innerWidth-totalW)/2);
      const topY=Math.max(40,(window.innerHeight-Math.max(mgrRect.height,560))/2);
      /* 이용 등록 팝업 — 왼쪽 고정 */
      mgrBox.style.position='fixed';mgrBox.style.transform='none';mgrBox.style.margin='0';
      mgrBox.style.left=startX+'px';mgrBox.style.top=topY+'px';
      mgrBox.style.right='auto';mgrBox.style.bottom='auto';
      /* 침상 구성 팝업 — 오른쪽 */
      cfgBox.style.position='fixed';cfgBox.style.transform='none';cfgBox.style.margin='0';
      cfgBox.style.left=(startX+mgrRect.width+gap)+'px';cfgBox.style.top=topY+'px';
      cfgBox.style.right='auto';cfgBox.style.bottom='auto';
    }
  }
  /* 등장 애니메이션 */
  if(cfgBox){
    cfgBox.style.opacity='0';cfgBox.style.transform=(cfgBox.style.transform||'none')+' scale(0.94) translateY(8px)';
    requestAnimationFrame(function(){
      cfgBox.style.opacity='1';
      /* position:fixed 이면 transform을 scale만 제거, 아니면 원래 중앙 배치 유지 */
      if(cfgBox.style.position==='fixed'){cfgBox.style.transform='none';}
      else{cfgBox.style.transform='';}
    });
  }
  /* 헤더 드래그로 이동 가능 */
  _makeDraggable(cfgBox);
  _bedRenderConfig();

  /* 바깥 클릭 닫기 — overlay가 pointer-events:none 이라 document 캡처 리스너로 감지.
     bedManager 클릭으로 전파되지 않도록 stopPropagation. */
  setTimeout(function(){
    function _cfgOutsideClose(e){
      const curOv=document.getElementById('bedConfigOverlay');
      if(!curOv){document.removeEventListener('mousedown',_cfgOutsideClose,true);return;}
      const modal=curOv.querySelector('.bed-config-modal');
      if(!modal)return;
      if(modal.contains(e.target))return; /* 팝업 안 클릭은 무시 */
      e.stopPropagation();
      _bedCloseConfig();
      document.removeEventListener('mousedown',_cfgOutsideClose,true);
    }
    document.addEventListener('mousedown',_cfgOutsideClose,true);
  },50);
}

/* 침상 구성 팝업 닫기 — 부드러운 애니메이션 */
function _bedCloseConfig(){
  const ov=document.getElementById('bedConfigOverlay');
  if(!ov||ov._closing)return;
  ov._closing=true;
  const modal=ov.querySelector('.modal-content');
  if(modal){
    modal.style.transition='opacity 0.22s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)';
    modal.style.opacity='0';
    modal.style.transform=(modal.style.position==='fixed'?'':'')+' scale(0.94) translateY(8px)';
  }
  setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},230);
}

function _bedRenderConfig(){
  const body=document.getElementById('bedConfigBody');
  if(!body) return;
  const count=S._bedConfig.beds.length;
  const placement=S._bedConfig.placement||'left';
  let html='<div style="margin-bottom:16px">'
    +'<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px">침상 수</div>'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<button class="btn btn-sm" data-action="cfgCount" data-delta="-1" style="width:32px;height:32px;padding:0;font-size:16px;background:var(--bg2);border:1px solid var(--bdr);color:var(--t1)">−</button>'
    +'<span style="font-size:18px;font-weight:700;color:var(--t1);min-width:30px;text-align:center">'+count+'</span>'
    +'<button class="btn btn-sm" data-action="cfgCount" data-delta="1" style="width:32px;height:32px;padding:0;font-size:16px;background:var(--bg2);border:1px solid var(--bdr);color:var(--t1)">+</button>'
    +'<span style="font-size:10px;color:var(--t3);margin-left:4px">(최대 10개)</span>'
    +'</div></div>';
  /* 침상 미리보기 */
  html+='<div style="margin-bottom:16px">'
    +'<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px">침상 목록</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px">';
  S._bedConfig.beds.forEach(function(bed,i){
    html+='<span style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--bg2);color:var(--t2);border:1px solid var(--bdr)">'+_bedLabel(bed,i)+'</span>';
  });
  html+='</div></div>';
  /* direction: 가로/세로 */
  const direction=S._bedConfig.direction||'row';
  html+='<div style="margin-bottom:16px">'
    +'<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px">침상 나열 방식</div>'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn btn-sm" data-action="cfgDirection" data-dir="row" style="flex:1;font-size:11px;'+(direction==='row'?'background:var(--cyan);color:#fff;border:1px solid var(--cyan)':'background:transparent;border:1px solid var(--bdr);color:var(--t2)')+'">가로 나열</button>'
    +'<button class="btn btn-sm" data-action="cfgDirection" data-dir="col" style="flex:1;font-size:11px;'+(direction==='col'?'background:var(--cyan);color:#fff;border:1px solid var(--cyan)':'background:transparent;border:1px solid var(--bdr);color:var(--t2)')+'">세로 나열</button>'
    +'</div>'
    +'<div style="font-size:10px;color:var(--t2);margin-top:4px">'+(direction==='row'?'침상을 옆으로 나란히 배치':'침상을 위에서 아래로 쌓기')+'</div>'
    +'</div>';
  /* placement: 보건교사 책상 기준 위치 */
  html+='<div style="margin-bottom:16px">'
    +'<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px">보건교사 책상으로부터</div>'
    +'<div style="display:flex;gap:8px">';
  if(direction==='row'){
    html+='<button class="btn btn-sm" style="flex:1;font-size:11px;'+(placement==='left'?'background:var(--cyan);color:#fff;border:1px solid var(--cyan)':'background:transparent;border:1px solid var(--bdr);color:var(--t2)')+'" data-action="cfgPlacement" data-placement="left">책상 앞쪽</button>'
      +'<button class="btn btn-sm" style="flex:1;font-size:11px;'+(placement==='right'?'background:var(--cyan);color:#fff;border:1px solid var(--cyan)':'background:transparent;border:1px solid var(--bdr);color:var(--t2)')+'" data-action="cfgPlacement" data-placement="right">책상 뒤쪽</button>';
  } else {
    html+='<button class="btn btn-sm" style="flex:1;font-size:11px;'+(placement==='left'?'background:var(--cyan);color:#fff;border:1px solid var(--cyan)':'background:transparent;border:1px solid var(--bdr);color:var(--t2)')+'" data-action="cfgPlacement" data-placement="left">책상 왼편</button>'
      +'<button class="btn btn-sm" style="flex:1;font-size:11px;'+(placement==='right'?'background:var(--cyan);color:#fff;border:1px solid var(--cyan)':'background:transparent;border:1px solid var(--bdr);color:var(--t2)')+'" data-action="cfgPlacement" data-placement="right">책상 오른편</button>';
  }
  html+='</div>'
    +'</div>';
  /* 타이머 표시 모드, 저장 버튼 제거됨 */
  body.innerHTML=html;
  /* event delegation — 중복 등록 방지 (매 렌더마다 새 리스너 쌓이면 +1 이 +2, +4 로 증가하는 버그 방지) */
  if(!body._bedCfgBound){
    body._bedCfgBound=true;
    body.addEventListener('click',function(e){
      const el=e.target.closest('[data-action]');if(!el)return;
      const action=el.dataset.action;
      if(action==='cfgCount'){_bedConfigChangeCount(parseInt(el.dataset.delta,10));}
      else if(action==='cfgDirection'){_bedConfigSetDirection(el.dataset.dir);}
      else if(action==='cfgPlacement'){_bedConfigSetPlacement(el.dataset.placement);}
    });
  }
}

function _bedConfigChangeCount(delta){
  const newCount=S._bedConfig.beds.length+delta;
  if(newCount<1||newCount>10) return;
  if(delta>0){
    let _bedNextId=1;
    S._bedConfig.beds.forEach(function(b){ if(b.id>=_bedNextId) _bedNextId=b.id+1; });
    S._bedConfig.beds.push({id:_bedNextId});
  } else {
    /* remove last bed; check if it's occupied */
    const lastBed=S._bedConfig.beds[S._bedConfig.beds.length-1];
    const inUse=S._bedUsage.find(function(u){ return u.bedId===lastBed.id; });
    if(inUse){ bus.emit('toast:show', {text: '사용 중인 침상은 삭제할 수 없습니다'}); return; }
    S._bedConfig.beds.pop();
  }
  _saveBedConfig();
  _bedRenderConfig();
  if(document.getElementById('bedManagerBody')) _bedRenderBody();
  bus.emit('toast:save');
}

function _bedConfigSetPlacement(p){
  S._bedConfig.placement=p;
  _saveBedConfig();
  _bedRenderConfig();
  if(document.getElementById('bedManagerBody')) _bedRenderBody();
  bus.emit('toast:save');
}
function _bedConfigSetDirection(d){
  S._bedConfig.direction=d;
  _saveBedConfig();
  _bedRenderConfig();
  if(document.getElementById('bedManagerBody')) _bedRenderBody();
  bus.emit('toast:save');
}


/* ── 담임/교과 교사 메시지 — picker 상태 래퍼 (IIFE 내부 변수 접근용) ── */
function _bedTeacherMsgFromPicker(){
  const dur=_bedPickerHour*60+_bedPickerMin;
  if(!_bedCurrentStuId){bus.emit('toast:show', {text: '학생을 먼저 선택하세요.'});return;}
  _openBedTeacherMsg(_bedCurrentStuId,dur);
}

/* ── 퇴실 처리 애니메이션 팝업 (확인/X 버튼 없음, 1.8초 후 자동 닫힘) ── */
function _bedShowReleaseToast(stu){
  if(!stu)return;
  /* _displayOnly: studentName에 이미 학년반번호+이름이 포함 → 학년반 라벨 생략 */
  let gradeClass;
  if(stu._displayOnly){
    gradeClass='';
  } else if(stu.type==='staff'){
    gradeClass=stu.position||'교직원';
  } else {
    gradeClass=(stu.grade||0)+'학년 '+(stu.cls||0)+'반 '+(stu.num||0)+'번';
  }
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.style.zIndex='12500';
  ov.style.background='rgba(0,0,0,0.35)';
  ov.innerHTML='<div class="modal-content" style="width:380px;max-width:92vw;padding:0;transform:scale(0.9);opacity:0;transition:transform 0.28s cubic-bezier(0.34,1.56,0.64,1),opacity 0.28s ease">'
    +'<div style="padding:14px 20px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);border-radius:12px 12px 0 0"><span style="font-size:14px;font-weight:800;color:var(--t1)">🛏 퇴실 처리</span></div>'
    +'<div style="padding:22px 24px;text-align:center">'
    +'<div style="font-size:32px;margin-bottom:10px">✅</div>'
    +'<div style="font-size:13px;color:var(--t1);line-height:1.7">'+(gradeClass?'<b style="color:var(--cyan)">'+escHtml(gradeClass)+'</b> ':'')+'<b style="color:var(--cyan)">'+escHtml(stu.name||'')+'</b>'+(stu.type==='staff'?'':' 학생')+'의<br>퇴실 처리가 완료되었습니다.</div>'
    +'</div></div>';
  document.body.appendChild(ov);
  /* 열기 애니메이션 */
  requestAnimationFrame(function(){
    const c=ov.querySelector('.modal-content');
    if(c){c.style.transform='scale(1)';c.style.opacity='1';}
  });
  /* 1.8초 후 닫기 애니메이션 */
  setTimeout(function(){
    const c=ov.querySelector('.modal-content');
    if(c){c.style.transform='scale(0.9)';c.style.opacity='0';}
    ov.style.transition='opacity 0.25s ease';ov.style.opacity='0';
    setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},260);
  },1800);
}

/* ── 담임/교과 교사 전송 메시지 팝업 ── */
function _openBedTeacherMsg(stuId,durationMin){
  const stu=getStu(stuId);
  if(!stu){bus.emit('toast:show', {text: '학생 정보를 찾을 수 없습니다.'});return;}
  const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)||'';
  const now=new Date();
  const endMs=now.getTime()+durationMin*60*1000;
  const ed=new Date(endMs);
  const pad=function(n){return (n<10?'0':'')+n;};
  const nowStr=pad(now.getHours())+':'+pad(now.getMinutes());
  const endStr=pad(ed.getHours())+':'+pad(ed.getMinutes());
  const gradeClass=stu.grade&&stu.cls?(stu.grade+'학년 '+stu.cls+'반'):'';
  const nm=stu.name||'';
  /* 당일 해당 학생의 가장 최근 일반일지 기록에서 증상 조회 */
  let symptoms='';
  try{
    if(typeof S.records!=='undefined'&&Array.isArray(S.records)){
      const today=typeof S.selectedDate!=='undefined'?S.selectedDate:(new Date().getFullYear()+'-'+pad(new Date().getMonth()+1)+'-'+pad(new Date().getDate()));
      const todayRecs=S.records.filter(function(r){return r.date===today&&r.studentId===stuId;});
      if(todayRecs.length){
        const last=todayRecs[todayRecs.length-1];
        symptoms=Array.isArray(last.symptoms)?last.symptoms.join(', '):(last.symptoms||'');
      }
    }
  }catch(e){}
  const symPart=symptoms?(symptoms+' 증상'):'증상';
  const msg='안녕하세요 선생님, 보건교사입니다.\n'
    +gradeClass+' '+nm+' 학생이 '+nowStr+'에 '+symPart+'으로 보건실을 방문하였는데 '
    +endStr+'까지 휴식이 필요할 것 같습니다. '
    +'이후 교실로 복귀하도록 안내하겠습니다.';
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='bedTeacherMsgOverlay';
  ov.style.zIndex='11500';
  ov.innerHTML='<div class="modal-content" style="width:520px;max-width:94vw;padding:0">'
    +'<div style="padding:14px 20px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center">'
    +'<span style="font-size:14px;font-weight:800;color:var(--t1)">📋 담임/교과 교사 전송 메시지</span>'
    +'<span style="cursor:pointer;font-size:18px;color:var(--t3);padding:0 6px" data-action="closeTeacherMsg">✕</span>'
    +'</div>'
    +'<div style="padding:16px 20px">'
    +'<div style="font-size:11px;color:var(--t3);margin-bottom:6px">아래 메시지를 복사해서 담임·교과 교사에게 전달하세요. 필요 시 수정 가능합니다.</div>'
    +'<textarea id="bedTeacherMsgArea" style="width:100%;min-height:160px;font-size:12px;padding:12px;border:1px solid var(--bdr);border-radius:8px;background:var(--card);color:var(--t1);resize:vertical;line-height:1.7;box-sizing:border-box;outline:none;font-family:var(--f)">'+escHtml(msg)+'</textarea>'
    +'<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">'
    +'<button class="btn btn-primary btn-sm" data-action="copyTeacherMsg" style="font-size:11px">📋 클립보드 복사</button>'
    +'</div>'
    +'</div></div>';
  ov.addEventListener('mousedown',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-action="closeTeacherMsg"]').forEach(function(el){
    el.addEventListener('click',function(){closeModalGracefully('bedTeacherMsgOverlay');});
  });
  const copyBtn=ov.querySelector('[data-action="copyTeacherMsg"]');
  if(copyBtn)copyBtn.addEventListener('click',function(){
    const t=document.getElementById('bedTeacherMsgArea');
    if(t){navigator.clipboard.writeText(t.value).then(function(){bus.emit('toast:show', {text: '클립보드에 복사되었습니다.'});closeModalGracefully('bedTeacherMsgOverlay');});}
  });
}

let _bedMinimized=false;   /* 침상 카드 최소화 상태 — DOM 밖 보관(1초 재렌더에도 유지) */

/* ── 좌측 사이드바에 침상 이용 현황 카드 렌더 ── */
function renderBedSidebarCard(){
  const card=document.getElementById('sideBedUsage');
  const body=document.getElementById('sideBedBody');
  const header=document.getElementById('sideBedHeader');
  if(!card||!body)return;
  const sidebar=document.querySelector('.sidebar');
  const beds=(S._bedConfig&&S._bedConfig.beds)||[];
  const usage=S._bedUsage||[];
  const active=usage.filter(function(u){return u.endTime>Date.now();});
  /* 침상 이용자가 없으면 카드 숨김 (기본) */
  if(beds.length===0||active.length===0){
    card.style.display='none';
    card.classList.remove('bed-min');
    if(sidebar)sidebar.classList.remove('has-bed-card');
    _bedMinimized=false;            /* 비면 다음 표시는 최대화 상태로 */
    return;
  }
  card.style.display='';
  if(sidebar)sidebar.classList.add('has-bed-card');
  /* ── 최소화 상태 — 컴팩트 한 줄/침상 + 최대화 버튼 ── */
  if(_bedMinimized){
    card.classList.add('bed-min');
    if(header)header.innerHTML='';
    body.innerHTML=_bedBuildMinimizedHTML(active,beds);
    _bedFitSidebar(card,sidebar);
    return;
  }
  /* ── 최대화 상태 (기본) ── */
  card.classList.remove('bed-min');
  if(header)header.innerHTML=_bedBuildHeaderHTML(active.length,beds.length);
  let h='';
  active.forEach(function(u){
    const bedIdx=beds.findIndex(function(b){return b.id===u.bedId;});
    const bed=bedIdx>=0?beds[bedIdx]:{id:u.bedId};
    const label=_bedLabel(bed,bedIdx>=0?bedIdx:0);
    const stu=getStu(u.studentId);
    const stuName=(stu&&stu.name)||u.studentName||'(이름없음)';
    const stuType=stu&&stu.type==='staff';
    let gradeCls='';
    if(stu&&!stuType&&stu.grade){gradeCls=stu.grade+'-'+(stu.cls||'')+(stu.num?' '+stu.num+'번':'');}
    else if(stuType){gradeCls=stu.position||'교직원';}
    const diff=Math.max(0,u.endTime-Date.now());
    const mm=String(Math.floor(diff/60000)).padStart(2,'0');
    const ss=String(Math.floor((diff%60000)/1000)).padStart(2,'0');
    /* 종료 시각 (사용자 요청 2026-05-19) — HH:MM (24시간) */
    const _endD=new Date(u.endTime);
    const _endStr=String(_endD.getHours()).padStart(2,'0')+':'+String(_endD.getMinutes()).padStart(2,'0');
    const stuIdAttr=stu&&stu.id?(' data-stu-id="'+escHtml(String(stu.id))+'"'):'';
    h+='<div class="side-bed-row" data-action="sideBedHover" data-bed-id="'+u.bedId+'"'+stuIdAttr+' title="클릭하여 이용 시간 수정" style="display:flex;align-items:center;gap:6px;padding:6px 8px;margin-bottom:4px;border-radius:8px;background:rgba(239,68,68,0.06);border-left:3px solid #dc2626;cursor:pointer">'
      +'<span style="font-size:10px;font-weight:700;color:#dc2626;min-width:34px;flex-shrink:0">'+escHtml(label)+'</span>'
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:11px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(stuName)+'</div>'
      +(gradeCls?'<div style="font-size:9px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(gradeCls)+'</div>':'')
      +'</div>'
      /* 2층 표시 — 언제까지(종료시각) / 남은 시간(mm:ss) — 맑은 고딕 통일 (사용자 요청 2026-05-22) */
      +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;line-height:1.25">'
      +'<span style="font-size:9px;color:var(--t3);font-weight:600">종료 시각: <span style="color:#dc2626;font-weight:700">'+_endStr+'</span></span>'
      +'<span style="font-size:9px;color:var(--t3);font-weight:600">남은 시간: <span style="color:#dc2626;font-weight:700">'+mm+':'+ss+'</span></span>'
      +'</div>'
      +'<button data-action="sideBedRelease" data-bed-id="'+u.bedId+'" title="퇴실 처리" style="padding:3px 7px;font-size:9px;font-weight:700;background:rgba(239,68,68,0.1);color:#dc2626;border:1px solid rgba(239,68,68,0.3);border-radius:5px;cursor:pointer;font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;flex-shrink:0">퇴실</button>'
      +'</div>';
  });
  body.innerHTML=h;
  _bedFitSidebar(card,sidebar);
}

/* 카드 위치를 사이드바와 동일한 좌측·너비로 맞추고, 가려지지 않도록 위 카드들의 max-height 계산 */
function _bedFitSidebar(card,sidebar){
  if(sidebar){
    const sb=sidebar.getBoundingClientRect();
    card.style.left=sb.left+'px';
    card.style.width=sb.width+'px';
  }
  /* 사이드 카드 사이즈만큼 sideRecentCard·sideVisitHistory 의 max-height 동적 계산
     → 카드가 가려지지 않도록 위로 줄어듦 */
  setTimeout(function(){
    try{
      const cardRect=card.getBoundingClientRect();
      const recent=document.getElementById('sideRecentCard');
      const visit=document.getElementById('sideVisitHistory');
      [recent,visit].forEach(function(el){
        if(!el||el.style.display==='none')return;
        const elRect=el.getBoundingClientRect();
        const max=Math.max(120,cardRect.top-elRect.top-12);
        el.style.setProperty('--side-recent-max',max+'px');
      });
    }catch(e){}
  },10);
}

/* 헤더 HTML (최대화) — 제목 + (n/m실) + 최소화 버튼(퇴실 버튼과 우측 위치 일치) */
function _bedBuildHeaderHTML(a,b){
  return '<div style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px">'
    +'<span>🛏 침상 이용 현황</span>'
    +'<span style="font-size:9px;color:var(--t3);font-weight:600">('+a+'/'+b+'실)</span>'
    +'<button data-action="bedToggleMinimize" title="최소화" style="margin-left:auto;margin-right:8px;padding:3px 7px;font-size:9px;font-weight:700;background:rgba(148,163,184,0.14);color:var(--t2);border:1px solid rgba(148,163,184,0.4);border-radius:5px;cursor:pointer;font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;flex-shrink:0">최소화</button>'
    +'</div>';
}

/* 본문 HTML (최소화) — "🛏 라벨 이름 11:40 [퇴실] [최대화]" 한 줄/침상 */
function _bedBuildMinimizedHTML(active,beds){
  let h='';
  const n=active.length;
  active.forEach(function(u,i){
    const bedIdx=beds.findIndex(function(b){return b.id===u.bedId;});
    const bed=bedIdx>=0?beds[bedIdx]:{id:u.bedId};
    const label=_bedLabel(bed,bedIdx>=0?bedIdx:0);
    const stu=getStu(u.studentId);
    const stuName=(stu&&stu.name)||u.studentName||'(이름없음)';
    const _endD=new Date(u.endTime);
    const _endStr=String(_endD.getHours()).padStart(2,'0')+':'+String(_endD.getMinutes()).padStart(2,'0');
    h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;'+(i<n-1?'margin-bottom:3px;':'')+'border-radius:7px;background:rgba(239,68,68,0.06);border-left:3px solid #dc2626;font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif">'
      +'<span style="font-size:10px;font-weight:700;color:#dc2626;flex-shrink:0">🛏 '+escHtml(label)+'</span>'
      +'<span style="font-size:11px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">'+escHtml(stuName)+'</span>'
      +'<span style="font-size:9px;color:#dc2626;font-weight:700;flex-shrink:0">'+_endStr+'</span>'
      +'<button data-action="sideBedRelease" data-bed-id="'+u.bedId+'" title="퇴실 처리" style="padding:2px 7px;font-size:9px;font-weight:700;background:rgba(239,68,68,0.1);color:#dc2626;border:1px solid rgba(239,68,68,0.3);border-radius:5px;cursor:pointer;flex-shrink:0">퇴실</button>'
      +(i===0?'<button data-action="bedToggleMinimize" title="최대화" style="padding:2px 7px;font-size:9px;font-weight:700;background:rgba(148,163,184,0.14);color:var(--t2);border:1px solid rgba(148,163,184,0.4);border-radius:5px;cursor:pointer;flex-shrink:0">최대화</button>':'')
      +'</div>';
  });
  return h;
}

/* 최소화 ↔ 최대화 토글 + 높이 애니메이션 (FLIP / Web Animations API) */
function toggleBedMinimize(){
  const card=document.getElementById('sideBedUsage');
  if(!card||card._bedAnimating)return;
  const startH=card.getBoundingClientRect().height;
  _bedMinimized=!_bedMinimized;
  renderBedSidebarCard();
  const endH=card.getBoundingClientRect().height;
  if(typeof card.animate!=='function'||startH===endH)return;   /* 미지원/높이 동일 → 즉시 전환 */
  card._bedAnimating=true;
  const prevOverflow=card.style.overflow;
  const prevBox=card.style.boxSizing;
  card.style.overflow='hidden';
  card.style.boxSizing='border-box';
  card.classList.add('bed-anim');
  const anim=card.animate(
    [{height:startH+'px'},{height:endH+'px'}],
    {duration:280,easing:'cubic-bezier(.4,0,.2,1)'}
  );
  const cleanup=function(){
    card.style.overflow=prevOverflow;
    card.style.boxSizing=prevBox;
    card.classList.remove('bed-anim');
    card._bedAnimating=false;
  };
  anim.onfinish=cleanup;
  anim.oncancel=cleanup;
}

/* 윈도우 리사이즈 시 카드 위치/너비 재계산 */
if(typeof window!=='undefined'){
  window.addEventListener('resize',function(){try{renderBedSidebarCard();}catch(e){}});
}

/* 사이드 카드의 퇴실 버튼 클릭 + 행 호버 → 방문 이력 표시 위임 */
if(typeof document!=='undefined'){
  /* 최소화/최대화 버튼 → 토글 */
  document.addEventListener('click',function(e){
    const btn=e.target.closest('[data-action="bedToggleMinimize"]');
    if(!btn)return;
    e.preventDefault();
    e.stopPropagation();
    toggleBedMinimize();
  });
  document.addEventListener('click',function(e){
    const btn=e.target.closest('[data-action="sideBedRelease"]');
    if(!btn)return;
    e.preventDefault();
    e.stopPropagation();
    const bedId=parseInt(btn.dataset.bedId,10);
    if(isNaN(bedId))return;
    const u=S._bedUsage.find(function(x){return x.bedId===bedId;});
    let stu=null;
    if(u){
      const _s=getStu(u.studentId);
      if(_s&&!_s._notFound)stu=_s;
      else stu={name:u.studentName||'',_displayOnly:true,type:'student',grade:0,cls:0,num:0};
    }
    /* 일반 일지 record 의 퇴실 시간을 현재 시각으로 업데이트 (사용자 요청 2026-05-19). */
    try{
      if(u && Array.isArray(S.records)){
        let _rec=null;
        if(u.recordId)_rec=S.records.find(function(r){return r.id===u.recordId;});
        if(!_rec && u.startTime && u.studentId){
          /* fallback — recordId 없는 옛 침상 데이터: 같은 학생의 같은 날 가장 최근 레코드 */
          const _ds=new Date(u.startTime);
          const _ymd=_ds.getFullYear()+'-'+String(_ds.getMonth()+1).padStart(2,'0')+'-'+String(_ds.getDate()).padStart(2,'0');
          _rec=S.records.filter(function(r){return r.studentId===u.studentId && r.date===_ymd;}).pop();
        }
        if(_rec){
          const _n=new Date();
          _rec.timeOut=String(_n.getHours()).padStart(2,'0')+':'+String(_n.getMinutes()).padStart(2,'0');
          _rec._dirty=true;
          if(typeof saveRecordNow==='function')saveRecordNow(_rec);
          bus.emit('render:daily');
        }
      }
    }catch(err){console.warn('[bed] 퇴실 시각 업데이트 실패:',err);}
    S._bedUsage=S._bedUsage.filter(function(x){return x.bedId!==bedId;});
    _saveBedUsage();
    if(stu&&typeof _bedShowReleaseToast==='function'){try{_bedShowReleaseToast(stu);}catch(err){}}
    /* 침상 이용 등록 모달이 열려있으면 갱신 */
    if(typeof _bedRenderBody==='function'){try{_bedRenderBody();}catch(err){}}
  });
  /* 침상 행 클릭 → 침상 관리 모달 + 해당 침상 이용 시간 편집 picker 재오픈 (사용자 요청 2026-06-15).
   *  퇴실 버튼 클릭은 제외(별도 핸들러). 같은 document click 리스너지만 release 가 stopPropagation 만
   *  하므로 여기서도 명시적으로 release 타깃을 걸러낸다. */
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-action="sideBedRelease"]'))return;
    const row=e.target.closest('[data-action="sideBedHover"]');
    if(!row)return;
    const bedId=parseInt(row.dataset.bedId,10);
    if(isNaN(bedId))return;
    _bedEditFromSidebar(bedId);
  });
  /* 침상 행에 마우스 올리면 그 학생의 방문 이력 표시 */
  document.addEventListener('mouseover',function(e){
    const row=e.target.closest('[data-action="sideBedHover"]');
    if(!row)return;
    const sid=row.dataset.stuId;
    if(!sid||S._visitHistoryLocked)return;
    try{showVisitHistory(sid);}catch(err){}
  });
  document.addEventListener('mouseout',function(e){
    const row=e.target.closest('[data-action="sideBedHover"]');
    if(!row)return;
    /* 다른 침상 행 또는 자식 요소로 이동한 경우는 무시 */
    if(e.relatedTarget&&row.contains(e.relatedTarget))return;
    if(e.relatedTarget&&e.relatedTarget.closest&&e.relatedTarget.closest('[data-action="sideBedHover"]'))return;
    if(S._visitHistoryLocked)return;
    try{_hideVisitHistory();}catch(err){}
  });
}

/* 1초마다 사이드 카드의 카운트다운 갱신 */
setInterval(function(){
  try{
    const card=document.getElementById('sideBedUsage');
    if(card&&card.style.display!=='none')renderBedSidebarCard();
  }catch(e){}
},1000);

/* ── 특정 학생의 침상 사용을 해제 (일반 일지 칩 삭제 등에서 호출) ── */
function releaseBedByStudentId(studentId){
  if(studentId==null)return false;
  _loadBedUsage();
  const before=S._bedUsage.length;
  S._bedUsage=S._bedUsage.filter(function(u){return String(u.studentId)!==String(studentId);});
  if(S._bedUsage.length===before)return false;
  _saveBedUsage();
  if(typeof _bedRenderBody==='function'){try{_bedRenderBody();}catch(e){}}
  return true;
}

/* ── Public exports ── */
export { openBedManager, releaseBedByStudentId };

