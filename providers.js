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
  const addressKey=id=>'address:'+String(id),serviceKey=id=>'service:'+String(id);
  function get(settings,address,id){const value=settings?.providerCards?.[addressKey(address)]?.[serviceKey(id)];return object(value)?value:{};}
  function update(settings,address,id,fields){
    const all=settings.providerCards,group=all?.[addressKey(address)],prev=group?.[serviceKey(id)];
    if((all!==undefined&&!object(all))||(group!==undefined&&!object(group))||(prev!==undefined&&!object(prev)))throw new Error('INVALID_PROVIDER_DATA');
    const clean={};for(const [key,max] of [['name',100],['account',80],['contact',160]]){clean[key]=String(fields[key]||'').trim();if(clean[key].length>max)throw new Error('FIELD_TOO_LONG');}
    clean.website=website(fields.website);
    return {...settings,providerCards:{...all,[addressKey(address)]:{...group,[serviceKey(id)]:{...prev,...clean}}}};
  }
  function readings(address,id,month){
    const rec=(address.records||[]).find(r=>r.month===month);if(!rec)return null;
    const keys={water:[['wCur','Вода','м³']],hotWater:[['hwCur','Гаряча вода','м³']],electro:address.prefs?.electroTwoZone?[['dCur','День','кВт·год'],['nCur','Ніч','кВт·год']]:[['dCur','Світло','кВт·год']],gas:[['gCur','Газ','м³']]}[id];
    if(!keys||rec._filled?.[id]===false)return null;
    if(!keys.every(([key])=>rec[key]!==null&&rec[key]!==undefined&&rec[key]!==''&&Number.isFinite(Number(rec[key]))&&Number(rec[key])>=0))return null;
    // Older records without an explicit flag cannot distinguish a zero placeholder.
    if(rec._filled?.[id]!==true&&!keys.some(([key])=>Number(rec[key])>0))return null;
    return keys.map(([key,label,unit])=>`${label}: ${rec[key]} ${unit}`).join('\n');
  }
  global.KomunalkaProviders=Object.freeze({services,website,get,update,readings});
})(globalThis);
