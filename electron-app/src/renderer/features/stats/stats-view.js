/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { S } from '../../core/app-state.js';
import { escHtml, toDateStr } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { renderDashboard } from '../dashboard/dashboard-view.js';

/* ═══════════════════════════════════════
   STATISTICS (Req 7-10, 21-25)
   — 비즈니스 로직은 백엔드(StatisticsDBService)에서 수행
   — 렌더러는 결과를 받아 UI만 렌더링
   ═══════════════════════════════════════ */
/* 공유 가변 상태 */
let _cachedSubTabs=[];  /* 백엔드에서 받은 서브탭 캐시 */

export function setStatsPeriod(period, btn){
  if(period!=='today'){
    const _now=new Date();
    const _todayStr=_now.getFullYear()+'-'+String(_now.getMonth()+1).padStart(2,'0')+'-'+String(_now.getDate()).padStart(2,'0');
    if(S.selectedDate!==_todayStr){
      S.selectedDate=_todayStr;
      bus.emit('render:calendar');
    }
  }
  S.statsPeriod=period;
  S._dashSubIdx=0;
  document.querySelectorAll('.stats-period-tab').forEach(t=>t.classList.toggle('active',t.dataset.period===period));
  if(period==='custom'&&S.currentView==='dashboard'){
    if(!S._dashCustomStart||!S._dashCustomEnd){
      /* dashboard-view.js 모듈의 내부 상태 변수(_dcpYear 등)는 직접 접근 불가 —
         S 공유 상태에 초기값만 셋하면 dashboard-view 가 첫 렌더 시 동기화함 */
      S._dashCustomStart='';S._dashCustomEnd='';
    }
  }
  if(S.currentView==='dashboard'){
    function _dashScrollTop(){
      document.querySelectorAll('.main,.canvas,.magic-chart-body').forEach(function(el){el.scrollTop=0;});
      const v=document.getElementById('view-dashboard');if(v)v.scrollTop=0;
      window.scrollTo(0,0);
    }
    _dashScrollTop();
    _dashRenderSubTabs();
    const _sel='#view-dashboard .cc, #dashPanelSummary, #dashPanelDeptStats, #dashPanelDeptChart';
    const cards=document.querySelectorAll(_sel);
    cards.forEach(function(c){
      c.style.transition='opacity 0.15s ease, transform 0.15s ease';
      c.style.opacity='0';c.style.transform='translateY(8px)';
    });
    setTimeout(function(){
      _dashScrollTop();
      bus.emit('render:dashboard');
      _dashScrollTop();
      setTimeout(_dashScrollTop,50);
      const cards2=document.querySelectorAll(_sel);
      cards2.forEach(function(c,i){
        c.style.transition='none';c.style.opacity='0';c.style.transform='translateY(14px)';
        setTimeout(function(){
          c.style.transition='opacity 0.35s ease, transform 0.35s ease';
          c.style.opacity='1';c.style.transform='translateY(0)';
        },i*60);
      });
    },180);
  }
  else renderStats();
}
function _dashSelectSub(idx){
  S._dashSubIdx=idx;
  document.querySelectorAll('#dashSubTabs .tr-sub-tab').forEach(function(t,i){t.classList.toggle('active',i===idx);});
  /* 직접 호출로 확실하게 재렌더 (bus.emit 가 어떤 이유로 듣지 않을 가능성 차단) */
  if(typeof renderDashboard==='function')renderDashboard();
  bus.emit('render:dashboard');
}

export function _dashGetSubTabs(){ return _cachedSubTabs; }

/* ── 서브탭: 백엔드에서 생성, 캐시 ── */
export async function _dashRenderSubTabs(){
  const area=document.getElementById('dashSubTabArea');
  const wrap=document.getElementById('dashSubTabs');
  if(!area||!wrap)return;
  try{
    const res=await window.electronAPI.statsDbSubTabs(S.statsPeriod, S.selectedDate);
    const tabs=(res&&res.success)?res.data:[];
    /* ★ 현재 학년도의 학기/학년도 기간을 설정값(semesterInfo)으로 덮어쓴다 — 보건일지·진행률과 동일 출처.
     *  과거 연도 탭은 백엔드 기본값 유지. 집계는 렌더러가 sub.from/to 범위로 필터하므로 이 덮어쓰기로 반영됨. (사용자 지시 2026-06-16) */
    let _semSet=null;
    try{
      const _curAy=(function(){const n=new Date();return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;})();
      const _s=JSON.parse(localStorage.getItem('ec_settings')||'{}');
      const si=_s&&_s.semesterInfo;
      if(si&&si.sem1Start&&si.sem1End&&si.sem2Start&&si.sem2End&&parseInt(String(si.sem1Start).slice(0,4),10)===_curAy){
        _semSet={ay:_curAy, s1Start:si.sem1Start, s1End:si.sem1End, s2Start:si.sem2Start, s2End:si.sem2End};
      }
    }catch(_){}
    if(_semSet){
      _cachedSubTabs=tabs.map(function(t){
        if(S.statsPeriod==='semester' && t && t.year===_semSet.ay && t.half){
          return Object.assign({}, t, t.half===1?{from:_semSet.s1Start,to:_semSet.s1End}:{from:_semSet.s2Start,to:_semSet.s2End});
        }
        if(S.statsPeriod==='year' && t && t.year===_semSet.ay){
          return Object.assign({}, t, {from:_semSet.s1Start, to:_semSet.s2End});
        }
        return t;
      });
    } else {
      _cachedSubTabs=tabs;
    }
    if(tabs.length<=1){area.style.display='none';return;}
    area.style.display='block';
    wrap.innerHTML=tabs.map(function(t,i){
      return '<button class="tr-sub-tab dash-sub-tab'+(i===S._dashSubIdx?' active':'')+'" data-sub-idx="'+i+'" style="padding:5px 16px;font-size:10px">'+escHtml(t.label)+'</button>';
    }).join('');
    wrap.querySelectorAll('[data-sub-idx]').forEach(function(btn){
      btn.addEventListener('click', function(){ _dashSelectSub(Number(btn.dataset.subIdx)); });
    });
  }catch(e){
    _cachedSubTabs=[];
    area.style.display='none';
  }
}

/** 현재 선택된 서브탭의 날짜 범위를 반환 */
function _getSelectedDateRange(){
  const sub=_cachedSubTabs[S._dashSubIdx];
  if(S.statsPeriod==='custom'){
    return {from:S._dashCustomStart, to:S._dashCustomEnd};
  }
  if(S.statsPeriod==='today'){
    const today=S.selectedDate||toDateStr(new Date());
    return {from:today, to:today};
  }
  if(sub&&sub.from&&sub.to) return {from:sub.from, to:sub.to};
  /* 폴백: 오늘 기준 학년도 전체 */
  const yr=new Date().getFullYear();
  return {from:yr+'-03-01', to:(yr+1)+'-02-28'};
}

function _currentStatsYear(){
  const sub=_cachedSubTabs[S._dashSubIdx];
  if(sub&&sub.year) return String(sub.year);
  const m=new Date().getMonth();
  const y=new Date().getFullYear();
  return String(m<2?y-1:y);
}

/* ── 기간별 필터링: 외부 가져온 기록(isImported)도 포함 ── */
export function getFilteredRecords(){
  const range=_getSelectedDateRange();
  if(!range.from||!range.to) return [];
  return S.records.filter(function(r){return r.date>=range.from&&r.date<=range.to;});
}

export function renderStats(){
  const periodLabels={today:'오늘',week:'주간',month:'월간',semester:'학기',year:'연도',custom:'기간 선택'};
  document.getElementById('statsPeriodLabel').textContent=periodLabels[S.statsPeriod]+' 통계';

  /* 백엔드에서 통계 집계 */
  const range=_getSelectedDateRange();
  const yr=_currentStatsYear();

  window.electronAPI.statsDbQuick(yr, range.from, range.to).then(function(res){
    if(!res||!res.success||!res.data) return;
    const d=res.data;
    const careCount=S.people.filter(function(s){return s.status==='caution'||s.status==='watch';}).length;

    document.getElementById('statsTopRow').innerHTML=
      '<div class="stat-card"><div class="stat-label">총 방문</div><div class="stat-val">'+d.total+'</div><div class="stat-delta" style="color:var(--t3)">'+d.uniqueDays+'일간</div></div>'+
      '<div class="stat-card"><div class="stat-label">일평균</div><div class="stat-val">'+d.avg+'</div><div class="stat-delta" style="color:var(--t3)">건/일</div></div>'+
      '<div class="stat-card"><div class="stat-label">요보호 학생</div><div class="stat-val">'+careCount+'</div></div>';

    /* Top 5 증상 */
    const top5=d.topSymptoms||[];
    const maxSym=top5[0]?top5[0].count:1;
    document.getElementById('topSymptomChart').innerHTML=top5.map(function(s,i){
      return '<div class="bar-row"><div class="bar-label">'+escHtml(s.name)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+(s.count/maxSym*100).toFixed(0)+'%;background:'+chartColors[i]+'"><span class="bar-val">'+s.count+'건</span></div></div></div>';
    }).join('')||'<div style="text-align:center;color:var(--t3);font-size:12px;padding:20px">데이터 없음</div>';

    /* 학년 분포 */
    const gradeEntries=d.gradeDistribution||[];
    const gradeTotal=gradeEntries.reduce(function(s,e){return s+e.count;},0)||1;
    const gParts=[];
    let gCum=0;
    gradeEntries.forEach(function(e,i){const p=e.count/gradeTotal*100;gParts.push(chartColors[i%chartColors.length]+' '+gCum.toFixed(1)+'% '+(gCum+p).toFixed(1)+'%');gCum+=p;});
    const gradeLabel=S.settings.schoolLevel==='kindergarten'?'세':'학년';
    document.getElementById('gradeDonut').innerHTML='<div class="donut" style="background:conic-gradient('+gParts.join(',')+')"><div class="donut-hole">'+gradeTotal+'</div></div><div class="donut-legend">'+gradeEntries.map(function(e,i){return '<div class="donut-leg-item"><div class="donut-leg-dot" style="background:'+chartColors[i%chartColors.length]+'"></div><span>'+escHtml(e.grade)+gradeLabel+'</span><span class="mono" style="margin-left:auto;font-family:var(--fm);font-size:11px;color:var(--t1)">'+e.count+'건</span></div>';}).join('')+'</div>';

    /* 처치 요약 */
    const treatEntries=d.treatmentSummary||[];
    document.getElementById('treatBody').innerHTML=treatEntries.map(function(t){
      return '<tr><td style="font-weight:500">'+escHtml(t.name)+'</td><td class="mono">'+t.count+'건</td><td class="mono">'+t.pct+'%</td><td><div style="width:100%;height:14px;background:var(--bg2);border-radius:3px;overflow:hidden"><div style="width:'+t.pct+'%;height:100%;background:var(--cyan);border-radius:3px"></div></div></td></tr>';
    }).join('');
  }).catch(function(err){ console.error('[Stats] quick stats 조회 실패:', err); });

  /* 트렌드 차트: 백엔드에서 시계열 데이터 조회 */
  renderTrendChart(null, 'statsTrendChart');
}

function renderTrendChart(filtered, targetId){
  const container=document.getElementById(targetId||'statsTrendChart');
  if(!container)return;

  const range=_getSelectedDateRange();
  const yr=_currentStatsYear();
  const sub=_cachedSubTabs[S._dashSubIdx];

  const opts={
    year:yr, from:range.from, to:range.to,
    period:S.statsPeriod, selectedDate:S.selectedDate
  };
  if(sub&&sub.half){opts.semesterYear=sub.year;opts.semesterHalf=sub.half;}
  if(sub&&sub.year){opts.calYear=sub.year;}

  window.electronAPI.statsDbTrend(opts).then(function(res){
    if(!res||!res.success||!res.data)return;
    const labels=res.data.labels, values=res.data.values;
    if(!values.length){container.innerHTML='<div style="text-align:center;color:var(--t3);padding:40px">데이터 없음</div>';return;}
    _renderTrendSvg(container, labels, values);
  }).catch(function(){ container.innerHTML=''; });
}

function _renderTrendSvg(container, labels, values){
  const maxV=Math.max.apply(null,values.concat([1]));
  const w=container.clientWidth||500;
  const h=150;
  const padX=30, padY=20;
  const chartW=w-padX*2, chartH=h-padY*2;
  const step=values.length>1?chartW/(values.length-1):chartW;

  const points=values.map(function(v,i){
    const x=padX+(values.length>1?i*step:chartW/2);
    const y=padY+chartH-(v/maxV)*chartH;
    return x+','+y;
  });

  let svg='<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;height:100%">';
  for(let i=0;i<=4;i++){
    const y=padY+(chartH/4)*i;
    svg+='<line x1="'+padX+'" y1="'+y+'" x2="'+(w-padX)+'" y2="'+y+'" stroke="var(--bdr)" stroke-width="0.5" stroke-dasharray="3,3"/>';
  }
  svg+='<polyline points="'+points.join(' ')+'" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  svg+='<polygon points="'+padX+','+(padY+chartH)+' '+points.join(' ')+' '+(padX+(values.length>1?(values.length-1)*step:chartW/2))+','+(padY+chartH)+'" fill="url(#areaGrad)" opacity="0.15"/>';
  svg+='<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--cyan)"/><stop offset="100%" stop-color="transparent"/></linearGradient></defs>';
  values.forEach(function(v,i){
    const x=padX+(values.length>1?i*step:chartW/2);
    const y2=padY+chartH-(v/maxV)*chartH;
    svg+='<circle cx="'+x+'" cy="'+y2+'" r="3.5" fill="var(--cyan)" stroke="var(--card)" stroke-width="2"/>';
    svg+='<text x="'+x+'" y="'+(y2-8)+'" text-anchor="middle" fill="var(--t2)" font-size="9" font-family="var(--fm)">'+v+'</text>';
    svg+='<text x="'+x+'" y="'+(h-2)+'" text-anchor="middle" fill="var(--t3)" font-size="8.5" font-family="var(--f)">'+(labels[i]||'')+'</text>';
  });
  svg+='</svg>';
  container.innerHTML=svg;
}

/* ── Quick Stats: 백엔드에서 오늘/주간/월간 데이터 일괄 조회 ── */


