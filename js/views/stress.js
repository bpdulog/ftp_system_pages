import {
    STANDARD_STRESS_SCENARIOS, simulateYieldCurveShock, runAllStressScenarios,
    ensureTreasuryCurve, deriveSyntheticSofrCurve, todayIso,
} from '../engine.js';
import { esc, fmtCurrency, showToast, mountChart, ChartTheme } from '../ui.js';

export async function renderStress(host, ctx) {
    const { store, params, navigate } = ctx;
    const state = store.state;
    if (!state.yield_curves.some(c => c.name === 'SOFR')) {
        ensureTreasuryCurve(store, todayIso());
        await deriveSyntheticSofrCurve(store, { basisAdjustmentBps: '10.0', effectiveDate: todayIso(), curveName: 'SOFR' });
    }

    const curveNames = [...new Set(state.yield_curves.map(c => c.name))];
    const selectedCurve = params.get('curve') || (curveNames.includes('SOFR') ? 'SOFR' : curveNames[0]);
    const scenarioKey = params.get('scenario') || 'parallel_up_100';
    const customBps = params.get('custom_bps') || '150';
    const depositBeta = params.get('beta') || '0.40';

    let sim = null;
    let matrix = [];
    let simErr = null;
    try {
        sim = simulateYieldCurveShock(state, {
            scenarioKey,
            customShiftBps: scenarioKey === 'custom' ? customBps : null,
            depositBeta,
            curveName: selectedCurve,
        });
        matrix = runAllStressScenarios(state, selectedCurve, depositBeta);
    } catch (err) {
        simErr = err.message;
    }

    host.innerHTML = `
    <div class="card">
        <div class="heading"><div><h2>Yield Curve Shock &amp; Stress Testing</h2><p>Simulate parallel, steepener, flattener, and custom curve shocks with configurable deposit beta pass-through.</p></div></div>
        <form class="filters" id="stressForm">
            <label>Curve
                <select id="stCurve">${curveNames.map(c => `<option value="${esc(c)}" ${c === selectedCurve ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
            </label>
            <label>Scenario
                <select id="stScenario">
                    ${Object.entries(STANDARD_STRESS_SCENARIOS).map(([k, v]) => `<option value="${esc(k)}" ${k === scenarioKey ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
                    <option value="custom" ${scenarioKey === 'custom' ? 'selected' : ''}>Custom Parallel Shift</option>
                </select>
            </label>
            <label id="stCustomWrap" ${scenarioKey === 'custom' ? '' : 'hidden'}>Custom Shift (bps)
                <input type="number" id="stCustomBps" min="-1000" max="1000" step="25" value="${esc(customBps)}">
            </label>
            <label>Deposit Beta (0 - 1)
                <input type="number" id="stBeta" min="0" max="1" step="0.05" value="${esc(depositBeta)}">
            </label>
            <button class="btn btn-primary" type="submit"><i class="fas fa-bolt"></i> Run Simulation</button>
        </form>
        ${simErr ? `<div class="notice notice-error">${esc(simErr)}</div>` : ''}
    </div>

    ${sim ? `
    <div class="metrics-grid">
        <div class="metric-card"><div class="metric-label">Baseline Annual NIM</div><div class="metric-value">${esc(fmtCurrency(sim.baseline_nim.toNumber(), 'USD', 2))}</div></div>
        <div class="metric-card"><div class="metric-label">Shocked Annual NIM</div><div class="metric-value">${esc(fmtCurrency(sim.shocked_nim.toNumber(), 'USD', 2))}</div></div>
        <div class="metric-card ${sim.delta_nim_amount.lt(0) ? 'negative' : 'positive'}"><div class="metric-label">NIM Change ($)</div><div class="metric-value">${esc(fmtCurrency(sim.delta_nim_amount.toNumber(), 'USD', 2))}</div></div>
        <div class="metric-card ${sim.risk_status === 'Breach' ? 'negative' : sim.risk_status === 'Warning' ? 'warning' : 'positive'}"><div class="metric-label">Risk Tolerance Status</div><div class="metric-value" style="font-size:1.25rem;">${esc(sim.risk_status)} (${sim.delta_nim_pct.toFixed(2)}%)</div></div>
    </div>

    <div class="card">
        <h2>${esc(sim.scenario_name)} &mdash; Curve Shift Visualization</h2>
        <p class="definition">${esc(sim.description)}</p>
        <div class="chart-box"><canvas id="stressCurveChart"></canvas></div>
    </div>

    <div class="card">
        <h2>Standard Regulatory Scenario Matrix (Beta = ${(Number(depositBeta) * 100).toFixed(0)}%)</h2>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Scenario</th><th class="num">Baseline NIM</th><th class="num">Shocked NIM</th><th class="num">Delta ($)</th><th class="num">Delta (%)</th><th class="num">Delta (bps)</th><th>Status</th></tr></thead>
                <tbody>
                    ${matrix.map(r => `<tr>
                        <td><strong>${esc(r.scenario_name)}</strong><br><small class="muted">${esc(r.description)}</small></td>
                        <td class="num">${esc(fmtCurrency(r.baseline_nim.toNumber(), 'USD', 2))}</td>
                        <td class="num">${esc(fmtCurrency(r.shocked_nim.toNumber(), 'USD', 2))}</td>
                        <td class="num ${r.delta_nim_amount.lt(0) ? 'neg' : 'rate-positive'}">${esc(fmtCurrency(r.delta_nim_amount.toNumber(), 'USD', 2))}</td>
                        <td class="num">${r.delta_nim_pct.toFixed(2)}%</td>
                        <td class="num">${r.delta_nim_bps.toFixed(1)} bps</td>
                        <td><span class="sev ${r.risk_status === 'Breach' ? 'sev-high' : r.risk_status === 'Warning' ? 'sev-medium' : 'sev-low'}">${esc(r.risk_status)}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>` : ''}`;

    const scenSel = document.getElementById('stScenario');
    scenSel?.addEventListener('change', () => {
        document.getElementById('stCustomWrap').hidden = scenSel.value !== 'custom';
    });
    document.getElementById('stressForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = new URLSearchParams({
            curve: document.getElementById('stCurve').value,
            scenario: scenSel.value,
            beta: document.getElementById('stBeta').value,
            custom_bps: document.getElementById('stCustomBps').value,
        });
        navigate(`/stress-test?${q.toString()}`);
    });

    if (sim && sim.shocked_curve_points.length) {
        const P = ChartTheme.palette;
        mountChart('stressCurveChart', {
            type: 'line',
            data: {
                labels: sim.shocked_curve_points.map(p => `${p.tenor_days}d`),
                datasets: [
                    { label: 'Baseline Curve (%)', data: sim.shocked_curve_points.map(p => p.baseline_rate), borderColor: P.slate, borderDash: [5, 5], tension: 0.32 },
                    { label: 'Shocked Curve (%)', data: sim.shocked_curve_points.map(p => p.shocked_rate), borderColor: P.red, backgroundColor: 'rgba(220, 38, 38, 0.10)', fill: true, tension: 0.32 },
                ],
            },
            options: ChartTheme.baseOptions({ scales: { y: ChartTheme.pctTicks() } }),
        });
    }
}
