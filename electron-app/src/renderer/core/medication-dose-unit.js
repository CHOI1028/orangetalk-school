// Unit edits affect only the active dose; existing records are not migrated.
export function normalizeMedicationUnit(value){
  const unit=String(value??'').trim();
  if(!unit||unit.length>12||!/[\p{L}%]/u.test(unit)||!/^[\p{L}%][\p{L}\s./%\-]*$/u.test(unit)){
    throw new Error('단위는 1~12자의 문자로 입력해 주세요. 예: 정, 캡슐, 매, mL');
  }
  return unit;
}
function splitDose(value){
  const text=String(value??'').trim();
  if(!text)return {amount:'',unit:''};
  const match=text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*\d+(?:\.\d*)?)?)\s*(.*)$/u);
  if(match){
    if(match[2])normalizeMedicationUnit(match[2]);
    return {amount:match[1],unit:match[2].trim()};
  }
  return {amount:'',unit:normalizeMedicationUnit(text)};
}
export function medicationDoseUnit(value){
  try{return splitDose(value).unit;}catch(_){return '';}
}
export function replaceMedicationDoseUnit(value,nextUnit){
  const unit=normalizeMedicationUnit(nextUnit);
  let parts;
  try{parts=splitDose(value);}catch(_){throw new Error('현재 투여량을 해석할 수 없습니다. 입력칸에서 숫자와 단위를 직접 확인해 주세요.');}
  const next=parts.amount+unit;
  if(next.length>20)throw new Error('투여량과 단위를 합해 20자 이내로 입력해 주세요.');
  return next;
}
