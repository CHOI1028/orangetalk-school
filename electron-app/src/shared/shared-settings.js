/* Shared by Electron's preload and the LAN browser bridge. No patient data. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.OrangeSharedSettings=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEYS=["kiosk_settings","treatmentMap","medicationMap","user_symptoms","hidden_symptoms","sym_order","renamed_sym_cats","user_sym_cats","hidden_sym_cats","sym_cat_order","sym_cat_icons","sym_renames","user_med_syms","user_added_meds","user_med_syms_prefilled","med_hidden","med_renames","meddb_user","sym_meds","sym_ointments","sym_patches","user_fav_treatments","user_demoted_treatments","user_sym_fav","user_sym_removed","treat_renames","vp_custom_formats","vp_custom_names","vp_custom_slots","vp_custom_labels","vp_custom_blocks","vp_custom_rows","vp_reason_removed","vp_tpl_visitPass","vp_tpl_restReferral","vp_tpl_meal","vp_tpl_referral","vp_editor_default","vp_editor_custom1","vp_editor_custom2","vp_editor_custom3","vp_editor_custom4","vp_editor_custom5","vp_editor_custom6","vp_editor_custom7","vp_editor_custom8","vp_editor_custom9","vp_editor_custom10","vp_editor_custom11","vp_editor_custom12","vp_editor_custom13","vp_editor_custom14","vp_editor_custom15"];
  const keySet=new Set(KEYS);
  const isShared=key=>typeof key==='string'&&keySet.has(key);
  const lsKey=key=>key==='kiosk_settings'?'ec_kiosk':'ec_'+key;
  const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function createClient(send,storage,notify){
    const states=new Map();
    const pendingKey='ec_shared_settings_pending_v1',conflictKey='ec_shared_settings_conflicts_v1';
    function getStorage(){try{return typeof storage==='function'?storage():storage;}catch(_){return null;}}
    function readStored(key){try{return JSON.parse(getStorage()?.getItem(key)||'{}');}catch(_){return {};}}
    let pending=readStored(pendingKey);
    function persist(){const s=getStorage();if(s)s.setItem(pendingKey,JSON.stringify(pending));}
    function state(key){if(!isShared(key))throw Error('Unsupported shared setting');if(!states.has(key))states.set(key,{base:null,local:undefined,tail:Promise.resolve(),generation:0,busy:0});return states.get(key);}
    function enqueue(key,fn){const s=state(key);s.busy++;s.generation++;const run=s.tail.then(fn);s.tail=run.catch(()=>{});return run.finally(()=>{s.busy--;});}
    function accept(s,result,local){s.base=clone(result);s.local=clone(local===undefined?result.data:local);}
    function report(result){if(notify)notify(result);}
    function conflict(key,request,result){
      const backup=readStored(conflictKey);backup[key]={request,time:new Date().toISOString()};
      const target=getStorage();if(!target)throw Error('Recovery storage unavailable');
      target.setItem(conflictKey,JSON.stringify(backup));
      delete pending[key];persist();report({success:false,conflict:true,key});
    }
    async function recover(key,s){
      const request=pending[key];if(!request)return true;
      const result=await send(request);
      if(result&&result.success){accept(s,result,request.value);delete pending[key];persist();return true;}
      if(result&&result.conflict){conflict(key,request,result);accept(s,result,request.value);return true;}
      return false;
    }
    async function load(key,s){
      if(!await recover(key,s))return {success:false,pending:true};
      const result=await send({action:'read',key});
      if(result&&result.success)accept(s,result);
      return result;
    }
    function read(key){return enqueue(key,async()=>{try{return await load(key,state(key));}catch(_){return {success:false,pending:!!pending[key],error:'shared_settings_unavailable'};}});}
    function write(key,value,options){
      value=clone(value);options=options||{};
      return enqueue(key,async()=>{
        const s=state(key);
        try{
          // Periodic snapshots are not edits. They must never replay old channel credentials.
          if(options.background&&key==='kiosk_settings')return {success:true,skipped:true};
          if(!s.base){const r=await load(key,s);if(!r||!r.success)return r;if(options.background)return {...r,skipped:true};}
          if(options.background&&equal(value,s.local))return {success:true,skipped:true};
          if(pending[key]&&!await recover(key,s))return {success:false,pending:true};
          const request={action:'write',key,baseExists:s.base.exists===true,base:clone(s.base.data),value};
          pending[key]=request;persist();
          const result=await send(request);
          if(result&&result.success){accept(s,result,value);delete pending[key];persist();return result;}
          if(result&&result.conflict){conflict(key,request,result);accept(s,result,value);return result;}
          report({success:false,pending:true,key});return result||{success:false,pending:true};
        }catch(_){report({success:false,pending:true,key});return {success:false,pending:true,error:'shared_settings_unavailable'};}
      });
    }
    function writeMany(items){
      items=clone(items);
      if(!Array.isArray(items)||!items.length||items.length>6||new Set(items.map(x=>x?.key)).size!==items.length||items.some(x=>!isShared(x?.key)))return Promise.resolve({success:false,error:'invalid_medication_batch'});
      const selected=items.map(item=>state(item.key));
      const waiting=selected.map(s=>s.tail);
      selected.forEach(s=>{s.busy++;s.generation++;});
      const run=Promise.all(waiting).then(async()=>{
        // Never replay a destructive batch as separate pending writes.
        if(items.some(item=>pending[item.key]))return {success:false,pending:true};
        try{
          const result=await send({action:'write-medications',items});
          if(!result?.success||result.conflict||result.pending)return result||{success:false,error:'medication_batch_unavailable'};
          if(items.some(item=>!result.entries?.[item.key]?.success||result.entries[item.key].exists!==true))return {success:false,error:'invalid_medication_batch_response'};
          items.forEach(item=>accept(state(item.key),result.entries[item.key]));
          return result;
        }catch(_){return {success:false,error:'medication_batch_unavailable'};}
      });
      const tail=run.catch(()=>{});selected.forEach(s=>{s.tail=tail;});
      return run.finally(()=>{selected.forEach(s=>{s.busy--;});});
    }
    async function sync(values){
      const entries={},errors=[];
      const keys=Object.keys(values||{}).filter(k=>isShared(k)&&k!=='kiosk_settings');
      // Finish only locally changed values before fetching a single host snapshot.
      for(const key of keys){
        const s=state(key),v=values[key];
        if(s.busy)continue;
        if(pending[key]||(s.base&&v.exists&&!equal(v.data,s.local))){
          const result=pending[key]?await read(key):await write(key,v.data,{background:true});
          if(!result||!result.success)errors.push({key,pending:!!pending[key],conflict:!!result?.conflict});
        }
      }
      const clean=keys.filter(k=>!state(k).busy&&!pending[k]);
      const snapshots=new Map(clean.map(k=>[k,{generation:state(k).generation,raw:getStorage()?.getItem(lsKey(k))}]));
      if(!clean.length)return {success:!errors.length,entries,errors};
      let result;try{result=await send({action:'read-many',keys:clean});}catch(_){return {success:false,entries,errors};}
      if(!result||!result.success)return {success:false,entries,errors};
      for(const key of clean){
        const s=state(key),snapshot=snapshots.get(key),r=result.entries[key];
        if(!r||!r.success||s.busy||s.generation!==snapshot.generation||getStorage()?.getItem(lsKey(key))!==snapshot.raw)continue;
        accept(s,r);entries[key]=r;
      }
      return {success:!errors.length,entries,errors};
    }
    return {read,write,writeMany,sync};
  }
  function wrap(api,send,storage,notify){
    const client=createClient(send,storage,notify);
    const original={};['dbGet','dbSet','dbBatchSet','jsonLoadCommon','jsonSaveCommon','jsonFlush'].forEach(k=>{original[k]=api[k];});
    api.dbGet=(scope,key,year)=>scope==='common'&&isShared(key)?client.read(key):original.dbGet(scope,key,year);
    api.dbSet=(scope,key,value,year)=>scope==='common'&&isShared(key)?client.write(key,value):original.dbSet(scope,key,value,year);
    api.jsonLoadCommon=key=>isShared(key)?client.read(key):original.jsonLoadCommon(key);
    api.jsonSaveCommon=(key,value,options)=>isShared(key)?client.write(key,value,options):original.jsonSaveCommon(key,value);
    async function split(items,shared,rest){
      const results=[];for(const item of shared)results.push(await client.write(item.key,item.value,{background:true}));
      if(rest.length)results.push(await original.dbBatchSet(rest));
      return {success:results.every(r=>r&&r.success),results};
    }
    api.dbBatchSet=items=>split(items,items.filter(x=>x.scope==='common'&&isShared(x.key)),items.filter(x=>x.scope!=='common'||!isShared(x.key)));
    if(original.jsonFlush)api.jsonFlush=async items=>{
      const results=[];for(const item of items.filter(x=>x.common&&isShared(x.key)))results.push(await client.write(item.key,item.data,{background:true}));
      const rest=items.filter(x=>!x.common||!isShared(x.key));if(rest.length)results.push(await original.jsonFlush(rest));
      return {success:results.every(r=>r&&r.success!==false),results};
    };
    api.medicationSettingsWriteMany=items=>client.writeMany(items);
    api.sharedSettingsKeys=()=>KEYS.slice();
    api.sharedSettingsSync=values=>client.sync(values);
    return api;
  }
  return {KEYS,isShared,lsKey,createClient,wrap};
});
