/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* 연결 확인은 저장/승인 표시와 별개다. 실제 응답 코드를 확인하며 키·URL·응답 원문은 표시하지 않는다. */
function normalizedKey(value){
  const key=String(value==null?'':value).trim();
  try{return /%[0-9a-f]{2}/i.test(key)?decodeURIComponent(key).trim():key;}catch(_){return key;}
}
function result(success,message){return {success,message};}
export function inspectPublicDataResponse(response){
  if(!response||response.success===false)return result(false,'서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  let data=response.data, code='', body=false;
  if(typeof data==='string'){
    try{data=JSON.parse(data);}catch(_){
      const match=data.match(/<(?:[\w.-]+:)?(?:returnReasonCode|resultCode)\b[^>]*>\s*(\d{1,5})\s*<\//i);
      code=match?match[1]:'';
      body=/<(?:[\w.-]+:)?body\b/i.test(data);
    }
  }
  if(data&&typeof data==='object'){
    const envelope=data.response||data;
    const header=envelope.header||(data.OpenAPI_ServiceResponse&&data.OpenAPI_ServiceResponse.cmmMsgHeader)||{};
    code=String(header.resultCode==null?(header.returnReasonCode||''):header.resultCode).trim();
    body=!!envelope.body;
  }
  if(code&&code!=='00'&&code!=='0'){
    if(['20','21','30','31','32'].includes(code))return result(false,'인증키와 이 서비스의 활용 신청·승인·사용기간을 확인해 주세요. (코드 '+code+')');
    if(['22','23'].includes(code))return result(false,'호출 허용량을 초과했습니다. 잠시 후 다시 확인해 주세요. (코드 '+code+')');
    if(code==='03')return result(false,'조회 시점의 데이터가 없습니다. 잠시 후 다시 확인해 주세요. (코드 03)');
    return result(false,'서비스가 오류를 반환했습니다. 잠시 후 다시 확인해 주세요.'+(/^\d{1,5}$/.test(code)?' (코드 '+code+')':''));
  }
  if(Number(response.status)>=400)return result(false,'서버 요청에 실패했습니다. (HTTP '+Number(response.status)+')');
  if((code==='00'||code==='0')&&body)return result(true,'연결 확인 완료');
  return result(false,'정상 응답을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.');
}

/* 최소 조회만 수행한다. 의료기관/측정소처럼 별도 활용 신청이 필요한 하위 서비스도 확인한다. */
export function publicDataProbeGroups(service, now=new Date()){
  const kst=new Date(now.getTime()+9*60*60*1000);
  const date=d=>d.toISOString().slice(0,10).replace(/-/g,'');
  const base=new Date(kst.getTime()-2*60*60*1000);
  const uv=new Date(kst);const hour=uv.getUTCHours();
  if(hour<6)uv.setUTCDate(uv.getUTCDate()-1);
  const uvTime=date(uv)+(hour>=18||hour<6?'18':'06');
  const probe=(label,path,params)=>({label,path,params});
  const groups={
    kma:[[probe('단기예보','1360000/VilageFcstInfoService_2.0/getUltraSrtFcst',{dataType:'JSON',base_date:date(base),base_time:String(base.getUTCHours()).padStart(2,'0')+'30',nx:60,ny:127})]],
    uv:[['V3','V4'].map(v=>probe('자외선','1360000/LivingWthrIdxService'+v+'/getUVIdx'+v,{dataType:'JSON',areaNo:'1100000000',time:uvTime}))],
    airkorea:[[probe('대기오염정보','B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty',{returnType:'json',stationName:'종로구',dataTerm:'DAILY',ver:'1.0'})],
      [probe('측정소정보','B552584/MsrstnInfoInqireSvc/getMsrstnList',{returnType:'json',stationName:'종로구'})]],
    drug:[[probe('의약품정보','1471000/DrbEasyDrugInfoService/getDrbEasyDrugList',{type:'json',itemName:'타이레놀'})]],
    hira:[[probe('병원정보','B551182/hospInfoServicev2/getHospBasisList',{_type:'json'})],
      [probe('약국정보','B551182/pharmacyInfoService/getParmacyBasisList',{_type:'json'})]],
    emergency:[[probe('응급의료정보','B552657/ErmctInfoInqireService/getEgytListInfoInqire',{_type:'json'})]],
    kdca:[[probe('감염병 현황','1790387/EIDAPIService/Region',{resType:2,searchType:1,searchYear:kst.getUTCFullYear(),searchSidoCd:'00'})]],
    holiday:[[probe('특일정보','B090041/openapi/service/SpcdeInfoService/getRestDeInfo',{_type:'json',solYear:kst.getUTCFullYear()})]]
  };
  return groups[service]||[];
}
export async function checkPublicDataConnection(service,key,api,now=new Date()){
  if(!normalizedKey(key))return result(false,'공통 인증키를 먼저 저장해 주세요.');
  if(!api||!api.externalFetchJson)return result(false,'연결 확인 기능을 사용할 수 없습니다. 프로그램을 다시 시작해 주세요.');
  const groups=publicDataProbeGroups(service,now);
  if(!groups.length)return result(false,'지원하지 않는 서비스입니다.');
  for(const alternatives of groups){
    let checked, label='';
    for(const probe of alternatives){
      label=probe.label;
      const url=new URL('https://apis.data.go.kr/'+probe.path);
      url.searchParams.set(service==='holiday'?'ServiceKey':'serviceKey',normalizedKey(key));
      for(const [name,value] of Object.entries({pageNo:1,numOfRows:1,...probe.params}))url.searchParams.set(name,String(value));
      try{checked=inspectPublicDataResponse(await api.externalFetchJson(url.href));}
      catch(_){checked=result(false,'서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.');}
      if(checked.success)break;
    }
    if(!checked.success)return result(false,label+': '+checked.message);
  }
  return result(true,'연결 확인 완료 — 저장된 인증키로 정상 응답을 받았습니다.');
}
