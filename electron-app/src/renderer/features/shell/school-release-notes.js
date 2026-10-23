/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* Keep prior entries when adding a release. Only the newest four are displayed. */
export const SCHOOL_RELEASE_NOTES = [
  {
    "version": "1.1.16",
    "title": "보건일지 입력·약품 관리 개선 및 저장 안정화",
    "changes": [
      "증상·처치 화면 개선: 2열·3열 보기와 증상 검색, 처치 선택 표시를 정리하고 창 이동과 작은 화면·확대 화면의 사용성을 개선했습니다.",
      "약품 관리·투약 편의 개선: 약품 분류·검색, 전체 숨김/표시, 사용자 추가 약품 삭제와 투약 단위 직접 입력을 지원합니다.",
      "보건일지 저장 안정화: 자동 저장 상태·실패 시 재시도 안내를 개선하고, 기록 수정과 필터 변경 시 기존 투약 내용·투여량 보존을 보완했습니다.",
      "보건일지 출력 개선: V/S 수치·처치 내용의 출력 누락을 보완하고, 기간 기록 조회 실패 시 불완전한 파일이 저장되지 않도록 수정했습니다."
    ]
  },
  {
    "version": "1.1.15",
    "title": "출력·외부 서비스 연결 및 협업 기능 개선",
    "changes": [
      "약품 검색·미세먼지·학교 정보 등의 조회 시 기존 방식으로 연결되지 않으면 대체 통신 방식으로 재시도하도록 보완했습니다. 정상 연결 시에는 기존 방식을 유지합니다.",
      "방문 확인증과 커스텀 양식에서 입실시간·퇴실시간 등의 항목명이 불필요하게 줄바꿈되던 문제를 수정했습니다.",
      "동료와 협업 화면을 공유 켜기와 주소 복사 중심으로 간소화하고, 접속용 키가 포함된 주소 복사와 주소 조회 실패 안내·재시도 처리를 보완했습니다."
    ]
  },
  {
    "version": "1.1.14",
    "title": "상용 약품 목록 보존 및 저장 안정화",
    "changes": [
      "저장된 상용 약품을 불러온 뒤에도 목록이 비어 보이거나, 약품 편집 시 기존 목록이 덮어써질 수 있는 문제를 수정했습니다.",
      "약품 추가·수정·삭제 전에 최신 설정을 확인하고, 불러오기·저장 실패 시 안내하도록 보완했습니다.",
      "약품 설정 변경 전 복구용 사본을 보관하도록 보완했습니다."
    ]
  },
  {
    "version": "1.1.13",
    "title": "방문 이력·증상 처치 화면 및 출력 개선",
    "changes": [
      "같은 날 앞서 방문한 기록을 최근 방문 이력에서 확인할 수 있도록 수정하고, 기간검색 결과에서도 인원에 마우스를 올리면 최근 이력이 표시되도록 개선했습니다.",
      "날짜·방문 이력의 달력, 검색, 방문 목록을 통합 패널로 정리하고 날짜 표시와 기록의 가독성을 개선했습니다.",
      "증상·처치 선택 화면의 글자 크기, 간격과 버튼 배치를 정리하여 입력 내용을 더 쉽게 확인할 수 있도록 개선했습니다.",
      "팝업의 배경 흐림을 완화하고, 증상·처치 입력 중 방문 이력 조회·스크롤과 창 이동이 자연스럽게 이어지도록 보완했습니다.",
      "출력 내용에서 증상과 처치를 각각 선택할 수 있도록 개선하고, 항목 선택 화면과 긴 내용의 출력 처리를 보완했습니다."
    ]
  },
  {
    "version": "1.1.12",
    "title": "소리 설정 추가 및 보건일지 사용성 개선",
    "changes": [
      "환경설정에 전체 또는 알림 종류별로 소리를 켜고 끌 수 있는 소리 설정 기능을 추가했습니다.",
      "날짜·방문 이력 달력에서 선택한 날짜가 일반일지 조회 날짜와 연동되도록 개선했습니다.",
      "기간검색 중에도 선택한 날짜로 일지를 등록할 수 있도록 수정하고, 오늘이 아닌 날짜에는 등록 날짜를 확인하도록 보완했습니다.",
      "학생 방문 이력을 확인한 뒤 마우스를 이동하면 날짜별 방문 목록이 비어 보이던 오류를 수정했습니다.",
      "상용 메시지·물품 대여 대장·열 필드 설정 창이 다시 열리지 않거나 두 번 클릭해야 열리던 오류를 수정했습니다."
    ]
  },
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
