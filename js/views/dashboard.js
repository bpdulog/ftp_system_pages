import { Dec, ZERO } from '../decimal.js';
import { calculateAllFtp, ensureTreasuryCurve, deriveSyntheticSofrCurve, todayIso } from '../engine.js';
import { buildAlcoPack, chartPayload, money, pct, bps } from '../alco.js';
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
    const bs = pack?.balance_sheet;

    if (state.instruments.length === 0) {
        host.innerHTML = `
        <section class="hero-panel">
            <span class="hero-eyebrow"><i class="fas fa-sparkles"></i> Open ALCO &middot; Institutional Treasury &amp; ALM</span>
            <h2>Matched-Maturity Funds Transfer Pricing, Built for Speed &amp; Auditability</h2>
            <p>Price commercial loans and term deposits against versioned SOFR &amp; Treasury curves, run repricing gap and regulatory stress tests, and export board-ready Excel &amp; PowerPoint ALCO packs directly in your browser.</p>
            <div class="hero-grid">
                <button class="hero-action-card" id="btnHeroDemo" type="button">
                    <i class="fas fa-university"></i>
                    <strong>Load Sample Bank (13 Instruments)</strong>
                    <span>Explore a complete commercial &amp; retail portfolio with SOFR curves, reporting lines, and ALCO analytics.</span>
                </button>
                <a class="hero-action-card" href="#/import">
                    <i class="fas fa-file-excel"></i>
                    <strong>Import CSV or Excel Book</strong>
                    <span>Drag-and-drop your loan &amp; deposit tape with interactive column mapping and strict validation.</span>
                </a>
                <a class="hero-action-card" href="#/instruments/new">
                    <i class="fas fa-plus-circle"></i>
                    <strong>Book Single Instrument</strong>
                    <span>Add a loan or CD manually, lock its origination curve rate, and inspect its cash flow schedule.</span>
                </a>
            </div>
        </section>`;
        document.getElementById('btnHeroDemo')?.addEventListener('click', switchToDemo);
        return;
    }

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div>
                <h2>Portfolio Control Center</h2>
                <p>${latestRun
                    ? `Active Run #${latestRun.id} &middot; As of ${esc(latestRun.as_of_date)} &middot; ${esc(latestRun.methodology_version)}`
                    : 'Instruments booked. Run an FTP calculation below to price the portfolio.'}</p>
            </div>
            <div class="actions">
                <a class="btn btn-primary" href="#/instruments/new"><i class="fas fa-plus"></i> Add Instrument</a>
                <a class="btn" href="#/import"><i class="fas fa-file-upload"></i> Import</a>
                <a class="btn" href="#/executive"><i class="fas fa-chart-pie"></i> Executive</a>
                <button class="btn" id="btnExportCsv" type="button"><i class="fas fa-file-csv"></i> CSV</button>
                <button class="btn" id="btnExportXlsx" type="button"><i class="fas fa-file-excel"></i> Excel</button>
            </div>
        </div>

        ${currencies.length > 1 ? `
        <div class="currency-form" style="margin-top:.85rem;">
            <label for="dashCurrency">Reporting Currency</label>
            <select id="dashCurrency">${currencies.map(c => `<option value="${esc(c)}" ${c === selectedCcy ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </div>` : ''}

        <form class="run-form" id="dashRunForm">
            <label for="dashAsOf">As-of Date</label>
            <input id="dashAsOf" type="date" value="${esc(todayIso())}" required>
            <label for="dashCurve">Benchmark Curve</label>
            <input id="dashCurve" type="text" value="${esc(defaultCurve)}" required>
            <button class="btn btn-primary" type="submit"><i class="fas fa-play"></i> Run FTP Calculation</button>
            ${latestRun && scopedRows.length ? `<a class="btn btn-sm" id="linkRunCsv" href="#" style="margin-left:auto;"><i class="fas fa-download"></i> Run #${latestRun.id} (${esc(selectedCcy)}) CSV</a>` : ''}
        </form>
    </div>

    <div class="metrics-grid">
        <div class="metric-card">
            <div class="metric-label">Annualized Margin Contribution</div>
            <div class="metric-value">${esc(money(contrib, selectedCcy, true))}</div>
            <div class="metric-sub">${esc(fmtCurrency(contrib.toNumber(), selectedCcy))} exact</div>
        </div>
        <div class="metric-card positive">
            <div class="metric-label">Loan Portfolio</div>
            <div class="metric-value">${esc(money(loanPrin, selectedCcy, true))}</div>
            <div class="metric-sub">${bs ? `Yield ${esc(pct(bs.loan_yield))} &middot; Margin ${esc(bps(bs.loan_margin))}` : 'No priced loans yet'}</div>
        </div>
        <div class="metric-card positive">
            <div class="metric-label">Deposit Portfolio</div>
            <div class="metric-value">${esc(money(depPrin, selectedCcy, true))}</div>
            <div class="metric-sub">${bs ? `Cost ${esc(pct(bs.deposit_cost))} &middot; Margin ${esc(bps(bs.deposit_margin))}` : 'No priced deposits yet'}</div>
        </div>
        <div class="metric-card warning">
            <div class="metric-label">Treasury Residual</div>
            <div class="metric-value">${esc(money(ftpCost.sub(ftpRev), selectedCcy, true))}</div>
            <div class="metric-sub">${bs ? `Treasury spread ${esc(bps(bs.treasury_spread, false))}` : `${state.instruments.length} instruments booked`}</div>
        </div>
    </div>

    ${pack ? `
    <div class="grid-2" style="margin-bottom:1.45rem;">
        <div class="card">
            <h2>Balance Sheet Composition <span class="badge badge-neutral">${esc(selectedCcy)}</span></h2>
            <p class="definition">Loan-to-deposit ratio: <strong>${esc(pct(bs.loan_to_deposit, 1))}</strong> &middot; Funding gap ${esc(money(bs.funding_gap, selectedCcy, true))}</p>
            <div class="chart-box"><canvas id="dashCompChart"></canvas></div>
        </div>
        <div class="card">
            <h2>Benchmark Curve (${esc(charts.curve.name || defaultCurve)})</h2>
            <p class="definition">Locked curve term structure supporting matched-maturity pricing.</p>
            <div class="chart-box"><canvas id="dashCurveChart"></canvas></div>
        </div>
    </div>
    <div class="grid-2" style="margin-bottom:1.45rem;">
        <div class="card">
            <h2>Contribution Reconciliation</h2>
            <p class="definition">Business unit margins plus Treasury residual tie to customer net interest.</p>
            <div class="chart-box"><canvas id="dashContribChart"></canvas></div>
        </div>
        <div class="card">
            <h2>Weighted Customer vs FTP Rate</h2>
            <p class="definition">Spread between customer contract rate and transfer price by balance sheet side.</p>
            <div class="chart-box"><canvas id="dashRateChart"></canvas></div>
        </div>
    </div>` : ''}

    <div class="card">
        <h2>Transfer Pricing Ledger <span class="badge badge-neutral">${scopedRows.length} positions</span></h2>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Instrument</th>
                        <th>Side</th>
                        <th class="num">Principal</th>
                        <th class="num">Customer Rate</th>
                        <th class="num">Base Rate</th>
                        <th class="num">Spread</th>
                        <th class="num">FTP Rate</th>
                        <th class="num">Annualized Contribution</th>
                    </tr>
                </thead>
                <tbody>
                    ${scopedRows.slice(0, 25).map(({ inst, r }) => `
                    <tr>
                        <td><a href="#/instruments/${inst.id}"><strong>${esc(inst.name)}</strong></a></td>
                        <td><span class="badge badge-${esc(inst.instrument_type)}">${esc(inst.instrument_type)}</span>${String(inst.rate_type || 'fixed') === 'floating' ? ` <span class="badge badge-warning">Float ${inst.reset_frequency_months || 3}M</span>` : ''}</td>
                        <td class="num">${esc(fmtCurrency(inst.principal, inst.currency, 0))}</td>
                        <td class="num">${esc(fmtRatePct(inst.contract_rate, 2))}</td>
                        <td class="num">${esc(fmtRatePct(r.base_rate, 3))}</td>
                        <td class="num">${esc(fmtBpsFromDec(r.ftp_spread))}</td>
                        <td class="num"><strong>${esc(fmtRatePct(r.ftp_rate, 3))}</strong></td>
                        <td class="num ${Number(r.net_interest_margin) >= 0 ? 'rate-positive' : 'rate-negative'}">${esc(fmtCurrency(r.net_interest_margin, inst.currency, 2))}</td>
                    </tr>`).join('') || `<tr><td colspan="8" class="muted">No priced positions in ${esc(selectedCcy)} yet. Load the Sample Bank or run an FTP calculation.</td></tr>`}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('dashCurrency')?.addEventListener('change', (e) => {
        navigate(`/dashboard?currency=${encodeURIComponent(e.target.value)}`);
    });
    document.getElementById('btnHeroDemo')?.addEventListener('click', switchToDemo);
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
                datasets: [{
                    data: [bs.loan_balance.toNumber(), bs.deposit_balance.toNumber()],
                    backgroundColor: [P.blue, P.teal],
                    borderWidth: 2,
                    borderColor: 'transparent',
                    hoverOffset: 6,
                }],
            },
            options: ChartTheme.baseOptions({ cutout: '68%' }),
        });
        mountChart('dashCurveChart', {
            type: 'line',
            data: {
                labels: charts.curve.labels,
                datasets: [{
                    label: charts.curve.name || 'Curve',
                    data: charts.curve.rates,
                    borderColor: P.blue,
                    backgroundColor: 'rgba(37, 87, 214, 0.12)',
                    fill: true,
                    tension: 0.32,
                }],
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
        mountChart('dashRateChart', {
            type: 'bar',
            data: {
                labels: ['Loans', 'Deposits'],
                datasets: [
                    { label: 'Customer Rate %', data: [bs.loan_yield ? bs.loan_yield.toNumber() * 100 : 0, bs.deposit_cost ? bs.deposit_cost.toNumber() * 100 : 0], backgroundColor: P.blue },
                    { label: 'FTP Rate %', data: [bs.loan_ftp_rate ? bs.loan_ftp_rate.toNumber() * 100 : 0, bs.deposit_ftp_rate ? bs.deposit_ftp_rate.toNumber() * 100 : 0], backgroundColor: P.amber },
                ],
            },
            options: ChartTheme.baseOptions({ scales: { y: ChartTheme.pctTicks() } }),
        });
    }
}
