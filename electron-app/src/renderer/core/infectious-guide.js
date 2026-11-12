import { INFECTIOUS_CATALOG, CATALOG_CHECKED_AT, CATALOG_SOURCE } from './infectious-catalog-data.js';
import { cleanDiseaseLabel } from './infectious-labels.js';
import { REPORT_LABELS, diseaseBrief, diseaseDetailUrl } from './infectious-briefs.js';

export { diseaseDetailUrl };

export { INFECTIOUS_CATALOG, CATALOG_CHECKED_AT, CATALOG_SOURCE };
const vaccineSource = 'https://www.kdca.go.kr/kdca/3247/subview.do';
const healthSource = id => 'https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=' + id;
// Reviewed paraphrases, not a clinical decision engine. Never calculate a student's return date.
const guidance = {
  '수두': {
    summary: '모든 피부 병변에 딱지가 형성될 때까지 격리하며, 발진 발생 후 최소 5일을 확인합니다. 예방접종 후 딱지가 생기지 않는 발진만 있으면 새 병변이 24시간 동안 생기지 않는지 확인합니다.',
    source: vaccineSource, title: '질병관리청 · 예방접종 대상 감염병 / 환자 관리',
    checks: ['발진 시작일과 피부 병변의 상태', '예방접종력과 새 병변 발생 여부', '진료 결과 및 등교 가능 여부']
  },
  '백일해': {
    summary: '적절한 항생제 치료를 시작한 뒤 5일까지 격리가 필요합니다. 치료받지 않은 경우에는 기침이 멈출 때까지 최소 3주 이상이 기준이므로 진료기관의 개별 안내를 확인합니다.',
    source: vaccineSource, title: '질병관리청 · 예방접종 대상 감염병 / 환자 관리',
    checks: ['항생제 치료 시작 시점', '치료 여부와 기침 경과', '진료기관의 격리 안내']
  },
  '유행성이하선염': {
    summary: '이하선염이 시작된 뒤 5일까지 격리하는 기준입니다. 실제 복귀는 증상 경과와 진료 결과를 함께 확인합니다.',
    source: vaccineSource, title: '질병관리청 · 예방접종 대상 감염병 / 환자 관리', checks: ['이하선염 발생일', '증상 경과와 진료 결과']
  },
  '홍역': {
    summary: '발진이 시작된 뒤 4일까지 격리하는 기준입니다. 환자 상태에 따른 진료기관·보건당국의 조치를 함께 확인합니다.',
    source: vaccineSource, title: '질병관리청 · 예방접종 대상 감염병 / 환자 관리', checks: ['발진 시작일', '진료기관·보건당국 안내']
  },
  '성홍열': {
    summary: '항생제 치료를 시작한 뒤 최소 24시간 동안 등교·등원을 중지하는 기준입니다. 증상과 진료기관의 안내를 함께 확인합니다.',
    source: healthSource(5317), title: '질병관리청 국가건강정보포털 · 성홍열 (2026-04-15 갱신)', checks: ['항생제 치료 시작 시점', '증상 경과와 진료 결과']
  },
  '인플루엔자': {
    summary: '해열제를 사용하지 않고 열이 내린 상태가 최소 24시간 지속되는지 확인합니다. 해열제를 투약했다면 마지막 투약부터 48시간의 경과 관찰도 필요합니다. 중증·면역저하 등의 경우 제한 기간은 의사 판단에 따라 달라집니다.',
    source: 'https://www.kdca.go.kr/bbs/kdca/55/310104/download.do', title: '질병관리청 · 2026–2027절기 인플루엔자 관리지침, 환자 관리 (16쪽)',
    checks: ['해열 시점과 마지막 해열제 투약 시점', '전반적인 증상 호전 여부', '진료기관의 개별 안내']
  },
  '수족구병': {
    summary: '발열이 없고 수포가 마른 뒤 복귀하는 기준입니다. 기준을 충족하더라도 상태가 좋지 않으면 연장을 고려하며, 복귀 후에도 손 위생을 철저히 유지합니다.',
    source: 'https://kdca.go.kr/bbs/kdca/55/305086/download.do', title: '질병관리청 · 2026년도 엔테로바이러스감염증·수족구병 관리지침 (20쪽)',
    checks: ['발열 여부', '수포가 마른 상태와 전반적인 건강 상태', '복귀 후 손 위생 안내']
  },
  '노로바이러스 감염증': {
    summary: '회복 후에도 전파 가능성이 있어 증상이 사라진 뒤 최소 48시간 동안 등교·등원·출근을 미루는 것이 권장됩니다. 증상 소실 시점과 진료 결과를 확인합니다.',
    source: 'https://health.kdca.go.kr/healthinfo/biz/health/ntcnInfo/healthSourc/thtimtCntnts/thtimtCntntsView.do?thtimt_cntnts_sn=132',
    title: '질병관리청 국가건강정보포털 · 이달의 건강정보 (2026년 1월)', checks: ['구토·설사 등 증상이 사라진 시점', '진료 결과와 전반적인 회복 상태']
  }
};
const aliases = {
  '인플루엔자': ['독감', 'A형 독감', 'B형 독감', 'A형독감', 'B형독감', 'flu'],
  '코로나바이러스감염증-19': ['코로나', '코로나19', 'COVID-19', 'COVID19'],
  '유행성이하선염': ['볼거리', '유행성 이하선염'],
  '수두': ['varicella', 'chickenpox'], '백일해': ['pertussis'],
  '수족구병': ['수족구', 'HFMD'], '노로바이러스 감염증': ['노로', '노로바이러스'],
  '호흡기세포융합바이러스 감염증': ['RSV'], '엠폭스(Mpox)': ['엠폭스', '원숭이두창']
};
export const normalizeDiseaseText = value => cleanDiseaseLabel(value).toLowerCase().replace(/[\s·()\-]/g, '');

function codeBounds(code) {
  const m = /^([A-Z])(\d{2})(?:\.(\d{1,4}))?$/.exec(code);
  if (!m) return null;
  const base = ((m[1].charCodeAt(0) - 65) * 100 + Number(m[2])) * 10000;
  const lower = base + Number((m[3] || '').padEnd(4, '0'));
  return [lower, lower + (m[3] ? Math.pow(10, 4 - m[3].length) : 10000) - 1];
}
export function matchesKcd(kcd, query) {
  let q = String(query).trim().toUpperCase().replace(/\s/g, '');
  if (/^[A-Z]\d{3,6}$/.test(q)) q = q.slice(0, 3) + '.' + q.slice(3);
  const bounds = codeBounds(q);
  if (!bounds) return false;
  const tokens = String(kcd).toUpperCase().matchAll(/([A-Z]\d{2}(?:\.\d{1,4})?)(?:\s*[~∼–-]\s*((?:[A-Z])?\d{2}(?:\.\d{1,4})?))?/g);
  for (const token of tokens) {
    const a = codeBounds(token[1]);
    const b = token[2] ? codeBounds(/^[A-Z]/.test(token[2]) ? token[2] : token[1][0] + token[2]) : a;
    if (a && b && bounds[0] <= b[1] && bounds[1] >= a[0]) return true;
  }
  return false;
}
export function searchDiseases(query = '', grade = '') {
  const q = normalizeDiseaseText(query);
  const isCode = /^[a-z]\d{2}(?:\.?\d{1,4})?$/.test(q);
  return INFECTIOUS_CATALOG.filter(d => (!grade || d.grade === Number(grade)) && (!q ||
    (isCode ? matchesKcd(d.kcd, q) : [d.name, ...(aliases[d.name] || [])].some(v => normalizeDiseaseText(v).includes(q)))))
    .sort((a,b) => Number(normalizeDiseaseText(b.name) === q) - Number(normalizeDiseaseText(a.name) === q) || a.grade - b.grade || a.name.localeCompare(b.name, 'ko'));
}
export function getDiseaseGuide(disease) {
  const reviewed = guidance[disease.name];
  const base = reviewed || {
    summary: '등교중지 기간은 공식 지침과 진료기관 안내를 확인해 주세요.',
    source: 'https://dportal.kdca.go.kr/pot/bbs/BD_selectBbsList.do?q_bbsSn=1001',
    title: '질병관리청 감염병포털 · 감염병지침', checks: ['진료기관·보건당국 안내', '학생별 증상 경과와 등교 가능 여부'], unavailable: true
  };
  return { ...base, brief: diseaseBrief(disease), reportLabel: REPORT_LABELS[disease.grade] || '지침 확인', detailUrl: diseaseDetailUrl(disease.name) };
}

// Compare the live input again at commit time; a preview is not permission to overwrite later edits.
export function diseaseNameChange(current, expected, next, allowReplace = false) {
  if (current == null) return { error: '기록지가 닫혔거나 다른 기록으로 바뀌었습니다. 기록지에서 다시 검색해 주세요.' };
  if (String(current) !== String(expected)) return { error: '검색 중 감염병명이 변경되었습니다. 현재 값을 다시 확인해 주세요.' };
  if (!INFECTIOUS_CATALOG.some(d => d.name === next)) return { error: '공식 목록에서 질병을 다시 선택해 주세요.' };
  if (String(current).trim() && current !== next && !allowReplace) return { error: '기존 감염병명을 변경하려면 변경 동의를 선택해 주세요.' };
  return { value: next, changed: current !== next };
}
