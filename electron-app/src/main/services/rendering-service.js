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
  }

  /** 최대 HTML 크기 (5MB) */
  static MAX_HTML_SIZE = 5 * 1024 * 1024;

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
    if (!html || html.length > ScreenCaptureService.MAX_HTML_SIZE) {
      return { success: false, error: 'HTML 크기 제한 초과 (최대 5MB)' };
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
      await pdfWin.loadFile(tmpHtmlPath);
      /* 폰트·이미지 렌더 안정화 대기 */
      await new Promise(r => setTimeout(r, 200));
      const pdfBuffer = await pdfWin.webContents.printToPDF({
        pageSize: 'A4',
        marginsType: 1,
        printBackground: true,
        ...(pdfOptions || {})
      });
      try { pdfWin.close(); } catch (e) {}
      pdfWin = null;
      this._tryUnlink(tmpHtmlPath);
      tmpHtmlPath = null;
      const mainWin = this._getMainWindow();
      const { canceled, filePath } = await this._dialog.showSaveDialog(mainWin, {
        title: 'PDF 저장',
        defaultPath: defaultFileName || 'export.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (canceled || !filePath) return { success: false, error: 'cancelled' };
      fs.writeFileSync(filePath, pdfBuffer);
      return { success: true, filePath };
    } catch (err) {
      if (pdfWin) try { pdfWin.close(); } catch (e) {}
      if (tmpHtmlPath) this._tryUnlink(tmpHtmlPath);
      return { success: false, error: err.message };
    }
  }

  _tryUnlink(filePath) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

module.exports = { NewsletterRenderService, ScreenCaptureService };
