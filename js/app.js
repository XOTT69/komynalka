// ─── Конфіг ───────────────────────────────────────────────────
const WORKER_URL = 'https://komunproga.mikolenko-anton1.workers.dev';

// ─── Глобальний стан ──────────────────────────────────────────
window.records        = [];
window.currentPrefs   = {};
window.currentTariffs = {};
window.addresses      = [];
window.currentAddress = null;
window.hapticEnabled  = false;
window._phone         = null;
window._pass          = null;
window._isGuest       = false;
window._shareToken    = null;

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

// ─── Синхронізація індикатор ──────────────────────────────────
function setSyncStatus(status) {
  // 'saving' | 'saved' | 'error'
  const el = $('syncIndicator');
  if (!el) return;
  const map = { saving: '☁️', saved: '✅', error: '❌' };
  el.textContent = map[status] || '';
  el.title = status === 'saving' ? 'Збереження...' : status === 'saved' ? 'Збережено' : 'Помилка збереження';
}

// ─── Авторизація ──────────────────────────────────────────────
$('authForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('authSubmitBtn');
  btn.textContent = '...'; btn.disabled = true;
  $('authError').classList.add('hidden');

  const login = $('authLogin').value.trim();
  const pass  = $('authPass').value.trim();

  if (!login || !pass) {
    showAuthError('Введіть логін і пароль');
    btn.textContent = 'Увійти'; btn.disabled = false;
    return;
  }

  try {
    const res = await apiFetch('GET', { phone: login, pass });

    // Невірний пароль — акаунт є але пароль не той
    if (res.error === 'WRONG_PASSWORD') throw new Error('WRONG_PASSWORD');

    window._phone = login;
    window._pass  = pass;
    localStorage.setItem('auth_phone', login);
    localStorage.setItem('auth_pass',  pass);

    // Новий користувач — акаунту ще нема, створюємо
    if (!res.success || !res.data?.addresses?.length) {
      window.addresses = [{
        id: 'addr_' + Date.now(),
        name: 'Мій дім',
        records: [],
        prefs: { water: true, electro: true, gas: true },
        tariffs: {}
      }];
      window.currentAddress = window.addresses[0];
      window.records        = [];
      window.currentPrefs   = window.addresses[0].prefs;
      window.currentTariffs = {};
      await syncToCloud();
    } else {
      applyData(res.data);
    }

    showApp();
  } catch (err) {
    const msgs = {
      'WRONG_PASSWORD': 'Невірний пароль',
      'Failed to fetch': 'Немає з\'єднання з сервером'
    };
    showAuthError(msgs[err.message] || `Помилка: ${err.message}`);
  } finally {
    btn.textContent = 'Увійти'; btn.disabled = false;
  }
});

function showAuthError(msg) {
  $('authError').textContent = msg;
  $('authError').classList.remove('hidden');
}

// ─── Biometric ────────────────────────────────────────────────
window.tryBiometricAuth = async () => {
  const phone = localStorage.getItem('auth_phone');
  const pass  = localStorage.getItem('auth_pass');
  if (!phone || !pass) return showToast('Спочатку увійдіть з паролем', '⚠️');
  window._phone = phone; window._pass = pass;
  const res = await apiFetch('GET', { phone, pass }).catch(() => null);
  if (res?.success) { applyData(res.data); showApp(); }
  else showToast('Не вдалось авторизуватись', '❌');
};

// ─── Вихід ────────────────────────────────────────────────────
window.logout = () => {
  vibe();
  localStorage.removeItem('auth_phone');
  localStorage.removeItem('auth_pass');
  localStorage.removeItem('auth_cache');
  window._phone = null; window._pass = null;
  window.records = []; window.addresses = [];
  $('appScreen').classList.add('hidden');
  $('appScreen').classList.remove('flex');
  $('authScreen').classList.remove('hidden');
  $('authLogin').value = ''; $('authPass').value = '';
};

// ─── Завантажити дані ─────────────────────────────────────────
window.loadAddressData = async () => {
  // Миттєво з кешу
  const cached = localStorage.getItem('auth_cache');
  if (cached) {
    try { applyData(JSON.parse(cached)); } catch {}
  }
  // Свіжі дані з KV
  try {
    const res = await apiFetch('GET', { phone: window._phone, pass: window._pass });
    if (res.success && res.data) {
      localStorage.setItem('auth_cache', JSON.stringify(res.data));
      applyData(res.data);
    }
  } catch { /* офлайн — залишаємо кеш */ }
};

// ─── Застосувати дані з KV ────────────────────────────────────
function applyData(data) {
  if (!data) return;
  window.addresses = data.addresses || [];
  if (!window.addresses.length) return;

  const savedId = data.currentAddressId;
  const addr = window.addresses.find(a => a.id === savedId) || window.addresses[0];
  window.currentAddress = addr;
  window.records        = addr.records  || [];
  window.currentPrefs   = addr.prefs    || {};
  window.currentTariffs = addr.tariffs  || {};

  if ($('currentAddressDisplay')) $('currentAddressDisplay').textContent = addr.name;
  loadSettingsUI();
  applyBlockVisibility();
  renderCustomServiceInputs();
  fillPreviousReadings();
  checkReminder();
  updateForecast();
}

// ─── Адреси ───────────────────────────────────────────────────
window.selectAddress = async id => {
  // Спочатку зберегти поточну перед перемиканням
  await syncToCloud();
  const addr = window.addresses.find(a => a.id === id);
  if (!addr) return;
  window.currentAddress = addr;
  window.records        = addr.records  || [];
  window.currentPrefs   = addr.prefs    || {};
  window.currentTariffs = addr.tariffs  || {};
  if ($('currentAddressDisplay')) $('currentAddressDisplay').textContent = addr.name;
  closeAddressModal();
  loadSettingsUI();
  applyBlockVisibility();
  renderCustomServiceInputs();
  fillPreviousReadings();
  updateForecast();
  // Зберегти нову currentAddressId
  await syncToCloud();
};

window.addAddress = async () => {
  const input = $('newAddressInput');
  const name = input.value.trim();
  if (!name) return;
  if (window.addresses.find(a => a.name === name)) return showToast('Така адреса вже є', '⚠️');
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
};

window.removeAddress = async id => {
  if (window.addresses.length <= 1) return showToast('Не можна видалити останню адресу', '⚠️');
  window.addresses = window.addresses.filter(a => a.id !== id);
  const fallback = window.addresses[0];
  if (window.currentAddress?.id === id) await selectAddress(fallback.id);
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
      <div class="flex gap-2 items-center">
        ${!window._isGuest ? `<button onclick="generateShare('${addr.id}',event)" class="text-brand text-xs font-bold px-2 py-1 rounded-lg hover:bg-brand-light active:scale-90 transition-transform">🔗</button>` : ''}
        ${window.addresses.length > 1 ? `<button onclick="removeAddress('${addr.id}')" class="text-red-400 text-xs font-bold px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 active:scale-90 transition-transform">✕</button>` : ''}
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
    if (navigator.share) navigator.share({ title: 'Комуналка', text: 'Перегляд комунальних', url: link });
    else navigator.clipboard.writeText(link).then(() => showToast('Посилання скопійовано!', '🔗'));
  } catch { showToast('Помилка генерації посилання', '❌'); }
};

// ─── Синхронізація ────────────────────────────────────────────
let syncTimer;
window.syncToCloud = () => {
  setSyncStatus('saving');
  clearTimeout(syncTimer);
  return new Promise(resolve => {
    syncTimer = setTimeout(async () => {
      // Записати поточні дані в масив адрес
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
        addresses:        window.addresses,
        currentAddressId: window.currentAddress?.id
      };

      // Кеш миттєво
      const cacheData = { ...body, pass: window._pass };
      localStorage.setItem('auth_cache', JSON.stringify(cacheData));

      if (window._isGuest) {
        try { await apiFetch('POST', {}, { addresses: window.addresses }); } catch {}
      } else if (window._phone && window._pass) {
        try {
          await apiFetch('POST', { phone: window._phone, pass: window._pass }, body);
          setSyncStatus('saved');
          setTimeout(() => setSyncStatus(''), 3000);
        } catch {
          setSyncStatus('error');
        }
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
  if ($('userGreeting')) $('userGreeting').textContent =
    h < 12 ? '🌅 Доброго ранку' : h < 18 ? '☀️ Добрий день' : '🌙 Добрий вечір';
  const now = new Date();
  if ($('monthInput')) $('monthInput').value =
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  initTheme();
  $('navCalc')?.classList.add('bg-brand-light');
  $('navCalcLbl')?.classList.replace('text-slate-400', 'text-brand');
}

// ─── Ініціалізація ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Гостьовий режим ?share=TOKEN
  const shareToken = new URLSearchParams(location.search).get('share');
  if (shareToken) {
    window._isGuest    = true;
    window._shareToken = shareToken;
    showToast('Завантаження...', '⏳');
    try {
      const res = await apiFetch('GET');
      if (res.success) { applyData(res.data); showApp(); return; }
    } catch {}
    showToast('Невірне або застаріле посилання', '❌');
    return;
  }

  // Автологін
  const phone = localStorage.getItem('auth_phone');
  const pass  = localStorage.getItem('auth_pass');
  if (phone && pass) {
    window._phone = phone;
    window._pass  = pass;
    // Кеш — миттєво
    const cached = localStorage.getItem('auth_cache');
    if (cached) {
      try { applyData(JSON.parse(cached)); } catch {}
    }
    showApp();
    // Фонове оновлення
    loadAddressData();
    return;
  }

  // Форма входу
  $('authScreen').classList.remove('hidden');
  if (localStorage.getItem('bioEnabled')) $('bioLoginBtn')?.classList.remove('hidden');
});
