import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../consumption-insights.js',import.meta.url),'utf8');
const context={};vm.createContext(context);vm.runInContext(source,context);const I=context.KomunalkaInsights;

const water=(month,used)=>({month,wPrev:100,wCur:100+used,_filled:{water:true}});

test('usage comparison requires evidence and explains an unusual change with exact values',()=>{
  const records=[water('2026-06',10),water('2026-07',12),water('2026-08',8)];
  const result=I.compare(records,'2026-09',{water:20,hotWater:null,electro:null,gas:null});
  assert.equal(result.length,1);assert.equal(result[0].tone,'high');assert.equal(result[0].average,10);assert.equal(result[0].percent,100);assert.match(result[0].detail,/3 місяців/);
  assert.deepEqual(Array.from(I.compare(records.slice(0,1),'2026-09',{water:20})),[]);
});

test('comparison ignores future, missing and invalid readings without changing records',()=>{
  const records=[water('2026-07',10),water('2026-08',10),water('2026-10',999),{month:'2026-06',wPrev:20,wCur:10,_filled:{water:true}}],before=JSON.stringify(records);
  const [result]=I.compare(records,'2026-09',{water:5});
  assert.equal(result.tone,'low');assert.equal(result.average,10);assert.equal(JSON.stringify(records),before);assert.equal(I.usage({_filled:{water:false},wPrev:0,wCur:100},'water'),null);
});

test('unentered services are not reported as a 100 percent saving, while explicit zero remains valid',()=>{
  const records=['2026-07','2026-08'].map(month=>({...water(month,10),gPrev:0,gCur:10,dPrev:0,dCur:10}));
  assert.deepEqual(Array.from(I.compare(records,'2026-09',{water:null,electro:'',gas:false})),[]);
  const [zero]=I.compare(records,'2026-09',{water:0,gas:null,electro:null});assert.equal(zero.id,'water');assert.equal(zero.percent,-100);
  assert.equal(I.usage({wPrev:null,wCur:100},'water'),null);
  assert.equal(I.usage({wPrev:0,wCur:100,_enteredPrevious:{wPrev:false}},'water'),null);
});
