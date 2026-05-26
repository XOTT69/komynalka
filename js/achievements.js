// ============================================================
// ACHIEVEMENTS
// ============================================================
import { state } from './state.js';
import { $, escapeHtml, haptic } from './ui.js';

const ACHIEVEMENTS = [
    { id: 'first_record', emoji: '🎉', title: 'Перший запис', desc: 'Зберегли перший розрахунок', check: (r) => r.length >= 1 },
    { id: 'streak_3', emoji: '🔥', title: '3 місяці поспіль', desc: '3 місяці без перерви', check: (r) => getStreak(r) >= 3 },
    { id: 'streak_6', emoji: '💪', title: 'Полугідник', desc: '6 місяців поспіль', check: (r) => getStreak(r) >= 6 },
    { id: 'streak_12', emoji: '👑', title: 'Рік без перерви', desc: 'Цілий рік записів!', check: (r) => getStreak(r) >= 12 },
    { id: 'all_paid', emoji: '✅', title: 'Чистий рахунок', desc: 'Все оплачено', check: (r) => r.length > 0 && r.every(rec => rec.paid) },
    { id: 'records_10', emoji: '📊', title: 'Аналітик', desc: '10+ записів', check: (r) => r.length >= 10 },
    { id: 'saver', emoji: '💰', title: 'Економ', desc: 'Знизили витрати 3 міс поспіль', check: (r) => checkSaver(r) },
    { id: 'multi_address', emoji: '🏘️', title: 'Мультивласник', desc: '2+ адреси', check: () => (state.get('addresses') || []).length >= 2 },
    { id: 'budget_master', emoji: '🎯', title: 'Бюджетник', desc: 'Не перевищили бюджет 3 міс', check: (r) => checkBudget(r) },
    { id: 'night_owl', emoji: '🦉', title: 'Нічна сова', desc: '70%+ нічне споживання', check: (r) => checkNightOwl(r) },
];

const HINTS = {
    first_record: 'Збережіть перший розрахунок',
    streak_3: 'Вносіть показники 3 місяці без пропуску',
    streak_6: '6 місяців без пропуску',
    streak_12: 'Рік без пропуску',
    all_paid: 'Позначте всі записи як оплачені',
    records_10: 'Накопичте 10+ записів',
    saver: 'Знижуйте суму 3 місяці поспіль',
    multi_address: 'Додайте другу адресу',
    budget_master: 'Не перевищуйте бюджет 3 міс поспіль',
    night_owl: 'Споживайте 70%+ електрики вночі'
};

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

function checkSaver(recs) {
    if (recs.length < 4) return false;
    const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month));
    return sorted[0].total < sorted[1].total && sorted[1].total < sorted[2].total;
}

function checkBudget(recs) {
    const budget = parseFloat(localStorage.getItem('k_budget')) || 0;
    if (!budget || recs.length < 3) return false;
    const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 3);
    return sorted.every(r => r.total <= budget);
}

function checkNightOwl(recs) {
    if (!recs.length) return false;
    const last = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month))[0];
    const night = Math.max(0, (last.nCur || 0) - (last.nPrev || 0));
    const day = Math.max(0, (last.dCur || 0) - (last.dPrev || 0));
    const total = night + day;
    return total > 0 && (night / total) >= 0.7;
}

// =================== PUBLIC API ===================
export function getUnlocked() {
    const records = state.get('records') || [];
    return ACHIEVEMENTS.filter(a => a.check(records));
}

export function checkNewAchievements() {
    const unlocked = JSON.parse(localStorage.getItem('achievements_unlocked') || '[]');
    const current = getUnlocked();
    const newOnes = current.filter(a => !unlocked.includes(a.id));

    if (newOnes.length > 0) {
        localStorage.setItem('achievements_unlocked', JSON.stringify(current.map(a => a.id)));
        showAchievementToast(newOnes[0]);
    }
}

function showAchievementToast(ach) {
    // Create temporary toast
    const container = document.getElementById('modalsContainer') || document.body;
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `
        <div class="achievement-toast-inner">
            <span style="font-size:3rem">${ach.emoji}</span>
            <p style="font-size:1.1rem;font-weight:900;color:var(--text-primary);margin-top:8px">${ach.title}</p>
            <p style="font-size:0.8rem;color:var(--text-tertiary)">${ach.desc}</p>
        </div>`;
    container.appendChild(toast);

    haptic('success');

    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

export function renderAchievementsWidget() {
    const records = state.get('records') || [];
    const unlocked = getUnlocked().map(a => a.id);

    return `
        <details class="card details-card">
            <summary class="details-summary">
                <div class="details-icon amber">🏆</div>
                <span>Досягнення</span>
                <span style="font-size:9px;font-weight:700;color:var(--brand)">${unlocked.length}/${ACHIEVEMENTS.length}</span>
            </summary>
            <div class="details-body">
                <div style="display:flex;flex-wrap:wrap;gap:12px">
                    ${ACHIEVEMENTS.map(a => `
                        <div class="achievement-item ${unlocked.includes(a.id) ? '' : 'locked'}" data-ach="${a.id}" role="button" tabindex="0" aria-label="${a.title}">
                            <span style="font-size:1.5rem">${a.emoji}</span>
                            <span style="font-size:8px;font-weight:700;color:var(--text-tertiary);line-height:1.2">${a.title}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </details>`;
}

export function bindAchievementClicks(container) {
    container?.querySelectorAll('[data-ach]').forEach(el => {
        el.addEventListener('click', () => {
            const ach = ACHIEVEMENTS.find(a => a.id === el.dataset.ach);
            if (!ach) return;
            const records = state.get('records') || [];
            const isUnlocked = ach.check(records);
            showAchievementDetail(ach, isUnlocked);
        });
    });
}

function showAchievementDetail(ach, isUnlocked) {
    const container = document.getElementById('modalsContainer') || document.body;
    const id = 'achDetail_' + Date.now();

    container.innerHTML = `
        <div id="${id}" class="modal-overlay" onclick="if(event.target===this){this.remove()}">
            <div class="modal-card" style="text-align:center;max-width:320px">
                <div style="font-size:3rem;margin-bottom:12px">${ach.emoji}</div>
                <h3 class="modal-title">${ach.title}</h3>
                <p class="modal-text">${ach.desc}</p>
                <div style="background:var(--input-bg);padding:16px;border-radius:var(--radius-xs);margin-bottom:16px;border:1px solid var(--border)">
                    <p style="font-size:10px;font-weight:700;color:var(--text-quaternary);text-transform:uppercase;margin-bottom:4px">Як отримати</p>
                    <p style="font-size:13px;font-weight:700;color:var(--text-primary)">${HINTS[ach.id] || '—'}</p>
                </div>
                <span style="font-size:12px;font-weight:800;padding:6px 14px;border-radius:8px;${isUnlocked ? 'background:rgba(52,199,89,0.08);color:var(--success)' : 'background:var(--input-bg);color:var(--text-quaternary)'}">
                    ${isUnlocked ? '✓ Отримано' : '🔒 Заблоковано'}
                </span>
            </div>
        </div>`;

    haptic('light');
}
