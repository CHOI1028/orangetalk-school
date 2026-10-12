'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const KEY_FILE = '.shared-web-access.json';
const AGE_SECONDS = 30 * 24 * 60 * 60;
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function loadLinkKey(userDataPath) {
  const file = path.join(userDataPath, KEY_FILE);
  fs.mkdirSync(userDataPath, { recursive: true });
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validKey(value.key)) throw new Error('Invalid shared access configuration');
    return value.key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const key = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, JSON.stringify({ version: 1, key }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') return loadLinkKey(userDataPath); throw error; }
  return key;
}
function loopback(ip) {
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}
function attachHostAuthorization(details, state) {
  if (!state.token || !state.ports || details.webContentsId !== state.webContentsId || !/^file:/i.test(state.pageUrl || '')) return;
  if (details.frame && details.frame.url && !/^file:/i.test(details.frame.url)) return;
  try {
    const url = new URL(details.url);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
    if (!state.ports.has(Number(url.port) || 80) || !url.pathname.startsWith('/api/')) return;
    details.requestHeaders['X-Orangetalk-Host'] = state.token;
  } catch (_) {}
}
function createSharedWebAccess(options) {
  const key = options.linkKey || loadLinkKey(options.userDataPath);
  if (!validKey(key)) throw new Error('Invalid shared access key');
  const hostToken = validKey(options.hostToken) ? options.hostToken : '';
  const now = options.now || Date.now;
  const cookieName = 'ot_school_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  const failed = new Map();
  const sign = text => crypto.createHmac('sha256', key).update('school-shared-v1.' + text).digest('hex');
  const gateHtml = options.gateHtml || fs.readFileSync(path.join(__dirname, '../../../web-server/access.html'), 'utf8');
  function cookieSession(req) {
    const part = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='));
    if (!part) return null;
    const value = part.slice(cookieName.length + 1);
    if (value.length > 512) return null;
    const pieces = value.split('.');
    if (pieces.length !== 2 || !equal(sign(pieces[0]), pieces[1])) return null;
    try {
      const data = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
      if (!/^[a-f0-9]{48}$/.test(data.nonce) || !Number.isFinite(data.exp) || data.exp <= now()) return null;
      return data;
    } catch (_) { return null; }
  }
  function issueCookie(req, res) {
    const encoded = Buffer.from(JSON.stringify({ nonce: crypto.randomBytes(24).toString('hex'), exp: now() + AGE_SECONDS * 1000 })).toString('base64url');
    res.setHeader('Set-Cookie', cookieName + '=' + encoded + '.' + sign(encoded) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + AGE_SECONDS + (req.secure ? '; Secure' : ''));
  }
  function scopedSession(session, incoming) {
    return 'web_' + crypto.createHmac('sha256', key).update(session.nonce + ':' + String(incoming || 'default').slice(0, 160)).digest('hex');
  }
  function middleware(req, res, next) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/') || ['/', '/health_diary.html', '/login.html'].includes(req.path)) res.setHeader('Cache-Control', 'no-store');
    const isHost = !!hostToken && loopback(req.socket.remoteAddress) && equal(req.headers['x-orangetalk-host'], hostToken);
    const origin = req.headers.origin;
    let allowedOrigin = !origin;
    if (origin === 'null') allowedOrigin = loopback(req.socket.remoteAddress) && (isHost || req.method === 'OPTIONS');
    else if (origin) {
      try {
        const from = new URL(origin), target = new URL(req.protocol + '://' + req.headers.host);
        allowedOrigin = from.protocol === target.protocol && from.hostname === target.hostname && !from.username && !from.password;
      } catch (_) { allowedOrigin = false; }
    }
    if (!allowedOrigin) return res.status(403).json({ success: false, code: 'SHARED_ORIGIN_BLOCKED', error: '허용되지 않은 접속 경로입니다.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id, X-Orangetalk-Host');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method === 'POST' && req.path === '/api/shared-access') {
      return express.json({ limit: '4kb', strict: true })(req, res, function(error) {
        if (error) return res.status(400).json({ success: false, error: '연결 주소를 확인해 주세요.' });
        const ip = req.socket.remoteAddress || '';
        const entry = failed.get(ip);
        if (entry && entry.until > now() && entry.count >= 12) return res.status(429).json({ success: false, error: '잠시 후 다시 연결해 주세요.' });
        if (!req.is('application/json') || !validKey(req.body && req.body.key) || !equal(req.body.key, key)) {
          if (failed.size >= 1024 && !failed.has(ip)) failed.delete(failed.keys().next().value);
          const attempt = entry && entry.until > now() ? entry : { count: 0, until: now() + 5 * 60 * 1000 };
          attempt.count++; failed.set(ip, attempt);
          return res.status(401).json({ success: false, code: 'SHARED_ACCESS_REQUIRED', error: '메인 PC에서 보안 연결 주소를 다시 복사해 주세요.' });
        }
        failed.delete(ip); issueCookie(req, res);
        return res.json({ success: true });
      });
    }
    const session = isHost ? null : cookieSession(req);
    if (!isHost && !session) {
      if (req.method === 'GET' && ['/', '/health_diary.html', '/login.html'].includes(req.path)) return res.status(401).type('html').send(gateHtml);
      return res.status(401).json({ success: false, code: 'SHARED_ACCESS_REQUIRED', authRequired: true, error: '보안 연결 주소로 다시 접속해 주세요. 작성 중인 내용은 자동으로 지워지지 않습니다.' });
    }
    req.sharedAccess = { host: isHost };
    if (session) {
      const incoming = req.headers['x-session-id'] || (req.path === '/api/events' && req.query.sid) || '';
      req.headers['x-session-id'] = scopedSession(session, incoming);
    }
    if (!isHost && (req.path === '/api/port-add' || req.path === '/api/port-remove' || req.path === '/api/port-scan')) return res.status(403).json({ success: false, error: '서버 관리는 메인 PC에서 변경해 주세요.' });
    next();
  }
  return { middleware, inviteKeyFor: req => req.sharedAccess && req.sharedAccess.host ? key : '', cookieName };
}
module.exports = { createSharedWebAccess, attachHostAuthorization, loadLinkKey };
