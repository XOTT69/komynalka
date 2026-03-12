// ─── Розрахунок вартості ───────────────────────────────────────
window.calculatePreview = () => {
  const prefs = window.currentPrefs || {};
  const tariffs = window.currentTariffs || {};
  const isWinter = $('isWinterInput')?.checked;

  let total = 0;
  const eRate = isWinter && prefs.electroWinter ? (tariffs.electroWinter || 0) : (tariffs.electroBase || 0);

  // Вода
  const wDiff = Math.max(0, (+$('wCur')?.value || 0) - (+$('wPrev')?.value || 0));
  const wCost = wDiff * (tariffs.water || 0);
  if ($('wDiffBadge')) $('wDiffBadge').textContent = `${wDiff.toFixed(2)} м³`;
  if ($('waterCostDisplay')) $('waterCostDisplay').textContent = `${fmt.format(wCost)} ₴`;
  if (prefs.water) total += wCost;

  // Гаряча вода
  const hwDiff = Math.max(0, (+$('hwCur')?.value || 0) - (+$('hwPrev')?.value || 0));
  const hwCost = hwDiff * (tariffs.hotWater || 0);
  if ($('hwDiffBadge')) $('hwDiffBadge').textContent = `${hwDiff.toFixed(2)} м³`;
  if ($('hotWaterCostDisplay')) $('hotWaterCostDisplay').textContent = `${fmt.format(hwCost)} ₴`;
  if (prefs.hotWater) total += hwCost;

  // Електро день
  const dDiff = Math.max(0, (+$('dCur')?.value || 0) - (+$('dPrev')?.value || 0));
  const nDiff = Math.max(0, (+$('nCur')?.value || 0) - (+$('nPrev')?.value || 0));
  const eCost = prefs.electroTwoZone
    ? dDiff * eRate + nDiff * (eRate * 0.5)
    : (dDiff + nDiff) * eRate;
  if ($('dDiffBadge')) $('dDiffBadge').textContent = `${dDiff} кВт`;
  if ($('nDiffBadge')) $('nDiffBadge').textContent = `${nDiff} кВт`;
  if ($('electroCostDisplay')) $('electroCostDisplay').textContent = `${fmt.format(eCost)} ₴`;
  if (prefs.electro) total += eCost;

  // Газ
  const gDiff = Math.max(0, (+$('gCur')?.value || 0) - (+$('gPrev')?.value || 0));
  const gCost = gDiff * (tariffs.gas || 0);
  if ($('gDiffBadge')) $('gDiffBadge').textContent = `${gDiff.toFixed(2)} м³`;
  if ($('gasCostDisplay')) $('gasCostDisplay').textContent = `${fmt.format(gCost)} ₴`;
  if (prefs.gas) total += gCost;

  // Кастомні
  let customTotal = 0;
  document.querySelectorAll('.custom-service-input').forEach(inp => {
    customTotal += +inp.value || 0;
  });
  if ($('customCostDisplay')) $('customCostDisplay').textContent = `${fmt.format(customTotal)} ₴`;
  total += customTotal;

  // Hero total з анімацією
  const heroEl = $('heroTotal');
  if (heroEl) heroEl.innerHTML = `${fmt.format(total)} <span class="text-2xl font-bold text-white/50">₴</span>`;

  // Прогноз
  updateForecast();

  return { total, wCost, hwCost, eCost, gCost, customTotal, wDiff, hwDiff, dDiff, nDiff, gDiff };
};

// ─── Прогноз ───────────────────────────────────────────────────
window.updateForecast = () => {
  const recs = window.records || [];
  const sorted = [...recs].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 3);
  if (sorted.length < 2) { $('forecastBadge')?.classList.add('hidden'); return; }
  const avg = Math.round(sorted.reduce((s, r) => s + r.total, 0) / sorted.length);
  $('forecastBadge')?.classList.remove('hidden');
  if ($('forecastValue')) $('forecastValue').textContent = `~${fmt.format(avg)} ₴`;
};

// ─── Автозаповнення минулих показань ──────────────────────────
window.fillPreviousReadings = () => {
  const month = $('monthInput')?.value;
  if (!month || !window.records?.length) return;

  const [year, mon] = month.split('-').map(Number);
  const prevDate = new Date(year, mon - 2);
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prev = window.records.find(r => r.month === prevMonthStr);
  if (!prev) return;

  if ($('wPrev') && !$('wPrev').value)   $('wPrev').value  = prev.wCur  ?? '';
  if ($('hwPrev') && !$('hwPrev').value) $('hwPrev').value = prev.hwCur ?? '';
  if ($('dPrev') && !$('dPrev').value)   $('dPrev').value  = prev.dCur  ?? '';
  if ($('nPrev') && !$('nPrev').value)   $('nPrev').value  = prev.nCur  ?? '';
  if ($('gPrev') && !$('gPrev').value)   $('gPrev').value  = prev.gCur  ?? '';
  calculatePreview();
};

// ─── Відображення блоків ──────────────────────────────────────
window.applyBlockVisibility = () => {
  const p = window.currentPrefs || {};
  $('blockWater')?.classList.toggle('hidden', !p.water);
  $('blockHotWater')?.classList.toggle('hidden', !p.hotWater);
  $('blockElectro')?.classList.toggle('hidden', !p.electro);
  $('blockGas')?.classList.toggle('hidden', !p.gas);
  $('electroNightRow')?.classList.toggle('hidden', !p.electroTwoZone);
  $('winterCheckboxWrapper')?.classList.toggle('hidden', !p.electroWinter);
  $('settingHotWaterWrap')?.classList.toggle('hidden', !p.hotWater);
  $('settingElectroWinterWrap')?.classList.toggle('hidden', !p.electroWinter);
};

// ─── Кастомні послуги ─────────────────────────────────────────
window.renderCustomServiceInputs = () => {
  const services = window.currentPrefs?.customServices || [];
  const container = $('customServicesContainer');
  if (!container) return;
  const frag = document.createDocumentFragment();
  services.forEach(s => {
    const div = document.createElement('div');
    div.className = 'bg-slate-50 dark:bg-black/40 p-3 rounded-2xl';
    div.innerHTML = `
      <label class="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">${s.name}</label>
      <input type="number" class="custom-service-input w-full bg-white dark:bg-[#2c2c2e] border border-slate-200 dark:border-transparent p-2 text-center text-lg font-black rounded-xl outline-none focus:ring-2 focus:ring-purple-500/50" data-id="${s.id}" placeholder="0">
    `;
    frag.appendChild(div);
  });
  container.innerHTML = '';
  container.appendChild(frag);
  container.querySelectorAll('.custom-service-input').forEach(i => i.addEventListener('input', debouncedCalc));
};

// ─── Збереження розрахунку ────────────────────────────────────
window.saveRecord = async () => {
  vibe([10, 5, 10]);
  const month = $('monthInput')?.value;
  if (!month) return showToast('Оберіть місяць', '⚠️');

  const vals = calculatePreview();
  const customServices = {};
  document.querySelectorAll('.custom-service-input').forEach(i => {
    customServices[i.dataset.id] = +i.value || 0;
  });

  const record = {
    month,
    isWinter: $('isWinterInput')?.checked || false,
    wPrev:  +$('wPrev')?.value  || 0, wCur:  +$('wCur')?.value  || 0,
    hwPrev: +$('hwPrev')?.value || 0, hwCur: +$('hwCur')?.value || 0,
    dPrev:  +$('dPrev')?.value  || 0, dCur:  +$('dCur')?.value  || 0,
    nPrev:  +$('nPrev')?.value  || 0, nCur:  +$('nCur')?.value  || 0,
    gPrev:  +$('gPrev')?.value  || 0, gCur:  +$('gCur')?.value  || 0,
    waterCost: vals.wCost, hotWaterCost: vals.hwCost,
    electroCost: vals.eCost, gasCost: vals.gCost,
    customCost: vals.customTotal, customServices,
    total: vals.total,
    paid: false,
    savedAt: Date.now()
  };

  const idx = window.records.findIndex(r => r.month === month);
  if (idx >= 0) window.records[idx] = record;
  else window.records.push(record);

  await syncToCloud();
  showToast('Збережено!', '✅');
};

// ─── Підписка інпутів на дебаунс-розрахунок ──────────────────
const debouncedCalc = debounce(() => calculatePreview(), 120);
const calcInputIds = ['wPrev','wCur','hwPrev','hwCur','dPrev','dCur','nPrev','nCur','gPrev','gCur'];
calcInputIds.forEach(id => {
  document.addEventListener('DOMContentLoaded', () => {
    $(id)?.addEventListener('input', debouncedCalc);
  });
});
$('isWinterInput')?.addEventListener('change', () => calculatePreview());
$('monthInput')?.addEventListener('change', () => {
  fillPreviousReadings();
  checkReminder();
});
$('utilityForm')?.addEventListener('submit', e => { e.preventDefault(); saveRecord(); });
