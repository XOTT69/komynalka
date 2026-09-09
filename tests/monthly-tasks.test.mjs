import {test} from 'node:test';import assert from 'node:assert/strict';import '../reminders.js';import '../monthly-tasks.js';
const M=globalThis.KomunalkaMonth;
test('monthly input status respects explicit zero and missing services without changing legacy records',()=>{
 const a={prefs:{showWater:true,showElectro:true,showGas:false},records:[{month:'2026-09',wCur:0,dCur:0,_filled:{water:true,electro:false}}]};const before=structuredClone(a);
 const task=M.readings(a,'2026-09');assert.equal(task.done,1);assert.equal(task.total,2);assert.equal(task.services[1].done,false);assert.equal(M.readings(a,'2026-10').done,0);assert.deepEqual(a,before);
});
test('transfer period matches the push cycle across December and short months',()=>{
 const a={prefs:{remindersEnabled:true,showWater:false,showGas:false,showElectro:true}};
 const r=M.reminders(a,{},new Date('2027-01-02T10:00Z'))[0];assert.equal(r.cycle,'2026-12');assert.equal(r.start.slice(0,10),'2026-12-28');assert.equal(r.end.slice(0,10),'2027-01-03');
 a.prefs.reminderCompletions={electro:r.cycle};assert.equal(M.reminders(a,{},new Date('2027-01-02T10:00Z'))[0].done,true);assert.equal(M.reminders({...a,prefs:{...a.prefs,reminderCompletions:{}}},{},new Date('2027-01-02T10:00Z'))[0].done,false);
 const feb=M.reminders({prefs:{remindersEnabled:true,showWater:true,showElectro:false,showGas:false,remWaterStart:31,remWaterEnd:31}},{},new Date('2027-02-28T10:00Z'))[0];assert.equal(feb.start.slice(0,10),'2027-02-28');assert.equal(feb.available,true);
});
