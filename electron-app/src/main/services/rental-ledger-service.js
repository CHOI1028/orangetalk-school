/* Shared school rental ledger. All mutations are atomic on the host SQLite DB. */
'use strict';
const crypto = require('crypto');
const KEY = 'rental_ledger_v1';
const DEFAULT_ITEMS = ['핫팩','아이스팩','얼음팩','목발','휠체어','체온계','혈압계'];
const FIELDS = ['personId','item','borrowDate','borrowTime','returnDate','returnTime','returned','returnedAt','sourceKey'];
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function token(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(value)) throw new Error('Invalid rental client identity');
  return value;
}
function record(input) {
  if (!input || !Number.isSafeInteger(Number(input.id)) || Number(input.id) <= 0) throw new Error('Invalid rental record identity');
  const row = { id:Number(input.id) };
  for (const field of FIELDS) {
    if (field === 'returned') { row[field] = input[field] === true; continue; }
    const value = input[field] == null ? '' : String(input[field]);
    const limit = field === 'sourceKey' ? 500 : field === 'item' ? 300 : 200;
    if (value.length > limit) throw new Error('Rental field is too long: ' + field);
    row[field] = value;
  }
  return row;
}
function items(input) {
  if (!Array.isArray(input) || input.length > 5000) throw new Error('Invalid rental item list');
  const result=[];
  for (const entry of input) {
    if (typeof entry !== 'string' || entry.length > 300) throw new Error('Invalid rental item');
    const value=entry.trim();
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}
function allocateId(records) {
  let id;
  do { id=parseInt(crypto.randomBytes(6).toString('hex'),16); } while (!id || records.some(r=>r.id===id));
  return id;
}
function read(store) {
  const saved=store.get('common',KEY);
  if (!saved.exists) {
    const data={schema:1,ledgerId:crypto.randomUUID(),revision:0,records:[],items:[],imports:{},migrations:{},receipts:{}};
    store.set('common',KEY,data);
    return data;
  }
  const data=saved.data;
  if (!data || data.schema!==1 || typeof data.ledgerId!=='string' || !Array.isArray(data.records) || !Array.isArray(data.items) || !data.imports || !data.migrations || !data.receipts) throw new Error('Rental ledger could not be read; existing data was not changed');
  return data;
}
function publicState(data) {
  return {ledgerId:data.ledgerId,revision:data.revision,records:clone(data.records),items:data.items.slice()};
}
function conflict(data,message) { return {success:false,code:'conflict',error:message,data:publicState(data)}; }
function rentalLedgerRequest(store, request={}) {
  try {
    return store.db.transaction(()=>{
      const data=read(store);
      const original=clone(data);
      if (request.action==='read') return {success:true,data:publicState(data)};
      if (request.ledgerId!==data.ledgerId) return {success:false,code:'ledger_changed',error:'The shared rental ledger has changed',data:publicState(data)};
      if (request.action==='migrate') {
        const source=token(request.sourceId);
        if (data.migrations[source]) return {success:true,data:publicState(data),imported:0};
        if (!Array.isArray(request.records) || request.records.length>100000) throw new Error('Invalid legacy rental records');
        // A new browser has no legacy item list. Seed defaults only for the very
        // first migration, inside this transaction, never from a stale client read.
        const firstMigration=Object.keys(data.migrations).length===0;
        const legacyItems=request.items===null?(firstMigration?DEFAULT_ITEMS:[]):request.items;
        const incoming=request.records.map(record), incomingItems=items(legacyItems);
        let imported=0,collisions=0;
        for (const row of incoming) {
          const fingerprint=crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
          if (data.imports[fingerprint]) continue;
          const existing=data.records.find(r=>r.id===row.id);
          if (!existing || !same(existing,row)) {
            if (existing) { row.id=allocateId(data.records); collisions++; }
            data.records.push(row); imported++;
          }
          data.imports[fingerprint]=true;
        }
        for(const item of incomingItems) if(!data.items.includes(item)) data.items.push(item);
        data.migrations[source]=true;
        data.revision++;
        store.set('common',KEY,data);
        return {success:true,data:publicState(data),imported,collisions};
      }
      if (request.action==='kiosk-borrow'||request.action==='kiosk-return') {
        const source=String(request.sourceKey||'');
        if(!source||source.length>500)throw new Error('Invalid kiosk reception identity');
        const receiptKey=crypto.createHash('sha256').update(request.action+':'+source).digest('hex');
        const receipts=data.kioskReceipts||(data.kioskReceipts={});
        if(receipts[receiptKey])return {success:true,data:publicState(data),recordId:receipts[receiptKey]};
        let target;
        if(request.action==='kiosk-borrow'){
          target=record({...request.record,sourceKey:source});
          if(!target.personId||!target.item)throw new Error('대여할 방문자와 물품을 확인해 주세요.');
          const duplicate=data.records.find(r=>r.sourceKey===source);
          if(duplicate)target=duplicate;
          else {if(data.records.some(r=>r.id===target.id))target.id=allocateId(data.records);data.records.push(target);}
        }else{
          const personId=String(request.personId||''), item=String(request.item||'').trim();
          if(!personId)throw new Error('반납할 방문자를 확인해 주세요.');
          target=data.records.slice().reverse().find(r=>!r.returned&&r.personId===personId&&(!item||r.item.trim()===item));
          if(!target)return {success:false,code:'not_found',error:'해당 방문자와 물품의 미반납 기록이 없습니다. 대장을 확인해 주세요.',data:publicState(data)};
          target.returned=true;target.returnedAt=String(request.returnedAt||'').slice(0,40);
        }
        receipts[receiptKey]=target.id;data.revision++;
        store.set('common',KEY,data);
        return {success:true,data:publicState(data),recordId:target.id};
      }
      if (request.action!=='commit') throw new Error('Unknown rental action');
      const client=token(request.clientId), sequence=request.sequence;
      if (!Number.isSafeInteger(sequence) || sequence<1) throw new Error('Invalid rental change sequence');
      const previous=Number(data.receipts[client]||0);
      if (sequence<=previous) return {success:true,data:publicState(data)};
      if (sequence!==previous+1) return {success:false,code:'sequence_gap',error:'Earlier rental changes must be saved first',data:publicState(data)};
      if (!Array.isArray(request.changes) || request.changes.length>100000) throw new Error('Invalid rental changes');
      const added=items(request.itemsAdd||[]), removed=items(request.itemsRemove||[]), seen=new Set();
      for(const change of request.changes) {
        const before=change.before==null?null:record(change.before);
        const after=change.after==null?null:record(change.after);
        const id=after?after.id:before&&before.id;
        if(!id || seen.has(id) || (before&&after&&before.id!==after.id)) throw new Error('Invalid rental record change');
        seen.add(id);
        const index=data.records.findIndex(r=>r.id===id), current=index<0?null:data.records[index];
        if(!before) {
          // A kiosk reception can be handled by two PCs; keep one shared record.
          if(after.sourceKey && data.records.some(r=>r.sourceKey===after.sourceKey)) continue;
          if(current && !same(current,after)) return conflict(original,'다른 PC에 같은 번호의 대여 기록이 있습니다.');
          if(!current) data.records.push(after);
        } else if(!after) {
          if(current && !same(current,before)) return conflict(original,'다른 PC에서 수정한 기록은 삭제하지 않았습니다.');
          if(current) data.records.splice(index,1);
        } else {
          if(!current) return conflict(original,'다른 PC에서 삭제한 기록은 다시 만들지 않았습니다.');
          if(before.sourceKey!==after.sourceKey) throw new Error('Rental reception identity cannot be changed');
          for(const field of FIELDS) {
            if(same(before[field],after[field])) continue;
            if(!same(current[field],before[field]) && !same(current[field],after[field])) return conflict(original,'다른 PC에서 같은 항목을 수정했습니다. 최신 내용을 확인해 주세요.');
            current[field]=after[field];
          }
        }
      }
      data.items=data.items.filter(item=>!removed.includes(item));
      for(const item of added) if(!data.items.includes(item)) data.items.push(item);
      data.receipts[client]=sequence;
      data.revision++;
      store.set('common',KEY,data);
      return {success:true,data:publicState(data)};
    }).immediate();
  } catch(error) { return {success:false,code:'storage_error',error:error.message}; }
}
module.exports={rentalLedgerRequest};
