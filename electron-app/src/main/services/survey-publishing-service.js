'use strict';
const crypto = require('crypto');
const model = require('../../shared/survey-model');

class SurveyPublishingService {
  constructor(store, responses, { fetchImpl = globalThis.fetch } = {}) {
    this.store = store; this.responses = responses; this.fetch = fetchImpl; this.syncing = new Map();
  }
  connection(value) {
    if(!value || !value.channelId || !value.authToken) throw new Error('환경설정의 키오스크에서 학교 릴레이 연결을 먼저 설정해 주세요.');
    const url = new URL(value.relayUrl);
    if(url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('릴레이 서버 주소를 확인하세요.');
    if(url.protocol !== 'https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('외부 설문 서버에는 HTTPS 주소를 사용해 주세요.');
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value.channelId)) throw new Error('학교 채널을 확인하세요.');
    return { relayUrl:url.origin, channelId:value.channelId, authToken:value.authToken };
  }
  async request(connection, formId, suffix, method = 'GET', body) {
    const base = connection.relayUrl+'/api/v1/surveys/channels/'+encodeURIComponent(connection.channelId)+'/forms/'+encodeURIComponent(formId);
    const response = await this.fetch(base+suffix, { method, redirect:'error', signal:AbortSignal.timeout(20000), headers:{ Authorization:'Bearer '+connection.authToken, 'Content-Type':'application/json' }, ...(body ? { body:JSON.stringify(body) } : {}) });
    // Never include response bodies or credentials in errors shown to the renderer.
    if(response.status===404) throw new Error('릴레이 서버에 설문 기능이 아직 설치되지 않았거나 설문이 없습니다.');
    if(response.status===401 || response.status===403) throw new Error('학교 릴레이 인증을 확인해 주세요.');
    const data = await response.json();
    if(!response.ok || !data.success) throw new Error(data.error || '설문 서버 요청에 실패했습니다.');
    return data;
  }
  key(id) { if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('설문 ID가 잘못되었습니다.'); return 'survey_publication:'+id; }
  get(id) { const result = this.store.get('common',this.key(id)); return result.exists ? result.data : null; }
  set(id,value) { const result=this.store.set('common',this.key(id),value);if(!result||!result.success)throw new Error(result&&result.error||'설문 게시 정보를 저장하지 못했습니다.'); }
  async publish({ connection, draft, recipients = [], year }) {
    model.validateDefinition(draft); const formId=draft.formId; this.key(formId);
    const conn=this.connection(connection), old=this.get(formId);
    if(old && (old.connection.relayUrl!==conn.relayUrl || old.connection.channelId!==conn.channelId)) throw new Error('이 설문은 다른 학교 채널에 게시되어 있습니다. 새 설문으로 만들어 주세요.');
    const result=await this.request(conn,formId,'','PUT',{definition:draft});
    if(!/^\/s\/[a-zA-Z0-9_-]{20,100}$/.test(result.path || '')) throw new Error('서버의 설문 주소가 올바르지 않습니다.');
    const record={ connection:conn, formId, year:String(year), recipients, definition:JSON.parse(JSON.stringify(draft)), url:conn.relayUrl+result.path, version:result.version, closed:false };
    this.set(formId,record);
    return { success:true, url:record.url, version:record.version };
  }
  async close(formId) {
    const record=this.get(formId); if(!record) return { success:true };
    await this.request(record.connection,formId,'/close','POST',{}); record.closed=true; this.set(formId,record); return { success:true };
  }
  sync(formId) {
    if(this.syncing.has(formId)) return this.syncing.get(formId);
    const task=this._sync(formId).finally(()=>this.syncing.delete(formId)); this.syncing.set(formId,task); return task;
  }
  async _sync(formId) {
    const record=this.get(formId); if(!record) return { success:true, count:0, unpublished:true };
    let count=0, unmatched=0;
    for(let page=0;page<200;page++) {
      const result=await this.request(record.connection,formId,'/responses');
      if(!Array.isArray(result.responses)) throw new Error('서버 응답 형식이 올바르지 않습니다.');
      if(!result.responses.length) return { success:true, count, unmatched };
      const ids=[];
      for(const r of result.responses) {
        const student=r.student;
        if(!student || !r.id || typeof student.name!=='string') throw new Error('학생 응답 정보를 확인할 수 없습니다.');
        const candidates=record.recipients.filter(p=>String(p.name).trim()===student.name.trim() && Number(p.grade)===student.grade && Number(p.cls)===student.cls && Number(p.num)===student.num);
        const person=candidates.length===1?candidates[0]:null;
        if(!person) unmatched++;
        const identity=crypto.createHash('sha256').update(JSON.stringify([student.name.trim(),student.grade,student.cls,student.num])).digest('hex');
        const saved=this.responses.save({school_year:record.year, form_id:formId, form_version:r.version, person_uid:person&&person.uid||null, student_persistent_id:person&&person.uid||'survey_'+identity, student_name:student.name.trim(), grade:student.grade, class_num:student.cls, student_num:student.num, responded_at:r.submittedAt, status:person?'completed':'unmatched'}, model.validateResponses(record.definition,r.answers));
        if(!saved || !saved.success) throw new Error('응답을 로컬에 저장하지 못했습니다. 다시 가져오면 이어서 처리됩니다.');
        ids.push(r.id); count++;
      }
      // Delete server-side answer payloads only after all local writes succeeded. Retried imports are upserts.
      await this.request(record.connection,formId,'/ack','POST',{ids});
    }
    return { success:true, count, unmatched, remaining:true };
  }
}
module.exports={ SurveyPublishingService };
