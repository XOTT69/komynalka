/* Optional private account settings. No migration of addresses or records. */
(function(global){
  'use strict';
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const definitions=[['water','Вода','showWater','droplet'],['hotWater','Гаряча вода','showHotWater','temperature-half'],['electro','Світло','showElectro','bolt'],['gas','Газ','showGas','fire-flame-simple']];
  function services(address){
    const p=address.prefs||{};
    return [...definitions.filter(([, ,pref])=>p[pref]===true||(p[pref]===undefined&&pref!=='showHotWater')).map(([id,label,,icon])=>({id,label,icon,meter:true})),...(address.customServices||[]).filter(s=>!s.archivedAt).map(s=>({id:'custom:'+String(s.id),label:s.name||'Інша послуга',icon:'layer-group',meter:false}))];
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
  function periodRecords(address,month){
    return (address.records||[]).filter(record=>record.month===month);
  }
  function meterValues(address,id,month,recordId){
    const matches=periodRecords(address,month);
    const rec=recordId==null?(matches.length===1?matches[0]:null):matches.find(record=>String(record.id)===String(recordId));
    if(!rec||rec._filled?.[id]===false)return null;
    const keys={water:[['wPrev','wCur','Вода','м³']],hotWater:[['hwPrev','hwCur','Гаряча вода','м³']],electro:(rec.calculationMode?.twoZone??address.prefs?.electroTwoZone)?[['dPrev','dCur','День','кВт·год'],['nPrev','nCur','Ніч','кВт·год']]:[['dPrev','dCur','Світло','кВт·год']],gas:[['gPrev','gCur','Газ','м³']]}[id];
    if(!keys)return null;
    const values=keys.map(([previousKey,currentKey,label,unit])=>{
      const current=rec[currentKey],previous=rec[previousKey];
      if(rec._enteredCurrent?.[currentKey]===false||current===null||current===undefined||current===''||!Number.isFinite(Number(current))||Number(current)<0)return null;
      const hasPrevious=rec._enteredPrevious?.[previousKey]!==false&&previous!==null&&previous!==undefined&&previous!==''&&Number.isFinite(Number(previous))&&Number(previous)>=0&&Number(current)>=Number(previous)&&(rec._enteredPrevious?.[previousKey]===true||Number(previous)>0);
      const replacement=rec._meterEvents?.[previousKey],difference=hasPrevious?(typeof KomunalkaMeters!=='undefined'?KomunalkaMeters.usage(previous,current,replacement):Number(current)-Number(previous)):null;
      return {label,unit,current:String(current),previous:hasPrevious?String(previous):'',difference:difference===null?'':String(difference),...(replacement?{replacement}:{})};
    });
    if(values.some(value=>value===null))return null;
    if(rec._filled?.[id]!==true&&!values.some(value=>Number(value.current)>0))return null;
    return values;
  }
  function readings(address,id,month){
    const values=meterValues(address,id,month);
    return values?values.map(value=>`${value.label}: ${value.current} ${value.unit}`).join('\n'):null;
  }
  function templateNeedsReadings(body,zoneCount=1){
    return Boolean(body&&!body.includes('{readings}')&&(zoneCount!==1||!body.includes('{current}')));
  }
  function emailDraft(address,service,card,month,recordId){
    const values=meterValues(address,service.id,month,recordId);if(!values)return null;
    const to=email(card.email);if(!to)return null;
    const one=values.length===1?values[0]:null;
    const list=values.map(value=>`${value.label}: поточні ${value.current}${value.previous?`, попередні ${value.previous}, різниця ${value.difference}`:''} ${value.unit}${value.replacement?`; заміна ${value.replacement.date}: старий ${value.replacement.oldPrevious} → ${value.replacement.oldFinal}, новий від ${value.replacement.newInitial}`:''}`).join('\n');
    const tokens={account:String(card.account||'').trim(),address:String(address.name||'').trim(),service:service.label,month,current:one?.current||'',previous:one?.previous||'',difference:one?.difference||'',readings:list};
    const fill=text=>text.replace(/\{(account|address|service|month|current|previous|difference|readings)\}/g,(_,key)=>tokens[key]);
    const defaultSubject=tokens.account?`О/р ${tokens.account}. ${tokens.address}`:`Показники: ${tokens.service}. ${tokens.address}`;
    const defaultBody=one&&one.previous&&!one.replacement?`Показники ліч. Поточні ${one.current}. Попередні ${one.previous}. Різниця ${one.difference}`:`Показники за ${month}:\n${list}`;
    const subject=card.emailSubject?fill(template(card.emailSubject,240).replace(/[\r\n]+/g,' ')):defaultSubject;
    const draftBody=template(card.emailBody,1500);
    const losesPrevious=!one?.previous&&/\{(?:previous|difference)\}/.test(draftBody);
    const losesReplacement=values.some(value=>value.replacement)&&!draftBody.includes('{readings}');
    const body=draftBody&&!templateNeedsReadings(draftBody,values.length)&&!losesPrevious&&!losesReplacement?fill(draftBody):defaultBody;
    return {to,subject,body,needsReview:values.some(value=>!value.previous||value.replacement)};
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
  function delivery(settings,address,id,month){
    if(!/^\d{4}-\d{2}$/.test(String(month||'')))return null;
    const value=settings?.providerDeliveries?.[addressKey(address)]?.[serviceKey(id)]?.[month];
    return object(value)&&typeof value.sentAt==='string'?value:null;
  }
  function deliveryState(settings,address,id,month,values){
    const saved=delivery(settings,address,id,month);
    if(!saved)return 'ready';
    return saved.snapshot&&readingSnapshot(values)!==saved.snapshot?'changed':'sent';
  }
  function readingSnapshot(values){
    return values?JSON.stringify(values.map(({current,previous,difference,replacement})=>[current,previous,difference,replacement?.date,replacement?.oldPrevious,replacement?.oldFinal,replacement?.newInitial])):'';
  }
  function markDelivered(settings,address,id,month,sentAt=new Date().toISOString(),values){
    const period=String(month||''),stamp=String(sentAt||'');
    if(!/^\d{4}-\d{2}$/.test(period)||!/^\d{4}-\d{2}-\d{2}T/.test(stamp)||!Number.isFinite(Date.parse(stamp)))throw new Error('INVALID_DELIVERY');
    const all=settings?.providerDeliveries,group=all?.[addressKey(address)],service=group?.[serviceKey(id)];
    if((all!==undefined&&!object(all))||(group!==undefined&&!object(group))||(service!==undefined&&!object(service)))throw new Error('INVALID_DELIVERY_DATA');
    return {...(settings||{}),providerDeliveries:{...(all||{}),[addressKey(address)]:{...(group||{}),[serviceKey(id)]:{...(service||{}),[period]:{...(object(service?.[period])?service[period]:{}),sentAt:stamp,...(values?{snapshot:readingSnapshot(values)}:{})}}}}};
  }
  function clearDelivered(settings,address,id,month){
    if(!delivery(settings,address,id,month))return settings;
    const owner=addressKey(address),service=serviceKey(id);
    const all=settings.providerDeliveries,periods={...all[owner][service]};
    delete periods[month];
    return {...settings,providerDeliveries:{...all,[owner]:{...all[owner],[service]:periods}}};
  }
  global.KomunalkaProviders=Object.freeze({services,website,email,get,update,periodRecords,meterValues,readings,templateNeedsReadings,emailDraft,mailto,gmail,delivery,deliveryState,readingSnapshot,markDelivered,clearDelivered});
})(globalThis);
