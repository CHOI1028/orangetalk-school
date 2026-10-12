/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* Keep prior entries when adding a release. Only the newest four are displayed. */
export const SCHOOL_RELEASE_NOTES = [
  {
    "version": "1.1.1",
    "title": "공유 연결 및 보건일지·키오스크 개선",
    "changes": [
      "메인·서브 PC 연동 안정화: 커스텀 양식, 물품 대여 기록, 키오스크 설정과 대기 목록의 동기화 및 재접속 처리를 개선했습니다.",
      "공유 연결 보안 강화: 메인 PC에서 복사한 보안 연결 주소로 서브 PC에 접속하도록 변경했습니다.",
      "키오스크·바디맵 개선: 학년·반·이름 선택 흐름과 가독성을 개선하고, 안내 문구·알림음 설정 반영 및 바디맵의 좌우 표시·부위 선택·통증 입력을 보완했습니다.",
      "개인정보 확인 및 과거 기록 편집 개선: 보호 중인 일지 내용을 잠시 확인한 뒤 다시 가리는 기능과 날짜·방문 이력에서 과거 기록을 편집하는 연결을 개선했습니다.",
      "보건일지 화면 정리: 일반 일지·응급처치·감염병 목록의 검색, 업무 도구, 출력, 정렬 영역을 통일감 있게 정리했습니다.",
      "백업·복원 안정화: 일부 데이터 복원 실패가 완료로 처리되던 문제를 수정하고, 커스텀 설정 백업·복원의 데이터 처리를 보완했습니다.",
      "업데이트 후 서브 PC에서는 메인 PC의 환경설정에서 복사한 새 보안 연결 주소로 한 번 다시 접속해 주세요."
    ]
  },
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
