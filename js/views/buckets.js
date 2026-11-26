import { Dec } from '../decimal.js';
import { esc, showToast, openModal, closeModal } from '../ui.js';

export async function renderBuckets(host, ctx) {
    const { store, rerender } = ctx;
    const state = store.state;
    const curves = state.yield_curves;
    const counts = new Map();
    for (const i of state.instruments) {
        if (i.bucket_id != null) counts.set(i.bucket_id, (counts.get(i.bucket_id) || 0) + 1);
    }

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div><h2>Pricing Buckets (${state.buckets.length})</h2><p>Assign matched-maturity or pooled FTP rules to instrument segments.</p></div>
            <button class="btn btn-primary" id="btnNewBucket" type="button"><i class="fas fa-plus"></i> Create Bucket</button>
        </div>
        <div class="table-wrap" style="margin-top:1rem;">
            <table>
                <thead><tr><th>Name</th><th>Methodology</th><th>Parameters</th><th>Curve</th><th class="num">Instruments</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    ${state.buckets.map(b => {
                        const curve = b.yield_curve_id ? curves.find(c => c.id === b.yield_curve_id) : null;
                        const paramsText = b.methodology === 'pooled'
                            ? `Pool rate: ${(Number(b.parameters?.pool_rate || 0) * 100).toFixed(3)}%`
                            : `Spread: ${b.parameters?.spread_bps ?? 0} bps`;
                        const isLegacy = b.name === 'Legacy Loans' || b.name === 'Legacy Deposits';
                        return `<tr>
                            <td><strong>${esc(b.name)}</strong>${b.description ? `<br><small class="muted">${esc(b.description)}</small>` : ''}</td>
                            <td>${esc(b.methodology)}</td>
                            <td>${esc(paramsText)}</td>
                            <td>${curve ? `${esc(curve.name)} (${esc(curve.effective_date)})` : 'Run default'}</td>
                            <td class="num">${counts.get(b.id) || 0}</td>
                            <td><span class="status-pill ${b.active !== false ? 'status-imported' : ''}">${b.active !== false ? 'Active' : 'Archived'}</span></td>
                            <td>
                                <button class="btn btn-sm btn-assign-bucket" data-id="${b.id}" type="button">Assign</button>
                                ${!isLegacy ? `<button class="btn btn-sm btn-toggle-bucket" data-id="${b.id}" type="button">${b.active !== false ? 'Archive' : 'Unarchive'}</button>` : ''}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('btnNewBucket')?.addEventListener('click', () => {
        openModal({
            title: 'Create Pricing Bucket',
            bodyHtml: `
                <div class="form-grid">
                    <div class="field"><label>Bucket Name *</label><input type="text" id="bName" required></div>
                    <div class="field"><label>Methodology *</label>
                        <select id="bMethod">
                            <option value="matched_maturity">Matched Maturity</option>
                            <option value="pooled">Pooled Rate</option>
                        </select>
                    </div>
                    <div class="field" id="bSpreadWrap"><label>Spread (bps)</label><input type="number" step="0.5" id="bSpread" value="20"></div>
                    <div class="field" id="bPoolWrap" hidden><label>Fixed Pool Rate (%)</label><input type="number" step="0.001" id="bPoolRate" value="4.50"></div>
                    <div class="field"><label>Yield Curve (optional)</label>
                        <select id="bCurve">
                            <option value="">Use run default curve</option>
                            ${curves.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.effective_date)})</option>`).join('')}
                        </select>
                    </div>
                    <div class="field field-wide"><label>Description</label><input type="text" id="bDesc"></div>
                </div>`,
            footerHtml: `<button class="btn" id="mCancel" type="button">Cancel</button><button class="btn btn-primary" id="mCreate" type="button">Create Bucket</button>`,
            onMount: () => {
                const meth = document.getElementById('bMethod');
                meth.addEventListener('change', () => {
                    const isPool = meth.value === 'pooled';
                    document.getElementById('bSpreadWrap').hidden = isPool;
                    document.getElementById('bPoolWrap').hidden = !isPool;
                });
                document.getElementById('mCancel').addEventListener('click', closeModal);
                document.getElementById('mCreate').addEventListener('click', async () => {
                    try {
                        const name = document.getElementById('bName').value.trim();
                        if (!name) throw new Error('Bucket name is required.');
                        if (state.buckets.some(b => b.name.toLowerCase() === name.toLowerCase())) {
                            throw new Error(`Bucket '${name}' already exists.`);
                        }
                        const method = meth.value;
                        const params = method === 'pooled'
                            ? { pool_rate: Dec.from(document.getElementById('bPoolRate').value).div(100).round(6).toFixed(6) }
                            : { spread_bps: Number(document.getElementById('bSpread').value || 0) };
                        const cVal = document.getElementById('bCurve').value;
                        const now = new Date().toISOString();
                        state.buckets.push({
                            id: store.nextId('buckets'),
                            name,
                            description: document.getElementById('bDesc').value.trim(),
                            methodology: method,
                            parameters: params,
                            yield_curve_id: method === 'pooled' || !cVal ? null : Number(cVal),
                            active: true,
                            created_at: now,
                            updated_at: now,
                        });
                        await store.save();
                        closeModal();
                        showToast(`Bucket "${name}" created.`, 'success');
                        await rerender();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
            },
        });
    });

    host.querySelectorAll('.btn-toggle-bucket').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.getAttribute('data-id'));
            const b = state.buckets.find(x => x.id === id);
            if (!b) return;
            b.active = b.active === false;
            b.updated_at = new Date().toISOString();
            await store.save();
            showToast(`Bucket "${b.name}" ${b.active ? 'activated' : 'archived'}.`, 'info');
            await rerender();
        });
    });

    host.querySelectorAll('.btn-assign-bucket').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.getAttribute('data-id'));
            const b = state.buckets.find(x => x.id === id);
            if (!b) return;
            openModal({
                title: `Assign Instruments to "${b.name}"`,
                bodyHtml: `
                    <p class="small-note" style="margin-bottom:.75rem;">Select instruments to assign to this pricing bucket:</p>
                    <div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:.5rem;">
                        ${state.instruments.map(i => `
                        <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem;">
                            <input type="checkbox" class="assign-chk" value="${i.id}" ${i.bucket_id === b.id ? 'checked' : ''}>
                            <span><strong>${esc(i.name)}</strong> (${esc(i.instrument_type)}, ${esc(i.currency)} ${Number(i.principal).toLocaleString('en-US')})</span>
                        </label>`).join('') || '<p class="muted">No instruments in bank.</p>'}
                    </div>`,
                footerHtml: `<button class="btn" id="mCancel" type="button">Cancel</button><button class="btn btn-primary" id="mAssign" type="button">Save Assignments</button>`,
                onMount: () => {
                    document.getElementById('mCancel').addEventListener('click', closeModal);
                    document.getElementById('mAssign').addEventListener('click', async () => {
                        document.querySelectorAll('.assign-chk').forEach(chk => {
                            const inst = state.instruments.find(x => x.id === Number(chk.value));
                            if (!inst) return;
                            if (chk.checked) inst.bucket_id = b.id;
                            else if (inst.bucket_id === b.id) inst.bucket_id = null;
                        });
                        await store.save();
                        closeModal();
                        showToast(`Updated assignments for "${b.name}".`, 'success');
                        await rerender();
                    });
                },
            });
        });
    });
}
