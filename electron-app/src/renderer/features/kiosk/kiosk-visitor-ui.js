/* Kiosk presentation follows the current program background; no independent slideshow. */
let cachedSource='';
let cachedImage='';
const pendingImages=new Map();

export function getKioskProgramBackground(){
  const body=document.body;
  const isLight=!body||body.classList.contains('light');
  const style=body?getComputedStyle(body):null;
  const background=body?(body.style.backgroundImage||(style&&style.backgroundImage)||''):'';
  const match=/^url\((['"]?)(.*?)\1\)$/.exec(background);
  let source=match?match[2]:'';
  if(!background){
    try{
      const mode=localStorage.getItem('ec_bg_mode')||'selected';
      if(mode==='selected')source='assets/backgrounds/'+encodeURIComponent((localStorage.getItem('ec_bg_selected')||'jeju_by-monet.webp').replace(/\.png$/,'.webp'));
    }catch(_){}
  }
  const color=style&&style.backgroundColor;
  return {source,color:color&&color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'?color:(isLight?'#edf2ef':'#15232c'),isLight};
}

export async function loadKioskProgramBackground(){
  const current=getKioskProgramBackground();
  if(!current.source)return {...current,image:''};
  if(cachedSource===current.source&&cachedImage)return {...current,image:cachedImage};
  if(!pendingImages.has(current.source)){
    const source=current.source;
    const pending=new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const ratio=Math.min(1,1600/img.naturalWidth);
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
          canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
          const ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('Background canvas unavailable');
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          const image=canvas.toDataURL('image/webp',.86);
          cachedSource=source;cachedImage=image;resolve(image);
        }catch(error){reject(error);}
      };
      img.onerror=()=>reject(new Error('Program background image could not be loaded'));
      img.src=source;
    }).finally(()=>pendingImages.delete(source));
    pendingImages.set(source,pending);
  }
  return {...current,image:await pendingImages.get(current.source)};
}

export const KIOSK_VISITOR_CSS=String.raw`
body{--kv-paper:#fff;--kv-soft:#f4f7f6;--kv-ink:#20343c;--kv-muted:#536771;--kv-line:#d9e3e3;--kv-accent:#126e73;--kv-selected:#e9f4f1;--kv-brand:#ed7b28;isolation:isolate;background:var(--kiosk-bg-color,#edf2ef)}
body.program-dark{--kv-paper:#1b2d37;--kv-soft:#233944;--kv-ink:#edf5f6;--kv-muted:#bdcdd2;--kv-line:#49606a;--kv-accent:#82d6cc;--kv-selected:#28494f;--kv-brand:#f7a766}
body::after{background:rgba(242,246,246,.12);backdrop-filter:none;-webkit-backdrop-filter:none;pointer-events:none}
body.program-dark::after{background:rgba(8,20,28,.18)}
.bg-gradient{background:var(--kiosk-bg-color,#edf2ef);animation:none}
.top-bar{min-height:64px;padding:12px 24px;background:var(--kv-paper);border:0;border-bottom:1px solid var(--kv-line);box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;animation:none}
.tb-school{color:var(--kv-ink);font-size:18px;text-shadow:none;letter-spacing:-.3px}
.tb-right{gap:10px}.queue-badge{background:var(--kv-soft);border:1px solid var(--kv-line);color:var(--kv-muted);font-size:14px;padding:7px 12px}
#kioskGearBtn{min-width:44px!important;min-height:44px!important;margin-left:0!important;background:var(--kv-soft)!important;color:var(--kv-ink)!important;border:1px solid var(--kv-line)!important}
.kiosk-split{height:var(--vph,100dvh);min-height:0;padding:88px 24px 24px;gap:20px}
.kiosk-split .kiosk-left{flex:0 0 clamp(240px,26vw,330px);max-width:330px;height:100%;padding:0;border:0;background:none}
.kiosk-left-inner{gap:14px}.kiosk-right{padding:0;min-width:0}
.kiosk-right .screen{max-width:1100px}.kiosk-right #screen-personal,.kiosk-portrait-main #screen-personal{padding:28px}
#screen-personal{background:var(--kv-paper);border:1px solid var(--kv-line);border-radius:20px;box-shadow:0 8px 32px rgba(24,48,54,.08);text-align:left;color:var(--kv-ink);min-height:100%;justify-content:flex-start}
#screen-personal h2{color:var(--kv-ink);font-size:28px;font-weight:800;line-height:1.4;letter-spacing:-.5px;margin:0 0 24px;padding:0;border:0}
#screen-personal .personal-drill{max-width:none;flex:0 0 auto;justify-content:flex-start}
.drill-type-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
#screen-personal .drill-tab{background:var(--kv-soft);border:1px solid var(--kv-line);border-radius:10px;color:var(--kv-muted);min-height:48px;font-size:18px;padding:10px 24px}
#screen-personal .drill-tab.active{background:var(--kv-selected);border-color:var(--kv-accent);color:var(--kv-accent)}
#screen-personal .drill-grade-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;width:100%;margin:0 auto 22px}
#screen-personal .drill-class-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(142px,100%),1fr));gap:12px}
#screen-personal .drill-grade-btn{display:flex;align-items:center;justify-content:center;min-width:0;min-height:88px;border:1px solid var(--kv-line);border-radius:14px;background:var(--kv-soft);color:var(--kv-ink);font-size:26px;font-weight:700;padding:16px 12px;line-height:1.45;white-space:normal;overflow-wrap:anywhere;word-break:keep-all;box-shadow:none;transition:background .14s,border-color .14s}
#screen-personal .is-grade-selected>.drill-type-tabs,#screen-personal .is-grade-selected .drill-grade-grid{display:none}
#screen-personal .drill-class-grid .drill-grade-btn{font-size:22px;min-height:76px}
#screen-personal .drill-grade-btn.active{background:var(--kv-accent);border-color:var(--kv-accent);color:#fff;box-shadow:none}
.program-dark #screen-personal .drill-grade-btn.active{color:#142a32}
#screen-personal button:hover,#screen-personal button:focus-visible{border-color:var(--kv-accent);outline:2px solid var(--kv-accent);outline-offset:2px;transform:none;box-shadow:none}
#screen-personal .drill-selection-bar,#screen-personal .drill-class-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 0 16px;margin:0 0 16px;border-bottom:1px solid var(--kv-line);color:var(--kv-muted);font-size:18px;line-height:1.5}
#screen-personal .drill-class-heading small{font-size:15px;color:var(--kv-muted);font-weight:500;margin-left:10px;white-space:nowrap}
#screen-personal .drill-roster-panel{padding:0;background:none;border:0}
#screen-personal .back-btn{min-height:46px;min-width:0;margin:0;padding:10px 14px;background:var(--kv-soft);border:1px solid var(--kv-line);border-radius:10px;color:var(--kv-accent);font-size:16px;line-height:1.4;white-space:normal;word-break:keep-all}
#screen-personal .drill-student-grid,#screen-personal .drill-staff-grid{grid-template-columns:repeat(auto-fit,minmax(min(152px,100%),1fr));gap:12px}
#screen-personal .drill-sel-chip{flex-direction:row;align-items:center;justify-content:flex-start;gap:12px;min-height:82px;padding:16px 14px;background:var(--kv-paper);border:1px solid var(--kv-line);border-radius:12px;color:var(--kv-ink);text-align:left;font-size:24px;box-shadow:none;transition:background .14s,border-color .14s}
#screen-personal .drill-sel-chip:hover{background:var(--kv-selected)}
#screen-personal .drill-person-name{width:auto;flex:1;min-width:0;line-height:1.45;letter-spacing:-.4px}
#screen-personal .drill-person-meta{font-size:15px;color:var(--kv-muted);flex:0 0 auto;max-width:100%}
#screen-personal .drill-staff-grid .drill-sel-chip{flex-direction:column;align-items:flex-start;gap:4px}
#screen-personal .kiosk-roster-state{color:var(--kv-muted)}#screen-personal .kiosk-roster-state strong{color:var(--kv-ink)}
.queue-card,.kiosk-guide{background:var(--kv-paper);border:1px solid var(--kv-line);border-radius:16px;box-shadow:none}
.queue-card{padding:16px;gap:10px}.queue-card-left{border-color:var(--kv-line)}.queue-card-label,.queue-card-unit{color:var(--kv-muted);font-size:15px}.queue-card-num{font-size:34px;color:var(--kv-accent)}
.queue-card-right .q-empty{font-size:15px;color:var(--kv-muted)}.queue-person{background:var(--kv-soft);border:1px solid var(--kv-line)}.queue-person-name{color:var(--kv-accent);font-size:23px}.queue-person-info,.queue-more{color:var(--kv-muted)}
.kiosk-guide>summary{min-height:52px;font-size:17px;color:var(--kv-ink);padding:14px 16px}
.kiosk-guide .rules-card{background:var(--kv-paper);padding:8px 16px 16px}.rules-title{font-size:17px;color:var(--kv-ink);justify-content:flex-start}.rules-section-title{font-size:16px;color:var(--kv-accent)}.rules-ul li{font-size:15px;color:var(--kv-muted)}.rules-ul li.sub{font-size:14px;color:var(--kv-muted)}.rules-highlight{color:var(--kv-muted);background:var(--kv-soft);border-color:var(--kv-line);font-size:14px}
.left-lang-sel{padding:14px 12px;background:var(--kv-paper);border:1px solid var(--kv-line);border-radius:16px;gap:10px}.lang-sel-label{background:none;border:0;color:var(--kv-muted);font-size:13px;padding:0}.lang-sel-grid{max-width:none;gap:8px}.lang-btn{box-shadow:none;background:var(--kv-soft);border:1px solid var(--kv-line);border-radius:10px}.lang-btn.active{background:var(--kv-selected);border-color:var(--kv-accent);box-shadow:none}.lang-btn:hover{transform:none;background:var(--kv-selected);border-color:var(--kv-accent)}
.kiosk-portrait{padding:84px 20px 18px;gap:14px;height:var(--vph,100dvh);min-height:0}.kiosk-portrait-queue{padding:0}.kiosk-portrait-main{padding:0;min-height:0}.kiosk-portrait-footer{padding:0}.kiosk-portrait-footer .left-lang-sel{max-width:none;flex-direction:row;flex-wrap:wrap;justify-content:center;padding:10px 14px}.kiosk-portrait-footer .lang-sel-grid{width:auto}
@media(max-width:1050px){.kiosk-split{padding:82px 16px 16px;gap:14px}.kiosk-split .kiosk-left{flex-basis:240px;max-width:240px}.kiosk-right #screen-personal,.kiosk-portrait-main #screen-personal{padding:22px}}
@media(max-width:768px) and (orientation:portrait){.top-bar{min-height:64px;padding:10px 12px;position:relative}.tb-school{min-width:0;font-size:16px;gap:6px;flex-wrap:wrap}.tb-right{gap:6px}.queue-badge{font-size:12px;padding:6px 8px}.kiosk-portrait{padding:12px;gap:12px;flex:1 1 auto;min-height:0;height:auto}.kiosk-split{height:auto;min-height:0;padding:12px;gap:12px}.kiosk-split .kiosk-left{flex:none;max-width:100%;height:auto}.kiosk-right{height:auto;min-height:360px}.kiosk-portrait-footer .left-lang-sel{padding:8px}.kiosk-portrait-footer .lang-sel-grid{gap:6px}.kiosk-portrait-footer .lang-btn{width:44px;min-width:44px;height:44px;min-height:44px;flex-basis:44px}.kiosk-portrait-queue .queue-card-right{max-height:88px}.kiosk-portrait-queue .queue-card{padding:10px 14px}.kiosk-portrait-queue .queue-card-num{font-size:28px}.kiosk-right #screen-personal,.kiosk-portrait-main #screen-personal{padding:18px;border-radius:16px}#screen-personal h2{font-size:24px;margin-bottom:20px;padding-bottom:0}}
@media(max-width:480px){.tb-right .queue-badge{display:none}#screen-personal .drill-grade-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#screen-personal .drill-grade-btn{font-size:24px;min-height:72px}#screen-personal .drill-student-grid,#screen-personal .drill-staff-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#screen-personal .drill-sel-chip{font-size:22px;min-height:78px;padding:12px 10px;gap:6px;flex-direction:column;align-items:flex-start}#screen-personal .drill-person-meta{font-size:14px}#screen-personal .drill-selection-bar,#screen-personal .drill-class-heading{font-size:18px;gap:8px}#screen-personal .back-btn{font-size:15px}#screen-personal .drill-class-heading small{margin-left:6px;font-size:14px}}
@media(orientation:landscape) and (max-height:520px){.top-bar{padding:6px 12px;min-height:56px}.kiosk-split{padding:68px 12px 12px;gap:12px}.kiosk-split .kiosk-left{padding:0;flex-basis:220px;max-width:220px}.kiosk-right #screen-personal{padding:18px}#screen-personal h2{font-size:24px;margin-bottom:18px;padding-bottom:0}}
@media(prefers-reduced-motion:reduce){#screen-personal button{transition:none}}
`;
