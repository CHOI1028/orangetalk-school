/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * event-bindings.js — HTML onclick 속성을 대체하는 이벤트 리스너 등록
 * 모든 함수를 import로 가져와 직접 호출합니다 (window 전역 의존 없음).
 */
/* ES Module */

/* ── core ── */
import { S } from './app-state.js';
import { getPublicDataApiKey } from './public-data-settings.js';
import {
  showHeaderTooltip, hideHeaderTooltip, toggleColSelector,
  closeInfForm,
  ecAutoComplete, ecSearchKeydown, ecSelectStudent,
  ecPrintList, ecPrintTable, ecSortByTime, toggleEcColSelector,
  infAutoComplete, infSearchKeydown, infSelectStudent,
  infPrintList, infPrintTable, infSortByTime, toggleInfColSelector
} from '../features/emergency/emergency-view.js';

/* ── shell ── */
import { switchView, switchDailyCat, dismissStoryBadge } from '../features/shell/view-router.js';
import { toggleTheme } from '../features/shell/theme-manager.js';
import { cycleWeather } from '../features/shell/header-widget.js';
import { _setupSelectLevel, showLoginScreen } from '../features/shell/splash-login-controller.js';
import { appConfirmModal } from './ui-utils.js';

/* ── daily ── */
import { sidebarSearch, toggleSideCharts, goToPrevDay, goToNextDay, dailySortByTime, togglePrivacyMode, openMedFacilityPopup, dailySortByCol, _bindNameHoverVisitHistory, _hideVisitHistory } from '../features/daily/daily-view.js';
import { dailyAutoComplete, dailySearchKeydown, selectStudent } from '../features/daily/daily-autocomplete.js';
import { openRentalLedger } from '../features/daily/rental-ledger-view.js';
import { openDiaryPrint } from '../features/daily/diary-print-view.js';

/* ── stats ── */
import { setStatsPeriod } from '../features/stats/stats-view.js';

/* ── settings ── */
import { openSettings, openAdvancedSearch, exportDiary, importData, switchSettingsCat, hoverSettingsCat, switchStorySub, switchOrangeSub } from '../features/settings/settings-view.js';

/* ── person-manager ── */
import { toggleAddPerson } from '../features/person-manager/person-manager-view.js';

/* ── newsletter ── */
import { openQuickMsg, closeQuickMsg, qmInsertVar, vpeStretchBg, vpeRemoveImageBg, vpeCropImage } from '../features/newsletter/newsletter-misc-view.js';

/* ── visit-pass ── */
import { vpSelectFormat, vpAddCustomSlot, openVisitPass } from '../features/visit-pass/visit-pass-view.js';
import {
  _vpeZoomSliderWheel, _zoomLabelClick,
  vpSetPaper, vpSetOrientation, vpToggleAll, vpToggleContent,
  vpSetSigMode, vpDeleteSig, vpSigRemoveBg, vpResetCustomFormat,
  vpDefDrawRulers, vpDefZoomSet, vpDefZoomFit,
  vpHandleSigDrop, vpHandleSigFile,
  vpeBgHandleDrop, vpeBgLoadFile,
  vpeSetBgScale, vpeSetBgOffsetY, vpeSetBgOffsetX, vpeSetMarginSide,
  vpExportFile, vpDirectDownload, vpDirectPrint, vpOpenPrintDialog,
  vpeToggleStyle, vpeUpdateStyle, vpeTogglePalette,
  vpeTblBorderToggle, vpeCellBgApply,
  vpeAddObject, vpeAddTable, vpeAddImage,
  vpeEmojiMenuToggle, vpeDynMenuToggle, vpeInsertDynField,
  vpeTableAddRow, vpeTableAddCol, vpeTableDelRow, vpeTableDelCol,
  vpeMergeCells, vpeUnmergeCells,
  vpeCopyObj, vpeDeleteObj, vpeResetEditor,
  vpeZOrder, vpeZOrderMax, vpeZOrderMin, vpeAlign,
  vpeZoomSet, vpeZoomFit
} from '../features/visit-pass/visit-pass-editor.js';

/* ── dashboard ── */
import { _dashExportFullPDF, _dashPrevPeriod, _dashNextPeriod, dashShowSubView } from '../features/dashboard/dashboard-view.js';

/* ── planner ── */
import { _magicSwitchSub, _gp2ConnectCalendar, _gp2GoToday, _gp2StartResize, _gp2AddTodo, _gp2SaveMemo } from '../features/planner/planner-view.js';
import { _gp2ToggleWidgetStore, _gp2OpenDrivePathPicker, _gp2WidgetDragOver, _gp2WidgetDrop, _gp2StartResizeBottom } from '../features/planner/planner-view.js';

/* ── kiosk ── */
import { emsPrint, emsResetCurrent, emsSetPaper, showEmsPopup } from '../features/kiosk/ems-popup-view.js';

/* ── training ── */
import { trSwitchSub } from '../features/training/training-view.js';

/* ── survey ── */
import { svSwitchSub } from '../features/survey/survey-view.js';
import { nlSwitchSub } from '../features/survey/survey-newsletter-editor.js';

/* ── 이름 클릭 → EMS 팝업: 위임 이벤트 리스너 ── */
document.addEventListener('click',function(e){
  const anchor=e.target.closest('[data-ems-popup-id]');
  if(!anchor)return;
  e.stopPropagation();
  const stuId=anchor.getAttribute('data-ems-popup-id');
  if(stuId)showEmsPopup(stuId,e);
});

document.addEventListener('DOMContentLoaded', function(){

  /* ── 유틸: ID 또는 querySelector로 요소 가져오기 ── */
  function $id(id){ return document.getElementById(id); }
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }
  function delegate(parent, selector, ev, fn){
    if(!parent) return;
    parent.addEventListener(ev, function(e){
      const target = e.target.closest ? e.target.closest(selector) : null;
      if(target && parent.contains(target)) fn.call(target, e);
    });
  }

  /* ═══════════════════════════════════════
   *  상용 메시지 팝업 (Quick Message)
   * ═══════════════════════════════════════ */
  on($id('qmOverlay'), 'click', function(e){
    if(e.target === this) closeQuickMsg();
  });
  delegate($id('qmVarChips'), '.qm-var-chip', 'click', function(){
    const v = this.dataset.var;
    if(v) qmInsertVar(v);
  });

  /* ═══════════════════════════════════════
   *  초기 설정 마법사 (Setup Wizard)
   * ═══════════════════════════════════════ */
  delegate($id('setupSchoolLevelRow'), '.sp-level-btn', 'click', async function(){
    const level = this.dataset.level;
    if(!level) return;
    /* 학교급 불일치 경고 — 단, 실제 학생/교직원 데이터가 DB 에 있을 때만 의미가 있다.
     *  공장 초기화 직후처럼 모든 명단이 비어 있으면 경고 자체를 생략. */
    if(S._existingSchoolGroup && level !== S._existingSchoolGroup){
      let hasAnyPeople = false;
      try {
        const _ny=new Date(); const yr = String(_ny.getMonth()>=2?_ny.getFullYear():_ny.getFullYear()-1); /* 명단=학년도(3/1 기점) */
        const [stuRes, stfRes] = await Promise.all([
          (window.electronAPI && window.electronAPI.studentsGetAllHistorical) ? window.electronAPI.studentsGetAllHistorical() : Promise.resolve(null),
          (window.electronAPI && window.electronAPI.staffGetAllHistorical) ? window.electronAPI.staffGetAllHistorical() : ((window.electronAPI && window.electronAPI.staffGetAll) ? window.electronAPI.staffGetAll(yr) : Promise.resolve(null)),
        ]);
        const stuCnt = (stuRes && stuRes.success && Array.isArray(stuRes.data)) ? stuRes.data.length : 0;
        const stfCnt = (stfRes && stfRes.success && Array.isArray(stfRes.data)) ? stfRes.data.length : 0;
        hasAnyPeople = (stuCnt + stfCnt) > 0;
      } catch(_){}
      if(hasAnyPeople){
        const ok = await appConfirmModal('현재 데이터베이스와 학교급이 다릅니다.<br><br>계속하시겠습니까?','학교급 변경 확인', { okLabel:'계속', cancelLabel:'취소' });
        if(!ok) return;
      }
    }
    _setupSelectLevel(level, this);
  });

  /* ═══════════════════════════════════════
   *  헤더 (Header)
   * ═══════════════════════════════════════ */
  on($id('headerWeather'), 'click', function(){
    cycleWeather();
  });
  on($id('headerSettingsBtn'), 'click', function(){
    openSettings();
  });
  on($id('themeBtn'), 'click', function(){
    toggleTheme();
  });
  on($id('headerLockBtn'), 'click', function(){
    showLoginScreen();
  });

  /* ═══════════════════════════════════════
   *  내비게이션 (Navigation)
   * ═══════════════════════════════════════ */
  delegate(document.querySelector('.header-row2'), '.nav-link', 'click', function(e){
    const view = this.dataset.view;
    if(view) switchView(view, this);
  });
  on($id('storyNewBadge'), 'click', function(e){
    e.stopPropagation();
    dismissStoryBadge();
  });

  /* ═══════════════════════════════════════
   *  사이드바
   * ═══════════════════════════════════════ */
  on($id('gp2WidgetStoreBtnEl'), 'click', function(e){
    _gp2ToggleWidgetStore(e);
  });
  on($id('gp2DrivePathBtnEl'), 'click', function(){
    _gp2OpenDrivePathPicker();
  });
  on($id('advSearchSidebarBtn'), 'click', function(){
    /* 현재 활성 탭에 따라 콜백 분기: 응급→ecSelectStudent, 감염→infSelectStudent, 일반→selectStudent */
    let _activeTab='';
    try{const _at=document.querySelector('#view-daily .daily-cat-tab.active');if(_at)_activeTab=_at.textContent.trim();}catch(e){}
    const _isEc=_activeTab.indexOf('응급')!==-1;
    const _isInf=_activeTab.indexOf('감염')!==-1;
    openAdvancedSearch(function(id){
      if(_isEc) ecSelectStudent(id);
      else if(_isInf) infSelectStudent(id);
      else selectStudent(id);
    });
  });
  on($id('sideChartToggle'), 'click', function(){
    toggleSideCharts();
  });

  /* ═══════════════════════════════════════
   *  통계 뷰 (Stats)
   * ═══════════════════════════════════════ */
  on($id('exportDiaryBtn'), 'click', function(){
    exportDiary('pdf');
  });
  on($id('importDataBtn'), 'click', function(){
    importData();
  });

  /* ═══════════════════════════════════════
   *  설정 사이드바 (Settings Sidebar)
   * ═══════════════════════════════════════ */
  delegate($id('settingsSidebar'), '.settings-sidebar-item', 'click', function(){
    const cat = this.dataset.cat;
    if(cat) switchSettingsCat(cat, this);
  });
  delegate($id('settingsSidebar'), '.settings-sidebar-item', 'mouseenter', function(){
    const cat = this.dataset.cat;
    if(cat) hoverSettingsCat(cat, this);
  });

  /* ═══════════════════════════════════════
   *  EMS 메시지 모달
   * ═══════════════════════════════════════ */
  on($id('emsResetCurrentBtn'), 'click', function(){
    emsResetCurrent();
  });
  delegate($id('emsPaperToggle'), '.vp-toggle[data-paper]', 'click', function(){
    emsSetPaper(this.dataset.paper);
  });
  on($id('emsPrintBtn'), 'click', function(){
    emsPrint();
  });
  on($id('emsEmergencyLocBtn'), 'click', function(){
    /* 의료기관 탐색 — 응급실 모드로 열기 */
    const _cu=S._currentUser||{};
    const schoolName=_cu.school_name||S.settings.schoolName||'';
    const eduOffice=_cu.edu_office||S.settings.eduOffice||'';
    const schoolAddr=_cu.school_address||S.settings.schoolAddress||'';
    const hiraKey=getPublicDataApiKey('hira');
    const emgKey=getPublicDataApiKey('emergency');
    const kakaoRest=localStorage.getItem('ec_kakao_rest_api_key')||'';
    const kakaoJs=localStorage.getItem('ec_kakao_js_api_key')||'';
    /* 웹 클라이언트(동료 PC) 는 카드리스트 모드(SDK 미사용) + 서버 blob 폴백으로 동작 → 가드 우회.
     * 데스크탑(호스트) 만 SDK 가 필요해서 두 키 모두 강제. */
    if(!window.__isWebBrowser && (!kakaoRest||!kakaoJs)){
      alert('카카오 개발자 API 키가 등록되지 않았습니다.\n설정 → API Key 관리 → 카카오 개발자 API 에서 REST API 키와 JavaScript 키를 먼저 등록해 주세요.');
      return;
    }
    if(window.electronAPI&&window.electronAPI.openMedFacility){
      const schoolLat=localStorage.getItem('ec_school_lat')||'';
      const schoolLng=localStorage.getItem('ec_school_lng')||'';
      window.electronAPI.openMedFacility(schoolName,eduOffice,hiraKey,emgKey,schoolAddr,'emergency',kakaoRest,kakaoJs,schoolLat,schoolLng);
    }
  });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 좌측 패널
   * ═══════════════════════════════════════ */
  /* format bar: data-fmt 버튼 (default + 커스텀) */
  delegate($id('vpFormatBar'), '.vp-fmt-btn[data-fmt]', 'click', function(e){
    if(e.target.classList.contains('vp-del-icon') || e.target.classList.contains('vp-edit-icon')) return;
    vpSelectFormat(this.dataset.fmt, this);
  });
  on($id('vpAddCustomSlotBtn'), 'click', function(){
    vpAddCustomSlot();
  });

  /* 커스텀 양식 출력 — 아코디언 trigger 클릭으로 열고 닫기 (호버 자동 열림 제거됨) */
  document.addEventListener('click', function(e){
    const trig=e.target.closest('.vp-sel-trigger');
    if(!trig)return;
    /* trigger 안쪽의 버튼/드롭다운 요소 클릭은 토글 무시 */
    if(e.target.closest('.vp-toggle')||e.target.closest('.vp-sig-opt')||e.target.closest('.vp-dropdown'))return;
    const bar=trig.closest('.vp-sel-bar');
    if(!bar)return;
    /* 다른 아코디언은 닫고 토글 (한 번에 하나만 열림) */
    const wasOpen=bar.classList.contains('open');
    document.querySelectorAll('.vp-sel-bar.open').forEach(function(b){if(b!==bar)b.classList.remove('open');});
    if(wasOpen)bar.classList.remove('open');
    else bar.classList.add('open');
  });
  /* paper 선택 */
  delegate($id('vpPaperBar'), '.vp-toggle[data-paper]', 'click', function(){
    vpSetPaper(this.dataset.paper, this);
  });
  /* 방향 선택 */
  delegate(document.querySelector('.vp-orientation-group'), '.vp-toggle[data-orient]', 'click', function(){
    vpSetOrientation(this.dataset.orient, this);
  });
  /* 내용 토글 */
  delegate($id('vpContentBar'), '.vp-toggle[data-field]', 'click', function(){
    const field = this.dataset.field;
    if(field === 'all'){
      vpToggleAll(this);
    } else {
      vpToggleContent(field, this);
    }
  });
  /* 서명/도장 */
  delegate($id('vpSigBar'), '.vp-sig-opt[data-sig]', 'click', function(){
    vpSetSigMode(this.dataset.sig, this);
  });

  /* 서명 드롭존 */
  on($id('vpSigDrop'), 'click', function(){
    const inp = $id('vpSigFileInput');
    if(inp) inp.click();
  });
  on($id('vpSigDelBtn'), 'click', function(){
    vpDeleteSig();
  });
  on($id('vpSigRemoveBgBtn'), 'click', function(){
    vpSigRemoveBg();
  });

  /* 배경 업로드 */
  on($id('vpeBgUploadZone'), 'click', function(){
    const inp = $id('vpeBgInput');
    if(inp) inp.click();
  });
  on($id('vpeStretchBgBtn'), 'click', function(){
    vpeStretchBg();
  });
  on($id('vpResetCustomFmtBtn'), 'click', function(){
    vpResetCustomFormat();
  });

  /* 기본 미리보기 줌 */
  on($id('vpDefZoomLabel'), 'click', function(){
    _zoomLabelClick(this, function(v){ vpDefZoomSet(v); });
  });
  on($id('vpDefZoomFitBtn'), 'click', function(){
    vpDefZoomFit();
  });

  /* ═══════════════════════════════════════
   *  캔버스 에디터 (VPE) 툴바
   * ═══════════════════════════════════════ */
  on($id('vpeBold'), 'click', function(){
    vpeToggleStyle('fontWeight','bold','normal');
  });
  on($id('vpeItalic'), 'click', function(){
    vpeToggleStyle('fontStyle','italic','normal');
  });
  on($id('vpeUnderline'), 'click', function(){
    vpeToggleStyle('textDecoration','underline','none');
  });
  on($id('vpeAlignL'), 'click', function(){
    vpeUpdateStyle('textAlign','left');
  });
  on($id('vpeAlignC'), 'click', function(){
    vpeUpdateStyle('textAlign','center');
  });
  on($id('vpeAlignR'), 'click', function(){
    vpeUpdateStyle('textAlign','right');
  });
  on($id('vpeColorBtn'), 'click', function(){
    vpeTogglePalette('color', this);
  });
  on($id('vpeBgColorBtn'), 'click', function(){
    vpeTogglePalette('bgColor', this);
  });
  on($id('vpeTblBorderToggleBtn'), 'click', function(){
    vpeTblBorderToggle();
  });
  on($id('vpeTblBorderColorBtn'), 'click', function(){
    vpeTogglePalette('tblBorder', this);
  });
  on($id('vpeBorderColorBtn'), 'click', function(){
    vpeTogglePalette('borderColor', this);
  });
  on($id('vpeCellBgBtn'), 'click', function(){
    vpeTogglePalette('cellBg', this);
  });
  on($id('vpeCellBgClearBtn'), 'click', function(e){
    e.stopPropagation();
    vpeCellBgApply('transparent');
  });
  on($id('vpeCellBgOpacity'), 'click', function(e){
    e.stopPropagation();
  });

  /* VPE 오브젝트 추가 */
  delegate(document.querySelector('.vpe-add-bar, [data-vpe-add]') && document.body, '[data-vpe-add]', 'click', function(){
    vpeAddObject(this.dataset.vpeAdd);
  });
  on($id('vpeAddTableBtn'), 'click', function(){
    vpeAddTable();
  });
  on($id('vpeAddImageBtn'), 'click', function(){
    vpeAddImage();
  });
  on($id('vpeRemoveImageBgBtn'), 'click', function(){
    vpeRemoveImageBg();
  });
  on($id('vpeCropImageBtn'), 'click', function(){
    vpeCropImage();
  });
  on($id('vpeEmojiMenuToggleBtn'), 'click', function(){
    vpeEmojiMenuToggle();
  });
  on($id('vpeDynMenuToggleBtn'), 'click', function(){
    vpeDynMenuToggle();
  });

  /* VPE 동적 필드 삽입 */
  delegate(document.body, '[data-dyn-field]', 'click', function(){
    vpeInsertDynField(this.dataset.dynField);
  });

  /* VPE 표 작업 */
  on($id('vpeTableAddRowBelowBtn'), 'click', function(){ vpeTableAddRow('below'); });
  on($id('vpeTableAddRowAboveBtn'), 'click', function(){ vpeTableAddRow('above'); });
  on($id('vpeTableAddColRightBtn'), 'click', function(){ vpeTableAddCol('right'); });
  on($id('vpeTableAddColLeftBtn'), 'click', function(){ vpeTableAddCol('left'); });
  on($id('vpeTableDelRowBtn'), 'click', function(){ vpeTableDelRow(); });
  on($id('vpeTableDelColBtn'), 'click', function(){ vpeTableDelCol(); });
  on($id('vpeMergeCellsBtn'), 'click', function(){ vpeMergeCells(); });
  on($id('vpeUnmergeCellsBtn'), 'click', function(){ vpeUnmergeCells(); });

  /* VPE 복사/삭제/초기화 */
  on($id('vpeCopyObjBtn'), 'click', function(){ vpeCopyObj(); });
  on($id('vpeDeleteObjBtn'), 'click', function(){ vpeDeleteObj(); });
  on($id('vpeResetEditorBtn'), 'click', function(){ vpeResetEditor(); });

  /* VPE Z-order */
  delegate(document.body, '[data-vpe-z]', 'click', function(){
    const z = parseInt(this.dataset.vpeZ, 10);
    vpeZOrder(z);
  });
  on($id('vpeZOrderMaxBtn'), 'click', function(){ vpeZOrderMax(); });
  on($id('vpeZOrderMinBtn'), 'click', function(){ vpeZOrderMin(); });

  /* VPE 정렬 */
  delegate(document.body, '[data-vpe-align]', 'click', function(){
    vpeAlign(this.dataset.vpeAlign);
  });

  /* VPE 줌 */
  on($id('vpeZoomLabel'), 'click', function(){
    _zoomLabelClick(this, function(v){ vpeZoomSet(v); });
  });
  on($id('vpeZoomFitBtn'), 'click', function(){ vpeZoomFit(); });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 내보내기/인쇄 버튼
   * ═══════════════════════════════════════ */
  on($id('vpExportPdfBtn'), 'click', function(){ vpExportFile('pdf'); });
  on($id('vpDownloadPngBtn'), 'click', function(){ vpDirectDownload('png'); });
  on($id('vpPrintBtn'), 'click', function(){ vpOpenPrintDialog(); });

  /* ═══════════════════════════════════════
   *  감염병 폼 닫기
   * ═══════════════════════════════════════ */
  on($id('closeInfFormBtn'), 'click', function(){ closeInfForm(); });

  /* ═══════════════════════════════════════
   *  팝업 중앙 정렬: 윈도우 리사이즈 시 드래그된 모달 재중앙정렬
   * ═══════════════════════════════════════ */
  window.addEventListener('resize', function(){
    document.querySelectorAll('.modal-overlay.show .modal-content').forEach(function(mc){
      if(mc.style.position==='fixed'&&mc.style.left){
        /* 드래그로 이동된 모달 → 화면 내 유지 */
        const rect=mc.getBoundingClientRect();
        const w=window.innerWidth, h2=window.innerHeight;
        if(rect.right>w) mc.style.left=Math.max(0,w-rect.width-8)+'px';
        if(rect.bottom>h2) mc.style.top=Math.max(0,h2-rect.height-8)+'px';
        if(rect.left<0) mc.style.left='8px';
        if(rect.top<0) mc.style.top='8px';
      }
    });
  });

  /* ══ 전역 Esc — 열린 모달·오버레이 중 최상위 하나만 닫기 ══
   * 우선순위: 커스텀 .modal-overlay.show > sv-modal-overlay > 일반 오버레이
   * 입력창 포커스 중이어도 Esc는 모달 닫기를 우선 (단, contenteditable에 내용 있으면 블러만) */
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    /* 모든 가시 모달 수집 (z-index 내림차순) */
    let modals = Array.prototype.slice.call(document.querySelectorAll(
      '.modal-overlay.show, .sv-modal-overlay, [id$="Overlay"]:not([style*="display: none"]):not([style*="display:none"])'
    ));
    /* display:none 필터 */
    modals = modals.filter(function(m){
      if(!m||!m.isConnected)return false;
      const st = getComputedStyle(m);
      return st.display !== 'none' && st.visibility !== 'hidden';
    });
    if(!modals.length) return;
    /* z-index가 가장 높은 것을 선택 */
    const top = modals.reduce(function(a,b){
      const zA = parseInt(getComputedStyle(a).zIndex)||0;
      const zB = parseInt(getComputedStyle(b).zIndex)||0;
      return zB > zA ? b : a;
    });
    if(!top) return;
    /* 입력 중이면 블러만, 모달은 그대로 */
    const ae = document.activeElement;
    if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.contentEditable==='true')){
      if(top.contains(ae)){
        ae.blur();
        return;
      }
    }
    e.preventDefault();
    /* 모달별 닫기 방법 — show 클래스 제거 또는 remove */
    if(top.classList.contains('show') && top.classList.contains('modal-overlay')){
      top.classList.remove('show');
    } else {
      top.remove();
    }
  }, false);

  /* ═══════════════════════════════════════
   *  사이드바 — 검색 입력 oninput
   * ═══════════════════════════════════════ */
  on($id('sideSearch'), 'input', function(){
    sidebarSearch();
  });

  /* ═══════════════════════════════════════
   *  사이드바 hover 효과 (sidebar-hover-btn, adv-search-hover-btn, vp-custom-slot-hover-btn)
   * ═══════════════════════════════════════ */
  document.querySelectorAll('.sidebar-hover-btn').forEach(function(el){
    el.addEventListener('mouseenter', function(){ this.style.borderColor='var(--cyan)'; });
    el.addEventListener('mouseleave', function(){ this.style.borderColor='var(--bdr)'; });
  });
  const _advSearchBtn = $id('advSearchSidebarBtn');
  if(_advSearchBtn){
    _advSearchBtn.addEventListener('mouseenter', function(){ this.style.background='rgba(236,72,153,0.12)'; });
    _advSearchBtn.addEventListener('mouseleave', function(){ this.style.background='rgba(236,72,153,0.06)'; });
  }
  const _vpCustomSlotBtn = $id('vpAddCustomSlotBtn');
  if(_vpCustomSlotBtn){
    _vpCustomSlotBtn.addEventListener('mouseenter', function(){ this.style.borderColor='var(--cyan)'; this.style.color='var(--cyan)'; });
    _vpCustomSlotBtn.addEventListener('mouseleave', function(){ this.style.borderColor='var(--bdr)'; this.style.color='var(--t3)'; });
  }

  /* ═══════════════════════════════════════
   *  통계 뷰 — 기간 탭 (view-stats, onmouseenter)
   * ═══════════════════════════════════════ */
  delegate(document.querySelector('#view-stats .stats-period-tabs'), '.stats-period-tab[data-period]', 'mouseenter', function(){
    const period = this.dataset.period;
    if(period) setStatsPeriod(period, this);
  });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 서명 드롭존 drag & drop
   * ═══════════════════════════════════════ */
  const _sigDrop = $id('vpSigDrop');
  on(_sigDrop, 'dragover', function(e){ e.preventDefault(); this.classList.add('dragover'); });
  on(_sigDrop, 'dragleave', function(){ this.classList.remove('dragover'); });
  on(_sigDrop, 'drop', function(e){ vpHandleSigDrop(e); });
  on($id('vpSigFileInput'), 'change', function(){ vpHandleSigFile(this); });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 배경 업로드 drag & drop
   * ═══════════════════════════════════════ */
  const _bgUpload = $id('vpeBgUploadZone');
  on(_bgUpload, 'dragover', function(e){ e.preventDefault(); this.style.borderColor='var(--cyan)'; });
  on(_bgUpload, 'dragleave', function(){ this.style.borderColor='var(--bdr)'; });
  on(_bgUpload, 'drop', function(e){ e.preventDefault(); this.style.borderColor='var(--bdr)'; vpeBgHandleDrop(e); });
  on($id('vpeBgInput'), 'change', function(){ vpeBgLoadFile(this); });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 배경 슬라이더 (oninput)
   * ═══════════════════════════════════════ */
  on($id('vpeBgScaleSlider'), 'input', function(){ vpeSetBgScale(parseInt(this.value)); });
  on($id('vpeBgOffsetYSlider'), 'input', function(){ vpeSetBgOffsetY(parseInt(this.value)); });
  on($id('vpeBgOffsetXSlider'), 'input', function(){ vpeSetBgOffsetX(parseInt(this.value)); });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 여백 입력 (onchange + onwheel)
   * ═══════════════════════════════════════ */
  document.querySelectorAll('.vpe-margin-input').forEach(function(el){
    const side = el.dataset.marginSide;
    el.addEventListener('change', function(){
      vpeSetMarginSide(side, parseInt(this.value));
    });
    el.addEventListener('wheel', function(e){
      e.preventDefault();
      const v = Math.max(0, Math.min(30, parseInt(this.value||0) + (e.deltaY>0 ? -1 : 1)));
      this.value = v;
      vpeSetMarginSide(side, v);
    });
  });

  /* ═══════════════════════════════════════
   *  방문 확인증 — 기본 미리보기 스크롤/줌
   * ═══════════════════════════════════════ */
  on($id('vpDefScrollArea'), 'scroll', function(){ vpDefDrawRulers(); });
  on($id('vpDefZoomSlider'), 'input', function(){ vpDefZoomSet(parseInt(this.value)); });

  /* ═══════════════════════════════════════
   *  방문 확인증 — VPE 스타일 (onchange)
   * ═══════════════════════════════════════ */
  on($id('vpeFontFamily'), 'change', function(){ vpeUpdateStyle('fontFamily', this.value); });
  on($id('vpeBorderWidth'), 'change', function(){ vpeUpdateStyle('borderWidth', parseInt(this.value)); });

  /* ═══════════════════════════════════════
   *  방문 확인증 — VPE 줌 슬라이더 (oninput + onwheel)
   * ═══════════════════════════════════════ */
  const _vpeZoomSlider = $id('vpeZoomSlider');
  on(_vpeZoomSlider, 'input', function(){ vpeZoomSet(parseInt(this.value)); });
  on(_vpeZoomSlider, 'wheel', function(e){ _vpeZoomSliderWheel(e); });

}); /* end DOMContentLoaded */

/* ═══════════════════════════════════════
 *  view-daily.html — 프래그먼트 마운트 후 바인딩
 *  (app-bootstrap.js 에서 호출)
 * ═══════════════════════════════════════ */

export function bindViewDailyEvents(){
  function $id(id){ return document.getElementById(id); }
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }

  /* ── 헤더 툴팁 (data-tooltip) 공통 헬퍼 ── */
  function _tipOn(e){
    const tip = this.getAttribute('data-tooltip');
    if(tip) showHeaderTooltip(e, tip);
  }
  function _tipOff(){
    hideHeaderTooltip();
  }
  function bindTip(el){
    if(!el || !el.getAttribute('data-tooltip')) return;
    el.addEventListener('mouseenter', _tipOn);
    el.addEventListener('mouseleave', _tipOff);
  }

  /* ── 핑크 버튼 hover 효과 공통 헬퍼 ── */
  function _pinkOn(){
    this.style.background='rgba(236,72,153,0.18)';
    this.style.borderColor='#a8456e';
  }
  function _pinkOff(){
    this.style.background='rgba(236,72,153,0.06)';
    this.style.borderColor='rgba(236,72,153,0.15)';
  }
  function bindPinkHover(el){
    if(!el) return;
    el.addEventListener('mouseenter', _pinkOn);
    el.addEventListener('mouseleave', _pinkOff);
  }

  /* ── 탭 전환 (일반/응급/감염) — delegation on #view-daily ── */
  const _tabWrap = $id('view-daily');
  if(_tabWrap){
    _tabWrap.addEventListener('click', function(e){
      const tab = e.target.closest('.magic-index-tab[data-cat]');
      if(tab) switchDailyCat(tab.dataset.cat, tab);
    });
  }

  /* ── 일반 일지 검색 ── */
  const dailySearch = $id('dailySearchInput');
  /* 실시간 자동완성 — IME 가드는 넣지 않는다. 한글은 마지막 글자가 계속 "조합 중"이라
   *  조합을 스킵하면 리스트가 한 글자 뒤처져 오히려 이상해짐. 방문수 사전계산 맵으로 실행이
   *  이미 가벼워졌으므로 조합 중 매 input 실행해도 충분히 빠르다. (2026-07-01 되돌림) */
  on(dailySearch, 'input', function(){ dailyAutoComplete(); });
  on(dailySearch, 'focus', function(){ dailyAutoComplete(); });
  on(dailySearch, 'click', function(){ dailyAutoComplete(); });
  on(dailySearch, 'keydown', function(e){ dailySearchKeydown(e); });

  /* ── 일반 일지 상세 검색 ── */
  const dailyAdvSearch = $id('dailyAdvSearchBtn');
  on(dailyAdvSearch, 'click', function(){
    openAdvancedSearch(function(id){ selectStudent(id); });
  });
  bindTip(dailyAdvSearch);
  bindPinkHover(dailyAdvSearch);

  /* ── 인원 데이터 관리 ── */
  const dailyAddPerson = $id('dailyAddPersonBtn');
  on(dailyAddPerson, 'click', function(){ toggleAddPerson(); });
  bindTip(dailyAddPerson);
  bindPinkHover(dailyAddPerson);

  /* (개인정보 보호 토글은 설정 → 보건일지 설정으로 이전됨) */

  /* ── 의료기관 탐색 ── */
  const medFacBtn = $id('medFacilityBtn');
  on(medFacBtn, 'click', function(){ openMedFacilityPopup(); });
  bindTip(medFacBtn);

  /* ── 약품 검색 ── */
  const drugSearchBtn = $id('drugSearchBtn');
  on(drugSearchBtn, 'click', function(){
    import('../features/symptom/symptom-view.js').then(function(m){
      if(m.openDrugSearchPopup)m.openDrugSearchPopup();
    });
  });
  bindTip(drugSearchBtn);

  /* (Private 버튼은 설정 → 보건일지 설정으로 이전됨) */

  /* ── 이전/다음 날 ── */
  on($id('btnPrevDay'), 'click', function(){ goToPrevDay(); });
  const nextDayBtn = $id('btnNextDay');
  on(nextDayBtn, 'click', function(){ goToNextDay(); });
  on(nextDayBtn, 'mouseenter', function(){ this.style.background='rgba(34,197,94,0.2)'; });
  on(nextDayBtn, 'mouseleave', function(){ this.style.background='rgba(34,197,94,0.12)'; });

  /* ── 일반 일지 툴바 버튼 ── */
  const _toolbarMap = [
    ['dailyQuickMsgBtn',    function(){ openQuickMsg(); }],
    ['dailyColSelectorBtn', function(){ toggleColSelector(); }],
    ['dailyRentalLedgerBtn',function(){ openRentalLedger(); }],
    ['dailyVisitPassBtn',   function(){ hideHeaderTooltip(); openVisitPass(); }],
    ['dailyDiaryPrintBtn',  function(){ openDiaryPrint(); }],
    ['dailySortAscBtn',     function(){ dailySortByTime('asc'); }],
    ['dailySortDescBtn',    function(){ dailySortByTime('desc'); }],
  ];
  _toolbarMap.forEach(function(pair){
    const el = $id(pair[0]);
    on(el, 'click', pair[1]);
    bindTip(el);
  });

  /* ── 테이블 헤더 정렬 (delegation on recTable) ── */
  const recTable = $id('recTable');
  if(recTable){
    recTable.addEventListener('click', function(e){
      const th = e.target.closest('th[data-sort]');
      if(th) dailySortByCol(th.dataset.sort);
    });
  }

  /* ── 증상 헤더 툴팁 ── */
  const symptomTip = recTable && recTable.querySelector('.header-tooltip-wrap[data-tooltip]');
  bindTip(symptomTip);

  /* ── tbody mouseleave (방문이력 숨기기) ──
   * 증상 선택 및 처치 팝업(symCatOverlay) 이 열려 있는 동안에는 mouseleave 로 카드가 사라지지 않게 차단.
   * 클릭으로 팝업 열 때 fullscreen overlay 가 깔리면서 cursor 가 tbody 밖으로 빠진 것처럼 인식돼
   * _hideVisitHistory 가 발동 → 페이드 아웃 → 350ms race fallback 으로 다시 켜지는 깜빡임이 났음. */
  function _tbodyMouseLeave(){
    if(document.getElementById('symCatOverlay')) return;
    if(!S._visitHistoryLocked) _hideVisitHistory();
  }
  on($id('recBody'), 'mouseleave', _tbodyMouseLeave);
  on($id('ecListBody'), 'mouseleave', _tbodyMouseLeave);
  on($id('infListBody'), 'mouseleave', _tbodyMouseLeave);

  /* ═══ 응급처치 (EC) ═══ */
  const ecSearch = $id('ecSearchInput');
  on(ecSearch, 'input', function(){ ecAutoComplete(); });
  on(ecSearch, 'keydown', function(e){ ecSearchKeydown(e); });

  const ecAdvSearch = $id('ecAdvSearchBtn');
  on(ecAdvSearch, 'click', function(){
    openAdvancedSearch(function(id){ ecSelectStudent(id); });
  });
  bindTip(ecAdvSearch);
  bindPinkHover(ecAdvSearch);

  const _ecToolbarMap = [
    ['ecPrintListBtn',  function(){ ecPrintList(); }],
    ['ecPrintTableBtn', function(){ ecPrintTable(); }],
    ['ecColSelectorBtn',function(){ toggleEcColSelector(); }],
    ['ecSortAscBtn',    function(){ ecSortByTime('asc'); }],
    ['ecSortDescBtn',   function(){ ecSortByTime('desc'); }],
  ];
  _ecToolbarMap.forEach(function(pair){
    const el = $id(pair[0]);
    on(el, 'click', pair[1]);
    bindTip(el);
  });

  /* ═══ 감염병 (INF) ═══ */
  const infSearch = $id('infSearchInput');
  on(infSearch, 'input', function(){ infAutoComplete(); });
  on(infSearch, 'keydown', function(e){ infSearchKeydown(e); });

  const infAdvSearch = $id('infAdvSearchBtn');
  on(infAdvSearch, 'click', function(){
    openAdvancedSearch(function(id){ infSelectStudent(id); });
  });
  bindTip(infAdvSearch);
  bindPinkHover(infAdvSearch);

  const _infToolbarMap = [
    ['infPrintListBtn',  function(){ infPrintList(); }],
    ['infPrintTableBtn', function(){ infPrintTable(); }],
    ['infColSelectorBtn',function(){ toggleInfColSelector(); }],
    ['infSortAscBtn',    function(){ infSortByTime('asc'); }],
    ['infSortDescBtn',   function(){ infSortByTime('desc'); }],
  ];
  _infToolbarMap.forEach(function(pair){
    const el = $id(pair[0]);
    on(el, 'click', pair[1]);
    bindTip(el);
  });

  /* ── 이름 hover → 방문 이력 표시 (프래그먼트 마운트 후 바인딩) ── */
  _bindNameHoverVisitHistory();
}

/* ═══════════════════════════════════════
 *  view-dashboard.html — 프래그먼트 마운트 후 바인딩
 * ═══════════════════════════════════════ */
export function bindViewDashboardEvents(){
  function $id(id){ return document.getElementById(id); }
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }

  /* 기간 탭 — delegation (data-period). 우측 방문 순위/상담실적 탭(data-dash-view)은 별도 분기 (2026-06-12) */
  const dashTabs = $id('dashPeriodTabs');
  if(dashTabs){
    dashTabs.addEventListener('click', function(e){
      const vtab = e.target.closest('.stats-period-tab[data-dash-view]');
      if(vtab){ dashShowSubView(vtab.dataset.dashView); return; }
      const tab = e.target.closest('.stats-period-tab[data-period]');
      if(tab){ dashShowSubView('stats'); setStatsPeriod(tab.dataset.period, tab); }
    });
  }

  /* PDF 저장, 이전/다음 기간 */
  on($id('dashPdfBtn'), 'click', function(){ _dashExportFullPDF(); });
  /* PDF 버튼 미니 팝업(data-tooltip) — 프로그램 공용 GUI 툴팁 바인딩 (사용자 요청 2026-06-11) */
  (function(){ const b=$id('dashPdfBtn'); if(b&&b.getAttribute('data-tooltip')){
    b.addEventListener('mouseenter', function(e){ showHeaderTooltip(e, this.getAttribute('data-tooltip')); });
    b.addEventListener('mouseleave', function(){ hideHeaderTooltip(); });
  } })();
  on($id('dashNavPrev'), 'click', function(){ _dashPrevPeriod(); });
  on($id('dashNavNext'), 'click', function(){ _dashNextPeriod(); });
}

/* ═══════════════════════════════════════
 *  view-magic.html — 프래그먼트 마운트 후 바인딩
 * ═══════════════════════════════════════ */
export function bindViewMagicEvents(){
  function $id(id){ return document.getElementById(id); }
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }

  /* 매직 스테이션 탭 — delegation (data-magic-sub) */
  const magicView = $id('view-magic');
  if(magicView){
    magicView.addEventListener('click', function(e){
      const tab = e.target.closest('[data-magic-sub]');
      if(tab) _magicSwitchSub(tab.dataset.magicSub, tab);
    });
  }

  /* 플래너 — 캘린더 연결/오늘 */
  on($id('gp2ConnectCalendarBtn'), 'click', function(){ _gp2ConnectCalendar(); });
  on($id('gp2GoTodayBtn'), 'click', function(){ _gp2GoToday(); });

  /* 리사이즈 바 (상단) */
  const resizeBar = $id('gp2ResizeBar');
  on(resizeBar, 'mousedown', function(e){ _gp2StartResize(e); });
  on(resizeBar, 'mouseenter', function(){ this.style.background='rgba(6,182,212,0.12)'; });
  on(resizeBar, 'mouseleave', function(){ this.style.background=''; });

  /* 위젯 영역 — drag & drop */
  const bottomArea = $id('gp2BottomArea');
  on(bottomArea, 'dragover', function(e){ _gp2WidgetDragOver(e); });
  on(bottomArea, 'drop', function(e){ _gp2WidgetDrop(e); });
  on(bottomArea, 'dragleave', function(){ this.style.borderColor='transparent'; });

  /* 리사이즈 바 (하단) */
  const resizeBarBottom = $id('gp2ResizeBarBottom');
  on(resizeBarBottom, 'mousedown', function(e){ _gp2StartResizeBottom(e); });
  on(resizeBarBottom, 'mouseenter', function(){ this.style.background='rgba(6,182,212,0.12)'; });
  on(resizeBarBottom, 'mouseleave', function(){ this.style.background=''; });

  /* 할 일 추가 */
  on($id('gp2AddTodoBtn'), 'click', function(){ _gp2AddTodo(); });

  /* 메모 입력 */
  on($id('gp2Memo'), 'input', function(){ _gp2SaveMemo(); });

  /* 연수 탭 — delegation (data-tr-sub) */
  const trainingWrap = $id('dailyCat-training');
  if(trainingWrap){
    trainingWrap.addEventListener('click', function(e){
      const tab = e.target.closest('[data-tr-sub]');
      if(tab) trSwitchSub(tab.dataset.trSub);
    });
  }
}

/* ═══════════════════════════════════════
 *  view-story.html — 프래그먼트 마운트 후 바인딩
 * ═══════════════════════════════════════ */
export function bindViewStoryEvents(){
  const storyView = document.getElementById('view-story');
  if(storyView){
    storyView.addEventListener('click', function(e){
      const tab = e.target.closest('[data-story-tab]');
      if(tab) switchStorySub(tab.dataset.storyTab);
    });
    /* "소개" 콘텐츠는 설정 → 버전·업데이트 의 "개발 이야기" 아코디언으로 이동.
       view-story 진입 시 기본 활성 탭은 "튜토리얼 영상" — 클릭 핸들러도 해당 영역만 처리. */
  }
}

/* ═══════════════════════════════════════
 *  view-orange.html — 오렌지팜 탭 (오렌지몰 / 튜토리얼 / Q&A / 다운로드)
 *  view-story.html 와 동일한 결의 인덱스 탭 + 본문 카드 패턴
 * ═══════════════════════════════════════ */
export function bindViewOrangeEvents(){
  const orangeView = document.getElementById('view-orange');
  if(orangeView){
    orangeView.addEventListener('click', function(e){
      const tab = e.target.closest('[data-orange-tab]');
      if(tab) switchOrangeSub(tab.dataset.orangeTab);
      /* 4 종 배너 패널 내부 버튼 — 클릭 시 외부 사이트 이동 */
      if(e.target.closest('#orangeMallBtn')){
        if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal('https://school114.org/member/login.asp?refer_url=/product/product_list.asp');
      } else if(e.target.closest('#orangeTogetherBtn')){
        if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal('https://school114.org/service/service_list.asp?stype=B05');
      } else if(e.target.closest('#orangeQnaBtn')){
        if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal('https://school114.org/service/qna_list.asp');
      } else if(e.target.closest('#orangeDownloadBtn')){
        if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal('https://school114.org/service/download.asp');
      }
      /* 튜토리얼 영상 카드 클릭 → YouTube 임베드 모달 */
      const vCard=e.target.closest('.video-slot[data-video-id]');
      if(vCard){
        _openYouTubeModal(vCard.dataset.videoId, vCard.dataset.videoTitle||'튜토리얼 영상');
      }
    });
  }
}

/* YouTube 영상 임베드 모달 — autoplay + 닫기(ESC / 배경 / X) */
function _openYouTubeModal(videoId, title){
  if(document.getElementById('ytModalOverlay')) return;
  const ov=document.createElement('div');
  ov.id='ytModalOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .2s ease';
  ov.innerHTML='<div style="width:min(960px,92vw);max-height:92vh;display:flex;flex-direction:column;gap:10px">'
    +'<div style="display:flex;align-items:center;gap:10px;color:#fff">'
      +'<span style="font-size:14px;font-weight:700;flex:1">▶ '+(title||'').replace(/[<>&]/g,'')+'</span>'
      +'<button id="ytModalClose" style="background:rgba(255,255,255,0.12);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px">✕</button>'
    +'</div>'
    +'<div style="aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.5)">'
      +'<iframe src="https://www.youtube.com/embed/'+encodeURIComponent(videoId)+'?autoplay=1&rel=0" style="width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>'
    +'</div></div>';
  document.body.appendChild(ov);
  const close=function(){ try{ov.remove();}catch(_){} document.removeEventListener('keydown',_esc); };
  const _esc=function(e){ if(e.key==='Escape') close(); };
  document.addEventListener('keydown',_esc);
  ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
  const btn=document.getElementById('ytModalClose');
  if(btn) btn.addEventListener('click',close);
}

/* ═══════════════════════════════════════
 *  magic-sub-survey.html — 프래그먼트 마운트 후 바인딩
 * ═══════════════════════════════════════ */
export function bindMagicSubSurveyEvents(){
  const surveyWrap = document.getElementById('dailyCat-survey');
  if(surveyWrap){
    surveyWrap.addEventListener('click', function(e){
      const tab = e.target.closest('[data-sv-sub]');
      if(tab) svSwitchSub(tab.dataset.svSub);
    });
  }
}

/* ═══════════════════════════════════════
 *  magic-sub-newsletter.html — 프래그먼트 마운트 후 바인딩
 * ═══════════════════════════════════════ */
export function bindMagicSubNewsletterEvents(){
  const nlWrap = document.getElementById('magicSubNewsletter');
  if(nlWrap){
    nlWrap.addEventListener('click', function(e){
      const tab = e.target.closest('[data-nl-sub]');
      if(tab) nlSwitchSub(tab.dataset.nlSub);
    });
  }
}

/* ═══════════════════════════════════════
 *  전역 네이티브 title 미니팝업 → 프로그램 GUI 툴팁 변환 (사용자 요청 2026-06-17)
 *  어느 요소든 title 속성이 있으면 OS 노란 툴팁 대신 #headerTooltipPopup(showHeaderTooltip)로 일관 표시.
 *  · 기능별 자체 툴팁(data-tip/data-tooltip/data-htip/data-tooltip-key)을 쓰는 요소는 양보(그쪽이 처리).
 *  · 호버 시 title 을 data-_ntip 으로 옮겨 네이티브 툴팁을 억제, 떠날 때 복원 → 동적 렌더 요소도 위임으로 자동 적용.
 * ═══════════════════════════════════════ */
(function _initGlobalTitleTooltip(){
  if(typeof document==='undefined') return;
  let _cur=null;
  function _ownTip(el){ return el.closest('[data-tip],[data-tooltip],[data-tooltip-instant],[data-htip],[data-tooltip-key]'); }
  function _restore(el){ if(el&&el.getAttribute){ const v=el.getAttribute('data-_ntip'); if(v!=null){ el.setAttribute('title', v); el.removeAttribute('data-_ntip'); } } }
  function _hide(){ if(_cur){ _restore(_cur); try{ hideHeaderTooltip(); }catch(_){} _cur=null; } }
  document.addEventListener('mouseover', function(e){
    const t = (e.target && e.target.closest) ? e.target.closest('[title],[data-_ntip]') : null;
    if(t===_cur) return;            /* 같은 요소 내부 이동 — 무시 */
    if(_cur) _hide();               /* 이전 요소에서 벗어남 */
    if(!t) return;
    if(_ownTip(t)) return;          /* 기능 자체 GUI 툴팁 요소면 양보 */
    const txt = String(t.getAttribute('title') || t.getAttribute('data-_ntip') || '').trim();
    if(!txt) return;
    _cur = t;
    if(t.hasAttribute('title')){ t.setAttribute('data-_ntip', txt); t.removeAttribute('title'); }   /* 네이티브 억제 */
    try{ showHeaderTooltip(e, txt, false, true); }catch(_){}   /* instant=true — 호버 즉시 표시 */
  }, true);
  document.addEventListener('mouseout', function(e){
    /* 페이지 밖(relatedTarget=null)으로 나갈 때만 정리 — 내부 이동은 위 mouseover 가 처리 */
    if(!e.relatedTarget && _cur) _hide();
  }, true);
  window.addEventListener('scroll', _hide, true);
  window.addEventListener('mousedown', _hide, true);
})();
