import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function verifyBackup(data,{forMigration=false}={}){
  const fail=message=>{throw new Error(message);};
  if(!data||data.complete!==true||!Array.isArray(data.users)||!data.manifest)fail('Backup is incomplete or has no manifest');
  if(forMigration&&data.unrecognizedAccounts>0)fail('Unrecognized legacy accounts need a compatible reader before migration');
  if(forMigration&&data.readOnly!==true)fail('Migration requires an export taken while writes were paused');
  if(!Array.isArray(data.kvEntries))fail('Raw KV entries and account-link mappings are missing');
  const names=new Set();for(const entry of data.kvEntries){if(typeof entry.name!=='string'||typeof entry.value!=='string'||names.has(entry.name))fail('Invalid or duplicate KV entry');names.add(entry.name);}
  const logins=new Set();let addresses=0,records=0,chargedCents=0;
  for(const user of data.users){
    if(typeof user.login!=='string'||!user.login||logins.has(user.login)||!Array.isArray(user.addresses))fail('Invalid or duplicate account');logins.add(user.login);
    if(!names.has(user.login)&&!names.has(`account-index:${encodeURIComponent(user.login)}`))fail('Account is absent from the KV snapshot and index');
    const ids=new Set();for(const address of user.addresses){
      if(address.id==null||ids.has(String(address.id))||!Array.isArray(address.records))fail('Invalid or duplicate address');ids.add(String(address.id));addresses++;
      const recordIds=new Set();for(const record of address.records){
        if(record.id==null||recordIds.has(String(record.id))||!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month)||!Number.isFinite(Number(record.total)))fail('Invalid or duplicate record');recordIds.add(String(record.id));records++;chargedCents+=Math.round(Number(record.total)*100);
      }
    }
  }
  const result={accounts:logins.size,addresses,records,kvKeys:names.size};for(const [key,value] of Object.entries(result))if(data.manifest[key]!==value)fail(`Manifest count differs: ${key}`);
  if(forMigration&&!result.accounts)fail('Empty account export cannot be used for this migration');
  return {...result,chargedCents,readOnly:data.readOnly===true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const args=process.argv.slice(2),filename=args.find(arg=>!arg.startsWith('--'));if(!filename)throw new Error('Usage: npm run backup:verify -- /absolute/path/backup.json [--for-migration]');const raw=await readFile(filename);const result=verifyBackup(JSON.parse(raw),{forMigration:args.includes('--for-migration')});console.log(JSON.stringify({...result,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.byteLength},null,2));}
  catch(error){console.error('Backup verification failed: '+error.message);process.exitCode=1;}
}
