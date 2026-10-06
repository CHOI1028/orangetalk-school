#!/usr/bin/env node
/**
 * obfuscate.js — 빌드 전 코드 난독화 스크립트
 *
 * 동작:
 *   1. src/ 하위 모든 .js 파일 → dist-obf/ 에 난독화 복사
 *   2. main.js, preload.js, google-auth.js, sheets-api.js, calendar-api.js → dist-obf/에 난독화
 *   3. health_diary.html 내 <script> 블록 추출 → 난독화 → 재삽입 → dist-obf/health_diary.html
 *
 * 빌드 시 electron-builder는 dist-obf/ 대신 원본 소스를 패키징하면 안 됩니다.
 * → package.json files 배열을 dist-obf/로 재지정하거나, 이 스크립트가 원본을 교체합니다.
 *
 * 개발 시 'npm start'는 원본 소스를 그대로 사용합니다.
 * 배포 빌드('npm run build')만 난독화를 적용합니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '.build-originals');

// 난독화 설정 — "분석가가 즉시 읽지는 못함 + 사용자가 속도 저하 못 느낌" sweet spot (2026-05-20).
// 켠 것: 변수명 mangle + 문자열 배열(base64, rotate OFF, wrapper 1) + simplify.
// 끈 것 (속도 보호용 ─ 모두 의도적):
//   - controlFlowFlattening : 1.5~2.5x 느려짐, 가장 큰 부담 → OFF
//   - deadCodeInjection     : 코드 크기 +200% + 미세 부담 → OFF
//   - numbersToExpressions  : 미세 부담 + 가독성 효과 작음 → OFF
//   - splitStrings          : 미세 부담 → OFF
//   - stringArrayRotate     : 실시간 회전 — 호출마다 부담 → OFF (shuffle 만 빌드시 1회)
//   - selfDefending / debugProtection / renameGlobals / transformObjectKeys : 호환성/디버깅
const OBF_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'mangled-shuffled',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: false,
  stringArrayRotate: false,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: false,
  stringArrayWrappersType: 'variable',
  stringArrayThreshold: 1.0,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
};

// Root entrypoints only; all src/ modules (including credential bundles) are handled by the src walker.
const MAIN_JS_FILES = [
  'main.js',
  'preload.js',
];

const STANDALONE_RUNTIME_MODULES = new Set([
  'src/renderer/features/kiosk/kiosk-reception-runtime.js',
  'src/renderer/features/kiosk/kiosk-call-audio.js',
]);

// These functions are serialized into standalone HTML. Keep their literals self-contained.
function obfuscationOptions(filename) {
  const relative = String(filename).replace(/\\/g, '/');
  return { ...OBF_OPTIONS, stringArray: !STANDALONE_RUNTIME_MODULES.has(relative) };
}

function obfuscateJs(code, filename) {
  try {
    const result = JavaScriptObfuscator.obfuscate(code, {
      ...obfuscationOptions(filename),
      sourceMapFileName: filename + '.map',
    });
    return result.getObfuscatedCode();
  } catch (err) {
    /* 난독화 실패 = 소스에 문법 오류가 있다는 뜻 — 조용히 원본을 포함하고 계속 가면
     *  고장난 파일이 그대로 배포본에 실린다 (2026-07-06 diary-print-view 중복선언 흰화면 사고).
     *  → 즉시 원본 복원 후 빌드를 중단시켜, 깨진 빌드가 절대 만들어지지 않게 한다. */
    console.error('[OBF] ★ 난독화 실패 — 빌드 중단:', filename, err.message);
    try { restoreOriginals(); } catch (_) {}
    process.exit(1);
  }
}

function backupOriginal(filePath) {
  const rel = path.relative(ROOT, filePath);
  const backupPath = path.join(BACKUP_DIR, rel);
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
    console.log('[OBF] 원본 백업:', rel);
  }
}

function restoreOriginals() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(BACKUP_DIR, full);
        const dest = path.join(ROOT, rel);
        fs.copyFileSync(full, dest);
        console.log('[OBF] 원본 복원:', rel);
      }
    });
  }
  walk(BACKUP_DIR);
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  console.log('[OBF] 복원 완료');
}

function obfuscateMainFiles() {
  MAIN_JS_FILES.forEach(rel => {
    const filePath = path.join(ROOT, rel);
    if (!fs.existsSync(filePath)) return;
    backupOriginal(filePath);
    const code = fs.readFileSync(filePath, 'utf8');
    const obf = obfuscateJs(code, rel);
    fs.writeFileSync(filePath, obf, 'utf8');
    console.log('[OBF] 난독화 완료:', rel);
  });
}

function obfuscateSrcFiles() {
  const srcDir = path.join(ROOT, 'src');
  if (!fs.existsSync(srcDir)) return;
  function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (f.endsWith('.js')) {
        backupOriginal(full);
        const code = fs.readFileSync(full, 'utf8');
        const obf = obfuscateJs(code, path.relative(ROOT, full));
        fs.writeFileSync(full, obf, 'utf8');
        console.log('[OBF] 난독화 완료:', path.relative(ROOT, full));
      }
    });
  }
  walk(srcDir);
}

function obfuscateHtmlScripts() {
  const htmlPath = path.join(ROOT, 'health_diary.html');
  if (!fs.existsSync(htmlPath)) return;
  backupOriginal(htmlPath);

  let html = fs.readFileSync(htmlPath, 'utf8');

  // <script> 블록 (src 없는 인라인 스크립트만) 추출 후 난독화
  html = html.replace(/<script(?!\s+src)([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, code) => {
    if (!code.trim()) return match;
    const obf = obfuscateJs(code, 'health_diary.html[script]');
    return '<script' + attrs + '>' + obf + '</script>';
  });

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('[OBF] health_diary.html 스크립트 난독화 완료');
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--restore') {
    restoreOriginals();
    return;
  }

  console.log('=== 코드 난독화 시작 ===');

  // 이전 백업이 남아 있으면 먼저 복원 (재빌드 시 중복 난독화 방지)
  if (fs.existsSync(BACKUP_DIR)) {
    console.log('[OBF] 이전 빌드 백업 발견 → 먼저 복원합니다');
    restoreOriginals();
  }

  obfuscateMainFiles();
  obfuscateSrcFiles();
  obfuscateHtmlScripts();

  console.log('=== 난독화 완료 ===');
  console.log('빌드 후 원본 복원이 필요하면: node scripts/obfuscate.js --restore');
}

if (require.main === module) main();
module.exports = { obfuscateJs, obfuscationOptions };
