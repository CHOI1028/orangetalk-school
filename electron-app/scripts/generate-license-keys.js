/**
 * 오렌지톡 — CD키 생성 스크립트
 *
 * 형식: XXXX-XXXX (8글자 + 대시 1)
 * 문자셋: 31종 — 혼동 글자 제외 (0, 1, O, I, L 제외)
 *   A B C D E F G H J K M N P Q R S T U V W X Y Z  (23종)
 *   2 3 4 5 6 7 8 9                                (8종)
 * 개수: 30,000개 (중복 자동 제거)
 * 출력: license-keys-v1.csv (key, status, created_at, used_at, user_info)
 *
 * 사용:
 *   node scripts/generate-license-keys.js [count] [outfile]
 *   node scripts/generate-license-keys.js 30000
 *   node scripts/generate-license-keys.js 30000 D:\\my-health-diary-license\\keys.csv
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31종 (혼동 글자 제외)
const KEY_LEN = 8;                                 // 8글자
const DASH_AFTER = 4;                              // XXXX-XXXX

function generateOneKey() {
  /* crypto.randomBytes 로 균등 분포 보장. 31 은 256 의 약수가 아니어서
     단순 mod 는 약간의 편향이 생기므로 rejection sampling 으로 보정. */
  const out = [];
  while (out.length < KEY_LEN) {
    const buf = crypto.randomBytes(KEY_LEN * 2); // 여유 있게 뽑음
    for (let i = 0; i < buf.length && out.length < KEY_LEN; i++) {
      const b = buf[i];
      if (b < 248) {              // 256 - (256 % 31) = 248 미만만 채택
        out.push(CHARSET[b % CHARSET.length]);
      }
    }
  }
  return out.join('');
}

function format(raw) {
  return raw.slice(0, DASH_AFTER) + '-' + raw.slice(DASH_AFTER);
}

function main() {
  const argCount = parseInt(process.argv[2], 10);
  const count = Number.isFinite(argCount) && argCount > 0 ? argCount : 30000;
  const outPath = process.argv[3] || path.resolve(__dirname, '..', '..', 'license-keys', 'license-keys-v1.csv');

  console.log('[license-gen] target:', count, '개');
  console.log('[license-gen] 문자셋:', CHARSET, '(' + CHARSET.length + '종)');
  console.log('[license-gen] 형식:  XXXX-XXXX (' + KEY_LEN + '글자)');
  console.log('[license-gen] 출력:', outPath);
  console.log('[license-gen] 이론상 조합 수: ' + Math.pow(CHARSET.length, KEY_LEN).toExponential(3));
  console.log();

  const set = new Set();
  let collisions = 0;
  const start = Date.now();

  while (set.size < count) {
    const k = generateOneKey();
    if (set.has(k)) { collisions++; continue; }
    set.add(k);
    if (set.size % 5000 === 0) {
      const pct = (set.size / count * 100).toFixed(1);
      console.log('[license-gen]   ' + set.size + ' / ' + count + ' (' + pct + '%)');
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log();
  console.log('[license-gen] 생성 완료. ' + count + '개 / 충돌 ' + collisions + '회 / ' + elapsed + '초');

  /* 디렉토리 보장 */
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  /* CSV 작성 — UTF-8 BOM 으로 Excel 호환 */
  const now = new Date().toISOString();
  const lines = ['key,status,created_at,used_at,user_info'];
  for (const raw of set) {
    lines.push(format(raw) + ',unused,' + now + ',,');
  }
  fs.writeFileSync(outPath, '﻿' + lines.join('\r\n'), 'utf8');

  console.log('[license-gen] 저장: ' + outPath);
  console.log('[license-gen] 파일 크기: ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');

  /* 샘플 5개 출력 */
  const sample = Array.from(set).slice(0, 5).map(format);
  console.log();
  console.log('[license-gen] 샘플:');
  sample.forEach(function (k) { console.log('  ' + k); });
}

main();
