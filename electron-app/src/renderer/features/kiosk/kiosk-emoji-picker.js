/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module — 이모티콘 피커 (키오스크 공용) */
import { closeModalGracefully } from '../../core/helpers.js';

const _emojiData=[
  {cat:'😀 표정',items:['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','🤤','😛','😜','🤪','😝','🤑','🤡','🥳','🥺','🥲','😇','🤠','🤥','😈','👿','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😢','😭','😤','😡']},
  {cat:'🏥 의료',items:['🏥','💊','💉','🩹','🩺','🩼','🩻','🧑‍⚕️','👩‍⚕️','👨‍⚕️','🚑','🦠','🧬','🫀','🫁','🧠','🦷','🦴','👁','👀','🤕','🤒','🤢','🤮','🤧','😷','🤠','🩸','🩹','⚕️','🔬','🧪','🌡️','🛏️','♿','🆘','⛑️','🔴','🟢','❤️‍🩹','🫂','🧑‍🦽','🧑‍🦯','🦽','🦯','💆','💇','🧖','🤲','👐','🙌','🤝','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫲','🫱','✋','🖐️']},
  {cat:'🎒 학교',items:['🎒','📚','📖','📝','✏️','📏','📐','🖊️','🖋️','✒️','📌','📎','🔗','📂','📁','🗂️','📊','📈','📉','🧮','🎓','🏫','🧑‍🏫','👩‍🏫','👨‍🏫','🧑‍🎓','👩‍🎓','👨‍🎓','📣','📢','🔔','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛','⏰','⏱️','⏲️','🗓️','📅','📆','🏆','🥇','🥈','🥉','🎯','🎖️','🏅','📋','📑','🗒️','✅','❌','⭐','🌟']},
  {cat:'🍎 음식',items:['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🧃','🥤','☕','🍵','🫖','🥛','🍼','🧊','🍯','🍞','🥐','🧁','🍩','🍪','🍰','🎂','🍫','🍬','🍭','🍿','🥜','🌰','🥚','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌮','🌯','🥗','🥙','🍜','🍝','🍛','🍚','🍙','🍘','🥟','🫕','🥘','🍲']},
  {cat:'🐾 동물',items:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐝','🦋','🐛','🐞','🐜','🪲','🐢','🐍','🦎','🐙','🦀','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🦩','🦚','🦜','🕊️','🐿️','🦔','🐾','🪶','🌸','🌹','🌺','🌻','🌼','🌷','💐','🌿','🍀','🍁','🍂','🍃']},
  {cat:'🚗 교통',items:['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚁','✈️','🛩️','🚀','🛸','🚆','🚇','🚈','🚂','🚉','🛳️','⛴️','🚢','⛵','🛥️','🚤','🛶','🏗️','🏠','🏡','🏘️','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏛️','⛪','🕌','🕍','🛕','🗼','🗽','⛲','🏰','🏯']},
  {cat:'⚽ 활동',items:['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥍','🏑','🥅','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🤸','🤼','🤽','🤾','🏋️','🚴','🚵','🤺','🏊','🤹','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🎸','🎺','🎻','🪘','🪗','🎲','♟️','🎯','🎳','🎮','🎰']},
  {cat:'💡 사물',items:['💡','🔦','🕯️','🔥','💧','🌊','❄️','☃️','⛄','🌈','☀️','🌤️','⛅','🌥️','🌦️','🌧️','⛈️','🌩️','🌪️','🌫️','🌬️','💨','☔','⚡','💻','🖥️','⌨️','🖱️','📱','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏳','⌛','📡','🔋','🔌','💰','💳','💎','🔧','🔨','🪛','🪚','⚙️','🔩','🧲','🪤','🧰','🗝️','🔑','🔒','🔓']},
  {cat:'🌸 자연',items:['🌸','🌹','🌺','🌻','🌼','🌷','💐','🪷','🪹','🌿','☘️','🍀','🍁','🍂','🍃','🌱','🌲','🌳','🌴','🪵','🪨','💎','🌾','🌵','🎋','🎍','🪴','🍄','🐚','🌏','🌍','🌎','🌐','🗺️','🧭','🏔️','⛰️','🗻','🌋','🏝️','🏖️','🏜️','🌅','🌄','🌠','🎆','🎇','🌇','🌆','🏙️','🌃','🌌','🌉','🌁','☁️','🌤️','⛅','🌥️','🌦️','🌧️']},
  {cat:'❤ 기호',items:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','♠️','♣️','♦️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','▶️','◀️','🔼','🔽','⏩','⏪','⏫','⏬','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','✅','❌','❓','❗','‼️','⁉️']}
];

let _emojiPickerCb=null;
let _emojiPickerCat=0;

export function openEmojiPicker(currentEmoji,callback){
  _emojiPickerCb=callback;
  _emojiPickerCat=0;
  const ov=document.createElement('div');
  ov.id='kioskEmojiOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:13500;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center';
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  function renderPicker(){
    const cat=_emojiData[_emojiPickerCat];
    let h='<div style="background:var(--card);border-radius:16px;width:440px;max-width:94vw;box-shadow:0 12px 48px rgba(0,0,0,0.25);overflow:hidden;display:flex;flex-direction:column;max-height:80vh">';
    h+='<div style="padding:14px 18px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;background:var(--bg2)">'
      +'<div style="font-size:13px;font-weight:800;color:var(--t1)">이모티콘 선택</div>'
      +'<button data-action="close-emoji" style="background:none;border:none;font-size:18px;color:var(--t3);cursor:pointer">✕</button></div>';
    h+='<div style="display:flex;gap:2px;padding:8px 12px;overflow-x:auto;border-bottom:1px solid var(--bdr);background:var(--bg2)">';
    _emojiData.forEach(function(c,ci){
      const sel=ci===_emojiPickerCat;
      h+='<button data-emoji-cat="'+ci+'" style="padding:6px 10px;border-radius:8px;border:1.5px solid '+(sel?'var(--cyan)':'transparent')+';background:'+(sel?'rgba(6,182,212,0.1)':'transparent')+';font-size:12px;cursor:pointer;white-space:nowrap;font-family:var(--f);font-weight:'+(sel?'700':'500')+';color:'+(sel?'var(--cyan)':'var(--t2)')+';transition:all .12s">'+c.cat+'</button>';
    });
    h+='</div>';
    h+='<div style="padding:12px;overflow-y:auto;flex:1;min-height:0"><div style="display:grid;grid-template-columns:repeat(10,1fr);gap:4px">';
    cat.items.forEach(function(em){
      h+='<button data-emoji-val="'+em+'" data-emoji-default-border="'+(em===currentEmoji?'var(--cyan)':'var(--bdr)')+'" style="width:100%;aspect-ratio:1;border:1.5px solid '+(em===currentEmoji?'var(--cyan)':'var(--bdr)')+';border-radius:8px;background:'+(em===currentEmoji?'rgba(6,182,212,0.1)':'var(--card)')+';font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .1s;padding:0">'+em+'</button>';
    });
    h+='</div></div>';
    h+='</div>';
    ov.innerHTML=h;
    const closeBtn=ov.querySelector('[data-action="close-emoji"]');
    if(closeBtn)closeBtn.addEventListener('click',function(){closeModalGracefully(ov);});
    ov.querySelectorAll('[data-emoji-cat]').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        _emojiPickerCat=parseInt(this.dataset.emojiCat);
        renderPicker();
      });
    });
    ov.querySelectorAll('[data-emoji-val]').forEach(function(btn){
      btn.addEventListener('mouseenter',function(){this.style.borderColor='var(--cyan)';this.style.transform='scale(1.15)';});
      btn.addEventListener('mouseleave',function(){this.style.borderColor=this.dataset.emojiDefaultBorder;this.style.transform='scale(1)';});
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        if(_emojiPickerCb)_emojiPickerCb(this.dataset.emojiVal);
        closeModalGracefully(ov);
      });
    });
  }
  renderPicker();
  document.body.appendChild(ov);
}
