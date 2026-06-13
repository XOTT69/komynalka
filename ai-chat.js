// ============================================================
// КОМУНАЛКА AI v1.0 — Smart Assistant Module
// Завантажується ПІСЛЯ app.js
// ============================================================
'use strict';

const AI_MAX_HISTORY  = 10;
const AI_HISTORY_KEY  = 'k_ai_history';
const AI_CONTEXT_MONTHS = 6;
const AI_MAX_TOKENS   = 400;

class KomunalkaAI {
  constructor() {
    this.isOpen     = false;
    this.isLoading  = false;
    this.abort      = null;
    this.history    = this._loadHistory();
  }

  // ─── History ──────────────────────────────────────────────
  _loadHistory() {
    try {
      const raw = localStorage.getItem(AI_HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
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

  // ─── System prompt ────────────────────────────────────────
  _buildSystemPrompt() {
    // Access app.js globals safely
    const recs  = (typeof records   !== 'undefined' && Array.isArray(records))   ? records   : [];
    const addrs = (typeof addresses !== 'undefined' && Array.isArray(addresses)) ? addresses : [];
    const t     = (typeof tariffs   !== 'undefined') ? tariffs : {};

    const addr = addrs.find(a => a.id === (typeof currentAddressId !== 'undefined' ? currentAddressId : null));
    const sorted = [...recs].sort((a, b) => b.month.localeCompare(a.month)).slice(0, AI_CONTEXT_MONTHS);
    const avg    = sorted.length ? Math.round(sorted.reduce((s, r) => s + (r.total || 0), 0) / sorted.length) : 0;
    const streak = typeof getStreak === 'function' ? getStreak(recs) : 0;
    const unpaid = recs.filter(r => !r.paid);
    const unpaidSum = unpaid.reduce((s, r) => s + (r.total || 0), 0);

    const recLines = sorted.length
      ? sorted.map(r => {
          const p = [];
          if (r.waterCost  > 0) p.push(`вода ${Math.round(r.waterCost)}₴`);
          if (r.hotWaterCost > 0) p.push(`гар.${Math.round(r.hotWaterCost)}₴`);
          if (r.electroCost > 0) p.push(`світло ${Math.round(r.electroCost)}₴`);
          if (r.gasCost     > 0) p.push(`газ ${Math.round(r.gasCost)}₴`);
          if (r.customCost  > 0) p.push(`інше ${Math.round(r.customCost)}₴`);
          const wU = Math.max(0, (r.wCur||0) - (r.wPrev||0));
          const eU = Math.max(0, (r.dCur||0) - (r.dPrev||0)) + Math.max(0, (r.nCur||0) - (r.nPrev||0));
          const gU = Math.max(0, (r.gCur||0) - (r.gPrev||0));
          const u  = [wU > 0 && `${wU}м³вод`, eU > 0 && `${eU}кВт`, gU > 0 && `${gU}м³газ`].filter(Boolean).join(' ');
          return `• ${r.month}: ${Math.round(r.total)}₴ (${p.join(', ')})${u ? ' [' + u + ']' : ''} ${r.paid ? '✓' : '⏳'}`;
        }).join('\n')
      : '• Записів поки немає';

    return `Ти — AI-помічник додатку "Комуналка" для обліку комунальних платежів в Україні.
Відповідай ТІЛЬКИ українською мовою. Будь лаконічним — 1-3 речення.

АДРЕСА: "${addr?.name || 'Мій дім'}"

ТАРИФИ:
• Вода холодна: ${t.water || 30.38}₴/м³
• Вода гаряча: ${t.hotWater || 100}₴/м³
• Електрика день: ${t.electroBase || 4.32}₴/кВт | ніч: ×${t.nightCoef || 0.5}
• Газ: ${t.gas || 7.96}₴/м³

СТАТИСТИКА:
• Середній рахунок: ${avg}₴/міс
• Серія: ${streak} міс. без пропуску
• Борг: ${unpaid.length} міс. = ${Math.round(unpaidSum)}₴
• Всього записів: ${recs.length}

ОСТАННІ ${sorted.length} МІС:
${recLines}

ПРАВИЛА:
- Оперуй КОНКРЕТНИМИ числами з даних вище.
- Порівнюй місяці, знаходь аномалії, давай конкретні поради з економії.
- Якщо питання не про комуналку — ввічливо поверни до теми.
- Не вигадуй дані яких немає.`;
  }

  // ─── API ──────────────────────────────────────────────────
  async sendMessage(userText) {
    if (!userText.trim() || this.isLoading) return;

    this.abort?.abort();
    this.abort = new AbortController();

    this._addMsg('user', userText);
    this._setLoading(true);

    try {
      const apiMessages = [
        { role: 'system', content: this._buildSystemPrompt() },
        ...this.history
          .slice(-(AI_MAX_HISTORY - 1))
          .map(m => ({ role: m.role, content: m.content })),
      ];

      const headers = {
        'Content-Type': 'application/json',
        'X-Device-FP': typeof DEVICE_FP !== 'undefined' ? DEVICE_FP : 'unknown',
      };

      if (typeof sessionLogin !== 'undefined' && sessionLogin && typeof sessionPass !== 'undefined' && sessionPass) {
        headers['Authorization'] =
          `Bearer login:${btoa(unescape(encodeURIComponent(sessionLogin)))}:${sessionPass}`;
      } else if (localStorage.getItem('k_uid')) {
        headers['Authorization'] = `Bearer uid:${localStorage.getItem('k_uid')}`;
      }

      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'ai_chat',
          messages: apiMessages,
          max_tokens: AI_MAX_TOKENS,
          temperature: 0.4,
        }),
        signal: this.abort.signal,
      });

      if (res.status === 429) throw new Error('Забагато запитів. Зачекайте хвилину. ⏳');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Помилка AI');

      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Порожня відповідь від AI');

      this._addMsg('assistant', reply);

    } catch (e) {
      if (e.name === 'AbortError') return;
      this._addMsg('error', `⚠️ ${e.message}`);
    } finally {
      this._setLoading(false);
      this.abort = null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────
  _addMsg(role, content) {
    if (role !== 'error') {
      this.history.push({ role, content, ts: Date.now() });
      this._saveHistory();
    }
    // For errors we render but don't persist
    this._renderMsg(role, content, Date.now());
    this._scrollBottom();
  }

  _setLoading(v) {
    this.isLoading = v;
    const indicator = document.getElementById('aiTypingIndicator');
    const btn       = document.getElementById('aiSendBtn');
    const input     = document.getElementById('aiInput');
    indicator?.classList.toggle('hidden', !v);
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

  // ─── Render ───────────────────────────────────────────────
  _render() {
    const container = document.getElementById('aiMessagesList');
    if (!container) return;
    if (this.history.length === 0) {
      container.innerHTML = this._emptyHTML();
      this._bindSuggestions();
      return;
    }
    container.innerHTML = this.history.map(m => this._msgHTML(m.role, m.content, m.ts)).join('');
  }

  _renderMsg(role, content, ts) {
    const container = document.getElementById('aiMessagesList');
    if (!container) return;

    // Remove empty state if present
    const empty = container.querySelector('.ai-empty-state');
    if (empty) container.innerHTML = '';

    const div = document.createElement('div');
    div.innerHTML = this._msgHTML(role === 'error' ? 'error' : role, content, ts);
    container.appendChild(div.firstElementChild);
  }
  _msgHTML(role, content, ts) {
    const isUser  = role === 'user';
    const isError = role === 'error';
    const time    = ts ? new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : '';

    const esc = (typeof escapeHtml === 'function')
      ? escapeHtml(content)
      : content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const formatted = esc
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
      .replace(/\n\n/g, '</p><p class="mt-2">')
      .replace(/\n/g, '<br>');

    if (isUser) {
      return `<div class="flex justify-end mb-3 ai-msg-in">
        <div class="max-w-[82%]">
          <div class="bg-brand text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed shadow-md shadow-brand/20">${formatted}</div>
          <p class="text-[9px] text-slate-400 text-right mt-1 mr-1">${time}</p>
        </div>
      </div>`;
    }

    const bubbleCls = isError
      ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30'
      : 'bg-white dark:bg-[#2c2c2e] text-slate-700 dark:text-slate-200 border-slate-100 dark:border-white/10';

    return `<div class="flex gap-2 mb-3 ai-msg-in">
      <div class="w-7 h-7 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center text-[13px] shrink-0 mt-0.5 shadow-md">🤖</div>
      <div class="max-w-[82%]">
        <div class="${bubbleCls} px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed border shadow-sm"><p>${formatted}</p></div>
        <p class="text-[9px] text-slate-400 mt-1 ml-1">${time}</p>
      </div>
    </div>`;
  }

  _emptyHTML() {
    const suggestions = [
      { e: '📊', t: 'Проаналізуй мої витрати' },
      { e: '📈', t: 'Порівняй з минулим місяцем' },
      { e: '💡', t: 'Як зекономити на електриці?' },
      { e: '⚠️', t: 'Є аномалії в моїх даних?' },
    ];
    return `<div class="ai-empty-state flex flex-col items-center py-6 px-4">
      <div class="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-xl shadow-violet-500/20">🤖</div>
      <p class="text-base font-black text-slate-900 dark:text-white mb-1">AI-помічник</p>
      <p class="text-xs text-slate-400 text-center mb-5 leading-relaxed">Аналізую ваші комунальні,<br>знаходжу аномалії, раджу як економити</p>
      <div class="grid grid-cols-2 gap-2 w-full">
        ${suggestions.map(s => `
          <button class="ai-suggestion text-left bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 active:scale-[0.97] transition-transform hover:border-violet-300 dark:hover:border-violet-500/30" data-text="${s.t}">
            <span class="text-base">${s.e}</span>
            <p class="text-[10px] font-bold text-slate-600 dark:text-slate-300 mt-1 leading-tight">${s.t}</p>
          </button>`).join('')}
      </div>
    </div>`;
  }

  _bindSuggestions() {
    document.querySelectorAll('#aiMessagesList .ai-suggestion').forEach(btn => {
      btn.addEventListener('click', () => this.sendMessage(btn.dataset.text));
    });
  }

  _scrollBottom() {
    const el = document.getElementById('aiMessagesList');
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  // ─── Panel ────────────────────────────────────────────────
  open() {
    this.isOpen = true;
    const panel = document.getElementById('aiChatPanel');
    const inner = document.getElementById('aiPanelInner');
    if (!panel || !inner) return;
    panel.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => inner.classList.remove('translate-y-full')));
    this._render();
    setTimeout(() => {
      document.getElementById('aiInput')?.focus();
      this._scrollBottom();
    }, 420);
  }

  close() {
    this.isOpen = false;
    const inner = document.getElementById('aiPanelInner');
    if (!inner) return;
    inner.classList.add('translate-y-full');
    setTimeout(() => document.getElementById('aiChatPanel')?.classList.add('hidden'), 400);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  // ─── Event binding ────────────────────────────────────────
  init() {
    document.getElementById('aiFabBtn')?.addEventListener('click',  () => this.toggle());
    document.getElementById('aiCloseBtn')?.addEventListener('click', () => this.close());
    document.getElementById('aiClearBtn')?.addEventListener('click', () => {
      if (confirm('Очистити всю історію чату?')) this.clearHistory();
    });

    // Close on backdrop click
    document.getElementById('aiChatPanel')?.addEventListener('click', e => {
      if (e.target.id === 'aiChatPanel') this.close();
    });

    // Send button
    document.getElementById('aiSendBtn')?.addEventListener('click', () => this._handleSend());

    // Enter to send (Shift+Enter = newline)
    document.getElementById('aiInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
    });

    // Auto-resize textarea
    document.getElementById('aiInput')?.addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });

    // Delegated suggestion clicks (rendered dynamically)
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

// ─── Module export ────────────────────────────────────────────
let komunalkaAI = null;

function initAI() {
  if (komunalkaAI) return;
  komunalkaAI = new KomunalkaAI();
  komunalkaAI.init();
  document.getElementById('aiFabBtn')?.classList.remove('hidden');
}

window.initAI       = initAI;
window.komunalkaAI  = komunalkaAI;
