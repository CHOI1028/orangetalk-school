/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
import { S, ensureHolidayYear } from '../../core/app-state.js';
/* ES Module — 가정통신문 (통합) */
import { getStu, escHtml, toDateStr, closeModalGracefully } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { closeModalWithAnim, cancelCloseAnimIfPending } from '../daily/daily-autocomplete.js';
import { _makeDraggable } from '../symptom/symptom-view.js';
import { _nlGetMode } from '../survey/survey-newsletter-editor.js';
import { _vpeMedia } from '../visit-pass/visit-pass-editor.js';

/* ═══ NewsletterEditorMedia — 배경 이미지/PDF 처리 ═══ */
function NewsletterEditorMedia(options){ this.pdfjsLib = (options||{}).pdfjsLib || null; }
NewsletterEditorMedia.prototype.loadBackgroundFile = function(file, handlers){
  if(!file) return Promise.resolve({ ok:false, error:'no-file' });
  if(file.type === 'application/pdf') return this._loadPdf(file, handlers);
  if(file.type && file.type.indexOf('image/') === 0) return this._loadImage(file, handlers);
  return Promise.resolve({ ok:false, error:'unsupported-type' });
};
NewsletterEditorMedia.prototype._loadPdf = function(file, handlers){
  const pdfjsLib = this.pdfjsLib || window.pdfjsLib;
  if(!pdfjsLib) return Promise.resolve({ ok:false, error:'missing-pdfjs' });
  return new Promise(function(resolve){
    const reader = new FileReader();
    reader.onload = function(e){
      const data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data:data }).promise.then(function(pdf){ return pdf.getPage(1); }).then(function(page){
        const vp = page.getViewport({ scale:2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        return page.render({ canvasContext:c.getContext('2d'), viewport:vp }).promise.then(function(){
          const payload = { pdfBgUrl:c.toDataURL('image/png'), pdfFileName:file.name, canvasHeightRatio:vp.height/vp.width, bgScale:100 };
          if(handlers && handlers.onLoaded) handlers.onLoaded(payload);
          resolve({ ok:true, payload:payload });
        });
      }).catch(function(err){ resolve({ ok:false, error:err&&err.message?err.message:'pdf-load-failed' }); });
    };
    reader.readAsArrayBuffer(file);
  });
};
NewsletterEditorMedia.prototype._loadImage = function(file, handlers){
  return new Promise(function(resolve){
    const reader = new FileReader();
    reader.onload = function(e){
      const img = new Image();
      img.onload = function(){
        const payload = { pdfBgUrl:e.target.result, pdfFileName:file.name, canvasHeightRatio:img.height/img.width, bgScale:100 };
        if(handlers && handlers.onLoaded) handlers.onLoaded(payload);
        resolve({ ok:true, payload:payload });
      };
      img.onerror = function(){ resolve({ ok:false, error:'image-load-failed' }); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};
NewsletterEditorMedia.prototype.applyLoadedBackground = function(state, payload){
  if(!state || !payload) return false;
  state.pdfBgUrl = payload.pdfBgUrl||null; state.pdfFileName = payload.pdfFileName||null;
  if(payload.canvasHeightRatio && state.canvasW) state.canvasH = Math.round(state.canvasW * payload.canvasHeightRatio);
  state.bgScale = typeof payload.bgScale==='number' ? payload.bgScale : 100;
  return true;
};
NewsletterEditorMedia.prototype.removeBackground = function(state){
  if(!state) return false;
  state.pdfBgUrl = null; state.pdfFileName = null;
  if(state.paper === 'a4') state.canvasH = 842;
  return true;
};
NewsletterEditorMedia.prototype.applyImageBgRemoval = function(state, resultUrl){
  if(!state || !state.selectedId || !resultUrl) return false;
  const obj = (state.objects||[]).find(function(o){ return o.id===state.selectedId; });
  if(!obj || obj.type!=='image') return false;
  obj.content = resultUrl; obj.src = resultUrl;
  return true;
};
NewsletterEditorMedia.prototype.buildBgCss = function(state){
  if(!state || !state.pdfBgUrl) return '';
  return 'background-image:url('+state.pdfBgUrl+');background-size:'+(state.bgScale||100)+'% auto;background-repeat:no-repeat;background-position:calc(50% + '+(state.bgOffsetX||0)+'px) '+(state.bgOffsetY||0)+'px;';
};
const _nlMedia = new NewsletterEditorMedia({ pdfjsLib: window.pdfjsLib || null });

/* ═══ NewsletterEditorStore — 저장/로드 ═══ */
function NewsletterEditorStore(api){
  this.api = api||null; this.storageKey='ec_nl_editor'; this.inlineStorageKey='ec_nl_inline'; this.listKey='ec_nl_saved_list';
}
NewsletterEditorStore.prototype.getStorageKey = function(mode){ return mode==='inline'?this.inlineStorageKey:this.storageKey; };
NewsletterEditorStore.prototype.serializeState = function(state){
  const s=state||{};
  return { objects:s.objects||[], nextId:s.nextId||1, pdfBgUrl:s.pdfBgUrl||null, pdfFileName:s.pdfFileName||null,
    canvasH:s.canvasH, canvasW:s.canvasW, paper:s.paper, orientation:s.orientation,
    marginTop:s.marginTop, marginBottom:s.marginBottom, marginLeft:s.marginLeft, marginRight:s.marginRight,
    bgScale:s.bgScale, bgOffsetY:s.bgOffsetY, bgOffsetX:s.bgOffsetX };
};
NewsletterEditorStore.prototype.applyState = function(target, data){
  const out=target||{}, s=data||{};
  out.objects=s.objects||[]; out.nextId=s.nextId||1; out.pdfBgUrl=s.pdfBgUrl||null; out.pdfFileName=s.pdfFileName||null;
  if(s.canvasH)out.canvasH=s.canvasH; if(s.canvasW)out.canvasW=s.canvasW;
  if(s.paper)out.paper=s.paper; if(s.orientation)out.orientation=s.orientation;
  if(typeof s.marginTop==='number')out.marginTop=s.marginTop; if(typeof s.marginBottom==='number')out.marginBottom=s.marginBottom;
  if(typeof s.marginLeft==='number')out.marginLeft=s.marginLeft; if(typeof s.marginRight==='number')out.marginRight=s.marginRight;
  if(typeof s.bgScale==='number')out.bgScale=s.bgScale; if(typeof s.bgOffsetY==='number')out.bgOffsetY=s.bgOffsetY;
  if(typeof s.bgOffsetX==='number')out.bgOffsetX=s.bgOffsetX;
  return out;
};
NewsletterEditorStore.prototype.readLocalState = function(mode){ try{ const s=localStorage.getItem(this.getStorageKey(mode)); return s?JSON.parse(s):null; }catch(e){ return null; } };
NewsletterEditorStore.prototype.saveEditorState = function(mode, state){
  const data=this.serializeState(state); localStorage.setItem(this.getStorageKey(mode),JSON.stringify(data));
  if(this.api&&this.api.editorStateSave) return this.api.editorStateSave('newsletter-editor',mode,data).catch(function(){});
  return Promise.resolve(null);
};
NewsletterEditorStore.prototype.loadEditorState = function(mode){
  const localData=this.readLocalState(mode);
  if(this.api&&this.api.editorStateGet) return this.api.editorStateGet('newsletter-editor',mode).then(function(res){ return res&&res.success&&res.data?res.data:localData; }).catch(function(){ return localData; });
  return Promise.resolve(localData);
};
NewsletterEditorStore.prototype.clearEditorState = function(mode){
  localStorage.removeItem(this.getStorageKey(mode));
  if(this.api&&this.api.editorStateDelete) return this.api.editorStateDelete('newsletter-editor',mode).catch(function(){});
  return Promise.resolve(null);
};
NewsletterEditorStore.prototype.getSavedList = function(){ try{ return JSON.parse(localStorage.getItem(this.listKey)||'[]'); }catch(e){ return []; } };
NewsletterEditorStore.prototype.setSavedList = function(list){ localStorage.setItem(this.listKey,JSON.stringify(list||[])); };
NewsletterEditorStore.prototype.refreshSavedList = function(){
  const self=this; if(!(this.api&&this.api.newsletterListGet)) return Promise.resolve(this.getSavedList());
  return this.api.newsletterListGet().then(function(res){ if(res&&res.success&&Array.isArray(res.data)){self.setSavedList(res.data);return res.data;} return self.getSavedList(); }).catch(function(){ return self.getSavedList(); });
};
NewsletterEditorStore.prototype.createDocument = function(name, data){
  const self=this;
  if(this.api&&this.api.newsletterCreate) return this.api.newsletterCreate(name,data).then(function(res){ if(res&&res.success&&res.item)self.setSavedList(res.list||[]); return res; });
  const list=this.getSavedList(); const item={id:Date.now(),name:name,data:data||{},created:new Date().toISOString(),updated:new Date().toISOString()};
  list.unshift(item); this.setSavedList(list); return Promise.resolve({success:true,item:item,list:list});
};
NewsletterEditorStore.prototype.updateDocument = function(id, data){
  const self=this;
  if(this.api&&this.api.newsletterUpdate) return this.api.newsletterUpdate(id,data).then(function(res){ if(res&&res.success)self.setSavedList(res.list||[]); return res; });
  const list=this.getSavedList(); const idx=list.findIndex(function(it){return it.id===id;}); if(idx===-1)return Promise.resolve({success:true,found:false});
  list[idx].data=data; list[idx].updated=new Date().toISOString(); this.setSavedList(list); return Promise.resolve({success:true,found:true,item:list[idx],list:list});
};
NewsletterEditorStore.prototype.loadDocument = function(id){
  if(this.api&&this.api.newsletterLoad) return this.api.newsletterLoad(id).then(function(res){ return res&&res.success?res.data:null; }).catch(function(){ return null; });
  const item=this.getSavedList().find(function(it){return it.id===id;}); return Promise.resolve(item?item.data:null);
};
NewsletterEditorStore.prototype.renameDocument = function(id, name){
  const self=this;
  if(this.api&&this.api.newsletterRename) return this.api.newsletterRename(id,name).then(function(res){ if(res&&res.success&&res.found)self.setSavedList(res.list||[]); return res; });
  const list=this.getSavedList(); const item=list.find(function(it){return it.id===id;}); if(!item)return Promise.resolve({success:true,found:false,list:list});
  item.name=name; item.updated=new Date().toISOString(); this.setSavedList(list); return Promise.resolve({success:true,found:true,item:item,list:list});
};
NewsletterEditorStore.prototype.duplicateDocument = function(id){
  const self=this;
  if(this.api&&this.api.newsletterDuplicate) return this.api.newsletterDuplicate(id).then(function(res){ if(res&&res.success&&res.item)self.setSavedList(res.list||[]); return res; });
  const list=this.getSavedList(); const item=list.find(function(it){return it.id===id;}); if(!item)return Promise.resolve({success:true,found:false,list:list});
  const copy={id:Date.now(),name:item.name+' (사본)',data:JSON.parse(JSON.stringify(item.data)),created:new Date().toISOString(),updated:new Date().toISOString()};
  list.unshift(copy); this.setSavedList(list); return Promise.resolve({success:true,found:true,item:copy,list:list});
};
NewsletterEditorStore.prototype.deleteDocument = function(id){
  const self=this;
  if(this.api&&this.api.newsletterDelete) return this.api.newsletterDelete(id).then(function(res){ if(res&&res.success)self.setSavedList(res.list||[]); return res; });
  const list=this.getSavedList().filter(function(it){return it.id!==id;}); this.setSavedList(list); return Promise.resolve({success:true,list:list});
};
NewsletterEditorStore.prototype.loadDocumentIntoInlineDraft = function(id){
  const self=this; return this.loadDocument(id).then(function(data){ if(!data)return null; localStorage.setItem(self.inlineStorageKey,JSON.stringify(data)); return data; });
};
NewsletterEditorStore.prototype.resetInlineDraft = function(){ return this.clearEditorState('inline'); };
const _nlStore = new NewsletterEditorStore(window.electronAPI || null);

/* ═══ NewsletterEditorModel — 오브젝트 조작 ═══ */
function NewsletterEditorModel(){}
NewsletterEditorModel.prototype._defaultStyle = function(type){
  return { fontSize:type==='table'?11:12, fontFamily:"'Noto Sans KR',sans-serif", fontWeight:'normal', fontStyle:'normal', textDecoration:'none', color:'#000000', textAlign:'left', bgColor:'transparent', borderColor:type==='table'?'#aaa':'#000000', borderWidth:type==='textbox'?0:1, borderRadius:0 };
};
NewsletterEditorModel.prototype.getSelectedObject = function(state){
  if(!state||!state.selectedId)return null; return (state.objects||[]).find(function(o){return o.id===state.selectedId;})||null;
};
NewsletterEditorModel.prototype.setStyle = function(state,prop,val){ const o=this.getSelectedObject(state); if(!o)return false; if(!o.style)o.style={}; o.style[prop]=val; return true; };
NewsletterEditorModel.prototype.toggleStyle = function(state,prop,onVal,offVal){ const o=this.getSelectedObject(state); if(!o)return false; if(!o.style)o.style={}; o.style[prop]=o.style[prop]===onVal?offVal:onVal; return true; };
NewsletterEditorModel.prototype.createObject = function(state,type,canvasWidth){
  const defs={textbox:{w:200,h:36,content:'텍스트'},line:{w:200,h:4},rect:{w:120,h:80},circle:{w:80,h:80}};
  const d=defs[type]||{w:100,h:40};
  const obj={id:'nl_'+state.nextId++,type:type,x:Math.max(10,Math.floor(((canvasWidth||state.canvasW||595)-d.w)/2)),y:20+(state.objects||[]).length*10,w:d.w,h:d.h,z:(state.objects||[]).length+1,style:this._defaultStyle(type),content:d.content||''};
  (state.objects||[]).push(obj); return obj;
};
NewsletterEditorModel.prototype.createImageObject = function(state,width,height,content){
  const obj={id:'nl_'+state.nextId++,type:'image',x:50,y:50+(state.objects||[]).length*10,w:width,h:height,z:(state.objects||[]).length+1,style:{borderWidth:0,borderColor:'#000000'},content:content};
  (state.objects||[]).push(obj); return obj;
};
NewsletterEditorModel.prototype.createTableObject = function(state,rows,cols){
  const cells=[]; for(let i=0;i<rows*cols;i++)cells.push({text:'',bg:''});
  const obj={id:'nl_'+state.nextId++,type:'table',x:40,y:50+(state.objects||[]).length*10,w:Math.min(500,cols*80),h:rows*28,z:(state.objects||[]).length+1,style:{fontSize:11,fontFamily:"'Noto Sans KR',sans-serif",color:'#000000',borderColor:'#aaa',borderWidth:1,bgColor:'transparent'},content:'',tableData:{rows:rows,cols:cols,cells:cells}};
  (state.objects||[]).push(obj); return obj;
};
NewsletterEditorModel.prototype.copySelectedObject = function(state){
  const o=this.getSelectedObject(state); if(!o)return null;
  const copy=JSON.parse(JSON.stringify(o)); copy.id='nl_'+state.nextId++; copy.x+=15; copy.y+=15; copy.z=(state.objects||[]).length+1; state.objects.push(copy); return copy;
};
NewsletterEditorModel.prototype.deleteSelectedObjects = function(state){
  const ids=state.selectedIds&&state.selectedIds.length?state.selectedIds:(state.selectedId?[state.selectedId]:[]);
  if(!ids.length)return false; state.objects=(state.objects||[]).filter(function(o){return ids.indexOf(o.id)===-1;}); state.selectedId=null; state.selectedIds=[]; return true;
};
NewsletterEditorModel.prototype.adjustZOrder = function(state,dir){ const o=this.getSelectedObject(state); if(!o)return false; o.z=(o.z||0)+dir; return true; };
NewsletterEditorModel.prototype.bringToFront = function(state){ const o=this.getSelectedObject(state); if(!o)return false; let mx=0;(state.objects||[]).forEach(function(x){if((x.z||0)>mx)mx=x.z;}); o.z=mx+1; return true; };
NewsletterEditorModel.prototype.sendToBack = function(state){ const o=this.getSelectedObject(state); if(!o)return false; let mn=9999;(state.objects||[]).forEach(function(x){if((x.z||0)<mn)mn=x.z;}); o.z=mn-1; return true; };
NewsletterEditorModel.prototype.alignSelectedObject = function(state,dir){
  const o=this.getSelectedObject(state); if(!o)return false;
  const cw=state.canvasW, ch=state.canvasH;
  if(dir==='top')o.y=0;else if(dir==='bottom')o.y=ch-o.h;else if(dir==='left')o.x=0;else if(dir==='right')o.x=cw-o.w;else if(dir==='centerH')o.x=Math.round((cw-o.w)/2);else if(dir==='centerV')o.y=Math.round((ch-o.h)/2);else return false;
  return true;
};
NewsletterEditorModel.prototype.getFocusTable = function(state){ const oid=state._tblFocusObj||state.selectedId; return (state.objects||[]).find(function(o){return o.id===oid&&o.type==='table';})||null; };
NewsletterEditorModel.prototype.addTableRow = function(state,dir){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData)return false;
  const td=obj.tableData, fc=state._tblFocusCell, ri=fc?fc.r:(dir==='below'?td.rows-1:0);
  const nc=[]; for(let c=0;c<td.cols;c++)nc.push({text:'',bg:''});
  td.cells.splice.apply(td.cells,[dir==='below'?(ri+1)*td.cols:ri*td.cols,0].concat(nc)); td.rows++; return true;
};
NewsletterEditorModel.prototype.addTableCol = function(state,dir){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData)return false;
  const td=obj.tableData, fc=state._tblFocusCell, ci=fc?fc.c:(dir==='right'?td.cols-1:0), ic=dir==='right'?ci+1:ci;
  for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+ic,0,{text:'',bg:''}); td.cols++; obj.w+=70; return true;
};
NewsletterEditorModel.prototype.deleteTableRow = function(state){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData||obj.tableData.rows<=1)return false;
  const td=obj.tableData, fc=state._tblFocusCell, ri=fc?fc.r:td.rows-1; td.cells.splice(ri*td.cols,td.cols); td.rows--; return true;
};
NewsletterEditorModel.prototype.deleteTableCol = function(state){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData||obj.tableData.cols<=1)return false;
  const td=obj.tableData, fc=state._tblFocusCell, ci=fc?fc.c:td.cols-1; for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+ci,1); td.cols--; return true;
};
NewsletterEditorModel.prototype.mergeSelectedCells = function(state){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData)return false;
  const s=state._tblSelStart, e=state._tblSelEnd; if(!s||!e)return false;
  const r1=Math.min(s.r,e.r), r2=Math.max(s.r,e.r), c1=Math.min(s.c,e.c), c2=Math.max(s.c,e.c); if(r1===r2&&c1===c2)return false;
  const td=obj.tableData, mainIdx=r1*td.cols+c1, mainCell=td.cells[mainIdx]||{text:'',bg:''}; td.cells[mainIdx]=mainCell;
  mainCell.rowspan=r2-r1+1; mainCell.colspan=c2-c1+1;
  for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){if(r===r1&&c===c1)continue;const idx=r*td.cols+c;if(!td.cells[idx])td.cells[idx]={text:'',bg:''};td.cells[idx].merged=true;}
  return true;
};
NewsletterEditorModel.prototype.unmergeSelectedCells = function(state){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData)return false;
  const s=state._tblSelStart; if(!s)return false;
  const td=obj.tableData, idx=s.r*td.cols+s.c, cell=td.cells[idx]; if(!cell||(!cell.rowspan&&!cell.colspan))return false;
  const rs=cell.rowspan||1, cs=cell.colspan||1;
  for(let r=s.r;r<s.r+rs;r++)for(let c=s.c;c<s.c+cs;c++){const i2=r*td.cols+c;if(td.cells[i2]){delete td.cells[i2].merged;delete td.cells[i2].rowspan;delete td.cells[i2].colspan;}}
  return true;
};
NewsletterEditorModel.prototype.applyCellBg = function(state,color){
  const obj=this.getFocusTable(state); if(!obj||!obj.tableData)return false;
  const s=state._tblSelStart, e=state._tblSelEnd; if(!s)return false;
  const td=obj.tableData, r1=Math.min(s.r,(e||s).r), r2=Math.max(s.r,(e||s).r), c1=Math.min(s.c,(e||s).c), c2=Math.max(s.c,(e||s).c);
  for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){const idx=r*td.cols+c;if(!td.cells[idx])td.cells[idx]={text:'',bg:''};td.cells[idx].bg=color==='transparent'?'':color;}
  return true;
};
const _nlModel = new NewsletterEditorModel();

export { _nlStore, _nlMedia, _nlModel };

/* ── HTML Sanitizer: 위험한 태그/속성 제거 (XSS 방지) ── */
function _nlSanitizeHtml(html){
  if(!html)return '';
  /* script, iframe, object, embed, form, link, meta 태그 제거 */
  let cleaned=html.replace(/<(script|iframe|object|embed|form|link|meta|base|applet)[^>]*>[\s\S]*?<\/\1>/gi,'');
  cleaned=cleaned.replace(/<(script|iframe|object|embed|form|link|meta|base|applet)[^>]*\/?>/gi,'');
  /* on* 이벤트 핸들러 속성 제거 */
  cleaned=cleaned.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi,'');
  /* javascript:, vbscript:, data: 프로토콜 제거 (href, src 등) */
  cleaned=cleaned.replace(/(href|src|action)\s*=\s*(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi,'$1=""');
  return cleaned;
}

/* ═══════════════════════════════════════
   메일 머지
   ═══════════════════════════════════════ */
let _nlMergeData=[];    /* [{이름:'김철수',키:'165',몸무게:'52',...}, ...] */
let _nlMergeFields=[];  /* ['이름','학년','반','번호','키','몸무게',...] */
let _nlMergeIdx=0;      /* 현재 미리보기 인덱스 */
let _nlMergePreview=false; /* 미리보기 모드 ON/OFF */
export function getNlMerge(){ return {data:_nlMergeData,fields:_nlMergeFields,idx:_nlMergeIdx,preview:_nlMergePreview}; }
export function setNlMerge(d){ if(d.data!==undefined)_nlMergeData=d.data; if(d.fields!==undefined)_nlMergeFields=d.fields; if(d.idx!==undefined)_nlMergeIdx=d.idx; if(d.preview!==undefined)_nlMergePreview=d.preview; }

/* 엑셀/CSV 업로드 */
function nlLoadMergeFile(input){
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length){alert('데이터가 비어있습니다.');return;}
      _nlMergeFields=Object.keys(rows[0]);
      _nlMergeData=rows;
      _nlMergeIdx=0;
      _nlMergePreview=false;
      nlMergeUpdateUI();
      /* 미리보기 바 표시 */
      const bar=document.getElementById('nlMergePreviewBar');
      if(bar)bar.style.display='flex';
      nlMergeUpdateNav();
    }catch(err){alert('파일을 읽을 수 없습니다: '+err.message);}
  };
  reader.readAsArrayBuffer(file);
  input.value='';
}

/* 머지 UI 업데이트 (좌측 패널) */
function nlMergeUpdateUI(){
  const info=document.getElementById('nlMergeInfo');if(!info)return;
  if(!_nlMergeData.length){
    info.innerHTML='';
    const zone=document.getElementById('nlMergeZone');if(zone){zone.style.display='';}
    const bar=document.getElementById('nlMergePreviewBar');if(bar)bar.style.display='none';
    return;
  }
  const zone=document.getElementById('nlMergeZone');if(zone)zone.style.display='none';
  let h='<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px;margin-top:6px">'
    +'<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:8px">✅ '+_nlMergeData.length+'명 데이터 로드됨</div>'
    +'<div style="font-size:10px;font-weight:600;color:var(--t2);margin-bottom:6px">필드를 클릭하면 선택한 텍스트에 삽입됩니다:</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:4px">';
  _nlMergeFields.forEach(function(f){
    h+='<button data-action="mergeInsertField" data-field="'+escHtml(f)+'" style="padding:3px 8px;font-size:10px;font-weight:600;border-radius:6px;cursor:pointer;font-family:var(--f);background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#fff;border:none;white-space:nowrap">{{'+escHtml(f)+'}}</button>';
  });
  h+='</div>'
    +'<div style="margin-top:8px;display:flex;gap:4px">'
    +'<button data-action="mergeClearData" style="flex:1;padding:4px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:#ef4444;cursor:pointer;font-family:var(--f)">🗑 데이터 초기화</button>'
    +'<button data-action="mergeReupload" style="flex:1;padding:4px;font-size:9px;font-weight:600;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--t2);cursor:pointer;font-family:var(--f)">📊 다시 업로드</button>'
    +'</div></div>';
  info.innerHTML=h;
  /* attach merge info event delegation */
  info.addEventListener('click',function(e){
    const el=e.target.closest('[data-action]');if(!el)return;
    const action=el.dataset.action;
    if(action==='mergeInsertField')nlMergeInsertField(el.dataset.field);
    else if(action==='mergeClearData')nlMergeClearData();
    else if(action==='mergeReupload'){const inp=document.getElementById('nlMergeInput');if(inp)inp.click();}
  });
}

/* 필드 삽입 */
function nlMergeInsertField(field){
  const tag='{{'+field+'}}';
  /* 선택된 텍스트 객체가 있으면 content 끝에 추가 */
  if(nlState.selectedId){
    const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});
    if(obj&&obj.type==='textbox'){
      nlPushUndo();
      obj.content=(obj.content||'')+tag;
      nlRender();nlSave();return;
    }
    if(obj&&obj.type==='table'){
      /* 테이블 포커스 셀에 삽입 */
      if(nlState._tblFocusObj===obj.id&&nlState._tblFocusCell){
        nlPushUndo();
        const r=nlState._tblFocusCell[0], c=nlState._tblFocusCell[1];
        if(obj.cells&&obj.cells[r]&&obj.cells[r][c]!==undefined){
          obj.cells[r][c]=(obj.cells[r][c]||'')+tag;
          nlRender();nlSave();return;
        }
      }
    }
  }
  /* 선택된 객체 없으면 새 텍스트 객체 생성 */
  nlPushUndo();
  const newObj={id:nlState.nextId++,type:'textbox',x:50,y:50,w:200,h:30,content:tag,fontSize:14,fontFamily:"'Noto Sans KR',sans-serif",fontWeight:'normal',fontStyle:'normal',textDecoration:'none',textAlign:'left',color:'#000000',bgColor:'transparent',borderColor:'#000000',borderWidth:0,borderStyle:'solid'};
  nlState.objects.push(newObj);
  nlState.selectedId=newObj.id;
  nlRender();nlSave();
}

/* 미리보기 네비게이션 */
function nlMergeNav(dir){
  if(!_nlMergeData.length)return;
  _nlMergeIdx+=dir;
  if(_nlMergeIdx<0)_nlMergeIdx=_nlMergeData.length-1;
  if(_nlMergeIdx>=_nlMergeData.length)_nlMergeIdx=0;
  nlMergeUpdateNav();
  if(_nlMergePreview)nlRender();
}
function nlMergeUpdateNav(){
  const label=document.getElementById('nlMergeNavLabel');
  if(!label||!_nlMergeData.length)return;
  const row=_nlMergeData[_nlMergeIdx];
  const name=row[_nlMergeFields[0]]||'';
  label.textContent=name+' ('+(_nlMergeIdx+1)+'/'+_nlMergeData.length+')';
}

/* 미리보기 토글 */
function nlMergeTogglePreview(){
  _nlMergePreview=!_nlMergePreview;
  const btn=document.getElementById('nlMergeToggleBtn');
  if(btn)btn.textContent=_nlMergePreview?'템플릿 보기':'미리보기';
  nlRender();
}

/* 텍스트 내 머지 필드 치환 */
function _nlMergeReplace(text){
  if(!_nlMergePreview||!_nlMergeData.length)return text;
  const row=_nlMergeData[_nlMergeIdx];
  return text.replace(/\{\{(.+?)\}\}/g,function(m,key){
    return row[key]!==undefined?escHtml(String(row[key])):m;
  });
}

/* 데이터 초기화 */
function nlMergeClearData(){
  if(!confirm('메일 머지 데이터를 초기화하시겠습니까?'))return;
  _nlMergeData=[];_nlMergeFields=[];_nlMergeIdx=0;_nlMergePreview=false;
  nlMergeUpdateUI();
  const bar=document.getElementById('nlMergePreviewBar');if(bar)bar.style.display='none';
  nlRender();
}

/* 전체 PDF 생성 */
function nlMergeExportAll(){
  if(!_nlMergeData.length){alert('머지 데이터가 없습니다.');return;}
  if(!window.electronAPI||!window.electronAPI.printToPDF){alert('PDF 생성 기능을 사용할 수 없습니다.');return;}
  if(!(window.electronAPI.newsletterRenderMergePdfHtml)){alert('PDF 생성 기능을 사용할 수 없습니다.');return;}
  window.electronAPI.newsletterRenderMergePdfHtml(nlState,{mergeRows:_nlMergeData}).then(function(renderRes){
    if(!(renderRes&&renderRes.success&&renderRes.html)){alert('PDF 생성 실패: 렌더링 오류');return;}
    const mt=nlState.marginTop||0, mb=nlState.marginBottom||0, ml=nlState.marginLeft||0, mr=nlState.marginRight||0, ch=nlState.canvasH;
    return window.electronAPI.printToPDF(renderRes.html,{
    landscape:nlState.orientation==='landscape',
    pageSize:nlState.paper==='a4'?'A4':{width:226772,height:Math.round(ch*352.78)},
    margins:{top:mt,bottom:mb,left:ml,right:mr},
    printBackground:true
    });
  }).then(function(result){
    if(result&&result.success){alert('PDF가 저장되었습니다:\n'+result.path);}
    else{alert('PDF 생성 실패: '+(result?result.error:'알 수 없는 오류'));}
  }).catch(function(err){alert('PDF 생성 실패: '+err.message);});
}

function nlResetEditor(){
  if(!confirm('모든 내용을 초기화하시겠습니까?'))return;
  nlState.objects=[];nlState.nextId=1;nlState.selectedId=null;
  _nlUndoStack=[];
  nlRender();nlSave(true);
}

function _nlWheelZoom(e){
  if(!e.ctrlKey&&!e.metaKey)return;
  e.preventDefault();
  const delta=e.deltaY>0?-10:10;
  nlSetZoom(nlState.zoom+delta);
}

function _nlKeyHandler(e){
  if(!document.getElementById('nlOverlay')&&!document.getElementById('nlCanvasArea'))return;
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)return;
  if(e.key==='Delete'||e.key==='Backspace'){nlDeleteObj();e.preventDefault();return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){nlUndo();e.preventDefault();return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='c'){nlCopyObj();e.preventDefault();return;}
  if(e.key==='Escape'){nlState.selectedId=null;nlState.selectedIds=[];nlRender();return;}
  /* 화살표 이동: Shift=10px씩 반듯하게 */
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&nlState.selectedId){
    const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});
    if(obj){
      const d=e.shiftKey?10:1;
      nlPushUndo();
      if(e.key==='ArrowUp')obj.y=Math.max(0,obj.y-d);
      if(e.key==='ArrowDown')obj.y+=d;
      if(e.key==='ArrowLeft')obj.x=Math.max(0,obj.x-d);
      if(e.key==='ArrowRight')obj.x+=d;
      nlRender();nlSave();e.preventDefault();
    }
  }
}

function nlLoadState(){
  if(_nlStore){
    const mode=_nlGetMode();
    const localData=_nlStore.readLocalState(mode);
    if(localData)_nlStore.applyState(nlState,localData);
    else {nlState.objects=[];nlState.nextId=1;nlState.pdfBgUrl=null;nlState.pdfFileName=null;}
    _nlStore.loadEditorState(mode).then(function(data){
      if(!data)return;
      _nlStore.applyState(nlState,data);
      nlRender();
    });
  } else {
    try{
      const saved=localStorage.getItem(_nlActiveKey());
      if(saved){
        const d=JSON.parse(saved);
        nlState.objects=d.objects||[];
        nlState.nextId=d.nextId||1;
        nlState.pdfBgUrl=d.pdfBgUrl||null;
        nlState.pdfFileName=d.pdfFileName||null;
        if(d.canvasH)nlState.canvasH=d.canvasH;
        if(d.canvasW)nlState.canvasW=d.canvasW;
        if(d.paper)nlState.paper=d.paper;
        if(d.orientation)nlState.orientation=d.orientation;
        if(typeof d.marginTop==='number')nlState.marginTop=d.marginTop;
        if(typeof d.marginBottom==='number')nlState.marginBottom=d.marginBottom;
        if(typeof d.marginLeft==='number')nlState.marginLeft=d.marginLeft;
        if(typeof d.marginRight==='number')nlState.marginRight=d.marginRight;
        if(typeof d.bgScale==='number')nlState.bgScale=d.bgScale;
        if(typeof d.bgOffsetY==='number')nlState.bgOffsetY=d.bgOffsetY;
        if(typeof d.bgOffsetX==='number')nlState.bgOffsetX=d.bgOffsetX;
      } else {
        nlState.objects=[];nlState.nextId=1;nlState.pdfBgUrl=null;nlState.pdfFileName=null;
      }
    }catch(e){nlState.objects=[];nlState.nextId=1;}
    if(window.electronAPI&&window.electronAPI.editorStateGet){
      const mode2=_nlGetMode();
      window.electronAPI.editorStateGet('newsletter-editor',mode2).then(function(res){
        if(!(res&&res.success&&res.data))return;
        const d=res.data;
        nlState.objects=d.objects||[];
        nlState.nextId=d.nextId||1;
        nlState.pdfBgUrl=d.pdfBgUrl||null;
        nlState.pdfFileName=d.pdfFileName||null;
        if(d.canvasH)nlState.canvasH=d.canvasH;
        if(d.canvasW)nlState.canvasW=d.canvasW;
        if(d.paper)nlState.paper=d.paper;
        if(d.orientation)nlState.orientation=d.orientation;
        if(typeof d.marginTop==='number')nlState.marginTop=d.marginTop;
        if(typeof d.marginBottom==='number')nlState.marginBottom=d.marginBottom;
        if(typeof d.marginLeft==='number')nlState.marginLeft=d.marginLeft;
        if(typeof d.marginRight==='number')nlState.marginRight=d.marginRight;
        if(typeof d.bgScale==='number')nlState.bgScale=d.bgScale;
        if(typeof d.bgOffsetY==='number')nlState.bgOffsetY=d.bgOffsetY;
        if(typeof d.bgOffsetX==='number')nlState.bgOffsetX=d.bgOffsetX;
        nlRender();
      }).catch(function(){});
    }
  }
  setTimeout(function(){
    const uz=document.getElementById('nlUploadZone');
    if(uz&&nlState.pdfFileName){uz.classList.add('loaded');uz.innerHTML='📄 '+escHtml(nlState.pdfFileName)+' (적용됨)';}
  },0);
}

/* ── 용지 선택 ── */
function nlSetPaper(p,btn){
  nlState.paper=p;
  const orientRow=document.getElementById('nlOrientRow');
  if(orientRow)orientRow.style.display=p==='a4'?'':'none';
  if(p==='a4'){
    const orient=nlState.orientation||'portrait';
    if(orient==='landscape'){nlState.canvasW=842;nlState.canvasH=595;}
    else{nlState.canvasW=595;nlState.canvasH=842;}
  } else{nlState.canvasW=280;nlState.canvasH=600;nlState.orientation='portrait';}
  document.querySelectorAll('.nl-paper-btn').forEach(function(b){b.classList.toggle('on',b.dataset.paper===p);});
  nlRender();nlSave(true);
}

function nlSetOrientation(orient,btn){
  nlState.orientation=orient;
  document.querySelectorAll('.nl-orient-btn').forEach(function(b){b.classList.toggle('on',b.dataset.orient===orient);});
  if(nlState.paper==='a4'){
    if(orient==='landscape'){nlState.canvasW=842;nlState.canvasH=595;}
    else{nlState.canvasW=595;nlState.canvasH=842;}
  }
  nlRender();nlSave(true);
}

/* ── 여백 (상하좌우 개별) ── */
function nlSetMarginSide(side,val){
  nlState[side]=Math.max(0,Math.min(30,val||0));
  nlRender();nlSave();
}

/* ── 배경 확대 ── */
function nlSetBgScale(v){
  nlState.bgScale=Math.max(50,Math.min(200,v));
  const label=document.getElementById('nlBgScaleVal');if(label)label.textContent=nlState.bgScale+'%';
  nlRender();nlSave();
}
/* ── 배경 위치 (상하) ── */
function nlSetBgOffsetY(v){
  nlState.bgOffsetY=Math.max(-200,Math.min(200,v));
  const label=document.getElementById('nlBgOffsetYVal');if(label)label.textContent=nlState.bgOffsetY+'px';
  nlRender();nlSave();
}
/* ── 배경 위치 (좌우) ── */
function nlSetBgOffsetX(v){
  nlState.bgOffsetX=Math.max(-200,Math.min(200,v));
  const label=document.getElementById('nlBgOffsetXVal');if(label)label.textContent=nlState.bgOffsetX+'px';
  nlRender();nlSave();
}

/* ── 배경 파일 로드 (PDF + 이미지) ── */
function nlLoadBgFile(input){
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(_nlMedia){
    _nlMedia.loadBackgroundFile(file,{onLoaded:function(payload){
      _nlMedia.applyLoadedBackground(nlState,payload);
      const bs=document.getElementById('nlBgScaleSlider');if(bs)bs.value=100;
      const bv=document.getElementById('nlBgScaleVal');if(bv)bv.textContent='100%';
      nlRender();nlSave(true);
      _nlUpdateUploadZone(file.name);
    }}).then(function(res){
      if(!res||res.ok)return;
      if(res.error==='missing-pdfjs')alert('PDF.js 라이브러리를 로드하지 못했습니다.');
      else if(res.error==='unsupported-type')alert('PDF 또는 이미지 파일만 업로드할 수 있습니다.');
      else alert('파일을 읽을 수 없습니다: '+res.error);
    });
    return;
  }
  if(file.type==='application/pdf'){
    _nlLoadPdf(file);
  } else if(file.type.startsWith('image/')){
    _nlLoadImage(file);
  } else {
    alert('PDF 또는 이미지 파일만 업로드할 수 있습니다.');
  }
}
function nlHandleBgDrop(e){
  if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){
    const f=e.dataTransfer.files[0];
    if(f.type==='application/pdf'||f.type.startsWith('image/'))nlLoadBgFile({files:[f]});
  }
}
function _nlLoadPdf(file){
  const reader=new FileReader();
  reader.onload=function(e){
    const data=new Uint8Array(e.target.result);
    if(typeof pdfjsLib==='undefined'){alert('PDF.js 라이브러리를 로드하지 못했습니다.');return;}
    pdfjsLib.getDocument({data:data}).promise.then(function(pdf){
      pdf.getPage(1).then(function(page){
        const scale=2;
        const vp=page.getViewport({scale:scale});
        const c=document.createElement('canvas');
        c.width=vp.width;c.height=vp.height;
        const ctx=c.getContext('2d');
        page.render({canvasContext:ctx,viewport:vp}).promise.then(function(){
          nlState.pdfBgUrl=c.toDataURL('image/png');
          nlState.pdfFileName=file.name;
          nlState.canvasH=Math.round(nlState.canvasW*(vp.height/vp.width));
          nlState.bgScale=100;
          const bs=document.getElementById('nlBgScaleSlider');if(bs)bs.value=100;
          const bv=document.getElementById('nlBgScaleVal');if(bv)bv.textContent='100%';
          nlRender();nlSave(true);
          _nlUpdateUploadZone(file.name);
        });
      });
    }).catch(function(err){alert('PDF를 읽을 수 없습니다: '+err.message);});
  };
  reader.readAsArrayBuffer(file);
}
function _nlLoadImage(file){
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      nlState.pdfBgUrl=e.target.result;
      nlState.pdfFileName=file.name;
      nlState.canvasH=Math.round(nlState.canvasW*(img.height/img.width));
      nlState.bgScale=100;
      const bs=document.getElementById('nlBgScaleSlider');if(bs)bs.value=100;
      const bv=document.getElementById('nlBgScaleVal');if(bv)bv.textContent='100%';
      nlRender();nlSave(true);
      _nlUpdateUploadZone(file.name);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
function _nlUpdateUploadZone(name){
  const uz=document.getElementById('nlUploadZone');
  if(uz){uz.classList.add('loaded');uz.innerHTML='📄 '+escHtml(name)+' (적용됨)';}
}
function nlRemovePdf(){
  if(_nlMedia){
    _nlMedia.removeBackground(nlState);
    const uz=document.getElementById('nlUploadZone');
    if(uz){uz.classList.remove('loaded');uz.innerHTML='📁 PDF 업로드<br><span style="font-size:9px;color:var(--t3)">클릭 또는 드래그</span>';}
    nlRender();nlSave(true);
    return;
  }
  nlState.pdfBgUrl=null;nlState.pdfFileName=null;
  if(nlState.paper==='a4')nlState.canvasH=842;
  const uz=document.getElementById('nlUploadZone');
  if(uz){uz.classList.remove('loaded');uz.innerHTML='📁 PDF 업로드<br><span style="font-size:9px;color:var(--t3)">클릭 또는 드래그</span>';}
  nlRender();nlSave(true);
}

/* ── 줌 ── */
function nlSetZoom(z){
  nlState.zoom=Math.max(25,Math.min(200,z));
  const canvas=document.getElementById('nlCanvas');
  if(canvas){
    const scale=nlState.zoom/100;
    canvas.style.transform='scale('+scale+')';
    canvas.style.transformOrigin='top center';
    /* 스크롤 영역이 확대 크기를 반영하도록 margin-bottom 보정 */
    const baseH=canvas.scrollHeight||842;
    canvas.style.marginBottom=Math.max(0,(baseH*(scale-1)))+'px';
  }
  const slider=document.getElementById('nlZoomSlider');if(slider)slider.value=nlState.zoom;
  const label=document.getElementById('nlZoomLabel');if(label)label.textContent=nlState.zoom+'%';
}
function _nlZoomSliderWheel(e){
  e.preventDefault();
  const delta=e.deltaY>0?-5:5;
  nlSetZoom(nlState.zoom+delta);
}

/* ── 캔버스 렌더링 ── */
function nlRender(){
  const canvas=document.getElementById('nlCanvas');if(!canvas)return;
  canvas.innerHTML='';
  canvas.style.width=nlState.canvasW+'px';
  canvas.style.minHeight=nlState.canvasH+'px';
  canvas.style.height=nlState.canvasH+'px';
  if(nlState.pdfBgUrl){
    canvas.style.backgroundImage='url('+nlState.pdfBgUrl+')';
    canvas.style.backgroundSize=(nlState.bgScale||100)+'% auto';
    canvas.style.backgroundPosition='calc(50% + '+(nlState.bgOffsetX||0)+'px) '+(nlState.bgOffsetY||0)+'px';
    canvas.style.backgroundRepeat='no-repeat';
  } else {canvas.style.backgroundImage='none';}
  /* 격자선 */
  _nlRenderGrid(canvas);
  /* 여백 가이드 */
  _nlRenderMarginGuide(canvas);
  /* 오브젝트 */
  nlState.objects.sort(function(a,b){return(a.z||0)-(b.z||0);});
  nlState.objects.forEach(function(obj){nlRenderObj(obj,canvas);});
  const info=document.getElementById('nlObjInfo');
  if(info)info.textContent='객체 '+nlState.objects.length+'개';
  if(nlState.selectedId){
    const sel=nlState.objects.find(function(o){return o.id===nlState.selectedId;});
    if(sel)nlSyncStylebar(sel);
  }
}

function _nlRenderGrid(canvas){
  const g=document.createElement('div');
  g.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:0;'
    +'background-image:linear-gradient(rgba(200,200,200,0.18) 1px,transparent 1px),linear-gradient(90deg,rgba(200,200,200,0.18) 1px,transparent 1px);'
    +'background-size:50px 50px';
  canvas.appendChild(g);
}

function _nlRenderMarginGuide(canvas){
  const t=nlState.marginTop*3.78, b=nlState.marginBottom*3.78, l=nlState.marginLeft*3.78, r=nlState.marginRight*3.78;
  if(t<=0&&b<=0&&l<=0&&r<=0)return;
  const guide=document.createElement('div');
  guide.style.cssText='position:absolute;top:'+t+'px;left:'+l+'px;right:'+r+'px;bottom:'+b+'px;border:1px dashed rgba(180,180,180,0.55);pointer-events:none;z-index:9999';
  canvas.appendChild(guide);
}

function nlRenderObj(obj,canvas){
  const el=document.createElement('div');
  el.className='nl-obj'+(obj.id===nlState.selectedId?' selected':'');
  el.dataset.id=obj.id;
  el.style.left=obj.x+'px';el.style.top=obj.y+'px';
  el.style.width=obj.w+'px';
  /* 텍스트/표: 높이 자동, 나머지: 고정 */
  if(obj.type==='textbox'||obj.type==='table'){el.style.height='auto';el.style.minHeight=obj.h+'px';}
  else{el.style.height=obj.h+'px';}
  el.style.zIndex=obj.z||1;
  const s=obj.style||{};
  if(obj.type==='textbox'){
    el.style.fontSize=(s.fontSize||12)+'px';
    el.style.fontFamily=s.fontFamily||"'Pretendard Variable','Pretendard','Noto Sans KR',sans-serif";
    el.style.fontWeight=s.fontWeight||'normal';
    el.style.fontStyle=s.fontStyle||'normal';
    el.style.textDecoration=s.textDecoration||'none';
    el.style.color=s.color||'#000';
    el.style.textAlign=s.textAlign||'left';
    el.style.background=s.bgColor&&s.bgColor!=='transparent'?s.bgColor:'transparent';
    el.style.border=(s.borderWidth||0)>0?(s.borderWidth+'px solid '+(s.borderColor||'#000')):'none';
    el.style.borderRadius=(s.borderRadius||0)+'px';
    el.style.padding='2px 4px';el.style.lineHeight='1.5';el.style.overflow='hidden';el.style.wordBreak='break-word';
    const inner=document.createElement('div');
    inner.contentEditable='true';
    inner.style.cssText='width:100%;height:100%;outline:none;cursor:text;white-space:pre-wrap;overflow:hidden';
    const _rawContent=obj.content||'';
    inner.innerHTML=_nlSanitizeHtml(_nlMergePreview?_nlMergeReplace(_rawContent):_rawContent);
    inner.addEventListener('focus',function(e){e.stopPropagation();});
    inner.addEventListener('input',function(){obj.content=_nlSanitizeHtml(this.innerHTML);nlSave();});
    inner.addEventListener('mousedown',function(e){if(obj.id===nlState.selectedId)e.stopPropagation();});
    el.appendChild(inner);
  } else if(obj.type==='image'){
    el.style.background='transparent';
    el.style.border=(s.borderWidth||0)>0?(s.borderWidth+'px solid '+(s.borderColor||'#000')):'none';
    const img=document.createElement('img');img.src=obj.content||'';
    img.style.cssText='width:100%;height:100%;object-fit:contain;pointer-events:none;display:block';
    el.appendChild(img);
  } else if(obj.type==='rect'){
    el.style.background=s.bgColor&&s.bgColor!=='transparent'?s.bgColor:'rgba(0,0,0,0.05)';
    el.style.border=(s.borderWidth||1)+'px solid '+(s.borderColor||'#000');
    el.style.borderRadius=(s.borderRadius||0)+'px';
  } else if(obj.type==='circle'){
    el.style.background=s.bgColor&&s.bgColor!=='transparent'?s.bgColor:'rgba(0,0,0,0.05)';
    el.style.border=(s.borderWidth||1)+'px solid '+(s.borderColor||'#000');
    el.style.borderRadius='50%';
  } else if(obj.type==='line'){
    el.style.background='transparent';
    el.style.borderTop=(s.borderWidth||1)+'px '+(s.borderStyle||'solid')+' '+(s.borderColor||'#000');
    el.style.height='0px';el.style.minHeight='0';
    el.style.marginTop=Math.floor(obj.h/2)+'px';
  } else if(obj.type==='table'){
    el.style.background=s.bgColor&&s.bgColor!=='transparent'?s.bgColor:'transparent';
    el.style.overflow='visible';
    const td=obj.tableData;if(!td)return;
    const tbl=document.createElement('table');
    tbl.style.cssText='width:100%;height:100%;border-collapse:collapse;font-size:'+(s.fontSize||11)+'px;font-family:'+(s.fontFamily||"'Pretendard Variable','Pretendard','Noto Sans KR',sans-serif")+';color:'+(s.color||'#000')+';table-layout:fixed';
    tbl.dataset.objId=obj.id;
    for(let r=0;r<td.rows;r++){
      const tr=document.createElement('tr');
      for(let c=0;c<td.cols;c++){
        const idx=r*td.cols+c;
        let cell=td.cells[idx];if(!cell){cell={text:'',bg:''};td.cells[idx]=cell;}
        if(cell.merged)continue; /* 병합된 셀 건너뜀 */
        const tdEl=document.createElement('td');
        tdEl.dataset.row=''+r;tdEl.dataset.col=''+c;tdEl.dataset.objId=obj.id;
        const bdrColor=s.borderColor||'#aaa';
        tdEl.style.cssText='border:1px solid '+bdrColor+';padding:3px 4px;vertical-align:top;overflow:hidden;position:relative';
        if(cell.bg)tdEl.style.background=cell.bg;
        if(cell.colspan)tdEl.colSpan=cell.colspan;
        if(cell.rowspan)tdEl.rowSpan=cell.rowspan;
        /* 셀 선택 하이라이트 */
        if(nlState._tblFocusObj===obj.id&&_nlIsCellInSelection(r,c)){
          tdEl.style.outline='2px solid var(--cyan)';tdEl.style.outlineOffset='-2px';
        }
        tdEl.contentEditable='true';
        const _cellText=cell.text||'';
        tdEl.textContent=_nlMergePreview?_nlMergeReplace(_cellText):_cellText;
        (function(ri,ci,oid){
          tdEl.addEventListener('input',function(){
            const o=nlState.objects.find(function(x){return x.id===oid;});
            if(o&&o.tableData){const i2=ri*o.tableData.cols+ci;if(!o.tableData.cells[i2])o.tableData.cells[i2]={text:''};o.tableData.cells[i2].text=this.textContent;nlSave();}
          });
          tdEl.addEventListener('mousedown',function(e){
            if(obj.id===nlState.selectedId)e.stopPropagation();
            nlState._tblFocusObj=oid;nlState._tblFocusCell={r:ri,c:ci};
            nlState._tblSelStart={r:ri,c:ci};nlState._tblSelEnd={r:ri,c:ci};nlState._tblSelecting=true;
            _nlHighlightCells();
          });
          tdEl.addEventListener('mouseenter',function(){
            if(nlState._tblSelecting&&nlState._tblFocusObj===oid){
              nlState._tblSelEnd={r:ri,c:ci};
              _nlHighlightCells();
            }
          });
        })(r,c,obj.id);
        tr.appendChild(tdEl);
      }
      tbl.appendChild(tr);
    }
    el.appendChild(tbl);
  }
  /* 핸들 */
  if(obj.id===nlState.selectedId){
    ['tl','tr','bl','br','ml','mr','tm','bm'].forEach(function(h){
      const handle=document.createElement('div');handle.className='nl-handle '+h;
      handle.addEventListener('mousedown',function(e){nlResizeStart(e,obj.id,h);});
      el.appendChild(handle);
    });
  }
  el.addEventListener('mousedown',function(e){
    if(e.target.classList.contains('nl-handle'))return;
    nlSelectObj(obj.id);
    nlDragStart(e,obj.id);
  });
  el.addEventListener('dblclick',function(e){
    if(obj.type==='textbox'){
      const ed=el.querySelector('[contenteditable]');
      if(ed){ed.focus();const range=document.createRange();range.selectNodeContents(ed);const sel2=window.getSelection();sel2.removeAllRanges();sel2.addRange(range);}
    }
  });
  canvas.appendChild(el);
}

/* ── 셀 선택 하이라이트 ── */
function _nlIsCellInSelection(r,c){
  const s=nlState._tblSelStart, e=nlState._tblSelEnd;
  if(!s||!e)return false;
  const r1=Math.min(s.r,e.r), r2=Math.max(s.r,e.r);
  const c1=Math.min(s.c,e.c), c2=Math.max(s.c,e.c);
  return r>=r1&&r<=r2&&c>=c1&&c<=c2;
}
function _nlHighlightCells(){
  const tbl=document.querySelector('table[data-obj-id="'+nlState._tblFocusObj+'"]');if(!tbl)return;
  tbl.querySelectorAll('td').forEach(function(td){
    const r=parseInt(td.dataset.row), c=parseInt(td.dataset.col);
    if(_nlIsCellInSelection(r,c)){td.style.outline='2px solid var(--cyan)';td.style.outlineOffset='-2px';}
    else{td.style.outline='';td.style.outlineOffset='';}
  });
}
/* mouseup으로 선택 종료 */
document.addEventListener('mouseup',function(){if(typeof nlState!=='undefined')nlState._tblSelecting=false;});

/* ── 셀 선택 해제 ── */
function nlSelectObj(id){
  nlState.selectedId=id;
  const bar=document.getElementById('nlStylebar');
  if(bar)bar.classList.toggle('show',!!id);
  nlRender();
}
function nlCanvasAreaClick(e){
  if(e.target.id==='nlCanvas'||e.target.id==='nlCanvasArea'){
    nlState.selectedId=null;nlState._tblFocusObj=null;nlState._tblSelStart=null;nlState._tblSelEnd=null;
    const bar=document.getElementById('nlStylebar');if(bar)bar.classList.remove('show');
    nlRender();
  }
}

/* ── 스타일바 동기화 ── */
function nlSyncStylebar(obj){
  const s=obj.style||{};
  const isLine=obj.type==='line';
  const isShape=obj.type==='rect'||obj.type==='circle';
  const isImage=obj.type==='image';
  /* 텍스트 그룹: 선/도형/이미지 선택 시 숨김 */
  const tg=document.getElementById('nlTextGroup');if(tg)tg.style.display=(isLine||isShape||isImage)?'none':'';
  /* 배경 그룹: 선/이미지 선택 시 숨김 */
  const bg2=document.getElementById('nlBgGroup');if(bg2)bg2.style.display=(isLine||isImage)?'none':'';
  /* 테두리 라벨: 선이면 "선 색" */
  const bl=document.getElementById('nlBorderLabel');if(bl)bl.textContent=isLine?'선 색':'테두리';
  const ff=document.getElementById('nlFontFamily');if(ff)ff.value=s.fontFamily||"'Pretendard Variable','Pretendard','Noto Sans KR',sans-serif";
  const bb=document.getElementById('nlBoldBtn');if(bb)bb.classList.toggle('on',s.fontWeight==='bold');
  const ib=document.getElementById('nlItalicBtn');if(ib)ib.classList.toggle('on',s.fontStyle==='italic');
  const ub=document.getElementById('nlUnderBtn');if(ub)ub.classList.toggle('on',s.textDecoration==='underline');
  const cp=document.getElementById('nlColorPick');if(cp&&s.color)try{cp.value=s.color;}catch(e){}
  const bgp=document.getElementById('nlBgColorPick');if(bgp&&s.bgColor&&s.bgColor!=='transparent')try{bgp.value=s.bgColor;}catch(e){}
  const bc=document.getElementById('nlBorderColorPick');if(bc&&s.borderColor)try{bc.value=s.borderColor;}catch(e){}
  const bw=document.getElementById('nlBorderWidth');if(bw)bw.value=s.borderWidth||0;
  const bs=document.getElementById('nlBorderStyle');if(bs)bs.value=s.borderStyle||'solid';
}

/* ── 스타일 설정 ── */
function nlSetStyle(prop,val){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.setStyle(nlState,prop,val);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});
  if(!obj)return;
  nlPushUndo();
  if(!obj.style)obj.style={};
  obj.style[prop]=val;
  nlRender();nlSave();
}
function nlToggleStyle(prop,onVal,offVal){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.toggleStyle(nlState,prop,onVal,offVal);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});
  if(!obj)return;
  nlPushUndo();
  if(!obj.style)obj.style={};
  obj.style[prop]=obj.style[prop]===onVal?offVal:onVal;
  nlRender();nlSave();
}

/* ── 드래그 (Shift=직선 이동) ── */
function nlDragStart(e,id){
  if(e.button!==0)return;
  e.preventDefault();
  const obj=nlState.objects.find(function(o){return o.id===id;});if(!obj)return;
  const scale=(nlState.zoom||100)/100;
  nlState.isDragging=true;
  nlState.dragData={id:id,startX:e.clientX,startY:e.clientY,origX:obj.x,origY:obj.y,scale:scale};
  nlPushUndo();
  function onMove(ev){
    if(!nlState.isDragging)return;
    const d=nlState.dragData;
    let dx=(ev.clientX-d.startX)/d.scale;
    let dy=(ev.clientY-d.startY)/d.scale;
    /* Shift: 수평/수직 고정 */
    if(ev.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;}
    obj.x=Math.max(0,Math.round(d.origX+dx));
    obj.y=Math.max(0,Math.round(d.origY+dy));
    const el=document.querySelector('.nl-obj[data-id="'+id+'"]');
    if(el){el.style.left=obj.x+'px';el.style.top=obj.y+'px';}
  }
  function onUp(){
    nlState.isDragging=false;
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    nlSave();
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ── 리사이즈 ── */
function nlResizeStart(e,id,handle){
  e.preventDefault();e.stopPropagation();
  const obj=nlState.objects.find(function(o){return o.id===id;});if(!obj)return;
  const scale=(nlState.zoom||100)/100;
  nlState.isResizing=true;
  const origFontSize=(obj.style&&obj.style.fontSize)?obj.style.fontSize:12;
  nlState.resizeData={id:id,handle:handle,startX:e.clientX,startY:e.clientY,origX:obj.x,origY:obj.y,origW:obj.w,origH:obj.h,scale:scale,origFontSize:origFontSize};
  nlPushUndo();
  function onMove(ev){
    if(!nlState.isResizing)return;
    const r=nlState.resizeData;
    const dx=(ev.clientX-r.startX)/r.scale;
    const dy=(ev.clientY-r.startY)/r.scale;
    const h=r.handle;
    if(h==='br'){obj.w=Math.max(20,Math.round(r.origW+dx));obj.h=Math.max(10,Math.round(r.origH+dy));}
    else if(h==='bl'){obj.x=Math.round(r.origX+dx);obj.w=Math.max(20,Math.round(r.origW-dx));obj.h=Math.max(10,Math.round(r.origH+dy));}
    else if(h==='tr'){obj.w=Math.max(20,Math.round(r.origW+dx));obj.y=Math.round(r.origY+dy);obj.h=Math.max(10,Math.round(r.origH-dy));}
    else if(h==='tl'){obj.x=Math.round(r.origX+dx);obj.w=Math.max(20,Math.round(r.origW-dx));obj.y=Math.round(r.origY+dy);obj.h=Math.max(10,Math.round(r.origH-dy));}
    else if(h==='mr'){obj.w=Math.max(20,Math.round(r.origW+dx));}
    else if(h==='ml'){obj.x=Math.round(r.origX+dx);obj.w=Math.max(20,Math.round(r.origW-dx));}
    else if(h==='bm'){obj.h=Math.max(10,Math.round(r.origH+dy));}
    else if(h==='tm'){obj.y=Math.round(r.origY+dy);obj.h=Math.max(10,Math.round(r.origH-dy));}
    /* 텍스트/표: 꼭짓점 리사이즈 시 글씨 크기 비례 조절 */
    if((obj.type==='textbox'||obj.type==='table')&&['tl','tr','bl','br'].includes(h)){
      const ratio=obj.h/r.origH;
      const newFs=Math.max(6,Math.min(72,Math.round(r.origFontSize*ratio)));
      if(!obj.style)obj.style={};
      obj.style.fontSize=newFs;
    }
    const el=document.querySelector('.nl-obj[data-id="'+id+'"]');
    if(el){el.style.left=obj.x+'px';el.style.top=obj.y+'px';el.style.width=obj.w+'px';el.style.height=obj.h+'px';
      if((obj.type==='textbox'||obj.type==='table')&&['tl','tr','bl','br'].includes(h))el.style.fontSize=(obj.style.fontSize||12)+'px';
    }
  }
  function onUp(){
    nlState.isResizing=false;
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    nlRender();nlSave();
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ── 오브젝트 추가 ── */
function nlAddObj(type){
  const canvas=document.getElementById('nlCanvas');if(!canvas)return;
  if(_nlModel){
    nlPushUndo();
    const created=_nlModel.createObject(nlState,type,canvas.offsetWidth);
    nlSelectObj(created.id);nlSave();
    return;
  }
  const cw=canvas.offsetWidth;
  const defaults={textbox:{w:200,h:36,content:'텍스트'},line:{w:200,h:4},rect:{w:120,h:80},circle:{w:80,h:80}};
  const d=defaults[type]||{w:100,h:40};
  nlPushUndo();
  const obj={id:'nl_'+nlState.nextId++,type:type,x:Math.max(10,Math.floor((cw-d.w)/2)),y:20+nlState.objects.length*10,w:d.w,h:d.h,z:nlState.objects.length+1,
    style:{fontSize:12,fontFamily:"'Noto Sans KR',sans-serif",fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000000',textAlign:'left',bgColor:'transparent',borderColor:'#000000',borderWidth:type==='textbox'?0:1,borderRadius:0},content:d.content||''};
  nlState.objects.push(obj);nlSelectObj(obj.id);nlSave();
}

function nlAddImage(){
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.addEventListener('change', function(){
    if(!this.files||!this.files[0])return;
    const reader=new FileReader();
    reader.onload=function(e){
      nlPushUndo();
      const img=new Image();
      img.onload=function(){
        const w=Math.min(300,img.width);const h=Math.round(w*(img.height/img.width));
        if(_nlModel){
          const created=_nlModel.createImageObject(nlState,w,h,e.target.result);
          nlSelectObj(created.id);nlSave();
          return;
        }
        const obj={id:'nl_'+nlState.nextId++,type:'image',x:50,y:50+nlState.objects.length*10,w:w,h:h,z:nlState.objects.length+1,style:{borderWidth:0,borderColor:'#000000'},content:e.target.result};
        nlState.objects.push(obj);nlSelectObj(obj.id);nlSave();
      };img.src=e.target.result;
    };reader.readAsDataURL(this.files[0]);
  });inp.click();
}

function nlAddTable(){
  const ov2=document.createElement('div');ov2.className='modal-overlay show';ov2.style.zIndex='10000';
  ov2.addEventListener('click',function(e){if(e.target===ov2)closeModalGracefully(ov2);});
  ov2.innerHTML='<div class="modal-content" style="width:280px;padding:20px">'
    +'<div style="font-size:14px;font-weight:800;margin-bottom:14px;color:var(--t1)">📊 표 삽입</div>'
    +'<div style="display:flex;gap:12px;margin-bottom:14px">'
    +'<div style="flex:1"><label style="font-size:11px;font-weight:700;color:var(--t2)">행 수</label><input id="nlTableRows" type="number" min="1" max="20" value="3" class="form-input" style="width:100%;margin-top:4px;font-size:13px;padding:8px"></div>'
    +'<div style="flex:1"><label style="font-size:11px;font-weight:700;color:var(--t2)">열 수</label><input id="nlTableCols" type="number" min="1" max="20" value="3" class="form-input" style="width:100%;margin-top:4px;font-size:13px;padding:8px"></div></div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end">'
    +'<button data-action="cancelTable" style="padding:8px 16px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t2);font-size:12px;font-weight:600;cursor:pointer">취소</button>'
    +'<button data-action="doAddTable" style="padding:8px 16px;border:none;border-radius:6px;background:var(--cyan);color:#fff;font-size:12px;font-weight:700;cursor:pointer">삽입</button></div></div>';
  document.body.appendChild(ov2);
  ov2.querySelector('[data-action="cancelTable"]').addEventListener('click',function(){closeModalGracefully(this.closest('.modal-overlay'));});
  ov2.querySelector('[data-action="doAddTable"]').addEventListener('click',function(){nlDoAddTable();});
  setTimeout(function(){const r=document.getElementById('nlTableRows');if(r)r.focus();},50);
}
function nlDoAddTable(){
  const rows=Math.max(1,Math.min(20,parseInt(document.getElementById('nlTableRows').value)||3));
  const cols=Math.max(1,Math.min(20,parseInt(document.getElementById('nlTableCols').value)||3));
  const ov2=document.querySelector('.modal-overlay[style*="z-index: 10000"]')||document.querySelector('.modal-overlay.show');
  if(ov2)closeModalGracefully(ov2);
  if(_nlModel){
    nlPushUndo();
    const created=_nlModel.createTableObject(nlState,rows,cols);
    nlSelectObj(created.id);nlSave();
    return;
  }
  nlPushUndo();
  const cells=[];for(let i=0;i<rows*cols;i++)cells.push({text:'',bg:''});
  const w=Math.min(500,cols*80);const h=rows*28;
  const obj={id:'nl_'+nlState.nextId++,type:'table',x:40,y:50+nlState.objects.length*10,w:w,h:h,z:nlState.objects.length+1,
    style:{fontSize:11,fontFamily:"'Noto Sans KR',sans-serif",color:'#000000',borderColor:'#aaa',borderWidth:1,bgColor:'transparent'},content:'',tableData:{rows:rows,cols:cols,cells:cells}};
  nlState.objects.push(obj);nlSelectObj(obj.id);nlSave();
}

/* ── 복제/삭제/Z순서/정렬 ── */
function nlCopyObj(){
  if(_nlModel){
    nlPushUndo();
    const copy=_nlModel.copySelectedObject(nlState);
    if(!copy)return;
    nlSelectObj(copy.id);nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});if(!obj)return;
  nlPushUndo();const copy=JSON.parse(JSON.stringify(obj));
  copy.id='nl_'+nlState.nextId++;copy.x+=15;copy.y+=15;copy.z=nlState.objects.length+1;
  nlState.objects.push(copy);nlSelectObj(copy.id);nlSave();
}
function nlDeleteObj(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.deleteSelectedObjects(nlState);
    if(!ok)return;
    const bar=document.getElementById('nlStylebar');if(bar)bar.classList.remove('show');
    nlRender();nlSave();
    return;
  }
  const ids=nlState.selectedIds&&nlState.selectedIds.length?nlState.selectedIds:(nlState.selectedId?[nlState.selectedId]:[]);
  if(!ids.length)return;nlPushUndo();
  nlState.objects=nlState.objects.filter(function(o){return ids.indexOf(o.id)===-1;});
  nlState.selectedId=null;nlState.selectedIds=[];
  {const bar=document.getElementById('nlStylebar');if(bar)bar.classList.remove('show');}
  nlRender();nlSave();
}
function nlZOrder(dir){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.adjustZOrder(nlState,dir);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});if(!obj)return;
  nlPushUndo();obj.z=(obj.z||0)+dir;nlRender();nlSave();
}
function nlZOrderMax(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.bringToFront(nlState);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});if(!obj)return;
  nlPushUndo();let mx=0;nlState.objects.forEach(function(o){if((o.z||0)>mx)mx=o.z;});
  obj.z=mx+1;nlRender();nlSave();
}
function nlZOrderMin(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.sendToBack(nlState);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});if(!obj)return;
  nlPushUndo();let mn=9999;nlState.objects.forEach(function(o){if((o.z||0)<mn)mn=o.z;});
  obj.z=mn-1;nlRender();nlSave();
}
function nlAlign(dir){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.alignSelectedObject(nlState,dir);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});if(!obj)return;
  nlPushUndo();
  const cw=nlState.canvasW, ch=nlState.canvasH;
  if(dir==='top')obj.y=0;
  else if(dir==='bottom')obj.y=ch-obj.h;
  else if(dir==='left')obj.x=0;
  else if(dir==='right')obj.x=cw-obj.w;
  else if(dir==='centerH')obj.x=Math.round((cw-obj.w)/2);
  else if(dir==='centerV')obj.y=Math.round((ch-obj.h)/2);
  nlRender();nlSave();
}

/* ── 표 행/열 추가/삭제 ── */
function _nlGetFocusTable(){
  if(_nlModel)return _nlModel.getFocusTable(nlState);
  const oid=nlState._tblFocusObj||nlState.selectedId;
  const obj=nlState.objects.find(function(o){return o.id===oid&&o.type==='table';});
  return obj;
}
function nlTblAddRow(dir){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.addTableRow(nlState,dir);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData)return;
  const td=obj.tableData;const fc=nlState._tblFocusCell;
  const ri=fc?fc.r:(dir==='below'?td.rows-1:0);
  nlPushUndo();
  const newCells=[];for(let c=0;c<td.cols;c++)newCells.push({text:'',bg:''});
  const insertAt=dir==='below'?(ri+1)*td.cols:ri*td.cols;
  td.cells.splice.apply(td.cells,[insertAt,0].concat(newCells));
  td.rows++;nlRender();nlSave();
}
function nlTblAddCol(dir){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.addTableCol(nlState,dir);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData)return;
  const td=obj.tableData;const fc=nlState._tblFocusCell;
  const ci=fc?fc.c:(dir==='right'?td.cols-1:0);
  nlPushUndo();
  const insertCol=dir==='right'?ci+1:ci;
  for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+insertCol,0,{text:'',bg:''});
  td.cols++;obj.w+=70;nlRender();nlSave();
}
function nlTblDelRow(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.deleteTableRow(nlState);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData||obj.tableData.rows<=1)return;
  const td=obj.tableData;const fc=nlState._tblFocusCell;
  const ri=fc?fc.r:td.rows-1;
  nlPushUndo();td.cells.splice(ri*td.cols,td.cols);td.rows--;nlRender();nlSave();
}
function nlTblDelCol(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.deleteTableCol(nlState);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData||obj.tableData.cols<=1)return;
  const td=obj.tableData;const fc=nlState._tblFocusCell;
  const ci=fc?fc.c:td.cols-1;
  nlPushUndo();
  for(let r=td.rows-1;r>=0;r--)td.cells.splice(r*td.cols+ci,1);
  td.cols--;nlRender();nlSave();
}

/* ── 셀 병합/해제 ── */
function nlMergeCells(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.mergeSelectedCells(nlState);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData)return;
  const s=nlState._tblSelStart, e2=nlState._tblSelEnd;
  if(!s||!e2)return;
  const r1=Math.min(s.r,e2.r), r2=Math.max(s.r,e2.r);
  const c1=Math.min(s.c,e2.c), c2=Math.max(s.c,e2.c);
  if(r1===r2&&c1===c2)return;
  nlPushUndo();
  const td=obj.tableData;
  const mainIdx=r1*td.cols+c1;
  const mainCell=td.cells[mainIdx];
  mainCell.rowspan=r2-r1+1;mainCell.colspan=c2-c1+1;
  /* 나머지 셀 merged 표시 */
  for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){
    if(r===r1&&c===c1)continue;
    const idx=r*td.cols+c;
    if(!td.cells[idx])td.cells[idx]={text:'',bg:''};
    td.cells[idx].merged=true;
  }
  nlRender();nlSave();
}
function nlUnmergeCells(){
  if(_nlModel){
    nlPushUndo();
    const ok=_nlModel.unmergeSelectedCells(nlState);
    if(!ok)return;
    nlRender();nlSave();
    return;
  }
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData)return;
  const s=nlState._tblSelStart;if(!s)return;
  const td=obj.tableData;const idx=s.r*td.cols+s.c;
  const cell=td.cells[idx];if(!cell||!cell.rowspan&&!cell.colspan)return;
  nlPushUndo();
  const rs=cell.rowspan||1, cs=cell.colspan||1;
  for(let r=s.r;r<s.r+rs;r++)for(let c=s.c;c<s.c+cs;c++){
    const i2=r*td.cols+c;
    if(td.cells[i2]){delete td.cells[i2].merged;delete td.cells[i2].rowspan;delete td.cells[i2].colspan;}
  }
  nlRender();nlSave();
}

/* ── 셀 음영 ── */

/* ── NL 셀 음영 컬러 팔레트 (VPE와 동일) ── */
let _nlCellBgColor='#ffffff';
function nlToggleCellBgPalette(btn){
  const drop=document.getElementById('nlCellBgDrop');if(!drop)return;
  const wasOpen=drop.classList.contains('show');
  document.querySelectorAll('#nlToolbar .vpe-color-dropdown.show').forEach(function(d){d.classList.remove('show');});
  if(!wasOpen){drop.classList.add('show');_nlInitCellBgGrid();}
}
function _nlInitCellBgGrid(){
  const grid=document.getElementById('nlCellBgGrid');if(!grid||grid.childNodes.length>0)return;
  _vpePaletteColors.forEach(function(c){
    const cell=document.createElement('div');
    cell.className='vpe-color-cell';
    cell.style.background=c;cell.title=c;
    cell.addEventListener('click',function(e){e.stopPropagation();nlCellBgApplyColor(c);
      document.querySelectorAll('#nlToolbar .vpe-color-dropdown.show').forEach(function(d){d.classList.remove('show');});});
    grid.appendChild(cell);
  });
}
function nlCellBgApplyColor(color){
  const obj=_nlGetFocusTable();if(!obj||!obj.tableData)return;
  const s=nlState._tblSelStart, e2=nlState._tblSelEnd;if(!s)return;
  nlPushUndo();
  const td=obj.tableData;
  const opSel=document.getElementById('nlCellBgOpacity');
  const opacity=opSel?parseInt(opSel.value):100;
  let finalColor='';
  if(color!=='transparent'&&color){
    finalColor=(opacity<100)?_vpHexToRgba(color,opacity):color;
  }
  const r1=Math.min(s.r,(e2||s).r), r2=Math.max(s.r,(e2||s).r);
  const c1=Math.min(s.c,(e2||s).c), c2=Math.max(s.c,(e2||s).c);
  for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){
    const idx=r*td.cols+c;
    if(!td.cells[idx])td.cells[idx]={text:'',bg:''};
    td.cells[idx].bg=finalColor;
  }
  if(color!=='transparent'){_nlCellBgColor=color;const prev=document.getElementById('nlCellBgPreview');if(prev)prev.style.background=finalColor||color;}
  nlRender();nlSave();
}

/* ── 배경 세로로 늘리거나 줄이기 (공통 유틸) ── */
const _bgStretchState={origImg:null,onApply:null,regionTop:0,regionBottom:0,stretchPx:100,pageW:595,pageH:842,bgScale:100,bgOffsetX:0,bgOffsetY:0};
let _bgStretchCumulative=parseInt(localStorage.getItem('ec_bgStretchPx')||'0'); /* 누적 조절량 */

function _bgStretchOpen(srcDataUrl,onApply,pageW,pageH,bgScale,bgOffsetX,bgOffsetY){
  const img=new Image();
  img.onload=function(){
    _bgStretchState.origImg=img;
    _bgStretchState.onApply=onApply;
    _bgStretchState.pageW=pageW||595;
    _bgStretchState.pageH=pageH||842;
    _bgStretchState.bgScale=(bgScale||100);
    _bgStretchState.bgOffsetX=(bgOffsetX||0);
    _bgStretchState.bgOffsetY=(bgOffsetY||0);
    const h=img.height, w=img.width;
    const centerPx=Math.round(h/2);
    const bandHalf=Math.min(Math.round(h*0.1),94);
    _bgStretchState.regionTop=centerPx-bandHalf;
    _bgStretchState.regionBottom=centerPx+bandHalf;
    _bgStretchState.stretchPx=_bgStretchCumulative;
    /* 미리보기 스케일 */
    const maxPrevH=400;
    const origScale=Math.min(maxPrevH/h,1);
    const prevW=Math.round(w*origScale);
    _bgStretchState._scale=origScale;
    _bgStretchState._prevW=prevW;
    /* 결과 미리보기: 원본과 같은 세로 크기 */
    const prevH=Math.round(h*origScale);
    const resPrevH=prevH;
    const resPrevW=Math.round(pageW*(resPrevH/pageH));
    const pageScale=resPrevH/pageH;
    _bgStretchState._pageScale=pageScale;
    _bgStretchState._resPrevW=resPrevW;
    _bgStretchState._resPrevH=resPrevH;

    const ov=document.createElement('div');ov.id='bgStretchOverlay';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:10001;display:flex;align-items:center;justify-content:center';
    /* 바깥 클릭 닫기 비활성 — 슬라이더 조작 시 오닫힘 방지. ESC로만 닫기 */

    _bgStretchState._prevH=prevH;

    ov.innerHTML='<div class="modal-content" style="width:'+Math.max(520,Math.max(prevW,resPrevW)*2+80)+'px;padding:0;max-height:90vh;overflow-y:auto">'
      +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-radius:12px 12px 0 0"><div style="font-size:14px;font-weight:800;color:var(--t1)">📐 배경 세로로 늘리거나 줄이기</div></div>'
      +'<div style="padding:20px">'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.6">빨간 선을 드래그하여 영역을 지정하고, 슬라이더로 늘리기/줄이기 양을 조절하세요.</div>'
      +'<div style="display:flex;gap:12px;margin-bottom:12px">'
      /* 원본 */
      +'<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">원본 (영역 지정)</div>'
      +'<div style="position:relative;margin:0 auto;width:'+prevW+'px;height:'+prevH+'px;border:1px solid var(--bdr);border-radius:6px;overflow:hidden" id="bgStrSrcWrap">'
      +'<canvas id="bgStrSrcCanvas" style="width:100%;display:block"></canvas>'
      +'<div id="bgStrTopLine" style="position:absolute;left:0;right:0;height:3px;background:red;cursor:ns-resize;z-index:2;opacity:0.8" title="영역 상단"></div>'
      +'<div id="bgStrBotLine" style="position:absolute;left:0;right:0;height:3px;background:red;cursor:ns-resize;z-index:2;opacity:0.8" title="영역 하단"></div>'
      +'<div id="bgStrRegion" style="position:absolute;left:0;right:0;background:rgba(255,0,0,0.1);pointer-events:none;z-index:1;border-top:1px dashed red;border-bottom:1px dashed red"></div>'
      +'</div></div>'
      /* 결과 미리보기 — 용지 크기 고정 프레임 */
      +'<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px">결과 미리보기 (용지 크기 고정)</div>'
      +'<div style="border:1px solid var(--cyan);border-radius:6px;overflow:hidden;width:'+resPrevW+'px;height:'+resPrevH+'px;margin:0 auto" id="bgStrResultWrap">'
      +'<canvas id="bgStrResultCanvas" style="display:block;width:'+resPrevW+'px;height:'+resPrevH+'px"></canvas>'
      +'</div></div></div>'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--t2);white-space:nowrap">조절</span>'
      +'<span style="font-size:9px;color:var(--t3)">축소</span>'
      +'<input id="bgStrAmountSlider" type="range" min="-500" max="500" value="'+_bgStretchCumulative+'" style="flex:1;accent-color:var(--cyan)">'
      +'<span style="font-size:9px;color:var(--t3)">늘리기</span>'
      +'<span id="bgStrAmountLabel" style="font-size:13px;font-weight:700;color:'+(_bgStretchCumulative<0?'#ef4444':'var(--cyan)')+';min-width:50px;text-align:center;cursor:pointer" data-action="bgStrEditValue" title="클릭하여 직접 입력">'+(_bgStretchCumulative>0?'+'+_bgStretchCumulative+'px':_bgStretchCumulative===0?'0px':_bgStretchCumulative+'px')+'</span></div>'
      +'<div style="text-align:center;padding-top:8px"><button data-action="bgStretchApply" style="padding:8px 28px;font-size:12px;font-weight:700;background:linear-gradient(135deg,var(--cyan),#0e7490);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:var(--f)">적용</button></div>'
      +'</div></div>';
    document.body.appendChild(ov);
    /* attach event listeners */
    const _bgStrSlider=document.getElementById('bgStrAmountSlider');
    if(_bgStrSlider)_bgStrSlider.addEventListener('input',function(){_bgStrLiveUpdate();});
    const _bgStrLabel=ov.querySelector('[data-action="bgStrEditValue"]');
    if(_bgStrLabel)_bgStrLabel.addEventListener('click',function(){_bgStrEditValue();});
    const _bgStrApplyBtn=ov.querySelector('[data-action="bgStretchApply"]');
    if(_bgStrApplyBtn)_bgStrApplyBtn.addEventListener('click',function(){_bgStretchApply();});
    /* 외부 클릭 닫기 (애니메이션) */
    ov.addEventListener('mousedown',function(e){if(e.target===ov){_bgStrCloseAnim();}});
    /* 드래그 이동 */
    const _bgStrBox=ov.querySelector('.modal-content');
    if(_bgStrBox)_makeDraggable(_bgStrBox);

    /* 원본 캔버스 그리기 */
    _bgStrDrawSrc();
    _bgStrUpdateLines();
    _bgStrDrawResult();
    _bgStrInitDrag('bgStrTopLine','regionTop');
    _bgStrInitDrag('bgStrBotLine','regionBottom');
  };
  img.onerror=function(){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지를 불러올 수 없습니다';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
  };
  img.src=srcDataUrl;
}

function _bgStrDrawSrc(){
  const s=_bgStretchState;if(!s.origImg)return;
  const c=document.getElementById('bgStrSrcCanvas');if(!c)return;
  const pw=s._prevW, ph=Math.round(s.origImg.height*s._scale);
  c.width=pw;c.height=ph;
  const ctx=c.getContext('2d');
  ctx.drawImage(s.origImg,0,0,pw,ph);
}

function _bgStrUpdateLines(){
  const s=_bgStretchState;
  const scale=s._scale;
  const tl=document.getElementById('bgStrTopLine');
  const bl=document.getElementById('bgStrBotLine');
  const rg=document.getElementById('bgStrRegion');
  const topPx=Math.round(s.regionTop*scale);
  const botPx=Math.round(s.regionBottom*scale);
  if(tl)tl.style.top=topPx+'px';
  if(bl)bl.style.top=botPx+'px';
  if(rg){rg.style.top=topPx+'px';rg.style.height=Math.max(0,botPx-topPx)+'px';}
}

function _bgStrDrawResult(){
  const s=_bgStretchState;if(!s.origImg)return;
  const c=document.getElementById('bgStrResultCanvas');if(!c)return;
  const img=s.origImg;
  const rTop=s.regionTop, rBot=s.regionBottom, stretch=s.stretchPx;
  const regionH=rBot-rTop;
  /* 축소 시 영역보다 더 많이 줄일 수 없음 */
  const effStretch=Math.max(stretch, -(regionH-1));
  const newRegionH=regionH+effStretch;
  /* 용지 크기 고정 프레임 — 절대 변하지 않음 */
  const rpw=s._resPrevW, rph=s._resPrevH;
  c.width=rpw;c.height=rph;
  c.style.width=rpw+'px';
  c.style.height=rph+'px';
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,rpw,rph);
  /* 용지 영역으로 클리핑 — 용지 밖은 안 보임 (에디터와 동일) */
  ctx.save();
  ctx.beginPath();ctx.rect(0,0,rpw,rph);ctx.clip();
  /* 배경 크기·위치 반영 (에디터에서 설정한 bgScale, bgOffsetX, bgOffsetY) */
  const bgScaleRatio=(s.bgScale||100)/100;
  let newImgH=img.height+effStretch;
  if(newImgH<10)newImgH=10;
  /* 용지 가로 기준 이미지 그리기 폭/높이 (bgScale 적용) */
  const drawW=Math.round(rpw*bgScaleRatio);
  const drawH=Math.round((newImgH/img.width)*drawW);
  /* 오프셋을 미리보기 스케일로 변환 */
  const pScale=s._pageScale;
  const offX=Math.round((s.bgOffsetX||0)*pScale);
  const offY=Math.round((s.bgOffsetY||0)*pScale);
  /* 이미지 가로 중앙 정렬 + 오프셋 */
  const baseX=Math.round((rpw-drawW)/2)+offX;
  const baseY=offY;
  /* 이미지→그리기 스케일 */
  const imgScale=drawW/img.width;
  const sTop=Math.round(rTop*imgScale);
  const sNewRegionH=Math.round(newRegionH*imgScale);
  /* 상단 */
  if(rTop>0)ctx.drawImage(img,0,0,img.width,rTop,baseX,baseY,drawW,sTop);
  /* 조절된 영역 (세로만 변경) */
  if(regionH>0&&sNewRegionH>0)ctx.drawImage(img,0,rTop,img.width,regionH,baseX,baseY+sTop,drawW,sNewRegionH);
  /* 하단 — 캔버스(용지) 밖으로 나가면 자동 클리핑 */
  const bottomH=img.height-rBot;
  if(bottomH>0){
    const sBottom=Math.round(bottomH*imgScale);
    ctx.drawImage(img,0,rBot,img.width,bottomH,baseX,baseY+sTop+sNewRegionH,drawW,sBottom);
  }
  /* 영역 표시 */
  const highlight=effStretch>=0?'rgba(6,182,212,0.08)':'rgba(255,100,100,0.1)';
  const border=effStretch>=0?'rgba(6,182,212,0.4)':'rgba(255,100,100,0.4)';
  ctx.fillStyle=highlight;
  ctx.fillRect(baseX,baseY+sTop,drawW,sNewRegionH);
  ctx.setLineDash([4,4]);ctx.strokeStyle=border;ctx.lineWidth=1;
  ctx.strokeRect(baseX,baseY+sTop,drawW,sNewRegionH);ctx.setLineDash([]);
  ctx.restore(); /* 클리핑 복원 */
}

function _bgStrInitDrag(lineId,prop){
  const line=document.getElementById(lineId);if(!line)return;
  const s=_bgStretchState;
  line.addEventListener('mousedown',function(me){
    me.preventDefault();me.stopPropagation();
    const startY=me.clientY;const startVal=s[prop];
    const h=s.origImg.height;
    function onMove(ev){
      const dy=(ev.clientY-startY)/s._scale;
      const nv=Math.max(0,Math.min(h,Math.round(startVal+dy)));
      if(prop==='regionTop'&&nv>=s.regionBottom-5)return;
      if(prop==='regionBottom'&&nv<=s.regionTop+5)return;
      s[prop]=nv;
      _bgStrUpdateLines();
      _bgStrDrawResult();
    }
    function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}

let _bgStrTimer=null;
const _bgStrApplyTimer=null;
function _bgStrLiveUpdate(){
  const slider=document.getElementById('bgStrAmountSlider');if(!slider)return;
  const v=parseInt(slider.value);
  _bgStretchState.stretchPx=v;
  const label=document.getElementById('bgStrAmountLabel');
  if(label){
    const txt=v>0?'+'+v+'px':v===0?'0':v+'px';
    label.textContent=txt;
    label.style.color=v<0?'#ef4444':'var(--cyan)';
  }
  if(_bgStrTimer)clearTimeout(_bgStrTimer);
  _bgStrTimer=setTimeout(function(){_bgStrDrawResult();},30);
}

function _bgStrEditValue(){
  const label=document.getElementById('bgStrAmountLabel');if(!label)return;
  const cur=_bgStretchState.stretchPx||0;
  const input=document.createElement('input');
  input.type='number';input.value=cur;input.min=-500;input.max=500;
  input.style.cssText='width:60px;font-size:13px;font-weight:700;color:var(--cyan);text-align:center;border:1px solid var(--cyan);border-radius:4px;background:var(--bg2);font-family:var(--fm);padding:2px';
  label.innerHTML='';label.appendChild(input);
  input.focus();input.select();
  function apply(){
    let v=parseInt(input.value)||0;v=Math.max(-500,Math.min(500,v));
    _bgStretchState.stretchPx=v;
    const slider=document.getElementById('bgStrAmountSlider');if(slider)slider.value=v;
    const txt=v>0?'+'+v+'px':v===0?'0px':v+'px';
    label.innerHTML=txt;label.style.color=v<0?'#ef4444':'var(--cyan)';
    label.style.cursor='pointer';
    label.addEventListener('click',_bgStrEditValue);
    _bgStrDrawResult();
  }
  input.addEventListener('blur',apply);
  input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();apply();}});
}
function _bgStrCloseAnim(){
  const ov=document.getElementById('bgStretchOverlay');if(!ov)return;
  const box=ov.querySelector('.modal-content');
  ov.style.transition='opacity 0.2s ease';ov.style.opacity='0';
  if(box){box.style.transition='opacity 0.2s ease,transform 0.2s ease';box.style.opacity='0';box.style.transform='scale(0.95)';}
  setTimeout(function(){ov.remove();_bgStretchState.origImg=null;},200);
}
function _bgStretchApply(){
  const s=_bgStretchState;if(!s.origImg)return;
  const img=s.origImg;
  const rTop=s.regionTop, rBot=s.regionBottom, stretch=s.stretchPx;
  const regionH=rBot-rTop;
  const effStretch=Math.max(stretch, -(regionH-1));
  const newRegionH=regionH+effStretch;
  const newH=Math.max(10,img.height+effStretch);
  const c=document.createElement('canvas');c.width=img.width;c.height=newH;
  const ctx=c.getContext('2d');
  if(rTop>0)ctx.drawImage(img,0,0,img.width,rTop,0,0,img.width,rTop);
  if(regionH>0&&newRegionH>0)ctx.drawImage(img,0,rTop,img.width,regionH,0,rTop,img.width,newRegionH);
  const bottomH=img.height-rBot;
  if(bottomH>0)ctx.drawImage(img,0,rBot,img.width,bottomH,0,rTop+newRegionH,img.width,bottomH);

  const result=c.toDataURL('image/png');
  _bgStretchCumulative=s.stretchPx;
  localStorage.setItem('ec_bgStretchPx',String(_bgStretchCumulative));
  const _applyResult=result;const _applyFn=s.onApply;
  const ov=document.getElementById('bgStretchOverlay');
  if(ov){
    const box=ov.querySelector('.modal-content');
    ov.style.transition='opacity 0.2s ease';ov.style.opacity='0';
    if(box){box.style.transition='opacity 0.2s ease,transform 0.2s ease';box.style.opacity='0';box.style.transform='scale(0.95)';}
    setTimeout(function(){ov.remove();if(_applyFn)_applyFn(_applyResult);},200);
  } else {
    if(_applyFn)_applyFn(_applyResult);
  }
  _bgStretchState.origImg=null;_bgStretchState.onApply=null;
}

/* 에디터별 배경 세로로 늘리거나 줄이기 래퍼 */
function nlStretchBg(){
  if(!nlState.pdfBgUrl){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='배경 이미지를 먼저 업로드하세요';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  _bgStretchOpen(nlState.pdfBgUrl,function(resultUrl){
    nlPushUndo();nlState.pdfBgUrl=resultUrl;
    /* A4 용지 크기는 유지 — 배경 이미지만 변경 */
    nlRender();nlSave(true);
  },nlState.canvasW,nlState.canvasH,nlState.bgScale,nlState.bgOffsetX,nlState.bgOffsetY);
}
export function vpeStretchBg(){
  if(!vpeState.pdfBgUrl){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='배경 이미지를 먼저 업로드하세요';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  const size=_vpeMedia?_vpeMedia.getPaperSize(vpState,vpeState):null;
  let pw=size?size.w:null, ph=size?size.h:null;
  if(!size){
    const isA4=vpState.paper==='a4';
    if(isA4&&vpState.orientation==='landscape'){pw=842;ph=595;}
    else if(isA4){pw=595;ph=842;}
    else{pw=280;ph=vpeState._cutY||400;}
  }
  _bgStretchOpen(vpeState.pdfBgUrl,function(resultUrl){
    vpePushUndo();
    if(_vpeMedia)_vpeMedia.applyStretchedBackground(vpeState,resultUrl);
    else vpeState.pdfBgUrl=resultUrl;
    /* A4 용지 크기는 유지 — 배경 이미지만 변경 */
    vpeEditorRender();vpeEditorAutoSave();
  },pw,ph,vpeState.bgScale,vpeState.bgOffsetX,vpeState.bgOffsetY);
}

/* ── 이미지 배경 제거 (공통 유틸) ── */
const _bgRmState={origImg:null,origData:null,onApply:null};

function _bgRmProcess(threshold){
  const s=_bgRmState;if(!s.origImg)return;
  const pc=document.getElementById('bgRmPreviewCanvas');if(!pc)return;
  pc.width=s.origImg.width;pc.height=s.origImg.height;
  const ctx=pc.getContext('2d');
  const newData=ctx.createImageData(s.origImg.width,s.origImg.height);
  const src=s.origData.data;const dst=newData.data;
  /* 부드러운 엣지를 위한 페더링 범위 */
  const feather=20;
  for(let i=0;i<src.length;i+=4){
    const r=src[i], g=src[i+1], b=src[i+2], a=src[i+3];
    dst[i]=r;dst[i+1]=g;dst[i+2]=b;dst[i+3]=a;
    /* 밝기(luminance) 기반 판정 */
    const lum=0.299*r+0.587*g+0.114*b;
    /* 채도가 낮은(회색 계열) 밝은 픽셀만 제거 — 색상 있는 물체 보존 */
    const maxC=Math.max(r,g,b), minC=Math.min(r,g,b);
    const sat=maxC>0?(maxC-minC)/maxC:0;
    if(lum>threshold&&sat<0.25){
      dst[i+3]=0;
    } else if(lum>(threshold-feather)&&sat<0.25){
      /* 페더링 구간: 부드럽게 알파 전환 */
      const t=(threshold-lum)/feather;
      dst[i+3]=Math.round(a*Math.min(1,t));
    }
  }
  ctx.putImageData(newData,0,0);
}

export function _bgRmOpen(srcDataUrl,onApply){
  /* 이미지 크기 제한: 너무 큰 이미지는 리사이즈 */
  const img=new Image();
  img.onload=function(){
    const maxDim=2000;
    let w=img.width, h=img.height;
    if(w>maxDim||h>maxDim){
      const ratio=Math.min(maxDim/w,maxDim/h);
      w=Math.round(w*ratio);h=Math.round(h*ratio);
    }
    const tmpC=document.createElement('canvas');tmpC.width=w;tmpC.height=h;
    const tmpCtx=tmpC.getContext('2d');tmpCtx.drawImage(img,0,0,w,h);
    _bgRmState.origImg={width:w,height:h};
    _bgRmState.origData=tmpCtx.getImageData(0,0,w,h);
    _bgRmState.onApply=onApply;

    const ov2=document.createElement('div');ov2.className='modal-overlay show';ov2.id='bgRmOverlay';ov2.style.zIndex='10001';
    ov2.addEventListener('click',function(e){if(e.target===ov2){closeModalGracefully(ov2);_bgRmState.origImg=null;}});
    const checkerBg='background:repeating-conic-gradient(#d0d0d0 0% 25%,#fff 0% 50%) 50%/14px 14px';
    ov2.innerHTML='<div class="modal-content" style="width:620px;padding:0;max-height:85vh;overflow-y:auto">'
      +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-radius:12px 12px 0 0"><div style="font-size:14px;font-weight:800;color:var(--t1)">🪄 이미지 배경 제거</div>'
      +'<div style="font-size:11px;color:var(--t3);margin-top:4px;line-height:1.6">밝은 배경(흰색·회색 계열)을 투명하게 변환합니다. 슬라이더로 결과를 확인한 뒤 <b>빈 슬롯에 넣기</b> 버튼을 눌러 저장합니다.</div></div>'
      +'<div style="padding:16px 20px">'
      +'<div style="display:flex;gap:10px;margin-bottom:12px">'
      +'<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">원본</div><div style="border:1px solid var(--bdr);border-radius:6px;overflow:hidden;'+checkerBg+';padding:4px;min-height:120px;display:flex;align-items:center;justify-content:center"><img src="'+srcDataUrl+'" style="max-width:100%;max-height:260px;object-fit:contain;display:block"></div></div>'
      +'<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px">결과 미리보기</div><div style="border:1px solid var(--cyan);border-radius:6px;overflow:hidden;'+checkerBg+';padding:4px;min-height:120px;display:flex;align-items:center;justify-content:center"><canvas id="bgRmPreviewCanvas" style="max-width:100%;max-height:260px;object-fit:contain;display:block"></canvas></div></div>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--t2);white-space:nowrap">임계값</span>'
      +'<span style="font-size:9px;color:var(--t3)">적게</span>'
      +'<input id="bgRmSlider" type="range" min="60" max="255" value="200" style="flex:1;accent-color:var(--cyan)">'
      +'<span style="font-size:9px;color:var(--t3)">많이</span>'
      +'<span id="bgRmValLabel" style="font-size:13px;font-weight:700;color:var(--cyan);min-width:32px;text-align:center">200</span></div>'
      +'</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 12px 12px">'
      +'<button id="bgRmCancelBtn" style="padding:8px 18px;font-size:12px;font-weight:600;background:var(--card);color:var(--t2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-family:var(--f)">취소</button>'
      +'<button id="bgRmConfirmBtn" style="padding:8px 22px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:var(--f)">📥 빈 슬롯에 넣기</button>'
      +'</div>'
      +'</div>';
    document.body.appendChild(ov2);
    const _bgRmSliderEl=document.getElementById('bgRmSlider');
    if(_bgRmSliderEl)_bgRmSliderEl.addEventListener('input',function(){_bgRmLiveUpdate();});
    /* 취소: 적용하지 않고 닫기 */
    const cancelBtn=document.getElementById('bgRmCancelBtn');
    if(cancelBtn)cancelBtn.addEventListener('click',function(){
      closeModalGracefully(ov2);
      _bgRmState.origImg=null;_bgRmState.origData=null;_bgRmState.onApply=null;
    });
    /* 확인: 결과 적용 + 닫기 */
    const confirmBtn=document.getElementById('bgRmConfirmBtn');
    if(confirmBtn)confirmBtn.addEventListener('click',function(){_bgRmApply();});
    _bgRmProcess(200);
  };
  img.onerror=function(){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지를 불러올 수 없습니다';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
  };
  img.src=srcDataUrl;
}

let _bgRmTimer=null;
function _bgRmLiveUpdate(){
  const slider=document.getElementById('bgRmSlider');if(!slider)return;
  const v=parseInt(slider.value);
  const label=document.getElementById('bgRmValLabel');if(label)label.textContent=v;
  if(_bgRmTimer)clearTimeout(_bgRmTimer);
  _bgRmTimer=setTimeout(function(){_bgRmProcess(v);},30);
  /* 자동 적용 제거 — 사용자가 [확인] 버튼을 눌러야 슬롯에 저장됨 */
}

function _bgRmApply(){
  const pc=document.getElementById('bgRmPreviewCanvas');
  const ov2=document.getElementById('bgRmOverlay');
  if(pc&&_bgRmState.onApply){
    const trimmed=_autoTrimCanvas(pc);
    const result=trimmed.toDataURL('image/png');
    if(ov2)closeModalGracefully(ov2);
    _bgRmState.onApply(result);
    _bgRmState.origImg=null;_bgRmState.origData=null;_bgRmState.onApply=null;
  }
}

/* ── 투명 영역 자동 자르기 ── */
export function _autoTrimCanvas(srcCanvas){
  const w=srcCanvas.width, h=srcCanvas.height;
  const data=srcCanvas.getContext('2d').getImageData(0,0,w,h).data;
  let top=h, left=w, right=0, bottom=0;
  for(let y=0;y<h;y++){for(let x=0;x<w;x++){
    if(data[(y*w+x)*4+3]>10){if(y<top)top=y;if(y>bottom)bottom=y;if(x<left)left=x;if(x>right)right=x;}
  }}
  if(top>bottom||left>right)return srcCanvas;
  top=Math.max(0,top-2);left=Math.max(0,left-2);
  right=Math.min(w-1,right+2);bottom=Math.min(h-1,bottom+2);
  const tw=right-left+1, th=bottom-top+1;
  const tc=document.createElement('canvas');tc.width=tw;tc.height=th;
  tc.getContext('2d').drawImage(srcCanvas,left,top,tw,th,0,0,tw,th);
  return tc;
}

function nlRemoveImageBg(){
  const obj=nlState.objects.find(function(o){return o.id===nlState.selectedId;});
  if(!obj||obj.type!=='image'){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지 객체를 먼저 선택하세요';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  const imgData=obj.content||obj.src;
  if(!imgData){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지 데이터가 없습니다';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  _bgRmOpen(imgData,function(resultUrl){
    nlPushUndo();
    if(_nlMedia)_nlMedia.applyImageBgRemoval(nlState,resultUrl);
    else {obj.content=resultUrl;obj.src=resultUrl;}
    nlRender();nlSave(true);
  });
}
export function vpeRemoveImageBg(){
  const obj=vpeState.objects.find(function(o){return o.id===vpeState.selectedId;});
  if(!obj||obj.type!=='image'){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지 객체를 먼저 선택하세요';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  const imgData=obj.src||obj.content;
  if(!imgData){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지 데이터가 없습니다';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  _bgRmOpen(imgData,function(resultUrl){
    vpePushUndo();
    if(_vpeMedia)_vpeMedia.applyImageBgRemoval(vpeState,resultUrl);
    else {obj.src=resultUrl;obj.content=resultUrl;}
    vpeEditorRender();vpeEditorAutoSave();
  });
}

/* ── 이미지 자르기 (공통 유틸) ── */
const _cropState={origImg:null,onApply:null,cropL:0,cropR:0,cropT:0,cropB:0,mode:'free'};

function _cropOpen(srcDataUrl,onApply){
  const img=new Image();
  img.onload=function(){
    _cropState.origImg=img;_cropState.onApply=onApply;
    _cropState.cropL=0;_cropState.cropR=0;_cropState.cropT=0;_cropState.cropB=0;_cropState.mode='free';
    const maxPrevH=360, scale=Math.min(maxPrevH/img.height,360/img.width,1);
    _cropState._scale=scale;
    _cropState._prevW=Math.round(img.width*scale);
    _cropState._prevH=Math.round(img.height*scale);

    const ov=document.createElement('div');ov.className='modal-overlay show';ov.id='cropOverlay';ov.style.zIndex='10001';
    ov.addEventListener('click',function(e){if(e.target===ov){closeModalGracefully(ov);_cropState.origImg=null;}});
    ov.innerHTML='<div class="modal-content" style="width:'+Math.max(480,_cropState._prevW+80)+'px;padding:0;max-height:90vh;overflow-y:auto">'
      +'<div style="padding:14px 20px;border-bottom:1px solid var(--bdr);background:linear-gradient(135deg,rgba(6,182,212,0.10),rgba(139,92,246,0.06));border-radius:12px 12px 0 0"><div style="font-size:14px;font-weight:800;color:var(--t1)">✂ 이미지 자르기</div></div>'
      +'<div style="padding:20px">'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.6">빨간 핸들을 드래그하여 잘라낼 영역을 조절하세요.</div>'
      +'<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">'
      +'<button class="crop-mode-btn on" data-mode="free" data-action="cropMode">자유 자르기</button>'
      +'<button class="crop-mode-btn" data-mode="horizontal" data-action="cropMode">좌우 자르기</button>'
      +'<button class="crop-mode-btn" data-mode="vertical" data-action="cropMode">상하 자르기</button>'
      +'<button class="crop-mode-btn" data-mode="diagonal" data-action="cropMode">대각선 자르기</button></div>'
      +'<div style="display:flex;gap:12px;margin-bottom:12px">'
      +'<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">자르기 영역 지정</div>'
      +'<div style="position:relative;margin:0 auto;width:'+_cropState._prevW+'px;height:'+_cropState._prevH+'px;border:1px solid var(--bdr);border-radius:6px;overflow:hidden;cursor:crosshair" id="cropSrcWrap">'
      +'<canvas id="cropSrcCanvas" style="width:100%;height:100%;display:block"></canvas>'
      /* 4 drag handles */
      +'<div id="cropHandleL" class="crop-handle crop-handle-l" title="왼쪽"></div>'
      +'<div id="cropHandleR" class="crop-handle crop-handle-r" title="오른쪽"></div>'
      +'<div id="cropHandleT" class="crop-handle crop-handle-t" title="위쪽"></div>'
      +'<div id="cropHandleB" class="crop-handle crop-handle-b" title="아래쪽"></div>'
      +'<div id="cropOverlayL" class="crop-overlay-dim" style="left:0;top:0;bottom:0;width:0"></div>'
      +'<div id="cropOverlayR" class="crop-overlay-dim" style="right:0;top:0;bottom:0;width:0"></div>'
      +'<div id="cropOverlayT" class="crop-overlay-dim" style="left:0;top:0;right:0;height:0"></div>'
      +'<div id="cropOverlayB" class="crop-overlay-dim" style="left:0;bottom:0;right:0;height:0"></div>'
      +'</div></div>'
      +'<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px">결과 미리보기</div>'
      +'<div style="border:1px solid var(--cyan);border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:100px;max-height:'+_cropState._prevH+'px" id="cropResultWrap">'
      +'<canvas id="cropResultCanvas" style="max-width:100%;max-height:100%;display:block"></canvas>'
      +'</div></div></div>'
      +'<div id="cropDiagInfo" style="display:none;margin-bottom:8px">'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--t2);white-space:nowrap">각도</span>'
      +'<input id="cropDiagAngle" type="range" min="0" max="360" value="45" style="flex:1;accent-color:var(--cyan)">'
      +'<span id="cropDiagLabel" style="font-size:11px;font-weight:700;color:var(--cyan);min-width:40px;text-align:center">45°</span></div>'
      +'<div style="display:flex;align-items:center;gap:8px;margin-top:4px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--t2);white-space:nowrap">위치</span>'
      +'<input id="cropDiagPos" type="range" min="0" max="100" value="50" style="flex:1;accent-color:var(--cyan)">'
      +'<span id="cropDiagPosLabel" style="font-size:11px;font-weight:700;color:var(--cyan);min-width:40px;text-align:center">50%</span></div>'
      +'<div style="display:flex;gap:6px;margin-top:4px">'
      +'<button class="crop-diag-side-btn on" data-side="keep-left" data-action="cropDiagSide">왼쪽 유지</button>'
      +'<button class="crop-diag-side-btn" data-side="keep-right" data-action="cropDiagSide">오른쪽 유지</button></div></div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end">'
      +'<button data-action="cropCancel" style="padding:8px 16px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--t2);font-size:12px;font-weight:600;cursor:pointer">취소</button>'
      +'<button data-action="cropApply" style="padding:8px 16px;border:none;border-radius:6px;background:var(--cyan);color:#fff;font-size:12px;font-weight:700;cursor:pointer">적용</button></div></div></div>';
    document.body.appendChild(ov);
    /* attach crop event listeners */
    ov.addEventListener('click',function(e){
      const el=e.target.closest('[data-action]');if(!el)return;
      const action=el.dataset.action;
      if(action==='cropMode')_cropSetMode(el.dataset.mode,el);
      else if(action==='cropDiagSide')_cropDiagSide(el.dataset.side,el);
      else if(action==='cropCancel'){closeModalGracefully('cropOverlay');_cropState.origImg=null;}
      else if(action==='cropApply')_cropApply();
    });
    const _cDiagAngle=document.getElementById('cropDiagAngle');
    if(_cDiagAngle)_cDiagAngle.addEventListener('input',function(){_cropDiagUpdate();});
    const _cDiagPos=document.getElementById('cropDiagPos');
    if(_cDiagPos)_cDiagPos.addEventListener('input',function(){_cropDiagUpdate();});

    /* 스타일 주입 (한 번만) */
    if(!document.getElementById('cropStyles')){
      const st=document.createElement('style');st.id='cropStyles';
      st.textContent='.crop-handle{position:absolute;z-index:3;}'
        +'.crop-handle-l,.crop-handle-r{top:0;bottom:0;width:6px;cursor:ew-resize;background:rgba(239,68,68,0.5);}'
        +'.crop-handle-l{left:0}.crop-handle-r{right:0}'
        +'.crop-handle-t,.crop-handle-b{left:0;right:0;height:6px;cursor:ns-resize;background:rgba(239,68,68,0.5);}'
        +'.crop-handle-t{top:0}.crop-handle-b{bottom:0}'
        +'.crop-overlay-dim{position:absolute;background:rgba(0,0,0,0.35);pointer-events:none;z-index:2;}'
        +'.crop-mode-btn{padding:4px 10px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);font-size:10px;font-weight:600;cursor:pointer}'
        +'.crop-mode-btn.on{background:var(--cyan);color:#fff;border-color:var(--cyan)}'
        +'.crop-diag-side-btn{padding:3px 8px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg);color:var(--t2);font-size:10px;cursor:pointer}'
        +'.crop-diag-side-btn.on{background:var(--cyan);color:#fff;border-color:var(--cyan)}';
      document.head.appendChild(st);
    }
    _cropDrawSrc();_cropUpdateOverlays();_cropDrawResult();
    _cropInitHandles();
  };
  img.src=srcDataUrl;
}

function _cropSetMode(mode,btn){
  _cropState.mode=mode;
  document.querySelectorAll('.crop-mode-btn').forEach(function(b){b.classList.toggle('on',b.dataset.mode===mode);});
  const diagInfo=document.getElementById('cropDiagInfo');
  if(diagInfo)diagInfo.style.display=mode==='diagonal'?'':'none';
  /* 핸들 가시성 */
  const hL=document.getElementById('cropHandleL'), hR=document.getElementById('cropHandleR');
  const hT=document.getElementById('cropHandleT'), hB=document.getElementById('cropHandleB');
  if(mode==='horizontal'){_cropState.cropT=0;_cropState.cropB=0;if(hT)hT.style.display='none';if(hB)hB.style.display='none';if(hL)hL.style.display='';if(hR)hR.style.display='';}
  else if(mode==='vertical'){_cropState.cropL=0;_cropState.cropR=0;if(hL)hL.style.display='none';if(hR)hR.style.display='none';if(hT)hT.style.display='';if(hB)hB.style.display='';}
  else if(mode==='diagonal'){if(hL)hL.style.display='none';if(hR)hR.style.display='none';if(hT)hT.style.display='none';if(hB)hB.style.display='none';}
  else{if(hL)hL.style.display='';if(hR)hR.style.display='';if(hT)hT.style.display='';if(hB)hB.style.display='';}
  if(mode==='diagonal'){_cropState._diagAngle=45;_cropState._diagPos=50;_cropState._diagSide='keep-left';_cropDiagUpdate();}
  else{_cropUpdateOverlays();_cropDrawResult();}
}

function _cropDrawSrc(){
  const s=_cropState;if(!s.origImg)return;
  const c=document.getElementById('cropSrcCanvas');if(!c)return;
  c.width=s._prevW;c.height=s._prevH;
  c.getContext('2d').drawImage(s.origImg,0,0,s._prevW,s._prevH);
}

function _cropUpdateOverlays(){
  const s=_cropState, pw=s._prevW, ph=s._prevH;
  const lPx=Math.round(s.cropL*s._scale), rPx=Math.round(s.cropR*s._scale);
  const tPx=Math.round(s.cropT*s._scale), bPx=Math.round(s.cropB*s._scale);
  const oL=document.getElementById('cropOverlayL'), oR=document.getElementById('cropOverlayR');
  const oT=document.getElementById('cropOverlayT'), oB=document.getElementById('cropOverlayB');
  if(oL)oL.style.width=lPx+'px';
  if(oR)oR.style.width=rPx+'px';
  if(oT)oT.style.height=tPx+'px';
  if(oB)oB.style.height=bPx+'px';
  const hL=document.getElementById('cropHandleL'), hR=document.getElementById('cropHandleR');
  const hT=document.getElementById('cropHandleT'), hB=document.getElementById('cropHandleB');
  if(hL)hL.style.left=Math.max(0,lPx-3)+'px';
  if(hR)hR.style.right=Math.max(0,rPx-3)+'px';
  if(hT)hT.style.top=Math.max(0,tPx-3)+'px';
  if(hB)hB.style.bottom=Math.max(0,bPx-3)+'px';
}

function _cropDrawResult(){
  const s=_cropState;if(!s.origImg)return;
  const c=document.getElementById('cropResultCanvas');if(!c)return;
  const img=s.origImg;
  if(s.mode==='diagonal'){_cropDrawDiagResult();return;}
  const sx=s.cropL, sy=s.cropT;
  const sw=Math.max(1,img.width-s.cropL-s.cropR);
  const sh=Math.max(1,img.height-s.cropT-s.cropB);
  c.width=sw;c.height=sh;
  c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
}

function _cropInitHandles(){
  function initDrag(handleId,prop,axis){
    const el=document.getElementById(handleId);if(!el)return;
    el.addEventListener('mousedown',function(me){
      me.preventDefault();me.stopPropagation();
      const s=_cropState, startPos=axis==='x'?me.clientX:me.clientY, startVal=s[prop];
      const maxVal=axis==='x'?s.origImg.width:s.origImg.height;
      const oppProp=prop==='cropL'?'cropR':prop==='cropR'?'cropL':prop==='cropT'?'cropB':'cropT';
      function onMove(ev){
        let delta=((axis==='x'?ev.clientX:ev.clientY)-startPos)/s._scale;
        if(prop==='cropR'||prop==='cropB')delta=-delta;
        let nv=Math.max(0,Math.round(startVal+delta));
        if(nv+s[oppProp]>=maxVal-10)nv=maxVal-s[oppProp]-10;
        s[prop]=Math.max(0,nv);
        _cropUpdateOverlays();_cropDrawResult();
      }
      function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
      document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
    });
  }
  initDrag('cropHandleL','cropL','x');
  initDrag('cropHandleR','cropR','x');
  initDrag('cropHandleT','cropT','y');
  initDrag('cropHandleB','cropB','y');
}

/* 대각선 자르기 */
function _cropDiagUpdate(){
  const angle=parseInt(document.getElementById('cropDiagAngle').value)||45;
  const pos=parseInt(document.getElementById('cropDiagPos').value)||50;
  _cropState._diagAngle=angle;_cropState._diagPos=pos;
  const lbl=document.getElementById('cropDiagLabel');if(lbl)lbl.textContent=angle+'°';
  const plbl=document.getElementById('cropDiagPosLabel');if(plbl)plbl.textContent=pos+'%';
  /* 소스 캔버스에 대각선 표시 */
  _cropDrawSrc();
  const c=document.getElementById('cropSrcCanvas');if(!c)return;
  const ctx=c.getContext('2d');
  const w=c.width, h=c.height;
  const rad=angle*Math.PI/180;
  const cx=w*(pos/100);
  ctx.save();ctx.strokeStyle='red';ctx.lineWidth=2;ctx.setLineDash([6,4]);
  ctx.beginPath();
  const len=Math.max(w,h)*2;
  ctx.moveTo(cx-Math.cos(rad)*len,h/2-Math.sin(rad)*len);
  ctx.lineTo(cx+Math.cos(rad)*len,h/2+Math.sin(rad)*len);
  ctx.stroke();ctx.restore();
  /* 오버레이 숨기기 */
  ['cropOverlayL','cropOverlayR','cropOverlayT','cropOverlayB'].forEach(function(id){const e=document.getElementById(id);if(e)e.style.display='none';});
  _cropDrawDiagResult();
}

function _cropDiagSide(side,btn){
  _cropState._diagSide=side;
  document.querySelectorAll('.crop-diag-side-btn').forEach(function(b){b.classList.toggle('on',b.dataset.side===side);});
  _cropDiagUpdate();
}

function _cropDrawDiagResult(){
  const s=_cropState;if(!s.origImg)return;
  const c=document.getElementById('cropResultCanvas');if(!c)return;
  const img=s.origImg, w=img.width, h=img.height;
  c.width=w;c.height=h;
  const ctx=c.getContext('2d');
  const rad=s._diagAngle*Math.PI/180;
  const cx=w*(s._diagPos/100);
  /* 클리핑 경로 생성 */
  ctx.save();ctx.beginPath();
  const len=Math.max(w,h)*2;
  const dx=Math.cos(rad)*len, dy=Math.sin(rad)*len;
  const lx=cx-dx, ly=h/2-dy, rx=cx+dx, ry=h/2+dy;
  if(s._diagSide==='keep-left'){
    ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);
    ctx.lineTo(-len,ry>ly?h+len:-len);ctx.lineTo(-len,ry>ly?-len:h+len);
  } else {
    ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);
    ctx.lineTo(w+len,ry>ly?-len:h+len);ctx.lineTo(w+len,ry>ly?h+len:-len);
  }
  ctx.closePath();ctx.clip();
  ctx.drawImage(img,0,0);
  ctx.restore();
}

function _cropApply(){
  const s=_cropState;if(!s.origImg)return;
  const img=s.origImg;
  const c=document.createElement('canvas');
  if(s.mode==='diagonal'){
    c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');
    const rad=s._diagAngle*Math.PI/180;
    const cx=img.width*(s._diagPos/100);
    const len=Math.max(img.width,img.height)*2;
    const dx=Math.cos(rad)*len, dy=Math.sin(rad)*len;
    const lx=cx-dx, ly=img.height/2-dy, rx=cx+dx, ry=img.height/2+dy;
    ctx.save();ctx.beginPath();
    if(s._diagSide==='keep-left'){
      ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);ctx.lineTo(-len,ry>ly?img.height+len:-len);ctx.lineTo(-len,ry>ly?-len:img.height+len);
    } else {
      ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);ctx.lineTo(img.width+len,ry>ly?-len:img.height+len);ctx.lineTo(img.width+len,ry>ly?img.height+len:-len);
    }
    ctx.closePath();ctx.clip();ctx.drawImage(img,0,0);ctx.restore();
  } else {
    const sx=s.cropL, sy=s.cropT;
    const sw=Math.max(1,img.width-s.cropL-s.cropR);
    const sh=Math.max(1,img.height-s.cropT-s.cropB);
    c.width=sw;c.height=sh;
    c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
  }
  const result=c.toDataURL('image/png');
  const ov=document.getElementById('cropOverlay');if(ov)closeModalGracefully(ov);
  if(s.onApply)s.onApply(result);
  _cropState.origImg=null;_cropState.onApply=null;
}

export function vpeCropImage(){
  const obj=vpeState.objects.find(function(o){return o.id===vpeState.selectedId;});
  if(!obj||obj.type!=='image'){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지 객체를 먼저 선택하세요';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  const imgData=obj.src||obj.content;
  if(!imgData){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='이미지 데이터가 없습니다';toast.className='global-save-toast show saving';setTimeout(function(){toast.className='global-save-toast';},4000);}
    return;
  }
  _cropOpen(imgData,function(resultUrl){
    vpePushUndo();
    let targetObj=_vpeMedia?_vpeMedia.applyCroppedImage(vpeState,resultUrl):null;
    if(!targetObj){obj.src=resultUrl;obj.content=resultUrl;targetObj=obj;}
    /* 잘린 이미지 크기 반영 */
    const tmpImg=new Image();
    tmpImg.onload=function(){
      const ratio=tmpImg.width/tmpImg.height;
      let newW=targetObj.w, newH=Math.round(targetObj.w/ratio);
      if(newH>targetObj.h*1.5){newH=targetObj.h;newW=Math.round(targetObj.h*ratio);}
      targetObj.w=newW;targetObj.h=newH;
      vpeEditorRender();vpeEditorAutoSave();
    };
    tmpImg.onerror=function(){vpeEditorRender();vpeEditorAutoSave();};
    tmpImg.src=resultUrl;
  });
}


/* ── 인쇄 ── */
function nlPrint(){
  if(!(window.electronAPI&&window.electronAPI.newsletterRenderHtml)){alert('출력 기능을 사용할 수 없습니다.');return;}
  window.electronAPI.newsletterRenderHtml(nlState,{mergePreview:_nlMergePreview,mergeRow:_nlMergeData[_nlMergeIdx]||null}).then(function(res){
    if(!(res&&res.success&&res.html)){alert('출력 내용 생성 실패');return;}
    const pw=window.open('','','width=800,height=1000');
    const pageSize=nlState.paper==='a4'?'A4':'80mm 297mm';
    pw.document.write('<html><head><meta charset="utf-8"><title>가정통신문</title><style>@page{size:'+pageSize+';margin:'+nlState.marginTop+'mm '+nlState.marginRight+'mm '+nlState.marginBottom+'mm '+nlState.marginLeft+'mm}body{margin:0;padding:0;font-family:"Pretendard Variable","Pretendard","Noto Sans KR",sans-serif}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>'+res.html+'</body></html>');
    pw.document.close();pw.focus();
    setTimeout(function(){pw.print();},400);
  }).catch(function(){alert('출력 내용 생성 실패');});
}

/* ── 가정통신문 PNG/JPEG 내보내기 ── */
function nlShowExportPopup(fmt){
  const canvasEl=document.getElementById('nlCanvas');
  if(!canvasEl){alert('캔버스를 찾을 수 없습니다.');return;}
  /* 줌을 100%로 임시 변경하여 원본 크기로 캡처 */
  const origTransform=canvasEl.style.transform;
  const origTransformOrigin=canvasEl.style.transformOrigin;
  canvasEl.style.transform='none';
  canvasEl.style.transformOrigin='';
  const pw=canvasEl.offsetWidth, ph=canvasEl.offsetHeight;
  const doCapture=function(){
    html2canvas(canvasEl,{useCORS:true,allowTaint:true,scale:2,width:pw,height:ph,backgroundColor:'#ffffff'}).then(function(canvas){
      canvasEl.style.transform=origTransform;
      canvasEl.style.transformOrigin=origTransformOrigin;
      _imgExportShowPopup(fmt,canvas,'가정통신문');
    }).catch(function(err){
      canvasEl.style.transform=origTransform;
      canvasEl.style.transformOrigin=origTransformOrigin;
      console.error(err);alert('캡처 실패: '+err.message);
    });
  };
  if(typeof html2canvas==='undefined'){
    const sc=document.createElement('script');
    sc.src='./node_modules/html2canvas/dist/html2canvas.min.js';
    sc.onload=doCapture;
    sc.onerror=function(){canvasEl.style.transform=origTransform;canvasEl.style.transformOrigin=origTransformOrigin;alert('html2canvas를 불러올 수 없습니다.');};
    document.head.appendChild(sc);
  } else doCapture();
}

function svRenderHistory(){
  const el=document.getElementById('sv-history');if(!el)return;
  if(!svRenderHistory._synced){svRenderHistory._synced=true;_svSyncWorkspaceFromBackend(function(){svRenderHistory._synced=false;svRenderHistory();});}
  let h='<button class="sv-back-btn" data-action="svBack">← 설문 홈으로</button>';
  h+='<div class="sv-breadcrumb" style="margin-top:8px">설문 리스트 &amp; 에디터 &gt; <span>과거 기록</span></div>';
  let records=_svGetHistory();if(!records.length)records=SV_DUMMY_HISTORY;
  if(!records.length){
    h+='<div class="cc" style="padding:24px;text-align:center;color:var(--t3);font-size:12px">설문이 아직 없습니다.</div>';
  } else {
    h+='<div class="cc" style="padding:10px;overflow-x:auto"><table class="rec-table"><thead><tr><th>날짜</th><th>설문명</th><th>대상</th><th>응답률</th><th>통신문</th><th>상태</th><th>작업</th></tr></thead><tbody>';
    records.forEach(function(r){
      h+='<tr><td>'+r.date+'</td><td style="font-weight:600">'+r.title+'</td><td>'+r.target+'</td><td>'+r.rate+'</td>'
        +'<td style="text-align:center">'+(r.newsletter?'✅':'—')+'</td>'
        +'<td><span class="sv-stat-badge closed">'+r.status+'</span></td>'
        +'<td><button class="sv-btn sv-btn-sm" data-action="svStats">통계</button> <button class="sv-btn sv-btn-sm">복제</button></td></tr>';
    });
    h+='</tbody></table></div>';
  }
  el.innerHTML=h;
  el.addEventListener('click',function(e){
    const btn=e.target.closest('[data-action]');if(!btn)return;
    if(btn.dataset.action==='svBack'&&window.svOpenPanel)window.svOpenPanel('home');
    else if(btn.dataset.action==='svStats'&&window.svOpenPanel)window.svOpenPanel('stats');
  });
}

/* ═══════════════════════════════════════════════
   상용 메시지 (Quick Message)
   ═══════════════════════════════════════════════ */
const QM_STORAGE_KEY='ec_quickMsgs';
let qmActiveCat=0;
let qmEditingId=null;

function qmDefaultData(){
  return [
    {id:1,name:'담임에게 보내는 메시지',icon:'✉️',msgs:[
      {id:101,title:'보건실 안정 담임 알림',body:'안녕하세요 선생님, 보건교사입니다.\n{학생명} 학생이 {입실시간}에 {증상} 증상으로 보건실을 방문하였는데 학생에게 침상 안정이 필요할 것 같습니다. 이번 시간 동안 침상 안정을 취하도록 해도 될까요?'},
      {id:103,title:'경과 관찰 요청',body:'안녕하세요 선생님, 보건교사입니다.\n{학생명} 학생이 {증상} 증상으로 처치 후 교실로 돌아갔는데요. 교실 복귀 후 증상이 지속되어 호소하지 않는지 살펴봐주시면 감사하겠습니다.'},
      {id:104,title:'자주 방문하는 학생 컴플레인',body:'안녕하세요 선생님, 보건교사입니다.\nOOO 학생이 보건실에 불필요하게 방문하여 다른 학생의 휴식과 안정에 약간의 지장을 일으키고 있습니다. 이 학생이 꼭 필요할 때만 보건실을 방문할 수 있도록 대화 한 번 부탁드려요.'}
    ]},
    {id:4,name:'학부모에게 보내는 메시지',icon:'👪',msgs:[
      {id:401,title:'학생 보건실 처치 학부모에게 안내',body:'안녕하세요 학부모님, {학교명} 보건교사입니다.\n자녀 {학년반} {학생명} 학생이 오늘 {증상} 증상으로 보건실을 방문하여 처치를 받았습니다. 귀가 후 증상 경과를 자세히 살펴봐주시고 증상이 심해지면 병원 진료를 받을 수 있도록 관심 부탁드리겠습니다. 감사합니다.'},
      {id:402,title:'증상 법정 감염병 안내',body:'안녕하세요 학부모님, {학교명} 보건교사입니다.\n자녀 {학년반} {학생명} 학생의 증상은 법정 감염병에 해당되므로 의사가 제시한 치료 기간만큼 출석 인정이 가능합니다. 학교에 올 때 소견서 상에 치료를 위해 필요한 일자가 정확히 기재될 수 있도록 의사에게 요청하셔서 받으시고 담임교사에게 제출하여 출석 인정의 근거로 사용할 수 있도록 해주시기 당부드립니다. 감사합니다.'}
    ]},
    {id:5,name:'전 교직원에게 안내',icon:'📢',msgs:[
      {id:501,title:'보건교사 출장 안내 (단체)',body:'안녕하세요, 보건교사입니다.\nO월 O일 O요일 O:OO에 출장이 예정되어 있습니다. 학생들에게 해당 일시에 제가 출장 중임을 알려주시고 저에게 볼일이 있으신 분들께서는 제가 학교에 출근하였을 때 찾아오시기 바랍니다. 감사합니다.'},
      {id:502,title:'가정통신문 배부 (단체)',body:'안녕하세요 선생님들, 보건교사입니다.\n학생들에게 배부할 가정통신문을 인쇄하여 보건실에 두었습니다. 학생 한 명을 보건실로 보내셔서 수령하게 하여 학생들에게 배부 부탁드립니다. 바쁘시겠지만 미리 감사드립니다.'},
      {id:503,title:'가정통신문 배부 후 수합 필요 (단체)',body:'안녕하세요 선생님들, 보건교사입니다.\n학생들에게 배부할 가정통신문을 인쇄하여 보건실에 두었습니다. 학생 한 명을 보건실로 보내셔서 수령하게 하여 학생들에게 배부 부탁드립니다. 이 가정통신문은 다시 회수되어야 합니다. 학생들에게 작성 요령을 가정통신문에 나와있는 것과 같이 안내해주시고 번호 순으로 걷으셔서 보건실로 O월 O일 O요일 O:OO까지 보내주시기 바랍니다. 바쁘시겠지만 미리 감사드립니다.'},
      {id:601,title:'흡연예방교육 주간 및 교육 안내 (단체)',body:'안녕하세요 선생님들, 보건교사입니다.\nO월 O일 O요일부터 O월 O일 O요일까지 본교 흡연예방교육 주간입니다. 자료를 보내드리오니 창의적 체험활동 시간에 활용하셔서 학생 교육을 부탁드리겠습니다. 감사합니다.'},
      {id:602,title:'양성평등 교육 안내 (단체)',body:'안녕하세요 선생님들, 창의적 체험활동 시간에 양성평등 교육에 활용하실 수 있는 자료를 보내드립니다. 학생 교육 부탁드리겠습니다. 감사합니다.'},
      {id:603,title:'심폐소생술 연수 이수 안내',body:'안녕하세요, 보건교사입니다.\n심폐소생술 이론 연수를 원격으로 이수를 부탁드립니다. 학교보건법 시행규칙 제10조에 따라 매년 실습과 이론 연수를 이수해야 합니다. OO교육연수원 웹사이트에서 개별 이수를 하시고, 연말에 제가 이수 번호를 수합할 때 제출해주시면 감사하겠습니다.'}
    ]}
  ];
}

function qmLoad(){
  try{
    const ver=localStorage.getItem('ec_qm_version');
    if(ver!=='10'){localStorage.removeItem(QM_STORAGE_KEY);localStorage.setItem('ec_qm_version','10');}
    const d=localStorage.getItem(QM_STORAGE_KEY);return d?JSON.parse(d):qmDefaultData();
  }catch(e){return qmDefaultData();}
}
function qmSave(data){localStorage.setItem(QM_STORAGE_KEY,JSON.stringify(data));}

export function openQuickMsg(){
  const ov=document.getElementById('qmOverlay');
  /* 이전 닫기 애니메이션이 320ms 안에 다시 클릭되면, 예약된 setTimeout 이 'active' 를 도로 떼서
   * 모달이 사라져 보이는(버튼 무반응) race 가 있었음. 진입 즉시 pending 닫기 취소. */
  cancelCloseAnimIfPending(ov);
  ov.classList.add('active');
  qmEditingId=null;
  qmRenderCats();
  if(qmLoad().length>0){qmActiveCat=qmLoad()[0].id;qmRenderCats();qmRenderMsgs();}
}
export function closeQuickMsg(){closeModalWithAnim(document.getElementById('qmOverlay'));qmEditingId=null;}
document.addEventListener('click',function(e){
  if(!e.target||!e.target.closest||e.target.id!=='qmOverlay')return;
  if(qmEditingId===null)return;
  if(e.target.closest('.qm-msg-card.editing'))return;
  /* 저장 후 편집 종료 */
  const titleEl=document.getElementById('qmEditTitle_'+qmEditingId);
  const bodyEl=document.getElementById('qmEditBody_'+qmEditingId);
  if(titleEl&&bodyEl){
    const data=qmLoad();const cat=data.find(function(c){return c.id===qmActiveCat;});
    if(cat){const msg=cat.msgs.find(function(m){return m.id===qmEditingId;});
      if(msg){msg.title=titleEl.value.trim()||'제목 없음';msg.body=bodyEl.value;qmSave(data);}
    }
  }
  qmEditingId=null;qmRenderCats();qmRenderMsgs();
});

function qmRenderCats(){
  const data=qmLoad();const el=document.getElementById('qmCatList');let h='';
  data.forEach(function(cat){
    const cls=cat.id===qmActiveCat?'qm-cat-item active':'qm-cat-item';
    h+='<div class="'+cls+'" data-cat-id="'+cat.id+'">'
      +'<div class="qm-cat-icon">'+cat.icon+'</div>'
      +'<div class="qm-cat-info"><div class="qm-cat-name">'+cat.name+'</div>'
      +'<div class="qm-cat-count">'+cat.msgs.length+'개 메시지</div></div></div>';
  });
  el.innerHTML=h;
}

/* 이벤트 위임: 카테고리 클릭 (호버 제거 — 사용자가 실수로 이동하지 않도록) */
document.addEventListener('click',function(e){
  if(!e.target||!e.target.closest)return;
  if(!e.target.closest('#qmCatList'))return;
  const item=e.target.closest('.qm-cat-item');
  if(!item)return;
  const catId=parseInt(item.getAttribute('data-cat-id'));
  if(isNaN(catId)||qmActiveCat===catId)return;
  qmActiveCat=catId;qmEditingId=null;
  document.querySelectorAll('#qmCatList .qm-cat-item').forEach(function(el){
    el.classList.toggle('active',parseInt(el.getAttribute('data-cat-id'))===catId);
  });
  qmRenderMsgs();
});

function qmRenderMsgs(){
  const data=qmLoad();
  const cat=data.find(function(c){return c.id===qmActiveCat;});
  if(!cat)return;
  document.getElementById('qmRightTitle').textContent=cat.icon+' '+cat.name;
  document.getElementById('qmRightActions').innerHTML='<button data-action="qmAddMsg">+ 메시지 추가</button>';
  document.getElementById('qmRightActions').querySelector('[data-action="qmAddMsg"]').addEventListener('click',function(){qmAddMsg();});
  document.getElementById('qmVarChips').style.display='flex';
  const el=document.getElementById('qmMsgList');
  if(!cat.msgs.length){el.innerHTML='<div class="qm-empty"><div class="qm-empty-icon">📝</div><div class="qm-empty-text">메시지가 없습니다<br><span style="font-size:11px;font-weight:400;color:var(--t3)">위의 + 메시지 추가 버튼을 눌러보세요</span></div></div>';return;}
  let h='';
  cat.msgs.forEach(function(msg){
    if(qmEditingId===msg.id){
      h+='<div class="qm-msg-card editing">'
        +'<input class="qm-edit-title" id="qmEditTitle_'+msg.id+'" value="'+msg.title.replace(/"/g,'&quot;')+'" placeholder="메시지 제목" data-msg-id="'+msg.id+'" data-input-type="title">'
        +'<textarea class="qm-edit-area" id="qmEditBody_'+msg.id+'" rows="6" placeholder="메시지 내용을 입력하세요..." data-msg-id="'+msg.id+'" data-input-type="body">'+msg.body+'</textarea>'
        +'<div style="display:flex;gap:6px;margin-top:6px"><button class="qm-msg-btn primary" data-action="qmSaveEdit" data-msg-id="'+msg.id+'">💾 저장</button><button class="qm-msg-btn danger" data-action="qmDeleteMsg" data-msg-id="'+msg.id+'">🗑 메시지 삭제</button></div>'
        +'</div>';
    } else {
      const preview=qmResolveVars(msg.body,msg.id);
      const hasDateVar=msg.body.indexOf('{날짜}')!==-1;
      h+='<div class="qm-msg-card" data-action="qmDblEdit" data-msg-id="'+msg.id+'">'
        +'<div class="qm-msg-title"><span>'+msg.title+'</span></div>'
        +'<div class="qm-msg-body">'+preview+'</div>'
        +'<div class="qm-msg-footer">'
        +'<button class="qm-msg-btn primary" data-action="qmCopy" data-msg-id="'+msg.id+'">📋 클립보드에 복사</button>'
        +'<button class="qm-msg-btn" data-action="qmEdit" data-msg-id="'+msg.id+'">✏️ 편집</button>'
        +'<button class="qm-msg-btn danger" data-action="qmDeleteMsg" data-msg-id="'+msg.id+'">삭제</button>'
        +'</div></div>';
    }
  });
  el.innerHTML=h;
  /* event delegation for message list */
  el.addEventListener('click',function(e){
    const btn=e.target.closest('[data-action]');if(!btn)return;
    const action=btn.dataset.action;
    const msgId=parseInt(btn.dataset.msgId,10);
    e.stopPropagation();
    if(action==='qmCopy')qmCopy(msgId);
    else if(action==='qmEdit')qmStartEdit(msgId);
    else if(action==='qmDeleteMsg')qmDeleteMsg(msgId);
    else if(action==='qmSaveEdit')qmSaveEdit(msgId);
  });
  el.addEventListener('dblclick',function(e){
    const card=e.target.closest('[data-action="qmDblEdit"]');
    if(card)qmStartEdit(parseInt(card.dataset.msgId,10));
  });
  /* input/textarea event listeners for editing cards */
  el.querySelectorAll('[data-input-type="title"],[data-input-type="body"]').forEach(function(inp){
    const msgId=parseInt(inp.dataset.msgId,10);
    inp.addEventListener('input',function(){qmAutoSave(msgId);});
    if(inp.dataset.inputType==='body')inp.addEventListener('mousedown',function(e){e.stopPropagation();});
  });
}

function qmGetSelectedTimeIn(){
  if(typeof S.records==='undefined'||!S.records.length)return '';
  const sel=document.querySelector('.rec-table tbody tr.selected, .rec-table tbody tr:hover');
  if(sel){const tds=sel.querySelectorAll('td');for(let i=0;i<tds.length;i++){const v=tds[i].textContent.trim();if(/^\d{1,2}:\d{2}$/.test(v))return v;}}
  const today=typeof S.selectedDate!=='undefined'?S.selectedDate:toDateStr(new Date());
  const todayRecs=S.records.filter(function(r){return r.date===today;});
  if(todayRecs.length)return todayRecs[todayRecs.length-1].timeIn||'';
  return '';
}
function qmGetSelectedSymptoms(){
  if(typeof S.records==='undefined'||!S.records.length)return '';
  const today=typeof S.selectedDate!=='undefined'?S.selectedDate:toDateStr(new Date());
  const todayRecs=S.records.filter(function(r){return r.date===today;});
  if(todayRecs.length){const last=todayRecs[todayRecs.length-1];return (Array.isArray(last.symptoms)?last.symptoms.join(', '):last.symptoms)||'';}
  return '';
}
function qmGetSelectedStudent(){
  /* 학생 ID 추출: 여러 소스에서 순차 탐색 */
  let _qmStuId=null;
  let _qmRecId=null;
  /* 1순위: 일반일지에서 선택/잠긴 학생 */
  if(typeof S.dailyLockedStudentId!=='undefined'&&S.dailyLockedStudentId)_qmStuId=S.dailyLockedStudentId;
  /* 2순위: 일반일지에서 선택된 레코드 */
  if(!_qmStuId&&typeof S.dailySelectedRecId!=='undefined'&&S.dailySelectedRecId){
    const _r=S.records.find(function(r){return r.id===S.dailySelectedRecId;});
    if(_r){_qmStuId=_r.studentId||_r.personUid;_qmRecId=_r.id;}
  }
  /* 3순위: 증상 선택 팝업이 열려있으면 그 학생 */
  if(!_qmStuId&&typeof S._symPopupRecId!=='undefined'&&S._symPopupRecId){
    const _sr=S.records.find(function(r){return r.id===S._symPopupRecId;});
    if(_sr){_qmStuId=_sr.studentId||_sr.personUid;_qmRecId=_sr.id;}
  }
  if(_qmStuId){
    const rec=_qmRecId?S.records.find(function(r){return r.id===_qmRecId;}):S.records.find(function(r){return (r.studentId===_qmStuId||r.personUid===_qmStuId)&&r.date===(typeof S.selectedDate!=='undefined'?S.selectedDate:toDateStr(new Date()));});
    const stu=getStu(_qmStuId);
    if(stu&&!stu._notFound){
      return {name:stu.name,grade:stu.grade,cls:stu.cls,num:stu.num||'',timeIn:rec?rec.timeIn:'',timeOut:rec?rec.timeOut||'':'',symptoms:rec?(Array.isArray(rec.symptoms)?rec.symptoms.join(', '):rec.symptoms):''};
    }
  }
  /* 4순위: 오늘 가장 최근 등록한 학생 (처치자 무관 — 처치자 이름 불일치 시에도 동작) */
  const today=typeof S.selectedDate!=='undefined'?S.selectedDate:toDateStr(new Date());
  let todayRecs=S.records.filter(function(r){return r.date===today;}).sort(function(a,b){return(b.timeIn||'').localeCompare(a.timeIn||'');});
  /* 처치자 매칭 시도 */
  const curUser=JSON.parse(localStorage.getItem('ec_user')||'{}');
  const nurseName=curUser.name||S.settings.nurse1||'';
  if(nurseName){
    const nurseRecs=todayRecs.filter(function(r){return r.nurse===nurseName;});
    if(nurseRecs.length)todayRecs=nurseRecs;
  }
  if(todayRecs.length){
    const last=todayRecs[0];
    const s=getStu(last.studentId||last.personUid);
    if(s&&!s._notFound) return {name:s.name,grade:s.grade,cls:s.cls,num:s.num||'',timeIn:last.timeIn||'',timeOut:last.timeOut||'',symptoms:Array.isArray(last.symptoms)?last.symptoms.join(', '):(last.symptoms||'')};
    /* getStu 실패 시 레코드의 JOIN 데이터 직접 사용 */
    return {name:last.personName||last.studentName||'',grade:last.studentGrade||0,cls:last.studentClass||0,num:last.studentNum||0,timeIn:last.timeIn||'',timeOut:last.timeOut||'',symptoms:Array.isArray(last.symptoms)?last.symptoms.join(', '):(last.symptoms||'')};
  }
  return {name:'',grade:'',cls:'',num:'',timeIn:'',timeOut:'',symptoms:''};
}
function qmResolveVars(text,msgId){
  const now=new Date();
  let dateStr=(now.getMonth()+1)+'월 '+now.getDate()+'일';
  let timeStr=('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2);
  const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)?S.settings.schoolName:'○○학교';
  const stu=qmGetSelectedStudent();
  const timeIn=stu.timeIn||qmGetSelectedTimeIn()||timeStr;
  const symptoms=stu.symptoms||qmGetSelectedSymptoms();
  const studentName=stu.name;
  const gradeClass=stu.grade&&stu.cls?(stu.grade+'학년 '+stu.cls+'반'):'';
  /* 일시 override 적용 */
  const ov=msgId&&_qmDtOverrides[msgId];
  if(ov){
    dateStr=ov.date;timeStr=ov.time;
    if(ov.hasEnd)timeStr=ov.time+'부터 '+ov.endDate+' '+ov.endTime+'까지';
  }
  text=text.replace(/\{날짜\}/g,'<span style="color:var(--cyan);font-weight:700">'+dateStr+'</span>');
  text=text.replace(/\{시간\}/g,'<span style="color:var(--cyan);font-weight:700">'+timeStr+'</span>');
  const stuNum=stu.num;
  const timeOut=stu.timeOut;
  text=text.replace(/\{입실시간\}/g,'<span style="color:var(--cyan);font-weight:700">'+timeIn+'</span>');
  text=text.replace(/\{퇴실시간\}/g,timeOut?'<span style="color:var(--cyan);font-weight:700">'+timeOut+'</span>':'<span style="color:var(--cyan);font-weight:700">{퇴실시간}</span>');
  text=text.replace(/\{학교명\}/g,schoolName);
  text=text.replace(/\{학생명:직접입력\}/g,'<span style="color:var(--cyan);font-weight:700">{학생명}</span>');
  text=text.replace(/\{학생명\}/g,studentName?'<span style="color:var(--cyan);font-weight:700">'+studentName+'</span>':'<span style="color:var(--cyan);font-weight:700">{학생명}</span>');
  text=text.replace(/\{학년반\}/g,gradeClass?'<span style="color:var(--cyan);font-weight:700">'+gradeClass+'</span>':'<span style="color:var(--cyan);font-weight:700">{학년반}</span>');
  text=text.replace(/\{번호\}/g,stuNum?'<span style="color:var(--cyan);font-weight:700">'+stuNum+'</span>':'<span style="color:var(--cyan);font-weight:700">{번호}</span>');
  text=text.replace(/\{증상\}/g,symptoms?'<span style="color:var(--cyan);font-weight:700">'+symptoms+'</span>':'<span style="color:var(--cyan);font-weight:700">{증상}</span>');
  return text;
}

function qmResolvePlain(text,msgId){
  const now=new Date();
  let dateStr=(now.getMonth()+1)+'월 '+now.getDate()+'일';
  let timeStr=('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2);
  const schoolName=(typeof S.settings!=='undefined'&&S.settings.schoolName)?S.settings.schoolName:'○○학교';
  const stu=qmGetSelectedStudent();
  const timeIn=stu.timeIn||qmGetSelectedTimeIn()||timeStr;
  const symptoms=stu.symptoms||qmGetSelectedSymptoms();
  const studentName=stu.name||'{학생명}';
  const gradeClass=stu.grade&&stu.cls?(stu.grade+'학년 '+stu.cls+'반'):'{학년반}';
  const ov=msgId&&_qmDtOverrides[msgId];
  if(ov){dateStr=ov.date;timeStr=ov.time;if(ov.hasEnd)timeStr=ov.time+'부터 '+ov.endDate+' '+ov.endTime+'까지';}
  const stuNum=stu.num||'{번호}';
  const timeOut=stu.timeOut||'{퇴실시간}';
  return text.replace(/\{날짜\}/g,dateStr).replace(/\{시간\}/g,timeStr).replace(/\{입실시간\}/g,timeIn).replace(/\{퇴실시간\}/g,timeOut).replace(/\{학교명\}/g,schoolName).replace(/\{학생명:직접입력\}/g,'{학생명}').replace(/\{학생명\}/g,studentName).replace(/\{학년반\}/g,gradeClass).replace(/\{번호\}/g,stuNum).replace(/\{증상\}/g,symptoms||'{증상}');
}

function qmCopy(msgId){
  const data=qmLoad();const cat=data.find(function(c){return c.id===qmActiveCat;});
  if(!cat)return;const msg=cat.msgs.find(function(m){return m.id===msgId;});
  if(!msg)return;
  const plain=qmResolvePlain(msg.body,msg.id);
  navigator.clipboard.writeText(plain).then(function(){bus.emit('toast:blue', {text: '클립보드에 복사되었습니다.'});});
}


/* 명시 저장 — 편집 카드의 💾 저장 버튼 핸들러.
 * 자동저장(qmAutoSave) 이 입력 중에 이미 저장하지만, 사용자가 "저장됐다" 는
 * 확신을 갖고 편집 모드를 종료할 수 있도록 명시 버튼을 둠.
 * (옆의 "모든 내용 지우기" 와 "메시지 삭제" 가 둘 다 파괴적이라 실수가 잦았던 경위) */
function qmSaveEdit(msgId){
  const titleEl=document.getElementById('qmEditTitle_'+msgId);
  const bodyEl=document.getElementById('qmEditBody_'+msgId);
  if(titleEl && bodyEl){
    const data=qmLoad();
    const cat=data.find(function(c){return c.id===qmActiveCat;});
    if(cat){
      const msg=cat.msgs.find(function(m){return m.id===msgId;});
      if(msg){
        msg.title=titleEl.value.trim()||'제목 없음';
        msg.body=bodyEl.value;
        qmSave(data);
      }
    }
  }
  qmEditingId=null;
  qmRenderCats();
  qmRenderMsgs();
  qmShowToast('저장되었습니다');
}
let _qmAutoSaveTimer=null;
function qmStartEdit(msgId){qmEditingId=msgId;qmRenderMsgs();}

function qmAutoSave(msgId){
  clearTimeout(_qmAutoSaveTimer);
  let ind=document.getElementById('qmSaveInd');
  if(!ind){ind=document.createElement('div');ind.id='qmSaveInd';ind.className='ec-save-indicator';ind.style.zIndex='10001';document.body.appendChild(ind);}
  ind.textContent='저장 중…';ind.className='ec-save-indicator saving';ind.style.zIndex='10001';
  _qmAutoSaveTimer=setTimeout(function(){
    const titleEl=document.getElementById('qmEditTitle_'+msgId);
    const bodyEl=document.getElementById('qmEditBody_'+msgId);
    if(!titleEl||!bodyEl)return;
    const data=qmLoad();const cat=data.find(function(c){return c.id===qmActiveCat;});
    if(!cat)return;const msg=cat.msgs.find(function(m){return m.id===msgId;});
    if(!msg)return;
    msg.title=titleEl.value.trim()||'제목 없음';
    msg.body=bodyEl.value||bodyEl.innerText||'';
    qmSave(data);qmRenderCats();
    ind.textContent='모든 내용이 저장되었습니다.';ind.className='ec-save-indicator saved';ind.style.zIndex='10001';
    setTimeout(function(){ind.className='ec-save-indicator hide';},3000);
  },300);
}

function qmAddMsg(){
  const data=qmLoad();const cat=data.find(function(c){return c.id===qmActiveCat;});
  if(!cat)return;
  const newId=Date.now();
  cat.msgs.unshift({id:newId,title:'새 메시지',body:'안녕하세요, 보건교사입니다.\n{날짜} {시간} 내용을 입력하세요.'});
  qmSave(data);qmEditingId=newId;qmRenderMsgs();qmRenderCats();
  setTimeout(function(){const ml=document.getElementById('qmMsgList');if(ml)ml.scrollTop=0;const ti=document.getElementById('qmEditTitle_'+newId);if(ti){ti.focus();ti.select();}},50);
}

function qmDeleteMsg(msgId){
  const data=qmLoad();const cat=data.find(function(c){return c.id===qmActiveCat;});
  if(!cat)return;
  cat.msgs=cat.msgs.filter(function(m){return m.id!==msgId;});
  qmSave(data);qmRenderMsgs();qmRenderCats();qmShowToast('삭제되었습니다');
}




export function qmInsertVar(varStr){
  const ta=document.querySelector('textarea.qm-edit-area');
  if(!ta){qmShowToast('편집 중인 메시지에서 커서를 놓아주세요');return;}
  const start=ta.selectionStart, end=ta.selectionEnd;
  ta.value=ta.value.substring(0,start)+varStr+ta.value.substring(end);
  ta.selectionStart=ta.selectionEnd=start+varStr.length;
  ta.focus();
}

/* ═══ 일시 수정 팝업 — 달력(왼) + 시계(우) ═══ */
let _qmDtMsgId=null;
let _qmDtEndOn=false;
let _qmDtCalYear, _qmDtCalMonth;
let _qmDtEndCalYear, _qmDtEndCalMonth;
let _qmDtTarget='start'; /* 'start' or 'end' */
/* ── 독립 인라인 아날로그 시계 ── */
const _qmClocks={};
function _qmInlineClockRender(wrapId,hiddenId){
  const wrap=document.getElementById(wrapId);if(!wrap)return;
  const inp=document.getElementById(hiddenId);
  const val=inp?inp.value:'09:00';
  const pts=val.split(':');const hr=parseInt(pts[0])||0;const mn=parseInt(pts[1])||0;
  _qmClocks[wrapId]={h:hr,m:mn,field:hiddenId};
  const h12=hr%12||12;const ampm=hr<12?'AM':'PM';
  const size=180, cx=90, cy=90, R=82;
  const hRad=((h12*30+mn*0.5)-90)*Math.PI/180, mRad=((mn/60)*360-90)*Math.PI/180;
  const hx=cx+Math.cos(hRad)*38, hy=cy+Math.sin(hRad)*38;
  const mx=cx+Math.cos(mRad)*64, my=cy+Math.sin(mRad)*64;
  let ticks='';
  for(let i=0;i<60;i++){
    const a2=((i/60)*360-90)*Math.PI/180;
    const isH=i%5===0;
    ticks+='<line x1="'+(cx+Math.cos(a2)*(isH?68:74))+'" y1="'+(cy+Math.sin(a2)*(isH?68:74))+'" x2="'+(cx+Math.cos(a2)*R)+'" y2="'+(cy+Math.sin(a2)*R)+'" stroke="'+(isH?'#cbd5e1':'#e9ecef')+'" stroke-width="'+(isH?1.5:0.8)+'"/>';
  }
  let nums='';
  for(let i=1;i<=12;i++){
    const a2=((i/12)*360-90)*Math.PI/180;
    const nx=cx+Math.cos(a2)*56;
    const ny=cy+Math.sin(a2)*56;
    const act=i===h12;
    nums+='<circle cx="'+nx+'" cy="'+ny+'" r="10" fill="'+(act?'#0891b2':'transparent')+'"/>';nums+='<text x="'+nx+'" y="'+(ny+3.5)+'" text-anchor="middle" font-size="10" font-weight="700" fill="'+(act?'#fff':'#475569')+'" style="user-select:none;pointer-events:none">'+i+'</text>';
  }
  let html='<div style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden;background:#fff;box-shadow:var(--sh);width:248px">';
  html+='<div style="background:linear-gradient(135deg,#0e7490,#06b6d4);padding:8px 14px">';
  html+='<div style="font-size:9px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.6);margin-bottom:4px">시간 선택</div>';
  html+='<div style="display:flex;align-items:center;justify-content:space-between">';
  html+='<div style="display:flex;align-items:center;gap:0">';
  html+=_qmDrumHtml(hr,24,wrapId+'_drumH');
  html+='<div style="font-size:24px;font-weight:800;color:rgba(255,255,255,0.4);margin:0 2px">:</div>';
  html+=_qmDrumHtml(mn,60,wrapId+'_drumM');
  html+='</div>';
  html+='<div style="display:flex;flex-direction:column;gap:4px">';
  html+='<button data-action="qmClkAmPm" data-wrap-id="'+wrapId+'" data-ap="AM" style="padding:3px 8px;border:1.5px solid rgba(255,255,255,'+(ampm==='AM'?'0.9':'0.3')+');border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;background:'+(ampm==='AM'?'rgba(255,255,255,0.92)':'transparent')+';color:'+(ampm==='AM'?'#0e7490':'rgba(255,255,255,0.75)')+'">AM</button>';
  html+='<button data-action="qmClkAmPm" data-wrap-id="'+wrapId+'" data-ap="PM" style="padding:3px 8px;border:1.5px solid rgba(255,255,255,'+(ampm==='PM'?'0.9':'0.3')+');border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;background:'+(ampm==='PM'?'rgba(255,255,255,0.92)':'transparent')+';color:'+(ampm==='PM'?'#0e7490':'rgba(255,255,255,0.75)')+'">PM</button>';
  html+='</div></div></div>';
  html+='<div style="padding:8px 12px 0;background:#fff">';
  html+='<svg id="'+wrapId+'_svg" width="'+size+'" height="'+size+'" style="display:block;margin:0 auto;cursor:default" viewBox="0 0 '+size+' '+size+'">';
  html+='<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5"/>';
  html+=ticks+nums;
  html+='<line id="'+wrapId+'_mLine" x1="'+cx+'" y1="'+cy+'" x2="'+mx+'" y2="'+my+'" stroke="#22c55e" stroke-width="2" stroke-linecap="round" opacity="0.35" style="pointer-events:none"/>';
  html+='<line id="'+wrapId+'_hLine" x1="'+cx+'" y1="'+cy+'" x2="'+hx+'" y2="'+hy+'" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" style="pointer-events:none"/>';
  html+='<circle cx="'+cx+'" cy="'+cy+'" r="4" fill="#1e293b" style="pointer-events:none"/>';
  html+='<rect id="'+wrapId+'_interact" x="0" y="0" width="'+size+'" height="'+size+'" fill="transparent" style="cursor:crosshair;pointer-events:fill"/>';
  html+='<line id="'+wrapId+'_mHit" x1="'+cx+'" y1="'+cy+'" x2="'+mx+'" y2="'+my+'" stroke="transparent" stroke-width="16" stroke-linecap="round" style="cursor:pointer;pointer-events:stroke"/>';
  html+='<line id="'+wrapId+'_hHit" x1="'+cx+'" y1="'+cy+'" x2="'+hx+'" y2="'+hy+'" stroke="transparent" stroke-width="16" stroke-linecap="round" style="cursor:pointer;pointer-events:stroke"/>';
  html+='</svg></div>';
  html+='<div style="padding:4px 12px 8px;background:#fff;font-size:8px;color:#94a3b8;line-height:1.4">시침/분침 드래그, 마우스 휠, 숫자 클릭으로 시간 선택</div>';
  html+='</div>';
  wrap.innerHTML=html;
  /* 드럼 스크롤 */
  const dh=document.getElementById(wrapId+'_drumH');
  const dm=document.getElementById(wrapId+'_drumM');
  if(dh)dh.addEventListener('wheel',function(e){e.preventDefault();const c=_qmClocks[wrapId];c.h=(e.deltaY>0?(c.h+1)%24:(c.h-1+24)%24);_qmClkSave(wrapId);_qmInlineClockRender(wrapId,c.field);},{passive:false});
  if(dm)dm.addEventListener('wheel',function(e){e.preventDefault();const c=_qmClocks[wrapId];c.m=(e.deltaY>0?(c.m+1)%60:(c.m-1+60)%60);_qmClkSave(wrapId);_qmInlineClockRender(wrapId,c.field);},{passive:false});
  /* SVG 드래그 — 시침/분침 개별 (드래그 중 침만 갱신, mouseup 시 전체 재렌더) */
  const svg=document.getElementById(wrapId+'_svg');
  if(svg){
    let dragTarget=null;
    const _wid=wrapId;/* 클로저용 */
    function startDrag(target,e){e.preventDefault();e.stopPropagation();dragTarget=target;applyDrag(e);}
    function applyDrag(e){
      const c=_qmClocks[_wid];if(!c)return;
      const svgEl=document.getElementById(_wid+'_svg');if(!svgEl)return;
      const r=svgEl.getBoundingClientRect();
      const dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
      let ang=Math.atan2(dy,dx)*180/Math.PI+90;ang=((ang%360)+360)%360;
      if(dragTarget==='hour'){let h12=Math.round(ang/30);h12=((h12-1+12)%12)+1;const isPM=c.h>=12;c.h=isPM?(h12===12?12:h12+12):(h12===12?0:h12);}
      else{c.m=(Math.round(ang/6)+60)%60;}
      _qmClkSave(_wid);_qmClkLiveUpdate(_wid);
    }
    const hHit=document.getElementById(wrapId+'_hHit');
    if(hHit)hHit.addEventListener('mousedown',function(e){startDrag('hour',e);});
    const mHit=document.getElementById(wrapId+'_mHit');
    if(mHit)mHit.addEventListener('mousedown',function(e){startDrag('min',e);});
    const interact=document.getElementById(wrapId+'_interact');
    if(interact)interact.addEventListener('mousedown',function(e){
      e.preventDefault();const svgEl=document.getElementById(_wid+'_svg');if(!svgEl)return;
      const r=svgEl.getBoundingClientRect();const dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
      const dist=Math.sqrt(dx*dx+dy*dy);
      dragTarget=dist<45?'hour':'min';applyDrag(e);
    });
    document.addEventListener('mousemove',function(e){if(!dragTarget)return;e.preventDefault();applyDrag(e);});
    document.addEventListener('mouseup',function(){if(dragTarget){dragTarget=null;const c=_qmClocks[_wid];if(c)_qmInlineClockRender(_wid,c.field);}});
    svg.addEventListener('wheel',function(e){
      e.preventDefault();const c=_qmClocks[_wid];if(!c)return;
      const svgEl=document.getElementById(_wid+'_svg');if(!svgEl)return;
      const r=svgEl.getBoundingClientRect();const dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<45){c.h=(e.deltaY>0?(c.h+1)%24:(c.h-1+24)%24);}else{c.m=(e.deltaY>0?(c.m+1)%60:(c.m-1+60)%60);}
      _qmClkSave(_wid);_qmInlineClockRender(_wid,c.field);
    },{passive:false});
  }
}
function _qmDrumHtml(val,max,id){
  const p2=(val-2+max)%max, p1=(val-1+max)%max, n1=(val+1)%max, n2=(val+2)%max;
  const pad=function(n){return n<10?'0'+n:''+n;};
  return '<div id="'+id+'" style="display:flex;flex-direction:column;align-items:center;width:44px;user-select:none;cursor:ns-resize">'
    +'<div style="font-size:10px;color:rgba(255,255,255,0.2);line-height:1.5">'+pad(p2)+'</div>'
    +'<div style="font-size:14px;color:rgba(255,255,255,0.35);line-height:1.5">'+pad(p1)+'</div>'
    +'<div style="font-size:22px;font-weight:800;color:#fff;line-height:1.3;border-top:1px solid rgba(255,255,255,0.2);border-bottom:1px solid rgba(255,255,255,0.2);padding:1px 0;min-width:30px;text-align:center">'+pad(val)+'</div>'
    +'<div style="font-size:14px;color:rgba(255,255,255,0.35);line-height:1.5">'+pad(n1)+'</div>'
    +'<div style="font-size:10px;color:rgba(255,255,255,0.2);line-height:1.5">'+pad(n2)+'</div>'
    +'</div>';
}
function _qmClkLiveUpdate(wrapId){
  const c=_qmClocks[wrapId];if(!c)return;
  const h=c.h, m=c.m, h12=h%12||12;
  const cx=90, cy=90;
  const hRad=((h12*30+m*0.5)-90)*Math.PI/180, mRad=((m/60)*360-90)*Math.PI/180;
  const hx=cx+Math.cos(hRad)*38, hy=cy+Math.sin(hRad)*38;
  const mx=cx+Math.cos(mRad)*64, my=cy+Math.sin(mRad)*64;
  const hl=document.getElementById(wrapId+'_hLine');if(hl){hl.setAttribute('x2',hx);hl.setAttribute('y2',hy);}
  const ml=document.getElementById(wrapId+'_mLine');if(ml){ml.setAttribute('x2',mx);ml.setAttribute('y2',my);}
  const hHit=document.getElementById(wrapId+'_hHit');if(hHit){hHit.setAttribute('x2',hx);hHit.setAttribute('y2',hy);}
  const mHit=document.getElementById(wrapId+'_mHit');if(mHit){mHit.setAttribute('x2',mx);mHit.setAttribute('y2',my);}
  /* 드럼 갱신 */
  const pad=function(n){return n<10?'0'+n:''+n;};
  const dh=document.getElementById(wrapId+'_drumH');
  if(dh){const ch=dh.children;ch[0].textContent=pad((h-2+24)%24);ch[1].textContent=pad((h-1+24)%24);ch[2].textContent=pad(h);ch[3].textContent=pad((h+1)%24);ch[4].textContent=pad((h+2)%24);}
  const dm=document.getElementById(wrapId+'_drumM');
  if(dm){const cm=dm.children;cm[0].textContent=pad((m-2+60)%60);cm[1].textContent=pad((m-1+60)%60);cm[2].textContent=pad(m);cm[3].textContent=pad((m+1)%60);cm[4].textContent=pad((m+2)%60);}
}
function _qmClkSave(wrapId){
  const c=_qmClocks[wrapId];if(!c)return;
  const val=(c.h<10?'0'+c.h:''+c.h)+':'+(c.m<10?'0'+c.m:''+c.m);
  const inp=document.getElementById(c.field);if(inp)inp.value=val;
}
function _qmDtRenderInlineClock(wrapId,hiddenId){
  const wrap=document.getElementById(wrapId);if(!wrap)return;
  const inp=document.getElementById(hiddenId);
  const val=inp?inp.value:'09:00';
  const pts=val.split(':');const hr=parseInt(pts[0])||0;const mn=parseInt(pts[1])||0;
  let h='<div style="border:1px solid var(--bdr);border-radius:8px;background:#1a1a2e;padding:16px;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:var(--sh)">';
  h+='<div style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:700">시간 선택</div>';
  h+='<div style="display:flex;align-items:center;gap:4px">';
  /* 시 스크롤 */
  h+='<div style="display:flex;flex-direction:column;align-items:center;gap:2px">';
  h+='<button data-qm-click="clockAdj" data-qm-wrap="'+wrapId+'" data-qm-hidden="'+hiddenId+'" data-qm-type="h" data-qm-delta="1" style="border:none;background:transparent;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;padding:2px 8px">▲</button>';
  h+='<div style="font-size:32px;font-weight:800;color:#fff;min-width:50px;text-align:center">'+String(hr).padStart(2,'0')+'</div>';
  h+='<button data-qm-click="clockAdj" data-qm-wrap="'+wrapId+'" data-qm-hidden="'+hiddenId+'" data-qm-type="h" data-qm-delta="-1" style="border:none;background:transparent;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;padding:2px 8px">▼</button>';
  h+='</div>';
  h+='<span style="font-size:28px;font-weight:800;color:rgba(255,255,255,0.4)">:</span>';
  /* 분 스크롤 */
  h+='<div style="display:flex;flex-direction:column;align-items:center;gap:2px">';
  h+='<button data-qm-click="clockAdj" data-qm-wrap="'+wrapId+'" data-qm-hidden="'+hiddenId+'" data-qm-type="m" data-qm-delta="5" style="border:none;background:transparent;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;padding:2px 8px">▲</button>';
  h+='<div style="font-size:32px;font-weight:800;color:#fff;min-width:50px;text-align:center">'+String(mn).padStart(2,'0')+'</div>';
  h+='<button data-qm-click="clockAdj" data-qm-wrap="'+wrapId+'" data-qm-hidden="'+hiddenId+'" data-qm-type="m" data-qm-delta="-5" style="border:none;background:transparent;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;padding:2px 8px">▼</button>';
  h+='</div>';
  h+='</div>';
  h+='<div style="font-size:9px;color:rgba(255,255,255,0.3)">▲▼ 클릭으로 조정</div>';
  h+='</div>';
  wrap.innerHTML=h;
  wrap.querySelectorAll('[data-qm-click="clockAdj"]').forEach(function(btn){
    btn.addEventListener('click', function(){ _qmDtClockAdj(btn.dataset.qmWrap, btn.dataset.qmHidden, btn.dataset.qmType, parseInt(btn.dataset.qmDelta)); });
  });
}
function _qmDtClockAdj(wrapId,hiddenId,type,delta){
  const inp=document.getElementById(hiddenId);
  const pts=(inp?inp.value:'09:00').split(':');
  let hr=parseInt(pts[0])||0;let mn=parseInt(pts[1])||0;
  if(type==='h'){hr=(hr+delta+24)%24;}
  else{mn=(mn+delta+60)%60;}
  const newVal=String(hr).padStart(2,'0')+':'+String(mn).padStart(2,'0');
  if(inp)inp.value=newVal;
  _qmDtRenderInlineClock(wrapId,hiddenId);
}
function _qmDtRenderCal(wrapId,which){
  const wrap=document.getElementById(wrapId);if(!wrap)return;
  const yr=which==='start'?_qmDtCalYear:_qmDtEndCalYear;
  const mo=which==='start'?_qmDtCalMonth:_qmDtEndCalMonth;
  const now=new Date();const thisY=now.getFullYear();
  ensureHolidayYear(String(yr)); const holidays={};Object.keys(S.koreanHolidays).forEach(function(d){if(d.startsWith(String(yr)))holidays[d]=S.koreanHolidays[d];});
  const first=new Date(yr,mo,1);const dow=first.getDay();
  const dim=new Date(yr,mo+1,0).getDate();
  const pfx=which==='start'?'_qmDtCal':'_qmDtEndCal';
  let h='<div style="border:1px solid var(--bdr);border-radius:8px;padding:10px;background:var(--card);min-width:240px;box-shadow:var(--sh)">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h+='<button data-qm-click="calPrev" data-qm-which="'+which+'" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2)">◀</button>';
  h+='<span style="font-size:13px;font-weight:800;color:var(--t1)">'+yr+'년 '+(mo+1)+'월</span>';
  h+='<button data-qm-click="calNext" data-qm-which="'+which+'" style="border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--t2)">▶</button>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">';
  ['일','월','화','수','목','금','토'].forEach(function(d,i){h+='<span style="padding:4px;color:'+(i===0?'var(--rs)':i===6?'#3b82f6':'var(--t3)')+'">'+d+'</span>';});
  h+='</div><div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:11px">';
  const todayStr=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  for(let e=0;e<dow;e++)h+='<span></span>';
  for(let dd=1;dd<=dim;dd++){
    const ds=yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
    const isT=(ds===todayStr);const ddow=(dow+dd-1)%7;const isH=!!holidays[ds];
    const col=(ddow===0||isH)?'var(--rs)':ddow===6?'#3b82f6':'var(--t1)';
    const selDate=which==='start'?_qmDtStartDate:_qmDtEndDate;
    const isSel=(ds===selDate);
    const showToday=isT&&!selDate;
    const bgStyle=isSel?'background:#f59e0b;color:#fff;':showToday?'background:var(--cyan);color:#fff;':'';
    const leaveStyle=isSel?'\'#f59e0b\'':showToday?'\'var(--cyan)\'':'\'\'';
    h+='<span data-qm-click="selectDate" data-qm-ds="'+ds+'" data-qm-which="'+which+'" data-qm-leave="'+leaveStyle.replace(/'/g,'&apos;')+'" title="'+(holidays[ds]||'')+'" style="padding:5px;cursor:pointer;border-radius:4px;color:'+(isSel?'#fff':col)+';font-weight:'+(isH||showToday||isSel?'700':'400')+';'+bgStyle+'transition:background 0.1s">'+dd+'</span>';
  }
  h+='</div>';
  if(selDate){const sp=selDate.split('-');h+='<div style="text-align:right;font-size:10px;color:#f59e0b;font-weight:700;margin-top:4px;padding-right:4px">지정날짜: '+parseInt(sp[1])+'월 '+parseInt(sp[2])+'일</div>';}
  h+='</div>';
  wrap.innerHTML=h;
  /* 달력 내비게이션 이벤트 바인딩 */
  const prevBtn=wrap.querySelector('[data-qm-click="calPrev"]');
  if(prevBtn) prevBtn.addEventListener('click', function(){
    if(which==='start'){_qmDtCalMonth--;if(_qmDtCalMonth<0){_qmDtCalMonth=11;_qmDtCalYear--;}qmDtCalRefresh();}
    else{_qmDtEndCalMonth--;if(_qmDtEndCalMonth<0){_qmDtEndCalMonth=11;_qmDtEndCalYear--;}qmDtEndCalRefresh();}
  });
  const nextBtn=wrap.querySelector('[data-qm-click="calNext"]');
  if(nextBtn) nextBtn.addEventListener('click', function(){
    if(which==='start'){_qmDtCalMonth++;if(_qmDtCalMonth>11){_qmDtCalMonth=0;_qmDtCalYear++;}qmDtCalRefresh();}
    else{_qmDtEndCalMonth++;if(_qmDtEndCalMonth>11){_qmDtEndCalMonth=0;_qmDtEndCalYear++;}qmDtEndCalRefresh();}
  });
  /* 날짜 셀 이벤트 바인딩 */
  wrap.querySelectorAll('[data-qm-click="selectDate"]').forEach(function(cell){
    cell.addEventListener('click', function(){ qmDtSelectDate(cell.dataset.qmDs, cell.dataset.qmWhich); });
    const leaveVal=cell.dataset.qmLeave.replace(/&apos;/g,"'");
    cell.addEventListener('mouseenter', function(){ cell.style.background='var(--hover)'; });
    cell.addEventListener('mouseleave', function(){ cell.style.background=leaveVal.replace(/^'|'$/g,''); });
  });
}
let _qmDtStartDate='',_qmDtEndDate='';
function qmDtSelectDate(ds,which){
  if(which==='start'){_qmDtStartDate=ds;_qmDtRenderCal('qmDtCalWrap','start');}
  else{_qmDtEndDate=ds;_qmDtRenderCal('qmDtEndCalWrap','end');}
  const dp=ds.split('-');
  qmShowToast((which==='start'?'지정':'종료')+' 일자: '+parseInt(dp[1])+'월 '+parseInt(dp[2])+'일');
}
function qmDtCalRefresh(){_qmDtRenderCal('qmDtCalWrap','start');}
function qmDtEndCalRefresh(){_qmDtRenderCal('qmDtEndCalWrap','end');}
let _qmDtOverrides={};/* msgId -> {date,time,endDate,endTime,hasEnd} */

let _qmToastTimer=null;
function qmShowToast(msg,persistent){
  clearTimeout(_qmToastTimer);
  const t=document.getElementById('qmToast');t.textContent=msg;
  t.className=persistent?'qm-toast show saving':'qm-toast show';
  if(!persistent){_qmToastTimer=setTimeout(function(){t.className='qm-toast';},2000);}
}

/* _nlMerge* — export var로 cross-module 공유 */

/* _qmHoverTimer/_qmHoverLock 제거됨 (호버 → 클릭 변경) */

/* window._qmDtClockAdj 제거됨 — addEventListener으로 전환 */

/* window.qmDtSelectDate 제거됨 — addEventListener으로 전환 */

/* 차트형 관련 함수 제거됨: openRecordModeSelector, _rmSelect, openChartMode */

