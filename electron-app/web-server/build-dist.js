#!/usr/bin/env node
/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * build-dist.js — 웹 서버 포터블 배포판 생성
 *
 * 사용법: node web-server/build-dist.js
 * 출력:   dist-web/OrangeTalkWeb/
 *
 * 포함 항목:
 *  - server.js + web-api-bridge.js
 *  - src/renderer/ (프론트엔드)
 *  - src/main/services/ (백엔드 서비스)
 *  - templates/ (양식)
 *  - node_modules/ (프로덕션 의존성)
 *  - start.bat / start.command (시작 스크립트)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist-web', 'OrangeTalkWeb');

/* ── 유틸리티 ── */
function copyDir(src, dest, filter) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filter && !filter(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
}

/* ── 빌드 시작 ── */
console.log('📦 웹 서버 배포판 생성 시작...\n');

/* 1. 기존 dist 정리 */
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

/* 2. 웹 서버 파일 복사 */
console.log('  [1/6] 서버 파일 복사...');
fs.mkdirSync(path.join(DIST, 'web-server'), { recursive: true });
copyFile(path.join(__dirname, 'server.js'), path.join(DIST, 'web-server', 'server.js'));
copyFile(path.join(__dirname, 'web-api-bridge.js'), path.join(DIST, 'web-server', 'web-api-bridge.js'));

/* 3. 프론트엔드 + 백엔드 서비스 복사 */
console.log('  [2/6] 앱 파일 복사...');
copyFile(path.join(ROOT, 'health_diary.html'), path.join(DIST, 'health_diary.html'));
copyDir(path.join(ROOT, 'src'), path.join(DIST, 'src'));
copyDir(path.join(ROOT, 'templates'), path.join(DIST, 'templates'));
copyDir(path.join(ROOT, 'kiosk'), path.join(DIST, 'kiosk'));
if (fs.existsSync(path.join(ROOT, 'assets'))) {
  copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));
}

/* 4. package.json (프로덕션 의존성만) */
console.log('  [3/6] package.json 생성...');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const webPkg = {
  name: 'health-diary-web',
  version: pkg.version,
  description: '오렌지톡 — 웹 브라우저 버전',
  main: 'web-server/server.js',
  scripts: {
    start: 'node web-server/server.js'
  },
  dependencies: {
    'better-sqlite3': pkg.dependencies['better-sqlite3'],
    'express': pkg.dependencies['express'],
    'xlsx': pkg.dependencies['xlsx'],
    'pdfjs-dist': pkg.dependencies['pdfjs-dist'],
    'html2canvas': pkg.dependencies['html2canvas'],
    'jspdf': pkg.dependencies['jspdf'],
    'ws': pkg.dependencies['ws'],
  }
};
fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(webPkg, null, 2));

/* 5. npm install (프로덕션) */
console.log('  [4/6] npm install --production...');
execSync('npm install --production', { cwd: DIST, stdio: 'inherit' });

/* 6. 시작 스크립트 생성 */
console.log('  [5/6] 시작 스크립트 생성...');

/* Windows */
fs.writeFileSync(path.join(DIST, 'start.bat'),
`@echo off
chcp 65001 >nul
title 오렌지톡 — 웹 서버
echo.
echo   ┌──────────────────────────────────────┐
echo   │  오렌지톡 — 웹 브라우저 버전     │
echo   │                                      │
echo   │  서버를 시작합니다...                 │
echo   └──────────────────────────────────────┘
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [오류] Node.js가 설치되어 있지 않습니다.
    echo  https://nodejs.org 에서 Node.js LTS를 설치해 주세요.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"
echo  Node.js 버전: & node -v
echo.

start http://localhost:3000
node web-server/server.js
pause
`, 'utf8');

/* macOS / Linux */
fs.writeFileSync(path.join(DIST, 'start.command'),
`#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  ┌──────────────────────────────────────┐"
echo "  │  오렌지톡 — 웹 브라우저 버전     │"
echo "  │                                      │"
echo "  │  서버를 시작합니다...                 │"
echo "  └──────────────────────────────────────┘"
echo ""

if ! command -v node &> /dev/null; then
    echo "  [오류] Node.js가 설치되어 있지 않습니다."
    echo "  https://nodejs.org 에서 Node.js LTS를 설치해 주세요."
    echo ""
    read -p "  엔터를 누르세요..."
    exit 1
fi

echo "  Node.js 버전: $(node -v)"
echo ""

# 3초 후 브라우저 열기
(sleep 3 && open http://localhost:3000) &

node web-server/server.js
`, 'utf8');

fs.chmodSync(path.join(DIST, 'start.command'), '755');

/* 7. README */
console.log('  [6/6] README 생성...');
fs.writeFileSync(path.join(DIST, 'README.txt'),
`═══════════════════════════════════════════════
  오렌지톡 — 웹 브라우저 버전 v${pkg.version}
═══════════════════════════════════════════════

[사전 준비]
  Node.js 20 이상 설치 필요
  → https://nodejs.org (LTS 다운로드)

[실행 방법]
  Windows: start.bat 더블클릭
  macOS:   start.command 더블클릭
  공통:    터미널에서 npm start

[종료 방법]
  터미널 창을 닫거나 Ctrl+C

[데이터 저장 위치]
  Windows: %USERPROFILE%\\.health-diary-web\\data\\
  macOS:   ~/.health-diary-web/data/

[문의]
  https://github.com/jwkim2353/my-health-diary/issues
═══════════════════════════════════════════════
`, 'utf8');

/* 완료 */
const distSize = execSync(`du -sh "${DIST}" 2>/dev/null || echo "알 수 없음"`, { encoding: 'utf8' }).trim();
console.log(`\n✅ 배포판 생성 완료: ${DIST}`);
console.log(`   크기: ${distSize}`);
console.log(`\n   실행: cd dist-web/OrangeTalkWeb && npm start`);
