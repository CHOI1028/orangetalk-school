/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * settings-tab-help.js — 설정 "단축키·주요 기능 안내" 탭
 *
 * 사용자가 프로그램 전반의 단축키와 핵심 기능을 한눈에 파악할 수 있도록
 * 체계적으로 정리. macOS System Preferences 스타일.
 */
/* ES Module */
import { escHtml } from '../../core/helpers.js';

const _isMac = /Mac/i.test(navigator.platform);
const _modKey = _isMac ? '⌘' : 'Ctrl';

/* ── 단축키 그룹 ── */
const _shortcutGroups = [
  {
    title:'전역 단축키',
    icon:'🌐',
    items:[
      {keys:[_modKey,'K'], desc:'명령 팔레트 열기 — 원하는 기능을 검색해서 바로 실행'},
      {keys:['?'], desc:'단축키 도움말 팝업 열기'},
      {keys:['Esc'], desc:'팝업·모달 닫기 / 드래그 선택 해제'},
      {keys:[_modKey,','], desc:'설정 열기'},
      {keys:[_modKey,'1'], desc:'대시보드로 이동'},
      {keys:[_modKey,'2'], desc:'일반 보건일지로 이동'},
      {keys:[_modKey,'3'], desc:'오렌지톡으로 이동'},
      {keys:[_modKey,'4'], desc:'매직 스테이션으로 이동'},
    ]
  },
  {
    title:'편집 단축키',
    icon:'✏',
    items:[
      {keys:[_modKey,'Z'], desc:'실행 취소 (Undo)'},
      {keys:[_modKey,'⇧','Z'], desc:'다시 실행 (Redo)'},
      {keys:[_modKey,'Y'], desc:'다시 실행 (Windows 표준)'},
      {keys:[_modKey,'C'], desc:'선택 복사 (텍스트/셀)'},
      {keys:[_modKey,'V'], desc:'붙여넣기'},
      {keys:[_modKey,'X'], desc:'잘라내기'},
      {keys:[_modKey,'A'], desc:'전체 선택 — 현재 표/영역의 모든 항목'},
      {keys:['Delete'], desc:'선택된 행 삭제 (되돌리기 가능)'},
      {keys:['Backspace'], desc:'선택된 행 삭제 (대체)'},
      {keys:[_modKey,'F'], desc:'검색창으로 포커스 이동'},
      {keys:[_modKey,'N'], desc:'추가/신규 버튼 자동 실행'},
      {keys:[_modKey,'S'], desc:'저장 (저장됨 토스트 표시)'},
    ]
  },
  {
    title:'모달·팝업 제어',
    icon:'🪟',
    items:[
      {keys:[_modKey,'W'], desc:'열린 팝업 닫기 (macOS 창 닫기 관습)'},
      {keys:[_modKey,'↵'], desc:'모달 내 주요 확인 버튼 자동 실행'},
      {keys:['Esc'], desc:'최상위 모달 닫기 / 드래그 선택 해제'},
      {keys:[_modKey,'/'], desc:'단축키 도움말 열기 (보조)'},
      {keys:['F1'], desc:'단축키 도움말 열기 (보조)'},
    ]
  },
  {
    title:'일반일지 · 응급처치 · 감염병',
    icon:'📋',
    items:[
      {keys:['드래그'], desc:'마우스 드래그 — 여러 행 한번에 선택'},
      {keys:['Shift','+','클릭'], desc:'범위 선택 — 첫 클릭부터 마지막까지'},
      {keys:[_modKey,'+','클릭'], desc:'복수 선택 — 각 행 개별 토글'},
      {keys:[_modKey,'A'], desc:'현재 탭의 모든 행 선택'},
      {keys:['Delete'], desc:'선택된 행 일괄 삭제'},
      {keys:['Esc'], desc:'드래그 선택 전체 해제'},
      {keys:['←','→'], desc:'달력에서 전일/다음일 이동'},
      {keys:['↑','↓'], desc:'달력에서 전주/다음주 이동'},
    ]
  },
  {
    title:'플로우 편집기 (키오스크)',
    icon:'🔀',
    items:[
      {keys:[_modKey,'Z'], desc:'실행 취소 — 최대 30단계'},
      {keys:[_modKey,'⇧','Z'], desc:'다시 실행'},
      {keys:[_modKey,'D'], desc:'선택된 보기 복제 — 라벨에 (복사본) 자동 추가'},
      {keys:['Delete'], desc:'선택된 보기 삭제'},
      {keys:[_modKey,'+','클릭'], desc:'보기 복수 선택'},
      {keys:['드래그'], desc:'보기·섹션 순서 변경 (같은 계층끼리)'},
      {keys:['↑','↓'], desc:'타깃 선택 팝업에서 항목 탐색'},
      {keys:['↵'], desc:'타깃 선택 팝업 확정'},
    ]
  },
];

/* ── 주요 기능 소개 ── */
const _features = [
  {
    icon:'📋',
    title:'일반일지 · 응급처치 · 감염병 관리',
    desc:'방문 학생의 증상·처치·투약·시간을 기록하고, 연도별·학기별 통계를 자동 집계합니다. 드래그 선택과 키보드 단축키로 효율적으로 관리할 수 있습니다.',
  },
  {
    icon:'📱',
    title:'키오스크 + 릴레이 서버 연동',
    desc:'태블릿이나 노트북을 보건실 키오스크로 사용. 방문자가 직접 인적사항과 증상을 입력하면 보건교사의 일반일지 좌상단에 실시간 수신됩니다. [호출]·[일지 등록] 버튼으로 즉시 처리.',
  },
  {
    icon:'🔀',
    title:'버튼 플로우 디자이너',
    desc:'키오스크 화면 전환 흐름을 드래그로 편집. 바디맵·대기인원·확인 버튼 등 삽입 기능을 옵션별로 지정. 섹션 계층번호(2-1-1)와 브레드크럼으로 구조 파악.',
  },
  {
    icon:'📊',
    title:'대시보드 통계',
    desc:'진료과·학년·성별·처치별 방문 통계, 히트맵, 재방문 분석, 증상 Top5 등 다양한 시각화. 기간 필터와 연도별 비교 제공.',
  },
  {
    icon:'📅',
    title:'매직 스테이션 · 플래너',
    desc:'일별 일정, 루틴, 할일, 메모를 한 곳에서 관리. Google Calendar 연동 지원.',
  },
  {
    icon:'📄',
    title:'커스텀 양식 · 방문확인증',
    desc:'학교·학년·상황에 맞춰 직접 디자인한 양식을 PDF/프린터로 출력. 도장·서명·자동 필드 삽입.',
  },
  {
    icon:'📦',
    title:'물품 대여 대장',
    desc:'핫팩·체온계 등 물품 대여를 빠르게 기록. 매년 3/1 자동 초기화.',
  },
  {
    icon:'🏥',
    title:'보건실 이용 수칙 · 순번 안내',
    desc:'키오스크 하단에 표시되는 운영 시간·예절·순번 안내를 편집. 기기별(태블릿/노트북) + 표시 모드(수칙/순번/번갈아) 선택.',
  },
  {
    icon:'🧭',
    title:'보건교사 행선지 표시',
    desc:'퇴근·출장·식사·회의 등 상황별 안내. 출장 선택 시 예상 복귀 시각 자동 해제.',
  },
  {
    icon:'🌓',
    title:'다크/라이트 모드',
    desc:'시스템 선호에 맞춰 테마 전환. 부드러운 색상 전환 애니메이션.',
  },
  {
    icon:'🔍',
    title:'상세 검색',
    desc:'이름·학년·반·번호·생년월일 등 다양한 조건으로 학생을 검색. 어디서든 🔍 상세 검색 버튼으로 접근.',
  },
  {
    icon:'💾',
    title:'데이터 백업 · 복원',
    desc:'SQLite 단일 파일로 전체 데이터 백업. 다른 기기로 복원 시 그대로 이관. Google Drive 동기화도 지원.',
  },
];

export function _renderHelpTab(){
  let html = '<div class="settings-panel-title">⌨ 단축키 · 주요 기능 안내</div>';

  /* 안내 배너 */
  html += '<div style="padding:14px 18px;margin-bottom:20px;background:var(--card);border:1px solid color-mix(in srgb, var(--cyan) 25%, var(--bdr));border-radius:10px;display:flex;align-items:center;gap:14px">'
    + '<div style="font-size:32px">💡</div>'
    + '<div style="flex:1">'
    + '<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:4px">필수 단축키 2개만 기억하세요</div>'
    + '<div style="font-size:11px;color:var(--t2);line-height:1.7">'
    + '<kbd>'+_modKey+'</kbd><kbd>K</kbd> — <b style="color:var(--cyan)">명령 팔레트</b>를 열어 원하는 기능을 이름으로 검색<br>'
    + '<kbd>?</kbd> — 모든 단축키를 언제든 확인 (입력 중이 아닐 때)'
    + '</div>'
    + '</div>'
    + '<button id="helpOpenPaletteBtn" style="padding:8px 16px;border-radius:8px;border:1.5px solid var(--cyan);background:rgba(6,182,212,0.08);color:var(--cyan);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">지금 열기</button>'
    + '</div>';

  /* 단축키 섹션 — 2열 그리드 */
  html += '<div style="font-size:14px;font-weight:800;color:var(--t1);margin:8px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--bdr)">⌨ 키보드 단축키</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px 24px;margin-bottom:32px">';
  _shortcutGroups.forEach(function(g){
    html += '<div style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:14px 16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:10px;display:flex;align-items:center;gap:6px">'
      + '<span style="font-size:14px">'+g.icon+'</span>'+ _escHtml(g.title)
      + '</div>';
    g.items.forEach(function(it){
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;font-size:11px;border-top:1px dashed color-mix(in srgb, var(--bdr) 60%, transparent)">'
        + '<span style="color:var(--t2);flex:1">'+ _escHtml(it.desc) +'</span>'
        + '<span style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0">';
      it.keys.forEach(function(k){ html += '<kbd>'+ _escHtml(k) +'</kbd>'; });
      html += '</span></div>';
    });
    html += '</div>';
  });
  html += '</div>';

  /* 주요 기능 섹션 */
  html += '<div style="font-size:14px;font-weight:800;color:var(--t1);margin:8px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--bdr)">✨ 주요 기능</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 14px;margin-bottom:24px">';
  _features.forEach(function(f){
    html += '<div class="help-feature-card" style="background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;transition:border-color .15s,transform .12s">'
      + '<div style="font-size:24px;flex-shrink:0;line-height:1">'+f.icon+'</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:3px">'+ _escHtml(f.title) +'</div>'
      + '<div style="font-size:10px;color:var(--t3);line-height:1.6">'+ _escHtml(f.desc) +'</div>'
      + '</div>'
      + '</div>';
  });
  html += '</div>';

  /* 팁 섹션 */
  html += '<div style="background:var(--card);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:16px 20px;margin-bottom:20px">'
    + '<div style="font-size:12px;font-weight:800;color:#16a34a;margin-bottom:10px">💡 생산성 팁</div>'
    + '<ul style="font-size:11px;color:var(--t2);line-height:1.9;padding-left:20px">'
    + '<li><b>명령 팔레트(<kbd>'+_modKey+'</kbd><kbd>K</kbd>)</b>는 "어디에 무슨 메뉴가 있더라" 고민할 때 가장 빠릅니다. 기능 이름을 대충 입력해도 퍼지 검색이 찾아줍니다.</li>'
    + '<li>표에서 여러 행을 정리할 때는 <kbd>드래그</kbd>로 선택한 뒤 <kbd>Delete</kbd> 하나로 일괄 삭제. 실수해도 <kbd>'+_modKey+'</kbd><kbd>Z</kbd>로 되돌리기.</li>'
    + '<li>키오스크 플로우 편집 중 "이 섹션 어디에 있지?" 싶을 때 상단의 <b>📑 목차</b> 버튼이나 섹션 번호 배지를 클릭하면 해당 위치로 순간 이동합니다.</li>'
    + '<li>복잡한 플로우를 쉽게 정리하려면 <b>섹션 접기/펼치기</b>와 <b>모두 접기</b> 버튼을 활용하세요.</li>'
    + '<li>설정 변경 후 키오스크 태블릿에 반영하려면 릴레이 서버 연결 상태에서 <b>태블릿 브라우저 새로고침</b>만 하면 됩니다.</li>'
    + '</ul>'
    + '</div>';

  /* 🔠 콘텐츠 글자 크기 → 🖥 디스플레이 설정 탭으로 이동됨 */

  /* 버전 정보 — macOS "이 Mac에 관하여" 스타일 */
  html += '<div style="padding:24px 20px;background:var(--bg2);border-radius:12px;text-align:center;margin-top:20px">'
    + '<div style="margin-bottom:8px"><img src="assets/logo/logo_big.png" alt="로고" style="width:48px;height:48px;object-fit:contain"></div>'
    + '<div style="font-size:16px;font-weight:800;color:var(--t1);letter-spacing:-0.3px">오렌지톡</div>'
    + '<div style="font-size:12px;color:var(--cyan);font-weight:600;margin-top:4px">버전 1.0.0 "Roma"</div>'
    + '<div style="font-size:10px;color:var(--t3);margin-top:12px;line-height:1.6">'
    + '보건교사를 위한 보건실 업무 통합 프로그램<br>'
    + '만든이: 국방항공고등학교 보건교사 김재웅<br>'
    + '기술자문: 한국전자통신연구원(ETRI) 공학박사 이기영'
    + '</div>'
    + '<div style="font-size:9px;color:var(--t3);margin-top:10px;opacity:0.6">© 2026 오렌지톡. 모든 데이터는 학교 PC에만 저장됩니다.</div>'
    + '</div>';

  return html;
}

function _escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Help tab post-render bindings ── */
export function _bindHelpTab(){
  const paletteBtn=document.getElementById('helpOpenPaletteBtn');
  if(paletteBtn)paletteBtn.addEventListener('click',function(){if(window.openCommandPalette)window.openCommandPalette();});
  const cards=document.querySelectorAll('.help-feature-card');
  cards.forEach(function(card){
    card.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';this.style.transform='translateY(-1px)';});
    card.addEventListener('mouseleave',function(){this.style.borderColor='var(--bdr)';this.style.transform='translateY(0)';});
  });
}

