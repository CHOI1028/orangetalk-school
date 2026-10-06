/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   EMS Message + Name/Hover Popup Module
   ═══════════════════════════════════════ */
/* ES Module */
import { S, addEcRecord } from '../../core/app-state.js';
import { getStu, escHtml, getGuardianType, getGuardianContact, getStudentBirth, toDateStr, isHoliday, recsByDate, _recToDbRow, saveData } from '../../core/helpers.js';
import { dailyCloseCtxPopup, dailyClearDragSelect, showVisitHistory, openVitalsEdit } from '../daily/daily-view.js';
import { openBedManager } from '../newsletter/bed-management-view.js';
import { bus } from '../../core/event-bus.js';
import { closeModalWithAnim } from '../daily/daily-autocomplete.js';
import { playQuickMenuSound } from '../../core/ui-utils.js';
import { _makeDraggable, openSymptomCategoryPopup, _symShowHistory } from '../symptom/symptom-view.js';
import { openVisitPass } from '../visit-pass/visit-pass-view.js';
import { hideHeaderTooltip, showHeaderTooltipRight, ecSaveRecords } from '../emergency/emergency-view.js';
'use strict';

/* 증상·처치 변경 시 EMS 미리보기 갱신 — symptom-view.js 가 bus.emit('ems:refresh') 호출 */
bus.on('ems:refresh',function(recId){
  const ov=document.getElementById('emsOverlay');
  if(!ov||!ov.classList.contains('show'))return;
  if(recId!=null&&_emsState&&_emsState.recId!=null&&recId!==_emsState.recId)return;
  if(typeof emsUpdatePreview==='function')emsUpdatePreview();
  /* 상단 정보행(증상·V/S) 다시 그림 */
  const symEl=document.getElementById('emsInfoArea');
  const row=symEl&&symEl.querySelector('[data-ems-sym-row]');
  if(row&&_emsState&&_emsState.recId!=null){
    const rec=S.records.find(function(r){return r.id===_emsState.recId;});
    const symptoms=rec?(rec.symptoms||[]).join(', '):'';
    const val=row.querySelector('.ems-val');if(val)val.textContent=symptoms;
    row.style.display=symptoms?'':'none';
  }
});

  /* ── EMS mini popup (이름 클릭 시) ── */
  export function showEmsPopup(stuId,e){
    dailyCloseCtxPopup();dailyClearDragSelect();
    closeEmsPopup();
    try{ playQuickMenuSound(); }catch(_){}   /* 이름 클릭 팝업 효과음 (사용자 요청 2026-06-18) */
    /* 가드 즉시 설정 — popup append 전에 render:daily 가 fromRender 호출해도 보호 */
    _emsPopupOpenedAt=Date.now();
    const anchor=e.target.closest('.name-hover-wrap')||e.target;
    const nameRect=anchor.getBoundingClientRect();
    const stu=getStu(stuId);
    const isStaff=stu&&stu.type==='staff';
    const infoText=isStaff?((stu.position||'교직원')+' '+stu.name):(stu?(stu.grade+'학년 '+stu.cls+'반 '+stu.num+'번 '+stu.name):'');

    const tableWrap=document.getElementById('dailyTableWrap');
    const tBot=tableWrap?tableWrap.getBoundingClientRect().bottom:window.innerHeight;
    const tTop=tableWrap?tableWrap.getBoundingClientRect().top:0;
    const spaceBelow=tBot-nameRect.bottom;
    const spaceAbove=nameRect.top-tTop;
    const btnPopH=220;

    const pop=document.createElement('div');
    pop.className='ems-mini-popup';
    pop.id='emsMiniPopup';
    const _curRec=S.records.find(function(r){return r.studentId===stuId&&r.date===S.selectedDate;});
    let hasSurvey=false;try{const svHist=_svGetHistory();hasSurvey=svHist.some(function(s){return s.studentId===stuId;});}catch(e){}
    pop.innerHTML='<div style="padding:8px 14px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--bdr);background:var(--bg2);border-radius:8px 8px 0 0">'+(isStaff?'👔':'👤')+' '+escHtml(infoText)+'</div>'
      +'<div class="ems-msg-link" data-action="visit-pass">🖨 커스텀 양식 출력</div>'
      +'<div class="ems-msg-link" data-action="bed-manager">🛏 침상 이용 등록</div>'
      +'<div class="ems-msg-link" data-action="symptom">💊 증상 선택 및 처치 열기</div>'
      +'<div class="ems-msg-link" data-action="jump-date">📅 특정 날짜로 이동</div>'
      +'<div class="ems-msg-link" data-action="full-history">📖 전체 방문 이력 보기</div>'
      +'<div class="ems-msg-link'+(hasSurvey?'':' disabled')+'"'+(hasSurvey?' data-action="survey"':' style="opacity:0.4;cursor:default" data-action="survey-disabled"')+'>📋 올해 건강 조사 설문 보기</div>'
      +'<div class="ems-msg-link danger" data-action="ems-msg">🚑 구급대에 보낼 메시지 작성</div>'
      +'<div class="ems-msg-link danger" data-action="delete">🗑 삭제</div>';
    /* ── 이벤트 위임: data-action 클릭 ── */
    pop.addEventListener('click',function(ev){
      const link=ev.target.closest('[data-action]');if(!link)return;
      ev.stopPropagation();
      const action=link.dataset.action;
      if(link.classList.contains('disabled'))return;
      closeEmsPopup();
      switch(action){
        case 'visit-pass':{const dr=recsByDate(S.selectedDate);const rc=dr.find(function(r){return r.studentId===stuId;});if(rc)S.dailySelectedRecId=rc.id;openVisitPass(rc?rc.id:undefined);break;}   /* recId 명시 전달 — 팝업 경로 인적사항 미기입 회귀 수정 (2026-06-11) */
        case 'bed-manager':openBedManager(stuId);break;
        case 'symptom':{const rc2=S.records.find(function(r){return r.studentId===stuId&&r.date===S.selectedDate;});if(rc2){openSymptomCategoryPopup(rc2.id);}else{bus.emit('toast:show', {text: '해당 날짜에 기록이 없습니다.'});}break;}
        case 'jump-date':_dailyJumpToDate(stuId);break;
        case 'full-history':_symShowHistory(stuId);break;   /* 전체 방문 이력 팝업 (사용자 요청 2026-08-26) */
        case 'survey':svOpenPanel('stats',{studentId:stuId});break;
        case 'ems-msg':openEmsMsg(stuId);break;
        case 'delete':_dailyDeleteRecord(stuId);break;
      }
    });
    /* ── 비활성 항목 툴팁 ── */
    pop.querySelectorAll('[data-action="survey-disabled"]').forEach(function(el){
      el.addEventListener('mouseenter',function(ev){showHeaderTooltipRight(ev,'설문 응답이 있는 경우에만 활성화됩니다.');});
      el.addEventListener('mouseleave',function(){hideHeaderTooltip();});
    });
    let bLeft=nameRect.right+12;
    if(bLeft+320>window.innerWidth) bLeft=Math.max(4,nameRect.right-320);
    pop.style.left=bLeft+'px';
    pop.style.top='0px';
    pop.style.visibility='hidden';
    document.body.appendChild(pop);
    const realBtnH=pop.offsetHeight;
    let bTop;
    if(spaceBelow>=realBtnH){bTop=nameRect.top;}
    else if(spaceAbove>=realBtnH){bTop=nameRect.top-realBtnH;}
    else {bTop=tBot-realBtnH-4;}
    if(bTop<tTop)bTop=tTop+4;
    pop.style.top=bTop+'px';
    pop.style.visibility='';

    const srcPop=anchor.querySelector('.name-hover-pop');
    if(srcPop){
      if(_nameHoverEl){_nameHoverEl.remove();_nameHoverEl=null;}
      const clone=document.createElement('div');
      clone.id='nameHoverFloat';
      clone.className='ems-hover-float';
      clone.style.cssText='position:fixed;min-width:230px;max-width:290px;background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:7px 9px;z-index:9000;font-size:10px;line-height:1.45;color:var(--t2);box-shadow:0 8px 32px rgba(0,0,0,0.15),0 2px 8px rgba(0,0,0,0.06);pointer-events:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)';
      clone.innerHTML=srcPop.innerHTML;
      clone.style.left='0px';clone.style.top='0px';clone.style.visibility='hidden';
      document.body.appendChild(clone);
      const realHoverH=clone.offsetHeight;
      const hoverW=clone.offsetWidth;
      let hLeft=nameRect.left-hoverW-6;
      if(hLeft<4)hLeft=4;
      let hTop;
      if(nameRect.top+realHoverH<=tBot){hTop=nameRect.top;}
      else {hTop=nameRect.top-realHoverH;if(hTop<tTop)hTop=tTop+4;}
      clone.style.left=hLeft+'px';
      clone.style.top=hTop+'px';
      clone.style.visibility='';
      _nameHoverEl=clone;
      _emsPopupHoverPop=clone;
    }
    /* 외부 클릭 리스너는 다음 tick 에 등록 (현재 click 이 capture 단계에서 잡히지 않도록) */
    setTimeout(function(){document.addEventListener('click',_emsPopupOutClick,true);},0);
  }
  let _emsPopupHoverPop=null;
  let _emsPopupOpenedAt=0;
  function _emsPopupOutClick(e){
    const pop=document.getElementById('emsMiniPopup');
    if(pop&&!pop.contains(e.target)){closeEmsPopup();}
  }
  export function closeEmsPopup(opts){
    if(opts&&opts.fromRender&&_emsPopupOpenedAt&&Date.now()-_emsPopupOpenedAt<250){return;}
    const pop=document.getElementById('emsMiniPopup');
    if(pop)pop.remove();
    if(_emsPopupHoverPop){_emsPopupHoverPop.remove();_emsPopupHoverPop=null;_nameHoverEl=null;}
    document.removeEventListener('click',_emsPopupOutClick,true);
    _emsPopupOpenedAt=0;
  }

  function _emsCopyTeacherMsg(stuId){
    const stu=getStu(stuId);const rec=S.records.find(function(r){return r.studentId===stuId&&r.date===S.selectedDate;});
    const name=stu?stu.name:'';const timeIn=rec?rec.timeIn:'';const symptoms=rec?(rec.symptoms||[]).join(', '):'';
    const msg='안녕하세요 선생님, 보건교사입니다.\n'+name+' 학생이 '+timeIn+'에 '+symptoms+' 증상으로 보건실을 방문하였습니다.';
    navigator.clipboard.writeText(msg).then(function(){bus.emit('toast:show', {text: '담임 메시지가 복사되었습니다.'});});
  }
  function _openBedTeacherMsg(stuId,bedMinutes){
    const stu=getStu(stuId);const rec=S.records.find(function(r){return r.studentId===stuId&&r.date===S.selectedDate;});
    const name=stu?stu.name:'';const timeIn=rec?rec.timeIn:'';const symptoms=rec?(rec.symptoms||[]).join(', '):'';
    const now=new Date();
    const endTime=new Date(now.getTime()+bedMinutes*60*1000);
    let endH=endTime.getHours();let endM=endTime.getMinutes();
    if(_bedPickerTimerMode==='endtime'){endH=_bedPickerHour;endM=_bedPickerMin;}
    const endStr=endH+'시'+(endM>0?' '+endM+'분':'');
    const defaultMsg='안녕하세요 선생님, 보건교사입니다.\n'+name+' 학생이 '+timeIn+'에 '+symptoms+' 증상으로 보건실을 방문하였는데 학생에게 침상 안정이 필요할 것 같습니다. '+endStr+'까지 침상 안정을 취하도록 해도 될까요?';
    const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='bedTeacherMsgOverlay';
    ov.style.background='rgba(0,0,0,0.5)';ov.style.zIndex='12000';
    ov.innerHTML='<div class="modal-content" style="width:460px;max-width:94vw;padding:0">'
      +'<div style="padding:14px 18px;background:var(--bg2);border-bottom:1px solid var(--bdr);border-radius:10px 10px 0 0"><div style="font-size:13px;font-weight:800;color:var(--t1)">📋 담임/교과 교사 전송 메시지</div></div>'
      +'<div style="padding:16px"><textarea id="bedTeacherMsgArea" style="width:100%;height:120px;resize:vertical;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:10px;color:var(--t1);font-size:12px;font-family:var(--f);line-height:1.7;outline:none;box-sizing:border-box">'+defaultMsg+'</textarea>'
      +'<div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="bedTeacherMsgCopyBtn" style="padding:8px 18px;font-size:12px;font-weight:700;background:#0891b2;color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:var(--f)">📋 클립보드에 복사</button></div></div></div>';
    /* 이 textarea 는 클립보드 복사 전용(저장 안 함) — 입력 시 "저장 중" 거짓 토스트 제거 (사용자 지시 2026-06-15) */
    const _btCopyBtn=ov.querySelector('#bedTeacherMsgCopyBtn');
    if(_btCopyBtn)_btCopyBtn.addEventListener('click',function(){
      const t=document.getElementById('bedTeacherMsgArea');
      if(t)navigator.clipboard.writeText(t.value).then(function(){bus.emit('toast:blue', {text: '클립보드에 복사되었습니다.'});const o=document.getElementById('bedTeacherMsgOverlay');if(o)closeModalWithAnim(o);});
    });
    ov.addEventListener('click',function(e){if(e.target===ov)closeModalWithAnim(ov);});
    document.body.appendChild(ov);
  }

  function _closeSvOverlay(ov){
    ov.classList.remove('show-anim');
    setTimeout(function(){if(ov.parentNode)ov.remove();},250);
  }

  /* ── 특정 날짜로 이동 (달력 UI) ── */
  function _dailyJumpToDate(stuId){
    const rec=recsByDate(S.selectedDate).find(function(r){return r.studentId===stuId;});
    if(!rec)return;
    const ov=document.createElement('div');ov.className='sv-modal-overlay';ov.id='dailyMoveOverlay';
    let yr=S.calYear, mo=S.calMonth;
    const monthNames=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    function renderMoveCal(){
      const first=new Date(yr,mo,1), last=new Date(yr,mo+1,0);
      const startDay=first.getDay(), dim=last.getDate(), prevLast=new Date(yr,mo,0).getDate();
      const today=toDateStr(new Date());
      let yp='<div class="mcal-popup">';
      { const _ny=new Date().getFullYear(); for(let y=_ny-4;y<=_ny;y++)yp+='<div class="mcal-popup-item'+(y===yr?' active':'')+'" data-dm-yr="'+y+'">'+y+'</div>'; }
      yp+='</div>';
      let mp='<div class="mcal-popup" style="min-width:140px;display:none;flex-wrap:wrap;gap:2px;max-height:none;overflow:visible">';
      for(let m=0;m<12;m++)mp+='<div class="mcal-popup-item'+(m===mo?' active':'')+'" data-dm-mo="'+m+'" style="width:45px">'+monthNames[m]+'</div>';
      mp+='</div>';
      let h='<div style="background:var(--card);border-radius:12px;padding:20px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.4)">';
      h+='<div style="text-align:center;font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:10px">📅 이동할 날짜를 선택하세요</div>';
      h+='<div class="mcal-hdr" style="margin-bottom:8px">';
      h+='<div class="mcal-nav"><button class="mcal-btn" id="dmPrev">◂</button></div>';
      h+='<div class="mcal-title"><span class="mcal-year">'+yr+'년'+yp+'</span> <span class="mcal-month">'+monthNames[mo]+mp+'</span></div>';
      h+='<div class="mcal-nav"><button class="mcal-btn" id="dmNext">▸</button></div>';
      h+='</div>';
      h+='<div class="mcal-grid">';
      ['일','월','화','수','목','금','토'].forEach(function(d,i){
        let cls='mcal-dow';if(i===0)cls+=' sun';if(i===6)cls+=' sat';
        h+='<div class="'+cls+'">'+d+'</div>';
      });
      for(let i=startDay-1;i>=0;i--)h+='<div class="mcal-cell other"><span class="day-n">'+(prevLast-i)+'</span></div>';
      for(let d=1;d<=dim;d++){
        const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        const dow=new Date(yr,mo,d).getDay();
        const hol=isHoliday(ds);
        const holName=S.koreanHolidays[ds]||'';
        let cls='mcal-cell';
        if(ds===today)cls+=' today';
        if(dow===0)cls+=' sun';
        if(dow===6)cls+=' sat';
        if(hol&&dow!==0&&dow!==6)cls+=' holiday';
        h+='<div class="'+cls+'" data-move-date="'+ds+'"'+(holName?' title="'+holName+'"':'')+'><span class="day-n">'+d+'</span></div>';
      }
      const totalCells=startDay+dim;const rem=(7-totalCells%7)%7;
      for(let i=1;i<=rem;i++)h+='<div class="mcal-cell other"><span class="day-n">'+i+'</span></div>';
      h+='</div></div>';
      ov.innerHTML=h;
      ov.querySelectorAll('.mcal-month .mcal-popup').forEach(function(p){p.style.display='';p.style.flexWrap='wrap';p.style.gap='2px';});
      ov.querySelector('#dmPrev').addEventListener('click',function(e){e.stopPropagation();mo--;if(mo<0){mo=11;yr--;}renderMoveCal();});
      ov.querySelector('#dmNext').addEventListener('click',function(e){e.stopPropagation();mo++;if(mo>11){mo=0;yr++;}renderMoveCal();});
      ov.querySelectorAll('[data-dm-yr]').forEach(function(el){
        el.addEventListener('click',function(e){e.stopPropagation();yr=parseInt(this.dataset.dmYr);renderMoveCal();});
      });
      ov.querySelectorAll('[data-dm-mo]').forEach(function(el){
        el.addEventListener('click',function(e){e.stopPropagation();mo=parseInt(this.dataset.dmMo);renderMoveCal();});
      });
      ov.querySelectorAll('[data-move-date]').forEach(function(el){
        el.addEventListener('click',function(e){
          e.stopPropagation();
          const newDate=this.dataset.moveDate;
          console.log('[date-move-single] id='+rec.id+' '+rec.date+' → '+newDate);
          rec.date=newDate;
          rec._dirty=true;
          /* 단일 기록 이동 — 디바운스 없이 즉시 DB 반영 */
          if(window.electronAPI&&window.electronAPI.recordsDailyUpdate){
            const row=_recToDbRow(rec);
            window.electronAPI.recordsDailyUpdate(row).then(function(res){
              if(res&&res.success){delete rec._dirty;console.log('[date-move-single] OK id='+row.id);}
              else console.error('[date-move-single] FAIL',res);
            }).catch(function(err){console.error('[date-move-single] ERROR',err);});
          } else {
            saveData();
          }
          bus.emit('render:daily');bus.emit('render:calendar');bus.emit('render:sidebar');
          _closeSvOverlay(ov);
          bus.emit('toast:show', {text: '해당 날짜로 이동하였습니다.'});
        });
      });
    }
    renderMoveCal();
    ov.addEventListener('click',function(e){if(e.target===ov)_closeSvOverlay(ov);});
    document.body.appendChild(ov);
    requestAnimationFrame(function(){requestAnimationFrame(function(){ov.classList.add('show-anim');});});
  }
  /* ── 방문 기록 삭제 ── */
  function _dailyDeleteRecord(stuId){
    const dayRecs=recsByDate(S.selectedDate);
    const rec=dayRecs.find(function(r){return r.studentId===stuId;});
    if(!rec){alert('해당 학생의 방문 기록을 찾을 수 없습니다.');return;}
    const stu=getStu(stuId);
    if(!confirm((stu?stu.name:'')+'의 '+S.selectedDate+' 방문 기록을 삭제하시겠습니까?'))return;
    S.records=S.records.filter(function(r){return r.id!==rec.id;});
    saveData();bus.emit('render:daily');bus.emit('render:calendar');bus.emit('render:sidebar');
  }

  /* ── 이름 호버 팝업 (body에 직접 추가) ── */
  let _nameHoverEl=null;
  document.addEventListener('mouseover',function(e){
    const wrap=e.target.closest('.name-hover-wrap');
    if(!wrap){
      if(_nameHoverEl&&!_emsPopupHoverPop){_nameHoverEl.remove();_nameHoverEl=null;}
      return;
    }
    const srcPop=wrap.querySelector('.name-hover-pop');
    if(!srcPop)return;
    if(_nameHoverEl)return;
    const rect=wrap.getBoundingClientRect();
    const clone=document.createElement('div');
    clone.id='nameHoverFloat';
    clone.style.cssText='position:fixed;min-width:230px;max-width:290px;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:7px 9px;z-index:9000;font-size:10px;line-height:1.45;color:var(--t2);box-shadow:0 4px 16px rgba(0,0,0,0.15);pointer-events:none';
    clone.innerHTML=srcPop.innerHTML;
    clone.style.left='-9999px';clone.style.top='-9999px';
    document.body.appendChild(clone);
    const hW=clone.offsetWidth, hH2=clone.offsetHeight;
    const hTW=document.getElementById('dailyTableWrap');
    const hBot=hTW?hTW.getBoundingClientRect().bottom:window.innerHeight;
    const hTop2=hTW?hTW.getBoundingClientRect().top:0;
    let popLeft=rect.left-hW-6;
    if(popLeft<4)popLeft=4;
    let popTop;
    if(rect.top+hH2<=hBot){popTop=rect.top;}
    else {popTop=rect.top-hH2;if(popTop<hTop2)popTop=hTop2+4;}
    clone.style.left=popLeft+'px';
    clone.style.top=popTop+'px';
    _nameHoverEl=clone;
  });
  document.addEventListener('mouseout',function(e){
    const wrap=e.target.closest('.name-hover-wrap');
    if(!wrap)return;
    const related=e.relatedTarget;
    if(related&&(related.closest&&related.closest('.name-hover-wrap')===wrap))return;
    if(_nameHoverEl&&!_emsPopupHoverPop){_nameHoverEl.remove();_nameHoverEl=null;}
  });

  /* ── VIP 호버 팝업 ── */
  let _vipHoverEl=null;
  document.addEventListener('mouseover',function(e){
    const wrap=e.target.closest('.vip-hover-wrap');
    if(!wrap){if(_vipHoverEl){_vipHoverEl.remove();_vipHoverEl=null;}return;}
    const srcPop=wrap.querySelector('.vip-hover-pop');
    if(!srcPop||!srcPop.textContent.trim())return;
    if(_vipHoverEl)return;
    const rect=wrap.getBoundingClientRect();
    const el=document.createElement('div');
    el.id='vipHoverFloat';
    el.innerHTML=srcPop.innerHTML||srcPop.textContent;
    el.style.left='-9999px';el.style.top='-9999px';
    document.body.appendChild(el);
    const hW=el.offsetWidth, hH=el.offsetHeight;
    const hTW=document.getElementById('dailyTableWrap');
    const hBot=hTW?hTW.getBoundingClientRect().bottom:window.innerHeight;
    const hTop=hTW?hTW.getBoundingClientRect().top:0;
    let popLeft=rect.left-hW-6;
    if(popLeft<4)popLeft=rect.right+6;
    let popTop=rect.top;
    if(rect.top+hH>hBot)popTop=rect.top-hH;
    if(popTop<hTop)popTop=hTop+4;
    el.style.left=popLeft+'px';el.style.top=popTop+'px';
    _vipHoverEl=el;
  });
  document.addEventListener('mouseout',function(e){
    const wrap=e.target.closest('.vip-hover-wrap');
    if(!wrap)return;
    const related=e.relatedTarget;
    if(related&&related.closest&&related.closest('.vip-hover-wrap')===wrap)return;
    if(_vipHoverEl){_vipHoverEl.remove();_vipHoverEl=null;}
  });

  /* ── 대시보드 비활성 하위 탭 호버 팝업 ── */
  let _dashDisabledTip=null;
  document.addEventListener('mouseover',function(e){
    const btn=e.target.closest('.dash-sub-disabled');
    if(!btn){if(_dashDisabledTip){_dashDisabledTip.remove();_dashDisabledTip=null;}return;}
    if(_dashDisabledTip)return;
    const rect=btn.getBoundingClientRect();
    const tip=document.createElement('div');
    tip.id='dashDisabledTip';
    tip.textContent='해당 기간의 데이터가 없습니다.';
    tip.style.cssText='position:fixed;white-space:nowrap;padding:5px 10px;background:var(--card);border:1px solid var(--bdr);border-radius:6px;font-size:10px;color:var(--t2);box-shadow:var(--sh);z-index:9100;pointer-events:none';
    tip.style.left=rect.left+'px';
    tip.style.top=(rect.bottom+6)+'px';
    document.body.appendChild(tip);
    _dashDisabledTip=tip;
  });
  document.addEventListener('mouseout',function(e){
    const btn=e.target.closest('.dash-sub-disabled');
    if(!btn)return;
    const related=e.relatedTarget;
    if(related&&related.closest&&related.closest('.dash-sub-disabled')===btn)return;
    if(_dashDisabledTip){_dashDisabledTip.remove();_dashDisabledTip=null;}
  });

  function emsTelAutoTab(el,nextId){
    const max=parseInt(el.maxLength)||4;
    if(el.value.length>=max){const nxt=document.getElementById(nextId);if(nxt){nxt.focus();nxt.select();}}
  }
  function emsTelNav(e,prevId,nextId){
    if(e.key==='ArrowRight'&&nextId){const nxt=document.getElementById(nextId);if(nxt){nxt.focus();nxt.setSelectionRange(0,0);e.preventDefault();}}
    if(e.key==='ArrowLeft'&&prevId){const prv=document.getElementById(prevId);if(prv){prv.focus();prv.setSelectionRange(prv.value.length,prv.value.length);e.preventDefault();}}
    if((e.key==='Backspace'||e.key==='Delete')&&prevId&&e.target.value===''&&e.target.selectionStart===0){
      const prv=document.getElementById(prevId);if(prv){prv.focus();prv.setSelectionRange(prv.value.length,prv.value.length);e.preventDefault();}
    }
  }
  const _emsState={stuId:null,recId:null,currentSaveId:null,ecRecId:null};
  export function openEmsMsg(stuId){
    const stu=getStu(stuId);if(!stu)return;
    _emsState.stuId=stuId;
    const dayRecs=recsByDate(S.selectedDate);
    const rec=dayRecs.find(function(r){return r.studentId===stuId;})||null;
    _emsState.recId=rec?rec.id:null;
    const birth=getStudentBirth(stu);
    const gType=getGuardianType(stu);
    const gContact=getGuardianContact(stu);
    const schoolName=S.settings.schoolName||'○○학교';
    const isStaff=stu.type==='staff';
    const gradeInfo=isStaff?(stu.position||'교직원'):(stu.grade+'학년 '+stu.cls+'반');
    const numInfo=isStaff?'-':(stu.num||'-')+'번';
    let vitals='';
    if(rec){
      const vArr=[];
      if(rec.temp)vArr.push('체온 '+rec.temp+'°C');
      if(rec.bp)vArr.push('혈압 '+rec.bp);
      if(rec.pulse)vArr.push('맥박 '+rec.pulse);
      if(rec.resp)vArr.push('호흡 '+rec.resp);
      if(rec.spo2)vArr.push('SpO2 '+rec.spo2+'%');
      vitals=vArr.join(' / ')||'미입력';
    } else { vitals='기록 없음'; }
    const symptoms=rec?rec.symptoms.join(', '):'';
    const treatment=rec?rec.treatment.join(', '):'';
    const _emsInputStyle='border:1px solid var(--bdr);border-radius:4px;padding:3px 6px;font-size:12px;font-family:var(--f);background:var(--bg2);color:var(--t1);outline:none;width:100px';
    let infoHtml='';
    if(isStaff){
      const _si='border:1px solid var(--bdr);border-radius:4px;padding:3px 6px;font-size:12px;font-family:var(--f);background:var(--bg2);color:var(--t1);outline:none';
      infoHtml+=''
        +'<div class="ems-row"><span class="ems-label">이 름</span><span class="ems-val" style="font-size:14px">'+escHtml(stu.name)+'</span>'
        +'<span class="ems-label">생년월일</span><span style="display:flex;align-items:center;gap:2px;font-size:12px;color:var(--t1)"><input id="emsStaffBirthY" style="'+_si+';width:44px;text-align:center" maxlength="4" placeholder="0000">-<input id="emsStaffBirthM" style="'+_si+';width:30px;text-align:center" maxlength="2" placeholder="00">-<input id="emsStaffBirthD" style="'+_si+';width:30px;text-align:center" maxlength="2" placeholder="00"></span></div>'
        +'<div class="ems-row"><span class="ems-label">가 족</span><input id="emsStaffFamily" style="'+_si+';width:90px" placeholder="예. 배우자">'
        +'<span class="ems-label">가족 연락처</span><span style="display:flex;align-items:center;gap:2px;font-size:12px;color:var(--t1)">010-<input id="emsStaffTel1" style="'+_si+';width:44px;text-align:center" maxlength="4" placeholder="0000">-<input id="emsStaffTel2" style="'+_si+';width:44px;text-align:center" maxlength="4" placeholder="0000"></span></div>'
        +'<div class="ems-row"><span class="ems-label">직 위</span><span class="ems-val">'+escHtml(gradeInfo)+'</span>'
        +'<span class="ems-label">학교명</span><span class="ems-val">'+escHtml(schoolName)+'</span></div>';
    } else {
      infoHtml+=''
        +'<div class="ems-row ems-stu-row"><span class="ems-label">이 름</span><span class="ems-val" style="font-size:14px">'+escHtml(stu.name)+'</span>'
        +'<span class="ems-label">생년월일</span><span class="ems-val">'+escHtml(birth)+'</span></div>'
        +'<div class="ems-row ems-stu-row"><span class="ems-label">보호자</span><span class="ems-val">'+escHtml(gType)+'</span>'
        +'<span class="ems-label">연락처</span><span class="ems-val">'+escHtml(gContact)+'</span></div>'
        +'<div class="ems-row ems-stu-row"><span class="ems-label">학 번</span><span class="ems-val">'+escHtml(gradeInfo)+' '+escHtml(numInfo)+'</span>'
        +'<span class="ems-label">학교명</span><span class="ems-val">'+escHtml(schoolName)+'</span></div>';
    }
    {
      const _isMissing=vitals==='미입력'||vitals==='기록 없음';
      const _valColor=_isMissing?'#ef4444':'var(--cyan)';
      const _valDeco=_isMissing?';text-decoration:underline dotted;text-underline-offset:3px':'';
      /* V/S 행은 라벨 + 값 2셀만이므로 grid 레이아웃 override → flex 로 한 줄 표시 */
      infoHtml+='<div class="ems-row" style="display:flex;align-items:center;gap:4px;margin-top:6px;padding-top:8px;border-top:1px solid var(--bdr);white-space:nowrap"><span class="ems-label" style="flex:0 0 50px">V/S</span><span class="ems-val" data-ems-vs-edit="1" title="클릭하여 V/S '+(_isMissing?'입력':'수정')+'" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:'+_valColor+';font-weight:800;cursor:pointer'+_valDeco+'">'+escHtml(vitals)+'</span></div>';
    }
    infoHtml+='<div class="ems-row" data-ems-sym-row style="display:'+(symptoms?'':'none')+'"><span class="ems-label">증 상</span><span class="ems-val">'+escHtml(symptoms)+'</span></div>';
    document.getElementById('emsInfoArea').innerHTML=infoHtml;
    /* V/S 클릭 → 일반 일지의 openVitalsEdit 팝업 재사용 */
    {
      const _vsEl=document.querySelector('#emsInfoArea [data-ems-vs-edit]');
      if(_vsEl){
        _vsEl.addEventListener('click',function(ev){
          ev.stopPropagation();
          let rid=_emsState.recId;
          if(rid==null){
            /* 오늘 자 레코드가 없으면 즉석 생성 */
            const today=toDateStr(new Date());
            const newRec={id:S.nextId++,date:today,studentId:_emsState.stuId,symptoms:[],treatment:[],medication:[],temp:'',bp:'',pulse:'',resp:'',_dirty:true};
            S.records.push(newRec);rid=newRec.id;_emsState.recId=rid;
          }
          openVitalsEdit(rid,_vsEl);
          setTimeout(function(){const p=document.querySelector('.cell-ac-popup');if(p)p.style.zIndex='10300';},20);
          /* 팝업 닫힐 때 V/S 표시 갱신 */
          const _t=setInterval(function(){
            if(!document.querySelector('.cell-ac-popup')){
              clearInterval(_t);
              const rec=S.records.find(function(r){return r.id===rid;});
              if(!rec)return;
              const vArr=[];
              if(rec.temp)vArr.push('체온 '+rec.temp+'°C');
              if(rec.bp)vArr.push('혈압 '+rec.bp);
              if(rec.pulse)vArr.push('맥박 '+rec.pulse);
              if(rec.resp)vArr.push('호흡 '+rec.resp);
              if(rec.spo2)vArr.push('SpO2 '+rec.spo2+'%');
              const txt=vArr.join(' / ')||'미입력';
              _vsEl.textContent=txt;
              const missing=txt==='미입력';
              _vsEl.style.color=missing?'#ef4444':'var(--cyan)';
              _vsEl.style.textDecoration=missing?'underline dotted':'none';
              if(typeof emsUpdatePreview==='function')emsUpdatePreview();
            }
          },300);
        });
      }
    }
    if(isStaff){
      /* ── 교직원 입력 필드 이벤트 바인딩 ── */
      const _staffInputs=[
        {id:'emsStaffBirthY',next:'emsStaffBirthM',prev:null,autoLen:4},
        {id:'emsStaffBirthM',next:'emsStaffBirthD',prev:'emsStaffBirthY',autoLen:2},
        {id:'emsStaffBirthD',next:'emsStaffFamily',prev:'emsStaffBirthM',autoLen:2},
        {id:'emsStaffFamily',next:null,prev:null,autoLen:0},
        {id:'emsStaffTel1',next:'emsStaffTel2',prev:null,autoLen:4},
        {id:'emsStaffTel2',next:null,prev:'emsStaffTel1',autoLen:0}
      ];
      _staffInputs.forEach(function(cfg){
        const el=document.getElementById(cfg.id);if(!el)return;
        el.addEventListener('click',function(ev){ev.stopPropagation();});
        el.addEventListener('input',function(){
          emsUpdatePreview();
          if(cfg.autoLen&&this.value.length>=cfg.autoLen&&cfg.next)emsTelAutoTab(this,cfg.next);
        });
        if(cfg.next||cfg.prev){
          el.addEventListener('keydown',function(ev){emsTelNav(ev,cfg.prev,cfg.next);});
        }
      });
      if(stu.familyContact){const _efEl=document.getElementById('emsStaffFamily');if(_efEl)_efEl.value=stu.familyContact;}
      if(stu.familyPhone){const _ph=stu.familyPhone.replace(/[^0-9-]/g,'').split('-');if(_ph.length>=3){const _et1=document.getElementById('emsStaffTel1'), _et2=document.getElementById('emsStaffTel2');if(_et1)_et1.value=_ph[1]||'';if(_et2)_et2.value=_ph[2]||'';}}
    }
    document.getElementById('emsDescInput').value='';
    document.getElementById('emsPlaceholder').style.display='';
    _emsState.paper='receipt';
    _emsState.currentSaveId=null;
    _emsState.ecRecId=null;
    document.getElementById('emsOverlay').classList.add('show');
    emsUpdatePaperToggle();
    emsUpdatePreview();
    emsRenderSlots();
    const ta=document.getElementById('emsDescInput');
    let _emsSaveTimer=null;
    ta.onkeyup=ta.oninput=ta.oncompositionend=function(){
      document.getElementById('emsPlaceholder').style.display=ta.value?'none':'';
      emsUpdatePreview();
      let ind=document.getElementById('emsSaveInd');
      if(!ind){ind=document.createElement('div');ind.id='emsSaveInd';ind.className='ec-save-indicator';ind.style.zIndex='10001';document.body.appendChild(ind);}
      ind.textContent='저장 중…';ind.className='ec-save-indicator saving';ind.style.zIndex='10001';
      clearTimeout(_emsSaveTimer);
      _emsSaveTimer=setTimeout(function(){
        if(!ta.value.trim()){emsDeleteCurrent();} else {emsSave();}
        ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';ind.style.zIndex='10001';
        setTimeout(function(){ind.className='ec-save-indicator hide';},3000);
      },300);
    };
    setTimeout(function(){ta.focus();},100);
  }
  export function closeEmsMsg(){
    const ov=document.getElementById('emsOverlay');
    if(!ov||!ov.classList.contains('show'))return;
    const modal=ov.querySelector('.ems-modal');
    /* 닫기 애니메이션: 모달은 축소+페이드, 오버레이는 페이드아웃 */
    if(modal){
      modal.style.transition='opacity 0.22s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)';
      modal.style.opacity='0';
      modal.style.transform='scale(0.94) translateY(8px)';
    }
    ov.style.transition='opacity 0.22s ease';
    ov.style.opacity='0';
    setTimeout(function(){
      ov.classList.remove('show');
      /* 다음 열기를 위해 인라인 스타일 초기화 */
      ov.style.transition='';ov.style.opacity='';
      if(modal){modal.style.transition='';modal.style.opacity='';modal.style.transform='';}
    },240);
  }
  /* 응급실 위치(의료기관 팝업·별도 창)를 다녀온 직후, 메인 창에 포커스가 막 복귀하며 들어온 배경 클릭은
   * EMS 모달을 닫지 않도록 무시 — 그 클릭 때문에 EMS 메시지 모달까지 같이 닫히던 버그 차단. (2026-06-02) */
  let _emsWinRefocusAt=0;
  try{ window.addEventListener('focus',function(){ _emsWinRefocusAt=Date.now(); }); }catch(_e){}
  function _emsBackdropClick(e){
    if(e.target!==this)return;
    if(Date.now()-_emsWinRefocusAt < 450) return;   /* 방금 창 포커스 복귀한 클릭은 무시 */
    closeEmsMsg();
  }
  const _emsOvEl=document.getElementById('emsOverlay');
  if(_emsOvEl){_emsOvEl.addEventListener('click',_emsBackdropClick);}
  else{document.addEventListener('DOMContentLoaded',function(){const el=document.getElementById('emsOverlay');if(el)el.addEventListener('click',_emsBackdropClick);});}

  /* ── 정적 팝업 드래그 이동 초기화 ── */
  function _initKioskDraggables(){
    if(typeof _makeDraggable!=='function')return;
    _makeDraggable(document.querySelector('#emsOverlay .ems-modal'));
    _makeDraggable(document.querySelector('#vpOverlay .vp-modal'));
    _makeDraggable(document.querySelector('#qmOverlay .qm-container'));
    _makeDraggable(document.querySelector('#settingsModal .modal-content'));
  }
  setTimeout(_initKioskDraggables, 0);

  function emsUpdatePaperToggle(){
    const wrap=document.getElementById('emsPaperToggle');
    if(wrap)wrap.querySelectorAll('.vp-toggle').forEach(function(b){b.classList.toggle('on',b.dataset.paper===_emsState.paper);});
    const preview=document.getElementById('emsPreview');
    if(!preview)return;
    if(_emsState.paper==='receipt'){
      /* 3인치 영수증: 가로 폭만 80mm(302px)로 제한, 세로는 자연스럽게
       * 높이는 flex로 확장하고 내부 스크롤 → 용지 칩이 가려지지 않음 */
      preview.style.boxSizing='border-box';
      preview.style.width='302px';preview.style.maxWidth='302px';
      preview.style.margin='0 auto';
      preview.style.padding='15px';
      preview.style.fontSize='11px';preview.style.lineHeight='1.55';
      preview.style.background='#fff';
      preview.style.boxShadow='0 2px 12px rgba(0,0,0,0.12)';
      preview.classList.add('ems-preview-receipt');
      preview.classList.remove('ems-preview-a4');
    } else {
      /* A4: 가로 폭만 210mm(794px)로 제한 */
      preview.style.boxSizing='border-box';
      preview.style.width='';preview.style.maxWidth='794px';
      preview.style.margin='0 auto';
      preview.style.padding='38px';
      preview.style.fontSize='13px';preview.style.lineHeight='1.8';
      preview.style.background='#fff';
      preview.style.boxShadow='0 2px 12px rgba(0,0,0,0.12)';
      preview.classList.add('ems-preview-a4');
      preview.classList.remove('ems-preview-receipt');
    }
  }
  export function emsSetPaper(paper){_emsState.paper=paper;emsUpdatePaperToggle();emsUpdatePreview();setTimeout(function(){document.getElementById('emsDescInput').focus();},50);}
  function emsUpdatePreview(){
    const stu=getStu(_emsState.stuId);if(!stu)return;
    const rec=_emsState.recId?S.records.find(function(r){return r.id===_emsState.recId;}):null;
    let birth=getStudentBirth(stu);
    let gType=getGuardianType(stu);
    let gContact=getGuardianContact(stu);
    const schoolName=S.settings.schoolName||'○○학교';
    const isStaff=stu.type==='staff';
    const gradeInfo=isStaff?(stu.position||'교직원'):(stu.grade+'학년 '+stu.cls+'반');
    const numInfo=isStaff?'':(stu.num||'')+'번';
    let vitals='';
    if(rec){const vArr=[];if(rec.temp)vArr.push('체온 '+rec.temp+'°C');if(rec.bp)vArr.push('혈압 '+rec.bp);if(rec.pulse)vArr.push('맥박 '+rec.pulse);if(rec.resp)vArr.push('호흡 '+rec.resp);if(rec.spo2)vArr.push('SpO2 '+rec.spo2+'%');vitals=vArr.join(' / ')||'';}
    const symptoms=rec?rec.symptoms.join(', '):'';
    const desc=document.getElementById('emsDescInput').value||'';
    const now=new Date();
    const timeStr=now.getFullYear()+'년 '+(now.getMonth()+1)+'월 '+now.getDate()+'일 '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    if(isStaff){
      const _sby=document.getElementById('emsStaffBirthY'), _sbm=document.getElementById('emsStaffBirthM'), _sbd=document.getElementById('emsStaffBirthD');
      if(_sby||_sbm||_sbd){const by=_sby?_sby.value:'', bm=_sbm?_sbm.value:'', bd=_sbd?_sbd.value:'';if(by||bm||bd)birth=by+'-'+bm+'-'+bd;}
      const _sf=document.getElementById('emsStaffFamily');if(_sf)gType=_sf.value||'';
      const _st1=document.getElementById('emsStaffTel1'), _st2=document.getElementById('emsStaffTel2');
      if(_st1||_st2){const t1=_st1?_st1.value:'', t2=_st2?_st2.value:'';gContact=(t1||t2)?'010-'+t1+'-'+t2:'';}
    }
    let html='<h3>구급대 인계 메시지</h3>';
    html+='<div class="ems-p-row"><span class="ems-p-label">이 름: </span>'+escHtml(stu.name)+'</div>';
    html+='<div class="ems-p-row"><span class="ems-p-label">생년월일: </span>'+escHtml(birth)+'</div>';
    html+='<div class="ems-p-row"><span class="ems-p-label">'+(isStaff?'가 족: ':'보호자: ')+'</span>'+(isStaff?escHtml(gType):(escHtml(gType)+' / '+escHtml(gContact)))+'</div>';
    if(isStaff&&gContact) html+='<div class="ems-p-row"><span class="ems-p-label">가족 연락처: </span>'+escHtml(gContact)+'</div>';
    html+='<div class="ems-p-row"><span class="ems-p-label">'+(isStaff?'직 위: ':'학 번: ')+'</span>'+escHtml(schoolName)+' '+escHtml(gradeInfo)+(numInfo?' '+escHtml(numInfo):'')+'</div>';
    if(vitals) html+='<div class="ems-p-row"><span class="ems-p-label">V/S: </span>'+escHtml(vitals)+'</div>';
    if(symptoms) html+='<div class="ems-p-row"><span class="ems-p-label">증 상: </span>'+escHtml(symptoms)+'</div>';
    html+='<div class="ems-p-row"><span class="ems-p-label">작성일시: </span>'+timeStr+'</div>';
    if(desc) html+='<div class="ems-p-desc"><span class="ems-p-label">경 위:</span><br>'+escHtml(desc)+'</div>';
    document.getElementById('emsPreview').innerHTML=html;
  }
  /* 인쇄 = 의료기관 탐색과 동일한 dual-preview 다이얼로그(3인치/A4 각 프린터+인쇄+취소 + 두 미리보기). (2026-06-02) */
  export function emsPrint(){ _emsOpenPrintDialog(); }

  /* 인쇄용 HTML(용지별) — 기존 emsPrint 의 빌더와 동일. */
  function _emsPrintHtml(content, isReceipt, rcHmm){
    /* 3인치는 콘텐츠 높이에 맞춘 용지(긴 빈 여백 방지). A4는 297mm 고정. */
    const pageSize=isReceipt?('80mm '+(rcHmm||120)+'mm'):'A4';
    const bodyFontSize=isReceipt?'11px':'13px';
    const bodyLineHeight=isReceipt?'1.55':'1.8';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
      +'@page{size:'+pageSize+';margin:0}'
      +'html,body{margin:0;padding:0}'
      +'body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;font-size:'+bodyFontSize+';line-height:'+bodyLineHeight+';color:#111;box-sizing:border-box;'
      +(isReceipt?'width:80mm;padding:4mm;':'width:210mm;min-height:297mm;padding:10mm;')
      +'}'
      +'h3{font-size:'+(isReceipt?'13px':'18px')+';font-weight:800;text-align:center;margin:0 0 '+(isReceipt?'8px':'20px')+';padding-bottom:'+(isReceipt?'5px':'12px')+';border-bottom:2px solid #111}'
      +'.ems-p-row{margin-bottom:'+(isReceipt?'3px':'4px')+';word-break:break-all}.ems-p-label{font-weight:700}'
      +'.ems-p-desc{margin-top:'+(isReceipt?'8px':'14px')+';padding-top:'+(isReceipt?'6px':'12px')+';border-top:1px solid #ccc;white-space:pre-wrap;word-break:break-all}'
      +'</style></head><body>'+content+'</body></html>';
  }
  function _emsPvCleanup(){
    ['emsPvBackdrop','emsPvBar','emsPvCardRc','emsPvCardA4','emsPvCapRc','emsPvCapA4','emsPvStyle'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
    try{ window.removeEventListener('resize', _emsPositionCards); }catch(_e){}
  }
  /* 두 미리보기 카드(3인치·A4)를 바 아래에 나란히 배치 + 화면에 맞게 축소(각자 자기 자신만 scale). */
  function _emsPositionCards(){
    const rc=document.getElementById('emsPvCardRc'), a4=document.getElementById('emsPvCardA4'), bar=document.getElementById('emsPvBar');
    if(!rc||!a4)return;
    rc.style.transformOrigin='top left'; a4.style.transformOrigin='top left';
    rc.style.transform='none'; a4.style.transform='none';
    const barBottom=bar?bar.getBoundingClientRect().bottom:120;
    const topY=barBottom+28, availH=Math.max(160, window.innerHeight-topY-22);
    const a4W=a4.offsetWidth||794, a4H=a4.offsetHeight||1123;
    const rcW=rc.offsetWidth||302, rcH=rc.offsetHeight||794;
    let sA4=Math.min(availH/a4H,(window.innerWidth*0.42)/a4W,0.6); if(!(sA4>0.08))sA4=0.3;
    let sRc=Math.min(availH/rcH,(window.innerWidth*0.26)/rcW,0.7); if(!(sRc>0.08))sRc=0.45;
    const dA4=a4W*sA4, dRc=rcW*sRc, gap=30;
    const startX=Math.max(12,(window.innerWidth-(dA4+gap+dRc))/2);
    a4.style.left=startX+'px'; a4.style.top=topY+'px'; a4.style.transform='scale('+sA4.toFixed(3)+')';
    rc.style.left=(startX+dA4+gap)+'px'; rc.style.top=topY+'px'; rc.style.transform='scale('+sRc.toFixed(3)+')';
    const capA=document.getElementById('emsPvCapA4'), capR=document.getElementById('emsPvCapRc');
    if(capA){capA.style.left=startX+'px';capA.style.top=(topY-21)+'px';}
    if(capR){capR.style.left=(startX+dA4+gap)+'px';capR.style.top=(topY-21)+'px';}
  }
  /* 영수증(열전사) 프린터 이름 판별 — 비어 있을 때 3인치↔A4 기본값이 안 섞이게. */
  function _emsIsRcPrinter(n){ n=(n||'').toLowerCase(); return /slk|ts-?200|\bpos\b|영수|receipt|thermal|bixolon|srp|80mm/.test(n); }
  /* 프린터 드롭다운 — 공유 설정 키(receipt_printer/a4_printer)에 저장/복원 → 의료기관·방문증과 같은 프린터가 기본으로 뜸.
   * 우선순위: 저장된 마지막 출력 프린터 > (3인치=영수증형 / A4=영수증형 아닌 것) > OS 기본. 선택 변경 시 즉시 저장. (2026-06-02) */
  function _emsFillPrinter(selId, settingsKey){
    const sel=document.getElementById(selId); if(!sel||!window.electronAPI||!window.electronAPI.listPrinters)return;
    const isRc=(settingsKey==='receipt_printer');
    sel.addEventListener('change',function(){ try{ window.electronAPI.settingsSet(settingsKey, sel.value||''); }catch(_e){} });
    const _populate=function(last){
      try{
        window.electronAPI.listPrinters().then(function(res){
          const list=(res&&Array.isArray(res.printers))?res.printers:(Array.isArray(res)?res:[]);
          if(!list.length)return;
          let defVal='';
          list.forEach(function(p){const v=p.name||p.deviceName||'';const o=document.createElement('option');o.value=v;o.textContent=(p.displayName||p.name||v)+(p.isDefault?' (기본)':'');sel.appendChild(o);if(p.isDefault)defVal=v;});
          let pick='';
          if(last){for(let i=0;i<list.length;i++){const lv=list[i].name||list[i].deviceName||'';if(lv===last){pick=last;break;}}}
          if(!pick){
            if(isRc){ for(let k=0;k<list.length;k++){const rn=list[k].name||list[k].deviceName||'';if(_emsIsRcPrinter(rn)){pick=rn;break;}} if(!pick)pick=defVal; }
            else { if(defVal&&!_emsIsRcPrinter(defVal))pick=defVal; if(!pick){for(let k2=0;k2<list.length;k2++){const an=list[k2].name||list[k2].deviceName||'';if(an&&!_emsIsRcPrinter(an)){pick=an;break;}}} if(!pick)pick=defVal; }
          }
          if(pick)sel.value=pick; else if(sel.options.length>1)sel.selectedIndex=1;
        }).catch(function(){});
      }catch(e){}
    };
    try{ window.electronAPI.settingsGet(settingsKey,'').then(function(r){ _populate((r&&r.value)||''); }).catch(function(){_populate('');}); }catch(e){ _populate(''); }
  }
  /* 선택한 용지·프린터로 인쇄 — 방문증/의료기관과 동일하게 printWindowWithSize(숨은 창 + @page 내장). */
  function _emsDoPrint(isReceipt){
    const selId=isReceipt?'emsPvPrinterRc':'emsPvPrinterA4';
    const settingsKey=isReceipt?'receipt_printer':'a4_printer';
    const sel=document.getElementById(selId); const dev=(sel&&sel.value)||undefined;
    try{ window.electronAPI.settingsSet(settingsKey, dev||''); }catch(_e){}   /* 공유 설정에 저장 */
    const content=document.getElementById('emsPreview').innerHTML;
    let rcHmm=0;
    if(isReceipt){ const _card=document.getElementById('emsPvCardRc'); rcHmm=Math.max(40, _card?Math.round(_card.offsetHeight*25.4/96)+4:120); }
    const printHtml=_emsPrintHtml(content, isReceipt, rcHmm);
    const ps=isReceipt?{width:80000,height:rcHmm*1000}:'A4';
    const winFeat=isReceipt?'width=360,height=860':'width=860,height=1100';
    const pageSize=isReceipt?'80mm 210mm':'A4', bfs=isReceipt?'11px':'13px', blh=isReceipt?'1.55':'1.8';
    if(window.electronAPI&&typeof window.electronAPI.printWindowWithSize==='function'){
      window.electronAPI.printWindowWithSize(printHtml, ps, {marginType:isReceipt?'none':'default'}, undefined, true, dev, false)
        .then(function(res){
          if(res&&res.cancelled){return;}
          if(!res||!res.success){ _emsPvCleanup(); _emsFallbackPrintWindow(content,isReceipt,pageSize,bfs,blh,winFeat); return; }
          _emsPvCleanup(); closeEmsMsg();
        })
        .catch(function(){ _emsPvCleanup(); _emsFallbackPrintWindow(content,isReceipt,pageSize,bfs,blh,winFeat); });
    } else {
      _emsPvCleanup(); _emsFallbackPrintWindow(content,isReceipt,pageSize,bfs,blh,winFeat);
    }
  }
  function _emsOpenPrintDialog(){
    emsSave();
    _emsPvCleanup();
    const content=document.getElementById('emsPreview').innerHTML;
    const st=document.createElement('style'); st.id='emsPvStyle';
    st.textContent=
      '#emsPvBackdrop{position:fixed;inset:0;background:rgba(15,23,42,0.62);z-index:30400}'
      +'#emsPvBar{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:32000;display:flex;flex-direction:column;gap:7px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 16px;box-shadow:0 12px 36px rgba(0,0,0,0.35);font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;max-width:94vw}'
      +'#emsPvBar .pv-ttl{font-size:13px;font-weight:800;color:#1a1a2e;margin-bottom:2px}'
      +'#emsPvBar .pv-row{display:flex;align-items:center;gap:7px;font-size:12px;color:#334155}'
      +'#emsPvBar .pv-row .pv-tag{font-weight:800;min-width:58px}'
      +'#emsPvBar select{font-size:12px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;max-width:200px;flex:1}'
      +'#emsPvBar .pv-go{font-size:12px;font-weight:700;padding:5px 14px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:#0891b2;color:#fff}'
      +'#emsPvBar .pv-cl{font-size:12px;font-weight:700;padding:5px 12px;border-radius:8px;cursor:pointer;border:1px solid #cbd5e1;background:#f1f5f9;color:#334155}'
      +'.ems-pv-cap{position:fixed;z-index:31050;font-family:\'Malgun Gothic\',sans-serif;font-size:11px;font-weight:800;color:#fff;background:rgba(15,23,42,0.82);border-radius:6px;padding:2px 9px;pointer-events:none}'
      +'#emsPvCardRc,#emsPvCardA4{position:fixed;background:#fff;color:#111;box-sizing:border-box;box-shadow:0 14px 50px rgba(0,0,0,0.5);border:1px solid #94a3b8;transform-origin:top left;overflow:hidden;z-index:31000;font-family:\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',sans-serif}'
      +'#emsPvCardRc{width:80mm;padding:4mm;font-size:11px;line-height:1.55}'
      +'#emsPvCardA4{width:210mm;min-height:297mm;padding:10mm;font-size:13px;line-height:1.8}'
      +'#emsPvCardRc h3{font-size:13px;font-weight:800;text-align:center;margin:0 0 8px;padding-bottom:5px;border-bottom:2px solid #111}'
      +'#emsPvCardA4 h3{font-size:18px;font-weight:800;text-align:center;margin:0 0 20px;padding-bottom:12px;border-bottom:2px solid #111}'
      +'#emsPvCardRc .ems-p-row{margin-bottom:3px;word-break:break-all}#emsPvCardA4 .ems-p-row{margin-bottom:4px;word-break:break-all}'
      +'#emsPvCardRc .ems-p-label,#emsPvCardA4 .ems-p-label{font-weight:700}'
      +'#emsPvCardRc .ems-p-desc{margin-top:8px;padding-top:6px;border-top:1px solid #ccc;white-space:pre-wrap;word-break:break-all}'
      +'#emsPvCardA4 .ems-p-desc{margin-top:14px;padding-top:12px;border-top:1px solid #ccc;white-space:pre-wrap;word-break:break-all}';
    document.head.appendChild(st);
    const bd=document.createElement('div'); bd.id='emsPvBackdrop'; document.body.appendChild(bd); bd.addEventListener('click',_emsPvCleanup);
    const bar=document.createElement('div'); bar.id='emsPvBar';
    bar.innerHTML='<div class="pv-ttl">🖨 구급대 메시지 인쇄</div>'
      +'<div class="pv-row"><span class="pv-tag">🧾 3인치</span> 프린터 <select id="emsPvPrinterRc"><option value="">기본 프린터</option></select> <button class="pv-go" id="emsPvGoRc">인쇄</button> <button class="pv-cl" id="emsPvClRc">취소</button></div>'
      +'<div class="pv-row"><span class="pv-tag">📄 A4</span> 프린터 <select id="emsPvPrinterA4"><option value="">기본 프린터</option></select> <button class="pv-go" id="emsPvGoA4">인쇄</button> <button class="pv-cl" id="emsPvClA4">취소</button></div>';
    document.body.appendChild(bar);
    const capR=document.createElement('div'); capR.id='emsPvCapRc'; capR.className='ems-pv-cap'; capR.textContent='🧾 3인치 미리보기'; document.body.appendChild(capR);
    const capA=document.createElement('div'); capA.id='emsPvCapA4'; capA.className='ems-pv-cap'; capA.textContent='📄 A4 미리보기'; document.body.appendChild(capA);
    const cardRc=document.createElement('div'); cardRc.id='emsPvCardRc'; cardRc.innerHTML=content; document.body.appendChild(cardRc);
    const cardA4=document.createElement('div'); cardA4.id='emsPvCardA4'; cardA4.innerHTML=content; document.body.appendChild(cardA4);
    _emsPositionCards();
    _emsFillPrinter('emsPvPrinterRc','receipt_printer');   /* 3인치 = 공유 키 receipt_printer */
    _emsFillPrinter('emsPvPrinterA4','a4_printer');        /* A4 = 공유 키 a4_printer */
    document.getElementById('emsPvClRc').addEventListener('click',_emsPvCleanup);
    document.getElementById('emsPvClA4').addEventListener('click',_emsPvCleanup);
    document.getElementById('emsPvGoRc').addEventListener('click',function(){_emsDoPrint(true);});
    document.getElementById('emsPvGoA4').addEventListener('click',function(){_emsDoPrint(false);});
    window.addEventListener('resize',_emsPositionCards);
  }

  function _emsFallbackPrintWindow(content,isReceipt,pageSize,bodyFontSize,bodyLineHeight,winFeat){
    const win=window.open('','_blank',winFeat);
    win.document.write('<html><head><title>구급대 인계 메시지</title><style>'
      +'@page{size:'+pageSize+';margin:0}'
      +'html,body{margin:0;padding:0}'
      +'body{'
      +'font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif;'
      +'font-size:'+bodyFontSize+';line-height:'+bodyLineHeight+';color:#111;'
      +'box-sizing:border-box;'
      +(isReceipt
        ?'width:80mm;min-height:210mm;padding:4mm;'
        :'width:210mm;min-height:297mm;padding:10mm;')
      +'}'
      +'h3{font-size:'+(isReceipt?'13px':'18px')+';font-weight:800;text-align:center;margin:0 0 '+(isReceipt?'8px':'20px')+';padding-bottom:'+(isReceipt?'5px':'12px')+';border-bottom:2px solid #111}'
      +'.ems-p-row{margin-bottom:'+(isReceipt?'3px':'4px')+';word-break:break-all}.ems-p-label{font-weight:700}'
      +'.ems-p-desc{margin-top:'+(isReceipt?'8px':'14px')+';padding-top:'+(isReceipt?'6px':'12px')+';border-top:1px solid #ccc;white-space:pre-wrap;word-break:break-all}'
      +'@media screen{body{background:#fff;box-shadow:0 2px 18px rgba(0,0,0,0.18);margin:16px auto;border:1px solid #ddd}html{background:#f5f5f5}}'
      +'@media print{body{box-shadow:none;border:none;margin:0}}'
      +'</style></head><body>'
      +content
      /* 인쇄 다이얼로그 닫힌 후 창 자동 닫기 */
      +'<script>'
      +'window.addEventListener("afterprint",function(){try{window.close();}catch(e){}});'
      +'setTimeout(function(){window.print();},400);'
      +'<\/script>'
      +'</body></html>');
    win.document.close();
  }

  /* ── EMS 저장 슬롯 ── */
  function _emsGetSaved(){return JSON.parse(localStorage.getItem('ec_ems_saved')||'[]');}
  function _emsSetSaved(arr){
    localStorage.setItem('ec_ems_saved',JSON.stringify(arr));
    if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','ems_saved',arr);
  }
  function emsSave(){
    const preview=document.getElementById('emsPreview').innerHTML;
    const desc=document.getElementById('emsDescInput').value||'';
    if(!desc.trim())return;
    const stu=getStu(_emsState.stuId);
    const saved=_emsGetSaved();
    const now=new Date();
    const ts=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    if(_emsState.currentSaveId){
      const idx=saved.findIndex(function(s){return s.id===_emsState.currentSaveId;});
      if(idx>=0){saved[idx].desc=desc;saved[idx].html=preview;saved[idx].date=ts;saved[idx].paper=_emsState.paper||'receipt';} else {_emsState.currentSaveId=null;}
    }
    if(!_emsState.currentSaveId){
      if(saved.length>=20){saved.shift();}
      const newId=Date.now();
      saved.push({id:newId,name:stu?stu.name:'',date:ts,desc:desc,html:preview,paper:_emsState.paper||'receipt'});
      _emsState.currentSaveId=newId;
    }
    _emsSetSaved(saved);
    emsRenderSlots();
    /* 응급처치 기록 자동 등록 비활성화 — 사용자가 메시지 저장만 했는데
       응급처치 기록 리스트에 자동 행이 추가되는 것을 방지. EC 기록은
       응급처치 기록지에서 사용자가 명시적으로 작성·등록만. (2026-05-08) */
    /* _emsLinkEc(desc); */
    if(_emsState.stuId&&document.getElementById('sideVisitHistory').style.display==='block'){showVisitHistory(_emsState.stuId);}
  }
  function _emsLinkEc(desc){
    if(!_emsState.stuId||!desc.trim())return;
    if(_emsState.ecRecId){const ecRec=S.ecRecords.find(function(r){return r.id===_emsState.ecRecId;});if(ecRec){ecRec.summary=desc;ecSaveRecords();return;}}
    const today=toDateStr(new Date());
    const existing=S.ecRecords.find(function(r){return r.studentId===_emsState.stuId&&r.date===today;});
    if(existing){existing.summary=desc;_emsState.ecRecId=existing.id;ecSaveRecords();return;}
    const now=new Date();const dateStr=toDateStr(now);
    const newRec={id:S.ecNextId++,date:dateStr,studentId:_emsState.stuId,accidentInfo:{datetime:dateStr,location:'',situation:''},patientStatus:'',consciousness:'명료',vitals:{temp:'',pulse:'',bp:'',resp:'',spo2:''},summary:desc,photoData:'',treatment:'',transfer:{transferred:false,method:'',facility:''},authorDate:dateStr,authorName:S.settings.nurse1||'',notes:''};
    addEcRecord(newRec);_emsState.ecRecId=newRec.id;
    ecSaveRecords();
  }
  function emsDeleteSlot(id,e){
    if(e)e.stopPropagation();
    const saved=_emsGetSaved().filter(function(s){return s.id!==id;});
    _emsSetSaved(saved);
    /* 현재 로드된 슬롯을 삭제한 경우: 경위 작성 textarea + 미리보기 초기화 */
    if(_emsState.currentSaveId===id){
      _emsState.currentSaveId=null;
      const ta=document.getElementById('emsDescInput');
      if(ta)ta.value='';
      const ph=document.getElementById('emsPlaceholder');
      if(ph)ph.style.display='';
      if(typeof emsUpdatePreview==='function')emsUpdatePreview();
    }
    emsRenderSlots();
  }
  function emsLoadSlot(id){
    const saved=_emsGetSaved();const item=saved.find(function(s){return s.id===id;});if(!item)return;
    const ta=document.getElementById('emsDescInput');ta.value=item.desc||'';
    document.getElementById('emsPlaceholder').style.display=ta.value?'none':'';
    _emsState.currentSaveId=id;_emsState.paper=item.paper||'receipt';
    emsUpdatePaperToggle();document.getElementById('emsPreview').innerHTML=item.html;
  }
  function emsDeleteCurrent(){if(!_emsState.currentSaveId)return;const saved=_emsGetSaved().filter(function(s){return s.id!==_emsState.currentSaveId;});_emsSetSaved(saved);_emsState.currentSaveId=null;emsRenderSlots();}
  export function emsResetCurrent(){emsDeleteCurrent();document.getElementById('emsDescInput').value='';document.getElementById('emsPlaceholder').style.display='';emsUpdatePreview();setTimeout(function(){document.getElementById('emsDescInput').focus();},50);}
  function emsRenderSlots(){
    const area=document.getElementById('emsSlotsArea');if(!area)return;
    const saved=_emsGetSaved();let html='';
    for(let i=0;i<20;i++){
      const s=saved[i];
      if(s){html+='<div class="ems-slot filled" data-slot-id="'+s.id+'" title="'+escHtml(s.name)+' · '+escHtml(s.date)+'">✓<span class="ems-slot-x" data-del-id="'+s.id+'">✕</span></div>';}
      else {html+='<div class="ems-slot">'+(i+1)+'</div>';}
    }
    area.innerHTML=html;
    area.querySelectorAll('[data-slot-id]').forEach(function(el){
      el.addEventListener('click',function(){emsLoadSlot(parseInt(this.dataset.slotId));});
    });
    area.querySelectorAll('[data-del-id]').forEach(function(el){
      el.addEventListener('click',function(ev){ev.stopPropagation();emsDeleteSlot(parseInt(this.dataset.delId),ev);});
    });
  }

  // ── Expose to global scope ──
  // NOTE: emsTelAutoTab, emsTelNav, emsUpdatePreview, emsLoadSlot, emsDeleteSlot,
  //       emsSave, emsRenderSlots, emsDeleteCurrent, emsUpdatePaperToggle,
  //       _dailyJumpToDate, _dailyDeleteRecord — only used internally, no window export needed.

