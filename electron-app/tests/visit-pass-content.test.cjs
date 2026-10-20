/* 가상 기록만 사용하는 출력 항목 선택 회귀 검사. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = process.env.ORANGETALK_TEST_ROOT || path.resolve(__dirname, '..');
const acorn = require(path.join(root, 'node_modules/acorn'));
const snapshots = process.env.ORANGETALK_SOURCE_SNAPSHOT
  ? JSON.parse(fs.readFileSync(process.env.ORANGETALK_SOURCE_SNAPSHOT, 'utf8')) : null;
const read = f => snapshots && snapshots[f] !== undefined ? snapshots[f] : fs.readFileSync(path.join(root, f), 'utf8');
const source = read('src/renderer/features/visit-pass/visit-pass-editor.js');
const names = [
  'vpToggleContent', 'vpSyncAllToggle', '_vpAllOn', 'vpUpdateContentLabel', '_vpSyncContentBar',
  '_vpContentUnavailable', '_vpPersistVpState', '_vpGetSymTreatModes', '_vpSymTreatMode',
  '_vpSetSymTreatMode', '_vpDefaultContent', '_vpGetContentMap', '_vpLoadContentForFormat',
  '_vpSaveContentForFormat', '_vpGetTeacherCfgs', '_vpTeacherOrder', '_vpSetTeacherOrder',
  '_vpTeacherLinesHtml', '_vpUpdateTeacherChips', '_vpUpdateSymTreatComboChip',
  '_vpStdSymTreatVsRows', '_vpSymStr', '_vpFlatTreatArr', '_vpTreatStr', '_vpBodymapStr',
  '_vpVsStr', '_vpVsTimeSeriesHtml', '_vpVsBlockHtml', '_vpEscHtml', '_vpRenderSymTreatCell',
  '_vpBuildPersonBlock', '_vpGetTpl', '_vpResolveTokens', '_vpRenderConfirmBlock', '_vpRenderSigRow',
  'vpBuildDefaultTemplate', 'vpBuildMealRequestTemplate', 'vpBuildReferralTemplate',
  'vpBuildCustomTemplate', 'vpBuildPrintContent', '_vpComposePrintHtml', '_vpApplyReceiptMatchCss',
  'vpUpdatePreview', '_vpBindAllContentTips'
];
const constants = ['_VP_CONTENT_GROUPS', '_VP_PH', '_VP_TPL_DEFAULTS', '_VP_TEACHER_KEYS'];
const declarations = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.map(n => n.declaration || n);
const extracted = [];
for(const name of names){
  const n = declarations.find(n => n.id && n.id.name === name);
  if(!n) throw new Error('검사할 함수가 없습니다: ' + name);
  extracted.push(source.slice(n.start, n.end));
}
for(const name of constants){
  const n = declarations.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  if(!n) throw new Error('검사할 상수가 없습니다: ' + name);
  extracted.unshift(source.slice(n.start, n.end));
}
const bundle = extracted.join('\n');
function setupEnvironment(){
  globalThis.S = { settings: { schoolName: '출력검증학교', nurse1: '가상교사', schoolLevel: 'elementary' } };
  globalThis.vpState = { format: 'default', paper: 'a4', content: {date:true,timeIn:true,timeOut:true,symptoms:true,treatment:true,bodymap:false,vs:false,teacherSig:true}, sigMode:'sign', sigImage:'', reasonRemoved:{}, selectedStudent:{name:'가상학생',grade:2,cls:3,num:4}, selectedRecord:null };
  globalThis.vpeState = { slot:null };
  globalThis._vpLastContentFormat = 'default';
  globalThis._vpLastRenderFmt = 'default';
  globalThis._vpRcEditMode = true;
  globalThis.escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  globalThis.getDow = () => '수';
  globalThis.hasMultipleSchoolLevels = () => false;
  globalThis.hasAnyDepartment = () => false;
  globalThis.getLevelShort = () => '';
  globalThis.formatMedicationDisplay = s => String(s || '');
  globalThis.counselTreatText = r => r && r.counselMemo || '';
  globalThis.isCounselSymLabel = s => /상담/.test(s);
  globalThis.vpGetCustomNames = () => JSON.parse(localStorage.getItem('ec_vp_custom_names') || '{}');
  globalThis.vpGetCustomLabels = () => JSON.parse(localStorage.getItem('ec_vp_custom_labels') || '{}');
  globalThis.vpGetCustomBlocks = () => JSON.parse(localStorage.getItem('ec_vp_custom_blocks') || '{}');
  globalThis.vpGetCustomRows = () => JSON.parse(localStorage.getItem('ec_vp_custom_rows') || '{}');
  globalThis.bus = { emit(){} };
  globalThis.testWrites = [];
  globalThis.electronAPI = { dbSet:(...args) => { testWrites.push(args); return Promise.resolve(); } };
  for(const name of ['_vpSigPosLoad','_vpAttachCustomCellHandlers','_vpAttachTplHandlers','_vpBindTipPopup','vpDefZoomSet','_vpSetModeBadge','_vpDefRenderCutLine','_vpReceiptShowPrintFrame','_vpSigInitDrag']) globalThis[name] = () => {};
  globalThis._vpRcResetEdit = () => { globalThis._vpRcEditMode = true; };
}
function record(extra={}){
  return {date:'2026-10-14',timeIn:'09:10',timeOut:'09:20',symptoms:['검증증상'],treatment:['검증처치','투약'],medication:'검증약품',...extra};
}
function harness(saved={}){
  const data = new Map(Object.entries(saved).map(([k,v]) => [k, JSON.stringify(v)]));
  const context = {console, setTimeout:()=>0, clearTimeout(){}, localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}, document:{querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null}};
  context.window = context;
  vm.createContext(context);
  vm.runInContext('('+setupEnvironment.toString()+')();\n'+bundle, context);
  context.vpState.selectedRecord = record();
  return { context, data, render(fmt){
    context.vpState.format = fmt;
    if(/^custom\d+$/.test(fmt)) return context.vpBuildCustomTemplate(fmt);
    if(fmt === 'meal_request') return context.vpBuildMealRequestTemplate();
    if(fmt === 'referral') return context.vpBuildReferralTemplate();
    return context.vpBuildDefaultTemplate(fmt === 'rest_referral' ? {title:'보건실 안정 의뢰서',confirmKey:'restReferral'} : undefined);
  }};
}
function freezeDeep(o){if(o && typeof o === 'object'){Object.values(o).forEach(freezeDeep);Object.freeze(o);}return o;}

if(require.main === module){
  for(const fmt of ['default','rest_referral','meal_request','referral','custom1','custom7']){
    for(const mode of ['merge','split']){
      for(const [symptoms,treatment] of [[true,false],[false,true],[true,true],[false,false]]){
        test(`${fmt}/${mode}: 증상 ${symptoms}, 처치 ${treatment}가 실제 출력에 반영됨`, () => {
          const h = harness({'ec_vp_symtreat_mode':{[fmt]:mode}});
          Object.assign(h.context.vpState.content,{symptoms,treatment});
          const rec = freezeDeep(record()); h.context.vpState.selectedRecord = rec;
          const original = JSON.stringify(rec), html = h.render(fmt);
          assert.equal(html.includes('검증증상'), symptoms);
          assert.equal(html.includes('검증처치'), treatment);
          assert.equal(html.includes('검증약품'), treatment);
          if(!treatment) assert(!html.includes('처치내용'));
          if(!symptoms && !treatment) assert(!html.includes('증상·처치') && !html.includes('증상<br>처치'));
          assert.equal(JSON.stringify(rec), original);
          assert.equal(h.context._vpSymTreatMode(fmt), mode);
        });
      }
    }
  }
  for(const fmt of ['default','custom1']) for(const mode of ['merge','split']){
    test(`${fmt}/${mode}: 투약만 있는 기록과 증상별 처치도 누락하지 않음`, () => {
      const h = harness({'ec_vp_symtreat_mode':{[fmt]:mode}});
      h.context.vpState.selectedRecord = freezeDeep(record({symptoms:[],treatment:[],medication:'단독검증약품'}));
      assert(h.render(fmt).includes('단독검증약품'));
      h.context.vpState.selectedRecord = freezeDeep(record({symptoms:[],treatment:[],medication:'',treatmentBySym:{기록:['맵검증처치']}}));
      assert(h.render(fmt).includes('맵검증처치'));
    });
  }
  test('증상별 처치와 약품은 증상만 선택하면 모두 제외됨', () => {
    const h = harness(); const c=h.context;
    c.vpState.selectedRecord=freezeDeep(record({symptoms:['검증증상A','검증증상B'],treatmentBySym:{검증증상A:['검증처치','투약'],검증증상B:['검증처치B']},medsBySym:{검증증상A:['검증개별약품']}}));
    c.vpState.content.treatment=false;
    const html=h.render('default');
    assert(html.includes('검증증상A') && html.includes('검증증상B'));
    assert(!html.includes('검증처치') && !html.includes('검증개별약품') && !html.includes('검증약품'));
  });
  test('양식별 선택값과 기존 합침 모드가 독립적으로 저장됨', () => {
    const h=harness({'ec_vp_content_by_format':{default:{symptoms:true,treatment:false},custom1:{symptoms:false,treatment:true}},ec_vp_symtreat_mode:{default:'merge'}}),c=h.context;
    assert.equal(c._vpLoadContentForFormat('default').treatment,false);
    assert.equal(c._vpLoadContentForFormat('custom1').symptoms,false);
    c.vpState.content=c._vpLoadContentForFormat('default');c._vpSaveContentForFormat('default');
    const reloaded=harness(Object.fromEntries(Array.from(h.data,([k,v])=>[k,JSON.parse(v)]))).context;
    assert.equal(reloaded._vpLoadContentForFormat('default').treatment,false);
    assert.equal(reloaded._vpLoadContentForFormat('custom1').treatment,true);
    assert.equal(reloaded._vpSymTreatMode('default'),'merge');
    assert(c.testWrites.every(args=>args[0]==='common'));
  });
  test('이전 공통 선택 설정을 유지하며 신규 기본값만 보완함',()=>{
    const c=harness({ec_vp_content:{symptoms:false,treatment:false,date:false}}).context;
    const got=c._vpLoadContentForFormat('custom3');
    assert.equal(got.symptoms,false);assert.equal(got.treatment,false);assert.equal(got.date,false);assert.equal(got.timeIn,true);
  });
  test('교사 확인 순서와 사용자 지정 문구·라벨을 보존함',()=>{
    const h=harness({ec_vp_teacher_mode:{custom1:{order:['homeroom','nurse']}},ec_vp_custom_labels:{custom1:{처치내용:'비고'}},ec_vp_custom_blocks:{custom1:{confirm:'검증 사용자 문구'}}});
    const html=h.render('custom1');assert(html.includes('비고'));assert(html.includes('검증 사용자 문구'));assert(html.indexOf('담임교사 확인')<html.indexOf('vpSigInText'));assert(!html.includes('교과담당교사 확인'));
    h.context.vpState.content.treatment=false;assert(!h.render('custom1').includes('>비고<'));
  });
  test('사용하지 않는 시간 항목은 비활성화하되 저장값을 지우지 않음',()=>{
    const c=harness().context;c.vpState.format='meal_request';assert(c._vpContentUnavailable('timeIn'));assert.equal(c.vpState.content.timeIn,true);
    c.vpState.format='default';assert.equal(c._vpContentUnavailable('timeIn'),'');
  });
  test('시간대별 V/S만 있어도 선택 가능하고 실제 표에 출력됨',()=>{
    const h=harness(),c=h.context;c.vpState.selectedRecord=record({vsHistory:[{t:'09:10',temp:'36.5'},{t:'09:20',temp:'36.6'}]});c.vpState.content.vs=true;
    assert.equal(c._vpContentUnavailable('vs'),'');assert(h.render('default').includes('36.6'));assert(h.render('custom1').includes('36.5'));
    c.vpState.selectedRecord=record();assert(c._vpContentUnavailable('vs'));assert.equal(c.vpState.content.vs,true);
  });
  test('입실·퇴실시간과 방문일을 끄면 해당 행도 제외됨',()=>{
    const h=harness();Object.assign(h.context.vpState.content,{date:false,timeIn:false,timeOut:false});
    for(const fmt of ['default','rest_referral','custom1']){const html=h.render(fmt);for(const text of ['>방문일<','>입실시간<','>퇴실시간<','09:10','09:20'])assert(!html.includes(text));}
  });
  test('긴 문구와 HTML 기호를 원문 손실이나 태그 실행 없이 전달함',()=>{
    const text='긴 문구 '.repeat(100)+'<img src=x onerror=1> 마지막검증';const h=harness();h.context.vpState.selectedRecord=record({symptoms:[text],treatment:[text],medication:''});
    for(const fmt of ['default','custom1']){const html=h.render(fmt);assert(html.includes('마지막검증'));assert(html.includes('&lt;img'));assert(!html.includes('<img src=x'));}
  });
  test('기록이 없거나 증상 배열이 없는 커스텀 양식도 생성됨',()=>{
    const h=harness();h.context.vpState.selectedRecord=null;assert(h.render('custom1').includes('vp-info-table'));
    h.context.vpState.selectedRecord={date:'2026-10-14'};assert(h.render('custom1').includes('vp-info-table'));
  });
  test('A4와 영수증 출력은 동일 항목을 유지하며 긴 표의 행간 페이지 분리를 허용함',()=>{
    const h=harness();h.context.vpState.content.treatment=false;const html=h.render('default');
    for(const a4 of [true,false]){const print=h.context._vpComposePrintHtml(html,a4,0,true);assert(print.includes('검증증상'));assert(!print.includes('검증약품'));assert(print.includes('.vp-info-table{page-break-inside:auto;break-inside:auto}'));assert(print.includes('overflow-wrap:anywhere'));}
  });
}
module.exports={bundle,setupEnvironment,record,harness,read,root};
