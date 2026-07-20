/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   오렌지톡 인증코드(라이선스) — 검증 · 저장 · 확인 단일 출처
   ───────────────────────────────────────
   설정 탭(_cdkeyVerify)과 실행 게이트(app-bootstrap)가 함께 쓴다.
   성공 시 localStorage + DB common 양쪽에 동일하게 저장 → 어느 경로로 인증해도
   hasCdkeyLicense() 가 동일하게 인식한다. (저장 방식이 갈리면 게이트가 안 풀리므로 단일화 필수)
   ═══════════════════════════════════════ */

import { S } from './app-state.js';

export const CDKEY_VERIFY_URL = 'https://api.school114.org/verify';
const CDKEY_FORMAT = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/* 인증 시점에 서버로 함께 보낼 학교 정보 — 사용자 선택 화면에서 이미 입력한 값을 그대로 사용.
 * · school_name (학교명), edu_office (교육청) 두 가지만 수집. 이름·직위는 개인정보 우려로 수집 안 함.
 * · 둘 다 공개 기관 정보라 PIPA 영향 없음. 운영 통계·문의 응대용으로만 사용.
 * · 1.0.4 부터 적용. 1.0.3 이하 클라이언트는 이 필드를 보내지 않으니 서버 측 user_info 는 NULL 유지. */
function _gatherUserInfo(){
  try{
    const cu = (S && S._currentUser) || {};
    return {
      school_name: String(cu.school_name || '').trim().slice(0, 80),
      edu_office:  String(cu.edu_office  || '').trim().slice(0, 40),
    };
  } catch(_){
    return { school_name:'', edu_office:'' };
  }
}

/* 인증코드 1개를 서버에 검증한다. 성공(valid:true) 시 라이선스를 양쪽에 저장.
 * 반환: { valid:boolean, message:string, status:number, network:boolean }
 *  - network:true  → 서버 연결 실패(인터넷 문제). 사용자가 재시도하면 됨
 *  - status:429    → 요청 횟수 초과(rate limit) */
export async function verifyCdkey(rawKey){
  const key = String(rawKey || '').trim().toUpperCase();
  if(!CDKEY_FORMAT.test(key)){
    return { valid:false, status:0, network:false, message:'인증코드 형식이 올바르지 않습니다. (예: ABCD-1234)' };
  }

  let data = null, status = 0;
  try{
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(function(){ try{ ctl.abort(); }catch(_){} }, 15000) : null;
    const res = await fetch(CDKEY_VERIFY_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ key:key, user_info:_gatherUserInfo() }),
      signal: ctl ? ctl.signal : undefined,
      cache:'no-store'
    });
    if(timer) clearTimeout(timer);
    status = res.status;
    try{ data = await res.json(); }catch(_){ data = null; }
  } catch(err){
    return { valid:false, status:0, network:true, message:'서버에 연결할 수 없습니다. 인터넷 연결을 확인하신 후 다시 시도해 주세요.' };
  }

  /* 요청 횟수 초과 */
  if(status === 429){
    return { valid:false, status:429, network:false, message:((data && data.message) || '요청 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.') };
  }

  /* 성공 → 라이선스 저장 (localStorage 즉시 + DB common 영구) */
  if(data && data.valid === true){
    const machineId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(36).slice(2,14));
    const verifiedAt = new Date().toISOString();
    const license = { key:key, verifiedAt:verifiedAt, machineId:machineId };
    try{ localStorage.setItem('ec_cdkey_license', JSON.stringify(license)); }catch(_){}
    try{
      localStorage.setItem('ec_cdkey', key);
      localStorage.setItem('ec_cdkey_activated', verifiedAt.slice(0,10));
    }catch(_){}
    if(window.electronAPI && window.electronAPI.dbSet){
      try{ window.electronAPI.dbSet('common','cdkey_license', license); }catch(_){}
      try{
        window.electronAPI.dbSet('common','cdkey_data', key);
        window.electronAPI.dbSet('common','cdkey_activated', verifiedAt.slice(0,10));
      }catch(_){}
    }
    return { valid:true, status:status, network:false, message:((data && data.message) || '유효성이 검증되었습니다. 이제 사용가능합니다.') };
  }

  /* 실패 (valid:false 또는 4xx) */
  return { valid:false, status:status, network:false, message:((data && data.message) || '유효하지 않거나 이미 사용된 인증코드입니다.') };
}

/* 이 PC 가 이미 인증됐는지 확인. localStorage 우선, 없으면 DB common 에서 폴백 복원.
 * (업데이트/재설치로 localStorage 가 비어도 userData DB 에서 자동 복원) */
export async function hasCdkeyLicense(){
  try{
    const raw = localStorage.getItem('ec_cdkey_license');
    if(raw){
      const lic = JSON.parse(raw);
      if(lic && lic.key && lic.verifiedAt) return true;
    }
  }catch(_){}
  if(window.electronAPI && window.electronAPI.dbGet){
    try{
      const r = await window.electronAPI.dbGet('common','cdkey_license');
      if(r && r.success && r.exists && r.data){
        const lic = (typeof r.data === 'string') ? JSON.parse(r.data) : r.data;
        if(lic && lic.key && lic.verifiedAt){
          try{ localStorage.setItem('ec_cdkey_license', JSON.stringify(lic)); }catch(_){}
          return true;
        }
      }
    }catch(_){}
  }
  return false;
}
