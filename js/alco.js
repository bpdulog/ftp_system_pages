/**
 * ALCO, CFO and Treasurer analytics built only from frozen FTP runs.
 * Port of app/alco.py.
 */
import { Dec, ZERO, ONE_BP } from './decimal.js';
import { summarizeRun } from './analytics.js';

export const PACK_VERSION = 'alco-pack-v1';
export const SHOCKS_BPS = [-200, -100, 100, 200];
export const THIN_MARGIN = Dec.from('0.0025');
export const STALE_CURVE_DAYS = 35;
export const LADDER = [
    ['0-3 months', 0, 3],
    ['3-12 months', 3, 12],
    ['1-3 years', 12, 36],
    ['3-5 years', 36, 60],
    ['5-10 years', 60, 120],
    ['Over 10 years', 120, null],
];

export const DEFINITIONS = [
    ['Annualized FTP margin contribution',
     'Loans: balance x (customer rate - FTP rate). Deposits: balance x (FTP rate - customer rate). A run-date annualized simple-balance measure, not realized period income, accounting profit or bank NIM.'],
    ['Treasury residual',
     'Loan FTP charges less deposit FTP credits. Business-unit contribution plus the Treasury residual equals customer loan interest less deposit interest on the same covered population.'],
    ['Weighted rate', 'Sum of balance x rate divided by sum of balance, within one currency and population.'],
    ['Loan-to-deposit ratio', 'Covered loan balances divided by covered deposit balances in this run and currency.'],
    ['Maturity gap ladder',
     'Balances placed by contractual term in months as captured in the run. Remaining term, reset dates and behavioral maturities are not yet captured, so this is a contractual term profile, not a repricing schedule.'],
    ['FTP sensitivity',
     'Parallel shift of the curve base rate for matched-maturity instruments, all else fixed. Shows how contribution moves between business units and Treasury. Pooled rates are unaffected. Total bank result is unchanged.'],
    ['12-month repricing-gap earnings estimate',
     'Instruments whose contractual term ends within 12 months reprice at maturity with full pass-through of the shock for the rest of the year; balances are held constant; no prepayment, deposit beta or new business. Illustrative only and not a regulatory IRRBB or EVE measure.'],
    ['Variance bridge',
     'Sequential per-instrument bridge: balance effect (B1-B0) x m0, customer-rate effect B1 x s x (r1-r0), FTP-rate effect -B1 x s x (f1-f0), with s=+1 for loans and -1 for deposits. Entries add current contribution, exits remove prior contribution, rounding reconciles to stored results. Effects are order dependent.'],
    ['HHI', 'Herfindahl-Hirschman index of balance shares x 10,000 within a side of the balance sheet.'],
];

export const LIMITATIONS = [
    'Figures come from one frozen calculation run and one currency; unlike currencies are never added together.',
    'Contribution is annualized from run-date balances and rates; it is not period net interest income or accounting NIM.',
    'Economic value of equity (EVE), behavioral deposit models and prepayment-adjusted repricing are not produced.',
    'The pack is a DRAFT until independent review and approval controls are in place.',
];

function dec(v, def = '0') {
    if (v === null || v === undefined || v === '') return Dec.from(def);
    return Dec.from(v);
}

function ratio(num, den) {
    return !den.isZero() ? num.div(den) : null;
}

export function money(value, currency = '', compact = false) {
    if (value === null || value === undefined) return 'Unavailable';
    const d = Dec.from(value);
    const sign = d.isNegative() ? '-' : '';
    const num = d.abs().toNumber();
    const prefix = currency ? `${currency} ` : '';
    if (compact) {
        for (const [div, suf] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
            if (num >= div) {
                return `${sign}${prefix}${(num / div).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suf}`;
            }
        }
        return `${sign}${prefix}${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    }
    return `${sign}${prefix}${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function pct(value, digits = 2) {
    if (value === null || value === undefined) return 'Unavailable';
    const n = Dec.from(value).toNumber() * 100;
    return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function bps(value, signed = true) {
    if (value === null || value === undefined) return 'Unavailable';
    const pts = Math.round(Dec.from(value).div(ONE_BP).toNumber());
    const formatted = Math.abs(pts).toLocaleString('en-US');
    if (signed) {
        const s = pts >= 0 ? '+' : '-';
        return `${s}${formatted} bps`;
    }
    return `${pts < 0 ? '-' : ''}${formatted} bps`;
}

function instrumentKey(inst) {
    if (inst.source_system && inst.source_id) return `source:${inst.source_system}:${inst.source_id}`;
    return `id:${inst.id}`;
}

export function buildFacts(results, snapshot, currency) {
    const ccy = String(currency || 'USD').toUpperCase();
    const instruments = new Map();
    for (const row of (snapshot?.instruments || [])) {
        if (row && row.id != null) instruments.set(Number(row.id), row);
    }
    const bucketsById = new Map();
    const bucketsByName = new Map();
    for (const row of (snapshot?.buckets || [])) {
        if (row && row.id != null) {
            bucketsById.set(Number(row.id), row);
            bucketsByName.set(row.name, row);
        }
    }
    const scoped = new Set();
    for (const [id, row] of instruments.entries()) {
        if (String(row.currency || 'USD').toUpperCase() === ccy) scoped.add(id);
    }

    const facts = [];
    const seenIds = new Set();
    for (const result of results) {
        const instId = Number(result.instrument_id);
        const inst = instruments.get(instId);
        if (!inst || !scoped.has(instId)) continue;
        seenIds.add(instId);
        const kind = String(inst.instrument_type || '').toLowerCase();
        const bId = inst.bucket_id != null ? Number(inst.bucket_id) : null;
        const fallback = bId === null || !bucketsById.has(bId);
        const bucket = fallback
            ? (bucketsByName.get(kind === 'loan' ? 'Legacy Loans' : 'Legacy Deposits') || {})
            : bucketsById.get(bId);

        facts.push({
            key: instrumentKey(inst),
            instrument_id: instId,
            name: inst.name || `Instrument ${instId}`,
            source_id: inst.source_id || '',
            type: kind,
            sign: kind === 'loan' ? 1 : -1,
            balance: dec(inst.principal),
            customer_rate: dec(inst.contract_rate),
            ftp_rate: dec(result.ftp_rate),
            base_rate: dec(result.base_rate),
            spread: dec(result.ftp_spread),
            interest: dec(result.interest_income_expense),
            ftp_amount: dec(result.ftp_cost_revenue),
            contribution: dec(result.net_interest_margin),
            term_months: Number(inst.term_months || 0),
            rate_type: String(inst.rate_type || 'fixed').toLowerCase(),
            rate_index: inst.rate_index || null,
            reset_frequency_months: inst.reset_frequency_months != null ? Number(inst.reset_frequency_months) : null,
            index_spread_bps: inst.index_spread_bps ?? null,
            bucket: bucket.name || 'Unassigned',
            methodology: String(bucket.methodology || 'matched_maturity'),
            fallback_bucket: fallback,
            override: inst.ftp_spread_override !== null && inst.ftp_spread_override !== undefined && inst.ftp_spread_override !== '',
            grouped: Boolean(inst.reporting_groups && inst.reporting_groups.length),
            curve_id: result.yield_curve_id ?? null,
        });
    }
    return { facts, expected: scoped.size, missing: scoped.size - seenIds.size };
}

function side(facts, kind) { return facts.filter(f => f.type === kind); }
function sumDec(arr, fn) {
    let acc = ZERO;
    for (const x of arr) acc = acc.add(fn(x));
    return acc;
}
function weighted(facts, field) {
    const total = sumDec(facts, f => f.balance);
    return ratio(sumDec(facts, f => f.balance.mul(f[field])), total);
}

function balanceAndRates(facts) {
    const loans = side(facts, 'loan');
    const deposits = side(facts, 'deposit');
    const loanBal = sumDec(loans, f => f.balance);
    const depBal = sumDec(deposits, f => f.balance);
    const loanYield = weighted(loans, 'customer_rate');
    const loanFtp = weighted(loans, 'ftp_rate');
    const depCost = weighted(deposits, 'customer_rate');
    const depFtp = weighted(deposits, 'ftp_rate');
    const diff = (a, b) => (a !== null && b !== null ? a.sub(b) : null);
    const weightedTerm = (rows) => {
        const tot = sumDec(rows, f => f.balance);
        return ratio(sumDec(rows, f => f.balance.mul(f.term_months)), tot);
    };
    return {
        loan_balance: loanBal,
        deposit_balance: depBal,
        loan_count: loans.length,
        deposit_count: deposits.length,
        loan_to_deposit: ratio(loanBal, depBal),
        funding_gap: loanBal.sub(depBal),
        loan_yield: loanYield,
        loan_ftp_rate: loanFtp,
        loan_base_rate: weighted(loans, 'base_rate'),
        loan_spread_component: weighted(loans, 'spread'),
        loan_margin: diff(loanYield, loanFtp),
        deposit_cost: depCost,
        deposit_ftp_rate: depFtp,
        deposit_base_rate: weighted(deposits, 'base_rate'),
        deposit_spread_component: weighted(deposits, 'spread'),
        deposit_margin: diff(depFtp, depCost),
        customer_spread: diff(loanYield, depCost),
        treasury_spread: diff(loanFtp, depFtp),
        loan_wal_months: weightedTerm(loans),
        deposit_wal_months: weightedTerm(deposits),
    };
}

function contributionSection(facts) {
    const loans = side(facts, 'loan');
    const deposits = side(facts, 'deposit');
    const loanInt = sumDec(loans, f => f.interest);
    const loanFtp = sumDec(loans, f => f.ftp_amount);
    const loanCon = sumDec(loans, f => f.contribution);
    const depInt = sumDec(deposits, f => f.interest);
    const depFtp = sumDec(deposits, f => f.ftp_amount);
    const depCon = sumDec(deposits, f => f.contribution);
    const treasury = loanFtp.sub(depFtp);
    const businessUnits = loanCon.add(depCon);
    const customerNet = loanInt.sub(depInt);
    const total = businessUnits.add(treasury);
    return {
        loan_interest: loanInt,
        loan_ftp_charge: loanFtp,
        loan_contribution: loanCon,
        deposit_interest: depInt,
        deposit_ftp_credit: depFtp,
        deposit_contribution: depCon,
        business_unit_contribution: businessUnits,
        treasury_residual: treasury,
        total,
        customer_net_interest: customerNet,
        reconciliation_difference: total.sub(customerNet),
    };
}

function ladderSection(facts) {
    const totalAssets = sumDec(side(facts, 'loan'), f => f.balance);
    let cumulative = ZERO, cumAssets = ZERO, cumLiab = ZERO;
    const rows = LADDER.map(([label, low, high]) => {
        const members = facts.filter(f =>
            (f.term_months > low || (low === 0 && f.term_months >= 0)) &&
            (high === null || f.term_months <= high)
        );
        const assets = sumDec(members.filter(f => f.type === 'loan'), f => f.balance);
        const liabilities = sumDec(members.filter(f => f.type === 'deposit'), f => f.balance);
        const gap = assets.sub(liabilities);
        cumulative = cumulative.add(gap);
        cumAssets = cumAssets.add(assets);
        cumLiab = cumLiab.add(liabilities);
        return {
            label,
            assets,
            liabilities,
            gap,
            cumulative_gap: cumulative,
            gap_to_assets: ratio(gap, totalAssets),
            cumulative_gap_to_assets: ratio(cumulative, totalAssets),
            cumulative_ratio: ratio(cumAssets, cumLiab),
        };
    });
    const oneYear = rows[1].cumulative_gap;
    return { rows, one_year_gap: oneYear, one_year_gap_to_assets: ratio(oneYear, totalAssets) };
}

function effectiveRepricingMonths(f) {
    if (f.rate_type === 'floating') {
        const reset = f.reset_frequency_months && f.reset_frequency_months > 0 ? f.reset_frequency_months : 1;
        return Math.min(f.term_months || reset, reset);
    }
    return f.term_months;
}

function sensitivitySection(facts, baseNetInterest) {
    const curveLinked = facts.filter(f => f.methodology !== 'pooled');
    const repricing = facts.filter(f => {
        const m = effectiveRepricingMonths(f);
        return m > 0 && m <= 12;
    });
    const rows = SHOCKS_BPS.map(shock => {
        const move = Dec.from(shock).mul(ONE_BP);
        const loanDelta = sumDec(curveLinked.filter(f => f.type === 'loan' && f.rate_type !== 'floating'), f => f.balance.mul(move)).neg();
        const depDelta = sumDec(curveLinked.filter(f => f.type === 'deposit' && f.rate_type !== 'floating'), f => f.balance.mul(move));
        const niiDelta = sumDec(repricing, f =>
            Dec.from(f.sign).mul(f.balance).mul(move).mul(12 - effectiveRepricingMonths(f)).div(12)
        );
        return {
            shock_bps: shock,
            loan_contribution_delta: loanDelta,
            deposit_contribution_delta: depDelta,
            treasury_delta: loanDelta.add(depDelta).neg(),
            nii_12m_delta: niiDelta,
            nii_12m_pct: ratio(niiDelta, baseNetInterest.abs()),
        };
    });
    return {
        rows,
        curve_linked_count: curveLinked.length,
        pooled_count: facts.length - curveLinked.length,
        repricing_12m_count: repricing.length,
    };
}

function tenorLabel(days) {
    if (days < 30) return `${days}D`;
    if (days < 365) return `${Math.round(days / 30)}M`;
    return `${Math.round(days / 365)}Y`;
}

function daysBetween(startIso, endIso) {
    if (!startIso || !endIso) return null;
    const t1 = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
    const t2 = Date.parse(`${endIso.slice(0, 10)}T00:00:00Z`);
    return Math.round((t2 - t1) / 86400000);
}

function curvesSection(facts, snapshot, asOf, priorSnapshot) {
    const usedIds = new Set(facts.map(f => f.curve_id).filter(id => id != null));
    const priorByName = new Map();
    for (const c of (priorSnapshot?.yield_curves || [])) {
        if (!c || !c.name) continue;
        const pts = new Map();
        for (const p of (c.points || [])) pts.set(Number(p.tenor_days), dec(p.rate));
        priorByName.set(c.name, pts);
    }

    const curves = [];
    for (const curve of (snapshot?.yield_curves || [])) {
        if (!curve || curve.id == null || !usedIds.has(Number(curve.id))) continue;
        const eff = curve.effective_date || null;
        const age = eff ? daysBetween(eff, asOf) : null;
        const priorPts = priorByName.get(curve.name) || new Map();
        const points = (curve.points || []).map(p => {
            const tenor = Number(p.tenor_days);
            const rate = dec(p.rate);
            const priorRate = priorPts.has(tenor) ? priorPts.get(tenor) : null;
            return {
                tenor_days: tenor,
                label: tenorLabel(tenor),
                rate,
                prior_rate: priorRate,
                change: priorRate !== null ? rate.sub(priorRate) : null,
            };
        });
        curves.push({
            name: curve.name,
            effective_date: eff,
            source: curve.source || 'Not recorded',
            version: curve.version || 'Not recorded',
            age_days: age,
            stale: age === null || age > STALE_CURVE_DAYS || age < 0,
            points,
        });
    }
    return curves;
}

function concentrationSection(facts) {
    const out = {};
    for (const kind of ['loan', 'deposit']) {
        const rows = [...side(facts, kind)].sort((a, b) => b.balance.cmp(a.balance));
        const total = sumDec(rows, f => f.balance);
        const shares = rows.map(f => ratio(f.balance, total) || ZERO);
        out[kind] = {
            total,
            hhi: sumDec(shares, s => s.mul(s)).mul(10000),
            top_share: shares.length ? shares[0] : null,
            top10_share: shares.length ? sumDec(shares.slice(0, 10), s => s) : null,
            top: rows.slice(0, 10).map((f, idx) => ({
                name: f.name,
                source_id: f.source_id,
                balance: f.balance,
                share: shares[idx],
                customer_rate: f.customer_rate,
                ftp_rate: f.ftp_rate,
                contribution: f.contribution,
                bucket: f.bucket,
            })),
        };
    }
    return out;
}

function outliersSection(facts) {
    const rows = [];
    for (const f of facts) {
        const margin = Dec.from(f.sign).mul(f.customer_rate.sub(f.ftp_rate));
        if (f.contribution.lt(0) || margin.lt(THIN_MARGIN)) {
            rows.push({
                name: f.name,
                source_id: f.source_id,
                type: f.type,
                bucket: f.bucket,
                balance: f.balance,
                customer_rate: f.customer_rate,
                ftp_rate: f.ftp_rate,
                margin,
                contribution: f.contribution,
                flag: f.contribution.lt(0) ? 'Negative margin' : 'Thin margin (< 25 bps)',
            });
        }
    }
    return rows.sort((a, b) => a.contribution.cmp(b.contribution)).slice(0, 20);
}

function bridgeSection(current, prior) {
    const priorByKey = new Map(prior.map(f => [`${f.key}\0${f.type}`, f]));
    const currentByKey = new Map(current.map(f => [`${f.key}\0${f.type}`, f]));
    const steps = ['entries', 'exits', 'balance', 'customer_rate', 'ftp_rate', 'rounding'];
    const lines = { loan: {}, deposit: {} };
    for (const k of ['loan', 'deposit']) for (const s of steps) lines[k][s] = ZERO;

    let entryCount = 0, exitCount = 0;
    for (const [k, f] of currentByKey.entries()) {
        const line = lines[f.type];
        const old = priorByKey.get(k);
        if (!old) {
            line.entries = line.entries.add(f.contribution);
            entryCount++;
            continue;
        }
        const s = Dec.from(f.sign);
        const priorMargin = s.mul(old.customer_rate.sub(old.ftp_rate));
        const balEff = f.balance.sub(old.balance).mul(priorMargin);
        const rateEff = f.balance.mul(s).mul(f.customer_rate.sub(old.customer_rate));
        const ftpEff = f.balance.neg().mul(s).mul(f.ftp_rate.sub(old.ftp_rate));
        line.balance = line.balance.add(balEff);
        line.customer_rate = line.customer_rate.add(rateEff);
        line.ftp_rate = line.ftp_rate.add(ftpEff);
        line.rounding = line.rounding.add(f.contribution.sub(old.contribution).sub(balEff).sub(rateEff).sub(ftpEff));
    }
    for (const [k, old] of priorByKey.entries()) {
        if (!currentByKey.has(k)) {
            lines[old.type].exits = lines[old.type].exits.sub(old.contribution);
            exitCount++;
        }
    }

    const sides = {};
    for (const kind of ['loan', 'deposit']) {
        const start = sumDec(side(prior, kind), f => f.contribution);
        const end = sumDec(side(current, kind), f => f.contribution);
        const explained = sumDec(steps, s => lines[kind][s]);
        sides[kind] = { start, end, ...lines[kind], unexplained: end.sub(start).sub(explained) };
    }
    const total = {};
    for (const s of ['start', 'end', 'unexplained', ...steps]) {
        total[s] = sides.loan[s].add(sides.deposit[s]);
    }
    const labels = {
        entries: 'New instruments',
        exits: 'Matured or removed',
        balance: 'Balance change',
        customer_rate: 'Customer rate change',
        ftp_rate: 'FTP rate change',
        rounding: 'Rounding',
    };
    const drivers = steps
        .filter(s => s !== 'rounding' && !total[s].isZero())
        .map(s => [labels[s], total[s]])
        .sort((a, b) => b[1].abs().cmp(a[1].abs()));

    return {
        sides, total, labels, steps,
        entry_count: entryCount,
        exit_count: exitCount,
        drivers,
        reconciles: total.unexplained.isZero(),
    };
}

function exceptionsSection(facts, coverage, contribution, curves, comparisonAvailable) {
    const items = [];
    const add = (severity, category, detail, count = null, balance = null) =>
        items.push({ severity, category, detail, count, balance });

    if (coverage.missing) add('High', 'Coverage', 'Instruments in scope have no FTP result in this run.', coverage.missing);
    if (!contribution.reconciliation_difference.isZero()) {
        add('High', 'Reconciliation', 'Business-unit plus Treasury contribution does not equal customer net interest.', null, contribution.reconciliation_difference);
    }
    for (const c of curves) {
        if (c.stale) {
            const age = c.age_days !== null ? `${c.age_days} days old` : 'no effective date recorded';
            add('High', 'Market data', `Curve ${c.name} is ${age} at the run date (threshold ${STALE_CURVE_DAYS} days).`);
        }
    }
    const neg = facts.filter(f => f.contribution.lt(0));
    if (neg.length) add('Medium', 'Pricing', 'Instruments priced below FTP (negative contribution).', neg.length, sumDec(neg, f => f.balance));
    const fb = facts.filter(f => f.fallback_bucket);
    if (fb.length) add('Medium', 'Configuration', 'Instruments priced by a legacy fallback bucket instead of an explicit assignment.', fb.length, sumDec(fb, f => f.balance));
    const ov = facts.filter(f => f.override);
    if (ov.length) add('Medium', 'Overrides', 'Instrument-level FTP spread overrides in effect; confirm approval and expiry.', ov.length, sumDec(ov, f => f.balance));
    const ungrp = facts.filter(f => !f.grouped);
    if (ungrp.length) add('Low', 'Reporting', 'Instruments without a reporting-group assignment appear as Unassigned.', ungrp.length, sumDec(ungrp, f => f.balance));
    const pooled = facts.filter(f => f.methodology === 'pooled');
    if (pooled.length) add('Low', 'Methodology', 'Pooled-rate instruments do not respond to curve moves in FTP sensitivity.', pooled.length, sumDec(pooled, f => f.balance));
    if (!comparisonAvailable) add('Low', 'Comparison', 'No comparison run selected, so period-over-period variance is unavailable.');
    return items;
}

function observationsSection(pack) {
    const ccy = pack.meta.currency;
    const bs = pack.balance_sheet;
    const contrib = pack.contribution;
    const notes = [];
    const ldr = bs.loan_to_deposit !== null ? pct(bs.loan_to_deposit, 1) : 'unavailable (no deposits)';
    notes.push(`Covered loans of ${money(bs.loan_balance, ccy, true)} against deposits of ${money(bs.deposit_balance, ccy, true)}; loan-to-deposit ratio ${ldr}.`);
    notes.push(`Annualized FTP margin contribution: loans ${money(contrib.loan_contribution, ccy, true)}, deposits ${money(contrib.deposit_contribution, ccy, true)}, Treasury residual ${money(contrib.treasury_residual, ccy, true)}; total ties to customer net interest of ${money(contrib.customer_net_interest, ccy, true)}.`);
    if (bs.loan_margin !== null || bs.deposit_margin !== null) {
        notes.push(`Loan margin over FTP ${bps(bs.loan_margin)}; deposit margin over FTP ${bps(bs.deposit_margin)}; Treasury earns ${bps(bs.treasury_spread, false)} between loan FTP charges and deposit FTP credits.`);
    }
    const ladder = pack.ladder;
    if (ladder.one_year_gap_to_assets !== null) {
        const pos = ladder.one_year_gap.gt(0) ? 'asset-sensitive' : 'liability-sensitive';
        notes.push(`Cumulative 12-month contractual gap ${money(ladder.one_year_gap, ccy, true)} (${pct(ladder.one_year_gap_to_assets, 1)} of loans): ${pos} over one year.`);
    }
    const up = pack.sensitivity.rows.find(r => r.shock_bps === 100);
    if (up) {
        notes.push(`+100 bps: illustrative 12-month repricing-gap earnings change ${money(up.nii_12m_delta, ccy, true)}; FTP shifts ${money(up.treasury_delta, ccy, true)} of contribution to Treasury.`);
    }
    if (pack.comparison) {
        const t = pack.comparison.bridge.total;
        const change = t.end.sub(t.start);
        const drv = pack.comparison.bridge.drivers[0];
        const drvTxt = drv ? `; largest driver ${drv[0].toLowerCase()} (${money(drv[1], ccy, true)})` : '';
        notes.push(`Business-unit contribution changed ${money(change, ccy, true)} versus run #${pack.comparison.run_id}${drvTxt}.`);
    }
    const loans = pack.concentration.loan;
    if (loans.top_share !== null) {
        notes.push(`Largest loan is ${pct(loans.top_share, 1)} of loans; top ten are ${pct(loans.top10_share, 1)}.`);
    }
    if (pack.exceptions.length) {
        const high = pack.exceptions.filter(e => e.severity === 'High').length;
        notes.push(`${pack.exceptions.length} exception${pack.exceptions.length === 1 ? '' : 's'} logged (${high} high severity); see the exceptions section.`);
    }
    return notes;
}

function groupMargins(rows) {
    return rows.map(row => ({ ...row, margin: ratio(row.annualized_contribution, row.balance) }));
}

export function runCurrencies(run) {
    const set = new Set();
    for (const item of (run?.input_snapshot?.instruments || [])) {
        if (item && typeof item === 'object') set.add(String(item.currency || 'USD').toUpperCase());
    }
    return [...set].sort();
}

export function buildAlcoPack(run, results, currency, priorRun = null, priorResults = []) {
    const ccy = String(currency || 'USD').toUpperCase();
    const snapshot = run.input_snapshot || {};
    const coverage = buildFacts(results, snapshot, ccy);
    const facts = coverage.facts;
    const summary = summarizeRun(results, snapshot, ccy);
    const contribution = contributionSection(facts);

    let comparison = null;
    if (priorRun) {
        const priorCov = buildFacts(priorResults, priorRun.input_snapshot || {}, ccy);
        if (priorCov.facts.length) {
            comparison = {
                run_id: priorRun.id,
                as_of_date: priorRun.as_of_date,
                methodology_version: priorRun.methodology_version,
                methodology_changed: priorRun.methodology_version !== run.methodology_version,
                balance_sheet: balanceAndRates(priorCov.facts),
                contribution: contributionSection(priorCov.facts),
                bridge: bridgeSection(facts, priorCov.facts),
            };
        }
    }

    const curves = curvesSection(facts, snapshot, run.as_of_date, comparison ? priorRun.input_snapshot : null);
    const pack = {
        meta: {
            pack_version: PACK_VERSION,
            status: 'DRAFT',
            run_id: run.id,
            as_of_date: run.as_of_date,
            currency: ccy,
            methodology_version: run.methodology_version,
            prepared_by: run.actor,
            generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
            compare_run_id: comparison ? comparison.run_id : null,
            compare_as_of_date: comparison ? comparison.as_of_date : null,
        },
        coverage: { expected: coverage.expected, reported: facts.length, missing: coverage.missing },
        balance_sheet: balanceAndRates(facts),
        contribution,
        ladder: ladderSection(facts),
        sensitivity: sensitivitySection(facts, contribution.customer_net_interest),
        curves,
        concentration: concentrationSection(facts),
        outliers: outliersSection(facts),
        by_bucket: groupMargins(summary.by_bucket),
        by_group: groupMargins(summary.by_group),
        by_type: groupMargins(summary.by_instrument_type),
        comparison,
        definitions: DEFINITIONS,
        limitations: LIMITATIONS,
    };
    pack.exceptions = exceptionsSection(facts, coverage, contribution, curves, comparison !== null);
    pack.observations = observationsSection(pack);
    return pack;
}

export function chartPayload(pack) {
    const f = v => (v !== null && v !== undefined ? Dec.from(v).toNumber() : null);
    const curve = pack.curves[0] || null;
    return {
        ladder: {
            labels: pack.ladder.rows.map(r => r.label),
            assets: pack.ladder.rows.map(r => f(r.assets)),
            liabilities: pack.ladder.rows.map(r => -f(r.liabilities)),
            cumulative: pack.ladder.rows.map(r => f(r.cumulative_gap)),
        },
        sensitivity: {
            labels: pack.sensitivity.rows.map(r => `${r.shock_bps >= 0 ? '+' : ''}${r.shock_bps} bps`),
            nii: pack.sensitivity.rows.map(r => f(r.nii_12m_delta)),
            treasury: pack.sensitivity.rows.map(r => f(r.treasury_delta)),
        },
        curve: {
            name: curve ? curve.name : null,
            labels: curve ? curve.points.map(p => p.label) : [],
            rates: curve ? curve.points.map(p => f(p.rate) * 100) : [],
            prior: curve ? curve.points.map(p => (p.prior_rate !== null ? f(p.prior_rate) * 100 : null)) : [],
        },
        buckets: {
            labels: pack.by_bucket.map(r => `${r.label} (${r.instrument_type})`),
            contribution: pack.by_bucket.map(r => f(r.annualized_contribution)),
        },
        contribution: {
            labels: ['Loans', 'Deposits', 'Treasury residual'],
            values: [
                f(pack.contribution.loan_contribution),
                f(pack.contribution.deposit_contribution),
                f(pack.contribution.treasury_residual),
            ],
        },
    };
}
