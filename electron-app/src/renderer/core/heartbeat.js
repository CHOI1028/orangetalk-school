/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   오렌지톡 학교 정보 heartbeat — 1.0.4 첫 부팅 시 1회만
   ───────────────────────────────────────
   배경: 1.0.0~1.0.3 시기에 인증한 사용자는 user_info 가 서버에 안 남았다.
        1.0.4 로 자동 업데이트되어 첫 부팅할 때 단 한 번 학교명·교육청만 전송 → 서버 캐치업.
   정책:
   · 학교명(school_name) + 교육청(edu_office) 두 필드만. 이름·직위 등 개인정보는 절대 안 보냄.
   · 앱 켤 때마다(매 부팅) 발사 — 프로세스 내 메모리 시그니처로 같은 내용 중복 전송만 방지(영구 플래그 없음).
   · 인증 안 한 사용자 / 사용자 선택 전 / 학교 정보 비어있음 → 조용히 종료.
   · 응답 실패해도 절대 사용자 흐름 영향 X (best-effort fire-and-forget).
   · 서버측 정책: status='used' 행의 학교명·교육청을 최신값으로 덮어씀 + 접속시각(last/prev, KST) 기록. 빈 값으로는 안 지움.
   ═══════════════════════════════════════ */

import { S } from './app-state.js';
import { CDKEY_VERIFY_URL } from './cdkey-license.js';

/* 2026-06-17 개편 (사용자 지시): "매 부팅마다 교육청·학교 확인·갱신 + 접속시각 기록".
 *  · 옛 '평생 1회' localStorage 플래그(ec_heartbeat_v*_done) 제거 → 앱 켤 때마다 전송.
 *  · 서버는 status='used' 행의 학교명·교육청을 최신값으로 덮어쓰고(학교 이동 자동 반영) last/prev 접속시각(KST) 기록.
 *  · 같은 실행(프로세스) 안에서 트리거가 여러 번 와도(로그인 직후 + 학교설정 저장 직후) 메모리 시그니처로 1회만 실제 전송.
 *    세션 중 학교명/교육청이 바뀌면 시그니처가 달라져 즉시 재전송 → 서버가 덮어씀.
 *  · 새 부팅 = 새 프로세스 = 시그니처 초기화 = 다시 전송. */
const HEARTBEAT_TIMEOUT_MS = 8000;
let _hbLastSig = null;   /* 프로세스 내 마지막 전송 시그니처 (key|school|office) — 중복 전송 방지 */

export async function maybeSendHeartbeat(){
  try {
    /* 인증 상태 확인 — license 없으면 보낼 대상 아님 */
    const licRaw = localStorage.getItem('ec_cdkey_license');
    if(!licRaw) return;
    let lic;
    try{ lic = JSON.parse(licRaw); }catch(_){ return; }
    if(!lic || !lic.key) return;

    /* 학교명·교육청 — 다중 소스 폴백 (v3, 사용자 지시 2026-06-12):
     *  사용자 프로필(users) → 앱 설정(settings) 순.
     *  프로필에 학교를 안 적은 사용자도 설정의 학교명으로 반드시 수집. */
    const cu = (S && S._currentUser) || {};
    const st = (S && S.settings) || {};
    const school = String(cu.school_name || st.schoolName || '').trim();
    if(!school) return;                               // 어디에도 학교명 없으면 종료 (다음 부팅에 재시도)
    const eduOffice = String(cu.edu_office || st.eduOffice || '').trim();

    /* 앱 버전도 함께 수집(사용자 요청 2026-06-19) — 최신 미설치 사용자 파악 + 오류신고 시 버전 자동 확보.
       개인정보 아님. 못 읽으면 빈 값으로 보냄(서버가 무시). */
    let appVer = '';
    try { if(window.electronAPI && window.electronAPI.updaterGetVersion){ const r = await window.electronAPI.updaterGetVersion(); appVer = (r && r.version) ? String(r.version) : ''; } } catch(_){}

    /* 같은 실행(프로세스)에서 같은 내용을 이미 보냈으면 중복 전송 방지.
       내용(학교/교육청/버전)이 바뀌면 시그니처가 달라져 재전송됨. 새 부팅이면 _hbLastSig=null → 항상 전송. */
    const sig = lic.key + '|' + school + '|' + eduOffice + '|' + appVer;
    if(_hbLastSig === sig) return;

    const body = {
      key: lic.key,
      mode: 'heartbeat',
      app_version: appVer.slice(0, 20),
      user_info: {
        school_name: school.slice(0, 80),
        edu_office: eduOffice.slice(0, 40),
      }
    };

    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(function(){ try{ ctl.abort(); }catch(_){} }, HEARTBEAT_TIMEOUT_MS) : null;
    let ok = false;
    try {
      const res = await fetch(CDKEY_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
        cache: 'no-store'
      });
      if(timer) clearTimeout(timer);
      /* 2xx(서버 정상 처리)일 때만 이번 실행 시그니처 기록 → 같은 내용 중복 전송 방지.
         4xx·5xx·타임아웃·네트워크 실패는 시그니처 미기록 → 다음 트리거/부팅에 재시도. */
      ok = res.ok;
    } catch(_) {
      if(timer) clearTimeout(timer);
    }

    if(ok){
      _hbLastSig = sig;   /* 이번 실행에서 전송 완료 — 같은 내용 재전송 안 함 */
    }
  } catch(_) {
    /* 어떤 예외도 사용자 흐름에 영향 X */
  }
}
