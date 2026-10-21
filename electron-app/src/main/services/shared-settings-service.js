'use strict';
const fs=require('fs');
const {isShared}=require('../../shared/shared-settings');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const missing=Symbol('missing');
const medicationKeys=new Set(['user_med_syms','user_added_meds','user_med_syms_prefilled','med_hidden','med_renames','meddb_user']);
function validMedicationValue(key,value){
  if(!object(value))return false;
  return Object.keys(value).every(name=>{
    if(['__proto__','constructor','prototype'].includes(name))return false;
    if(key==='user_med_syms'||key==='meddb_user')return Array.isArray(value[name])&&value[name].every(item=>typeof item==='string');
    return true;
  });
}
function merge(base,current,next,path,conflicts){
  if(equal(base,next))return current;
  if(equal(base,current)||equal(current,next))return next;
  if(object(base)&&object(current)&&object(next)){
    const out={};
    for(const key of new Set([...Object.keys(base),...Object.keys(current),...Object.keys(next)])){
      if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsupported setting field');
      const value=merge(own(base,key)?base[key]:missing,own(current,key)?current[key]:missing,own(next,key)?next[key]:missing,path.concat(key),conflicts);
      if(value!==missing)out[key]=value;
    }
    return out;
  }
  conflicts.push(path.join('.'));return current;
}
function read(services,key){
  if(!isShared(key))throw Error('Unsupported shared setting');
  const store=services.store(),marker='__shared_settings_v1.'+key;
  if(!store.get('common',marker).exists){
    const db=store.get('common',key),json=services.jsonFile().loadCommon(key);
    let chosen=db;
    if(json.exists){
      let jsonTime=0;try{jsonTime=fs.statSync(services.jsonFile().commonPath(key)).mtimeMs;}catch(_){}
      if(!db.exists||jsonTime>(Date.parse(db.updatedAt)||0))chosen=json;
    }
    if(medicationKeys.has(key)){
      const dbValid=db.exists&&validMedicationValue(key,db.data);
      const jsonValid=json.exists&&validMedicationValue(key,json.data);
      if((db.exists||json.exists)&&!dbValid&&!jsonValid)throw Error('Invalid medication migration data');
      // 최초 전환에서 빈 파일이나 잘못된 값이 정상 약품 목록을 지우지 않도록 한다.
      if(dbValid&&(!jsonValid||(Object.keys(db.data).length>0&&Object.keys(json.data).length===0)))chosen=db;
      else if(jsonValid&&!dbValid)chosen=json;
    }
    const items=[{scope:'common',key:marker,value:true}];
    if(db.exists||json.exists){
      const backupKey='__shared_settings_backup.'+key;
      // 기존 복구 사본은 보존한다. 전환 완료 후 빈 목록을 자동으로 복원하지 않는다.
      if(!medicationKeys.has(key)||!store.get('common',backupKey).exists){
        items.push({scope:'common',key:backupKey,value:{database:db,json,migratedAt:new Date().toISOString()}});
      }
      items.push({scope:'common',key,value:chosen.data});
    }
    store.batchSet(items);
  }
  return {success:true,...store.get('common',key)};
}
function sharedSettingsRequest(services,request){
  try{
    if(request?.action==='write-medications'){
      const result=services.store().db.transaction(()=>{
        const items=request.items;
        if(!Array.isArray(items)||!items.length||items.length>medicationKeys.size||new Set(items.map(item=>item?.key)).size!==items.length)throw Error('Invalid medication batch');
        const prepared=[];
        for(const item of items){
          if(!item||!medicationKeys.has(item.key)||typeof item.baseExists!=='boolean'||!validMedicationValue(item.key,item.value))throw Error('Invalid medication batch item');
          const encoded=JSON.stringify(item.value);
          if(Buffer.byteLength(encoded,'utf8')>4*1024*1024)throw Error('Medication batch value too large');
          const current=read(services,item.key);
          // One stale setting must cancel the entire deletion, not merge half of it.
          if(current.exists!==item.baseExists||(current.exists&&!equal(current.data,item.base)))return {success:false,conflict:true,error:'medication_settings_changed'};
          prepared.push({key:item.key,value:JSON.parse(encoded)});
        }
        for(const item of prepared)services.store().set('common',item.key,item.value);
        const entries={};
        for(const item of prepared)entries[item.key]={success:true,...services.store().get('common',item.key)};
        return {success:true,entries,count:prepared.length};
      }).immediate();
      // Mirrors are best-effort only after the authoritative transaction commits.
      if(result.success){
        result.mirrorSaved=true;
        for(const [key,entry] of Object.entries(result.entries)){
          try{services.jsonFile().saveCommon(key,entry.data);}catch(_){result.mirrorSaved=false;}
        }
      }
      return result;
    }
    return services.store().db.transaction(()=>{
    if(!request||typeof request!=='object')throw Error('Invalid settings request');
    if(request.action==='read-many'){
      if(!Array.isArray(request.keys)||request.keys.length>100)throw Error('Invalid settings keys');
      const entries={};for(const key of request.keys)entries[key]=read(services,key);
      return {success:true,entries};
    }
    const current=read(services,request.key);
    if(request.action==='read')return current;
    if(request.action!=='write')throw Error('Unsupported settings action');
    const encoded=JSON.stringify(request.value);
    if(encoded===undefined||Buffer.byteLength(encoded,'utf8')>4*1024*1024)throw Error('Invalid settings value');
    const conflicts=[];
    const base=request.baseExists?request.base:missing;
    const now=current.exists?current.data:missing;
    const value=merge(base,now,JSON.parse(encoded),[],conflicts);
    if(conflicts.length)return {...current,success:false,conflict:true,fields:conflicts};
    if(value===missing)return current;
    services.store().set('common',request.key,value);
    // SQLite is authoritative. A failed legacy mirror cannot roll back an accepted edit.
    let mirrorSaved=true;try{services.jsonFile().saveCommon(request.key,value);}catch(_){mirrorSaved=false;}
    return {...read(services,request.key),mirrorSaved};
  }).immediate();}catch(_){return {success:false,error:'shared_settings_unavailable'};}
}
module.exports={sharedSettingsRequest};
