// ============================================================
// PWA — Service Worker, Install, Push
// ============================================================
import { showToast } from './ui.js';

let deferredPrompt = null;

export function initPWA() {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(e => console.error('SW:', e));
    }

    // Install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('pwaInstallBlock')?.classList.remove('hidden');
    });

    document.getElementById('installPwaBtn')?.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            document.getElementById('pwaInstallBlock')?.classList.add('hidden');
            showToast('Встановлено!', '📲');
        }
        deferredPrompt = null;
    });

    // Preconnect
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://komunproga.mikolenko-anton1.workers.dev';
    document.head.appendChild(link);
}

// =================== PUSH ===================
export async function requestPush() {
    if (!('Notification' in window)) {
        showToast('Push не підтримується', '⚠️');
        return false;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        showToast('Push увімкнено!', '🔔');
        return true;
    }
    showToast('Push відхилено', '⚠️');
    return false;
}

export function isPushEnabled() {
    return 'Notification' in window && Notification.permission === 'granted';
}
