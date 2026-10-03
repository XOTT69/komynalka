import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../meter-readings.js';
const {usage,validate}=KomunalkaMeters;
const event={date:'2026-09-15',oldPrevious:267,oldFinal:280,newInitial:2};
test('replacement preserves old consumption, decimal readings and independent day/night meters',()=>{
  assert.equal(usage(2,5,event),16);assert.equal(usage(2,5.25,event),16.25);assert.equal(usage(0,0),0);assert.equal(usage(267,280),13);
  assert.equal(usage(2,5,event)+usage(10,12,{...event,oldPrevious:100,oldFinal:104,newInitial:10}),22);
});
test('missing readings, invalid meter values and dates cannot create a negative charge',()=>{
  for(const [a,b,e] of [[null,1],['',1],[10,9],[0,Infinity],[0,5,event],[2,5,{...event,oldFinal:200}]])assert.equal(usage(a,b,e),null);
  for(const e of [{...event,date:'2026-08-15'},{...event,date:'2026-02-31'},{...event,oldPrevious:''},{...event,newInitial:-1}])assert.throws(()=>validate(e,'2026-09'));
});
