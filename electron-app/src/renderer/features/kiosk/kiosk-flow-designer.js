/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   KIOSK FLOW DESIGNER — 키오스크 플로우 설계
   계층적 섹션 기반의 키오스크 흐름 시각 편집기
   ═══════════════════════════════════════ */
/* ES Module */
let _skipSettingsAnim = false;
import { getStu, escHtml, closeModalGracefully } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { renderSettingsPanel, openAdvancedSearch } from '../settings/settings-view.js';
import { openEmojiPicker } from './kiosk-emoji-picker.js';
import { downloadKioskHtml, openKioskPreview, reloadKioskPreview, generateKioskUrl } from './kiosk-html-builder.js';
import { kioskLangs } from './kiosk-translation.js';
import { getSymData, getEffectiveSymCats, getEffectiveSymCatById, getEffectiveSymCatsWithSyms, _symOpenAddOptionsModal, _symOpenDrugDoseMiniPicker, _symPrompt } from '../symptom/symptom-view.js';
import { rentalGetItems, rentalAddItem } from '../daily/rental-ledger-view.js';
/* 순환 의존성 해소: cms-view 함수를 콜백으로 주입 */
let _cbRefreshFlowPopupFn = null;
let _cbRefreshPreviewFn = null;
export function setFdCallbacks(cbs){
  if(cbs.refreshFlowPopup) _cbRefreshFlowPopupFn = cbs.refreshFlowPopup;
  if(cbs.refreshPreview) _cbRefreshPreviewFn = cbs.refreshPreview;
}
function _cbRefreshFlowPopup(){ return _cbRefreshFlowPopupFn ? _cbRefreshFlowPopupFn() : false; }
import { S, DEFAULT_RELAY_URL, saveKioskSettings } from '../../core/app-state.js';
'use strict';

const ks = S.kioskSettings;
function _save(){ saveKioskSettings(); }

/* ── 플로우 디자이너 열기/닫기 상태 ── */
const _fdOpen = false;

/* ── 자동 저장 디바운스 ── */
let _fdSaveTimer = null;

/* ══ 전역 변수 최소화 — 외부 미사용 state는 IIFE 로컬로 ══
 * 다음 변수들은 이전에 window.* 로 노출됐으나 외부에서 접근하지 않음을 확인하고
 * IIFE 로컬 변수로 전환됨. 향후 추가 정리 시 동일 원칙 적용:
 *   1) grep으로 외부 file 접근 확인 → 없으면 local로
 *   2) 이벤트 핸들러로 onclick에서 호출되는 함수만 window 노출 유지 */
let _fdMiniTip = null;
let _fdFocusedSecId = null;
const _fdUndoStack = [];
let _fdRedoStack = [];
let _fdExpandedItem = null;
let _fdHotkeysAttached = false;
function _fdAutoSave(){
  clearTimeout(_fdSaveTimer);
  /* 마지막 리프 항목에 대기인원+확인버튼 자동 삽입 */
  _fdAutoInsertTerminalFlags();
  /* 실제 편집 자동저장 → "저장 중→모든 내용이 저장되었습니다" 토스트 (사용자 요청 2026-06-15) */
  try{ bus.emit('toast:saveLater'); }catch(_){}
  _fdSaveTimer = setTimeout(function(){
    _save();
    try{ bus.emit('toast:save'); }catch(_){}
  }, 400);
}

/* 대기 중인 디바운스 저장을 즉시 비운다(flush). 흐름 설계 모달을 외부 클릭/✕ 로 닫을 때 호출 →
   '입력 직후 400ms 안에 닫으면 마지막 변경이 날아가던' 문제 방지(자동저장 철학). 멱등. (사용자 보고 2026-06-30) */
export function _fdFlushSave(){
  if(_fdSaveTimer){ clearTimeout(_fdSaveTimer); _fdSaveTimer = null; }
  try{ _fdAutoInsertTerminalFlags(); }catch(_){}
  _save();
  try{ bus.emit('toast:save'); }catch(_){}
}

/* 마지막 리프 항목에 대기인원+확인버튼 자동 설정 */
function _fdAutoInsertTerminalFlags(){
  var flow = ks.flowDesigner;
  if(!flow || !flow.sections) return;
  flow.sections.forEach(function(sec){
    if(!sec.options || !sec.options.length) return;
    sec.options.forEach(function(opt, oi){
      var isLast = (oi === sec.options.length - 1);
      var isTerminal = !opt.target || opt.target.indexOf('__') === 0;
      if(isLast && isTerminal && opt.target === '__nurse'){
        opt.hasWaitQueueInsert = true;
        opt.hasConfirmBtnInsert = true;
      } else if(isLast && isTerminal){
        opt.hasConfirmBtnInsert = true;
      }
    });
  });
}

/* ══════════════════════════════════════════
   기본 플로우 데이터 구조
   ══════════════════════════════════════════ */

/* 번들 JSON 템플릿 캐시 (비동기 로드 1회) */
let _defaultFlowCache = null;   /* 확장형 (kiosk-flow-default.json) */
let _basicFlowCache = null;     /* 기본형 (kiosk-flow-basic.json) */

async function _fdLoadDefaultTemplate(){
  if(_defaultFlowCache && _basicFlowCache) return _defaultFlowCache;
  try {
    const [resExt, resBasic] = await Promise.all([
      window.electronAPI.readFile('__app__/templates/kiosk-flow-default.json'),
      window.electronAPI.readFile('__app__/templates/kiosk-flow-basic.json')
    ]);
    if(resExt && resExt.success && resExt.data){
      _defaultFlowCache = JSON.parse(resExt.data);
    }
    if(resBasic && resBasic.success && resBasic.data){
      _basicFlowCache = JSON.parse(resBasic.data);
    }
    return _defaultFlowCache;
  } catch(e){ console.warn('[kiosk] 디폴트 플로우 템플릿 로드 실패, 인라인 폴백 사용:', e.message); }
  return null;
}

function _fdGetFlow(){
  if(ks.flowDesigner){
    _fdMigrateFlow(ks.flowDesigner);
    return ks.flowDesigner;
  }
  /* 기본 플로우 생성 — 캐시된 템플릿 우선, 없으면 인라인 폴백 */
  const tpl = _defaultFlowCache;
  const flow = tpl ? JSON.parse(JSON.stringify(tpl)) : _fdBuildDefaultFlowInline();
  ks.flowDesigner = flow;
  _save();
  return flow;
}

/* ── 태그 = 이 항목의 접수를 프로그램의 어느 기능에 연결할지 (드롭다운 선택, 사용자 결정 2026-06-12) ──
 *  자유 입력 폐지 → 5종 고정 (2026-06-13: 물품 대여 반납필요/불필요 → "물품 대여"로 통합,
 *  반납 여부는 하위 항목별 드롭다운에서 선택). 각 항목 호버 시 공용 미니팝업(data-tooltip)으로 동작 설명. */
export var FD_TAGS = [
  {label:'진료/처치',  tip:'방문자가 입력하는 대로 보건일지에 자동 등록되게 합니다.'},
  {label:'물품 대여',  tip:'방문자가 대여해갈 물품을 선택하도록 합니다.'},
  {label:'물품 반납',  tip:'방문자가 반납을 입력하면 보건실 물품 대여 대장에서 반납 처리됩니다.'},
  {label:'상담',       tip:'방문자가 입력하는 대로 보건일지에 자동 등록되며 상담록을 작성할 수 있습니다.'},
  {label:'기타',       tip:'방문 내역이 프로그램에 남지 않습니다.'}
];

/* 하위 항목 기능 드롭다운들의 선택지 (2026-06-13) */
var FD_RETURN_OPTS = [
  {value:true,  label:'반납 필요',   tip:'방문자가 입력하는 대로 물품 대여 대장에 입력합니다.'},
  {value:false, label:'반납 불필요', tip:'반납이 불필요한 물품 대여이므로 보건실 물품 대여 대장에 입력되지 않습니다.'}
];
var FD_DIARY_OPTS = [
  {value:true,  label:'보건일지에 등록',   tip:'방문자가 입력하는 대로 보건일지에 인적사항, 증상, 처치에 등록합니다.'},
  {value:false, label:'보건일지에 미등록', tip:'방문자가 입력한 것을 보건일지에 등록하지 않습니다.'}
];
/* 바디맵 터치 모드 — 바디맵 칩 클릭 시 드롭다운 (사용자 설계 2026-06-13) */
var FD_BM_MODES = [
  {value:'check',     label:'원터치로 부위 체크만 넣기',        tip:'방문자가 불편한 부위를 한 번 터치하면 체크 표시가 생깁니다.'},
  {value:'nrs',       label:'원터치로 통증척도만 넣기',         tip:'방문자가 불편한 부위를 한 번 터치하면 통증 척도를 넣을 수 있으며 접수 우선순위 결정에 도움이 됩니다.'},
  {value:'check_nrs', label:'원터치 체크, 더블 터치 통증척도',   tip:'방문자가 불편한 부위에 한 번 터치하면 체크 표시, 두 번 터치하면 통증척도를 넣을 수 있습니다.'},
  {value:'nrs_check', label:'원터치 통증척도, 더블터치 체크',    tip:'방문자가 불편한 부위에 한 번 터치하면 통증척도, 두 번 터치하면 체크를 넣을 수 있습니다.'}
];
/* 대기 모드 — 옛 "접수" 체크박스 대체 (사용자 결정 2026-06-13). 접수는 항상 전송되고, 대기 인원 카운트 여부만 가름. */
var FD_WAIT_OPTS = [
  {value:'wait',   label:'대기하게 하기',     tip:'방문자가 대기하도록 하며 호출 시 보건교사에게 오도록 합니다.', edit:true},
  {value:'direct', label:'바로 들어오게 하기', tip:'방문자가 대기하지 않고 바로 들어가도록 합니다.', edit:true}
];
var FD_DONE_MSG_DEFAULTS = {
  wait:   '접수 완료! 호출될 때까지 기다려주세요.',
  direct: '접수 완료! 바로 들어오세요!'
};

/* 기존 저장 데이터에 enabled/isDefault/tag 필드 보충 (멱등) */
var _defaultTags = {o_p1:'진료/처치',o_p2:'물품 대여',o_p3:'물품 반납',o_p4:'기타',o_p5:'상담'};
/* 옛 자유 태그 → 새 고정 라벨 1회 이행 (2026-06-12) */
var _tagV2Map = {'진료':'진료/처치','대여':'물품 대여','반납':'물품 반납','문의':'기타','상담':'상담'};
/* 외부(설정 패널·빌더 경로)에서도 저장 흐름 마이그레이션을 적용할 수 있게 export (2026-06-13).
 *  — 편집기를 열지 않고 바로 QR 생성하면 옛 흐름(s_nurse_meet 가이드 등)이 그대로 빌드되던 버그 수정. */
export function fdMigrateFlow(flow){ _fdMigrateFlow(flow); }
function _fdMigrateFlow(flow){
  if(!flow || !flow.sections) return;
  let dirty = false;
  /* 확장형 기본 제공 "생리통" 제거 — 사용자 결정 2026-06-11. 이미 저장된 flow 에서도 1회 제거(멱등, 플래그로 재실행 무해). */
  if(!flow._migRmPeriod){
    flow.sections.forEach(function(sec){
      if(sec.options){
        const _b=sec.options.length;
        sec.options = sec.options.filter(function(o){ return String(o.label||'').indexOf('생리통')===-1 && o.target!=='s_period_pain'; });
        if(sec.options.length!==_b) dirty = true;
      }
    });
    const _bs=flow.sections.length;
    flow.sections = flow.sections.filter(function(s){ return s.id!=='s_period_pain' && String(s.headerName||'').indexOf('생리통')===-1; });
    if(flow.sections.length!==_bs) dirty = true;
    flow._migRmPeriod = true; dirty = true;
  }
  /* "문의 & 알려드릴 게 있어서 왔어요" 폐지 → 하위 항목을 상담 섹션으로 이동 (사용자 결정 2026-06-12).
   *  이미 저장된 flow 에도 1회 적용(멱등). 기본 3종(동아리/수업/약품 사용 관련)은 "~ 상담" 명칭으로,
   *  사용자가 추가한 커스텀 항목은 라벨 그대로 상담 아래로 이동. */
  if(!flow._migInquiryToCounsel){
    const inq = flow.sections.find(function(s){ return s.id==='s_inquiry'; });
    const cns = flow.sections.find(function(s){ return s.id==='s_counsel'; });
    if(inq){
      if(cns){
        if(!cns.options) cns.options = [];
        const _renameMap = {'동아리 관련':'동아리 관련 상담','수업 관련':'수업 관련 상담','약품 사용 관련':'약품 사용 관련 상담'};
        (inq.options||[]).forEach(function(o){
          const newLabel = _renameMap[String(o.label||'').trim()] || o.label;
          /* 같은 라벨이 이미 상담에 있으면 중복 추가 안 함 */
          if(cns.options.some(function(c){ return String(c.label||'').trim()===String(newLabel||'').trim(); })) return;
          /* 기타 고민 거리 상담 앞에 삽입 — 없으면 끝에 */
          const ins = { id:o.id, label:newLabel, emoji:o.emoji||'💬', target:'__done', enabled:(o.enabled!==false), isDefault:o.isDefault!==false };
          const etcIdx = cns.options.findIndex(function(c){ return String(c.label||'').indexOf('기타 고민')!==-1; });
          if(etcIdx>=0) cns.options.splice(etcIdx,0,ins); else cns.options.push(ins);
        });
      }
      /* 문의 섹션 + 방문 목적의 진입 옵션 제거 */
      flow.sections = flow.sections.filter(function(s){ return s.id!=='s_inquiry'; });
      flow.sections.forEach(function(sec){
        if(sec.options){
          sec.options = sec.options.filter(function(o){ return o.target!=='s_inquiry'; });
        }
      });
    }
    flow._migInquiryToCounsel = true; dirty = true;
  }
  /* 옛 자유 태그 → 새 6종 고정 라벨 1회 이행 (사용자 결정 2026-06-12). 매칭 안 되는 커스텀 태그는 그대로 둠. */
  if(!flow._migTagV2){
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.tag && _tagV2Map[o.tag]){ o.tag = _tagV2Map[o.tag]; dirty = true; }
      });
    });
    flow._migTagV2 = true; dirty = true;
  }
  /* ── 물품 대여 태그 통합 + 하위 기능 메타 보충 (사용자 결정 2026-06-13) ──
   *  · '물품 대여(반납 필요/불필요)' → '물품 대여' 통합. 반납 여부는 하위 항목별 returnNeeded 로.
   *  · 기본 제공 항목들에 diaryRegister / returnNeeded / rentalItem / counselTopic 1회 보충.
   *  · 기본 대여 흐름에 아이스팩 없으면 주입 (대장 기본 물품과 짝). */
  if(!flow._migFnMeta1){
    /* 진입 옵션 target 의 하위 섹션 트리 id 수집 */
    var _descSecIds=function(rootSecId){
      var ids={}; var stack=[rootSecId];
      while(stack.length){
        var cur=stack.pop(); if(ids[cur])continue; ids[cur]=1;
        flow.sections.forEach(function(s){ if(s.parentId===cur && !ids[s.id]) stack.push(s.id); });
      }
      return ids;
    };
    /* ① 기본 항목 메타 보충 (id 기준 — 커스텀 항목은 안 건드림). 태그 통합의 트리 일괄 부여보다
     *  반드시 먼저 — 핫팩(o_b6) 등이 옛 '(반납 불필요)' 트리값으로 덮이는 것 방지.
     *  waitMode 기본: 혼자 처치·소모품 대여=바로 들어오게 / 처치 필요·핫팩·아이스팩·반납·상담=대기 (사용자 설계 2026-06-13) */
    var _metaById={
      o_d1:{diaryRegister:true, waitMode:'direct'}, o_d3:{diaryRegister:true, waitMode:'wait'},
      o_st1:{diaryRegister:true, waitMode:'direct'}, o_st2:{diaryRegister:true, waitMode:'direct'}, o_st3:{diaryRegister:true, waitMode:'direct'}, o_st4:{diaryRegister:true, waitMode:'direct'},
      o_b1:{returnNeeded:false, waitMode:'direct'}, o_b2:{returnNeeded:false, waitMode:'direct'}, o_b3:{returnNeeded:false, waitMode:'direct'}, o_b4:{returnNeeded:false, waitMode:'direct'}, o_b5:{returnNeeded:false, waitMode:'direct'},
      o_b6:{returnNeeded:true, rentalItem:'핫팩', waitMode:'wait'},
      o_r1:{rentalItem:'핫팩', waitMode:'wait'}, o_r2:{rentalItem:'아이스팩', waitMode:'wait'}
    };
    /* 상담 주제 — 기본 라벨 매칭으로 보충. 값은 반드시 '증상 선택 및 처치'의 상담(counsel) 중분류와 글자까지 일치해야
     *  일지 등록 시 상담으로 인식돼 상담록이 뜬다. 실제 중분류는 "학업/진로"(medical-data.json)이므로 '학업'→'학업/진로' (사용자 보고 2026-06-14). */
    var _topicByLabel={
      '친구 관계에 관한 상담':'친구관계','건강에 대한 상담':'건강','동아리 관련 상담':'동아리',
      '수업 관련 상담':'수업','약품 사용 관련 상담':'약품사용',
      '학업, 진로 관련 상담':'학업/진로','학업 등 기타 고민에 관한 상담':'학업/진로','학업에 대한 상담':'학업/진로','기타 고민 거리 상담':'학업/진로'
    };
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        var m=_metaById[o.id];
        if(m){ Object.keys(m).forEach(function(k){ if(o[k]===undefined){ o[k]=m[k]; dirty=true; } }); }
        if(sec.id==='s_counsel'){
          if(o.counselTopic===undefined && _topicByLabel[String(o.label||'').trim()]){
            o.counselTopic=_topicByLabel[String(o.label||'').trim()]; dirty=true;
          }
          if(o.waitMode===undefined){ o.waitMode='wait'; dirty=true; }   /* 상담 하위 전부 대기 (사용자 설계 2026-06-13) */
        }
      });
    });
    /* ② 옛 분리형 태그 → '물품 대여' 통합 + 하위 트리(커스텀 항목)에 returnNeeded 일괄 부여 (미정의분만) */
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.tag==='물품 대여(반납 필요)' || o.tag==='물품 대여(반납 불필요)'){
          var _need=(o.tag==='물품 대여(반납 필요)');
          o.tag='물품 대여'; dirty=true;
          if(o.target && String(o.target).indexOf('__')!==0){
            var _ids=_descSecIds(o.target);
            flow.sections.forEach(function(s){
              if(!_ids[s.id])return;
              (s.options||[]).forEach(function(c){ if(c.returnNeeded===undefined){ c.returnNeeded=_need; } });
            });
          }
        }
      });
    });
    /* ③ 아이스팩 대여 옵션 주입 — 기본 대여 섹션(s_borrow)에 없을 때만 */
    var _bor=flow.sections.find(function(s){ return s.id==='s_borrow'; });
    if(_bor && _bor.options && !_bor.options.some(function(o){ return String(o.label||'').trim()==='아이스팩'; })){
      _bor.options.push({ id:'o_b7', label:'아이스팩', emoji:'🧊', target:'__deadline', returnNeeded:true, rentalItem:'아이스팩', waitMode:'wait', enabled:true, isDefault:true });
      dirty=true;
    }
    flow._migFnMeta1 = true; dirty = true;
  }
  /* 상담 주제 값 교정 (사용자 보고 2026-06-14) — 옛 마이그/저장으로 counselTopic="학업" 이 박힌 흐름을 실제 상담 중분류 "학업/진로" 로.
   *  값이 상담 중분류와 글자까지 일치해야 일지 등록 시 상담으로 인식돼 상담록이 뜬다. */
  if(!flow._migCounselTopic2){
    flow.sections.forEach(function(sec){
      if(sec.id!=='s_counsel')return;
      (sec.options||[]).forEach(function(o){
        if(o.counselTopic==='학업'){ o.counselTopic='학업/진로'; dirty=true; }
      });
    });
    flow._migCounselTopic2=true; dirty=true;
  }
  /* 기본 이모지 교체 (사용자 요청 2026-06-14) — 옛 기본값만 새 기본값으로. 사용자가 따로 바꾼 이모지는 값이 달라 안 건드림.
   *  👩‍⚕️(여자 보건교사)→🧑‍⚕️(성별 중립), 🩱(수영복)→🌸(생리대). */
  if(!flow._migEmoji1){
    var _emojiRemap={'👩‍⚕️':'🧑‍⚕️','🩱':'🌸'};
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.emoji && _emojiRemap[o.emoji]){ o.emoji=_emojiRemap[o.emoji]; dirty=true; }
        if(o.guideEmoji && _emojiRemap[o.guideEmoji]){ o.guideEmoji=_emojiRemap[o.guideEmoji]; dirty=true; }
      });
    });
    flow._migEmoji1=true; dirty=true;
  }
  /* "보건 선생님의 처치가 필요합니다"(o_d3) → 클릭 즉시 접수. 반드시 guide 흡수(_migGuideMsg)보다 먼저 —
   *  순서가 뒤면 s_nurse_meet 가이드가 o_d3.guideMsg 로 흡수되어 "호출되면 들어오세요"+확인 팝업이 또 뜸 (사용자 보고 2026-06-13).
   *  플래그 v2 — 순서 버그로 이미 guideMsg 가 박힌 PC 도 재실행해 잔재 제거. */
  if(!flow._migNurseDirect2){
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.id==='o_d3'){
          if(o.target==='s_nurse_meet'){ o.target='__nurse'; dirty=true; }
          /* 흡수 잔재 제거 — o_d3 는 안내 팝업 없이 즉시 접수 */
          if(o.guideMsg!==undefined){ delete o.guideMsg; delete o.guideEmoji; dirty=true; }
        }
      });
    });
    var _stillRefNm=flow.sections.some(function(s){ return (s.options||[]).some(function(o){ return o.target==='s_nurse_meet'; }); });
    if(!_stillRefNm){ flow.sections=flow.sections.filter(function(s){ return s.id!=='s_nurse_meet'; }); }
    flow._migNurseDirect2=true; dirty=true;
  }
  /* 바디맵 위치 이동 (사용자 결정 2026-06-13) — "불편한 곳이 있어요"(o_p1)에서 해제하고
   *  "혼자 처치할 수 있어요"(o_d1)·"보건 선생님의 처치가 필요합니다"(o_d3)에 체크 → 둘 중 하나를 고르면 바디맵.
   *  + 기본 항목들의 hasConfirmBtnInsert 잔재 해제 — ✅확인 화면이 접수 팝업과 중복으로 뜨던 문제. */
  if(!flow._migBmMove1){
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.id==='o_p1' && o.hasBodymapInsert){ delete o.hasBodymapInsert; dirty=true; }
        if((o.id==='o_d1' || o.id==='o_d3') && !o.hasBodymapInsert){ o.hasBodymapInsert=true; dirty=true; }
        /* 기본 제공 항목의 ✅확인 중간 화면 잔재 제거 (접수 완료 팝업으로 통합) */
        if(/^o_(d\d|st\d|b\d|r\d|c\d)$/.test(String(o.id||'')) && o.hasConfirmBtnInsert){ delete o.hasConfirmBtnInsert; dirty=true; }
      });
    });
    flow._migBmMove1=true; dirty=true;
  }
  /* 바디맵 터치 모드 기본값 (사용자 설계 2026-06-13) — 혼자 처치=원터치 체크만, 처치 필요=원터치 통증척도만. 1회 보충(이후 커스텀 보존). */
  if(!flow._migBmMode1){
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.id==='o_d1' && o.bodymapMode===undefined){ o.bodymapMode='check'; dirty=true; }
        if(o.id==='o_d3' && o.bodymapMode===undefined){ o.bodymapMode='nrs'; dirty=true; }
      });
    });
    flow._migBmMode1=true; dirty=true;
  }
  /* guide 섹션(중간 안내 화면) → 옵션 guideMsg 필드로 흡수 (사용자 결정 2026-06-13).
   *  방문자가 옵션 클릭 시 안내문 팝업 표시. 편집기에서 "안내문구" 칩으로 켜고 끔. 멱등(1회). */
  if(!flow._migGuideMsg){
    var _guides={};
    flow.sections.forEach(function(s){ if(s.type==='guide')_guides[s.id]=s; });
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        var g=_guides[o.target];
        if(g){
          if(o.guideMsg===undefined)o.guideMsg=g.guideText||'';
          if(o.guideEmoji===undefined)o.guideEmoji=g.guideEmoji||o.emoji||'📋';
          o.target=(g.options&&g.options[0]&&g.options[0].target)||'__self_reset';
          dirty=true;
        }
      });
    });
    /* 흡수 후 참조 안 되는 guide 섹션 제거 */
    var _refs={};
    flow.sections.forEach(function(s){ (s.options||[]).forEach(function(o){ if(o.target)_refs[o.target]=1; }); });
    flow.sections=flow.sections.filter(function(s){ return !(s.type==='guide' && !_refs[s.id]); });
    flow._migGuideMsg=true; dirty=true;
  }
  /* "보건 선생님의 처치가 필요합니다"(o_d3) → 중간 안내화면 없이 클릭 즉시 접수 (사용자 결정 2026-06-13).
   *  target 을 s_nurse_meet(가이드) → __nurse 로 바꾸고, 더 이상 참조 없는 s_nurse_meet 가이드 섹션 제거. */
  if(!flow._migNurseDirect){
    var _hadNurseMeet=false;
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(o.id==='o_d3' && o.target==='s_nurse_meet'){ o.target='__nurse'; _hadNurseMeet=true; dirty=true; }
      });
    });
    /* s_nurse_meet 을 target 하는 다른 옵션이 없을 때만 섹션 제거 (커스텀 흐름 방어) */
    var _stillRef=flow.sections.some(function(s){ return (s.options||[]).some(function(o){ return o.target==='s_nurse_meet'; }); });
    if(!_stillRef){ flow.sections=flow.sections.filter(function(s){ return s.id!=='s_nurse_meet'; }); }
    flow._migNurseDirect=true; dirty=true;
  }
  /* "보건 선생님의 도움이 필요합니다." → "보건 선생님의 처치가 필요합니다." (사용자 결정 2026-06-12). 저장된 flow 도 1회 교체(멱등). */
  if(!flow._migNurseTreatLabel){
    flow.sections.forEach(function(sec){
      (sec.options||[]).forEach(function(o){
        if(String(o.label||'')==='보건 선생님의 도움이 필요합니다.'){ o.label='보건 선생님의 처치가 필요합니다.'; dirty = true; }
      });
    });
    flow._migNurseTreatLabel = true; dirty = true;
  }
  flow.sections.forEach(function(sec){
    if(sec.enabled === undefined){ sec.enabled = true; dirty = true; }
    if(sec.isDefault === undefined){ sec.isDefault = true; dirty = true; }
    if(sec.options){
      sec.options.forEach(function(opt){
        if(opt.enabled === undefined){ opt.enabled = true; dirty = true; }
        if(opt.isDefault === undefined){ opt.isDefault = true; dirty = true; }
        /* 방문 목적 태그 기본값 보충 */
        if(sec.id==='s_purpose' && !opt.tag && _defaultTags[opt.id]){
          opt.tag = _defaultTags[opt.id]; dirty = true;
        }
      });
    }
  });
  /* 아이스팩 반납 옵션 1회 주입 — 기존 저장 플로우에도 추가. 사용자가 이후 삭제하면 플래그로 재주입 방지 */
  if(!flow._migIceReturn){
    const ret = flow.sections.find(function(s){ return s.id==='s_return'; });
    if(ret){
      if(!ret.options) ret.options = [];
      if(!ret.options.some(function(o){ return o.id==='o_r2' || o.label==='아이스팩 반납'; })){
        ret.options.push({ id:'o_r2', label:'아이스팩 반납', emoji:'🧊', target:'s_return_guide2', enabled:true, isDefault:true });
      }
      if(!flow.sections.some(function(s){ return s.id==='s_return_guide2'; })){
        flow.sections.push({ id:'s_return_guide2', headerName:'아이스팩 반납', type:'guide', depth:2, parentId:'s_return', enabled:true, isDefault:true, guideText:'원래 가져간 곳에 다시 넣어두세요.', guideEmoji:'📦', options:[{ id:'o_rg2', label:'안내', emoji:'📋', target:'__self_reset', enabled:true, isDefault:true }] });
      }
      flow._migIceReturn = true;
      dirty = true;
    }
  }
  if(dirty) _fdAutoSave();
}

/* 비동기 초기화 — 모듈 로드 시 템플릿 프리로드 */
_fdLoadDefaultTemplate();

/* 인라인 폴백 (템플릿 파일 로드 실패 시) — 최소 구조만 유지 */
function _fdBuildDefaultFlowInline(){
  return { languages:[], sections:[
    { id:'s_personal', headerName:'인적사항', type:'personal_info', depth:0, parentId:null, enabled:true, isDefault:true },
    { id:'s_purpose', headerName:'방문 목적 선택', type:'choice', depth:0, parentId:null, enabled:true, isDefault:true,
      options:[
        { id:'o_p1', label:'불편한 곳이 있어요.', emoji:'🤕', tag:'진료', target:'s_discomfort', hasBodymapInsert:true, enabled:true, isDefault:true },
        { id:'o_p2', label:'물건을 빌리러 왔어요.', emoji:'🛒', tag:'대여', target:'s_borrow', enabled:true, isDefault:true },
        { id:'o_p3', label:'물건을 반납하러 왔어요.', emoji:'📦', tag:'반납', target:'s_return', enabled:true, isDefault:true },
        { id:'o_p4', label:'문의 & 알려드릴 게 있어서 왔어요.', emoji:'💬', tag:'문의', target:'s_inquiry', enabled:true, isDefault:true },
        { id:'o_p5', label:'선생님과 상담을 하고 싶어요.', emoji:'🗣️', tag:'상담', target:'s_counsel', enabled:true, isDefault:true }
      ]
    }
  ]};
}

/* ── 유틸 ── */
let _fdNextId = 1000;
function _fdGenId(prefix){ return prefix + '_' + (++_fdNextId) + '_' + Date.now().toString(36).slice(-4); }

function _fdFindSection(flow, id){
  return flow.sections.find(function(s){ return s.id === id; });
}



/* 드롭다운 선택지 빌드 */
/* 섹션 계층 번호 (2-1-1 형식) 계산 — 부모 체인을 따라 각 단계의 형제 순번을 합성 */
function _fdGetSectionNumber(flow, secId){
  const sec = _fdFindSection(flow, secId);
  if(!sec) return '';
  const path = [];
  let cur = sec;
  while(cur){
    const parent = cur.parentId ? _fdFindSection(flow, cur.parentId) : null;
    let siblings;
    if(parent && parent.options){
      /* 부모의 options에서 이 섹션을 target으로 가리키는 순번 */
      let idx = -1;
      parent.options.forEach(function(opt, i){ if(opt.target === cur.id) idx = i; });
      if(idx<0){
        /* option target이 아닌 직접 parent 자식 — flow.sections의 parent 자식 중 순번 */
        const sibs = flow.sections.filter(function(s){return s.parentId===parent.id;});
        idx = sibs.indexOf(cur);
      }
      siblings = idx+1;
    } else {
      /* 최상위 — flow.sections의 루트 중 순번 */
      const roots = flow.sections.filter(function(s){return !s.parentId;});
      siblings = roots.indexOf(cur)+1;
    }
    path.unshift(siblings);
    cur = parent;
  }
  return path.join('-');
}

/* ══════════════════════════════════════════
   플로우 디자이너 HTML 렌더링
   ══════════════════════════════════════════ */
export function kioskFlowDesignerHtml(){
  var h = '';
  var flow = _fdGetFlow();
  var modKey = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
  var undoCount = (_fdUndoStack||[]).length;
  var redoCount = (_fdRedoStack||[]).length;
  var issues = _fdValidateFlow();
  var errCount = issues.filter(function(i){return i.sev==='error';}).length;
  /* 트리 연결선 CSS */
  h += '<style>'
    +'.fd-tree-wrap{position:relative;padding-left:24px}'
    +'.fd-tree-wrap::before{content:"";position:absolute;left:11px;top:0;bottom:0;width:0;border-left:1.5px solid var(--bdr)}'
    +'.fd-tree-wrap.fd-tree-last::before{bottom:50%}'
    +'.fd-tree-item{position:relative}'
    +'.fd-tree-item::before{content:"";position:absolute;left:-13px;top:50%;width:13px;height:0;border-top:1.5px solid var(--bdr)}'
    +'</style>';
  /* 툴바 */
  h += '<div style="position:sticky;top:0;z-index:50;background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.05)">';
  h += '<button data-action="undo" '+(undoCount?'':'disabled')+' style="padding:5px 10px;border-radius:6px;border:1px solid var(--bdr);background:var(--card);color:var(--t1);font-size:11px;cursor:pointer;font-family:var(--f);opacity:'+(undoCount?'1':'0.4')+'">↶ 취소'+(undoCount?' ('+undoCount+')':'')+'</button>';
  h += '<button data-action="redo" '+(redoCount?'':'disabled')+' style="padding:5px 10px;border-radius:6px;border:1px solid var(--bdr);background:var(--card);color:var(--t1);font-size:11px;cursor:pointer;font-family:var(--f);opacity:'+(redoCount?'1':'0.4')+'">↷ 다시'+(redoCount?' ('+redoCount+')':'')+'</button>';
  h += '<span style="color:var(--bdr)">|</span>';
  if(issues.length>0){
    var bc = errCount>0?'#ef4444':'#f59e0b';
    h += '<button data-action="show-validation" style="padding:5px 10px;border-radius:6px;border:1px solid '+bc+';background:'+bc+'1a;color:'+bc+';font-size:11px;cursor:pointer;font-family:var(--f);font-weight:700">⚠ '+issues.length+'건</button>';
  } else {
    h += '<button data-action="show-validation" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(34,197,94,0.3);background:rgba(34,197,94,0.08);color:#22c55e;font-size:11px;cursor:pointer;font-family:var(--f);font-weight:600">✓ 정상</button>';
  }
  h += '<span style="flex:1"></span>';
  h += '<button data-action="reset-default" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);color:#ef4444;font-size:11px;cursor:pointer;font-family:var(--f);font-weight:600">🔄 초기화</button>';
  h += '</div>';
  /* 토글 트리 */
  h += '<div style="margin-top:8px">';
  /* 인적사항 이용 대상 — 학생/교직원 체크 (기본 둘 다 = 현행). 교직원은 키오스크 없이 우선 접수시키려는 학교용 (사용자 요청 2026-06-11). */
  var _psSec = _fdFindSection(flow, 's_personal');
  var _psSt = !_psSec || _psSec.allowStudent !== false;
  var _psSf = !_psSec || _psSec.allowStaff !== false;
  h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--card);border:1.5px solid var(--bdr);border-radius:10px;margin-bottom:4px"><span style="font-size:18px">👤</span><span style="flex:1;font-size:13px;font-weight:700;color:var(--t1)">인적사항 입력</span>'
    + '<label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--t2);cursor:pointer" title="체크 해제 시 키오스크에서 학생 선택이 사라집니다"><input type="checkbox" data-action="toggle-personal-type" data-ptype="student" '+(_psSt?'checked':'')+' style="width:14px;height:14px;accent-color:var(--cyan);cursor:pointer">🎒 학생</label>'
    + '<label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--t2);cursor:pointer" title="체크 해제 시 키오스크에서 교직원 선택이 사라집니다 (교직원 우선 접수 운영용)"><input type="checkbox" data-action="toggle-personal-type" data-ptype="staff" '+(_psSf?'checked':'')+' style="width:14px;height:14px;accent-color:var(--cyan);cursor:pointer">👨‍🏫 교직원</label>'
    + '<span style="font-size:9px;padding:3px 8px;border-radius:12px;background:var(--bg2);color:var(--t3);font-weight:600">고정</span></div>';
  h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--card);border:1.5px solid var(--bdr);border-radius:10px;margin-bottom:4px"><span style="font-size:18px">🎯</span><span style="flex:1;font-size:13px;font-weight:700;color:var(--t1)">방문 목적 선택</span><span style="font-size:9px;padding:3px 8px;border-radius:12px;background:var(--bg2);color:var(--t3);font-weight:600">고정</span></div>';
  if(_fdFindSection(flow,'s_purpose')) h += _fdRenderToggleTree(flow,'s_purpose',1);
  h += '</div>';
  return h;
}

/* ── HTML 미리보기/다운로드 — kiosk-html-builder.js로 위임 ── */
function _fdOpenKioskPreview(){ openKioskPreview(_fdGetFlow); }
function _fdReloadKioskPreview(){ reloadKioskPreview(_fdGetFlow); }
/* ══════════════════════════════════════════
   프리셋 토글 트리 렌더링 (Step 7)
   ══════════════════════════════════════════ */

function _fdRenderToggleTree(flow, secId, depth, ancestorBodymap){
  var h = '';
  var sec = _fdFindSection(flow, secId);
  if(!sec) return h;
  var opts = sec.options || [];
  /* 터미널 확인 옵션만 있는 섹션은 숨김 — 마지막 항목에 자동 삽입되므로 */
  var visibleOpts = opts.filter(function(opt){
    var isTerminal = !opt.target || opt.target.indexOf('__') === 0;
    /* 섹션의 유일한 옵션이 터미널이면 숨김 (guide 섹션의 "확인" 버튼) */
    return !(isTerminal && opts.length === 1 && sec.type === 'guide');
  });
  /* guide 섹션이 비었거나(또는 터미널 단일) 이면 숨김. choice 등은 비어 있어도 렌더 → 새/빈 하위메뉴에도 "+ 항목 추가" 노출 */
  if(visibleOpts.length === 0 && sec.type === 'guide') return h;
  h += '<div id="fd-sec-'+secId+'">';
  visibleOpts.forEach(function(opt, vi){
    var oi = opts.indexOf(opt);
    var childSecId = (opt.target && opt.target.indexOf('__')!==0) ? opt.target : null;
    var childSec = childSecId ? _fdFindSection(flow, childSecId) : null;
    /* 자식이 guide면 보이는 옵션이 있을 때만 하위 취급. choice 등 비-guide 섹션은 비어 있어도 하위 트리 렌더(+추가 노출) → 빈 메뉴 편집 가능 */
    var hasSubOpts = false;
    if(childSec){
      if(childSec.type === 'guide'){
        var visibleChildren = (childSec.options||[]).filter(function(o){ return !(!o.target || o.target.indexOf('__')===0) || (childSec.options||[]).length > 1; });
        hasSubOpts = visibleChildren.length > 0;
      } else {
        hasSubOpts = true;
      }
    }
    var isLastOpt = (vi === visibleOpts.length - 1);
    /* 트리 래퍼: 자식 트리를 포함하여 세로선이 이어지도록 */
    h += '<div class="fd-tree-wrap'+(isLastOpt?' fd-tree-last':'')+'">';
    h += _fdRenderToggleRow(flow, sec, opt, oi, depth, hasSubOpts, ancestorBodymap);
    /* 자식 트리는 부모 래퍼 안에 — 위계 표현. 이 옵션에 바디맵이 켜져 있으면 하위 전부 상속(바디맵 비활성화) (사용자 요청 2026-06-11) */
    if(hasSubOpts){
      h += _fdRenderToggleTree(flow, childSecId, depth + 1, ancestorBodymap || !!opt.hasBodymapInsert);
    }
    h += '</div>'; /* fd-tree-wrap 닫기 */
  });
  /* + 항목 추가 버튼 — 별도 래퍼 없이 직접 배치 (이미 마지막 옵션이 fd-tree-last) */
  h += '<div style="padding-left:24px;margin-bottom:4px"><button data-action="add-option" data-sec-id="'+secId+'" class="fd-add-btn" style="font-size:10px;padding:2px 10px;border:1px dashed var(--bdr);border-radius:4px;background:transparent;color:var(--t3);cursor:pointer;font-family:var(--f);transition:all .15s">+ 항목 추가</button></div>';
  h += '</div>';
  return h;
}

function _fdRenderToggleRow(flow, sec, opt, oi, depth, hasChildren, ancestorBodymap){
  var colors = ['#06b6d4','#8b5cf6','#22c55e','#f59e0b','#ef4444'];
  var col = colors[depth % colors.length];
  var optCount = sec.options ? sec.options.length : 0;
  var canUp = (oi > 0);
  var canDown = (oi < optCount - 1);
  /* VS Code 트리 스타일 — 인라인 편집 */
  var h = '<div class="fd-tree-item fd-toggle-row fd-opt-row" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" style="margin-bottom:3px;display:flex;align-items:center;gap:5px;padding:5px 8px;border-radius:8px;border:1px solid '+col+'30;background:'+col+'08;transition:all .15s">';
  /* ▲▼ 이동 */
  h += '<span style="display:flex;flex-direction:column;gap:1px;flex-shrink:0">';
  h += '<button data-action="move-opt-up" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" style="width:14px;height:11px;border:none;background:transparent;color:'+(canUp?'var(--t2)':'transparent')+';cursor:'+(canUp?'pointer':'default')+';font-size:7px;padding:0;line-height:1;display:flex;align-items:center;justify-content:center" '+(canUp?'':'disabled')+'>▲</button>';
  h += '<button data-action="move-opt-down" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" style="width:14px;height:11px;border:none;background:transparent;color:'+(canDown?'var(--t2)':'transparent')+';cursor:'+(canDown?'pointer':'default')+';font-size:7px;padding:0;line-height:1;display:flex;align-items:center;justify-content:center" '+(canDown?'':'disabled')+'>▼</button>';
  h += '</span>';
  /* ── 루트 태그(이 행이 어느 기능 흐름 하위인지)에 따른 기능 드롭다운 — 이모지 왼쪽 (사용자 설계 2026-06-13) ── */
  var _mg="font-family:'맑은 고딕','Malgun Gothic',sans-serif";
  var _chip=function(action, text, tip, active, disabled, extraColor){
    var col=disabled?'var(--t3)':(active?(extraColor||'var(--cyan)'):'var(--t3)');
    var bdr=disabled?'var(--bdr)':(active?'rgba(6,182,212,0.35)':'var(--bdr)');
    var bg=disabled?'var(--bg2)':(active?'rgba(6,182,212,0.08)':'var(--card)');
    return '<button type="button" '+(disabled?'disabled ':'')+'data-action="'+action+'" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" '
      +(tip?'data-tooltip="'+escHtml(tip)+'" data-tooltip-instant="1" ':'')
      +'style="display:inline-flex;align-items:center;gap:3px;max-width:150px;font-size:10.5px;padding:3px 8px;border-radius:6px;border:1px solid '+bdr+';background:'+bg+';color:'+col+';font-weight:700;flex-shrink:0;cursor:'+(disabled?'not-allowed':'pointer')+';white-space:nowrap;opacity:'+(disabled?'0.55':'1')+';'+_mg+'">'
      +'<span style="overflow:hidden;text-overflow:ellipsis">'+escHtml(text)+'</span><span style="font-size:7px">▼</span></button>';
  };
  var rootTag=(sec.id==='s_purpose')?'':_fdRootTagOf(flow, sec);
  var isChoiceRow=(sec.type==='choice');
  var _diaryOn=(opt.diaryRegister!==false);   /* 기본 = 보건일지에 등록 */
  var _retNeed=(opt.returnNeeded===true);     /* 기본 = 반납 불필요 */
  if(isChoiceRow && rootTag==='진료/처치'){
    /* [보건일지에 등록/미등록] 드롭다운 */
    h += _chip('open-diary-dd', _diaryOn?'보건일지에 등록':'보건일지에 미등록',
      '방문자의 접수를 보건일지에 등록할지 선택합니다.', _diaryOn, false);
    /* 증상처치입력 체크 — 진료/처치 하위에만, 미등록이면 비활성 (사용자 설계 2026-06-13) */
    var stOn = !!opt.hasSymTreatInsert;
    /* 하위 항목(선택지)이 있으면 상위 증상처치입력을 비활성 — 처치는 하위에서 결정하므로 상위+하위 처치가 섞이는 실수 방지.
       데이터(opt.hasSymTreatInsert/symptomTreat)는 지우지 않고 보존 → 하위를 다시 없애면 원래대로 복원. (사용자 요청 2026-07-01) */
    var _stDis = !_diaryOn || hasChildren;
    var _stChecked = stOn && !hasChildren;   /* 하위 있으면 시각적으로도 꺼진 상태로 표시(데이터는 보존) */
    var _stTip = !_diaryOn ? '보건일지에 미등록 상태에서는 증상처치입력을 쓸 수 없습니다.'
      : hasChildren ? '하위 항목이 추가된 경우 이 (상위) 증상처치입력은 비활성화됩니다.'
      : '보건일지에 자동으로 입력될 수 있도록 증상과 처치를 지정합니다.';
    h += '<label data-tooltip="'+escHtml(_stTip)+'" data-tooltip-instant="1" style="display:flex;align-items:center;gap:2px;cursor:'+(_stDis?'not-allowed':'pointer')+';font-size:9px;padding:2px 6px;border-radius:5px;border:1px solid '+(_stDis?'var(--bdr)':(_stChecked?'#8b5cf6':'var(--bdr)'))+';background:'+(_stDis?'var(--bg2)':(_stChecked?'rgba(139,92,246,0.12)':'var(--card)'))+';color:'+(_stDis?'var(--t3)':(_stChecked?'#8b5cf6':'var(--t3)'))+';white-space:nowrap;flex-shrink:0;transition:all .15s;opacity:'+(_stDis?'0.55':'1')+'">';
    h += '<input type="checkbox" data-action="toggle-symtreat" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" '+(_stChecked?'checked':'')+(_stDis?' disabled':'')+' style="margin:0;width:11px;height:11px"> 증상처치입력';
    h += '</label>';
  } else if(isChoiceRow && rootTag==='물품 대여'){
    /* [반납 필요/불필요] + [물품 지정(반납 필요 시만 활성)] */
    h += _chip('open-return-dd', _retNeed?'반납 필요':'반납 불필요',
      _retNeed?'방문자가 입력하는 대로 물품 대여 대장에 입력합니다.':'반납이 불필요한 물품 대여이므로 보건실 물품 대여 대장에 입력되지 않습니다.',
      _retNeed, false, _retNeed?'#16a34a':null);
    h += _chip('open-item-dd', opt.rentalItem||'물품 선택',
      _retNeed?'보건실 물품 대여 대장에 등록된 물품 중에서 지정합니다.':'반납 불필요 물품은 대장에 기록되지 않아 물품 지정이 필요 없습니다.',
      !!opt.rentalItem, !_retNeed);
  } else if(isChoiceRow && rootTag==='물품 반납'){
    /* [물품 지정] — 대장 등록 물품 */
    h += _chip('open-item-dd', opt.rentalItem||'물품 선택',
      '보건실 물품 대여 대장에 등록된 물품 중에서 반납 대상을 지정합니다.', !!opt.rentalItem, false);
  } else if(isChoiceRow && rootTag==='상담'){
    /* [상담 주제] — 증상 선택 및 처치의 상담 분류 중분류 */
    h += _chip('open-topic-dd', opt.counselTopic||'상담 주제',
      '증상 선택 및 처치의 상담 분류(중분류)와 연결합니다. 등록 시 상담록을 바로 작성할 수 있습니다.', !!opt.counselTopic, false);
  }
  /* 이모지 (클릭 → 이모지 피커) */
  h += '<span data-action="pick-opt-emoji" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" style="font-size:16px;cursor:pointer;flex-shrink:0;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid var(--bdr);background:var(--card);transition:all .12s" title="아이콘 변경">'+(opt.emoji||'📌')+'</span>';
  /* 태그 선택 드롭다운 (방문 목적 1단계만) — 프로그램의 어느 기능과 연결할지 5종 중 선택 (사용자 결정 2026-06-12) */
  if(sec.id==='s_purpose'){
    var _tagSet=!!(opt.tag);
    h += '<button type="button" data-action="open-tag-dd" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" data-tooltip="이 항목의 접수를 프로그램의 어느 기능에 연결할지 선택합니다." data-tooltip-instant="1" '
      +'style="display:inline-flex;align-items:center;gap:3px;max-width:150px;font-size:10.5px;padding:3px 8px;border-radius:6px;border:1px solid '+(_tagSet?'rgba(6,182,212,0.35)':'var(--bdr)')+';background:'+(_tagSet?'rgba(6,182,212,0.08)':'var(--card)')+';color:'+(_tagSet?'var(--cyan)':'var(--t3)')+';font-weight:700;flex-shrink:0;cursor:pointer;white-space:nowrap;'+_mg+'">'
      +'<span style="overflow:hidden;text-overflow:ellipsis">'+escHtml(opt.tag||'태그 선택')+'</span><span style="font-size:7px">▼</span></button>';
  }
  /* 라벨 인라인 편집 */
  h += '<input class="form-input" data-action="set-opt-label" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" value="'+escHtml(opt.label||'')+'" style="flex:1;font-size:11px;padding:3px 6px;font-weight:600;min-width:0" placeholder="항목 이름">';
  /* 안내문구 + 바디맵 체크 + 삭제 — 나란히. (접수 체크는 폐지 — 접수는 마지막 단계에서 항상 일어남. 사용자 결정 2026-06-13) */
  h += '<div style="display:flex;align-items:center;gap:3px;flex-shrink:0">';
  /* 안내문구 칩 (바디맵 왼편) — 켜면 방문자가 이 항목 클릭 시 안내문 표시. 클릭하면 편집 팝업 (사용자 결정 2026-06-13) */
  /* 칩 순서: [바디맵][안내문구] — 좌우 교체 (사용자 결정 2026-06-13).
   *  바디맵 칩 = 드롭다운 (사용 안 함 + 터치 모드 4종, 사용자 설계 2026-06-13) */
  if(ancestorBodymap){
    /* 상위 옵션에서 바디맵이 켜져 있어 이 옵션(및 하위 전부)은 자동 상속 → 칩 비활성화 (사용자 요청 2026-06-11) */
    h += '<label data-tooltip="상위 항목에서 바디맵을 활성화되어서 하위 항목은 비활성화됩니다." data-tooltip-instant="1" style="display:flex;align-items:center;gap:2px;cursor:not-allowed;font-size:9px;padding:2px 6px;border-radius:5px;border:1px solid rgba(6,182,212,0.35);background:rgba(6,182,212,0.05);color:var(--t3);white-space:nowrap;opacity:0.5">';
    h += '<input type="checkbox" checked disabled style="margin:0;width:11px;height:11px"> 바디맵';
    h += '</label>';
  } else {
    var bmOn = opt.hasBodymapInsert;
    var _bmModeInfo = bmOn ? (FD_BM_MODES.find(function(m){ return m.value===(opt.bodymapMode||'check_nrs'); })||FD_BM_MODES[2]) : null;
    h += '<button type="button" data-action="open-bmmode-dd" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" '
      +'data-tooltip="'+escHtml(bmOn?_bmModeInfo.tip:'방문자가 키오스크에서 입력한 증상 부위가 보건일지에 등록됩니다. 클릭해 터치 방식을 선택하세요.')+'" data-tooltip-instant="1" '
      +'style="display:inline-flex;align-items:center;gap:2px;font-size:9px;padding:2px 7px;border-radius:5px;border:1px solid '+(bmOn?'var(--cyan)':'var(--bdr)')+';background:'+(bmOn?'rgba(6,182,212,0.12)':'var(--card)')+';color:'+(bmOn?'var(--cyan)':'var(--t3)')+';white-space:nowrap;flex-shrink:0;cursor:pointer;font-weight:700;'+_mg+'">바디맵'+(bmOn?' ✓':'')+'<span style="font-size:7px">▼</span></button>';
  }
  if(isChoiceRow){
    var gmOn=!!(opt.guideMsg);
    h += '<button type="button" data-action="open-guidemsg" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" data-tooltip="방문자가 이 항목을 선택하면 표시할 안내문을 작성합니다." data-tooltip-instant="1" '
      +'style="display:inline-flex;align-items:center;gap:2px;font-size:9px;padding:2px 7px;border-radius:5px;border:1px solid '+(gmOn?'#f59e0b':'var(--bdr)')+';background:'+(gmOn?'rgba(245,158,11,0.12)':'var(--card)')+';color:'+(gmOn?'#d97706':'var(--t3)')+';white-space:nowrap;flex-shrink:0;cursor:pointer;font-weight:700;'+_mg+'">📋 안내문구'+(gmOn?' ✓':'')+'</button>';
  }
  /* 대기 모드 드롭다운 — 옛 "접수" 체크 자리 (사용자 결정 2026-06-13). 선택 시 완료 안내 문구 편집 팝업. */
  if(isChoiceRow && sec.id!=='s_purpose'){
    var _wmDirect=(opt.waitMode==='direct');
    var _wmCol=_wmDirect?'#16a34a':'#d97706';
    var _wmBg=_wmDirect?'rgba(34,197,94,0.08)':'rgba(245,158,11,0.08)';
    var _wmBd=_wmDirect?'rgba(34,197,94,0.3)':'rgba(245,158,11,0.3)';
    h += '<button type="button" data-action="open-wait-dd" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" '
      +'data-tooltip="'+(_wmDirect?'방문자가 대기하지 않고 바로 들어가도록 합니다.':'방문자가 대기하도록 하며 호출 시 보건교사에게 오도록 합니다.')+'" data-tooltip-instant="1" '
      +'style="display:inline-flex;align-items:center;gap:3px;font-size:9px;padding:2px 7px;border-radius:5px;border:1px solid '+_wmBd+';background:'+_wmBg+';color:'+_wmCol+';font-weight:700;flex-shrink:0;cursor:pointer;white-space:nowrap;'+_mg+'">'
      +(_wmDirect?'바로 들어오게 하기':'대기하게 하기')+'<span style="font-size:7px">▼</span></button>';
  }
  h += '<span data-action="remove-option" data-sec-id="'+sec.id+'" data-opt-idx="'+oi+'" style="cursor:pointer;color:var(--red);font-size:9px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(239,68,68,0.15);background:rgba(239,68,68,0.08);flex-shrink:0" title="삭제">✕</span>';
  h += '</div>';
  h += '</div>';
  return h;
}

/* ── 이 섹션이 어느 기능 흐름(루트 태그) 하위인지 — parentId 체인을 s_purpose 직계까지 추적 (2026-06-13) ── */
function _fdRootTagOf(flow, sec){
  if(!sec || sec.id==='s_purpose') return '';
  var cur=sec, guard=0;
  while(cur && cur.parentId && cur.parentId!=='s_purpose' && guard++<30){
    var _pid=cur.parentId;
    cur=flow.sections.find(function(s){ return s.id===_pid; });
  }
  if(!cur || cur.parentId!=='s_purpose') return '';
  var rootSecId=cur.id;
  var purpose=flow.sections.find(function(s){ return s.id==='s_purpose'; });
  if(!purpose) return '';
  var entry=(purpose.options||[]).find(function(o){ return o.target===rootSecId; });
  return (entry && entry.tag) || '';
}


/* 접수 플래그 — 체크박스 실제 상태(on)를 그대로 저장. 기본값이 계층에 따라 다르므로(하위 있음=해제·말단=체크)
 *  옛 토글 방식(false↔true 반전)은 첫 클릭이 표시와 어긋남 (2026-06-12) */
function _fdSetReceptionFlag(secId, optIdx, on){
  _fdPushHistory('삽입 기능 토글');
  var flow = _fdGetFlow();
  var sec = _fdFindSection(flow, secId);
  if(!sec || !sec.options || !sec.options[optIdx]) return;
  var opt = sec.options[optIdx];
  opt.hasReceptionInsert = !!on;
  /* 자식 가이드 섹션의 확인 옵션에도 전파 */
  if(opt.target && opt.target.indexOf('__') !== 0){
    var childSec = _fdFindSection(flow, opt.target);
    if(childSec && childSec.type === 'guide' && childSec.options){
      childSec.options.forEach(function(co){ co.hasReceptionInsert = !!on; });
    }
  }
  ks.flowDesigner = flow;
  _save(); try{ bus.emit('toast:save'); }catch(_){}
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}

function _fdToggleInsertFlag(secId, optIdx, flagKey){
  _fdPushHistory('삽입 기능 토글');
  var flow = _fdGetFlow();
  var sec = _fdFindSection(flow, secId);
  if(!sec || !sec.options || !sec.options[optIdx]) return;
  var opt = sec.options[optIdx];
  /* hasReceptionInsert는 디폴트 true → false 명시 토글 */
  if(flagKey === 'hasReceptionInsert'){
    var newVal = (opt[flagKey] === false) ? true : false;
    opt[flagKey] = newVal;
    /* 자식 가이드 섹션의 확인 옵션에도 전파 */
    if(opt.target && opt.target.indexOf('__') !== 0){
      var childSec = _fdFindSection(flow, opt.target);
      if(childSec && childSec.type === 'guide' && childSec.options){
        childSec.options.forEach(function(co){ co.hasReceptionInsert = newVal; });
      }
    }
  } else {
    if(opt[flagKey]) delete opt[flagKey];
    else opt[flagKey] = true;
  }
  ks.flowDesigner = flow;
  /* 즉시 저장 (딜레이 없이) */
  _save(); try{ bus.emit('toast:save'); }catch(_){}
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}

/* ══════════════════════════════════════════
   증상처치입력 — 편집기에서 보건교사가 증상·처치를 미리 지정 (선택 전용 모달, 레코드·협업·DB 안 건드림).
   확인하면 opt.symptomTreat={symptoms,treatments} 저장 + 체크. 키오스크에서 방문자가 그 항목 선택 시 자동 적용. (사용자 요청 2026-06-11)
   ══════════════════════════════════════════ */
function _fdClearSymTreat(secId, optIdx){
  _fdPushHistory('증상처치 해제');
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow,secId);
  if(!sec||!sec.options||!sec.options[optIdx])return;
  var opt=sec.options[optIdx];
  delete opt.hasSymTreatInsert; delete opt.symptomTreat;
  ks.flowDesigner=flow; _save(); try{ bus.emit('toast:save'); }catch(_){}
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}
function _fdApplySymTreat(secId, optIdx, result){
  _fdPushHistory('증상처치 지정');
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow,secId);
  if(!sec||!sec.options||!sec.options[optIdx])return;
  var opt=sec.options[optIdx];
  opt.hasSymTreatInsert=true; opt.symptomTreat=result;
  ks.flowDesigner=flow; _save(); try{ bus.emit('toast:save'); }catch(_){}
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}
function _fdOpenSymTreatPicker(secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow,secId);
  var opt=(sec&&sec.options)?sec.options[optIdx]:null;
  if(!opt)return;
  var data={}; try{data=getSymData()||{};}catch(e){}
  /* 유효 상분류 — 사용자 이름변경·추가·가림·순서 반영 (2026-06-12). catSyms() 가 증상 병합 담당 */
  var CATS=[]; try{CATS=getEffectiveSymCats(false)||[];}catch(e){CATS=data.symCategories||[];}
  var MEDFREQ=data.medFrequent||{};
  var FIXED_FAVS=['투약','침상 이용','V/S 측정','보건교육','병원진료 권유','추적 관찰'];
  var CORE_FIXED=['투약','침상 이용','V/S 측정'];
  function _lsObj(k){ try{var o=JSON.parse(localStorage.getItem(k)||'{}');return (o&&typeof o==='object')?o:{};}catch(e){return {};} }
  var FAV=_lsObj('ec_user_sym_fav');
  var REMOVED=_lsObj('ec_user_sym_removed');
  var MEDSYM=_lsObj('ec_user_med_syms'); /* {약명:[증상]} */
  function _saveFav(){ try{localStorage.setItem('ec_user_sym_fav',JSON.stringify(FAV));}catch(e){} }
  function _saveRemoved(){ try{localStorage.setItem('ec_user_sym_removed',JSON.stringify(REMOVED));}catch(e){} }
  var E=escHtml;
  /* 기존 지정값 복원 — 증상처치입력이 체크된 옵션만. 기본 제공 흐름 JSON(kiosk-flow-default.json)의 옛 symptomTreat
   *  프리셋(연고 적용·소독 드레싱 등)이 체크 안 된 옵션에서 미리 선택돼 뜨던 버그 수정 (사용자 보고 2026-06-12) */
  var pre=(opt.hasSymTreatInsert&&opt.symptomTreat)?opt.symptomTreat:{};
  var selSym=(pre.symptoms&&pre.symptoms[0])||null;
  var selCatId=null;
  if(selSym){ for(var ci=0;ci<CATS.length;ci++){ if(catSyms(CATS[ci]).indexOf(selSym)!==-1){selCatId=CATS[ci].id;break;} } }   /* 사용자 추가 증상도 매칭 (2026-06-12) */
  var selTreats=[], _inputMode=null; /* _inputMode: 'free'(자유 기입) | null. 투약은 "투약[약 (용량), …]" 완성 칩 텍스트 그대로 보관 */
  (pre.treatments||[]).forEach(function(t){ var v=String(t||'').trim(); if(v&&selTreats.indexOf(v)===-1)selTreats.push(v); });
  /* 자주 쓰는 처치 — 실제 _symRenderTreatPanel(2307~2333행)과 동일 계산:
   *  고정 6종(코어는 항상) + 레거시 공통 fav(ec_user_fav_treatments) + 증상별 fav(ec_user_sym_fav)
   *  − 증상별 삭제 목록(ec_user_sym_removed) − 폐기 처치 블랙리스트(_REMOVED_TREATS). 동일 정렬. */
  var LEGACY_FAV=[]; try{var _lf=JSON.parse(localStorage.getItem('ec_user_fav_treatments')||'[]'); if(Array.isArray(_lf))LEGACY_FAV=_lf;}catch(e){}
  var BLACKLIST={'인공눈물 적용':1,'인공눈물':1,'파스 적용':1,'연고 적용':1}; /* 실제 모달의 _REMOVED_TREATS 와 동일 */
  function recommend(sym){
    var rec=[]; var rm=REMOVED[sym]||[];
    FIXED_FAVS.forEach(function(t){ if(CORE_FIXED.indexOf(t)!==-1||rm.indexOf(t)===-1)rec.push(t); });
    LEGACY_FAV.forEach(function(t){ if(!BLACKLIST[t]&&rec.indexOf(t)===-1&&rm.indexOf(t)===-1)rec.push(t); });
    (FAV[sym]||[]).forEach(function(t){ if(!BLACKLIST[t]&&rec.indexOf(t)===-1&&rm.indexOf(t)===-1)rec.push(t); });
    var pri={'투약':0,'침상 이용':1,'V/S 측정':2,'보건교육':3,'병원진료 권유':4,'추적 관찰':5};
    rec.sort(function(a,b){var pa=(a in pri)?pri[a]:99,pb=(b in pri)?pri[b]:99;return pa-pb;});
    return rec;
  }
  function resultList(){ return selTreats.slice(); }
  /* 중분류 목록 — 실제 _symSelectCat 과 동일: 사용자 추가 증상 + 숨김 제외 + 저장 순서 반영 */
  function catSyms(cat){
    var userSyms=_lsObj('ec_user_symptoms'), hidden=_lsObj('ec_hidden_symptoms'), orderMap=_lsObj('ec_sym_order');
    var ch=hidden[cat.id]||[], cu=userSyms[cat.id]||[];
    var raw=(cat.symptoms||[]).filter(function(s){return ch.indexOf(s)===-1;}).concat(cu);
    var so=orderMap[cat.id], all;
    if(so&&Array.isArray(so)){ all=[]; so.forEach(function(s){if(raw.indexOf(s)!==-1)all.push(s);}); raw.forEach(function(s){if(all.indexOf(s)===-1)all.push(s);}); }
    else all=raw;
    return all;
  }
  /* === 모달 — 실제 "증상 선택 및 처치"(symCatBox) 와 동일 GUI. 취소/확인 버튼 없음, 바깥 클릭=저장 후 닫힘 === */
  var ov=document.createElement('div');
  ov.id='fdSymTreatOverlay';
  /* z-index 12050 — 편집기 팝업(12000) 위, 실제 +추가 옵션 모달(12100)·약품 픽커(12200) 아래 */
  ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:transparent;z-index:12050;font-family:var(--f)';
  var _boxH=Math.min(window.innerHeight-40,720);
  ov.innerHTML='<div id="fdstBox" style="background:var(--card);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.2);width:960px;max-width:85vw;height:'+_boxH+'px;display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="padding:12px 14px 8px;flex-shrink:0;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06))">'
    +'<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px">🩺 키오스크용 증상 선택 및 처치 <span style="font-size:11px;color:var(--t3);font-weight:600">— "'+E(opt.label||'')+'" 항목</span></div>'
    +'<div style="font-size:11px;color:var(--t3);line-height:1.5">방문자가 키오스크에서 선택한 것 대로 보건일지에 인적사항과 함께 증상, 처치가 채워지도록 설정합니다. 바깥을 클릭하면 저장됩니다.</div>'
    +'</div>'
    +'<div style="flex:1;display:flex;min-height:0;overflow:hidden;border-top:1px solid var(--bdr)">'
    +'<div id="fdstCat" style="width:180px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--bdr);scrollbar-width:thin;background:var(--bg2)"></div>'
    +'<div id="fdstSym" style="width:240px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--bdr);scrollbar-width:thin;padding:8px"></div>'
    +'<div id="fdstTreat" style="flex:1;overflow-y:auto;scrollbar-width:thin;padding:12px;display:flex;flex-direction:column"></div>'
    +'</div></div>';
  document.body.appendChild(ov);
  /* 열기 애니메이션 — 실제 모달과 동일 */
  var _fdstBoxEl=document.getElementById('fdstBox');
  if(_fdstBoxEl){_fdstBoxEl.style.opacity='0';_fdstBoxEl.style.transform='scale(0.95)';
    requestAnimationFrame(function(){_fdstBoxEl.style.transition='opacity 0.2s ease, transform 0.2s ease';_fdstBoxEl.style.opacity='1';_fdstBoxEl.style.transform='scale(1)';});}
  /* 1패널: 카테고리 — 실제 sym-cat-item 마크업 */
  function renderCat(){
    var el=document.getElementById('fdstCat'); if(!el)return;
    el.innerHTML=CATS.map(function(c){
      var on=selCatId===c.id;
      return '<div class="sym-cat-item" data-fdst="cat" data-cat="'+E(c.id)+'" style="padding:9px 10px;cursor:pointer;transition:all .15s;border-left:3px solid '+(on?'var(--cyan)':'transparent')+';background:'+(on?'rgba(6,182,212,0.07)':'transparent')+';font-size:11px;display:flex;align-items:center;gap:6px;position:relative">'
        +'<span style="font-size:15px">'+(c.icon||'📌')+'</span><span style="font-weight:600;color:'+(on?'var(--cyan)':'var(--t2)')+';line-height:1.3;flex:1">'+E(c.name)+'</span>'
        +'<span class="sym-cat-arrow" style="visibility:'+(on?'visible':'hidden')+';display:inline-block;width:12px;text-align:right;color:var(--cyan);font-size:10px;flex-shrink:0">▶</span></div>';
    }).join('');
  }
  /* 2패널: 중분류 — 실제와 동일 세로(full-width 행) 칩. 선택 시 cyan + hover ✕ */
  function renderSym(){
    var el=document.getElementById('fdstSym'); if(!el)return;
    var cat=CATS.filter(function(c){return c.id===selCatId;})[0];
    if(!cat){el.innerHTML='<div style="padding:30px 12px;text-align:center;color:var(--t3);font-size:11px">왼쪽에서 카테고리를 선택하세요.</div>';return;}
    el.innerHTML=catSyms(cat).map(function(sym){
      var isSel=selSym===sym;
      return '<div class="sym-sel-chip'+(isSel?' is-sel':'')+'" data-fdst="sym" data-sym="'+E(sym)+'" style="padding:7px 12px;margin:0 4px 4px 4px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:600;transition:all .15s;display:flex;align-items:center;gap:6px;border:1px solid '+(isSel?'var(--cyan)':'var(--bdr)')+';background:'+(isSel?'rgba(6,182,212,0.1)':'transparent')+';color:'+(isSel?'var(--cyan)':'var(--t1)')+';position:relative">'
        +'<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+E(sym)+'</span>'
        +(isSel?'<span class="sym-chip-del" data-fdst="symdel" data-tooltip="이 증상 선택 해제" data-tooltip-instant="1">✕</span>':'<span class="sym-chip-del-placeholder" aria-hidden="true"></span>')
        +'</div>';
    }).join('');
  }
  /* 3패널: 처치 — 실제 sym-block(tone-mint) + 자주 쓰는 처치 아코디언 그대로 */
  function renderTreat(){
    var el=document.getElementById('fdstTreat'); if(!el)return;
    if(!selSym){el.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">증상을 선택하면 처치를 입력할 수 있습니다</div>';return;}
    var cat=CATS.filter(function(c){return c.id===selCatId;})[0];
    var catLabel=(cat&&cat.name)?('('+E(cat.name)+')'):'';
    var recArr=recommend(selSym);
    /* 선택한 처치 칩 — 실제 sym-treat-chip (cyan / 투약은 보라) */
    var chips='';
    selTreats.forEach(function(t){
      var isMed=/^투약\[/.test(t)||t==='투약';
      if(isMed){
        /* 투약 칩 — 실제와 동일 보라. 클릭 시 실제 약품 픽커(_symOpenDrugDoseMiniPicker)로 다시 선택 */
        chips+='<span class="sym-sel-chip sym-treat-chip" data-fdst="openmed" data-tooltip="클릭하여 약품 다시 선택" data-tooltip-instant="1" style="position:relative;display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:3px 10px;border-radius:12px;background:rgba(168,85,247,0.10);color:#a855f7;border:1px solid rgba(168,85,247,0.28);font-size:12px;font-weight:700;cursor:pointer;max-width:100%">💊 '+E(t)+'<span class="sym-chip-del" data-fdst="treatdel" data-treat="'+E(t)+'" data-tooltip="이 투약 칩 삭제" data-tooltip-instant="1">✕</span></span>';
      } else {
        chips+='<span class="sym-sel-chip sym-treat-chip" data-fdst="treatdel" data-treat="'+E(t)+'" style="position:relative;display:inline-flex;align-items:center;padding:3px 10px;border-radius:12px;background:rgba(6,182,212,0.10);color:var(--cyan);border:1px solid rgba(6,182,212,0.28);font-size:12px;font-weight:700;cursor:pointer">'+E(t)+'<span class="sym-chip-del" data-fdst="treatdel" data-treat="'+E(t)+'" data-tooltip="이 칩을 삭제" data-tooltip-instant="1">✕</span></span>';
      }
    });
    /* 자주 쓰는 처치 칩 — 실제 favChipsHtml 과 동일 (+추가 / 자유 기입 / 추천 칩, 고정=점선, 비코어=✕) */
    var favChips='';
    favChips+='<span class="sym-sel-chip" data-fdst="addfav" data-tooltip="이 증상에 새 처치 칩을 추가합니다." data-tooltip-instant="1" style="position:relative;display:inline-flex;align-items:center;padding:3px 11px;font-size:12px;font-weight:800;border-radius:12px;cursor:pointer;border:1.5px dashed #f97316;background:rgba(249,115,22,0.12);color:#f97316;font-family:var(--f)">+ 추가</span>';
    favChips+='<span class="sym-sel-chip" data-fdst="freetext" data-tooltip="일회성으로 처치를 자유롭게 적을 수 있습니다." data-tooltip-instant="1" style="position:relative;display:inline-flex;align-items:center;padding:3px 11px;font-size:12px;font-weight:700;border-radius:12px;cursor:pointer;border:1px solid #fbbf24;background:rgba(251,191,36,0.08);color:#d97706;font-family:var(--f)">✏️ 처치 자유 기입</span>';
    recArr.forEach(function(t){
      var isFixed=FIXED_FAVS.indexOf(t)!==-1, isCore=CORE_FIXED.indexOf(t)!==-1;
      var delBtn=isCore?'':'<span class="sym-chip-del" data-fdst="favdel" data-treat="'+E(t)+'" data-tooltip="이 증상의 자주 쓰는 처치 목록에서 삭제" data-tooltip-instant="1">✕</span>';
      var tip='';
      if(t==='투약')tip=' data-tooltip="일반의약품을 선택할 수 있습니다." data-tooltip-instant="1"';
      favChips+='<span class="sym-sel-chip sym-fav-chip" data-fdst="fav" data-treat="'+E(t)+'" data-is-fixed="'+(isFixed?'1':'0')+'"'+tip+' style="position:relative;display:inline-flex;align-items:center;padding:3px 11px;font-size:12px;font-weight:700;border-radius:12px;cursor:pointer;transition:all .12s;border:1px solid var(--bdr);background:transparent;color:var(--t2);font-family:var(--f)'+(isFixed?';border-style:dashed':'')+'">'+E(t)+delBtn+'</span>';
    });
    /* +추가 / 자유 기입 입력 dock */
    var dock='';
    if(_inputMode==='free')dock='<div style="display:flex;gap:6px;margin-top:8px"><input id="fdstFreeInput" placeholder="일회성 처치 자유 기입" style="flex:1;padding:8px 12px;border:1.5px solid #fbbf24;border-radius:10px;font-size:12px;font-family:var(--f);background:var(--card);color:var(--t1)"><button data-fdst="freeok" style="padding:8px 16px;border:none;border-radius:10px;background:#d97706;color:#fff;font-size:12px;font-weight:800;cursor:pointer;font-family:var(--f)">추가</button></div>';
    /* 블록 조립 — 실제 sym-block-pair 구조 그대로 */
    var h='';
    h+='<div class="sym-block-pair">';
    h+='<div><span class="sym-block-label tone-mint">선택 증상에 대한 처치</span></div>';
    h+='<div class="sym-block tone-mint">';
    h+='<div class="sym-block-sub-title">선택한 처치 및 내용</div>';
    h+='<div class="sym-sum-wrap" style="display:flex;flex-wrap:wrap;gap:6px;position:relative">'
      +(chips||'<span style="font-size:11.5px;color:var(--t3);font-style:italic;opacity:0.85;padding:4px 0">아직 선택된 처치 없음 — 아래에서 추가</span>')
      +'</div>';
    h+='<hr class="sym-block-divider">';
    h+='<div class="sym-fav-acc open">';
    h+='<div class="sym-fav-acc-head"><span class="chev">▼</span><span class="title">자주 쓰는 처치 목록</span>'+(catLabel?'<span class="cat">'+catLabel+'</span>':'')+'<span class="count">'+recArr.length+'개</span></div>';
    h+='<div style="padding:5px 12px 6px 30px;font-size:10.5px;color:var(--t3);font-weight:600;line-height:1.5">칩 하나 이상을 선택해주세요. 선택한 처치는 위 목록에 표시됩니다.</div>';
    h+='<div class="sym-fav-acc-body sym-fav-wrap">'+favChips+'</div>';
    h+='</div>';
    h+=dock;
    h+='</div></div>';
    el.innerHTML=h;
    var fi=document.getElementById('fdstFreeInput'); if(fi)fi.focus();
  }
  function renderAll(){renderCat();renderSym();renderTreat();}
  renderAll();
  /* 투약 — 실제 증상 선택 및 처치와 동일한 약품 픽커(_symOpenDrugDoseMiniPicker) 재사용.
   *  결과는 "투약[약1 (용량), 약2 (용량)]" 완성 칩 텍스트 — 기존 투약 칩을 교체. */
  function openDrugPicker(){
    if(!selSym)return;
    _symOpenDrugDoseMiniPicker(function(chip){
      selTreats=selTreats.filter(function(t){return !/^투약\[/.test(t)&&t!=='투약';});
      var v=String(chip||'').trim();
      if(v&&selTreats.indexOf(v)===-1)selTreats.push(v);
      renderTreat();
    }, selSym, null, null);
  }
  /* + 추가 — 실제 옵션 1~5 진입 모달(_symOpenAddOptionsModal) 그대로. 등록은 _symRegisterFav 가
   *  ec_user_sym_fav 에 쓰므로 실제 증상 선택 및 처치에도 즉시 반영(연동). 서브 모달이 모두 닫히면
   *  localStorage 에서 fav/removed 를 다시 읽어 목록 갱신. */
  var _favWatch=null;
  function openAddOptions(){
    if(!selSym)return;
    _symOpenAddOptionsModal(0, selSym);
    if(_favWatch)clearInterval(_favWatch);
    _favWatch=setInterval(function(){
      if(!ov.isConnected){clearInterval(_favWatch);_favWatch=null;return;}
      if(document.querySelector('[id^="symAdd"],[id^="symMini"]'))return; /* 옵션/약품/단일·복합 다이얼로그가 아직 열려 있음 */
      clearInterval(_favWatch);_favWatch=null;
      FAV=_lsObj('ec_user_sym_fav'); REMOVED=_lsObj('ec_user_sym_removed');
      renderTreat();
    },400);
  }
  function freeConfirm(){
    var fi=document.getElementById('fdstFreeInput'); var v=fi?(fi.value||'').trim():'';
    if(v&&selTreats.indexOf(v)===-1)selTreats.push(v);
    _inputMode=null; renderTreat();
  }
  /* 닫힘 애니메이션 — 실제 증상 모달과 동일한 fade + scale (closeModalGracefully 는 .modal-content 전용이라 미사용) */
  function closeAnim(){
    if(_favWatch){clearInterval(_favWatch);_favWatch=null;}
    var box=document.getElementById('fdstBox');
    if(box){box.style.transition='opacity 0.18s ease, transform 0.18s ease';box.style.opacity='0';box.style.transform='scale(0.95)';}
    setTimeout(function(){ if(ov&&ov.parentNode)ov.remove(); },190);
  }
  /* 저장 후 닫기 — 바깥 클릭 시 자동 저장.
   *  중분류 증상 + 처치를 모두 선택해야 체크 ON (사용자 요청 2026-06-12). 불완전하면 체크 해제. */
  function saveClose(){
    var treats=resultList();
    var complete=!!selSym && treats.length>0;
    closeAnim();
    if(complete)_fdApplySymTreat(secId, optIdx, {symptoms:[selSym],treatments:treats});
    else if(opt.hasSymTreatInsert)_fdClearSymTreat(secId, optIdx);
  }
  ov.addEventListener('mousedown',function(e){ if(e.target===ov)saveClose(); });
  ov.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return;
    var t=e.target;
    if(t&&t.id==='fdstFreeInput')freeConfirm();
  });
  ov.addEventListener('click',function(e){
    var tg=e.target.closest?e.target.closest('[data-fdst]'):null;
    if(!tg)return;
    var a=tg.getAttribute('data-fdst');
    if(a==='cat'){ selCatId=tg.getAttribute('data-cat'); _inputMode=null; renderAll(); }
    else if(a==='sym'){ selSym=tg.getAttribute('data-sym'); selTreats=[]; _inputMode=null; renderSym(); renderTreat(); }
    else if(a==='symdel'){ e.stopPropagation(); selSym=null; selTreats=[]; _inputMode=null; renderSym(); renderTreat(); }
    else if(a==='fav'){ var tr=tg.getAttribute('data-treat'); if(e.target.closest('[data-fdst="favdel"]'))return; if(tr==='투약'){ openDrugPicker(); } else { var i=selTreats.indexOf(tr); if(i!==-1)selTreats.splice(i,1); else selTreats.push(tr); renderTreat(); } }
    else if(a==='favdel'){ e.stopPropagation(); var t2=tg.getAttribute('data-treat'); if(!REMOVED[selSym])REMOVED[selSym]=[]; if(REMOVED[selSym].indexOf(t2)===-1){REMOVED[selSym].push(t2);_saveRemoved();} var fi2=(FAV[selSym]||[]).indexOf(t2); if(fi2!==-1){FAV[selSym].splice(fi2,1);_saveFav();} var si=selTreats.indexOf(t2); if(si!==-1)selTreats.splice(si,1); renderTreat(); }
    else if(a==='treatdel'){ e.stopPropagation(); var t3=tg.getAttribute('data-treat'); var i3=selTreats.indexOf(t3); if(i3!==-1)selTreats.splice(i3,1); renderTreat(); }
    else if(a==='openmed'){ if(e.target.closest('[data-fdst="treatdel"]'))return; openDrugPicker(); }
    else if(a==='addfav'){ openAddOptions(); }
    else if(a==='freetext'){ _inputMode='free'; renderTreat(); }
    else if(a==='freeok'){ freeConfirm(); }
  });
}

/* 인적사항 이용 대상(학생/교직원) 토글 — 기본 둘 다 true. false 만 명시 저장(옛 flow 데이터 호환).
 *  둘 다 해제는 불가(키오스크에서 아무도 선택 못 하게 됨). (사용자 요청 2026-06-11) */
function _fdTogglePersonalType(ptype, checked){
  var flow = _fdGetFlow();
  var sec = _fdFindSection(flow, 's_personal');
  if(!sec) return;
  var key = (ptype === 'staff') ? 'allowStaff' : 'allowStudent';
  var other = (ptype === 'staff') ? 'allowStudent' : 'allowStaff';
  if(!checked && sec[other] === false){
    bus.emit('toast:show', {text: '학생·교직원 중 최소 한 가지는 이용할 수 있어야 합니다.'});
    if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk'); /* 체크박스 원복 */
    return;
  }
  _fdPushHistory('인적사항 이용 대상 변경');
  if(checked) delete sec[key]; else sec[key] = false;
  ks.flowDesigner = flow;
  _save(); try{ bus.emit('toast:save'); }catch(_){}
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}


/* ══════════════════════════════════════════
   언어 선택 섹션
   ══════════════════════════════════════════ */

/* ══════════════════════════════════════════
   액션 핸들러
   ══════════════════════════════════════════ */





function _fdSetOptionLabel(secId, optIdx, val){
  const flow = _fdGetFlow();
  const sec = _fdFindSection(flow, secId);
  if(!sec || !sec.options || !sec.options[optIdx]) return;
  const oldLabel = sec.options[optIdx].label;
  sec.options[optIdx].label = val;
  /* 방문 목적이면 하위 섹션 헤더명도 연동 */
  if(secId === 's_purpose'){
    const targetId = sec.options[optIdx].target;
    const targetSec = _fdFindSection(flow, targetId);
    if(targetSec && targetSec.headerName === oldLabel){
      targetSec.headerName = val;
    }
  }
  ks.flowDesigner = flow;
  _fdAutoSave();
}

function _fdAddOption(secId){
  const flow = _fdGetFlow();
  const sec = _fdFindSection(flow, secId);
  if(!sec) return;
  if(!sec.options) sec.options = [];
  if(sec.options.length >= 15) {
    bus.emit('toast:show', {text: '보기는 최대 15개까지 추가할 수 있습니다.'});
    return;
  }
  /* 실제 추가 직전에 기록 — 변화 없는 early-return 시 히스토리/redo 오염 방지 */
  _fdPushHistory('보기 추가');
  const newOpt = {
    id: _fdGenId('o'),
    label: '새 보기',
    emoji: '📌',
    target: '__done',
    enabled: true,
    isDefault: false
  };
  sec.options.push(newOpt);

  /* 방문 목적에 보기 추가 시 하위 섹션 자동 생성 */
  if(secId === 's_purpose'){
    const newSecId = _fdGenId('s');
    const newSec = {
      id: newSecId,
      headerName: '새 보기',
      type: 'choice',
      depth: 1,
      parentId: 's_purpose',
      options: [],
      enabled: true,
      isDefault: false
    };
    flow.sections.push(newSec);
    newOpt.target = newSecId;
  }

  ks.flowDesigner = flow;
  _fdAutoSave();
  _skipSettingsAnim = true;
  /* 플로우 디자이너 팝업이 열려 있으면 팝업 내용만 재렌더, 아니면 설정 패널 재렌더 */
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}

function _fdMoveOption(secId, optIdx, dir){
  var flow = _fdGetFlow();
  var sec = _fdFindSection(flow, secId);
  if(!sec || !sec.options) return;
  var toIdx = optIdx + dir;
  if(toIdx < 0 || toIdx >= sec.options.length) return;
  _fdPushHistory('항목 순서 변경');
  var moved = sec.options.splice(optIdx, 1)[0];
  sec.options.splice(toIdx, 0, moved);
  ks.flowDesigner = flow;
  _fdAutoSave();
  _skipSettingsAnim = true;
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}

function _fdRemoveOption(secId, optIdx){
  /* 삭제 애니메이션: 해당 보기 요소 찾아서 fadeOut */
  const secEl = document.querySelector('[data-sec-id="' + secId + '"]');
  if(secEl){
    const optEls = secEl.querySelectorAll('.fd-opt-row');
    let target = optEls && optEls[optIdx];
    if(!target){
      /* fallback: 보기 컨테이너의 직접 자식 */
      const container = secEl.querySelector('[style*="flex-direction:column"]');
      if(container) target = container.children[optIdx];
    }
    if(target){
      target.style.transition = 'opacity .25s ease, transform .25s ease, max-height .25s ease';
      target.style.opacity = '0';
      target.style.transform = 'translateX(20px)';
      target.style.maxHeight = target.offsetHeight + 'px';
      target.style.overflow = 'hidden';
      setTimeout(function(){ target.style.maxHeight = '0'; target.style.padding = '0'; target.style.margin = '0'; }, 100);
      setTimeout(function(){ _fdDoRemoveOption(secId, optIdx); }, 320);
      return;
    }
  }
  _fdDoRemoveOption(secId, optIdx);
}
function _fdDoRemoveOption(secId, optIdx){
  const flow = _fdGetFlow();
  const sec = _fdFindSection(flow, secId);
  if(!sec || !sec.options) return;
  const opt = sec.options[optIdx];
  /* 하위 섹션도 삭제 (방문 목적에서 제거 시) */
  if(secId === 's_purpose' && opt && opt.target && !opt.target.startsWith('__')){
    _fdDeleteSectionRecursive(flow, opt.target);
  }
  sec.options.splice(optIdx, 1);
  ks.flowDesigner = flow;
  _fdAutoSave();
  _skipSettingsAnim = true;
  /* 플로우 디자이너 팝업이 열려 있으면 팝업 내용만 재렌더, 아니면 설정 패널 재렌더 */
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}

function _fdDeleteSectionRecursive(flow, secId){
  const sec = _fdFindSection(flow, secId);
  if(!sec) return;
  if(sec.options){
    sec.options.forEach(function(opt){
      if(opt.target && !opt.target.startsWith('__')){
        _fdDeleteSectionRecursive(flow, opt.target);
      }
    });
  }
  flow.sections = flow.sections.filter(function(s){ return s.id !== secId; });
}

/* 선택된 옵션들에만 삽입 플래그 적용 (바디맵/대기인원)
 * 옵션 선택 상태는 _fdSelectedOpts = { secId: [optIdx, ...] } */
let _fdSelectedOpts = {};

/* ══ Undo/Redo 스택 — 최대 30개 작업 저장 ══
 * 구조: _fdUndoStack = [{ label, snapshot(JSON) }, ...]
 *       _fdRedoStack = [...]
 * 스냅샷은 flow 전체를 JSON 직렬화 */
/* _fdUndoStack/_fdRedoStack은 IIFE 최상단에 var 선언됨 (전역 변수 최소화) */
const _FD_UNDO_MAX = 30;

function _fdPushHistory(label){
  try {
    const flow = _fdGetFlow();
    const snap = JSON.stringify(flow);
    _fdUndoStack.push({label:label, snap:snap, time:Date.now()});
    if(_fdUndoStack.length > _FD_UNDO_MAX) _fdUndoStack.shift();
    /* 새 작업이 들어오면 Redo 스택 초기화 */
    _fdRedoStack = [];
  } catch(e){}
}

function _fdUndo(){
  if(!_fdUndoStack || !_fdUndoStack.length){
    bus.emit('toast:show', {text: '실행 취소할 작업이 없습니다'});
    return;
  }
  const last = _fdUndoStack.pop();
  const currentFlow = JSON.stringify(_fdGetFlow());
  _fdRedoStack.push({label:last.label, snap:currentFlow, time:Date.now()});
  try {
    ks.flowDesigner = JSON.parse(last.snap);
    _fdAutoSave();
    if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
    bus.emit('toast:show', {text: '↶ 실행 취소: '+last.label});
  } catch(e){console.error('[fdUndo]',e);}
}

function _fdRedo(){
  if(!_fdRedoStack || !_fdRedoStack.length){
    bus.emit('toast:show', {text: '다시 실행할 작업이 없습니다'});
    return;
  }
  const next = _fdRedoStack.pop();
  const currentFlow = JSON.stringify(_fdGetFlow());
  _fdUndoStack.push({label:next.label, snap:currentFlow, time:Date.now()});
  try {
    ks.flowDesigner = JSON.parse(next.snap);
    _fdAutoSave();
    if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
    bus.emit('toast:show', {text: '↷ 다시 실행: '+next.label});
  } catch(e){console.error('[fdRedo]',e);}
}

/* ══ 섹션 접기/펼치기 상태 ══
 * localStorage에 {secId: true(collapsed)} 저장 */
function _fdGetCollapsed(){
  try { return JSON.parse(localStorage.getItem('ec_kiosk_fd_collapsed')||'{}'); }
  catch(e){ return {}; }
}
function _fdSetCollapsed(obj){
  try { localStorage.setItem('ec_kiosk_fd_collapsed',JSON.stringify(obj)); } catch(e){}
}

function _fdJumpToSection(secId){
  const toc = document.getElementById('fdTocOverlay'); if(toc) closeModalGracefully(toc);
  /* 해당 섹션이 접혀있으면 펼치기 */
  const st = _fdGetCollapsed();
  if(st[secId]){ delete st[secId]; _fdSetCollapsed(st); }
  _cbRefreshFlowPopup();
  /* 스크롤 이동 */
  setTimeout(function(){
    const el = document.getElementById('fd-sec-'+secId);
    if(el){
      el.scrollIntoView({behavior:'smooth', block:'start'});
      /* 잠깐 하이라이트 */
      const prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px rgba(6,182,212,0.4)';
      el.style.transition = 'box-shadow .3s';
      setTimeout(function(){ el.style.boxShadow = prev||''; }, 1500);
    }
  }, 80);
}

/* ══ 기본 플로우로 초기화 ══ */
function _fdResetToDefault(){
  const existing = document.getElementById('fdResetOverlay');
  if(existing){ closeModalGracefully(existing); return; }
  const ov = document.createElement('div');
  ov.id = 'fdResetOverlay';
  ov.className = 'modal-overlay show';
  ov.style.zIndex = '13800'; /* 플로우 디자이너 팝업 위 */
  ov.innerHTML =
    '<div class="modal-content" style="width:420px;max-width:92vw;padding:0;overflow:hidden;border-radius:14px">'
    + '<div style="padding:16px 22px;background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px">'
    +   '<span style="font-size:20px">🔄</span>'
    +   '<div style="font-size:14px;font-weight:800;color:var(--t1)">기본 플로우로 초기화</div>'
    + '</div>'
    + '<div style="padding:20px 22px;font-size:12.5px;color:var(--t2);line-height:1.7">'
    +   '현재 편집한 <b style="color:var(--t1)">모든 플로우 설정</b>을 기본값으로 되돌립니다.'
    +   '<div style="margin-top:12px;padding:10px 12px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;font-size:11px;color:var(--t3);line-height:1.6">'
    +     '↶ 되돌리기 전 상태는 <b style="color:var(--cyan)">실행 취소(Ctrl/Cmd+Z)</b>로 복구할 수 있습니다.'
    +   '</div>'
    + '</div>'
    + '<div style="padding:14px 22px;border-top:1px solid var(--bdr);background:var(--bg2);display:flex;gap:8px;justify-content:flex-end">'
    +   '<button data-action="reset-cancel" class="btn btn-outline btn-sm" style="padding:8px 18px;font-size:12px">취소</button>'
    +   '<button data-action="reset-confirm" class="btn btn-sm" style="padding:8px 20px;font-size:12px;background:#ef4444;color:#fff;border:none;font-weight:700;border-radius:8px;cursor:pointer">초기화</button>'
    + '</div>'
    + '</div>';
  ov.addEventListener('mousedown', function(e){ if(e.target===ov) closeModalGracefully(ov); });
  ov.addEventListener('click', function(e){
    const t = e.target.closest('[data-action]'); if(!t) return;
    const act = t.getAttribute('data-action');
    if(act==='reset-cancel'){ closeModalGracefully(ov); }
    else if(act==='reset-confirm'){ closeModalGracefully(ov); _fdDoResetToDefault(); }
  });
  document.body.appendChild(ov);
}

function _fdDoResetToDefault(){
  _fdPushHistory('기본 플로우로 초기화');
  delete ks.flowDesigner;
  _fdAutoSave();
  /* 접기 상태도 초기화 */
  _fdSetCollapsed({});
  _cbRefreshFlowPopup();
  bus.emit('toast:show', {text: '기본 플로우로 초기화되었습니다'});
}

/* 전역 단축키 — 플로우 디자이너 팝업이 열려있을 때만 동작 */
/* _fdAttachHotkeys */
if(!_fdHotkeysAttached){
  _fdHotkeysAttached = true;
  document.addEventListener('keydown', function(e){
    /* 플로우 디자이너 팝업이 열려 있지 않으면 무시 */
    if(!document.getElementById('_kcFlowOverlay')) return;
    /* 입력 요소 포커스 시 무시 (undo가 입력창의 undo와 충돌) */
    const tgt = e.target;
    if(tgt && (tgt.tagName==='INPUT' || tgt.tagName==='TEXTAREA' || tgt.isContentEditable)) return;
    const mod = e.metaKey || e.ctrlKey;
    if(mod && e.key.toLowerCase()==='z' && !e.shiftKey){
      e.preventDefault(); _fdUndo();
    } else if(mod && ((e.key.toLowerCase()==='z' && e.shiftKey) || e.key.toLowerCase()==='y')){
      e.preventDefault(); _fdRedo();
    }
  }, true);
}

/* ══ 플로우 검증 — 키오스크 배포 전 문제 사전 발견 ══ */
function _fdValidateFlow(){
  const flow = _fdGetFlow();
  const issues = [];
  flow.sections.forEach(function(sec){
    if(sec.id==='s_personal')return;/* 인적사항은 특수 처리 */
    /* 섹션 헤더명 없음 */
    if(!sec.headerName||!sec.headerName.trim()){
      issues.push({sev:'warn',secId:sec.id,optIdx:-1,msg:'섹션 제목이 비어 있습니다'});
    }
    /* 선택형인데 옵션 0개 */
    if(sec.type==='choice' && (!sec.options||sec.options.length===0)){
      issues.push({sev:'warn',secId:sec.id,optIdx:-1,msg:'선택형 섹션이지만 보기가 없습니다'});
    }
    /* 안내형인데 안내문 없음 */
    if(sec.type==='guide' && !(sec.guideText||'').trim()){
      issues.push({sev:'warn',secId:sec.id,optIdx:-1,msg:'안내형 섹션이지만 안내문이 비어 있습니다'});
    }
    /* 옵션 검증 */
    (sec.options||[]).forEach(function(opt,oi){
      if(!opt.label||!opt.label.trim()){
        issues.push({sev:'warn',secId:sec.id,optIdx:oi,msg:'보기 라벨이 비어 있습니다'});
      }
      /* 끊어진 타깃 */
      const tgt = opt.target;
      if(tgt && tgt.indexOf('__')!==0){
        const tgtSec = _fdFindSection(flow, tgt);
        if(!tgtSec){
          issues.push({sev:'error',secId:sec.id,optIdx:oi,msg:'끊어진 연결 — 가리키는 섹션이 존재하지 않습니다'});
        }
      }
    });
  });
  return issues;
}

/* 검증 결과 팝업 */
function _fdShowValidationPopup(){
  const issues = _fdValidateFlow();
  const existing = document.getElementById('fdValidOverlay');if(existing)closeModalGracefully(existing);
  const ov = document.createElement('div');
  ov.id='fdValidOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:13700;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center';
  let html='<div class="modal-content" style="width:500px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden">';
  html+='<div style="padding:14px 20px;background:var(--bg2);border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between">'
    +'<span style="font-size:13px;font-weight:800;color:var(--t1)">'+(issues.length?'⚠ 플로우 문제 '+issues.length+'건':'✅ 플로우 정상')+'</span>'
    +'<button data-action="close-valid" style="background:none;border:none;font-size:16px;color:var(--t3);cursor:pointer">✕</button>'
    +'</div>';
  html+='<div style="flex:1;overflow-y:auto;padding:12px 16px">';
  if(!issues.length){
    html+='<div style="padding:30px;text-align:center;color:var(--t2);font-size:12px;line-height:1.8">문제가 발견되지 않았습니다.<br>키오스크 접속 URL을 안전하게 생성할 수 있습니다.</div>';
  } else {
    issues.forEach(function(iss){
      const isErr = iss.sev==='error';
      const color = isErr?'#ef4444':'#f59e0b';
      const icon = isErr?'❌':'⚠';
      const flow = _fdGetFlow();
      const sec = _fdFindSection(flow, iss.secId);
      const secLabel = sec ? (_fdGetSectionNumber(flow,iss.secId)+'. '+(sec.headerName||'(제목 없음)')) : iss.secId;
      const optInfo = iss.optIdx>=0 ? ' — 보기 '+(iss.optIdx+1) : '';
      html+='<div data-action="valid-jump" data-sec-id="'+iss.secId+'" class="fd-valid-item" style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:8px;margin-bottom:4px;cursor:pointer;border:1px solid '+color+'33;background:'+color+'0c" data-bg-normal="'+color+'0c" data-bg-hover="'+color+'1a">'
        +'<span style="font-size:14px;flex-shrink:0">'+icon+'</span>'
        +'<div style="flex:1;min-width:0">'
        +  '<div style="font-size:11px;font-weight:700;color:'+color+'">'+escHtml(iss.msg)+'</div>'
        +  '<div style="font-size:10px;color:var(--t3);margin-top:2px">'+escHtml(secLabel)+escHtml(optInfo)+'</div>'
        +'</div>'
        +'<span style="font-size:9px;color:var(--t3)">클릭 → 이동</span>'
        +'</div>';
    });
  }
  html+='</div></div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){
    if(e.target===ov){closeModalGracefully(ov);return;}
    const t=e.target.closest('[data-action]');
    if(!t)return;
    const act=t.getAttribute('data-action');
    if(act==='close-valid')closeModalGracefully(ov);
    else if(act==='valid-jump'){_fdJumpToSection(t.getAttribute('data-sec-id'));closeModalGracefully(ov);}
  });
  document.body.appendChild(ov);
}


function _fdPickOptionEmoji(secId, optIdx){
  const flow = _fdGetFlow();
  const sec = _fdFindSection(flow, secId);
  if(!sec || !sec.options || !sec.options[optIdx]) return;
  const cur = sec.options[optIdx].emoji || '📌';
  openEmojiPicker(cur, function(emoji){
    sec.options[optIdx].emoji = emoji;
    ks.flowDesigner = flow;
    _fdAutoSave();
    _skipSettingsAnim = true;
    /* 플로우 디자이너 팝업이 열려 있으면 팝업 내용만 재렌더, 아니면 설정 패널 재렌더 */
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
  });
}




export function _fdDownloadKioskHtml(){ downloadKioskHtml(_fdGetFlow); }
/* URL 접속 방식 (2026-06-12) — 흐름 편집기에서도 빌드→업로드→QR/URL 표시 */
export function _fdGenerateKioskUrl(){ generateKioskUrl(_fdGetFlow); }

/* ── 태그 선택 드롭다운 (2026-06-12) ──
 *  칩 버튼 클릭 → FD_TAGS 6종 목록. 각 항목 호버 시 공용 미니팝업(data-tooltip — 편집 오버레이의
 *  mouseover 위임이 처리)으로 연결 기능 설명. 선택 시 opt.tag 저장 + 칩 즉시 갱신. */
function _fdOpenTagDropdown(anchor, secId, optIdx){
  var old=document.getElementById('_fdTagDd'); if(old){old.remove();return;} /* 재클릭 = 토글 닫기 */
  var rect=anchor.getBoundingClientRect();
  var flow=_fdGetFlow();
  var sec=_fdFindSection(flow, secId);
  var cur=(sec&&sec.options&&sec.options[optIdx]&&sec.options[optIdx].tag)||'';
  var dd=document.createElement('div');
  dd.id='_fdTagDd';
  dd.style.cssText='position:fixed;left:'+Math.round(rect.left)+'px;top:'+Math.round(rect.bottom+4)+'px;z-index:13000;'
    +'background:var(--card);border:1px solid var(--bdr);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.22);padding:5px;min-width:190px';
  var h='';
  FD_TAGS.forEach(function(tg){
    var sel=(tg.label===cur);
    h+='<div class="_fdTagItem" data-tag-label="'+escHtml(tg.label)+'" data-tooltip="'+escHtml(tg.tip)+'" data-tooltip-instant="1" '
      +'style="display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:'+(sel?'800':'700')+';color:'+(sel?'var(--cyan)':'var(--t1)')+';background:'+(sel?'rgba(6,182,212,0.08)':'transparent')+';white-space:nowrap;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif">'
      +'<span style="width:13px;flex-shrink:0;color:var(--cyan)">'+(sel?'✓':'')+'</span>'+escHtml(tg.label)+'</div>';
  });
  dd.innerHTML=h;
  /* 편집 오버레이 내부에 부착 — data-tooltip mouseover 위임 범위 안 (미니팝업 작동) */
  var host=anchor.closest('.modal-overlay')||document.body;
  host.appendChild(dd);
  /* 화면 아래로 넘치면 위로 펼침 */
  var dh=dd.offsetHeight;
  if(rect.bottom+4+dh>window.innerHeight) dd.style.top=Math.max(6,Math.round(rect.top-dh-4))+'px';
  dd.querySelectorAll('._fdTagItem').forEach(function(it){
    it.addEventListener('mouseenter',function(){ if(this.getAttribute('data-tag-label')!==cur)this.style.background='var(--bg2)'; });
    it.addEventListener('mouseleave',function(){ this.style.background=(this.getAttribute('data-tag-label')===cur)?'rgba(6,182,212,0.08)':'transparent'; });
    it.addEventListener('click',function(ev){
      ev.stopPropagation();
      var label=this.getAttribute('data-tag-label')||'';
      var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
      if(sc&&sc.options&&sc.options[optIdx]){
        sc.options[optIdx].tag=label;
        ks.flowDesigner=fl;
        _fdAutoSave();
        /* 칩 즉시 갱신 (전체 리렌더 없이) */
        try{
          var sp=anchor.querySelector('span');
          if(sp)sp.textContent=label;
          anchor.style.borderColor='rgba(6,182,212,0.35)';
          anchor.style.background='rgba(6,182,212,0.08)';
          anchor.style.color='var(--cyan)';
        }catch(_){}
      }
      dd.remove();
    });
  });
  /* 외부 클릭/ESC 닫기 */
  setTimeout(function(){
    var close=function(ev){
      if(ev.type==='keydown'&&ev.key!=='Escape')return;
      if(ev.type==='mousedown'&&dd.contains(ev.target))return;
      dd.remove();
      document.removeEventListener('mousedown',close,true);
      document.removeEventListener('keydown',close,true);
    };
    document.addEventListener('mousedown',close,true);
    document.addEventListener('keydown',close,true);
  },0);
}

/* ── 공용 미니 드롭다운 (2026-06-13) — 하위 항목 기능 선택용.
 *  items: [{label, tip, value}] · footer: {label, tip, onClick} (예: 물품 [+ 추가]).
 *  data-tooltip 미니팝업은 편집 오버레이의 mouseover 위임이 처리. */
function _fdOpenFnDropdown(anchor, items, curValue, onPick, footer, onEdit){
  var old=document.getElementById('_fdFnDd'); if(old){old.remove();return;} /* 재클릭 = 토글 닫기 */
  var rect=anchor.getBoundingClientRect();
  var dd=document.createElement('div');
  dd.id='_fdFnDd';
  dd.style.cssText='position:fixed;left:'+Math.round(rect.left)+'px;top:'+Math.round(rect.bottom+4)+'px;z-index:13000;'
    +'background:var(--card);border:1px solid var(--bdr);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.22);padding:5px;min-width:170px;max-height:300px;overflow-y:auto';
  var _mg="font-family:'맑은 고딕','Malgun Gothic',sans-serif";
  var h='';
  items.forEach(function(it,ix){
    var sel=(it.value===curValue);
    h+='<div class="_fdFnItem" data-ix="'+ix+'" '+(it.tip?'data-tooltip="'+escHtml(it.tip)+'" data-tooltip-instant="1" ':'')
      +'style="display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:'+(sel?'800':'700')+';color:'+(sel?'var(--cyan)':'var(--t1)')+';background:'+(sel?'rgba(6,182,212,0.08)':'transparent')+';white-space:nowrap;'+_mg+'">'
      +'<span style="width:13px;flex-shrink:0;color:var(--cyan)">'+(sel?'✓':'')+'</span><span style="flex:1">'+escHtml(it.label)+'</span>'
      /* 항목 오른편 아이콘(✏️/📅 등) — 그 항목의 추가 설정 (사용자 설계 2026-06-13) */
      +(onEdit&&it.edit?'<span class="_fdFnEdit" data-ix="'+ix+'" data-tooltip="'+escHtml(it.editTip||'이 선택지의 키오스크 마지막 안내 문구를 수정합니다.')+'" data-tooltip-instant="1" style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:22px;height:20px;border-radius:5px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.10);font-size:11px;cursor:pointer">'+(it.editIcon||'✏️')+'</span>':'')
      +'</div>';
  });
  if(footer){
    h+='<div class="_fdFnFooter" '+(footer.tip?'data-tooltip="'+escHtml(footer.tip)+'" data-tooltip-instant="1" ':'')
      +'style="display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:800;color:#f97316;border-top:1px dashed var(--bdr);margin-top:3px;white-space:nowrap;'+_mg+'">'
      +'<span style="width:13px;flex-shrink:0">＋</span>'+escHtml(footer.label)+'</div>';
  }
  dd.innerHTML=h;
  var host=anchor.closest('.modal-overlay')||document.body;
  host.appendChild(dd);
  var dh=dd.offsetHeight;
  if(rect.bottom+4+dh>window.innerHeight) dd.style.top=Math.max(6,Math.round(rect.top-dh-4))+'px';
  var closeDd=function(){ try{dd.remove();}catch(_){} };
  dd.querySelectorAll('._fdFnItem').forEach(function(it){
    it.addEventListener('mouseenter',function(){ this.style.background='var(--bg2)'; });
    it.addEventListener('mouseleave',function(){ var sel=(items[parseInt(this.getAttribute('data-ix'),10)]||{}).value===curValue; this.style.background=sel?'rgba(6,182,212,0.08)':'transparent'; });
    it.addEventListener('click',function(ev){
      ev.stopPropagation();
      var item=items[parseInt(this.getAttribute('data-ix'),10)];
      /* ✏️ 클릭 → 선택이 아니라 문구 편집 (2026-06-13) */
      if(ev.target.closest&&ev.target.closest('._fdFnEdit')){ closeDd(); if(item&&onEdit)onEdit(item.value, item); return; }
      closeDd();
      if(item&&onPick)onPick(item.value, item);
    });
  });
  var ft=dd.querySelector('._fdFnFooter');
  if(ft){
    ft.addEventListener('mouseenter',function(){ this.style.background='rgba(249,115,22,0.08)'; });
    ft.addEventListener('mouseleave',function(){ this.style.background='transparent'; });
    ft.addEventListener('click',function(ev){ ev.stopPropagation(); closeDd(); if(footer.onClick)footer.onClick(); });
  }
  setTimeout(function(){
    var close=function(ev){
      if(ev.type==='keydown'&&ev.key!=='Escape')return;
      if(ev.type==='mousedown'&&dd.contains(ev.target))return;
      closeDd();
      document.removeEventListener('mousedown',close,true);
      document.removeEventListener('keydown',close,true);
    };
    document.addEventListener('mousedown',close,true);
    document.addEventListener('keydown',close,true);
  },0);
}

/* 옵션 필드 갱신 공통 — 저장 후 편집기 리렌더 (드롭다운 선택이 다른 칩 활성/비활성에 연동되므로 전체 갱신) */
function _fdSetOptField(secId, optIdx, field, value){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  if(!sec||!sec.options||!sec.options[optIdx])return;
  sec.options[optIdx][field]=value;
  ks.flowDesigner=flow;
  _save(); try{ bus.emit('toast:save'); }catch(_){}
  if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
}

/* [보건일지에 등록/미등록] — 진료/처치 하위 (2026-06-13) */
function _fdOpenDiaryDropdown(anchor, secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var cur=(sec&&sec.options&&sec.options[optIdx]&&sec.options[optIdx].diaryRegister!==false);
  _fdOpenFnDropdown(anchor, FD_DIARY_OPTS, cur, function(v){
    /* 미등록으로 바꾸면 증상처치입력도 함께 해제 (비활성 + 데이터 정리) */
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(sc&&sc.options&&sc.options[optIdx]){
      sc.options[optIdx].diaryRegister=v;
      if(v===false){ delete sc.options[optIdx].hasSymTreatInsert; delete sc.options[optIdx].symptomTreat; }
      ks.flowDesigner=fl; _save();
      if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
    }
  });
}

/* [반납 필요/불필요] — 물품 대여 하위 (2026-06-13) */
function _fdOpenReturnDropdown(anchor, secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var cur=(sec&&sec.options&&sec.options[optIdx]&&sec.options[optIdx].returnNeeded===true);
  _fdOpenFnDropdown(anchor, FD_RETURN_OPTS, cur, function(v){
    /* 반납 불필요로 바꾸면 지정 물품도 정리 (대장 미기록이므로). 반납 일자는 물품별 속성이라 여기서 안 다룸 (사용자 정정 2026-06-13) */
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(sc&&sc.options&&sc.options[optIdx]){
      sc.options[optIdx].returnNeeded=v;
      if(v===false) delete sc.options[optIdx].rentalItem;
      ks.flowDesigner=fl; _save();
      if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
    }
  });
}
/* [반납 일자] — 대여일로부터 평일 N일(1~5) 후 선택. GUI 는 doneMsg 팝업과 동일 톤, 애니메이션 (사용자 설계 2026-06-13) */
function _fdOpenReturnDaysPopup(anchor, secId, optIdx){
  var old=document.getElementById('_fdRetDaysPop'); if(old)old.remove();
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var opt=(sec&&sec.options&&sec.options[optIdx])||{};
  var cur=opt.returnDays||1;
  var rect=anchor.getBoundingClientRect();
  var pop=document.createElement('div');
  pop.id='_fdRetDaysPop';
  pop.style.cssText='position:fixed;left:'+Math.max(8,Math.round(rect.left))+'px;top:'+Math.round(rect.bottom+6)+'px;z-index:13100;'
    +'background:var(--card);border:1px solid var(--bdr);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.25);padding:13px 15px;width:268px;opacity:0;transform:scale(0.94);transition:opacity .16s ease,transform .18s cubic-bezier(.34,1.56,.64,1)';
  var btns='';
  for(var dN=1;dN<=5;dN++){
    var on=(dN===cur);
    btns+='<button type="button" data-days="'+dN+'" style="flex:1;padding:9px 0;border-radius:9px;border:1.5px solid '+(on?'var(--cyan)':'var(--bdr)')+';background:'+(on?'rgba(6,182,212,0.12)':'var(--card)')+';color:'+(on?'var(--cyan)':'var(--t1)')+';font-size:13px;font-weight:800;cursor:pointer;font-family:var(--f)">'+dN+'일</button>';
  }
  pop.innerHTML=
    '<div style="font-size:11px;font-weight:800;color:var(--t1);margin-bottom:7px">📅 반납 일자 — 대여일로부터 평일 기준</div>'
    +'<div style="display:flex;gap:5px;margin-bottom:7px">'+btns+'</div>'
    +'<div style="font-size:9.5px;color:var(--t3);line-height:1.5">방문자가 빌릴 때 이 일수만큼 뒤(주말 제외)의 날짜가 반납 일자로 표시됩니다.<br>바깥을 클릭하면 저장됩니다.</div>';
  var host=anchor.closest('.modal-overlay')||document.body;
  host.appendChild(pop);
  requestAnimationFrame(function(){ pop.style.opacity='1'; pop.style.transform='scale(1)'; });
  if(rect.bottom+6+pop.offsetHeight>window.innerHeight) pop.style.top=Math.max(6,Math.round(rect.top-pop.offsetHeight-6))+'px';
  var _selDays=cur;
  var _saveDays=function(){
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(sc&&sc.options&&sc.options[optIdx]){ sc.options[optIdx].returnNeeded=true; sc.options[optIdx].returnDays=_selDays; ks.flowDesigner=fl; _save(); }
    document.removeEventListener('mousedown',_outside,true);
    pop.style.opacity='0'; pop.style.transform='scale(0.94)';
    setTimeout(function(){ try{pop.remove();}catch(_){} if(!_cbRefreshFlowPopup())renderSettingsPanel('kiosk'); },170);
  };
  pop.querySelectorAll('button[data-days]').forEach(function(b){
    b.addEventListener('click',function(ev){
      ev.stopPropagation();
      _selDays=parseInt(this.getAttribute('data-days'),10);
      _saveDays();   /* 일수 클릭 = 즉시 저장 + 팝업 닫기 (사용자 요청 2026-06-13) */
    });
  });
  var _outside=function(ev){ if(pop.contains(ev.target))return; _saveDays(); };
  setTimeout(function(){ document.addEventListener('mousedown',_outside,true); },0);
}

/* [물품 지정] — 보건실 물품 대여 대장 등록 물품 + [+ 추가](대장 실시간 연동) (2026-06-13).
 *  각 물품 옆 📅 = 그 물품으로 지정 + 반납 일자(평일 N일) 설정 — 물품별로 다르게 (사용자 정정 2026-06-13). */
function _fdOpenItemDropdown(anchor, secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var cur=(sec&&sec.options&&sec.options[optIdx]&&sec.options[optIdx].rentalItem)||'';
  var items=rentalGetItems().map(function(n){ return {label:n, value:n, tip:'', edit:true, editIcon:'📅', editTip:'이 물품의 반납 일자(대여일로부터 평일 N일 후)를 정합니다.'}; });
  _fdOpenFnDropdown(anchor, items, cur,
    function(v){ _fdSetOptField(secId, optIdx, 'rentalItem', v); },         /* 물품 클릭 = 지정만 */
    {
      label:'추가',
      tip:'보건실 물품 대여 대장에 대여 물품을 바로 등록 가능하며 연동됩니다.',
      onClick:function(){
        _symPrompt('새 대여 물품 이름을 입력하세요.', '', function(name){
          var n=String(name||'').trim();
          if(!n)return;
          if(rentalAddItem(n)){
            _fdSetOptField(secId, optIdx, 'rentalItem', n);
            bus.emit('toast:show',{text:'✅ "'+n+'" 이(가) 물품 대여 대장에 등록되었습니다.'});
          }
        });
      }
    },
    function(v){                                                            /* 📅 클릭 = 그 물품 지정 + 반납 일자 팝업 */
      var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
      if(sc&&sc.options&&sc.options[optIdx]){ sc.options[optIdx].rentalItem=v; ks.flowDesigner=fl; _save(); }
      _fdOpenReturnDaysPopup(anchor, secId, optIdx);
    });
}

/* [대기하게 하기/바로 들어오게 하기] — 옛 접수 체크 대체 (2026-06-13).
 *  선택 시 키오스크 마지막 안내 문구 편집 미니 팝업 — 디폴트 문구 블록 선택 상태, 외부 클릭 = 저장. */
function _fdOpenWaitDropdown(anchor, secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var cur=(sec&&sec.options&&sec.options[optIdx]&&sec.options[optIdx].waitMode)||'wait';
  var _applyMode=function(v, openMsg){
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(!(sc&&sc.options&&sc.options[optIdx]))return;
    var o=sc.options[optIdx];
    var modeChanged=(o.waitMode||'wait')!==v;
    o.waitMode=v;
    if(modeChanged) delete o.doneMsg;   /* 모드가 바뀌면 문구는 새 모드 디폴트부터 */
    ks.flowDesigner=fl; _save();
    if(openMsg) _fdOpenDoneMsgPopup(anchor, secId, optIdx, v);
    else if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
  };
  _fdOpenFnDropdown(anchor, FD_WAIT_OPTS, cur,
    function(v){ _applyMode(v, false); },                     /* 항목 클릭 = 모드 선택만 */
    null,
    function(v){ _applyMode(v, true); });                     /* ✏️ 클릭 = 해당 모드로 + 문구 수정 팝업 (사용자 설계 2026-06-13) */
}
/* 완료 안내 문구 편집 미니 팝업 — 외부 클릭하면 저장 (사용자 설계 2026-06-13) */
function _fdOpenDoneMsgPopup(anchor, secId, optIdx, waitMode){
  var old=document.getElementById('_fdDoneMsgPop'); if(old)old.remove();
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var opt=(sec&&sec.options&&sec.options[optIdx])||{};
  var defMsg=FD_DONE_MSG_DEFAULTS[waitMode]||FD_DONE_MSG_DEFAULTS.wait;
  var curMsg=(typeof opt.doneMsg==='string')?opt.doneMsg:defMsg;
  var rect=anchor.getBoundingClientRect();
  var pop=document.createElement('div');
  pop.id='_fdDoneMsgPop';
  pop.style.cssText='position:fixed;left:'+Math.max(8,Math.round(rect.right-300))+'px;top:'+Math.round(rect.bottom+6)+'px;z-index:13100;'
    +'background:var(--card);border:1px solid var(--bdr);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.25);padding:12px 14px;width:300px';
  pop.innerHTML=
    '<div style="font-size:11px;font-weight:800;color:var(--t1);margin-bottom:6px">키오스크 마지막 안내 문구</div>'
    +'<input id="_fdDoneMsgInp" value="'+escHtml(curMsg)+'" style="width:100%;box-sizing:border-box;font-size:12.5px;font-weight:700;padding:8px 10px;border:1.5px solid rgba(6,182,212,0.4);border-radius:8px;background:var(--bg2);color:var(--t1);outline:none;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif">'
    +'<div style="font-size:9.5px;color:var(--t3);margin-top:6px;line-height:1.5">방문자가 접수를 마치면 이 문구가 표시됩니다.<br>바깥을 클릭하면 저장됩니다. <b>비우면 완료 문구가 표시되지 않습니다.</b></div>';
  var host=anchor.closest('.modal-overlay')||document.body;
  host.appendChild(pop);
  if(rect.bottom+6+pop.offsetHeight>window.innerHeight) pop.style.top=Math.max(6,Math.round(rect.top-pop.offsetHeight-6))+'px';
  var inp=pop.querySelector('#_fdDoneMsgInp');
  inp.focus(); inp.select();   /* 디폴트 문구 블록 선택 상태 */
  var _saveMsg=function(){
    var v=String(inp.value||'').trim();
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(sc&&sc.options&&sc.options[optIdx]){
      /* WYSIWYG — 입력한 그대로 저장. 비우면 ''(완료 문구 표시 안 함)으로 저장돼 기본값으로 복원되지 않는다. (사용자 요청 2026-06-16) */
      sc.options[optIdx].doneMsg=v;
      ks.flowDesigner=fl; _save();
      try{ bus.emit('toast:save'); }catch(_){}
    }
    try{pop.remove();}catch(_){}
    if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
  };
  inp.addEventListener('keydown',function(ev){
    ev.stopPropagation();
    if(ev.key==='Enter'){ ev.preventDefault(); _saveMsg(); document.removeEventListener('mousedown',_outside,true); }
    else if(ev.key==='Escape'){ ev.preventDefault(); try{pop.remove();}catch(_){} document.removeEventListener('mousedown',_outside,true); if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk'); }
  });
  var _outside=function(ev){
    if(pop.contains(ev.target))return;
    document.removeEventListener('mousedown',_outside,true);
    _saveMsg();
  };
  setTimeout(function(){ document.addEventListener('mousedown',_outside,true); },0);
}

/* [안내문구] 편집 팝업 — 켜면 방문자가 옵션 클릭 시 안내문 표시. 외부 클릭 = 저장, 빈 값 = 끄기 (2026-06-13) */
function _fdOpenGuideMsgPopup(anchor, secId, optIdx){
  var old=document.getElementById('_fdGuideMsgPop'); if(old)old.remove();
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var opt=(sec&&sec.options&&sec.options[optIdx])||{};
  var cur=opt.guideMsg||'';
  var rect=anchor.getBoundingClientRect();
  var pop=document.createElement('div');
  pop.id='_fdGuideMsgPop';
  pop.style.cssText='position:fixed;left:'+Math.max(8,Math.round(rect.right-340))+'px;top:'+Math.round(rect.bottom+6)+'px;z-index:13100;'
    +'background:var(--card);border:1px solid var(--bdr);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.25);padding:12px 14px;width:340px;'
    +'opacity:0;transform:scale(.95);transform-origin:top right;transition:opacity .16s ease,transform .18s cubic-bezier(.34,1.45,.64,1)';   /* 켜질·꺼질 때 부드러운 팝 애니메이션 (사용자 요청 2026-06-16) */
  pop.innerHTML=
    '<div style="font-size:11px;font-weight:800;color:var(--t1);margin-bottom:6px">📋 안내문구 — 방문자가 이 항목을 선택하면 표시됩니다</div>'
    +'<textarea id="_fdGuideMsgInp" rows="5" placeholder="예) 흐르는 물로 상처를 씻은 뒤 밴드를 붙이세요." style="width:100%;box-sizing:border-box;font-size:12.5px;line-height:1.6;padding:9px 11px;border:1.5px solid rgba(245,158,11,0.45);border-radius:8px;background:var(--bg2);color:var(--t1);outline:none;resize:vertical;font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif">'+escHtml(cur)+'</textarea>'
    +'<div style="margin-top:8px">'
    +'<span style="font-size:9.5px;color:var(--t3)">바깥을 클릭하면 저장됩니다. 내용을 비우면 안내문구가 꺼집니다.</span>'
    +'</div>';
  var host=anchor.closest('.modal-overlay')||document.body;
  host.appendChild(pop);
  if(rect.bottom+6+pop.offsetHeight>window.innerHeight) pop.style.top=Math.max(6,Math.round(rect.top-pop.offsetHeight-6))+'px';
  requestAnimationFrame(function(){ pop.style.opacity='1'; pop.style.transform='scale(1)'; });   /* 켜짐 애니메이션 */
  var inp=pop.querySelector('#_fdGuideMsgInp');
  inp.focus();
  /* 꺼짐 애니메이션 후 제거 — 외부클릭·Esc 공통 (사용자 요청 2026-06-16) */
  var _closePop=function(cb){ pop.style.opacity='0'; pop.style.transform='scale(.95)'; setTimeout(function(){ try{pop.remove();}catch(_){} if(cb)cb(); },170); };
  var _save2=function(){
    var v=String(inp.value||'').trim();
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(sc&&sc.options&&sc.options[optIdx]){
      if(!v){ delete sc.options[optIdx].guideMsg; delete sc.options[optIdx].guideEmoji; }
      else { sc.options[optIdx].guideMsg=v; if(!sc.options[optIdx].guideEmoji)sc.options[optIdx].guideEmoji=sc.options[optIdx].emoji||'📋'; }
      ks.flowDesigner=fl; _save();
    }
    _closePop(function(){ if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk'); });
  };
  inp.addEventListener('keydown',function(ev){ ev.stopPropagation(); if(ev.key==='Escape'){ ev.preventDefault(); document.removeEventListener('mousedown',_outside,true); _closePop(function(){ if(!_cbRefreshFlowPopup())renderSettingsPanel('kiosk'); }); } });
  var _outside=function(ev){ if(pop.contains(ev.target))return; document.removeEventListener('mousedown',_outside,true); _save2(); };
  setTimeout(function(){ document.addEventListener('mousedown',_outside,true); },0);
}

/* [바디맵 터치 모드] — 사용 안 함 + 4모드. 각 항목 호버 시 공용 미니팝업 설명 (사용자 설계 2026-06-13) */
function _fdOpenBmModeDropdown(anchor, secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var opt=(sec&&sec.options&&sec.options[optIdx])||{};
  var cur=opt.hasBodymapInsert?(opt.bodymapMode||'check_nrs'):'';
  var items=[{value:'',label:'사용 안 함',tip:'이 항목에서는 바디맵(부위 선택)을 사용하지 않습니다.'}].concat(FD_BM_MODES);
  _fdOpenFnDropdown(anchor, items, cur, function(v){
    var fl=_fdGetFlow(); var sc=_fdFindSection(fl, secId);
    if(!(sc&&sc.options&&sc.options[optIdx]))return;
    var o=sc.options[optIdx];
    if(!v){ delete o.hasBodymapInsert; delete o.bodymapMode; }
    else { o.hasBodymapInsert=true; o.bodymapMode=v; }
    ks.flowDesigner=fl; _save();
    if(!_cbRefreshFlowPopup()) renderSettingsPanel('kiosk');
  });
}

/* [상담 주제] — 증상 선택 및 처치의 상담 분류(counsel) 중분류 (2026-06-13).
 *  getEffectiveSymCatsWithSyms = 기본 + 사용자 추가 + 숨김 제외 + 저장 순서 완전 병합 (키오스크 임베드와 동일 출처).
 *  → 증상 화면에서 상담 중분류를 추가/삭제/정렬하면 이 드롭다운에 그대로 반영 (사용자 확인 2026-06-13). */
function _fdOpenTopicDropdown(anchor, secId, optIdx){
  var flow=_fdGetFlow(); var sec=_fdFindSection(flow, secId);
  var cur=(sec&&sec.options&&sec.options[optIdx]&&sec.options[optIdx].counselTopic)||'';
  var topics=[];
  try{
    var cats=getEffectiveSymCatsWithSyms();
    var counsel=cats.find(function(c){ return c.id==='counsel'; });
    topics=(counsel&&counsel.symptoms)||[];
    /* 현재 지정값이 숨김·삭제된 주제여도 선택 유지되도록 목록에 포함 (옛 흐름 호환) */
    if(cur && topics.indexOf(cur)===-1) topics=[cur].concat(topics);
  }catch(_){}
  if(!topics.length){ bus.emit('toast:show',{text:'증상 선택 및 처치의 상담 분류에 중분류를 먼저 추가해주세요.'}); return; }
  var items=topics.map(function(n){ return {label:n, value:n, tip:''}; });
  _fdOpenFnDropdown(anchor, items, cur, function(v){
    _fdSetOptField(secId, optIdx, 'counselTopic', v);
  });
}

/* HTML 빌더 함수는 kiosk-html-builder.js로 이동됨 */


/* ══════════════════════════════════════════
   이벤트 위임 — innerHTML 세팅 후 호출
   ══════════════════════════════════════════ */
export function _fdAttachEvents(root){
  if(!root || root._fdEventsAttached) return;
  root._fdEventsAttached = true;

  /* click delegation */
  root.addEventListener('click', function(e){
    var t = e.target.closest('[data-action]');
    if(!t) return;
    var act = t.getAttribute('data-action');
    var secId = t.getAttribute('data-sec-id');
    var optIdx = t.getAttribute('data-opt-idx');
    if(optIdx !== null) optIdx = parseInt(optIdx, 10);

    switch(act){
      case 'undo': _fdUndo(); break;
      case 'redo': _fdRedo(); break;
      case 'show-validation': _fdShowValidationPopup(); break;
      case 'reset-default': _fdResetToDefault(); break;
      case 'add-option': _fdAddOption(secId); break;
      case 'pick-opt-emoji':
        e.stopPropagation();
        _fdPickOptionEmoji(secId, optIdx);
        break;
      case 'open-tag-dd':
        e.stopPropagation();
        _fdOpenTagDropdown(t, secId, optIdx);
        break;
      case 'open-diary-dd':
        e.stopPropagation();
        _fdOpenDiaryDropdown(t, secId, optIdx);
        break;
      case 'open-return-dd':
        e.stopPropagation();
        _fdOpenReturnDropdown(t, secId, optIdx);
        break;
      case 'open-item-dd':
        e.stopPropagation();
        _fdOpenItemDropdown(t, secId, optIdx);
        break;
      case 'open-topic-dd':
        e.stopPropagation();
        _fdOpenTopicDropdown(t, secId, optIdx);
        break;
      case 'open-wait-dd':
        e.stopPropagation();
        _fdOpenWaitDropdown(t, secId, optIdx);
        break;
      case 'open-guidemsg':
        e.stopPropagation();
        _fdOpenGuideMsgPopup(t, secId, optIdx);
        break;
      case 'open-bmmode-dd':
        e.stopPropagation();
        _fdOpenBmModeDropdown(t, secId, optIdx);
        break;
      case 'remove-option':
        e.stopPropagation();
        _fdRemoveOption(secId, optIdx);
        break;
      case 'move-opt-up':
        e.stopPropagation();
        _fdMoveOption(secId, optIdx, -1);
        break;
      case 'move-opt-down':
        e.stopPropagation();
        _fdMoveOption(secId, optIdx, 1);
        break;
    }
  });

  /* change delegation */
  root.addEventListener('change', function(e){
    var t = e.target;
    var act = t.getAttribute('data-action');
    if(act === 'set-opt-label') _fdSetOptionLabel(t.getAttribute('data-sec-id'), parseInt(t.getAttribute('data-opt-idx'),10), t.value);
    else if(act === 'set-opt-tag'){
      var flow=_fdGetFlow();var sec=_fdFindSection(flow,t.getAttribute('data-sec-id'));var oi2=parseInt(t.getAttribute('data-opt-idx'),10);
      if(sec&&sec.options&&sec.options[oi2]){sec.options[oi2].tag=t.value;ks.flowDesigner=flow;_fdAutoSave();}
    }
    else if(act === 'toggle-bodymap') _fdToggleInsertFlag(t.getAttribute('data-sec-id'), parseInt(t.getAttribute('data-opt-idx'),10), 'hasBodymapInsert');
    else if(act === 'toggle-reception') _fdSetReceptionFlag(t.getAttribute('data-sec-id'), parseInt(t.getAttribute('data-opt-idx'),10), t.checked);
    else if(act === 'toggle-symtreat'){
      var _stSid=t.getAttribute('data-sec-id'), _stOi=parseInt(t.getAttribute('data-opt-idx'),10);
      if(t.checked){
        /* 켜는 중 — 바로 체크하지 않고 증상·처치 선택 모달을 띄운다. 확인해야 체크 + 저장 (사용자 요청 2026-06-11) */
        t.checked=false;
        _fdOpenSymTreatPicker(_stSid, _stOi);
      } else {
        _fdClearSymTreat(_stSid, _stOi);
      }
    }
    else if(act === 'toggle-personal-type') _fdTogglePersonalType(t.getAttribute('data-ptype'), t.checked);
  });

  /* input delegation — 라벨 편집 시 오른쪽 요약 패널 실시간 반영 */
  root.addEventListener('input', function(e){
    var t = e.target;
    var act = t.getAttribute('data-action');
    if(act === 'set-opt-label'){
      /* flow 데이터 실시간 업데이트 + 디바운스 저장 */
      var flow = _fdGetFlow();
      var sec = _fdFindSection(flow, t.getAttribute('data-sec-id'));
      var optIdx = parseInt(t.getAttribute('data-opt-idx'),10);
      if(sec && sec.options && sec.options[optIdx]){
        sec.options[optIdx].label = t.value;
        ks.flowDesigner = flow;
        _fdAutoSave();
        /* 오른쪽 패널만 갱신 (왼쪽은 리렌더하지 않아 포커스 유지) */
        _cbRefreshPreviewFn && _cbRefreshPreviewFn();
      }
    }
  });

  /* hover effects */
  root.addEventListener('mouseover', function(e){
    var addBtn = e.target.closest('.fd-add-btn');
    if(addBtn){ addBtn.style.borderColor='var(--cyan)'; addBtn.style.color='var(--cyan)'; }
  });
  root.addEventListener('mouseout', function(e){
    var addBtn = e.target.closest('.fd-add-btn');
    if(addBtn){ addBtn.style.borderColor=''; addBtn.style.color='var(--t3)'; }
  });
}

/* ── _fdSelectedOpts getter/clear (kiosk-cms-view.js에서 사용) ── */
export function getFdSelectedOpts(){ return _fdSelectedOpts; }
export function clearFdSelectedOpts(){ _fdSelectedOpts = {}; }

/* 기본 템플릿 캐시 접근 — 수칙 기본값 등 외부 참조용 */
export function getDefaultFlowTemplate(){ return _defaultFlowCache; }
export function getBasicFlowTemplate(){ return _basicFlowCache; }
/* JSON 기본 템플릿(기본형·확장형) 로드 보장 — 편집기를 안 열고 메인 [🔎 미리보기]만 눌러도 갤러리에 쓸 수 있게 (사용자 결정 2026-06-15) */
export function fdEnsureDefaultTemplates(){ return _fdLoadDefaultTemplate(); }

export { _fdOpenKioskPreview, _fdReloadKioskPreview };

