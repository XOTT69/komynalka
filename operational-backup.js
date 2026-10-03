/* Canonical recovery archive. Sessions are deliberately excluded and revoked on restore. */
(function(global){
  'use strict';
  const encoder=new TextEncoder(),hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value)))));
  const b64=bytes=>{let value='';for(const n of bytes)value+=String.fromCharCode(n);return btoa(value);};
  const bytes=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  async function seal(archive,password){
    if(String(password).length<12)throw new Error('Пароль резервної копії: щонайменше 12 символів');
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=310000;
    const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(archive)));
    return {format:'komunalka-encrypted-backup-v1',algorithm:'AES-256-GCM',iterations,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
  }
  async function unseal(envelope,password){
    if(envelope.format!=='komunalka-encrypted-backup-v1'||envelope.algorithm!=='AES-256-GCM'||envelope.iterations!==310000)throw new Error('Unsupported encrypted archive');
    const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(envelope.salt),iterations:envelope.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},key,bytes(envelope.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
  async function create({authorities,kvEntries,community,version,readOnly,unrecognizedAccounts=0}){
    const users=authorities.filter(item=>!item.account.deleted).map(item=>{const {pass,passHash,credential,...safe}=item.account.value;return {...safe,login:item.login,addresses:safe.addresses?.length?safe.addresses:(safe.records||safe.tariffs?[{id:'default',name:'Мій дім',records:safe.records||[],tariffs:safe.tariffs||{},prefs:safe.prefs||{},customServices:safe.customServices||[]}]:[])};});
    const addresses=users.flatMap(user=>user.addresses||[]),records=addresses.flatMap(address=>address.records||[]);
    const archive={format:'komunalka-recovery-v2',version,exportDate:new Date().toISOString(),complete:true,readOnly,unrecognizedAccounts,sessionPolicy:'revoke-all',authorities,kvEntries,community,users,manifest:{accounts:users.length,addresses:addresses.length,records:records.length,kvKeys:kvEntries.length}};
    return {...archive,checksum:await digest(archive)};
  }
  async function verify(archive){
    const {checksum,...payload}=archive;
    if(archive.format!=='komunalka-recovery-v2'||archive.complete!==true||archive.sessionPolicy!=='revoke-all'||!Array.isArray(archive.authorities)||!Array.isArray(archive.kvEntries)||await digest(payload)!==checksum)throw new Error('Invalid recovery archive or checksum');
    const owners=new Set();for(const snapshot of archive.authorities){if(!snapshot.login||owners.has(snapshot.login)||snapshot.account?.login!==snapshot.login||!Number.isInteger(snapshot.account.revision)||snapshot.account.deleted||!(Array.isArray(snapshot.account.value?.addresses)||Array.isArray(snapshot.account.value?.records)))throw new Error('Invalid authority snapshot');owners.add(snapshot.login);}
    if(owners.size!==archive.manifest.accounts)throw new Error('Authority count differs');
    return archive;
  }
  global.KomunalkaBackup=Object.freeze({create,verify,seal,unseal});
})(typeof window!=='undefined'?window:globalThis);
