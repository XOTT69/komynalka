// ============================================================
// EXPORT — CSV, PDF, JSON, Share
// ============================================================
import { state } from './state.js';
import { formatNumber, showToast, showConfirmModal } from './ui.js';

export function exportCSV() {
    const records = state.get('records') || [];
    const prefs = state.get('prefs');
    if (!records.length) return showToast('Немає записів', '⚠️');

    let headers = ['Місяць'];
    if (prefs.showWater) headers.push('Вода(м3)', 'Вода(₴)');
    if (prefs.showHotWater) headers.push('Гар(м3)', 'Гар(₴)');
    if (prefs.showElectro) headers.push('Електрика(кВт)', 'Електрика(₴)');
    if (prefs.showGas) headers.push('Газ(м3)', 'Газ(₴)');
    headers.push('Інше(₴)', 'Всього(₴)', 'Статус');

    let csv = '\uFEFF' + headers.join(',') + '\n';
    [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).forEach(r => {
        let row = [r.month];
        if (prefs.showWater) row.push(Math.max(0, (r.wCur || 0) - (r.wPrev || 0)), (r.waterCost || 0).toFixed(2));
        if (prefs.showHotWater) row.push(Math.max(0, (r.hwCur || 0) - (r.hwPrev || 0)), (r.hotWaterCost || 0).toFixed(2));
        if (prefs.showElectro) row.push(Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0)), (r.electroCost || 0).toFixed(2));
        if (prefs.showGas) row.push(Math.max(0, (r.gCur || 0) - (r.gPrev || 0)), (r.gasCost || 0).toFixed(2));
        row.push((r.customCost || 0).toFixed(2), (r.total || 0).toFixed(2), r.paid ? 'Оплачено' : 'Борг');
        csv += row.join(',') + '\n';
    });

    download(csv, 'komunalka.csv', 'text/csv;charset=utf-8;');
    showToast('Експортовано', '📊');
}

export async function generatePDF() {
    const records = state.get('records') || [];
    if (!records.length) return showToast('Немає записів', '⚠️');

    showToast('Підготовка PDF...', '⏳');

    // Lazy load jsPDF
    if (!window.jspdf) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const prefs = state.get('prefs');

    doc.setFillColor(0, 122, 255); doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18);
    doc.text('Komunalni platezhi', 15, 15);
    doc.setFontSize(10); doc.text(new Date().toLocaleDateString('uk-UA'), 15, 24);
    doc.setTextColor(60, 60, 60);

    const headers = ['Month'];
    if (prefs.showWater) headers.push('Water', 'UAH');
    if (prefs.showElectro) headers.push('Electro', 'UAH');
    if (prefs.showGas) headers.push('Gas', 'UAH');
    headers.push('Other', 'Total', 'Status');

    const rows = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).map(r => {
        const row = [r.month];
        if (prefs.showWater) row.push(Math.max(0, (r.wCur || 0) - (r.wPrev || 0)), (r.waterCost || 0).toFixed(0));
        if (prefs.showElectro) row.push(Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0)), (r.electroCost || 0).toFixed(0));
                if (prefs.showGas) row.push(Math.max(0, (r.gCur || 0) - (r.gPrev || 0)), (r.gasCost || 0).toFixed(0));
        row.push((r.customCost || 0).toFixed(0), (r.total || 0).toFixed(0), r.paid ? 'OK' : 'Borh');
        return row;
    });

    doc.autoTable({
        startY: 40, head: [headers], body: rows, theme: 'striped',
        headStyles: { fillColor: [0, 122, 255], textColor: [255, 255, 255], fontSize: 7, fontStyle: 'bold', halign: 'center' },
        bodyStyles: { fontSize: 7, halign: 'center' },
        margin: { left: 10, right: 10 }
    });

    doc.save(`komunalka_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('PDF створено!', '📄');
}

export async function shareAllRecords() {
    const records = state.get('records') || [];
    if (!records.length) return showToast('Немає записів', '⚠️');

    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 6);
    let text = `📊 Комунальні платежі\n───────\n`;
    sorted.forEach(r => {
        const month = new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short', year: 'numeric' });
        text += `${month}: ${formatNumber(r.total)} ₴ ${r.paid ? '✅' : '⏳'}\n`;
    });
    const avg = sorted.reduce((s, r) => s + r.total, 0) / sorted.length;
    text += `───────\nСередній: ${formatNumber(avg)} ₴/міс`;

    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) {} }
    try { await navigator.clipboard.writeText(text); showToast('Скопійовано!', '📋'); } catch (e) {}
}

export function exportJSON() {
    const { APP_VERSION } = state;
    state.syncToAddress();
    const data = {
        version: APP_VERSION || '4.0',
        exportDate: new Date().toISOString(),
        addresses: state.get('addresses'),
        currentAddressId: state.get('currentAddressId')
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    download(null, 'komunalka_backup.json', null, blob);
    showToast('Бекап збережено', '💾');
}

export async function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data.addresses || !Array.isArray(data.addresses)) {
                showToast('Невірний формат файлу', '❌');
                return;
            }

            const { showConfirmModal } = await import('./ui.js');
            const ok = await showConfirmModal(
                'Імпорт даних',
                `Імпортувати ${data.addresses.length} об'єктів? Поточні дані буде замінено.`,
                'Імпортувати',
                false
            );

            if (ok) {
                state.set('addresses', data.addresses);
                state.set('currentAddressId', data.currentAddressId || data.addresses[0].id);
                state.syncFromAddress();
                const { debouncedSync } = await import('./sync.js');
                debouncedSync();
                showToast('Імпортовано!', '✅');

                // Re-render current tab
                const { switchTab, getCurrentTabIndex } = await import('./tabs.js');
                switchTab(getCurrentTabIndex());
            }
        } catch (err) {
            showToast('Помилка читання файлу', '❌');
        }
    };
    reader.readAsText(file);
}

// =================== HELPERS ===================
function download(content, filename, type, blob = null) {
    const b = blob || new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(b);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}
