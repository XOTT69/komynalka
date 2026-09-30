import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {environment,legacyAccount} from './helpers.mjs';

const hash=createHash('sha256').update('test-password').digest('hex');
const auth=login=>`Bearer login:${Buffer.from(login).toString('base64')}:${hash}`;
const request=(login,body)=>new Request('https://test.workers.dev',{method:'POST',headers:{Authorization:auth(login),'Content-Type':'application/json'},body:JSON.stringify(body)});
const chat={action:'ai_chat',messages:[{role:'user',content:'Підсумуй витрати за місяць'}],max_tokens:80};

test('AI uses an active Groq model after the retired llama model',async()=>{
  const {env}=environment({anna:legacyAccount(hash)});env.GROQ_API_KEY='groq-test';
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:'Готово'}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
  try{
    const response=await worker.fetch(request('anna',chat),env);const data=await response.json();
    assert.equal(response.status,200);assert.equal(data.choices[0].message.content,'Готово');assert.equal(calls[0].model,'openai/gpt-oss-20b');
  }finally{globalThis.fetch=originalFetch;}
});

test('AI falls back to Gemini when Groq is unavailable and retries its model alias',async()=>{
  const {env}=environment({anna:legacyAccount(hash)});Object.assign(env,{GROQ_API_KEY:'groq-test',GEMINI_API_KEY:'gemini-test'});
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),body:JSON.parse(options.body)});
    if(String(url).includes('groq'))return new Response('model retired',{status:404});
    if(calls.at(-1).body.model==='gemini-3.8-flash')return new Response('model unavailable',{status:404});
    return new Response(JSON.stringify({choices:[{message:{content:'Відповідь Gemini'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const response=await worker.fetch(request('anna',chat),env);const data=await response.json();
    assert.equal(response.status,200);assert.equal(data._fallback,'gemini');assert.equal(data.choices[0].message.content,'Відповідь Gemini');
    assert.deepEqual(calls.map(call=>call.body.model),['openai/gpt-oss-20b','gemini-3.8-flash','gemini-2.5-flash']);
  }finally{globalThis.fetch=originalFetch;}
});

test('AI reports missing configuration without leaking provider credentials',async()=>{
  const {env}=environment({anna:legacyAccount(hash)});
  const response=await worker.fetch(request('anna',chat),env);const data=await response.json();
  assert.equal(response.status,502);assert.equal(data.error,'AI_NOT_CONFIGURED');assert.equal(JSON.stringify(data).includes('test'),false);
});
