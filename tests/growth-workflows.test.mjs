import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import '../monthly-summary.js';
import '../onboarding-ui.js';

test('monthly summary keeps cents, partial payment and compares only the adjacent month',()=>{
  const address={name:'Дім',records:[{month:'2026-08',total:80},{month:'2026-09',total:100},{month:'2026-10',total:123.45,paidAmount:23.44,waterCost:100.01,electroCost:23.44}]};
  const report=globalThis.KomunalkaMonthlySummary.build(address,'2026-10',record=>record.paidAmount||0);
  assert.equal(report.total,123.45);assert.equal(report.paid,23.44);assert.equal(report.balance,100.01);assert.equal(report.change,23);assert.equal(report.services.length,2);
  address.records=address.records.filter(record=>record.month!=='2026-09');assert.equal(globalThis.KomunalkaMonthlySummary.build(address,'2026-10',record=>record.paidAmount).change,null);
  assert.equal(globalThis.KomunalkaMonthlySummary.build(address,'2026-11',()=>0),null);
});

test('setup accepts explicit zero and Ukrainian decimals but rejects unknown, negative and invalid rates',()=>{
  const {number,validate}=globalThis.KomunalkaOnboarding;assert.equal(number('0'),0);assert.equal(number('56,7'),56.7);for(const value of ['',null,'-1','NaN','Infinity'])assert.equal(number(value),null);
  const draft={name:'Мій дім',prefs:{showWater:true},tariffs:{water:'0'},previous:{wPrev:''}};assert.equal(validate(draft,0),null);assert.equal(validate(draft,1),null);assert.equal(validate(draft,2),null);draft.previous.wPrev='-5';assert.ok(validate(draft,2));draft.tariffs.water='';assert.ok(validate(draft,1));draft.prefs.showWater=false;assert.ok(validate(draft,0));
  draft.prefs={showElectro:true,electroWinter:true,electroTwoZone:true};draft.tariffs={electroBase:'4.32',electroWinter:''};draft.previous={wPrev:'-5',dPrev:'0',nPrev:'0'};assert.ok(validate(draft,1));draft.tariffs.electroWinter='2.64';assert.equal(validate(draft,1),null);assert.equal(validate(draft,2),null,'inactive readings must not prevent completion');draft.previous.nPrev='-1';assert.ok(validate(draft,2));
});

test('public demo calculates and copies fictional text without reading storage or requesting an API',async()=>{
  const html=await readFile(new URL('../demo.html',import.meta.url),'utf8'),source=await readFile(new URL('../demo.js',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://mykomunalka.pp.ua/demo.html',runScripts:'outside-only'}),w=dom.window;let copied='',requests=0;
  w.fetch=()=>{requests++;throw new Error('DEMO_MUST_NOT_FETCH');};Object.defineProperty(w,'localStorage',{get(){throw new Error('DEMO_MUST_NOT_READ_ACCOUNT_STORAGE');}});w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.scrollIntoView=()=>{};Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
  try{w.eval(source);const d=w.document;assert.match(d.getElementById('demoTotal').textContent,/650/);d.getElementById('demoCurrent').value='281';d.getElementById('demoCurrent').dispatchEvent(new w.Event('input',{bubbles:true}));assert.match(d.getElementById('demoTotal').textContent,/700/);d.getElementById('demoForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(d.getElementById('demoMailSection').hidden,false);d.getElementById('demoCopy').click();await new Promise(resolve=>setTimeout(resolve,0));assert.match(copied,/Поточні 281.*Попередні 267.*Різниця 14/);assert.match(d.getElementById('demoCopyStatus').textContent,/скопійовано/);d.getElementById('demoCurrent').value='260';d.getElementById('demoCurrent').dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.getElementById('demoPrepare').disabled,true);assert.equal(d.getElementById('demoMailSection').hidden,true);assert.equal(requests,0);}finally{dom.window.close();}
});

test('feedback status requires its author, exposes no contacts and bounds work per request',async()=>{
  const {default:worker}=await import('../worker.js'),{environment,legacyAccount}=await import('./helpers.mjs'),{createHash}=await import('node:crypto');
  const password='test-password',hash=createHash('sha256').update(password).digest('hex'),{env}=environment({anna:legacyAccount(hash),boris:legacyAccount(hash)});
  const call=async(body,token)=>worker.fetch(new Request('https://local.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),env);
  const anna=(await(await call({action:'auth_login',login:'anna',password})).json()).sessionToken,boris=(await(await call({action:'auth_login',login:'boris',password})).json()).sessionToken;
  const submitted=await(await call({action:'feedback_submit',type:'problem',message:'Не відкривається потрібний розділ',contact:'private@example.com'},anna)).json();assert.equal(submitted.success,true);
  const own=await(await call({action:'feedback_status',ids:[submitted.id]},anna)).json();assert.equal(own.feedback.length,1);assert.equal(own.feedback[0].status,'new');assert.equal('contact' in own.feedback[0],false);assert.equal('login' in own.feedback[0],false);
  const another=await(await call({action:'feedback_status',ids:[submitted.id]},boris)).json();assert.equal(another.feedback.length,0);assert.equal((await call({action:'feedback_status',ids:[submitted.id]})).status,401);assert.equal((await call({action:'feedback_status',ids:Array(21).fill(submitted.id)},anna)).status,400);
});
