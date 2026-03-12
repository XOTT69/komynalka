// ─── Рендер графіку ───────────────────────────────────────────
window.renderChart = () => {
  const container = $('chartContainer');
  if (!container) return;
  const recs = [...(window.records || [])].sort((a, b) => new Date(a.month) - new Date(b.month)).slice(-6);
  if (!recs.length) { container.innerHTML = ''; return; }

  const max = Math.max(...recs.map(r => r.total), 1);
  const avg = recs.reduce((s, r) => s + r.total, 0) / recs.length;
  $('statsAvg').textContent = `${fmt.format(avg)} ₴`;

  const frag = document.createDocumentFragment();
  recs.forEach(r => {
    const h = Math.max(8, Math.round((r.total / max) * 140));
    const isCurrent = r.month === new Date().toISOString().slice(0,7);
    const col = document.createElement('div');
    col.className = 'flex flex-col items-center justify-end gap-1 flex-1';
    col.innerHTML = `
      <span class="text-[9px] font-bold text-slate-500">${fmt.format(r.total).split(',')[0]}</span>
      <div class="${isCurrent ? 'bg-brand' : 'bg-slate-200 dark:bg-white/15'} rounded-xl w-full transition-all duration-500" style="height:${h}px"></div>
      <span class="text-[9px] font-bold text-slate-400">${r.month.slice(5)}</span>
    `;
    frag.appendChild(col);
  });
  container.innerHTML = '';
  container.appendChild(frag);
};

// ─── Рендер списку записів ────────────────────────────────────
window.renderRecords = () => {
  const list = $('recordsList');
  if (!list) return;
  const sorted = [...(window.records || [])].sort((a, b) => new Date(b.month) - new Date(a.month));
  if (!sorted.length) {
    list.innerHTML = `<div class="text-center py-12 text-slate-400"><p class="text-4xl mb-3">📋</p><p class="font-bold">Немає записів</p><p class="text-sm mt-1">Зробіть перший розрахунок</p></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  sorted.forEach((rec, idx) => {
    // Дельта з попереднім місяцем
    const prev = sorted[idx + 1];
    const delta = prev ? rec.total - prev.total : null;
    const deltaHtml = delta !== null
      ? `<span class="text-xs font-bold ${delta > 0 ? 'text-orange-500' : 'text-green-500'}">${delta > 0 ? '▲' : '▼'} ${fmt.format(Math.abs(delta))} ₴</span>`
      : '';

    // Рік тому
    const yoyRec = window.records?.find(r => r.month === subtractYear(rec.month));
    const yoyHtml = yoyRec
      ? `<span class="text-[10px] text-slate-400">рік тому: ${fmt.format(yoyRec.total)} ₴</span>`
      : '';

    const card = document.createElement('div');
    card.className = `bg-white dark:bg-apple-dark rounded-[2rem] shadow-soft border ${rec.paid ? 'border-green-200 dark:border-green-500/20' : 'border-slate-100 dark:border-white/5'} overflow-hidden`;

    // Свайп для оплати
    card.innerHTML = `
      <div class="swipe-card p-5" data-idx="${idx}" style="transition: transform 0.3s ease;">
        <div class="flex justify-between items-start mb-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <h4 class="font-black text-lg text-slate-900 dark:text-white">${formatMonth(rec.month)}</h4>
              ${rec.paid ? '<span class="text-xs font-bold text-green-500 bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-full">✓ Оплачено</span>' : ''}
            </div>
            <div class="flex items-center gap-2">${deltaHtml}${yoyHtml}</div>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="shareRecordReceipt(${idx}, event)" class="w-9 h-9 flex items-center justify-center bg-slate-50 dark:bg-white/5 rounded-2xl text-sm active:scale-90 transition-transform">📤</button>
            <button onclick="togglePaid(${idx})" class="w-9 h-9 flex items-center justify-center bg-slate-50 dark:bg-white/5 rounded-2xl text-sm active:scale-90 transition-transform">${rec.paid ? '💳' : '☑️'}</button>
            <button onclick="deleteRecord(${idx})" class="w-9 h-9 flex items-center justify-center bg-red-50 dark:bg-red-500/10 rounded-2xl text-sm active:scale-90 transition-transform">🗑️</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm mb-4">
          ${rec.waterCost   > 0 ? `<div class="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span>💧</span><span class="font-bold">${fmt.format(rec.waterCost)} ₴</span></div>` : ''}
          ${rec.hotWaterCost > 0 ? `<div class="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span>🌡️</span><span class="font-bold">${fmt.format(rec.hotWaterCost)} ₴</span></div>` : ''}
          ${rec.electroCost > 0 ? `<div class="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span>⚡️</span><span class="font-bold">${fmt.format(rec.electroCost)} ₴</span></div>` : ''}
          ${rec.gasCost     > 0 ? `<div class="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span>🔥</span><span class="font-bold">${fmt.format(rec.gasCost)} ₴</span></div>` : ''}
          ${rec.customCost  > 0 ? `<div class="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span>📦</span><span class="font-bold">${fmt.format(rec.customCost)} ₴</span></div>` : ''}
        </div>
        <div class="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-white/5">
          <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Разом</span>
          <span class="font-black text-xl text-slate-900 dark:text-white">${fmt.format(rec.total)} ₴</span>
        </div>
      </div>
    `;
    initSwipeGesture(card.querySelector('.swipe-card'), idx);
    frag.appendChild(card);
  });

  list.innerHTML = '';
  list.appendChild(frag);
};

// ─── Повний рендер історії ─────────────────────────────────────
window.renderHistory = () => {
  showSkeleton();
  // Мікротаск щоб не блокувати UI
  setTimeout(() => {
    renderChart();
    renderRecords();
    hideSkeleton();
  }, 50);
};

// ─── Свайп для оплати ─────────────────────────────────────────
function initSwipeGesture(el, idx) {
  let startX = 0, currentX = 0, swiped = false;
  el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; swiped = false; }, { passive: true });
  el.addEventListener('touchmove', e => {
    currentX = e.touches[0].clientX - startX;
    if (currentX > 0 && currentX < 100) el.style.transform = `translateX(${currentX}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (currentX > 70 && !swiped) {
      swiped = true;
      togglePaid(idx);
      vibe([15, 5, 15]);
    }
    el.style.transform = '';
    currentX = 0;
  });
}

// ─── Дії з записами ───────────────────────────────────────────
window.togglePaid = async idx => {
  const sorted = [...(window.records || [])].sort((a, b) => new Date(b.month) - new Date(a.month));
  const rec = sorted[idx];
  const realIdx = window.records.findIndex(r => r.month === rec.month);
  if (realIdx < 0) return;
  window.records[realIdx].paid = !window.records[realIdx].paid;
  await syncToCloud();
  renderRecords();
  showToast(window.records[realIdx].paid ? 'Позначено оплаченим' : 'Знято відмітку', '💳');
};

window.deleteRecord = async idx => {
  const sorted = [...(window.records || [])].sort((a, b) => new Date(b.month) - new Date(a.month));
  const rec = sorted[idx];
  window.records = window.records.filter(r => r.month !== rec.month);
  await syncToCloud();
  renderHistory();
  showToast('Видалено', '🗑️');
};

window.shareRecordReceipt = (idx, event) => {
  event?.stopPropagation(); vibe();
  const sorted = [...(window.records || [])].sort((a, b) => new Date(b.month) - new Date(a.month));
  const r = sorted[idx];
  const lines = [`🏡 Комуналка за ${formatMonth(r.month)}`];
  if (r.waterCost   > 0) lines.push(`💧 Вода: ${fmt.format(r.waterCost)} ₴`);
  if (r.hotWaterCost > 0) lines.push(`🌡️ Гар.вода: ${fmt.format(r.hotWaterCost)} ₴`);
  if (r.electroCost > 0) lines.push(`⚡️ Світло: ${fmt.format(r.electroCost)} ₴`);
  if (r.gasCost     > 0) lines.push(`🔥 Газ: ${fmt.format(r.gasCost)} ₴`);
  if (r.customCost  > 0) lines.push(`📦 Інше: ${fmt.format(r.customCost)} ₴`);
  lines.push(`─────────────\n💰 РАЗОМ: ${fmt.format(r.total)} ₴`);
  const text = lines.join('\n');
  if (navigator.share) navigator.share({ text });
  else navigator.clipboard.writeText(text).then(() => showToast('Скопійовано', '📋'));
};

// ─── Експорт CSV ──────────────────────────────────────────────
window.exportCSV = () => {
  const sorted = [...(window.records || [])].sort((a, b) => new Date(a.month) - new Date(b.month));
  const headers = ['Місяць','Вода','Гар.Вода','Світло','Газ','Інше','Разом','Оплачено'];
  const rows = sorted.map(r => [r.month, r.waterCost, r.hotWaterCost, r.electroCost, r.gasCost, r.customCost, r.total, r.paid ? 'Так' : 'Ні']);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })), download: `komunalka_${Date.now()}.csv` });
  a.click();
};

// ─── Утиліти форматування ─────────────────────────────────────
window.formatMonth = str => {
  if (!str) return '';
  const [y, m] = str.split('-');
  return new Date(+y, +m - 1).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
};
window.subtractYear = str => {
  if (!str) return '';
  const [y, m] = str.split('-');
  return `${+y - 1}-${m}`;
};
