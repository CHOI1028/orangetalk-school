export const infectiousDetailStyles = `
#infectOverlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.4);z-index:13050;color:var(--t1)}
#infectBox{--if-orange:#cb5424;--if-soft:rgba(229,111,51,.08);background:var(--card,#fff);border:1px solid var(--bdr,#ddd);border-radius:18px;width:1120px;max-width:95vw;height:820px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px #0003;overflow:hidden;font-size:14px;font-family:var(--f,sans-serif)}
#infectBox *{box-sizing:border-box}#infectBox header{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;padding:21px 26px;gap:12px;border-bottom:1px solid var(--bdr)}
#infectBox h2{margin:0;font-size:21px;letter-spacing:-.5px}#infectBox h3{font-size:21px;margin:8px 0;line-height:1.45;overflow-wrap:anywhere}#infectBox h4{font-size:14px;margin:0 0 12px}#infectBox p{margin:8px 0;line-height:1.65}
#infectBox button,#infectBox input,#infectBox select{font:inherit;color:var(--t1);border:1px solid var(--bdr,#ddd);border-radius:8px;background:var(--card,#fff);padding:9px 12px;min-height:38px}
#infectBox button{cursor:pointer}#infectBox button:hover:not(:disabled){border-color:var(--if-orange);background:var(--if-soft)}#infectBox button:disabled{opacity:.45;cursor:default}#infectBox :focus-visible{outline:2px solid #e76732;outline-offset:2px}#infectBox a{color:var(--if-orange);text-decoration:none}#infectBox a:hover{text-decoration:underline}
#infectBox .if-tabs{flex-shrink:0;display:flex;padding:7px 22px;background:var(--bg2,#f6f7f9);gap:5px;border-bottom:1px solid var(--bdr)}#infectBox .if-tabs button{flex:1;border:1px solid transparent;padding:9px 4px;background:transparent;color:var(--t2);font-size:13px}
#infectBox .if-tabs button[aria-pressed=true]{border-color:var(--bdr);background:var(--card,#fff);color:var(--if-orange);font-weight:800;box-shadow:0 1px 3px #0001}
#infectCtrl{flex-shrink:0;padding:12px 26px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;border-bottom:1px solid var(--bdr)}#infectCtrl[hidden]{display:none}#infectCtrl select{min-width:98px}
#infectBody{padding:22px 26px;overflow-y:auto;flex:1;min-height:0;color:var(--t2);scrollbar-gutter:stable}#infectBox .if-note{background:var(--bg2,#f6f7f9);border-radius:8px;padding:10px 14px;line-height:1.6;margin:12px 0}
#infectBox .if-search{display:flex;gap:12px;align-items:end}#infectBox label{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:600}#infectBox .if-search label:first-child{flex:1}#infectBox input{min-width:0}#infectBox input,#infectBox select{font-weight:400}
#infectBox .if-muted,#infectBox .if-source-title{font-size:12px;color:var(--t3);line-height:1.6}#infectBox .if-source-title{margin-top:16px}#infectBox .if-eyebrow{font-size:11px;color:var(--t3);font-weight:500}
#infectBox .if-guide-grid{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(0,2fr);gap:20px;align-items:start;margin-top:14px}#infectBox .if-guide-grid.is-single{grid-template-columns:1fr}#infectBox .if-guide-sidebar[hidden]{display:none}
#infectBox .if-results{max-height:350px;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:3px}#infectBox .if-results button{flex:0 0 auto;display:block;height:auto;min-width:0;white-space:normal;text-align:left;line-height:1.6;padding:11px 13px;overflow-wrap:anywhere}#infectBox .if-results strong{display:block}#infectBox .if-results span{display:block;font-size:11px;color:var(--t3)}
#infectBox .if-results button[aria-pressed=true]{border-color:#e77740;background:var(--if-soft)}#infectBox .if-detail-card{padding:22px;border:1px solid var(--bdr);border-radius:12px;line-height:1.7}
#infectBox .if-badge{display:inline-block;flex-shrink:0;font-size:11px;font-weight:700;color:var(--if-orange);background:var(--if-soft);padding:4px 9px;border-radius:6px}#infectBox .if-code{font-size:12px;color:var(--t3);overflow-wrap:anywhere}
#infectBox .if-guide-sections{display:grid;grid-template-columns:1fr;gap:20px;border-top:1px solid var(--bdr);padding-top:18px;margin-top:18px}#infectBox .is-single .if-guide-sections{grid-template-columns:1fr;gap:14px}
#infectBox .if-guidance{background:var(--bg2,#f6f7f9);padding:16px;border-radius:10px;font-size:14px;line-height:1.8;margin:0}#infectBox .if-checklist{list-style:none;padding:0;margin:0;display:grid;gap:9px}#infectBox .if-checklist li{padding-left:19px;position:relative}#infectBox .if-checklist li:before{content:'•';position:absolute;left:2px;color:var(--if-orange)}
#infectBox .if-guide-actions{display:flex;align-items:center;gap:18px;border-top:1px solid var(--bdr);margin-top:20px;padding-top:16px;flex-wrap:wrap}#infectBox .if-guide-actions a{font-weight:700;font-size:13px}#infectBox .if-empty{padding:50px 20px;text-align:center;color:var(--t3);line-height:1.8}
#infectBox .if-apply{border:1px solid var(--bdr);border-radius:10px;padding:16px;margin-top:14px;font-size:12px}#infectBox .if-replace{display:flex;flex-direction:row;align-items:flex-start;margin:14px 0;font-weight:400;line-height:1.65}#infectBox .if-replace input{min-height:0;margin:4px 0 0;flex-shrink:0}#infectBox .if-primary{background:var(--if-orange);color:#fff;border-color:var(--if-orange);font-weight:700}#infectBox .if-primary:hover:not(:disabled){background:#b5451a;color:white}
#infectBox .if-context{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}#infectBox .if-context h3{font-size:17px;margin:3px 0}#infectBox .if-stat-tools{display:flex;align-items:end;flex-wrap:wrap;gap:10px;margin:14px 0 18px}#infectBox .if-stat-tools label{flex:1;min-width:150px}#infectBox .if-pager{display:flex;justify-content:center;align-items:center;gap:12px;margin-top:16px;font-size:12px}
#infectBox .if-stat-summary{font-size:12px;margin:12px 0;display:flex;gap:12px;justify-content:space-between}#infectBox .if-table-wrap{overflow:auto;border:1px solid var(--bdr);border-radius:10px}
#infectBox .if-data-table,#infectBox .if-age-table{width:100%;border-collapse:collapse;font-size:13px;color:var(--t1)}#infectBox .if-data-table th,#infectBox .if-age-table th{padding:11px 14px;background:var(--bg2,#f5f6f8);font-weight:600;color:var(--t3);font-size:12px;text-align:left}
#infectBox .if-data-table td,#infectBox .if-age-table td{padding:11px 14px;border-top:1px solid var(--bdr);text-align:left}#infectBox .if-data-table :is(th,td):last-child,#infectBox .if-age-table :is(th,td):last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
#infectBox .if-data-table tbody tr:hover{background:var(--if-soft)}#infectBox .if-data-table td:last-child{font-weight:700}#infectBox .if-table-wrap button{min-height:0;display:block;width:100%;padding:0;border:0;background:none;text-align:left;font-size:13px;line-height:1.7}#infectBox .if-table-wrap button:after{content:'›';padding-left:12px;color:var(--t3)}#infectBox .if-table-wrap button:hover{color:var(--if-orange);background:none}
#infectBox .if-age-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;align-items:start}#infectBox .if-age-picker{display:flex;flex-direction:column;gap:18px;border:1px solid var(--bdr);border-radius:12px;padding:18px}#infectBox .if-age-picker select{width:100%;min-width:0}#infectBox #ifAgeChart{min-width:0}
#infectBox .if-chart-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}#infectBox .if-chart-heading h3{margin:0;font-size:20px}#infectBox .if-chart-heading button{flex-shrink:0;font-size:12px}
#infectBox .if-metrics{display:grid;grid-template-columns:1fr 1.5fr 1fr;background:var(--bg2,#f6f7f9);border-radius:12px;margin-bottom:20px}#infectBox .if-metrics>div{padding:16px;border-right:1px solid var(--bdr)}#infectBox .if-metrics>div:last-child{border:0}#infectBox .if-metrics span{display:block;color:var(--t3);font-size:11px;margin-bottom:8px}#infectBox .if-metrics strong{font-size:21px;line-height:1.4;color:var(--t1)}#infectBox .if-metrics small{font-size:12px;font-weight:400}
#infectBox .if-chart-legend{display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:8px}#infectBox .if-bars{max-height:340px;overflow:auto;padding-right:6px}#infectBox .if-bar-row{display:grid;grid-template-columns:78px minmax(0,1fr) 100px;gap:12px;align-items:center;min-height:34px;font-size:13px}
#infectBox .if-bar-label{white-space:nowrap;font-variant-numeric:tabular-nums}#infectBox .if-bar-track{height:15px;border-radius:4px;overflow:hidden;background:var(--bg2,#f2f4f7)}#infectBox .if-bar-track i{display:block;height:100%;border-radius:4px;background:#edba9d}#infectBox .is-peak .if-bar-track i{background:#e87539}#infectBox .if-bar-value{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}#infectBox .if-bar-value small{display:inline-block;width:44px;font-size:10px;font-weight:400;color:var(--t3);margin-left:6px}
#infectBox .if-source-note{border-top:1px solid var(--bdr);margin-top:18px;padding-top:12px;font-size:12px;color:var(--t3)}#infectBox .if-source-note summary{cursor:pointer}#infectBox .if-source-note table{margin-top:12px}#infectBox .if-guide-sections.is-unavailable{grid-template-columns:1fr}
#infectBox #ifPeriodChart{min-width:0}#infectBox .if-period-bars{max-height:340px;overflow:auto;padding-right:6px}#infectBox .if-period-bars .if-bar-row{grid-template-columns:108px minmax(0,1fr) 80px;min-height:24px}#infectBox .if-period-bars .if-bar-label{white-space:normal;overflow-wrap:anywhere;font-size:12px}
#infectBox #ifStatResults{min-width:0}#infectBox .if-region-bars{max-height:360px;overflow:auto;padding-right:6px}#infectBox .if-region-bars .if-bar-row{grid-template-columns:minmax(120px,1fr) minmax(0,1.3fr) 85px;min-height:40px}#infectBox .if-region-bars button{min-height:0;padding:6px 0;border:0;background:none;text-align:left;font-size:12px;line-height:1.5;overflow-wrap:anywhere}#infectBox .if-region-bars button:hover{color:var(--if-orange);background:none}
/* Shared OrangeTalk surfaces: cream headings, white cards, teal actions. */
#infectBox{--if-orange:#0f766e;--if-soft:rgba(15,118,110,.07);--if-bar:#9dbfce;--if-peak:#2186a0;border-radius:var(--school-card-radius,16px);background:var(--card,#fff);font-size:13px}
#infectBox header{padding:15px 20px;background:color-mix(in srgb,var(--card,#fff) 90%,#f6d69d);border-bottom:1px solid var(--bdr)}
#infectBox h2{font-size:18px;letter-spacing:-.3px}#infectBox h3{font-size:19px}
#infectBox button,#infectBox input,#infectBox select{min-height:34px;padding:7px 11px;border-radius:var(--school-control-radius,9px);font-size:12px;line-height:1.45}
#infectBox button{font-weight:600}#infectBox #infectClose{min-height:32px;padding:5px 12px;font-weight:500}
#infectBox .if-tabs{padding:12px 20px;gap:8px;background:var(--card,#fff)}
#infectBox .if-tabs button{min-height:36px;padding:8px 12px;background:var(--card,#fff);border:1px solid var(--bdr);border-radius:9px;color:var(--t2);font-size:13px;font-weight:600;box-shadow:none}
#infectBox .if-tabs button:before{content:none}
#infectBox .if-tabs button[aria-pressed=true]{background:color-mix(in srgb,var(--card,#fff) 88%,#97d6c6);border:1px solid #8fc8bb;color:var(--if-orange);box-shadow:0 2px 4px #163a3310;font-weight:700}
#infectCtrl{padding:12px 20px;background:var(--card,#fff)}#infectBody{padding:20px}
#infectBox .if-age-layout{gap:20px;grid-template-columns:220px minmax(0,1fr)}
#infectBox .if-age-picker{gap:14px;padding:16px;border:1px solid var(--bdr);border-radius:12px;background:color-mix(in srgb,var(--card,#fff) 96%,#b7dbe2);box-shadow:0 2px 8px #1d3a4410}
#infectBox .if-age-picker>button{align-self:flex-start;min-height:32px;padding:6px 10px;background:var(--card,#fff);font-size:12px}
#infectBox .if-metrics{gap:10px;background:transparent;border-radius:0}
#infectBox .if-metrics>div{border:1px solid var(--bdr);border-radius:10px;background:color-mix(in srgb,var(--card,#fff) 91%,#b4dce5);padding:13px 15px}
#infectBox .if-metrics>div:nth-child(2){background:color-mix(in srgb,var(--card,#fff) 88%,#bce1d5)}
#infectBox .if-metrics>div:nth-child(3){background:color-mix(in srgb,var(--card,#fff) 86%,#f5dfae);border:1px solid var(--bdr)}
#infectBox .if-metrics strong{color:var(--t1);font-size:20px}#infectBox .if-metrics span{margin-bottom:7px}
#infectBox .if-bar-track{background:color-mix(in srgb,var(--card,#fff) 65%,var(--bg2,#e6eef1));height:12px;border-radius:4px}
#infectBox .if-bar-track i{background:var(--if-bar);border-radius:4px}
#infectBox .is-peak .if-bar-track i{background:var(--if-peak)}
#infectBox .if-primary{background:#216b58;border-color:#216b58;color:white;padding:7px 14px;font-size:12px;box-shadow:0 2px 4px #163a3315}
#infectBox .if-primary:hover:not(:disabled){background:#185544;border-color:#185544}
#infectBox .if-results button{min-height:0;padding:10px 12px;font-weight:400}
#infectBox .if-results button[aria-pressed=true]{border-color:#96cbbc;background:color-mix(in srgb,var(--card,#fff) 88%,#bce1d5)}
#infectBox .if-detail-card{padding:20px;border-radius:12px}
#infectBox .if-guidance{background:color-mix(in srgb,var(--card,#fff) 86%,#f6dfb3);border:1px solid var(--bdr);font-size:13px;padding:14px}
#infectBox .if-checklist{background:color-mix(in srgb,var(--card,#fff) 91%,#b9dbe6);border:1px solid var(--bdr);border-radius:10px;padding:14px}
#infectBox .if-checklist li:before{color:var(--if-orange)}
#infectBox .if-apply{background:color-mix(in srgb,var(--card,#fff) 92%,#c7e5d8);border:1px solid var(--bdr)}
#infectBox .if-guide-actions{gap:12px}#infectBox .if-guide-actions a{font-size:12px}
#infectBox .if-disease-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
#infectBox .if-report{font-size:12px;font-weight:700;color:var(--t2)}
#infectBox a.if-more,#infectBox a.if-quiet{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:7px 14px;border-radius:9px;font-weight:700;text-decoration:none}
#infectBox a.if-more{background:#216b58;color:#fff}
#infectBox a.if-more:hover{background:#185544;color:#fff;text-decoration:none}
#infectBox a.if-quiet{border:1px solid var(--bdr);background:var(--card,#fff);color:var(--t1)}
#infectBox a.if-quiet:hover{border-color:var(--if-orange);background:var(--if-soft);color:var(--t1);text-decoration:none}
#infectBox .if-facts{margin:12px 0 4px}#infectBox .if-facts strong{font-size:16px;overflow-wrap:break-word}
#infectBox .if-subhead{margin-top:14px}#infectBox .if-disclaimer{margin:12px 0 0}
#infectBox .if-insight{margin:0 0 12px;padding:8px 12px;border-radius:8px;background:var(--if-soft);color:var(--t2);font-size:12px;line-height:1.6}
#infectBox .if-bar-track i.is-on{min-width:6px}
#infectBox .if-region-bars button,#infectBox .if-table-wrap button{min-height:0;padding:5px 0;border:0;border-radius:0;font-weight:500;background:none}
/* Keep chart content independent of surrounding workspace layout. */
#infectBody{padding:16px 20px;display:block}
#infectBox .if-context{margin:0 0 12px;gap:8px}
#infectBox .if-context>div{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
#infectBox .if-context h3{margin:0;font-size:15px}
#infectBox .if-age-layout{display:flex;flex-direction:column;gap:14px;align-items:stretch}
#infectBox .if-age-picker{display:flex;flex-direction:row;align-items:flex-end;gap:12px;padding:12px 14px;box-shadow:none;border-radius:10px}
#infectBox .if-age-picker label{flex:1;max-width:300px;min-width:0;gap:5px}
#infectBox .if-age-picker>button{align-self:flex-end}
#infectBox .if-age-picker p{margin:0 0 7px auto;font-size:11px}
#infectBox :is(#ifAgeChart,#ifPeriodChart,#ifStatResults){display:block;position:static;margin:0;padding:0;min-height:0;width:100%;align-self:stretch}
#infectBox .if-chart-heading{margin:0 0 10px;padding:0;min-height:34px}
#infectBox .if-chart-heading h3{margin:0;font-size:18px}
#infectBox .if-metrics{margin:0 0 14px;grid-template-columns:1fr 1.4fr 1fr;gap:8px}
#infectBox .if-metrics>div{padding:10px 14px}
#infectBox .if-metrics span{margin-bottom:4px}
#infectBox .if-metrics strong{font-size:19px}
#infectBox .if-bar-row{min-height:30px;color:var(--t2)}
#infectBox .if-region-bars{max-height:420px}
#infectBox .if-region-bars .if-bar-row{min-height:32px;grid-template-columns:minmax(180px,1fr) minmax(0,2fr) 90px}
#infectBox .if-bar-value{white-space:nowrap}
#infectBox .if-pager{margin-top:10px;gap:10px}
#infectBox .if-source-note{margin-top:12px;padding-top:10px}
#infectBox .if-guide-grid{gap:16px;margin-top:10px}
#infectBox .if-detail-card{padding:16px}
#infectBox .if-guide-sections{gap:14px;margin-top:12px;padding-top:12px}
#infectBox .if-guide-actions{margin-top:16px;padding-top:14px;border-top:1px solid var(--bdr)}
#infectBox input::placeholder{color:var(--t3);opacity:1}
#infectBox :focus-visible{outline-color:var(--if-peak)}
body:not(.light) #infectBox{--if-orange:#7ddbc7;--if-soft:rgba(125,219,199,.1);--if-bar:#80b9cd;--if-peak:#45c6cd;--t3:#b2c1d1;color-scheme:dark}
body:not(.light) #infectBox .if-bar-track{background:#2c3c50}
body:not(.light) #infectBox .if-tabs button[aria-pressed=true],body:not(.light) #infectBox .if-results button[aria-pressed=true]{border-color:#548f83}
body:not(.light) #infectBox .if-primary{background:#246f5e;border-color:#58a693;color:#fff}
body:not(.light) #infectBox .if-primary:hover:not(:disabled){background:#2b806c}
body:not(.light) #infectBox a.if-more{background:#246f5e;color:#fff}
body:not(.light) #infectBox a.if-more:hover{background:#2b806c;color:#fff}
body:not(.light) #infectBox a.if-quiet{background:#243246;color:#e8eef6;border-color:#4d6278}
body.light #infectBox{color-scheme:light}
@media(max-width:800px){#infectBox .if-guide-grid{grid-template-columns:1fr}#infectBox .if-results{max-height:160px}#infectBox .if-age-picker{flex-wrap:wrap}#infectBox .if-age-picker label{max-width:none}#infectBox .if-age-picker p{flex-basis:100%;margin:0}#infectBox .is-single .if-guide-sections{grid-template-columns:1fr;gap:14px}}
@media(max-width:520px){#infectBox header,#infectBody,#infectCtrl{padding:12px}#infectBox h2{font-size:17px}#infectBox .if-tabs{padding:6px;gap:3px}#infectBox .if-tabs button{padding:7px 4px;font-size:11px}#infectBox .if-detail-card{padding:12px}#infectBox .if-metrics>div{padding:9px 8px}#infectBox .if-metrics strong{font-size:16px}#infectBox .if-bar-row{grid-template-columns:65px minmax(0,1fr) 96px;gap:6px;font-size:12px}#infectBox .if-period-bars .if-bar-row{grid-template-columns:94px minmax(0,1fr) 64px}#infectBox .if-region-bars .if-bar-row{grid-template-columns:minmax(100px,1fr) minmax(0,1fr) 68px}#infectBox .if-chart-heading h3{font-size:17px}#infectBox .if-age-picker{padding:10px;gap:10px}#infectBox .if-context>div{gap:4px}#infectBox .if-context h3{font-size:14px}}
#infectBox[data-view=guide] #infectBody{display:flex;flex-direction:column;overflow:hidden;flex:1 1 auto;min-height:0}
#infectBox[data-view=guide] :is(.if-search,#ifGuideCount,.if-source-title){flex:0 0 auto}
#infectBox[data-view=guide] #ifGuideCount{margin:4px 0}
#infectBox[data-view=guide] .if-guide-grid{flex:1 1 auto;min-height:0;align-items:stretch;grid-template-rows:minmax(0,1fr)}
#infectBox[data-view=guide] .if-guide-sidebar{min-height:0;height:100%;display:flex;flex-direction:column;overflow:hidden}
#infectBox[data-view=guide] .if-guide-sidebar[hidden]{display:none}
#infectBox[data-view=guide] .if-results{flex:1 1 auto;min-height:0;max-height:none;overflow:auto}
#infectBox[data-view=guide] #ifGuideDetail{position:relative;min-height:0;height:100%;overflow:hidden}
#infectBox[data-view=guide] .if-detail-card{position:absolute;top:0;left:0;right:0;height:100%;bottom:auto;min-height:0;overflow:auto}
#infectBox[data-view=guide] .if-source-title{margin-top:10px;margin-bottom:0}
@media(max-width:800px){#infectBox[data-view=guide] #infectBody{overflow:auto}#infectBox[data-view=guide] .if-guide-grid{flex:0 1 auto;grid-template-rows:auto}#infectBox[data-view=guide] .if-guide-sidebar{height:auto;overflow:visible}#infectBox[data-view=guide] .if-results{flex:0 1 auto;max-height:160px;height:auto}#infectBox[data-view=guide] #ifGuideDetail{position:static;height:auto;overflow:visible}#infectBox[data-view=guide] .if-detail-card{position:static;inset:auto;height:auto;overflow:visible}}
`;
