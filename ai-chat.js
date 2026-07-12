'use strict';

const AI_MAX_HISTORY    = 10;
const AI_HISTORY_KEY    = 'k_ai_history';
const AI_CONTEXT_MONTHS = 6;
const AI_MAX_TOKENS     = 400;

class KomunalkaAI {
  constructor() {
    this.isOpen    = false;
    this.isLoading = false;
    this.abort     = null;
    this.history   = this._loadHistory();
  }

  _loadHistory() {
    try {
      const arr = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  _saveHistory() {
    this.history = this.history.slice(-AI_MAX_HISTORY);
    try { localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(this.history)); } catch {}
  }

  clearHistory() {
    this.history = [];
    localStorage.removeItem(AI_HISTORY_KEY);
    this._render();
    this._chatToast('Історію очищено ✓');
  }

  _buildSystemPrompt() {
    const recs  = (typeof records   !== 'undefined' && Array.isArray(records))   ? records   : [];
    const addrs = (typeof addresses !== 'undefined' && Array.isArray(addresses)) ? addresses : [];
    const t     = (typeof tariffs   !== 'undefined') ? tariffs : {};
    const dName = (typeof displayName !== 'undefined' && displayName) ? displayName : null;
    const addr  = addrs.find(a => a.id === (typeof currentAddressId !== 'undefined' ? currentAddressId : null));
    const sorted = [...recs].sort((a, b) => b.month.localeCompare(a.month)).slice(0, AI_CONTEXT_MONTHS);
    const avg    = sorted.length ? Math.round(sorted.reduce((s, r) => s + (r.total || 0), 0) / sorted.length) : 0;
    const streak = typeof getStreak === 'function' ? getStreak(recs) : 0;
    const unpaid = recs.filter(r => !r.paid);

    const recLines = sorted.length
      ? sorted.map(r => {
          const p = [];
          if (r.waterCost    > 0) p.push(`вода ${Math.round(r.waterCost)}₴`);
          if (r.hotWaterCost > 0) p.push(`гар.${Math.round(r.hotWaterCost)}₴`);
          if (r.electroCost  > 0) p.push(`світло ${Math.round(r.electroCost)}₴`);
          if (r.gasCost      > 0) p.push(`газ ${Math.round(r.gasCost)}₴`);
          if (r.customCost   > 0) p.push(`інше ${Math.round(r.customCost)}₴`);
          const wU = Math.max(0,(r.wCur||0)-(r.wPrev||0));
          const eU = Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0));
          const gU = Math.max(0,(r.gCur||0)-(r.gPrev||0));
          const u  = [wU>0&&`${wU}м³вод`,eU>0&&`${eU}кВт`,gU>0&&`${gU}м³газ`].filter(Boolean).join(' ');
          return `• ${r.month}: ${Math.round(r.total)}₴ (${p.join(', ')})${u?' ['+u+']':''} ${r.paid?'✓':'⏳'}`;
        }).join('\n')
      : '• Записів поки немає';

    return `Ти — AI-помічник додатку "Комуналка". Відповідай ТІЛЬКИ українською. Максимум 2-3 речення.
${dName ? `Користувача звати: ${dName}` : ''}
АДРЕСА: "${addr?.name || 'Мій дім'}"
ТАРИФИ: вода ${t.water||30.38}₴/м³ | електрика ${t.electroBase||4.32}₴/кВт (ніч ×${t.nightCoef||0.5}) | газ ${t.gas||7.96}₴/м³
СТАТИСТИКА: середній ${avg}₴/міс | серія ${streak}міс | борг ${unpaid.length}міс
ОСТАННІ ${sorted.length} МІС:
${recLines}
ПРАВИЛА: оперуй конкретними числами. Якщо питання не про комуналку — поверни до теми.`;
  }

  async sendMessage(userText) {
    if (!userText.trim() || this.isLoading) return;
    this.abort?.abort();
    this.abort = new AbortController();
    this._addMsg('user', userText);
    this._setLoading(true);
    try {
      const apiMessages = [
        { role: 'system', content: this._buildSystemPrompt() },
        ...this.history.slice(-(AI_MAX_HISTORY - 1)).map(m => ({ role: m.role, content: m.content })),
      ];
      const headers = {
        'Content-Type': 'application/json',
        'X-Device-FP': typeof DEVICE_FP !== 'undefined' ? DEVICE_FP : 'unknown',
      };
      const uid = localStorage.getItem('k_uid');
      if (uid) {
        headers['Authorization'] = `Bearer uid:${uid}`;
      } else if (typeof sessionLogin !== 'undefined' && sessionLogin && typeof sessionPass !== 'undefined' && sessionPass) {
        headers['Authorization'] = `Bearer login:${btoa(unescape(encodeURIComponent(sessionLogin)))}:${sessionPass}`;
      }
      const res = await fetch(WORKER_URL, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'ai_chat', messages: apiMessages, max_tokens: AI_MAX_TOKENS, temperature: 0.4 }),
        signal: this.abort.signal,
      });
      if (res.status === 429) throw new Error('Забагато запитів. Зачекайте хвилину. ⏳');
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Помилка AI');
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Порожня відповідь');
      this._addMsg('assistant', reply);
    } catch (e) {
      if (e.name === 'AbortError') return;
      this._addMsg('error', `⚠️ ${e.message}`);
    } finally {
      this._setLoading(false);
      this.abort = null;
    }
  }

  _addMsg(role, content) {
    if (role !== 'error') {
      this.history.push({ role, content, ts: Date.now() });
      this._saveHistory();
    }
    this._renderMsg(role, content, Date.now());
    this._scrollBottom();
  }

  _setLoading(v) {
    this.isLoading = v;
    const ind   = document.getElementById('aiTypingIndicator');
    const btn   = document.getElementById('aiSendBtn');
    const input = document.getElementById('aiInput');
    ind?.classList.toggle('hidden', !v);
    if (btn)   btn.disabled   = v;
    if (input) input.disabled = v;
    if (v) this._scrollBottom();
  }

  _chatToast(text) {
    const el = document.getElementById('aiChatToast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('opacity-0');
    setTimeout(() => el.classList.add('opacity-0'), 2000);
  }

  _render() {
    const container = document.getElementById('aiMessagesList');
    if (!container) return;
    if (!this.history.length) { container.innerHTML = this._emptyHTML(); return; }
    container.innerHTML = this.history.map(m => this._msgHTML(m.role, m.content, m.ts)).join('');
  }

  _renderMsg(role, content, ts) {
    const container = document.getElementById('aiMessagesList');
    if (!container) return;
    const empty = container.querySelector('.ai-empty-state');
    if (empty) container.innerHTML = '';
    const div = document.createElement('div');
    div.innerHTML = this._msgHTML(role === 'error' ? 'error' : role, content, ts);
    if (div.firstElementChild) container.appendChild(div.firstElementChild);
  }

  _msgHTML(role, content, ts) {
    const isUser  = role === 'user';
    const isError = role === 'error';
    const time    = ts ? new Date(ts).toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit' }) : '';
    const esc = typeof escapeHtml === 'function' ? escapeHtml(content)
      : content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const formatted = esc
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="bg-black/10 dark:bg-white/10 px-1 rounded text-[11px]">$1</code>')
      .replace(/\n/g, '<br>');
    if (isUser) {
      return `<div class="flex justify-end mb-3 ai-msg-in">
        <div class="max-w-[82%]">
          <div class="bg-brand text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed">${formatted}</div>
          <p class="text-[9px] text-slate-400 text-right mt-1">${time}</p>
        </div>
      </div>`;
    }
    const cls = isError
      ? 'bg-red-50 dark:bg-red-500/10 text-red-600 border-red-200'
      : 'bg-white dark:bg-[#2c2c2e] text-slate-700 dark:text-slate-200 border-slate-100 dark:border-white/10';
    return `<div class="flex gap-2 mb-3 ai-msg-in">
      <div class="w-7 h-7 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center text-[13px] shrink-0 mt-0.5">🤖</div>
      <div class="max-w-[82%]">
        <div class="${cls} px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed border">${formatted}</div>
        <p class="text-[9px] text-slate-400 mt-1">${time}</p>
      </div>
    </div>`;
  }

  _emptyHTML() {
    const s = [
      { e:'📊', t:'Проаналізуй мої витрати' },
      { e:'📈', t:'Порівняй з минулим місяцем' },
      { e:'💡', t:'Як зекономити на електриці?' },
      { e:'⚠️', t:'Є аномалії в моїх даних?' },
    ];
    return `<div class="ai-empty-state flex flex-col items-center py-6 px-4">
      <div class="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-xl">🤖</div>
      <p class="text-base font-black text-slate-900 dark:text-white mb-1">AI-помічник</p>
      <p class="text-xs text-slate-400 text-center mb-5">Аналізую ваші комунальні, знаходжу аномалії</p>
      <div class="grid grid-cols-2 gap-2 w-full">
        ${s.map(x=>`<button class="ai-suggestion text-left bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 active:scale-[0.97] transition-transform" data-text="${x.t}"><span class="text-base">${x.e}</span><p class="text-[10px] font-bold text-slate-600 dark:text-slate-300 mt-1 leading-tight">${x.t}</p></button>`).join('')}
      </div>
    </div>`;
  }

  _scrollBottom() {
    const el = document.getElementById('aiMessagesList');
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  open() {
    this.isOpen = true;
    const panel = document.getElementById('aiChatPanel');
    const inner = document.getElementById('aiPanelInner');
    if (!panel || !inner) return;
    panel.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => inner.classList.remove('translate-y-full')));
    this._render();
    setTimeout(() => { document.getElementById('aiInput')?.focus(); this._scrollBottom(); }, 420);
  }

  close() {
    this.isOpen = false;
    const inner = document.getElementById('aiPanelInner');
    if (!inner) return;
    inner.classList.add('translate-y-full');
    setTimeout(() => document.getElementById('aiChatPanel')?.classList.add('hidden'), 400);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  init() {
    document.getElementById('aiFabBtn')?.addEventListener('click',  () => this.toggle());
    document.getElementById('aiCloseBtn')?.addEventListener('click', () => this.close());
    document.getElementById('aiClearBtn')?.addEventListener('click', async () => {
      if (await showAppConfirm('Цю дію не можна скасувати.', { title:'Очистити історію чату?', confirmLabel:'Очистити', danger:true, icon:'🗑️' })) this.clearHistory();
    });
    document.getElementById('aiChatPanel')?.addEventListener('click', e => {
      if (e.target.id === 'aiChatPanel') this.close();
    });
    document.getElementById('aiSendBtn')?.addEventListener('click', () => this._handleSend());
    document.getElementById('aiInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
    });
    document.getElementById('aiInput')?.addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });
    document.getElementById('aiMessagesList')?.addEventListener('click', e => {
      const btn = e.target.closest('.ai-suggestion');
      if (btn?.dataset.text) this.sendMessage(btn.dataset.text);
    });
  }

  _handleSend() {
    const input = document.getElementById('aiInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    this.sendMessage(text);
  }
}

let komunalkaAI = null;

function initAI() {
  if (komunalkaAI) return;
  komunalkaAI = new KomunalkaAI();
  komunalkaAI.init();
  document.getElementById('aiFabBtn')?.classList.remove('hidden');
  window.komunalkaAI = komunalkaAI;
}

window.initAI      = initAI;
