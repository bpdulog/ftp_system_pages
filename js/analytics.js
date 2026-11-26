/**
 * Run-scoped FTP reporting built only from frozen run inputs and results.
 * Port of app/analytics.py.
 */
import { Dec, ZERO } from './decimal.js';

function newTotals() {
    return {
        instrument_count: 0,
        balance: ZERO,
        customer_rate_balance: ZERO,
        ftp_rate_balance: ZERO,
        contribution: ZERO,
    };
}

function addTotal(totals, instrument, result) {
    const balance = Dec.from(instrument.principal || 0);
    totals.instrument_count += 1;
    totals.balance = totals.balance.add(balance);
    totals.customer_rate_balance = totals.customer_rate_balance.add(balance.mul(Dec.from(instrument.contract_rate || 0)));
    totals.ftp_rate_balance = totals.ftp_rate_balance.add(balance.mul(Dec.from(result.ftp_rate)));
    totals.contribution = totals.contribution.add(Dec.from(result.net_interest_margin));
}

function finish(key, totals, labels = {}) {
    const balance = totals.balance;
    return {
        key,
        ...labels,
        instrument_count: totals.instrument_count,
        balance,
        weighted_customer_rate: !balance.isZero() ? totals.customer_rate_balance.div(balance) : null,
        weighted_ftp_rate: !balance.isZero() ? totals.ftp_rate_balance.div(balance) : null,
        annualized_contribution: totals.contribution,
    };
}

export function runTotals(results, snapshot, currency) {
    const ccy = String(currency || 'USD').toUpperCase();
    const instruments = new Map();
    for (const row of (snapshot?.instruments || [])) {
        if (row && row.id != null) instruments.set(Number(row.id), row);
    }
    const totals = {
        instrument_count: 0,
        balance: ZERO,
        contribution: ZERO,
        loans: ZERO,
        deposits: ZERO,
        loan_count: 0,
        deposit_count: 0,
    };
    for (const result of results) {
        const item = instruments.get(Number(result.instrument_id));
        if (!item || String(item.currency || 'USD').toUpperCase() !== ccy) continue;
        totals.instrument_count += 1;
        const balance = Dec.from(item.principal || 0);
        totals.balance = totals.balance.add(balance);
        totals.contribution = totals.contribution.add(Dec.from(result.net_interest_margin));
        if (String(item.instrument_type || '').toLowerCase() === 'loan') {
            totals.loans = totals.loans.add(balance);
            totals.loan_count += 1;
        } else {
            totals.deposits = totals.deposits.add(balance);
            totals.deposit_count += 1;
        }
    }
    return totals;
}

export function summarizeRun(results, snapshot, currency) {
    const ccy = String(currency || 'USD').toUpperCase();
    const instruments = new Map();
    for (const row of (snapshot?.instruments || [])) {
        if (row && row.id != null) instruments.set(Number(row.id), row);
    }
    const buckets = new Map();
    for (const row of (snapshot?.buckets || [])) {
        if (row && row.id != null) buckets.set(Number(row.id), row);
    }

    const byBucket = new Map();
    const byGroup = new Map();
    const byType = new Map();
    const total = newTotals();
    const resultIds = new Set();
    const scopedIds = new Set();

    for (const [id, inst] of instruments.entries()) {
        if (String(inst.currency || 'USD').toUpperCase() === ccy) scopedIds.add(id);
    }

    const getOrCreate = (map, key, meta) => {
        if (!map.has(key)) map.set(key, { totals: newTotals(), meta });
        return map.get(key).totals;
    };

    for (const result of results) {
        const inst = instruments.get(Number(result.instrument_id));
        if (!inst || String(inst.currency || 'USD').toUpperCase() !== ccy) continue;
        resultIds.add(Number(result.instrument_id));
        addTotal(total, inst, result);

        const kind = String(inst.instrument_type || 'unknown').toLowerCase();
        addTotal(getOrCreate(byType, kind, { instrument_type: kind, label: kind.charAt(0).toUpperCase() + kind.slice(1) }), inst, result);

        const bucketId = inst.bucket_id != null ? Number(inst.bucket_id) : null;
        const bucket = bucketId != null ? buckets.get(bucketId) : null;
        const bucketName = bucket ? bucket.name : 'Unassigned';
        addTotal(
            getOrCreate(byBucket, `${bucketName}\0${kind}`, { instrument_type: kind, label: bucketName }),
            inst,
            result
        );

        const memberships = inst.reporting_groups || [];
        if (!memberships.length) {
            addTotal(
                getOrCreate(byGroup, `unassigned\0Unassigned\0${kind}`, { dimension: 'unassigned', instrument_type: kind, label: 'Unassigned' }),
                inst,
                result
            );
        } else {
            for (const m of memberships) {
                const dimension = String(m.dimension || 'other');
                const path = (m.path && m.path.length) ? m.path : [{ name: m.name || 'Unassigned' }];
                for (const node of path) {
                    const groupName = String(node.name || 'Unassigned');
                    addTotal(
                        getOrCreate(byGroup, `${dimension}\0${groupName}\0${kind}`, { dimension, instrument_type: kind, label: groupName }),
                        inst,
                        result
                    );
                }
            }
        }
    }

    return {
        currency: ccy,
        portfolio: {
            label: 'Portfolio',
            instrument_count: total.instrument_count,
            balance: total.balance,
            annualized_contribution: total.contribution,
        },
        by_instrument_type: [...byType.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => finish(k, v.totals, v.meta)),
        by_bucket: [...byBucket.values()]
            .sort((a, b) => a.meta.label.toLowerCase().localeCompare(b.meta.label.toLowerCase()) || a.meta.instrument_type.localeCompare(b.meta.instrument_type))
            .map(v => finish(`${v.meta.label}:${v.meta.instrument_type}`, v.totals, v.meta)),
        by_group: [...byGroup.values()]
            .sort((a, b) => a.meta.dimension.localeCompare(b.meta.dimension) || a.meta.label.toLowerCase().localeCompare(b.meta.label.toLowerCase()) || a.meta.instrument_type.localeCompare(b.meta.instrument_type))
            .map(v => finish(`${v.meta.dimension}:${v.meta.label}:${v.meta.instrument_type}`, v.totals, v.meta)),
        expected_instrument_count: scopedIds.size,
        reported_instrument_count: resultIds.size,
        missing_result_count: [...scopedIds].filter(id => !resultIds.has(id)).length,
    };
}
