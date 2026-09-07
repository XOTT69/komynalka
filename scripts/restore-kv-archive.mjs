// Restore a private raw KV archive into an isolated local Workers runtime.
// No remote bindings, network requests, or production writes are used.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
const filename=process.argv[2];
if(!filename)throw new Error('Pass a private kv-raw.json archive');
const bytes=await readFile(filename),archive=JSON.parse(bytes);
assert.equal(archive.format,'cloudflare-kv-raw-v1');assert.equal(archive.complete,true);
const names=new Set(),accounts=[];
for(const e of archive.entries){
 assert.equal(names.has(e.name),false);names.add(e.name);
 const raw=Buffer.from(e.valueBase64,'base64');assert.equal(raw.length,e.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),e.sha256);
 try{const value=JSON.parse(raw);if(value&&Array.isArray(value.addresses))accounts.push({name:e.name,value});}catch{}
}
assert.ok(accounts.length>0);
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/check/worker.js',compatibilityDate:'2024-01-01',kvNamespaces:['KV'],durableObjects:{ACCOUNT_STORE:{className:'AccountStore',useSQLite:true}},log:new Log(LogLevel.NONE),outboundService:()=>new Response('Network disabled',{status:503})}));
try{
 const kv=await mf.getKVNamespace('KV'),objects=await mf.getDurableObjectNamespace('ACCOUNT_STORE');
 for(const e of archive.entries)await kv.put(e.name,Buffer.from(e.valueBase64,'base64'),e.metadata?{metadata:e.metadata}:{});
 let addresses=0,records=0,chargedCents=0;
 for(const {name,value} of accounts){
  const stub=objects.get(objects.idFromName(name));
  const call=async body=>{const r=await stub.fetch('https://account.internal',{method:'POST',body:JSON.stringify({login:name,...body})});assert.equal(r.status,200);return r.json();};
  const restored=await call({action:'read'});assert.deepEqual(restored.value,value);assert.equal(restored.revision,1);
  const mutation={action:'write',value,expectedRevision:1,mutationId:'restore-verification',fingerprint:'unchanged-snapshot'};
  const saved=await call(mutation);assert.equal(saved.revision,2);assert.equal((await call(mutation)).revision,2);
  assert.deepEqual((await call({action:'read'})).value,value);
  addresses+=value.addresses.length;
  for(const address of value.addresses)for(const record of address.records||[]){records++;assert.ok(Number.isFinite(Number(record.total)));chargedCents+=Math.round(Number(record.total)*100);}
 }
 // All mappings, opaque values and other metadata stay byte-identical.
 const migrated=new Set(accounts.map(a=>a.name));
 for(const e of archive.entries)if(!migrated.has(e.name))assert.deepEqual(Buffer.from(await kv.get(e.name,'arrayBuffer')),Buffer.from(e.valueBase64,'base64'));
 const result={verified:true,sha256:createHash('sha256').update(bytes).digest('hex'),kvKeys:names.size,accounts:accounts.length,addresses,records,chargedCents,otherValuesPreserved:names.size-accounts.length,scope:'isolated local workerd with SQLite Durable Objects; import, write, retry and re-read'};
 await writeFile(filename+'.verification.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result,null,2));
}finally{await mf.dispose();}
