/* Optional private account settings. No migration of addresses or records. */
(function(global){
  'use strict';
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const definitions=[['water','Вода','showWater','droplet'],['hotWater','Гаряча вода','showHotWater','temperature-half'],['electro','Світло','showElectro','bolt'],['gas','Газ','showGas','fire-flame-simple']];
  function services(address){
    const p=address.prefs||{};
    return [...definitions.filter(([, ,pref])=>p[pref]===true||(p[pref]===undefined&&pref!=='showHotWater')).map(([id,label,,icon])=>({id,label,icon,meter:true})),...(address.customServices||[]).map(s=>({id:'custom:'+String(s.id),label:s.name||'Інша послуга',icon:'layer-group',meter:false}))];
  }
  function website(value){
    const raw=String(value||'').trim();if(!raw)return '';
    if(raw.length>2048||/[\s\u0000-\u001f\\]/.test(raw))throw new Error('INVALID_WEBSITE');
    const withScheme=/^[a-z][a-z\d+.-]*:/i.test(raw)?raw:'https://'+raw;
    let url;try{url=new URL(withScheme);}catch{throw new Error('INVALID_WEBSITE');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.hostname)throw new Error('INVALID_WEBSITE');
    return url.href;
  }
  function email(value){
    const address=String(value||'').trim();
    if(!address)return '';
    if(address.length>254||/[\s<>;,\u0000-\u001f]/.test(address)||!/^.{1,64}@[^@]+\.[^@]+$/.test(address))throw new Error('INVALID_EMAIL');
    return address;
  }
  function template(value,max){
    const text=String(value||'').trim();
    if(text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw new Error('INVALID_EMAIL_TEMPLATE');
    return text;
  }
  const addressKey=id=>'address:'+String(id),serviceKey=id=>'service:'+String(id);
  function get(settings,address,id){const value=settings?.providerCards?.[addressKey(address)]?.[serviceKey(id)];return object(value)?value:{};}
  function update(settings,address,id,fields){
    const all=settings.providerCards,group=all?.[addressKey(address)],prev=group?.[serviceKey(id)];
    if((all!==undefined&&!object(all))||(group!==undefined&&!object(group))||(prev!==undefined&&!object(prev)))throw new Error('INVALID_PROVIDER_DATA');
    const clean={};for(const [key,max] of [['name',100],['account',80],['contact',160]]){clean[key]=String(fields[key]||'').trim();if(clean[key].length>max)throw new Error('FIELD_TOO_LONG');}
    clean.website=website(fields.website);
    if(Object.hasOwn(fields,'email'))clean.email=email(fields.email);
    if(Object.hasOwn(fields,'emailSubject'))clean.emailSubject=template(fields.emailSubject,240).replace(/[\r\n]+/g,' ');
    if(Object.hasOwn(fields,'emailBody'))clean.emailBody=template(fields.emailBody,1500);
    return {...settings,providerCards:{...all,[addressKey(address)]:{...group,[serviceKey(id)]:{...prev,...clean}}}};
  }
  function meterValues(address,id,month){
    const rec=(address.records||[]).find(r=>r.month===month);if(!rec||rec._filled?.[id]===false)return null;
    const keys={water:[['wPrev','wCur','Вода','м³']],hotWater:[['hwPrev','hwCur','Гаряча вода','м³']],electro:address.prefs?.electroTwoZone?[['dPrev','dCur','День','кВт·год'],['nPrev','nCur','Ніч','кВт·год']]:[['dPrev','dCur','Світло','кВт·год']],gas:[['gPrev','gCur','Газ','м³']]}[id];
    if(!keys)return null;
    const values=keys.map(([previousKey,currentKey,label,unit])=>{
      const current=rec[currentKey],previous=rec[previousKey];
      if(current===null||current===undefined||current===''||!Number.isFinite(Number(current))||Number(current)<0)return null;
      const hasPrevious=rec._enteredPrevious?.[previousKey]!==false&&previous!==null&&previous!==undefined&&previous!==''&&Number.isFinite(Number(previous))&&Number(previous)>=0&&Number(current)>=Number(previous)&&(rec._enteredPrevious?.[previousKey]===true||Number(previous)>0);
      return {label,unit,current:String(current),previous:hasPrevious?String(previous):'',difference:hasPrevious?String(Number((Number(current)-Number(previous)).toFixed(6))):''};
    });
    if(values.some(value=>value===null))return null;
    if(rec._filled?.[id]!==true&&!values.some(value=>Number(value.current)>0))return null;
    return values;
  }
  function readings(address,id,month){
    const values=meterValues(address,id,month);
    return values?values.map(value=>`${value.label}: ${value.current} ${value.unit}`).join('\n'):null;
  }
  function emailDraft(address,service,card,month){
    const values=meterValues(address,service.id,month);if(!values)return null;
    const to=email(card.email);if(!to)return null;
    const one=values.length===1?values[0]:null;
    const list=values.map(value=>`${value.label}: поточні ${value.current}${value.previous?`, попередні ${value.previous}, різниця ${value.difference}`:''} ${value.unit}`).join('\n');
    const tokens={account:String(card.account||'').trim(),address:String(address.name||'').trim(),service:service.label,month,current:one?.current||'',previous:one?.previous||'',difference:one?.difference||'',readings:list};
    const fill=text=>text.replace(/\{(account|address|service|month|current|previous|difference|readings)\}/g,(_,key)=>tokens[key]);
    const defaultSubject=tokens.account?`О/р ${tokens.account}. ${tokens.address}`:`Показники: ${tokens.service}. ${tokens.address}`;
    const defaultBody=one&&one.previous?`Показники ліч. Поточні ${one.current}. Попередні ${one.previous}. Різниця ${one.difference}`:`Показники за ${month}:\n${list}`;
    const subject=card.emailSubject?fill(template(card.emailSubject,240).replace(/[\r\n]+/g,' ')):defaultSubject;
    const body=card.emailBody?fill(template(card.emailBody,1500)):defaultBody;
    return {to,subject,body,needsReview:values.some(value=>!value.previous)};
  }
  function mailto(draft){return `mailto:${encodeURIComponent(email(draft.to)).replace('%40','@')}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;}
  function gmail(draft){
    const url=new URL('https://mail.google.com/mail/');
    url.searchParams.set('view','cm');url.searchParams.set('fs','1');
    url.searchParams.set('to',email(draft.to));
    url.searchParams.set('su',String(draft.subject||''));
    url.searchParams.set('body',String(draft.body||''));
    return url.href;
  }
  global.KomunalkaProviders=Object.freeze({services,website,email,get,update,readings,emailDraft,mailto,gmail});
})(globalThis);
