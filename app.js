// ============================================================
// КОМУНАЛКА PWA v2.3 — Premium + Partial Save + Budget + Swipe
// ============================================================

const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
const APP_VERSION = '2.3.0';

const firebaseConfig = { apiKey: "AIzaSyBgRHmaHjg23BIZjJdCucwnmMFDX57XP80", authDomain: "pwakomun.firebaseapp.com", projectId: "pwakomun", storageBucket: "pwakomun.firebasestorage.app", messagingSenderId: "4437974770", appId: "1:4437974770:web:bf7d2f7bac35eff5707a6b" };
firebase.initializeApp(firebaseConfig);

// =================== SPLASH ===================
window.addEventListener('load', () => { setTimeout(() => { const s = $('splashScreen'); if (s) { s.style.opacity = '0'; setTimeout(() => s.remove(), 500); } }, 600); });

// =================== STATE ===================
let googleUser = null;
let sessionLogin = localStorage.getItem('k_login');
let sessionPass = localStorage.getItem('k_passHash');
let currentFilter = 'all';
let syncState = 'synced';

const defaultTariffs = { water: 30.38, hotWater: 100.00, electroBase: 4.32, electroWinter: 2.64, winterLimit: 2000, nightCoef: 0.5, gas: 7.96 };
const defaultPrefs = { showWater: true, showHotWater: false, showElectro: true, showGas: true, electroTwoZone: true, electroWinter: true, remindersEnabled: false, remWaterStart: 1, remWaterEnd: 5, remElectroStart: 28, remElectroEnd: 3 };
const defaultCustomServices = [{ id: "s1", name: "Квартплата", defaultSum: "" }, { id: "s2", name: "Сміття", defaultSum: "" }];

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

// =================== ACHIEVEMENTS ===================
const ACHIEVEMENTS = [
    { id: 'first_record', emoji: '🎉', title: 'Перший запис', desc: 'Зберегли перший розрахунок', check: (r) => r.length >= 1 },
    { id: 'streak_3', emoji: '🔥', title: '3 місяці поспіль', desc: 'Вносите показники 3 місяці без перерви', check: (r) => getStreak(r) >= 3 },
    { id: 'streak_6', emoji: '💪', title: 'Полугідник', desc: '6 місяців поспіль ведете облік', check: (r) => getStreak(r) >= 6 },
    { id: 'streak_12', emoji: '👑', title: 'Рік без перерви', desc: 'Цілий рік ведете облік!', check: (r) => getStreak(r) >= 12 },
    { id: 'all_paid', emoji: '✅', title: 'Чистий рахунок', desc: 'Все оплачено, немає боргів', check: (r) => r.length > 0 && r.every(rec => rec.paid) },
    { id: 'records_10', emoji: '📊', title: 'Аналітик', desc: '10+ записів в історії', check: (r) => r.length >= 10 },
    { id: 'saver', emoji: '💰', title: 'Економ', desc: 'Знизили витрати 3 місяці поспіль', check: (r) => checkSaverAchievement(r) },
    { id: 'multi_address', emoji: '🏘️', title: 'Мультивласник', desc: 'Додали 2+ адреси', check: () => addresses.length >= 2 },
];

const ACHIEVEMENT_HINTS = {
    'first_record': 'Збережіть свій перший розрахунок комунальних',
    'streak_3': 'Вносіть показники кожен місяць без пропуску протягом 3 місяців',
    'streak_6': 'Вносіть показники кожен місяць без пропуску протягом 6 місяців',
    'streak_12': 'Ведіть облік цілий рік без жодного пропуску',
    'all_paid': 'Позначте всі записи як "Оплачено"',
    'records_10': 'Накопичте 10 або більше записів в історії',
    'saver': 'Знижуйте загальну суму 3 місяці поспіль',
    'multi_address': 'Додайте другу адресу в налаштуваннях',
};

function getStreak(recs) {
    if (recs.length === 0) return 0;
    const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month));
    let streak = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
        const [y1, m1] = sorted[i].month.split('-').map(Number);
        const [y2, m2] = sorted[i + 1].month.split('-').map(Number);
        if ((y1 * 12 + m1) - (y2 * 12 + m2) === 1) streak++; else break;
    }
    return streak;
}

function checkSaverAchievement(recs) {
    if (recs.length < 4) return false;
    const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month));
    return sorted[0].total < sorted[1].total && sorted[1].total < sorted[2].total;
}

function getUnlockedAchievements() { return ACHIEVEMENTS.filter(a => a.check(records)); }

function checkNewAchievements() {
    const unlocked = JSON.parse(localStorage.getItem('achievements_unlocked') || '[]');
    const current = getUnlockedAchievements();
    const newOnes = current.filter(a => !unlocked.includes(a.id));
    if (newOnes.length > 0) { localStorage.setItem('achievements_unlocked', JSON.stringify(current.map(a => a.id))); showAchievementUnlock(newOnes[0]); }
}

function showAchievementUnlock(achievement) {
    const toast = $('achievementToast');
    $('achievementEmoji').textContent = achievement.emoji;
    $('achievementTitle').textContent = achievement.title;
    $('achievementDesc').textContent = achievement.desc;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.style.transform = 'translate(-50%,-50%) scale(1)'; toast.style.opacity = '1'; }, 10);
    haptic('success');
    setTimeout(() => { toast.style.transform = 'translate(-50%,-50%) scale(0)'; toast.style.opacity = '0'; setTimeout(() => toast.classList.add('hidden'), 400); }, 3000);
}

function renderAchievements() {
    const container = $('achievementsList'); if (!container) return;
    const unlocked = getUnlockedAchievements().map(a => a.id);
    container.innerHTML = ACHIEVEMENTS.map(a => `<div class="achievement ${unlocked.includes(a.id) ? '' : 'locked'} flex flex-col items-center gap-1 w-14 text-center cursor-pointer" data-ach-id="${a.id}"><span class="text-2xl">${a.emoji}</span><span class="text-[8px] font-bold text-slate-500 leading-tight">${a.title}</span></div>`).join('');
    container.querySelectorAll('[data-ach-id]').forEach(el => { el.addEventListener('click', () => showAchievementDetail(el.dataset.achId)); });
}

function showAchievementDetail(achId) {
    const ach = ACHIEVEMENTS.find(a => a.id === achId); if (!ach) return;
    const isUnlocked = ach.check(records);
    $('achDetailEmoji').textContent = ach.emoji;
    $('achDetailTitle').textContent = ach.title;
    $('achDetailDesc').textContent = ach.desc;
    $('achDetailHow').textContent = ACHIEVEMENT_HINTS[achId] || '—';
    const status = $('achDetailStatus');
    if (isUnlocked) { status.textContent = '✓ Отримано'; status.className = 'text-xs font-bold px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-600'; }
    else { status.textContent = '🔒 Заблоковано'; status.className = 'text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400'; }
    $('achievementDetailModal').classList.remove('hidden');
    haptic('light');
}

// =================== ONBOARDING ===================
let onboardingStep = 0;
function showOnboarding() { if (localStorage.getItem('onboarding_v2_done')) return; $('onboardingOverlay').classList.remove('hidden'); }
function updateOnboardingSlide() {
    const slides = document.querySelectorAll('.onboarding-slide');
    slides.forEach((s, i) => { s.style.transform = i === onboardingStep ? 'translateX(0)' : i < onboardingStep ? 'translateX(-100%)' : 'translateX(100%)'; s.style.opacity = i === onboardingStep ? '1' : '0'; });
    const dots = $('onboardingDots').children;
    for (let i = 0; i < dots.length; i++) dots[i].className = i === onboardingStep ? 'w-8 h-2 rounded-full bg-brand transition-all' : 'w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 transition-all';
    $('onboardingBtn').textContent = onboardingStep === 2 ? 'Почати! 🚀' : 'Далі';
}
function finishOnboarding() { localStorage.setItem('onboarding_v2_done', '1'); $('onboardingOverlay').classList.add('hidden'); }
$('onboardingBtn')?.addEventListener('click', () => { if (onboardingStep < 2) { onboardingStep++; updateOnboardingSlide(); } else finishOnboarding(); });
$('onboardingSkip')?.addEventListener('click', finishOnboarding);

// =================== SERVICE WORKER ===================
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(e => console.error('SW:', e)); }); }

// =================== UTILITIES ===================
let toastTimeout;
function showToast(msg, icon = '✅') { const t = $('toast'); $('toastMsg').innerText = msg; $('toastIcon').innerText = icon; t.classList.remove('-translate-y-24', 'opacity-0'); haptic(icon === '✅' ? 'success' : icon === '❌' || icon === '⚠️' ? 'error' : 'notification'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => t.classList.add('-translate-y-24', 'opacity-0'), 2500); }
function vibe(pattern = 10) { if (navigator.vibrate) navigator.vibrate(Array.isArray(pattern) ? pattern : [pattern]); }
const hapticPatterns = { light: [5], medium: [10], heavy: [20], success: [10, 50, 10], error: [50, 30, 50], notification: [15, 100, 15], tabSwitch: [3] };
function haptic(type) { vibe(hapticPatterns[type] || hapticPatterns.light); }
async function getHash(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }

// =================== SYNC ===================
function setSyncState(state) { syncState = state; const dot = $('syncDotHeader'); if (dot) dot.className = `sync-dot ${state}`; }
function saveToLocal() { try { localStorage.setItem('komynalka_backup', JSON.stringify({ addresses, currentAddressId, timestamp: Date.now() })); } catch (e) { } }
function loadFromLocal() { try { const b = localStorage.getItem('komynalka_backup'); return b ? JSON.parse(b) : null; } catch (e) { return null; } }

async function syncToCloud() {
    syncCurrentAddress(); saveToLocal();
    if (isGuest && urlShareToken) { await fetch(`${WORKER_URL}?share=${urlShareToken}`, { method: 'POST', body: JSON.stringify({ addresses }) }); return; }
    if (!sessionLogin && !localStorage.getItem('k_uid')) return;
    setSyncState('syncing');
    let url = WORKER_URL; const uid = localStorage.getItem('k_uid');
    if (uid) url += `?uid=${uid}`; else url += `?phone=${encodeURIComponent(sessionLogin)}&pass=${sessionPass}`;
    try { const res = await fetch(url, { method: 'POST', body: JSON.stringify({ addresses, currentAddressId }) }); const data = await res.json(); if (res.status === 403 || data.error === "WRONG_PASSWORD") logout(); setSyncState('synced'); }
    catch (e) { setSyncState('offline'); showToast('Збережено локально', '💾'); }
}
window.addEventListener('online', () => { showToast('Онлайн', '🌐'); syncToCloud(); });
window.addEventListener('offline', () => { setSyncState('offline'); showToast('Офлайн', '📴'); });

// =================== THEME ===================
let currentMode = localStorage.getItem('themeMode') || 'auto';
function setThemeMode(mode) { currentMode = mode; localStorage.setItem('themeMode', mode); applyThemeMode(); ['light', 'auto', 'dark'].forEach(m => { const b = $('mode-' + m); if (!b) return; b.classList.remove('bg-white', 'dark:bg-[#2c2c2e]', 'text-slate-900', 'dark:text-white', 'shadow-sm'); if (m === mode) b.classList.add('bg-white', 'dark:bg-[#2c2c2e]', 'text-slate-900', 'dark:text-white', 'shadow-sm'); }); }
function applyThemeMode() { const isDark = currentMode === 'dark' || (currentMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', isDark); $('metaThemeColor').setAttribute("content", isDark ? "#000000" : "#f2f2f7"); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (currentMode === 'auto') applyThemeMode(); });
setThemeMode(currentMode);

// =================== AUTH ===================
$('authForm').addEventListener('submit', async (e) => { e.preventDefault(); await performLogin($('authLogin').value.trim(), $('authPass').value, false); });
$('togglePassBtn').addEventListener('click', () => { const p = $('authPass'); const icon = $('passEyeIcon'); p.type = p.type === 'password' ? 'text' : 'password'; icon.className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'; });
$('googleAuthBtn').addEventListener('click', async () => { const provider = new firebase.auth.GoogleAuthProvider(); try { const result = await firebase.auth().signInWithPopup(provider); googleUser = result.user; await performLogin(null, null, false, googleUser.uid); } catch (e) { if (e.code !== 'auth/popup-closed-by-user') showToast("Помилка Google", "❌"); } });

async function performLogin(rawLogin, rawPass, isAlreadyHashed, uid = null) {
    const errEl = $('authError'); const spinner = $('authSpinner'); const btnText = $('authBtnText');
    errEl.classList.add('hidden'); btnText.textContent = "Завантаження..."; spinner.classList.remove('hidden');
    try {
        let url = `${WORKER_URL}?t=${Date.now()}`; let passHash = null;
        if (uid) { url += `&uid=${uid}`; } else { passHash = isAlreadyHashed ? rawPass : await getHash(rawPass); url += `&phone=${encodeURIComponent(rawLogin)}&pass=${passHash}`; }
        const res = await fetch(url, { cache: "no-store" }); const data = await res.json();
        if (res.status === 404 && uid) { $('linkModal').classList.remove('hidden'); btnText.textContent = "Увійти"; spinner.classList.add('hidden'); return; }
        if (res.status === 403 || data.error === "WRONG_PASSWORD") throw new Error("WRONG_PASSWORD");
        if (res.status === 404 || (!uid && !data.success)) { sessionLogin = rawLogin; sessionPass = passHash; addresses = [{ id: 'default', name: 'Мій дім', tariffs: { ...defaultTariffs }, prefs: { ...defaultPrefs }, records: [], customServices: [...defaultCustomServices] }]; currentAddressId = 'default'; await syncToCloud(); }
        else if (res.status === 200 && data.success) { if (data.data.addresses) { addresses = data.data.addresses; currentAddressId = data.data.currentAddressId || addresses[0].id; } else { addresses = [{ id: 'default', name: 'Мій дім', tariffs: data.data.tariffs || { ...defaultTariffs }, prefs: { ...defaultPrefs, ...(data.data.prefs || {}) }, records: data.data.records || [], customServices: data.data.customServices || [...defaultCustomServices] }]; currentAddressId = 'default'; } if (uid) { sessionLogin = data.linkedLogin || `uid_${uid}`; localStorage.setItem('k_uid', uid); } else { sessionLogin = rawLogin; sessionPass = passHash; } }
        if (!uid) { localStorage.setItem('k_login', sessionLogin); localStorage.setItem('k_passHash', sessionPass); }
        loadCurrentAddress(); if (records.length === 0) showOnboarding();
    } catch (err) { btnText.textContent = "Увійти"; spinner.classList.add('hidden'); errEl.innerText = err.message === "WRONG_PASSWORD" ? "Неправильний пароль!" : "Помилка: " + err.message; errEl.classList.remove('hidden'); }
}

// =================== LINK GOOGLE ===================
$('linkYesBtn').addEventListener('click', () => { const lgn = prompt("Логін:"); const pss = prompt("Пароль:"); if (lgn && pss) linkAccount(lgn, pss); });
$('linkNoBtn').addEventListener('click', async () => { $('linkModal').classList.add('hidden'); sessionLogin = `uid_${googleUser.uid}`; localStorage.setItem('k_uid', googleUser.uid); localStorage.setItem('k_login', sessionLogin); addresses = [{ id: 'default', name: 'Мій дім', tariffs: { ...defaultTariffs }, prefs: { ...defaultPrefs }, records: [], customServices: [...defaultCustomServices] }]; currentAddressId = 'default'; await syncToCloud(); loadCurrentAddress(); showToast("Акаунт створено!"); });
async function linkAccount(lgn, pss) { const passHash = await getHash(pss); const res = await fetch(WORKER_URL, { method: 'POST', body: JSON.stringify({ action: "link_google", login: lgn, pass: passHash, uid: googleUser.uid }) }); const data = await res.json(); if (data.success) { $('linkModal').classList.add('hidden'); showToast("Підв'язано!"); performLogin(null, null, false, googleUser.uid); } else alert("Помилка."); }
$('btnLinkGoogle')?.addEventListener('click', async () => { if (!sessionLogin) return alert("Спочатку увійдіть."); const provider = new firebase.auth.GoogleAuthProvider(); try { const result = await firebase.auth().signInWithPopup(provider); const uid = result.user.uid; const res = await fetch(WORKER_URL, { method: 'POST', body: JSON.stringify({ action: "link_google", login: sessionLogin, uid }) }); if ((await res.json()).success) { showToast("Google підв'язано!"); localStorage.setItem('k_uid', uid); updateGoogleButton(); } } catch (e) { showToast("Скасовано", "⚠️"); } });
function updateGoogleButton() { if (localStorage.getItem('k_uid') && $('btnLinkGoogle')) { $('btnLinkGoogle').innerHTML = '<i class="fa-solid fa-check mr-2"></i>Google підв\'язано'; $('btnLinkGoogle').className = 'w-full bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-green-600 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 pointer-events-none'; } }
// =================== ADDRESS MANAGEMENT ===================
function loadCurrentAddress() {
    if (!addresses || addresses.length === 0) { const backup = loadFromLocal(); if (backup) { addresses = backup.addresses || []; currentAddressId = backup.currentAddressId || 'default'; } }
    const addr = addresses.find(a => a.id === currentAddressId) || addresses[0];
    currentAddressId = addr.id;
    tariffs = { ...defaultTariffs, ...(addr.tariffs || {}) };
    prefs = { ...defaultPrefs, ...(addr.prefs || {}) };
    records = addr.records || [];
    customServices = addr.customServices || [...defaultCustomServices];
    $('currentAddressDisplay').innerText = addr.name + (isGuest ? ' (Гість)' : '');
    initAppUI();
}

function syncCurrentAddress() { const idx = addresses.findIndex(a => a.id === currentAddressId); if (idx >= 0) { addresses[idx].tariffs = tariffs; addresses[idx].prefs = prefs; addresses[idx].records = records; addresses[idx].customServices = customServices; } }

function openAddressModal() { $('addressModal').classList.remove('hidden'); setTimeout(() => $('addressModalContent').classList.remove('translate-y-full'), 10); renderAddressModal(); }
function closeAddressModal() { $('addressModalContent').classList.add('translate-y-full'); setTimeout(() => $('addressModal').classList.add('hidden'), 400); }
$('addressHeaderTrigger').addEventListener('click', openAddressModal);
$('closeAddressModalBtn').addEventListener('click', closeAddressModal);
$('addressModal').addEventListener('click', (e) => { if (e.target === $('addressModal')) closeAddressModal(); });

$('addAddressBtn').addEventListener('click', () => {
    const name = prompt("Назва об'єкту:"); if (name && name.trim()) { syncCurrentAddress(); const newId = 'addr_' + Date.now(); addresses.push({ id: newId, name: name.trim(), tariffs: { ...defaultTariffs }, prefs: { ...defaultPrefs }, records: [], customServices: [{ id: "s1", name: "Квартплата", defaultSum: "" }] }); currentAddressId = newId; loadCurrentAddress(); syncToCloud(); closeAddressModal(); showToast("Додано"); checkNewAchievements(); }
});

function renderAddressModal() {
    $('addressListModal').innerHTML = addresses.map(a => `<div class="flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-95 cursor-pointer ${a.id === currentAddressId ? 'bg-brand border-brand text-white shadow-lg shadow-brand/20' : 'bg-slate-50 dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'}" data-addr-id="${a.id}"><span class="font-bold text-lg truncate pr-2 flex-1">${a.name}</span><div class="flex gap-1.5 shrink-0"><button class="addr-edit p-2 rounded-xl shadow-sm ${a.id === currentAddressId ? 'bg-white/20 text-white' : 'bg-white dark:bg-[#2c2c2e] text-slate-400'}" data-id="${a.id}"><i class="fa-solid fa-pen"></i></button>${a.id !== currentAddressId && addresses.length > 1 ? `<button class="addr-del p-2 text-slate-400 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-sm" data-id="${a.id}"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div>`).join('');
    $('addressListModal').querySelectorAll('[data-addr-id]').forEach(el => { el.addEventListener('click', (e) => { if (e.target.closest('.addr-edit') || e.target.closest('.addr-del')) return; syncCurrentAddress(); currentAddressId = el.dataset.addrId; loadCurrentAddress(); syncToCloud(); closeAddressModal(); }); });
    $('addressListModal').querySelectorAll('.addr-edit').forEach(btn => { btn.addEventListener('click', (e) => { e.stopPropagation(); const addr = addresses.find(a => a.id === btn.dataset.id); const name = prompt("Нова назва:", addr.name); if (name && name.trim()) { addr.name = name.trim(); renderAddressModal(); if (btn.dataset.id === currentAddressId) $('currentAddressDisplay').innerText = addr.name; syncToCloud(); } }); });
    $('addressListModal').querySelectorAll('.addr-del').forEach(btn => { btn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm("Видалити?")) { addresses = addresses.filter(a => a.id !== btn.dataset.id); if (currentAddressId === btn.dataset.id) { currentAddressId = addresses[0].id; loadCurrentAddress(); } syncToCloud(); renderAddressModal(); } }); });
}

// =================== TAB SWITCHING ===================
const tabIds = ['tabDashboard', 'tabCalc', 'tabHistory', 'tabSettings'];
const btnIds = ['btnTabDashboard', 'btnTabCalc', 'btnTabHistory', 'btnTabSettings'];

function switchTab(tabId, index) {
    const activeTab = document.querySelector('.tab-active'); const targetTab = $(tabId);
    if (activeTab && activeTab !== targetTab) { activeTab.classList.add('tab-exit'); setTimeout(() => { activeTab.classList.remove('tab-active', 'tab-exit'); activeTab.classList.add('tab-hidden'); }, 150); }
    setTimeout(() => { targetTab.classList.remove('tab-hidden'); targetTab.classList.add('tab-active'); }, activeTab ? 80 : 0);
    btnIds.forEach((id, i) => { const btn = $(id); if(!btn) return; btn.classList.toggle('text-brand', i === index); btn.classList.toggle('text-slate-400', i !== index); btn.classList.toggle('dark:text-slate-500', i !== index); });
    if (tabId === 'tabDashboard') renderDashboard();
    if (tabId === 'tabCalc') { fillPreviousReadings(); calculatePreview(); updateSmartBadges(); }
    if (tabId === 'tabHistory') renderRecords();
    if (tabId === 'tabSettings') renderSettingsCustomServices();
    $('swipeContainer').scrollTo({ top: 0, behavior: 'smooth' }); haptic('tabSwitch');
}

$('btnTabDashboard')?.addEventListener('click', () => switchTab('tabDashboard', 0));
$('btnTabCalc')?.addEventListener('click', () => switchTab('tabCalc', 1));
$('btnTabHistory')?.addEventListener('click', () => switchTab('tabHistory', 2));
$('btnTabSettings')?.addEventListener('click', () => switchTab('tabSettings', 3));
$('dashAddBtn')?.addEventListener('click', () => switchTab('tabCalc', 1));
$('dashHistoryBtn')?.addEventListener('click', () => switchTab('tabHistory', 2));

let touchStartX = 0;
$('swipeContainer').addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
$('swipeContainer').addEventListener('touchend', e => { if (isGuest) return; const dist = touchStartX - e.changedTouches[0].screenX; const curIdx = tabIds.findIndex(id => $(id)?.classList.contains('tab-active')); if (dist > 70 && curIdx < tabIds.length - 1) switchTab(tabIds[curIdx + 1], curIdx + 1); else if (dist < -70 && curIdx > 0) switchTab(tabIds[curIdx - 1], curIdx - 1); }, { passive: true });

// =================== QUICK ACTIONS ===================
$('quickActionsBtn').addEventListener('click', () => $('quickActionsModal').classList.remove('hidden'));
$('qaExport').addEventListener('click', () => { exportCSV(); $('quickActionsModal').classList.add('hidden'); });
$('qaPdf').addEventListener('click', () => { generatePDF(); $('quickActionsModal').classList.add('hidden'); });
$('qaShare').addEventListener('click', () => { shareAllRecords(); $('quickActionsModal').classList.add('hidden'); });
$('qaSync').addEventListener('click', () => { syncToCloud(); showToast('Синхронізовано'); $('quickActionsModal').classList.add('hidden'); });

// =================== DASHBOARD ===================
function renderDashboard() {
    const streak = getStreak(records);
    if($('streakValue')) $('streakValue').textContent = `${streak} міс.`;
    renderStreakDots(streak);
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const curRec = records.find(r => r.month === curMonth);
    animateNumber($('dashCurrentMonth'), curRec ? curRec.total : 0);
    const unpaid = records.filter(r => !r.paid);
    const debtTotal = unpaid.reduce((s, r) => s + r.total, 0);
    if (unpaid.length > 0) { $('dashDebtCard')?.classList.remove('hidden'); $('dashNoDebtCard')?.classList.add('hidden'); animateNumber($('dashDebt'), debtTotal); if($('dashDebtMonths')) $('dashDebtMonths').textContent = `${unpaid.length} міс.`; $('debtBadge')?.classList.remove('hidden'); if($('debtBadge')) $('debtBadge').textContent = unpaid.length; }
    else { $('dashDebtCard')?.classList.add('hidden'); $('dashNoDebtCard')?.classList.remove('hidden'); $('debtBadge')?.classList.add('hidden'); }
    renderDashChart();
    if (records.length > 0) { const avg = records.reduce((s, r) => s + r.total, 0) / records.length; if($('dashAvg')) $('dashAvg').textContent = `~${fmt.format(avg)} ₴/міс`; }
    renderAchievements(); checkReminders(); renderMonthProgress();
}

function renderStreakDots(streak) { const container = $('streakDots'); if (!container) return; let html = ''; for (let i = 0; i < 6; i++) html += `<div class="streak-dot ${i < streak ? 'active' : 'inactive'} ${i === 0 ? 'today' : ''}"></div>`; container.innerHTML = html; }

function renderDashChart() {
    const container = $('dashChart'); if (!container) return;
    if (records.length === 0) { container.innerHTML = '<span class="text-xs text-slate-400 m-auto">Немає даних</span>'; return; }
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 6).reverse();
    const max = Math.max(...sorted.map(r => r.total), 1);
    container.innerHTML = sorted.map((r, i) => { const h = (r.total / max) * 100; const mName = new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3); const bg = r.paid ? 'var(--brand)' : 'linear-gradient(to top, #fb923c, #fcd34d)'; return `<div class="flex flex-col items-center flex-1 h-full justify-end"><div class="w-full rounded-t-lg bg-slate-100 dark:bg-white/5 overflow-hidden flex items-end" style="height:100%"><div class="w-full rounded-t-lg transition-all duration-700" style="height:${Math.max(6, h)}%;background:${bg};opacity:${0.5 + (i / 6) * 0.5}"></div></div><span class="text-[8px] text-slate-400 font-bold mt-1.5">${mName}</span></div>`; }).join('');
}

function animateNumber(el, target) {
    if (!el) return;
    const current = parseFloat(el.textContent.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    if (Math.abs(current - target) < 0.01) { el.textContent = fmt.format(target) + ' ₴'; return; }
    const duration = 400; const start = performance.now(); const from = current;
    function tick(now) { const elapsed = now - start; const progress = Math.min(elapsed / duration, 1); const eased = 1 - Math.pow(1 - progress, 3); const value = from + (target - from) * eased; el.textContent = fmt.format(value) + ' ₴'; if (progress < 1) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
}

// =================== MONTH PROGRESS & BUDGET ===================
function renderMonthProgress() {
    const now = new Date(); const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const curRec = records.find(r => r.month === curMonth);
    let totalServices = 0, filledServices = 0;
    if (prefs.showWater) { totalServices++; if (curRec?._filled?.water || curRec?.waterCost > 0) filledServices++; }
    if (prefs.showHotWater) { totalServices++; if (curRec?._filled?.hotWater || curRec?.hotWaterCost > 0) filledServices++; }
    if (prefs.showElectro) { totalServices++; if (curRec?._filled?.electro || curRec?.electroCost > 0) filledServices++; }
    if (prefs.showGas) { totalServices++; if (curRec?._filled?.gas || curRec?.gasCost > 0) filledServices++; }
    if (customServices.length > 0) { totalServices++; if (curRec?._filled?.custom || curRec?.customCost > 0) filledServices++; }
    const pct = totalServices > 0 ? Math.round((filledServices / totalServices) * 100) : 0;
    if ($('progressBar')) $('progressBar').style.width = pct + '%';
    if ($('progressPercent')) $('progressPercent').textContent = pct + '%';
    if ($('progressDetails')) $('progressDetails').textContent = `${filledServices} / ${totalServices} послуг`;
    const budget = parseFloat(localStorage.getItem('k_budget')) || 0;
    const budgetEl = $('budgetInfo');
    if (budgetEl) { if (budget > 0 && curRec) { const used = Math.round((curRec.total / budget) * 100); budgetEl.textContent = `${used}% бюджету`; budgetEl.className = `text-[9px] font-bold ${used > 100 ? 'text-red-500' : used > 80 ? 'text-orange-500' : 'text-green-500'}`; } else if (budget > 0) { budgetEl.textContent = `Бюджет: ${fmt.format(budget)} ₴`; budgetEl.className = 'text-[9px] text-slate-400 font-medium'; } else { budgetEl.textContent = ''; } }
}

// =================== CALCULATION ===================
const readingInputIds = ['wPrev', 'wCur', 'hwPrev', 'hwCur', 'dPrev', 'dCur', 'nPrev', 'nCur', 'gPrev', 'gCur'];
function getV(id) { return Math.max(0, parseFloat($(id)?.value) || 0); }

function calculatePreview() {
    if (prefs.showWater) currentCalc.waterCost = Math.max(0, getV('wCur') - getV('wPrev')) * tariffs.water; else currentCalc.waterCost = 0;
    if (prefs.showHotWater) currentCalc.hotWaterCost = Math.max(0, getV('hwCur') - getV('hwPrev')) * tariffs.hotWater; else currentCalc.hotWaterCost = 0;
    if (prefs.showElectro) { const dV = Math.max(0, getV('dCur') - getV('dPrev')); const nV = prefs.electroTwoZone ? Math.max(0, getV('nCur') - getV('nPrev')) : 0; const tEl = dV + nV; if (tEl === 0) currentCalc.electroCost = 0; else if (prefs.electroWinter && $('isWinterInput').checked) { if (tEl <= tariffs.winterLimit) currentCalc.electroCost = dV * tariffs.electroWinter + nV * tariffs.electroWinter * tariffs.nightCoef; else { const dp = dV / tEl, np = nV / tEl; currentCalc.electroCost = tariffs.winterLimit * dp * tariffs.electroWinter + tariffs.winterLimit * np * tariffs.electroWinter * tariffs.nightCoef + (tEl - tariffs.winterLimit) * dp * tariffs.electroBase + (tEl - tariffs.winterLimit) * np * tariffs.electroBase * tariffs.nightCoef; } } else currentCalc.electroCost = dV * tariffs.electroBase + nV * tariffs.electroBase * tariffs.nightCoef; } else currentCalc.electroCost = 0;
    if (prefs.showGas) currentCalc.gasCost = Math.max(0, getV('gCur') - getV('gPrev')) * tariffs.gas; else currentCalc.gasCost = 0;
    currentCalc.customCost = 0; customServices.forEach(srv => { let val = parseFloat($(`custom_${srv.id}`)?.value); if (isNaN(val) && srv.defaultSum) val = parseFloat(srv.defaultSum); if (!isNaN(val)) currentCalc.customCost += val; });
    currentCalc.total = currentCalc.waterCost + currentCalc.hotWaterCost + currentCalc.electroCost + currentCalc.gasCost + currentCalc.customCost;
    if (!validateReadingsUI()) return;
    $('heroTotal').innerHTML = `${fmt.format(currentCalc.total)} <span class="text-2xl font-bold text-white/40">₴</span>`;
    $('waterCostDisplay').innerText = fmt.format(currentCalc.waterCost) + ' ₴';
    $('hotWaterCostDisplay').innerText = fmt.format(currentCalc.hotWaterCost) + ' ₴';
    $('electroCostDisplay').innerText = fmt.format(currentCalc.electroCost) + ' ₴';
    $('gasCostDisplay').innerText = fmt.format(currentCalc.gasCost) + ' ₴';
    $('customCostDisplay').innerText = fmt.format(currentCalc.customCost) + ' ₴';
    updateMonthComparison(); updateSmartForecast(); updatePartialIndicator();
}

function validateReadingsUI() {
    const pairs = [['wPrev', 'wCur'], ['hwPrev', 'hwCur'], ['dPrev', 'dCur'], ['nPrev', 'nCur'], ['gPrev', 'gCur']]; let hasInvalid = false;
    pairs.forEach(([prevId, curId]) => { const prevEl = $(prevId), curEl = $(curId); if (!prevEl || !curEl || prevEl.offsetParent === null) return; const prevVal = parseFloat(prevEl.value || '0'); const curVal = parseFloat(curEl.value || '0'); const invalid = curEl.value !== '' && prevEl.value !== '' && curVal < prevVal; prevEl.classList.toggle('input-invalid', invalid); curEl.classList.toggle('input-invalid', invalid); if (invalid) hasInvalid = true; });
    const btn = $('submitFormBtn'); if (btn) { btn.disabled = hasInvalid; btn.classList.toggle('opacity-60', hasInvalid); }
    if (hasInvalid) $('heroTotal').innerHTML = `<span class="text-lg text-red-300">Перевірте показники</span>`;
    return !hasInvalid;
}

function updatePartialIndicator() { const w = $('partialWater'), e = $('partialElectro'), g = $('partialGas'); if (w) w.className = `partial-dot ${(getV('wCur') > 0 || getV('hwCur') > 0) ? 'filled' : 'empty'}`; if (e) e.className = `partial-dot ${getV('dCur') > 0 ? 'filled' : 'empty'}`; if (g) g.className = `partial-dot ${getV('gCur') > 0 ? 'filled' : 'empty'}`; }

function updateSmartBadges() {
    const update = (prevId, curId, badgeId, unit, color, activeBg) => { const badge = $(badgeId); if (!badge) return; const d = getV(curId) - getV(prevId); badge.innerText = d > 0 ? `+${d} ${unit}` : `0 ${unit}`; badge.className = d > 0 ? `absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 z-10 ${activeBg} ${color} shadow-md px-2.5 py-1.5 rounded-xl text-[11px] font-bold` : 'absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 z-10 bg-white dark:bg-apple-dark shadow-md border border-slate-100 dark:border-white/10 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-slate-400'; };
    if (prefs.showWater) update('wPrev', 'wCur', 'wDiffBadge', 'м³', 'text-blue-600', 'bg-blue-100 dark:bg-blue-500/20');
    if (prefs.showHotWater) update('hwPrev', 'hwCur', 'hwDiffBadge', 'м³', 'text-red-600', 'bg-red-100 dark:bg-red-500/20');
    if (prefs.showElectro) { update('dPrev', 'dCur', 'dDiffBadge', 'кВт', 'text-yellow-600', 'bg-yellow-100 dark:bg-yellow-500/20'); if (prefs.electroTwoZone) update('nPrev', 'nCur', 'nDiffBadge', 'кВт', 'text-indigo-500', 'bg-indigo-100 dark:bg-indigo-500/20'); }
    if (prefs.showGas) update('gPrev', 'gCur', 'gDiffBadge', 'м³', 'text-orange-500', 'bg-orange-100 dark:bg-orange-500/20');
}

function updateMonthComparison() {
    const comp = $('monthComparison'); if (!comp) return;
    if (records.length === 0 || currentCalc.total === 0) { comp.classList.add('hidden'); return; }
    const selectedMonth = $('monthInput')?.value; if (!selectedMonth) { comp.classList.add('hidden'); return; }
    const [sy, sm] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(sy, sm - 2);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevRec = records.find(r => r.month === prevMonth);
    if (!prevRec || prevRec.total === 0) { comp.classList.add('hidden'); return; }
    const diff = ((currentCalc.total - prevRec.total) / prevRec.total) * 100;
    comp.classList.remove('hidden');
    $('comparisonIcon').className = diff < 0 ? 'fa-solid fa-arrow-trend-down' : 'fa-solid fa-arrow-trend-up';
    $('comparisonText').textContent = `${diff > 0 ? '+' : ''}${Math.round(diff)}% vs ${new Date(prevMonth + '-01').toLocaleString('uk-UA', { month: 'short' })}`;
    comp.style.color = diff < 0 ? '#34c759' : diff > 5 ? '#ff3b30' : '#8e8e93';
}

function updateSmartForecast() {
    if (!records || records.length === 0) { $('smartForecast').innerText = "—"; return; }
    const selectedMonth = $('monthInput')?.value; if (!selectedMonth) { $('smartForecast').innerText = "—"; return; }
    const [, sm] = selectedMonth.split('-').map(Number);
    const sameMonthRecords = records.filter(r => { const [, rm] = r.month.split('-').map(Number); return rm === sm; });
    if (sameMonthRecords.length > 0) { const avg = sameMonthRecords.reduce((s, r) => s + r.total, 0) / sameMonthRecords.length; $('smartForecast').innerText = `~ ${fmt.format(avg)} ₴`; return; }
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month));
    const avg = sorted.slice(0, 3).reduce((s, r) => s + r.total, 0) / Math.min(3, sorted.length);
    $('smartForecast').innerText = `~ ${fmt.format(avg)} ₴`;
}

readingInputIds.forEach(id => { const el = $(id); if (el) el.addEventListener('input', () => { calculatePreview(); updateSmartBadges(); }); });
$('isWinterInput')?.addEventListener('change', calculatePreview);
$('monthInput')?.addEventListener('change', () => { fillPreviousReadings(); calculatePreview(); updateSmartBadges(); });
if ($('monthInput')) $('monthInput').value = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

// =================== DRAFT AUTO-SAVE ===================
const DRAFT_KEY = 'komunalka_draft';
function saveDraft() { const draft = { month: $('monthInput')?.value }; readingInputIds.forEach(id => { const el = $(id); if (el && el.value) draft[id] = el.value; }); customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && el.value) draft[`custom_${srv.id}`] = el.value; }); if ($('recordNote')?.value) draft.note = $('recordNote').value; if ($('isWinterInput')) draft.isWinter = $('isWinterInput').checked; localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
function loadDraft() { const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return; try { const draft = JSON.parse(raw); if (draft.month && draft.month === $('monthInput')?.value) { readingInputIds.forEach(id => { const el = $(id); if (el && draft[id]) el.value = draft[id]; }); customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && draft[`custom_${srv.id}`]) el.value = draft[`custom_${srv.id}`]; }); if ($('recordNote') && draft.note) $('recordNote').value = draft.note; if ($('isWinterInput') && draft.isWinter !== undefined) $('isWinterInput').checked = draft.isWinter; } } catch (e) {} }
function clearDraft() { localStorage.removeItem(DRAFT_KEY); }
let draftTimeout;
function debouncedDraft() { clearTimeout(draftTimeout); draftTimeout = setTimeout(saveDraft, 1000); }
readingInputIds.forEach(id => { $(id)?.addEventListener('input', debouncedDraft); });
document.addEventListener('input', (e) => { if (e.target.classList.contains('custom-srv-input') || e.target.id === 'recordNote') debouncedDraft(); });

// =================== FORM SUBMIT ===================
$('utilityForm').addEventListener('submit', (e) => {
    e.preventDefault(); if (!validateReadingsUI()) { showToast('Перевірте показники', '⚠️'); return; }
    const hasWater = prefs.showWater && (getV('wCur') > 0 || getV('wPrev') > 0);
    const hasHotWater = prefs.showHotWater && (getV('hwCur') > 0 || getV('hwPrev') > 0);
    const hasElectro = prefs.showElectro && (getV('dCur') > 0 || getV('dPrev') > 0 || getV('nCur') > 0);
    const hasGas = prefs.showGas && (getV('gCur') > 0 || getV('gPrev') > 0);
    const hasCustom = customServices.some(srv => { const v = parseFloat($(`custom_${srv.id}`)?.value); return !isNaN(v) && v > 0; });
    if (!hasWater && !hasHotWater && !hasElectro && !hasGas && !hasCustom) { showToast('Заповніть хоча б одну послугу', '⚠️'); return; }
    let cData = {}; customServices.forEach(srv => { let v = parseFloat($(`custom_${srv.id}`)?.value); if (isNaN(v) && srv.defaultSum) v = parseFloat(srv.defaultSum); if (!isNaN(v) && v > 0) cData[srv.id] = { name: srv.name, val: v }; });
    const month = $('monthInput').value; const existingIdx = records.findIndex(r => r.month === month);
    const newData = { id: Date.now(), month, wPrev: hasWater ? getV('wPrev') : 0, wCur: hasWater ? getV('wCur') : 0, hwPrev: hasHotWater ? getV('hwPrev') : 0, hwCur: hasHotWater ? getV('hwCur') : 0, dPrev: hasElectro ? getV('dPrev') : 0, dCur: hasElectro ? getV('dCur') : 0, nPrev: (hasElectro && prefs.electroTwoZone) ? getV('nPrev') : 0, nCur: (hasElectro && prefs.electroTwoZone) ? getV('nCur') : 0, gPrev: hasGas ? getV('gPrev') : 0, gCur: hasGas ? getV('gCur') : 0, customData: cData, note: $('recordNote').value.trim(), waterCost: hasWater ? currentCalc.waterCost : 0, hotWaterCost: hasHotWater ? currentCalc.hotWaterCost : 0, electroCost: hasElectro ? currentCalc.electroCost : 0, gasCost: hasGas ? currentCalc.gasCost : 0, customCost: currentCalc.customCost, total: currentCalc.total, paid: false, _filled: { water: hasWater, hotWater: hasHotWater, electro: hasElectro, gas: hasGas, custom: hasCustom } };

    if (existingIdx >= 0) {
        const existing = records[existingIdx]; const merged = { ...existing, ...newData, id: existing.id, paid: existing.paid };
        if (!hasWater && existing._filled?.water) { merged.wPrev = existing.wPrev; merged.wCur = existing.wCur; merged.waterCost = existing.waterCost; merged._filled.water = true; }
        if (!hasHotWater && existing._filled?.hotWater) { merged.hwPrev = existing.hwPrev; merged.hwCur = existing.hwCur; merged.hotWaterCost = existing.hotWaterCost; merged._filled.hotWater = true; }
        if (!hasElectro && existing._filled?.electro) { merged.dPrev = existing.dPrev; merged.dCur = existing.dCur; merged.nPrev = existing.nPrev; merged.nCur = existing.nCur; merged.electroCost = existing.electroCost; merged._filled.electro = true; }
        if (!hasGas && existing._filled?.gas) { merged.gPrev = existing.gPrev; merged.gCur = existing.gCur; merged.gasCost = existing.gasCost; merged._filled.gas = true; }
        if (!hasCustom && existing._filled?.custom) { merged.customData = { ...existing.customData, ...cData }; merged.customCost = existing.customCost; merged._filled.custom = true; } else if (hasCustom) { merged.customData = { ...(existing.customData || {}), ...cData }; }
        merged.total = (merged.waterCost || 0) + (merged.hotWaterCost || 0) + (merged.electroCost || 0) + (merged.gasCost || 0) + (merged.customCost || 0);
        merged.note = newData.note || existing.note; records[existingIdx] = merged; showToast("Оновлено! 🔄");
    } else { records.push(newData); showToast("Збережено! ✨"); }

    clearDraft();
    $('submitFormBtn').classList.add('save-btn-success'); setTimeout(() => $('submitFormBtn').classList.remove('save-btn-success'), 600);
    syncToCloud();
    const [y, m] = $('monthInput').value.split('-'); const nD = new Date(y, m);
    $('monthInput').value = `${nD.getFullYear()}-${String(nD.getMonth() + 1).padStart(2, '0')}`;
    fillPreviousReadings(); calculatePreview(); updateSmartBadges(); checkNewAchievements(); switchTab('tabDashboard', 0);
});

// =================== CLEAR ===================
$('btnClearFields')?.addEventListener('click', () => { readingInputIds.forEach(id => { const el = $(id); if (el) { el.value = ''; el.classList.remove('input-invalid'); } }); document.querySelectorAll('.custom-srv-input').forEach(el => el.value = ''); if ($('recordNote')) $('recordNote').value = ''; calculatePreview(); updateSmartBadges(); clearDraft(); showToast('Очищено', '🧼'); });

function fillPreviousReadings() {
    try {
        readingInputIds.forEach(id => { if($(id)) $(id).value = ''; }); document.querySelectorAll('.custom-srv-input').forEach(el => el.value = ''); if ($('recordNote')) $('recordNote').value = '';
        const selectedMonth = $('monthInput')?.value; if (!selectedMonth || records.length === 0) { loadDraft(); return; }
        const [sy, sm] = selectedMonth.split('-').map(Number); const prevDate = new Date(sy, sm - 2); const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const prevRecord = records.find(r => r.month === prevMonth);
        if (prevRecord) { if (prefs.showWater && prevRecord.wCur != null) $('wPrev').value = prevRecord.wCur; if (prefs.showHotWater && prevRecord.hwCur != null) $('hwPrev').value = prevRecord.hwCur; if (prefs.showElectro) { if (prevRecord.dCur != null) $('dPrev').value = prevRecord.dCur; if (prefs.electroTwoZone && prevRecord.nCur != null) $('nPrev').value = prevRecord.nCur; } if (prefs.showGas && prevRecord.gCur != null) $('gPrev').value = prevRecord.gCur; }
        const currentRecord = records.find(r => r.month === selectedMonth);
        if (currentRecord) { if (prefs.showWater) { if (currentRecord.wPrev != null) $('wPrev').value = currentRecord.wPrev; if (currentRecord.wCur != null) $('wCur').value = currentRecord.wCur; } if (prefs.showHotWater) { if (currentRecord.hwPrev != null) $('hwPrev').value = currentRecord.hwPrev; if (currentRecord.hwCur != null) $('hwCur').value = currentRecord.hwCur; } if (prefs.showElectro) { if (currentRecord.dPrev != null) $('dPrev').value = currentRecord.dPrev; if (currentRecord.dCur != null) $('dCur').value = currentRecord.dCur; if (prefs.electroTwoZone) { if (currentRecord.nPrev != null) $('nPrev').value = currentRecord.nPrev; if (currentRecord.nCur != null) $('nCur').value = currentRecord.nCur; } } if (prefs.showGas) { if (currentRecord.gPrev != null) $('gPrev').value = currentRecord.gPrev; if (currentRecord.gCur != null) $('gCur').value = currentRecord.gCur; } if (currentRecord.customData) { Object.keys(currentRecord.customData).forEach(srvId => { const el = $(`custom_${srvId}`); if (el) el.value = currentRecord.customData[srvId].val; }); } if ($('recordNote')) $('recordNote').value = currentRecord.note || ''; }
        else { customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && srv.defaultSum) el.value = srv.defaultSum; }); loadDraft(); }
        const m = new Date(selectedMonth + '-01').getMonth() + 1; if ($('isWinterInput')) $('isWinterInput').checked = m >= 10 || m <= 4;
    } catch(e) { console.error('fillPreviousReadings:', e); }
}
// =================== SETTINGS ===================
function updateServiceChartOptions() { const select = $('serviceChartSelect'); if (!select) return; const cur = select.value; select.innerHTML = ''; if (prefs.showWater) select.innerHTML += '<option value="water">💧 Вода</option>'; if (prefs.showHotWater) select.innerHTML += '<option value="hotWater">🌡️ Гар. Вода</option>'; if (prefs.showElectro) select.innerHTML += '<option value="electro">⚡ Світло</option>'; if (prefs.showGas) select.innerHTML += '<option value="gas">🔥 Газ</option>'; if (select.querySelector(`option[value="${cur}"]`)) select.value = cur; }

function applyPreferences() {
    if($('prefWater')) $('prefWater').checked = prefs.showWater; if($('prefHotWater')) $('prefHotWater').checked = prefs.showHotWater; if($('prefElectro')) $('prefElectro').checked = prefs.showElectro; if($('prefGas')) $('prefGas').checked = prefs.showGas; if($('prefElectroTwoZone')) $('prefElectroTwoZone').checked = prefs.electroTwoZone; if($('prefElectroWinter')) $('prefElectroWinter').checked = prefs.electroWinter;
    if($('prefReminders')) { $('prefReminders').checked = prefs.remindersEnabled; $('remindersSettings').style.display = prefs.remindersEnabled ? 'block' : 'none'; }
    if($('remWaterStart')) $('remWaterStart').value = prefs.remWaterStart || 1; if($('remWaterEnd')) $('remWaterEnd').value = prefs.remWaterEnd || 5; if($('remElectroStart')) $('remElectroStart').value = prefs.remElectroStart || 28; if($('remElectroEnd')) $('remElectroEnd').value = prefs.remElectroEnd || 3;
    $('blockWater').style.display = prefs.showWater ? 'block' : 'none'; $('blockHotWater').style.display = prefs.showHotWater ? 'block' : 'none';
    if($('settingHotWaterWrap')) $('settingHotWaterWrap').style.display = prefs.showHotWater ? 'flex' : 'none';
    $('blockElectro').style.display = prefs.showElectro ? 'block' : 'none'; $('blockGas').style.display = prefs.showGas ? 'block' : 'none';
    $('blockCustomServices').style.display = customServices.length > 0 ? 'block' : 'none';
    if (prefs.electroTwoZone) { $('electroNightRow').style.display = 'flex'; $('lblDay1').innerText = "(День)"; $('lblDay2').innerText = "(День)"; } else { $('electroNightRow').style.display = 'none'; $('lblDay1').innerText = ""; $('lblDay2').innerText = ""; }
    if($('winterCheckboxWrapper')) $('winterCheckboxWrapper').style.display = prefs.electroWinter ? 'flex' : 'none';
    if($('settingElectroWinterWrap')) $('settingElectroWinterWrap').style.display = prefs.electroWinter ? 'flex' : 'none';
    updateServiceChartOptions();
}

['prefWater', 'prefHotWater', 'prefElectro', 'prefGas', 'prefElectroTwoZone', 'prefElectroWinter'].forEach(id => { $(id)?.addEventListener('change', () => { prefs.showWater = $('prefWater')?.checked ?? prefs.showWater; prefs.showHotWater = $('prefHotWater')?.checked ?? prefs.showHotWater; prefs.showElectro = $('prefElectro')?.checked ?? prefs.showElectro; prefs.showGas = $('prefGas')?.checked ?? prefs.showGas; prefs.electroTwoZone = $('prefElectroTwoZone')?.checked ?? prefs.electroTwoZone; prefs.electroWinter = $('prefElectroWinter')?.checked ?? prefs.electroWinter; applyPreferences(); renderCalcCustomServices(); calculatePreview(); updateSmartBadges(); }); });
$('prefReminders')?.addEventListener('change', function () { if($('remindersSettings')) $('remindersSettings').style.display = this.checked ? 'block' : 'none'; });

$('saveSettingsBtn')?.addEventListener('click', () => {
    tariffs = { water: parseFloat($('tWater')?.value) || defaultTariffs.water, hotWater: parseFloat($('tHotWater')?.value) || defaultTariffs.hotWater, electroBase: parseFloat($('tElectroBase')?.value) || defaultTariffs.electroBase, electroWinter: parseFloat($('tElectroWinter')?.value) || defaultTariffs.electroWinter, winterLimit: 2000, nightCoef: 0.5, gas: parseFloat($('tGas')?.value) || defaultTariffs.gas };
    prefs = { showWater: $('prefWater')?.checked, showHotWater: $('prefHotWater')?.checked, showElectro: $('prefElectro')?.checked, showGas: $('prefGas')?.checked, electroTwoZone: $('prefElectroTwoZone')?.checked, electroWinter: $('prefElectroWinter')?.checked, remindersEnabled: $('prefReminders')?.checked, remWaterStart: parseInt($('remWaterStart')?.value) || 1, remWaterEnd: parseInt($('remWaterEnd')?.value) || 5, remElectroStart: parseInt($('remElectroStart')?.value) || 28, remElectroEnd: parseInt($('remElectroEnd')?.value) || 3 };
    customServices = customServices.filter(s => s.name.trim() !== "");
    localStorage.setItem('k_budget', $('budgetInput')?.value || '0');
    syncToCloud(); applyPreferences(); renderCalcCustomServices(); calculatePreview(); updateSmartBadges(); checkReminders(); showToast("Збережено ✓");
});

// =================== CUSTOM SERVICES ===================
function renderSettingsCustomServices() { const list = $('customServicesSettingsList'); if(!list) return; list.innerHTML = customServices.map((srv, i) => `<div class="flex gap-2 items-center bg-slate-50 dark:bg-black/50 p-2.5 rounded-2xl border border-slate-100 dark:border-white/5"><input type="text" value="${srv.name}" data-idx="${i}" data-field="name" placeholder="Назва" class="cs-setting-input flex-1 bg-white dark:bg-[#2c2c2e] rounded-xl text-sm font-bold outline-none px-3 py-3 border border-transparent focus:border-brand transition-colors"><input type="number" step="0.01" value="${srv.defaultSum}" data-idx="${i}" data-field="sum" placeholder="₴" class="cs-setting-input w-20 bg-white dark:bg-[#2c2c2e] rounded-xl text-sm font-bold outline-none px-2 py-3 text-center border border-transparent focus:border-brand transition-colors"><button type="button" class="cs-del p-3 text-slate-400 hover:text-red-500 bg-white dark:bg-[#2c2c2e] rounded-xl transition-colors" data-idx="${i}"><i class="fa-solid fa-trash"></i></button></div>`).join(''); list.querySelectorAll('.cs-setting-input').forEach(input => { input.addEventListener('change', () => { const idx = parseInt(input.dataset.idx); if (input.dataset.field === 'name') customServices[idx].name = input.value; else customServices[idx].defaultSum = input.value; }); }); list.querySelectorAll('.cs-del').forEach(btn => { btn.addEventListener('click', () => { customServices.splice(parseInt(btn.dataset.idx), 1); renderSettingsCustomServices(); }); }); }
$('addCustomServiceBtn')?.addEventListener('click', () => { customServices.push({ id: 's' + Date.now(), name: "", defaultSum: "" }); renderSettingsCustomServices(); });

function renderCalcCustomServices() { const c = $('customServicesContainer'); if(!c) return; if (customServices.length === 0) { c.innerHTML = ''; return; } c.innerHTML = customServices.map(srv => `<div class="flex flex-col bg-slate-50 dark:bg-black/40 rounded-2xl p-3 border border-slate-100 dark:border-white/5"><span class="block text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate mb-1.5 text-center">${srv.name || 'Послуга'}</span><input type="number" step="0.01" id="custom_${srv.id}" class="custom-srv-input premium-input w-full bg-white dark:bg-[#2c2c2e] p-2.5 rounded-xl text-center text-lg font-black outline-none border border-slate-200 dark:border-white/10" placeholder="${srv.defaultSum || '0.00'}"></div>`).join(''); document.querySelectorAll('.custom-srv-input').forEach(input => input.addEventListener('input', calculatePreview)); }

// =================== REMINDERS ===================
function checkReminders() { const monthKey = new Date().getFullYear() + '-' + new Date().getMonth(); if (!prefs.remindersEnabled || localStorage.getItem('lastSubmittedMonth') === monthKey) { $('reminderBanner')?.classList.add('hidden'); return; } const d = new Date().getDate(); let msgs = []; const wS = prefs.remWaterStart || 1, wE = prefs.remWaterEnd || 5, eS = prefs.remElectroStart || 28, eE = prefs.remElectroEnd || 3; const isW = wS <= wE ? (d >= wS && d <= wE) : (d >= wS || d <= wE); const isE = eS <= eE ? (d >= eS && d <= eE) : (d >= eS || d <= eE); if (isW && (prefs.showWater || prefs.showHotWater)) msgs.push("💧 Воду"); if (isE && prefs.showElectro) msgs.push("⚡️ Світло"); if (msgs.length > 0) { $('reminderBanner')?.classList.remove('hidden'); if($('reminderText')) $('reminderText').innerText = "Передайте: " + msgs.join(" та "); } else $('reminderBanner')?.classList.add('hidden'); }
$('reminderDismissBtn')?.addEventListener('click', () => { localStorage.setItem('lastSubmittedMonth', new Date().getFullYear() + '-' + new Date().getMonth()); $('reminderBanner')?.classList.add('hidden'); showToast("Нагадаємо наступного місяця", "🔔"); });

// =================== CHANGE PASSWORD ===================
$('changePassBtn')?.addEventListener('click', async () => { const oldPass = prompt("Поточний:"); if (!oldPass) return; const newPass = prompt("Новий (мін 4):"); if (!newPass || newPass.length < 4) return showToast("Мін 4", "⚠️"); if (newPass !== prompt("Підтвердіть:")) return showToast("Не збігаються", "❌"); try { const oldHash = await getHash(oldPass); const newHash = await getHash(newPass); const res = await fetch(WORKER_URL, { method: 'POST', body: JSON.stringify({ action: "change_password", login: sessionLogin, oldPass: oldHash, newPass: newHash }) }); if ((await res.json()).success) { sessionPass = newHash; localStorage.setItem('k_passHash', newHash); showToast("Змінено!", "✅"); } else showToast("Неправильний пароль", "❌"); } catch (e) { showToast("Помилка", "❌"); } });

// =================== SWIPE GESTURES ===================
function initSwipe(card, index) {
    let startX = 0, currentX = 0, isSwiping = false; const threshold = 80;
    card.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isSwiping = true; card.classList.add('swiping'); }, { passive: true });
    card.addEventListener('touchmove', (e) => { if (!isSwiping) return; currentX = e.touches[0].clientX - startX; const limited = Math.sign(currentX) * Math.min(Math.abs(currentX), 120); card.style.transform = `translateX(${limited}px)`; const leftBg = card.querySelector('.swipe-bg-left'); const rightBg = card.querySelector('.swipe-bg-right'); if (leftBg) leftBg.style.opacity = currentX < -30 ? '1' : '0'; if (rightBg) rightBg.style.opacity = currentX > 30 ? '1' : '0'; }, { passive: true });
    card.addEventListener('touchend', () => { isSwiping = false; card.classList.remove('swiping'); card.style.transform = ''; const leftBg = card.querySelector('.swipe-bg-left'); const rightBg = card.querySelector('.swipe-bg-right'); if (leftBg) leftBg.style.opacity = '0'; if (rightBg) rightBg.style.opacity = '0'; if (currentX < -threshold) { card.style.transform = 'translateX(-100%)'; card.style.opacity = '0'; setTimeout(() => deleteRecord(index), 300); } else if (currentX > threshold) { card.style.transform = 'translateX(100%)'; card.style.opacity = '0'; setTimeout(() => togglePaid(index), 300); } currentX = 0; }, { passive: true });
}

// =================== HISTORY & RECORDS ===================
function renderRecords() {
    const list = $('recordsList'); if (!list) return;
    if (records.length === 0) { list.innerHTML = `<div class="text-center py-12"><i class="fa-solid fa-clock-rotate-left text-4xl text-slate-300 dark:text-slate-600 mb-4"></i><p class="text-slate-500 font-medium">Ще немає записів</p><p class="text-slate-400 text-sm mt-1">Додайте перший розрахунок</p></div>`; if($('statsAvg')) $('statsAvg').innerText = '0 ₴'; if($('statsTotalPaid')) $('statsTotalPaid').innerText = '0 ₴'; if($('statsMin')) $('statsMin').innerText = '0 ₴'; if($('statsMax')) $('statsMax').innerText = '0 ₴'; if($('statsCount')) $('statsCount').innerText = '0'; if($('chartContainer')) $('chartContainer').innerHTML = '<span class="text-xs text-slate-400 m-auto">Немає даних</span>'; renderServiceChart(); return; }
    const totals = records.map(r => r.total);
    if($('statsAvg')) $('statsAvg').innerText = fmt.format(totals.reduce((a, b) => a + b, 0) / totals.length) + ' ₴';
    if($('statsTotalPaid')) $('statsTotalPaid').innerText = fmt.format(records.filter(r => r.paid).reduce((s, r) => s + r.total, 0)) + ' ₴';
    if($('statsMin')) $('statsMin').innerText = fmt.format(Math.min(...totals)) + ' ₴'; if($('statsMax')) $('statsMax').innerText = fmt.format(Math.max(...totals)) + ' ₴'; if($('statsCount')) $('statsCount').innerText = records.length;
    let sorted = [...records]; const sortVal = $('sortSelect')?.value || 'date-desc';
    switch (sortVal) { case 'date-desc': sorted.sort((a, b) => new Date(b.month) - new Date(a.month)); break; case 'date-asc': sorted.sort((a, b) => new Date(a.month) - new Date(b.month)); break; case 'amount-desc': sorted.sort((a, b) => b.total - a.total); break; case 'amount-asc': sorted.sort((a, b) => a.total - b.total); break; }
    if (currentFilter === 'paid') sorted = sorted.filter(r => r.paid); else if (currentFilter === 'unpaid') sorted = sorted.filter(r => !r.paid);
    const search = $('searchRecords')?.value?.toLowerCase() || ''; if (search) sorted = sorted.filter(r => new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' }).toLowerCase().includes(search) || r.month.includes(search));
    renderChart([...records].sort((a, b) => new Date(b.month) - new Date(a.month))); renderServiceChart();
    list.innerHTML = ''; if (sorted.length === 0) { list.innerHTML = `<div class="text-center py-8"><p class="text-slate-400 font-medium">Нічого не знайдено</p></div>`; return; }
    let lastYear = null; sorted.forEach((rec) => { const idx = records.indexOf(rec); const yr = rec.month.split('-')[0]; if (yr !== lastYear) { lastYear = yr; const h = document.createElement('div'); h.className = "flex items-center gap-4 mt-6 mb-3"; h.innerHTML = `<h2 class="text-lg font-black text-slate-300 dark:text-slate-600">${yr}</h2><div class="h-[1px] flex-1 bg-slate-200 dark:bg-white/5"></div>`; list.appendChild(h); } list.appendChild(createRecordCard(rec, idx)); });
}

function createRecordCard(rec, index) {
    const card = document.createElement('div');
    card.className = `premium-card swipe-card p-5 relative overflow-hidden cursor-pointer select-none ${rec.paid ? '' : 'ring-1 ring-orange-400/20'}`;
    const dStr = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long' });
    const [rY, rM] = rec.month.split('-');
    const filledServices = []; if (rec._filled?.water || rec.waterCost > 0) filledServices.push('💧'); if (rec._filled?.hotWater || rec.hotWaterCost > 0) filledServices.push('🌡️'); if (rec._filled?.electro || rec.electroCost > 0) filledServices.push('⚡'); if (rec._filled?.gas || rec.gasCost > 0) filledServices.push('🔥'); if (rec._filled?.custom || rec.customCost > 0) filledServices.push('📦');
    const totalExpected = (prefs.showWater ? 1 : 0) + (prefs.showHotWater ? 1 : 0) + (prefs.showElectro ? 1 : 0) + (prefs.showGas ? 1 : 0) + (customServices.length > 0 ? 1 : 0);
    const isPartial = filledServices.length < totalExpected && filledServices.length > 0;
    const partialBadge = isPartial ? `<span class="text-[9px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-md ml-2">Частково</span>` : '';
    const prevYR = records.find(r => r.month === (parseInt(rY) - 1) + '-' + rM); let yoy = '';
    if (prevYR && prevYR.total > 0 && rec.total > 0) { const p = Math.round(((rec.total - prevYR.total) / prevYR.total) * 100); if (p < 0) yoy = `<span class="text-[9px] font-bold text-green-600 bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-md ml-2">↓${p}%</span>`; else if (p > 0) yoy = `<span class="text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-md ml-2">↑+${p}%</span>`; }
    const pW = rec.total > 0 ? ((rec.waterCost || 0) / rec.total) * 100 : 0; const pHW = rec.total > 0 ? ((rec.hotWaterCost || 0) / rec.total) * 100 : 0; const pE = rec.total > 0 ? ((rec.electroCost || 0) / rec.total) * 100 : 0; const pG = rec.total > 0 ? ((rec.gasCost || 0) / rec.total) * 100 : 0;
    const conic = `conic-gradient(#3b82f6 0% ${pW}%,#ef4444 ${pW}% ${pW+pHW}%,#eab308 ${pW+pHW}% ${pW+pHW+pE}%,#f97316 ${pW+pHW+pE}% ${pW+pHW+pE+pG}%,#a855f7 ${pW+pHW+pE+pG}% 100%)`;

    card.innerHTML = `${!rec.paid ? '<div class="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-orange-400/15 to-transparent rounded-bl-[4rem]"></div>' : ''}
        <div class="flex justify-between items-center relative z-10" onclick="toggleDetails(${index})"><div><h4 class="font-bold text-xl capitalize text-slate-900 dark:text-white mb-1.5">${dStr}</h4><div class="flex items-center flex-wrap gap-1"><span class="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${rec.paid ? 'bg-brand-light text-brand' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'}">${rec.paid ? 'Оплачено' : 'Борг'}</span>${partialBadge}${yoy}</div></div><div class="flex items-center gap-3"><span class="font-black text-2xl text-slate-900 dark:text-white">${fmt.format(rec.total)} ₴</span><div class="w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-white/5 rounded-full text-slate-400"><i id="chevron-${index}" class="fa-solid fa-chevron-down transition-transform duration-300"></i></div></div></div>
        <div id="details-${index}" class="hidden" onclick="event.stopPropagation()">
            <div class="border-t border-slate-100 dark:border-white/5 pt-5 mt-5">
                ${rec.total > 0 ? `<div class="flex items-center gap-4 bg-slate-50 dark:bg-black/50 p-4 rounded-2xl border border-slate-100 dark:border-white/5 mb-5"><div class="w-14 h-14 rounded-full shrink-0 shadow-sm border border-slate-200 dark:border-white/10" style="background:${conic}"></div><div class="flex flex-col gap-1 text-[10px] font-bold text-slate-500 w-full">${pW>0?`<div class="flex justify-between"><span>💧 Вода</span><span>${Math.round(pW)}%</span></div>`:''}${pHW>0?`<div class="flex justify-between"><span>🌡️ Гар.</span><span>${Math.round(pHW)}%</span></div>`:''}${pE>0?`<div class="flex justify-between"><span>⚡ Світло</span><span>${Math.round(pE)}%</span></div>`:''}${pG>0?`<div class="flex justify-between"><span>🔥 Газ</span><span>${Math.round(pG)}%</span></div>`:''}${(100-pW-pHW-pE-pG)>1?`<div class="flex justify-between"><span>📦 Інше</span><span>${Math.round(100-pW-pHW-pE-pG)}%</span></div>`:''}</div></div>` : ''}
                <div class="space-y-3">
                    ${rec.waterCost > 0 ? `<div class="flex justify-between"><span class="font-bold">💧 Вода</span><span class="font-black">${fmt.format(rec.waterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.wPrev}→${rec.wCur}</span><span class="text-blue-500">+${rec.wCur-rec.wPrev} м³</span></div>` : ''}
                    ${rec.hotWaterCost > 0 ? `<div class="flex justify-between"><span class="font-bold">🌡️ Гар.</span><span class="font-black">${fmt.format(rec.hotWaterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.hwPrev}→${rec.hwCur}</span><span class="text-red-500">+${rec.hwCur-rec.hwPrev} м³</span></div>` : ''}
                    ${rec.electroCost > 0 ? `<div class="flex justify-between"><span class="font-bold">⚡ Світло</span><span class="font-black">${fmt.format(rec.electroCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>Д:${rec.dPrev}→${rec.dCur}</span><span class="text-yellow-600">+${rec.dCur-rec.dPrev}</span></div>${(rec.nCur||rec.nPrev)?`<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl mt-1"><span>Н:${rec.nPrev}→${rec.nCur}</span><span class="text-indigo-500">+${rec.nCur-rec.nPrev}</span></div>`:''}` : ''}
                    ${rec.gasCost > 0 ? `<div class="flex justify-between"><span class="font-bold">🔥 Газ</span><span class="font-black">${fmt.format(rec.gasCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.gPrev}→${rec.gCur}</span><span class="text-orange-500">+${rec.gCur-rec.gPrev} м³</span></div>` : ''}
                    ${rec.customCost > 0 ? `<div class="flex justify-between"><span class="font-bold">📦 Інше</span><span class="font-black">${fmt.format(rec.customCost)} ₴</span></div>${rec.customData ? Object.values(rec.customData).filter(s=>s.val>0).map(s=>`<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${s.name}</span><span class="text-purple-500">${fmt.format(s.val)} ₴</span></div>`).join('') : ''}` : ''}
                    ${rec.note ? `<div class="mt-3 p-3 bg-slate-50 dark:bg-black/50 rounded-xl text-xs text-slate-500 italic"><i class="fa-solid fa-sticky-note mr-1"></i>${rec.note}</div>` : ''}
                </div>
            </div>
            <div class="flex gap-2.5 mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
                <button type="button" class="rec-pay flex-1 py-3.5 rounded-2xl font-bold text-xs border active:scale-[0.96] transition-all ${rec.paid ? 'bg-slate-50 dark:bg-[#2c2c2e] text-slate-500 border-slate-200 dark:border-white/10' : 'bg-gradient-to-r from-brand to-blue-600 text-white shadow-lg border-brand'}" data-idx="${index}">${rec.paid ? '↩ Скасувати' : '✓ Оплачено'}</button>
                <button type="button" class="rec-share w-12 bg-blue-50 dark:bg-blue-500/10 rounded-2xl text-blue-500 active:scale-[0.90] transition-transform" data-idx="${index}"><i class="fa-solid fa-share-nodes"></i></button>
                <button type="button" class="rec-edit w-12 bg-slate-50 dark:bg-white/5 rounded-2xl text-slate-400 active:scale-[0.90] transition-transform" data-idx="${index}"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="rec-del w-12 bg-red-50 dark:bg-red-500/10 rounded-2xl text-red-400 active:scale-[0.90] transition-transform" data-idx="${index}"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;

    // Swipe backgrounds
    const swipeBgLeft = document.createElement('div'); swipeBgLeft.className = 'swipe-bg-left'; swipeBgLeft.innerHTML = '<i class="fa-solid fa-trash mr-2"></i>Видалити';
    const swipeBgRight = document.createElement('div'); swipeBgRight.className = 'swipe-bg-right'; swipeBgRight.innerHTML = `<i class="fa-solid fa-${rec.paid ? 'rotate-left' : 'check'} mr-2"></i>${rec.paid ? 'Скасувати' : 'Оплачено'}`;
    card.insertBefore(swipeBgLeft, card.firstChild); card.insertBefore(swipeBgRight, card.firstChild);
    initSwipe(card, index);

    setTimeout(() => { card.querySelector('.rec-pay')?.addEventListener('click', (e) => { e.stopPropagation(); togglePaid(index); }); card.querySelector('.rec-share')?.addEventListener('click', (e) => { e.stopPropagation(); shareRecord(index); }); card.querySelector('.rec-edit')?.addEventListener('click', (e) => { e.stopPropagation(); editRecord(index); }); card.querySelector('.rec-del')?.addEventListener('click', (e) => { e.stopPropagation(); deleteRecord(index); }); }, 0);
    return card;
}

window.toggleDetails = function (index) { const el = $(`details-${index}`); const ch = $(`chevron-${index}`); if (el.classList.contains('hidden')) { el.classList.remove('hidden'); ch.style.transform = 'rotate(180deg)'; } else { el.classList.add('hidden'); ch.style.transform = 'rotate(0deg)'; } };
function togglePaid(index) { records[index].paid = !records[index].paid; renderRecords(); renderDashboard(); syncToCloud(); checkNewAchievements(); }

async function shareRecord(index) { const r = records[index]; const dStr = new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' }); let txt = `🧾 Комуналка за ${dStr}\n📍 ${$('currentAddressDisplay').innerText}\n──────────\n`; if (r.waterCost > 0) txt += `💧 Вода: ${fmt.format(r.waterCost)} ₴\n`; if (r.hotWaterCost > 0) txt += `🌡️ Гар.: ${fmt.format(r.hotWaterCost)} ₴\n`; if (r.electroCost > 0) txt += `⚡ Світло: ${fmt.format(r.electroCost)} ₴\n`; if (r.gasCost > 0) txt += `🔥 Газ: ${fmt.format(r.gasCost)} ₴\n`; if (r.customCost > 0) txt += `📦 Інше: ${fmt.format(r.customCost)} ₴\n`; txt += `──────────\n💰 Всього: ${fmt.format(r.total)} ₴\n${r.paid ? '✅ Оплачено' : '⏳ Очікує'}`; if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) {} } try { await navigator.clipboard.writeText(txt); showToast("Скопійовано!", "📋"); } catch (e) { prompt(":", txt); } }

function editRecord(index) { const rec = records[index]; $('monthInput').value = rec.month; if (prefs.showWater) { $('wPrev').value = rec.wPrev||''; $('wCur').value = rec.wCur||''; } if (prefs.showHotWater) { $('hwPrev').value = rec.hwPrev||''; $('hwCur').value = rec.hwCur||''; } if (prefs.showElectro) { $('dPrev').value = rec.dPrev||''; $('dCur').value = rec.dCur||''; $('nPrev').value = rec.nPrev||''; $('nCur').value = rec.nCur||''; } if (prefs.showGas) { $('gPrev').value = rec.gPrev||''; $('gCur').value = rec.gCur||''; } if (rec.customData) Object.keys(rec.customData).forEach(id => { const el = $(`custom_${id}`); if(el) el.value = rec.customData[id].val; }); if($('recordNote')) $('recordNote').value = rec.note || ''; const m = new Date(rec.month + '-01').getMonth() + 1; $('isWinterInput').checked = m >= 10 || m <= 4; switchTab('tabCalc', 1); calculatePreview(); updateSmartBadges(); }

function deleteRecord(index) { if (confirm('Видалити запис?')) { records.splice(index, 1); renderRecords(); renderDashboard(); syncToCloud(); showToast('Видалено', '🗑'); } }

// =================== CHARTS ===================
function renderChart(sortedRecords) { const container = $('chartContainer'); if(!container) return; const recent = sortedRecords.slice(0, 6).reverse(); if (!recent.length) { container.innerHTML = '<span class="text-sm text-slate-400 m-auto">Немає даних</span>'; return; } const max = Math.max(...recent.map(r => r.total)); let html = ''; const empty = 6 - recent.length; for (let i = 0; i < empty; i++) html += `<div class="flex flex-col items-center flex-1 opacity-0"><div class="w-full h-full"></div></div>`; html += recent.map(r => { const h = max > 0 ? (r.total / max) * 100 : 0; const mName = new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3); const bg = r.paid ? 'var(--brand)' : 'linear-gradient(to top, #fb923c, #fcd34d)'; return `<div class="flex flex-col items-center flex-1 h-full justify-end px-1"><div class="w-full flex items-end justify-center rounded-t-lg bg-slate-100 dark:bg-white/5 overflow-hidden" style="height:100%"><div class="w-full rounded-t-lg transition-all duration-1000" style="height:${Math.max(4, h)}%;background:${bg}"></div></div><span class="text-[9px] text-slate-500 font-bold mt-2">${mName}</span></div>`; }).join(''); container.innerHTML = html; }

function renderServiceChart() { const container = $('serviceChartContainer'); const summary = $('serviceChartSummary'); if (!container || records.length === 0) { if(container) container.innerHTML = '<span class="text-xs text-slate-400 m-auto">Немає даних</span>'; if(summary) summary.innerHTML = ''; return; } const type = $('serviceChartSelect')?.value || 'water'; const sorted = [...records].sort((a, b) => new Date(a.month) - new Date(b.month)).slice(-8); const getValue = (rec) => { switch(type) { case 'water': return Math.max(0,(rec.wCur||0)-(rec.wPrev||0)); case 'hotWater': return Math.max(0,(rec.hwCur||0)-(rec.hwPrev||0)); case 'electro': return Math.max(0,(rec.dCur||0)-(rec.dPrev||0))+Math.max(0,(rec.nCur||0)-(rec.nPrev||0)); case 'gas': return Math.max(0,(rec.gCur||0)-(rec.gPrev||0)); default: return 0; } }; const getUnit = () => { switch(type) { case 'water': case 'hotWater': case 'gas': return 'м³'; case 'electro': return 'кВт'; default: return ''; } }; const getColor = () => { switch(type) { case 'water': return '#3b82f6'; case 'hotWater': return '#ef4444'; case 'electro': return '#eab308'; case 'gas': return '#f97316'; default: return '#6b7280'; } }; const values = sorted.map(getValue); const max = Math.max(...values, 1); const unit = getUnit(); const color = getColor(); container.innerHTML = sorted.map((rec, i) => { const val = values[i]; const h = (val / max) * 100; const mName = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3); let trend = ''; if (i > 0 && values[i-1] > 0) { const d = val - values[i-1]; if (d > 0) trend = `<span class="text-[8px] text-red-500 font-bold">↑</span>`; else if (d < 0) trend = `<span class="text-[8px] text-green-500 font-bold">↓</span>`; } return `<div class="flex flex-col items-center flex-1 h-full justify-end"><div class="w-full rounded-t-md bg-slate-100 dark:bg-white/5 overflow-hidden flex items-end" style="height:100%"><div class="w-full rounded-t-md transition-all duration-700" style="height:${Math.max(4,h)}%;background:${color};opacity:${0.5+(i/sorted.length)*0.5}"></div></div><div class="flex flex-col items-center mt-1"><span class="text-[8px] text-slate-500 font-bold">${mName}</span>${trend}</div></div>`; }).join(''); const avg = values.reduce((a,b)=>a+b,0)/values.length; const last = values[values.length-1]||0; const prevLast = values.length>1?values[values.length-2]:last; const trendPct = prevLast > 0 ? Math.round(((last-prevLast)/prevLast)*100) : 0; if(summary) summary.innerHTML = `<span>Сер.: <span style="color:${color}" class="font-black">${Math.round(avg)} ${unit}/міс</span></span><span>Ост.: <span class="${trendPct<0?'text-green-600':trendPct>0?'text-red-500':'text-slate-500'} font-black">${last} ${unit} (${trendPct>0?'+':''}${trendPct}%)</span></span>`; }
$('serviceChartSelect')?.addEventListener('change', renderServiceChart);

// =================== FILTERS ===================
$('filterToggleBtn')?.addEventListener('click', () => $('filterPanel')?.classList.toggle('hidden'));
$('filterButtons')?.addEventListener('click', (e) => { const btn = e.target.closest('.filter-btn'); if (!btn) return; currentFilter = btn.dataset.filter; document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('bg-brand', 'text-white'); b.classList.add('bg-slate-100', 'dark:bg-[#2c2c2e]', 'text-slate-600', 'dark:text-slate-400'); }); btn.classList.remove('bg-slate-100', 'dark:bg-[#2c2c2e]', 'text-slate-600', 'dark:text-slate-400'); btn.classList.add('bg-brand', 'text-white'); renderRecords(); });
$('searchRecords')?.addEventListener('input', () => renderRecords());
$('sortSelect')?.addEventListener('change', () => renderRecords());

// =================== EXPORT ===================
function exportCSV() { if (records.length === 0) return showToast('Немає даних', '⚠️'); let headers = ['Місяць']; if (prefs.showWater) headers.push('Вода(м3)','Вода(₴)'); if (prefs.showHotWater) headers.push('Гар(м3)','Гар(₴)'); if (prefs.showElectro) headers.push('Світло(кВт)','Світло(₴)'); if (prefs.showGas) headers.push('Газ(м3)','Газ(₴)'); headers.push('Інше(₴)','Всього(₴)','Статус'); let csv = '\uFEFF' + headers.join(',') + '\n'; [...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).forEach(r => { let row = [r.month]; if(prefs.showWater) row.push(Math.max(0,(r.wCur||0)-(r.wPrev||0)),(r.waterCost||0).toFixed(2)); if(prefs.showHotWater) row.push(Math.max(0,(r.hwCur||0)-(r.hwPrev||0)),(r.hotWaterCost||0).toFixed(2)); if(prefs.showElectro) row.push(Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0)),(r.electroCost||0).toFixed(2)); if(prefs.showGas) row.push(Math.max(0,(r.gCur||0)-(r.gPrev||0)),(r.gasCost||0).toFixed(2)); row.push((r.customCost||0).toFixed(2),(r.total||0).toFixed(2),r.paid?'Оплачено':'Борг'); csv += row.join(',') + '\n'; }); const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `komunalka_${currentAddressId}.csv`; link.click(); showToast('Експортовано', '📊'); }

function generatePDF() { if (records.length === 0) return showToast('Немає даних', '⚠️'); const { jsPDF } = window.jspdf; const doc = new jsPDF(); const addressName = $('currentAddressDisplay').innerText; const sorted = [...records].sort((a,b)=>new Date(b.month)-new Date(a.month)); doc.setFillColor(0,122,255); doc.rect(0,0,210,40,'F'); doc.setTextColor(255,255,255); doc.setFontSize(22); doc.setFont(undefined,'bold'); doc.text('Комунальнi платежi',15,18); doc.setFontSize(11); doc.setFont(undefined,'normal'); doc.text(addressName,15,28); doc.setFontSize(9); doc.text('Згенеровано: '+new Date().toLocaleDateString('uk-UA',{day:'numeric',month:'long',year:'numeric'}),15,35); doc.setTextColor(60,60,60); let y=50; const totalAll = sorted.reduce((s,r)=>s+r.total,0); const avg = totalAll/sorted.length; const unpaid = sorted.filter(r=>!r.paid); const unpaidTotal = unpaid.reduce((s,r)=>s+r.total,0); doc.setFont(undefined,'bold'); doc.setFontSize(10); doc.text('Зведена iнформацiя',15,y); y+=8; doc.setFont(undefined,'normal'); doc.setFontSize(9); doc.text(`Записiв: ${sorted.length} | Середнiй: ${fmt.format(avg)} UAH`,15,y); y+=5; if(unpaid.length>0){doc.setTextColor(255,59,48);doc.text(`Борг: ${fmt.format(unpaidTotal)} UAH (${unpaid.length} мiс.)`,15,y);doc.setTextColor(60,60,60);}y+=10; const tableHeaders=['Мiсяць']; if(prefs.showWater)tableHeaders.push('Вода','₴');if(prefs.showHotWater)tableHeaders.push('Гар','₴');if(prefs.showElectro)tableHeaders.push('Свiтло','₴');if(prefs.showGas)tableHeaders.push('Газ','₴');tableHeaders.push('Iнше','ВСЬОГО',''); const tableRows=sorted.map(r=>{const mN=new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short',year:'2-digit'});const row=[mN];if(prefs.showWater)row.push(Math.max(0,(r.wCur||0)-(r.wPrev||0)),(r.waterCost||0).toFixed(0));if(prefs.showHotWater)row.push(Math.max(0,(r.hwCur||0)-(r.hwPrev||0)),(r.hotWaterCost||0).toFixed(0));if(prefs.showElectro)row.push(Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0)),(r.electroCost||0).toFixed(0));if(prefs.showGas)row.push(Math.max(0,(r.gCur||0)-(r.gPrev||0)),(r.gasCost||0).toFixed(0));row.push((r.customCost||0).toFixed(0),(r.total||0).toFixed(0),r.paid?'OK':'БОРГ');return row;}); doc.autoTable({startY:y,head:[tableHeaders],body:tableRows,theme:'striped',headStyles:{fillColor:[0,122,255],textColor:[255,255,255],fontSize:7,fontStyle:'bold',halign:'center'},bodyStyles:{fontSize:7,halign:'center'},columnStyles:{0:{halign:'left',fontStyle:'bold'}},alternateRowStyles:{fillColor:[245,247,250]},margin:{left:10,right:10}}); doc.save(`komunalka_${new Date().toISOString().slice(0,10)}.pdf`); showToast('PDF!','📄'); }

async function shareAllRecords() { if(records.length===0)return showToast('Немає','⚠️'); const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,6); let txt=`📊 Комунальні\n📍 ${$('currentAddressDisplay').innerText}\n───────\n`; sorted.forEach(r=>{txt+=`${new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short',year:'numeric'})}: ${fmt.format(r.total)} ₴ ${r.paid?'✅':'⏳'}\n`;}); txt+=`───────\nСередній: ${fmt.format(sorted.reduce((s,r)=>s+r.total,0)/sorted.length)} ₴/міс`; if(navigator.share){try{await navigator.share({text:txt});return;}catch(e){}} try{await navigator.clipboard.writeText(txt);showToast("Скопійовано!","📋");}catch(e){prompt(":",txt);} }
$('exportCsvBtn')?.addEventListener('click', exportCSV); $('exportPdfBtn')?.addEventListener('click', generatePDF); $('shareAllBtn')?.addEventListener('click', shareAllRecords);

// =================== DATA IMPORT/EXPORT ===================
$('exportJsonBtn')?.addEventListener('click', () => { syncCurrentAddress(); const data = { version: APP_VERSION, exportDate: new Date().toISOString(), addresses, currentAddressId }; const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `komunalka_backup_${new Date().toISOString().slice(0,10)}.json`; link.click(); showToast('Бекап','💾'); });
$('importJsonBtn')?.addEventListener('click', () => $('importFileInput')?.click());
$('importFileInput')?.addEventListener('change', (e) => { const file = e.target.files[0]; if(!file)return; const reader = new FileReader(); reader.onload = (ev) => { try { const data = JSON.parse(ev.target.result); if(data.addresses&&Array.isArray(data.addresses)){if(confirm(`Імпорт ${data.addresses.length} об'єктів?`)){addresses=data.addresses;currentAddressId=data.currentAddressId||addresses[0].id;loadCurrentAddress();syncToCloud();showToast('Імпортовано!','✅');}}else showToast('Невірний формат','❌');}catch(err){showToast('Помилка','❌');} }; reader.readAsText(file); e.target.value = ''; });

// =================== PWA ===================
let deferredPrompt; window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('pwaInstallBlock')?.classList.remove('hidden'); });
$('installPwaBtn')?.addEventListener('click', async () => { if(!deferredPrompt)return; deferredPrompt.prompt(); const{outcome}=await deferredPrompt.userChoice; if(outcome==='accepted')$('pwaInstallBlock')?.classList.add('hidden'); deferredPrompt=null; });

// =================== LOGOUT ===================
function logout() { if(isGuest){window.location.href=window.location.pathname;return;} if(confirm('Вийти?')){localStorage.clear();if(googleUser)firebase.auth().signOut();location.reload();} }
$('logoutBtn')?.addEventListener('click', logout);

// =================== INIT ===================
function initAppUI() {
    $('authScreen').classList.add('hidden'); $('appScreen').classList.remove('hidden'); $('appScreen').classList.add('flex');
    if($('tWater')) $('tWater').value = tariffs.water; if($('tHotWater')) $('tHotWater').value = tariffs.hotWater; if($('tElectroBase')) $('tElectroBase').value = tariffs.electroBase; if($('tElectroWinter')) $('tElectroWinter').value = tariffs.electroWinter; if($('tGas')) $('tGas').value = tariffs.gas;
    if ($('budgetInput')) $('budgetInput').value = localStorage.getItem('k_budget') || '';
    updateGoogleButton(); applyPreferences(); renderCalcCustomServices(); fillPreviousReadings(); switchTab('tabDashboard', 0); calculatePreview(); updateSmartBadges(); renderDashboard();
    const vis = readingInputIds.map(id => $(id)).filter(el => el && el.offsetParent !== null);
    vis.forEach((input, idx, arr) => { input.addEventListener('keydown', (e) => { if(e.key==='Enter'){e.preventDefault();const next=arr[idx+1];if(next)next.focus();else $('submitFormBtn')?.focus();} }); });
}

// =================== GUEST / AUTO-LOGIN ===================
if (urlShareToken) { isGuest = true; $('authScreen').classList.add('hidden'); $('appScreen').classList.remove('hidden'); $('appScreen').classList.add('flex'); $('btnTabSettings').style.display = 'none'; $('addressHeaderTrigger').style.pointerEvents = 'none'; if($('addressArrowIcon')) $('addressArrowIcon').style.display = 'none'; fetch(`${WORKER_URL}?share=${urlShareToken}`, {cache:"no-store"}).then(r=>r.json()).then(data=>{ if(data.success){addresses=data.data.addresses;currentAddressId=data.data.currentAddressId;loadCurrentAddress();} else alert("Посилання недійсне."); }); }
else if (localStorage.getItem('k_uid')) performLogin(null, null, false, localStorage.getItem('k_uid'));
else if (sessionLogin && sessionPass) performLogin(sessionLogin, sessionPass, true);

// =================== THEME BUTTONS ===================
$('mode-light')?.addEventListener('click', () => setThemeMode('light'));
$('mode-auto')?.addEventListener('click', () => setThemeMode('auto'));
$('mode-dark')?.addEventListener('click', () => setThemeMode('dark'));
// EOF
