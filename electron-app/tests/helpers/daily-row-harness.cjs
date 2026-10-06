const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function section(s,a,b){const start=s.indexOf(a),end=s.indexOf(b,start+a.length);if(start<0||end<0)throw Error(a);return s.slice(start,end).replace(/^export /gm,'');}
const daily=read('src/renderer/features/daily/daily-view.js');
const symptom=read('src/renderer/features/symptom/symptom-view.js');
const source=[
 read('src/renderer/core/daily-record-access.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),
 read('src/renderer/core/record-utils.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),
 section(symptom,'function _parseMedWithDose(','function _serializeMedWithDose('),
 section(symptom,'export function formatMedicationDisplay(','/* 투약 팝업'),
 section(daily,'export function renderDailyRecordRows(','/* Reuse the diary header'),
].join('\n');
function install(context){
  Object.assign(context,{
    _memoHasAny:()=>false,isBirthdayToday:()=>false,getCareTooltipHtml:()=>'',
    getStudentNameHoverHtml:s=>context.escHtml(s.name||''),getSymClass:()=> 'tag-blue',
    _vsExpandedRids:new Set(),_paExpandedRids:new Set(),_vsTableHtml:()=>'',_paTableHtml:()=>'',
  });
  vm.runInContext(source,context);
  context.renderDailyPeriodTable=(container,records,privacy,beforeAction)=>{
    container.beforeAction=beforeAction;
    container.innerHTML='<table><tbody>'+ (privacy?records.map(r=>'<tr><td>'+r.date+'</td><td>•••</td></tr>').join(''):context.renderDailyRecordRows(records,{period:true}))+'</tbody></table>';
  };
}
module.exports={install,source,section,read};
