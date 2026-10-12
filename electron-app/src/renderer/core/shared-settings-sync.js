import { S, refreshSharedKioskSettings } from './app-state.js';
import { bus } from './event-bus.js';
let running=null;
const callbacks=new Map();
export function registerSharedSettingsMappings(mappings){
  const keys=new Set(window.electronAPI?.sharedSettingsKeys?.()||[]);
  for(const mapping of mappings||[])if(keys.has(mapping.dbKey))callbacks.set(mapping.dbKey,mapping);
}
export function refreshSharedSettings(){
  if(running)return running;
  const api=window.electronAPI;if(!api?.sharedSettingsSync)return Promise.resolve(false);
  const values={},raw={};
  for(const key of api.sharedSettingsKeys()){
    if(key==='kiosk_settings')continue;
    const lsKey='ec_'+key;raw[key]=localStorage.getItem(lsKey);
    try{values[key]={exists:raw[key]!==null,data:raw[key]===null?null:JSON.parse(raw[key])};}
    catch(_){values[key]={exists:true,data:raw[key]};}
  }
  running=api.sharedSettingsSync(values).then(result=>{
    const changed=[];
    for(const [key,entry] of Object.entries(result?.entries||{})){
      const lsKey='ec_'+key;if(localStorage.getItem(lsKey)!==raw[key])continue;
      const next=entry.exists?(typeof entry.data==='string'?entry.data:JSON.stringify(entry.data)):null;
      if(next===raw[key])continue;
      if(next===null)localStorage.removeItem(lsKey);else localStorage.setItem(lsKey,next);
      if(callbacks.get(key)?.onLoaded)callbacks.get(key).onLoaded(entry.exists?entry.data:null);
      changed.push(key);
    }
    if(changed.length){bus.emit('symcats:changed');bus.emit('settings:shared-changed',changed);}
    return !!result?.success;
  }).catch(()=>false).finally(()=>{running=null;});
  return running;
}
window.addEventListener('shared-settings:error',event=>{
  const conflict=event.detail?.conflict;
  bus.emit('toast:show',{text:conflict?'다른 PC에서 같은 설정을 변경했습니다. 입력 내용은 이 기기에 임시 보관했습니다. 최신 설정을 확인한 뒤 다시 수정해 주세요.':'공유 설정을 저장하지 못했습니다. 변경 내용은 이 기기에 보관했으며 연결 후 다시 시도합니다.'});
});
window.addEventListener('online',()=>{refreshSharedSettings();refreshSharedKioskSettings();});
