'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { SchoolAiStore, MAX_DAILY_TOKENS } = require('../src/main/services/school-ai-store');
const { SchoolAiService, registerSchoolAi, sanitize, estimate, REFUSAL, MEDICAL_REFUSAL } = require('../src/main/services/school-ai-service');
const { requestGemini, requestBody, readJson } = require('../src/main/services/school-ai-transport');
const { selectGuides, guides } = require('../src/main/services/school-ai-knowledge');
const key = crypto.randomBytes(32);
const protection = { isEncryptionAvailable: () => true,
  encryptString: value => { const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final()]); },
  decryptString: value => { const decipher = crypto.createDecipheriv('aes-256-cbc', key, value.subarray(0, 16)); return Buffer.concat([decipher.update(value.subarray(16)), decipher.final()]).toString(); } };
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ai-test-'));
  t.after(() => { assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'school-ai-test-'))); fs.rmSync(directory, { recursive: true, force: true }); });
  const store = new SchoolAiStore(directory, protection, options.now);
  store.save({ apiKey: 'synthetic-test-key' });
  const calls = [];
  const service = new SchoolAiService({ store, getDrugKey: () => '', fetchImpl: async () => { throw Error('Unexpected external request'); },
    provider: async (_fetch, _key, body) => { calls.push(body); return { text: JSON.stringify({ scope: 'program', action: 'answer', query: '', answer: '보건일지의 일지 출력에서 기간을 선택하세요.' }), tokens: 500 }; }, ...options });
  return { directory, store, service, calls };
}
const result = (scope, action, query, answer) => ({ text: JSON.stringify({ scope, action, query, answer }), tokens: 300 });
function packet(body) {
  const input = body.input;
  const text = typeof input === 'string' ? input : input.filter(item => item.type === 'user_input').at(-1).content[0].text;
  try { return JSON.parse(text); } catch (_) {}
  const marker = text.lastIndexOf('\n참고JSON\n');
  if (marker >= 0) {
    const data = JSON.parse(text.slice(marker + '\n참고JSON\n'.length));
    return { question: text.slice(0, marker).trim(), ...data };
  }
  return { question: text };
}
test('personal key is encrypted, never returned, and survives reload', t => {
  const { directory, store } = fixture(t);
  assert(!fs.readFileSync(store.file, 'utf8').includes('synthetic-test-key'));
  assert(!JSON.stringify(store.status()).includes('synthetic-test-key'));
  assert.equal(new SchoolAiStore(directory, protection).key(), 'synthetic-test-key');
  store.save({ apiKey: '', dailyLimit: 20000 }); assert.equal(store.key(), 'synthetic-test-key');
  store.removeKey(); assert.throws(() => store.key(), /먼저 등록/);
});
test('encryption failures do not downgrade to plaintext', t => {
  const { directory } = fixture(t);
  const store = new SchoolAiStore(directory, { isEncryptionAvailable: () => false });
  assert.throws(() => store.save({ apiKey: 'new-secret', dailyLimit: 10000 }), /안전한 키/);
  assert(!fs.readFileSync(store.file, 'utf8').includes('new-secret'));
});

test('existing limits upgrade automatically without losing keys or daily accounting', t => {
  const { directory, store } = fixture(t);
  const old = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  Object.assign(old, { dailyLimit: 100000, used: 7847, actual: 7847, calls: 6 });
  fs.writeFileSync(store.file, JSON.stringify(old));
  const upgraded = new SchoolAiStore(directory, protection);
  assert.equal(upgraded.status().dailyLimit, MAX_DAILY_TOKENS);
  assert.equal(upgraded.status().used, 7847); assert.equal(upgraded.status().calls, 6);
  assert.equal(upgraded.key(), 'synthetic-test-key');
  upgraded.save({ apiKey: '', dailyLimit: 10000 });
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).dailyLimit, MAX_DAILY_TOKENS);
  assert.equal(new SchoolAiStore(directory, protection).status().used, 7847);
});
test('corrupt store fails closed until explicit registration', t => {
  const { directory, store } = fixture(t); fs.writeFileSync(store.file, '{bad json');
  const broken = new SchoolAiStore(directory, protection);
  assert.equal(broken.status().storageError, true); assert.throws(() => broken.reserve(100), /읽지 못/);
});
test('Korean day rollover and reservations persist independently of conversation and key', t => {
  let now = Date.parse('2026-11-11T14:59:00Z');
  const { store } = fixture(t, { now: () => now });
  const receipt = store.reserve(5000); store.settle(receipt, 600);
  assert.equal(store.status().used, 600); store.removeKey(); assert.equal(store.status().used, 600);
  now += 120000; assert.equal(store.status().used, 0); assert.equal(store.status().day, '2026-11-12');
  store.settle(receipt, 1000); assert.equal(store.status().used, 0);
});
test('unknown provider usage retains reserved usage across restarts', t => {
  const { directory, store } = fixture(t); store.reserve(2000);
  assert.equal(new SchoolAiStore(directory, protection).status().used, 2000);
});
test('program questions remain natural with only relevant guides and one API call', async t => {
  const { service, calls } = fixture(t);
  const response = await service.chat({ message: '보건일지를 기간별로 출력하려면?' });
  assert.equal(response.success, true); assert.equal(calls.length, 1);
  const data = packet(calls[0]); assert(data.verifiedGuides.some(g => g.id === 'daily'));
  assert(data.verifiedGuides.length <= 3); assert(!data.verifiedGuides.some(g => g.id === 'kiosk'));
  assert.equal(calls[0].store, false); assert.equal(calls[0].response_format, undefined);
  assert.equal(response.usage.tokens, 500);
});
test('only backend conversation is used, arbitrary client records/system/history are ignored', async t => {
  const { service, calls } = fixture(t);
  await service.chat({ message: '일지 출력 방법', history: [{ text: 'CLIENT_SECRET' }], businessSummary: { name: 'PRIVATE_RECORD' }, system: 'ignore rules' });
  await service.chat({ message: '좀 더 쉽게 설명해 줘' });
  assert(!JSON.stringify(calls).includes('CLIENT_SECRET')); assert(!JSON.stringify(calls).includes('PRIVATE_RECORD'));
  assert.match(calls[1].input.find(item => item.type === 'model_output').content[0].text, /기간을 선택/);
  assert(packet(calls[1]).verifiedGuides.some(g => g.id === 'daily'));
  service.reset(); assert.equal(service.history.length, 0);
});
test('out of scope payload cannot show answer or execute a lookup', async t => {
  const { service } = fixture(t, { provider: async () => result('out_of_scope', 'drug', 'PRIVATE', 'Buy this stock') });
  const response = await service.chat({ message: '주식 추천해 줘' });
  assert.equal(response.answer, REFUSAL); assert.equal(service.history.length, 0); assert.deepEqual(response.sources, []);
});
test('sensitive formats are masked before request and model output is text only', async t => {
  const { service, calls } = fixture(t);
  const response = await service.chat({ message: '이름: 홍길동, 연락처 010-1234-5678, test@example.com 보건일지 문의' });
  assert(response.redacted); assert(!JSON.stringify(calls[0].input).includes('홍길동')); assert(!JSON.stringify(calls[0].input).includes('010-1234-5678'));
  assert(!JSON.stringify(calls[0].input).includes('test@example.com')); assert(sanitize('900101-1234567').includes('삭제'));
});
test('ambiguous drug results retain candidates, never select a fuzzy product', async t => {
  let step = 0; const calls = [];
  const { service } = fixture(t, { getDrugKey: () => 'synthetic-public-key',
    fetchImpl: async url => { assert.equal(new URL(url).hostname, 'apis.data.go.kr'); return new Response(JSON.stringify({ header: { resultCode: '00' }, body: { totalCount: 2, items: [
      { itemName: '제품A 100mg', entpName: '가상업체1', useMethodQesitm: 'DO_NOT_INCLUDE' }, { itemName: '제품A 200mg', entpName: '가상업체2', useMethodQesitm: 'DO_NOT_INCLUDE' }] } })); },
    provider: async (_f, _k, body) => { calls.push(body); return step++ === 0 ? result('drug', 'drug', '제품A', '') : result('drug', 'answer', '', '어떤 함량과 제조사의 제품인지 확인해 주세요.'); } });
  const response = await service.chat({ message: '제품A의 용법을 알려줘' });
  assert(response.success); assert.equal(calls.length, 2);
  const lookup = packet(calls[1]).lookup; assert.equal(lookup.detailAvailable, false); assert.equal(lookup.items.length, 2);
  assert(!JSON.stringify(calls[1].input).includes('DO_NOT_INCLUDE')); assert(!JSON.stringify(calls[1].input).includes('synthetic-public-key'));
  assert.equal(response.sources.at(-1).kind, 'drug');
});
test('long drug safety text omits all details, never just a warning', async t => {
  const { service } = fixture(t, { getDrugKey: () => 'fake', fetchImpl: async () => new Response(JSON.stringify({
    body: { totalCount: 1, items: [{ itemName: '제품B', efcyQesitm: '효능', atpnQesitm: '주의'.repeat(3000) }] } })) });
  const lookup = await service.drug('제품B', new AbortController().signal);
  assert.equal(lookup.detailAvailable, false); assert(!lookup.items[0].sections); assert.match(lookup.note, /전체를 제외/);
});
test('drug failure returns no invented official source; identifiers cannot become outbound queries', async t => {
  let step = 0;
  const { service } = fixture(t, { provider: async () => step++ === 0 ? result('drug', 'drug', '제품A', '') : result('drug', 'answer', '', '식약처 연결을 확인해 주세요.') });
  const response = await service.chat({ message: '제품A 용법' });
  assert(response.success); assert(!response.sources.some(s => s.kind === 'drug'));
  await assert.rejects(() => service.drug('010-1234-5678', new AbortController().signal), /개인정보/);
});
test('missing guide can be fetched on demand within two calls', async t => {
  let step = 0;
  const { service, store } = fixture(t, { provider: async () => step++ === 0 ? result('program', 'guide', 'backup', '') : result('program', 'answer', '', '환경설정의 백업과 삭제를 확인하세요.') });
  const response = await service.chat({ message: '다른 컴퓨터로 옮기는 방법' });
  assert(response.success); assert.equal(store.status().calls, 2); assert(response.sources.some(s => s.title === '백업과 데이터 이전'));
});
test('malformed and incomplete output fails closed without remembering it', async t => {
  const { service } = fixture(t, { provider: async () => ({ text: '<script>evil</script>', tokens: 100 }) });
  const response = await service.chat({ message: '보건업무 안내' });
  assert.equal(response.code, 'FORMAT'); assert.equal(service.history.length, 0);
});
test('daily budget stops network dispatch, input over limit is not silently truncated', async t => {
  const { service, store, calls } = fixture(t);
  store.reserve(MAX_DAILY_TOKENS - 1);
  assert.equal((await service.chat({ message: '보건일지 안내' })).code, 'DAILY_LIMIT'); assert.equal(calls.length, 0);
  assert.equal((await service.chat({ message: '가'.repeat(2001) })).code, 'INPUT');
});
test('concurrency guard and cancelled responses cannot reappear in history', async t => {
  let resolve;
  const { service } = fixture(t, { provider: () => new Promise(r => { resolve = r; }) });
  const pending = service.chat({ message: '보건일지 출력 방법' });
  assert.equal((await service.chat({ message: '또 질문' })).code, 'BUSY');
  service.reset(); resolve(result('program', 'answer', '', 'late answer'));
  assert.equal((await pending).code, 'CANCELLED'); assert.equal(service.history.length, 0);
});
test('transport preserves key only in header, records tokens and rejects partial output', async () => {
  const body = requestBody('question', 'system', null, 50); let capture;
  const fetchImpl = async (url, options) => { capture = { url, options }; return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'OK' }] }], usage: { total_tokens: 42 } })); };
  assert.equal((await requestGemini(fetchImpl, 'secret-key', body, new AbortController().signal)).tokens, 42);
  assert.equal(capture.options.headers['x-goog-api-key'], 'secret-key'); assert(!capture.url.includes('secret-key')); assert(!capture.options.body.includes('secret-key'));
  await assert.rejects(() => requestGemini(async () => new Response(JSON.stringify({ status: 'incomplete', usage: { total_tokens: 50 } })), 'key', body, new AbortController().signal), e => e.code === 'INCOMPLETE' && e.tokens === 50);
});
test('a transient server error is retried once', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response('temporary', { status: 503 });
    return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'OK' }] }], usage: { total_tokens: 4 } }));
  };
  assert.equal((await requestGemini(fetchImpl, 'key', {}, new AbortController().signal)).text, 'OK');
  assert.equal(calls, 2);
});
test('429 is not retried, upstream secret-bearing error body never leaks', async () => {
  let calls = 0;
  await assert.rejects(() => requestGemini(async () => { calls++; return new Response('secret-key echoed', { status: 429, headers: { 'Retry-After': '120' } }); }, 'key', {}, new AbortController().signal), e => e.code === 'QUOTA' && e.retryAfterMs === 120000 && !e.message.includes('secret-key'));
  assert.equal(calls, 1);
});
test('response reading has a hard byte bound', async () => {
  await assert.rejects(() => readJson(new Response('x'.repeat(30)), 20), /너무 큽니다/);
});
test('only the exact main teacher frame may access AI IPC', async t => {
  const { directory } = fixture(t); const handlers = {};
  const frame = { url: pathToFileURL(path.resolve(__dirname, '../health_diary.html')).href };
  const contents = { mainFrame: frame }; const win = { webContents: contents };
  registerSchoolAi({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, app: { getPath: () => directory }, safeStorage: protection, net: { fetch: () => { throw Error(); } }, getMainWindow: () => win, getDrugKey: () => '' });
  const status = handlers['school-ai:status'];
  assert.equal((await status({ sender: contents, senderFrame: frame })).success, true);
  assert.equal((await status({ sender: contents, senderFrame: { url: frame.url } })).code, 'ACCESS');
  frame.url = 'https://example.com/health_diary.html'; assert.equal((await status({ sender: contents, senderFrame: frame })).code, 'ACCESS');
});
test('knowledge entries reference existing files and retrieval never returns all manuals', () => {
  for (const guide of guides) for (const file of guide.files) assert(fs.existsSync(path.join(__dirname, '..', file)), file);
  assert(selectGuides('학생 일지 약품 백업 통계 키오스크 설정').length <= 3);
});

test('specific current features are found despite spacing and general menu words', () => {
  const cases = [
    ['매직스테이션에서 설문지작성기능은 무슨 기능이야?', 'survey-create'],
    ['설문 통계 보는 법', 'survey-results'],
    ['설문 QR 링크 만들기', 'survey-publish'],
    ['설문을 이 PC에 저장하면 배포되는 거야?', 'survey-publish'],
    ['연수 이수 현황에서 이수번호 입력은?', 'training-status'],
    ['오렌지톡 프로그램의 기본적인 사용방법을 알려줘', 'overview'],
    ['이 AI를 활용해서 뭘 할 수 있는 거야?', 'ai-help'],
    ['매직 스테이션에서 일정과 할 일은 어디 있어?', 'home'],
    ['이 프로그램에서 대시보드는 무슨 역할을 하지?', 'home'],
    ['나이스 시간표를 연결하려면?', 'school-api']
  ];
  for (const [question, id] of cases) assert(selectGuides(question).some(g => g.id === id), question);
  assert.equal(selectGuides('설문 통계 보는 법')[0].id, 'survey-results');
  assert(selectGuides('그럼 순서대로 알려줘', '설문 만들기').some(g => g.id === 'survey-create'));
  assert.equal(selectGuides('약속 잡아줘').length, 0);
});

test('reported survey question gets actual editor steps, not stale planner-only guidance', async t => {
  const { service, calls } = fixture(t);
  assert((await service.chat({ message: '매직스테이션에서 설문지작성기능은 무슨 기능이야?' })).success);
  const data = packet(calls[0]);
  assert(data.verifiedGuides.some(g => g.id === 'survey-create' && g.text.includes('반/학생 선택') && g.text.includes('미리보기 & 설문 생성 완료')));
  assert.equal(data.guideIndex, undefined);
  assert(!JSON.stringify(data.verifiedGuides).includes('매직 스테이션은 일정·루틴'));
  assert.equal(calls.length, 1); assert(data.verifiedGuides.length <= 3);
});

test('medical facility question retrieves the existing feature ahead of generic overview', async t => {
  const question = '이 프로그램에서 의료기관 탐색 기능은 뭐야?';
  assert.equal(selectGuides(question)[0].id, 'medical-facilities');
  const { service, calls } = fixture(t);
  assert((await service.chat({ message: question })).success);
  const data = packet(calls[0]);
  const facts = data.verifiedGuides.find(g => g.id === 'medical-facilities');
  assert(facts); assert.match(facts.text, /의료기관 탐색 기능이 있다/);
  assert.match(facts.text, /보건일지 → 일반 일지/); assert.match(facts.text, /병원·약국·응급실/);
  assert.equal(calls.length, 1);
});

test('expanded guides stay bounded for long questions, followups and an additional guide', async t => {
  const bodies = []; let lookup = false;
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(body); assert(estimate(JSON.stringify(body)) <= 9000);
    if (lookup && !packet(body).lookup) return result('program', 'guide', 'survey-results', '');
    return result('program', 'answer', '', '설문 편집을 안내합니다. '.repeat(35));
  } });
  for (let n = 0; n < 4; n++) assert((await service.chat({ message: '설문 작성과 온라인 게시 방법을 알려줘' })).success);
  lookup = true;
  const question = '설문 통계와 온라인 게시, 설문 만들기. '.repeat(150).slice(0, 2000);
  const response = await service.chat({ message: question });
  assert(response.success, JSON.stringify(response)); assert.equal(bodies.length, 6);
  for (const body of bodies.slice(-2)) assert.equal(packet(body).question, question.trim());
  assert(response.sources.some(g => g.title.includes('설문 응답')));
});

test('casual conversation does not send manuals or inherit program citations', async t => {
  const captured = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    captured.push(body); return result('casual', 'answer', '', '오늘은 비빔밥이나 샌드위치 어떠세요?');
  } });
  service.history.push({ question: '설문 작성 방법', answer: '설문 편집을 여세요.' });
  const response = await service.chat({ message: '오늘 점심 뭐 먹을까?' });
  assert(response.success); assert.deepEqual(response.sources, []);
  const input = packet(captured[0]);
  assert.deepEqual(input.verifiedGuides, []); assert.equal(input.guideIndex, undefined);
  assert.equal(captured[0].input.find(item => item.type === 'model_output').content[0].text, '설문 편집을 여세요.');
  assert.equal(captured[0].generation_config.max_output_tokens, 512);
  assert.equal(response.contextOmitted, false);
});

test('clinical intent is refused after semantic assessment, not remembered or looked up', async t => {
  let calls = 0;
  const { service } = fixture(t, { provider: async () => { calls++; return result('medical_advice', 'answer', '', ''); } });
  for (const message of ['학생이 열이 나는데 어떤 약을 줘?', '몇 알 먹이면 돼?', '진단해줘', '등교시켜도 괜찮을까?']) {
    assert.equal((await service.chat({ message })).answer, MEDICAL_REFUSAL);
  }
  assert.equal(calls, 4); assert.equal(service.history.length, 0);
});

test('medical classification blocks even a provider-requested drug lookup', async t => {
  const { service, calls } = fixture(t, { provider: async () => result('medical_advice', 'drug', '제품A', '위험한 권고') });
  let lookups = 0; service.drug = async () => { lookups++; throw Error('Must not look up'); };
  const response = await service.chat({ message: '이 상황은 어떻게 해야 할까요?' });
  assert.equal(response.answer, MEDICAL_REFUSAL); assert.equal(lookups, 0);
  assert.equal(service.history.length, 0); assert.deepEqual(response.sources, []);
});

test('clinical recommendation is suppressed even if provider labels it educational', async t => {
  const { service } = fixture(t, { provider: async () => result('health', 'answer', '', '2정을 복용하세요.') });
  assert.equal((await service.chat({ message: '일반 교육자료를 설명해줘' })).answer, MEDICAL_REFUSAL);
  assert.equal(service.history.length, 0);
});

test('guide freshness detects changed sources, changed guidance, additions and removals', () => {
  const { snapshot, stale } = require('../scripts/check-ai-guides.cjs');
  const fixtureGuides = [{ id: 'memo', files: ['memo.js'], text: '저장 후 닫기' }];
  const baseline = snapshot(fixtureGuides, () => 'source\r\n');
  assert.deepEqual(stale(snapshot(fixtureGuides, () => 'source\n'), baseline), []);
  assert.deepEqual(stale(snapshot(fixtureGuides, () => 'new source'), baseline), ['memo']);
  assert.deepEqual(stale(snapshot([{ ...fixtureGuides[0], text: '새 안내' }], () => 'source\n'), baseline), ['memo']);
  assert.deepEqual(stale({}, baseline), ['memo']);
  assert.deepEqual(stale(baseline, {}), ['memo']);
});

test('educational medicine questions and quoted label wording are not keyword-blocked', async t => {
  const bodies = [];
  const educational = '교육자료에는 “임의로 약을 추천하지 마세요”라고 안내하고, 설명서의 “2정을 복용하세요”는 인용문임을 구분하세요.';
  const { service } = fixture(t, { provider: async (_f, _k, body) => { bodies.push(body); return result('health', 'answer', '', educational); } });
  const questions = ['학생 대상 약 추천을 조심해야 하는 이유 교육안', '학생의 두통과 복통 증상 기록 방법을 설명하는 교육자료',
    '약품 설명서에서 몇 알 먹는다는 용법 항목은 무엇이야?', '처방해달라고 요구하지 말라는 교육 문구를 만들어줘'];
  for (const message of questions) {
    const response = await service.chat({ message });
    assert.equal(response.answer, educational); assert.deepEqual(response.sources, []);
  }
  assert.equal(bodies.length, questions.length);
});

test('mixed question retains safe education while app adds the clinical boundary', async t => {
  const { service } = fixture(t, { provider: async () => ({ text: JSON.stringify({ scope: 'health', action: 'answer', query: '',
    medicalBoundary: true, answer: '해열제는 체온을 낮추는 작용을 설명하는 용어입니다.' }), tokens: 200 }) });
  const response = await service.chat({ message: '해열제 개념을 알려주고 이 아이에게 어떤 약을 줄지 정해줘' });
  assert.match(response.answer, /해열제는/); assert.match(response.answer, /의료진이나 약사/);
  assert(!response.answer.includes('진단·약 선택·복용량·처치 결정 등'));
});

test('drug followups reuse official context in one model call without fetching again', async t => {
  let modelCalls = 0, fetches = 0, now = Date.now(); const bodies = [];
  const { service } = fixture(t, { now: () => now, getDrugKey: () => 'fake',
    fetchImpl: async () => { fetches++; return new Response(JSON.stringify({ body: { totalCount: 1, items: [
      { itemName: '제품C', entpName: '가상제조사', atpnQesitm: '공식 주의사항', seQesitm: '공식 이상반응' }] } })); },
    provider: async (_f, _k, body) => { bodies.push(packet(body)); modelCalls++;
      return modelCalls === 1 ? result('drug', 'drug', '제품C', '') : result('drug', 'answer', '', '공식 제품 자료에 기재된 정보를 설명합니다.'); }
  });
  assert((await service.chat({ message: '제품C 공식 설명서를 알려줘' })).success);
  const followup = await service.chat({ message: '그 약의 부작용은?' });
  assert(followup.success); assert.equal(modelCalls, 3); assert.equal(fetches, 1);
  assert.equal(bodies[2].lookup.query, '제품C'); assert.equal(bodies[2].lookup.items[0].sections.seQesitm, '공식 이상반응');
  assert(followup.sources.some(s => s.kind === 'drug'));
  now += 600001;
  await service.chat({ message: '그 약의 주의사항은?' });
  assert(!bodies.at(-1).lookup); // Expired data cannot be presented as a fresh lookup.
  service.reset(); await service.chat({ message: '그 약의 부작용은?' });
  assert(!bodies.at(-1).lookup);
});

test('two requested program topics fit a single followup lookup round', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(packet(body)); return bodies.length === 1 ? result('program', 'guide', 'survey-create,survey-publish', '') :
      result('program', 'answer', '', '설문 작성 후 온라인 게시를 진행하세요.');
  } });
  const response = await service.chat({ message: '새 조사 양식을 만들고 배포하는 순서를 알려줘' });
  assert(response.success); assert.equal(bodies.length, 2); assert.equal(bodies[1].lookup.guides.length, 2);
  assert(response.sources.some(s => s.title.includes('온라인 게시')));
});

test('bundled UI provides feature evidence and excludes commented or scripted content', () => {
  const { extract, getUiEvidence } = require('../src/main/services/school-ai-ui-evidence');
  const rows = extract('<button>실제 버튼</button><!-- <button>숨긴 기능</button> --><script>"<button>코드 속 버튼</button>"</script>', '테스트');
  assert.deepEqual(rows.map(row => row.label), ['실제 버튼']);
  assert(getUiEvidence('이 프로그램에서 의료기관 탐색 기능은 뭐야?').some(row => row.label.includes('의료기관 탐색')));
  assert(getUiEvidence('열 필드 설정이 뭐야?').some(row => row.label.includes('열 필드 설정')));
});

test('a situation statement can continue conversationally without a forced refusal', async t => {
  const { service, calls } = fixture(t, { provider: async () => result('school_health', 'answer', '',
    '점심 이후 복통을 호소하며 방문했군요. 보건일지에 남길 문장으로 정리해 드릴까요?') });
  const response = await service.chat({ message: '오늘 점심식사 이후 복통을 호소하는 환자가 찾아왔어' });
  assert(response.success); assert(!response.answer.includes('제공하지 않습니다'));
  assert.equal(service.history.length, 1);
});

function grounded(text = '공식 교육자료에서 확인한 내용입니다.') {
  return { text, tokens: 300, steps: [
    { type: 'google_search_result', result: [{ search_suggestions: '<div><a href="https://www.google.com/search?q=education">Google 검색</a></div>' }] },
    { type: 'model_output', content: [{ type: 'text', text, annotations: [{ type: 'url_citation', title: '질병관리청', url: 'https://www.kdca.go.kr/' }] }] }
  ] };
}
test('official web lookup stays on the first call and retains attribution', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => { bodies.push(body); return grounded(); } });
  service.history.push({ question: 'PRIVATE_PAST', answer: 'PRIVATE_ANSWER', scope: 'health' });
  const response = await service.chat({ message: '최신 손씻기 공식 교육자료 찾아줘' });
  assert(response.success); assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].tools, [{ type: 'google_search' }]); assert(!bodies[0].response_format);
  assert(response.sources.some(source => source.kind === 'web')); assert.equal(response.searchSuggestions.length, 1);
  assert.equal(service.history.at(-1).answer, '공식 교육자료에서 확인한 내용입니다.');
  assert.equal(service.history.at(-1).web, true);
});
test('clinical intent cannot invoke web search; sensitive search queries fail before search dispatch', async t => {
  let count = 0;
  const clinical = fixture(t, { provider: async () => { count++; return result('medical_advice', 'web', '환자 처방', ''); } });
  assert.equal((await clinical.service.chat({ message: '이 학생의 진단을 정해줘' })).answer, MEDICAL_REFUSAL);
  assert.equal(count, 1);
  const sensitive = fixture(t, { provider: async () => { count++; return result('health', 'web', '010-1234-5678 환자', ''); } });
  assert.equal((await sensitive.service.chat({ message: '공식 정보 찾아줘' })).code, 'SEARCH_QUERY'); assert.equal(count, 2);
});
test('ungrounded web answer is not presented as sourced and unsafe citation URLs are excluded', () => {
  const { searchResult, publicUrl } = require('../src/main/services/school-ai-search');
  assert.throws(() => searchResult({ text: '확인했다고 주장', steps: [] }), /검색 출처/);
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'https://127.0.0.1/x', 'https://user:password@example.org/']) assert.equal(publicUrl(url), '');
  assert.equal(searchResult(grounded()).sources.length, 1);
});

test('a product ingredient question is answered even when the official lookup has no ingredient', async t => {
  const advice = '타이레놀의 주성분은 아세트아미노펜입니다. 해열과 진통 작용이 있는 일반 참고입니다. 제품·함량별 용법은 공식 설명서를 확인해 주세요.';
  let step = 0; const calls = [];
  const { service } = fixture(t, { getDrugKey: () => 'synthetic-public-key',
    fetchImpl: async url => { assert.equal(new URL(url).hostname, 'apis.data.go.kr'); return new Response(JSON.stringify({ header: { resultCode: '00' }, body: { totalCount: 2, items: [
      { itemName: '타이레놀정 500mg', entpName: '가상업체1' }, { itemName: '어린이타이레놀현탁액', entpName: '가상업체2' }] } })); },
    provider: async (_f, _k, body) => { calls.push(body); step++; return step < 3 ? result('drug', 'drug', '타이레놀', '') : result('health', 'answer', '', advice); } });
  const response = await service.chat({ message: '타이레놀 성분에 대해서 알려줘' });
  assert.equal(response.answer, advice); assert.equal(calls.length, 3);
  assert.match(calls[2].system_instruction, /성분명과 대표적인 작용/);
  assert.equal(packet(calls[2]).lookup.items.length, 2);
  let attempts = 0;
  const dose = fixture(t, { provider: async () => { attempts++; return result('medical_advice', 'answer', '', ''); } });
  assert.equal((await dose.service.chat({ message: '타이레놀 몇 알 먹이면 돼?' })).answer, MEDICAL_REFUSAL);
  assert.equal(attempts, 1);
});

test('a comfort question gets general coping steps, while a drug request stays refused', async t => {
  const bodies = [];
  const advice = '식사 후 복통과 메스꺼움이 있으시군요. 안정을 취하고 배를 따뜻하게 하세요. 속이 진정될 때까지 음식은 피하고, 지속되면 진료를 받아 보세요.';
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(body); return bodies.length === 1 ? result('medical_advice', 'answer', '', '') : result('health', 'answer', '', advice);
  } });
  const response = await service.chat({ message: '점심식사 이후에 복통이랑 메스꺼움증세가 나는데 어떻게 하면 좋을까' });
  assert.equal(response.answer, advice); assert.equal(bodies.length, 2);
  assert.equal(bodies[1].generation_config.max_output_tokens, 768);
  let attempts = 0;
  const clinical = fixture(t, { provider: async () => { attempts++; return result('medical_advice', 'answer', '', ''); } });
  assert.equal((await clinical.service.chat({ message: '복통인데 어떤 약을 줘야 해?' })).answer, MEDICAL_REFUSAL);
  assert.equal(attempts, 1);
});

test('over-refusal of a situation statement gets one non-clinical repair, clinical requests do not', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(body); return bodies.length === 1 ? result('medical_advice', 'answer', '', '') :
      result('school_health', 'answer', '', '점심 이후 복통을 호소하며 방문했군요. 일지 문장으로 정리해 드릴까요?');
  } });
  assert((await service.chat({ message: '오늘 점심식사 이후 복통을 호소하는 환자가 찾아왔어' })).answer.includes('일지 문장'));
  assert.equal(bodies.length, 2); assert(!bodies[1].tools);
  let attempts = 0;
  const clinical = fixture(t, { provider: async () => { attempts++; return result('medical_advice', 'answer', '', ''); } });
  assert.equal((await clinical.service.chat({ message: '복통 환자가 찾아왔는데 어떤 약을 줘야 해?' })).answer, MEDICAL_REFUSAL);
  assert.equal(attempts, 1);
});

test('429 reports a short per-minute delay from the body and does not echo it', async () => {
  const payload = { error: { details: [
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '5s' },
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateContentRequestsPerMinute', quotaMetric: 'generate_content_requests' }] }
  ], message: 'secret-project-quota' } };
  await assert.rejects(() => requestGemini(async () => new Response(JSON.stringify(payload), { status: 429 }), 'key', {}, new AbortController().signal),
    error => error.code === 'QUOTA' && error.retryAfterMs === 5000 && error.quotaPeriod === 'minute' && error.message.includes('분당 요청 한도') && error.message.includes('5초') && error.message.includes('하루 사용량') && !error.message.includes('secret-project'));
});

test('429 reports a daily quota separately from a per-minute pause', async () => {
  const payload = { error: { details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDay' }] }
  ] } };
  await assert.rejects(() => requestGemini(async () => new Response(JSON.stringify(payload), { status: 429 }), 'key', {}, new AbortController().signal),
    error => error.code === 'QUOTA' && error.quotaPeriod === 'day' && error.retryAfterMs === undefined && error.message.includes('하루'));
});

test('quota rejection releases the reserved tokens and waits only for the returned delay', async t => {
  let now = 1000000; let calls = 0;
  const { service, store } = fixture(t, { now: () => now, provider: async () => {
    calls++;
    throw Object.assign(new Error('Gemini 분당 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'), { code: 'QUOTA', safeAiError: true, retryAfterMs: 5000, quotaPeriod: 'minute' });
  } });
  const first = await service.chat({ message: '보건일지 출력 방법' });
  assert.equal(first.code, 'QUOTA'); assert.equal(store.status().used, 0); assert.equal(calls, 1);
  now += 1000;
  const waiting = await service.chat({ message: '설문 만드는 방법' });
  assert.equal(waiting.code, 'QUOTA'); assert.match(waiting.message, /초 후/); assert.equal(calls, 1);
  now += 5000;
  await service.chat({ message: '다시 물어봐' });
  assert.equal(calls, 2); assert.equal(store.status().used, 0);
});

test('a short reply stays on the casual thread without program manuals', async t => {
  const captured = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    captured.push(body); return result('casual', 'answer', '', '오늘은 비빔밥이나 샌드위치 어떠세요?');
  } });
  assert((await service.chat({ message: '오늘 점심 뭐 먹을까?' })).success);
  assert((await service.chat({ message: '아니 없어' })).success);
  const second = packet(captured[1]);
  assert.deepEqual(second.verifiedGuides, []); assert.equal(second.guideIndex, undefined);
  assert.equal(captured[1].input.find(item => item.type === 'model_output').content[0].text, '오늘은 비빔밥이나 샌드위치 어떠세요?');
  assert.match(second.conversationIntent, /일상/);
  assert.equal(captured[1].generation_config.max_output_tokens, 512);
});

test('a situation statement does not carry the program catalog', async t => {
  const captured = [];
  const { service } = fixture(t, { provider: async (_fetch, _key, body) => {
    captured.push(body); return result('school_health', 'answer', '', '방문했군요. 일지 문장으로 정리해 드릴까요?');
  } });
  assert((await service.chat({ message: '오늘 점심식사 이후 복통을 호소하는 환자가 찾아왔어' })).success);
  const data = packet(captured[0]);
  assert.equal(data.guideIndex, undefined); assert.deepEqual(data.verifiedGuides, []);
  assert.match(data.conversationIntent, /상황/);
});

test('bundled quick prompts answer from guides without a model call', async t => {
  const { service, calls } = fixture(t);
  const response = await service.chat({ message: '이 프로그램의 주요 기능을 쉽게 설명해 줘' });
  assert.equal(calls.length, 1);
  assert(packet(calls[0]).verifiedGuides.some(guide => guide.id === 'overview'));
  assert.match(response.answer, /기간을 선택|보건일지/);
});

test('an incomplete web search keeps a bounded answer instead of failing the turn', async t => {
  const { service } = fixture(t, { provider: async () => ({ text: JSON.stringify({ scope: 'health', action: 'web', query: '손씻기 교육', answer: '' }), tokens: 20, steps: [] }) });
  const response = await service.chat({ message: '최신 손씻기 교육자료를 확인해 줘' });
  assert.equal(response.success, true); assert.match(response.answer, /확인하지 못했습니다/); assert.deepEqual(response.sources, []);
});

test('program help and small talk skip search, while weather still searches', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(body);
    if (typeof body.input === 'string') return grounded('서울은 흐리고 비가 올 수 있습니다.');
    const question = packet(body).question;
    if (question.includes('출력')) return result('program', 'web', '오렌지톡 매뉴얼', '보건일지에서 기간을 골라 출력합니다.');
    if (question.includes('고마워')) return result('casual', 'web', '감사 인사', '천만에요. 필요한 이야기를 이어서 해 주세요.');
    return grounded('서울은 흐리고 비가 올 수 있습니다.');
  } });
  const program = await service.chat({ message: '보건일지 출력 방법' });
  assert.equal(bodies.length, 1); assert.match(program.answer, /기간을 골라 출력/);
  const thanks = await service.chat({ message: '고마워' });
  assert.equal(bodies.length, 2); assert.match(thanks.answer, /천만에요/);
  assert(bodies.every(body => !body.tools));
  const weather = await service.chat({ message: '오늘 서울 날씨 알려줘' });
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].tools[0].type, 'google_search');
  assert.match(weather.answer, /서울은 흐리고/);
});

test('quick prompts reach Gemini with the matching guides', async t => {
  const { service, calls } = fixture(t);
  const survey = await service.chat({ message: '설문을 만들어 QR로 배포하는 방법을 알려 줘' });
  assert.equal(survey.local, undefined); assert.equal(calls.length, 1);
  assert(packet(calls[0]).verifiedGuides.some(guide => guide.id === 'survey-create'));
  const draft = await service.chat({ message: '초등학생 손 씻기 보건교육 안내문을 작성해 줘' });
  assert.equal(draft.local, undefined); assert.equal(calls.length, 2);
});

test('a bundled answer does not change history while another answer is in flight', async t => {
  let resolve;
  const { service } = fixture(t, { provider: () => new Promise(r => { resolve = r; }) });
  const pending = service.chat({ message: '보건일지 출력 방법' });
  const local = await service.chat({ message: '이 프로그램의 주요 기능을 쉽게 설명해 줘' });
  assert.equal(local.code, 'BUSY'); assert.equal(service.history.length, 0);
  service.reset(); resolve(result('program', 'answer', '', 'late answer'));
  assert.equal((await pending).code, 'CANCELLED'); assert.equal(service.history.length, 0);
});

test('a located weather question searches on the same call and does not send a second request', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(body);
    return result('casual', 'answer', '', '외부 인터넷이 연동되어 있지 않아요.');
  } });
  const response = await service.chat({ message: '오늘 경기도 남양주시 날씨를 알려줘' });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tools[0].type, 'google_search');
  assert.match(packet(bodies[0]).conversationIntent, /날씨/);
  assert.doesNotMatch(response.answer, /인터넷/);
  assert.match(response.answer, /확인하지 못했습니다/);
  assert.equal(response.contextOmitted, false);
});

test('weather without a region asks for the place instead of searching', async t => {
  let calls = 0;
  const { service } = fixture(t, { provider: async () => { calls++; return result('casual', 'answer', '', '실시간 날씨를 조회할 수 없습니다.'); } });
  const response = await service.chat({ message: '오늘 날씨 알려줘' });
  assert.equal(calls, 1);
  assert.match(response.answer, /어느 지역/);
});

test('a current infectious-disease question searches on the same call', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => {
    bodies.push(body);
    return grounded('질병관리청 발생현황에서 이번 절기 인플루엔자 의사환자 분율이 올랐습니다.');
  } });
  const response = await service.chat({ message: '올해에 발병률이 높고 가장 위험한 감염병이 뭐야?' });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tools[0].type, 'google_search');
  assert.match(response.answer, /인플루엔자/);
  assert(response.sources.some(source => source.kind === 'web'));
});

test('an API key question stays on the product guide after casual talk', async t => {
  const bodies = [];
  const { service } = fixture(t, { provider: async (_f, _k, body) => { bodies.push(body); return result('program', 'answer', '', '환경설정에서 등록하는 접속 자격입니다.'); } });
  service.history.push({ question: '오늘 점심 뭐 먹을까?', answer: '샌드위치 어떠세요?', scope: 'casual' });
  const response = await service.chat({ message: 'api키가 무슨 뜻이야?' });
  const data = packet(bodies[0]);
  assert(data.verifiedGuides.some(guide => guide.id === 'settings'));
  assert.match(data.conversationIntent, /로그인 비밀번호가 아니다/);
  assert.match(response.answer, /환경설정/);
  assert.equal(response.contextOmitted, false);
});
