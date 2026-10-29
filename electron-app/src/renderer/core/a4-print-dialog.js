/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══ 공용 A4 인쇄 미리보기 다이얼로그 (a4-print-dialog.js) ═══ */
/* ES Module
 *
 * 목적: "미리보기 = 실제 출력물" 한 치 오차 없음 + A4 인쇄 다이얼로그.
 *
 * 핵심 원리:
 *  - 실제 인쇄에 쓰는 동일한 HTML 을 격리된 <iframe> 에 그대로 렌더 → 미리보기가 곧 출력물.
 *  - iframe 폭을 A4 폭(210mm=794px)으로 고정 → 본문 콘텐츠 폭이 인쇄와 동일 → 줄바꿈·표·페이지 분할까지 일치.
 *  - 인쇄는 printWindowWithSize(html,'A4',{marginType:'none'}) 로 호출.
 *
 * ★ 전제: 넘겨주는 html 의 여백은 반드시 @page margin:0 + 본문 내부 padding 으로 처리해야 함.
 *   (Chromium 인쇄 엔진이 @page margin 을 신뢰성 있게 적용하지 않으므로 — 대여 대장에서 검증됨.)
 *   그래야 iframe(내부 padding 렌더) 과 인쇄(marginType:none + 내부 padding) 가 정확히 같아진다.
 *
 * 프린터: a4_printer 설정 공유(방문확인증·대여대장과 동일). 3인치 감열(영수증) 프린터는 자동 선택에서 제외.
 */
import { escHtml } from './helpers.js';
'use strict';

/* 3인치 감열(영수증) 프린터 판별 — A4 전용이므로 자동 선택 대상에서 제외. (방문확인증과 동일 기준) */
function _isRcPrinter(n){ n=(n||'').toLowerCase(); return /slk|ts-?200|\bpos\b|영수|receipt|thermal|bixolon|srp|80mm/.test(n); }

/* 미리보기 페이지 분할 + 섹션 제목(thead) 반복·고아 방지 (사용자 요청 2026-06-04):
 *  측정용 iframe(실제 본문 폭) 의 렌더 결과로 각 행/카드 높이를 잰 뒤 page-break-inside:avoid 를 모사해
 *  '페이지별 본문 HTML' 을 재구성한다.
 *   - 블록 단위 = h2 등 / 표의 각 <tr> / tbody.keep(활력징후 카드 통째)
 *   - 표가 페이지를 넘기면 그 표의 thead(섹션 제목줄)를 다음 페이지 상단에 다시 붙임(반복)
 *   - 제목줄만 페이지 끝에 남지 않도록 제목+첫 행이 안 들어가면 통째로 다음 페이지로 내림(고아 방지)
 *  반환: [pageBodyHtml, ...]  (실패 시 null → 단일 시트 폴백) */
function _freezePrintTableLayout(table) {
  var win=table.ownerDocument.defaultView;
  var zoom=parseFloat(win.getComputedStyle(table).zoom)||1;
  var width=table.getBoundingClientRect().width/zoom;
  var header=table.tHead&&table.tHead.rows[0];
  var cols=Array.from(table.querySelectorAll(':scope > colgroup > col'));
  // Read every width before writing any: each write can reflow all later columns.
  var widths=header?Array.from(header.cells).map(function(cell){return cell.getBoundingClientRect().width/zoom;}):[];
  table.style.setProperty('width',width+'px','important');
  table.style.setProperty('table-layout','fixed','important');
  if(cols.length===widths.length) cols.forEach(function(col,i){col.style.setProperty('width',widths[i]+'px','important');});
  var body=table.ownerDocument.body, cs=win.getComputedStyle(body);
  var available=body.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0)-3;
  var actual=table.getBoundingClientRect().width;
  if(available>0&&actual>available) table.style.setProperty('zoom',String(zoom*available/actual),'important');
}
function _groupPrintVisitRows(rows) {
  var grouped=[], owner=null;
  rows.forEach(function(row){
    var attachment=row.node&&row.node.matches('.dp-vs-subrow,.dp-pa-subrow');
    if(attachment&&owner&&owner.wrap) {
      if(!owner.parts) owner.parts=[Object.assign({},owner)];
      owner.parts.push(row); owner.html+=row.html; owner.h+=row.h;
    } else { grouped.push(row); owner=row.wrap?row:null; }
  });
  return grouped;
}
function _printVisitContinuation(node) {
  var clone=node.cloneNode(true);
  clone.classList.add('dp-visit-continuation');
  Array.from(clone.cells||[]).forEach(function(cell){
    if(cell.classList.contains('dpx-l')||(cell.classList.contains('dpx-dc')&&!cell.classList.contains('dpx-c'))) cell.textContent='(계속)';
  });
  return clone.outerHTML;
}
function _paginateWithHeaders(doc, pageH, preserveAttributes){
  if(preserveAttributes==null) preserveAttributes=true;
  if(!doc||!doc.body) return null;
  /* Body-embedded cell styles must survive every page, not only the first. */
  Array.from(doc.body.querySelectorAll('style,link[rel="stylesheet"]')).forEach(function(style){ doc.head.appendChild(style); });
  var win=doc.defaultView||window;
  function H(el){ return el.getBoundingClientRect().height; }
  // BoundingClientRect excludes margins. Account for both sides, including table zoom.
  // Counting adjacent margins separately is conservative when CSS collapses them.
  function margin(el,side){ try{ var s=win.getComputedStyle(el); return Math.max(0,parseFloat(s[side])||0)*(parseFloat(s.zoom)||1); }catch(e){ return 0; } }
  function MB(el){ return margin(el,'marginBottom'); }
  // Some callers already group complete pages inside one styled wrapper.
  // Preserve those explicit boundaries instead of pixel-slicing the wrapper.
  Array.from(doc.body.children).forEach(function(wrapper){
    if(wrapper.tagName==='TABLE')return;
    var children=Array.from(wrapper.children);
    if(children.length<2||Array.from(wrapper.childNodes).some(function(n){return n.nodeType===3&&n.textContent.trim();}))return;
    var breaks=children.map(function(child){var s=win.getComputedStyle(child);return s.breakAfter==='page'||s.pageBreakAfter==='always';});
    if(!breaks.slice(0,-1).every(Boolean))return;
    children.forEach(function(child,index){
      var page=wrapper.cloneNode(false);
      page.removeAttribute('id');
      page.style.breakAfter=breaks[index]?'page':'auto';
      child.style.breakAfter='auto';child.style.pageBreakAfter='auto';
      page.appendChild(child);wrapper.before(page);
    });
    wrapper.remove();
  });
  var items=[];
  Array.prototype.forEach.call(doc.body.children, function(child){
    if((child.tagName||'').toLowerCase()==='table'){
      _freezePrintTableLayout(child);
      var thead=child.querySelector(':scope > thead');
      var col=child.querySelector(':scope > colgroup');
      var rows=[];
      Array.prototype.forEach.call(child.children, function(sec){
        var stag=(sec.tagName||'').toLowerCase();
        if(stag==='thead'||stag==='colgroup') return;
        if(stag==='tbody' && sec.classList && sec.classList.contains('keep')){ rows.push({html:sec.outerHTML, h:H(sec), wrap:false, node:sec}); }
        else if(stag==='tbody'){ Array.prototype.forEach.call(sec.children, function(tr){ if((tr.tagName||'').toLowerCase()==='tr') rows.push({html:tr.outerHTML, h:H(tr), wrap:true, node:tr}); }); }
        else if(stag==='tr'){ rows.push({html:sec.outerHTML, h:H(sec), wrap:true, node:sec}); }
      });
      rows=_groupPrintVisitRows(rows);
      items.push({kind:'table', attrs:preserveAttributes?Array.from(child.attributes).map(function(a){return ' '+a.name+'="'+escHtml(a.value)+'"';}).join(''):null, style:child.getAttribute('style')||'', col:col?col.outerHTML:'', thead:thead?thead.outerHTML:'', theadH:(thead?H(thead):0)+margin(child,'marginTop')+1, rows:rows, mb:MB(child)});
    } else {
      /* 명시적 페이지 브레이크(page-break-after:always / break-after:page) 감지 — 표지(.dp-pdf-cover) 등
       *  "이 블록으로 페이지를 끝내라"는 문서 의도를 재구성 시에도 존중 (사용자 보고 2026-08-27: 인쇄 표지 미분리) */
      var _brk=false;
      try{ var _cs=win.getComputedStyle(child); _brk=(_cs.breakAfter==='page'||_cs.pageBreakAfter==='always'); }catch(e){}
      items.push({kind:'block', node:child, html:child.outerHTML, h:H(child), mt:margin(child,'marginTop'), mb:MB(child), brk:_brk, heading:child.matches('h1,h2,h3,h4,h5,h6,.dpx-sh,.dpx-st')});
    }
  });
  if(!items.length) return null;

  /* 한 페이지보다 큰 행(긴 셀)의 텍스트를 페이지 높이에 맞춰 자르기 위한 측정용 프로브 */
  var probe=doc.createElement('div');
  probe.style.cssText='position:absolute;left:-99999px;top:0;width:100%;visibility:hidden';
  doc.body.appendChild(probe);
  function styleAttr(item){ if(item.attrs!==null) return item.attrs; return item.style?(' style="'+item.style.replace(/"/g,'&quot;')+'"'):''; }
  function measureRowHtml(item, rowHtml){
    probe.innerHTML='<table'+styleAttr(item)+'>'+item.col+'<tbody>'+rowHtml+'</tbody></table>';
    var tr=probe.querySelector('tr');
    return tr?tr.getBoundingClientRect().height:0;
  }

  var pages=[], cur=[], used=0;
  function flush(){ pages.push(cur); cur=[]; used=0; }
  function renderRows(rows){
    var out='', open=false;
    rows.forEach(function(r){
      if(r.wrap){ if(!open){ out+='<tbody>'; open=true; } out+=r.html; }
      else { if(open){ out+='</tbody>'; open=false; } out+=r.html; }  /* tbody.keep 은 그 자체가 tbody */
    });
    if(open) out+='</tbody>';
    return out;
  }
  items.forEach(function(item,itemIndex){
    if(item.kind==='block'){
      var next=items[itemIndex+1];
      if(item.heading&&next&&next.kind==='table'&&next.rows.length){
        var first=next.rows[0].parts?next.rows[0].parts[0]:next.rows[0];
        var firstH=first.h>pageH-next.theadH?28:first.h;
        var together=item.mt+item.h+item.mb+next.theadH+firstH;
        if(used>0&&together<=pageH&&used+together>pageH)flush();
      }
      /* ★ 페이지보다 큰 '분할 불가 블록' — 세로 오프셋 슬라이스로 페이지에 정확히 배분 (2026-08-26).
       *  옛 로직은 이런 블록을 한 페이지(height 고정+overflow:hidden)에 통째로 넣어 넘치는 내용이
       *  소리 없이 잘려 나갔다(보건일지 '특정 방문자' 인쇄 11건→5건 잘림 사고).
       *  각 페이지 조각 = 블록 전체를 복제해 위로 -offset 만큼 밀고 pageH 로 클립 → 픽셀 단위로
       *  이어지는 연속 분할. 미리보기와 인쇄가 같은 문서를 쓰므로 '보이는 대로 인쇄'가 유지되고
       *  내용은 몇 페이지가 되든 전량 출력된다. */
      if(item.h+item.mt>pageH){
        if(used>0) flush();
        // A large preformatted sheet cannot be split as table rows. Slice only
        // between rendered text lines, never through the middle of a glyph.
        var origin=item.node.getBoundingClientRect().top-item.mt, lines=[];
        var walker=doc.createTreeWalker(item.node,4), textNode;
        while((textNode=walker.nextNode())){
          if(!textNode.textContent.trim())continue;
          var range=doc.createRange();range.selectNodeContents(textNode);
          Array.from(range.getClientRects()).forEach(function(r){if(r.width&&r.height)lines.push({top:r.top-origin,bottom:r.bottom-origin});});
        }
        Array.from(item.node.querySelectorAll('img,svg')).forEach(function(image){var r=image.getBoundingClientRect();if(r.height<=pageH)lines.push({top:r.top-origin,bottom:r.bottom-origin});});
        var off=0, sliceH=0;
        while(off<item.h+item.mt){
          sliceH=Math.min(pageH, item.h+item.mt-off);
          if(off+sliceH<item.h+item.mt){
            var end=off+sliceH, changed=true;
            while(changed){
              changed=false;
              lines.forEach(function(line){if(line.top<end&&line.bottom>end){end=line.top;changed=true;}});
            }
            if(end<=off+1)throw new Error('문서의 한 줄이 인쇄 영역을 넘습니다. 출력을 중단했습니다.');
            sliceH=end-off;
          }
          cur.push('<div data-a4-slice style="height:'+sliceH+'px;overflow:hidden"><div style="display:flow-root;transform:translateY(-'+off+'px)">'+item.html+'</div></div>');
          off+=sliceH;
          if(off<item.h+item.mt) flush();
        }
        used=sliceH+item.mb;   /* 마지막 조각 높이만 현재 페이지 사용분으로 — 남는 공간엔 후속 항목이 이어짐 */
        if(item.brk&&used>0) flush();   /* 명시적 page-break — 이 블록으로 페이지 종료 (2026-08-27) */
        return;
      }
      if(used+item.mt+item.h+item.mb>pageH && used>0) flush();
      cur.push(item.html); used+=item.mt+item.h+item.mb;
      if(item.brk&&used>0) flush();     /* 명시적 page-break (표지 등) — 다음 내용은 새 페이지부터 (2026-08-27) */
      return;
    }
    var i=0, maxRow=pageH-item.theadH;   /* 제목과 함께 한 페이지에 들어갈 수 있는 최대 행 높이 */
    var chunkRows=[];                    /* 현재 페이지·현재 표에 모이는 행들(제목 thead 는 한 번만) */
    function pushChunk(){ if(chunkRows.length){ cur.push('<table'+styleAttr(item)+'>'+item.col+item.thead+renderRows(chunkRows)+'</table>'); chunkRows=[]; } }
    while(i<item.rows.length){
      var row=item.rows[i];
      if(row.parts&&row.h>maxRow){
        var carry=_printVisitContinuation(row.node);
        var parts=row.parts.map(function(part,index){ return Object.assign({},part,{attachment:index>0,carry:carry}); });
        item.rows.splice.apply(item.rows,[i,1].concat(parts));
        continue;
      }
      if(row.attachment&&row.h>maxRow&&row.node.querySelector("table")){
        var nested=row.node.querySelector("table"), nestedRows=Array.from(nested.rows);
        if(nestedRows.length>2){
          var pieces=nestedRows.slice(1).map(function(dataRow){
            var clone=row.node.cloneNode(true);
            clone.querySelector("table").innerHTML=nestedRows[0].outerHTML+dataRow.outerHTML;
            var markup=clone.outerHTML;
            return {html:markup,h:measureRowHtml(item,markup),wrap:true,node:clone,attachment:true,carry:row.carry};
          });
          item.rows.splice.apply(item.rows,[i,1].concat(pieces));
          continue;
        }
      }
      if(row.attachment&&(used===0||used+row.h+(chunkRows.length?0:item.theadH)>pageH)){
        pushChunk(); if(used>0) flush();
        used+=item.theadH;
        chunkRows.push({html:row.carry,wrap:true});
        used+=measureRowHtml(item,row.carry);
      }
      if(row.h<=maxRow){
        /* 일반 행 */
        if(!chunkRows.length){ if(used>0 && used+item.theadH+row.h>pageH) flush(); used+=item.theadH; }   /* 새 표 시작 → 제목 1회(고아 방지) */
        else if(used+row.h>pageH){ pushChunk(); flush(); used+=item.theadH; }                            /* 페이지 넘침 → 다음 페이지(제목 반복) */
        chunkRows.push(row); used+=row.h; i++;
      } else {
        /* 한 페이지보다 큰 행 → 긴 셀 텍스트를 잘라 여러 페이지로 흘림. 첫 조각은 앞 행들과 같은 페이지에 이어 붙임 */
        if(!chunkRows.length){ if(used>0 && (pageH-used-item.theadH)<28) flush(); used+=item.theadH; }
        var node=row.node;
        if(!node.cells)throw new Error('한 페이지보다 큰 표 묶음의 내용을 확인해 주세요. 출력을 중단했습니다.');
        // Split every narrative cell, not only the longest one. Short identity
        // cells and labels repeat; consumed narrative text is never duplicated.
        var cells=Array.from(node.cells), texts=cells.map(function(c){return Array.from(c.textContent||'');});
        var repeat=cells.map(function(c,j){return c.tagName==='TH'||(c.classList.contains('dpx-c')&&texts[j].length<80);});
        var positions=cells.map(function(){return 0;});
        function piece(counts){
          var clone=node.cloneNode(true);
          cells.forEach(function(c,j){if(!repeat[j])clone.cells[j].textContent=texts[j].slice(positions[j],positions[j]+counts[j]).join('');});
          return clone.outerHTML;
        }
        function remaining(){return texts.some(function(t,j){return !repeat[j]&&positions[j]<t.length;});}
        if(!remaining())throw new Error('인쇄 영역보다 큰 기록을 나누지 못해 출력을 중단했습니다.');
        while(remaining()){
          var avail=pageH-used-12;                        /* 현재 페이지 남은 높이(12px 안전여유) */
          if(avail<28){ pushChunk(); flush(); used+=item.theadH; avail=pageH-used-12; }          /* 한 줄도 안 되면 다음 페이지 */
          var counts=cells.map(function(){return 0;});
          texts.forEach(function(chars,j){
            if(repeat[j]||positions[j]>=chars.length)return;
            var lo=1,hi=chars.length-positions[j],best=0;
            while(lo<=hi){var midN=(lo+hi)>>1;counts[j]=midN;if(measureRowHtml(item,piece(counts))<=avail){best=midN;lo=midN+1;}else{hi=midN-1;}}
            // Prefer a word/newline boundary, but also handle unspaced Korean.
            if(best<chars.length-positions[j])for(var k=best;k>best/2;k--){if(/\s/.test(chars[positions[j]+k-1])){best=k;break;}}
            counts[j]=best;
          });
          if(!counts.some(function(n){return n>0;})){
            if(used>item.theadH+1){pushChunk();flush();used+=item.theadH;continue;}
            throw new Error('기록의 한 줄이 인쇄 영역을 넘습니다. 출력을 중단했습니다.');
          }
          var pieceHtml=piece(counts);
          chunkRows.push({html:pieceHtml, wrap:true}); used+=measureRowHtml(item, pieceHtml);
          positions=positions.map(function(pos,j){return pos+counts[j];});
          if(remaining()){ pushChunk(); flush(); used+=item.theadH; }   /* 남은 글 → 다음 페이지(제목 반복) */
        }
        i++;
      }
    }
    pushChunk();
    used+=item.mb;   /* 표 아래 여백 반영 */
  });
  if(cur.length) flush();
  try{ probe.remove(); }catch(e){}
  return pages.map(function(p){ return p.join(''); });
}

/* 페이지당 본문(인쇄 가능) 높이(mm) — 페이지 높이(세로 297 / 가로 210)에서 상·하 여백 + 2mm 안전여유 제외. */
function _ppHeightMm(mm, pageHmm){ var t=(mm&&mm.top)||0, b=(mm&&mm.bottom)||0; return Math.max(40, (pageHmm||297)-t-b-2); }

/* 측정용 iframe 으로 페이지별 본문 HTML 재구성 (폰트 로드 후). 반환 Promise<{headHtml, pages:[bodyHtml]}>. */
function _measureAndPaginate(html, contentW, packH){
  return new Promise(function(resolve,reject){
    var meas=document.createElement('iframe'), finished=false;
    meas.setAttribute('sandbox','allow-same-origin');
    meas.setAttribute('scrolling','no');
    meas.setAttribute('aria-hidden','true');
    meas.style.cssText='position:fixed;left:-99999px;top:0;width:'+contentW+'px;height:900px;border:0;visibility:hidden';
    function finish(error,result){if(finished)return;finished=true;clearTimeout(timer);meas.remove();if(error)reject(error);else resolve(result);}
    var timer=setTimeout(function(){finish(new Error('인쇄 문서 준비 시간이 초과되었습니다. 다시 시도해 주세요.'));},30000);
    meas.onload=async function(){
      try{
        var d=meas.contentDocument;
        if(!d||!d.body)throw new Error('인쇄 문서를 불러오지 못했습니다.');
        d.documentElement.style.overflow='hidden';
        if(d.fonts)await d.fonts.ready;
        await Promise.all(Array.from(d.images).map(function(img){return img.complete?Promise.resolve():new Promise(function(r){img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true});});}));
        if(finished)return;
        var pages=_paginateWithHeaders(d,packH);
        if(!pages||!pages.length)throw new Error('출력할 내용이 없습니다.');
        finish(null,{headHtml:d.head.innerHTML,pages:pages});
      }catch(error){finish(error);}
    };
    meas.srcdoc=html;document.body.appendChild(meas);
  });
}

/* 재구성된 페이지들을 '쪽번호 footer 가 박힌 인쇄용 HTML' 로 조립.
 *  각 페이지 = .a4pp(인쇄 가능 높이, page-break-after) + .a4pf(우측 하단 쪽번호). 인쇄·PDF·미리보기 공용. */
function _buildPaginatedDoc(headHtml, pages, mm, firstNum, total, pageHmm){
  var ppH=_ppHeightMm(mm, pageHmm);
  var base=(typeof firstNum==='number')?firstNum:1;       /* 이 묶음의 첫 페이지 번호 (미리보기에서 페이지별 단일 렌더 시 사용) */
  var tot=(typeof total==='number')?total:pages.length;   /* 전체 페이지 수 */
  /* padding 1px(좌·상) — border-collapse 표의 왼쪽·위 1px 테두리가 overflow:hidden 에 잘려
   *  인쇄 시 표 왼쪽 선이 사라지던 문제 보정 (사용자 보고 2026-06-16). */
  var css='<style>.a4pp{position:relative;box-sizing:border-box;height:'+ppH+'mm;overflow:hidden;padding:1px 0 0 1px;page-break-after:always;break-after:page}'
    +'.a4pp:last-child{page-break-after:auto;break-after:auto}'
    +'.a4pf{position:absolute;right:0;bottom:0;font-size:10px;color:#555;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>';
  var b=pages.map(function(p,i){ return '<div class="a4pp">'+p+'<div class="a4pf">'+(base+i)+' / '+tot+'</div></div>'; }).join('');
  return '<!DOCTYPE html><html><head>'+headHtml+css+'</head><body>'+b+'</body></html>';
}

// Verify the assembled pages, not only the input row heights. Do not send a
// clipped document to PDF generation or the printer.
function _assertA4PageBounds(doc){
  var pages=Array.from(doc.querySelectorAll('body > .a4pp'));
  if(!pages.length)throw new Error('출력할 페이지가 없습니다.');
  pages.forEach(function(page,index){
    var bounds=page.getBoundingClientRect(), footer=page.querySelector(':scope > .a4pf');
    var bottom=footer?footer.getBoundingClientRect().top-3:bounds.bottom;
    function outside(r){return r.width>0&&r.height>0&&(r.left<bounds.left-1.5||r.right>bounds.right+1.5||r.top<bounds.top-1.5||r.bottom>bottom+1.5);}
    var clipped=Array.from(page.children).some(function(child){return child!==footer&&outside(child.getBoundingClientRect());});
    // Check visible glyphs as well as borders. A slice may hide whole lines,
    // but must never expose only part of a line at either viewport edge.
    var walker=doc.createTreeWalker(page,4), node;
    while(!clipped&&(node=walker.nextNode())){
      if(!node.textContent.trim()||node.parentElement.closest('.a4pf,style,script'))continue;
      var range=doc.createRange();range.selectNodeContents(node);
      var slice=node.parentElement.closest('[data-a4-slice]'), clip=slice&&slice.getBoundingClientRect();
      clipped=Array.from(range.getClientRects()).some(function(r){
        if(clip){
          if(r.bottom<=clip.top||r.top>=clip.bottom)return false;
          if(r.top<clip.top-1.5||r.bottom>clip.bottom+1.5)return true;
        }
        return outside(r);
      });
    }
    if(clipped)throw new Error((index+1)+'쪽의 내용이 인쇄 영역을 넘어 출력을 중단했습니다. 잘린 파일은 저장하지 않았습니다.');
  });
}
function _validateA4PrintDocument(html,contentW){
  return new Promise(function(resolve,reject){
    var frame=document.createElement('iframe'),done=false;
    frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;left:-99999px;top:0;width:'+contentW+'px;height:900px;border:0;visibility:hidden';
    function finish(error){if(done)return;done=true;clearTimeout(timer);frame.remove();if(error)reject(error);else resolve();}
    var timer=setTimeout(function(){finish(new Error('출력 페이지 확인 시간이 초과되었습니다. 다시 시도해 주세요.'));},30000);
    frame.onload=async function(){
      try{
        var doc=frame.contentDocument;if(!doc||!doc.body)throw new Error('출력 페이지를 확인하지 못했습니다.');
        if(doc.fonts)await doc.fonts.ready;
        await Promise.all(Array.from(doc.images).map(function(img){return img.complete?Promise.resolve():new Promise(function(r){img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true});});}));
        if(done)return;
        _assertA4PageBounds(doc);finish();
      }catch(error){finish(error);}
    };
    frame.srcdoc=html;document.body.appendChild(frame);
  });
}

/* A4 프린터 드롭다운 채우기 — 우선순위: 저장된 a4_printer > (감열 아닌) OS 기본 > 감열 아닌 첫 프린터 > OS 기본.
 * 변경 즉시 a4_printer 로 저장 → 다음 인쇄 때 그대로 복원(= 기존에 A4 로 인쇄하던 프린터로 설정). */
function _fillA4Printer(sel){
  if(!sel||!window.electronAPI||!window.electronAPI.listPrinters)return;
  sel.addEventListener('change', function(){ try{ window.electronAPI.settingsSet('a4_printer', sel.value||''); }catch(_e){} });
  const _pop=function(last){
    window.electronAPI.listPrinters().then(function(res){
      const list=(res&&Array.isArray(res.printers))?res.printers:(Array.isArray(res)?res:[]);
      if(!list.length)return;
      let defVal='';
      list.forEach(function(p){var v=p.name||p.deviceName||'';var o=document.createElement('option');o.value=v;o.textContent=(p.displayName||p.name||v)+(p.isDefault?' (기본)':'');sel.appendChild(o);if(p.isDefault)defVal=v;});
      let pick='';
      if(last){ for(let i=0;i<list.length;i++){ const lv=list[i].name||list[i].deviceName||''; if(lv===last){pick=last;break;} } }
      if(!pick){
        if(defVal&&!_isRcPrinter(defVal)) pick=defVal;
        if(!pick){ for(let k=0;k<list.length;k++){ const an=list[k].name||list[k].deviceName||''; if(an&&!_isRcPrinter(an)){pick=an;break;} } }
        if(!pick) pick=defVal;
      }
      if(pick)sel.value=pick; else if(sel.options.length>1)sel.selectedIndex=1;
    }).catch(function(){});
  };
  try{ window.electronAPI.settingsGet('a4_printer','').then(function(r){_pop((r&&r.value)||'');}).catch(function(){_pop('');}); }catch(e){_pop('');}
}

/* 실제 인쇄 — 프린터 지정 시 그 프린터로 silent, 미지정(기본 프린터)이면 OS 다이얼로그.
 * cssMargins=false(기본): html 이 @page margin:0 + 내부 padding 전제 → marginType:'none'.
 * cssMargins=true: html 이 @page margin:20mm 같은 CSS 여백을 가짐 → marginType:'default' 로 그 @page 여백을 따르게 함
 *   (마진을 none 으로 강제하면 Chromium 이 @page margin 을 무시하므로). 응급/감염 기록지 등 멀티페이지 문서용. */
function _doA4Print(html, title, deviceName, cssMargins, landscape){
  if(window.electronAPI&&window.electronAPI.printWindowWithSize){
    const silent=!!deviceName;
    const margins=cssMargins?{marginType:'default'}:{marginType:'none'};
    return window.electronAPI.printWindowWithSize(html,'A4',margins, title||undefined, silent, deviceName||undefined, undefined, landscape===true)
      .then(function(res){ if(res&&!res.success&&!res.cancelled) alert('인쇄 실패: '+(res.error||'')); return res; })
      .catch(function(e){ alert('인쇄 오류: '+(e&&e.message||e)); });
  }
  /* 폴백 (Electron 외 환경) */
  const w=window.open('','_blank','width=800,height=1000');
  w.document.write(html);w.document.close();w.focus();
  setTimeout(function(){w.print();w.close();},500);
}

/* PDF 저장 — 인쇄와 동일한 html 을 Chromium printToPDF 로 렌더 → 출력물과 동일한 PDF.
 * cssMargins=false(기본): @page margin:0 + 내부 padding 전제 → marginsType:1(none).
 * cssMargins=true: preferCSSPageSize:true 로 html 의 @page size/margin(20mm 등)을 매 페이지에 그대로 적용. */
function _doA4Pdf(html, title, cssMargins, landscape){
  if(!(window.electronAPI&&window.electronAPI.printToPDF)){ alert('PDF 저장 기능을 사용할 수 없습니다.'); return; }
  const fileName=(title||'문서').replace(/[\\\/:*?"<>|]/g,'_')+'.pdf';
  const pdfOpts=cssMargins
    ? {fileName:fileName, pageSize:'A4', printBackground:true, preferCSSPageSize:true, marginsType:0}
    : {fileName:fileName, pageSize:'A4', marginsType:1, printBackground:true};
  if(typeof landscape==='boolean')pdfOpts.landscape=landscape;
  return window.electronAPI.printToPDF(html,pdfOpts)
    .then(function(res){ if(res&&!res.success&&res.error!=='cancelled') alert('PDF 저장 실패: '+(res.error||'')); return res; })
    .catch(function(e){ alert('PDF 저장 오류: '+(e&&e.message||e)); });
}

/* 공개 API — A4 인쇄. 커스텀 미리보기 창 없이 표준 인쇄창(미리보기+프린터 선택)을 바로 띄운다.
 * (커스텀 오버레이가 일부 환경에서 페인트되지 않는 문제로, 안정적인 OS 인쇄창 사용. 2026-06-02)
 * opts: { html (필수), title } */
export function printA4(opts){
  opts=opts||{};
  if(!opts.html)return;
  return _doA4Print(opts.html, opts.title, undefined, !!opts.cssMargins);  /* deviceName 없음 → silent:false → 표준 인쇄창 표시 */
}

/* 공개 API — PDF 저장 다이얼로그(저장 경로 선택)를 바로 연다. 인쇄 미리보기 없이 즉시 저장.
 * opts: { html (필수), title, cssMargins (true 면 @page 여백+쪽번호 페이지 분할 문서로 변환), marginsMm } */
export function saveA4Pdf(opts){
  opts=opts||{};
  if(!opts.html)return;
  if(!opts.cssMargins) return _doA4Pdf(opts.html, opts.title, false);
  /* cssMargins: 페이지별 본문 재구성 + 쪽번호 footer 가 박힌 문서로 변환 후 저장 (미리보기/인쇄와 동일) */
  var mm=opts.marginsMm||{top:20,bottom:20,left:12,right:12};
  return prepareA4PrintDocument(opts.html,{marginsMm:mm,landscape:opts.landscape===true}).then(function(doc){
    return _doA4Pdf(doc.html, opts.title, true, doc.layout.landscape);
  }).catch(function(error){
    alert('PDF 저장 실패: '+(error.message||error));
    return {success:false,error:error.message||String(error)};
  });
}

/* 공개 API — A4 인쇄 미리보기 다이얼로그 열기.
 * opts: { html (필수, 완전한 인쇄 HTML), title (인쇄 작업/파일명), headerLabel (다이얼로그 제목) } */
export function openA4PrintDialog(opts){
  opts=opts||{};if(!opts.html)return;
  var existing=document.getElementById('a4PvCard');if(existing&&existing._closePreview)existing._closePreview();
  ['a4PvBd','a4PvCard'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
  var previousFocus=document.activeElement, closed=false, busy=false, prepared=null, current=0, loadId=0, prepareId=0;
  var landscape=opts.landscape===true, canRotate=typeof opts.buildHtml==='function';
  var bd=document.createElement('div');bd.id='a4PvBd';bd.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2147482999';
  var card=document.createElement('section');card.id='a4PvCard';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby','a4PvTitle');card.tabIndex=-1;
  card.style.cssText='position:fixed;inset:4vh 4vw;border-radius:14px;box-shadow:0 20px 70px #0005;display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:"Malgun Gothic","맑은 고딕",sans-serif';
  card.innerHTML='<style>#a4PvCard{background:#fff;color:#172b3a}#a4PvCard .a4-subtitle{color:#64748b}#a4PvCard *{box-sizing:border-box}#a4PvCard button,#a4PvCard select,#a4PvCard input{font:inherit;color:inherit;background:#fff;border:1px solid #cbd5e1;border-radius:7px;padding:7px 11px;min-height:34px}#a4PvCard button{cursor:pointer;font-weight:700}#a4PvCard button:disabled{opacity:.45;cursor:default}#a4PvCard :focus-visible{outline:2px solid #397b9c;outline-offset:2px}#a4PvCard .a4-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;background:#f5f8fa;border-bottom:1px solid #dbe3e9;font-size:12px;flex:none}#a4PvCard [data-act=go]{background:#156f69;border-color:#156f69;color:white}#a4PvCard [data-act=pdf]{background:#edf7f5;border-color:#a8cec6;color:#185b54}#a4PvCard .a4-stage{min-height:0;flex:1;overflow:auto;background:#dfe6eb;padding:20px;text-align:center}#a4PvCard .a4-sheet{position:relative;display:inline-block;background:white;box-shadow:0 3px 18px #26374733;text-align:left;overflow:hidden}#a4PvCard .a4-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-top:1px solid #dbe3e9;font-size:12px}#a4PvCard [data-role=status]{margin-right:auto;color:#526679}#a4PvCard[data-dark=true]{background:#203039;color:#edf4f6}#a4PvCard[data-dark=true] .a4-tools{background:#263a44;border-color:#47606b}#a4PvCard[data-dark=true] button,#a4PvCard[data-dark=true] select,#a4PvCard[data-dark=true] input{background:#304853;color:#edf4f6;border-color:#607782}#a4PvCard[data-dark=true] .a4-stage{background:#17262d}#a4PvCard[data-dark=true] .a4-subtitle{color:#c5d5df}#a4PvCard[data-dark=true] header,#a4PvCard[data-dark=true] .a4-foot{border-color:#47606b!important}#a4PvCard[data-dark=true] [data-act=go]{background:#247e76;border-color:#489e94;color:#fff}#a4PvCard[data-dark=true] [data-role=status]{color:#cfdae2}@media(max-width:600px){#a4PvCard{inset:8px!important;border-radius:10px!important}#a4PvCard .a4-stage{padding:10px}#a4PvCard .a4-foot{padding:10px}#a4PvCard [data-role=status]{flex-basis:100%}}</style>'
    +'<header style="display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid #dbe3e9;flex:none"><div style="flex:1"><h2 id="a4PvTitle" style="margin:0;font-size:17px">'+escHtml(opts.headerLabel||'인쇄 미리보기')+'</h2><div class="a4-subtitle" style="margin-top:5px;font-size:12px">페이지 구분과 잘림을 확인한 뒤 저장하거나 인쇄하세요.</div></div><button data-act="close" aria-label="인쇄 미리보기 닫기">닫기</button></header>'
    +'<nav class="a4-tools" aria-label="미리보기 페이지와 확대"><button data-act="prev" disabled>이전</button><label><input data-role="page" aria-label="페이지 번호" type="number" min="1" value="1" style="width:68px" disabled> / <span data-role="total">-</span> 페이지</label><button data-act="next" disabled>다음</button><span style="flex:1"></span>'+(canRotate?'<label>용지 방향 <select data-role="orientation" aria-label="용지 방향"><option value="portrait">A4 세로</option><option value="landscape">A4 가로</option></select></label>':'<span>'+(landscape?'A4 가로':'A4 세로')+'</span>')+'<select data-role="zoom" aria-label="미리보기 확대" disabled><option value="fit">너비 맞춤</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></nav>'
    +'<div class="a4-stage" tabindex="0" aria-label="출력 페이지"><div style="padding:40px;font-size:14px">페이지를 준비하고 있습니다.</div></div>'
    +'<div class="a4-foot" role="group" aria-label="출력 작업"><span data-role="status" role="status" aria-live="polite">문서를 준비하는 동안 잠시 기다려 주세요.</span><label data-role="printer-label">프린터 <select id="a4PvPrinter" style="max-width:200px"><option value="">인쇄창에서 선택</option></select></label><button data-act="pdf" disabled>PDF 저장</button><button data-act="go" disabled>인쇄</button></div>';
  card.dataset.dark=String(!document.body.classList.contains('light'));
  var stage=card.querySelector('.a4-stage'), status=card.querySelector('[data-role=status]'), pageInput=card.querySelector('[data-role=page]'), zoom=card.querySelector('[data-role=zoom]');
  var orientation=card.querySelector('[data-role=orientation]');
  if(orientation)orientation.value=landscape?'landscape':'portrait';
  var observer=null;
  function close(){if(busy)return;closed=true;loadId++;prepareId++;if(observer)observer.disconnect();document.removeEventListener('keydown',key,true);bd.remove();card.remove();if(previousFocus&&previousFocus.isConnected)previousFocus.focus();}
  card._closePreview=close;
  function controls(){
    card.querySelector('[data-act=prev]').disabled=!prepared||busy||current===0;
    card.querySelector('[data-act=next]').disabled=!prepared||busy||current===prepared.pages.length-1;
    pageInput.disabled=zoom.disabled=!prepared||busy;
    card.querySelector('[data-act=pdf]').disabled=card.querySelector('[data-act=go]').disabled=!prepared||busy;
    card.querySelector('[data-act=close]').disabled=busy;
    if(orientation)orientation.disabled=busy;
  }
  function key(e){
    if(closed)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==='Tab'){
      var focusable=Array.from(card.querySelectorAll('button,input,select,[tabindex="0"]')).filter(function(el){return !el.disabled&&el.getClientRects().length;});
      var first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===card)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    if(prepared&&!busy&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)&&/^(ArrowLeft|ArrowRight)$/.test(e.key)){e.preventDefault();show(current+(e.key==='ArrowLeft'?-1:1));}
  }
  function sizeSheet(){
    var sheet=stage.querySelector('.a4-sheet');if(!sheet||!prepared)return;
    var l=prepared.layout, px=96/25.4, scale=zoom.value==='fit'?Math.min(1.25,Math.max(.15,(stage.clientWidth-42)/(l.widthMm*px))):Number(zoom.value);
    sheet.style.width=(l.widthMm*px*scale)+'px';sheet.style.height=(l.heightMm*px*scale)+'px';
    var frame=sheet.querySelector('iframe');frame.style.left=((l.marginsMm.left||0)*px*scale)+'px';frame.style.top=((l.marginsMm.top||0)*px*scale)+'px';frame.style.transform='scale('+scale+')';
  }
  function show(index){
    if(!prepared||closed)return;current=Math.max(0,Math.min(prepared.pages.length-1,index));var ticket=++loadId;
    pageInput.value=current+1;card.dataset.page=String(current+1);controls();
    var sheet=document.createElement('div');sheet.className='a4-sheet';
    var frame=document.createElement('iframe');frame.title=(current+1)+'페이지 미리보기';frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('scrolling','no');
    frame.style.cssText='position:absolute;border:0;background:white;transform-origin:top left;width:'+prepared.layout.contentW+'px;height:'+prepared.layout.contentH+'px';
    frame.srcdoc=_buildPaginatedDoc(prepared.headHtml,[prepared.pages[current]],prepared.layout.marginsMm,current+1,prepared.pages.length,prepared.layout.heightMm);
    frame.onload=function(){if(ticket!==loadId||closed)return;frame.contentDocument.addEventListener('keydown',key,true);status.textContent=(current+1)+' / '+prepared.pages.length+'페이지 · 미리보기와 동일한 문서로 출력합니다.';};
    sheet.appendChild(frame);stage.replaceChildren(sheet);stage.scrollTop=0;stage.scrollLeft=0;sizeSheet();
  }
  async function output(kind){
    if(!prepared||busy)return;busy=true;controls();status.textContent=kind==='pdf'?'PDF를 저장하고 있습니다.':'인쇄창을 준비하고 있습니다.';
    try{
      var res=kind==='pdf'?await _doA4Pdf(prepared.html,opts.title,true,prepared.layout.landscape):await _doA4Print(prepared.html,opts.title,card.querySelector('#a4PvPrinter').value||undefined,true,prepared.layout.landscape);
      status.textContent=res&&(res.cancelled||res.error==='cancelled')?'출력이 취소되었습니다.':res&&res.success?(kind==='pdf'?'PDF 저장이 완료되었습니다.':'인쇄 요청을 전달했습니다.'):'출력을 완료하지 못했습니다. 다시 시도해 주세요.';
    }catch(error){status.textContent='출력 실패: '+(error.message||error);}
    finally{busy=false;controls();}
  }
  card.querySelector('[data-act=close]').onclick=close;bd.onclick=close;
  card.querySelector('[data-act=prev]').onclick=function(){show(current-1);};card.querySelector('[data-act=next]').onclick=function(){show(current+1);};
  pageInput.onchange=function(){show((Number(pageInput.value)||1)-1);};zoom.onchange=sizeSheet;
  card.querySelector('[data-act=pdf]').onclick=function(){output('pdf');};card.querySelector('[data-act=go]').onclick=function(){output('print');};
  document.body.append(bd,card);document.addEventListener('keydown',key,true);card.querySelector('[data-act=close]').focus();
  if(window.ResizeObserver){observer=new ResizeObserver(sizeSheet);observer.observe(stage);}
  if(window.electronAPI&&window.electronAPI.listPrinters)_fillA4Printer(card.querySelector('#a4PvPrinter'));else card.querySelector('[data-role=printer-label]').hidden=true;
  async function prepare(nextLandscape){
    var ticket=++prepareId;landscape=nextLandscape===true;prepared=null;loadId++;
    delete card.dataset.pageCount;delete card.dataset.page;delete card.dataset.orientation;
    pageInput.value=1;card.querySelector('[data-role=total]').textContent='-';
    stage.textContent='페이지를 준비하고 있습니다.';status.textContent='선택한 용지 방향에 맞춰 페이지를 다시 계산합니다.';controls();
    try{
      var html=canRotate?await opts.buildHtml(landscape):opts.html;
      if(closed||ticket!==prepareId)return;
      var result=await prepareA4PrintDocument(html,Object.assign({},opts,{landscape:landscape}));
      if(closed||ticket!==prepareId)return;
      prepared=result;card.dataset.orientation=result.layout.landscape?'landscape':'portrait';
      card.dataset.pageCount=String(result.pages.length);card.querySelector('[data-role=total]').textContent=result.pages.length;pageInput.max=result.pages.length;
      if(typeof opts.onOrientationChange==='function')opts.onOrientationChange(result.layout.landscape);
      show(0);
    }catch(error){if(closed||ticket!==prepareId)return;prepared=null;stage.textContent='미리보기를 만들지 못했습니다.';status.textContent=error.message||String(error);controls();}
  }
  if(orientation)orientation.onchange=function(){prepare(orientation.value==='landscape');};
  prepare(landscape);
}

/* Browser PDF capture reuses row-aware pagination without changing desktop output. */
export function paginatePrintDocument(doc, pageHeight){
  return _paginateWithHeaders(doc, pageHeight, true);
}

/* One measured document is shared by the preview, printer and both PDF paths. */
export function prepareA4PrintDocument(html,opts){
  opts=opts||{};
  if(typeof html!=='string'||!html.trim())return Promise.reject(new Error('출력할 내용이 없습니다.'));
  var landscape=!!opts.landscape, mm=opts.marginsMm||{top:0,right:0,bottom:0,left:0};
  var widthMm=landscape?297:210, heightMm=landscape?210:297, px=96/25.4;
  var contentW=Math.floor((widthMm-(mm.left||0)-(mm.right||0))*px);
  var contentH=Math.floor((heightMm-(mm.top||0)-(mm.bottom||0))*px);
  var packH=Math.floor(_ppHeightMm(mm,heightMm)*px)-20;
  if(contentW<75||packH<75)return Promise.reject(new Error('용지 여백이 너무 큽니다.'));
  return _measureAndPaginate(html,contentW,packH).then(function(r){
    var layout={landscape:landscape,marginsMm:mm,widthMm:widthMm,heightMm:heightMm,contentW:contentW,contentH:contentH};
    var pageCss='<style>@page{size:A4 '+(landscape?'landscape':'portrait')+';margin:'+(mm.top||0)+'mm '+(mm.right||0)+'mm '+(mm.bottom||0)+'mm '+(mm.left||0)+'mm}html{overflow:hidden}body{margin:0}.a4pp{width:'+contentW+'px;max-width:100%;}.a4pf{line-height:14px}</style>';
    var head=r.headHtml+pageCss;
    var doc=_buildPaginatedDoc(head,r.pages,mm,undefined,undefined,heightMm);
    doc=doc.replace('<html>','<html data-a4-prepared="1" data-a4-layout="'+escHtml(JSON.stringify(layout))+'">');
    return _validateA4PrintDocument(doc,contentW).then(function(){return {html:doc,headHtml:head,pages:r.pages,layout:layout};});
  });
}
