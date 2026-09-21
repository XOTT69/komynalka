import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import worker from '../worker.js';
import {environment,legacyAccount} from './helpers.mjs';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const sources=await Promise.all(['sync-queue.js','data-store.js','reminders.js','monthly-tasks.js','providers.js','pwa-updates.js','push-client.js','app.js'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
const password='test-password',hash=createHash('sha256').update(password).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function page(env,stored={},offline=false,suffix=""){
  const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e.message);});
  const dom=new JSDOM(html,{url:'https://komynalka.vercel.app'+suffix,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;
  w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;Object.defineProperty(w,'crypto',{value:webcrypto});Object.defineProperty(w.navigator,'onLine',{value:!offline,configurable:true});
  w.matchMedia=()=>({matches:false,addEventListener(){}});w.IntersectionObserver=class{observe(){}disconnect(){}};
  w.confirm=()=>true;w.prompt=()=>null;w.HTMLElement.prototype.scrollTo=()=>{};
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get(target,key){return key in target?target[key]:(()=>{});},set(target,key,value){target[key]=value;return true;}});
  Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.closest('.hidden')||this.style.display==='none'?null:w.document.body;}});
  w.requestAnimationFrame=cb=>w.setTimeout(()=>cb(w.performance.now()+500),0);
  w.initAI=()=>{};
  const auth={currentUser:null,onAuthStateChanged(cb){w.setTimeout(()=>cb(null),0);return()=>{};},signOut:async()=>{}};
  w.firebase={initializeApp(){},auth:()=>auth};w.firebase.auth.GoogleAuthProvider=class{};
  w.fetch=async(url,options={})=>{if(offline)throw new Error('offline');return worker.fetch(new Request(url,options),env);};
  for(const [key,value] of Object.entries(stored))w.localStorage.setItem(key,value);
  for(const source of sources)w.eval(source);
  await delay(30);
  return {w,errors,close:()=>dom.window.close(),storage:()=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const key=w.localStorage.key(i);return[key,w.localStorage.getItem(key)];}))};
}
test('actual app login preserves history, account totals and additional legacy fields',async()=>{const legacy=legacyAccount(hash),{env}=environment({anna:legacy});const p=await page(env);try{await p.w.performLogin('anna',password,false);await delay(30);assert.equal(p.w.document.getElementById('appScreen').classList.contains('hidden'),false,p.w.document.getElementById('authError').textContent);const data=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:anna'));assert.equal(data.local.addresses[0].records[0].total,151.9);assert.equal(data.local.addresses[0].records[0].paidAmount,50);assert.equal(data.local.addresses[0].records[0].customField,'preserve');assert.deepEqual(p.errors,[]);}finally{p.close();}});
test('the account shows the admin shortcut only after server approval for xott69',async()=>{
 const {env}=environment({xott69:legacyAccount(hash),anna:legacyAccount(hash)});env.ADMIN_OWNER_LOGIN='xott69';
 const owner=await page(env),other=await page(env);
 try{
  await owner.w.performLogin('xott69',password,false);await delay(30);
  const ownerLink=owner.w.document.getElementById('adminPanelLink');
  assert.equal(ownerLink.closest('#settings-account')!==null,true);
  assert.equal(ownerLink.classList.contains('hidden'),false);
  assert.equal(ownerLink.getAttribute('href'),'./admin.html');
  await other.w.performLogin('anna',password,false);await delay(30);
  assert.equal(other.w.document.getElementById('adminPanelLink').classList.contains('hidden'),true);
  assert.deepEqual(owner.errors,[]);assert.deepEqual(other.errors,[]);
 }finally{owner.close();other.close();}
});
test('Google popup failures show actionable inline recovery without changing stored accounts',async()=>{
 const {env}=environment({anna:legacyAccount(hash)}),p=await page(env);
 try{
  const d=p.w.document,button=d.getElementById('googleAuthBtn'),auth=p.w.firebase.auth();
  auth.signInWithPopup=async()=>{throw {code:'auth/popup-blocked'};};button.click();await delay(10);
  assert.match(d.getElementById('authError').textContent,/заблокував вікно Google/);assert.equal(d.getElementById('googleAuthHelp').classList.contains('hidden'),false);assert.equal(button.disabled,false);
  auth.signInWithPopup=async()=>{throw {code:'auth/popup-closed-by-user'};};button.click();await delay(10);assert.match(d.getElementById('authError').textContent,/не завершено/);
  assert.equal(p.w.localStorage.getItem('komynalka_account_v1:anna'),null);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});
test('editing only the historical note does not apply the new tariff or alter partial payment',async()=>{const {env}=environment({anna:legacyAccount(hash)});const p=await page(env);try{await p.w.performLogin('anna',password,false);p.w.editRecordById(42);await delay(200);const note=p.w.document.getElementById('recordNote');note.value='Лише нова нотатка';note.dispatchEvent(new p.w.Event('input',{bubbles:true}));p.w.calculatePreview();p.w.document.getElementById('utilityForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await delay(120);const saved=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:anna')).local.addresses[0].records[0];assert.equal(saved.note,'Лише нова нотатка');assert.equal(saved.total,151.9);assert.equal(saved.waterCost,151.9);assert.equal(saved.paidAmount,50);assert.equal(saved.tariffSnapshot.water,30.38);assert.equal(saved.customField,'preserve');assert.deepEqual(p.errors,[]);}finally{p.close();}});
test('draft including zero, note and partial payment survives closing and offline reopening',async()=>{const {env}=environment({anna:legacyAccount(hash)});const p=await page(env);let stored;try{await p.w.performLogin('anna',password,false);const month=p.w.document.getElementById('monthInput');month.value='2026-09';month.dispatchEvent(new p.w.Event('change',{bubbles:true}));for(const [id,value] of [['wPrev','0'],['wCur','0'],['recordNote','Незавершене введення'],['paymentStatusInput','partial'],['paidAmountInput','12']]){const field=p.w.document.getElementById(id);field.value=value;field.dispatchEvent(new p.w.Event('input',{bubbles:true}));}stored=p.storage();assert.deepEqual(p.errors,[]);}finally{p.close();}const reopened=await page(env,stored,true);try{const month=reopened.w.document.getElementById('monthInput');month.value='2026-09';month.dispatchEvent(new reopened.w.Event('change',{bubbles:true}));assert.equal(reopened.w.document.getElementById('wCur').value,'0');assert.equal(reopened.w.document.getElementById('recordNote').value,'Незавершене введення');assert.equal(reopened.w.document.getElementById('paymentStatusInput').value,'partial');assert.equal(reopened.w.document.getElementById('paidAmountInput').value,'12');assert.equal(reopened.w.document.getElementById('appScreen').classList.contains('hidden'),false);assert.deepEqual(reopened.errors,[]);}finally{reopened.close();}});
test('account B never adopts a global legacy backup from A, and failed login creates no account',async()=>{const legacy=legacyAccount(hash),raw=JSON.stringify({addresses:legacy.addresses,currentAddressId:'home'});const {env,values}=environment({bob:{...legacy,addresses:[{...legacy.addresses[0],records:[]}]}});const p=await page(env,{komynalka_backup:raw});try{await p.w.performLogin('bob',password,false);const data=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:bob'));assert.equal(data.local.addresses[0].records.length,0);assert.equal(p.w.localStorage.getItem('komynalka_backup'),raw);p.w.fetch=async()=>new Response(JSON.stringify({success:false}),{status:500});await p.w.performLogin('newaccount',password,false);assert.equal(values.has('newaccount'),false);assert.equal(p.w.localStorage.getItem('komynalka_account_v1:newaccount'),null);}finally{p.close();}});
test('all original feature controls are retained and IDs are unique',async()=>{const {execFileSync}=await import('node:child_process');const original=execFileSync('git',['show','47df7f8e8215ad9acdc982377e0e5725600c07ee:index.html'],{encoding:'utf8'});const old=new JSDOM(original),now=new JSDOM(html);const ids=[...now.window.document.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length,'Duplicate DOM IDs');for(const el of old.window.document.querySelectorAll('button[id],input[id],select[id],textarea[id],canvas[id]'))assert.ok(now.window.document.getElementById(el.id),`Existing feature control removed: ${el.id}`);old.window.close();now.window.close();});

test('rapid navigation leaves one active page and every analytics entry renders extended tools',async()=>{
  const {env}=environment({anna:legacyAccount(hash)});const p=await page(env);
  try{await p.w.performLogin('anna',password,false);for(const id of ['btnTabHistory','btnTabCalc','moreAnalyticsBtn'])p.w.document.getElementById(id).click();await delay(200);assert.equal(p.w.document.querySelectorAll('.tab-active').length,1);assert.equal(p.w.document.querySelector('.tab-active').id,'tabAnalytics');assert.match(p.w.document.getElementById('tabAnalytics').textContent,/Субсид|субсид/);p.w.document.getElementById('overviewDetails').open=true;p.w.document.getElementById('historyDetails').open=true;await delay(40);assert.deepEqual(p.errors,[]);}finally{p.close();}
});
test('historical disabled services remain visible and imported IDs are safe in keyboard-accessible cards',async()=>{
  const legacy=legacyAccount(hash);legacy.addresses[0].prefs.showWater=false;const {env}=environment({anna:legacy});const p=await page(env);
  try{await p.w.performLogin('anna',password,false);const rec={...legacy.addresses[0].records[0],id:'x" onclick="alert(1)'};const card=p.w.createRecordCard(rec);assert.match(card.textContent,/Вода/);assert.equal(card.querySelector('[onclick]'),null);const toggle=card.querySelector('[data-toggle-details]');assert.equal(toggle.getAttribute('role'),'button');toggle.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.deepEqual(p.errors,[]);}finally{p.close();}
});
test('PWA reading shortcut opens entry and the data center reports sync and backup health',async()=>{
  const legacy=legacyAccount(hash),{env}=environment({anna:legacy}),p=await page(env,{},false,'/#calc');
  try{await p.w.performLogin('anna',password,false);await delay(30);const d=p.w.document;assert.equal(d.querySelector('.tab-active').id,'tabCalc');p.w.switchTab('tabSettings',4);p.w.openSettingsPanel('data');assert.match(d.getElementById('dataHealthSummary').textContent,/синхронізовані/i);assert.notEqual(d.getElementById('dataLastSync').textContent,'Ще не синхронізовано');let backup='';p.w.downloadBlob=value=>{backup=value;};d.getElementById('exportJsonBtn').click();assert.match(backup,/"addresses"/);assert.notEqual(d.getElementById('dataLastExport').textContent,'Ще не створено');assert.deepEqual(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.addresses[0].records,legacy.addresses[0].records);assert.deepEqual(p.errors,[]);}finally{p.close();}
});
test('CSV and real PDF libraries retain cents, historical services and partial payments',async()=>{
  const legacy=legacyAccount(hash);legacy.addresses[0].prefs.showWater=false;const {env}=environment({anna:legacy});const p=await page(env);
  try{await p.w.performLogin('anna',password,false);let csv='';p.w.downloadBlob=text=>{csv=text;};p.w.exportCSV();assert.match(csv,/Вода/);assert.match(csv,/151\.90,50\.00,101\.90/);assert.equal(p.w.csvCell('=1+1'),"'=1+1");
    for(const file of ['jspdf.umd.min.js','jspdf.plugin.autotable.min.js'])p.w.eval(await readFile(new URL('../vendor/jspdf/'+file,import.meta.url),'utf8'));
    const font=await readFile(new URL('../vendor/fonts/Roboto-Regular.ttf',import.meta.url));p.w.fetch=async()=>new Response(font);
    const Original=p.w.jspdf.jsPDF;let document,filename;p.w.jspdf.jsPDF=function(options){document=new Original(options);document.save=name=>{filename=name;};return document;};
    await p.w.generatePDF();assert.match(filename,/\.pdf$/);assert.ok(document.output('arraybuffer').byteLength>10000);assert.equal(document.lastAutoTable.body[0].raw[1],'151.90');assert.ok(document.lastAutoTable.body[0].raw.includes('101.90'));assert.deepEqual(p.errors,[]);
  }finally{p.close();}
});
test('legacy device preferences are scoped once and actually reach cloud storage',async()=>{
  const {env,values}=environment({anna:legacyAccount(hash)});const p=await page(env,{k_login:'anna',k_budget:'2300'});
  try{await p.w.performLogin('anna',password,false);await delay(30);const state=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:anna'));assert.equal(state.local.accountSettings.k_budget,'2300');assert.equal(JSON.parse(values.get('anna')).accountSettings.k_budget,'2300');assert.equal(p.w.localStorage.getItem('k_budget'),'2300');assert.deepEqual(p.errors,[]);}finally{p.close();}
});

test('editing a note after disabling an old service preserves its charge and partial payment',async()=>{
  const legacy=legacyAccount(hash);legacy.addresses[0].prefs.showWater=false;const {env}=environment({anna:legacy});const p=await page(env);
  try{await p.w.performLogin('anna',password,false);p.w.editRecordById(42);const note=p.w.document.getElementById('recordNote');note.value='Не змінювати оплату';note.dispatchEvent(new p.w.Event('input',{bubbles:true}));p.w.calculatePreview();p.w.document.getElementById('utilityForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await delay(80);const saved=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:anna')).local.addresses[0].records[0];assert.equal(saved.note,'Не змінювати оплату');assert.equal(saved.total,151.9);assert.equal(saved.paidAmount,50);assert.equal(saved.wCur,129);assert.deepEqual(p.errors,[]);}finally{p.close();}
});

test('explicit zero readings save correctly and a fast submit recalculates the latest input',async()=>{
  const {env}=environment({anna:legacyAccount(hash)});const p=await page(env);
  try{await p.w.performLogin('anna',password,false);const d=p.w.document,month=d.getElementById('monthInput');month.value='2026-10';month.dispatchEvent(new p.w.Event('change',{bubbles:true}));for(const [id,value] of [['wPrev','0'],['wCur','0']]){d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new p.w.Event('input',{bubbles:true}));}d.getElementById('utilityForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await delay(50);let data=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:anna')).local;assert.equal(data.addresses[0].records.find(r=>r.month==='2026-10').total,0);month.value='2026-11';month.dispatchEvent(new p.w.Event('change',{bubbles:true}));d.getElementById('wCur').value='2';d.getElementById('wCur').dispatchEvent(new p.w.Event('input',{bubbles:true}));d.getElementById('utilityForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await delay(50);data=JSON.parse(p.w.localStorage.getItem('komynalka_account_v1:anna')).local;assert.equal(data.addresses[0].records.find(r=>r.month==='2026-11').total,198);assert.deepEqual(p.errors,[]);}finally{p.close();}
});

test('a shared address loads its history while the guest form stays read-only',async()=>{
  const token='f'.repeat(40),legacy=legacyAccount(hash);const {env,values}=environment({anna:legacy,[`share:${token}`]:{login:'anna',addressId:'home'}});const p=await page(env,{},false,'/?share='+token);
  try{await delay(50);const d=p.w.document;assert.equal(d.getElementById('appScreen').classList.contains('hidden'),false);p.w.switchTab('tabHistory',2);assert.match(d.getElementById('recordsList').textContent,/151/);p.w.switchTab('tabCalc',1);p.w.calculatePreview();assert.equal(d.getElementById('submitFormBtn').disabled,true);d.getElementById('utilityForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));assert.deepEqual(JSON.parse(values.get('anna')),legacy);assert.equal(p.w.localStorage.getItem('komynalka_account_v1:anna'),null);assert.deepEqual(p.errors,[]);}finally{p.close();}
});

test('reminder date edits and deletion persist without resurrecting defaults or changing history',async()=>{
  const legacy=legacyAccount(hash),{env}=environment({anna:legacy});const p=await page(env);let stored;
  try{
    await p.w.performLogin('anna',password,false);p.w.renderCustomReminders();
    const card=()=>p.w.document.querySelector('[data-rem-id="water"]');
    const start=card().querySelector('[data-rem-field="startDay"]');start.value='28';start.dispatchEvent(new p.w.Event('change',{bubbles:true}));
    const end=card().querySelector('[data-rem-field="endDay"]');end.value='3';end.dispatchEvent(new p.w.Event('change',{bubbles:true}));
    p.w.renderCustomReminders();assert.equal(card().querySelector('[data-rem-field="startDay"]').value,'28');assert.equal(card().querySelector('[data-rem-field="endDay"]').value,'3');
    card().querySelector('.rem-del').click();assert.equal(card(),null);
    p.w.document.getElementById('addCustomReminderBtn').click();assert.equal(card(),null);
    const custom=p.w.document.querySelector('[data-rem-id^="rem_"]');assert.ok(custom);custom.querySelector('.rem-del').click();assert.equal(p.w.document.querySelector('[data-rem-id^="rem_"]'),null);
    await p.w.syncToCloud();stored=p.storage();
    const snapshot=JSON.parse(stored['komynalka_account_v1:anna']);assert.deepEqual(snapshot.local.addresses[0].records,legacy.addresses[0].records);assert.deepEqual(p.errors,[]);
  }finally{p.close();}
  const reopened=await page(env,stored,true);
  try{reopened.w.renderCustomReminders();assert.equal(reopened.w.document.querySelector('[data-rem-id="water"]'),null);assert.equal(reopened.w.document.querySelector('[data-rem-id^="rem_"]'),null);}finally{reopened.close();}
});

test('monthly tasks separate saved readings, provider completion and partial payment',async()=>{
 const legacy=legacyAccount(hash);const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'}).slice(0,7);
 const rec=legacy.addresses[0].records[0];rec.month=month;rec._filled={water:true,electro:false};legacy.addresses[0].prefs={...legacy.addresses[0].prefs,remindersEnabled:true,remWaterStart:1,remWaterEnd:31,showWater:true,showGas:false,showElectro:true};
 const {env}=environment({anna:legacy}),p=await page(env);
 try{await p.w.performLogin('anna',password,false);p.w.renderMonthlyTasks();const d=p.w.document;
 assert.match(d.querySelector('[data-month-task="readings"]').textContent,/1 з 2/);assert.match(d.querySelector('[data-month-task="payment"]').textContent,/101[,.]90/);
 const done=d.querySelector('[data-transfer-index="0"]');done.click();assert.match(d.querySelector('[data-month-task="transfer"]').textContent,/1 з/);
 assert.deepEqual(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.addresses[0].records,legacy.addresses[0].records);
 d.querySelector('[data-month-action="payment"]').click();assert.equal(d.getElementById('monthInput').value,month);assert.equal(d.getElementById('dCur').value,'');assert.match(d.getElementById('entryReviewBalance').textContent,/101[,.]90/);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('settings groups retain unsaved fields and every route returns to its menu',async()=>{
 const {env}=environment({anna:legacyAccount(hash)}),p=await page(env);
 try{await p.w.performLogin('anna',password,false);const d=p.w.document;p.w.switchTab('tabSettings',4);
 for(const button of d.querySelectorAll('[data-settings-open]')){button.click();const panel=d.getElementById('settings-'+button.dataset.settingsOpen);assert.equal(panel.classList.contains('hidden'),false);assert.equal(d.getElementById('settingsMenu').classList.contains('hidden'),true);panel.querySelector('[data-settings-back]').click();assert.equal(d.getElementById('settingsMenu').classList.contains('hidden'),false);}
 p.w.openSettingsPanel('home');d.getElementById('tWater').value='42.75';d.querySelector('#settings-home [data-settings-back]').click();p.w.openSettingsPanel('home');assert.equal(d.getElementById('tWater').value,'42.75');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});
test('horizontal swipes expose record actions without deleting or changing partial payment',async()=>{
 const legacy=legacyAccount(hash),{env}=environment({anna:legacy}),p=await page(env);
 try{await p.w.performLogin('anna',password,false);p.w.switchTab('tabHistory',2);const d=p.w.document,card=d.querySelector('.swipe-card');
 const touch=(type,x,y)=>{const e=new p.w.Event(type,{bubbles:true,cancelable:true});e.touches=[{clientX:x,clientY:y,screenX:x,screenY:y}];e.changedTouches=e.touches;card.dispatchEvent(e);};
 for(const end of [10,290]){touch('touchstart',150,100);touch('touchmove',end,103);touch('touchend',end,103);assert.equal(card.querySelector('.details-panel').classList.contains('hidden'),false);assert.ok(d.getElementById('tabHistory').classList.contains('tab-active'));}
 await p.w.syncToCloud();let data=JSON.parse(p.storage()['komynalka_account_v1:anna']).local;assert.deepEqual(data.addresses[0].records,legacy.addresses[0].records);
 card.querySelector('.rec-del').click();assert.ok(d.getElementById('recordActionDialog').hasAttribute('open'));d.getElementById('recordActionCancel').click();assert.equal(d.querySelectorAll('.swipe-card').length,1);
 card.querySelector('.rec-del').click();d.getElementById('recordActionConfirm').click();assert.equal(d.querySelectorAll('.swipe-card').length,0);await delay(60);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('collapsed readings still validate and keyboard navigation preserves the draft without submitting',async()=>{
 const legacy=legacyAccount(hash),{env}=environment({anna:legacy}),p=await page(env);
 try{await p.w.performLogin('anna',password,false);p.w.editRecordById(42);const d=p.w.document,before=JSON.stringify(legacy.addresses[0].records);d.getElementById('collapseCompleted').click();assert.equal(d.getElementById('blockWaterDetails').open,false);
 d.getElementById('wCur').value='1';p.w.calculatePreview();assert.equal(d.getElementById('submitFormBtn').disabled,true);assert.equal(d.getElementById('entryReviewTotal').textContent,'—');d.getElementById('jumpToReview').click();assert.equal(d.getElementById('blockWaterDetails').open,true);assert.equal(d.activeElement.id,'wCur');
 d.getElementById('wCur').value='130';d.getElementById('wCur').dispatchEvent(new p.w.Event('input',{bubbles:true}));d.getElementById('wCur').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await delay(20);assert.equal(JSON.stringify(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.addresses[0].records),before);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});
test('provider edits persist offline, preserve history and stay out of guest shares',async()=>{
 const legacy=legacyAccount(hash),token='e'.repeat(40),{env,values}=environment({anna:legacy,[`share:${token}`]:{login:'anna',addressId:'home'}}),p=await page(env);let stored;
 try{await p.w.performLogin('anna',password,false);p.w.openSettingsPanel('providers');p.w.openProviderEditor('water');const d=p.w.document;
 d.getElementById('providerName').value='Мій водоканал';d.getElementById('providerAccount').value='001239';d.getElementById('providerWebsite').value='javascript:alert(1)';d.getElementById('providerForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));assert.match(d.getElementById('providerError').textContent,/https/);assert.equal(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.accountSettings?.providerCards,undefined);
 Object.defineProperty(p.w.navigator,'onLine',{value:false,configurable:true});d.getElementById('providerWebsite').value='https://example.org/account';d.getElementById('providerEmail').value='water@example.org';d.getElementById('providerForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));stored=p.storage();const local=JSON.parse(stored['komynalka_account_v1:anna']);assert.equal(local.local.accountSettings.providerCards['address:home']['service:water'].account,'001239');assert.equal(local.local.accountSettings.providerCards['address:home']['service:water'].email,'water@example.org');assert.deepEqual(local.local.addresses[0].records,legacy.addresses[0].records);assert.equal(local.local.addresses[0].name,legacy.addresses[0].name);assert.ok(local.pending);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
 const reopened=await page(env,stored,true);
 try{reopened.w.openSettingsPanel('providers');assert.match(reopened.w.document.getElementById('providersList').textContent,/001239/);assert.deepEqual(reopened.errors,[]);}finally{reopened.close();}
 const online=await page(env,stored);
 try{await online.w.performLogin('anna',password,false);await online.w.syncToCloud();const saved=JSON.parse(values.get('anna'));assert.equal(saved.accountSettings.providerCards['address:home']['service:water'].account,'001239');assert.deepEqual(saved.addresses[0].records,legacy.addresses[0].records);const share=await worker.fetch(new Request('https://worker.test/?share='+token),env);const body=await share.text();assert.equal(body.includes('001239'),false);assert.equal(body.includes('providerCards'),false);assert.deepEqual(online.errors,[]);}finally{online.close();}
});

test('provider email opens a filled draft with separate copy actions and does not mark transfer complete',async()=>{
 const legacy=legacyAccount(hash);legacy.addresses[0].name='Чабани Покровська 306 кв 7';legacy.addresses[0].records[0].wPrev=267;legacy.addresses[0].records[0].wCur=280;
 const {env}=environment({anna:legacy}),p=await page(env);
 try{
  await p.w.performLogin('anna',password,false);p.w.openSettingsPanel('providers');p.w.openProviderEditor('water');const d=p.w.document;
  d.getElementById('providerAccount').value='6037';d.getElementById('providerEmail').value='water@example.org';d.getElementById('providerEmailSubject').value='О/р {account}. {address}';d.getElementById('providerEmailBody').value='Показники ліч. Поточні {current}. Попередні {previous}. Різниця {difference}';d.getElementById('providerForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));
  d.getElementById('providerMonth').value='2026-08';p.w.renderProviders();const action=d.querySelector('[data-provider-email="water"]');assert.match(action.textContent,/Підготувати лист/);action.click();
  assert.ok(d.getElementById('providerEmailDialog').hasAttribute('open'));assert.equal(d.getElementById('providerEmailTo').value,'water@example.org');assert.equal(d.getElementById('providerEmailSubjectText').value,'О/р 6037. Чабани Покровська 306 кв 7');assert.equal(d.getElementById('providerEmailBodyText').value,'Показники ліч. Поточні 280. Попередні 267. Різниця 13');
  const copied=[];Object.defineProperty(p.w.navigator,'clipboard',{value:{writeText:async text=>copied.push(text)},configurable:true});for(const field of ['to','subject','body']){d.querySelector(`[data-provider-email-copy="${field}"]`).click();await delay(0);}assert.deepEqual(copied,['water@example.org','О/р 6037. Чабани Покровська 306 кв 7','Показники ліч. Поточні 280. Попередні 267. Різниця 13']);assert.match(d.getElementById('providerCopyStatus').textContent,/Скопійовано/);
  const mail=new URL(d.getElementById('providerOpenMail').href);assert.equal(mail.searchParams.get('body'),copied[2]);
  const destination=d.getElementById('providerMailDestination');destination.value='gmail';destination.dispatchEvent(new p.w.Event('change',{bubbles:true}));const gmail=new URL(d.getElementById('providerOpenMail').href);assert.equal(gmail.origin,'https://mail.google.com');assert.equal(gmail.searchParams.get('body'),copied[2]);
  destination.value='copy';destination.dispatchEvent(new p.w.Event('change',{bubbles:true}));assert.equal(d.getElementById('providerOpenMail').classList.contains('hidden'),true);d.getElementById('providerCopyFullMail').click();await delay(0);assert.match(copied.at(-1),/Кому: water@example.org/);assert.equal(p.w.localStorage.getItem('komynalka_mail_destination'),'copy');
  assert.deepEqual(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.addresses[0].records,legacy.addresses[0].records);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});
test('current-month water email is one action away from the dashboard transfer list',async()=>{
 const legacy=legacyAccount(hash),month=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'}).slice(0,7);
 legacy.addresses[0].records[0].month=month;legacy.addresses[0].records[0]._filled={water:true};
 legacy.accountSettings={...legacy.accountSettings,providerCards:{'address:home':{'service:water':{email:'water@example.org',account:'6037'}}}};
 const {env}=environment({anna:legacy}),p=await page(env);
 try{
  await p.w.performLogin('anna',password,false);p.w.renderMonthlyTasks();const d=p.w.document,action=d.querySelector('[data-email-service="water"]');assert.ok(action);assert.match(action.textContent,/Лист: Вода/);
  action.click();assert.ok(d.getElementById('providerEmailDialog').hasAttribute('open'));assert.equal(d.getElementById('providerEmailTo').value,'water@example.org');
  assert.deepEqual(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.addresses[0].records,legacy.addresses[0].records);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('a failed local provider save keeps the editor and prior data; retry succeeds',async()=>{
 const {env}=environment({anna:legacyAccount(hash)}),p=await page(env);
 try{await p.w.performLogin('anna',password,false);p.w.openSettingsPanel('providers');p.w.openProviderEditor('water');const d=p.w.document;d.getElementById('providerAccount').value='0007';const set=p.w.Storage.prototype.setItem;
 p.w.Storage.prototype.setItem=function(key,value){if(key==='komynalka_account_v1:anna')throw new Error('quota');return set.call(this,key,value);};d.getElementById('providerForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));assert.ok(d.getElementById('providerDialog').hasAttribute('open'));assert.equal(d.getElementById('providerAccount').value,'0007');assert.equal(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.accountSettings?.providerCards,undefined);
 p.w.Storage.prototype.setItem=set;d.getElementById('providerForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await p.w.syncToCloud();assert.equal(JSON.parse(p.storage()['komynalka_account_v1:anna']).local.accountSettings.providerCards['address:home']['service:water'].account,'0007');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});
test('an open provider editor cannot overwrite a newer card received by sync',async()=>{
 const {env}=environment({anna:legacyAccount(hash)}),p=await page(env);
 try{await p.w.performLogin('anna',password,false);p.w.openSettingsPanel('providers');p.w.openProviderEditor('water');const d=p.w.document;d.getElementById('providerAccount').value='old draft';const next=JSON.parse(p.storage()['komynalka_account_v1:anna']).local;next.accountSettings=p.w.KomunalkaProviders.update(next.accountSettings||{},'home','water',{account:'new from sync'});p.w.applySnapshot(next);
 d.getElementById('providerForm').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));assert.match(d.getElementById('providerError').textContent,/іншому пристрої/);assert.equal(d.getElementById('providerAccount').value,'old draft');assert.equal(p.w.KomunalkaProviders.get(p.w.accountSnapshot().accountSettings,'home','water').account,'new from sync');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});
