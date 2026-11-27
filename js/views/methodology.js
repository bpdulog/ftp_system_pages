import { Dec } from '../decimal.js';
import { linearInterpolate, monthsToDays, calculateFtpRate, buildCashFlowSchedule } from '../engine.js';
import { esc } from '../ui.js';

export async function renderMethodology(host) {
    host.innerHTML = `
    <div class="card">
        <h2>Transparent Funds Transfer Pricing Methodology</h2>
        <p class="definition">This client-side GitHub Pages edition implements the exact arithmetic and conventions of the Open ALCO Python/FastAPI server.</p>
        <div class="grid-2" style="margin-top:1rem;">
            <div class="card" style="margin:0;">
                <h2>1. Matched Maturity &amp; Floating Reset</h2>
                <p>Fixed instruments lock to the curve effective on their <strong>origination date</strong> at contractual maturity (<code>term_months &times; 30</code> days). Floating-rate loans price and reprice at their <strong>reset tenor</strong> (<code>min(term, reset_months) &times; 30</code> days) with customer rate = <code>Index + Spread</code>.</p>
                <div style="background:var(--surface-2);padding:.75rem;border-radius:8px;font-family:monospace;font-size:.85rem;margin-top:.75rem;">
                    FTP Rate = Curve Base Rate + Spread<br>
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
            <label>Rate Type<select id="mRateType"><option value="fixed">Fixed</option><option value="floating">Floating</option></select></label>
            <label id="mResetWrap" hidden>Reset Freq
                <select id="mReset">
                    <option value="1">1M (30d)</option>
                    <option value="3" selected>3M (90d)</option>
                    <option value="6">6M (180d)</option>
                    <option value="12">12M (360d)</option>
                </select>
            </label>
            <label id="mSpreadWrap" hidden>Index Spread (bps)<input type="number" step="5" id="mIndexSpread" value="250"></label>
            <label>Principal<input type="number" id="mPrin" value="1000000"></label>
            <label id="mRateLabel">Contract Rate (%)<input type="number" step="0.01" id="mRate" value="6.50"></label>
            <label>Term (Months)<input type="number" min="1" id="mTerm" value="60"></label>
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

    const rateTypeSel = document.getElementById('mRateType');
    const syncSandboxFields = () => {
        const isFloat = rateTypeSel.value === 'floating';
        document.getElementById('mResetWrap').hidden = !isFloat;
        document.getElementById('mSpreadWrap').hidden = !isFloat;
        document.getElementById('mRate').readOnly = isFloat;
    };

    const runCalc = () => {
        try {
            const kind = document.getElementById('mType').value;
            const rateType = rateTypeSel.value;
            const isFloat = rateType === 'floating';
            const prin = Dec.from(document.getElementById('mPrin').value);
            const term = parseInt(document.getElementById('mTerm').value, 10);
            const resetMonths = parseInt(document.getElementById('mReset').value, 10);
            const indexSpreadBps = document.getElementById('mIndexSpread').value;
            const amort = document.getElementById('mAmort').value;
            const pricingMonths = isFloat ? Math.min(term, resetMonths) : term;
            const base = linearInterpolate(monthsToDays(pricingMonths), curve);
            let rate;
            if (isFloat) {
                rate = base.add(Dec.from(indexSpreadBps || 0).div(10000));
                document.getElementById('mRate').value = (rate.toNumber() * 100).toFixed(4);
            } else {
                rate = Dec.from(document.getElementById('mRate').value).div(100);
            }
            const [spread, ftp] = calculateFtpRate(base, kind);
            const interest = prin.mul(rate).round(2);
            const ftpAmt = prin.mul(ftp).round(2);
            const nim = kind === 'loan' ? interest.sub(ftpAmt) : ftpAmt.sub(interest);
            const sched = buildCashFlowSchedule({
                instrument_type: kind, amortization_type: amort, principal: prin.toFixed(2),
                contract_rate: rate.toFixed(6), term_months: term, cpr_percent: '0', origination_date: '2026-03-10',
                rate_type: rateType, reset_frequency_months: isFloat ? resetMonths : null,
                index_spread_bps: isFloat ? indexSpreadBps : null,
            }, curve);

            document.getElementById('mOut').innerHTML = `
            <div class="metrics-grid" style="margin-top:1rem;">
                <div class="metric-card"><div class="metric-label">Base Curve Rate (${pricingMonths * 30}d${isFloat ? ' Reset' : ''})</div><div class="metric-value">${(base.toNumber() * 100).toFixed(4)}%</div></div>
                <div class="metric-card"><div class="metric-label">FTP Rate (Spread ${Math.round(spread.toNumber() * 10000)} bps)</div><div class="metric-value">${(ftp.toNumber() * 100).toFixed(4)}%</div></div>
                <div class="metric-card positive"><div class="metric-label">Annualized NIM Contribution</div><div class="metric-value">USD ${nim.toNumber().toLocaleString('en-US', { minimumFractionDigits: 2 })}</div></div>
                <div class="metric-card"><div class="metric-label">Month 1 Payment</div><div class="metric-value">USD ${Number(sched[0].payment_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div></div>
            </div>`;
        } catch (err) {
            document.getElementById('mOut').innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
        }
    };

    rateTypeSel?.addEventListener('change', () => { syncSandboxFields(); runCalc(); });
    document.getElementById('mReset')?.addEventListener('change', runCalc);
    document.getElementById('mIndexSpread')?.addEventListener('input', runCalc);
    document.getElementById('mCalc')?.addEventListener('click', runCalc);
    syncSandboxFields();
    runCalc();
}
