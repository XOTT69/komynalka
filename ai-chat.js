'use strict';

const AI_MAX_HISTORY    = 200;
const AI_API_HISTORY    = 10;
const AI_HISTORY_KEY    = 'k_ai_history_v2';
const AI_CONTEXT_MONTHS = 6;
const AI_MAX_TOKENS     = 1000;

class KomunalkaAI {
  constructor() {
    this.isOpen    = false;
    this.isLoading = false;
    this.abort     = null;
    this.generation = 0;
    this.historyOwner = this._owner();
    this.history   = this._loadHistory();
  }

  _owner() { return String((typeof sessionLogin !== 'undefined' && sessionLogin) || localStorage.getItem('k_login') || 'guest'); }
  _historyKey() { return `${AI_HISTORY_KEY}:${encodeURIComponent(this._owner())}`; }
  _consentKey() { return `k_ai_consent_v1:${encodeURIComponent(this._owner())}`; }
  _refreshOwner() { const owner=this._owner();if(owner!==this.historyOwner){this.cancel();this.historyOwner=owner;this.history=this._loadHistory();this._syncContextControl();} }
  _contextKey(){return `k_ai_context_v1:${encodeURIComponent(this._owner())}`;}
  _usesContext(){return localStorage.getItem(this._contextKey())==='yes';}
  _syncContextControl(){const control=document.getElementById('aiUseContext');if(control)control.checked=this._usesContext();}
  cancel(){this.generation++;this.abort?.abort();this.abort=null;this._setLoading(false);}

  _loadHistory() {
    try {
      let raw=localStorage.getItem(this._historyKey());
      // Migrate the pre-account global history at most once. Leaving the legacy
      // key intact preserves recovery, while the marker prevents copying one
      // person's chat into every account later used on the same device.
      const migrationMarker='k_ai_history_migrated_v2';
      if(raw===null&&this._owner()!=='guest'&&!localStorage.getItem(migrationMarker)){
        raw=localStorage.getItem('k_ai_history');
        if(raw!==null){localStorage.setItem(this._historyKey(),raw);localStorage.setItem(migrationMarker,this._owner());}
      }
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-AI_MAX_HISTORY).map(m=>({...m,content:m.content.slice(0,12000),ts:Number(m.ts)||Date.now()})) : [];
    } catch { return []; }
  }

  _saveHistory() {
    this.history = this.history.slice(-AI_MAX_HISTORY);
    try { localStorage.setItem(this._historyKey(), JSON.stringify(this.history)); } catch { this._chatToast('Не вдалося зберегти історію на пристрої'); }
  }

  clearHistory() {
    this._refreshOwner();this.cancel();
    if(localStorage.getItem('k_ai_history_migrated_v2')===this._owner())localStorage.removeItem('k_ai_history');
    this.history = [];
    localStorage.removeItem(this._historyKey());
    this._render();
    this._chatToast('Історію очищено ✓');
  }

  _buildSystemPrompt() {
    const base='Ти — універсальний AI-помічник у додатку "Комуналка". Відповідай українською на будь-які запитання: побут, навчання, технології, тексти та комунальні послуги. Будь конкретним і зрозумілим. Для питань про комуналку використовуй наведені нижче дані, якщо користувач їх дозволив. Не вигадуй відсутні дані та не стверджуй, що перевірив актуальну інформацію в інтернеті, коли пошуку немає.';
    if(!this._usesContext())return base+' Комунальні дані не надано. За потреби попроси користувача увімкнути їх або ввести потрібні числа.';
    const recs=typeof records!=='undefined'&&Array.isArray(records)?records:[],addrs=typeof addresses!=='undefined'?addresses:[];
    const address=addrs.find(a=>String(a.id)===String(typeof currentAddressId!=='undefined'?currentAddressId:''));
    const money=value=>new Intl.NumberFormat('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0)+' ₴';
    const balance=rec=>typeof getOutstandingAmount==='function'?getOutstandingAmount(rec):Math.max(0,Number(rec.total||0)-(rec.paymentStatus==='paid'||rec.paid?Number(rec.total||0):Number(rec.paidAmount||0)));
    const rates=value=>Object.fromEntries(['water','hotWater','electroBase','electroWinter','gas','nightCoef','winterLimit'].filter(key=>value?.[key]!=null&&Number.isFinite(Number(value[key]))).map(key=>[key,Number(value[key])]));
    const sorted=[...recs].sort((a,b)=>String(b.month).localeCompare(String(a.month))).slice(0,AI_CONTEXT_MONTHS);
    const lines=sorted.map(rec=>{
      const parts=[`нараховано ${money(rec.total)}`,`залишок ${money(balance(rec))}`];
      for(const [key,label] of [['waterCost','вода'],['hotWaterCost','гаряча вода'],['electroCost','світло'],['gasCost','газ'],['customCost','інші послуги']])if(rec[key]!=null)parts.push(`${label} ${money(rec[key])}`);
      if(typeof KomunalkaProviders!=='undefined'&&address)for(const service of ['water','hotWater','electro','gas']){const values=KomunalkaProviders.meterValues?.({...address,records:[rec]},service,rec.month);if(values)for(const value of values)parts.push(`${value.label}: ${value.current} ${value.unit}; споживання ${value.difference||'не визначено'}`);}
      if(rec.tariffSnapshot)parts.push('історичні тарифи '+JSON.stringify(rates(rec.tariffSnapshot)));
      return `• ${rec.month}: ${parts.join('; ')}`;
    });
    return base+`\nАДРЕСА: ${address?.name||'Мій дім'}\nПоточні тарифи (не застосовувати до історії): ${JSON.stringify(rates(address?.tariffs||{}))}\nМісяців із залишком: ${recs.filter(rec=>balance(rec)>0).length}.\nОстанні ${sorted.length} місяців:\n${lines.join('\n')||'Дані відсутні'}`;
  }

  async sendMessage(userText) {
    if (!userText.trim() || this.isLoading) return;
    this._refreshOwner();
    const owner=this._owner(),generation=++this.generation;
    if(this._usesContext()&&localStorage.getItem(this._consentKey())!=='yes'){
      const accepted=typeof showAppConfirm==='function'?await showAppConfirm('Для відповіді AI застосунок надішле ваш запит, назву поточної адреси, тарифи та підсумки останніх 6 місяців зовнішньому AI-провайдеру. Пароль, email постачальника й повна резервна копія не передаються.',{title:'Дозволити AI-аналіз?',confirmLabel:'Дозволити',icon:'🤖'}):confirm('Дозволити передавання підсумків комунальних даних AI-провайдеру?');
      if(!accepted||this._owner()!==owner||generation!==this.generation)return false;localStorage.setItem(this._consentKey(),'yes');
    }
    if(this._owner()!==owner||generation!==this.generation)return false;
    this.abort?.abort();
    this.abort = new AbortController();
    this._addMsg('user', userText);
    this._setLoading(true);
    try {
      const apiMessages = [
        { role: 'system', content: this._buildSystemPrompt() },
        ...this.history.slice(-AI_API_HISTORY).map(m => ({ role: m.role, content: m.content })),
      ];
      const payload={action:'ai_chat',messages:apiMessages,max_tokens:AI_MAX_TOKENS,temperature:0.4};
      const res=await secureFetch('POST',{},payload,{signal:this.abort.signal});
      if(this._owner()!==owner||generation!==this.generation)return false;
      if (res.status === 429) throw new Error('Забагато запитів. Зачекайте хвилину. ⏳');
      if (!res.ok) {
        const e = await res.json().catch(()=>({}));
        const providerMessage = e.error === 'AI_PROVIDERS_FAILED'
          ? 'AI-провайдер тимчасово недоступний. Спробуйте ще раз за хвилину.'
          : e.error === 'AI_NOT_CONFIGURED'
            ? 'AI ще не налаштований адміністратором.'
            : e.error;
        throw new Error(providerMessage || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) {
        const providerMessage = data.error === 'AI_PROVIDERS_FAILED'
          ? 'AI-провайдер тимчасово недоступний. Спробуйте ще раз за хвилину.'
          : data.error === 'AI_NOT_CONFIGURED'
            ? 'AI ще не налаштований адміністратором.'
            : data.error;
        throw new Error(providerMessage || 'Помилка AI');
      }
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Порожня відповідь');
      if(this._owner()!==owner||generation!==this.generation)return false;
      this._addMsg('assistant', reply+(data.choices?.[0]?.finish_reason==='length'?'\n\nВідповідь скорочено. Можете попросити продовжити.':''));
      return true;
    } catch (e) {
      if(e.name==='AbortError'||this._owner()!==owner||generation!==this.generation)return false;
      this._addMsg('error', `⚠️ ${e.message}`);
      return false;
    } finally {
      if(generation===this.generation){this._setLoading(false);this.abort=null;}
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
    document.getElementById('aiCancelBtn')?.classList.toggle('hidden',!v);
    document.getElementById('aiRetryBtn')?.classList.toggle('hidden',v);
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
        <p class="text-[9px] text-slate-400 mt-1">${time}</p>${!isError?`<button type="button" class="ai-copy" data-ai-copy="${Number(ts)||0}">Скопіювати</button>`:''}
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
      <p class="text-xs text-slate-400 text-center mb-5">Відповідаю на загальні питання й допомагаю з комунальними</p>
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
    this._refreshOwner();
    this._syncContextControl();
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
    document.getElementById('aiUseContext')?.addEventListener('change',event=>localStorage.setItem(this._contextKey(),event.target.checked?'yes':'no'));
    document.getElementById('aiCancelBtn')?.addEventListener('click',()=>{this.cancel();this._chatToast('Запит скасовано');});
    document.getElementById('aiRetryBtn')?.addEventListener('click',()=>{const previous=[...this.history].reverse().find(m=>m.role==='user');if(previous)void this.sendMessage(previous.content);});
    document.getElementById('aiFabBtn')?.addEventListener('click',  () => this.toggle());
    document.getElementById('aiCloseBtn')?.addEventListener('click', () => this.close());
    document.getElementById('aiClearBtn')?.addEventListener('click', () => {
      if (confirm('Очистити всю історію чату?')) this.clearHistory();
    });
    document.getElementById('aiChatPanel')?.addEventListener('click', e => {
      if (e.target.id === 'aiChatPanel') this.close();
    });
    document.getElementById('aiSendBtn')?.addEventListener('click', () => void this._handleSend());
    document.getElementById('aiInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this._handleSend(); }
    });
    document.getElementById('aiInput')?.addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });
    document.getElementById('aiMessagesList')?.addEventListener('click', e => {
      const copy=e.target.closest('[data-ai-copy]');if(copy){const message=this.history.find(m=>m.role==='assistant'&&m.ts===Number(copy.dataset.aiCopy));if(message){(navigator.clipboard?.writeText(message.content)||Promise.reject(new Error('CLIPBOARD_UNAVAILABLE'))).then(()=>{copy.textContent='Скопійовано ✓';this._chatToast('Скопійовано');}).catch(()=>this._chatToast('Не вдалося скопіювати. Виділіть текст відповіді.'));}return;}
      const btn = e.target.closest('.ai-suggestion');
      if (btn?.dataset.text) void this.sendMessage(btn.dataset.text);
    });
  }

  async _handleSend() {
    const input = document.getElementById('aiInput');
    if (!input) return;
    const text = input.value.trim();
    if(!text||this.isLoading)return;
    const owner=this._owner();input.value='';input.style.height='auto';
    const sent=await this.sendMessage(text);if(!sent&&this._owner()===owner&&!input.value)input.value=text;
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
