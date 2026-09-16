/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
import { getPublicDataApiKey, hasPublicDataApiKeySetting, getPublicDataMigrationCandidate, savePublicDataApiKey, loadPublicDataApiKey } from '../../core/public-data-settings.js';
import { checkPublicDataConnection } from '../../core/public-data-connection.js';

const services={kma:'기상청 단기예보',uv:'기상청 자외선',airkorea:'에어코리아',drug:'식약처 의약품',hira:'병원·약국',emergency:'응급의료',kdca:'감염병 현황',holiday:'공휴일'};
const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buttonStyle='padding:7px 12px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg2);color:var(--t1);font-size:11px;cursor:pointer';
export function publicDataServiceForKey(lsKey){
  const service=String(lsKey).replace(/^ec_/,'').replace(/_api_key$/,'');
  return Object.prototype.hasOwnProperty.call(services,service)?service:'';
}
export function renderPublicDataSettings(storage=localStorage){
  const key=storage.getItem('ec_public_data_api_key')||'';
  const chosen=hasPublicDataApiKeySetting(storage), candidate=getPublicDataMigrationCandidate(storage);
  let h='<section class="cc" style="padding:16px;margin:14px 0;border:1.5px solid var(--cyan)" aria-label="공공데이터포털 공통 인증키">';
  h+='<div style="font-size:14px;font-weight:800;margin-bottom:8px">🔑 공공데이터포털 공통 인증키</div>';
  h+='<p style="font-size:11px;color:var(--t2);line-height:1.8;margin:0 0 10px">data.go.kr의 개인 인증키를 <b>한 번만 저장</b>하면 아래 공공데이터 서비스에서 함께 사용합니다.<br>인증키는 같아도 <b>각 서비스의 활용 신청·승인은 별도</b>입니다. 카카오·나이스 키는 별도로 등록합니다.</p>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap"><input id="publicDataCommonKey" aria-label="공공데이터포털 공통 인증키" class="form-input" type="password" autocomplete="off" spellcheck="false" value="'+escape(key)+'" placeholder="Encoding 또는 Decoding 인증키를 한 번만 입력" style="flex:1;min-width:180px;font-size:12px">';
  h+='<button id="publicDataKeyToggle" type="button" style="'+buttonStyle+'" aria-pressed="false">보기</button>';
  h+='<button id="publicDataKeySave" type="button" style="'+buttonStyle+';background:var(--cyan);color:#fff">공통 키 저장</button></div>';
  h+='<div id="publicDataKeyStatus" role="status" aria-live="polite" style="margin-top:8px;font-size:11px;color:var(--t2)">'+(chosen?(key?'공통 키 저장됨 · 서비스별 연결은 아래에서 확인해 주세요.':'공공데이터 연결 중지됨 · 인증키를 저장하면 다시 사용할 수 있습니다.'):'공통 키 미등록 · 기존에 등록한 개별 키는 계속 사용됩니다.')+'</div>';
  if(!chosen&&candidate.key)h+='<button id="publicDataUseExistingKey" type="button" style="'+buttonStyle+';margin-top:8px">기존 인증키 불러오기</button><span style="font-size:10px;color:var(--t3);margin-left:6px">불러온 뒤 공통 키 저장을 눌러 주세요.</span>';
  if(!chosen&&candidate.conflict)h+='<p style="font-size:11px;color:#b45309">서로 다른 기존 인증키가 있어 자동 선택하지 않았습니다. 사용할 계정의 개인 인증키를 위에 입력해 주세요. 저장 전까지는 기존 설정이 유지됩니다.</p>';
  h+='<div style="font-size:10px;color:var(--t3);margin-top:10px;line-height:1.7">키를 비우고 저장하면 공공데이터 연결이 중지됩니다. 기존 개별 키와 보건일지 자료는 삭제하지 않습니다.<br>입력만으로는 저장되지 않습니다. 연결 확인은 저장된 키로 최소 조회를 수행하며, 저장 성공이 모든 서비스의 승인을 뜻하지는 않습니다.</div></section>';
  return h;
}
export function renderPublicDataService(o,storage=localStorage){
  const service=publicDataServiceForKey(o.lsKey);
  const key=getPublicDataApiKey(service,storage);
  const state=key?(hasPublicDataApiKeySetting(storage)?'공통 키 사용':'기존 개별 키 사용'):'인증키 미등록 / 연결 중지';
  let h='<div class="cc" style="padding:16px;margin-bottom:12px">';
  h+='<div style="font-size:13px;font-weight:700">'+o.icon+' '+escape(o.title)+'</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin:5px 0">'+(service==='uv'?'상단 헤더 자외선지수 표시 · 단기예보와 별도로 생활기상지수 활용 신청 필요':o.desc)+'</div>';
  h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:10px;color:var(--t2)">'+state+'</span><button type="button" data-public-data-check="'+service+'" style="'+buttonStyle+'">연결 확인</button>';
  h+='<a href="#" style="font-size:11px;color:var(--cyan);cursor:pointer" data-action="openExternal" data-arg="'+escape(o.link)+'">활용 신청 ↗</a></div>';
  if(service==='hira')h+='<div style="margin-top:8px;font-size:10px;color:var(--t3)">병원정보와 약국정보는 각각 활용 신청이 필요합니다. <a href="#" data-action="openExternal" data-arg="https://www.data.go.kr/data/15001673/openapi.do" style="color:var(--cyan)">약국정보 활용 신청 ↗</a></div>';
  if(service==='airkorea')h+='<div style="margin-top:8px;font-size:10px;color:var(--t3)">대기오염정보와 측정소정보를 각각 신청해 주세요. <a href="#" data-action="openExternal" data-arg="https://www.data.go.kr/data/15073877/openapi.do" style="color:var(--cyan)">측정소정보 활용 신청 ↗</a></div>';
  h+='<div data-public-data-result="'+service+'" role="status" aria-live="polite" style="font-size:11px;color:var(--t2);margin-top:7px">연결 확인 전</div></div>';
  return h;
}
export function bindPublicDataSettings(container,{onChanged=()=>{},onRender=()=>{}}={}){
  const input=container.querySelector('#publicDataCommonKey');
  if(!input)return;
  const status=container.querySelector('#publicDataKeyStatus'), save=container.querySelector('#publicDataKeySave');
  let busy=false, checking=false, revision=0;
  const saved=()=>localStorage.getItem('ec_public_data_api_key')||'';
  function edit(){revision++;status.textContent='아직 저장되지 않았습니다. 공통 키 저장을 눌러 주세요.';}
  input.addEventListener('input',edit);
  container.querySelector('#publicDataKeyToggle').addEventListener('click',function(){
    const visible=input.type==='password';input.type=visible?'text':'password';this.textContent=visible?'숨기기':'보기';this.setAttribute('aria-pressed',String(visible));
  });
  const existing=container.querySelector('#publicDataUseExistingKey');
  if(existing)existing.addEventListener('click',function(){input.value=getPublicDataMigrationCandidate().key||'';edit();input.focus();});
  save.addEventListener('click',async function(){
    if(busy)return;
    const value=input.value.trim();
    if(!value&&!confirm('공공데이터 API 연결을 중지하시겠습니까?\n기존 개별 인증키와 보건일지 자료는 삭제하지 않습니다.'))return;
    busy=true;revision++;save.disabled=true;input.disabled=true;status.textContent='저장 중…';
    try{
      const response=await savePublicDataApiKey(value);
      if(!response.success){status.textContent=response.error;return;}
      onChanged(value);
      if(response.warning){status.textContent='공통 키 저장됨. '+response.warning;return;}
      onRender();
    }catch(_){status.textContent='저장을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';}
    finally{busy=false;save.disabled=false;input.disabled=false;}
  });
  const checkButtons=container.querySelectorAll('[data-public-data-check]');
  checkButtons.forEach(function(button){
    button.addEventListener('click',async function(){
      if(checking)return;
      const service=button.dataset.publicDataCheck, output=container.querySelector('[data-public-data-result="'+service+'"]');
      if(busy||input.value.trim()!==saved().trim()){output.textContent='공통 인증키를 먼저 저장한 뒤 연결을 확인해 주세요.';return;}
      const token=revision;checking=true;checkButtons.forEach(function(b){b.disabled=true;});output.textContent='연결 확인 중…';
      try{
        const loaded=await loadPublicDataApiKey();
        if(!loaded.success){output.textContent=loaded.error;return;}
        if(input.value.trim()!==saved().trim()){output.textContent='다른 컴퓨터에서 공통 키가 변경되었습니다. API 설정을 다시 열어 주세요.';return;}
        const key=getPublicDataApiKey(service);
        const response=await checkPublicDataConnection(service,key,window.electronAPI);
        output.textContent=token===revision&&key===getPublicDataApiKey(service)?response.message:'인증키가 변경되었습니다. 저장 후 다시 확인해 주세요.';
      }catch(_){output.textContent='연결 확인에 실패했습니다. 잠시 후 다시 확인해 주세요.';}
      finally{checking=false;checkButtons.forEach(function(b){b.disabled=false;});}
    });
  });
}
