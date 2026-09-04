/* Synthetic regression coverage: unused sections, multiline data, and targets. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, record, student, read } = require('./helpers/counsel-harness.cjs');
const labels = {
  route: '의뢰 경로', content: '상담 내용 (주호소)', action: '조치 및 지도 내용',
  plan: '후속 조치 계획', opinion: '상담자 의견', followUp: '재상담 예정일'
};
const helper = log => Array.from(harness([]).context.getCounselPrintFields(log), field => ({ ...field }));

for(const empty of [null, undefined, '', '  ', '\n\r\t', '\u00a0']) {
  test('blank optional values are omitted: ' + JSON.stringify(empty), () => {
    const log = Object.fromEntries(Object.keys(labels).map(key => [key, empty]));
    assert.deepEqual(helper(log), []);
    const html = harness([record(log)]).single().html;
    for(const label of Object.values(labels)) assert(!html.includes(label));
    assert(html.includes('작성된 상담 내용이 없습니다.'));
    assert(html.includes('검증상담자'));
    assert(html.includes('검증학교'));
  });
}
test('invalid or absent log yields no optional fields', () => {
  for(const log of [null, undefined, [], 'text', 3]) assert.deepEqual(helper(log), []);
});
test('literal dash, explicit none, and zero are not mistaken for empty values', () => {
  assert.deepEqual(helper({ content: '-', action: '없음', plan: 0 }).map(f => f.value), ['-', '없음', '0']);
});
test('print helper preserves original whitespace, order, and frozen data', () => {
  const log = Object.freeze({ content: ' 첫 줄\n\n  들여쓴 줄\n마지막 줄 ', route: '직접 방문', followUp: '2026-09-10' });
  const fields = helper(log);
  assert.deepEqual(fields.map(f => f.key), ['route', 'content', 'followUp']);
  assert.equal(fields[1].value, log.content);
  fields[1].value = 'changed descriptor';
  assert.equal(log.content, ' 첫 줄\n\n  들여쓴 줄\n마지막 줄 ');
});

for(const [key, label] of Object.entries(labels)) {
  test('only populated ' + key + ' is printed in both counseling formats', () => {
    // Content makes route/followUp-only records count as counseling in the existing filter.
    const log = key === 'route' || key === 'followUp' ? { content: '통합 상담 서술' } : {};
    log[key] = '작성한 항목 값';
    const h = harness([record(log)]);
    for(const html of [h.single().html, h.batch()[0].html]) {
      assert(html.includes(label));
      assert(html.includes('작성한 항목 값'));
      for(const [otherKey, otherLabel] of Object.entries(labels)) {
        if(!(otherKey in log)) assert(!html.includes(otherLabel), otherLabel);
      }
    }
  });
}
test('all narrative fields retain newlines and safely escape HTML in both formats', () => {
  const content = '첫 문단\n둘째 줄\n\n  들여쓰기 <img src=x> & "기호"\n마지막 줄';
  const log = Object.fromEntries(Object.keys(labels).map(key => [key, key + ': ' + content]));
  const h = harness([record(log)]);
  for(const html of [h.single().html, h.batch()[0].html]) {
    assert(!html.includes('<img src=x>'));
    for(const key of Object.keys(labels)) {
      assert(html.includes(key + ': 첫 문단\n둘째 줄\n\n  들여쓰기 &lt;img src=x&gt; &amp; &quot;기호&quot;\n마지막 줄'), key);
    }
    assert(html.includes('white-space:pre-wrap'));
    assert(html.includes('overflow-wrap:anywhere'));
    let previous = -1;
    for(const label of Object.values(labels)) {
      const at = html.indexOf(label);
      assert(at > previous, 'Field order: ' + label);
      previous = at;
    }
  }
});
test('unfilled sections are omitted per record, not based on the whole batch', () => {
  const h = harness([record({ content: 'CONTENT_ONLY' }), record({ action: 'ACTION_ONLY' }, { id: 102 })]);
  const html = h.batch()[0].html;
  assert.equal(html.split('상담 내용 (주호소)').length - 1, 1);
  assert.equal(html.split('조치 및 지도 내용').length - 1, 1);
  assert(!html.includes('후속 조치 계획'));
  assert(html.includes('2건'));
});
test('date/person/topic filters and ascending record order are preserved', () => {
  const recs = [
    record({ content: 'LATE' }, { id: 1, date: '2026-09-05' }),
    record({ content: 'EARLY' }, { id: 2 }),
    record({ content: 'EXCLUDE_DATE' }, { id: 3, date: '2026-08-31' }),
    record({ content: 'EXCLUDE_PERSON' }, { id: 4, studentId: 'someone-else' }),
    record({ content: 'EXCLUDE_TOPIC', topics: ['다른 주제'] }, { id: 5 }),
    record({ route: 'EXCLUDE_EMPTY', followUp: '2026-09-10' }, { id: 6 })
  ];
  const html = harness(recs, { person: student.uid }).batch()[0].html;
  assert(!html.includes('EXCLUDE_'));
  assert(html.includes('2건'));
  assert(html.indexOf('EARLY') < html.indexOf('LATE'));
  assert(html.includes('검증학생'));
});
test('unspecified topic can be selected and prints existing metadata', () => {
  const html = harness([record({ content: 'TOPICLESS', topics: [] })]).batch(['(주제 미지정)'])[0].html;
  assert(html.includes('TOPICLESS'));
  assert(html.includes('2026-09-01 09:10'));
  assert(html.includes('2학년 3반 7번'));
});
test('no matching records shows a message without opening PDF/print', () => {
  const result = harness([record({ content: 'data' })]).batch(['다른 주제']);
  assert.equal(result.length, 1);
  assert.equal(result[0].mode, 'toast');
});
test('PDF and direct print use identical content and the same A4 margins', () => {
  const h = harness([record({ content: '첫 줄\n둘째 줄' })]);
  const pdf = h.batch()[0], print = h.batch(['건강 상담'], 'print')[0];
  assert.equal(pdf.html, print.html);
  assert.equal(pdf.cssMargins, true);
  assert.deepEqual({ ...print.marginsMm }, { top: 20, bottom: 20, left: 12, right: 12 });
});
test('individual output retains session, staff, and school with and without followup', () => {
  for(const followUp of ['', '2026-09-20']) {
    const recs = [record({ content: '이전 상담' }, { id: 1, date: '2026-08-10' }), record({ content: '현재 상담', followUp })];
    const html = harness(recs).single(recs[1]).html;
    for(const value of ['2회기', '검증상담자', '검증학교', '2026-09-01 09:10']) assert(html.includes(value));
    assert.equal(html.includes('재상담 예정일'), !!followUp);
    if(!followUp) assert(html.includes('<th>상담자</th><td colspan="3">'));
  }
});
test('diary individual preview shares builder and multiline layout', () => {
  const source = read('src/renderer/features/daily/diary-print-view.js');
  assert(source.includes('built=_symBuildCounselPrintHtml(r)'));
  assert(source.includes('.dp-counsel-sheet .long-cell{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}'));
});
