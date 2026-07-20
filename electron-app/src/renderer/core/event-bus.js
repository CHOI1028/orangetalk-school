/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/**
 * event-bus.js — 기능 간 결합을 제거하는 경량 이벤트 버스
 *
 * 사용법:
 *   import { bus } from './event-bus.js';
 *
 *   // 구독 (feature 모듈에서)
 *   bus.on('render:daily', () => renderDaily());
 *
 *   // 발행 (다른 feature에서)
 *   bus.emit('render:daily');
 *
 * 이벤트 목록:
 *   render:daily          — 일반일지 테이블 재렌더
 *   render:calendar       — 달력 재렌더
 *   render:sidebar        — 최근 기록 사이드바 재렌더
 *   render:dashboard      — 대시보드 재렌더
 *   render:ecList         — 응급처치 목록 재렌더
 *   render:infList        — 감염병 목록 재렌더
 *   toast:show            — 토스트 메시지 { text, type? }
 *   toast:blue            — 파란 토스트 { text }
 *   toast:save            — 저장 토스트 (인자 없음)
 *   modal:closeAll        — 열린 모달 닫기
 */

const listeners = Object.create(null);

export const bus = {
  on(event, fn) {
    (listeners[event] || (listeners[event] = [])).push(fn);
  },
  off(event, fn) {
    const arr = listeners[event];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  emit(event, data) {
    const arr = listeners[event];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      try { arr[i](data); } catch (e) { console.error('[bus] ' + event, e); }
    }
  }
};
