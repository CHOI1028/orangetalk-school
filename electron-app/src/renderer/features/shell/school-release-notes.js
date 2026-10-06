/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* Keep prior entries when adding a release. Only the newest four are displayed. */
export const SCHOOL_RELEASE_NOTES = [
  {
    version: '1.1.0',
    title: '더 편안해진 학교용 오렌지톡',
    changes: [
      '헤더와 메뉴, 홈의 캘린더·오늘 할 일·메모 배치를 개선했습니다.',
      '학생 이름 음성 호출과 소리 설정·미리듣기 기능을 추가했습니다.',
      '메뉴와 팝업의 글자 크기, 탭, 여백을 정리하고 작은 창·확대 화면의 배치를 개선했습니다.',
      '메모, 대여대장, 응급처치 입력 화면의 불편함을 보완했습니다.'
    ]
  },
  {
    version: '1.0.23',
    title: '조회·등록·기록 기능 안정화',
    changes: [
      '감염병 유행 현황 조회 오류 수정: 인증키 이중 인코딩 문제와 응답 처리를 보완했습니다.',
      '요보호·미세먼지 기저질환 등록 안정화: 개별 저장·엑셀 등록·수동 매칭을 보완하고, 저장 실패가 성공으로 표시되던 문제를 수정했습니다. 긴 질환명과 여러 줄 내용의 처리도 점검했습니다.',
      '상담 입력·출력 개선: Enter 줄바꿈을 정상화하고, PDF·인쇄 시 작성하지 않은 빈 항목을 제외하도록 개선했습니다.',
      '과거 방문 이력 표시 수정: 여러 증상이 기록된 경우 처치 내용이 누락되거나 보건일지와 다르게 표시되던 문제를 보완했습니다.'
    ]
  }
];

const VISIBLE_RELEASE_LIMIT = 4;

function compareReleaseVersions(a, b) {
  const left = a.version.split('.').map(Number);
  const right = b.version.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const difference = (right[i] || 0) - (left[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function renderSchoolReleaseNotes(root = document) {
  const releases = SCHOOL_RELEASE_NOTES.slice()
    .sort(compareReleaseVersions)
    .slice(0, VISIBLE_RELEASE_LIMIT);

  root.querySelectorAll('[data-school-release-notes]').forEach(function (container) {
    const fragment = document.createDocumentFragment();
    releases.forEach(function (release, index) {
      const details = document.createElement('details');
      details.className = 'school-choice-release';
      details.open = index === 0;

      const summary = document.createElement('summary');
      const heading = document.createElement('span');
      heading.className = 'school-choice-release-heading';
      const version = document.createElement('span');
      version.className = 'school-choice-version';
      version.textContent = 'v' + release.version;
      const title = document.createElement('strong');
      title.textContent = release.title;
      heading.append(version, title);

      const toggle = document.createElement('span');
      toggle.className = 'school-choice-release-toggle';
      toggle.setAttribute('aria-hidden', 'true');
      summary.append(heading, toggle);

      const list = document.createElement('ul');
      release.changes.forEach(function (change) {
        const item = document.createElement('li');
        item.textContent = change;
        list.appendChild(item);
      });
      details.append(summary, list);
      fragment.appendChild(details);
    });
    container.replaceChildren(fragment);
  });
}
