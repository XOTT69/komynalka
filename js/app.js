// ============================================================
// APP — Entry Point
// ============================================================
import { state } from './state.js';
import { initAuthListeners, performLogin } from './auth.js';
import { showToast } from './ui.js';
import { initTabs } from './tabs.js';
import { initTheme } from './ui.js';
import { initPWA } from './pwa.js';

// =================== SPLASH ===================
function removeSplash() {
    const splash = document.getElementById('splashScreen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.remove(), 300);
    }
}

// =================== INIT (called after successful login) ===================
export function initApp() {
    // Сховати auth, показати app
    document.getElementById('authScreen')?.classList.add('hidden');
    const appScreen = document.getElementById('appScreen');
    appScreen?.classList.remove('hidden');

    // Ініціалізувати вкладки
    initTabs();

    // Показати dashboard
    import('./dashboard.js').then(m => m.renderDashboard());
}

// =================== BOOT ===================
async function boot() {
    // 1. Тема
    initTheme();

    // 2. Auth listeners
    initAuthListeners();

    // 3. PWA
    initPWA();

    // 4. Прибрати splash
    removeSplash();

    // 5. Auto-login якщо є збережена сесія
    state.loadSession();
    const login = state.get('sessionLogin');
    const pass = state.get('sessionPass');
    const uid = localStorage.getItem('k_uid');

    // URL share token
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');

    if (shareToken) {
        // Guest mode
        state.set('isGuest', true);
        await loadSharedData(shareToken);
    } else if (uid) {
        // Google auto-login
        await performLogin(null, null, false, uid);
    } else if (login && pass) {
        // Password auto-login
        await performLogin(login, pass, true);
    }
    // Якщо нічого — показується auth screen (вже видимий)
}

async function loadSharedData(token) {
    try {
        const { WORKER_URL } = await import('./config.js');
        const res = await fetch(`${WORKER_URL}?share=${token}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.success) {
            state.set('addresses', data.data.addresses);
            state.set('currentAddressId', data.data.currentAddressId);
            state.syncFromAddress();
            initApp();
        } else {
            showToast("Посилання недійсне", "❌");
        }
    } catch (e) {
        showToast("Помилка завантаження", "❌");
    }
}

// =================== START ===================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
