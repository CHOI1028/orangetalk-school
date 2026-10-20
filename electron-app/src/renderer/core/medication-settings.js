/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. */
/* 상용 약품은 시작 시점의 복사본이 아니라 편집 직전 저장소의 값으로 변경한다. */
export const MEDICATION_SETTING_KEYS = ['user_med_syms','user_added_meds','user_med_syms_prefilled','med_hidden','med_renames','meddb_user'];
export const MEDICATION_RECOVERY_KEY = 'ec_medication_settings_recovery_v1';
export function createMedicationSettings(options){
  let tail=Promise.resolve();
  const storage=()=>typeof options.storage==='function'?options.storage():options.storage;
  const api=()=>typeof options.api==='function'?options.api():options.api;
  const copy=value=>JSON.parse(JSON.stringify(value));
  function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
  function check(key,value){
    if(!MEDICATION_SETTING_KEYS.includes(key)||!object(value))throw Error('Invalid medication settings');
    for(const name of Object.keys(value)){
      if(['__proto__','constructor','prototype'].includes(name))throw Error('Invalid medication name');
      if((key==='user_med_syms'||key==='meddb_user')&&(!Array.isArray(value[name])||value[name].some(x=>typeof x!=='string')))throw Error('Invalid medication mapping');
    }
    return value;
  }
  function local(key){const raw=storage().getItem('ec_'+key);return raw===null?{}:check(key,JSON.parse(raw));}
  function snapshot(key){try{return copy(local(key));}catch(_){return {};}}
  function enqueue(work){const result=tail.then(work);tail=result.catch(()=>{});return result;}
  async function current(key){
    const a=api();if(!a?.dbGet||!a?.dbSet)throw Error('Medication storage unavailable');
    const result=await a.dbGet('common',key);
    if(!result?.success)throw Error('Medication settings load failed');
    if(result.exists)return copy(check(key,result.data));
    /* 설치형의 옛 로컬 설정만 이행 대상으로 삼는다. 다른 서버의 브라우저 캐시는 합치지 않는다. */
    return options.isWeb?.()?{}:copy(local(key));
  }
  function backup(key,value){
    if(!Object.keys(value).length)return;
    const raw=storage().getItem(MEDICATION_RECOVERY_KEY);
    const saved=raw===null?{}:JSON.parse(raw);
    if(!object(saved))throw Error('Medication recovery storage invalid');
    const entry={at:new Date().toISOString(),value:copy(value)};
    const previous=saved[key];
    if(previous&&(!object(previous)||!Array.isArray(previous.recent)))throw Error('Medication recovery entry invalid');
    saved[key]={first:previous?.first||entry,recent:[...(previous?.recent||[]),entry].slice(-3)};
    /* 변경 전 사본을 보존할 수 없으면 저장도 진행하지 않는다. 자동 복원은 하지 않는다. */
    storage().setItem(MEDICATION_RECOVERY_KEY,JSON.stringify(saved));
  }
  function load(keys=MEDICATION_SETTING_KEYS){return enqueue(async()=>{
    const values=[];
    for(const key of keys){const before=storage().getItem('ec_'+key);values.push({key,before,value:await current(key)});}
    for(const item of values){if(storage().getItem('ec_'+item.key)===item.before)storage().setItem('ec_'+item.key,JSON.stringify(item.value));}
    return true;
  });}
  function update(key,change){return enqueue(async()=>{
    const before=await current(key),next=copy(before);
    change(next);check(key,next);
    if(JSON.stringify(next)===JSON.stringify(before)){storage().setItem('ec_'+key,JSON.stringify(before));return before;}
    backup(key,before);
    const result=await api().dbSet('common',key,next);
    if(!result?.success||result.conflict||result.pending)throw Error('Medication settings save not confirmed');
    /* 서버가 다른 PC의 변경을 병합한 경우 그 결과를 화면에도 사용한다. */
    const accepted=check(key,result.exists&&result.data!==undefined?result.data:next);
    storage().setItem('ec_'+key,JSON.stringify(accepted));
    return copy(accepted);
  });}
  return {snapshot,load,update};
}
export const medicationSettings=createMedicationSettings({api:()=>window.electronAPI,storage:()=>localStorage,isWeb:()=>!!window.__isWebBrowser});
