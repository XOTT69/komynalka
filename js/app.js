// ─── Конфіг ───────────────────────────────────────────────────
const WORKER_URL = 'https://komunproga.mikolenko-anton1.workers.dev';

// ─── Глобальний стан ──────────────────────────────────────────
window.records        = [];
window.currentPrefs   = {};
window.currentTariffs = {};
window.addresses      = [];
window.currentAddress = null; // { id, name, ... }
window.hapticEnabled  = false;
window._phone         = null;
window._pass          = null;
window._isGuest       = false; // режим share-посилання
window._shareToken    = null;

// ─── Авторизація ──────────────────────────────────────────────
$('authForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('authSubmitBtn');
  btn.textContent = '...'; btn.disabled = true;
  $('authError').classList.add('hidden');

  const login = $('authLogin').value.trim();
  const pass  = $('authPass').value.trim();

  try {
    const res = await apiFetch('GET', { phone: login, pass });
    if (!res.success) throw new Error(res.error || 'WRONG_PASSWORD');

    window._phone = login;
    window._pass  = pass;
    localStorage.setItem('auth_phone', login);
    localStorage.setItem('auth_pass', pass);

    applyData(res.data);
    showApp();
  } catch (err) {
    const msg = err.message === 'WRONG_PASSWORD' ? 'Невірний логін або пароль' : 'Помилка з\'єднання';
    $('authError').textContent = msg;
    $('authError').classList.remove('hidden');
  } finally {
    btn.textContent = 'Увійти'; btn.disabled = false;
  }
});

// ─── Вихід ────────────────────────────────────────────────────
window.logout = () => {
  vibe();
  localStorage.removeItem('auth_phone');
  localStorage.removeItem('auth_pass');
  localStorage.removeItem('auth_cache');
  window._phone = null; window._pass = null;
  $('appScreen').classList.add('hidden');
  $('appScreen').classList.remove('flex');
  $('authScreen').classList.remove('hidden');
  $('authLogin').value = ''; $('authPass').value = '';
};

// ─── API хелпер ───────────────────────────────────────────────
async function apiFetch(method, params = {}, body = null) {
  const url = new URL(WORKER_URL);
  if (window._shareToken) {
    url.searchParams.set('share', window._shareToken);
  } else {
    if (params.phone) url.searchParams.set('phone', params.phone);
    if (params.pass)  url.searchParams.set('pass',  params.pass);
  }

  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url.toString(), opts);
  return res.json();
}

// ─── Завантажити дані ─────────────────────────────────────────
window.loadAddressData = async () => {
  // Миттєво — з кешу
  const cached = localStorage.getItem('auth_cache');
  if (cached) {
    try { applyData(JSON.parse(cached)); } catch {}
  }

  // Потім — з KV
  try {
    const res = await apiFetch('GET', { phone: window._phone, pass: window._pass });
    if (res.success && res.data) {
      localStorage.setItem('auth_cache', JSON.stringify(res.data));
      applyData(res.data);
    }
  } catch { /* офлайн — залишаємо кеш */ }
};

// ─── Застосувати дані ─────────────────────────────────────────
function applyData(data) {
  window.addresses = data.addresses || [];

  // Знайти поточну адресу
  const savedId = data.currentAddressId || window.addresses[0]?.id;
  const addr = window.addresses.find(a => a.id === savedId) || window.addresses[0];
  if (!addr) return;

  window.currentAddress = addr;
  window.records        = addr.records    || [];
  window.currentPrefs   = addr.prefs      || {};
  window.currentTariffs = addr.tariffs    || {};

  if ($('currentAddressDisplay')) $('currentAddressDisplay').textContent = addr.name;

  loadSettingsUI();
  applyBlockVisibility();
  renderCustomServiceInputs();
  fillPreviousReadings();
  checkReminder();
  updateForecast();
}

// ─── Вибір адреси ─────────────────────────────────────────────
window.selectAddress = async id => {
  const addr = window.addresses.find(a => a.id === id);
  if (!addr) return;
  window.currentAddress = addr;
  window.records        = addr.records    || [];
  window.currentPrefs   = addr.prefs      || {};
  window.currentTariffs = addr.tariffs    || {};
  if ($('currentAddressDisplay')) $('currentAddressDisplay').textContent = addr.name;
  renderAddressList();
  closeAddressModal();
  loadSettingsUI();
  applyBlockVisibility();
  renderCustomServiceInputs();
  fillPreviousReadings();
  updateForecast();
  // Зберегти поточну адресу
  await syncToCloud();
};

window.addAddress = async () => {
  const input = $('newAddressInput');
  const name = input.value.trim();
  if (!name) return;
  const newAddr = {
    id: 'addr_' + Date.now(),
    name,
    records: [],
    prefs: { water: true, electro: true, gas: true },
    tariffs: {}
  };
  window.addresses.push(newAddr);
  input.value = '';
  await selectAddress(newAddr.id);
  renderAddressList();
};

window.removeAddress = async id => {
  if (window.addresses.length <= 1) return showToast('Не можна видалити останню адресу', '⚠️');
  window.addresses = window.addresses.filter(a => a.id !== id);
  if (window.currentAddress?.id === id) await selectAddress(window.addresses[0].id);
  else { renderAddressList(); await syncToCloud(); }
};

window.renderAddressList = () => {
  const list = $('addressList');
  if (!list) return;
  const frag = document.createDocumentFragment();
  window.addresses.forEach(addr => {
    const isCur = addr.id === window.currentAddress?.id;
    const div = document.createElement('div');
    div.className = `flex items-center justify-between p-3 rounded-2xl cursor-pointer transition-all ${isCur ? 'bg-brand-light border border-brand/20' : 'bg-slate-50 dark:bg-black/30'}`;
    div.innerHTML = `
      <span class="font-bold text-sm ${isCur ? 'text-brand' : 'text-slate-700 dark:text-slate-200'}">${isCur ? '✓ ' : ''}${addr.name}</span>
      <div class="flex gap-2">
        <button onclick="generateShare('${addr.id}', event)" class="text-brand text-xs font-bold px-2 py-1 rounded-lg hover:bg-brand-light">🔗</button>
        ${window.addresses.length > 1 ? `<button onclick="removeAddress('${addr.id}')" class="text-red-400 text-xs font-bold px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">✕</button>` : ''}
      </div>
    `;
    div.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      selectAddress(addr.id);
    });
    frag.appendChild(div);
  });
  list.innerHTML = '';
  list.appendChild(frag);
};

// ─── Share посилання ──────────────────────────────────────────
window.generateShare = async (addressId, event) => {
  event?.stopPropagation(); vibe();
  showToast('Генерую посилання...', '⏳');
  try {
    const res = await apiFetch('POST', { phone: window._phone, pass: window._pass }, {
      action: 'generate_share',
      addressId
    });
    if (!res.success) throw new Error();
    const link = `${location.origin}${location.pathname}?share=${res.shareToken}`;
    if (navigator.share) navigator.share({ title: 'Комуналка', url: link });
    else navigator.clipboard.writeText(link).then(() => showToast('Посилання скопійовано', '🔗'));
  } catch { showToast('Помилка генерації', '❌'); }
};

// ─── Синхронізація з KV ───────────────────────────────────────
let syncTimer;
window.syncToCloud = () => {
  clearTimeout(syncTimer);
  return new Promise(resolve => {
    syncTimer = setTimeout(async () => {
      // Зберегти поточну адресу у масиві
      const idx = window.addresses.findIndex(a => a.id === window.currentAddress?.id);
      if (idx >= 0) {
        window.addresses[idx] = {
          ...window.addresses[idx],
          records:  window.records,
          prefs:    window.currentPrefs,
          tariffs:  window.currentTariffs
        };
      }

      const body = {
        addresses: window.addresses,
        currentAddressId: window.currentAddress?.id
      };

      // Кеш одразу
      localStorage.setItem('auth_cache', JSON.stringify({ ...body, pass: window._pass }));

      // Worker
      if (!window._isGuest) {
        try {
          await apiFetch('POST', { phone: window._phone, pass: window._pass }, body);
        } catch { /* офлайн — дані в кеші */ }
      } else {
        // Гість пише тільки свою адресу
        try {
          await apiFetch('POST', {}, { addresses: window.addresses });
        } catch {}
      }
      resolve();
    }, 1200);
  });
};

// ─── Показати застосунок ──────────────────────────────────────
function showApp() {
  $('authScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  $('appScreen').classList.add('flex');
  const h = new Date().getHours();
  const greet = h < 12 ? '🌅 Доброго ранку' : h < 18 ? '☀️ Добрий день' : '🌙 Добрий вечір';
  if ($('userGreeting')) $('userGreeting').textContent = greet;
  const today = new Date();
  $('monthInput').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  initTheme();
  $('navCalc')?.classList.add('bg-brand-light');
  $('navCalcLbl')?.classList.replace('text-slate-400', 'text-brand');
}

// ─── Ініціалізація ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Гостьовий режим через ?share=token
  const urlParams = new URLSearchParams(location.search);
  const shareToken = urlParams.get('share');
  if (shareToken) {
    window._isGuest    = true;
    window._shareToken = shareToken;
    try {
      const res = await apiFetch('GET');
      if (res.success) { applyData(res.data); showApp(); return; }
    } catch {}
    showToast('Невірне або застаріле посилання', '❌');
    return;
  }

  // Автологін з кешу
  const phone = localStorage.getItem('auth_phone');
  const pass  = localStorage.getItem('auth_pass');
  if (phone && pass) {
    window._phone = phone; window._pass = pass;
    // Спочатку кеш
    const cached = localStorage.getItem('auth_cache');
    if (cached) {
      try { applyData(JSON.parse(cached)); showApp(); } catch {}
    }
    // Потім свіжі дані
    loadAddressData();
    if (!cached) showApp();
    return;
  }

  // Показати форму входу
  $('authScreen').classList.remove('hidden');
  if (localStorage.getItem('bioEnabled')) $('bioLoginBtn')?.classList.remove('hidden');
});
