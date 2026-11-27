/**
 * CSV and Excel import parser & strict validator.
 * Port of app/importer.py.
 */
import { Dec } from './decimal.js';

export const FIELD_MAPPINGS = {
    source_id: ['source_id', 'external_id', 'instrument_id', 'loan_id', 'loanid', 'loan_number', 'loan_number_', 'loan_num', 'account_id', 'accountid', 'account_number', 'id'],
    name: ['name', 'borrower_name', 'borrower', 'account_name', 'description', 'loan_name'],
    principal: ['principal', 'loan_amount', 'amount', 'balance', 'original_balance', 'face_amount', 'face_value'],
    rate: ['rate', 'interest_rate', 'contract_rate', 'apr', 'interest', 'coupon', 'yield'],
    term_months: ['term_months', 'termmonths', 'term', 'maturity_months', 'maturity', 'months', 'loan_term', 'term_years'],
    instrument_type: ['type', 'instrument_type', 'category', 'product_type', 'loan_type', 'account_type'],
    currency: ['currency', 'ccy', 'currency_code'],
    amortization_type: ['amortization', 'amort_type', 'payment_type', 'loan_structure'],
    cpr_percent: ['cpr', 'prepayment_rate', 'prepayment', 'cpr_percent'],
    start_date: ['start_date', 'origination_date', 'date', 'loan_date', 'effective_date'],
    rate_type: ['rate_type', 'pricing_type', 'fixed_floating', 'interest_type', 'rate_basis'],
    rate_index: ['rate_index', 'index', 'benchmark', 'benchmark_index', 'ref_rate', 'reference_rate'],
    reset_frequency_months: ['reset_frequency_months', 'reset_months', 'reset_freq', 'reset_frequency', 'repricing_months', 'repricing_freq'],
    index_spread_bps: ['index_spread_bps', 'spread_bps', 'customer_spread_bps', 'margin_bps', 'index_spread'],
};

export const REQUIRED_FIELDS = ['name', 'principal', 'rate', 'term_months', 'instrument_type'];
export const SUPPORTED_FIELDS = [
    'name', 'principal', 'rate', 'term_months', 'instrument_type',
    'source_id', 'amortization_type', 'cpr_percent', 'currency', 'start_date',
    'rate_type', 'rate_index', 'reset_frequency_months', 'index_spread_bps',
];

export class ImportValidationError extends Error {
    constructor(errors) {
        super(errors.map(e => `Row ${e.row}: ${e.error}`).join('; '));
        this.errors = errors;
    }
}

export function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\r') {
                if (src[i + 1] === '\n') i++;
                row.push(field); rows.push(row); row = []; field = '';
            } else if (ch === '\n') {
                row.push(field); rows.push(row); row = []; field = '';
            } else {
                field += ch;
            }
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

export function rowsToTable(rawRows) {
    if (!rawRows || !rawRows.length) return { columns: [], rows: [] };
    const seen = new Map();
    const columns = rawRows[0].map((col, idx) => {
        const base = String(col == null ? '' : col).trim() || `Column_${idx + 1}`;
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        return count === 0 ? base : `${base}.${count}`;
    });
    const rows = [];
    for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || !r.some(v => v != null && String(v).trim() !== '')) continue;
        const obj = {};
        for (let c = 0; c < columns.length; c++) {
            obj[columns[c]] = c < r.length ? r[c] : '';
        }
        rows.push(obj);
    }
    return { columns, rows };
}

export function findField(columnName) {
    const colLower = String(columnName || '').toLowerCase().trim();
    for (const [std, variants] of Object.entries(FIELD_MAPPINGS)) {
        if (variants.includes(colLower)) return std;
    }
    return null;
}

export function detectColumns(columns) {
    const detected = {};
    for (const col of columns) {
        const colName = String(col);
        const mapped = findField(colName);
        if (mapped) {
            if (mapped in detected) {
                throw new Error(`Multiple columns map to '${mapped}': ${detected[mapped]} and ${colName}`);
            }
            detected[mapped] = colName;
            continue;
        }
        const dupMatch = /^(.+)\.\d+$/.exec(colName);
        if (dupMatch) {
            const dupField = findField(dupMatch[1]);
            if (dupField && dupField in detected) {
                throw new Error(`Multiple columns map to '${dupField}': ${detected[dupField]} and ${colName}`);
            }
        }
    }
    return detected;
}

export function resolveColumns(columns, columnMapping = null) {
    let detected;
    try {
        detected = detectColumns(columns);
    } catch (err) {
        if (!columnMapping) throw err;
        detected = {};
    }
    if (columnMapping) {
        const avail = new Set(columns.map(String));
        for (const [field, sourceCol] of Object.entries(columnMapping)) {
            if (!SUPPORTED_FIELDS.includes(field)) throw new Error(`Unsupported mapped field: ${field}`);
            if (sourceCol && !avail.has(sourceCol)) throw new Error(`Mapped column '${sourceCol}' does not exist in this file`);
            if (sourceCol) detected[field] = sourceCol;
            else delete detected[field];
        }
        const reverse = {};
        for (const [field, sourceCol] of Object.entries(detected)) {
            if (reverse[sourceCol]) {
                throw new Error(`Column '${sourceCol}' is mapped to both '${reverse[sourceCol]}' and '${field}'`);
            }
            reverse[sourceCol] = field;
        }
    }
    return detected;
}

function valueText(val, field) {
    if (val === null || val === undefined) throw new Error(`${field} is required`);
    const text = String(val).trim();
    if (!text) throw new Error(`${field} is required`);
    return text;
}

export function normalizeRate(val) {
    let text = valueText(val, 'rate');
    const hasPct = text.endsWith('%');
    if (hasPct) text = text.slice(0, -1).trim();
    let rate;
    try { rate = Dec.from(text); } catch { throw new Error('rate must be a number'); }
    if (hasPct) rate = rate.div(100);
    else if (rate.abs().gte(1)) {
        throw new Error("rate values with absolute value of 1 or greater must include a '%' suffix");
    }
    return rate.round(6).toFixed(6);
}

export function normalizePrincipal(val) {
    const text = valueText(val, 'principal').replace(/[$,\s]/g, '');
    let amount;
    try { amount = Dec.from(text); } catch { throw new Error('principal must be a number'); }
    if (!amount.isPositive()) throw new Error('principal must be a positive finite amount');
    return amount.round(4).toFixed(4);
}

export function normalizeTerm(val, sourceCol = '') {
    const text = valueText(val, 'term');
    let term;
    try { term = Dec.from(text); } catch { throw new Error('term must be a number'); }
    if (!term.isPositive()) throw new Error('term must be positive and finite');
    if (sourceCol.toLowerCase().includes('year')) term = term.mul(12);
    const num = term.toNumber();
    if (!Number.isInteger(num)) throw new Error('term must resolve to a whole number of months');
    return num;
}

export function normalizeInstrumentType(val) {
    const v = valueText(val, 'instrument_type').toLowerCase();
    if (['loan', 'lending', 'asset', 'borrowing'].includes(v)) return 'loan';
    if (['deposit', 'saving', 'savings', 'checking', 'liability', 'funding'].includes(v)) return 'deposit';
    throw new Error('instrument_type must identify a loan or deposit');
}

export function normalizeCurrency(val) {
    const c = valueText(val, 'currency').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new Error('currency must be a three-letter ISO code');
    return c;
}

export function normalizeAmortizationType(val) {
    const v = valueText(val, 'amortization_type').toLowerCase().replace(/[-\s]+/g, '_');
    if (v.includes('amort')) return 'amortizing';
    if (v.includes('bullet')) return 'bullet';
    if (v.includes('interest') || v === 'io' || v === 'interest_only') return 'interest_only';
    throw new Error('amortization_type must be amortizing, bullet, or interest_only');
}

export function normalizeRateType(val) {
    const v = valueText(val, 'rate_type').toLowerCase().trim();
    if (['float', 'floating', 'variable', 'adjustable', 'arm'].includes(v)) return 'floating';
    if (['fixed', 'fix'].includes(v)) return 'fixed';
    throw new Error('rate_type must be fixed or floating');
}

export function normalizeResetMonths(val) {
    const raw = valueText(val, 'reset_frequency_months').toUpperCase().trim();
    const ym = /^(\d+)\s*(M|MO|MONTH|MONTHS|Y|YR|YEAR|YEARS)$/.exec(raw);
    if (ym) {
        const n = Number(ym[1]) * (ym[2].startsWith('Y') ? 12 : 1);
        if (!Number.isInteger(n) || n <= 0) throw new Error('reset_frequency_months must be a positive integer');
        return n;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error('reset_frequency_months must be a positive whole number of months');
    return n;
}

export function normalizeSpreadBps(val) {
    const text = valueText(val, 'index_spread_bps').replace(/bps/gi, '').trim();
    let bps;
    try { bps = Dec.from(text); } catch { throw new Error('index_spread_bps must be a number'); }
    if (bps.lt(-1000) || bps.gt(5000)) throw new Error('index_spread_bps must be between -1000 and 5000');
    return bps.round(2).toFixed(2);
}

export function normalizeDate(val) {
    if (val === null || val === undefined) return null;
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
        return val.toISOString().slice(0, 10);
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
        // Excel serial date
        const epoch = new Date(Date.UTC(1899, 11, 30));
        epoch.setUTCDate(epoch.getUTCDate() + Math.floor(val));
        return epoch.toISOString().slice(0, 10);
    }
    const text = String(val).trim();
    if (!text || ['nan', 'nat', 'none', 'null'].includes(text.toLowerCase())) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (iso) {
        const d = new Date(`${text}T00:00:00Z`);
        if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text) return text;
        throw new Error('date must be a valid date such as 2026-01-31');
    }
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (slash) {
        const mm = slash[1].padStart(2, '0');
        const dd = slash[2].padStart(2, '0');
        const yyyy = slash[3];
        const candidate = `${yyyy}-${mm}-${dd}`;
        const d = new Date(`${candidate}T00:00:00Z`);
        if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate) return candidate;
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) throw new Error('date must be a valid date such as 2026-01-31');
    return parsed.toISOString().slice(0, 10);
}

const GUIDANCE = {
    name: 'Provide a nonblank instrument name no longer than 100 characters.',
    principal: 'Use a positive amount, such as 250000 or 250,000.00.',
    rate: 'Use a decimal such as 0.055 or an explicit percentage such as 5.5%.',
    term_months: 'Provide a positive whole number of months; use a column headed with years to enter years.',
    instrument_type: 'Use loan or deposit.',
    currency: 'Use a three-letter currency code such as USD.',
    amortization_type: 'Use amortizing, bullet, or interest_only.',
    start_date: 'Use a date such as 2026-01-31.',
    cpr_percent: 'Provide a percentage from 0 to 100.',
    rate_type: 'Use fixed or floating.',
    rate_index: 'Use a benchmark curve name such as SOFR.',
    reset_frequency_months: 'Provide positive reset months (e.g., 1, 3, 6, 12 or 3M).',
    index_spread_bps: 'Provide customer spread over index in bps (e.g., 250).',
};

export function importRows(columns, rows, columnMapping = null) {
    const detected = resolveColumns(columns, columnMapping);
    const missing = REQUIRED_FIELDS.filter(f => {
        if (f in detected) return false;
        if (f === 'rate' && 'rate_type' in detected && 'index_spread_bps' in detected) return false;
        return true;
    });
    if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

    const records = [];
    const errors = [];

    rows.forEach((row, idx) => {
        const record = {};
        let currentField = null;
        let currentCol = null;
        let currentVal = null;
        try {
            for (const [field, sourceCol] of Object.entries(detected)) {
                currentField = field;
                currentCol = sourceCol;
                const val = row[sourceCol];
                currentVal = val;
                if (field === 'rate') {
                    if ((val === null || val === undefined || String(val).trim() === '') && 'rate_type' in detected && 'index_spread_bps' in detected) {
                        record.contract_rate = null;
                    } else {
                        record.contract_rate = normalizeRate(val);
                    }
                }
                else if (field === 'principal') record.principal = normalizePrincipal(val);
                else if (field === 'term_months') record.term_months = normalizeTerm(val, sourceCol);
                else if (field === 'instrument_type') record.instrument_type = normalizeInstrumentType(val);
                else if (field === 'amortization_type') record.amortization_type = normalizeAmortizationType(val);
                else if (field === 'currency') record.currency = normalizeCurrency(val);
                else if (field === 'start_date') record.origination_date = normalizeDate(val);
                else if (field === 'rate_type') {
                    record.rate_type = (val == null || String(val).trim() === '') ? 'fixed' : normalizeRateType(val);
                } else if (field === 'rate_index') {
                    const idxStr = val == null ? '' : String(val).trim().toUpperCase();
                    record.rate_index = idxStr || null;
                } else if (field === 'reset_frequency_months') {
                    record.reset_frequency_months = (val == null || String(val).trim() === '') ? null : normalizeResetMonths(val);
                } else if (field === 'index_spread_bps') {
                    record.index_spread_bps = (val == null || String(val).trim() === '') ? null : normalizeSpreadBps(val);
                } else if (field === 'cpr_percent') {
                    let t = valueText(val, 'cpr_percent');
                    if (t.endsWith('%')) t = t.slice(0, -1).trim();
                    const cpr = Dec.from(t);
                    if (cpr.lt(0) || cpr.gt(100)) throw new Error('cpr_percent must be between 0 and 100');
                    record.cpr_percent = cpr.round(2).toFixed(2);
                } else if (field === 'name') {
                    const n = valueText(val, 'name');
                    if (n.length > 100) throw new Error('name must be 100 characters or fewer');
                    record.name = n;
                } else if (field === 'source_id') {
                    const s = val == null ? '' : String(val).trim();
                    record.source_id = s ? s : null;
                }
            }
            if (!record.rate_type) record.rate_type = 'fixed';
            if (record.rate_type === 'floating') {
                if (!record.rate_index) record.rate_index = 'SOFR';
                if (!record.reset_frequency_months) record.reset_frequency_months = 3;
                if (record.contract_rate == null) {
                    if (record.index_spread_bps == null) {
                        currentField = 'rate';
                        throw new Error('rate or index_spread_bps is required for floating instruments');
                    }
                    record.contract_rate = '0.000000';
                }
            } else {
                if (record.contract_rate == null) {
                    currentField = 'rate';
                    throw new Error('rate is required');
                }
                record.rate_index = null;
                record.reset_frequency_months = null;
                record.index_spread_bps = null;
            }
            if (!record.amortization_type) {
                record.amortization_type = record.instrument_type === 'deposit' ? 'bullet' : 'amortizing';
            }
            if (record.cpr_percent === undefined) record.cpr_percent = '0.00';
            if (!record.currency) record.currency = 'USD';
            records.push(record);
        } catch (err) {
            errors.push({
                row: idx + 2,
                field: currentField,
                column: currentCol,
                value: currentVal == null ? '' : String(currentVal).slice(0, 200),
                error: err.message,
                guidance: GUIDANCE[currentField] || 'Review this value and the source column mapping.',
            });
        }
    });

    if (errors.length) throw new ImportValidationError(errors);
    return { records, detected };
}

export async function sha256Hex(arrayBuffer) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return `len-${arrayBuffer.byteLength}`;
}
