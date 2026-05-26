// ============================================================
// КОМУНАЛКА PWA — Secure & Optimized
// ============================================================
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
const APP_VERSION = '3.2.0';
const MAX_ADDRESSES_FREE = 3;

const firebaseConfig = {
    apiKey: "AIzaSyBgRHmaHjg23BIZjJdCucwnmMFDX57XP80",
    authDomain: "pwakomun.firebaseapp.com",
    projectId: "pwakomun",
    storageBucket: "pwakomun.firebasestorage.app",
    messagingSenderId: "4437974770",
    appId: "1:4437974770:web:bf7d2f7bac35eff5707a6b"
};

// Firebase init (deferred — скрипти з defer)
let firebaseReady = false;
function initFirebase() {
    if (firebaseReady) return;
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        firebaseReady = true;
    }
}

// Splash — швидкий
window.addEventListener('load', () => {
    initFirebase();
    const s = $('splashScreen');
    if (s) { s.style.opacity = '0'; setTimeout(() => s.remove(), 300); }
});

// =================== STATE ===================
let googleUser = null;
let sessionLogin = localStorage.getItem('k_login');
let sessionPass = localStorage.getItem('k_passHash');
let currentFilter = 'all';
let syncState = 'synced';
let syncInProgress = false;
let syncQueued = false;

const defaultTariffs = {
    water: 30.38,
    hotWater: 100.00,
    electroBase: 4.32,
    electroWinter: 2.64,
    winterLimit: 2000,
    nightCoef: 0.5,
    gas: 7.96,
    heating: 1654.76,
    drainage: 19.02
};

const defaultPrefs = {
    showWater: true,
    showHotWater: false,
    showElectro: true,
    showGas: true,
    showHeating: false,
    showDrainage: false,
    electroTwoZone: true,
    electroWinter: true,
    remindersEnabled: false,
    remWaterStart: 1,
    remWaterEnd: 5,
    remElectroStart: 28,
    remElectroEnd: 3
};

const defaultCustomServices = [
    { id: "s1", name: "Квартплата", defaultSum: "" },
    { id: "s2", name: "Сміття", defaultSum: "" }
];

let addresses = [];
let currentAddressId = 'default';
let isGuest = false;
let tariffs = {};
let prefs = {};
let records = [];
let customServices = [];
let currentCalc = { waterCost: 0, hotWaterCost: 0, electroCost: 0, gasCost: 0, customCost: 0, total: 0 };

const urlParams = new URLSearchParams(window.location.search);
const urlShareToken = urlParams.get('share');

// =================== UTILITIES ===================
let toastTimeout;
function showToast(msg, icon = '✅') {
    const t = $('toast');
    if (!t) return;
    $('toastMsg').innerText = msg;
    $('toastIcon').innerText = icon;
    t.classList.remove('-translate-y-24', 'opacity-0');
    haptic(icon === '✅' ? 'success' : icon === '❌' || icon === '⚠️' ? 'error' : 'notification');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.add('-translate-y-24', 'opacity-0'), 2500);
}

function vibe(pattern = 10) {
    if (navigator.vibrate) navigator.vibrate(Array.isArray(pattern) ? pattern : [pattern]);
}

const hapticPatterns = {
    light: [5], medium: [10], heavy: [20],
    success: [10, 50, 10], error: [50, 30, 50],
    notification: [15, 100, 15], tabSwitch: [3]
};

function haptic(type) { vibe(hapticPatterns[type] || hapticPatterns.light); }

async function getHash(t) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function setSyncState(state) {
    syncState = state;
    const dot = $('syncDotHeader');
    if (dot) dot.className = `sync-dot ${state}`;
}

function saveToLocal() {
    try {
        localStorage.setItem('komynalka_backup', JSON.stringify({ addresses, currentAddressId, timestamp: Date.now() }));
    } catch (e) {}
}

function loadFromLocal() {
    try {
        const b = localStorage.getItem('komynalka_backup');
        return b ? JSON.parse(b) : null;
    } catch (e) { return null; }
}

// =================== CUSTOM MODALS (замість prompt/confirm) ===================
function showInputModal(title, placeholder = '', defaultValue = '') {
    return new Promise((resolve) => {
        const modal = $('inputModal');
        const field = $('inputModalField');
        const titleEl = $('inputModalTitle');
        titleEl.textContent = title;
        field.placeholder = placeholder;
        field.value = defaultValue;
        modal.classList.remove('hidden');
        field.focus();

        function cleanup() {
            modal.classList.add('hidden');
            $('inputModalConfirm').removeEventListener('click', onConfirm);
            $('inputModalCancel').removeEventListener('click', onCancel);
            field.removeEventListener('keydown', onKey);
        }
        function onConfirm() { cleanup(); resolve(field.value); }
        function onCancel() { cleanup(); resolve(null); }
        function onKey(e) { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }

        $('inputModalConfirm').addEventListener('click', onConfirm);
        $('inputModalCancel').addEventListener('click', onCancel);
        field.addEventListener('keydown', onKey);
    });
}

function showConfirmModal(title, text = 'Ви впевнені?') {
    return new Promise((resolve) => {
        const modal = $('confirmModal');
        $('confirmModalTitle').textContent = title;
        $('confirmModalText').textContent = text;
        modal.classList.remove('hidden');

        function cleanup() {
            modal.classList.add('hidden');
            $('confirmModalConfirm').removeEventListener('click', onConfirm);
            $('confirmModalCancel').removeEventListener('click', onCancel);
        }
        function onConfirm() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }

        $('confirmModalConfirm').addEventListener('click', onConfirm);
        $('confirmModalCancel').addEventListener('click', onCancel);
    });
}
// =================== SECURE FETCH ===================
async function secureFetch(method, params = {}, body = null) {
    let url = WORKER_URL;
    const headers = { 'Content-Type': 'application/json' };

    const uid = localStorage.getItem('k_uid');
    if (uid) {
        headers['Authorization'] = `Bearer uid:${uid}`;
    } else if (sessionLogin && sessionPass) {
        const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(sessionLogin)));
        headers['Authorization'] = `Bearer login:${encoded}:${sessionPass}`;
    }

    const urlP = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) urlP.set(k, v); });
    const qs = urlP.toString();
    if (qs) url += '?' + qs;

    const options = { method, headers, cache: 'no-store' };
    if (body && method === 'POST') options.body = JSON.stringify(body);

    return fetch(url, options);
}

// =================== SYNC (з захистом від дублів) ===================
async function syncToCloud() {
    if (syncInProgress) { syncQueued = true; return; }

    syncCurrentAddress();
    saveToLocal();

    if (isGuest && urlShareToken) {
        await fetch(`${WORKER_URL}?share=${urlShareToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses })
        });
        return;
    }

    if (!sessionLogin && !localStorage.getItem('k_uid')) return;

    syncInProgress = true;
    setSyncState('syncing');

    try {
        const res = await secureFetch('POST', {}, { addresses, currentAddressId });
        const data = await res.json();
        if (res.status === 403 || data.error === "WRONG_PASSWORD") { logout(); return; }
        if (res.status === 429) { showToast('Зачекайте хвилину', '⏳'); setSyncState('offline'); return; }
        setSyncState('synced');
    } catch (e) {
        setSyncState('offline');
        showToast('Збережено локально', '💾');
    } finally {
        syncInProgress = false;
        if (syncQueued) {
            syncQueued = false;
            syncToCloud();
        }
    }
}

window.addEventListener('online', () => { showToast('Онлайн', '🌐'); syncToCloud(); });
window.addEventListener('offline', () => { setSyncState('offline'); showToast('Офлайн', '📴'); });

// =================== THEME ===================
let currentMode = localStorage.getItem('themeMode') || 'auto';

function setThemeMode(mode) {
    currentMode = mode;
    localStorage.setItem('themeMode', mode);
    applyThemeMode();
    ['light', 'auto', 'dark'].forEach(m => {
        const b = $('mode-' + m);
        if (!b) return;
        b.classList.remove('bg-white', 'dark:bg-[#2c2c2e]', 'text-slate-900', 'dark:text-white', 'shadow-sm');
        if (m === mode) b.classList.add('bg-white', 'dark:bg-[#2c2c2e]', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    });
}

function applyThemeMode() {
    const isDark = currentMode === 'dark' || (currentMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    $('metaThemeColor')?.setAttribute("content", isDark ? "#000000" : "#f2f2f7");
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentMode === 'auto') applyThemeMode();
});
setThemeMode(currentMode);

// =================== WELCOME ===================
function showWelcome() {
    if (localStorage.getItem('welcome_done')) return;
    $('welcomeTooltip')?.classList.remove('hidden');
}
function dismissWelcome() {
    localStorage.setItem('welcome_done', '1');
    $('welcomeTooltip')?.classList.add('hidden');
}
window.dismissWelcome = dismissWelcome;

// =================== SERVICE WORKER ===================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(e => console.error('SW:', e));
    });
}
// =================== AUTH ===================
$('authForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await performLogin($('authLogin').value.trim(), $('authPass').value, false);
});

$('togglePassBtn')?.addEventListener('click', () => {
    const p = $('authPass');
    p.type = p.type === 'password' ? 'text' : 'password';
    $('passEyeIcon').className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

$('googleAuthBtn')?.addEventListener('click', async () => {
    initFirebase();
    if (!firebaseReady) { showToast('Зачекайте...', '⏳'); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await firebase.auth().signInWithPopup(provider);
        googleUser = result.user;
        await performLogin(null, null, false, googleUser.uid);
    } catch (e) {
        if (e.code !== 'auth/popup-closed-by-user') showToast("Помилка Google", "❌");
    }
});

async function performLogin(rawLogin, rawPass, isAlreadyHashed, uid = null) {
    const errEl = $('authError');
    const spinner = $('authSpinner');
    const btnText = $('authBtnText');
    if (errEl) errEl.classList.add('hidden');
    if (btnText) btnText.textContent = "Завантаження...";
    if (spinner) spinner.classList.remove('hidden');

    try {
        let passHash = null;
        if (!uid) {
            passHash = isAlreadyHashed ? rawPass : await getHash(rawPass);
        }

        const prevLogin = sessionLogin, prevPass = sessionPass;
        if (uid) { localStorage.setItem('k_uid', uid); }
        else { sessionLogin = rawLogin; sessionPass = passHash; }

        const res = await secureFetch('GET', { t: Date.now() });
        const data = await res.json();

        if (res.status === 404 && uid) {
            sessionLogin = prevLogin; sessionPass = prevPass;
            localStorage.removeItem('k_uid');
            $('linkModal')?.classList.remove('hidden');
            if (btnText) btnText.textContent = "Увійти";
            if (spinner) spinner.classList.add('hidden');
            return;
        }

        if (res.status === 403 || data.error === "WRONG_PASSWORD") throw new Error("WRONG_PASSWORD");
        if (res.status === 429) throw new Error("Забагато спроб. Зачекайте.");

        if (res.status === 404 || (!uid && !data.success)) {
            sessionLogin = rawLogin;
            sessionPass = passHash;
            addresses = [{
                id: 'default', name: 'Мій дім',
                tariffs: { ...defaultTariffs },
                prefs: { ...defaultPrefs },
                records: [],
                customServices: [...defaultCustomServices]
            }];
            currentAddressId = 'default';
            await syncToCloud();
        } else if (res.status === 200 && data.success) {
            if (data.data.addresses) {
                addresses = data.data.addresses;
                currentAddressId = data.data.currentAddressId || addresses[0].id;
            } else {
                addresses = [{
                    id: 'default', name: 'Мій дім',
                    tariffs: data.data.tariffs || { ...defaultTariffs },
                    prefs: { ...defaultPrefs, ...(data.data.prefs || {}) },
                    records: data.data.records || [],
                    customServices: data.data.customServices || [...defaultCustomServices]
                }];
                currentAddressId = 'default';
            }
            if (uid) {
                sessionLogin = data.linkedLogin || `uid_${uid}`;
                localStorage.setItem('k_uid', uid);
            } else {
                sessionLogin = rawLogin;
                sessionPass = passHash;
            }
        }

        if (!uid) {
            localStorage.setItem('k_login', sessionLogin);
            localStorage.setItem('k_passHash', sessionPass);
        }

        loadCurrentAddress();
        if (records.length === 0) showWelcome();
    } catch (err) {
        if (btnText) btnText.textContent = "Увійти";
        if (spinner) spinner.classList.add('hidden');
        if (errEl) {
            errEl.innerText = err.message === "WRONG_PASSWORD" ? "Неправильний пароль!" : "Помилка: " + err.message;
            errEl.classList.remove('hidden');
        }
    }
}

// Google link
$('linkYesBtn')?.addEventListener('click', async () => {
    const lgn = await showInputModal('Логін', 'Ваш існуючий логін');
    if (!lgn) return;
    const pss = await showInputModal('Пароль', 'Пароль від цього логіна');
    if (!pss) return;
    linkAccount(lgn, pss);
});

$('linkNoBtn')?.addEventListener('click', async () => {
    $('linkModal')?.classList.add('hidden');
    sessionLogin = `uid_${googleUser.uid}`;
    localStorage.setItem('k_uid', googleUser.uid);
    localStorage.setItem('k_login', sessionLogin);
    addresses = [{
        id: 'default', name: 'Мій дім',
        tariffs: { ...defaultTariffs },
        prefs: { ...defaultPrefs },
        records: [],
        customServices: [...defaultCustomServices]
    }];
    currentAddressId = 'default';
    await syncToCloud();
    loadCurrentAddress();
    showToast("Акаунт створено!");
});

async function linkAccount(lgn, pss) {
    const passHash = await getHash(pss);
    const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: "link_google", login: lgn, pass: passHash, uid: googleUser.uid })
    });
    const data = await res.json();
    if (data.success) {
        $('linkModal')?.classList.add('hidden');
        showToast("Підв'язано!");
        performLogin(null, null, false, googleUser.uid);
    } else showToast("Помилка", "❌");
}

$('btnLinkGoogle')?.addEventListener('click', async () => {
    if (!sessionLogin) return showToast("Спочатку увійдіть", "⚠️");
    initFirebase();
    if (!firebaseReady) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await firebase.auth().signInWithPopup(provider);
        const uid = result.user.uid;
        const res = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "link_google", login: sessionLogin, uid })
        });
        if ((await res.json()).success) {
            showToast("Google підв'язано!");
            localStorage.setItem('k_uid', uid);
            updateGoogleButton();
        }
    } catch (e) { showToast("Скасовано", "⚠️"); }
});

function updateGoogleButton() {
    if (localStorage.getItem('k_uid') && $('btnLinkGoogle')) {
        $('btnLinkGoogle').innerHTML = '<i class="fa-solid fa-check"></i>';
        $('btnLinkGoogle').className = 'w-9 h-9 bg-green-50 dark:bg-green-500/10 rounded-xl flex items-center justify-center text-green-500 text-xs pointer-events-none';
    }
}
// =================== ADDRESS ===================
function loadCurrentAddress() {
    if (!addresses || addresses.length === 0) {
        const backup = loadFromLocal();
        if (backup) { addresses = backup.addresses || []; currentAddressId = backup.currentAddressId || 'default'; }
    }
    if (!addresses.length) return;
    const addr = addresses.find(a => a.id === currentAddressId) || addresses[0];
    currentAddressId = addr.id;
    tariffs = { ...defaultTariffs, ...(addr.tariffs || {}) };
    prefs = { ...defaultPrefs, ...(addr.prefs || {}) };
    records = addr.records || [];
    customServices = addr.customServices || [...defaultCustomServices];
    if ($('currentAddressDisplay')) $('currentAddressDisplay').innerText = addr.name + (isGuest ? ' (Гість)' : '');
    initAppUI();
}

function syncCurrentAddress() {
    const idx = addresses.findIndex(a => a.id === currentAddressId);
    if (idx >= 0) {
        addresses[idx].tariffs = tariffs;
        addresses[idx].prefs = prefs;
        addresses[idx].records = records;
        addresses[idx].customServices = customServices;
    }
}

function openAddressModal() {
    $('addressModal')?.classList.remove('hidden');
    setTimeout(() => $('addressModalContent')?.classList.remove('translate-y-full'), 10);
    renderAddressModal();
}

function closeAddressModal() {
    $('addressModalContent')?.classList.add('translate-y-full');
    setTimeout(() => $('addressModal')?.classList.add('hidden'), 400);
}

$('addressHeaderTrigger')?.addEventListener('click', openAddressModal);
$('closeAddressModalBtn')?.addEventListener('click', closeAddressModal);
$('addressModal')?.addEventListener('click', (e) => { if (e.target === $('addressModal')) closeAddressModal(); });

$('addAddressBtn')?.addEventListener('click', async () => {
    if (addresses.length >= MAX_ADDRESSES_FREE) {
        showToast(`Максимум ${MAX_ADDRESSES_FREE} адреси`, '⚠️');
        closeAddressModal();
        return;
    }
    const name = await showInputModal("Нова адреса", "Назва об'єкту");
    if (name && name.trim()) {
        syncCurrentAddress();
        const newId = 'addr_' + Date.now();
        addresses.push({
            id: newId, name: name.trim(),
            tariffs: { ...defaultTariffs },
            prefs: { ...defaultPrefs },
            records: [],
            customServices: [{ id: "s1", name: "Квартплата", defaultSum: "" }]
        });
        currentAddressId = newId;
        loadCurrentAddress();
        syncToCloud();
        closeAddressModal();
        showToast("Додано");
        checkNewAchievements();
    }
});

function renderAddressModal() {
    const list = $('addressListModal');
    if (!list) return;
    list.innerHTML = addresses.map(a => `
        <div class="flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-95 cursor-pointer
            ${a.id === currentAddressId
                ? 'bg-brand border-brand text-white shadow-lg shadow-brand/20'
                : 'bg-slate-50 dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'
            }" data-addr-id="${a.id}">
            <span class="font-bold text-lg truncate pr-2 flex-1">${escapeHtml(a.name)}</span>
            <div class="flex gap-1.5 shrink-0">
                <button class="addr-edit p-2 rounded-xl shadow-sm ${a.id === currentAddressId ? 'bg-white/20 text-white' : 'bg-white dark:bg-[#2c2c2e] text-slate-400'}" data-id="${a.id}"><i class="fa-solid fa-pen"></i></button>
                ${a.id !== currentAddressId && addresses.length > 1
                    ? `<button class="addr-del p-2 text-slate-400 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-sm" data-id="${a.id}"><i class="fa-solid fa-trash"></i></button>`
                    : ''}
            </div>
        </div>`).join('');

    list.querySelectorAll('[data-addr-id]').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.addr-edit') || e.target.closest('.addr-del')) return;
            syncCurrentAddress();
            currentAddressId = el.dataset.addrId;
            loadCurrentAddress();
            syncToCloud();
            closeAddressModal();
        });
    });

    list.querySelectorAll('.addr-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const addr = addresses.find(a => a.id === btn.dataset.id);
            const name = await showInputModal("Нова назва", "Назва", addr.name);
            if (name && name.trim()) {
                addr.name = name.trim();
                renderAddressModal();
                if (btn.dataset.id === currentAddressId) $('currentAddressDisplay').innerText = addr.name;
                syncToCloud();
            }
        });
    });

    list.querySelectorAll('.addr-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await showConfirmModal('Видалити адресу?', 'Всі записи цієї адреси буде втрачено.');
            if (ok) {
                addresses = addresses.filter(a => a.id !== btn.dataset.id);
                if (currentAddressId === btn.dataset.id) {
                    currentAddressId = addresses[0].id;
                    loadCurrentAddress();
                }
                syncToCloud();
                renderAddressModal();
            }
        });
    });
}

// =================== TABS (фікс білого екрану) ===================
const tabIds = ['tabDashboard', 'tabCalc', 'tabHistory', 'tabSettings'];
const btnIds = ['btnTabDashboard', 'btnTabCalc', 'btnTabHistory', 'btnTabSettings'];

function switchTab(tabId, index) {
    const activeTab = document.querySelector('.tab-active');
    const targetTab = $(tabId);
    if (!targetTab || activeTab === targetTab) return;

    // Миттєве перемикання без gap
    if (activeTab) {
        activeTab.classList.remove('tab-active');
        activeTab.classList.add('tab-hidden');
    }
    targetTab.classList.remove('tab-hidden');
    targetTab.classList.add('tab-active');

    // Оновлюємо контент
    requestAnimationFrame(() => {
        if (tabId === 'tabDashboard') renderDashboard();
        if (tabId === 'tabCalc') { fillPreviousReadings(); calculatePreview(); updateSmartBadges(); }
        if (tabId === 'tabHistory') renderRecords();
        if (tabId === 'tabSettings') renderSettingsCustomServices();
    });

    // Навігація
    btnIds.forEach((id, i) => {
        const btn = $(id);
        if (!btn) return;
        btn.classList.toggle('text-brand', i === index);
        btn.classList.toggle('text-slate-400', i !== index);
        btn.classList.toggle('dark:text-slate-500', i !== index);
    });

    $('swipeContainer')?.scrollTo({ top: 0, behavior: 'instant' });
    haptic('tabSwitch');
}

$('btnTabDashboard')?.addEventListener('click', () => switchTab('tabDashboard', 0));
$('btnTabCalc')?.addEventListener('click', () => switchTab('tabCalc', 1));
$('btnTabHistory')?.addEventListener('click', () => switchTab('tabHistory', 2));
$('btnTabSettings')?.addEventListener('click', () => switchTab('tabSettings', 3));
$('dashAddBtn')?.addEventListener('click', () => switchTab('tabCalc', 1));
$('dashHistoryBtn')?.addEventListener('click', () => switchTab('tabHistory', 2));

// Swipe
let touchStartX = 0;
$('swipeContainer')?.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
$('swipeContainer')?.addEventListener('touchend', e => {
    if (isGuest) return;
    const dist = touchStartX - e.changedTouches[0].screenX;
    const curIdx = tabIds.findIndex(id => $(id)?.classList.contains('tab-active'));
    if (dist > 70 && curIdx < tabIds.length - 1) switchTab(tabIds[curIdx + 1], curIdx + 1);
    else if (dist < -70 && curIdx > 0) switchTab(tabIds[curIdx - 1], curIdx - 1);
}, { passive: true });

// Quick actions
$('quickActionsBtn')?.addEventListener('click', () => $('quickActionsModal')?.classList.remove('hidden'));
$('qaExport')?.addEventListener('click', () => { exportCSV(); $('quickActionsModal')?.classList.add('hidden'); });
$('qaPdf')?.addEventListener('click', () => { generatePDF(); $('quickActionsModal')?.classList.add('hidden'); });
$('qaShare')?.addEventListener('click', () => { shareAllRecords(); $('quickActionsModal')?.classList.add('hidden'); });
$('qaSync')?.addEventListener('click', () => { syncToCloud(); showToast('Синхронізовано'); $('quickActionsModal')?.classList.add('hidden'); });
$('qaImage')?.addEventListener('click', () => { if (typeof shareAsImage === 'function') shareAsImage(); $('quickActionsModal')?.classList.add('hidden'); });
// =================== CANVAS CHART ENGINE ===================
class ChartEngine {
    constructor(canvasId, options = {}) {
        this.canvas = $(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.options = { padding: 40, barRadius: 8, animDuration: 600, unit: null, colors: { grid: 'rgba(0,0,0,0.05)', text: '#8e8e93' }, ...options };
        this.data = [];
        this.animProgress = 0;
        this.tooltip = null;
        this.width = 0;
        this.height = 0;
        this.interactionBound = false;
        this.setupCanvas();
        this.setupInteraction();
    }

    setupCanvas() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
    }

    setupInteraction() {
        if (!this.canvas || this.interactionBound) return;
        this.interactionBound = true;
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e), { passive: true });
        this.canvas.addEventListener('mousemove', (e) => this.handleHover(e));
        this.canvas.addEventListener('mouseleave', () => { this.tooltip = null; this.render(); });
    }

    handleTouch(e) { const rect = this.canvas.getBoundingClientRect(); this.findBar(e.touches[0].clientX - rect.left); haptic('light'); }
    handleHover(e) { const rect = this.canvas.getBoundingClientRect(); this.findBar(e.clientX - rect.left); }

    findBar(x) {
        if (!this.data.length) return;
        const { padding } = this.options;
        const chartWidth = this.width - padding * 2;
        const barWidth = chartWidth / this.data.length;
        const index = Math.floor((x - padding) / barWidth);
        this.tooltip = (index >= 0 && index < this.data.length) ? { index, x: padding + index * barWidth + barWidth / 2 } : null;
        this.render();
    }

    setData(data) {
        this.data = data;
        if (!this.width || !this.height) { this.setupCanvas(); if (!this.width || !this.height) return; }
        this.animate();
    }

    animate() {
        this.animProgress = 0;
        const start = performance.now();
        const tick = (now) => {
            this.animProgress = Math.min((now - start) / this.options.animDuration, 1);
            this.animProgress = 1 - Math.pow(1 - this.animProgress, 3);
            this.render();
            if (this.animProgress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    render() {
        if (!this.ctx || !this.width) return;
        const { ctx, width, height, data, options } = this;
        const { padding, barRadius, colors } = options;
        ctx.clearRect(0, 0, width, height);
        if (!data.length) { ctx.fillStyle = colors.text; ctx.font = '12px -apple-system'; ctx.textAlign = 'center'; ctx.fillText('Немає даних', width / 2, height / 2); return; }

        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 1.8;
        const max = Math.max(...data.map(d => d.value), 1);
        const barWidth = chartWidth / data.length;
        const barPad = barWidth * 0.25;

        ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 3; i++) { const y = padding / 2 + (chartHeight / 3) * i; ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke(); }

        data.forEach((d, i) => {
            const barH = Math.max(2, (d.value / max) * chartHeight * this.animProgress);
            const x = padding + i * barWidth + barPad;
            const y = padding / 2 + chartHeight - barH;
            const w = barWidth - barPad * 2;
            const r = Math.min(barRadius, w / 2, barH / 2);

            ctx.shadowColor = d.color + '40'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
            ctx.beginPath(); ctx.moveTo(x, y + barH); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + barH); ctx.closePath();
            const grad = ctx.createLinearGradient(x, y, x, y + barH); grad.addColorStop(0, d.color); grad.addColorStop(1, d.color + '80'); ctx.fillStyle = grad; ctx.fill();
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

            if (this.tooltip && this.tooltip.index === i) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill(); }

            ctx.fillStyle = colors.text; ctx.font = 'bold 9px -apple-system'; ctx.textAlign = 'center'; ctx.fillText(d.label, x + w / 2, height - 6);
        });

        if (this.tooltip && this.tooltip.index < data.length) {
            const d = data[this.tooltip.index];
            const tooltipText = this.options.unit ? `${d.value} ${this.options.unit}` : `${fmt.format(d.value)} ₴`;
            ctx.font = 'bold 11px -apple-system';
            const tw = ctx.measureText(tooltipText).width + 16;
            const tx = Math.min(Math.max(this.tooltip.x - tw / 2, 4), width - tw - 4);
            ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(tx, 4, tw, 22, 6); else ctx.rect(tx, 4, tw, 22);
            ctx.fill();
            ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.fillText(tooltipText, tx + tw / 2, 19);
        }
    }
}

class DonutChart {
    constructor(canvasId) {
        this.canvas = $(canvasId); if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.data = []; this.animProgress = 0; this.width = 0; this.height = 0;
        this.setupCanvas();
    }

    setupCanvas() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.canvas.width = rect.width * dpr; this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width; this.height = rect.height;
    }

    setData(data) {
        this.data = data.filter(d => d.value > 0);
        if (!this.width || !this.height) { this.setupCanvas(); if (!this.width || !this.height) return; }
        this.animate();
    }

    animate() {
        this.animProgress = 0;
        const start = performance.now();
        const tick = (now) => {
            this.animProgress = Math.min((now - start) / 800, 1);
            this.animProgress = 1 - Math.pow(1 - this.animProgress, 3);
            this.render();
            if (this.animProgress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    render() {
        if (!this.ctx || !this.width) return;
        const { ctx, width, height, data } = this;
        ctx.clearRect(0, 0, width, height);
        if (!data.length) return;
        const cx = width / 2, cy = height / 2;
        const radius = Math.min(width, height) / 2 - 8;
        const innerRadius = radius * 0.6;
        const total = data.reduce((s, d) => s + d.value, 0);
        let startAngle = -Math.PI / 2;
        data.forEach(d => {
            const sliceAngle = (d.value / total) * Math.PI * 2 * this.animProgress;
            const endAngle = startAngle + sliceAngle;
            ctx.beginPath(); ctx.arc(cx, cy, radius, startAngle, endAngle); ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true); ctx.closePath();
            ctx.fillStyle = d.color; ctx.shadowColor = d.color + '30'; ctx.shadowBlur = 4; ctx.fill();
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
            startAngle = endAngle;
        });
        const totalText = fmt.format(total);
        const fontSize = totalText.length > 9 ? 10 : totalText.length > 7 ? 12 : 14;
        ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#fff' : '#1c1c1e';
        ctx.font = `bold ${fontSize}px -apple-system`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(totalText, cx, cy - 4);
        ctx.fillStyle = '#8e8e93'; ctx.font = '9px -apple-system'; ctx.fillText('₴', cx, cy + 10);
    }
}

let dashChart, historyChart, serviceChart, donutChart;
// =================== DASHBOARD ===================
function renderDashboard() {
    const hour = new Date().getHours();
    let greeting = 'Доброго дня!';
    if (hour < 6) greeting = 'Доброї ночі!';
    else if (hour < 12) greeting = 'Доброго ранку!';
    else if (hour >= 18) greeting = 'Доброго вечора!';
    if ($('dashGreeting')) $('dashGreeting').textContent = greeting;

    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if ($('dashMonthLabel')) $('dashMonthLabel').textContent = new Date(curMonth + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' });

    const streak = getStreak(records);
    if ($('streakValue')) $('streakValue').textContent = streak;
    renderStreakDots(streak);

    const curRec = records.find(r => r.month === curMonth);
    animateNumber($('dashCurrentMonth'), curRec ? curRec.total : 0);
    if ($('dashRecordsCount')) $('dashRecordsCount').textContent = records.length;

    if (records.length > 0) {
        const avg = records.reduce((s, r) => s + r.total, 0) / records.length;
        if ($('dashAvg')) $('dashAvg').textContent = fmt.format(avg) + ' ₴';
    } else {
        if ($('dashAvg')) $('dashAvg').textContent = '0 ₴';
    }

    // Борг
    const unpaid = records.filter(r => !r.paid);
    const debtTotal = unpaid.reduce((s, r) => s + r.total, 0);
    if (unpaid.length > 0) {
        $('dashDebtCard')?.classList.remove('hidden');
        animateNumber($('dashDebt'), debtTotal);
        if ($('dashDebtMonths')) $('dashDebtMonths').textContent = `${unpaid.length} міс. не оплачено`;
        $('debtBadge')?.classList.remove('hidden');
        if ($('debtBadge')) $('debtBadge').textContent = unpaid.length;
    } else {
        $('dashDebtCard')?.classList.add('hidden');
        $('debtBadge')?.classList.add('hidden');
    }

    // Progressive disclosure — показуємо секції по мірі даних
    const hasRecords = records.length > 0;
    const hasMultiple = records.length >= 3;

    // Empty state
    if ($('dashEmptyState')) $('dashEmptyState').classList.toggle('hidden', hasRecords);

    // Stats
    if ($('dashStatsDetails')) $('dashStatsDetails').classList.toggle('hidden', !hasRecords);

    // Donut
    if ($('dashDonutDetails')) $('dashDonutDetails').classList.toggle('hidden', !curRec);

    // Achievements
    if ($('dashAchievementsDetails')) $('dashAchievementsDetails').classList.toggle('hidden', !hasRecords);

    // Year report
    if ($('yearReportBtn')) $('yearReportBtn').classList.toggle('hidden', !hasMultiple);

    // Рендеримо контент
    renderDashCanvasChart();
    renderBudgetProgress(curRec);
    renderDonutChart(curRec);
    renderSmartInsight(curRec, curMonth);
    renderAchievements();
    renderTips();

    const unlocked = getUnlockedAchievements().length;
    if ($('achCounter')) $('achCounter').textContent = `${unlocked}/${ACHIEVEMENTS.length}`;
    checkReminders();
}

function renderBudgetProgress(curRec) {
    const budgetEl = $('budgetProgressCard'); if (!budgetEl) return;
    const budget = parseFloat(localStorage.getItem('k_budget')) || 0;
    if (!budget) { budgetEl.classList.add('hidden'); return; }
    budgetEl.classList.remove('hidden');
    const spent = curRec ? curRec.total : 0;
    const percent = Math.min((spent / budget) * 100, 100);
    const remaining = Math.max(budget - spent, 0);
    const isOver = spent > budget;
    if ($('budgetSpent')) $('budgetSpent').textContent = fmt.format(spent);
    if ($('budgetLimit')) $('budgetLimit').textContent = fmt.format(budget);
    if ($('budgetRemaining')) {
        $('budgetRemaining').textContent = isOver ? `Перевищено на ${fmt.format(spent - budget)} ₴` : `Залишок: ${fmt.format(remaining)} ₴`;
        $('budgetRemaining').className = `text-[10px] font-bold ${isOver ? 'text-red-500' : 'text-green-600'}`;
    }
    const bar = $('budgetBar');
    if (bar) {
        bar.style.width = `${percent}%`;
        bar.className = `h-full rounded-full transition-all duration-700 ${isOver ? 'bg-gradient-to-r from-red-400 to-red-600' : percent > 80 ? 'bg-gradient-to-r from-orange-400 to-orange-500' : 'bg-gradient-to-r from-brand to-blue-500'}`;
    }
    if ($('budgetPercent')) $('budgetPercent').textContent = `${Math.round(percent)}%`;
}

function renderDonutChart(curRec) {
    if (!$('donutCanvas')) return;
    if (!donutChart) donutChart = new DonutChart('donutCanvas');
    if (!curRec || curRec.total === 0) {
        if (donutChart.ctx && donutChart.width) donutChart.ctx.clearRect(0, 0, donutChart.width, donutChart.height);
        const legend = $('donutLegend');
        if (legend) legend.innerHTML = '<span class="text-[9px] text-slate-400">Немає даних</span>';
        return;
    }
    const data = [];
    if (curRec.waterCost > 0) data.push({ value: curRec.waterCost, color: '#3b82f6', label: 'Вода' });
    if (curRec.hotWaterCost > 0) data.push({ value: curRec.hotWaterCost, color: '#ef4444', label: 'Гар.' });
    if (curRec.electroCost > 0) data.push({ value: curRec.electroCost, color: '#eab308', label: 'Світло' });
    if (curRec.gasCost > 0) data.push({ value: curRec.gasCost, color: '#f97316', label: 'Газ' });
    if (curRec.customCost > 0) data.push({ value: curRec.customCost, color: '#a855f7', label: 'Інше' });
    donutChart.setData(data);
    const legend = $('donutLegend');
    if (legend) legend.innerHTML = data.map(d => `<div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:${d.color}"></div><span class="text-[9px] font-bold text-slate-500">${d.label}</span></div>`).join('');
}

function renderDashCanvasChart() {
    if (!$('dashChartCanvas')) return;
    if (!dashChart) dashChart = new ChartEngine('dashChartCanvas', { padding: 24, barRadius: 6 });
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 8).reverse();
    const data = sorted.map(r => ({
        value: r.total,
        label: new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3),
        color: r.paid ? '#007aff' : '#ff9500'
    }));
    dashChart.setData(data);
}

function renderSmartInsight(curRec, curMonth) {
    const insightEl = $('dashInsight'); const textEl = $('dashInsightText');
    if (!insightEl || !textEl) return;
    if (records.length < 2) { insightEl.classList.add('hidden'); return; }
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month));
    const [sy, sm] = curMonth.split('-').map(Number);
    const prevDate = new Date(sy, sm - 2);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevRec = sorted.find(r => r.month === prevMonth);
    let insight = '';
    if (curRec && prevRec && prevRec.total > 0) {
        const diff = Math.round(((curRec.total - prevRec.total) / prevRec.total) * 100);
        if (diff < -10) insight = `Зекономили ${Math.abs(diff)}% порівняно з ${new Date(prevMonth + '-01').toLocaleString('uk-UA', { month: 'long' })} 🎉`;
        else if (diff > 15) insight = `Витрати +${diff}% порівняно з минулим місяцем`;
        else if (diff >= -10 && diff <= 5) insight = `Витрати стабільні — чудово! 👍`;
    }
    if (!insight && records.length >= 3) {
        const avg = sorted.slice(0, 3).reduce((s, r) => s + r.total, 0) / 3;
        insight = `Середні за 3 міс: ${fmt.format(avg)} ₴`;
    }
    if (!insight) {
        const str = getStreak(records);
        if (str >= 3) insight = `Серія ${str} міс — так тримати! 🔥`;
    }
    if (insight) { insightEl.classList.remove('hidden'); textEl.textContent = insight; }
    else { insightEl.classList.add('hidden'); }
}

function renderStreakDots(streak) {
    const container = $('streakDots'); if (!container) return;
    let html = '';
    for (let i = 0; i < 6; i++) html += `<div class="streak-dot ${i < streak ? 'active' : 'inactive'} ${i === 0 ? 'today' : ''}"></div>`;
    container.innerHTML = html;
}

function animateNumber(el, target) {
    if (!el) return;
    const current = parseFloat(el.textContent.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    if (Math.abs(current - target) < 0.01) { el.textContent = fmt.format(target) + ' ₴'; return; }
    const duration = 400; const start = performance.now(); const from = current;
    function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = fmt.format(from + (target - from) * eased) + ' ₴';
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}
// =================== CALCULATION ===================
const readingInputIds = ['wPrev', 'wCur', 'hwPrev', 'hwCur', 'dPrev', 'dCur', 'nPrev', 'nCur', 'gPrev', 'gCur'];
function getV(id) { return Math.max(0, parseFloat($(id)?.value) || 0); }

function calculatePreview() {
    if (prefs.showWater) currentCalc.waterCost = Math.max(0, getV('wCur') - getV('wPrev')) * tariffs.water;
    else currentCalc.waterCost = 0;

    if (prefs.showHotWater) currentCalc.hotWaterCost = Math.max(0, getV('hwCur') - getV('hwPrev')) * tariffs.hotWater;
    else currentCalc.hotWaterCost = 0;

    if (prefs.showElectro) {
        const dV = Math.max(0, getV('dCur') - getV('dPrev'));
        const nV = prefs.electroTwoZone ? Math.max(0, getV('nCur') - getV('nPrev')) : 0;
        const tEl = dV + nV;
        if (tEl === 0) currentCalc.electroCost = 0;
        else if (prefs.electroWinter && $('isWinterInput')?.checked) {
            if (tEl <= tariffs.winterLimit) {
                currentCalc.electroCost = dV * tariffs.electroWinter + nV * tariffs.electroWinter * tariffs.nightCoef;
            } else {
                const dp = dV / tEl, np = nV / tEl;
                currentCalc.electroCost =
                    tariffs.winterLimit * dp * tariffs.electroWinter +
                    tariffs.winterLimit * np * tariffs.electroWinter * tariffs.nightCoef +
                    (tEl - tariffs.winterLimit) * dp * tariffs.electroBase +
                    (tEl - tariffs.winterLimit) * np * tariffs.electroBase * tariffs.nightCoef;
            }
        } else {
            currentCalc.electroCost = dV * tariffs.electroBase + nV * tariffs.electroBase * tariffs.nightCoef;
        }
    } else currentCalc.electroCost = 0;

    if (prefs.showGas) currentCalc.gasCost = Math.max(0, getV('gCur') - getV('gPrev')) * tariffs.gas;
    else currentCalc.gasCost = 0;

    currentCalc.customCost = 0;
    customServices.forEach(srv => {
        let val = parseFloat($(`custom_${srv.id}`)?.value);
        if (isNaN(val) && srv.defaultSum) val = parseFloat(srv.defaultSum);
        if (!isNaN(val)) currentCalc.customCost += val;
    });

    currentCalc.total = currentCalc.waterCost + currentCalc.hotWaterCost + currentCalc.electroCost + currentCalc.gasCost + currentCalc.customCost;

    if (!validateReadingsUI()) return;

    if ($('heroTotal')) $('heroTotal').innerHTML = `${fmt.format(currentCalc.total)} <span class="text-2xl font-bold text-white/40">₴</span>`;
    if ($('waterCostDisplay')) $('waterCostDisplay').innerText = fmt.format(currentCalc.waterCost) + ' ₴';
    if ($('hotWaterCostDisplay')) $('hotWaterCostDisplay').innerText = fmt.format(currentCalc.hotWaterCost) + ' ₴';
    if ($('electroCostDisplay')) $('electroCostDisplay').innerText = fmt.format(currentCalc.electroCost) + ' ₴';
    if ($('gasCostDisplay')) $('gasCostDisplay').innerText = fmt.format(currentCalc.gasCost) + ' ₴';
    if ($('customCostDisplay')) $('customCostDisplay').innerText = fmt.format(currentCalc.customCost) + ' ₴';

    updateMonthComparison();
    updateSmartForecast();
    updatePartialIndicator();
}

function validateReadingsUI() {
    const pairs = [['wPrev', 'wCur'], ['hwPrev', 'hwCur'], ['dPrev', 'dCur'], ['nPrev', 'nCur'], ['gPrev', 'gCur']];
    let hasInvalid = false;
    pairs.forEach(([prevId, curId]) => {
        const prevEl = $(prevId), curEl = $(curId);
        if (!prevEl || !curEl || prevEl.offsetParent === null) return;
        const prevVal = parseFloat(prevEl.value || '0');
        const curVal = parseFloat(curEl.value || '0');
        const invalid = curEl.value !== '' && prevEl.value !== '' && curVal < prevVal;
        prevEl.classList.toggle('input-invalid', invalid);
        curEl.classList.toggle('input-invalid', invalid);
        if (invalid) hasInvalid = true;
    });
    const btn = $('submitFormBtn');
    if (btn) { btn.disabled = hasInvalid; btn.classList.toggle('opacity-60', hasInvalid); }
    if (hasInvalid && $('heroTotal')) $('heroTotal').innerHTML = `<span class="text-lg text-red-300">Перевірте показники</span>`;
    return !hasInvalid;
}

function updatePartialIndicator() {
    const w = $('partialWater'), e = $('partialElectro'), g = $('partialGas');
    if (w) w.className = `partial-dot ${(getV('wCur') > 0 || getV('hwCur') > 0) ? 'filled' : 'empty'}`;
    if (e) e.className = `partial-dot ${getV('dCur') > 0 ? 'filled' : 'empty'}`;
    if (g) g.className = `partial-dot ${getV('gCur') > 0 ? 'filled' : 'empty'}`;
}

function updateSmartBadges() {
    const update = (prevId, curId, badgeId, unit, color, activeBg) => {
        const badge = $(badgeId); if (!badge) return;
        const d = getV(curId) - getV(prevId);
        badge.innerText = d > 0 ? `+${d} ${unit}` : `0 ${unit}`;
        badge.className = d > 0
            ? `absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 z-10 ${activeBg} ${color} shadow-md px-2.5 py-1.5 rounded-xl text-[11px] font-bold`
            : 'absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 z-10 bg-white dark:bg-apple-dark shadow-md border border-slate-100 dark:border-white/10 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-slate-400';
    };
    if (prefs.showWater) update('wPrev', 'wCur', 'wDiffBadge', 'м³', 'text-blue-600', 'bg-blue-100 dark:bg-blue-500/20');
    if (prefs.showHotWater) update('hwPrev', 'hwCur', 'hwDiffBadge', 'м³', 'text-red-600', 'bg-red-100 dark:bg-red-500/20');
    if (prefs.showElectro) {
        update('dPrev', 'dCur', 'dDiffBadge', 'кВт', 'text-yellow-600', 'bg-yellow-100 dark:bg-yellow-500/20');
        if (prefs.electroTwoZone) update('nPrev', 'nCur', 'nDiffBadge', 'кВт', 'text-indigo-500', 'bg-indigo-100 dark:bg-indigo-500/20');
    }
    if (prefs.showGas) update('gPrev', 'gCur', 'gDiffBadge', 'м³', 'text-orange-500', 'bg-orange-100 dark:bg-orange-500/20');
}

function updateMonthComparison() {
    const comp = $('monthComparison'); if (!comp) return;
    if (records.length === 0 || currentCalc.total === 0) { comp.classList.add('hidden'); return; }
    const selectedMonth = $('monthInput')?.value;
    if (!selectedMonth) { comp.classList.add('hidden'); return; }
    const [sy, sm] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(sy, sm - 2);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevRec = records.find(r => r.month === prevMonth);
    if (!prevRec || prevRec.total === 0) { comp.classList.add('hidden'); return; }
    const diff = ((currentCalc.total - prevRec.total) / prevRec.total) * 100;
    comp.classList.remove('hidden');
    if ($('comparisonIcon')) $('comparisonIcon').className = diff < 0 ? 'fa-solid fa-arrow-trend-down' : 'fa-solid fa-arrow-trend-up';
    if ($('comparisonText')) $('comparisonText').textContent = `${diff > 0 ? '+' : ''}${Math.round(diff)}% vs ${new Date(prevMonth + '-01').toLocaleString('uk-UA', { month: 'short' })}`;
    comp.style.color = diff < 0 ? '#34c759' : diff > 5 ? '#ff3b30' : '#8e8e93';
}

function updateSmartForecast() {
    const el = $('smartForecast'); if (!el) return;
    if (!records || records.length === 0) { el.innerText = "—"; return; }
    const selectedMonth = $('monthInput')?.value;
    if (!selectedMonth) { el.innerText = "—"; return; }
    const [, sm] = selectedMonth.split('-').map(Number);
    const sameMonth = records.filter(r => { const [, rm] = r.month.split('-').map(Number); return rm === sm; });
    if (sameMonth.length > 0) {
        const avg = sameMonth.reduce((s, r) => s + r.total, 0) / sameMonth.length;
        el.innerText = `~ ${fmt.format(avg)} ₴`;
        return;
    }
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month));
    const avg = sorted.slice(0, 3).reduce((s, r) => s + r.total, 0) / Math.min(3, sorted.length);
    el.innerText = `~ ${fmt.format(avg)} ₴`;
}

// Input listeners з debounce
let calcDebounce;
readingInputIds.forEach(id => {
    $(id)?.addEventListener('input', () => {
        clearTimeout(calcDebounce);
        calcDebounce = setTimeout(() => {
            calculatePreview();
            updateSmartBadges();
            debouncedDraft();
        }, 50);
    });
});
$('isWinterInput')?.addEventListener('change', calculatePreview);
$('monthInput')?.addEventListener('change', () => { fillPreviousReadings(); calculatePreview(); updateSmartBadges(); });
if ($('monthInput')) $('monthInput').value = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

// =================== DRAFT ===================
const DRAFT_KEY = 'komunalka_draft';
function saveDraft() {
    const draft = { month: $('monthInput')?.value };
    readingInputIds.forEach(id => { const el = $(id); if (el && el.value) draft[id] = el.value; });
    customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && el.value) draft[`custom_${srv.id}`] = el.value; });
    if ($('recordNote')?.value) draft.note = $('recordNote').value;
    if ($('isWinterInput')) draft.isWinter = $('isWinterInput').checked;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function loadDraft() {
    const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return;
    try {
        const draft = JSON.parse(raw);
        if (draft.month && draft.month === $('monthInput')?.value) {
            readingInputIds.forEach(id => { const el = $(id); if (el && draft[id]) el.value = draft[id]; });
            customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && draft[`custom_${srv.id}`]) el.value = draft[`custom_${srv.id}`]; });
            if ($('recordNote') && draft.note) $('recordNote').value = draft.note;
            if ($('isWinterInput') && draft.isWinter !== undefined) $('isWinterInput').checked = draft.isWinter;
        }
    } catch (e) {}
}

function clearDraft() { localStorage.removeItem(DRAFT_KEY); }
let draftTimeout;
function debouncedDraft() { clearTimeout(draftTimeout); draftTimeout = setTimeout(saveDraft, 1000); }
document.addEventListener('input', (e) => { if (e.target.classList.contains('custom-srv-input') || e.target.id === 'recordNote') debouncedDraft(); });

// =================== FORM SUBMIT ===================
$('utilityForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateReadingsUI()) { showToast('Перевірте показники', '⚠️'); return; }

    const hasWater = prefs.showWater && (getV('wCur') > 0 || getV('wPrev') > 0);
    const hasHotWater = prefs.showHotWater && (getV('hwCur') > 0 || getV('hwPrev') > 0);
    const hasElectro = prefs.showElectro && (getV('dCur') > 0 || getV('dPrev') > 0 || getV('nCur') > 0);
    const hasGas = prefs.showGas && (getV('gCur') > 0 || getV('gPrev') > 0);
    const hasCustom = customServices.some(srv => { const v = parseFloat($(`custom_${srv.id}`)?.value); return !isNaN(v) && v > 0; });

    if (!hasWater && !hasHotWater && !hasElectro && !hasGas && !hasCustom) {
        showToast('Заповніть хоча б одну послугу', '⚠️');
        return;
    }

    let cData = {};
    customServices.forEach(srv => {
        let v = parseFloat($(`custom_${srv.id}`)?.value);
        if (isNaN(v) && srv.defaultSum) v = parseFloat(srv.defaultSum);
        if (!isNaN(v) && v > 0) cData[srv.id] = { name: srv.name, val: v };
    });

    const month = $('monthInput').value;
    const existingIdx = records.findIndex(r => r.month === month);

    const newData = {
        id: Date.now(), month,
        wPrev: hasWater ? getV('wPrev') : 0, wCur: hasWater ? getV('wCur') : 0,
        hwPrev: hasHotWater ? getV('hwPrev') : 0, hwCur: hasHotWater ? getV('hwCur') : 0,
        dPrev: hasElectro ? getV('dPrev') : 0, dCur: hasElectro ? getV('dCur') : 0,
        nPrev: (hasElectro && prefs.electroTwoZone) ? getV('nPrev') : 0,
        nCur: (hasElectro && prefs.electroTwoZone) ? getV('nCur') : 0,
        gPrev: hasGas ? getV('gPrev') : 0, gCur: hasGas ? getV('gCur') : 0,
        customData: cData, note: $('recordNote')?.value?.trim() || '',
        waterCost: hasWater ? currentCalc.waterCost : 0,
        hotWaterCost: hasHotWater ? currentCalc.hotWaterCost : 0,
        electroCost: hasElectro ? currentCalc.electroCost : 0,
        gasCost: hasGas ? currentCalc.gasCost : 0,
        customCost: currentCalc.customCost,
        total: currentCalc.total, paid: false,
        _filled: { water: hasWater, hotWater: hasHotWater, electro: hasElectro, gas: hasGas, custom: hasCustom }
    };

    if (existingIdx >= 0) {
        const existing = records[existingIdx];
        const merged = { ...existing, ...newData, id: existing.id, paid: existing.paid };
        if (!hasWater && existing._filled?.water) { merged.wPrev = existing.wPrev; merged.wCur = existing.wCur; merged.waterCost = existing.waterCost; merged._filled.water = true; }
        if (!hasHotWater && existing._filled?.hotWater) { merged.hwPrev = existing.hwPrev; merged.hwCur = existing.hwCur; merged.hotWaterCost = existing.hotWaterCost; merged._filled.hotWater = true; }
        if (!hasElectro && existing._filled?.electro) { merged.dPrev = existing.dPrev; merged.dCur = existing.dCur; merged.nPrev = existing.nPrev; merged.nCur = existing.nCur; merged.electroCost = existing.electroCost; merged._filled.electro = true; }
        if (!hasGas && existing._filled?.gas) { merged.gPrev = existing.gPrev; merged.gCur = existing.gCur; merged.gasCost = existing.gasCost; merged._filled.gas = true; }
        if (!hasCustom && existing._filled?.custom) { merged.customData = { ...existing.customData, ...cData }; merged.customCost = existing.customCost; merged._filled.custom = true; }
        else if (hasCustom) { merged.customData = { ...(existing.customData || {}), ...cData }; }
        merged.total = (merged.waterCost || 0) + (merged.hotWaterCost || 0) + (merged.electroCost || 0) + (merged.gasCost || 0) + (merged.customCost || 0);
        merged.note = newData.note || existing.note;
        records[existingIdx] = merged;
        showToast("Оновлено! 🔄");
    } else {
        records.push(newData);
        showToast("Збережено! ✨");
    }

    clearDraft();
    $('submitFormBtn')?.classList.add('save-btn-success');
    setTimeout(() => $('submitFormBtn')?.classList.remove('save-btn-success'), 600);
    syncToCloud();

    // Перемикаємо на наступний місяць
    const [y, m] = $('monthInput').value.split('-');
    const nD = new Date(y, m);
    $('monthInput').value = `${nD.getFullYear()}-${String(nD.getMonth() + 1).padStart(2, '0')}`;
    fillPreviousReadings(); calculatePreview(); updateSmartBadges(); checkNewAchievements();
    switchTab('tabDashboard', 0);
});

$('btnClearFields')?.addEventListener('click', () => {
    readingInputIds.forEach(id => { const el = $(id); if (el) { el.value = ''; el.classList.remove('input-invalid'); } });
    document.querySelectorAll('.custom-srv-input').forEach(el => el.value = '');
    if ($('recordNote')) $('recordNote').value = '';
    calculatePreview(); updateSmartBadges(); clearDraft();
    showToast('Очищено', '🧼');
});

// =================== FILL PREVIOUS READINGS ===================
function fillPreviousReadings() {
    try {
        readingInputIds.forEach(id => { if ($(id)) $(id).value = ''; });
        document.querySelectorAll('.custom-srv-input').forEach(el => el.value = '');
        if ($('recordNote')) $('recordNote').value = '';

        const selectedMonth = $('monthInput')?.value;
        if (!selectedMonth || records.length === 0) { loadDraft(); return; }

        const [sy, sm] = selectedMonth.split('-').map(Number);
        const prevDate = new Date(sy, sm - 2);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const prevRecord = records.find(r => r.month === prevMonth);

        if (prevRecord) {
            if (prefs.showWater && prevRecord.wCur != null && $('wPrev')) $('wPrev').value = prevRecord.wCur;
            if (prefs.showHotWater && prevRecord.hwCur != null && $('hwPrev')) $('hwPrev').value = prevRecord.hwCur;
            if (prefs.showElectro) {
                if (prevRecord.dCur != null && $('dPrev')) $('dPrev').value = prevRecord.dCur;
                if (prefs.electroTwoZone && prevRecord.nCur != null && $('nPrev')) $('nPrev').value = prevRecord.nCur;
            }
            if (prefs.showGas && prevRecord.gCur != null && $('gPrev')) $('gPrev').value = prevRecord.gCur;
        }

        const currentRecord = records.find(r => r.month === selectedMonth);
        if (currentRecord) {
            if (prefs.showWater) { if ($('wPrev')) $('wPrev').value = currentRecord.wPrev || ''; if ($('wCur')) $('wCur').value = currentRecord.wCur || ''; }
            if (prefs.showHotWater) { if ($('hwPrev')) $('hwPrev').value = currentRecord.hwPrev || ''; if ($('hwCur')) $('hwCur').value = currentRecord.hwCur || ''; }
            if (prefs.showElectro) { if ($('dPrev')) $('dPrev').value = currentRecord.dPrev || ''; if ($('dCur')) $('dCur').value = currentRecord.dCur || ''; if (prefs.electroTwoZone) { if ($('nPrev')) $('nPrev').value = currentRecord.nPrev || ''; if ($('nCur')) $('nCur').value = currentRecord.nCur || ''; } }
            if (prefs.showGas) { if ($('gPrev')) $('gPrev').value = currentRecord.gPrev || ''; if ($('gCur')) $('gCur').value = currentRecord.gCur || ''; }
            if (currentRecord.customData) Object.keys(currentRecord.customData).forEach(srvId => { const el = $(`custom_${srvId}`); if (el) el.value = currentRecord.customData[srvId].val; });
            if ($('recordNote')) $('recordNote').value = currentRecord.note || '';
        } else {
            customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && srv.defaultSum) el.value = srv.defaultSum; });
            loadDraft();
        }

        const mo = new Date(selectedMonth + '-01').getMonth() + 1;
        if ($('isWinterInput')) $('isWinterInput').checked = mo >= 10 || mo <= 4;
    } catch (e) { console.error('fillPreviousReadings:', e); }
}

// =================== SETTINGS ===================
function updateServiceChartOptions() {
    const select = $('serviceChartSelect'); if (!select) return;
    const cur = select.value;
    select.innerHTML = '';
    if (prefs.showWater) select.innerHTML += '<option value="water">💧 Вода</option>';
    if (prefs.showHotWater) select.innerHTML += '<option value="hotWater">🌡️ Гар. Вода</option>';
    if (prefs.showElectro) select.innerHTML += '<option value="electro">⚡ Електрика</option>';
    if (prefs.showGas) select.innerHTML += '<option value="gas">🔥 Газ</option>';
    if (select.querySelector(`option[value="${cur}"]`)) select.value = cur;
}

function renderTariffsInputs() {
    const container = $('tariffsContainer'); if (!container) return;
    let html = '';
    if (prefs.showWater) html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">💧 Холодна вода, ₴/м³</p><input type="number" id="tWater" step="0.01" value="${tariffs.water}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
    if (prefs.showHotWater) html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">🌡️ Гаряча вода, ₴/м³</p><input type="number" id="tHotWater" step="0.01" value="${tariffs.hotWater}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
    if (prefs.showElectro) {
        html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">⚡ Електрика, ₴/кВт·год</p><input type="number" id="tElectroBase" step="0.01" value="${tariffs.electroBase}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
        if (prefs.electroWinter) html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">❄️ Зимовий, ₴/кВт·год</p><input type="number" id="tElectroWinter" step="0.01" value="${tariffs.electroWinter}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
    }
    if (prefs.showGas) html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">🔥 Газ, ₴/м³</p><input type="number" id="tGas" step="0.01" value="${tariffs.gas}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
    if (prefs.showHeating) html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">🏠 Опалення, ₴/Гкал</p><input type="number" id="tHeating" step="0.01" value="${tariffs.heating || 1654.76}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
    if (prefs.showDrainage) html += `<div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl"><p class="text-[8px] font-bold text-slate-400 uppercase mb-1">🚿 Водовідведення, ₴/м³</p><input type="number" id="tDrainage" step="0.01" value="${tariffs.drainage || 19.02}" class="premium-input w-full bg-white dark:bg-[#2c2c2e] px-2 py-1.5 rounded-lg font-bold outline-none text-center text-sm border border-slate-200 dark:border-transparent"></div>`;
    if (!html) html = '<p class="text-xs text-slate-400 text-center col-span-2 py-4">Оберіть послуги вище</p>';
    container.innerHTML = html;
}

function applyPreferences() {
    if ($('prefWater')) $('prefWater').checked = prefs.showWater;
    if ($('prefHotWater')) $('prefHotWater').checked = prefs.showHotWater;
    if ($('prefElectro')) $('prefElectro').checked = prefs.showElectro;
    if ($('prefGas')) $('prefGas').checked = prefs.showGas;
    if ($('prefHeating')) $('prefHeating').checked = prefs.showHeating || false;
    if ($('prefDrainage')) $('prefDrainage').checked = prefs.showDrainage || false;
    if ($('prefElectroTwoZone')) $('prefElectroTwoZone').checked = prefs.electroTwoZone;
    if ($('prefElectroWinter')) $('prefElectroWinter').checked = prefs.electroWinter;
    if ($('prefReminders')) { $('prefReminders').checked = prefs.remindersEnabled; if ($('remindersSettings')) $('remindersSettings').style.display = prefs.remindersEnabled ? 'block' : 'none'; }
    if ($('remWaterStart')) $('remWaterStart').value = prefs.remWaterStart || 1;
    if ($('remWaterEnd')) $('remWaterEnd').value = prefs.remWaterEnd || 5;
    if ($('remElectroStart')) $('remElectroStart').value = prefs.remElectroStart || 28;
    if ($('remElectroEnd')) $('remElectroEnd').value = prefs.remElectroEnd || 3;

    if ($('blockWater')) $('blockWater').style.display = prefs.showWater ? 'block' : 'none';
    if ($('blockHotWater')) $('blockHotWater').style.display = prefs.showHotWater ? 'block' : 'none';
    if ($('blockElectro')) $('blockElectro').style.display = prefs.showElectro ? 'block' : 'none';
    if ($('blockGas')) $('blockGas').style.display = prefs.showGas ? 'block' : 'none';
    if ($('blockCustomServices')) $('blockCustomServices').style.display = customServices.length > 0 ? 'block' : 'none';

    const electroOpts = $('electroOptionsWrap');
    if (electroOpts) electroOpts.style.display = prefs.showElectro ? 'flex' : 'none';

    if (prefs.electroTwoZone) {
        if ($('electroNightRow')) $('electroNightRow').style.display = 'flex';
        if ($('lblDay1')) $('lblDay1').innerText = "(День)";
        if ($('lblDay2')) $('lblDay2').innerText = "(День)";
    } else {
        if ($('electroNightRow')) $('electroNightRow').style.display = 'none';
        if ($('lblDay1')) $('lblDay1').innerText = "";
        if ($('lblDay2')) $('lblDay2').innerText = "";
    }
    if ($('winterCheckboxWrapper')) $('winterCheckboxWrapper').style.display = prefs.electroWinter ? 'flex' : 'none';

    renderTariffsInputs();
    updateServiceChartOptions();
}

['prefWater', 'prefHotWater', 'prefElectro', 'prefGas', 'prefHeating', 'prefDrainage', 'prefElectroTwoZone', 'prefElectroWinter'].forEach(id => {
    $(id)?.addEventListener('change', () => {
        prefs.showWater = $('prefWater')?.checked ?? prefs.showWater;
        prefs.showHotWater = $('prefHotWater')?.checked ?? prefs.showHotWater;
        prefs.showElectro = $('prefElectro')?.checked ?? prefs.showElectro;
        prefs.showGas = $('prefGas')?.checked ?? prefs.showGas;
        prefs.showHeating = $('prefHeating')?.checked ?? false;
        prefs.showDrainage = $('prefDrainage')?.checked ?? false;
        prefs.electroTwoZone = $('prefElectroTwoZone')?.checked ?? prefs.electroTwoZone;
        prefs.electroWinter = $('prefElectroWinter')?.checked ?? prefs.electroWinter;
        applyPreferences(); renderCalcCustomServices(); calculatePreview(); updateSmartBadges();
    });
});

$('prefReminders')?.addEventListener('change', function () {
    if ($('remindersSettings')) $('remindersSettings').style.display = this.checked ? 'block' : 'none';
});

$('saveSettingsBtn')?.addEventListener('click', () => {
    tariffs.water = parseFloat($('tWater')?.value) || defaultTariffs.water;
    tariffs.hotWater = parseFloat($('tHotWater')?.value) || defaultTariffs.hotWater;
    tariffs.electroBase = parseFloat($('tElectroBase')?.value) || defaultTariffs.electroBase;
    tariffs.electroWinter = parseFloat($('tElectroWinter')?.value) || defaultTariffs.electroWinter;
    tariffs.gas = parseFloat($('tGas')?.value) || defaultTariffs.gas;
    tariffs.heating = parseFloat($('tHeating')?.value) || defaultTariffs.heating;
    tariffs.drainage = parseFloat($('tDrainage')?.value) || defaultTariffs.drainage;
    prefs = {
        showWater: $('prefWater')?.checked || false,
        showHotWater: $('prefHotWater')?.checked || false,
        showElectro: $('prefElectro')?.checked || false,
        showGas: $('prefGas')?.checked || false,
        showHeating: $('prefHeating')?.checked || false,
        showDrainage: $('prefDrainage')?.checked || false,
        electroTwoZone: $('prefElectroTwoZone')?.checked || false,
        electroWinter: $('prefElectroWinter')?.checked || false,
        remindersEnabled: $('prefReminders')?.checked || false,
        remWaterStart: parseInt($('remWaterStart')?.value) || 1,
        remWaterEnd: parseInt($('remWaterEnd')?.value) || 5,
        remElectroStart: parseInt($('remElectroStart')?.value) || 28,
        remElectroEnd: parseInt($('remElectroEnd')?.value) || 3
    };
    customServices = customServices.filter(s => s.name.trim() !== "");
    localStorage.setItem('k_budget', $('budgetInput')?.value || '0');
    syncToCloud(); applyPreferences(); renderCalcCustomServices(); calculatePreview(); updateSmartBadges(); checkReminders();
    showToast("Збережено ✓");
});

function renderSettingsCustomServices() {
    const list = $('customServicesSettingsList'); if (!list) return;
    list.innerHTML = customServices.map((srv, i) => `
        <div class="flex gap-2 items-center bg-slate-50 dark:bg-black/50 p-2 rounded-xl border border-slate-100 dark:border-white/5">
            <input type="text" value="${escapeHtml(srv.name)}" data-idx="${i}" data-field="name" placeholder="Назва" class="cs-setting-input flex-1 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2.5 py-2.5 border border-transparent focus:border-brand transition-colors">
            <input type="number" step="0.01" value="${srv.defaultSum}" data-idx="${i}" data-field="sum" placeholder="₴" class="cs-setting-input w-16 bg-white dark:bg-[#2c2c2e] rounded-lg text-xs font-bold outline-none px-2 py-2.5 text-center border border-transparent focus:border-brand transition-colors">
            <button type="button" class="cs-del p-2 text-slate-400 hover:text-red-500 bg-white dark:bg-[#2c2c2e] rounded-lg transition-colors" data-idx="${i}"><i class="fa-solid fa-trash text-[10px]"></i></button>
        </div>`).join('');
    list.querySelectorAll('.cs-setting-input').forEach(input => {
        input.addEventListener('change', () => {
            const idx = parseInt(input.dataset.idx);
            if (input.dataset.field === 'name') customServices[idx].name = input.value;
            else customServices[idx].defaultSum = input.value;
        });
    });
    list.querySelectorAll('.cs-del').forEach(btn => {
        btn.addEventListener('click', () => { customServices.splice(parseInt(btn.dataset.idx), 1); renderSettingsCustomServices(); });
    });
}

$('addCustomServiceBtn')?.addEventListener('click', () => {
    customServices.push({ id: 's' + Date.now(), name: "", defaultSum: "" });
    renderSettingsCustomServices();
});

function renderCalcCustomServices() {
    const c = $('customServicesContainer'); if (!c) return;
    if (customServices.length === 0) { c.innerHTML = ''; return; }
    c.innerHTML = customServices.map(srv => `
        <div class="flex flex-col bg-slate-50 dark:bg-black/40 rounded-2xl p-3 border border-slate-100 dark:border-white/5">
            <span class="block text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate mb-1.5 text-center">${escapeHtml(srv.name) || 'Послуга'}</span>
            <input type="number" step="0.01" id="custom_${srv.id}" class="custom-srv-input premium-input w-full bg-white dark:bg-[#2c2c2e] p-2.5 rounded-xl text-center text-lg font-black outline-none border border-slate-200 dark:border-white/10" placeholder="${srv.defaultSum || '0.00'}">
        </div>`).join('');
    document.querySelectorAll('.custom-srv-input').forEach(input => input.addEventListener('input', calculatePreview));
}

function checkReminders() {
    const monthKey = new Date().getFullYear() + '-' + new Date().getMonth();
    if (!prefs.remindersEnabled || localStorage.getItem('lastSubmittedMonth') === monthKey) {
        $('reminderBanner')?.classList.add('hidden'); return;
    }
    const d = new Date().getDate();
    let msgs = [];
    const wS = prefs.remWaterStart || 1, wE = prefs.remWaterEnd || 5;
    const eS = prefs.remElectroStart || 28, eE = prefs.remElectroEnd || 3;
    const isW = wS <= wE ? (d >= wS && d <= wE) : (d >= wS || d <= wE);
    const isE = eS <= eE ? (d >= eS && d <= eE) : (d >= eS || d <= eE);
    if (isW && (prefs.showWater || prefs.showHotWater)) msgs.push("💧 Воду");
    if (isE && prefs.showElectro) msgs.push("⚡️ Електрику");
    if (msgs.length > 0) {
        $('reminderBanner')?.classList.remove('hidden');
        if ($('reminderText')) $('reminderText').innerText = "Передайте: " + msgs.join(" та ");
    } else $('reminderBanner')?.classList.add('hidden');
}

$('reminderDismissBtn')?.addEventListener('click', () => {
    localStorage.setItem('lastSubmittedMonth', new Date().getFullYear() + '-' + new Date().getMonth());
    $('reminderBanner')?.classList.add('hidden');
    showToast("Нагадаємо наступного місяця", "🔔");
});

$('changePassBtn')?.addEventListener('click', async () => {
    const oldPass = await showInputModal("Поточний пароль", "Введіть поточний пароль");
    if (!oldPass) return;
    const newPass = await showInputModal("Новий пароль", "Мінімум 4 символи");
    if (!newPass || newPass.length < 4) return showToast("Мінімум 4 символи", "⚠️");
    const confirmPass = await showInputModal("Підтвердіть пароль", "Повторіть новий пароль");
    if (newPass !== confirmPass) return showToast("Паролі не збігаються", "❌");
    try {
        const oldHash = await getHash(oldPass);
        const newHash = await getHash(newPass);
        const res = await fetch(WORKER_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "change_password", login: sessionLogin, oldPass: oldHash, newPass: newHash })
        });
        if ((await res.json()).success) { sessionPass = newHash; localStorage.setItem('k_passHash', newHash); showToast("Змінено!", "✅"); }
        else showToast("Неправильний пароль", "❌");
    } catch (e) { showToast("Помилка", "❌"); }
});

// =================== ACHIEVEMENTS ===================
const ACHIEVEMENTS = [
    { id: 'first_record', emoji: '🎉', title: 'Перший запис', desc: 'Зберегли перший розрахунок', check: (r) => r.length >= 1 },
    { id: 'streak_3', emoji: '🔥', title: '3 місяці поспіль', desc: '3 місяці без перерви', check: (r) => getStreak(r) >= 3 },
    { id: 'streak_6', emoji: '💪', title: 'Полугідник', desc: '6 місяців поспіль', check: (r) => getStreak(r) >= 6 },
    { id: 'streak_12', emoji: '👑', title: 'Рік без перерви', desc: 'Цілий рік!', check: (r) => getStreak(r) >= 12 },
    { id: 'all_paid', emoji: '✅', title: 'Чистий рахунок', desc: 'Все оплачено', check: (r) => r.length > 0 && r.every(rec => rec.paid) },
    { id: 'records_10', emoji: '📊', title: 'Аналітик', desc: '10+ записів', check: (r) => r.length >= 10 },
    { id: 'saver', emoji: '💰', title: 'Економ', desc: 'Знизили витрати 3 міс', check: (r) => checkSaverAchievement(r) },
    { id: 'multi_address', emoji: '🏘️', title: 'Мультивласник', desc: '2+ адреси', check: () => addresses.length >= 2 },
    { id: 'budget_master', emoji: '🎯', title: 'Бюджетник', desc: 'Не перевищили бюджет 3 міс', check: (r) => checkBudgetAchievement(r) },
    { id: 'night_owl', emoji: '🦉', title: 'Нічна сова', desc: '70%+ нічне споживання', check: (r) => checkNightOwl(r) },
];
const ACHIEVEMENT_HINTS = { 'first_record': 'Збережіть перший розрахунок', 'streak_3': 'Вносіть показники 3 місяці без пропуску', 'streak_6': '6 місяців без пропуску', 'streak_12': 'Рік без пропуску', 'all_paid': 'Позначте всі записи як оплачені', 'records_10': 'Накопичте 10+ записів', 'saver': 'Знижуйте суму 3 місяці поспіль', 'multi_address': 'Додайте другу адресу', 'budget_master': 'Не перевищуйте бюджет 3 міс поспіль', 'night_owl': 'Споживайте 70%+ електрики вночі' };

function getStreak(recs) { if (!recs.length) return 0; const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month)); let streak = 1; for (let i = 0; i < sorted.length - 1; i++) { const [y1, m1] = sorted[i].month.split('-').map(Number); const [y2, m2] = sorted[i + 1].month.split('-').map(Number); if ((y1 * 12 + m1) - (y2 * 12 + m2) === 1) streak++; else break; } return streak; }
function checkSaverAchievement(recs) { if (recs.length < 4) return false; const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month)); return sorted[0].total < sorted[1].total && sorted[1].total < sorted[2].total; }
function checkBudgetAchievement(recs) { const budget = parseFloat(localStorage.getItem('k_budget')) || 0; if (!budget || recs.length < 3) return false; const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 3); return sorted.every(r => r.total <= budget); }
function checkNightOwl(recs) { if (recs.length === 0) return false; const last = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month))[0]; const nightUsage = Math.max(0, (last.nCur || 0) - (last.nPrev || 0)); const dayUsage = Math.max(0, (last.dCur || 0) - (last.dPrev || 0)); const total = nightUsage + dayUsage; return total > 0 && (nightUsage / total) >= 0.7; }
function getUnlockedAchievements() { return ACHIEVEMENTS.filter(a => a.check(records)); }

function checkNewAchievements() { const unlocked = JSON.parse(localStorage.getItem('achievements_unlocked') || '[]'); const current = getUnlockedAchievements(); const newOnes = current.filter(a => !unlocked.includes(a.id)); if (newOnes.length > 0) { localStorage.setItem('achievements_unlocked', JSON.stringify(current.map(a => a.id))); showAchievementUnlock(newOnes[0]); } }
function showAchievementUnlock(ach) { const t = $('achievementToast'); if (!t) return; $('achievementEmoji').textContent = ach.emoji; $('achievementTitle').textContent = ach.title; $('achievementDesc').textContent = ach.desc; t.classList.remove('hidden'); setTimeout(() => { t.style.transform = 'translate(-50%,-50%) scale(1)'; t.style.opacity = '1'; }, 10); haptic('success'); setTimeout(() => { t.style.transform = 'translate(-50%,-50%) scale(0)'; t.style.opacity = '0'; setTimeout(() => t.classList.add('hidden'), 400); }, 3000); }

function renderAchievements() { const container = $('achievementsList'); if (!container) return; const unlocked = getUnlockedAchievements().map(a => a.id); container.innerHTML = ACHIEVEMENTS.map(a => `<div class="achievement ${unlocked.includes(a.id) ? '' : 'locked'} flex flex-col items-center gap-1 w-14 text-center cursor-pointer" data-ach-id="${a.id}"><span class="text-2xl">${a.emoji}</span><span class="text-[8px] font-bold text-slate-500 leading-tight">${escapeHtml(a.title)}</span></div>`).join(''); container.querySelectorAll('[data-ach-id]').forEach(el => { el.addEventListener('click', () => showAchievementDetail(el.dataset.achId)); }); }
function showAchievementDetail(achId) { const ach = ACHIEVEMENTS.find(a => a.id === achId); if (!ach) return; const isUnlocked = ach.check(records); $('achDetailEmoji').textContent = ach.emoji; $('achDetailTitle').textContent = ach.title; $('achDetailDesc').textContent = ach.desc; $('achDetailHow').textContent = ACHIEVEMENT_HINTS[achId] || '—'; const s = $('achDetailStatus'); if (isUnlocked) { s.textContent = '✓ Отримано'; s.className = 'text-xs font-bold px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-600'; } else { s.textContent = '🔒 Заблоковано'; s.className = 'text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400'; } $('achievementDetailModal').classList.remove('hidden'); haptic('light'); }

// =================== TIPS ===================
function getConsumptionTrend(type, months = 6) { const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, months); if (sorted.length < 2) return null; const values = sorted.map(r => { switch (type) { case 'water': return Math.max(0, (r.wCur || 0) - (r.wPrev || 0)); case 'electro': return Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0)); case 'gas': return Math.max(0, (r.gCur || 0) - (r.gPrev || 0)); default: return r.total; } }).reverse(); const first = values.slice(0, Math.ceil(values.length / 2)); const second = values.slice(Math.ceil(values.length / 2)); const avgFirst = first.reduce((a, b) => a + b, 0) / first.length; const avgSecond = second.reduce((a, b) => a + b, 0) / second.length; if (avgFirst === 0) return 0; return Math.round(((avgSecond - avgFirst) / avgFirst) * 100); }

function getSmartTips() { const tips = []; if (records.length >= 3) { const waterTrend = getConsumptionTrend('water'); if (waterTrend && waterTrend > 20) tips.push({ emoji: '💧', text: `Споживання води зросло на ${waterTrend}%. Перевірте крани.` }); const electroTrend = getConsumptionTrend('electro'); if (electroTrend && electroTrend > 20) tips.push({ emoji: '⚡', text: `Електрика +${electroTrend}%. Перевірте прилади.` }); if (electroTrend && electroTrend < -10) tips.push({ emoji: '🎉', text: `Електрика -${Math.abs(electroTrend)}%! Чудова економія!` }); } const budget = parseFloat(localStorage.getItem('k_budget')) || 0; if (budget && records.length > 0) { const last = [...records].sort((a, b) => new Date(b.month) - new Date(a.month))[0]; if (last.total > budget * 1.2) tips.push({ emoji: '⚠️', text: `Перевищили бюджет на ${Math.round(((last.total - budget) / budget) * 100)}%` }); } const unpaid = records.filter(r => !r.paid); if (unpaid.length >= 3) tips.push({ emoji: '💳', text: `${unpaid.length} неоплачених місяців. Оплатіть борг.` }); if (prefs.showElectro && prefs.electroTwoZone && records.length > 0) { const last = [...records].sort((a, b) => new Date(b.month) - new Date(a.month))[0]; const nightUsage = Math.max(0, (last.nCur || 0) - (last.nPrev || 0)); const dayUsage = Math.max(0, (last.dCur || 0) - (last.dPrev || 0)); const total = nightUsage + dayUsage; if (total > 0 && nightUsage / total < 0.3) tips.push({ emoji: '🌙', text: 'Спробуйте більше електрики вночі — дешевше.' }); } return tips.slice(0, 3); }

function renderTips() { const container = $('tipsContainer'); if (!container) return; const tips = getSmartTips(); if (!tips.length) { container.classList.add('hidden'); return; } container.classList.remove('hidden'); const listEl = $('tipsList'); if (listEl) listEl.innerHTML = tips.map(t => `<div class="flex items-start gap-3 bg-slate-50 dark:bg-black/40 p-3 rounded-xl border border-slate-100 dark:border-white/5"><span class="text-lg shrink-0">${t.emoji}</span><p class="text-xs font-medium text-slate-600 dark:text-slate-300">${escapeHtml(t.text)}</p></div>`).join(''); }

// =================== SWIPE ===================
function initSwipe(card, recordId) {
    let startX = 0, currentX = 0, isSwiping = false; const threshold = 80;
    card.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isSwiping = true; card.classList.add('swiping'); }, { passive: true });
    card.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        currentX = e.touches[0].clientX - startX;
        const limited = Math.sign(currentX) * Math.min(Math.abs(currentX), 120);
        card.style.transform = `translateX(${limited}px)`;
        const l = card.querySelector('.swipe-bg-left'), r = card.querySelector('.swipe-bg-right');
        if (l) l.style.opacity = currentX < -30 ? '1' : '0';
        if (r) r.style.opacity = currentX > 30 ? '1' : '0';
    }, { passive: true });
    card.addEventListener('touchend', () => {
        isSwiping = false; card.classList.remove('swiping'); card.style.transform = '';
        const l = card.querySelector('.swipe-bg-left'), r = card.querySelector('.swipe-bg-right');
        if (l) l.style.opacity = '0'; if (r) r.style.opacity = '0';
        if (currentX < -threshold) { card.style.transform = 'translateX(-100%)'; card.style.opacity = '0'; setTimeout(() => deleteRecordById(recordId), 300); }
        else if (currentX > threshold) { card.style.transform = 'translateX(100%)'; card.style.opacity = '0'; setTimeout(() => togglePaidById(recordId), 300); }
        currentX = 0;
    }, { passive: true });
}

// =================== RECORDS ===================
function findRecordIndex(id) { return records.findIndex(r => r.id === id); }
function togglePaidById(id) { const idx = findRecordIndex(id); if (idx < 0) return; records[idx].paid = !records[idx].paid; renderRecords(); renderDashboard(); syncToCloud(); checkNewAchievements(); }
function deleteRecordById(id) { records = records.filter(r => r.id !== id); renderRecords(); renderDashboard(); syncToCloud(); showToast('Видалено', '🗑'); }

function renderRecords() {
    const list = $('recordsList'); if (!list) return;
    if (records.length === 0) {
        list.innerHTML = `<div class="text-center py-12"><div class="w-16 h-16 bg-brand-light rounded-2xl flex items-center justify-center mx-auto mb-4"><i class="fa-solid fa-plus text-brand text-2xl"></i></div><p class="font-bold text-slate-700 dark:text-slate-200 mb-2">Ще немає записів</p><p class="text-sm text-slate-400">Внесіть показники у вкладці «Рахунок»</p></div>`;
        if ($('statsAvg')) $('statsAvg').innerText = '0 ₴';
        if ($('statsTotalPaid')) $('statsTotalPaid').innerText = '0 ₴';
        if ($('statsMin')) $('statsMin').innerText = '0 ₴';
        if ($('statsMax')) $('statsMax').innerText = '0 ₴';
        if ($('statsCount')) $('statsCount').innerText = '0';
        renderHistoryChart([]); renderServiceChart(); return;
    }

    const totals = records.map(r => r.total);
    if ($('statsAvg')) $('statsAvg').innerText = fmt.format(totals.reduce((a, b) => a + b, 0) / totals.length) + ' ₴';
    if ($('statsTotalPaid')) $('statsTotalPaid').innerText = fmt.format(records.filter(r => r.paid).reduce((s, r) => s + r.total, 0)) + ' ₴';
    if ($('statsMin')) $('statsMin').innerText = fmt.format(Math.min(...totals)) + ' ₴';
    if ($('statsMax')) $('statsMax').innerText = fmt.format(Math.max(...totals)) + ' ₴';
    if ($('statsCount')) $('statsCount').innerText = records.length;

    let sorted = [...records];
    const sortVal = $('sortSelect')?.value || 'date-desc';
    switch (sortVal) {
        case 'date-desc': sorted.sort((a, b) => new Date(b.month) - new Date(a.month)); break;
        case 'date-asc': sorted.sort((a, b) => new Date(a.month) - new Date(b.month)); break;
        case 'amount-desc': sorted.sort((a, b) => b.total - a.total); break;
        case 'amount-asc': sorted.sort((a, b) => a.total - b.total); break;
    }
    if (currentFilter === 'paid') sorted = sorted.filter(r => r.paid);
    else if (currentFilter === 'unpaid') sorted = sorted.filter(r => !r.paid);

    const search = $('searchRecords')?.value?.toLowerCase() || '';
    if (search) sorted = sorted.filter(r => new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' }).toLowerCase().includes(search) || r.month.includes(search));

    renderHistoryChart([...records].sort((a, b) => new Date(a.month) - new Date(b.month)));
    renderServiceChart();
    list.innerHTML = '';

    if (!sorted.length) { list.innerHTML = `<div class="text-center py-8"><p class="text-slate-400 font-medium">Нічого не знайдено</p></div>`; return; }

    // Batch pay bar
    const unpaidCount = sorted.filter(r => !r.paid).length;
    if (unpaidCount > 0 && currentFilter !== 'paid') {
        const batchBar = document.createElement('div');
        batchBar.className = 'bg-gradient-to-r from-green-500 to-emerald-600 p-4 rounded-2xl flex justify-between items-center text-white mb-4';
        batchBar.innerHTML = `<div><p class="text-xs font-bold opacity-80">${unpaidCount} неоплачених</p><p class="text-sm font-black">${fmt.format(sorted.filter(r => !r.paid).reduce((s, r) => s + r.total, 0))} ₴</p></div><button class="batch-pay-btn px-4 py-2 bg-white/20 rounded-xl text-xs font-bold active:scale-95 transition-transform border border-white/20">✓ Оплатити всі</button>`;
        list.appendChild(batchBar);
        batchBar.querySelector('.batch-pay-btn')?.addEventListener('click', async () => {
            const ok = await showConfirmModal('Оплатити всі?', `Позначити ${unpaidCount} записів як оплачені?`);
            if (ok) { records.forEach(r => { if (!r.paid) r.paid = true; }); renderRecords(); renderDashboard(); syncToCloud(); checkNewAchievements(); showToast(`${unpaidCount} записів оплачено!`, '✅'); }
        });
    }

    let lastYear = null;
    sorted.forEach(rec => {
        const yr = rec.month.split('-')[0];
        if (yr !== lastYear) { lastYear = yr; const h = document.createElement('div'); h.className = "flex items-center gap-4 mt-6 mb-3"; h.innerHTML = `<h2 class="text-lg font-black text-slate-300 dark:text-slate-600">${yr}</h2><div class="h-[1px] flex-1 bg-slate-200 dark:bg-white/5"></div>`; list.appendChild(h); }
        list.appendChild(createRecordCard(rec));
    });
}

function renderHistoryChart(sortedRecords, retryCount = 0) {
    if (!$('historyChartCanvas')) return;
    if (!historyChart) historyChart = new ChartEngine('historyChartCanvas', { padding: 30, barRadius: 5 });
    if (!historyChart.width) historyChart.setupCanvas();
    if (!historyChart.width) { if (retryCount < 5) setTimeout(() => renderHistoryChart(sortedRecords, retryCount + 1), 200); return; }
    const recent = sortedRecords.slice(-10);
    const data = recent.map(r => ({ value: r.total, label: new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3), color: r.paid ? '#007aff' : '#ff9500' }));
    historyChart.setData(data);
}

function renderServiceChart(retryCount = 0) {
    if (!$('serviceChartCanvas') || records.length === 0) { if ($('serviceChartSummary')) $('serviceChartSummary').innerHTML = ''; return; }
    const type = $('serviceChartSelect')?.value || 'water';
    const unit = (type === 'electro') ? 'кВт' : 'м³';
    if (!serviceChart) serviceChart = new ChartEngine('serviceChartCanvas', { padding: 24, barRadius: 4, unit });
    else serviceChart.options.unit = unit;
    if (!serviceChart.width) serviceChart.setupCanvas();
    if (!serviceChart.width) { if (retryCount < 5) setTimeout(() => renderServiceChart(retryCount + 1), 200); return; }
    const sorted = [...records].sort((a, b) => new Date(a.month) - new Date(b.month)).slice(-8);
    const getValue = (rec) => { switch (type) { case 'water': return Math.max(0, (rec.wCur || 0) - (rec.wPrev || 0)); case 'hotWater': return Math.max(0, (rec.hwCur || 0) - (rec.hwPrev || 0)); case 'electro': return Math.max(0, (rec.dCur || 0) - (rec.dPrev || 0)) + Math.max(0, (rec.nCur || 0) - (rec.nPrev || 0)); case 'gas': return Math.max(0, (rec.gCur || 0) - (rec.gPrev || 0)); default: return 0; } };
    const getColor = () => { switch (type) { case 'water': return '#3b82f6'; case 'hotWater': return '#ef4444'; case 'electro': return '#eab308'; case 'gas': return '#f97316'; default: return '#6b7280'; } };
    const color = getColor();
    const data = sorted.map(rec => ({ value: getValue(rec), label: new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3), color }));
    serviceChart.setData(data);
    const values = data.map(d => d.value); const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; const last = values[values.length - 1] || 0; const prevLast = values.length > 1 ? values[values.length - 2] : last; const trendPct = prevLast > 0 ? Math.round(((last - prevLast) / prevLast) * 100) : 0;
    const summary = $('serviceChartSummary');
    if (summary) summary.innerHTML = `<span>Сер.: <span style="color:${color}" class="font-black">${Math.round(avg)} ${unit}/міс</span></span><span>Ост.: <span class="${trendPct < 0 ? 'text-green-600' : trendPct > 0 ? 'text-red-500' : 'text-slate-500'} font-black">${last} ${unit} (${trendPct > 0 ? '+' : ''}${trendPct}%)</span></span>`;
}
$('serviceChartSelect')?.addEventListener('change', renderServiceChart);

function createRecordCard(rec) {
    const card = document.createElement('div');
    card.className = `premium-card swipe-card p-5 relative overflow-hidden cursor-pointer select-none ${rec.paid ? '' : 'ring-1 ring-orange-400/20'}`;
    const dStr = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long' });
    const recId = rec.id;

    const filledServices = [];
    if (rec._filled?.water || rec.waterCost > 0) filledServices.push('💧');
    if (rec._filled?.hotWater || rec.hotWaterCost > 0) filledServices.push('🌡️');
    if (rec._filled?.electro || rec.electroCost > 0) filledServices.push('⚡');
    if (rec._filled?.gas || rec.gasCost > 0) filledServices.push('🔥');
    if (rec._filled?.custom || rec.customCost > 0) filledServices.push('📦');

    const pW = rec.total > 0 ? ((rec.waterCost || 0) / rec.total) * 100 : 0;
    const pHW = rec.total > 0 ? ((rec.hotWaterCost || 0) / rec.total) * 100 : 0;
    const pE = rec.total > 0 ? ((rec.electroCost || 0) / rec.total) * 100 : 0;
    const pG = rec.total > 0 ? ((rec.gasCost || 0) / rec.total) * 100 : 0;

    card.innerHTML = `
        ${!rec.paid ? '<div class="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-orange-400/15 to-transparent rounded-bl-[4rem]"></div>' : ''}
        <div class="flex justify-between items-center relative z-10" data-toggle-details="${recId}">
            <div>
                <h4 class="font-bold text-xl capitalize text-slate-900 dark:text-white mb-1.5">${escapeHtml(dStr)}</h4>
                <div class="flex items-center flex-wrap gap-1">
                    <span class="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${rec.paid ? 'bg-brand-light text-brand' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'}">${rec.paid ? 'Оплачено' : 'Борг'}</span>
                    <span class="text-[9px] text-slate-400">${filledServices.join(' ')}</span>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-black text-2xl text-slate-900 dark:text-white">${fmt.format(rec.total)} ₴</span>
                <div class="w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-white/5 rounded-full text-slate-400">
                    <i class="chevron-icon fa-solid fa-chevron-down transition-transform duration-300"></i>
                </div>
            </div>
        </div>
        <div class="details-panel hidden">
            <div class="border-t border-slate-100 dark:border-white/5 pt-5 mt-5">
                <div class="space-y-3">
                    ${rec.waterCost > 0 ? `<div class="flex justify-between"><span class="font-bold">💧 Вода</span><span class="font-black">${fmt.format(rec.waterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.wPrev}→${rec.wCur}</span><span class="text-blue-500">+${rec.wCur - rec.wPrev} м³</span></div>` : ''}
                    ${rec.hotWaterCost > 0 ? `<div class="flex justify-between"><span class="font-bold">🌡️ Гаряча</span><span class="font-black">${fmt.format(rec.hotWaterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.hwPrev}→${rec.hwCur}</span><span class="text-red-500">+${rec.hwCur - rec.hwPrev} м³</span></div>` : ''}
                    ${rec.electroCost > 0 ? `<div class="flex justify-between"><span class="font-bold">⚡ Електрика</span><span class="font-black">${fmt.format(rec.electroCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>Д:${rec.dPrev}→${rec.dCur}</span><span class="text-yellow-600">+${rec.dCur - rec.dPrev}</span></div>${(rec.nCur || rec.nPrev) ? `<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl mt-1"><span>Н:${rec.nPrev}→${rec.nCur}</span><span class="text-indigo-500">+${rec.nCur - rec.nPrev}</span></div>` : ''}` : ''}
                    ${rec.gasCost > 0 ? `<div class="flex justify-between"><span class="font-bold">🔥 Газ</span><span class="font-black">${fmt.format(rec.gasCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.gPrev}→${rec.gCur}</span><span class="text-orange-500">+${rec.gCur - rec.gPrev} м³</span></div>` : ''}
                    ${rec.customCost > 0 ? `<div class="flex justify-between"><span class="font-bold">📦 Фіксовані</span><span class="font-black">${fmt.format(rec.customCost)} ₴</span></div>${rec.customData ? Object.values(rec.customData).filter(s => s.val > 0).map(s => `<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${escapeHtml(s.name)}</span><span class="text-purple-500">${fmt.format(s.val)} ₴</span></div>`).join('') : ''}` : ''}
                    ${rec.note ? `<div class="mt-3 p-3 bg-slate-50 dark:bg-black/50 rounded-xl text-xs text-slate-500 italic"><i class="fa-solid fa-sticky-note mr-1"></i>${escapeHtml(rec.note)}</div>` : ''}
                </div>
            </div>
            <div class="flex gap-2.5 mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
                <button type="button" class="rec-pay flex-1 py-3.5 rounded-2xl font-bold text-xs border active:scale-[0.96] transition-all ${rec.paid ? 'bg-slate-50 dark:bg-[#2c2c2e] text-slate-500 border-slate-200 dark:border-white/10' : 'bg-gradient-to-r from-brand to-blue-600 text-white shadow-lg border-brand'}" data-rec-id="${recId}">${rec.paid ? '↩ Скасувати' : '✓ Оплачено'}</button>
                <button type="button" class="rec-share w-12 bg-blue-50 dark:bg-blue-500/10 rounded-2xl text-blue-500 active:scale-[0.90] transition-transform" data-rec-id="${recId}"><i class="fa-solid fa-share-nodes"></i></button>
                <button type="button" class="rec-edit w-12 bg-slate-50 dark:bg-white/5 rounded-2xl text-slate-400 active:scale-[0.90] transition-transform" data-rec-id="${recId}"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="rec-del w-12 bg-red-50 dark:bg-red-500/10 rounded-2xl text-red-400 active:scale-[0.90] transition-transform" data-rec-id="${recId}"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;

    const swL = document.createElement('div'); swL.className = 'swipe-bg-left'; swL.innerHTML = '<i class="fa-solid fa-trash mr-2"></i>Видалити';
    const swR = document.createElement('div'); swR.className = 'swipe-bg-right'; swR.innerHTML = `<i class="fa-solid fa-${rec.paid ? 'rotate-left' : 'check'} mr-2"></i>${rec.paid ? 'Скасувати' : 'Оплачено'}`;
    card.insertBefore(swL, card.firstChild); card.insertBefore(swR, card.firstChild);
    initSwipe(card, recId);

    card.addEventListener('click', (e) => {
        const target = e.target.closest('[data-toggle-details]');
        if (target) { const panel = card.querySelector('.details-panel'); const chevron = card.querySelector('.chevron-icon'); if (panel) { panel.classList.toggle('hidden'); if (chevron) chevron.style.transform = panel.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)'; } return; }
        const payBtn = e.target.closest('.rec-pay'); if (payBtn) { e.stopPropagation(); togglePaidById(recId); return; }
        const shareBtn = e.target.closest('.rec-share'); if (shareBtn) { e.stopPropagation(); shareRecordById(recId); return; }
        const editBtn = e.target.closest('.rec-edit'); if (editBtn) { e.stopPropagation(); editRecordById(recId); return; }
        const delBtn = e.target.closest('.rec-del'); if (delBtn) { e.stopPropagation(); deleteRecordConfirm(recId); return; }
    });

    return card;
}

async function deleteRecordConfirm(id) {
    const ok = await showConfirmModal('Видалити запис?', 'Цю дію неможливо скасувати.');
    if (ok) deleteRecordById(id);
}

async function shareRecordById(id) {
    const rec = records.find(r => r.id === id); if (!rec) return;
    const d = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
    let t = `🧾 Комуналка за ${d}\n📍 ${$('currentAddressDisplay')?.innerText || ''}\n──────────\n`;
    if (rec.waterCost > 0) t += `💧 Вода: ${fmt.format(rec.waterCost)} ₴\n`;
    if (rec.hotWaterCost > 0) t += `🌡️ Гар.: ${fmt.format(rec.hotWaterCost)} ₴\n`;
    if (rec.electroCost > 0) t += `⚡ Електрика: ${fmt.format(rec.electroCost)} ₴\n`;
    if (rec.gasCost > 0) t += `🔥 Газ: ${fmt.format(rec.gasCost)} ₴\n`;
    if (rec.customCost > 0) t += `📦 Інше: ${fmt.format(rec.customCost)} ₴\n`;
    t += `──────────\n💰 Всього: ${fmt.format(rec.total)} ₴\n${rec.paid ? '✅ Оплачено' : '⏳ Очікує'}`;
    if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) {} }
    try { await navigator.clipboard.writeText(t); showToast("Скопійовано!", "📋"); } catch (e) {}
}

function editRecordById(id) {
    const rec = records.find(r => r.id === id); if (!rec) return;
    if ($('monthInput')) $('monthInput').value = rec.month;
    if (prefs.showWater) { if ($('wPrev')) $('wPrev').value = rec.wPrev || ''; if ($('wCur')) $('wCur').value = rec.wCur || ''; }
    if (prefs.showHotWater) { if ($('hwPrev')) $('hwPrev').value = rec.hwPrev || ''; if ($('hwCur')) $('hwCur').value = rec.hwCur || ''; }
    if (prefs.showElectro) { if ($('dPrev')) $('dPrev').value = rec.dPrev || ''; if ($('dCur')) $('dCur').value = rec.dCur || ''; if ($('nPrev')) $('nPrev').value = rec.nPrev || ''; if ($('nCur')) $('nCur').value = rec.nCur || ''; }
    if (prefs.showGas) { if ($('gPrev')) $('gPrev').value = rec.gPrev || ''; if ($('gCur')) $('gCur').value = rec.gCur || ''; }
    if (rec.customData) Object.keys(rec.customData).forEach(srvId => { const el = $(`custom_${srvId}`); if (el) el.value = rec.customData[srvId].val; });
    if ($('recordNote')) $('recordNote').value = rec.note || '';
    const m = new Date(rec.month + '-01').getMonth() + 1;
    if ($('isWinterInput')) $('isWinterInput').checked = m >= 10 || m <= 4;
    switchTab('tabCalc', 1); calculatePreview(); updateSmartBadges();
}

// Filters
$('filterToggleBtn')?.addEventListener('click', () => $('filterPanel')?.classList.toggle('hidden'));
$('filterButtons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn'); if (!btn) return;
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('bg-brand', 'text-white'); b.classList.add('bg-slate-100', 'dark:bg-[#2c2c2e]', 'text-slate-600', 'dark:text-slate-400'); });
    btn.classList.remove('bg-slate-100', 'dark:bg-[#2c2c2e]', 'text-slate-600', 'dark:text-slate-400');
    btn.classList.add('bg-brand', 'text-white');
    renderRecords();
});

let searchDebounce;
$('searchRecords')?.addEventListener('input', () => { clearTimeout(searchDebounce); searchDebounce = setTimeout(renderRecords, 200); });
$('sortSelect')?.addEventListener('change', () => renderRecords());

// =================== EXPORT ===================
function exportCSV() {
    if (!records.length) return showToast('Немає записів', '⚠️');
    let h = ['Місяць'];
    if (prefs.showWater) h.push('Вода(м3)', 'Вода(₴)');
    if (prefs.showHotWater) h.push('Гар(м3)', 'Гар(₴)');
    if (prefs.showElectro) h.push('Електрика(кВт)', 'Електрика(₴)');
    if (prefs.showGas) h.push('Газ(м3)', 'Газ(₴)');
    h.push('Інше(₴)', 'Всього(₴)', 'Статус');
    let csv = '\uFEFF' + h.join(',') + '\n';
    [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).forEach(r => {
        let row = [r.month];
        if (prefs.showWater) row.push(Math.max(0, (r.wCur || 0) - (r.wPrev || 0)), (r.waterCost || 0).toFixed(2));
        if (prefs.showHotWater) row.push(Math.max(0, (r.hwCur || 0) - (r.hwPrev || 0)), (r.hotWaterCost || 0).toFixed(2));
        if (prefs.showElectro) row.push(Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0)), (r.electroCost || 0).toFixed(2));
        if (prefs.showGas) row.push(Math.max(0, (r.gCur || 0) - (r.gPrev || 0)), (r.gasCost || 0).toFixed(2));
        row.push((r.customCost || 0).toFixed(2), (r.total || 0).toFixed(2), r.paid ? 'Оплачено' : 'Борг');
        csv += row.join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `komunalka.csv`; link.click();
    showToast('Експортовано', '📊');
}

function loadScript(src) { return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); }); }

async function generatePDF() {
    if (!records.length) return showToast('Немає записів', '⚠️');
    if (!window.jspdf) {
        showToast('Підготовка PDF...', '⏳');
        await Promise.all([
            loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
            loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
        ]);
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const t = (s) => s; // без транслітерації якщо є шрифт
    doc.setFillColor(0, 122, 255); doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.text(t('Komunalni platezhi'), 15, 15);
    doc.setFontSize(10); doc.text($('currentAddressDisplay')?.innerText || '', 15, 24);
    doc.setTextColor(60, 60, 60);
    const tH = ['Mis.'];
    if (prefs.showWater) tH.push('Voda', 'UAH');
    if (prefs.showElectro) tH.push('Electro', 'UAH');
    if (prefs.showGas) tH.push('Gas', 'UAH');
    tH.push('Other', 'Total', 'Status');
    const tR = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).map(r => {
        const row = [r.month];
        if (prefs.showWater) row.push(Math.max(0, (r.wCur || 0) - (r.wPrev || 0)), (r.waterCost || 0).toFixed(0));
        if (prefs.showElectro) row.push(Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0)), (r.electroCost || 0).toFixed(0));
        if (prefs.showGas) row.push(Math.max(0, (r.gCur || 0) - (r.gPrev || 0)), (r.gasCost || 0).toFixed(0));
        row.push((r.customCost || 0).toFixed(0), (r.total || 0).toFixed(0), r.paid ? 'OK' : 'Borh');
        return row;
    });
    doc.autoTable({ startY: 40, head: [tH], body: tR, theme: 'striped', headStyles: { fillColor: [0, 122, 255], textColor: [255, 255, 255], fontSize: 7, fontStyle: 'bold', halign: 'center' }, bodyStyles: { fontSize: 7, halign: 'center' }, margin: { left: 10, right: 10 } });
    doc.save(`komunalka_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('PDF створено!', '📄');
}

async function shareAllRecords() {
    if (!records.length) return showToast('Немає записів', '⚠️');
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 6);
    let t = `📊 Комунальні\n📍 ${$('currentAddressDisplay')?.innerText || ''}\n───────\n`;
    sorted.forEach(r => { t += `${new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short', year: 'numeric' })}: ${fmt.format(r.total)} ₴ ${r.paid ? '✅' : '⏳'}\n`; });
    t += `───────\nСередній: ${fmt.format(sorted.reduce((s, r) => s + r.total, 0) / sorted.length)} ₴/міс`;
    if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) {} }
    try { await navigator.clipboard.writeText(t); showToast("Скопійовано!", "📋"); } catch (e) {}
}

$('exportCsvBtn')?.addEventListener('click', exportCSV);
$('exportPdfBtn')?.addEventListener('click', generatePDF);
$('shareAllBtn')?.addEventListener('click', shareAllRecords);

$('exportJsonBtn')?.addEventListener('click', () => {
    syncCurrentAddress();
    const data = { version: APP_VERSION, exportDate: new Date().toISOString(), addresses, currentAddressId };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `komunalka_backup.json`; link.click();
    showToast('Бекап збережено', '💾');
});

$('importJsonBtn')?.addEventListener('click', () => $('importFileInput')?.click());
$('importFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (data.addresses && Array.isArray(data.addresses)) {
                const ok = await showConfirmModal('Імпорт даних', `Імпортувати ${data.addresses.length} об'єктів? Поточні дані будуть замінені.`);
                if (ok) { addresses = data.addresses; currentAddressId = data.currentAddressId || addresses[0].id; loadCurrentAddress(); syncToCloud(); showToast('Імпортовано!', '✅'); }
            } else showToast('Невірний формат', '❌');
        } catch (err) { showToast('Помилка читання файлу', '❌'); }
    };
    reader.readAsText(file); e.target.value = '';
});

// =================== YEAR REPORT ===================
$('yearReportBtn')?.addEventListener('click', () => generateYearReport());

function generateYearReport() {
    const year = new Date().getFullYear();
    const yr = records.filter(r => r.month.startsWith(String(year)));
    if (!yr.length) { showToast('Немає даних за рік', '⚠️'); return; }
    if ($('yearReportYear')) $('yearReportYear').textContent = year;
    const total = yr.reduce((s, r) => s + r.total, 0);
    const avg = total / yr.length;
    const maxR = yr.reduce((a, b) => a.total > b.total ? a : b);
    const minR = yr.reduce((a, b) => a.total < b.total ? a : b);
    const paid = yr.filter(r => r.paid).length;
    const wT = yr.reduce((s, r) => s + (r.waterCost || 0), 0);
    const hwT = yr.reduce((s, r) => s + (r.hotWaterCost || 0), 0);
    const eT = yr.reduce((s, r) => s + (r.electroCost || 0), 0);
    const gT = yr.reduce((s, r) => s + (r.gasCost || 0), 0);
    const cT = yr.reduce((s, r) => s + (r.customCost || 0), 0);
    const maxM = new Date(maxR.month + '-01').toLocaleString('uk-UA', { month: 'long' });
    const minM = new Date(minR.month + '-01').toLocaleString('uk-UA', { month: 'long' });
    const streak = getStreak(records);

    let html = `<div class="text-center mb-2"><p class="text-3xl font-black text-slate-900 dark:text-white">${fmt.format(total)} ₴</p><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Загальні витрати</p></div><div class="grid grid-cols-2 gap-3"><div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl text-center"><p class="text-[9px] font-bold text-slate-400 uppercase">Середній</p><p class="text-lg font-black text-slate-900 dark:text-white">${fmt.format(avg)} ₴</p></div><div class="bg-slate-50 dark:bg-black/40 p-3 rounded-xl text-center"><p class="text-[9px] font-bold text-slate-400 uppercase">Місяців</p><p class="text-lg font-black text-slate-900 dark:text-white">${yr.length}</p></div></div><div class="bg-green-50 dark:bg-green-500/10 p-4 rounded-2xl"><div class="flex justify-between"><span class="text-sm font-bold text-green-700 dark:text-green-400">📉 Найдешевший</span><span class="font-black text-green-700 dark:text-green-400">${fmt.format(minR.total)} ₴</span></div><p class="text-[10px] text-green-600/70 mt-0.5">${minM}</p></div><div class="bg-red-50 dark:bg-red-500/10 p-4 rounded-2xl"><div class="flex justify-between"><span class="text-sm font-bold text-red-700 dark:text-red-400">📈 Найдорожчий</span><span class="font-black text-red-700 dark:text-red-400">${fmt.format(maxR.total)} ₴</span></div><p class="text-[10px] text-red-600/70 mt-0.5">${maxM}</p></div><div class="bg-slate-50 dark:bg-black/40 p-4 rounded-2xl"><p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-3">Розподіл</p><div class="space-y-2">${wT > 0 ? `<div class="flex justify-between text-xs"><span>💧 Вода</span><span class="font-black">${fmt.format(wT)} ₴ (${Math.round(wT / total * 100)}%)</span></div>` : ''}${hwT > 0 ? `<div class="flex justify-between text-xs"><span>🌡️ Гаряча</span><span class="font-black">${fmt.format(hwT)} ₴ (${Math.round(hwT / total * 100)}%)</span></div>` : ''}${eT > 0 ? `<div class="flex justify-between text-xs"><span>⚡ Електрика</span><span class="font-black">${fmt.format(eT)} ₴ (${Math.round(eT / total * 100)}%)</span></div>` : ''}${gT > 0 ? `<div class="flex justify-between text-xs"><span>🔥 Газ</span><span class="font-black">${fmt.format(gT)} ₴ (${Math.round(gT / total * 100)}%)</span></div>` : ''}${cT > 0 ? `<div class="flex justify-between text-xs"><span>📦 Фіксовані</span><span class="font-black">${fmt.format(cT)} ₴ (${Math.round(cT / total * 100)}%)</span></div>` : ''}</div></div><div class="grid grid-cols-2 gap-3"><div class="bg-brand-light p-3 rounded-xl text-center border border-brand-border"><p class="text-[9px] font-bold text-brand uppercase">Оплачено</p><p class="text-lg font-black text-brand">${paid}/${yr.length}</p></div><div class="bg-orange-50 dark:bg-orange-500/10 p-3 rounded-xl text-center border border-orange-100 dark:border-orange-500/20"><p class="text-[9px] font-bold text-orange-500 uppercase">Серія</p><p class="text-lg font-black text-orange-500">${streak} 🔥</p></div></div>`;
    if ($('yearReportContent')) $('yearReportContent').innerHTML = html;
    $('yearReportModal')?.classList.remove('hidden');
    haptic('success');
}

async function shareYearReport() {
    const year = new Date().getFullYear();
    const yr = records.filter(r => r.month.startsWith(String(year)));
    if (!yr.length) return;
    const total = yr.reduce((s, r) => s + r.total, 0);
    const avg = total / yr.length;
    const streak = getStreak(records);
    let t = `📊 Річний звіт ${year}\n📍 ${$('currentAddressDisplay')?.innerText || ''}\n═══════════════\n💰 Всього: ${fmt.format(total)} ₴\n📈 Середній: ${fmt.format(avg)} ₴/міс\n📅 Записів: ${yr.length}\n🔥 Серія: ${streak} міс.\n═══════════════`;
    if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) {} }
    try { await navigator.clipboard.writeText(t); showToast("Скопійовано!", "📋"); } catch (e) {}
}
window.shareYearReport = shareYearReport;

// =================== PWA ===================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('pwaInstallBlock')?.classList.remove('hidden'); });
$('installPwaBtn')?.addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') $('pwaInstallBlock')?.classList.add('hidden'); deferredPrompt = null; });

// =================== PUSH ===================
async function initPush() {
    if (!('Notification' in window)) return;
    const btn = $('enablePushBtn'); const st = $('pushStatus');
    if (Notification.permission === 'granted') { if (btn) btn.classList.add('hidden'); if (st) { st.classList.remove('hidden'); st.textContent = '✓ Push увімкнено'; st.className = 'text-[10px] text-green-500 text-center font-bold'; } }
    else if (Notification.permission !== 'denied') { if (btn) btn.classList.remove('hidden'); }
}
$('enablePushBtn')?.addEventListener('click', async () => { try { const p = await Notification.requestPermission(); if (p === 'granted') { showToast('Push увімкнено!', '🔔'); initPush(); } else showToast('Відмовлено', '⚠️'); } catch (e) { showToast('Помилка', '❌'); } });
setTimeout(initPush, 1000);

// =================== SHARE APP ===================
$('shareAppBtn')?.addEventListener('click', async () => {
    const text = '🏠 Комуналка — облік комунальних в телефоні.\nВносиш показники — бачиш скільки платити.\n\nhttps://komynalka.vercel.app';
    if (navigator.share) { try { await navigator.share({ text, url: 'https://komynalka.vercel.app' }); return; } catch (e) {} }
    try { await navigator.clipboard.writeText(text); showToast('Посилання скопійовано!', '📋'); } catch (e) {}
});

// =================== LOGOUT ===================
function logout() {
    if (isGuest) { window.location.href = window.location.pathname; return; }
    localStorage.clear();
    if (googleUser) { initFirebase(); firebase.auth().signOut(); }
    location.reload();
}
$('logoutBtn')?.addEventListener('click', async () => {
    const ok = await showConfirmModal('Вийти?', 'Дані збережені в хмарі. Ви зможете увійти знову.');
    if (ok) logout();
});

// =================== INIT APP UI ===================
function initAppUI() {
    $('authScreen')?.classList.add('hidden');
    $('appScreen')?.classList.remove('hidden');
    $('appScreen')?.classList.add('flex');

    if ($('budgetInput')) $('budgetInput').value = localStorage.getItem('k_budget') || '';
    if ($('accountLoginDisplay')) $('accountLoginDisplay').textContent = sessionLogin || '—';
    updateGoogleButton();
    applyPreferences();
    renderCalcCustomServices();
    fillPreviousReadings();
    switchTab('tabDashboard', 0);
    calculatePreview();
    updateSmartBadges();
    renderDashboard();

    // Enter key navigation
    const vis = readingInputIds.map(id => $(id)).filter(el => el && el.offsetParent !== null);
    vis.forEach((input, idx, arr) => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); const next = arr[idx + 1]; if (next) next.focus(); else $('submitFormBtn')?.focus(); }
        });
    });
}

// =================== GUEST / AUTO-LOGIN ===================
if (urlShareToken) {
    isGuest = true;
    $('authScreen')?.classList.add('hidden');
    $('appScreen')?.classList.remove('hidden');
    $('appScreen')?.classList.add('flex');
    if ($('btnTabSettings')) $('btnTabSettings').style.display = 'none';
    if ($('addressHeaderTrigger')) $('addressHeaderTrigger').style.pointerEvents = 'none';
    if ($('addressArrowIcon')) $('addressArrowIcon').style.display = 'none';
    fetch(`${WORKER_URL}?share=${urlShareToken}`, { cache: "no-store" })
        .then(r => r.json())
        .then(data => { if (data.success) { addresses = data.data.addresses; currentAddressId = data.data.currentAddressId; loadCurrentAddress(); } else showToast("Посилання недійсне", "❌"); });
}
else if (localStorage.getItem('k_uid')) performLogin(null, null, false, localStorage.getItem('k_uid'));
else if (sessionLogin && sessionPass) performLogin(sessionLogin, sessionPass, true);

// Theme buttons
$('mode-light')?.addEventListener('click', () => setThemeMode('light'));
$('mode-auto')?.addEventListener('click', () => setThemeMode('auto'));
$('mode-dark')?.addEventListener('click', () => setThemeMode('dark'));

// =================== RESIZE ===================
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        [dashChart, historyChart, serviceChart, donutChart].forEach(chart => {
            if (chart && chart.canvas) { chart.setupCanvas(); if (chart.width) chart.render(); }
        });
    }, 250);
});

// =================== LAZY CHART RENDER ===================
const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const id = entry.target.id;
            if (id === 'dashChartCanvas' && dashChart) { dashChart.setupCanvas(); dashChart.render(); }
            if (id === 'donutCanvas' && donutChart) { donutChart.setupCanvas(); donutChart.render(); }
            if (id === 'historyChartCanvas' && historyChart) { historyChart.setupCanvas(); historyChart.render(); }
            if (id === 'serviceChartCanvas' && serviceChart) { serviceChart.setupCanvas(); serviceChart.render(); }
        }
    });
}, { threshold: 0.1 });

['dashChartCanvas', 'donutCanvas', 'historyChartCanvas', 'serviceChartCanvas'].forEach(id => {
    const el = $(id); if (el) chartObserver.observe(el);
});

// =================== ERROR HANDLER ===================
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled:', e.reason);
    if (e.reason?.message?.includes('Failed to fetch')) setSyncState('offline');
});

// Preconnect
const preconnect = document.createElement('link');
preconnect.rel = 'preconnect';
preconnect.href = WORKER_URL;
document.head.appendChild(preconnect);

// EOF
