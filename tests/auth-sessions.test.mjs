import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {environment,legacyAccount} from './helpers.mjs';

const oldPassword='test-password';
const oldHash=createHash('sha256').update(oldPassword).digest('hex');

function request(env,body,token='',url='https://test.workers.dev'){
  return worker.fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),env);
}

function get(env,token,url='https://test.workers.dev'){
  return worker.fetch(new Request(url,{headers:{Authorization:`Bearer ${token}`}}),env);
}

async function login(env,loginName,password){
  const response=await request(env,{action:'auth_login',login:loginName,password});
  return {response,data:await response.json()};
}

async function adminToken(env){
  const response=await request(env,{action:'admin_login',pass:env.ADMIN_PASS}),data=await response.json();
  assert.equal(response.status,200);return data.token;
}

test('registration is explicit, enforces the password policy and stores no reusable password hash',async()=>{
  const {env,values}=environment();
  assert.equal((await request(env,{action:'auth_register',login:'new-user',password:'short'})).status,400);
  const response=await request(env,{action:'auth_register',login:'new-user',password:'StrongPass9'}),data=await response.json();
  assert.equal(response.status,201);assert.match(data.sessionToken,/^s1\./);assert.equal(data.data.hasPassword,true);
  const stored=JSON.parse(values.get('new-user'));
  assert.equal(stored.pass,undefined);assert.equal(stored.passHash,undefined);assert.equal(stored.credential.algorithm,'PBKDF2-SHA256');assert.notEqual(stored.credential.hash,createHash('sha256').update('StrongPass9').digest('hex'));
  assert.equal((await get(env,data.sessionToken)).status,200);
  assert.equal((await request(env,{action:'auth_register',login:'new-user',password:'AnotherPass8'})).status,409);
});

test('first password login migrates a legacy account without changing its utility history',async()=>{
  const legacy=legacyAccount(oldHash),{env,values}=environment({Anna:legacy});
  const {response,data}=await login(env,'anna',oldPassword);
  assert.equal(response.status,200);assert.equal(data.data.linkedLogin,'Anna');assert.deepEqual(data.data.addresses,legacy.addresses);
  const migrated=JSON.parse(values.get('Anna'));
  assert.equal(migrated.pass,undefined);assert.equal(migrated.passHash,undefined);assert.equal(migrated.credential.algorithm,'PBKDF2-SHA256');assert.deepEqual(migrated.addresses,legacy.addresses);
  assert.equal((await get(env,data.sessionToken)).status,200);
  const legacyToken=`login:${Buffer.from('anna').toString('base64')}:${oldHash}`;
  assert.equal((await get(env,legacyToken)).status,403);
});

test('simultaneous first logins converge on one legacy-account migration',async()=>{
  const {env}=environment({anna:legacyAccount(oldHash)});
  const results=await Promise.all([login(env,'anna',oldPassword),login(env,'anna',oldPassword)]);
  assert.deepEqual(results.map(item=>item.response.status).sort(),[200,200]);
  assert.notEqual(results[0].data.sessionToken,results[1].data.sessionToken);
});

test('changing a password preserves account data, revokes old sessions and returns a replacement session',async()=>{
  const legacy=legacyAccount(oldHash),{env,values}=environment({anna:legacy});
  const signedIn=await login(env,'anna',oldPassword);assert.equal(signedIn.response.status,200);
  const changed=await request(env,{action:'change_password',oldPass:oldPassword,newPass:'NewStrongPass8'},signedIn.data.sessionToken),body=await changed.json();
  assert.equal(changed.status,200);assert.match(body.sessionToken,/^s1\./);assert.notEqual(body.sessionToken,signedIn.data.sessionToken);
  assert.notEqual((await get(env,signedIn.data.sessionToken)).status,200);
  assert.equal((await login(env,'anna',oldPassword)).response.status,403);
  assert.equal((await login(env,'anna','NewStrongPass8')).response.status,200);
  assert.deepEqual(JSON.parse(values.get('anna')).addresses,legacy.addresses);
});

test('account export omits credentials and guest links can be listed and revoked',async()=>{
  const legacy=legacyAccount(oldHash),{env}=environment({anna:legacy});
  const signedIn=await login(env,'anna',oldPassword),token=signedIn.data.sessionToken;
  const exported=await(await request(env,{action:'account_export'},token)).json();
  assert.equal(exported.export.login,'anna');assert.equal('credential' in exported.export.data,false);assert.equal('pass' in exported.export.data,false);assert.deepEqual(exported.export.data.addresses,legacy.addresses);
  const made=await(await request(env,{action:'generate_share',addressId:'home',days:7},token)).json();
  assert.match(made.shareToken,/^[a-f0-9]{48}$/);assert.equal((await worker.fetch(new Request(`https://test.workers.dev?share=${made.shareToken}`),env)).status,200);
  const list=await(await request(env,{action:'share_list'},token)).json();assert.equal(list.shares.length,1);assert.equal(list.shares[0].addressId,'home');
  assert.equal((await request(env,{action:'share_revoke',id:list.shares[0].id},token)).status,200);
  assert.equal((await worker.fetch(new Request(`https://test.workers.dev?share=${made.shareToken}`),env)).status,404);
});

test('account deletion requires the password and removes sessions, shares and aliases',async()=>{
  const legacy=legacyAccount(oldHash),{env,values}=environment({anna:legacy,'uid:google-user':'anna'});
  const signedIn=await login(env,'anna',oldPassword),token=signedIn.data.sessionToken;
  const made=await(await request(env,{action:'generate_share',addressId:'home',days:30},token)).json();
  assert.equal((await request(env,{action:'delete_account',confirmation:'wrong',password:oldPassword},token)).status,400);
  assert.equal((await request(env,{action:'delete_account',confirmation:'anna',password:'wrong-pass'},token)).status,403);
  assert.equal((await request(env,{action:'delete_account',confirmation:'anna',password:oldPassword},token)).status,200);
  assert.notEqual((await get(env,token)).status,200);assert.equal(values.has('anna'),false);assert.equal(values.has('account-index:anna'),false);
  assert.equal(values.has('uid:google-user'),false);
  assert.equal((await worker.fetch(new Request(`https://test.workers.dev?share=${made.shareToken}`),env)).status,404);
});

test('administrator password reset uses the strong verifier and revokes every user session',async()=>{
  const legacy=legacyAccount(oldHash),{env,values}=environment({anna:legacy});
  const signedIn=await login(env,'anna',oldPassword),admin=await adminToken(env);
  const reset=await request(env,{action:'admin_reset_password',adminToken:admin,login:'anna',newPass:'AdminResetPass7'});assert.equal(reset.status,200);
  assert.notEqual((await get(env,signedIn.data.sessionToken)).status,200);
  assert.equal((await login(env,'anna',oldPassword)).response.status,403);assert.equal((await login(env,'anna','AdminResetPass7')).response.status,200);
  const stored=JSON.parse(values.get('anna'));assert.equal(stored.pass,undefined);assert.equal(stored.passHash,undefined);assert.equal(stored.credential.algorithm,'PBKDF2-SHA256');assert.deepEqual(stored.addresses,legacy.addresses);
  const details=await(await request(env,{action:'admin_user_data',adminToken:admin,login:'anna'})).json();assert.equal(details.data.hasPassword,true);assert.equal('credential' in details.data,false);
});
