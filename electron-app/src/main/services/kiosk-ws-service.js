/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * KioskWsService — LAN 직결 WebSocket 서버
 *
 * Electron 메인 프로세스에서 ws 서버를 기동하여
 * 키오스크 태블릿과 실시간 양방향 통신.
 *
 * - 포트: 7329 (기본, 설정 변경 가능)
 * - 키오스크 태블릿 → 교사 PC: 접수 이벤트 (학생 증상 입력 완료)
 * - 교사 PC → 키오스크 태블릿: 호출/상태 업데이트
 * - 민감 데이터는 학교 LAN 내에서만 전송 (외부 서버 경유 없음)
 */

const { WebSocketServer } = require('ws');
const os = require('os');

class KioskWsService {
  constructor() {
    this.wss = null;
    this.port = 7329;
    this.clients = new Set();
    this._onMessage = null; // callback from main process
  }

  /* ── 서버 시작 ── */
  start(port, onMessage) {
    if (this.wss) return Promise.resolve({ success: true, port: this.port, ip: this.getLocalIP() });
    this.port = port || 7329;
    this._onMessage = onMessage || null;
    const self = this;

    return new Promise((resolve) => {
      try {
        self.wss = new WebSocketServer({ port: self.port });

        self.wss.once('listening', () => {
          console.log('[KioskWS] Server started on port', self.port);
          /* 하트비트 — 유령 연결 감지 (30초 간격) */
          self._pingInterval = setInterval(() => {
            self.clients.forEach(ws => {
              if (ws._isAlive === false) { ws.terminate(); self.clients.delete(ws); return; }
              ws._isAlive = false;
              try { ws.ping(); } catch (_) {}
            });
          }, 30000);
          resolve({ success: true, port: self.port, ip: self.getLocalIP() });
        });

        self.wss.once('error', (err) => {
          console.error('[KioskWS] Server error:', err.message);
          self.wss = null;
          resolve({ success: false, error: err.message });
        });

        self.wss.on('connection', (ws, req) => {
          const clientIP = req.socket.remoteAddress || 'unknown';
          console.log('[KioskWS] Client connected:', clientIP);
          ws._isAlive = true;
          self.clients.add(ws);

          ws.on('pong', () => { ws._isAlive = true; });
          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              msg._clientIP = clientIP;
              if (self._onMessage) self._onMessage(msg);
            } catch (e) {
              console.error('[KioskWS] Invalid message:', e.message);
            }
          });
          ws.on('close', () => {
            self.clients.delete(ws);
            console.log('[KioskWS] Client disconnected:', clientIP);
            if (self._onMessage) self._onMessage({ type: 'client-disconnect', _clientIP: clientIP });
          });
          ws.on('error', (err) => {
            console.error('[KioskWS] Client error:', err.message);
            self.clients.delete(ws);
          });
          ws.send(JSON.stringify({ type: 'connected', serverTime: new Date().toISOString() }));
        });
      } catch (err) {
        console.error('[KioskWS] Failed to start:', err.message);
        resolve({ success: false, error: err.message });
      }
    });
  }

  /* ── 서버 종료 ── */
  stop() {
    if (!this.wss) return;
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    this.clients.forEach(ws => { try { ws.close(); } catch (_) {} });
    this.clients.clear();
    this.wss.close();
    this.wss = null;
    console.log('[KioskWS] Server stopped');
  }

  /* ── 모든 클라이언트에 메시지 브로드캐스트 ── */
  broadcast(msg) {
    const data = JSON.stringify(msg);
    this.clients.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try { ws.send(data); } catch (_) {}
      }
    });
  }

  /* ── 연결된 클라이언트 수 ── */
  getClientCount() {
    return this.clients.size;
  }

  /* ── 로컬 사설 IP 주소 ── */
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /* ── 서버 상태 ── */
  getStatus() {
    return {
      running: !!this.wss,
      port: this.port,
      ip: this.getLocalIP(),
      clients: this.getClientCount()
    };
  }
}

module.exports = { KioskWsService };
