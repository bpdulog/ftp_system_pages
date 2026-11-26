import { Dec } from '../decimal.js';
import { linearInterpolate, monthsToDays, calculateFtpRate, buildCashFlowSchedule } from '../engine.js';
import { esc } from '../ui.js';

export async function renderMethodology(host) {
    host.innerHTML = `
    <div class="card">
        <h2>Transparent Funds Transfer Pricing Methodology</h2>
        <p class="definition">This client-side GitHub Pages edition implements the exact arithmetic and conventions of the Python/FastAPI FTP System.</p>
        <div class="grid-2" style="margin-top:1rem;">
            <div class="card" style="margin:0;">
                <h2>1. Matched Maturity</h2>
                <p>Each instrument is matched to the curve version effective on its <strong>origination date</strong> using 30/360 tenors (<code>term_months &times; 30</code> days), linear interpolation, and flat extrapolation outside curve bounds.</p>
                <div style="background:var(--surface-2);padding:.75rem;border-radius:8px;font-family:monospace;font-size:.85rem;margin-top:.75rem;">
                    FTP Rate = Locked Base Rate + Spread<br>
                    Loans: Base + 20 bps | Deposits: Base &minus; 5 bps
                </div>
            </div>
            <div class="card" style="margin:0;">
                <h2>2. Pooled &amp; Schedule Rules</h2>
                <p>Pooled buckets assign a fixed administered pool rate. Monthly cash flow schedules price remaining term (<code>remaining_months &times; 30</code>) with CPR &rarr; SMM prepayments applied to loans only.</p>
                <div style="background:var(--surface-2);padding:.75rem;border-radius:8px;font-family:monospace;font-size:.85rem;margin-top:.75rem;">
                    SMM = 1 &minus; (1 &minus; CPR)<sup>1/12</sup><br>
                    Synthetic SOFR = Treasury CMT + Basis (bps) / 10,000
                </div>
            </div>
        </div>
    </div>

    <div class="card">
        <h2>Interactive Single-Instrument FTP Sandbox</h2>
        <p class="definition">Test matched-maturity pricing against the known-answer curve (30d 5.00%, 360d 4.00%, 1800d 3.50%, 3600d 3.00%).</p>
        <div class="filters">
            <label>Type<select id="mType"><option value="loan">Loan (+20 bps)</option><option value="deposit">Deposit (-5 bps)</option></select></label>
            <label>Principal<input type="number" id="mPrin" value="1000000"></label>
            <label>Contract Rate (%)<input type="number" step="0.01" id="mRate" value="6.50"></label>
            <label>Term (Months)<input type="number" min="1" id="mTerm" value="12"></label>
            <label>Amortization<select id="mAmort"><option value="bullet">Bullet</option><option value="amortizing">Amortizing</option><option value="interest_only">Interest Only</option></select></label>
            <button class="btn btn-primary" id="mCalc" type="button">Calculate</button>
        </div>
        <div id="mOut"></div>
    </div>`;

    const curve = [
        { tenor_days: 30, rate: '0.05' },
        { tenor_days: 360, rate: '0.04' },
        { tenor_days: 1800, rate: '0.035' },
        { tenor_days: 3600, rate: '0.03' },
    ];

    const runCalc = () => {
        try {
            const kind = document.getElementById('mType').value;
            const prin = Dec.from(document.getElementById('mPrin').value);
            const rate = Dec.from(document.getElementById('mRate').value).div(100);
            const term = parseInt(document.getElementById('mTerm').value, 10);
            const amort = document.getElementById('mAmort').value;
            const base = linearInterpolate(monthsToDays(term), curve);
            const [spread, ftp] = calculateFtpRate(base, kind);
            const interest = prin.mul(rate).round(2);
            const ftpAmt = prin.mul(ftp).round(2);
            const nim = kind === 'loan' ? interest.sub(ftpAmt) : ftpAmt.sub(interest);
            const sched = buildCashFlowSchedule({
                instrument_type: kind, amortization_type: amort, principal: prin.toFixed(2),
                contract_rate: rate.toFixed(6), term_months: term, cpr_percent: '0', origination_date: '2026-03-10',
            }, curve);

            document.getElementById('mOut').innerHTML = `
            <div class="metrics-grid" style="margin-top:1rem;">
                <div class="metric-card"><div class="metric-label">Base Curve Rate (${term * 30}d)</div><div class="metric-value">${(base.toNumber() * 100).toFixed(4)}%</div></div>
                <div class="metric-card"><div class="metric-label">FTP Rate (Spread ${Math.round(spread.toNumber() * 10000)} bps)</div><div class="metric-value">${(ftp.toNumber() * 100).toFixed(4)}%</div></div>
                <div class="metric-card positive"><div class="metric-label">Annualized NIM Contribution</div><div class="metric-value">USD ${nim.toNumber().toLocaleString('en-US', { minimumFractionDigits: 2 })}</div></div>
                <div class="metric-card"><div class="metric-label">Month 1 Payment</div><div class="metric-value">USD ${Number(sched[0].payment_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div></div>
            </div>`;
        } catch (err) {
            document.getElementById('mOut').innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
        }
    };

    document.getElementById('mCalc')?.addEventListener('click', runCalc);
    runCalc();
}
