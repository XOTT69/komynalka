// ============================================================
// КОМУНАЛКА PWA v4.0
// ============================================================
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
const APP_VERSION = '4.0.0';
const MAX_ADDRESSES_FREE = 3;

const firebaseConfig = { apiKey: "AIzaSyBgRHmaHjg23BIZjJdCucwnmMFDX57XP80", authDomain: "pwakomun.firebaseapp.com", projectId: "pwakomun", storageBucket: "pwakomun.firebasestorage.app", messagingSenderId: "4437974770", appId: "1:4437974770:web:bf7d2f7bac35eff5707a6b" };
firebase.initializeApp(firebaseConfig);

window.addEventListener('load', () => {
  setTimeout(() => { const s = $('splashScreen'); if (s) { s.style.opacity = '0'; setTimeout(() => s.remove(), 500); } }, 600);
});

// =================== STATE ===================
let googleUser = null;
let sessionLogin = localStorage.getItem('k_login');
let sessionPass  = localStorage.getItem('k_passHash');
let displayName  = localStorage.getItem('k_display_name') || '';
let currentFilter = 'all';
let syncState = 'synced';
const defaultTariffs = { water: 30.38, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 };
const defaultPrefs   = { showWater: true, showHotWater: false, showElectro: true, showGas: true, electroTwoZone: true, electroWinter: true, remindersEnabled: false, remWaterStart: 1, remWaterEnd: 5, remElectroStart: 28, remElectroEnd: 3 };
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
  t.classList.remove('-translate-y-24', 'opacity-0');
  try { haptic(icon === '✅' ? 'success' : icon === '❌' || icon === '⚠️' ? 'error' : 'notification'); } catch(e) {}
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.add('-translate-y-24', 'opacity-0'), 2500);
}

function vibe(pattern = 10) { try { if (navigator.vibrate) navigator.vibrate(Array.isArray(pattern) ? pattern : [pattern]); } catch(e) {} }
const hapticPatterns = { light:[5], medium:[10], heavy:[20], success:[10,50,10], error:[50,30,50], notification:[15,100,15], tabSwitch:[3] };
function haptic(type) { vibe(hapticPatterns[type] || hapticPatterns.light); }

async function getHash(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}

function setSyncState(state) { syncState = state; const dot = $('syncDotHeader'); if (dot) dot.className = `sync-dot ${state}`; }
function saveToLocal() { try { localStorage.setItem('komynalka_backup', JSON.stringify({ addresses, currentAddressId, timestamp: Date.now() })); } catch(e) {} }
function loadFromLocal() { try { const b = localStorage.getItem('komynalka_backup'); return b ? JSON.parse(b) : null; } catch(e) { return null; } }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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
  const uid = localStorage.getItem('k_uid');
  if (uid) {
    headers['Authorization'] = `Bearer uid:${uid}`;
  } else if (sessionLogin && sessionPass) {
    headers['Authorization'] = `Bearer login:${btoa(unescape(encodeURIComponent(sessionLogin)))}:${sessionPass}`;
  }
  const urlP = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null) urlP.set(k, v); });
  const qs = urlP.toString();
  if (qs) url += '?' + qs;
  const options = { method, headers, cache: 'no-store' };
  if (body && method === 'POST') options.body = JSON.stringify(body);
  return fetch(url, options);
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
  banner.innerHTML = `<span class="text-lg">📢</span><p class="flex-1 text-sm font-bold">${escapeHtml(message)}</p><button onclick="dismissBroadcast('${escapeHtml(date)}')" class="px-3 py-1.5 bg-white/20 rounded-lg text-xs font-bold active:scale-95">✕</button>`;
  document.body.appendChild(banner);
}
function dismissBroadcast(date) { localStorage.setItem('k_broadcast_seen', date); $('broadcastBanner')?.remove(); }
window.dismissBroadcast = dismissBroadcast;

// =================== SYNC ===================
let syncDebounceTimer;
let isSyncing = false;

async function syncToCloud() {
  if (isSyncing) return;
  isSyncing = true;
  syncCurrentAddress();
  saveToLocal();

  if (isGuest && urlShareToken) {
    try {
      await fetch(`${WORKER_URL}?share=${urlShareToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-FP': DEVICE_FP },
        body: JSON.stringify({ addresses })
      });
    } catch(e) {} finally { isSyncing = false; }
    return;
  }

  if (!sessionLogin && !localStorage.getItem('k_uid')) { isSyncing = false; return; }

  const hasRealData = addresses.flatMap(a => a.records || []).length > 0;
  const isNew = addresses.length === 1 && addresses[0].id === 'default' && !hasRealData;
  if (!hasRealData && !isNew) { isSyncing = false; return; }

  setSyncState('syncing');
  try {
    const res  = await secureFetch('POST', {}, { addresses, currentAddressId });
    const data = await res.json();
    if (res.status === 403 || data.error === "WRONG_PASSWORD") { logout(); return; }
    if (res.status === 429) { showToast('Зачекайте хвилину', '⏳'); setSyncState('offline'); return; }
    setSyncState('synced');
  } catch(e) {
    setSyncState('offline');
  } finally {
    isSyncing = false;
  }
}

function debouncedSync() { clearTimeout(syncDebounceTimer); syncDebounceTimer = setTimeout(syncToCloud, 2000); }
window.addEventListener('online',  () => { showToast('Онлайн', '🌐'); syncToCloud(); });
window.addEventListener('offline', () => { setSyncState('offline'); showToast('Офлайн', '📴'); });

// =================== THEME ===================
let currentMode = localStorage.getItem('themeMode') || 'auto';
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
  $('metaThemeColor')?.setAttribute("content", isDark ? "#000000" : "#f2f2f7");
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (currentMode === 'auto') applyThemeMode(); });
setThemeMode(currentMode);

// =================== WELCOME ===================
function showWelcome() { if (localStorage.getItem('welcome_done')) return; $('welcomeTooltip')?.classList.remove('hidden'); }
function dismissWelcome() { localStorage.setItem('welcome_done', '1'); $('welcomeTooltip')?.classList.add('hidden'); }
window.dismissWelcome = dismissWelcome;

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

async function performLogin(rawLogin, rawPass, isAlreadyHashed, uid = null) {
  const errEl   = $('authError');
  const spinner = $('authSpinner');
  const btnText = $('authBtnText');
  if (errEl) errEl.classList.add('hidden');
  if (btnText) btnText.textContent = "Завантаження...";
  if (spinner) spinner.classList.remove('hidden');

  try {
    let passHash = null;
    if (!uid) passHash = isAlreadyHashed ? rawPass : await getHash(rawPass);

    const prevLogin = sessionLogin, prevPass = sessionPass;
    if (uid) { localStorage.setItem('k_uid', uid); }
    else { sessionLogin = rawLogin; sessionPass = passHash; }

    const res  = await secureFetch('GET', { t: Date.now() });
    const data = await res.json();

    if (res.status === 404 && uid) {
      sessionLogin = prevLogin; sessionPass = prevPass;
      localStorage.removeItem('k_uid');
      const existingLogin = localStorage.getItem('k_login');
      if (!existingLogin) {
        sessionLogin = `uid_${uid}`;
        localStorage.setItem('k_uid',   uid);
        localStorage.setItem('k_login', sessionLogin);
        addresses = [{ id:'default', name:'Мій дім', tariffs:{...defaultTariffs}, prefs:{...defaultPrefs}, records:[], customServices:[...defaultCustomServices] }];
        currentAddressId = 'default';
        await syncToCloud();
        loadCurrentAddress();
        showToast("Акаунт створено! 🎉");
        if (btnText) btnText.textContent = "Увійти";
        if (spinner) spinner.classList.add('hidden');
        return;
      }
      $('linkModal')?.classList.remove('hidden');
      if (btnText) btnText.textContent = "Увійти";
      if (spinner) spinner.classList.add('hidden');
      return;
    }

    if (res.status === 403 || data.error === "WRONG_PASSWORD") throw new Error("WRONG_PASSWORD");
    if (res.status === 429) throw new Error("Забагато спроб. Зачекайте.");

    if (res.status === 404 || (!uid && !data.success)) {
      sessionLogin = rawLogin; sessionPass = passHash;
      addresses = [{ id:'default', name:'Мій дім', tariffs:{...defaultTariffs}, prefs:{...defaultPrefs}, records:[], customServices:[...defaultCustomServices] }];
      currentAddressId = 'default';
      await syncToCloud();
    } else if (res.status === 200 && data.success) {
      const cloudAddresses = data.data.addresses || [];
      const cloudRecords   = cloudAddresses.flatMap(a => a.records || []).length;

      if (cloudRecords > 0) {
        addresses        = cloudAddresses;
        currentAddressId = data.data.currentAddressId || cloudAddresses[0]?.id || 'default';
      } else {
        const localBackup  = loadFromLocal();
        const localAddrs   = localBackup?.addresses || [];
        const localRecords = localAddrs.flatMap(a => a.records || []).length;
        if (localRecords > 0) {
          addresses        = localAddrs;
          currentAddressId = localBackup.currentAddressId || localAddrs[0]?.id || 'default';
          showToast(`Відновлено ${localRecords} записів! 💾`);
          setTimeout(() => syncToCloud(), 800);
        } else {
          addresses = cloudAddresses.length
            ? cloudAddresses
            : [{ id:'default', name:'Мій дім', tariffs:{...defaultTariffs}, prefs:{...defaultPrefs}, records:[], customServices:[...defaultCustomServices] }];
          currentAddressId = data.data.currentAddressId || addresses[0]?.id || 'default';
        }
      }

      // Завантажуємо displayName
      if (data.data.displayName !== undefined) {
        displayName = data.data.displayName || '';
        localStorage.setItem('k_display_name', displayName);
      }

      if (uid) { sessionLogin = data.linkedLogin || `uid_${uid}`; localStorage.setItem('k_uid', uid); }
      else { sessionLogin = rawLogin; sessionPass = passHash; }
    }

    if (!uid) {
      localStorage.setItem('k_login',    sessionLogin);
      localStorage.setItem('k_passHash', sessionPass);
    }

    loadCurrentAddress();
    if (records.length === 0) showWelcome();
    checkBroadcast();
  } catch(err) {
    if (btnText) btnText.textContent = "Увійти";
    if (spinner) spinner.classList.add('hidden');
    if (errEl) {
      errEl.innerText = err.message === "WRONG_PASSWORD" ? "Неправильний пароль!" : "Помилка: " + err.message;
      errEl.classList.remove('hidden');
    }
  }
}

$('linkYesBtn')?.addEventListener('click', () => {
  const lgn = prompt("Введіть ваш існуючий логін:"); if (!lgn) return;
  const pss = prompt("Введіть пароль:"); if (pss) linkAccount(lgn, pss);
});
$('linkNoBtn')?.addEventListener('click', async () => {
  $('linkModal')?.classList.add('hidden');
  sessionLogin = `uid_${googleUser.uid}`;
  localStorage.setItem('k_uid',   googleUser.uid);
  localStorage.setItem('k_login', sessionLogin);
  addresses = [{ id:'default', name:'Мій дім', tariffs:{...defaultTariffs}, prefs:{...defaultPrefs}, records:[], customServices:[...defaultCustomServices] }];
  currentAddressId = 'default';
  await syncToCloud();
  loadCurrentAddress();
  showToast("Акаунт створено!");
});

async function linkAccount(lgn, pss) {
  const passHash = await getHash(pss);
  const res  = await fetch(WORKER_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:"link_google", login: lgn, pass: passHash, uid: googleUser.uid }) });
  const data = await res.json();
  if (data.success) { $('linkModal')?.classList.add('hidden'); showToast("Підв'язано!"); performLogin(null, null, false, googleUser.uid); }
  else showToast("Неправильний логін або пароль", "❌");
}

$('btnLinkGoogle')?.addEventListener('click', async () => {
  if (!sessionLogin) return showToast("Спочатку увійдіть", "⚠️");
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await firebase.auth().signInWithPopup(provider);
    const uid    = result.user.uid;
    const res    = await fetch(WORKER_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:"link_google", login: sessionLogin, uid }) });
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
  if (!addresses || addresses.length === 0) {
    const backup = loadFromLocal();
    if (backup) { addresses = backup.addresses || []; currentAddressId = backup.currentAddressId || 'default'; }
  }
  if (!addresses.length) return;
  const addr = addresses.find(a => a.id === currentAddressId) || addresses[0];
  currentAddressId = addr.id;
  tariffs        = { ...defaultTariffs,  ...(addr.tariffs  || {}) };
  prefs          = { ...defaultPrefs,    ...(addr.prefs    || {}) };
  records        = addr.records        || [];
  customServices = addr.customServices || [...defaultCustomServices];
  if ($('currentAddressDisplay')) $('currentAddressDisplay').innerText = addr.name + (isGuest ? ' (Гість)' : '');
  initAppUI();
}

function syncCurrentAddress() {
  const idx = addresses.findIndex(a => a.id === currentAddressId);
  if (idx >= 0) { addresses[idx].tariffs = tariffs; addresses[idx].prefs = prefs; addresses[idx].records = records; addresses[idx].customServices = customServices; }
}

function openAddressModal()  { $('addressModal')?.classList.remove('hidden'); setTimeout(() => $('addressModalContent')?.classList.remove('translate-y-full'), 10); renderAddressModal(); }
function closeAddressModal() { $('addressModalContent')?.classList.add('translate-y-full'); setTimeout(() => $('addressModal')?.classList.add('hidden'), 400); }
$('addressHeaderTrigger')?.addEventListener('click', openAddressModal);
$('closeAddressModalBtn')?.addEventListener('click', closeAddressModal);
$('addressModal')?.addEventListener('click', (e) => { if (e.target === $('addressModal')) closeAddressModal(); });

$('addAddressBtn')?.addEventListener('click', () => {
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
  list.innerHTML = addresses.map(a => `<div class="flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-95 cursor-pointer ${a.id===currentAddressId?'bg-brand border-brand text-white shadow-lg shadow-brand/20':'bg-slate-50 dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'}" data-addr-id="${a.id}"><span class="font-bold text-lg truncate pr-2 flex-1">${escapeHtml(a.name)}</span><div class="flex gap-1.5 shrink-0"><button class="addr-edit p-2 rounded-xl shadow-sm ${a.id===currentAddressId?'bg-white/20 text-white':'bg-white dark:bg-[#2c2c2e] text-slate-400'}" data-id="${a.id}"><i class="fa-solid fa-pen"></i></button>${a.id!==currentAddressId&&addresses.length>1?`<button class="addr-del p-2 text-slate-400 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-sm" data-id="${a.id}"><i class="fa-solid fa-trash"></i></button>`:''}</div></div>`).join('');
  list.querySelectorAll('[data-addr-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.addr-edit') || e.target.closest('.addr-del')) return;
      syncCurrentAddress(); currentAddressId = el.dataset.addrId; loadCurrentAddress(); syncToCloud(); closeAddressModal();
    });
  });
  list.querySelectorAll('.addr-edit').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); const addr = addresses.find(a => a.id===btn.dataset.id); const name = prompt("Нова назва:", addr.name); if (name&&name.trim()) { addr.name=name.trim(); renderAddressModal(); if (btn.dataset.id===currentAddressId) $('currentAddressDisplay').innerText=addr.name; syncToCloud(); } });
  });
  list.querySelectorAll('.addr-del').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm("Видалити?")) { addresses=addresses.filter(a=>a.id!==btn.dataset.id); if (currentAddressId===btn.dataset.id) { currentAddressId=addresses[0].id; loadCurrentAddress(); } syncToCloud(); renderAddressModal(); } });
  });
}

// =================== ACHIEVEMENTS ===================
const ACHIEVEMENTS = [
  { id:'first_record',  emoji:'🎉', title:'Перший запис',    desc:'Зберегли перший розрахунок', check:(r)=>r.length>=1 },
  { id:'streak_3',      emoji:'🔥', title:'3 місяці поспіль',desc:'3 місяці без перерви',        check:(r)=>getStreak(r)>=3 },
  { id:'streak_6',      emoji:'💪', title:'Полугідник',      desc:'6 місяців поспіль',           check:(r)=>getStreak(r)>=6 },
  { id:'streak_12',     emoji:'👑', title:'Рік без перерви', desc:'Цілий рік!',                  check:(r)=>getStreak(r)>=12 },
  { id:'all_paid',      emoji:'✅', title:'Чистий рахунок',  desc:'Все оплачено',                check:(r)=>r.length>0&&r.every(rec=>rec.paid) },
  { id:'records_10',    emoji:'📊', title:'Аналітик',        desc:'10+ записів',                 check:(r)=>r.length>=10 },
  { id:'saver',         emoji:'💰', title:'Економ',          desc:'Знизили витрати 3 міс',       check:(r)=>checkSaverAchievement(r) },
  { id:'multi_address', emoji:'🏘️', title:'Мультивласник',  desc:'2+ адреси',                   check:()=>addresses.length>=2 },
  { id:'budget_master', emoji:'🎯', title:'Бюджетник',       desc:'Не перевищили бюджет 3 міс', check:(r)=>checkBudgetAchievement(r) },
  { id:'night_owl',     emoji:'🦉', title:'Нічна сова',      desc:'70%+ нічне споживання',      check:(r)=>checkNightOwl(r) },
];
const ACHIEVEMENT_HINTS = { 'first_record':'Збережіть перший розрахунок','streak_3':'Вносьте показники 3 місяці без пропуску','streak_6':'6 місяців без пропуску','streak_12':'Рік без пропуску','all_paid':'Позначте всі записи як оплачені','records_10':'Накопичте 10+ записів','saver':'Знижуйте суму 3 місяці поспіль','multi_address':'Додайте другу адресу','budget_master':'Не перевищуйте бюджет 3 міс поспіль','night_owl':'Споживайте 70%+ електрики вночі' };

function getStreak(recs) { if(!recs.length) return 0; const sorted=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)); let streak=1; for(let i=0;i<sorted.length-1;i++){const[y1,m1]=sorted[i].month.split('-').map(Number);const[y2,m2]=sorted[i+1].month.split('-').map(Number);if((y1*12+m1)-(y2*12+m2)===1)streak++;else break;} return streak; }
function checkSaverAchievement(recs) { if(recs.length<4) return false; const s=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)); return s[0].total<s[1].total&&s[1].total<s[2].total; }
function checkBudgetAchievement(recs) { const budget=parseFloat(localStorage.getItem('k_budget'))||0; if(!budget||recs.length<3) return false; const s=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,3); return s.every(r=>r.total<=budget); }
function checkNightOwl(recs) { if(!recs.length) return false; const last=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month))[0]; const n=Math.max(0,(last.nCur||0)-(last.nPrev||0)),d=Math.max(0,(last.dCur||0)-(last.dPrev||0)),t=n+d; return t>0&&(n/t)>=0.7; }
function getUnlockedAchievements() { return ACHIEVEMENTS.filter(a=>a.check(records)); }

function checkNewAchievements() { const unlocked=JSON.parse(localStorage.getItem('achievements_unlocked')||'[]'); const current=getUnlockedAchievements(); const newOnes=current.filter(a=>!unlocked.includes(a.id)); if(newOnes.length>0){localStorage.setItem('achievements_unlocked',JSON.stringify(current.map(a=>a.id)));showAchievementUnlock(newOnes[0]);} }
function showAchievementUnlock(ach) { const t=$('achievementToast'); if(!t) return; $('achievementEmoji').textContent=ach.emoji; $('achievementTitle').textContent=ach.title; $('achievementDesc').textContent=ach.desc; t.classList.remove('hidden'); setTimeout(()=>{t.style.transform='translate(-50%,-50%) scale(1)';t.style.opacity='1';},10); haptic('success'); setTimeout(()=>{t.style.transform='translate(-50%,-50%) scale(0)';t.style.opacity='0';setTimeout(()=>t.classList.add('hidden'),400);},3000); }
function renderAchievements() { const container=$('achievementsList'); if(!container) return; const unlocked=getUnlockedAchievements().map(a=>a.id); container.innerHTML=ACHIEVEMENTS.map(a=>`<div class="achievement ${unlocked.includes(a.id)?'':'locked'} flex flex-col items-center gap-1 w-14 text-center cursor-pointer" data-ach-id="${a.id}"><span class="text-2xl">${a.emoji}</span><span class="text-[8px] font-bold text-slate-500 leading-tight">${escapeHtml(a.title)}</span></div>`).join(''); container.querySelectorAll('[data-ach-id]').forEach(el=>{el.addEventListener('click',()=>showAchievementDetail(el.dataset.achId));}); }
function showAchievementDetail(achId) { const ach=ACHIEVEMENTS.find(a=>a.id===achId); if(!ach) return; const isUnlocked=ach.check(records); $('achDetailEmoji').textContent=ach.emoji; $('achDetailTitle').textContent=ach.title; $('achDetailDesc').textContent=ach.desc; $('achDetailHow').textContent=ACHIEVEMENT_HINTS[achId]||'—'; const s=$('achDetailStatus'); if(isUnlocked){s.textContent='✓ Отримано';s.className='text-xs font-bold px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-600';}else{s.textContent='🔒 Заблоковано';s.className='text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400';} $('achievementDetailModal').classList.remove('hidden'); haptic('light'); }

// =================== TABS ===================
const tabIds = ['tabDashboard','tabCalc','tabHistory','tabSettings'];
const btnIds = ['btnTabDashboard','btnTabCalc','btnTabHistory','btnTabSettings'];

function switchTab(tabId, index) {
  const activeTab = document.querySelector('.tab-active'), targetTab = $(tabId);
  if (!targetTab) return;
  if (activeTab && activeTab !== targetTab) {
    activeTab.classList.add('tab-exit');
    setTimeout(() => { activeTab.classList.remove('tab-active','tab-exit'); activeTab.classList.add('tab-hidden'); }, 150);
  }
  setTimeout(() => {
    targetTab.classList.remove('tab-hidden'); targetTab.classList.add('tab-active');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (tabId==='tabDashboard') renderDashboard();
      if (tabId==='tabCalc')      { fillPreviousReadings(); calculatePreview(); updateSmartBadges(); }
      if (tabId==='tabHistory')   renderRecords();
      if (tabId==='tabSettings')  { renderSettingsCustomServices(); updateDisplayName(); }
    }));
  }, activeTab && activeTab !== targetTab ? 80 : 0);
  btnIds.forEach((id,i) => { const btn=$(id); if(!btn) return; btn.classList.toggle('text-brand',i===index); btn.classList.toggle('text-slate-400',i!==index); btn.classList.toggle('dark:text-slate-500',i!==index); });
  $('swipeContainer')?.scrollTo({ top:0, behavior:'smooth' });
  haptic('tabSwitch');
}

$('btnTabDashboard')?.addEventListener('click', ()=>switchTab('tabDashboard',0));
$('btnTabCalc')?.addEventListener('click',      ()=>switchTab('tabCalc',1));
$('btnTabHistory')?.addEventListener('click',   ()=>switchTab('tabHistory',2));
$('btnTabSettings')?.addEventListener('click',  ()=>switchTab('tabSettings',3));
$('dashAddBtn')?.addEventListener('click',     ()=>switchTab('tabCalc',1));
$('dashHistoryBtn')?.addEventListener('click', ()=>switchTab('tabHistory',2));

let touchStartX=0, touchStartY=0;
$('swipeContainer')?.addEventListener('touchstart',e=>{touchStartX=e.changedTouches[0].screenX;touchStartY=e.changedTouches[0].screenY;},{passive:true});
$('swipeContainer')?.addEventListener('touchend',e=>{
  if(isGuest) return;
  const distX=touchStartX-e.changedTouches[0].screenX, distY=Math.abs(touchStartY-e.changedTouches[0].screenY);
  if(distY>Math.abs(distX)) return;
  const curIdx=tabIds.findIndex(id=>$(id)?.classList.contains('tab-active'));
  if(distX>80&&curIdx<tabIds.length-1) switchTab(tabIds[curIdx+1],curIdx+1);
  else if(distX<-80&&curIdx>0) switchTab(tabIds[curIdx-1],curIdx-1);
},{passive:true});

$('quickActionsBtn')?.addEventListener('click',()=>$('quickActionsModal')?.classList.remove('hidden'));
$('qaExport')?.addEventListener('click',()=>{exportCSV();$('quickActionsModal')?.classList.add('hidden');});
$('qaPdf')?.addEventListener('click',()=>{generatePDF();$('quickActionsModal')?.classList.add('hidden');});
$('qaShare')?.addEventListener('click',()=>{shareAllRecords();$('quickActionsModal')?.classList.add('hidden');});
$('qaSync')?.addEventListener('click',()=>{syncToCloud();showToast('Синхронізовано');$('quickActionsModal')?.classList.add('hidden');});
$('qaImage')?.addEventListener('click',()=>{if(typeof shareAsImage==='function')shareAsImage();$('quickActionsModal')?.classList.add('hidden');});

// =================== CANVAS CHART ENGINE ===================
class ChartEngine {
  constructor(canvasId, options={}) {
    this.canvas=$(canvasId); if(!this.canvas) return;
    this.ctx=this.canvas.getContext('2d');
    this.options={padding:40,barRadius:8,animDuration:600,unit:null,colors:{grid:'rgba(0,0,0,0.05)',text:'#8e8e93'},...options};
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

let dashChart, historyChart, serviceChart, donutChart;

// =================== DASHBOARD ===================
function renderDashboard() {
  const hour=new Date().getHours();
  let greeting='Доброго дня!'; if(hour<6) greeting='Доброї ночі!'; else if(hour<12) greeting='Доброго ранку!'; else if(hour>=18) greeting='Доброго вечора!';
  if($('dashGreeting')) $('dashGreeting').textContent = displayName ? `${greeting.replace('!',',')} ${displayName.split(' ')[0]}!` : greeting;
  if(records.length===0){$('dashEmptyState')?.classList.remove('hidden');}else{$('dashEmptyState')?.classList.add('hidden');}
  const now=new Date(),curMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if($('dashMonthLabel')) $('dashMonthLabel').textContent=new Date(curMonth+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'});
  const streak=getStreak(records); if($('streakValue')) $('streakValue').textContent=streak; renderStreakDots(streak);
  const curRec=records.find(r=>r.month===curMonth); animateNumber($('dashCurrentMonth'),curRec?curRec.total:0);
  if($('dashRecordsCount')) $('dashRecordsCount').textContent=records.length;
  if(records.length>0){const avg=records.reduce((s,r)=>s+r.total,0)/records.length;if($('dashAvg'))$('dashAvg').textContent=fmt.format(avg)+' ₴';}else{if($('dashAvg'))$('dashAvg').textContent='0 ₴';}
  const unpaid=records.filter(r=>!r.paid),debtTotal=unpaid.reduce((s,r)=>s+r.total,0);
  if(unpaid.length>0){$('dashDebtCard')?.classList.remove('hidden');animateNumber($('dashDebt'),debtTotal);if($('dashDebtMonths'))$('dashDebtMonths').textContent=`${unpaid.length} міс. не оплачено`;$('debtBadge')?.classList.remove('hidden');if($('debtBadge'))$('debtBadge').textContent=unpaid.length;}
  else{$('dashDebtCard')?.classList.add('hidden');$('debtBadge')?.classList.add('hidden');}
  renderDashCanvasChart(); renderBudgetProgress(curRec); renderDonutChart(curRec); renderSmartInsight(curRec,curMonth); renderAchievements(); renderTips();
  const unlocked=getUnlockedAchievements().length; if($('achCounter'))$('achCounter').textContent=`${unlocked}/${ACHIEVEMENTS.length}`;
  checkReminders();
}

function renderBudgetProgress(curRec) {
  const budgetEl=$('budgetProgressCard'); if(!budgetEl) return;
  const budget=parseFloat(localStorage.getItem('k_budget'))||0;
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
  dashChart.setData(sorted.map(r=>({value:r.total,label:new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short'}).slice(0,3),color:r.paid?'#007aff':'#ff9500'})));
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
  if(prefs.showWater)    currentCalc.waterCost   =Math.max(0,getV('wCur')-getV('wPrev'))*tariffs.water;    else currentCalc.waterCost=0;
  if(prefs.showHotWater) currentCalc.hotWaterCost=Math.max(0,getV('hwCur')-getV('hwPrev'))*tariffs.hotWater; else currentCalc.hotWaterCost=0;
  if(prefs.showElectro){
    const dV=Math.max(0,getV('dCur')-getV('dPrev')),nV=prefs.electroTwoZone?Math.max(0,getV('nCur')-getV('nPrev')):0,tEl=dV+nV;
    if(tEl===0) currentCalc.electroCost=0;
    else if(prefs.electroWinter&&$('isWinterInput')?.checked){
      if(tEl<=tariffs.winterLimit) currentCalc.electroCost=dV*tariffs.electroWinter+nV*tariffs.electroWinter*tariffs.nightCoef;
      else{const dp=dV/tEl,np=nV/tEl;currentCalc.electroCost=tariffs.winterLimit*dp*tariffs.electroWinter+tariffs.winterLimit*np*tariffs.electroWinter*tariffs.nightCoef+(tEl-tariffs.winterLimit)*dp*tariffs.electroBase+(tEl-tariffs.winterLimit)*np*tariffs.electroBase*tariffs.nightCoef;}
    } else currentCalc.electroCost=dV*tariffs.electroBase+nV*tariffs.electroBase*tariffs.nightCoef;
  } else currentCalc.electroCost=0;
  if(prefs.showGas) currentCalc.gasCost=Math.max(0,getV('gCur')-getV('gPrev'))*tariffs.gas; else currentCalc.gasCost=0;
  currentCalc.customCost=0;
  customServices.forEach(srv=>{let val=parseFloat($(`custom_${srv.id}`)?.value);if(isNaN(val)&&srv.defaultSum)val=parseFloat(srv.defaultSum);if(!isNaN(val))currentCalc.customCost+=val;});
  currentCalc.total=currentCalc.waterCost+currentCalc.hotWaterCost+currentCalc.electroCost+currentCalc.gasCost+currentCalc.customCost;
  if(!validateReadingsUI()) return;
  if($('heroTotal')) $('heroTotal').innerHTML=`${fmt.format(currentCalc.total)} <span class="text-2xl font-bold text-white/40">₴</span>`;
  if($('waterCostDisplay'))    $('waterCostDisplay').innerText   =fmt.format(currentCalc.waterCost)+' ₴';
  if($('hotWaterCostDisplay')) $('hotWaterCostDisplay').innerText=fmt.format(currentCalc.hotWaterCost)+' ₴';
  if($('electroCostDisplay'))  $('electroCostDisplay').innerText =fmt.format(currentCalc.electroCost)+' ₴';
  if($('gasCostDisplay'))      $('gasCostDisplay').innerText     =fmt.format(currentCalc.gasCost)+' ₴';
  if($('customCostDisplay'))   $('customCostDisplay').innerText  =fmt.format(currentCalc.customCost)+' ₴';
  updateMonthComparison(); updateSmartForecast(); updatePartialIndicator();
}

function validateReadingsUI() {
  const pairs=[['wPrev','wCur'],['hwPrev','hwCur'],['dPrev','dCur'],['nPrev','nCur'],['gPrev','gCur']];
  let hasInvalid=false;
  pairs.forEach(([prevId,curId])=>{
    const prevEl=$(prevId),curEl=$(curId);
    if(!prevEl||!curEl||prevEl.offsetParent===null) return;
    const invalid=curEl.value!==''&&prevEl.value!==''&&parseFloat(curEl.value||'0')<parseFloat(prevEl.value||'0');
    prevEl.classList.toggle('input-invalid',invalid);curEl.classList.toggle('input-invalid',invalid);
    if(invalid) hasInvalid=true;
  });
  const btn=$('submitFormBtn');
  if(btn){btn.disabled=hasInvalid;btn.classList.toggle('opacity-60',hasInvalid);}
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

readingInputIds.forEach(id=>{const el=$(id);if(el) el.addEventListener('input',debouncedCalculate);});
$('isWinterInput')?.addEventListener('change',calculatePreview);
$('monthInput')?.addEventListener('change',()=>{fillPreviousReadings();calculatePreview();updateSmartBadges();});
if($('monthInput')) $('monthInput').value=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

// =================== DRAFT ===================
const DRAFT_KEY='komunalka_draft';
function saveDraft(){const draft={month:$('monthInput')?.value};readingInputIds.forEach(id=>{const el=$(id);if(el&&el.value)draft[id]=el.value;});customServices.forEach(srv=>{const el=$(`custom_${srv.id}`);if(el&&el.value)draft[`custom_${srv.id}`]=el.value;});if($('recordNote')?.value)draft.note=$('recordNote').value;if($('isWinterInput'))draft.isWinter=$('isWinterInput').checked;localStorage.setItem(DRAFT_KEY,JSON.stringify(draft));}
function loadDraft(){const raw=localStorage.getItem(DRAFT_KEY);if(!raw)return;try{const draft=JSON.parse(raw);if(draft.month&&draft.month===$('monthInput')?.value){readingInputIds.forEach(id=>{const el=$(id);if(el&&draft[id])el.value=draft[id];});customServices.forEach(srv=>{const el=$(`custom_${srv.id}`);if(el&&draft[`custom_${srv.id}`])el.value=draft[`custom_${srv.id}`];});if($('recordNote')&&draft.note)$('recordNote').value=draft.note;if($('isWinterInput')&&draft.isWinter!==undefined)$('isWinterInput').checked=draft.isWinter;}}catch(e){}}
function clearDraft(){localStorage.removeItem(DRAFT_KEY);}
let draftTimeout;
function debouncedDraft(){clearTimeout(draftTimeout);draftTimeout=setTimeout(saveDraft,1000);}
readingInputIds.forEach(id=>{$(id)?.addEventListener('input',debouncedDraft);});
document.addEventListener('input',(e)=>{if(e.target.classList.contains('custom-srv-input')||e.target.id==='recordNote')debouncedDraft();});

// =================== FORM SUBMIT ===================
$('utilityForm')?.addEventListener('submit',(e)=>{
  e.preventDefault();
  if(!validateReadingsUI()){showToast('Перевірте показники','⚠️');return;}
  const hasWater   =prefs.showWater   &&(getV('wCur')>0||getV('wPrev')>0);
  const hasHotWater=prefs.showHotWater&&(getV('hwCur')>0||getV('hwPrev')>0);
  const hasElectro =prefs.showElectro &&(getV('dCur')>0||getV('dPrev')>0||getV('nCur')>0);
  const hasGas     =prefs.showGas     &&(getV('gCur')>0||getV('gPrev')>0);
  const hasCustom  =customServices.some(srv=>{const v=parseFloat($(`custom_${srv.id}`)?.value);return !isNaN(v)&&v>0;});
  if(!hasWater&&!hasHotWater&&!hasElectro&&!hasGas&&!hasCustom){showToast('Заповніть хоча б одну послугу','⚠️');return;}
  let cData={};
  customServices.forEach(srv=>{let v=parseFloat($(`custom_${srv.id}`)?.value);if(isNaN(v)&&srv.defaultSum)v=parseFloat(srv.defaultSum);if(!isNaN(v)&&v>0)cData[srv.id]={name:srv.name,val:v};});
  const month=$('monthInput').value,existingIdx=records.findIndex(r=>r.month===month);
  const newData={id:Date.now(),month,wPrev:hasWater?getV('wPrev'):0,wCur:hasWater?getV('wCur'):0,hwPrev:hasHotWater?getV('hwPrev'):0,hwCur:hasHotWater?getV('hwCur'):0,dPrev:hasElectro?getV('dPrev'):0,dCur:hasElectro?getV('dCur'):0,nPrev:(hasElectro&&prefs.electroTwoZone)?getV('nPrev'):0,nCur:(hasElectro&&prefs.electroTwoZone)?getV('nCur'):0,gPrev:hasGas?getV('gPrev'):0,gCur:hasGas?getV('gCur'):0,customData:cData,note:$('recordNote')?.value?.trim()||'',waterCost:hasWater?currentCalc.waterCost:0,hotWaterCost:hasHotWater?currentCalc.hotWaterCost:0,electroCost:hasElectro?currentCalc.electroCost:0,gasCost:hasGas?currentCalc.gasCost:0,customCost:currentCalc.customCost,total:currentCalc.total,paid:false,_filled:{water:hasWater,hotWater:hasHotWater,electro:hasElectro,gas:hasGas,custom:hasCustom}};
  if(existingIdx>=0){
    const existing=records[existingIdx];
    const merged={...existing,...newData,id:existing.id,paid:existing.paid};
    if(!hasWater   &&existing._filled?.water)   {merged.wPrev=existing.wPrev;merged.wCur=existing.wCur;merged.waterCost=existing.waterCost;merged._filled.water=true;}
    if(!hasHotWater&&existing._filled?.hotWater){merged.hwPrev=existing.hwPrev;merged.hwCur=existing.hwCur;merged.hotWaterCost=existing.hotWaterCost;merged._filled.hotWater=true;}
    if(!hasElectro &&existing._filled?.electro) {merged.dPrev=existing.dPrev;merged.dCur=existing.dCur;merged.nPrev=existing.nPrev;merged.nCur=existing.nCur;merged.electroCost=existing.electroCost;merged._filled.electro=true;}
    if(!hasGas     &&existing._filled?.gas)     {merged.gPrev=existing.gPrev;merged.gCur=existing.gCur;merged.gasCost=existing.gasCost;merged._filled.gas=true;}
    if(!hasCustom  &&existing._filled?.custom)  {merged.customData={...existing.customData,...cData};merged.customCost=existing.customCost;merged._filled.custom=true;}
    else if(hasCustom){merged.customData={...(existing.customData||{}),...cData};}
    merged.total=(merged.waterCost||0)+(merged.hotWaterCost||0)+(merged.electroCost||0)+(merged.gasCost||0)+(merged.customCost||0);
    merged.note=newData.note||existing.note;
    records[existingIdx]=merged; showToast("Оновлено! 🔄");
  } else { records.push(newData); showToast("Збережено! ✨"); }
  clearDraft();
  $('submitFormBtn')?.classList.add('save-btn-success');
  setTimeout(()=>$('submitFormBtn')?.classList.remove('save-btn-success'),600);
  syncToCloud();
  const[y,m]=$('monthInput').value.split('-').map(Number),nD=new Date(y,m);
  $('monthInput').value=`${nD.getFullYear()}-${String(nD.getMonth()+1).padStart(2,'0')}`;
  fillPreviousReadings();calculatePreview();updateSmartBadges();checkNewAchievements();
  switchTab('tabDashboard',0);
});

$('btnClearFields')?.addEventListener('click',()=>{readingInputIds.forEach(id=>{const el=$(id);if(el){el.value='';el.classList.remove('input-invalid');}});document.querySelectorAll('.custom-srv-input').forEach(el=>el.value='');if($('recordNote'))$('recordNote').value='';calculatePreview();updateSmartBadges();clearDraft();showToast('Очищено','🧼');});

// =================== FILL PREVIOUS READINGS ===================
function fillPreviousReadings() {
  try {
    readingInputIds.forEach(id=>{if($(id))$(id).value='';});
    document.querySelectorAll('.custom-srv-input').forEach(el=>el.value='');
    if($('recordNote'))$('recordNote').value='';
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
      if(prefs.showWater)   {if(currentRecord.wPrev!=null&&$('wPrev'))$('wPrev').value=currentRecord.wPrev;if(currentRecord.wCur!=null&&$('wCur'))$('wCur').value=currentRecord.wCur;}
      if(prefs.showHotWater){if(currentRecord.hwPrev!=null&&$('hwPrev'))$('hwPrev').value=currentRecord.hwPrev;if(currentRecord.hwCur!=null&&$('hwCur'))$('hwCur').value=currentRecord.hwCur;}
      if(prefs.showElectro) {if(currentRecord.dPrev!=null&&$('dPrev'))$('dPrev').value=currentRecord.dPrev;if(currentRecord.dCur!=null&&$('dCur'))$('dCur').value=currentRecord.dCur;if(prefs.electroTwoZone){if(currentRecord.nPrev!=null&&$('nPrev'))$('nPrev').value=currentRecord.nPrev;if(currentRecord.nCur!=null&&$('nCur'))$('nCur').value=currentRecord.nCur;}}
      if(prefs.showGas)     {if(currentRecord.gPrev!=null&&$('gPrev'))$('gPrev').value=currentRecord.gPrev;if(currentRecord.gCur!=null&&$('gCur'))$('gCur').value=currentRecord.gCur;}
      if(currentRecord.customData)Object.keys(currentRecord.customData).forEach(srvId=>{const el=$(`custom_${srvId}`);if(el)el.value=currentRecord.customData[srvId].val;});
      if($('recordNote'))$('recordNote').value=currentRecord.note||'';
    } else {
      customServices.forEach(srv=>{const el=$(`custom_${srv.id}`);if(el&&srv.defaultSum)el.value=srv.defaultSum;});
      loadDraft();
    }
    autoSetWinter(selectedMonth);
  } catch(e){console.error('fillPreviousReadings:',e);}
}
function autoSetWinter(month){if(!month||!$('isWinterInput'))return;const mo=new Date(month+'-01').getMonth()+1;$('isWinterInput').checked=mo>=10||mo<=4;}

// =================== SETTINGS ===================
function updateServiceChartOptions(){const select=$('serviceChartSelect');if(!select)return;const cur=select.value;select.innerHTML='';if(prefs.showWater)select.innerHTML+='<option value="water">💧 Вода</option>';if(prefs.showHotWater)select.innerHTML+='<option value="hotWater">🌡️ Гар. Вода</option>';if(prefs.showElectro)select.innerHTML+='<option value="electro">⚡ Світло</option>';if(prefs.showGas)select.innerHTML+='<option value="gas">🔥 Газ</option>';if(select.querySelector(`option[value="${cur}"]`))select.value=cur;}

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
}

['prefWater','prefHotWater','prefElectro','prefGas','prefElectroTwoZone','prefElectroWinter'].forEach(id=>{$(id)?.addEventListener('change',()=>{prefs.showWater=$('prefWater')?.checked??prefs.showWater;prefs.showHotWater=$('prefHotWater')?.checked??prefs.showHotWater;prefs.showElectro=$('prefElectro')?.checked??prefs.showElectro;prefs.showGas=$('prefGas')?.checked??prefs.showGas;prefs.electroTwoZone=$('prefElectroTwoZone')?.checked??prefs.electroTwoZone;prefs.electroWinter=$('prefElectroWinter')?.checked??prefs.electroWinter;applyPreferences();renderCalcCustomServices();calculatePreview();updateSmartBadges();});});
$('prefReminders')?.addEventListener('change',function(){if($('remindersSettings'))$('remindersSettings').style.display=this.checked?'block':'none';});

$('saveSettingsBtn')?.addEventListener('click',()=>{
  tariffs={water:parseFloat($('tWater')?.value)||defaultTariffs.water,hotWater:parseFloat($('tHotWater')?.value)||defaultTariffs.hotWater,electroBase:parseFloat($('tElectroBase')?.value)||defaultTariffs.electroBase,electroWinter:parseFloat($('tElectroWinter')?.value)||defaultTariffs.electroWinter,winterLimit:2000,nightCoef:0.5,gas:parseFloat($('tGas')?.value)||defaultTariffs.gas};
  prefs={showWater:$('prefWater')?.checked,showHotWater:$('prefHotWater')?.checked,showElectro:$('prefElectro')?.checked,showGas:$('prefGas')?.checked,electroTwoZone:$('prefElectroTwoZone')?.checked,electroWinter:$('prefElectroWinter')?.checked,remindersEnabled:$('prefReminders')?.checked,remWaterStart:parseInt($('remWaterStart')?.value)||1,remWaterEnd:parseInt($('remWaterEnd')?.value)||5,remElectroStart:parseInt($('remElectroStart')?.value)||28,remElectroEnd:parseInt($('remElectroEnd')?.value)||3};
  customServices=customServices.filter(s=>s.name.trim()!=="");
  localStorage.setItem('k_budget',$('budgetInput')?.value||'0');
  syncToCloud();applyPreferences();renderCalcCustomServices();calculatePreview();updateSmartBadges();checkReminders();
  showToast("Збережено ✓");
});

$('saveDisplayNameBtn')?.addEventListener('click', saveDisplayName);
$('displayNameInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDisplayName(); });

function renderSettingsCustomServices(){const list=$('customServicesSettingsList');if(!list)return;list.innerHTML=customServices.map((srv,i)=>`<div class="flex gap-2 items-center bg-slate-50 dark:bg-black/50 p-2 rounded-xl border border-slate-100 dark:border-white/5"><input type="text" value="${escapeHtml(srv.name)}" data-idx="${i}" data-field="name" placeholder="Назва" class="cs-setting-input flex-1 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2.5 py-2.5 border border-transparent focus:border-brand transition-colors"><input type="number" step="0.01" value="${srv.defaultSum}" data-idx="${i}" data-field="sum" placeholder="₴" class="cs-setting-input w-16 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2 py-2.5 text-center border border-transparent focus:border-brand transition-colors"><button type="button" class="cs-del p-2 text-slate-400 hover:text-red-500 bg-white dark:bg-[#2c2c2e] rounded-lg transition-colors" data-idx="${i}"><i class="fa-solid fa-trash text-[10px]"></i></button></div>`).join('');list.querySelectorAll('.cs-setting-input').forEach(input=>{input.addEventListener('change',()=>{const idx=parseInt(input.dataset.idx);if(input.dataset.field==='name')customServices[idx].name=input.value;else customServices[idx].defaultSum=input.value;});});list.querySelectorAll('.cs-del').forEach(btn=>{btn.addEventListener('click',()=>{customServices.splice(parseInt(btn.dataset.idx),1);renderSettingsCustomServices();});});}
$('addCustomServiceBtn')?.addEventListener('click',()=>{customServices.push({id:'s'+Date.now(),name:"",defaultSum:""});renderSettingsCustomServices();});

function renderCalcCustomServices(){const c=$('customServicesContainer');if(!c)return;if(customServices.length===0){c.innerHTML='';return;}c.innerHTML=customServices.map(srv=>`<div class="flex flex-col bg-slate-50 dark:bg-black/40 rounded-2xl p-3 border border-slate-100 dark:border-white/5"><span class="block text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate mb-1.5 text-center">${escapeHtml(srv.name)||'Послуга'}</span><input type="number" step="0.01" id="custom_${srv.id}" class="custom-srv-input premium-input w-full bg-white dark:bg-[#2c2c2e] p-2.5 rounded-xl text-center text-lg font-black outline-none border border-slate-200 dark:border-white/10" placeholder="${srv.defaultSum||'0.00'}"></div>`).join('');document.querySelectorAll('.custom-srv-input').forEach(input=>input.addEventListener('input',()=>{calculatePreview();debouncedDraft();}));}

function checkReminders(){const monthKey=new Date().getFullYear()+'-'+new Date().getMonth();if(!prefs.remindersEnabled||localStorage.getItem('lastSubmittedMonth')===monthKey){$('reminderBanner')?.classList.add('hidden');return;}const d=new Date().getDate();let msgs=[];const wS=prefs.remWaterStart||1,wE=prefs.remWaterEnd||5,eS=prefs.remElectroStart||28,eE=prefs.remElectroEnd||3;const isW=wS<=wE?(d>=wS&&d<=wE):(d>=wS||d<=wE),isE=eS<=eE?(d>=eS&&d<=eE):(d>=eS||d<=eE);if(isW&&(prefs.showWater||prefs.showHotWater))msgs.push("💧 Воду");if(isE&&prefs.showElectro)msgs.push("⚡️ Світло");if(msgs.length>0){$('reminderBanner')?.classList.remove('hidden');if($('reminderText'))$('reminderText').innerText="Передайте: "+msgs.join(" та ");}else $('reminderBanner')?.classList.add('hidden');}
$('reminderDismissBtn')?.addEventListener('click',()=>{localStorage.setItem('lastSubmittedMonth',new Date().getFullYear()+'-'+new Date().getMonth());$('reminderBanner')?.classList.add('hidden');showToast("Нагадаємо наступного місяця","🔔");});

$('changePassBtn')?.addEventListener('click',async()=>{const oldPass=prompt("Поточний:");if(!oldPass)return;const newPass=prompt("Новий (мін 4):");if(!newPass||newPass.length<4)return showToast("Мін 4","⚠️");if(newPass!==prompt("Підтвердіть:"))return showToast("Не збігаються","❌");try{const oldHash=await getHash(oldPass),newHash=await getHash(newPass);const res=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:"change_password",login:sessionLogin,oldPass:oldHash,newPass:newHash})});if((await res.json()).success){sessionPass=newHash;localStorage.setItem('k_passHash',newHash);showToast("Змінено!","✅");}else showToast("Неправильний пароль","❌");}catch(e){showToast("Помилка","❌");}});

// =================== SWIPE ===================
function initSwipe(card,recordId){
  let startX=0,currentX=0,isSwiping=false;const threshold=80;
  card.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;isSwiping=true;card.classList.add('swiping');},{passive:true});
  card.addEventListener('touchmove',e=>{if(!isSwiping)return;currentX=e.touches[0].clientX-startX;const limited=Math.sign(currentX)*Math.min(Math.abs(currentX),120);card.style.transform=`translateX(${limited}px)`;const l=card.querySelector('.swipe-bg-left'),r=card.querySelector('.swipe-bg-right');if(l)l.style.opacity=currentX<-30?'1':'0';if(r)r.style.opacity=currentX>30?'1':'0';},{passive:true});
  card.addEventListener('touchend',()=>{isSwiping=false;card.classList.remove('swiping');card.style.transform='';const l=card.querySelector('.swipe-bg-left'),r=card.querySelector('.swipe-bg-right');if(l)l.style.opacity='0';if(r)r.style.opacity='0';if(currentX<-threshold){card.style.transform='translateX(-100%)';card.style.opacity='0';setTimeout(()=>deleteRecordById(recordId),300);}else if(currentX>threshold){card.style.transform='translateX(100%)';card.style.opacity='0';setTimeout(()=>togglePaidById(recordId),300);}currentX=0;},{passive:true});
}

// =================== RECORDS ===================
function findRecordIndex(id){return records.findIndex(r=>r.id===id);}
function togglePaidById(id){const idx=findRecordIndex(id);if(idx<0)return;records[idx].paid=!records[idx].paid;renderRecords();renderDashboard();syncToCloud();checkNewAchievements();}
function deleteRecordById(id){records=records.filter(r=>r.id!==id);renderRecords();renderDashboard();syncToCloud();showToast('Видалено','🗑');}

function renderRecords(){
  const list=$('recordsList');if(!list) return;
  if(records.length===0){list.innerHTML=`<div class="text-center py-12"><i class="fa-solid fa-clock-rotate-left text-4xl text-slate-300 dark:text-slate-600 mb-4"></i><p class="text-slate-500 font-medium">Ще немає записів</p><p class="text-xs text-slate-400 mt-1">Додайте перший запис у вкладці "Рахунок"</p></div>`;if($('statsAvg'))$('statsAvg').innerText='0 ₴';if($('statsTotalPaid'))$('statsTotalPaid').innerText='0 ₴';if($('statsMin'))$('statsMin').innerText='0 ₴';if($('statsMax'))$('statsMax').innerText='0 ₴';if($('statsCount'))$('statsCount').innerText='0';renderHistoryChart([]);renderServiceChart();return;}
  const totals=records.map(r=>r.total);
  if($('statsAvg'))      $('statsAvg').innerText      =fmt.format(totals.reduce((a,b)=>a+b,0)/totals.length)+' ₴';
  if($('statsTotalPaid'))$('statsTotalPaid').innerText=fmt.format(records.filter(r=>r.paid).reduce((s,r)=>s+r.total,0))+' ₴';
  if($('statsMin'))      $('statsMin').innerText      =fmt.format(Math.min(...totals))+' ₴';
  if($('statsMax'))      $('statsMax').innerText      =fmt.format(Math.max(...totals))+' ₴';
  if($('statsCount'))    $('statsCount').innerText    =records.length;
  let sorted=[...records];
  const sortVal=$('sortSelect')?.value||'date-desc';
  switch(sortVal){case 'date-desc':sorted.sort((a,b)=>new Date(b.month)-new Date(a.month));break;case 'date-asc':sorted.sort((a,b)=>new Date(a.month)-new Date(b.month));break;case 'amount-desc':sorted.sort((a,b)=>b.total-a.total);break;case 'amount-asc':sorted.sort((a,b)=>a.total-b.total);break;}
  if(currentFilter==='paid')  sorted=sorted.filter(r=>r.paid);
  if(currentFilter==='unpaid')sorted=sorted.filter(r=>!r.paid);
  const search=$('searchRecords')?.value?.toLowerCase()||'';
  if(search)sorted=sorted.filter(r=>new Date(r.month+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'}).toLowerCase().includes(search)||r.month.includes(search));
  renderHistoryChart([...records].sort((a,b)=>new Date(a.month)-new Date(b.month)));
  renderServiceChart();
  list.innerHTML='';
