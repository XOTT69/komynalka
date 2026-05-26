// ============================================================
// CHARTS — Canvas rendering
// ============================================================
import { formatNumber } from './ui.js';

export function renderDashChart(records) {
    const canvas = document.getElementById('dashChartCanvas');
    if (!canvas) return;
    const chart = new BarChart(canvas);
    const sorted = [...records].sort((a, b) => new Date(b.month) - new Date(a.month)).slice(0, 8).reverse();
    const data = sorted.map(r => ({
        value: r.total,
        label: new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3),
        color: r.paid ? '#007aff' : '#ff9500'
    }));
    chart.setData(data);
}

export function renderHistoryChart(canvas, records) {
    if (!canvas) return;
    const chart = new BarChart(canvas);
    const sorted = [...records].sort((a, b) => new Date(a.month) - new Date(b.month)).slice(-10);
    const data = sorted.map(r => ({
        value: r.total,
        label: new Date(r.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3),
        color: r.paid ? '#007aff' : '#ff9500'
    }));
    chart.setData(data);
}

export function renderServiceChart(canvas, records, type = 'water') {
    if (!canvas || !records.length) return;
    const unit = type === 'electro' ? 'кВт' : 'м³';
    const chart = new BarChart(canvas, { unit });
    const sorted = [...records].sort((a, b) => new Date(a.month) - new Date(b.month)).slice(-8);
    const colors = { water: '#3b82f6', hotWater: '#ef4444', electro: '#eab308', gas: '#f97316' };
    const color = colors[type] || '#6b7280';

    const data = sorted.map(rec => {
        let value = 0;
        switch (type) {
            case 'water': value = Math.max(0, (rec.wCur || 0) - (rec.wPrev || 0)); break;
            case 'hotWater': value = Math.max(0, (rec.hwCur || 0) - (rec.hwPrev || 0)); break;
            case 'electro': value = Math.max(0, (rec.dCur || 0) - (rec.dPrev || 0)) + Math.max(0, (rec.nCur || 0) - (rec.nPrev || 0)); break;
            case 'gas': value = Math.max(0, (rec.gCur || 0) - (rec.gPrev || 0)); break;
        }
        return { value, label: new Date(rec.month + '-01').toLocaleString('uk-UA', { month: 'short' }).slice(0, 3), color };
    });
    chart.setData(data);
}

// =================== BAR CHART ENGINE ===================
class BarChart {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.options = { padding: 30, barRadius: 6, animDuration: 500, unit: null, ...options };
        this.data = [];
        this.animProgress = 0;
        this.width = 0; this.height = 0;
        this.setupCanvas();
    }

    setupCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
    }

    setData(data) {
        this.data = data;
        if (!this.width) { this.setupCanvas(); if (!this.width) return; }
        this.animate();
    }

    animate() {
        this.animProgress = 0;
        const start = performance.now();
        const tick = (now) => {
            this.animProgress = Math.min((now - start) / this.options.animDuration, 1);
            this.animProgress = 1 - Math.pow(1 - this.animProgress, 3); // easeOutCubic
            this.render();
            if (this.animProgress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    render() {
        if (!this.ctx || !this.width) return;
        const { ctx, width, height, data, options } = this;
        const { padding, barRadius } = options;
        ctx.clearRect(0, 0, width, height);

        if (!data.length) {
            ctx.fillStyle = '#8e8e93'; ctx.font = '12px -apple-system';
            ctx.textAlign = 'center'; ctx.fillText('Немає даних', width / 2, height / 2);
            return;
        }

        const chartW = width - padding * 2;
        const chartH = height - padding * 1.8;
                const max = Math.max(...data.map(d => d.value), 1);
        const barW = chartW / data.length;
        const barPad = barW * 0.25;

        // Grid lines
        ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 3; i++) {
            const y = padding / 2 + (chartH / 3) * i;
            ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
        }

        // Bars
        data.forEach((d, i) => {
            const barH = Math.max(2, (d.value / max) * chartH * this.animProgress);
            const x = padding + i * barW + barPad;
            const y = padding / 2 + chartH - barH;
            const w = barW - barPad * 2;
            const r = Math.min(barRadius, w / 2, barH / 2);

            // Shadow
            ctx.shadowColor = d.color + '40'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;

            // Bar path
            ctx.beginPath();
            ctx.moveTo(x, y + barH);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + barH);
            ctx.closePath();

            // Gradient fill
            const grad = ctx.createLinearGradient(x, y, x, y + barH);
            grad.addColorStop(0, d.color);
            grad.addColorStop(1, d.color + '80');
            ctx.fillStyle = grad;
            ctx.fill();

            // Reset shadow
            ctx.shadowColor ='transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

            // Label
            ctx.fillStyle = '#8e8e93'; ctx.font = 'bold 9px -apple-system';
            ctx.textAlign = 'center'; ctx.fillText(d.label, x + w / 2, height - 6);
        });
    }
}
