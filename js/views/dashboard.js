import { Dec, ZERO } from '../decimal.js';
import { calculateAllFtp, ensureTreasuryCurve, deriveSyntheticSofrCurve, todayIso } from '../engine.js';
import { buildAlcoPack, chartPayload } from '../alco.js';
import { exportPortfolioCsv, exportPortfolioExcel, exportRunCsv } from '../exports.js';
import {
    esc, fmtCurrency, fmtRatePct, fmtBpsFromDec, showToast,
    mountChart, ChartTheme, getLatestFtpRun, getRunResults, getPortfolioCurrencies,
} from '../ui.js';

export async function renderDashboard(host, ctx) {
    const { store, params, switchToDemo, rerender, navigate } = ctx;
    const state = store.state;
    const currencies = getPortfolioCurrencies(state);
    const selectedCcy = (params.get('currency') || currencies[0] || 'USD').toUpperCase();
    const curveNames = [...new Set(state.yield_curves.map(c => c.name))];
    const defaultCurve = curveNames.includes('SOFR') ? 'SOFR' : (curveNames[0] || 'SOFR');

    const latestRun = getLatestFtpRun(state);
    const runResults = latestRun ? getRunResults(state, latestRun.id) : [];

    // Compute dashboard KPIs for selected currency from latest completed run
    const instMap = new Map(state.instruments.map(i => [i.id, i]));
    let loanPrin = ZERO, depPrin = ZERO, intInc = ZERO, intExp = ZERO, ftpCost = ZERO, ftpRev = ZERO, contrib = ZERO;
    const scopedRows = [];
    for (const r of runResults) {
        const inst = instMap.get(r.instrument_id);
        if (!inst || String(inst.currency || 'USD').toUpperCase() !== selectedCcy) continue;
        const p = Dec.from(inst.principal);
        const ii = Dec.from(r.interest_income_expense);
        const fc = Dec.from(r.ftp_cost_revenue);
        const nim = Dec.from(r.net_interest_margin);
        contrib = contrib.add(nim);
        if (inst.instrument_type === 'loan') {
            loanPrin = loanPrin.add(p);
            intInc = intInc.add(ii);
            ftpCost = ftpCost.add(fc);
        } else {
            depPrin = depPrin.add(p);
            intExp = intExp.add(ii);
            ftpRev = ftpRev.add(fc);
        }
        scopedRows.push({ inst, r });
    }

    const pack = latestRun && scopedRows.length ? buildAlcoPack(latestRun, runResults, selectedCcy) : null;
    const charts = pack ? chartPayload(pack) : null;

    host.innerHTML = `
    <div class="card quick-actions">
        <h2>${state.instruments.length === 0 ? 'Get started' : 'Common actions'}</h2>
        <p>${state.instruments.length === 0
            ? 'Add an instrument, import a CSV/Excel file, or load the Example Bank to explore all features.'
            : 'Add or import instruments, then run FTP for a selected curve and as-of date.'}</p>

        ${currencies.length > 1 ? `
        <div class="currency-form">
            <label for="dashCurrency">Reporting currency</label>
            <select id="dashCurrency">${currencies.map(c => `<option value="${esc(c)}" ${c === selectedCcy ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </div>` : `<p class="currency-note">Amounts shown in ${esc(selectedCcy)}.</p>`}

        <div class="action-buttons">
            <a class="btn btn-primary" href="#/instruments/new"><i class="fas fa-plus"></i> Add instrument</a>
            <a class="btn btn-primary" href="#/import"><i class="fas fa-file-upload"></i> Import CSV or Excel</a>
            <a class="btn" href="#/executive"><i class="fas fa-chart-pie"></i> Executive summary</a>
            <a class="btn" href="#/analytics"><i class="fas fa-chart-bar"></i> FTP analytics</a>
            <button class="btn" id="btnExportCsv" type="button"><i class="fas fa-file-csv"></i> Export CSV</button>
            <button class="btn" id="btnExportXlsx" type="button"><i class="fas fa-file-excel"></i> Export Excel</button>
            ${store.mode !== 'demo' ? `<button class="btn demo-button" id="btnDashDemo" type="button"><i class="fas fa-university"></i> Load Example Bank</button>` : ''}
        </div>

        ${state.instruments.length > 0 ? `
        <form class="run-form" id="dashRunForm">
            <label for="dashAsOf">As-of date</label>
            <input id="dashAsOf" type="date" value="${esc(todayIso())}" required>
            <label for="dashCurve">Yield curve</label>
            <input id="dashCurve" type="text" value="${esc(defaultCurve)}" required>
            <button class="btn btn-primary" type="submit"><i class="fas fa-calculator"></i> Run FTP calculation</button>
        </form>` : ''}

        ${latestRun ? `
        <p class="run-meta">
            Latest completed FTP run #${latestRun.id} &middot; As of ${esc(latestRun.as_of_date)} &middot; ${esc(latestRun.actor)} &middot; ${esc(latestRun.methodology_version)}
            &middot; <a href="#/runs">Run history</a>
            ${scopedRows.length ? `&middot; <a href="#" id="linkRunCsv">Download ${esc(selectedCcy)} results CSV</a>` : ''}
        </p>` : ''}
    </div>

    ${state.instruments.length === 0 ? `
    <div class="card empty-state">
        <div class="empty-icon"><i class="fas fa-landmark"></i></div>
        <h2>This bank has no instruments yet</h2>
        <p>Your dashboard will populate after you add instruments (or load the Sample Bank) and run an FTP calculation.</p>
    </div>` : ''}

    <div class="metrics-grid">
        <div class="metric-card"><div class="metric-label">Annualized Margin Contribution</div><div class="metric-value">${esc(fmtCurrency(contrib.toNumber(), selectedCcy))}</div></div>
        <div class="metric-card positive"><div class="metric-label">Total Interest Income</div><div class="metric-value">${esc(fmtCurrency(intInc.toNumber(), selectedCcy))}</div></div>
        <div class="metric-card negative"><div class="metric-label">Total Interest Expense</div><div class="metric-value">${esc(fmtCurrency(intExp.toNumber(), selectedCcy))}</div></div>
        <div class="metric-card"><div class="metric-label">Total Loan Principal</div><div class="metric-value">${esc(fmtCurrency(loanPrin.toNumber(), selectedCcy, 0))}</div></div>
        <div class="metric-card"><div class="metric-label">Total Deposit Principal</div><div class="metric-value">${esc(fmtCurrency(depPrin.toNumber(), selectedCcy, 0))}</div></div>
        <div class="metric-card warning"><div class="metric-label">Total Instruments</div><div class="metric-value">${state.instruments.length}</div></div>
    </div>

    ${pack ? `
    <div class="grid-2" style="margin-bottom:1.5rem;">
        <div class="card">
            <h2>Portfolio composition</h2>
            <p class="definition">Share of ${esc(selectedCcy)} balances by side of the balance sheet.</p>
            <div class="chart-box"><canvas id="dashCompChart"></canvas></div>
        </div>
        <div class="card">
            <h2>Yield curve (${esc(charts.curve.name || defaultCurve)})</h2>
            <p class="definition">Benchmark rates used to price the latest run.</p>
            <div class="chart-box"><canvas id="dashCurveChart"></canvas></div>
        </div>
    </div>
    <div class="grid-2" style="margin-bottom:1.5rem;">
        <div class="card">
            <h2>Contribution breakdown</h2>
            <p class="definition">Business units and Treasury residual, ${esc(selectedCcy)}.</p>
            <div class="chart-box"><canvas id="dashContribChart"></canvas></div>
        </div>
        <div class="card">
            <h2>Customer rate vs FTP rate</h2>
            <p class="definition">Balance-weighted rates; the gap is the FTP margin for each side.</p>
            <div class="chart-box"><canvas id="dashRateChart"></canvas></div>
        </div>
    </div>` : ''}

    <div class="card">
        <h2>FTP Transfer Pricing Summary</h2>
        <div class="metrics-grid" style="margin-top:.75rem;margin-bottom:0;">
            <div class="metric-card negative"><div class="metric-label">Total FTP Cost (Loans)</div><div class="metric-value">${esc(fmtCurrency(ftpCost.toNumber(), selectedCcy))}</div></div>
            <div class="metric-card positive"><div class="metric-label">Total FTP Revenue (Deposits)</div><div class="metric-value">${esc(fmtCurrency(ftpRev.toNumber(), selectedCcy))}</div></div>
            <div class="metric-card"><div class="metric-label">Net FTP Position (Treasury Residual)</div><div class="metric-value">${esc(fmtCurrency(ftpCost.sub(ftpRev).toNumber(), selectedCcy))}</div></div>
        </div>
    </div>

    <div class="card">
        <h2>Recent FTP Calculations</h2>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Instrument</th>
                        <th>Type</th>
                        <th class="num">Principal</th>
                        <th class="num">Contract Rate</th>
                        <th class="num">Base Rate</th>
                        <th class="num">FTP Spread</th>
                        <th class="num">FTP Rate</th>
                        <th class="num">Annualized Contribution</th>
                    </tr>
                </thead>
                <tbody>
                    ${scopedRows.slice(0, 25).map(({ inst, r }) => `
                    <tr>
                        <td><a href="#/instruments/${inst.id}">${esc(inst.name)}</a></td>
                        <td><span class="badge badge-${esc(inst.instrument_type)}">${esc(inst.instrument_type)}</span></td>
                        <td class="num">${esc(fmtCurrency(inst.principal, inst.currency, 0))}</td>
                        <td class="num">${esc(fmtRatePct(inst.contract_rate, 2))}</td>
                        <td class="num">${esc(fmtRatePct(r.base_rate, 3))}</td>
                        <td class="num">${esc(fmtBpsFromDec(r.ftp_spread))}</td>
                        <td class="num">${esc(fmtRatePct(r.ftp_rate, 3))}</td>
                        <td class="num ${Number(r.net_interest_margin) >= 0 ? 'rate-positive' : 'rate-negative'}">${esc(fmtCurrency(r.net_interest_margin, inst.currency, 2))}</td>
                    </tr>`).join('') || `<tr><td colspan="8" class="muted">No FTP results yet for ${esc(selectedCcy)}. Run FTP calculation above.</td></tr>`}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('dashCurrency')?.addEventListener('change', (e) => {
        navigate(`/dashboard?currency=${encodeURIComponent(e.target.value)}`);
    });
    document.getElementById('btnDashDemo')?.addEventListener('click', switchToDemo);
    document.getElementById('btnExportCsv')?.addEventListener('click', () => exportPortfolioCsv(store.state));
    document.getElementById('btnExportXlsx')?.addEventListener('click', () => {
        try { exportPortfolioExcel(store.state); } catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('linkRunCsv')?.addEventListener('click', (e) => {
        e.preventDefault();
        exportRunCsv(latestRun, runResults, selectedCcy);
    });
    document.getElementById('dashRunForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const asOf = document.getElementById('dashAsOf').value;
        const curveName = document.getElementById('dashCurve').value.trim() || 'SOFR';
        try {
            // Auto-bootstrap Treasury + SOFR if the user hasn't created any curves yet in Live Bank
            if (!store.state.yield_curves.some(c => c.name === curveName) && curveName === 'SOFR') {
                ensureTreasuryCurve(store, asOf);
                await deriveSyntheticSofrCurve(store, { basisAdjustmentBps: '10.0', effectiveDate: asOf, curveName: 'SOFR' });
                showToast('Initialized default Treasury & Synthetic SOFR (+10 bps) curve.', 'info');
            }
            const { run } = await calculateAllFtp(store, curveName, asOf, 'browser-user');
            showToast(`FTP calculation run #${run.id} completed.`, 'success');
            await rerender();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    if (pack && charts) {
        const P = ChartTheme.palette;
        const moneyAxis = ChartTheme.moneyTicks(selectedCcy);
        mountChart('dashCompChart', {
            type: 'doughnut',
            data: {
                labels: ['Loans', 'Deposits'],
                datasets: [{ data: [pack.balance_sheet.loan_balance.toNumber(), pack.balance_sheet.deposit_balance.toNumber()], backgroundColor: [P.blue, P.teal] }],
            },
            options: ChartTheme.baseOptions(),
        });
        mountChart('dashCurveChart', {
            type: 'line',
            data: {
                labels: charts.curve.labels,
                datasets: [{ label: charts.curve.name || 'Curve', data: charts.curve.rates, borderColor: P.navy, backgroundColor: P.navy, tension: 0.25 }],
            },
            options: ChartTheme.baseOptions({ scales: { y: ChartTheme.pctTicks() } }),
        });
        mountChart('dashContribChart', {
            type: 'bar',
            data: {
                labels: charts.contribution.labels,
                datasets: [{ label: 'Annualized Contribution', data: charts.contribution.values, backgroundColor: [P.blue, P.teal, P.amber] }],
            },
            options: ChartTheme.baseOptions({ scales: { y: moneyAxis } }),
        });
        const bs = pack.balance_sheet;
        mountChart('dashRateChart', {
            type: 'bar',
            data: {
                labels: ['Loans', 'Deposits'],
                datasets: [
                    { label: 'Customer rate %', data: [bs.loan_yield ? bs.loan_yield.toNumber() * 100 : 0, bs.deposit_cost ? bs.deposit_cost.toNumber() * 100 : 0], backgroundColor: P.blue },
                    { label: 'FTP rate %', data: [bs.loan_ftp_rate ? bs.loan_ftp_rate.toNumber() * 100 : 0, bs.deposit_ftp_rate ? bs.deposit_ftp_rate.toNumber() * 100 : 0], backgroundColor: P.amber },
                ],
            },
            options: ChartTheme.baseOptions({ scales: { y: ChartTheme.pctTicks() } }),
        });
    }
}
