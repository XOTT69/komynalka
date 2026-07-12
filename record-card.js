'use strict';

// Record history card rendering and interactions.
function createRecordCard(rec) {
  const card = document.createElement('div');
  const recPaid = isRecordPaid(rec), paymentStatus = getPaymentStatus(rec), paidAmount = getPaidAmount(rec), outstanding = getOutstandingAmount(rec);
  card.className = `premium-card swipe-card p-5 relative overflow-hidden cursor-pointer select-none ${recPaid ? '' : 'ring-1 ring-orange-400/20'}`;
  const dStr = new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'long' });
  const [rY, rM] = rec.month.split('-');

  // Рахуємо лише активні послуги
  const showW  = prefs.showWater   && (rec._filled?.water    || rec.waterCost > 0);
  const showHW = prefs.showHotWater && (rec._filled?.hotWater || rec.hotWaterCost > 0);
  const showE  = prefs.showElectro  && (rec._filled?.electro  || rec.electroCost > 0);
  const showG  = prefs.showGas      && (rec._filled?.gas      || rec.gasCost > 0);
  const showC  = rec.customCost > 0;

  const filledServices = [];
  if (showW)  filledServices.push('💧');
  if (showHW) filledServices.push('🌡️');
  if (showE)  filledServices.push('⚡');
  if (showG)  filledServices.push('🔥');
  if (showC)  filledServices.push('📦');

  const totalExp = (prefs.showWater?1:0)+(prefs.showHotWater?1:0)+(prefs.showElectro?1:0)+(prefs.showGas?1:0)+(customServices.length>0?1:0);
  const isPartial = filledServices.length < totalExp && filledServices.length > 0;
  const partialBadge = isPartial ? `<span class="text-[9px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-md ml-2">Частково</span>` : '';
  const prevYR = records.find(r => r.month === (parseInt(rY)-1) + '-' + rM);
  let yoy = '';
  if (prevYR && prevYR.total > 0 && rec.total > 0) {
    const p = Math.round(((rec.total - prevYR.total) / prevYR.total) * 100);
    if (p < 0) yoy = `<span class="text-[9px] font-bold text-green-600 bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-md ml-2">↓${Math.abs(p)}%</span>`;
    else if (p > 0) yoy = `<span class="text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-md ml-2">↑+${p}%</span>`;
  }

  // Доля тільки активних
  const activeTotal = (showW ? rec.waterCost||0 : 0) + (showHW ? rec.hotWaterCost||0 : 0) + (showE ? rec.electroCost||0 : 0) + (showG ? rec.gasCost||0 : 0) + (showC ? rec.customCost||0 : 0);
  const pW  = activeTotal > 0 ? ((showW  ? rec.waterCost||0    : 0) / activeTotal) * 100 : 0;
  const pHW = activeTotal > 0 ? ((showHW ? rec.hotWaterCost||0 : 0) / activeTotal) * 100 : 0;
  const pE  = activeTotal > 0 ? ((showE  ? rec.electroCost||0  : 0) / activeTotal) * 100 : 0;
  const pG  = activeTotal > 0 ? ((showG  ? rec.gasCost||0      : 0) / activeTotal) * 100 : 0;
  const conic = `conic-gradient(#3b82f6 0% ${pW}%,#ef4444 ${pW}% ${pW+pHW}%,#eab308 ${pW+pHW}% ${pW+pHW+pE}%,#f97316 ${pW+pHW+pE}% ${pW+pHW+pE+pG}%,#a855f7 ${pW+pHW+pE+pG}% 100%)`;
  const recId = rec.id;
  const detailsId = `record-details-${String(recId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  // Перевірка зміни тарифу
  let tariffChangedBadge = '';
  if (rec.tariffSnapshot) {
    const changed = [];
    if (showW  && Math.abs((rec.tariffSnapshot.water||0)      - tariffs.water)       > 0.001) changed.push('💧');
    if (showHW && Math.abs((rec.tariffSnapshot.hotWater||0)   - tariffs.hotWater)    > 0.001) changed.push('🌡️');
    if (showE  && Math.abs((rec.tariffSnapshot.electroBase||0)- tariffs.electroBase) > 0.001) changed.push('⚡');
    if (showG  && Math.abs((rec.tariffSnapshot.gas||0)        - tariffs.gas)         > 0.001) changed.push('🔥');
    if (changed.length) tariffChangedBadge = `<span class="text-[9px] font-bold text-violet-600 bg-violet-50 dark:bg-violet-500/10 px-2 py-0.5 rounded-md ml-1" title="Тариф змінився з часу запису">⚠️ тариф ${changed.join('')}</span>`;
  }

  card.innerHTML = `
    ${!recPaid ? '<div class="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-orange-400/15 to-transparent rounded-bl-[4rem]"></div>' : ''}
    <button type="button" class="w-full flex justify-between items-center relative z-10 text-left" data-toggle-details aria-expanded="false" aria-controls="${detailsId}">
      <div>
        <h4 class="font-bold text-xl capitalize text-slate-900 dark:text-white mb-1.5">${escapeHtml(dStr)}</h4>
        <div class="flex items-center flex-wrap gap-1">
          <span class="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${recPaid ? 'bg-brand-light text-brand' : paymentStatus === 'partial' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'}">${getPaymentLabel(rec)}</span>
          ${partialBadge}${yoy}${tariffChangedBadge}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="font-black text-2xl text-slate-900 dark:text-white">${fmt.format(rec.total)} ₴</span>
        <div class="w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-white/5 rounded-full text-slate-400"><i class="chevron-icon fa-solid fa-chevron-down transition-transform duration-300"></i></div>
      </div>
    </button>
    <div id="${detailsId}" class="details-panel hidden">
      <div class="border-t border-slate-100 dark:border-white/5 pt-5 mt-5">
        ${rec.total > 0 ? `<div class="flex items-center gap-4 bg-slate-50 dark:bg-black/50 p-4 rounded-2xl border border-slate-100 dark:border-white/5 mb-5"><div class="w-14 h-14 rounded-full shrink-0 shadow-sm border border-slate-200 dark:border-white/10" style="background:${conic}"></div><div class="flex flex-col gap-1 text-[10px] font-bold text-slate-500 w-full">${pW>0?`<div class="flex justify-between"><span>💧 Вода</span><span>${Math.round(pW)}%</span></div>`:''}${pHW>0?`<div class="flex justify-between"><span>🌡️ Гар.</span><span>${Math.round(pHW)}%</span></div>`:''}${pE>0?`<div class="flex justify-between"><span>⚡ Світло</span><span>${Math.round(pE)}%</span></div>`:''}${pG>0?`<div class="flex justify-between"><span>🔥 Газ</span><span>${Math.round(pG)}%</span></div>`:''}${(100-pW-pHW-pE-pG)>1?`<div class="flex justify-between"><span>📦 Інше</span><span>${Math.round(100-pW-pHW-pE-pG)}%</span></div>`:''}</div></div>` : ''}
        <div class="space-y-3">
          ${showW ? `<div class="flex justify-between"><span class="font-bold">💧 Вода</span><span class="font-black">${fmt.format(rec.waterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.wPrev}→${rec.wCur}</span><span class="text-blue-500">+${rec.wCur-rec.wPrev} м³</span></div>` : ''}
          ${showHW ? `<div class="flex justify-between"><span class="font-bold">🌡️ Гар.</span><span class="font-black">${fmt.format(rec.hotWaterCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.hwPrev}→${rec.hwCur}</span><span class="text-red-500">+${rec.hwCur-rec.hwPrev} м³</span></div>` : ''}
          ${showE ? `<div class="flex justify-between"><span class="font-bold">⚡ Світло</span><span class="font-black">${fmt.format(rec.electroCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>Д:${rec.dPrev}→${rec.dCur}</span><span class="text-yellow-600">+${rec.dCur-rec.dPrev}</span></div>${(rec.nCur||rec.nPrev)?`<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl mt-1"><span>Н:${rec.nPrev}→${rec.nCur}</span><span class="text-indigo-500">+${rec.nCur-rec.nPrev}</span></div>`:''}` : ''}
          ${showG ? `<div class="flex justify-between"><span class="font-bold">🔥 Газ</span><span class="font-black">${fmt.format(rec.gasCost)} ₴</span></div><div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${rec.gPrev}→${rec.gCur}</span><span class="text-orange-500">+${rec.gCur-rec.gPrev} м³</span></div>` : ''}
          ${showC ? `<div class="flex justify-between"><span class="font-bold">📦 Інше</span><span class="font-black">${fmt.format(rec.customCost)} ₴</span></div>${rec.customData ? Object.values(rec.customData).filter(s=>s.val>0).map(s=>`<div class="flex justify-between text-[11px] font-bold text-slate-500 bg-slate-50 dark:bg-black/50 px-3 py-2 rounded-xl"><span>${escapeHtml(s.name)}</span><span class="text-purple-500">${fmt.format(s.val)} ₴</span></div>`).join('') : ''}` : ''}
          ${paymentStatus === 'partial' ? `<div class="flex justify-between text-[11px] font-bold text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-500/10 px-3 py-2 rounded-xl"><span>💳 Сплачено частково</span><span>${fmt.format(paidAmount)} ₴ / борг ${fmt.format(outstanding)} ₴</span></div>` : ''}
          ${rec.note ? `<div class="mt-3 p-3 bg-slate-50 dark:bg-black/50 rounded-xl text-xs text-slate-500 italic"><i class="fa-solid fa-sticky-note mr-1"></i>${escapeHtml(rec.note)}</div>` : ''}
        </div>
      </div>
      <div class="flex gap-2.5 mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
        <button type="button" class="rec-pay flex-1 py-3.5 rounded-2xl font-bold text-xs border active:scale-[0.96] transition-all ${recPaid ? 'bg-slate-50 dark:bg-[#2c2c2e] text-slate-500 border-slate-200 dark:border-white/10' : 'bg-gradient-to-r from-brand to-blue-600 text-white shadow-lg border-brand'}">${recPaid ? '↩ Нараховано' : '✓ Оплачено'}</button>
        <button type="button" aria-label="Поділитися записом" class="rec-share w-12 bg-blue-50 dark:bg-blue-500/10 rounded-2xl text-blue-500 active:scale-[0.90] transition-transform"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i></button>
        <button type="button" aria-label="Редагувати запис" class="rec-edit w-12 bg-slate-50 dark:bg-white/5 rounded-2xl text-slate-400 active:scale-[0.90] transition-transform"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button type="button" aria-label="Видалити запис" class="rec-del w-12 bg-red-50 dark:bg-red-500/10 rounded-2xl text-red-400 active:scale-[0.90] transition-transform"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    </div>`;

  const swL = document.createElement('div'); swL.className = 'swipe-bg-left'; swL.innerHTML = '<i class="fa-solid fa-trash mr-2"></i>Видалити';
  const swR = document.createElement('div'); swR.className = 'swipe-bg-right'; swR.innerHTML = `<i class="fa-solid fa-${recPaid ? 'rotate-left' : 'check'} mr-2"></i>${recPaid ? 'Нараховано' : 'Оплачено'}`;
  card.insertBefore(swL, card.firstChild); card.insertBefore(swR, card.firstChild);
  initSwipe(card, recId);

  card.addEventListener('click', async (e) => {
    const toggleTarget = e.target.closest('[data-toggle-details]');
    if (toggleTarget) { const panel = card.querySelector('.details-panel'), chevron = card.querySelector('.chevron-icon'); if (panel) { panel.classList.toggle('hidden'); const expanded=!panel.classList.contains('hidden'); toggleTarget.setAttribute('aria-expanded',String(expanded)); if (chevron) chevron.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)'; } return; }
    const payBtn = e.target.closest('.rec-pay');     if (payBtn)   { e.stopPropagation(); togglePaidById(recId); return; }
    const shareBtn = e.target.closest('.rec-share'); if (shareBtn) { e.stopPropagation(); shareRecordById(recId); return; }
    const editBtn = e.target.closest('.rec-edit');   if (editBtn)  { e.stopPropagation(); editRecordById(recId); return; }
    const delBtn = e.target.closest('.rec-del');     if (delBtn)   { e.stopPropagation(); if (requireEdit('У режимі перегляду не можна видаляти записи') && await showAppConfirm('Видалити цей запис?',{title:'Видалення запису',confirmLabel:'Видалити',danger:true,icon:'🗑️'})) deleteRecordById(recId); return; }
  });
  return card;
}
