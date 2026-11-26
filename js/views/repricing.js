import { calculateRepricingGap, getHistoricalFtpTrends, generateAllCashFlows, todayIso } from '../engine.js';
import { esc, fmtCurrency, fmtRatePct, showToast, mountChart, ChartTheme } from '../ui.js';

export async function renderRepricing(host, ctx) {
    const { store, params, navigate, rerender, switchToDemo } = ctx;
    const state = store.state;
    if (state.instruments.length === 0) {
        host.innerHTML = `
        <div class="card empty-state">
            <div class="empty-icon"><i class="fas fa-hourglass-half"></i></div>
            <h2>Repricing Gap &amp; Margin Trends</h2>
            <p>No instruments in this portfolio yet. Load the Sample Bank or import instruments to analyze ALM repricing gaps and margin compression.</p>
            <div class="actions" style="justify-content:center;">
                <button class="btn demo-button" id="btnRepDemo" type="button"><i class="fas fa-university"></i> Load Sample Bank</button>
                <a class="btn btn-primary" href="#/import"><i class="fas fa-file-upload"></i> Import CSV / Excel</a>
                <a class="btn" href="#/instruments/new"><i class="fas fa-plus"></i> Add Instrument</a>
            </div>
        </div>`;
        document.getElementById('btnRepDemo')?.addEventListener('click', switchToDemo);
        return;
    }
    const asOf = params.get('as_of_date') || todayIso();

    const gap = calculateRepricingGap(state, asOf);
    const trends = getHistoricalFtpTrends(state);
    const comp = trends.compression_summary;

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div><h2>ALM Repricing Gap &amp; Margin Trends</h2><p>Maps scheduled principal amortization and prepayments into standard ALM repricing buckets and tracks historical spread evolution.</p></div>
            <button class="btn btn-primary" id="btnGenAllCf" type="button"><i class="fas fa-cogs"></i> Regenerate All Schedules</button>
        </div>
        <form class="filters" id="gapFilterForm">
            <label>As-of Date<input type="date" id="gapAsOf" value="${esc(asOf)}" required></label>
            <button class="btn btn-primary" type="submit">Update Gap</button>
        </form>
        <div class="metrics-grid" style="margin-bottom:0;">
            <div class="metric-card"><div class="metric-label">1-Year Cumulative Gap</div><div class="metric-value ${gap.net_gap_1y.lt(0) ? 'neg' : ''}">${esc(fmtCurrency(gap.net_gap_1y.toNumber(), 'USD', 0))}</div></div>
            <div class="metric-card"><div class="metric-label">Sensitivity Profile</div><div class="metric-value" style="font-size:1.2rem;">${esc(gap.sensitivity_profile)}</div></div>
            <div class="metric-card positive"><div class="metric-label">+100 bps NII Impact (1Y)</div><div class="metric-value">${esc(fmtCurrency(gap.nim_impact_plus_100bps.toNumber(), 'USD', 0))}</div></div>
            <div class="metric-card negative"><div class="metric-label">-100 bps NII Impact (1Y)</div><div class="metric-value">${esc(fmtCurrency(gap.nim_impact_minus_100bps.toNumber(), 'USD', 0))}</div></div>
        </div>
        <p class="small-note" style="margin-top:.75rem;">${esc(gap.profile_description)}</p>
    </div>

    <div class="card">
        <h2>Rate-Sensitive Assets vs Liabilities (Repricing Ladder)</h2>
        <div class="chart-box tall"><canvas id="repGapChart"></canvas></div>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>Bucket</th><th class="num">RSA (Assets)</th><th class="num">RSL (Liabilities)</th><th class="num">Periodic Gap</th><th class="num">Cumulative Gap</th><th class="num">RSA Rate</th><th class="num">RSL Rate</th><th>Profile</th></tr></thead>
                <tbody>
                    ${gap.buckets.map(b => `<tr>
                        <td><strong>${esc(b.label)}</strong></td>
                        <td class="num">${esc(fmtCurrency(b.rsa.toNumber(), 'USD', 0))}</td>
                        <td class="num">${esc(fmtCurrency(b.rsl.toNumber(), 'USD', 0))}</td>
                        <td class="num ${b.periodic_gap.lt(0) ? 'neg' : ''}">${esc(fmtCurrency(b.periodic_gap.toNumber(), 'USD', 0))}</td>
                        <td class="num ${b.cumulative_gap.lt(0) ? 'neg' : ''}">${esc(fmtCurrency(b.cumulative_gap.toNumber(), 'USD', 0))}</td>
                        <td class="num">${esc(fmtRatePct(b.weighted_rsa_rate.toNumber(), 2))}</td>
                        <td class="num">${esc(fmtRatePct(b.weighted_rsl_rate.toNumber(), 2))}</td>
                        <td>${esc(b.sensitivity)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <div class="card">
        <h2>Historical FTP Margin Compression Diagnosis</h2>
        <div class="notice ${comp.is_loan_margin_compressing || comp.is_deposit_margin_compressing ? 'notice-warning' : 'notice-info'}">
            <strong>${esc(comp.summary_headline)}</strong><br>
            <span>${esc(comp.interpretation)}</span>
        </div>
        ${trends.trends.length ? `
        <div class="chart-box"><canvas id="histTrendChart"></canvas></div>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>As-of Date</th><th class="num">Loans</th><th class="num">Deposits</th><th class="num">Loan Spread</th><th class="num">Deposit Spread</th><th class="num">Annualized NIM</th><th class="num">NIM %</th></tr></thead>
                <tbody>
                    ${trends.trends.map(t => `<tr>
                        <td><strong>${esc(t.as_of_date)}</strong></td>
                        <td class="num">${esc(fmtCurrency(t.total_loan_principal.toNumber(), 'USD', 0))}</td>
                        <td class="num">${esc(fmtCurrency(t.total_deposit_principal.toNumber(), 'USD', 0))}</td>
                        <td class="num">${t.avg_loan_spread_bps.toFixed(1)} bps</td>
                        <td class="num">${t.avg_deposit_spread_bps.toFixed(1)} bps</td>
                        <td class="num">${esc(fmtCurrency(t.net_interest_margin.toNumber(), 'USD', 2))}</td>
                        <td class="num">${t.nim_margin_pct.toFixed(2)}%</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>` : `<p class="muted">No FTP calculation snapshots recorded yet. Run FTP from the dashboard.</p>`}
    </div>`;

    document.getElementById('gapFilterForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        navigate(`/repricing-gap?as_of_date=${encodeURIComponent(document.getElementById('gapAsOf').value)}`);
    });

    document.getElementById('btnGenAllCf')?.addEventListener('click', async () => {
        try {
            const curveName = state.yield_curves.some(c => c.name === 'SOFR') ? 'SOFR' : (state.yield_curves[0]?.name || 'SOFR');
            await generateAllCashFlows(store, curveName, asOf, 'browser-user');
            showToast('All instrument cash flow schedules regenerated.', 'success');
            await rerender();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    const P = ChartTheme.palette;
    mountChart('repGapChart', {
        type: 'bar',
        data: {
            labels: gap.chart_data.labels,
            datasets: [
                { label: 'RSA (Assets)', data: gap.chart_data.rsa, backgroundColor: P.blue },
                { label: 'RSL (Liabilities)', data: gap.chart_data.rsl, backgroundColor: P.teal },
                { label: 'Cumulative Gap', type: 'line', data: gap.chart_data.cumulative_gap, borderColor: P.amber, tension: 0.2 },
            ],
        },
        options: ChartTheme.baseOptions({ scales: { y: ChartTheme.moneyTicks('USD') } }),
    });

    if (trends.trends.length) {
        mountChart('histTrendChart', {
            type: 'line',
            data: {
                labels: trends.chart_data.dates,
                datasets: [
                    { label: 'Loan Spread (bps)', data: trends.chart_data.loan_spreads_bps, borderColor: P.blue, tension: 0.2 },
                    { label: 'Deposit Spread (bps)', data: trends.chart_data.deposit_spreads_bps, borderColor: P.teal, tension: 0.2 },
                ],
            },
            options: ChartTheme.baseOptions(),
        });
    }
}
