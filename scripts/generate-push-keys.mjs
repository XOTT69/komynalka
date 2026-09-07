import {createECDH} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const key=createECDH('prime256v1');key.generateKeys();
const file=new URL('../.env.push',import.meta.url);
try{await writeFile(file,`VAPID_PUBLIC_KEY=${key.getPublicKey().toString('base64url')}\nVAPID_PRIVATE_KEY=${key.getPrivateKey().toString('base64url')}\nVAPID_SUBJECT=https://komynalka.vercel.app\n`,{flag:'wx',mode:0o600});console.log('Створено .env.push з доступом лише власнику. Ключі не публікуються і не виводяться в журнал.');}catch(error){if(error.code==='EEXIST'){console.log('.env.push вже існує; чинні ключі залишено без змін.');}else throw error;}
