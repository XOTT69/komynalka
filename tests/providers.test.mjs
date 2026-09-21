import {test} from 'node:test';import assert from 'node:assert/strict';import '../providers.js';import '../data-store.js';
const P=globalThis.KomunalkaProviders,D=globalThis.KomunalkaData;
test('provider links allow web URLs, preserve leading-zero accounts and reject executable or credential URLs',()=>{
 assert.equal(P.website('cabinet.example.org/path'),'https://cabinet.example.org/path');
 for(const value of ['javascript:alert(1)','data:text/html,test','file:///private/test','https://user:password@example.org','https://good.example/\nwrong','https:\\evil.example'])assert.throws(()=>P.website(value));
 const settings={k_budget:'1000',providerCards:{'address:home':{'service:water':{legacy:{keep:true},name:'Old'}}}},before=structuredClone(settings);
 const next=P.update(settings,'home','water',{name:'Water',account:'00123',website:'https://example.org',contact:'Телефон'});
 assert.equal(P.get(next,'home','water').account,'00123');assert.deepEqual(P.get(next,'home','water').legacy,{keep:true});assert.deepEqual(P.get(next,'other','water'),{});assert.deepEqual(settings,before);assert.equal(next.k_budget,'1000');
 assert.throws(()=>P.update({providerCards:'corrupt'},'home','water',{}));
});
test('provider changes on independent addresses and concurrent history edits merge without data loss',()=>{
 const base={addresses:[{id:'home',records:[{id:1,total:10,note:'old'}]}],accountSettings:{}};
 const local=structuredClone(base);local.accountSettings=P.update(local.accountSettings,'home','water',{account:'123'});
 const remote=structuredClone(base);remote.accountSettings=P.update(remote.accountSettings,'other','gas',{account:'456'});remote.addresses[0].records[0].note='updated';
 const merged=D.merge(base,local,remote);assert.deepEqual(merged.conflicts,[]);assert.equal(merged.value.addresses[0].records[0].note,'updated');assert.equal(P.get(merged.value.accountSettings,'home','water').account,'123');assert.equal(P.get(merged.value.accountSettings,'other','gas').account,'456');
});
test('copying readings uses only the selected saved month and retains explicit zeros',()=>{
 const a={prefs:{showWater:true,showElectro:true,electroTwoZone:true},records:[{month:'2026-09',wCur:0,dCur:14,nCur:8,_filled:{water:true,electro:false}}]};const before=structuredClone(a);
 assert.equal(P.readings(a,'water','2026-09'),'Вода: 0 м³');assert.equal(P.readings(a,'water','2026-08'),null);assert.equal(P.readings(a,'electro','2026-09'),null);assert.equal(P.readings(a,'custom:s1','2026-09'),null);assert.deepEqual(a,before);
 a.records[0]._filled.electro=true;assert.equal(P.readings(a,'electro','2026-09'),'День: 14 кВт·год\nНіч: 8 кВт·год');
});
test('the sample water email uses saved readings, account and address without changing history',()=>{
 const address={id:'home',name:'Чабани Покровська 306 кв 7',prefs:{showWater:true},records:[{month:'2026-09',wPrev:267,wCur:280,_filled:{water:true},note:'Особисте'}]};
 const before=structuredClone(address),settings=P.update({},'home','water',{name:'Водоканал',account:'6037',website:'',contact:'',email:'water@example.org',emailSubject:'О/р {account}. {address}',emailBody:'Показники ліч. Поточні {current}. Попередні {previous}. Різниця {difference}'});
 const card=P.get(settings,'home','water'),service=P.services(address).find(item=>item.id==='water'),draft=P.emailDraft(address,service,card,'2026-09');
 assert.deepEqual(draft,{to:'water@example.org',subject:'О/р 6037. Чабани Покровська 306 кв 7',body:'Показники ліч. Поточні 280. Попередні 267. Різниця 13',needsReview:false});
 const link=new URL(P.mailto(draft));assert.equal(link.protocol,'mailto:');assert.equal(link.searchParams.get('subject'),draft.subject);assert.equal(link.searchParams.get('body'),draft.body);
 assert.equal(P.emailDraft(address,service,card,'2026-08'),null);assert.deepEqual(address,before);
});
test('email drafts retain explicit zero, separate electricity zones and flag missing previous readings',()=>{
 const address={id:'home',name:'Дім',prefs:{showWater:true,showElectro:true,electroTwoZone:true},records:[{month:'2026-09',wPrev:0,wCur:0,dPrev:100,dCur:108,nPrev:10,nCur:12,_filled:{water:true,electro:true},_enteredPrevious:{wPrev:true,dPrev:true,nPrev:true}},{month:'2026-10',wPrev:0,wCur:280,_filled:{water:true},_enteredPrevious:{wPrev:false}}]};
 const service=P.services(address);const card={email:'me@example.org',account:'0007'};
 const water=P.emailDraft(address,service.find(item=>item.id==='water'),card,'2026-09');assert.match(water.body,/Поточні 0\. Попередні 0\. Різниця 0/);
 const electro=P.emailDraft(address,service.find(item=>item.id==='electro'),card,'2026-09');assert.match(electro.body,/День: поточні 108, попередні 100, різниця 8/);assert.match(electro.body,/Ніч: поточні 12, попередні 10, різниця 2/);
 const missing=P.emailDraft(address,service.find(item=>item.id==='water'),card,'2026-10');assert.equal(missing.needsReview,true);assert.equal(missing.body.includes('Попередні 0'),false);
 const legacyZero=P.emailDraft({name:'Дім',prefs:{showWater:true},records:[{month:'2026-11',wPrev:0,wCur:5,_filled:{water:true}}]},service.find(item=>item.id==='water'),card,'2026-11');assert.equal(legacyZero.needsReview,true);assert.equal(legacyZero.body.includes('Попередні 0'),false);
 assert.throws(()=>P.email('wrong@'),/INVALID_EMAIL/);assert.throws(()=>P.email('a@example.org\r\nBcc:other@example.org'),/INVALID_EMAIL/);
});
