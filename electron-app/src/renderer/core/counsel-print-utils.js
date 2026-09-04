/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 상담실적·개별 상담록 출력 공통 규칙. 저장된 상담 값은 수정하지 않는다. */
const COUNSEL_PRINT_FIELDS = [
  ['route', '의뢰 경로'],
  ['content', '상담 내용 (주호소)'],
  ['action', '조치 및 지도 내용'],
  ['plan', '후속 조치 계획'],
  ['opinion', '상담자 의견'],
  ['followUp', '재상담 예정일']
];

export function getCounselPrintFields(log){
  if(!log || typeof log!=='object' || Array.isArray(log)) return [];
  return COUNSEL_PRINT_FIELDS.reduce(function(fields, entry){
    const value=log[entry[0]]==null?'':String(log[entry[0]]);
    /* 공백만 있는 항목은 숨기되 실제 내용의 줄바꿈·들여쓰기·빈 줄은 그대로 보존. */
    if(value.trim()) fields.push({key:entry[0], label:entry[1], value:value});
    return fields;
  }, []);
}
