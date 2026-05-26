// ============================================================
// TABS NAVIGATION
// ============================================================
import { haptic } from './ui.js';

const TAB_IDS = ['tabDashboard', 'tabCalc', 'tabHistory', 'tabSettings'];
const BTN_IDS = ['btnTabDashboard', 'btnTabCalc', 'btnTabHistory', 'btnTabSettings'];

let currentTabIndex = 0;

export function initTabs() {
    BTN_IDS.forEach((btnId, idx) => {
        const btn = document.getElementById(btnId);
        btn?.addEventListener('click', () => switchTab(idx));
    });

    // Quick links
    document.getElementById('dashAddBtn')?.addEventListener('click', () => switchTab(1));
    document.getElementById('dashHistoryBtn')?.addEventListener('click', () => switchTab(2));

    // Swipe
    let touchStartX = 0;
    const container = document.getElementById('swipeContainer');
    container?.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    container?.addEventListener('touchend', e => {
        const dist = touchStartX - e.changedTouches[0].screenX;
        if (dist > 70 && currentTabIndex < TAB_IDS.length - 1) switchTab(currentTabIndex + 1);
        else if (dist < -70 && currentTabIndex > 0) switchTab(currentTabIndex - 1);
    }, { passive: true });
}

export function switchTab(index) {
    if (index === currentTabIndex) return;

    // Hide current
    const currentTab = document.getElementById(TAB_IDS[currentTabIndex]);
    if (currentTab) { currentTab.classList.remove('tab-active'); currentTab.classList.add('tab-hidden'); }

    // Show new
    const newTab = document.getElementById(TAB_IDS[index]);
    if (newTab) { newTab.classList.remove('tab-hidden'); newTab.classList.add('tab-active'); }

    // Update nav buttons
    BTN_IDS.forEach((btnId, i) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.classList.toggle('active', i === index);
        btn.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });

    currentTabIndex = index;

    // Scroll to top
    document.getElementById('swipeContainer')?.scrollTo({ top: 0, behavior: 'instant' });

    // Render tab content (lazy)
    requestAnimationFrame(() => renderTabContent(index));

    haptic('tabSwitch');
}

async function renderTabContent(index) {
    switch (index) {
        case 0: {
            const { renderDashboard } = await import('./dashboard.js');
            renderDashboard();
            break;
        }
        case 1: {
            const { renderCalcTab } = await import('./calc.js');
            renderCalcTab();
            break;
        }
        case 2: {
            const { renderHistoryTab } = await import('./history.js');
            renderHistoryTab();
            break;
        }
        case 3: {
            const { renderSettingsTab } = await import('./settings.js');
            renderSettingsTab();
            break;
        }
    }
}

export function getCurrentTabIndex() { return currentTabIndex; }
