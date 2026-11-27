/**
 * Browser persistence layer for Open ALCO (GitHub Pages Edition).
 * Uses IndexedDB with an in-memory mirror and localStorage fallback so
 * Live Bank and Sample Bank stay completely isolated.
 */

const DB_NAME = 'ftp_system_pages_db';
const DB_VERSION = 1;
const STORE_NAME = 'banks';
const MODE_KEY = 'ftp_pages_bank_mode';

function defaultBankState() {
    return {
        version: 7,
        nextIds: {
            instruments: 1,
            buckets: 1,
            yield_curves: 1,
            calculation_runs: 1,
            ftp_results: 1,
            cash_flows: 1,
            reporting_groups: 1,
            group_memberships: 1,
            import_batches: 1,
        },
        instruments: [],
        buckets: [],
        yield_curves: [],
        calculation_runs: [],
        ftp_results: [],
        cash_flows: [],
        reporting_groups: [],
        group_memberships: [],
        import_batches: [],
        saved_mappings: {},
    };
}

function ensureLegacyBuckets(state) {
    const hasLoans = state.buckets.some(b => b.name === 'Legacy Loans');
    const hasDeposits = state.buckets.some(b => b.name === 'Legacy Deposits');
    const now = new Date().toISOString();
    if (!hasLoans) {
        state.buckets.push({
            id: state.nextIds.buckets++,
            name: 'Legacy Loans',
            description: 'Default matched-maturity loan bucket (+20 bps)',
            methodology: 'matched_maturity',
            parameters: { spread_bps: 20 },
            yield_curve_id: null,
            active: true,
            created_at: now,
            updated_at: now,
        });
    }
    if (!hasDeposits) {
        state.buckets.push({
            id: state.nextIds.buckets++,
            name: 'Legacy Deposits',
            description: 'Default matched-maturity deposit bucket (-5 bps)',
            methodology: 'matched_maturity',
            parameters: { spread_bps: -5 },
            yield_curve_id: null,
            active: true,
            created_at: now,
            updated_at: now,
        });
    }
}

function openIdb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function idbGet(db, key) {
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function idbPut(db, key, val) {
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(val, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch {
            resolve(false);
        }
    });
}

export class BankStore {
    constructor(mode = 'live') {
        this.mode = mode === 'demo' ? 'demo' : 'live';
        this.state = defaultBankState();
        ensureLegacyBuckets(this.state);
        this._idb = null;
        this._listeners = new Set();
    }

    static getSavedMode() {
        try {
            return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'live';
        } catch {
            return 'live';
        }
    }

    static setSavedMode(mode) {
        try {
            localStorage.setItem(MODE_KEY, mode === 'demo' ? 'demo' : 'live');
        } catch {
            // ignore in headless/node
        }
    }

    async load(mode = this.mode) {
        this.mode = mode === 'demo' ? 'demo' : 'live';
        if (!this._idb) this._idb = await openIdb();
        const key = `bank_${this.mode}`;
        let loaded = await idbGet(this._idb, key);
        if (!loaded && typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(`ftp_pages_${key}`);
                if (raw) loaded = JSON.parse(raw);
            } catch {
                loaded = null;
            }
        }
        if (loaded && typeof loaded === 'object') {
            this.state = { ...defaultBankState(), ...loaded };
            this.state.nextIds = { ...defaultBankState().nextIds, ...(loaded.nextIds || {}) };
        } else {
            this.state = defaultBankState();
        }
        ensureLegacyBuckets(this.state);
        this._emit();
        return this.state;
    }

    async save() {
        const key = `bank_${this.mode}`;
        const ok = await idbPut(this._idb, key, this.state);
        if (!ok && typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(`ftp_pages_${key}`, JSON.stringify(this.state));
            } catch {
                // ignore quota error
            }
        }
        this._emit();
    }

    async reset(seedLegacy = true) {
        this.state = defaultBankState();
        if (seedLegacy) ensureLegacyBuckets(this.state);
        await this.save();
    }

    replaceState(newState) {
        const base = defaultBankState();
        this.state = {
            ...base,
            ...newState,
            nextIds: { ...base.nextIds, ...(newState?.nextIds || {}) },
        };
        ensureLegacyBuckets(this.state);
    }

    nextId(collection) {
        const id = this.state.nextIds[collection] || 1;
        this.state.nextIds[collection] = id + 1;
        return id;
    }

    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners) {
            try { fn(this.state, this.mode); } catch { /* ignore */ }
        }
    }
}

export function createInMemoryStore() {
    const s = new BankStore('live');
    s.save = async () => {};
    return s;
}
