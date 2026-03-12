// ─── Тема ─────────────────────────────────────────────────────
window.setThemeMode = mode => {
  localStorage.setItem('themeMode', mode);
  applyThemeMode(mode);
  updateThemeModeButtons(mode);
  vibe();
};

window.applyThemeMode = mode => {
  if (mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark');
  else
    document.documentElement.classList.remove('dark');
  $('metaThemeColor')?.setAttribute('content', document.documentElement.classList.contains('dark') ? '#000000' : '#f2f2f7');
};

window.updateThemeModeButtons = mode => {
  ['light','auto','dark'].forEach(m => {
    const btn = $('mode-' + m);
    if (!btn) return;
    btn.classList.toggle('bg-white', m === mode);
    btn.classList.toggle('dark:bg-apple-dark', m === mode);
    btn.classList.toggle('shadow-sm', m === mode);
    btn.classList.toggle('text-slate-900', m === mode);
    btn.classList.toggle('dark:text-white', m === mode);
    btn.classList.toggle('text-slate-500', m !== mode);
  });
};

window.setThemeColor = color => {
  document.documentElement.className = document.documentElement.className.replace(/theme-\w+/, '').trim();
  document.documentElement.classList.add('theme-' + color);
  localStorage.setItem('themeColor', color);
  document.querySelectorAll('[id^="btn-theme-"]').forEach(b => b.style.outline = 'none');
  $('btn-theme-' + color).style.outline = '3px solid var(--brand-main)';
  $('btn-theme-' + color).style.outlineOffset = '2px';
  vibe();
};

window.initTheme = () => {
  const mode = localStorage.getItem('themeMode') || 'auto';
  const color = localStorage.getItem('themeColor') || 'indigo';
  applyThemeMode(mode);
  updateThemeModeButtons(mode);
  setThemeColor(color);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('themeMode') === 'auto') applyThemeMode('auto');
  });
};

// ─── Зберегти налаштування ────────────────────────────────────
window.saveSettings = async () => {
  vibe([10, 5, 10]);
  const prefs = {
    water: $('prefWater')?.checked,
    hotWater: $('prefHotWater')?.checked,
    electro: $('prefElectro')?.checked,
    electroTwoZone: $('prefElectroTwoZone')?.checked,
    electroWinter: $('prefElectroWinter')?.checked,
    gas: $('prefGas')?.checked,
    haptic: $('prefHaptic')?.checked,
    bio: $('prefBio')?.checked,
    reminders: $('prefReminders')?.checked,
    remWaterStart: +$('remWaterStart')?.value || 15,
    remWaterEnd: +$('remWaterEnd')?.value || 25,
    remElectroStart: +$('remElectroStart')?.value || 15,
    remElectroEnd: +$('remElectroEnd')?.value || 25,
    customServices: collectCustomServices()
  };
  const tariffs = {
    water: +$('tWater')?.value || 0,
    hotWater: +$('tHotWater')?.value || 0,
    electroBase: +$('tElectroBase')?.value || 0,
    electroWinter: +$('tElectroWinter')?.value || 0,
    gas: +$('tGas')?.value || 0
  };
  window.currentPrefs = prefs;
  window.currentTariffs = tariffs;
  window.hapticEnabled = prefs.haptic;
  applyBlockVisibility();
  renderCustomServiceInputs();
  await syncToCloud();
  showToast('Налаштування збережено', '⚙️');
};

// ─── Завантажити в UI ─────────────────────────────────────────
window.loadSettingsUI = () => {
  const p = window.currentPrefs || {};
  const t = window.currentTariffs || {};
  ['water','hotWater','electro','electroTwoZone','electroWinter','gas','haptic','bio','reminders'].forEach(k => {
    if ($(  'pref' + k[0].toUpperCase() + k.slice(1)  )) $('pref' + k[0].toUpperCase() + k.slice(1)).checked = !!p[k];
  });
  if ($('tWater'))        $('tWater').value        = t.water || '';
  if ($('tHotWater'))     $('tHotWater').value     = t.hotWater || '';
  if ($('tElectroBase'))  $('tElectroBase').value  = t.electroBase || '';
  if ($('tElectroWinter'))$('tElectroWinter').value = t.electroWinter || '';
  if ($('tGas'))          $('tGas').value          = t.gas || '';
  if ($('remWaterStart')) $('remWaterStart').value  = p.remWaterStart || 15;
  if ($('remWaterEnd'))   $('remWaterEnd').value    = p.remWaterEnd || 25;
  if ($('remElectroStart'))$('remElectroStart').value = p.remElectroStart || 15;
  if ($('remElectroEnd')) $('remElectroEnd').value  = p.remElectroEnd || 25;
  renderCustomServicesSettings();
  toggleRemindersUI(!!p.reminders);
  window.hapticEnabled = !!p.haptic;
};

// ─── Кастомні послуги (налаштування) ─────────────────────────
window.collectCustomServices = () => {
  const items = [];
  document.querySelectorAll('.custom-service-setting').forEach(el => {
    const name = el.querySelector('.cs-name')?.value?.trim();
    const id = el.dataset.id || 'cs_' + Date.now() + Math.random().toString(36).slice(2);
    if (name) items.push({ id, name });
  });
  return items;
};

window.renderCustomServicesSettings = () => {
  const list = $('customServicesSettingsList');
  if (!list) return;
  const services = window.currentPrefs?.customServices || [];
  const frag = document.createDocumentFragment();
  services.forEach(s => {
    const div = document.createElement('div');
    div.className = 'custom-service-setting flex gap-2 items-center';
    div.dataset.id = s.id;
    div.innerHTML = `
      <input class="cs-name flex-1 bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-transparent rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-brand" value="${s.name}" placeholder="Назва послуги">
      <button onclick="this.closest('.custom-service-setting').remove()" class="w-10 h-10 flex items-center justify-center bg-red-50 dark:bg-red-500/10 rounded-xl text-sm active:scale-90 transition-transform">🗑️</button>
    `;
    frag.appendChild(div);
  });
  list.innerHTML = '';
  list.appendChild(frag);
};

window.addCustomServiceField = () => {
  const list = $('customServicesSettingsList');
  const div = document.createElement('div');
  div.className = 'custom-service-setting flex gap-2 items-center';
  div.dataset.id = 'cs_' + Date.now();
  div.innerHTML = `
    <input class="cs-name flex-1 bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-transparent rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-brand" placeholder="Назва послуги" autofocus>
    <button onclick="this.closest('.custom-service-setting').remove()" class="w-10 h-10 flex items-center justify-center bg-red-50 dark:bg-red-500/10 rounded-xl text-sm active:scale-90">🗑️</button>
  `;
  list.appendChild(div);
  div.querySelector('input').focus();
};

window.toggleRemindersUI = on => {
  $('remindersSettings')?.classList.toggle('hidden', !on);
};
window.toggleBiometrics = on => {
  if (!on) localStorage.removeItem('bioEnabled');
  else localStorage.setItem('bioEnabled', '1');
};

// ─── Нагадування ─────────────────────────────────────────────
window.checkReminder = () => {
  const p = window.currentPrefs || {};
  if (!p.reminders) return $('reminderBanner')?.classList.add('hidden');
  const today = new Date().getDate();
  const waterOk  = today >= p.remWaterStart  && today <= p.remWaterEnd;
  const electroOk = today >= p.remElectroStart && today <= p.remElectroEnd;
  if (!waterOk && !electroOk) return $('reminderBanner')?.classList.add('hidden');
  const services = [waterOk && '💧 воду', electroOk && '⚡️ світло'].filter(Boolean).join(' та ');
  if ($('reminderText')) $('reminderText').textContent = `За ${services}`;
  $('reminderBanner')?.classList.remove('hidden');
};
window.dismissReminder = () => { vibe(); $('reminderBanner')?.classList.add('hidden'); };
