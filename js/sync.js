// ============================================================
// SYNC
// ============================================================
import { state } from './state.js';
import { secureFetch } from './auth.js';
import { showToast } from './ui.js';

let syncInProgress = false;
let syncQueued = false;

export function setSyncState(newState) {
    state.set('syncState', newState);
    const dot = document.getElementById('syncDotHeader');
    if (dot) {
        dot.className = `sync-dot ${newState}`;
        dot.setAttribute('aria-label', newState === 'synced' ? 'Синхронізовано' : newState === 'syncing' ? 'Синхронізація...' : 'Офлайн');
    }
}

export async function syncToCloud() {
    if (syncInProgress) { syncQueued = true; return; }
    if (state.get('isGuest')) return;

    const login = state.get('sessionLogin');
    const uid = localStorage.getItem('k_uid');
    if (!login && !uid) return;

    state.syncToAddress();
    state.saveLocal();

    syncInProgress = true;
    setSyncState('syncing');

    try {
        const res = await secureFetch('POST', {}, {
            addresses: state.get('addresses'),
            currentAddressId: state.get('currentAddressId')
        });
        const data = await res.json();

        if (res.status === 403 || data.error === "WRONG_PASSWORD") {
            const { logout } = await import('./auth.js');
            logout();
            return;
        }
        if (res.status === 429) {
            showToast('Зачекайте хвилину', '⏳');
            setSyncState('offline');
            return;
        }
        setSyncState('synced');
    } catch (e) {
        setSyncState('offline');
        // Тихо зберігаємо локально, не спамимо тостами
    } finally {
        syncInProgress = false;
        if (syncQueued) {
            syncQueued = false;
            setTimeout(syncToCloud, 1000);
        }
    }
}

// Network listeners
window.addEventListener('online', () => {
    showToast('Знову онлайн', '🌐');
    syncToCloud();
});
window.addEventListener('offline', () => {
    setSyncState('offline');
    showToast('Офлайн — дані зберігаються локально', '📴');
});

// Auto-sync debounce
let syncDebounce;
export function debouncedSync() {
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(syncToCloud, 2000);
}
