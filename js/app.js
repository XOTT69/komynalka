// ─── Глобальний стан ──────────────────────────────────────────
window.records        = [];
window.currentPrefs   = {};
window.currentTariffs = {};
window.addresses      = ['Мій дім'];
window.currentAddress = 'Мій дім';
window.hapticEnabled  = false;

// ─── Firebase ─────────────────────────────────────────────────
let db, auth, unsubscribe;
const FIREBASE_CONFIG = {
  // 👇 Встав свій конфіг
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
};

function initFirebase() {
  const { initializeApp, getFirestore, getAuth } = window._firebase;
  const app = initializeApp(FIREBASE_CONFIG);
  db   = getFirestore(app);
  auth = getAuth(app);
}

// ─── Авторизація ──────────────────────────────────────────────
$('authForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('authSubmitBtn');
  btn.textContent = '...'; btn.disabled = true;
  const login = $('authLogin').value.trim();
  const pass  = $('authPass').value;
  try {
    const email = login.includes('@') ? login : `${login}@utility.app`;
    const { signInWithEmailAndPassword } = window._firebase;
    await signInWithEmailAndPassword(auth, email, pass);
  } catch {
    const err = $('authError');
    err.textContent = 'Невірний логін або пароль';
    err.classList.remove('hidden');
  } finally {
    btn.textContent = 'Увійти'; btn.disabled = false;
  }
});

window.tryBiometricAuth = async () => {
  try {
    const cred = await navigator.credentials.get({ publicKey: { /* webauthn config */ } });
    if (cred) showApp();
  } catch { showToast('Face ID недоступний', '⚠️'); }
};

window.logout = async () => {
  vibe();
  if (unsubscribe) unsubscribe();
  const { signOut } = window._firebase;
  await signOut(auth);
  $('appScreen').classList.add('hidden'); $('appScreen').classList.remove('flex');
  $('authScreen').classList.remove('hidden');
};

// ─── Показати застосунок ──────────────────────────────────────
function showApp(user) {
  $('authScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden'); $('appScreen').classList.add('flex');
  const hour = new Date().getHours();
  const greet = hour < 12 ? '🌅 Доброго ранку' : hour < 18 ? '☀️ Добрий день' : '🌙 Добрий вечір';
  if ($('userGreeting')) $('userGreeting').textContent = greet;
  const today = new Date();
  $('monthInput').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}`;
  initTheme();
  // Bio кнопка
  if (localStorage.getItem('bioEnabled')) $('bioLoginBtn')?.classList.remove('hidden');
}

// ─── Завантаження даних адреси ────────────────────────────────
window.loadAddressData = () => {
  // Одразу — з кешу (миттєво)
  const cached = localStorage.getItem('util_cache_' + window.currentAddress);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      applyData(data);
    } catch {}
  }

  // Підписка Firebase
  if (unsubscribe) unsubscribe();
  if (!db || !auth.currentUser) return;

  const { doc, onSnapshot } = window._firebase;
  const docRef = doc(db, 'users', auth.currentUser.uid, 'addresses', window.currentAddress);
  unsubscribe = onSnapshot(docRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    localStorage.setItem('util_cache_' + window.currentAddress, JSON.stringify(data));
    applyData(data);
  });
};

function applyData(data) {
  window.records        = data.records        || [];
  window.currentPrefs   = data.prefs          || {};
  window.currentTariffs = data.tariffs        || {};
  window.addresses      = data.addresses      || ['Мій дім'];
  if ($('currentAddressDisplay')) $('currentAddressDisplay').textContent = window.currentAddress;
  loadSettingsUI();
  applyBlockVisibility();
  renderCustomServiceInputs();
  fillPreviousReadings();
  checkReminder();
  updateForecast();
}

// ─── Синхронізація в хмару ────────────────────────────────────
let syncTimer;
window.syncToCloud = async () => {
  clearTimeout(syncTimer);
  return new Promise(resolve => {
    syncTimer = setTimeout(async () => {
      if (!db || !auth?.currentUser) return resolve();
      const { doc, setDoc } = window._firebase;
      const data = {
        records: window.records,
        prefs: window.currentPrefs,
        tariffs: window.currentTariffs,
        addresses: window.addresses,
        updatedAt: Date.now()
      };
      const docRef = doc(db, 'users', auth.currentUser.uid, 'addresses', window.currentAddress);
      await setDoc(docRef, data, { merge: true });
      localStorage.setItem('util_cache_' + window.currentAddress, JSON.stringify(data));
      resolve();
    }, 1200);
  });
};

// ─── Ініціалізація ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initTheme();
  const { onAuthStateChanged } = window._firebase;
  onAuthStateChanged(auth, user => {
    if (user) { showApp(user); loadAddressData(); }
    else {
      $('authScreen').classList.remove('hidden');
      $('appScreen').classList.add('hidden'); $('appScreen').classList.remove('flex');
      if (localStorage.getItem('bioEnabled')) $('bioLoginBtn')?.classList.remove('hidden');
    }
  });
  // Активний стан першої вкладки
  $('navCalc')?.classList.add('bg-brand-light');
  $('navCalcLbl')?.classList.replace('text-slate-400', 'text-brand');
});
