// CI rehearsal uses fictional credentials/data and the real local Workers runtime.
import worker from '../worker.js';
import {environment} from './local-worker.mjs';
import {legacyAccount} from '../tests/helpers.mjs';
import {sha256Hex} from '../password-auth.js';
import '../operational-backup.js';
import {verifyRecovery} from './restore-recovery.mjs';
const password='test-recovery-password',hash=await sha256Hex(password),original=legacyAccount(hash);
const {env,values,stores}=environment({anna:original,bob:{...original,displayName:'Fictional account B'},'uid:test-only':'anna'});
const authorities=[];
for(const login of ['anna','bob']){
  const response=await worker.fetch(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({action:'auth_login',login,password})}),env);
  if(response.status!==200)throw new Error('Fixture initialization failed');
  const data=stores.get(login);data.set('telegram',{chatId:'test-only',lastDay:'2026-10-01',lastAttemptAt:1,lastStatus:200});
  data.set('push',{subscriptions:[]});data.set('shares',[{token:'test-only-share-token',tokenHash:await sha256Hex('test-only-share-token'),addressId:'home',createdAt:Date.now(),expiresAt:Date.now()+86400000}]);
  data.set('share-revoked:'+await sha256Hex('test-only-revoked-token'),{revokedAt:1});
  const snapshot=await(await env.ACCOUNT_STORE.get(login).fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({login,action:'backup-snapshot'})}))).json();authorities.push(snapshot.snapshot);
}
const archive=await KomunalkaBackup.create({authorities,kvEntries:[...values].map(([name,value])=>({name,value})),community:{list:[],revision:7},version:'fixture',readOnly:true});
const encrypted=await KomunalkaBackup.seal(archive,'test-encryption-password');
const restored=await KomunalkaBackup.unseal(encrypted,'test-encryption-password');
console.log(JSON.stringify(await verifyRecovery(restored,{testPasswords:{anna:password,bob:password}}),null,2));
