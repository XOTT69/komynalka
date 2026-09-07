import {createHash} from 'node:crypto';
export const demoPassHash=createHash('sha256').update('demo-preview').digest('hex');
const now=new Date(),month=(offset)=>{const d=new Date(now.getFullYear(),now.getMonth()-offset,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const tariffs={water:30.38,hotWater:95,electroBase:4.32,electroWinter:2.64,winterLimit:2000,nightCoef:.5,gas:7.96};
const records=Array.from({length:8},(_,i)=>{
  const water=6+i%3,electricity=143+i*7,gas=8+i%4,waterCost=water*tariffs.water,electroCost=electricity*tariffs.electroBase,gasCost=gas*tariffs.gas,customCost=480;
  const total=Math.round((waterCost+electroCost+gasCost+customCost)*100)/100,paidAmount=i===0?500:total;
  return{id:`demo-${i}`,month:month(i),wPrev:240-i*8,wCur:240-i*8+water,dPrev:4200-i*180,dCur:4200-i*180+electricity,gPrev:370-i*12,gCur:370-i*12+gas,waterCost,electroCost,gasCost,hotWaterCost:0,customCost,customData:{building:{name:'Обслуговування будинку',val:480}},total,paymentStatus:i===0?'partial':'paid',paid:i!==0,paidAmount,note:i===0?'Частину рахунку вже сплачено':'',tariffSnapshot:{...tariffs},_filled:{water:true,electro:true,gas:true,custom:true}};
});
export const demoAccount={pass:demoPassHash,passHash:demoPassHash,displayName:'Олена',addresses:[{id:'demo-home',name:'Квартира · Київ',tariffs,prefs:{showWater:true,showHotWater:false,showElectro:true,showGas:true,familyRole:'owner'},customServices:[{id:'building',name:'Обслуговування будинку',defaultSum:480}],records},{id:'demo-other',name:'Будинок · Ірпінь',tariffs,prefs:{showWater:true,showElectro:true,showGas:true},customServices:[],records:[]}],currentAddressId:'demo-home',accountSettings:{k_budget:'1800'}};
