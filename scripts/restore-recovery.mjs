// Recovery rehearsal only: local SQLite Durable Objects, network disabled, no production writes.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import '../operational-backup.js';
import {verifyBackup} from './verify-backup.mjs';

export async function verifyRecovery(archive,{testPasswords={}}={}){
  await globalThis.KomunalkaBackup.verify(archive);verifyBackup(archive);
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/check/worker.js',compatibilityDate:'2024-01-01',kvNamespaces:['KV'],durableObjects:{ACCOUNT_STORE:{className:'AccountStore',useSQLite:true}},log:new Log(LogLevel.NONE),outboundService:()=>new Response('Network disabled',{status:503})}));
  try{
    const kv=await mf.getKVNamespace('KV'),objects=await mf.getDurableObjectNamespace('ACCOUNT_STORE');
    for(const entry of archive.kvEntries){if(entry.expiration&&entry.expiration*1000<=Date.now())continue;await kv.put(entry.name,entry.value,{...(entry.metadata?{metadata:entry.metadata}:{}),...(entry.expiration?{expiration:entry.expiration}:{})});}
    for(const snapshot of archive.authorities){
      const stub=objects.get(objects.idFromName(snapshot.login)),call=async body=>{const response=await stub.fetch('https://account.internal',{method:'POST',body:JSON.stringify({login:snapshot.login,...body})});assert.equal(response.status,200);return response.json();};
      await call({action:'restore-snapshot',snapshot});
      const result=await call({action:'read'});assert.deepEqual(result.value,snapshot.account.value);assert.equal(result.revision,snapshot.account.revision);
      assert.equal((await call({action:'session-list'})).sessions.length,0);
      const restored=(await call({action:'backup-snapshot'})).snapshot;
      for(const key of ['shares','push','telegram','revokedShares'])assert.deepEqual(restored[key],snapshot[key]||({shares:[],push:{subscriptions:[]},telegram:{},revokedShares:{}}[key]));
      if(testPasswords[snapshot.login]){
        const response=await mf.dispatchFetch('https://recovery.invalid',{method:'POST',body:JSON.stringify({action:'auth_login',login:snapshot.login,password:testPasswords[snapshot.login]})});
        assert.equal(response.status,200,'Restored fixture credentials cannot sign in');
        const signed=await response.json();assert.match(signed.sessionToken,/^s1\./);
        const read=await mf.dispatchFetch('https://recovery.invalid',{headers:{Authorization:`Bearer ${signed.sessionToken}`}});assert.equal(read.status,200);
      }
    }
    if(archive.community){const stub=objects.get(objects.idFromName('__community__'));const response=await stub.fetch('https://account.internal',{method:'POST',body:JSON.stringify({login:'__community__',action:'community-restore',snapshot:archive.community})});assert.equal(response.status,200);const restored=await(await stub.fetch('https://account.internal',{method:'POST',body:JSON.stringify({login:'__community__',action:'community-read'})})).json();assert.deepEqual(restored.list,archive.community.list);assert.equal(restored.revision,archive.community.revision);}
    return {verified:true,scope:'isolated local workerd / SQLite',accounts:archive.authorities.length,sessions:'revoked',...archive.manifest};
  }finally{await mf.dispose();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const filename=process.argv[2];if(!filename)throw new Error('Usage: npm run backup:restore-check -- /absolute/path/archive.json');
    let archive=JSON.parse(await readFile(filename,'utf8'));
    if(archive.format==='komunalka-encrypted-backup-v1'){
      const {createInterface}=await import('node:readline/promises');
      // Read via a TTY; do not pass the archive password in command arguments or environment.
      if(!process.stdin.isTTY)throw new Error('Encrypted archives require an interactive terminal');
      const rl=createInterface({input:process.stdin,output:process.stdout});
      const original=rl._writeToOutput;rl._writeToOutput=function(value){if(!this.masked)original.call(this,value);};
      const answer=rl.question('Пароль копії (введення приховано): ');rl.masked=true;const password=await answer;rl.close();process.stdout.write('\n');
      archive=await globalThis.KomunalkaBackup.unseal(archive,password);
    }
    console.log(JSON.stringify(await verifyRecovery(archive),null,2));
  }catch(error){console.error('Recovery verification failed: '+error.message);process.exitCode=1;}
}
