import { exportRunCsv } from '../exports.js';
import { runCurrencies } from '../alco.js';
import { esc, openModal, closeModal, getRunResults } from '../ui.js';

export async function renderRuns(host, ctx) {
    const { store } = ctx;
    const state = store.state;
    const runs = [...state.calculation_runs].sort((a, b) => b.id - a.id);

    host.innerHTML = `
    <div class="card">
        <div class="heading"><div><h2>Calculation Runs (${runs.length})</h2><p>Immutable provenance log of FTP and cash-flow runs with frozen input snapshots.</p></div></div>
        <div class="table-wrap" style="margin-top:1rem;">
            <table>
                <thead><tr><th>Run</th><th>Type</th><th>As-of Date</th><th>Methodology</th><th>Actor</th><th>Status</th><th>Completed</th><th>Actions</th></tr></thead>
                <tbody>
                    ${runs.map(r => {
                        const ccys = runCurrencies(r);
                        const resCount = state.ftp_results.filter(x => x.calculation_run_id === r.id).length;
                        return `<tr>
                            <td><strong>#${r.id}</strong></td>
                            <td>${esc(r.run_type)}</td>
                            <td>${esc(r.as_of_date)}</td>
                            <td><code>${esc(r.methodology_version)}</code></td>
                            <td>${esc(r.actor)}</td>
                            <td><span class="run-status run-${esc(r.status)}">${esc(r.status)}</span></td>
                            <td>${esc((r.completed_at || r.created_at).slice(0, 19).replace('T', ' '))}</td>
                            <td style="display:flex;gap:.35rem;flex-wrap:wrap;">
                                <button class="btn btn-sm btn-view-snap" data-id="${r.id}" type="button">Snapshot</button>
                                ${r.run_type === 'ftp' && r.status === 'completed' && resCount ? ccys.map(c => `<button class="btn btn-sm btn-dl-run" data-id="${r.id}" data-ccy="${esc(c)}" type="button"><i class="fas fa-download"></i> ${esc(c)} CSV</button>`).join('') : ''}
                            </td>
                        </tr>`;
                    }).join('') || '<tr><td colspan="8" class="muted">No calculation runs recorded yet.</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;

    host.querySelectorAll('.btn-dl-run').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.getAttribute('data-id'));
            const ccy = btn.getAttribute('data-ccy');
            const run = state.calculation_runs.find(r => r.id === id);
            if (!run) return;
            exportRunCsv(run, getRunResults(state, id), ccy);
        });
    });

    host.querySelectorAll('.btn-view-snap').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.getAttribute('data-id'));
            const run = state.calculation_runs.find(r => r.id === id);
            if (!run) return;
            const snap = run.input_snapshot || {};
            openModal({
                title: `Run #${run.id} Input Snapshot`,
                bodyHtml: `
                    <p class="small-note" style="margin-bottom:.75rem;">Curve family: <strong>${esc(snap.yield_curve_name || 'N/A')}</strong> &middot; Instruments: <strong>${(snap.instruments || []).length}</strong> &middot; Buckets: <strong>${(snap.buckets || []).length}</strong> &middot; Curves: <strong>${(snap.yield_curves || []).length}</strong></p>
                    ${run.error_message ? `<div class="notice notice-error">${esc(run.error_message)}</div>` : ''}
                    <pre style="max-height:360px;overflow:auto;background:#f8fafc;border:1px solid #e2e8f0;padding:.75rem;border-radius:8px;font-size:.78rem;">${esc(JSON.stringify(snap, null, 2))}</pre>`,
                footerHtml: `<button class="btn btn-primary" id="mSnapClose" type="button">Close</button>`,
                onMount: () => document.getElementById('mSnapClose')?.addEventListener('click', closeModal),
            });
        });
    });
}
