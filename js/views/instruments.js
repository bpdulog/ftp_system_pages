import { Dec } from '../decimal.js';
import {
    generateCashFlowsForInstrument, lockInstrumentFtp, todayIso,
    getBucketForInstrument, calculateFtpRateWithBucket,
} from '../engine.js';
import {
    esc, fmtCurrency, fmtRatePct, fmtBpsFromDec, showToast,
    mountChart, ChartTheme, getLatestFtpRun, getRunResults,
} from '../ui.js';

export async function renderInstruments(host, ctx) {
    const { store, params, rerender, navigate, switchToDemo } = ctx;
    const state = store.state;
    const typeFilter = params.get('type') || '';
    const search = (params.get('q') || '').trim().toLowerCase();

    if (state.instruments.length === 0) {
        host.innerHTML = `
        <div class="card empty-state">
            <div class="empty-icon"><i class="fas fa-file-invoice-dollar"></i></div>
            <h2>No Instruments Booked Yet</h2>
            <p>Load the 13-instrument Sample Bank to explore a populated loan &amp; deposit portfolio, or import your own CSV/Excel book.</p>
            <div class="actions" style="justify-content:center;">
                <button class="btn demo-button" id="btnInstDemo" type="button"><i class="fas fa-university"></i> Load Sample Bank</button>
                <a class="btn btn-primary" href="#/import"><i class="fas fa-file-upload"></i> Import CSV / Excel</a>
                <a class="btn" href="#/instruments/new"><i class="fas fa-plus"></i> Add Instrument</a>
            </div>
        </div>`;
        document.getElementById('btnInstDemo')?.addEventListener('click', switchToDemo);
        return;
    }

    const latestRun = getLatestFtpRun(state);
    const latestResults = latestRun ? new Map(getRunResults(state, latestRun.id).map(r => [r.instrument_id, r])) : new Map();
    const bucketsById = new Map(state.buckets.map(b => [b.id, b]));

    const filtered = state.instruments.filter(i => {
        if (typeFilter && i.instrument_type !== typeFilter) return false;
        if (search && !i.name.toLowerCase().includes(search) && !(i.source_id || '').toLowerCase().includes(search)) return false;
        return true;
    });

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div><h2>Portfolio Instruments (${filtered.length})</h2><p>Loans and term deposits with contractual terms, bucket assignment, and latest FTP pricing.</p></div>
            <div class="actions">
                <a class="btn btn-primary" href="#/instruments/new"><i class="fas fa-plus"></i> Add Instrument</a>
                <a class="btn" href="#/import"><i class="fas fa-file-upload"></i> Import CSV / Excel</a>
            </div>
        </div>
        <form class="filters" id="instFilterForm">
            <label>Search<input type="search" id="instSearch" value="${esc(params.get('q') || '')}" placeholder="Name or source ID..."></label>
            <label>Type
                <select id="instTypeFilter">
                    <option value="">All types</option>
                    <option value="loan" ${typeFilter === 'loan' ? 'selected' : ''}>Loans</option>
                    <option value="deposit" ${typeFilter === 'deposit' ? 'selected' : ''}>Deposits</option>
                </select>
            </label>
            <button class="btn btn-primary" type="submit">Filter</button>
        </form>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Amortization</th>
                        <th class="num">Principal</th>
                        <th class="num">Contract Rate</th>
                        <th class="num">Term</th>
                        <th>Origination</th>
                        <th>Bucket</th>
                        <th class="num">FTP Rate</th>
                        <th class="num">Contribution</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.map(i => {
                        const r = latestResults.get(i.id);
                        const b = i.bucket_id ? bucketsById.get(i.bucket_id) : null;
                        return `
                        <tr>
                            <td><a href="#/instruments/${i.id}"><strong>${esc(i.name)}</strong></a>${i.source_id ? `<br><small class="muted">${esc(i.source_id)}</small>` : ''}</td>
                            <td><span class="badge badge-${esc(i.instrument_type)}">${esc(i.instrument_type)}</span></td>
                            <td>${esc(i.amortization_type)}</td>
                            <td class="num">${esc(fmtCurrency(i.principal, i.currency, 0))}</td>
                            <td class="num">${esc(fmtRatePct(i.contract_rate, 2))}</td>
                            <td class="num">${i.term_months} mo</td>
                            <td>${esc(i.origination_date)}</td>
                            <td>${esc(b ? b.name : 'Legacy Default')}</td>
                            <td class="num">${r ? esc(fmtRatePct(r.ftp_rate, 3)) : '<span class="muted">&mdash;</span>'}</td>
                            <td class="num ${r && Number(r.net_interest_margin) < 0 ? 'neg' : ''}">${r ? esc(fmtCurrency(r.net_interest_margin, i.currency, 2)) : '<span class="muted">&mdash;</span>'}</td>
                            <td>
                                <a class="btn btn-sm" href="#/instruments/${i.id}">View</a>
                                <button class="btn btn-sm btn-outline-danger btn-del-inst" data-id="${i.id}" type="button"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>`;
                    }).join('') || `<tr><td colspan="11" class="muted">No instruments match the current filter.</td></tr>`}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('instFilterForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = document.getElementById('instSearch').value.trim();
        const t = document.getElementById('instTypeFilter').value;
        const qp = new URLSearchParams();
        if (q) qp.set('q', q);
        if (t) qp.set('type', t);
        navigate(`/instruments${qp.toString() ? '?' + qp.toString() : ''}`);
    });

    host.querySelectorAll('.btn-del-inst').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.getAttribute('data-id'));
            if (!confirm('Delete this instrument and its cached cash flows/results?')) return;
            state.instruments = state.instruments.filter(x => x.id !== id);
            state.cash_flows = state.cash_flows.filter(x => x.instrument_id !== id);
            state.group_memberships = state.group_memberships.filter(x => x.instrument_id !== id);
            await store.save();
            showToast('Instrument deleted.', 'info');
            await rerender();
        });
    });
}

export async function renderInstrumentForm(host, ctx) {
    const { store, navigate } = ctx;
    const state = store.state;
    const activeBuckets = state.buckets.filter(b => b.active !== false);
    const dims = ['legal_entity', 'business_line', 'branch', 'product'];
    const groupsByDim = Object.fromEntries(dims.map(d => [d, state.reporting_groups.filter(g => g.dimension === d && g.active !== false)]));

    host.innerHTML = `
    <div class="card">
        <div class="heading"><div><h2>Add New Instrument</h2><p>Create a loan or term deposit, assign a pricing bucket and reporting groups, and lock against the effective curve.</p></div></div>
        <form id="newInstForm" style="margin-top:1rem;">
            <div class="form-grid">
                <div class="field">
                    <label for="fName">Instrument Name *</label>
                    <input type="text" id="fName" required maxlength="100" placeholder="e.g., Commercial Term Loan A">
                </div>
                <div class="field">
                    <label for="fType">Instrument Type *</label>
                    <select id="fType" required>
                        <option value="loan">Loan (Asset)</option>
                        <option value="deposit">Deposit (Liability)</option>
                    </select>
                </div>
                <div class="field">
                    <label for="fPrincipal">Principal Amount *</label>
                    <input type="number" id="fPrincipal" step="0.01" min="0.01" required placeholder="1000000">
                </div>
                <div class="field">
                    <label for="fRate">Contract Rate (%) *</label>
                    <input type="number" id="fRate" step="0.001" required placeholder="6.50">
                    <small>Entered as percent (e.g., 6.50 for 6.50%)</small>
                </div>
                <div class="field">
                    <label for="fTerm">Term (Months) *</label>
                    <input type="number" id="fTerm" min="1" step="1" required placeholder="60">
                </div>
                <div class="field">
                    <label for="fAmort">Amortization Type</label>
                    <select id="fAmort">
                        <option value="amortizing">Amortizing (Level Payment)</option>
                        <option value="bullet">Bullet (Principal at Maturity)</option>
                        <option value="interest_only">Interest Only</option>
                    </select>
                </div>
                <div class="field">
                    <label for="fCurrency">Currency (3-letter ISO)</label>
                    <input type="text" id="fCurrency" value="USD" maxlength="3" required>
                </div>
                <div class="field">
                    <label for="fOrig">Origination Date *</label>
                    <input type="date" id="fOrig" value="${esc(todayIso())}" required>
                    <small>Locks base rate to curve version effective on or before this date.</small>
                </div>
                <div class="field">
                    <label for="fCpr">CPR Prepayment (%)</label>
                    <input type="number" id="fCpr" step="0.01" min="0" max="100" value="0">
                </div>
                <div class="field">
                    <label for="fBucket">Pricing Bucket</label>
                    <select id="fBucket">
                        <option value="">Default (Legacy Loans / Deposits)</option>
                        ${activeBuckets.map(b => `<option value="${b.id}">${esc(b.name)} (${esc(b.methodology)})</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <label for="fSpreadOverride">FTP Spread Override (bps, optional)</label>
                    <input type="number" id="fSpreadOverride" step="0.1" min="-1000" max="1000" placeholder="Leave blank for bucket default">
                </div>
                <div class="field">
                    <label for="fSourceId">Source ID (optional)</label>
                    <input type="text" id="fSourceId" maxlength="128" placeholder="e.g., LOAN-1001">
                </div>
            </div>

            <div class="reporting-selection" style="margin:1rem 0;">
                <h3>Reporting Groups (optional)</h3>
                <div class="group-grid">
                    ${dims.map(d => `
                    <label>${esc(d.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}
                        <select class="group-dim-select" data-dim="${d}">
                            <option value="">Unassigned</option>
                            ${groupsByDim[d].map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
                        </select>
                    </label>`).join('')}
                </div>
            </div>

            <div class="form-actions">
                <button class="btn btn-primary" type="submit"><i class="fas fa-save"></i> Create Instrument</button>
                <a class="btn" href="#/instruments">Cancel</a>
            </div>
        </form>
    </div>`;

    document.getElementById('fType')?.addEventListener('change', (e) => {
        if (e.target.value === 'deposit') document.getElementById('fAmort').value = 'bullet';
    });

    document.getElementById('newInstForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const ccy = document.getElementById('fCurrency').value.trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(ccy)) throw new Error('Currency must be a 3-letter ISO code.');
            const rateDec = Dec.from(document.getElementById('fRate').value).div(100).round(6).toFixed(6);
            const prinDec = Dec.from(document.getElementById('fPrincipal').value).round(4).toFixed(4);
            const term = parseInt(document.getElementById('fTerm').value, 10);
            const ovRaw = document.getElementById('fSpreadOverride').value.trim();
            const ovDec = ovRaw !== '' ? Dec.from(ovRaw).div(10000).round(6).toFixed(6) : null;
            const bucketRaw = document.getElementById('fBucket').value;

            const inst = {
                id: store.nextId('instruments'),
                name: document.getElementById('fName').value.trim(),
                instrument_type: document.getElementById('fType').value,
                amortization_type: document.getElementById('fAmort').value,
                principal: prinDec,
                contract_rate: rateDec,
                term_months: term,
                currency: ccy,
                cpr_percent: Dec.from(document.getElementById('fCpr').value || '0').round(2).toFixed(2),
                origination_date: document.getElementById('fOrig').value || todayIso(),
                source_system: 'manual-ui',
                source_id: document.getElementById('fSourceId').value.trim() || null,
                import_batch_id: null,
                ftp_spread_override: ovDec,
                cpr_percent_override: null,
                locked_yield_curve_id: null,
                locked_base_rate: null,
                locked_ftp_spread: null,
                locked_ftp_rate: null,
                locked_at: null,
                bucket_id: bucketRaw ? Number(bucketRaw) : null,
                created_at: new Date().toISOString(),
            };

            if (state.yield_curves.some(c => c.name === 'SOFR')) {
                lockInstrumentFtp(state, inst, 'SOFR');
            }
            state.instruments.push(inst);

            const now = new Date().toISOString();
            document.querySelectorAll('.group-dim-select').forEach(sel => {
                if (sel.value) {
                    state.group_memberships.push({
                        id: store.nextId('group_memberships'),
                        instrument_id: inst.id,
                        group_id: Number(sel.value),
                        dimension: sel.getAttribute('data-dim'),
                        assigned_at: now,
                    });
                }
            });

            await store.save();
            showToast(`Created instrument "${inst.name}".`, 'success');
            navigate(`/instruments/${inst.id}`);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

export async function renderInstrumentDetail(host, ctx, id) {
    const { store, rerender, navigate } = ctx;
    const state = store.state;
    const inst = state.instruments.find(i => i.id === id);
    if (!inst) {
        host.innerHTML = `<div class="card empty-state"><h2>Instrument not found</h2><a class="btn btn-primary" href="#/instruments">Back to Instruments</a></div>`;
        return;
    }

    const bucket = getBucketForInstrument(state, inst);
    const lockedCurve = inst.locked_yield_curve_id ? state.yield_curves.find(c => c.id === inst.locked_yield_curve_id) : null;
    const cfs = state.cash_flows.filter(c => c.instrument_id === inst.id);
    const latestRes = state.ftp_results.filter(r => r.instrument_id === inst.id).sort((a, b) => b.id - a.id)[0] || null;
    const memberships = state.group_memberships.filter(m => m.instrument_id === inst.id);
    const dims = ['legal_entity', 'business_line', 'branch', 'product'];

    let previewFtpRate = latestRes ? latestRes.ftp_rate : inst.locked_ftp_rate;
    if (!previewFtpRate && inst.locked_base_rate) {
        const [, r] = calculateFtpRateWithBucket(inst.locked_base_rate, bucket, inst.instrument_type, inst.ftp_spread_override);
        previewFtpRate = r.toFixed(6);
    }

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div>
                <h2>${esc(inst.name)} <span class="badge badge-${esc(inst.instrument_type)}">${esc(inst.instrument_type)}</span></h2>
                <p>Originated ${esc(inst.origination_date)} &middot; ${inst.term_months} months (${inst.term_months * 30} days) &middot; ${esc(inst.amortization_type)}</p>
            </div>
            <div class="actions">
                <button class="btn btn-primary" id="btnGenCf" type="button"><i class="fas fa-calendar-alt"></i> Generate Cash Flows</button>
                <button class="btn btn-outline-danger" id="btnDelDetail" type="button"><i class="fas fa-trash"></i> Delete</button>
                <a class="btn" href="#/instruments">Back</a>
            </div>
        </div>
        <div class="metrics-grid" style="margin-top:1rem;">
            <div class="metric-card"><div class="metric-label">Principal</div><div class="metric-value">${esc(fmtCurrency(inst.principal, inst.currency, 2))}</div></div>
            <div class="metric-card"><div class="metric-label">Contract Rate</div><div class="metric-value">${esc(fmtRatePct(inst.contract_rate, 3))}</div></div>
            <div class="metric-card"><div class="metric-label">Locked Base Rate</div><div class="metric-value">${inst.locked_base_rate ? esc(fmtRatePct(inst.locked_base_rate, 3)) : '&mdash;'}</div></div>
            <div class="metric-card"><div class="metric-label">Effective FTP Rate</div><div class="metric-value">${previewFtpRate ? esc(fmtRatePct(previewFtpRate, 3)) : '&mdash;'}</div></div>
        </div>
        <p class="small-note">
            <strong>Rate-lock provenance:</strong>
            ${lockedCurve ? `Locked to curve <strong>${esc(lockedCurve.name)}</strong> (effective ${esc(lockedCurve.effective_date)})` : 'Not locked yet (run FTP calculation or generate cash flows).'}
            &middot; <strong>Bucket:</strong> ${esc(bucket.name)} (${esc(bucket.methodology)})
        </p>
    </div>

    <div class="grid-2" style="margin-bottom:1.5rem;">
        <div class="card">
            <h2>Overrides &amp; Bucket Assignment</h2>
            <form id="instEditForm">
                <div class="form-grid">
                    <div class="field">
                        <label>Pricing Bucket</label>
                        <select id="editBucket">
                            <option value="">Default (Legacy)</option>
                            ${state.buckets.filter(b => b.active !== false || b.id === inst.bucket_id).map(b => `<option value="${b.id}" ${b.id === inst.bucket_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field">
                        <label>FTP Spread Override (bps)</label>
                        <input type="number" step="0.1" id="editSpreadOv" value="${inst.ftp_spread_override != null ? (Number(inst.ftp_spread_override) * 10000).toFixed(1) : ''}" placeholder="Blank = bucket default">
                    </div>
                    <div class="field">
                        <label>CPR Override (%)</label>
                        <input type="number" step="0.1" min="0" max="100" id="editCprOv" value="${inst.cpr_percent_override != null ? inst.cpr_percent_override : ''}" placeholder="Blank = ${esc(inst.cpr_percent || 0)}%">
                    </div>
                </div>
                <button class="btn btn-primary" type="submit">Save Overrides</button>
            </form>
        </div>
        <div class="card">
            <h2>Reporting Groups</h2>
            <form id="instGroupForm">
                <div class="group-grid" style="margin-bottom:1rem;">
                    ${dims.map(d => {
                        const cur = memberships.find(m => m.dimension === d);
                        const opts = state.reporting_groups.filter(g => g.dimension === d && g.active !== false);
                        return `<label>${esc(d.replace(/_/g, ' '))}
                            <select class="edit-group-dim" data-dim="${d}">
                                <option value="">Unassigned</option>
                                ${opts.map(g => `<option value="${g.id}" ${cur && cur.group_id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
                            </select>
                        </label>`;
                    }).join('')}
                </div>
                <button class="btn btn-primary" type="submit">Update Groups</button>
            </form>
        </div>
    </div>

    <div class="card">
        <h2>Monthly Cash Flow Schedule (${cfs.length} periods)</h2>
        ${cfs.length ? `
        <div class="chart-box"><canvas id="instCfChart"></canvas></div>
        <div class="table-wrap">
            <table class="compact">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th class="num">Rem. Term</th>
                        <th class="num">Beg. Balance</th>
                        <th class="num">Payment</th>
                        <th class="num">Interest</th>
                        <th class="num">Principal</th>
                        <th class="num">Prepayment</th>
                        <th class="num">Ending Balance</th>
                        <th class="num">FTP Rate</th>
                        <th class="num">FTP Charge/Credit</th>
                    </tr>
                </thead>
                <tbody>
                    ${cfs.map(cf => `
                    <tr>
                        <td>${esc(cf.payment_date)}</td>
                        <td class="num">${cf.remaining_term_months} mo</td>
                        <td class="num">${esc(fmtCurrency(cf.beginning_balance, inst.currency, 2))}</td>
                        <td class="num">${esc(fmtCurrency(cf.payment_amount, inst.currency, 2))}</td>
                        <td class="num">${esc(fmtCurrency(cf.interest_payment, inst.currency, 2))}</td>
                        <td class="num">${esc(fmtCurrency(cf.principal_payment, inst.currency, 2))}</td>
                        <td class="num">${esc(fmtCurrency(cf.prepayment, inst.currency, 2))}</td>
                        <td class="num">${esc(fmtCurrency(cf.ending_balance, inst.currency, 2))}</td>
                        <td class="num">${esc(fmtRatePct(cf.ftp_rate, 3))}</td>
                        <td class="num">${esc(fmtCurrency(cf.ftp_cost_revenue, inst.currency, 2))}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>` : `<p class="muted">No cash flows generated yet. Click <strong>Generate Cash Flows</strong> above.</p>`}
    </div>`;

    document.getElementById('btnGenCf')?.addEventListener('click', async () => {
        try {
            const curveName = state.yield_curves.some(c => c.name === 'SOFR') ? 'SOFR' : (state.yield_curves[0]?.name || 'SOFR');
            await generateCashFlowsForInstrument(store, inst.id, curveName, todayIso(), 'browser-user');
            showToast('Cash flow schedule generated.', 'success');
            await rerender();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    document.getElementById('btnDelDetail')?.addEventListener('click', async () => {
        if (!confirm('Delete this instrument?')) return;
        state.instruments = state.instruments.filter(x => x.id !== inst.id);
        state.cash_flows = state.cash_flows.filter(x => x.instrument_id !== inst.id);
        state.group_memberships = state.group_memberships.filter(x => x.instrument_id !== inst.id);
        await store.save();
        showToast('Instrument deleted.', 'info');
        navigate('/instruments');
    });

    document.getElementById('instEditForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const bVal = document.getElementById('editBucket').value;
            inst.bucket_id = bVal ? Number(bVal) : null;
            const spVal = document.getElementById('editSpreadOv').value.trim();
            inst.ftp_spread_override = spVal !== '' ? Dec.from(spVal).div(10000).round(6).toFixed(6) : null;
            const cprVal = document.getElementById('editCprOv').value.trim();
            inst.cpr_percent_override = cprVal !== '' ? Dec.from(cprVal).round(2).toFixed(2) : null;
            await store.save();
            showToast('Overrides saved. Re-run FTP calculation to refresh run snapshots.', 'success');
            await rerender();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    document.getElementById('instGroupForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        state.group_memberships = state.group_memberships.filter(m => m.instrument_id !== inst.id);
        const now = new Date().toISOString();
        document.querySelectorAll('.edit-group-dim').forEach(sel => {
            if (sel.value) {
                state.group_memberships.push({
                    id: store.nextId('group_memberships'),
                    instrument_id: inst.id,
                    group_id: Number(sel.value),
                    dimension: sel.getAttribute('data-dim'),
                    assigned_at: now,
                });
            }
        });
        await store.save();
        showToast('Reporting group assignments updated.', 'success');
        await rerender();
    });

    if (cfs.length) {
        const P = ChartTheme.palette;
        mountChart('instCfChart', {
            type: 'bar',
            data: {
                labels: cfs.map(c => c.payment_date),
                datasets: [
                    { label: 'Interest', data: cfs.map(c => Number(c.interest_payment)), backgroundColor: P.blue },
                    { label: 'Scheduled Principal', data: cfs.map(c => Number(c.principal_payment)), backgroundColor: P.teal },
                    { label: 'Prepayment', data: cfs.map(c => Number(c.prepayment)), backgroundColor: P.amber },
                    { label: 'Ending Balance', type: 'line', data: cfs.map(c => Number(c.ending_balance)), borderColor: P.navy, yAxisID: 'y1', tension: 0.2 },
                ],
            },
            options: ChartTheme.baseOptions({
                scales: {
                    y: ChartTheme.moneyTicks(inst.currency),
                    y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => `${inst.currency} ${ChartTheme.compact(v)}` } },
                },
            }),
        });
    }
}
