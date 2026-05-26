// ============================================================
// UI — Toast, Modals, Theme
// ============================================================

let toastTimeout;

export function showToast(msg, icon = '✅') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.querySelector('#toastMsg').innerText = msg;
    t.querySelector('#toastIcon').innerText = icon;
    t.classList.add('visible');
    haptic(icon === '✅' ? 'success' : icon === '❌' || icon === '⚠️' ? 'error' : 'notification');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('visible'), 2500);
}

// =================== HAPTICS ===================
const hapticPatterns = {
    light: [5], medium: [10], heavy: [20],
    success: [10, 50, 10], error: [50, 30, 50],
    notification: [15, 100, 15], tabSwitch: [3]
};

export function haptic(type = 'light') {
    if (navigator.vibrate) {
        navigator.vibrate(hapticPatterns[type] || hapticPatterns.light);
    }
}

// =================== MODALS ===================
function createModalContainer() {
    let container = document.getElementById('modalsContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'modalsContainer';
        document.body.appendChild(container);
    }
    return container;
}

export function showInputModal(title, placeholder = '', defaultValue = '') {
    return new Promise((resolve) => {
        const container = createModalContainer();
        const id = 'modal_' + Date.now();

        container.innerHTML = `
            <div id="${id}" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="${id}_title">
                <div class="modal-card">
                    <h3 id="${id}_title" class="modal-title">${escapeHtml(title)}</h3>
                    <input
                        type="text" id="${id}_input"
                        class="modal-input"
                        placeholder="${escapeHtml(placeholder)}"
                        value="${escapeHtml(defaultValue)}"
                        autocomplete="off"
                    >
                    <div class="modal-actions">
                        <button type="button" class="modal-btn modal-btn-cancel" id="${id}_cancel">Скасувати</button>
                        <button type="button" class="modal-btn modal-btn-confirm" id="${id}_confirm">OK</button>
                    </div>
                </div>
            </div>
        `;

        const overlay = document.getElementById(id);
        const input = document.getElementById(`${id}_input`);
        const confirmBtn = document.getElementById(`${id}_confirm`);
        const cancelBtn = document.getElementById(`${id}_cancel`);

        // Focus input
        requestAnimationFrame(() => input.focus());

        function cleanup(value) {
            overlay.classList.add('modal-closing');
            setTimeout(() => {
                container.innerHTML = '';
                resolve(value);
            }, 200);
        }

        confirmBtn.addEventListener('click', () => cleanup(input.value));
        cancelBtn.addEventListener('click', () => cleanup(null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(null);
        });
    });
}

export function showConfirmModal(title, text = 'Ви впевнені?', confirmText = 'Так', isDanger = true) {
    return new Promise((resolve) => {
        const container = createModalContainer();
        const id = 'modal_' + Date.now();

        container.innerHTML = `
            <div id="${id}" class="modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="${id}_title" aria-describedby="${id}_text">
                <div class="modal-card">
                    <h3 id="${id}_title" class="modal-title">${escapeHtml(title)}</h3>
                    <p id="${id}_text" class="modal-text">${escapeHtml(text)}</p>
                    <div class="modal-actions">
                        <button type="button" class="modal-btn modal-btn-cancel" id="${id}_cancel">Скасувати</button>
                        <button type="button" class="modal-btn ${isDanger ? 'modal-btn-danger' : 'modal-btn-confirm'}" id="${id}_confirm">${escapeHtml(confirmText)}</button>
                    </div>
                </div>
            </div>
        `;

        const overlay = document.getElementById(id);
        const confirmBtn = document.getElementById(`${id}_confirm`);
        const cancelBtn = document.getElementById(`${id}_cancel`);

        requestAnimationFrame(() => confirmBtn.focus());

        function cleanup(value) {
            overlay.classList.add('modal-closing');
            setTimeout(() => {
                container.innerHTML = '';
                resolve(value);
            }, 200);
        }

        confirmBtn.addEventListener('click', () => cleanup(true));
        cancelBtn.addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(false);
        });
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', handler); }
        });
    });
}

// =================== BOTTOM SHEET MODAL ===================
export function showBottomSheet(title, contentHtml, onClose = null) {
    const container = createModalContainer();
    const id = 'sheet_' + Date.now();

    container.innerHTML = `
        <div id="${id}" class="sheet-overlay">
            <div class="sheet-card" id="${id}_card">
                <div class="sheet-handle" aria-hidden="true"></div>
                <h3 class="sheet-title">${escapeHtml(title)}</h3>
                <div class="sheet-content">${contentHtml}</div>
                <button type="button" class="sheet-close-btn" id="${id}_close">Закрити</button>
            </div>
        </div>
    `;

    const overlay = document.getElementById(id);
    const card = document.getElementById(`${id}_card`);
    const closeBtn = document.getElementById(`${id}_close`);

    // Animate in
    requestAnimationFrame(() => card.classList.add('sheet-visible'));

    function close() {
        card.classList.remove('sheet-visible');
        setTimeout(() => {
            container.innerHTML = '';
            if (onClose) onClose();
        }, 300);
    }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    return { close, element: card };
}

// =================== THEME ===================
let currentMode = localStorage.getItem('themeMode') || 'auto';

export function initTheme() {
    applyTheme();
    // Listen for system changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentMode === 'auto') applyTheme();
    });
}

export function setThemeMode(mode) {
    currentMode = mode;
    localStorage.setItem('themeMode', mode);
    applyTheme();
}

export function getThemeMode() { return currentMode; }

function applyTheme() {
    const isDark = currentMode === 'dark' || (currentMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    document.getElementById('metaThemeColor')?.setAttribute('content', isDark ? '#000000' : '#f2f2f7');
}

// =================== HELPERS ===================
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

export function formatNumber(num) {
    return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

export function $(id) { return document.getElementById(id); }
