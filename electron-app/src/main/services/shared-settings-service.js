'use strict';
const fs=require('fs');
const {isShared}=require('../../shared/shared-settings');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const missing=Symbol('missing');
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
    const items=[{scope:'common',key:marker,value:true}];
    if(db.exists||json.exists){
      items.push({scope:'common',key:'__shared_settings_backup.'+key,value:{database:db,json,migratedAt:new Date().toISOString()}});
      items.push({scope:'common',key,value:chosen.data});
    }
    store.batchSet(items);
  }
  return {success:true,...store.get('common',key)};
}
function sharedSettingsRequest(services,request){
  try{return services.store().db.transaction(()=>{
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
