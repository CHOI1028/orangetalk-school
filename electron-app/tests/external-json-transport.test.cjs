'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { preparePublicDataProxyRequest } = require('../src/main/services/public-data-key-store');

// Extract only the production functions: never start Electron/the web server or use real API keys.
const serviceSource = fs.readFileSync(path.join(__dirname, '../src/main/services/external-api-service.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../web-server/server.js'), 'utf8');
const serviceMatch = serviceSource.match(/  async fetchJson\(url, options = \{\}\) \{[\s\S]*?\n  \}/);
const serverMatch = serverSource.match(/  'external-fetch-json': async \(p\) => \{[\s\S]*?\n  \},/);
assert.ok(serviceMatch, 'Production ExternalApiService.fetchJson must be found');
assert.ok(serverMatch, 'Production external-fetch-json web handler must be found');

const implementations = [
  { name: 'Electron', expression: '({' + serviceMatch[0] + '}).fetchJson', input: url => url },
  { name: 'shared web', expression: '({' + serverMatch[0].replace(/,$/, '') + '})["external-fetch-json"]', input: url => ({ url }) }
];

const requestUrl = 'https://apis.data.go.kr/1790387/EIDAPIService/Region?serviceKey=SYNTHETIC_KEY_ONLY';
const safeErrors = {
  timeout: '외부 데이터 요청 시간이 초과되었습니다.',
  network: '외부 데이터 서버에 연결하지 못했습니다.'
};

function harness(implementation, fetchImpl) {
  const calls = [], timeouts = [];
  const signal = { synthetic: true };
  const invoke = vm.runInNewContext(implementation.expression, {
    URL,
    preparePublicDataProxyRequest,
    services: { store: () => ({ get: () => ({ exists: false, data: null }) }) },
    AbortSignal: { timeout(ms) { timeouts.push(ms); return signal; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    }
  });
  return {
    calls, timeouts, signal,
    async run(url = requestUrl) {
      // VM objects have different prototypes. Compare their serialized public IPC contract.
      return JSON.parse(JSON.stringify(await invoke(implementation.input(url))));
    }
  };
}

function response(status, contentType, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return name === 'content-type' ? contentType : null; } },
    text: async () => body
  };
}

function sensitiveFailure(name) {
  const error = new Error('Request failed: ' + requestUrl);
  error.name = name;
  return error;
}

for (const implementation of implementations) {
  for (const fixture of [
    { label: '200 JSON', status: 200, type: 'application/json; charset=utf-8', body: '{"header":{"resultCode":"00"},"body":{"items":[]}}' },
    { label: '403 XML authentication error', status: 403, type: 'application/xml', body: '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>' },
    { label: '503 HTML error', status: 503, type: 'text/html', body: '<html><body>Service unavailable</body></html>' },
    { label: 'missing content type', status: 200, type: null, body: '{}' }
  ]) {
    test(implementation.name + ': preserves body and legacy success for ' + fixture.label, async () => {
      const h = harness(implementation, async () => response(fixture.status, fixture.type, fixture.body));
      assert.deepEqual(await h.run(), {
        success: true, data: fixture.body, status: fixture.status, contentType: fixture.type || ''
      });
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].url, requestUrl);
      assert.equal(h.calls[0].options.headers['User-Agent'], 'OrangePharmDiary/1.0');
      assert.equal(h.calls[0].options.signal, h.signal);
      assert.deepEqual(h.timeouts, [8000]);
    });
  }

  for (const [name, kind] of [['TimeoutError', 'timeout'], ['AbortError', 'timeout'], ['TypeError', 'network']]) {
    test(implementation.name + ': classifies ' + name + ' without exposing the URL or key', async () => {
      const h = harness(implementation, async () => { throw sensitiveFailure(name); });
      const result = await h.run();
      assert.deepEqual(result, { success: false, error: safeErrors[kind], errorKind: kind });
      assert.equal('status' in result, false);
      assert.equal('data' in result, false);
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_KEY_ONLY|https:|serviceKey|Request failed/);
    });
  }

  test(implementation.name + ': also sanitizes a timeout while reading the body', async () => {
    const h = harness(implementation, async () => {
      const result = response(200, 'application/json', '');
      result.text = async () => { throw sensitiveFailure('TimeoutError'); };
      return result;
    });
    assert.deepEqual(await h.run(), { success: false, error: safeErrors.timeout, errorKind: 'timeout' });
  });

  for (const [label, url, error] of [
    ['empty URL', '', 'URL이 없습니다'],
    ['invalid URL', 'not-a-url', '유효하지 않은 URL'],
    ['HTTP', 'http://apis.data.go.kr/data', 'HTTPS 프로토콜만 허용됩니다'],
    ['localhost', 'https://localhost/data', '내부 네트워크 접근이 차단되었습니다'],
    ['loopback IPv4', 'https://127.0.0.1/data', '내부 네트워크 접근이 차단되었습니다'],
    ['loopback IPv6', 'https://[::1]/data', '내부 네트워크 접근이 차단되었습니다'],
    ['private class A', 'https://10.0.0.1/data', '내부 네트워크 접근이 차단되었습니다'],
    ['private class B', 'https://172.16.0.1/data', '내부 네트워크 접근이 차단되었습니다'],
    ['private class C', 'https://192.168.0.1/data', '내부 네트워크 접근이 차단되었습니다']
  ]) {
    test(implementation.name + ': rejects ' + label + ' before fetch', async () => {
      const h = harness(implementation, async () => { throw new Error('Blocked URL must not be fetched'); });
      assert.deepEqual(await h.run(url), { success: false, error });
      assert.equal(h.calls.length, 0);
      assert.equal(h.timeouts.length, 0);
    });
  }
}
