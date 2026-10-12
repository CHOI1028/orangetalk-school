/* Host-backed rental records with durable, ordered client mutations. */
import { bus } from '../../core/event-bus.js';
const RECORDS='ec_rental_records', ITEMS='ec_rental_items';
const MARKER='ec_rental_shared_v1', BACKUP='ec_rental_legacy_backup_v1';
const OP_PREFIX='ec_rental_pending_v1_', RECOVERY_PREFIX='ec_rental_recovery_v1_';
const DEFAULT_ITEMS=['핫팩','아이스팩','얼음팩','목발','휠체어','체온계','혈압계'];
const FIELDS=['personId','item','borrowDate','borrowTime','returnDate','returnTime','returned','returnedAt','sourceKey'];
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function identity(){return 'r_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
function normalize(row){const out={id:Number(row.id)};for(const field of FIELDS)out[field]=field==='returned'?row[field]===true:String(row[field]==null?'':row[field]);return out;}
function readArray(key,fallback){const raw=localStorage.getItem(key);if(raw==null)return copy(fallback);const data=JSON.parse(raw);if(!Array.isArray(data))throw new Error('기존 대여 자료 형식을 확인해야 합니다. 원본은 유지했습니다.');return data;}
export function rentalLocalSnapshot(){try{return {records:readArray(RECORDS,[]).map(normalize),items:readArray(ITEMS,DEFAULT_ITEMS)};}catch(_){return {records:[],items:DEFAULT_ITEMS.slice()};}}
let view=rentalLocalSnapshot(), canonical=null, queue=[], initial=null, worker=null, refreshing=null;
let ready=false, writer=identity(), sequence=0, message='공용 대여 자료를 불러오고 있습니다.', lastError='';
const listeners=new Set();
function editing(){const n=document.activeElement;return !!(document.getElementById('rentalLedgerOverlay')&&(document.querySelector('#advSearchOverlay,#clockPickerWrap,#trCalWrap')||(n&&n.closest&&n.closest('#rentalLedgerOverlay')&&(n.matches('input,textarea,select')||n.isContentEditable))));}
function status(){return {ready,pending:queue.length,error:lastError,message};}
export function rentalSharedStatus(){return status();}
function announce(text,error=''){message=text;lastError=error;for(const listener of listeners)listener.status&&listener.status(status());}
function changed(){for(const listener of listeners)listener.change&&listener.change(copy(view));bus.emit('render:dashboard');}
export function subscribeRentalShared(listener){listeners.add(listener);listener.status&&listener.status(status());return ()=>listeners.delete(listener);}
function mirror(){localStorage.setItem(RECORDS,JSON.stringify(view.records));localStorage.setItem(ITEMS,JSON.stringify(view.items));}
function adopt(data,force=false){
  if(canonical&&canonical.ledgerId===data.ledgerId&&canonical.revision>data.revision)return;
  canonical=copy(data);
  if(queue.length || (!force&&editing()))return;
  const next={records:data.records.map(normalize),items:data.items.slice()};
  const different=!same(view,next);view=next;mirror();if(different||force)changed();
}
async function request(payload){
  const api=window.electronAPI;
  if(!api||typeof api.rentalLedger!=='function')throw new Error('공용 대여 기능을 사용하려면 메인 PC 프로그램을 업데이트해 주세요.');
  const result=await api.rentalLedger(payload);
  if(!result||typeof result.success!=='boolean')throw new Error('공용 대여 서버의 응답을 확인하지 못했습니다.');
  return result;
}
function requireSuccess(result){if(!result.success){const error=new Error(result.error||'공용 대여 자료를 저장하지 못했습니다.');error.code=result.code;throw error;}return result.data;}
function localOperations(ledgerId){
  const result=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key||!key.startsWith(OP_PREFIX))continue;
    const entry=JSON.parse(localStorage.getItem(key));
    if(entry&&entry.payload&&entry.payload.ledgerId===ledgerId)result.push({key,payload:entry.payload});
  }
  // Keep each writer's sequence intact, including operations restored after a restart.
  return result.sort((a,b)=>a.payload.clientId.localeCompare(b.payload.clientId)||a.payload.sequence-b.payload.sequence);
}
function overlayPending(data){
  const next={records:data.records.map(normalize),items:data.items.slice()};
  for(const entry of queue){
    for(const change of entry.payload.changes){
      const id=(change.after||change.before).id, index=next.records.findIndex(r=>r.id===id);
      if(change.after){if(index<0)next.records.push(copy(change.after));else next.records[index]=copy(change.after);}
      else if(index>=0)next.records.splice(index,1);
    }
    next.items=next.items.filter(item=>!entry.payload.itemsRemove.includes(item));
    for(const item of entry.payload.itemsAdd)if(!next.items.includes(item))next.items.push(item);
  }
  return next;
}
async function initialize(){
  if(ready)return;
  if(initial)return initial;
  initial=(async()=>{
    announce('공용 대여 자료를 불러오고 있습니다.');
    let result=await request({action:'read'}), data=requireSuccess(result);
    const marker=JSON.parse(localStorage.getItem(MARKER)||'null');
    if(!marker){
      // Keep exact original strings before normalizing, importing, or replacing the cache.
      if(!localStorage.getItem(BACKUP))localStorage.setItem(BACKUP,JSON.stringify({records:localStorage.getItem(RECORDS),items:localStorage.getItem(ITEMS),savedAt:new Date().toISOString()}));
      // Distinguish a new browser (null) from an intentionally empty saved list ([]).
      // The host alone decides whether initial defaults should be created.
      const legacy={records:readArray(RECORDS,[]),items:localStorage.getItem(ITEMS)===null?null:readArray(ITEMS,[])};
      let source=localStorage.getItem('ec_rental_migration_source_v1');
      if(!source){source=identity();localStorage.setItem('ec_rental_migration_source_v1',source);}
      result=await request({action:'migrate',ledgerId:data.ledgerId,sourceId:source,...legacy});
      data=requireSuccess(result);
    } else if(marker.ledgerId!==data.ledgerId){
      localStorage.setItem(RECOVERY_PREFIX+identity(),JSON.stringify({reason:'ledger_changed',ledgerId:marker.ledgerId,records:localStorage.getItem(RECORDS),items:localStorage.getItem(ITEMS)}));
      bus.emit('toast:show',{text:'연결된 공용 대장이 변경되어 이전 기기의 대여 자료는 별도로 보존했습니다.'});
    }
    localStorage.setItem(MARKER,JSON.stringify({ledgerId:data.ledgerId}));
    canonical=copy(data);queue=localOperations(data.ledgerId);view=overlayPending(data);mirror();ready=true;changed();
    if(queue.length)await drain();
    else announce('공용 대여 자료와 연결되었습니다.');
  })().catch(error=>{announce(error.message,error.message);throw error;}).finally(()=>{initial=null;});
  return initial;
}
function preserveConflict(result){
  const backupKey=RECOVERY_PREFIX+identity();
  localStorage.setItem(backupKey,JSON.stringify({reason:result.code||'conflict',savedAt:new Date().toISOString(),draft:view,operations:queue,ledgerId:canonical.ledgerId}));
  for(const entry of queue)localStorage.removeItem(entry.key);
  queue=[];writer=identity();sequence=0;
  if(result.data)adopt(result.data,true);
  const text=(result.error||'다른 PC의 변경 내용과 겹쳤습니다.')+' 현재 PC의 미반영 내용은 별도로 보존했습니다.';
  announce(text,text);bus.emit('toast:show',{text});
}
async function drain(){
  if(worker)return worker;
  worker=(async()=>{
    while(queue.length){
      announce('공용 대장에 저장 중입니다. ('+queue.length+'건)');
      const entry=queue[0], result=await request(entry.payload);
      if(!result.success){
        if(result.code==='conflict'||result.code==='ledger_changed'||result.code==='sequence_gap')preserveConflict(result);
        throw new Error(result.error||'공용 대장에 저장하지 못했습니다.');
      }
      // Remove the durable operation only after the host confirms the transaction.
      localStorage.removeItem(entry.key);queue.shift();if(!canonical||canonical.ledgerId!==result.data.ledgerId||canonical.revision<=result.data.revision)canonical=copy(result.data);
    }
    if(canonical)adopt(canonical);
    announce('공용 대장에 저장되었습니다.');
  })().catch(error=>{
    if(queue.length)announce('공용 저장을 완료하지 못했습니다. 변경 내용은 이 기기에 보관되며 연결 후 다시 전송합니다.',error.message);
    throw error;
  }).finally(()=>{worker=null;});
  return worker;
}
export async function ensureRentalShared(){await initialize();if(queue.length)await drain();return copy(view);}
export async function refreshRentalShared(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    await ensureRentalShared();
    if(editing())return copy(view);
    const data=requireSuccess(await request({action:'read'}));
    if(canonical&&canonical.ledgerId!==data.ledgerId){ready=false;await initialize();return copy(view);}
    adopt(data);announce('공용 대여 자료와 연결되었습니다.');return copy(view);
  })().catch(error=>{announce(queue.length?'아직 공용 저장이 끝나지 않았습니다. 연결 후 다시 전송합니다.':'공용 대여 자료를 확인하지 못했습니다. 마지막 목록을 유지합니다.',error.message);throw error;}).finally(()=>{refreshing=null;});
  return refreshing;
}
function enqueue(changes,itemsAdd,itemsRemove,next){
  if(!ready||!canonical)throw new Error('공용 대여 자료를 불러온 뒤 다시 시도해 주세요.');
  if(!changes.length&&!itemsAdd.length&&!itemsRemove.length)return queue.length?drain():Promise.resolve();
  const payload={action:'commit',ledgerId:canonical.ledgerId,clientId:writer,sequence:sequence+1,changes,itemsAdd,itemsRemove};
  const key=OP_PREFIX+writer+'_'+payload.sequence;
  localStorage.setItem(key,JSON.stringify({payload}));
  sequence++;queue.push({key,payload});view=copy(next);mirror();
  return drain();
}
export function saveRentalShared(records,itemList){
  const next={records:records.map(normalize),items:[...new Set(itemList.map(s=>String(s).trim()).filter(Boolean))]};
  const before=new Map(view.records.map(r=>[r.id,r])), after=new Map(next.records.map(r=>[r.id,r])), changes=[];
  for(const [id,row] of after){const previous=before.get(id)||null;if(!same(previous,row))changes.push({before:previous,after:row});}
  for(const [id,row] of before)if(!after.has(id))changes.push({before:row,after:null});
  return enqueue(changes,next.items.filter(s=>!view.items.includes(s)),view.items.filter(s=>!next.items.includes(s)),next);
}
export async function deleteSharedRentalRecords(rows){
  await ensureRentalShared();
  const ids=new Set(rows.map(r=>Number(r.id)));
  // Compare the records the user actually confirmed, not newer unseen replacements.
  const changes=rows.map(r=>({before:normalize(r),after:null}));
  return enqueue(changes,[],[],{records:view.records.filter(r=>!ids.has(r.id)),items:view.items.slice()});
}
export async function commitKioskRental(action,fields){
  await ensureRentalShared();
  const result=await request({action,ledgerId:canonical.ledgerId,...fields});
  const data=requireSuccess(result);adopt(data);announce('공용 대장에 저장되었습니다.');
  return result.recordId;
}
export function newRentalRecordId(){
  const bytes=new Uint32Array(2);let id;
  if(globalThis.crypto&&crypto.getRandomValues){crypto.getRandomValues(bytes);id=bytes[0]*65536+(bytes[1]&65535);}
  else id=Date.now()*1000+Math.floor(Math.random()*1000);
  return id||1;
}
function refreshQuietly(){if(!document.hidden)refreshRentalShared().catch(()=>{});}
setTimeout(refreshQuietly,0);
setInterval(refreshQuietly,5000);
window.addEventListener('online',refreshQuietly);
window.addEventListener('focus',refreshQuietly);
document.addEventListener('visibilitychange',refreshQuietly);
document.addEventListener('focusout',event=>{if(event.target.closest&&event.target.closest('#rentalLedgerOverlay'))setTimeout(refreshQuietly,350);});
bus.on('rental:refresh',refreshQuietly);
window.addEventListener('beforeunload',event=>{if(queue.length){event.preventDefault();event.returnValue='';}});
