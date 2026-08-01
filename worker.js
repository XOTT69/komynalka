// ============================================================
// КОМУНАЛКА Worker v4.1 — з підтримкою спільних тарифів
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-FP',
};

const ok  = (d, s=200) => new Response(JSON.stringify(d), {
  status: s, headers: { ...CORS, 'Content-Type': 'application/json' }
});
const err = (msg, s) => ok({ success: false, error: msg }, s);

async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}

async function getUser(env, login) {
  try {
    const raw = await env.KV.get(login);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (data.pass && !data.passHash)  data.passHash = data.pass;
    if (data.passHash && !data.pass)  data.pass = data.passHash;
    return data;
  } catch (e) {
    console.error('getUser:', login, e?.message);
    return null;
  }
}

async function saveUser(env, login, data) {
  if (data.passHash && !data.pass)  data.pass = data.passHash;
  if (data.pass && !data.passHash)  data.passHash = data.pass;
  await env.KV.put(login, JSON.stringify(data));
}

function normalize(d) {
  if (!d) return null;
  if (d.addresses && Array.isArray(d.addresses) && d.addresses.length > 0) return d;
  if (d.records || d.tariffs) {
    return {
      ...d,
      addresses: [{
        id: 'default', name: 'Мій дім',
        tariffs:        d.tariffs        || {},
        prefs:          d.prefs          || {},
        records:        d.records        || [],
        customServices: d.customServices || [],
      }],
      currentAddressId: 'default',
    };
  }
  return d;
}

async function rateLimit(env, key, limit, ms) {
  const bucket = Math.floor(Date.now() / ms);
  const k      = `rl:${key}:${bucket}`;
  const cur    = parseInt((await env.KV.get(k)) || '0');
  if (cur >= limit) return false;
  await env.KV.put(k, String(cur + 1), { expirationTtl: Math.ceil(ms / 1000 * 2) });
  return true;
}

function parseAuth(req) {
  const h = (req.headers.get('Authorization') || '').trim();
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7);
  if (t.startsWith('uid:')) {
    const uid = t.slice(4);
    return uid ? { type: 'uid', uid } : null;
  }
  if (t.startsWith('login:')) {
    const rest = t.slice(6);
    const idx  = rest.lastIndexOf(':');
    if (idx < 1) return null;
    try {
      const login    = decodeURIComponent(escape(atob(rest.slice(0, idx))));
      const passHash = rest.slice(idx + 1);
      if (!login || passHash.length !== 64) return null;
      return { type: 'login', login: login.toLowerCase().trim(), passHash };
    } catch { return null; }
  }
  return null;
}

async function resolveLogin(env, auth) {
  if (auth.type === 'uid') {
    let linked = await env.KV.get(`uid:${auth.uid}`);
    if (linked) return linked;
    const legacyKey = `uid_${auth.uid}`;
    const legacyRaw = await env.KV.get(legacyKey);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && typeof parsed === 'object') return legacyKey;
      } catch {
        return legacyRaw;
      }
    }
    return null;
  }
  const l = auth.login;
  return (l && l.length >= 2 && l.length <= 80) ? l : null;
}

function getUidLogin(uid) {
  const safe = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return safe ? `uid_${safe}` : null;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url   = new URL(req.url);
    const share = url.searchParams.get('share');
    const ip    = req.headers.get('CF-Connecting-IP') || 'unknown';
    const fp    = (req.headers.get('X-Device-FP') || 'unknown').slice(0, 64);
    try {
      if (share)                 return doShare(req, env, share, ip);
      if (req.method === 'GET')  return doGet(req, env, ip, fp);
      if (req.method === 'POST') return doPost(req, env, ip, fp);
      return err('Method not allowed', 405);
    } catch (e) {
      console.error('Worker:', e?.message);
      return err('Internal server error', 500);
    }
  }
};

async function doGet(req, env, ip, fp) {
  const auth = parseAuth(req);
  if (!auth) return err('NO_AUTH', 401);
  const login = await resolveLogin(env, auth);
  if (!login) return err('NOT_FOUND', 404);
  const data = await getUser(env, login);
  if (!data) return err('NOT_FOUND', 404);
  const storedPass = data.passHash || data.pass;
  if (auth.type === 'login' && storedPass !== auth.passHash) {
    saveUser(env, login, { ...data, suspiciousActivity: (data.suspiciousActivity || 0) + 1 });
    return err('WRONG_PASSWORD', 403);
  }
  const normalized = normalize(data);
  const addrs      = normalized.addresses || [];
  const devs = normalized.knownDevices || [];
  if (!devs.includes(fp)) devs.push(fp);
  saveUser(env, login, { ...normalized, lastIP: ip, lastDevice: fp, lastSeen: new Date().toISOString(), knownDevices: devs.slice(-10) });
  return ok({
    success: true,
    data: {
      addresses:        addrs,
      currentAddressId: normalized.currentAddressId || addrs[0]?.id || null,
      isPro:            normalized.isPro      || false,
      hasGoogle:        normalized.hasGoogle  || false,
      displayName:      normalized.displayName || '',
      createdAt:        normalized.createdAt  || null,
      linkedLogin:      login,
    }
  });
}

async function doPost(req, env, ip, fp) {
  const cl = parseInt(req.headers.get('content-length') || '0');
  if (cl > 512 * 1024) return err('PAYLOAD_TOO_LARGE', 413);
  let body;
  try { body = await req.json(); } catch { return err('INVALID_JSON', 400); }
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'admin_login' || action.startsWith('admin_')) return doAdmin(action, body, env, ip);
  if (action === 'get_broadcast') return doGetBroadcast(env);
  if (action === 'link_google')   return doLinkGoogle(body, env);

  // ═══ Публічні дії (без суворої автентифікації) ═══
  // get_tariffs — доступний для всіх авторизованих
  if (action === 'get_tariffs') return doGetTariffs(env);

  const auth = parseAuth(req);
  if (!auth) return err('NO_AUTH', 401);
  let login = await resolveLogin(env, auth);
  if (!login && auth.type === 'uid' && action === '' && Array.isArray(body.addresses)) {
    login = getUidLogin(auth.uid);
    if (login) await env.KV.put(`uid:${auth.uid}`, login);
  }
  if (!login) return err('NOT_FOUND', 404);
  if (!await rateLimit(env, `post:${login}`, 60, 60000)) return err('RATE_LIMITED', 429);

  let userData = await getUser(env, login);

  if (!userData) {
    if ((auth.type === 'login' || auth.type === 'uid') && action === '' && Array.isArray(body.addresses)) {
      userData = {
        ...(auth.type === 'login' ? { pass: auth.passHash, passHash: auth.passHash } : {}),
        displayName: '', addresses: [], currentAddressId: null,
        hasGoogle: auth.type === 'uid', isPro: false,
        createdAt: new Date().toISOString(),
        knownDevices: [fp], suspiciousActivity: 0,
        lastIP: ip, lastDevice: fp,
      };
    } else {
      return err('NOT_FOUND', 404);
    }
  } else {
    const storedPass = userData.passHash || userData.pass;
    if (auth.type === 'login' && storedPass !== auth.passHash) {
      saveUser(env, login, { ...userData, suspiciousActivity: (userData.suspiciousActivity || 0) + 1 });
      return err('WRONG_PASSWORD', 403);
    }
    userData = normalize(userData);
  }

  switch (action) {
    case 'change_password':  return doChangePass(body, env, login, userData);
    case 'update_name':      return doUpdateName(body, env, login, userData);
    case 'generate_share':   return doGenerateShare(body, env, login, userData);
    case 'ai_chat':          return doAiChat(body, env, login);
    // ═══ НОВІ: тарифи спільноти ═══
    case 'publish_tariff':   return doPublishTariff(body, env, login, ip);
    case 'vote_tariff':      return doVoteTariff(body, env, login);
    default:                 return doSave(body, env, login, userData, ip, fp);
  }
}

async function doSave(body, env, login, data, ip, fp) {
  if (!Array.isArray(body.addresses)) return err('INVALID_DATA', 400);
  if (body.addresses.length > 10)     return err('TOO_MANY_ADDRESSES', 400);
  const newRecs = body.addresses.flatMap(a => a.records || []).length;
  const oldRecs = (data.addresses || []).flatMap(a => a.records || []).length;
  if (oldRecs > 0 && newRecs === 0) {
    console.warn(`[PROTECTION] ${login}: ${oldRecs}→0 records. Skipped.`);
    return ok({ success: true, protected: true });
  }
  const devs = data.knownDevices || [];
  if (!devs.includes(fp)) devs.push(fp);
  await saveUser(env, login, {
    ...data,
    addresses:        body.addresses,
    currentAddressId: body.currentAddressId || data.currentAddressId,
    updatedAt:        new Date().toISOString(),
    lastIP: ip, lastDevice: fp, knownDevices: devs.slice(-10),
  });
  return ok({ success: true });
}

async function doUpdateName(body, env, login, data) {
  const name = String(body.displayName || '').trim().slice(0, 50);
  await saveUser(env, login, { ...data, displayName: name });
  return ok({ success: true, displayName: name });
}

async function doShare(req, env, token, ip) {
  if (!/^[a-f0-9]{32,64}$/i.test(token)) return err('INVALID_TOKEN', 400);
  const raw = await env.KV.get(`share:${token}`);
  if (!raw) return err('INVALID_OR_EXPIRED', 404);
  let sd;
  try { sd = JSON.parse(raw); } catch { return err('INVALID_TOKEN', 400); }
  const uRaw = await env.KV.get(sd.login);
  if (!uRaw) return err('NOT_FOUND', 404);
  const uData = normalize(JSON.parse(uRaw));
  if (!uData) return err('NOT_FOUND', 404);
  const addr = (uData.addresses || []).find(a => a.id === sd.addressId);
  if (!addr) return err('ADDRESS_NOT_FOUND', 404);
  if (req.method === 'GET') return ok({ success: true, data: { addresses: [addr], currentAddressId: sd.addressId } });
  if (req.method === 'POST') {
    if (!await rateLimit(env, `share:${token}:${ip}`, 20, 60000)) return err('RATE_LIMITED', 429);
    let body;
    try { body = await req.json(); } catch { return err('INVALID_JSON', 400); }
    if (!Array.isArray(body.addresses) || !body.addresses.length) return err('INVALID_DATA', 400);
    const idx = uData.addresses.findIndex(a => a.id === sd.addressId);
    if (idx < 0) return err('ADDRESS_NOT_FOUND', 404);
    uData.addresses[idx] = body.addresses[0];
    await saveUser(env, sd.login, uData);
    return ok({ success: true });
  }
  return err('Method not allowed', 405);
}

async function doGetBroadcast(env) {
  const raw = await env.KV.get('broadcast');
  if (!raw) return ok({ success: true, message: null });
  try { return ok({ success: true, ...JSON.parse(raw) }); }
  catch { return ok({ success: true, message: null }); }
}

async function doLinkGoogle(body, env) {
  const { login, uid, pass } = body;
  if (!login || !uid) return err('MISSING_PARAMS', 400);
  const cl    = String(login).toLowerCase().trim().slice(0, 80);
  const uData = await getUser(env, cl);
  if (!uData) return err('NOT_FOUND', 404);
  const stored = uData.passHash || uData.pass;
  if (!pass || stored !== pass) return err('WRONG_PASSWORD', 403);
  await env.KV.put(`uid:${uid}`, cl);
  await saveUser(env, cl, { ...uData, hasGoogle: true });
  return ok({ success: true });
}

async function doChangePass(body, env, login, data) {
  const { oldPass, newPass } = body;
  if (!oldPass || !newPass || newPass.length !== 64) return err('MISSING_PARAMS', 400);
  const stored = data.passHash || data.pass;
  if (stored !== oldPass) return err('WRONG_PASSWORD', 403);
  await saveUser(env, login, { ...data, pass: newPass, passHash: newPass });
  return ok({ success: true });
}

async function doGenerateShare(body, env, login, data) {
  const { addressId } = body;
  if (!addressId) return err('NO_ADDRESS_ID', 400);
  const addr = (data.addresses || []).find(a => a.id === addressId);
  if (!addr) return err('ADDRESS_NOT_FOUND', 404);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
  await env.KV.put(`share:${token}`, JSON.stringify({ login, addressId, createdAt: Date.now() }), { expirationTtl: 86400 * 30 });
  return ok({ success: true, shareToken: token });
}

// ═══════════════════════════════════════════════════════
// ТАРИФИ СПІЛЬНОТИ
// ═══════════════════════════════════════════════════════

/**
 * Публікує тариф від користувача в спільну базу.
 * POST { action: 'publish_tariff', name, tariffs: {water, hotWater, electroBase, electroWinter, gas}, author }
 */
async function doPublishTariff(body, env, login, ip) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return err('NO_NAME', 400);

  const t = body.tariffs;
  if (!t || typeof t !== 'object') return err('NO_TARIFFS', 400);

  // Валідація тарифів
  const water        = parseFloat(t.water)        || 0;
  const hotWater     = parseFloat(t.hotWater)     || 0;
  const electroBase  = parseFloat(t.electroBase)  || 0;
  const electroWinter= parseFloat(t.electroWinter)|| 0;
  const gas          = parseFloat(t.gas)          || 0;

  if (water <= 0 && electroBase <= 0 && gas <= 0) return err('INVALID_TARIFFS', 400);
  if (water > 10000 || electroBase > 1000 || gas > 1000) return err('TARIFF_TOO_HIGH', 400);

  const author = String(body.author || 'Анонім').trim().slice(0, 50);
  const city = String(body.city || '').trim().slice(0, 40);
  const region = String(body.region || '').trim().slice(0, 40);
  const allowedServices = new Set(['all', 'water', 'hotWater', 'electro', 'gas']);
  const serviceType = allowedServices.has(body.serviceType) ? body.serviceType : 'all';

  // Rate limit: 5 публікацій на годину з одного логіну
  if (!await rateLimit(env, `tariff_pub:${login}`, 5, 3_600_000)) {
    return err('RATE_LIMITED', 429);
  }

  // Читаємо поточний список тарифів
  let list = [];
  try {
    const raw = await env.KV.get('community_tariffs');
    if (raw) list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch(e) { list = []; }

  // Перевіряємо дублікати (та сама назва від того самого логіну)
  const normalName = name.toLowerCase();
  const existingIdx = list.findIndex(item =>
    item.login === login && item.name.toLowerCase() === normalName
  );
  const previous = existingIdx >= 0 ? list[existingIdx] : null;

  const entry = {
    id:        `t_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    name,
    city,
    region,
    serviceType,
    author,
    login,    // для модерації (не показується юзерам)
    tariffs:  { water, hotWater, electroBase, electroWinter, gas },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verified:  false,
    votes:     1,
    voters:    [login],
    history:   [],
  };

  if (existingIdx >= 0) {
    // Оновлюємо існуючий запис
    const history = Array.isArray(previous.history) ? previous.history : [];
    const previousSnapshot = previous.tariffs ? { tariffs: previous.tariffs, updatedAt: previous.updatedAt || previous.createdAt || new Date().toISOString() } : null;
    list[existingIdx] = {
      ...previous,
      ...entry,
      id: previous.id,
      createdAt: previous.createdAt || entry.createdAt,
      verified: !!previous.verified,
      votes: Math.max(1, previous.votes || 1),
      voters: Array.isArray(previous.voters) ? previous.voters : [login],
      history: previousSnapshot ? [previousSnapshot, ...history].slice(0, 12) : history.slice(0, 12),
    };
  } else {
    // Додаємо новий на початок
    list.unshift(entry);
  }

  // Зберігаємо максимум 200 тарифів, сортуємо за датою
  list = list.slice(0, 200);

  await env.KV.put('community_tariffs', JSON.stringify(list), { expirationTtl: 86400 * 365 });

  return ok({ success: true, id: existingIdx >= 0 ? list[existingIdx].id : entry.id });
}

async function doVoteTariff(body, env, login) {
  const id = String(body.id || '').trim();
  if (!id) return err('NO_ID', 400);
  if (!await rateLimit(env, `tariff_vote:${login}`, 30, 3_600_000)) return err('RATE_LIMITED', 429);
  let list = [];
  try {
    const raw = await env.KV.get('community_tariffs');
    if (raw) list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch(e) { list = []; }
  const idx = list.findIndex(item => item.id === id);
  if (idx < 0) return err('NOT_FOUND', 404);
  const voters = Array.isArray(list[idx].voters) ? list[idx].voters : [];
  if (voters.includes(login)) return err('ALREADY_VOTED', 409);
  voters.push(login);
  list[idx] = {
    ...list[idx],
    voters,
    votes: Math.max(Number(list[idx].votes) || 0, voters.length),
    updatedAt: list[idx].updatedAt || list[idx].createdAt || new Date().toISOString(),
  };
  await env.KV.put('community_tariffs', JSON.stringify(list), { expirationTtl: 86400 * 365 });
  return ok({ success: true, votes: list[idx].votes });
}

/**
 * Повертає список тарифів спільноти.
 * POST { action: 'get_tariffs' }
 * Публічний — не потребує авторизації.
 */
async function doGetTariffs(env) {
  try {
    const raw = await env.KV.get('community_tariffs');
    if (!raw) return ok({ success: true, tariffs: [] });

    let list = JSON.parse(raw);
    if (!Array.isArray(list)) return ok({ success: true, tariffs: [] });

    // Повертаємо без приватних полів
    const public_list = list.map(({ login: _l, voters: _v, ...item }) => item);

    return ok({ success: true, tariffs: public_list });
  } catch(e) {
    console.error('doGetTariffs:', e?.message);
    return ok({ success: true, tariffs: [] });
  }
}

// ═══════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════

async function doAiChat(body, env, login) {
  const hb  = Math.floor(Date.now() / 3_600_000);
  const rlk = `ai_rl:${login}:${hb}`;
  const cnt = parseInt((await env.KV.get(rlk)) || '0');
  if (cnt >= 20) return err('AI_RATE_LIMIT', 429);
  const { messages, max_tokens = 400, temperature = 0.4 } = body;
  if (!Array.isArray(messages) || !messages.length) return err('NO_MESSAGES', 400);
  const safe = messages.slice(0, 20)
    .filter(m => m?.role && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: ['system','user','assistant'].includes(m.role) ? m.role : 'user', content: String(m.content).slice(0, 4000) }));
  if (!safe.length) return err('NO_VALID_MESSAGES', 400);
  const tk = Math.min(Math.max(1, Math.floor(Number(max_tokens)||400)), 500);
  const tp = Math.max(0, Math.min(Number(temperature)||0.4, 1));
  if (env.GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({ model:'llama-3.1-8b-instant', messages:safe, max_completion_tokens:tk, temperature:tp }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) { await env.KV.put(rlk, String(cnt+1), { expirationTtl:3600 }); return ok({ ...await r.json(), success:true }); }
    } catch(e) { console.error('Groq:', e?.message); }
  }
  if (env.GEMINI_API_KEY) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${env.GEMINI_API_KEY}` },
        body: JSON.stringify({ model:'gemini-2.0-flash', messages:safe, max_tokens:tk, temperature:tp }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) { await env.KV.put(rlk, String(cnt+1), { expirationTtl:3600 }); return ok({ ...await r.json(), success:true, _fallback:'gemini' }); }
    } catch(e) { console.error('Gemini:', e?.message); }
  }
  return err('AI_PROVIDERS_FAILED', 502);
}

// ═══════════════════════════════════════════════════════
// АДМІН
// ═══════════════════════════════════════════════════════

async function doAdmin(action, body, env, ip) {
  if (action === 'admin_login') {
    const bk  = Math.floor(Date.now() / 900_000);
    const rlk = `adminlogin:${ip}:${bk}`;
    const cnt = parseInt((await env.KV.get(rlk)) || '0');
    if (cnt >= 5) return err('TOO_MANY_ATTEMPTS', 429);
    await env.KV.put(rlk, String(cnt+1), { expirationTtl:900 });
    const ih = await sha256(body.pass || '');
    const ah = await sha256(env.ADMIN_PASS || 'admin123');
    if (ih !== ah) return err('WRONG_PASSWORD', 403);
    const token = await sha256(`${env.ADMIN_PASS}:${Math.floor(Date.now()/3_600_000)}:k_admin`);
    return ok({ success:true, token });
  }
  const { adminToken } = body;
  if (!adminToken) return err('UNAUTHORIZED', 401);
  const h  = Math.floor(Date.now() / 3_600_000);
  const vt = await sha256(`${env.ADMIN_PASS}:${h}:k_admin`);
  const pt = await sha256(`${env.ADMIN_PASS}:${h-1}:k_admin`);
  if (adminToken !== vt && adminToken !== pt) return err('UNAUTHORIZED', 401);
  switch (action) {
    case 'admin_stats':            return doAdminStats(env);
    case 'admin_user_data':        return doAdminUserData(body, env);
    case 'admin_give_pro':         return doAdminPro(body, env, true);
    case 'admin_revoke_pro':       return doAdminPro(body, env, false);
    case 'admin_delete_user':      return doAdminDelete(body, env);
    case 'admin_broadcast':        return doAdminBroadcast(body, env);
    case 'admin_reset_password':   return doAdminResetPass(body, env);
    // ═══ НОВЕ: адмін може переглянути/очистити тарифи ═══
    case 'admin_get_tariffs':      return doAdminGetTariffs(env);
    case 'admin_delete_tariff':    return doAdminDeleteTariff(body, env);
    case 'admin_clear_tariffs':    return doAdminClearTariffs(env);
    case 'admin_verify_tariff':    return doAdminVerifyTariff(body, env);
    default: return err('UNKNOWN_ACTION', 400);
  }
}

async function doAdminStats(env) {
  const curMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const all      = await env.KV.list({ limit:1000 });
  const skip     = ['share:','uid:','uid_','rl:','adminlogin:','ai_rl:','broadcast','community_tariffs','tariff_pub:'];
  const logins   = all.keys.filter(({name}) => name !== 'broadcast' && !skip.some(p => name.startsWith(p))).map(({name}) => name);
  const users    = [];
  for (let i = 0; i < logins.length; i += 10) {
    const results = await Promise.allSettled(logins.slice(i,i+10).map(async login => {
      const data = await getUser(env, login);
      if (!data) return null;
      const norm = normalize(data);
      const recs = (norm.addresses||[]).flatMap(a=>a.records||[]);
      const sort = [...recs].sort((a,b)=>b.month.localeCompare(a.month));
      return { login, displayName:norm.displayName||'', hasGoogle:!!norm.hasGoogle, isPro:!!norm.isPro, records:recs.length, addresses:(norm.addresses||[]).length, activeThisMonth:recs.some(r=>r.month===curMonth), lastMonth:sort[0]?.month||null, devices:(norm.knownDevices||[]).length, suspicious:norm.suspiciousActivity||0 };
    }));
    results.forEach(r => { if (r.status==='fulfilled' && r.value) users.push(r.value); });
  }
  // Кількість спільних тарифів
  let tariffsCount = 0;
  try {
    const raw = await env.KV.get('community_tariffs');
    if (raw) tariffsCount = JSON.parse(raw).length;
  } catch {}

  return ok({ success:true, stats:{ totalUsers:users.length, activeThisMonth:users.filter(u=>u.activeThisMonth).length, totalRecords:users.reduce((s,u)=>s+u.records,0), proUsers:users.filter(u=>u.isPro).length, communityTariffs: tariffsCount }, users });
}

async function doAdminUserData(body, env) {
  if (!body.login) return err('NO_LOGIN', 400);
  const data = await getUser(env, body.login);
  if (!data) return err('NOT_FOUND', 404);
  return ok({ success:true, data: normalize(data) });
}

async function doAdminPro(body, env, val) {
  if (!body.login) return err('NO_LOGIN', 400);
  const data = await getUser(env, body.login);
  if (!data) return err('NOT_FOUND', 404);
  await saveUser(env, body.login, { ...normalize(data), isPro:val });
  return ok({ success:true });
}

async function doAdminDelete(body, env) {
  if (!body.login) return err('NO_LOGIN', 400);
  await env.KV.delete(body.login);
  return ok({ success:true });
}

async function doAdminBroadcast(body, env) {
  if (!body.message) return err('NO_MESSAGE', 400);
  await env.KV.put('broadcast', JSON.stringify({ message:String(body.message).slice(0,500), date:new Date().toISOString().slice(0,10) }));
  return ok({ success:true });
}

async function doAdminResetPass(body, env) {
  if (!body.login || !body.newPass || body.newPass.length !== 64) return err('MISSING_PARAMS', 400);
  const data = await getUser(env, body.login);
  if (!data) return err('NOT_FOUND', 404);
  await saveUser(env, body.login, { ...normalize(data), pass:body.newPass, passHash:body.newPass });
  return ok({ success:true });
}

// Адмін: перегляд тарифів з логінами (для модерації)
async function doAdminGetTariffs(env) {
  try {
    const raw = await env.KV.get('community_tariffs');
    if (!raw) return ok({ success: true, tariffs: [] });
    return ok({ success: true, tariffs: JSON.parse(raw) });
  } catch(e) {
    return ok({ success: true, tariffs: [] });
  }
}

// Адмін: видалення конкретного тарифу за id
async function doAdminDeleteTariff(body, env) {
  if (!body.id) return err('NO_ID', 400);
  try {
    const raw = await env.KV.get('community_tariffs');
    let list = raw ? JSON.parse(raw) : [];
    list = list.filter(item => item.id !== body.id);
    await env.KV.put('community_tariffs', JSON.stringify(list), { expirationTtl: 86400 * 365 });
    return ok({ success: true });
  } catch(e) {
    return err('ERROR', 500);
  }
}

async function doAdminVerifyTariff(body, env) {
  if (!body.id) return err('NO_ID', 400);
  try {
    const raw = await env.KV.get('community_tariffs');
    let list = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(item => item.id === body.id);
    if (idx < 0) return err('NOT_FOUND', 404);
    list[idx] = { ...list[idx], verified: body.verified !== false, moderatedAt: new Date().toISOString() };
    await env.KV.put('community_tariffs', JSON.stringify(list), { expirationTtl: 86400 * 365 });
    return ok({ success: true });
  } catch(e) {
    return err('ERROR', 500);
  }
}

// Адмін: повне очищення списку тарифів
async function doAdminClearTariffs(env) {
  await env.KV.put('community_tariffs', '[]', { expirationTtl: 86400 * 365 });
  return ok({ success: true });
}
