import { Dec } from '../decimal.js';
import { ensureTreasuryCurve, deriveSyntheticSofrCurve, publishTreasuryFromCsvText, todayIso } from '../engine.js';
import { esc, fmtRatePct, showToast, openModal, closeModal, mountChart, ChartTheme } from '../ui.js';

const TENOR_NAMES = {
    1: 'Overnight (1D)', 30: '1 Month (1M)', 90: '3 Months (3M)', 180: '6 Months (6M)',
    365: '1 Year (1Y)', 730: '2 Years (2Y)', 1095: '3 Years (3Y)', 1825: '5 Years (5Y)',
    2555: '7 Years (7Y)', 3650: '10 Years (10Y)', 7300: '20 Years (20Y)', 10950: '30 Years (30Y)',
};

export async function renderCurve(host, ctx) {
    const { store, rerender } = ctx;
    const state = store.state;

    // Bootstrap baseline curves on first visit if empty
    if (!state.yield_curves.some(c => c.name === 'TREASURY')) {
        ensureTreasuryCurve(store, todayIso());
        if (!state.yield_curves.some(c => c.name === 'SOFR')) {
            await deriveSyntheticSofrCurve(store, { basisAdjustmentBps: '10.0', effectiveDate: todayIso(), curveName: 'SOFR' });
        } else {
            await store.save();
        }
    }

    const sofrVersions = state.yield_curves.filter(c => c.name === 'SOFR').sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    const treasuryVersions = state.yield_curves.filter(c => c.name === 'TREASURY').sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    const activeSofr = sofrVersions[0] || null;
    const activeTreasury = treasuryVersions[0] || null;

    const basisBps = activeSofr ? Number(activeSofr.basis_adjustment_bps || 10) : 10;
    const sofrPts = [...(activeSofr?.points || [])].sort((a, b) => a.tenor_days - b.tenor_days);
    const treasuryMap = new Map((activeTreasury?.points || []).map(p => [Number(p.tenor_days), p.rate]));
    const t10 = treasuryMap.get(3650);
    const s10 = sofrPts.find(p => Number(p.tenor_days) === 3650)?.rate;

    const allVersions = [...state.yield_curves].sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.id - a.id);

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div>
                <h2>SOFR Yield Curve (Treasury Proxy)</h2>
                <p>Immutable curve snapshots identified by <code>(name, effective_date)</code>. Instruments lock to the curve version effective on their origination date.</p>
            </div>
            <div class="actions">
                <button class="btn btn-outline-primary" id="btnImportTreasuryCsv" type="button"><i class="fas fa-file-csv"></i> Import Treasury CSV</button>
                <button class="btn btn-primary" id="btnDeriveSofr" type="button"><i class="fas fa-sliders-h"></i> Derive New SOFR Version</button>
                <button class="btn" id="btnCustomCurve" type="button"><i class="fas fa-plus"></i> Publish Custom Curve</button>
            </div>
        </div>
        <div class="metrics-grid" style="margin-top:1rem;margin-bottom:0;">
            <div class="metric-card"><div class="metric-label">Base Treasury CMT (10Y)</div><div class="metric-value">${t10 ? esc(fmtRatePct(t10, 2)) : '&mdash;'}</div></div>
            <div class="metric-card warning"><div class="metric-label">Fixed Basis Adjustment</div><div class="metric-value">+${basisBps.toFixed(1)} bps</div></div>
            <div class="metric-card positive"><div class="metric-label">Synthetic SOFR (10Y)</div><div class="metric-value">${s10 ? esc(fmtRatePct(s10, 2)) : '&mdash;'}</div></div>
            <div class="metric-card"><div class="metric-label">Active SOFR Date</div><div class="metric-value" style="font-size:1.25rem;">${activeSofr ? esc(activeSofr.effective_date) : 'None'}</div></div>
        </div>
    </div>

    <div class="card">
        <h2>Term Structure: U.S. Treasury vs. Synthetic SOFR</h2>
        <div class="chart-container"><canvas id="dualCurveChart"></canvas></div>
    </div>

    <div class="card">
        <h2>Benchmark Tenors &amp; Spread Mapping</h2>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Tenor</th>
                        <th>Days</th>
                        <th class="num">U.S. Treasury Yield</th>
                        <th class="num">Basis Adjustment</th>
                        <th class="num">Synthetic SOFR Rate</th>
                        <th class="num">Loan FTP (+20 bps)</th>
                        <th class="num">Deposit FTP (-5 bps)</th>
                    </tr>
                </thead>
                <tbody>
                    ${sofrPts.map(pt => {
                        const tr = treasuryMap.get(Number(pt.tenor_days));
                        const r = Number(pt.rate);
                        return `<tr>
                            <td><strong>${esc(TENOR_NAMES[pt.tenor_days] || `${pt.tenor_days} Days`)}</strong></td>
                            <td>${pt.tenor_days}</td>
                            <td class="num">${tr != null ? esc(fmtRatePct(tr, 3)) : '&mdash;'}</td>
                            <td class="num">+${basisBps.toFixed(1)} bps</td>
                            <td class="num"><strong>${esc(fmtRatePct(r, 3))}</strong></td>
                            <td class="num rate-positive">${esc(fmtRatePct(r + 0.0020, 3))}</td>
                            <td class="num">${esc(fmtRatePct(r - 0.0005, 3))}</td>
                        </tr>`;
                    }).join('') || '<tr><td colspan="7" class="muted">No active SOFR curve points.</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>

    <div class="card">
        <h2>Curve Version History (${allVersions.length})</h2>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>Name</th><th>Effective Date</th><th>Basis</th><th>Description</th><th>Points</th><th>Actions</th></tr></thead>
                <tbody>
                    ${allVersions.map(v => {
                        const inUse = state.instruments.some(i => i.locked_yield_curve_id === v.id)
                            || state.buckets.some(b => b.yield_curve_id === v.id)
                            || state.yield_curves.some(c => c.derived_from_curve_id === v.id);
                        return `<tr>
                            <td><strong>${esc(v.name)}</strong></td>
                            <td>${esc(v.effective_date)}</td>
                            <td>${v.basis_adjustment_bps ? `${Number(v.basis_adjustment_bps).toFixed(1)} bps` : '&mdash;'}</td>
                            <td>${esc(v.description || '')}</td>
                            <td>${(v.points || []).length}</td>
                            <td>${inUse ? '<span class="badge badge-neutral">Referenced</span>' : `<button class="btn btn-sm btn-outline-danger btn-del-curve" data-id="${v.id}" type="button">Delete</button>`}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('btnImportTreasuryCsv')?.addEventListener('click', () => {
        openModal({
            title: 'Import U.S. Treasury Daily Par Yield Curve CSV',
            bodyHtml: `
                <div class="notice notice-info">
                    <strong>Browser CORS note:</strong> Because <code>home.treasury.gov</code> does not send cross-origin (CORS) headers to static sites, download the CSV from
                    <a href="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve" target="_blank" rel="noopener">home.treasury.gov</a>
                    and upload or paste it below.
                </div>
                <div class="field" style="margin-bottom:1rem;">
                    <label>Upload Treasury CSV file</label>
                    <input type="file" id="tCsvFile" accept=".csv,.txt">
                </div>
                <div class="field">
                    <label>Or paste CSV text</label>
                    <textarea id="tCsvText" rows="6" placeholder="Date,1 Mo,2 Mo,3 Mo,6 Mo,1 Yr,2 Yr,5 Yr,10 Yr,20 Yr,30 Yr&#10;01/31/2026,4.35,4.32,4.30,4.20,4.15,4.10,4.18,4.45,4.72,4.68"></textarea>
                </div>`,
            footerHtml: `<button class="btn" id="mCancel" type="button">Cancel</button><button class="btn btn-primary" id="mSubmit" type="button">Publish Treasury Curve</button>`,
            onMount: () => {
                document.getElementById('tCsvFile').addEventListener('change', async (e) => {
                    const f = e.target.files[0];
                    if (f) document.getElementById('tCsvText').value = await f.text();
                });
                document.getElementById('mCancel').addEventListener('click', closeModal);
                document.getElementById('mSubmit').addEventListener('click', async () => {
                    try {
                        const text = document.getElementById('tCsvText').value;
                        const c = await publishTreasuryFromCsvText(store, text);
                        closeModal();
                        showToast(`Published TREASURY curve for ${c.effective_date}.`, 'success');
                        await rerender();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
            },
        });
    });

    document.getElementById('btnDeriveSofr')?.addEventListener('click', () => {
        openModal({
            title: 'Derive Synthetic SOFR Curve Version',
            bodyHtml: `
                <div class="form-grid">
                    <div class="field">
                        <label>Base Treasury Curve</label>
                        <select id="dTreasId">${treasuryVersions.map(t => `<option value="${t.id}">TREASURY (${esc(t.effective_date)})</option>`).join('')}</select>
                    </div>
                    <div class="field">
                        <label>Target Curve Name</label>
                        <input type="text" id="dCurveName" value="SOFR">
                    </div>
                    <div class="field">
                        <label>Effective Date</label>
                        <input type="date" id="dEffDate" value="${esc(todayIso())}">
                    </div>
                    <div class="field">
                        <label>Basis Adjustment (bps)</label>
                        <input type="number" step="0.5" id="dBasisBps" value="10.0">
                    </div>
                </div>`,
            footerHtml: `<button class="btn" id="mCancel" type="button">Cancel</button><button class="btn btn-primary" id="mDerive" type="button">Publish SOFR Version</button>`,
            onMount: () => {
                document.getElementById('mCancel').addEventListener('click', closeModal);
                document.getElementById('mDerive').addEventListener('click', async () => {
                    try {
                        const c = await deriveSyntheticSofrCurve(store, {
                            treasuryCurveId: Number(document.getElementById('dTreasId').value),
                            basisAdjustmentBps: document.getElementById('dBasisBps').value,
                            effectiveDate: document.getElementById('dEffDate').value,
                            curveName: document.getElementById('dCurveName').value.trim() || 'SOFR',
                        });
                        closeModal();
                        showToast(`Published ${c.name} (${c.effective_date}).`, 'success');
                        await rerender();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
            },
        });
    });

    document.getElementById('btnCustomCurve')?.addEventListener('click', () => {
        openModal({
            title: 'Publish Custom Yield Curve',
            bodyHtml: `
                <div class="form-grid">
                    <div class="field"><label>Curve Name</label><input type="text" id="cName" value="SOFR"></div>
                    <div class="field"><label>Effective Date</label><input type="date" id="cEff" value="${esc(todayIso())}"></div>
                    <div class="field field-wide">
                        <label>Tenor Points (tenor_days, rate_decimal per line)</label>
                        <textarea id="cPts" rows="6">30, 0.0450
90, 0.0435
365, 0.0410
1095, 0.0390
1825, 0.0385
3650, 0.0400</textarea>
                    </div>
                </div>`,
            footerHtml: `<button class="btn" id="mCancel" type="button">Cancel</button><button class="btn btn-primary" id="mPub" type="button">Publish Curve</button>`,
            onMount: () => {
                document.getElementById('mCancel').addEventListener('click', closeModal);
                document.getElementById('mPub').addEventListener('click', async () => {
                    try {
                        const name = document.getElementById('cName').value.trim();
                        const eff = document.getElementById('cEff').value;
                        if (!name || !eff) throw new Error('Curve name and effective date are required.');
                        if (state.yield_curves.some(c => c.name === name && c.effective_date === eff)) {
                            throw new Error(`Curve '${name}' already exists for ${eff}.`);
                        }
                        const pts = document.getElementById('cPts').value.split(/\r?\n/).filter(l => l.trim()).map(line => {
                            const [tStr, rStr] = line.split(',').map(s => s.trim());
                            const tenor = parseInt(tStr, 10);
                            const rate = Dec.from(rStr).round(6).toFixed(6);
                            if (!Number.isInteger(tenor) || tenor < 0) throw new Error(`Invalid tenor: ${tStr}`);
                            return { tenor_days: tenor, rate };
                        });
                        if (pts.length < 1) throw new Error('Provide at least one tenor point.');
                        state.yield_curves.push({
                            id: store.nextId('yield_curves'),
                            name, effective_date: eff,
                            description: `Custom published curve ${name} (${eff})`,
                            source: 'Manual entry', version: `manual-${eff}`,
                            basis_adjustment_bps: null, derived_from_curve_id: null,
                            created_at: new Date().toISOString(),
                            points: pts,
                        });
                        await store.save();
                        closeModal();
                        showToast(`Published ${name} (${eff}).`, 'success');
                        await rerender();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
            },
        });
    });

    host.querySelectorAll('.btn-del-curve').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.getAttribute('data-id'));
            state.yield_curves = state.yield_curves.filter(c => c.id !== id);
            await store.save();
            showToast('Curve deleted.', 'info');
            await rerender();
        });
    });

    if (sofrPts.length) {
        const P = ChartTheme.palette;
        const labels = sofrPts.map(p => TENOR_NAMES[p.tenor_days] || `${p.tenor_days}d`);
        mountChart('dualCurveChart', {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Synthetic SOFR (%)', data: sofrPts.map(p => Number(p.rate) * 100), borderColor: P.blue, backgroundColor: 'rgba(37, 87, 214, 0.12)', fill: true, tension: 0.32 },
                    { label: 'U.S. Treasury CMT (%)', data: sofrPts.map(p => treasuryMap.has(Number(p.tenor_days)) ? Number(treasuryMap.get(Number(p.tenor_days))) * 100 : null), borderColor: P.slate, borderDash: [5, 5], tension: 0.32 },
                ],
            },
            options: ChartTheme.baseOptions({ scales: { y: ChartTheme.pctTicks() } }),
        });
    }
}
