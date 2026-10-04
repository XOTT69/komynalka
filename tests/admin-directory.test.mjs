import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {accountSummary} from '../admin-directory.js';
import {environment,legacyAccount} from './helpers.mjs';
const hash=createHash('sha256').update('test-password').digest('hex');
async function admin(env){const call=async body=>worker.fetch(new Request('https://test.workers.dev',{method:'POST',body:JSON.stringify(body)}),env);const login=await(await call({action:'admin_login',pass:env.ADMIN_PASS})).json();return body=>call({...body,adminToken:login.token});}
async function prepare(call){let result;let requests=0;do{result=await(await call({action:'admin_index_prepare'})).json();assert.equal(result.success,true);assert.ok(++requests<30);}while(!result.indexReady);return result;}
test('directory pages 1200 accounts without reading financial accounts after initial build; filters and statistics span all pages',async()=>{
 const seed={opaque:'old-opaque-preserve'};for(let i=0;i<1200;i++){const data=legacyAccount(hash);data.displayName=i===1199?'Петро Українець':'Тест';data.isPro=i%2===0;data.hasGoogle=i%3===0;data.addresses[0].records[0].month='2026-10';seed['user-'+String(i).padStart(4,'0')]=data;}
 const {env,values}=environment(seed),call=await admin(env);assert.equal((await(await call({action:'admin_stats',paginated:true})).json()).indexReady,false);
 await prepare(call);
 const get=env.ACCOUNT_STORE.get;let accountReads=0;env.ACCOUNT_STORE.get=login=>{if(!login.startsWith('__'))accountReads++;return get(login);};
 let cursor,users=[];do{const data=await(await call({action:'admin_stats',paginated:true,limit:50,sort:'records',dir:'desc',cursor})).json();assert.equal(data.users.length<=50,true);assert.equal(data.stats.totalUsers,1200);assert.equal(data.stats.totalRecords,1200);assert.equal(data.stats.proUsers,600);assert.equal(data.stats.googleUsers,400);assert.equal(data.unrecognizedAccounts,1);users.push(...data.users);cursor=data.cursor;}while(cursor);
 assert.equal(users.length,1200);assert.equal(new Set(users.map(u=>u.login)).size,1200);assert.equal(accountReads,0);assert.equal(values.get('opaque'),'old-opaque-preserve');
 const searched=await(await call({action:'admin_stats',paginated:true,q:'українець',pro:'free'})).json();assert.equal(searched.total,1);assert.equal(searched.users[0].login,'user-1199');
 const first=await(await call({action:'admin_stats',paginated:true,limit:2})).json();assert.equal((await call({action:'admin_stats',paginated:true,cursor:first.cursor,q:'other'})).status,400);
 assert.equal((await call({action:'admin_stats',paginated:true,sort:'records; DROP TABLE admin_users'})).status,400);
 assert.equal((await call({action:'admin_stats',paginated:true,limit:1000})).status,400);
});
test('directory summaries never contain credentials, financial values, addresses, contacts or notes; newest revisions win and deletion hides rows',async()=>{
 const {env}=environment({anna:legacyAccount(hash)}),call=await admin(env);await prepare(call);
 const stub=env.ACCOUNT_STORE.get('__admin_directory__'),update=summary=>stub.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({action:'directory-upsert',summary})}));
 const state={login:'anna',value:legacyAccount(hash),revision:10};state.value.addresses[0].records.push({month:'2026-09',total:100});const summary=accountSummary(state);
 for(const key of ['pass','passHash','credential','tariffs','total','contact','note'])assert.equal(JSON.stringify(summary).includes('"'+key+'"'),false);
 await update(summary);await update(accountSummary({...state,revision:1,value:legacyAccount(hash)}));assert.equal((await(await call({action:'admin_stats',paginated:true})).json()).users[0].records,2);
 await update(accountSummary({login:'anna',revision:11,value:null,deleted:true}));await update(summary);const result=await(await call({action:'admin_stats',paginated:true})).json();assert.equal(result.total,0);assert.equal(result.stats.totalUsers,0);
});
test('committed account changes survive index outage and replay without overwriting account data',async()=>{
 const {env,stores}=environment({anna:legacyAccount(hash)}),call=await admin(env);await prepare(call);
 const stub=env.ACCOUNT_STORE.get('anna'),send=body=>stub.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({login:'anna',...body})}));
 const before=await(await send({action:'read'})).json(),get=env.ACCOUNT_STORE.get;let unavailable=true;env.ACCOUNT_STORE.get=login=>{if(login==='__admin_directory__'&&unavailable)throw new Error('test outage');return get(login);};
 const value={...before.value,isPro:true};assert.equal((await send({action:'write',value,expectedRevision:before.revision})).status,200);assert.deepEqual(stores.get('anna').get('account').value,value);assert.ok(stores.get('anna').get('directory-pending'));
 unavailable=false;await stub.alarm();assert.equal(stores.get('anna').has('directory-pending'),false);assert.equal((await(await call({action:'admin_stats',paginated:true})).json()).stats.proUsers,1);assert.deepEqual(stores.get('anna').get('account').value,value);
});
test('feedback pages search the full index and only return the requested page; status changes and delayed repair remain visible',async()=>{
 const seed={};for(let i=0;i<350;i++){const id=(1759220000000+i)+'-abcdefgh';seed['feedback:'+id]={id,type:i%2?'idea':'problem',status:'new',login:'guest',message:i===349?'Особлива пропозиція':'Тестове звернення',createdAt:new Date(1759220000000+i).toISOString()};}
 const {env}=environment(seed),call=await admin(env);await prepare(call);let cursor,ids=[];do{const data=await(await call({action:'admin_feedback_list',paginated:true,limit:25,cursor})).json();assert.equal(data.total,350);assert.ok(data.feedback.length<=25);ids.push(...data.feedback.map(i=>i.id));cursor=data.cursor;}while(cursor);assert.equal(new Set(ids).size,350);
 const searched=await(await call({action:'admin_feedback_list',paginated:true,q:'Особлива'})).json();assert.equal(searched.total,1);assert.equal(searched.feedback[0].id,ids[0]);
 assert.equal((await call({action:'admin_feedback_update',id:ids[0],status:'done'})).status,200);assert.equal((await(await call({action:'admin_feedback_list',paginated:true,status:'active'})).json()).total,349);
 const unauth=await worker.fetch(new Request('https://test.workers.dev',{method:'POST',body:JSON.stringify({action:'admin_stats',paginated:true})}),env);assert.equal(unauth.status,401);
});
test('Unicode cursor round trips, and explicit restore refreshes summaries even when it restores an older revision',async()=>{
 const seed={};for(let i=0;i<4;i++)seed['Тест-'+i]=legacyAccount(hash);
 const {env}=environment(seed),call=await admin(env);await prepare(call);
 const first=await(await call({action:'admin_stats',paginated:true,limit:2,sort:'login',dir:'asc',q:'Тест'})).json();assert.equal(first.users.length,2);const next=await(await call({action:'admin_stats',paginated:true,limit:2,sort:'login',dir:'asc',q:'Тест',cursor:first.cursor})).json();assert.equal(next.users.length,2);assert.notEqual(next.users[0].login,first.users[0].login);
 const stub=env.ACCOUNT_STORE.get('Тест-0'),send=async body=>stub.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({login:'Тест-0',...body})}));
 const old=(await(await send({action:'backup-snapshot'})).json()).snapshot;await send({action:'write',expectedRevision:1,value:{...old.account.value,isPro:true}});assert.equal((await(await call({action:'admin_stats',paginated:true})).json()).stats.proUsers,1);
 assert.equal((await send({action:'restore-snapshot',snapshot:old})).status,200);assert.equal((await(await call({action:'admin_stats',paginated:true})).json()).stats.proUsers,0);
});
