/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
import { S } from '../../core/app-state.js';
'use strict';
/* ES Module — 방문확인증 에디터 (통합) */
import { escHtml, getDow, closeModalGracefully } from '../../core/helpers.js';

import { vpState, vpeState, closeVisitPass, vpGetCustomNames, vpGetCustomLabels, vpSaveCustomLabel, vpGetCustomBlocks, vpSaveCustomBlock, vpSaveCustomTitle, vpGetCustomRows, vpSaveCustomRows, vpSaveReasonRemoved } from './visit-pass-view.js';
import { hasMultipleSchoolLevels, getLevelShort, hasAnyDepartment } from '../../core/student-utils.js';
import { closeEmsMsg } from '../kiosk/ems-popup-view.js';
import { _bgRmOpen, _autoTrimCanvas } from '../newsletter/newsletter-misc-view.js';
import { formatMedicationDisplay } from '../symptom/symptom-view.js';
import { showHeaderTooltip, hideHeaderTooltip } from '../emergency/emergency-view.js';
import { bus } from '../../core/event-bus.js';

/* 자동 저장 디바운스 타이머 — 본 모듈에서만 사용 */
let vpAutoSaveTimer=null;

/* ═══ VisitPassEditorMedia ═══ */
function VisitPassEditorMedia(){}
VisitPassEditorMedia.prototype.getPaperSize = function(vs,ve){ const isA4=vs.paper==='a4'; if(isA4&&vs.orientation==='landscape')return{w:842,h:595}; if(isA4)return{w:595,h:842}; return{w:280,h:ve._cutY||400}; };
VisitPassEditorMedia.prototype.applyStretchedBackground = function(ve,url){ if(!url)return false; ve.pdfBgUrl=url; return true; };
VisitPassEditorMedia.prototype.applyImageBgRemoval = function(ve,url){ if(!ve.selectedId||!url)return false; const o=(ve.objects||[]).find(function(x){return x.id===ve.selectedId;}); if(!o||o.type!=='image')return false; o.src=url;o.content=url; return true; };
VisitPassEditorMedia.prototype.applyCroppedImage = function(ve,url){ if(!ve.selectedId||!url)return null; const o=(ve.objects||[]).find(function(x){return x.id===ve.selectedId;}); if(!o||o.type!=='image')return null; o.src=url;o.content=url; return o; };
export const _vpeMedia = new VisitPassEditorMedia();

/* ═══ VisitPassEditorStore ═══ */
function VisitPassEditorStore(api){ this.api=api||null; }
VisitPassEditorStore.prototype.storageKey = function(slot){ return 'ec_vp_editor_'+slot; };
VisitPassEditorStore.prototype.serialize = function(vs,ve){
  const d={paper:vs.paper,objects:JSON.parse(JSON.stringify(ve.objects||[]))};
  if(ve._cutY)d.cutY=ve._cutY; if(ve.pdfBgUrl)d.pdfBgUrl=ve.pdfBgUrl; if(ve.pdfBgFileName)d.pdfBgFileName=ve.pdfBgFileName;
  d.bgScale=ve.bgScale||100; d.bgOffsetY=ve.bgOffsetY||0; d.bgOffsetX=ve.bgOffsetX||0;
  d.marginTop=ve.marginTop; d.marginBottom=ve.marginBottom; d.marginLeft=ve.marginLeft; d.marginRight=ve.marginRight;
  return d;
};
VisitPassEditorStore.prototype.applyToState = function(data,vs,ve,ensureStyle){
  ve.objects=data.objects||[]; ve.objects.forEach(function(o){ensureStyle(o);});
  ve.nextId=Math.max.apply(null,[0].concat(ve.objects.map(function(o){return parseInt(String(o.id||'').replace('obj_',''))||0;})))+1;
  ve.selectedId=null; ve.pdfBgUrl=data.pdfBgUrl||null; ve.pdfBgFileName=data.pdfBgFileName||null;
  ve.bgScale=data.bgScale||100; ve.bgOffsetY=data.bgOffsetY||0; ve.bgOffsetX=data.bgOffsetX||0;
  ve.marginTop=data.marginTop!=null?data.marginTop:7; ve.marginBottom=data.marginBottom!=null?data.marginBottom:7;
  ve.marginLeft=data.marginLeft!=null?data.marginLeft:7; ve.marginRight=data.marginRight!=null?data.marginRight:7;
  ve._cutY=data.cutY||ve._cutY; if(data.paper)vs.paper=data.paper;
};
VisitPassEditorStore.prototype.loadLocal = function(slot){ try{const s=localStorage.getItem(this.storageKey(slot));return s?JSON.parse(s):null;}catch(e){return null;} };
VisitPassEditorStore.prototype.loadRemote = function(slot){
  if(!(this.api&&this.api.editorStateGet))return Promise.resolve(null);
  return this.api.editorStateGet('visit-pass-editor',slot).then(function(res){return res&&res.success&&res.data?res.data:null;}).catch(function(){return null;});
};
VisitPassEditorStore.prototype.save = function(slot,data){ localStorage.setItem(this.storageKey(slot),JSON.stringify(data)); if(this.api&&this.api.editorStateSave)this.api.editorStateSave('visit-pass-editor',slot,data).catch(function(){}); };
const _vpeStore = new VisitPassEditorStore(window.electronAPI||null);

/* ═══ VisitPassEditorModel ═══ */
function VisitPassEditorModel(){}
VisitPassEditorModel.prototype._defaultStyle = function(type){
  if(type==='dynfield')return{fontSize:12,fontFamily:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",fontWeight:'bold',fontStyle:'normal',textDecoration:'none',color:'#0e7490',textAlign:'center',bgColor:'transparent',borderColor:'transparent',borderWidth:0};
  if(type==='table')return{fontSize:11,fontFamily:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000000',textAlign:'left',bgColor:'transparent',borderColor:'#aaaaaa',borderWidth:1};
  return{fontSize:12,fontFamily:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000000',textAlign:'left',bgColor:'transparent',borderColor:'#000000',borderWidth:1};
};
VisitPassEditorModel.prototype.getObject = function(s,id){ return(s.objects||[]).find(function(o){return o.id===id;})||null; };
VisitPassEditorModel.prototype.getSelectedObject = function(s){ return this.getObject(s,s.selectedId); };
VisitPassEditorModel.prototype.copySelectedObject = function(s){ const o=this.getSelectedObject(s);if(!o)return null;const c=JSON.parse(JSON.stringify(o));c.id='obj_'+(s.nextId++);c.x+=15;c.y+=15;c.z=(s.objects||[]).length+1;s.objects.push(c);return c; };
VisitPassEditorModel.prototype.deleteSelectedObjects = function(s){ const ids=s.selectedIds&&s.selectedIds.length?s.selectedIds:(s.selectedId?[s.selectedId]:[]);if(!ids.length)return ids;s.objects=(s.objects||[]).filter(function(o){return ids.indexOf(o.id)===-1;});s.selectedId=null;s.selectedIds=[];return ids; };
VisitPassEditorModel.prototype.adjustZOrder = function(s,dir){ const o=this.getSelectedObject(s);if(!o)return false;o.z=Math.max(1,(o.z||1)+dir);return true; };
VisitPassEditorModel.prototype.bringToFront = function(s){ const o=this.getSelectedObject(s);if(!o)return false;let mx=1;(s.objects||[]).forEach(function(x){if(x.z>mx)mx=x.z;});o.z=mx+1;return true; };
VisitPassEditorModel.prototype.sendToBack = function(s){ const o=this.getSelectedObject(s);if(!o)return false;(s.objects||[]).forEach(function(x){if(x.z>0)x.z+=1;});o.z=1;return true; };
VisitPassEditorModel.prototype.alignSelectedObject = function(s,dir,cw,ch){ const o=this.getSelectedObject(s);if(!o)return false;if(dir==='top')o.y=0;else if(dir==='left')o.x=0;else if(dir==='centerH')o.x=Math.round(((cw||0)-o.w)/2);else if(dir==='centerV')o.y=Math.round(((ch||0)-o.h)/2);else if(dir==='right')o.x=(cw||0)-o.w;else if(dir==='bottom')o.y=(ch||0)-o.h;else return false;return true; };
VisitPassEditorModel.prototype.ensureStyle = function(obj){ if(!obj.style)obj.style=this._defaultStyle(obj.type); return obj.style; };
VisitPassEditorModel.prototype.createObject = function(s,type,cw){
  const defs={textbox:{w:180,h:36,content:'텍스트를 입력하세요.'},line:{w:200,h:4},rect:{w:120,h:80},circle:{w:80,h:80},signature:{w:160,h:60},datefield:{w:140,h:32}};
  const d=defs[type]||{w:100,h:40}; const obj={id:'obj_'+(s.nextId++),type:type,x:Math.max(10,Math.floor(((cw||0)-d.w)/2)),y:20+(s.objects||[]).length*10,w:d.w,h:d.h,z:(s.objects||[]).length+1,style:this._defaultStyle(type),content:d.content||''};
  s.objects.push(obj); return obj;
};
VisitPassEditorModel.prototype.createTableObject = function(s,rows,cols,cw){
  const cells=[];for(let i=0;i<rows*cols;i++)cells.push({text:'',bg:''});const w=Math.min((cw||0)-20,cols*70);
  const obj={id:'obj_'+(s.nextId++),type:'table',x:Math.max(10,Math.floor(((cw||0)-w)/2)),y:20+(s.objects||[]).length*10,w:w,h:0,z:(s.objects||[]).length+1,style:this._defaultStyle('table'),content:'',tableData:{rows:rows,cols:cols,cells:cells}};
  s.objects.push(obj); return obj;
};
VisitPassEditorModel.prototype.createDynFieldObject = function(s,fieldKey,cw){
  const obj={id:'obj_'+(s.nextId++),type:'dynfield',x:Math.max(10,Math.floor(((cw||0)-120)/2)),y:20+(s.objects||[]).length*10,w:120,h:26,z:(s.objects||[]).length+1,style:this._defaultStyle('dynfield'),content:fieldKey};
  s.objects.push(obj); return obj;
};
VisitPassEditorModel.prototype.setStyle = function(s,prop,val){ const o=this.getSelectedObject(s);if(!o)return null;this.ensureStyle(o)[prop]=val;return o; };
VisitPassEditorModel.prototype.toggleStyle = function(s,prop,on,off){ const o=this.getSelectedObject(s);if(!o)return null;const st=this.ensureStyle(o);st[prop]=st[prop]===on?off:on;return o; };
VisitPassEditorModel.prototype.mergeSelectedCells = function(s,ss,se){ const o=this.getSelectedObject(s);if(!o||o.type!=='table'||!ss||!se)return false;const td=o.tableData;const r1=Math.min(ss.r,se.r), r2=Math.max(ss.r,se.r), c1=Math.min(ss.c,se.c), c2=Math.max(ss.c,se.c);if(r1===r2&&c1===c2)return false;const fi=r1*td.cols+c1;if(!td.cells[fi])td.cells[fi]={text:'',bg:''};td.cells[fi].rowspan=r2-r1+1;td.cells[fi].colspan=c2-c1+1;for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){if(r===r1&&c===c1)continue;const idx=r*td.cols+c;if(!td.cells[idx])td.cells[idx]={text:'',bg:''};td.cells[idx].merged=true;}return true; };
VisitPassEditorModel.prototype.unmergeSelectedCells = function(s){ const o=this.getSelectedObject(s);if(!o||o.type!=='table')return false;const td=o.tableData;for(let i=0;i<td.cells.length;i++){if(td.cells[i]){delete td.cells[i].rowspan;delete td.cells[i].colspan;delete td.cells[i].merged;}}return true; };
VisitPassEditorModel.prototype.addTableRow = function(s,dir,ss){ const o=this.getSelectedObject(s);if(!o||o.type!=='table')return false;const td=o.tableData;const row=ss?ss.r:(dir==='above'?0:td.rows-1);const nc=[];for(let i=0;i<td.cols;i++)nc.push({text:'',bg:''});td.cells.splice.apply(td.cells,[dir==='above'?row*td.cols:(row+1)*td.cols,0].concat(nc));td.rows++;obj.h+=28;return true; };
VisitPassEditorModel.prototype.addTableCol = function(s,dir,ss){ const o=this.getSelectedObject(s);if(!o||o.type!=='table')return false;const td=o.tableData;const col=ss?ss.c:(dir==='left'?0:td.cols-1);const ic=dir==='left'?col:col+1;for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+ic,0,{text:'',bg:''});td.cols++;o.w+=70;return true; };
VisitPassEditorModel.prototype.deleteTableRow = function(s,ss){ const o=this.getSelectedObject(s);if(!o||o.type!=='table')return false;const td=o.tableData;if(td.rows<=1)return false;const row=ss?ss.r:td.rows-1;td.cells.splice(row*td.cols,td.cols);td.rows--;o.h=Math.max(28,o.h-28);return true; };
VisitPassEditorModel.prototype.deleteTableCol = function(s,ss){ const o=this.getSelectedObject(s);if(!o||o.type!=='table')return false;const td=o.tableData;if(td.cols<=1)return false;const col=ss?ss.c:td.cols-1;for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+col,1);td.cols--;o.w=Math.max(70,o.w-70);return true; };
VisitPassEditorModel.prototype.applyCellBackground = function(s,ss,se,color){ const o=this.getSelectedObject(s);if(!o||o.type!=='table'||!o.tableData)return false;const td=o.tableData;if(ss&&se){const r1=Math.min(ss.r,se.r), r2=Math.max(ss.r,se.r), c1=Math.min(ss.c,se.c), c2=Math.max(ss.c,se.c);for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){const i=r*td.cols+c;if(!td.cells[i])td.cells[i]={text:'',bg:''};td.cells[i].bg=color;}return true;}for(let i2=0;i2<td.cells.length;i2++){if(!td.cells[i2])td.cells[i2]={text:'',bg:''};td.cells[i2].bg=color;}return true; };
VisitPassEditorModel.prototype.setTableBorderState = function(s,mode,style,width,color){ const o=this.getSelectedObject(s);if(!o||o.type!=='table')return false;if(!o.tableBorder)o.tableBorder={};o.tableBorder.lastMode=mode;o.tableBorder.style=style;o.tableBorder.width=width;o.tableBorder.color=color;return true; };
VisitPassEditorModel.prototype.applySingleCellBackground = function(s,row,col,color){ const o=this.getSelectedObject(s);if(!o||o.type!=='table'||!o.tableData)return false;const td=o.tableData;const idx=row*td.cols+col;if(!td.cells[idx])td.cells[idx]={text:'',bg:''};td.cells[idx].bg=color;return true; };
const _vpeModel = new VisitPassEditorModel();
/* ── HTML Sanitizer: 위험한 태그/속성 제거 (XSS 방지) ── */
function _vpeSanitizeHtml(html){
  if(!html)return '';
  let cleaned=html.replace(/<(script|iframe|object|embed|form|link|meta|base|applet)[^>]*>[\s\S]*?<\/\1>/gi,'');
  cleaned=cleaned.replace(/<(script|iframe|object|embed|form|link|meta|base|applet)[^>]*\/?>/gi,'');
  cleaned=cleaned.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi,'');
  cleaned=cleaned.replace(/(href|src|action)\s*=\s*(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi,'$1=""');
  return cleaned;
}
let _vpPreviewImgData = null;
export function vpeEditorInit(slot){
  vpeState.slot = slot;
  vpeState.selectedId = null;
  if(_vpeStore){
    const localData=_vpeStore.loadLocal(slot);
    if(localData)_vpeStore.applyToState(localData,vpState,vpeState,_vpeEnsureStyle);
    else {vpeState.objects=[];vpeState.nextId=1;}
  } else {
  const saved = localStorage.getItem('ec_vp_editor_'+slot);
  if(saved){
    try {
      const data = JSON.parse(saved);
      vpeState.objects = data.objects || [];
      vpeState.nextId = Math.max(...vpeState.objects.map(o => parseInt(o.id.replace('obj_',''))||0), 0) + 1;
      if(data.cutY) vpeState._cutY=data.cutY;
      if(data.paper && data.paper !== vpState.paper){
        vpState.paper = data.paper;
        document.querySelectorAll('#vpPaperBar .vp-toggle').forEach(b => b.classList.remove('on'));
        const pb = document.querySelector('#vpPaperBar .vp-toggle[data-paper="'+data.paper+'"]');
        if(pb) pb.classList.add('on');
        document.getElementById('vpPaperLabel').textContent = data.paper==='a4'?'A4 용지':'3인치 영수증';
      }
    } catch(e){ vpeState.objects=[]; vpeState.nextId=1; }
  } else {
    vpeState.objects = [];
    vpeState.nextId = 1;
  }
  }
  /* 비동기 원격 로드 — 사용자가 빠르게 슬롯 전환 시 stale 콜백이 다른 슬롯 데이터를 덮어쓰지 않도록 _initSlot 으로 가드 */
  const _initSlot=slot;
  if(_vpeStore){
    _vpeStore.loadRemote(slot).then(function(data){
      if(_initSlot!==vpeState.slot)return; /* 슬롯 변경됨 — 무시 */
      if(!data)return;
      _vpeStore.applyToState(data,vpState,vpeState,_vpeEnsureStyle);
      document.querySelectorAll('#vpPaperBar .vp-toggle').forEach(function(b){b.classList.remove('on');});
      const pb2=document.querySelector('#vpPaperBar .vp-toggle[data-paper="'+vpState.paper+'"]');
      if(pb2)pb2.classList.add('on');
      document.getElementById('vpPaperLabel').textContent=vpState.paper==='a4'?'A4 용지':'3인치 영수증';
      vpeEditorRender();
      vpeUpdateObjInfo();
    }).catch(function(){});
  } else
  if(window.electronAPI&&window.electronAPI.editorStateGet){
    window.electronAPI.editorStateGet('visit-pass-editor',slot).then(function(res){
      if(_initSlot!==vpeState.slot)return; /* 슬롯 변경됨 — 무시 */
      if(!(res&&res.success&&res.data))return;
      const data=res.data;
      vpeState.objects = data.objects || [];
      vpeState.nextId = Math.max.apply(null,[0].concat(vpeState.objects.map(function(o){return parseInt(String(o.id||'').replace('obj_',''))||0;}))) + 1;
      if(data.cutY) vpeState._cutY=data.cutY;
      if(data.paper && data.paper !== vpState.paper){
        vpState.paper = data.paper;
        document.querySelectorAll('#vpPaperBar .vp-toggle').forEach(function(b){b.classList.remove('on');});
        const pb = document.querySelector('#vpPaperBar .vp-toggle[data-paper="'+data.paper+'"]');
        if(pb) pb.classList.add('on');
        document.getElementById('vpPaperLabel').textContent = data.paper==='a4'?'A4 용지':'3인치 영수증';
      }
      vpeEditorRender();
      vpeUpdateObjInfo();
    }).catch(function(){});
  }
  const canvas = document.getElementById('vpeCanvas');
  canvas.className = 'vp-editor-canvas ' + vpState.paper;
  vpeEditorRender();
  vpeUpdateObjInfo();
  document.getElementById('vpeStyleBar').classList.remove('show');
  /* 전체가 한눈에 보이도록 자동 맞춤 */
  setTimeout(vpeZoomFit,100);
}

let _vpeMarginMM=7;/* 기본 여백 7mm */
export function vpeSetMarginSide(side,val){
  val=Math.max(0,Math.min(30,val||0));
  vpeState[side]=val;
  vpeEditorRender();vpeEditorAutoSave();
}
export function vpeSetBgScale(v){
  vpeState.bgScale=Math.max(50,Math.min(200,v));
  const label=document.getElementById('vpeBgScaleVal');if(label)label.textContent=vpeState.bgScale+'%';
  vpeEditorRender();vpeEditorAutoSave();
}
export function vpeSetBgOffsetY(v){
  vpeState.bgOffsetY=Math.max(-200,Math.min(200,v));
  const label=document.getElementById('vpeBgOffsetYVal');if(label)label.textContent=vpeState.bgOffsetY+'px';
  vpeEditorRender();vpeEditorAutoSave();
}
export function vpeSetBgOffsetX(v){
  vpeState.bgOffsetX=Math.max(-200,Math.min(200,v));
  const label=document.getElementById('vpeBgOffsetXVal');if(label)label.textContent=vpeState.bgOffsetX+'px';
  vpeEditorRender();vpeEditorAutoSave();
}
export function vpeBgLoadFile(input){
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(file.type==='application/pdf'){
    _vpeBgLoadPdf(file);
  } else if(file.type.startsWith('image/')){
    const reader=new FileReader();
    reader.onload=function(e){
      vpeState.pdfBgUrl=e.target.result;
      vpeState.pdfBgFileName=file.name;
      const zone=document.getElementById('vpeBgUploadZone');
      if(zone){zone.innerHTML='✅ '+escHtml(file.name);zone.style.borderColor='var(--cyan)';}
      vpeEditorRender();vpeEditorAutoSave();
    };
    reader.readAsDataURL(file);
  }
}
function _vpeBgLoadPdf(file){
  const reader=new FileReader();
  reader.onload=function(e){
    const data=new Uint8Array(e.target.result);
    if(typeof pdfjsLib==='undefined'){alert('PDF.js를 불러올 수 없습니다.');return;}
    pdfjsLib.getDocument({data:data}).promise.then(function(pdf){
      pdf.getPage(1).then(function(page){
        const scale=2;
        const vp2=page.getViewport({scale:scale});
        const c=document.createElement('canvas');c.width=vp2.width;c.height=vp2.height;
        page.render({canvasContext:c.getContext('2d'),viewport:vp2}).promise.then(function(){
          vpeState.pdfBgUrl=c.toDataURL('image/png');
          vpeState.pdfBgFileName=file.name;
          const zone=document.getElementById('vpeBgUploadZone');
          if(zone){zone.innerHTML='✅ '+escHtml(file.name);zone.style.borderColor='var(--cyan)';}
          vpeEditorRender();vpeEditorAutoSave();
        });
      });
    });
  };
  reader.readAsArrayBuffer(file);
}
export function vpeBgHandleDrop(e){
  if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){
    const f=e.dataTransfer.files[0];
    if(f.type==='application/pdf'||f.type.startsWith('image/'))vpeBgLoadFile({files:[f]});
  }
}
function vpeBgRemove(){
  vpeState.pdfBgUrl=null;vpeState.pdfBgFileName=null;
  const zone=document.getElementById('vpeBgUploadZone');
  if(zone){zone.innerHTML='📁 PDF / 이미지 업로드<br><span style="font-size:9px">클릭 또는 드래그</span>';zone.style.borderColor='var(--bdr)';}
  vpeEditorRender();vpeEditorAutoSave();
}
{const saved=localStorage.getItem('ec_vpe_margin');if(saved!==null){_vpeMarginMM=parseInt(saved);const sel=document.getElementById('vpeMarginSelect');if(sel)sel.value=_vpeMarginMM;}}

function vpeEditorRender(){
  const canvas = document.getElementById('vpeCanvas');
  canvas.innerHTML = '';
  /* 배경 이미지 */
  if(vpeState.pdfBgUrl){
    canvas.style.backgroundImage='url('+vpeState.pdfBgUrl+')';
    canvas.style.backgroundSize=(vpeState.bgScale||100)+'% auto';
    canvas.style.backgroundPosition='calc(50% + '+(vpeState.bgOffsetX||0)+'px) '+(vpeState.bgOffsetY||0)+'px';
    canvas.style.backgroundRepeat='no-repeat';
  } else {canvas.style.backgroundImage='none';}
  _vpeRenderMarginGuides(canvas);
  vpeState.objects.forEach(function(obj){ vpeRenderObj(obj, canvas); });
  /* 영수증(롤) 용지: 절단선 + 드래그 확장 */
  if(canvas.classList.contains('receipt')){
    const cutY=vpeState._cutY||400;
    let maxBot=cutY;
    vpeState.objects.forEach(function(obj){
      const bot=obj.y+(obj.h||60);
      if(bot>maxBot)maxBot=bot;
    });
    canvas.style.minHeight=Math.max(cutY+40,maxBot+80)+'px';
    /* 절단선 */
    const cutLine=document.createElement('div');
    cutLine.className='vpe-cut-line';
    cutLine.style.top=cutY+'px';
    cutLine.title='드래그하여 인쇄 영역을 조절하세요';
    canvas.appendChild(cutLine);
    /* 절단선 드래그 */
    cutLine.addEventListener('mousedown',function(e){
      e.preventDefault();e.stopPropagation();
      const startY=e.clientY, startCut=cutY;
      const zoomScale=(_vpeZoom||100)/100;
      function onMove(ev){
        const dy=(ev.clientY-startY)/zoomScale;
        vpeState._cutY=Math.max(100,Math.round(startCut+dy));
        const cl=document.querySelector('.vpe-cut-line');
        if(cl)cl.style.top=vpeState._cutY+'px';
        canvas.style.minHeight=Math.max(vpeState._cutY+40,200)+'px';
      }
      function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);vpeEditorAutoSave();}
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
    /* 말풍선 설명 */
    const bubble=document.createElement('div');
    bubble.className='vpe-cut-bubble';
    bubble.style.top=(cutY-12)+'px';
    bubble.textContent='여기서 잘림 — 드래그로 조절';
    canvas.appendChild(bubble);
    /* 가위 이모지를 절단선 오른쪽 끝에 추가 (CSS ::after로 처리) */
  }
  /* ── 캔버스 빈 영역 mousedown — 선택 해제 + 마퀴 드래그 시작 ── */
  if(!canvas._vpeBlankBound){
    canvas._vpeBlankBound=true;
    canvas.addEventListener('mousedown',function(e){
      if(e.button!==0)return;
      /* 객체/핸들/절단선 위 클릭은 무시 */
      if(e.target.closest('.vpe-obj')||e.target.classList.contains('vpe-cut-line')||e.target.classList.contains('vpe-cut-bubble'))return;
      /* 선택 해제 */
      vpeState.selectedId=null;
      document.querySelectorAll('.vpe-obj.selected').forEach(function(el){el.classList.remove('selected');});
      const bar=document.getElementById('vpeStyleBar');if(bar)bar.style.display='none';
      /* 마퀴 선택 시작 */
      _vpeStartMarquee(e);
    });
  }
}
/* ── 마퀴 드래그 선택 ── */
function _vpeStartMarquee(e){
  const canvas=document.getElementById('vpeCanvas');if(!canvas)return;
  const rect=canvas.getBoundingClientRect();
  const zoomScale=(_vpeZoom||100)/100;
  const startX=(e.clientX-rect.left)/zoomScale;
  const startY=(e.clientY-rect.top)/zoomScale;
  const box=document.createElement('div');
  box.className='vpe-marquee';
  box.style.cssText='position:absolute;border:1.5px dashed #06b6d4;background:rgba(6,182,212,0.08);pointer-events:none;z-index:9998;left:'+startX+'px;top:'+startY+'px;width:0;height:0';
  canvas.appendChild(box);
  function onMove(ev){
    const x=(ev.clientX-rect.left)/zoomScale;
    const y=(ev.clientY-rect.top)/zoomScale;
    const L=Math.min(startX,x), T=Math.min(startY,y);
    const W=Math.abs(x-startX), H=Math.abs(y-startY);
    box.style.left=L+'px';box.style.top=T+'px';box.style.width=W+'px';box.style.height=H+'px';
  }
  function onUp(ev){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    const bx=box.getBoundingClientRect();
    box.remove();
    /* 마퀴 안에 들어간 객체 ID 수집 */
    const selected=[];
    vpeState.objects.forEach(function(obj){
      const oR={left:rect.left+obj.x*zoomScale,top:rect.top+obj.y*zoomScale,right:rect.left+(obj.x+obj.w)*zoomScale,bottom:rect.top+(obj.y+(obj.h||40))*zoomScale};
      if(oR.left<bx.right&&oR.right>bx.left&&oR.top<bx.bottom&&oR.bottom>bx.top)selected.push(obj.id);
    });
    vpeState._marqueeSelected=selected;
    /* 시각적 표시: 선택된 모두에 .selected 추가 */
    document.querySelectorAll('.vpe-obj').forEach(function(el){
      el.classList.toggle('selected',selected.indexOf(el.dataset.objId)!==-1);
    });
    if(selected.length===1){vpeSelectObject(selected[0]);}
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}
function _vpeRenderMarginGuides(canvas){
  const t=(vpeState.marginTop||_vpeMarginMM||0)*3.78;
  const b=(vpeState.marginBottom||_vpeMarginMM||0)*3.78;
  const l=(vpeState.marginLeft||_vpeMarginMM||0)*3.78;
  const r=(vpeState.marginRight||_vpeMarginMM||0)*3.78;
  if(t<=0&&b<=0&&l<=0&&r<=0)return;
  const guide=document.createElement('div');
  guide.className='vpe-margin-guide';
  guide.style.cssText='position:absolute;top:'+t+'px;left:'+l+'px;right:'+r+'px;bottom:'+b+'px;border:1px dashed rgba(180,180,180,0.55);pointer-events:none;z-index:9999';
  canvas.appendChild(guide);
}

function vpeRenderObj(obj, canvas){
  const el = document.createElement('div');
  el.className = 'vpe-obj' + (obj.id === vpeState.selectedId ? ' selected' : '');
  el.dataset.objId = obj.id;
  el.style.left = obj.x + 'px';
  el.style.top = obj.y + 'px';
  el.style.width = obj.w + 'px';
  /* 표는 explicit 높이 유지(리사이즈 후 되돌림 방지). 글상자/선만 auto */
  el.style.height = (obj.type === 'line' || obj.type === 'textbox') ? 'auto' : (obj.h + 'px');
  el.style.zIndex = obj.z || 1;
  if(obj.type==='circle') el.classList.add('vpe-circle-obj');
  if(obj.style){
    if(obj.style.bgColor && obj.style.bgColor !== 'transparent' && obj.type !== 'circle') el.style.backgroundColor = obj.style.bgColor;
    if(obj.style.borderColor && obj.type !== 'textbox' && obj.type !== 'dynfield' && obj.type !== 'line' && obj.type !== 'circle') {
      el.style.borderColor = obj.style.borderColor;
      el.style.borderWidth = (obj.style.borderWidth||1) + 'px';
      el.style.borderStyle = 'solid';
    }
  }

  switch(obj.type){
    case 'textbox':
      el.innerHTML = _vpeSanitizeHtml(obj.content || '');
      el.contentEditable = 'false';
      Object.assign(el.style, {
        fontSize:(parseInt(obj.style.fontSize)||12)+'px',
        fontFamily:obj.style.fontFamily||"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
        fontWeight:obj.style.fontWeight||'normal',
        fontStyle:obj.style.fontStyle||'normal',
        textDecoration:obj.style.textDecoration||'none',
        color:obj.style.color||'#000',
        textAlign:obj.style.textAlign||'left',
        lineHeight:'1.5',
        padding:'4px 6px',
        wordBreak:'break-word',
        overflow:'hidden'
      });
      break;
    case 'table':
      const tbl = vpeRenderTable(obj);
      tbl.style.width='100%';
      tbl.style.height='100%'; /* 컨테이너 높이를 채워서 리사이즈 즉시 반영 */
      el.appendChild(tbl);
      el.style.overflow = 'hidden';
      break;
    case 'line':
      el.style.height = '4px';
      el.style.minHeight = '4px';
      const lineDiv = document.createElement('div');
      lineDiv.className = 'vpe-line-shape';
      lineDiv.style.borderTopColor = obj.style.borderColor||'#000';
      lineDiv.style.borderTopWidth = (obj.style.borderWidth||2)+'px';
      el.appendChild(lineDiv);
      break;
    case 'rect':
      const rectDiv = document.createElement('div');
      rectDiv.className = 'vpe-rect-shape';
      rectDiv.style.border = (obj.style.borderWidth||1)+'px solid '+(obj.style.borderColor||'#000');
      if(obj.style.bgColor && obj.style.bgColor !== 'transparent') rectDiv.style.backgroundColor = obj.style.bgColor;
      el.appendChild(rectDiv);
      break;
    case 'circle':
      /* 부모 div에서 사각형 흔적 완전 제거 */
      el.style.background='transparent';
      el.style.border='none';
      el.style.boxShadow='none';
      el.style.outline='none';
      const circDiv = document.createElement('div');
      circDiv.className = 'vpe-circle-shape';
      circDiv.style.border = (obj.style.borderWidth||1)+'px solid '+(obj.style.borderColor||'#000');
      if(obj.style.bgColor && obj.style.bgColor !== 'transparent') circDiv.style.backgroundColor = obj.style.bgColor;
      el.appendChild(circDiv);
      break;
    case 'signature':
      el.innerHTML = '<div class="vpe-sig-area">✍ 서명 영역</div>';
      break;
    case 'datefield':
      el.innerHTML = '<div class="vpe-date-area">📅 날짜</div>';
      break;
    case 'dynfield':
      el.innerHTML = '<span class="vpe-dynpill">{{'+obj.content+'}}</span>';
      el.style.padding = '3px 4px';
      break;
    case 'image':
      const imgEl = document.createElement('img');
      imgEl.src = obj.src;
      imgEl.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block';
      imgEl.draggable = false;
      el.appendChild(imgEl);
      el.style.overflow = 'hidden';
      break;
  }

  const handles = ['nw','n','ne','w','e','sw','s','se'];
  handles.forEach(function(h){
    const hEl = document.createElement('div');
    hEl.className = 'vpe-handle '+h;
    hEl.dataset.handle = h;
    el.appendChild(hEl);
  });

  el.addEventListener('mousedown', function(e){
    if(e.target.classList.contains('vpe-handle')){
      vpeResizeStart(e, obj.id, e.target.dataset.handle);
      return;
    }
    /* 편집 모드(contentEditable) 중인 요소 안이면 드래그 안 함 */
    if(e.target.isContentEditable) return;
    /* 테이블 셀 클릭 시 드래그 안 함 (셀 선택 우선) */
    if(obj.type==='table' && e.target.closest('td')) return;
    /* 그 외 무조건 이동 */
    e.preventDefault();
    vpeSelectObject(obj.id);
    vpeDragStart(e, obj.id);
  });
  el.addEventListener('dblclick', function(e){
    if(obj.type === 'textbox'){
      el.contentEditable = 'true';
      el.focus();
      /* 전체 텍스트 선택 */
      const range=document.createRange();range.selectNodeContents(el);
      const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
      el.addEventListener('blur', function onBlur(){
        el.contentEditable = 'false';
        obj.content = el.innerHTML;
        vpeEditorAutoSave();
      }, {once:true});
      el.addEventListener('input', function(){
        obj.content = el.innerHTML;
        vpeEditorAutoSave();
      });
    }
  });

  canvas.appendChild(el);
}

function vpeRenderTable(obj){
  const tbl = document.createElement('table');
  const td = obj.tableData;
  if(!td) return tbl;
  for(let r=0; r<td.rows; r++){
    const tr = document.createElement('tr');
    for(let c=0; c<td.cols; c++){
      const cellData = td.cells[r*td.cols+c];
      if(cellData&&cellData.merged) continue;/* 병합된 셀 건너뜀 */
      const cell = document.createElement('td');
      cell.textContent = cellData ? cellData.text||'' : '';
      cell.contentEditable = 'true';
      cell.style.backgroundColor = cellData && cellData.bg ? cellData.bg : '';
      if(cellData&&cellData.rowspan>1) cell.rowSpan=cellData.rowspan;
      if(cellData&&cellData.colspan>1) cell.colSpan=cellData.colspan;
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('input', (function(rr,cc){
        return function(){
          if(!obj.tableData.cells[rr*td.cols+cc]) obj.tableData.cells[rr*td.cols+cc]={};
          obj.tableData.cells[rr*td.cols+cc].text = this.textContent;
          vpeEditorAutoSave();
        };
      })(r,c));
      cell.addEventListener('contextmenu', function(e){
        e.preventDefault();
        e.stopPropagation();
        vpeShowTableCtx(e, obj.id, parseInt(this.dataset.row), parseInt(this.dataset.col));
      });
      cell.addEventListener('mousedown', function(e){
        if(e.button!==0)return;
        /* preventDefault 제거 — contentEditable의 기본 포커스 동작 허용 (단일 클릭 입력) */
        e.stopPropagation();
        const tblEl=this.closest('table');
        if(tblEl) tblEl.classList.add('vpe-cell-selecting');
        vpeSelectObject(obj.id);
        const ri=parseInt(this.dataset.row), ci=parseInt(this.dataset.col);
        _vpeSelStart={r:ri,c:ci};_vpeSelEnd={r:ri,c:ci};_vpeSelObjId=obj.id;
        _vpeClearHighlight();this.classList.add('selected-cell');
        _vpeCellDragging=true;
        /* 곧바로 caret을 셀 안으로 — focus 보장 */
        const self=this;setTimeout(function(){if(document.activeElement!==self)self.focus();},0);
      });
      tr.appendChild(cell);
    }
    tbl.appendChild(tr);
  }
  return tbl;
}

function vpeSelectObject(id){
  vpeState.selectedId = id;
  document.querySelectorAll('.vpe-obj').forEach(function(el){
    el.classList.toggle('selected', el.dataset.objId === id);
  });
  const obj = vpeGetObj(id);
  const bar = document.getElementById('vpeStyleBar');
  const hasShape=(obj&&(obj.type==='line'||obj.type==='rect'||obj.type==='circle'));
  if(obj && (obj.type==='textbox'||obj.type==='table'||hasShape)){
    bar.classList.add('show');
    vpeSyncStyleBar(obj);
  } else {
    bar.classList.remove('show');
  }
}

function vpeDeselectAll(){
  vpeState.selectedId = null;
  vpeState.selectedIds = [];
  document.querySelectorAll('.vpe-obj.selected').forEach(function(el){ el.classList.remove('selected'); });
  document.getElementById('vpeStyleBar').classList.remove('show');
}

function vpeSelectMultiple(ids){
  vpeState.selectedIds = ids;
  vpeState.selectedId = ids[0] || null;
  document.querySelectorAll('.vpe-obj').forEach(function(el){
    el.classList.toggle('selected', ids.indexOf(el.dataset.objId) !== -1);
  });
  const bar = document.getElementById('vpeStyleBar');
  bar.classList.remove('show');
}

function vpeGetObj(id){
  return vpeState.objects.find(function(o){ return o.id === id; });
}

function vpeDragStart(e, id){
  const obj = vpeGetObj(id);
  if(!obj) return;
  vpeState.isDragging = true;
  const canvas = document.getElementById('vpeCanvas');
  const cr = canvas.getBoundingClientRect();
  /* 다중 선택 중이면 전체를 함께 드래그 */
  const ids=(vpeState.selectedIds&&vpeState.selectedIds.length&&vpeState.selectedIds.indexOf(id)!==-1)?vpeState.selectedIds:[id];
  const origins=[];
  ids.forEach(function(oid){const o=vpeGetObj(oid);if(o)origins.push({id:oid,origX:o.x,origY:o.y});});
  vpeState.dragData = {
    id: id,
    ids: ids,
    origins: origins,
    startX: e.clientX,
    startY: e.clientY,
    origX: obj.x,
    origY: obj.y,
    canvasLeft: cr.left,
    canvasTop: cr.top,
    canvasW: cr.width,
    canvasH: cr.height
  };
}

function vpeDragMove(e){
  if(!vpeState.isDragging || !vpeState.dragData) return;
  const d = vpeState.dragData;
  let dx = e.clientX - d.startX;
  let dy = e.clientY - d.startY;
  const zoomScale=(_vpeZoom||100)/100;
  dx=dx/zoomScale; dy=dy/zoomScale;
  /* Shift 키: 수평 또는 수직으로만 이동 */
  if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy)){dy=0;}else{dx=0;}}
  d.origins.forEach(function(orig){
    const obj=vpeGetObj(orig.id);if(!obj)return;
    obj.x=Math.max(0,Math.round(orig.origX+dx));
    obj.y=Math.max(0,Math.round(orig.origY+dy));
    const el=document.querySelector('.vpe-obj[data-obj-id="'+orig.id+'"]');
    if(el){el.style.left=obj.x+'px';el.style.top=obj.y+'px';}
  });
}

function vpeDragEnd(){
  if(vpeState.isDragging){
    const d=vpeState.dragData;
    let moved=false;
    if(d&&d.origins){d.origins.forEach(function(orig){const o=vpeGetObj(orig.id);if(o&&(o.x!==orig.origX||o.y!==orig.origY))moved=true;});}
    vpeState.isDragging=false; vpeState.dragData=null;
    if(moved){vpeEditorRender();vpeSelectObject(d.id);vpeEditorAutoSave();}
  }
}

function vpeResizeStart(e, id, handle){
  e.preventDefault();
  e.stopPropagation();
  const obj = vpeGetObj(id);
  if(!obj) return;
  vpeState.isResizing = true;
  vpeState.resizeData = {
    id: id,
    handle: handle,
    startX: e.clientX,
    startY: e.clientY,
    origX: obj.x,
    origY: obj.y,
    origW: obj.w,
    origH: obj.h
  };
  vpeSelectObject(id);
}

function vpeResizeMove(e){
  if(!vpeState.isResizing || !vpeState.resizeData) return;
  const r = vpeState.resizeData;
  const obj = vpeGetObj(r.id);
  if(!obj) return;
  const zoomScale=(_vpeZoom||100)/100;
  const dx = (e.clientX - r.startX)/zoomScale;
  const dy = (e.clientY - r.startY)/zoomScale;
  let newX=r.origX, newY=r.origY, newW=r.origW, newH=r.origH;
  if(r.handle.includes('e')) newW = Math.max(20, r.origW + dx);
  if(r.handle.includes('w')){ newW = Math.max(20, r.origW - dx); newX = r.origX + (r.origW - newW); }
  if(r.handle.includes('s')) newH = Math.max(14, r.origH + dy);
  if(r.handle.includes('n')){ newH = Math.max(14, r.origH - dy); newY = r.origY + (r.origH - newH); }
  obj.x=newX; obj.y=newY; obj.w=newW;
  /* 글상자: 높이 변경 시 글자 크기만 조정, 높이는 텍스트에 맞춰 자동 */
  if(obj.type==='textbox'){
    if(!r.origFontSize) r.origFontSize=obj.style.fontSize||12;
    let scale;
    const wChanged=r.handle.includes('e')||r.handle.includes('w');
    const hChanged=r.handle.includes('s')||r.handle.includes('n');
    if(hChanged&&!wChanged){
      scale=newH/r.origH;
    } else if(wChanged&&!hChanged){
      scale=newW/r.origW;
    } else {
      scale=Math.max(newW/r.origW,newH/r.origH);
    }
    obj.style.fontSize=Math.max(6,Math.round(r.origFontSize*scale*10)/10);
    /* 높이는 auto — 텍스트에 맞춤 */
  } else {
    obj.h=newH;
    /* 글상자 외 다른 타입 폰트 비례 조정 */
    if(obj.style&&obj.style.fontSize&&r.origW>0&&r.origH>0){
      if(!r.origFontSize) r.origFontSize=obj.style.fontSize;
      const wChanged2=r.handle.includes('e')||r.handle.includes('w');
      const hChanged2=r.handle.includes('s')||r.handle.includes('n');
      let scale2;
      if(wChanged2&&hChanged2) scale2=Math.max(newW/r.origW,newH/r.origH);
      else if(wChanged2) scale2=newW/r.origW;
      else scale2=newH/r.origH;
      obj.style.fontSize=Math.max(6,Math.round(r.origFontSize*scale2*10)/10);
    }
  }
  const el = document.querySelector('.vpe-obj[data-obj-id="'+r.id+'"]');
  if(el){
    el.style.left=newX+'px'; el.style.top=newY+'px';
    el.style.width=newW+'px';
    if(obj.type==='textbox'){
      el.style.height='auto';
    } else if(obj.type==='table'){
      el.style.height=newH+'px';
      const tbl=el.querySelector('table');
      if(tbl) tbl.style.height='100%';
    } else if(obj.type !== 'line'){
      el.style.height=newH+'px';
    }
    if(obj.style&&obj.style.fontSize) el.style.fontSize=obj.style.fontSize+'px';
  }
}

function vpeResizeEnd(){
  if(vpeState.isResizing){
    const r=vpeState.resizeData;
    if(r){
      const obj=vpeGetObj(r.id);
      if(obj&&(obj.type==='textbox'||obj.type==='table')){
        /* 리사이즈 끝나면 실제 렌더된 높이를 obj.h에 반영 */
        const el=document.querySelector('.vpe-obj[data-obj-id="'+r.id+'"]');
        if(el) obj.h=el.offsetHeight;
      }
    }
    const changed=r&&(r.origX!==undefined)&&(function(){const o=vpeGetObj(r.id);return o&&(o.x!==r.origX||o.y!==r.origY||o.w!==r.origW||o.h!==r.origH);})();
    const resId=r?r.id:null;
    vpeState.isResizing=false;vpeState.resizeData=null;
    vpeEditorRender();if(resId)vpeSelectObject(resId);if(changed)vpeEditorAutoSave();
  }
}

document.addEventListener('mousemove', function(e){
  if(vpeState.isDragging) vpeDragMove(e);
  if(vpeState.isResizing) vpeResizeMove(e);
});
document.addEventListener('mouseup', function(){
  vpeDragEnd();
  vpeResizeEnd();
});

document.addEventListener('keydown', function(e){
  /* Ctrl+Z / Cmd+Z 되돌리기 — 입력 필드에서는 브라우저 기본 동작 */
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&vpeState.slot){
    const _at=document.activeElement?document.activeElement.tagName:'';
    if(_at==='INPUT'||_at==='TEXTAREA'||_at==='SELECT'||(document.activeElement&&document.activeElement.isContentEditable))return;
    e.preventDefault();vpeUndo();return;
  }
  /* Ctrl+C / Ctrl+X / Ctrl+V — 복사/잘라내기/붙여넣기 */
  if((e.ctrlKey||e.metaKey)&&vpeState.slot){
    const _at2=document.activeElement?document.activeElement.tagName:'';
    if(_at2==='INPUT'||_at2==='TEXTAREA'||_at2==='SELECT'||(document.activeElement&&document.activeElement.isContentEditable))return;
    if(e.key==='c'&&vpeState.selectedId){e.preventDefault();_vpeCopyObj(false);return;}
    if(e.key==='x'&&vpeState.selectedId){e.preventDefault();_vpeCopyObj(true);return;}
    if(e.key==='v'&&_vpeClipboard){e.preventDefault();_vpePasteObj();return;}
  }
  const hasSelection=vpeState.selectedId||(vpeState.selectedIds&&vpeState.selectedIds.length);
  if(!hasSelection || !vpeState.slot) return;
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if(activeTag==='INPUT'||activeTag==='TEXTAREA'||activeTag==='SELECT') return;
  if(document.activeElement && document.activeElement.contentEditable==='true') return;
  /* Delete/Backspace — 다중 선택 포함 */
  if(e.key==='Delete'||e.key==='Backspace'){
    e.preventDefault(); vpeDeleteObj(); return;
  }
  if(e.key==='Escape'){vpeDeselectAll();return;}
  const obj = vpeGetObj(vpeState.selectedId);
  if(!obj) return;
  const step = e.shiftKey ? 10 : 1;
  switch(e.key){
    case 'ArrowLeft': e.preventDefault(); obj.x = Math.max(0, obj.x-step); break;
    case 'ArrowRight': e.preventDefault(); obj.x += step; break;
    case 'ArrowUp': e.preventDefault(); obj.y = Math.max(0, obj.y-step); break;
    case 'ArrowDown': e.preventDefault(); obj.y += step; break;
    default: return;
  }
  const el = document.querySelector('.vpe-obj[data-obj-id="'+obj.id+'"]');
  if(el){ el.style.left=obj.x+'px'; el.style.top=obj.y+'px'; }
  vpeEditorAutoSave();
});

/* ── 줌 라벨 클릭 → 숫자 직접 입력 (공통) ── */
export function _zoomLabelClick(el,setter){
  const cur=parseInt(el.textContent)||100;
  const input=document.createElement('input');
  input.type='number';input.min=25;input.max=300;input.value=cur;
  input.style.cssText='width:44px;height:18px;font-size:10px;font-weight:700;text-align:center;border:1px solid var(--cyan);border-radius:3px;background:var(--card);color:var(--t1);padding:0 2px;font-family:var(--f);outline:none';
  el.textContent='';el.appendChild(input);
  input.focus();input.select();
  function apply(){
    const v=Math.max(25,Math.min(300,parseInt(input.value)||100));
    el.textContent=v+'%';
    setter(v);
  }
  input.addEventListener('blur',apply);
  input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();input.blur();}if(e.key==='Escape'){el.textContent=cur+'%';input.remove();}});
}

/* ── 캔버스 확대/축소 ── */
let _vpeZoom=76;
export function vpeZoomSet(pct){
  _vpeZoom=Math.max(25,Math.min(300,pct));
  const canvas=document.getElementById('vpeCanvas');
  if(canvas){
    canvas.style.transform='scale('+(_vpeZoom/100)+')';
    canvas.style.transformOrigin='top left';
  }
  const slider=document.getElementById('vpeZoomSlider');if(slider)slider.value=_vpeZoom;
  const label=document.getElementById('vpeZoomLabel');if(label&&!label.querySelector('input'))label.textContent=_vpeZoom+'%';
  /* 맞춤 이하이면 스크롤 숨기고, 초과하면 스크롤 보이기 */
  const scroll=document.getElementById('vpeCanvasScroll');
  if(scroll){
    const threshold=vpState.paper==='a4'?76:_vpeCalcFitPct();
    scroll.style.overflow=_vpeZoom<=threshold?'hidden':'auto';
  }
  setTimeout(vpeDrawRulers,50);
}
function _vpeCalcFitPct(){
  const scroll=document.getElementById('vpeCanvasScroll');
  const canvas=document.getElementById('vpeCanvas');
  if(!scroll||!canvas)return 76;
  const areaW=scroll.clientWidth-20, areaH=scroll.clientHeight-20;
  const cw=canvas.offsetWidth/(_vpeZoom/100), ch=canvas.offsetHeight/(_vpeZoom/100);
  return Math.round(Math.min(areaW/cw,areaH/ch)*100);
}
export function vpeZoomFit(){
  /* A4: 76% 고정, 그 외: 자동 계산 */
  if(vpState.paper==='a4'){
    vpeZoomSet(76);
  } else {
    const fit=_vpeCalcFitPct();
    vpeZoomSet(Math.max(25,Math.min(300,fit)));
  }
}
export function _vpeZoomSliderWheel(e){e.preventDefault();vpeZoomSet(_vpeZoom+(e.deltaY>0?-5:5));}
/* Ctrl+마우스 휠로 확대/축소 */
setTimeout(function(){
  const wrap=document.getElementById('vpeCanvasScroll');
  if(!wrap)return;
  wrap.addEventListener('wheel',function(e){
    if(!e.ctrlKey&&!e.metaKey)return;
    e.preventDefault();
    const d=e.deltaY<0?10:-10;
    vpeZoomSet(_vpeZoom+d);
  },{passive:false});
},100);

/* 캔버스 영역 드래그 → 범위 선택 (캔버스 바깥에서 시작해도 동작) */
const _vpeMarquee={active:false,el:null,startX:0,startY:0};
function _vpeEnsureMarquee(){
  if(!_vpeMarquee.el||!document.body.contains(_vpeMarquee.el)){
    const m=document.createElement('div');
    m.style.cssText='position:fixed;border:1.5px solid rgba(6,182,212,0.6);background:rgba(6,182,212,0.08);pointer-events:none;z-index:10000;display:none;border-radius:2px';
    document.body.appendChild(m);
    _vpeMarquee.el=m;
  }
  return _vpeMarquee.el;
}
setTimeout(function(){
  const wrap=document.getElementById('vpeCanvasScroll');
  if(!wrap)return;
  wrap.addEventListener('mousedown',function(e){
    /* 객체/핸들/셀 위 클릭이면 무시 */
    let t=e.target;
    while(t&&t!==wrap){
      if(t.classList&&(t.classList.contains('vpe-obj')||t.classList.contains('vpe-handle')))return;
      if(t.tagName==='TD'&&t.contentEditable==='true')return;
      t=t.parentElement;
    }
    vpeDeselectAll();
    _vpeMarquee.startX=e.clientX;
    _vpeMarquee.startY=e.clientY;
    _vpeMarquee.active=true;
    const m=_vpeEnsureMarquee();
    if(m)m.style.display='none';
    e.preventDefault();
  });
},100);
document.addEventListener('mousemove',function(e){
  if(!_vpeMarquee.active)return;
  const x1=Math.min(_vpeMarquee.startX,e.clientX), y1=Math.min(_vpeMarquee.startY,e.clientY);
  const x2=Math.max(_vpeMarquee.startX,e.clientX), y2=Math.max(_vpeMarquee.startY,e.clientY);
  const m=_vpeEnsureMarquee();
  if(m){m.style.display='block';m.style.left=x1+'px';m.style.top=y1+'px';m.style.width=(x2-x1)+'px';m.style.height=(y2-y1)+'px';}
});
document.addEventListener('mouseup',function(){
  if(!_vpeMarquee.active)return;
  _vpeMarquee.active=false;
  const m=_vpeMarquee.el;
  if(!m)return;
  const mRect={left:parseInt(m.style.left),top:parseInt(m.style.top),w:parseInt(m.style.width)||0,h:parseInt(m.style.height)||0};
  m.style.display='none';
  if(mRect.w<5&&mRect.h<5)return;
  /* 화면 좌표 → 캔버스 좌표로 변환 */
  const canvas=document.getElementById('vpeCanvas');
  if(!canvas)return;
  const cr=canvas.getBoundingClientRect();
  const zoomScale=(_vpeZoom||100)/100;
  const selL=(mRect.left-cr.left)/zoomScale, selT=(mRect.top-cr.top)/zoomScale;
  const selR=selL+mRect.w/zoomScale, selB=selT+mRect.h/zoomScale;
  /* 범위에 걸치는 모든 객체 선택 */
  const found=[];
  vpeState.objects.forEach(function(obj){
    const ox=obj.x, oy=obj.y, ow=obj.w, oh=obj.h||30;
    if(ox+ow>selL&&ox<selR&&oy+oh>selT&&oy<selB){
      found.push(obj.id);
    }
  });
  if(found.length) vpeSelectMultiple(found);
});

/* ── 눈금자 (cm 단위, 용지 크기 기반) ── */
function _vpeGetPaperMm(){
  const isA4=vpState.paper==='a4';
  if(isA4&&vpState.orientation==='landscape') return {w:297,h:210};
  if(isA4) return {w:210,h:297};
  return {w:76.2,h:500}; /* 3인치 롤 */
}
function vpeDrawRulers(){
  const canvas=document.getElementById('vpeCanvas');
  if(!canvas)return;
  const scroll=document.getElementById('vpeCanvasScroll');if(!scroll)return;
  const zoom=(_vpeZoom||100)/100;
  /* 화면상 캔버스 위치 직접 측정 */
  const canvasRect=canvas.getBoundingClientRect();
  const scrollRect=scroll.getBoundingClientRect();
  const ox=canvasRect.left-scrollRect.left;
  const oy=canvasRect.top-scrollRect.top;
  /* 용지 mm 크기 → 화면상 1mm = 몇 px */
  const paper=_vpeGetPaperMm();
  const screenPxPerMm=canvasRect.width/paper.w;
  const clr=getComputedStyle(document.documentElement).getPropertyValue('--t3')||'#888';
  const accentClr='#06b6d4';
  const dpr=window.devicePixelRatio||1;
  /* ── 상단 눈금자 ── */
  const topC=document.getElementById('vpeRulerTopC');if(!topC)return;
  const topW=scroll.clientWidth;
  topC.style.width=topW+'px';topC.style.height='24px';
  topC.width=Math.round(topW*dpr);topC.height=Math.round(24*dpr);
  const ctx=topC.getContext('2d');ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,topW,24);
  ctx.font='8px sans-serif';ctx.textBaseline='top';
  const maxCmX=Math.ceil(paper.w/10)+1;
  for(let cm=0;cm<=maxCmX;cm++){
    const px=ox+cm*10*screenPxPerMm;
    if(px<-20||px>topW+20)continue;
    ctx.fillStyle=cm%5===0?accentClr:clr;
    ctx.fillRect(Math.round(px),12,1,12);
    if(cm>0)ctx.fillText(cm+'cm',Math.round(px)+2,1);
    if(screenPxPerMm>3){
      ctx.fillStyle='rgba(150,150,150,0.35)';
      for(let mm=1;mm<10;mm++){
        const mpx=ox+(cm*10+mm)*screenPxPerMm;
        if(mpx>0&&mpx<topW)ctx.fillRect(Math.round(mpx),mm===5?16:19,1,mm===5?8:5);
      }
    }
  }
  /* ── 왼쪽 눈금자 ── */
  const leftC=document.getElementById('vpeRulerLeftC');if(!leftC)return;
  const leftH=scroll.clientHeight;
  leftC.style.width='24px';leftC.style.height=leftH+'px';
  leftC.width=Math.round(24*dpr);leftC.height=Math.round(leftH*dpr);
  const ctx2=leftC.getContext('2d');ctx2.scale(dpr,dpr);
  ctx2.clearRect(0,0,24,leftH);
  ctx2.font='8px sans-serif';ctx2.textBaseline='middle';
  const maxCmY=Math.ceil(paper.h/10)+1;
  for(let cm2=0;cm2<=maxCmY;cm2++){
    const py=oy+cm2*10*screenPxPerMm;
    if(py<-20||py>leftH+20)continue;
    ctx2.fillStyle=cm2%5===0?accentClr:clr;
    ctx2.fillRect(12,Math.round(py),12,1);
    if(cm2>0){ctx2.save();ctx2.translate(10,Math.round(py)+2);ctx2.rotate(-Math.PI/2);ctx2.textBaseline='bottom';ctx2.fillText(cm2+'cm',0,0);ctx2.restore();}
    if(screenPxPerMm>3){
      ctx2.fillStyle='rgba(150,150,150,0.35)';
      for(let mm2=1;mm2<10;mm2++){
        const mpy=oy+(cm2*10+mm2)*screenPxPerMm;
        if(mpy>0&&mpy<leftH)ctx2.fillRect(mm2===5?16:19,Math.round(mpy),mm2===5?8:5,1);
      }
    }
  }
}
setTimeout(vpeDrawRulers,300);
const _vpeRulerObs=new MutationObserver(function(){setTimeout(vpeDrawRulers,50);});
setTimeout(function(){
  const c=document.getElementById('vpeCanvas');
  if(c)_vpeRulerObs.observe(c,{childList:true,subtree:true,attributes:true});
  const s=document.getElementById('vpeCanvasScroll');
  if(s)s.addEventListener('scroll',vpeDrawRulers);
},200);

export function vpeAddObject(type){
  const canvas = document.getElementById('vpeCanvas');
  if(_vpeModel){
    const obj2 = _vpeModel.createObject(vpeState, type, canvas.offsetWidth);
    vpeRenderObj(obj2, canvas);
    vpeSelectObject(obj2.id);
    vpeUpdateObjInfo();
    vpeEditorAutoSave();
    return;
  }
  const cw = canvas.offsetWidth;
  const defaults = {
    textbox: {w:180,h:36,content:'텍스트를 입력하세요.'},
    line: {w:200,h:4},
    rect: {w:120,h:80},
    circle: {w:80,h:80},
    signature: {w:160,h:60},
    datefield: {w:140,h:32}
  };
  const d = defaults[type] || {w:100,h:40};
  const obj = {
    id: 'obj_' + (vpeState.nextId++),
    type: type,
    x: Math.max(10, Math.floor((cw - d.w)/2)),
    y: 20 + vpeState.objects.length * 10,
    w: d.w,
    h: d.h,
    z: vpeState.objects.length + 1,
    style: {
      fontSize: 12,
      fontFamily: "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      color: '#000000',
      textAlign: 'left',
      bgColor: 'transparent',
      borderColor: '#000000',
      borderWidth: 1
    },
    content: d.content || ''
  };
  vpeState.objects.push(obj);
  vpeRenderObj(obj, canvas);
  vpeSelectObject(obj.id);
  vpeUpdateObjInfo();
  vpeEditorAutoSave();
}

export function vpeAddTable(){
  const ov=document.createElement('div');ov.className='modal-overlay show';ov.style.zIndex='10000';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  ov.innerHTML='<div class="modal-content" style="width:280px;padding:20px">'
    +'<div style="font-size:14px;font-weight:800;margin-bottom:14px;color:var(--t1)">📊 표 삽입</div>'
    +'<div style="display:flex;gap:12px;margin-bottom:14px">'
    +'<div style="flex:1"><label style="font-size:11px;font-weight:700;color:var(--t2)">행 수</label><input id="vpeTableRows" type="number" min="1" max="20" value="3" class="form-input" style="width:100%;margin-top:4px;font-size:13px;padding:8px"></div>'
    +'<div style="flex:1"><label style="font-size:11px;font-weight:700;color:var(--t2)">열 수</label><input id="vpeTableCols" type="number" min="1" max="20" value="3" class="form-input" style="width:100%;margin-top:4px;font-size:13px;padding:8px"></div></div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end">'
    +'<button data-action="cancel" style="padding:8px 16px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t2);font-size:12px;font-weight:600;cursor:pointer">취소</button>'
    +'<button data-action="insert" style="padding:8px 16px;border:none;border-radius:6px;background:var(--cyan);color:#fff;font-size:12px;font-weight:700;cursor:pointer">삽입</button></div></div>';
  document.body.appendChild(ov);
  ov.querySelector('[data-action="cancel"]').addEventListener('click',function(){closeModalGracefully(this.closest('.modal-overlay'));});
  ov.querySelector('[data-action="insert"]').addEventListener('click',function(){vpeDoAddTable();});
  setTimeout(function(){document.getElementById('vpeTableRows').focus();},50);
}
function vpeDoAddTable(){
  const rows=Math.max(1,Math.min(20,parseInt(document.getElementById('vpeTableRows').value)||3));
  const cols=Math.max(1,Math.min(20,parseInt(document.getElementById('vpeTableCols').value)||3));
  const ov=document.querySelector('.modal-overlay[style*="z-index"]');if(ov)closeModalGracefully(ov);
  const canvas = document.getElementById('vpeCanvas');
  if(_vpeModel){
    const obj2 = _vpeModel.createTableObject(vpeState, rows, cols, canvas.offsetWidth);
    vpeRenderObj(obj2, canvas);
    vpeSelectObject(obj2.id);
    vpeUpdateObjInfo();
    vpeEditorAutoSave();
    return;
  }
  const cw = canvas.offsetWidth;
  const w = Math.min(cw - 20, cols * 70);
  const h = 0;
  const cells = [];
  for(let i=0; i<rows*cols; i++) cells.push({text:'', bg:''});
  const obj = {
    id: 'obj_' + (vpeState.nextId++),
    type: 'table',
    x: Math.max(10, Math.floor((cw - w)/2)),
    y: 20 + vpeState.objects.length * 10,
    w: w,
    h: h,
    z: vpeState.objects.length + 1,
    style: {
      fontSize: 11,
      fontFamily: "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      color: '#000000',
      textAlign: 'left',
      bgColor: 'transparent',
      borderColor: '#aaaaaa',
      borderWidth: 1
    },
    content: '',
    tableData: {rows:rows, cols:cols, cells:cells}
  };
  vpeState.objects.push(obj);
  vpeRenderObj(obj, canvas);
  vpeSelectObject(obj.id);
  vpeUpdateObjInfo();
  vpeEditorAutoSave();
}

export function vpeInsertDynField(fieldKey){
  const canvas = document.getElementById('vpeCanvas');
  if(_vpeModel){
    const obj2 = _vpeModel.createDynFieldObject(vpeState, fieldKey, canvas.offsetWidth);
    vpeRenderObj(obj2, canvas);
    vpeSelectObject(obj2.id);
    vpeUpdateObjInfo();
    vpeEditorAutoSave();
    vpeDynMenuToggle(true);
    return;
  }
  const cw = canvas.offsetWidth;
  const obj = {
    id: 'obj_' + (vpeState.nextId++),
    type: 'dynfield',
    x: Math.max(10, Math.floor((cw - 120)/2)),
    y: 20 + vpeState.objects.length * 10,
    w: 120,
    h: 26,
    z: vpeState.objects.length + 1,
    style: {fontSize:12,fontFamily:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",fontWeight:'bold',fontStyle:'normal',textDecoration:'none',color:'#0e7490',textAlign:'center',bgColor:'transparent',borderColor:'transparent',borderWidth:0},
    content: fieldKey
  };
  vpeState.objects.push(obj);
  vpeRenderObj(obj, canvas);
  vpeSelectObject(obj.id);
  vpeUpdateObjInfo();
  vpeEditorAutoSave();
  vpeDynMenuToggle(true);
}

export function vpeDynMenuToggle(forceClose){
  const menu = document.getElementById('vpeDynMenu');
  if(forceClose || menu.classList.contains('show')) menu.classList.remove('show');
  else menu.classList.add('show');
}
document.addEventListener('click', function(e){
  const menu = document.getElementById('vpeDynMenu');
  if(menu && !e.target.closest('.vpe-dynfield-wrap')) menu.classList.remove('show');
});

export function vpeCopyObj(){
  if(_vpeModel){
    const clone = _vpeModel.copySelectedObject(vpeState);
    if(!clone) return;
    const canvas = document.getElementById('vpeCanvas');
    vpeRenderObj(clone, canvas);
    vpeSelectObject(clone.id);
    vpeUpdateObjInfo();
    vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const orig = vpeGetObj(vpeState.selectedId);
  if(!orig) return;
  const clone = JSON.parse(JSON.stringify(orig));
  clone.id = 'obj_' + (vpeState.nextId++);
  clone.x += 15;
  clone.y += 15;
  clone.z = vpeState.objects.length + 1;
  vpeState.objects.push(clone);
  const canvas = document.getElementById('vpeCanvas');
  vpeRenderObj(clone, canvas);
  vpeSelectObject(clone.id);
  vpeUpdateObjInfo();
  vpeEditorAutoSave();
}

export function vpeDeleteObj(){
  if(_vpeModel){
    const ids = _vpeModel.deleteSelectedObjects(vpeState);
    if(!ids.length) return;
    ids.forEach(function(id){const el=document.querySelector('.vpe-obj[data-obj-id="'+id+'"]');if(el)el.remove();});
    vpeDeselectAll();
    vpeUpdateObjInfo();
    vpeEditorAutoSave();
    return;
  }
  const ids=vpeState.selectedIds&&vpeState.selectedIds.length?vpeState.selectedIds:(vpeState.selectedId?[vpeState.selectedId]:[]);
  if(!ids.length)return;
  vpeState.objects=vpeState.objects.filter(function(o){return ids.indexOf(o.id)===-1;});
  ids.forEach(function(id){const el=document.querySelector('.vpe-obj[data-obj-id="'+id+'"]');if(el)el.remove();});
  vpeDeselectAll();
  vpeUpdateObjInfo();
  vpeEditorAutoSave();
}

/* ── 객체 복사/잘라내기/붙여넣기 ── */
let _vpeClipboard=null;
function _vpeCopyObj(cut){
  const obj=vpeGetObj(vpeState.selectedId);if(!obj)return;
  _vpeClipboard=JSON.parse(JSON.stringify(obj));
  if(cut){
    vpePushUndo();
    vpeState.objects=vpeState.objects.filter(function(o){return o.id!==obj.id;});
    const el=document.querySelector('.vpe-obj[data-obj-id="'+obj.id+'"]');if(el)el.remove();
    vpeDeselectAll();vpeUpdateObjInfo();vpeEditorAutoSave();
  }
}
function _vpePasteObj(){
  if(!_vpeClipboard)return;
  vpePushUndo();
  const clone=JSON.parse(JSON.stringify(_vpeClipboard));
  clone.id='obj_'+(vpeState.nextId++);
  clone.x=(clone.x||0)+15;clone.y=(clone.y||0)+15;
  vpeState.objects.push(clone);
  vpeEditorRender();
  vpeSelectObject(clone.id);
  vpeUpdateObjInfo();vpeEditorAutoSave();
}

export function vpeZOrder(dir){
  if(_vpeModel){
    const ok = _vpeModel.adjustZOrder(vpeState, dir);
    if(!ok) return;
    vpeEditorRender();vpeSelectObject(vpeState.selectedId);vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const obj = vpeGetObj(vpeState.selectedId);
  if(!obj) return;
  obj.z = Math.max(1, obj.z + dir);
  vpeEditorRender();vpeSelectObject(vpeState.selectedId);vpeEditorAutoSave();
}
export function vpeZOrderMax(){
  if(_vpeModel){
    const ok = _vpeModel.bringToFront(vpeState);
    if(!ok) return;
    vpeEditorRender();vpeSelectObject(vpeState.selectedId);vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const obj=vpeGetObj(vpeState.selectedId);if(!obj) return;
  let maxZ=1;vpeState.objects.forEach(function(o){if(o.z>maxZ)maxZ=o.z;});
  obj.z=maxZ+1;
  vpeEditorRender();vpeSelectObject(vpeState.selectedId);vpeEditorAutoSave();
}
export function vpeZOrderMin(){
  if(_vpeModel){
    const ok = _vpeModel.sendToBack(vpeState);
    if(!ok) return;
    vpeEditorRender();vpeSelectObject(vpeState.selectedId);vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const obj=vpeGetObj(vpeState.selectedId);if(!obj) return;
  vpeState.objects.forEach(function(o){if(o.z>0)o.z++;});
  obj.z=1;
  vpeEditorRender();vpeSelectObject(vpeState.selectedId);vpeEditorAutoSave();
}
export function vpeAlign(dir){
  if(_vpeModel){
    const canvas2=document.getElementById('vpeCanvas');if(!canvas2) return;
    const ok = _vpeModel.alignSelectedObject(vpeState, dir, canvas2.offsetWidth, canvas2.offsetHeight);
    if(!ok) return;
    const el2=document.querySelector('.vpe-obj[data-obj-id="'+vpeState.selectedId+'"]');
    const obj2=_vpeModel.getSelectedObject(vpeState);
    if(el2&&obj2){el2.style.left=obj2.x+'px';el2.style.top=obj2.y+'px';}
    vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const obj=vpeGetObj(vpeState.selectedId);if(!obj) return;
  const canvas=document.getElementById('vpeCanvas');if(!canvas) return;
  const cw=canvas.offsetWidth, ch=canvas.offsetHeight;
  if(dir==='top') obj.y=0;
  else if(dir==='left') obj.x=0;
  else if(dir==='centerH') obj.x=Math.round((cw-obj.w)/2);
  else if(dir==='centerV') obj.y=Math.round((ch-obj.h)/2);
  else if(dir==='right') obj.x=cw-obj.w;
  else if(dir==='bottom') obj.y=ch-obj.h;
  const el=document.querySelector('.vpe-obj[data-obj-id="'+obj.id+'"]');
  if(el){el.style.left=obj.x+'px';el.style.top=obj.y+'px';}
  vpeEditorAutoSave();
}

export function vpeResetEditor(){
  if(!vpeState.slot) return;
  if(!confirm('이 커스텀 템플릿의 모든 객체를 삭제하고 초기화하시겠습니까?')) return;
  localStorage.removeItem('ec_vp_editor_'+vpeState.slot);
  if(window.electronAPI&&window.electronAPI.editorStateDelete)window.electronAPI.editorStateDelete('visit-pass-editor',vpeState.slot).catch(function(){});
  vpeEditorInit(vpeState.slot);
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='초기화 완료';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2500);}
}

function vpeSyncStyleBar(obj){
  const s = obj.style || {};
  document.getElementById('vpeFontFamily').value = s.fontFamily || "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
  const _fs=document.getElementById('vpeFontSize'); if(_fs) _fs.value = parseInt(s.fontSize) || 12;
  document.getElementById('vpeBold').classList.toggle('on', s.fontWeight==='bold');
  document.getElementById('vpeItalic').classList.toggle('on', s.fontStyle==='italic');
  document.getElementById('vpeUnderline').classList.toggle('on', s.textDecoration==='underline');
  document.getElementById('vpeAlignL').classList.toggle('on', s.textAlign==='left'||!s.textAlign);
  document.getElementById('vpeAlignC').classList.toggle('on', s.textAlign==='center');
  document.getElementById('vpeAlignR').classList.toggle('on', s.textAlign==='right');
  document.getElementById('vpeColorPreview').style.background = s.color && s.color.startsWith('#') ? s.color : '#000000';
  document.getElementById('vpeBgColorPreview').style.background = s.bgColor && s.bgColor!=='transparent' && s.bgColor.startsWith('#') ? s.bgColor : '#ffffff';
  /* 글상자/표: 배경색 숨김 */
  const hideBg=(obj.type==='textbox'||obj.type==='table');
  document.getElementById('vpeBgLabel').style.display=hideBg?'none':'';
  document.getElementById('vpeBgColorBtn').style.display=hideBg?'none':'';
  /* 표: 테두리 도구 토글 */
  const isTable=(obj.type==='table');
  const tblSep=document.getElementById('vpeTblBorderSep');if(tblSep)tblSep.style.display=isTable?'':'none';
  const tblWrap=document.getElementById('vpeTblBorderWrap');if(tblWrap)tblWrap.classList.toggle('show',isTable);
  /* 선/사각형/원 굵기·색 UI 토글 */
  const isShape=(obj.type==='line'||obj.type==='rect'||obj.type==='circle');
  document.getElementById('vpeBorderSep').style.display=isShape?'':'none';
  document.getElementById('vpeBorderLabel').style.display=isShape?'':'none';
  document.getElementById('vpeBorderWidth').style.display=isShape?'':'none';
  document.getElementById('vpeBorderColorLabel').style.display=isShape?'':'none';
  document.getElementById('vpeBorderColorBtn').style.display=isShape?'':'none';
  if(isShape){
    document.getElementById('vpeBorderWidth').value=s.borderWidth||1;
    document.getElementById('vpeBorderColorPreview').style.background=s.borderColor&&s.borderColor.startsWith('#')?s.borderColor:'#000000';
  }
  /* 도형 선택 시 텍스트 도구(글꼴/크기/굵기/기울임/밑줄/정렬/글자색) 비활성화 */
  const textTools=['vpeFontFamily','vpeFontSize','vpeBold','vpeItalic','vpeUnderline','vpeAlignL','vpeAlignC','vpeAlignR','vpeColorBtn'];
  textTools.forEach(function(tid){
    const el=document.getElementById(tid);if(!el)return;
    if(isShape){el.style.opacity='0.3';el.style.pointerEvents='none';}
    else{el.style.opacity='';el.style.pointerEvents='';}
  });
}

function _vpeEnsureStyle(obj){
  if(_vpeModel) return _vpeModel.ensureStyle(obj);
  if(!obj.style) obj.style={fontSize:12,fontFamily:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000000',textAlign:'left',bgColor:'transparent',borderColor:'#000000',borderWidth:1};
  return obj.style;
}
/* ── Color palette ── */
const _vpePaletteColors=[
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#ffffff',
  '#980000','#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff',
  '#9900ff','#ff00ff','#e6b8af','#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3',
  '#c9daf8','#cfe2f3','#d9d2e9','#ead1dc','#dd7e6b','#ea9999','#f9cb9c','#ffe599',
  '#b6d7a8','#a2c4c9','#a4c2f4','#9fc5e8','#b4a7d6','#d5a6bd','#cc4125','#e06666',
  '#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#6fa8dc','#8e7cc3','#c27ba0'
];
function _vpeInitPalette(gridId, styleProp){
  const grid=document.getElementById(gridId);if(!grid)return;
  grid.innerHTML='';
  _vpePaletteColors.forEach(function(c){
    const cell=document.createElement('div');
    cell.className='vpe-color-cell';
    cell.style.background=c;
    cell.title=c;
    cell.addEventListener('click',function(e){
      e.stopPropagation();
      vpeUpdateStyle(styleProp,c);
      _vpeCloseAllPalettes();
    });
    grid.appendChild(cell);
  });
}
export function vpeTogglePalette(prop, btn){
  const drop=btn.querySelector('.vpe-color-dropdown');
  if(!drop) return;
  const wasOpen=drop.classList.contains('show');
  _vpeCloseAllPalettes();
  if(!wasOpen) drop.classList.add('show');
}
function _vpeCloseAllPalettes(){
  document.querySelectorAll('.vpe-color-dropdown.show').forEach(function(d){d.classList.remove('show');});
}
let _vpeCellBgColor='#ffffff';
function _vpeInitCellBgPalette(){
  const grid=document.getElementById('vpeCellBgGrid');if(!grid)return;
  grid.innerHTML='';
  _vpePaletteColors.forEach(function(c){
    const cell=document.createElement('div');
    cell.className='vpe-color-cell';
    cell.style.background=c;
    cell.title=c;
    cell.addEventListener('click',function(e){e.stopPropagation();vpeCellBgApply(c);_vpeCloseAllPalettes();});
    grid.appendChild(cell);
  });
}
function _vpHexToRgba(hex,opacity){
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+(opacity/100)+')';
}
export function vpeCellBgApply(color){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const opSel2=document.getElementById('vpeCellBgOpacity');
    const opacity2=opSel2?parseInt(opSel2.value):100;
    let finalColor2='';
    if(color!=='transparent'&&color) finalColor2=(opacity2<100)?_vpHexToRgba(color,opacity2):color;
    const ok2=_vpeModel.applyCellBackground(vpeState,_vpeSelStart,_vpeSelEnd,finalColor2);
    if(!ok2)return;
    if(color!=='transparent'){_vpeCellBgColor=color;const prev2=document.getElementById('vpeCellBgPreview');if(prev2)prev2.style.background=finalColor2||color;}
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table'||!obj.tableData)return;
  const td=obj.tableData;
  const opSel=document.getElementById('vpeCellBgOpacity');
  const opacity=opSel?parseInt(opSel.value):100;
  let finalColor='';
  if(color!=='transparent'&&color){
    finalColor=(opacity<100)?_vpHexToRgba(color,opacity):color;
  }
  if(_vpeSelStart&&_vpeSelEnd){
    const r1=Math.min(_vpeSelStart.r,_vpeSelEnd.r), r2=Math.max(_vpeSelStart.r,_vpeSelEnd.r);
    const c1=Math.min(_vpeSelStart.c,_vpeSelEnd.c), c2=Math.max(_vpeSelStart.c,_vpeSelEnd.c);
    for(let r=r1;r<=r2;r++){for(let c=c1;c<=c2;c++){const i=r*td.cols+c;if(!td.cells[i])td.cells[i]={text:'',bg:''};td.cells[i].bg=finalColor;}}
  } else {
    for(let i=0;i<td.cells.length;i++){if(!td.cells[i])td.cells[i]={text:'',bg:''};td.cells[i].bg=finalColor;}
  }
  if(color!=='transparent'){_vpeCellBgColor=color;const prev=document.getElementById('vpeCellBgPreview');if(prev)prev.style.background=finalColor||color;}
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
_vpeInitPalette('vpeColorGrid','color');
_vpeInitPalette('vpeBgColorGrid','bgColor');
_vpeInitPalette('vpeBorderColorGrid','borderColor');
_vpeInitCellBgPalette();
_vpeInitTblBorderPalette();
document.addEventListener('click',function(e){
  if(!e.target.closest('.vpe-color-btn')) _vpeCloseAllPalettes();
  if(!e.target.closest('.vpe-tbl-border-wrap')){const d=document.getElementById('vpeTblBorderDrop');if(d)d.classList.remove('show');}
});

/* ── Table Border Tool ── */
let _vpeTblBorderColor='#000000';
function _vpeInitTblBorderPalette(){
  /* 테두리 색상 팔레트 */
  const grid=document.getElementById('vpeTblBorderColorGrid');if(!grid)return;
  grid.innerHTML='';
  _vpePaletteColors.forEach(function(c){
    const cell=document.createElement('div');
    cell.className='vpe-color-cell';
    cell.style.background=c;
    cell.title=c;
    cell.addEventListener('click',function(e){
      e.stopPropagation();
      _vpeTblBorderColor=c;
      document.getElementById('vpeTblBorderColorPreview').style.background=c;
      _vpeCloseAllPalettes();
    });
    grid.appendChild(cell);
  });
  /* 테두리 위치 버튼 생성 */
  const bGrid=document.getElementById('vpeTblBorderGrid');if(!bGrid)return;
  const items=[
    {id:'all',label:'모든 테두리',lines:['t','b','l','r','h','v']},
    {id:'inner',label:'안쪽 테두리',lines:['h','v']},
    {id:'outer',label:'바깥 테두리',lines:['t','b','l','r']},
    {id:'none',label:'테두리 없음',lines:[]},
    {id:'thick-outer',label:'굵은 바깥선',lines:['T','B','L','R']},
    {id:'bottom',label:'아래쪽',lines:['b']},
    {id:'top',label:'위쪽',lines:['t']},
    {id:'left',label:'왼쪽',lines:['l']},
    {id:'right',label:'오른쪽',lines:['r']},
    {id:'horiz',label:'가로 안쪽',lines:['h']}
  ];
  items.forEach(function(it){
    const btn=document.createElement('button');
    btn.className='vpe-tbl-border-item';
    btn.title=it.label;
    btn.addEventListener('click',function(){vpeTblApplyBorder(it.id);});
    /* SVG 아이콘 */
    let s='<svg viewBox="0 0 24 24">';
    const has=function(k){return it.lines.indexOf(k)>=0||it.lines.indexOf(k.toUpperCase())>=0;};
    const cls=function(k){return has(k)?'bdr-active':'';};
    s+='<rect x="2" y="2" width="20" height="20" stroke="#ddd" stroke-width="0.5" fill="none"/>';
    s+='<line x1="2" y1="2" x2="22" y2="2" class="'+cls('t')+'" stroke-width="'+(it.lines.indexOf('T')>=0?'3':'1')+'"/>';
    s+='<line x1="2" y1="22" x2="22" y2="22" class="'+cls('b')+'" stroke-width="'+(it.lines.indexOf('B')>=0?'3':'1')+'"/>';
    s+='<line x1="2" y1="2" x2="2" y2="22" class="'+cls('l')+'" stroke-width="'+(it.lines.indexOf('L')>=0?'3':'1')+'"/>';
    s+='<line x1="22" y1="2" x2="22" y2="22" class="'+cls('r')+'" stroke-width="'+(it.lines.indexOf('R')>=0?'3':'1')+'"/>';
    s+='<line x1="2" y1="12" x2="22" y2="12" class="'+cls('h')+'" stroke-width="1"/>';
    s+='<line x1="12" y1="2" x2="12" y2="22" class="'+cls('v')+'" stroke-width="1"/>';
    s+='</svg>';
    btn.innerHTML=s;
    bGrid.appendChild(btn);
  });
}
export function vpeTblBorderToggle(){
  const d=document.getElementById('vpeTblBorderDrop');
  if(d) d.classList.toggle('show');
}
function vpeTblApplyBorder(mode){
  if(!vpeState.selectedId) return;
  const obj=vpeGetObj(vpeState.selectedId);
  if(!obj||obj.type!=='table') return;
  const el=document.querySelector('.vpe-obj[data-obj-id="'+obj.id+'"]');
  if(!el) return;
  const tbl=el.querySelector('table');
  if(!tbl) return;
  const style=document.getElementById('vpeTblBorderStyle').value||'solid';
  const width=(document.getElementById('vpeTblBorderWidthSel').value||'1')+'px';
  const color=_vpeTblBorderColor||'#000000';
  if(_vpeModel){
    _vpeModel.setTableBorderState(vpeState,mode,style,width,color);
  }
  const bdrStr=width+' '+style+' '+color;
  const noneStr='none';
  const tds=tbl.querySelectorAll('td');
  const rows=tbl.rows;
  const numRows=rows.length;
  tds.forEach(function(td){
    const r=td.parentElement.rowIndex;
    const c=td.cellIndex;
    const isTop=(r===0), isBot=(r===numRows-1);
    const isLeft=(c===0), isRight=(c===td.parentElement.cells.length-1);
    switch(mode){
      case 'all':
        td.style.border=bdrStr;break;
      case 'none':
        td.style.border=noneStr;break;
      case 'outer':
        td.style.borderTop=isTop?bdrStr:noneStr;
        td.style.borderBottom=isBot?bdrStr:noneStr;
        td.style.borderLeft=isLeft?bdrStr:noneStr;
        td.style.borderRight=isRight?bdrStr:noneStr;
        break;
      case 'inner':
        td.style.borderTop=isTop?noneStr:bdrStr;
        td.style.borderBottom=isBot?noneStr:bdrStr;
        td.style.borderLeft=isLeft?noneStr:bdrStr;
        td.style.borderRight=isRight?noneStr:bdrStr;
        break;
      case 'thick-outer':
        const tw=(parseInt(width)||1)+2+'px';const tbdr=tw+' '+style+' '+color;
        td.style.borderTop=isTop?tbdr:'';
        td.style.borderBottom=isBot?tbdr:'';
        td.style.borderLeft=isLeft?tbdr:'';
        td.style.borderRight=isRight?tbdr:'';
        break;
      case 'bottom':
        td.style.borderBottom=isBot?bdrStr:'';break;
      case 'top':
        td.style.borderTop=isTop?bdrStr:'';break;
      case 'left':
        td.style.borderLeft=isLeft?bdrStr:'';break;
      case 'right':
        td.style.borderRight=isRight?bdrStr:'';break;
      case 'horiz':
        td.style.borderTop=(isTop)?'':bdrStr;
        td.style.borderBottom='';
        break;
    }
  });
  /* 데이터 저장 */
  if(!_vpeModel){
    if(!obj.tableBorder) obj.tableBorder={};
    obj.tableBorder.lastMode=mode;
    obj.tableBorder.style=style;
    obj.tableBorder.width=width;
    obj.tableBorder.color=color;
  }
  vpeEditorAutoSave();
}

export function vpeUpdateStyle(prop, val){
  if(_vpeModel){
    const obj2 = _vpeModel.setStyle(vpeState, prop, val);
    if(!obj2) return;
    const el2 = document.querySelector('.vpe-obj[data-obj-id="'+obj2.id+'"]');
    if(el2){
      if(prop==='color'){
        el2.style.color = val;
        el2.querySelectorAll('*').forEach(function(child){ if(child.style.color) child.style.color=''; });
        el2.querySelectorAll('font[color]').forEach(function(f){f.removeAttribute('color');});
      }
      else if(prop==='fontSize') el2.style.fontSize = (parseInt(val)||12)+'px';
      else if(prop==='fontFamily') el2.style.fontFamily = val;
      else if(prop==='fontWeight') el2.style.fontWeight = val;
      else if(prop==='fontStyle') el2.style.fontStyle = val;
      else if(prop==='textDecoration') el2.style.textDecoration = val;
      else if(prop==='textAlign') el2.style.textAlign = val;
      else if(prop==='bgColor'){
        const shapeDiv=el2.querySelector('.vpe-rect-shape,.vpe-circle-shape');
        if(shapeDiv) shapeDiv.style.backgroundColor=val;
        else if(obj2.type!=='line') el2.style.backgroundColor=(val&&val!=='transparent')?val:'';
      }
      else if(prop==='borderColor'){
        const sd=el2.querySelector('.vpe-rect-shape,.vpe-circle-shape,.vpe-line-shape');
        if(sd){if(obj2.type==='line') sd.style.borderTopColor=val; else sd.style.borderColor=val;}
      }
      else if(prop==='borderWidth'){
        const sd2=el2.querySelector('.vpe-rect-shape,.vpe-circle-shape,.vpe-line-shape');
        if(sd2){if(obj2.type==='line') sd2.style.borderTopWidth=val+'px'; else sd2.style.borderWidth=val+'px';}
      }
    }
    vpeSyncStyleBar(obj2);
    vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const obj = vpeGetObj(vpeState.selectedId);
  if(!obj) return;
  _vpeEnsureStyle(obj);
  obj.style[prop] = val;
  const el = document.querySelector('.vpe-obj[data-obj-id="'+obj.id+'"]');
  if(el){
    if(prop==='color'){
      el.style.color = val;
      /* contentEditable에서 생긴 인라인 색상도 제거 (background-color는 보존) */
      el.querySelectorAll('*').forEach(function(child){
        if(child.style.color) child.style.color='';
      });
      el.querySelectorAll('font[color]').forEach(function(f){f.removeAttribute('color');});
    }
    else if(prop==='fontSize') el.style.fontSize = (parseInt(val)||12)+'px';
    else if(prop==='fontFamily') el.style.fontFamily = val;
    else if(prop==='fontWeight') el.style.fontWeight = val;
    else if(prop==='fontStyle') el.style.fontStyle = val;
    else if(prop==='textDecoration') el.style.textDecoration = val;
    else if(prop==='textAlign') el.style.textAlign = val;
    else if(prop==='bgColor'){
      /* 도형: 내부 shape div에 적용 */
      const shapeDiv=el.querySelector('.vpe-rect-shape,.vpe-circle-shape');
      if(shapeDiv) shapeDiv.style.backgroundColor=val;
      else if(obj.type!=='line') el.style.backgroundColor=(val&&val!=='transparent')?val:'';
    }
    else if(prop==='borderColor'){
      const sd=el.querySelector('.vpe-rect-shape,.vpe-circle-shape,.vpe-line-shape');
      if(sd){if(obj.type==='line') sd.style.borderTopColor=val; else sd.style.borderColor=val;}
    }
    else if(prop==='borderWidth'){
      const sd2=el.querySelector('.vpe-rect-shape,.vpe-circle-shape,.vpe-line-shape');
      if(sd2){if(obj.type==='line') sd2.style.borderTopWidth=val+'px'; else sd2.style.borderWidth=val+'px';}
    }
  }
  vpeSyncStyleBar(obj);
  vpeEditorAutoSave();
}

export function vpeToggleStyle(prop, onVal, offVal){
  if(_vpeModel){
    const obj2 = _vpeModel.toggleStyle(vpeState, prop, onVal, offVal);
    if(!obj2) return;
    const el2 = document.querySelector('.vpe-obj[data-obj-id="'+obj2.id+'"]');
    if(el2) el2.style[prop] = obj2.style[prop];
    vpeSyncStyleBar(obj2);
    vpeEditorAutoSave();
    return;
  }
  if(!vpeState.selectedId) return;
  const obj = vpeGetObj(vpeState.selectedId);
  if(!obj) return;
  _vpeEnsureStyle(obj);
  obj.style[prop] = obj.style[prop]===onVal ? offVal : onVal;
  const el = document.querySelector('.vpe-obj[data-obj-id="'+obj.id+'"]');
  if(el) el.style[prop] = obj.style[prop];
  vpeSyncStyleBar(obj);
  vpeEditorAutoSave();
}

/* 셀 선택 및 병합 */
let _vpeSelStart=null,_vpeSelEnd=null,_vpeSelObjId=null,_vpeCellDragging=false;
document.addEventListener('mousemove',function(e){
  if(!_vpeCellDragging||!_vpeSelObjId)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);
  if(!el)return;
  const td=(el.tagName==='TD')?el:(el.closest?el.closest('td'):null);
  if(!td||!td.dataset||td.dataset.row===undefined)return;
  const objEl=td.closest('.vpe-obj');
  if(!objEl||objEl.dataset.objId!==_vpeSelObjId)return;
  const ri=parseInt(td.dataset.row), ci=parseInt(td.dataset.col);
  if(_vpeSelEnd&&_vpeSelEnd.r===ri&&_vpeSelEnd.c===ci)return;
  _vpeSelEnd={r:ri,c:ci};
  _vpeHighlightCells(_vpeSelObjId);
});
document.addEventListener('mouseup',function(){
  if(_vpeCellDragging){
    _vpeCellDragging=false;
    document.querySelectorAll('.vpe-cell-selecting').forEach(function(t){t.classList.remove('vpe-cell-selecting');});
  }
});
function _vpeClearHighlight(){document.querySelectorAll('.vpe-obj table td.selected-cell').forEach(function(td){td.classList.remove('selected-cell');});}
function _vpeHighlightCells(objId){
  _vpeClearHighlight();
  if(!_vpeSelStart||!_vpeSelEnd)return;
  const r1=Math.min(_vpeSelStart.r,_vpeSelEnd.r), r2=Math.max(_vpeSelStart.r,_vpeSelEnd.r);
  const c1=Math.min(_vpeSelStart.c,_vpeSelEnd.c), c2=Math.max(_vpeSelStart.c,_vpeSelEnd.c);
  const el=document.querySelector('.vpe-obj[data-obj-id="'+objId+'"]');
  if(!el)return;
  el.querySelectorAll('table td').forEach(function(td){
    const rr=parseInt(td.dataset.row), cc=parseInt(td.dataset.col);
    if(rr>=r1&&rr<=r2&&cc>=c1&&cc<=c2) td.classList.add('selected-cell');
  });
}
export function vpeMergeCells(){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const ok2=_vpeModel.mergeSelectedCells(vpeState,_vpeSelStart,_vpeSelEnd);
    if(!ok2)return;
    _vpeSelStart=null;_vpeSelEnd=null;
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table'||!_vpeSelStart||!_vpeSelEnd)return;
  const td=obj.tableData;
  const r1=Math.min(_vpeSelStart.r,_vpeSelEnd.r), r2=Math.max(_vpeSelStart.r,_vpeSelEnd.r);
  const c1=Math.min(_vpeSelStart.c,_vpeSelEnd.c), c2=Math.max(_vpeSelStart.c,_vpeSelEnd.c);
  if(r1===r2&&c1===c2)return;
  /* 첫 셀에 rowspan/colspan 설정 */
  const fi=r1*td.cols+c1;
  if(!td.cells[fi])td.cells[fi]={text:'',bg:''};
  td.cells[fi].rowspan=r2-r1+1;
  td.cells[fi].colspan=c2-c1+1;
  /* 나머지 셀은 merged로 표시 */
  for(let r=r1;r<=r2;r++){
    for(let c=c1;c<=c2;c++){
      if(r===r1&&c===c1)continue;
      const idx=r*td.cols+c;
      if(!td.cells[idx])td.cells[idx]={text:'',bg:''};
      td.cells[idx].merged=true;
    }
  }
  _vpeSelStart=null;_vpeSelEnd=null;
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
export function vpeUnmergeCells(){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const ok2=_vpeModel.unmergeSelectedCells(vpeState);
    if(!ok2)return;
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table')return;
  const td=obj.tableData;
  for(let i=0;i<td.cells.length;i++){
    if(td.cells[i]){delete td.cells[i].rowspan;delete td.cells[i].colspan;delete td.cells[i].merged;}
  }
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
export function vpeTableAddRow(dir){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const ok2=_vpeModel.addTableRow(vpeState,dir,_vpeSelStart);
    if(!ok2)return;
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table')return;
  const td=obj.tableData;const row=_vpeSelStart?_vpeSelStart.r:(dir==='above'?0:td.rows-1);
  const newCells=[];for(let i=0;i<td.cols;i++)newCells.push({text:'',bg:''});
  const insertAt=dir==='above'?row*td.cols:(row+1)*td.cols;
  td.cells.splice(insertAt,0,...newCells);td.rows++;obj.h+=28;
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
export function vpeTableAddCol(dir){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const ok2=_vpeModel.addTableCol(vpeState,dir,_vpeSelStart);
    if(!ok2)return;
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table')return;
  const td=obj.tableData;const col=_vpeSelStart?_vpeSelStart.c:(dir==='left'?0:td.cols-1);
  const insertCol=dir==='left'?col:col+1;
  for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+insertCol,0,{text:'',bg:''});
  td.cols++;obj.w+=70;
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
export function vpeTableDelRow(){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const ok2=_vpeModel.deleteTableRow(vpeState,_vpeSelStart);
    if(!ok2)return;
    _vpeSelStart=null;_vpeSelEnd=null;
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table')return;
  const td=obj.tableData;if(td.rows<=1)return;
  const row=_vpeSelStart?_vpeSelStart.r:td.rows-1;
  td.cells.splice(row*td.cols,td.cols);td.rows--;obj.h=Math.max(28,obj.h-28);
  _vpeSelStart=null;_vpeSelEnd=null;
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
export function vpeTableDelCol(){
  if(_vpeModel){
    const sel2=vpeState.selectedId;if(!sel2)return;
    const ok2=_vpeModel.deleteTableCol(vpeState,_vpeSelStart);
    if(!ok2)return;
    _vpeSelStart=null;_vpeSelEnd=null;
    vpeEditorRender();vpeSelectObject(sel2);vpeEditorAutoSave();
    return;
  }
  const sel=vpeState.selectedId;if(!sel)return;
  const obj=vpeGetObj(sel);if(!obj||obj.type!=='table')return;
  const td=obj.tableData;if(td.cols<=1)return;
  const col=_vpeSelStart?_vpeSelStart.c:td.cols-1;
  for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+col,1);
  td.cols--;obj.w=Math.max(70,obj.w-70);
  _vpeSelStart=null;_vpeSelEnd=null;
  vpeEditorRender();vpeSelectObject(sel);vpeEditorAutoSave();
}
function vpeShowTableCtx(e, objId, row, col){
  const existing = document.querySelector('.vpe-ctx-menu');
  if(existing) existing.remove();
  const menu = document.createElement('div');
  menu.className = 'vpe-ctx-menu';
  menu.style.left = e.clientX+'px';
  menu.style.top = e.clientY+'px';
  menu.innerHTML = '<button data-act="addRow">행 추가 (아래)</button><button data-act="addCol">열 추가 (오른쪽)</button><button data-act="delRow">행 삭제</button><button data-act="delCol">열 삭제</button><button data-act="cellBg">셀 배경색</button><button data-act="merge">⊞ 셀 병합</button><button data-act="unmerge">⊟ 병합 해제</button>';
  document.body.appendChild(menu);
  menu.addEventListener('click', function(ev){
    const act = ev.target.dataset.act;
    if(!act) return;
    const obj = vpeGetObj(objId);
    if(!obj || !obj.tableData) return;
    const td = obj.tableData;
    if(_vpeModel){
      vpeState.selectedId=objId;
      const cellSel={r:row,c:col};
      if(act==='addRow') _vpeModel.addTableRow(vpeState,'below',cellSel);
      else if(act==='addCol') _vpeModel.addTableCol(vpeState,'right',cellSel);
      else if(act==='delRow') _vpeModel.deleteTableRow(vpeState,cellSel);
      else if(act==='delCol') _vpeModel.deleteTableCol(vpeState,cellSel);
      else if(act==='cellBg'){
        const color2 = prompt('셀 배경색 (hex):', '#ffffff');
        if(color2) _vpeModel.applySingleCellBackground(vpeState,row,col,color2);
      } else if(act==='merge'){
        vpeMergeCells();
      } else if(act==='unmerge'){
        vpeUnmergeCells();
      }
    } else if(act==='addRow'){
      const newCells = [];
      for(let i=0;i<td.cols;i++) newCells.push({text:'',bg:''});
      td.cells.splice((row+1)*td.cols, 0, ...newCells);
      td.rows++;
      obj.h += 28;
    } else if(act==='addCol'){
      for(let r=td.rows-1;r>=0;r--) td.cells.splice(r*td.cols+col+1, 0, {text:'',bg:''});
      td.cols++;
      obj.w += 70;
    } else if(act==='delRow' && td.rows>1){
      td.cells.splice(row*td.cols, td.cols);
      td.rows--;
      obj.h = Math.max(28, obj.h-28);
    } else if(act==='delCol' && td.cols>1){
      for(let r2=td.rows-1;r2>=0;r2--) td.cells.splice(r2*td.cols+col, 1);
      td.cols--;
      obj.w = Math.max(70, obj.w-70);
    } else if(act==='cellBg'){
      const color = prompt('셀 배경색 (hex):', '#ffffff');
      if(color){
        const ci = row*td.cols+col;
        if(!td.cells[ci]) td.cells[ci]={text:'',bg:''};
        td.cells[ci].bg = color;
      }
    } else if(act==='merge'){
      vpeMergeCells();
    } else if(act==='unmerge'){
      vpeUnmergeCells();
    }
    vpeEditorRender();
    vpeSelectObject(objId);
    vpeEditorAutoSave();
    menu.remove();
  });
  setTimeout(function(){
    document.addEventListener('click', function rmCtx(){ menu.remove(); document.removeEventListener('click', rmCtx); }, {once:true});
  }, 50);
}

function vpeEditorSerialize(){
  if(_vpeStore)return _vpeStore.serialize(vpState,vpeState);
  const d={ paper: vpState.paper, objects: JSON.parse(JSON.stringify(vpeState.objects)) };
  if(vpeState._cutY) d.cutY=vpeState._cutY;
  if(vpeState.pdfBgUrl) d.pdfBgUrl=vpeState.pdfBgUrl;
  if(vpeState.pdfBgFileName) d.pdfBgFileName=vpeState.pdfBgFileName;
  d.bgScale=vpeState.bgScale||100;
  d.bgOffsetY=vpeState.bgOffsetY||0;
  d.bgOffsetX=vpeState.bgOffsetX||0;
  d.marginTop=vpeState.marginTop;d.marginBottom=vpeState.marginBottom;
  d.marginLeft=vpeState.marginLeft;d.marginRight=vpeState.marginRight;
  return d;
}
function vpeEditorDeserialize(data){
  if(_vpeStore){
    _vpeStore.applyToState(data,vpState,vpeState,_vpeEnsureStyle);
    _vpeSyncBgMarginUI();
    return;
  }
  vpeState.objects=data.objects||[];
  vpeState.objects.forEach(function(o){_vpeEnsureStyle(o);});
  vpeState.nextId=Math.max(...vpeState.objects.map(function(o){return parseInt(o.id.replace('obj_',''))||0;}),0)+1;
  vpeState.selectedId=null;
  /* 배경/여백 복원 */
  vpeState.pdfBgUrl=data.pdfBgUrl||null;
  vpeState.pdfBgFileName=data.pdfBgFileName||null;
  vpeState.bgScale=data.bgScale||100;
  vpeState.bgOffsetY=data.bgOffsetY||0;
  vpeState.bgOffsetX=data.bgOffsetX||0;
  vpeState.marginTop=data.marginTop!=null?data.marginTop:7;
  vpeState.marginBottom=data.marginBottom!=null?data.marginBottom:7;
  vpeState.marginLeft=data.marginLeft!=null?data.marginLeft:7;
  vpeState.marginRight=data.marginRight!=null?data.marginRight:7;
  /* UI 동기화 */
  _vpeSyncBgMarginUI();
}
function _vpeSyncBgMarginUI(){
  const zone=document.getElementById('vpeBgUploadZone');
  if(zone){
    if(vpeState.pdfBgUrl){zone.innerHTML='✅ '+(vpeState.pdfBgFileName||'배경');zone.style.borderColor='var(--cyan)';}
    else{zone.innerHTML='📁 PDF / 이미지 업로드<br><span style="font-size:9px">클릭 또는 드래그</span>';zone.style.borderColor='var(--bdr)';}
  }
  const bs=document.getElementById('vpeBgScaleSlider');if(bs)bs.value=vpeState.bgScale;
  const bsv=document.getElementById('vpeBgScaleVal');if(bsv)bsv.textContent=vpeState.bgScale+'%';
  const boy=document.getElementById('vpeBgOffsetYSlider');if(boy)boy.value=vpeState.bgOffsetY;
  const boyv=document.getElementById('vpeBgOffsetYVal');if(boyv)boyv.textContent=vpeState.bgOffsetY+'px';
  const box=document.getElementById('vpeBgOffsetXSlider');if(box)box.value=vpeState.bgOffsetX;
  const boxv=document.getElementById('vpeBgOffsetXVal');if(boxv)boxv.textContent=vpeState.bgOffsetX+'px';
  const mt=document.getElementById('vpeMarginTop');if(mt)mt.value=vpeState.marginTop;
  const mb=document.getElementById('vpeMarginBottom');if(mb)mb.value=vpeState.marginBottom;
  const ml=document.getElementById('vpeMarginLeft');if(ml)ml.value=vpeState.marginLeft;
  const mr=document.getElementById('vpeMarginRight');if(mr)mr.value=vpeState.marginRight;
}

/* Undo 히스토리 */
const _vpeUndoStack=[];
function vpePushUndo(){
  if(!vpeState.slot)return;
  const snap=JSON.stringify(vpeEditorSerialize());
  if(_vpeUndoStack.length>0&&_vpeUndoStack[_vpeUndoStack.length-1]===snap)return;
  _vpeUndoStack.push(snap);
  if(_vpeUndoStack.length>50)_vpeUndoStack.shift();
}
function vpeUndo(){
  if(!_vpeUndoStack.length||!vpeState.slot)return;
  const snap=_vpeUndoStack.pop();
  const data=JSON.parse(snap);
  vpeEditorDeserialize(data);
  if(_vpeStore)_vpeStore.save(vpeState.slot,data);
  else {
    localStorage.setItem('ec_vp_editor_'+vpeState.slot,snap);
    if(window.electronAPI&&window.electronAPI.editorStateSave)window.electronAPI.editorStateSave('visit-pass-editor',vpeState.slot,data).catch(function(){});
  }
  vpeEditorRender();
  const toast=document.getElementById('globalSaveToast');
  if(toast){toast.textContent='되돌림 완료';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2500);}
}
export function vpeEditorAutoSave(immediate,silent){
  if(!vpeState.slot) return;
  vpePushUndo();
  clearTimeout(vpAutoSaveTimer);
  const doSave = function(){
    const data = vpeEditorSerialize();
    if(_vpeStore)_vpeStore.save(vpeState.slot,data);
    else {
      localStorage.setItem('ec_vp_editor_'+vpeState.slot, JSON.stringify(data));
      if(window.electronAPI&&window.electronAPI.editorStateSave)window.electronAPI.editorStateSave('visit-pass-editor',vpeState.slot,data).catch(function(){});
    }
    if(!silent){
      let ind=document.getElementById('vpeSaveInd');
      if(!ind){ind=document.createElement('div');ind.id='vpeSaveInd';ind.className='ec-save-indicator';ind.style.zIndex='10001';document.body.appendChild(ind);}
      ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';ind.style.zIndex='10001';
      setTimeout(function(){ind.className='ec-save-indicator hide';},3000);
    }
  };
  if(immediate) doSave();
  else vpAutoSaveTimer = setTimeout(doSave, 500);
}

function vpeUpdateObjInfo(){
  const info = document.getElementById('vpeObjInfo');
  if(info) info.textContent = '객체 ' + vpeState.objects.length + '개';
}

export function vpResetCustomFormat(){
  if(vpState.format.startsWith('custom') && vpeState.slot){
    vpeResetEditor();
    return;
  }
}

export function vpSetPaper(paper, btn){
  vpState.paper = paper;
  document.querySelectorAll('#vpPaperBar .vp-toggle').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('vpPaperLabel').textContent = paper === 'a4' ? 'A4 용지' : '3인치 영수증';
  const orientRow = document.getElementById('vpOrientRow');
  if(orientRow) orientRow.style.display = paper === 'a4' ? '' : 'none';
  if(paper !== 'a4') vpState.orientation = 'portrait';
  const preview = document.getElementById('vpPreview');
  preview.classList.toggle('vp-preview-a4', paper === 'a4');
  preview.classList.toggle('vp-preview-receipt', paper !== 'a4');
  const canvas = document.getElementById('vpeCanvas');
  if(canvas){
    canvas.className = 'vp-editor-canvas ' + paper;
    if(paper === 'a4' && vpState.orientation === 'landscape'){
      canvas.style.width = '842px'; canvas.style.minHeight = '595px';
    } else if(paper === 'a4'){
      canvas.style.width = ''; canvas.style.minHeight = '';
    }
  }
  if(vpeState.slot) vpeEditorAutoSave();
  vpUpdatePreview();
  if(vpState.format.startsWith('custom')) setTimeout(vpeZoomFit,100);
}

export function vpSetOrientation(orient, btn){
  vpState.orientation = orient;
  document.querySelectorAll('#vpOrientRow .vp-toggle').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const canvas = document.getElementById('vpeCanvas');
  if(canvas && vpState.paper === 'a4'){
    if(orient === 'landscape'){
      canvas.style.width = '842px'; canvas.style.minHeight = '595px';
    } else {
      canvas.style.width = ''; canvas.style.minHeight = '';
    }
  }
  if(vpeState.slot) vpeEditorAutoSave();
  vpUpdatePreview();
  if(vpState.format.startsWith('custom')) setTimeout(vpeZoomFit,100);
}

export function vpToggleContent(field, btn){
  /* 비활성 칩 (예: V/S 값 없을 때) 은 클릭 무시 — title 툴팁만 보여줌. */
  if(btn.classList.contains('vp-disabled')) return;
  /* 증상·처치 통합 칩 — 클릭마다 합침 → 분리 → 끔 → 합침 3단계 순환 (사용자 요청 2026-06-16).
   *  on/off(symptoms·treatment)와 합침/분리 모드(양식별 저장)를 한 칩으로 통합. */
  if(field === 'symtreatCombo'){
    const on = !!(vpState.content.symptoms && vpState.content.treatment);
    const mode = _vpSymTreatMode(vpState.format);
    if(on && mode === 'merge'){
      _vpSetSymTreatMode(vpState.format, 'split');                          /* 합침 → 분리 */
    } else if(on){
      vpState.content.symptoms = false; vpState.content.treatment = false;  /* 분리 → 끔 */
    } else {
      vpState.content.symptoms = true; vpState.content.treatment = true;    /* 끔 → 합침 */
      _vpSetSymTreatMode(vpState.format, 'merge');
    }
    _vpUpdateSymTreatComboChip();
    vpSyncAllToggle();
    vpUpdateContentLabel();
    vpUpdatePreview();
    _vpSaveContentForFormat(vpState.format);   /* 양식별 독립 저장 (2026-06-19) */
    try{ bus.emit('toast:save'); }catch(_){}
    return;
  }
  /* 교사 확인 — 보건·교과·담임 독립 on/off. 셋 모두 켠 순서대로 위→아래(order 배열). 양식별 저장. (사용자 요청 2026-06-20) */
  if(field === 'teacherNurse' || field === 'teacherSubject' || field === 'teacherHomeroom'){
    const key = field==='teacherNurse' ? 'nurse' : (field==='teacherHomeroom' ? 'homeroom' : 'subject');
    const order = _vpTeacherOrder(vpState.format);
    const idx = order.indexOf(key);
    if(idx>=0) order.splice(idx,1);   /* 끔 */
    else order.push(key);             /* 켬 — 가장 뒤에 추가 → 먼저 켠 줄이 위 */
    _vpSetTeacherOrder(vpState.format, order);
    vpState.content.teacherSig = order.length>0;   /* 렌더 호환용 동기값 */
    _vpSaveContentForFormat(vpState.format);
    _vpUpdateTeacherChips();
    vpUpdateContentLabel();
    vpUpdatePreview();
    try{ bus.emit('toast:save'); }catch(_){}
    return;
  }
  vpState.content[field] = !vpState.content[field];
  btn.classList.toggle('on', vpState.content[field]);
  vpSyncAllToggle();
  vpUpdateContentLabel();
  vpUpdatePreview();
  /* 내용 선택 영구 저장 — 양식별 독립(ec_vp_content_by_format). 재시작 후에도 보존 (2026-06-19) */
  _vpSaveContentForFormat(vpState.format);
  try{ bus.emit('toast:save'); }catch(_){}
}

/* 전체 칩 토글 시: 증상·처치는 한 단위로 셈 */
const _VP_CONTENT_GROUPS = [
  ['date'], ['timeIn'], ['timeOut'], ['symptoms','treatment'], ['bodymap']
];
function _vpAllOn(){
  return _VP_CONTENT_GROUPS.every(g => g.every(f => vpState.content[f]));
}

export function vpToggleAll(btn){
  const allOn = _vpAllOn();
  _VP_CONTENT_GROUPS.forEach(g => g.forEach(f => vpState.content[f] = !allOn));
  document.querySelectorAll('#vpContentBar .vp-toggle[data-field]').forEach(b => {
    const f = b.dataset.field;
    if(f === 'all' || f === 'custom') return;
    if(f === 'symtreatCombo'){ _vpUpdateSymTreatComboChip(); return; }   /* 통합 칩은 라벨·상태를 전용 함수로 동기화 */
    if(f === 'teacherNurse'||f === 'teacherSubject'||f === 'teacherHomeroom'){ _vpUpdateTeacherChips(); return; }
    b.classList.toggle('on', vpState.content[f]);
  });
  btn.classList.toggle('on-all', !allOn);
  vpUpdateContentLabel();
  vpUpdatePreview();
  _vpSaveContentForFormat(vpState.format);   /* 전부/없음 토글도 양식별 저장 (2026-06-19) */
  try{ bus.emit('toast:save'); }catch(_){}
}

function vpSyncAllToggle(){
  const allOn = _vpAllOn();
  const allBtn = document.querySelector('#vpContentBar .vp-toggle[data-field="all"]');
  if(allBtn) allBtn.classList.toggle('on-all', allOn);
}

function vpUpdateContentLabel(){
  let active = 0, total = _VP_CONTENT_GROUPS.length;
  _VP_CONTENT_GROUPS.forEach(g => { if(g.every(f => vpState.content[f])) active++; });
  const label = document.getElementById('vpContentLabel');
  if(active === total) label.textContent = '전부';
  else if(active === 0) label.textContent = '없음';
  else label.textContent = active + '개 선택';
}

function vpToggleCustomInput(btn){
  vpState.customInput = false;
  const wrap=document.getElementById('vpCustomInputWrap');
  if(wrap)wrap.style.display='none';
  vpUpdatePreview();
}

export function vpSetSigMode(mode, btn){
  vpState.sigMode = mode;
  localStorage.setItem('ec_vp_sigMode',mode);
  document.querySelectorAll('.vp-sig-opt').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('vpSigLabel').textContent = mode === 'stamp' ? '도장' : '서명';
  const drop = document.getElementById('vpSigDrop');
  drop.classList.toggle('active', mode !== 'none');
  /* 슬롯 표시 — 서명·도장 두 그리드 항상 함께 노출 (각 3칸, 총 6칸 분리 관리). (2026-06-01) */
  const stampSlots=document.getElementById('vpStampSlots');
  const signSlots=document.getElementById('vpSignSlots');
  const _showSlots = mode!=='none';
  if(stampSlots)stampSlots.style.display=_showSlots?'':'none';
  if(signSlots)signSlots.style.display=_showSlots?'':'none';
  /* 모드에 맞는 저장된 이미지 불러오기 — 마지막 선택 슬롯 우선 */
  const stamps=JSON.parse(localStorage.getItem('ec_vp_stamps')||'[]');
  const signs=JSON.parse(localStorage.getItem('ec_vp_signs')||'[]');
  function _lastSlotIdx(type,len){
    const raw=localStorage.getItem('ec_vp_lastSlot_'+type);
    const idx=raw!=null?parseInt(raw,10):0;
    return (idx>=0&&idx<len)?idx:0;
  }
  /* 두 그리드 모두 렌더 (서명·도장 동시 표시), sigImage 는 현재 모드 기준으로 결정 */
  _vpRenderSigSlots('vpStampGrid',stamps,'stamp');
  _vpRenderSigSlots('vpSignGrid',signs,'sign');
  if(mode==='stamp'){
    const idx=_lastSlotIdx('stamp',stamps.length);
    vpState.sigImage=stamps[idx]||stamps[0]||'';
  } else if(mode==='sign'){
    const idx=_lastSlotIdx('sign',signs.length);
    vpState.sigImage=signs[idx]||signs[0]||'';
  } else {
    vpState.sigImage='';
  }
  if(vpState.sigImage) vpShowSigPreview(vpState.sigImage);
  else { const pw=document.getElementById('vpSigPreviewWrap');if(pw)pw.style.display='none';const dt=document.getElementById('vpSigDropText');if(dt)dt.style.display='block'; }
  vpUpdatePreview();
}

/* ── 도장/서명 슬롯 관리 ── */
function _vpRenderSigSlots(gridId,items,type){
  const grid=document.getElementById(gridId);if(!grid)return;
  grid.innerHTML='';
  for(let i=0;i<3;i++){
    const slot=document.createElement('div');
    slot.style.cssText='width:48px;height:48px;border:1.5px '+(items[i]?'solid var(--cyan)':'dashed var(--bdr)')+';border-radius:6px;overflow:visible;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--bg);position:relative;flex-shrink:0';
    if(items[i]){
      slot.innerHTML='<img src="'+items[i]+'" style="max-width:44px;max-height:44px;object-fit:contain;pointer-events:none">'
        +'<div class="vp-sig-slot-rm" data-sig-type="'+escHtml(type)+'" data-sig-idx="'+i+'" style="position:absolute;top:-6px;right:-6px;width:16px;height:16px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,0.2)">✕</div>';
      (function(idx){
        slot.querySelector('.vp-sig-slot-rm').addEventListener('click',function(e){e.stopPropagation();_vpRemoveSigSlot(type,idx);});
        slot.addEventListener('click',function(e){e.stopPropagation();_vpSelectSigSlot(type,idx);});
      })(i);
    } else {
      slot.style.cursor='default';
      slot.innerHTML='<span style="font-size:9px;color:var(--t3)">빈 슬롯</span>';
    }
    grid.appendChild(slot);
  }
  /* 슬롯 상태에 따라 업로드 영역 제어 */
  _vpUpdateSigUploadArea(items.length);
}
function _vpUpdateSigUploadArea(count){
  const drop=document.getElementById('vpSigDrop');
  const dropText=document.getElementById('vpSigDropText');
  const rmBtn=document.getElementById('vpSigRemoveBgBtn');
  if(!drop)return;
  if(count>=3){
    drop.style.opacity='0.4';drop.style.pointerEvents='none';
    if(dropText)dropText.innerHTML='<span style="font-size:10px;color:var(--t3)">슬롯이 3개 다 찼습니다.<br>슬롯의 이미지를 하나 지우면<br>업로드가 활성화됩니다.</span>';
    if(rmBtn){rmBtn.style.opacity='0.4';rmBtn.style.pointerEvents='none';}
  } else {
    drop.style.opacity='';drop.style.pointerEvents='';
    if(dropText&&dropText.textContent.indexOf('슬롯이')>=0)dropText.innerHTML='📁 이미지를 드래그 앤 드랍 또는 클릭<br><span style="font-size:9px;color:var(--t3)">투명 배경 PNG/JPEG 권장</span>';
    if(rmBtn){rmBtn.style.opacity='';rmBtn.style.pointerEvents='';}
  }
}
function _vpSelectSigSlot(type,idx){
  const key=type==='stamp'?'ec_vp_stamps':'ec_vp_signs';
  const items=JSON.parse(localStorage.getItem(key)||'[]');
  if(!items[idx])return;
  vpState.sigImage=items[idx];
  vpState.sigMode=type;   /* 선택한 슬롯의 종류(서명/도장)로 모드 전환 */
  /* 마지막 선택된 슬롯 인덱스 저장 → 다음 실행 시 동일 슬롯 복원 */
  try{localStorage.setItem('ec_vp_lastSlot_'+type,String(idx));localStorage.setItem('ec_vp_sigMode',type);}catch(e){}
  document.querySelectorAll('.vp-sig-opt').forEach(function(b){ b.classList.toggle('active', b.dataset.sig===type); });
  const _lbl=document.getElementById('vpSigLabel'); if(_lbl)_lbl.textContent=type==='stamp'?'도장':'서명';
  vpShowSigPreview(vpState.sigImage);
  vpUpdatePreview();
}
function _vpRemoveSigSlot(type,idx){
  const key=type==='stamp'?'ec_vp_stamps':'ec_vp_signs';
  const items=JSON.parse(localStorage.getItem(key)||'[]');
  items.splice(idx,1);
  _vpPersistVpState(key,items);
  const gridId=type==='stamp'?'vpStampGrid':'vpSignGrid';
  _vpRenderSigSlots(gridId,items,type);
  /* 현재 사용 중인 이미지가 삭제됐으면 첫번째로 교체 */
  if(items.length){vpState.sigImage=items[0];vpShowSigPreview(vpState.sigImage);}
  else{vpState.sigImage='';const pw=document.getElementById('vpSigPreviewWrap');if(pw)pw.style.display='none';const dt=document.getElementById('vpSigDropText');if(dt)dt.style.display='block';}
  vpUpdatePreview();
}
/* ── 그림 추가 ── */
export function vpeAddImage(){
  const input=document.createElement('input');
  input.type='file';input.accept='image/*';
  input.addEventListener('change',function(){
    const file=input.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=function(ev){
      const img=new Image();
      img.onload=function(){
        const maxW=200, maxH=200;
        let w=img.width, h=img.height;
        if(w>maxW){h=h*(maxW/w);w=maxW;}
        if(h>maxH){w=w*(maxH/h);h=maxH;}
        const canvas=document.getElementById('vpeCanvas');
        const obj={id:'obj_'+(vpeState.nextId++),type:'image',x:20,y:20,w:Math.round(w),h:Math.round(h),z:vpeState.objects.length+1,src:ev.target.result,style:{}};
        vpeState.objects.push(obj);
        vpeRenderObj(obj,canvas);
        vpeSelectObject(obj.id);
        vpeEditorAutoSave();
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

/* ── 이모지 메뉴 ── */
const _vpeEmojis=['😀','😊','😂','🥰','😎','🤔','😢','😡','👍','👎','👏','🙏','💪','❤️','⭐','✅','❌','⚠️','🔥','💯','🎉','🏫','🏥','💊','🩹','🩺','🌡️','😷','🤒','🤕','💉','🧴','🫁','🦷','👁️','🦴','🧠','🫀','🤧','🤮','🤢','💀','☠️','🚑','🚨','📋','📌','📎','✏️','📝','📅','📊','📈','🔔','💡','🎯','🏆','🌈','☀️','🌙','⚡'];
export function vpeEmojiMenuToggle(){
  const menu=document.getElementById('vpeEmojiMenu');
  if(menu.style.display==='flex'){menu.style.display='none';return;}
  if(!menu.children.length){
    _vpeEmojis.forEach(function(em){
      const btn=document.createElement('span');
      btn.style.cssText='font-size:20px;cursor:pointer;padding:2px 4px;border-radius:4px;transition:background .1s';
      btn.textContent=em;
      btn.title=em;
      btn.addEventListener('mouseenter',function(){this.style.background='rgba(6,182,212,0.15)';});
      btn.addEventListener('mouseleave',function(){this.style.background='';});
      btn.addEventListener('click',function(){
        const canvas=document.getElementById('vpeCanvas');
        const obj={id:'obj_'+(vpeState.nextId++),type:'textbox',x:40,y:40,w:50,h:50,z:vpeState.objects.length+1,content:em,style:{fontSize:32,fontFamily:"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif",fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000000',textAlign:'center',bgColor:'transparent'}};
        vpeState.objects.push(obj);
        vpeRenderObj(obj,canvas);
        vpeSelectObject(obj.id);
        vpeEditorAutoSave();
        menu.style.display='none';
      });
      menu.appendChild(btn);
    });
  }
  menu.style.display='flex';
}

function vpeAddSignatureUpload(){
  const btn=document.querySelector('.vp-sig-opt[data-sig="sign"]')||document.querySelector('.vp-sig-opt[data-sig="stamp"]');
  if(btn){vpSetSigMode(btn.dataset.sig,btn);}else{vpState.sigMode='sign';}
  const bar=document.getElementById('vpSigBar');
  if(bar)bar.classList.add('open');
  const drop=document.getElementById('vpSigDrop');
  if(drop){
    drop.classList.add('active');
    drop.style.display='block';
  }
  const fi=document.getElementById('vpSigFileInput');
  if(fi)fi.click();
}

export function vpHandleSigDrop(e){
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if(file && file.type.startsWith('image/')) vpReadSigFile(file);
}

export function vpHandleSigFile(input){
  if(input.files[0]) vpReadSigFile(input.files[0]);
}

function vpReadSigFile(file){
  const reader = new FileReader();
  reader.onload = function(e){
    vpState._sigUploadedRaw = e.target.result; /* 업로드 원본 (확인증에 바로 적용 안함) */
    vpState.sigImage = ''; /* 슬롯에서 선택해야 확인증에 적용됨 */
    vpShowSigPreview(e.target.result); /* 업로드 영역에만 미리보기 */
    /* 투명 배경 + 공백 적은 이미지 자동 감지 → 슬롯 저장 + 확인증 적용 */
    _vpCheckAutoSlotSave(e.target.result);
  };
  reader.readAsDataURL(file);
}
/* 투명 PNG이고 이미지 영역 외 공백이 5% 미만이면 바로 슬롯 저장 */
function _vpCheckAutoSlotSave(dataUrl){
  const img=new Image();
  img.onload=function(){
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const data=ctx.getImageData(0,0,c.width,c.height).data;
    const total=c.width*c.height;
    let transparent=0;
    let hasAlpha=false;
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]<10)transparent++;
      if(data[i+3]<250)hasAlpha=true;
    }
    if(!hasAlpha)return;/* 투명 영역 없음 → 투명 배경 만들기 필요 */
    const ratio=transparent/total;
    if(ratio>0.5)return;/* 투명이 50% 넘으면 공백 많아서 자르기 필요 */
    /* 자동 자르기 적용 */
    const trimmed=_autoTrimCanvas(c);
    const result=trimmed.toDataURL('image/png');
    vpState.sigImage=result;
    vpShowSigPreview(result);
    _vpSaveToSlot(result);
    vpUpdatePreview();
  };
  img.src=dataUrl;
}
/* localStorage 저장 + 백엔드 공통 store 동기화 */
function _vpPersistVpState(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));}catch(e){console.error('[vp] localStorage 저장 실패',e);}
  try{
    if(window.electronAPI&&window.electronAPI.dbSet){
      window.electronAPI.dbSet('common',key,value).catch(function(){});
    }
  }catch(e){}
}
function _vpSaveToSlot(dataUrl){
  /* sigMode가 'none'이면 자동으로 'sign'으로 설정 (사용자가 모드 미선택 상태에서 저장 시도) */
  if(vpState.sigMode!=='stamp'&&vpState.sigMode!=='sign'){
    vpState.sigMode='sign';
    try{localStorage.setItem('ec_vp_sigMode','sign');}catch(e){}
    const sigBtn=document.querySelector('.vp-sig-opt[data-sig="sign"]');
    if(sigBtn)sigBtn.classList.add('active');
    const signSlots=document.getElementById('vpSignSlots');
    if(signSlots)signSlots.style.display='';
  }
  const type=vpState.sigMode;
  const key=type==='stamp'?'ec_vp_stamps':'ec_vp_signs';
  const items=JSON.parse(localStorage.getItem(key)||'[]');
  if(items.length>=3){
    /* 슬롯 3개가 다 찼을 때 — 사용자에게 안내 */
    const toast=document.getElementById('globalSaveToast');
    if(toast){
      toast.textContent='슬롯이 3개 다 찼습니다. 기존 이미지를 먼저 삭제하세요.';
      toast.className='global-save-toast show saving';
      setTimeout(function(){toast.className='global-save-toast';},4000);
    }
    return;
  }
  /* 빈 슬롯 끝에 순서대로 추가 — slot[items.length]가 다음 빈 자리 */
  items.push(dataUrl);
  const newIdx=items.length-1;
  _vpPersistVpState(key,items);
  const gridId=type==='stamp'?'vpStampGrid':'vpSignGrid';
  _vpRenderSigSlots(gridId,items,type);
  /* 새로 추가된 슬롯을 자동 선택 + 마지막 선택으로 영구 기록 */
  vpState.sigImage=dataUrl;
  try{localStorage.setItem('ec_vp_lastSlot_'+type,String(newIdx));}catch(e){}
  vpShowSigPreview(dataUrl);
  vpUpdatePreview();
}

function vpShowSigPreview(src){
  const img = document.getElementById('vpSigPreviewImg');
  const wrap = document.getElementById('vpSigPreviewWrap');
  const text = document.getElementById('vpSigDropText');
  img.src = src;
  if(wrap)wrap.style.display = 'inline-block';
  if(text)text.style.display = 'none';
}
export function vpDeleteSig(){
  vpState.sigImage='';
  const img=document.getElementById('vpSigPreviewImg');if(img)img.src='';
  const wrap=document.getElementById('vpSigPreviewWrap');if(wrap)wrap.style.display='none';
  const text=document.getElementById('vpSigDropText');if(text)text.style.display='block';
  vpUpdatePreview();
}

/* ── 서명/도장 투명 배경 만들기 ── */
export function vpSigRemoveBg(){
  const srcImg=vpState._sigUploadedRaw||vpState.sigImage;
  if(!srcImg){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지를 먼저 업로드하세요';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  _bgRmOpen(srcImg,function(resultUrl){
    vpState.sigImage=resultUrl;
    vpShowSigPreview(resultUrl);
    _vpSaveToSlot(resultUrl);
    vpUpdatePreview();
  });
}

/* V/S 측정값 문자열 — 입력된 항목만 join. 의학 표준 순서 (T·BP·P·R·SpO₂·BST). */
function _vpVsStr(rec){
  if(!rec) return '';
  const parts = [];
  if(rec.temp) parts.push('T: ' + rec.temp);
  if(rec.bp) parts.push('BP: ' + rec.bp);
  if(rec.pulse) parts.push('P: ' + rec.pulse);
  const _resp = rec.respiration || rec.resp || '';
  if(_resp) parts.push('R: ' + _resp);
  if(rec.spo2) parts.push('SpO₂: ' + rec.spo2);
  if(rec.bst) parts.push('BST: ' + rec.bst);
  return parts.join(', ');
}

/* ── 시간대별 V/S(vsHistory) 블록 — "12:00 / BT:.. BP:.. ..." 시각줄 + 측정값줄. 측정값 있는 항목만. (사용자 요청 2026-06-16)
 *  vsHistory 항목 {t,temp,bp,pulse,resp,spo2,bst}. 라벨·순서는 사용자 지정(BT·BP·HR·R·BST·SpO₂). 2회 이상이어야 '시간대별'. */
function _vpVsTimeSeriesHtml(rec){
  const hist = (rec && Array.isArray(rec.vsHistory)) ? rec.vsHistory : [];
  if(hist.length < 2) return '';
  const _hms = function(t){ const m=String(t||'').match(/(\d{1,2}):(\d{2})/); return m?(parseInt(m[1],10)*60+parseInt(m[2],10)):999999; };
  const rows = hist.slice().sort(function(a,b){ return _hms(a.t)-_hms(b.t); });
  const cols = [['temp','BT'],['bp','BP'],['pulse','HR'],['resp','R'],['bst','BST'],['spo2','SpO₂']];
  const blocks = rows.map(function(rw){
    const parts = [];
    cols.forEach(function(c){ const v=String(rw[c[0]]==null?'':rw[c[0]]).trim(); if(v) parts.push(c[1]+': '+v); });
    if(!parts.length) return '';   /* 측정값이 하나도 없는 시각은 생략 */
    return '<div style="font-weight:700;color:#0e7490">'+_vpEscHtml(rw.t||'')+'</div>'
         + '<div style="margin:0 0 4px">'+_vpEscHtml(parts.join(', '))+'</div>';
  }).filter(Boolean);
  return blocks.join('');
}
/* V/S 셀 내용 — 시간대별이면 블록, 아니면 한 줄 요약. 반환값은 이미 escape 된 HTML. */
function _vpVsBlockHtml(rec){
  const ts = _vpVsTimeSeriesHtml(rec);
  if(ts) return ts;
  const single = _vpVsStr(rec);
  return single ? _vpEscHtml(single) : '';
}
/* 증상 문자열(쉼표) — 없으면 '-' */
function _vpSymStr(rec){ const syms=(rec&&Array.isArray(rec.symptoms))?rec.symptoms:[]; return syms.join(', ') || '-'; }
/* 평면 처치 배열 — rec.treatment 우선, 비어 있으면(미분기 등) treatmentBySym 의 모든 값 합집합 (처치 누락 방지, 2026-06-16) */
function _vpFlatTreatArr(rec){
  if(!rec) return [];
  if(Array.isArray(rec.treatment) && rec.treatment.length) return rec.treatment.slice();
  if(rec.treatmentBySym && typeof rec.treatmentBySym==='object' && !Array.isArray(rec.treatmentBySym)){
    const out=[]; Object.keys(rec.treatmentBySym).forEach(function(k){ (rec.treatmentBySym[k]||[]).forEach(function(t){ if(out.indexOf(t)===-1) out.push(t); }); });
    return out;
  }
  return [];
}
/* 바디맵 부위 문자열(쉼표) — 저장된 마커 라벨(예: 왼쪽 어깨)을 중복 없이. 없으면 '' (기존 기록도 r.bodymapData 폴백) */
function _vpBodymapStr(rec){
  if(!rec) return '';
  var arr = (typeof window!=='undefined' && window._bmData && window._bmData[rec.id]) ? window._bmData[rec.id] : (rec.bodymapData||[]);
  var out=[]; (arr||[]).forEach(function(m){ if(m&&m.label && out.indexOf(m.label)===-1) out.push(m.label); });
  return out.join(', ');
}
/* 처치 문자열 — '투약' 제외 + medication 결합. 없으면 '-' (커스텀 양식 기존 분리 로직과 동일) */
function _vpTreatStr(rec){
  const _tArr = _vpFlatTreatArr(rec).filter(function(t){return t!=='투약';});
  const _med = rec && rec.medication ? formatMedicationDisplay(rec.medication) : '';
  if(_tArr.length && _med) return _tArr.join(', ') + ', ' + _med.trim();
  if(_tArr.length) return _tArr.join(', ');
  if(_med) return _med.trim();
  return '-';
}
/* 증상·처치 분리/합침 모드 — 양식별 저장(ec_vp_symtreat_mode). 기본: 커스텀=분리, 그 외=합침 → 기존 동작 그대로 보존. (사용자 요청 2026-06-16) */
function _vpGetSymTreatModes(){ try{ const v=JSON.parse(localStorage.getItem('ec_vp_symtreat_mode')||'{}'); return (v&&typeof v==='object'&&!Array.isArray(v))?v:{}; }catch(_){ return {}; } }
function _vpSymTreatMode(fmt){ const m=_vpGetSymTreatModes(); if(m[fmt]==='split'||m[fmt]==='merge')return m[fmt]; return String(fmt||'').startsWith('custom')?'split':'merge'; }
function _vpSetSymTreatMode(fmt, mode){ const m=_vpGetSymTreatModes(); m[fmt]=mode; _vpPersistVpState('ec_vp_symtreat_mode', m); }
/* ── 내용 선택 — 양식별 독립 저장(ec_vp_content_by_format). 양식마다 따로 보존 → 한 양식 끄면 다른 양식에 영향 없음.
 *  per-format 항목이 없으면 옛 공유값(ec_vp_content)을 기본으로 폴백해 기존 사용자 설정을 보존. (사용자 요청 2026-06-19) ── */
function _vpDefaultContent(){ return {date:true, timeIn:true, timeOut:true, symptoms:true, treatment:true, bodymap:true, vs:true, teacherSig:true}; }
function _vpGetContentMap(){ try{ const v=JSON.parse(localStorage.getItem('ec_vp_content_by_format')||'{}'); return (v&&typeof v==='object'&&!Array.isArray(v))?v:{}; }catch(_){ return {}; } }
function _vpLoadContentForFormat(fmt){
  const def=_vpDefaultContent();
  const map=_vpGetContentMap();
  if(map[fmt] && typeof map[fmt]==='object') return Object.assign({}, def, map[fmt]);
  try{ const old=JSON.parse(localStorage.getItem('ec_vp_content')||'null'); if(old&&typeof old==='object') return Object.assign({}, def, old); }catch(_){}
  return Object.assign({}, def);
}
function _vpSaveContentForFormat(fmt){
  const map=_vpGetContentMap();
  map[fmt]=Object.assign({}, vpState.content);
  _vpPersistVpState('ec_vp_content_by_format', map);
}
/* 내용 선택 바 버튼 on/off + 통합 칩 라벨을 현재 vpState.content 기준으로 동기화 (양식 전환 시 호출) */
function _vpSyncContentBar(){
  document.querySelectorAll('#vpContentBar .vp-toggle[data-field]').forEach(function(b){
    const f=b.dataset.field;
    if(f==='all'||f==='custom') return;
    if(f==='symtreatCombo'){ _vpUpdateSymTreatComboChip(); return; }
    if(f==='teacherNurse'||f==='teacherSubject'||f==='teacherHomeroom'){ _vpUpdateTeacherChips(); return; }
    b.classList.toggle('on', !!vpState.content[f]);
  });
  vpSyncAllToggle();
  vpUpdateContentLabel();
}
/* 양식 전환 감지용 — vpUpdatePreview 에서 양식이 바뀌면 그 양식의 content 로드 */
let _vpLastContentFormat = null;

/* ── 교사 확인 — 보건·교과·담임 3개의 독립 on/off 칩. 양식별 저장(ec_vp_teacher_mode). (사용자 요청 2026-06-20)
 *   · nurse    = "보건교사 ○○○ (서명/인)" + 도장/서명 이미지 (끄면 서명·도장까지 사라짐).
 *   · subject  = "교과담당교사 확인 _____ (서명/인)"
 *   · homeroom = "담임교사 확인 _____ (서명/인)"
 *   셋 모두 동등 — 양식별 order 배열에 '켠 순서'대로 저장 → 먼저 켠 줄이 위. 끄면 배열에서 빠짐.
 *   기본 order = ['nurse','subject'] (보건+교과 켜짐, 담임 꺼짐).
 *   옛 문자열 모드('subject'/'homeroom'/'off')·옛 {nurse,extras} 객체는 자동 마이그레이션. ── */
const _VP_TEACHER_KEYS = ['nurse','subject','homeroom'];
function _vpGetTeacherCfgs(){ try{ const v=JSON.parse(localStorage.getItem('ec_vp_teacher_mode')||'{}'); return (v&&typeof v==='object'&&!Array.isArray(v))?v:{}; }catch(_){ return {}; } }
function _vpTeacherOrder(fmt){
  const raw=_vpGetTeacherCfgs()[fmt];
  const clean=function(arr){ const seen={}, out=[]; (Array.isArray(arr)?arr:[]).forEach(function(k){ if(_VP_TEACHER_KEYS.indexOf(k)>=0 && !seen[k]){ seen[k]=1; out.push(k); } }); return out; };
  if(typeof raw==='string'){   /* 옛 단일 모드 → order (보건은 항상 맨 위였음) */
    return raw==='off' ? ['nurse'] : ['nurse', raw==='homeroom'?'homeroom':'subject'];
  }
  if(raw && typeof raw==='object'){
    if(Array.isArray(raw.order)) return clean(raw.order);          /* 신 모델 */
    /* 옛 {nurse, extras} → order (보건 먼저, 그 뒤 extras) */
    const out=[]; if(raw.nurse!==false) out.push('nurse');
    return clean(out.concat(Array.isArray(raw.extras)?raw.extras:[]));
  }
  return ['nurse','subject'];   /* 기본 */
}
function _vpSetTeacherOrder(fmt, order){ const m=_vpGetTeacherCfgs(); m[fmt]={ order:(order||[]).slice() }; _vpPersistVpState('ec_vp_teacher_mode', m); }
/* 교사 확인 줄들 — order 순서대로(=켠 순서) 쌓아 HTML 생성. 보건줄은 nurseInner 를 끼워 렌더.
 *  줄 사이 간격은 모두 동일(margin-top:6px), 맨 위 줄만 top margin 없음. (2026-06-20) */
function _vpTeacherLinesHtml(fmt, nurseInner){
  const order=_vpTeacherOrder(fmt);
  return order.map(function(key, i){
    const mt = i===0 ? '' : 'margin-top:6px;';
    if(key==='nurse') return '<div style="'+mt+'display:inline-block;min-height:20px;white-space:nowrap">'+nurseInner+'</div>';
    const label=(key==='homeroom')?'담임교사 확인':'교과담당교사 확인';
    return '<div class="vp-teacher-line" style="'+mt+'white-space:nowrap"><span>'+label+' <span class="vp-teacher-name vp-blank-line" contenteditable="true" style="min-width:70px;outline:none;cursor:text" data-tip="클릭하여 입력"></span> (서명/인)</span></div>';
  }).join('');
}
/* 3개 칩 on/off 상태 동기화 (라벨은 고정) */
function _vpUpdateTeacherChips(){
  const order=_vpTeacherOrder(vpState.format);
  const set=function(field,key){ const b=document.querySelector('#vpContentBar .vp-toggle[data-field="'+field+'"]'); if(b) b.classList.toggle('on', order.indexOf(key)>=0); };
  set('teacherNurse','nurse');
  set('teacherSubject','subject');
  set('teacherHomeroom','homeroom');
}
/* 증상·처치 통합 칩 라벨/상태 동기화 — 합침/분리/끔 3단계를 한 칩에 표시 (사용자 요청 2026-06-16). */
function _vpUpdateSymTreatComboChip(){
  const btn=document.querySelector('#vpContentBar .vp-toggle[data-field="symtreatCombo"]');
  if(!btn)return;
  const on = !!(vpState.content.symptoms && vpState.content.treatment);
  const mode=_vpSymTreatMode(vpState.format);
  btn.textContent = !on ? '증상·처치 (끔)' : (mode==='split' ? '증상·처치 (분리)' : '증상·처치 (합침)');
  btn.classList.toggle('on', on);
}
/* 기본·급식·진료·안정 양식 공통 — 증상·처치 행(모드별) + V/S 행(항상 아래로). (사용자 요청 2026-06-16) */
function _vpStdSymTreatVsRows(rec){
  const c = vpState.content;
  const mode = _vpSymTreatMode(vpState.format);
  let h = '';
  if(c.symptoms || c.treatment){
    if(mode === 'split'){
      if(c.symptoms)  h += `<tr><td class="label">증 상</td><td colspan="3">${rec && rec.symptoms && rec.symptoms.length ? escHtml(_vpSymStr(rec)) : _VP_PH}</td></tr>`;
      if(c.treatment) h += `<tr><td class="label">처치내용</td><td colspan="3">${rec && ((rec.treatment&&rec.treatment.length)||rec.medication) ? escHtml(_vpTreatStr(rec)) : _VP_PH}</td></tr>`;
    } else {
      h += `<tr><td class="label">증상<br>처치</td><td colspan="3">${rec && ((rec.symptoms&&rec.symptoms.length)||(rec.treatment&&rec.treatment.length)) ? _vpRenderSymTreatCell(rec) : _VP_PH}</td></tr>`;
    }
  }
  if(c.bodymap){
    const _bm = _vpBodymapStr(rec);
    h += `<tr><td class="label">부위</td><td colspan="3">${rec && _bm ? escHtml(_bm) : _VP_PH}</td></tr>`;
  }
  const _vsHtml = _vpVsBlockHtml(rec);
  if(_vsHtml && c.vs) h += `<tr><td class="label">V/S</td><td colspan="3">${_vsHtml}</td></tr>`;
  return h;
}

/* ── 빈 셀 placeholder (3종 양식 공통) ──
 * 사람/일지 미선택 시 자리는 비우지 않고 보라색 "클릭하여 기재" 안내문 + contenteditable 로 둔다.
 * - CSS: health-diary.css 1749행 `.vp-preview [contenteditable][data-placeholder]:empty::before`
 * - 사용자가 클릭해서 적은 내용은 휘발 (record 에 저장 안 함), 인쇄 시에는 적힌 내용만 출력. */
const _VP_PH = '<span contenteditable="true" data-placeholder="_____" style="display:inline-block;min-width:80px;outline:none;cursor:text" data-tip="클릭하여 입력"></span>';

/* ── 학교급/학과 행 빌더 (3종 양식 공통) ──
   - 학교급 표시: 학교 명단에 학교급이 여러 개 혼재 OR 특수학교 설정
   - 학과   표시: 해당 학생에 department 값 존재
   - 조합  : 둘 다 → 한 행 4셀(학교급|X|학 과|Y) / 한쪽만 → 라벨+값 colspan=3 / 둘 다 없음 → 행 자체 없음 */
function _vpBuildLevelDeptRow(stu){
  if(stu && stu.type==='staff') return '';   /* 교직원 선택 시만 제외. 사람 미선택(!stu)은 아래에서 빈 행 처리. */
  const showLevel = hasMultipleSchoolLevels() || (S.settings && S.settings.schoolLevel === 'special');
  const showDept  = hasAnyDepartment();
  const lv   = (stu && showLevel) ? (getLevelShort(stu) || '') : '';
  const dept = stu ? ((stu.department || '') + '').trim() : '';
  /* 사람 선택 시: 그 학생 값 있을 때만. 미선택 시: 학교가 학교급/학과를 쓰면 빈 행(손기입용). (사용자 요청 2026-06-01) */
  const showLevelRow = stu ? !!lv   : showLevel;
  const showDeptRow  = stu ? !!dept : showDept;
  /* 빈 값(사람 미선택)은 다른 칸과 동일하게 _VP_PH(점선 밑줄 + 클릭 기재) 사용. (2026-06-01) */
  const lvCell   = lv   ? escHtml(lv)   : _VP_PH;
  const deptCell = dept ? escHtml(dept) : _VP_PH;
  if(showLevelRow && showDeptRow){
    return `<tr><td class="label">학교급</td><td>${lvCell}</td><td class="label">학 과</td><td>${deptCell}</td></tr>`;
  }
  if(showLevelRow){
    return `<tr><td class="label">학교급</td><td colspan="3">${lvCell}</td></tr>`;
  }
  if(showDeptRow){
    return `<tr><td class="label">학 과</td><td colspan="3">${deptCell}</td></tr>`;
  }
  return '';
}

/* ── 인적사항 블록 (학교급~이름) — 라벨 없이 한 칸 병합, 3줄 세로 배치 (사용자 요청 2026-06-18) ──
   ① [(학교급)] 학과   예) "(고) 지형공간디자인과" / 학교급 단일·학과 있음 → "항공기계과"
   ② N학년 M반 K번
   ③ 이름 — 한글은 한 줄, 영어는 한 줄에 들어가면 한 줄 / 넘치면 공백(성·이름)에서만 줄바꿈(word-break:keep-all) */
function _vpBuildPersonBlock(stu){
  const _wrap = function(inner){ return `<tr><td colspan="4" class="vp-person-block" style="text-align:center;line-height:1.55">${inner}</td></tr>`; };
  const _nameDiv = function(html){ return `<div style="font-weight:700;white-space:normal;word-break:keep-all">${html}</div>`; };
  /* 교직원 — 직위 + 이름 (학년·반·번호 없음) */
  if(stu && stu.type==='staff'){
    return _wrap(`<div>${escHtml(stu.position||'교직원')}</div>`+_nameDiv(escHtml(stu.name||'')));
  }
  const showLevel = hasMultipleSchoolLevels() || (S.settings && S.settings.schoolLevel === 'special');
  if(stu){
    const lv   = showLevel ? (getLevelShort(stu) || '') : '';
    const dept = ((stu.department || '') + '').trim();
    const l1   = (lv ? `(${lv}) ` : '') + dept;            /* 학교급+학과 (둘 다 없으면 빈 줄 생략) */
    const l2   = `${stu.grade}학년 ${stu.cls}반 ${stu.num}번`;
    let inner = '';
    if(l1) inner += `<div>${escHtml(l1)}</div>`;
    inner += `<div>${escHtml(l2)}</div>`;
    inner += _nameDiv(escHtml(stu.name || ''));
    return _wrap(inner);
  }
  /* 미선택(빈 양식) — 손기입용 점선. 학교가 학교급/학과를 쓰면 첫 줄도 점선 */
  const showDept = hasAnyDepartment();
  let inner = '';
  if(showLevel || showDept) inner += `<div>${_VP_PH}</div>`;
  inner += `<div>${_VP_PH}</div>`;
  inner += `<div style="font-weight:700">${_VP_PH}</div>`;
  return _wrap(inner);
}

/* v3 (사용자 결정 2026-05-21) — 양식 하단 확인 문구 + 서명 영역 커스텀 토큰 시스템.
 *   · 토큰: {방문자 이름} {날짜} {학교명} {처치자} {교과담당교사}
 *   · localStorage 저장: ec_vp_tpl_<formKey>
 *   · 사용자가 ✏️ 클릭 → 편집 모드 (textarea + 토큰 chip) → 저장 시 raw 템플릿 보존
 *   · 표시 시점에 토큰 치환 후 텍스트 반환. 줄바꿈은 <br> 로. */
const _VP_TPL_DEFAULTS = {
  visitPass: '위와 같이 {방문자 이름} 학생이 보건실을\n방문하였음을 확인합니다.',   /* 두 줄 (사용자 요청 2026-06-11) */
  restReferral: '위와 같이 {방문자 이름} 학생이 보건실에서\n안정이 필요하다고 판단하여\n의뢰서를 발급하고자 합니다.',   /* 보건실 안정 의뢰서 — 세 줄 (사용자 요청 2026-06-11) */
  meal:      '위 학생은 병원 등 방문이 필요하여\n평소보다 이른 급식이 필요하오니\n협조를 부탁드립니다.',   /* 세 줄 (사용자 요청 2026-06-11) */
  referral:  '위 학생은 병원 진료가 필요한 상태로\n판단하오니 병원 진료를 받을 수\n있도록 협조를 부탁드립니다.',   /* 세 줄 (사용자 요청 2026-06-11) */
};
function _vpGetTpl(formKey){
  try{
    const v = localStorage.getItem('ec_vp_tpl_'+formKey);
    if(v != null && v !== '') return v;
  }catch(_){}
  return _VP_TPL_DEFAULTS[formKey] || '';
}
function _vpSetTpl(formKey, val){
  try{ localStorage.setItem('ec_vp_tpl_'+formKey, val); }catch(_){}
  /* DB common 즉시 동기화 — 재설치/복원 후에도 commonMappings 가 복원 (보존 감사 2026-06-11) */
  try{ if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','vp_tpl_'+formKey,val); }catch(_){}
}
function _vpResetTplKey(formKey){
  try{ localStorage.removeItem('ec_vp_tpl_'+formKey); }catch(_){}
  /* 빈 문자열 저장 = 기본값 사용 (_vpGetTpl 이 '' 면 기본값 반환) */
  try{ if(window.electronAPI&&window.electronAPI.dbSet)window.electronAPI.dbSet('common','vp_tpl_'+formKey,''); }catch(_){}
}
function _vpEscHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
/* 토큰 치환 — HTML escape + 줄바꿈 → <br>. 토큰 자리만 별도 강조(b/escape). */
function _vpResolveTokens(raw, ctx){
  if(!raw) return '';
  return _vpEscHtml(raw)
    .replace(/\n/g,'<br>')
    .replace(/\{방문자 이름\}/g, ctx.visitor?'<b>'+_vpEscHtml(ctx.visitor)+'</b>':'<span class="vp-blank-line"></span>')
    .replace(/\{날짜\}/g,       _vpEscHtml(ctx.dateStr||''))
    .replace(/\{학교명\}/g,     '<b>'+_vpEscHtml(ctx.school||'')+'</b>')
    .replace(/\{처치자\}/g,     _vpEscHtml(ctx.nurse||''))
    .replace(/\{교과담당교사\}/g, _vpEscHtml(ctx.teacher||'교과담당교사 (서명/인)'));
}
function _vpRenderConfirmBlock(formKey, ctx){
  const raw = _vpGetTpl(formKey);
  const rendered = _vpResolveTokens(raw, ctx);
  return `<div class="vp-confirm vp-editable" data-tpl-key="${formKey}">
  <span class="vp-confirm-text">${rendered}</span>
  <span class="vp-tpl-tools">
    <button type="button" class="vp-tpl-edit" data-action="vpEditTpl" data-tpl-key="${formKey}" title="문구 수정">✏️</button>
    <button type="button" class="vp-tpl-reset" data-action="vpResetTpl" data-tpl-key="${formKey}" title="기본값으로 되돌리기">↺</button>
  </span>
</div>`;
}
/* v3 (사용자 결정 2026-05-21) — 증상·처치 통합 셀 렌더링.
 *   · 다중 증상 + treatmentBySym 있음 → "두통 → 타이레놀, 침상안정" 줄, "복통 → 복부 마사지" 줄로 분기
 *   · record-level (침상·V/S) 처치는 첫 줄에 함께 표시
 *   · 단일 증상 또는 옛 일지 → "두통, 복통 → 타이레놀, 침상안정" 한 줄
 *   · '투약' 처치는 약품과 결합 ("투약[약명(도즈)]" 형태) */
function _vpRenderSymTreatCell(rec){
  if(!rec) return '-';
  const syms = Array.isArray(rec.symptoms) ? rec.symptoms : [];
  const treats = Array.isArray(rec.treatment) ? rec.treatment : [];
  const _hasBySym = rec.treatmentBySym && typeof rec.treatmentBySym==='object'
                && !Array.isArray(rec.treatmentBySym) && Object.keys(rec.treatmentBySym).length>0;
  /* 미분기(treatmentBranched===false)면 증상별 화살표 분기 대신 한 줄 나열("코막힘, 가래, 두통 → 병원진료 권유") (사용자 요청 2026-06-16) */
  const _isMulti = syms.length>1 && _hasBySym && rec.treatmentBranched !== false;
  if(_isMulti){
    const _medDispForSym = function(sym){
      if(!rec.medsBySym || !rec.medsBySym[sym] || !rec.medsBySym[sym].length) return '';
      var dm = (rec.medDosesBySym && rec.medDosesBySym[sym]) || {};
      var str = rec.medsBySym[sym].map(function(mm){var d=dm[mm]||''; return d?(mm+'('+d+')'):mm;}).join(', ');
      return formatMedicationDisplay(str);
    };
    /* v3 (2026-05-28) — V/S·침상도 per-symptom. 각 증상 행에 그 증상 처치만 (record-level 공유 폐지). */
    const lines = syms.map(function(sym, idx){
      var _spl = String(sym).match(/^(.+?)\s*\((.*)\)\s*$/);
      var _symDisp = _spl ? (_spl[1].trim()+'['+_spl[2]+']') : sym;
      var symTreats = (rec.treatmentBySym[sym]||[]);
      var medDispForSym = _medDispForSym(sym);
      var symLabeled = symTreats.map(function(t){
        var b=t; var mt=t.match(/^(.+?)\s*\((.*)\)\s*$/); if(mt)b=mt[1].trim();
        if(b==='투약' && medDispForSym) return medDispForSym;
        return t;
      });
      var treatStr = symLabeled.join(', ') || '-';
      /* 화살표+처치를 nested flex 그룹으로 묶어 wrap 시 함께 다음줄로 → 자유 기입 긴 텍스트도 셀 안에 머무름. */
      return '<div style="display:flex;gap:4px;align-items:baseline;line-height:1.7;flex-wrap:wrap">'
        + '<span style="font-weight:700;color:#0e7490;word-break:keep-all">'+_vpEscHtml(_symDisp)+'</span>'
        + '<span style="display:inline-flex;gap:4px;align-items:baseline;min-width:0;flex:1 1 auto">'
          + '<span style="color:#94a3b8;flex-shrink:0">→</span>'
          + '<span style="word-break:keep-all;overflow-wrap:anywhere;min-width:0">'+_vpEscHtml(treatStr)+'</span>'
        + '</span>'
        + '</div>';
    });
    return lines.join('');
  }
  /* 단일/legacy/미분기 — 한 줄. '투약' 처치 + medication 결합. 평면 treatment 가 비면 treatmentBySym 폴백 (처치 누락 방지) */
  const _tArr = _vpFlatTreatArr(rec).filter(function(t){return t!=='투약';});
  const _med = rec.medication ? formatMedicationDisplay(rec.medication) : '';
  let _full = '';
  if(_tArr.length && _med) _full = _tArr.join(', ')+', '+_med.trim();
  else if(_tArr.length) _full = _tArr.join(', ');
  else if(_med) _full = _med.trim();
  const symStr = syms.join(', ');
  if(!symStr && !_full) return '-';
  if(!symStr) return _vpEscHtml(_full);
  if(!_full) return _vpEscHtml(symStr);
  /* 단일/legacy — 자유 기입 긴 텍스트도 셀 안에 wrap 되도록 동일 flex 그룹 구조 사용 */
  return '<div style="display:flex;gap:4px;align-items:baseline;line-height:1.7;flex-wrap:wrap">'
    + '<span style="word-break:keep-all">'+_vpEscHtml(symStr)+'</span>'
    + '<span style="display:inline-flex;gap:4px;align-items:baseline;min-width:0;flex:1 1 auto">'
      + '<span style="color:#94a3b8;flex-shrink:0">→</span>'
      + '<span style="word-break:keep-all;overflow-wrap:anywhere;min-width:0">'+_vpEscHtml(_full)+'</span>'
    + '</span>'
    + '</div>';
}

/* 편집 모드 진입 — vp-confirm 블록을 textarea + 토큰 chip 으로 교체.
 * v3 (사용자 결정 2026-05-21 갱신) — 취소/저장 버튼 폐기. 입력 즉시 자동 저장 + 토스트.
 * 외부 클릭 시 편집 영역 종료 + 자동 저장. 디폴트 복원은 평소 ↺ 아이콘으로. */
function _vpEnterTplEditMode(tplKey, block){
  if(!block) return;
  /* 편집 textarea 가 커지면서 절단선·회색 영역 위로 겹치는 회귀 fix — 편집 중에만 hide. */
  document.querySelectorAll('.vp-def-cut-line, .vpe-cut-line, .vpe-cut-bubble, [id^="vpDefCut"]').forEach(function(el){
    el.style.display='none';
  });
  const raw = _vpGetTpl(tplKey);
  block.classList.remove('vp-editable');
  block.classList.add('vp-editing');
  block.innerHTML = `
    <textarea class="vp-tpl-textarea" rows="3">${_vpEscHtml(raw)}</textarea>
    <div class="vp-token-menu">
      <span class="vp-token-label">내용 선택:</span>
      <button type="button" class="vp-token-chip" data-action="vpInsertToken" data-token="{방문자 이름}">방문자 이름</button>
      <button type="button" class="vp-token-chip" data-action="vpInsertToken" data-token="{날짜}">날짜</button>
      <button type="button" class="vp-token-chip" data-action="vpInsertToken" data-token="{학교명}">학교명</button>
      <button type="button" class="vp-token-chip" data-action="vpInsertToken" data-token="{처치자}">처치자</button>
      <button type="button" class="vp-token-chip" data-action="vpInsertToken" data-token="{교과담당교사}">교과담당교사</button>
    </div>`;
  const ta = block.querySelector('.vp-tpl-textarea');
  setTimeout(function(){
    if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 30);
  /* v3 — 자동 저장 디바운스 (300ms). 입력 시 "저장 중…" → "모든 내용이 저장되었습니다." 토스트. */
  let _tplSaveDebounce = null;
  const _autoSave = function(){
    if(!ta) return;
    _vpSetTpl(tplKey, ta.value);
    bus.emit('toast:saveLater');
    setTimeout(function(){ bus.emit('toast:save'); }, 180);
  };
  if(ta){
    ta.addEventListener('input', function(){
      if(_tplSaveDebounce) clearTimeout(_tplSaveDebounce);
      _tplSaveDebounce = setTimeout(_autoSave, 300);
    });
  }
  /* v3 — 외부 클릭 시 편집 영역 종료 + 즉시 저장 + 미리보기 재렌더 */
  let _settled = false;
  const _onOutsideClick = function(e){
    if(_settled) return;
    if(block.contains(e.target)) return;
    _settled = true;
    document.removeEventListener('click', _onOutsideClick, true);
    if(_tplSaveDebounce){ clearTimeout(_tplSaveDebounce); _tplSaveDebounce=null; }
    /* 마지막 값 동기 저장 + 토스트 */
    _autoSave();
    /* 편집 영역 사라짐 — 양식 미리보기 통째 재렌더 (옛 모습 복귀) */
    setTimeout(function(){ vpUpdatePreview(); }, 30);
  };
  setTimeout(function(){
    document.addEventListener('click', _onOutsideClick, true);
  }, 50);
}

/* 서명 영역 — 보건교사 아래에 교과담당교사 확인 줄 (옵션). 가운데 정렬, 세로 stack.
 *   · 체크 안 함 (기본): 처치자만
 *   · 체크 함: 처치자 + 그 아래 "교과담당교사 확인 [이름 밑줄] (서명/인)" */
function _vpRenderSigRow(userPos, nurseName, sigImgHtml){
  /* 보건교사 줄 inner — '보건' 칩이 켜졌을 때 order 안에서 해당 위치에 렌더. 끄면 도장/서명까지 함께 사라짐. */
  const nurseInner = `<span id="vpSigInText" style="z-index:1">${userPos} ${nurseName} <span class="vp-sig-anchor" style="position:relative;display:inline-block">(서명/인)${sigImgHtml}</span></span>`;
  /* 보건·교과·담임을 켠 순서대로 위→아래로 쌓음 (2026-06-20) */
  const lines = _vpTeacherLinesHtml(vpState.format, nurseInner);
  return `<div class="vp-sig-area" style="flex-direction:column;align-items:center">${lines}</div>`;
}

function vpBuildDefaultTemplate(opts){
  /* opts.title / opts.confirmKey — '보건실 안정 의뢰서'(rest_referral)가 같은 양식을 제목만 바꿔 재사용 (사용자 요청 2026-06-11).
   * confirmKey 를 분리해 확인 문구 사용자 편집이 양식별로 따로 저장되게 한다. */
  opts = opts || {};
  const _title = opts.title || '보건실 방문 확인증';
  const _confirmKey = opts.confirmKey || 'visitPass';
  const rec = vpState.selectedRecord;
  const stu = vpState.selectedStudent;

  const c = vpState.content;
  let rows = '';
  rows += _vpBuildPersonBlock(stu);

  /* 방문자/일지 미선택 시 값 셀은 "클릭하여 기재" 보라색 placeholder (2026-05-24) */
  let contentRows = '';
  if(c.date) contentRows += `<tr><td class="label">방문일</td><td colspan="3">${rec ? rec.date+' ('+getDow(rec.date)+')' : _VP_PH}</td></tr>`;
  if(c.timeIn) contentRows += `<tr><td class="label">입실시간</td><td colspan="3">${rec ? rec.timeIn : _VP_PH}</td></tr>`;
  if(c.timeOut) contentRows += `<tr><td class="label">퇴실시간</td><td colspan="3">${rec ? (rec.timeOut || '-') : _VP_PH}</td></tr>`;
  /* 증상·처치(분리/합침 모드별) + V/S(증상·처치 아래로 이동, 시간대별 측정 지원) — 공통 빌더 (사용자 요청 2026-06-16) */
  contentRows += _vpStdSymTreatVsRows(rec);
  if(false && c.treatment){
    /* 투약 정렬: treatment 배열에서 '투약'을 제거하고, medication이 있으면 끝에 "투약: ..." 형태로 표시 */
    const _tArr=rec?(rec.treatment||[]).filter(function(t){return t!=='투약';}):[];
    const _med=rec&&rec.medication?(' '+formatMedicationDisplay(rec.medication)):'';
    const _tStr=_tArr.length?_tArr.join(', '):'';
    let _full='';
    if(_tStr&&_med)_full=_tStr+',  '+_med.trim();
    else if(_tStr)_full=_tStr;
    else if(_med)_full=_med.trim();
    else _full='-';
    /* 처치내용은 출력 전용 인라인 편집 가능 — record 에는 절대 쓰기 금지.
     * contenteditable 만 사용해서 DOM 만 변경되고 보건일지 record 는 손대지 않는다.
     * 미리보기 재렌더 시 사용자의 임시 수정은 사라진다(의도된 동작). */
    contentRows += `<tr><td class="label">처치내용</td><td colspan="3"><span class="vp-treat-edit" contenteditable="true" data-tip="클릭하여 입력 (출력 시에만 반영, 보건일지에는 반영 안 됨)" style="display:inline-block;min-width:80%;outline:none;border-bottom:1px dashed transparent;cursor:text" onfocus="this.style.borderBottomColor='var(--bdr)'" onblur="this.style.borderBottomColor='transparent'">${_full}</span></td></tr>`;
  }

  let customLine = '';
  if(vpState.customInput){
    const ci=document.getElementById('vpCustomInput');
    const val = ci?ci.value.trim():'';
    if(val) customLine = `<tr><td class="label">비 고</td><td colspan="3">${val}</td></tr>`;
  }

  const schoolName = S.settings.schoolName || '○○학교';
  const nurseName = S.settings.nurse1 || '보건교사';
  const userPos = (JSON.parse(localStorage.getItem('ec_user')||'{}')).position || '보건교사';
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  let sigImgHtml = '';
  if(vpState.sigImage && (vpState.sigMode === 'stamp' || vpState.sigMode === 'sign')){
    sigImgHtml = `<img id="vpSigStampImg" src="${vpState.sigImage}" style="max-height:50px;max-width:80px;object-fit:contain;position:absolute;left:0;top:50%;transform:translateY(-50%);z-index:10;opacity:0.9;pointer-events:none" title="">`;
  }
  /* v3 (사용자 결정 2026-05-21) — confirm/sig 영역 커스텀 토큰 시스템 적용 */
  const _vpCtx = {
    visitor: stu ? stu.name : '',
    dateStr: dateStr,
    school:  schoolName,
    nurse:   userPos+' '+nurseName+' (서명/인)',
    teacher: '교과담당교사 (서명/인)'
  };
  return `<h2>${_title}</h2>
<table class="vp-info-table">${rows}${contentRows}${customLine}</table>
${_vpRenderConfirmBlock(_confirmKey, _vpCtx)}
<div class="vp-footer">${dateStr}<br><b>${schoolName}</b><br>${_vpRenderSigRow(userPos, nurseName, sigImgHtml)}</div>`;
}

/* ── 빠른 급식 요청서 ── */
function vpBuildMealRequestTemplate(){
  const rec = vpState.selectedRecord;
  const stu = vpState.selectedStudent;
  const schoolName = S.settings.schoolName || '○○학교';
  const nurseName = S.settings.nurse1 || '보건교사';
  const userPos = (JSON.parse(localStorage.getItem('ec_user')||'{}')).position || '보건교사';
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  let rows = '';
  rows += _vpBuildPersonBlock(stu);
  /* 내용 선택 토글 반영 — 모든 양식 일관 (사용자 지시 2026-06-11) */
  if(vpState.content.date) rows += `<tr><td class="label">방문일</td><td colspan="3">${rec ? rec.date+' ('+getDow(rec.date)+')' : _VP_PH}</td></tr>`;
  /* 증상·처치(분리/합침 모드별) + V/S(아래로, 시간대별 지원) — 공통 빌더 (사용자 요청 2026-06-16) */
  rows += _vpStdSymTreatVsRows(rec);
  /* 필요/이유 행 — 호버 시 − 로 행 삭제 가능 (세션 한정, 팝업 다시 열면 복귀. 사용자 요청 2026-06-11) */
  if(!(vpState.reasonRemoved && vpState.reasonRemoved.meal)) rows += `<tr class="vp-reason-row"><td class="label" style="position:relative">필요<br>이유<span class="vp-reason-del" data-action="vpRemoveReason" data-form="meal" data-tip="이 행을 삭제합니다. 복구는 [초기 상태로 되돌리기]" style="display:none;position:absolute;top:2px;right:2px;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.12);color:#dc2626;font-size:11px;font-weight:800;line-height:1;cursor:pointer;user-select:none">−</span></td><td colspan="3" style="min-height:36px"><span id="vpMealReason" contenteditable="true" class="vp-blank-line" style="min-width:120px;max-width:100%" data-tip="클릭하여 입력"></span></td></tr>`;

  let sigImgHtml = '';
  if(vpState.sigImage && (vpState.sigMode === 'stamp' || vpState.sigMode === 'sign')){
    sigImgHtml = `<img id="vpSigStampImg" src="${vpState.sigImage}" style="max-height:50px;max-width:80px;object-fit:contain;position:absolute;left:0;top:50%;transform:translateY(-50%);z-index:10;opacity:0.9;pointer-events:none" title="">`;
  }
  /* v3 (사용자 결정 2026-05-21) — confirm/sig 영역 커스텀 토큰 시스템 적용 */
  const _vpCtx = {
    visitor: stu ? stu.name : '',
    dateStr: dateStr,
    school:  schoolName,
    nurse:   userPos+' '+nurseName+' (서명/인)',
    teacher: '교과담당교사 (서명/인)'
  };
  return `<h2>빠른 급식 요청서</h2>
<table class="vp-info-table">${rows}</table>
${_vpRenderConfirmBlock('meal', _vpCtx)}
<div class="vp-footer">${dateStr}<br><b>${schoolName}</b><br>${_vpRenderSigRow(userPos, nurseName, sigImgHtml)}</div>`;
}

/* ── 병원 진료 의뢰서 ── */
function vpBuildReferralTemplate(){
  const rec = vpState.selectedRecord;
  const stu = vpState.selectedStudent;
  const schoolName = S.settings.schoolName || '○○학교';
  const nurseName = S.settings.nurse1 || '보건교사';
  const userPos = (JSON.parse(localStorage.getItem('ec_user')||'{}')).position || '보건교사';
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  let rows = '';
  rows += _vpBuildPersonBlock(stu);
  /* 내용 선택 토글 반영 — 모든 양식 일관 (사용자 지시 2026-06-11) */
  if(vpState.content.date) rows += `<tr><td class="label">방문일</td><td colspan="3">${rec ? rec.date+' ('+getDow(rec.date)+')' : _VP_PH}</td></tr>`;
  /* 증상·처치(분리/합침 모드별) + V/S(아래로, 시간대별 지원) — 공통 빌더 (사용자 요청 2026-06-16) */
  rows += _vpStdSymTreatVsRows(rec);
  /* 필요/이유 행 — 호버 시 − 로 행 삭제 가능 (세션 한정, 팝업 다시 열면 복귀. 사용자 요청 2026-06-11) */
  if(!(vpState.reasonRemoved && vpState.reasonRemoved.referral)) rows += `<tr class="vp-reason-row"><td class="label" style="position:relative">필요<br>이유<span class="vp-reason-del" data-action="vpRemoveReason" data-form="referral" data-tip="이 행을 삭제합니다. 복구는 [초기 상태로 되돌리기]" style="display:none;position:absolute;top:2px;right:2px;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.12);color:#dc2626;font-size:11px;font-weight:800;line-height:1;cursor:pointer;user-select:none">−</span></td><td colspan="3" style="min-height:36px"><span id="vpReferralReason" contenteditable="true" class="vp-blank-line" style="min-width:120px;max-width:100%" data-tip="클릭하여 입력"></span></td></tr>`;

  let sigImgHtml = '';
  if(vpState.sigImage && (vpState.sigMode === 'stamp' || vpState.sigMode === 'sign')){
    sigImgHtml = `<img id="vpSigStampImg" src="${vpState.sigImage}" style="max-height:50px;max-width:80px;object-fit:contain;position:absolute;left:0;top:50%;transform:translateY(-50%);z-index:10;opacity:0.9;pointer-events:none" title="">`;
  }
  /* v3 (사용자 결정 2026-05-21) — confirm/sig 영역 커스텀 토큰 시스템 적용 */
  const _vpCtx = {
    visitor: stu ? stu.name : '',
    dateStr: dateStr,
    school:  schoolName,
    nurse:   userPos+' '+nurseName+' (서명/인)',
    teacher: '교과담당교사 (서명/인)'
  };
  return `<h2>병원 진료 의뢰서</h2>
<table class="vp-info-table">${rows}</table>
${_vpRenderConfirmBlock('referral', _vpCtx)}
<div class="vp-footer">${dateStr}<br><b>${schoolName}</b><br>${_vpRenderSigRow(userPos, nurseName, sigImgHtml)}</div>`;
}

/* ── 커스텀 양식 (custom1 ~ custom7) ──
 * 보건실 방문 확인증의 표 구조 복제.
 * - 제목(<h2>): 미리보기 헤더 + 좌측 양식 버튼 양방향 동기화 (같은 저장소 ec_vp_custom_names)
 * - 라벨 셀(왼쪽): 호버 시 ✏️ 편집 + ↺ 복원 아이콘 (블록 처리)
 * - 값 셀(오른쪽): contenteditable, 휘발
 * - 확인문 / 푸터: 한 블록으로 편집/복원 (ec_vp_custom_blocks)
 * - 모든 ↺ 복원은 앱 표준 모달 확인 → 예 시에만 복원 */
function vpBuildCustomTemplate(slotKey){
  const rec = vpState.selectedRecord;
  const stu = vpState.selectedStudent;
  const titles = vpGetCustomNames();
  const num = slotKey.replace('custom','');
  const defTitle = '커스텀 양식 ' + num;
  const title = titles[slotKey] || defTitle;
  const slotLabels = vpGetCustomLabels()[slotKey] || {};
  const slotBlocks = vpGetCustomBlocks()[slotKey] || {};
  const slotRows = (vpGetCustomRows()[slotKey] || []).slice();   /* 처치내용 아래 사용자추가 행 라벨 배열 */

  /* 편집 가능 영역 마크업 헬퍼 — 호버 아이콘 ✏️↺ + 추가 아이콘. dataBlock 으로 저장 카테고리 구분. */
  const _editableInline = function(text, dataAttrs, iconStyleExtra, extraIcons, noRestore){
    let _icons = '<span class="vp-cf-l-icons"'+(iconStyleExtra?' style="'+iconStyleExtra+'"':'')+'>'
      +'<span class="vp-cf-edit" title="수정">✏️</span>';
    if(!noRestore) _icons += '<span class="vp-cf-restore" title="기본값으로 복원">↺</span>';
    _icons += (extraIcons||'') + '</span>';
    return '<span class="vp-cf-l-text"'+dataAttrs+'>'+text+'</span>'+_icons;
  };

  /* 라벨 셀 (default 행) — opts.canAdd 면 ➕ 아이콘 추가 (afterIdx=-1: 사용자추가 행 맨 위에 삽입) */
  const _L = function(def, opts){
    opts = opts || {};
    const cur = slotLabels[def] || def;
    let extra = '';
    if(opts.canAdd){
      extra = '<span class="vp-cf-add" data-slot="'+slotKey+'" data-after-idx="'+(opts.afterIdx!=null?opts.afterIdx:-1)+'" title="아래에 새 행을 추가합니다.">＋</span>';
    }
    return '<td class="label vp-cf-editable" data-slot="'+slotKey+'" data-default-label="'+escHtml(def)+'">'
      + _editableInline(escHtml(cur), ' data-block="label" data-slot="'+slotKey+'" data-default-label="'+escHtml(def)+'"', null, extra)
      + '</td>';
  };
  /* 사용자추가 행 라벨 셀 — ✏️ 편집 + ➕ 그 아래 추가 + ➖ 이 행 삭제. ↺ 없음. */
  const _LUserAdded = function(idx){
    const cur = slotRows[idx] || '새 항목';
    const extra = '<span class="vp-cf-add" data-slot="'+slotKey+'" data-after-idx="'+idx+'" title="아래에 새 행을 추가합니다.">＋</span>'
      +'<span class="vp-cf-del" data-slot="'+slotKey+'" data-row-idx="'+idx+'" title="이 행을 삭제합니다.">－</span>';
    return '<td class="label vp-cf-editable" data-slot="'+slotKey+'">'
      + _editableInline(escHtml(cur), ' data-block="userrow" data-slot="'+slotKey+'" data-row-idx="'+idx+'"', null, extra, true)
      + '</td>';
  };
  /* 값 셀 — opts.bind 가 있으면 data-cf-bind 속성 부여 (확인문 자동 동기화 대상 식별) */
  const _V = function(val, opts){
    opts = opts || {};
    const cs = opts.colspan ? ' colspan="'+opts.colspan+'"' : '';
    const st = opts.bold ? ' style="font-weight:700"' : '';
    const bn = opts.bind ? ' data-cf-bind="'+opts.bind+'"' : '';
    return '<td class="vp-cf-value" contenteditable="true"'+cs+st+bn+' data-tip="이 내용을 지울 수 있고 다음 실행 시 저장되지 않습니다">'+escHtml(val || '')+'</td>';
  };

  /* 학교급/학과 행 — 사람 선택 시 그 학생 값, 미선택 시 학교가 학교급/학과를 쓰면 빈 입력란.
     (사용자 요청 2026-06-01 — 학과 쓰는 학교는 사람 미선택 빈 양식에도 학과 입력란이 있어야 함. 교직원 선택 시는 제외) */
  let rows = '';
  if(!(stu && stu.type === 'staff')){
    const showLevel = hasMultipleSchoolLevels() || (S.settings && S.settings.schoolLevel === 'special');
    const showDept  = hasAnyDepartment();
    const lv   = (stu && showLevel) ? (getLevelShort(stu) || '') : '';
    const dept = stu ? ((stu.department || '') + '').trim() : '';
    const showLevelRow = stu ? !!lv   : showLevel;
    const showDeptRow  = stu ? !!dept : showDept;
    if(showLevelRow && showDeptRow){
      rows += '<tr>'+_L('학교급')+_V(lv)+_L('학 과')+_V(dept)+'</tr>';
    } else if(showLevelRow){
      rows += '<tr>'+_L('학교급')+_V(lv, {colspan:3})+'</tr>';
    } else if(showDeptRow){
      rows += '<tr>'+_L('학 과')+_V(dept, {colspan:3})+'</tr>';
    }
  }
  rows += '<tr>'+_L('학 년')+_V(stu ? (stu.grade + '학년') : '')+_L('반')+_V(stu ? (stu.cls + '반') : '')+'</tr>';
  rows += '<tr>'+_L('번 호')+_V(stu ? (stu.num + '번') : '')+_L('이 름')+_V(stu ? stu.name : '', {bold:true, bind:'name'})+'</tr>';
  /* 내용 선택 토글 반영 — 기본 양식(vpBuildDefaultTemplate)과 동일하게 vpState.content 로 행 표시/숨김.
   * (커스텀만 무조건 렌더되어 내용 선택이 안 먹던 버그 수정 — 사용자 보고 2026-06-11) */
  const c = vpState.content;
  if(c.date)    rows += '<tr>'+_L('방문일')+_V(rec ? (rec.date+' ('+getDow(rec.date)+')') : '', {colspan:3})+'</tr>';
  if(c.timeIn)  rows += '<tr>'+_L('입실시간')+_V(rec ? rec.timeIn : '', {colspan:3})+'</tr>';
  if(c.timeOut) rows += '<tr>'+_L('퇴실시간')+_V(rec ? (rec.timeOut || '-') : '', {colspan:3})+'</tr>';
  /* 증상·처치 — 분리/합침 모드별 (사용자 요청 2026-06-16).
   *  분리 = 기존대로 증 상/처치내용 두 칸(편집 가능 라벨). 합침 = 증상·처치 한 칸(per-symptom 매핑, HTML 셀).
   *  라벨 저장소(ec_vp_custom_labels)는 두 모드의 라벨이 각각 별도 키로 보존돼, 모드를 오가도 사용자 커스텀이 사라지지 않음. */
  const _stMode = _vpSymTreatMode(slotKey);
  if(_stMode === 'split'){
    if(c.symptoms) rows += '<tr>'+_L('증 상')+_V(rec ? (rec.symptoms.join(', ') || '-') : '', {colspan:3})+'</tr>';
    const _tArr = _vpFlatTreatArr(rec).filter(function(t){return t!=='투약';});
    const _med = rec && rec.medication ? (' ' + formatMedicationDisplay(rec.medication)) : '';
    let _full = '';
    if(_tArr.length && _med) _full = _tArr.join(', ') + ',  ' + _med.trim();
    else if(_tArr.length) _full = _tArr.join(', ');
    else if(_med) _full = _med.trim();
    else _full = '-';
    if(c.treatment) rows += '<tr>'+_L('처치내용', {canAdd:true, afterIdx:-1})+_V(_full, {colspan:3})+'</tr>';
  } else if(c.symptoms || c.treatment){
    const _stCell = rec && ((rec.symptoms&&rec.symptoms.length)||(rec.treatment&&rec.treatment.length)) ? _vpRenderSymTreatCell(rec) : '';
    rows += '<tr>'+_L('증상·처치', {canAdd:true, afterIdx:-1})+'<td class="vp-cf-value" colspan="3">'+_stCell+'</td></tr>';
  }
  /* 부위 — 바디맵으로 표시한 부위(선택한 만큼 나열). (사용자 요청 2026-06-16) */
  if(c.bodymap){
    const _bm = _vpBodymapStr(rec);
    rows += '<tr>'+_L('부위')+_V(rec ? (_bm || '-') : '', {colspan:3})+'</tr>';
  }
  /* V/S — 증상·처치 아래로 이동 + 시간대별 측정 지원 (사용자 요청 2026-06-16) */
  if(c.vs){
    const _vsTs = _vpVsTimeSeriesHtml(rec);
    if(_vsTs) rows += '<tr>'+_L('V/S')+'<td class="vp-cf-value" colspan="3">'+_vsTs+'</td></tr>';
    else { const _vsCf = _vpVsStr(rec); if(_vsCf) rows += '<tr>'+_L('V/S')+_V(_vsCf, {colspan:3})+'</tr>'; }
  }

  /* 사용자추가 행 — 처치내용 아래에 순서대로 렌더. 각 행: 라벨(편집/추가/삭제) + 값(휘발). */
  slotRows.forEach(function(rowLabel, idx){
    rows += '<tr>'+_LUserAdded(idx)+'<td class="vp-cf-value vp-cf-user-value" contenteditable="true" colspan="3" data-tip="이 내용을 지울 수 있고 다음 실행 시 저장되지 않습니다"></td></tr>';
  });

  /* 푸터 — 기본 템플릿 (날짜 + 학교명 + 서명/도장) */
  const schoolName = S.settings.schoolName || '○○학교';
  const nurseName = S.settings.nurse1 || '보건교사';
  const userPos = (JSON.parse(localStorage.getItem('ec_user')||'{}')).position || '보건교사';
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;
  let sigImgHtml = '';
  if(vpState.sigImage && (vpState.sigMode === 'stamp' || vpState.sigMode === 'sign')){
    sigImgHtml = `<img id="vpSigStampImg" src="${vpState.sigImage}" style="max-height:50px;max-width:80px;object-fit:contain;position:absolute;left:0;top:50%;transform:translateY(-50%);z-index:10;opacity:0.9;pointer-events:none" title="">`;
  }
  /* 보건교사 줄 inner — order 안에서 '보건' 위치에 렌더 (끄면 도장/서명까지 사라짐). */
  const nurseInner = '<span id="vpSigInText" style="z-index:1">'+escHtml(userPos)+' '+escHtml(nurseName)+' <span class="vp-sig-anchor" style="position:relative;display:inline-block">(서명/인)'+sigImgHtml+'</span></span>';
  /* 교사 확인 줄들(보건·교과·담임) — 켠 순서대로(먼저 켠 줄이 위). 푸터 저장본과 무관하게 표시/숨김.
   * vp-cf-l-text 밖에 두므로 푸터 ✏️ 편집 textarea·저장본에 섞이지 않고, 토글·순서가 항상 반영된다. (2026-06-20) */
  const _tLines = _vpTeacherLinesHtml(vpState.format, nurseInner);
  const teacherLine = _tLines ? '<div class="vp-sig-area" style="flex-direction:column;align-items:center">'+_tLines+'</div>' : '';

  /* 확인문 — 저장된 사용자정의 우선, 없으면 기본 템플릿.
   * 기본 템플릿의 <b> 에 vp-cf-name-bind 클래스 부여 — 이름 값 셀 입력 시 실시간 동기화 대상. */
  const defConfirm = '위와 같이 <b class="vp-cf-name-bind">'+(stu?escHtml(stu.name):'<span class="vp-blank-line"></span>')+'</b> 학생이<br>보건실을 방문하였음을 확인합니다.';
  const curConfirm = slotBlocks.confirm || defConfirm;

  /* 푸터 — 저장된 사용자정의 우선, 없으면 기본 템플릿(날짜+학교명). 보건교사 서명줄은 이제 teacherLine 정렬 섹션에서 렌더. */
  const defFooter = dateStr+'<br><b>'+escHtml(schoolName)+'</b>';
  let curFooter = slotBlocks.footer || defFooter;
  /* 마이그레이션 — 옛 저장본(2026-06-19 이전)엔 보건교사 서명 블록이 푸터 본문에 구워져 있을 수 있다.
   * 이제 보건줄을 teacherLine 정렬 섹션에서 그리므로, 본문에 남은 옛 sig-area 를 제거해 중복을 막는다. */
  if(/id="vpSigInText"|class="vp-sig-area"/.test(curFooter)){
    curFooter = curFooter.replace(/(?:<br\s*\/?>)?\s*<div class="vp-sig-area"[\s\S]*$/i, '').replace(/(?:<br\s*\/?>)\s*$/i, '');
  }

  /* 안내 배너는 외부 HTML(#vpCustomFormTip)에서 별도 표시 — 인쇄물에는 안 나오도록 분리. */

  return '<h2 class="vp-cf-editable" data-slot="'+slotKey+'">'
      + _editableInline(escHtml(title), ' data-block="title" data-slot="'+slotKey+'"', 'top:0;right:0')
    + '</h2>'
    + '<table class="vp-info-table">'+rows+'</table>'
    + '<div class="vp-confirm vp-cf-editable" data-slot="'+slotKey+'">'
      + '<span class="vp-cf-l-text" data-block="confirm" data-slot="'+slotKey+'">'+curConfirm+'</span>'
      + '<span class="vp-cf-l-icons" style="top:0;right:0"><span class="vp-cf-edit" title="확인 문구 수정">✏️</span><span class="vp-cf-restore" title="기본 문구로 복원">↺</span></span>'
    + '</div>'
    + '<div class="vp-footer vp-cf-editable" data-slot="'+slotKey+'">'
      + '<span class="vp-cf-l-text" data-block="footer" data-slot="'+slotKey+'">'+curFooter+'</span>'
      + teacherLine
      + '<span class="vp-cf-l-icons" style="top:0;right:0"><span class="vp-cf-edit" title="푸터 수정">✏️</span><span class="vp-cf-restore" title="기본 푸터로 복원">↺</span></span>'
    + '</div>';
}

/* 앱 표준 모달 (회색 헤더 + 흰색 바디) — Promise<boolean> 반환 */
function _vpConfirmRestoreModal(){
  return new Promise(function(resolve){
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:50000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)';
    ov.innerHTML='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:340px;max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);font-family:var(--f);overflow:hidden">'
      +'<div style="padding:12px 18px;background:var(--popup-head);border-bottom:1px solid var(--bdr);font-size:13px;font-weight:800;color:var(--t1)">원래 문구로 되돌리겠습니까?</div>'
      +'<div style="padding:18px 20px;font-size:12.5px;color:var(--t1);line-height:1.7;background:var(--card)">사용자가 직접 수정한 내용이 사라지고 기본 문구로 복원됩니다.</div>'
      +'<div style="display:flex;gap:6px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--bdr);background:var(--card)">'
      +'<button data-act="no" style="padding:6px 16px;font-size:11.5px;font-weight:600;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--t2);cursor:pointer;outline:none;font-family:var(--f)">아니오</button>'
      +'<button data-act="yes" style="padding:6px 16px;font-size:11.5px;font-weight:700;border-radius:6px;border:1px solid rgba(14,116,144,0.4);background:rgba(14,116,144,0.12);color:var(--cyan);cursor:pointer;outline:none;font-family:var(--f)">예, 되돌립니다</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    const close=function(r){ try{document.removeEventListener('keydown',onKey,true);}catch(_){} ov.remove(); resolve(r); };
    ov.querySelector('[data-act="yes"]').addEventListener('click',function(){close(true);});
    ov.querySelector('[data-act="no"]').addEventListener('click',function(){close(false);});
    ov.addEventListener('click',function(e){ if(e.target===ov) close(false); });
    const onKey=function(e){
      if(e.key==='Escape'){ e.preventDefault(); close(false); }
      else if(e.key==='Enter'){ e.preventDefault(); close(true); }
    };
    document.addEventListener('keydown',onKey,true);
  });
}

/* 커스텀 양식 편집/복원 이벤트 — vpUpdatePreview 직후 attach. */
function _vpAttachCustomCellHandlers(){
  const preview = document.getElementById('vpPreview');
  if(!preview) return;

  /* 값 칸 안내("이 내용을 지울 수 있고...") — OS 기본 title 대신 프로그램 전용 흰 배경 툴팁(vp-tip-popup) (사용자 요청 2026-06-10) */
  preview.querySelectorAll('.vp-cf-value[data-tip]').forEach(_vpBindTipPopup);

  /* ➕ 행 추가 — afterIdx 가 -1 이면 사용자추가 행 맨 앞에, 그 외엔 해당 인덱스 다음에 삽입 */
  preview.querySelectorAll('.vp-cf-add').forEach(function(btn){
    if(btn._cfAddBound) return;
    btn._cfAddBound = true;
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const slot = btn.dataset.slot;
      const afterIdx = parseInt(btn.dataset.afterIdx, 10);
      const rows = (vpGetCustomRows()[slot] || []).slice();
      const insertAt = (afterIdx === -1) ? 0 : (afterIdx + 1);
      rows.splice(insertAt, 0, '새 항목');
      vpSaveCustomRows(slot, rows);
      vpUpdatePreview();
    });
  });
  /* ➖ 행 삭제 — 해당 인덱스 행 제거 */
  preview.querySelectorAll('.vp-cf-del').forEach(function(btn){
    if(btn._cfDelBound) return;
    btn._cfDelBound = true;
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const slot = btn.dataset.slot;
      const idx = parseInt(btn.dataset.rowIdx, 10);
      const rows = (vpGetCustomRows()[slot] || []).slice();
      if(idx >= 0 && idx < rows.length){
        rows.splice(idx, 1);
        vpSaveCustomRows(slot, rows);
        vpUpdatePreview();
      }
    });
  });

  /* 이름 값 셀 → 확인문의 이름 placeholder 실시간 동기화.
   * 우선순위: .vp-cf-name-bind 클래스 → 없으면 .vp-confirm 안의 첫 <b> 태그 → 둘 다 없으면 무시. */
  preview.querySelectorAll('[data-cf-bind="name"]').forEach(function(td){
    if(td._cfNameBound) return;
    td._cfNameBound = true;
    const _syncName = function(){
      const nm = (td.textContent || '').trim();
      const _blank = '<span class="vp-blank-line"></span>';
      const tagged = preview.querySelectorAll('.vp-cf-name-bind');
      if(tagged.length){
        tagged.forEach(function(el){
          if(nm) el.textContent = nm;
          else el.innerHTML = _blank;
        });
        return;
      }
      /* fallback: 확인문 안의 첫 <b> */
      const confirmHost = preview.querySelector('.vp-confirm .vp-cf-l-text') || preview.querySelector('.vp-confirm');
      if(confirmHost){
        const b = confirmHost.querySelector('b');
        if(b){
          if(nm) b.textContent = nm;
          else b.innerHTML = _blank;
        }
      }
    };
    td.addEventListener('input', _syncName);
  });
  preview.querySelectorAll('.vp-cf-editable').forEach(function(host){
    if(host._cfBound) return;
    host._cfBound = true;
    const textSpan = host.querySelector('.vp-cf-l-text');
    const editBtn = host.querySelector('.vp-cf-edit');
    const restoreBtn = host.querySelector('.vp-cf-restore');   /* 사용자추가 행(userrow)엔 ↺ 없음 → 선택적 */
    if(!textSpan || !editBtn) return;
    const block = textSpan.dataset.block;       /* 'title' | 'label' | 'confirm' | 'footer' */
    const slot = textSpan.dataset.slot;
    const def = textSpan.dataset.defaultLabel;  /* label 만 사용 */

    /* 편집 진입 (블록 선택) */
    editBtn.addEventListener('click', function(e){
      e.stopPropagation();
      textSpan.setAttribute('contenteditable', 'true');
      textSpan.focus();
      try{
        const range = document.createRange();
        range.selectNodeContents(textSpan);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      }catch(_){}
    });

    /* 제목은 input 이벤트로 실시간 동기화 — 좌측 양식 선택 버튼 라벨도 즉시 갱신 */
    if(block === 'title'){
      textSpan.addEventListener('input', function(){
        const num = slot.replace('custom','');
        const defTitle = '커스텀 양식 ' + num;
        const cur = (textSpan.textContent || '').trim();
        const labelEl = document.getElementById('vpCLabel' + num);
        if(labelEl) labelEl.textContent = cur || defTitle;
      });
    }

    /* blur 시 저장 — block 종류에 따라 분기 */
    textSpan.addEventListener('blur', function(){
      textSpan.removeAttribute('contenteditable');
      if(block === 'title'){
        const cur = (textSpan.textContent||'').trim();
        const defTitle = '커스텀 양식 ' + slot.replace('custom','');
        if(!cur || cur === defTitle){
          vpSaveCustomTitle(slot, '');
          textSpan.textContent = defTitle;
        } else {
          vpSaveCustomTitle(slot, cur);
        }
      } else if(block === 'label'){
        const cur = (textSpan.textContent||'').trim();
        if(!cur){
          textSpan.textContent = def;
          vpSaveCustomLabel(slot, def, '');
        } else if(cur !== def){
          vpSaveCustomLabel(slot, def, cur);
        } else {
          vpSaveCustomLabel(slot, def, '');
        }
      } else if(block === 'confirm' || block === 'footer'){
        /* HTML 형태 유지(<b>, <br> 등) — innerHTML 저장 */
        const html = textSpan.innerHTML;
        vpSaveCustomBlock(slot, block, html);
      } else if(block === 'userrow'){
        /* 사용자추가 행 라벨 저장 — 빈 값이면 행 자체 삭제 */
        const idx = parseInt(textSpan.dataset.rowIdx, 10);
        const cur = (textSpan.textContent || '').trim();
        const rows = (vpGetCustomRows()[slot] || []).slice();
        if(idx >= 0 && idx < rows.length){
          if(!cur){
            rows.splice(idx, 1);
            vpSaveCustomRows(slot, rows);
            vpUpdatePreview();
            return;
          }
          rows[idx] = cur;
          vpSaveCustomRows(slot, rows);
        }
      }
    });
    /* Enter 는 줄바꿈 허용 필요할 수도 있어 confirm/footer 만 Shift+Enter 줄바꿈, 단순 라벨/타이틀은 Enter 로 blur */
    textSpan.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ e.preventDefault(); textSpan.blur(); }
      else if(e.key === 'Enter'){
        if(block === 'label' || block === 'title' || block === 'userrow'){ e.preventDefault(); textSpan.blur(); }
        /* confirm/footer 는 Enter 로 줄바꿈 가능 */
      }
    });

    /* ↺ 복원 — 모달 확인 후 사용자정의 제거 + 미리보기 재렌더. (userrow 는 ↺ 없으므로 restoreBtn 있을 때만 바인딩) */
    if(restoreBtn) restoreBtn.addEventListener('click', async function(e){
      e.stopPropagation();
      const ok = await _vpConfirmRestoreModal();
      if(!ok) return;
      if(block === 'title'){
        vpSaveCustomTitle(slot, '');
      } else if(block === 'label'){
        vpSaveCustomLabel(slot, def, '');
      } else if(block === 'confirm' || block === 'footer'){
        vpSaveCustomBlock(slot, block, '');
      }
      /* 변경 반영 — 전체 미리보기 재렌더 */
      vpUpdatePreview();
    });
  });
}

let _vpDefCutY=0;/* 보건실 확인증 전용 — 커스텀은 vpeState._cutY 사용 */
let _vpSigOffsetX=0, _vpSigOffsetY=0;/* 도장/서명 위치 오프셋 (양식별 영구 저장) */
/* ── 도장/서명 위치 영구 저장 (양식별) ── */
function _vpSigPosKey(){return 'ec_vp_sig_pos_'+(vpState.format||'default');}
function _vpSigPosLoad(){
  try{
    const raw=localStorage.getItem(_vpSigPosKey());
    if(raw){
      const p=JSON.parse(raw);
      if(p&&typeof p.x==='number'&&typeof p.y==='number'){
        _vpSigOffsetX=p.x;_vpSigOffsetY=p.y;return true;
      }
    }
  }catch(e){}
  _vpSigOffsetX=0;_vpSigOffsetY=0;
  return false;
}
function _vpSigPosSave(){
  try{localStorage.setItem(_vpSigPosKey(),JSON.stringify({x:_vpSigOffsetX,y:_vpSigOffsetY}));}catch(e){}
}
/* v3 (사용자 결정 2026-05-21) — vp-confirm 영역 클릭 위임.
 *   · vpEditTpl: 펜 클릭 → 편집 모드 진입
 *   · vpResetTpl: 되돌리기 클릭 → 기본값 복귀 (확인 후)
 *   · vpSaveTpl: 저장 클릭 → localStorage 보존 + 양식 재렌더
 *   · vpCancelTpl: 취소 클릭 → 양식 재렌더 (변경 폐기)
 *   · vpInsertToken: 토큰 chip 클릭 → textarea 의 커서 위치에 토큰 삽입 */
function _vpAttachTplHandlers(preview){
  if(!preview || preview._vpTplHandlersBound) return;
  preview._vpTplHandlersBound = true;
  preview.addEventListener('click', function(e){
    const btn = e.target.closest && e.target.closest('[data-action]');
    if(!btn || !preview.contains(btn)) return;
    const action = btn.dataset.action;
    if(action === 'vpRemoveReason'){
      /* 필요/이유 행 삭제 — 영구 저장. '초기 상태로 되돌리기'로만 복귀 (사용자 결정 2026-06-11) */
      e.stopPropagation();
      if(!vpState.reasonRemoved) vpState.reasonRemoved = {meal:false, referral:false};
      vpState.reasonRemoved[btn.dataset.form] = true;
      try{ vpSaveReasonRemoved(vpState.reasonRemoved); }catch(_){}
      /* 버튼이 재렌더로 사라지면 mouseleave 가 안 발화 → 떠 있는 안내 팁 강제 제거 */
      document.querySelectorAll('.vp-tip-popup').forEach(function(el){ el.remove(); });
      vpUpdatePreview();
    } else if(action === 'vpEditTpl'){
      e.stopPropagation();
      _vpEnterTplEditMode(btn.dataset.tplKey, btn.closest('.vp-confirm'));
    } else if(action === 'vpResetTpl'){
      e.stopPropagation();
      if(confirm('이 문구를 기본값으로 되돌리시겠습니까?')){
        _vpResetTplKey(btn.dataset.tplKey);
        vpUpdatePreview();
      }
    } else if(action === 'vpSaveTpl'){
      e.stopPropagation();
      const tplKey = btn.dataset.tplKey;
      const block = btn.closest('.vp-confirm');
      const ta = block ? block.querySelector('.vp-tpl-textarea') : null;
      if(ta){ _vpSetTpl(tplKey, ta.value); vpUpdatePreview(); }
    } else if(action === 'vpCancelTpl'){
      e.stopPropagation();
      vpUpdatePreview();
    } else if(action === 'vpInsertToken'){
      e.stopPropagation();
      const token = btn.dataset.token;
      const block = btn.closest('.vp-confirm');
      const ta = block ? block.querySelector('.vp-tpl-textarea') : null;
      if(ta && token){
        const start = ta.selectionStart||0;
        const end = ta.selectionEnd||0;
        const v = ta.value;
        ta.value = v.slice(0,start) + token + v.slice(end);
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      }
    }
  });
}

/* 칩 hover 시 body 에 직접 흰 배경 툴팁 표시 (CSS pseudo 는 부모 stacking 에 가려짐).
 * data-tip 속성 갖는 모든 칩에 적용. */
function _vpBindTipPopup(btn){
  if(!btn || btn._vpTipBound) return;
  btn._vpTipBound = true;
  let _tipEl = null;
  btn.addEventListener('mouseenter', function(){
    const tip = btn.getAttribute('data-tip');
    if(!tip) return;
    if(_tipEl) _tipEl.remove();
    _tipEl = document.createElement('div');
    _tipEl.className = 'vp-tip-popup';
    _tipEl.textContent = tip;
    document.body.appendChild(_tipEl);
    const r = btn.getBoundingClientRect();
    _tipEl.style.left = r.right + 'px';
    _tipEl.style.top = (r.bottom + 6) + 'px';
    const tw = _tipEl.offsetWidth;
    if(r.right + tw > window.innerWidth - 8){
      _tipEl.style.left = Math.max(8, window.innerWidth - tw - 8) + 'px';
    }
  });
  btn.addEventListener('mouseleave', function(){
    if(_tipEl){_tipEl.remove(); _tipEl = null;}
  });
}

/* V/S 칩 활성/비활성 동기화 — 방문자의 record 에 V/S 입력값 있는지 보고 칩 disabled state 설정.
 * data-tip 속성은 활성/비활성에 따라 다른 안내 문구. */
function _vpSyncVsChip(){
  const btn = document.querySelector('#vpContentBar .vp-toggle[data-field="vs"]');
  if(!btn) return;
  const hasVs = !!_vpVsStr(vpState.selectedRecord);
  if(hasVs){
    btn.classList.remove('vp-disabled');
    btn.setAttribute('data-tip', '확인증에 V/S 측정값(체온·혈압·맥박 등)을 표시합니다.');
    btn.removeAttribute('title');
    btn.classList.toggle('on', !!vpState.content.vs);
  } else {
    btn.classList.add('vp-disabled');
    btn.setAttribute('data-tip', '이 방문자의 V/S 입력 값이 없으므로 활성화되지 않습니다.');
    btn.removeAttribute('title');
    btn.classList.remove('on');
  }
}

/* 내용 선택 바의 모든 data-tip 칩에 흰 배경 툴팁 바인딩. */
function _vpBindAllContentTips(){
  document.querySelectorAll('#vpContentBar .vp-toggle[data-tip]').forEach(_vpBindTipPopup);
}

/* 3인치 미리보기를 실제 인쇄물과 픽셀 동일하게 — 인쇄 전용 CSS(_vpComposePrintHtml 영수증 분기와 동일 값)를
 * #vpPreview 에 스코프 적용. 내용은 vpBuildPrintContent 가 이 DOM 을 복제하므로 이미 동일 → 같은 내용+같은 CSS. */
function _vpApplyReceiptMatchCss(on){
  let st=document.getElementById('vpReceiptMatchCss');
  if(!on){ if(st)st.remove(); return; }
  if(!st){ st=document.createElement('style'); st.id='vpReceiptMatchCss'; document.head.appendChild(st); }
  st.textContent=
    '#vpPreview{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",sans-serif;font-size:16px;line-height:1.5;font-weight:500;width:72mm;padding:6mm 3mm 2mm 5mm;background:#fff;color:#000;box-sizing:border-box}'
    +'#vpPreview h2{font-size:19px;font-weight:900;text-align:center;margin:0 0 7px;padding-bottom:5px;line-height:1;border-bottom:1px solid #000;color:#000}'
    +'#vpPreview .vp-info-table{width:100%;border-collapse:collapse;margin:5px 0;font-size:14px}'
    +'#vpPreview .vp-info-table td{padding:4px 5px;border:1px solid #000;color:#000;word-break:keep-all;overflow-wrap:anywhere}'
    +'#vpPreview .vp-info-table .label{background:#d8d8d8;font-weight:800;width:58px;text-align:center;white-space:nowrap;color:#000}'
    +'#vpPreview .vp-confirm{text-align:center;margin:7px 0 4px;font-size:14px;line-height:1.5;color:#000;font-weight:600}'
    +'#vpPreview .vp-footer{text-align:center;margin-top:14px;font-size:14px;color:#000;font-weight:600;line-height:1.8}'
    +'#vpPreview .vp-sig-area{display:flex;justify-content:center;align-items:center;gap:9px;margin-top:10px}'
    +'#vpPreview .vp-sig-area img{max-height:37px;max-width:74px;object-fit:contain}'
    /* ── 인쇄 CSS 공통 규칙(_vpComposePrintHtml 하단부와 동일) — 빠지면 증상·처치 등이 셀 안에서 줄바꿈 안 돼 오른쪽에 붙음 ── */
    +'#vpPreview img{max-width:100%;height:auto}'
    +'#vpPreview b,#vpPreview strong{font-weight:800;color:#000}'
    +'#vpPreview table{table-layout:fixed}'
    /* span 에만 적용 — td[contenteditable](커스텀 양식 값 칸)에 display:inline 을 먹이면 표가 왼쪽으로 무너짐 (편집 모드 버그 수정 2026-06-10)
     * .vp-blank-line(필요 이유 등 빈칸)은 제외 — 학과~증상·처치 빈칸과 동일하게 점선 밑줄 유지 (사용자 확정 2026-06-10) */
    +'#vpPreview span[contenteditable]:not(.vp-blank-line),#vpPreview [id$="Reason"]:not(.vp-blank-line){min-width:0!important;min-height:0!important;display:inline!important;border-bottom:none!important;width:auto!important;max-width:100%!important}'
    +'#vpPreview td span{max-width:100%;word-break:break-all;white-space:normal}'
    +'#vpPreview .vp-blank-line{display:inline-block!important;min-width:40px;width:auto;min-height:1.1em;border-bottom:1px dashed #555;vertical-align:text-bottom;box-sizing:border-box}';
}
/* 3인치 메인 미리보기 = 인쇄 iframe (A안). 다이얼로그·출력물과 동일한 _vpComposePrintHtml 을 격리된 iframe 에 렌더 →
 * 앱 화면 CSS 가 전혀 안 새어듦. 원본 #vpPreview(템플릿)는 opacity:0 로 숨겨 빌더·잘림 좌표용으로만 유지.
 * + 편집 모드(2026-06-10, 사용자 요청): iframe 은 정적이라 contenteditable 수정이 불가능 → 미리보기를 클릭하면
 *   iframe 을 숨기고 원본(편집 가능)을 보여 수정하게 하고, 미리보기 밖을 클릭하면 수정 내용이 반영된 iframe 으로 자동 복귀. */
let _vpRcEditMode=false;
let _vpRcOutsideBound=false;
let _vpLastRenderFmt=null;   /* 직전 렌더 양식 — 같은 양식 재렌더(행 추가/삭제 등)에선 편집 모드 유지 판단용 */
function _vpRcOutsideDown(e){
  if(!_vpRcEditMode)return;
  const preview=document.getElementById('vpPreview'); if(!preview)return;
  if(preview.contains(e.target))return;          /* 미리보기 안 클릭 → 계속 편집 */
  _vpRcExitEdit();
}
function _vpRcResetEdit(){
  _vpRcEditMode=false;
  if(_vpRcOutsideBound){ document.removeEventListener('mousedown',_vpRcOutsideDown,true); _vpRcOutsideBound=false; }
}
/* 미리보기 좌측 상단 모드 배지 — '인쇄 미리 보기' ↔ '수정 모드'.
 * 커서를 올리면 화면이 미세하게 바뀌는 이유를 사용자가 바로 알 수 있게 (사용자 요청 2026-06-11). */
function _vpSetModeBadge(editing){
  const b=document.getElementById('vpModeBadge'); if(!b)return;
  if(editing){ b.textContent='수정 모드'; b.style.background='rgba(22,163,74,0.12)'; b.style.color='#16a34a'; b.style.borderColor='rgba(22,163,74,0.4)'; }
  else { b.textContent='인쇄 미리 보기'; b.style.background='rgba(99,102,241,0.12)'; b.style.color='#6366f1'; b.style.borderColor='rgba(99,102,241,0.35)'; }
}
function _vpRcEnterEdit(e){
  const preview=document.getElementById('vpPreview'); if(!preview)return;
  _vpRcEditMode=true;
  _vpSetModeBadge(true);
  /* 크로스페이드 — iframe 은 서서히 사라지고 편집 화면이 겹치며 나타남 (전환이 극단적이지 않게, 2026-06-10) */
  const ifr=document.getElementById('vpRcPrintFrame');
  if(ifr){ ifr.style.opacity='0'; setTimeout(function(){ if(_vpRcEditMode)ifr.style.display='none'; },200); }
  const ov=document.getElementById('vpRcEditOverlay'); if(ov)ov.style.display='none';
  const hint=document.getElementById('vpRcEditHint'); if(hint)hint.style.opacity='0';
  preview.classList.add('vp-rc-editing');   /* 입력 가능한 칸 시각 표시 (CSS .vp-rc-editing) */
  preview.style.opacity='1';
  if(!_vpRcOutsideBound){ document.addEventListener('mousedown',_vpRcOutsideDown,true); _vpRcOutsideBound=true; }
  /* 클릭 지점을 그대로 편집 칸으로 포워딩 — 한 번의 클릭으로 바로 caret 이 박히게 */
  const cx=e?e.clientX:null, cy=e?e.clientY:null;
  setTimeout(function(){ try{
    if(cx==null)return;
    const el=document.elementFromPoint(cx,cy); if(!el||!el.closest)return;
    const ce=el.closest('[contenteditable="true"]');
    if(ce && preview.contains(ce)){
      ce.focus();
      try{ const r=document.caretRangeFromPoint(cx,cy); if(r){ const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } }catch(_){}
    }
  }catch(_){} },0);
}
function _vpRcExitEdit(){
  if(!_vpRcEditMode)return;
  _vpRcResetEdit();
  _vpSetModeBadge(false);
  const preview=document.getElementById('vpPreview'); if(!preview)return;
  preview.classList.remove('vp-rc-editing');
  if(!preview.classList.contains('vp-preview-receipt'))return; /* 그 사이 A4 로 바뀌었으면 그대로 둠 */
  try{ if(document.activeElement && preview.contains(document.activeElement)) document.activeElement.blur(); }catch(_){}
  preview.style.opacity='0';
  /* 편집된 현재 DOM(vpBuildPrintContent 가 라이브 DOM 복제) 기준으로 인쇄 미리보기 재생성 → 수정 내용 그대로 보임 */
  _vpDefRenderCutLine(preview);
  _vpReceiptShowPrintFrame(preview);
}
function _vpReceiptShowPrintFrame(preview){
  const container=document.getElementById('vpDefZoomContainer'); if(!container||!preview) return;
  if(_vpRcEditMode) return;   /* 편집 중에는 iframe 으로 덮지 않음 (편집 종료 시 _vpRcExitEdit 가 재생성) */
  let ifr=document.getElementById('vpRcPrintFrame');
  if(!ifr){ ifr=document.createElement('iframe'); ifr.id='vpRcPrintFrame'; ifr.setAttribute('scrolling','no'); container.appendChild(ifr); }
  _vpLoadExtra();
  const _html=_vpComposePrintHtml(vpBuildPrintContent(), false, (_vpExtraBottomMm||0), true).replace('__RECEIPT_PAGE_H__','72mm 999mm');
  ifr.style.cssText='position:absolute;left:'+preview.offsetLeft+'px;top:'+preview.offsetTop+'px;width:'+preview.offsetWidth+'px;height:'+Math.max(preview.offsetHeight,120)+'px;border:0;background:#fff;z-index:0;overflow:hidden;opacity:0';
  ifr.srcdoc=_html;
  /* 페이드 인 — 로드 완료(onload) 시 1 로, 폴백 타이머로도 보장 */
  setTimeout(function(){ if(!_vpRcEditMode)ifr.style.opacity='1'; },250);
  /* 편집 진입용 투명 오버레이 — iframe 위를 덮어 호버/클릭을 받는다 (iframe 내부는 별도 문서라 감지 불가).
     호버만으로 편집 모드 진입 (사용자 요청 2026-06-10: 클릭 없이 커서만 올리면 ➕➖/✏️ 가 바로 보이게).
     커서가 실제 미리보기 영역 안에 있을 때만 진입 — 영역 밖(iframe 여분 높이)에서 진입하면 못 빠져나가는 루프 방지. */
  let ov=document.getElementById('vpRcEditOverlay');
  if(!ov){
    ov=document.createElement('div'); ov.id='vpRcEditOverlay'; container.appendChild(ov);
    ov.addEventListener('mousemove',function(ev){
      if(_vpRcEditMode)return;
      const pv=document.getElementById('vpPreview'); if(!pv)return;
      const r=pv.getBoundingClientRect();
      if(ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom) _vpRcEnterEdit(null);
    });
    /* 클릭 진입 폴백 — 호버 이벤트가 안 닿는 경우(빠른 클릭 등)에도 동작 */
    ov.addEventListener('mousedown',function(ev){ if(ev.button!==0)return; ev.preventDefault(); ev.stopPropagation(); _vpRcEnterEdit(ev); });
  }
  ov.style.cssText='position:absolute;left:'+preview.offsetLeft+'px;top:'+preview.offsetTop+'px;width:'+preview.offsetWidth+'px;height:'+Math.max(preview.offsetHeight,120)+'px;z-index:1;cursor:text;background:transparent';
  /* 커서가 미리보기를 벗어나면 인쇄 미리보기로 복귀 — 단, 입력 중(미리보기 안에 포커스)이면 유지 */
  if(!preview._vpRcHoverBound){
    preview._vpRcHoverBound=true;
    preview.addEventListener('mouseleave',function(){
      if(!_vpRcEditMode)return;
      const ae=document.activeElement;
      if(ae && ae!==document.body && preview.contains(ae))return; /* 타이핑/포커스 중 → 유지 (바깥 클릭 시 종료) */
      _vpRcExitEdit();
    });
  }
  ifr.onload=function(){ try{
    const b=ifr.contentDocument&&ifr.contentDocument.body;
    if(b){ ifr.style.height=(Math.max(b.scrollHeight, (b.parentNode&&b.parentNode.scrollHeight)||0)+2)+'px'; const o2=document.getElementById('vpRcEditOverlay'); if(o2)o2.style.height=ifr.style.height; }
    if(!_vpRcEditMode)ifr.style.opacity='1';   /* 크로스페이드 인 */
  }catch(e){} };
}
export function vpUpdatePreview(){
  /* 양식이 바뀌면 그 양식의 내용 선택을 로드(양식별 독립). 같은 양식 재렌더(토글 등)에선 재로드 안 함. (2026-06-19) */
  if(_vpLastContentFormat !== vpState.format){
    _vpLastContentFormat = vpState.format;
    vpState.content = _vpLoadContentForFormat(vpState.format);
    _vpSyncContentBar();
  }
  const preview = document.getElementById('vpPreview');
  _vpSyncVsChip();
  _vpUpdateSymTreatComboChip();
  _vpUpdateTeacherChips();
  _vpBindAllContentTips();
  const _isCustom = /^custom\d+$/.test(vpState.format||'');
  if(vpState.format === 'default' || vpState.format === 'meal_request' || vpState.format === 'rest_referral' || vpState.format === 'referral' || _isCustom){
    /* 양식별 도장/서명 위치 복원 — 렌더 직전에 적용 */
    _vpSigPosLoad();
    if(_isCustom) preview.innerHTML = vpBuildCustomTemplate(vpState.format);
    else if(vpState.format === 'meal_request') preview.innerHTML = vpBuildMealRequestTemplate();
    else if(vpState.format === 'rest_referral') preview.innerHTML = vpBuildDefaultTemplate({title:'보건실 안정 의뢰서', confirmKey:'restReferral'});   /* 방문 확인증과 동일, 제목만 다름 (2026-06-11) */
    else if(vpState.format === 'referral') preview.innerHTML = vpBuildReferralTemplate();
    else preview.innerHTML = vpBuildDefaultTemplate();
    if(_isCustom) setTimeout(_vpAttachCustomCellHandlers, 30);
    /* v3 (사용자 결정 2026-05-21) — vp-confirm 편집/되돌리기/저장/취소/토큰 chip 클릭 위임 부착 */
    setTimeout(function(){
      _vpAttachTplHandlers(preview);
      /* "클릭하여 입력" 안내 — OS title 대신 프로그램 전용 흰 배경 툴팁(vp-tip-popup)으로 통일 (사용자 요청 2026-06-10) */
      preview.querySelectorAll('[data-tip]').forEach(_vpBindTipPopup);
    }, 30);
    const isA4=vpState.paper==='a4';
    preview.classList.toggle('vp-preview-a4', isA4);
    preview.classList.toggle('vp-preview-receipt', !isA4);
    preview.style.position='relative';
    preview.style.overflow='visible';
    /* 용지별 기본 줌 — 영수증은 인쇄와 1:1 비교 위해 줌 100%, A4는 화면 맞춤 85% */
    vpDefZoomSet(isA4?85:100);
    /* 3인치 영수증: 절단선 (A4에서는 절대 안 보임) */
    if(!isA4){
      /* 미리보기를 인쇄와 동일하게 — 인쇄 전용 CSS(72mm)를 #vpPreview 에 그대로 적용(보이는 그대로 출력). */
      /* 같은 양식 재렌더(행 추가/삭제·라벨 편집·내용 토글)는 편집 모드 유지 — 아이콘 작업 중 인쇄 미리보기로 튕기지 않게.
         양식이 바뀐 경우에만 편집 모드 해제 후 인쇄 iframe 으로 초기화 (사용자 요청 2026-06-10) */
      if(vpState.format!==_vpLastRenderFmt) _vpRcResetEdit();
      preview.style.width='72mm';
      _vpApplyReceiptMatchCss(true);
      if(_vpRcEditMode){
        preview.classList.add('vp-rc-editing');
        preview.style.opacity='1';   /* 편집 계속 — iframe 은 숨겨진 상태 유지, 절단선만 갱신 */
        _vpSetModeBadge(true);
        setTimeout(function(){_vpDefRenderCutLine(preview);},50);
      } else {
        preview.classList.remove('vp-rc-editing');
        preview.style.opacity='0';   /* 원본 템플릿은 인쇄 내용 빌더(vpBuildPrintContent)·잘림선 좌표용으로만 유지, 화면엔 인쇄 iframe 표시 */
        _vpSetModeBadge(false);
        setTimeout(function(){_vpDefRenderCutLine(preview); _vpReceiptShowPrintFrame(preview);},50);
      }
    } else {
      /* A4: 절단선 제거 + 영수증 매칭 CSS 해제 + 인쇄 iframe·편집 오버레이 제거 + 템플릿 다시 보이게 */
      _vpRcResetEdit();
      _vpSetModeBadge(true);   /* A4 는 항상 직접 편집 가능 → '수정 모드' 표시 */
      preview.classList.remove('vp-rc-editing');
      preview.style.width='';
      preview.style.opacity='';
      _vpApplyReceiptMatchCss(false);
      const cont=document.getElementById('vpDefZoomContainer');
      if(cont){cont.querySelectorAll('.vp-def-cut-line,[id^="vpDefCut"]').forEach(function(el){el.remove();}); ['vpRcPrintFrame','vpRcEditOverlay','vpRcEditHint'].forEach(function(id){const el=document.getElementById(id); if(el)el.remove();});}
    }
    _vpLastRenderFmt=vpState.format;
    /* 도장/서명 드래그 이벤트 */
    setTimeout(function(){_vpSigInitDrag(preview);},60);
  } else {
    const canvas = document.getElementById('vpeCanvas');
    if(canvas) canvas.className = 'vp-editor-canvas ' + vpState.paper;
    setTimeout(vpeDrawRulers,100);
  }
}
/* ── 도장/서명 위치 감지 + 드래그 ── */
function _vpSigInitDrag(preview){
  /* 도장은 "(서명/인)" 글자에 CSS 로 중심 고정 → 드래그/오프셋 비활성화 (미리보기=인쇄 일치). (2026-06-01)
   * 아래 구 드래그 로직은 미사용. */
  return;
  const sigImg=document.getElementById('vpSigStampImg');
  if(!sigImg)return;
  /* 손 모양 커서 명시 */
  sigImg.style.cursor='grab';
  const sigText=document.getElementById('vpSigInText');
  /* 저장된 위치가 없으면 → 첫 클릭 시 (서명/인) 텍스트 중앙에 겹쳐 배치 (도장처럼) */
  if(!_vpSigOffsetX&&!_vpSigOffsetY&&sigText){
    const parentDiv=sigImg.parentElement;
    const textRect=sigText.getBoundingClientRect();
    const parentRect=parentDiv.getBoundingClientRect();
    const imgW=sigImg.naturalWidth?Math.min(80,sigImg.naturalWidth):60;
    const imgH=sigImg.naturalHeight?Math.min(50,sigImg.naturalHeight):40;
    /* 텍스트의 중앙 좌표 - 이미지 절반 */
    const txtCenterX=(textRect.left+textRect.right)/2-parentRect.left;
    const txtCenterY=(textRect.top+textRect.bottom)/2-parentRect.top;
    _vpSigOffsetX=Math.round(txtCenterX-imgW/2);
    _vpSigOffsetY=Math.round(txtCenterY-imgH/2);
    sigImg.style.left=_vpSigOffsetX+'px';
    sigImg.style.top=_vpSigOffsetY+'px';
    _vpSigPosSave(); /* 첫 배치 저장 → 다음 실행 / 도장↔서명 전환 / 다른 슬롯 선택 시 동일 위치 사용 */
  } else {
    /* 복원된 위치 적용 — 도장↔서명, 다른 슬롯 선택 모두 동일 위치 사용 */
    sigImg.style.left=_vpSigOffsetX+'px';
    sigImg.style.top=_vpSigOffsetY+'px';
  }
  /* 드래그 */
  sigImg.addEventListener('mousedown',function(e){
    e.preventDefault();e.stopPropagation();
    sigImg.style.cursor='grabbing';
    const startX=e.clientX, startY=e.clientY;
    const startL=parseInt(sigImg.style.left)||0, startT=parseInt(sigImg.style.top)||0;
    const zoom=(_vpDefZoom||100)/100;
    function onMove(ev){
      _vpSigOffsetX=Math.round(startL+(ev.clientX-startX)/zoom);
      _vpSigOffsetY=Math.round(startT+(ev.clientY-startY)/zoom);
      sigImg.style.left=_vpSigOffsetX+'px';
      sigImg.style.top=_vpSigOffsetY+'px';
    }
    function onUp(){
      sigImg.style.cursor='grab';
      _vpSigPosSave(); /* 드래그 종료 시 즉시 영구 저장 */
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}

/* ── 3인치 인쇄 여백 조절 (▲▼ 버튼) — 양식별 여분 아래 여백(mm). 인쇄 높이 = 콘텐츠 + 여분. (2026-06-01)
 *  드래그 절단선의 부정확함을 대체 — 클릭당 고정 step 으로 정확히 위/아래 이동. */
let _vpExtraBottomMm = 0;
const _VP_EXTRA_STEP = 5;     /* 클릭당 mm */
const _VP_EXTRA_MAX = 100;
let _vpExtraBound = false;
let _vpExtraUserSet = false;   /* 사용자가 ▲▼ 로 직접 조절했는지 — 조절 전엔 양식별 기본값 사용 */
/* 인쇄 여백은 저장하지 않음 — 매 방문증/세션마다 0 에서 시작(필요할 때만 그때그때 조절).
 *  방문증 열 때 vpResetPrintExtra() 로 0 초기화. (2026-06-01) */
/* 절단선 기본 여백: 모든 양식 공통 10mm(이름에 안 붙게). ▼ 로 더 늘릴 수 있고, ▲ 는 10mm 까지만. (2026-06-01) */
const _VP_EXTRA_MIN = 10;
function _vpLoadExtra(){ _vpExtraBottomMm = Math.max(_VP_EXTRA_MIN, Math.min(_VP_EXTRA_MAX, _vpExtraBottomMm||0)); }
function _vpSaveExtra(){ /* 영구 저장 안 함 — 다음 번 초기화 */ }
export function vpResetPrintExtra(){ _vpExtraBottomMm = _VP_EXTRA_MIN; _vpExtraUserSet = false; }
/* 양식 선택 시 인쇄 여백 기본값 — 양식 종류 무관 10mm. (2026-06-01) */
export function vpSetExtraDefault(isCustom){ _vpExtraBottomMm = _VP_EXTRA_MIN; _vpExtraUserSet = false; }
function _vpUpdateExtraUI(){
  const lbl=document.getElementById('vpExtraLabel'); if(lbl)lbl.textContent='+'+_vpExtraBottomMm+'mm';
  const up=document.getElementById('vpExtraUpBtn');
  if(up){ const dis=_vpExtraBottomMm<=_VP_EXTRA_MIN; up.style.opacity=dis?'0.35':''; up.style.cursor=dis?'default':'pointer'; up.dataset.dis=dis?'1':''; }
  const dn=document.getElementById('vpExtraDownBtn');
  if(dn){ const dis=_vpExtraBottomMm>=_VP_EXTRA_MAX; dn.style.opacity=dis?'0.35':''; dn.style.cursor=dis?'default':'pointer'; dn.dataset.dis=dis?'1':''; }
}
function _vpAdjustExtra(delta){
  _vpLoadExtra();
  _vpExtraUserSet = true;   /* 사용자가 직접 조절 → 이후 양식 기본값 무시 */
  _vpExtraBottomMm = Math.max(_VP_EXTRA_MIN, Math.min(_VP_EXTRA_MAX, _vpExtraBottomMm+delta));
  _vpSaveExtra();
  _vpUpdateExtraUI();
  const preview=document.getElementById('vpPreview');
  if(preview){ _vpDefRenderCutLine(preview); _vpReceiptShowPrintFrame(preview); }   /* 절단선 + 인쇄 iframe 즉시 갱신 */
}
function _vpBindExtraBtns(){
  if(_vpExtraBound)return;
  const up=document.getElementById('vpExtraUpBtn'), dn=document.getElementById('vpExtraDownBtn');
  if(!up||!dn)return;
  _vpExtraBound=true;
  up.addEventListener('click',function(){ if(this.dataset.dis==='1')return; _vpAdjustExtra(-_VP_EXTRA_STEP); });
  dn.addEventListener('click',function(){ if(this.dataset.dis==='1')return; _vpAdjustExtra(_VP_EXTRA_STEP); });
}
function _vpDefRenderCutLine(preview){
  const container=document.getElementById('vpDefZoomContainer');
  if(!container)return;
  /* 절단선 요소 모두 제거 */
  container.querySelectorAll('.vp-def-cut-line,[id^="vpDefCut"]').forEach(function(el){el.remove();});
  /* v3 (사용자 결정 2026-05-21) — vp-confirm 편집 모드 중에는 절단선 안 그림. setTimeout 으로 늦게 호출돼도 가드. */
  if(document.querySelector('.vp-confirm.vp-editing')) return;
  /* 마지막 콘텐츠 하단 + 1cm(38px) */
  let contentBottom=0;
  Array.from(preview.children).forEach(function(el){
    const bot=el.offsetTop+el.offsetHeight;
    if(bot>contentBottom)contentBottom=bot;
  });
  /* 인쇄 여백(▲▼ 버튼) — 콘텐츠 바닥 + 사용자가 지정한 여분 여백(mm→px, 미리보기 302px=80mm).
   * 기본 0 = 콘텐츠 바닥(최소, ▲ 비활성). 행 추가 시 콘텐츠 바닥이 내려가 함께 이동. (2026-06-01) */
  _vpLoadExtra();
  /* 모든 양식 공통: 절단선은 콘텐츠(이름) 바닥에서 '무조건' 최소 10mm 아래(이름에 안 붙게). ▼ 로 더 늘릴 수 있음. (2026-06-01) */
  if(_vpExtraBottomMm < _VP_EXTRA_MIN) _vpExtraBottomMm = _VP_EXTRA_MIN;
  _vpDefCutY=contentBottom+Math.round(_vpExtraBottomMm*302/80);

  const pLeft=preview.offsetLeft;
  const pW=preview.offsetWidth;
  const pTop=preview.offsetTop;

  /* dim 높이 — 점선 아래로 컨테이너 끝까지 충분히 덮도록. 동적 갱신용 헬퍼. */
  const _calcDimHeight=function(cutTop){
    const containerH = Math.max(container.scrollHeight||0, container.offsetHeight||0, cutTop+1200);
    return Math.max(400, containerH - cutTop + 800);
  };

  const line=document.createElement('div');
  line.className='vp-def-cut-line';
  line.id='vpDefCutLine';
  line.style.left=pLeft+'px';
  line.style.width=pW+'px';
  line.style.top=(pTop+_vpDefCutY)+'px';
  line.style.cursor='default';
  line.style.pointerEvents='none';
  line.title='여기서 잘림 (자동 위치)';
  container.appendChild(line);

  /* dim — 점선 아래 회색 오버레이 (잘릴 영역 시각 표시). 반투명이라 콘텐츠는 그대로 보임. */
  const dim=document.createElement('div');
  dim.id='vpDefCutDim';
  const dimTopInit = pTop+_vpDefCutY;
  dim.style.cssText='position:absolute;left:'+pLeft+'px;width:'+pW+'px;top:'+dimTopInit+'px;height:'+_calcDimHeight(dimTopInit)+'px;background:rgba(0,0,0,0.28);pointer-events:none;z-index:1';
  container.appendChild(dim);

  /* 라벨 + 인쇄여백 ▲▼ 컨트롤 — 절단선에 직접 부착(직관적): 위 ▲(여백↓) / [✂ 여기서 잘림] / 아래 ▼(여백↑) / +Xmm. (2026-06-01)
   * 매 렌더마다 재생성되므로 클릭 핸들러도 매번 새로 바인딩(이전 요소는 위에서 제거됨). */
  const ctrl=document.createElement('div');
  ctrl.id='vpDefCutLabel';
  ctrl.style.cssText='position:absolute;left:'+(pLeft+pW+8)+'px;top:'+(pTop+_vpDefCutY)+'px;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:3px;z-index:9999;user-select:none';
  const _upDis=_vpExtraBottomMm<=_VP_EXTRA_MIN, _dnDis=_vpExtraBottomMm>=_VP_EXTRA_MAX;
  const _btnCss='width:30px;height:20px;border:1.5px solid #b91c1c;border-radius:6px;background:#fff;color:#b91c1c;font-size:11px;font-weight:900;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.2)';
  ctrl.innerHTML=
    '<button id="vpExtraUpBtn" title="여백 줄이기 (위로)" style="'+_btnCss+(_upDis?';opacity:0.35;cursor:default':'')+'">▲</button>'
    +'<div style="font-size:13px;font-weight:800;color:#fff;background:#ef4444;border:1.5px solid #b91c1c;border-radius:8px;padding:4px 12px;white-space:nowrap;box-shadow:0 2px 6px rgba(239,68,68,0.40)">✂ 여기서 잘림</div>'
    +'<button id="vpExtraDownBtn" title="여백 늘리기 (아래로)" style="'+_btnCss+(_dnDis?';opacity:0.35;cursor:default':'')+'">▼</button>'
    +'<div id="vpExtraLabel" style="font-size:11px;font-weight:800;color:#b91c1c;background:#fff;border:1px solid #fca5a5;border-radius:6px;padding:1px 7px;white-space:nowrap">+'+_vpExtraBottomMm+'mm</div>';
  container.appendChild(ctrl);
  const _upB=ctrl.querySelector('#vpExtraUpBtn'), _dnB=ctrl.querySelector('#vpExtraDownBtn');
  if(_upB) _upB.addEventListener('click',function(){ if(_vpExtraBottomMm<=0)return; _vpAdjustExtra(-_VP_EXTRA_STEP); });
  if(_dnB) _dnB.addEventListener('click',function(){ if(_vpExtraBottomMm>=_VP_EXTRA_MAX)return; _vpAdjustExtra(_VP_EXTRA_STEP); });
  /* 마우스 휠로 5mm 씩 즉시 조절 (아래로 스크롤=여백↑, 위로=여백↓) + 호버 미니 툴팁(자유처치 칩과 동일 GUI=showHeaderTooltip).
   * ctrl 은 매 렌더 재생성되므로 리스너도 매번 새로 바인딩. (사용자 요청 2026-06-01) */
  ctrl.addEventListener('wheel',function(ev){ ev.preventDefault(); ev.stopPropagation(); _vpAdjustExtra(ev.deltaY>0?_VP_EXTRA_STEP:-_VP_EXTRA_STEP); },{passive:false});
  ctrl.addEventListener('mouseenter',function(ev){ showHeaderTooltip(ev,'마우스 스크롤을 통해서 5mm 씩 조절할 수 있습니다.',false,true); });
  ctrl.addEventListener('mouseleave',function(){ hideHeaderTooltip(); });
}

/* ── 보건실 방문 확인증 줌 & 눈금자 ── */
let _vpDefZoom=100;
export function vpDefZoomSet(pct){
  _vpDefZoom=Math.max(80,Math.min(120,pct));
  const container=document.getElementById('vpDefZoomContainer');
  if(container){container.style.transform='scale('+(_vpDefZoom/100)+')';container.style.transformOrigin='top center';}
  const slider=document.getElementById('vpDefZoomSlider');if(slider)slider.value=_vpDefZoom;
  const label=document.getElementById('vpDefZoomLabel');if(label&&!label.querySelector('input'))label.textContent=_vpDefZoom+'%';
  setTimeout(vpDefDrawRulers,50);
}
export function vpDefZoomFit(){
  const area=document.getElementById('vpDefScrollArea');
  const preview=document.getElementById('vpPreview');
  if(!area||!preview)return;
  const curZoom=_vpDefZoom/100;
  const origW=preview.offsetWidth/curZoom;
  const origH=preview.offsetHeight/curZoom;
  const areaW=area.clientWidth-60, areaH=area.clientHeight-60;
  const fit=Math.min(areaW/origW,areaH/origH)*100;
  vpDefZoomSet(Math.round(Math.max(80,Math.min(120,fit))));
}
export function vpDefDrawRulers(){
  const preview=document.getElementById('vpPreview');if(!preview)return;
  const scroll=document.getElementById('vpDefScrollArea');if(!scroll)return;
  const zoom=_vpDefZoom/100;
  /* preview의 화면상 위치를 직접 측정 */
  const prevRect=preview.getBoundingClientRect();
  const scrollRect=scroll.getBoundingClientRect();
  /* preview 시작점 (scroll 영역 기준, 스크롤 보정) */
  const ox=prevRect.left-scrollRect.left;
  const oy=prevRect.top-scrollRect.top;
  /* 용지 실제 mm 크기 */
  const isA4=vpState.paper==='a4';
  const paperWmm=isA4?210:76.2; /* A4=210mm, 3인치=76.2mm */
  const paperHmm=isA4?297:200;
  /* 화면상 preview 폭으로부터 1mm = 몇 화면 px 계산 */
  const screenPxPerMm=prevRect.width/paperWmm;
  const clr=getComputedStyle(document.documentElement).getPropertyValue('--t3')||'#888';
  const accentClr='#06b6d4';
  /* DPR 보정 */
  const dpr=window.devicePixelRatio||1;
  /* ── 상단 눈금자 ── */
  const topC=document.getElementById('vpDefRulerTopC');if(!topC)return;
  const topW=scroll.clientWidth;
  topC.style.width=topW+'px';topC.style.height='24px';
  topC.width=Math.round(topW*dpr);topC.height=Math.round(24*dpr);
  const ctx=topC.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,topW,24);
  ctx.font='8px sans-serif';ctx.textBaseline='top';
  const maxCmX=Math.ceil(paperWmm/10)+1;
  for(let cm=0;cm<=maxCmX;cm++){
    const px=ox+cm*10*screenPxPerMm;
    if(px<-20||px>topW+20)continue;
    ctx.fillStyle=cm%5===0?accentClr:clr;
    ctx.fillRect(Math.round(px),12,1,12);
    if(cm>0)ctx.fillText(cm+'cm',Math.round(px)+2,1);
    if(screenPxPerMm>3){
      ctx.fillStyle='rgba(150,150,150,0.35)';
      for(let mm=1;mm<10;mm++){
        const mpx=ox+(cm*10+mm)*screenPxPerMm;
        if(mpx>0&&mpx<topW)ctx.fillRect(Math.round(mpx),mm===5?16:19,1,mm===5?8:5);
      }
    }
  }
  /* ── 왼쪽 눈금자 ── */
  const leftC=document.getElementById('vpDefRulerLeftC');if(!leftC)return;
  const leftH=scroll.clientHeight;
  leftC.style.width='24px';leftC.style.height=leftH+'px';
  leftC.width=Math.round(24*dpr);leftC.height=Math.round(leftH*dpr);
  const ctx2=leftC.getContext('2d');
  ctx2.scale(dpr,dpr);
  ctx2.clearRect(0,0,24,leftH);
  ctx2.font='8px sans-serif';ctx2.textBaseline='middle';
  const maxCmY=Math.ceil(paperHmm/10)+1;
  for(let cm2=0;cm2<=maxCmY;cm2++){
    const py=oy+cm2*10*screenPxPerMm;
    if(py<-20||py>leftH+20)continue;
    ctx2.fillStyle=cm2%5===0?accentClr:clr;
    ctx2.fillRect(12,Math.round(py),12,1);
    if(cm2>0){ctx2.save();ctx2.translate(10,Math.round(py)+2);ctx2.rotate(-Math.PI/2);ctx2.textBaseline='bottom';ctx2.fillText(cm2+'cm',0,0);ctx2.restore();}
    if(screenPxPerMm>3){
      ctx2.fillStyle='rgba(150,150,150,0.35)';
      for(let mm2=1;mm2<10;mm2++){
        const mpy=oy+(cm2*10+mm2)*screenPxPerMm;
        if(mpy>0&&mpy<leftH)ctx2.fillRect(mm2===5?16:19,Math.round(mpy),mm2===5?8:5,1);
      }
    }
  }
}

function vpBuildPrintContent(){
  /* 2026-05-20 — 커스텀 양식도 vpPreview 를 사용하므로 옛 에디터 캔버스 분기 제거 */
  const previewEl = document.getElementById('vpPreview');
  if(!previewEl) return '';
  const clone = previewEl.cloneNode(true);
  clone.querySelectorAll('.vp-cust-del').forEach(function(el){el.remove();});
  /* 호버 아이콘(✏️↺➕➖) · placeholder chip 은 인쇄에 포함하지 않는다.
   * - .vp-cf-l-icons : 커스텀 슬롯의 라벨/확인문/푸터 편집 아이콘 묶음
   * - .vp-tpl-tools  : 표준 양식(방문확인증/급식/진료) 하단 vp-confirm 의 ✏️↺
   * - .vp-ph-chip    : 방문자 미선택 시 빈 셀에 띄우는 UI 힌트 칩(📅 방문한 날짜 등) */
  clone.querySelectorAll('.vp-cf-l-icons, .vp-tpl-tools, .vp-ph-chip').forEach(function(el){el.remove();});
  clone.querySelectorAll('[contenteditable]').forEach(function(el){el.removeAttribute('contenteditable');});
  return clone.innerHTML;
}
let _vpPrintMargin=(typeof _vpeMarginMM!=='undefined'?_vpeMarginMM:7);
const _vpPrintScale=100;
/* 인쇄용 HTML 조립 (용지별 CSS + 절단선 스페이서). vpDirectPrint 와 인쇄 다이얼로그 미리보기 공용 — 보이는대로 출력 보장. (2026-06-02)
 * 영수증은 @page 높이를 측정 후 '__RECEIPT_PAGE_H__' 치환. extraMm = 절단선(▲▼/휠) 여백 → 미리보기에도 그대로 반영. */
function _vpComposePrintHtml(content, isA4, extraMm, previewMode){
  /* 여백 스페이서 — 감열 프린터는 내용 끝(마지막 잉크)에서 자르고 뒤쪽 빈 공간을 잘라내므로,
   * 여백 맨 아래에 거의 안 보이는 마커(연한 점)를 둬 프린터가 그 지점까지 종이를 밀어내게 한다. (2026-06-02)
   * previewMode=true(화면 미리보기)에서는 마커를 투명 처리 — 빨간 절단선 위 검은 선으로 보여 혼란 (사용자 요청 2026-06-10).
   * 실제 인쇄(vpDirectPrint)에서는 마커가 있어야 프린터가 여백 끝까지 종이를 밀어내므로 그대로 유지. */
  const _cutSpacer = (extraMm>0)
    ? '<div style="height:'+extraMm+'mm;box-sizing:border-box;margin:0;padding:0;position:relative"><div style="position:absolute;left:0;right:0;bottom:0;height:0;border-top:1px solid '+(previewMode?'transparent':'#d0d0d0')+';font-size:0;line-height:0">&#8203;</div></div>'
    : '';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    +'@page{size:'+(isA4?'A4':'__RECEIPT_PAGE_H__')+';margin:0}'
    +'*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}'
    +'html{margin:0;padding:0;background:#fff;color:#000}'
    +(isA4
      ? 'body{font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:13px;line-height:1.65;font-weight:500;width:184mm;margin:12mm 12mm 12mm 12mm;background:#fff;color:#000}'
        +'h2{font-size:18px;font-weight:900;text-align:center;margin:0 0 12px;padding-bottom:7px;border-bottom:2px solid #000;letter-spacing:0.5px;color:#000}'
        +'.vp-info-table{width:100%;border-collapse:collapse;margin:6px 0;font-size:12px;font-weight:500}'
        +'.vp-info-table td{padding:6px 6px;border:1.2px solid #000;color:#000;word-break:keep-all;overflow-wrap:anywhere}'
        +'.vp-info-table .label{background:#d8d8d8;font-weight:800;width:70px;text-align:center;white-space:nowrap;color:#000}'
        +'.vp-confirm{text-align:center;margin:12px 0 6px;font-size:12px;line-height:1.7;color:#000;font-weight:600}'
        +'.vp-footer{text-align:center;margin-top:10px;font-size:12px;color:#000;font-weight:600}'
        +'.vp-sig-area{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:8px}'
        +'.vp-sig-area img{max-height:58px;max-width:120px;object-fit:contain}'
      : 'body{font-family:"Pretendard Variable","Pretendard","Noto Sans KR","Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",sans-serif;font-size:16px;line-height:1.5;font-weight:500;width:72mm;padding:6mm 3mm 2mm 5mm;margin:0;background:#fff;color:#000;box-sizing:border-box}'
        +'h2{font-size:19px;font-weight:900;text-align:center;margin:0 0 7px;padding-bottom:5px;line-height:1;border-bottom:1px solid #000;color:#000}'
        +'.vp-info-table{width:100%;border-collapse:collapse;margin:5px 0;font-size:14px}'
        +'.vp-info-table td{padding:4px 5px;border:1px solid #000;color:#000;word-break:keep-all;overflow-wrap:anywhere}'
        +'.vp-info-table .label{background:#d8d8d8;font-weight:800;width:58px;text-align:center;white-space:nowrap;color:#000}'
        +'.vp-confirm{text-align:center;margin:7px 0 4px;font-size:14px;line-height:1.5;color:#000;font-weight:600}'
        +'.vp-footer{text-align:center;margin-top:14px;font-size:14px;color:#000;font-weight:600;line-height:1.8}'
        +'.vp-sig-area{display:flex;justify-content:center;align-items:center;gap:9px;margin-top:10px}'
        +'.vp-sig-area img{max-height:37px;max-width:74px;object-fit:contain}')
    +'img{max-width:100%;height:auto}'
    +'b,strong{font-weight:800;color:#000}'
    +'table{page-break-inside:avoid;break-inside:avoid;table-layout:fixed}'
    +'tr{page-break-inside:avoid;break-inside:avoid}'
    +'.vp-footer,.vp-sig-area{page-break-inside:avoid;break-inside:avoid}'
    /* 인쇄·인쇄 미리보기(iframe)에서는 필요 이유(Reason 등 contenteditable 빈칸) 점선 숨김 —
     * 점선은 마우스를 대면 나오는 편집 화면(라이브 DOM, _vpApplyReceiptMatchCss 쪽)에서만 표시 (사용자 확정 2026-06-10) */
    +'[contenteditable],[id$="Reason"]{min-width:0!important;min-height:0!important;display:inline!important;border-bottom:none!important;width:auto!important;max-width:100%!important}'
    +'td span{max-width:100%;word-break:break-all;white-space:normal}'
    +'.vp-blank-line{display:inline-block!important;min-width:40px;width:auto;min-height:1.1em;border-bottom:1px dashed #555;vertical-align:text-bottom;box-sizing:border-box}'
    +'</style></head><body>'+content+_cutSpacer+'</body></html>';
}
/* ── 인쇄 (HTML 직접 방식 — EMS 와 동일) ──
   미리보기 패널 HTML 을 그대로 페이지 크기에 맞춰 OS 인쇄 다이얼로그로 전송.
   paperArg/deviceArg: 인쇄 다이얼로그에서 용지·프린터 지정 호출용(없으면 기존 동작). (2026-06-02) */
export function vpDirectPrint(paperArg, deviceArg){
  const isA4=(paperArg||vpState.paper)==='a4';
  const content=vpBuildPrintContent();
  if(!content){alert('미리보기 콘텐츠가 비어 있습니다.');return;}
  /* 3인치 영수증 — 콘텐츠 자동 측정만 사용 (잘림선 기능 비활성화 2026-05-26).
   * 폴백용 기본값만 정의, 실제 값은 아래 iframe 측정으로 결정. */
  let receiptPageH = 80;
  let ipcPageH = 80000;
  /* 절단선(▲▼/휠) 여백 — 영수증만. 공용 빌더로 인쇄 HTML 조립(미리보기와 동일 결과 보장). (2026-06-02) */
  _vpLoadExtra();
  const _extraMm = isA4 ? 0 : (_vpExtraBottomMm||0);
  const printHtml = _vpComposePrintHtml(content, isA4, _extraMm);
  if(!(window.electronAPI&&typeof window.electronAPI.printWindowWithSize==='function')){
    alert('인쇄 기능을 사용할 수 없습니다.');return;
  }
  const _send=function(pageH_mm){
    const ps=isA4?'A4':{width:72000,height:Math.round(pageH_mm*1000)};
    /* ★ @page 페이지 높이를 측정값과 일치시킴 — 안 그러면 CSS 의 폴백 80mm 마다 페이지가 나뉘어
     *   하단 문구 아래에서 잘리고 푸터(날짜·학교·직위·이름)가 다음 장으로 넘어감. (2026-06-01) */
    const _html = isA4 ? printHtml : printHtml.replace('__RECEIPT_PAGE_H__', '72mm '+Math.round(pageH_mm)+'mm');
    /* 다이얼로그에서 지정 프린터(deviceArg) 호출 시: 그 프린터로 silent. 직접 호출(A4)은 기존대로 다이얼로그(silent:false). */
    const silent = deviceArg ? true : !isA4;
    window.electronAPI.printWindowWithSize(_html, ps, {marginType:'custom', top:0, bottom:0, left:0, right:0}, undefined, silent, deviceArg||undefined)
      .then(function(res){
        if(res&&!res.success&&!res.cancelled){alert('인쇄 실패: '+(res.error||''));}
      })
      .catch(function(err){console.error(err);alert('인쇄 호출 실패');});
  };
  if(isA4){_send(297);return;}

  /* 영수증 — iframe 에 실제 인쇄 CSS 그대로 렌더해 콘텐츠 정확한 높이 측정.
   * @page 를 측정값에 딱 맞춰 잡아 종이 낭비 최소화. */
  const iframe=document.createElement('iframe');
  iframe.style.cssText='position:absolute;left:-99999px;top:0;width:72mm;height:600mm;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  let _settled=false;
  const _onMeasured=function(){
    if(_settled)return; _settled=true;
    /* @page 높이 = MAX(사용자가 드래그한 잘림선 위치, 실제 인쇄 콘텐츠 높이 + 2mm).
     * 사용자 잘림선 드래그 즉시 반영 + 콘텐츠 잘림 방지 둘 다 보장. */
    let measuredMm = 0;
    try{
      const doc=iframe.contentDocument;
      if(doc && doc.body){
        let px = doc.body.offsetHeight;
        /* 서명 도장(#vpSigStampImg)은 position:absolute 라 offsetHeight 에 안 잡힘 — 사용자가 아래로 드래그하면
         * 도장 하단이 측정 높이를 넘어가 인쇄 시 그 아래에서 잘림. 도장 하단까지 측정에 포함. (2026-06-01) */
        const _stamp = doc.getElementById('vpSigStampImg');
        if(_stamp){
          const _sb = _stamp.getBoundingClientRect().bottom - doc.body.getBoundingClientRect().top;
          if(_sb > px) px = _sb;
        }
        if(px>0) measuredMm = px*25.4/96 + 3;
      }
    }catch(e){console.warn('영수증 높이 측정 실패:',e);}
    try{iframe.remove();}catch(_){}
    /* 최소 80mm (=영수증 폭) 보장 — 그보다 작으면 width > height 가 되어 Chromium 이 가로 인쇄로 인식해 버림.
     * 여백(스페이서)은 이미 본문에 포함돼 measuredMm 에 잡히므로 여기서 또 더하지 않는다. (2026-06-01) */
    /* 여분 여백(▲▼/스크롤)은 항상 페이지에 더해지도록 — 내용 높이에만 세로 보장 floor(>72mm 폭)를 적용하고
     * 그 위에 사용자가 준 여백을 더한다. (이전엔 max(80,…) 가 여백을 80mm 안에 흡수해 짧은 슬립에서 미반영) */
    const _extraMm2 = (_vpExtraBottomMm||0);
    const _baseMm = Math.max(74, measuredMm - _extraMm2);
    const pageH = _baseMm + _extraMm2;
    _send(pageH);
  };
  iframe.addEventListener('load',function(){setTimeout(_onMeasured,80);});
  iframe.srcdoc=printHtml;
  setTimeout(_onMeasured,5000);
}

/* ── 커스텀 양식 인쇄 다이얼로그 (의료기관·EMS 와 동일: 3인치·A4 두 줄 프린터+인쇄+취소 + 두 미리보기). (2026-06-02) ── */
function _vpPvCleanup(){
  ['vpPvBackdrop','vpPvBar','vpPvCardRc','vpPvCardA4','vpPvCapRc','vpPvCapA4','vpPvStyle'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
  try{ window.removeEventListener('resize', _vpPvPosition); }catch(_e){}
}
/* 영수증(열전사) 프린터 이름 판별 — 비어 있을 때 3인치↔A4 기본값이 안 섞이게(의료기관·EMS 와 동일 규칙). */
function _vpIsRcPrinter(n){ n=(n||'').toLowerCase(); return /slk|ts-?200|\bpos\b|영수|receipt|thermal|bixolon|srp|80mm/.test(n); }
/* 프린터 드롭다운 — 공유 설정 키(receipt_printer/a4_printer) 저장·복원. 우선순위: 저장>종류자동>OS기본. 변경 즉시 저장. */
function _vpFillPrinter(selId, settingsKey){
  var sel=document.getElementById(selId); if(!sel||!window.electronAPI||!window.electronAPI.listPrinters)return;
  var isRc=(settingsKey==='receipt_printer');
  sel.addEventListener('change', function(){ try{ window.electronAPI.settingsSet(settingsKey, sel.value||''); }catch(_e){} });
  var _populate=function(last){
    try{
      window.electronAPI.listPrinters().then(function(res){
        var list=(res&&Array.isArray(res.printers))?res.printers:(Array.isArray(res)?res:[]);
        if(!list.length)return;
        var defVal='';
        list.forEach(function(p){var v=p.name||p.deviceName||'';var o=document.createElement('option');o.value=v;o.textContent=(p.displayName||p.name||v)+(p.isDefault?' (기본)':'');sel.appendChild(o);if(p.isDefault)defVal=v;});
        var pick='';
        if(last){for(var i=0;i<list.length;i++){var lv=list[i].name||list[i].deviceName||'';if(lv===last){pick=last;break;}}}
        if(!pick){
          if(isRc){ for(var k=0;k<list.length;k++){var rn=list[k].name||list[k].deviceName||'';if(_vpIsRcPrinter(rn)){pick=rn;break;}} if(!pick)pick=defVal; }
          else { if(defVal&&!_vpIsRcPrinter(defVal))pick=defVal; if(!pick){for(var k2=0;k2<list.length;k2++){var an=list[k2].name||list[k2].deviceName||'';if(an&&!_vpIsRcPrinter(an)){pick=an;break;}}} if(!pick)pick=defVal; }
        }
        if(pick)sel.value=pick; else if(sel.options.length>1)sel.selectedIndex=1;
      }).catch(function(){});
    }catch(e){}
  };
  try{ window.electronAPI.settingsGet(settingsKey,'').then(function(r){ _populate((r&&r.value)||''); }).catch(function(){_populate('');}); }catch(e){ _populate(''); }
}
function _vpPvPosition(){
  var rc=document.getElementById('vpPvCardRc'), a4=document.getElementById('vpPvCardA4'), bar=document.getElementById('vpPvBar');
  if(!rc||!a4)return;
  var barBottom=bar?bar.getBoundingClientRect().bottom:120;
  var topY=barBottom+28, availH=Math.max(160, window.innerHeight-topY-22);
  var a4W=a4.offsetWidth||786, a4H=a4.offsetHeight||1000;
  var rcW=rc.offsetWidth||302, rcH=rc.offsetHeight||500;
  var sA4=Math.min(availH/a4H,(window.innerWidth*0.42)/a4W,0.7); if(!(sA4>0.08))sA4=0.32;
  var sRc=Math.min(availH/rcH,(window.innerWidth*0.26)/rcW,0.9); if(!(sRc>0.08))sRc=0.5;
  var dA4=a4W*sA4, dRc=rcW*sRc, gap=30;
  var startX=Math.max(12,(window.innerWidth-(dA4+gap+dRc))/2);
  a4.style.transformOrigin='top left'; rc.style.transformOrigin='top left';
  a4.style.left=startX+'px'; a4.style.top=topY+'px'; a4.style.transform='scale('+sA4.toFixed(3)+')';
  rc.style.left=(startX+dA4+gap)+'px'; rc.style.top=topY+'px'; rc.style.transform='scale('+sRc.toFixed(3)+')';
  var capA=document.getElementById('vpPvCapA4'), capR=document.getElementById('vpPvCapRc');
  if(capA){capA.style.left=startX+'px';capA.style.top=(topY-21)+'px';}
  if(capR){capR.style.left=(startX+dA4+gap)+'px';capR.style.top=(topY-21)+'px';}
}
/* 인쇄 버튼 → 이 다이얼로그. 미리보기는 실제 인쇄 HTML 을 iframe 에 렌더(보이는대로 출력). 3인치 절단선(▲▼/휠) 여백도 그대로 반영. */
export function vpOpenPrintDialog(){
  var content=vpBuildPrintContent();
  if(!content){alert('미리보기 콘텐츠가 비어 있습니다.');return;}
  _vpPvCleanup();
  _vpLoadExtra();
  var extraMm=_vpExtraBottomMm||0;
  var rcHtml=_vpComposePrintHtml(content,false,extraMm,true).replace('__RECEIPT_PAGE_H__','72mm 999mm');
  var a4Html=_vpComposePrintHtml(content,true,0,true);
  var st=document.createElement('style'); st.id='vpPvStyle';
  st.textContent=
    '#vpPvBackdrop{position:fixed;inset:0;background:rgba(15,23,42,0.62);z-index:30400}'
    +'#vpPvBar{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:32000;display:flex;flex-direction:column;gap:7px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 16px;box-shadow:0 12px 36px rgba(0,0,0,0.35);font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;max-width:94vw}'
    +'#vpPvBar .pv-ttl{font-size:13px;font-weight:800;color:#1a1a2e;margin-bottom:2px}'
    +'#vpPvBar .pv-row{display:flex;align-items:center;gap:7px;font-size:12px;color:#334155}'
    +'#vpPvBar .pv-row .pv-tag{font-weight:800;min-width:58px}'
    +'#vpPvBar select{font-size:12px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;max-width:200px;flex:1}'
    +'#vpPvBar .pv-go{font-size:12px;font-weight:700;padding:5px 14px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:#0891b2;color:#fff}'
    +'#vpPvBar .pv-cl{font-size:12px;font-weight:700;padding:5px 12px;border-radius:8px;cursor:pointer;border:1px solid #cbd5e1;background:#f1f5f9;color:#334155}'
    +'.vp-pv-cap{position:fixed;z-index:31050;font-family:\'Malgun Gothic\',sans-serif;font-size:11px;font-weight:800;color:#fff;background:rgba(15,23,42,0.82);border-radius:6px;padding:2px 9px;pointer-events:none}'
    +'#vpPvCardRc,#vpPvCardA4{position:fixed;background:#fff;box-shadow:0 14px 50px rgba(0,0,0,0.5);border:1px solid #94a3b8;transform-origin:top left;z-index:31000;overflow:hidden}'
    +'#vpPvCardRc iframe,#vpPvCardA4 iframe{border:0;display:block;background:#fff}';
  document.head.appendChild(st);
  var bd=document.createElement('div'); bd.id='vpPvBackdrop'; document.body.appendChild(bd); bd.addEventListener('click',_vpPvCleanup);
  var bar=document.createElement('div'); bar.id='vpPvBar';
  bar.innerHTML='<div class="pv-ttl">🖨 커스텀 양식 인쇄</div>'
    +'<div class="pv-row"><span class="pv-tag">🧾 3인치</span> 프린터 <select id="vpPvPrinterRc"><option value="">기본 프린터</option></select> <button class="pv-go" id="vpPvGoRc">인쇄</button> <button class="pv-cl" id="vpPvClRc">취소</button></div>'
    +'<div class="pv-row"><span class="pv-tag">📄 A4</span> 프린터 <select id="vpPvPrinterA4"><option value="">기본 프린터</option></select> <button class="pv-go" id="vpPvGoA4">인쇄</button> <button class="pv-cl" id="vpPvClA4">취소</button></div>';
  document.body.appendChild(bar);
  var capR=document.createElement('div'); capR.id='vpPvCapRc'; capR.className='vp-pv-cap'; capR.textContent='🧾 3인치 미리보기'; document.body.appendChild(capR);
  var capA=document.createElement('div'); capA.id='vpPvCapA4'; capA.className='vp-pv-cap'; capA.textContent='📄 A4 미리보기'; document.body.appendChild(capA);
  var cardRc=document.createElement('div'); cardRc.id='vpPvCardRc'; document.body.appendChild(cardRc);
  var cardA4=document.createElement('div'); cardA4.id='vpPvCardA4'; document.body.appendChild(cardA4);
  /* scrolling=no → iframe 자체 스크롤바 제거. 높이는 콘텐츠에 정확히 맞춤(+재측정으로 폰트/레이아웃 settle 반영). */
  var ifrRc=document.createElement('iframe'); ifrRc.setAttribute('scrolling','no'); ifrRc.srcdoc=rcHtml; cardRc.appendChild(ifrRc);
  var ifrA4=document.createElement('iframe'); ifrA4.setAttribute('scrolling','no'); ifrA4.srcdoc=a4Html; cardA4.appendChild(ifrA4);
  function _sizeIframe(ifr, card, fallbackW, isA4){
    try{ var d=ifr.contentDocument; var b=d&&d.body, de=d&&d.documentElement; if(b){
      var w=Math.max(b.scrollWidth, de?de.scrollWidth:0, fallbackW||302);
      var h=Math.max(b.scrollHeight, de?de.scrollHeight:0, 60)+2;   /* +2 여유로 마지막 줄 스크롤 방지 */
      /* A4 는 항상 세로(portrait) 페이지 비율로 표시 — 내용이 짧아도 가로 박스로 보이지 않게.
         내용이 한 장보다 길면 그만큼 늘림(min 보장). */
      if(isA4){ h=Math.max(h, Math.round(w*297/210)); }
      ifr.style.width=w+'px'; ifr.style.height=h+'px'; card.style.width=w+'px'; card.style.height=h+'px';
    } }catch(e){}
    _vpPvPosition();
  }
  ifrRc.onload=function(){ _sizeIframe(ifrRc, cardRc, 272); setTimeout(function(){_sizeIframe(ifrRc, cardRc, 272);},120); };
  ifrA4.onload=function(){ _sizeIframe(ifrA4, cardA4, 786, true); setTimeout(function(){_sizeIframe(ifrA4, cardA4, 786, true);},120); };
  _vpPvPosition();
  _vpFillPrinter('vpPvPrinterRc','receipt_printer');
  _vpFillPrinter('vpPvPrinterA4','a4_printer');
  document.getElementById('vpPvClRc').addEventListener('click',_vpPvCleanup);
  document.getElementById('vpPvClA4').addEventListener('click',_vpPvCleanup);
  document.getElementById('vpPvGoRc').addEventListener('click',function(){ var s=document.getElementById('vpPvPrinterRc'); var dev=(s&&s.value)||undefined; if(dev){try{window.electronAPI.settingsSet('receipt_printer',dev);}catch(_e){}} vpDirectPrint('receipt', dev); _vpPvCleanup(); });
  document.getElementById('vpPvGoA4').addEventListener('click',function(){ var s=document.getElementById('vpPvPrinterA4'); var dev=(s&&s.value)||undefined; if(dev){try{window.electronAPI.settingsSet('a4_printer',dev);}catch(_e){}} vpDirectPrint('a4', dev); _vpPvCleanup(); });
  window.addEventListener('resize',_vpPvPosition);
}

function vpShowPrintPreview(){
  /* 에디터 화면을 캡처하여 미리보기 표시 */
  const isCustom=vpState.format.startsWith('custom');
  const target=isCustom?document.getElementById('vpeCanvas'):document.getElementById('vpPreview');
  if(!target||target.offsetWidth===0)return;
  /* 줌 컨테이너의 transform도 해제 (잘림 방지) */
  const zoomContainer=isCustom?null:document.getElementById('vpDefZoomContainer');
  let origZC='', origZCO='';
  if(zoomContainer){origZC=zoomContainer.style.transform;origZCO=zoomContainer.style.transformOrigin;zoomContainer.style.transform='none';zoomContainer.style.transformOrigin='';}
  const origTransform=target.style.transform;
  const origOrigin=target.style.transformOrigin;
  target.style.transform='none';target.style.transformOrigin='';
  const pw=target.offsetWidth, ph=target.offsetHeight;
  html2canvas(target,{useCORS:true,allowTaint:true,scale:2,width:pw,height:ph,backgroundColor:'#ffffff'}).then(function(canvas){
    target.style.transform=origTransform;target.style.transformOrigin=origOrigin;
    if(zoomContainer){zoomContainer.style.transform=origZC;zoomContainer.style.transformOrigin=origZCO;}
    /* 절단선 적용 — 2026-05-20 커스텀 양식도 동일 미리보기 사용하므로 _vpDefCutY 통일 */
    const isA4=vpState.paper==='a4';
    let cutH=0;
    if(!isA4 && _vpDefCutY>0) cutH=_vpDefCutY;
    /* 옛 에디터 캔버스(custom) 잔재용 fallback */
    if(!isA4 && isCustom && !cutH && vpeState._cutY) cutH=vpeState._cutY;
    let finalPh=ph;
    if(cutH>0){
      const sc2=canvas.width/pw;
      const cropH2=Math.round(cutH*sc2);
      const tc2=document.createElement('canvas');tc2.width=canvas.width;tc2.height=cropH2;
      tc2.getContext('2d').drawImage(canvas,0,0,canvas.width,cropH2,0,0,canvas.width,cropH2);
      canvas=tc2;finalPh=cutH;
    }
    const imgData=canvas.toDataURL('image/png');
    _vpShowCapturedPreview(imgData,pw,finalPh);
  }).catch(function(err){
    target.style.transform=origTransform;target.style.transformOrigin=origOrigin;
    if(zoomContainer){zoomContainer.style.transform=origZC;zoomContainer.style.transformOrigin=origZCO;}
    console.error(err);alert('캡처 실패');
  });
}
function _vpShowCapturedPreview(imgData,pw,ph){
  const isA4=vpState.paper==='a4';
  const maxPrevH=Math.min(window.innerHeight*0.65,600);
  const prevScale=Math.min(maxPrevH/ph,500/pw,1);
  const pvW=Math.round(pw*prevScale), pvH=Math.round(ph*prevScale);

  const ov=document.createElement('div');
  ov.id='vpPrintPreviewOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 0';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});

  const card=document.createElement('div');
  card.style.cssText='background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.5);padding:0;overflow:hidden;max-width:90vw';

  const hdr=document.createElement('div');
  hdr.style.cssText='padding:12px 20px;border-bottom:1px solid #e5e7eb;background:#f9fafb;font-size:14px;font-weight:800;color:#111';
  hdr.textContent='🔍 인쇄 미리보기';
  card.appendChild(hdr);

  const body=document.createElement('div');
  body.style.cssText='padding:20px;display:flex;justify-content:center;background:#f3f4f6;overflow:auto;max-height:70vh';
  body.innerHTML='<img src="'+imgData+'" style="width:'+pvW+'px;height:'+pvH+'px;box-shadow:0 2px 12px rgba(0,0,0,0.15);border-radius:4px;display:block">';
  card.appendChild(body);

  const foot=document.createElement('div');
  foot.style.cssText='display:flex;gap:10px;justify-content:center;padding:14px 20px;border-top:1px solid #e5e7eb;background:#f9fafb';
  foot.innerHTML='<button class="btn-print" data-action="print">🖨 인쇄하기</button>'
    +'<button data-action="close" style="padding:10px 24px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#555;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--f)">닫기</button>';
  foot.querySelector('[data-action="print"]').addEventListener('click',function(){_vpPrintFromPreviewImg();});
  foot.querySelector('[data-action="close"]').addEventListener('click',function(){closeModalGracefully('vpPrintPreviewOv');});
  card.appendChild(foot);

  ov.appendChild(card);
  document.body.appendChild(ov);

  /* 미리보기에서 인쇄 시 동일 이미지 사용 */
  _vpPreviewImgData=imgData;
}
function _vpPrintFromPreviewImg(){
  const ov=document.getElementById('vpPrintPreviewOv');if(ov)closeModalGracefully(ov);
  const imgData=_vpPreviewImgData;if(!imgData)return;
  const isA4=vpState.paper==='a4';
  /* 원본 health-diary.css @page 규칙과 정확히 일치
     - receipt: size 80mm 210mm, margin 4mm → 콘텐츠 영역 72mm × 202mm
     - a4pass : size A4, margin 10mm → 콘텐츠 영역 190mm × 277mm */
  const pageSize = isA4 ? 'A4' : { width: 80000, height: 210000 };
  const marginMM = isA4 ? 10 : 4;
  const imgWidthMM = isA4 ? 190 : 72;
  /* 이미지를 페이지 너비에 꽉 차게 — 높이는 종횡비 그대로(auto). overflow:hidden 으로
     페이지 초과분은 잘리고, pageRanges 로 main.js 측에서도 첫 페이지만 인쇄. */
  const printHtml =
    '<!doctype html><html><head><meta charset="utf-8">'
    +'<style>'
    +'@page{size:'+(isA4?'A4':'80mm 210mm')+';margin:'+marginMM+'mm}'
    +'html,body{margin:0;padding:0;background:#fff;overflow:hidden}'
    +'img{display:block;margin:0;width:'+imgWidthMM+'mm;height:auto;page-break-inside:avoid;break-inside:avoid;page-break-after:avoid;break-after:avoid}'
    +'</style></head><body><img src="'+imgData+'"></body></html>';
  if(window.electronAPI&&window.electronAPI.printWindowWithSize){
    /* 마진은 CSS @page 에서 mm 단위로 직접 처리 — Electron margins 객체는
       단위 해석 차이가 있어 marginType:'none' 으로 두고 CSS 가 통제. */
    const margins = { marginType: 'none' };
    window.electronAPI.printWindowWithSize(printHtml, pageSize, margins)
      .then(function(res){
        if(res&&!res.success&&!res.cancelled){
          alert('인쇄 실패: '+(res.error||''));
        }
      })
      .catch(function(err){console.error(err);alert('인쇄 호출 실패');});
    return;
  }
  /* 폴백 — 일반 브라우저용 (Electron 외 환경) */
  const printArea=document.getElementById('vpPrintArea');
  printArea.innerHTML='<img src="'+imgData+'" style="width:100%;max-width:'+widthCss+';display:block;margin:0 auto">';
  printArea.style.display='block';
  document.body.classList.remove('print-receipt','print-a4');
  document.body.classList.add(isA4?'print-a4':'print-receipt');
  setTimeout(function(){
    window.print();
    setTimeout(function(){
      printArea.style.display='none';
      document.body.classList.remove('print-receipt','print-a4');
    },500);
  },200);
}

/* ── 파일 내보내기 (PDF/PNG/JPG) ── */
export function vpExportFile(fmt){
  if(vpState.format.startsWith('custom')&&vpeState.slot) vpeEditorAutoSave(true,true);
  const html=vpBuildPrintContent();
  const isA4=vpState.paper==='a4';
  const canvasEl=document.getElementById('vpeCanvas');
  let pw, ph;
  if(canvasEl&&vpState.format.startsWith('custom')){pw=canvasEl.offsetWidth;ph=canvasEl.offsetHeight;}
  else if(isA4&&vpState.orientation==='landscape'){pw=842;ph=595;}
  else{pw=isA4?595:280;ph=isA4?842:600;}
  /* 임시 렌더링 컨테이너 */
  const wrap=document.createElement('div');
  const transpCheck=document.getElementById('vpTransparentBg');
  const useTranspBg=transpCheck&&transpCheck.checked&&(fmt==='png'||fmt==='jpeg');
  wrap.style.cssText='position:fixed;left:-9999px;top:0;z-index:-1;'+(useTranspBg?'':'background:#fff');
  let bgCss='';
  if(vpState.format.startsWith('custom')&&vpeState.pdfBgUrl){
    bgCss='background-image:url('+vpeState.pdfBgUrl+');background-size:'+(vpeState.bgScale||100)+'% auto;background-repeat:no-repeat;background-position:calc(50% + '+(vpeState.bgOffsetX||0)+'px) '+(vpeState.bgOffsetY||0)+'px;';
  }
  const paper=document.createElement('div');
  paper.style.cssText='width:'+pw+'px;min-height:'+ph+'px;'+(useTranspBg?'':'background:#fff;')+'position:relative;overflow:hidden;box-sizing:border-box;'+bgCss;
  paper.innerHTML=html;
  wrap.appendChild(paper);
  document.body.appendChild(wrap);
  /* html2canvas로 캡처 */
  if(typeof html2canvas==='undefined'){
    /* html2canvas 동적 로드 */
    const sc=document.createElement('script');
    sc.src='./node_modules/html2canvas/dist/html2canvas.min.js';
    sc.onload=function(){_vpDoCapture(paper,wrap,fmt,pw,ph);};
    sc.onerror=function(){wrap.remove();alert('html2canvas 라이브러리를 불러올 수 없습니다.');};
    document.head.appendChild(sc);
  } else {
    _vpDoCapture(paper,wrap,fmt,pw,ph);
  }
}
function _vpDoCapture(paper,wrap,fmt,pw,ph){
  const transpCheck=document.getElementById('vpTransparentBg');
  const useTransp=transpCheck&&transpCheck.checked&&(fmt==='png'||fmt==='jpeg');
  const bgColor=useTransp?null:'#ffffff';
  html2canvas(paper,{useCORS:true,allowTaint:true,scale:2,width:pw,backgroundColor:bgColor}).then(function(canvas){
    wrap.remove();
    if(fmt==='pdf'){
      _vpCanvasToPdf(canvas,pw,ph);
    } else {
      const mimeType=fmt==='png'?'image/png':'image/jpeg';
      const ext=fmt==='png'?'png':'jpeg';
      const dataUrl=canvas.toDataURL(mimeType,0.95);
      const a=document.createElement('a');
      a.href=dataUrl;
      a.download='확인증_'+(_vpExportFilename())+'.'+ext;
      a.click();
    }
  }).catch(function(err){wrap.remove();console.error(err);alert('캡처 실패: '+err.message);});
}
function _vpCanvasToPdf(canvas,pw,ph){
  if(typeof jspdf==='undefined'&&typeof window.jspdf==='undefined'){
    const sc=document.createElement('script');
    sc.src='./node_modules/jspdf/dist/jspdf.umd.min.js';
    sc.onload=function(){_vpCanvasToPdfDo(canvas,pw,ph);};
    sc.onerror=function(){
      /* fallback: PNG로 대체 */
      const dataUrl=canvas.toDataURL('image/png');
      const a=document.createElement('a');a.href=dataUrl;a.download='확인증_'+_vpExportFilename()+'.png';a.click();
      alert('PDF 라이브러리를 불러올 수 없어 PNG로 저장합니다.');
    };
    document.head.appendChild(sc);
  } else {_vpCanvasToPdfDo(canvas,pw,ph);}
}
function _vpCanvasToPdfDo(canvas,pw,ph){
  const jsPDF=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  const isA4=vpState.paper==='a4';
  const orientation=pw>ph?'landscape':'portrait';
  const doc=new jsPDF({orientation:orientation,unit:'pt',format:isA4?'a4':[pw,ph]});
  const pageW=doc.internal.pageSize.getWidth();
  const pageH=doc.internal.pageSize.getHeight();
  const imgData=canvas.toDataURL('image/png');
  doc.addImage(imgData,'PNG',0,0,pageW,pageH);
  doc.save('확인증_'+_vpExportFilename()+'.pdf');
}
function _vpExportFilename(){
  const d=new Date();
  return d.getFullYear()+''+(d.getMonth()+1<10?'0':'')+(d.getMonth()+1)+(d.getDate()<10?'0':'')+d.getDate();
}

function vpShowTranspOption(fmt){
  _vpCaptureForPopup(fmt,function(capturedCanvas){
    _imgExportShowPopup(fmt,capturedCanvas,'확인증');
  });
}
/* 팝업 없이 바로 다운로드 */
export function vpDirectDownload(fmt){
  _vpCaptureForPopup(fmt,function(canvas){
    const mimeType=fmt==='png'?'image/png':'image/jpeg';
    const ext=fmt==='png'?'png':'jpeg';
    const dataUrl=canvas.toDataURL(mimeType,0.95);
    const a=document.createElement('a');
    a.href=dataUrl;
    a.download='확인증_'+_vpExportFilename()+'.'+ext;
    a.click();
  });
}

/* ── PNG/JPEG 내보내기 팝업 (공통) ── */
let _imgExportState={canvas:null,fmt:'png',scale:1,filePrefix:'export',cropState:{active:false,sx:0,sy:0,ex:0,ey:0,cropping:false}};

function _imgExportCapture(htmlContent,pw,ph,bgCss,cb){
  const wrap=document.createElement('div');
  wrap.style.cssText='position:fixed;left:-9999px;top:0;z-index:-1;background:#fff';
  const paper=document.createElement('div');
  paper.style.cssText='width:'+pw+'px;min-height:'+ph+'px;background:#fff;position:relative;overflow:hidden;box-sizing:border-box;'+(bgCss||'');
  paper.innerHTML=htmlContent;
  wrap.appendChild(paper);
  document.body.appendChild(wrap);
  const doCapture=function(){
    html2canvas(paper,{useCORS:true,allowTaint:true,scale:2,width:pw,backgroundColor:'#ffffff'}).then(function(canvas){
      wrap.remove();cb(canvas);
    }).catch(function(err){wrap.remove();console.error(err);alert('캡처 실패: '+err.message);});
  };
  if(typeof html2canvas==='undefined'){
    const sc=document.createElement('script');
    sc.src='./node_modules/html2canvas/dist/html2canvas.min.js';
    sc.onload=doCapture;
    sc.onerror=function(){wrap.remove();alert('html2canvas 라이브러리를 불러올 수 없습니다.');};
    document.head.appendChild(sc);
  } else doCapture();
}

function _imgExportShowPopup(fmt,capturedCanvas,filePrefix){
  const cw=capturedCanvas.width, ch=capturedCanvas.height;
  const maxPrevH=Math.min(450,window.innerHeight*0.5);
  const maxPrevW=Math.min(500,window.innerWidth*0.6);
  const prevScale=Math.min(maxPrevW/cw,maxPrevH/ch,1);
  const pvW=Math.round(cw*prevScale), pvH=Math.round(ch*prevScale);
  const checkerBg='repeating-conic-gradient(#d0d0d0 0% 25%,#fff 0% 50%) 50%/14px 14px';

  _imgExportState={canvas:capturedCanvas,fmt:fmt,scale:prevScale,filePrefix:filePrefix||'export',cropState:{active:false,sx:0,sy:0,ex:0,ey:0,cropping:false}};

  const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='vpExportPopupOv';ov.style.zIndex='10001';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});

  ov.innerHTML='<div class="modal-content" style="width:'+Math.max(400,pvW+80)+'px;padding:20px;max-height:90vh;overflow-y:auto">'
    +'<div style="font-size:14px;font-weight:800;margin-bottom:8px;color:var(--t1)">'+(fmt==='png'?'🖼 PNG':'📷 JPEG')+' 내보내기</div>'
    +'<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.6">미리보기를 확인하고 저장 방식을 선택하세요. 자르기를 선택하면 영역 드래그로 잘라내기.</div>'
    +'<div style="text-align:center;margin-bottom:12px">'
    +'<div id="vpExpPrevWrap" style="position:relative;display:inline-block;border:1px solid var(--bdr);border-radius:6px;overflow:hidden;cursor:crosshair;'+checkerBg+'">'
    +'<canvas id="vpExpPrevCanvas" width="'+pvW+'" height="'+pvH+'" style="display:block;width:'+pvW+'px;height:'+pvH+'px"></canvas>'
    +'<div id="vpExpCropSel" style="display:none;position:absolute;border:2px dashed #06b6d4;background:rgba(6,182,212,0.1);pointer-events:none;z-index:2"></div>'
    +'</div>'
    +'<div id="vpExpCropInfo" style="display:none;font-size:10px;color:var(--cyan);margin-top:4px"></div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;justify-content:center;flex-wrap:wrap">'
    +(fmt==='png'?'<label style="font-size:11px;color:var(--t2);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="vpExpTransp" style="accent-color:var(--cyan)"> 투명 배경</label>':'')
    +'</div>'
    +'<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
    +'<button data-action="exp-save" style="padding:8px 20px;border:none;border-radius:6px;background:var(--cyan);color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 저장</button>'
    +(fmt==='png'?'<button data-action="exp-save-transp" style="padding:8px 20px;border:none;border-radius:6px;background:#10b981;color:#fff;font-size:12px;font-weight:700;cursor:pointer">🔲 투명 배경으로 저장</button>':'')
    +'<button id="vpExpCropBtn" data-action="exp-crop" style="padding:8px 20px;border:none;border-radius:6px;background:#8b5cf6;color:#fff;font-size:12px;font-weight:700;cursor:pointer">✂ 자르기 모드</button>'
    +'<button data-action="exp-cancel" style="padding:8px 16px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t2);font-size:12px;font-weight:600;cursor:pointer">취소</button>'
    +'</div></div>';
  document.body.appendChild(ov);

  /* Bind event listeners for export popup buttons */
  const transpCb=ov.querySelector('#vpExpTransp');
  if(transpCb) transpCb.addEventListener('change',function(){_imgExpUpdatePreview();});
  ov.querySelector('[data-action="exp-save"]').addEventListener('click',function(){_imgExpDoSave(false);});
  const transpBtn=ov.querySelector('[data-action="exp-save-transp"]');
  if(transpBtn) transpBtn.addEventListener('click',function(){_imgExpDoSave(false,true);});
  ov.querySelector('[data-action="exp-crop"]').addEventListener('click',function(){_imgExpStartCrop();});
  ov.querySelector('[data-action="exp-cancel"]').addEventListener('click',function(){closeModalGracefully('vpExportPopupOv');});

  _imgExpUpdatePreview();
  _imgExpInitCropDrag(pvW,pvH,prevScale);
}

function _imgExpUpdatePreview(){
  const pc=document.getElementById('vpExpPrevCanvas');if(!pc)return;
  const src=_imgExportState.canvas;if(!src)return;
  const ctx=pc.getContext('2d');
  const w=pc.width, h=pc.height;
  ctx.clearRect(0,0,w,h);
  const transpCb=document.getElementById('vpExpTransp');
  if(!transpCb||!transpCb.checked){ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);}
  ctx.drawImage(src,0,0,w,h);
}

function _imgExpInitCropDrag(pvW,pvH,prevScale){
  const wrap=document.getElementById('vpExpPrevWrap');if(!wrap)return;
  const cs=_imgExportState.cropState;
  wrap.addEventListener('mousedown',function(e){
    if(!cs.cropping)return;
    const rect=wrap.getBoundingClientRect();
    cs.active=true;cs.sx=e.clientX-rect.left;cs.sy=e.clientY-rect.top;cs.ex=cs.sx;cs.ey=cs.sy;
    const sel=document.getElementById('vpExpCropSel');
    if(sel){sel.style.display='block';sel.style.left=cs.sx+'px';sel.style.top=cs.sy+'px';sel.style.width='0';sel.style.height='0';}
  });
  wrap.addEventListener('mousemove',function(e){
    if(!cs.active)return;
    const rect=wrap.getBoundingClientRect();
    cs.ex=Math.max(0,Math.min(pvW,e.clientX-rect.left));
    cs.ey=Math.max(0,Math.min(pvH,e.clientY-rect.top));
    const x=Math.min(cs.sx,cs.ex), y=Math.min(cs.sy,cs.ey);
    const w=Math.abs(cs.ex-cs.sx), h=Math.abs(cs.ey-cs.sy);
    const sel=document.getElementById('vpExpCropSel');
    if(sel){sel.style.left=x+'px';sel.style.top=y+'px';sel.style.width=w+'px';sel.style.height=h+'px';}
    const info=document.getElementById('vpExpCropInfo');
    if(info){info.style.display='block';info.textContent='선택 영역: '+Math.round(w/prevScale)+'×'+Math.round(h/prevScale)+'px';}
  });
  wrap.addEventListener('mouseup',function(){
    if(!cs.active)return;
    cs.active=false;
    if(Math.abs(cs.ex-cs.sx)>5&&Math.abs(cs.ey-cs.sy)>5){
      const btn=document.getElementById('vpExpCropBtn');
      if(btn){btn.textContent='💾 자르기 저장';const nb=btn.cloneNode(true);btn.parentNode.replaceChild(nb,btn);nb.addEventListener('click',function(){_imgExpDoSave(true);});}
    }
  });
}

function _imgExpStartCrop(){
  const cs=_imgExportState.cropState;
  cs.cropping=true;cs.sx=0;cs.sy=0;cs.ex=0;cs.ey=0;
  const sel=document.getElementById('vpExpCropSel');if(sel)sel.style.display='none';
  const btn=document.getElementById('vpExpCropBtn');
  if(btn){btn.textContent='✂ 영역 드래그로 잘라내기';btn.style.background='#7c3aed';}
  const info=document.getElementById('vpExpCropInfo');
  if(info){info.style.display='block';info.textContent='미리보기에서 영역 드래그로 잘라내기';}
}

function _imgExpDoSave(crop,makeTransparent){
  const s=_imgExportState;const src=s.canvas;if(!src)return;
  let fmt=s.fmt||'png';
  const prevScale=s.scale||1;
  const transpCb=document.getElementById('vpExpTransp');
  const useTransp=transpCb&&transpCb.checked&&fmt==='png';
  if(makeTransparent) fmt='png';
  const out=document.createElement('canvas');
  const ctx=out.getContext('2d');
  if(crop){
    const cs=s.cropState;
    const x=Math.round(Math.min(cs.sx,cs.ex)/prevScale);
    const y=Math.round(Math.min(cs.sy,cs.ey)/prevScale);
    const w=Math.round(Math.abs(cs.ex-cs.sx)/prevScale);
    const h=Math.round(Math.abs(cs.ey-cs.sy)/prevScale);
    if(w<5||h<5){alert('자르기 영역이 너무 작습니다.');return;}
    out.width=w;out.height=h;
    if(!useTransp&&!makeTransparent){ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);}
    ctx.drawImage(src,x,y,w,h,0,0,w,h);
  } else {
    out.width=src.width;out.height=src.height;
    if(!useTransp&&!makeTransparent){ctx.fillStyle='#fff';ctx.fillRect(0,0,src.width,src.height);}
    ctx.drawImage(src,0,0);
  }
  /* 투명 배경으로 저장: 흰색/거의 흰색 픽셀을 투명하게 변환 */
  if(makeTransparent){
    const imgData=ctx.getImageData(0,0,out.width,out.height);
    const d=imgData.data;
    for(let i=0;i<d.length;i+=4){
      const r=d[i], g=d[i+1], b=d[i+2];
      /* luminance 계산 */
      const lum=0.299*r+0.587*g+0.114*b;
      /* saturation 계산 */
      const maxC=Math.max(r,g,b), minC=Math.min(r,g,b);
      const sat=maxC===0?0:(maxC-minC)/maxC;
      if(lum>240&&sat<0.1){d[i+3]=0;}
    }
    ctx.putImageData(imgData,0,0);
  }
  const mimeType=makeTransparent?'image/png':(fmt==='png'?'image/png':'image/jpeg');
  const ext=makeTransparent?'png':(fmt==='png'?'png':'jpeg');
  const dataUrl=out.toDataURL(mimeType,0.95);
  const a=document.createElement('a');
  a.href=dataUrl;
  a.download=s.filePrefix+'_'+_vpExportFilename()+(crop?'_crop':'')+(makeTransparent?'_transparent':'')+'.'+ext;
  a.click();
  const ov=document.getElementById('vpExportPopupOv');if(ov)closeModalGracefully(ov);
}

/* ── 확인증 에디터 PNG/JPEG 내보내기 래퍼 ── */
function _vpCaptureForPopup(fmt,cb){
  if(vpState.format.startsWith('custom')&&vpeState.slot) vpeEditorAutoSave(true,true);
  const isCustom=vpState.format.startsWith('custom');
  let target;
  if(isCustom){
    target=document.getElementById('vpeCanvas');
  } else {
    target=document.getElementById('vpPreview');
  }
  if(!target||target.offsetWidth===0||target.offsetHeight===0){
    /* fallback: 오프스크린 렌더링 */
    const html=vpBuildPrintContent();
    const isA4=vpState.paper==='a4';
    let pw,ph;
    if(isA4&&vpState.orientation==='landscape'){pw=842;ph=595;}
    else{pw=isA4?595:280;ph=isA4?842:600;}
    let bgCss='';
    if(isCustom&&vpeState.pdfBgUrl){
      bgCss='background-image:url('+vpeState.pdfBgUrl+');background-size:'+(vpeState.bgScale||100)+'% auto;background-repeat:no-repeat;background-position:calc(50% + '+(vpeState.bgOffsetX||0)+'px) '+(vpeState.bgOffsetY||0)+'px;';
    }
    _imgExportCapture(html,pw,ph,bgCss,cb);
    return;
  }
  /* 줌을 100%로 임시 변경하여 원본 크기로 캡처 */
  const origTransform=target.style.transform;
  const origTransformOrigin=target.style.transformOrigin;
  target.style.transform='none';
  target.style.transformOrigin='';
  const pw=target.offsetWidth,ph=target.offsetHeight;
  const doCapture=function(){
    html2canvas(target,{useCORS:true,allowTaint:true,scale:2,width:pw,height:ph,backgroundColor:'#ffffff'}).then(function(canvas){
      target.style.transform=origTransform;
      target.style.transformOrigin=origTransformOrigin;
      cb(canvas);
    }).catch(function(err){
      target.style.transform=origTransform;
      target.style.transformOrigin=origTransformOrigin;
      console.error(err);alert('캡처 실패: '+err.message);
    });
  };
  if(typeof html2canvas==='undefined'){
    const sc=document.createElement('script');
    sc.src='./node_modules/html2canvas/dist/html2canvas.min.js';
    sc.onload=doCapture;
    sc.onerror=function(){target.style.transform=origTransform;target.style.transformOrigin=origTransformOrigin;alert('html2canvas를 불러올 수 없습니다.');};
    document.head.appendChild(sc);
  } else doCapture();
}

/* ── 투명 배경 미리보기 (에디터 내) ── */
function vpTransparentPreview(checked){
  const preview=document.getElementById('vpPreview');
  const canvas=document.getElementById('vpeCanvas');
  const target=canvas||preview;
  if(!target)return;
  if(checked){
    target.style.setProperty('--transp-bg','repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px');
    target.setAttribute('data-transp','1');
    if(preview){preview.style.background='repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px';}
    if(canvas){canvas.style.background='repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px';}
  } else {
    if(preview)preview.style.background='';
    if(canvas)canvas.style.background='';
    target.removeAttribute('data-transp');
  }
}

function vpeResolveDynField(key){
  const rec = vpState.selectedRecord;
  const stu = vpState.selectedStudent;
  const map = {
    '학생이름': stu ? stu.name : '',
    '학년반': stu ? stu.grade+'-'+stu.cls : '',
    '번호': stu ? stu.num : '',
    '방문날짜': rec ? rec.date : '',
    '입실시간': rec ? rec.timeIn : '',
    '퇴실시간': rec ? (rec.timeOut||'-') : '',
    '증상': rec ? (rec.symptoms||[]).join(', ') : '',
    '처치내용': rec ? (rec.treatment||[]).join(', ') : '',
    '담당자명': S.settings.nurse1 || '보건교사',
    '학교명': S.settings.schoolName || '○○학교'
  };
  return map[key] !== undefined ? map[key] : '{{'+key+'}}';
}

function vpeEditorBuildPrint(){
  const paperW = vpState.paper==='a4' ? 595 : 280;
  const bgCss=vpeState.pdfBgUrl?'background-image:url('+vpeState.pdfBgUrl+');background-size:'+(vpeState.bgScale||100)+'% auto;background-repeat:no-repeat;background-position:calc(50% + '+(vpeState.bgOffsetX||0)+'px) '+(vpeState.bgOffsetY||0)+'px;':'';
  let html = '<div style="position:relative;width:'+paperW+'px;min-height:200px;background:#fff;color:#111;font-family:\'Malgun Gothic\',\'맑은 고딕\',\'Apple SD Gothic Neo\',\'Pretendard Variable\',\'Pretendard\',\'Noto Sans KR\',sans-serif;font-size:12px;'+bgCss+'">';
  const rec = vpState.selectedRecord;
  const nurseName = S.settings.nurse1 || '보건교사';
  const today = new Date();
  const dateStr = today.getFullYear()+'년 '+(today.getMonth()+1)+'월 '+today.getDate()+'일';

  vpeState.objects.forEach(function(obj){
    const s = obj.style || {};
    const autoH=(obj.type==='line'||obj.type==='textbox');
    const base = 'position:absolute;left:'+obj.x+'px;top:'+obj.y+'px;width:'+obj.w+'px;'+(!autoH?'height:'+obj.h+'px;':'')+'z-index:'+(obj.z||1)+';box-sizing:border-box;';
    switch(obj.type){
      case 'textbox':
        let content = obj.content || '';
        content = content.replace(/\{\{(.+?)\}\}/g, function(m,k){ return vpeResolveDynField(k); });
        html += '<div style="'+base+'font-size:'+(s.fontSize||12)+'px;font-family:'+(s.fontFamily||"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Pretendard Variable','Pretendard','Noto Sans KR',sans-serif")+';font-weight:'+(s.fontWeight||'normal')+';font-style:'+(s.fontStyle||'normal')+';text-decoration:'+(s.textDecoration||'none')+';color:'+(s.color||'#000')+';text-align:'+(s.textAlign||'left')+';line-height:1.5;padding:4px 6px;word-break:break-word;overflow:hidden;'+(s.bgColor&&s.bgColor!=='transparent'?'background:'+s.bgColor+';':'')+'">'+content+'</div>';
        break;
      case 'table':
        if(obj.tableData){
          const td = obj.tableData;
          html += '<div style="'+base+'overflow:hidden;"><table style="border-collapse:collapse;width:100%;height:100%;table-layout:fixed">';
          for(let r=0;r<td.rows;r++){
            html += '<tr>';
            for(let c=0;c<td.cols;c++){
              const cell = td.cells[r*td.cols+c];
              let ct = cell ? (cell.text||'') : '';
              ct = ct.replace(/\{\{(.+?)\}\}/g, function(m,k){ return vpeResolveDynField(k); });
              const cbg = cell && cell.bg ? 'background:'+cell.bg+';' : '';
              html += '<td style="border:1px solid #aaa;padding:3px 5px;font-size:11px;vertical-align:top;color:#111;'+cbg+'">'+ct+'</td>';
            }
            html += '</tr>';
          }
          html += '</table></div>';
        }
        break;
      case 'line':
        html += '<div style="'+base+'height:auto;"><div style="width:100%;border-top:'+(s.borderWidth||2)+'px solid '+(s.borderColor||'#000')+';position:absolute;top:50%;left:0"></div></div>';
        break;
      case 'rect':
        html += '<div style="'+base+'"><div style="width:100%;height:100%;border:'+(s.borderWidth||1)+'px solid '+(s.borderColor||'#000')+';box-sizing:border-box;'+(s.bgColor&&s.bgColor!=='transparent'?'background:'+s.bgColor+';':'')+'"></div></div>';
        break;
      case 'circle':
        html += '<div style="'+base+'"><div style="width:100%;height:100%;border-radius:50%;border:'+(s.borderWidth||1)+'px solid '+(s.borderColor||'#000')+';box-sizing:border-box;'+(s.bgColor&&s.bgColor!=='transparent'?'background:'+s.bgColor+';':'')+'"></div></div>';
        break;
      case 'signature':
        let sigHtml2 = '';
        if(vpState.sigMode==='stamp'&&vpState.sigImage) sigHtml2='<span>'+nurseName+'</span> <img src="'+vpState.sigImage+'" style="max-height:40px"> <span>(인)</span>';
        else if(vpState.sigMode==='sign'&&vpState.sigImage) sigHtml2='<span>'+nurseName+'</span> <img src="'+vpState.sigImage+'" style="max-height:40px">';
        else sigHtml2 = nurseName+' <span style="display:inline-block;width:50px;border-bottom:1px solid #333">&nbsp;</span> (인)';
        html += '<div style="'+base+'display:flex;align-items:center;justify-content:center;font-size:11px;gap:6px">'+sigHtml2+'</div>';
        break;
      case 'datefield':
        html += '<div style="'+base+'display:flex;align-items:center;justify-content:center;font-size:11px">'+dateStr+'</div>';
        break;
      case 'dynfield':
        const val = vpeResolveDynField(obj.content);
        html += '<div style="'+base+'font-size:'+(s.fontSize||12)+'px;font-family:'+(s.fontFamily||"'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Pretendard Variable','Pretendard','Noto Sans KR',sans-serif")+';font-weight:'+(s.fontWeight||'bold')+';color:'+(s.color||'#000')+';text-align:'+(s.textAlign||'center')+';display:flex;align-items:center;justify-content:center;padding:2px 4px">'+val+'</div>';
        break;
    }
  });
  html += '</div>';
  return html;
}

document.addEventListener('paste', function(e){
  if(!document.getElementById('vpOverlay').classList.contains('show')) return;
  if(vpState.sigMode === 'none') return;
  const items = e.clipboardData.items;
  for(let i = 0; i < items.length; i++){
    if(items[i].type.startsWith('image/')){
      e.preventDefault();
      vpReadSigFile(items[i].getAsFile());
      break;
    }
  }
});

const _vpOvEl=document.getElementById('vpOverlay');
if(_vpOvEl){_vpOvEl.addEventListener('click', function(e){if(e.target === this) closeVisitPass();});}
else{document.addEventListener('DOMContentLoaded',function(){const el=document.getElementById('vpOverlay');if(el)el.addEventListener('click', function(e){if(e.target === this) closeVisitPass();});});}
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    /* 침상 관련 팝업 우선 */
    const bedCfg=document.getElementById('bedConfigOverlay');if(bedCfg){closeModalGracefully(bedCfg);return;}
    const bedMgr=document.getElementById('bedManagerOverlay');if(bedMgr){closeModalGracefully(bedMgr);return;}
    const bedAlm=document.getElementById('bedAlarmOverlay');if(bedAlm){_bedDismissAlarm();return;}
    const ems=document.getElementById('emsOverlay');if(ems&&ems.classList.contains('show')){closeEmsMsg();return;}
    const vp=document.getElementById('vpOverlay');if(vp&&vp.classList.contains('show')){
      const bgRm=document.getElementById('bgRmOverlay');if(bgRm){closeModalGracefully(bgRm);return;}
      const crop=document.getElementById('cropOverlay');if(crop){closeModalGracefully(crop);if(typeof _cropState!=='undefined')_cropState.origImg=null;return;}
      const bgStr=document.getElementById('bgStretchOverlay');if(bgStr){closeModalGracefully(bgStr);return;}
      const expPop=document.getElementById('vpExportPopupOv');if(expPop){closeModalGracefully(expPop);return;}
      const ppOv=document.getElementById('vpPrintPreviewOv');if(ppOv){closeModalGracefully(ppOv);return;}
      closeVisitPass();
    }
  }
});

/* ── Public API exports ── */

