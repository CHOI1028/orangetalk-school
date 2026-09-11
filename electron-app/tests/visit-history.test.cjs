/* Regression coverage for the history popup, using synthetic records only.
 * The full renderer imports Electron/UI singletons. Load the actual functions
 * into a minimal DOM harness instead of opening the app or touching user data. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const symptomSource = read('src/renderer/features/symptom/symptom-view.js');
const utilsSource = read('src/renderer/core/record-utils.js');
const formatSource = read('src/renderer/core/format-utils.js');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'Production function boundaries must exist: ' + startMarker);
  return source.slice(start, end).replace(/^export /gm, '');
}

const productionFunctions = [
  section(utilsSource, 'export function shouldShowTreatmentBySymptom(', '/* ── 인물↔레코드'),
  section(formatSource, 'export function escHtml(', 'export function escJs('),
  section(symptomSource, 'function _parseMedWithDose(', 'function _serializeMedWithDose('),
  section(symptomSource, 'export function formatMedicationDisplay(', '/* 투약 팝업'),
  section(symptomSource, 'function _vsValueStr(', '/* 카테고리 찾기'),
  section(symptomSource, 'export function _symShowHistory(', 'function _symCloseHistory(')
].join('\n');

const symptoms = ['가슴 두근거림', '어지러움'];
function visit(overrides = {}) {
  return {
    id: 101, studentId: 'fixture-student', date: '2026-08-26',
    symptoms: [...symptoms], treatmentBranched: false,
    treatment: ['침상 이용', 'V/S 측정'],
    treatmentBySym: { __flat__: ['침상 이용', 'V/S 측정'] },
    bp: '123/90', pulse: '141', resp: '20',
    ...overrides
  };
}

function render(records, currentId) {
  const before = structuredClone(records);
  const nodes = [];
  const document = {
    getElementById() { return null; },
    createElement() {
      const node = {
        style: {}, innerHTML: '',
        appendChild() {}, addEventListener() {}, querySelectorAll() { return []; }
      };
      nodes.push(node);
      return node;
    },
    body: { appendChild() {} }
  };
  const context = vm.createContext({
    S: { records }, document, window: {},
    stuKeySet: id => new Set([String(id)]),
    recInStuKeys: (record, keys) => keys.has(String(record.studentId)),
    requestAnimationFrame: callback => callback(),
    _makeDraggable() {}
  });
  vm.runInContext(productionFunctions, context);
  context._symShowHistory('fixture-student', currentId);
  assert.deepEqual(records, before, 'Displaying history must not modify records');
  const html = nodes.find(node => node.id === 'symHistoryPop').innerHTML;
  return { html, context };
}

const occurrences = (html, text) => html.split(text).length - 1;
const hasCommonTreatment = html => {
  assert.equal(occurrences(html, '침상 이용'), 1);
  assert.equal(occurrences(html, 'V/S 측정'), 1);
  assert(html.includes('BP: 123/90, P: 141, R: 20'));
};

for (const [name, map] of [
  ['only the reserved flat key', { __flat__: ['침상 이용', 'V/S 측정'] }],
  ['empty symptom keys', { __flat__: ['침상 이용'], '가슴 두근거림': [], '어지러움': [] }],
  ['stale branched treatments', { __flat__: ['침상 이용'], '가슴 두근거림': ['OLD_TREATMENT'], '어지러움': ['OLD_OTHER'] }]
]) {
  test('unbranched history reads common treatment with ' + name, () => {
    const { html } = render([visit({ treatmentBySym: map })]);
    hasCommonTreatment(html);
    assert(!html.includes('OLD_TREATMENT'));
    assert(!html.includes('OLD_OTHER'));
    assert(html.includes('가슴 두근거림, 어지러움'));
  });
}

test('single symptom uses common treatment even with a per-symptom map', () => {
  const { html } = render([visit({ symptoms: ['어지러움'], treatmentBranched: true })]);
  hasCommonTreatment(html);
});

for (const map of [undefined, {}, []]) {
  test('legacy flat treatment survives an absent or empty map: ' + JSON.stringify(map), () => {
    hasCommonTreatment(render([visit({ treatmentBranched: undefined, treatmentBySym: map })]).html);
  });
}

test('imported records remain flat despite stale branch metadata', () => {
  const { html } = render([visit({
    isImported: true, treatmentBranched: true,
    treatmentBySym: { '가슴 두근거림': ['OLD_TREATMENT'] }
  })]);
  hasCommonTreatment(html);
  assert(!html.includes('OLD_TREATMENT'));
});

for (const flag of [true, undefined]) {
  test('branched records retain symptom-specific treatment and doses: ' + flag, () => {
    const { html } = render([visit({
      treatmentBranched: flag, treatment: ['COMMON_SHOULD_NOT_APPEAR'],
      treatmentBySym: { '가슴 두근거림': ['V/S 측정'], '어지러움': ['투약'] },
      medsBySym: { '어지러움': ['테스트약'] },
      medDosesBySym: { '어지러움': { '테스트약': '1T' } }
    })]);
    assert(html.includes('V/S 측정 (BP: 123/90, P: 141, R: 20)'));
    assert(html.includes('투약[테스트약 (1T)]'));
    assert(!html.includes('COMMON_SHOULD_NOT_APPEAR'));
    assert.equal(occurrences(html, 'V/S 측정'), 1);
    assert.equal(occurrences(html, '투약['), 1);
  });
}

test('new multi-symptom records without any treatments render safely', () => {
  const { html } = render([visit({ treatmentBranched: true, treatmentBySym: undefined, treatment: [] })]);
  assert(html.includes('가슴 두근거림'));
  assert(html.includes('어지러움'));
  assert(!html.includes('V/S 측정'));
});

test('common medication preserves the recorded drug and dose', () => {
  const { html } = render([visit({ treatment: ['투약'], medication: '테스트약(1T)' })]);
  assert(html.includes('투약[테스트약 (1T)]'));
});

test('stale medication and vital values do not create new treatments', () => {
  const { html } = render([visit({ treatment: ['보건교육'], medication: 'STALE_DRUG(1T)' })]);
  assert(!html.includes('STALE_DRUG'));
  assert(!html.includes('BP:'));
  assert(!html.includes('V/S 측정'));
});

test('already formatted medication chips are preserved', () => {
  const { html } = render([visit({ treatment: ['투약[테스트약 (1T)]'], medication: 'STALE_DRUG' })]);
  assert.equal(occurrences(html, '투약[테스트약 (1T)]'), 1);
  assert(!html.includes('STALE_DRUG'));
});

test('a common treatment memo remains visible once', () => {
  const { html } = render([visit({ treatmentMemo: '보호자에게 안내함' })]);
  hasCommonTreatment(html);
  assert.equal(occurrences(html, '보호자에게 안내함'), 1);
});

test('memo-only history does not show an empty-treatment prefix', () => {
  const { html } = render([visit({ treatment: [], treatmentMemo: '경과 안내만 기록함' })]);
  assert(html.includes('→ 경과 안내만 기록함'));
  assert(!html.includes('- / 경과'));
});

test('branched treatment memo remains visible once', () => {
  const { html } = render([visit({
    treatmentBranched: true, treatmentBySym: { '어지러움': ['보건교육'] },
    treatmentMemo: '분기 메모'
  })]);
  assert.equal(occurrences(html, '분기 메모'), 1);
});

for (const label of ['상담', '상담(메모)', '상담[학업 관련 상담]']) {
  test('counseling text appears on the counseling row: ' + label, () => {
    const { html } = render([visit({
      symptoms: [label, '어지러움'], treatmentBranched: true,
      treatmentBySym: { [label]: [], '어지러움': ['보건교육'] },
      counselLog: { treatmentText: '상담 후 담임교사 연계' }
    })]);
    assert.equal(occurrences(html, '상담 후 담임교사 연계'), 1);
    assert(html.indexOf('상담 후 담임교사 연계') < html.indexOf('어지러움'));
  });
}

test('counseling text is not duplicated when already in the symptom map', () => {
  const { html } = render([visit({
    symptoms: ['상담', '어지러움'], treatmentBranched: true,
    treatmentBySym: { '상담': ['상담 문구'], '어지러움': [] },
    counselLog: { treatmentText: '상담 문구' }
  })]);
  assert.equal(occurrences(html, '상담 문구'), 1);
});

test('flat counseling content is not appended a second time', () => {
  const { html } = render([visit({
    symptoms: ['상담', '어지러움'], treatment: ['상담 문구'],
    counselLog: { treatmentText: '상담 문구' }
  })]);
  assert.equal(occurrences(html, '상담 문구'), 1);
});

test('symptoms and treatment notes remain HTML-escaped', () => {
  const { html } = render([visit({
    symptoms: ['증상<script>alert(1)</script>', '어지러움'],
    treatmentMemo: '<img src=x onerror=alert(1)>'
  })]);
  assert(!html.includes('<script>'));
  assert(!html.includes('<img'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('&lt;img'));
});

test('history filtering and body-map marker behavior remain unchanged', () => {
  const { html } = render([
    visit({ id: 1, date: '2026-09-04', treatment: ['CURRENT_DAY'] }),
    visit({ id: 2, treatment: ['PAST_VISIT'] }),
    visit({ id: 3, studentId: 'another-fixture', treatment: ['OTHER_PERSON'] })
  ], 1);
  assert(!html.includes('CURRENT_DAY'));
  assert(!html.includes('OTHER_PERSON'));
  assert(html.includes('PAST_VISIT'));
  assert(html.includes('data-bm-active="0"'));
});

test('the shared predicate preserves the previous diary/sidebar rule', () => {
  const { context } = render([]);
  for (const flag of [undefined, false, true])
    for (const imported of [false, true])
      for (const symptomList of [[], ['A'], ['A', 'B']])
        for (const map of [undefined, {}, [], { __flat__: ['X'] }, { A: ['Y'] }])
          for (const treatment of [[], ['X']]) {
            const record = { treatmentBranched: flag, isImported: imported, symptoms: symptomList, treatmentBySym: map, treatment };
            const hasMap = map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length > 0;
            const legacyFlat = !hasMap && treatment.length > 0;
            const expected = !imported && symptomList.length > 1 && !legacyFlat && flag !== false;
            assert.equal(context.shouldShowTreatmentBySymptom(record), expected);
          }
});

test('the diary table, sidebar, and popup all use the shared predicate', () => {
  const dailySource = read('src/renderer/features/daily/daily-view.js');
  assert(dailySource.includes('const _showLayered = shouldShowTreatmentBySymptom(r);'));
  assert(dailySource.includes('const _isMultiSym = shouldShowTreatmentBySymptom(r);'));
  assert(symptomSource.includes('const _isMultiSym = shouldShowTreatmentBySymptom(v);'));
});

// Compare export text with the real school history renderer, not a second
// reconstruction of the history rules. Synthetic data only.
for (const [label, overrides] of [
  ['branched', { treatmentBranched: true }],
  ['unbranched', { treatmentBranched: false }],
  ['imported', { treatmentBranched: true, isImported: true }],
  ['single symptom', { symptoms: ['복통'], treatmentBranched: true }],
  ['legacy', { treatmentBySym: {}, treatmentBranched: undefined }],
  ['empty symptom row', { treatmentBranched: true, treatmentBySym: { 복통: ['투약'], 구토: [] } }]
]) {
  test('migration columns match actual history arrows: ' + label, () => {
    const r = visit({
      symptoms: ['복통', '구토'], treatment: ['투약', 'V/S 측정', '신체사정'],
      treatmentBySym: { 복통: ['투약'], 구토: ['V/S 측정', '신체사정'], 옛증상: ['STALE'] },
      medication: '가상약(1포)', medsBySym: { 복통: ['가상약'] },
      medDosesBySym: { 복통: { 가상약: '1포' } }, treatmentMemo: '메모 보존',
      physicalAssessment: { items: ['청진'], details: { 청진: '가상 기록' } },
      ...overrides
    });
    const { html, context } = render([r]);
    const actualRight = [...html.matchAll(/<span[^>]*>(?:<span[^>]*>→<\/span>|→ )([^<]*)<\/span>/g)].map(match => match[1]);
    const original = {
      symptoms: JSON.stringify(r.symptoms), treatment: JSON.stringify(r.treatment),
      treatment_by_sym: JSON.stringify(r.treatmentBySym), medication: r.medication,
      blood_pressure: r.bp, pulse: r.pulse, respiration: r.resp,
      is_imported: r.isImported ? 1 : 0, physical_assessment: JSON.stringify(r.physicalAssessment),
      extra_json: JSON.stringify({ treatment_branched: r.treatmentBranched,
        treatment_memo: r.treatmentMemo, meds_by_sym: r.medsBySym, med_doses_by_sym: r.medDosesBySym })
    };
    const exported = require('../src/main/services/school-treatment').history(original);
    const expectedRight = exported.treatment.split('\n');
    if (context.shouldShowTreatmentBySymptom(r)) expectedRight.pop(); // Separate note below arrows.
    assert.deepEqual(actualRight, expectedRight.map(context.escHtml));
    for (const symptom of exported.symptom.split('\n')) assert(html.includes(context.escHtml(symptom)));
    assert(html.includes(context.escHtml(r.treatmentMemo)));
  });
}
