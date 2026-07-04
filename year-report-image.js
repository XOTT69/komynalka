// ============================================================
// YEAR REPORT — Share as Image (окремий модуль)
// ============================================================
async function shareAsImage() {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const curRec = records.find(r => r.month === curMonth);
    if (!curRec) { showToast('Немає даних', '⚠️'); return; }

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');

    // Background
    const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
    grad.addColorStop(0, '#007aff');
    grad.addColorStop(1, '#0051d4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1350);

    // Decorative circles
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(900, 200, 300, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(180, 1100, 200, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // Header
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 36px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Мої комунальні', 540, 120);

    // Month name
    const monthName = new Date(curMonth + '-01').toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
    ctx.fillStyle = 'white';
    ctx.font = '800 56px -apple-system, sans-serif';
    ctx.fillText(monthName, 540, 200);

    // Total
    ctx.font = '900 120px -apple-system, sans-serif';
    ctx.fillText(`${fmt.format(curRec.total)} ₴`, 540, 380);

    // Status
    ctx.font = '700 40px -apple-system, sans-serif';
    const _recPaidStatus = typeof isRecordPaid === 'function' ? isRecordPaid(curRec) : curRec.paid;
    ctx.fillStyle = _recPaidStatus ? '#34c759' : '#ff9500';
    ctx.fillText(_recPaidStatus ? '✅ Оплачено' : '⏳ Очікує оплати', 540, 460);

    // Details card background
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(80, 520, 920, 500, 40);
    else ctx.rect(80, 520, 920, 500);
    ctx.fill();

    // Items
    ctx.textAlign = 'left';
    ctx.fillStyle = 'white';
    let y = 600;
    const items = [];
    if (curRec.waterCost > 0) items.push(['💧 Вода', curRec.waterCost]);
    if (curRec.hotWaterCost > 0) items.push(['🌡️ Гар. вода', curRec.hotWaterCost]);
    if (curRec.electroCost > 0) items.push(['⚡ Світло', curRec.electroCost]);
    if (curRec.gasCost > 0) items.push(['🔥 Газ', curRec.gasCost]);
    if (curRec.customCost > 0) items.push(['📦 Інше', curRec.customCost]);

    items.forEach(([name, cost]) => {
        ctx.font = '600 42px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(name, 140, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'white';
        ctx.font = '800 42px -apple-system, sans-serif';
        ctx.fillText(`${fmt.format(cost)} ₴`, 940, y);
        ctx.textAlign = 'left';
        y += 70;
    });

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '500 28px -apple-system, sans-serif';
    ctx.fillText('Комуналка PWA • by Антон Миколенко', 540, 1280);

    // Export
    canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `komunalka_${curMonth}.png`, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: 'Мої комунальні' }); return; } catch (e) {}
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `komunalka_${curMonth}.png`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Зображення збережено!', '📸');
    }, 'image/png');
}

window.shareAsImage = shareAsImage;
