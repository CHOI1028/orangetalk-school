/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';
/**
 * kiosk-roster-crypto.js — 키오스크 온디맨드 명단 종단간 암호화 (2026-06-14)
 *
 * 목적: 학생/교직원 "이름"이 릴레이 서버에 평문으로 절대 남지 않게 한다.
 *   - PC(교사) 가 반별 명단을 이 키로 AES-256-GCM 암호화해서 릴레이로 보냄
 *   - 키오스크(태블릿) 가 같은 키로 복호화해서 화면에 이름 표시
 *   - 릴레이는 ct(암호문) 만 통과시키는 파이프 → 이름을 절대 못 읽음
 *
 * 키 공유: PC 가 만든 rosterSecret 을 키오스크 URL/QR 의 #rk= fragment 로 전달.
 *   브라우저는 fragment 를 HTTP 요청에 안 실으므로 릴레이는 secret 을 영원히 못 받는다.
 *   → 릴레이가 능동적으로 가로채도(MITM) 키가 없어 복호 불가.
 *
 * ★ 동일 알고리즘이 키오스크 standalone HTML 에도 인라인으로 들어간다
 *   (kiosk-html-builder.js 의 ROSTER_CRYPTO_KIOSK_SRC). 한쪽을 바꾸면 반드시 양쪽 같이 바꿀 것.
 *   교차검증: server-code/kiosk-relay-server 옆 _test-roster-crypto.mjs 가 PC암호화→키오스크복호화 라운드트립 확인.
 *
 * 알고리즘(양쪽 고정):
 *   secret(base64url) → HKDF-SHA256(salt="orangetalk-roster-v1", info=channelId) → AES-GCM 256
 *   encrypt: 12바이트 랜덤 IV, 출력 {iv:base64, ct:base64(암호문+GCM태그)}
 */

const _RK_SALT = 'orangetalk-roster-v1';

function _rkSubtle() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof self !== 'undefined' && self.crypto) || null;
  if (!c || !c.subtle) throw new Error('WebCrypto(SubtleCrypto) 미지원 환경');
  return c;
}
function _rkBytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function _rkB64ToBytes(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _rkB64Url(u8) {
  return _rkBytesToB64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 새 rosterSecret 생성 — 256비트 랜덤(base64url). PC 가 채널당 1개 만들어 보관 + URL fragment 로 전달. */
export function genRosterSecret() {
  const c = _rkSubtle();
  return _rkB64Url(c.getRandomValues(new Uint8Array(32)));
}

/** rosterSecret(base64url) + channelId → AES-GCM CryptoKey. */
export async function deriveRosterKey(secret, channelId) {
  const c = _rkSubtle();
  const enc = new TextEncoder();
  const baseKey = await c.subtle.importKey('raw', _rkB64ToBytes(secret), 'HKDF', false, ['deriveKey']);
  return c.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(_RK_SALT), info: enc.encode(String(channelId || '')) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 객체 → {iv, ct} (둘 다 base64). */
export async function encryptJson(key, obj) {
  const c = _rkSubtle();
  const iv = c.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: _rkBytesToB64(iv), ct: _rkBytesToB64(new Uint8Array(ct)) };
}

/** {iv, ct}(base64) → 객체. 복호 실패 시 throw. */
export async function decryptJson(key, ivB64, ctB64) {
  const c = _rkSubtle();
  const pt = await c.subtle.decrypt({ name: 'AES-GCM', iv: _rkB64ToBytes(ivB64) }, key, _rkB64ToBytes(ctB64));
  return JSON.parse(new TextDecoder().decode(pt));
}
