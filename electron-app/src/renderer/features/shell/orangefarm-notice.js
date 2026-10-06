/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   오렌지팜 안내 팝업 — 로그인(사용자 설정) 완료 후 1회성 소식 안내 (사용자 요청 2026-06-10)
   ───────────────────────────────────────
   · 표시 시점: hideSplash(메인 진입) 후 1.5초.
   · [다시 보지 않기] 클릭 → localStorage 에 영구 기록, 그 소식은 다시는 안 뜸.
   · ✕(닫기)/배경 클릭 → 이번 세션만 닫음, 다음 실행 때 다시 표시.
   · ★ 기능 개선 때마다 재사용: 아래 NOTICE 의 id 를 새 값으로 바꾸고 paragraphs/images 만 고치면
     이전 '다시 보지 않기'와 무관하게 새 소식으로 다시 1회 표시된다. (사용자 방침 2026-06-10 — 삭제하지 말 것)
   · images: 본문 문단 뒤에 표시할 이미지 경로 배열 (앱 루트 상대경로, 예: 'assets/notice/today-memo.png').
   ═══════════════════════════════════════ */
'use strict';
import { playUiSound } from '../../core/ui-utils.js';

/* ── 이번 소식들 — 순차 표시 (사용자 요청 2026-06-18: 못 읽은 분이 많아 2회에 걸쳐 나눠 안내).
 *  실행마다 '아직 안 본 첫 소식' 1개만 뜨고, 본 소식은 localStorage 에 영구 기록 → 다음 실행 땐 그다음 소식.
 *  새 소식은 배열 뒤에 {id,title,emoji,paragraphs,sign,images} 로 추가(삭제하지 말 것). ── */
const NOTICES = [{
  id: 'v1012-update-loop-diag-teachersig',
  title: '기능 추가와 개선 사항을 알려드립니다',
  emoji: '🔔',
  paragraphs: [
    '안녕하세요. 오렌지팜입니다.<br>이번 <b style="color:var(--t1)">1.0.12 버전</b> 기능 개선 사항을 말씀드리고자 합니다.',
    '<b style="color:var(--t1)">1. 업데이트 무한 루프 현상 개선과 진단</b><br>일부 선생님들 PC에서 프로그램 업데이트 시 발생하는 무한 루프 현상 개선과 진단입니다. 선생님들마다 PC 환경이 달라서 저희가 추측하여 무한 루프 현상을 파악하여 없애고자 시도하였습니다. 1.0.11 버전이 이미 설치되어 있다면 이것이 없어진 후인, 즉 <b style="color:var(--t1)">1.0.13 버전부터는 괜찮을 것으로 예상</b>합니다. 더 정확한 파악을 위해 무한 루프 시 진단 메시지가 나타나면서 <b style="color:var(--t1)">클립보드에 복사할 수 있는 버튼</b>을 마련해 놓았으니, 혹시 이 문제가 있을 시 오렌지팜으로 해당 내용을 보내주시면 감사하겠습니다.',
    '<b style="color:var(--t1)">2. 커스텀 양식 출력 — 교사 확인란 독립 on/off</b><br>커스텀 양식 출력에서 교사 확인란을 \'보건·교과·담임\'을 독립하여 on/off할 수 있도록 하였습니다. 필요한 내용을 모두 또는 개별 선택하여 출력하셔서 쓰시면 되겠습니다.',
    '이번 주도 행복한 한 주 되세요.',
    '감사합니다.'
  ],
  sign: '오렌지팜 가족 일동',
  images: []
}, {
  id: 'v1014-update-loop-realfix',
  title: '업데이트 무한 루프 — 원인을 찾아 개선했습니다',
  emoji: '✅',
  paragraphs: [
    '안녕하세요. 오렌지팜입니다.<br>이번 <b style="color:var(--t1)">1.0.14 버전</b>에서 업데이트 무한 루프 현상의 원인을 정확히 찾아 개선하였습니다.',
    '<b style="color:var(--t1)">원인</b><br>동료 협업(웹브라우저 협업)을 켜둔 상태에서 업데이트가 설치될 때, 협업 서버가 프로그램 파일을 잠시 잡고 있어 설치가 끝까지 적용되지 못하고 반복되던 것이 원인이었습니다.',
    '<b style="color:var(--t1)">개선</b><br>1.0.14 버전부터는 <b style="color:var(--t1)">협업을 켜둔 채로도</b> 업데이트가 설치 직전에 협업 서버를 안전하게 정리한 뒤 적용되도록 바꾸었습니다. <b style="color:var(--t1)">선생님께서 따로 하실 일은 없습니다.</b> 평소처럼 쓰시면 자동으로 설치됩니다.',
    '혹시 그래도 같은 증상이 보이면, 진단 메시지와 함께 <b style="color:var(--t1)">클립보드 복사 버튼</b>이 나타나니 그 내용을 오렌지팜으로 보내주시면 끝까지 살펴보겠습니다.',
    '늘 감사드립니다.'
  ],
  sign: '오렌지팜 가족 일동',
  images: []
}];

function _ofarmKey(id){ return 'ec_ofarm_notice_dismissed_' + id; }

function _esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

export function showOrangefarmNotice(){
  if(document.getElementById('ofarmNoticeOv')) return;   /* 이미 떠 있으면 중복 표시 안 함 */
  /* 아직 안 본 소식들을 모두 동시에 표시 (사용자 요청 2026-06-18: 못 읽은 분 많아 함께 띄움) */
  const pending = NOTICES.filter(function(n){
    try{ return localStorage.getItem(_ofarmKey(n.id)) !== '1'; }catch(_){ return true; }
  });
  if(!pending.length) return;
  /* 표시 즉시 '본 것'으로 기록 — 닫지 않고 앱을 꺼도 다음 실행 땐 안 뜸 (각 소식 정확히 1회) */
  pending.forEach(function(n){ try{ localStorage.setItem(_ofarmKey(n.id), '1'); }catch(_){} });
  try{ playUiSound('updatenotification.wav', 0.7); }catch(_){}   /* 효과음 1회 (사용자 요청 2026-06-18) */

  /* 단일 배경(딤) 하나 + 소식별 박스 — 두 팝업이 한 화면에 함께(살짝 대각선 cascade) 또렷이 뜨고, 각자 [닫기]로만 닫힘.
   *  박스를 클릭하면 맨 앞으로(가린 박스도 닫기 쉽게). 배경 클릭·ESC 로는 안 닫힘. 마지막 박스를 닫으면 배경도 사라짐. (사용자 요청 2026-06-18) */
  const ov = document.createElement('div');
  ov.id = 'ofarmNoticeOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:11500;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;padding:16px;box-sizing:border-box;background:rgba(0,0,0,0.42);opacity:0;transition:opacity 0.2s ease';
  document.body.appendChild(ov);
  /* 박스 폭 — 여러 개면 화면 절반 이하로 줄여 가로로 나란히(겹치지 않게), 하나면 넓게 */
  const boxMaxW = (pending.length > 1) ? 'min(680px,46vw)' : 'min(680px,94vw)';
  let remaining = pending.length;

  pending.forEach(function(NOTICE){
    let body = '';
    NOTICE.paragraphs.forEach(function(p){ body += '<p style="margin:0 0 14px">' + p + '</p>'; });
    (NOTICE.images || []).forEach(function(src){
      body += '<div style="margin:0 0 14px;text-align:center"><img src="' + _esc(src) + '" style="max-width:100%;border:1px solid var(--bdr);border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,0.18)" onerror="this.parentNode.style.display=\'none\'"></div>';
    });
    body += '<p style="margin:0;text-align:right;color:var(--t1);font-weight:700">' + _esc(NOTICE.sign) + '</p>';

    const box = document.createElement('div');
    box.className = 'ofarmNoticeBox';
    box.style.cssText = 'flex:0 1 auto;width:' + boxMaxW + ';max-height:94vh;background:var(--card);border-radius:16px;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.40);border:1px solid var(--bdr);overflow:hidden;opacity:0;transform:scale(0.96);transition:opacity 0.22s ease,transform 0.22s ease';
    box.innerHTML =
      '<div style="padding:16px 22px;border-bottom:1px solid var(--bdr);background:rgba(6,182,212,0.10);display:flex;align-items:center;gap:10px;flex-shrink:0">'
      +   '<span style="font-size:20px">' + NOTICE.emoji + '</span>'
      +   '<div style="font-size:15px;font-weight:800;color:var(--t1);flex:1">' + _esc(NOTICE.title) + '</div>'
      + '</div>'
      + '<div style="padding:20px 24px 24px;font-size:12.8px;color:var(--t2);line-height:1.85;overflow-y:auto">' + body + '</div>'
      + '<div style="padding:12px 22px;border-top:1px solid var(--bdr);display:flex;justify-content:flex-end;flex-shrink:0">'
      +   '<button class="ofarmNoticeClose" style="padding:8px 24px;font-size:12.5px;font-weight:700;border-radius:8px;border:1px solid rgba(6,182,212,0.40);background:rgba(6,182,212,0.12);color:#0891b2;cursor:pointer;font-family:var(--f)">닫기</button>'
      + '</div>';
    ov.appendChild(box);
    box.querySelector('.ofarmNoticeClose').addEventListener('click', function(e){
      e.stopPropagation();
      box.style.opacity = '0'; box.style.pointerEvents = 'none'; box.style.transform = 'scale(0.96)';
      setTimeout(function(){
        if(box.parentNode) box.parentNode.removeChild(box);
        remaining--;
        if(remaining <= 0){ ov.style.opacity = '0'; setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }, 200); }
      }, 220);
    });
    requestAnimationFrame(function(){ box.style.opacity = '1'; box.style.transform = 'scale(1)'; });
  });
  requestAnimationFrame(function(){ ov.style.opacity = '1'; });
  /* 배경 클릭·ESC 무시 — 닫기 버튼만 (핸들러 없음) */
}
