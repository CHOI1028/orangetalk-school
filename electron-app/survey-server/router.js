'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const model = require('../src/shared/survey-model');

// Mount on the existing relay app. authenticate(channel, bearer) MUST validate the nurse token.
function createSurveyRouter({ dataDir, authenticate, now = () => new Date() }) {
  if (typeof authenticate !== 'function') throw new Error('Survey channel authentication is required');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const router = express.Router();
  const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const filename = id => path.join(dataDir, id + '.json');
  const read = id => { if (!safe(id) || !fs.existsSync(filename(id))) return null; return JSON.parse(fs.readFileSync(filename(id), 'utf8')); };
  const readPublic = id => /^[a-zA-Z0-9_-]{32}$/.test(id || '') ? read(id) : null;
  const write = doc => {
    const file = filename(doc.id), tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 }); fs.renameSync(tmp, file); }
    finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  };
  const fail = (res, status, error) => res.status(status).json({ success: false, error });
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  const limits = new Map();
  function rate(req, res, next) {
    const key = req.ip, time = now().getTime();
    if (limits.size > 10000) for (const [k,v] of limits) if(time - v.start >= 60000) limits.delete(k);
    let bucket = limits.get(key);
    if(!bucket || time - bucket.start >= 60000) { bucket = { start: time, count: 0 }; limits.set(key, bucket); }
    // Several classrooms can share one public IP (NAT). Opening and submitting each cost a request.
    if(++bucket.count > 600) return fail(res, 429, '요청이 많습니다. 잠시 후 다시 시도하세요.');
    next();
  }
  router.use(['/s','/api/v1/surveys'], (req,res,next) => {
    res.set('Cache-Control','no-store'); res.set('Referrer-Policy','no-referrer');
    res.set('X-Content-Type-Options','nosniff'); next();
  });
  router.get('/s/assets/model.js', (_req,res) => res.sendFile(path.resolve(__dirname,'../src/shared/survey-model.js')));
  router.use('/s/assets', express.static(path.join(__dirname,'public'), { index:false, dotfiles:'deny' }));
  router.get('/s/:id', (req,res) => {
    if(!readPublic(req.params.id)) return res.status(404).send('설문을 찾을 수 없습니다.');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.sendFile(path.join(__dirname,'public/index.html'));
  });
  function isOpen(doc) {
    const time = now().getTime(), d = doc.definition;
    const start = d.startDate ? new Date(d.startDate+'T00:00:00+09:00').getTime() : -Infinity;
    const end = d.endDate ? new Date(d.endDate+'T'+(d.endTime || '23:59')+':59+09:00').getTime() : Infinity;
    return !doc.closed && time >= start && time <= end;
  }
  router.get('/api/v1/surveys/public/:id', rate, (req,res) => {
    const doc = readPublic(req.params.id);
    if(!doc) return fail(res,404,'설문을 찾을 수 없습니다.');
    if(!isOpen(doc)) return fail(res,410,'응답 기간이 아니거나 마감된 설문입니다.');
    res.json({ success:true, definition:doc.definition, version:doc.version });
  });
  router.post('/api/v1/surveys/public/:id/responses', rate, express.json({ limit:'128kb' }), (req,res) => {
    const doc = readPublic(req.params.id), body = req.body || {};
    if(!doc) return fail(res,404,'설문을 찾을 수 없습니다.');
    if(!safe(body.submissionId) || body.submissionId.length < 20) return fail(res,400,'제출 식별자가 잘못되었습니다.');
    if(doc.receipts.includes(body.submissionId)) return res.json({ success:true, duplicate:true });
    if(!isOpen(doc)) return fail(res,410,'응답 기간이 아니거나 마감된 설문입니다.');
    if(body.version !== doc.version) return fail(res,409,'설문이 수정되었습니다. 새로고침 후 다시 응답해 주세요.');
    const student = body.student || {};
    if(typeof student.name !== 'string' || !student.name.trim() || student.name.length > 100 || !['grade','cls','num'].every(k => Number.isInteger(student[k]) && student[k] > 0 && student[k] < 1000)) return fail(res,400,'학생 이름, 학년, 반, 번호를 확인하세요.');
    let answers;
    try { answers = model.validateResponses(doc.definition, body.answers); }
    catch(e) { return fail(res,400,e.message); }
    if(doc.receipts.length >= 20000) return fail(res,409,'설문 응답 한도를 초과했습니다. 담당 선생님께 문의하세요.');
    doc.responses.push({ id:body.submissionId, student:{ name:student.name.trim(), grade:student.grade, cls:student.cls, num:student.num }, answers, submittedAt:now().toISOString(), version:doc.version });
    doc.receipts.push(body.submissionId);
    write(doc); res.status(201).json({ success:true });
  });
  router.use('/api/v1/surveys/channels/:channel', (req,res,next) => {
    const bearer = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
    if(!safe(req.params.channel) || !bearer) return fail(res,401,'교사 인증이 필요합니다.');
    Promise.resolve().then(() => authenticate(req.params.channel,bearer[1])).then(ok => {
      if(!ok) return fail(res,403,'설문 관리 권한이 없습니다.'); next();
    }).catch(next);
  }, express.json({ limit:'1mb' }));
  const base = '/api/v1/surveys/channels/:channel/forms/:form';
  const findOwned = req => {
    if(!safe(req.params.form)) return null;
    const id = crypto.createHash('sha256').update(req.params.channel+'\0'+req.params.form).digest('hex');
    const index = read('index_'+id);
    return index ? read(index.surveyId) : null;
  };
  router.put(base, wrap(async(req,res) => {
    if(!safe(req.params.form)) return fail(res,400,'설문 ID를 확인하세요.');
    const input = req.body && req.body.definition;
    try { model.validateDefinition(input); } catch(e) { return fail(res,400,e.message); }
    // Only definition fields are public. Never publish the editor's student selection or credentials.
    const definition = {};
    for(const key of ['title','desc','startDate','endDate','endTime','preQuestions','sections','languages','titleTranslations','descTranslations']) if(input[key] !== undefined) definition[key] = input[key];
    if(definition.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(definition.endTime)) return fail(res,400,'마감 시간을 확인하세요.');
    let doc = findOwned(req);
    if(doc && doc.receipts.length && JSON.stringify(definition) !== JSON.stringify(doc.definition)) return fail(res,409,'응답이 접수된 설문은 문항을 변경할 수 없습니다. 새 설문으로 만들어 주세요.');
    if(!doc) doc = { id:crypto.randomBytes(24).toString('base64url'), channel:req.params.channel, formId:req.params.form, version:0, responses:[], receipts:[] };
    if(JSON.stringify(definition) !== JSON.stringify(doc.definition)) doc.version++;
    doc.definition = definition; doc.closed = false; write(doc);
    const indexId = 'index_'+crypto.createHash('sha256').update(req.params.channel+'\0'+req.params.form).digest('hex');
    write({ id:indexId, surveyId:doc.id });
    res.json({ success:true, surveyId:doc.id, path:'/s/'+doc.id, version:doc.version });
  }));
  router.get(base+'/responses', (req,res) => {
    const doc = findOwned(req); if(!doc) return fail(res,404,'게시된 설문이 없습니다.');
    res.json({ success:true, responses:doc.responses.slice(0,100), remaining:doc.responses.length });
  });
  router.post(base+'/ack', (req,res) => {
    const doc = findOwned(req); if(!doc) return fail(res,404,'게시된 설문이 없습니다.');
    if(!req.body || !Array.isArray(req.body.ids) || req.body.ids.length > 100) return fail(res,400,'응답 식별자를 확인하세요.');
    const ids = new Set(req.body.ids); doc.responses = doc.responses.filter(r => !ids.has(r.id)); write(doc);
    res.json({ success:true });
  });
  router.post(base+'/close', (req,res) => {
    const doc = findOwned(req); if(!doc) return fail(res,404,'게시된 설문이 없습니다.');
    doc.closed = true; write(doc); res.json({ success:true });
  });
  router.use((err,req,res,next) => {
    if(!req.path.startsWith('/api/v1/surveys')) return next(err);
    fail(res, err.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500, '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
  });
  return router;
}
module.exports = { createSurveyRouter };
