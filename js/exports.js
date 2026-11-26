/**
 * Client-side CSV, Excel (SheetJS), PowerPoint (PptxGenJS), Printable Report,
 * and JSON Backup exports.
 */
import { Dec, safeSpreadsheetCell } from './decimal.js';
import { money, pct, bps } from './alco.js';

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 500);
}

function csvCell(v) {
    const safe = safeSpreadsheetCell(v == null ? '' : String(v));
    if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
    return safe;
}

export function downloadCsv(filename, headers, rows) {
    const lines = [
        headers.map(csvCell).join(','),
        ...rows.map(r => r.map(csvCell).join(',')),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, filename);
}

export function exportPortfolioCsv(state) {
    const latestByInst = new Map();
    for (const r of state.ftp_results) {
        const prev = latestByInst.get(r.instrument_id);
        if (!prev || r.id > prev.id) latestByInst.set(r.instrument_id, r);
    }
    const bucketsById = new Map(state.buckets.map(b => [b.id, b]));
    const headers = [
        'ID', 'Source System', 'Source ID', 'Name', 'Type', 'Amortization', 'Currency',
        'Principal', 'Contract Rate', 'Term (Months)', 'Origination Date', 'CPR (%)',
        'Bucket', 'Base Rate', 'FTP Spread', 'FTP Rate', 'Interest Income/Expense',
        'FTP Cost/Revenue', 'Annualized Margin Contribution',
    ];
    const rows = state.instruments.map(inst => {
        const r = latestByInst.get(inst.id);
        const b = inst.bucket_id ? bucketsById.get(inst.bucket_id) : null;
        return [
            inst.id, inst.source_system || '', inst.source_id || '', inst.name,
            inst.instrument_type, inst.amortization_type, inst.currency,
            inst.principal, inst.contract_rate, inst.term_months, inst.origination_date,
            inst.cpr_percent ?? 0, b ? b.name : 'Default',
            r ? r.base_rate : '', r ? r.ftp_spread : '', r ? r.ftp_rate : '',
            r ? r.interest_income_expense : '', r ? r.ftp_cost_revenue : '',
            r ? r.net_interest_margin : '',
        ];
    });
    downloadCsv('ftp_portfolio_export.csv', headers, rows);
}

export function exportRunCsv(run, results, currency = null) {
    const ccy = currency ? currency.toUpperCase() : null;
    const insts = new Map((run.input_snapshot?.instruments || []).map(i => [Number(i.id), i]));
    const buckets = new Map((run.input_snapshot?.buckets || []).map(b => [Number(b.id), b]));
    const headers = [
        'Run ID', 'As-of Date', 'Instrument ID', 'Source ID', 'Name', 'Type', 'Currency',
        'Bucket', 'Principal', 'Contract Rate', 'Term (Months)', 'Base Rate',
        'FTP Spread', 'FTP Rate', 'Interest', 'FTP Cost/Revenue', 'Annualized Contribution',
    ];
    const rows = [];
    for (const r of results) {
        const inst = insts.get(Number(r.instrument_id));
        if (!inst) continue;
        const iccy = String(inst.currency || 'USD').toUpperCase();
        if (ccy && iccy !== ccy) continue;
        const b = inst.bucket_id ? buckets.get(Number(inst.bucket_id)) : null;
        rows.push([
            run.id, run.as_of_date, inst.id, inst.source_id || '', inst.name, inst.instrument_type,
            iccy, b ? b.name : 'Legacy Default', inst.principal, inst.contract_rate,
            inst.term_months, r.base_rate, r.ftp_spread, r.ftp_rate,
            r.interest_income_expense, r.ftp_cost_revenue, r.net_interest_margin,
        ]);
    }
    const suffix = ccy ? `_${ccy}` : '';
    downloadCsv(`ftp_run_${run.id}${suffix}.csv`, headers, rows);
}

export function exportAlcoAnalyticsCsv(pack) {
    const headers = ['Section', 'Group/Bucket', 'Type', 'Instruments', 'Balance', 'Weighted Customer Rate', 'Weighted FTP Rate', 'Margin (bps)', 'Annualized Contribution'];
    const rows = [];
    for (const r of pack.by_type) {
        rows.push(['By Type', r.label, r.instrument_type, r.instrument_count, r.balance.toFixed(2),
            r.weighted_customer_rate ? r.weighted_customer_rate.toFixed(6) : '',
            r.weighted_ftp_rate ? r.weighted_ftp_rate.toFixed(6) : '',
            r.margin ? Math.round(r.margin.toNumber() * 10000) : '',
            r.annualized_contribution.toFixed(2)]);
    }
    for (const r of pack.by_bucket) {
        rows.push(['By Bucket', r.label, r.instrument_type, r.instrument_count, r.balance.toFixed(2),
            r.weighted_customer_rate ? r.weighted_customer_rate.toFixed(6) : '',
            r.weighted_ftp_rate ? r.weighted_ftp_rate.toFixed(6) : '',
            r.margin ? Math.round(r.margin.toNumber() * 10000) : '',
            r.annualized_contribution.toFixed(2)]);
    }
    for (const r of pack.by_group) {
        rows.push([`Group (${r.dimension})`, r.label, r.instrument_type, r.instrument_count, r.balance.toFixed(2),
            r.weighted_customer_rate ? r.weighted_customer_rate.toFixed(6) : '',
            r.weighted_ftp_rate ? r.weighted_ftp_rate.toFixed(6) : '',
            r.margin ? Math.round(r.margin.toNumber() * 10000) : '',
            r.annualized_contribution.toFixed(2)]);
    }
    downloadCsv(`ftp_analytics_run_${pack.meta.run_id}_${pack.meta.currency}.csv`, headers, rows);
}

function getXlsx() {
    if (typeof window === 'undefined' || !window.XLSX) {
        throw new Error('SheetJS (XLSX) library failed to load. Check your network connection.');
    }
    return window.XLSX;
}

function getPptxGen() {
    if (typeof window === 'undefined' || !window.PptxGenJS) {
        throw new Error('PptxGenJS library failed to load. Check your network connection.');
    }
    return window.PptxGenJS;
}

const numVal = (v) => (v === null || v === undefined ? null : (v instanceof Dec ? v.toNumber() : Number(v)));
const bpsVal = (v) => (v === null || v === undefined ? null : Math.round(numVal(v) * 10000));

export function exportPortfolioExcel(state) {
    const XLSX = getXlsx();
    const latestByInst = new Map();
    for (const r of state.ftp_results) {
        const prev = latestByInst.get(r.instrument_id);
        if (!prev || r.id > prev.id) latestByInst.set(r.instrument_id, r);
    }
    const bucketsById = new Map(state.buckets.map(b => [b.id, b]));
    const aoa = [[
        'ID', 'Source ID', 'Name', 'Type', 'Amortization', 'Currency',
        'Principal', 'Contract Rate', 'Term (Months)', 'Origination Date',
        'Bucket', 'Base Rate', 'FTP Spread', 'FTP Rate', 'Interest', 'FTP Cost/Rev', 'Annualized Contribution',
    ]];
    for (const inst of state.instruments) {
        const r = latestByInst.get(inst.id);
        const b = inst.bucket_id ? bucketsById.get(inst.bucket_id) : null;
        aoa.push([
            inst.id, safeSpreadsheetCell(inst.source_id || ''), safeSpreadsheetCell(inst.name),
            inst.instrument_type, inst.amortization_type, inst.currency,
            Number(inst.principal), Number(inst.contract_rate), Number(inst.term_months),
            inst.origination_date, safeSpreadsheetCell(b ? b.name : 'Legacy Default'),
            r ? Number(r.base_rate) : null, r ? Number(r.ftp_spread) : null, r ? Number(r.ftp_rate) : null,
            r ? Number(r.interest_income_expense) : null, r ? Number(r.ftp_cost_revenue) : null,
            r ? Number(r.net_interest_margin) : null,
        ]);
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [8, 16, 28, 10, 14, 10, 16, 12, 12, 14, 22, 12, 12, 12, 16, 16, 20].map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio FTP');
    XLSX.writeFile(wb, 'ftp_portfolio_export.xlsx');
}

export function exportAlcoWorkbook(pack) {
    const XLSX = getXlsx();
    const wb = XLSX.utils.book_new();
    const meta = pack.meta;
    const banner = `DRAFT | Run #${meta.run_id} | As of ${meta.as_of_date} | ${meta.currency} | ${meta.pack_version}`;

    const addSheet = (name, heading, blocks, cols = []) => {
        const aoa = [[heading], [banner], []];
        for (const block of blocks) {
            if (block.title) aoa.push([safeSpreadsheetCell(block.title)]);
            if (block.headers) aoa.push(block.headers.map(safeSpreadsheetCell));
            for (const row of (block.rows || [])) {
                aoa.push(row.map(c => (c instanceof Dec ? c.toNumber() : safeSpreadsheetCell(c))));
            }
            if (block.rows && !block.rows.length) aoa.push(['No rows']);
            aoa.push([]);
        }
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        if (cols.length) ws['!cols'] = cols.map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    };

    const bs = pack.balance_sheet, c = pack.contribution, l = pack.ladder;
    addSheet('Summary', 'ALCO FTP PACK - DRAFT', [
        {
            headers: ['Item', 'Value'],
            rows: [
                ['Run', meta.run_id], ['As-of date', meta.as_of_date], ['Currency', meta.currency],
                ['Methodology', meta.methodology_version], ['Prepared by', meta.prepared_by],
                ['Comparison run', meta.compare_run_id || 'None'], ['Generated (UTC)', meta.generated_at],
                ['Coverage', `${pack.coverage.reported} of ${pack.coverage.expected} instruments`],
            ],
        },
        {
            headers: ['Key measure', 'Value'],
            rows: [
                ['Loan balance', bs.loan_balance], ['Deposit balance', bs.deposit_balance],
                ['Loan-to-deposit ratio', numVal(bs.loan_to_deposit)], ['Funding gap (loans - deposits)', bs.funding_gap],
                ['Loan contribution', c.loan_contribution], ['Deposit contribution', c.deposit_contribution],
                ['Treasury residual', c.treasury_residual], ['Total contribution', c.total],
                ['Customer net interest', c.customer_net_interest], ['Reconciliation difference', c.reconciliation_difference],
                ['Cumulative 12-month gap', l.one_year_gap], ['12-month gap / loans', numVal(l.one_year_gap_to_assets)],
            ],
        },
        {
            title: 'Observations',
            rows: pack.observations.map(note => [note]),
        },
    ], [42, 26]);

    addSheet('Balance & rates', 'Balance sheet, rates and FTP margins', [
        {
            headers: ['Measure', 'Loans', 'Deposits'],
            rows: [
                ['Balance', bs.loan_balance, bs.deposit_balance],
                ['Instruments', bs.loan_count, bs.deposit_count],
                ['Customer rate (weighted)', numVal(bs.loan_yield), numVal(bs.deposit_cost)],
                ['FTP rate (weighted)', numVal(bs.loan_ftp_rate), numVal(bs.deposit_ftp_rate)],
                ['Curve base rate (weighted)', numVal(bs.loan_base_rate), numVal(bs.deposit_base_rate)],
                ['FTP spread component (bps)', bpsVal(bs.loan_spread_component), bpsVal(bs.deposit_spread_component)],
                ['Margin over FTP (bps)', bpsVal(bs.loan_margin), bpsVal(bs.deposit_margin)],
                ['Weighted contractual term (months)', numVal(bs.loan_wal_months), numVal(bs.deposit_wal_months)],
            ],
        },
        {
            headers: ['Spread', 'Value (bps)'],
            rows: [
                ['Customer spread (loan yield - deposit cost)', bpsVal(bs.customer_spread)],
                ['Treasury spread (loan FTP - deposit FTP)', bpsVal(bs.treasury_spread)],
            ],
        },
    ], [42, 20, 20]);

    addSheet('Contribution', 'Contribution and Treasury reconciliation (annualized)', [{
        headers: ['Line', 'Amount'],
        rows: [
            ['Loan customer interest', c.loan_interest], ['Loan FTP charge', c.loan_ftp_charge],
            ['Loan contribution', c.loan_contribution], ['Deposit FTP credit', c.deposit_ftp_credit],
            ['Deposit customer interest', c.deposit_interest], ['Deposit contribution', c.deposit_contribution],
            ['Business-unit contribution', c.business_unit_contribution],
            ['Treasury residual', c.treasury_residual], ['Total contribution', c.total],
            ['Customer net interest', c.customer_net_interest],
            ['Reconciliation difference', c.reconciliation_difference],
        ],
    }], [40, 22]);

    addSheet('By bucket', 'Profitability by pricing bucket', [{
        headers: ['Pricing bucket', 'Type', 'Instruments', 'Balance', 'Customer rate', 'FTP rate', 'Margin (bps)', 'Contribution'],
        rows: pack.by_bucket.map(r => [r.label, r.instrument_type, r.instrument_count, r.balance, numVal(r.weighted_customer_rate), numVal(r.weighted_ftp_rate), bpsVal(r.margin), r.annualized_contribution]),
    }], [32, 12, 12, 18, 14, 14, 14, 18]);

    addSheet('By reporting group', 'Profitability by reporting group', [{
        headers: ['Dimension', 'Group', 'Type', 'Instruments', 'Balance', 'Customer rate', 'FTP rate', 'Margin (bps)', 'Contribution'],
        rows: pack.by_group.map(r => [r.dimension, r.label, r.instrument_type, r.instrument_count, r.balance, numVal(r.weighted_customer_rate), numVal(r.weighted_ftp_rate), bpsVal(r.margin), r.annualized_contribution]),
    }], [18, 30, 12, 12, 18, 14, 14, 14, 18]);

    addSheet('Maturity gap', 'Contractual maturity gap ladder', [{
        headers: ['Contractual term', 'Loans', 'Deposits', 'Gap', 'Cumulative gap', 'Gap / loans', 'Cumulative gap / loans', 'Cum. loans / deposits'],
        rows: l.rows.map(r => [r.label, r.assets, r.liabilities, r.gap, r.cumulative_gap, numVal(r.gap_to_assets), numVal(r.cumulative_gap_to_assets), numVal(r.cumulative_ratio)]),
    }], [18, 18, 18, 18, 18, 14, 18, 18]);

    addSheet('Rate sensitivity', 'Parallel rate shocks', [{
        headers: ['Shock (bps)', 'Loan contribution change', 'Deposit contribution change', 'Treasury change', '12-month earnings estimate', '% of base customer NII'],
        rows: pack.sensitivity.rows.map(r => [r.shock_bps, r.loan_contribution_delta, r.deposit_contribution_delta, r.treasury_delta, r.nii_12m_delta, numVal(r.nii_12m_pct)]),
    }], [14, 24, 24, 20, 24, 24]);

    const curveBlocks = pack.curves.length
        ? pack.curves.map(cv => ({
            title: `${cv.name} | effective ${cv.effective_date} | source ${cv.source} | ${cv.stale ? 'STALE' : 'current'}`,
            headers: ['Tenor', 'Tenor days', 'Rate', 'Comparison rate', 'Change (bps)'],
            rows: cv.points.map(p => [p.label, p.tenor_days, numVal(p.rate), numVal(p.prior_rate), bpsVal(p.change)]),
        }))
        : [{ rows: [['No curve was used in this run (pooled pricing only).']] }];
    addSheet('Yield curve', 'Reference curves used in this run', curveBlocks, [14, 14, 14, 16, 14]);

    const cmp = pack.comparison;
    const varBlocks = cmp ? [
        {
            headers: ['Driver', 'Loans', 'Deposits', 'Total'],
            rows: [
                [`Run #${cmp.run_id} (${cmp.as_of_date})`, cmp.bridge.sides.loan.start, cmp.bridge.sides.deposit.start, cmp.bridge.total.start],
                ...cmp.bridge.steps.map(s => [cmp.bridge.labels[s], cmp.bridge.sides.loan[s], cmp.bridge.sides.deposit[s], cmp.bridge.total[s]]),
                [`Run #${meta.run_id}`, cmp.bridge.sides.loan.end, cmp.bridge.sides.deposit.end, cmp.bridge.total.end],
                ['Unexplained (should be zero)', cmp.bridge.sides.loan.unexplained, cmp.bridge.sides.deposit.unexplained, cmp.bridge.total.unexplained],
            ],
        },
    ] : [{ rows: [['No comparison run was selected or it has no instruments in this currency.']] }];
    addSheet('Variance bridge', 'Business-unit contribution variance bridge', varBlocks, [34, 18, 18, 18]);

    addSheet('Concentration', 'Largest exposures', [
        {
            title: `Loans: HHI ${Math.round(pack.concentration.loan.hhi.toNumber())}`,
            headers: ['Name', 'Source ID', 'Bucket', 'Balance', 'Share', 'Customer rate', 'FTP rate', 'Contribution'],
            rows: pack.concentration.loan.top.map(r => [r.name, r.source_id, r.bucket, r.balance, numVal(r.share), numVal(r.customer_rate), numVal(r.ftp_rate), r.contribution]),
        },
        {
            title: `Deposits: HHI ${Math.round(pack.concentration.deposit.hhi.toNumber())}`,
            headers: ['Name', 'Source ID', 'Bucket', 'Balance', 'Share', 'Customer rate', 'FTP rate', 'Contribution'],
            rows: pack.concentration.deposit.top.map(r => [r.name, r.source_id, r.bucket, r.balance, numVal(r.share), numVal(r.customer_rate), numVal(r.ftp_rate), r.contribution]),
        },
    ], [32, 18, 24, 18, 10, 14, 14, 18]);

    addSheet('Pricing outliers', 'Instruments below FTP or within 25 bps of it', [{
        headers: ['Flag', 'Name', 'Source ID', 'Type', 'Bucket', 'Balance', 'Customer rate', 'FTP rate', 'Margin (bps)', 'Contribution'],
        rows: pack.outliers.map(r => [r.flag, r.name, r.source_id, r.type, r.bucket, r.balance, numVal(r.customer_rate), numVal(r.ftp_rate), bpsVal(r.margin), r.contribution]),
    }], [22, 30, 16, 10, 22, 16, 14, 12, 14, 16]);

    addSheet('Exceptions', 'Exceptions and data quality', [{
        headers: ['Severity', 'Area', 'Detail', 'Count', 'Balance', 'Owner', 'Resolution / acceptance'],
        rows: pack.exceptions.map(i => [i.severity, i.category, i.detail, i.count ?? '', i.balance ?? '', '', '']),
    }], [10, 16, 64, 10, 16, 18, 28]);

    addSheet('Actions', 'Decisions requested and action log', [{
        headers: ['#', 'Decision or action', 'Owner', 'Due date', 'Status', 'Linked section'],
        rows: Array.from({ length: 10 }, (_, idx) => [idx + 1, '', '', '', 'Open', '']),
    }], [6, 56, 20, 14, 12, 20]);

    addSheet('Definitions', 'Metric definitions and limitations', [
        { headers: ['Term', 'Definition'], rows: pack.definitions },
        { headers: ['Limitation'], rows: pack.limitations.map(l => [l]) },
    ], [34, 100]);

    XLSX.writeFile(wb, `alco_pack_run_${meta.run_id}_${meta.currency}.xlsx`);
}

export async function exportAlcoDeck(pack, audience = 'alco') {
    const PptxGenJS = getPptxGen();
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
    const meta = pack.meta;
    const ccy = meta.currency;
    const bs = pack.balance_sheet;
    const contrib = pack.contribution;
    const ladder = pack.ladder;
    const NAVY = '1D3557', BLUE = '2F6FB3', TEAL = '2A9D8F', AMBER = 'D98E04', RED = 'B42318', GRAY = '64748B', INK = '1F2937', LIGHT = 'F1F5F9';

    let pageNo = 0;
    const addChrome = (slide, title, sub = '') => {
        pageNo++;
        slide.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.55, fontSize: 24, bold: true, color: NAVY });
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.88, w: 1.2, h: 0.05, fill: { color: BLUE }, line: { transparency: 100 } });
        if (sub) slide.addText(sub, { x: 0.5, y: 0.96, w: 12.3, h: 0.35, fontSize: 13, color: GRAY });
        slide.addText('DRAFT - not approved for distribution', { x: 0.5, y: 7.05, w: 4, h: 0.3, fontSize: 9, bold: true, color: RED });
        slide.addText(`Run #${meta.run_id} | As of ${meta.as_of_date} | ${ccy} | ${meta.pack_version}`, { x: 4.2, y: 7.05, w: 6.5, h: 0.3, fontSize: 9, color: GRAY, align: 'center' });
        slide.addText(String(pageNo), { x: 11.8, y: 7.05, w: 1.0, h: 0.3, fontSize: 9, color: GRAY, align: 'right' });
    };

    const tblOpts = (colW, fontSize = 10) => ({
        colW, fontSize, border: { pt: 0.5, color: 'CBD5E1' }, valign: 'middle',
        autoPage: false,
    });
    const toTable = (headers, rows) => [
        headers.map(h => ({ text: String(h), options: { bold: true, fill: { color: NAVY }, color: 'FFFFFF' } })),
        ...rows.map((r, ri) => r.map((cell, ci) => ({
            text: cell == null ? '' : String(cell),
            options: { fill: { color: ri % 2 === 0 ? 'FFFFFF' : LIGHT }, color: INK, align: ci > 0 ? 'right' : 'left' },
        }))),
    ];

    // 1. Title
    {
        const s = pptx.addSlide();
        s.background = { color: NAVY };
        const heading = audience === 'alco' ? 'ASSET/LIABILITY COMMITTEE' : 'BOARD OF DIRECTORS';
        s.addText(heading, { x: 0.9, y: 2.0, w: 11, h: 0.5, fontSize: 16, bold: true, color: '9FC5E8' });
        s.addText('Funds Transfer Pricing and Balance Sheet Review', { x: 0.9, y: 2.6, w: 11.5, h: 1.1, fontSize: 38, bold: true, color: 'FFFFFF' });
        const cmpTxt = meta.compare_run_id ? ` | Compared with run #${meta.compare_run_id} (${meta.compare_as_of_date})` : '';
        s.addText(`As of ${meta.as_of_date} | ${ccy} | Run #${meta.run_id}${cmpTxt}`, { x: 0.9, y: 3.9, w: 11.5, h: 0.5, fontSize: 18, color: 'FFFFFF' });
        s.addText(`Prepared by ${meta.prepared_by} | Generated ${meta.generated_at} UTC | Methodology ${meta.methodology_version}`, { x: 0.9, y: 4.45, w: 11.5, h: 0.45, fontSize: 12, color: 'C8D6E5' });
        s.addText('DRAFT - for committee discussion; not approved for distribution', { x: 0.9, y: 6.3, w: 11.5, h: 0.45, fontSize: 13, bold: true, color: 'FCA5A5' });
    }

    // 2. Executive Summary
    {
        const s = pptx.addSlide();
        addChrome(s, 'Executive summary', 'Key balance sheet, pricing and risk measures for the covered portfolio');
        const tiles = [
            ['Loans', money(bs.loan_balance, ccy, true), `${bs.loan_count} inst. | yield ${pct(bs.loan_yield)}`, BLUE],
            ['Deposits', money(bs.deposit_balance, ccy, true), `${bs.deposit_count} inst. | cost ${pct(bs.deposit_cost)}`, TEAL],
            ['Loan-to-deposit', pct(bs.loan_to_deposit, 1), `Gap ${money(bs.funding_gap, ccy, true)}`, AMBER],
            ['Total contribution', money(contrib.total, ccy, true), 'Annualized, ties to NII', NAVY],
            ['Treasury residual', money(contrib.treasury_residual, ccy, true), `Spread ${bps(bs.treasury_spread, false)}`, GRAY],
            ['12-month gap', money(ladder.one_year_gap, ccy, true), `${pct(ladder.one_year_gap_to_assets, 1)} of loans`, ladder.one_year_gap.lt(0) ? RED : TEAL],
        ];
        const tileW = 1.9, gap = 0.18;
        tiles.forEach(([lbl, val, sub, accent], i) => {
            const x = 0.5 + i * (tileW + gap);
            s.addShape(pptx.ShapeType.rect, { x, y: 1.5, w: tileW, h: 1.15, fill: { color: LIGHT }, line: { transparency: 100 } });
            s.addShape(pptx.ShapeType.rect, { x, y: 1.5, w: 0.07, h: 1.15, fill: { color: accent }, line: { transparency: 100 } });
            s.addText(lbl, { x: x + 0.12, y: 1.56, w: tileW - 0.16, h: 0.25, fontSize: 10, color: GRAY });
            s.addText(val, { x: x + 0.12, y: 1.84, w: tileW - 0.16, h: 0.4, fontSize: 17, bold: true, color: NAVY });
            s.addText(sub, { x: x + 0.12, y: 2.28, w: tileW - 0.16, h: 0.28, fontSize: 9, color: GRAY });
        });
        s.addText('Observations', { x: 0.5, y: 2.9, w: 12, h: 0.35, fontSize: 15, bold: true, color: NAVY });
        s.addText(pack.observations.slice(0, 6).map(t => ({ text: t, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 3.3, w: 12.3, h: 3.4, fontSize: 12, color: INK, valign: 'top' });
    }

    // 3. Contribution
    {
        const s = pptx.addSlide();
        addChrome(s, 'Contribution and Treasury reconciliation', 'Business units and Treasury together earn the covered customer net interest');
        s.addChart(pptx.ChartType.bar, [{
            name: 'Contribution',
            labels: ['Loans', 'Deposits', 'Treasury residual', 'Total'],
            values: [numVal(contrib.loan_contribution), numVal(contrib.deposit_contribution), numVal(contrib.treasury_residual), numVal(contrib.total)],
        }], { x: 0.5, y: 1.45, w: 6.2, h: 4.9, barDir: 'col', chartColors: [BLUE], showLegend: false, showValue: true });
        s.addTable(toTable([`Annualized, ${ccy}`, 'Amount'], [
            ['Loan customer interest', money(contrib.loan_interest, ccy, false)],
            ['less loan FTP charge', money(contrib.loan_ftp_charge.neg(), ccy, false)],
            ['= Loan contribution', money(contrib.loan_contribution, ccy, false)],
            ['Deposit FTP credit', money(contrib.deposit_ftp_credit, ccy, false)],
            ['less deposit customer interest', money(contrib.deposit_interest.neg(), ccy, false)],
            ['= Deposit contribution', money(contrib.deposit_contribution, ccy, false)],
            ['Treasury residual (loan FTP - deposit FTP)', money(contrib.treasury_residual, ccy, false)],
            ['Total contribution', money(contrib.total, ccy, false)],
            ['Customer net interest (loans - deposits)', money(contrib.customer_net_interest, ccy, false)],
            ['Reconciliation difference', money(contrib.reconciliation_difference, ccy, false)],
        ]), { x: 7.0, y: 1.45, w: 5.8, ...tblOpts([3.9, 1.9], 10) });
    }

    // 4. ALCO balance & rates
    if (audience === 'alco') {
        const s = pptx.addSlide();
        addChrome(s, 'Balance sheet, rates and FTP margins', `Loan margin ${bps(bs.loan_margin)} and deposit margin ${bps(bs.deposit_margin)} over FTP`);
        s.addTable(toTable(['Measure', 'Loans', 'Deposits'], [
            ['Balance', money(bs.loan_balance, ccy, false), money(bs.deposit_balance, ccy, false)],
            ['Instruments', bs.loan_count, bs.deposit_count],
            ['Customer rate (weighted)', pct(bs.loan_yield, 3), pct(bs.deposit_cost, 3)],
            ['FTP rate (weighted)', pct(bs.loan_ftp_rate, 3), pct(bs.deposit_ftp_rate, 3)],
            ['Margin over FTP', bps(bs.loan_margin), bps(bs.deposit_margin)],
            ['Weighted contractual term', bs.loan_wal_months ? `${bs.loan_wal_months.toNumber().toFixed(1)} mo` : '-', bs.deposit_wal_months ? `${bs.deposit_wal_months.toNumber().toFixed(1)} mo` : '-'],
        ]), { x: 0.5, y: 1.45, w: 6.2, ...tblOpts([2.6, 1.8, 1.8], 10) });
        s.addChart(pptx.ChartType.bar, [
            { name: 'Customer rate %', labels: ['Loans', 'Deposits'], values: [bs.loan_yield ? bs.loan_yield.toNumber() * 100 : 0, bs.deposit_cost ? bs.deposit_cost.toNumber() * 100 : 0] },
            { name: 'FTP rate %', labels: ['Loans', 'Deposits'], values: [bs.loan_ftp_rate ? bs.loan_ftp_rate.toNumber() * 100 : 0, bs.deposit_ftp_rate ? bs.deposit_ftp_rate.toNumber() * 100 : 0] },
        ], { x: 7.0, y: 1.45, w: 5.8, h: 4.2, barDir: 'col', chartColors: [BLUE, AMBER], showLegend: true, legendPos: 'b' });
    }

    // 5. Ladder
    {
        const s = pptx.addSlide();
        addChrome(s, 'Maturity gap and funding profile', `Cumulative 12-month gap ${money(ladder.one_year_gap, ccy, true)} (${pct(ladder.one_year_gap_to_assets, 1)} of loans)`);
        const labels = ladder.rows.map(r => r.label);
        s.addChart(pptx.ChartType.bar, [
            { name: 'Loans', labels, values: ladder.rows.map(r => numVal(r.assets)) },
            { name: 'Deposits (-)', labels, values: ladder.rows.map(r => -numVal(r.liabilities)) },
            { name: 'Cumulative gap', labels, values: ladder.rows.map(r => numVal(r.cumulative_gap)) },
        ], { x: 0.5, y: 1.45, w: 6.5, h: 4.9, barDir: 'col', chartColors: [BLUE, TEAL, AMBER], showLegend: true, legendPos: 'b' });
        s.addTable(toTable(['Term', 'Loans', 'Deposits', 'Gap', 'Cum. gap'], ladder.rows.map(r => [
            r.label, money(r.assets, ccy, true), money(r.liabilities, ccy, true), money(r.gap, ccy, true), money(r.cumulative_gap, ccy, true),
        ])), { x: 7.2, y: 1.45, w: 5.6, ...tblOpts([1.3, 1.07, 1.07, 1.07, 1.09], 9.5) });
    }

    // 6. Sensitivity
    {
        const s = pptx.addSlide();
        addChrome(s, 'Interest rate sensitivity', 'Parallel shocks: FTP contribution transfer and illustrative 12-month earnings');
        const sens = pack.sensitivity;
        const labels = sens.rows.map(r => `${r.shock_bps >= 0 ? '+' : ''}${r.shock_bps} bps`);
        s.addChart(pptx.ChartType.bar, [
            { name: '12m earnings', labels, values: sens.rows.map(r => numVal(r.nii_12m_delta)) },
            { name: 'Shift to Treasury', labels, values: sens.rows.map(r => numVal(r.treasury_delta)) },
        ], { x: 0.5, y: 1.45, w: 5.8, h: 4.9, barDir: 'col', chartColors: [NAVY, AMBER], showLegend: true, legendPos: 'b' });
        s.addTable(toTable(['Shock', 'Loan contrib.', 'Dep. contrib.', 'Treasury', '12m NII'], sens.rows.map(r => [
            `${r.shock_bps >= 0 ? '+' : ''}${r.shock_bps}`, money(r.loan_contribution_delta, ccy, true),
            money(r.deposit_contribution_delta, ccy, true), money(r.treasury_delta, ccy, true), money(r.nii_12m_delta, ccy, true),
        ])), { x: 6.5, y: 1.45, w: 6.3, ...tblOpts([1.0, 1.35, 1.35, 1.3, 1.3], 9.5) });
    }

    // 7. Exceptions & Appendix
    {
        const s = pptx.addSlide();
        addChrome(s, 'Exceptions and data quality', 'Items to resolve or accept before the pack is approved');
        if (!pack.exceptions.length) {
            s.addText('No exceptions detected for this run and currency.', { x: 0.5, y: 1.6, w: 12, h: 0.5, fontSize: 14, color: INK });
        } else {
            s.addTable(toTable(['Severity', 'Area', 'Detail', 'Count', 'Balance'], pack.exceptions.slice(0, 10).map(i => [
                i.severity, i.category, i.detail, i.count ?? '-', i.balance != null ? money(i.balance, ccy, true) : '-',
            ])), { x: 0.5, y: 1.45, w: 12.3, ...tblOpts([1.1, 1.5, 7.2, 1.0, 1.5], 10) });
        }
    }

    {
        const s = pptx.addSlide();
        addChrome(s, 'Appendix: definitions, lineage and limitations');
        s.addText(pack.definitions.slice(0, 6).map(([t, d]) => ({ text: `${t}: ${d}`, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.35, w: 7.5, h: 5.2, fontSize: 9.5, color: INK, valign: 'top' });
        s.addText('Limitations', { x: 8.3, y: 1.35, w: 4.5, h: 0.35, fontSize: 12, bold: true, color: NAVY });
        s.addText(pack.limitations.map(l => ({ text: l, options: { bullet: true, breakLine: true } })), { x: 8.3, y: 1.75, w: 4.5, h: 3.5, fontSize: 9.5, color: GRAY, valign: 'top' });
    }

    await pptx.writeFile({ fileName: `${audience}_deck_run_${meta.run_id}_${ccy}.pptx` });
}

export function openPrintableReport(pack, audience = 'alco') {
    const meta = pack.meta;
    const ccy = meta.currency;
    const bs = pack.balance_sheet;
    const c = pack.contribution;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${audience.toUpperCase()} Report — Run #${meta.run_id}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;margin:2rem;line-height:1.45}
h1,h2{color:#1d3557} .banner{background:#fef3c7;color:#92400e;padding:.6rem 1rem;border-radius:6px;font-weight:700;margin-bottom:1rem}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.88rem}
th,td{border:1px solid #cbd5e1;padding:.45rem .6rem;text-align:left} th{background:#f1f5f9} .num{text-align:right;font-variant-numeric:tabular-nums}
@media print{.no-print{display:none}}
</style></head><body>
<div class="no-print" style="margin-bottom:1rem"><button onclick="window.print()" style="padding:.5rem 1rem;cursor:pointer">Print / Save as PDF</button></div>
<div class="banner">DRAFT — ${esc(audience.toUpperCase())} Report | Run #${meta.run_id} | As of ${esc(meta.as_of_date)} | ${esc(ccy)} | Coverage ${pack.coverage.reported}/${pack.coverage.expected}</div>
<h1>Funds Transfer Pricing — ${esc(audience.toUpperCase())} Report</h1>
<p>Prepared by ${esc(meta.prepared_by)} | Methodology ${esc(meta.methodology_version)}</p>
<h2>Key Observations</h2><ul>${pack.observations.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
<h2>Contribution &amp; Treasury Reconciliation</h2>
<table><thead><tr><th>Line</th><th class="num">Amount</th></tr></thead><tbody>
<tr><td>Loan customer interest</td><td class="num">${esc(money(c.loan_interest, ccy))}</td></tr>
<tr><td>Loan FTP charge</td><td class="num">${esc(money(c.loan_ftp_charge, ccy))}</td></tr>
<tr><td><strong>Loan contribution</strong></td><td class="num"><strong>${esc(money(c.loan_contribution, ccy))}</strong></td></tr>
<tr><td>Deposit FTP credit</td><td class="num">${esc(money(c.deposit_ftp_credit, ccy))}</td></tr>
<tr><td>Deposit customer interest</td><td class="num">${esc(money(c.deposit_interest, ccy))}</td></tr>
<tr><td><strong>Deposit contribution</strong></td><td class="num"><strong>${esc(money(c.deposit_contribution, ccy))}</strong></td></tr>
<tr><td>Treasury residual</td><td class="num">${esc(money(c.treasury_residual, ccy))}</td></tr>
<tr><td><strong>Total contribution (ties to customer net interest)</strong></td><td class="num"><strong>${esc(money(c.total, ccy))}</strong></td></tr>
</tbody></table>
<h2>Maturity Gap Ladder</h2>
<table><thead><tr><th>Term</th><th class="num">Loans</th><th class="num">Deposits</th><th class="num">Gap</th><th class="num">Cumulative Gap</th></tr></thead><tbody>
${pack.ladder.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${esc(money(r.assets, ccy))}</td><td class="num">${esc(money(r.liabilities, ccy))}</td><td class="num">${esc(money(r.gap, ccy))}</td><td class="num">${esc(money(r.cumulative_gap, ccy))}</td></tr>`).join('')}
</tbody></table>
<h2>Balance Sheet &amp; Rates</h2>
<table><thead><tr><th>Measure</th><th class="num">Loans</th><th class="num">Deposits</th></tr></thead><tbody>
<tr><td>Balance</td><td class="num">${esc(money(bs.loan_balance, ccy))}</td><td class="num">${esc(money(bs.deposit_balance, ccy))}</td></tr>
<tr><td>Customer Rate</td><td class="num">${esc(pct(bs.loan_yield, 3))}</td><td class="num">${esc(pct(bs.deposit_cost, 3))}</td></tr>
<tr><td>FTP Rate</td><td class="num">${esc(pct(bs.loan_ftp_rate, 3))}</td><td class="num">${esc(pct(bs.deposit_ftp_rate, 3))}</td></tr>
<tr><td>Margin over FTP</td><td class="num">${esc(bps(bs.loan_margin))}</td><td class="num">${esc(bps(bs.deposit_margin))}</td></tr>
</tbody></table>
<h2>Exceptions (${pack.exceptions.length})</h2>
<table><thead><tr><th>Severity</th><th>Area</th><th>Detail</th><th class="num">Count</th></tr></thead><tbody>
${pack.exceptions.map(e => `<tr><td>${esc(e.severity)}</td><td>${esc(e.category)}</td><td>${esc(e.detail)}</td><td class="num">${esc(e.count ?? '—')}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}
</tbody></table>
<h2>Limitations</h2><ul>${pack.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
</body></html>`;
    const win = window.open('', '_blank');
    if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
    } else {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
        triggerDownload(blob, `${audience}_report_run_${meta.run_id}_${ccy}.html`);
    }
}

export function exportBankJsonBackup(store) {
    const payload = {
        exported_at: new Date().toISOString(),
        mode: store.mode,
        data: store.state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `ftp_bank_backup_${store.mode}_${new Date().toISOString().slice(0, 10)}.json`);
}
