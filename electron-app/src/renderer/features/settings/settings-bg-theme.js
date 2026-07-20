/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ES Module */
import { renderSettingsPanel } from './settings-view.js';
import { S } from '../../core/app-state.js';
import { _autoHeaderTextColor, applyHeaderGlass, applyFooterGlass } from '../shell/theme-manager.js';

/* ═══ BACKGROUND IMAGE SETTINGS ═══ */
export const BG_IMAGES = [
  {file:'A table with flowers and fruit.webp', title:'꽃과 과일이 있는 테이블'},
  {file:'village_of_cats.webp', title:'고양이가 사는 마을'},
  {file:'poppy_field_at_sunrise.webp', title:'해뜨는 양귀비밭'},
  {file:'table_full_of_food.webp', title:'반 고흐 스타일의 음식이 있는 식탁'},
  {file:'sick_woman_in_renoir_style.webp', title:'르누아르 스타일의 아픈 여인'},
  {file:'ambulances_on_the_street.webp', title:'거리의 앰뷸런스'},
  {file:'classroom_in_session.webp', title:'수업 중인 교실'},
  {file:'poppies_in_georgia_okeeffe_style.webp', title:'조지아 오키프 스타일의 양귀비'},
  {file:'covid-hit_europe.webp', title:'코로나19가 퍼진 유럽'},
  {file:'jeju_by-monet.webp', title:'모네 스타일의 제주도'},
  {file:'students going school.webp', title:'폴 시낙 스타일의 학교가는 아이들'},
  {file:'the_starry_night_reimagined.webp', title:'반 고흐 스타일의 별밤'},
  {file:'21st_century_classroom.webp', title:'르누아르 스타일의 21세기 교실'},
  {file:'colorful.webp', title:'마르크 샤갈 스타일의 저녁 마을 풍경'},
  {file:'fruits_and_flowers_on_the_table.webp', title:'반 고흐 스타일의 정물화'},
  {file:'a_tree_on_the_hill.webp', title:'언덕 위의 나무'}
];
/* 단색 이미지 — 라이트/다크 모드별로 분리. body.light 여부에 따라 갤러리·실제 배경이 자동 전환. */
export const SOLID_IMAGES_DARK = [
  {file:'solid_color_background_1.png', title:'딥 틸'},        /* 어두운 청록 네이비 */
  {file:'solid_color_background_2.png', title:'스틸 그레이'},   /* 저채도 연회색 */
  {file:'solid_color_background_3.png', title:'퓨어 화이트'},   /* 거의 흰색 */
  {file:'solid_color_background_4.png', title:'라이트 그린'},   /* 연한 연두 */
  {file:'solid_color_background_5.png', title:'파스텔 블루'},   /* 옅은 하늘색 */
  {file:'solid_color_background_7.png', title:'딥 바이올렛'}   /* 짙은 보라 네이비 (신규) */
];
export const SOLID_IMAGES_LIGHT = [
  {file:'solid_light_1.png', title:'슬레이트 화이트'},  /* #F8FAFC */
  {file:'solid_light_2.png', title:'쿨 그레이'},       /* #F1F5F9 */
  {file:'solid_light_3.png', title:'아이스 블루'},     /* #EFF6FF */
  {file:'solid_light_4.png', title:'웜 베이지'},       /* #FFF7ED */
  {file:'solid_light_5.png', title:'블러시 핑크'},     /* #FDF2F8 */
  {file:'solid_light_6.png', title:'슬레이트 그레이'}, /* 저채도 연회색 #94A3B8 */
  {file:'solid_light_7.png', title:'세이지 그린'},     /* 연한 연두 */
  {file:'solid_light_8.png', title:'스카이 블루'}      /* 옅은 하늘색 */
];
/* 호환성 — 기존 SOLID_IMAGES import 코드 보호용 (현재 모드 기준 반환) */
export function getSolidImages(){
  return document.body.classList.contains('light') ? SOLID_IMAGES_LIGHT : SOLID_IMAGES_DARK;
}
export const SOLID_IMAGES = SOLID_IMAGES_DARK;
let _bgMode='selected'; // 'solid' | 'selected' | 'random' | 'custom'

/* 사용자 업로드 배경 이미지의 dataURL 인메모리 캐시.
 * file:// 직접 참조는 Electron webSecurity / CSP default-src 'self' 결합으로 차단되어
 * 검은 화면으로 나오는 사례가 있어 메인 프로세스에서 base64 dataURL 을 받아 사용한다.
 * localStorage 에 base64 를 다시 저장하지 않고 모듈 메모리에만 둬서 LS 부담 0. */
let _customBgDataUrlCache=null;

async function _loadCustomBgDataUrl(){
  if(!(window.electronAPI&&window.electronAPI.userBgGetDataUrl))return;
  try{
    const res=await window.electronAPI.userBgGetDataUrl();
    if(res&&res.success&&res.dataUrl){_customBgDataUrlCache=res.dataUrl;}
    else{_customBgDataUrlCache=null;}
  }catch(e){console.warn('[bg] dataUrl 로드 실패',e);}
}

function _customBgUrl(){
  /* 1순위: 메모리 캐시(부팅 시 IPC 로 채워짐 / 업로드 직후 새로 채워짐) */
  if(_customBgDataUrlCache)return _customBgDataUrlCache;
  /* 2순위: 레거시 Base64 (이전 버전에서 localStorage 에 박혀 있던 값) */
  const legacy=localStorage.getItem('ec_bg_custom')||'';
  if(legacy)return legacy;
  return '';
}

/* 설정 패널 미리보기에서 호출 — _customBgUrl 과 동일 캐시를 공개해 미리보기와 실제 배경 URL 을 일치시킴 */
export function getCustomBgDataUrl(){
  return _customBgUrl();
}

/* 배경 모드가 바뀔 때 — 또는 단색 모드 안에서 이미지를 바꿀 때 — 어울리는 글래스 기본값을 적용한다.
 *  - solid          : 상하단 모두 smoke (단색 배경에서는 진한 다크 글래스가 가독성/대비 모두 좋음).
 *                     단색 라이트/단색 다크 어느 쪽으로 바꿔도 매번 강제 — 사용자 보고: 라이트 단색에서
 *                     흰 글씨가 안 보임. smoke 가 항상 깔려 있어야 흰 글씨가 또렷.
 *  - selected/random/custom : 기본 프리셋(frost / sunset) 복원 — 단, 같은 모드 안에서 이미지만
 *                            바꾸는 경우(prev===new)는 사용자가 직접 고른 글래스를 보존. */
function _applyDefaultGlassIfModeChanged(newMode){
  const prevMode=localStorage.getItem('ec_bg_mode')||'';
  if(newMode==='solid'){
    /* solid 는 매번 강제 — 단색 위에 어두운 smoke 가 깔려 있어야 흰 글씨 가독성 확보 */
    localStorage.setItem('ec_glass_header','smoke');
    localStorage.setItem('ec_glass_footer','smoke');
    return;
  }
  if(prevMode===newMode)return;
  localStorage.setItem('ec_glass_header','frost');
  localStorage.setItem('ec_glass_footer','sunset');
}
export function applyBackground(){
  const mode=localStorage.getItem('ec_bg_mode')||'selected';
  const selected=(localStorage.getItem('ec_bg_selected')||'jeju_by-monet.webp').replace(/\.png$/,'.webp');
  const custom=_customBgUrl();
  const randomDaily=localStorage.getItem('ec_bg_random_daily')==='true';
  const randomWeekly=localStorage.getItem('ec_bg_random_weekly')==='true';
  const randomDate=localStorage.getItem('ec_bg_random_date')||'';
  const randomWeekNum=parseInt(localStorage.getItem('ec_bg_random_week')||'0',10);
  const today=new Date().toISOString().slice(0,10);
  const currentWeek=getISOWeekNumber(new Date());
  let url='';
  if(mode==='random'){
    let shouldKeep=false;
    if(randomWeekly&&randomWeekNum===currentWeek){
      shouldKeep=true;
    } else if(randomDaily&&!randomWeekly&&randomDate===today){
      shouldKeep=true;
    }
    if(shouldKeep){
      const savedRandom=(localStorage.getItem('ec_bg_random_file')||'').replace(/\.png$/,'.webp');
  if(savedRandom){url="url('assets/backgrounds/"+encodeURIComponent(savedRandom)+"')";}
  else{const idx=Math.floor(Math.random()*BG_IMAGES.length);const pick=BG_IMAGES[idx].file;localStorage.setItem('ec_bg_random_file',pick);localStorage.setItem('ec_bg_random_date',today);localStorage.setItem('ec_bg_random_week',String(currentWeek));url="url('assets/backgrounds/"+encodeURIComponent(pick)+"')";}
    } else {
      const idx=Math.floor(Math.random()*BG_IMAGES.length);const pick=BG_IMAGES[idx].file;
      localStorage.setItem('ec_bg_random_file',pick);localStorage.setItem('ec_bg_random_date',today);localStorage.setItem('ec_bg_random_week',String(currentWeek));
  url="url('assets/backgrounds/"+encodeURIComponent(pick)+"')";
    }
  } else if(mode==='custom'&&custom){
    url="url('"+custom+"')";
  } else if(mode==='solid'){
    /* 단색 이미지 모드 — 라이트/다크 모드별로 분리된 갤러리 + 별도 선택 키 사용.
       라이트 단색 미등록 시 폴백: body 배경색을 단색으로 직접 칠하고 backgroundImage 비움. */
    const isLightMode=document.body.classList.contains('light');
    const list=isLightMode?SOLID_IMAGES_LIGHT:SOLID_IMAGES_DARK;
    const lsKey=isLightMode?'ec_bg_solid_selected_light':'ec_bg_solid_selected_dark';
    if(list.length){
      let solidPick=localStorage.getItem(lsKey)||list[0].file;
      if(!list.some(function(x){return x.file===solidPick;})) solidPick=list[0].file;
      url="url('assets/backgrounds/"+encodeURIComponent(solidPick)+"')";
    } else {
      /* 라이트 단색 미등록 — backgroundImage 제거하고 단색 폴백 색상 사용 */
      document.body.style.backgroundImage='none';
      document.body.style.backgroundColor=isLightMode?'#F1F5F9':'#0F172A';
      document.body.setAttribute('data-bg-mode', mode);
      try { applyHeaderGlass(); } catch(_){}
      try { applyFooterGlass(); } catch(_){}
      return;
    }
  } else {
  url="url('assets/backgrounds/"+encodeURIComponent(selected)+"')";
  }
  document.body.style.backgroundImage=url;
  /* 단색 모드 식별용 data-attr — CSS에서 헤더 ::before 오버레이 차단 */
  document.body.setAttribute('data-bg-mode', mode || 'selected');
  /* 헤더·푸터 글래스 재적용 — solid 모드면 자동 투명화, 다른 모드면 사용자 설정 복원 */
  try { applyHeaderGlass(); } catch(_){}
  try { applyFooterGlass(); } catch(_){}
}

export function setBgMode(m){
  /* 모드 선택은 *어떤 갤러리를 보여줄지*만 결정 — 실제 배경 변경은 사용자가 갤러리에서 항목을 클릭할 때 일어남.
     그래야 *클릭만으로 배경이 바뀌어 당황*하는 일을 막고 의도가 분명해짐.
     단, 모드가 실제로 바뀌었다면 그 모드의 글래스 기본값(smoke/frost/sunset)을 즉시 적용해 미리보기 정합. */
  _applyDefaultGlassIfModeChanged(m);
  _bgMode=m;
  localStorage.setItem('ec_bg_mode',m);
  try{applyHeaderGlass();}catch(_){}
  try{applyFooterGlass();}catch(_){}
  renderSettingsPanel('background');
}

export function selectBgImage(file){
  _applyDefaultGlassIfModeChanged('selected');
  localStorage.setItem('ec_bg_mode','selected');
  localStorage.setItem('ec_bg_selected',file);
  _bgMode='selected';
  applyBackground();
  _autoHeaderTextColor();
  if(S.settingsLocked==='background') renderSettingsPanel('background');
}

export function selectSolidImage(file){
  _applyDefaultGlassIfModeChanged('solid');
  localStorage.setItem('ec_bg_mode','solid');
  /* 라이트/다크별로 별개 키에 저장 — 모드 전환 시 각자 마지막 선택 유지 */
  const isLightMode=document.body.classList.contains('light');
  const lsKey=isLightMode?'ec_bg_solid_selected_light':'ec_bg_solid_selected_dark';
  localStorage.setItem(lsKey,file);
  _bgMode='solid';
  applyBackground();
  _autoHeaderTextColor();
  if(S.settingsLocked==='background') renderSettingsPanel('background');
}

export function toggleBgRandomDaily(){
  const cur=localStorage.getItem('ec_bg_random_daily')==='true';
  localStorage.setItem('ec_bg_random_daily',cur?'false':'true');
  if(S.settingsLocked==='background') renderSettingsPanel('background');
}

export function toggleBgRandomWeekly(){
  const cur=localStorage.getItem('ec_bg_random_weekly')==='true';
  localStorage.setItem('ec_bg_random_weekly',cur?'false':'true');
  if(S.settingsLocked==='background') renderSettingsPanel('background');
}

function getISOWeekNumber(d){
  const date=new Date(d.getTime());
  date.setHours(0,0,0,0);
  date.setDate(date.getDate()+3-(date.getDay()+6)%7);
  const week1=new Date(date.getFullYear(),0,4);
  return date.getFullYear()*100+Math.ceil(((date-week1)/86400000+week1.getDay()+1)/7);
}

/* 사용자 배경 이미지 업로드 — canvas 로 1920×1080 webp 변환 → IPC 로 userData/data/bg/custom.webp 저장.
   localStorage 에는 파일 경로만 저장 (레거시 Base64 방식 대비 용량 1/4 + LS 용량 부담 0). */
export async function handleBgCustomUpload(file){
  if(!file||!file.type.startsWith('image/'))return;
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=async function(){
      const ratio=img.width/img.height;
      const target=16/9;
      if(Math.abs(ratio-target)>0.3){
        alert('16:9 비율에 가까운 이미지를 사용해주세요.\n현재 비율: '+img.width+' x '+img.height+' ('+ratio.toFixed(2)+':1)');
        return;
      }
      /* canvas 로 1920×1080 webp(0.85) 다운스케일 — 큰 원본도 안정 처리 */
      const W=1920, H=1080;
      const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      ctx.drawImage(img,0,0,W,H);
      const blob=await new Promise(function(res){canvas.toBlob(function(b){res(b);},'image/webp',0.85);});
      if(!blob){alert('이미지 변환 실패');return;}
      const buffer=await blob.arrayBuffer();
      if(!(window.electronAPI&&window.electronAPI.userBgSave)){
        /* IPC 미지원 환경 — 레거시 Base64 폴백 */
        _applyDefaultGlassIfModeChanged('custom');
        localStorage.setItem('ec_bg_mode','custom');
        localStorage.setItem('ec_bg_custom',e.target.result);
      } else {
        const r=await window.electronAPI.userBgSave(buffer,'webp');
        if(!r||!r.success){alert('저장 실패: '+(r&&r.error||''));return;}
        /* 레거시 Base64 정리 + 파일 경로 + 캐시 버전 갱신 */
        localStorage.removeItem('ec_bg_custom');
        localStorage.setItem('ec_bg_custom_path',r.path);
        localStorage.setItem('ec_bg_custom_ver',String(Date.now()));
        _applyDefaultGlassIfModeChanged('custom');
        localStorage.setItem('ec_bg_mode','custom');
        /* 메모리 캐시 즉시 갱신 — 디스크에 막 저장한 파일을 다시 base64 로 받아옴 */
        await _loadCustomBgDataUrl();
      }
      _bgMode='custom';
      applyBackground();
      if(S.settingsLocked==='background') renderSettingsPanel('background');
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

/* 기존 업로드 이미지를 다시 배경으로 적용 — 모드가 다른 상태에서 사용자가 미리보기를 클릭한 경우.
 * 새 업로드 없이 캐시된 dataURL 또는 레거시 LS 값을 그대로 사용. */
export function reapplyBgCustom(){
  /* 캐시(또는 레거시 base64) 가 비어 있으면 적용할 게 없음 */
  if(!_customBgUrl())return;
  _applyDefaultGlassIfModeChanged('custom');
  localStorage.setItem('ec_bg_mode','custom');
  _bgMode='custom';
  applyBackground();
  _autoHeaderTextColor();
  if(S.settingsLocked==='background') renderSettingsPanel('background');
}

export async function deleteBgCustom(){
  localStorage.removeItem('ec_bg_custom');
  localStorage.removeItem('ec_bg_custom_path');
  localStorage.removeItem('ec_bg_custom_ver');
  if(window.electronAPI&&window.electronAPI.userBgDelete){
    try{await window.electronAPI.userBgDelete();}catch(_){}
  }
  _customBgDataUrlCache=null;
  localStorage.setItem('ec_bg_mode','selected');
  _bgMode='selected';
  applyBackground();
  if(S.settingsLocked==='background') renderSettingsPanel('background');
}

/* 부팅 시 1회 마이그레이션 — 기존 Base64(`ec_bg_custom`) 가 남아있으면 파일로 변환 후 LS 정리 */
async function _migrateLegacyBgCustom(){
  if(localStorage.getItem('ec_bg_custom_path'))return; /* 이미 신 형식 */
  const legacy=localStorage.getItem('ec_bg_custom')||'';
  if(!legacy||!legacy.startsWith('data:image/'))return;
  if(!(window.electronAPI&&window.electronAPI.userBgSave))return;
  try{
    /* dataURL → Blob → ArrayBuffer */
    const res=await fetch(legacy);
    const blob=await res.blob();
    const buffer=await blob.arrayBuffer();
    const ext=(blob.type.split('/')[1]||'webp').replace(/[^a-z0-9]/gi,'');
    const r=await window.electronAPI.userBgSave(buffer,ext);
    if(r&&r.success){
      localStorage.removeItem('ec_bg_custom');
      localStorage.setItem('ec_bg_custom_path',r.path);
      localStorage.setItem('ec_bg_custom_ver',String(Date.now()));
      console.info('[bg] legacy Base64 → 파일 마이그레이션 완료:',r.path);
      applyBackground();
    }
  }catch(e){console.warn('[bg] 레거시 마이그레이션 실패',e);}
}

document.addEventListener('DOMContentLoaded', async function(){
  /* 부팅 시 dataURL 캐시 먼저 채우고 applyBackground 호출 — 첫 그리기부터 정상 표시 */
  await _loadCustomBgDataUrl();
  applyBackground();
  /* 부팅 시 한 번만 — 기존 Base64 잔여분 자동 변환 (저장 후 다시 dataURL 캐시 갱신) */
  await _migrateLegacyBgCustom();
  await _loadCustomBgDataUrl();
  applyBackground();
});

/* ── Public exports ── */

