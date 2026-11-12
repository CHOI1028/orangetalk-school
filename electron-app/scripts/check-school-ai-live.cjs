'use strict';
// Explicit opt-in smoke check. Reads only the encrypted AI settings, never school records.
const { app, safeStorage, net } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const os = require('node:os');
const { SchoolAiStore } = require('../src/main/services/school-ai-store');
const { SchoolAiService } = require('../src/main/services/school-ai-service');
if (!process.argv.includes('--run')) { console.error('Explicit --run required. Uses the registered personal key.'); app.exit(1); }
const caseArgument = process.argv.find(arg => /^--case=[0-3]$/.test(arg));
const out = path.resolve(__dirname, '../_preview/school-ai/live-report' + (caseArgument ? '-case' + caseArgument.slice(7) : '') + '.json');
const original = path.join(app.getPath('appData'), 'my-health-diary');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ai-live-'));
const localState = path.join(profile, 'Local State');
if (fs.existsSync(path.join(original, 'Local State'))) fs.copyFileSync(path.join(original, 'Local State'), localState);
app.setPath('userData', profile);
function cleanup() {
  if (profile.startsWith(path.join(os.tmpdir(), 'school-ai-live-')) && path.dirname(localState) === profile) {
    try { fs.unlinkSync(localState); } catch (_) {}
  }
}
app.on('will-quit', cleanup);
app.whenReady().then(async () => {
  const store = new SchoolAiStore(original, safeStorage);
  if (!store.status().configured) throw Error('등록된 학교용 키를 확인할 수 없습니다.');
  // Keep the user's file untouched; count smoke-check usage in memory only.
  store.write = () => {};
  const service = new SchoolAiService({ store, fetchImpl: (...args) => net.fetch(...args), getDrugKey: () => '' });
  const questions = [
    '이 프로그램에서 의료기관 탐색 기능은 뭐야?',
    '오늘 점심메뉴 추천해줘',
    '오늘 점심식사 이후 복통을 호소하는 환자가 찾아왔어.',
    '질병관리청의 손씻기 보건교육 공식 자료를 웹에서 찾아 출처와 함께 알려줘'
  ];
  const report = [];
  const caseArg = process.argv.find(arg => arg.startsWith('--case='));
  const selected = caseArg ? [questions[Number(caseArg.slice(7))]].filter(Boolean) : questions;
  for (const question of selected) {
    service.reset(); const response = await service.chat({ message: question });
    report.push({ question, success: response.success, code: response.code, message: response.message,
      answer: response.answer, sources: response.sources, hasSearchSuggestions: !!response.searchSuggestions?.length, usage: response.usage });
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.at(-1)));
  }
  cleanup(); app.exit(report.every(r => r.success) ? 0 : 1);
}).catch(() => { cleanup(); console.error('실제 연결 검사를 완료하지 못했습니다. 키 값은 출력하지 않습니다.'); app.exit(1); });
