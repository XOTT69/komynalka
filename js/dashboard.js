// ============================================================
// DASHBOARD
// ============================================================
import { state } from './state.js';
import { formatNumber, escapeHtml, $ } from './ui.js';

export function renderDashboard() {
    const container = $('tabDashboard');
    if (!container) return;

    const records = state.get('records') || [];
    const prefs = state.get('prefs');
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const curRec = records.find(r => r.month === curMonth);
    const hasRecords = records.length > 0;

    // Greeting
    const hour = now.getHours();
    let greeting = 'Доброго дня!';
    if (hour < 6) greeting = 'Доброї ночі!';
    else if (hour < 12) greeting = 'Доброго ранку!';
    else if (hour >= 18) greeting = 'Доброго вечора!';

    const monthLabel = new Date(curMonth + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
    const streak = getStreak(records);
    const unpaid = records.filter(r => !r.paid);
    const debtTotal = unpaid.reduce((s, r) => s + r.total, 0);
    const avg = hasRecords ? records.reduce((s, r) => s + r.total, 0) / records.length : 0;

    container.innerHTML = `
        <div class="space-y-4 pt-2">
            <!-- Hero -->
            <div class="hero-card">
                <div class="hero-top">
                    <div>
                        <p class="hero-greeting">${greeting}</p>
                        <p class="hero-month">${monthLabel}</p>
                    </div>
                    <div class="hero-streak">
                        <span>🔥</span>
                        <span class="hero-streak-num">${streak}</span>
                        <span class="hero-streak-label">міс.</span>
                    </div>
                </div>
                <p class="hero-amount">${formatNumber(curRec ? curRec.total : 0)} ₴</p>
                <p class="hero-subtitle">за поточний місяць</p>
            </div>

            ${unpaid.length > 0 ? `
            <div class="debt-card">
                <div>
                    <p class="debt-label">Непогашений борг</p>
                    <p class="debt-amount">${formatNumber(debtTotal)} ₴</p>
                </div>
                <p class="debt-months">${unpaid.length} міс.</p>
            </div>` : ''}

            <!-- Action buttons -->
            <div class="dash-actions">
                <button id="dashAddBtn" class="dash-action-primary">
                    <i class="fa-solid fa-plus"></i>
                    <span>Внести</span>
                    <small>показники</small>
                </button>
                <button id="dashHistoryBtn" class="dash-action-secondary">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <span>Історія</span>
                    <small>всі записи</small>
                </button>
            </div>

            ${!hasRecords ? `
            <div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-plus"></i></div>
                <p class="empty-title">Почніть вести облік</p>
                <p class="empty-text">Внесіть перші показники лічильників</p>
            </div>` : `
            <!-- Stats -->
            <details class="card details-card">
                <summary class="details-summary">
                    <div class="details-icon blue"><i class="fa-solid fa-chart-line"></i></div>
                    <span>Статистика</span>
                    <i class="fa-solid fa-chevron-down details-chevron"></i>
                </summary>
                <div class="details-body">
                    <div class="stats-grid">
                        <div class="stat-item"><p class="stat-label">Середній</p><p class="stat-value">${formatNumber(avg)} ₴</p></div>
                        <div class="stat-item"><p class="stat-label">Записів</p><p class="stat-value">${records.length}</p></div>
                        <div class="stat-item"><p class="stat-label">Серія</p><p class="stat-value">${streak} 🔥</p></div>
                    </div>
                    <canvas id="dashChartCanvas" class="chart-canvas" aria-label="Графік витрат"></canvas>
                </div>
            </details>`}
        </div>
    `;

    // Re-bind action buttons
    $('dashAddBtn')?.addEventListener('click', async () => {
        const { switchTab } = await import('./tabs.js');
        switchTab(1);
    });
    $('dashHistoryBtn')?.addEventListener('click', async () => {
        const { switchTab } = await import('./tabs.js');
        switchTab(2);
    });

    // Render chart if exists
    if (hasRecords && $('dashChartCanvas')) {
        import('./charts.js').then(m => m.renderDashChart(records));
    }
}

// =================== HELPERS ===================
function getStreak(recs) {
    if (!recs.length) return 0;
    const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month));
    let streak = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
        const [y1, m1] = sorted[i].month.split('-').map(Number);
        const [y2, m2] = sorted[i + 1].month.split('-').map(Number);
        if ((y1 * 12 + m1) - (y2 * 12 + m2) === 1) streak++;
        else break;
    }
    return streak;
}
