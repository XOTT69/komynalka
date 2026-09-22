import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {prepareBot,webhookSecret} from '../telegram.js';
import {deliverReminders} from '../push-delivery.js';
import {environment,legacyAccount} from './helpers.mjs';
const hash=createHash('sha256').update('test-password').digest('hex');
const auth=login=>`Bearer login:${Buffer.from(login).toString('base64')}:${hash}`;
const account=(login,action)=>new Request('https://test.workers.dev/',{method:'POST',headers:{Authorization:auth(login),'Content-Type':'application/json'},body:JSON.stringify({action})});
const incoming=(text,secret)=>new Request('https://test.workers.dev/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret,'Content-Type':'application/json'},body:JSON.stringify({message:{chat:{id:12345,type:'private'},text}})});
test('Telegram requires an authenticated account and private webhook, links once, and never changes readings',async()=>{
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});const method=String(url).split('/').at(-1);return Response.json({ok:true,result:method==='getMe'?{username:'KomunalkaTestBot'}:method==='getWebhookInfo'?{url:''}:true});};
 const legacy=legacyAccount(hash),{env,stores,values}=environment({anna:legacy});env.TG_BOT_TOKEN='test-bot-token';
 try{
  const firstRequest=account('anna','telegram_status');assert.match(firstRequest.headers.get('Authorization'),/^Bearer login:/);const unavailable=await worker.fetch(firstRequest,env),initial=await unavailable.json();assert.equal(initial.connected,false,JSON.stringify(initial));
  assert.equal((await worker.fetch(new Request('https://test.workers.dev/',{method:'POST',body:JSON.stringify({action:'telegram_begin'})}),env)).status,401);
  const begin=await(await worker.fetch(account('anna','telegram_begin'),env)).json();assert.equal(begin.success,true);assert.match(begin.url,/^https:\/\/t\.me\/KomunalkaTestBot\?start=[a-f0-9]{32}$/);
  const token=new URL(begin.url).searchParams.get('start'),secret=await webhookSecret(env);
  assert.equal((await worker.fetch(incoming(`/start ${token}`,'wrong'),env)).status,403);
  assert.equal((await worker.fetch(incoming(`/start ${token}`,secret),env)).status,200);
  assert.equal((await(await worker.fetch(account('anna','telegram_status'),env)).json()).connected,true);
  assert.equal(values.has(`tg-link:${token}`),false);assert.equal(values.get('tg-chat:12345'),'anna');
  assert.deepEqual(JSON.parse(values.get('anna')),legacy);
  const state=stores.get('anna');state.get('account').value.addresses[0].prefs={showWater:true,showElectro:false,showGas:false,remindersEnabled:true,remWaterStart:20,remWaterEnd:25};
  const storage={get:async k=>structuredClone(state.get(k)),put:async(k,v)=>state.set(k,structuredClone(v)),setAlarm:async v=>state.set('__alarm',v),deleteAlarm:async()=>state.delete('__alarm')};
  const ctx={storage},now=new Date('2026-09-21T06:00:00Z');let delivered=0;
  await deliverReminders(ctx,env,async()=>assert.fail('No push subscription'),now,async(_env,chat,text)=>{assert.equal(chat,'12345');assert.match(text,/Вода/);assert.equal(text.includes('280'),false);delivered++;return 200;});
  await deliverReminders(ctx,env,async()=>assert.fail('No push subscription'),now,async()=>{delivered++;return 200;});assert.equal(delivered,1);
  const relink=await(await worker.fetch(account('anna','telegram_begin'),env)).json();assert.equal((await worker.fetch(incoming(`/start ${new URL(relink.url).searchParams.get('start')}`,secret),env)).status,200);
  await deliverReminders(ctx,env,async()=>assert.fail('No push subscription'),now,async()=>{delivered++;return 200;});assert.equal(delivered,1,'relinking the same chat must not duplicate today’s reminder');
  assert.equal((await worker.fetch(incoming('/stop',secret),env)).status,200);assert.equal(values.has('tg-chat:12345'),false);assert.equal((await(await worker.fetch(account('anna','telegram_status'),env)).json()).connected,false);assert.deepEqual(JSON.parse(values.get('anna')),legacy);
  assert.equal(calls.some(call=>call.url.endsWith('/setWebhook')),true);
 }finally{globalThis.fetch=originalFetch;}
});
test('bot API works when the Worker runtime has no AbortSignal.timeout',async()=>{
 const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
 Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:undefined});
 globalThis.fetch=async(url)=>Response.json({ok:true,result:String(url).endsWith('/getMe')?{username:'KomunalkaBot'}:{url:''}});
 try{
  const result=await prepareBot({TG_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh'},'https://test.workers.dev/');
  assert.equal(result,'KomunalkaBot');
 }finally{globalThis.fetch=originalFetch;Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:originalTimeout});}
});
test('Telegram API redirects are not followed with the bot token',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://example.com/'}});};
 try{await assert.rejects(()=>prepareBot({TG_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg2'},'https://test.workers.dev/'),/TELEGRAM_REDIRECT_BLOCKED/);}
 finally{globalThis.fetch=originalFetch;}
});
test('an existing webhook is preserved until its owner approves moving the bot',async()=>{
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');const method=String(url).split('/').at(-1);calls.push(method);return Response.json({ok:true,result:method==='getMe'?{username:'KomunProgaBot'}:{url:'https://other.example/telegram'}});};
 try{await assert.rejects(()=>prepareBot({TG_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg3'},'https://test.workers.dev/'),/TELEGRAM_WEBHOOK_CONFLICT/);assert.deepEqual(calls,['getMe','getWebhookInfo']);}
 finally{globalThis.fetch=originalFetch;}
});
test('only the signed-in owner may repoint an existing Telegram bot',async()=>{
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{const method=String(url).split('/').at(-1);calls.push(method);return Response.json({ok:true,result:method==='getMe'?{username:'KomunProgaBot'}:method==='getWebhookInfo'?{url:'https://old.example/telegram'}:true});};
 const {env}=environment({xott69:legacyAccount(hash),anna:legacyAccount(hash)});env.TG_BOT_TOKEN='123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg4';env.ADMIN_OWNER_LOGIN='xott69';
 try{
  const other=await worker.fetch(account('anna','telegram_begin'),env);assert.equal(other.status,503);assert.equal((await other.json()).error,'TELEGRAM_WEBHOOK_CONFLICT');assert.equal(calls.includes('setWebhook'),false);
  const owner=await worker.fetch(account('xott69','telegram_begin'),env);assert.equal(owner.status,200);assert.match((await owner.json()).url,/^https:\/\/t\.me\/KomunProgaBot\?start=/);assert.equal(calls.filter(method=>method==='setWebhook').length,1);
 }finally{globalThis.fetch=originalFetch;}
});
