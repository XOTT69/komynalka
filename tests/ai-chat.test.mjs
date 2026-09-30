import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=await readFile(new URL('../ai-chat.js',import.meta.url),'utf8');

test('legacy AI history is migrated once and never copied into a second account',()=>{
  const dom=new JSDOM('<!doctype html><body><div id="aiMessagesList"></div><button id="aiFabBtn"></button><button id="aiCloseBtn"></button><button id="aiClearBtn"></button><div id="aiChatPanel" class="hidden"><div id="aiPanelInner"></div></div><button id="aiSendBtn"></button><textarea id="aiInput"></textarea></body>',{url:'https://komynalka.vercel.app/',runScripts:'outside-only'});
  const {window}=dom;window.requestAnimationFrame=callback=>callback();window.sessionLogin='anna';window.localStorage.setItem('k_login','anna');window.localStorage.setItem('k_ai_history',JSON.stringify([{role:'user',content:'Стара історія'}]));window.eval(source);window.initAI();
  assert.equal(window.komunalkaAI.history.length,1);assert.equal(window.localStorage.getItem('k_ai_history_migrated_v2'),'1');
  window.sessionLogin='bob';window.localStorage.setItem('k_login','bob');window.komunalkaAI.open();
  assert.equal(window.komunalkaAI.history.length,0);assert.equal(window.localStorage.getItem('k_ai_history_v2:anna').includes('Стара історія'),true);assert.equal(window.localStorage.getItem('k_ai_history_v2:bob'),null);dom.window.close();
});

test('AI system prompt allows general questions while retaining utility context',()=>{
  assert.match(source,/універсальний AI-помічник/);
  assert.match(source,/на будь-які запитання/);
  assert.match(source,/Для питань про комуналку використовуй наведені нижче дані/);
  assert.doesNotMatch(source,/Якщо питання не про комуналку — поверни до теми/);
});
