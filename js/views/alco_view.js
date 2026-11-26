import { buildAlcoPack, chartPayload, runCurrencies, money, pct, bps } from '../alco.js';
import { exportAlcoAnalyticsCsv, exportAlcoWorkbook, exportAlcoDeck, openPrintableReport } from '../exports.js';
import { esc, showToast, mountChart, ChartTheme, getRunResults } from '../ui.js';

export async function renderAlco(host, ctx) {
    const { store, params, navigate } = ctx;
    const state = store.state;
    const runs = state.calculation_runs.filter(r => r.run_type === 'ftp' && r.status === 'completed').sort((a, b) => b.id - a.id);

    if (!runs.length) {
        host.innerHTML = `<div class="card"><div class="heading"><div><h2>ALCO Reports</h2><p>No completed FTP runs yet. Run a calculation from the dashboard first.</p></div></div><div style="margin-top:1rem;"><a class="btn btn-primary" href="#/dashboard">Go to Dashboard</a></div></div>`;
        return;
    }

    const selectedRun = runs.find(r => r.id === Number(params.get('run_id'))) || runs[0];
    const currencies = runCurrencies(selectedRun);
    const selectedCcy = (params.get('currency') || currencies[0] || 'USD').toUpperCase();
    const compareId = params.get('compare_run_id') ? Number(params.get('compare_run_id')) : (runs[1]?.id || null);
    const compareRun = compareId && compareId !== selectedRun.id ? runs.find(r => r.id === compareId) : null;

    const pack = buildAlcoPack(selectedRun, getRunResults(state, selectedRun.id), selectedCcy, compareRun, compareRun ? getRunResults(state, compareRun.id) : []);
    const charts = chartPayload(pack);
    const ccy = pack.meta.currency;

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div><h2>ALCO Reporting Pack (Draft)</h2><p>Complete Asset/Liability Committee reporting pack generated client-side with Excel (.xlsx) and PowerPoint (.pptx) exports.</p></div>
            <div class="actions">
                <button class="btn" id="btnAlcoCsv" type="button"><i class="fas fa-file-csv"></i> CSV</button>
                <button class="btn btn-primary" id="btnAlcoXlsx" type="button"><i class="fas fa-file-excel"></i> ALCO Workbook (.xlsx)</button>
                <button class="btn btn-primary" id="btnAlcoPptx" type="button"><i class="fas fa-file-powerpoint"></i> ALCO Deck (.pptx)</button>
                <button class="btn" id="btnBoardPptx" type="button"><i class="fas fa-file-powerpoint"></i> Board Deck (.pptx)</button>
                <button class="btn" id="btnAlcoHtml" type="button"><i class="fas fa-file-pdf"></i> Printable Report</button>
            </div>
        </div>
        <form class="filters" id="alcoFilterForm">
            <label>Reporting run<select id="alcoRunId">${runs.map(r => `<option value="${r.id}" ${r.id === selectedRun.id ? 'selected' : ''}>Run #${r.id} &middot; ${esc(r.as_of_date)}</option>`).join('')}</select></label>
            <label>Currency<select id="alcoCcy">${currencies.map(c => `<option value="${esc(c)}" ${c === selectedCcy ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label>Comparison run<select id="alcoCmpId"><option value="">None</option>${runs.filter(r => r.id !== selectedRun.id).map(r => `<option value="${r.id}" ${compareRun && r.id === compareRun.id ? 'selected' : ''}>Run #${r.id} &middot; ${esc(r.as_of_date)}</option>`).join('')}</select></label>
            <button class="btn btn-primary" type="submit">Build Pack</button>
        </form>
    </div>

    <div class="draft-banner">DRAFT &middot; ${esc(pack.meta.pack_version)} &middot; Run #${pack.meta.run_id} (${esc(pack.meta.as_of_date)}) &middot; ${esc(ccy)} &middot; Coverage ${pack.coverage.reported}/${pack.coverage.expected}</div>

    <div class="card">
        <h2>Contractual Maturity Gap Ladder</h2>
        <div class="chart-box tall"><canvas id="alcoLadderChart"></canvas></div>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>Term</th><th class="num">Loans</th><th class="num">Deposits</th><th class="num">Periodic Gap</th><th class="num">Cumulative Gap</th><th class="num">Cum. Gap / Loans</th></tr></thead>
                <tbody>
                    ${pack.ladder.rows.map(r => `<tr>
                        <td><strong>${esc(r.label)}</strong></td>
                        <td class="num">${esc(money(r.assets, ccy))}</td>
                        <td class="num">${esc(money(r.liabilities, ccy))}</td>
                        <td class="num ${r.gap.lt(0) ? 'neg' : ''}">${esc(money(r.gap, ccy))}</td>
                        <td class="num ${r.cumulative_gap.lt(0) ? 'neg' : ''}">${esc(money(r.cumulative_gap, ccy))}</td>
                        <td class="num">${esc(pct(r.cumulative_gap_to_assets, 1))}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <div class="card">
        <h2>Parallel Rate Sensitivity</h2>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>Shock</th><th class="num">Loan Contrib. Delta</th><th class="num">Deposit Contrib. Delta</th><th class="num">Shift to Treasury</th><th class="num">12m Earnings Est.</th><th class="num">% of Base NII</th></tr></thead>
                <tbody>
                    ${pack.sensitivity.rows.map(r => `<tr>
                        <td><strong>${r.shock_bps >= 0 ? '+' : ''}${r.shock_bps} bps</strong></td>
                        <td class="num">${esc(money(r.loan_contribution_delta, ccy))}</td>
                        <td class="num">${esc(money(r.deposit_contribution_delta, ccy))}</td>
                        <td class="num">${esc(money(r.treasury_delta, ccy))}</td>
                        <td class="num ${r.nii_12m_delta.lt(0) ? 'neg' : ''}">${esc(money(r.nii_12m_delta, ccy))}</td>
                        <td class="num">${esc(pct(r.nii_12m_pct, 1))}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>

    ${pack.comparison ? `
    <div class="card">
        <h2>Variance Bridge vs Run #${pack.comparison.run_id} (${esc(pack.comparison.as_of_date)})</h2>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>Driver</th><th class="num">Loans</th><th class="num">Deposits</th><th class="num">Total</th></tr></thead>
                <tbody>
                    <tr><td>Starting contribution (Run #${pack.comparison.run_id})</td><td class="num">${esc(money(pack.comparison.bridge.sides.loan.start, ccy))}</td><td class="num">${esc(money(pack.comparison.bridge.sides.deposit.start, ccy))}</td><td class="num">${esc(money(pack.comparison.bridge.total.start, ccy))}</td></tr>
                    ${pack.comparison.bridge.steps.map(s => `<tr><td>${esc(pack.comparison.bridge.labels[s])}</td><td class="num">${esc(money(pack.comparison.bridge.sides.loan[s], ccy))}</td><td class="num">${esc(money(pack.comparison.bridge.sides.deposit[s], ccy))}</td><td class="num">${esc(money(pack.comparison.bridge.total[s], ccy))}</td></tr>`).join('')}
                    <tr class="total"><td>Ending contribution (Run #${pack.meta.run_id})</td><td class="num">${esc(money(pack.comparison.bridge.sides.loan.end, ccy))}</td><td class="num">${esc(money(pack.comparison.bridge.sides.deposit.end, ccy))}</td><td class="num">${esc(money(pack.comparison.bridge.total.end, ccy))}</td></tr>
                </tbody>
            </table>
        </div>
    </div>` : ''}

    <div class="card">
        <h2>Definitions &amp; Limitations</h2>
        <dl class="defs">${pack.definitions.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
        <ul class="facts">${pack.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>`;

    document.getElementById('alcoFilterForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const rId = document.getElementById('alcoRunId').value;
        const cCode = document.getElementById('alcoCcy').value;
        const cmp = document.getElementById('alcoCmpId').value;
        navigate(`/alco?run_id=${rId}&currency=${encodeURIComponent(cCode)}${cmp ? `&compare_run_id=${cmp}` : ''}`);
    });
    document.getElementById('btnAlcoCsv')?.addEventListener('click', () => exportAlcoAnalyticsCsv(pack));
    document.getElementById('btnAlcoXlsx')?.addEventListener('click', () => {
        try { exportAlcoWorkbook(pack); showToast('ALCO workbook (.xlsx) downloaded.', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('btnAlcoPptx')?.addEventListener('click', async () => {
        try { await exportAlcoDeck(pack, 'alco'); showToast('ALCO deck (.pptx) downloaded.', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('btnBoardPptx')?.addEventListener('click', async () => {
        try { await exportAlcoDeck(pack, 'board'); showToast('Board deck (.pptx) downloaded.', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('btnAlcoHtml')?.addEventListener('click', () => openPrintableReport(pack, 'alco'));

    const P = ChartTheme.palette;
    mountChart('alcoLadderChart', {
        type: 'bar',
        data: {
            labels: charts.ladder.labels,
            datasets: [
                { label: 'Loans', data: charts.ladder.assets, backgroundColor: P.blue },
                { label: 'Deposits (-)', data: charts.ladder.liabilities, backgroundColor: P.teal },
                { label: 'Cumulative gap', type: 'line', data: charts.ladder.cumulative, borderColor: P.amber, tension: 0.2 },
            ],
        },
        options: ChartTheme.baseOptions({ scales: { y: ChartTheme.moneyTicks(ccy) } }),
    });
}
