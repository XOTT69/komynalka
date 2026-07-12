// ============================================================
// КОМУНАЛКА PWA v5.2.0
// ============================================================
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
const APP_VERSION = '5.2.1';
const MAX_ADDRESSES_FREE = 3;
const LOCAL_BACKUP_KEY = 'komynalka_backup';
const PRE_IMPORT_BACKUP_KEY = 'komynalka_pre_import_backup';
const CHANGE_LOG_KEY = 'komynalka_change_log';
const CUSTOM_TARIFF_TEMPLATE_KEY = 'komynalka_tariff_template';
const CUSTOM_REMINDERS_KEY = 'komynalka_custom_reminders';
const COMMUNITY_TARIFF_KEY = 'komynalka_community_tariff';

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

function setSyncState(state) { syncState = state; const dot = $('syncDotHeader'); if (dot) dot.className = `sync-dot ${state}`; }
function saveToLocal() { try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify({ addresses, currentAddressId, timestamp: Date.now(), version: APP_VERSION })); } catch(e) {} }
function loadFromLocal(key = LOCAL_BACKUP_KEY) { try { const b = localStorage.getItem(key); return b ? JSON.parse(b) : null; } catch(e) { return null; } }

function backupCurrentState(key = LOCAL_BACKUP_KEY) {
  try {
    if (typeof syncCurrentAddress === 'function') syncCurrentAddress();
    localStorage.setItem(key, JSON.stringify({ addresses, currentAddressId, timestamp: Date.now(), version: APP_VERSION }));
    return true;
  } catch(e) {
    return false;
  }
}

function restoreFromLocalBackup(key = LOCAL_BACKUP_KEY) {
  try {
    const backup = loadFromLocal(key);
    const normalized = typeof normalizeImportData === 'function' ? normalizeImportData(backup) : backup;
    if (!normalized || !Array.isArray(normalized.addresses) || !normalized.addresses.length) return false;
    addresses = normalized.addresses;
    currentAddressId = normalized.currentAddressId || addresses[0].id;
    loadCurrentAddress();
    syncToCloud();
    return true;
  } catch(e) {
    return false;
  }
}

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
  return { ...tariffs, savedAt: new Date().toISOString() };
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
  hint.textContent = role === 'owner' ? 'Власник може змінювати все й керувати доступом.' : role === 'edit' ? 'Редагування дозволяє додавати записи, але без ролі власника.' : 'Перегляд блокує додавання, оплату, редагування й видалення.';
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
    const log = JSON.parse(localStorage.getItem(CHANGE_LOG_KEY) || '[]');
    return Array.isArray(log) ? log : [];
  } catch(e) {
    return [];
  }
}

function addChangeLog(type, details = {}) {
  const entry = { id: Date.now() + Math.random(), ts: new Date().toISOString(), type, details };
  try {
    const log = [entry, ...getChangeLog()].slice(0, 80);
    localStorage.setItem(CHANGE_LOG_KEY, JSON.stringify(log));
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
  banner.setAttribute('role', 'status');
  banner.innerHTML = `<span class="text-lg" aria-hidden="true">📢</span><p class="flex-1 text-sm font-bold">${escapeHtml(message)}</p><button type="button" aria-label="Закрити оголошення" class="broadcast-dismiss px-3 py-1.5 bg-white/20 rounded-lg text-xs font-bold active:scale-95">✕</button>`;
  banner.querySelector('.broadcast-dismiss')?.addEventListener('click', () => dismissBroadcast(String(date || '')));
  document.body.appendChild(banner);
}
function dismissBroadcast(date) { localStorage.setItem('k_broadcast_seen', date); $('broadcastBanner')?.remove(); }

// =================== SYNC ===================
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

window.addEventListener('online',  () => { showToast('Онлайн', '🌐'); syncToCloud(); });
window.addEventListener('offline', () => { setSyncState('offline'); showToast('Офлайн', '📴'); });

// =================== THEME ===================
let currentMode = localStorage.getItem('themeMode') || 'auto';
let currentLiquidGlass = parseInt(localStorage.getItem('liquidGlassLevel') || '68', 10);
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
$('welcomeStartBtn')?.addEventListener('click', dismissWelcome);
$('welcomeTooltip')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) dismissWelcome(); });

// =================== AUTH ===================
$('authForm')?.addEventListener('submit', async (e) => { e.preventDefault(); await performLogin($('authLogin').value.trim(), $('authPass').value, false); });
$('togglePassBtn')?.addEventListener('click', () => {
  const p = $('authPass');
  p.type = p.type === 'password' ? 'text' : 'password';
  $('passEyeIcon').className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
  $('togglePassBtn').setAttribute('aria-pressed', String(p.type === 'text'));
  $('togglePassBtn').setAttribute('aria-label', p.type === 'password' ? 'Показати пароль' : 'Сховати пароль');
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
      const normalizedCloud = normalizeImportData({ addresses: data.data.addresses || [], currentAddressId: data.data.currentAddressId });
      const cloudAddresses = normalizedCloud?.addresses || data.data.addresses || [];
      const cloudRecords   = cloudAddresses.flatMap(a => a.records || []).length;

      if (cloudRecords > 0) {
        addresses        = cloudAddresses;
        currentAddressId = normalizedCloud?.currentAddressId || data.data.currentAddressId || cloudAddresses[0]?.id || 'default';
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
          currentAddressId = normalizedCloud?.currentAddressId || data.data.currentAddressId || addresses[0]?.id || 'default';
        }
      }

      // Завантажуємо displayName
      if (data.data.displayName !== undefined) {
        displayName = data.data.displayName || '';
        localStorage.setItem('k_display_name', displayName);
      }

      if (uid) { sessionLogin = data.data?.linkedLogin || `uid_${uid}`; localStorage.setItem('k_uid', uid); localStorage.setItem('k_login', sessionLogin); }
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
$('linkCancelBtn')?.addEventListener('click', () => $('linkModal')?.classList.add('hidden'));
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
  if (data.success) { $('linkModal')?.classList.add('hidden'); $('linkAccountModal')?.classList.add('hidden'); showToast("Підв'язано!"); performLogin(null, null, false, googleUser.uid); }
  else showToast("Неправильний логін або пароль", "❌");
}

$('btnLinkGoogle')?.addEventListener('click', async () => {
  if (!sessionLogin) return showToast("Спочатку увійдіть", "⚠️");
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await firebase.auth().signInWithPopup(provider);
    const uid    = result.user.uid;
    const res    = await fetch(WORKER_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:"link_google", login: sessionLogin, pass: sessionPass, uid }) });
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

$('addAddressBtn')?.addEventListener('click', async () => {
  if(!requireEdit('У режимі перегляду не можна додавати об’єкти'))return;
  if (addresses.length >= MAX_ADDRESSES_FREE) { showToast(`Максимум ${MAX_ADDRESSES_FREE} адреси`, '⚠️'); closeAddressModal(); return; }
  const name = await showAppPrompt("Назва об'єкта", '', { message: 'Наприклад: Квартира, дача або будинок батьків.' });
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
  list.innerHTML = addresses.map(a => `<div class="flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-95 cursor-pointer ${a.id===currentAddressId?'bg-brand border-brand text-white shadow-lg shadow-brand/20':'bg-slate-50 dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'}" data-addr-id="${escapeAttr(a.id)}"><span class="font-bold text-lg truncate pr-2 flex-1">${escapeHtml(a.name)}</span><div class="flex gap-1.5 shrink-0"><button class="addr-edit p-2 rounded-xl shadow-sm ${a.id===currentAddressId?'bg-white/20 text-white':'bg-white dark:bg-[#2c2c2e] text-slate-400'}" data-id="${escapeAttr(a.id)}"><i class="fa-solid fa-pen"></i></button>${a.id!==currentAddressId&&addresses.length>1?`<button class="addr-del p-2 text-slate-400 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-sm" data-id="${escapeAttr(a.id)}"><i class="fa-solid fa-trash"></i></button>`:''}</div></div>`).join('');
  list.querySelectorAll('[data-addr-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.addr-edit') || e.target.closest('.addr-del')) return;
      syncCurrentAddress(); currentAddressId = el.dataset.addrId; loadCurrentAddress(); syncToCloud(); closeAddressModal();
    });
  });
  list.querySelectorAll('.addr-edit').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); if(!requireEdit('У режимі перегляду не можна перейменовувати об’єкти'))return; const addr = addresses.find(a => a.id===btn.dataset.id); if(!addr)return; const name = await showAppPrompt('Перейменувати об’єкт', addr.name); if (name&&name.trim()) { addr.name=name.trim(); renderAddressModal(); if (btn.dataset.id===currentAddressId) $('currentAddressDisplay').innerText=addr.name; syncToCloud(); } });
  });
  list.querySelectorAll('.addr-del').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); if(!requireEdit('У режимі перегляду не можна видаляти об’єкти'))return; const addr=addresses.find(a=>a.id===btn.dataset.id); if(await showAppConfirm(`Видалити «${addr?.name||'об’єкт'}» разом з усіма його записами?`,{title:'Видалення об’єкта',confirmLabel:'Видалити',danger:true,icon:'🗑️'})) { addresses=addresses.filter(a=>a.id!==btn.dataset.id); if (currentAddressId===btn.dataset.id) { currentAddressId=addresses[0].id; loadCurrentAddress(); } syncToCloud(); renderAddressModal(); } });
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
function checkBudgetAchievement(recs) { const budget=parseFloat(localStorage.getItem('k_budget'))||0; if(!budget||recs.length<3) return false; const s=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,3); return s.every(r=>r.total<=budget); }
function checkNightOwl(recs) { if(!recs.length) return false; const last=[...recs].sort((a,b)=>new Date(b.month)-new Date(a.month))[0]; const n=Math.max(0,(last.nCur||0)-(last.nPrev||0)),d=Math.max(0,(last.dCur||0)-(last.dPrev||0)),t=n+d; return t>0&&(n/t)>=0.7; }
function getUnlockedAchievements() { return ACHIEVEMENTS.filter(a=>a.check(records)); }

function checkNewAchievements() { const unlocked=JSON.parse(localStorage.getItem('achievements_unlocked')||'[]'); const current=getUnlockedAchievements(); const newOnes=current.filter(a=>!unlocked.includes(a.id)); if(newOnes.length>0){localStorage.setItem('achievements_unlocked',JSON.stringify(current.map(a=>a.id)));showAchievementUnlock(newOnes[0]);} }
function showAchievementUnlock(ach) { const t=$('achievementToast'); if(!t) return; $('achievementEmoji').textContent=ach.emoji; $('achievementTitle').textContent=ach.title; $('achievementDesc').textContent=ach.desc; t.classList.remove('hidden'); setTimeout(()=>{t.style.transform='translate(-50%,-50%) scale(1)';t.style.opacity='1';},10); haptic('success'); setTimeout(()=>{t.style.transform='translate(-50%,-50%) scale(0)';t.style.opacity='0';setTimeout(()=>t.classList.add('hidden'),400);},3000); }
function renderAchievements() { const container=$('achievementsList'); if(!container) return; const unlocked=getUnlockedAchievements().map(a=>a.id); container.innerHTML=ACHIEVEMENTS.map(a=>`<div class="achievement ${unlocked.includes(a.id)?'':'locked'} flex flex-col items-center gap-1 w-14 text-center cursor-pointer" data-ach-id="${a.id}"><span class="text-2xl">${a.emoji}</span><span class="text-[8px] font-bold text-slate-500 leading-tight">${escapeHtml(a.title)}</span></div>`).join(''); container.querySelectorAll('[data-ach-id]').forEach(el=>{el.addEventListener('click',()=>showAchievementDetail(el.dataset.achId));}); }
function showAchievementDetail(achId) { const ach=ACHIEVEMENTS.find(a=>a.id===achId); if(!ach) return; const isUnlocked=ach.check(records); $('achDetailEmoji').textContent=ach.emoji; $('achDetailTitle').textContent=ach.title; $('achDetailDesc').textContent=ach.desc; $('achDetailHow').textContent=ACHIEVEMENT_HINTS[achId]||'—'; const s=$('achDetailStatus'); if(isUnlocked){s.textContent='✓ Отримано';s.className='text-xs font-bold px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-600';}else{s.textContent='🔒 Заблоковано';s.className='text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400';} $('achievementDetailModal').classList.remove('hidden'); haptic('light'); }

// =================== TABS ===================
const tabIds = ['tabDashboard','tabCalc','tabHistory','tabAnalytics','tabSettings'];
const btnIds = ['btnTabDashboard','btnTabCalc','btnTabHistory','btnTabAnalytics','btnTabSettings'];

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
      if (tabId==='tabDashboard')   renderDashboard();
      if (tabId==='tabCalc')        { fillPreviousReadings(); calculatePreview(); updateSmartBadges(); }
      if (tabId==='tabHistory')     renderRecords();
      if (tabId==='tabAnalytics')   renderAnalytics();
      if (tabId==='tabSettings')    { renderSettingsCustomServices(); updateDisplayName(); renderChangeLog(); }
    }));
  }, activeTab && activeTab !== targetTab ? 80 : 0);
  btnIds.forEach((id,i) => { const btn=$(id); if(!btn) return; btn.classList.toggle('text-brand',i===index); btn.classList.toggle('text-slate-400',i!==index); btn.classList.toggle('dark:text-slate-500',i!==index); });
  $('swipeContainer')?.scrollTo({ top:0, behavior:'smooth' });
  haptic('tabSwitch');
}

$('btnTabDashboard')?.addEventListener('click', ()=>switchTab('tabDashboard',0));
$('btnTabCalc')?.addEventListener('click',      ()=>switchTab('tabCalc',1));
$('btnTabHistory')?.addEventListener('click',   ()=>switchTab('tabHistory',2));
$('btnTabAnalytics')?.addEventListener('click', ()=>switchTab('tabAnalytics',3));
$('btnTabSettings')?.addEventListener('click',  ()=>switchTab('tabSettings',4));
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

$('quickActionsBtn')?.addEventListener('click',()=>{
  $('quickActionsModal')?.classList.remove('hidden');
  $('quickActionsBtn')?.setAttribute('aria-expanded','true');
});
$('qaExport')?.addEventListener('click',()=>{exportCSV();closeQuickActions();});
$('qaPdf')?.addEventListener('click',()=>{generatePDF();closeQuickActions();});
$('qaShare')?.addEventListener('click',()=>{shareAllRecords();closeQuickActions();});
$('qaSync')?.addEventListener('click',()=>{syncToCloud();showToast('Синхронізовано');closeQuickActions();});
$('qaImage')?.addEventListener('click',()=>{if(typeof shareAsImage==='function')shareAsImage();closeQuickActions();});

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
  const unpaid=records.filter(r=>getOutstandingAmount(r)>0),debtTotal=unpaid.reduce((s,r)=>s+getOutstandingAmount(r),0);
  if(unpaid.length>0){$('dashDebtCard')?.classList.remove('hidden');animateNumber($('dashDebt'),debtTotal);if($('dashDebtMonths'))$('dashDebtMonths').textContent=`${unpaid.length} міс. з боргом`;$('debtBadge')?.classList.remove('hidden');if($('debtBadge'))$('debtBadge').textContent=unpaid.length;}
  else{$('dashDebtCard')?.classList.add('hidden');$('debtBadge')?.classList.add('hidden');}
  renderDashCanvasChart(); renderBudgetProgress(curRec); renderDonutChart(curRec); renderSmartInsight(curRec,curMonth); renderMonthMiniWidget(curRec,curMonth); renderAchievements(); renderTips();
  const unlocked=getUnlockedAchievements().length; if($('achCounter'))$('achCounter').textContent=`${unlocked}/${ACHIEVEMENTS.length}`;
  checkReminders();
}

function isDayInRange(day, start, end) {
  return start <= end ? day >= start && day <= end : day >= start || day <= end;
}

function getNextDeadlineLabel() {
  if (!prefs.remindersEnabled) return 'Нагадування вимкнені';
  const day = new Date().getDate();
  const windows = [
    { label: 'вода', icon: '💧', start: prefs.remWaterStart || 1, end: prefs.remWaterEnd || 5, active: prefs.showWater || prefs.showHotWater },
    { label: 'світло', icon: '⚡', start: prefs.remElectroStart || 28, end: prefs.remElectroEnd || 3, active: prefs.showElectro },
    { label: 'газ', icon: '🔥', start: prefs.remGasStart || 1, end: prefs.remGasEnd || 5, active: prefs.showGas },
  ].filter(item => item.active);
  const active = windows.filter(item => isDayInRange(day, item.start, item.end));
  if (active.length) return 'Зараз: ' + active.map(item => `${item.icon} ${item.label}`).join(', ');
  const upcoming = windows
    .map(item => ({ ...item, distance: item.start >= day ? item.start - day : item.start + 31 - day }))
    .sort((a,b)=>a.distance-b.distance)[0];
  return upcoming ? `${upcoming.icon} ${upcoming.label}: ${upcoming.start}–${upcoming.end}` : '—';
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
$('paymentStatusInput')?.addEventListener('change',()=>{if($('paidAmountInput')){$('paidAmountInput').style.display=$('paymentStatusInput').value==='partial'?'block':'none';if($('paymentStatusInput').value!=='partial')$('paidAmountInput').value='';}});
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
$('utilityForm')?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(!requireEdit('У режимі перегляду не можна зберігати записи'))return;
  if(!validateReadingsUI()){showToast('Перевірте показники','⚠️');return;}
  const hasWater   =prefs.showWater   &&(getV('wCur')>0||getV('wPrev')>0);
  const hasHotWater=prefs.showHotWater&&(getV('hwCur')>0||getV('hwPrev')>0);
  const hasElectro =prefs.showElectro &&(getV('dCur')>0||getV('dPrev')>0||getV('nCur')>0);
  const hasGas     =prefs.showGas     &&(getV('gCur')>0||getV('gPrev')>0);
  const hasCustom  =customServices.some(srv=>{const v=parseFloat($(`custom_${srv.id}`)?.value);return !isNaN(v)&&v>0;});
  if(!hasWater&&!hasHotWater&&!hasElectro&&!hasGas&&!hasCustom){showToast('Заповніть хоча б одну послугу','⚠️');return;}
  const month=$('monthInput').value;
  const warning=getSaveAnomalyWarning(currentCalc.total,month);
  if(warning&&!(await showAppConfirm(warning,{title:'Незвичне значення',confirmLabel:'Все одно зберегти',icon:'⚠️'}))){showToast('Перевірте дані','⚠️');return;}
  let cData={};
  customServices.forEach(srv=>{let v=parseFloat($(`custom_${srv.id}`)?.value);if(isNaN(v)&&srv.defaultSum)v=parseFloat(srv.defaultSum);if(!isNaN(v)&&v>0)cData[srv.id]={name:srv.name,val:v};});
  const existingIdx=records.findIndex(r=>r.month===month);
  const paymentData=getPaymentInputData(currentCalc.total);
  const newData={id:Date.now(),month,wPrev:hasWater?getV('wPrev'):0,wCur:hasWater?getV('wCur'):0,hwPrev:hasHotWater?getV('hwPrev'):0,hwCur:hasHotWater?getV('hwCur'):0,dPrev:hasElectro?getV('dPrev'):0,dCur:hasElectro?getV('dCur'):0,nPrev:(hasElectro&&prefs.electroTwoZone)?getV('nPrev'):0,nCur:(hasElectro&&prefs.electroTwoZone)?getV('nCur'):0,gPrev:hasGas?getV('gPrev'):0,gCur:hasGas?getV('gCur'):0,customData:cData,note:$('recordNote')?.value?.trim()||'',waterCost:hasWater?currentCalc.waterCost:0,hotWaterCost:hasHotWater?currentCalc.hotWaterCost:0,electroCost:hasElectro?currentCalc.electroCost:0,gasCost:hasGas?currentCalc.gasCost:0,customCost:currentCalc.customCost,total:currentCalc.total,...paymentData,tariffSnapshot:createTariffSnapshot(),_filled:{water:hasWater,hotWater:hasHotWater,electro:hasElectro,gas:hasGas,custom:hasCustom}};
  if(existingIdx>=0){
    const existing=records[existingIdx];
    const merged={...existing,...newData,id:existing.id};
    if(!hasWater   &&existing._filled?.water)   {merged.wPrev=existing.wPrev;merged.wCur=existing.wCur;merged.waterCost=existing.waterCost;merged._filled.water=true;}
    if(!hasHotWater&&existing._filled?.hotWater){merged.hwPrev=existing.hwPrev;merged.hwCur=existing.hwCur;merged.hotWaterCost=existing.hotWaterCost;merged._filled.hotWater=true;}
    if(!hasElectro &&existing._filled?.electro) {merged.dPrev=existing.dPrev;merged.dCur=existing.dCur;merged.nPrev=existing.nPrev;merged.nCur=existing.nCur;merged.electroCost=existing.electroCost;merged._filled.electro=true;}
    if(!hasGas     &&existing._filled?.gas)     {merged.gPrev=existing.gPrev;merged.gCur=existing.gCur;merged.gasCost=existing.gasCost;merged._filled.gas=true;}
    if(!hasCustom  &&existing._filled?.custom)  {merged.customData={...existing.customData,...cData};merged.customCost=existing.customCost;merged._filled.custom=true;}
    else if(hasCustom){merged.customData={...(existing.customData||{}),...cData};}
    merged.total=(merged.waterCost||0)+(merged.hotWaterCost||0)+(merged.electroCost||0)+(merged.gasCost||0)+(merged.customCost||0);
    setRecordPayment(merged, paymentData.paymentStatus, paymentData.paidAmount);
    merged.note=newData.note||existing.note;
    records[existingIdx]=merged; addChangeLog('record_updated', { month, total: merged.total }); showToast("Оновлено! 🔄");
  } else { records.push(newData); addChangeLog('record_created', { month, total: newData.total }); showToast("Збережено! ✨"); }
  clearDraft();
  $('submitFormBtn')?.classList.add('save-btn-success');
  setTimeout(()=>$('submitFormBtn')?.classList.remove('save-btn-success'),600);
  localStorage.setItem('lastSubmittedMonth', getMonthKey());
  syncToCloud();
  const[y,m]=$('monthInput').value.split('-').map(Number),nD=new Date(y,m);
  $('monthInput').value=`${nD.getFullYear()}-${String(nD.getMonth()+1).padStart(2,'0')}`;
  setPaymentInputsFromRecord(null);
  fillPreviousReadings();calculatePreview();updateSmartBadges();checkNewAchievements();
  switchTab('tabDashboard',0);
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
      if(prefs.showWater)   {if(currentRecord.wPrev!=null&&$('wPrev'))$('wPrev').value=currentRecord.wPrev;if(currentRecord.wCur!=null&&$('wCur'))$('wCur').value=currentRecord.wCur;}
      if(prefs.showHotWater){if(currentRecord.hwPrev!=null&&$('hwPrev'))$('hwPrev').value=currentRecord.hwPrev;if(currentRecord.hwCur!=null&&$('hwCur'))$('hwCur').value=currentRecord.hwCur;}
      if(prefs.showElectro) {if(currentRecord.dPrev!=null&&$('dPrev'))$('dPrev').value=currentRecord.dPrev;if(currentRecord.dCur!=null&&$('dCur'))$('dCur').value=currentRecord.dCur;if(prefs.electroTwoZone){if(currentRecord.nPrev!=null&&$('nPrev'))$('nPrev').value=currentRecord.nPrev;if(currentRecord.nCur!=null&&$('nCur'))$('nCur').value=currentRecord.nCur;}}
      if(prefs.showGas)     {if(currentRecord.gPrev!=null&&$('gPrev'))$('gPrev').value=currentRecord.gPrev;if(currentRecord.gCur!=null&&$('gCur'))$('gCur').value=currentRecord.gCur;}
      if(currentRecord.customData)Object.keys(currentRecord.customData).forEach(srvId=>{const el=$(`custom_${srvId}`);if(el)el.value=currentRecord.customData[srvId].val;});
      if($('recordNote'))$('recordNote').value=currentRecord.note||'';
      setPaymentInputsFromRecord(currentRecord);
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

function fillTariffInputs(nextTariffs) {
  if($('tWater'))         $('tWater').value        =nextTariffs.water;
  if($('tHotWater'))      $('tHotWater').value      =nextTariffs.hotWater;
  if($('tElectroBase'))   $('tElectroBase').value   =nextTariffs.electroBase;
  if($('tElectroWinter')) $('tElectroWinter').value =nextTariffs.electroWinter;
  if($('tGas'))           $('tGas').value           =nextTariffs.gas;
}

function renderTariffPresets() {
  renderTariffPresetsExtended();
}

function applyTariffPreset(presetId) {
  if (presetId.startsWith('comm_')) {
    const item = getCommunityTariffs().find(tariff => tariff.id === presetId.slice(5));
    if (!item) return;
    fillTariffInputs({ ...defaultTariffs, ...item.tariffs });
    showToast(`"${item.name}" застосовано`, '🏙️');
    return;
  }
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
  localStorage.setItem(CUSTOM_TARIFF_TEMPLATE_KEY,JSON.stringify(tpl));
  addChangeLog('tariff_template_saved');
  renderChangeLog();
  showToast('Шаблон тарифів збережено','💾');
});
$('loadTariffTemplateBtn')?.addEventListener('click',()=>{
  try{const tpl=JSON.parse(localStorage.getItem(CUSTOM_TARIFF_TEMPLATE_KEY)||'null');if(!tpl)return showToast('Шаблон не знайдено','⚠️');fillTariffInputs({...defaultTariffs,...tpl});addChangeLog('tariff_template_loaded');renderChangeLog();showToast('Шаблон застосовано','✅');}
  catch(e){showToast('Шаблон пошкоджено','❌');}
});
$('resetTariffsBtn')?.addEventListener('click',()=>{fillTariffInputs(defaultTariffs);addChangeLog('tariffs_reset');renderChangeLog();showToast('Базові тарифи','✅');});
$('tariffPresetSelect')?.addEventListener('change',(e)=>{applyTariffPreset(e.target.value);e.target.value='';});
$('familyRoleSelect')?.addEventListener('change',(e)=>{prefs.familyRole=e.target.value;updateFamilyRoleHint();});

['prefWater','prefHotWater','prefElectro','prefGas','prefElectroTwoZone','prefElectroWinter'].forEach(id=>{$(id)?.addEventListener('change',()=>{prefs.showWater=$('prefWater')?.checked??prefs.showWater;prefs.showHotWater=$('prefHotWater')?.checked??prefs.showHotWater;prefs.showElectro=$('prefElectro')?.checked??prefs.showElectro;prefs.showGas=$('prefGas')?.checked??prefs.showGas;prefs.electroTwoZone=$('prefElectroTwoZone')?.checked??prefs.electroTwoZone;prefs.electroWinter=$('prefElectroWinter')?.checked??prefs.electroWinter;applyPreferences();renderCalcCustomServices();calculatePreview();updateSmartBadges();});});
$('prefReminders')?.addEventListener('change',function(){
  prefs.remindersEnabled = this.checked;
  if($('remindersSettings'))$('remindersSettings').style.display=this.checked?'block':'none';
});

$('saveSettingsBtn')?.addEventListener('click',()=>{
  tariffs={water:parseFloat($('tWater')?.value)||defaultTariffs.water,hotWater:parseFloat($('tHotWater')?.value)||defaultTariffs.hotWater,electroBase:parseFloat($('tElectroBase')?.value)||defaultTariffs.electroBase,electroWinter:parseFloat($('tElectroWinter')?.value)||defaultTariffs.electroWinter,winterLimit:2000,nightCoef:0.5,gas:parseFloat($('tGas')?.value)||defaultTariffs.gas};
  prefs={showWater:$('prefWater')?.checked,showHotWater:$('prefHotWater')?.checked,showElectro:$('prefElectro')?.checked,showGas:$('prefGas')?.checked,electroTwoZone:$('prefElectroTwoZone')?.checked,electroWinter:$('prefElectroWinter')?.checked,remindersEnabled:$('prefReminders')?.checked,remWaterStart:parseInt($('remWaterStart')?.value)||1,remWaterEnd:parseInt($('remWaterEnd')?.value)||5,remElectroStart:parseInt($('remElectroStart')?.value)||28,remElectroEnd:parseInt($('remElectroEnd')?.value)||3,remGasStart:parseInt($('remGasStart')?.value)||1,remGasEnd:parseInt($('remGasEnd')?.value)||5,familyRole:$('familyRoleSelect')?.value||getFamilyRole()};
  customServices=customServices.filter(s=>s.name.trim()!=="");
  const budgetVal = parseFloat($('budgetInput')?.value);
  localStorage.setItem('k_budget', Number.isFinite(budgetVal) && budgetVal > 0 ? String(budgetVal) : '');
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
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function checkReminders(){
  // Делегуємо до розширеної версії (якщо вже оголошена) або базової логіки
  if (typeof checkRemindersExtended === 'function') { checkRemindersExtended(); return; }
  const monthKey = getMonthKey();
  if(!prefs.remindersEnabled||localStorage.getItem('lastSubmittedMonth')===monthKey){$('reminderBanner')?.classList.add('hidden');return;}
  const d=new Date().getDate();let msgs=[];
  const wS=prefs.remWaterStart||1,wE=prefs.remWaterEnd||5,eS=prefs.remElectroStart||28,eE=prefs.remElectroEnd||3,gS=prefs.remGasStart||1,gE=prefs.remGasEnd||5;
  const isW=isDayInRange(d,wS,wE),isE=isDayInRange(d,eS,eE),isG=isDayInRange(d,gS,gE);
  if(isW&&(prefs.showWater||prefs.showHotWater))msgs.push("💧 Воду");
  if(isE&&prefs.showElectro)msgs.push("⚡️ Світло");
  if(isG&&prefs.showGas)msgs.push("🔥 Газ");
  if(msgs.length>0){$('reminderBanner')?.classList.remove('hidden');if($('reminderText'))$('reminderText').innerText="Передайте: "+msgs.join(" та ");}
  else $('reminderBanner')?.classList.add('hidden');
}
$('reminderDismissBtn')?.addEventListener('click',()=>{
  localStorage.setItem('lastSubmittedMonth', getMonthKey());
  $('reminderBanner')?.classList.add('hidden');
  showToast("Нагадаємо наступного місяця","🔔");
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
  let startX=0,currentX=0,isSwiping=false;const threshold=80;
  card.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;isSwiping=true;card.classList.add('swiping');},{passive:true});
  card.addEventListener('touchmove',e=>{if(!isSwiping)return;currentX=e.touches[0].clientX-startX;const limited=Math.sign(currentX)*Math.min(Math.abs(currentX),120);card.style.transform=`translateX(${limited}px)`;const l=card.querySelector('.swipe-bg-left'),r=card.querySelector('.swipe-bg-right');if(l)l.style.opacity=currentX<-30?'1':'0';if(r)r.style.opacity=currentX>30?'1':'0';},{passive:true});
  card.addEventListener('touchend',()=>{isSwiping=false;card.classList.remove('swiping');card.style.transform='';const l=card.querySelector('.swipe-bg-left'),r=card.querySelector('.swipe-bg-right');if(l)l.style.opacity='0';if(r)r.style.opacity='0';if(currentX<-threshold){card.style.transform='translateX(-100%)';card.style.opacity='0';setTimeout(()=>deleteRecordById(recordId),300);}else if(currentX>threshold){card.style.transform='translateX(100%)';card.style.opacity='0';setTimeout(()=>togglePaidById(recordId),300);}currentX=0;},{passive:true});
}

// =================== RECORDS ===================
function findRecordIndex(id){return records.findIndex(r=>r.id===id);}
function togglePaidById(id){if(!requireEdit('У режимі перегляду не можна змінювати оплату'))return;const idx=findRecordIndex(id);if(idx<0)return;const nextStatus=isRecordPaid(records[idx])?'charged':'paid';setRecordPayment(records[idx],nextStatus,nextStatus==='paid'?records[idx].total:0);addChangeLog('record_paid_toggled',{month:records[idx].month,paid:records[idx].paid,status:records[idx].paymentStatus});renderRecords();renderDashboard();syncCurrentAddress();syncToCloud();checkNewAchievements();}
function deleteRecordById(id){
  if(!requireEdit('У режимі перегляду не можна видаляти записи'))return;
  const idx=findRecordIndex(id);
  if(idx<0)return;
  const deleted=records[idx];
  records=records.filter(r=>r.id!==id);
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
  if(records.length===0){list.innerHTML=`<div class="text-center py-12"><i class="fa-solid fa-clock-rotate-left text-4xl text-slate-300 dark:text-slate-600 mb-4"></i><p class="text-slate-500 font-medium">Ще немає записів</p><p class="text-xs text-slate-400 mt-1">Додайте перший запис у вкладці "Рахунок"</p></div>`;if($('statsAvg'))$('statsAvg').innerText='0 ₴';if($('statsTotalPaid'))$('statsTotalPaid').innerText='0 ₴';if($('statsMin'))$('statsMin').innerText='0 ₴';if($('statsMax'))$('statsMax').innerText='0 ₴';if($('statsCount'))$('statsCount').innerText='0';renderHistoryChart([]);renderServiceChart();return;}
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
    batchBar.querySelector('.batch-pay-btn')?.addEventListener('click',async()=>{if(!requireEdit('У режимі перегляду не можна змінювати оплату'))return;if(await showAppConfirm(`Позначити ${unpaidCount} видимих записів як оплачені?`,{title:'Масова оплата',confirmLabel:'Позначити оплаченими',icon:'💳'})){const payableIds=new Set(sorted.filter(r=>getOutstandingAmount(r)>0).map(r=>r.id));records.forEach(r=>{if(payableIds.has(r.id))setRecordPayment(r,'paid',r.total);});addChangeLog('visible_records_paid',{count:payableIds.size});renderRecords();renderDashboard();syncCurrentAddress();syncToCloud();checkNewAchievements();showToast(`${unpaidCount} записів оплачено!`,'✅');}});
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


async function shareRecordById(id){const rec=records.find(r=>r.id===id);if(!rec)return;const d=new Date(rec.month+'-01').toLocaleString('uk-UA',{month:'long',year:'numeric'});let t=`🧾 Комуналка за ${d}\n📍 ${$('currentAddressDisplay')?.innerText||''}\n──────────\n`;if(rec.waterCost>0)t+=`💧 Вода: ${fmt.format(rec.waterCost)} ₴\n`;if(rec.hotWaterCost>0)t+=`🌡️ Гар.: ${fmt.format(rec.hotWaterCost)} ₴\n`;if(rec.electroCost>0)t+=`⚡ Світло: ${fmt.format(rec.electroCost)} ₴\n`;if(rec.gasCost>0)t+=`🔥 Газ: ${fmt.format(rec.gasCost)} ₴\n`;if(rec.customCost>0)t+=`📦 Інше: ${fmt.format(rec.customCost)} ₴\n`;t+=`──────────\n💰 Всього: ${fmt.format(rec.total)} ₴\n💳 ${getPaymentLabel(rec)}${getPaymentStatus(rec)==='partial'?`: ${fmt.format(getPaidAmount(rec))} ₴ сплачено, борг ${fmt.format(getOutstandingAmount(rec))} ₴`:''}`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){await showCopyDialog('Скопіюйте рахунок',t);}}

// =================== FILTER & SEARCH ===================
let searchDebounceTimer;
$('filterToggleBtn')?.addEventListener('click',()=>$('filterPanel')?.classList.toggle('hidden'));
$('filterButtons')?.addEventListener('click',(e)=>{const btn=e.target.closest('.filter-btn');if(!btn)return;currentFilter=btn.dataset.filter;document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.remove('bg-brand','text-white');b.classList.add('bg-slate-100','dark:bg-[#2c2c2e]','text-slate-600','dark:text-slate-400');});btn.classList.remove('bg-slate-100','dark:bg-[#2c2c2e]','text-slate-600','dark:text-slate-400');btn.classList.add('bg-brand','text-white');renderRecords();});
$('searchRecords')?.addEventListener('input',()=>{clearTimeout(searchDebounceTimer);searchDebounceTimer=setTimeout(renderRecords,200);});
$('sortSelect')?.addEventListener('change',()=>renderRecords());


// =================== IMPORT ===================
function isPlainObject(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function normalizeNumber(value,fallback=0){const num=Number(value);return Number.isFinite(num)?num:fallback;}
function normalizeImportedRecord(rec){if(!isPlainObject(rec)||!/^\d{4}-\d{2}$/.test(String(rec.month||'')))return null;const tariffSnapshot=isPlainObject(rec.tariffSnapshot)?{...defaultTariffs,...rec.tariffSnapshot}:null;const normalized={...rec,id:rec.id||Date.now()+Math.random(),month:String(rec.month),total:normalizeNumber(rec.total),waterCost:normalizeNumber(rec.waterCost),hotWaterCost:normalizeNumber(rec.hotWaterCost),electroCost:normalizeNumber(rec.electroCost),gasCost:normalizeNumber(rec.gasCost),customCost:normalizeNumber(rec.customCost),note:String(rec.note||'').slice(0,500),tariffSnapshot};setRecordPayment(normalized,getPaymentStatus(rec),rec.paidAmount);return normalized;}
function normalizeImportedAddress(addr,index){if(!isPlainObject(addr))return null;return{id:sanitizeDomId(addr.id||`addr_${Date.now()}_${index}`,'addr'),name:String(addr.name||`Об'єкт ${index+1}`).slice(0,80),tariffs:{...defaultTariffs,...(isPlainObject(addr.tariffs)?addr.tariffs:{})},prefs:{...defaultPrefs,...(isPlainObject(addr.prefs)?addr.prefs:{})},records:Array.isArray(addr.records)?addr.records.map(normalizeImportedRecord).filter(Boolean):[],customServices:Array.isArray(addr.customServices)?addr.customServices.filter(isPlainObject).map((srv,i)=>({id:sanitizeDomId(srv.id||`srv_${Date.now()}_${i}`,'srv'),name:String(srv.name||'').slice(0,60),defaultSum:srv.defaultSum==null?'':String(srv.defaultSum).slice(0,20)})):[]};}
function normalizeImportData(data){if(!isPlainObject(data)||!Array.isArray(data.addresses))return null;const addrs=data.addresses.map(normalizeImportedAddress).filter(Boolean);if(!addrs.length)return null;const cid=String(data.currentAddressId||'');return{addresses:addrs,currentAddressId:addrs.some(a=>a.id===cid)?cid:addrs[0].id};}
$('importFileInput')?.addEventListener('change',(e)=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async ev=>{try{const normalized=normalizeImportData(JSON.parse(ev.target.result));if(!normalized){showToast('Невірний формат','❌');return;}const recordCount=normalized.addresses.reduce((s,a)=>s+(a.records?.length||0),0);if(await showAppConfirm(`Буде імпортовано ${normalized.addresses.length} об’єктів і ${recordCount} записів. Поточні дані заміняться після створення аварійного бекапу.`,{title:'Імпортувати дані?',confirmLabel:'Імпортувати',icon:'📥'})){backupCurrentState(PRE_IMPORT_BACKUP_KEY);addresses=normalized.addresses;currentAddressId=normalized.currentAddressId;addChangeLog('json_imported',{addresses:normalized.addresses.length,records:recordCount});loadCurrentAddress();syncToCloud();showActionToast('Імпортовано','Скасувати',()=>{if(restoreFromLocalBackup(PRE_IMPORT_BACKUP_KEY)){addChangeLog('import_rolled_back');showToast('Імпорт скасовано','✅');}else showToast('Немає бекапу','⚠️');},'✅');}}catch(err){showToast('Помилка','❌');}};reader.readAsText(file);e.target.value='';});
$('restoreBackupBtn')?.addEventListener('click',async()=>{if(await showAppConfirm('Поточні дані буде замінено, але перед цим ми збережемо їх окремо.',{title:'Відновити локальний бекап?',confirmLabel:'Відновити',icon:'🕘'})){backupCurrentState(PRE_IMPORT_BACKUP_KEY);if(restoreFromLocalBackup(LOCAL_BACKUP_KEY)){addChangeLog('local_backup_restored');showToast('Бекап відновлено','✅');}else showToast('Бекап не знайдено','⚠️');}});
$('restorePreImportBtn')?.addEventListener('click',async()=>{if(await showAppConfirm('Повернути дані до стану перед останнім імпортом?',{title:'Скасувати імпорт?',confirmLabel:'Відновити',icon:'↶'})){if(restoreFromLocalBackup(PRE_IMPORT_BACKUP_KEY)){addChangeLog('pre_import_backup_restored');showToast('Відновлено','✅');}else showToast('Бекап не знайдено','⚠️');}});
$('forgetDeviceBtn')?.addEventListener('click',async()=>{if(await showAppConfirm('Дані входу буде видалено лише з цього пристрою. Локальні бекапи й налаштування залишаться.',{title:'Забути цей пристрій?',confirmLabel:'Забути',danger:true,icon:'🔐'})){['k_login','k_passHash','k_uid','k_display_name'].forEach(key=>localStorage.removeItem(key));addChangeLog('device_credentials_forgotten');location.reload();}});

// =================== TIPS ===================
function getConsumptionTrend(type,months=6){const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,months);if(sorted.length<2)return null;const values=sorted.map(r=>{switch(type){case 'water':return Math.max(0,(r.wCur||0)-(r.wPrev||0));case 'electro':return Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0));case 'gas':return Math.max(0,(r.gCur||0)-(r.gPrev||0));default:return r.total;}}).reverse();const first=values.slice(0,Math.ceil(values.length/2)),second=values.slice(Math.ceil(values.length/2));const avgF=first.reduce((a,b)=>a+b,0)/first.length,avgS=second.reduce((a,b)=>a+b,0)/second.length;if(avgF===0)return 0;return Math.round(((avgS-avgF)/avgF)*100);}
function getSmartTips(){const tips=[];if(records.length>=3){const wT=getConsumptionTrend('water');if(wT&&wT>20)tips.push({emoji:'💧',text:`Споживання води зросло на ${wT}%. Перевірте крани.`});const eT=getConsumptionTrend('electro');if(eT&&eT>20)tips.push({emoji:'⚡',text:`Електрика +${eT}%. Перевірте прилади.`});if(eT&&eT<-10)tips.push({emoji:'🎉',text:`Електрика -${Math.abs(eT)}%! Чудова економія!`});}const budget=parseFloat(localStorage.getItem('k_budget'))||0;if(budget&&records.length>0){const last=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month))[0];if(last.total>budget*1.2)tips.push({emoji:'⚠️',text:`Перевищили бюджет на ${Math.round(((last.total-budget)/budget)*100)}%`});}const unpaid=records.filter(r=>getOutstandingAmount(r)>0);if(unpaid.length>=3)tips.push({emoji:'💳',text:`${unpaid.length} місяців із боргом. Оплатіть або відмітьте часткову оплату.`});if(prefs.showElectro&&prefs.electroTwoZone&&records.length>0){const last=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month))[0];const n=Math.max(0,(last.nCur||0)-(last.nPrev||0)),d=Math.max(0,(last.dCur||0)-(last.dPrev||0)),tot=n+d;if(tot>0&&n/tot<0.3)tips.push({emoji:'🌙',text:'Спробуйте більше електрики вночі — дешевше.'});}return tips.slice(0,3);}
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
async function shareYearReport(){const year=new Date().getFullYear(),yr=records.filter(r=>r.month.startsWith(String(year)));if(!yr.length)return;const total=yr.reduce((s,r)=>s+r.total,0),avg=total/yr.length,streak=getStreak(records);let t=`📊 Річний звіт ${year}\n📍 ${$('currentAddressDisplay')?.innerText||''}\n═══════════════\n💰 Всього: ${fmt.format(total)} ₴\n📈 Середній: ${fmt.format(avg)} ₴/міс\n📅 Записів: ${yr.length}\n🔥 Серія: ${streak} міс.\n═══════════════\nКомуналка PWA`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){await showCopyDialog('Скопіюйте річний звіт',t);}}
window.shareYearReport=shareYearReport;

// =================== PWA ===================
let deferredPrompt;
let pendingServiceWorker=null;
let isRefreshingAfterUpdate=false;
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;$('pwaInstallBlock')?.classList.remove('hidden');});
$('installPwaBtn')?.addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();const{outcome}=await deferredPrompt.userChoice;if(outcome==='accepted')$('pwaInstallBlock')?.classList.add('hidden');deferredPrompt=null;});

// =================== PUSH ===================
async function initPush(){if(!('Notification' in window))return;const btn=$('enablePushBtn'),st=$('pushStatus');if(Notification.permission==='granted'){if(btn)btn.classList.add('hidden');if(st){st.classList.remove('hidden');st.textContent='✓ Push увімкнено';st.className='text-[10px] text-green-500 text-center font-bold';}}else if(Notification.permission!=='denied'){if(btn)btn.classList.remove('hidden');}}
$('enablePushBtn')?.addEventListener('click',async()=>{try{const p=await Notification.requestPermission();if(p==='granted'){showToast('Push увімкнено!','🔔');initPush();scheduleLocalReminder();}else showToast('Відмовлено','⚠️');}catch(e){showToast('Помилка','❌');}});
function scheduleLocalReminder(){if(!('Notification' in window)||Notification.permission!=='granted')return;const d=new Date().getDate(),wS=prefs.remWaterStart||1,wE=prefs.remWaterEnd||5,eS=prefs.remElectroStart||28,eE=prefs.remElectroEnd||3,gS=prefs.remGasStart||1,gE=prefs.remGasEnd||5;const isW=isDayInRange(d,wS,wE)&&(prefs.showWater||prefs.showHotWater),isE=isDayInRange(d,eS,eE)&&prefs.showElectro,isG=isDayInRange(d,gS,gE)&&prefs.showGas;const monthKey=getMonthKey();if((isW||isE||isG)&&localStorage.getItem('lastSubmittedMonth')!==monthKey&&localStorage.getItem('lastPushShown')!==new Date().toDateString()){localStorage.setItem('lastPushShown',new Date().toDateString());new Notification('Комуналка 🏠',{body:'Час передати показники!',icon:'icon.png'});}}
setTimeout(initPush,1000);setTimeout(scheduleLocalReminder,3000);

// =================== SHARE APP ===================
$('shareAppBtn')?.addEventListener('click',async()=>{const text='🏠 Комуналка — розумний облік комунальних платежів.\nВода, світло, газ — все в одному додатку. Безкоштовно!\n\nhttps://komynalka.vercel.app';if(navigator.share){try{await navigator.share({text,url:'https://komynalka.vercel.app'});return;}catch(e){}}try{await navigator.clipboard.writeText(text);showToast('Посилання скопійовано!','📋');}catch(e){await showCopyDialog('Скопіюйте посилання',text);}});

// =================== LOGOUT ===================
async function logout(){
  if(isGuest){window.location.href=window.location.pathname;return;}
  if(await showAppConfirm('Локальний бекап і налаштування залишаться на пристрої.',{title:'Вийти з акаунту?',confirmLabel:'Вийти',danger:true,icon:'↪'})){
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
    const shareUrl=`${window.location.origin}${window.location.pathname}?share=${data.shareToken}`,addrName=addresses.find(a=>a.id===currentAddressId)?.name||'Мій дім';
    if(navigator.share){try{await navigator.share({title:'Комуналка',text:`Перегляд за "${addrName}"`,url:shareUrl});showToast('Надіслано!','✅');return;}catch(e){if(e.name==='AbortError')return;}}
    try{await navigator.clipboard.writeText(shareUrl);showToast('Посилання скопійовано!','📋');}catch(e){await showCopyDialog('Скопіюйте гостьове посилання',shareUrl);}
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
  if($('budgetInput'))    $('budgetInput').value    =localStorage.getItem('k_budget')||'';
  if($('accountLoginDisplay'))$('accountLoginDisplay').textContent=sessionLogin||'—';
  updateGoogleButton();
  updateDisplayName();
  renderTariffPresets();
  applyPreferences();
  renderCalcCustomServices();
  setPaymentInputsFromRecord(null);
  fillPreviousReadings();
  switchTab('tabDashboard',0);
  calculatePreview();
  updateSmartBadges();
  renderDashboard();

  const vis=readingInputIds.map(id=>$(id)).filter(el=>el&&el.offsetParent!==null);
  vis.forEach((input,idx,arr)=>{
    if(input.dataset.keyboardNavBound==='true')return;
    input.dataset.keyboardNavBound='true';
    input.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();const next=arr[idx+1];if(next)next.focus();else $('submitFormBtn')?.focus();}});
  });

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
} else if(localStorage.getItem('k_uid')){
  performLogin(null,null,false,localStorage.getItem('k_uid'));
} else if(sessionLogin&&sessionPass){
  performLogin(sessionLogin,sessionPass,true);
}

$('mode-light')?.addEventListener('click',()=>setThemeMode('light'));
$('mode-auto')?.addEventListener('click', ()=>setThemeMode('auto'));
$('mode-dark')?.addEventListener('click', ()=>setThemeMode('dark'));
$('liquidGlassRange')?.addEventListener('input',(e)=>applyLiquidGlassLevel(e.target.value));
$('liquidGlassRange')?.addEventListener('change',(e)=>{localStorage.setItem('liquidGlassLevel',String(currentLiquidGlass));showToast(`Скло: ${currentLiquidGlass}%`,'✨');});
$('emptyStateAddBtn')?.addEventListener('click',()=>switchTab('tabCalc',1));

function closeQuickActions(){
  $('quickActionsModal')?.classList.add('hidden');
  $('quickActionsBtn')?.setAttribute('aria-expanded','false');
}
$('quickActionsModal')?.addEventListener('click',(event)=>{if(event.target===event.currentTarget)closeQuickActions();});
$('shareYearReportBtn')?.addEventListener('click',shareYearReport);
$('closeYearReportBtn')?.addEventListener('click',()=>$('yearReportModal')?.classList.add('hidden'));
$('yearReportModal')?.addEventListener('click',(event)=>{if(event.target===event.currentTarget)event.currentTarget.classList.add('hidden');});
$('closeAchievementDetailBtn')?.addEventListener('click',()=>$('achievementDetailModal')?.classList.add('hidden'));
$('achievementDetailModal')?.addEventListener('click',(event)=>{if(event.target===event.currentTarget)event.currentTarget.classList.add('hidden');});

// =================== RESIZE ===================
let resizeTimeout;
window.addEventListener('resize',()=>{clearTimeout(resizeTimeout);resizeTimeout=setTimeout(()=>{[dashChart,historyChart,serviceChart,donutChart].forEach(chart=>{if(chart&&chart.canvas){chart.setupCanvas();if(chart.width)chart.render();}});},250);});

// =================== LAZY CHARTS ===================
const chartObserver=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(!entry.isIntersecting)return;const id=entry.target.id;if(id==='dashChartCanvas'   &&dashChart)   {dashChart.setupCanvas();   dashChart.render();}if(id==='donutCanvas'       &&donutChart)  {donutChart.setupCanvas();  donutChart.render();}if(id==='historyChartCanvas'&&historyChart){historyChart.setupCanvas();historyChart.render();}if(id==='serviceChartCanvas'&&serviceChart){serviceChart.setupCanvas();serviceChart.render();}});},{threshold:0.1});
['dashChartCanvas','donutCanvas','historyChartCanvas','serviceChartCanvas'].forEach(id=>{const el=$(id);if(el)chartObserver.observe(el);});

// =================== SW UPDATE ===================
async function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    const registration=await navigator.serviceWorker.register('./sw.js');
    registration.addEventListener('updatefound',()=>{const nextWorker=registration.installing;if(!nextWorker)return;nextWorker.addEventListener('statechange',()=>{if(nextWorker.state==='installed'&&navigator.serviceWorker.controller){pendingServiceWorker=nextWorker;showUpdateBanner();}});});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(isRefreshingAfterUpdate)return;isRefreshingAfterUpdate=true;window.location.reload();});
    setInterval(()=>{navigator.serviceWorker.getRegistration().then(reg=>{if(reg)reg.update();});},1800000);
  }catch(e){console.error('SW:',e);}
}
window.addEventListener('load',registerServiceWorker);

function showUpdateBanner(){
  if($('updateBanner'))return;
  const banner=document.createElement('div');
  banner.id='updateBanner';
  banner.className='fixed bottom-24 left-4 right-4 z-[900] bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-4 rounded-2xl flex items-center justify-between shadow-2xl max-w-md mx-auto';
  banner.innerHTML=`<div class="flex items-center gap-3"><span class="text-lg">🆕</span><div><p class="text-sm font-bold">Оновлення доступне</p><p class="text-[10px] opacity-60">Натисніть щоб оновити</p></div></div><button id="applyUpdateBtn" type="button" class="px-4 py-2 bg-brand text-white rounded-xl text-xs font-bold active:scale-95">Оновити</button>`;
  document.body.appendChild(banner);
  $('applyUpdateBtn')?.addEventListener('click',()=>{if(pendingServiceWorker)pendingServiceWorker.postMessage({type:'SKIP_WAITING'});else window.location.reload();});
}

// =================== EDIT RECORD ===================
function editRecordById(id) {
  if(!requireEdit('У режимі перегляду не можна редагувати записи')) return;
  const rec = records.find(r => r.id === id);
  if (!rec) return;
  if ($('monthInput')) $('monthInput').value = rec.month;
  if (prefs.showWater)    { if($('wPrev'))$('wPrev').value=rec.wPrev||''; if($('wCur'))$('wCur').value=rec.wCur||''; }
  if (prefs.showHotWater) { if($('hwPrev'))$('hwPrev').value=rec.hwPrev||''; if($('hwCur'))$('hwCur').value=rec.hwCur||''; }
  if (prefs.showElectro)  { if($('dPrev'))$('dPrev').value=rec.dPrev||''; if($('dCur'))$('dCur').value=rec.dCur||''; if($('nPrev'))$('nPrev').value=rec.nPrev||''; if($('nCur'))$('nCur').value=rec.nCur||''; }
  if (prefs.showGas)      { if($('gPrev'))$('gPrev').value=rec.gPrev||''; if($('gCur'))$('gCur').value=rec.gCur||''; }
  if (rec.customData) Object.keys(rec.customData).forEach(srvId=>{ const el=$(`custom_${srvId}`); if(el) el.value=rec.customData[srvId].val; });
  if ($('recordNote')) $('recordNote').value = rec.note || '';
  setPaymentInputsFromRecord(rec);
  autoSetWinter(rec.month);
  // Показати банер що редагуємо
  showEditingBanner(rec.month);
  switchTab('tabCalc', 1);
  // Важливо: рахуємо по АКТУАЛЬНИХ тарифах (не tariffSnapshot)
  calculatePreview();
  updateSmartBadges();
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
        <p class="text-[10px] text-amber-600/70 dark:text-amber-500/70">Рахунок перераховується по актуальних тарифах</p>
      </div>
    </div>
    <button type="button" aria-label="Закрити повідомлення про редагування" class="editing-banner-dismiss w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 flex items-center justify-center text-xs active:scale-90">✕</button>
  </div>`;
  banner.querySelector('.editing-banner-dismiss')?.addEventListener('click', () => banner.remove());
  const calcTab = $('tabCalc');
  if (calcTab) calcTab.insertBefore(banner, calcTab.firstChild);
}

// =================== CUSTOM REMINDERS ===================
function getCustomReminders() {
  try {
    const raw = localStorage.getItem(CUSTOM_REMINDERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  // Дефолтні нагадування (видаляються)
  return [
    { id: 'water',   emoji: '💧', label: 'Вода',   startDay: 1,  endDay: 5,  active: true,  deletable: false },
    { id: 'electro', emoji: '⚡', label: 'Світло', startDay: 28, endDay: 3,  active: true,  deletable: false },
    { id: 'gas',     emoji: '🔥', label: 'Газ',    startDay: 1,  endDay: 5,  active: true,  deletable: false },
  ];
}

function saveCustomReminders(reminders) {
  try { localStorage.setItem(CUSTOM_REMINDERS_KEY, JSON.stringify(reminders)); } catch(e) {}
}

function renderCustomReminders() {
  const container = $('customRemindersList');
  if (!container) return;
  const reminders = getCustomReminders();
  container.innerHTML = reminders.map((rem, idx) => `
    <div class="flex items-center gap-2 bg-slate-50 dark:bg-black/40 p-2.5 rounded-xl border border-slate-100 dark:border-white/5">
      <input type="text" value="${escapeAttr(rem.emoji)}" data-rem-idx="${idx}" data-rem-field="emoji"
        class="rem-field w-10 bg-white dark:bg-[#2c2c2e] rounded-lg text-center text-base outline-none border border-transparent focus:border-brand px-1 py-1.5 transition-colors">
      <input type="text" value="${escapeAttr(rem.label)}" data-rem-idx="${idx}" data-rem-field="label"
        class="rem-field flex-1 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2.5 py-2 border border-transparent focus:border-brand transition-colors">
      <div class="flex items-center gap-1 text-[10px] text-slate-400 font-bold">
        <input type="number" value="${rem.startDay}" min="1" max="31" data-rem-idx="${idx}" data-rem-field="startDay"
          class="rem-field w-9 bg-white dark:bg-[#2c2c2e] rounded-lg text-center outline-none border border-transparent focus:border-brand py-1.5 font-bold text-xs transition-colors">
        <span>—</span>
        <input type="number" value="${rem.endDay}" min="1" max="31" data-rem-idx="${idx}" data-rem-field="endDay"
          class="rem-field w-9 bg-white dark:bg-[#2c2c2e] rounded-lg text-center outline-none border border-transparent focus:border-brand py-1.5 font-bold text-xs transition-colors">
      </div>
      <label class="relative inline-flex items-center cursor-pointer shrink-0">
        <input type="checkbox" ${rem.active ? 'checked' : ''} data-rem-idx="${idx}" data-rem-field="active"
          class="rem-field sr-only peer">
        <div class="w-8 h-4 bg-slate-200 dark:bg-white/10 rounded-full peer-checked:bg-brand transition-colors"></div>
        <div class="absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform shadow-sm peer-checked:translate-x-4"></div>
      </label>
      ${rem.deletable !== false ? `<button type="button" class="rem-del w-7 h-7 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-400 flex items-center justify-center text-xs active:scale-90 shrink-0" data-rem-idx="${idx}"><i class="fa-solid fa-trash text-[9px]"></i></button>` : `<div class="w-7 shrink-0"></div>`}
    </div>
  `).join('');

  container.querySelectorAll('.rem-field').forEach(input => {
    input.addEventListener('change', () => {
      const reminders = getCustomReminders();
      const idx = parseInt(input.dataset.remIdx);
      const field = input.dataset.remField;
      if (field === 'active') reminders[idx][field] = input.checked;
      else if (field === 'startDay' || field === 'endDay') reminders[idx][field] = parseInt(input.value) || 1;
      else reminders[idx][field] = input.value;
      saveCustomReminders(reminders);
    });
  });
  container.querySelectorAll('.rem-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const reminders = getCustomReminders();
      reminders.splice(parseInt(btn.dataset.remIdx), 1);
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
function checkRemindersExtended() {
  const monthKey = getMonthKey();
  if (!prefs.remindersEnabled || localStorage.getItem('lastSubmittedMonth') === monthKey) {
    $('reminderBanner')?.classList.add('hidden');
    return;
  }
  const d = new Date().getDate();
  const reminders = getCustomReminders();
  const activeNow = reminders.filter(rem => rem.active && isDayInRange(d, rem.startDay, rem.endDay));
  // Фільтруємо прив'язані до послуг
  const msgs = activeNow.filter(rem => {
    if (rem.id === 'water') return prefs.showWater || prefs.showHotWater;
    if (rem.id === 'electro') return prefs.showElectro;
    if (rem.id === 'gas') return prefs.showGas;
    return true; // кастомні завжди
  }).map(rem => `${rem.emoji} ${rem.label}`);

  if (msgs.length > 0) {
    $('reminderBanner')?.classList.remove('hidden');
    if ($('reminderText')) $('reminderText').innerText = 'Передайте: ' + msgs.join(', ');
  } else {
    $('reminderBanner')?.classList.add('hidden');
  }
}

// =================== COMMUNITY TARIFF PRESETS ===================
let cloudCommunityTariffsCache = [];
const TARIFF_SERVICE_LABELS = { all: 'Усі послуги', water: 'Вода', hotWater: 'Гаряча вода', electro: 'Світло', gas: 'Газ' };

function getCommunityTariffs() {
  try {
    const raw = localStorage.getItem(COMMUNITY_TARIFF_KEY);
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
  try { localStorage.setItem(COMMUNITY_TARIFF_KEY, JSON.stringify(trimmed)); } catch(e) {}
  return entry.id;
}

function deleteCommunityTariff(id) {
  const list = getCommunityTariffs().filter(t => t.id !== id);
  try { localStorage.setItem(COMMUNITY_TARIFF_KEY, JSON.stringify(list)); } catch(e) {}
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

// =================== RECORD CARD ===================

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

// Розширення switchTab: settings + analytics + editingBanner
// Перехоплюємо події через addEventListener на кнопки навігації,
// щоб НЕ створювати рекурсивний патч функції switchTab
['btnTabSettings','btnTabAnalytics','btnTabDashboard','btnTabCalc','btnTabHistory'].forEach(btnId => {
  const btn = $(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const targetTabId = btnId === 'btnTabSettings' ? 'tabSettings'
      : btnId === 'btnTabAnalytics' ? 'tabAnalytics'
      : btnId === 'btnTabDashboard' ? 'tabDashboard'
      : btnId === 'btnTabCalc' ? 'tabCalc'
      : 'tabHistory';

    if (targetTabId === 'tabSettings') {
      setTimeout(() => {
        renderCustomReminders();
        renderCommunityTariffs();
        loadCloudCommunityTariffs();
      }, 120);
    }
    if (targetTabId === 'tabAnalytics') {
      setTimeout(() => {
        renderSubsidyCalc();
        renderAddressCompare();
        renderCombinedReport();
      }, 220);
    }
    if (targetTabId !== 'tabCalc') {
      setTimeout(() => $('editingBanner')?.remove(), 50);
    }
  });
});

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
