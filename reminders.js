/* Shared calendar rules for the UI and background delivery. */
(function(global){
  const calendar=(now=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const monthKey=(year,month)=>`${year}-${String(month).padStart(2,'0')}`;
  const day=value=>Math.max(1,Math.min(31,Math.trunc(Number(value)||1)));
  function schedule(address,settings={}){
    const p=address.prefs||{};let custom=[];try{custom=JSON.parse(settings.komynalka_custom_reminders||'[]');}catch{}if(!Array.isArray(custom))custom=[];
    const definitions=[['water','Вода','💧','Water',1,5,p.showWater!==false||p.showHotWater===true],['electro','Світло','⚡','Electro',28,3,p.showElectro!==false],['gas','Газ','🔥','Gas',1,5,p.showGas!==false]];
    const standard=definitions.map(([id,label,emoji,key,start,end,enabled])=>{const saved=custom.find(r=>r.id===id)||{};return{...saved,id,label:String(saved.label||label).slice(0,100),emoji:saved.emoji||emoji,enabled,active:saved.active!==false,startDay:day(p[`rem${key}Start`]??saved.startDay??start),endDay:day(p[`rem${key}End`]??saved.endDay??end)};});
    return [...standard.filter(r=>!r.deleted),...custom.filter(r=>r&&!r.deleted&&r.id&&!definitions.some(d=>d[0]===r.id)).map(r=>({...r,startDay:day(r.startDay),endDay:day(r.endDay),label:String(r.label||'Нагадування').slice(0,100)}))];
  }
  function due(address,settings={},now=new Date()){
    if(address.prefs?.remindersEnabled!==true)return[];
    const date=calendar(now),days=new Date(Date.UTC(date.year,date.month,0)).getUTCDate();
    return schedule(address,settings).flatMap(rem=>{
      const start=Math.min(rem.startDay,days),end=Math.min(rem.endDay,days),wrap=rem.startDay>rem.endDay;
      if(!rem.active||rem.enabled===false||!(wrap?date.day>=start||date.day<=end:date.day>=start&&date.day<=end))return[];
      const anchor=new Date(Date.UTC(date.year,date.month-1-(wrap&&date.day<=end?1:0),1));const cycle=monthKey(anchor.getUTCFullYear(),anchor.getUTCMonth()+1);
      if(address.prefs.reminderCompletions?.[rem.id]===cycle)return[];
      return[{...rem,cycle,addressId:address.id}];
    });
  }
  global.KomunalkaReminders=Object.freeze({calendar,schedule,due,monthKey});
})(globalThis);
