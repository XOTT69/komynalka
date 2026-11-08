import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {environment,legacyAccount} from './helpers.mjs';
import '../data-model.js';
const M=globalThis.KomunalkaModel,hash=createHash('sha256').update('test-password').digest('hex');
const save=(env,body)=>worker.fetch(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:`Bearer login:${btoa('anna')}:${hash}`},body:JSON.stringify(body)}),env);

test('write validation rejects injected readings, negative money and duplicate months without any account change',async()=>{
  for(const mutate of [a=>{a.records[0].wCur='<img onerror="alert(1)">';},a=>{a.records[0].customCost=-100;a.records[0].total=-50;},a=>{a.records.push({...a.records[0],id:'new-id'});}]){
    const original=legacyAccount(hash),{env,stores}=environment({anna:original}),next=structuredClone(original);mutate(next.addresses[0]);
    const response=await save(env,{...next,baseRevision:1,clientMutationId:'invalid'});
    assert.equal(response.status,400);assert.deepEqual(stores.get('anna').get('account').value,original);
  }
});

test('unchanged unusual legacy values and duplicate months remain readable and writable without losing records',async()=>{
  const original=legacyAccount(hash),a=original.addresses[0];
  a.records[0].oldExtra={nested:['keep',0,false]};a.records[0].wCur='<old imported text>';
  a.records.push({...structuredClone(a.records[0]),id:'legacy-second',note:'Distinct original'});
  const before=structuredClone(a.records),{env}=environment({anna:original});
  const response=await save(env,{...original,accountSettings:{changed:'only preferences'},baseRevision:1,clientMutationId:'keep-legacy'});
  assert.equal(response.status,200);
  const read=await worker.fetch(new Request('https://fixture.invalid',{headers:{Authorization:`Bearer login:${btoa('anna')}:${hash}`}}),env);
  assert.deepEqual((await read.json()).data.addresses[0].records,before);
});

test('serialized payload budget counts UTF-8 and leaves inputs unchanged',()=>{
  const a=legacyAccount(hash),before=structuredClone(a);M.checkSize(a);assert.deepEqual(a,before);
  const huge={...a,accountSettings:{text:'ї'.repeat(M.MAX_SYNC_BYTES/2)}};
  assert.throws(()=>M.checkSize(huge),/PAYLOAD_TOO_LARGE/);
});

test('meter presence distinguishes missing zones, explicit zero and unfilled legacy placeholders',()=>{
  assert.equal(M.entered({wCur:0,_filled:{water:false}},'wCur','water'),false);
  assert.equal(M.entered({wCur:0,_filled:{water:true}},'wCur','water'),true);
  assert.equal(M.entered({nCur:0,_filled:{electro:true},_enteredCurrent:{nCur:false}},'nCur','electro'),false);
});

test('shared electricity billing covers zero, two zones and the winter threshold',()=>{
  const t={electroBase:4,electroWinter:2,winterLimit:100,nightCoef:.5};
  assert.equal(M.electricity(0,0,t,true),0);assert.equal(M.electricity(80,20,t,false),360);
  assert.equal(M.electricity(80,20,t,true),180);assert.equal(M.electricity(100,100,t,true),450);
});

test('forecast uses calendar spacing and target month, excludes future history and makes no accuracy claim',()=>{
 const history=[{month:'2026-01',total:100},{month:'2026-03',total:300},{month:'2026-04',total:400},{month:'2027-01',total:99999}];
 const next=M.forecast(history,'2026-05'),later=M.forecast(history,'2026-08');assert.equal(next.predicted,500);assert.equal(later.predicted,800);assert.equal(next.confidence,'estimate');assert.equal(next.sampleMonths,3);assert.equal(next.spanMonths,4);
});
