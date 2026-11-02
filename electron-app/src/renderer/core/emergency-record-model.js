/* Shared emergency-record normalization. No storage or application side effects. */
export function normalizeEmergencyRecord(r={}){
  let extra={};try{extra=typeof r.extra_json==='string'?JSON.parse(r.extra_json)||{}:r.extra_json||{};}catch(_){}
  const ai=r.accidentInfo||{},tr=r.transfer||{},v=r.vitals&&typeof r.vitals==='object'?r.vitals:{};
  const date=r.accidentDate??r.accident_date??'';const time=r.accidentTime??r.accident_time??'';
  const blank={time:'',temp:'',pulse:'',bp:'',resp:'',spo2:'',bst:''};
  const first={time:v.time??'',temp:v.temp??r.vital_temp??'',pulse:v.pulse??r.vital_pulse??'',bp:v.bp??r.vital_bp??'',resp:v.resp??r.vital_resp??'',spo2:v.spo2??r.vital_spo2??'',bst:v.bst??r.vital_bst??''};
  const list=Array.isArray(r.vitalsList)&&r.vitalsList.length?r.vitalsList:Array.isArray(extra.vitalsList)&&extra.vitalsList.length?extra.vitalsList:[first];
  return Object.assign({},r,{
    studentId:r.studentId??r.personUid??r.person_uid??'',
    date:(ai.datetime||'').split(/[ T]/)[0]||date||r.date||r.authorDate||r.author_date||'',
    clientRequestId:r.clientRequestId??extra.clientRequestId??'',
    displayGrade:r.displayGrade??extra.displayGrade,displayNum:r.displayNum??extra.displayNum,displayGender:r.displayGender??extra.displayGender,
    accidentInfo:Object.assign({},ai,{datetime:ai.datetime??(date+(time?' '+time:'')),location:ai.location??r.location??'',situation:ai.situation??r.situation??''}),
    vitals:Object.assign({},blank,first),vitalsList:list.map(m=>Object.assign({},blank,m)),
    transfer:Object.assign({},tr,{transferred:tr.transferred??!!(r.isTransported??r.is_transported),method:tr.method??r.transportMethod??r.transport_method??'',facility:tr.facility??r.transportDest??r.transport_dest??''}),
    patientStatus:r.patientStatus??r.patient_status??'',consciousness:r.consciousness??'명료',
    guardianContact:r.guardianContact??r.guardian_contact??'',homeroomTeacher:r.homeroomTeacher??r.homeroom_teacher??'',
    authorDate:r.authorDate??r.author_date??'',authorName:r.authorName??r.author_name??'',
    photoData:r.photoData??extra.photoData??'',notes:r.notes??r.memo??'',
    recConsciousness:r.recConsciousness??extra.recConsciousness??'',consciousnessEtc:r.consciousnessEtc??extra.consciousnessEtc??'',recConsciousnessEtc:r.recConsciousnessEtc??extra.recConsciousnessEtc??''
  });
}
export function mergeEmergencySnapshot(incoming,current=[]){
  const protectedRecord=r=>r&&(r._clinicalEditing||r._dirty||r._saving||r._inserting||r._pendingUpdate);
  const local=new Map(current.map(r=>[String(r.id),r]));const retained=new Set();
  const rows=incoming.map(raw=>{
    const r=normalizeEmergencyRecord(raw);
    const old=(r.clientRequestId&&current.find(x=>x.clientRequestId===r.clientRequestId))||local.get(String(r.id));
    const samePerson=old&&String(old.studentId||old.personUid||old.person_uid||'')===String(r.studentId);
    const sameToken=old&&(!old.clientRequestId||!r.clientRequestId||old.clientRequestId===r.clientRequestId);
    if(samePerson&&sameToken&&protectedRecord(old)){retained.add(old);return old;}
    return r;
  });
  current.forEach(r=>{if(!retained.has(r)&&protectedRecord(r))rows.push(r);});
  return rows;
}

// Read only the clinical draft keys. Recovery never writes to the DB automatically.
export function restoreEmergencyDrafts(incoming,current=[],storage){
  const saved=incoming.map(normalizeEmergencyRecord), live=current.slice(), drafts=new Map();
  try{
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i);if(!key||!key.startsWith('ec_form_draft_EC_'))continue;
      try{
        const value=JSON.parse(storage.getItem(key));
        if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isFinite(Number(value.id))||!Number(value.id)||!(value.studentId||value.personUid||value.person_uid))continue;
        const rec=normalizeEmergencyRecord(value);
        const identity=rec.clientRequestId?'token:'+rec.clientRequestId:('id:'+(rec._dbId||rec.id)+':'+rec.studentId);
        const prior=drafts.get(identity),keys=[...(prior?prior.keys:[]),key];
        if(!prior||Number(rec._draftSavedAt||0)>=Number(prior.rec._draftSavedAt||0))drafts.set(identity,{rec,keys});
        else prior.keys=keys;
      }catch(_){} // Keep malformed entries intact for manual recovery.
    }
  }catch(_){} // An unavailable cache must not prevent loading saved records.
  let nextId=Math.max(0,...saved.concat(live).map(r=>Number(r.id)||0));
  for(const {rec,keys} of drafts.values()){
    const active=live.find(r=>r.studentId===rec.studentId&&(rec.clientRequestId?r.clientRequestId===rec.clientRequestId:String(r.id)===String(rec.id)));
    if(active&&(active._clinicalEditing||active._dirty||active._saving)){
      active._recoveredDraftKeys=[...new Set([...(active._recoveredDraftKeys||[]),...keys])];continue;
    }
    const durable=saved.find(r=>rec.clientRequestId&&r.clientRequestId===rec.clientRequestId&&r.studentId===rec.studentId)||saved.find(r=>rec._dbId&&r.id===rec._dbId&&r.studentId===rec.studentId&&(!rec.clientRequestId||!r.clientRequestId||r.clientRequestId===rec.clientRequestId));
    if(durable){rec.id=durable.id;rec._dbId=durable._dbId||durable.id;}
    else if(saved.concat(live).some(r=>String(r.id)===String(rec.id)&&
      (r.studentId!==rec.studentId||(r.clientRequestId&&r.clientRequestId!==rec.clientRequestId)))||
      (!rec._dbId&&saved.some(r=>String(r.id)===String(rec.id)))){
      // A provisional ID is not a durable identity; never replace another person's record.
      if(saved.some(r=>r.id===rec._dbId&&(r.studentId!==rec.studentId||(r.clientRequestId&&rec.clientRequestId&&r.clientRequestId!==rec.clientRequestId))))delete rec._dbId;
      rec.id=++nextId;
    }
    // Never revive in-flight flags from a process that has already ended.
    delete rec._saving;delete rec._inserting;delete rec._pendingUpdate;delete rec._clinicalEditing;
    rec._dirty=true;rec._draftRecovered=true;rec._recoveredDraftKeys=keys;
    const index=live.findIndex(r=>r.id===rec.id);
    if(index>=0)live[index]=rec;else live.push(rec);
  }
  return mergeEmergencySnapshot(saved,live);
}
