// ============================================================
// КОМУНАЛКА PWA
// ============================================================
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const MAX_ADDRESSES_FREE = 3;
const LOCAL_BACKUP_KEY = 'komynalka_backup';
const PRE_IMPORT_BACKUP_KEY = 'komynalka_pre_import_backup';
const CHANGE_LOG_KEY = 'komynalka_change_log';
const CUSTOM_TARIFF_TEMPLATE_KEY = 'komynalka_tariff_template';
const CUSTOM_REMINDERS_KEY = 'komynalka_custom_reminders';
const COMMUNITY_TARIFF_KEY = 'komynalka_community_tariff';
const DEVICE_META_PREFIX = 'komynalka_device_meta_v1';

const firebaseConfig = { apiKey: "AIzaSyBgRHmaHjg23BIZjJdCucwnmMFDX57XP80", authDomain: "pwakomun.firebaseapp.com", projectId: "pwakomun", storageBucket: "pwakomun.firebasestorage.app", messagingSenderId: "4437974770", appId: "1:4437974770:web:bf7d2f7bac35eff5707a6b" };
firebase.initializeApp(firebaseConfig);

window.addEventListener('load', () => {
  setTimeout(() => { const s = $('splashScreen'); if (s) { s.style.opacity = '0'; setTimeout(() => s.remove(), 500); } }, 600);
});

// =================== STATE ===================
let googleUser = null;
let activeStore = null, activeDrain = null, authUid = null;
let activeSettings = {};
const initialDeviceLogin = localStorage.getItem('k_login');
let syncProtocol = 0;
let draftContext = null;
let draftDirty = false;
let sessionLogin = localStorage.getItem('k_login');
let sessionPass  = localStorage.getItem('k_passHash');
let displayName  = localStorage.getItem('k_display_name') || '';
let currentFilter = 'all';
let syncState = 'synced';
const defaultTariffs = { water: 30.38, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 };
const defaultPrefs   = { showWater: true, showHotWater: false, showElectro: true, showGas: true, electroTwoZone: true, electroWinter: true, remindersEnabled: false, remWaterStart: 1, remWaterEnd: 5, remElectroStart: 28, remElectroEnd: 3, remGasStart: 1, remGasEnd: 5, familyRole: 'owner' };
const TARIFF_PRESETS = [
  { id: 'kyiv-typical', name: 'Київ / типовий постачальник', tariffs: { water: 30.38, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 } },
  { id: 'lviv-typical', name: 'Львів / типовий постачальник', tariffs: { water: 32.64, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 } },
  { id: 'odesa-typical', name: 'Одеса / типовий постачальник', tariffs: { water: 35.16, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 } },
  { id: 'dnipro-typical', name: 'Дніпро / типовий постачальник', tariffs: { water: 31.36, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 } },
  { id: 'kharkiv-typical', name: 'Харків / типовий постачальник', tariffs: { water: 33.72, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 } },
];
const defaultCustomServices = [{ id: "s1", name: "Квартплата", defaultSum: "" }, { id: "s2", name: "Сміття", defaultSum: "" }];
let addresses = [], currentAddressId = 'default', isGuest = false, tariffs = {}, prefs = {}, records = [], customServices = [];
let currentCalc = { waterCost: 0, hotWaterCost: 0, electroCost: 0, gasCost: 0, customCost: 0, total: 0 };
const urlParamsObj  = new URLSearchParams(window.location.search);
const urlShareToken = urlParamsObj.get('share');

// =================== DEVICE FINGERPRINT ===================
function getDeviceFingerprint() {
  let fp = localStorage.getItem('k_device_fp');
  if (!fp) {
    const raw = navigator.userAgent + navigator.language + screen.width + 'x' + screen.height + new Date().getTimezoneOffset();
    let hash = 0;
    for (let i = 0; i < raw.length; i++) { const chr = raw.charCodeAt(i); hash = ((hash << 5) - hash) + chr; hash |= 0; }
    fp = Math.abs(hash).toString(36) + Date.now().toString(36);
    localStorage.setItem('k_device_fp', fp);
  }
  return fp;
}
const DEVICE_FP = getDeviceFingerprint();

// =================== UTILS ===================
let toastTimeout;
function showToast(msg, icon = '✅') {
  const t = $('toast'); if (!t) return;
  $('toastMsg').innerText = msg;
  $('toastIcon').innerText = icon;
  t.style.pointerEvents = 'none';
  t.classList.remove('-translate-y-24', 'opacity-0');
  try { haptic(icon === '✅' ? 'success' : icon === '❌' || icon === '⚠️' ? 'error' : 'notification'); } catch(e) {}
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.add('-translate-y-24', 'opacity-0'), 2500);
}

function showActionToast(msg, actionText, onAction, icon = '✅') {
  const t = $('toast'); if (!t) return showToast(msg, icon);
  const msgEl = $('toastMsg'), iconEl = $('toastIcon');
  if (!msgEl || !iconEl) return showToast(msg, icon);
  iconEl.innerText = icon;
  msgEl.innerHTML = `${escapeHtml(msg)} <button type="button" id="toastActionBtn" class="ml-2 underline underline-offset-2 font-black">${escapeHtml(actionText)}</button>`;
  t.style.pointerEvents = 'auto';
  t.classList.remove('-translate-y-24', 'opacity-0');
  try { haptic('notification'); } catch(e) {}
  $('toastActionBtn')?.addEventListener('click', () => {
    clearTimeout(toastTimeout);
    t.classList.add('-translate-y-24', 'opacity-0');
    t.style.pointerEvents = 'none';
    onAction();
  });
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { t.classList.add('-translate-y-24', 'opacity-0'); t.style.pointerEvents = 'none'; }, 6000);
}

function vibe(pattern = 10) { try { if (navigator.vibrate) navigator.vibrate(Array.isArray(pattern) ? pattern : [pattern]); } catch(e) {} }
const hapticPatterns = { light:[5], medium:[10], heavy:[20], success:[10,50,10], error:[50,30,50], notification:[15,100,15], tabSwitch:[3] };
function haptic(type) { vibe(hapticPatterns[type] || hapticPatterns.light); }

async function getHash(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}

function setSyncState(state) {
  syncState=state;
  const labels={synced:'Збережено у хмарі',syncing:'Синхронізація…',pending:'Збережено на пристрої',offline:'Офлайн · дані на пристрої',error:'Не вдалося синхронізувати',conflict:'Потрібно узгодити зміни'};
  const dot=$('syncDotHeader');if(dot)dot.className=`sync-dot ${state}`;
  if($('syncStatusText'))$('syncStatusText').textContent=labels[state]||state;
  if(state==='synced'&&sessionLogin)writeDeviceMeta({lastSyncedAt:Date.now()});
  renderDataHealth();
}
function deviceMetaKey(){return `${DEVICE_META_PREFIX}:${encodeURIComponent(sessionLogin||initialDeviceLogin||'device')}`;}
function readDeviceMeta(){try{return JSON.parse(localStorage.getItem(deviceMetaKey())||'{}');}catch{return {};}}
function writeDeviceMeta(patch){try{localStorage.setItem(deviceMetaKey(),JSON.stringify({...readDeviceMeta(),...patch}));}catch{}renderDataHealth();}
function formatDeviceTime(value){if(!value)return null;const date=new Date(value);if(Number.isNaN(date.getTime()))return null;return new Intl.DateTimeFormat('uk-UA',{dateStyle:'medium',timeStyle:'short'}).format(date);}
function renderDataHealth(){
  const summary=$('dataHealthSummary');if(!summary)return;
  const labels={synced:'Дані захищені та синхронізовані',syncing:'Надсилаємо зміни у хмару…',pending:'Зміни безпечно збережені на цьому пристрої',offline:'Офлайн: працюємо з локальною копією',error:'Синхронізація потребує уваги',conflict:'Потрібно обрати правильну версію даних'};
  const state=activeStore?.read?.(),meta=readDeviceMeta();
  summary.textContent=labels[syncState]||'Стан даних невідомий';
  if($('dataLastSync'))$('dataLastSync').textContent=formatDeviceTime(meta.lastSyncedAt)||'Ще не синхронізовано';
  if($('dataLastExport'))$('dataLastExport').textContent=formatDeviceTime(meta.lastExportAt)||'Ще не створено';
  if($('dataPendingState'))$('dataPendingState').textContent=state?.conflict?'Є конфлікт':state?.pending?'Очікують синхронізації':'Немає';
  if($('dataAppVersion'))$('dataAppVersion').textContent=APP_VERSION;
  if($('appVersion'))$('appVersion').textContent=APP_VERSION;
}
function accountSnapshot(){return {addresses,currentAddressId,accountSettings:activeSettings};}
function saveToLocal() {
  if(isGuest||!activeStore)return false;
  try {activeStore.stage(accountSnapshot());return true;}
  catch(e){setSyncState('error');showToast('Не вдалося зберегти на пристрої. Зробіть JSON-копію перед закриттям.','❌');return false;}
}
function loadFromLocal(key=LOCAL_BACKUP_KEY) {
  try {
    if(activeStore)return key===LOCAL_BACKUP_KEY?activeStore.read()?.local:activeStore.backup(key);
    return null;
  }catch(e){return null;}
}
function backupCurrentState(key=LOCAL_BACKUP_KEY) {
  try {if(!activeStore||isGuest)return false;syncCurrentAddress();activeStore.saveBackup(key,accountSnapshot());return true;}
  catch(e){showToast('Копію не створено. Дані не замінено.','❌');return false;}
}
function applySnapshot(snapshot){addresses=KomunalkaData.copy(snapshot.addresses);currentAddressId=snapshot.currentAddressId||addresses[0]?.id||'default';activeSettings=KomunalkaData.copy(snapshot.accountSettings||{});loadCurrentAddress();}
function restoreFromLocalBackup(key=LOCAL_BACKUP_KEY) {
  try {const backup=loadFromLocal(key);const normalized=normalizeImportData(backup);if(!normalized)return false;applySnapshot(normalized);syncToCloud();return true;}
  catch(e){showToast('Копія потребує перевірки. Оригінал збережено.','⚠️');return false;}
}
const accountStorage={
  getItem(key){return activeStore?(activeSettings[key]??null):null;},
  setItem(key,value){if(!activeStore||isGuest)return;activeSettings[key]=String(value);debouncedSync();},
  removeItem(key){if(!activeStore||isGuest)return;delete activeSettings[key];debouncedSync();}
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sanitizeDomId(value, fallback = 'item') {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return safe || `${fallback}_${Date.now().toString(36)}`;
}

function createTariffSnapshot() {
  return records.find(r=>r.month===$('monthInput')?.value)?.tariffSnapshot || { ...tariffs, savedAt: new Date().toISOString() };
}

function clampMoney(value, max = Infinity) {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(num, 0), Number.isFinite(max) ? Math.max(max, 0) : num);
}

function getPaymentStatus(rec) {
  const status = rec?.paymentStatus;
  if (status === 'paid' || status === 'partial' || status === 'charged') return status;
  return rec?.paid ? 'paid' : 'charged';
}

function getPaidAmount(rec) {
  const total = Math.max(0, normalizeNumber(rec?.total));
  const status = getPaymentStatus(rec);
  if (status === 'paid') return total;
  if (status === 'partial') return clampMoney(rec?.paidAmount, total);
  return 0;
}

function getOutstandingAmount(rec) {
  return Math.max(0, Math.max(0, normalizeNumber(rec?.total)) - getPaidAmount(rec));
}

function isRecordPaid(rec) {
  return getOutstandingAmount(rec) <= 0;
}

function getPaymentLabel(rec) {
  const status = getPaymentStatus(rec);
  if (status === 'paid') return 'Оплачено';
  if (status === 'partial') return 'Частково';
  return 'Нараховано';
}

function setRecordPayment(rec, status, amount) {
  const total = Math.max(0, normalizeNumber(rec?.total));
  rec.paymentStatus = status === 'paid' || status === 'partial' ? status : 'charged';
  rec.paidAmount = rec.paymentStatus === 'paid' ? total : rec.paymentStatus === 'partial' ? clampMoney(amount, total) : 0;
  rec.paid = rec.paymentStatus === 'paid';
  if (rec.paymentStatus === 'partial' && rec.paidAmount <= 0) rec.paymentStatus = 'charged';
}

function getFamilyRole() {
  if (isGuest) return 'view';
  return prefs.familyRole || defaultPrefs.familyRole;
}

function canEditData() {
  const role = getFamilyRole();
  return role === 'owner' || role === 'edit';
}

function requireEdit(message = 'Режим перегляду: редагування недоступне') {
  if (canEditData()) return true;
  showToast(message, '🔒');
  return false;
}

function updateFamilyRoleHint() {
  const hint = $('familyRoleHint');
  if (!hint) return;
  const role = getFamilyRole();
  hint.textContent = role === 'owner' ? 'Усі дії доступні в цьому акаунті. Цей перемикач не надає доступ іншим людям.' : role === 'edit' ? 'Редагування дозволяє додавати записи, але без ролі власника.' : 'Перегляд блокує додавання, оплату, редагування й видалення.';
}

function applyAccessMode() {
  const locked = !canEditData();
  const form = $('utilityForm');
  if (form) {
    form.querySelectorAll('input, select, textarea, button').forEach(el => {
      el.disabled = locked;
      el.classList.toggle('opacity-60', locked);
    });
    form.classList.toggle('pointer-events-none', locked);
  }
  if ($('btnClearFields')) {
    $('btnClearFields').disabled = locked;
    $('btnClearFields').classList.toggle('opacity-60', locked);
  }
  updateFamilyRoleHint();
}

function getChangeLog() {
  try {
    const log = JSON.parse(accountStorage.getItem(CHANGE_LOG_KEY) || '[]');
    return Array.isArray(log) ? log : [];
  } catch(e) {
    return [];
  }
}

function addChangeLog(type, details = {}) {
  const entry = { id: Date.now() + Math.random(), ts: new Date().toISOString(), type, details };
  try {
    const log = [entry, ...getChangeLog()].slice(0, 80);
    accountStorage.setItem(CHANGE_LOG_KEY, JSON.stringify(log));
  } catch(e) {}
}

// =================== DISPLAY NAME ===================
function updateDisplayName() {
  const nameEl    = $('userDisplayName');
  const accountEl = $('accountLoginDisplay');
  const inputEl   = $('displayNameInput');
  const greetEl   = $('userGreeting');
  if (nameEl)    nameEl.textContent    = displayName || sessionLogin || '—';
  if (accountEl) accountEl.textContent = sessionLogin || '—';
  if (inputEl)   inputEl.value         = displayName;
  if (greetEl) {
    const hour = new Date().getHours();
    const greeting = hour < 6 ? 'Доброї ночі' : hour < 12 ? 'Доброго ранку' : hour >= 18 ? 'Доброго вечора' : 'Привіт';
    greetEl.textContent = displayName ? `${greeting}, ${displayName.split(' ')[0]}!` : `${greeting}!`;
  }
}

async function saveDisplayName() {
  const input = $('displayNameInput');
  if (!input) return;
  const newName = input.value.trim().slice(0, 50);
  try {
    const res  = await secureFetch('POST', {}, { action: 'update_name', displayName: newName });
    const data = await res.json();
    if (data.success) {
      displayName = newName;
      localStorage.setItem('k_display_name', displayName);
      updateDisplayName();
      showToast("Ім'я збережено! ✓");
    } else {
      showToast('Помилка збереження', '❌');
    }
  } catch(e) {
    showToast('Помилка мережі', '❌');
  }
}

// =================== SECURE FETCH ===================
async function secureFetch(method, params = {}, body = null) {
  let url = WORKER_URL;
  const headers = { 'Content-Type': 'application/json', 'X-Device-FP': DEVICE_FP };
  const uid = authUid;
  if (uid) {
    const user=googleUser||firebase.auth().currentUser;
    if(!user||user.uid!==uid)throw new Error('Увійдіть через Google ще раз');
    headers['Authorization'] = `Bearer ${await user.getIdToken()}`;
  } else if (sessionLogin && sessionPass) {
    headers['Authorization'] = `Bearer login:${btoa(unescape(encodeURIComponent(sessionLogin)))}:${sessionPass}`;
  }
  const urlP = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null) urlP.set(k, v); });
  const qs = urlP.toString();
  if (qs) url += '?' + qs;
  const options = { method, headers, cache: 'no-store' };
  if (body && method === 'POST') options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (res.status === 429) {
    showToast('Забагато запитів. Зачекайте хвилину.', '⏳');
  }
  return res;
}

// =================== BROADCAST ===================
async function checkBroadcast() {
  try {
    const res = await secureFetch('POST', {}, { action: 'get_broadcast' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.message) {
      const lastSeen = localStorage.getItem('k_broadcast_seen') || '';
      if (data.date !== lastSeen) showBroadcastBanner(data.message, data.date);
    }
  } catch(e) {}
}

function showBroadcastBanner(message, date) {
  const existing = $('broadcastBanner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'broadcastBanner';
  banner.className = 'fixed top-0 left-0 right-0 z-[800] bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-4 flex items-center gap-3 shadow-xl';
  const icon=document.createElement('span');icon.className='text-lg';icon.textContent='📢';
  const copy=document.createElement('p');copy.className='flex-1 text-sm font-bold';copy.textContent=String(message||'');
  const close=document.createElement('button');close.type='button';close.className='px-3 py-1.5 bg-white/20 rounded-lg text-xs font-bold active:scale-95';close.setAttribute('aria-label','Закрити оголошення');close.textContent='✕';close.addEventListener('click',()=>dismissBroadcast(date));
  banner.append(icon,copy,close);
  document.body.appendChild(banner);
}
function dismissBroadcast(date) { localStorage.setItem('k_broadcast_seen', date); $('broadcastBanner')?.remove(); }
window.dismissBroadcast = dismissBroadcast;

// =================== SYNC ===================
let syncDebounceTimer;
function bindAccount(owner,remote,revision,protocol){
  const nextStore=KomunalkaData.create(localStorage,owner);
  const state=nextStore.initialize(remote,revision);
  activeStore=nextStore;
  syncProtocol=protocol||0;
  const boundStore=activeStore;
  activeDrain=KomunalkaSyncQueue.createDrain(boundStore,async entry=>{
    if(activeStore!==boundStore)throw new Error('ACCOUNT_CHANGED');
    if(syncProtocol!==2)throw new Error('SERVER_UPDATE_REQUIRED');
    const res=await secureFetch('POST',{}, {...entry.local,baseRevision:entry.revision,clientMutationId:entry.pending.id});
    const result=await res.json();
    if(res.status===409){const response=await secureFetch('GET');const cloud=await response.json();if(!response.ok||!cloud.success)throw new Error('SYNC_READ_FAILED');return{conflict:true,remote:normalizeImportData(cloud.data),revision:cloud.data.revision};}
    if(!res.ok||!result.success||result.protected)throw new Error(result.error||'SAVE_NOT_CONFIRMED');
    return result;
  },state=>{if(activeStore===boundStore)setSyncState(state);});
  return state;
}
async function flushSync(){
  if(isGuest||!activeDrain||!activeStore)return;
  if(!navigator.onLine){setSyncState('offline');return;}
  const store=activeStore;
  try{const state=await activeDrain();if(store!==activeStore)return;if(state?.conflict)showSyncConflict();else if(state&&!state.pending){if(!KomunalkaData.equal(accountSnapshot(),state.local)){saveDraft();applySnapshot(state.local);}setSyncState('synced');}}
  catch(e){if(store!==activeStore)return;setSyncState(navigator.onLine?'pending':'offline');if(e.message==='SERVER_UPDATE_REQUIRED'){if($('syncStatusText'))$('syncStatusText').textContent='На пристрої · сервер очікує оновлення';}else if(navigator.onLine)showToast('Зміни на пристрої. Синхронізацію можна повторити.','⚠️');}
}
function syncToCloud(){
  if(isGuest||!activeStore)return Promise.resolve(false);
  syncCurrentAddress();
  if(!saveToLocal())return Promise.resolve(false);
  setSyncState('pending');
  return flushSync();
}
function debouncedSync(){syncCurrentAddress();saveToLocal();clearTimeout(syncDebounceTimer);syncDebounceTimer=setTimeout(flushSync,700);}
function showSyncConflict(){
  const state=activeStore?.read();if(!state?.conflict)return;
  setSyncState('conflict');
  const panel=$('syncRecovery');if(!panel)return;
  panel.classList.remove('hidden');
  const local=state.local.addresses.reduce((n,a)=>n+a.records.length,0),remote=state.conflict.remote.addresses.reduce((n,a)=>n+a.records.length,0);
  $('syncRecoveryText').textContent=`На пристрої: ${local} записів. У хмарі: ${remote}. Є зміни в обох версіях. Спочатку завантажте обидві копії для порівняння. Поточна версія збережена на пристрої.`;
}
$('syncCompareExport')?.addEventListener('click',()=>{const state=activeStore?.read();if(state?.conflict)downloadBlob(JSON.stringify({local:state.local,cloud:state.conflict.remote},null,2),'komunalka_versions.json','application/json');});
for(const [id,choice] of [['syncUseLocal','local'],['syncUseCloud','remote']])$(id)?.addEventListener('click',()=>{
  if(!confirm(choice==='local'?'Застосувати версію з цього пристрою? Хмарна версія залишиться в локальній резервній копії.':'Відкрити хмарну версію? Поточна версія залишиться в локальній резервній копії.'))return;
  try{const state=activeStore.resolve(choice);applySnapshot(state.local);$('syncRecovery')?.classList.add('hidden');flushSync();}catch(e){showToast('Не вдалося створити копію. Версії залишились без змін.','❌');}
});
window.addEventListener('online',async()=>{try{if(!activeStore)return;const res=await secureFetch('GET');const data=await res.json();if(!res.ok||!data.success)throw new Error('READ_FAILED');syncProtocol=data.data.syncProtocol||0;const state=activeStore.initialize(normalizeImportData(data.data),data.data.revision);if(state.conflict)showSyncConflict();else{saveDraft();applySnapshot(state.local);await flushSync();}}catch(e){setSyncState('pending');}});
window.addEventListener('offline',()=>setSyncState('offline'));
window.addEventListener('storage',e=>{if(activeStore&&e.key===activeStore.key){const state=activeStore.read();if(state){saveDraft();applySnapshot(state.local);if(state.conflict)showSyncConflict();else setSyncState(state.pending?'pending':'synced');}}});

// =================== THEME ===================
let currentMode = localStorage.getItem('themeMode') || 'auto';
let currentLiquidGlass = parseInt(localStorage.getItem('liquidGlassLevel') || '0', 10);
function setThemeMode(mode) {
  currentMode = mode; localStorage.setItem('themeMode', mode); applyThemeMode();
  ['light','auto','dark'].forEach(m => {
    const b = $('mode-' + m); if (!b) return;
    b.classList.remove('bg-white','dark:bg-[#2c2c2e]','text-slate-900','dark:text-white','shadow-sm');
    if (m === mode) b.classList.add('bg-white','dark:bg-[#2c2c2e]','text-slate-900','dark:text-white','shadow-sm');
  });
}
function applyThemeMode() {
  const isDark = currentMode === 'dark' || (currentMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  $('metaThemeColor')?.setAttribute("content", isDark ? "#05060a" : "#f7f9ff");
  applyLiquidGlassLevel(currentLiquidGlass);
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (currentMode === 'auto') applyThemeMode(); });
setThemeMode(currentMode);

function applyLiquidGlassLevel(value) {
  const level = Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 68));
  currentLiquidGlass = level;
  const strength = level / 100;
  document.documentElement.style.setProperty('--nav-glass-blur',`${Math.round(strength*24)}px`);
  document.documentElement.style.setProperty('--nav-glass-alpha',String(1-strength*.22));
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');
  const cardAlpha = isDark ? 0.78 - strength * 0.28 : 0.88 - strength * 0.30;
  const barAlpha = isDark ? 0.82 - strength * 0.25 : 0.92 - strength * 0.28;
  const controlAlpha = isDark ? 0.66 - strength * 0.22 : 0.78 - strength * 0.20;
  const blur = 18 + Math.round(strength * 22);
  root.style.setProperty('--liquid-level', strength.toFixed(2));
  root.style.setProperty('--liquid-card-alpha', cardAlpha.toFixed(2));
  root.style.setProperty('--liquid-bar-alpha', barAlpha.toFixed(2));
  root.style.setProperty('--liquid-control-alpha', controlAlpha.toFixed(2));
  root.style.setProperty('--liquid-blur', `${blur}px`);
  const range = $('liquidGlassRange');
  const label = $('liquidGlassValue');
  if (range) range.value = String(level);
  if (label) label.textContent = `${level}%`;
}

// =================== WELCOME ===================
function showWelcome() { if (localStorage.getItem('welcome_done')) return; $('welcomeTooltip')?.classList.remove('hidden'); }
function dismissWelcome() { localStorage.setItem('welcome_done', '1'); $('welcomeTooltip')?.classList.add('hidden'); }
$('dismissWelcomeBtn')?.addEventListener('click',dismissWelcome);
$('welcomeTooltip')?.addEventListener('click',e=>{if(e.target===e.currentTarget)dismissWelcome();});

// =================== AUTH ===================
$('authForm')?.addEventListener('submit', async (e) => { e.preventDefault(); await performLogin($('authLogin').value.trim(), $('authPass').value, false); });
$('togglePassBtn')?.addEventListener('click', () => {
  const p = $('authPass');
  p.type = p.type === 'password' ? 'text' : 'password';
  $('passEyeIcon').className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

$('googleAuthBtn')?.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await firebase.auth().signInWithPopup(provider);
    googleUser = result.user;
    await performLogin(null, null, false, googleUser.uid);
  } catch(e) { if (e.code !== 'auth/popup-closed-by-user') showToast("Помилка Google", "❌"); }
});

async function performLogin(rawLogin,rawPass,isAlreadyHashed,uid=null){
  const errEl=$('authError');errEl?.classList.add('hidden');
  if($('authBtnText'))$('authBtnText').textContent='Завантаження…';
  $('authSpinner')?.classList.remove('hidden');
  const previousLogin=sessionLogin,previousPass=sessionPass,previousUid=authUid;
  try{
    authUid=uid;
    if(!uid){sessionLogin=String(rawLogin||'').trim().toLowerCase();sessionPass=isAlreadyHashed?rawPass:await getHash(rawPass);}
    const res=await secureFetch('GET',{t:Date.now()});const result=await res.json();
    if(res.status===403||res.status===401)throw new Error('Неправильний пароль або сесія завершилась');
    if(res.status===429)throw new Error('Забагато спроб. Зачекайте хвилину.');
    if(res.status!==404&&(!res.ok||!result.success))throw new Error('Не вдалося завантажити дані. Спробуйте ще раз.');
    if(res.status===404&&uid&&initialDeviceLogin&&!initialDeviceLogin.startsWith('uid_')){sessionLogin=previousLogin;sessionPass=previousPass;$('linkModal')?.classList.remove('hidden');return;}
    if(!saveDraft())throw new Error('Спочатку збережіть або експортуйте поточну чернетку');
    const owner=result.data?.linkedLogin||(uid?`uid_${uid}`:sessionLogin);
    if(localStorage.getItem('k_push_owner')&&localStorage.getItem('k_push_owner')!==owner&&!await detachPush())throw new Error('Не вдалося від’єднати сповіщення попереднього акаунта');
    sessionLogin=owner;
    let remote=res.status===404?{addresses:[],currentAddressId:'default'}:normalizeImportData(result.data);
    if(!remote)throw new Error('Дані потребують перевірки. Оригінал у хмарі збережено.');
    // Device settings are adopted only for the same previously signed-in account.
    let adoptedSettings=null;
    if(!localStorage.getItem(`komynalka_account_v1:${encodeURIComponent(owner)}`)&&!Object.keys(remote.accountSettings||{}).length&&initialDeviceLogin===owner){adoptedSettings={};for(const key of ['k_budget',CUSTOM_REMINDERS_KEY,CUSTOM_TARIFF_TEMPLATE_KEY,COMMUNITY_TARIFF_KEY,CHANGE_LOG_KEY,'achievements_unlocked','lastSubmittedMonth','lastPushShown']){const val=localStorage.getItem(key);if(val!==null)adoptedSettings[key]=val;}}
    let state=bindAccount(owner,remote,result.data?.revision??0,result.data?.syncProtocol||result.syncProtocol);
    if(adoptedSettings&&Object.keys(adoptedSettings).length)state=activeStore.stage({...state.local,accountSettings:{...adoptedSettings,...state.local.accountSettings}});
    localStorage.setItem('k_login',owner);
    if(uid){localStorage.setItem('k_uid',uid);localStorage.removeItem('k_passHash');sessionPass=null;}else{localStorage.setItem('k_passHash',sessionPass);localStorage.removeItem('k_uid');}
    displayName=result.data?.displayName||'';localStorage.setItem('k_display_name',displayName);
    applySnapshot(state.local);
    if(!addresses.length){addresses=[{id:'default',name:'Мій дім',tariffs:{...defaultTariffs},prefs:{...defaultPrefs},records:[],customServices:KomunalkaData.copy(defaultCustomServices)}];currentAddressId='default';loadCurrentAddress();await syncToCloud();}
    else if(state.conflict)showSyncConflict();else{setSyncState(state.pending?'pending':'synced');if(state.pending)await flushSync();}
    showLegacyRecovery();
    if(!records.length)showWelcome();checkBroadcast();
  }catch(e){sessionLogin=previousLogin;sessionPass=previousPass;authUid=previousUid;if(errEl){errEl.textContent=e.message;errEl.classList.remove('hidden');}}
  finally{if($('authBtnText'))$('authBtnText').textContent='Увійти';$('authSpinner')?.classList.add('hidden');}
}
function showLegacyRecovery(){
  const raw=localStorage.getItem(LOCAL_BACKUP_KEY);
  if(raw&&$('legacyRecovery'))$('legacyRecovery').classList.remove('hidden');
}
$('legacyExportBtn')?.addEventListener('click',()=>{const raw=localStorage.getItem(LOCAL_BACKUP_KEY);if(raw)downloadBlob(raw,'komunalka_legacy_backup.json','application/json');});
$('linkYesBtn')?.addEventListener('click', () => {
  $('linkModal')?.classList.add('hidden');
  const laModal = $('linkAccountModal');
  if (laModal) {
    const laLogin = $('laLogin'), laPass = $('laPass'), laErr = $('laError');
    if (laLogin) laLogin.value = '';
    if (laPass)  laPass.value  = '';
    if (laErr)   laErr.classList.add('hidden');
    laModal.classList.remove('hidden');
    setTimeout(() => laLogin?.focus(), 100);
  }
});
$('laCancelBtn')?.addEventListener('click', () => $('linkAccountModal')?.classList.add('hidden'));
$('laSubmitBtn')?.addEventListener('click', async () => {
  const lgn = $('laLogin')?.value.trim();
  const pss = $('laPass')?.value;
  const laErr = $('laError');
  const laBtn = $('laBtnText');
  const laSpinner = $('laSpinner');
  if (!lgn || !pss) { if (laErr) { laErr.textContent = 'Введіть логін та пароль'; laErr.classList.remove('hidden'); } return; }
  if (laBtn) laBtn.textContent = 'Прив\'язую...';
  if (laSpinner) laSpinner.classList.remove('hidden');
  if (laErr) laErr.classList.add('hidden');
  try {
    await linkAccount(lgn, pss);
  } catch(e) {
    if (laErr) { laErr.textContent = 'Помилка: ' + e.message; laErr.classList.remove('hidden'); }
  }
  if (laBtn) laBtn.textContent = 'Прив\'язати';
  if (laSpinner) laSpinner.classList.add('hidden');
});
$('laPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('laSubmitBtn')?.click(); });
$('linkNoBtn')?.addEventListener('click', async () => {
  $('linkModal')?.classList.add('hidden');
  sessionLogin = `uid_${googleUser.uid}`;
  localStorage.setItem('k_uid',   googleUser.uid);
  localStorage.setItem('k_login', sessionLogin);
  authUid=googleUser.uid;bindAccount(sessionLogin,{addresses:[],currentAddressId:'default'},0,2);
  addresses=[{id:'default',name:'Мій дім',tariffs:{...defaultTariffs},prefs:{...defaultPrefs},records:[],customServices:KomunalkaData.copy(defaultCustomServices)}];
  currentAddressId='default';loadCurrentAddress();await syncToCloud();
  showToast("Акаунт створено!");
});

async function linkAccount(lgn, pss) {
  const passHash = await getHash(pss);
  const res  = await fetch(WORKER_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${await (googleUser||firebase.auth().currentUser).getIdToken()}`}, body: JSON.stringify({ action:"link_google", login: lgn, pass: passHash, uid: googleUser.uid }) });
  const data = await res.json();
  if (data.success) { $('linkModal')?.classList.add('hidden'); $('linkAccountModal')?.classList.add('hidden'); showToast("Підв'язано!"); performLogin(null, null, false, googleUser.uid); }
  else showToast("Неправильний логін або пароль", "❌");
}

$('btnLinkGoogle')?.addEventListener('click', async () => {
  if (!sessionLogin) return showToast("Спочатку увійдіть", "⚠️");
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await firebase.auth().signInWithPopup(provider);
    googleUser=result.user;
    const uid    = result.user.uid;
    const res    = await fetch(WORKER_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${await (googleUser||firebase.auth().currentUser).getIdToken()}`}, body: JSON.stringify({ action:"link_google", login: sessionLogin, pass: sessionPass, uid }) });
    if ((await res.json()).success) { showToast("Google підв'язано!"); localStorage.setItem('k_uid', uid); updateGoogleButton(); }
  } catch(e) { showToast("Скасовано", "⚠️"); }
});

function updateGoogleButton() {
  if (localStorage.getItem('k_uid') && $('btnLinkGoogle')) {
    $('btnLinkGoogle').innerHTML = '<i class="fa-solid fa-check"></i>';
    $('btnLinkGoogle').className = 'w-9 h-9 bg-green-50 dark:bg-green-500/10 rounded-xl flex items-center justify-center text-green-500 text-xs pointer-events-none';
  }
}

$('authPass')?.addEventListener('input', function() {
  const val = this.value, container = $('passStrength');
  if (!container) return;
  if (val.length === 0) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  let score = 0;
  if (val.length >= 4) score++;
  if (val.length >= 8 && /[A-Z]/.test(val) && /[0-9]/.test(val)) score++;
  if (val.length >= 10 && /[^A-Za-z0-9]/.test(val)) score++;
  const colors = ['bg-red-500','bg-yellow-500','bg-green-500'];
  const texts  = ['Слабкий','Нормальний','Сильний'];
  const color  = colors[score-1] || 'bg-slate-300';
  for (let i = 1; i <= 3; i++) {
    const bar = $(`passStr${i}`);
    if (bar) { bar.style.width = i <= score ? '100%' : '0%'; bar.className = `h-full w-0 rounded-full transition-all duration-300 ${i <= score ? color : ''}`; }
  }
  const text = $('passStrText');
  if (text) { text.textContent = texts[score-1] || ''; text.style.color = score===1?'#ef4444':score===2?'#eab308':'#22c55e'; }
});

setTimeout(() => { if ($('authScreen') && !$('authScreen').classList.contains('hidden')) $('authLogin')?.focus(); }, 800);

// =================== ADDRESS ===================
function loadCurrentAddress() {
  if(!saveDraft())return;
  if (!addresses || addresses.length === 0) {
    const backup = loadFromLocal();
    if (backup) { addresses = backup.addresses || []; currentAddressId = backup.currentAddressId || 'default'; }
  }
  if (!addresses.length) return;
  const addr = addresses.find(a => String(a.id) === String(currentAddressId)) || addresses[0];
  currentAddressId = addr.id;
  tariffs        = { ...defaultTariffs,  ...(addr.tariffs  || {}) };
  prefs          = { ...defaultPrefs,    ...(addr.prefs    || {}) };
  records        = addr.records        || [];
  customServices = addr.customServices || [...defaultCustomServices];
  if ($('currentAddressDisplay')) $('currentAddressDisplay').innerText = addr.name + (isGuest ? ' (Гість)' : '');
  initAppUI();renderProviders();
}

function syncCurrentAddress() {
  const idx = addresses.findIndex(a => String(a.id) === String(currentAddressId));
  if (idx >= 0) { addresses[idx].tariffs = tariffs; addresses[idx].prefs = prefs; addresses[idx].records = records; addresses[idx].customServices = customServices; }
}

function openAddressModal()  { $('addressModal')?.classList.remove('hidden'); setTimeout(() => $('addressModalContent')?.classList.remove('translate-y-full'), 10); renderAddressModal(); }
function closeAddressModal() { $('addressModalContent')?.classList.add('translate-y-full'); setTimeout(() => $('addressModal')?.classList.add('hidden'), 400); }
$('addressHeaderTrigger')?.addEventListener('click', openAddressModal);
$('closeAddressModalBtn')?.addEventListener('click', closeAddressModal);
$('addressModal')?.addEventListener('click', (e) => { if (e.target === $('addressModal')) closeAddressModal(); });

$('addAddressBtn')?.addEventListener('click', () => {
  if(!requireEdit('У режимі перегляду не можна додавати об’єкти'))return;
  if (addresses.length >= MAX_ADDRESSES_FREE) { showToast(`Максимум ${MAX_ADDRESSES_FREE} адреси`, '⚠️'); closeAddressModal(); return; }
  const name = prompt("Назва об'єкту:");
  if (name && name.trim()) {
    syncCurrentAddress();
    const newId = 'addr_' + Date.now();
    addresses.push({ id: newId, name: name.trim(), tariffs:{...defaultTariffs}, prefs:{...defaultPrefs}, records:[], customServices:[{ id:"s1", name:"Квартплата", defaultSum:"" }] });
    currentAddressId = newId;
    loadCurrentAddress(); syncToCloud(); closeAddressModal(); showToast("Додано"); checkNewAchievements();
  }
});

function renderAddressModal() {
  const list = $('addressListModal'); if (!list) return;
  list.innerHTML = addresses.map(a => `<div class="flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-95 cursor-pointer ${String(a.id)===String(currentAddressId)?'bg-brand border-brand text-white shadow-lg shadow-brand/20':'bg-slate-50 dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'}" data-addr-id="${escapeAttr(a.id)}"><span class="font-bold text-lg truncate pr-2 flex-1">${escapeHtml(a.name)}</span><div class="flex gap-1.5 shrink-0"><button class="addr-edit p-2 rounded-xl shadow-sm ${String(a.id)===String(currentAddressId)?'bg-white/20 text-white':'bg-white dark:bg-[#2c2c2e] text-slate-400'}" data-id="${escapeAttr(a.id)}"><i class="fa-solid fa-pen"></i></button>${a.id!==currentAddressId&&addresses.length>1?`<button class="addr-del p-2 text-slate-400 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-sm" data-id="${escapeAttr(a.id)}"><i class="fa-solid fa-trash"></i></button>`:''}</div></div>`).join('');
  list.querySelectorAll('[data-addr-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.addr-edit') || e.target.closest('.addr-del')) return;
      syncCurrentAddress(); currentAddressId = el.dataset.addrId; loadCurrentAddress(); syncToCloud(); closeAddressModal();
    });
  });
  list.querySelectorAll('.addr-edit').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); if(!requireEdit('У режимі перегляду не можна перейменовувати об’єкти'))return; const addr = addresses.find(a => String(a.id)===btn.dataset.id); const name = prompt("Нова назва:", addr.name); if (name&&name.trim()) { addr.name=name.trim(); renderAddressModal(); if (btn.dataset.id===String(currentAddressId)) $('currentAddressDisplay').innerText=addr.name; syncToCloud(); } });
  });
  list.querySelectorAll('.addr-del').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); if(!requireEdit('У режимі перегляду не можна видаляти об’єкти'))return; if (confirm("Видалити?")) { addresses=addresses.filter(a=>String(a.id)!==btn.dataset.id); if (String(currentAddressId)===btn.dataset.id) { currentAddressId=addresses[0].id; loadCurrentAddress(); } syncToCloud(); renderAddressModal(); } });
  });
}

// =================== ACHIEVEMENTS ===================
const ACHIEVEMENTS = [
  { id:'first_record',  emoji:'🎉', title:'Перший запис',    desc:'Зберегли перший розрахунок', check:(r)=>r.length>=1 },
  { id:'streak_3',      emoji:'🔥', title:'3 місяці поспіль',desc:'3 місяці без перерви',        check:(r)=>getStreak(r)>=3 },
  { id:'streak_6',      emoji:'💪', title:'Полугідник',      desc:'6 місяців поспіль',           check:(r)=>getStreak(r)>=6 },
  { id:'streak_12',     emoji:'👑', title:'Рік без перерви', desc:'Цілий рік!',                  check:(r)=>getStreak(r)>=12 },
  { id:'all_paid',      emoji:'✅', title:'Чистий рахунок',  desc:'Все оплачено',                check:(r)=>r.length>0&&r.every(rec=>isRecordPaid(rec)) },
  { id:'records_10',    emoji:'📊', title:'Аналітик',        desc:'10+ записів',                 check:(r)=>r.length>=10 },
  { id:'saver',         emoji:'💰', title:'Економ',          desc:'Знизили витрати 3 міс',       check:(r)=>checkSaverAchievement(r) },
  { id:'multi_address', emoji:'🏘️', title:'Мультивласник',  desc:'2+ адреси',                   check:()=>addresses.length>=2 },
  { id:'budget_master', emoji:'🎯', title:'Бюджетник',       desc:'Не перевищили бюджет 3 міс', check:(r)=>checkBudgetAchievement(r) },
  { id:'night_owl',     emoji:'🦉', title:'Нічна сова',      desc:'70%+ нічне споживання',      check:(r)=>checkNightOwl(r) },
];
const ACHIEVEMENT_HINTS = { 'first_record':'Збережіть перший розрахунок','streak_3':'Вносьте показники 3 місяці без пропуску','streak_6':'6 місяців без пропуску','streak_12':'Рік без пропуску','all_paid':'Позначте всі записи як оплачені','records_10':'Накопичте 10+ записів','saver':'Знижуйте суму 3 місяці поспіль','multi_address':'Додайте другу адресу','budget_master':'Не перевищуйте бюджет 3 міс поспіль','night_owl':'Споживайте 70%+ електрики вночі' };

function getStreak(recs) { if(!recs.length) return 0; const sorted=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)); let streak=1; for(let i=0;i<sorted.length-1;i++){const[y1,m1]=sorted[i].month.split('-').map(Number);const[y2,m2]=sorted[i+1].month.split('-').map(Number);if((y1*12+m1)-(y2*12+m2)===1)streak++;else break;} return streak; }
function checkSaverAchievement(recs) { if(recs.length<4) return false; const s=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)); return s[0].total<s[1].total&&s[1].total<s[2].total; }
function checkBudgetAchievement(recs) { const budget=parseFloat(accountStorage.getItem('k_budget'))||0; if(!budget||recs.length<3) return false; const s=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,3); return s.every(r=>r.total<=budget); }
function checkNightOwl(recs) { if(!recs.length) return false; const last=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month))[0]; const n=Math.max(0,(last.nCur||0)-(last.nPrev||0)),d=Math.max(0,(last.dCur||0)-(last.dPrev||0)),t=n+d; return t>0&&(n/t)>=0.7; }
function getUnlockedAchievements() { return ACHIEVEMENTS.filter(a=>a.check(records)); }

function checkNewAchievements() { const unlocked=JSON.parse(accountStorage.getItem('achievements_unlocked')||'[]'); const current=getUnlockedAchievements(); const newOnes=current.filter(a=>!unlocked.includes(a.id)); if(newOnes.length>0){accountStorage.setItem('achievements_unlocked',JSON.stringify(current.map(a=>a.id)));showAchievementUnlock(newOnes[0]);} }
function showAchievementUnlock(ach) { const t=$('achievementToast'); if(!t) return; $('achievementEmoji').textContent=ach.emoji; $('achievementTitle').textContent=ach.title; $('achievementDesc').textContent=ach.desc; t.classList.remove('hidden'); setTimeout(()=>{t.style.transform='translate(-50%,-50%) scale(1)';t.style.opacity='1';},10); haptic('success'); setTimeout(()=>{t.style.transform='translate(-50%,-50%) scale(0)';t.style.opacity='0';setTimeout(()=>t.classList.add('hidden'),400);},3000); }
function renderAchievements() { const container=$('achievementsList'); if(!container) return; const unlocked=getUnlockedAchievements().map(a=>a.id); container.innerHTML=ACHIEVEMENTS.map(a=>`<div class="achievement ${unlocked.includes(a.id)?'':'locked'} flex flex-col items-center gap-1 w-14 text-center cursor-pointer" data-ach-id="${a.id}"><span class="text-2xl">${a.emoji}</span><span class="text-[8px] font-bold text-slate-500 leading-tight">${escapeHtml(a.title)}</span></div>`).join(''); container.querySelectorAll('[data-ach-id]').forEach(el=>{el.addEventListener('click',()=>showAchievementDetail(el.dataset.achId));}); }
function showAchievementDetail(achId) { const ach=ACHIEVEMENTS.find(a=>a.id===achId); if(!ach) return; const isUnlocked=ach.check(records); $('achDetailEmoji').textContent=ach.emoji; $('achDetailTitle').textContent=ach.title; $('achDetailDesc').textContent=ach.desc; $('achDetailHow').textContent=ACHIEVEMENT_HINTS[achId]||'—'; const s=$('achDetailStatus'); if(isUnlocked){s.textContent='✓ Отримано';s.className='text-xs font-bold px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-600';}else{s.textContent='🔒 Заблоковано';s.className='text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400';} $('achievementDetailModal').classList.remove('hidden'); haptic('light'); }

// Keep scroll clearance equal to the real navigation height, including enlarged text.
function updateNavigationInset(){const nav=$('bottomNav');if(!nav)return;const space=window.innerWidth>=1000?36:Math.ceil(nav.getBoundingClientRect().height||86)+16;document.documentElement.style.setProperty('--nav-bottom-space',space+'px');}
if(typeof ResizeObserver==='function')new ResizeObserver(updateNavigationInset).observe($('bottomNav'));
window.addEventListener('resize',updateNavigationInset);updateNavigationInset();

// =================== TABS ===================
const tabIds = ['tabDashboard','tabCalc','tabHistory','tabAnalytics','tabSettings'];
const btnIds = ['btnTabDashboard','btnTabCalc','btnTabHistory','btnTabAnalytics','btnTabSettings'];

function switchTab(tabId, index) {
  if(!saveDraft())return;
  const targetTab=$(tabId);if(!targetTab)return;
  tabIds.forEach(id=>{const tab=$(id);if(tab){tab.classList.toggle('tab-hidden',id!==tabId);tab.classList.toggle('tab-active',id===tabId);tab.classList.remove('tab-exit');}});
  if(tabId!=='tabCalc')$('editingBanner')?.remove();
  if(tabId==='tabDashboard')renderDashboard();
  if(tabId==='tabCalc'){fillPreviousReadings();calculatePreview();updateSmartBadges();}
  if(tabId==='tabHistory')renderRecords();
  if(tabId==='tabAnalytics'){renderAnalytics();renderSubsidyCalc();renderAddressCompare();renderCombinedReport();}
  if(tabId==='tabSettings'){openSettingsPanel();renderSettingsCustomServices();updateDisplayName();renderChangeLog();renderCustomReminders();renderCommunityTariffs();renderDataHealth();loadCloudCommunityTariffs();initPush();}
  btnIds.forEach((id,i)=>{const btn=$(id);if(!btn)return;const selected=i===(tabId==='tabAnalytics'&&window.innerWidth<1000?4:index);btn.setAttribute('aria-current',selected?'page':'false');btn.classList.toggle('text-brand',selected);btn.classList.toggle('text-slate-400',!selected);btn.classList.toggle('dark:text-slate-500',!selected);});
  $('swipeContainer')?.scrollTo({top:0,behavior:'smooth'});haptic('tabSwitch');
}

function launchTabFromLocation(){
  if(window.location.hash==='#calc'&&!isGuest)switchTab('tabCalc',1);
}

$('btnTabDashboard')?.addEventListener('click', ()=>switchTab('tabDashboard',0));
$('btnTabCalc')?.addEventListener('click',      ()=>switchTab('tabCalc',1));
$('btnTabHistory')?.addEventListener('click',   ()=>switchTab('tabHistory',2));
$('btnTabAnalytics')?.addEventListener('click', ()=>switchTab('tabAnalytics',3));
$('btnTabSettings')?.addEventListener('click',  ()=>switchTab('tabSettings',4));
$('dashAddBtn')?.addEventListener('click',runDashboardAction);
$('overviewAnalyticsLink')?.addEventListener('click',()=>switchTab('tabAnalytics',3));
$('dashAnalyticsBtn')?.addEventListener('click',()=>switchTab('tabAnalytics',3));
$('moreAnalyticsBtn')?.addEventListener('click',()=>switchTab('tabAnalytics',3));
$('dashHistoryBtn')?.addEventListener('click', ()=>switchTab('tabHistory',2));
$('emptyAddReadingBtn')?.addEventListener('click',()=>switchTab('tabCalc',1));
window.addEventListener('hashchange',launchTabFromLocation);

let touchStartX=0, touchStartY=0, touchNavigationAllowed=false;
$('swipeContainer')?.addEventListener('touchstart',e=>{touchNavigationAllowed=!e.target.closest('input,select,textarea,button,a,summary,canvas,.swipe-card,.settings-panel');touchStartX=e.changedTouches[0].screenX;touchStartY=e.changedTouches[0].screenY;},{passive:true});
$('swipeContainer')?.addEventListener('touchend',e=>{
  if(isGuest||!touchNavigationAllowed||e.defaultPrevented) return;
  const distX=touchStartX-e.changedTouches[0].screenX, distY=Math.abs(touchStartY-e.changedTouches[0].screenY);
  if(distY>Math.abs(distX)) return;
  const curIdx=tabIds.findIndex(id=>$(id)?.classList.contains('tab-active'));
  if(distX>80&&curIdx<tabIds.length-1) switchTab(tabIds[curIdx+1],curIdx+1);
  else if(distX<-80&&curIdx>0) switchTab(tabIds[curIdx-1],curIdx-1);
},{passive:true});

$('quickActionsBtn')?.addEventListener('click',()=>$('quickActionsModal')?.classList.remove('hidden'));
$('quickActionsModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.add('hidden');});
$('achievementDetailModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.add('hidden');});
$('yearReportModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.add('hidden');});
$('qaExport')?.addEventListener('click',()=>{exportCSV();$('quickActionsModal')?.classList.add('hidden');});
$('qaPdf')?.addEventListener('click',()=>{generatePDF();$('quickActionsModal')?.classList.add('hidden');});
$('qaShare')?.addEventListener('click',()=>{shareAllRecords();$('quickActionsModal')?.classList.add('hidden');});
$('qaSync')?.addEventListener('click',()=>{syncToCloud();$('quickActionsModal')?.classList.add('hidden');});
$('qaImage')?.addEventListener('click',()=>{if(typeof shareAsImage==='function')shareAsImage();$('quickActionsModal')?.classList.add('hidden');});

// =================== CANVAS CHART ENGINE ===================
class ChartEngine {
  constructor(canvasId, options={}) {
    this.canvas=$(canvasId); if(!this.canvas) return;
    this.ctx=this.canvas.getContext('2d');
    const isDarkMode = document.documentElement.classList.contains('dark');
    this.options={padding:40,barRadius:8,animDuration:600,unit:null,colors:{grid:isDarkMode?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)',text:isDarkMode?'#636366':'#8e8e93'},...options};
    this.data=[]; this.animProgress=0; this.tooltip=null; this.width=0; this.height=0; this.interactionBound=false;
    this.setupCanvas(); this.setupInteraction();
  }
  setupCanvas() {
    if(!this.canvas) return;
    const dpr=window.devicePixelRatio||1, rect=this.canvas.getBoundingClientRect();
    if(rect.width===0||rect.height===0) return;
    this.canvas.width=rect.width*dpr; this.canvas.height=rect.height*dpr;
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.width=rect.width; this.height=rect.height;
  }
  setupInteraction() {
    if(!this.canvas||this.interactionBound) return;
    this.interactionBound=true;
    this.canvas.addEventListener('touchstart',e=>this.handleTouch(e),{passive:true});
    this.canvas.addEventListener('mousemove',e=>this.handleHover(e));
    this.canvas.addEventListener('mouseleave',()=>{this.tooltip=null;this.render();});
  }
  handleTouch(e){const rect=this.canvas.getBoundingClientRect();this.findBar(e.touches[0].clientX-rect.left);haptic('light');}
  handleHover(e){const rect=this.canvas.getBoundingClientRect();this.findBar(e.clientX-rect.left);}
  findBar(x) {
    if(!this.data.length) return;
    const barWidth=(this.width-this.options.padding*2)/this.data.length;
    const index=Math.floor((x-this.options.padding)/barWidth);
    this.tooltip=(index>=0&&index<this.data.length)?{index,x:this.options.padding+index*barWidth+barWidth/2}:null;
    this.render();
  }
  setData(data) { this.data=data; if(!this.width||!this.height){this.setupCanvas();if(!this.width||!this.height) return;} this.animate(); }
  animate() { this.animProgress=0; const start=performance.now(); const tick=now=>{this.animProgress=Math.min((now-start)/this.options.animDuration,1);this.animProgress=1-Math.pow(1-this.animProgress,3);this.render();if(this.animProgress<1)requestAnimationFrame(tick);}; requestAnimationFrame(tick); }
  render() {
    if(!this.ctx||!this.width) return;
    const{ctx,width,height,data,options}=this; const{padding,barRadius,colors}=options;
    ctx.clearRect(0,0,width,height);
    if(!data.length){ctx.fillStyle=colors.text;ctx.font='12px -apple-system';ctx.textAlign='center';ctx.fillText('Немає даних',width/2,height/2);return;}
    const chartWidth=width-padding*2,chartHeight=height-padding*1.8,max=Math.max(...data.map(d=>d.value),1),barWidth=chartWidth/data.length,barPad=barWidth*0.25;
    ctx.strokeStyle=colors.grid;ctx.lineWidth=0.5;
    for(let i=0;i<=3;i++){const y=padding/2+(chartHeight/3)*i;ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(width-padding,y);ctx.stroke();}
    data.forEach((d,i)=>{
      const barH=Math.max(2,(d.value/max)*chartHeight*this.animProgress);
      const x=padding+i*barWidth+barPad,y=padding/2+chartHeight-barH,w=barWidth-barPad*2,r=Math.min(barRadius,w/2,barH/2);
      ctx.shadowColor=d.color+'40';ctx.shadowBlur=8;ctx.shadowOffsetY=4;
      ctx.beginPath();ctx.moveTo(x,y+barH);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+barH);ctx.closePath();
      const grad=ctx.createLinearGradient(x,y,x,y+barH);grad.addColorStop(0,d.color);grad.addColorStop(1,d.color+'80');ctx.fillStyle=grad;ctx.fill();
      ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
      ctx.fillStyle=colors.text;ctx.font='bold 9px -apple-system';ctx.textAlign='center';ctx.fillText(d.label,x+w/2,height-6);
    });
    if(this.tooltip&&this.tooltip.index<data.length){
      const d=data[this.tooltip.index];
      const tooltipText=this.options.unit?`${d.value} ${this.options.unit}`:`${fmt.format(d.value)} ₴`;
      ctx.font='bold 11px -apple-system';
      const tw=ctx.measureText(tooltipText).width+16,tx=Math.min(Math.max(this.tooltip.x-tw/2,4),width-tw-4);
      ctx.fillStyle='rgba(0,0,0,0.85)';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(tx,4,tw,22,6);else ctx.rect(tx,4,tw,22);ctx.fill();
      ctx.fillStyle='white';ctx.textAlign='center';ctx.fillText(tooltipText,tx+tw/2,19);
    }
  }
}

class DonutChart {
  constructor(canvasId) { this.canvas=$(canvasId); if(!this.canvas) return; this.ctx=this.canvas.getContext('2d'); this.data=[]; this.animProgress=0; this.width=0; this.height=0; this.setupCanvas(); }
  setupCanvas() { if(!this.canvas) return; const dpr=window.devicePixelRatio||1,rect=this.canvas.getBoundingClientRect(); if(rect.width===0||rect.height===0) return; this.canvas.width=rect.width*dpr;this.canvas.height=rect.height*dpr; this.ctx.setTransform(dpr,0,0,dpr,0,0); this.width=rect.width;this.height=rect.height; }
  setData(data) { this.data=data.filter(d=>d.value>0); if(!this.width||!this.height){this.setupCanvas();if(!this.width||!this.height) return;} this.animate(); }
  animate() { this.animProgress=0; const start=performance.now(); const tick=now=>{this.animProgress=Math.min((now-start)/800,1);this.animProgress=1-Math.pow(1-this.animProgress,3);this.render();if(this.animProgress<1)requestAnimationFrame(tick);}; requestAnimationFrame(tick); }
  render() {
    if(!this.ctx||!this.width) return;
    const{ctx,width,height,data}=this; ctx.clearRect(0,0,width,height); if(!data.length) return;
    const cx=width/2,cy=height/2,radius=Math.min(width,height)/2-8,innerRadius=radius*0.6,total=data.reduce((s,d)=>s+d.value,0);
    let startAngle=-Math.PI/2;
    data.forEach(d=>{ const sliceAngle=(d.value/total)*Math.PI*2*this.animProgress,endAngle=startAngle+sliceAngle; ctx.beginPath();ctx.arc(cx,cy,radius,startAngle,endAngle);ctx.arc(cx,cy,innerRadius,endAngle,startAngle,true);ctx.closePath(); ctx.fillStyle=d.color;ctx.shadowColor=d.color+'30';ctx.shadowBlur=4;ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0; startAngle=endAngle; });
    const totalText=fmt.format(total),fontSize=totalText.length>9?10:totalText.length>7?12:14;
    ctx.fillStyle=document.documentElement.classList.contains('dark')?'#fff':'#1c1c1e';
    ctx.font=`bold ${fontSize}px -apple-system`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(totalText,cx,cy-4);
    ctx.fillStyle='#8e8e93';ctx.font='9px -apple-system';ctx.fillText('₴',cx,cy+10);
  }
}

class SmartForecast {
  constructor(records) {
    this.records = records || [];
    this.sorted = [...this.records].sort((a,b) => a.month.localeCompare(b.month));
  }

  calcTrend() {
    const n = this.sorted.length;
    if (n < 3) return null;
    const x = Array.from({length: n}, (_, i) => i);
    const y = this.sorted.map(r => r.total);
    const sumX = x.reduce((a,b) => a+b, 0);
    const sumY = y.reduce((a,b) => a+b, 0);
    const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
    const sumXX = x.reduce((s, xi) => s + xi * xi, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept, nextValue: slope * n + intercept };
  }

  predict(month) {
    const trend = this.calcTrend();
    if (!trend) return null;
    return {
      predicted: Math.round(Math.max(0, trend.nextValue)),
      trend: Math.round(trend.slope * 100) / 100,
      confidence: this.sorted.length >= 6 ? 'high' : this.sorted.length >= 3 ? 'medium' : 'low',
    };
  }

  detectAnomalies() {
    if (this.sorted.length < 4) return [];
    const values = this.sorted.map(r => r.total);
    const mean = values.reduce((a,b) => a+b, 0) / values.length;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean)**2, 0) / values.length) || 1;
    return this.sorted
      .map((r, i) => ({ ...r, zScore: Math.abs((r.total - mean) / std) }))
      .filter(r => r.zScore > 2)
      .map(r => ({ month: r.month, total: r.total, reason: r.zScore > 3 ? 'Критична' : 'Помірна' }));
  }

  compareYearOverYear(month) {
    const [y, m] = month.split('-').map(Number);
    const lastYear = `${y-1}-${String(m).padStart(2,'0')}`;
    const current = this.sorted.find(r => r.month === month);
    const previous = this.sorted.find(r => r.month === lastYear);
    if (!current || !previous || previous.total === 0) return null;
    return {
      current: current.total,
      previous: previous.total,
      change: Math.round(((current.total - previous.total) / previous.total) * 100),
    };
  }

  getMovingAverage(months = 12) {
    const recent = this.sorted.slice(-months);
    if (!recent.length) return 0;
    return Math.round(recent.reduce((s, r) => s + r.total, 0) / recent.length);
  }
}

let dashChart, historyChart, serviceChart, donutChart, analyticsChart;

function currentAddressSnapshot(){return {id:currentAddressId,name:addresses.find(address=>String(address.id)===String(currentAddressId))?.name||'Мій дім',prefs,records,customServices};}
function openMonthlyEntry(field){
  if(!saveDraft())return;
  $('monthInput').value=getMonthKey();switchTab('tabCalc',1);
  const target=$(field||'monthInput');const detail=target?.closest('.meter-details');if(detail)detail.open=true;target?.scrollIntoView?.({block:'center',behavior:'smooth'});target?.focus({preventScroll:true});
}
function renderMonthlyTasks(){
  const target=$('monthlyTasksList');if(!target)return;
  const month=getMonthKey(),address=currentAddressSnapshot(),input=KomunalkaMonth.readings(address,month),reminders=KomunalkaMonth.reminders(address,activeSettings),rec=input.record;
  const emailServices=KomunalkaProviders.services(address).filter(service=>{try{return service.meter&&Boolean(KomunalkaProviders.emailDraft(address,service,KomunalkaProviders.get(activeSettings,currentAddressId,service.id),month));}catch{return false;}});
  const entryDone=input.total>0&&input.done===input.total,payDone=Boolean(rec&&getOutstandingAmount(rec)===0),transfersDone=reminders.length>0&&reminders.every(r=>r.done);
  const missing=input.services.filter(s=>!s.done).map(s=>s.label);
  const readingText=input.total?`${input.done} з ${input.total} послуг внесено${missing.length?' · Залишилось: '+missing.join(', '):''}`:'Виберіть послуги в налаштуваннях';
  const paymentText=!rec?'Спочатку внесіть показники':rec.total===0?'За цей місяць немає нарахувань':payDone?'Оплату позначено в застосунку':`Залишилось ${fmt.format(getOutstandingAmount(rec))} ₴${getPaidAmount(rec)>0?' · частково сплачено':''}`;
  const period=rem=>{const f=date=>new Date(date).toLocaleDateString('uk-UA',{day:'numeric',month:'short',timeZone:'UTC'});return `${f(rem.start)} — ${f(rem.end)}`;};
  const row=(id,icon,title,subtitle,done,button)=>`<div class="month-task ${done?'task-done':''}" data-month-task="${id}"><span class="task-icon" aria-hidden="true"><i class="fa-solid ${done?'fa-check':icon}"></i></span><div class="task-copy"><h4>${title}</h4><p>${escapeHtml(subtitle)}</p></div>${button}</div>`;
  const action=(id,label,disabled=false)=>`<button type="button" class="task-action" data-month-action="${id}" ${disabled?'disabled':''}>${label}</button>`;
  target.innerHTML=row('readings','fa-pen-to-square','Показники',readingText,entryDone,action(input.total?'readings':'settings',input.total?(entryDone?'Переглянути':'Внести'):'Обрати'))+
    `<details class="monthly-transfers"><summary>${row('transfer','fa-paper-plane','Передача постачальникам',reminders.length?`${reminders.filter(r=>r.done).length} з ${reminders.length} позначено виконаними`:'Налаштуйте дні передачі показників',transfersDone,'<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>')}</summary><div class="transfer-list">${reminders.length?reminders.map((r,i)=>`<div class="transfer-item"><div><strong>${escapeHtml(r.label)}</strong><p>${escapeHtml(period(r))}${r.done?' · Виконано':r.overdue?' · Період минув':''}</p></div><button type="button" class="task-action" data-transfer-index="${i}" ${!canEditData()||(!r.available&&!r.done)?'disabled':''}>${r.done?'Скасувати':r.available?'Виконано':'Ще не час'}</button></div>`).join(''):action('reminders','Налаштувати нагадування')}${emailServices.map(service=>`<button type="button" class="task-action transfer-email-action" data-email-service="${escapeAttr(service.id)}"><i class="fa-solid fa-envelope" aria-hidden="true"></i> Лист: ${escapeHtml(service.label)}</button>`).join('')}${action('providers','Постачальники та кабінети')}<p class="task-note">Позначайте виконання після передачі показників у кабінеті постачальника.</p></div></details>`+
    row('payment','fa-wallet','Оплата',paymentText,payDone,action('payment',payDone?'Переглянути':'Позначити оплату',!rec));
  $('monthlyTasksCount').textContent=`${Number(entryDone)+Number(transfersDone)+Number(payDone)} / ${2+Number(reminders.length>0)}`;
  target.querySelectorAll('[data-month-action]').forEach(button=>button.addEventListener('click',()=>{if(['settings','reminders','providers'].includes(button.dataset.monthAction)){switchTab('tabSettings',4);if(button.dataset.monthAction==='providers')$('providerMonth').value=getMonthKey();openSettingsPanel(button.dataset.monthAction==='settings'?'home':button.dataset.monthAction);return;}openMonthlyEntry(button.dataset.monthAction==='payment'?'paymentStatusInput':({water:'wCur',hotWater:'hwCur',electro:'dCur',gas:'gCur'}[input.services.find(s=>!s.done)?.id]||'monthInput'));}));
  target.querySelectorAll('[data-transfer-index]').forEach(button=>button.addEventListener('click',()=>{
    if(!requireEdit())return;const reminder=reminders[Number(button.dataset.transferIndex)];if(!reminder||(!reminder.available&&!reminder.done))return;
    prefs.reminderCompletions={...prefs.reminderCompletions};if(reminder.done)delete prefs.reminderCompletions[reminder.id];else prefs.reminderCompletions[reminder.id]=reminder.cycle;
    debouncedSync();checkReminders();renderMonthlyTasks();$('monthlyTasksList').querySelector('details').open=true;showToast(reminder.done?'Позначку скасовано':'Виконання збережено','✓');
  }));
  target.querySelectorAll('[data-email-service]').forEach(button=>button.addEventListener('click',()=>openProviderEmail(button.dataset.emailService,month)));
  $('dashMonthStatus').textContent=rec?(entryDone?'Показники за місяць внесено':'Місяць заповнено частково'):'За цей місяць ще немає запису';
  $('dashMonthStatus').classList.toggle('hidden',entryDone);
  const next=!entryDone?'readings':reminders.some(r=>r.available&&!r.done)?'transfer':!payDone?'payment':'review';
  $('dashAddBtn').dataset.action=next;
  const label=$('dashAddBtn').querySelector('span');if(label)label.textContent=({readings:rec?'Продовжити показники':'Внести показники',transfer:'Передати показники',payment:'Позначити оплату',review:'Переглянути показники'})[next];
  $('dashboardActionHint').textContent=({readings:'Попередні значення вже підтягуються з історії',transfer:'Відкрийте список послуг і позначте передані',payment:'Збережіть оплату у своєму обліку',review:reminders.some(r=>!r.done)?'Показники внесено й оплату позначено':'Справи за місяць виконано'})[next];
}
function renderEntryReview(valid=validateReadingsUI()){
  if(!$('entryReviewTotal'))return;
  const month=$('monthInput')?.value,historic=records.find(r=>r.month===month),t=historic?.tariffSnapshot?{...tariffs,...historic.tariffSnapshot}:tariffs;
  const base=[['Вода','waterCost',prefs.showWater],['Гаряча вода','hotWaterCost',prefs.showHotWater],['Світло','electroCost',prefs.showElectro],['Газ','gasCost',prefs.showGas],['Інші послуги','customCost',customServices.length>0]].filter(([,key,enabled])=>enabled||Number(currentCalc[key])>0);
  const paid=getPaymentInputData().paidAmount;
  $('entryReviewMonth').textContent=/^\d{4}-\d{2}$/.test(month)?new Date(month+'-01T12:00:00').toLocaleDateString('uk-UA',{month:'long',year:'numeric'}):'';
  $('entryReviewStatus').textContent=!valid?'Поточні показники мають бути не меншими за попередні.':historic?'Ви оновлюєте наявний запис. Історичні суми зберігаються для незмінених показників.':'Можна зберегти частину послуг, а решту додати пізніше.';
  $('entryReviewStatus').classList.toggle('review-error',!valid);
  $('entryReviewLines').innerHTML=valid?base.map(([label,key])=>`<div class="review-line"><span>${label}</span><strong>${fmt.format(currentCalc[key]||0)} ₴</strong></div>`).join(''):'';
  for(const [id,value] of [['entryReviewTotal',currentCalc.total],['entryReviewPaid',paid],['entryReviewBalance',Math.max(0,currentCalc.total-paid)]])$(id).textContent=valid?fmt.format(value)+' ₴':'—';
  const rate=(id,text)=>{if($(id))$(id).textContent=historic&&!historic.tariffSnapshot?'Тариф старого запису не збережено. Незмінені показники зберігають історичну суму.':text;};
  rate('blockWaterRate',`Тариф: ${fmt.format(t.water)} ₴ / м³`);rate('blockHotWaterRate',`Тариф: ${fmt.format(t.hotWater)} ₴ / м³`);rate('blockGasRate',`Тариф: ${fmt.format(t.gas)} ₴ / м³`);
  rate('blockElectroRate',prefs.electroWinter&&$('isWinterInput')?.checked?`До ${t.winterLimit} кВт·год: ${fmt.format(t.electroWinter)} ₴; понад ліміт: ${fmt.format(t.electroBase)} ₴.${prefs.electroTwoZone?' Нічний коефіцієнт: '+t.nightCoef+'.':''}`:`День: ${fmt.format(t.electroBase)} ₴ / кВт·год${prefs.electroTwoZone?' · Ніч: '+fmt.format(t.electroBase*t.nightCoef)+' ₴ / кВт·год':''}`);
}

// =================== DASHBOARD ===================
function renderDashboard() {
  const hour=new Date().getHours();
  let greeting='Доброго дня!'; if(hour<6) greeting='Доброї ночі!'; else if(hour<12) greeting='Доброго ранку!'; else if(hour>=18) greeting='Доброго вечора!';
  if($('dashGreeting')) $('dashGreeting').textContent = displayName ? `${greeting.replace('!',',')} ${displayName.split(' ')[0]}!` : greeting;
  if(records.length===0){$('dashEmptyState')?.classList.remove('hidden');}else{$('dashEmptyState')?.classList.add('hidden');}
  const curMonth=getMonthKey();
  if($('dashMonthLabel')) $('dashMonthLabel').textContent=new Date(curMonth+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'});
  const streak=getStreak(records); if($('streakValue')) $('streakValue').textContent=streak; renderStreakDots(streak);
  const curRec=records.find(r=>r.month===curMonth); if(curRec)animateNumber($('dashCurrentMonth'),curRec.total);else if($('dashCurrentMonth'))$('dashCurrentMonth').textContent='—';
  if($('dashBalance'))$('dashBalance').textContent=curRec?fmt.format(getOutstandingAmount(curRec))+' ₴':'—';
  if($('dashPaid'))$('dashPaid').textContent=curRec?fmt.format(getPaidAmount(curRec))+' ₴':'—';
  if($('dashServices')){
    const services=[['Електрика',curRec?.electroCost],['Вода',curRec?.waterCost],['Гаряча вода',curRec?.hotWaterCost],['Газ',curRec?.gasCost],['Інші послуги',curRec?.customCost]].filter(([,cost])=>cost>0);
    $('dashServices').innerHTML=services.length?services.map(([name,cost])=>`<div class="service-line"><span>${name}</span><span>${fmt.format(cost)} ₴</span></div>`).join(''):'<p class="py-4 text-slate-500">За цей місяць показники ще не внесені.</p>';
  }
  if($('dashRecordsCount')) $('dashRecordsCount').textContent=records.length;
  if(records.length>0){const avg=records.reduce((s,r)=>s+r.total,0)/records.length;if($('dashAvg'))$('dashAvg').textContent=fmt.format(avg)+' ₴';}else{if($('dashAvg'))$('dashAvg').textContent='0 ₴';}
  const unpaid=records.filter(r=>getOutstandingAmount(r)>0),otherUnpaid=unpaid.filter(r=>r.month!==curMonth),debtTotal=otherUnpaid.reduce((s,r)=>s+getOutstandingAmount(r),0);
  if(unpaid.length>0){$('dashDebtCard')?.classList.remove('hidden');animateNumber($('dashDebt'),debtTotal);if($('dashDebtMonths'))$('dashDebtMonths').textContent=`${otherUnpaid.length} міс. з неоплаченим залишком`;$('debtBadge')?.classList.remove('hidden');if($('debtBadge'))$('debtBadge').textContent=unpaid.length;}
  else{$('dashDebtCard')?.classList.add('hidden');$('debtBadge')?.classList.add('hidden');}
  $('dashDebtCard')?.classList.toggle('hidden',otherUnpaid.length===0);
  renderMonthlyTasks();
  renderDashCanvasChart(); renderBudgetProgress(curRec); renderDonutChart(curRec); renderSmartInsight(curRec,curMonth); renderMonthMiniWidget(curRec,curMonth); renderAchievements(); renderTips();
  const unlocked=getUnlockedAchievements().length; if($('achCounter'))$('achCounter').textContent=`${unlocked}/${ACHIEVEMENTS.length}`;
  checkReminders();
}

function isDayInRange(day, start, end) {
  return start <= end ? day >= start && day <= end : day >= start || day <= end;
}

function getNextDeadlineLabel(){
  if(!prefs.remindersEnabled)return 'Нагадування вимкнені';
  const due=currentReminderItems();if(due.length)return 'Зараз: '+due.map(r=>`${r.emoji||'🔔'} ${r.label}`).join(', ');
  const today=new Date();for(let days=1;days<=62;days++){const date=new Date(+today+days*86400000);const next=KomunalkaReminders.due({id:currentAddressId,prefs},activeSettings,date);if(next.length)return `${next[0].emoji||'🔔'} ${next[0].label}: `+date.toLocaleDateString('uk-UA',{timeZone:'Europe/Kyiv',day:'numeric',month:'short'});}
  return 'Активних нагадувань немає';
}

function renderMonthMiniWidget(curRec, curMonth) {
  if (!$('monthMiniWidget')) return;
  const debt = records.reduce((sum, rec) => sum + getOutstandingAmount(rec), 0);
  if ($('miniDebt')) $('miniDebt').textContent = fmt.format(debt) + ' ₴';
  if ($('miniDeadline')) $('miniDeadline').textContent = getNextDeadlineLabel();
  let forecast = curRec?.total || 0;
  if (!forecast) {
    const prediction = new SmartForecast(records).predict(curMonth);
    forecast = prediction?.predicted || (records.length ? records.slice(-3).reduce((sum, rec)=>sum + rec.total, 0) / Math.min(3, records.length) : 0);
  }
  if ($('miniForecast')) $('miniForecast').textContent = fmt.format(forecast) + ' ₴';
}

function renderBudgetProgress(curRec) {
  const budgetEl=$('budgetProgressCard'); if(!budgetEl) return;
  const budget=parseFloat(accountStorage.getItem('k_budget'))||0;
  if(!budget){budgetEl.classList.add('hidden');return;} budgetEl.classList.remove('hidden');
  const spent=curRec?curRec.total:0,percent=Math.min((spent/budget)*100,100),remaining=Math.max(budget-spent,0),isOver=spent>budget;
  if($('budgetSpent'))$('budgetSpent').textContent=fmt.format(spent);
  if($('budgetLimit'))$('budgetLimit').textContent=fmt.format(budget);
  if($('budgetRemaining')){$('budgetRemaining').textContent=isOver?`Перевищено на ${fmt.format(spent-budget)} ₴`:`Залишок: ${fmt.format(remaining)} ₴`;$('budgetRemaining').className=`text-[10px] font-bold ${isOver?'text-red-500':'text-green-600'}`;}
  const bar=$('budgetBar');
  if(bar){bar.style.width=`${percent}%`;bar.className=`h-full rounded-full transition-all duration-700 ${isOver?'bg-gradient-to-r from-red-400 to-red-600':percent>80?'bg-gradient-to-r from-orange-400 to-orange-500':'bg-gradient-to-r from-brand to-blue-500'}`;}
  if($('budgetPercent'))$('budgetPercent').textContent=`${Math.round(percent)}%`;
}

function renderDonutChart(curRec) {
  if(!$('donutCanvas')) return;
  if(!donutChart) donutChart=new DonutChart('donutCanvas');
  if(!curRec||curRec.total===0){if(donutChart.ctx&&donutChart.width)donutChart.ctx.clearRect(0,0,donutChart.width,donutChart.height);const legend=$('donutLegend');if(legend)legend.innerHTML='<span class="text-[9px] text-slate-400">Немає даних</span>';return;}
  const data=[];
  if(curRec.waterCost>0)    data.push({value:curRec.waterCost,   color:'#3b82f6',label:'Вода'});
  if(curRec.hotWaterCost>0) data.push({value:curRec.hotWaterCost,color:'#ef4444',label:'Гар.'});
  if(curRec.electroCost>0)  data.push({value:curRec.electroCost, color:'#eab308',label:'Світло'});
  if(curRec.gasCost>0)      data.push({value:curRec.gasCost,     color:'#f97316',label:'Газ'});
  if(curRec.customCost>0)   data.push({value:curRec.customCost,  color:'#a855f7',label:'Інше'});
  donutChart.setData(data);
  const legend=$('donutLegend');
  if(legend) legend.innerHTML=data.map(d=>`<div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:${d.color}"></div><span class="text-[9px] font-bold text-slate-500">${d.label}</span></div>`).join('');
}

function renderDashCanvasChart() {
  if(!$('dashChartCanvas')) return;
  if(!dashChart) dashChart=new ChartEngine('dashChartCanvas',{padding:24,barRadius:6});
  const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,8).reverse();
  dashChart.setData(sorted.map(r=>({value:r.total,label:new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short'}).slice(0,3),color:isRecordPaid(r)?'#007aff':getPaymentStatus(r)==='partial'?'#ffcc00':'#ff9500'})));
}

function renderSmartInsight(curRec,curMonth) {
  const insightEl=$('dashInsight'),textEl=$('dashInsightText'); if(!insightEl||!textEl) return;
  if(records.length<2){insightEl.classList.add('hidden');return;}
  const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month));
  const[sy,sm]=curMonth.split('-').map(Number);
  const prevDate=new Date(sy,sm-2),prevMonth=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
  const prevRec=sorted.find(r=>r.month===prevMonth);
  let insight='';
  if(curRec&&prevRec&&prevRec.total>0){const diff=Math.round(((curRec.total-prevRec.total)/prevRec.total)*100);if(diff<-10)insight=`Зекономили ${Math.abs(diff)}% vs ${new Date(prevMonth+'-01').toLocaleString('uk-UA',{month:'long'})} 🎉`;else if(diff>15)insight=`Витрати +${diff}% порівняно з минулим місяцем`;else if(diff>=-10&&diff<=5)insight=`Витрати стабільні — чудово! 👍`;}
  if(!insight&&records.length>=3){const avg=sorted.slice(0,3).reduce((s,r)=>s+r.total,0)/3;insight=`Середні за 3 міс: ${fmt.format(avg)} ₴`;}
  if(!insight){const str=getStreak(records);if(str>=3)insight=`Серія ${str} міс. — так тримати! 🔥`;}
  if(insight){insightEl.classList.remove('hidden');textEl.textContent=insight;}else{insightEl.classList.add('hidden');}
}

function renderStreakDots(streak) { const container=$('streakDots'); if(!container) return; let html=''; for(let i=0;i<6;i++) html+=`<div class="streak-dot ${i<streak?'active':'inactive'} ${i===0?'today':''}"></div>`; container.innerHTML=html; }

function animateNumber(el,target) {
  if(!el) return;
  const current=parseFloat(el.textContent.replace(/[^\d.,]/g,'').replace(',','.'))||0;
  if(Math.abs(current-target)<0.01){el.textContent=fmt.format(target)+' ₴';return;}
  const duration=400,start=performance.now(),from=current;
  function tick(now){const elapsed=now-start,progress=Math.min(elapsed/duration,1),eased=1-Math.pow(1-progress,3);el.textContent=fmt.format(from+(target-from)*eased)+' ₴';if(progress<1)requestAnimationFrame(tick);}
  requestAnimationFrame(tick);
}

// =================== CALCULATION ===================
const readingInputIds=['wPrev','wCur','hwPrev','hwCur','dPrev','dCur','nPrev','nCur','gPrev','gCur'];
function getV(id){return Math.max(0,parseFloat($(id)?.value)||0);}

let calcDebounceTimer;
function debouncedCalculate(){clearTimeout(calcDebounceTimer);calcDebounceTimer=setTimeout(()=>{calculatePreview();updateSmartBadges();},150);}

function calculatePreview() {
  const historic=records.find(r=>r.month===$('monthInput')?.value);
  const calculationTariffs=historic?.tariffSnapshot?{...tariffs,...historic.tariffSnapshot}:tariffs;
  if(prefs.showWater)    currentCalc.waterCost   =Math.max(0,getV('wCur')-getV('wPrev'))*calculationTariffs.water;    else currentCalc.waterCost=0;
  if(prefs.showHotWater) currentCalc.hotWaterCost=Math.max(0,getV('hwCur')-getV('hwPrev'))*calculationTariffs.hotWater; else currentCalc.hotWaterCost=0;
  if(prefs.showElectro){
    const dV=Math.max(0,getV('dCur')-getV('dPrev')),nV=prefs.electroTwoZone?Math.max(0,getV('nCur')-getV('nPrev')):Math.max(0,Number(historic?.nCur||0)-Number(historic?.nPrev||0)),tEl=dV+nV;
    if(tEl===0) currentCalc.electroCost=0;
    else if(prefs.electroWinter&&$('isWinterInput')?.checked){
      if(tEl<=calculationTariffs.winterLimit) currentCalc.electroCost=dV*calculationTariffs.electroWinter+nV*calculationTariffs.electroWinter*calculationTariffs.nightCoef;
      else{const dp=dV/tEl,np=nV/tEl;currentCalc.electroCost=calculationTariffs.winterLimit*dp*calculationTariffs.electroWinter+calculationTariffs.winterLimit*np*calculationTariffs.electroWinter*calculationTariffs.nightCoef+(tEl-calculationTariffs.winterLimit)*dp*calculationTariffs.electroBase+(tEl-calculationTariffs.winterLimit)*np*calculationTariffs.electroBase*calculationTariffs.nightCoef;}
    } else currentCalc.electroCost=dV*calculationTariffs.electroBase+nV*calculationTariffs.electroBase*calculationTariffs.nightCoef;
  } else currentCalc.electroCost=0;
  if(prefs.showGas) currentCalc.gasCost=Math.max(0,getV('gCur')-getV('gPrev'))*calculationTariffs.gas; else currentCalc.gasCost=0;
  currentCalc.customCost=0;
  customServices.forEach(srv=>{let val=parseFloat($(`custom_${srv.id}`)?.value);if(isNaN(val)&&srv.defaultSum)val=parseFloat(srv.defaultSum);if(!isNaN(val))currentCalc.customCost+=val;});
  if(historic){
    for(const [key,enabled] of [['waterCost',prefs.showWater],['hotWaterCost',prefs.showHotWater],['electroCost',prefs.showElectro],['gasCost',prefs.showGas]])if(!enabled)currentCalc[key]=Number(historic[key]||0);
    currentCalc.customCost+=Object.entries(historic.customData||{}).filter(([id])=>!customServices.some(s=>String(s.id)===id)).reduce((sum,[,s])=>sum+Number(s.val||0),0);
    const unchanged=ids=>ids.every(id=>Number(historic[id]??0)===(['nPrev','nCur'].includes(id)&&!prefs.electroTwoZone?Number(historic[id]||0):getV(id)));
    for(const [key,ids] of [['waterCost',['wPrev','wCur']],['hotWaterCost',['hwPrev','hwCur']],['gasCost',['gPrev','gCur']]])if(unchanged(ids)&&historic[key]!=null)currentCalc[key]=Number(historic[key]);
    const season=historic.isWinter??([10,11,12,1,2,3,4].includes(Number(historic.month.slice(5))));
    if(unchanged(['dPrev','dCur','nPrev','nCur'])&&season===Boolean($('isWinterInput')?.checked)&&historic.electroCost!=null)currentCalc.electroCost=Number(historic.electroCost);
    if(customServices.every(srv=>Number(historic.customData?.[srv.id]?.val??0)===Number($(`custom_${srv.id}`)?.value||srv.defaultSum||0))&&historic.customCost!=null)currentCalc.customCost=Number(historic.customCost);
  }
  currentCalc.total=currentCalc.waterCost+currentCalc.hotWaterCost+currentCalc.electroCost+currentCalc.gasCost+currentCalc.customCost;
  if(historic&&['waterCost','hotWaterCost','electroCost','gasCost','customCost'].every(key=>currentCalc[key]===Number(historic[key]??0)))currentCalc.total=historic.total;
  currentCalc.total=Math.round(currentCalc.total*100)/100;
  if(!validateReadingsUI()){renderEntryReview(false);renderEntryProgress();return;}
  if($('heroTotal')) $('heroTotal').innerHTML=`${fmt.format(currentCalc.total)} <span class="text-2xl font-bold text-white/40">₴</span>`;
  if($('waterCostDisplay'))    $('waterCostDisplay').innerText   =fmt.format(currentCalc.waterCost)+' ₴';
  if($('hotWaterCostDisplay')) $('hotWaterCostDisplay').innerText=fmt.format(currentCalc.hotWaterCost)+' ₴';
  if($('electroCostDisplay'))  $('electroCostDisplay').innerText =fmt.format(currentCalc.electroCost)+' ₴';
  if($('gasCostDisplay'))      $('gasCostDisplay').innerText     =fmt.format(currentCalc.gasCost)+' ₴';
  if($('customCostDisplay'))   $('customCostDisplay').innerText  =fmt.format(currentCalc.customCost)+' ₴';
  updateMonthComparison(); updateSmartForecast(); updatePartialIndicator();renderEntryReview();renderEntryProgress();
}

function validateReadingsUI() {
  const pairs=[['wPrev','wCur',prefs.showWater],['hwPrev','hwCur',prefs.showHotWater],['dPrev','dCur',prefs.showElectro],['nPrev','nCur',prefs.showElectro&&prefs.electroTwoZone],['gPrev','gCur',prefs.showGas]];
  let hasInvalid=false;
  pairs.forEach(([prevId,curId,enabled])=>{
    const prevEl=$(prevId),curEl=$(curId);
    if(!prevEl||!curEl)return;if(!enabled){prevEl.classList.remove('input-invalid');curEl.classList.remove('input-invalid');curEl.setAttribute('aria-invalid','false');return;}
    const invalid=prevEl.validity.badInput||curEl.validity.badInput||(prevEl.value!==''&&Number(prevEl.value)<0)||(curEl.value!==''&&(Number(curEl.value)<0||(prevEl.value!==''&&Number(curEl.value)<Number(prevEl.value))));
    prevEl.classList.toggle('input-invalid',invalid);curEl.classList.toggle('input-invalid',invalid);curEl.setAttribute('aria-invalid',String(invalid));
    if(invalid) hasInvalid=true;
  });
  const btn=$('submitFormBtn');
  if(btn){btn.disabled=hasInvalid||!canEditData();btn.classList.toggle('opacity-60',hasInvalid);}
  if(hasInvalid&&$('heroTotal')) $('heroTotal').innerHTML=`<span class="text-lg text-red-300">Перевірте показники</span>`;
  return !hasInvalid;
}

function updatePartialIndicator(){const w=$('partialWater'),e=$('partialElectro'),g=$('partialGas');if(w)w.className=`partial-dot ${(getV('wCur')>0||getV('hwCur')>0)?'filled':'empty'}`;if(e)e.className=`partial-dot ${getV('dCur')>0?'filled':'empty'}`;if(g)g.className=`partial-dot ${getV('gCur')>0?'filled':'empty'}`;}

function updateSmartBadges(){
  const update=(prevId,curId,badgeId,unit,color,activeBg)=>{const badge=$(badgeId);if(!badge)return;const d=getV(curId)-getV(prevId);badge.innerText=d>0?`+${d} ${unit}`:`0 ${unit}`;badge.className=d>0?`absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 z-10 ${activeBg} ${color} shadow-md px-2.5 py-1.5 rounded-xl text-[11px] font-bold`:'absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 z-10 bg-white dark:bg-apple-dark shadow-md border border-slate-100 dark:border-white/10 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-slate-400';};
  if(prefs.showWater)    update('wPrev','wCur','wDiffBadge','м³','text-blue-600','bg-blue-100 dark:bg-blue-500/20');
  if(prefs.showHotWater) update('hwPrev','hwCur','hwDiffBadge','м³','text-red-600','bg-red-100 dark:bg-red-500/20');
  if(prefs.showElectro)  {update('dPrev','dCur','dDiffBadge','кВт','text-yellow-600','bg-yellow-100 dark:bg-yellow-500/20');if(prefs.electroTwoZone)update('nPrev','nCur','nDiffBadge','кВт','text-indigo-500','bg-indigo-100 dark:bg-indigo-500/20');}
  if(prefs.showGas)      update('gPrev','gCur','gDiffBadge','м³','text-orange-500','bg-orange-100 dark:bg-orange-500/20');
}

function updateMonthComparison(){const comp=$('monthComparison');if(!comp)return;if(records.length===0||currentCalc.total===0){comp.classList.add('hidden');return;}const selectedMonth=$('monthInput')?.value;if(!selectedMonth){comp.classList.add('hidden');return;}const[sy,sm]=selectedMonth.split('-').map(Number);const prevDate=new Date(sy,sm-2),prevMonth=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;const prevRec=records.find(r=>r.month===prevMonth);if(!prevRec||prevRec.total===0){comp.classList.add('hidden');return;}const diff=((currentCalc.total-prevRec.total)/prevRec.total)*100;comp.classList.remove('hidden');if($('comparisonIcon'))$('comparisonIcon').className=diff<0?'fa-solid fa-arrow-trend-down':'fa-solid fa-arrow-trend-up';if($('comparisonText'))$('comparisonText').textContent=`${diff>0?'+':''}${Math.round(diff)}% vs ${new Date(prevMonth+'-01').toLocaleString('uk-UA',{month:'short'})}`;comp.style.color=diff<0?'#34c759':diff>5?'#ff3b30':'#8e8e93';}

function updateSmartForecast(){const el=$('smartForecast');if(!el) return;if(!records||records.length===0){el.innerText='—';return;}const selectedMonth=$('monthInput')?.value;if(!selectedMonth){el.innerText='—';return;}const[,sm]=selectedMonth.split('-').map(Number);const sameMonth=records.filter(r=>{const[,rm]=r.month.split('-').map(Number);return rm===sm;});if(sameMonth.length>0){el.innerText=`~ ${fmt.format(sameMonth.reduce((s,r)=>s+r.total,0)/sameMonth.length)} ₴`;return;}const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month));el.innerText=`~ ${fmt.format(sorted.slice(0,3).reduce((s,r)=>s+r.total,0)/Math.min(3,sorted.length))} ₴`;}

function getSaveAnomalyWarning(total, month) {
  const previous = records.filter(r => r.month !== month && r.total > 0);
  if (previous.length < 3 || total <= 0) return '';
  const recent = [...previous].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,6);
  const avg = recent.reduce((s,r)=>s+r.total,0) / recent.length;
  if (avg > 0 && total > avg * 1.7) return `Сума ${fmt.format(total)} ₴ значно вища за середні ${fmt.format(avg)} ₴. Все одно зберегти?`;
  if (avg > 0 && total < avg * 0.35) return `Сума ${fmt.format(total)} ₴ значно нижча за середні ${fmt.format(avg)} ₴. Все одно зберегти?`;
  return '';
}

function getPaymentInputData(total = currentCalc.total) {
  const status = $('paymentStatusInput')?.value || 'charged';
  const paidAmount = status === 'paid' ? total : status === 'partial' ? clampMoney($('paidAmountInput')?.value, total) : 0;
  return { paymentStatus: status === 'paid' || status === 'partial' ? status : 'charged', paidAmount, paid: status === 'paid' };
}

function setPaymentInputsFromRecord(rec = null) {
  const status = rec ? getPaymentStatus(rec) : 'charged';
  if ($('paymentStatusInput')) $('paymentStatusInput').value = status;
  if ($('paidAmountInput')) {
    $('paidAmountInput').value = status === 'partial' ? getPaidAmount(rec).toFixed(2) : '';
    $('paidAmountInput').style.display = status === 'partial' ? 'block' : 'none';
  }
}

readingInputIds.forEach(id=>{const el=$(id);if(el) el.addEventListener('input',debouncedCalculate);});
$('paymentStatusInput')?.addEventListener('change',()=>{if($('paidAmountInput')){$('paidAmountInput').style.display=$('paymentStatusInput').value==='partial'?'block':'none';if($('paymentStatusInput').value!=='partial')$('paidAmountInput').value='';}renderEntryReview();});
$('paidAmountInput')?.addEventListener('input',()=>renderEntryReview());
$('isWinterInput')?.addEventListener('change',calculatePreview);
$('monthInput')?.addEventListener('change',()=>{if(!saveDraft())return;fillPreviousReadings();calculatePreview();updateSmartBadges();});
if($('monthInput')) $('monthInput').value=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

// =================== DRAFT ===================
const DRAFT_KEY='komunalka_draft';
function saveDraft(){
  if(!activeStore||isGuest||!draftContext||!draftDirty)return true;
  try{
    const draft={month:draftContext.month,isWinter:$('isWinterInput')?.checked,paymentStatus:$('paymentStatusInput')?.value,paidAmount:$('paidAmountInput')?.value,note:$('recordNote')?.value||''};
    readingInputIds.forEach(id=>{if($(id))draft[id]=$(id).value;});
    customServices.forEach(srv=>{if($(`custom_${srv.id}`))draft[`custom_${srv.id}`]=$(`custom_${srv.id}`).value;});
    activeStore.saveDraft(draftContext.address,draftContext.month,draft);draftDirty=false;
    if($('draftStatus'))$('draftStatus').textContent='Чернетку збережено на пристрої';return true;
  }catch(e){if($('draftStatus'))$('draftStatus').textContent='Не вдалося зберегти чернетку. Не закривайте сторінку.';return false;}
}
function loadDraft(){
  draftContext={address:currentAddressId,month:$('monthInput')?.value};draftDirty=false;
  if(!activeStore||!draftContext.month||isGuest)return;
  try{
    let draft=activeStore.draft(currentAddressId,draftContext.month);
    const marker=`${activeStore.key}:legacy-draft-checked`;
    if(!localStorage.getItem(marker)&&initialDeviceLogin===activeStore.owner){
      const raw=localStorage.getItem(DRAFT_KEY);const legacy=raw?JSON.parse(raw):null;
      const previous=localStorage.getItem(LOCAL_BACKUP_KEY);const backup=previous?JSON.parse(previous):null;
      if(legacy?.month&&String(backup?.currentAddressId)===String(currentAddressId)){
        if(!activeStore.draft(currentAddressId,legacy.month))activeStore.saveDraft(currentAddressId,legacy.month,legacy);
        if(legacy.month===draftContext.month&&!draft)draft=legacy;
      }
      localStorage.setItem(marker,'1');
    }
    if(!draft){if($('draftStatus'))$('draftStatus').textContent='Попередні показники підтягуються з історії';return;}
    readingInputIds.forEach(id=>{if($(id)&&draft[id]!==undefined)$(id).value=draft[id];});
    customServices.forEach(srv=>{const id=`custom_${srv.id}`;if($(id)&&draft[id]!==undefined)$(id).value=draft[id];});
    if($('recordNote'))$('recordNote').value=draft.note??'';
    if($('isWinterInput')&&draft.isWinter!==undefined)$('isWinterInput').checked=draft.isWinter;
    if(draft.paymentStatus&&$('paymentStatusInput'))$('paymentStatusInput').value=draft.paymentStatus;
    if(draft.paidAmount!==undefined&&$('paidAmountInput'))$('paidAmountInput').value=draft.paidAmount;
    if($('paidAmountInput'))$('paidAmountInput').style.display=$('paymentStatusInput')?.value==='partial'?'block':'none';
    if($('draftStatus'))$('draftStatus').textContent='Відновлено вашу чернетку';
  }catch(e){if($('draftStatus'))$('draftStatus').textContent='Чернетка потребує перевірки. Оригінал збережено.';}
}
function clearDraft(){if(activeStore&&draftContext)activeStore.clearDraft(draftContext.address,draftContext.month);draftDirty=false;}
function debouncedDraft(){draftDirty=true;saveDraft();}
document.addEventListener('input',e=>{if(e.target.closest('#utilityForm'))debouncedDraft();});
document.addEventListener('change',e=>{if(e.target.closest('#utilityForm')||e.target.id==='isWinterInput')debouncedDraft();});
window.addEventListener('pagehide',()=>{saveDraft();if(activeStore){syncCurrentAddress();saveToLocal();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveDraft();});

// =================== FORM SUBMIT ===================
$('utilityForm')?.addEventListener('submit',(e)=>{
  e.preventDefault();
  if(!requireEdit('У режимі перегляду не можна зберігати записи'))return;
  calculatePreview();
  if(!validateReadingsUI()){showToast('Перевірте показники','⚠️');return;}
  const entered=id=>$(id)?.value.trim()!=='';
  const hasWater   =prefs.showWater   &&entered('wCur');
  const hasHotWater=prefs.showHotWater&&entered('hwCur');
  const hasElectro =prefs.showElectro &&(entered('dCur')||(prefs.electroTwoZone&&entered('nCur')));
  const hasGas     =prefs.showGas     &&entered('gCur');
  const hasCustom  =customServices.some(srv=>{const v=parseFloat($(`custom_${srv.id}`)?.value);return !isNaN(v)&&v>0;});
  if(!records.some(r=>r.month===$('monthInput').value)&&!hasWater&&!hasHotWater&&!hasElectro&&!hasGas&&!hasCustom){showToast('Заповніть хоча б одну послугу','⚠️');return;}
  const month=$('monthInput').value;
  const warning=getSaveAnomalyWarning(currentCalc.total,month);
  if(warning&&!confirm(warning)){showToast('Перевірте дані','⚠️');return;}
  let cData={};
  customServices.forEach(srv=>{let v=parseFloat($(`custom_${srv.id}`)?.value);if(isNaN(v)&&srv.defaultSum)v=parseFloat(srv.defaultSum);if(!isNaN(v)&&v>0)cData[srv.id]={name:srv.name,val:v};});
  const existingIdx=records.findIndex(r=>r.month===month);
  const paymentData=getPaymentInputData(currentCalc.total);
  const newData={id:Date.now(),month,isWinter:Boolean($('isWinterInput')?.checked),wPrev:hasWater?getV('wPrev'):0,wCur:hasWater?getV('wCur'):0,hwPrev:hasHotWater?getV('hwPrev'):0,hwCur:hasHotWater?getV('hwCur'):0,dPrev:hasElectro?getV('dPrev'):0,dCur:hasElectro?getV('dCur'):0,nPrev:(hasElectro&&prefs.electroTwoZone)?getV('nPrev'):(records[existingIdx]?.nPrev||0),nCur:(hasElectro&&prefs.electroTwoZone)?getV('nCur'):(records[existingIdx]?.nCur||0),gPrev:hasGas?getV('gPrev'):0,gCur:hasGas?getV('gCur'):0,customData:cData,note:$('recordNote')?.value?.trim()||'',waterCost:hasWater?currentCalc.waterCost:0,hotWaterCost:hasHotWater?currentCalc.hotWaterCost:0,electroCost:hasElectro?currentCalc.electroCost:0,gasCost:hasGas?currentCalc.gasCost:0,customCost:currentCalc.customCost,total:currentCalc.total,...paymentData,tariffSnapshot:createTariffSnapshot(),_filled:{water:hasWater,hotWater:hasHotWater,electro:hasElectro,gas:hasGas,custom:hasCustom},_enteredPrevious:{wPrev:hasWater&&entered('wPrev'),hwPrev:hasHotWater&&entered('hwPrev'),dPrev:hasElectro&&entered('dPrev'),nPrev:hasElectro&&prefs.electroTwoZone&&entered('nPrev'),gPrev:hasGas&&entered('gPrev')}};
  if(existingIdx>=0){
    const existing=records[existingIdx];
    const merged={...existing,...newData,id:existing.id};
    if(!hasWater   &&(existing._filled?.water||existing.waterCost>0))   {merged.wPrev=existing.wPrev;merged.wCur=existing.wCur;merged.waterCost=existing.waterCost;merged._filled.water=true;}
    if(!hasHotWater&&(existing._filled?.hotWater||existing.hotWaterCost>0)){merged.hwPrev=existing.hwPrev;merged.hwCur=existing.hwCur;merged.hotWaterCost=existing.hotWaterCost;merged._filled.hotWater=true;}
    if(!hasElectro &&(existing._filled?.electro||existing.electroCost>0)) {merged.dPrev=existing.dPrev;merged.dCur=existing.dCur;merged.nPrev=existing.nPrev;merged.nCur=existing.nCur;merged.electroCost=existing.electroCost;merged._filled.electro=true;}
    if(!hasGas     &&(existing._filled?.gas||existing.gasCost>0))     {merged.gPrev=existing.gPrev;merged.gCur=existing.gCur;merged.gasCost=existing.gasCost;merged._filled.gas=true;}
    for(const [service,key] of [['water','wPrev'],['hotWater','hwPrev'],['electro','dPrev'],['electro','nPrev'],['gas','gPrev']])if(!{water:hasWater,hotWater:hasHotWater,electro:hasElectro,gas:hasGas}[service])merged._enteredPrevious[key]=existing._enteredPrevious?.[key]??(existing[key]!==undefined&&existing[key]!==null);
    if(!hasCustom  &&(existing._filled?.custom||existing.customCost>0))  {merged.customData={...existing.customData,...cData};merged.customCost=existing.customCost;merged._filled.custom=true;}
    else if(hasCustom){merged.customData={...(existing.customData||{}),...cData};}
    merged.total=(merged.waterCost||0)+(merged.hotWaterCost||0)+(merged.electroCost||0)+(merged.gasCost||0)+(merged.customCost||0);
    if(['waterCost','hotWaterCost','electroCost','gasCost','customCost'].every(key=>Number(merged[key]??0)===Number(existing[key]??0)))merged.total=existing.total;
    else merged.total=Math.round(merged.total*100)/100;
    setRecordPayment(merged, paymentData.paymentStatus, paymentData.paidAmount);
    merged.note=newData.note;
    records[existingIdx]=merged; addChangeLog('record_updated', { month, total: merged.total }); showToast('Запис оновлено на пристрої');
  } else { records.push(newData); addChangeLog('record_created', { month, total: newData.total }); showToast('Запис додано на пристрої'); }
  syncCurrentAddress();if(!saveToLocal())return;
  clearDraft();
  $('submitFormBtn')?.classList.add('save-btn-success');
  setTimeout(()=>$('submitFormBtn')?.classList.remove('save-btn-success'),600);
  // Saving a calculation does not mean the readings were sent to the provider.
  syncToCloud();
  const[y,m]=$('monthInput').value.split('-').map(Number),nD=new Date(y,m);
  $('monthInput').value=`${nD.getFullYear()}-${String(nD.getMonth()+1).padStart(2,'0')}`;
  setPaymentInputsFromRecord(null);
  fillPreviousReadings();calculatePreview();updateSmartBadges();checkNewAchievements();
  switchTab('tabDashboard',0);
  const address=currentAddressSnapshot();
  const emailService=KomunalkaProviders.services(address).find(service=>{
    const card=KomunalkaProviders.get(activeSettings,currentAddressId,service.id);
    try{return Boolean(card.email&&KomunalkaProviders.emailDraft(address,service,card,month));}catch{return false;}
  });
  if(emailService)showActionToast('Показники збережено','Підготувати лист',()=>openProviderEmail(emailService.id,month),'✉️');
});

$('btnClearFields')?.addEventListener('click',()=>{if(!requireEdit('У режимі перегляду очищення недоступне'))return;readingInputIds.forEach(id=>{const el=$(id);if(el){el.value='';el.classList.remove('input-invalid');}});document.querySelectorAll('.custom-srv-input').forEach(el=>el.value='');if($('recordNote'))$('recordNote').value='';setPaymentInputsFromRecord(null);calculatePreview();updateSmartBadges();clearDraft();showToast('Очищено','🧼');});

// =================== FILL PREVIOUS READINGS ===================
function fillPreviousReadings() {
  try {
    readingInputIds.forEach(id=>{if($(id))$(id).value='';});
    document.querySelectorAll('.custom-srv-input').forEach(el=>el.value='');
    if($('recordNote'))$('recordNote').value='';
    setPaymentInputsFromRecord(null);
    const selectedMonth=$('monthInput')?.value;
    if(!selectedMonth||records.length===0){autoSetWinter(selectedMonth);loadDraft();return;}
    const[sy,sm]=selectedMonth.split('-').map(Number);
    const prevDate=new Date(sy,sm-2),prevMonth=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
    const prevRecord=records.find(r=>r.month===prevMonth);
    if(prevRecord){
      if(prefs.showWater   &&prevRecord.wCur !=null&&$('wPrev')) $('wPrev').value=prevRecord.wCur;
      if(prefs.showHotWater&&prevRecord.hwCur!=null&&$('hwPrev'))$('hwPrev').value=prevRecord.hwCur;
      if(prefs.showElectro){if(prevRecord.dCur!=null&&$('dPrev'))$('dPrev').value=prevRecord.dCur;if(prefs.electroTwoZone&&prevRecord.nCur!=null&&$('nPrev'))$('nPrev').value=prevRecord.nCur;}
      if(prefs.showGas&&prevRecord.gCur!=null&&$('gPrev'))$('gPrev').value=prevRecord.gCur;
    }
    const currentRecord=records.find(r=>r.month===selectedMonth);
    if(currentRecord){
      if(prefs.showWater&&currentRecord._filled?.water!==false)   {if(currentRecord.wPrev!=null&&$('wPrev'))$('wPrev').value=currentRecord.wPrev;if(currentRecord.wCur!=null&&$('wCur'))$('wCur').value=currentRecord.wCur;}
      if(prefs.showHotWater&&currentRecord._filled?.hotWater!==false){if(currentRecord.hwPrev!=null&&$('hwPrev'))$('hwPrev').value=currentRecord.hwPrev;if(currentRecord.hwCur!=null&&$('hwCur'))$('hwCur').value=currentRecord.hwCur;}
      if(prefs.showElectro&&currentRecord._filled?.electro!==false) {if(currentRecord.dPrev!=null&&$('dPrev'))$('dPrev').value=currentRecord.dPrev;if(currentRecord.dCur!=null&&$('dCur'))$('dCur').value=currentRecord.dCur;if(prefs.electroTwoZone){if(currentRecord.nPrev!=null&&$('nPrev'))$('nPrev').value=currentRecord.nPrev;if(currentRecord.nCur!=null&&$('nCur'))$('nCur').value=currentRecord.nCur;}}
      if(prefs.showGas&&currentRecord._filled?.gas!==false)     {if(currentRecord.gPrev!=null&&$('gPrev'))$('gPrev').value=currentRecord.gPrev;if(currentRecord.gCur!=null&&$('gCur'))$('gCur').value=currentRecord.gCur;}
      if(currentRecord.customData)Object.keys(currentRecord.customData).forEach(srvId=>{const el=$(`custom_${srvId}`);if(el)el.value=currentRecord.customData[srvId].val;});
      if($('recordNote'))$('recordNote').value=currentRecord.note||'';
      setPaymentInputsFromRecord(currentRecord);
    } else {
      customServices.forEach(srv=>{const el=$(`custom_${srv.id}`);if(el&&srv.defaultSum)el.value=srv.defaultSum;});
    }
    autoSetWinter(selectedMonth);
    loadDraft();
  } catch(e){console.error('fillPreviousReadings:',e);}
}
function autoSetWinter(month){if(!month||!$('isWinterInput'))return;const rec=records.find(r=>r.month===month),mo=new Date(month+'-01').getMonth()+1;$('isWinterInput').checked=typeof rec?.isWinter==='boolean'?rec.isWinter:(mo>=10||mo<=4);}

// =================== SETTINGS ===================
function updateServiceChartOptions(){const select=$('serviceChartSelect');if(!select)return;const cur=select.value;select.innerHTML='';if(prefs.showWater)select.innerHTML+='<option value="water">💧 Вода</option>';if(prefs.showHotWater)select.innerHTML+='<option value="hotWater">🌡️ Гар. Вода</option>';if(prefs.showElectro)select.innerHTML+='<option value="electro">⚡ Світло</option>';if(prefs.showGas)select.innerHTML+='<option value="gas">🔥 Газ</option>';if(select.querySelector(`option[value="${cur}"]`))select.value=cur;}

function fillTariffInputs(nextTariffs) {
  if($('tWater'))         $('tWater').value        =nextTariffs.water;
  if($('tHotWater'))      $('tHotWater').value      =nextTariffs.hotWater;
  if($('tElectroBase'))   $('tElectroBase').value   =nextTariffs.electroBase;
  if($('tElectroWinter')) $('tElectroWinter').value =nextTariffs.electroWinter;
  if($('tGas'))           $('tGas').value           =nextTariffs.gas;
}

function renderTariffPresets() {
  const select = $('tariffPresetSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Обрати місто / постачальника</option>' + TARIFF_PRESETS.map(preset => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join('');
}

function applyTariffPreset(presetId) {
  const preset = TARIFF_PRESETS.find(item => item.id === presetId);
  if (!preset) return;
  fillTariffInputs({ ...defaultTariffs, ...preset.tariffs });
  addChangeLog('tariff_preset_loaded', { preset: preset.name });
  renderChangeLog();
  showToast('Шаблон тарифів застосовано', '🏙️');
}

function applyPreferences() {
  if($('prefWater'))         $('prefWater').checked         =prefs.showWater;
  if($('prefHotWater'))      $('prefHotWater').checked      =prefs.showHotWater;
  if($('prefElectro'))       $('prefElectro').checked       =prefs.showElectro;
  if($('prefGas'))           $('prefGas').checked           =prefs.showGas;
  if($('prefElectroTwoZone'))$('prefElectroTwoZone').checked=prefs.electroTwoZone;
  if($('prefElectroWinter')) $('prefElectroWinter').checked =prefs.electroWinter;
  if($('prefReminders')){$('prefReminders').checked=prefs.remindersEnabled;if($('remindersSettings'))$('remindersSettings').style.display=prefs.remindersEnabled?'block':'none';}
  if($('remWaterStart'))   $('remWaterStart').value  =prefs.remWaterStart  ||1;
  if($('remWaterEnd'))     $('remWaterEnd').value    =prefs.remWaterEnd    ||5;
  if($('remElectroStart')) $('remElectroStart').value=prefs.remElectroStart||28;
  if($('remElectroEnd'))   $('remElectroEnd').value  =prefs.remElectroEnd  ||3;
  if($('remGasStart'))     $('remGasStart').value    =prefs.remGasStart    ||1;
  if($('remGasEnd'))       $('remGasEnd').value      =prefs.remGasEnd      ||5;
  if($('familyRoleSelect'))$('familyRoleSelect').value=getFamilyRole();
  if($('blockWater'))     $('blockWater').style.display    =prefs.showWater   ?'block':'none';
  if($('blockHotWater'))  $('blockHotWater').style.display =prefs.showHotWater?'block':'none';
  if($('settingHotWaterWrap'))$('settingHotWaterWrap').style.display=prefs.showHotWater?'flex':'none';
  if($('blockElectro'))   $('blockElectro').style.display  =prefs.showElectro ?'block':'none';
  if($('blockGas'))       $('blockGas').style.display      =prefs.showGas     ?'block':'none';
  if($('blockCustomServices'))$('blockCustomServices').style.display=customServices.length>0?'block':'none';
  if(prefs.electroTwoZone){if($('electroNightRow'))$('electroNightRow').style.display='flex';if($('lblDay1'))$('lblDay1').innerText='(День)';if($('lblDay2'))$('lblDay2').innerText='(День)';}
  else{if($('electroNightRow'))$('electroNightRow').style.display='none';if($('lblDay1'))$('lblDay1').innerText='';if($('lblDay2'))$('lblDay2').innerText='';}
  if($('winterCheckboxWrapper'))   $('winterCheckboxWrapper').style.display   =prefs.electroWinter?'flex':'none';
  if($('settingElectroWinterWrap'))$('settingElectroWinterWrap').style.display=prefs.electroWinter?'flex':'none';
  updateServiceChartOptions();
  applyAccessMode();
}

function renderChangeLog() {
  const list = $('changeLogList');
  if (!list) return;
  const labels = { record_created:'Додано запис', record_updated:'Оновлено запис', record_deleted:'Видалено запис', record_restored:'Відновлено запис', record_paid_toggled:'Змінено оплату', visible_records_paid:'Оплачено видимі', json_imported:'Імпортовано JSON', import_rolled_back:'Скасовано імпорт', local_backup_restored:'Відновлено бекап', pre_import_backup_restored:'Відновлено до імпорту', tariffs_saved:'Збережено тарифи', tariff_template_saved:'Збережено шаблон тарифів', tariff_template_loaded:'Застосовано шаблон тарифів', tariff_preset_loaded:'Застосовано міський шаблон', community_tariff_saved:'Збережено постачальника', cloud_tariff_loaded:'Додано постачальника з хмари', tariffs_reset:'Повернено базові тарифи', device_credentials_forgotten:'Пристрій забуто' };
  const log = getChangeLog().slice(0, 8);
  if (!log.length) { list.innerHTML = '<p class="text-slate-400">Поки немає змін</p>'; return; }
  list.innerHTML = log.map(item => { const d = new Date(item.ts).toLocaleString('uk-UA', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); const month = item.details?.month ? ` · ${escapeHtml(item.details.month)}` : ''; return `<div class="flex justify-between gap-3 bg-slate-50 dark:bg-black/40 p-3 rounded-xl border border-slate-100 dark:border-white/5"><span class="font-bold text-slate-700 dark:text-slate-200">${escapeHtml(labels[item.type]||item.type)}${month}</span><span class="text-slate-400 shrink-0">${d}</span></div>`; }).join('');
}

$('saveTariffTemplateBtn')?.addEventListener('click',()=>{
  const tpl={water:parseFloat($('tWater')?.value)||defaultTariffs.water,hotWater:parseFloat($('tHotWater')?.value)||defaultTariffs.hotWater,electroBase:parseFloat($('tElectroBase')?.value)||defaultTariffs.electroBase,electroWinter:parseFloat($('tElectroWinter')?.value)||defaultTariffs.electroWinter,gas:parseFloat($('tGas')?.value)||defaultTariffs.gas};
  accountStorage.setItem(CUSTOM_TARIFF_TEMPLATE_KEY,JSON.stringify(tpl));
  addChangeLog('tariff_template_saved');
  renderChangeLog();
  showToast('Шаблон тарифів збережено','💾');
});
$('loadTariffTemplateBtn')?.addEventListener('click',()=>{
  try{const tpl=JSON.parse(accountStorage.getItem(CUSTOM_TARIFF_TEMPLATE_KEY)||'null');if(!tpl)return showToast('Шаблон не знайдено','⚠️');fillTariffInputs({...defaultTariffs,...tpl});addChangeLog('tariff_template_loaded');renderChangeLog();showToast('Шаблон застосовано','✅');}
  catch(e){showToast('Шаблон пошкоджено','❌');}
});
$('resetTariffsBtn')?.addEventListener('click',()=>{fillTariffInputs(defaultTariffs);addChangeLog('tariffs_reset');renderChangeLog();showToast('Базові тарифи','✅');});
$('tariffPresetSelect')?.addEventListener('change',(e)=>{applyTariffPreset(e.target.value);e.target.value='';});
$('familyRoleSelect')?.addEventListener('change',(e)=>{prefs.familyRole=e.target.value;updateFamilyRoleHint();});

['prefWater','prefHotWater','prefElectro','prefGas','prefElectroTwoZone','prefElectroWinter'].forEach(id=>{$(id)?.addEventListener('change',()=>{prefs.showWater=$('prefWater')?.checked??prefs.showWater;prefs.showHotWater=$('prefHotWater')?.checked??prefs.showHotWater;prefs.showElectro=$('prefElectro')?.checked??prefs.showElectro;prefs.showGas=$('prefGas')?.checked??prefs.showGas;prefs.electroTwoZone=$('prefElectroTwoZone')?.checked??prefs.electroTwoZone;prefs.electroWinter=$('prefElectroWinter')?.checked??prefs.electroWinter;applyPreferences();renderCalcCustomServices();calculatePreview();updateSmartBadges();});});
$('prefReminders')?.addEventListener('change',function(){
  prefs.remindersEnabled = this.checked;
  if($('remindersSettings'))$('remindersSettings').style.display=this.checked?'block':'none';
  debouncedSync();checkReminders();initPush();
});

$('saveSettingsBtn')?.addEventListener('click',()=>{
  tariffs={water:parseFloat($('tWater')?.value)||defaultTariffs.water,hotWater:parseFloat($('tHotWater')?.value)||defaultTariffs.hotWater,electroBase:parseFloat($('tElectroBase')?.value)||defaultTariffs.electroBase,electroWinter:parseFloat($('tElectroWinter')?.value)||defaultTariffs.electroWinter,winterLimit:2000,nightCoef:0.5,gas:parseFloat($('tGas')?.value)||defaultTariffs.gas};
  prefs={...prefs,showWater:$('prefWater')?.checked,showHotWater:$('prefHotWater')?.checked,showElectro:$('prefElectro')?.checked,showGas:$('prefGas')?.checked,electroTwoZone:$('prefElectroTwoZone')?.checked,electroWinter:$('prefElectroWinter')?.checked,remindersEnabled:$('prefReminders')?.checked,remWaterStart:parseInt($('remWaterStart')?.value)||1,remWaterEnd:parseInt($('remWaterEnd')?.value)||5,remElectroStart:parseInt($('remElectroStart')?.value)||28,remElectroEnd:parseInt($('remElectroEnd')?.value)||3,remGasStart:parseInt($('remGasStart')?.value)||1,remGasEnd:parseInt($('remGasEnd')?.value)||5,familyRole:$('familyRoleSelect')?.value||getFamilyRole()};
  customServices=customServices.filter(s=>s.name.trim()!=="");
  const budgetVal = parseFloat($('budgetInput')?.value);
  accountStorage.setItem('k_budget', Number.isFinite(budgetVal) && budgetVal > 0 ? String(budgetVal) : '');
  addChangeLog('tariffs_saved');
  syncToCloud();applyPreferences();renderCalcCustomServices();calculatePreview();updateSmartBadges();checkReminders();
  renderChangeLog();
  showToast("Збережено ✓");
});

$('saveDisplayNameBtn')?.addEventListener('click', saveDisplayName);
$('displayNameInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDisplayName(); });

function renderSettingsCustomServices(){const list=$('customServicesSettingsList');if(!list)return;list.innerHTML=customServices.map((srv,i)=>`<div class="flex gap-2 items-center bg-slate-50 dark:bg-black/50 p-2 rounded-xl border border-slate-100 dark:border-white/5"><input type="text" value="${escapeAttr(srv.name)}" data-idx="${i}" data-field="name" placeholder="Назва" class="cs-setting-input flex-1 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2.5 py-2.5 border border-transparent focus:border-brand transition-colors"><input type="number" step="0.01" value="${escapeAttr(srv.defaultSum)}" data-idx="${i}" data-field="sum" placeholder="₴" class="cs-setting-input w-16 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2 py-2.5 text-center border border-transparent focus:border-brand transition-colors"><button type="button" class="cs-del p-2 text-slate-400 hover:text-red-500 bg-white dark:bg-[#2c2c2e] rounded-lg transition-colors" data-idx="${i}"><i class="fa-solid fa-trash text-[10px]"></i></button></div>`).join('');list.querySelectorAll('.cs-setting-input').forEach(input=>{input.addEventListener('change',()=>{const idx=parseInt(input.dataset.idx);if(input.dataset.field==='name')customServices[idx].name=input.value;else customServices[idx].defaultSum=input.value;});});list.querySelectorAll('.cs-del').forEach(btn=>{btn.addEventListener('click',()=>{customServices.splice(parseInt(btn.dataset.idx),1);renderSettingsCustomServices();});});}
$('addCustomServiceBtn')?.addEventListener('click',()=>{customServices.push({id:'s'+Date.now(),name:"",defaultSum:""});renderSettingsCustomServices();});

function renderCalcCustomServices(){const c=$('customServicesContainer');if(!c)return;if(customServices.length===0){c.innerHTML='';applyAccessMode();return;}c.innerHTML=customServices.map(srv=>`<div class="flex flex-col bg-slate-50 dark:bg-black/40 rounded-2xl p-3 border border-slate-100 dark:border-white/5"><span class="block text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate mb-1.5 text-center">${escapeHtml(srv.name)||'Послуга'}</span><input type="number" step="0.01" id="custom_${escapeAttr(srv.id)}" class="custom-srv-input premium-input w-full bg-white dark:bg-[#2c2c2e] p-2.5 rounded-xl text-center text-lg font-black outline-none border border-slate-200 dark:border-white/10" placeholder="${escapeAttr(srv.defaultSum||'0.00')}"></div>`).join('');document.querySelectorAll('.custom-srv-input').forEach(input=>input.addEventListener('input',()=>{calculatePreview();debouncedDraft();}));applyAccessMode();}

function getMonthKey() {
  const date=KomunalkaReminders.calendar();return KomunalkaReminders.monthKey(date.year,date.month);
}
function currentReminderItems(){return KomunalkaReminders.due({id:currentAddressId,prefs},activeSettings);}
function checkReminders(){checkRemindersExtended();}
$('reminderDismissBtn')?.addEventListener('click',()=>{
  if(!requireEdit())return;
  prefs.reminderCompletions={...prefs.reminderCompletions};
  currentReminderItems().forEach(rem=>{prefs.reminderCompletions[rem.id]=rem.cycle;});
  debouncedSync();checkReminders();renderMonthlyTasks();showToast('Передані показники позначено для цієї адреси','🔔');
});

$('changePassBtn')?.addEventListener('click', () => {
  const modal = $('changePassModal');
  if (!modal) return;
  if ($('cpOldPass'))    $('cpOldPass').value    = '';
  if ($('cpNewPass'))    $('cpNewPass').value    = '';
  if ($('cpConfirmPass'))$('cpConfirmPass').value = '';
  if ($('cpError'))      $('cpError').classList.add('hidden');
  modal.classList.remove('hidden');
  setTimeout(() => $('cpOldPass')?.focus(), 100);
});
$('cpCancelBtn')?.addEventListener('click', () => $('changePassModal')?.classList.add('hidden'));
$('cpSubmitBtn')?.addEventListener('click', async () => {
  const oldPass = $('cpOldPass')?.value;
  const newPass = $('cpNewPass')?.value;
  const confirmPass = $('cpConfirmPass')?.value;
  const cpErr = $('cpError');
  const cpBtn = $('cpBtnText');
  const cpSpinner = $('cpSpinner');
  if (!oldPass) { if (cpErr) { cpErr.textContent = 'Введіть поточний пароль'; cpErr.classList.remove('hidden'); } return; }
  if (!newPass || newPass.length < 4) { if (cpErr) { cpErr.textContent = 'Новий пароль — мінімум 4 символи'; cpErr.classList.remove('hidden'); } return; }
  if (newPass !== confirmPass) { if (cpErr) { cpErr.textContent = 'Паролі не збігаються'; cpErr.classList.remove('hidden'); } return; }
  if (cpErr) cpErr.classList.add('hidden');
  if (cpBtn) cpBtn.textContent = 'Змінюю...';
  if (cpSpinner) cpSpinner.classList.remove('hidden');
  try {
    const oldHash = await getHash(oldPass);
    const newHash = await getHash(newPass);
    const res = await secureFetch('POST', {}, { action: 'change_password', login: sessionLogin, oldPass: oldHash, newPass: newHash });
    const data = await res.json();
    if (data.success) {
      sessionPass = newHash;
      localStorage.setItem('k_passHash', newHash);
      $('changePassModal')?.classList.add('hidden');
      showToast('Пароль змінено! ✅');
    } else {
      if (cpErr) { cpErr.textContent = 'Неправильний поточний пароль'; cpErr.classList.remove('hidden'); }
    }
  } catch(e) {
    if (cpErr) { cpErr.textContent = 'Помилка мережі: ' + e.message; cpErr.classList.remove('hidden'); }
  }
  if (cpBtn) cpBtn.textContent = 'Змінити';
  if (cpSpinner) cpSpinner.classList.add('hidden');
});
$('cpConfirmPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('cpSubmitBtn')?.click(); });

// =================== SWIPE ===================
function initSwipe(card,recordId){
  let startX=0,startY=0,delta=0,tracking=false;
  card.addEventListener('touchstart',e=>{if(e.touches.length!==1||e.target.closest('button,input,a'))return;startX=e.touches[0].clientX;startY=e.touches[0].clientY;delta=0;tracking=true;},{passive:true});
  card.addEventListener('touchmove',e=>{if(!tracking)return;const dx=e.touches[0].clientX-startX,dy=e.touches[0].clientY-startY;if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){tracking=false;return;}delta=dx;},{passive:true});
  card.addEventListener('touchend',e=>{if(tracking&&Math.abs(delta)>80){e.preventDefault();e.stopPropagation();card.querySelector('.details-panel')?.classList.remove('hidden');card.querySelector('[data-toggle-details]')?.setAttribute('aria-expanded','true');const chevron=card.querySelector('.chevron-icon');if(chevron)chevron.style.transform='rotate(180deg)';card.classList.add('swipe-actions-visible');card.querySelector(delta<0?'.rec-del':'.rec-pay')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});haptic('light');}tracking=false;delta=0;},{passive:false});
  card.addEventListener('touchcancel',()=>{tracking=false;delta=0;},{passive:true});
}

// =================== RECORDS ===================
function findRecordIndex(id){return records.findIndex(r=>String(r.id)===String(id));}
function togglePaidById(id){if(!requireEdit('У режимі перегляду не можна змінювати оплату'))return;const idx=findRecordIndex(id);if(idx<0)return;const nextStatus=isRecordPaid(records[idx])?'charged':'paid';setRecordPayment(records[idx],nextStatus,nextStatus==='paid'?records[idx].total:0);addChangeLog('record_paid_toggled',{month:records[idx].month,paid:records[idx].paid,status:records[idx].paymentStatus});renderRecords();renderDashboard();syncCurrentAddress();syncToCloud();checkNewAchievements();}
function deleteRecordById(id){
  if(!requireEdit('У режимі перегляду не можна видаляти записи'))return;
  const idx=findRecordIndex(id);
  if(idx<0)return;
  const deleted=records[idx];
  records=records.filter(r=>String(r.id)!==String(id));
  addChangeLog('record_deleted',{month:deleted.month,total:deleted.total});
  renderRecords();renderDashboard();syncCurrentAddress();syncToCloud();
  showActionToast('Запис видалено','Відновити',()=>{
    records.splice(Math.min(idx,records.length),0,deleted);
    addChangeLog('record_restored',{month:deleted.month,total:deleted.total});
    renderRecords();renderDashboard();syncCurrentAddress();syncToCloud();showToast('Відновлено','✅');
  },'🗑');
}

function renderRecords(){
  const list=$('recordsList');if(!list) return;
  if(records.length===0){list.innerHTML=`<div class="text-center py-12"><i class="fa-solid fa-clock-rotate-left text-4xl text-slate-300 dark:text-slate-600 mb-4"></i><p class="text-slate-500 font-medium">Ще немає записів</p><p class="text-xs text-slate-400 mt-1">Додайте перший запис у вкладці "Показники"</p></div>`;if($('statsAvg'))$('statsAvg').innerText='0 ₴';if($('statsTotalPaid'))$('statsTotalPaid').innerText='0 ₴';if($('statsMin'))$('statsMin').innerText='0 ₴';if($('statsMax'))$('statsMax').innerText='0 ₴';if($('statsCount'))$('statsCount').innerText='0';renderHistoryChart([]);renderServiceChart();return;}
  const totals=records.map(r=>r.total);
  if($('statsAvg'))      $('statsAvg').innerText      =fmt.format(totals.reduce((a,b)=>a+b,0)/totals.length)+' ₴';
  if($('statsTotalPaid'))$('statsTotalPaid').innerText=fmt.format(records.reduce((s,r)=>s+getPaidAmount(r),0))+' ₴';
  if($('statsMin'))      $('statsMin').innerText      =fmt.format(Math.min(...totals))+' ₴';
  if($('statsMax'))      $('statsMax').innerText      =fmt.format(Math.max(...totals))+' ₴';
  if($('statsCount'))    $('statsCount').innerText    =records.length;
  let sorted=[...records];
  const sortVal=$('sortSelect')?.value||'date-desc';
  switch(sortVal){case 'date-desc':sorted.sort((a,b)=>new Date(b.month)-new Date(a.month));break;case 'date-asc':sorted.sort((a,b)=>new Date(a.month)-new Date(b.month));break;case 'amount-desc':sorted.sort((a,b)=>b.total-a.total);break;case 'amount-asc':sorted.sort((a,b)=>a.total-b.total);break;}
  if(currentFilter==='paid')  sorted=sorted.filter(r=>isRecordPaid(r));
  if(currentFilter==='unpaid')sorted=sorted.filter(r=>getOutstandingAmount(r)>0);
  const search=$('searchRecords')?.value?.toLowerCase()||'';
  if(search)sorted=sorted.filter(r=>new Date(r.month+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'}).toLowerCase().includes(search)||r.month.includes(search));
  renderHistoryChart([...records].sort((a,b)=>new Date(a.month)-new Date(b.month)));
  renderServiceChart();
  list.innerHTML='';
    if(!sorted.length){list.innerHTML=`<div class="text-center py-8"><p class="text-slate-400 font-medium">Нічого не знайдено</p></div>`;return;}
  const unpaidCount=sorted.filter(r=>getOutstandingAmount(r)>0).length;
  if(unpaidCount>0&&currentFilter!=='paid'){
    const batchBar=document.createElement('div');
    batchBar.className='bg-gradient-to-r from-green-500 to-emerald-600 p-4 rounded-2xl flex justify-between items-center text-white mb-4';
    batchBar.innerHTML=`<div><p class="text-xs font-bold opacity-80">${unpaidCount} з боргом у списку</p><p class="text-sm font-black">${fmt.format(sorted.reduce((s,r)=>s+getOutstandingAmount(r),0))} ₴</p></div><button class="batch-pay-btn px-4 py-2 bg-white/20 rounded-xl text-xs font-bold active:scale-95 transition-transform border border-white/20">✓ Оплатити видимі</button>`;
    list.appendChild(batchBar);
    batchBar.querySelector('.batch-pay-btn')?.addEventListener('click',()=>{if(!requireEdit('У режимі перегляду не можна змінювати оплату'))return;if(confirm(`Позначити ${unpaidCount} видимих записів як оплачені?`)){const payableIds=new Set(sorted.filter(r=>getOutstandingAmount(r)>0).map(r=>r.id));records.forEach(r=>{if(payableIds.has(r.id))setRecordPayment(r,'paid',r.total);});addChangeLog('visible_records_paid',{count:payableIds.size});renderRecords();renderDashboard();syncCurrentAddress();syncToCloud();checkNewAchievements();showToast(`${unpaidCount} записів оплачено!`,'✅');}});
  }
  let lastYear=null;
  sorted.forEach(rec=>{
    const yr=rec.month.split('-')[0];
    if(yr!==lastYear){lastYear=yr;const h=document.createElement('div');h.className="flex items-center gap-4 mt-6 mb-3";h.innerHTML=`<h2 class="text-lg font-black text-slate-300 dark:text-slate-600">${yr}</h2><div class="h-[1px] flex-1 bg-slate-200 dark:bg-white/5"></div>`;list.appendChild(h);}
    list.appendChild(createRecordCard(rec));
  });
}

function renderHistoryChart(sortedRecords,retryCount=0){if(!$('historyChartCanvas'))return;if(!historyChart)historyChart=new ChartEngine('historyChartCanvas',{padding:30,barRadius:5});if(!historyChart.width)historyChart.setupCanvas();if(!historyChart.width){if(retryCount<5)setTimeout(()=>renderHistoryChart(sortedRecords,retryCount+1),200);return;}historyChart.setData(sortedRecords.slice(-10).map(r=>({value:r.total,label:new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short'}).slice(0,3),color:isRecordPaid(r)?'#007aff':getPaymentStatus(r)==='partial'?'#ffcc00':'#ff9500'})));}

function renderServiceChart(retryCount=0){if(!$('serviceChartCanvas')||records.length===0){if($('serviceChartSummary'))$('serviceChartSummary').innerHTML='';return;}const type=$('serviceChartSelect')?.value||'water',unit=type==='electro'?'кВт':'м³';if(!serviceChart)serviceChart=new ChartEngine('serviceChartCanvas',{padding:24,barRadius:4,unit});else serviceChart.options.unit=unit;if(!serviceChart.width)serviceChart.setupCanvas();if(!serviceChart.width){if(retryCount<5)setTimeout(()=>renderServiceChart(retryCount+1),200);return;}const sorted=[...records].sort((a,b)=>new Date(a.month)-new Date(b.month)).slice(-8);const getValue=rec=>{switch(type){case 'water':return Math.max(0,(rec.wCur||0)-(rec.wPrev||0));case 'hotWater':return Math.max(0,(rec.hwCur||0)-(rec.hwPrev||0));case 'electro':return Math.max(0,(rec.dCur||0)-(rec.dPrev||0))+Math.max(0,(rec.nCur||0)-(rec.nPrev||0));case 'gas':return Math.max(0,(rec.gCur||0)-(rec.gPrev||0));default:return 0;}};const getColor=()=>{switch(type){case 'water':return'#3b82f6';case 'hotWater':return'#ef4444';case 'electro':return'#eab308';case 'gas':return'#f97316';default:return'#6b7280';}};const color=getColor(),data=sorted.map(rec=>({value:getValue(rec),label:new Date(rec.month+'-01').toLocaleString('uk-UA',{month:'short'}).slice(0,3),color}));serviceChart.setData(data);const values=data.map(d=>d.value),avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:0,last=values[values.length-1]||0,prevLast=values.length>1?values[values.length-2]:last,trendPct=prevLast>0?Math.round(((last-prevLast)/prevLast)*100):0;const summary=$('serviceChartSummary');if(summary)summary.innerHTML=`<span>Сер.: <span style="color:${color}" class="font-black">${Math.round(avg)} ${unit}/міс</span></span><span>Ост.: <span class="${trendPct<0?'text-green-600':trendPct>0?'text-red-500':'text-slate-500'} font-black">${last} ${unit} (${trendPct>0?'+':''}${trendPct}%)</span></span>`;}
$('serviceChartSelect')?.addEventListener('change',renderServiceChart);

async function shareRecordById(id){const rec=records.find(r=>String(r.id)===String(id));if(!rec)return;const d=new Date(rec.month+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'});let t=`🧾 Комуналка за ${d}\n📍 ${$('currentAddressDisplay')?.innerText||''}\n──────────\n`;if(rec.waterCost>0)t+=`💧 Вода: ${fmt.format(rec.waterCost)} ₴\n`;if(rec.hotWaterCost>0)t+=`🌡️ Гар.: ${fmt.format(rec.hotWaterCost)} ₴\n`;if(rec.electroCost>0)t+=`⚡ Світло: ${fmt.format(rec.electroCost)} ₴\n`;if(rec.gasCost>0)t+=`🔥 Газ: ${fmt.format(rec.gasCost)} ₴\n`;if(rec.customCost>0)t+=`📦 Інше: ${fmt.format(rec.customCost)} ₴\n`;t+=`──────────\n💰 Всього: ${fmt.format(rec.total)} ₴\n💳 ${getPaymentLabel(rec)}${getPaymentStatus(rec)==='partial'?`: ${fmt.format(getPaidAmount(rec))} ₴ сплачено, борг ${fmt.format(getOutstandingAmount(rec))} ₴`:''}`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){prompt(":",t);}}



// =================== FILTER & SEARCH ===================
let searchDebounceTimer;
$('filterToggleBtn')?.addEventListener('click',()=>$('filterPanel')?.classList.toggle('hidden'));
$('filterButtons')?.addEventListener('click',(e)=>{const btn=e.target.closest('.filter-btn');if(!btn)return;currentFilter=btn.dataset.filter;document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.remove('bg-brand','text-white');b.classList.add('bg-slate-100','dark:bg-[#2c2c2e]','text-slate-600','dark:text-slate-400');});btn.classList.remove('bg-slate-100','dark:bg-[#2c2c2e]','text-slate-600','dark:text-slate-400');btn.classList.add('bg-brand','text-white');renderRecords();});
$('searchRecords')?.addEventListener('input',()=>{clearTimeout(searchDebounceTimer);searchDebounceTimer=setTimeout(renderRecords,200);});
$('sortSelect')?.addEventListener('change',()=>renderRecords());

// =================== EXPORT ===================
function csvCell(value){let text=String(value??'');if(typeof value==='string'&&/^[=+@\t\r]|^-\D/.test(text))text="'"+text;return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function downloadBlob(content,filename,type){const blob=new Blob([content],{type}),link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=filename;link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const optionalScriptLoads=new Map();
function loadOptionalScript(src,ready){
  if(ready?.())return Promise.resolve();
  if(optionalScriptLoads.has(src))return optionalScriptLoads.get(src);
  const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');let timer;const finish=error=>{clearTimeout(timer);error?reject(error):resolve();};script.src=src;script.async=true;script.onload=()=>finish(ready&&!ready()?new Error('OPTIONAL_SCRIPT_NOT_READY'):null);script.onerror=()=>finish(new Error('OPTIONAL_SCRIPT_FAILED'));timer=setTimeout(()=>finish(new Error('OPTIONAL_SCRIPT_TIMEOUT')),15000);document.head.appendChild(script);});
  optionalScriptLoads.set(src,promise);promise.catch(()=>{if(optionalScriptLoads.get(src)===promise)optionalScriptLoads.delete(src);});return promise;
}
function pdfAutoTableReady(){try{return typeof window.jspdf?.jsPDF?.API?.autoTable==='function'||typeof new window.jspdf.jsPDF().autoTable==='function';}catch{return false;}}
async function ensurePdfTools(){await loadOptionalScript('vendor/jspdf/jspdf.umd.min.js',()=>!!window.jspdf?.jsPDF);await loadOptionalScript('vendor/jspdf/jspdf.plugin.autotable.min.js',pdfAutoTableReady);}

function exportServices(){
  return [
    {key:'waterCost',label:'Вода',unit:'м³',used:!!prefs.showWater,value:r=>Math.max(0,(r.wCur||0)-(r.wPrev||0))},
    {key:'hotWaterCost',label:'Гаряча вода',unit:'м³',used:!!prefs.showHotWater,value:r=>Math.max(0,(r.hwCur||0)-(r.hwPrev||0))},
    {key:'electroCost',label:'Світло',unit:'кВт·год',used:!!prefs.showElectro,value:r=>Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0))},
    {key:'gasCost',label:'Газ',unit:'м³',used:!!prefs.showGas,value:r=>Math.max(0,(r.gCur||0)-(r.gPrev||0))}
  ].filter(service=>service.used||records.some(r=>Number(r[service.key])>0));
}
function exportCSV(){
  if(!records.length)return showToast('Немає записів','⚠️');
  const services=exportServices(),header=['Місяць',...services.flatMap(s=>[`${s.label} (${s.unit})`,`${s.label} (₴)`]),'Інше (₴)','Всього (₴)','Сплачено (₴)','Залишок (₴)','Статус','Нотатка'];
  const rows=[header,...[...records].sort((a,b)=>b.month.localeCompare(a.month)).map(r=>[r.month,...services.flatMap(s=>[s.value(r),Number(r[s.key]||0).toFixed(2)]),Number(r.customCost||0).toFixed(2),Number(r.total||0).toFixed(2),getPaidAmount(r).toFixed(2),getOutstandingAmount(r).toFixed(2),getPaymentLabel(r),r.note||''])];
  downloadBlob('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\n')+'\n','komunalka.csv','text/csv;charset=utf-8;');
  showToast('CSV збережено','📊');
}

async function generatePDF(){
  if(!records.length)return showToast('Немає записів','⚠️');
  try{
    showToast('Готуємо PDF…','⏳');
    await ensurePdfTools();
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});
    let hasFont=false;
    try{const resp=await fetch('./vendor/fonts/Roboto-Regular.ttf');if(resp.ok){const bytes=new Uint8Array(await resp.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);doc.addFileToVFS('Roboto.ttf',btoa(binary));doc.addFont('Roboto.ttf','Roboto','normal');doc.setFont('Roboto','normal');hasFont=true;}}catch{}
    const t=hasFont?s=>String(s):s=>transliterate(String(s)),money=value=>Number(value||0).toFixed(2),services=exportServices();
    doc.setFillColor(36,86,189);doc.rect(0,0,297,35,'F');doc.setTextColor(255,255,255);doc.setFontSize(18);doc.text(t('Комунальні платежі'),15,15);doc.setFontSize(10);doc.text(t($('currentAddressDisplay')?.innerText||''),15,24);doc.setTextColor(60,60,60);
    const head=['Місяць',...services.map(s=>`${s.label}, ₴`),'Інше, ₴','Всього, ₴','Сплачено, ₴','Залишок, ₴','Статус'].map(t);
    const body=[...records].sort((a,b)=>b.month.localeCompare(a.month)).map(r=>[r.month,...services.map(s=>money(r[s.key])),money(r.customCost),money(r.total),money(getPaidAmount(r)),money(getOutstandingAmount(r)),t(getPaymentLabel(r))]);
    doc.autoTable({startY:42,head:[head],body,theme:'striped',styles:{font:hasFont?'Roboto':'helvetica',fontStyle:'normal',fontSize:8,cellPadding:3},headStyles:{fillColor:[36,86,189],textColor:[255,255,255],fontStyle:'normal'},margin:{left:12,right:12}});
    doc.save(`komunalka_${new Date().toISOString().slice(0,10)}.pdf`);showToast('PDF збережено','📄');
  }catch{showToast('Не вдалося створити PDF. Дані залишились збережені.','❌');}
}

function transliterate(text){const map={'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya','А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'Ye','Ж':'Zh','З':'Z','И':'Y','І':'I','Ї':'Yi','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ь':'','Ю':'Yu','Я':'Ya'};return text.split('').map(c=>map[c]||c).join('');}

async function shareAllRecords(){if(!records.length)return showToast('Немає','⚠️');const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,6);let t=`📊 Комунальні\n📍 ${$('currentAddressDisplay')?.innerText||''}\n───────\n`;sorted.forEach(r=>{t+=`${new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short',year:'numeric'})}: ${fmt.format(r.total)} ₴ ${isRecordPaid(r)?'✅':getPaymentStatus(r)==='partial'?'◐':'⏳'}\n`;});t+=`───────\nСередній: ${fmt.format(sorted.reduce((s,r)=>s+r.total,0)/sorted.length)} ₴/міс`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){prompt(":",t);}}

$('exportCsvBtn')?.addEventListener('click',exportCSV);
$('exportPdfBtn')?.addEventListener('click',generatePDF);
$('shareAllBtn')?.addEventListener('click',shareAllRecords);
$('exportJsonBtn')?.addEventListener('click',()=>{syncCurrentAddress();downloadBlob(JSON.stringify({version:APP_VERSION,exportDate:new Date().toISOString(),addresses,currentAddressId,accountSettings:activeSettings},null,2),'komunalka_backup.json','application/json;charset=utf-8;');writeDeviceMeta({lastExportAt:Date.now()});showToast('Бекап створено','💾');});
$('dataSyncNowBtn')?.addEventListener('click',async()=>{if(!activeStore)return showToast('Спочатку увійдіть в акаунт','⚠️');await syncToCloud();renderDataHealth();});
$('importJsonBtn')?.addEventListener('click',()=>$('importFileInput')?.click());

// =================== IMPORT ===================
function isPlainObject(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function normalizeNumber(value,fallback=0){const num=Number(value);return Number.isFinite(num)?num:fallback;}
function normalizeImportedRecord(rec){
  if(!isPlainObject(rec)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(rec.month||'')))throw new Error('INVALID_RECORD');
  for(const key of ['total','waterCost','hotWaterCost','electroCost','gasCost','customCost','paidAmount'])if(rec[key]!=null&&!Number.isFinite(Number(rec[key])))throw new Error('INVALID_AMOUNT');
  return {...rec,id:rec.id??`legacy_${rec.month}`,month:String(rec.month),total:Number(rec.total??0)};
}
function normalizeImportedAddress(addr,index){
  if(!isPlainObject(addr)||!Array.isArray(addr.records||[]))throw new Error('INVALID_ADDRESS');
  const normalized={...addr,id:addr.id??`legacy_address_${index}`,name:String(addr.name||`Об'єкт ${index+1}`),tariffs:{...(addr.tariffs||{})},prefs:{...(addr.prefs||{})},records:(addr.records||[]).map(normalizeImportedRecord),customServices:KomunalkaData.copy(addr.customServices||[])};
  if(new Set(normalized.records.map(r=>String(r.id))).size!==normalized.records.length)throw new Error('DUPLICATE_RECORD_ID');
  if(!normalized.customServices.every(srv=>isPlainObject(srv)&&srv.id!=null))throw new Error('INVALID_SERVICE');
  return normalized;
}
function normalizeImportData(data){
  if(!isPlainObject(data))return null;
  if(!Array.isArray(data.addresses)){if(Array.isArray(data.records))data={...data,addresses:[{id:'default',name:'Мій дім',records:data.records,tariffs:data.tariffs||{},prefs:data.prefs||{},customServices:data.customServices||[]}],currentAddressId:'default'};else return null;}
  const addrs=data.addresses.map(normalizeImportedAddress);
  if(new Set(addrs.map(a=>String(a.id))).size!==addrs.length)throw new Error('DUPLICATE_ADDRESS_ID');
  const cid=data.currentAddressId;
  return {addresses:addrs,currentAddressId:addrs.some(a=>a.id===cid)?cid:(addrs[0]?.id||'default'),...(data.accountSettings?{accountSettings:KomunalkaData.copy(data.accountSettings)}:{})};
}
$('importFileInput')?.addEventListener('change',(e)=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const normalized=normalizeImportData(JSON.parse(ev.target.result));if(!normalized){showToast('Невірний формат','❌');return;}const recordCount=normalized.addresses.reduce((s,a)=>s+(a.records?.length||0),0);if(confirm(`Імпорт ${normalized.addresses.length} об'єктів і ${recordCount} записів? Поточні дані буде замінено, але перед цим створиться аварійний бекап.`)){if(!backupCurrentState(PRE_IMPORT_BACKUP_KEY))return;addresses=normalized.addresses;currentAddressId=normalized.currentAddressId;activeSettings=normalized.accountSettings||activeSettings;addChangeLog('json_imported',{addresses:normalized.addresses.length,records:recordCount});loadCurrentAddress();syncToCloud();showActionToast('Імпортовано','Скасувати',()=>{if(restoreFromLocalBackup(PRE_IMPORT_BACKUP_KEY)){addChangeLog('import_rolled_back');showToast('Імпорт скасовано','✅');}else showToast('Немає бекапу','⚠️');},'✅');}}catch(err){showToast('Помилка','❌');}};reader.readAsText(file);e.target.value='';});
$('restoreBackupBtn')?.addEventListener('click',()=>{if(confirm('Відновити останній локальний бекап? Поточні дані буде замінено.')){if(!backupCurrentState(PRE_IMPORT_BACKUP_KEY))return;if(restoreFromLocalBackup(LOCAL_BACKUP_KEY)){addChangeLog('local_backup_restored');showToast('Бекап відновлено','✅');}else showToast('Бекап не знайдено','⚠️');}});
$('restorePreImportBtn')?.addEventListener('click',()=>{if(confirm('Відновити стан перед останнім імпортом?')){if(restoreFromLocalBackup(PRE_IMPORT_BACKUP_KEY)){addChangeLog('pre_import_backup_restored');showToast('Відновлено','✅');}else showToast('Бекап не знайдено','⚠️');}});
$('forgetDeviceBtn')?.addEventListener('click',async()=>{if(confirm('Прибрати дані входу з цього пристрою? Локальні бекапи й налаштування залишаться.')){if(!await detachPush()){showToast('Не вдалося вимкнути сповіщення. Повторіть.','⚠️');return;}['k_login','k_passHash','k_uid','k_display_name'].forEach(key=>localStorage.removeItem(key));addChangeLog('device_credentials_forgotten');location.reload();}});

// =================== TIPS ===================
function getConsumptionTrend(type,months=6){const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,months);if(sorted.length<2)return null;const values=sorted.map(r=>{switch(type){case 'water':return Math.max(0,(r.wCur||0)-(r.wPrev||0));case 'electro':return Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0));case 'gas':return Math.max(0,(r.gCur||0)-(r.gPrev||0));default:return r.total;}}).reverse();const first=values.slice(0,Math.ceil(values.length/2)),second=values.slice(Math.ceil(values.length/2));const avgF=first.reduce((a,b)=>a+b,0)/first.length,avgS=second.reduce((a,b)=>a+b,0)/second.length;if(avgF===0)return 0;return Math.round(((avgS-avgF)/avgF)*100);}
function getSmartTips(){const tips=[];if(records.length>=3){const wT=getConsumptionTrend('water');if(wT&&wT>20)tips.push({emoji:'💧',text:`Споживання води зросло на ${wT}%. Перевірте крани.`});const eT=getConsumptionTrend('electro');if(eT&&eT>20)tips.push({emoji:'⚡',text:`Електрика +${eT}%. Перевірте прилади.`});if(eT&&eT<-10)tips.push({emoji:'🎉',text:`Електрика -${Math.abs(eT)}%! Чудова економія!`});}const budget=parseFloat(accountStorage.getItem('k_budget'))||0;if(budget&&records.length>0){const last=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month))[0];if(last.total>budget*1.2)tips.push({emoji:'⚠️',text:`Перевищили бюджет на ${Math.round(((last.total-budget)/budget)*100)}%`});}const unpaid=records.filter(r=>getOutstandingAmount(r)>0);if(unpaid.length>=3)tips.push({emoji:'💳',text:`${unpaid.length} місяців із боргом. Оплатіть або відмітьте часткову оплату.`});if(prefs.showElectro&&prefs.electroTwoZone&&records.length>0){const last=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month))[0];const n=Math.max(0,(last.nCur||0)-(last.nPrev||0)),d=Math.max(0,(last.dCur||0)-(last.dPrev||0)),tot=n+d;if(tot>0&&n/tot<0.3)tips.push({emoji:'🌙',text:'Спробуйте більше електрики вночі — дешевше.'});}return tips.slice(0,3);}
function renderTips(){const container=$('tipsContainer');if(!container)return;const tips=getSmartTips();if(!tips.length){container.classList.add('hidden');return;}container.classList.remove('hidden');const listEl=$('tipsList');if(listEl)listEl.innerHTML=tips.map(t=>`<div class="flex items-start gap-3 bg-slate-50 dark:bg-black/40 p-3 rounded-xl border border-slate-100 dark:border-white/5"><span class="text-lg shrink-0">${t.emoji}</span><p class="text-xs font-medium text-slate-600 dark:text-slate-300">${escapeHtml(t.text)}</p></div>`).join('');}

// =================== YEAR REPORT ===================
$('yearReportBtn')?.addEventListener('click',()=>generateYearReport());
function generateYearReport(){
  const year=new Date().getFullYear(),yr=records.filter(r=>r.month.startsWith(String(year)));
  if(!yr.length){showToast('Немає даних за рік','⚠️');return;}
  if($('yearReportYear'))$('yearReportYear').textContent=year;
  const total=yr.reduce((s,r)=>s+r.total,0),avg=total/yr.length;
  const maxR=yr.reduce((a,b)=>a.total>b.total?a:b),minR=yr.reduce((a,b)=>a.total<b.total?a:b);
  const paid=yr.filter(r=>isRecordPaid(r)).length;
  const wT=yr.reduce((s,r)=>s+(r.waterCost||0),0),hwT=yr.reduce((s,r)=>s+(r.hotWaterCost||0),0),eT=yr.reduce((s,r)=>s+(r.electroCost||0),0),gT=yr.reduce((s,r)=>s+(r.gasCost||0),0),cT=yr.reduce((s,r)=>s+(r.customCost||0),0);
  const maxM=new Date(maxR.month+'-01').toLocaleString('uk-UA',{month:'long'}),minM=new Date(minR.month+'-01').toLocaleString('uk-UA',{month:'long'});
  const streak=getStreak(records);
  const html=`<div class="text-center mb-2"><p class="text-3xl font-black text-slate-900 dark:text-white">${fmt.format(total)} ₴</p><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Загальні витрати</p></div><div class="grid grid-cols-2 gap-3"><div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl text-center"><p class="text-[9px] font-bold text-slate-400 uppercase">Середній</p><p class="text-lg font-black text-slate-900 dark:text-white">${fmt.format(avg)} ₴</p></div><div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl text-center"><p class="text-[9px] font-bold text-slate-400 uppercase">Місяців</p><p class="text-lg font-black text-slate-900 dark:text-white">${yr.length}</p></div></div><div class="bg-green-50 dark:bg-green-500/10 p-4 rounded-2xl"><div class="flex justify-between"><span class="text-sm font-bold text-green-700 dark:text-green-400">📉 Найдешевший</span><span class="font-black text-green-700 dark:text-green-400">${fmt.format(minR.total)} ₴</span></div><p class="text-[10px] text-green-600/70 mt-0.5">${minM}</p></div><div class="bg-red-50 dark:bg-red-500/10 p-4 rounded-2xl"><div class="flex justify-between"><span class="text-sm font-bold text-red-700 dark:text-red-400">📈 Найдорожчий</span><span class="font-black text-red-700 dark:text-red-400">${fmt.format(maxR.total)} ₴</span></div><p class="text-[10px] text-red-600/70 mt-0.5">${maxM}</p></div><div class="bg-slate-50 dark:bg-black/40 p-4 rounded-2xl"><p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-3">Розподіл</p><div class="space-y-2">${wT>0?`<div class="flex justify-between text-xs"><span class="font-bold text-slate-600 dark:text-slate-300">💧 Вода</span><span class="font-black">${fmt.format(wT)} ₴ (${Math.round(wT/total*100)}%)</span></div>`:''}${hwT>0?`<div class="flex justify-between text-xs"><span class="font-bold text-slate-600 dark:text-slate-300">🌡️ Гар.</span><span class="font-black">${fmt.format(hwT)} ₴ (${Math.round(hwT/total*100)}%)</span></div>`:''}${eT>0?`<div class="flex justify-between text-xs"><span class="font-bold text-slate-600 dark:text-slate-300">⚡ Світло</span><span class="font-black">${fmt.format(eT)} ₴ (${Math.round(eT/total*100)}%)</span></div>`:''}${gT>0?`<div class="flex justify-between text-xs"><span class="font-bold text-slate-600 dark:text-slate-300">🔥 Газ</span><span class="font-black">${fmt.format(gT)} ₴ (${Math.round(gT/total*100)}%)</span></div>`:''}${cT>0?`<div class="flex justify-between text-xs"><span class="font-bold text-slate-600 dark:text-slate-300">📦 Інше</span><span class="font-black">${fmt.format(cT)} ₴ (${Math.round(cT/total*100)}%)</span></div>`:''}</div></div><div class="grid grid-cols-2 gap-3"><div class="bg-brand-light p-3 rounded-xl text-center border border-brand-border"><p class="text-[9px] font-bold text-brand uppercase">Оплачено</p><p class="text-lg font-black text-brand">${paid}/${yr.length}</p></div><div class="bg-orange-50 dark:bg-orange-500/10 p-3 rounded-xl text-center border border-orange-100 dark:border-orange-500/20"><p class="text-[9px] font-bold text-orange-500 uppercase">Серія</p><p class="text-lg font-black text-orange-500">${streak} 🔥</p></div></div>`;
  if($('yearReportContent'))$('yearReportContent').innerHTML=html;
  $('yearReportModal')?.classList.remove('hidden');
  haptic('success');
}
async function shareYearReport(){const year=new Date().getFullYear(),yr=records.filter(r=>r.month.startsWith(String(year)));if(!yr.length)return;const total=yr.reduce((s,r)=>s+r.total,0),avg=total/yr.length,streak=getStreak(records);let t=`📊 Річний звіт ${year}\n📍 ${$('currentAddressDisplay')?.innerText||''}\n═══════════════\n💰 Всього: ${fmt.format(total)} ₴\n📈 Середній: ${fmt.format(avg)} ₴/міс\n📅 Записів: ${yr.length}\n🔥 Серія: ${streak} міс.\n═══════════════\nКомуналка PWA`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){prompt(":",t);}}
$('yearReportShareBtn')?.addEventListener('click',shareYearReport);
$('yearReportCloseBtn')?.addEventListener('click',()=>$('yearReportModal')?.classList.add('hidden'));

// =================== PWA ===================
let deferredPrompt;
let pendingServiceWorker=null;
let isRefreshingAfterUpdate=false;
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;$('pwaInstallBlock')?.classList.remove('hidden');});
$('installPwaBtn')?.addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();const{outcome}=await deferredPrompt.userChoice;if(outcome==='accepted')$('pwaInstallBlock')?.classList.add('hidden');deferredPrompt=null;});

// =================== PUSH ===================
let pushClient=null;
function renderPushState(state){
  const messages={unsupported:'Сповіщення недоступні. На iPhone додайте сайт на початковий екран і відкрийте звідти.',unconfigured:'Фонові сповіщення ще не налаштовані на сервері. Нагадування в застосунку працюють.',denied:'Сповіщення заблоковані. Дозвольте їх у налаштуваннях браузера.',available:'Увімкніть сповіщення, щоб отримувати нагадування після закриття застосунку.',connecting:'Підключення сповіщень…',enabled:'Сповіщення підключені. Розклад перевірено зараз; далі — щодня о 09:00 за Києвом.',error:'Підключення не підтверджено. Перевірте мережу й повторіть.'};
  const status=$('pushStatus');if(status){status.classList.remove('hidden');status.textContent=messages[state];}
  const button=$('enablePushBtn');if(button){button.classList.toggle('hidden',!['available','connecting','error'].includes(state));button.disabled=state==='connecting';}
  $('disablePushBtn')?.classList.toggle('hidden',state!=='enabled');
}
async function pushRegistration(){
  const reg=await navigator.serviceWorker.getRegistration();if(!reg?.active||!reg.pushManager)throw new Error('PUSH_NOT_READY');return reg;
}
async function initPush(){
  if(isGuest||!activeStore)return;
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window)){renderPushState('unsupported');return;}
  if(!pushClient)pushClient=KomunalkaPush.create({
    request:async(action,data={})=>{const response=action==='config'?await fetch(WORKER_URL+'?push-config=1',{cache:'no-store'}):await secureFetch('POST',{}, {action:'push_'+action,...data});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.error||'PUSH_REQUEST_FAILED');return result;},
    registration:pushRegistration,permission:{current:()=>Notification.permission,ask:()=>Notification.requestPermission()},
    subscribeOptions:key=>({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0))}),report:renderPushState
  });
  await pushClient.inspect();
}
$('enablePushBtn')?.addEventListener('click',async()=>{if(pushClient&&await pushClient.enable())localStorage.setItem('k_push_owner',sessionLogin);});
$('disablePushBtn')?.addEventListener('click',async()=>{if(pushClient&&await pushClient.disable())localStorage.removeItem('k_push_owner');});
async function detachPush(){
  if(!('serviceWorker'in navigator))return true;
  try{const reg=await navigator.serviceWorker.getRegistration(),sub=await reg?.pushManager?.getSubscription();if(sub){try{await secureFetch('POST',{}, {action:'push_unsubscribe',endpoint:sub.endpoint});}catch{}if(!await sub.unsubscribe())return false;}localStorage.removeItem('k_push_owner');return true;}catch{return false;}
}
setTimeout(initPush,1000);
window.addEventListener('online',initPush);

// =================== SHARE APP ===================
$('shareAppBtn')?.addEventListener('click',async()=>{const text='🏠 Комуналка — розумний облік комунальних платежів.\nВода, світло, газ — все в одному додатку. Безкоштовно!\n\nhttps://komynalka.vercel.app';if(navigator.share){try{await navigator.share({text,url:'https://komynalka.vercel.app'});return;}catch(e){}}try{await navigator.clipboard.writeText(text);showToast('Посилання скопійовано!','📋');}catch(e){prompt('Скопіюйте:',text);}});

// =================== LOGOUT ===================
async function logout(){
  if(isGuest){window.location.href=window.location.pathname;return;}
  if(confirm('Вийти? Локальний бекап і налаштування залишаться на пристрої.')){
    if(!saveDraft()||!saveToLocal())return;
    if(!await detachPush()){showToast('Не вдалося вимкнути сповіщення. Повторіть вихід.','⚠️');return;}
    ['k_login','k_passHash','k_uid','k_display_name'].forEach(key=>localStorage.removeItem(key));
    if(googleUser){try{await firebase.auth().signOut();}catch(e){}}
    location.reload();
  }
}
$('logoutBtn')?.addEventListener('click',logout);

// =================== SHARE ADDRESS ===================
$('shareAddressBtn')?.addEventListener('click',shareAddress);
async function shareAddress(){
  if(!sessionLogin&&!localStorage.getItem('k_uid')){showToast('Спочатку увійдіть','⚠️');return;}
  const btn=$('shareAddressBtn');if(btn)btn.style.opacity='0.6';
  showToast('Генерую посилання...','⏳');
  try{
    const res=await secureFetch('POST',{},{action:'generate_share',addressId:currentAddressId}),data=await res.json();
    if(btn)btn.style.opacity='1';
    if(!data.success||!data.shareToken){showToast(data.error||'Помилка','❌');return;}
    const shareUrl=`${window.location.origin}${window.location.pathname}?share=${data.shareToken}`,addrName=addresses.find(a=>String(a.id)===String(currentAddressId))?.name||'Мій дім';
    if(navigator.share){try{await navigator.share({title:'Комуналка',text:`Перегляд за "${addrName}"`,url:shareUrl});showToast('Надіслано!','✅');return;}catch(e){if(e.name==='AbortError')return;}}
    try{await navigator.clipboard.writeText(shareUrl);showToast('Посилання скопійовано!','📋');}catch(e){prompt('Скопіюйте:',shareUrl);}
  }catch(e){if(btn)btn.style.opacity='1';showToast('Помилка мережі','❌');}
}

// =================== ANALYTICS ===================
function renderAnalytics() {
  if (records.length < 3) {
    $('analyticsCard')?.classList.add('hidden');
    return;
  }
  $('analyticsCard')?.classList.remove('hidden');
  const sf = new SmartForecast(records);
  const now = new Date();
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2,'0')}`;
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`;

  // Прогноз
  const pred = sf.predict(nextMonth);
  if (pred && $('forecastValue')) {
    const confLabels = { high: '🟢 Висока', medium: '🟡 Середня', low: '🔴 Низька' };
    $('forecastValue').innerHTML = `<span class="text-3xl font-black">${fmt.format(pred.predicted)} ₴</span>`;
    $('forecastConfidence').innerHTML = `
      <span class="text-[9px] font-bold ${pred.confidence === 'high' ? 'text-green-500' : pred.confidence === 'medium' ? 'text-yellow-500' : 'text-red-400'}">${confLabels[pred.confidence]}</span>
      <span class="text-[9px] text-slate-400 ml-2">${new Date(nextMonth+'-01').toLocaleString('uk-UA',{month:'long'})}</span>
    `;
    $('forecastCard')?.classList.remove('hidden');
  } else {
    if (records.length >= 3) {
      const avg = Math.round(records.reduce((s,r) => s + r.total, 0) / records.length);
      if ($('forecastValue')) $('forecastValue').innerHTML = `<span class="text-3xl font-black">~ ${fmt.format(avg)} ₴</span>`;
      if ($('forecastConfidence')) $('forecastConfidence').innerHTML = `<span class="text-[9px] text-slate-400">Середнє за всі місяці (недостатньо даних для ML)</span>`;
    }
  }

  // YoY порівняння
  const yoy = sf.compareYearOverYear(curMonth);
  if (yoy && $('yoyCard')) {
    $('yoyCard')?.classList.remove('hidden');
    const icon = yoy.change < 0 ? '📉' : '📈';
    const color = yoy.change < 0 ? 'text-green-500' : yoy.change > 5 ? 'text-red-500' : 'text-slate-500';
    if ($('yoyContent')) $('yoyContent').innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-xs font-bold text-slate-500">${icon} ${new Date(curMonth+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'})}</span>
        <span class="text-lg font-black">${fmt.format(yoy.current)} ₴</span>
      </div>
      <div class="flex justify-between items-center mt-2">
        <span class="text-xs font-bold text-slate-500">vs ${new Date((parseInt(curMonth.split('-')[0])-1)+'-'+curMonth.split('-')[1]+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'})}</span>
        <span class="text-lg font-black ${color}">${yoy.change > 0 ? '+' : ''}${yoy.change}%</span>
      </div>
    `;
  } else {
    $('yoyCard')?.classList.add('hidden');
  }

  // Аномалії
  const anomalies = sf.detectAnomalies();
  if (anomalies.length > 0 && $('anomaliesCard')) {
    $('anomaliesCard')?.classList.remove('hidden');
    if ($('anomaliesList')) $('anomaliesList').innerHTML = anomalies.map(a => `
      <div class="flex justify-between items-center p-2 bg-red-50 dark:bg-red-500/10 rounded-xl">
        <span class="text-xs font-bold text-slate-600">${new Date(a.month+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'})}</span>
        <span class="text-xs font-black text-red-500">${fmt.format(a.total)} ₴ (${a.reason})</span>
      </div>
    `).join('');
  } else {
    $('anomaliesCard')?.classList.add('hidden');
  }

  // Ковзне середнє
  const ma12 = sf.getMovingAverage(12);
  const ma3 = sf.getMovingAverage(3);
  if ($('movingAvgContent')) $('movingAvgContent').innerHTML = `
    <div class="flex justify-between"><span class="text-xs font-bold text-slate-500">За 12 міс</span><span class="text-sm font-black">${fmt.format(ma12)} ₴</span></div>
    <div class="flex justify-between mt-2"><span class="text-xs font-bold text-slate-500">За 3 міс</span><span class="text-sm font-black">${fmt.format(ma3)} ₴</span></div>
  `;

  // Графік з прогнозом
  renderAnalyticsChart(sf, curMonth);
}

function renderAnalyticsChart(sf, curMonth) {
  if (!$('analyticsChartCanvas')) return;
  const canvas = $('analyticsChartCanvas');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height;

  ctx.clearRect(0, 0, width, height);
  const sorted = [...records].sort((a,b) => a.month.localeCompare(b.month));
  const last12 = sorted.slice(-12);

  if (!last12.length) {
    ctx.fillStyle = '#8e8e93';
    ctx.font = '12px -apple-system';
    ctx.textAlign = 'center';
    ctx.fillText('Немає даних', width/2, height/2);
    return;
  }

  const padding = { top: 20, bottom: 25, left: 40, right: 20 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = last12.map(r => r.total);
  const maxVal = Math.max(...values, 1);
  const barWidth = chartW / last12.length;
  const barPad = barWidth * 0.15;

  // Сітка
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 3; i++) {
    const y = padding.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Стовпчики
  last12.forEach((r, i) => {
    const barH = Math.max(2, (r.total / maxVal) * chartH);
    const x = padding.left + i * barWidth + barPad;
    const y = padding.top + chartH - barH;
    const w = barWidth - barPad * 2;
    const color = r.month === curMonth ? '#007aff' : isRecordPaid(r) ? '#34c759' : getPaymentStatus(r)==='partial' ? '#ffcc00' : '#ff9500';

    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, barH, 4) : ctx.rect(x, y, w, barH);
    ctx.fillStyle = color + '80';
    ctx.fill();

    // Мітка місяця
    ctx.fillStyle = '#8e8e93';
    ctx.font = 'bold 8px -apple-system';
    ctx.textAlign = 'center';
    ctx.fillText(new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3), x + w / 2, height - 8);
  });

  // Пунктирна лінія прогнозу
  if (last12.length >= 3) {
    const trend = sf.calcTrend();
    if (trend) {
      ctx.strokeStyle = '#007aff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      const startX = padding.left;
      const endX = padding.left + chartW;
      const startY = padding.top + chartH - ((trend.intercept) / maxVal) * chartH;
      const endY = padding.top + chartH - ((trend.slope * (last12.length) + trend.intercept) / maxVal) * chartH;
      ctx.beginPath();
      ctx.moveTo(startX, Math.max(padding.top, Math.min(padding.top + chartH, startY)));
      ctx.lineTo(endX, Math.max(padding.top, Math.min(padding.top + chartH, endY)));
      ctx.stroke();
      ctx.setLineDash([]);

      // Мітка "Прогноз"
      ctx.fillStyle = '#007aff';
      ctx.font = 'bold 9px -apple-system';
      ctx.textAlign = 'left';
      ctx.fillText('📈 Тренд', width - padding.right - 50, padding.top + 10);
    }
  }
}

// =================== INIT APP UI ===================
function initAppUI(){
  $('authScreen')?.classList.add('hidden');
  $('appScreen')?.classList.remove('hidden');
  $('appScreen')?.classList.add('flex');
  applyLiquidGlassLevel(currentLiquidGlass);
  if($('tWater'))         $('tWater').value        =tariffs.water;
  if($('tHotWater'))      $('tHotWater').value      =tariffs.hotWater;
  if($('tElectroBase'))   $('tElectroBase').value   =tariffs.electroBase;
  if($('tElectroWinter')) $('tElectroWinter').value =tariffs.electroWinter;
  if($('tGas'))           $('tGas').value           =tariffs.gas;
  if($('budgetInput'))    $('budgetInput').value    =accountStorage.getItem('k_budget')||'';
  if($('accountLoginDisplay'))$('accountLoginDisplay').textContent=sessionLogin||'—';
  updateGoogleButton();
  updateDisplayName();
  renderTariffPresets();
  applyPreferences();
  renderCalcCustomServices();
  setPaymentInputsFromRecord(null);
  fillPreviousReadings();
  const currentTab=window.location.hash==='#calc'&&!isGuest?'tabCalc':(document.querySelector('.tab-active')?.id||'tabDashboard');
  switchTab(currentTab,tabIds.indexOf(currentTab));
  calculatePreview();
  updateSmartBadges();
  renderDashboard();
  renderDataHealth();
  initPush();

  const vis=readingInputIds.map(id=>$(id)).filter(el=>el&&el.offsetParent!==null);
  vis.forEach((input,idx,arr)=>{input.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();const next=arr[idx+1];if(next)next.focus();else $('submitFormBtn')?.focus();}});});

  // Init AI
  requestAnimationFrame(()=>{
    if(typeof initAI==='function'){
      initAI();
    } else {
      const checkAI=setInterval(()=>{if(typeof initAI==='function'){clearInterval(checkAI);initAI();}},100);
      setTimeout(()=>clearInterval(checkAI),5000);
    }
  });
}

// =================== GUEST / AUTO-LOGIN ===================
if(urlShareToken){
  isGuest=true;
  $('authScreen')?.classList.add('hidden');
  $('appScreen')?.classList.remove('hidden');
  $('appScreen')?.classList.add('flex');
  if($('btnTabSettings'))      $('btnTabSettings').style.display      ='none';
  if($('addressHeaderTrigger'))$('addressHeaderTrigger').style.pointerEvents='none';
  if($('addressArrowIcon'))    $('addressArrowIcon').style.display    ='none';
  if($('aiFabBtn'))            $('aiFabBtn').style.display            ='none';
  showToast('Завантажую доступ...','⏳');
  fetch(`${WORKER_URL}?share=${urlShareToken}`,{cache:"no-store"})
    .then(r=>r.json())
    .then(data=>{if(data.success){const normalized=normalizeImportData(data.data);addresses=normalized?.addresses||data.data.addresses;currentAddressId=normalized?.currentAddressId||data.data.currentAddressId;loadCurrentAddress();showToast('Гостьовий доступ відкрито','✅');}else showActionToast('Посилання недійсне','На вхід',()=>{window.location.href=window.location.pathname;},'⚠️');})
    .catch(()=>showActionToast('Не вдалося завантажити','Повторити',()=>window.location.reload(),'❌'));
} else {
  const uid=localStorage.getItem('k_uid');
  if(!navigator.onLine&&initialDeviceLogin){
    try{activeStore=KomunalkaData.create(localStorage,initialDeviceLogin);const state=activeStore.read();if(state){sessionLogin=initialDeviceLogin;authUid=uid;bindAccount(initialDeviceLogin,state.base,state.revision,2);applySnapshot(activeStore.read().local);setSyncState('offline');}else activeStore=null;}catch(e){showToast('Локальну копію не вдалося відкрити. Оригінал збережено.','⚠️');}
  }else if(uid){
    const unsubscribe=firebase.auth().onAuthStateChanged(user=>{unsubscribe();if(user&&user.uid===uid){googleUser=user;performLogin(null,null,false,uid);}else{if($('authError')){$('authError').textContent='Увійдіть через Google, щоб відкрити свої дані.';$('authError').classList.remove('hidden');}}});
  }else if(sessionLogin&&sessionPass)performLogin(sessionLogin,sessionPass,true);
}

$('mode-light')?.addEventListener('click',()=>setThemeMode('light'));
$('mode-auto')?.addEventListener('click', ()=>setThemeMode('auto'));
$('mode-dark')?.addEventListener('click', ()=>setThemeMode('dark'));
$('liquidGlassRange')?.addEventListener('input',(e)=>applyLiquidGlassLevel(e.target.value));
$('liquidGlassRange')?.addEventListener('change',(e)=>{localStorage.setItem('liquidGlassLevel',String(currentLiquidGlass));showToast(`Скло: ${currentLiquidGlass}%`,'✨');});

// =================== RESIZE ===================
let resizeTimeout;
window.addEventListener('resize',()=>{clearTimeout(resizeTimeout);resizeTimeout=setTimeout(()=>{[dashChart,historyChart,serviceChart,donutChart].forEach(chart=>{if(chart&&chart.canvas){chart.setupCanvas();if(chart.width)chart.render();}});},250);});

// =================== LAZY CHARTS ===================
const chartObserver=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(!entry.isIntersecting)return;const id=entry.target.id;if(id==='dashChartCanvas'   &&dashChart)   {dashChart.setupCanvas();   dashChart.render();}if(id==='donutCanvas'       &&donutChart)  {donutChart.setupCanvas();  donutChart.render();}if(id==='historyChartCanvas'&&historyChart){historyChart.setupCanvas();historyChart.render();}if(id==='serviceChartCanvas'&&serviceChart){serviceChart.setupCanvas();serviceChart.render();}});},{threshold:0.1});
['dashChartCanvas','donutCanvas','historyChartCanvas','serviceChartCanvas'].forEach(id=>{const el=$(id);if(el)chartObserver.observe(el);});

// =================== SW UPDATE ===================
let updateRegistration=null,updateManager=null;
async function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});updateRegistration=registration;
    updateManager=KomunalkaUpdates.create({controller:()=>navigator.serviceWorker.controller,onReady:worker=>{pendingServiceWorker=worker;showUpdateBanner();},onClear:()=>{pendingServiceWorker=null;$('updateBanner')?.remove();}});
    const check=()=>updateManager.check(registration);
    registration.addEventListener('updatefound',()=>{const next=registration.installing;if(next)next.addEventListener('statechange',()=>{if(next.state==='installed'||next.state==='redundant')check();});});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      updateManager.clear();if(!isRefreshingAfterUpdate)return;
      if(saveDraft())window.location.reload();
    });
    await check();initPush();
    setInterval(()=>{if(navigator.onLine)registration.update().then(check).catch(()=>{});},1800000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){check();checkReminders();}});
  }catch(e){console.error('SW:',e);}
}
window.addEventListener('load',registerServiceWorker);
function showUpdateBanner(){
  if(!pendingServiceWorker||pendingServiceWorker.state!=='installed'||$('updateBanner'))return;
  const banner=document.createElement('div');banner.id='updateBanner';banner.className='fixed bottom-24 left-4 right-4 z-[900] bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-4 rounded-2xl flex items-center justify-between shadow-2xl max-w-md mx-auto';
  banner.innerHTML='<div><p class="text-sm font-bold">Доступна нова версія</p><p class="text-xs opacity-70">Чернетки збережуться під час оновлення</p></div><button id="applyUpdateBtn" type="button" class="px-4 py-2 bg-brand text-white rounded-xl">Оновити</button>';
  document.body.appendChild(banner);
  $('applyUpdateBtn').addEventListener('click',async()=>{
    const button=$('applyUpdateBtn');button.disabled=true;
    if(!await updateManager.check(updateRegistration)){return;}
    if(!saveDraft()||(activeStore&&(syncCurrentAddress(),!saveToLocal()))){button.disabled=false;return;}
    const waiting=updateManager.current();if(!waiting)return;
    isRefreshingAfterUpdate=true;waiting.postMessage({type:'SKIP_WAITING'});
  });
}

// =================== HISTORICAL RECORD EDITING ===================
function editRecordById(id){
  if(!requireEdit('У режимі перегляду не можна редагувати записи')||!saveDraft())return;
  const rec=records.find(r=>String(r.id)===String(id));if(!rec)return;
  $('monthInput').value=rec.month;fillPreviousReadings();showEditingBanner(rec.month);switchTab('tabCalc',1);calculatePreview();updateSmartBadges();
}

function showEditingBanner(month) {
  const existing = $('editingBanner');
  if (existing) existing.remove();
  const mLabel = new Date(month + '-01').toLocaleString('uk-UA', {month:'long', year:'numeric'});
  const banner = document.createElement('div');
  banner.id = 'editingBanner';
  banner.className = 'mx-auto max-w-md px-5 mb-2';
  banner.innerHTML = `<div class="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2.5">
      <span class="text-base">✏️</span>
      <div>
        <p class="text-xs font-black text-amber-700 dark:text-amber-400">Редагування: ${escapeHtml(mLabel)}</p>
        <p class="text-[10px] text-amber-600/70 dark:text-amber-500/70">Незмінені суми збережуться. Нові показники — за тарифами запису.</p>
      </div>
    </div>
    <button type="button" class="editing-banner-close w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 flex items-center justify-center text-xs active:scale-90" aria-label="Закрити повідомлення про редагування">✕</button>
  </div>`;
  banner.querySelector('.editing-banner-close')?.addEventListener('click',()=>banner.remove());
  const calcTab = $('tabCalc');
  if (calcTab) calcTab.insertBefore(banner, calcTab.firstChild);
}

// =================== CUSTOM REMINDERS ===================
function getCustomReminders(){return KomunalkaReminders.schedule({prefs},activeSettings);}
function saveCustomReminders(reminders){
  for(const [id,key] of [['water','Water'],['electro','Electro'],['gas','Gas']]){const rem=reminders.find(r=>r.id===id&&!r.deleted);if(rem){prefs[`rem${key}Start`]=rem.startDay;prefs[`rem${key}End`]=rem.endDay;if($('rem'+key+'Start'))$('rem'+key+'Start').value=rem.startDay;if($('rem'+key+'End'))$('rem'+key+'End').value=rem.endDay;}}
  let saved=[];try{saved=JSON.parse(accountStorage.getItem(CUSTOM_REMINDERS_KEY)||'[]');}catch{}
  const deleted=Array.isArray(saved)?saved.filter(r=>r?.deleted&&!reminders.some(item=>item.id===r.id)):[];
  accountStorage.setItem(CUSTOM_REMINDERS_KEY,JSON.stringify([...deleted,...reminders]));checkReminders();
}

function renderCustomReminders() {
  const container = $('customRemindersList');
  if (!container) return;
  const reminders = getCustomReminders();
  container.innerHTML = reminders.map((rem, idx) => `
    <div class="reminder-card" data-rem-id="${escapeAttr(rem.id)}">
      <div class="reminder-heading">
        <input type="text" value="${escapeAttr(rem.emoji)}" aria-label="Значок нагадування" data-rem-idx="${idx}" data-rem-field="emoji" class="rem-field reminder-emoji">
        <input type="text" value="${escapeAttr(rem.label)}" aria-label="Назва нагадування" data-rem-idx="${idx}" data-rem-field="label" class="rem-field">
        <label class="reminder-toggle" title="Увімкнути нагадування">
          <input type="checkbox" ${rem.active ? 'checked' : ''} aria-label="Увімкнути нагадування ${escapeAttr(rem.label)}" data-rem-idx="${idx}" data-rem-field="active" class="rem-field">
        </label>
      </div>
      <div class="reminder-period">
        <label>З числа<input type="number" value="${rem.startDay}" min="1" max="31" inputmode="numeric" data-rem-idx="${idx}" data-rem-field="startDay" class="rem-field"></label>
        <label>По число<input type="number" value="${rem.endDay}" min="1" max="31" inputmode="numeric" data-rem-idx="${idx}" data-rem-field="endDay" class="rem-field"></label>
        <button type="button" class="rem-del" aria-label="Видалити нагадування ${escapeAttr(rem.label)}" title="Видалити нагадування" data-rem-idx="${idx}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.rem-field').forEach(input => {
    input.addEventListener('change', () => {
      const reminders = getCustomReminders();
      const idx = parseInt(input.dataset.remIdx);
      const field = input.dataset.remField;
      if (field === 'active') reminders[idx][field] = input.checked;
      else if (field === 'startDay' || field === 'endDay') {reminders[idx][field] = Math.max(1,Math.min(31,parseInt(input.value)||1));input.value=reminders[idx][field];}
      else reminders[idx][field] = input.value;
      saveCustomReminders(reminders);
    });
  });
  container.querySelectorAll('.rem-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const reminders = getCustomReminders();
      const [removed]=reminders.splice(parseInt(btn.dataset.remIdx),1);
      if(['water','electro','gas'].includes(removed.id))reminders.push({...removed,deleted:true,active:false});
      saveCustomReminders(reminders);
      renderCustomReminders();
      showToast('Нагадування видалено', '🗑');
    });
  });
}

$('addCustomReminderBtn')?.addEventListener('click', () => {
  const reminders = getCustomReminders();
  reminders.push({ id: 'rem_' + Date.now(), emoji: '🔔', label: 'Моє нагадування', startDay: 1, endDay: 5, active: true, deletable: true });
  saveCustomReminders(reminders);
  renderCustomReminders();
  showToast('Нагадування додано', '🔔');
});

// Розширена перевірка нагадувань (враховує кастомні)
function checkRemindersExtended(){
  const due=currentReminderItems();$('reminderBanner')?.classList.toggle('hidden',!due.length);
  if($('reminderText'))$('reminderText').textContent='Передайте: '+due.map(rem=>`${rem.emoji||'🔔'} ${rem.label}`).join(', ');
}

// =================== COMMUNITY TARIFF PRESETS ===================
let cloudCommunityTariffsCache = [];
const TARIFF_SERVICE_LABELS = { all: 'Усі послуги', water: 'Вода', hotWater: 'Гаряча вода', electro: 'Світло', gas: 'Газ' };

function getCommunityTariffs() {
  try {
    const raw = accountStorage.getItem(COMMUNITY_TARIFF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(item => item?.id && item?.name && item?.tariffs) : [];
    }
  } catch(e) {}
  return [];
}

function getCommunityTariffMetadata() {
  return {
    city: String($('communityTariffCity')?.value || '').trim().slice(0, 40),
    region: String($('communityTariffRegion')?.value || '').trim().slice(0, 40),
    serviceType: String($('communityTariffService')?.value || 'all'),
  };
}

function getCurrentTariffFormData() {
  const num = (id, fallback) => {
    const value = parseFloat($(id)?.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    water:         num('tWater', defaultTariffs.water),
    hotWater:      num('tHotWater', defaultTariffs.hotWater),
    electroBase:   num('tElectroBase', defaultTariffs.electroBase),
    electroWinter: num('tElectroWinter', defaultTariffs.electroWinter),
    gas:           num('tGas', defaultTariffs.gas),
  };
}

function isValidCommunityTariff(tariffData) {
  if (!tariffData || typeof tariffData !== 'object') return false;
  const values = ['water', 'hotWater', 'electroBase', 'electroWinter', 'gas'].map(key => Number(tariffData[key]) || 0);
  const [water, hotWater, electroBase, electroWinter, gas] = values;
  if (values.some(v => v < 0)) return false;
  if (water <= 0 && electroBase <= 0 && gas <= 0) return false;
  return water <= 10000 && hotWater <= 10000 && electroBase <= 1000 && electroWinter <= 1000 && gas <= 1000;
}

function setCommunityTariffStatus(message, type = 'info') {
  const el = $('communityTariffStatus');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  const classes = {
    success: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20',
    warning: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20',
    error: 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 border border-red-200 dark:border-red-500/20',
    info: 'bg-slate-50 dark:bg-black/40 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-white/5',
  };
  el.className = `text-[9px] font-bold rounded-lg px-2.5 py-2 mb-2 ${classes[type] || classes.info}`;
  el.textContent = message;
}

function saveCommunityTariff(name, tariffData, metadata = {}) {
  const list = getCommunityTariffs();
  const cleanName = name.trim().slice(0, 60);
  const normalName = cleanName.toLowerCase();
  const existingIdx = list.findIndex(item => item.name.trim().toLowerCase() === normalName);
  const entry = {
    id: existingIdx >= 0 ? list[existingIdx].id : 'custom_' + Date.now(),
    name: cleanName,
    tariffs: tariffData,
    city: String(metadata.city || '').trim().slice(0, 40),
    region: String(metadata.region || '').trim().slice(0, 40),
    serviceType: TARIFF_SERVICE_LABELS[metadata.serviceType] ? metadata.serviceType : 'all',
    verified: !!metadata.verified,
    votes: Math.max(0, parseInt(metadata.votes || 0, 10) || 0),
    createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) list.splice(existingIdx, 1);
  list.unshift(entry);
  const trimmed = list.slice(0, 20);
  try { accountStorage.setItem(COMMUNITY_TARIFF_KEY, JSON.stringify(trimmed)); } catch(e) {}
  return entry.id;
}

function deleteCommunityTariff(id) {
  const list = getCommunityTariffs().filter(t => t.id !== id);
  try { accountStorage.setItem(COMMUNITY_TARIFF_KEY, JSON.stringify(list)); } catch(e) {}
}

function renderCommunityTariffs() {
  const container = $('communityTariffsList');
  if (!container) return;
  const list = getCommunityTariffs();
  if (!list.length) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-2">Немає збережених тарифів</p>';
    return;
  }
  container.innerHTML = list.map(item => `
    <div class="flex items-center gap-2 bg-slate-50 dark:bg-black/40 p-2.5 rounded-xl border border-slate-100 dark:border-white/5">
      <div class="flex-1 min-w-0">
        <p class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${escapeHtml(item.name)}${item.verified ? ' · ✓' : ''}</p>
        <p class="text-[9px] text-slate-400 mt-0.5">${escapeHtml([item.city, item.region, TARIFF_SERVICE_LABELS[item.serviceType]].filter(Boolean).join(' · ')) || 'Без регіону'}</p>
        <p class="text-[9px] text-slate-400 mt-0.5">💧${item.tariffs.water} ⚡${item.tariffs.electroBase} 🔥${item.tariffs.gas} ₴${item.votes ? ` · ${item.votes} голосів` : ''}</p>
      </div>
      <button type="button" class="comm-load px-3 py-1.5 bg-brand-light text-brand rounded-lg text-[10px] font-bold border border-brand-border active:scale-95 transition-transform shrink-0" data-comm-id="${escapeAttr(item.id)}">Застосувати</button>
      <button type="button" class="comm-del w-7 h-7 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-400 flex items-center justify-center text-xs active:scale-90 shrink-0" data-comm-id="${escapeAttr(item.id)}"><i class="fa-solid fa-trash text-[9px]"></i></button>
    </div>
  `).join('');
  container.querySelectorAll('.comm-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = getCommunityTariffs().find(t => t.id === btn.dataset.commId);
      if (!item) return;
      fillTariffInputs({ ...defaultTariffs, ...item.tariffs });
      renderTariffPresets();
      showToast(`Тариф "${item.name}" застосовано`, '✅');
    });
  });
  container.querySelectorAll('.comm-del').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteCommunityTariff(btn.dataset.commId);
      renderCommunityTariffs();
      renderTariffPresets();
      showToast('Видалено', '🗑');
    });
  });
}

async function publishCommunityTariffToCloud(name, tariffData) {
  const metadata = getCommunityTariffMetadata();
  const res = await secureFetch('POST', {}, {
    action: 'publish_tariff',
    name: name.trim(),
    tariffs: tariffData,
    ...metadata,
    author: displayName || sessionLogin || 'Анонім'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

$('saveCommunityTariffBtn')?.addEventListener('click', async () => {
  const nameInput = $('communityTariffName');
  const name = nameInput?.value?.trim();
  if (!name) { showToast('Введіть назву населеного пункту', '⚠️'); nameInput?.focus(); return; }
  const tariffData = getCurrentTariffFormData();
  const metadata = getCommunityTariffMetadata();
  if (!isValidCommunityTariff(tariffData)) {
    setCommunityTariffStatus('Перевірте тарифи: потрібен хоча б один реальний тариф і без надто великих значень.', 'error');
    showToast('Некоректні тарифи', '⚠️');
    return;
  }
  setCommunityTariffStatus('Зберігаю локально і публікую для інших користувачів...', 'info');
  saveCommunityTariff(name, tariffData, metadata);
  if (nameInput) nameInput.value = '';
  if ($('communityTariffCity')) $('communityTariffCity').value = '';
  if ($('communityTariffRegion')) $('communityTariffRegion').value = '';
  if ($('communityTariffService')) $('communityTariffService').value = 'all';
  renderCommunityTariffs();
  renderTariffPresets();
  addChangeLog('community_tariff_saved', { provider: name.trim() });
  renderChangeLog();
  try {
    await publishCommunityTariffToCloud(name, tariffData);
    setCommunityTariffStatus('Готово: постачальник збережений у вас і доступний іншим користувачам.', 'success');
    showToast(`Постачальника "${name}" опубліковано`, '🌐');
    loadCloudCommunityTariffs();
  } catch(e) {
    setCommunityTariffStatus('Збережено тільки на цьому пристрої. Хмарна публікація не вдалася, спробуйте ще раз пізніше.', 'warning');
    showToast('Локально збережено, хмара недоступна', '⚠️');
  }
});

// =================== CLOUD COMMUNITY TARIFFS ===================
function tariffMatchesCloudFilters(item) {
  const query = String($('cloudTariffSearch')?.value || '').trim().toLowerCase();
  const service = String($('cloudTariffServiceFilter')?.value || 'all');
  const haystack = [item.name, item.city, item.region, item.author].filter(Boolean).join(' ').toLowerCase();
  const serviceType = item.serviceType || 'all';
  return (!query || haystack.includes(query)) && (service === 'all' || serviceType === service || serviceType === 'all');
}

function renderCloudCommunityTariffs() {
  const container = $('cloudTariffsList');
  if (!container) return;
  const filtered = cloudCommunityTariffsCache.filter(tariffMatchesCloudFilters).slice(0, 30);
  if (!filtered.length) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-2">Нічого не знайдено</p>';
    return;
  }
  container.innerHTML = filtered.map(item => `
    <div class="flex items-center gap-2 bg-slate-50 dark:bg-black/40 p-2.5 rounded-xl border border-slate-100 dark:border-white/5">
      <div class="flex-1 min-w-0">
        <p class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${item.verified ? '<span class="text-emerald-500">✓</span> ' : ''}${escapeHtml(item.name)}</p>
        <p class="text-[9px] text-slate-400 mt-0.5">${escapeHtml([item.city, item.region, TARIFF_SERVICE_LABELS[item.serviceType || 'all']].filter(Boolean).join(' · ')) || 'Без регіону'}</p>
        <p class="text-[9px] text-slate-400 mt-0.5">💧${item.tariffs?.water||'—'} ⚡${item.tariffs?.electroBase||'—'} 🔥${item.tariffs?.gas||'—'} ₴ · ${Math.max(0, item.votes || 0)} голосів · від ${escapeHtml(item.author||'?')}</p>
      </div>
      <div class="flex gap-1 shrink-0">
        <button type="button" class="cloud-tariff-vote w-8 h-8 bg-white dark:bg-[#2c2c2e] text-emerald-500 rounded-lg text-[10px] font-bold border border-emerald-200 dark:border-emerald-500/20 active:scale-95 transition-transform" data-cloud-id="${escapeAttr(item.id)}" title="Підтвердити тариф"><i class="fa-solid fa-thumbs-up"></i></button>
        <button type="button" class="cloud-tariff-load px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-bold border border-emerald-200 dark:border-emerald-500/20 active:scale-95 transition-transform" data-cloud-id="${escapeAttr(item.id)}">Застосувати</button>
      </div>
    </div>
  `).join('');
  const cloudById = new Map(cloudCommunityTariffsCache.map(item => [String(item.id), item]));
  container.querySelectorAll('.cloud-tariff-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = cloudById.get(String(btn.dataset.cloudId));
      if (!item || !isValidCommunityTariff(item.tariffs)) return showToast('Помилка тарифу', '❌');
      const tariffData = { ...defaultTariffs, ...item.tariffs };
      fillTariffInputs(tariffData);
      saveCommunityTariff(item.name, tariffData, item);
      renderCommunityTariffs();
      renderTariffPresets();
      addChangeLog('cloud_tariff_loaded', { provider: item.name });
      renderChangeLog();
      setCommunityTariffStatus(`Постачальника "${item.name}" додано у ваші шаблони.`, 'success');
      showToast(`"${item.name}" застосовано`, '🌐');
    });
  });
  container.querySelectorAll('.cloud-tariff-vote').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const res = await secureFetch('POST', {}, { action: 'vote_tariff', id: btn.dataset.cloudId });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'ERROR');
        const item = cloudCommunityTariffsCache.find(t => String(t.id) === String(btn.dataset.cloudId));
        if (item) item.votes = data.votes;
        renderCloudCommunityTariffs();
        showToast('Голос зараховано', '👍');
      } catch(e) {
        showToast(e.message === 'ALREADY_VOTED' ? 'Ви вже голосували' : 'Не вдалося проголосувати', '⚠️');
      }
    });
  });
}

async function loadCloudCommunityTariffs() {
  const container = $('cloudTariffsList');
  if (!container) return;
  container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-2 animate-pulse">Завантаження...</p>';
  try {
    const res = await secureFetch('POST', {}, { action: 'get_tariffs' });
    if (!res.ok) { container.innerHTML = '<p class="text-[10px] text-red-400 text-center py-2">Помилка завантаження</p>'; return; }
    const data = await res.json();
    if (!data.success || !Array.isArray(data.tariffs) || !data.tariffs.length) {
      cloudCommunityTariffsCache = [];
      container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-2">Поки немає тарифів від спільноти</p>';
      return;
    }
    cloudCommunityTariffsCache = data.tariffs;
    renderCloudCommunityTariffs();
  } catch(e) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-2">Немає зв\'язку з сервером</p>';
  }
}

$('cloudTariffSearch')?.addEventListener('input', renderCloudCommunityTariffs);
$('cloudTariffServiceFilter')?.addEventListener('change', renderCloudCommunityTariffs);

// Розширений renderTariffPresets — додає community тарифи
function renderTariffPresetsExtended() {
  const select = $('tariffPresetSelect');
  if (!select) return;
  const community = getCommunityTariffs();
  let html = '<option value="">Обрати місто / постачальника</option>';
  if (community.length) {
    html += `<optgroup label="📍 Мої тарифи">`;
    html += community.map(item => `<option value="comm_${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    html += '</optgroup>';
    html += `<optgroup label="🏙️ Базові шаблони">`;
  }
  html += TARIFF_PRESETS.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  if (community.length) html += '</optgroup>';
  select.innerHTML = html;
}

// Перевизначаємо renderTariffPresets через присвоєння (не через function declaration,
// щоб уникнути рекурсії через JS hoisting)
const _renderTariffPresetsBase = renderTariffPresets;
renderTariffPresets = function() { renderTariffPresetsExtended(); };

// Розширений applyTariffPreset — підтримує community
// Зберігаємо оригінал через const (не перевизначаємо function — інакше hoisting викликає рекурсію)
const _applyTariffPresetBase = applyTariffPreset;
applyTariffPreset = function(presetId) {
  if (presetId.startsWith('comm_')) {
    const id = presetId.replace('comm_', '');
    const item = getCommunityTariffs().find(t => t.id === id);
    if (!item) return;
    fillTariffInputs({ ...defaultTariffs, ...item.tariffs });
    showToast(`"${item.name}" застосовано`, '🏙️');
    return;
  }
  _applyTariffPresetBase(presetId);
};

// =================== FIX: HIDE DISABLED SERVICES IN RECORD CARD ===================
function createRecordCard(rec) {
  const card = document.createElement('div');
  const recPaid = isRecordPaid(rec), paymentStatus = getPaymentStatus(rec), paidAmount = getPaidAmount(rec), outstanding = getOutstandingAmount(rec);
  card.className = `premium-card swipe-card p-5 relative overflow-hidden cursor-pointer select-none ${recPaid ? '' : 'ring-1 ring-orange-400/20'}`;
  const dStr = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long' });
  const [rY, rM] = rec.month.split('-');

  // Рахуємо лише активні послуги
  const showW  = (rec._filled?.water    || rec.waterCost > 0);
  const showHW = (rec._filled?.hotWater || rec.hotWaterCost > 0);
  const showE  = (rec._filled?.electro  || rec.electroCost > 0);
  const showG  = (rec._filled?.gas      || rec.gasCost > 0);
  const showC  = rec.customCost > 0;

  const filledServices = [];
  if (showW)  filledServices.push('💧');
  if (showHW) filledServices.push('🌡️');
  if (showE)  filledServices.push('⚡');
  if (showG)  filledServices.push('🔥');
  if (showC)  filledServices.push('📦');

  const totalExp = (prefs.showWater?1:0)+(prefs.showHotWater?1:0)+(prefs.showElectro?1:0)+(prefs.showGas?1:0)+(customServices.length>0?1:0);
  const isPartial = filledServices.length < totalExp && filledServices.length > 0;
  const partialBadge = isPartial ? `<span class="text-[9px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-md ml-2">Частково</span>` : '';
  const prevYR = records.find(r => r.month === (parseInt(rY)-1) + '-' + rM);
  let yoy = '';
  if (prevYR && prevYR.total > 0 && rec.total > 0) {
    const p = Math.round(((rec.total - prevYR.total) / prevYR.total) * 100);
    if (p < 0) yoy = `<span class="text-[9px] font-bold text-green-600 bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-md ml-2">↓${Math.abs(p)}%</span>`;
    else if (p > 0) yoy = `<span class="text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-md ml-2">↑+${p}%</span>`;
  }

  // Доля тільки активних
  const activeTotal = (showW ? rec.waterCost||0 : 0) + (showHW ? rec.hotWaterCost||0 : 0) + (showE ? rec.electroCost||0 : 0) + (showG ? rec.gasCost||0 : 0) + (showC ? rec.customCost||0 : 0);
  const pW  = activeTotal > 0 ? ((showW  ? rec.waterCost||0    : 0) / activeTotal) * 100 : 0;
  const pHW = activeTotal > 0 ? ((showHW ? rec.hotWaterCost||0 : 0) / activeTotal) * 100 : 0;
  const pE  = activeTotal > 0 ? ((showE  ? rec.electroCost||0  : 0) / activeTotal) * 100 : 0;
  const pG  = activeTotal > 0 ? ((showG  ? rec.gasCost||0      : 0) / activeTotal) * 100 : 0;
  const conic = `conic-gradient(#3b82f6 0% ${pW}%,#ef4444 ${pW}% ${pW+pHW}%,#eab308 ${pW+pHW}% ${pW+pHW+pE}%,#f97316 ${pW+pHW+pE}% ${pW+pHW+pE+pG}%,#a855f7 ${pW+pHW+pE+pG}% 100%)`;
  const recId = rec.id;

  // Перевірка зміни тарифу
  let tariffChangedBadge = '';
  if (rec.tariffSnapshot) {
    const changed = [];
    if (showW  && Math.abs((rec.tariffSnapshot.water||0)      - tariffs.water)       > 0.001) changed.push('💧');
    if (showHW && Math.abs((rec.tariffSnapshot.hotWater||0)   - tariffs.hotWater)    > 0.001) changed.push('🌡️');
    if (showE  && Math.abs((rec.tariffSnapshot.electroBase||0)- tariffs.electroBase) > 0.001) changed.push('⚡');
    if (showG  && Math.abs((rec.tariffSnapshot.gas||0)        - tariffs.gas)         > 0.001) changed.push('🔥');
    if (changed.length) tariffChangedBadge = `<span class="text-[9px] font-bold text-violet-600 bg-violet-50 dark:bg-violet-500/10 px-2 py-0.5 rounded-md ml-1" title="Тариф змінився з часу запису">⚠️ тариф ${changed.join('')}</span>`;
  }

  card.innerHTML = `
    ${!recPaid ? '<div class="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-orange-400/15 to-transparent rounded-bl-[4rem]"></div>' : ''}
    <div class="flex justify-between items-center relative z-10" data-toggle-details="${escapeAttr(recId)}" role="button" tabindex="0" aria-expanded="false">
      <div>
        <h4 class="font-bold text-xl capitalize text-slate-900 dark:text-white mb-1.5">${escapeHtml(dStr)}</h4>
        <div class="flex items-center flex-wrap gap-1">
          <span class="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${recPaid ? 'bg-brand-light text-brand' : paymentStatus === 'partial' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'}">${getPaymentLabel(rec)}</span>
          ${partialBadge}${yoy}${tariffChangedBadge}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="font-black text-2xl text-slate-900 dark:text-white">${fmt.format(rec.total)} ₴</span>
        <div class="w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-white/5 rounded-full text-slate-400"><i class="chevron-icon fa-solid fa-chevron-down transition-transform duration-300"></i></div>
      </div>
    </div>
    <div class="details-panel hidden">
      <div class="border-t border-slate-100 dark:border-white/5 pt-5 mt-5">
        ${rec.total > 0 ? `<div class="flex items-center gap-4 bg-slate-50 dark:bg-black/50 p-4 rounded-2xl border border-slate-100 dark:border-white/5 mb-5"><div class="w-14 h-14 rounded-full shrink-0 shadow-sm border border-slate-200 dark:border-white/10" style="background:${conic}"></div><div class="flex flex-col gap-1 text-[10px] font-bold text-slate-500 w-full">${pW>0?`<div class="flex justify-between"><span>💧 Вода</span><span>${Math.round(pW)}%</span></div>`:''}${pHW>0?`<div class="flex justify-between"><span>🌡️ Гар.</span><span>${Math.round(pHW)}%</span></div>`:''}${pE>0?`<div class="flex justify-between"><span>⚡ Світло</span><span>${Math.round(pE)}%</span></div>`:''}${pG>0?`<div class="flex justify-between"><span>🔥 Газ</span><span>${Math.round(pG)}%</span></div>`:''}${(100-pW-pHW-pE-pG)>1?`<div class="flex justify-between"><span>📦 Інше</span><span>${Math.round(100-pW-pHW-pE-pG)}%</span></div>`:''}</div></div>` : ''}
        <div class="space-y-3">
          ${showW ? `<div class="flex justify-between"><span class="font-bold">💧 Вода</span><span class="font-black">${fmt.format(rec.waterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.wPrev}→${rec.wCur}</span><span class="text-blue-500">+${rec.wCur-rec.wPrev} м³</span></div>` : ''}
          ${showHW ? `<div class="flex justify-between"><span class="font-bold">🌡️ Гар.</span><span class="font-black">${fmt.format(rec.hotWaterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.hwPrev}→${rec.hwCur}</span><span class="text-red-500">+${rec.hwCur-rec.hwPrev} м³</span></div>` : ''}
          ${showE ? `<div class="flex justify-between"><span class="font-bold">⚡ Світло</span><span class="font-black">${fmt.format(rec.electroCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>Д:${rec.dPrev}→${rec.dCur}</span><span class="text-yellow-600">+${rec.dCur-rec.dPrev}</span></div>${(rec.nCur||rec.nPrev)?`<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl mt-1"><span>Н:${rec.nPrev}→${rec.nCur}</span><span class="text-indigo-500">+${rec.nCur-rec.nPrev}</span></div>`:''}` : ''}
          ${showG ? `<div class="flex justify-between"><span class="font-bold">🔥 Газ</span><span class="font-black">${fmt.format(rec.gasCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.gPrev}→${rec.gCur}</span><span class="text-orange-500">+${rec.gCur-rec.gPrev} м³</span></div>` : ''}
          ${showC ? `<div class="flex justify-between"><span class="font-bold">📦 Інше</span><span class="font-black">${fmt.format(rec.customCost)} ₴</span></div>${rec.customData ? Object.values(rec.customData).filter(s=>s.val>0).map(s=>`<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${escapeHtml(s.name)}</span><span class="text-purple-500">${fmt.format(s.val)} ₴</span></div>`).join('') : ''}` : ''}
          ${paymentStatus === 'partial' ? `<div class="flex justify-between text-[11px] font-bold text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-500/10 px-3 py-2 rounded-xl"><span>💳 Сплачено частково</span><span>${fmt.format(paidAmount)} ₴ / борг ${fmt.format(outstanding)} ₴</span></div>` : ''}
          ${rec.note ? `<div class="mt-3 p-3 bg-slate-50 dark:bg-black/50 rounded-xl text-xs text-slate-500 italic"><i class="fa-solid fa-sticky-note mr-1"></i>${escapeHtml(rec.note)}</div>` : ''}
        </div>
      </div>
      <div class="flex gap-2.5 mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
        <button type="button" class="rec-pay flex-1 py-3.5 rounded-2xl font-bold text-xs border active:scale-[0.96] transition-all ${recPaid ? 'bg-slate-50 dark:bg-[#2c2c2e] text-slate-500 border-slate-200 dark:border-white/10' : 'bg-gradient-to-r from-brand to-blue-600 text-white shadow-lg border-brand'}" data-rec-id="${escapeAttr(recId)}">${recPaid ? '↩ Нараховано' : '✓ Оплачено'}</button>
        <button type="button" aria-label="Поділитися записом" class="rec-share w-12 bg-blue-50 dark:bg-blue-500/10 rounded-2xl text-blue-500 active:scale-[0.90] transition-transform" data-rec-id="${escapeAttr(recId)}"><i class="fa-solid fa-share-nodes"></i></button>
        <button type="button" aria-label="Редагувати запис" class="rec-edit w-12 bg-slate-50 dark:bg-white/5 rounded-2xl text-slate-400 active:scale-[0.90] transition-transform" data-rec-id="${escapeAttr(recId)}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" aria-label="Видалити запис" class="rec-del w-12 bg-red-50 dark:bg-red-500/10 rounded-2xl text-red-400 active:scale-[0.90] transition-transform" data-rec-id="${escapeAttr(recId)}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;

  const swL = document.createElement('div'); swL.className = 'swipe-bg-left'; swL.innerHTML = '<i class="fa-solid fa-trash mr-2"></i>Видалити';
  const swR = document.createElement('div'); swR.className = 'swipe-bg-right'; swR.innerHTML = `<i class="fa-solid fa-${recPaid ? 'rotate-left' : 'check'} mr-2"></i>${recPaid ? 'Нараховано' : 'Оплачено'}`;
  card.insertBefore(swL, card.firstChild); card.insertBefore(swR, card.firstChild);
  initSwipe(card, recId);
  card.querySelector('[data-toggle-details]')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}});

  card.addEventListener('click', (e) => {
    const toggleTarget = e.target.closest('[data-toggle-details]');
    if (toggleTarget) { const panel = card.querySelector('.details-panel'), chevron = card.querySelector('.chevron-icon'); if (panel) { panel.classList.toggle('hidden'); toggleTarget.setAttribute('aria-expanded',String(!panel.classList.contains('hidden'))); if (chevron) chevron.style.transform = panel.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)'; } return; }
    const payBtn = e.target.closest('.rec-pay');     if (payBtn)   { e.stopPropagation(); togglePaidById(recId); return; }
    const shareBtn = e.target.closest('.rec-share'); if (shareBtn) { e.stopPropagation(); shareRecordById(recId); return; }
    const editBtn = e.target.closest('.rec-edit');   if (editBtn)  { e.stopPropagation(); editRecordById(recId); return; }
    const delBtn = e.target.closest('.rec-del');     if (delBtn)   { e.stopPropagation(); requestRecordDeletion(recId); return; }
  });
  return card;
}

// checkReminders вже делегує до checkRemindersExtended через typeof перевірку вище

// =================== INIT EXTENDED ===================
// Ініціалізуємо нові компоненти при старті через window.onload (без патчу initAppUI)
window.addEventListener('load', () => {
  setTimeout(() => {
    if (typeof renderCustomReminders === 'function') renderCustomReminders();
    if (typeof renderCommunityTariffs === 'function') renderCommunityTariffs();
    if (typeof renderTariffPresets === 'function') renderTariffPresets();
  }, 500);
});

// Кнопка завантаження тарифів з хмари
$('loadCloudTariffsBtn')?.addEventListener('click', () => loadCloudCommunityTariffs());



// =================== SUBSIDY CALCULATOR ===================
function renderSubsidyCalc() {
  const container = $('subsidyCalcContent');
  if (!container) return;
  const income = parseFloat($('subsidyIncome')?.value) || 0;
  const members = parseInt($('subsidyMembers')?.value) || 1;
  const avgBill = records.length > 0
    ? records.slice(-3).reduce((s,r) => s + r.total, 0) / Math.min(3, records.length)
    : 0;
  if (income <= 0 || avgBill <= 0) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center">Введіть дохід та кількість осіб</p>';
    return;
  }
  // Нормативи (спрощені): субсидія якщо частка КП > 15% доходу
  const threshold = 0.15;
  const incomeShare = avgBill / income;
  const eligiblePct = Math.max(0, incomeShare - threshold);
  const subsidy = Math.min(avgBill * 0.8, avgBill * eligiblePct / incomeShare * avgBill);
  const eligible = incomeShare > threshold;
  const perCapita = income / members;
  container.innerHTML = `
    <div class="space-y-2">
      <div class="flex justify-between text-xs"><span class="text-slate-500 font-bold">Середній рахунок</span><span class="font-black">${fmt.format(avgBill)} ₴</span></div>
      <div class="flex justify-between text-xs"><span class="text-slate-500 font-bold">Частка від доходу</span><span class="font-black ${incomeShare > threshold ? 'text-red-500' : 'text-green-600'}">${(incomeShare * 100).toFixed(1)}%</span></div>
      <div class="flex justify-between text-xs"><span class="text-slate-500 font-bold">Дохід на особу</span><span class="font-black">${fmt.format(perCapita)} ₴</span></div>
      <div class="mt-3 p-3 rounded-xl ${eligible ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20' : 'bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/5'}">
        <p class="text-[10px] font-bold ${eligible ? 'text-green-600' : 'text-slate-500'} uppercase tracking-wider mb-1">${eligible ? '✅ Орієнтовна субсидія' : '❌ Субсидія не передбачена'}</p>
        ${eligible ? `<p class="text-lg font-black text-green-600">~ ${fmt.format(Math.round(subsidy))} ₴/міс</p><p class="text-[9px] text-green-600/70 mt-1">Рахунок перевищує 15% доходу. Зверніться до ЦНАП для оформлення.</p>` : `<p class="text-[10px] text-slate-400">Рахунок менше 15% доходу — субсидія не призначається за базовими критеріями.</p>`}
      </div>
      <p class="text-[9px] text-slate-400 mt-2">⚠️ Орієнтовний розрахунок. Точні умови субсидування — на сайті Мінсоцполітики.</p>
    </div>`;
}

// Обробники для калькулятора субсидій
document.addEventListener('input', (e) => {
  if (e.target.id === 'subsidyIncome' || e.target.id === 'subsidyMembers') {
    renderSubsidyCalc();
  }
});

// =================== MULTI-ADDRESS COMPARE ===================
function renderAddressCompare() {
  const container = $('addressCompareContent');
  if (!container) return;
  if (addresses.length < 2) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-3">Додайте 2+ адреси для порівняння</p>';
    return;
  }
  syncCurrentAddress();
  const addrData = addresses.map(addr => {
    const recs = addr.records || [];
    const total = recs.reduce((s,r) => s + r.total, 0);
    const avg = recs.length ? total / recs.length : 0;
    const last3 = [...recs].sort((a,b) => b.month.localeCompare(a.month)).slice(0,3);
    const last3avg = last3.length ? last3.reduce((s,r) => s + r.total, 0) / last3.length : 0;
    const unpaid = recs.filter(r => getOutstandingAmount(r) > 0).length;
    return { name: addr.name, count: recs.length, avg, last3avg, total, unpaid };
  });
  const maxAvg = Math.max(...addrData.map(a => a.last3avg), 1);
  container.innerHTML = addrData.map((a, i) => `
    <div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl border border-slate-100 dark:border-white/5 mb-2">
      <div class="flex justify-between items-start mb-2">
        <p class="text-xs font-black text-slate-900 dark:text-white truncate flex-1 pr-2">${escapeHtml(a.name)}</p>
        <span class="text-xs font-black text-brand shrink-0">${fmt.format(a.last3avg)} ₴</span>
      </div>
      <div class="h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden mb-2">
        <div class="h-full rounded-full bg-gradient-to-r from-brand to-blue-500 transition-all" style="width:${Math.round((a.last3avg/maxAvg)*100)}%"></div>
      </div>
      <div class="flex justify-between text-[9px] font-bold text-slate-400">
        <span>📊 ${a.count} записів</span>
        <span>Сер.: ${fmt.format(a.avg)} ₴</span>
        ${a.unpaid > 0 ? `<span class="text-orange-500">⚠️ ${a.unpaid} борг</span>` : '<span class="text-green-500">✅ Без боргу</span>'}
      </div>
    </div>
  `).join('');
  const cheapest = addrData.reduce((a,b) => a.last3avg < b.last3avg ? a : b);
  const most = addrData.reduce((a,b) => a.last3avg > b.last3avg ? a : b);
  if (addrData.length >= 2) {
    container.innerHTML += `<div class="mt-2 p-3 bg-brand-light rounded-xl border border-brand-border text-[10px] font-bold text-brand">
      💡 Найменше: <span class="text-slate-700 dark:text-slate-200">${escapeHtml(cheapest.name)}</span> · Найбільше: <span class="text-slate-700 dark:text-slate-200">${escapeHtml(most.name)}</span>
    </div>`;
  }
}

// =================== COMBINED REPORT ===================
function renderCombinedReport() {
  const container = $('combinedReportContent');
  if (!container) return;
  syncCurrentAddress();
  if (addresses.length < 2) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-3">Додайте 2+ адреси для зведеного звіту</p>';
    return;
  }
  const allRecs = addresses.flatMap(a => (a.records || []).map(r => ({ ...r, addrName: a.name })));
  if (!allRecs.length) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-3">Немає записів</p>';
    return;
  }
  const grandTotal = allRecs.reduce((s,r) => s + r.total, 0);
  const grandAvg = grandTotal / allRecs.length;
  const unpaid = allRecs.filter(r => getOutstandingAmount(r) > 0);
  const debtTotal = unpaid.reduce((s,r) => s + getOutstandingAmount(r), 0);

  // По місяцях (останні 6)
  const monthMap = {};
  allRecs.forEach(r => {
    if (!monthMap[r.month]) monthMap[r.month] = 0;
    monthMap[r.month] += r.total;
  });
  const months = Object.entries(monthMap).sort((a,b) => b[0].localeCompare(a[0])).slice(0,6);

  container.innerHTML = `
    <div class="grid grid-cols-2 gap-2 mb-3">
      <div class="bg-brand-light border border-brand-border p-3 rounded-xl text-center">
        <p class="text-[8px] font-bold text-brand uppercase mb-1">Всього (всі адреси)</p>
        <p class="text-sm font-black text-brand">${fmt.format(grandTotal)} ₴</p>
      </div>
      <div class="bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-white/5 p-3 rounded-xl text-center">
        <p class="text-[8px] font-bold text-slate-400 uppercase mb-1">Середній платіж</p>
        <p class="text-sm font-black text-slate-900 dark:text-white">${fmt.format(grandAvg)} ₴</p>
      </div>
    </div>
    ${debtTotal > 0 ? `<div class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 rounded-xl mb-3">
      <p class="text-[9px] font-bold text-red-500 uppercase">⚠️ Загальний борг</p>
      <p class="text-base font-black text-red-500">${fmt.format(debtTotal)} ₴ · ${unpaid.length} записів</p>
    </div>` : ''}
    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Витрати по місяцях (всі адреси)</p>
    <div class="space-y-1.5">
      ${months.map(([month, total]) => {
        const mLabel = new Date(month + '-01').toLocaleString('uk-UA', {month:'short', year:'numeric'});
        const pct = Math.round((total / Math.max(...months.map(m=>m[1]))) * 100);
        return `<div class="flex items-center gap-2">
          <span class="text-[9px] font-bold text-slate-400 w-14 shrink-0">${mLabel}</span>
          <div class="flex-1 h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
            <div class="h-full bg-brand rounded-full" style="width:${pct}%"></div>
          </div>
          <span class="text-[9px] font-black text-slate-700 dark:text-slate-200 shrink-0">${fmt.format(total)} ₴</span>
        </div>`;
      }).join('')}
    </div>`;
}

$('addressHeaderTrigger')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}});
$('overviewDetails')?.addEventListener('toggle',e=>{if(e.currentTarget.open){dashChart?.setupCanvas();renderDashboard();}});
$('historyDetails')?.addEventListener('toggle',e=>{if(e.currentTarget.open){historyChart?.setupCanvas();serviceChart?.setupCanvas();renderRecords();}});

// Settings panels keep their existing controls mounted, including unsaved values.
function openSettingsPanel(name){
  const panel=name?$('settings-'+name):null;
  document.querySelectorAll('.settings-panel').forEach(el=>el.classList.toggle('hidden',el!==panel));
  $('settingsMenu')?.classList.toggle('hidden',Boolean(panel));
  $('tabSettings')?.querySelector('.page-heading')?.classList.toggle('hidden',Boolean(panel));
  $('saveSettingsBtn')?.classList.toggle('hidden',!panel||!['home','reminders','account'].includes(name));
  $('swipeContainer')?.scrollTo({top:0});
  if(name==='providers')renderProviders();
  if(panel)panel.querySelector('h3')?.focus({preventScroll:true});
}
document.querySelectorAll('[data-settings-open]').forEach(button=>button.addEventListener('click',()=>openSettingsPanel(button.dataset.settingsOpen)));
document.querySelectorAll('[data-settings-back]').forEach(button=>button.addEventListener('click',()=>{const name=button.closest('.settings-panel').id.slice(9);openSettingsPanel();document.querySelector(`[data-settings-open="${name}"]`)?.focus({preventScroll:true});}));
function runDashboardAction(){
  const action=$('dashAddBtn')?.dataset.action;
  if(action==='transfer'){const detail=$('monthlyTasksList')?.querySelector('details');if(detail){detail.open=true;detail.scrollIntoView?.({block:'center',behavior:'smooth'});detail.querySelector('summary')?.focus();}return;}
  openMonthlyEntry(action==='payment'?'paymentStatusInput':undefined);
}
let pendingRecordDeletion=null;
function closeRecordAction(){const dialog=$('recordActionDialog');if(typeof dialog?.close==='function')dialog.close();else dialog?.removeAttribute('open');pendingRecordDeletion=null;}
function requestRecordDeletion(id){
  if(!requireEdit('У режимі перегляду не можна видаляти записи'))return;
  const record=records.find(r=>String(r.id)===String(id));if(!record)return;
  pendingRecordDeletion={id,owner:sessionLogin,address:currentAddressId};
  const month=new Date(record.month+'-01T12:00:00').toLocaleDateString('uk-UA',{month:'long',year:'numeric'});
  $('recordActionDescription').textContent=`${month} · ${fmt.format(record.total)} ₴. Запис буде видалено з обліку цієї адреси. Одразу після видалення його можна відновити.`;
  const dialog=$('recordActionDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  $('recordActionCancel').focus();
}
$('recordActionCancel')?.addEventListener('click',closeRecordAction);
$('recordActionDialog')?.addEventListener('cancel',()=>{pendingRecordDeletion=null;});
$('recordActionConfirm')?.addEventListener('click',()=>{const request=pendingRecordDeletion;closeRecordAction();if(request&&request.owner===sessionLogin&&request.address===currentAddressId)deleteRecordById(request.id);});
$('overviewDetails')?.addEventListener('toggle',()=>{if($('overviewDetails').open){renderDashCanvasChart();renderDonutChart(records.find(r=>r.month===getMonthKey()));}});

// Fast entry keeps every input mounted. Collapsing a service never changes values.
function activeMeterGroups(){
  return [['blockWater','Вода',prefs.showWater,['wCur']],['blockHotWater','Гаряча вода',prefs.showHotWater,['hwCur']],['blockElectro','Світло',prefs.showElectro,prefs.electroTwoZone?['dCur','nCur']:['dCur']],['blockGas','Газ',prefs.showGas,['gCur']]].filter(([, ,enabled])=>enabled).map(([id,label,,fields])=>({id,label,fields,complete:fields.every(key=>$(key)?.value!==''&&$(key)?.getAttribute('aria-invalid')!=='true'&&!$(key)?.validity.badInput)}));
}
function renderEntryProgress(){
  if(!$('entryProgress'))return;const groups=activeMeterGroups(),done=groups.filter(g=>g.complete).length;
  $('entryProgress').textContent=groups.length?`Лічильники: ${done} з ${groups.length} заповнено`:'Додаткові послуги та оплата';
  $('collapseCompleted').disabled=done===0;
  for(const g of groups){const badge=$(g.id+'State');if(badge){badge.textContent=g.complete?'Заповнено':'Очікує показників';badge.classList.toggle('complete',g.complete);}const next=$(g.id).querySelector('.meter-next');if(next){const index=groups.indexOf(g);next.firstChild.textContent=index<groups.length-1?'Далі: '+groups[index+1].label+' ':'До підсумку ';}}
}
function focusEntryField(input){if(!input)return;const detail=input.closest('.meter-details');if(detail)detail.open=true;input.scrollIntoView?.({block:'center',behavior:'smooth'});input.focus({preventScroll:true});}
function showEntryReview(){calculatePreview();const invalid=$('utilityForm').querySelector('[aria-invalid="true"]');if(invalid){focusEntryField(invalid);return;}const title=$('entryReviewTitle');title.scrollIntoView?.({block:'center',behavior:'smooth'});title.focus({preventScroll:true});}
$('collapseCompleted')?.addEventListener('click',()=>{calculatePreview();activeMeterGroups().filter(g=>g.complete).forEach(g=>$(g.id+'Details').open=false);});
$('expandReadings')?.addEventListener('click',()=>{document.querySelectorAll('.meter-details').forEach(d=>d.open=true);});
$('jumpToReview')?.addEventListener('click',showEntryReview);
document.querySelectorAll('[data-meter-next]').forEach(button=>button.addEventListener('click',()=>{const groups=activeMeterGroups(),index=groups.findIndex(g=>g.id===button.dataset.meterNext),next=groups[index+1];if(next)focusEntryField($(next.fields[0]));else showEntryReview();}));
$('utilityForm')?.addEventListener('keydown',e=>{if(e.key!=='Enter'||e.isComposing||!e.target.matches('input[type="number"]'))return;e.preventDefault();const fields=[...$('utilityForm').querySelectorAll('input[type="number"]')].filter(input=>!input.disabled&&(!input.id.endsWith('Prev')||input.value===''||input===e.target)&&(input.closest('.meter-card')?activeMeterGroups().some(g=>g.id===input.closest('.meter-card').id)&&!(input.id.startsWith('n')&&!prefs.electroTwoZone):input.offsetParent!==null));const next=fields[fields.indexOf(e.target)+1];if(next)focusEntryField(next);else showEntryReview();});

let providerEditor=null;
function renderProviders(){
  const list=$('providersList');if(!list)return;
  $('providerAddressLabel').textContent=addresses.find(a=>String(a.id)===String(currentAddressId))?.name||'Поточна адреса';
  if(!$('providerMonth').value)$('providerMonth').value=getMonthKey();
  if(isGuest){list.innerHTML='<p class="provider-note">Картки постачальників доступні у власному акаунті.</p>';return;}
  const address=currentAddressSnapshot(),month=$('providerMonth').value,services=KomunalkaProviders.services(address),schedule=KomunalkaReminders.schedule(address,activeSettings);
  list.innerHTML=services.map(service=>{
    const card=KomunalkaProviders.get(activeSettings,currentAddressId,service.id),has=Boolean(card.name||card.account||card.website||card.contact||card.email),readings=KomunalkaProviders.readings(address,service.id,month);
    let url='';try{url=KomunalkaProviders.website(card.website);}catch{}
    const reminder=schedule.find(r=>r.id===(service.id==='hotWater'?'water':service.id)&&r.active&&r.enabled!==false),period=prefs.remindersEnabled&&reminder?`Передача: ${reminder.startDay}–${reminder.endDay} числа щомісяця`:'Дні передачі можна обрати в нагадуваннях';
    return `<article class="provider-card"><div class="provider-heading"><span class="settings-icon"><i class="fa-solid fa-${service.icon}" aria-hidden="true"></i></span><div><h4>${escapeHtml(service.label)}</h4><p>${escapeHtml(card.name||'Постачальника ще не додано')}</p></div><button type="button" class="provider-edit" data-provider-edit="${escapeAttr(service.id)}" ${!canEditData()?'disabled':''}>${has?'Змінити':'Додати'}</button></div>${card.account?`<div class="provider-account"><span>Особовий рахунок</span><strong>${escapeHtml(card.account)}</strong></div>`:''}${card.contact?`<p class="provider-contact">${escapeHtml(card.contact)}</p>`:''}${card.email?`<p class="provider-email-address"><i class="fa-solid fa-envelope" aria-hidden="true"></i> ${escapeHtml(card.email)}</p>`:''}<p class="provider-period">${escapeHtml(period)}</p><div class="provider-actions">${service.meter?`<button type="button" class="${card.email?'provider-primary':'provider-email-setup'}" data-provider-email="${escapeAttr(service.id)}" ${card.email&&readings===null?'disabled':''}><i class="fa-solid fa-envelope" aria-hidden="true"></i> ${card.email?'Підготувати лист':'Додати email для листа'}</button>`:''}${url?`<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="${service.meter?'':'provider-primary'}">Відкрити кабінет <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`:''}${card.account?`<button type="button" data-provider-copy="account" data-provider-id="${escapeAttr(service.id)}">Скопіювати рахунок</button>`:''}${service.meter?`<button type="button" data-provider-copy="readings" data-provider-id="${escapeAttr(service.id)}" ${readings===null?'disabled':''}>Скопіювати показники</button>`:''}</div>${service.meter&&readings===null?'<p class="provider-note">За вибраний місяць немає збережених показників цієї послуги.</p>':''}</article>`;
  }).join('')||'<p class="provider-note">Спочатку додайте послуги в розділі «Мій дім».</p>';
  list.querySelectorAll('[data-provider-edit]').forEach(button=>button.addEventListener('click',()=>openProviderEditor(button.dataset.providerEdit)));
  list.querySelectorAll('[data-provider-email]').forEach(button=>button.addEventListener('click',()=>openProviderEmail(button.dataset.providerEmail,month)));
  list.querySelectorAll('[data-provider-copy]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.providerId,text=button.dataset.providerCopy==='account'?KomunalkaProviders.get(activeSettings,currentAddressId,id).account:KomunalkaProviders.readings(currentAddressSnapshot(),id,$('providerMonth').value);if(text!==null&&text!==undefined)copyProviderText(String(text));}));
}
function closeProviderDialog(){const dialog=$('providerDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');providerEditor=null;}
function openProviderEditor(id,focusEmail=false){
  if(!requireEdit())return;const service=KomunalkaProviders.services(currentAddressSnapshot()).find(s=>s.id===id);if(!service)return;
  const card=KomunalkaProviders.get(activeSettings,currentAddressId,id);providerEditor={id,owner:sessionLogin,address:currentAddressId,base:KomunalkaData.copy(card)};
  $('providerDialogTitle').textContent=service.label+' · постачальник';$('providerDialogAddress').textContent=$('providerAddressLabel').textContent;
  for(const field of ['Name','Account','Website','Contact'])$('provider'+field).value=card[field.toLowerCase()]||'';
  $('providerEmail').value=card.email||(/^\S+@\S+\.\S+$/.test(card.contact||'')?card.contact:'');
  $('providerEmailSubject').value=card.emailSubject||'';$('providerEmailBody').value=card.emailBody||'';
  $('providerEmailSettings').open=Boolean(card.emailSubject||card.emailBody);
  $('providerError').textContent='';const dialog=$('providerDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');$(focusEmail?'providerEmail':'providerName').focus();
}
$('providerForm')?.addEventListener('submit',e=>{
  e.preventDefault();if(!requireEdit()||!providerEditor)return;const editor=providerEditor;
  if(editor.owner!==sessionLogin||String(editor.address)!==String(currentAddressId)){closeProviderDialog();return;}
  if(!KomunalkaData.equal(editor.base,KomunalkaProviders.get(activeSettings,currentAddressId,editor.id))){$('providerError').textContent='Картку вже змінено на іншому пристрої. Закрийте й відкрийте її, щоб переглянути актуальні дані.';return;}
  try{
    const fields=Object.fromEntries(['Name','Account','Website','Contact'].map(field=>[field.toLowerCase(),$('provider'+field).value]));
    Object.assign(fields,{email:$('providerEmail').value,emailSubject:$('providerEmailSubject').value,emailBody:$('providerEmailBody').value});
    const previous=activeSettings;const next=KomunalkaProviders.update(activeSettings,currentAddressId,editor.id,fields);activeSettings=next;syncCurrentAddress();
    if(!saveToLocal()){activeSettings=previous;$('providerError').textContent='Не вдалося зберегти. Введені поля залишаються тут — спробуйте ще раз.';return;}
    closeProviderDialog();renderProviders();syncToCloud();showToast('Картку збережено на пристрої','✓');
  }catch(error){$('providerError').textContent=error.message==='INVALID_WEBSITE'?'Вкажіть посилання на сайт: https://… або адресу сайту без пробілів.':error.message==='INVALID_EMAIL'?'Вкажіть одну повну email-адресу постачальника.':error.message==='INVALID_EMAIL_TEMPLATE'?'Перевірте тему й текст листа: забагато символів або недопустимий знак.':'Картку не вдалося зберегти. Перевірте поля; попередні дані збережено.';}
});
$('providerCancel')?.addEventListener('click',closeProviderDialog);
$('providerDialog')?.addEventListener('cancel',()=>{providerEditor=null;});
$('providerClear')?.addEventListener('click',()=>{for(const id of ['providerName','providerAccount','providerWebsite','providerContact','providerEmail','providerEmailSubject','providerEmailBody'])$(id).value='';$('providerError').textContent='Поля очищено. Натисніть «Зберегти», щоб застосувати.';});
$('providerMonth')?.addEventListener('change',renderProviders);
$('providerReminderSettings')?.addEventListener('click',()=>openSettingsPanel('reminders'));
function updateProviderMailLink(){
  const link=$('providerOpenMail');if(!link)return;
  try{link.href=KomunalkaProviders.mailto({to:$('providerEmailTo').value,subject:$('providerEmailSubjectText').value,body:$('providerEmailBodyText').value});link.removeAttribute('aria-disabled');}
  catch{link.removeAttribute('href');link.setAttribute('aria-disabled','true');}
}
function openProviderEmail(id,month=$('providerMonth')?.value||getMonthKey()){
  if(isGuest)return;
  const address=currentAddressSnapshot(),service=KomunalkaProviders.services(address).find(item=>item.id===id);if(!service)return;
  const card=KomunalkaProviders.get(activeSettings,currentAddressId,id);
  if(!card.email){openProviderEditor(id,true);return;}
  let draft;try{draft=KomunalkaProviders.emailDraft(address,service,card,month);}catch{showToast('Перевірте email у картці постачальника','⚠️');return;}
  if(!draft){showToast('Спочатку збережіть показники за обраний місяць','⚠️');return;}
  $('providerEmailContext').textContent=`${service.label} · ${month} · ${address.name||'Поточна адреса'}`;
  $('providerEmailTo').value=draft.to;$('providerEmailSubjectText').value=draft.subject;$('providerEmailBodyText').value=draft.body;
  $('providerEmailNotice').classList.toggle('hidden',!draft.needsReview);
  $('providerEmailNotice').textContent=draft.needsReview?'Попередній показник не був введений. Перевірте його в листі перед надсиланням.':'';
  updateProviderMailLink();const dialog=$('providerEmailDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
for(const id of ['providerEmailTo','providerEmailSubjectText','providerEmailBodyText'])$(id)?.addEventListener('input',()=>{if(id==='providerEmailSubjectText')$(id).value=$(id).value.replace(/[\r\n]+/g,' ');updateProviderMailLink();});
document.querySelectorAll('[data-provider-email-copy]').forEach(button=>button.addEventListener('click',()=>{
  const target={to:'providerEmailTo',subject:'providerEmailSubjectText',body:'providerEmailBodyText'}[button.dataset.providerEmailCopy];
  if(target)copyProviderText($(target).value);
}));
$('providerEmailClose')?.addEventListener('click',()=>{const dialog=$('providerEmailDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');});
async function copyProviderText(text){
  try{await navigator.clipboard.writeText(text);showToast('Скопійовано','✓');}
  catch{const dialog=$('providerCopyDialog');$('providerCopyText').value=text;if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');$('providerCopyText').focus();$('providerCopyText').select();}
}
$('providerCopyClose')?.addEventListener('click',()=>{const dialog=$('providerCopyDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');});

$('utilityForm')?.addEventListener('invalid',e=>{const detail=e.target.closest('.meter-details');if(detail)detail.open=true;},true);
