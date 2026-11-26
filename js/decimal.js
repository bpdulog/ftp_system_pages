/**
 * Exact fixed-point Decimal arithmetic backed by BigInt with ROUND_HALF_UP,
 * matching Python's decimal.Decimal financial conventions.
 */

const POW10_CACHE = new Map([[0, 1n]]);
function pow10(n) {
    if (n <= 0) return 1n;
    let cached = POW10_CACHE.get(n);
    if (cached !== undefined) return cached;
    cached = 10n ** BigInt(n);
    POW10_CACHE.set(n, cached);
    return cached;
}

export class Dec {
    /**
     * @param {bigint} coeff
     * @param {number} scale non-negative decimal places
     */
    constructor(coeff, scale = 0) {
        this.c = coeff;
        this.s = scale;
    }

    static from(val) {
        if (val instanceof Dec) return val;
        if (val === null || val === undefined || val === '') {
            throw new Error('Cannot convert empty value to Dec');
        }
        if (typeof val === 'bigint') return new Dec(val, 0);
        let str = typeof val === 'number' ? String(val) : String(val).trim();
        if (!str || /^nan$/i.test(str) || /infinity/i.test(str)) {
            throw new Error(`Invalid decimal value: ${val}`);
        }
        let sign = 1n;
        if (str[0] === '-') { sign = -1n; str = str.slice(1); }
        else if (str[0] === '+') { str = str.slice(1); }

        const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(str)
            || /^\.(\d+)(?:[eE]([+-]?\d+))?$/.exec(str);
        if (!match) {
            throw new Error(`Invalid decimal syntax: ${val}`);
        }

        let intPart, fracPart, exp;
        if (str.startsWith('.')) {
            intPart = '';
            fracPart = match[1] || '';
            exp = match[2] ? parseInt(match[2], 10) : 0;
        } else {
            intPart = match[1] || '0';
            fracPart = match[2] || '';
            exp = match[3] ? parseInt(match[3], 10) : 0;
        }

        const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
        const rawScale = fracPart.length - exp;
        if (digits === '0') return new Dec(0n, 0);
        if (rawScale >= 0) {
            return new Dec(sign * BigInt(digits), rawScale);
        }
        return new Dec(sign * BigInt(digits) * pow10(-rawScale), 0);
    }

    static tryFrom(val, fallback = null) {
        if (val === null || val === undefined || val === '') return fallback;
        try { return Dec.from(val); } catch { return fallback; }
    }

    isZero() { return this.c === 0n; }
    isNegative() { return this.c < 0n; }
    isPositive() { return this.c > 0n; }
    abs() { return this.c < 0n ? new Dec(-this.c, this.s) : this; }
    neg() { return this.c === 0n ? this : new Dec(-this.c, this.s); }

    _align(other) {
        const b = Dec.from(other);
        if (this.s === b.s) return [this.c, b.c, this.s];
        if (this.s < b.s) return [this.c * pow10(b.s - this.s), b.c, b.s];
        return [this.c, b.c * pow10(this.s - b.s), this.s];
    }

    add(other) {
        const [a, b, s] = this._align(other);
        return new Dec(a + b, s);
    }

    sub(other) {
        const [a, b, s] = this._align(other);
        return new Dec(a - b, s);
    }

    mul(other) {
        const b = Dec.from(other);
        if (this.c === 0n || b.c === 0n) return new Dec(0n, 0);
        return new Dec(this.c * b.c, this.s + b.s);
    }

    div(other, scale = 28) {
        const b = Dec.from(other);
        if (b.c === 0n) throw new Error('Division by zero');
        if (this.c === 0n) return new Dec(0n, 0);
        const sign = (this.c < 0n) !== (b.c < 0n) ? -1n : 1n;
        const absA = this.c < 0n ? -this.c : this.c;
        const absB = b.c < 0n ? -b.c : b.c;
        // (absA * 10^-sA) / (absB * 10^-sB) * 10^scale = (absA * 10^(scale + sB - sA)) / absB
        const shift = scale + b.s - this.s;
        let num, den;
        if (shift >= 0) {
            num = absA * pow10(shift);
            den = absB;
        } else {
            num = absA;
            den = absB * pow10(-shift);
        }
        let q = num / den;
        const rem = num % den;
        if (rem * 2n >= den) q += 1n;
        return new Dec(sign * q, scale);
    }

    powInt(exp) {
        if (!Number.isInteger(exp) || exp < 0) throw new Error('Exponent must be non-negative integer');
        if (exp === 0) return ONE;
        let result = ONE;
        let base = this;
        let e = exp;
        while (e > 0) {
            if (e & 1) result = result.mul(base);
            e >>= 1;
            if (e > 0) base = base.mul(base);
        }
        return result;
    }

    round(dp = 6) {
        if (this.s === dp) return this;
        if (this.s < dp) return new Dec(this.c * pow10(dp - this.s), dp);
        const div = pow10(this.s - dp);
        const sign = this.c < 0n ? -1n : 1n;
        const abs = this.c < 0n ? -this.c : this.c;
        let q = abs / div;
        const rem = abs % div;
        if (rem * 2n >= div) q += 1n;
        return new Dec(sign * q, dp);
    }

    cmp(other) {
        const [a, b] = this._align(other);
        return a < b ? -1 : a > b ? 1 : 0;
    }

    eq(other) { return this.cmp(other) === 0; }
    lt(other) { return this.cmp(other) < 0; }
    lte(other) { return this.cmp(other) <= 0; }
    gt(other) { return this.cmp(other) > 0; }
    gte(other) { return this.cmp(other) >= 0; }

    toFixed(dp = null) {
        const d = dp !== null ? this.round(dp) : this;
        const sign = d.c < 0n ? '-' : '';
        const absStr = (d.c < 0n ? -d.c : d.c).toString();
        if (d.s === 0) return sign + absStr;
        const padded = absStr.padStart(d.s + 1, '0');
        const intPart = padded.slice(0, padded.length - d.s);
        const fracPart = padded.slice(padded.length - d.s);
        return `${sign}${intPart}.${fracPart}`;
    }

    toString() {
        return this.toFixed();
    }

    toNumber() {
        return Number(this.toFixed());
    }
}

export const ZERO = new Dec(0n, 0);
export const ONE = new Dec(1n, 0);
export const ONE_BP = new Dec(1n, 4); // 0.0001

export function dsum(items) {
    let acc = ZERO;
    for (const x of items) acc = acc.add(Dec.from(x));
    return acc;
}

export function decimalRound(val, precision = 6) {
    return Dec.from(val).round(precision);
}

export function dmin(a, b) {
    const da = Dec.from(a), db = Dec.from(b);
    return da.lte(db) ? da : db;
}

export function dmax(a, b) {
    const da = Dec.from(a), db = Dec.from(b);
    return da.gte(db) ? da : db;
}

export function safeSpreadsheetCell(val) {
    if (typeof val === 'string' && /^[=+\-@\t\r]/.test(val)) {
        return "'" + val;
    }
    return val;
}
