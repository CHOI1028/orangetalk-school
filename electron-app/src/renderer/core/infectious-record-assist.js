import { showInfectiousModal } from './infectious-disease.js';
import { diseaseNameChange } from './infectious-guide.js';

// Capture both record identity and its input. A late result must never update another form.
export function bindInfectiousRecordAssist(container, isCurrentRecord, onChange) {
  const button=container.querySelector('[data-inf-disease-search]');
  const input=container.querySelector('[data-field="diseaseName"]');
  if(!button || !input) return;
  const read=()=>input.isConnected && isCurrentRecord() ? input.value : null;
  button.addEventListener('click',()=>{
    if(read()==null)return;
    showInfectiousModal({initialTab:'guide',query:input.value,readDiseaseName:read,
      onApply(name,expected,allowReplace) {
        const result=diseaseNameChange(read(),expected,name,allowReplace);
        if(!result.error && result.changed) { input.value=result.value; onChange(input); }
        return result;
      }
    });
  });
}
