// ============================================================
// HISTORY TAB
// ============================================================
import { state } from './state.js';
import { $, formatNumber, escapeHtml, showToast, showConfirmModal, haptic } from './ui.js';
import { debouncedSync } from './sync.js';
import { switchTab } from './tabs.js';
import { renderHistoryChart, renderServiceChart } from './charts.js';

let currentFilter = 'all';

export function renderHistoryTab() {
    const container = $('tabHistory');
    if (!container) return;

    const records = state.get('records') || [];
    const prefs = state.get('prefs');

    // Stats
    const totals = records.map(r => r.total);
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const totalPaid = records.filter(r => r.paid).reduce((s, r) => s + r.total, 0);
    const min = totals.length ? Math.min(...totals) : 0;
    const max = totals.length ? Math.max(...totals) : 0;

    // Service chart options
    let chartOptions = '';
    if (prefs.showWater) chartOptions += '<option value="water">💧 Вода</option>';
    if (prefs.showHotWater) chartOptions += '<option value="hotWater">🌡️ Гар. вода</option>';
    if (prefs.showElectro) chartOptions += '<option value="electro">⚡ Електрика</option>';
    if (prefs.showGas) chartOptions += '<option value="gas">🔥 Газ</option>';

    container.innerHTML = `
        <div class="space-y-4 pt-2">
            <!-- Stats card -->
            <div class="card" style="padding:24px">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px">
                    <div>
                        <p class="stat-label">Середній</p>
                        <p style="font-size:1.5rem;font-weight:900;color:var(--text-primary)" id="hStatsAvg">${formatNumber(avg)} ₴</p>
                    </div>
                    <div style="text-align:right">
                        <p class="stat-label">Оплачено</p>
                        <p style="font-size:1.1rem;font-weight:900;color:var(--brand)" id="hStatsPaid">${formatNumber(totalPaid)} ₴</p>
                    </div>
                </div>
                <div class="stats-grid" style="margin-bottom:24px">
                    <div class="stat-item"><p class="stat-label">Мін.</p><p class="stat-value">${formatNumber(min)} ₴</p></div>
                    <div class="stat-item"><p class="stat-label">Макс.</p><p class="stat-value">${formatNumber(max)} ₴</p></div>
                    <div class="stat-item"><p class="stat-label">Записів</p><p class="stat-value">${records.length}</p></div>
                </div>
                <div style="height:176px"><canvas id="historyChartCanvas" class="chart-canvas" style="height:100%" aria-label="Графік витрат за місяцями"></canvas></div>
                <div style="border-top:1px solid var(--border);margin-top:20px;padding-top:20px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                        <span class="stat-label">По послугах</span>
                        <select id="serviceChartSelect" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;outline:none;color:var(--text-primary)">${chartOptions}</select>
                    </div>
                    <canvas id="serviceChartCanvas" class="chart-canvas" style="height:112px" aria-label="Графік по послугах"></canvas>
                    <div id="serviceChartSummary" style="display:flex;justify-content:space-between;margin-top:12px;font-size:10px;font-weight:700;color:var(--text-tertiary)"></div>
                </div>
            </div>

            <!-- Search & filter -->
            <div class="card" style="padding:16px">
                <div style="display:flex;gap:12px;margin-bottom:12px">
                    <div class="search-wrap" style="flex:1">
                        <i class="fa-solid fa-search search-icon"></i>
                        <input type="text" id="searchRecords" placeholder="Пошук за місяцем..." class="search-input" aria-label="Пошук записів">
                    </div>
                    <button id="filterToggleBtn" style="padding:0 16px;background:var(--input-bg);border:1px solid var(--border);border-radius:var(--radius-xs);color:var(--text-tertiary);transition:all 0.2s" aria-label="Фільтри" aria-expanded="false">
                        <i class="fa-solid fa-filter"></i>
                    </button>
                </div>
                <div id="filterPanel" class="hidden" style="padding-top:12px;border-top:1px solid var(--border)">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                        <span style="font-size:13px;font-weight:600;color:var(--text-primary)">Статус:</span>
                        <div style="display:flex;gap:8px" id="filterButtons">
                            <button data-filter="all" class="filter-btn active">Всі</button>
                            <button data-filter="unpaid" class="filter-btn">Борг</button>
                            <button data-filter="paid" class="filter-btn">Сплачено</button>
                        </div>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span style="font-size:13px;font-weight:600;color:var(--text-primary)">Сортування:</span>
                        <select id="sortSelect" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;outline:none;color:var(--text-primary)">
                            <option value="date-desc">Новіші</option>
                            <option value="date-asc">Старіші</option>
                            <option value="amount-desc">Дорожчі</option>
                            <option value="amount-asc">Дешевші</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Records list -->
            <div id="recordsList" class="space-y-4"></div>

            <!-- Export -->
            <div class="export-row" style="margin-bottom:24px">
                <button id="exportCsvBtn" class="export-btn"><i class="fa-solid fa-file-excel" style="color:#22c55e"></i>Excel</button>
                <button id="exportPdfBtn" class="export-btn"><i class="fa-solid fa-file-pdf" style="color:#ef4444"></i>PDF</button>
                <button id="shareAllBtn" class="export-btn"><i class="fa-solid fa-share" style="color:var(--brand)"></i>Share</button>
            </div>
        </div>
    `;

    // Bind events
    bindHistoryEvents();
    renderRecordsList();

    // Charts
    setTimeout(() => {
        const sorted = [...records].sort((a, b) => new Date(a.month) - new Date(b.month));
        renderHistoryChart($('historyChartCanvas'), sorted);
        renderServiceChart($('serviceChartCanvas'), records, $('serviceChartSelect')?.value || 'water');
    }, 100);
}

function bindHistoryEvents() {
    let searchDebounce;
    $('searchRecords')?.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(renderRecordsList, 200);
    });

    $('filterToggleBtn')?.addEventListener('click', () => {
        const panel = $('filterPanel');
        const btn = $('filterToggleBtn');
        panel?.classList.toggle('hidden');
        btn?.setAttribute('aria-expanded', !panel?.classList.contains('hidden'));
    });

    $('filterButtons')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        currentFilter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRecordsList();
    });

    $('sortSelect')?.addEventListener('change', renderRecordsList);

    $('serviceChartSelect')?.addEventListener('change', () => {
        const records = state.get('records') || [];
        renderServiceChart($('serviceChartCanvas'), records, $('serviceChartSelect').value);
    });

    // Export
    $('exportCsvBtn')?.addEventListener('click', async () => {
        const { exportCSV } = await import('./export.js');
        exportCSV();
    });
    $('exportPdfBtn')?.addEventListener('click', async () => {
        const { generatePDF } = await import('./export.js');
        generatePDF();
    });
    $('shareAllBtn')?.addEventListener('click', async () => {
        const { shareAllRecords } = await import('./export.js');
        shareAllRecords();
    });
}

function renderRecordsList() {
    const list = $('recordsList');
    if (!list) return;

    const records = state.get('records') || [];

    if (!records.length) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
                <p class="empty-title">Ще немає записів</p>
                <p class="empty-text">Внесіть показники у вкладці «Рахунок»</p>
            </div>`;
        return;
    }

    // Sort
    let sorted = [...records];
    const sortVal = $('sortSelect')?.value || 'date-desc';
    switch (sortVal) {
        case 'date-desc': sorted.sort((a, b) => new Date(b.month) - new Date(a.month)); break;
        case 'date-asc': sorted.sort((a, b) => new Date(a.month) - new Date(b.month)); break;
        case 'amount-desc': sorted.sort((a, b) => b.total - a.total); break;
        case 'amount-asc': sorted.sort((a, b) => a.total - b.total); break;
    }

    // Filter
    if (currentFilter === 'paid') sorted = sorted.filter(r => r.paid);
    else if (currentFilter === 'unpaid') sorted = sorted.filter(r => !r.paid);

    // Search
    const search = $('searchRecords')?.value?.toLowerCase() || '';
    if (search) {
        sorted = sorted.filter(r =>
            new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' }).toLowerCase().includes(search) ||
            r.month.includes(search)
        );
    }

    if (!sorted.length) {
        list.innerHTML = '<div style="text-align:center;padding:32px"><p style="color:var(--text-tertiary);font-weight:600">Нічого не знайдено</p></div>';
        return;
    }

    list.innerHTML = '';

    // Batch bar
    const unpaidInView = sorted.filter(r => !r.paid);
    if (unpaidInView.length > 0 && currentFilter !== 'paid') {
        const bar = document.createElement('div');
        bar.className = 'batch-bar';
        bar.innerHTML = `
            <div>
                <p class="batch-count">${unpaidInView.length} неоплачених</p>
                <p class="batch-amount">${formatNumber(unpaidInView.reduce((s, r) => s + r.total, 0))} ₴</p>
            </div>
            <button class="batch-btn" id="batchPayBtn">✓ Оплатити всі</button>`;
        list.appendChild(bar);
        bar.querySelector('#batchPayBtn')?.addEventListener('click', async () => {
            const ok = await showConfirmModal('Оплатити всі?', `Позначити ${unpaidInView.length} записів як оплачені?`, 'Оплатити', false);
            if (ok) {
                const recs = state.get('records');
                recs.forEach(r => { if (!r.paid) r.paid = true; });
                state.set('records', recs);
                debouncedSync();
                renderRecordsList();
                showToast(`${unpaidInView.length} оплачено!`, '✅');
            }
        });
    }

    // Records by year
    let lastYear = null;
    sorted.forEach(rec => {
        const yr = rec.month.split('-')[0];
        if (yr !== lastYear) {
            lastYear = yr;
            const sep = document.createElement('div');
            sep.className = 'year-separator';
            sep.innerHTML = `<span class="year-label">${yr}</span><div class="year-line"></div>`;
            list.appendChild(sep);
        }
        list.appendChild(createRecordCard(rec));
    });
}

function createRecordCard(rec) {
    const card = document.createElement('div');
    card.className = `record-card ${rec.paid ? '' : 'unpaid'}`;
    const monthStr = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long' });

    const services = [];
    if (rec.waterCost > 0) services.push('💧');
    if (rec.hotWaterCost > 0) services.push('🌡️');
    if (rec.electroCost > 0) services.push('⚡');
    if (rec.gasCost > 0) services.push('🔥');
    if (rec.customCost > 0) services.push('📦');

    card.innerHTML = `
        <div class="swipe-bg swipe-bg-left"><i class="fa-solid fa-trash"></i> Видалити</div>
        <div class="swipe-bg swipe-bg-right"><i class="fa-solid fa-check"></i> ${rec.paid ? 'Скасувати' : 'Оплачено'}</div>
        <div class="record-header" data-toggle>
            <div>
                <p class="record-month">${escapeHtml(monthStr)}</p>
                <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
                    <span class="record-status ${rec.paid ? 'paid' : 'unpaid'}">${rec.paid ? 'Оплачено' : 'Борг'}</span>
                    <span style="font-size:11px">${services.join(' ')}</span>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
                <span class="record-total">${formatNumber(rec.total)} ₴</span>
                <i class="fa-solid fa-chevron-down details-chevron" style="font-size:12px;color:var(--text-quaternary)"></i>
            </div>
        </div>
        <div class="record-details hidden">
            ${rec.waterCost > 0 ? `<div class="record-detail-row"><span class="record-detail-label">💧 Вода</span><span class="record-detail-value">${formatNumber(rec.waterCost)} ₴</span></div><div class="record-detail-sub"><span>${rec.wPrev} → ${rec.wCur}</span><span style="color:#3b82f6">+${rec.wCur - rec.wPrev} м³</span></div>` : ''}
            ${rec.hotWaterCost > 0 ? `<div class="record-detail-row"><span class="record-detail-label">🌡️ Гаряча</span><span class="record-detail-value">${formatNumber(rec.hotWaterCost)} ₴</span></div><div class="record-detail-sub"><span>${rec.hwPrev} → ${rec.hwCur}</span><span style="color:#ef4444">+${rec.hwCur - rec.hwPrev} м³</span></div>` : ''}
            ${rec.electroCost > 0 ? `<div class="record-detail-row"><span class="record-detail-label">⚡ Електрика</span><span class="record-detail-value">${formatNumber(rec.electroCost)} ₴</span></div><div class="record-detail-sub"><span>Д: ${rec.dPrev} → ${rec.dCur}</span><span style="color:#eab308">+${rec.dCur - rec.dPrev} кВт</span></div>${(rec.nCur || rec.nPrev) ? `<div class="record-detail-sub" style="margin-top:4px"><span>Н: ${rec.nPrev} → ${rec.nCur}</span><span style="color:#6366f1">+${(rec.nCur || 0) - (rec.nPrev || 0)} кВт</span></div>` : ''}` : ''}
            ${rec.gasCost > 0 ? `<div class="record-detail-row"><span class="record-detail-label">🔥 Газ</span><span class="record-detail-value">${formatNumber(rec.gasCost)} ₴</span></div><div class="record-detail-sub"><span>${rec.gPrev} → ${rec.gCur}</span><span style="color:#f97316">+${rec.gCur - rec.gPrev} м³</span></div>` : ''}
            ${rec.customCost > 0 ? `<div class="record-detail-row"><span class="record-detail-label">📦 Фіксовані</span><span class="record-detail-value">${formatNumber(rec.customCost)} ₴</span></div>${rec.customData ? Object.values(rec.customData).filter(s => s.val > 0).map(s => `<div class="record-detail-sub"><span>${escapeHtml(s.name)}</span><span style="color:#a855f7">${formatNumber(s.val)} ₴</span></div>`).join('') : ''}` : ''}
            ${rec.note ? `<div style="margin-top:12px;padding:12px;background:var(--input-bg);border-radius:var(--radius-xs);font-size:12px;color:var(--text-tertiary);font-style:italic"><i class="fa-solid fa-sticky-note" style="margin-right:6px"></i>${escapeHtml(rec.note)}</div>` : ''}
            <div class="record-actions">
                <button class="record-btn ${rec.paid ? 'record-btn-pay paid' : 'record-btn-pay'}" data-action="pay">${rec.paid ? '↩ Скасувати' : '✓ Оплачено'}</button>
                <button class="record-btn-icon" data-action="share" aria-label="Поділитись"><i class="fa-solid fa-share-nodes"></i></button>
                <button class="record-btn-icon" data-action="edit" aria-label="Редагувати"><i class="fa-solid fa-pen"></i></button>
                <button class="record-btn-icon danger" data-action="delete" aria-label="Видалити"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;

    // Toggle details
    card.querySelector('[data-toggle]')?.addEventListener('click', () => {
        const details = card.querySelector('.record-details');
        const chevron = card.querySelector('.details-chevron');
        details?.classList.toggle('hidden');
        if (chevron) chevron.style.transform = details?.classList.contains('hidden') ? '' : 'rotate(180deg)';
    });

    // Actions
    card.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        e.stopPropagation();

        const records = state.get('records');
        const idx = records.findIndex(r => r.id === rec.id);

        switch (action) {
            case 'pay':
                if (idx >= 0) { records[idx].paid = !records[idx].paid; state.set('records', records); debouncedSync(); renderRecordsList(); }
                break;
            case 'share':
                await shareRecord(rec);
                break;
            case 'edit':
                editRecord(rec);
                break;
            case 'delete': {
                const ok = await showConfirmModal('Видалити запис?', 'Цю дію неможливо скасувати.');
                if (ok && idx >= 0) { records.splice(idx, 1); state.set('records', records); debouncedSync(); renderRecordsList(); showToast('Видалено', '🗑'); }
                break;
            }
        }
    });

    // Swipe
    initSwipe(card, rec.id);

    return card;
}

function initSwipe(card, recordId) {
    let startX = 0, currentX = 0, swiping = false;
    const threshold = 80;

    card.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; swiping = true; card.classList.add('swiping'); }, { passive: true });
    card.addEventListener('touchmove', (e) => {
        if (!swiping) return;
        currentX = e.touches[0].clientX - startX;
        const limited = Math.sign(currentX) * Math.min(Math.abs(currentX), 120);
        card.style.transform = `translateX(${limited}px)`;
        const l = card.querySelector('.swipe-bg-left'), r = card.querySelector('.swipe-bg-right');
        if (l) l.style.opacity = currentX < -30 ? '1' : '0';
        if (r) r.style.opacity = currentX > 30 ? '1' : '0';
    }, { passive: true });
    card.addEventListener('touchend', () => {
        swiping = false; card.classList.remove('swiping'); card.style.transform = '';
        const l = card.querySelector('.swipe-bg-left'), r = card.querySelector('.swipe-bg-right');
        if (l) l.style.opacity = '0'; if (r) r.style.opacity = '0';

        if (currentX < -threshold) {
            card.style.transform = 'translateX(-100%)'; card.style.opacity = '0';
            setTimeout(async () => {
                const ok = await showConfirmModal('Видалити?');
                if (ok) {
                    const recs = state.get('records').filter(r => r.id !== recordId);
                    state.set('records', recs); debouncedSync(); renderRecordsList(); showToast('Видалено', '🗑');
                } else { card.style.transform = ''; card.style.opacity = '1'; }
            }, 300);
        } else if (currentX > threshold) {
            const recs = state.get('records');
            const idx = recs.findIndex(r => r.id === recordId);
            if (idx >= 0) { recs[idx].paid = !recs[idx].paid; state.set('records', recs); debouncedSync(); renderRecordsList(); }
        }
        currentX = 0;
    }, { passive: true });
}

async function shareRecord(rec) {
    const month = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
    let text = `🧾 Комуналка за ${month}\n──────────\n`;
    if (rec.waterCost > 0) text += `💧 Вода: ${formatNumber(rec.waterCost)} ₴\n`;
    if (rec.hotWaterCost > 0) text += `🌡️ Гар.: ${formatNumber(rec.hotWaterCost)} ₴\n`;
    if (rec.electroCost > 0) text += `⚡ Електрика: ${formatNumber(rec.electroCost)} ₴\n`;
    if (rec.gasCost > 0) text += `🔥 Газ: ${formatNumber(rec.gasCost)} ₴\n`;
    if (rec.customCost > 0) text += `📦 Інше: ${formatNumber(rec.customCost)} ₴\n`;
    text += `──────────\n💰 Всього: ${formatNumber(rec.total)} ₴\n${rec.paid ? '✅ Оплачено' : '⏳ Очікує'}`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) {} }
    try { await navigator.clipboard.writeText(text); showToast('Скопійовано!', '📋'); } catch (e) {}
}

function editRecord(rec) {
    // Switch to calc tab and fill data
    switchTab(1);
    setTimeout(() => {
        const prefs = state.get('prefs');
        if ($('monthInput')) $('monthInput').value = rec.month;
        if (prefs.showWater) { if ($('wPrev')) $('wPrev').value = rec.wPrev || ''; if ($('wCur')) $('wCur').value = rec.wCur || ''; }
        if (prefs.showHotWater) { if ($('hwPrev')) $('hwPrev').value = rec.hwPrev || ''; if ($('hwCur')) $('hwCur').value = rec.hwCur || ''; }
        if (prefs.showElectro) { if ($('dPrev')) $('dPrev').value = rec.dPrev || ''; if ($('dCur')) $('dCur').value = rec.dCur || ''; if ($('nPrev')) $('nPrev').value = rec.nPrev || ''; if ($('nCur')) $('nCur').value = rec.nCur || ''; }
        if (prefs.showGas) { if ($('gPrev')) $('gPrev').value = rec.gPrev || ''; if ($('gCur')) $('gCur').value = rec.gCur || ''; }
        if (rec.customData) Object.entries(rec.customData).forEach(([id, d]) => { const el = $(`custom_${id}`); if (el) el.value = d.val; });
        if ($('recordNote')) $('recordNote').value = rec.note || '';
    }, 100);
}
