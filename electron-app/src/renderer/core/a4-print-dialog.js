/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══ 공용 A4 세로 인쇄 미리보기 다이얼로그 (a4-print-dialog.js) ═══ */
/* ES Module
 *
 * 목적: "미리보기 = 실제 출력물" 한 치 오차 없음 + A4 세로 전용 인쇄 다이얼로그.
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
function _paginateWithHeaders(doc, pageH){
  if(!doc||!doc.body) return null;
  var win=doc.defaultView||window;
  function H(el){ return el.getBoundingClientRect().height; }
  function MB(el){ try{ return parseFloat(win.getComputedStyle(el).marginBottom)||0; }catch(e){ return 0; } }
  var items=[];
  Array.prototype.forEach.call(doc.body.children, function(child){
    if((child.tagName||'').toLowerCase()==='table'){
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
      items.push({kind:'table', style:child.getAttribute('style')||'', col:col?col.outerHTML:'', thead:thead?thead.outerHTML:'', theadH:thead?H(thead):0, rows:rows, mb:MB(child)});
    } else {
      /* 명시적 페이지 브레이크(page-break-after:always / break-after:page) 감지 — 표지(.dp-pdf-cover) 등
       *  "이 블록으로 페이지를 끝내라"는 문서 의도를 재구성 시에도 존중 (사용자 보고 2026-08-27: 인쇄 표지 미분리) */
      var _brk=false;
      try{ var _cs=win.getComputedStyle(child); _brk=(_cs.breakAfter==='page'||_cs.pageBreakAfter==='always'); }catch(e){}
      items.push({kind:'block', html:child.outerHTML, h:H(child), mb:MB(child), brk:_brk});
    }
  });
  if(!items.length) return null;

  /* 한 페이지보다 큰 행(긴 셀)의 텍스트를 페이지 높이에 맞춰 자르기 위한 측정용 프로브 */
  var probe=doc.createElement('div');
  probe.style.cssText='position:absolute;left:-99999px;top:0;width:100%;visibility:hidden';
  doc.body.appendChild(probe);
  function styleAttr(item){ return item.style?(' style="'+item.style.replace(/"/g,'&quot;')+'"'):''; }
  function longCellIdx(node){ var idx=0,max=-1; for(var j=0;j<node.children.length;j++){ var t=(node.children[j].textContent||'').length; if(t>max){max=t;idx=j;} } return idx; }
  function rowHtmlWith(node, idx, text){   /* 긴 셀(idx)만 text 로 바꾸고 나머지 셀(라벨 등)은 그대로 → 라벨이 매 페이지 반복 */
    var clone=node.cloneNode(true);
    if(clone.children[idx]) clone.children[idx].textContent=text;
    return clone.outerHTML;
  }
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
  items.forEach(function(item){
    if(item.kind==='block'){
      /* ★ 페이지보다 큰 '분할 불가 블록' — 세로 오프셋 슬라이스로 페이지에 정확히 배분 (2026-08-26).
       *  옛 로직은 이런 블록을 한 페이지(height 고정+overflow:hidden)에 통째로 넣어 넘치는 내용이
       *  소리 없이 잘려 나갔다(보건일지 '특정 방문자' 인쇄 11건→5건 잘림 사고).
       *  각 페이지 조각 = 블록 전체를 복제해 위로 -offset 만큼 밀고 pageH 로 클립 → 픽셀 단위로
       *  이어지는 연속 분할. 미리보기와 인쇄가 같은 문서를 쓰므로 '보이는 대로 인쇄'가 유지되고
       *  내용은 몇 페이지가 되든 전량 출력된다. */
      if(item.h>pageH){
        if(used>0) flush();
        var off=0, sliceH=0;
        while(off<item.h){
          sliceH=Math.min(pageH, item.h-off);
          cur.push('<div style="height:'+Math.ceil(sliceH)+'px;overflow:hidden"><div style="margin-top:-'+Math.floor(off)+'px">'+item.html+'</div></div>');
          off+=sliceH;
          if(off<item.h) flush();
        }
        used=sliceH+item.mb;   /* 마지막 조각 높이만 현재 페이지 사용분으로 — 남는 공간엔 후속 항목이 이어짐 */
        if(item.brk&&used>0) flush();   /* 명시적 page-break — 이 블록으로 페이지 종료 (2026-08-27) */
        return;
      }
      if(used+item.h>pageH && used>0) flush();
      cur.push(item.html); used+=item.h+item.mb;
      if(item.brk&&used>0) flush();     /* 명시적 page-break (표지 등) — 다음 내용은 새 페이지부터 (2026-08-27) */
      return;
    }
    var i=0, maxRow=pageH-item.theadH;   /* 제목과 함께 한 페이지에 들어갈 수 있는 최대 행 높이 */
    var chunkRows=[];                    /* 현재 페이지·현재 표에 모이는 행들(제목 thead 는 한 번만) */
    function pushChunk(){ if(chunkRows.length){ cur.push('<table'+styleAttr(item)+'>'+item.col+item.thead+renderRows(chunkRows)+'</table>'); chunkRows=[]; } }
    while(i<item.rows.length){
      var row=item.rows[i];
      if(row.h<=maxRow){
        /* 일반 행 */
        if(!chunkRows.length){ if(used>0 && used+item.theadH+row.h>pageH) flush(); used+=item.theadH; }   /* 새 표 시작 → 제목 1회(고아 방지) */
        else if(used+row.h>pageH){ pushChunk(); flush(); used+=item.theadH; }                            /* 페이지 넘침 → 다음 페이지(제목 반복) */
        chunkRows.push(row); used+=row.h; i++;
      } else {
        /* 한 페이지보다 큰 행 → 긴 셀 텍스트를 잘라 여러 페이지로 흘림. 첫 조각은 앞 행들과 같은 페이지에 이어 붙임 */
        if(!chunkRows.length){ if(used>0 && (pageH-used-item.theadH)<28) flush(); used+=item.theadH; }
        var node=row.node, idx=longCellIdx(node);
        var tokens=((node.children[idx]?node.children[idx].textContent:'')||'').split(/(\s+)/);  /* 공백 보존 토큰 */
        if(tokens.length<2){ chunkRows.push(row); used+=row.h; i++; continue; }                 /* 분할 불가(드묾) */
        var pos=0;
        while(pos<tokens.length){
          var avail=pageH-used-12;                        /* 현재 페이지 남은 높이(12px 안전여유) */
          if(avail<28){ pushChunk(); flush(); used+=item.theadH; avail=pageH-used-12; }          /* 한 줄도 안 되면 다음 페이지 */
          var lo=pos+1, hi=tokens.length, best=pos+1;
          while(lo<=hi){ var midN=(lo+hi)>>1; var h=measureRowHtml(item, rowHtmlWith(node,idx,tokens.slice(pos,midN).join(''))); if(h<=avail){best=midN;lo=midN+1;}else{hi=midN-1;} }
          var pieceHtml=rowHtmlWith(node, idx, tokens.slice(pos,best).join(''));
          chunkRows.push({html:pieceHtml, wrap:true}); used+=measureRowHtml(item, pieceHtml);
          pos=best;
          if(pos<tokens.length){ pushChunk(); flush(); used+=item.theadH; }   /* 남은 글 → 다음 페이지(제목 반복) */
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
  return new Promise(function(resolve){
    var meas=document.createElement('iframe');
    meas.setAttribute('scrolling','no');
    meas.style.cssText='position:fixed;left:-99999px;top:0;width:'+contentW+'px;height:10px;border:0;visibility:hidden';
    meas.srcdoc=html;
    meas.onload=function(){
      var done=function(){
        var headHtml='', pages=null;
        try{ var d=meas.contentDocument; headHtml=d.head?d.head.innerHTML:''; pages=_paginateWithHeaders(d, packH); }catch(e){ pages=null; }
        try{ meas.remove(); }catch(e){}
        resolve({headHtml:headHtml, pages:pages});
      };
      var fr=null; try{ fr=meas.contentWindow.document.fonts; }catch(e){}
      if(fr&&fr.ready&&fr.ready.then){ fr.ready.then(done).catch(done); } else { done(); }
    };
    document.body.appendChild(meas);
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
function _doA4Pdf(html, title, cssMargins){
  if(!(window.electronAPI&&window.electronAPI.printToPDF)){ alert('PDF 저장 기능을 사용할 수 없습니다.'); return; }
  const fileName=(title||'문서').replace(/[\\\/:*?"<>|]/g,'_')+'.pdf';
  const pdfOpts=cssMargins
    ? {fileName:fileName, pageSize:'A4', printBackground:true, preferCSSPageSize:true, marginsType:0}
    : {fileName:fileName, pageSize:'A4', marginsType:1, printBackground:true};
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
  var A4W=794, mmToPx=A4W/210;
  var contentW=A4W-Math.round((mm.left||0)*mmToPx)-Math.round((mm.right||0)*mmToPx);
  var packH=Math.round(_ppHeightMm(mm)*mmToPx)-18;
  return _measureAndPaginate(opts.html, contentW, packH).then(function(r){
    var doc=(r.pages&&r.pages.length)?_buildPaginatedDoc(r.headHtml, r.pages, mm):opts.html;
    return _doA4Pdf(doc, opts.title, true);
  });
}

/* 공개 API — A4 세로 인쇄 미리보기 다이얼로그 열기.
 * opts: { html (필수, 완전한 인쇄 HTML), title (인쇄 작업/파일명), headerLabel (다이얼로그 제목) } */
export function openA4PrintDialog(opts){
  opts=opts||{};
  var html=opts.html; if(!html)return;
  var title=opts.title||'';
  var headerLabel=opts.headerLabel||'인쇄';
  var landscape=!!opts.landscape;   /* 가로(A4 297×210) 모드 — 보건일지 출력 등 (2026-06-15) */
  /* 기존 잔재 제거 */
  ['a4PvBd','a4PvCard'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

  /* 배경 + 카드를 따로 띄움(방문확인증 다이얼로그와 동일 구조) — 최상위 z-index 로 확실히 표시 */
  var bd=document.createElement('div');
  bd.id='a4PvBd';
  bd.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(15,23,42,0.62);z-index:2147482999';

  var card=document.createElement('div');
  card.id='a4PvCard';
  card.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;max-width:92vw;max-height:92vh;overflow:hidden;z-index:2147483000;font-family:"Malgun Gothic","맑은 고딕",sans-serif';

  var _close=function(){ var a=document.getElementById('a4PvBd'); if(a)a.remove(); var b=document.getElementById('a4PvCard'); if(b)b.remove(); };
  bd.addEventListener('click',_close);

  var hdr=document.createElement('div');
  hdr.style.cssText='padding:13px 20px;border-bottom:1px solid #e5e7eb;background:#f9fafb;font-size:14px;font-weight:800;color:#111;flex:none';
  hdr.innerHTML='🖨 '+escHtml(headerLabel)+' <span style="font-size:11px;font-weight:600;color:#64748b">· '+(landscape?'A4 가로':'A4 세로')+'</span>';
  card.appendChild(hdr);

  var body=document.createElement('div');
  body.style.cssText='padding:18px;background:#e2e8f0;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:14px;flex:1 1 auto';
  var pageHmm=landscape?210:297;                   /* 페이지 높이(mm) — 페이지네이션·시트 높이 기준 */
  var mmToPx=794/210;                              /* px per mm @96dpi (방향 무관 상수) */
  var A4W=Math.round((landscape?297:210)*mmToPx);  /* 페이지 폭 px (가로 ≈1123 / 세로 794) — 인쇄 콘텐츠 폭과 동일 */
  var A4H=Math.round((landscape?210:297)*mmToPx);  /* 페이지 높이 px (가로 794 / 세로 ≈1123) */
  /* @page 여백(mm) — 지정 시 미리보기 시트에 그 여백을 그대로 반영(본문 폭·페이지당 높이 축소).
   *  미지정(기본 호출자)이면 0 → html 내부 padding 이 여백 역할(기존 동작 유지). */
  var mm=opts.marginsMm||null;
  var cssMargins=!!opts.cssMargins||!!mm;
  var mTop=Math.round(((mm&&mm.top)||0)*mmToPx),    mBottom=Math.round(((mm&&mm.bottom)||0)*mmToPx);
  var mLeft=Math.round(((mm&&mm.left)||0)*mmToPx),  mRight=Math.round(((mm&&mm.right)||0)*mmToPx);
  var contentW=A4W-mLeft-mRight;                          /* 실제 본문(인쇄 가능) 폭 → 줄바꿈 일치 */
  var ppHpx=cssMargins?Math.round(_ppHeightMm(mm, pageHmm)*mmToPx):(A4H-mTop-mBottom);  /* 페이지당 본문(콘텐츠) 높이 */
  var packH=cssMargins?(ppHpx-18):ppHpx;                  /* 재구성 시 채울 높이(쪽번호 footer 여유 18px) */
  var dispW=Math.min(landscape?820:560, Math.max(300, window.innerWidth*(landscape?0.68:0.5)));
  var scale=dispW/A4W;
  var printDoc=html;  /* 인쇄 버튼이 쓸 문서 — cssMargins 면 쪽번호 페이지 분할 문서로 교체 */

  /* 페이지 1장 = A4 시트. 본문은 여백(mLeft,mTop) 안쪽에 두고, 클립은 시트 우/하단 끝까지 넓혀
   *  표의 오른쪽·아래쪽 1px 테두리가 잘리지 않게 한다(본문 폭 바깥은 빈 여백). pageHtml 은 완전한 <html> 문서. */
  function _makeSheet(pageHtml){
    var sheet=document.createElement('div');
    sheet.style.cssText='position:relative;width:'+dispW+'px;height:'+Math.round(A4H*scale)+'px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.22);overflow:hidden;flex:none';
    var clip=document.createElement('div');
    clip.style.cssText='position:absolute;left:'+Math.round(mLeft*scale)+'px;top:'+Math.round(mTop*scale)+'px;width:'+Math.round((A4W-mLeft)*scale)+'px;height:'+Math.round((A4H-mTop)*scale)+'px;overflow:hidden';
    var pifr=document.createElement('iframe');
    pifr.setAttribute('scrolling','no');
    pifr.style.cssText='width:'+contentW+'px;height:'+(A4H-mTop)+'px;border:0;background:#fff;transform:scale('+scale+');transform-origin:top left;display:block';
    pifr.srcdoc=pageHtml;
    clip.appendChild(pifr);
    sheet.appendChild(clip);
    return sheet;
  }

  /* 측정용 iframe 으로 페이지별 본문 재구성 → 시트 쌓기. cssMargins 면 쪽번호 footer 가 박힌 페이지 문서로 렌더. */
  _measureAndPaginate(html, contentW, packH).then(function(r){
    var pages=r.pages, headHtml=r.headHtml;
    if(!pages||!pages.length){ body.appendChild(_makeSheet(html, ppHpx)); return; }   /* 폴백: 원본 단일 시트 */
    if(cssMargins){
      printDoc=_buildPaginatedDoc(headHtml, pages, mm, undefined, undefined, pageHmm);
      pages.forEach(function(p,idx){ body.appendChild(_makeSheet(_buildPaginatedDoc(headHtml,[p],mm,idx+1,pages.length,pageHmm), ppHpx)); });
    } else {
      pages.forEach(function(p){ body.appendChild(_makeSheet('<!DOCTYPE html><html><head>'+headHtml+'</head><body>'+p+'</body></html>', ppHpx)); });
    }
  });
  card.appendChild(body);

  var foot=document.createElement('div');
  foot.style.cssText='display:flex;align-items:center;gap:10px;justify-content:flex-end;padding:13px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;flex-wrap:wrap;flex:none';
  foot.innerHTML='<span style="font-size:12px;font-weight:700;color:#334155">프린터</span>'
    +'<select id="a4PvPrinter" style="font-size:12px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;min-width:160px;max-width:240px;flex:0 1 auto"><option value="">기본 프린터</option></select>'
    +'<span style="flex:1 1 auto"></span>'
    +'<button class="btn-print" data-act="go">🖨 인쇄</button>';
  card.appendChild(foot);

  document.body.appendChild(bd);
  document.body.appendChild(card);
  _fillA4Printer(document.getElementById('a4PvPrinter'));
  foot.querySelector('[data-act="go"]').addEventListener('click',function(){
    var sel=document.getElementById('a4PvPrinter');
    var dev=(sel&&sel.value)||undefined;
    if(dev){try{window.electronAPI.settingsSet('a4_printer',dev);}catch(_e){}}
    _close();
    _doA4Print(printDoc, title, dev, cssMargins, landscape);   /* cssMargins 면 쪽번호 페이지 분할 문서를 인쇄, landscape 면 가로 출력 */
  });
}
