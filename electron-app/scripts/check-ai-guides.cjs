'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifestFile = path.join(__dirname, 'school-ai-guide-revisions.json');
const hash = value => crypto.createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
function snapshot(guides, read = file => fs.readFileSync(path.join(root, file), 'utf8')) {
  return Object.fromEntries(guides.map(g => [g.id, {
    guide: hash(JSON.stringify(g)),
    sources: Object.fromEntries(g.files.map(file => [file, hash(read(file))]))
  }]));
}
function stale(current, reviewed) {
  return [...new Set([...Object.keys(current), ...Object.keys(reviewed)])]
    .filter(id => JSON.stringify(current[id]) !== JSON.stringify(reviewed[id]));
}
function main(args) {
  const { guides } = require('../src/main/services/school-ai-knowledge');
  const current = snapshot(guides);
  const reviewed = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  if (args[0] === '--review') {
    const ids = args.slice(1);
    if (!ids.length || ids.some(id => !current[id] && !reviewed[id])) throw Error('검토한 안내 ID를 지정하세요. 전체 자동 승인은 지원하지 않습니다.');
    for (const id of ids) { if (current[id]) reviewed[id] = current[id]; else delete reviewed[id]; }
    fs.writeFileSync(manifestFile, JSON.stringify(reviewed, null, 2) + '\n');
  }
  const changed = stale(current, reviewed);
  if (changed.length) throw Error('AI 안내 갱신/검토 필요: ' + changed.join(', ') + '\n연결된 소스와 안내를 확인·수정한 뒤 npm run ai:guides:review -- <검토한 ID들>을 실행하세요.');
  console.log('AI 안내 ' + guides.length + '개: 기능 소스와 검토본 일치');
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { snapshot, stale };
