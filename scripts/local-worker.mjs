// In-memory Worker adapter for isolated development and tests. No production bindings.
import {AccountStore} from '../account-store.js';
export function environment(seed={}){
  const values=new Map(Object.entries(seed).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)]));
  const env={FIREBASE_PROJECT_ID:'pwakomun',ADMIN_PASS:'test-only-password',KV:{async get(k){return values.get(k)??null;},async put(k,v){values.set(k,v);},async delete(k){values.delete(k);},async list({limit=1000,cursor}={}){const keys=[...values.keys()].sort();const offset=Number(cursor||0);return{keys:keys.slice(offset,offset+limit).map(name=>({name})),list_complete:offset+limit>=keys.length,cursor:String(offset+limit)};}}};
  const instances=new Map(),stores=new Map();
  env.ACCOUNT_STORE={idFromName:login=>login,get(login){if(!instances.has(login)){const data=new Map();stores.set(login,data);let tail=Promise.resolve();const ctx={storage:{async get(k){return structuredClone(data.get(k));},async getAlarm(){return data.get('__alarm')||null;},async setAlarm(t){data.set('__alarm',t);},async deleteAlarm(){data.delete('__alarm');},async delete(k){data.delete(k);},async put(k,v){if(typeof k==='string')data.set(k,structuredClone(v));else for(const [key,value] of Object.entries(k))data.set(key,structuredClone(value));}},blockConcurrencyWhile(fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;}};instances.set(login,new AccountStore(ctx,env));}return instances.get(login);}};
  return {env,values,stores};
}
