import { buildAlcoPack, runCurrencies, money, pct, bps } from '../alco.js';
import { exportAlcoAnalyticsCsv, exportAlcoWorkbook } from '../exports.js';
import { esc, showToast, mountChart, ChartTheme, getRunResults } from '../ui.js';

export async function renderAnalytics(host, ctx) {
    const { store, params, navigate, switchToDemo } = ctx;
    const state = store.state;
    const runs = state.calculation_runs.filter(r => r.run_type === 'ftp' && r.status === 'completed').sort((a, b) => b.id - a.id);

    if (!runs.length) {
        host.innerHTML = `<div class="card empty-state"><div class="empty-icon"><i class="fas fa-chart-bar"></i></div><h2>FTP Analytics</h2><p>No completed FTP runs yet. Load the Sample Bank, import instruments, or run FTP from the Dashboard.</p><div class="actions" style="justify-content:center;"><button class="btn demo-button" id="btnAnDemo" type="button"><i class="fas fa-university"></i> Load Sample Bank</button><a class="btn btn-primary" href="#/import"><i class="fas fa-file-upload"></i> Import CSV / Excel</a><a class="btn" href="#/dashboard">Go to Dashboard</a></div></div>`;
        document.getElementById('btnAnDemo')?.addEventListener('click', switchToDemo);
        return;
    }

    const selectedRun = runs.find(r => r.id === Number(params.get('run_id'))) || runs[0];
    const currencies = runCurrencies(selectedRun);
    const selectedCcy = (params.get('currency') || currencies[0] || 'USD').toUpperCase();
    const pack = buildAlcoPack(selectedRun, getRunResults(state, selectedRun.id), selectedCcy);
    const ccy = pack.meta.currency;

    const renderGroupTable = (rows, firstHeader, includeDim = false) => `
    <div class="table-wrap">
        <table>
            <thead><tr>${includeDim ? '<th>Dimension</th>' : ''}<th>${esc(firstHeader)}</th><th>Type</th><th class="num">Instruments</th><th class="num">Balance</th><th class="num">Customer Rate</th><th class="num">FTP Rate</th><th class="num">Margin</th><th class="num">Contribution</th></tr></thead>
            <tbody>
                ${rows.map(r => `<tr>
                    ${includeDim ? `<td>${esc(r.dimension.replace(/_/g, ' '))}</td>` : ''}
                    <td><strong>${esc(r.label)}</strong></td>
                    <td><span class="badge badge-${esc(r.instrument_type)}">${esc(r.instrument_type)}</span></td>
                    <td class="num">${r.instrument_count}</td>
                    <td class="num">${esc(money(r.balance, ccy))}</td>
                    <td class="num">${esc(pct(r.weighted_customer_rate, 3))}</td>
                    <td class="num">${esc(pct(r.weighted_ftp_rate, 3))}</td>
                    <td class="num ${r.margin && r.margin.lt(0) ? 'neg' : ''}">${esc(bps(r.margin))}</td>
                    <td class="num ${r.annualized_contribution.lt(0) ? 'neg' : 'rate-positive'}">${esc(money(r.annualized_contribution, ccy))}</td>
                </tr>`).join('') || `<tr><td colspan="${includeDim ? 9 : 8}" class="muted">No rows.</td></tr>`}
            </tbody>
        </table>
    </div>`;

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div><h2>FTP Analytics</h2><p>Run-scoped profitability by instrument type, pricing bucket, and reporting group. Annualized simple-balance measure.</p></div>
            <div class="actions">
                <button class="btn" id="btnAnCsv" type="button"><i class="fas fa-file-csv"></i> Export CSV</button>
                <button class="btn btn-primary" id="btnAnXlsx" type="button"><i class="fas fa-file-excel"></i> Draft ALCO Workbook</button>
                <button class="btn" type="button" onclick="window.print()"><i class="fas fa-print"></i> Print PDF</button>
            </div>
        </div>
        <form class="filters" id="anFilterForm">
            <label>Run<select id="anRunId">${runs.map(r => `<option value="${r.id}" ${r.id === selectedRun.id ? 'selected' : ''}>Run #${r.id} &middot; ${esc(r.as_of_date)}</option>`).join('')}</select></label>
            <label>Currency<select id="anCcy">${currencies.map(c => `<option value="${esc(c)}" ${c === selectedCcy ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <button class="btn btn-primary" type="submit">Apply</button>
        </form>
    </div>

    <div class="card">
        <h2>By Instrument Type</h2>
        ${renderGroupTable(pack.by_type, 'Instrument Type')}
    </div>
    <div class="card">
        <h2>By Pricing Bucket</h2>
        <div class="chart-box"><canvas id="anBucketChart"></canvas></div>
        ${renderGroupTable(pack.by_bucket, 'Pricing Bucket')}
    </div>
    <div class="card">
        <h2>By Reporting Group</h2>
        ${renderGroupTable(pack.by_group, 'Group', true)}
    </div>`;

    document.getElementById('anFilterForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        navigate(`/analytics?run_id=${document.getElementById('anRunId').value}&currency=${encodeURIComponent(document.getElementById('anCcy').value)}`);
    });
    document.getElementById('btnAnCsv')?.addEventListener('click', () => exportAlcoAnalyticsCsv(pack));
    document.getElementById('btnAnXlsx')?.addEventListener('click', () => {
        try { exportAlcoWorkbook(pack); } catch (err) { showToast(err.message, 'error'); }
    });

    if (pack.by_bucket.length) {
        const P = ChartTheme.palette;
        mountChart('anBucketChart', {
            type: 'bar',
            data: {
                labels: pack.by_bucket.map(b => `${b.label} (${b.instrument_type})`),
                datasets: [{ label: 'Annualized Contribution', data: pack.by_bucket.map(b => b.annualized_contribution.toNumber()), backgroundColor: P.blue }],
            },
            options: ChartTheme.baseOptions({ scales: { y: ChartTheme.moneyTicks(ccy) } }),
        });
    }
}
