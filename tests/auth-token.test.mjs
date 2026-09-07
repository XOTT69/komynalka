import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {environment,legacyAccount} from './helpers.mjs';
import {verifyFirebaseToken} from '../auth-token.js';
test('Firebase tokens require a genuine signature, correct project and valid lifetime',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test-key'};const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async url=>{assert.equal(String(url),'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');requests++;return Response.json({keys:[jwk]});};
  const now=Math.floor(Date.now()/1000),claims={aud:'pwakomun',iss:'https://securetoken.google.com/pwakomun',sub:'real-user',iat:now,auth_time:now,exp:now+3600};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  async function sign(payload){const data=encode({alg:'RS256',kid:'test-key'})+'.'+encode(payload);return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))).toString('base64url');}
  try{const token=await sign(claims);assert.equal(await verifyFirebaseToken(token,'pwakomun'),'real-user');const {env}=environment({anna:legacyAccount('test-hash'),'google_real-user':'anna'});const response=await worker.fetch(new Request('https://test.workers.dev',{headers:{Authorization:'Bearer '+token}}),env);assert.equal(response.status,200);assert.equal((await response.json()).data.linkedLogin,'anna');const parts=token.split('.');parts[1]=encode({...claims,sub:'victim'});await assert.rejects(()=>verifyFirebaseToken(parts.join('.'),'pwakomun'));await assert.rejects(()=>verifyFirebaseToken(token,'another-project'));await assert.rejects(()=>verifyFirebaseToken(sign,'pwakomun'));await assert.rejects(()=>verifyFirebaseToken(token.replace(/^./,'x'),'pwakomun'));await assert.rejects(async()=>verifyFirebaseToken(await sign({...claims,exp:now-1}),'pwakomun'));assert.equal(requests,1);}finally{globalThis.fetch=original;}
});
