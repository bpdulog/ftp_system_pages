/**
 * Shared UI helpers: escaping, toasts, modals, Chart.js lifecycle & theme.
 */

export function esc(val) {
    return String(val == null ? '' : val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function fmtNum(val, decimals = 2) {
    const n = Number(val || 0);
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtCurrency(val, ccy = 'USD', decimals = 2) {
    return `${ccy} ${fmtNum(val, decimals)}`;
}

export function fmtRatePct(val, decimals = 2) {
    const n = Number(val || 0) * 100;
    return `${n.toFixed(decimals)}%`;
}

export function fmtBpsFromDec(val, signed = true) {
    const bps = Number(val || 0) * 10000;
    const absStr = Math.round(Math.abs(bps)).toLocaleString('en-US');
    if (!signed) return `${bps < 0 ? '-' : ''}${absStr} bps`;
    return `${bps >= 0 ? '+' : '-'}${absStr} bps`;
}

export function showToast(message, type = 'info', durationMs = 3800) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
    el.innerHTML = `<i class="fas ${icon}"></i><span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
}

export function openModal({ title, bodyHtml, footerHtml = '', onMount = null }) {
    const overlay = document.getElementById('appModal');
    document.getElementById('modalTitle').textContent = title;
    const bodyEl = document.getElementById('modalBody');
    const footerEl = document.getElementById('modalFooter');
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML = footerHtml || `<button class="btn" id="modalDefaultClose">Close</button>`;
    overlay.classList.add('active');
    const defClose = document.getElementById('modalDefaultClose');
    if (defClose) defClose.addEventListener('click', closeModal);
    if (onMount) onMount(bodyEl, footerEl);
}

export function closeModal() {
    document.getElementById('appModal')?.classList.remove('active');
}

const activeCharts = [];

export function destroyAllCharts() {
    while (activeCharts.length) {
        const c = activeCharts.pop();
        try { c.destroy(); } catch { /* ignore */ }
    }
}

export function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function syncChartDefaults() {
    if (typeof Chart === 'undefined') return;
    const dark = isDarkTheme();
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = dark ? '#94a3b8' : '#64748b';
    Chart.defaults.borderColor = dark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.22)';
}

export function mountChart(canvasId, config) {
    if (typeof Chart === 'undefined') return null;
    syncChartDefaults();
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    // Enhance bar datasets with subtle rounded corners unless already set
    if (config.data?.datasets) {
        for (const ds of config.data.datasets) {
            const kind = ds.type || config.type;
            if (kind === 'bar' && ds.borderRadius === undefined) {
                ds.borderRadius = 6;
                ds.maxBarThickness = 44;
            }
            if (kind === 'line' && ds.pointRadius === undefined) {
                ds.pointRadius = 3.5;
                ds.pointHoverRadius = 5.5;
                ds.borderWidth = 2.5;
            }
        }
    }

    const chart = new Chart(canvas, config);
    activeCharts.push(chart);
    return chart;
}

export const ChartTheme = (() => {
    syncChartDefaults();
    const palette = {
        navy: '#3b82f6',
        blue: '#2557d6',
        indigo: '#6366f1',
        teal: '#0d9488',
        green: '#10b981',
        amber: '#d97706',
        orange: '#f59e0b',
        red: '#dc2626',
        slate: '#64748b',
        purple: '#7c3aed',
    };
    const compact = (v) => {
        if (v === null || v === undefined) return '';
        const a = Math.abs(v), s = v < 0 ? '-' : '';
        if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
        if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
        return s + a.toFixed(0);
    };
    const gridColor = () => (isDarkTheme() ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.22)');
    return {
        palette,
        compact,
        moneyTicks: (ccy) => ({
            ticks: { callback: v => `${ccy || ''} ${compact(v)}` },
            grid: { color: gridColor(), drawBorder: false },
            border: { display: false },
        }),
        pctTicks: () => ({
            ticks: { callback: v => `${Number(v).toFixed(1)}%` },
            grid: { color: gridColor(), drawBorder: false },
            border: { display: false },
        }),
        grid: { color: 'rgba(148, 163, 184, 0.18)' },
        baseOptions: (extra = {}) => ({
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: true,
                },
            },
            ...extra,
        }),
    };
})();

export function getLatestFtpRun(state) {
    const completed = state.calculation_runs.filter(r => r.run_type === 'ftp' && r.status === 'completed');
    return completed.sort((a, b) => b.id - a.id)[0] || null;
}

export function getRunResults(state, runId) {
    return state.ftp_results.filter(r => r.calculation_run_id === Number(runId));
}

export function getPortfolioCurrencies(state) {
    const set = new Set(state.instruments.map(i => String(i.currency || 'USD').toUpperCase()));
    return set.size ? [...set].sort() : ['USD'];
}
