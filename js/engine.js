/**
 * FTP Calculation Engine implementing Matched Maturity & Pooled methodologies,
 * Cash Flow Schedules, Treasury/SOFR Curves, Repricing Gap, Historical Trends,
 * and Yield Curve Stress Testing.
 * Port of app/engine.py.
 */
import { Dec, ZERO, ONE, ONE_BP, dsum, decimalRound, dmin, dmax } from './decimal.js';

export function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

export function monthsToDays(months) {
    const m = Number(months);
    if (!Number.isInteger(m) || m <= 0) {
        throw new Error('Term must be a positive number of months');
    }
    return m * 30;
}

export function linearInterpolate(targetDays, curvePoints) {
    if (targetDays < 0) throw new Error('Target tenor cannot be negative');
    const points = [...(curvePoints || [])].sort((a, b) => Number(a.tenor_days) - Number(b.tenor_days));
    if (!points.length) throw new Error('Cannot interpolate an empty yield curve');

    const seen = new Set();
    for (const p of points) {
        const td = Number(p.tenor_days);
        if (seen.has(td)) throw new Error('Yield curve contains duplicate tenors');
        seen.add(td);
    }

    if (targetDays <= Number(points[0].tenor_days)) return Dec.from(points[0].rate);
    if (targetDays >= Number(points[points.length - 1].tenor_days)) return Dec.from(points[points.length - 1].rate);

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const td1 = Number(p1.tenor_days);
        const td2 = Number(p2.tenor_days);
        if (targetDays === td1) return Dec.from(p1.rate);
        if (targetDays === td2) return Dec.from(p2.rate);
        if (td1 < targetDays && targetDays < td2) {
            const t1 = Dec.from(td1);
            const t2 = Dec.from(td2);
            const r1 = Dec.from(p1.rate);
            const r2 = Dec.from(p2.rate);
            const t = Dec.from(targetDays);
            return decimalRound(r1.add(r2.sub(r1).mul(t.sub(t1)).div(t2.sub(t1))), 6);
        }
    }
    throw new Error(`Could not interpolate tenor ${targetDays} days`);
}

export function getCurveAsOf(state, curveName, asOfStr) {
    const asOf = asOfStr || todayIso();
    const family = state.yield_curves
        .filter(c => c.name === curveName)
        .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    if (!family.length) {
        throw new Error(`Yield curve '${curveName}' not found`);
    }
    let best = null;
    for (const c of family) {
        if (c.effective_date <= asOf) best = c;
    }
    return best || family[0];
}

export function calculateFtpRate(baseRate, instrumentType, ftpSpreadOverride = null) {
    const base = Dec.from(baseRate);
    let spread;
    if (ftpSpreadOverride !== null && ftpSpreadOverride !== undefined && ftpSpreadOverride !== '') {
        spread = Dec.from(ftpSpreadOverride);
    } else if (String(instrumentType).toLowerCase() === 'loan') {
        spread = Dec.from(20).mul(ONE_BP);
    } else {
        spread = Dec.from(-5).mul(ONE_BP);
    }
    return [decimalRound(spread, 6), decimalRound(base.add(spread), 6)];
}

export function calculateFtpRateWithBucket(baseRate, bucket, instrumentType, ftpSpreadOverride = null) {
    const base = Dec.from(baseRate);
    const params = bucket?.parameters || {};
    const methodology = bucket?.methodology || 'matched_maturity';

    if (ftpSpreadOverride !== null && ftpSpreadOverride !== undefined && ftpSpreadOverride !== '' && methodology === 'matched_maturity') {
        const spread = Dec.from(ftpSpreadOverride);
        return [decimalRound(spread, 6), decimalRound(base.add(spread), 6)];
    }

    if (methodology === 'matched_maturity') {
        const defBps = String(instrumentType).toLowerCase() === 'loan' ? 20 : -5;
        const spreadBps = params.spread_bps !== undefined && params.spread_bps !== null ? params.spread_bps : defBps;
        const spread = Dec.from(spreadBps).mul(ONE_BP);
        return [decimalRound(spread, 6), decimalRound(base.add(spread), 6)];
    }
    if (methodology === 'pooled') {
        if (params.pool_rate === undefined || params.pool_rate === null || params.pool_rate === '') {
            throw new Error('Pooled bucket requires a pool_rate parameter');
        }
        const poolRate = Dec.from(params.pool_rate);
        return [decimalRound(ZERO, 6), decimalRound(poolRate, 6)];
    }
    if (methodology === 'weighted_average') {
        throw new Error('Weighted Average methodology not yet implemented (501)');
    }
    if (methodology === 'custom') {
        throw new Error('Custom methodology not yet implemented (501)');
    }
    throw new Error(`Unknown methodology: ${methodology}`);
}

export function getBucketForInstrument(state, instrument) {
    if (instrument.bucket_id != null) {
        const b = state.buckets.find(x => x.id === Number(instrument.bucket_id));
        if (b) return b;
    }
    const fallbackName = String(instrument.instrument_type).toLowerCase() === 'loan' ? 'Legacy Loans' : 'Legacy Deposits';
    const b = state.buckets.find(x => x.name === fallbackName);
    if (!b) throw new Error(`Default bucket '${fallbackName}' not found`);
    return b;
}

export function getEffectiveYieldCurve(state, bucket, fallbackCurve) {
    if (bucket.methodology === 'pooled') return null;
    if (bucket.yield_curve_id != null) {
        const c = state.yield_curves.find(x => x.id === Number(bucket.yield_curve_id));
        if (!c) throw new Error(`Yield curve ${bucket.yield_curve_id} configured on bucket '${bucket.name}' does not exist`);
        return c;
    }
    if (!fallbackCurve) throw new Error(`Bucket '${bucket.name}' requires a yield curve`);
    return fallbackCurve;
}

export function lockInstrumentFtp(state, instrument, defaultCurveName = 'SOFR') {
    const curve = getCurveAsOf(state, defaultCurveName, instrument.origination_date || todayIso());
    const baseRate = linearInterpolate(monthsToDays(instrument.term_months), curve.points);
    const [spread, ftpRate] = calculateFtpRate(baseRate, instrument.instrument_type, instrument.ftp_spread_override);
    instrument.locked_yield_curve_id = curve.id;
    instrument.locked_base_rate = baseRate.toFixed(6);
    instrument.locked_ftp_spread = spread.toFixed(6);
    instrument.locked_ftp_rate = ftpRate.toFixed(6);
    instrument.locked_at = new Date().toISOString();
    return instrument;
}

function getLockedBaseRate(state, instrument, curveName) {
    const locked = instrument.locked_yield_curve_id != null
        ? state.yield_curves.find(c => c.id === Number(instrument.locked_yield_curve_id))
        : null;
    if (instrument.locked_yield_curve_id == null || instrument.locked_base_rate == null || !locked || locked.name !== curveName) {
        lockInstrumentFtp(state, instrument, curveName);
    }
    return Dec.from(instrument.locked_base_rate);
}

export function buildGroupPathsByInstrument(state) {
    const groupsById = new Map(state.reporting_groups.map(g => [g.id, g]));
    const byInst = new Map();
    for (const m of state.group_memberships) {
        const leaf = groupsById.get(m.group_id);
        if (!leaf || !leaf.active) continue;
        const path = [];
        let curr = leaf;
        const guard = new Set();
        while (curr && !guard.has(curr.id)) {
            guard.add(curr.id);
            path.unshift({ group_id: curr.id, name: curr.name });
            curr = curr.parent_id != null ? groupsById.get(curr.parent_id) : null;
        }
        if (!byInst.has(m.instrument_id)) byInst.set(m.instrument_id, []);
        byInst.get(m.instrument_id).push({
            group_id: m.group_id,
            name: leaf.name,
            dimension: m.dimension,
            path,
        });
    }
    return byInst;
}

export function buildInputSnapshot(state, yieldCurveName) {
    const groupsByInst = buildGroupPathsByInstrument(state);
    return {
        yield_curve_name: yieldCurveName,
        reporting_groups: state.reporting_groups.map(g => ({
            id: g.id, name: g.name, dimension: g.dimension, parent_id: g.parent_id, active: g.active,
        })),
        instruments: state.instruments.map(i => ({
            id: i.id,
            name: i.name,
            instrument_type: i.instrument_type,
            amortization_type: i.amortization_type,
            principal: String(i.principal),
            contract_rate: String(i.contract_rate),
            term_months: Number(i.term_months),
            currency: i.currency || 'USD',
            cpr_percent: String(i.cpr_percent ?? '0'),
            origination_date: i.origination_date,
            locked_yield_curve_id: i.locked_yield_curve_id,
            locked_base_rate: i.locked_base_rate,
            source_system: i.source_system || null,
            source_id: i.source_id || null,
            import_batch_id: i.import_batch_id || null,
            ftp_spread_override: i.ftp_spread_override ?? null,
            cpr_percent_override: i.cpr_percent_override ?? null,
            bucket_id: i.bucket_id ?? null,
            reporting_groups: groupsByInst.get(i.id) || [],
        })),
        buckets: state.buckets.map(b => ({
            id: b.id, name: b.name, methodology: b.methodology,
            parameters: JSON.parse(JSON.stringify(b.parameters || {})),
            yield_curve_id: b.yield_curve_id ?? null, active: b.active !== false,
        })),
        yield_curves: state.yield_curves.map(c => ({
            id: c.id, name: c.name, effective_date: c.effective_date,
            source: c.source || null, version: c.version || null,
            points: [...(c.points || [])]
                .sort((a, b) => a.tenor_days - b.tenor_days)
                .map(p => ({ tenor_days: Number(p.tenor_days), rate: String(p.rate) })),
        })),
    };
}

export function calculateFtpForInstrument(state, instrument, yieldCurve, calculationRunId = null, asOfDate = null) {
    const bucket = getBucketForInstrument(state, instrument);
    const effectiveCurve = getEffectiveYieldCurve(state, bucket, yieldCurve);

    let baseRate;
    let resultCurveId = null;
    if (bucket.methodology === 'pooled') {
        const poolRate = bucket.parameters?.pool_rate;
        if (poolRate === undefined || poolRate === null || poolRate === '') {
            throw new Error(`Pooled bucket '${bucket.name}' is missing pool_rate`);
        }
        baseRate = Dec.from(poolRate);
    } else {
        if (!effectiveCurve) throw new Error(`Bucket '${bucket.name}' requires a yield curve`);
        baseRate = getLockedBaseRate(state, instrument, effectiveCurve.name);
        resultCurveId = instrument.locked_yield_curve_id;
    }

    const principal = Dec.from(instrument.principal);
    const contractRate = Dec.from(instrument.contract_rate);
    const interest = decimalRound(principal.mul(contractRate), 4);
    const [ftpSpread, ftpRate] = calculateFtpRateWithBucket(
        baseRate, bucket, instrument.instrument_type, instrument.ftp_spread_override
    );
    const ftpAmount = decimalRound(principal.mul(ftpRate), 4);
    const isLoan = String(instrument.instrument_type).toLowerCase() === 'loan';
    const nim = decimalRound(isLoan ? interest.sub(ftpAmount) : ftpAmount.sub(interest), 4);

    return {
        instrument_id: instrument.id,
        yield_curve_id: resultCurveId,
        calculation_run_id: calculationRunId,
        as_of_date: asOfDate || todayIso(),
        base_rate: baseRate.round(6).toFixed(6),
        ftp_spread: ftpSpread.toFixed(6),
        ftp_rate: ftpRate.toFixed(6),
        interest_income_expense: interest.toFixed(4),
        ftp_cost_revenue: ftpAmount.toFixed(4),
        net_interest_margin: nim.toFixed(4),
        calculated_at: new Date().toISOString(),
    };
}

function familyCurveOrNull(state, curveName, asOf) {
    try { return getCurveAsOf(state, curveName, asOf); } catch { return null; }
}

export async function calculateAllFtp(store, yieldCurveName = 'SOFR', asOfDate = null, actor = 'browser-user') {
    const state = store.state;
    const asOf = asOfDate || todayIso();
    const run = {
        id: store.nextId('calculation_runs'),
        run_type: 'ftp',
        as_of_date: asOf,
        methodology_version: 'matched-maturity-v1',
        actor,
        status: 'running',
        error_message: null,
        input_snapshot: null,
        created_at: new Date().toISOString(),
        completed_at: null,
    };

    try {
        const yieldCurve = familyCurveOrNull(state, yieldCurveName, asOf);
        const newResults = [];
        for (const inst of state.instruments) {
            const res = calculateFtpForInstrument(state, inst, yieldCurve, run.id, asOf);
            res.id = store.nextId('ftp_results');
            newResults.push(res);
        }
        // Snapshot after locks are populated so run snapshot mirrors DB state
        run.input_snapshot = buildInputSnapshot(state, yieldCurveName);
        run.status = 'completed';
        run.completed_at = new Date().toISOString();
        state.calculation_runs.push(run);
        state.ftp_results.push(...newResults);
        await store.save();
        return { run, results: newResults };
    } catch (err) {
        run.status = 'failed';
        run.error_message = String(err.message || err).slice(0, 1000);
        run.completed_at = new Date().toISOString();
        run.input_snapshot = buildInputSnapshot(state, yieldCurveName);
        state.calculation_runs.push(run);
        await store.save();
        throw err;
    }
}

// ============== Cash Flow Generation ==============

export function calculateMonthlyPayment(principal, annualRate, months) {
    const p = Dec.from(principal);
    const r = Dec.from(annualRate);
    if (!Number.isInteger(Number(months)) || Number(months) <= 0) {
        throw new Error('Term must be a positive number of months');
    }
    const n = Number(months);
    if (r.isZero()) return decimalRound(p.div(n), 2);
    const monthlyRate = r.div(12);
    const pow = ONE.add(monthlyRate).powInt(n);
    const payment = p.mul(monthlyRate.mul(pow)).div(pow.sub(ONE));
    return decimalRound(payment, 2);
}

export function calculateSmm(cpr) {
    const c = Dec.from(cpr);
    if (c.lt(0) || c.gt(1)) throw new Error('CPR must be between 0 and 1');
    if (c.isZero()) return ZERO;
    const val = 1 - Math.pow(1 - c.toNumber(), 1 / 12);
    return Dec.from(val.toFixed(15));
}

function nextMonthFirstIso(dateStr) {
    const [y, m] = (dateStr || todayIso()).split('-').map(Number);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
}

export function buildCashFlowSchedule(instrument, curvePoints, bucket = null) {
    monthsToDays(instrument.term_months);
    const principal = Dec.from(instrument.principal);
    const contractRate = Dec.from(instrument.contract_rate);
    const amortType = instrument.amortization_type || 'amortizing';
    const isLoan = String(instrument.instrument_type).toLowerCase() === 'loan';

    const cprPct = instrument.cpr_percent_override !== null && instrument.cpr_percent_override !== undefined && instrument.cpr_percent_override !== ''
        ? instrument.cpr_percent_override
        : (instrument.cpr_percent ?? 0);
    const cpr = isLoan ? Dec.from(cprPct || 0).div(100) : ZERO;
    const smm = calculateSmm(cpr);

    const isAmortizing = amortType !== 'bullet' && amortType !== 'interest_only';
    const scheduledPayment = isAmortizing
        ? calculateMonthlyPayment(principal, contractRate, Number(instrument.term_months))
        : null;

    let currentDate = nextMonthFirstIso(instrument.origination_date || todayIso());
    let remainingBalance = principal;
    const schedule = [];
    const termMonths = Number(instrument.term_months);

    for (let month = 1; month <= termMonths; month++) {
        if (remainingBalance.lte(0)) break;
        const remainingTermMonths = termMonths - month + 1;

        let baseRate;
        if (bucket && bucket.methodology === 'pooled') {
            const poolRate = bucket.parameters?.pool_rate;
            if (poolRate === undefined || poolRate === null || poolRate === '') {
                throw new Error(`Pooled bucket '${bucket.name}' is missing pool_rate`);
            }
            baseRate = Dec.from(poolRate);
        } else {
            baseRate = linearInterpolate(monthsToDays(remainingTermMonths), curvePoints);
        }

        const [ftpSpread, ftpRate] = bucket
            ? calculateFtpRateWithBucket(baseRate, bucket, instrument.instrument_type, instrument.ftp_spread_override)
            : calculateFtpRate(baseRate, instrument.instrument_type, instrument.ftp_spread_override);

        const interestPayment = decimalRound(remainingBalance.mul(contractRate).div(12), 2);
        const ftpCostRevenue = decimalRound(remainingBalance.mul(ftpRate).div(12), 2);

        let principalPayment;
        if (scheduledPayment !== null) {
            if (month === termMonths) {
                principalPayment = remainingBalance;
            } else {
                principalPayment = dmin(dmax(scheduledPayment.sub(interestPayment), ZERO), remainingBalance);
            }
        } else if (month === termMonths) {
            principalPayment = remainingBalance;
        } else {
            principalPayment = ZERO;
        }

        const paymentAmount = decimalRound(interestPayment.add(principalPayment), 2);
        const balAfterSched = remainingBalance.sub(principalPayment);
        const prepayment = dmin(decimalRound(balAfterSched.mul(smm), 2), balAfterSched);
        const endingBalance = dmax(balAfterSched.sub(prepayment), ZERO);

        schedule.push({
            payment_date: currentDate,
            beginning_balance: remainingBalance.round(2).toFixed(2),
            payment_amount: paymentAmount.toFixed(2),
            interest_payment: interestPayment.toFixed(2),
            principal_payment: decimalRound(principalPayment, 2).toFixed(2),
            prepayment: prepayment.toFixed(2),
            ending_balance: decimalRound(endingBalance, 2).toFixed(2),
            base_rate: baseRate.round(6).toFixed(6),
            ftp_spread: ftpSpread.toFixed(6),
            ftp_rate: ftpRate.toFixed(6),
            ftp_cost_revenue: ftpCostRevenue.toFixed(2),
            remaining_term_months: remainingTermMonths,
        });

        remainingBalance = endingBalance;
        currentDate = nextMonthFirstIso(currentDate);
    }
    return schedule;
}

export async function generateCashFlowsForInstrument(store, instrumentId, yieldCurveName = 'SOFR', asOfDate = null, actor = 'browser-user') {
    const state = store.state;
    const asOf = asOfDate || todayIso();
    const inst = state.instruments.find(i => i.id === Number(instrumentId));
    if (!inst) throw new Error(`Instrument with ID ${instrumentId} not found`);

    const run = {
        id: store.nextId('calculation_runs'),
        run_type: 'cash_flows',
        as_of_date: asOf,
        methodology_version: 'matched-maturity-v1',
        actor,
        status: 'running',
        error_message: null,
        input_snapshot: null,
        created_at: new Date().toISOString(),
        completed_at: null,
    };

    try {
        const yieldCurve = familyCurveOrNull(state, yieldCurveName, asOf);
        const bucket = getBucketForInstrument(state, inst);
        const effectiveCurve = getEffectiveYieldCurve(state, bucket, yieldCurve);
        let curvePoints = [];
        if (effectiveCurve && bucket.methodology !== 'pooled') {
            getLockedBaseRate(state, inst, effectiveCurve.name);
            const lockedCurve = state.yield_curves.find(c => c.id === inst.locked_yield_curve_id);
            curvePoints = lockedCurve ? lockedCurve.points : [];
        }
        const rows = buildCashFlowSchedule(inst, curvePoints, bucket).map(row => ({
            id: store.nextId('cash_flows'),
            instrument_id: inst.id,
            calculation_run_id: run.id,
            ...row,
        }));
        state.cash_flows = state.cash_flows.filter(cf => cf.instrument_id !== inst.id);
        state.cash_flows.push(...rows);
        run.input_snapshot = buildInputSnapshot(state, yieldCurveName);
        run.status = 'completed';
        run.completed_at = new Date().toISOString();
        state.calculation_runs.push(run);
        await store.save();
        return rows;
    } catch (err) {
        run.status = 'failed';
        run.error_message = String(err.message || err).slice(0, 1000);
        run.completed_at = new Date().toISOString();
        state.calculation_runs.push(run);
        await store.save();
        throw err;
    }
}

export async function generateAllCashFlows(store, yieldCurveName = 'SOFR', asOfDate = null, actor = 'browser-user') {
    const state = store.state;
    const asOf = asOfDate || todayIso();
    const run = {
        id: store.nextId('calculation_runs'),
        run_type: 'cash_flows',
        as_of_date: asOf,
        methodology_version: 'matched-maturity-v1',
        actor,
        status: 'running',
        error_message: null,
        input_snapshot: null,
        created_at: new Date().toISOString(),
        completed_at: null,
    };

    try {
        const yieldCurve = familyCurveOrNull(state, yieldCurveName, asOf);
        const allRows = [];
        for (const inst of state.instruments) {
            const bucket = getBucketForInstrument(state, inst);
            const effectiveCurve = getEffectiveYieldCurve(state, bucket, yieldCurve);
            let curvePoints = [];
            if (effectiveCurve && bucket.methodology !== 'pooled') {
                getLockedBaseRate(state, inst, effectiveCurve.name);
                const lockedCurve = state.yield_curves.find(c => c.id === inst.locked_yield_curve_id);
                curvePoints = lockedCurve ? lockedCurve.points : [];
            }
            for (const row of buildCashFlowSchedule(inst, curvePoints, bucket)) {
                allRows.push({
                    id: store.nextId('cash_flows'),
                    instrument_id: inst.id,
                    calculation_run_id: run.id,
                    ...row,
                });
            }
        }
        state.cash_flows = allRows;
        run.input_snapshot = buildInputSnapshot(state, yieldCurveName);
        run.status = 'completed';
        run.completed_at = new Date().toISOString();
        state.calculation_runs.push(run);
        await store.save();
        return allRows;
    } catch (err) {
        run.status = 'failed';
        run.error_message = String(err.message || err).slice(0, 1000);
        run.completed_at = new Date().toISOString();
        state.calculation_runs.push(run);
        await store.save();
        throw err;
    }
}

// ============== Curves, Treasury & Synthetic SOFR ==============

export const TREASURY_DEFAULT_POINTS = [
    { tenor_days: 30, rate: '0.052000' },
    { tenor_days: 90, rate: '0.050500' },
    { tenor_days: 180, rate: '0.048500' },
    { tenor_days: 365, rate: '0.044000' },
    { tenor_days: 730, rate: '0.039500' },
    { tenor_days: 1095, rate: '0.038000' },
    { tenor_days: 1825, rate: '0.037000' },
    { tenor_days: 2555, rate: '0.037500' },
    { tenor_days: 3650, rate: '0.039000' },
    { tenor_days: 7300, rate: '0.042500' },
    { tenor_days: 10950, rate: '0.041500' },
];

export function ensureTreasuryCurve(store, effectiveDate = null) {
    const state = store.state;
    const existing = state.yield_curves
        .filter(c => c.name === 'TREASURY')
        .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
    if (existing) return existing;

    const eff = effectiveDate || todayIso();
    const curve = {
        id: store.nextId('yield_curves'),
        name: 'TREASURY',
        effective_date: eff,
        description: 'ILLUSTRATIVE PLACEHOLDER Treasury curve - not live market data; import Treasury CSV to update',
        source: 'Illustrative baseline',
        version: 'illustrative-1',
        basis_adjustment_bps: '0.00',
        derived_from_curve_id: null,
        created_at: new Date().toISOString(),
        points: TREASURY_DEFAULT_POINTS.map(p => ({ ...p })),
    };
    state.yield_curves.push(curve);
    return curve;
}

export function parseTreasuryCsv(textData, asOf = null) {
    const lines = String(textData || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('Treasury yield curve data was empty');
    const splitCsvLine = (line) => {
        const out = []; let cur = ''; let q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (q) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = false;
                else cur += ch;
            } else {
                if (ch === '"') q = true;
                else if (ch === ',') { out.push(cur); cur = ''; }
                else cur += ch;
            }
        }
        out.push(cur);
        return out;
    };

    const header = splitCsvLine(lines[0]);
    if (!header.length || header[0].trim().toLowerCase() !== 'date') {
        throw new Error('Treasury yield curve data has an unrecognised format');
    }
    const tenorCols = new Map();
    header.forEach((name, idx) => {
        const m = /^\s*(\d+(?:\.\d+)?)\s*(Mo|Month|Yr|Year)\s*$/i.exec(name.trim());
        if (!m) return;
        const qty = Dec.from(m[1]);
        const unit = m[2].toLowerCase().startsWith('mo') ? 30 : 365;
        tenorCols.set(idx, Math.round(qty.mul(unit).toNumber()));
    });
    if (!tenorCols.size) throw new Error('Treasury yield curve data has an unrecognised format');

    let best = null;
    for (let i = 1; i < lines.length; i++) {
        const row = splitCsvLine(lines[i]);
        if (!row.length || !row[0].trim()) continue;
        const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(row[0].trim());
        if (!mdy) continue;
        const rowDate = `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
        if (asOf && rowDate > asOf) continue;
        if (best && rowDate <= best.curveDate) continue;

        const points = [];
        for (const [idx, days] of tenorCols.entries()) {
            const cell = (row[idx] || '').trim();
            if (!cell) continue;
            try {
                const rate = Dec.from(cell).div(100);
                if (rate.gte(0) && rate.lte(1)) {
                    points.push({ tenor_days: days, rate: decimalRound(rate, 6).toFixed(6) });
                }
            } catch { /* skip invalid cell */ }
        }
        if (points.length >= 2) {
            points.sort((a, b) => a.tenor_days - b.tenor_days);
            best = { curveDate: rowDate, points };
        }
    }
    if (!best) throw new Error('No usable Treasury yield curve row found for the requested date');
    return best;
}

export async function publishTreasuryFromCsvText(store, csvText, asOf = null) {
    const { curveDate, points } = parseTreasuryCsv(csvText, asOf);
    const existing = store.state.yield_curves.find(c => c.name === 'TREASURY' && c.effective_date === curveDate);
    if (existing) return existing;
    const curve = {
        id: store.nextId('yield_curves'),
        name: 'TREASURY',
        effective_date: curveDate,
        description: `U.S. Treasury daily par yield curve (CMT) for ${curveDate}, from home.treasury.gov`,
        source: 'home.treasury.gov CSV',
        version: `cmt-${curveDate}`,
        basis_adjustment_bps: '0.00',
        derived_from_curve_id: null,
        created_at: new Date().toISOString(),
        points,
    };
    store.state.yield_curves.push(curve);
    await store.save();
    return curve;
}

export async function deriveSyntheticSofrCurve(
    store,
    { treasuryCurveId = null, basisAdjustmentBps = '10.0', effectiveDate = null, curveName = 'SOFR', description = null } = {}
) {
    const state = store.state;
    const eff = effectiveDate || todayIso();
    let treasuryCurve;
    if (treasuryCurveId) {
        treasuryCurve = state.yield_curves.find(c => c.id === Number(treasuryCurveId));
        if (!treasuryCurve) throw new Error(`Treasury curve with ID ${treasuryCurveId} not found`);
    } else {
        treasuryCurve = ensureTreasuryCurve(store, eff);
    }
    if (!treasuryCurve.points?.length) {
        throw new Error(`Treasury curve '${treasuryCurve.name}' has no curve points`);
    }

    const dup = state.yield_curves.find(c => c.name === curveName && c.effective_date === eff);
    if (dup) {
        throw new Error(
            `Yield curve '${curveName}' already has a version effective ${eff}; curves are immutable - choose a different effective date to publish a new version`
        );
    }

    const basisBps = Dec.from(basisAdjustmentBps);
    const basisDec = decimalRound(basisBps.div(10000), 6);
    const signStr = basisBps.gte(0) ? `+${basisBps.toFixed(1)}` : basisBps.toFixed(1);
    const desc = description || `Synthetic SOFR derived from Treasury (${treasuryCurve.effective_date}) with ${signStr} bps fixed basis adjustment`;

    const sofr = {
        id: store.nextId('yield_curves'),
        name: curveName,
        effective_date: eff,
        description: desc,
        source: `Derived from ${treasuryCurve.name} (${treasuryCurve.effective_date})`,
        version: `sofr-${eff}`,
        basis_adjustment_bps: basisBps.toFixed(2),
        derived_from_curve_id: treasuryCurve.id,
        created_at: new Date().toISOString(),
        points: treasuryCurve.points.map(pt => ({
            tenor_days: Number(pt.tenor_days),
            rate: decimalRound(Dec.from(pt.rate).add(basisDec), 6).toFixed(6),
        })),
    };
    state.yield_curves.push(sofr);
    await store.save();
    return sofr;
}

// ============== ALM Repricing Gap & Historical Trends ==============

const ZERO_CURVE = [{ tenor_days: 1, rate: '0' }, { tenor_days: 36500, rate: '0' }];

function daysBetweenIso(d1, d2) {
    const t1 = Date.parse(`${d1.slice(0, 10)}T00:00:00Z`);
    const t2 = Date.parse(`${d2.slice(0, 10)}T00:00:00Z`);
    return Math.round((t2 - t1) / 86400000);
}

export function calculateRepricingGap(state, asOfDate = null) {
    const asOf = asOfDate || todayIso();
    const bucketDefs = [
        { bucket: '0-3M', label: '0 - 3 Months', days_min: 0, days_max: 90 },
        { bucket: '3-6M', label: '3 - 6 Months', days_min: 91, days_max: 180 },
        { bucket: '6-12M', label: '6 - 12 Months', days_min: 181, days_max: 365 },
        { bucket: '1-3Y', label: '1 - 3 Years', days_min: 366, days_max: 1095 },
        { bucket: '3-5Y', label: '3 - 5 Years', days_min: 1096, days_max: 1825 },
        { bucket: '>5Y', label: 'Over 5 Years', days_min: 1826, days_max: null },
    ];
    const bucketIdx = (days) => (
        days <= 90 ? 0 : days <= 180 ? 1 : days <= 365 ? 2 : days <= 1095 ? 3 : days <= 1825 ? 4 : 5
    );

    const bucketRsa = Array(6).fill(ZERO);
    const bucketRsl = Array(6).fill(ZERO);
    const bucketRsaRate = Array(6).fill(ZERO);
    const bucketRslRate = Array(6).fill(ZERO);

    const cfsByInst = new Map();
    for (const cf of state.cash_flows) {
        if (!cfsByInst.has(cf.instrument_id)) cfsByInst.set(cf.instrument_id, []);
        cfsByInst.get(cf.instrument_id).push(cf);
    }

    for (const inst of state.instruments) {
        const isLoan = String(inst.instrument_type).toLowerCase() === 'loan';
        const cRate = Dec.from(inst.contract_rate || 0);
        let cfs = cfsByInst.get(inst.id);
        if (!cfs || !cfs.length) {
            try { cfs = buildCashFlowSchedule(inst, ZERO_CURVE); } catch { cfs = []; }
        }
        for (const cf of cfs) {
            const cfPrin = Dec.from(cf.principal_payment || 0).add(Dec.from(cf.prepayment || 0));
            if (cfPrin.lte(0)) continue;
            const days = daysBetweenIso(asOf, cf.payment_date);
            if (days < 0) continue;
            const idx = bucketIdx(days);
            if (isLoan) {
                bucketRsa[idx] = bucketRsa[idx].add(cfPrin);
                bucketRsaRate[idx] = bucketRsaRate[idx].add(cfPrin.mul(cRate));
            } else {
                bucketRsl[idx] = bucketRsl[idx].add(cfPrin);
                bucketRslRate[idx] = bucketRslRate[idx].add(cfPrin.mul(cRate));
            }
        }
    }

    const totalRsa = dsum(bucketRsa);
    const totalRsl = dsum(bucketRsl);
    let runningCumGap = ZERO;
    const buckets = bucketDefs.map((b, i) => {
        const rsa = bucketRsa[i];
        const rsl = bucketRsl[i];
        const periodicGap = rsa.sub(rsl);
        runningCumGap = runningCumGap.add(periodicGap);
        const gapRatio = rsl.gt(0) ? decimalRound(rsa.div(rsl), 2) : null;
        const wRsaRate = rsa.gt(0) ? decimalRound(bucketRsaRate[i].div(rsa), 6) : ZERO;
        const wRslRate = rsl.gt(0) ? decimalRound(bucketRslRate[i].div(rsl), 6) : ZERO;
        const rsaShare = totalRsa.gt(0) ? decimalRound(rsa.div(totalRsa).mul(100), 2) : ZERO;
        const rslShare = totalRsl.gt(0) ? decimalRound(rsl.div(totalRsl).mul(100), 2) : ZERO;
        const cumGapPct = totalRsa.gt(0) ? decimalRound(runningCumGap.div(totalRsa).mul(100), 2) : ZERO;
        const sensitivity = periodicGap.gt(0) ? 'Asset Sensitive' : periodicGap.lt(0) ? 'Liability Sensitive' : 'Balanced';
        return {
            ...b,
            rsa: decimalRound(rsa, 2),
            rsl: decimalRound(rsl, 2),
            periodic_gap: decimalRound(periodicGap, 2),
            cumulative_gap: decimalRound(runningCumGap, 2),
            gap_ratio: gapRatio,
            rsa_share_pct: rsaShare,
            rsl_share_pct: rslShare,
            cum_gap_pct_assets: cumGapPct,
            weighted_rsa_rate: wRsaRate,
            weighted_rsl_rate: wRslRate,
            sensitivity,
        };
    });

    const netGap1y = buckets[2].cumulative_gap;
    const netGap1yPct = totalRsa.gt(0) ? decimalRound(netGap1y.div(totalRsa).mul(100), 2) : ZERO;
    let sensitivityProfile, profileDescription;
    if (netGap1y.lt(0)) {
        sensitivityProfile = 'Liability Sensitive';
        profileDescription = 'Liabilities reprice faster than assets within the 1-year horizon. A parallel rise in interest rates will compress Net Interest Margin (NIM), while falling interest rates will expand NIM.';
    } else if (netGap1y.gt(0)) {
        sensitivityProfile = 'Asset Sensitive';
        profileDescription = 'Assets reprice faster than liabilities within the 1-year horizon. A parallel rise in interest rates will expand Net Interest Margin (NIM), while falling interest rates will compress NIM.';
    } else {
        sensitivityProfile = 'Balanced / Matched';
        profileDescription = 'Asset and liability repricing cash flows are matched within the 1-year horizon.';
    }

    return {
        as_of_date: asOf,
        total_rsa: decimalRound(totalRsa, 2),
        total_rsl: decimalRound(totalRsl, 2),
        net_gap_1y: netGap1y,
        net_gap_1y_pct_assets: netGap1yPct,
        sensitivity_profile: sensitivityProfile,
        profile_description: profileDescription,
        nim_impact_plus_100bps: decimalRound(netGap1y.mul('0.01'), 2),
        nim_impact_minus_100bps: decimalRound(netGap1y.mul('-0.01'), 2),
        buckets,
        chart_data: {
            labels: buckets.map(b => b.label),
            rsa: buckets.map(b => b.rsa.toNumber()),
            rsl: buckets.map(b => b.rsl.toNumber()),
            periodic_gap: buckets.map(b => b.periodic_gap.toNumber()),
            cumulative_gap: buckets.map(b => b.cumulative_gap.toNumber()),
        },
    };
}

export function getHistoricalFtpTrends(state) {
    const dates = [...new Set(state.ftp_results.map(r => r.as_of_date))].sort();
    const instCache = new Map(state.instruments.map(i => [i.id, i]));
    const trends = [];

    for (const snapDate of dates) {
        const latestByInst = new Map();
        for (const r of state.ftp_results) {
            if (r.as_of_date !== snapDate) continue;
            const prev = latestByInst.get(r.instrument_id);
            if (!prev || r.id > prev.id) latestByInst.set(r.instrument_id, r);
        }
        const results = [...latestByInst.values()];
        const loansRes = results.filter(r => instCache.get(r.instrument_id)?.instrument_type === 'loan');
        const depsRes = results.filter(r => instCache.get(r.instrument_id)?.instrument_type === 'deposit');

        const loanPrin = dsum(loansRes.map(r => instCache.get(r.instrument_id).principal));
        const wLoanContract = loanPrin.gt(0)
            ? dsum(loansRes.map(r => Dec.from(instCache.get(r.instrument_id).contract_rate).mul(instCache.get(r.instrument_id).principal))).div(loanPrin)
            : ZERO;
        const wLoanFtp = loanPrin.gt(0)
            ? dsum(loansRes.map(r => Dec.from(r.ftp_rate).mul(instCache.get(r.instrument_id).principal))).div(loanPrin)
            : ZERO;
        const loanSpreadBps = decimalRound(wLoanContract.sub(wLoanFtp).mul(10000), 2);
        const totalInterestIncome = dsum(loansRes.map(r => r.interest_income_expense));
        const totalFtpCost = dsum(loansRes.map(r => r.ftp_cost_revenue));

        const depPrin = dsum(depsRes.map(r => instCache.get(r.instrument_id).principal));
        const wDepContract = depPrin.gt(0)
            ? dsum(depsRes.map(r => Dec.from(instCache.get(r.instrument_id).contract_rate).mul(instCache.get(r.instrument_id).principal))).div(depPrin)
            : ZERO;
        const wDepFtp = depPrin.gt(0)
            ? dsum(depsRes.map(r => Dec.from(r.ftp_rate).mul(instCache.get(r.instrument_id).principal))).div(depPrin)
            : ZERO;
        const depSpreadBps = decimalRound(wDepFtp.sub(wDepContract).mul(10000), 2);
        const totalInterestExpense = dsum(depsRes.map(r => r.interest_income_expense));
        const totalFtpRevenue = dsum(depsRes.map(r => r.ftp_cost_revenue));

        const nim = totalInterestIncome.sub(totalFtpCost).add(totalFtpRevenue.sub(totalInterestExpense));
        const nimMarginPct = loanPrin.gt(0) ? decimalRound(nim.div(loanPrin).mul(100), 4) : ZERO;

        trends.push({
            as_of_date: snapDate,
            loan_count: loansRes.length,
            deposit_count: depsRes.length,
            total_loan_principal: decimalRound(loanPrin, 2),
            total_deposit_principal: decimalRound(depPrin, 2),
            avg_loan_contract_rate: decimalRound(wLoanContract, 6),
            avg_loan_ftp_rate: decimalRound(wLoanFtp, 6),
            avg_loan_spread_bps: loanSpreadBps,
            avg_deposit_contract_rate: decimalRound(wDepContract, 6),
            avg_deposit_ftp_rate: decimalRound(wDepFtp, 6),
            avg_deposit_spread_bps: depSpreadBps,
            total_interest_income: decimalRound(totalInterestIncome, 2),
            total_interest_expense: decimalRound(totalInterestExpense, 2),
            total_ftp_cost: decimalRound(totalFtpCost, 2),
            total_ftp_revenue: decimalRound(totalFtpRevenue, 2),
            net_interest_margin: decimalRound(nim, 2),
            nim_margin_pct: nimMarginPct,
        });
    }

    let loanSpreadChange = ZERO, depSpreadChange = ZERO, nimChangeAmount = ZERO, nimMarginChangeBps = ZERO;
    let earliestDate = null, latestDate = null;
    if (trends.length >= 2) {
        const first = trends[0], latest = trends[trends.length - 1];
        loanSpreadChange = latest.avg_loan_spread_bps.sub(first.avg_loan_spread_bps);
        depSpreadChange = latest.avg_deposit_spread_bps.sub(first.avg_deposit_spread_bps);
        nimChangeAmount = latest.net_interest_margin.sub(first.net_interest_margin);
        nimMarginChangeBps = decimalRound(latest.nim_margin_pct.sub(first.nim_margin_pct).mul(100), 2);
        earliestDate = first.as_of_date;
        latestDate = latest.as_of_date;
    } else if (trends.length === 1) {
        earliestDate = latestDate = trends[0].as_of_date;
    }

    const isLoanComp = loanSpreadChange.lt(0);
    const isDepComp = depSpreadChange.lt(0);
    let headline;
    if (isLoanComp && isDepComp) headline = 'Severe Dual Margin Compression: Both lending and deposit margins contracted.';
    else if (isLoanComp) headline = `Lending Margin Compression: Loan spread narrowed by ${loanSpreadChange.abs().toFixed(1)} bps.`;
    else if (isDepComp) headline = `Deposit Margin Compression: Deposit spread narrowed by ${depSpreadChange.abs().toFixed(1)} bps.`;
    else if (loanSpreadChange.gt(0) || depSpreadChange.gt(0)) {
        const s = nimMarginChangeBps.gte(0) ? `+${nimMarginChangeBps.toFixed(1)}` : nimMarginChangeBps.toFixed(1);
        headline = `Margin Expansion: Net margin widened by ${s} bps.`;
    } else {
        headline = 'Margins Stable: Spreads and transfer pricing margins maintained across snapshot windows.';
    }

    return {
        trends,
        compression_summary: {
            earliest_date: earliestDate,
            latest_date: latestDate,
            loan_spread_change_bps: loanSpreadChange,
            deposit_spread_change_bps: depSpreadChange,
            nim_change_amount: nimChangeAmount,
            nim_margin_change_bps: nimMarginChangeBps,
            is_loan_margin_compressing: isLoanComp,
            is_deposit_margin_compressing: isDepComp,
            summary_headline: headline,
            interpretation: (trends.length >= 2 && earliestDate && latestDate)
                ? `Observation period from ${earliestDate} to ${latestDate}. Loan spread changed by ${loanSpreadChange.gte(0) ? '+' : ''}${loanSpreadChange.toFixed(1)} bps, deposit spread changed by ${depSpreadChange.gte(0) ? '+' : ''}${depSpreadChange.toFixed(1)} bps, and overall NIM margin moved by ${nimMarginChangeBps.gte(0) ? '+' : ''}${nimMarginChangeBps.toFixed(1)} bps.`
                : 'Single observation date available. Run calculations on additional as-of dates to track trends over time.',
        },
        chart_data: {
            dates: trends.map(t => t.as_of_date),
            loan_contract_rates: trends.map(t => t.avg_loan_contract_rate.toNumber() * 100),
            loan_ftp_rates: trends.map(t => t.avg_loan_ftp_rate.toNumber() * 100),
            loan_spreads_bps: trends.map(t => t.avg_loan_spread_bps.toNumber()),
            deposit_contract_rates: trends.map(t => t.avg_deposit_contract_rate.toNumber() * 100),
            deposit_ftp_rates: trends.map(t => t.avg_deposit_ftp_rate.toNumber() * 100),
            deposit_spreads_bps: trends.map(t => t.avg_deposit_spread_bps.toNumber()),
            nim_amounts: trends.map(t => t.net_interest_margin.toNumber()),
            nim_margins_pct: trends.map(t => t.nim_margin_pct.toNumber()),
        },
    };
}

// ============== Stress Testing & Yield Curve Shock ==============

export const STANDARD_STRESS_SCENARIOS = {
    parallel_up_100: { name: 'Parallel Up +100 bps', description: 'Standard +1.00% upward shift across all tenors', type: 'parallel', shift_bps: 100 },
    parallel_up_200: { name: 'Parallel Up +200 bps', description: 'Severe +2.00% upward shift across all tenors (Basel regulatory standard)', type: 'parallel', shift_bps: 200 },
    parallel_down_100: { name: 'Parallel Down -100 bps', description: 'Standard -1.00% downward shift across all tenors (floored at 1 bp)', type: 'parallel', shift_bps: -100 },
    parallel_down_200: { name: 'Parallel Down -200 bps', description: 'Severe -2.00% downward shift across all tenors (floored at 1 bp)', type: 'parallel', shift_bps: -200 },
    steepener: { name: 'Bear Steepener', description: 'Short tenors (<=1Y) drop -50 bps, intermediate unchanged, long tenors (>=5Y) rise +100 bps', type: 'non_parallel' },
    flattener: { name: 'Bull Flattener', description: 'Short tenors (<=1Y) rise +100 bps, intermediate +50 bps, long tenors (>=5Y) drop -50 bps', type: 'non_parallel' },
    short_twist: { name: 'Short-Rate Liquidity Twist', description: 'Short tenors (<=90d) spike +150 bps, intermediate/long tenors unchanged', type: 'non_parallel' },
};

export function getScenarioTenorShift(scenarioKey, tenorDays, customShiftBps = null) {
    if (scenarioKey === 'custom') {
        const bps = Dec.from(customShiftBps !== null && customShiftBps !== undefined ? customShiftBps : 100);
        return bps.div(10000);
    }
    if (scenarioKey === 'parallel_up_100') return Dec.from('0.010000');
    if (scenarioKey === 'parallel_up_200') return Dec.from('0.020000');
    if (scenarioKey === 'parallel_down_100') return Dec.from('-0.010000');
    if (scenarioKey === 'parallel_down_200') return Dec.from('-0.020000');
    if (scenarioKey === 'steepener') {
        if (tenorDays <= 365) return Dec.from('-0.005000');
        if (tenorDays <= 1095) return Dec.from('0.000000');
        if (tenorDays <= 1825) return Dec.from('0.005000');
        return Dec.from('0.010000');
    }
    if (scenarioKey === 'flattener') {
        if (tenorDays <= 365) return Dec.from('0.010000');
        if (tenorDays <= 1095) return Dec.from('0.005000');
        if (tenorDays <= 1825) return Dec.from('-0.002500');
        return Dec.from('-0.005000');
    }
    if (scenarioKey === 'short_twist') {
        if (tenorDays <= 90) return Dec.from('0.015000');
        if (tenorDays <= 180) return Dec.from('0.010000');
        if (tenorDays <= 365) return Dec.from('0.005000');
        return Dec.from('0.000000');
    }
    return Dec.from('0.010000');
}

export function simulateYieldCurveShock(
    state,
    { scenarioKey = 'parallel_up_100', customShiftBps = null, depositBeta = '0.40', curveName = 'SOFR' } = {}
) {
    const beta = Dec.from(depositBeta ?? '0.40');
    if (scenarioKey !== 'custom' && !(scenarioKey in STANDARD_STRESS_SCENARIOS)) {
        throw new Error(`Unknown stress scenario '${scenarioKey}'`);
    }
    if (beta.lt(0) || beta.gt(1)) throw new Error('deposit_beta must be between 0 and 1');
    let customBps = null;
    if (customShiftBps !== null && customShiftBps !== undefined && customShiftBps !== '') {
        customBps = Dec.from(customShiftBps);
        if (customBps.abs().gt(1000)) throw new Error('custom_shift_bps must be between -1000 and 1000');
    }

    const baseCurve = getCurveAsOf(state, curveName, todayIso());
    const basePoints = [...(baseCurve.points || [])].sort((a, b) => a.tenor_days - b.tenor_days);
    if (!basePoints.length) throw new Error(`Yield curve '${curveName}' has no curve points`);

    const shockedPoints = [];
    const pointsExport = [];
    for (const pt of basePoints) {
        const shift = getScenarioTenorShift(scenarioKey, pt.tenor_days, customBps);
        const shockedRate = dmax(Dec.from(pt.rate).add(shift), Dec.from('0.000100'));
        shockedPoints.push({ tenor_days: pt.tenor_days, rate: shockedRate });
        pointsExport.push({
            tenor_days: pt.tenor_days,
            baseline_rate: Dec.from(pt.rate).toNumber() * 100,
            shocked_rate: shockedRate.toNumber() * 100,
            shift_bps: shift.mul(10000).toNumber(),
        });
    }

    let baseIncome = ZERO, shockIncome = ZERO, baseLoanCost = ZERO, shockLoanCost = ZERO;
    let baseExpense = ZERO, shockExpense = ZERO, baseDepRev = ZERO, shockDepRev = ZERO;
    let totalLoanPrincipal = ZERO;

    for (const inst of state.instruments) {
        const p = Dec.from(inst.principal || 0);
        const cRate = Dec.from(inst.contract_rate || 0);
        const tDays = monthsToDays(inst.term_months);
        const rBase = linearInterpolate(tDays, basePoints);
        const rShock = linearInterpolate(tDays, shockedPoints);
        const curveShift = rShock.sub(rBase);

        const lockedBase = inst.locked_base_rate != null ? Dec.from(inst.locked_base_rate) : rBase;
        let pooled = false;
        let ftpBase;
        try {
            const bucket = getBucketForInstrument(state, inst);
            pooled = bucket.methodology === 'pooled';
            [, ftpBase] = calculateFtpRateWithBucket(lockedBase, bucket, inst.instrument_type, inst.ftp_spread_override);
        } catch {
            [, ftpBase] = calculateFtpRate(lockedBase, inst.instrument_type, inst.ftp_spread_override);
        }
        const ftpShock = pooled ? ftpBase : ftpBase.add(curveShift);
        const isLoan = String(inst.instrument_type).toLowerCase() === 'loan';

        if (isLoan) {
            totalLoanPrincipal = totalLoanPrincipal.add(p);
            const inc = p.mul(cRate);
            baseIncome = baseIncome.add(inc);
            shockIncome = shockIncome.add(inc);
            baseLoanCost = baseLoanCost.add(p.mul(ftpBase));
            shockLoanCost = shockLoanCost.add(p.mul(ftpShock));
        } else {
            const depRateShock = dmax(cRate.add(curveShift.mul(beta)), Dec.from('0.000100'));
            baseExpense = baseExpense.add(p.mul(cRate));
            shockExpense = shockExpense.add(p.mul(depRateShock));
            baseDepRev = baseDepRev.add(p.mul(ftpBase));
            shockDepRev = shockDepRev.add(p.mul(ftpShock));
        }
    }

    const baseNim = baseIncome.sub(baseLoanCost).add(baseDepRev.sub(baseExpense));
    const shockNim = shockIncome.sub(shockLoanCost).add(shockDepRev.sub(shockExpense));
    const deltaNim = shockNim.sub(baseNim);
    const deltaNimPct = !baseNim.isZero() ? decimalRound(deltaNim.div(baseNim).mul(100), 2) : ZERO;
    const deltaNimBps = totalLoanPrincipal.gt(0) ? decimalRound(deltaNim.div(totalLoanPrincipal).mul(10000), 2) : ZERO;

    const riskStatus = deltaNimPct.lte(-15) ? 'Breach' : deltaNimPct.lte(-10) ? 'Warning' : 'Within Tolerance';
    const scenInfo = STANDARD_STRESS_SCENARIOS[scenarioKey] || {
        name: customBps !== null ? `Custom Shock (${customBps.gte(0) ? '+' : ''}${customBps.toFixed(0)} bps)` : 'Custom Scenario',
        description: `User defined rate shift with ${(beta.toNumber() * 100).toFixed(0)}% deposit beta`,
    };

    return {
        scenario_key: scenarioKey,
        scenario_name: scenInfo.name,
        description: scenInfo.description,
        baseline_nim: decimalRound(baseNim, 2),
        shocked_nim: decimalRound(shockNim, 2),
        delta_nim_amount: decimalRound(deltaNim, 2),
        delta_nim_pct: deltaNimPct,
        delta_nim_bps: deltaNimBps,
        baseline_loan_cost: decimalRound(baseLoanCost, 2),
        shocked_loan_cost: decimalRound(shockLoanCost, 2),
        baseline_deposit_revenue: decimalRound(baseDepRev, 2),
        shocked_deposit_revenue: decimalRound(shockDepRev, 2),
        risk_status: riskStatus,
        shocked_curve_points: pointsExport,
    };
}

export function runAllStressScenarios(state, curveName = 'SOFR', depositBeta = '0.40') {
    return Object.keys(STANDARD_STRESS_SCENARIOS).map(key =>
        simulateYieldCurveShock(state, { scenarioKey: key, depositBeta, curveName })
    );
}
