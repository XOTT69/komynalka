// ============================================================
// DASHBOARD — повний з achievements, donut, tips, budget
// ============================================================
import { state } from './state.js';
import { $, formatNumber, escapeHtml, showToast, showConfirmModal, haptic } from './ui.js';
import { renderDashChart } from './charts.js';
import { getUnlocked, checkNewAchievements, renderAchievementsWidget, bindAchievementClicks } from './achievements.js';
import { switchTab } from './tabs.js';
import { debouncedSync } from './sync.js';

export function renderDashboard() {
    const container = $('tabDashboard');
    if (!container) return;

    const records = state.get('records') || [];
    const prefs = state.get('prefs');
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const curRec = records.find(r => r.month === curMonth);
    const hasRecords = records.length > 0;
    const hasMultiple = records.length >= 3;

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

    // Budget
    const budget = parseFloat(localStorage.getItem('k_budget')) || 0;
    const spent = curRec ? curRec.total : 0;
    const budgetPercent = budget ? Math.min((spent / budget) * 100, 100) : 0;
    const budgetRemaining = Math.max(budget - spent, 0);
    const isOverBudget = spent > budget;

    // Insight
    const insight = getSmartInsight(records, curRec, curMonth);

    // Tips
    const tips = getSmartTips(records, prefs);

    // Achievements
    const achievementsHtml = renderAchievementsWidget();

    container.innerHTML = `
        <div class="space-y-4 pt-2">
            <!-- Hero card -->
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
                <p class="hero-amount" id="dashCurrentMonth">${formatNumber(curRec ? curRec.total : 0)} ₴</p>
                <p class="hero-subtitle">за поточний місяць</p>
                ${insight ? `<div style="margin-top:16px;background:rgba(255,255,255,0.1);padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.05);font-size:12px;font-weight:700;opacity:0.85"><i class="fa-solid fa-lightbulb" style="margin-right:6px;color:#fbbf24"></i>${escapeHtml(insight)}</div>` : ''}
            </div>

            <!-- Debt -->
            ${unpaid.length > 0 ? `
            <div class="debt-card">
                <div>
                    <p class="debt-label">Непогашений борг</p>
                    <p class="debt-amount">${formatNumber(debtTotal)} ₴</p>
                </div>
                <p class="debt-months">${unpaid.length} міс.</p>
            </div>` : ''}

            <!-- Budget -->
            ${budget > 0 ? `
            <div class="card" style="padding:20px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:32px;height:32px;background:var(--brand-light);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:14px"><i class="fa-solid fa-wallet"></i></div>
                        <span style="font-size:14px;font-weight:700;color:var(--text-primary)">Бюджет</span>
                    </div>
                    <span style="font-size:14px;font-weight:900;color:var(--text-primary)">${Math.round(budgetPercent)}%</span>
                </div>
                <div style="height:12px;background:var(--input-bg);border-radius:6px;overflow:hidden;margin-bottom:8px">
                    <div style="height:100%;border-radius:6px;transition:width 0.7s;width:${budgetPercent}%;background:${isOverBudget ? 'linear-gradient(90deg,#f87171,#dc2626)' : budgetPercent > 80 ? 'linear-gradient(90deg,#fb923c,#ea580c)' : 'linear-gradient(90deg,var(--brand),#2563eb)'}"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700">
                    <span style="color:var(--text-tertiary)">${formatNumber(spent)} / ${formatNumber(budget)} ₴</span>
                    <span style="color:${isOverBudget ? 'var(--danger)' : 'var(--success)'}">${isOverBudget ? `Перевищено на ${formatNumber(spent - budget)} ₴` : `Залишок: ${formatNumber(budgetRemaining)} ₴`}</span>
                </div>
            </div>` : ''}

            <!-- Reminder -->
            <div id="reminderBanner" class="hidden" style="background:linear-gradient(135deg,var(--brand),#6366f1,#7c3aed);padding:20px;border-radius:var(--radius-sm);color:white;position:relative;overflow:hidden;box-shadow:0 10px 30px -5px rgba(0,122,255,0.3)">
                <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
                    <div style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">🔔</div>
                    <div>
                        <p style="font-size:14px;font-weight:900">Час подавати показники!</p>
                        <p style="font-size:10px;opacity:0.8" id="reminderText"></p>
                    </div>
                </div>
                <button id="reminderDismissBtn" style="width:100%;background:white;color:var(--brand);font-weight:900;font-size:12px;padding:12px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1)"><i class="fa-solid fa-check-circle" style="margin-right:6px"></i>Вже передав</button>
            </div>

            <!-- Action buttons -->
            <div class="dash-actions">
                <button id="dashAddBtn" class="dash-action-primary" aria-label="Внести показники">
                    <i class="fa-solid fa-plus"></i>
                    <span>Внести</span>
                    <small>показники</small>
                </button>
                <button id="dashHistoryBtn" class="dash-action-secondary" aria-label="Переглянути історію">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <span>Історія</span>
                    <small>всі записи</small>
                </button>
            </div>

            <!-- Empty state -->
            ${!hasRecords ? `
            <div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-plus"></i></div>
                <p class="empty-title">Почніть вести облік</p>
                <p class="empty-text">Внесіть перші показники лічильників</p>
            </div>` : ''}

            <!-- Stats — collapsible (тільки якщо є записи) -->
            ${hasRecords ? `
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
            </details>` : ''}

            <!-- Donut — структура витрат (тільки якщо є поточний запис) -->
            ${curRec && curRec.total > 0 ? `
            <details class="card details-card">
                <summary class="details-summary">
                    <div class="details-icon purple"><i class="fa-solid fa-chart-pie"></i></div>
                    <span>Структура витрат</span>
                    <i class="fa-solid fa-chevron-down details-chevron"></i>
                </summary>
                <div class="details-body">
                    <div style="display:flex;align-items:center;gap:16px">
                        <canvas id="donutCanvas" style="width:96px;height:96px;flex-shrink:0" aria-label="Кругова діаграма"></canvas>
                        <div id="donutLegend" style="display:flex;flex-wrap:wrap;gap:8px"></div>
                    </div>
                </div>
            </details>` : ''}

            <!-- Tips -->
            ${tips.length > 0 ? `
            <details class="card details-card">
                <summary class="details-summary">
                    <div class="details-icon amber">💡</div>
                    <span>Рекомендації</span>
                    <i class="fa-solid fa-chevron-down details-chevron"></i>
                </summary>
                <div class="details-body space-y-3">
                    ${tips.map(t => `
                        <div style="display:flex;align-items:flex-start;gap:12px;background:var(--input-bg);padding:12px;border-radius:var(--radius-xs);border:1px solid var(--border)">
                            <span style="font-size:1.1rem;flex-shrink:0">${t.emoji}</span>
                            <p style="font-size:12px;font-weight:600;color:var(--text-secondary);line-height:1.4">${escapeHtml(t.text)}</p>
                        </div>
                    `).join('')}
                </div>
            </details>` : ''}

            <!-- Achievements -->
            ${hasRecords ? achievementsHtml : ''}

            <!-- Year report -->
            ${hasMultiple ? `
            <button id="yearReportBtn" class="card" style="width:100%;padding:16px;display:flex;align-items:center;justify-content:space-between;text-align:left">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:40px;height:40px;background:linear-gradient(135deg,#a78bfa,#ec4899);border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-size:1.1rem;box-shadow:0 8px 20px -5px rgba(168,85,247,0.3)">📊</div>
                    <div>
                        <p style="font-size:14px;font-weight:900;color:var(--text-primary)">Річний звіт</p>
                        <p style="font-size:10px;color:var(--text-tertiary)">Інфографіка за рік</p>
                    </div>
                </div>
                <i class="fa-solid fa-chevron-right" style="color:var(--text-quaternary)"></i>
            </button>` : ''}
        </div>
    `;

    // === BIND EVENTS ===
    $('dashAddBtn')?.addEventListener('click', () => switchTab(1));
    $('dashHistoryBtn')?.addEventListener('click', () => switchTab(2));
    $('yearReportBtn')?.addEventListener('click', generateYearReport);
    $('reminderDismissBtn')?.addEventListener('click', () => {
        localStorage.setItem('lastSubmittedMonth', now.getFullYear() + '-' + now.getMonth());
        $('reminderBanner')?.classList.add('hidden');
        showToast("Нагадаємо наступного місяця", "🔔");
    });

    // Achievements clicks
    bindAchievementClicks(container);

    // Update debt badge in nav
    const debtBadge = $('debtBadge');
    if (debtBadge) {
        if (unpaid.length > 0) { debtBadge.classList.remove('hidden'); debtBadge.textContent = unpaid.length; }
        else { debtBadge.classList.add('hidden'); }
    }

    // Render charts (after DOM ready)
    setTimeout(() => {
        if (hasRecords && $('dashChartCanvas')) {
            renderDashChart(records);
        }
        if (curRec && curRec.total > 0 && $('donutCanvas')) {
            renderDonut(curRec);
        }
    }, 100);

    // Reminders
    checkReminders(prefs);
}

// =================== DONUT CHART ===================
function renderDonut(rec) {
    const canvas = $('donutCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;

    const data = [];
    if (rec.waterCost > 0) data.push({ value: rec.waterCost, color: '#3b82f6', label: 'Вода' });
    if (rec.hotWaterCost > 0) data.push({ value: rec.hotWaterCost, color: '#ef4444', label: 'Гар.' });
    if (rec.electroCost > 0) data.push({ value: rec.electroCost, color: '#eab308', label: 'Електрика' });
    if (rec.gasCost > 0) data.push({ value: rec.gasCost, color: '#f97316', label: 'Газ' });
    if (rec.customCost > 0) data.push({ value: rec.customCost, color: '#a855f7', label: 'Інше' });

    if (!data.length) return;

    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) / 2 - 8;
    const inner = radius * 0.6;
    const total = data.reduce((s, d) => s + d.value, 0);
    let startAngle = -Math.PI / 2;

    data.forEach(d => {
        const slice = (d.value / total) * Math.PI * 2;
        const end = startAngle + slice;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, end);
        ctx.arc(cx, cy, inner, end, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = d.color;
        ctx.fill();
        startAngle = end;
    });

    // Center text
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1c1c1e';
    ctx.font = `bold 12px -apple-system`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(formatNumber(total), cx, cy - 4);
    ctx.fillStyle = '#8e8e93'; ctx.font = '9px -apple-system';
    ctx.fillText('₴', cx, cy + 10);

    // Legend
    const legend = $('donutLegend');
    if (legend) {
        legend.innerHTML = data.map(d => `
            <div style="display:flex;align-items:center;gap:6px">
                <div style="width:10px;height:10px;border-radius:50%;background:${d.color}"></div>
                <span style="font-size:9px;font-weight:700;color:var(--text-tertiary)">${d.label}</span>
            </div>
        `).join('');
    }
}

// =================== SMART INSIGHT ===================
function getSmartInsight(records, curRec, curMonth) {
    if (records.length < 2) return null;
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month));
    const [sy, sm] = curMonth.split('-').map(Number);
    const prevDate = new Date(sy, sm - 2);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevRec = sorted.find(r => r.month === prevMonth);

    if (curRec && prevRec && prevRec.total > 0) {
        const diff = Math.round(((curRec.total - prevRec.total) / prevRec.total) * 100);
        if (diff < -10) return `Зекономили ${Math.abs(diff)}% порівняно з ${new Date(prevMonth + '-01').toLocaleString('uk-UA', { month: 'long' })} 🎉`;
        if (diff > 15) return `Витрати +${diff}% порівняно з минулим місяцем`;
        if (diff >= -10 && diff <= 5) return `Витрати стабільні — чудово! 👍`;
    }

    if (records.length >= 3) {
        const avg = sorted.slice(0, 3).reduce((s, r) => s + r.total, 0) / 3;
        return `Середні за 3 міс: ${formatNumber(avg)} ₴`;
    }

    const str = getStreak(records);
    if (str >= 3) return `Серія ${str} міс — так тримати! 🔥`;

    return null;
}

// =================== SMART TIPS ===================
function getSmartTips(records, prefs) {
    const tips = [];
    if (records.length < 3) return tips;

    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month));

    // Water trend
    const waterTrend = getTrend(sorted, r => Math.max(0, (r.wCur || 0) - (r.wPrev || 0)));
    if (waterTrend > 20) tips.push({ emoji: '💧', text: `Споживання води зросло на ${waterTrend}%. Перевірте крани.` });

    // Electro trend
    const electroTrend = getTrend(sorted, r => Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0)));
    if (electroTrend > 20) tips.push({ emoji: '⚡', text: `Електрика +${electroTrend}%. Перевірте прилади.` });
    if (electroTrend < -10) tips.push({ emoji: '🎉', text: `Електрика -${Math.abs(electroTrend)}%! Чудова економія!` });

    // Budget
    const budget = parseFloat(localStorage.getItem('k_budget')) || 0;
    if (budget && sorted[0]?.total > budget * 1.2) {
        tips.push({ emoji: '⚠️', text: `Перевищили бюджет на ${Math.round(((sorted[0].total - budget) / budget) * 100)}%` });
    }

    // Unpaid
    const unpaid = records.filter(r => !r.paid);
    if (unpaid.length >= 3) tips.push({ emoji: '💳', text: `${unpaid.length} неоплачених місяців. Оплатіть борг.` });

    // Night usage
    if (prefs.showElectro && prefs.electroTwoZone && sorted.length > 0) {
        const last = sorted[0];
        const night = Math.max(0, (last.nCur || 0) - (last.nPrev || 0));
        const day = Math.max(0, (last.dCur || 0) - (last.dPrev || 0));
        const total = night + day;
        if (total > 0 && night / total < 0.3) tips.push({ emoji: '🌙', text: 'Спробуйте більше електрики вночі — дешевше.' });
    }

    return tips.slice(0, 3);
}

function getTrend(sorted, getValue) {
    if (sorted.length < 4) return 0;
    const values = sorted.slice(0, 6).map(getValue).reverse();
    const first = values.slice(0, Math.ceil(values.length / 2));
    const second = values.slice(Math.ceil(values.length / 2));
    const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
    const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
    if (avgFirst === 0) return 0;
    return Math.round(((avgSecond - avgFirst) / avgFirst) * 100);
}

// =================== REMINDERS ===================
function checkReminders(prefs) {
    if (!prefs.remindersEnabled) return;
    const monthKey = new Date().getFullYear() + '-' + new Date().getMonth();
    if (localStorage.getItem('lastSubmittedMonth') === monthKey) return;

    const d = new Date().getDate();
    const msgs = [];
    const wS = prefs.remWaterStart || 1, wE = prefs.remWaterEnd || 5;
    const eS = prefs.remElectroStart || 28, eE = prefs.remElectroEnd || 3;
    const isW = wS <= wE ? (d >= wS && d <= wE) : (d >= wS || d <= wE);
    const isE = eS <= eE ? (d >= eS && d <= eE) : (d >= eS || d <= eE);
    if (isW && (prefs.showWater || prefs.showHotWater)) msgs.push("💧 Воду");
    if (isE && prefs.showElectro) msgs.push("⚡ Електрику");

    if (msgs.length > 0) {
        $('reminderBanner')?.classList.remove('hidden');
        const text = $('reminderText');
        if (text) text.textContent = "Передайте: " + msgs.join(" та ");
    }
}

// =================== YEAR REPORT ===================
async function generateYearReport() {
    const records = state.get('records') || [];
    const year = new Date().getFullYear();
    const yr = records.filter(r => r.month.startsWith(String(year)));
    if (!yr.length) { showToast('Немає даних за рік', '⚠️'); return; }

    const total = yr.reduce((s, r) => s + r.total, 0);
    const avg = total / yr.length;
    const maxR = yr.reduce((a, b) => a.total > b.total ? a : b);
    const minR = yr.reduce((a, b) => a.total < b.total ? a : b);
    const paid = yr.filter(r => r.paid).length;
    const wT = yr.reduce((s, r) => s + (r.waterCost || 0), 0);
    const eT = yr.reduce((s, r) => s + (r.electroCost || 0), 0);
    const gT = yr.reduce((s, r) => s + (r.gasCost || 0), 0);
    const cT = yr.reduce((s, r) => s + (r.customCost || 0), 0);
    const maxM = new Date(maxR.month + '-01').toLocaleString('uk-UA', { month: 'long' });
    const minM = new Date(minR.month + '-01').toLocaleString('uk-UA', { month: 'long' });
    const streak = getStreak(records);

    const { showBottomSheet } = await import('./ui.js');
    showBottomSheet(`📊 Річний звіт ${year}`, `
        <div class="space-y-4">
            <div style="text-align:center">
                <p style="font-size:2rem;font-weight:900;color:var(--text-primary)">${formatNumber(total)} ₴</p>
                <p class="stat-label" style="margin-top:4px">Загальні витрати</p>
            </div>
            <div class="grid-2">
                <div class="stat-item"><p class="stat-label">Середній</p><p class="stat-value">${formatNumber(avg)} ₴</p></div>
                <div class="stat-item"><p class="stat-label">Місяців</p><p class="stat-value">${yr.length}</p></div>
            </div>
            <div style="background:rgba(52,199,89,0.08);padding:16px;border-radius:var(--radius-xs)">
                <div style="display:flex;justify-content:space-between"><span style="font-weight:700;color:#15803d">📉 Найдешевший</span><span style="font-weight:900;color:#15803d">${formatNumber(minR.total)} ₴</span></div>
                <p style="font-size:10px;color:#16a34a;margin-top:2px">${minM}</p>
            </div>
            <div style="background:rgba(255,59,48,0.08);padding:16px;border-radius:var(--radius-xs)">
                <div style="display:flex;justify-content:space-between"><span style="font-weight:700;color:#dc2626">📈 Найдорожчий</span><span style="font-weight:900;color:#dc2626">${formatNumber(maxR.total)} ₴</span></div>
                <p style="font-size:10px;color:#ef4444;margin-top:2px">${maxM}</p>
            </div>
            <div style="background:var(--input-bg);padding:16px;border-radius:var(--radius-xs)">
                <p class="stat-label" style="margin-bottom:12px">Розподіл</p>
                <div class="space-y-3" style="font-size:12px">
                    ${wT > 0 ? `<div style="display:flex;justify-content:space-between"><span style="font-weight:700;color:var(--text-secondary)">💧 Вода</span><span style="font-weight:900">${formatNumber(wT)} ₴ (${Math.round(wT/total*100)}%)</span></div>` : ''}
                    ${eT > 0 ? `<div style="display:flex;justify-content:space-between"><span style="font-weight:700;color:var(--text-secondary)">⚡ Електрика</span><span style="font-weight:900">${formatNumber(eT)} ₴ (${Math.round(eT/total*100)}%)</span></div>` : ''}
                    ${gT > 0 ? `<div style="display:flex;justify-content:space-between"><span style="font-weight:700;color:var(--text-secondary)">🔥 Газ</span><span style="font-weight:900">${formatNumber(gT)} ₴ (${Math.round(gT/total*100)}%)</span></div>` : ''}
                    ${cT > 0 ? `<div style="display:flex;justify-content:space-between"><span style="font-weight:700;color:var(--text-secondary)">📦 Фіксовані</span><span style="font-weight:900">${formatNumber(cT)} ₴ (${Math.round(cT/total*100)}%)</span></div>` : ''}
                </div>
            </div>
            <div class="grid-2">
                <div style="background:var(--brand-light);padding:12px;border-radius:var(--radius-xs);text-align:center;border:1px solid var(--brand-border)">
                    <p class="stat-label" style="color:var(--brand)">Оплачено</p>
                    <p style="font-size:1.1rem;font-weight:900;color:var(--brand)">${paid}/${yr.length}</p>
                </div>
                <div style="background:rgba(255,149,0,0.08);padding:12px;border-radius:var(--radius-xs);text-align:center;border:1px solid rgba(255,149,0,0.2)">
                    <p class="stat-label" style="color:var(--warning)">Серія</p>
                    <p style="font-size:1.1rem;font-weight:900;color:var(--warning)">${streak} 🔥</p>
                </div>
            </div>
            <button id="shareYearReportBtn" class="btn-primary" style="margin-top:8px"><i class="fa-solid fa-share" style="margin-right:8px"></i>Поділитись</button>
        </div>
    `);

    // Share button
    setTimeout(() => {
        $('shareYearReportBtn')?.addEventListener('click', async () => {
            let text = `📊 Річний звіт ${year}\n═══════════════\n💰 Всього: ${formatNumber(total)} ₴\n📈 Середній: ${formatNumber(avg)} ₴/міс\n📅 Записів: ${yr.length}\n🔥 Серія: ${streak} міс.\n═══════════════`;
            if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) {} }
            try { await navigator.clipboard.writeText(text); showToast('Скопійовано!', '📋'); } catch (e) {}
        });
    }, 300);

    haptic('success');
}

// =================== STREAK ===================
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
