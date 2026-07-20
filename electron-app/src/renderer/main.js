/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * main.js — ES Module 진입점
 *
 * 모든 렌더러 모듈을 import합니다.
 * 실행 순서는 ES Module 의존성 그래프에 따라 자동 결정됩니다.
 *
 * CDN 라이브러리(xlsx, pdf.js 등)는 HTML에서 non-module <script>로 먼저 로드됩니다.
 */

/* ═══ Platform 감지 — Windows 가독성 보정 (DirectWrite 렌더링 대응) ═══ */
(function(){
  var ua = (navigator.userAgent || '').toLowerCase();
  var platform = (navigator.platform || '').toLowerCase();
  if (ua.indexOf('win') !== -1 || platform.indexOf('win') !== -1) {
    document.documentElement.classList.add('is-windows');
    document.body && document.body.classList.add('is-windows');
    document.addEventListener('DOMContentLoaded', function(){
      document.body.classList.add('is-windows');
    });
  } else if (platform.indexOf('mac') !== -1) {
    document.documentElement.classList.add('is-mac');
  }
})();

/* ═══ Core ═══ */
import './core/app-data-bridge.js';
import './core/persistence-orchestrator.js';
import './core/app-state.js';
import './core/helpers.js';
import './core/command-palette.js';

/* ═══ Features — Stores / Managers ═══ */
import './features/settings/drive-sync-manager.js';
import './features/settings/settings-bg-theme.js';
import './features/settings/settings-menu-dnd.js';

/* ═══ Features — Settings Tabs ═══ */
import './features/settings/settings-tab-account.js';
import './features/settings/settings-tab-diary.js';
import './features/settings/settings-tab-people.js';
import './features/settings/settings-tab-retention.js';
import './features/settings/settings-tab-import.js';
import './features/settings/settings-tab-help.js';
import './features/settings/settings-view.js';

/* ═══ Features — Views ═══ */
import './features/dashboard/dashboard-view.js';
import './features/dashboard/home-dashboard.js';
import './features/dashboard/floating-postit.js';
import './features/kiosk/kiosk-view.js';
import './features/kiosk/kiosk-cms-view.js';
import './features/kiosk/kiosk-flow-designer.js';
import './features/kiosk/ems-popup-view.js';
import './features/emergency/emergency-view.js';
import './features/survey/survey-view.js';
import './features/survey/survey-newsletter-editor.js';
import './features/newsletter/newsletter-misc-view.js';
import './features/newsletter/bed-management-view.js';
import './features/training/training-view.js';
import './features/physical-exam/physical-exam-view.js';
import './features/planner/planner-view.js';
import './features/symptom/symptom-view.js';
import './features/stats/stats-view.js';
import './features/person-manager/person-manager-view.js';

/* ═══ Features — Daily ═══ */
import './features/daily/daily-autocomplete.js';
import './features/daily/diary-print-view.js';
import './features/daily/rental-ledger-view.js';
import './features/daily/kiosk-reception-panel.js';
import './features/daily/daily-view.js';

/* ═══ Features — Visit Pass ═══ */
import './features/visit-pass/visit-pass-view.js';
import './features/visit-pass/visit-pass-editor.js';

/* ═══ Shell (마지막: 이벤트 바인딩 + 부트스트랩) ═══ */
import './features/shell/splash-login-controller.js';
import './features/shell/theme-manager.js';
import './features/shell/header-widget.js';
import './features/shell/view-router.js';
import './features/shell/bg-context-menu.js';
import './core/event-bindings.js';
import './features/shell/app-bootstrap.js';
