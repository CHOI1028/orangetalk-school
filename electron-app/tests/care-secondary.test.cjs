/* Synthetic care regressions. No application launch, real files, DB, or network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const daily = read('src/renderer/features/daily/daily-autocomplete.js');
const settings = read('src/renderer/features/settings/settings-tab-people.js');
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'Production boundaries: ' + start);
  return source.slice(a, b);
}
const production = [
  read('src/renderer/core/care-registration.js').replace(/^export /gm, ''),
  section(daily, 'let _carePopupSaving=', 'const _bdayFiredToday='),
  section(settings, 'let _careBulkDeleteSaving=', '/* ── Student file handling')
].join('\n');
const sample = (uid = 'synthetic-student', extra = {}) => ({
  uid, id: uid, type: 'student', name: '가상학생',
  status: 'caution', is_care: 1, care_reason: '기존 질환', condition: '기존 질환',
  care_memo: '기존 메모', careMemo: '기존 메모',
  dust_disease: '보존할 미세먼지 질환', dustDisease: '보존할 미세먼지 질환',
  guardianType: '', guardianContact: '가상 연락처', ...extra
});
function harness(options = {}) {
  const people = (options.people || [sample()]).map(p => ({ ...p }));
  const stores = new Map(people.map(p => [String(p.uid || p.id), { ...p }]));
  const writes = [], calls = [], closed = [];
  const elements = {
    careSearchReason: { value: options.reason == null ? '새 질환' : options.reason },
    careSearchMemo: { value: options.memo == null ? '새 메모' : options.memo },
    careSearchOverlay: { id: 'careSearchOverlay' }, addPersonModal: { id: 'addPersonModal' }
  };
  const api = options.unavailable ? undefined : {
    async studentsUpsert(payload, year) {
      writes.push({ payload: JSON.parse(JSON.stringify(payload)), year });
      const failure = options.failure;
      if (typeof failure === 'function') {
        const result = await failure(payload, year);
        if (result !== undefined) return result;
      } else if (failure === 'throw') throw new Error('synthetic connection failure');
      else if (failure) return { success: false };
      const old = stores.get(String(payload.uid));
      if (!old) return { success: false };
      const row = { ...old, ...payload };
      const care = { is_care: row.care_reason ? 1 : 0, care_reason: row.care_reason || '',
        dust_disease: row.dust_disease || '', care_memo: row.care_memo || '' };
      stores.set(String(payload.uid), { ...row, ...care });
      return { success: true, uid: payload.uid, care };
    }
  };
  const context = vm.createContext({
    S: { people }, window: { electronAPI: api },
    _careSearchSelectedId: (people[0] || {}).uid,
    _academicYear: () => 2026,
    getStu: id => context.S.people.find(p => String(p.uid || p.id) === String(id)) || { type: 'student', _notFound: true },
    document: { getElementById: id => elements[id] || null },
    alert: text => calls.push({ kind: 'alert', text }), confirm: () => options.confirm !== false,
    bus: { emit: (kind, data) => calls.push({ kind, data }) },
    renderDaily: () => calls.push({ kind: 'daily' }),
    renderSettingsPanel: () => calls.push({ kind: 'settings' }),
    closeModalGracefully: value => closed.push(value),
    closeBulkDeleteConfirm: () => closed.push('bulk'),
    resetAddPersonModal: () => calls.push({ kind: 'reset' }),
    saveData: () => { throw new Error('Care-only save must not write the full roster'); },
    saveStudents: () => { throw new Error('Care-only delete must not write the full roster'); }
  });
  vm.runInContext(production, context);
  return { context, people, stores, writes, calls, closed, elements,
    messages: () => calls.filter(c => c.kind === 'toast:show').map(c => c.data.text) };
}
const unchanged = h => ({ people: structuredClone(h.people), reason: h.elements.careSearchReason.value, memo: h.elements.careSearchMemo.value });

for (const action of ['saveCareFromPopup', 'deleteCareFromPopup']) {
  for (const failure of [true, 'throw']) {
    test(action + ' keeps input/data/modal on failed database acknowledgement: ' + failure, async () => {
      const h = harness({ failure }), before = unchanged(h);
      await h.context[action]();
      assert.deepEqual(unchanged(h), before);
      assert.deepEqual(h.closed, []);
      assert(!h.calls.some(c => c.kind === 'daily' || c.kind === 'reset'));
      assert(h.messages().some(text => text.includes('저장하지 못했습니다')));
    });
  }
  test(action + ' refuses unavailable storage', async () => {
    const h = harness({ unavailable: true }), before = unchanged(h);
    await h.context[action]();
    assert.deepEqual(unchanged(h), before);
    assert.equal(h.writes.length, 0);
    assert.equal(h.closed.length, 0);
  });
}
test('daily save waits for acknowledgement, deduplicates save/delete, and preserves unrelated fields', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ failure: () => blocked });
  const before = structuredClone(h.people);
  const pending = h.context.saveCareFromPopup();
  await h.context.saveCareFromPopup();
  await h.context.deleteCareFromPopup();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.people, before);
  assert.equal(h.closed.length, 0);
  release(); await pending;
  assert.equal(h.people[0].condition, '새 질환');
  assert.equal(h.people[0].care_reason, '새 질환');
  assert.equal(h.people[0].careMemo, '새 메모');
  assert.equal(h.people[0].guardianType, '');
  assert.equal(h.people[0].guardianContact, before[0].guardianContact);
  assert.equal(h.people[0].dustDisease, before[0].dustDisease);
  assert.deepEqual(h.writes[0], { payload: { uid: before[0].uid, _careOnly: true, care_reason: '새 질환', care_memo: '새 메모' }, year: '2026' });
  assert.equal(h.closed.length, 2);
});
test('daily deletion clears both aliases after success but preserves dust data', async () => {
  const h = harness(); await h.context.deleteCareFromPopup();
  for (const key of ['condition', 'care_reason', 'careMemo', 'care_memo']) assert.equal(h.people[0][key], '');
  assert.equal(h.people[0].is_care, 0);
  assert.equal(h.people[0].status, 'normal');
  assert.equal(h.people[0].dustDisease, '보존할 미세먼지 질환');
  assert.equal(h.people[0].careYear, 2026);
  assert(!Object.hasOwn(h.writes[0].payload, 'dust_disease'));
});
test('daily popup preserves explicit empty memo and long descriptions', async () => {
  const reason = '요보호 장문 메모\n'.repeat(2000);
  const h = harness({ reason, memo: '' }); await h.context.saveCareFromPopup();
  assert.equal(h.people[0].care_reason, reason.trim());
  assert.equal(h.people[0].careMemo, '');
});
test('daily invalid student and empty required reason cannot report success', async () => {
  const h = harness({ reason: '  ' }); await h.context.saveCareFromPopup();
  assert.equal(h.writes.length, 0); assert.equal(h.closed.length, 0);
  h.context._careSearchSelectedId = 'missing-student';
  h.elements.careSearchReason.value = '입력값';
  await h.context.saveCareFromPopup();
  assert.equal(h.writes.length, 0); assert.equal(h.closed.length, 0);
});
test('cancelled legacy care deletion does not change anything', async () => {
  const h = harness({ confirm: false }), before = unchanged(h);
  await h.context.deleteCareFromPopup();
  assert.deepEqual(unchanged(h), before); assert.equal(h.writes.length, 0);
});
test('late save acknowledgement does not close a newly selected student', async () => {
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ failure: () => blocked });
  const pending = h.context.saveCareFromPopup();
  h.context._careSearchSelectedId = 'different-student';
  release(); await pending;
  assert.equal(h.closed.length, 0);
  assert.equal(h.people[0].condition, '새 질환');
});
test('late save acknowledgement updates refreshed student object', async () => {
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ failure: () => blocked });
  const pending = h.context.saveCareFromPopup();
  const refreshed = { ...h.people[0] };
  h.context.S.people = [refreshed];
  release(); await pending;
  assert.equal(refreshed.condition, '새 질환');
  assert.equal(refreshed.careMemo, '새 메모');
});
test('legacy bulk care removal changes only acknowledged students and retains failures for retry', async () => {
  let failing = true;
  const h = harness({ people: [sample('A'), sample('B'), sample('staff', { type: 'staff' }), sample('dust-only', { status: 'normal', is_care: 0, condition: '', care_reason: '' })],
    failure: payload => failing && payload.uid === 'B' ? { success: false } : undefined });
  await h.context.confirmBulkDelete('care');
  assert.equal(h.people[0].condition, '');
  assert.equal(h.people[1].condition, '기존 질환');
  assert.equal(h.people[2].condition, '기존 질환');
  assert.deepEqual(h.writes.map(w => w.payload.uid), ['A', 'B']);
  assert.deepEqual(h.closed, []);
  assert(h.messages().some(text => text.includes('1명 저장 실패')));
  failing = false;
  await h.context.confirmBulkDelete('care');
  assert.deepEqual(h.writes.map(w => w.payload.uid), ['A', 'B', 'B']);
  assert.equal(h.people[1].care_reason, '');
  for (const p of h.people) assert.equal(p.dustDisease, '보존할 미세먼지 질환');
  assert.deepEqual(h.closed, ['bulk']);
});
test('legacy bulk removal does not overlap or mutate before acknowledgement', async () => {
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ failure: () => blocked }), before = structuredClone(h.people);
  const pending = h.context.confirmBulkDelete('care');
  await h.context.confirmBulkDelete('care');
  assert.equal(h.writes.length, 1); assert.deepEqual(h.people, before);
  assert.deepEqual(h.closed, []);
  release(); await pending;
  assert.deepEqual(h.closed, ['bulk']);
});
test('bulk storage failures preserve the whole failed roster and do not close confirmation', async () => {
  const h = harness({ failure: 'throw', people: [sample('A'), sample('B')] }), before = structuredClone(h.people);
  await h.context.confirmBulkDelete('care');
  assert.deepEqual(h.people, before); assert.deepEqual(h.closed, []);
  assert(h.messages().some(text => text.includes('2명 저장 실패')));
});
test('secondary production modules import shared acknowledgement helper', () => {
  for (const source of [daily, settings]) assert.match(source, /import\s*\{[^}]*persistCareRegistration[^}]*applyCareResult[^}]*\}\s*from\s*['"]\.\.\/\.\.\/core\/care-registration\.js['"]/);
});
