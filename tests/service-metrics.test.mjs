import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {metricsAction,metricOperation,metricOutcome,recordMetrics,METRIC_OPERATIONS} from '../service-metrics.js';
import {deliverReminders} from '../push-delivery.js';
import {environment,legacyAccount} from './helpers.mjs';
import {sha256Hex} from '../password-auth.js';
function fixture(){const data=new Map();const ctx={storage:{get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value)),list:async({prefix='',limit=100}={})=>new Map([...data].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),delete:async key=>data.delete(key),getAlarm:async()=>data.get('alarm'),setAlarm:async time=>data.set('alarm',time),deleteAlarm:async()=>data.delete('alarm')}};return {ctx,data};}
const event=(operation,status=200,durationMs=90)=>({operation,status,durationMs});
test('aggregates preserve result categories and coarse latency, without individual events or identities',async()=>{
 const f=fixture(),now=Date.parse('2026-10-04T12:00Z');
 await metricsAction(f.ctx,{action:'metrics-record',events:[{...event('sync_write',409),login:'private@example.com',ip:'1.2.3.4',message:'secret'},event('sync_write',503,1500),event('sync_write',200,40),event('login',403),event('push_reminder',410),event('telegram_reminder',200,450)]},now);
 const report=await metricsAction(f.ctx,{action:'metrics-read',days:7},now),row=report.rows.find(row=>row.operation==='sync_write');
 assert.deepEqual(row,{operation:'sync_write',count:3,ok:1,auth:0,conflict:1,limited:0,rejected:0,expired:0,failed:1,p95UpperMs:3000});
 assert.equal(report.rows.find(row=>row.operation==='push_reminder').expired,1);
 assert.equal(report.rows.find(row=>row.operation==='login').auth,1);
 assert.equal(report.rows.length,METRIC_OPERATIONS.length);assert.equal(report.collection,'best-effort');
 const stored=JSON.stringify([...f.data]);for(const privateText of ['private@example.com','1.2.3.4','secret','durationMs','message'])assert.equal(stored.includes(privateText),false);
 assert.equal(f.data.has('account'),false);
});
test('retention removes expired daily aggregates even without new events and periods cover UTC dates',async()=>{
 const f=fixture(),now=Date.parse('2026-10-04T12:00Z');
 for(let age=0;age<20;age++)await metricsAction(f.ctx,{action:'metrics-record',events:[event('login')]},now-(19-age)*86400000);
 const report=await metricsAction(f.ctx,{action:'metrics-read',days:14},now);assert.equal(report.rows[0].count,14);assert.equal(report.from,'2026-09-21');
 assert.equal((await metricsAction(f.ctx,{action:'metrics-read',days:1},now)).rows[0].count,1);
 assert.equal([...f.data.keys()].filter(key=>key.startsWith('metrics:')).length,14);
 await metricsAction(f.ctx,{action:'metrics-read',days:14},now+15*86400000);assert.equal(f.data.has('alarm'),false);
 assert.equal([...f.data.keys()].filter(key=>key.startsWith('metrics:')).length,0);
});
test('unknown categories, oversized batches and unbounded periods cannot expand storage',async()=>{
 const f=fixture();for(const events of [[event('private-url')],[event('sync_write',200,Infinity)],Array(129).fill(event('login'))])await assert.rejects(metricsAction(f.ctx,{action:'metrics-record',events}),/INVALID_METRICS/);
 await assert.rejects(metricsAction(f.ctx,{action:'metrics-read',days:365}),/INVALID_METRICS_PERIOD/);assert.equal(f.data.size,0);
 assert.equal(metricOperation('admin_metrics'),null);assert.equal(metricOperation('metrics-record'),null);assert.equal(metricOutcome('push_reminder',302),'rejected');
});
test('only a valid admin session reads metrics; public requests cannot inject counters or retrieve them',async()=>{
 const f=environment(),post=body=>worker.fetch(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)}),f.env,f.executionContext);
 assert.equal((await post({action:'admin_metrics'})).status,401);
 assert.equal((await post({action:'metrics-record',events:[event('login')]})).status,401);
 assert.equal((await post({action:'auth_login',login:'nobody',password:'incorrect'})).status,403);
 await f.flushBackground();
 const login=await(await post({action:'admin_login',pass:'test-only-password'})).json();f.env.MAINTENANCE_MODE='read-only';
 const response=await post({action:'admin_metrics',adminToken:login.token,days:7});assert.equal(response.status,200);
 const report=await response.json();assert.equal(report.rows[0].auth,1);assert.equal(report.rows[0].count,1);assert.equal(response.headers.get('Cache-Control'),'no-store');
 const metrics=f.stores.get('__service_metrics__');assert.equal(metrics.has('account'),false);
});
test('broken monitoring never blocks successful account writes, including background failures',async()=>{
 const hash=await sha256Hex('test-password'),original=legacyAccount(hash),f=environment({anna:original}),get=f.env.ACCOUNT_STORE.get;
 f.env.ACCOUNT_STORE.get=name=>name==='__service_metrics__'?{fetch:async()=>{throw new Error('Metrics offline');}}:get(name);
 const authorization='Bearer login:'+btoa('anna')+':'+hash;
 const response=await worker.fetch(new Request('https://test.invalid',{method:'POST',headers:{Authorization:authorization},body:JSON.stringify({...original,baseRevision:1,syncProtocol:2,clientMutationId:'monitor-independent'})}),f.env,f.executionContext);
 assert.equal(response.status,200);await f.flushBackground();assert.deepEqual(f.stores.get('anna').get('account').value.addresses,original.addresses);
 let task;recordMetrics({ACCOUNT_STORE:{idFromName:x=>x,get(){throw new Error('offline');}}},{waitUntil(value){task=value;}},[event('login')]);assert.equal(task,undefined);
});
test('reminder monitoring counts only actual attempts and preserves daily de-duplication and retries',async()=>{
 const f=fixture(),env=environment();f.ctx.waitUntil=env.executionContext.waitUntil;
 f.data.set('push',{subscriptions:[{subscription:{endpoint:'fictional-success'}},{subscription:{endpoint:'fictional-expired'}}]});
 f.data.set('telegram',{chatId:'private-chat'});f.data.set('account',{value:{addresses:[{id:'private-address',prefs:{showWater:true,showElectro:false,showGas:false,remindersEnabled:true,remWaterStart:20,remWaterEnd:25}}]}});
 const bindings={...env.env,VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test',VAPID_SUBJECT:'test',TG_BOT_TOKEN:'test'},now=new Date('2026-10-20T06:00Z');
 await deliverReminders(f.ctx,bindings,async(_env,sub)=>sub.endpoint==='fictional-expired'?410:201,now,async()=>503);await env.flushBackground();
 await deliverReminders(f.ctx,bindings,async()=>assert.fail('Successful push must not repeat'),now,async()=>200);await env.flushBackground();
 const object=env.env.ACCOUNT_STORE.get('__service_metrics__'),report=await(await object.fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({action:'metrics-read'})}))).json();
 assert.equal(report.rows.find(row=>row.operation==='push_reminder').count,2);assert.equal(report.rows.find(row=>row.operation==='push_reminder').expired,1);
 assert.equal(report.rows.find(row=>row.operation==='telegram_reminder').failed,1);assert.equal(report.rows.find(row=>row.operation==='telegram_reminder').ok,1);
 assert.equal(f.data.get('telegram').lastDay,'2026-10-20');assert.equal(JSON.stringify([...env.stores.get('__service_metrics__')]).includes('private-'),false);
});

test('a failed channel-state write does not count a second provider attempt',async()=>{
 const f=fixture(),bindings=environment();f.ctx.waitUntil=bindings.executionContext.waitUntil;
 f.data.set('telegram',{chatId:'fictional'});f.data.set('account',{value:{addresses:[{id:'fictional',prefs:{showWater:true,showElectro:false,showGas:false,remindersEnabled:true}}]}});
 const put=f.ctx.storage.put;let failed=false;f.ctx.storage.put=async(key,value)=>{if(key==='telegram'&&!failed){failed=true;throw new Error('Storage interrupted');}return put(key,value);};
 await deliverReminders(f.ctx,{...bindings.env,TG_BOT_TOKEN:'fictional'},async()=>assert.fail('No push'),new Date('2026-10-01T06:00Z'),async()=>200);await bindings.flushBackground();
 const report=await(await bindings.env.ACCOUNT_STORE.get('__service_metrics__').fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({action:'metrics-read'})}))).json(),row=report.rows.find(row=>row.operation==='telegram_reminder');
 assert.equal(row.count,1);assert.equal(row.ok,1);assert.equal(row.failed,0);
});
