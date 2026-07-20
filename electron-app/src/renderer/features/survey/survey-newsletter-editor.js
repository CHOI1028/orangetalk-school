/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { S } from '../../core/app-state.js';
import { escHtml, closeModalGracefully } from '../../core/helpers.js';
import { _makeDraggable } from '../symptom/symptom-view.js';
import { getNlMerge, _nlStore } from '../newsletter/newsletter-misc-view.js';

/* ═══════════════════════════════════════════════
   가정통신문 PDF 캔버스 에디터
   ═══════════════════════════════════════════════ */

/* ── Event delegation helper ── */
function _nlDelegateEvents(container){
  if(!container)return;

  /* click delegation */
  container.addEventListener('click',function(e){
    const btn=e.target.closest('[data-nl-click]');
    if(!btn)return;
    const action=btn.getAttribute('data-nl-click');
    const arg=btn.getAttribute('data-nl-arg');
    const arg2=btn.getAttribute('data-nl-arg2');
    switch(action){
      case 'nlUndo': nlUndo(); break;
      case 'nlResetEditor': window.nlResetEditor(); break;
      case 'nlRemovePdf': window.nlRemovePdf(); break;
      case 'nlStretchBg': window.nlStretchBg(); break;
      case 'nlSetPaper': window.nlSetPaper(arg,btn); break;
      case 'nlSetOrientation': window.nlSetOrientation(arg,btn); break;
      case 'nlAddObj': window.nlAddObj(arg); break;
      case 'nlAddTable': window.nlAddTable(); break;
      case 'nlAddImage': window.nlAddImage(); break;
      case 'nlRemoveImageBg': window.nlRemoveImageBg(); break;
      case 'nlTblAddRow': window.nlTblAddRow(arg); break;
      case 'nlTblAddCol': window.nlTblAddCol(arg); break;
      case 'nlTblDelRow': window.nlTblDelRow(); break;
      case 'nlTblDelCol': window.nlTblDelCol(); break;
      case 'nlMergeCells': window.nlMergeCells(); break;
      case 'nlUnmergeCells': window.nlUnmergeCells(); break;
      case 'nlToggleCellBgPalette': window.nlToggleCellBgPalette(btn); break;
      case 'nlCellBgApplyColor': e.stopPropagation(); window.nlCellBgApplyColor(arg); break;
      case 'nlCopyObj': window.nlCopyObj(); break;
      case 'nlDeleteObj': window.nlDeleteObj(); break;
      case 'nlZOrder': window.nlZOrder(parseInt(arg)); break;
      case 'nlZOrderMax': window.nlZOrderMax(); break;
      case 'nlZOrderMin': window.nlZOrderMin(); break;
      case 'nlAlign': window.nlAlign(arg); break;
      case 'nlSetZoom': window.nlSetZoom(parseInt(arg)); break;
      case 'nlShowExportPopup': window.nlShowExportPopup(arg); break;
      case 'nlPrint': window.nlPrint(); break;
      case 'nlMergeNav': window.nlMergeNav(parseInt(arg)); break;
      case 'nlMergeTogglePreview': window.nlMergeTogglePreview(); break;
      case 'nlMergeExportAll': window.nlMergeExportAll(); break;
      case 'nlSetBgTransparent': window.nlSetStyle('bgColor','transparent'); break;
      case 'nlCanvasAreaClick': window.nlCanvasAreaClick(e); break;
      case 'nlSwitchSub': nlSwitchSub(arg); break;
      case 'nlLoadSaved': nlLoadSaved(parseInt(arg)); break;
      case 'nlRenameSaved': nlRenameSaved(parseInt(arg)); break;
      case 'nlDuplicateSaved': nlDuplicateSaved(parseInt(arg)); break;
      case 'nlDeleteSaved': nlDeleteSaved(parseInt(arg)); break;
      case 'nlResetForNew': nlSwitchSub('editor'); _nlEditingId=null; nlResetForNew(); break;
      case 'nlSaveAs': nlSaveAs(); break;
      case 'nlSaveCurrent': nlSaveCurrent(); break;
      case 'nlTriggerFileInput': const fi=document.getElementById(arg); if(fi)fi.click(); break;
      case 'stopPropagation': e.stopPropagation(); break;
    }
  });

  /* mousedown delegation (prevent default + action) */
  container.addEventListener('mousedown',function(e){
    const btn=e.target.closest('[data-nl-mousedown]');
    if(!btn)return;
    e.preventDefault();
    const action=btn.getAttribute('data-nl-mousedown');
    const arg=btn.getAttribute('data-nl-arg');
    const arg2=btn.getAttribute('data-nl-arg2');
    switch(action){
      case 'nlToggleStyle': window.nlToggleStyle(arg,arg2,btn.getAttribute('data-nl-arg3')); break;
      case 'nlSetStyle': window.nlSetStyle(arg,arg2); break;
    }
  });

  /* input delegation */
  container.addEventListener('input',function(e){
    const el=e.target.closest('[data-nl-input]');
    if(!el)return;
    const action=el.getAttribute('data-nl-input');
    const parse=el.getAttribute('data-nl-parse');
    const val=parse==='int'?parseInt(el.value):el.value;
    const arg=el.getAttribute('data-nl-arg');
    switch(action){
      case 'nlSetBgScale': window.nlSetBgScale(val); break;
      case 'nlSetBgOffsetY': window.nlSetBgOffsetY(val); break;
      case 'nlSetBgOffsetX': window.nlSetBgOffsetX(val); break;
      case 'nlSetZoom': window.nlSetZoom(val); break;
      case 'nlSetStyle': window.nlSetStyle(arg,val); break;
    }
  });

  /* change delegation */
  container.addEventListener('change',function(e){
    const el=e.target.closest('[data-nl-change]');
    if(!el)return;
    const action=el.getAttribute('data-nl-change');
    const parse=el.getAttribute('data-nl-parse');
    const val=parse==='int'?parseInt(el.value):el.value;
    const arg=el.getAttribute('data-nl-arg');
    switch(action){
      case 'nlSetStyle': window.nlSetStyle(arg,val); break;
      case 'nlSetMarginSide': window.nlSetMarginSide(arg,parseInt(el.value)); break;
      case 'nlLoadBgFile': window.nlLoadBgFile(el); break;
      case 'nlLoadMergeFile': window.nlLoadMergeFile(el); break;
    }
  });

  /* wheel delegation */
  container.addEventListener('wheel',function(e){
    const el=e.target.closest('[data-nl-wheel]');
    if(!el)return;
    const action=el.getAttribute('data-nl-wheel');
    if(action==='nlZoomSliderWheel') window._nlZoomSliderWheel(e);
  },{passive:false});

  /* dragover / dragleave / drop delegation for upload zones */
  container.addEventListener('dragover',function(e){
    const zone=e.target.closest('[data-nl-dropzone]');
    if(!zone)return;
    e.preventDefault();zone.classList.add('dragover');
  });
  container.addEventListener('dragleave',function(e){
    const zone=e.target.closest('[data-nl-dropzone]');
    if(!zone)return;
    zone.classList.remove('dragover');
  });
  container.addEventListener('drop',function(e){
    const zone=e.target.closest('[data-nl-dropzone]');
    if(!zone)return;
    e.preventDefault();zone.classList.remove('dragover');
    const action=zone.getAttribute('data-nl-dropzone');
    if(action==='nlHandleBgDrop') window.nlHandleBgDrop(e);
  });

  /* mouseenter / mouseleave for hover-border cards */
  container.addEventListener('mouseenter',function(e){
    const el=e.target.closest('[data-nl-hover-border]');
    if(el)el.style.borderColor=el.getAttribute('data-nl-hover-border');
  },true);
  container.addEventListener('mouseleave',function(e){
    const el=e.target.closest('[data-nl-hover-restore]');
    if(el)el.style.borderColor=el.getAttribute('data-nl-hover-restore');
  },true);
}
const nlState={
  objects:[],selectedId:null,selectedIds:[],nextId:1,
  isDragging:false,isResizing:false,dragData:null,resizeData:null,
  pdfBgUrl:null,pdfFileName:null,zoom:100,
  paper:'a4',orientation:'portrait',canvasW:595,canvasH:842,
  marginTop:7,marginBottom:7,marginLeft:7,marginRight:7,
  bgScale:100,bgOffsetY:0,bgOffsetX:0,
  _tblFocusObj:null,_tblFocusCell:null,
  _tblSelStart:null,_tblSelEnd:null,_tblSelecting:false
};
let _nlUndoStack=[];
let _nlAutoSaveTimer=null;
const NL_STORAGE_KEY='ec_nl_editor';
const NL_INLINE_STORAGE_KEY='ec_nl_inline';
let _nlMode='popup'; /* 'popup' | 'inline' */

function _nlActiveKey(){return _nlMode==='inline'?NL_INLINE_STORAGE_KEY:NL_STORAGE_KEY;}

function nlSave(immediate){
  if(_nlAutoSaveTimer)clearTimeout(_nlAutoSaveTimer);
  const fn=function(){
    if(_nlStore){
      _nlStore.saveEditorState(_nlMode,nlState);
      return;
    }
    const data={objects:nlState.objects,nextId:nlState.nextId,pdfBgUrl:nlState.pdfBgUrl,pdfFileName:nlState.pdfFileName,canvasH:nlState.canvasH,canvasW:nlState.canvasW,paper:nlState.paper,orientation:nlState.orientation,marginTop:nlState.marginTop,marginBottom:nlState.marginBottom,marginLeft:nlState.marginLeft,marginRight:nlState.marginRight,bgScale:nlState.bgScale,bgOffsetY:nlState.bgOffsetY,bgOffsetX:nlState.bgOffsetX};
    localStorage.setItem(_nlActiveKey(),JSON.stringify(data));
    if(window.electronAPI&&window.electronAPI.editorStateSave)window.electronAPI.editorStateSave('newsletter-editor',_nlMode,data).catch(function(){});
  };
  if(immediate)fn();else _nlAutoSaveTimer=setTimeout(fn,400);
}
function nlPushUndo(){
  const snap={objects:nlState.objects,pdfBgUrl:nlState.pdfBgUrl,pdfFileName:nlState.pdfFileName,bgScale:nlState.bgScale,bgOffsetY:nlState.bgOffsetY,bgOffsetX:nlState.bgOffsetX};
  _nlUndoStack.push(JSON.stringify(snap));
  if(_nlUndoStack.length>40)_nlUndoStack.shift();
}
function nlUndo(){
  if(!_nlUndoStack.length)return;
  const snap=JSON.parse(_nlUndoStack.pop());
  if(snap.objects!==undefined) nlState.objects=snap.objects;
  else nlState.objects=snap; /* 단일 배열 형식 처리 */
  if(snap.pdfBgUrl!==undefined) nlState.pdfBgUrl=snap.pdfBgUrl;
  if(snap.pdfFileName!==undefined) nlState.pdfFileName=snap.pdfFileName;
  if(snap.bgScale!==undefined) nlState.bgScale=snap.bgScale;
  if(snap.bgOffsetY!==undefined) nlState.bgOffsetY=snap.bgOffsetY;
  if(snap.bgOffsetX!==undefined) nlState.bgOffsetX=snap.bgOffsetX;
  nlState.selectedId=null;
  nlRender();nlSave();
}

function svOpenNewsletterModal(customTitle){
  const ex=document.getElementById('nlOverlay');if(ex)closeModalGracefully(ex);
  /* 인라인 탭이 열려있으면 저장 후 임시 숨기기 (ID 충돌 방지) */
  if(_nlMode==='inline')nlSave(true);
  const inlWrap=document.getElementById('nlInlineWrap');
  if(inlWrap)inlWrap.innerHTML='';
  _nlInlineActive=false;
  _nlMode='popup';_nlUndoStack=[];
  const ov=document.createElement('div');ov.className='nl-overlay';ov.id='nlOverlay';
  const surveyTitle=customTitle||(svSurveyData?svSurveyData.title:'건강정보 조사');
  let h='<div class="nl-modal">';
  /* 헤더 */
  h+='<div class="nl-header"><span class="nl-header-title">📄 '+escHtml(surveyTitle)+' 가정통신문 만들기</span>'
    +'<div style="display:flex;align-items:center;gap:6px">'
    +'<button class="sv-btn sv-btn-sm" data-nl-click="nlUndo" title="실행 취소 (Ctrl+Z)">↩</button>'
    +'<button class="sv-btn sv-btn-sm" data-nl-click="nlResetEditor" title="초기화">↺ 초기화</button>'
    +'</div></div>';
  /* 바디: 좌(설정) + 우(스타일바+툴바+캔버스+상태바) — 방문증 에디터 레이아웃 */
  h+='<div class="nl-body">';
  /* ── 왼쪽 패널 ── */
  h+='<div class="nl-left">';
  /* 배경 업로드 (PDF + 이미지) */
  h+='<div class="nl-section"><div class="nl-section-title">배경 양식</div>'
    +'<div class="nl-upload-zone" id="nlUploadZone" data-nl-click="nlTriggerFileInput" data-nl-arg="nlBgInput" data-nl-dropzone="nlHandleBgDrop">📁 PDF / 이미지 업로드<br><span style="font-size:9px;color:var(--t3)">클릭 또는 드래그</span></div>'
    +'<input type="file" id="nlBgInput" accept=".pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp" style="display:none" data-nl-change="nlLoadBgFile">'
    +'<button class="nl-tool-btn" style="margin-top:4px" data-nl-click="nlRemovePdf"><span class="nl-tool-icon">🗑</span>배경 제거</button>'
    +'<button class="nl-tool-btn" style="margin-top:4px" data-nl-click="nlStretchBg"><span class="nl-tool-icon">📐</span>배경 세로로 늘리거나 줄이기</button></div>';
  /* 배경 확대 슬라이더 */
  h+='<div class="nl-section"><div class="nl-section-title">배경 크기 <span id="nlBgScaleVal" style="color:var(--cyan);font-weight:700">100%</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:var(--t3)">50%</span>'
    +'<input type="range" id="nlBgScaleSlider" min="50" max="200" value="100" style="flex:1;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetBgScale" data-nl-parse="int">'
    +'<span style="font-size:9px;color:var(--t3)">200%</span></div></div>';
  /* 배경 위치 (상하) 슬라이더 */
  h+='<div class="nl-section"><div class="nl-section-title">배경 위치 (상하) <span id="nlBgOffsetYVal" style="color:var(--cyan);font-weight:700">0px</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:var(--t3)">↑</span>'
    +'<input type="range" id="nlBgOffsetYSlider" min="-200" max="200" value="0" style="flex:1;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetBgOffsetY" data-nl-parse="int">'
    +'<span style="font-size:9px;color:var(--t3)">↓</span></div></div>';
  /* 배경 위치 (좌우) 슬라이더 */
  h+='<div class="nl-section"><div class="nl-section-title">배경 위치 (좌우) <span id="nlBgOffsetXVal" style="color:var(--cyan);font-weight:700">0px</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:var(--t3)">←</span>'
    +'<input type="range" id="nlBgOffsetXSlider" min="-200" max="200" value="0" style="flex:1;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetBgOffsetX" data-nl-parse="int">'
    +'<span style="font-size:9px;color:var(--t3)">→</span></div></div>';
  /* 용지 선택 */
  h+='<div class="nl-section"><div class="nl-section-title">용지</div>'
    +'<div style="display:flex;gap:4px">'
    +'<button class="nl-tool-btn nl-paper-btn" data-paper="a4" data-nl-click="nlSetPaper" data-nl-arg="a4" style="flex:1;justify-content:center">A4</button>'
    +'<button class="nl-tool-btn nl-paper-btn" data-paper="receipt" data-nl-click="nlSetPaper" data-nl-arg="receipt" style="flex:1;justify-content:center">3인치</button></div>'
    +'<div id="nlOrientRow" style="display:none;margin-top:4px"><div style="display:flex;gap:4px">'
    +'<button class="nl-tool-btn nl-orient-btn on" data-orient="portrait" data-nl-click="nlSetOrientation" data-nl-arg="portrait" style="flex:1;justify-content:center">세로</button>'
    +'<button class="nl-tool-btn nl-orient-btn" data-orient="landscape" data-nl-click="nlSetOrientation" data-nl-arg="landscape" style="flex:1;justify-content:center">가로</button>'
    +'</div></div></div>';
  /* 여백 설정: 상하좌우 개별 */
  h+='<div class="nl-section"><div class="nl-section-title">인쇄 여백 (mm)</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">위</span><input type="number" id="nlMarginTop" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginTop"></div>'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">아래</span><input type="number" id="nlMarginBottom" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginBottom"></div>'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">좌</span><input type="number" id="nlMarginLeft" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginLeft"></div>'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">우</span><input type="number" id="nlMarginRight" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginRight"></div>'
    +'</div></div>';
  /* 메일 머지 */
  h+='<div class="nl-section"><div class="nl-section-title">📬 메일 머지</div>'
    +'<div id="nlMergeArea">'
    +'<div class="nl-upload-zone" id="nlMergeZone" data-nl-click="nlTriggerFileInput" data-nl-arg="nlMergeInput" style="border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.03)">'
    +'📊 엑셀 / CSV 업로드<br><span style="font-size:9px;color:var(--t3)">1행은 헤더 (이름, 키, 몸무게 등)</span></div>'
    +'<input type="file" id="nlMergeInput" accept=".xlsx,.xls,.csv" style="display:none" data-nl-change="nlLoadMergeFile">'
    +'<div id="nlMergeInfo"></div>'
    +'</div></div>';
  h+='</div>'; /* nl-left end */
  /* ── 오른쪽 패널: 방문증과 동일한 레이아웃 ── */
  h+='<div class="nl-right">';
  /* 스타일바 */
  h+='<div class="nl-stylebar" id="nlStylebar">'
    /* 텍스트 전용 영역 */
    +'<span id="nlTextGroup">'
    +'<select id="nlFontFamily" class="sv-rich-size" style="max-width:100px;font-size:9px" data-nl-change="nlSetStyle" data-nl-arg="fontFamily">'
    +'<optgroup label="── 한글 ──"><option value="\'Noto Sans KR\',sans-serif">Noto Sans KR</option><option value="\'맑은 고딕\',sans-serif">맑은 고딕</option><option value="굴림,sans-serif">굴림</option><option value="돋움,sans-serif">돋움</option><option value="바탕,serif">바탕</option><option value="궁서,serif">궁서</option>'
    +'<option value="\'NanumGothic\',sans-serif">나눔고딕</option><option value="\'NanumMyeongjo\',serif">나눔명조</option><option value="\'NanumBarunGothic\',sans-serif">나눔바른고딕</option><option value="\'NanumSquareRound\',sans-serif">나눔스퀘어라운드</option><option value="\'Jua\',sans-serif">주아</option></optgroup>'
    +'<optgroup label="── Mac ──"><option value="\'Apple SD Gothic Neo\',sans-serif">Apple SD 고딕</option><option value="\'SF Pro Display\',sans-serif">SF Pro</option></optgroup>'
    +'<optgroup label="── Windows ──"><option value="\'Segoe UI\',sans-serif">Segoe UI</option><option value="Calibri,sans-serif">Calibri</option><option value="Verdana,sans-serif">Verdana</option></optgroup>'
    +'<optgroup label="── 공통 ──"><option value="Arial,sans-serif">Arial</option><option value="Georgia,serif">Georgia</option><option value="\'Times New Roman\',serif">Times</option><option value="\'Courier New\',monospace">Courier</option></optgroup></select>'
    +'<div class="nl-style-sep"></div>'
    +'<button class="nl-style-btn" id="nlBoldBtn" data-nl-mousedown="nlToggleStyle" data-nl-arg="fontWeight" data-nl-arg2="bold" data-nl-arg3="normal" title="굵게"><b>B</b></button>'
    +'<button class="nl-style-btn" id="nlItalicBtn" data-nl-mousedown="nlToggleStyle" data-nl-arg="fontStyle" data-nl-arg2="italic" data-nl-arg3="normal" title="기울임"><i>I</i></button>'
    +'<button class="nl-style-btn" id="nlUnderBtn" data-nl-mousedown="nlToggleStyle" data-nl-arg="textDecoration" data-nl-arg2="underline" data-nl-arg3="none" title="밑줄"><u>U</u></button>'
    +'<div class="nl-style-sep"></div>'
    +'<button class="nl-style-btn" data-nl-mousedown="nlSetStyle" data-nl-arg="textAlign" data-nl-arg2="left" title="왼쪽">≡←</button>'
    +'<button class="nl-style-btn" data-nl-mousedown="nlSetStyle" data-nl-arg="textAlign" data-nl-arg2="center" title="가운데">≡↔</button>'
    +'<button class="nl-style-btn" data-nl-mousedown="nlSetStyle" data-nl-arg="textAlign" data-nl-arg2="right" title="오른쪽">→≡</button>'
    +'<div class="nl-style-sep"></div>'
    +'<label style="font-size:10px;color:var(--t3);font-weight:600">글자</label>'
    +'<input type="color" id="nlColorPick" value="#000000" style="width:22px;height:22px;border:none;padding:0;cursor:pointer" data-nl-input="nlSetStyle" data-nl-arg="color">'
    +'</span>'
    /* 배경색 (선 제외) */
    +'<span id="nlBgGroup">'
    +'<label style="font-size:10px;color:var(--t3);font-weight:600">배경</label>'
    +'<input type="color" id="nlBgColorPick" value="#ffffff" style="width:22px;height:22px;border:none;padding:0;cursor:pointer" data-nl-input="nlSetStyle" data-nl-arg="bgColor">'
    +'<button class="nl-style-btn" data-nl-click="nlSetBgTransparent" title="배경 투명" style="font-size:9px">✕</button>'
    +'</span>'
    +'<div class="nl-style-sep"></div>'
    /* 테두리/선 색 */
    +'<label id="nlBorderLabel" style="font-size:10px;color:var(--t3);font-weight:600">테두리</label>'
    +'<input type="color" id="nlBorderColorPick" value="#000000" style="width:22px;height:22px;border:none;padding:0;cursor:pointer" data-nl-input="nlSetStyle" data-nl-arg="borderColor">'
    +'<select id="nlBorderWidth" style="width:48px;font-size:9px" data-nl-change="nlSetStyle" data-nl-arg="borderWidth" data-nl-parse="int"><option value="0">없음</option><option value="1" selected>1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option><option value="5">5px</option></select>'
    /* 선 스타일 (점선 등) */
    +'<select id="nlBorderStyle" style="width:56px;font-size:9px" data-nl-change="nlSetStyle" data-nl-arg="borderStyle"><option value="solid">실선</option><option value="dashed">파선</option><option value="dotted">점선</option><option value="double">이중선</option></select>'
    +'</div>';
  /* 툴바 — 방문증과 동일한 배치 */
  h+='<div class="vp-editor-toolbar" id="nlToolbar" style="border-bottom:1px solid var(--bdr);flex-shrink:0">'
    +'<button data-nl-click="nlAddObj" data-nl-arg="textbox" title="텍스트"><b style="font-size:14px">T</b> 텍스트</button>'
    +'<button data-nl-click="nlAddTable" title="표">📊 표</button>'
    +'<button data-nl-click="nlAddObj" data-nl-arg="line" title="선">─ 선</button>'
    +'<button data-nl-click="nlAddObj" data-nl-arg="rect" title="사각형">▢ 사각형</button>'
    +'<button data-nl-click="nlAddObj" data-nl-arg="circle" title="원">○ 원</button>'
    +'<button data-nl-click="nlAddImage" title="그림">🖼 그림</button>'
    +'<button data-nl-click="nlRemoveImageBg" title="선택한 이미지의 배경을 투명하게">🪄 배경제거</button>'
    +'<div class="vpe-sep"></div>'
    +'<button data-nl-click="nlTblAddRow" data-nl-arg="below" title="아래에 행 추가">⬇ 행 추가</button>'
    +'<button data-nl-click="nlTblAddRow" data-nl-arg="above" title="위에 행 추가">⬆ 행 추가</button>'
    +'<button data-nl-click="nlTblAddCol" data-nl-arg="right" title="오른쪽에 열 추가">➡ 열 추가</button>'
    +'<button data-nl-click="nlTblAddCol" data-nl-arg="left" title="왼쪽에 열 추가">⬅ 열 추가</button>'
    +'<button data-nl-click="nlTblDelRow" title="행 삭제">행 삭제</button>'
    +'<button data-nl-click="nlTblDelCol" title="열 삭제">열 삭제</button>'
    +'<div class="vpe-sep"></div>'
    +'<button data-nl-click="nlMergeCells" title="셀 병합 (드래그로 선택 후)"><svg width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:2px"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="1" x2="8" y2="16" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/><line x1="1" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/><path d="M4.5 6L8 8.5L11.5 6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4.5 10L8 7.5L11.5 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> 셀 병합</button>'
    +'<button data-nl-click="nlUnmergeCells" title="병합 해제"><svg width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:2px"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="1" x2="8" y2="16" stroke="currentColor" stroke-width="1"/><line x1="1" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1"/></svg> 병합 해제</button>'
    +'<div class="vpe-sep"></div>'
    +'<div class="vpe-color-btn" id="nlCellBgBtn" data-nl-click="nlToggleCellBgPalette" title="셀 음영" style="width:auto;padding:0 6px;gap:4px;height:26px">'
    +'<svg width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle"><rect x="1" y="9" width="14" height="6" rx="1" fill="currentColor" opacity="0.3"/><path d="M8 1L3 8h10L8 1z" fill="currentColor" opacity="0.6"/></svg>'
    +'<span style="font-size:10px;font-weight:600">음영</span>'
    +'<div class="vpe-color-preview" id="nlCellBgPreview" style="background:#ffffff;width:14px;height:14px"></div>'
    +'<div class="vpe-color-dropdown" id="nlCellBgDrop">'
    +'<div class="vpe-color-grid" id="nlCellBgGrid"></div>'
    +'<div style="margin-top:6px;display:flex;gap:4px;align-items:center">'
    +'<label style="font-size:10px;color:var(--t3);font-weight:600;white-space:nowrap">농도</label>'
    +'<select id="nlCellBgOpacity" style="font-size:10px;padding:2px 4px;border:1px solid var(--bdr);border-radius:4px;background:var(--card);color:var(--t2);cursor:pointer" data-nl-click="stopPropagation">'
    +'<option value="100">100%</option><option value="80">80%</option><option value="60">60%</option><option value="40">40%</option><option value="20" selected>20%</option><option value="10">10%</option><option value="5">5%</option>'
    +'</select>'
    +'<button data-nl-click="nlCellBgApplyColor" data-nl-arg="transparent" style="flex:1;font-size:10px;padding:4px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer">음영 제거</button>'
    +'</div></div></div>'
    +'<div class="vpe-sep"></div>'
    +'<button data-nl-click="nlCopyObj" title="복사">📋 복사</button>'
    +'<button data-nl-click="nlDeleteObj" title="삭제">🗑 삭제</button>'
    +'<div class="vpe-dropdown-wrap" style="position:relative;display:inline-block">'
    +'<button>📐 객체 위치</button>'
    +'<div class="vpe-action-dropdown">'
    +'<button data-nl-click="nlZOrder" data-nl-arg="1">⬆ 앞으로</button>'
    +'<button data-nl-click="nlZOrder" data-nl-arg="-1">⬇ 뒤로</button>'
    +'<button data-nl-click="nlZOrderMax">⏫ 맨 앞으로</button>'
    +'<button data-nl-click="nlZOrderMin">⏬ 맨 뒤로</button>'
    +'</div></div>'
    +'<div class="vpe-dropdown-wrap" style="position:relative;display:inline-block">'
    +'<button>📏 페이지 맞춤</button>'
    +'<div class="vpe-action-dropdown">'
    +'<button data-nl-click="nlAlign" data-nl-arg="top">⬆ 맨 위</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="left">⬅ 왼쪽</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="centerH">↔ 가로 가운데</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="centerV">↕ 세로 가운데</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="right">➡ 오른쪽</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="bottom">⬇ 맨 아래</button>'
    +'</div></div>'
    +'<button data-nl-click="nlResetEditor" title="초기화">↺ 초기화</button>'
    +'</div>';
  /* 캔버스 영역 */
  h+='<div class="nl-canvas-area" id="nlCanvasArea" data-nl-click="nlCanvasAreaClick">'
    +'<div class="nl-canvas" id="nlCanvas"></div></div>';
  /* 머지 미리보기 바 (하단) */
  h+='<div id="nlMergePreviewBar" style="display:'+(getNlMerge().data.length?'flex':'none')+';padding:6px 12px;background:linear-gradient(135deg,rgba(245,158,11,0.08),rgba(251,191,36,0.08));border-top:1px solid rgba(245,158,11,0.2);align-items:center;gap:8px;font-size:11px">'
    +'<span style="font-weight:700;color:#f59e0b">📬 머지</span>'
    +'<button data-nl-click="nlMergeNav" data-nl-arg="-1" style="padding:2px 8px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);cursor:pointer;font-size:11px;font-weight:700">◀</button>'
    +'<span id="nlMergeNavLabel" style="font-weight:600;color:var(--t1);min-width:120px;text-align:center"></span>'
    +'<button data-nl-click="nlMergeNav" data-nl-arg="1" style="padding:2px 8px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);cursor:pointer;font-size:11px;font-weight:700">▶</button>'
    +'<div style="flex:1"></div>'
    +'<button data-nl-click="nlMergeTogglePreview" id="nlMergeToggleBtn" style="padding:3px 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:var(--bg2);color:var(--t2);border:1px solid var(--bdr)">'+(getNlMerge().preview?'템플릿 보기':'미리보기')+'</button>'
    +'</div>';
  /* 상태바 — 저장 버튼 (대시보드 스타일) */
  h+='<div class="nl-zoom-bar">'
    +'<span id="nlObjInfo" style="color:var(--t3)">객체 0개</span>'
    +'<span style="display:flex;align-items:center;gap:4px;margin-left:auto">'
    +'<input type="range" id="nlZoomSlider" min="25" max="200" value="100" style="width:80px;height:16px;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetZoom" data-nl-parse="int" data-nl-wheel="nlZoomSliderWheel">'
    +'<span id="nlZoomLabel" style="font-size:10px;font-weight:700;color:var(--t2);min-width:32px;text-align:center">100%</span>'
    +'<button data-nl-click="nlSetZoom" data-nl-arg="100" style="height:22px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t3);cursor:pointer;font-size:9px;font-weight:600;padding:0 6px">맞춤</button>'
    +'<div style="width:1px;height:16px;background:var(--bdr);margin:0 4px"></div>'
    +'<button data-nl-click="nlShowExportPopup" data-nl-arg="pdf" style="height:22px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>PDF</button>'
    +'<button data-nl-click="nlShowExportPopup" data-nl-arg="png" style="height:22px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>PNG</button>'
    +'<button data-nl-click="nlShowExportPopup" data-nl-arg="jpeg" style="height:22px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>JPEG</button>'
    +'<div style="width:1px;height:16px;background:var(--bdr);margin:0 4px"></div>'
    +'<button data-nl-click="nlPrint" style="height:22px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>인쇄</button>'
    +'</span></div>';
  h+='</div></div></div>'; /* nl-right, nl-body, nl-modal */
  ov.innerHTML=h;
  _nlDelegateEvents(ov);
  ov.addEventListener('mousedown',function(e){if(e.target===ov)nlClose();});
  document.body.appendChild(ov);
  /* 열기 애니메이션 */
  const _nlModal=ov.querySelector('.nl-modal');
  if(_nlModal){
    ov.style.opacity='0';_nlModal.style.opacity='0';_nlModal.style.transform='scale(0.95)';
    requestAnimationFrame(function(){
      ov.style.transition='opacity 0.25s ease';ov.style.opacity='1';
      _nlModal.style.transition='opacity 0.25s ease, transform 0.25s ease';_nlModal.style.opacity='1';_nlModal.style.transform='scale(1)';
    });
    _makeDraggable(_nlModal);
  }
  nlLoadState();
  /* 용지 버튼 활성화 + 여백/슬라이더 동기화 */
  document.querySelectorAll('.nl-paper-btn').forEach(function(b){b.classList.toggle('on',b.dataset.paper===nlState.paper);});
  const orientRow=document.getElementById('nlOrientRow');
  if(orientRow)orientRow.style.display=nlState.paper==='a4'?'':'none';
  document.querySelectorAll('.nl-orient-btn').forEach(function(b){b.classList.toggle('on',b.dataset.orient===(nlState.orientation||'portrait'));});
  const mt=document.getElementById('nlMarginTop');if(mt)mt.value=nlState.marginTop;
  const mb=document.getElementById('nlMarginBottom');if(mb)mb.value=nlState.marginBottom;
  const ml=document.getElementById('nlMarginLeft');if(ml)ml.value=nlState.marginLeft;
  const mr=document.getElementById('nlMarginRight');if(mr)mr.value=nlState.marginRight;
  const bs=document.getElementById('nlBgScaleSlider');if(bs)bs.value=nlState.bgScale;
  const bv=document.getElementById('nlBgScaleVal');if(bv)bv.textContent=nlState.bgScale+'%';
  const boy=document.getElementById('nlBgOffsetYSlider');if(boy)boy.value=nlState.bgOffsetY;
  const bov=document.getElementById('nlBgOffsetYVal');if(bov)bov.textContent=nlState.bgOffsetY+'px';
  const box2=document.getElementById('nlBgOffsetXSlider');if(box2)box2.value=nlState.bgOffsetX||0;
  const boxv2=document.getElementById('nlBgOffsetXVal');if(boxv2)boxv2.textContent=(nlState.bgOffsetX||0)+'px';
  nlRender();
  nlMergeUpdateUI();if(getNlMerge().data.length)nlMergeUpdateNav();
  document.addEventListener('keydown',_nlKeyHandler);
  /* Ctrl+휠 줌 */
  const area=document.getElementById('nlCanvasArea');
  if(area)area.addEventListener('wheel',_nlWheelZoom,{passive:false});
}

function nlClose(){
  nlSave(true);
  const area=document.getElementById('nlCanvasArea');
  if(area)area.removeEventListener('wheel',_nlWheelZoom);
  const ov=document.getElementById('nlOverlay');if(ov)closeModalGracefully(ov);
  document.removeEventListener('keydown',_nlKeyHandler);
  /* 인라인 탭이 활성 상태였으면 복원 */
  const inlWrap=document.getElementById('nlInlineWrap');
  const gsn=document.getElementById('magicSubNewsletter');
  if(inlWrap&&gsn&&gsn.classList.contains('active')){_nlInlineActive=false;_nlMode='inline';_nlUndoStack=[];nlRenderInlineTab();}
}

/* ── 매직 스테이션 인라인 가정통신문 마법사 ── */
let _nlInlineActive=false;
export function nlRenderInlineTab(){
  const wrap=document.getElementById('nlInlineWrap');if(!wrap)return;
  _nlMode='inline';_nlUndoStack=[];
  /* 이미 렌더링됨 — 상태만 동기화 */
  if(_nlInlineActive&&document.getElementById('nlCanvas')){nlLoadState();nlRender();_nlSyncControls();return;}
  _nlInlineActive=true;
  let h='';
  /* 헤더 */
  const _editLabel=_nlEditingId?(' — '+(_nlGetSavedList().find(function(it){return it.id===_nlEditingId;})||{}).name||''):'';
  h+='<div class="nl-header" style="border-radius:0"><span class="nl-header-title">📄 가정통신문 마법사'+escHtml(_editLabel)+'</span>'
    +'<div style="display:flex;align-items:center;gap:6px">'
    +'<button data-nl-click="nlShowExportPopup" data-nl-arg="png" title="PNG로 저장" style="height:26px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>PNG로 저장</button>'
    +'<button data-nl-click="nlShowExportPopup" data-nl-arg="pdf" title="PDF로 저장" style="height:26px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>PDF로 저장</button>'
    +'<button class="sv-btn sv-btn-sm" data-nl-click="nlUndo" title="실행 취소 (Ctrl+Z)">↩</button>'
    +'<button class="sv-btn sv-btn-sm" data-nl-click="nlResetEditor" title="초기화">↺ 초기화</button>'
    +'</div></div>';
  h+='<div class="nl-body" style="flex:1;min-height:0">';
  /* 왼쪽 패널 */
  h+='<div class="nl-left">';
  h+='<div class="nl-section"><div class="nl-section-title">배경 양식</div>'
    +'<div class="nl-upload-zone" id="nlUploadZone" data-nl-click="nlTriggerFileInput" data-nl-arg="nlBgInput" data-nl-dropzone="nlHandleBgDrop">📁 PDF / 이미지 업로드<br><span style="font-size:9px;color:var(--t3)">클릭 또는 드래그</span></div>'
    +'<input type="file" id="nlBgInput" accept=".pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp" style="display:none" data-nl-change="nlLoadBgFile">'
    +'<button class="nl-tool-btn" style="margin-top:4px" data-nl-click="nlRemovePdf"><span class="nl-tool-icon">🗑</span>배경 제거</button>'
    +'<button class="nl-tool-btn" style="margin-top:4px" data-nl-click="nlStretchBg"><span class="nl-tool-icon">📐</span>배경 세로로 늘리거나 줄이기</button></div>';
  h+='<div class="nl-section"><div class="nl-section-title">배경 크기 <span id="nlBgScaleVal" style="color:var(--cyan);font-weight:700">100%</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:var(--t3)">50%</span>'
    +'<input type="range" id="nlBgScaleSlider" min="50" max="200" value="100" style="flex:1;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetBgScale" data-nl-parse="int">'
    +'<span style="font-size:9px;color:var(--t3)">200%</span></div></div>';
  h+='<div class="nl-section"><div class="nl-section-title">배경 위치 (상하) <span id="nlBgOffsetYVal" style="color:var(--cyan);font-weight:700">0px</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:var(--t3)">↑</span>'
    +'<input type="range" id="nlBgOffsetYSlider" min="-200" max="200" value="0" style="flex:1;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetBgOffsetY" data-nl-parse="int">'
    +'<span style="font-size:9px;color:var(--t3)">↓</span></div></div>';
  h+='<div class="nl-section"><div class="nl-section-title">배경 위치 (좌우) <span id="nlBgOffsetXVal" style="color:var(--cyan);font-weight:700">0px</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:var(--t3)">←</span>'
    +'<input type="range" id="nlBgOffsetXSlider" min="-200" max="200" value="0" style="flex:1;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetBgOffsetX" data-nl-parse="int">'
    +'<span style="font-size:9px;color:var(--t3)">→</span></div></div>';
  h+='<div class="nl-section"><div class="nl-section-title">용지</div>'
    +'<div style="display:flex;gap:4px">'
    +'<button class="nl-tool-btn nl-paper-btn" data-paper="a4" data-nl-click="nlSetPaper" data-nl-arg="a4" style="flex:1;justify-content:center">A4</button>'
    +'<button class="nl-tool-btn nl-paper-btn" data-paper="receipt" data-nl-click="nlSetPaper" data-nl-arg="receipt" style="flex:1;justify-content:center">3인치</button></div>'
    +'<div id="nlOrientRow" style="display:none;margin-top:4px"><div style="display:flex;gap:4px">'
    +'<button class="nl-tool-btn nl-orient-btn on" data-orient="portrait" data-nl-click="nlSetOrientation" data-nl-arg="portrait" style="flex:1;justify-content:center">세로</button>'
    +'<button class="nl-tool-btn nl-orient-btn" data-orient="landscape" data-nl-click="nlSetOrientation" data-nl-arg="landscape" style="flex:1;justify-content:center">가로</button>'
    +'</div></div></div>';
  h+='<div class="nl-section"><div class="nl-section-title">인쇄 여백 (mm)</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">위</span><input type="number" id="nlMarginTop" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginTop"></div>'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">아래</span><input type="number" id="nlMarginBottom" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginBottom"></div>'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">좌</span><input type="number" id="nlMarginLeft" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginLeft"></div>'
    +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:9px;color:var(--t3);width:16px">우</span><input type="number" id="nlMarginRight" min="0" max="30" value="7" style="width:100%;height:22px;border:1px solid var(--bdr);border-radius:4px;padding:0 4px;font-size:10px;background:var(--card);color:var(--t1);font-family:var(--f)" data-nl-change="nlSetMarginSide" data-nl-arg="marginRight"></div>'
    +'</div></div>';
  /* 메일 머지 */
  h+='<div class="nl-section"><div class="nl-section-title">📬 메일 머지</div>'
    +'<div id="nlMergeArea">'
    +'<div class="nl-upload-zone" id="nlMergeZone" data-nl-click="nlTriggerFileInput" data-nl-arg="nlMergeInput" style="border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.03)">'
    +'📊 엑셀 / CSV 업로드<br><span style="font-size:9px;color:var(--t3)">1행은 헤더 (이름, 키, 몸무게 등)</span></div>'
    +'<input type="file" id="nlMergeInput" accept=".xlsx,.xls,.csv" style="display:none" data-nl-change="nlLoadMergeFile">'
    +'<div id="nlMergeInfo"></div>'
    +'</div></div>';
  /* A4 크기 조절 (줌) */
  h+='<div class="nl-section"><div class="nl-section-title">🔍 A4 크기 조절</div>'
    +'<div style="display:flex;align-items:center;gap:6px">'
    +'<input type="range" id="nlZoomSlider" min="25" max="200" value="100" style="flex:1;height:16px;accent-color:var(--cyan);cursor:pointer" data-nl-input="nlSetZoom" data-nl-parse="int" data-nl-wheel="nlZoomSliderWheel">'
    +'<span id="nlZoomLabel" style="font-size:10px;font-weight:700;color:var(--t2);min-width:32px;text-align:center">100%</span>'
    +'<button data-nl-click="nlSetZoom" data-nl-arg="100" style="height:22px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t3);cursor:pointer;font-size:9px;font-weight:600;padding:0 6px">맞춤</button>'
    +'</div></div>';
  h+='</div>'; /* nl-left */
  /* 오른쪽 패널 */
  h+='<div class="nl-right">';
  /* 머지 미리보기 바 */
  h+='<div id="nlMergePreviewBar" style="display:none;padding:6px 12px;background:linear-gradient(135deg,rgba(245,158,11,0.08),rgba(251,191,36,0.08));border-bottom:1px solid rgba(245,158,11,0.2);align-items:center;gap:8px;font-size:11px">'
    +'<span style="font-weight:700;color:#f59e0b">📬 머지 미리보기</span>'
    +'<button data-nl-click="nlMergeNav" data-nl-arg="-1" style="padding:2px 8px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);cursor:pointer;font-size:11px;font-weight:700">◀</button>'
    +'<span id="nlMergeNavLabel" style="font-weight:600;color:var(--t1);min-width:120px;text-align:center"></span>'
    +'<button data-nl-click="nlMergeNav" data-nl-arg="1" style="padding:2px 8px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t1);cursor:pointer;font-size:11px;font-weight:700">▶</button>'
    +'<div style="flex:1"></div>'
    +'<button data-nl-click="nlMergeTogglePreview" id="nlMergeToggleBtn" style="padding:3px 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:var(--bg2);color:var(--t2);border:1px solid var(--bdr)">템플릿 보기</button>'
    +'<button class="btn-pdf" data-nl-click="nlMergeExportAll">📄 전체 PDF 생성</button>'
    +'</div>';
  /* 스타일바 */
  h+='<div class="nl-stylebar" id="nlStylebar">'
    +'<span id="nlTextGroup">'
    +'<select id="nlFontFamily" class="sv-rich-size" style="max-width:100px;font-size:9px" data-nl-change="nlSetStyle" data-nl-arg="fontFamily">'
    +'<optgroup label="── 한글 ──"><option value="\'Noto Sans KR\',sans-serif">Noto Sans KR</option><option value="\'맑은 고딕\',sans-serif">맑은 고딕</option><option value="굴림,sans-serif">굴림</option><option value="돋움,sans-serif">돋움</option><option value="바탕,serif">바탕</option><option value="궁서,serif">궁서</option>'
    +'<option value="\'NanumGothic\',sans-serif">나눔고딕</option><option value="\'NanumMyeongjo\',serif">나눔명조</option><option value="\'NanumBarunGothic\',sans-serif">나눔바른고딕</option><option value="\'NanumSquareRound\',sans-serif">나눔스퀘어라운드</option><option value="\'Jua\',sans-serif">주아</option></optgroup>'
    +'<optgroup label="── Mac ──"><option value="\'Apple SD Gothic Neo\',sans-serif">Apple SD 고딕</option><option value="\'SF Pro Display\',sans-serif">SF Pro</option></optgroup>'
    +'<optgroup label="── Windows ──"><option value="\'Segoe UI\',sans-serif">Segoe UI</option><option value="Calibri,sans-serif">Calibri</option><option value="Verdana,sans-serif">Verdana</option></optgroup>'
    +'<optgroup label="── 공통 ──"><option value="Arial,sans-serif">Arial</option><option value="Georgia,serif">Georgia</option><option value="\'Times New Roman\',serif">Times</option><option value="\'Courier New\',monospace">Courier</option></optgroup></select>'
    +'<div class="nl-style-sep"></div>'
    +'<button class="nl-style-btn" id="nlBoldBtn" data-nl-mousedown="nlToggleStyle" data-nl-arg="fontWeight" data-nl-arg2="bold" data-nl-arg3="normal" title="굵게"><b>B</b></button>'
    +'<button class="nl-style-btn" id="nlItalicBtn" data-nl-mousedown="nlToggleStyle" data-nl-arg="fontStyle" data-nl-arg2="italic" data-nl-arg3="normal" title="기울임"><i>I</i></button>'
    +'<button class="nl-style-btn" id="nlUnderBtn" data-nl-mousedown="nlToggleStyle" data-nl-arg="textDecoration" data-nl-arg2="underline" data-nl-arg3="none" title="밑줄"><u>U</u></button>'
    +'<div class="nl-style-sep"></div>'
    +'<button class="nl-style-btn" data-nl-mousedown="nlSetStyle" data-nl-arg="textAlign" data-nl-arg2="left" title="왼쪽">≡←</button>'
    +'<button class="nl-style-btn" data-nl-mousedown="nlSetStyle" data-nl-arg="textAlign" data-nl-arg2="center" title="가운데">≡↔</button>'
    +'<button class="nl-style-btn" data-nl-mousedown="nlSetStyle" data-nl-arg="textAlign" data-nl-arg2="right" title="오른쪽">→≡</button>'
    +'<div class="nl-style-sep"></div>'
    +'<label style="font-size:10px;color:var(--t3);font-weight:600">글자</label>'
    +'<input type="color" id="nlColorPick" value="#000000" style="width:22px;height:22px;border:none;padding:0;cursor:pointer" data-nl-input="nlSetStyle" data-nl-arg="color">'
    +'</span>'
    +'<span id="nlBgGroup">'
    +'<label style="font-size:10px;color:var(--t3);font-weight:600">배경</label>'
    +'<input type="color" id="nlBgColorPick" value="#ffffff" style="width:22px;height:22px;border:none;padding:0;cursor:pointer" data-nl-input="nlSetStyle" data-nl-arg="bgColor">'
    +'<button class="nl-style-btn" data-nl-click="nlSetBgTransparent" title="배경 투명" style="font-size:9px">✕</button>'
    +'</span>'
    +'<div class="nl-style-sep"></div>'
    +'<label id="nlBorderLabel" style="font-size:10px;color:var(--t3);font-weight:600">테두리</label>'
    +'<input type="color" id="nlBorderColorPick" value="#000000" style="width:22px;height:22px;border:none;padding:0;cursor:pointer" data-nl-input="nlSetStyle" data-nl-arg="borderColor">'
    +'<select id="nlBorderWidth" style="width:48px;font-size:9px" data-nl-change="nlSetStyle" data-nl-arg="borderWidth" data-nl-parse="int"><option value="0">없음</option><option value="1" selected>1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option><option value="5">5px</option></select>'
    +'<select id="nlBorderStyle" style="width:56px;font-size:9px" data-nl-change="nlSetStyle" data-nl-arg="borderStyle"><option value="solid">실선</option><option value="dashed">파선</option><option value="dotted">점선</option><option value="double">이중선</option></select>'
    +'</div>';
  /* 툴바 */
  h+='<div class="vp-editor-toolbar" id="nlToolbar" style="border-bottom:1px solid var(--bdr);flex-shrink:0">'
    +'<button data-nl-click="nlAddObj" data-nl-arg="textbox" title="텍스트"><b style="font-size:14px">T</b> 텍스트</button>'
    +'<button data-nl-click="nlAddTable" title="표">📊 표</button>'
    +'<button data-nl-click="nlAddObj" data-nl-arg="line" title="선">─ 선</button>'
    +'<button data-nl-click="nlAddObj" data-nl-arg="rect" title="사각형">▢ 사각형</button>'
    +'<button data-nl-click="nlAddObj" data-nl-arg="circle" title="원">○ 원</button>'
    +'<button data-nl-click="nlAddImage" title="그림">🖼 그림</button>'
    +'<button data-nl-click="nlRemoveImageBg" title="선택한 이미지의 배경을 투명하게">🪄 배경제거</button>'
    +'<div class="vpe-sep"></div>'
    +'<button data-nl-click="nlTblAddRow" data-nl-arg="below" title="아래에 행 추가">⬇ 행 추가</button>'
    +'<button data-nl-click="nlTblAddRow" data-nl-arg="above" title="위에 행 추가">⬆ 행 추가</button>'
    +'<button data-nl-click="nlTblAddCol" data-nl-arg="right" title="오른쪽에 열 추가">➡ 열 추가</button>'
    +'<button data-nl-click="nlTblAddCol" data-nl-arg="left" title="왼쪽에 열 추가">⬅ 열 추가</button>'
    +'<button data-nl-click="nlTblDelRow" title="행 삭제">행 삭제</button>'
    +'<button data-nl-click="nlTblDelCol" title="열 삭제">열 삭제</button>'
    +'<div class="vpe-sep"></div>'
    +'<button data-nl-click="nlMergeCells" title="셀 병합 (드래그로 선택 후)"><svg width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:2px"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="1" x2="8" y2="16" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/><line x1="1" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/><path d="M4.5 6L8 8.5L11.5 6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4.5 10L8 7.5L11.5 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> 셀 병합</button>'
    +'<button data-nl-click="nlUnmergeCells" title="병합 해제"><svg width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:2px"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="1" x2="8" y2="16" stroke="currentColor" stroke-width="1"/><line x1="1" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1"/></svg> 병합 해제</button>'
    +'<div class="vpe-sep"></div>'
    +'<div class="vpe-color-btn" id="nlCellBgBtn" data-nl-click="nlToggleCellBgPalette" title="셀 음영" style="width:auto;padding:0 6px;gap:4px;height:26px">'
    +'<svg width="14" height="14" viewBox="0 0 16 16" style="vertical-align:middle"><rect x="1" y="9" width="14" height="6" rx="1" fill="currentColor" opacity="0.3"/><path d="M8 1L3 8h10L8 1z" fill="currentColor" opacity="0.6"/></svg>'
    +'<span style="font-size:10px;font-weight:600">음영</span>'
    +'<div class="vpe-color-preview" id="nlCellBgPreview" style="background:#ffffff;width:14px;height:14px"></div>'
    +'<div class="vpe-color-dropdown" id="nlCellBgDrop">'
    +'<div class="vpe-color-grid" id="nlCellBgGrid"></div>'
    +'<div style="margin-top:6px;display:flex;gap:4px;align-items:center">'
    +'<label style="font-size:10px;color:var(--t3);font-weight:600;white-space:nowrap">농도</label>'
    +'<select id="nlCellBgOpacity" style="font-size:10px;padding:2px 4px;border:1px solid var(--bdr);border-radius:4px;background:var(--card);color:var(--t2);cursor:pointer" data-nl-click="stopPropagation">'
    +'<option value="100">100%</option><option value="80">80%</option><option value="60">60%</option><option value="40">40%</option><option value="20" selected>20%</option><option value="10">10%</option><option value="5">5%</option>'
    +'</select>'
    +'<button data-nl-click="nlCellBgApplyColor" data-nl-arg="transparent" style="flex:1;font-size:10px;padding:4px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer">음영 제거</button>'
    +'</div></div></div>'
    +'<div class="vpe-sep"></div>'
    +'<button data-nl-click="nlCopyObj" title="복사">📋 복사</button>'
    +'<button data-nl-click="nlDeleteObj" title="삭제">🗑 삭제</button>'
    +'<div class="vpe-dropdown-wrap" style="position:relative;display:inline-block">'
    +'<button>📐 객체 위치</button>'
    +'<div class="vpe-action-dropdown">'
    +'<button data-nl-click="nlZOrder" data-nl-arg="1">⬆ 앞으로</button>'
    +'<button data-nl-click="nlZOrder" data-nl-arg="-1">⬇ 뒤로</button>'
    +'<button data-nl-click="nlZOrderMax">⏫ 맨 앞으로</button>'
    +'<button data-nl-click="nlZOrderMin">⏬ 맨 뒤로</button>'
    +'</div></div>'
    +'<div class="vpe-dropdown-wrap" style="position:relative;display:inline-block">'
    +'<button>📏 페이지 맞춤</button>'
    +'<div class="vpe-action-dropdown">'
    +'<button data-nl-click="nlAlign" data-nl-arg="top">⬆ 맨 위</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="left">⬅ 왼쪽</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="centerH">↔ 가로 가운데</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="centerV">↕ 세로 가운데</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="right">➡ 오른쪽</button>'
    +'<button data-nl-click="nlAlign" data-nl-arg="bottom">⬇ 맨 아래</button>'
    +'</div></div>'
    +'<button data-nl-click="nlResetEditor" title="초기화">↺ 초기화</button>'
    +'</div>';
  /* 캔버스 */
  h+='<div class="nl-canvas-area" id="nlCanvasArea" data-nl-click="nlCanvasAreaClick">'
    +'<div class="nl-canvas" id="nlCanvas"></div></div>';
  /* 상태바 */
  h+='<div class="nl-zoom-bar">'
    +'<span id="nlObjInfo" style="color:var(--t3)">객체 0개</span>'
    +'<span style="display:flex;align-items:center;gap:4px;margin-left:auto">'
    +'<button data-nl-click="nlPrint" style="height:22px;padding:0 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>인쇄</button>'
    +'</span></div>';
  h+='</div></div>'; /* nl-right, nl-body */
  wrap.innerHTML=h;
  _nlDelegateEvents(wrap);
  nlLoadState();
  _nlSyncControls();
  nlRender();
  nlMergeUpdateUI();if(getNlMerge().data.length)nlMergeUpdateNav();
  document.addEventListener('keydown',_nlKeyHandler);
  const area=document.getElementById('nlCanvasArea');
  if(area)area.addEventListener('wheel',_nlWheelZoom,{passive:false});
}
function _nlSyncControls(){
  document.querySelectorAll('.nl-paper-btn').forEach(function(b){b.classList.toggle('on',b.dataset.paper===nlState.paper);});
  const orientRow=document.getElementById('nlOrientRow');
  if(orientRow)orientRow.style.display=nlState.paper==='a4'?'':'none';
  document.querySelectorAll('.nl-orient-btn').forEach(function(b){b.classList.toggle('on',b.dataset.orient===(nlState.orientation||'portrait'));});
  const mt=document.getElementById('nlMarginTop');if(mt)mt.value=nlState.marginTop;
  const mb=document.getElementById('nlMarginBottom');if(mb)mb.value=nlState.marginBottom;
  const ml=document.getElementById('nlMarginLeft');if(ml)ml.value=nlState.marginLeft;
  const mr=document.getElementById('nlMarginRight');if(mr)mr.value=nlState.marginRight;
  const bs=document.getElementById('nlBgScaleSlider');if(bs)bs.value=nlState.bgScale;
  const bv=document.getElementById('nlBgScaleVal');if(bv)bv.textContent=nlState.bgScale+'%';
  const boy=document.getElementById('nlBgOffsetYSlider');if(boy)boy.value=nlState.bgOffsetY;
  const bov=document.getElementById('nlBgOffsetYVal');if(bov)bov.textContent=nlState.bgOffsetY+'px';
  const box2=document.getElementById('nlBgOffsetXSlider');if(box2)box2.value=nlState.bgOffsetX||0;
  const boxv2=document.getElementById('nlBgOffsetXVal');if(boxv2)boxv2.textContent=(nlState.bgOffsetX||0)+'px';
}

/* ── 가정통신문 마법사 하위 탭 전환 ── */
let _nlCurrentSub='editor';
export function nlSwitchSub(tab){
  if(tab===_nlCurrentSub)return;
  const prevId=tab==='editor'?'nlSubList':'nlSubEditor';
  const nextId=tab==='editor'?'nlSubEditor':'nlSubList';
  const direction=tab==='editor'?-1:1;
  document.getElementById('nlSubTabEditor').classList.toggle('active',tab==='editor');
  document.getElementById('nlSubTabList').classList.toggle('active',tab==='list');
  /* 나가는 패널 */
  const prev=document.getElementById(prevId);
  if(prev){
    prev.style.transition='opacity 0.25s ease, transform 0.25s ease';
    prev.style.opacity='0';prev.style.transform='translateX('+(direction*-30)+'px)';
    setTimeout(function(){prev.style.display='none';prev.style.transform='';prev.style.opacity='';},250);
  }
  /* 들어오는 패널 */
  const next=document.getElementById(nextId);
  if(next){
    setTimeout(function(){
      next.style.display='block';next.style.opacity='0';next.style.transform='translateX('+(direction*30)+'px)';
      requestAnimationFrame(function(){
        next.style.transition='opacity 0.25s ease, transform 0.25s ease';
        next.style.opacity='1';next.style.transform='translateX(0)';
      });
      if(tab==='editor')nlRenderInlineTab();
      if(tab==='list'){nlSave(true);nlRenderList();}
    },260);
  }
  _nlCurrentSub=tab;
}

/* ── 저장된 가정통신문 목록 관리 ── */
const NL_LIST_KEY='ec_nl_saved_list';
let _nlEditingId=null; /* 현재 편집 중인 저장본 ID (null이면 새 문서) */

function _nlGetSavedList(){
  if(_nlStore)return _nlStore.getSavedList();
  try{return JSON.parse(localStorage.getItem(NL_LIST_KEY)||'[]');}catch(e){return [];} 
}
function _nlSetSavedList(list){
  if(_nlStore){_nlStore.setSavedList(list);return;}
  localStorage.setItem(NL_LIST_KEY,JSON.stringify(list));
}

function _nlRefreshSavedListFromBackend(cb){
  if(_nlStore){
    _nlStore.refreshSavedList().then(function(list){if(cb)cb(list);});
    return;
  }
  if(!(window.electronAPI&&window.electronAPI.newsletterListGet)){if(cb)cb(_nlGetSavedList());return;}
  window.electronAPI.newsletterListGet().then(function(res){
    if(res&&res.success&&Array.isArray(res.data)){_nlSetSavedList(res.data);if(cb)cb(res.data);return;}
    if(cb)cb(_nlGetSavedList());
  }).catch(function(){if(cb)cb(_nlGetSavedList());});
}

/* 현재 에디터 → 새로 저장 또는 덮어쓰기 */
function nlSaveAs(){
  nlSave(true);
  const name=prompt('가정통신문 이름을 입력하세요:','가정통신문 '+new Date().toLocaleDateString('ko'));
  if(!name)return;
  const saved=localStorage.getItem(_nlActiveKey());
  const data=saved?JSON.parse(saved):{};
  if(_nlStore){
    _nlStore.createDocument(name,data).then(function(res){
      if(res&&res.success&&res.item){_nlEditingId=res.item.id;_nlSetSavedList(res.list||[]);alert('저장되었습니다.');}
      else alert('저장 실패');
    }).catch(function(){alert('저장 실패');});
    return;
  }
  if(window.electronAPI&&window.electronAPI.newsletterCreate){
    window.electronAPI.newsletterCreate(name,data).then(function(res){
      if(res&&res.success&&res.item){_nlEditingId=res.item.id;_nlSetSavedList(res.list||[]);alert('저장되었습니다.');}
      else alert('저장 실패');
    }).catch(function(){alert('저장 실패');});
    return;
  }
  const list=_nlGetSavedList();
  const item={id:Date.now(),name:name,data:data,created:new Date().toISOString(),updated:new Date().toISOString()};
  list.unshift(item);_nlSetSavedList(list);_nlEditingId=item.id;alert('저장되었습니다.');
}

function nlSaveCurrent(){
  if(!_nlEditingId){nlSaveAs();return;}
  nlSave(true);
  const saved=localStorage.getItem(_nlActiveKey());
  const data=saved?JSON.parse(saved):{};
  if(_nlStore){
    _nlStore.updateDocument(_nlEditingId,data).then(function(res){
      if(!(res&&res.success&&res.found)){nlSaveAs();return;}
      _nlSetSavedList(res.list||[]);
      const t=document.getElementById('globalSaveToast');
      if(t){t.textContent='가정통신문이 저장되었습니다.';t.classList.add('show');setTimeout(function(){t.classList.remove('show');},3000);}
    }).catch(function(){});
    return;
  }
  if(window.electronAPI&&window.electronAPI.newsletterUpdate){
    window.electronAPI.newsletterUpdate(_nlEditingId,data).then(function(res){
      if(!(res&&res.success&&res.found)){nlSaveAs();return;}
      _nlSetSavedList(res.list||[]);
      const t=document.getElementById('globalSaveToast');
      if(t){t.textContent='가정통신문이 저장되었습니다.';t.classList.add('show');setTimeout(function(){t.classList.remove('show');},3000);}
    }).catch(function(){});
    return;
  }
  const list=_nlGetSavedList();
  const idx=list.findIndex(function(it){return it.id===_nlEditingId;});
  if(idx===-1){nlSaveAs();return;}
  list[idx].data=data;list[idx].updated=new Date().toISOString();_nlSetSavedList(list);
  /* 토스트 */
  const t=document.getElementById('globalSaveToast');
  if(t){t.textContent='가정통신문이 저장되었습니다.';t.classList.add('show');setTimeout(function(){t.classList.remove('show');},3000);}
}

/* 목록 렌더링 */
function nlRenderList(){
  const area=document.getElementById('nlListArea');if(!area)return;
  if(!nlRenderList._synced){nlRenderList._synced=true;_nlRefreshSavedListFromBackend(function(){nlRenderList._synced=false;nlRenderList();});}
  const list=_nlGetSavedList();
  let h='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
    +'<span style="font-size:14px;font-weight:800;color:var(--t1)">📋 저장된 가정통신문 ('+list.length+')</span>'
    +'<button data-nl-click="nlResetForNew" style="padding:6px 14px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;font-family:var(--f);background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;border:none">+ 새 가정통신문</button>'
    +'</div>';
  if(!list.length){
    h+='<div style="text-align:center;padding:60px 20px;color:var(--t3)">'
      +'<div style="font-size:36px;margin-bottom:12px">📄</div>'
      +'<div style="font-size:13px;font-weight:600;margin-bottom:4px">저장된 가정통신문이 없습니다.</div>'
      +'<div style="font-size:11px">에디터에서 가정통신문을 만든 후 저장하세요.</div></div>';
    area.innerHTML=h;return;
  }
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">';
  list.forEach(function(item,i){
    const objCount=item.data&&item.data.objects?item.data.objects.length:0;
    const hasBg=item.data&&item.data.pdfBgUrl?true:false;
    const created=new Date(item.created);
    const updated=new Date(item.updated);
    const cStr=created.toLocaleDateString('ko')+' '+created.toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'});
    const uStr=updated.toLocaleDateString('ko')+' '+updated.toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'});
    const isEditing=_nlEditingId===item.id;
    h+='<div style="background:var(--card);border:1px solid '+(isEditing?'var(--cyan)':'var(--bdr)')+';border-radius:10px;padding:14px;cursor:pointer;transition:all 0.15s;position:relative'+(isEditing?';box-shadow:0 0 0 2px rgba(6,182,212,0.2)':'')+'" data-nl-click="nlLoadSaved" data-nl-arg="'+item.id+'" data-nl-hover-border="var(--cyan)" data-nl-hover-restore="'+(isEditing?'var(--cyan)':'var(--bdr)')+'">'
      +(isEditing?'<span style="position:absolute;top:8px;right:10px;font-size:8px;font-weight:700;color:var(--cyan);background:rgba(6,182,212,0.1);padding:2px 6px;border-radius:4px">편집 중</span>':'')
      +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px;padding-right:50px">'+escHtml(item.name)+'</div>'
      +'<div style="display:flex;gap:8px;font-size:10px;color:var(--t3);margin-bottom:8px">'
      +'<span>📦 객체 '+objCount+'개</span>'
      +(hasBg?'<span>🖼 배경 있음</span>':'')
      +'</div>'
      +'<div style="font-size:9px;color:var(--t3)">생성: '+cStr+'</div>'
      +'<div style="font-size:9px;color:var(--t3)">수정: '+uStr+'</div>'
      +'<div style="display:flex;gap:4px;margin-top:8px" data-nl-click="stopPropagation">'
      +'<button data-nl-click="nlRenameSaved" data-nl-arg="'+item.id+'" style="flex:1;padding:4px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">✏️ 이름변경</button>'
      +'<button data-nl-click="nlDuplicateSaved" data-nl-arg="'+item.id+'" style="flex:1;padding:4px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">📋 복제</button>'
      +'<button data-nl-click="nlDeleteSaved" data-nl-arg="'+item.id+'" style="flex:1;padding:4px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:#ef4444;cursor:pointer;font-family:var(--f)">🗑 삭제</button>'
      +'</div></div>';
  });
  h+='</div>';
  area.innerHTML=h;
}

/* 저장본 불러오기 → 에디터로 */
function nlLoadSaved(id){
  if(_nlStore){
    _nlStore.loadDocumentIntoInlineDraft(id).then(function(data){
      if(!data)return;
      _nlEditingId=id;
      _nlInlineActive=false;
      nlSwitchSub('editor');
    }).catch(function(){});
    return;
  }
  if(window.electronAPI&&window.electronAPI.newsletterLoad){
    window.electronAPI.newsletterLoad(id).then(function(res){
      if(!(res&&res.success&&res.data))return;
      _nlEditingId=id;
      localStorage.setItem(NL_INLINE_STORAGE_KEY,JSON.stringify(res.data));
      _nlInlineActive=false;
      nlSwitchSub('editor');
    }).catch(function(){});
    return;
  }
  const list=_nlGetSavedList();
  const item=list.find(function(it){return it.id===id;});
  if(!item)return;
  _nlEditingId=id;localStorage.setItem(NL_INLINE_STORAGE_KEY,JSON.stringify(item.data));_nlInlineActive=false;nlSwitchSub('editor');
}

/* 새 문서로 시작 */
function nlResetForNew(){
  _nlEditingId=null;
  if(_nlStore)_nlStore.resetInlineDraft();
  else localStorage.removeItem(NL_INLINE_STORAGE_KEY);
  _nlInlineActive=false;
  nlRenderInlineTab();
}

/* 이름 변경 */
function nlRenameSaved(id){
  const list=_nlGetSavedList();
  const item=list.find(function(it){return it.id===id;});
  if(!item)return;
  const name=prompt('새 이름을 입력하세요:',item.name);
  if(!name||name===item.name)return;
  if(_nlStore){
    _nlStore.renameDocument(id,name).then(function(res){if(res&&res.success&&res.found){_nlSetSavedList(res.list||[]);nlRenderList();}}).catch(function(){});
    return;
  }
  if(window.electronAPI&&window.electronAPI.newsletterRename){
    window.electronAPI.newsletterRename(id,name).then(function(res){if(res&&res.success&&res.found){_nlSetSavedList(res.list||[]);nlRenderList();}}).catch(function(){});
    return;
  }
  item.name=name;item.updated=new Date().toISOString();_nlSetSavedList(list);nlRenderList();
}

/* 복제 */
function nlDuplicateSaved(id){
  if(_nlStore){
    _nlStore.duplicateDocument(id).then(function(res){if(res&&res.success&&res.item){_nlSetSavedList(res.list||[]);nlRenderList();}}).catch(function(){});
    return;
  }
  if(window.electronAPI&&window.electronAPI.newsletterDuplicate){
    window.electronAPI.newsletterDuplicate(id).then(function(res){if(res&&res.success&&res.item){_nlSetSavedList(res.list||[]);nlRenderList();}}).catch(function(){});
    return;
  }
  const list=_nlGetSavedList();
  const item=list.find(function(it){return it.id===id;});
  if(!item)return;
  const copy={id:Date.now(),name:item.name+' (사본)',data:JSON.parse(JSON.stringify(item.data)),created:new Date().toISOString(),updated:new Date().toISOString()};
  list.unshift(copy);_nlSetSavedList(list);nlRenderList();
}

/* 삭제 */
function nlDeleteSaved(id){
  if(!confirm('이 가정통신문을 삭제하시겠습니까?'))return;
  if(_nlStore){
    _nlStore.deleteDocument(id).then(function(res){if(res&&res.success){_nlSetSavedList(res.list||[]);if(_nlEditingId===id)_nlEditingId=null;nlRenderList();}}).catch(function(){});
    return;
  }
  if(window.electronAPI&&window.electronAPI.newsletterDelete){
    window.electronAPI.newsletterDelete(id).then(function(res){if(res&&res.success){_nlSetSavedList(res.list||[]);if(_nlEditingId===id)_nlEditingId=null;nlRenderList();}}).catch(function(){});
    return;
  }
  const list=_nlGetSavedList().filter(function(it){return it.id!==id;});
  _nlSetSavedList(list);if(_nlEditingId===id)_nlEditingId=null;nlRenderList();
}

  /* ── expose to global scope ── */

  /* --- variables --- */

/* ── Public exports ── */
export function _nlGetMode(){ return _nlMode; }

