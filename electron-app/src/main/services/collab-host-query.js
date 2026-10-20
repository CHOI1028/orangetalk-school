'use strict';
const http = require('node:http');
const net = require('node:net');
const validKey = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const fail = code => ({ success: false, code });
const validPorts = values => [...new Set(Array.from(values || []).filter(p => Number.isInteger(p) && p > 0 && p <= 65535))];
function requestJson(port, pathname, token, timeoutMs) {
  return new Promise(resolve => {
    let done = false, timer, req;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
    try {
      req = http.get({ hostname: '127.0.0.1', port, path: pathname, agent: false,
        headers: { 'X-Orangetalk-Host': token, Accept: 'application/json' } }, res => {
        if (res.statusCode !== 200) {
          res.resume(); finish(fail(res.statusCode === 401 || res.statusCode === 403 ? 'host-auth-failed' : 'http-error')); return;
        }
        let size = 0; const chunks = [];
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) { finish(fail('invalid-response')); res.destroy(); req.destroy(); return; }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); finish({ success: true, data }); }
          catch (_) { finish(fail('invalid-response')); }
        });
        res.on('error', () => finish(fail('connection-failed')));
        res.on('aborted', () => finish(fail('connection-failed')));
      });
      req.on('error', error => finish(fail(error.code === 'ECONNREFUSED' ? 'connection-refused' : 'connection-failed')));
      timer = setTimeout(() => { finish(fail('timeout')); req.destroy(); }, timeoutMs);
    } catch (_) { finish(fail('connection-failed')); }
  });
}
function createCollabHostQuery({ getState, request = requestJson, infoTimeoutMs = 6000, scanTimeoutMs = 20000 }) {
  const pending = new Map();
  async function run(kind) {
    const start = getState();
    if (!start || !start.running) return fail('server-stopped');
    if (!validKey(start.token)) return fail('host-auth-unavailable');
    const ports = validPorts(start.ports);
    if (!ports.length) return fail('server-starting');
    const budget = kind === 'info' ? infoTimeoutMs : scanTimeoutMs;
    const deadline = Date.now() + budget;
    let last = fail('connection-failed');
    for (const port of ports) {
      const current = getState();
      if (!current || !current.running || current.token !== start.token) return fail('server-changed');
      if (!validPorts(current.ports).includes(port)) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return fail('timeout');
      const result = await request(port, kind === 'info' ? '/api/server-info' : '/api/port-scan', start.token,
        Math.min(remaining, kind === 'info' ? 2000 : budget));
      const after = getState();
      if (!after || !after.running || after.token !== start.token || !validPorts(after.ports).includes(port)) return fail('server-changed');
      if (!result || !result.success) { last = result || fail('invalid-response'); continue; }
      const data = result.data;
      if (!data || data.success !== true) { last = fail('invalid-response'); continue; }
      if (kind === 'scan') {
        if (!Array.isArray(data.results)) return fail('invalid-response');
        return { success: true, results: data.results.filter(row => row && Number.isInteger(row.port) && row.port > 0 && row.port <= 65535).slice(0,16).map(row => ({
          port: row.port, status: ['active','available','occupied','denied','error'].includes(row.status) ? row.status : 'error',
          external: { state: row.external && ['pass','stale','pending'].includes(row.external.state) ? row.external.state : 'pending' },
          owner: row.owner && typeof row.owner.processName === 'string' ? { processName: row.owner.processName.slice(0,120) } : null,
          errorCode: typeof row.errorCode === 'string' && /^[A-Z_0-9]{1,40}$/.test(row.errorCode) ? row.errorCode : null
        })) };
      }
      if (!validKey(data.inviteKey)) return fail('invite-key-missing');
      const activePorts = validPorts(data.activePorts).filter(p => validPorts(after.ports).includes(p));
      const ips = Array.isArray(data.ips) ? data.ips.filter(ip => typeof ip === 'string' && net.isIP(ip) === 4 && !ip.startsWith('127.') && ip !== '0.0.0.0').slice(0,16) : [];
      if (!activePorts.length) return fail('invalid-response');
      if (!ips.length) return fail('lan-address-missing');
      return { success: true, ips, activePorts, recommendedPort: activePorts.includes(data.recommendedPort) ? data.recommendedPort : activePorts[0], inviteKey: data.inviteKey };
    }
    return last;
  }
  return function query(kind) {
    if (kind !== 'info' && kind !== 'scan') return Promise.resolve(fail('invalid-request'));
    if (!pending.has(kind)) pending.set(kind, Promise.resolve().then(() => run(kind)).catch(() => fail('connection-failed')).finally(() => pending.delete(kind)));
    return pending.get(kind);
  };
}
function isTrustedCollabSender(event, window) {
  try {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const wc = window.webContents;
    return event.sender === wc && !!event.senderFrame && event.senderFrame === wc.mainFrame &&
      /^file:/i.test(wc.getURL()) && event.senderFrame.url === wc.getURL();
  } catch (_) { return false; }
}
function registerCollabHostHandlers(ipcMain, { getWindow, getState }) {
  const query = createCollabHostQuery({ getState });
  for (const [channel, kind] of [['web-server:connection-info','info'],['web-server:port-scan','scan']]) {
    ipcMain.handle(channel, event => isTrustedCollabSender(event, getWindow()) ? query(kind) : fail('host-only'));
  }
}
module.exports = { createCollabHostQuery, isTrustedCollabSender, registerCollabHostHandlers };
