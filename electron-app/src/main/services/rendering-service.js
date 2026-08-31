/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * rendering-service.js — 렌더링 통합 서비스
 *
 * NewsletterRenderService — 가정통신문 HTML/PDF 렌더링
 * ScreenCaptureService — 숨겨진 BrowserWindow를 이용한 HTML→이미지 캡처
 */

/* ══════════ NewsletterRenderService ══════════ */

/**
 * NewsletterRenderService — 가정통신문 HTML/PDF 렌더링
 * 순수 변환 함수 모음. 내부 상태 없음.
 */
class NewsletterRenderService {
  buildHtml(state, options) {
    const nlState = state || {};
    const opts = options || {};
    const mergePreview = !!opts.mergePreview;
    const mergeRow = opts.mergeRow || null;
    const bgCss = nlState.pdfBgUrl
      ? 'background-image:url(' + nlState.pdfBgUrl + ');background-size:' + (nlState.bgScale || 100) + '% auto;background-repeat:no-repeat;background-position:calc(50% + ' + (nlState.bgOffsetX || 0) + 'px) ' + (nlState.bgOffsetY || 0) + 'px;'
      : '';
    let html = '<div style="position:relative;width:' + nlState.canvasW + 'px;min-height:' + nlState.canvasH + 'px;margin:0 auto;' + bgCss + '">';

    (nlState.objects || []).forEach(obj => {
      const s = obj.style || {};
      const common = 'position:absolute;left:' + obj.x + 'px;top:' + obj.y + 'px;width:' + obj.w + 'px;height:' + obj.h + 'px;z-index:' + (obj.z || 1) + ';box-sizing:border-box;';
      if (obj.type === 'textbox') {
        const content = this._replaceMerge(obj.content || '', mergePreview, mergeRow);
        html += '<div style="' + common + 'font-size:' + (s.fontSize || 12) + 'px;font-family:' + (s.fontFamily || "'Noto Sans KR'") + ';font-weight:' + (s.fontWeight || 'normal') + ';font-style:' + (s.fontStyle || 'normal') + ';text-decoration:' + (s.textDecoration || 'none') + ';color:' + (s.color || '#000') + ';text-align:' + (s.textAlign || 'left') + ';background:' + (s.bgColor && s.bgColor !== 'transparent' ? s.bgColor : 'transparent') + ';border:' + ((s.borderWidth || 0) > 0 ? s.borderWidth + 'px solid ' + (s.borderColor || '#000') : 'none') + ';border-radius:' + (s.borderRadius || 0) + 'px;padding:2px 4px;line-height:1.5;overflow:hidden;word-break:break-word;white-space:pre-wrap">' + content + '</div>';
      } else if (obj.type === 'image') {
        html += '<div style="' + common + '"><img src="' + this._sanitizeUrl(obj.content) + '" style="width:100%;height:100%;object-fit:contain"></div>';
      } else if (obj.type === 'rect') {
        html += '<div style="' + common + 'background:' + (s.bgColor && s.bgColor !== 'transparent' ? s.bgColor : 'transparent') + ';border:' + (s.borderWidth || 1) + 'px solid ' + (s.borderColor || '#000') + ';border-radius:' + (s.borderRadius || 0) + 'px"></div>';
      } else if (obj.type === 'circle') {
        html += '<div style="' + common + 'background:' + (s.bgColor && s.bgColor !== 'transparent' ? s.bgColor : 'transparent') + ';border:' + (s.borderWidth || 1) + 'px solid ' + (s.borderColor || '#000') + ';border-radius:50%"></div>';
      } else if (obj.type === 'line') {
        html += '<div style="' + common + 'border-top:' + (s.borderWidth || 1) + 'px ' + (s.borderStyle || 'solid') + ' ' + (s.borderColor || '#000') + ';height:0;margin-top:' + Math.floor(obj.h / 2) + 'px"></div>';
      } else if (obj.type === 'table' && obj.tableData) {
        const td = obj.tableData;
        html += '<div style="' + common + 'overflow:hidden"><table style="width:100%;height:100%;border-collapse:collapse;font-size:' + (s.fontSize || 11) + 'px;font-family:' + (s.fontFamily || "'Noto Sans KR'") + ';color:' + (s.color || '#000') + ';table-layout:fixed">';
        for (let r = 0; r < td.rows; r++) {
          html += '<tr>';
          for (let c = 0; c < td.cols; c++) {
            const cell = td.cells[r * td.cols + c] || { text: '' };
            if (cell.merged) continue;
            const cellText = this._replaceMerge(cell.text || '', mergePreview, mergeRow);
            html += '<td style="border:1px solid ' + (s.borderColor || '#aaa') + ';padding:3px 4px;vertical-align:top' + (cell.bg ? ';background:' + cell.bg : '') + '"' + (cell.colspan ? ' colspan="' + cell.colspan + '"' : '') + (cell.rowspan ? ' rowspan="' + cell.rowspan + '"' : '') + '>' + this._escHtml(cellText) + '</td>';
          }
          html += '</tr>';
        }
        html += '</table></div>';
      }
    });

    html += '</div>';
    return html;
  }

  buildMergePdfHtml(state, options) {
    const nlState = state || {};
    const opts = options || {};
    const mergeRows = Array.isArray(opts.mergeRows) ? opts.mergeRows : [];
    const mt = nlState.marginTop || 0, mb = nlState.marginBottom || 0;
    const ml = nlState.marginLeft || 0, mr = nlState.marginRight || 0;
    const cw = nlState.canvasW, ch = nlState.canvasH;

    let fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>';
    fullHtml += '@page{size:' + cw + 'pt ' + ch + 'pt;margin:' + mt + 'mm ' + mr + 'mm ' + mb + 'mm ' + ml + 'mm}';
    fullHtml += 'body{margin:0;padding:0}.page{width:' + cw + 'px;height:' + ch + 'px;position:relative;overflow:hidden;page-break-after:always}.page:last-child{page-break-after:auto}';
    fullHtml += '</style></head><body>';

    mergeRows.forEach(row => {
      fullHtml += '<div class="page">' + this.buildHtml(nlState, { mergePreview: true, mergeRow: row }) + '</div>';
    });

    fullHtml += '</body></html>';
    return fullHtml;
  }

  /* ──────────── private helpers ──────────── */

  _escHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  _replaceMerge(text, mergePreview, mergeRow) {
    const source = String(text || '');
    if (!mergePreview || !mergeRow) return source;
    return source.replace(/\{\{(.+?)\}\}/g, (m, key) =>
      mergeRow[key] !== undefined ? String(mergeRow[key]) : m
    );
  }

  /** URL 보안 검증: javascript/data/vbscript 프로토콜 차단 */
  _sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^(javascript|vbscript):/i.test(trimmed)) return '';
    /* data: URI는 이미지에 한해 허용 (base64 인라인 이미지) */
    if (/^data:/i.test(trimmed) && !/^data:image\//i.test(trimmed)) return '';
    return this._escHtml(trimmed);
  }
}

/* ══════════ ScreenCaptureService ══════════ */

/**
 * ScreenCaptureService — 숨겨진 BrowserWindow를 이용한 HTML→이미지 캡처
 */
class ScreenCaptureService {
  /**
   * @param {{ BrowserWindow, dialog, clipboard }} electron — Electron 모듈
   * @param {string} tempDir — 임시 파일 디렉토리
   * @param {function} getMainWindow — 현재 메인 윈도우를 반환하는 함수
   */
  constructor(electron, tempDir, getMainWindow) {
    this._BrowserWindow = electron.BrowserWindow;
    this._dialog = electron.dialog;
    this._clipboard = electron.clipboard;
    this._tempDir = tempDir;
    this._getMainWindow = getMainWindow;
    /* 2단계 PDF (2026-08-12) — 생성(printToPdfGenerate)과 저장 다이얼로그(printToPdfSave) 분리용
     * 버퍼 보관소. 렌더러가 진행 카운터를 끝까지 채운 뒤 저장 창을 요청할 수 있게 한다.
     * token → { buf, ts }. TTL(10분) 초과분은 다음 generate 때 정리. */
    this._pdfStore = new Map();
  }

  /** 최대 HTML 크기 (5MB) — PNG/클립보드 캡처용 (화면 비트맵을 통째로 만드는 경로라 낮게 유지) */
  static MAX_HTML_SIZE = 5 * 1024 * 1024;

  /** PDF 전용 최대 HTML 크기 (30MB) — 보건일지 연간 출력 등 대용량 문서 허용.
   *  경량화된 행 기준 약 7만 행까지 수용 (사용자 보고 2026-08-12: 1학기치 5MB 초과로 무음 실패). */
  static MAX_PDF_HTML_SIZE = 30 * 1024 * 1024;

  /** PDF 생성 감시 타임아웃 (5분) — 연간 등 대용량 문서도 수 분 안에 끝나므로,
   *  이를 넘기면 숨은 창이 멈춘 것으로 보고 반드시 실패 응답을 돌려준다. */
  static PDF_WATCHDOG_MS = 5 * 60 * 1000;

  /**
   * HTML을 PNG로 렌더링하여 파일로 저장합니다.
   */
  async captureToPng(html, width, fileName) {
    if (!html || html.length > ScreenCaptureService.MAX_HTML_SIZE) {
      return { success: false, error: 'HTML 크기 제한 초과 (최대 5MB)' };
    }
    let hiddenWin = null;
    const tmpFile = path.join(this._tempDir, '_capturepng_' + Date.now() + '.html');
    try {
      const w = Math.min(Math.max(Math.round(width || 1200), 100), 4000);
      hiddenWin = new this._BrowserWindow({
        width: w, height: 800, show: false, frame: false,
        useContentSize: true,
        webPreferences: { contextIsolation: true }
      });
      const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{margin:0;overflow:hidden;width:' + w + 'px;background:#fff}</style></head><body>' + html + '</body></html>';
      fs.writeFileSync(tmpFile, page, 'utf8');
      await hiddenWin.loadFile(tmpFile);
      await new Promise(r => setTimeout(r, 500));
      const [contentW, contentH] = await hiddenWin.webContents.executeJavaScript(
        '(function(){var el=document.body.firstElementChild||document.body;var r=el.getBoundingClientRect();return[Math.ceil(Math.max(r.right,document.body.scrollWidth)),Math.ceil(Math.max(r.bottom,document.body.scrollHeight))];})()'
      );
      hiddenWin.setContentSize(contentW, contentH);
      await new Promise(r => setTimeout(r, 300));
      const img = await hiddenWin.webContents.capturePage({ x: 0, y: 0, width: contentW, height: contentH });
      hiddenWin.close();
      hiddenWin = null;
      this._tryUnlink(tmpFile);
      if (img.isEmpty()) throw new Error('빈 이미지');
      const mainWin = this._getMainWindow();
      const { canceled, filePath } = await this._dialog.showSaveDialog(mainWin, {
        title: 'PNG 저장',
        defaultPath: fileName || 'export.png',
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      });
      if (canceled || !filePath) return { success: false, error: 'cancelled' };
      fs.writeFileSync(filePath, img.toPNG());
      return { success: true, filePath };
    } catch (err) {
      if (hiddenWin) try { hiddenWin.close(); } catch (e) {}
      this._tryUnlink(tmpFile);
      return { success: false, error: err.message };
    }
  }

  /**
   * HTML을 렌더링하여 클립보드로 복사합니다.
   */
  async captureElement(html, width, height) {
    if (!html || html.length > ScreenCaptureService.MAX_HTML_SIZE) {
      return { success: false, error: 'HTML 크기 제한 초과 (최대 5MB)' };
    }
    let hiddenWin = null;
    const tmpFile = path.join(this._tempDir, '_capture_' + Date.now() + '.html');
    try {
      const w = Math.min(Math.max(Math.round(width), 100), 4000);
      const h = Math.min(Math.max(Math.round(height), 100), 10000);
      hiddenWin = new this._BrowserWindow({
        width: w, height: h, show: false, frame: false,
        useContentSize: true
      });
      const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{margin:0;overflow:hidden;width:' + w + 'px}</style></head><body>' + html + '</body></html>';
      fs.writeFileSync(tmpFile, page, 'utf8');
      await hiddenWin.loadFile(tmpFile);
      await new Promise(r => setTimeout(r, 400));
      const [contentW, contentH] = await hiddenWin.webContents.executeJavaScript(
        '(function(){var el=document.body.firstElementChild;if(!el)return[document.body.scrollWidth,document.body.scrollHeight];var r=el.getBoundingClientRect();return[Math.ceil(r.right),Math.ceil(r.bottom)];})()'
      );
      const img = await hiddenWin.webContents.capturePage({ x: 0, y: 0, width: contentW, height: contentH });
      if (img.isEmpty()) throw new Error('empty image');
      this._clipboard.writeImage(img);
      hiddenWin.close();
      hiddenWin = null;
      this._tryUnlink(tmpFile);
      return { success: true };
    } catch (err) {
      if (hiddenWin) try { hiddenWin.close(); } catch (e) {}
      this._tryUnlink(tmpFile);
      return { success: false, error: err.message };
    }
  }

  /**
   * HTML을 PDF로 렌더링하여 파일로 저장합니다.
   * @param {string} html - 렌더링할 HTML
   * @param {object} [pdfOptions] - printToPDF 옵션 (pageSize, marginsType 등)
   * @param {string} [defaultFileName] - 기본 저장 파일명
   */
  async printToPdf(html, pdfOptions, defaultFileName) {
    /* 단일 호출 경로(가정통신문·연수 등 기존 호출자) — 생성 후 곧바로 저장 다이얼로그.
     * 2단계 분리 구현(printToPdfGenerate/printToPdfSave)의 합성으로 동작 동일 유지 (2026-08-12). */
    const gen = await this.printToPdfGenerate(html, pdfOptions);
    if (!gen.success) return gen;
    return this.printToPdfSave(gen.token, defaultFileName);
  }

  /**
   * [1/2단계] HTML → PDF 버퍼 생성만 수행하고 토큰을 돌려줍니다. (저장 다이얼로그 없음)
   * 렌더러가 진행 카운터를 완주시킨 뒤 printToPdfSave(token) 으로 저장 창을 요청하는 흐름용.
   * (사용자 요청 2026-08-12: "분자가 410/410건이 된 다음에 저장 창이 떠야 한다")
   */
  async printToPdfGenerate(html, pdfOptions) {
    /* PDF 는 전용 상한(30MB) — 보건일지 연간 출력 등 대용량 허용. 캡처 2종(5MB)과 분리 (2026-08-12) */
    if (!html || html.length > ScreenCaptureService.MAX_PDF_HTML_SIZE) {
      return { success: false, error: 'HTML 크기 제한 초과 (최대 30MB)' };
    }
    let pdfWin = null;
    let tmpHtmlPath = null;
    try {
      /* 큰 HTML 은 data URL 길이 제한(플랫폼별 ~2MB) 에 걸려 로드 실패 →
         temp 파일에 저장 후 loadFile 로 열어 안정성 확보 */
      const os = require('os');
      const path = require('path');
      const crypto = require('crypto');
      const tmpName = 'diary-pdf-' + crypto.randomBytes(6).toString('hex') + '.html';
      tmpHtmlPath = path.join(os.tmpdir(), tmpName);
      fs.writeFileSync(tmpHtmlPath, html, 'utf8');
      pdfWin = new this._BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, sandbox: true }
      });
      /* ── 감시 장치 (2026-08-12) — 대용량 문서에서 숨은 창이 죽거나(메모리 부족)
       *  무한 지연되면 이 핸들러가 영원히 응답을 못 돌려주던 문제 방어:
       *  ① render-process-gone 즉시 실패  ② 5분 감시 타임아웃. 어느 쪽이든 반드시 응답. ── */
      const _win = pdfWin;
      const pdfBuffer = await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (msg) => {
          if (settled) return; settled = true;
          clearTimeout(timer);
          reject(new Error(msg));
        };
        const timer = setTimeout(() => {
          fail('PDF 생성 시간 초과(5분) — 기록이 매우 많거나 PC 메모리가 부족합니다');
        }, ScreenCaptureService.PDF_WATCHDOG_MS);
        _win.webContents.on('render-process-gone', (e, details) => {
          fail('PDF 렌더링 중단(' + ((details && details.reason) || 'unknown') + ') — PC 메모리가 부족할 수 있습니다. 다른 프로그램을 닫고 다시 시도해 주세요');
        });
        _win.loadFile(tmpHtmlPath)
          .then(() => new Promise(r => setTimeout(r, 200)))   /* 폰트·이미지 렌더 안정화 대기 */
          .then(() => _win.webContents.printToPDF({
            pageSize: 'A4',
            marginsType: 1,
            printBackground: true,
            ...(pdfOptions || {})
          }))
          .then((buf) => {
            if (settled) return; settled = true;
            clearTimeout(timer);
            resolve(buf);
          })
          .catch((err) => fail((err && err.message) || String(err)));
      });
      try { pdfWin.destroy(); } catch (e) {}
      pdfWin = null;
      this._tryUnlink(tmpHtmlPath);
      tmpHtmlPath = null;
      /* 버퍼 보관 + 토큰 발급 — 저장 다이얼로그는 printToPdfSave 에서 */
      const crypto2 = require('crypto');
      const token = crypto2.randomBytes(12).toString('hex');
      const now = Date.now();
      /* TTL 정리 — 렌더러가 저장 단계를 못 밟은 잔여 버퍼(실패·강제종료 등) 회수 */
      for (const [k, v] of this._pdfStore) {
        if (now - v.ts > 10 * 60 * 1000) this._pdfStore.delete(k);
      }
      this._pdfStore.set(token, { buf: pdfBuffer, ts: now });
      return { success: true, token: token, bytes: pdfBuffer.length };
    } catch (err) {
      /* destroy — 렌더러가 죽은 창은 close() 가 안 먹을 수 있음 (2026-08-12) */
      if (pdfWin) try { pdfWin.destroy(); } catch (e) {}
      if (tmpHtmlPath) this._tryUnlink(tmpHtmlPath);
      return { success: false, error: err.message };
    }
  }

  /**
   * [2/2단계] 보관된 PDF 버퍼(token)를 저장 다이얼로그로 파일에 씁니다.
   * 취소·완료·오류 어느 경우든 버퍼는 보관소에서 제거 (재시도는 재생성부터).
   */
  async printToPdfSave(token, defaultFileName) {
    const entry = this._pdfStore.get(token);
    if (!entry) return { success: false, error: 'PDF 데이터가 만료되었습니다. 다시 시도해 주세요.' };
    this._pdfStore.delete(token);
    try {
      const mainWin = this._getMainWindow();
      const { canceled, filePath } = await this._dialog.showSaveDialog(mainWin, {
        title: 'PDF 저장',
        defaultPath: defaultFileName || 'export.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (canceled || !filePath) return { success: false, error: 'cancelled' };
      fs.writeFileSync(filePath, entry.buf);
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _tryUnlink(filePath) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

module.exports = { NewsletterRenderService, ScreenCaptureService };
