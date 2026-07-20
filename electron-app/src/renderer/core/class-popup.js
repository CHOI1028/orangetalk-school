/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * 📚 수업 자동 팝업 (class-popup.js) — 2026-06-17
 *
 * 나이스 시간표에서 선택한 '내 수업'을, 사용자가 지정한 시각에 매주 그 요일마다 팝업으로 알린다.
 * 급식(school-meal.js)·학사일정과 같은 30초 폴링 스케줄러 패턴.
 *
 * 데이터: ec_class_popups = [{ id, dow, perio, content, grade, dept, cls, time }]
 *   · dow  : 0=월 … 4=금 (시간표 주간 컬럼 기준)
 *   · perio: 교시 (문자열)
 *   · time : 'HH:MM' 알림 희망 시각
 *   매주 그 요일 그 시각에 알림 (시간표는 주 단위로 고정이라는 전제).
 */
import { bus } from './event-bus.js';
import { escHtml } from './helpers.js';
import { playUiSound } from './ui-utils.js';

const KEY = 'ec_class_popups';
const ON_KEY = 'ec_class_popup_on';
const DOW_KR = ['월', '화', '수', '목', '금'];

export function getClassPopups(){
  try{ const a = JSON.parse(localStorage.getItem(KEY) || '[]'); if(Array.isArray(a)) return a; }catch(_){}
  return [];
}
/* 같은 칸(요일·교시·학년·학과·반) 식별 키 — 재선택 시 시각만 갱신 */
export function classPopupKey(p){
  return [p.dow, p.perio, p.grade || '', p.dept || '', p.cls || ''].join('|');
}
function _save(arr){
  try{ localStorage.setItem(KEY, JSON.stringify(arr)); }catch(_){}
  try{ if(window.electronAPI && window.electronAPI.dbSet) window.electronAPI.dbSet('common', KEY, arr); }catch(_){}
  try{ bus.emit('classpopup:changed'); }catch(_){}
  restartClassScheduler();
}
export function addClassPopup(rec){
  const arr = getClassPopups();
  const k = classPopupKey(rec);
  const idx = arr.findIndex(function(x){ return classPopupKey(x) === k; });
  if(idx >= 0) arr[idx] = Object.assign({}, arr[idx], rec);   /* 같은 칸 재선택 → 시각 갱신 */
  else arr.push(Object.assign({ id: Date.now() + Math.floor(Math.random() * 1000) }, rec));
  _save(arr);
}
export function removeClassPopupByKey(key){
  _save(getClassPopups().filter(function(x){ return classPopupKey(x) !== key; }));
}
/* 선택한 수업 전체 삭제 (모두 삭제 버튼) */
export function clearAllClassPopups(){ _save([]); }
export function isClassPopupOn(){ return localStorage.getItem(ON_KEY) === 'Y'; }
export function setClassPopupOn(on){ localStorage.setItem(ON_KEY, on ? 'Y' : 'N'); restartClassScheduler(); }
export function classDowLabel(dow){ return DOW_KR[dow] || ''; }

/* ── 스케줄러 (급식과 동일 패턴: 30초마다 요일·시각 확인, 하루 1회) ── */
let _timer = null;
export function restartClassScheduler(){
  if(_timer){ clearInterval(_timer); _timer = null; }
  if(!isClassPopupOn()) return;
  if(!getClassPopups().length) return;
  _timer = setInterval(_tick, 30000);
}
function _tick(){
  try{
    if(!isClassPopupOn()){ clearInterval(_timer); _timer = null; return; }
    const now = new Date();
    const jsDow = now.getDay();          /* 0=일 … 6=토 */
    if(jsDow < 1 || jsDow > 5) return;   /* 주말엔 수업 없음 */
    const dow = jsDow - 1;               /* 월=0 */
    const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    getClassPopups().forEach(function(p){
      if(String(p.dow) !== String(dow)) return;
      if(p.time !== cur) return;
      const lastKey = 'ec_class_popup_last_' + classPopupKey(p);
      if(localStorage.getItem(lastKey) === todayStr) return;
      localStorage.setItem(lastKey, todayStr);
      showClassPopup(p, { silent: true });
    });
  }catch(_){}
}
export function maybeStartClassScheduler(){ restartClassScheduler(); }

/* ── 팝업 표시 ── */
export function showClassPopup(p, opts){
  opts = opts || {};
  try{ playUiSound('happybell.wav', 0.7); }catch(_){}   /* 수업 알림 효과음 (사용자 요청 2026-06-18) */
  const dowL = classDowLabel(p.dow);
  const info = [(p.grade ? p.grade + '학년' : ''), (p.dept || ''), (p.cls ? p.cls + '반' : '')].filter(Boolean).join(' ');
  const ov = document.createElement('div');
  ov.className = 'modal-overlay show';
  ov.style.zIndex = '13200';
  ov.innerHTML = '<div class="modal-content" style="width:400px;max-width:94vw;padding:0;overflow:hidden">'
    + '<div style="padding:14px 20px;background:linear-gradient(135deg,rgba(236,72,153,0.14),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px"><span style="font-size:20px">📚</span><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--t1)">수업 알림</div><div style="font-size:10.5px;color:var(--t3)">' + dowL + '요일 ' + escHtml(String(p.perio)) + '교시</div></div></div>'
    + '<div style="padding:22px 20px;text-align:center">'
    +   '<div style="font-size:17px;font-weight:800;color:var(--t1);margin-bottom:6px">' + escHtml(p.content || '수업') + '</div>'
    +   (info ? '<div style="font-size:12px;color:var(--t2)">' + escHtml(info) + '</div>' : '')
    +   '<div style="font-size:11px;color:var(--t3);margin-top:12px">곧 수업 시간입니다.</div>'
    + '</div>'
    + '<div style="padding:12px 20px;border-top:1px solid var(--bdr);text-align:right"><button data-cp-close style="padding:7px 18px;font-size:12px;font-weight:700;border:none;background:linear-gradient(135deg,#ec4899,#a855f7);color:#fff;border-radius:7px;cursor:pointer;font-family:var(--f)">확인</button></div>'
    + '</div>';
  document.body.appendChild(ov);
  const close = function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); };
  ov.addEventListener('mousedown', function(e){ if(e.target === ov) close(); });
  const b = ov.querySelector('[data-cp-close]'); if(b) b.addEventListener('click', close);
}
