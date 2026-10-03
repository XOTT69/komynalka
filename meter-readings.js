(function(global){
  'use strict';
  function validate(event,month){
    if(!event||!/^\d{4}-\d{2}-\d{2}$/.test(event.date||'')||event.date.slice(0,7)!==month||new Date(event.date+'T12:00:00Z').toISOString().slice(0,10)!==event.date)throw new Error('INVALID_REPLACEMENT_DATE');
    for(const key of ['oldPrevious','oldFinal','newInitial'])if(event[key]==null||event[key]===''||!Number.isFinite(Number(event[key]))||Number(event[key])<0)throw new Error('INVALID_REPLACEMENT_VALUE');
    if(Number(event.oldFinal)<Number(event.oldPrevious))throw new Error('INVALID_OLD_FINAL');
    return {date:event.date,oldPrevious:Number(event.oldPrevious),oldFinal:Number(event.oldFinal),newInitial:Number(event.newInitial)};
  }
  function usage(previous,current,event){
    if(previous==null||current==null||previous===''||current==='')return null;
    const a=Number(previous),b=Number(current);if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<a)return null;
    if(!event)return Number((b-a).toFixed(6));
    let valid;try{valid=validate(event,event.date?.slice(0,7));}catch{return null;}
    if(a!==valid.newInitial)return null;
    return Number((valid.oldFinal-valid.oldPrevious+b-valid.newInitial).toFixed(6));
  }
  global.KomunalkaMeters=Object.freeze({validate,usage});
})(typeof window!=='undefined'?window:globalThis);
