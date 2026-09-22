/* Derived monthly status. Reading it never changes account history. */
(function(global){
  const R=global.KomunalkaReminders;
  const definitions=[['water','Вода','showWater',['wCur'],'waterCost'],['hotWater','Гаряча вода','showHotWater',['hwCur'],'hotWaterCost'],['electro','Світло','showElectro',['dCur','nCur'],'electroCost'],['gas','Газ','showGas',['gCur'],'gasCost']];
  function readings(address,month){
    const rec=(address.records||[]).find(r=>r.month===month),p=address.prefs||{};
    const services=definitions.filter(([, ,pref])=>p[pref]===true||(p[pref]===undefined&&pref!=='showHotWater')).map(([id,label,,fields,cost])=>({id,label,done:Boolean(rec&&(typeof rec._filled?.[id]==='boolean'?rec._filled[id]:Number(rec[cost])>0||fields.some(field=>Number(rec[field])>0)))}));
    for(const service of address.customServices||[])services.push({id:String(service.id),label:service.name||'Інша послуга',done:Boolean(rec?.customData&&Object.prototype.hasOwnProperty.call(rec.customData,service.id))});
    return {record:rec,services,done:services.filter(s=>s.done).length,total:services.length};
  }
  const dateAt=(year,month,day)=>{const d=new Date(Date.UTC(year,month-1,1,12));d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d;};
  function reminders(address,settings,now=new Date()){
    if(address.prefs?.remindersEnabled!==true)return [];
    const d=R.calendar(now);
    return R.schedule(address,settings).filter(r=>r.active&&r.enabled!==false).map(rem=>{
      const wrap=rem.startDay>rem.endDay,previous=wrap&&d.day<=Math.min(rem.endDay,new Date(Date.UTC(d.year,d.month,0)).getUTCDate());
      const start=dateAt(d.year,d.month-(previous?1:0),rem.startDay),end=dateAt(d.year,d.month+(wrap&&!previous?1:0),rem.endDay),cycle=R.monthKey(start.getUTCFullYear(),start.getUTCMonth()+1);
      const today=dateAt(d.year,d.month,d.day);
      return {...rem,start:start.toISOString(),end:end.toISOString(),cycle,done:address.prefs.reminderCompletions?.[rem.id]===cycle,available:today>=start,overdue:today>end};
    });
  }
  function nextAction(input,items,outstanding,emailIds=[]){
    if(input.total===0)return {kind:'setup'};
    const missing=input.services.find(service=>!service.done);
    if(missing)return {kind:'readings',serviceId:missing.id};
    const pending=items.filter(item=>!item.done).sort((a,b)=>a.end.localeCompare(b.end));
    const active=pending.find(item=>item.available);
    if(active){
      const emailId=emailIds.find(id=>id===active.id||(active.id==='water'&&id==='hotWater'));
      return {kind:emailId?'email':'transfer',reminder:active,serviceId:emailId||null};
    }
    if(outstanding>0)return {kind:'payment'};
    if(pending.length)return {kind:'transfer',reminder:pending[0],serviceId:null};
    return {kind:'review'};
  }
  global.KomunalkaMonth=Object.freeze({readings,reminders,nextAction});
})(globalThis);
