'use strict';
const fs = require('node:fs'), path = require('node:path');
// Only bundled static UI files. Never read the user's DOM, settings or records.
const UI_FILES = [
  ['src/renderer/views/view-daily.html', '보건일지'],
  ['src/renderer/views/view-magic.html', '매직 스테이션'],
  ['src/renderer/views/magic-sub-survey.html', '매직 스테이션 → 설문 리스트 & 에디터'],
  ['src/renderer/views/view-dashboard.html', '방문 통계']
];
const clean = text => text.replace(/<svg\b[\s\S]*?<\/svg>/gi, '').replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const normalize = text => text.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
function extract(html, location) {
  const safe = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const nodes = [...safe.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi),
    ...safe.matchAll(/<div\b([^>]*class="[^"]*tab[^"]*"[^>]*)>([^<]+)<\/div>/gi)];
  return nodes.map(([, attrs, body]) => ({ label: clean(body), location,
    description: clean(attrs.match(/data-tooltip="([^"]*)"/)?.[1] || '') }))
    .filter(item => normalize(item.label).length >= 2 && item.label.length < 60);
}
let inventory;
function getUiEvidence(question) {
  if (!inventory) inventory = UI_FILES.flatMap(([file, location]) => {
    try { return extract(fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8'), location); }
    catch (_) { return []; }
  });
  const query = normalize(question);
  return inventory.map(item => {
    const label = normalize(item.label);
    const words = item.label.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
    return { item, score: query.includes(label) ? label.length * 10 : words.reduce((n, w) => n + (query.includes(normalize(w)) ? w.length : 0), 0) };
  }).filter(row => row.score >= 3).sort((a, b) => b.score - a.score).slice(0, 4)
    .map(({ item }) => ({ ...item, description: item.description.slice(0, 180) }));
}
module.exports = { getUiEvidence, extract, UI_FILES };
