// Isolated workerd/SQLite load rehearsal. No production credentials or external network.
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {legacyAccount} from '../tests/helpers.mjs';
import {sha256Hex} from '../password-auth.js';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/check/worker.js',compatibilityDate:'2024-01-01',kvNamespaces:['KV'],bindings:{ADMIN_PASS:'fictional-load-password'},durableObjects:{ACCOUNT_STORE:{className:'AccountStore',useSQLite:true}},log:new Log(LogLevel.NONE),outboundService:()=>new Response('Network disabled',{status:503})}));
try{
 const kv=await mf.getKVNamespace('KV'),objects=await mf.getDurableObjectNamespace('ACCOUNT_STORE'),hash=await sha256Hex('fictional-account-password');
 let records=0;const originals=new Map();
 for(let i=0;i<40;i++){const data=legacyAccount(hash),count=i===0?1000:200;data.addresses[0].records=Array.from({length:count},(_,n)=>({...data.addresses[0].records[0],id:n,month:n%2?'2026-10':'2026-09'}));records+=count;const login='load-'+String(i).padStart(3,'0');originals.set(login,data);await kv.put(login,JSON.stringify(data));}
 const post=async body=>{const response=await mf.dispatchFetch('https://test.invalid',{method:'POST',body:JSON.stringify(body)});return{response,data:await response.json()};};
 const {data:login}=await post({action:'admin_login',pass:'fictional-load-password'});assert.ok(login.token);
 const admin=body=>post({...body,adminToken:login.token});let prepared;do{prepared=(await admin({action:'admin_index_prepare'})).data;assert.equal(prepared.success,true);}while(!prepared.indexReady);
 const durations=[];
 for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:10},async()=>{const start=performance.now(),{response,data}=await admin({action:'admin_stats',paginated:true,limit:10});assert.equal(response.status,200);assert.equal(data.users.length,10);assert.equal(data.stats.totalUsers,40);assert.equal(data.stats.totalRecords,records);assert.equal(JSON.stringify(data.users).includes('tariffs'),false);durations.push(performance.now()-start);}));
 const stub=objects.get(objects.idFromName('load-000')),call=async body=>stub.fetch('https://account.internal',{method:'POST',body:JSON.stringify({login:'load-000',...body})});
 const value={...originals.get('load-000'),isPro:true};
 const writes=await Promise.all(Array.from({length:10},(_,i)=>call({action:'write',expectedRevision:1,value,mutationId:'load-write-'+i,fingerprint:'load-'+i})));
 assert.equal(writes.filter(r=>r.status===200).length,1);assert.equal(writes.filter(r=>r.status===409).length,9);
 const latest=await(await call({action:'read'})).json();assert.deepEqual(latest.value,value);assert.equal(latest.revision,2);
 const stats=(await admin({action:'admin_stats',paginated:true})).data;assert.equal(stats.stats.totalRecords,records);assert.equal(stats.stats.proUsers,1);
 durations.sort((a,b)=>a-b);console.log(JSON.stringify({verified:true,scope:'isolated workerd / SQLite, fictional data',accounts:40,records,parallelRequests:10,queries:100,concurrentWriters:10,acceptedWrites:1,conflicts:9,historyPreserved:true,localP50Ms:Math.round(durations[49]),localP95Ms:Math.round(durations[94]),timingScope:'local runtime only; not production performance'},null,2));
}finally{await mf.dispose();}
