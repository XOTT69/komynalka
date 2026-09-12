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
