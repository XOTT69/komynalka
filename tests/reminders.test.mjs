import {test} from 'node:test';import assert from 'node:assert/strict';import '../reminders.js';
const R=globalThis.KomunalkaReminders;
const address=(prefs={})=>({id:'home',prefs:{remindersEnabled:true,showWater:true,showElectro:false,showGas:false,...prefs}});
test('custom days, disabled services and master switch use one calendar',()=>{const a=address({remWaterStart:10,remWaterEnd:12});assert.equal(R.due(a,{},new Date('2026-09-01T07:00Z')).length,0);assert.equal(R.due(a,{},new Date('2026-09-10T07:00Z'))[0].id,'water');assert.equal(R.due(address({remindersEnabled:false}),{},new Date('2026-09-01T07:00Z')).length,0);assert.equal(R.due(address({showWater:false}),{},new Date('2026-09-01T07:00Z')).length,0);});
test('a cross-month period has one completion cycle, including December and leap February',()=>{const a=address({showWater:false,showElectro:true});const first=R.due(a,{},new Date('2026-12-29T08:00Z'))[0];assert.equal(first.cycle,'2026-12');a.prefs.reminderCompletions={electro:first.cycle};assert.equal(R.due(a,{},new Date('2027-01-02T08:00Z')).length,0);assert.equal(R.due(a,{},new Date('2027-01-29T08:00Z'))[0].cycle,'2027-01');const feb=address({remWaterStart:31,remWaterEnd:31});assert.equal(R.due(feb,{},new Date('2028-02-29T08:00Z')).length,1);});
test('completion is address-specific and Ukrainian dates do not depend on device timezone',()=>{const a=address({reminderCompletions:{water:'2026-09'}}),b=address();b.id='second';assert.equal(R.due(a,{},new Date('2026-09-01T07:00Z')).length,0);assert.equal(R.due(b,{},new Date('2026-09-01T07:00Z')).length,1);assert.equal(R.calendar(new Date('2026-08-31T22:30Z')).day,1);});
test('a same-month range is active for the whole selected period',()=>{const a=address({remWaterStart:20,remWaterEnd:25});assert.equal(R.due(a,{},new Date('2026-09-19T12:00Z')).length,0);assert.equal(R.due(a,{},new Date('2026-09-20T12:00Z'))[0].id,'water');assert.equal(R.due(a,{},new Date('2026-09-25T12:00Z'))[0].id,'water');assert.equal(R.due(a,{},new Date('2026-09-26T12:00Z')).length,0);});

test('deleted built-in and custom reminders stay absent from the UI schedule and background delivery',()=>{
  const settings={komynalka_custom_reminders:JSON.stringify([{id:'water',deleted:true,active:false},{id:'extra',label:'Оплата',startDay:1,endDay:5,active:true},{id:'removed',deleted:true,active:true,startDay:1,endDay:5}])};
  assert.equal(R.schedule(address(),settings).some(r=>r.id==='water'||r.id==='removed'),false);
  assert.deepEqual(R.due(address(),settings,new Date('2026-09-02T07:00Z')).map(r=>r.id),['extra']);
});
test('next reminder date follows Kyiv time and skips a completed cycle',()=>{
  const a=address({remWaterStart:20,remWaterEnd:25});
  assert.equal(R.nextDelivery(a,{},new Date('2026-09-20T05:00:00Z')).date,'2026-09-20');
  assert.equal(R.nextDelivery(a,{},new Date('2026-09-20T06:00:00Z')).date,'2026-09-21');
  a.prefs.reminderCompletions={water:'2026-09'};
  assert.equal(R.nextDelivery(a,{},new Date('2026-09-20T05:00:00Z')).date,'2026-10-20');
  assert.equal(R.nextDelivery(address({remindersEnabled:false}),{},new Date('2026-09-20T05:00:00Z')),null);
});
test('next reminder preview uses the validated account time',()=>{
  const a=address({remWaterStart:20,remWaterEnd:25}),settings={reminderTime:'07:15'};
  assert.equal(R.nextDelivery(a,settings,new Date('2026-09-20T04:14:00Z')).date,'2026-09-20');
  assert.equal(R.nextDelivery(a,settings,new Date('2026-09-20T04:15:00Z')).date,'2026-09-21');
  assert.equal(R.nextDelivery(a,settings,new Date('2026-09-20T04:14:00Z')).time,'07:15');
  assert.equal(R.notificationTime({reminderTime:'99:80'}),'09:00');
});
test('snoozing one address hides only today and preserves unrelated account settings',()=>{
  const a=address({remWaterStart:20,remWaterEnd:25}),now=new Date('2026-09-20T07:00:00Z');
  const settings=R.snooze({future:{keep:true}},'home','2026-09-21');
  assert.equal(R.due(a,settings,now).length,0);
  assert.equal(R.due(a,settings,new Date('2026-09-21T07:00:00Z')).length,1);
  assert.equal(R.due({...a,id:'other'},settings,now).length,1);
  assert.deepEqual(settings.future,{keep:true});
  assert.throws(()=>R.snooze({},'home','tomorrow'));
});
test('archived addresses keep their schedule but never produce reminders',()=>{
  const a={...address({remWaterStart:1,remWaterEnd:31}),archivedAt:'2026-09-29T10:00:00.000Z'};
  assert.equal(R.schedule(a,{}).some(item=>item.id==='water'),true);
  assert.deepEqual(R.due(a,{},new Date('2026-09-29T07:00:00Z')),[]);
  assert.equal(R.nextDelivery(a,{},new Date('2026-09-29T07:00:00Z')),null);
});
