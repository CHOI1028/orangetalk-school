/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* student-utils.js — 학생/교직원 데이터 조회·변환·저장 */
import { S } from './app-state.js';
import { escHtml } from './format-utils.js';

/* 학년도는 3월 1일 시작(달력 연도 아님). 예) 2025-02-26 → 2024학년도. 요보호 '전년도' 판정도 학년도 기준. (사용자 지시 2026-06-19) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

/* 생년월일 표시 정규화 — NEIS 표준 "YYYY.MM.DD." 강제.
   레거시 데이터(YYYY-MM-DD) 가 들어오면 즉시 변환해서 반환. */
export function normalizeBirthForDisplay(b){
  if(!b)return '';
  const s=String(b).trim();
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return m[1]+'.'+m[2]+'.'+m[3]+'.';
  return s;
}

export function getStu(id){
  /* dataset.arg 는 항상 문자열로 들어오므로 느슨한 비교(==) + 문자열 폴백 허용 */
  const _id=id;const _sid=String(id);
  const _matcher=function(s){return s.uid===_id||s.id===_id||s.uid==_id||s.id==_id||String(s.uid)===_sid||String(s.id)===_sid;};
  /* 1순위: 현재 명단 (S.people) */
  const inActive = S.people.find(_matcher);
  if(inActive) return inActive;
  /* 2순위: 명단에서 빠진 leavers (전출·자퇴·졸업·전근·퇴직). students/staff 행은 보존되어 이름·식별정보 유지.
   *  보건일지 등 과거 기록의 person_uid 가 가리키는 인원을 resolve 하기 위해 별도 캐시에서 fallback. */
  const inLeft = (S.leavers||[]).find(_matcher);
  if(inLeft) return Object.assign({}, inLeft, {_isLeaver:true});
  /* 둘 다 못 찾으면 — 정말 존재하지 않는 ID. placeholder/고아 표시용 fallback. */
  return {name:'(현재 재학 중인 정보가 없습니다)',grade:0,cls:0,num:0,gender:'',status:'normal',condition:'',type:'student',level:'',department:'',_notFound:true};
}
export function isCareStudent(s){
  if(!s||s.type!=='student')return false;
  return s.status==='caution'||s.status==='watch';
}
export function getCareLabel(s){
  if(!isCareStudent(s))return '';
  const curYear=_academicYear();
  return(s.careYear&&s.careYear<curYear)?'전년도 요보호':'요보호';
}
export function getGuardianType(stu){
  if(!stu||stu.type==='staff')return '';
  return String(stu.guardianType||'부').trim()||'부';
}
export function getGuardianContact(stu){
  if(!stu||stu.type==='staff')return '-';
  /* 입력 안 된 보호자 연락처는 빈 문자열로 — 가짜 010-0000-0000 표시 금지 (사용자 요청) */
  return stu.guardianContact||'';
}
export function extractGuardianLabel(rawGuardian,rawContact){
  let src=String(rawGuardian||'').trim();
  if(!src) src=String(rawContact||'').trim();
  if(!src) return '부';
  const m=src.match(/\(([^)]+)\)/);
  if(m&&m[1]&&m[1].trim()) return m[1].trim();
  src=src
    .replace(/주\s*보호자/gi,'')
    .replace(/보호자/gi,'')
    .replace(/연락처/gi,'')
    .replace(/전화번호|전화/gi,'')
    .replace(/[:：]/g,'')
    .replace(/\d{2,3}-\d{3,4}-\d{4}/g,'')
    .trim();
  return src||'부';
}
export function getStudentBirth(stu){
  if(!stu||stu.type==='staff')return '-';
  return stu.birth||'-';
}
export function isBirthdayToday(stu){
  if(!stu||!stu.birth||stu.type==='staff')return false;
  const b=stu.birth.replace(/[^0-9\-]/g,'');
  const parts=b.split('-');if(parts.length<3)return false;
  const bm=parseInt(parts[1],10), bd=parseInt(parts[2],10);
  const now=new Date();
  return bm===now.getMonth()+1&&bd===now.getDate();
}
export function getCareReasonText(stu){
  if(!stu||stu.type==='staff') return '';
  let c=stu.condition;
  if(typeof c==='object'&&c){c=c.condition||c.reason||'요보호';stu.condition=c;}
  return String(c||'').trim();
}
export function getCareMemoText(stu){
  if(!stu||stu.type==='staff') return '';
  return String(stu.careMemo||'').trim();
}
export function getCareTooltipHtml(stu){
  const rawReason=getCareReasonText(stu);
  const memo=getCareMemoText(stu);
  const reasonHtml=(!rawReason||rawReason==='요보호')
    ?'<div style="font-size:10px;color:var(--t1);font-weight:700;text-align:left;margin-bottom:'+(memo?'2':'0')+'px">요보호 정보가 등록되어 있습니다.</div>'
    :'<div style="font-size:10px;color:var(--t1);font-weight:700;text-align:left;margin-bottom:'+(memo?'2':'0')+'px">요보호 질환명: '+escHtml(rawReason)+'</div>';
  return reasonHtml+(memo?'<div style="font-size:10px;color:var(--t1);font-weight:700;text-align:left">메모 사항: '+escHtml(memo)+'</div>':'');
}
export function getStudentNameHoverHtml(stu){
  if(!stu)return '<span class="name-hover-anchor">'+escHtml('')+'</span>';
  if(stu.type==='staff'){
    /* 교직원은 이름에 마우스 호버해도 팝업이 뜨지 않도록 항상 plain 앵커 반환
       (이전: 성별/가족연락처 등이 있으면 name-hover-pop 팝업을 표시했으나
        일반일지 사용 중 방해가 되어 제거) */
    return '<span class="name-hover-anchor" data-ems-popup-id="'+escHtml(stu.id)+'">'+escHtml(stu.name||'')+'</span>';
  }
  const birthRaw=getStudentBirth(stu);
  const birth=birthRaw&&String(birthRaw).trim()&&String(birthRaw).trim()!=='-'?String(birthRaw).trim():'';
  const gContactRaw=getGuardianContact(stu);
  const gContact=gContactRaw&&String(gContactRaw).trim()?String(gContactRaw).trim():'';
  /* 설정(보건일지 설정 > 생년월일·주보호자 연락처 팝업 오픈 설정) OFF 면 입력값이 있어도 hover 팝업 미표시.
   *  사용자 보고 2026-05-28 — OFF 인데 이름 hover 시 여전히 표기되던 버그 (이 함수가 설정을 안 보고 있었음). */
  const _binfoOn = (localStorage.getItem('ec_daily_birthcontact_popup')||'Y') !== 'N';
  /* 설정 OFF 또는 생년월일·주보호자 연락처 둘 다 비어 있으면 hover 팝업 자체를 띄우지 않음 (plain 앵커) */
  if(!_binfoOn || (!birth&&!gContact)){
    return '<span class="name-hover-anchor" data-ems-popup-id="'+escHtml(stu.id)+'">'+escHtml(stu.name||'')+'</span>';
  }
  const birthLine=birth?'<div class="line-main">생년월일: '+escHtml(birth)+'</div>':'';
  const gContactLine=gContact?'<div class="line-sub">주 보호자 연락처: '+escHtml(gContact)+'</div>':'';
  return '<span class="name-hover-wrap" data-stu-id="'+stu.id+'">'
    +'<span class="name-hover-anchor" data-ems-popup-id="'+escHtml(stu.id)+'">'+escHtml(stu.name||'')+'</span>'
    +'<span class="name-hover-pop">'
    +birthLine
    +gContactLine
    +'</span></span>';
}
/** DB row (students JOIN students_info) → 렌더러 형식 변환 (v9 schema) */
export function _dbRowToStudent(r){
  return {
    uid: r.uid,
    id: r.uid,
    name: r.name,
    grade: r.grade,
    /* 등록 학년도 — students_info 가 등록된 학년도(예: '2026'). 증상 팝업 칩 툴팁의 "2026학년도 …" 표기에 사용. */
    school_year: r.school_year || '',
    /* 로드 시 반 정규화 — 기존에 "나래반" 으로 저장된 데이터도 "나래" 로 읽어 표시 시 "나래반반" 중복 방지 (사용자 요청 2026-05-28). */
    cls: normalizeClassInput(r.class_num),
    num: r.student_num,
    gender: r.gender,
    birth: normalizeBirthForDisplay(r.birth_date),
    type: 'student',
    level: r.level || '',
    department: r.department || '',
    guardianType: r.guardian_type || '',
    guardianContact: r.guardian_contact || '',
    homeroomTeacher: r.homeroom_teacher || '',
    status: r.is_care ? 'caution' : 'normal',
    condition: r.care_reason || '',
    careMemo: r.care_memo || '',
    dustDisease: r.dust_disease || '',
    medConsent: r.med_consent || 'Y',
    emergencyConsent: r.emergency_consent || 'Y',
    vip: r.vip || '',
    memoJson: r.memo_json || '{}',
    is_enrolled: r.is_enrolled,
  };
}
/** DB row (staff) → 렌더러 형식 변환 (v9 schema) */
export function _dbRowToStaff(r){
  return {
    uid: r.uid,
    id: r.uid,
    name: r.name,
    type: 'staff',
    position: r.position || '',
    gender: r.gender || '',
    familyRelation: r.family_relation || '',
    familyPhone: r.family_phone || '',
    vip: r.vip || '',
    grade: 0, cls: 0, num: 0, birth: '', level: '', department: '',
    status: 'normal',
  };
}

/* ── DB 재로드용 내부 버퍼 ── */
let _loadedStudents = [];
let _loadedStaff = [];

/** DB에서 학생+교직원 다시 로드 → in-memory people 갱신 + leavers 함께 적재 (2026-05-18).
 *
 *  명단 표시용 S.people: 현재 활성(students_info.is_enrolled=1 / staff.is_active=1) 만.
 *  보건일지 행의 person_uid 가 명단에서 빠진 학생/교직원을 가리키는 경우를 위해
 *  S.leavers 에도 함께 적재 — getStu 의 fallback 으로 사용. */
export function _reloadStudentsFromDB(){
  if(!window.electronAPI) return Promise.resolve();
  const api = window.electronAPI;
  const stuFn = api.studentsGetAll || api.peopleGetAll;
  if(!stuFn) return Promise.resolve();
  const stuPromise = stuFn().then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){
      _loadedStudents = res.data.map(_dbRowToStudent);
    }
  }).catch(function(err){ console.error('[DB] students 로드 예외:', err); });

  const staffPromise = api.staffGetAll ? api.staffGetAll().then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){
      _loadedStaff = res.data.map(_dbRowToStaff);
    }
  }).catch(function(err){ console.error('[DB] staff 로드 예외:', err); })
  : Promise.resolve();

  /* leavers — 모든 학년도·재직 상태를 통째로 조회 후 활성 명단(S.people) 에 없는 인원만 추림.
   *  학생: studentsGetAllHistorical (students + 가장 최근 students_info LEFT JOIN, 학년도 무관).
   *  교직원: staffGetAllHistorical (staff 행 전부, school_year 필터 없음).
   *  학년도가 바뀌어 명단을 새로 올린 뒤에도, 작년 등록자들이 leavers 에 들어가 보건일지의 person_uid 해석 유지. */
  let _leaverStudents = [];
  let _leaverStaff = [];
  const stuHistFn = api.studentsGetAllHistorical;
  const stuHistPromise = stuHistFn ? stuHistFn().then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){
      _leaverStudents = res.data.map(_dbRowToStudent);
    }
  }).catch(function(err){ console.error('[DB] students(historical) 로드 예외:', err); })
  : Promise.resolve();
  const staffHistFn = api.staffGetAllHistorical;
  const staffHistPromise = staffHistFn ? staffHistFn().then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){
      _leaverStaff = res.data.map(_dbRowToStaff);
    }
  }).catch(function(err){ console.error('[DB] staff(historical) 로드 예외:', err); })
  : Promise.resolve();

  return Promise.all([stuPromise, staffPromise, stuHistPromise, staffHistPromise]).then(function(){
    S.people = _loadedStudents.concat(_loadedStaff);
    /* leavers = historical - 현재 활성 (uid 기준) 차집합 */
    const _activeUids = {};
    S.people.forEach(function(p){ if(p&&p.uid) _activeUids[String(p.uid)] = true; });
    const _hist = _leaverStudents.concat(_leaverStaff);
    S.leavers = _hist.filter(function(p){ return p && p.uid && !_activeUids[String(p.uid)]; });
  });
}

/* ── 학년/학교급 헬퍼 ── */
export function getStuGradeCol(s,opts){
  if(!s) return '-';
  const short=(opts&&opts.short);
  const sl=S.settings.schoolLevel||'elementary';
  if(s.type==='staff') return s.position||'교직원';
  if(sl==='kindergarten'){
    if(short) return (s.grade?s.grade+'세':'-')+(s.cls?' '+s.cls+'반':'');
    return (s.grade?s.grade+'세':'-')+(s.cls?' '+s.cls+'반':'');
  }
  if(sl==='special'){
    const stuLv=s.level||'';
    const lvA=stuLv||'특';
    if(stuLv==='유'){
      if(short) return lvA+(s.grade?s.grade+'세':'')+(s.cls?' '+s.cls+'반':'');
      return '유'+(s.grade?s.grade+'세':'-')+(s.cls?' '+s.cls+'반':'');
    }
    const dept=s.department||'';
    if(dept){
      if(short) return lvA+(s.grade||'')+(s.cls?'-'+s.cls:'')+(dept?' '+dept:'');
      return lvA+(s.grade?s.grade:'-')+(s.cls?'-'+s.cls:'')+(dept?' '+dept:'');
    }
    if(short) return lvA+(s.grade||'')+(s.cls?'-'+s.cls:'');
    return lvA+(s.grade?s.grade:'-')+(s.cls?'-'+s.cls:'');
  }
  if(short) return (s.grade||'-')+(s.cls?'-'+s.cls:'');
  return (s.grade?s.grade+'학년':'-')+(s.cls?s.cls+'반':'');
}
/* 학교 내 학교급이 여러 개 혼재하는지 감지 (유+초, 초+중 등) — S.people의 student 레벨값 수집 */
export function hasMultipleSchoolLevels(){
  try{
    const set={};
    (S.people||[]).forEach(function(s){
      if(!s||s.type==='staff')return;
      const lv=s.level||'';
      if(lv)set[lv]=true;
    });
    return Object.keys(set).length>=2;
  }catch(e){return false;}
}
/* 이 학교 명단에 학과(department) 정보가 하나라도 있는지 — 학과를 쓰는 학교(특성화고 등) 판별.
   사람 미선택 빈 양식에서도 학과 입력란을 띄울지 결정하는 데 사용. */
export function hasAnyDepartment(){
  try{
    return (S.people||[]).some(function(s){ return s && s.type!=='staff' && (((s.department||'')+'').trim()); });
  }catch(e){return false;}
}
/* 학교급 표준화 (elementary → 초, kindergarten → 유 등) */
const _LV_MAP_SHORT={'elementary':'초','middle':'중','high':'고','kindergarten':'유','초':'초','중':'중','고':'고','유':'유','대':'대'};
export function getLevelShort(s){
  if(!s)return '';
  return _LV_MAP_SHORT[s.level]||s.level||'';
}
/* 자동완성·검색 결과용 학생 소속 문자열 생성
   우선순위:
     1) 학과가 있으면 학과명을 prefix 로 (고/대 학생 — 예: "지형공간디자인과 1학년 1반 2번 김재웅")
     2) 다중 학교급 학교(유+초, 초+중 등) 또는 특수학교면 학교급 prefix (예: "초 1학년 1반 1번")
     3) 단일 학교급 학교: prefix 없음 (예: "1학년 1반 6번")
   유치원: "5세 꽃잎 반" 형태로 학년 대신 만 나이 표시 */
export function getStuAutoLine(s,opts){
  if(!s)return '';
  if(s.type==='staff')return (s.position||'교직원');
  const opt=opts||{};
  const multi=opt.multiLevel!=null?opt.multiLevel:hasMultipleSchoolLevels();
  const isSpecial=(S.settings&&S.settings.schoolLevel)==='special';
  const lv=getLevelShort(s);
  const dept=s.department||'';
  let prefix='';
  if(dept){
    prefix=dept+' ';
  } else if((multi||isSpecial) && lv){
    prefix=lv+' ';
  }
  if(lv==='유'){
    const age=s.grade?s.grade+'세':'';
    const cls=s.cls?' '+s.cls+'반':'';
    const num=s.num?' '+s.num+'번':'';
    return prefix+age+cls+num;
  }
  return prefix+(s.grade||'-')+'학년 '+(s.cls||'-')+'반 '+(s.num||'-')+'번';
}
export function isKinder(){ return (S.settings&&S.settings.schoolLevel)==='kindergarten'; }
export function gradeLabel(g){ return isKinder()?('만'+g+'세'):(g+'학년'); }
export function gradeClsLabel(g,c){ return isKinder()?('만'+g+'세 '+c+'반'):(g+'학년 '+c+'반'); }

/* 학급(반) 비교 — 숫자 반은 숫자순(1,2,10), 한글 반은 가나다순(가람,나래,다솜), 혼재 시 숫자 먼저.
 *  사용자 요청 2026-05-28: 일부 초등학교가 한글 학급명을 씀. localeCompare 단독은 "1","10","2" 로
 *  깨지므로 순수 숫자 여부를 먼저 판정해 숫자끼리는 수치 비교한다. 정렬 비교 함수로 사용. */
export function compareClass(a, b){
  const sa = String(a == null ? '' : a).trim();
  const sb = String(b == null ? '' : b).trim();
  const aNum = /^\d+$/.test(sa);
  const bNum = /^\d+$/.test(sb);
  if(aNum && bNum) return parseInt(sa, 10) - parseInt(sb, 10);
  if(aNum) return -1;   /* 숫자 반을 한글 반보다 앞에 */
  if(bNum) return 1;
  return sa.localeCompare(sb, 'ko');
}

/* 반(학급) 입력 정규화 — 사용자가 "나래반"·"1반" 처럼 '반' 접미사를 붙여 입력해도 끝의 '반' 을 떼어
 *  "나래"·1 로 저장한다. 화면 표시 시 코드가 '반' 을 자동 부착하므로 "나래반반" 중복을 방지 (사용자 요청 2026-05-28).
 *  순수 숫자는 정수, 그 외 텍스트는 문자열, 빈 값은 ''. 모든 반 입력 지점(개별/수정/엑셀 업로드)에서 공용 사용. */
export function normalizeClassInput(raw){
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/\s*반$/, '');   /* 끝의 '반' 1회 제거 ("반딧불"처럼 끝이 '반' 이 아니면 보존) */
  if(s === '') return '';
  return /^\d+$/.test(s) ? parseInt(s, 10) : s;
}
