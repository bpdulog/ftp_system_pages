import { buildAlcoPack, chartPayload, runCurrencies, money, pct, bps } from '../alco.js';
import { runTotals } from '../analytics.js';
import { exportAlcoAnalyticsCsv, exportAlcoWorkbook, exportAlcoDeck, openPrintableReport } from '../exports.js';
import { esc, showToast, mountChart, ChartTheme, getRunResults } from '../ui.js';

export async function renderExecutive(host, ctx) {
    const { store, params, navigate, switchToDemo } = ctx;
    const state = store.state;
    const runs = state.calculation_runs
        .filter(r => r.run_type === 'ftp' && r.status === 'completed')
        .sort((a, b) => b.id - a.id);

    if (!runs.length) {
        host.innerHTML = `<div class="card empty-state"><div class="empty-icon"><i class="fas fa-chart-pie"></i></div><h2>Executive Summary</h2><p>No completed FTP runs yet. Load the Sample Bank, import instruments, or run a calculation from the Dashboard.</p><div class="actions" style="justify-content:center;"><button class="btn demo-button" id="btnExecDemo" type="button"><i class="fas fa-university"></i> Load Sample Bank</button><a class="btn btn-primary" href="#/import"><i class="fas fa-file-upload"></i> Import CSV / Excel</a><a class="btn" href="#/dashboard">Go to Dashboard</a></div></div>`;
        document.getElementById('btnExecDemo')?.addEventListener('click', switchToDemo);
        return;
    }

    const selectedRunId = Number(params.get('run_id') || runs[0].id);
    const selectedRun = runs.find(r => r.id === selectedRunId) || runs[0];
    const currencies = runCurrencies(selectedRun);
    const selectedCcy = (params.get('currency') || currencies[0] || 'USD').toUpperCase();
    const compareId = params.get('compare_run_id') ? Number(params.get('compare_run_id')) : (runs[1]?.id || null);
    const compareRun = compareId && compareId !== selectedRun.id ? runs.find(r => r.id === compareId) : null;

    const results = getRunResults(state, selectedRun.id);
    const priorResults = compareRun ? getRunResults(state, compareRun.id) : [];
    const pack = buildAlcoPack(selectedRun, results, selectedCcy, compareRun, priorResults);
    const charts = chartPayload(pack);

    const trendRows = [...runs].reverse().map(r => {
        const t = runTotals(getRunResults(state, r.id), r.input_snapshot || {}, selectedCcy);
        if (!t.instrument_count) return null;
        return {
            label: `#${r.id} (${r.as_of_date})`,
            balance: t.balance.toNumber(),
            loans: t.loans.toNumber(),
            deposits: t.deposits.toNumber(),
            contribution: t.contribution.toNumber(),
        };
    }).filter(Boolean);

    const bs = pack.balance_sheet;
    const c = pack.contribution;
    const ccy = pack.meta.currency;
    const highCount = pack.exceptions.filter(e => e.severity === 'High').length;
    const bizRows = pack.by_group.filter(g => g.dimension === 'business_line');
    const otherGroupRows = pack.by_group.filter(g => g.dimension !== 'business_line');

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div><h2>Executive summary</h2><p>Management view of FTP results for one run and currency, with run-over-run trend. Every figure ties to the ALCO workbook and deck.</p></div>
            <div class="actions">
                <button class="btn" id="btnExecCsv" type="button"><i class="fas fa-file-csv"></i> CSV</button>
                <button class="btn" id="btnExecXlsx" type="button"><i class="fas fa-file-excel"></i> Workbook</button>
                <button class="btn btn-primary" id="btnExecPptx" type="button"><i class="fas fa-file-powerpoint"></i> Board deck</button>
                <button class="btn" id="btnExecReport" type="button"><i class="fas fa-file-pdf"></i> Board report</button>
                <button class="btn" type="button" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
            </div>
        </div>
        <form class="filters" id="execFilterForm">
            <label>Reporting run
                <select id="execRunId">${runs.map(r => `<option value="${r.id}" ${r.id === selectedRun.id ? 'selected' : ''}>Run #${r.id} &middot; ${esc(r.as_of_date)} &middot; ${esc(r.actor)}</option>`).join('')}</select>
            </label>
            <label>Currency
                <select id="execCcy">${currencies.map(code => `<option value="${esc(code)}" ${code === selectedCcy ? 'selected' : ''}>${esc(code)}</option>`).join('')}</select>
            </label>
            <label>Compare run
                <select id="execCompareId">
                    <option value="">None</option>
                    ${runs.filter(r => r.id !== selectedRun.id).map(r => `<option value="${r.id}" ${compareRun && r.id === compareRun.id ? 'selected' : ''}>Run #${r.id} &middot; ${esc(r.as_of_date)}</option>`).join('')}
                </select>
            </label>
            <button class="btn btn-primary" type="submit">View summary</button>
        </form>
    </div>

    <div class="draft-banner">DRAFT &middot; Run #${pack.meta.run_id} &middot; as of ${esc(pack.meta.as_of_date)} &middot; ${esc(ccy)} &middot; Coverage ${pack.coverage.reported} of ${pack.coverage.expected} instruments &middot; ${pack.exceptions.length} exception${pack.exceptions.length === 1 ? '' : 's'}</div>

    <div class="kpis">
        <div class="kpi" style="--accent:#2f6fb3"><span>Loans</span><strong>${esc(money(bs.loan_balance, ccy, true))}</strong><small>Yield ${esc(pct(bs.loan_yield))} &middot; ${bs.loan_count} instruments</small></div>
        <div class="kpi" style="--accent:#2a9d8f"><span>Deposits</span><strong>${esc(money(bs.deposit_balance, ccy, true))}</strong><small>Cost ${esc(pct(bs.deposit_cost))} &middot; ${bs.deposit_count} instruments</small></div>
        <div class="kpi" style="--accent:#d97706"><span>Loan-to-deposit</span><strong>${esc(pct(bs.loan_to_deposit, 1))}</strong><small>Funding gap ${esc(money(bs.funding_gap, ccy, true))}</small></div>
        <div class="kpi" style="--accent:#1b376f"><span>Total contribution</span><strong>${esc(money(c.total, ccy, true))}</strong><small>Annualized &middot; ties to customer NII</small></div>
        <div class="kpi" style="--accent:#64748b"><span>Treasury residual</span><strong>${esc(money(c.treasury_residual, ccy, true))}</strong><small>Treasury spread ${esc(bps(bs.treasury_spread, false))}</small></div>
        <div class="kpi" style="--accent:${pack.ladder.one_year_gap.lt(0) ? '#b42318' : '#0f766e'}"><span>12-month gap</span><strong>${esc(money(pack.ladder.one_year_gap, ccy, true))}</strong><small>${esc(pct(pack.ladder.one_year_gap_to_assets, 1))} of loans</small></div>
        <div class="kpi" style="--accent:${highCount ? '#b42318' : '#0f766e'}"><span>Exceptions</span><strong>${pack.exceptions.length}</strong><small>${highCount} high severity</small></div>
    </div>

    <div class="card">
        <h2>Key observations</h2>
        <ul class="observations">${pack.observations.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <p class="definition">Observations are calculated deterministically from the run; add management commentary before distribution.</p>
    </div>

    <div class="card">
        <h2>Trend across calculation runs</h2>
        <p class="definition">Annualized contribution and covered balance for each completed run in ${esc(ccy)}.</p>
        ${trendRows.length > 1 ? `
        <div class="chart-box"><canvas id="execTrendChart"></canvas></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>Run</th><th class="num">Balance</th><th class="num">Loans</th><th class="num">Deposits</th><th class="num">Annualized contribution</th></tr></thead><tbody>
        ${trendRows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${esc(money(r.balance, ccy))}</td><td class="num">${esc(money(r.loans, ccy))}</td><td class="num">${esc(money(r.deposits, ccy))}</td><td class="num">${esc(money(r.contribution, ccy))}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="muted">One completed run is not enough for a trend. Run FTP again on a later date to build a series.</p>`}
    </div>

    <div class="grid-2" style="margin-bottom:1.5rem;">
        <div class="card">
            <h2>Contribution and Treasury reconciliation</h2>
            <div class="chart-box"><canvas id="execContribChart"></canvas></div>
            <table class="compact"><tbody>
                <tr><td>Loan contribution</td><td class="num">${esc(money(c.loan_contribution, ccy))}</td></tr>
                <tr><td>Deposit contribution</td><td class="num">${esc(money(c.deposit_contribution, ccy))}</td></tr>
                <tr class="sub"><td>Treasury residual</td><td class="num">${esc(money(c.treasury_residual, ccy))}</td></tr>
                <tr class="total"><td>Total contribution</td><td class="num">${esc(money(c.total, ccy))}</td></tr>
                <tr class="${c.reconciliation_difference.isZero() ? 'good' : 'bad'}"><td>Reconciliation difference</td><td class="num">${esc(money(c.reconciliation_difference, ccy))}</td></tr>
            </tbody></table>
        </div>
        <div class="card">
            <h2>Balance sheet, rates and margins</h2>
            <table class="compact"><thead><tr><th>Measure</th><th class="num">Loans</th><th class="num">Deposits</th></tr></thead><tbody>
                <tr><td>Balance</td><td class="num">${esc(money(bs.loan_balance, ccy))}</td><td class="num">${esc(money(bs.deposit_balance, ccy))}</td></tr>
                <tr><td>Customer rate</td><td class="num">${esc(pct(bs.loan_yield, 3))}</td><td class="num">${esc(pct(bs.deposit_cost, 3))}</td></tr>
                <tr><td>FTP rate</td><td class="num">${esc(pct(bs.loan_ftp_rate, 3))}</td><td class="num">${esc(pct(bs.deposit_ftp_rate, 3))}</td></tr>
                <tr class="sub"><td>Margin over FTP</td><td class="num">${esc(bps(bs.loan_margin))}</td><td class="num">${esc(bps(bs.deposit_margin))}</td></tr>
                <tr><td>Weighted contractual term</td><td class="num">${bs.loan_wal_months ? bs.loan_wal_months.toNumber().toFixed(1) + ' mo' : '&mdash;'}</td><td class="num">${bs.deposit_wal_months ? bs.deposit_wal_months.toNumber().toFixed(1) + ' mo' : '&mdash;'}</td></tr>
            </tbody></table>
            <ul class="facts">
                <li>Customer spread (loan yield &minus; deposit cost): <strong>${esc(bps(bs.customer_spread, false))}</strong></li>
                <li>Treasury spread (loan FTP &minus; deposit FTP): <strong>${esc(bps(bs.treasury_spread, false))}</strong></li>
            </ul>
        </div>
    </div>

    <div class="grid-2" style="margin-bottom:1.5rem;">
        <div class="card">
            <h2>Maturity gap and funding profile</h2>
            <p class="definition">Contractual term as captured in the run. Deposits shown below the axis; line is cumulative gap.</p>
            <div class="chart-box tall"><canvas id="execLadderChart"></canvas></div>
        </div>
        <div class="card">
            <h2>Interest rate sensitivity</h2>
            <p class="definition">Parallel curve shift, all else fixed. Illustrative; not a regulatory IRRBB or EVE measure.</p>
            <div class="chart-box"><canvas id="execSensChart"></canvas></div>
        </div>
    </div>

    <div class="card">
        <h2>Business units and departments</h2>
        ${bizRows.length ? `
        <div class="chart-box"><canvas id="execBizChart"></canvas></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>Business line</th><th class="num">Instruments</th><th class="num">Balance</th><th class="num">Margin</th><th class="num">Contribution</th></tr></thead><tbody>
        ${bizRows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.instrument_count}</td><td class="num">${esc(money(r.balance, ccy))}</td><td class="num">${esc(bps(r.margin))}</td><td class="num">${esc(money(r.annualized_contribution, ccy))}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="muted">No business-line assignments captured in this run.</p>`}
        <details><summary>Other reporting dimensions</summary>
            <div class="table-wrap"><table class="compact"><thead><tr><th>Dimension</th><th>Group</th><th>Type</th><th class="num">Balance</th><th class="num">Margin</th><th class="num">Contribution</th></tr></thead><tbody>
            ${otherGroupRows.map(r => `<tr><td>${esc(r.dimension.replace(/_/g, ' '))}</td><td>${esc(r.label)}</td><td>${esc(r.instrument_type)}</td><td class="num">${esc(money(r.balance, ccy))}</td><td class="num">${esc(bps(r.margin))}</td><td class="num">${esc(money(r.annualized_contribution, ccy))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No other reporting-group assignments.</td></tr>'}
            </tbody></table></div>
        </details>
    </div>

    <div class="grid-2" style="margin-bottom:1.5rem;">
        <div class="card">
            <h2>Loan concentration</h2>
            <p class="definition">Largest ${esc(pct(pack.concentration.loan.top_share, 1))} &middot; top ten ${esc(pct(pack.concentration.loan.top10_share, 1))} &middot; HHI ${Math.round(pack.concentration.loan.hhi.toNumber()).toLocaleString('en-US')}</p>
            <table class="compact"><thead><tr><th>Loan</th><th class="num">Balance</th><th class="num">Share</th><th class="num">Contribution</th></tr></thead><tbody>
            ${pack.concentration.loan.top.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${esc(money(r.balance, ccy, true))}</td><td class="num">${esc(pct(r.share, 1))}</td><td class="num">${esc(money(r.contribution, ccy, true))}</td></tr>`).join('') || '<tr><td colspan="4">No loans.</td></tr>'}
            </tbody></table>
        </div>
        <div class="card">
            <h2>Pricing outliers</h2>
            <table class="compact"><thead><tr><th>Instrument</th><th>Flag</th><th class="num">Margin</th><th class="num">Contribution</th></tr></thead><tbody>
            ${pack.outliers.map(r => `<tr><td>${esc(r.name)} <small class="muted">${esc(r.type)}</small></td><td class="${r.contribution.lt(0) ? 'neg' : 'warn'}">${esc(r.flag)}</td><td class="num">${esc(bps(r.margin))}</td><td class="num">${esc(money(r.contribution, ccy, true))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No instruments below FTP or within 25 bps of it.</td></tr>'}
            </tbody></table>
        </div>
    </div>

    <div class="card">
        <h2>Exceptions and data quality</h2>
        <table class="compact"><thead><tr><th>Severity</th><th>Area</th><th>Detail</th><th class="num">Count</th><th class="num">Balance</th></tr></thead><tbody>
        ${pack.exceptions.map(i => `<tr><td><span class="sev sev-${esc(i.severity.toLowerCase())}">${esc(i.severity)}</span></td><td>${esc(i.category)}</td><td>${esc(i.detail)}</td><td class="num">${i.count ?? '&mdash;'}</td><td class="num">${i.balance != null ? esc(money(i.balance, ccy, true)) : '&mdash;'}</td></tr>`).join('') || '<tr><td colspan="5">No exceptions detected.</td></tr>'}
        </tbody></table>
    </div>`;

    document.getElementById('execFilterForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const rId = document.getElementById('execRunId').value;
        const cCode = document.getElementById('execCcy').value;
        const cmpId = document.getElementById('execCompareId').value;
        navigate(`/executive?run_id=${rId}&currency=${encodeURIComponent(cCode)}${cmpId ? `&compare_run_id=${cmpId}` : ''}`);
    });
    document.getElementById('btnExecCsv')?.addEventListener('click', () => exportAlcoAnalyticsCsv(pack));
    document.getElementById('btnExecXlsx')?.addEventListener('click', () => {
        try { exportAlcoWorkbook(pack); } catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('btnExecPptx')?.addEventListener('click', async () => {
        try { await exportAlcoDeck(pack, 'board'); showToast('Board PowerPoint deck downloaded.', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('btnExecReport')?.addEventListener('click', () => openPrintableReport(pack, 'board'));

    const P = ChartTheme.palette;
    const moneyTicks = ChartTheme.moneyTicks(ccy);
    if (trendRows.length > 1) {
        mountChart('execTrendChart', {
            type: 'bar',
            data: {
                labels: trendRows.map(r => r.label),
                datasets: [
                    { label: 'Annualized contribution', data: trendRows.map(r => r.contribution), backgroundColor: P.navy },
                    { label: 'Loans', data: trendRows.map(r => r.loans), backgroundColor: P.blue },
                    { label: 'Deposits', data: trendRows.map(r => r.deposits), backgroundColor: P.teal },
                ],
            },
            options: ChartTheme.baseOptions({ scales: { y: moneyTicks } }),
        });
    }
    mountChart('execContribChart', {
        type: 'bar',
        data: {
            labels: charts.contribution.labels,
            datasets: [{ label: 'Contribution', data: charts.contribution.values, backgroundColor: [P.blue, P.teal, P.amber] }],
        },
        options: ChartTheme.baseOptions({ scales: { y: moneyTicks } }),
    });
    mountChart('execLadderChart', {
        type: 'bar',
        data: {
            labels: charts.ladder.labels,
            datasets: [
                { label: 'Loans', data: charts.ladder.assets, backgroundColor: P.blue },
                { label: 'Deposits (-)', data: charts.ladder.liabilities, backgroundColor: P.teal },
                { label: 'Cumulative gap', type: 'line', data: charts.ladder.cumulative, borderColor: P.amber, backgroundColor: P.amber, tension: 0.2 },
            ],
        },
        options: ChartTheme.baseOptions({ scales: { y: moneyTicks } }),
    });
    mountChart('execSensChart', {
        type: 'bar',
        data: {
            labels: charts.sensitivity.labels,
            datasets: [
                { label: '12m NII delta', data: charts.sensitivity.nii, backgroundColor: P.navy },
                { label: 'Shift to Treasury', data: charts.sensitivity.treasury, backgroundColor: P.amber },
            ],
        },
        options: ChartTheme.baseOptions({ scales: { y: moneyTicks } }),
    });
    if (bizRows.length) {
        mountChart('execBizChart', {
            type: 'bar',
            data: {
                labels: bizRows.map(r => `${r.label} (${r.instrument_type})`),
                datasets: [{ label: 'Annualized contribution', data: bizRows.map(r => r.annualized_contribution.toNumber()), backgroundColor: P.blue }],
            },
            options: ChartTheme.baseOptions({ scales: { y: moneyTicks } }),
        });
    }
}
