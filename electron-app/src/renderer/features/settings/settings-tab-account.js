/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { closeModalGracefully } from '../../core/helpers.js';
import { renderSettingsPanel } from './settings-view.js';
import { dailyColEyeIcon } from '../emergency/emergency-view.js';
import { S } from '../../core/app-state.js';
import { maybeSendHeartbeat } from '../../core/heartbeat.js';

/* 저장 토스트 공용 */
function _showSaveToast(){
  const toast=document.getElementById('globalSaveToast');
  if(!toast)return;
  toast.textContent='저장 중\u2026';toast.className='global-save-toast show saving';
  setTimeout(function(){toast.textContent='모든 내용이 저장되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);},300);
}

/* ═══════════════════════════════════════
   SETTINGS TAB: ACCOUNT
   Extracted from settings-view.js
   ═══════════════════════════════════════ */

/* ── Account tab HTML rendering ── */
export function _renderAccountTab(user){
  const userPos=user.position||'';
  const isCustomPos=(userPos!=='보건교사'&&userPos!=='보건지원강사'&&userPos!=='');
  let html='<div class="settings-panel-title">👤 사용자 설정</div>';
  html+='<div class="settings-panel-desc">현재 사용자 정보를 관리합니다. 보건교사 교체 시 인수인계에 사용하세요.</div>';
  html+='<div class="cc" style="padding:14px;margin-bottom:12px;position:relative"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-size:12px;font-weight:700;color:var(--t2)">📋 현재 등록 정보</span><span id="accountEditBtn" style="width:22px;height:22px;border-radius:50%;background:rgba(59,130,246,0.12);color:#3b82f6;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;border:1px solid rgba(59,130,246,0.2);transition:all .15s" title="등록 정보 수정">✏️</span></div>';
  html+='<div id="userInfoDisplay" style="display:grid;grid-template-columns:70px 1fr;gap:6px 12px;font-size:12px;color:var(--t2)">';
  html+='<span style="color:var(--t3)">소속 교육청</span><span style="font-weight:600">'+(user.eduOffice||S.settings.eduOffice||'미설정')+'</span>';
  html+='<span style="color:var(--t3)">학교</span><span style="font-weight:600">'+(user.school||S.settings.schoolName||'미설정')+'</span>';
  html+='<span style="color:var(--t3)">이름</span><span style="font-weight:600">'+(user.name||S.settings.nurse1||'미설정')+'</span>';
  html+='<span style="color:var(--t3)">직위</span><span style="font-weight:600">'+(userPos||'미설정')+'</span>';
  html+='</div>';
  /* [REMOVED] 시디키(CD Key) — 설치 단계에서 삽입하는 기능이므로 설정에서 제거됨 */
  html+='<div id="userInfoEdit" style="display:none;margin-top:10px">';
  html+='<div class="form-group"><label class="form-label">이름</label><input class="form-input" id="setUserName" value="'+(user.name||S.settings.nurse1||'')+'" placeholder="이름"></div>';
  html+='<div class="form-group"><label class="form-label">직위</label><select class="form-input" id="setUserPosition">'
    +'<option value="보건교사"'+(userPos==='보건교사'?' selected':'')+'>보건교사</option>'
    +'<option value="보건지원강사"'+(userPos==='보건지원강사'?' selected':'')+'>보건지원강사</option>'
    +'<option value=""'+(isCustomPos?' selected':'')+'>직접 입력</option></select></div>';
  html+='<div class="form-group" style="display:'+(isCustomPos?'block':'none')+'" id="setUserPositionCustomWrap"><input class="form-input" id="setUserPositionCustom" value="'+(isCustomPos?userPos:'')+'" placeholder="직위를 입력하세요"></div>';
  html+='</div></div>';
  /* [REMOVED] 날씨/미세먼지 설정 — 🔑 API 키 관리 탭으로 이동 완료 */
  return html;
}

/* ── Account tab post-render bindings ── */
export function _bindAccountTab(){
  /* edit button */
  const editBtn=document.getElementById('accountEditBtn');
  if(editBtn){
    editBtn.addEventListener('click',function(){settingsEditUserInfo();});
    editBtn.addEventListener('mouseenter',function(){this.style.background='rgba(59,130,246,0.2)';});
    editBtn.addEventListener('mouseleave',function(){this.style.background='rgba(59,130,246,0.12)';});
  }
  /* user name input */
  const setUserName=document.getElementById('setUserName');
  if(setUserName)setUserName.addEventListener('input',function(){saveUserSettings();});
  /* user position select */
  const setUserPos=document.getElementById('setUserPosition');
  if(setUserPos)setUserPos.addEventListener('change',function(){
    saveUserSettings();
    const ci=document.getElementById('setUserPositionCustom');
    if(ci){ci.style.display=this.value===''?'block':'none';}
  });
  /* user position custom input */
  const setUserPosCustom=document.getElementById('setUserPositionCustom');
  if(setUserPosCustom)setUserPosCustom.addEventListener('input',function(){saveUserSettings();});
}

/* ── CD Key functions ── */
let _cdkeyVisible=false;
function toggleCdkeyVisibility(){
  _cdkeyVisible=!_cdkeyVisible;
  const disp=document.getElementById('cdkeyDisplay');
  const eye=document.getElementById('cdkeyEyeToggle');
  const key=localStorage.getItem('ec_cdkey')||'';
  if(disp){disp.textContent=_cdkeyVisible?key:('\u2022').repeat(Math.min(key.length,16));}
  if(eye){eye.innerHTML=dailyColEyeIcon(_cdkeyVisible);}
}
function _saveCdkey(val){
  localStorage.setItem('ec_cdkey',val);
  localStorage.setItem('ec_cdkey_activated',new Date().toISOString().slice(0,10));
  if(localStorage.getItem('ec_cdkey_notify')===null)localStorage.setItem('ec_cdkey_notify','true');
  if(window.electronAPI&&window.electronAPI.dbSet){
    window.electronAPI.dbSet('common','cdkey_data',val);
    window.electronAPI.dbSet('common','cdkey_activated',new Date().toISOString().slice(0,10));
  }
}
function registerCdkey(){
  const inp=document.getElementById('cdkeyInput');
  const val=inp?inp.value.trim():'';
  if(!val){alert('시디키를 입력하세요.');return;}
  _saveCdkey(val);
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='시디키가 등록되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);}
  renderSettingsPanel('account');
}
function registerNewUserCdkey(){
  const inp=document.getElementById('hoNewCdkey');
  const val=inp?inp.value.trim():'';
  if(!val){alert('시디키를 입력하세요.');return;}
  _saveCdkey(val);
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='새 사용자 시디키가 등록되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},3000);}
  renderSettingsPanel('account');
}
function cdkeyRecoverConfirm(){
  const ov=document.createElement('div');
  ov.className='modal-overlay show';
  ov.id='cdkeyRecoverOverlay';
  ov.innerHTML='<div class="modal-content" style="width:380px;max-width:92vw;padding:0;border-radius:10px;overflow:hidden">'
    +'<div style="padding:12px 16px;background:var(--popup-head);border-bottom:1px solid var(--bdr)"><span style="font-size:13px;font-weight:800;color:var(--t1)">🔑 시디키 회수</span></div>'
    +'<div style="padding:16px"><div style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.6">내장된 시디키를 삭제하시겠습니까?</div>'
    +'<div style="display:flex;justify-content:flex-end;gap:6px">'
    +'<button class="btn btn-outline btn-sm" data-action="cancel">아니오</button>'
    +'<button class="btn btn-primary btn-sm" data-action="confirm">예</button>'
    +'</div></div></div>';
  ov.addEventListener('click',function(e){
    if(e.target===ov)closeModalGracefully(ov);
    const act=e.target.dataset&&e.target.dataset.action;
    if(act==='cancel')closeModalGracefully('cdkeyRecoverOverlay');
    if(act==='confirm')cdkeyRecoverExecute();
  });
  document.body.appendChild(ov);
}
function cdkeyRecoverExecute(){
  localStorage.removeItem('ec_cdkey');
  localStorage.removeItem('ec_cdkey_activated');
  const ov=document.getElementById('cdkeyRecoverOverlay');
  if(ov)closeModalGracefully(ov);
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='삭제되었습니다';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2500);}
  renderSettingsPanel('account');
}
function checkCdkeyExpiry(){
  const key=localStorage.getItem('ec_cdkey');
  const act=localStorage.getItem('ec_cdkey_activated');
  if(!key||!act)return;
  const actD=new Date(act);
  const expD=new Date(actD.getTime()+365*24*60*60*1000);
  const remain=Math.ceil((expD.getTime()-Date.now())/(24*60*60*1000));
  if(remain<=0){
    const ov=document.createElement('div');
    ov.className='modal-overlay show';
    ov.id='cdkeyExpiredOverlay';
    ov.innerHTML='<div class="modal-content" style="width:380px;max-width:92vw;padding:0;border-radius:10px;overflow:hidden">'
      +'<div style="padding:12px 16px;background:var(--popup-head);border-bottom:1px solid var(--bdr)"><span style="font-size:13px;font-weight:800;color:var(--t1)">🔑 시디키 만료</span></div>'
      +'<div style="padding:16px"><div style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.6">시디키가 만료되었습니다. 새 시디키를 등록해주세요.</div>'
      +'<div style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" data-action="close">확인</button></div></div></div>';
    ov.addEventListener('click',function(e){const act=e.target.dataset&&e.target.dataset.action;if(act==='close')closeModalGracefully('cdkeyExpiredOverlay');});
    document.body.appendChild(ov);
  } else if(remain<=5){
    const notify=localStorage.getItem('ec_cdkey_notify')!=='false';
    if(notify){
      const ov2=document.createElement('div');
      ov2.className='modal-overlay show';
      ov2.id='cdkeyWarnOverlay';
      ov2.innerHTML='<div class="modal-content" style="width:380px;max-width:92vw;padding:0;border-radius:10px;overflow:hidden">'
        +'<div style="padding:12px 16px;background:var(--popup-head);border-bottom:1px solid var(--bdr)"><span style="font-size:13px;font-weight:800;color:var(--t1)">🔑 시디키 만료 예정</span></div>'
        +'<div style="padding:16px"><div style="font-size:12px;color:var(--t2);margin-bottom:6px;line-height:1.6">시디키 만료까지 <b style="color:var(--yl)">'+remain+'일</b> 남았습니다.</div>'
        +'<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.5">미리 등록해두면 기간 만료 후 연속성있게 사용할 수 있습니다.</div>'
        +'<div style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" data-action="close">확인</button></div></div></div>';
      ov2.addEventListener('click',function(e){const act=e.target.dataset&&e.target.dataset.action;if(act==='close')closeModalGracefully('cdkeyWarnOverlay');});
      document.body.appendChild(ov2);
    }
  }
}

/* ── Handover functions ── */
let _handoverMode='handover';
function handoverShowForm(mode){
  _handoverMode=mode||'handover';
  const s1=document.getElementById('handoverStep1');
  const s2=document.getElementById('handoverStep2');
  if(s1)s1.style.display='none';
  if(s2)s2.style.display='block';
  const label=document.getElementById('hoModeLabel');
  if(label)label.textContent='🔄 인수인계';
  const curBlock=document.getElementById('hoCurrentBlock');
  if(curBlock)curBlock.style.display='';
  const arrowEl=document.getElementById('hoArrow');
  if(arrowEl)arrowEl.style.display='flex';
  const sel=document.getElementById('hoNewPos');
  if(sel)sel.addEventListener('change',function(){const w=document.getElementById('hoNewPosCustomWrap');if(w)w.style.display=this.value===''?'block':'none';});
}
function handoverCancel(){
  const s1=document.getElementById('handoverStep1');
  const s2=document.getElementById('handoverStep2');
  if(s1)s1.style.display='block';
  if(s2)s2.style.display='none';
}
function handoverApply(){
  const nameEl=document.getElementById('hoNewName');
  const posEl=document.getElementById('hoNewPos');
  const posCustomEl=document.getElementById('hoNewPosCustom');
  const newName=(nameEl?nameEl.value:'').trim();
  let newPos=posEl?posEl.value:'보건교사';
  if(newPos===''&&posCustomEl)newPos=posCustomEl.value.trim();
  if(!newName){alert('새 사용자 이름을 입력하세요.');return;}
  if(!newPos){alert('새 사용자 직위를 입력하세요.');return;}
  if(!confirm('인수인계를 진행하시겠습니까?\n\n새 사용자: '+newPos+' '+newName+'\n\n기존 사용자 정보가 변경됩니다.'))return;
  const user=JSON.parse(localStorage.getItem('ec_user')||'{}');
  user.name=newName;
  user.position=newPos;
  localStorage.setItem('ec_user',JSON.stringify(user));
  if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','user_profile',user);
  S.settings.nurse1=newName;
  saveSettings();
  alert('인수인계가 완료되었습니다.\n새 사용자: '+newPos+' '+newName);
  renderSettingsPanel('account');
  renderHeader();
}

/* ── User info edit functions ── */
function settingsEditUserInfo(){
  const u=S._userProfile||{};
  const s=S.settings||{};
  const el=document.getElementById('userInfoDisplay');
  if(!el)return;
  const curEdu=u.eduOffice||s.eduOffice||'';
  const curPos=u.position||'';
  const isCustomPos=(curPos!=='보건교사'&&curPos!=='보건지원강사'&&curPos!=='');
  const eduOptions=(window._eduOfficeList&&window._eduOfficeList.length)?window._eduOfficeList:['서울특별시교육청','부산광역시교육청','대구광역시교육청','인천광역시교육청','광주광역시교육청','대전광역시교육청','울산광역시교육청','경기도교육청','충청남도교육청','충청북도교육청','경상남도교육청','경상북도교육청','전라남도교육청','전북특별자치도교육청','강원특별자치도교육청','제주특별자치도교육청','세종특별자치시교육청'];
  let eduSel='<select class="form-input" id="editEduOffice" style="font-size:12px;padding:4px 8px"><option value="">-- 선택하세요 --</option>';
  eduOptions.forEach(function(o){eduSel+='<option value="'+o+'"'+(curEdu===o?' selected':'')+'>'+o+'</option>';});
  eduSel+='</select>';
  const posSel='<select class="form-input" id="editPosition" style="font-size:12px;padding:4px 8px">'
    +'<option value="보건교사"'+((!isCustomPos&&curPos==='보건교사')?' selected':'')+'>보건교사</option>'
    +'<option value="보건지원강사"'+((!isCustomPos&&curPos==='보건지원강사')?' selected':'')+'>보건지원강사</option>'
    +'<option value=""'+(isCustomPos?' selected':'')+'>직접 입력</option></select>';
  el.innerHTML=''
    +'<span style="color:var(--t3)">소속 교육청</span>'+eduSel
    +'<span style="color:var(--t3)">학교</span><input class="form-input" id="editSchool" value="'+(u.school||s.schoolName||'')+'" style="font-size:12px;padding:4px 8px">'
    +'<span style="color:var(--t3)">이름</span><input class="form-input" id="editName" value="'+(u.name||s.nurse1||'')+'" style="font-size:12px;padding:4px 8px">'
    +'<span style="color:var(--t3)">직위</span>'+posSel
    +'<span></span><input class="form-input" id="editPositionCustom" value="'+(isCustomPos?curPos:'')+'" placeholder="직위를 입력하세요" style="font-size:12px;padding:4px 8px;display:'+(isCustomPos?'block':'none')+'">';
  /* addEventListener for edit fields */
  const _editEdu=document.getElementById('editEduOffice');
  const _editSchool=document.getElementById('editSchool');
  const _editName=document.getElementById('editName');
  const _editPos=document.getElementById('editPosition');
  const _editPosCustom=document.getElementById('editPositionCustom');
  if(_editEdu)_editEdu.addEventListener('change',function(){autoSaveEditUserInfo();});
  if(_editSchool)_editSchool.addEventListener('input',function(){autoSaveEditUserInfo();});
  if(_editName)_editName.addEventListener('input',function(){autoSaveEditUserInfo();});
  if(_editPos)_editPos.addEventListener('change',function(){const ci=document.getElementById('editPositionCustom');if(ci){ci.style.display=this.value===''?'block':'none';}autoSaveEditUserInfo();});
  if(_editPosCustom)_editPosCustom.addEventListener('input',function(){autoSaveEditUserInfo();});
}
let _autoSaveUserTimer=null;
function autoSaveEditUserInfo(){
  clearTimeout(_autoSaveUserTimer);
  _autoSaveUserTimer=setTimeout(function(){saveEditUserInfo();},300);
}
function saveEditUserInfo(){
  const u=S._userProfile||{};
  const s=S.settings||{};
  const eo=document.getElementById('editEduOffice');
  const sc=document.getElementById('editSchool');
  const nm=document.getElementById('editName');
  const ps=document.getElementById('editPosition');
  if(eo)u.eduOffice=eo.value.trim();
  if(sc)u.school=sc.value.trim();
  if(nm)u.name=nm.value.trim();
  if(ps){let psV=ps.value.trim();if(psV===''){const cust=document.getElementById('editPositionCustom');psV=cust?cust.value.trim():'';}u.position=psV;}
  s.eduOffice=u.eduOffice;
  s.schoolName=u.school;
  s.nurse1=u.name;
  S._userProfile=u;
  S.settings=s;S.settings=s;
  /* localStorage 동기화 — 설정 렌더링 시 참조 */
  try{localStorage.setItem('ec_user',JSON.stringify(u));}catch(e){}
  try{localStorage.setItem('ec_settings',JSON.stringify(s));}catch(e){}
  /* _currentUser 동기화 → 전광판·헤더 등에서 즉시 반영 */
  if(S._currentUser){
    S._currentUser.name=u.name||'';
    S._currentUser.position=u.position||'';
    S._currentUser.school_name=u.school||'';
    S._currentUser.edu_office=u.eduOffice||'';
  }
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon){
    window.electronAPI.jsonSaveCommon('user_profile',u).catch(function(err){console.error('[DB] user_profile 저장 실패:',err);});
    window.electronAPI.jsonSaveCommon('settings',s).catch(function(err){console.error('[DB] settings 저장 실패:',err);});
  }
  /* users 테이블도 동기화 */
  if(S._currentUser&&S._currentUser.id&&window.electronAPI&&window.electronAPI.userUpdate){
    window.electronAPI.userUpdate(S._currentUser.id,{
      name:u.name||'',position:u.position||'',school_name:u.school||'',edu_office:u.eduOffice||''
    }).catch(function(err){console.error('[DB] users 테이블 동기화 실패:',err);});
  }
  renderHeader();
  /* 학교·교육청 저장 직후 서버 수집 발사 — 코드 있고 미수집이면 그때 채워짐(개인정보 아님, 동의 불필요). 플래그로 1회만. (2026-06-15) */
  try{ maybeSendHeartbeat(); }catch(_){}
}

/* ── User settings save ── */
function saveUserSettings(){
  const user=S._userProfile||{};
  const un=document.getElementById('setUserName');const up=document.getElementById('setUserPosition');
  if(un)user.name=un.value;
  if(up){let psV=up.value;if(psV===''){const cust=document.getElementById('setUserPositionCustom');psV=cust?cust.value.trim():'';}user.position=psV;}
  S._userProfile=user;
  S.settings.nurse1=user.name||'';
  /* _currentUser 동기화 */
  if(S._currentUser){
    if(un)S._currentUser.name=user.name||'';
    if(up)S._currentUser.position=user.position||'';
  }
  if(window.electronAPI&&window.electronAPI.jsonSaveCommon)
    window.electronAPI.jsonSaveCommon('user_profile',user).catch(function(err){console.error('[DB] user_profile 저장 실패:',err);});
  /* users 테이블도 동기화 */
  if(S._currentUser&&S._currentUser.id&&window.electronAPI&&window.electronAPI.userUpdate){
    window.electronAPI.userUpdate(S._currentUser.id,{name:user.name||'',position:user.position||''}).catch(function(){});
  }
  saveSettings();
}

/* ── Expose to global scope ── */

