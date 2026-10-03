import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=await readFile(new URL('../ai-chat.js',import.meta.url),'utf8');

test('legacy AI history is migrated once and never copied into a second account',()=>{
  const dom=new JSDOM('<!doctype html><body><div id="aiMessagesList"></div><button id="aiFabBtn"></button><button id="aiCloseBtn"></button><button id="aiClearBtn"></button><div id="aiChatPanel" class="hidden"><div id="aiPanelInner"></div></div><button id="aiSendBtn"></button><textarea id="aiInput"></textarea></body>',{url:'https://komynalka.vercel.app/',runScripts:'outside-only'});
  const {window}=dom;window.requestAnimationFrame=callback=>callback();window.sessionLogin='anna';window.localStorage.setItem('k_login','anna');window.localStorage.setItem('k_ai_history',JSON.stringify([{role:'user',content:'Стара історія'}]));window.eval(source);window.initAI();
  assert.equal(window.komunalkaAI.history.length,1);assert.equal(window.localStorage.getItem('k_ai_history_migrated_v2'),'anna');
  window.sessionLogin='bob';window.localStorage.setItem('k_login','bob');window.komunalkaAI.open();
  assert.equal(window.komunalkaAI.history.length,0);assert.equal(window.localStorage.getItem('k_ai_history_v2:anna').includes('Стара історія'),true);assert.equal(window.localStorage.getItem('k_ai_history_v2:bob'),null);dom.window.close();
});

test('AI system prompt allows general questions while retaining utility context',()=>{
  assert.match(source,/універсальний AI-помічник/);
  assert.match(source,/на будь-які запитання/);
  assert.match(source,/Для питань про комуналку використовуй наведені нижче дані/);
  assert.doesNotMatch(source,/Якщо питання не про комуналку — поверни до теми/);
});

function chatPage(){
  const dom=new JSDOM('<body><div id="aiMessagesList"></div><button id="aiFabBtn"></button><button id="aiCloseBtn"></button><button id="aiClearBtn"></button><div id="aiChatPanel" class="hidden"><div id="aiPanelInner"></div></div><button id="aiSendBtn"></button><textarea id="aiInput"></textarea><input type="checkbox" id="aiUseContext"><button id="aiCancelBtn"></button><button id="aiRetryBtn"></button></body>',{url:'https://komynalka.vercel.app',runScripts:'outside-only'});
  const w=dom.window;w.requestAnimationFrame=fn=>fn();w.sessionLogin='anna';w.localStorage.setItem('k_login','anna');w.eval(source);w.initAI();return {w,ai:w.komunalkaAI,close:()=>w.close()};
}
test('late AI responses never cross owners or restore a cleared conversation',async()=>{
  for(const mode of ['switch','clear']){const p=chatPage();try{let resolve;p.w.secureFetch=()=>new Promise(r=>resolve=r);const request=p.ai.sendMessage('Приватне питання A');if(mode==='switch'){p.w.sessionLogin='bob';p.ai._refreshOwner();}else p.ai.clearHistory();resolve({ok:true,status:200,json:async()=>({success:true,choices:[{message:{content:'Приватна відповідь A'}}]})});await request;assert.equal(p.ai.history.length,0);assert.equal(p.w.localStorage.getItem('k_ai_history_v2:bob'),null);assert.equal(p.ai.isLoading,false);}finally{p.close();}}
});
test('stored history outlives API context and general questions exclude utility data',async()=>{
  const p=chatPage();try{let payload;p.w.secureFetch=async(_method,_headers,body)=>{payload=body;return {ok:true,status:200,json:async()=>({success:true,choices:[{message:{content:'Готово'}}]})};};p.w.records=[{month:'2026-10',total:12345,paidAmount:10}];p.w.addresses=[{id:'home',name:'PRIVATE_ADDRESS',tariffs:{water:0}}];p.w.currentAddressId='home';for(let i=0;i<12;i++)await p.ai.sendMessage('Запит '+i);assert.equal(p.ai.history.length,24);assert.equal(JSON.parse(p.w.localStorage.getItem('k_ai_history_v2:anna')).length,24);assert.ok(payload.messages.length<=11);assert.doesNotMatch(payload.messages[0].content,/PRIVATE_ADDRESS|12345/);p.w.localStorage.setItem('k_ai_context_v1:anna','yes');p.w.localStorage.setItem('k_ai_consent_v1:anna','yes');p.w.getOutstandingAmount=()=>12335;const context=p.ai._buildSystemPrompt();assert.match(context,/PRIVATE_ADDRESS/);assert.match(context,/"water":0/);assert.match(context,/12\s?335,00/);}finally{p.close();}
});
test('declined AI consent and network failures retain the typed question',async()=>{
  const p=chatPage();try{p.w.localStorage.setItem('k_ai_context_v1:anna','yes');p.w.confirm=()=>false;p.w.document.getElementById('aiInput').value='Моє питання';await p.ai._handleSend();assert.equal(p.w.document.getElementById('aiInput').value,'Моє питання');p.w.localStorage.setItem('k_ai_context_v1:anna','no');p.w.secureFetch=async()=>{throw new Error('Network offline');};await p.ai._handleSend();assert.equal(p.w.document.getElementById('aiInput').value,'Моє питання');assert.equal(p.ai.isLoading,false);}finally{p.close();}
});
