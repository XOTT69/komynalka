// ============================================================
// AUTH — Google fix, no circular imports
// ============================================================
import { WORKER_URL, FIREBASE_CONFIG, DEFAULT_TARIFFS, DEFAULT_PREFS, DEFAULT_SERVICES } from './config.js';
import { state } from './state.js';
import { $, showToast, showInputModal } from './ui.js';

let googleUser = null;

// =================== HELPERS ===================
async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function getAuthHeader() {
    const uid = localStorage.getItem('k_uid');
    if (uid) return `Bearer uid:${uid}`;
    const login = state.get('sessionLogin');
    const pass = state.get('sessionPass');
    if (login && pass) {
        const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(login)));
        return `Bearer login:${encoded}:${pass}`;
    }
    return null;
}

export async function secureFetch(method, params = {}, body = null) {
    let url = WORKER_URL;
    const headers = { 'Content-Type': 'application/json' };
    const auth = getAuthHeader();
    if (auth) headers['Authorization'] = auth;
    const urlP = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) urlP.set(k, v); });
    const qs = urlP.toString();
    if (qs) url += '?' + qs;
    const options = { method, headers, cache: 'no-store' };
    if (body && method === 'POST') options.body = JSON.stringify(body);
    return fetch(url, options);
}

// =================== FIREBASE — правильний lazy load ===================
let firebaseLoaded = false;

async function ensureFirebase() {
    if (firebaseLoaded) return;

    // Чекаємо поки скрипти завантажаться (вони defer в HTML)
    if (typeof firebase === 'undefined') {
        // Динамічно підвантажуємо якщо ще не завантажені
        await new Promise((resolve, reject) => {
            const script1 = document.createElement('script');
            script1.src = 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js';
                script2.onload = resolve;
                script2.onerror = reject;
                document.head.appendChild(script2);
            };
            script1.onerror = reject;
            document.head.appendChild(script1);
        });
    }

    // Init app якщо ще не ініціалізовано
    if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
    }
    firebaseLoaded = true;
}

// =================== LOGIN ===================
export async function performLogin(rawLogin, rawPass, isHashed = false, uid = null) {
    const errEl = $('authError');
    const spinner = $('authSpinner');
    const btnText = $('authBtnText');
    const submitBtn = $('authSubmitBtn');

    if (errEl) errEl.classList.add('hidden');
    if (btnText) btnText.textContent = "Завантаження...";
    if (spinner) spinner.classList.remove('hidden');
    if (submitBtn) submitBtn.setAttribute('aria-busy', 'true');

    try {
        let passHash = null;
        if (!uid) {
            if (!rawLogin || (!rawPass && !isHashed)) throw new Error("Введіть логін та пароль");
            if (!isHashed && rawPass.length < 4) throw new Error("Пароль мінімум 4 символи");
            passHash = isHashed ? rawPass : await sha256(rawPass);
        }

        // Set credentials for fetch
        if (uid) { localStorage.setItem('k_uid', uid); }
        else { state.set('sessionLogin', rawLogin); state.set('sessionPass', passHash); }

        // Fetch with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let res;
        try {
            const url = `${WORKER_URL}?t=${Date.now()}`;
            const headers = { 'Content-Type': 'application/json' };
            const auth = getAuthHeader();
            if (auth) headers['Authorization'] = auth;
            res = await fetch(url, { method: 'GET', headers, cache: 'no-store', signal: controller.signal });
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') throw new Error("Сервер не відповідає. Спробуйте пізніше.");
            throw new Error("Немає з'єднання з інтернетом.");
        }
        clearTimeout(timeout);

        const data = await res.json();

        if (res.status === 429) throw new Error("Забагато спроб. Зачекайте хвилину.");
        if (res.status === 403 || data.error === "WRONG_PASSWORD") throw new Error("Неправильний пароль");

        if (res.status === 404 && uid) {
            localStorage.removeItem('k_uid');
            // TODO: link modal
            throw new Error("Google акаунт не знайдено. Увійдіть логіном.");
        }

        if (res.status === 404 || (!uid && !data.success)) {
            // New user
            state.set('addresses', [{ id: 'default', name: 'Мій дім', tariffs: { ...DEFAULT_TARIFFS }, prefs: { ...DEFAULT_PREFS }, records: [], customServices: [...DEFAULT_SERVICES] }]);
            state.set('currentAddressId', 'default');
            const { syncToCloud } = await import('./sync.js');
            await syncToCloud();
        } else if (res.status === 200 && data.success) {
            if (data.data.addresses) {
                state.set('addresses', data.data.addresses);
                state.set('currentAddressId', data.data.currentAddressId || data.data.addresses[0].id);
            } else {
                state.set('addresses', [{ id: 'default', name: 'Мій дім', tariffs: data.data.tariffs || { ...DEFAULT_TARIFFS }, prefs: { ...DEFAULT_PREFS, ...(data.data.prefs || {}) }, records: data.data.records || [], customServices: data.data.customServices || [...DEFAULT_SERVICES] }]);
                state.set('currentAddressId', 'default');
            }
            if (uid && data.linkedLogin) state.set('sessionLogin', data.linkedLogin);
        }

        if (!uid) state.saveSession();
        state.syncFromAddress();

        // Init app (dynamic import to avoid circular)
        const { initApp } = await import('./app.js');
        initApp();

    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
        resetAuthUI();

        // Offline fallback
        const backup = state.loadLocal();
        if (backup?.addresses?.length > 0 && (err.message.includes("з'єднання") || err.message.includes("відповідає"))) {
            state.set('addresses', backup.addresses);
            state.set('currentAddressId', backup.currentAddressId);
            state.syncFromAddress();
            showToast('Завантажено з кешу (офлайн)', '💾');
            const { initApp } = await import('./app.js');
            initApp();
        }
    }
}

function resetAuthUI() {
    const spinner = $('authSpinner');
    const btnText = $('authBtnText');
    const submitBtn = $('authSubmitBtn');
    if (btnText) btnText.textContent = "Увійти";
    if (spinner) spinner.classList.add('hidden');
    if (submitBtn) submitBtn.setAttribute('aria-busy', 'false');
}

// =================== GOOGLE AUTH (ПОВНИЙ ФІКС) ===================
export async function loginWithGoogle() {
    try {
        showToast('Підключення Google...', '⏳');
        await ensureFirebase();

        const provider = new firebase.auth.GoogleAuthProvider();
        // Для мобільних — redirect замість popup
        const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

        if (isMobile) {
            // Redirect flow
            await firebase.auth().signInWithRedirect(provider);
            // Результат обробляється при повторному завантаженні сторінки
        } else {
            // Popup flow для десктопу
            const result = await firebase.auth().signInWithPopup(provider);
            googleUser = result.user;
            await performLogin(null, null, false, googleUser.uid);
        }
    } catch (e) {
        console.error('Google auth error:', e);
        if (e.code === 'auth/popup-closed-by-user') return;
        if (e.code === 'auth/popup-blocked') {
            showToast('Дозвольте спливаючі вікна', '⚠️');
            return;
        }
        showToast('Помилка Google: ' + (e.message || e.code || 'невідома'), '❌');
    }
}

// Обробка redirect result (для мобільних)
async function handleRedirectResult() {
    try {
        await ensureFirebase();
        const result = await firebase.auth().getRedirectResult();
        if (result.user) {
            googleUser = result.user;
            await performLogin(null, null, false, googleUser.uid);
        }
    } catch (e) {
        if (e.code && e.code !== 'auth/no-auth-event') {
            console.error('Redirect result error:', e);
        }
    }
}

// =================== DEMO ===================
export function startDemo() {
    state.set('isGuest', true);
    state.set('addresses', [{
        id: 'demo', name: 'Демо квартира',
        tariffs: { ...DEFAULT_TARIFFS },
        prefs: { ...DEFAULT_PREFS },
        records: [
            { id: 1, month: '2026-03', wPrev: 100, wCur: 108, dPrev: 5000, dCur: 5180, nPrev: 2000, nCur: 2090, gPrev: 300, gCur: 315, waterCost: 243.04, electroCost: 821.52, gasCost: 119.40, customCost: 850, hotWaterCost: 0, total: 2033.96, paid: true, _filled: { water: true, electro: true, gas: true, custom: true } },
            { id: 2, month: '2026-04', wPrev: 108, wCur: 115, dPrev: 5180, dCur: 5340, nPrev: 2090, nCur: 2170, gPrev: 315, gCur: 325, waterCost: 212.66, electroCost: 734.88, gasCost: 79.60, customCost: 850, hotWaterCost: 0, total: 1877.14, paid: true, _filled: { water: true, electro: true, gas: true, custom: true } },
            { id: 3, month: '2026-05', wPrev: 115, wCur: 123, dPrev: 5340, dCur: 5510, nPrev: 2170, nCur: 2250, gPrev: 325, gCur: 332, waterCost: 243.04, electroCost: 778.08, gasCost: 55.72, customCost: 850, hotWaterCost: 0, total: 1926.84, paid: false, _filled: { water: true, electro: true, gas: true, custom: true } }
        ],
        customServices: [{ id: "s1", name: "Квартплата", defaultSum: "650" }, { id: "s2", name: "Інтернет", defaultSum: "200" }]
    }]);
    state.set('currentAddressId', 'demo');
    state.syncFromAddress();
}

// =================== LOGOUT ===================
export function logout() {
    localStorage.clear();
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.auth().signOut().catch(() => {});
    }
    location.reload();
}

// =================== INIT LISTENERS ===================
export function initAuthListeners() {
    $('authForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const login = $('authLogin').value.trim();
        const pass = $('authPass').value;
        await performLogin(login, pass, false);
    });

    $('togglePassBtn')?.addEventListener('click', () => {
        const p = $('authPass');
        const icon = $('passEyeIcon');
        const isHidden = p.type === 'password';
        p.type = isHidden ? 'text' : 'password';
        icon.className = isHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    });

    $('googleAuthBtn')?.addEventListener('click', loginWithGoogle);

    $('demoBtn')?.addEventListener('click', async () => {
        startDemo();
        const { initApp } = await import('./app.js');
        initApp();
    });

    // Handle Google redirect result on page load
    handleRedirectResult();
}
