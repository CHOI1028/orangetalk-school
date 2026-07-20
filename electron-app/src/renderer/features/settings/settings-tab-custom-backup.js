/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */

/**
 * settings-tab-custom-backup.js — 학교 이동용 "커스텀 백업과 반영" 탭.
 *
 *  · 사이드바 [🎨 커스텀 백업과 반영] 클릭 시 진입.
 *  · 자주 쓰는 처치·사용자 추가 증상·약품 매칭·API 키·열필드 너비·탭 순서·배경·헤더 메시지·
 *    홈 위젯·커스텀 양식 출력(방문확인증)·키오스크 정의·시간표·커스텀 설문·증상 자유 기입 매핑 등
 *    학교 이동 시 옮겨가야 하는 모든 사용자 커스텀을 한 폴더에 백업/복원.
 *  · 압축 없이 폴더 그대로 복사 (컴맹 사용자 친화). 등록부: src/main/services/custom-backup-keys.js
 *
 *  ★ 새 사용자 커스텀 기능 추가 시 반드시 custom-backup-keys.js 에 키 등록 — 그렇지 않으면
 *    학교 이동 사용자의 데이터가 새 PC 로 따라가지 않아 잃어버리게 됨. CLAUDE.md 정책 항목 참조.
 */
import { escHtml } from '../../core/helpers.js';

export function _renderCustomBackupTab(){
  let html = '<div class="settings-panel-title">🎨 커스텀 백업과 반영</div>';
  html += '<div class="settings-panel-desc">학교를 이동하실 때 그동안 직접 설정해 두신 커스텀 값(자주 쓰는 처치, 사용자 추가 증상, 약품 매칭, API 키, 중분류 증상 순서, 열필드 설정, 커스텀 양식 출력 등)을 새 학교 PC 로 그대로 옮겨 갈 수 있습니다. <b>학생·교직원 명단 같은 사용자별 데이터는 포함되지 않습니다 — 새 학교에서 새로 등록합니다.</b></div>';

  /* 통계 카운트 — localStorage 직접 추출 */
  let _cbFavSymCount = 0;
  try {
    const _f = JSON.parse(localStorage.getItem('ec_user_sym_fav')||'{}');
    Object.keys(_f).forEach(function(k){ if(Array.isArray(_f[k])) _cbFavSymCount += _f[k].length; });
  } catch(_){}
  let _cbApiKeyCount = 0;
  ['ec_airkorea_api_key','ec_drug_api_key','ec_emergency_api_key','ec_hira_api_key','ec_kakao_js_api_key','ec_kakao_rest_api_key','ec_neis_api_key','ec_kdca_api_key'].forEach(function(k){
    if(localStorage.getItem(k)) _cbApiKeyCount++;
  });
  let _cbUserSymCount = 0;
  try {
    const _us = JSON.parse(localStorage.getItem('ec_user_symptoms')||'{}');
    _cbUserSymCount = Array.isArray(_us) ? _us.length : Object.keys(_us||{}).length;
  } catch(_){}
  let _cbVpCustomCount = 0;
  try {
    const _vp = JSON.parse(localStorage.getItem('ec_vp_custom_names')||'{}');
    _cbVpCustomCount = Object.keys(_vp||{}).length;
  } catch(_){}
  let _cbKioskCount = 0;
  try {
    const _allKeys = Object.keys(localStorage);
    _cbKioskCount = _allKeys.filter(function(k){ return k.indexOf('ec_kiosk') === 0; }).length;
  } catch(_){}

  html += '<div class="cc" style="padding:14px;margin-bottom:12px;border-left:3px solid var(--cyan)">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:8px">📦 백업 대상 데이터 현황</div>';
  html += '<div style="font-size:11.5px;color:var(--t3);margin-bottom:10px;line-height:1.7">아래 데이터들이 한 폴더에 함께 백업됩니다. 새 PC 에서 "📤 커스텀 설정 파일 적용하기" 로 그 폴더만 선택하시면 자동 복원됩니다.</div>';
  /* 통계 칩 — 마우스 호버 시 그게 무엇인지 설명 팝업 (사용자 요청 2026-05-22).
   *  기존 프로젝트 툴팁 시스템(data-tooltip)이 미동작해도 브라우저 기본 title 폴백. */
  const _chipStyle = 'font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;background:var(--bg2);cursor:help';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
  html += '<span style="'+_chipStyle+'" data-tooltip="증상별로 미리 등록해 둔 자주 쓰는 처치입니다. 증상 선택 시 자동 추천 후보로 표시됩니다. (설정 → 보건일지 설정 → 증상별 자주 쓰는 처치 / 또는 증상 모달의 + 추가)" data-tooltip-instant="1" title="증상별로 미리 등록해 둔 자주 쓰는 처치. 증상 선택 시 자동 추천 후보로 표시됩니다.">⭐ 자주 쓰는 처치 <b>'+_cbFavSymCount+'</b>건</span>';
  html += '<span style="'+_chipStyle+'" data-tooltip="기본 중분류 증상 목록에 사용자가 직접 + 추가한 증상입니다. 중분류 패널 하단 [+ 추가] 버튼으로 등록한 것." data-tooltip-instant="1" title="기본 중분류 증상 목록에 사용자가 직접 추가한 증상.">➕ 사용자 추가 증상 <b>'+_cbUserSymCount+'</b>건</span>';
  html += '<span style="'+_chipStyle+'" data-tooltip="외부 API 인증 키 — 카카오 지도, HIRA 병원/약국 검색, 식약처 약품 정보, 응급의료 정보원, 기상청, 에어코리아 등. (설정 → API 키)" data-tooltip-instant="1" title="외부 API 인증 키 (카카오·HIRA·식약처·응급의료·기상청·에어코리아 등).">🔑 API 키 <b>'+_cbApiKeyCount+'</b>건</span>';
  if(_cbVpCustomCount>0) html += '<span style="'+_chipStyle+'" data-tooltip="방문확인증·진단서 등 사용자가 만든 출력 양식. 양식 슬롯의 이름·필드·서명·도장 이미지가 모두 포함됩니다." data-tooltip-instant="1" title="사용자가 만든 커스텀 출력 양식 (방문확인증·진단서 등). 슬롯 이름·필드·서명·도장 이미지 포함.">🖨 커스텀 양식 <b>'+_cbVpCustomCount+'</b>개</span>';
  if(_cbKioskCount>0) html += '<span style="'+_chipStyle+'" data-tooltip="키오스크 화면 정의·접수 흐름·언어 설정 등. 사용자가 직접 편집한 키오스크 설정 데이터." data-tooltip-instant="1" title="키오스크 화면 정의·접수 흐름·언어 설정 등 사용자 편집 데이터.">📱 키오스크 키 <b>'+_cbKioskCount+'</b>개</span>';
  html += '</div>';
  html += '<div style="font-size:12px;font-weight:700;color:var(--t2);margin:12px 0 6px">✅ 백업할 항목 선택 <span style="font-size:10px;font-weight:500;color:var(--t3)">(체크한 항목만 백업됩니다)</span></div>';
  html += '<div id="cbCatChecks" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px;font-size:11.5px;color:var(--t2)">불러오는 중…</div>';
  html += '<div style="display:flex;gap:8px;margin-top:10px">'
    + '<button class="btn btn-primary btn-sm" id="customBackupExportBtn">📥 커스텀 설정 백업하기</button>'
    + '<button class="btn btn-sm" id="customBackupImportBtn">📤 커스텀 설정 파일 적용하기</button>'
    + '</div>';
  html += '</div>';

  html += '<div class="cc" style="padding:14px;margin-bottom:12px;border-left:3px solid var(--cyan)">'
    + '<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">💡 사용 안내</div>'
    + '<ol style="font-size:11px;color:var(--t2);line-height:1.9;padding-left:18px;margin:0">'
    + '<li><b>현 학교 PC 에서</b> "📥 커스텀 설정 백업하기" 클릭 → 저장할 폴더 선택 (USB·외장하드 등)</li>'
    + '<li>지정 폴더 안에 <code>OrangePharm-커스텀-YYYY-MM-DD-HHMM</code> 폴더가 만들어지고, 그 안에 모든 커스텀 설정 파일이 저장됩니다 (압축 안 함).</li>'
    + '<li>그 폴더 전체를 USB 에 복사하여 새 학교 PC 로 가져갑니다.</li>'
    + '<li><b>새 학교 PC 에서</b> 오렌지톡 실행 → 이 탭에서 "📤 커스텀 설정 파일 적용하기" 클릭 → 위 <b>파일들이 들어있는 폴더</b>만 선택</li>'
    + '<li>자동 적용 완료 → 잠시 후 앱이 자동 재시작 → 현 학교 PC 에서 쓰던 모든 커스텀이 그대로 복원</li>'
    + '</ol></div>';

  html += '<div class="cc" style="padding:14px;margin-bottom:12px;border-left:3px solid #eab308">'
    + '<div style="font-size:12px;font-weight:700;color:#a16207;margin-bottom:8px">⚠ 포함되지 않는 데이터</div>'
    + '<ul style="font-size:11px;color:var(--t2);line-height:1.9;padding-left:18px;margin:0">'
    + '<li><b>학생·교직원 명단</b> — 학교가 바뀌면 새로 등록</li>'
    + '<li><b>보건일지·응급·감염 기록</b> — 학교 데이터 (DB 백업·복원은 별도 "🛡 백업과 삭제" 탭)</li>'
    + '<li><b>학교 위치·주소</b>, <b>침상 설정</b>, <b>학기 정보</b>, <b>인증코드</b>, <b>보건교사 계정·아바타·지역 설정</b></li>'
    + '</ul></div>';
  return html;
}

export function _bindCustomBackupTabEvents(){
  const cbExpBtn = document.getElementById('customBackupExportBtn');
  if(cbExpBtn) cbExpBtn.addEventListener('click', function(){ _customBackupExport(); });
  const cbImpBtn = document.getElementById('customBackupImportBtn');
  if(cbImpBtn) cbImpBtn.addEventListener('click', function(){ _customBackupImport(); });
  _cbPopulateCategories();
}

/* 백업 대상 카테고리 체크박스 채우기 (등록부 categories 비동기 조회). 기본 전체 체크. */
async function _cbPopulateCategories(){
  const box = document.getElementById('cbCatChecks');
  if(!box) return;
  if(!(window.electronAPI && window.electronAPI.customBackupListKeys)){ box.textContent = '항목 목록을 불러올 수 없습니다. 앱을 재시작해 주세요.'; return; }
  let res;
  try { res = await window.electronAPI.customBackupListKeys(); }
  catch(e){ box.textContent = '목록 조회 오류: ' + e.message; return; }
  const cats = (res && res.success && res.data && res.data.categories) || [];
  if(!cats.length){ box.textContent = '백업 카테고리가 없습니다.'; return; }
  box.innerHTML = cats.map(function(c){
    return '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;line-height:1.4">'
      + '<input type="checkbox" class="cb-cat" data-cat-id="' + escHtml(c.id) + '" checked style="margin-top:1px;flex-shrink:0">'
      + '<span>' + escHtml(c.label || c.id) + '</span></label>';
  }).join('');
}

async function _customBackupExport(){
  if(!window.electronAPI || !window.electronAPI.customBackupListKeys || !window.electronAPI.customBackupExport){
    alert('이 기능은 새 버전에서 사용 가능합니다. 앱을 재시작해 주세요.');
    return;
  }
  /* 1) 등록부 조회 */
  let keysRes;
  try { keysRes = await window.electronAPI.customBackupListKeys(); }
  catch(e){ alert('등록부 조회 오류: '+e.message); return; }
  if(!keysRes || !keysRes.success){
    alert('등록부 조회 실패: '+((keysRes && keysRes.error) || '알 수 없음'));
    return;
  }
  const k = keysRes.data || {};
  const cats = k.categories || [];
  /* 1.5) 선택된 카테고리 (체크박스) */
  const selectedIds = Array.prototype.slice.call(document.querySelectorAll('#cbCatChecks input.cb-cat:checked')).map(function(cb){ return cb.getAttribute('data-cat-id'); });
  if(!selectedIds.length){ alert('백업할 항목을 하나 이상 선택해 주세요.'); return; }
  const selCats = cats.filter(function(c){ return selectedIds.indexOf(c.id) !== -1; });
  /* 2) localStorage 수집 — 선택된 카테고리의 명시 키 + prefix 매칭만 */
  const lsData = {};
  const allKeys = Object.keys(localStorage);
  selCats.forEach(function(c){
    (c.localStorageKeys || []).forEach(function(key){
      const v = localStorage.getItem(key);
      if(v !== null) lsData[key] = v;
    });
    (c.localStoragePrefixes || []).forEach(function(pref){
      allKeys.forEach(function(key){
        if(key.indexOf(pref) === 0 && lsData[key] === undefined){
          const v = localStorage.getItem(key);
          if(v !== null) lsData[key] = v;
        }
      });
    });
  });
  /* 3) 자동 발견 — 등록부 전체(선택 여부 무관)에 없는 ec_user_* / ec_custom_* / ec_my_* prefix 키 알림 */
  const hint = k.autoDiscoveryHints || {};
  const excludeSet = new Set(hint.excludeKeys || []);
  const registeredSet = new Set(k.localStorageKeys || []);
  const regPrefixes = k.localStoragePrefixes || [];
  function _isRegistered(key){
    if(registeredSet.has(key)) return true;
    for(let i=0;i<regPrefixes.length;i++){ if(key.indexOf(regPrefixes[i]) === 0) return true; }
    return false;
  }
  const undiscovered = [];
  (hint.localStoragePrefixes || []).forEach(function(pref){
    allKeys.forEach(function(key){
      if(key.indexOf(pref) === 0 && !_isRegistered(key) && !excludeSet.has(key)){
        if(undiscovered.indexOf(key) === -1) undiscovered.push(key);
      }
    });
  });
  if(undiscovered.length > 0){
    console.warn('⚠ [custom-backup] 미등록 커스텀 키 발견 — src/main/services/custom-backup-keys.js 에 등록 검토 필요. 이번 백업에 포함되지 않음.\n', undiscovered);
  }
  /* 4) IPC 호출 — main 이 폴더 다이얼로그 + 저장 */
  let res;
  try { res = await window.electronAPI.customBackupExport(lsData, selectedIds); }
  catch(e){ alert('오류: '+e.message); return; }
  if(res && res.canceled) return;
  if(res && res.success){
    let msg = '✅ 커스텀 설정 백업 완료\n\n'
      + '📁 저장 위치:\n'+res.path+'\n\n'
      + '· localStorage: '+res.localStorageCount+'건\n'
      + '· 공통 설정(DB): '+res.appDataCommonCount+'건\n'
      + '· 단일 파일: '+res.fileCount+'개';
    if(undiscovered.length > 0){
      msg += '\n\n⚠ 미등록 커스텀 키 '+undiscovered.length+'건 발견 (콘솔 F12 확인).\n   다음 빌드에서 등록부 추가 검토 필요.';
    }
    msg += '\n\n이 폴더를 USB 에 복사해서 새 학교 PC 로 가져가신 뒤,\n새 PC 에서 "📤 커스텀 설정 파일 적용하기" 로 적용하세요.';
    alert(msg);
  } else {
    alert('백업 실패: '+((res && res.error) || '알 수 없음'));
  }
}

async function _customBackupImport(){
  if(!window.electronAPI || !window.electronAPI.customBackupImport){
    alert('이 기능은 새 버전에서 사용 가능합니다. 앱을 재시작해 주세요.');
    return;
  }
  const ok = confirm('현재 PC 의 커스텀 설정이 백업 폴더의 내용으로 덮어쓰여집니다.\n\n계속하시겠습니까?\n(학생/교직원 명단·보건일지 기록은 영향 없음)');
  if(!ok) return;
  let res;
  try { res = await window.electronAPI.customBackupImport(); }
  catch(e){ alert('오류: '+e.message); return; }
  if(res && res.canceled) return;
  if(res && res.success){
    /* localStorage 데이터 직접 적용 (renderer 영역) */
    const lsData = res.localStorageData || {};
    let appliedCount = 0;
    Object.keys(lsData).forEach(function(key){
      try {
        localStorage.setItem(key, String(lsData[key]));
        appliedCount++;
      } catch(e){
        console.warn('[custom-backup-import] localStorage set 실패:', key, e.message);
      }
    });
    const msg = '✅ 커스텀 설정 적용 완료\n\n'
      + '· localStorage: '+appliedCount+'건\n'
      + '· 공통 설정(DB): '+res.appDataCommonCount+'건\n'
      + '· 단일 파일: '+res.fileCount+'개\n\n'
      + '잠시 후 앱이 자동 재시작됩니다.';
    alert(msg);
    /* 1.5초 후 재시작 */
    setTimeout(function(){
      if(window.electronAPI && window.electronAPI.appRelaunch){
        try { window.electronAPI.appRelaunch(); }
        catch(_){ location.reload(); }
      } else {
        location.reload();
      }
    }, 1500);
  } else {
    alert('적용 실패: '+((res && res.error) || '알 수 없음'));
  }
}
