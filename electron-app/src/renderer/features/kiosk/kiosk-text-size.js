/* Scale text, not the viewport: touch targets and scrollable layouts stay intact. */
export function normalizeKioskTextScale(value){
  const scale=Number(value);
  return scale===125 || scale===150 ? scale : 100;
}

export function scaleKioskTextCss(css,value){
  const scale=normalizeKioskTextScale(value)/100;
  if(scale===1) return css;
  return css.replace(/(font-size\s*:\s*)([^;}]+)/g,function(_,prefix,size){
    return prefix+size.replace(/(\d*\.?\d+)(px|vw|vh|rem|em)\b/g,function(__,number,unit){
      return String(Math.round(Number(number)*scale*1000)/1000)+unit;
    });
  });
}

export function kioskTextSizeSettingsHtml(settings){
  const scale=normalizeKioskTextScale(settings.textScale);
  return '<div class="kiosk-call-guide" style="flex-wrap:wrap;gap:14px">'
    +'<div class="kiosk-call-guide-copy"><label for="kioskTextScale" class="kiosk-call-guide-title">키오스크 글자 크기</label>'
    +'<p>이름 선택, 안내와 대기 명단의 글자를 조절합니다. 기본 크기는 기존과 같습니다.<br>변경 후 키오스크 화면을 다시 생성하고, 사용 중인 기기에서 새로고침해 주세요.</p></div>'
    +'<select id="kioskTextScale" data-action="kiosk-text-scale" style="min-height:44px;max-width:100%;padding:8px 12px;border:1px solid var(--bdr);border-radius:10px;background:var(--card);color:var(--t1)" aria-describedby="kioskTextScalePreview">'
    +[100,125,150].map(function(value){return '<option value="'+value+'"'+(scale===value?' selected':'')+'>'+(value===100?'기본':value===125?'크게':'더 크게')+' ('+value+'%)</option>';}).join('')
    +'</select><div id="kioskTextScalePreview" style="width:100%;padding:12px;border:1px solid var(--bdr);border-radius:10px;background:var(--bg2);color:var(--t1);font-size:'+18*scale/100+'px;line-height:1.6;overflow-wrap:anywhere">이름을 선택해 주세요 · 대기 중 3명</div></div>';
}
