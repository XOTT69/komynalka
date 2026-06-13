// ============================================================
// КОМУНАЛКА AI — Smart Assistant Module v1.0
// ============================================================
'use strict';

const AI_MAX_HISTORY = 10;
const AI_HISTORY_KEY = 'k_ai_history';
const AI_CONTEXT_MONTHS = 6;
const AI_MAX_TOKENS = 350;

class KomunalkaAI {
  constructor() {
    this.isOpen = false;
    this.isLoading = false;
    this.abortController = null;
    this.history = this._loadHistory();
  }

  // ─── History persistence ─────────────────────────────────
  _loadHistory() {
    try {
      const raw = localStorage.getItem(AI_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  _saveHistory() {
    try {
      this.history = this.history.slice(-AI_MAX_HISTORY);
      localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(this.history));
    } catch {}
  }

  clearHistory() {
    this.history = [];
    localStorage.removeItem(AI_HISTORY_KEY);
    this._renderMessages();
    this._showToastInChat('Історію очищено');
  }

  // ─── Context builder ─────────────────────────────────────
  _buildSystemPrompt() {
    const addr = (typeof addresses !== 'undefined' && Array.isArray(addresses))
      ? addresses.find(a => a.id === currentAddressId)
      : null;
    const recs = (typeof records !== 'undefined' && Array.isArray(records)) ? records : [];
    const t = (typeof tariffs !== 'undefined') ? tariffs : {};

    const sorted = [...recs]
      .sort((a, b) => new Date(b.month) - new Date(a.month))
      .slice(0, AI_CONTEXT_MONTHS);

    const avg = sorted.length
      ? Math.round(sorted.reduce((s, r) => s + (r.total || 0), 0) / sorted.length)
      : 0;

    const streak = (typeof getStreak === 'function') ? getStreak(recs) : 0;

    const unpaid = recs.filter(r => !r.paid);
    const unpaidSum = unpaid.reduce((s, r) => s + (r.total || 0), 0);

    const recordsText = sorted.length
      ? sorted.map(r => {
          const parts = [];
          if (r.waterCost > 0) parts.push(`вода ${Math.round(r.waterCost)}₴`);
          if (r.hotWaterCost > 0) parts.push(`гар.вода ${Math.round(r.hotWaterCost)}₴`);
          if (r.electroCost > 0) parts.push(`світло ${Math.round(r.electroCost)}₴`);
          if (r.gasCost > 0) parts.push(`газ ${Math.round(r.gasCost)}₴`);
          if (r.customCost > 0) parts.push(`інше ${Math.round(r.customCost)}₴`);
          const wUsage = Math.max(0, (r.wCur || 0) - (r.wPrev || 0));
          const eUsage = Math.max(0, (r.dCur || 0) - (r.dPrev || 0)) + Math.max(0, (r.nCur || 0) - (r.nPrev || 0));
          const gUsage = Math.max(0, (r.gCur || 0) - (r.gPrev || 0));
          const usage = [wUsage > 0 && `${wUsage}м³вод`, eUsage > 0 && `${eUsage}кВт`, gUsage > 0 && `${gUsage}м³газ`].filter(Boolean).join(' ');
          return `• ${r.month}: ${Math.round(r.total)}₴ [${parts.join(', ')}] ${usage ? `(${usage})` : ''} ${r.paid ? '✓' : '⏳'}`;
        }).join('\n')
      : '• Записів поки немає';

    return `Ти — AI-помічник додатку "Комуналка" для обліку комунальних платежів в Україні. Відповідай тільки українською.

АДРЕСА: "${addr?.name || 'Мій дім'}"

ТАРИФИ:
• Вода: ${t.water || 30.38}₴/м³
• Гаряча вода: ${t.hotWater || 100}₴/м³  
• Електрика (день): ${t.electroBase || 4.32}₴/кВт, (ніч ×${t.nightCoef || 0.5})
• Газ: ${t.gas || 7.96}₴/м³

СТАТИСТИКА:
• Середній рахунок: ${avg}₴/міс
• Серія без пропуску: ${streak} міс
• Не оплачено: ${unpaid.length} записів = ${Math.round(unpaidSum)}₴

ОСТАННІ ${sorted.length} МІС:
${recordsText}

ПРАВИЛА:
- Відповідай КОРОТКО (1-3 речення). Без зайвих вступів.
- Оперуй конкретними числами з даних вище.
- Якщо питання не про комуналку — ввічливо поверни до теми.
- Порівнюй місяці, знаходь аномалії, давай конкретні поради.`;
  }

  // ─── API call ─────────────────────────────────────────────
  async sendMessage(userText) {
    if (!userText.trim() || this.isLoading) return;

    // Abort previous if pending
    this.abortController?.abort();
    this.abortController = new AbortController();

    this._addToHistory('user', userText);
    this._setLoading(true);

    try {
      const apiMessages = [
        { role: 'system', content: this._buildSystemPrompt() },
        ...this.history
          .filter(m => m.role !== 'error')
          .slice(-(AI_MAX_HISTORY - 1))
          .map(m => ({ role: m.role, content: m.content }))
      ];

      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-FP': (typeof DEVICE_FP !== 'undefined') ? DEVICE_FP : 'unknown',
          ...(typeof sessionLogin !== 'undefined' && sessionLogin
            ? { 'Authorization': `Bearer login:${btoa(unescape(encodeURIComponent(sessionLogin)))}:${sessionPass}` }
            : {}),
        },
        body: JSON.stringify({
          action: 'ai_chat',
          messages: apiMessages,
          max_tokens: AI_MAX_TOKENS,
          temperature: 0.4,
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Невідома помилка');

      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Порожня відповідь від AI');

      this._addToHistory('assistant', reply);

    } catch (err) {
      if (err.name === 'AbortError') return;
      const msg = err.message.includes('429')
        ? 'Забагато запитів. Зачекайте хвилину. ⏳'
        : `Помилка: ${err.message}`;
      this._addToHistory('error', msg);
    } finally {
      this._setLoading(false);
      this.abortController = null;
    }
  }

  // ─── Internal helpers ─────────────────────────────────────
  _addToHistory(role, content) {
    this.history.push({ role: role === 'error' ? 'assistant' : role, content, ts: Date.now(), isError: role === 'error' });
    this._saveHistory();
    this._renderMessages();
    this._scrollToBottom();
  }

  _setLoading(val) {
    this.isLoading = val;
    const indicator = document.getElementById('aiTypingIndicator');
    const sendBtn = document.getElementById('aiSendBtn');
    const input = document.getElementById('aiInput');
    indicator?.classList.toggle('hidden', !val);
    if (sendBtn) sendBtn.disabled = val;
    if (input) input.disabled = val;
    if (val) this._scrollToBottom();
  }

  _showToastInChat(text) {
    const el = document.getElementById('aiChatToast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('opacity-0');
    setTimeout(() => el.classList.add('opacity-0'), 2000);
  }

  // ─── Render ───────────────────────────────────────────────
  _renderMessages() {
    const container = document.getElementById('aiMessagesList');
    if (!container) return;

    const visibleHistory = this.history.filter(m => m.role !== 'system');

    if (visibleHistory.length === 0) {
      container.innerHTML = this._emptyStateHTML();
      return;
    }

    container.innerHTML = visibleHistory.map(m => {
      const isUser = m.role === 'user';
      const time = m.ts
        ? new Date(m.ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
        : '';

      const content = this._formatContent(m.content, m.isError);

      if (isUser) {
        return `<div class="flex justify-end mb-3 animate-fade-in">
          <div class="max-w-[82%]">
            <div class="bg-brand text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed shadow-md shadow-brand/20">${content}</div>
            <p class="text-[9px] text-slate-400 text-right mt-1 mr-1">${time}</p>
          </div>
        </div>`;
      }

      return `<div class="flex gap-2 mb-3 animate-fade-in">
        <div class="w-7 h-7 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center text-[13px] shrink-0 mt-0.5 shadow-md">🤖</div>
        <div class="max-w-[82%]">
          <div class="${m.isError ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30' : 'bg-white dark:bg-[#2c2c2e] text-slate-700 dark:text-slate-200 border-slate-100 dark:border-white/10'} px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed border shadow-sm">${content}</div>
          <p class="text-[9px] text-slate-400 mt-1 ml-1">${time}</p>
        </div>
      </div>`;
    }).join('');
  }

  _formatContent(text, isError) {
    if (!text) return '';
    // escapeHtml is defined in app.js
    const escaped = (typeof escapeHtml === 'function') ? escapeHtml(text) : text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
      .replace(/\n\n/g, '</p><p class="mt-2">')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code class="bg-slate-100 dark:bg-white/10 px-1 rounded text-[11px]">$1</code>');
  }

  _emptyStateHTML() {
    const suggestions = [
      { emoji: '📊', text: 'Проаналізуй мої витрати за останній місяць' },
      { emoji: '💡', text: 'Як я можу зекономити на електриці?' },
      { emoji: '📈', text: 'Порівняй мої витрати з минулим роком' },
      { emoji: '⚠️', text: 'Чи є аномалії в моїх даних?' },
    ];

    return `<div class="flex flex-col items-center py-6 px-4">
      <div class="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-xl shadow-violet-500/20">🤖</div>
      <p class="text-base font-black text-slate-900 dark:text-white mb-1">AI-помічник</p>
      <p class="text-xs text-slate-400 text-center mb-5">Аналізую ваші комунальні, знаходжу аномалії, даю поради</p>
      <div class="grid grid-cols-2 gap-2 w-full">
        ${suggestions.map(s => `
          <button class="ai-suggestion text-left bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 active:scale-[0.97] transition-transform hover:border-violet-300 dark:hover:border-violet-500/30" data-text="${s.text}">
            <span class="text-base">${s.emoji}</span>
            <p class="text-[10px] font-bold text-slate-600 dark:text-slate-300 mt-1 leading-tight">${s.text}</p>
          </button>`).join('')}
      </div>
    </div>`;
  }

  _scrollToBottom() {
    const el = document.getElementById('aiMessagesList');
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  // ─── Panel open/close ─────────────────────────────────────
  open() {
    this.isOpen = true;
    const panel = document.getElementById('aiChatPanel');
    const inner = document.getElementById('aiPanelInner');
    if (!panel || !inner) return;
    panel.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => inner.classList.remove('translate-y-full'));
    });
    this._renderMessages();
    setTimeout(() => {
      document.getElementById('aiInput')?.focus();
      this._scrollToBottom();
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

  // ─── Event bindings ───────────────────────────────────────
  init() {
    document.getElementById('aiFabBtn')?.addEventListener('click', () => this.toggle());
    document.getElementById('aiCloseBtn')?.addEventListener('click', () => this.close());
    document.getElementById('aiClearBtn')?.addEventListener('click', () => {
      if (confirm('Очистити всю історію чату?')) this.clearHistory();
    });

    // Backdrop close
    document.getElementById('aiChatPanel')?.addEventListener('click', (e) => {
      if (e.target.id === 'aiChatPanel') this.close();
    });

    // Send
    document.getElementById('aiSendBtn')?.addEventListener('click', () => this._handleSend());
    document.getElementById('aiInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
    });

    // Auto-resize textarea
    document.getElementById('aiInput')?.addEventListener('input', (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });

    // Suggestions (delegated — re-bind after render)
    document.getElementById('aiMessagesList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.ai-suggestion');
      if (btn?.dataset.text) this.sendMessage(btn.dataset.text);
    });
  }

  _handleSend() {
    const input = document.getElementById('aiInput');
    if (!input) return;
    const text = input.value.trim();
    if (text) {
      input.value = '';
      input.style.height = 'auto';
      this.sendMessage(text);
    }
  }
}

// ─── Init (called from app.js after login) ───────────────────
let komunalkaAI = null;

function initAI() {
  if (komunalkaAI) return; // prevent double init
  komunalkaAI = new KomunalkaAI();
  komunalkaAI.init();

  // Show FAB only when logged in
  document.getElementById('aiFabBtn')?.classList.remove('hidden');
}

window.initAI = initAI;
window.komunalkaAI = null; // will be set after init
