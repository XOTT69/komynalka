import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {environment,legacyAccount} from './helpers.mjs';
import '../operational-backup.js';
import {verifyPassword} from '../password-auth.js';
import {verifyBackup} from '../scripts/verify-backup.mjs';
const hash=createHash('sha256').update('test-password').digest('hex');
const request=(env,body,token)=>worker.fetch(new Request('https://test.workers.dev',{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:JSON.stringify(body)}),env);
async function login(env){return (await request(env,{action:'auth_login',login:'anna',password:'test-password'})).json();}
async function admin(env){return (await request(env,{action:'admin_login',pass:'test-only-password'})).json();}

test('legacy save cannot register accounts or impersonate internal object names',async()=>{
  const {env,values}=environment(),token=`login:${btoa('anna')}:${hash}`;
  assert.equal((await request(env,{addresses:legacyAccount(hash).addresses,baseRevision:0,clientMutationId:'bypass'},token)).status,404);
  assert.equal(values.has('anna'),false);
  for(const name of ['__security__','uid_fake','community_tariffs'])assert.equal((await request(env,{action:'auth_register',login:name,password:'test-password'})).status,400);
});

test('guest responses are whitelisted and stale KV cannot resurrect revoked legacy access',async()=>{
  const account=legacyAccount(hash),token='old_share_token_12345',key=`share_${token}`,mapping={phone:'anna',addressId:'home'};
  account.addresses[0].providers={water:{account:'PRIVATE',email:'private@example.invalid'}};
  account.addresses[0].tariffs.private='PRIVATE_TARIFF';account.addresses[0].records[0].customData={test:{name:'Extra',val:10,secret:'PRIVATE_CUSTOM'}};account.addresses[0].records[0].tariffSnapshot.secret='PRIVATE_SNAPSHOT';account.addresses[0].records[0].paymentProof='PRIVATE_PROOF';account.addresses[0].records[0].note='PRIVATE_NOTE';
  const {env,values}=environment({anna:account,[key]:mapping});
  const read=()=>worker.fetch(new Request(`https://test.workers.dev?share=${token}`),env);
  const response=await read(),body=await response.json();assert.equal(response.status,200);assert.equal(body.data.addresses[0].records[0].total,151.9);assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
  const signed=await login(env),list=await(await request(env,{action:'share_list'},signed.sessionToken)).json();assert.equal(list.shares.length,1);
  assert.equal((await request(env,{action:'share_revoke',id:list.shares[0].id},signed.sessionToken)).status,200);
  values.set(key,JSON.stringify(mapping));assert.equal((await read()).status,404);
});

test('expired shares and share-limit enforcement leave no invisible active links',async()=>{
  const token='e'.repeat(48),{env,values}=environment({anna:legacyAccount(hash),[`share:${token}`]:{login:'anna',addressId:'home',expiresAt:Date.now()-1}});
  assert.equal((await worker.fetch(new Request(`https://test.workers.dev?share=${token}`),env)).status,404);
  const signed=await login(env);
  for(let i=0;i<30;i++)assert.equal((await request(env,{action:'generate_share',addressId:'home'},signed.sessionToken)).status,200);
  assert.equal((await request(env,{action:'generate_share',addressId:'home'},signed.sessionToken)).status,409);
  const list=await(await request(env,{action:'share_list'},signed.sessionToken)).json();assert.equal(list.shares.length,30);
  assert.equal([...values.keys()].filter(key=>key.startsWith('share:')).length,31); // 30 live + the deliberately expired fixture
});

test('account deletion purges authoritative private state and does not touch another account',async()=>{
  const {env,stores}=environment({anna:legacyAccount(hash),bob:legacyAccount(hash)}),signed=await login(env);
  await request(env,{action:'delete_account',confirmation:'anna',password:'test-password'},signed.sessionToken);
  const store=stores.get('anna');assert.equal(store.get('account').value,null);assert.equal(store.has('previous'),false);assert.equal(store.has('legacy-original'),false);
  const bob=await request(env,{action:'auth_login',login:'bob',password:'test-password'});assert.equal(bob.status,200);
});

test('session management is account-scoped and revokes other devices only',async()=>{
  const {env}=environment({anna:legacyAccount(hash),bob:legacyAccount(hash)}),a=await login(env),b=await login(env),other=await(await request(env,{action:'auth_login',login:'bob',password:'test-password'})).json();
  const list=await(await request(env,{action:'session_list'},a.sessionToken)).json();assert.equal(list.sessions.length,2);assert.equal(list.sessions.filter(item=>item.current).length,1);
  await request(env,{action:'session_revoke_others'},a.sessionToken);
  const get=token=>worker.fetch(new Request('https://test.workers.dev',{headers:{Authorization:`Bearer ${token}`}}),env);
  assert.equal((await get(a.sessionToken)).status,200);assert.notEqual((await get(b.sessionToken)).status,200);assert.equal((await get(other.sessionToken)).status,200);
});

test('newest feedback remains visible after 500 items with stable pagination',async()=>{
  const seed={};for(let i=0;i<501;i++){const id=`${1700000000000+i}-abcdefgh`;seed[`feedback:${id}`]={id,type:'problem',status:'new',createdAt:new Date(1700000000000+i).toISOString(),message:'fictional'};}
  const {env}=environment(seed),signed=await admin(env);const first=await(await request(env,{action:'admin_feedback_list',adminToken:signed.token})).json();assert.equal(first.feedback[0].id,'1700000000500-abcdefgh');assert.equal(first.total,501);assert.equal(first.feedback.length,100);
  const next=await(await request(env,{action:'admin_feedback_list',adminToken:signed.token,cursor:first.cursor})).json();assert.equal(next.feedback.length,100);assert.notEqual(first.feedback.at(-1).id,next.feedback[0].id);
});

test('recovery archive keeps current credentials despite KV failure and encrypted copies detect tampering',async()=>{
  const {env,values}=environment({anna:legacyAccount(hash)}),put=env.KV.put;env.KV.put=async(key,value)=>{if(key==='anna')throw new Error('fixture mirror failure');return put(key,value);};
  await login(env);const signed=await admin(env),backup=await(await request(env,{action:'admin_backup_account',adminToken:signed.token,login:'anna'})).json();
  assert.equal(await verifyPassword('test-password',backup.snapshot.account.value.credential),true);
  assert.equal(JSON.parse(values.get('anna')).credential,undefined);
  const archive=await KomunalkaBackup.create({authorities:[backup.snapshot],kvEntries:[...values].map(([name,value])=>({name,value})),community:{list:[],revision:1},version:'test',readOnly:true});await KomunalkaBackup.verify(archive);verifyBackup(archive,{forMigration:true});
  const sealed=await KomunalkaBackup.seal(archive,'test-archive-password'),opened=await KomunalkaBackup.unseal(sealed,'test-archive-password');assert.deepEqual(opened,archive);
  await assert.rejects(KomunalkaBackup.unseal(sealed,'incorrect-password'));
  const corrupt=structuredClone(archive);corrupt.authorities[0].account.value.addresses[0].records[0].total=0;await assert.rejects(KomunalkaBackup.verify(corrupt));
});

test('rate limit alarms remove expired buckets without discarding live counters',async()=>{
  const {env,stores}=environment(),stub=env.ACCOUNT_STORE.get('__security-rate-test__');
  await stub.fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({login:'__security-rate-test__',action:'rate-limit',key:'test',limit:2,windowMs:1000})}));
  const store=stores.get('__security-rate-test__');store.set('rate:expired',{expiresAt:1});await stub.alarm();assert.equal(store.has('rate:expired'),false);assert.equal(store.has('rate:test'),true);
});

test('admin health probes actual stores and the private audit log excludes secrets',async()=>{
  const {env,values}=environment({anna:legacyAccount(hash)}),signed=await admin(env);
  const health=await(await request(env,{action:'admin_health',adminToken:signed.token})).json();assert.equal(health.kv,true);assert.equal(health.authority,true);assert.equal(health.integrationCheck,'configuration-only');assert.equal(health.integrations.telegram,false);
  env.TG_BOT_TOKEN='fictional-bot-token';const configured=await(await request(env,{action:'admin_health',adminToken:signed.token})).json();assert.equal(configured.integrations.telegram,true);assert.doesNotMatch(JSON.stringify(configured),/fictional-bot-token/);
  assert.equal((await request(env,{action:'admin_audit_list'})).status,401);
  await request(env,{action:'admin_give_pro',login:'anna',adminToken:signed.token,pass:'SHOULD_NOT_LOG'},undefined);
  const list=await(await request(env,{action:'admin_audit_list',adminToken:signed.token})).json();assert.equal(list.entries.length,1);assert.equal(list.entries[0].status,'success');assert.equal(list.entries[0].target,'anna');assert.doesNotMatch(JSON.stringify(list),/SHOULD_NOT_LOG/);assert.ok(!JSON.stringify(list).includes(signed.token));
  const before=values.size;await login(env);assert.equal((await(await request(env,{action:'admin_stats',adminToken:signed.token})).json()).users.length,1);assert.ok(values.size>=before);
});

test('legacy capitalization directory is built once and repeated missing logins do not rescan KV',async()=>{
  const {env}=environment({Marina:legacyAccount(hash)}),list=env.KV.list;let scans=0;env.KV.list=async options=>{scans++;return list(options);};
  const sign=name=>request(env,{action:'auth_login',login:name,password:'test-password'});
  assert.equal((await sign('marina')).status,200);const initial=scans;
  assert.equal((await sign('absent-one')).status,403);assert.equal((await sign('absent-two')).status,403);assert.equal(scans,initial);
});

test('deletion retries alias cleanup after a KV failure while keeping private state purged',async()=>{
  const {env,values,stores}=environment({anna:legacyAccount(hash),'uid:test':'anna'}),signed=await login(env),remove=env.KV.delete;let fail=true;
  env.KV.delete=async key=>{if(key==='uid:test'&&fail)throw new Error('fixture transient failure');return remove(key);};
  const response=await request(env,{action:'delete_account',confirmation:'anna',password:'test-password'},signed.sessionToken),body=await response.json();assert.equal(response.status,200);assert.equal(body.cleanupPending,true);assert.equal(stores.get('anna').get('account').value,null);assert.equal(values.has('anna'),false);assert.equal(values.has('uid:test'),true);
  fail=false;await env.ACCOUNT_STORE.get('anna').alarm();assert.equal(values.has('uid:test'),false);assert.equal(stores.get('anna').has('delete-cleanup'),false);assert.equal(stores.get('anna').has('__alarm'),false);
});

test('read-only login does not migrate the account while recovery writes are paused',async()=>{
  const original=legacyAccount(hash),{env,values}=environment({anna:original});env.MAINTENANCE_MODE='read-only';const signed=await login(env);assert.ok(signed.sessionToken);assert.deepEqual(JSON.parse(values.get('anna')),original);
});
