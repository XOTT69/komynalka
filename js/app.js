// ============================================================
// APP — Entry Point
// ============================================================
import { state } from './state.js';
import { WORKER_URL, MAX_ADDRESSES, DEFAULT_TARIFFS, DEFAULT_PREFS, DEFAULT_SERVICES } from './config.js';
import { $, showToast, showInputModal, showConfirmModal, showBottomSheet, haptic, initTheme, formatNumber, escapeHtml } from './ui.js';
import { initTabs, switchTab, getCurrentTabIndex } from './tabs.js';
import { initPWA } from './pwa.js';
import { performLogin, loginWithGoogle, startDemo, logout, initAuthListeners } from './auth.js';
import { syncToCloud, debouncedSync } from './sync.js';

// =================== SPLASH ===================
function removeSplash() {
    const s = $('splashScreen');
    if (s) { s.classList.add('fade-out'); setTimeout(() => s.remove(), 300); }
}

// =================== INIT APP (exported, called after login) ===================
export function initApp() {
    $('authScreen')?.classList.add('hidden');
    $('appScreen')?.classList.remove('hidden');

    updateHeader();
    bindHeaderEvents();
    initTabs();

    // First render
    renderCurrentTab();
}

export function renderCurrentTab() {
    const idx = getCurrentTabIndex();
    switchTab(idx);
}

// =================== HEADER ===================
export function updateHeader() {
    const hour = new Date().getHours();
    let greeting = 'Доброго дня!';
    if (hour < 6) greeting = 'Доброї ночі!';
    else if (hour < 12) greeting = 'Доброго ранку!';
    else if (hour >= 18) greeting = 'Доброго вечора!';

    const greetEl = $('userGreeting');
    if (greetEl) {
        // Зберігаємо sync dot
        const dot = greetEl.querySelector('.sync-dot');
        greetEl.textContent = greeting + ' ';
        if (dot) greetEl.appendChild(dot);
    }

    const addr = state.getCurrentAddress();
    const display = $('currentAddressDisplay');
    if (display && addr) display.textContent = addr.name + (state.get('isGuest') ? ' (Гість)' : '');
}

function bindHeaderEvents() {
    $('addressHeaderTrigger')?.addEventListener('click', openAddressSheet);
    $('quickActionsBtn')?.addEventListener('click', openQuickActions);
}

// =================== ADDRESS SHEET ===================
async function openAddressSheet() {
    if (state.get('isGuest')) return;

    const addresses = state.get('addresses') || [];
    const currentId = state.get('currentAddressId');

    const listHtml = addresses.map(a => `
        <div class="addr-row ${a.id === currentId ? 'active' : ''}" data-id="${a.id}">
            <span class="addr-name">${escapeHtml(a.name)}</span>
            <div class="addr-actions">
                <button class="addr-btn addr-edit" data-id="${a.id}" aria-label="Редагувати"><i class="fa-solid fa-pen"></i></button>
                ${a.id !== currentId && addresses.length > 1 ? `<button class="addr-btn addr-del" data-id="${a.id}" aria-label="Видалити"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
        </div>
    `).join('');

    const { close, element } = showBottomSheet('🏡 Мої об\'єкти', `
        <div class="addr-list">${listHtml}</div>
        <button class="addr-add-btn" id="sheetAddAddr">+ Додати адресу</button>
    `);

    // Switch
    element.querySelectorAll('.addr-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.addr-edit') || e.target.closest('.addr-del')) return;
            const id = row.dataset.id;
            if (id === currentId) return;
            state.syncToAddress();
            state.set('currentAddressId', id);
            state.syncFromAddress();
            updateHeader();
            debouncedSync();
            close();
            renderCurrentTab();
        });
    });

    // Edit
    element.querySelectorAll('.addr-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const addrs = state.get('addresses');
            const addr = addrs.find(a => a.id === btn.dataset.id);
            if (!addr) return;
            const name = await showInputModal('Нова назва', 'Назва', addr.name);
            if (name?.trim()) {
                addr.name = name.trim();
                state.set('addresses', addrs);
                updateHeader();
                debouncedSync();
                close();
            }
        });
    });

    // Delete
    element.querySelectorAll('.addr-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await showConfirmModal('Видалити адресу?', 'Записи буде втрачено.');
            if (ok) {
                const addrs = state.get('addresses').filter(a => a.id !== btn.dataset.id);
                state.set('addresses', addrs);
                if (state.get('currentAddressId') === btn.dataset.id) {
                    state.set('currentAddressId', addrs[0].id);
                    state.syncFromAddress();
                }
                updateHeader();
                debouncedSync();
                close();
                renderCurrentTab();
            }
        });
    });

    // Add
    element.querySelector('#sheetAddAddr')?.addEventListener('click', async () => {
        const addrs = state.get('addresses');
        if (addrs.length >= MAX_ADDRESSES) { showToast(`Максимум ${MAX_ADDRESSES} адреси`, '⚠️'); return; }
        const name = await showInputModal('Нова адреса', 'Назва об\'єкту');
        if (name?.trim()) {
            state.syncToAddress();
            const newId = 'addr_' + Date.now();
            addrs.push({ id: newId, name: name.trim(), tariffs: { ...DEFAULT_TARIFFS }, prefs: { ...DEFAULT_PREFS }, records: [], customServices: [{ id: 's1', name: 'Квартплата', defaultSum: '' }] });
            state.set('addresses', addrs);
            state.set('currentAddressId', newId);
            state.syncFromAddress();
            updateHeader();
            debouncedSync();
            close();
            showToast('Додано');
            switchTab(0);
        }
    });
}

// =================== QUICK ACTIONS ===================
function openQuickActions() {
    const container = document.getElementById('modalsContainer') || document.body;
    const id = 'qa_' + Date.now();
    container.innerHTML = `
        <div id="${id}" class="modal-overlay qa-overlay" onclick="if(event.target===this)this.remove()">
            <div class="qa-menu">
                <button class="qa-item" data-action="export"><i class="fa-solid fa-file-excel" style="color:#22c55e"></i>Excel</button>
                <button class="qa-item" data-action="pdf"><i class="fa-solid fa-file-pdf" style="color:#ef4444"></i>PDF</button>
                <button class="qa-item" data-action="share"><i class="fa-solid fa-share" style="color:var(--brand)"></i>Поділитись</button>
                <button class="qa-item" data-action="image"><i class="fa-solid fa-image" style="color:#a855f7"></i>Як картинку</button>
                <button class="qa-item" data-action="sync"><i class="fa-solid fa-sync" style="color:var(--text-tertiary)"></i>Синхронізувати</button>
            </div>
        </div>`;

    document.getElementById(id).querySelectorAll('.qa-item').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.getElementById(id)?.remove();
            switch (btn.dataset.action) {
                case 'export': { const m = await import('./export.js'); m.exportCSV(); break; }
                case 'pdf': { const m = await import('./export.js'); m.generatePDF(); break; }
                case 'share': { const m = await import('./export.js'); m.shareAllRecords(); break; }
                case 'image': { if (typeof shareAsImage === 'function') shareAsImage(); else showToast('Недоступно', '⚠️'); break; }
                case 'sync': { await syncToCloud(); showToast('Синхронізовано', '✅'); break; }
            }
        });
    });
}

// =================== BOOT ===================
async function boot() {
    initTheme();
    initAuthListeners();
    initPWA();
    removeSplash();

    state.loadSession();
    const login = state.get('sessionLogin');
    const pass = state.get('sessionPass');
    const uid = localStorage.getItem('k_uid');
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');

    if (shareToken) {
        state.set('isGuest', true);
        try {
            const res = await fetch(`${WORKER_URL}?share=${shareToken}`, { cache: 'no-store' });
            const data = await res.json();
            if (data.success) { state.set('addresses', data.data.addresses); state.set('currentAddressId', data.data.currentAddressId); state.syncFromAddress(); initApp(); }
            else showToast('Посилання недійсне', '❌');
        } catch (e) { showToast('Помилка', '❌'); }
    } else if (uid) {
        await performLogin(null, null, false, uid);
    } else if (login && pass) {
        await performLogin(login, pass, true);
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
