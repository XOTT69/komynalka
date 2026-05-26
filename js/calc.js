// ============================================================
// CALCULATOR TAB
// ============================================================
import { state } from './state.js';
import { $, formatNumber, escapeHtml } from './ui.js';
import { debouncedSync } from './sync.js';
import { switchTab } from './tabs.js';
import { showToast } from './ui.js';

const READING_IDS = ['wPrev', 'wCur', 'hwPrev', 'hwCur', 'dPrev', 'dCur', 'nPrev', 'nCur', 'gPrev', 'gCur'];

let calcRendered = false;

export function renderCalcTab() {
    const container = $('tabCalc');
    if (!container) return;

    const prefs = state.get('prefs');
    const tariffs = state.get('tariffs');
    const customServices = state.get('customServices') || [];

    container.innerHTML = `
        <div class="space-y-4 pt-2">
            <!-- Hero -->
            <div class="calc-hero">
                <div style="position:relative;z-index:1">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
                        <div style="display:flex;align-items:center;gap:12px">
                            <input type="month" id="monthInput" class="month-input" required>
                            <div class="partial-indicator">
                                <span class="partial-dot" id="partialWater"></span>
                                <span class="partial-dot" id="partialElectro"></span>
                                <span class="partial-dot" id="partialGas"></span>
                            </div>
                        </div>
                        ${prefs.electroWinter ? `
                        <label class="winter-toggle">
                            <input type="checkbox" id="isWinterInput">
                            <span>❄️ Зима</span>
                        </label>` : ''}
                    </div>
                    <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;opacity:0.5;margin-bottom:8px">До сплати</p>
                    <p class="calc-total" id="heroTotal">0 <span class="calc-total-symbol">₴</span></p>
                    <div style="margin-top:20px;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.08);padding:14px 20px;border-radius:1rem;border:1px solid rgba(255,255,255,0.05)">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="width:28px;height:28px;background:rgba(255,255,255,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot" style="font-size:11px;opacity:0.7"></i></div>
                            <span style="font-size:10px;opacity:0.6;font-weight:700;text-transform:uppercase;letter-spacing:0.15em">Прогноз</span>
                        </div>
                        <span style="font-size:16px;font-weight:900" id="smartForecast">—</span>
                    </div>
                    <button type="button" id="btnClearFields" style="width:100%;margin-top:12px;font-size:12px;font-weight:700;padding:10px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);transition:all 0.2s">
                        <i class="fa-solid fa-eraser" style="margin-right:6px;opacity:0.7"></i>Очистити поля
                    </button>
                </div>
            </div>

            <!-- Form -->
            <form id="utilityForm" class="space-y-4" style="padding-bottom:24px">
                ${prefs.showWater ? renderServiceBlock('water', '💧', 'Холодна вода', 'wPrev', 'wCur', 'wDiffBadge', 'м³', 'blue') : ''}
                ${prefs.showHotWater ? renderServiceBlock('hotWater', '🌡️', 'Гаряча вода', 'hwPrev', 'hwCur', 'hwDiffBadge', 'м³', 'red') : ''}
                ${prefs.showElectro ? renderElectroBlock(prefs) : ''}
                ${prefs.showGas ? renderServiceBlock('gas', '🔥', 'Газ', 'gPrev', 'gCur', 'gDiffBadge', 'м³', 'orange') : ''}
                ${customServices.length > 0 ? renderCustomBlock(customServices) : ''}
                
                <!-- Note -->
                <div class="service-card">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                        <div class="service-icon" style="background:var(--input-bg);color:var(--text-tertiary);box-shadow:none"><i class="fa-solid fa-sticky-note"></i></div>
                        <span class="service-name">Нотатка</span>
                    </div>
                    <textarea id="recordNote" rows="2" placeholder="Коментар до запису..." style="width:100%;padding:14px;background:var(--input-bg);border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;font-weight:500;color:var(--text-primary);outline:none;resize:none;transition:all 0.2s"></textarea>
                </div>

                <!-- Submit -->
                <button type="submit" id="submitFormBtn" class="btn-primary">
                    <i class="fa-solid fa-floppy-disk"></i>
                    <span>Зберегти</span>
                </button>
            </form>
        </div>
    `;

    // Set month
    const monthInput = $('monthInput');
    if (monthInput) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Bind events
    bindCalcEvents();
    fillPreviousReadings();
    calculatePreview();
    updateSmartBadges();
    calcRendered = true;
}

function renderServiceBlock(type, emoji, name, prevId, curId, badgeId, unit, color) {
    const colorMap = { blue: 'water', red: 'hot-water', orange: 'gas' };
    return `
        <div class="service-card" id="block_${type}">
            <div class="service-header">
                <div style="display:flex;align-items:center;gap:12px">
                    <div class="service-icon ${colorMap[color] || color}"><i class="fa-solid fa-${type === 'water' ? 'droplet' : type === 'gas' ? 'fire' : 'temperature-three-quarters'}"></i></div>
                    <span class="service-name">${name}</span>
                </div>
                <span class="service-cost" id="${type}CostDisplay">0 ₴</span>
            </div>
            <div class="readings-row">
                <div class="reading-col">
                    <label class="reading-label" for="${prevId}">Минулі</label>
                    <input type="number" id="${prevId}" inputmode="decimal" placeholder="—" class="reading-input" aria-label="Минулі показники ${name}">
                </div>
                <div class="diff-badge" id="${badgeId}">0 ${unit}</div>
                <div class="reading-col">
                    <label class="reading-label accent" for="${curId}">Нові</label>
                    <input type="number" id="${curId}" inputmode="decimal" placeholder="—" class="reading-input accent" aria-label="Нові показники ${name}">
                </div>
            </div>
        </div>`;
}

function renderElectroBlock(prefs) {
    return `
        <div class="service-card" id="block_electro">
            <div class="service-header">
                <div style="display:flex;align-items:center;gap:12px">
                    <div class="service-icon electro"><i class="fa-solid fa-bolt"></i></div>
                    <span class="service-name">Електрика</span>
                </div>
                <span class="service-cost" id="electroCostDisplay">0 ₴</span>
            </div>
            <div class="space-y-3">
                <div class="readings-row">
                    <div class="reading-col">
                        <label class="reading-label" for="dPrev">Мин ${prefs.electroTwoZone ? '(День)' : ''}</label>
                        <input type="number" id="dPrev" inputmode="decimal" placeholder="—" class="reading-input" aria-label="Минулі показники день">
                    </div>
                    <div class="diff-badge" id="dDiffBadge">0 кВт</div>
                    <div class="reading-col">
                        <label class="reading-label accent" for="dCur">Нові ${prefs.electroTwoZone ? '(День)' : ''}</label>
                        <input type="number" id="dCur" inputmode="decimal" placeholder="—" class="reading-input accent" aria-label="Нові показники день">
                    </div>
                </div>
                ${prefs.electroTwoZone ? `
                <div class="readings-row">
                    <div class="reading-col">
                        <label class="reading-label" for="nPrev">Мин (Ніч)</label>
                        <input type="number" id="nPrev" inputmode="decimal" placeholder="—" class="reading-input" aria-label="Минулі показники ніч">
                    </div>
                    <div class="diff-badge" id="nDiffBadge">0 кВт</div>
                    <div class="reading-col">
                        <label class="reading-label accent" for="nCur">Нові (Ніч)</label>
                        <input type="number" id="nCur" inputmode="decimal" placeholder="—" class="reading-input accent" aria-label="Нові показники ніч">
                    </div>
                </div>` : ''}
            </div>
        </div>`;
}

function renderCustomBlock(services) {
    return `
        <div class="service-card" id="block_custom">
            <div class="service-header">
                <div style="display:flex;align-items:center;gap:12px">
                    <div class="service-icon custom"><i class="fa-solid fa-box-open"></i></div>
                    <span class="service-name">Фіксовані</span>
                </div>
                <span class="service-cost" id="customCostDisplay">0 ₴</span>
            </div>
            <div class="grid-2">
                ${services.map(srv => `
                    <div style="background:var(--input-bg);border-radius:var(--radius-sm);padding:12px;border:1px solid var(--border)">
                        <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-quaternary);margin-bottom:6px;text-align:center">${escapeHtml(srv.name) || 'Послуга'}</label>
                        <input type="number" step="0.01" id="custom_${srv.id}" class="custom-srv-input" placeholder="${srv.defaultSum || '0.00'}" style="width:100%;padding:10px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xs);font-size:1.1rem;font-weight:900;text-align:center;color:var(--text-primary);outline:none" aria-label="${escapeHtml(srv.name)}">
                    </div>
                `).join('')}
            </div>
        </div>`;
}

// =================== EVENTS ===================
function bindCalcEvents() {
    // Reading inputs
    READING_IDS.forEach(id => {
        $(id)?.addEventListener('input', () => {
            calculatePreview();
            updateSmartBadges();
            saveDraft();
        });
    });

    // Custom inputs
    document.querySelectorAll('.custom-srv-input').forEach(input => {
        input.addEventListener('input', () => { calculatePreview(); saveDraft(); });
    });

    // Month change
    $('monthInput')?.addEventListener('change', () => {
        fillPreviousReadings();
        calculatePreview();
        updateSmartBadges();
    });

    // Winter toggle
    $('isWinterInput')?.addEventListener('change', calculatePreview);

    // Clear
    $('btnClearFields')?.addEventListener('click', clearFields);

    // Submit
    $('utilityForm')?.addEventListener('submit', handleSubmit);

    // Enter key navigation
    const inputs = READING_IDS.map(id => $(id)).filter(el => el && el.offsetParent !== null);
    inputs.forEach((input, idx) => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const next = inputs[idx + 1];
                if (next) next.focus(); else $('submitFormBtn')?.focus();
            }
        });
    });
}

// =================== CALCULATION ===================
function getV(id) { return Math.max(0, parseFloat($(id)?.value) || 0); }

function calculatePreview() {
    const prefs = state.get('prefs');
    const tariffs = state.get('tariffs');
    const customServices = state.get('customServices') || [];
    const calc = { waterCost: 0, hotWaterCost: 0, electroCost: 0, gasCost: 0, customCost: 0, total: 0 };

    // Water
    if (prefs.showWater) calc.waterCost = Math.max(0, getV('wCur') - getV('wPrev')) * tariffs.water;

    // Hot water
    if (prefs.showHotWater) calc.hotWaterCost = Math.max(0, getV('hwCur') - getV('hwPrev')) * tariffs.hotWater;

    // Electro
    if (prefs.showElectro) {
        const dV = Math.max(0, getV('dCur') - getV('dPrev'));
        const nV = prefs.electroTwoZone ? Math.max(0, getV('nCur') - getV('nPrev')) : 0;
        const total = dV + nV;
        if (total > 0) {
            const isWinter = prefs.electroWinter && $('isWinterInput')?.checked;
            if (isWinter) {
                if (total <= tariffs.winterLimit) {
                    calc.electroCost = dV * tariffs.electroWinter + nV * tariffs.electroWinter * tariffs.nightCoef;
                } else {
                    const dp = dV / total, np = nV / total;
                    calc.electroCost =
                        tariffs.winterLimit * dp * tariffs.electroWinter +
                        tariffs.winterLimit * np * tariffs.electroWinter * tariffs.nightCoef +
                        (total - tariffs.winterLimit) * dp * tariffs.electroBase +
                        (total - tariffs.winterLimit) * np * tariffs.electroBase * tariffs.nightCoef;
                }
            } else {
                calc.electroCost = dV * tariffs.electroBase + nV * tariffs.electroBase * tariffs.nightCoef;
            }
        }
    }

    // Gas
    if (prefs.showGas) calc.gasCost = Math.max(0, getV('gCur') - getV('gPrev')) * tariffs.gas;

    // Custom
    customServices.forEach(srv => {
        let val = parseFloat($(`custom_${srv.id}`)?.value);
        if (isNaN(val) && srv.defaultSum) val = parseFloat(srv.defaultSum);
        if (!isNaN(val)) calc.customCost += val;
    });

    calc.total = calc.waterCost + calc.hotWaterCost + calc.electroCost + calc.gasCost + calc.customCost;

    // Validate
    if (!validateReadings()) return;

    // Update UI
    state.set('currentCalc', calc);
    if ($('heroTotal')) $('heroTotal').innerHTML = `${formatNumber(calc.total)} <span class="calc-total-symbol">₴</span>`;
    if ($('waterCostDisplay')) $('waterCostDisplay').textContent = formatNumber(calc.waterCost) + ' ₴';
    if ($('hotWaterCostDisplay')) $('hotWaterCostDisplay').textContent = formatNumber(calc.hotWaterCost) + ' ₴';
    if ($('electroCostDisplay')) $('electroCostDisplay').textContent = formatNumber(calc.electroCost) + ' ₴';
    if ($('gasCostDisplay')) $('gasCostDisplay').textContent = formatNumber(calc.gasCost) + ' ₴';
    if ($('customCostDisplay')) $('customCostDisplay').textContent = formatNumber(calc.customCost) + ' ₴';

    updateForecast();
}

function validateReadings() {
    const pairs = [['wPrev', 'wCur'], ['hwPrev', 'hwCur'], ['dPrev', 'dCur'], ['nPrev', 'nCur'], ['gPrev', 'gCur']];
    let hasInvalid = false;
    pairs.forEach(([prevId, curId]) => {
        const prevEl = $(prevId), curEl = $(curId);
        if (!prevEl || !curEl || prevEl.offsetParent === null) return;
        const invalid = curEl.value !== '' && prevEl.value !== '' && parseFloat(curEl.value) < parseFloat(prevEl.value);
        prevEl.classList.toggle('invalid', invalid);
        curEl.classList.toggle('invalid', invalid);
        if (invalid) hasInvalid = true;
    });
    const btn = $('submitFormBtn');
    if (btn) { btn.disabled = hasInvalid; }
    if (hasInvalid && $('heroTotal')) $('heroTotal').innerHTML = '<span style="font-size:1rem;color:#fca5a5">Перевірте показники</span>';
    return !hasInvalid;
}

function updateSmartBadges() {
    const update = (prevId, curId, badgeId, unit) => {
        const badge = $(badgeId); if (!badge) return;
        const d = getV(curId) - getV(prevId);
        badge.textContent = d > 0 ? `+${d} ${unit}` : `0 ${unit}`;
        badge.classList.toggle('active', d > 0);
    };
    const prefs = state.get('prefs');
    if (prefs.showWater) update('wPrev', 'wCur', 'wDiffBadge', 'м³');
    if (prefs.showHotWater) update('hwPrev', 'hwCur', 'hwDiffBadge', 'м³');
    if (prefs.showElectro) {
        update('dPrev', 'dCur', 'dDiffBadge', 'кВт');
        if (prefs.electroTwoZone) update('nPrev', 'nCur', 'nDiffBadge', 'кВт');
    }
    if (prefs.showGas) update('gPrev', 'gCur', 'gDiffBadge', 'м³');
}

function updateForecast() {
    const el = $('smartForecast'); if (!el) return;
    const records = state.get('records') || [];
    if (!records.length) { el.textContent = '—'; return; }
    const month = $('monthInput')?.value;
    if (!month) { el.textContent = '—'; return; }
    const [, sm] = month.split('-').map(Number);
    const same = records.filter(r => parseInt(r.month.split('-')[1]) === sm);
    if (same.length > 0) {
        el.textContent = `~ ${formatNumber(same.reduce((s, r) => s + r.total, 0) / same.length)} ₴`;
    } else {
        const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month));
        const avg = sorted.slice(0, 3).reduce((s, r) => s + r.total, 0) / Math.min(3, sorted.length);
        el.textContent = `~ ${formatNumber(avg)} ₴`;
    }
}

// =================== FILL PREVIOUS ===================
function fillPreviousReadings() {
    READING_IDS.forEach(id => { if ($(id)) $(id).value = ''; });
    document.querySelectorAll('.custom-srv-input').forEach(el => el.value = '');
    if ($('recordNote')) $('recordNote').value = '';

    const records = state.get('records') || [];
    const prefs = state.get('prefs');
    const month = $('monthInput')?.value;
    if (!month || !records.length) return;

    const [sy, sm] = month.split('-').map(Number);
    const prevMonth = `${new Date(sy, sm - 2).getFullYear()}-${String(new Date(sy, sm - 2).getMonth() + 1).padStart(2, '0')}`;
    const prevRec = records.find(r => r.month === prevMonth);
    const curRec = records.find(r => r.month === month);

    if (prevRec) {
        if (prefs.showWater && $('wPrev')) $('wPrev').value = prevRec.wCur || '';
        if (prefs.showHotWater && $('hwPrev')) $('hwPrev').value = prevRec.hwCur || '';
        if (prefs.showElectro) { if ($('dPrev')) $('dPrev').value = prevRec.dCur || ''; if (prefs.electroTwoZone && $('nPrev')) $('nPrev').value = prevRec.nCur || ''; }
        if (prefs.showGas && $('gPrev')) $('gPrev').value = prevRec.gCur || '';
    }

    if (curRec) {
        if (prefs.showWater) { if ($('wPrev')) $('wPrev').value = curRec.wPrev || ''; if ($('wCur')) $('wCur').value = curRec.wCur || ''; }
        if (prefs.showHotWater) { if ($('hwPrev')) $('hwPrev').value = curRec.hwPrev || ''; if ($('hwCur')) $('hwCur').value = curRec.hwCur || ''; }
        if (prefs.showElectro) { if ($('dPrev')) $('dPrev').value = curRec.dPrev || ''; if ($('dCur')) $('dCur').value = curRec.dCur || ''; if (prefs.electroTwoZone) { if ($('nPrev')) $('nPrev').value = curRec.nPrev || ''; if ($('nCur')) $('nCur').value = curRec.nCur || ''; } }
        if (prefs.showGas) { if ($('gPrev')) $('gPrev').value = curRec.gPrev || ''; if ($('gCur')) $('gCur').value = curRec.gCur || ''; }
        if (curRec.customData) Object.entries(curRec.customData).forEach(([id, d]) => { const el = $(`custom_${id}`); if (el) el.value = d.val; });
        if ($('recordNote')) $('recordNote').value = curRec.note || '';
    } else {
        const customServices = state.get('customServices') || [];
        customServices.forEach(srv => { const el = $(`custom_${srv.id}`); if (el && srv.defaultSum) el.value = srv.defaultSum; });
    }

    // Winter auto
    const mo = new Date(month + '-01').getMonth() + 1;
    if ($('isWinterInput')) $('isWinterInput').checked = mo >= 10 || mo <= 4;
}

// =================== SUBMIT ===================
async function handleSubmit(e) {
    e.preventDefault();
    if (!validateReadings()) { showToast('Перевірте показники', '⚠️'); return; }

    const prefs = state.get('prefs');
    const calc = state.get('currentCalc');
    const customServices = state.get('customServices') || [];
    const records = state.get('records') || [];

    const hasWater = prefs.showWater && (getV('wCur') > 0 || getV('wPrev') > 0);
    const hasHotWater = prefs.showHotWater && (getV('hwCur') > 0 || getV('hwPrev') > 0);
    const hasElectro = prefs.showElectro && (getV('dCur') > 0 || getV('dPrev') > 0 || getV('nCur') > 0);
    const hasGas = prefs.showGas && (getV('gCur') > 0 || getV('gPrev') > 0);
    const hasCustom = customServices.some(srv => { const v = parseFloat($(`custom_${srv.id}`)?.value); return !isNaN(v) && v > 0; });

    if (!hasWater && !hasHotWater && !hasElectro && !hasGas && !hasCustom) {
        showToast('Заповніть хоча б одну послугу', '⚠️'); return;
    }

    let cData = {};
    customServices.forEach(srv => {
        let v = parseFloat($(`custom_${srv.id}`)?.value);
        if (isNaN(v) && srv.defaultSum) v = parseFloat(srv.defaultSum);
        if (!isNaN(v) && v > 0) cData[srv.id] = { name: srv.name, val: v };
    });

    const month = $('monthInput').value;
    const existingIdx = records.findIndex(r => r.month === month);

    const newData = {
        id: Date.now(), month,
        wPrev: hasWater ? getV('wPrev') : 0, wCur: hasWater ? getV('wCur') : 0,
        hwPrev: hasHotWater ? getV('hwPrev') : 0, hwCur: hasHotWater ? getV('hwCur') : 0,
        dPrev: hasElectro ? getV('dPrev') : 0, dCur: hasElectro ? getV('dCur') : 0,
        nPrev: (hasElectro && prefs.electroTwoZone) ? getV('nPrev') : 0,
        nCur: (hasElectro && prefs.electroTwoZone) ? getV('nCur') : 0,
        gPrev: hasGas ? getV('gPrev') : 0, gCur: hasGas ? getV('gCur') : 0,
        customData: cData, note: $('recordNote')?.value?.trim() || '',
        waterCost: calc.waterCost, hotWaterCost: calc.hotWaterCost,
        electroCost: calc.electroCost, gasCost: calc.gasCost,
        customCost: calc.customCost, total: calc.total,
        paid: false,
        _filled: { water: hasWater, hotWater: hasHotWater, electro: hasElectro, gas: hasGas, custom: hasCustom }
    };

    if (existingIdx >= 0) {
        records[existingIdx] = { ...records[existingIdx], ...newData, id: records[existingIdx].id, paid: records[existingIdx].paid };
        showToast("Оновлено! 🔄");
    } else {
        records.push(newData);
        showToast("Збережено! ✨");
    }

    state.set('records', records);
    clearDraft();

    $('submitFormBtn')?.classList.add('success');
    setTimeout(() => $('submitFormBtn')?.classList.remove('success'), 600);

    debouncedSync();

    // Next month
    const [y, m] = month.split('-').map(Number);
    const next = new Date(y, m);
    $('monthInput').value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    fillPreviousReadings(); calculatePreview(); updateSmartBadges();
    switchTab(0);
}

// =================== DRAFT ===================
function saveDraft() {
    const draft = { month: $('monthInput')?.value };
    READING_IDS.forEach(id => { const el = $(id); if (el?.value) draft[id] = el.value; });
    if ($('recordNote')?.value) draft.note = $('recordNote').value;
    localStorage.setItem('komunalka_draft', JSON.stringify(draft));
}

function clearDraft() { localStorage.removeItem('komunalka_draft'); }

function clearFields() {
    READING_IDS.forEach(id => { const el = $(id); if (el) { el.value = ''; el.classList.remove('invalid'); } });
    document.querySelectorAll('.custom-srv-input').forEach(el => el.value = '');
    if ($('recordNote')) $('recordNote').value = '';
    calculatePreview(); updateSmartBadges(); clearDraft();
    showToast('Очищено', '🧼');
}
