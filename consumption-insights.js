(function(global){
  'use strict';
  const definitions={
    water:{label:'Вода',unit:'м³',fields:[['wPrev','wCur']]},
    hotWater:{label:'Гаряча вода',unit:'м³',fields:[['hwPrev','hwCur']]},
    electro:{label:'Світло',unit:'кВт·год',fields:[['dPrev','dCur'],['nPrev','nCur']]},
    gas:{label:'Газ',unit:'м³',fields:[['gPrev','gCur']]},
  };
  const number=value=>{if(value==null||typeof value==='boolean'||(typeof value==='string'&&value.trim()===''))return null;const n=Number(value);return Number.isFinite(n)?n:null;};
  function usage(record,id){
    const definition=definitions[id];if(!definition||!record||record._filled?.[id]===false)return null;
    let total=0,found=false;
    for(const [previous,current] of definition.fields){if(record._enteredPrevious?.[previous]===false)continue;const a=number(record[previous]),b=number(record[current]);if(a===null||b===null)continue;if(b<a)return null;const value=typeof global.KomunalkaMeters!=='undefined'?global.KomunalkaMeters.usage(a,b,record._meterEvents?.[previous]):b-a;if(value===null)return null;total+=value;found=true;}
    return found?total:null;
  }
  function compare(records,month,current){
    if(!/^\d{4}-\d{2}$/.test(String(month||'')))return[];
    const prior=(Array.isArray(records)?records:[]).filter(record=>/^\d{4}-\d{2}$/.test(String(record?.month||''))&&record.month<month).sort((a,b)=>b.month.localeCompare(a.month));
    return Object.entries(definitions).flatMap(([id,definition])=>{
      const value=number(current?.[id]);if(value===null||value<0)return[];
      const history=prior.map(record=>usage(record,id)).filter(value=>value!==null).slice(0,3);if(history.length<2)return[];
      const average=history.reduce((sum,item)=>sum+item,0)/history.length;if(average<=0)return[];
      const percent=Math.round((value-average)/average*100),tone=percent>=35?'high':percent<=-25?'low':'normal';
      const detail=tone==='high'?`На ${percent}% більше за середнє останніх ${history.length} місяців.`:tone==='low'?`На ${Math.abs(percent)}% менше за середнє останніх ${history.length} місяців.`:`Близько до середнього за останні ${history.length} місяці.`;
      return[{id,label:definition.label,unit:definition.unit,value,average,percent,tone,detail}];
    });
  }
  global.KomunalkaInsights=Object.freeze({usage,compare});
})(globalThis);
