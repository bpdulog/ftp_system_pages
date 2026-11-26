/**
 * Isolated, deterministic sample bank used by the Sample Bank mode.
 * Port of app/demo.py.
 */
import { calculateAllFtp, deriveSyntheticSofrCurve } from './engine.js';

const DEMO_CURVE_VERSION = 'demo-2';

export async function initializeDemoBank(store) {
    const state = store.state;
    const hasCurrentDemo = state.instruments.length > 0
        && state.calculation_runs.some(r => r.run_type === 'ftp' && r.status === 'completed')
        && state.yield_curves.some(c => c.name === 'SOFR' && c.version === DEMO_CURVE_VERSION);
    if (hasCurrentDemo) {
        return state;
    }
    await store.reset(true);
    const s = store.state;
    const now = new Date().toISOString();

    const treasuryCurve = {
        id: store.nextId('yield_curves'),
        name: 'TREASURY',
        description: 'Synthetic training U.S. Treasury CMT curve for the fictional sample bank',
        effective_date: '2025-01-31',
        source: 'Synthetic sample fixture',
        version: DEMO_CURVE_VERSION,
        basis_adjustment_bps: '0.00',
        derived_from_curve_id: null,
        created_at: now,
        points: [
            { tenor_days: 1, rate: '0.042000' },
            { tenor_days: 90, rate: '0.040500' },
            { tenor_days: 365, rate: '0.038000' },
            { tenor_days: 1095, rate: '0.035500' },
            { tenor_days: 1825, rate: '0.035000' },
            { tenor_days: 3650, rate: '0.036500' },
        ],
    };
    s.yield_curves.push(treasuryCurve);

    const curve = await deriveSyntheticSofrCurve(store, {
        treasuryCurveId: treasuryCurve.id,
        basisAdjustmentBps: '10.0',
        effectiveDate: '2025-01-31',
        curveName: 'SOFR',
        description: 'Synthetic SOFR derived from Sample Bank Treasury (2025-01-31) with +10.0 bps fixed basis adjustment',
    });
    curve.version = DEMO_CURVE_VERSION;

    const loanBucket = {
        id: store.nextId('buckets'),
        name: 'Sample Bank Loans',
        description: 'Synthetic training bucket for loan assets',
        methodology: 'matched_maturity',
        parameters: { spread_bps: 20 },
        yield_curve_id: curve.id,
        active: true,
        created_at: now,
        updated_at: now,
    };
    const depBucket = {
        id: store.nextId('buckets'),
        name: 'Sample Bank Term Deposits',
        description: 'Synthetic training bucket for term funding liabilities',
        methodology: 'matched_maturity',
        parameters: { spread_bps: -5 },
        yield_curve_id: curve.id,
        active: true,
        created_at: now,
        updated_at: now,
    };
    s.buckets.push(loanBucket, depBucket);

    const fixtures = [
        ['SAMPLE-LOAN-001', 'CRE Portfolio Term Loan', 'loan', 'amortizing', '4250000', '0.068000', 120, 'USD', '2.00', loanBucket.id],
        ['SAMPLE-LOAN-002', 'Commercial Equipment Finance', 'loan', 'amortizing', '1850000', '0.074000', 60, 'USD', '1.50', loanBucket.id],
        ['SAMPLE-LOAN-003', 'Mid-Market Working Capital Loan', 'loan', 'bullet', '3200000', '0.071500', 36, 'USD', '0.00', loanBucket.id],
        ['SAMPLE-LOAN-004', 'Multifamily Mortgage Loan', 'loan', 'amortizing', '6800000', '0.061000', 240, 'USD', '3.00', loanBucket.id],
        ['SAMPLE-LOAN-005', 'Small Business Term Loan', 'loan', 'amortizing', '875000', '0.079000', 48, 'USD', '0.50', loanBucket.id],
        ['SAMPLE-LOAN-006', 'Commercial Real Estate Loan B', 'loan', 'interest_only', '5100000', '0.064500', 84, 'USD', '1.00', loanBucket.id],
        ['SAMPLE-DEP-001', '12 Month Business CD', 'deposit', 'bullet', '1250000', '0.041000', 12, 'USD', '0.00', depBucket.id],
        ['SAMPLE-DEP-002', '24 Month Retail CD', 'deposit', 'bullet', '925000', '0.038500', 24, 'USD', '0.00', depBucket.id],
        ['SAMPLE-DEP-003', '36 Month Institutional CD', 'deposit', 'bullet', '2750000', '0.037000', 36, 'USD', '0.00', depBucket.id],
        ['SAMPLE-DEP-004', '6 Month Business CD', 'deposit', 'bullet', '640000', '0.042500', 6, 'USD', '0.00', depBucket.id],
        ['SAMPLE-DEP-005', '18 Month Retail CD', 'deposit', 'bullet', '1580000', '0.039500', 18, 'USD', '0.00', depBucket.id],
        ['SAMPLE-DEP-006', '48 Month Institutional CD', 'deposit', 'bullet', '2150000', '0.036500', 48, 'USD', '0.00', depBucket.id],
        ['SAMPLE-DEP-007', '60 Month Premium CD', 'deposit', 'bullet', '1400000', '0.049000', 60, 'USD', '0.00', depBucket.id],
    ];

    const instBySource = new Map();
    for (const [sourceId, name, kind, amort, principal, rate, term, currency, cpr, bucketId] of fixtures) {
        const inst = {
            id: store.nextId('instruments'),
            name,
            instrument_type: kind,
            amortization_type: amort,
            principal,
            contract_rate: rate,
            term_months: term,
            currency,
            cpr_percent: cpr,
            origination_date: '2025-01-31',
            source_system: 'sample-bank-v1',
            source_id: sourceId,
            import_batch_id: null,
            ftp_spread_override: null,
            cpr_percent_override: null,
            locked_yield_curve_id: null,
            locked_base_rate: null,
            locked_ftp_spread: null,
            locked_ftp_rate: null,
            locked_at: null,
            bucket_id: bucketId,
            created_at: now,
        };
        s.instruments.push(inst);
        instBySource.set(sourceId, inst);
    }

    const groupSeed = [
        ['legal_entity', 'Sample Bank NA', null],
        ['business_line', 'Commercial Banking', null],
        ['business_line', 'Retail Banking', null],
        ['business_line', 'Treasury', null],
        ['branch', 'Downtown', null],
        ['branch', 'Northwest', null],
        ['product', 'Commercial Real Estate', null],
        ['product', 'Commercial & Industrial', null],
        ['product', 'Small Business', null],
        ['product', 'Consumer Term Deposits', null],
    ];
    const groupsByKey = new Map();
    for (const [dimension, name, parentId] of groupSeed) {
        const g = {
            id: store.nextId('reporting_groups'),
            name,
            dimension,
            description: null,
            parent_id: parentId,
            active: true,
            created_at: now,
        };
        s.reporting_groups.push(g);
        groupsByKey.set(`${dimension}:${name}`, g);
    }

    const assign = (sourceId, dims) => {
        const inst = instBySource.get(sourceId);
        if (!inst) return;
        for (const [dim, gName] of Object.entries(dims)) {
            const g = groupsByKey.get(`${dim}:${gName}`);
            if (!g) continue;
            s.group_memberships.push({
                id: store.nextId('group_memberships'),
                instrument_id: inst.id,
                group_id: g.id,
                dimension: dim,
                assigned_at: now,
            });
        }
    };

    for (const row of fixtures) assign(row[0], { legal_entity: 'Sample Bank NA' });
    assign('SAMPLE-LOAN-001', { business_line: 'Commercial Banking', branch: 'Downtown', product: 'Commercial Real Estate' });
    assign('SAMPLE-LOAN-002', { business_line: 'Commercial Banking', branch: 'Downtown', product: 'Commercial & Industrial' });
    assign('SAMPLE-LOAN-003', { business_line: 'Commercial Banking', branch: 'Northwest', product: 'Commercial & Industrial' });
    assign('SAMPLE-LOAN-004', { business_line: 'Retail Banking', branch: 'Northwest', product: 'Commercial Real Estate' });
    assign('SAMPLE-LOAN-005', { business_line: 'Retail Banking', branch: 'Downtown', product: 'Small Business' });
    assign('SAMPLE-LOAN-006', { business_line: 'Commercial Banking', branch: 'Downtown', product: 'Commercial Real Estate' });
    for (const id of ['SAMPLE-DEP-001', 'SAMPLE-DEP-002', 'SAMPLE-DEP-004', 'SAMPLE-DEP-007']) {
        assign(id, { business_line: 'Retail Banking', branch: 'Downtown', product: 'Consumer Term Deposits' });
    }
    assign('SAMPLE-DEP-005', { business_line: 'Retail Banking', branch: 'Northwest', product: 'Consumer Term Deposits' });
    for (const id of ['SAMPLE-DEP-003', 'SAMPLE-DEP-006']) {
        assign(id, { business_line: 'Treasury', branch: 'Downtown', product: 'Consumer Term Deposits' });
    }

    await calculateAllFtp(store, 'SOFR', '2025-01-31', 'sample-bank-demo');
    return store.state;
}
