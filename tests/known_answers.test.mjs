import test from 'node:test';
import assert from 'node:assert/strict';

import { Dec } from '../js/decimal.js';
import { createInMemoryStore } from '../js/store.js';
import {
    calculateFtpForInstrument,
    calculateAllFtp,
    calculateMonthlyPayment,
    calculateSmm,
    buildCashFlowSchedule,
    getCurveAsOf,
    calculateRepricingGap,
    simulateYieldCurveShock,
    runAllStressScenarios,
} from '../js/engine.js';
import { buildAlcoPack } from '../js/alco.js';
import { initializeDemoBank } from '../js/demo.js';
import { parseCsvRows, rowsToTable, importRows } from '../js/importer.js';

const CURVE_POINTS = [
    { tenor_days: 30, rate: '0.05' },
    { tenor_days: 360, rate: '0.04' },
    { tenor_days: 1800, rate: '0.035' },
    { tenor_days: 3600, rate: '0.03' },
];
const FLAT_POINTS = [
    { tenor_days: 30, rate: '0.05' },
    { tenor_days: 3600, rate: '0.05' },
];

function setupStore(points = CURVE_POINTS, eff = '2026-01-01') {
    const store = createInMemoryStore();
    const curve = {
        id: store.nextId('yield_curves'),
        name: 'SOFR',
        effective_date: eff,
        points,
    };
    store.state.yield_curves.push(curve);
    return { store, curve };
}

function addInst(store, { kind, principal, rate, months, amort = 'bullet', cpr = '0', orig = '2026-03-10', ftp_spread_override = null, bucket_id = null }) {
    const inst = {
        id: store.nextId('instruments'),
        name: 'KA',
        instrument_type: kind,
        amortization_type: amort,
        principal: String(principal),
        contract_rate: String(rate),
        term_months: months,
        currency: 'USD',
        cpr_percent: String(cpr),
        origination_date: orig,
        ftp_spread_override,
        cpr_percent_override: null,
        bucket_id,
        locked_yield_curve_id: null,
        locked_base_rate: null,
    };
    store.state.instruments.push(inst);
    return inst;
}

test('exact tenor loan (12m = 360d -> 4.00% base, 4.20% FTP, 23,000 NIM)', () => {
    const { store, curve } = setupStore();
    const inst = addInst(store, { kind: 'loan', principal: '1000000', rate: '0.065', months: 12 });
    const r = calculateFtpForInstrument(store.state, inst, curve, 1, '2026-03-10');
    assert.equal(r.base_rate, '0.040000');
    assert.equal(r.ftp_spread, '0.002000');
    assert.equal(r.ftp_rate, '0.042000');
    assert.equal(r.interest_income_expense, '65000.0000');
    assert.equal(r.ftp_cost_revenue, '42000.0000');
    assert.equal(r.net_interest_margin, '23000.0000');
});

test('interpolated tenor deposit (18m = 540d -> 3.9375% base, 3.8875% FTP, 4,437.50 NIM)', () => {
    const { store, curve } = setupStore();
    const inst = addInst(store, { kind: 'deposit', principal: '500000', rate: '0.03', months: 18 });
    const r = calculateFtpForInstrument(store.state, inst, curve, 1, '2026-03-10');
    assert.equal(r.base_rate, '0.039375');
    assert.equal(r.ftp_spread, '-0.000500');
    assert.equal(r.ftp_rate, '0.038875');
    assert.equal(r.interest_income_expense, '15000.0000');
    assert.equal(r.ftp_cost_revenue, '19437.5000');
    assert.equal(r.net_interest_margin, '4437.5000');
});

test('beyond longest tenor uses flat extrapolation (360m = 10,800d -> 3.00% base, 3.20% FTP)', () => {
    const { store, curve } = setupStore();
    const inst = addInst(store, { kind: 'loan', principal: '100000', rate: '0.06', months: 360 });
    const r = calculateFtpForInstrument(store.state, inst, curve, 1, '2026-03-10');
    assert.equal(r.base_rate, '0.030000');
    assert.equal(r.ftp_rate, '0.032000');
});

test('spread override replaces default spread (+50 bp -> 4.50%)', () => {
    const { store, curve } = setupStore();
    const inst = addInst(store, { kind: 'loan', principal: '100000', rate: '0.06', months: 12, ftp_spread_override: '0.005' });
    const r = calculateFtpForInstrument(store.state, inst, curve, 1, '2026-03-10');
    assert.equal(r.ftp_spread, '0.005000');
    assert.equal(r.ftp_rate, '0.045000');
});

test('rate lock: later published curve does not move locked instrument', () => {
    const { store, curve: oldCurve } = setupStore();
    const early = addInst(store, { kind: 'loan', principal: '100000', rate: '0.06', months: 12, orig: '2026-03-10' });
    calculateFtpForInstrument(store.state, early, oldCurve, 1, '2026-03-10');

    const newCurve = {
        id: store.nextId('yield_curves'),
        name: 'SOFR',
        effective_date: '2026-06-01',
        points: [{ tenor_days: 30, rate: '0.09' }, { tenor_days: 3600, rate: '0.09' }],
    };
    store.state.yield_curves.push(newCurve);

    const again = calculateFtpForInstrument(store.state, early, newCurve, 2, '2026-07-01');
    assert.equal(again.base_rate, '0.040000');

    const late = addInst(store, { kind: 'loan', principal: '100000', rate: '0.06', months: 12, orig: '2026-07-01' });
    const lateRes = calculateFtpForInstrument(store.state, late, newCurve, 2, '2026-07-01');
    assert.equal(lateRes.base_rate, '0.090000');
});

test('level payment formula (100,000 at 12% for 12m -> 8,884.88)', () => {
    assert.equal(calculateMonthlyPayment('100000', '0.12', 12).toFixed(2), '8884.88');
});

test('smm from cpr (6% CPR)', () => {
    const expected = 1 - Math.pow(1 - 0.06, 1 / 12);
    assert.ok(Math.abs(calculateSmm('0.06').toNumber() - expected) < 1e-12);
    assert.equal(calculateSmm('0').toNumber(), 0);
});

test('amortizing schedule month 1, full payoff, and first payment date', () => {
    const { store } = setupStore(FLAT_POINTS);
    const inst = addInst(store, { kind: 'loan', principal: '100000', rate: '0.12', months: 12, amort: 'amortizing', orig: '2026-12-20' });
    const sched = buildCashFlowSchedule(inst, FLAT_POINTS);
    assert.equal(sched[0].payment_date, '2027-01-01');
    assert.equal(sched[0].interest_payment, '1000.00');
    assert.equal(sched[0].principal_payment, '7884.88');
    assert.equal(sched[0].ending_balance, '92115.12');
    assert.equal(sched.length, 12);
    assert.equal(sched[11].ending_balance, '0.00');
    const sumPrin = sched.reduce((acc, r) => acc.add(r.principal_payment), Dec.from(0));
    assert.equal(sumPrin.toFixed(2), '100000.00');
});

test('bullet deposit schedule & prepayment schedule', () => {
    const { store } = setupStore(FLAT_POINTS);
    const dep = addInst(store, { kind: 'deposit', principal: '500000', rate: '0.04', months: 12 });
    const depSched = buildCashFlowSchedule(dep, FLAT_POINTS);
    assert.ok(depSched.every(r => r.interest_payment === '1666.67'));
    assert.ok(depSched.slice(0, 11).every(r => r.principal_payment === '0.00'));
    assert.equal(depSched[11].principal_payment, '500000.00');

    const cprLoan = addInst(store, { kind: 'loan', principal: '100000', rate: '0.06', months: 12, cpr: '6' });
    const cprSched = buildCashFlowSchedule(cprLoan, FLAT_POINTS);
    const expectedPrepay = (100000 * (1 - Math.pow(1 - 0.06, 1 / 12))).toFixed(2);
    assert.equal(cprSched[0].prepayment, expectedPrepay);
});

test('schedule FTP pricing on flat 5% curve 3m bullet loan', () => {
    const { store } = setupStore(FLAT_POINTS);
    const inst = addInst(store, { kind: 'loan', principal: '120000', rate: '0.072', months: 3 });
    const sched = buildCashFlowSchedule(inst, FLAT_POINTS);
    assert.deepEqual(sched.map(r => r.ftp_rate), ['0.052000', '0.052000', '0.052000']);
    const marginSum = sched.reduce((acc, r) => acc.add(Dec.from(r.interest_payment).sub(r.ftp_cost_revenue)), Dec.from(0));
    assert.equal(marginSum.toFixed(2), '600.00');
});

test('sample bank initialization, ALCO pack reconciliation, repricing gap & stress matrix', async () => {
    const store = createInMemoryStore();
    await initializeDemoBank(store);
    assert.equal(store.state.instruments.length, 13);
    const run = store.state.calculation_runs.find(r => r.status === 'completed');
    assert.ok(run);
    const results = store.state.ftp_results.filter(r => r.calculation_run_id === run.id);
    const pack = buildAlcoPack(run, results, 'USD');
    assert.equal(pack.coverage.expected, 13);
    assert.equal(pack.coverage.reported, 13);
    assert.equal(pack.contribution.reconciliation_difference.toFixed(4), '0.0000');

    const gap = calculateRepricingGap(store.state, '2025-01-31');
    assert.equal(gap.buckets.length, 6);
    assert.ok(gap.total_rsa.gt(0));

    const matrix = runAllStressScenarios(store.state, 'SOFR', '0.40');
    assert.equal(matrix.length, 7);
    const up200 = simulateYieldCurveShock(store.state, { scenarioKey: 'parallel_up_200', depositBeta: '0.40', curveName: 'SOFR' });
    assert.equal(up200.scenario_key, 'parallel_up_200');
});

test('CSV importer normalizes rates, principals, terms, and dates', () => {
    const csv = 'source_id,name,instrument_type,principal,rate,term_years,start_date\nLN-1,Bridge Loan,loan,"$1,250,000",6.25%,3,2026-02-01\n';
    const { columns, rows } = rowsToTable(parseCsvRows(csv));
    const { records } = importRows(columns, rows);
    assert.equal(records.length, 1);
    assert.equal(records[0].principal, '1250000.0000');
    assert.equal(records[0].contract_rate, '0.062500');
    assert.equal(records[0].term_months, 36);
    assert.equal(records[0].origination_date, '2026-02-01');
});
