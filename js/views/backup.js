import { exportBankJsonBackup } from '../exports.js';
import { esc, showToast } from '../ui.js';

export async function renderBackup(host, ctx) {
    const { store, rerender } = ctx;
    const s = store.state;

    host.innerHTML = `
    <div class="card">
        <h2>Browser Persistence &amp; JSON Backup</h2>
        <p class="definition">
            Because this GitHub Pages edition runs 100% in your browser without a server database, all instruments, curves,
            buckets, reporting groups, and calculation runs are stored locally in <strong>IndexedDB</strong> (with <code>localStorage</code> fallback).
        </p>
        <div class="metrics-grid" style="margin-top:1rem;">
            <div class="metric-card"><div class="metric-label">Active Bank Mode</div><div class="metric-value" style="font-size:1.2rem;">${esc(store.mode.toUpperCase())}</div></div>
            <div class="metric-card"><div class="metric-label">Instruments</div><div class="metric-value">${s.instruments.length}</div></div>
            <div class="metric-card"><div class="metric-label">Yield Curves</div><div class="metric-value">${s.yield_curves.length}</div></div>
            <div class="metric-card"><div class="metric-label">Calculation Runs</div><div class="metric-value">${s.calculation_runs.length}</div></div>
        </div>
        <div class="action-buttons">
            <button class="btn btn-primary" id="btnJsonExport" type="button"><i class="fas fa-download"></i> Download Full JSON Backup</button>
            <label class="btn" style="cursor:pointer;">
                <i class="fas fa-upload"></i> Restore from JSON Backup
                <input type="file" id="inpJsonRestore" accept=".json" hidden>
            </label>
            <button class="btn btn-outline-danger" id="btnWipeBank" type="button"><i class="fas fa-trash"></i> Clear Active Browser Bank</button>
        </div>
    </div>`;

    document.getElementById('btnJsonExport')?.addEventListener('click', () => {
        exportBankJsonBackup(store);
        showToast('JSON backup downloaded.', 'success');
    });

    document.getElementById('inpJsonRestore')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            const payload = parsed.data && parsed.data.instruments ? parsed.data : parsed;
            if (!Array.isArray(payload.instruments) || !Array.isArray(payload.yield_curves)) {
                throw new Error('Unrecognized backup JSON format.');
            }
            store.replaceState(payload);
            await store.save();
            showToast(`Restored ${payload.instruments.length} instruments into ${store.mode} bank.`, 'success');
            await rerender();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    document.getElementById('btnWipeBank')?.addEventListener('click', async () => {
        if (!confirm(`Clear all data in the active "${store.mode}" browser bank?`)) return;
        await store.reset(true);
        showToast(`Cleared "${store.mode}" browser bank.`, 'info');
        await rerender();
    });
}
